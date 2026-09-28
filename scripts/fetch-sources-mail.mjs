// Publieke activiteiten uit nieuwsbrieven, via de Brain Gateway (contract C5). De Gateway levert alleen
// een titel, datum, plaats en de officiële URL; nooit mailinhoud. Elk item wordt hier opnieuw
// gecontroleerd op de officiële pagina zelf: HTTP 200, een specifieke titel (minstens 12 tekens en
// 2 woorden, als geheel) en de startdatum staan op de pagina. Uur, einddatum en plaats worden alleen
// overgenomen als ze óók op die pagina staan; anders "Info" en "locatie via de officiële bron".
// Een titel die zichzelf privé noemt ("persoonlijke uitnodiging", "besloten", …) wordt nooit publiek.
// Schrijft site/sources/mail-district.json en site/sources/mail-stad.json; raakt geen andere bronnen.
//
//   MAIL_SIGNALEN_URL overschrijft de standaard-URL van de Gateway.
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FetchError, USER_AGENT, errorCodeOf, fetchWithTimeout, isMainModule, readSourceDocument, screenItems, statusEntry, writeSourceDocument } from "../lib/fetch-util.mjs";
import { addDaysIso, brusselsDate } from "../lib/html-text.mjs";
import { allowedSignalUrl, dateOnPage, hasPrivateMarker, pageText, placeOnPage, timeOnPage, titleOnPage, titleSpecificEnough, validateMailSignals } from "../lib/mail-signals.mjs";
import { parseEventTimes } from "../lib/event-contract.mjs";
import { postcodesInText } from "../lib/postcodes.mjs";
import { sourceDocument } from "../lib/source-feed.mjs";

export const DEFAULT_MAIL_SIGNALEN_URL = "https://project-brain-gateway.onrender.com/v1/publiek/publieke-agenda/mail-signalen.json";
export const SOURCE_IDS = Object.freeze({ district: "mail-district", stad: "mail-stad" });
const MAX_REDIRECTS = 3;
const MAX_PAGE_BYTES = 3 * 1024 * 1024;
const STALE_AFTER_DAYS = 3;
const FALLBACK_LOCATION = "locatie via de officiële bron";

function hourLabel(time) {
  const [hours, minutes] = time.split(":");
  return minutes === "00" ? String(Number(hours)) : `${Number(hours)}.${minutes}`;
}

// Bouwt het item uit het signaal, maar neemt uur, einddatum en plaats alleen over als ze op de
// officiële pagina staan (`text` = pageText van die pagina). Titel en startdatum zijn dan al bevestigd.
export function itemFromSignal(signal, { url, retrievedAt, text = "" }) {
  const date = signal.start.slice(0, 10);
  const signalStart = !signal.all_day && signal.start.length > 10 ? signal.start.slice(11, 16) : null;
  const startTime = signalStart && timeOnPage(signalStart, text) ? signalStart : null;
  const endDatePart = signal.end ? signal.end.slice(0, 10) : null;
  const endDate = endDatePart && endDatePart > date && dateOnPage(endDatePart, text) ? endDatePart : null;
  const signalEnd = signal.end && signal.end.length > 10 ? signal.end.slice(11, 16) : null;
  const endTime = startTime && signalEnd && !endDate && signalEnd > startTime && timeOnPage(signalEnd, text) ? signalEnd : null;
  let timeText = "";
  if (startTime) timeText = endTime ? `${hourLabel(startTime)} tot ${hourLabel(endTime)} uur` : `${hourLabel(startTime)} uur`;
  const signalPlace = signal.place ? signal.place.trim() : "";
  const place = signalPlace && placeOnPage(signalPlace, text) ? signalPlace : "";
  return {
    id: `mail-${signal.id.slice(0, 16)}-${date}`,
    externalId: signal.id.slice(0, 16),
    title: signal.title.trim(),
    theme: "Activiteit",
    className: "activity",
    date,
    endDate,
    timeSlot: startTime ?? "Info",
    timeText,
    location: place || FALLBACK_LOCATION,
    postcodes: postcodesInText(place),
    info: "",
    kind: "activity",
    sourceUrl: url,
    retrievedAt,
    reviewRequired: false,
  };
}

// Haalt een officiële pagina op met hoogstens 3 redirects, elk op een toegelaten host.
export async function fetchOfficialPage(fetchImpl, startUrl) {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!allowedSignalUrl(url)) throw new FetchError("redirect_not_allowed");
    const response = await fetchWithTimeout(fetchImpl, url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html" },
      redirect: "manual",
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers?.get?.("location");
      if (!location) throw new FetchError("redirect_without_location");
      url = new URL(location, url).href;
      continue;
    }
    if (response.status !== 200) throw new FetchError(`http_${response.status}`);
    const html = await response.text();
    if (html.length > MAX_PAGE_BYTES) throw new FetchError("page_too_large");
    return { url, html };
  }
  throw new FetchError("too_many_redirects");
}

// Herverifieert één signaal. Resultaat: { item } of { reason }.
export async function reverify(fetchImpl, signal, retrievedAt) {
  let page;
  try {
    page = await fetchOfficialPage(fetchImpl, signal.url);
  } catch (error) {
    return { reason: errorCodeOf(error) };
  }
  const text = pageText(page.html);
  if (!titleOnPage(signal.title, text)) return { reason: "title_not_on_page" };
  if (!dateOnPage(signal.start.slice(0, 10), text)) return { reason: "date_not_on_page" };
  return { item: itemFromSignal(signal, { url: page.url, retrievedAt, text }) };
}

// Wat vóór elk verzoek al vaststaat: een privémarkering of een te algemene titel wordt nooit opgehaald.
function precheck(signal) {
  if (hasPrivateMarker(signal.title)) return "private_marker";
  if (!titleSpecificEnough(signal.title)) return "title_too_generic";
  return null;
}

// Voor herverificatie van eerder aanvaarde items (bij een stale Gateway). De id wordt achteraf
// teruggezet op die van het bestaande item.
function signalFromItem(item) {
  const { endTime } = parseEventTimes(item.timeSlot, item.timeText);
  let end = item.endDate;
  if (!end && endTime && item.timeSlot !== "Info") end = `${item.date}T${endTime}`;
  return {
    id: item.externalId,
    title: item.title,
    start: item.timeSlot === "Info" ? item.date : `${item.date}T${item.timeSlot}`,
    end,
    all_day: item.timeSlot === "Info",
    place: item.location === FALLBACK_LOCATION ? null : item.location,
    url: item.sourceUrl,
  };
}

function writeGroups(rootDir, groups, { fetchStatus, retrievedAt }) {
  const statuses = [];
  for (const [group, sourceId] of Object.entries(SOURCE_IDS)) {
    const items = groups[group];
    const screened = screenItems(items);
    const document = writeSourceDocument(
      rootDir,
      sourceId,
      sourceDocument(sourceId, {
        retrievedAt,
        fetchStatus: fetchStatus.status,
        items: screened.items,
      })
    );
    statuses.push(statusEntry(sourceId, { fetchStatus: fetchStatus.status, retrievedAt: document.retrievedAt, itemCount: document.items.length, errorCode: fetchStatus.errorCode }));
  }
  return statuses;
}

function keepPrevious(rootDir, previous, fetchStatus, errorCode) {
  const statuses = [];
  for (const [group, sourceId] of Object.entries(SOURCE_IDS)) {
    const document = writeSourceDocument(
      rootDir,
      sourceId,
      sourceDocument(sourceId, {
        retrievedAt: previous[group]?.retrievedAt ?? null,
        fetchStatus,
        items: previous[group]?.items ?? [],
      })
    );
    statuses.push(statusEntry(sourceId, { fetchStatus, retrievedAt: document.retrievedAt, itemCount: document.items.length, errorCode }));
  }
  return statuses;
}

export async function run({ fetch: fetchImpl = globalThis.fetch, clock = () => new Date(), rootDir, env = process.env, log = console.log } = {}) {
  const endpoint = String(env.MAIL_SIGNALEN_URL || DEFAULT_MAIL_SIGNALEN_URL);
  const previous = { district: readSourceDocument(rootDir, SOURCE_IDS.district), stad: readSourceDocument(rootDir, SOURCE_IDS.stad) };
  const now = clock();
  const retrievedAt = now.toISOString();
  const today = brusselsDate(now);
  const reasons = {};
  const count = (reason) => {
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  };

  let response;
  try {
    if (!/^https:\/\//.test(endpoint)) throw new FetchError("invalid_endpoint");
    response = await fetchWithTimeout(fetchImpl, endpoint, { headers: { "user-agent": USER_AGENT, accept: "application/json" }, redirect: "error" });
  } catch (error) {
    const code = errorCodeOf(error);
    log(JSON.stringify({ source: "mail", fetchStatus: "error", errorCode: code }));
    return keepPrevious(rootDir, previous, "error", code);
  }

  // 404: de route is nog niet uitgerold. 401/403: de route is (nog) niet publiek; de Gateway weigert
  // onbekende routes zonder sleutel. In beide gevallen is de bron gewoon nog niet actief.
  if ([401, 403, 404].includes(response.status)) {
    const code = response.status === 404 ? "endpoint_not_deployed" : "endpoint_not_public";
    log(JSON.stringify({ source: "mail", fetchStatus: "disabled", errorCode: code }));
    return keepPrevious(rootDir, previous, "disabled", code);
  }

  let stale = response.status === 503;
  let payload = null;
  if (!stale) {
    if (response.status !== 200) {
      const code = `http_${response.status}`;
      log(JSON.stringify({ source: "mail", fetchStatus: "error", errorCode: code }));
      return keepPrevious(rootDir, previous, "error", code);
    }
    let text;
    try {
      text = await response.text();
      payload = JSON.parse(text);
    } catch {
      log(JSON.stringify({ source: "mail", fetchStatus: "error", errorCode: "invalid_json" }));
      return keepPrevious(rootDir, previous, "error", "invalid_json");
    }
    const validation = validateMailSignals(payload, { byteLength: Buffer.byteLength(text, "utf8") });
    if (!validation.ok) {
      log(JSON.stringify({ source: "mail", fetchStatus: "error", errorCode: "invalid_payload", violations: validation.errors.length }));
      return keepPrevious(rootDir, previous, "error", "invalid_payload");
    }
    if (addDaysIso(payload.generated_on, STALE_AFTER_DAYS) < today) stale = true;
  }

  const groups = { district: [], stad: [] };
  if (stale) {
    // De Gateway heeft (nog) geen verse snapshot: eerder aanvaarde items blijven tot hun datum voorbij is,
    // maar alleen als de officiële pagina ze vandaag nog altijd bevestigt.
    for (const group of Object.keys(SOURCE_IDS)) {
      for (const item of previous[group]?.items ?? []) {
        if ((item.endDate ?? item.date) < today) {
          count("date_passed");
          continue;
        }
        const signal = signalFromItem(item);
        const blocked = precheck(signal);
        if (blocked) {
          count(blocked);
          continue;
        }
        const result = await reverify(fetchImpl, signal, retrievedAt);
        if (result.item) groups[group].push({ ...result.item, id: item.id, externalId: item.externalId });
        else if (["network_error", "timeout"].includes(result.reason)) groups[group].push(item);
        else count(result.reason);
      }
    }
    log(JSON.stringify({ source: "mail", fetchStatus: "ok", errorCode: "upstream_stale", kept: groups.district.length + groups.stad.length, reasons }));
    return writeGroups(rootDir, groups, { fetchStatus: { status: "ok", errorCode: "upstream_stale" }, retrievedAt });
  }

  for (const signal of payload.items) {
    if ((signal.end ?? signal.start).slice(0, 10) < today) {
      count("date_passed");
      continue;
    }
    const blocked = precheck(signal);
    if (blocked) {
      count(blocked);
      continue;
    }
    const result = await reverify(fetchImpl, signal, retrievedAt);
    if (result.item) groups[signal.group].push(result.item);
    else count(result.reason);
  }
  log(JSON.stringify({ source: "mail", fetchStatus: "ok", signals: payload.items.length, district: groups.district.length, stad: groups.stad.length, reasons }));
  return writeGroups(rootDir, groups, { fetchStatus: { status: "ok", errorCode: null }, retrievedAt });
}

if (isMainModule(import.meta.url)) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  run({ rootDir }).catch((error) => {
    console.error(JSON.stringify({ source: "mail", fatal: errorCodeOf(error) }));
    process.exitCode = 1;
  });
}
