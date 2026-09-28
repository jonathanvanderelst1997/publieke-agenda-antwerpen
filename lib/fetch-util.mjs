// Gedeelde hulp voor de fetchers. Alleen de fetchers en scripts/refresh-fetch.mjs gebruiken dit;
// niets hiervan draait in `npm run check`.
import fs from "node:fs";
import path from "node:path";

import { normalized, validateEventContract } from "./event-contract.mjs";
import { MAX_AGE_HOURS, SOURCE_DEFINITIONS, normalizeSourceItem, privacyFindings, sourceDocument, sourceFileName, validateSourceDocument } from "./source-feed.mjs";

export const USER_AGENT = "publieke-agenda-antwerpen/1.0 (+https://mijn-publieke-agenda-voor-district.onrender.com)";
export const REQUEST_TIMEOUT_MS = 20_000;

export class FetchError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}

export async function fetchWithTimeout(fetchImpl, url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error instanceof FetchError) throw error;
    throw new FetchError(controller.signal.aborted ? "timeout" : "network_error", error?.message ?? String(error));
  } finally {
    clearTimeout(timer);
  }
}

export function errorCodeOf(error) {
  const code = error instanceof FetchError ? error.code : "unexpected_error";
  return /^[a-z0-9_]{1,60}$/.test(code) ? code : "unexpected_error";
}

export function sourcePath(rootDir, sourceId) {
  return path.join(rootDir, "site", sourceFileName(sourceId));
}

export function readSourceDocument(rootDir, sourceId) {
  const file = sourcePath(rootDir, sourceId);
  if (!fs.existsSync(file)) return null;
  try {
    const document = JSON.parse(fs.readFileSync(file, "utf8"));
    return validateSourceDocument(document, { expectedSourceId: sourceId }).length ? null : document;
  } catch {
    return null;
  }
}

export function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

// Schrijft een brondocument alleen als het volledig geldig is. Geeft de geschreven items terug.
export function writeSourceDocument(rootDir, sourceId, document) {
  const errors = validateSourceDocument(document, { expectedSourceId: sourceId });
  if (errors.length) throw new FetchError("invalid_output", `brondocument ${sourceId} is ongeldig: ${errors.slice(0, 3).join("; ")}`);
  const file = sourcePath(rootDir, sourceId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = serialize(document);
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text) fs.writeFileSync(file, text, "utf8");
  return document;
}

// Houdt alleen items over die de privacyscan en het eventcontract doorstaan.
// Items die afvallen worden geteld, nooit weggeschreven.
// Het contract wordt per item gecontroleerd; de dubbelcontrole (duplicate_event) gebeurt met dezelfde
// handtekening als in lib/event-contract.mjs, zodat dit ook voor 1.500 UiT-items lineair blijft.
export function screenItems(items) {
  const passed = [];
  const rejected = { privacy: 0, contract: 0, duplicate: 0 };
  const seen = new Set();
  const signatures = new Set();
  for (const raw of items) {
    const item = normalizeSourceItem(raw);
    if (seen.has(item.id)) {
      rejected.duplicate += 1;
      continue;
    }
    if (privacyFindings(item).length) {
      rejected.privacy += 1;
      continue;
    }
    const contract = validateEventContract([item]);
    const event = contract.events[0];
    const signature = event ? [normalized(event.title), event.date, event.startTime || "unknown", normalized(event.location)].join("|") : null;
    if (!contract.ok || !signature || signatures.has(signature)) {
      rejected.contract += 1;
      continue;
    }
    seen.add(item.id);
    signatures.add(signature);
    passed.push(item);
  }
  return { items: passed, rejected };
}

export function statusEntry(sourceId, { fetchStatus, retrievedAt = null, itemCount = 0, errorCode = null, capped, coverageUntil }) {
  const definition = SOURCE_DEFINITIONS[sourceId];
  const entry = {
    sourceId,
    file: sourceFileName(sourceId),
    scope: definition.scope,
    fetchStatus,
    retrievedAt,
    maxAgeHours: MAX_AGE_HOURS,
    itemCount,
    errorCode,
  };
  // Alleen bij een bron die afkapt (UiT): zichtbaar in refresh-status.json.
  if (capped !== undefined) {
    entry.capped = capped === true;
    entry.coverageUntil = coverageUntil ?? null;
  }
  return entry;
}

// Bij een fout: vorige items en retrievedAt blijven, alleen fetchStatus wordt "error".
export function keepPreviousOnError(rootDir, sourceId, previous, errorCode, { dryRun = false } = {}) {
  const document = sourceDocument(sourceId, {
    retrievedAt: previous?.retrievedAt ?? null,
    fetchStatus: "error",
    contentVersion: previous?.contentVersion ?? null,
    coverage: previous?.coverage ?? null,
    items: previous?.items ?? [],
    suppressions: previous?.suppressions ?? [],
  });
  if (!dryRun) writeSourceDocument(rootDir, sourceId, document);
  const coverage = document.coverage ? { capped: document.coverage.capped, coverageUntil: document.coverage.until } : {};
  return statusEntry(sourceId, { fetchStatus: "error", retrievedAt: document.retrievedAt, itemCount: document.items.length, errorCode, ...coverage });
}

export function isMainModule(importMetaUrl) {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(new URL(importMetaUrl).pathname) === fs.realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

export function upcomingCount(items, today) {
  return items.filter((item) => (item.endDate ?? item.date) >= today).length;
}

// ---------- krimpgrens ----------
// Een bron die wel antwoordt maar veel minder oplevert dan de vorige keer, is eerder stuk (andere
// opmaak, leeg kanaal) dan leeg. Vergeleken worden alleen items die vandaag nog lopen of komen, zodat
// items die gewoon voorbij zijn nooit als krimp tellen.
export const SHRINK_MIN_PREVIOUS = 4;
export const SHRINK_MAX_LOSS = 0.5;
export const ALLOW_DROP_ENV = "AGENDA_ALLOW_DROP";

// Geeft { before, after } terug als de daling verdacht is, anders null.
//   - 0 komende items terwijl de vorige versie er meer dan 0 had;
//   - of meer dan de helft minder komende items, als de vorige versie er minstens 4 had.
export function suspiciousDrop(previousItems, nextItems, today) {
  const before = upcomingCount(Array.isArray(previousItems) ? previousItems : [], today);
  if (before === 0) return null;
  const after = upcomingCount(Array.isArray(nextItems) ? nextItems : [], today);
  if (after === 0) return { before, after };
  if (before >= SHRINK_MIN_PREVIOUS && after < before * (1 - SHRINK_MAX_LOSS)) return { before, after };
  return null;
}

// Een bewuste, grote daling laat de eigenaar toe met AGENDA_ALLOW_DROP=<sourceId>[,<sourceId>…].
// De dagelijkse automatische ronde zet dit nooit.
export function dropAllowed(env, sourceId) {
  return String(env?.[ALLOW_DROP_ENV] ?? "")
    .split(",")
    .map((value) => value.trim())
    .includes(sourceId);
}

// Voor de fetchers: null als het nieuwe resultaat weggeschreven mag worden, anders een statusregel
// "error"/"suspicious_drop" waarbij de vorige data blijft staan.
export function guardShrink({ rootDir, sourceId, previous, items, today, env, log, counts = {} }) {
  const drop = previous ? suspiciousDrop(previous.items, items, today) : null;
  if (!drop) return null;
  if (dropAllowed(env, sourceId)) {
    log(JSON.stringify({ source: sourceId, dropAllowed: true, upcomingBefore: drop.before, upcomingAfter: drop.after }));
    return null;
  }
  log(JSON.stringify({ ...counts, source: sourceId, fetchStatus: "error", errorCode: "suspicious_drop", upcomingBefore: drop.before, upcomingAfter: drop.after }));
  return keepPreviousOnError(rootDir, sourceId, previous, "suspicious_drop");
}
