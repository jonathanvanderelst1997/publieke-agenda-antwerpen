import crypto from "node:crypto";

export const HISTORY_BACKFILL_SCHEMA_VERSION = 1;
export const HISTORY_BACKFILL_DIR = "site/history/backfill";
export const HISTORY_BACKFILL_INDEX_FILE = `${HISTORY_BACKFILL_DIR}/index.json`;
export const ASIGN_PARKING_BACKFILL_SOURCE = "asign-parking";

const SOURCE_ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const YEAR = /^(?:19|20|21)[0-9]{2}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const COMPLETENESS = new Set(["provider_declared_complete", "partial", "unknown"]);

const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
const isIso = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const stable = (value) => JSON.stringify(value);
export const historyBackfillDigest = (value) =>
  crypto.createHash("sha256").update(stable(value)).digest("hex");

export function historyBackfillShardFile(sourceId, year) {
  if (!SOURCE_ID.test(String(sourceId))) throw new Error("backfill sourceId ongeldig");
  if (!YEAR.test(String(year))) throw new Error("backfill jaar ongeldig");
  return `${HISTORY_BACKFILL_DIR}/${sourceId}/${year}.json`;
}

const sortRecords = (records = []) => [...records].sort((a, b) =>
  String(a.id).localeCompare(String(b.id)) || historyBackfillDigest(a).localeCompare(historyBackfillDigest(b))
);

export function mergeAppendOnlyBackfillShard(previous, { sourceId, year, records }) {
  const prior = isObject(previous)
    && previous.schemaVersion === HISTORY_BACKFILL_SCHEMA_VERSION
    && previous.sourceId === sourceId
    && String(previous.year) === String(year)
    && Array.isArray(previous.records)
    ? previous.records
    : [];
  const merged = new Map(prior.map((record) => [record.id, record]));
  for (const record of records) {
    const known = merged.get(record.id);
    if (known && historyBackfillDigest(known) !== historyBackfillDigest(record)) {
      throw new Error(`history_backfill_conflict:${record.id}`);
    }
    merged.set(record.id, record);
  }
  return {
    schemaVersion: HISTORY_BACKFILL_SCHEMA_VERSION,
    sourceId,
    year: Number(year),
    records: sortRecords([...merged.values()]),
  };
}

export function updateHistoryBackfillIndex(previous, source) {
  const priorSources = isObject(previous)
    && previous.schemaVersion === HISTORY_BACKFILL_SCHEMA_VERSION
    && Array.isArray(previous.sources)
    ? previous.sources
    : [];
  const sources = new Map(priorSources.map((entry) => [entry.sourceId, entry]));
  const old = sources.get(source.sourceId);
  if (old) {
    const oldFiles = new Set((old.shards ?? []).map((entry) => entry.file));
    const newFiles = new Set((source.shards ?? []).map((entry) => entry.file));
    for (const file of oldFiles) {
      if (!newFiles.has(file)) throw new Error(`history_backfill_index_shrink:${file}`);
    }
  }
  sources.set(source.sourceId, source);
  return {
    schemaVersion: HISTORY_BACKFILL_SCHEMA_VERSION,
    generatedAt: source.retrievedAt,
    sources: [...sources.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
  };
}

function validateStreetRefs(value, prefix, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${prefix}: streets ongeldig`);
    return;
  }
  for (const [index, ref] of value.entries()) {
    if (!isObject(ref) || typeof ref.name !== "string" || !ref.name.trim()) {
      errors.push(`${prefix}: streets[${index}] ongeldig`);
    }
  }
}

export function validateHistoryBackfillShard(document) {
  const errors = [];
  if (!isObject(document)) return ["backfill shard is geen object"];
  if (document.schemaVersion !== HISTORY_BACKFILL_SCHEMA_VERSION) errors.push("backfill shard schemaVersion ongeldig");
  if (!SOURCE_ID.test(String(document.sourceId ?? ""))) errors.push("backfill shard sourceId ongeldig");
  if (!YEAR.test(String(document.year ?? ""))) errors.push("backfill shard jaar ongeldig");
  if (!Array.isArray(document.records)) return [...errors, "backfill shard records ontbreekt"];
  if (document.records.length > 100_000) errors.push("backfill shard te veel records");
  const ids = new Set();
  for (const [index, record] of document.records.entries()) {
    const p = `backfill record[${index}]`;
    if (!isObject(record)) {
      errors.push(`${p}: geen object`);
      continue;
    }
    if (typeof record.id !== "string" || !record.id) errors.push(`${p}: id ongeldig`);
    else if (ids.has(record.id)) errors.push(`${p}: dubbele id ${record.id}`);
    else ids.add(record.id);
    if (record.kind !== "parking") errors.push(`${p}: kind ongeldig`);
    if (!isIso(record.start) || !isIso(record.end)) errors.push(`${p}: periode ongeldig`);
    if (isIso(record.end) && new Date(record.end).getUTCFullYear() !== Number(document.year)) errors.push(`${p}: jaar wijkt af`);
    for (const field of ["title", "location", "status", "reference", "sourceLabel", "sourceUrl"]) {
      if (typeof record[field] !== "string") errors.push(`${p}: ${field} ongeldig`);
    }
    if (record.sourceUrl && !String(record.sourceUrl).startsWith("https://")) errors.push(`${p}: sourceUrl ongeldig`);
    validateStreetRefs(record.streets, p, errors);
    if (!["official_address_match", "unresolved"].includes(record.streetResolution)) errors.push(`${p}: streetResolution ongeldig`);
    if (!(record.streetDistanceMeters === null || Number.isFinite(record.streetDistanceMeters))) errors.push(`${p}: streetDistanceMeters ongeldig`);
  }
  return errors;
}

export function validateHistoryBackfillIndex(document) {
  const errors = [];
  if (!isObject(document)) return ["backfill index is geen object"];
  if (document.schemaVersion !== HISTORY_BACKFILL_SCHEMA_VERSION) errors.push("backfill index schemaVersion ongeldig");
  if (!isIso(document.generatedAt)) errors.push("backfill index generatedAt ongeldig");
  if (!Array.isArray(document.sources)) return [...errors, "backfill index sources ontbreekt"];
  const sourceIds = new Set();
  for (const [index, source] of document.sources.entries()) {
    const p = `backfill source[${index}]`;
    if (!isObject(source) || !SOURCE_ID.test(String(source.sourceId ?? ""))) {
      errors.push(`${p}: sourceId ongeldig`);
      continue;
    }
    if (sourceIds.has(source.sourceId)) errors.push(`${p}: dubbele sourceId ${source.sourceId}`);
    sourceIds.add(source.sourceId);
    if (typeof source.sourceUrl !== "string" || !source.sourceUrl.startsWith("https://")) errors.push(`${p}: sourceUrl ongeldig`);
    if (!COMPLETENESS.has(source.completeness)) errors.push(`${p}: completeness ongeldig`);
    if (!isIso(source.coverageFrom) || !isIso(source.coverageTo) || !isIso(source.retrievedAt)) errors.push(`${p}: coverage ongeldig`);
    if (isIso(source.coverageFrom) && isIso(source.coverageTo) && Date.parse(source.coverageFrom) >= Date.parse(source.coverageTo)) errors.push(`${p}: coverage volgorde ongeldig`);
    if (!Array.isArray(source.shards)) {
      errors.push(`${p}: shards ontbreekt`);
      continue;
    }
    const years = new Set();
    for (const [shardIndex, shard] of source.shards.entries()) {
      const s = `${p}.shards[${shardIndex}]`;
      if (!isObject(shard) || !YEAR.test(String(shard.year ?? ""))) {
        errors.push(`${s}: jaar ongeldig`);
        continue;
      }
      if (years.has(String(shard.year))) errors.push(`${s}: dubbel jaar`);
      years.add(String(shard.year));
      if (shard.file !== historyBackfillShardFile(source.sourceId, shard.year)) errors.push(`${s}: file ongeldig`);
      if (!Number.isInteger(shard.count) || shard.count < 1 || shard.count > 100_000) errors.push(`${s}: count ongeldig`);
      if (!SHA256.test(String(shard.digest ?? ""))) errors.push(`${s}: digest ongeldig`);
    }
  }
  return errors;
}
