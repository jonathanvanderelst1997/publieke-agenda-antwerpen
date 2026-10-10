// Leest de projectpagina's van district Antwerpen uit de publieke portaal-API (kanaal van het
// district, contentType 9) en schrijft site/sources/district-projecten.json: inspraak- en
// infomomenten, bevragingen en fasen van heraanleg- en andere projecten in de publieke ruimte.
// Ze vervangen de handmatige heraanleg-items die vroeger in site/agenda.js stonden.
//
// De kanaallijst bevat de volledige pagina's: er zijn dus geen aparte detailverzoeken (en geen cache
// per id) nodig. Hoogstens PROJECT_MAX_PAGES pagina's van PROJECT_PAGE_SIZE, met een pauze van een
// seconde ertussen (hoogstens één verzoek per seconde). De kanaalrespons bevat personeelsvelden en
// contactgegevens van derden: ze wordt alleen in het geheugen gelezen, meteen teruggebracht tot
// titel, tags en tekst (lib/district-projecten.mjs projectPage) en nooit bewaard.
//
// Fouten (geen antwoord, geen 200, geen JSON, een lege eerste pagina): de vorige items blijven staan
// en refresh-status.json meldt de fout.
//
//   node scripts/fetch-sources-projecten.mjs [--dry-run]
import path from "node:path";
import { fileURLToPath } from "node:url";

import { projectChannelUrl, projectItems, projectPage } from "../lib/district-projecten.mjs";
import { FetchError, USER_AGENT, errorCodeOf, fetchWithTimeout, guardShrink, isMainModule, keepPreviousOnError, readSourceDocument, screenItems, statusEntry, suspiciousDrop, upcomingCount, writeSourceDocument } from "../lib/fetch-util.mjs";
import { brusselsDate } from "../lib/html-text.mjs";
import { sourceDocument } from "../lib/source-feed.mjs";

export const SOURCE_ID = "district-projecten";
export const PROJECT_PAGE_SIZE = 25;
// De nieuwste 150 pagina's (op publicatiedatum). Lopende projecten staan daar ruim in; oudere
// pagina's zijn infofiches over zalen, tarieven en reglementen.
export const PROJECT_MAX_PAGES = 6;
export const PAUSE_MS = 1_000;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchProjectPages(fetchImpl, { sleep = defaultSleep } = {}) {
  const pages = [];
  const seen = new Set();
  for (let page = 0; page < PROJECT_MAX_PAGES; page += 1) {
    if (page > 0) await sleep(PAUSE_MS);
    const response = await fetchWithTimeout(fetchImpl, projectChannelUrl({ start: page * PROJECT_PAGE_SIZE, limit: PROJECT_PAGE_SIZE }), {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      redirect: "error",
    });
    if (!response.ok) throw new FetchError(`http_${response.status}`);
    let body;
    try {
      body = await response.json();
    } catch {
      throw new FetchError("invalid_json");
    }
    if (!Array.isArray(body?.data)) throw new FetchError("invalid_payload");
    if (page === 0 && !body.data.length) throw new FetchError("no_pages");
    for (const raw of body.data) {
      const projected = projectPage(raw);
      if (!projected.id || seen.has(projected.id)) continue;
      seen.add(projected.id);
      pages.push(projected);
    }
    if (body.data.length < PROJECT_PAGE_SIZE || body?.meta?.more === false) break;
  }
  return pages;
}

export async function run({ fetch: fetchImpl = globalThis.fetch, clock = () => new Date(), rootDir, env = process.env, dryRun = false, log = console.log, sleep = defaultSleep } = {}) {
  const previous = readSourceDocument(rootDir, SOURCE_ID);
  const now = clock();
  const retrievedAt = now.toISOString();
  const today = brusselsDate(now);
  let pages;
  try {
    pages = await fetchProjectPages(fetchImpl, { sleep });
  } catch (error) {
    const code = errorCodeOf(error);
    log(JSON.stringify({ source: SOURCE_ID, fetchStatus: "error", errorCode: code }));
    return [keepPreviousOnError(rootDir, SOURCE_ID, previous, code, { dryRun })];
  }
  const parsed = projectItems(pages, { today });
  pages = null;
  const screened = screenItems(parsed.items.map((item) => ({ ...item, retrievedAt })));
  const counts = {
    source: SOURCE_ID,
    ...parsed.counts,
    items: screened.items.length,
    upcoming: upcomingCount(screened.items, today),
    screenedOut: screened.rejected.privacy + screened.rejected.contract + screened.rejected.duplicate,
  };
  if (!parsed.counts.projects) {
    log(JSON.stringify({ ...counts, fetchStatus: "error", errorCode: "no_projects" }));
    return [keepPreviousOnError(rootDir, SOURCE_ID, previous, "no_projects", { dryRun })];
  }
  if (dryRun) {
    const drop = previous ? suspiciousDrop(previous.items, screened.items, today) : null;
    log(JSON.stringify({ dryRun: true, ...counts, suspiciousDrop: drop }));
    return [statusEntry(SOURCE_ID, { fetchStatus: drop ? "error" : "ok", retrievedAt, itemCount: screened.items.length, errorCode: drop ? "suspicious_drop" : null })];
  }
  const shrink = guardShrink({ rootDir, sourceId: SOURCE_ID, previous, items: screened.items, today, env, log, counts });
  if (shrink) return [shrink];
  const document = writeSourceDocument(rootDir, SOURCE_ID, sourceDocument(SOURCE_ID, { retrievedAt, fetchStatus: "ok", contentVersion: null, items: screened.items }));
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
