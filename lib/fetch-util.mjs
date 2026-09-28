// Gedeelde hulp voor de fetchers. Alleen de fetchers en scripts/refresh-fetch.mjs gebruiken dit;
// niets hiervan draait in `npm run check`.
import fs from "node:fs";
import path from "node:path";

import { validateEventContract } from "./event-contract.mjs";
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
export function screenItems(items) {
  const passed = [];
  const rejected = { privacy: 0, contract: 0, duplicate: 0 };
  const seen = new Set();
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
    const contract = validateEventContract([...passed, item]);
    if (contract.errors.some((error) => error.index === passed.length)) {
      rejected.contract += 1;
      continue;
    }
    seen.add(item.id);
    passed.push(item);
  }
  return { items: passed, rejected };
}

export function statusEntry(sourceId, { fetchStatus, retrievedAt = null, itemCount = 0, errorCode = null }) {
  const definition = SOURCE_DEFINITIONS[sourceId];
  return {
    sourceId,
    file: sourceFileName(sourceId),
    scope: definition.scope,
    fetchStatus,
    retrievedAt,
    maxAgeHours: MAX_AGE_HOURS,
    itemCount,
    errorCode,
  };
}

// Bij een fout: vorige items en retrievedAt blijven, alleen fetchStatus wordt "error".
export function keepPreviousOnError(rootDir, sourceId, previous, errorCode, { dryRun = false } = {}) {
  const document = sourceDocument(sourceId, {
    retrievedAt: previous?.retrievedAt ?? null,
    fetchStatus: "error",
    contentVersion: previous?.contentVersion ?? null,
    items: previous?.items ?? [],
  });
  if (!dryRun) writeSourceDocument(rootDir, sourceId, document);
  return statusEntry(sourceId, { fetchStatus: "error", retrievedAt: document.retrievedAt, itemCount: document.items.length, errorCode });
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
