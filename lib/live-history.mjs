import crypto from "node:crypto";

import { adresZonderHuisnummer } from "../site/adres-privacy.js";

export const LIVE_HISTORY_SCHEMA_VERSION = 1;
export const LIVE_HISTORY_RETENTION_DAYS = 90;
export const LIVE_HISTORY_FILE = "site/history/live-layers.json";

const LAYERS = Object.freeze(["works", "publicSpace"]);
const LAYER_STATUSES = Object.freeze(["ok", "stale", "error"]);
const CHANGE_TYPES = Object.freeze(["added", "removed", "changed"]);
const NON_OPERATIONAL_FIELDS = new Set(["streets", "streetResolution", "streetDistanceMeters"]);

const clean = (value = "") => String(value ?? "").replace(/\s+/g, " ").trim();
const iso = (value) => (typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : "");
const sortedStrings = (values = []) => [...new Set((values || []).map(clean).filter(Boolean))].sort((a, b) => a.localeCompare(b, "nl"));
const compactStreets=(values=[])=>[...new Map((values||[]).filter(v=>v?.name).map(v=>{const s={id:clean(v.id),name:clean(v.name),postcode:clean(v.postcode)};return[[s.id,s.name,s.postcode].join("|"),s]})).values()].sort((a,b)=>a.name.localeCompare(b.name,"nl")||a.postcode.localeCompare(b.postcode));

export function compactWorkItem(item = {}) {
  const hindrance = item.hindrance
    ? {
        severe: item.hindrance.severe === true,
        consequences: sortedStrings(item.hindrance.consequences),
        start: iso(item.hindrance.start),
        end: iso(item.hindrance.end),
      }
    : null;
  return {
    id: `work:${Number(item.gipodId)}`,
    gipodId: Number(item.gipodId),
    title: clean(item.title),
    status: clean(item.status),
    start: iso(item.start),
    end: iso(item.end),
    owner: clean(item.owner),
    ownerGroup: clean(item.ownerGroup),
    boundaryConfidence: clean(item.boundaryConfidence),
    workTypes: sortedStrings(item.workTypes),
    occupancyTypes: sortedStrings(item.occupancyTypes),
    streets: compactStreets(item.streets),
    streetResolution: clean(item.streetResolution),
    streetDistanceMeters: Number.isFinite(item.streetDistanceMeters) ? Math.round(item.streetDistanceMeters) : null,
    hindrance,
  };
}

export function compactPublicSpaceItem(item = {}) {
  return {
    id: clean(item.id),
    kind: clean(item.kind),
    kindLabel: clean(item.kindLabel),
    title: clean(item.title),
    // Nooit een huisnummer bij een parkeerverbod: dat is vaak een privéadres (verhuis, container).
    location: clean(item.kind === "parking" ? adresZonderHuisnummer(item.location) : item.location),
    start: iso(item.start),
    end: iso(item.end),
    status: clean(item.status),
    reference: clean(item.reference),
    detail: clean(item.detail),
    streets: compactStreets(item.streets),
    streetResolution: clean(item.streetResolution),
    streetDistanceMeters: Number.isFinite(item.streetDistanceMeters) ? Math.round(item.streetDistanceMeters) : null,
  };
}

function stableItems(items = []) {
  return [...items].sort((a, b) => String(a.id).localeCompare(String(b.id), "nl"));
}

function digest(items = []) {
  return crypto.createHash("sha256").update(JSON.stringify(stableItems(items))).digest("hex");
}

function layerOk(items, observedAt) {
  const stable = stableItems(items);
  return {
    status: "ok",
    lastAttemptAt: observedAt,
    lastSuccessAt: observedAt,
    errorCode: null,
    count: stable.length,
    digest: digest(stable),
    items: stable,
  };
}

function layerFailed(previous, observedAt, errorCode = "fetch_failed") {
  if (previous?.items && Array.isArray(previous.items)) {
    return {
      ...previous,
      status: "stale",
      lastAttemptAt: observedAt,
      errorCode: clean(errorCode).slice(0, 80) || "fetch_failed",
    };
  }
  return {
    status: "error",
    lastAttemptAt: observedAt,
    lastSuccessAt: null,
    errorCode: clean(errorCode).slice(0, 80) || "fetch_failed",
    count: 0,
    digest: null,
    items: [],
  };
}

function snapshotValue(item, fields) {
  const result = {};
  for (const field of fields) result[field] = item?.[field] ?? null;
  return result;
}

function diffLayer(previousLayer, nextLayer, layer, observedAt) {
  // Een laag die nog nooit succesvol was, heeft nog geen operationele baseline.
  // Een eerdere foutlaag met lege items betekent dus niet "0 echte records":
  // de eerste geslaagde snapshot wordt baseline en veroorzaakt geen massale
  // added-events. Na minstens één lastSuccessAt gelden gewone diffs.
  if (!previousLayer?.items || !previousLayer.lastSuccessAt || nextLayer.status !== "ok") return [];
  const before = new Map(previousLayer.items.map((item) => [item.id, item]));
  const after = new Map(nextLayer.items.map((item) => [item.id, item]));
  const events = [];
  for (const id of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const oldItem = before.get(id);
    const newItem = after.get(id);
    if (!oldItem) {
      events.push({ observedAt, layer, id, type: "added", fields: [], before: null, after: newItem });
      continue;
    }
    if (!newItem) {
      events.push({ observedAt, layer, id, type: "removed", fields: [], before: oldItem, after: null });
      continue;
    }
    const fields = [...new Set([...Object.keys(oldItem), ...Object.keys(newItem)])]
      .filter((field) => field !== "id" && !NON_OPERATIONAL_FIELDS.has(field) && JSON.stringify(oldItem[field] ?? null) !== JSON.stringify(newItem[field] ?? null))
      .sort();
    if (!fields.length) continue;
    events.push({
      observedAt,
      layer,
      id,
      type: "changed",
      fields,
      before: snapshotValue(oldItem, fields),
      after: snapshotValue(newItem, fields),
    });
  }
  return events;
}

// Oudere historiek kan nog huisnummers bij parkeerverboden bevatten. Die halen we eruit vóór we
// vergelijken en bewaren, zodat de overgang geen duizenden "changed"-regels maakt en de oude
// adressen niet blijven staan.
const parkeerZonderHuisnummer = (value) =>
  value && typeof value === "object" && typeof value.location === "string" && (value.kind === "parking" || String(value.id || "").startsWith("parking:"))
    ? { ...value, location: clean(adresZonderHuisnummer(value.location)) }
    : value;
function layerZonderHuisnummers(layer) {
  if (!layer || !Array.isArray(layer.items)) return layer;
  const items = layer.items.map(parkeerZonderHuisnummer);
  return { ...layer, items, digest: layer.digest ? digest(items) : layer.digest };
}
function changeZonderHuisnummer(entry) {
  if (entry?.layer !== "publicSpace" || !String(entry.id || "").startsWith("parking:")) return entry;
  const scrub = (value) => (value && typeof value === "object" && typeof value.location === "string" ? { ...value, location: clean(adresZonderHuisnummer(value.location)) } : value);
  return { ...entry, before: scrub(entry.before), after: scrub(entry.after) };
}

function validPrevious(document) {
  return document && document.schemaVersion === LIVE_HISTORY_SCHEMA_VERSION && document.layers && typeof document.layers === "object";
}

export function updateLiveHistory(previous, { observedAt, worksResult, publicSpaceResult }) {
  if (!iso(observedAt)) throw new Error("observedAt is geen ISO-tijdstip");
  const prior = validPrevious(previous)
    ? {
        ...previous,
        layers: { ...previous.layers, publicSpace: layerZonderHuisnummers(previous.layers.publicSpace) },
        changes: Array.isArray(previous.changes) ? previous.changes.map(changeZonderHuisnummer) : previous.changes,
      }
    : null;
  const works = worksResult?.ok
    ? layerOk((worksResult.items || []).map(compactWorkItem), observedAt)
    : layerFailed(prior?.layers?.works, observedAt, worksResult?.errorCode);
  const publicSpace = publicSpaceResult?.ok
    ? layerOk((publicSpaceResult.items || []).map(compactPublicSpaceItem), observedAt)
    : layerFailed(prior?.layers?.publicSpace, observedAt, publicSpaceResult?.errorCode);

  const baselineInitializedAt = prior?.baselineInitializedAt || observedAt;
  const currentChanges = prior
    ? [
        ...diffLayer(prior.layers?.works, works, "works", observedAt),
        ...diffLayer(prior.layers?.publicSpace, publicSpace, "publicSpace", observedAt),
      ]
    : [];
  const cutoff = Date.parse(observedAt) - LIVE_HISTORY_RETENTION_DAYS * 86_400_000;
  const oldChanges = Array.isArray(prior?.changes)
    ? prior.changes.filter((entry) => Number.isFinite(Date.parse(entry.observedAt)) && Date.parse(entry.observedAt) >= cutoff)
    : [];
  const changes = [...oldChanges, ...currentChanges].sort(
    (a, b) =>
      String(a.observedAt).localeCompare(String(b.observedAt)) ||
      String(a.layer).localeCompare(String(b.layer)) ||
      String(a.id).localeCompare(String(b.id))
  );

  return {
    schemaVersion: LIVE_HISTORY_SCHEMA_VERSION,
    observedAt,
    retentionDays: LIVE_HISTORY_RETENTION_DAYS,
    baselineInitializedAt,
    layers: { works, publicSpace },
    changes,
  };
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

export function validateLiveHistory(document) {
  const errors = [];
  if (!isObject(document)) return ["document is geen object"];
  const rootKeys = ["schemaVersion", "observedAt", "retentionDays", "baselineInitializedAt", "layers", "changes"];
  for (const key of Object.keys(document)) if (!rootKeys.includes(key)) errors.push(`onbekende rootsleutel ${key}`);
  if (document.schemaVersion !== LIVE_HISTORY_SCHEMA_VERSION) errors.push("schemaVersion ongeldig");
  if (!iso(document.observedAt)) errors.push("observedAt ongeldig");
  if (!iso(document.baselineInitializedAt)) errors.push("baselineInitializedAt ongeldig");
  if (document.retentionDays !== LIVE_HISTORY_RETENTION_DAYS) errors.push("retentionDays ongeldig");
  if (!isObject(document.layers)) errors.push("layers ontbreekt");
  for (const layer of LAYERS) {
    const value = document.layers?.[layer];
    if (!isObject(value)) {
      errors.push(`layer ${layer} ontbreekt`);
      continue;
    }
    const keys = ["status", "lastAttemptAt", "lastSuccessAt", "errorCode", "count", "digest", "items"];
    for (const key of Object.keys(value)) if (!keys.includes(key)) errors.push(`${layer}: onbekende sleutel ${key}`);
    if (!LAYER_STATUSES.includes(value.status)) errors.push(`${layer}: status ongeldig`);
    if (!iso(value.lastAttemptAt)) errors.push(`${layer}: lastAttemptAt ongeldig`);
    if (value.lastSuccessAt !== null && !iso(value.lastSuccessAt)) errors.push(`${layer}: lastSuccessAt ongeldig`);
    if (value.errorCode !== null && (typeof value.errorCode !== "string" || value.errorCode.length > 80)) errors.push(`${layer}: errorCode ongeldig`);
    if (!Array.isArray(value.items)) errors.push(`${layer}: items ontbreekt`);
    else {
      if (value.items.length > 10_000) errors.push(`${layer}: te veel items`);
      if (value.count !== value.items.length) errors.push(`${layer}: count wijkt af`);
      const ids = new Set();
      for (const item of value.items) {
        if (!isObject(item) || typeof item.id !== "string" || !item.id) errors.push(`${layer}: item-id ongeldig`);
        else if (ids.has(item.id)) errors.push(`${layer}: dubbele id ${item.id}`);
        else ids.add(item.id);
      }
      if (value.digest !== null && !/^[a-f0-9]{64}$/.test(String(value.digest))) errors.push(`${layer}: digest ongeldig`);
      if (value.status === "ok" && value.digest !== digest(value.items)) errors.push(`${layer}: digest wijkt af`);
    }
  }
  if (!Array.isArray(document.changes)) errors.push("changes ontbreekt");
  else {
    if (document.changes.length > 20_000) errors.push("te veel changes");
    const cutoff = Number.isFinite(Date.parse(document.observedAt))
      ? Date.parse(document.observedAt) - LIVE_HISTORY_RETENTION_DAYS * 86_400_000
      : 0;
    for (const [index, change] of document.changes.entries()) {
      if (!isObject(change)) {
        errors.push(`changes[${index}] geen object`);
        continue;
      }
      if (!iso(change.observedAt) || Date.parse(change.observedAt) < cutoff) errors.push(`changes[${index}] buiten retentie of ongeldige datum`);
      if (!LAYERS.includes(change.layer)) errors.push(`changes[${index}] layer ongeldig`);
      if (!CHANGE_TYPES.includes(change.type)) errors.push(`changes[${index}] type ongeldig`);
      if (typeof change.id !== "string" || !change.id) errors.push(`changes[${index}] id ongeldig`);
      if (!Array.isArray(change.fields)) errors.push(`changes[${index}] fields ongeldig`);
      if (!(change.before === null || isObject(change.before))) errors.push(`changes[${index}] before ongeldig`);
      if (!(change.after === null || isObject(change.after))) errors.push(`changes[${index}] after ongeldig`);
    }
  }
  return errors;
}
