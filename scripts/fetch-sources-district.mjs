// Haalt de publieke districtskalender "Wat beleef je in district Antwerpen?" op en schrijft
// site/sources/district-kalender.json. Leest alleen; bewaart nooit de ruwe JSON, afbeeldingen of
// CMS-personeelsvelden (creator, assignee, lockOwner).
//
//   node scripts/fetch-sources-district.mjs            schrijft het bronbestand
//   node scripts/fetch-sources-district.mjs --dry-run  toont alleen aantallen, schrijft niets
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DISTRICT_PAGE_UUID, parseDistrictPage } from "../lib/district-parser.mjs";
import { FetchError, USER_AGENT, errorCodeOf, fetchWithTimeout, isMainModule, keepPreviousOnError, readSourceDocument, screenItems, statusEntry, upcomingCount, writeSourceDocument } from "../lib/fetch-util.mjs";
import { brusselsDate } from "../lib/html-text.mjs";
import { sourceDocument } from "../lib/source-feed.mjs";

export const SOURCE_ID = "district-kalender";
export const DISTRICT_API_URL = `https://www.antwerpen.be/api/portaal/content/page-content-by-uuid/${DISTRICT_PAGE_UUID}`;
// Verhoog bij een parserwijziging, zodat een ongewijzigde pagina toch opnieuw gelezen wordt.
export const PARSER_VERSION = "1";
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

export async function run({ fetch: fetchImpl = globalThis.fetch, clock = () => new Date(), rootDir, dryRun = false, log = console.log } = {}) {
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
    log(JSON.stringify({ dryRun: true, ...counts }));
    return [statusEntry(SOURCE_ID, { fetchStatus: "ok", retrievedAt, itemCount: screened.items.length })];
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
