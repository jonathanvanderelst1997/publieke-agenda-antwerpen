// Haalt de schoolstraten op uit de stadslaag portal_publiek10/MapServer/986 en schrijft
// site/sources/district-schoolstraten.json: per schoolstraat in district Antwerpen een punt voor de
// straatfiche (het schooljaar, met venstertijden) en een agendapunt bij de start van een proef.
// Open data van de stad; geen sleutel, geen AI.
//
// Eén GET per ronde. Fouten: de vorige items blijven staan en refresh-status.json meldt de fout.
// De foren (vlak ervoor in lib/source-registry.mjs) vragen aan dezelfde host: daarom eerst een pauze
// van ARCGIS_PAUSE_MS, zodat geodata.antwerpen.be hoogstens 1 verzoek per seconde van ons krijgt.
//
//   node scripts/fetch-sources-schoolstraten.mjs [--dry-run]
import path from "node:path";
import { fileURLToPath } from "node:url";

import { errorCodeOf, guardShrink, isMainModule, keepPreviousOnError, readSourceDocument, screenItems, statusEntry, suspiciousDrop, upcomingCount, writeSourceDocument } from "../lib/fetch-util.mjs";
import { brusselsDate } from "../lib/html-text.mjs";
import { schoolstraatItems, schoolstratenQueryUrl } from "../lib/schoolstraten.mjs";
import { sourceDocument } from "../lib/source-feed.mjs";
import { loadStraatIndex } from "../lib/straatnamen.mjs";
import { getArcgisFeatures } from "./fetch-sources-foren.mjs";

export const SOURCE_ID = "district-schoolstraten";
export const ARCGIS_PAUSE_MS = 1_000;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function run({ fetch: fetchImpl = globalThis.fetch, clock = () => new Date(), rootDir, env = process.env, dryRun = false, log = console.log, sleep = defaultSleep } = {}) {
  const previous = readSourceDocument(rootDir, SOURCE_ID);
  const now = clock();
  const retrievedAt = now.toISOString();
  const today = brusselsDate(now);
  let features;
  try {
    await sleep(ARCGIS_PAUSE_MS);
    features = await getArcgisFeatures(fetchImpl, schoolstratenQueryUrl());
  } catch (error) {
    const code = errorCodeOf(error);
    log(JSON.stringify({ source: SOURCE_ID, fetchStatus: "error", errorCode: code }));
    return [keepPreviousOnError(rootDir, SOURCE_ID, previous, code, { dryRun })];
  }
  const parsed = schoolstraatItems(features, { today, streets: loadStraatIndex(rootDir) });
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
