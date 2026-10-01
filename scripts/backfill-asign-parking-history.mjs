import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  HISTORY_BACKFILL_INDEX_FILE,
  HISTORY_BACKFILL_SCHEMA_VERSION,
  historyBackfillRecordsDigest,
  historyBackfillShardFile,
  historyBackfillSnapshotDigest,
  sourceHistoryRecord,
  validateHistoryBackfillIndex,
  validateHistoryBackfillShard,
} from "../lib/history-backfill.mjs";
import { applyPublicSpaceStreetResolution, buildStreetIndex } from "../lib/street-resolver.mjs";
import { asignLayer } from "./refresh-live-history.mjs";
import { normalizeParking, PUBLIC_PARKING_STATUSES } from "../site/public-space-core.js";
import { fetchStreetFeatures } from "../site/street-source.js";

export const ASIGN_PARKING_BACKFILL_SOURCE_ID = "asign-parking";
export const ASIGN_PARKING_BACKFILL_COVERAGE_FROM = "2019-09-16";
export const ASIGN_PARKING_SOURCE_URL = "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/20";

const OUT_FIELDS = "Dossiernummer,Locatienummer,Status,Adres,Reden,Startdatum,Einddatum,EnkelWeekdagen,GipodID,District";
const attrs = (feature) => feature?.attributes || feature?.properties || feature || {};
const toDay = (value) => {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null;
};
const dayBefore = (day) => new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const yearStart = (year) => `${year}-01-01`;

const sourceContract = (coverageTo, shards) => ({
  sourceId: ASIGN_PARKING_BACKFILL_SOURCE_ID,
  completeness: "full",
  coverageFrom: ASIGN_PARKING_BACKFILL_COVERAGE_FROM,
  coverageTo,
  sourceUrl: ASIGN_PARKING_SOURCE_URL,
  evidence: "De officiële A-Sign laagbeschrijving noemt parkeerverbod_lijn expliciet de volledige historiek van alle tijdelijke parkeerverboden.",
  dedupeKey: "Dossiernummer|Locatienummer",
  snapshotDigest: historyBackfillSnapshotDigest(shards),
  shards,
});

function historicalParkingItem(feature, streetIndex, baselineDay) {
  const row = attrs(feature);
  const normalized = normalizeParking(row);
  if (!normalized.key || !normalized.start || !normalized.end) throw new Error("historical_parking_record_incomplete");
  if (!PUBLIC_PARKING_STATUSES.has(normalized.status)) {
    throw new Error(`historical_status_unclassified:${normalized.status || "leeg"}`);
  }
  const validFrom = toDay(normalized.start);
  const validTo = toDay(normalized.end);
  if (!validFrom || !validTo) throw new Error("historical_parking_dates_invalid");
  if (validFrom < ASIGN_PARKING_BACKFILL_COVERAGE_FROM) throw new Error("historical_record_before_proven_coverage");
  if (validTo >= baselineDay) throw new Error("historical_record_crosses_baseline");

  const weekdays = /^(ja|true|1)$/i.test(String(row.EnkelWeekdagen ?? "").trim());
  const item = {
    id: `parking:${normalized.key}`,
    kind: "parking",
    kindLabel: "Parkeerverbod",
    title: normalized.reason || "Tijdelijk parkeerverbod",
    location: normalized.address,
    start: normalized.start,
    end: normalized.end,
    status: normalized.status,
    reference: normalized.dossier,
    detail: weekdays ? "Alleen op weekdagen" : "",
    sourceLabel: "A-Sign parkeerverboden",
    sourceUrl: ASIGN_PARKING_SOURCE_URL,
  };
  return { item: applyPublicSpaceStreetResolution([item], streetIndex)[0], validFrom, validTo };
}

async function streetIndex(fetchImpl) {
  const features = await fetchStreetFeatures({ fetchImpl });
  const index = buildStreetIndex(features);
  if (!index.segments.length) throw new Error("historical_street_axis_empty");
  return index;
}

async function recordsForYear({ year, baselineDay, fetchImpl, streetIndex: index }) {
  const lower = year === 2019 ? ASIGN_PARKING_BACKFILL_COVERAGE_FROM : yearStart(year);
  const upper = year === Number(baselineDay.slice(0, 4)) ? baselineDay : yearStart(year + 1);
  if (lower >= upper) return [];
  const features = await asignLayer(20, {
    where: `District='ANTWERPEN' AND Startdatum >= DATE '${lower}' AND Startdatum < DATE '${upper}' AND Einddatum < DATE '${baselineDay}'`,
    outFields: OUT_FIELDS,
  }, fetchImpl);

  const records = new Map();
  for (const feature of features) {
    const { item, validFrom, validTo } = historicalParkingItem(feature, index, baselineDay);
    const record = sourceHistoryRecord({
      sourceId: ASIGN_PARKING_BACKFILL_SOURCE_ID,
      sourceRecordId: item.id.slice("parking:".length),
      validFrom,
      validTo,
      payload: item,
    });
    const previous = records.get(record.sourceRecordId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(record)) {
      throw new Error(`historical_duplicate_conflict:${record.sourceRecordId}`);
    }
    records.set(record.sourceRecordId, record);
  }
  return [...records.values()].sort((a, b) => a.sourceRecordId.localeCompare(b.sourceRecordId));
}

function readJson(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

function writeImmutableShard(rootDir, file, document) {
  const target = path.join(rootDir, file);
  const text = `${JSON.stringify(document, null, 2)}\n`;
  if (fs.existsSync(target)) {
    const existing = fs.readFileSync(target, "utf8");
    if (existing !== text) throw new Error(`historical_shard_changed:${file}`);
    return false;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text, "utf8");
  return true;
}

export async function buildAsignParkingBackfill({
  fetch: fetchImpl = globalThis.fetch,
  rootDir,
  clock = () => new Date(),
  streetIndex: suppliedStreetIndex,
  write = false,
} = {}) {
  if (!rootDir) throw new Error("historical_root_required");
  const archiveIndex = readJson(path.join(rootDir, "site/history/archive/index.json"));
  const baselineDay = String(archiveIndex?.baselineInitializedAt || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(baselineDay)) throw new Error("historical_baseline_missing");
  if (baselineDay <= ASIGN_PARKING_BACKFILL_COVERAGE_FROM) throw new Error("historical_baseline_before_coverage");

  const index = suppliedStreetIndex || await streetIndex(fetchImpl);
  const beforeCoverage = await asignLayer(20, {
    where: `District='ANTWERPEN' AND Startdatum < DATE '${ASIGN_PARKING_BACKFILL_COVERAGE_FROM}'`,
    outFields: "Dossiernummer,Locatienummer,Status,Startdatum,Einddatum,District",
  }, fetchImpl);
  if (beforeCoverage.length) throw new Error("historical_record_before_proven_coverage");

  const firstYear = Number(ASIGN_PARKING_BACKFILL_COVERAGE_FROM.slice(0, 4));
  const lastYear = Number(baselineDay.slice(0, 4));
  const shards = [];
  const documents = new Map();
  for (let year = firstYear; year <= lastYear; year += 1) {
    const records = await recordsForYear({ year, baselineDay, fetchImpl, streetIndex: index });
    if (!records.length) continue;
    const document = { schemaVersion: HISTORY_BACKFILL_SCHEMA_VERSION, sourceId: ASIGN_PARKING_BACKFILL_SOURCE_ID, year, records };
    const errors = validateHistoryBackfillShard(document);
    if (errors.length) throw new Error(`historical_shard_invalid:${errors[0]}`);
    const file = historyBackfillShardFile(ASIGN_PARKING_BACKFILL_SOURCE_ID, year);
    const digest = historyBackfillRecordsDigest(records);
    documents.set(file, document);
    shards.push({ year, file, count: records.length, digest });
  }
  if (!shards.length) throw new Error("historical_backfill_empty");

  const coverageTo = dayBefore(baselineDay);
  const source = sourceContract(coverageTo, shards);
  const existingIndexPath = path.join(rootDir, HISTORY_BACKFILL_INDEX_FILE);
  const previousIndex = readJson(existingIndexPath);
  const previousSources = Array.isArray(previousIndex?.sources) ? previousIndex.sources : [];
  const sources = [
    ...previousSources.filter((entry) => entry?.sourceId !== ASIGN_PARKING_BACKFILL_SOURCE_ID),
    source,
  ].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  const outputIndex = { schemaVersion: HISTORY_BACKFILL_SCHEMA_VERSION, generatedAt: clock().toISOString(), sources };
  const indexErrors = validateHistoryBackfillIndex(outputIndex);
  if (indexErrors.length) throw new Error(`historical_index_invalid:${indexErrors[0]}`);

  let written = 0;
  if (write) {
    for (const [file, document] of documents) if (writeImmutableShard(rootDir, file, document)) written += 1;
    const previousSource = previousSources.find((entry) => entry?.sourceId === ASIGN_PARKING_BACKFILL_SOURCE_ID);
    if (!previousSource || JSON.stringify(previousSource) !== JSON.stringify(source)) {
      fs.mkdirSync(path.dirname(existingIndexPath), { recursive: true });
      fs.writeFileSync(existingIndexPath, `${JSON.stringify(outputIndex, null, 2)}\n`, "utf8");
    }
  }

  return Object.freeze({
    sourceId: ASIGN_PARKING_BACKFILL_SOURCE_ID,
    baselineDay,
    coverageFrom: ASIGN_PARKING_BACKFILL_COVERAGE_FROM,
    coverageTo,
    records: shards.reduce((sum, shard) => sum + shard.count, 0),
    shards,
    snapshotDigest: source.snapshotDigest,
    write,
    written,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  buildAsignParkingBackfill({ rootDir, write: process.argv.includes("--write") })
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error?.message || String(error));
      process.exitCode = 1;
    });
}
