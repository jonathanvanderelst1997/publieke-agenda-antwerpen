// Strikte validatie van de mail-signalen van de Brain Gateway (contract C5) en de
// herverificatie op de officiële pagina. Puur, op sha256 na: geen klok, geen netwerk.
import { createHash } from "node:crypto";

import { normalized } from "./event-contract.mjs";
import { MONTH_NAMES_NL, decodeEntities, isValidIsoDate } from "./html-text.mjs";
import { MAIL_ALLOWED_HOSTS } from "./source-feed.mjs";

export const MAX_SIGNAL_ITEMS = 200;
export const MAX_SIGNAL_BYTES = 64 * 1024;
export const SENDER_CLASSES = Object.freeze(["district_nieuwsbrief", "burgerbegroting", "publieke_ruimte", "participatie"]);
const TRACKING_HOST = /(?:^|\.)nieuwsbrief\.antwerpen\.be$|(?:^|\.)createsend[a-z0-9-]*\.[a-z]+$|(?:^|\.)confirmsubscription\.com$/i;
const DATE_OR_DATETIME = /^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d)?$/;
const TOP_KEYS = ["schema_version", "generated_on", "items"];
const ITEM_KEYS = ["id", "title", "start", "end", "all_day", "place", "url", "group", "source", "sender_class", "first_seen", "page_checked_on"];

export function sha256Hex(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

// Een URL is bruikbaar als hij https is, op een toegelaten host staat, geen query, fragment of
// gebruikersgegevens draagt en geen trackinghost is.
export function allowedSignalUrl(value) {
  const raw = String(value ?? "");
  if (!raw.startsWith("https://") || /[?#@\s]/.test(raw)) return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.search || url.hash || url.username || url.password || url.port) return false;
    if (TRACKING_HOST.test(url.hostname)) return false;
    return MAIL_ALLOWED_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
}

function validDateOrDateTime(value) {
  return typeof value === "string" && DATE_OR_DATETIME.test(value) && isValidIsoDate(value.slice(0, 10));
}

function hasAtSign(value) {
  if (typeof value === "string") return value.includes("@");
  if (Array.isArray(value)) return value.some(hasAtSign);
  if (value && typeof value === "object") return Object.entries(value).some(([key, child]) => key.includes("@") || hasAtSign(child));
  return false;
}

// Geeft { ok, errors } terug. Eén fout verwerpt de hele payload.
export function validateMailSignals(payload, { byteLength = 0 } = {}) {
  const errors = [];
  if (byteLength > MAX_SIGNAL_BYTES) errors.push("payload_too_large");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, errors: [...errors, "not_an_object"] };
  if (hasAtSign(payload)) errors.push("at_sign");
  for (const key of Object.keys(payload)) if (!TOP_KEYS.includes(key)) errors.push(`unknown_key:${key}`);
  if (payload.schema_version !== 1) errors.push("schema_version");
  if (typeof payload.generated_on !== "string" || !isValidIsoDate(payload.generated_on)) errors.push("generated_on");
  if (!Array.isArray(payload.items)) return { ok: false, errors: [...errors, "items_not_array"] };
  if (payload.items.length > MAX_SIGNAL_ITEMS) errors.push("too_many_items");
  const ids = new Set();
  payload.items.forEach((item, index) => {
    const at = `items[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`${at}:not_an_object`);
      return;
    }
    for (const key of Object.keys(item)) if (!ITEM_KEYS.includes(key)) errors.push(`${at}:unknown_key`);
    for (const key of ITEM_KEYS) if (!(key in item)) errors.push(`${at}:missing_${key}`);
    if (typeof item.id !== "string" || !/^[0-9a-f]{64}$/.test(item.id)) errors.push(`${at}:id`);
    else if (ids.has(item.id)) errors.push(`${at}:duplicate_id`);
    ids.add(item.id);
    if (typeof item.title !== "string" || !item.title.trim() || item.title.length > 160) errors.push(`${at}:title`);
    if (!validDateOrDateTime(item.start)) errors.push(`${at}:start`);
    if (item.end !== null && (!validDateOrDateTime(item.end) || String(item.end).slice(0, 10) < String(item.start).slice(0, 10))) errors.push(`${at}:end`);
    if (typeof item.all_day !== "boolean") errors.push(`${at}:all_day`);
    if (item.place !== null && (typeof item.place !== "string" || !item.place.trim() || item.place.length > 160)) errors.push(`${at}:place`);
    if (typeof item.url !== "string" || item.url.length > 500 || !allowedSignalUrl(item.url)) errors.push(`${at}:url`);
    else if (typeof item.id === "string" && item.id !== sha256Hex(item.url)) errors.push(`${at}:id_not_sha256_of_url`);
    if (!["district", "stad"].includes(item.group)) errors.push(`${at}:group`);
    if (item.source !== "mail-nieuwsbrief") errors.push(`${at}:source`);
    if (!SENDER_CLASSES.includes(item.sender_class)) errors.push(`${at}:sender_class`);
    if (typeof item.first_seen !== "string" || !isValidIsoDate(item.first_seen)) errors.push(`${at}:first_seen`);
    if (typeof item.page_checked_on !== "string" || !isValidIsoDate(item.page_checked_on)) errors.push(`${at}:page_checked_on`);
  });
  return { ok: errors.length === 0, errors };
}

// Leesbare tekst van een HTML-pagina, genormaliseerd zoals het eventcontract dat doet.
export function pageText(html) {
  const withoutCode = String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ");
  return normalized(decodeEntities(withoutCode).replace(/[  -​ ]/g, " "));
}

export function titleOnPage(title, text) {
  const needle = normalized(decodeEntities(title));
  return Boolean(needle) && text.includes(needle);
}

// Aanvaardt de startdatum als "d maand", "d/m" (ook met voorloopnul) of ISO.
export function dateOnPage(isoDate, text) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const monthName = MONTH_NAMES_NL[month - 1];
  const patterns = [
    new RegExp(`(?<![0-9])0?${day}(?:ste|de|e)?\\s+${monthName}(?![a-z])`),
    new RegExp(`(?<![0-9/])0?${day}\\s*/\\s*0?${month}(?![0-9])`),
    new RegExp(`(?<![0-9])${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}(?![0-9])`),
  ];
  return patterns.some((pattern) => pattern.test(text));
}
