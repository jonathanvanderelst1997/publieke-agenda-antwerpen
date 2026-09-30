// Haalt de openbare markten van stad Antwerpen op uit GIPOD (Digitaal Vlaanderen, open data zonder
// sleutel) en verrijkt ze met district en postcode uit de marktlijst van geodata.antwerpen.be.
// GIPOD wordt over het volledige jaarvenster gepagineerd; daarnaast is er optioneel één verzoek voor de
// marktlijst. Faalt die tweede, dan gaan de markten zonder postcode door. Alle officieel bekende
// marktdagen in het venster worden bewaard. Licentie: Modellicentie Gratis Hergebruik v1.0.
// Schrijft site/sources/stad-markten.json.
//
//   node scripts/fetch-sources-markten.mjs [--dry-run]
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FetchError, USER_AGENT, errorCodeOf, fetchWithTimeout, guardShrink, isMainModule, keepPreviousOnError, readSourceDocument, screenItems, statusEntry, suspiciousDrop, upcomingCount, writeSourceDocument } from "../lib/fetch-util.mjs";
import { GIPOD_ITEMS_URL, gipodQueryUrl, marketListQueryUrl, marketsFromGipod, parseMarketList } from "../lib/gipod-markets.mjs";
import { brusselsDate } from "../lib/html-text.mjs";
import { maxItemsFor, sourceDocument } from "../lib/source-feed.mjs";

export const SOURCE_ID = "stad-markten";
export const REQUEST_GAP_MS = 2_000;
export const MAX_GIPOD_PAGES = 20;

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

export async function fetchGipodMarkets(fetchImpl, now) {
  const features = [], seen = new Set();
  let url = gipodQueryUrl(now), pages = 0;
  const expected = new URL(GIPOD_ITEMS_URL);
  while (url && pages < MAX_GIPOD_PAGES) {
    const current = new URL(url);
    if (current.origin !== expected.origin || current.pathname !== expected.pathname || seen.has(url)) throw new FetchError("unexpected_pagination");
    seen.add(url);
    const data = await getJson(fetchImpl, url, "application/geo+json, application/json");
    if (!Array.isArray(data?.features)) throw new FetchError("invalid_payload");
    features.push(...data.features); pages += 1;
    const next = (data.links ?? []).filter((link) => link?.rel === "next" && link?.href);
    if (next.length > 1) throw new FetchError("duplicate_next");
    url = next[0]?.href ?? "";
  }
  if (url) throw new FetchError("pagination_limit");
  if (!features.length) throw new FetchError("no_markets");
  return { type: "FeatureCollection", features, links: [], pages };
}

export async function run({ fetch: fetchImpl = globalThis.fetch, clock = () => new Date(), rootDir, env = process.env, dryRun = false, log = console.log, sleep = realSleep } = {}) {
  const previous = readSourceDocument(rootDir, SOURCE_ID);
  const now = clock();
  const retrievedAt = now.toISOString();
  const today = brusselsDate(now);
  let geojson;
  try {
    geojson = await fetchGipodMarkets(fetchImpl, now);
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
  const pages = geojson.pages;
  geojson = null;
  const screened = screenItems(parsed.items.map((item) => ({ ...item, retrievedAt })));
  if (screened.items.length > maxItemsFor(SOURCE_ID)) {
    const errorCode = "market_item_limit";
    log(JSON.stringify({ source: SOURCE_ID, fetchStatus: "error", errorCode, candidates: screened.items.length, pages }));
    return [keepPreviousOnError(rootDir, SOURCE_ID, previous, errorCode, { dryRun })];
  }
  const counts = {
    source: SOURCE_ID,
    rows: parsed.counts.rows,
    markets: parsed.counts.markets,
    marketSeries: parsed.counts.series,
    pages,
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
