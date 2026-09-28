// Stadsactiviteiten uit UiTdatabank (publiq), alleen als er een sleutel is.
//   UITDATABANK_CLIENT_ID  → header x-client-id (aanbevolen)
//   UITDATABANK_API_KEY    → header x-api-key (terugval voor oudere integraties)
//   UITDATABANK_SEARCH_BASE → standaard https://search.uitdatabank.be; bevat de basis "search-test",
//                             dan wordt er alleen geteld en niets naar site/ geschreven.
// Zonder sleutel: "UiT uit: geen sleutel", site/sources/stad-uit.json blijft byte-identiek, exit 0.
//
// Alleen deze velden worden gelezen (whitelist): @id, name, startDate/endDate/subEvent, status.type,
// location.name, location.address.streetAddress/postalCode/addressLocality, location.geo,
// terms (eventtype/theme), priceInfo (base), sameAs. Nooit creator, contributors, contactPoint,
// bookingInfo, organizer, image of mediaObject.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { themeFor, classNameForTheme } from "../lib/district-parser.mjs";
import { FetchError, USER_AGENT, errorCodeOf, fetchWithTimeout, guardShrink, isMainModule, keepPreviousOnError, readSourceDocument, screenItems, sourcePath, statusEntry, upcomingCount, writeSourceDocument } from "../lib/fetch-util.mjs";
import { addDaysIso, brusselsDate, brusselsOffset, brusselsParts, cleanText, stripEmails } from "../lib/html-text.mjs";
import { CITY_POSTCODES, isDistrictPostcode, pointInDistrict } from "../lib/postcodes.mjs";
import { SOURCE_DEFINITIONS, sourceDocument } from "../lib/source-feed.mjs";

export const SOURCE_ID = "stad-uit";
export const DEFAULT_SEARCH_BASE = "https://search.uitdatabank.be";
export const PAGE_SIZE = 250;
// Gemeten op 28-09-2026 op uitinvlaanderen.be (Antwerpen + deelgemeenten): 825 activiteiten vandaag,
// 1.508 in 14 dagen, 1.900 in 30 dagen. Een vaste kap op 500 dekte dus nog geen volle dag. Er wordt
// nu alleen op een daggrens afgekapt: alles t/m de laatste volledige dag, en die dag staat in
// `coverage` en op de site ("volledig t/m …, meer op UiTinVlaanderen").
export const ITEM_CAP = SOURCE_DEFINITIONS[SOURCE_ID].maxItems;
export const WINDOW_DAYS = 30;
const MAX_PAGES = 40;

export function uitQuery() {
  return `address.\\*.postalCode:(${CITY_POSTCODES.join(" OR ")}) AND NOT calendarType:permanent AND NOT attendanceMode:online`;
}

// Bouwt de zoek-URL; elke waarde wordt met encodeURIComponent gecodeerd ("+" wordt %2B).
export function searchUrl(base, { start, dateFrom, dateTo }) {
  const params = [
    ["embed", "true"],
    ["limit", String(PAGE_SIZE)],
    ["start", String(start)],
    ["dateFrom", dateFrom],
    ["dateTo", dateTo],
    ["q", uitQuery()],
    ["sort[created]", "asc"],
  ];
  return `${base.replace(/\/+$/, "")}/events/?${params.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&")}`;
}

function localized(value, language) {
  if (!value || typeof value !== "object") return typeof value === "string" ? value : "";
  return value.nl ?? value[language] ?? "";
}

// Whitelist-projectie van één UiT-event. Alles wat hier niet staat, wordt nooit gelezen.
export function projectEvent(event) {
  const uuid = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(String(event?.["@id"] ?? ""))?.[1]?.toLowerCase() ?? null;
  const language = event?.mainLanguage ?? "nl";
  const location = event?.location ?? {};
  const locationLanguage = location.mainLanguage ?? language;
  const address = location.address?.nl ?? location.address?.[locationLanguage] ?? (location.address?.postalCode ? location.address : null);
  const latitude = Number(location.geo?.latitude);
  const longitude = Number(location.geo?.longitude);
  const basePrice = (Array.isArray(event?.priceInfo) ? event.priceInfo : []).find((price) => price?.category === "base");
  const sameAs = (Array.isArray(event?.sameAs) ? event.sameAs : []).find((url) => /^https?:\/\/www\.uitinvlaanderen\.be\//i.test(String(url)));
  const status = event?.status?.type ?? "Available";
  const subEvents =
    Array.isArray(event?.subEvent) && event.subEvent.length
      ? event.subEvent.map((sub) => ({ startDate: sub?.startDate ?? null, endDate: sub?.endDate ?? null, status: sub?.status?.type ?? status }))
      : [{ startDate: event?.startDate ?? null, endDate: event?.endDate ?? null, status }];
  return {
    uuid,
    name: cleanText(localized(event?.name, language)),
    status,
    locationName: cleanText(localized(location.name, locationLanguage)),
    streetAddress: cleanText(address?.streetAddress ?? ""),
    postalCode: cleanText(address?.postalCode ?? ""),
    addressLocality: cleanText(address?.addressLocality ?? ""),
    geo: Number.isFinite(latitude) && Number.isFinite(longitude) ? [longitude, latitude] : null,
    terms: (Array.isArray(event?.terms) ? event.terms : [])
      .filter((term) => term?.domain === "eventtype" || term?.domain === "theme")
      .map((term) => cleanText(term.label))
      .filter(Boolean),
    basePrice: Number.isFinite(Number(basePrice?.price)) ? Number(basePrice.price) : null,
    sameAs: sameAs ? String(sameAs) : null,
    subEvents,
  };
}

function hourLabel(time) {
  const [hours, minutes] = time.split(":");
  return minutes === "00" ? String(Number(hours)) : `${Number(hours)}.${minutes}`;
}

function publicUrl(sameAs) {
  if (!sameAs) return null;
  try {
    const url = new URL(sameAs.replace(/^http:\/\//i, "https://"));
    if (url.hostname !== "www.uitinvlaanderen.be") return null;
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

// Zet een geprojecteerd event om in agenda-items (één per subEvent binnen het venster).
export function itemsForEvent(projected, { today, until, boundary }) {
  const reasons = [];
  if (!projected.uuid || !projected.name) return { items: [], reasons: ["incomplete"] };
  if (projected.status !== "Available") return { items: [], reasons: ["unavailable"] };
  if (!CITY_POSTCODES.includes(projected.postalCode)) return { items: [], reasons: ["outside_city"] };
  const sourceUrl = publicUrl(projected.sameAs);
  if (!sourceUrl) return { items: [], reasons: ["no_public_url"] };
  const byPostcode = isDistrictPostcode(projected.postalCode);
  if (projected.geo) {
    const byGeo = pointInDistrict(projected.geo, boundary);
    if (byGeo !== byPostcode) return { items: [], reasons: ["postcode_geo_conflict"] };
  }
  const location = stripEmails(
    [projected.locationName, [projected.streetAddress, `${projected.postalCode} ${projected.addressLocality}`.trim()].filter(Boolean).join(", ")]
      .filter(Boolean)
      .join(", ")
  );
  const priceText = projected.basePrice === null ? "" : projected.basePrice === 0 ? "Gratis" : `Basistarief € ${String(projected.basePrice).replace(".", ",")}`;
  const info = [projected.terms.join(" · "), priceText].filter(Boolean).join(" · ");
  const theme = themeFor(projected.name, projected.terms.join(" "));
  const items = [];
  for (const sub of projected.subEvents) {
    if (sub.status !== "Available") {
      reasons.push("unavailable");
      continue;
    }
    const start = brusselsParts(sub.startDate);
    const end = sub.endDate ? brusselsParts(sub.endDate) : null;
    if (!start) {
      reasons.push("invalid_date");
      continue;
    }
    const endDate = end && end.date > start.date ? end.date : null;
    if ((endDate ?? start.date) < today || start.date > until) {
      reasons.push("outside_window");
      continue;
    }
    const allDay = start.time === "00:00" && (!end || end.time === "23:59" || end.time === "00:00");
    const timed = !allDay;
    let timeText = "";
    if (timed) {
      timeText = end && end.date === start.date && end.time > start.time ? `${hourLabel(start.time)} tot ${hourLabel(end.time)} uur` : `${hourLabel(start.time)} uur`;
    }
    items.push({
      id: `uit-${projected.uuid}-${start.date}${timed ? `-${start.time.replace(":", "")}` : ""}`,
      externalId: projected.uuid,
      title: projected.name,
      theme,
      className: classNameForTheme(theme),
      date: start.date,
      endDate,
      timeSlot: timed ? start.time : "Info",
      timeText,
      location: location || `${projected.postalCode} Antwerpen`,
      postcodes: [projected.postalCode],
      info,
      kind: "activity",
      sourceUrl,
      retrievedAt: null,
      reviewRequired: false,
      inDistrict: byPostcode,
      noEventPage: true,
    });
  }
  return { items, reasons };
}

// Kapt een op datum gesorteerde lijst af op een daggrens: alle items t/m de laatste dag die er nog
// volledig in past. Een dag wordt nooit half getoond. `until` is het einde van het venster.
// Resultaat: { items, coverageUntil, capped }; coverageUntil is null als zelfs de lopende items en
// vandaag samen niet passen.
export function cutAtDayBoundary(items, cap, { today, until }) {
  if (items.length <= cap) return { items, coverageUntil: until, capped: false };
  const firstOver = items[cap].date;
  const kept = items.filter((item) => item.date < firstOver);
  const lastDate = kept.length ? kept[kept.length - 1].date : null;
  const coverageUntil = firstOver > today ? addDaysIso(firstOver, -1) : null;
  return { items: kept, coverageUntil: coverageUntil && lastDate ? coverageUntil : null, capped: true };
}

function keyHeaders(env) {
  if (env.UITDATABANK_CLIENT_ID) return { "x-client-id": env.UITDATABANK_CLIENT_ID };
  if (env.UITDATABANK_API_KEY) return { "x-api-key": env.UITDATABANK_API_KEY };
  return null;
}

export async function run({ fetch: fetchImpl = globalThis.fetch, clock = () => new Date(), rootDir, env = process.env, log = console.log, boundary, itemCap = ITEM_CAP } = {}) {
  const file = sourcePath(rootDir, SOURCE_ID);
  const headers = keyHeaders(env);
  if (!headers) {
    log("UiT uit: geen sleutel");
    if (!fs.existsSync(file)) {
      writeSourceDocument(rootDir, SOURCE_ID, sourceDocument(SOURCE_ID, { retrievedAt: null, fetchStatus: "skipped_no_key", items: [] }));
    }
    const current = readSourceDocument(rootDir, SOURCE_ID);
    return [statusEntry(SOURCE_ID, { fetchStatus: "skipped_no_key", retrievedAt: current?.retrievedAt ?? null, itemCount: current?.items?.length ?? 0 })];
  }

  const base = String(env.UITDATABANK_SEARCH_BASE || DEFAULT_SEARCH_BASE);
  const testOnly = base.includes("search-test");
  const previous = readSourceDocument(rootDir, SOURCE_ID);
  if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?\/?$/i.test(base)) {
    log(JSON.stringify({ source: SOURCE_ID, fetchStatus: "error", errorCode: "invalid_search_base" }));
    return [testOnly ? statusEntry(SOURCE_ID, { fetchStatus: "test_only", errorCode: "invalid_search_base" }) : keepPreviousOnError(rootDir, SOURCE_ID, previous, "invalid_search_base")];
  }

  const now = clock();
  const retrievedAt = now.toISOString();
  const today = brusselsDate(now);
  const until = addDaysIso(today, WINDOW_DAYS);
  const dateWindow = { dateFrom: `${today}T00:00:00${brusselsOffset(today)}`, dateTo: `${until}T23:59:59${brusselsOffset(until)}` };
  const events = [];
  let totalItems = 0;
  try {
    for (let page = 0, start = 0; page < MAX_PAGES; page += 1, start += PAGE_SIZE) {
      const response = await fetchWithTimeout(fetchImpl, searchUrl(base, { start, ...dateWindow }), {
        headers: { ...headers, "user-agent": USER_AGENT, accept: "application/ld+json, application/json" },
        redirect: "error",
      });
      if (!response.ok) throw new FetchError(`http_${response.status}`);
      let body;
      try {
        body = await response.json();
      } catch {
        throw new FetchError("invalid_json");
      }
      if (!Array.isArray(body?.member) || !Number.isInteger(body?.totalItems)) throw new FetchError("invalid_payload");
      totalItems = body.totalItems;
      events.push(...body.member.map(projectEvent));
      if (start + PAGE_SIZE >= totalItems || !body.member.length || start + PAGE_SIZE > 10_000) break;
    }
  } catch (error) {
    const code = errorCodeOf(error);
    log(JSON.stringify({ source: SOURCE_ID, fetchStatus: testOnly ? "test_only" : "error", errorCode: code }));
    if (testOnly) return [statusEntry(SOURCE_ID, { fetchStatus: "test_only", errorCode: code })];
    return [keepPreviousOnError(rootDir, SOURCE_ID, previous, code)];
  }

  const geometry = boundary ?? undefined;
  const reasons = {};
  const collected = [];
  for (const event of events) {
    const result = itemsForEvent(event, { today, until, boundary: geometry });
    for (const reason of result.reasons) reasons[reason] = (reasons[reason] ?? 0) + 1;
    collected.push(...result.items.map((item) => ({ ...item, retrievedAt })));
  }
  const unique = new Map();
  for (const item of collected.sort((a, b) => a.date.localeCompare(b.date) || a.timeSlot.localeCompare(b.timeSlot) || a.id.localeCompare(b.id))) {
    if (!unique.has(item.id)) unique.set(item.id, item);
  }
  const screened = screenItems([...unique.values()]);
  const cut = cutAtDayBoundary(screened.items, itemCap, { today, until });
  const coverage = { until: cut.coverageUntil, candidateCount: screened.items.length, capped: cut.capped };
  const counts = {
    source: SOURCE_ID,
    totalItems,
    events: events.length,
    candidates: screened.items.length,
    capped: cut.capped,
    coverageUntil: cut.coverageUntil,
    items: cut.items.length,
    upcoming: upcomingCount(cut.items, today),
    reviewRequired: (reasons.postcode_geo_conflict ?? 0) + screened.rejected.privacy + screened.rejected.contract,
    reasons,
  };
  if (testOnly) {
    log(JSON.stringify({ testOnly: true, ...counts }));
    return [statusEntry(SOURCE_ID, { fetchStatus: "test_only", retrievedAt: null, itemCount: 0 })];
  }
  const shrink = guardShrink({ rootDir, sourceId: SOURCE_ID, previous, items: cut.items, today, env, log, counts });
  if (shrink) return [shrink];
  const document = writeSourceDocument(rootDir, SOURCE_ID, sourceDocument(SOURCE_ID, { retrievedAt, fetchStatus: "ok", coverage, items: cut.items }));
  log(JSON.stringify({ ...counts, written: document.items.length }));
  return [statusEntry(SOURCE_ID, { fetchStatus: "ok", retrievedAt, itemCount: document.items.length, capped: cut.capped, coverageUntil: cut.coverageUntil })];
}

if (isMainModule(import.meta.url)) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  run({ rootDir }).catch((error) => {
    console.error(JSON.stringify({ source: SOURCE_ID, fatal: errorCodeOf(error) }));
    process.exitCode = 1;
  });
}
