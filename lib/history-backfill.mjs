export const HISTORY_BACKFILL_SCHEMA_VERSION = 1;
export const HISTORY_BACKFILL_COMPLETENESS = Object.freeze(["full", "partial", "unknown"]);

const ISO_DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const SOURCE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);

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
