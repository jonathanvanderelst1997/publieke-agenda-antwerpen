// Haalt de openbare markten van stad Antwerpen op uit GIPOD (Digitaal Vlaanderen, open data zonder
// sleutel) en verrijkt ze met district en postcode uit de marktlijst van geodata.antwerpen.be.
// Eén GIPOD-verzoek en, optioneel, één verzoek voor de marktlijst: faalt die tweede, dan gaan de markten
// zonder postcode door (inDistrict komt altijd uit de coördinaten en de officiële districtsgrens).
// Per markt alleen de eerstvolgende marktdag. Licentie: Modellicentie Gratis Hergebruik v1.0.
// Schrijft site/sources/stad-markten.json.
//
//   node scripts/fetch-sources-markten.mjs [--dry-run]
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FetchError, USER_AGENT, errorCodeOf, fetchWithTimeout, guardShrink, isMainModule, keepPreviousOnError, readSourceDocument, screenItems, statusEntry, suspiciousDrop, upcomingCount, writeSourceDocument } from "../lib/fetch-util.mjs";
import { gipodQueryUrl, marketListQueryUrl, marketsFromGipod, parseMarketList } from "../lib/gipod-markets.mjs";
import { brusselsDate } from "../lib/html-text.mjs";
import { sourceDocument } from "../lib/source-feed.mjs";

export const SOURCE_ID = "stad-markten";
export const REQUEST_GAP_MS = 2_000;

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(fetchImpl, url, accept) {
  const response = await fetchWithTimeout(fetchImpl, url, { headers: { "user-agent": USER_AGENT, accept }, redirect: "error" });
  if (!response.ok) throw new FetchError(`http_${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new FetchError("invalid_json");
  }
}

export async function run({ fetch: fetchImpl = globalThis.fetch, clock = () => new Date(), rootDir, env = process.env, dryRun = false, log = console.log, sleep = realSleep } = {}) {
  const previous = readSourceDocument(rootDir, SOURCE_ID);
  const now = clock();
  const retrievedAt = now.toISOString();
  const today = brusselsDate(now);
  let geojson;
  try {
    geojson = await getJson(fetchImpl, gipodQueryUrl(now), "application/geo+json, application/json");
    if (!Array.isArray(geojson?.features)) throw new FetchError("invalid_payload");
    // De stad heeft elke week markten; een leeg antwoord is een storing.
    if (!geojson.features.length) throw new FetchError("no_markets");
  } catch (error) {
    const code = errorCodeOf(error);
    log(JSON.stringify({ source: SOURCE_ID, fetchStatus: "error", errorCode: code }));
    return [keepPreviousOnError(rootDir, SOURCE_ID, previous, code, { dryRun })];
  }

  let marketList = null;
  let marketListStatus = "ok";
  try {
    await sleep(REQUEST_GAP_MS);
    marketList = parseMarketList(await getJson(fetchImpl, marketListQueryUrl(), "application/json"));
    if (!marketList.size) {
      marketList = null;
      marketListStatus = "empty";
    }
  } catch (error) {
    marketListStatus = errorCodeOf(error);
  }

  const parsed = marketsFromGipod(geojson, { now, marketList });
  geojson = null;
  const screened = screenItems(parsed.items.map((item) => ({ ...item, retrievedAt })));
  const counts = {
    source: SOURCE_ID,
    rows: parsed.counts.rows,
    markets: parsed.counts.markets,
    marketList: marketListStatus,
    conflicts: parsed.counts.conflicts,
    rejected: parsed.counts.rejected,
    items: screened.items.length,
    inDistrict: screened.items.filter((item) => item.inDistrict === true).length,
    upcoming: upcomingCount(screened.items, today),
    screenedOut: screened.rejected.privacy + screened.rejected.contract + screened.rejected.duplicate,
  };
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
