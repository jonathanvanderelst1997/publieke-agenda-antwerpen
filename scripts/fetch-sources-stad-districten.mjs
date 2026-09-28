// Leest de publieke nieuwskanalen van de 9 andere districten (lib/district-channels.mjs) en haalt er
// alleen ondubbelzinnige data uit: dezelfde regels als het districtsnieuws, plus een tabel met één
// activiteit per rij en één blok "Titel + datum". Zonder plaats in het artikel wordt de plaats
// "District X, locatie via de officiële bron" met de postcode van dat district.
// De kanaalresponsen bevatten personeelsvelden (creator, assignee, lockOwner) en e-mailadressen van
// derden: ze worden alleen in het geheugen gelezen en nooit bewaard. Afbeeldingen worden nooit
// overgenomen. Schrijft site/sources/stad-districten.json.
//
// Eén GET per kanaal, 3 seconden ertussen. Faalt één kanaal, dan blijven alleen de vorige items van
// dat kanaal staan en is de bron "error". Gezond is: elk kanaal antwoordde met minstens één artikel.
// Geen krimpgrens op het aantal items: nul komende activiteiten is hier normaal.
//
//   node scripts/fetch-sources-stad-districten.mjs [--dry-run]
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DISTRICT_CHANNELS, channelApiUrl, fallbackLocationFor } from "../lib/district-channels.mjs";
import { parseDistrictNewsArticle } from "../lib/district-news-parser.mjs";
import { FetchError, USER_AGENT, errorCodeOf, fetchWithTimeout, isMainModule, keepPreviousOnError, readSourceDocument, screenItems, statusEntry, upcomingCount, writeSourceDocument } from "../lib/fetch-util.mjs";
import { brusselsDate } from "../lib/html-text.mjs";
import { isDistrictPostcode } from "../lib/postcodes.mjs";
import { sourceDocument } from "../lib/source-feed.mjs";

export const SOURCE_ID = "stad-districten";
export const ID_PREFIX = "stad-news-";
export const CHANNEL_GAP_MS = 3_000;
// Een artikel dat in meer dan één districtskanaal staat, gaat over de hele stad.
const CITY_WIDE_FALLBACK = Object.freeze({ location: "Stad Antwerpen, locatie via de officiële bron", postcodes: Object.freeze([]) });

export function channelIdPrefix(channelEntry) {
  return `${ID_PREFIX}${channelEntry.key}-`;
}

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchChannel(fetchImpl, channelEntry) {
  const response = await fetchWithTimeout(fetchImpl, channelApiUrl(channelEntry.channelId), {
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
  // Een districtskanaal is nooit leeg; een lege lijst is een storing, geen nieuws.
  if (!body.data.length) throw new FetchError("no_articles");
  return body.data;
}

// Alleen de velden die de parser nodig heeft; personeelsvelden en afbeeldingen vallen hier al weg.
function articleFields(article) {
  return {
    id: article?.id,
    uuid: article?.uuid,
    slug: article?.slug,
    title: article?.title,
    publishedAt: article?.publishedAt,
    date: article?.date,
    publishUntil: article?.publishUntil,
    snippets: (Array.isArray(article?.snippets) ? article.snippets : [])
      .filter((snippet) => snippet?.type === "wysiwyg" || snippet?.type === "table")
      .map((snippet) => ({ type: snippet.type, body: snippet.body })),
  };
}

function articleKey(article) {
  return String(article?.id ?? article?.uuid ?? "").toLowerCase();
}

export async function run({ fetch: fetchImpl = globalThis.fetch, clock = () => new Date(), rootDir, dryRun = false, log = console.log, sleep = realSleep } = {}) {
  const previous = readSourceDocument(rootDir, SOURCE_ID);
  const now = clock();
  const retrievedAt = now.toISOString();
  const today = brusselsDate(now);

  // 1. Ophalen: één GET per kanaal, met een pauze ertussen.
  const responses = [];
  for (const [index, channelEntry] of DISTRICT_CHANNELS.entries()) {
    if (index > 0) await sleep(CHANNEL_GAP_MS);
    try {
      responses.push({ channelEntry, articles: (await fetchChannel(fetchImpl, channelEntry)).map(articleFields) });
    } catch (error) {
      responses.push({ channelEntry, errorCode: errorCodeOf(error) });
    }
  }
  const failed = responses.filter((response) => response.errorCode);
  if (failed.length === responses.length) {
    const code = `channel_${failed[0].errorCode}`.slice(0, 60);
    log(JSON.stringify({ source: SOURCE_ID, fetchStatus: "error", errorCode: code, channelsFailed: failed.length }));
    return [keepPreviousOnError(rootDir, SOURCE_ID, previous, code, { dryRun })];
  }

  // 2. Van een kanaal dat faalde, blijven alleen zijn eigen vorige items staan.
  const kept = [];
  for (const { channelEntry } of failed) {
    kept.push(...(previous?.items ?? []).filter((item) => item.id.startsWith(channelIdPrefix(channelEntry))));
  }
  const seen = new Set(kept.map((item) => item.externalId));
  const channelsPerArticle = new Map();
  for (const { articles = [] } of responses) {
    for (const article of articles) channelsPerArticle.set(articleKey(article), (channelsPerArticle.get(articleKey(article)) ?? 0) + 1);
  }

  // 3. Lezen, in de vaste volgorde van de kanalen; een gedeeld artikel telt één keer.
  const reasons = {};
  const collected = [];
  let articleCount = 0;
  let reviewRequired = 0;
  let droppedOutsideWindow = 0;
  for (const response of responses) {
    if (response.errorCode) continue;
    const { channelEntry } = response;
    for (const article of response.articles) {
      const key = articleKey(article);
      if (seen.has(key)) continue;
      seen.add(key);
      articleCount += 1;
      const cityWide = (channelsPerArticle.get(key) ?? 0) > 1;
      const result = parseDistrictNewsArticle(article, {
        today,
        idPrefix: channelIdPrefix(channelEntry),
        fallbackLocation: cityWide ? CITY_WIDE_FALLBACK : fallbackLocationFor(channelEntry),
        activityTables: true,
        singleBlock: true,
        skipWorks: true,
      });
      droppedOutsideWindow += result.dropped ?? 0;
      reviewRequired += result.reviewItems.length;
      if (result.reason) reasons[result.reason] = (reasons[result.reason] ?? 0) + 1;
      for (const item of result.items) {
        const inDistrict = item.postcodes.length ? item.postcodes.every(isDistrictPostcode) : cityWide ? undefined : false;
        collected.push({ ...item, retrievedAt, ...(inDistrict === undefined ? {} : { inDistrict }) });
      }
    }
    response.articles = null; // niets van de kanaalrespons blijft bewaard
  }

  // Wat al voorbij is, blijft niet staan: zonder krimpgrens heeft deze bron er niets aan.
  const current = [...collected, ...kept].filter((item) => (item.endDate ?? item.date) >= today);
  const droppedPast = collected.length + kept.length - current.length;
  const screened = screenItems(current);
  const fetchStatus = failed.length ? "error" : "ok";
  const errorCode = failed.length ? `channel_${failed[0].errorCode}`.slice(0, 60) : null;
  const counts = {
    source: SOURCE_ID,
    channels: responses.length,
    channelsFailed: failed.map((response) => `${response.channelEntry.key}:${response.errorCode}`),
    articles: articleCount,
    items: screened.items.length,
    keptFromFailedChannels: kept.length,
    upcoming: upcomingCount(screened.items, today),
    reviewRequired: reviewRequired + screened.rejected.privacy + screened.rejected.contract,
    droppedOutsideWindow,
    droppedPast,
    reasons,
  };
  if (dryRun) {
    log(JSON.stringify({ dryRun: true, ...counts, fetchStatus, errorCode }));
    return [statusEntry(SOURCE_ID, { fetchStatus, retrievedAt, itemCount: screened.items.length, errorCode })];
  }
  const document = writeSourceDocument(rootDir, SOURCE_ID, sourceDocument(SOURCE_ID, { retrievedAt, fetchStatus, contentVersion: null, items: screened.items }));
  log(JSON.stringify({ ...counts, fetchStatus, errorCode, written: document.items.length }));
  return [statusEntry(SOURCE_ID, { fetchStatus, retrievedAt, itemCount: document.items.length, errorCode })];
}

if (isMainModule(import.meta.url)) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  run({ rootDir, dryRun: process.argv.includes("--dry-run") }).catch((error) => {
    console.error(JSON.stringify({ source: SOURCE_ID, fatal: errorCodeOf(error) }));
    process.exitCode = 1;
  });
}
