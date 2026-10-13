// Strikte validatie van de mail-signalen van de Brain Gateway (contract C5) en de
// herverificatie op de officiële pagina. Puur, op sha256 na: geen klok, geen netwerk.
import { createHash } from "node:crypto";

import { normalized } from "./event-contract.mjs";
import { MONTH_NAMES_NL, decodeEntities, isValidIsoDate } from "./html-text.mjs";
import { MAIL_ALLOWED_HOSTS, MAIL_PAGE_HOSTS } from "./source-feed.mjs";

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
// UiTinVlaanderen: de voorwaarden van UiT verbieden het overnemen van hun gegevens zonder schriftelijk
// akkoord, en de pagina's zitten achter een robotcontrole. Een mailsignaal met zo'n link wordt dus nooit
// opgehaald, ook niet via een doorverwijzing (fetchOfficialPage), en omdat niemand titel en datum op een
// officiële pagina kan nakijken, wordt het ook niet gepubliceerd: het telt alleen in de status
// (uit_niet_nagekeken, scripts/fetch-sources-mail.mjs). Of zo'n signaal toch als "niet nagekeken" met alleen de
// link mag verschijnen, beslist de eigenaar.
export const UIT_HOSTS = Object.freeze(["www.uitinvlaanderen.be", "uitinvlaanderen.be"]);
export function isUitLink(value) {
  try { return UIT_HOSTS.includes(new URL(String(value ?? "")).hostname); } catch { return false; }
}

// Een officiële pagina die opgehaald mag worden: een toegelaten signaal-URL, maar nooit UiT.
export function fetchableSignalUrl(value) {
  return allowedSignalUrl(value) && !isUitLink(value) && MAIL_PAGE_HOSTS.includes(new URL(String(value)).hostname);
}

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

// Een titel telt pas als bewijs als hij specifiek genoeg is: minstens 12 tekens én 2 woorden.
// "Opening" of "Receptie" plus een datum ergens op een pagina bewijst niets.
export const MIN_TITLE_CHARS = 12;
export const MIN_TITLE_WORDS = 2;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Staat `needle` (al genormaliseerd) als geheel op de pagina, niet als stuk van een langer woord?
function containsPhrase(text, needle) {
  if (!needle) return false;
  return new RegExp(`(?<![a-z0-9])${escapeRegExp(needle)}(?![a-z0-9])`).test(text);
}

export function titleSpecificEnough(title) {
  const needle = normalized(decodeEntities(title));
  const words = needle.split(/[^a-z0-9]+/).filter(Boolean);
  return needle.length >= MIN_TITLE_CHARS && words.length >= MIN_TITLE_WORDS;
}

export function titleOnPage(title, text) {
  return titleSpecificEnough(title) && containsPhrase(text, normalized(decodeEntities(title)));
}

// Tweede slot naast de Gateway: een titel die zichzelf privé noemt, wordt nooit publiek.
const PRIVATE_MARKERS = /(?<![a-z0-9])(?:persoonlijke? uitnodiging|prive|besloten|vertrouwelijk|genodigden|niet doorsturen)(?![a-z0-9])/;

export function hasPrivateMarker(title) {
  return PRIVATE_MARKERS.test(normalized(decodeEntities(title)));
}

// Een plaats wordt alleen overgenomen als ze op de officiële pagina staat: als geheel, of elk deel
// tussen komma's apart ("Districtshuis Harmonie, 2018 Antwerpen"). Anders: niet overnemen.
export function placeOnPage(place, text) {
  const needle = normalized(decodeEntities(place ?? ""));
  if (!needle) return false;
  if (containsPhrase(text, needle)) return true;
  const parts = needle.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 && parts.every((part) => part.length >= 3 && containsPhrase(text, part));
}

// Een uur (HH:MM) staat op de pagina als "19 uur", "19u", "19u30", "19.30", "19:30", "19h" of als
// begin of einde van een bereik ("19 tot 21 uur", "19-21u").
export function timeOnPage(time, text) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(time ?? ""));
  if (!match) return false;
  const hour = `0?${Number(match[1])}`;
  const minutes = match[2];
  const before = "(?<![0-9:.,])";
  const unit = "(?:u(?:ur)?|h)(?![a-z])";
  const clock = `[:.hu]\\s*${minutes}(?![0-9])`;
  const patterns =
    minutes === "00"
      ? [
          `${before}${hour}\\s*(?:${clock}|${unit})`,
          `${before}${hour}\\s*(?:-|–|—|tot)\\s*\\d{1,2}(?:\\s*[:.hu]\\s*\\d{2})?\\s*${unit}`,
        ]
      : [`${before}${hour}\\s*${clock}`];
  return patterns.some((pattern) => new RegExp(pattern).test(text));
}

// Afgekorte maandnamen zoals de stad ze schrijft ("17 okt.", "3 sept"), dezelfde als de paginapoort van de
// Mac (src/publieke-agenda/datums.ts in de Gateway).
const MONTH_SHORT_NL = Object.freeze([["jan"], ["feb"], ["mrt"], ["apr"], [], ["jun"], ["jul"], ["aug"], ["sept", "sep"], ["okt"], ["nov"], ["dec"]]);
// "tot", "t.e.m.", "t/m", "tem", "tot en met" of een streepje tussen twee dagen van een reeks.
const RANGE_WORD = "(?:tot\\s+en\\s+met|t\\.?\\s?e\\.?\\s?m\\.?|t\\/m|tem|tot|-|–|—)";
const WEEKDAY = "(?:maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|woe|ma|di|wo|do|vr|za|zo)\\.?";

// Staat de startdatum op de pagina? Alleen deze vormen, met de dag en de maand van de datum zelf:
//   - "17 oktober", "17 okt." (ook "17de oktober");
//   - "17/10", ISO "2026-10-17", "17.10.2026" of "17-10-2026" (met het jaar);
//   - als begin van een reeks: "3 tot 25 oktober", "3 t.e.m. vr 25/10" (de maand staat achter het einde).
// Dat zijn de vormen die de paginapoort van de Mac (datums.ts) als datum leest: zonder de laatste twee
// viel een signaal dat de Mac terecht doorliet hier alsnog weg als date_not_on_page.
export function dateOnPage(isoDate, text) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const monthNames = [MONTH_NAMES_NL[month - 1], ...MONTH_SHORT_NL[month - 1]].join("|");
  const dayAt = `(?<![0-9])0?${day}`;
  const patterns = [
    new RegExp(`${dayAt}(?:ste|de|e)?\\s+(?:${monthNames})(?![a-z])`),
    new RegExp(`(?<![0-9/])0?${day}\\s*/\\s*0?${month}(?![0-9])`),
    new RegExp(`(?<![0-9])${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}(?![0-9])`),
    new RegExp(`(?<![0-9.-])0?${day}(?<teken>[.-])0?${month}\\k<teken>${year}(?![0-9])`),
    new RegExp(`${dayAt}\\s*${RANGE_WORD}\\s*(?:${WEEKDAY}\\s+)?\\d{1,2}\\s+(?:${monthNames})(?![a-z])`),
    new RegExp(`${dayAt}\\s*${RANGE_WORD}\\s*(?:${WEEKDAY}\\s+)?\\d{1,2}\\s*/\\s*0?${month}(?![0-9])`),
  ];
  return patterns.some((pattern) => pattern.test(text));
}
