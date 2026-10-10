// Haalt de foren en kermissen op uit A-Sign (MapServer/0, "foor") en schrijft
// site/sources/district-foren.json: één agendapunt per periode van een foor in district Antwerpen.
// Open data van de stad; geen sleutel, geen AI.
//
// Eén GET per ronde. Fouten (geen antwoord, geen 200, geen JSON, een ArcGIS-fout, nul rijen of een
// afgekapte laag): de vorige items blijven staan en refresh-status.json meldt de fout.
//
//   node scripts/fetch-sources-foren.mjs [--dry-run]
import path from "node:path";
import { fileURLToPath } from "node:url";

import { forenItems, forenQueryUrl } from "../lib/asign-foren.mjs";
import { FetchError, USER_AGENT, errorCodeOf, fetchWithTimeout, guardShrink, isMainModule, keepPreviousOnError, readSourceDocument, screenItems, statusEntry, suspiciousDrop, upcomingCount, writeSourceDocument } from "../lib/fetch-util.mjs";
import { brusselsDate } from "../lib/html-text.mjs";
import { sourceDocument } from "../lib/source-feed.mjs";
import { loadStraatIndex } from "../lib/straatnamen.mjs";

export const SOURCE_ID = "district-foren";

// Eén ArcGIS-query: features, of een FetchError. Gedeeld met de schoolstraten.
export async function getArcgisFeatures(fetchImpl, url) {
  const response = await fetchWithTimeout(fetchImpl, url, { headers: { "user-agent": USER_AGENT, accept: "application/json" }, redirect: "error" });
  if (!response.ok) throw new FetchError(`http_${response.status}`);
  let json;
  try {
    json = await response.json();
  } catch {
    throw new FetchError("invalid_json");
  }
  if (json?.error) throw new FetchError("arcgis_error");
  if (!Array.isArray(json?.features)) throw new FetchError("invalid_payload");
  if (json.exceededTransferLimit === true) throw new FetchError("too_many_rows");
  if (!json.features.length) throw new FetchError("no_rows");
  return json.features;
}

export async function run({ fetch: fetchImpl = globalThis.fetch, clock = () => new Date(), rootDir, env = process.env, dryRun = false, log = console.log } = {}) {
  const previous = readSourceDocument(rootDir, SOURCE_ID);
  const now = clock();
  const retrievedAt = now.toISOString();
  const today = brusselsDate(now);
  let features;
  try {
    features = await getArcgisFeatures(fetchImpl, forenQueryUrl());
  } catch (error) {
    const code = errorCodeOf(error);
    log(JSON.stringify({ source: SOURCE_ID, fetchStatus: "error", errorCode: code }));
    return [keepPreviousOnError(rootDir, SOURCE_ID, previous, code, { dryRun })];
  }
  const parsed = forenItems(features, { today, streets: loadStraatIndex(rootDir) });
  features = null;
  const screened = screenItems(parsed.items.map((item) => ({ ...item, retrievedAt })));
  const counts = {
    source: SOURCE_ID,
    ...parsed.counts,
    items: screened.items.length,
    upcoming: upcomingCount(screened.items, today),
    screenedOut: screened.rejected.privacy + screened.rejected.contract + screened.rejected.duplicate,
  };
  if (!parsed.counts.district) {
    // Geen enkele foor in het district is eerder een andere laag of veldnaam dan een leeg jaar.
    log(JSON.stringify({ ...counts, fetchStatus: "error", errorCode: "no_district_rows" }));
    return [keepPreviousOnError(rootDir, SOURCE_ID, previous, "no_district_rows", { dryRun })];
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
