import crypto from "node:crypto";

export const HISTORY_BACKFILL_SCHEMA_VERSION = 1;
export const HISTORY_BACKFILL_COMPLETENESS = Object.freeze(["full", "partial", "unknown"]);
export const HISTORY_BACKFILL_DIR = "site/history/backfill";
export const HISTORY_BACKFILL_INDEX_FILE = `${HISTORY_BACKFILL_DIR}/index.json`;

const ISO_DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const SOURCE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
const iso = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const stableJsonHash = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function validateHistoryBackfillManifest(document) {
  const errors = [];
  if (!isObject(document)) return ["backfillmanifest is geen object"];
  if (document.schemaVersion !== HISTORY_BACKFILL_SCHEMA_VERSION) errors.push("schemaVersion ongeldig");
  if (!Array.isArray(document.sources) || !document.sources.length) return [...errors, "sources ontbreekt"];

  const seen = new Set();
  for (const [index, source] of document.sources.entries()) {
    const p = `sources[${index}]`;
    if (!isObject(source)) {
      errors.push(`${p} is geen object`);
      continue;
    }
    if (!SOURCE_ID.test(String(source.sourceId ?? ""))) errors.push(`${p}.sourceId ongeldig`);
    else if (seen.has(source.sourceId)) errors.push(`${p}.sourceId dubbel`);
    else seen.add(source.sourceId);

    if (!HISTORY_BACKFILL_COMPLETENESS.includes(source.completeness)) errors.push(`${p}.completeness ongeldig`);
    if (source.coverageFrom !== null && !ISO_DAY.test(String(source.coverageFrom ?? ""))) errors.push(`${p}.coverageFrom ongeldig`);
    if (source.coverageTo !== null && !ISO_DAY.test(String(source.coverageTo ?? ""))) errors.push(`${p}.coverageTo ongeldig`);
    if (source.coverageFrom && source.coverageTo && source.coverageFrom > source.coverageTo) errors.push(`${p}: omgekeerde dekking`);

    if (typeof source.sourceUrl !== "string" || !source.sourceUrl.startsWith("https://")) errors.push(`${p}.sourceUrl ongeldig`);
    if (typeof source.evidence !== "string" || source.evidence.trim().length < 10 || source.evidence.length > 1000) errors.push(`${p}.evidence ongeldig`);
    if (typeof source.dedupeKey !== "string" || source.dedupeKey.trim().length < 1 || source.dedupeKey.length > 200) errors.push(`${p}.dedupeKey ongeldig`);
    if (source.snapshotDigest !== null && !SHA256.test(String(source.snapshotDigest ?? ""))) errors.push(`${p}.snapshotDigest ongeldig`);

    if (source.completeness === "full" && !source.coverageFrom) errors.push(`${p}: full vereist coverageFrom`);
    if (source.completeness === "unknown" && (source.coverageFrom !== null || source.coverageTo !== null)) {
      errors.push(`${p}: unknown mag geen bewezen periode claimen`);
    }
  }
  return errors;
}

export function backfillSourceCanImport(source) {
  return validateHistoryBackfillManifest({ schemaVersion: 1, sources: [source] }).length === 0
    && (source.completeness === "full" || source.completeness === "partial");
}

export function sourceHistoryRecord({ sourceId, sourceRecordId, validFrom, validTo, payload }) {
  if (!SOURCE_ID.test(String(sourceId ?? ""))) throw new Error("backfill sourceId ongeldig");
  if (typeof sourceRecordId !== "string" || !sourceRecordId.trim()) throw new Error("backfill sourceRecordId ongeldig");
  if (validFrom !== null && !ISO_DAY.test(String(validFrom))) throw new Error("backfill validFrom ongeldig");
  if (validTo !== null && !ISO_DAY.test(String(validTo))) throw new Error("backfill validTo ongeldig");
  if (validFrom && validTo && validFrom > validTo) throw new Error("backfill geldigheid omgekeerd");
  if (!isObject(payload)) throw new Error("backfill payload ongeldig");
  return Object.freeze({ sourceId, sourceRecordId, validFrom, validTo, payload: structuredClone(payload) });
}

export function historyBackfillShardFile(sourceId, year) {
  if (!SOURCE_ID.test(String(sourceId ?? ""))) throw new Error("backfill sourceId ongeldig");
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error("backfill jaar ongeldig");
  return `${HISTORY_BACKFILL_DIR}/${sourceId}/${year}.json`;
}

export function historyBackfillRecordsDigest(records = []) {
  return stableJsonHash([...records].sort((a, b) =>
    String(a.sourceRecordId).localeCompare(String(b.sourceRecordId))
    || stableJsonHash(a).localeCompare(stableJsonHash(b))
  ));
}

export function historyBackfillSnapshotDigest(shards = []) {
  return stableJsonHash([...shards].map((entry) => ({
    year: entry.year,
    file: entry.file,
    count: entry.count,
    digest: entry.digest,
  })).sort((a, b) => a.year - b.year));
}

export function validateHistoryBackfillShard(document) {
  const errors = [];
  if (!isObject(document)) return ["backfillshard is geen object"];
  if (document.schemaVersion !== HISTORY_BACKFILL_SCHEMA_VERSION) errors.push("backfillshard schemaVersion ongeldig");
  if (!SOURCE_ID.test(String(document.sourceId ?? ""))) errors.push("backfillshard sourceId ongeldig");
  if (!Number.isInteger(document.year) || document.year < 2000 || document.year > 2100) errors.push("backfillshard jaar ongeldig");
  if (!Array.isArray(document.records)) return [...errors, "backfillshard records ontbreekt"];
  if (document.records.length > 20_000) errors.push("backfillshard te veel records");
  const seen = new Set();
  for (const [index, record] of document.records.entries()) {
    const p = `records[${index}]`;
    if (!isObject(record)) {
      errors.push(`${p} is geen object`);
      continue;
    }
    if (record.sourceId !== document.sourceId) errors.push(`${p}.sourceId wijkt af`);
    if (typeof record.sourceRecordId !== "string" || !record.sourceRecordId) errors.push(`${p}.sourceRecordId ongeldig`);
    else if (seen.has(record.sourceRecordId)) errors.push(`${p}.sourceRecordId dubbel`);
    else seen.add(record.sourceRecordId);
    if (!ISO_DAY.test(String(record.validFrom ?? ""))) errors.push(`${p}.validFrom ongeldig`);
    else if (Number(String(record.validFrom).slice(0, 4)) !== document.year) errors.push(`${p}.validFrom buiten shardjaar`);
    if (record.validTo !== null && !ISO_DAY.test(String(record.validTo ?? ""))) errors.push(`${p}.validTo ongeldig`);
    if (record.validFrom && record.validTo && record.validFrom > record.validTo) errors.push(`${p}: geldigheid omgekeerd`);
    if (!isObject(record.payload) || typeof record.payload.id !== "string" || !record.payload.id) errors.push(`${p}.payload ongeldig`);
  }
  return errors;
}

export function validateHistoryBackfillIndex(document) {
  const errors = [];
  if (!isObject(document)) return ["backfillindex is geen object"];
  if (document.schemaVersion !== HISTORY_BACKFILL_SCHEMA_VERSION) errors.push("backfillindex schemaVersion ongeldig");
  if (!iso(document.generatedAt)) errors.push("backfillindex generatedAt ongeldig");
  if (!Array.isArray(document.sources) || !document.sources.length) return [...errors, "backfillindex sources ontbreekt"];

  const manifestSources = document.sources.map(({ shards: _shards, ...source }) => source);
  errors.push(...validateHistoryBackfillManifest({ schemaVersion: document.schemaVersion, sources: manifestSources }));
  for (const [index, source] of document.sources.entries()) {
    const p = `sources[${index}]`;
    if (!Array.isArray(source.shards)) {
      errors.push(`${p}.shards ontbreekt`);
      continue;
    }
    if (source.completeness !== "unknown" && !source.shards.length) errors.push(`${p}.shards leeg`);
    if (source.completeness === "unknown" && source.shards.length) errors.push(`${p}: unknown mag geen shards hebben`);
    const years = new Set();
    for (const [shardIndex, shard] of source.shards.entries()) {
      const q = `${p}.shards[${shardIndex}]`;
      if (!isObject(shard) || !Number.isInteger(shard.year) || shard.year < 2000 || shard.year > 2100) {
        errors.push(`${q}.year ongeldig`);
        continue;
      }
      if (years.has(shard.year)) errors.push(`${q}.year dubbel`);
      years.add(shard.year);
      if (shard.file !== historyBackfillShardFile(source.sourceId, shard.year)) errors.push(`${q}.file ongeldig`);
      if (!Number.isInteger(shard.count) || shard.count < 1 || shard.count > 20_000) errors.push(`${q}.count ongeldig`);
      if (!SHA256.test(String(shard.digest ?? ""))) errors.push(`${q}.digest ongeldig`);
    }
    if (source.shards.length && source.snapshotDigest !== historyBackfillSnapshotDigest(source.shards)) {
      errors.push(`${p}.snapshotDigest wijkt af`);
    }
  }
  return errors;
}
