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
import { itemVoorHistoriek, parkeerverbodInDistrict } from "../lib/historiek-privacy.mjs";
import { asignHistoryLayer as asignLayer } from "../lib/asign-history-fetch.mjs";
import { DISTRICT_POSTCODES, normalizeParking, PUBLIC_PARKING_STATUSES } from "../site/public-space-core.js";
import { PARKEERVERBOD_TITEL, publiekParkeerAdres } from "../site/adres-privacy.js";
import { fetchStreetFeatures } from "../site/street-source.js";

export const ASIGN_PARKING_BACKFILL_SOURCE_ID = "asign-parking";
export const ASIGN_PARKING_BACKFILL_COVERAGE_FROM = "2019-09-16";
export const ASIGN_PARKING_SOURCE_URL = "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/20";

// Zonder Reden: de historiek bewaart nooit waarom er een parkeerverbod is (site/adres-privacy.js).
const OUT_FIELDS = "Dossiernummer,Locatienummer,Status,Adres,Postcode,Startdatum,Einddatum,EnkelWeekdagen,GipodID,District";
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
  if (String(row.District ?? "").trim() !== "ANTWERPEN") throw new Error("historical_district_mismatch");
  for (const field of ["Startdatum", "Einddatum"]) {
    if (row[field] === null || row[field] === undefined || row[field] === ""
      || !Number.isFinite(Number(row[field]))) throw new Error("historical_parking_dates_invalid");
  }
  const straatnamen = streetIndex?.byName instanceof Map
    ? [...new Set([...streetIndex.byName.values()].flat().map((ref) => ref?.name).filter((name) => typeof name === "string" && name))]
    : [];
  const normalized = normalizeParking(row, { straatnamen });
  if (!normalized.key || !normalized.start || !normalized.end) throw new Error("historical_parking_record_incomplete");
  if (!PUBLIC_PARKING_STATUSES.has(normalized.status)) throw new Error("historical_status_unclassified");
  const validFrom = toDay(normalized.start);
  const validTo = toDay(normalized.end);
  if (!validFrom || !validTo || validFrom > validTo) throw new Error("historical_parking_dates_invalid");
  if (validFrom < ASIGN_PARKING_BACKFILL_COVERAGE_FROM) throw new Error("historical_record_before_proven_coverage");
  if (validTo >= baselineDay) throw new Error("historical_record_crosses_baseline");
  const location = publiekParkeerAdres(row.Adres, normalized.address, straatnamen) || normalized.address;
  const weekdays = /^(ja|true|1)$/i.test(String(row.EnkelWeekdagen ?? "").trim());
  const item = {
    id: "parking:" + normalized.key, kind: "parking", kindLabel: "Parkeerverbod",
    title: PARKEERVERBOD_TITEL, location, start: normalized.start, end: normalized.end,
    status: normalized.status, reference: normalized.dossier,
    detail: weekdays ? "Alleen op weekdagen" : "",
    sourceLabel: "A-Sign parkeerverboden", sourceUrl: ASIGN_PARKING_SOURCE_URL
  };
  return { item: applyPublicSpaceStreetResolution([item], streetIndex)[0], validFrom, validTo, postcode: normalized.postcode };
}

async function streetIndex(fetchImpl) {
  const features = await fetchStreetFeatures({ fetchImpl });
  const index = buildStreetIndex(features);
  if (!index.segments.length) throw new Error("historical_street_axis_empty");
  return index;
}

const monthStart = (year, month) => year + "-" + String(month).padStart(2, "0") + "-01";
const nextMonthStart = (year, month) => month === 12 ? yearStart(year + 1) : monthStart(year, month + 1);
async function countBeforeCoverage(fetchImpl) {
  const url = new URL(ASIGN_PARKING_SOURCE_URL + "/query");
  url.search = new URLSearchParams({
    f: "json",
    where: "District='ANTWERPEN' AND Startdatum < DATE '" + ASIGN_PARKING_BACKFILL_COVERAGE_FROM + "'",
    returnCountOnly: "true", returnGeometry: "false",
  });
  const response = await fetchImpl(url, {
    headers: { Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("historical_count_request_failed");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("historical_count_invalid");
  const chunks = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 32768) { await reader.cancel(); throw new Error("historical_count_response_too_large"); }
    chunks.push(value);
  }
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("historical_count_invalid"); }
  if (data?.error || data?.exceededTransferLimit === true
    || !Number.isSafeInteger(data?.count) || data.count < 0) throw new Error("historical_count_invalid");
  return data.count;
}
async function recordsForYear({ year, baselineDay, fetchImpl, streetIndex: index, month = null }) {
  const firstYear = Number(ASIGN_PARKING_BACKFILL_COVERAGE_FROM.slice(0, 4));
  const lower = year === firstYear ? ASIGN_PARKING_BACKFILL_COVERAGE_FROM : yearStart(year);
  const upper = year === Number(baselineDay.slice(0, 4)) ? baselineDay : yearStart(year + 1);
  if (lower >= upper) return [];
  const months = month === null ? Array.from({ length: 12 }, (_, i) => i + 1) : [month];
  const records = new Map();
  for (const selectedMonth of months) {
    const rangeStart = [lower, monthStart(year, selectedMonth)].sort().at(-1);
    const rangeEnd = [upper, nextMonthStart(year, selectedMonth)].sort()[0];
    if (rangeStart >= rangeEnd) continue;
    const features = await asignLayer(20, {
      where: "District='ANTWERPEN' AND Startdatum >= DATE '" + rangeStart
        + "' AND Startdatum < DATE '" + rangeEnd + "' AND Einddatum < DATE '" + baselineDay + "'",
      outFields: OUT_FIELDS,
    }, fetchImpl);
    for (const feature of features) {
      const { item, validFrom, validTo, postcode } = historicalParkingItem(feature, index, baselineDay);
      if (validFrom < rangeStart || validFrom >= rangeEnd) throw new Error("historical_record_outside_query");
      if (parkeerverbodInDistrict(item) !== true) {
        if (postcode && !DISTRICT_POSTCODES.includes(postcode)) continue;
        throw new Error("historical_district_unresolved");
      }
      const record = sourceHistoryRecord({
        sourceId: ASIGN_PARKING_BACKFILL_SOURCE_ID, sourceRecordId: item.id.slice("parking:".length),
        validFrom, validTo, payload: itemVoorHistoriek(item),
      });
      const previous = records.get(record.sourceRecordId);
      if (previous && JSON.stringify(previous) !== JSON.stringify(record)) throw new Error("historical_duplicate_conflict");
      records.set(record.sourceRecordId, record);
    }
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
  month = null,
} = {}) {
  if (!rootDir) throw new Error("historical_root_required");
  const archiveIndex = readJson(path.join(rootDir, "site/history/archive/index.json"));
  const baselineDay = String(archiveIndex?.baselineInitializedAt || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(baselineDay)) throw new Error("historical_baseline_missing");
  if (baselineDay <= ASIGN_PARKING_BACKFILL_COVERAGE_FROM) throw new Error("historical_baseline_before_coverage");

  let selected = null;
  if (month !== null) {
    if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("historical_month_invalid");
    if (write) throw new Error("historical_month_write_forbidden");
    const year = Number(month.slice(0, 4)), selectedMonth = Number(month.slice(5, 7));
    const from = [ASIGN_PARKING_BACKFILL_COVERAGE_FROM, monthStart(year, selectedMonth)].sort().at(-1);
    const until = [baselineDay, nextMonthStart(year, selectedMonth)].sort()[0];
    if (from >= until) throw new Error("historical_month_outside_coverage");
    selected = { year, month: selectedMonth, from, until };
  }
  const index = suppliedStreetIndex || await streetIndex(fetchImpl);
  const beforeCoverageCount = await countBeforeCoverage(fetchImpl);
  // Oudere bronrecords worden geteld, maar vallen buiten de gekozen importdekking.
  if (selected) {
    const records = await recordsForYear({
      year: selected.year, month: selected.month, baselineDay, fetchImpl, streetIndex: index,
    });
    const errors = validateHistoryBackfillShard({
      schemaVersion: HISTORY_BACKFILL_SCHEMA_VERSION, sourceId: ASIGN_PARKING_BACKFILL_SOURCE_ID,
      year: selected.year, records,
    });
    if (errors.length) throw new Error("historical_shard_invalid:" + errors[0]);
    return Object.freeze({
      sourceId: ASIGN_PARKING_BACKFILL_SOURCE_ID, mode: "month-dry-run", completeness: "partial",
      month, baselineDay, selectedFrom: selected.from, selectedUntilExclusive: selected.until,
      beforeCoverageCount, records: records.length, recordsDigest: historyBackfillRecordsDigest(records),
      write: false, written: 0,
    });
  }

  const firstYear = Number(ASIGN_PARKING_BACKFILL_COVERAGE_FROM.slice(0, 4));
  const lastYear = Number(baselineDay.slice(0, 4));
  const shards = [];
  const documents = new Map();
  const sourceRecordIds = new Set();
  for (let year = firstYear; year <= lastYear; year += 1) {
    const records = await recordsForYear({ year, baselineDay, fetchImpl, streetIndex: index });
    if (!records.length) continue;
    for (const record of records) {
      if (sourceRecordIds.has(record.sourceRecordId)) throw new Error("historical_duplicate_conflict");
      sourceRecordIds.add(record.sourceRecordId);
    }
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
    beforeCoverageCount,
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
  Promise.resolve().then(() => {
    const args = process.argv.slice(2);
    const monthArgs = args.filter((arg) => arg.startsWith("--month="));
    const unknown = args.some((arg) => arg !== "--all" && arg !== "--write" && !arg.startsWith("--month="));
    if (unknown || monthArgs.length > 1 || new Set(args).size !== args.length) throw new Error("historical_cli_arguments_invalid");
    const month = monthArgs.length ? monthArgs[0].slice("--month=".length) : null;
    const all = args.includes("--all");
    if (all === (month !== null)) throw new Error("historical_scope_required_use_month_or_all");
    return buildAsignParkingBackfill({ rootDir, write: args.includes("--write"), month });
  }).then((result) => console.log(JSON.stringify(result)))
    .catch((error) => { console.error(error?.message || String(error)); process.exitCode = 1; });
}
