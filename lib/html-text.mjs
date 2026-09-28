// Kleine, afhankelijkheidsvrije hulpfuncties om publieke HTML van de stad te lezen.
// Puur: geen klok, geen netwerk.

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  bull: "•",
  middot: "·",
  hellip: "…",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  sbquo: "‚",
  ldquo: "“",
  rdquo: "”",
  bdquo: "„",
  laquo: "«",
  raquo: "»",
  euro: "€",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  deg: "°",
  copy: "©",
  reg: "®",
  trade: "™",
  shy: "",
  zwj: "",
  zwnj: "",
  times: "×",
  eacute: "é",
  egrave: "è",
  ecirc: "ê",
  euml: "ë",
  Eacute: "É",
  Egrave: "È",
  Ecirc: "Ê",
  Euml: "Ë",
  aacute: "á",
  agrave: "à",
  acirc: "â",
  auml: "ä",
  Aacute: "Á",
  Agrave: "À",
  Auml: "Ä",
  iacute: "í",
  igrave: "ì",
  icirc: "î",
  iuml: "ï",
  Iuml: "Ï",
  oacute: "ó",
  ograve: "ò",
  ocirc: "ô",
  ouml: "ö",
  Ouml: "Ö",
  uacute: "ú",
  ugrave: "ù",
  ucirc: "û",
  uuml: "ü",
  Uuml: "Ü",
  ccedil: "ç",
  Ccedil: "Ç",
  ntilde: "ñ",
  szlig: "ß",
};

export function decodeEntities(value) {
  return String(value ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, name) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
      return String.fromCodePoint(code);
    }
    return Object.hasOwn(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : whole;
  });
}

// Normaliseert witruimte, inclusief harde spaties en onzichtbare tekens.
export function cleanText(value) {
  return decodeEntities(value)
    .replace(/[  -​  　﻿]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const BLOCK_TAG = /<\/?(?:p|div|li|ul|ol|h[1-6]|table|thead|tbody|tr|td|th|section|article|figure|figcaption|blockquote)\b[^>]*>/gi;

// Blokelementen en <br> worden een spatie; inline-tags (span, strong, em, a …) verdwijnen
// zonder spatie, zodat "<span>W</span><span>intermagie</span>" één woord blijft.
export function stripTags(html) {
  return cleanText(
    String(html ?? "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(BLOCK_TAG, " ")
      .replace(/<[^>]*>/g, "")
  );
}

const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

// Haalt elk e-mailadres (en het restje "mailto:") uit een tekst.
export function stripEmails(value) {
  return cleanText(String(value ?? "").replace(/mailto:/gi, " ").replace(EMAIL_PATTERN, " ").replace(/\(\s*\)/g, " "));
}

export function containsEmail(value) {
  return /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(String(value ?? ""));
}

// Aanvaardt alleen https-links met een echte hostnaam, zonder querystring,
// fragment of gebruikersgegevens. Alles anders geeft "".
export function safeHttpsUrl(value) {
  const raw = cleanText(value);
  if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}\//i.test(raw)) return "";
  if (/[?#@\s]/.test(raw)) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return "";
    return url.href;
  } catch {
    return "";
  }
}

export const MONTH_NAMES_NL = Object.freeze([
  "januari",
  "februari",
  "maart",
  "april",
  "mei",
  "juni",
  "juli",
  "augustus",
  "september",
  "oktober",
  "november",
  "december",
]);

const brusselsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Brussels",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

// Datum en uur in Europe/Brussels voor een ISO-tijdstip of Date. Leest geen klok.
export function brusselsParts(value) {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(brusselsFormatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    seconds: parts.second,
  };
}

export function brusselsDate(value) {
  return brusselsParts(value)?.date ?? null;
}

// Offset van Europe/Brussels op een kalenderdag, bv. "+02:00".
export function brusselsOffset(isoDate) {
  const noonUtc = new Date(`${isoDate}T12:00:00Z`);
  const local = brusselsParts(noonUtc);
  if (!local) return "+01:00";
  const hours = Number(local.time.slice(0, 2)) - 12;
  return `${hours >= 0 ? "+" : "-"}${String(Math.abs(hours)).padStart(2, "0")}:00`;
}

export function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""))) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function addDaysIso(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// 0 = zondag … 6 = zaterdag, zoals Date#getDay.
export function weekdayOfIso(isoDate) {
  return new Date(`${isoDate}T12:00:00Z`).getUTCDay();
}

export function formatDutchDate(isoDate) {
  if (!isValidIsoDate(isoDate)) return "";
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${day} ${MONTH_NAMES_NL[month - 1]} ${year}`;
}

export function dutchDateLabel(date, endDate) {
  if (!endDate || endDate === date) return formatDutchDate(date);
  return `${formatDutchDate(date)} tot en met ${formatDutchDate(endDate)}`;
}
