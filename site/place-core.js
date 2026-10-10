// Zoeken op plek: pure functies, zonder netwerk en zonder DOM (draaien ook in de Node-toetsen).
// - normaliseren van wat iemand intypt ("Kammenstr. 12", "st.-jansplein", "zurenborg 2018");
// - suggesties uit de officiële straatnamen (site/geo/straten.json), de wijken en de postcodes;
// - een plek in de URL (?plek=Kammenstraat, ?plek=Zurenborg, ?plek=2060);
// - kalenderhulp: periodes, weken, maandrooster en balken voor meerdaagse items.

import { bundelInnames, evenementFeiten, evenementKaartje, geldigeHuisnummers, isEvenementDossier, koppelEvenement, soortEvenement, statusTekst, werkFeiten, werkKaartje, zonderHuisnummer } from "./kaart-uitleg.js";
import { isTunnel, stratenVanParcours } from "./parcours-straten.js";
import { locationKey } from "./neighborhood-core.js";
import { aanvraagStand, aanvraagTitel, waarTekst } from "./permit-clarity.js";

export const DISTRICT_POSTCODES = Object.freeze({
  2000: "Antwerpen (centrum)",
  2018: "Antwerpen (Zuid, Zurenborg, Brederode)",
  2020: "Antwerpen (Kiel, Middelheim)",
  2030: "Antwerpen (Luchtbal, haven)",
  2050: "Antwerpen (Linkeroever)",
  2060: "Antwerpen (Noord)",
});

// Andere districten: geen gegokte resultaten, maar een duidelijke uitleg.
export const OTHER_DISTRICTS = Object.freeze([
  "Berchem", "Borgerhout", "Deurne", "Ekeren", "Hoboken", "Merksem", "Wilrijk", "Berendrecht", "Zandvliet", "Lillo", "Borsbeek",
]);

// Hoofdletters, accenten, apostrofs en leestekens tellen niet mee.
export function foldText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const SUFFIX_ABBREVIATIONS = [
  [/(\w)str$/, "$1straat"],
  [/(\w)stwg$/, "$1steenweg"],
  [/(\w)stw$/, "$1steenweg"],
  [/(\w)ln$/, "$1laan"],
  [/(\w)pl$/, "$1plein"],
];
const WORD_ABBREVIATIONS = new Map([
  ["str", "straat"], ["st", "sint"], ["stwg", "steenweg"], ["ln", "laan"], ["pl", "plein"], ["o", "onze"], ["l", "lieve"], ["vr", "vrouw"],
]);
const NOISE = new Set(["antwerpen", "antwerp", "anvers", "belgie", "belgium", "bus", "nr", "nummer", "district", "wijk"]);

// Een zoekvraag ontleden: postcode apart, huisnummers weg, afkortingen uitgeschreven.
// Geeft { text, compact, postcode } terug; compact is zonder spaties ("de coninckplein" → "deconinckplein").
export function parseQuery(value) {
  let postcode = "";
  const words = [];
  const tokens = foldText(value).split(" ").filter(Boolean);
  for (let i = 0; i < tokens.length; i += 1) {
    let token = tokens[i];
    if (/^2\d{3}$/.test(token) && !postcode) { postcode = token; continue; }
    if (/^\d+[a-z]?$/.test(token) || /^\d+$/.test(token)) continue; // huisnummer of busnummer
    if (/^\d+[a-z]{1,2}$/.test(token)) continue;
    if (NOISE.has(token)) continue;
    if (token === "bus") { i += 1; continue; }
    // "Kammen str" → "kammenstraat": een losse afkorting hoort bij het vorige woord.
    if ((token === "str" || token === "straat") && words.length) { words[words.length - 1] += "straat"; continue; }
    if (token === "st" && i === tokens.length - 1 && words.length) { words[words.length - 1] += "straat"; continue; }
    if (WORD_ABBREVIATIONS.has(token)) token = WORD_ABBREVIATIONS.get(token);
    else for (const [pattern, replacement] of SUFFIX_ABBREVIATIONS) if (pattern.test(token)) { token = token.replace(pattern, replacement); break; }
    words.push(token);
  }
  const text = words.join(" ");
  return { text, compact: text.replace(/ /g, ""), postcode };
}

// Damerau-Levenshtein, afgebroken zodra de afstand groter wordt dan max.
export function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2 = new Array(b.length + 1).fill(0);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    for (let j = 0; j <= b.length; j += 1) prev2[j] = prev[j];
    prev = cur;
  }
  return prev[b.length];
}

const compactOf = (value) => foldText(value).replace(/ /g, "");

// Index van alle plekken. streets: rijen uit straten.json ([id, naam, postcode, wijken, kader]);
// wijken: [{ code, naam, box }]; counts: optioneel aantal items per straat-/wijksleutel (voor de rangorde).
export function buildPlaceIndex({ streets = [], wijken = [] } = {}) {
  const wijkByCode = new Map(wijken.map((w) => [w.code, w]));
  const nameCount = new Map();
  for (const row of streets) nameCount.set(row[1], (nameCount.get(row[1]) || 0) + 1);
  const places = [];
  for (const [id, name, postcode, codes = [], box = null] of streets) {
    const wijk = wijkByCode.get(codes[0]);
    places.push({
      type: "straat",
      key: `straat:${id}|${name}|${postcode}`,
      id: String(id),
      name,
      postcode: String(postcode || ""),
      wijken: codes,
      box,
      label: name,
      sub: [postcode, wijk ? `wijk ${wijk.naam}` : ""].filter(Boolean).join(" · "),
      ambiguous: nameCount.get(name) > 1,
      compact: compactOf(name),
      words: foldText(name).split(" "),
    });
  }
  for (const w of wijken) {
    const streetsIn = streets.filter((row) => (row[3] || []).includes(w.code)).length;
    places.push({
      type: "wijk", key: `wijk:${w.code}`, code: w.code, name: w.naam, box: w.box || null,
      label: w.naam, sub: `wijk · ${streetsIn} straten`, compact: compactOf(w.naam), words: foldText(w.naam).split(" "),
      aliases: wijkAliases(w.naam).map(compactOf),
    });
  }
  for (const [code, label] of Object.entries(DISTRICT_POSTCODES)) {
    const rows = streets.filter((row) => String(row[2]) === code && row[4]);
    const box = rows.length ? rows.reduce((b, row) => [Math.min(b[0], row[4][0]), Math.min(b[1], row[4][1]), Math.max(b[2], row[4][2]), Math.max(b[3], row[4][3])], [180, 90, -180, -90]) : null;
    places.push({ type: "postcode", key: `postcode:${code}`, code, name: code, box, label: code, sub: label, compact: code, words: [code] });
  }
  return { places, byKey: new Map(places.map((p) => [p.key, p])) };
}

function wijkAliases(name) {
  const out = [];
  if (/&/.test(name)) out.push(...name.split("&").map((part) => part.trim()));
  if (/^zuid$/i.test(name)) out.push("t zuid", "het zuid");
  if (/eilandje/i.test(name)) out.push("het eilandje");
  if (/historisch centrum/i.test(name)) out.push("centrum", "binnenstad", "oude stad");
  if (/centraal station/i.test(name)) out.push("centraal", "station", "diamantwijk");
  if (/stuivenberg/i.test(name)) out.push("seefhoek");
  if (/linkeroever/i.test(name)) out.push("lo", "sint anna");
  if (/amandus/i.test(name)) out.push("noord", "dam");
  return out;
}

const TYPE_RANK = { wijk: 0, postcode: 1, straat: 2 };

// Suggesties voor wat iemand typt. Rangorde: exact, begint met, woord begint met, bevat, tikfout.
export function searchPlaces(index, query, { limit = 8, counts = null } = {}) {
  const q = parseQuery(query);
  const places = index?.places || [];
  if (!q.compact && q.postcode) return places.filter((p) => p.type === "postcode" && p.code === q.postcode).map((place) => ({ place, score: 100, match: "exact" }));
  if (!q.compact) return [];
  const results = [];
  const fuzzyMax = q.compact.length >= 9 ? 2 : q.compact.length >= 5 ? 1 : 0;
  for (const place of places) {
    if (place.type === "postcode") {
      if (place.code.startsWith(q.compact)) results.push({ place, score: place.code === q.compact ? 100 : 70, match: "prefix" });
      continue;
    }
    if (q.postcode && place.type === "straat" && place.postcode && place.postcode !== q.postcode) continue;
    let score = 0, match = "";
    const names = [place.compact, ...(place.aliases || [])];
    if (names.includes(q.compact)) { score = 100; match = "exact"; }
    else if (names.some((n) => n.startsWith(q.compact))) { score = 80 - Math.min(20, place.compact.length - q.compact.length) / 2; match = "prefix"; }
    else if (place.words.some((w, i) => compactOf(place.words.slice(i).join(" ")).startsWith(q.compact))) { score = 62; match = "word"; }
    else if (q.compact.length >= 3 && place.compact.includes(q.compact)) { score = 45; match = "contains"; }
    else if (fuzzyMax) {
      const d = Math.min(editDistance(q.compact, place.compact, fuzzyMax), ...((place.aliases || []).map((a) => editDistance(q.compact, a, fuzzyMax))));
      if (d <= fuzzyMax) { score = 35 - d * 5; match = "fuzzy"; }
      else if (q.compact.length >= 6 && place.compact.length > q.compact.length) {
        // Tikfout in het begin van een langere naam ("schrijfstr" → "schijfstraat").
        const head = place.compact.slice(0, q.compact.length);
        if (editDistance(q.compact, head, 1) <= 1) { score = 28; match = "fuzzy"; }
      }
    }
    if (!score) continue;
    if (counts) score += Math.min(6, counts.get(place.key) || 0);
    results.push({ place, score, match });
  }
  // Tikfoutsuggesties alleen als er niets beters is.
  if (results.some((r) => r.match !== "fuzzy")) results.splice(0, results.length, ...results.filter((r) => r.match !== "fuzzy"));
  results.sort((a, b) => b.score - a.score || TYPE_RANK[a.place.type] - TYPE_RANK[b.place.type] || a.place.label.localeCompare(b.place.label, "nl") || String(a.place.postcode || "").localeCompare(String(b.place.postcode || "")));
  return results.slice(0, limit);
}

// Wie "Berchem" of "Deurne" typt, zoekt buiten het district: zeg dat eerlijk.
export function otherDistrictFor(query) {
  const compact = parseQuery(query).compact;
  if (!compact) return "";
  return OTHER_DISTRICTS.find((name) => compactOf(name) === compact) || "";
}

// ---- plek in de URL ----
// Leesbaar en deelbaar: ?plek=Kammenstraat, ?plek=Zurenborg, ?plek=2060. Alleen bij dubbelzinnigheid
// komt er meer bij: "De Keyserlei 2018" (zelfde naam, twee postcodes) of "straat:Kiel…" vs "wijk:Kiel".
export function placeParam(place, index) {
  if (!place) return "";
  if (place.type === "postcode") return place.code;
  const clash = (index?.places || []).some((p) => p !== place && p.type !== place.type && p.compact === place.compact);
  const prefix = clash ? `${place.type}:` : "";
  if (place.type === "straat" && place.ambiguous) return `${prefix}${place.name} ${place.postcode}`;
  return `${prefix}${place.name}`;
}

export function resolvePlaceParam(index, value) {
  const raw = String(value ?? "").trim();
  if (!raw || !index) return null;
  const typed = raw.match(/^(straat|wijk|postcode):(.*)$/i);
  const type = typed ? typed[1].toLowerCase() : "";
  const body = typed ? typed[2] : raw;
  if (index.byKey.has(raw)) return index.byKey.get(raw);
  const q = parseQuery(body);
  const candidates = index.places.filter((p) => (!type || p.type === type));
  if (!q.compact && q.postcode) return candidates.find((p) => p.type === "postcode" && p.code === q.postcode) || null;
  const exact = candidates.filter((p) => p.compact === q.compact && p.type !== "postcode" && (!q.postcode || p.type !== "straat" || p.postcode === q.postcode));
  exact.sort((a, b) => TYPE_RANK[a.type] - TYPE_RANK[b.type]);
  return exact[0] || null;
}

// ---- datums ----
export const isoDay = (value) => (/^\d{4}-\d{2}-\d{2}/.test(String(value || "")) ? String(value).slice(0, 10) : "");
const toUtc = (iso) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d, 12); };
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (iso, days) => fromUtc(toUtc(iso) + days * 86400000);
export const daysBetween = (a, b) => Math.round((toUtc(b) - toUtc(a)) / 86400000);
export const weekdayMon0 = (iso) => (new Date(toUtc(iso)).getUTCDay() + 6) % 7;
export const startOfWeek = (iso) => addDays(iso, -weekdayMon0(iso));
export const startOfMonth = (iso) => `${iso.slice(0, 7)}-01`;
export function addMonths(iso, n) {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1, 12));
  return d.toISOString().slice(0, 10);
}

export const PERIODS = Object.freeze([
  ["week", "7 dagen", 7],
  ["maand", "30 dagen", 30],
  ["kwartaal", "3 maanden", 92],
  ["alles", "Alles", 3650],
]);
export function periodRange(key, today) {
  const days = (PERIODS.find(([k]) => k === key) || PERIODS[1])[2];
  return { from: today, to: addDays(today, days - 1) };
}

// Maandrooster: weken van maandag t/m zondag die de maand raken.
export function monthWeeks(monthIso) {
  const first = startOfMonth(monthIso);
  const nextMonth = addMonths(first, 1);
  const weeks = [];
  for (let start = startOfWeek(first); start < nextMonth; start = addDays(start, 7)) weeks.push(start);
  return weeks;
}

// Een evenement op straat heeft twee periodes: de dag(en) van het evenement zelf (start/end, voor
// de titel en de plaats in de lijst) en de innameperiode van opbouw tot afbraak (innameStart/
// innameEind). Filter, overlap, balken en "nu bezig" volgen de innameperiode: tijdens de afbraak
// staat er nog een parkeerverbod in de straat.
export function periodeVan(entry) {
  const start = entry?.start || "", end = entry?.end || "";
  const ps = entry?.innameStart && (!start || entry.innameStart < start) ? entry.innameStart : start;
  const pe = entry?.innameEind && entry.innameEind > (end || start) ? entry.innameEind : end;
  return { start: ps, end: pe && pe !== ps ? pe : "" };
}
// Waar staat een evenement op straat op een dag: "gepland", "opbouw", "evenement", "afbraak" of
// "voorbij". Leeg voor alles zonder innameperiode.
export function evenementFase(entry, day) {
  if (!entry?.innameStart || !day) return "";
  const p = periodeVan(entry), es = entry.start || p.start, ee = entry.end || es;
  if (day < p.start) return "gepland";
  if (day > (p.end || p.start)) return "voorbij";
  if (day < es) return "opbouw";
  if (day > ee) return "afbraak";
  return "evenement";
}

// Overlapt een item [start, end] met [from, to]? Een item zonder einde telt als één dag
// (of als lopend tot het einde van het venster als openEnd gezet is).
export function overlaps(entry, from, to) {
  const { start, end: eind } = periodeVan(entry);
  const end = eind || (entry.openEnd ? to : start);
  return Boolean(start) && start <= to && end >= from;
}

// Balken voor één week: elk meerdaags item krijgt een baan (lane) zodat balken niet overlappen.
// Geeft [{ entry, col (0-6), span, lane, clippedStart, clippedEnd }] terug, plus het aantal banen.
export function layoutWeekBars(entries, weekStart, maxLanes = Infinity) {
  const weekEnd = addDays(weekStart, 6);
  const rows = entries
    .filter((entry) => overlaps(entry, weekStart, weekEnd))
    .map((entry) => {
      const p = periodeVan(entry);
      const end = p.end || (entry.openEnd ? weekEnd : p.start);
      const s = p.start < weekStart ? weekStart : p.start;
      const e = end > weekEnd ? weekEnd : end;
      return { entry, col: daysBetween(weekStart, s), span: daysBetween(s, e) + 1, clippedStart: p.start < weekStart, clippedEnd: end > weekEnd };
    })
    .sort((a, b) => a.col - b.col || b.span - a.span || String(a.entry.title).localeCompare(String(b.entry.title), "nl"));
  const lanes = [];
  const placed = [], hidden = [];
  for (const row of rows) {
    let lane = lanes.findIndex((busyUntil) => busyUntil < row.col);
    if (lane === -1) lane = lanes.length;
    if (lane >= maxLanes) { hidden.push(row); continue; }
    lanes[lane] = row.col + row.span - 1;
    placed.push({ ...row, lane });
  }
  // Per dag: hoeveel items er niet meer in een baan pasten.
  const overflow = Array(7).fill(0);
  for (const row of hidden) for (let c = row.col; c < row.col + row.span; c += 1) overflow[c] += 1;
  return { bars: placed, lanes: Math.min(lanes.length, maxLanes), overflow };
}

// Indeling van de lijst: wat nu loopt, en wat er per dag start of plaatsvindt binnen de periode.
// Een evenement op straat staat bij "nu bezig" tijdens opbouw en afbraak, en anders op de dag van
// het evenement; valt alleen de opbouw in de periode, dan op de eerste dag van de opbouw.
export function groupForList(entries, { from, to, today }) {
  const running = [], days = new Map(), later = [];
  for (const entry of entries) {
    const fase = evenementFase(entry, today);
    if (fase === "opbouw" || fase === "afbraak") { running.push(entry); continue; }
    const multi = Boolean((entry.end && entry.end > entry.start) || entry.openEnd);
    if (multi && entry.start <= today && (entry.openEnd || entry.end >= today)) { running.push(entry); continue; }
    if (!entry.start) continue;
    const p = periodeVan(entry);
    const end = p.end || entry.end || entry.start;
    if (end < from) continue;
    const begin = entry.start > to && p.start <= to ? p.start : entry.start;
    if (begin > to) { later.push(entry); continue; }
    const day = begin < from ? from : begin;
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(entry);
  }
  const byTitle = (a, b) => String(a.time || "99").localeCompare(String(b.time || "99")) || String(a.title).localeCompare(String(b.title), "nl");
  running.sort((a, b) => String(periodeVan(a).end || "9999").localeCompare(String(periodeVan(b).end || "9999")) || byTitle(a, b));
  later.sort((a, b) => a.start.localeCompare(b.start) || byTitle(a, b));
  return { running, days: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, list]) => [day, list.sort(byTitle)]), later };
}

// ---- soorten (de enige filterrij) ----
// Elke chip bundelt een paar onderliggende soorten van agenda-uitgaan.js en de live lagen.
export const KIND_GROUPS = Object.freeze([
  Object.freeze({ key: "evenementen", label: "Evenementen", emoji: "🎉", cat: "festival", themes: Object.freeze(["festival", "neighborhood", "culture", "family", "parade", "sport", "flea", "shopping", "other"]) }),
  Object.freeze({ key: "werken", label: "Werken & verkeer", emoji: "🚧", cat: "works", themes: Object.freeze(["works", "publicSpace"]) }),
  Object.freeze({ key: "inspraak", label: "Inspraak & info", emoji: "🗳️", cat: "admin", themes: Object.freeze(["admin", "info", "calls"]) }),
  Object.freeze({ key: "markten", label: "Markten", emoji: "🧺", cat: "markets", themes: Object.freeze(["markets"]) }),
  Object.freeze({ key: "raad", label: "Raad & commissies", emoji: "🏛️", cat: "meetings", themes: Object.freeze(["meetings"]) }),
  Object.freeze({ key: "vergunningen", label: "Vergunningen", emoji: "📄", cat: "permits", themes: Object.freeze(["permits"]) }),
]);
export const DEFAULT_GROUPS = Object.freeze(["evenementen"]);
export const themesForGroups = (groups) => KIND_GROUPS.filter((g) => groups.includes(g.key)).flatMap((g) => g.themes);
export const groupOfTheme = (theme) => (KIND_GROUPS.find((g) => g.themes.includes(theme)) || KIND_GROUPS[0]).key;
export function groupsForThemes(themes) {
  const set = new Set(themes);
  return KIND_GROUPS.filter((g) => g.themes.some((t) => set.has(t))).map((g) => g.key);
}

// ---- alles naar één vorm: "entries" voor lijst en kalender ----
const BRUSSELS_DAY = typeof Intl !== "undefined" ? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" }) : null;
// Kalenderdag in Brussel: een tijdstip als "2026-10-11T22:00:00Z" valt op 12 oktober.
export function dayOf(value) {
  const text = String(value ?? "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text)) return "";
  const ms = Date.parse(text);
  if (!Number.isFinite(ms) || !BRUSSELS_DAY) return text.slice(0, 10);
  return BRUSSELS_DAY.format(new Date(ms));
}
const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const streetNames = (item) => [...new Set((item?.streets || []).map((s) => s?.name).filter(Boolean))].join(", ");
const safeUrl = (value) => (/^https:\/\//i.test(String(value || "")) ? String(value) : "");

export function agendaEntry(item, theme = item?.category || "other") {
  const start = isoDay(item?.date);
  const end = isoDay(item?.endDate);
  const time = /^\d{2}:\d{2}$/.test(String(item?.timeSlot || "")) ? item.timeSlot : "";
  // Handmatige werken zonder harde einddatum ("tot voorjaar 2027") lopen door tot de bron iets anders zegt.
  const openEnd = theme === "works" && !end && /\btot\b/i.test(String(item?.dateLabel || ""));
  return {
    uid: `agenda:${item?.id}`, id: String(item?.id || ""), source: "agenda", theme, group: groupOfTheme(theme),
    title: cleanText(item?.title) || "Agendapunt", start, end: end && end > start ? end : "", openEnd,
    time, timeText: cleanText(item?.timeText), location: cleanText(item?.location), info: cleanText(item?.info),
    dateLabel: cleanText(item?.dateLabel), url: safeUrl(item?.infoUrl) || safeUrl(item?.link) || safeUrl(item?.sourceUrl),
    sourceUrl: safeUrl(item?.sourceUrl) || safeUrl(item?.link), status: "", item,
  };
}
// Feiten uit de verversing (site/sources/kaart-uitleg.json) aanvullen met de live laag: live is
// verser voor gevolgen en data, de verversing kent de huisnummers en het gekoppelde evenement.
// Huisnummers uit een oudere verversing gaan opnieuw door de controle ("nr. 0", "nr. 2001" niet).
function samenWerk(live, bewaard) {
  if (!bewaard) return live;
  const bewaardeNummers = geldigeHuisnummers(bewaard.huisnummers);
  return {
    ...live,
    soort: live.soort || bewaard.soort || "", soortBron: live.soort ? live.soortBron : bewaard.soortBron || "",
    fasen: live.fasen.length ? live.fasen : bewaard.fasen || [],
    huisnummers: live.huisnummers || bewaardeNummers, huisnummerBron: live.huisnummers ? live.huisnummerBron : bewaardeNummers ? bewaard.huisnummerBron || "" : "",
    // De straat van het GIPOD-punt eerst, dan de andere straten die de werfzone raakt.
    straten: werkStraten(live.straten, bewaard),
  };
}
// Straten van een werk: die van het punt, plus die van de werfzone (GIPOD INNAME-vlak) uit de
// verversing. Een werk over 100 m staat zo bij elke straat die het raakt, niet bij één.
export function werkStraten(puntStraten = [], bewaard = null) {
  return [...new Set([...(puntStraten || []), ...(Array.isArray(bewaard?.vlakStraten) ? bewaard.vlakStraten : [])].map(cleanText).filter(Boolean))];
}
export const gipodBronUrl = (gipodId) => (Number.isFinite(Number(gipodId)) && Number(gipodId) > 0
  ? `https://geo.api.vlaanderen.be/GIPOD/ogc/features/v1/collections/INNAME_PUNT/items?f=html&filter-lang=cql2-text&filter=GipodId%3D${Number(gipodId)}` : "");
export const iodBronUrl = (dossier) => (/^[A-Z0-9-]{4,40}$/.test(String(dossier || ""))
  ? `https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/22/query?where=dossierNummer%3D%27${dossier}%27&outFields=dossierNummer,faseNaam,faseStartDatum,faseEindDatum,innameTypeNaam,innameBeschrijving,innameHinder,type_dossier&returnGeometry=false&f=html` : "");

// Met `vandaag` krijgt het kaartje een titel en uitleg in gewone taal (site/kaart-uitleg.js).
export function workEntry(work, { vandaag = "", uitleg = null } = {}) {
  const base = workEntryBasis(work);
  if (!vandaag) return base;
  const k = werkKaartje(work, { vandaag, feiten: samenWerk(werkFeiten(work), uitleg?.werken?.[work?.gipodId]) });
  return { ...base, title: k.titel, summary: k.samenvatting, location: k.plek || base.location, uitleg: k, sourceUrl: gipodBronUrl(work?.gipodId) || base.sourceUrl };
}
// Eén werf in stukken (zelfde titel, periode, status, opdrachtgever en omschrijving, zoals de
// werfzones van Ringpark Zuid) wordt één kaart, met alle GIPOD-nummers erbij. Huisnummers in de
// omschrijving tellen niet: twee aansluitingen naast elkaar zijn één kaart.
export function werkEntries(works = [], opties = {}) {
  const groepen = new Map();
  for (const work of works) {
    const entry = workEntry(work, opties);
    const key = [entry.title, entry.start, entry.end, entry.status, cleanText(work?.owner), cleanText(work?.title).replace(/\d+\s?[a-z]?\b/gi, "#")].join("|");
    groepen.set(key, [...(groepen.get(key) || []), entry]);
  }
  return [...groepen.values()].map((lijst) => {
    if (lijst.length === 1) return lijst[0];
    const [eerste] = lijst;
    const ids = lijst.map((e) => e.item?.gipodId).filter(Boolean);
    const regel = ["Aantal", `${lijst.length} dossiers in GIPOD met dezelfde soort, plek en periode`];
    return { ...eerste, reference: `GIPOD ${ids.join(", ")}`, werfzones: lijst.length, uitleg: eerste.uitleg ? { ...eerste.uitleg, regels: [...eerste.uitleg.regels, regel] } : eerste.uitleg };
  });
}
// Het label naast de soort. Een werk waarvan de periode loopt maar dat GIPOD nog "concreet gepland"
// noemt, krijgt "Periode loopt" en niet "Nu bezig": anders spreken label en status elkaar tegen.
export function periodeBadge(entry = {}, today = "") {
  if (entry.group !== "werken" && entry.source === "agenda") return null;
  if (entry.start && entry.start > today) return { label: "Gepland", soort: "planned" };
  const multi = Boolean((entry.end && entry.end > entry.start) || entry.openEnd);
  if (!multi || !entry.start) return null;
  if (entry.source === "works" && !/^in uitvoering$/i.test(cleanText(entry.status))) return { label: "Periode loopt", soort: "period" };
  return { label: "Nu bezig", soort: "now" };
}
// De kop boven wat vandaag loopt. Staat er een kaart met "Periode loopt" onder, dan zegt de kop niet
// "Nu bezig": GIPOD meldt dat werk nog niet als in uitvoering.
export function lopendKop(entries = [], today = "") {
  if (!entries.some((e) => periodeBadge(e, today)?.soort === "period")) return { titel: "Nu bezig", noot: "Werken, maatregelen en activiteiten die vandaag lopen." };
  return { titel: "Loopt nu", noot: "Werken, maatregelen en activiteiten waarvan de periode vandaag loopt. Bij “Periode loopt” meldt GIPOD het werk nog niet als in uitvoering." };
}
// Korte datums voor de lijst: "1 jan", of "1 jan 2034" als de datum niet in het jaar van vandaag valt.
// MAANDEN_KORT staat verderop (ook voor de parkeerverboden).
export function kortDatum(iso, today = "", { jaar = false } = {}) {
  if (!isoDay(iso)) return "";
  const metJaar = jaar || !today || iso.slice(0, 4) !== String(today).slice(0, 4);
  return `${Number(iso.slice(8, 10))} ${MAANDEN_KORT[Number(iso.slice(5, 7)) - 1]}${metJaar ? ` ${iso.slice(0, 4)}` : ""}`;
}
// "8 dec 2025 → 1 jan 2034": beide met jaartal als ze in verschillende jaren vallen of de periode
// langer is dan 300 dagen.
export function kortBereik(start, end, today = "") {
  const jaar = Boolean(start && end && (start.slice(0, 4) !== end.slice(0, 4) || daysBetween(start, end) > 300));
  return `${kortDatum(start, today, { jaar })} → ${end ? kortDatum(end, today, { jaar }) : "…"}`;
}
// Een oudere verversing bewaarde hoogstens zoveel lijnen van een parcours (de rest viel weg).
const OUDE_KAART_MAX = 12;
// Eén kaartje per evenementendossier, met alle innames (parcours, parkeerverboden) samen. Het is
// een evenement (groep "evenementen"): het telt mee bij de evenementen en de chip "Evenementen" toont het.
// `rows` zijn de innames op de gekozen plek, `alle` die van het hele dossier (voor de straten).
// `lijst`: de stratenlijst van evenementStraten() (ook die van de filter); `straat`: de gekozen straat
// ("jouw straat"); `straal`: de straal rond die straat. identiteit: site/sources/evenement-identiteit.json;
// agendaItems: de publieke agendapunten, voor een dossier dat (nog) niet nagekeken is.
export function evenementEntry(rows, { vandaag, alle = rows, uitleg = null, wijkVan, lijst = null, index = null, straat = "", straal = 0, identiteit = null, agendaItems = [] } = {}) {
  const first = rows[0] || {};
  const live = evenementFeiten(alle);
  const bewaard = uitleg?.evenementen?.[live.dossier] || null;
  const stratenLijst = verfijnVoorStraat(lijst || evenementStraten(alle, { bewaard, index }), straat, alle, index);
  const straten = stratenLijst.langs.length ? stratenLijst.langs : bewaard?.straten?.length ? bewaard.straten : live.straten;
  // Hoe het parcours de gekozen straat raakt, uit dezelfde berekening als de lijst en de filter
  // (site/parcours-straten.js). `langs`: de straten waar het parcours zelf door loopt, als de
  // verversing ze apart bewaarde; anders zegt de kaart voorzichtig "op of naast het parcours".
  const parcoursRelatie = straat ? parcoursRelatieVoorStraat(straat, { lijst: stratenLijst, bewaard, rijen: alle, index }) : null;
  const langs = Array.isArray(bewaard?.langs) ? bewaard.langs : null;
  // De verversing leest alle lagen; de browser soms alleen de parcourslijnen. Samen geven ze de
  // volledigste omschrijving, en de soort komt uit dat geheel ("Startlocatie doop" + "Wandelroute").
  const beschrijvingen = [...new Set([...live.beschrijvingen, ...(bewaard?.beschrijvingen || []).map(zonderHuisnummer)].filter(Boolean))];
  const soort = soortEvenement(beschrijvingen) || live.soort || bewaard?.soort || "";
  const feiten = bewaard
    ? { ...live, soort, soortBron: soort ? "omschrijvingen in het dossier" : "", beschrijvingen, straten, langs, parcoursRelatie }
    : { ...live, straten, langs, parcoursRelatie };
  const id = identiteit?.dossiers?.[live.dossier] || null;
  // Koppeling aan de agenda. Een nagekeken evenement linkt alleen naar het agendapunt met dezelfde
  // naam; een dossier zonder fiche koppelt op dag en straat: eerst live (kent het agendapunt), anders
  // wat de verversing bewaarde.
  const agenda = Array.isArray(agendaItems) ? agendaItems : [];
  const bekend = id && id.zekerheid !== "onbekend";
  const gekoppeld = bekend
    ? (id.zekerheid === "zeker" && id.naam && agenda.length ? koppelEvenement(feiten, agenda, { naam: id.naam }) : null)
    : (agenda.length ? koppelEvenement(feiten, agenda) : null) || bewaard?.gekoppeld || null;
  const k = evenementKaartje(feiten, { vandaag, gekoppeld, identiteit: id, straat, wijkVan });
  // Jouw straat: kort in de lijst (zonder openklappen), lang in de kaart (jouwStraat in kaart-uitleg.js).
  const jouwStraat = jouwStraatVoorLijst(straat, { lijst: stratenLijst, parcoursRelatie, rijen: alle, straal });
  vulJouwStraatAan(k, jouwStraat);
  const start = dayOf(k.dagen.start || live.start), end = k.dagen.eind && k.dagen.eind > k.dagen.start ? dayOf(k.dagen.eind) : "";
  // Innameperiode op de gekozen plek (opbouw tot afbraak van de innames hier, zoals een parkeerverbod
  // in jouw straat), anders van het hele dossier. Zie periodeVan() en evenementFase().
  const hier = rows.map((r) => [dayOf(r?.start), dayOf(r?.end) || dayOf(r?.start)]).filter(([s]) => s);
  const innameStart = hier.length ? hier.map(([s]) => s).sort()[0] : dayOf(live.start);
  const innameEind = hier.length ? hier.map(([, e]) => e).sort().at(-1) : dayOf(live.eind);
  // De schets is maar een deel van het parcours als de verversing dat zegt, of bij een bestand van
  // vóór die markering dat op OUDE_KAART_MAX lijnen afgekapt kan zijn.
  const kaart = bewaard?.kaart || [];
  const kaartDeel = bewaard?.kaartDeel === true || (bewaard?.kaartDeel === undefined && kaart.length >= OUDE_KAART_MAX);
  return {
    uid: `publicSpace:dossier:${live.dossier || first.id}`, id: String(live.dossier || first.id || ""), source: "publicSpace", theme: "publicSpace", group: "evenementen",
    title: k.titel, summary: k.samenvatting, start, end, openEnd: false, time: k.tijd, timeText: "",
    location: k.plek, status: statusTekst(first.status), info: "", reference: live.dossier ? `Dossier ${live.dossier}` : "", url: k.links[0]?.url || "",
    innameStart, innameEind,
    sourceUrl: iodBronUrl(live.dossier) || safeUrl(first.sourceUrl), item: { ...first, kind: "event", streets: rowsStreets(alle) }, uitleg: k,
    evenementLinks: k.links, straten: feiten.straten, kruist: stratenLijst.kruist, jouwStraat: jouwStraat?.kort || "", kaart, kaartDeel,
  };
}

// ---- één stratenlijst per evenementendossier, voor tonen én filteren ----
const isParcoursRij = (r) => cleanText(r?.innameType || r?.title) === "Parcours";
const sorteerNl = (namen) => [...new Set(namen.map(cleanText).filter(Boolean))].sort((a, b) => a.localeCompare(b, "nl"));
function samengevoegdeGeometrie(rijen) {
  const vlakken = [], lijnen = [];
  for (const r of rijen) { vlakken.push(...(r?.parcours?.vlakken || [])); lijnen.push(...(r?.parcours?.lijnen || [])); }
  return vlakken.length || lijnen.length ? { vlakken, lijnen } : null;
}
// Eén straat tegen het parcours van een dossier, met geheugen per vorm, straatas en straat: elke
// tekenbeurt vraagt het opnieuw, en een parcours telt soms 15.000 punten.
const EEN_STRAAT = new WeakMap();
function parcoursVoorStraat(rijen, naam, index) {
  const parcoursRijen = rijen.filter((r) => isParcoursRij(r) && r?.parcours);
  if (!parcoursRijen.length || !index || !naam) return null;
  let perIndex = EEN_STRAAT.get(parcoursRijen[0].parcours);
  if (!perIndex) { perIndex = new WeakMap(); EEN_STRAAT.set(parcoursRijen[0].parcours, perIndex); }
  let perNaam = perIndex.get(index);
  if (!perNaam) { perNaam = new Map(); perIndex.set(index, perNaam); }
  const k = `${parcoursRijen.length}|${naam}`;
  if (!perNaam.has(k)) perNaam.set(k, stratenVanParcours(samengevoegdeGeometrie(parcoursRijen), index, { alleen: new Set([naam]) }));
  return perNaam.get(k);
}
// { langs, kruist, bron }. `langs`: straten waar het parcours door loopt of die een andere inname van
// het dossier inneemt. `kruist`: straten die het parcours alleen kruisen of erop uitkomen.
// Bron, in deze volgorde: de verversing (site/sources/kaart-uitleg.json); anders de browser zelf, op
// de geometrie uit A-Sign (site/parcours-straten.js, dezelfde berekening als de verversing); anders
// de straten van de innames zoals de live laag ze geeft. Een bestand van vóór deze berekening (zonder
// `kruist`) geldt nog tot de volgende verversing: alles in `langs`, en verfijnVoorStraat() kijkt dan
// voor de gekozen straat zelf na of ze het parcours alleen kruist. Alles in de browser opnieuw
// berekenen kost op een gsm enkele seconden.
export function evenementStraten(rijen = [], { bewaard = null, index = null } = {}) {
  if (bewaard && Array.isArray(bewaard.kruist)) {
    const langs = sorteerNl(bewaard.straten || []);
    return { langs, kruist: sorteerNl(bewaard.kruist).filter((n) => !langs.includes(n)), bron: "verversing" };
  }
  if (bewaard?.straten?.length) return { langs: sorteerNl(bewaard.straten), kruist: [], bron: "verversing-oud" };
  const geometrie = index ? samengevoegdeGeometrie(rijen.filter(isParcoursRij)) : null;
  if (geometrie) {
    // Alleen de straten die de live laag of de verversing al bij het dossier zet: zo blijft het snel
    // op een gsm (een parcours telt soms 15.000 punten).
    const alleen = new Set(sorteerNl([...rijen.flatMap((r) => (r?.streets || []).map((s) => s?.name)), ...(bewaard?.straten || [])]));
    const p = stratenVanParcours(geometrie, index, { alleen });
    const innames = rijen.filter((r) => !isParcoursRij(r)).flatMap((r) => (r?.streets || []).map((s) => s?.name));
    const langs = sorteerNl([...innames, ...p.langs]);
    return { langs, kruist: p.kruist.filter((n) => !langs.includes(n)), bron: "browser" };
  }
  return { langs: sorteerNl(rijen.flatMap((r) => (r?.streets || []).map((s) => s?.name))), kruist: [], bron: "innames" };
}
// Voor één gekozen straat bij een lijst uit een oud bestand: loopt het parcours erdoor, of kruist het
// haar alleen? Snel: alleen die straat wordt bekeken. Geeft een (eventueel aangepaste) lijst terug.
export function verfijnVoorStraat(lijst, straat, rijen = [], index = null) {
  if (lijst?.bron !== "verversing-oud" || !index || !straat) return lijst;
  const eigen = lijst.langs.find((n) => foldText(n) === foldText(straat));
  if (!eigen) return lijst;
  // Een straat die een andere inname van het dossier inneemt, blijft "in je straat".
  if (rijen.some((r) => !isParcoursRij(r) && (r?.streets || []).some((s) => foldText(s?.name) === foldText(eigen)))) return lijst;
  const p = parcoursVoorStraat(rijen, eigen, index);
  if (!p?.kruist.includes(eigen)) return lijst;
  return { ...lijst, langs: lijst.langs.filter((n) => n !== eigen), kruist: sorteerNl([...lijst.kruist, eigen]) };
}
// Staat de gekozen straat in `langs` door het parcours zelf, of alleen door een andere inname van het
// dossier (een parkeerverbod, een zone: die hangen aan elke straat tot 18 m van de inname)? Staat ze
// er niet door een andere inname, dan door het parcours. Anders kijkt de browser het parcours voor
// die ene straat na (snel). Zonder vorm van het parcours: de voorzichtige zin van de inname.
export function langsViaParcours(straat, rijen = [], index = null, heeftParcours = false) {
  if (!straat || !heeftParcours) return false;
  const eigen = foldText(straat);
  const viaInname = rijen.some((r) => !isParcoursRij(r) && (r?.streets || []).some((s) => foldText(s?.name) === eigen));
  if (!viaInname) return true;
  return Boolean(parcoursVoorStraat(rijen, cleanText(straat), index)?.langs.length);
}
// Raakt dit dossier deze ene straat? Zoals evenementStraten() in de browser (alleen straten die de
// live laag bij het dossier zet; een andere inname telt als "langs"), maar alleen voor die straat:
// snel genoeg voor de filter als de verversing het dossier nog niet kent. "langs", "kruist" of "".
export function dossierRaaktStraat(rijen = [], straat = "", index = null) {
  const eigen = foldText(straat);
  const genoemd = (r) => (r?.streets || []).some((s) => foldText(s?.name) === eigen);
  if (!eigen || !rijen.some(genoemd)) return "";
  if (rijen.some((r) => !isParcoursRij(r) && genoemd(r))) return "langs";
  const naam = rijen.flatMap((r) => r?.streets || []).find((s) => foldText(s?.name) === eigen)?.name || cleanText(straat);
  const p = parcoursVoorStraat(rijen, naam, index);
  if (!p) return "langs";
  return p.langs.length ? "langs" : p.kruist.length ? "kruist" : "";
}
// De stratenlijsten van de evenementendossiers voor de filter (agenda-view.js) en de kaartjes, met
// geheugen: één lijst per dossier, niet per rij (een evenement met 100 innames rekende anders 100 keer
// dezelfde lijst uit, en dat maakte een gsm traag). `bron()` geeft { rijen, uitleg, index, klaar }: de
// live innames, kaart-uitleg.json, de straatas en of dat bestand al geladen (of mislukt) is. Een nieuwe
// bron wist het geheugen. `refsVoorNaam(sleutel)`: de officiële straten met die naam (postcode).
// Kent de verversing een dossier niet, dan rekent de browser zelf; voor de filter dan alleen voor de
// gekozen straat (dossierRaaktStraat), de volledige lijst pas als het kaartje getoond wordt.
export function maakStratenFilter({ bron, refsVoorNaam = () => null, tel = null } = {}) {
  let vorige = {}, rijenPerDossier = new Map(), lijsten = new Map(), refs = new Map(), eigen = new Map();
  const vers = () => {
    const b = bron() || {};
    if (b.rijen !== vorige.rijen || b.uitleg !== vorige.uitleg || b.index !== vorige.index || b.klaar !== vorige.klaar) {
      vorige = b; lijsten = new Map(); refs = new Map(); eigen = new Map();
      rijenPerDossier = bundelInnames(Array.isArray(b.rijen) ? b.rijen : []);
    }
    return vorige;
  };
  const lijstVan = (dossier) => {
    const b = vers();
    if (!lijsten.has(dossier)) {
      if (tel) tel.lijsten = (tel.lijsten || 0) + 1;
      lijsten.set(dossier, evenementStraten(rijenPerDossier.get(dossier) || [], { bewaard: b.uitleg?.evenementen?.[dossier] || null, index: b.klaar ? b.index : null }));
    }
    return lijsten.get(dossier);
  };
  const zelfRekenen = (dossier, b) => !b.uitleg?.evenementen?.[dossier] && b.klaar && Boolean(b.index) && (rijenPerDossier.get(dossier) || []).some((r) => r?.parcours);
  const eigenVan = (dossier) => {
    if (!eigen.has(dossier)) {
      const m = new Map();
      for (const r of (rijenPerDossier.get(dossier) || []).flatMap((x) => x?.streets || [])) { const k = locationKey(r?.name); if (!k) continue; const l = m.get(k); if (!l) m.set(k, [r]); else if (!l.includes(r)) l.push(r); }
      eigen.set(dossier, m);
    }
    return eigen.get(dossier);
  };
  // Straatnamen naar officiële straten: een naam die de rijen zelf kennen, houdt hun postcode.
  const naarRefs = (namen, perNaam = new Map()) => namen.flatMap((naam) => { const k = locationKey(naam); return perNaam.get(k) || refsVoorNaam(k) || [{ name: naam }]; });
  return {
    lijstVan,
    rijenVan: (dossier) => { vers(); return rijenPerDossier.get(dossier) || []; },
    naarRefs,
    // De straten van een dossier voor de filter, met `straat` de gekozen straat ("" voor een wijk).
    refsVan(dossier, straat = "") {
      const b = vers();
      const zelf = !lijsten.has(dossier) && zelfRekenen(dossier, b);
      const sleutel = zelf ? `${dossier}|${locationKey(straat)}` : dossier;
      if (!refs.has(sleutel)) {
        let namen;
        if (!zelf) { const lijst = lijstVan(dossier); namen = [...lijst.langs, ...lijst.kruist]; }
        else {
          // De straten van de live laag; de gekozen straat alleen als het dossier haar echt raakt.
          if (tel) tel.eenStraat = (tel.eenStraat || 0) + 1;
          const rijen = rijenPerDossier.get(dossier) || [], k = locationKey(straat);
          namen = [...new Set(rijen.flatMap((r) => (r?.streets || []).map((x) => x?.name)).filter((n) => n && locationKey(n) !== k))];
          if (straat && dossierRaaktStraat(rijen, straat, b.index)) namen.push(straat);
        }
        refs.set(sleutel, naarRefs(namen, eigenVan(dossier)));
      }
      return refs.get(sleutel);
    },
  };
}
// "langs", "kruist" of "" voor de gekozen straat.
export function straatRelatie(straat, lijst) {
  const eigen = foldText(straat);
  if (!eigen || !lijst) return "";
  if ((lijst.langs || []).some((n) => foldText(n) === eigen)) return "langs";
  if ((lijst.kruist || []).some((n) => foldText(n) === eigen)) return "kruist";
  return "";
}
// Kort (in de lijst, zonder openklappen) en lang (in de details). Zonder gekozen straat: niets.
// Een inname zonder parcours hangt aan elke straat tot 18 m ervan (site/street-core.js): daar zegt de
// zin niet meer dan dat, en niet dat het evenement "een deel van je straat inneemt".
export function jouwStraatTekst(relatie, { viaParcours = false, straal = 0 } = {}) {
  if (relatie === "langs") return viaParcours
    ? { kort: "Het parcours loopt door je straat", lang: "Het parcours loopt door je straat." }
    : { kort: "Een zone van dit evenement ligt in of naast je straat", lang: "Een inname van dit evenement (zoals een parkeerverbod of een afgesloten zone) ligt in je straat of tot 18 m van de straatas." };
  if (relatie === "kruist") return { kort: "Je straat kruist het parcours", lang: "Je straat kruist het parcours of komt erop uit; het parcours loopt niet door je straat." };
  // Zonder vorm van het parcours (of nog zonder straatas): niet meer zeggen dan "in of naast".
  if (relatie === "naast") return { kort: "Het parcours ligt in of naast je straat", lang: "Het parcours ligt in of naast je straat." };
  if (straal > 0) {
    const afstand = straal >= 1000 ? "1 km" : `${straal} m`;
    return { kort: `Niet in je straat, wel binnen ${afstand}`, lang: `Niet in je straat: dit evenement ligt binnen ${afstand} van je straat.` };
  }
  return null;
}
// Hoe het parcours van een dossier de gekozen straat raakt: "op" (het parcours loopt erdoor),
// "kruist" (kruist het of komt erop uit), "naast" (raakt het niet), "kruist-of-naast" (niet op het
// parcours, maar kruisen of naast liggen is niet bekend), of null: onbekend. Eerst de verversing
// (`langs` en `kruist`, uit site/parcours-straten.js), dan de browser voor die ene straat (snel), dan
// een lijst die al op de vorm berekend is. Dezelfde berekening als de lijst en de filter.
export function parcoursRelatieVoorStraat(straat, { lijst = null, bewaard = null, rijen = [], index = null } = {}) {
  const eigen = foldText(straat);
  if (!eigen) return null;
  const heeft = (namen) => (namen || []).some((n) => foldText(n) === eigen);
  if (Array.isArray(bewaard?.langs)) {
    if (heeft(bewaard.langs)) return "op";
    if (heeft(bewaard.kruist)) return "kruist";
    if (Array.isArray(bewaard.kruist)) return "naast";
  }
  const naam = rijen.flatMap((r) => r?.streets || []).find((s) => foldText(s?.name) === eigen)?.name || cleanText(straat);
  const p = parcoursVoorStraat(rijen, naam, index);
  if (p) return p.langs.length ? "op" : p.kruist.length ? "kruist" : "naast";
  if (Array.isArray(bewaard?.langs)) return "kruist-of-naast";
  if (heeft(lijst?.kruist)) return "kruist";
  return null;
}
// De korte regel "jouw straat" in de lijst, uit dezelfde feiten als de lange in de kaart: het parcours
// loopt erdoor; anders een andere inname van het dossier in of naast de straat (een parkeerverbod, een
// zone: die hangen aan elke straat tot 18 m ervan); anders kruist het parcours haar; anders staat ze
// in de lijst zonder dat de vorm bekend is ("in of naast"); anders de straal.
export function jouwStraatVoorLijst(straat, { lijst = null, parcoursRelatie = null, rijen = [], straal = 0 } = {}) {
  const eigen = foldText(straat);
  if (!eigen) return null;
  if (parcoursRelatie === "op") return jouwStraatTekst("langs", { viaParcours: true });
  if (rijen.some((r) => !isParcoursRij(r) && (r?.streets || []).some((s) => foldText(s?.name) === eigen))) return jouwStraatTekst("langs");
  const relatie = straatRelatie(straat, lijst);
  if (parcoursRelatie === "kruist" || relatie === "kruist") return jouwStraatTekst("kruist");
  if (relatie === "langs") return jouwStraatTekst("naast");
  return jouwStraatTekst("", { straal });
}
// De lange regel "Jouw straat" in de kaart komt uit jouwStraat() (kaart-uitleg.js), met de dagen van
// een parkeerverbod of verkeersvrije zone. Twee aanvullingen: hangt de straat er alleen aan via een
// andere inname (tot 18 m), dan zegt de kaart dat ook; en ligt het evenement alleen binnen de straal,
// dan zegt de kaart dat in plaats van niets.
const INNAME_18M = "Die inname ligt in je straat of tot 18 m van de straatas.";
function vulJouwStraatAan(k, jouw) {
  if (!jouw || !Array.isArray(k?.kern)) return;
  const i = k.kern.findIndex(([dt]) => dt === "Jouw straat");
  if (i >= 0) {
    if (jouw.kort === jouwStraatTekst("langs").kort && !/parcours/.test(k.kern[i][1])) k.kern[i] = ["Jouw straat", `${k.kern[i][1]} ${INNAME_18M}`];
    return;
  }
  const voor = k.kern.findIndex(([dt]) => dt === "Wat merk je");
  k.kern.splice(voor >= 0 ? voor : k.kern.length, 0, ["Jouw straat", jouw.lang]);
}
const rowsStreets = (rows) => [...new Map(rows.flatMap((r) => r?.streets || []).filter((s) => s?.name).map((s) => [`${s.id}|${s.name}|${s.postcode}`, s])).values()];
// Live innames: evenementendossiers bundelen. Parkeerverboden en werfzones per dossier bundelen:
// één rij per parkeerverbod (alle plaatsen van hetzelfde dossier en dezelfde uren samen) en één rij
// per werfzone-dossier (alle fasen samen). `straat`: de gekozen straat, die komt eerst bij "Waar".
// `lijstVan(dossier)`: de stratenlijst die de filter ook gebruikt (place-view.js); `straal`: de straal
// rond de gekozen straat, voor de regel "jouw straat". identiteit en agendaItems: zie evenementEntry().
export function publicSpaceEntries(rows = [], { vandaag = "", alle = rows, uitleg = null, wijkVan, straat = "", straal = 0, index = null, lijstVan = null, identiteit = null, agendaItems = [] } = {}) {
  if (!vandaag) return rows.map(publicSpaceEntry);
  const perDossier = bundelInnames(alle);
  const out = [];
  for (const [dossier, groep] of bundelInnames(rows)) {
    if (isEvenementDossier(groep[0])) out.push(evenementEntry(groep, { vandaag, alle: perDossier.get(dossier) || groep, uitleg, wijkVan, straat, straal, index, lijst: lijstVan ? lijstVan(dossier) : null, identiteit, agendaItems }));
    else out.push(...groep.map(publicSpaceEntry));
  }
  out.push(...bundelMaatregelen(rows.filter((r) => r?.kind !== "iod"), { alle, straat, vandaag }));
  return out;
}

// ---- parkeerverboden, werfzones en terrassen in gewone taal ----
// De reden van een parkeerverbod staat in A-Sign als een vaste categorie. Wat er niet bij staat,
// verzinnen we niet: dan blijft het "Tijdelijk parkeerverbod".
const PARKEER_REDENEN = [
  [/verhuis/i, "voor een verhuis"],
  [/laad-?\s*en\s*loszone/i, "voor een laad- en loszone"],
  [/werfsignalisatie/i, "voor een werf"],
  [/container/i, "voor een container"],
  [/evenement/i, "voor een evenement"],
  [/jaarvergunning/i, "met een jaarvergunning"],
  [/beweegbaar toestel|ladderlift|schaarlift|hoogtewerker/i, "voor een lift of hoogtewerker"],
  [/scholen|jeugdvereniging|socioculturele/i, "voor een school of vereniging"],
  [/ceremoniewagen/i, "voor een ceremoniewagen"],
  [/filmopname/i, "voor filmopnames"],
];
export function parkeerTitel(reden) {
  const r = cleanText(reden);
  const hit = r && PARKEER_REDENEN.find(([re]) => re.test(r));
  return hit ? `Parkeerverbod ${hit[1]}` : "Tijdelijk parkeerverbod";
}
const parkeerReden = (row) => cleanText(row?.reason ?? (row?.title && row.title !== "Tijdelijk parkeerverbod" ? row.title : ""));
// De reden zoals de stad ze schrijft, als leesbare zin: "Melding ikv werfsignalisaties" wordt
// "melding in het kader van werfsignalisaties".
const redenZin = (reden) => {
  const zin = cleanText(reden).replace(/\bikv\b/gi, "in het kader van");
  return zin ? zin[0].toLowerCase() + zin.slice(1) : "";
};
// "07:00" → "7.00"
const uurKort = (hhmm) => (/^\d{2}:\d{2}$/.test(String(hhmm || "")) ? `${Number(hhmm.slice(0, 2))}.${hhmm.slice(3)}` : "");
// Uren van een parkeerverbod: "hele dag" (0.00 tot 23.59), "van 7.00 tot 17.00 uur" of niets.
export function parkeerUren(row = {}) {
  const van = uurKort(row.startTime), tot = uurKort(row.endTime);
  if (!van || !tot) return "";
  if (van === "0.00" && /^23\.5\d$/.test(tot)) return "hele dag";
  return `van ${van} tot ${tot} uur`;
}
// Status in het Nederlands, zoals een bewoner ze leest.
const STATUS_NL = Object.freeze({ "in effect": "Van kracht", goedgekeurd: "Goedgekeurd door de stad", vergund: "Vergund door de stad", actief: "Actief", "niet actief": "Niet actief" });
export const statusNl = (status) => STATUS_NL[cleanText(status).toLowerCase()] || cleanText(status);
// "Waar" bij veel straten: de gekozen straat eerst, de rest als telling ("Lange Leemstraat + 12 andere straten").
export function waarKort(straten = [], gekozen = "") {
  const namen = [...new Set(straten.map(cleanText).filter(Boolean))];
  if (namen.length <= 2) return namen.join(" en ");
  const eigen = foldText(gekozen) ? namen.find((n) => foldText(n) === foldText(gekozen)) : "";
  return `${eigen || namen[0]} + ${namen.length - 1} andere straten`;
}
const stratenVan = (rows) => [...new Set(rows.flatMap((r) => (r?.streets || []).map((s) => s?.name)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "nl"));
const maatregelSleutel = (row) => (row?.kind === "sgw" && row.reference ? `sgw|${row.reference}`
  : row?.kind === "parking" && row.reference ? `parking|${row.reference}|${dayOf(row.start)}|${dayOf(row.end)}|${row.startTime || ""}|${row.endTime || ""}|${parkeerReden(row)}`
    : `los|${row?.id}`);
function bundelMaatregelen(rows, { alle = rows, straat = "", vandaag = "" } = {}) {
  const groepen = new Map();
  for (const row of rows) { const key = maatregelSleutel(row); groepen.set(key, [...(groepen.get(key) || []), row]); }
  if (![...groepen.keys()].some((k) => !k.startsWith("los|"))) return rows.map(publicSpaceEntry);
  // Alle rijen van hetzelfde dossier (ook buiten de gekozen plek), één keer opgezocht.
  const perSleutel = new Map();
  // Eerst op dossiernummer zoeken: de volledige sleutel (met data en uren) alleen voor die rijen.
  const dossiers = new Set(rows.map((r) => r?.reference).filter(Boolean));
  for (const row of alle || []) {
    if ((row?.kind !== "sgw" && row?.kind !== "parking") || !dossiers.has(row.reference)) continue;
    const key = maatregelSleutel(row);
    if (groepen.has(key)) perSleutel.set(key, [...(perSleutel.get(key) || []), row]);
  }
  const out = [];
  for (const [key, groep] of groepen) {
    const first = groep[0];
    if (key.startsWith("los|")) { out.push(publicSpaceEntry(first)); continue; }
    const dossierRijen = perSleutel.get(key) || groep;
    const straten = stratenVan(dossierRijen);
    const entry = publicSpaceEntry(first);
    entry.straten = straten;
    const plaatsen = [...new Set(groep.map((r) => cleanText(r.location)).filter(Boolean))];
    entry.location = straten.length > 2 ? waarKort(straten, straat) : plaatsen.length === 1 ? plaatsen[0] : waarKort(straten.length ? straten : plaatsen, straat);
    if (first.kind === "sgw") Object.assign(entry, werfzoneEntry(dossierRijen, { vandaag, straat }));
    out.push(entry);
  }
  return out;
}
// Werfzone of omleiding: één rij per dossier, met alle fasen samen. Waarvoor de werfzone dient, staat
// niet in A-Sign: dat zeggen we in één zin. Wat er komt, staat wel in de bron: de periode van elke fase.
const MAANDEN_KORT = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const korteDag = (iso, metJaar) => `${Number(iso.slice(8, 10))} ${MAANDEN_KORT[Number(iso.slice(5, 7)) - 1]}${metJaar ? ` ${iso.slice(0, 4)}` : ""}`;
// "26 okt", "27–28 okt", "30 okt – 2 nov" (met het jaar als dat niet het jaar van vandaag is).
export function kortePeriode(van, tot = "", vandaag = "") {
  if (!van) return "";
  const metJaar = Boolean(vandaag) && (van.slice(0, 4) !== vandaag.slice(0, 4) || (tot && tot.slice(0, 4) !== vandaag.slice(0, 4)));
  if (!tot || tot <= van) return korteDag(van, metJaar);
  if (van.slice(0, 7) === tot.slice(0, 7)) return `${Number(van.slice(8, 10))}–${korteDag(tot, metJaar)}`;
  return `${korteDag(van, metJaar && van.slice(0, 4) !== tot.slice(0, 4))} – ${korteDag(tot, metJaar)}`;
}
const MAX_FASEN = 6;
const namenVan = (rows, veld) => [...new Set(rows.flatMap((r) => (r?.[veld] || []).map((s) => s?.name)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "nl"));
function werfzoneEntry(dossierRijen, { vandaag = "", straat = "" } = {}) {
  const soorten = new Set(dossierRijen.flatMap((r) => String(r.kindLabel || r.title || "").split(/\s*\+\s*/)).filter(Boolean));
  const werfzone = soorten.has("Werfzone"), omleiding = soorten.has("Omleiding");
  const titel = werfzone && omleiding ? "Werfzone met omleiding" : omleiding ? "Omleiding" : "Werfzone";
  const begin = dossierRijen.map((r) => dayOf(r.start)).filter(Boolean).sort()[0] || "";
  const einde = dossierRijen.map((r) => dayOf(r.end)).filter(Boolean).sort().at(-1) || "";
  // Elke andere periode is een fase; twee fasen met dezelfde periode tellen één keer.
  const perioden = [...new Map(dossierRijen.map((r) => [dayOf(r.start), dayOf(r.end)]).filter(([van]) => van).map(([van, tot]) => [`${van}|${tot}`, [van, tot]])).values()]
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  const lijst = perioden.slice(0, MAX_FASEN).map(([van, tot]) => kortePeriode(van, tot, vandaag)).join(" · ");
  const rest = perioden.length > MAX_FASEN ? ` · en nog ${perioden.length - MAX_FASEN}` : "";
  // Waar de werfzone zelf ligt en waar de omleiding loopt, apart: een straat op de omleiding heeft
  // geen werfzone. Ligt de gekozen straat in één van beide, dan staat dat vooraan.
  const werfStraten = namenVan(dossierRijen, "werfzoneStreets"), omlStraten = namenVan(dossierRijen, "omleidingStreets");
  const eigen = foldText(straat);
  const inWerf = Boolean(eigen) && werfStraten.some((n) => foldText(n) === eigen);
  const opOmleiding = !inWerf && Boolean(eigen) && omlStraten.some((n) => foldText(n) === eigen);
  const waarom = `De stad publiceert niet waarvoor deze ${werfzone ? "werfzone" : "omleiding"} dient.`;
  const wat = inWerf ? (omleiding ? "De werfzone ligt in je straat; het verkeer wordt omgeleid." : "De werfzone ligt in je straat.")
    : opOmleiding ? "Je straat ligt op de omleiding; de werfzone zelf ligt elders."
      : werfzone && omleiding ? "Een werfzone op straat, met een omleiding voor het verkeer." : omleiding ? "Een omleiding voor het verkeer." : "Een werfzone op straat.";
  const regels = [
    ...(werfStraten.length ? [["Werfzone in", waarKort(werfStraten, straat)]] : []),
    ...(omlStraten.length ? [["Omleiding via", waarKort(omlStraten, straat)]] : []),
    ...(perioden.length > 1 ? [[`${perioden.length} fasen`, `${lijst}${rest}`]] : []),
  ];
  return {
    title: titel,
    summary: `${wat} Vergund door de stad. ${waarom}`,
    start: begin, end: einde && einde > begin ? einde : "",
    info: "",
    regels,
    ...(opOmleiding ? { location: `Omleiding via ${waarKort(omlStraten, straat)}` } : werfStraten.length ? { location: `Werfzone in ${waarKort(werfStraten, straat)}` } : {}),
  };
}
function workEntryBasis(work) {
  const consequences = work?.hindrance?.consequences || [];
  return {
    uid: `works:${work?.gipodId}`, id: `gipod-${work?.gipodId}`, source: "works", theme: "works", group: "werken",
    title: cleanText(work?.title) || "Werk in openbaar domein", start: dayOf(work?.start), end: dayOf(work?.end), openEnd: false,
    time: "", timeText: "", location: streetNames(work), status: cleanText(work?.status),
    info: [work?.ownerGroup || work?.owner ? `Beheerder: ${cleanText(work.owner || work.ownerGroup)}` : "", consequences.length ? `Hinder: ${consequences.join(", ")}` : "", work?.hindrance?.severe ? "Ernstige hinder" : ""].filter(Boolean).join(" · "),
    reference: work?.gipodId ? `GIPOD ${work.gipodId}` : "", url: "", sourceUrl: safeUrl(work?.sourceUrls?.[0]), item: work,
  };
}
export function publicSpaceEntry(row) {
  const base = {
    uid: `publicSpace:${row?.id}`, id: String(row?.id || ""), source: "publicSpace", theme: "publicSpace", group: "werken",
    title: cleanText(row?.title || row?.kindLabel) || "Maatregel",
    start: dayOf(row?.start), end: dayOf(row?.end), openEnd: false, time: "", timeText: "",
    location: cleanText(row?.location) || streetNames(row), status: statusNl(row?.status), info: cleanText(row?.detail),
    reference: row?.reference ? `Dossier ${row.reference}` : "", url: "", sourceUrl: safeUrl(row?.sourceUrl), item: row,
  };
  if (row?.kind !== "parking") return base;
  // Parkeerverbod: wat (waarvoor), wanneer (uren) en een eerlijke zin als de reden ontbreekt.
  const reden = parkeerReden(row);
  const uren = parkeerUren(row);
  const weekdagen = row?.weekdaysOnly === true || /weekdag/i.test(String(row?.detail || ""));
  const end = dayOf(row?.end);
  const enkeleDag = !end || end === base.start;
  return {
    ...base,
    title: parkeerTitel(reden),
    summary: [`Niet parkeren${uren ? (uren === "hele dag" ? ", de hele dag" : ` ${uren}`) : ""}${weekdagen ? ", alleen op weekdagen" : ""}.`, reden ? "" : "De stad publiceert niet waarvoor."].filter(Boolean).join(" "),
    time: enkeleDag && uren && uren !== "hele dag" ? row.startTime : "",
    timeText: uren ? `${uren}${weekdagen ? ", alleen op weekdagen" : ""}` : weekdagen ? "alleen op weekdagen" : "",
    info: reden ? `Reden volgens de stad: ${redenZin(reden)}` : "",
  };
}
// Een terraszone uit A-Sign: "binnen kern", "buiten kern" of "uitstalling". Wat "kern" precies
// betekent, publiceert de laag niet; we tonen het woord van de stad, maar niet als titel.
export function terrasTitel(type) {
  return /uitstalling/i.test(String(type || "")) ? "Uitstalling met vergunning" : "Terras met vergunning";
}
// Wat een terrasvergunning is, in één zin. Een begin- of einddatum staat niet in de laag.
export function terrasUitleg(type) {
  return /uitstalling/i.test(String(type || ""))
    ? "Koopwaar buiten de winkel, op het openbaar domein, met een vergunning van de stad. Een periode publiceert de stad niet."
    : "Een terras op het openbaar domein, met een vergunning van de stad. Een periode publiceert de stad niet.";
}
export function permitEntry(row, theme = "permits") {
  const terrace = String(row?.id || "").startsWith("terrace:");
  // Een omgevingsaanvraag: de titel zegt in gewone taal wat er gebeurt, er is één statusregel en
  // vanaf 3 straten een korte "Waar" (site/permit-clarity.js). Geen losse regel met nummer en overheid.
  if (!terrace) {
    return {
      uid: `${theme}:${row?.id}`, id: String(row?.id || ""), source: "permits", theme: "permits", group: "vergunningen",
      title: cleanText(aanvraagTitel(row)), start: "", end: "", openEnd: false, time: "", timeText: "",
      location: vergunningWaar(row?.streets), status: aanvraagStand(row), info: "",
      ...(vergunningStraten(row?.streets).length > 2 ? { straten: vergunningStraten(row?.streets) } : {}),
      reference: row?.dossier ? `Dossier ${row.dossier}` : "", url: "", sourceUrl: safeUrl(row?.sourceUrl), item: row,
    };
  }
  return {
    uid: `${theme}:${row?.id}`, id: String(row?.id || ""), source: "terraces", theme: "permits", group: "vergunningen",
    title: cleanText(terrasTitel(row?.terraceType)), summary: terrasUitleg(row?.terraceType),
    start: "", end: "", openEnd: false, time: "", timeText: "", location: cleanText(row?.address) || streetNames(row),
    status: statusNl(row?.status), info: cleanText(row?.terraceType ? `Soort zone volgens de stad: ${row.terraceType}` : ""),
    reference: row?.dossier ? `Dossier ${row.dossier}` : "", url: "", sourceUrl: safeUrl(row?.sourceUrl), item: row,
  };
}

// "Waar" bij een vergunning: de dichtste straat (permits-live-core.js zet die eerst), de andere als
// "ook dicht bij": een straat tot 24 m van het perceel grenst er niet altijd aan. Een tunnel ligt
// eronder, niet ernaast: die noemen we niet, tenzij er niets anders is.
export function vergunningStraten(streets = []) {
  const namen = [...new Set((streets || []).map((s) => cleanText(s?.name)).filter(Boolean))];
  const zonderTunnel = namen.filter((n) => !isTunnel(n));
  return zonderTunnel.length ? zonderTunnel : namen;
}
// De korte regel komt uit waarTekst() in permit-clarity.js (ook de vergunningkaart gebruikt die).
export const vergunningWaar = (streets = []) => waarTekst((streets || []).map((s) => s?.name)).kort;

// Terrassen: twee zones van dezelfde soort op hetzelfde adres zijn voor een bewoner één terras.
export function terrasEntries(rows = []) {
  const groepen = new Map();
  for (const row of rows) {
    const adres = foldText(row?.address);
    const key = adres ? `${adres}|${foldText(row?.terraceType)}|${foldText(row?.status)}` : `los|${row?.id}`;
    groepen.set(key, [...(groepen.get(key) || []), row]);
  }
  return [...groepen.values()].map((groep) => {
    const entry = permitEntry(groep[0], "terraces");
    if (groep.length > 1) entry.info = [entry.info, `${groep.length} zones op dit adres`].filter(Boolean).join(" · ");
    return entry;
  });
}

// Tellen per soortgroep (voor de chips en de samenvatting bovenaan de plek).
export function summarize(entries, today) {
  const out = { evenementen: 0, werkenBezig: 0, werkenGepland: 0, inspraak: 0, markten: 0, raad: 0, vergunningen: 0 };
  const seen = new Set();
  for (const entry of entries) {
    const key = entry.source === "agenda" ? `${entry.group}|${entry.title}|${entry.location}` : entry.uid;
    if (entry.group === "werken") {
      if (entry.start && entry.start > today) out.werkenGepland += 1; else out.werkenBezig += 1;
      continue;
    }
    if (seen.has(key)) continue; // een reeks (elke dinsdag) telt één keer
    seen.add(key);
    if (entry.group in out) out[entry.group] += 1;
  }
  return out;
}

// ---- lege staat en voortgang: korte, eerlijke zinnen ----
// Waar: geen lidwoord voor een straatnaam ("in Rozemiekepad", niet "in de Rozemiekepad").
export function plekWaar(place) {
  if (!place) return "in district Antwerpen";
  if (place.type === "straat") return `in ${place.label}`;
  if (place.type === "wijk") return `in de wijk ${place.label}`;
  return `in postcode ${place.code}`;
}
// Waarom leeg: alleen "de gekozen soorten" als de bewoner zelf soorten koos. Laadde een laag niet
// (`onvolledig`), dan zeggen we alleen iets over wat wel geladen is.
export function legeStaatTekst({ place = null, gekozen = false, aantalSoorten = 0, onvolledig = false } = {}) {
  if (!aantalSoorten) return "Je hebt alle soorten uitgezet.";
  if (gekozen) return onvolledig ? "In wat wel geladen is, staat binnen de gekozen soorten niets gepland." : "Binnen de gekozen soorten staat hier niets gepland.";
  const plek = place?.type === "straat" ? "deze straat" : place?.type === "wijk" ? "deze wijk" : place ? "deze postcode" : "";
  if (onvolledig) return plek ? `In wat wel geladen is, staat niets voor ${plek}.` : "In wat wel geladen is, staat nu niets.";
  return plek ? `Er staat niets op de agenda voor ${plek}.` : "Er staat nu niets op de agenda.";
}
// Voortgang van een meerdaagse periode: "Start over 13 dagen · duurt 8 dagen" of "Dag 3 van 8".
export function voortgangTekst(start, end, today) {
  const totaal = Math.max(1, daysBetween(start, end) + 1);
  const dagen = (n) => `${n} dag${n === 1 ? "" : "en"}`;
  if (start > today) return `Start over ${dagen(daysBetween(today, start))} · duurt ${dagen(totaal)}`;
  return `Dag ${Math.min(totaal, Math.max(0, daysBetween(start, today) + 1))} van ${totaal}`;
}
