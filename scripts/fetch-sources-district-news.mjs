// Leest het publieke nieuwskanaal van district Antwerpen en haalt er alleen ondubbelzinnige data uit
// (tabel met datum/uur/locatie, of een regel "Wanneer:", "Datum:" of een blok "Praktisch").
// De kanaalrespons bevat personeelsnamen en e-mailadressen van derden: ze wordt alleen in het
// geheugen gelezen en nooit bewaard. Schrijft site/sources/district-nieuws.json.
//
//   node scripts/fetch-sources-district-news.mjs [--dry-run]
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DISTRICT_NEWS_CHANNEL_ID, parseDistrictNewsArticle } from "../lib/district-news-parser.mjs";
import { FetchError, USER_AGENT, errorCodeOf, fetchWithTimeout, isMainModule, keepPreviousOnError, readSourceDocument, screenItems, statusEntry, upcomingCount, writeSourceDocument } from "../lib/fetch-util.mjs";
import { brusselsDate } from "../lib/html-text.mjs";
import { sourceDocument } from "../lib/source-feed.mjs";

export const SOURCE_ID = "district-nieuws";
export const DISTRICT_NEWS_URL = `https://www.antwerpen.be/api/portaal/channel/${DISTRICT_NEWS_CHANNEL_ID}?contentType=10&start=0&limit=25`;

export async function run({ fetch: fetchImpl = globalThis.fetch, clock = () => new Date(), rootDir, dryRun = false, log = console.log } = {}) {
  const previous = readSourceDocument(rootDir, SOURCE_ID);
  const now = clock();
  const retrievedAt = now.toISOString();
  const today = brusselsDate(now);
  let articles;
  try {
    const response = await fetchWithTimeout(fetchImpl, DISTRICT_NEWS_URL, {
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
    articles = body.data;
  } catch (error) {
    const code = errorCodeOf(error);
    log(JSON.stringify({ source: SOURCE_ID, fetchStatus: "error", errorCode: code }));
    return [keepPreviousOnError(rootDir, SOURCE_ID, previous, code, { dryRun })];
  }

  const articleCount = articles.length;
  const reasons = {};
  const collected = [];
  let reviewRequired = 0;
  let droppedOutsideWindow = 0;
  for (const article of articles) {
    const result = parseDistrictNewsArticle(article, { today });
    droppedOutsideWindow += result.dropped ?? 0;
    reviewRequired += result.reviewItems.length;
    if (result.reason) reasons[result.reason] = (reasons[result.reason] ?? 0) + 1;
    collected.push(...result.items.map((item) => ({ ...item, retrievedAt })));
  }
  articles = null; // niets van de kanaalrespons blijft bewaard
  const screened = screenItems(collected);
  const counts = {
    source: SOURCE_ID,
    articles: articleCount,
    items: screened.items.length,
    upcoming: upcomingCount(screened.items, today),
    reviewRequired: reviewRequired + screened.rejected.privacy + screened.rejected.contract,
    droppedOutsideWindow,
    reasons,
  };
  if (dryRun) {
    log(JSON.stringify({ dryRun: true, ...counts }));
    return [statusEntry(SOURCE_ID, { fetchStatus: "ok", retrievedAt, itemCount: screened.items.length })];
  }
  const document = writeSourceDocument(
    rootDir,
    SOURCE_ID,
    sourceDocument(SOURCE_ID, { retrievedAt, fetchStatus: "ok", contentVersion: null, items: screened.items })
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
