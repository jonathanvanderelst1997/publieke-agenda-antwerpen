// Zoeken op plek: pure functies, zonder netwerk en zonder DOM (draaien ook in de Node-toetsen).
// - normaliseren van wat iemand intypt ("Kammenstr. 12", "st.-jansplein", "zurenborg 2018");
// - suggesties uit de officiële straatnamen (site/geo/straten.json), de wijken en de postcodes;
// - een plek in de URL (?plek=Kammenstraat, ?plek=Zurenborg, ?plek=2060);
// - kalenderhulp: periodes, weken, maandrooster en balken voor meerdaagse items.

import { bundelInnames, evenementFeiten, evenementKaartje, isEvenementDossier, statusTekst, werkFeiten, werkKaartje } from "./kaart-uitleg.js";
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

// Overlapt een item [start, end] met [from, to]? Een item zonder einde telt als één dag
// (of als lopend tot het einde van het venster als openEnd gezet is).
export function overlaps(entry, from, to) {
  const start = entry.start, end = entry.end || (entry.openEnd ? to : start);
  return Boolean(start) && start <= to && end >= from;
}

// Balken voor één week: elk meerdaags item krijgt een baan (lane) zodat balken niet overlappen.
// Geeft [{ entry, col (0-6), span, lane, clippedStart, clippedEnd }] terug, plus het aantal banen.
export function layoutWeekBars(entries, weekStart, maxLanes = Infinity) {
  const weekEnd = addDays(weekStart, 6);
  const rows = entries
    .filter((entry) => overlaps(entry, weekStart, weekEnd))
    .map((entry) => {
      const end = entry.end || (entry.openEnd ? weekEnd : entry.start);
      const s = entry.start < weekStart ? weekStart : entry.start;
      const e = end > weekEnd ? weekEnd : end;
      return { entry, col: daysBetween(weekStart, s), span: daysBetween(s, e) + 1, clippedStart: entry.start < weekStart, clippedEnd: end > weekEnd };
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
export function groupForList(entries, { from, to, today }) {
  const running = [], days = new Map(), later = [];
  for (const entry of entries) {
    const multi = Boolean((entry.end && entry.end > entry.start) || entry.openEnd);
    if (multi && entry.start <= today && (entry.openEnd || entry.end >= today)) { running.push(entry); continue; }
    if (!entry.start) continue;
    const end = entry.end || entry.start;
    if (end < from) continue;
    if (entry.start > to) { later.push(entry); continue; }
    const day = entry.start < from ? from : entry.start;
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(entry);
  }
  const byTitle = (a, b) => String(a.time || "99").localeCompare(String(b.time || "99")) || String(a.title).localeCompare(String(b.title), "nl");
  running.sort((a, b) => String(a.end || "9999").localeCompare(String(b.end || "9999")) || byTitle(a, b));
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
function samenWerk(live, bewaard) {
  if (!bewaard) return live;
  return {
    ...live,
    soort: live.soort || bewaard.soort || "", soortBron: live.soort ? live.soortBron : bewaard.soortBron || "",
    fasen: live.fasen.length ? live.fasen : bewaard.fasen || [],
    huisnummers: live.huisnummers || bewaard.huisnummers || "", huisnummerBron: live.huisnummers ? live.huisnummerBron : bewaard.huisnummerBron || "",
  };
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
// Eén kaartje per evenementendossier, met alle innames (parcours, parkeerverboden) samen.
// `rows` zijn de innames op de gekozen plek, `alle` die van het hele dossier (voor de straten).
export function evenementEntry(rows, { vandaag, alle = rows, uitleg = null, wijkVan } = {}) {
  const first = rows[0] || {};
  const live = evenementFeiten(alle);
  const bewaard = uitleg?.evenementen?.[live.dossier] || null;
  const feiten = bewaard ? { ...live, soort: live.soort || bewaard.soort || "", soortBron: live.soort ? live.soortBron : bewaard.soortBron || "", beschrijvingen: live.beschrijvingen.length ? live.beschrijvingen : bewaard.beschrijvingen || [], straten: bewaard.straten?.length ? bewaard.straten : live.straten } : live;
  const k = evenementKaartje(feiten, { vandaag, gekoppeld: bewaard?.gekoppeld || null, wijkVan });
  return {
    uid: `publicSpace:dossier:${live.dossier || first.id}`, id: String(live.dossier || first.id || ""), source: "publicSpace", theme: "publicSpace", group: "werken",
    title: k.titel, summary: k.samenvatting, start: dayOf(live.start), end: live.eind && live.eind > live.start ? dayOf(live.eind) : "", openEnd: false, time: "", timeText: "",
    location: k.plek, status: statusTekst(first.status), info: "", reference: live.dossier ? `Dossier ${live.dossier}` : "", url: "",
    sourceUrl: iodBronUrl(live.dossier) || safeUrl(first.sourceUrl), item: { ...first, kind: "event", streets: rowsStreets(alle) }, uitleg: k,
    straten: feiten.straten, kaart: bewaard?.kaart || [],
  };
}
const rowsStreets = (rows) => [...new Map(rows.flatMap((r) => r?.streets || []).filter((s) => s?.name).map((s) => [`${s.id}|${s.name}|${s.postcode}`, s])).values()];
// Live innames: evenementendossiers bundelen, de rest (parkeerverboden, werfzones) apart laten.
export function publicSpaceEntries(rows = [], { vandaag = "", alle = rows, uitleg = null, wijkVan } = {}) {
  if (!vandaag) return rows.map(publicSpaceEntry);
  const perDossier = bundelInnames(alle);
  const out = [];
  for (const [dossier, groep] of bundelInnames(rows)) {
    if (isEvenementDossier(groep[0])) out.push(evenementEntry(groep, { vandaag, alle: perDossier.get(dossier) || groep, uitleg, wijkVan }));
    else out.push(...groep.map(publicSpaceEntry));
  }
  out.push(...rows.filter((r) => r?.kind !== "iod").map(publicSpaceEntry));
  return out;
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
  return {
    uid: `publicSpace:${row?.id}`, id: String(row?.id || ""), source: "publicSpace", theme: "publicSpace", group: "werken",
    title: cleanText(row?.kind === "parking" ? `Parkeerverbod: ${row?.title || "tijdelijk"}` : row?.title || row?.kindLabel) || "Maatregel",
    start: dayOf(row?.start), end: dayOf(row?.end), openEnd: false, time: "", timeText: "",
    location: cleanText(row?.location) || streetNames(row), status: cleanText(row?.status), info: cleanText(row?.detail),
    reference: row?.reference ? `Dossier ${row.reference}` : "", url: "", sourceUrl: safeUrl(row?.sourceUrl), item: row,
  };
}
export function permitEntry(row, theme = "permits") {
  const terrace = String(row?.id || "").startsWith("terrace:");
  // Een omgevingsaanvraag: de titel zegt in gewone taal wat er gebeurt, er is één statusregel en
  // vanaf 3 straten een korte "Waar" (site/permit-clarity.js). Geen losse regel met nummer en overheid.
  if (!terrace) {
    return {
      uid: `${theme}:${row?.id}`, id: String(row?.id || ""), source: "permits", theme: "permits", group: "vergunningen",
      title: cleanText(aanvraagTitel(row)), start: "", end: "", openEnd: false, time: "", timeText: "",
      location: waarTekst((row?.streets || []).map((s) => s?.name)).kort, status: aanvraagStand(row), info: "",
      reference: row?.dossier ? `Dossier ${row.dossier}` : "", url: "", sourceUrl: safeUrl(row?.sourceUrl), item: row,
    };
  }
  return {
    uid: `${theme}:${row?.id}`, id: String(row?.id || ""), source: "terraces", theme: "permits", group: "vergunningen",
    title: cleanText(`Terras: ${row?.terraceType || "terraszone"}`),
    start: "", end: "", openEnd: false, time: "", timeText: "", location: cleanText(row?.address) || streetNames(row),
    status: cleanText(row?.status), info: cleanText([row?.dossier, row?.authority].filter(Boolean).join(" · ")),
    reference: row?.dossier ? `Dossier ${row.dossier}` : "", url: "", sourceUrl: safeUrl(row?.sourceUrl), item: row,
  };
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
