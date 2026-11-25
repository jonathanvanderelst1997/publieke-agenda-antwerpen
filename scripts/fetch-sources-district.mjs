// Haalt de publieke districtskalender "Wat beleef je in district Antwerpen?" op en schrijft
// site/sources/district-kalender.json. Leest alleen; bewaart nooit de ruwe JSON, afbeeldingen of
// CMS-personeelsvelden (creator, assignee, lockOwner).
//
// Weigert www.antwerpen.be (sinds 23-10-2026, bron_weigert_automatisch), dan leest deze bron de districtskalender
// zoals de eigenaar ze op zijn tik in zijn eigen browser liet lezen, via de Brain Gateway (contract C6,
// lib/districtskalender-brain.mjs). Er wordt niets omzeild: www.antwerpen.be wordt hier niet opnieuw gevraagd. Elk
// item met een officiële pagina (een ontmoetingscentrum van het district of een persbericht van het district) wordt
// op die pagina zelf opnieuw nagekeken: titel, dag en adres. Lukt dat niet, dan valt het item weg.
//
//   DISTRICTSKALENDER_BRAIN_URL overschrijft de standaard-URL van de Gateway.
//
//   node scripts/fetch-sources-district.mjs            schrijft het bronbestand
//   node scripts/fetch-sources-district.mjs --dry-run  toont alleen aantallen, schrijft niets
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DISTRICT_PAGE_UUID, parseDistrictPage } from "../lib/district-parser.mjs";
import { DEFAULT_DISTRICTSKALENDER_URL, adresOpPagina, isKalenderPagina, itemFromKalender, titelOpPagina, validateDistrictskalenderFeed } from "../lib/districtskalender-brain.mjs";
import { FetchError, USER_AGENT, errorCodeOf, fetchWithTimeout, guardShrink, isMainModule, isWeigeringCode, keepPreviousOnError, readSourceDocument, screenItems, statusEntry, suspiciousDrop, upcomingCount, writeSourceDocument } from "../lib/fetch-util.mjs";
import { dateOnPage, pageText } from "../lib/mail-signals.mjs";
import { brusselsDate } from "../lib/html-text.mjs";
import { sourceDocument } from "../lib/source-feed.mjs";
import {enrichActions} from "../lib/automatic-event-action.mjs";

export const SOURCE_ID = "district-kalender";
export const DISTRICT_API_URL = `https://www.antwerpen.be/api/portaal/content/page-content-by-uuid/${DISTRICT_PAGE_UUID}`;
// Verhoog bij een parserwijziging, zodat een ongewijzigde pagina toch opnieuw gelezen wordt.
export const PARSER_VERSION = "2";
const MAX_REQUESTS = 2;

async function getPage(fetchImpl) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_REQUESTS; attempt += 1) {
    try {
      const response = await fetchWithTimeout(fetchImpl, DISTRICT_API_URL, {
        headers: { "user-agent": USER_AGENT, accept: "application/json" },
        redirect: "error",
      });
      if (response.status >= 500 && attempt < MAX_REQUESTS) {
        lastError = new FetchError(`http_${response.status}`);
        continue;
      }
      if (!response.ok) throw new FetchError(`http_${response.status}`);
      try {
        return await response.json();
      } catch {
        throw new FetchError("invalid_json");
      }
    } catch (error) {
      lastError = error;
      if (errorCodeOf(error) !== "network_error" && errorCodeOf(error) !== "timeout") break;
    }
  }
  throw lastError ?? new FetchError("network_error");
}

const MAX_REDIRECTS = 3;
const MAX_PAGE_BYTES = 3 * 1024 * 1024;

// Eén officiële pagina, hoogstens drie omleidingen, elk op een van de vaste hosts.
async function officielePagina(fetchImpl, startUrl) {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!isKalenderPagina(url)) throw new FetchError("redirect_not_allowed");
    const response = await fetchWithTimeout(fetchImpl, url, { headers: { "user-agent": USER_AGENT, accept: "text/html" }, redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers?.get?.("location");
      if (!location) throw new FetchError("redirect_without_location");
      url = new URL(location, url).href;
      continue;
    }
    if (response.status !== 200) throw new FetchError(`http_${response.status}`);
    const html = await response.text();
    if (html.length > MAX_PAGE_BYTES) throw new FetchError("page_too_large");
    return html;
  }
  throw new FetchError("too_many_redirects");
}

// De districtskalender via de Brain Gateway, als www.antwerpen.be weigert. Geeft het statusitem, of null als de
// Gateway niets bruikbaars had: dan blijft de vorige stand staan met de weigering als reden.
async function vanBrain({ fetchImpl, env, rootDir, retrievedAt, today, log, dryRun }) {
  const endpoint = String(env.DISTRICTSKALENDER_BRAIN_URL || DEFAULT_DISTRICTSKALENDER_URL);
  let payload;
  try {
    if (!/^https:\/\//.test(endpoint)) throw new FetchError("invalid_endpoint");
    const response = await fetchWithTimeout(fetchImpl, endpoint, { headers: { "user-agent": USER_AGENT, accept: "application/json" }, redirect: "error" });
    if (response.status !== 200) {
      log(JSON.stringify({ source: SOURCE_ID, via: "brain", fetchStatus: "error", errorCode: `brain_http_${response.status}` }));
      return null;
    }
    const text = await response.text();
    payload = JSON.parse(text);
    const validation = validateDistrictskalenderFeed(payload, { byteLength: Buffer.byteLength(text, "utf8") });
    if (!validation.ok) {
      log(JSON.stringify({ source: SOURCE_ID, via: "brain", fetchStatus: "error", errorCode: "brain_invalid_payload", violations: validation.errors.length }));
      return null;
    }
  } catch (error) {
    log(JSON.stringify({ source: SOURCE_ID, via: "brain", fetchStatus: "error", errorCode: `brain_${errorCodeOf(error)}` }));
    return null;
  }
  const reasons = {};
  const count = (reason) => { reasons[reason] = (reasons[reason] ?? 0) + 1; };
  const items = [];
  for (const entry of payload.items) {
    if ((entry.end ?? entry.start).slice(0, 10) < today) { count("date_passed"); continue; }
    if (entry.page) {
      // Opnieuw nagekeken op de officiële pagina zelf: titel, dag en adres.
      let text;
      try {
        text = pageText(await officielePagina(fetchImpl, entry.page));
      } catch (error) {
        count(errorCodeOf(error));
        continue;
      }
      if (!titelOpPagina(entry.title, text)) { count("title_not_on_page"); continue; }
      if (!dateOnPage(entry.start.slice(0, 10), text)) { count("date_not_on_page"); continue; }
      if (!adresOpPagina(entry.place, text)) { count("address_not_on_page"); continue; }
    }
    items.push(itemFromKalender(entry, { retrievedAt }));
  }
  const screened = screenItems(items);
  if (dryRun) {
    log(JSON.stringify({ source: SOURCE_ID, via: "brain", dryRun: true, items: screened.items.length, reasons }));
    return statusEntry(SOURCE_ID, { fetchStatus: "ok", retrievedAt, itemCount: screened.items.length });
  }
  // Geen krimpbewaking: deze levering is al gecureerd (de eigenaar kan er iets af halen), en wat er niet meer in
  // staat, hoort er ook niet meer op.
  const document = writeSourceDocument(
    rootDir,
    SOURCE_ID,
    sourceDocument(SOURCE_ID, { retrievedAt, fetchStatus: "ok", contentVersion: `brain|${payload.generated_on}`, items: screened.items })
  );
  log(JSON.stringify({ source: SOURCE_ID, via: "brain", fetchStatus: "ok", items: document.items.length, reasons, rejected: screened.rejected }));
  return statusEntry(SOURCE_ID, { fetchStatus: "ok", retrievedAt, itemCount: document.items.length });
}

export async function run({ fetch: fetchImpl = globalThis.fetch, clock = () => new Date(), rootDir, env = process.env, dryRun = false, log = console.log } = {}) {
  const previous = readSourceDocument(rootDir, SOURCE_ID);
  const now = clock();
  const retrievedAt = now.toISOString();
  const today = brusselsDate(now);
  let page;
  try {
    page = await getPage(fetchImpl);
  } catch (error) {
    const code = errorCodeOf(error);
    log(JSON.stringify({ source: SOURCE_ID, fetchStatus: "error", errorCode: code }));
    // De site weigert automatische lezers: dan wat de eigenaar op zijn tik liet lezen, via Brain (zie boven).
    if (isWeigeringCode(code)) {
      const viaBrain = await vanBrain({ fetchImpl, env, rootDir, retrievedAt, today, log, dryRun });
      if (viaBrain) return [viaBrain];
    }
    return [keepPreviousOnError(rootDir, SOURCE_ID, previous, code, { dryRun })];
  }

  const contentVersion = `parser-${PARSER_VERSION}|${String(page?.currentVersion ?? "")}|${String(page?.updatedAt ?? "")}`;
  const parsed = parseDistrictPage(page);
  page = null; // de ruwe JSON wordt nergens bewaard
  const screened = screenItems(parsed.items.map((item) => ({ ...item, retrievedAt })));
  const counts = {
    source: SOURCE_ID,
    blocks: parsed.blocks,
    items: screened.items.length,
    upcoming: upcomingCount(screened.items, today),
    reviewRequired: parsed.reviewItems.length + screened.rejected.privacy + screened.rejected.contract,
    issues: parsed.issues.length,
    droppedLinks: parsed.droppedLinks,
  };
  if (dryRun) {
    const drop = previous ? suspiciousDrop(previous.items, screened.items, today) : null;
    log(JSON.stringify({ dryRun: true, ...counts, suspiciousDrop: drop }));
    return [statusEntry(SOURCE_ID, { fetchStatus: drop ? "error" : "ok", retrievedAt, itemCount: screened.items.length, errorCode: drop ? "suspicious_drop" : null })];
  }

  if (!parsed.blocks) {
    // Een lege of onleesbare pagina overschrijft nooit bestaande data.
    log(JSON.stringify({ ...counts, fetchStatus: "error", errorCode: "no_blocks" }));
    return [keepPreviousOnError(rootDir, SOURCE_ID, previous, "no_blocks")];
  }

  let items = screened.items;
  if (previous && previous.contentVersion === contentVersion && previous.fetchStatus === "ok") {
    // Ongewijzigde pagina: alleen het ophaalmoment wordt bijgewerkt.
    items = previous.items.map((item) => ({ ...item, retrievedAt }));
    counts.restamped = true;
  }
  // Iedere dagelijkse bronronde herverifieert officiële eventdetails, zonder extra persoonsgegevens.
  if (!dryRun) items = screenItems(await enrichActions(items,{fetchImpl,log})).items;
  // Blokken maar (bijna) geen items meer, bijvoorbeeld na een andere datumopmaak: nooit wegschrijven.
  const shrink = guardShrink({ rootDir, sourceId: SOURCE_ID, previous, items, today, env, log, counts });
  if (shrink) return [shrink];
  const document = writeSourceDocument(
    rootDir,
    SOURCE_ID,
    sourceDocument(SOURCE_ID, { retrievedAt, fetchStatus: "ok", contentVersion, items })
  );
  log(JSON.stringify({ ...counts, written: document.items.length }));
  return [statusEntry(SOURCE_ID, { fetchStatus: "ok", retrievedAt, itemCount: document.items.length })];
}

if (isMainModule(import.meta.url)) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  run({ rootDir, dryRun: process.argv.includes("--dry-run") }).catch((error) => {
    console.error(JSON.stringify({ source: SOURCE_ID, fatal: errorCodeOf(error) }));
    process.exitCode = 1;
  });
}
