import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ASIGN_PARKING_BACKFILL_SOURCE,
  HISTORY_BACKFILL_DIR,
  HISTORY_BACKFILL_INDEX_FILE,
  historyBackfillDigest,
  historyBackfillShardFile,
  mergeAppendOnlyBackfillShard,
  updateHistoryBackfillIndex,
  validateHistoryBackfillIndex,
  validateHistoryBackfillShard,
} from "../lib/history-backfill.mjs";
import { buildStreetIndex, resolveAddressStreet } from "../lib/street-resolver.mjs";
import { fetchStreetFeatures } from "../site/street-source.js";
import { normalizeParking } from "../site/public-space-core.js";

const SOURCE_URL = "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/20";
const SOURCE_QUERY = `${SOURCE_URL}/query`;
const SAFE_FIELDS = "Dossiernummer,Locatienummer,Status,Adres,Reden,Startdatum,Einddatum,EnkelWeekdagen,GipodID,District";
export const ASIGN_BACKFILL_BATCH_SIZE = 100;
export const ASIGN_BACKFILL_MAX_IDS = 100_000;

const asObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

async function getJson(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`history_backfill_http_${response.status}`);
  const json = await response.json();
  if (json?.error) throw new Error("history_backfill_provider_error");
  return json;
}

async function providerContract(fetchImpl) {
  const url = new URL(SOURCE_URL);
  url.search = new URLSearchParams({ f: "pjson" });
  const metadata = await getJson(url, fetchImpl);
  const description = String(metadata.description ?? "");
  const timeInfo = asObject(metadata.timeInfo);
  const extent = Array.isArray(timeInfo.timeExtent) ? timeInfo.timeExtent : [];
  if (!/volledige historiek/i.test(description)) throw new Error("history_backfill_completeness_not_proven");
  if (timeInfo.startTimeField !== "Startdatum" || timeInfo.endTimeField !== "Einddatum") throw new Error("history_backfill_time_fields_changed");
  if (extent.length !== 2 || !extent.every(Number.isFinite)) throw new Error("history_backfill_time_extent_missing");
  return { coverageFrom: new Date(extent[0]).toISOString() };
}

async function fetchAllRows(fetchImpl) {
  const idsUrl = new URL(SOURCE_QUERY);
  idsUrl.search = new URLSearchParams({
    where: "District='ANTWERPEN'",
    f: "json",
    returnIdsOnly: "true",
  });
  const idData = await getJson(idsUrl, fetchImpl);
  const ids = Array.isArray(idData.objectIds) ? [...idData.objectIds].filter(Number.isFinite).sort((a, b) => a - b) : [];
  if (!ids.length) throw new Error("history_backfill_no_ids");
  if (ids.length > ASIGN_BACKFILL_MAX_IDS) throw new Error("history_backfill_record_limit");

  const rows = [];
  for (let offset = 0; offset < ids.length; offset += ASIGN_BACKFILL_BATCH_SIZE) {
    const url = new URL(SOURCE_QUERY);
    url.search = new URLSearchParams({
      f: "json",
      objectIds: ids.slice(offset, offset + ASIGN_BACKFILL_BATCH_SIZE).join(","),
      outFields: SAFE_FIELDS,
      returnGeometry: "false",
    });
    const data = await getJson(url, fetchImpl);
    if (!Array.isArray(data.features)) throw new Error("history_backfill_features_missing");
    rows.push(...data.features.map((feature) => asObject(feature?.attributes)));
  }
  return rows;
}

function historicalRecord(row, streetIndex, baselineObservedAt) {
  if (String(row.District ?? "").trim().toUpperCase() !== "ANTWERPEN") throw new Error("history_backfill_wrong_district");
  const normalized = normalizeParking(row);
  if (!normalized.key || !normalized.start || !normalized.end) throw new Error("history_backfill_record_incomplete");
  if (Date.parse(normalized.end) >= Date.parse(baselineObservedAt)) return null;
  const street = resolveAddressStreet(normalized.address, streetIndex);
  return {
    id: `parking:${normalized.key}`,
    kind: "parking",
    title: normalized.reason || "Tijdelijk parkeerverbod",
    location: normalized.address,
    start: normalized.start,
    end: normalized.end,
    status: normalized.status,
    reference: normalized.dossier,
    detail: normalized.weekdaysOnly ? "Alleen op weekdagen" : "",
    gipodId: normalized.gipodId,
    streets: street.streets,
    streetResolution: street.confidence === "official_address_match" ? street.confidence : "unresolved",
    streetDistanceMeters: street.confidence === "official_address_match" ? 0 : null,
    sourceLabel: "A-Sign parkeerverboden — historische bron",
    sourceUrl: SOURCE_URL,
  };
}

const readJsonIfPresent = (file) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;

export async function backfillAsignParking({
  fetch: fetchImpl = globalThis.fetch,
  rootDir,
  clock = () => new Date(),
  streetIndex = null,
} = {}) {
  const baselineFile = path.join(rootDir, "site", "history", "archive", "baseline.json");
  if (!fs.existsSync(baselineFile)) throw new Error("history_backfill_baseline_missing");
  const baseline = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
  const baselineObservedAt = baseline?.layers?.publicSpace?.observedAt;
  if (typeof baselineObservedAt !== "string" || !Number.isFinite(Date.parse(baselineObservedAt))) {
    throw new Error("history_backfill_public_space_baseline_missing");
  }

  const [{ coverageFrom }, rows, streets] = await Promise.all([
    providerContract(fetchImpl),
    fetchAllRows(fetchImpl),
    streetIndex ? Promise.resolve(streetIndex) : fetchStreetFeatures({ fetchImpl }).then(buildStreetIndex),
  ]);
  if (!streets?.segments?.length) throw new Error("history_backfill_street_axis_empty");

  const byId = new Map();
  for (const row of rows) {
    const record = historicalRecord(row, streets, baselineObservedAt);
    if (!record) continue;
    const known = byId.get(record.id);
    if (known && historyBackfillDigest(known) !== historyBackfillDigest(record)) {
      throw new Error(`history_backfill_source_conflict:${record.id}`);
    }
    byId.set(record.id, record);
  }
  const records = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  if (!records.length) throw new Error("history_backfill_no_prebaseline_records");

  const byYear = new Map();
  for (const record of records) {
    const year = String(new Date(record.end).getUTCFullYear());
    const list = byYear.get(year) ?? [];
    list.push(record);
    byYear.set(year, list);
  }

  const root = path.join(rootDir, HISTORY_BACKFILL_DIR);
  fs.mkdirSync(root, { recursive: true });
  const shardEntries = [];
  for (const [year, yearRecords] of [...byYear.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const relative = historyBackfillShardFile(ASIGN_PARKING_BACKFILL_SOURCE, year);
    const file = path.join(rootDir, relative);
    const previous = readJsonIfPresent(file);
    const shard = mergeAppendOnlyBackfillShard(previous, {
      sourceId: ASIGN_PARKING_BACKFILL_SOURCE,
      year,
      records: yearRecords,
    });
    const errors = validateHistoryBackfillShard(shard);
    if (errors.length) throw new Error(`history_backfill_shard_invalid:${errors[0]}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(shard, null, 2)}\n`, "utf8");
    shardEntries.push({
      year: Number(year),
      file: relative,
      count: shard.records.length,
      digest: historyBackfillDigest(shard.records),
    });
  }

  const retrievedAt = clock().toISOString();
  const indexFile = path.join(rootDir, HISTORY_BACKFILL_INDEX_FILE);
  const previousIndex = readJsonIfPresent(indexFile);
  const index = updateHistoryBackfillIndex(previousIndex, {
    sourceId: ASIGN_PARKING_BACKFILL_SOURCE,
    sourceUrl: SOURCE_URL,
    completeness: "provider_declared_complete",
    coverageFrom,
    coverageTo: baselineObservedAt,
    retrievedAt,
    shards: shardEntries,
  });
  const indexErrors = validateHistoryBackfillIndex(index);
  if (indexErrors.length) throw new Error(`history_backfill_index_invalid:${indexErrors[0]}`);
  fs.writeFileSync(indexFile, `${JSON.stringify(index, null, 2)}\n`, "utf8");

  return {
    sourceId: ASIGN_PARKING_BACKFILL_SOURCE,
    baselineObservedAt,
    coverageFrom,
    records: records.length,
    shards: shardEntries.length,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  backfillAsignParking({ rootDir }).then((result) => {
    console.log(JSON.stringify(result));
  }).catch((error) => {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  });
}
