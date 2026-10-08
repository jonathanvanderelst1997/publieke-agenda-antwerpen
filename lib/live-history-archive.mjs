import crypto from "node:crypto";

export const LIVE_HISTORY_ARCHIVE_SCHEMA_VERSION = 1;
export const LIVE_HISTORY_ARCHIVE_DIR = "site/history/archive";
export const LIVE_HISTORY_ARCHIVE_BASELINE_FILE = `${LIVE_HISTORY_ARCHIVE_DIR}/baseline.json`;
export const LIVE_HISTORY_ARCHIVE_INDEX_FILE = `${LIVE_HISTORY_ARCHIVE_DIR}/index.json`;

const LAYERS = Object.freeze(["works", "publicSpace"]);
const CHANGE_TYPES = Object.freeze(["added", "removed", "changed"]);
const ISO_DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const SHA256 = /^[a-f0-9]{64}$/;

const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
const iso = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const stableJsonHash = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function historyArchiveDay(observedAt) {
  if (!iso(observedAt)) throw new Error("history archive observedAt ongeldig");
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(observedAt));
}

export function historyArchiveDayFile(date) {
  if (!ISO_DAY.test(String(date))) throw new Error("history archive date ongeldig");
  return `${LIVE_HISTORY_ARCHIVE_DIR}/${date}.json`;
}

// Bestandsnaam van een dagshard zoals historyArchiveDayFile hem schrijft: "2026-10-01.json".
const DAY_FILE_NAME = /^[0-9]{4}-[0-9]{2}-[0-9]{2}\.json$/;

export function isHistoryArchiveDayFileName(name) {
  return DAY_FILE_NAME.test(String(name));
}

const stableEvents = (events = []) => [...events].sort(
  (a, b) =>
    String(a.observedAt).localeCompare(String(b.observedAt)) ||
    String(a.layer).localeCompare(String(b.layer)) ||
    String(a.id).localeCompare(String(b.id)) ||
    String(a.type).localeCompare(String(b.type)) ||
    stableJsonHash(a).localeCompare(stableJsonHash(b))
);

export function updateHistoryArchiveBaseline(previous, liveHistory) {
  const prior = isObject(previous) && previous.schemaVersion === LIVE_HISTORY_ARCHIVE_SCHEMA_VERSION
    ? previous
    : { schemaVersion: LIVE_HISTORY_ARCHIVE_SCHEMA_VERSION, layers: { works: null, publicSpace: null } };
  const layers = { works: prior.layers?.works ?? null, publicSpace: prior.layers?.publicSpace ?? null };
  for (const layer of LAYERS) {
    const current = liveHistory?.layers?.[layer];
    if (layers[layer] === null && current?.status === "ok" && Array.isArray(current.items)) {
      layers[layer] = {
        observedAt: current.lastSuccessAt || liveHistory.observedAt,
        items: current.items,
      };
    }
  }
  return { schemaVersion: LIVE_HISTORY_ARCHIVE_SCHEMA_VERSION, layers };
}

export function historyArchiveEventsForRun(liveHistory, baseline) {
  const observedAt = liveHistory?.observedAt;
  const events = Array.isArray(liveHistory?.changes)
    ? liveHistory.changes.filter((event) => event?.observedAt === observedAt)
    : [];
  return events.filter((event) => baseline?.layers?.[event.layer]?.observedAt !== observedAt);
}

export function updateHistoryArchiveDay(previous, observedAt, events) {
  const date = historyArchiveDay(observedAt);
  const priorEvents = isObject(previous)
    && previous.schemaVersion === LIVE_HISTORY_ARCHIVE_SCHEMA_VERSION
    && previous.date === date
    && Array.isArray(previous.events)
    ? previous.events
    : [];
  const byHash = new Map();
  for (const event of [...priorEvents, ...events]) byHash.set(stableJsonHash(event), event);
  return {
    schemaVersion: LIVE_HISTORY_ARCHIVE_SCHEMA_VERSION,
    date,
    events: stableEvents([...byHash.values()]),
  };
}

export function historyArchiveEventsDigest(events) {
  return stableJsonHash(stableEvents(events));
}

export function updateHistoryArchiveIndex(previous, { observedAt, baseline, dayDocument }) {
  const previousDays = isObject(previous) && previous.schemaVersion === LIVE_HISTORY_ARCHIVE_SCHEMA_VERSION
    && Array.isArray(previous.days) ? previous.days : [];
  const days = new Map(previousDays.map((entry) => [entry.date, entry]));
  if (dayDocument.events.length > 0) {
    days.set(dayDocument.date, {
      date: dayDocument.date,
      file: historyArchiveDayFile(dayDocument.date),
      count: dayDocument.events.length,
      digest: historyArchiveEventsDigest(dayDocument.events),
    });
  }
  const baselineTimes = LAYERS
    .map((layer) => baseline?.layers?.[layer]?.observedAt)
    .filter(iso)
    .sort();
  return {
    schemaVersion: LIVE_HISTORY_ARCHIVE_SCHEMA_VERSION,
    baselineInitializedAt: baselineTimes[0] ?? null,
    lastObservedAt: observedAt,
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

function validateItems(items, prefix, errors) {
  if (!Array.isArray(items)) {
    errors.push(`${prefix}: items ontbreekt`);
    return;
  }
  if (items.length > 10_000) errors.push(`${prefix}: te veel items`);
  const ids = new Set();
  for (const item of items) {
    if (!isObject(item) || typeof item.id !== "string" || !item.id) errors.push(`${prefix}: item-id ongeldig`);
    else if (ids.has(item.id)) errors.push(`${prefix}: dubbele id ${item.id}`);
    else ids.add(item.id);
  }
}

export function validateHistoryArchiveBaseline(document) {
  const errors = [];
  if (!isObject(document)) return ["archive baseline is geen object"];
  if (document.schemaVersion !== LIVE_HISTORY_ARCHIVE_SCHEMA_VERSION) errors.push("archive baseline schemaVersion ongeldig");
  if (!isObject(document.layers)) return [...errors, "archive baseline layers ontbreekt"];
  for (const layer of LAYERS) {
    const value = document.layers[layer];
    if (value === null) continue;
    if (!isObject(value)) {
      errors.push(`archive baseline ${layer} ongeldig`);
      continue;
    }
    if (!iso(value.observedAt)) errors.push(`archive baseline ${layer}: observedAt ongeldig`);
    validateItems(value.items, `archive baseline ${layer}`, errors);
  }
  return errors;
}

export function validateHistoryArchiveDay(document) {
  const errors = [];
  if (!isObject(document)) return ["archive dag is geen object"];
  if (document.schemaVersion !== LIVE_HISTORY_ARCHIVE_SCHEMA_VERSION) errors.push("archive dag schemaVersion ongeldig");
  if (!ISO_DAY.test(String(document.date ?? ""))) errors.push("archive dag datum ongeldig");
  if (!Array.isArray(document.events)) return [...errors, "archive dag events ontbreekt"];
  if (document.events.length > 20_000) errors.push("archive dag te veel events");
  for (const [index, event] of document.events.entries()) {
    if (!isObject(event)) {
      errors.push(`archive event[${index}] geen object`);
      continue;
    }
    if (!iso(event.observedAt) || historyArchiveDay(event.observedAt) !== document.date) errors.push(`archive event[${index}] datum ongeldig`);
    if (!LAYERS.includes(event.layer)) errors.push(`archive event[${index}] layer ongeldig`);
    if (!CHANGE_TYPES.includes(event.type)) errors.push(`archive event[${index}] type ongeldig`);
    if (typeof event.id !== "string" || !event.id) errors.push(`archive event[${index}] id ongeldig`);
    if (!Array.isArray(event.fields)) errors.push(`archive event[${index}] fields ongeldig`);
    if (!(event.before === null || isObject(event.before))) errors.push(`archive event[${index}] before ongeldig`);
    if (!(event.after === null || isObject(event.after))) errors.push(`archive event[${index}] after ongeldig`);
  }
  return errors;
}

export function validateHistoryArchiveIndex(document) {
  const errors = [];
  if (!isObject(document)) return ["archive index is geen object"];
  if (document.schemaVersion !== LIVE_HISTORY_ARCHIVE_SCHEMA_VERSION) errors.push("archive index schemaVersion ongeldig");
  if (document.baselineInitializedAt !== null && !iso(document.baselineInitializedAt)) errors.push("archive index baselineInitializedAt ongeldig");
  if (!iso(document.lastObservedAt)) errors.push("archive index lastObservedAt ongeldig");
  if (!Array.isArray(document.days)) return [...errors, "archive index days ontbreekt"];
  if (document.days.length > 20_000) errors.push("archive index te veel dagen");
  const seen = new Set();
  for (const [index, day] of document.days.entries()) {
    if (!isObject(day) || !ISO_DAY.test(String(day.date ?? ""))) {
      errors.push(`archive index days[${index}] datum ongeldig`);
      continue;
    }
    if (seen.has(day.date)) errors.push(`archive index dubbele dag ${day.date}`);
    seen.add(day.date);
    if (day.file !== historyArchiveDayFile(day.date)) errors.push(`archive index days[${index}] bestand ongeldig`);
    if (!Number.isInteger(day.count) || day.count < 1 || day.count > 20_000) errors.push(`archive index days[${index}] count ongeldig`);
    if (!SHA256.test(String(day.digest ?? ""))) errors.push(`archive index days[${index}] digest ongeldig`);
  }
  return errors;
}
