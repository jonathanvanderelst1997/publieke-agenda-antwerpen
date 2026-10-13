// Zoeken op plek: pure functies, zonder netwerk en zonder DOM (draaien ook in de Node-toetsen).
// - normaliseren van wat iemand intypt ("Kammenstr. 12", "st.-jansplein", "zurenborg 2018");
// - suggesties uit de officiële straatnamen (site/geo/straten.json), de wijken en de postcodes;
// - een plek in de URL (?plek=Kammenstraat, ?plek=Zurenborg, ?plek=2060);
// - kalenderhulp: periodes, weken, maandrooster en balken voor meerdaagse items.

import { bundelInnames, evenementFeiten, evenementKaartje, faseDoelen, geldigeHuisnummers, isEvenementDossier, koppelEvenement, opStraat, soortEvenementMet, soortVanWerk, statusTekst, veiligeOmschrijving, werkFeiten, werkKaartje } from "./kaart-uitleg.js";
import { werfDossier } from "./works-core.js";
import { isTunnel, stratenVanParcours } from "./parcours-straten.js";
import { LANG_DAGEN, duurDagen, patroonTekst, patroonVan } from "./evenement-wat.js";
import { locationKey } from "./neighborhood-core.js";
import { aanvraagStand, aanvraagTitel, aanvraagZegtNiet, dossierJaar, omgevingsStatus, waarTekst } from "./permit-clarity.js";
import { onbekendVeld, onbekendZin } from "./onbekend-zinnen.js";

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
// Geeft { text, compact, postcode, ruw } terug; compact is zonder spaties ("de coninckplein" → "deconinckplein").
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
  // `ruw`: de vraag zonder de postcode, maar met haar cijfers en zonder afkortingen uit te schrijven. Een straatnaam
  // met een cijfer ("Fort 7-straat", "De 7 schakenpad", "Pad nr. 25") vindt zo ook zichzelf terug.
  const ruw = postcode ? tokens.filter((t, i) => i !== tokens.indexOf(postcode)).join("") : tokens.join("");
  return { text, compact: text.replace(/ /g, ""), postcode, ruw };
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

// De straatas zet een homoniemtoevoeging achter een straatnaam die ook in een ander district bestaat
// ("Maria-Theresialei_AN" in 2018, naast de Maria-Theresialei in Ekeren). Zo heet geen straat: de bewoner ziet en
// zoekt "Maria-Theresialei" (zoals scripts/build-straten-stad.mjs voor de andere districten).
export const zonderHomoniem = (naam) => String(naam ?? "").replace(/_[A-Z]{2}$/, "");

// Index van alle plekken. streets: rijen uit straten.json ([id, naam, postcode, wijken, kader]);
// wijken: [{ code, naam, box }]; counts: optioneel aantal items per straat-/wijksleutel (voor de rangorde).
// Een straat houdt in `name` en `key` de naam uit de straatas: daarmee koppelt de site haar aan de live lagen en de
// ochtendstand. `label`, `compact` en `words` (wat de bewoner ziet en intypt) zijn zonder homoniemtoevoeging; de
// naam met toevoeging blijft een alias, zodat een oude link (?plek=Maria-Theresialei_AN) blijft werken.
export function buildPlaceIndex({ streets = [], wijken = [] } = {}) {
  const wijkByCode = new Map(wijken.map((w) => [w.code, w]));
  const nameCount = new Map();
  for (const row of streets) nameCount.set(zonderHomoniem(row[1]), (nameCount.get(zonderHomoniem(row[1])) || 0) + 1);
  const places = [];
  for (const [id, name, postcode, codes = [], box = null] of streets) {
    const wijk = wijkByCode.get(codes[0]);
    const label = zonderHomoniem(name);
    places.push({
      type: "straat",
      key: `straat:${id}|${name}|${postcode}`,
      id: String(id),
      name,
      postcode: String(postcode || ""),
      wijken: codes,
      box,
      label,
      sub: [postcode, wijk ? `wijk ${wijk.naam}` : ""].filter(Boolean).join(" · "),
      ambiguous: nameCount.get(label) > 1,
      compact: compactOf(label),
      words: foldText(label).split(" "),
      ...(label !== name ? { aliases: [compactOf(name)] } : {}),
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

// Bij een gelijke score: eerst wat deze agenda volgt (district Antwerpen), dan een ander district (site/stad-zoeken.js).
const TYPE_RANK = { wijk: 0, postcode: 1, straat: 2, district: 3, buiten: 4 };
// Zekere treffers: de naam is de vraag, begint ermee, of een woord van de naam begint ermee. "contains" (een stuk
// midden in een naam) en "fuzzy" (tikfout) zijn een gok.
const ZEKER = new Set(["exact", "prefix", "word"]);

// Suggesties voor wat iemand typt. Rangorde: exact, begint met, woord begint met; dan (als niets daarvan past) een
// tikfout in de hele naam, bevat, andere tikfouten.
export function searchPlaces(index, query, { limit = 8, counts = null } = {}) {
  const q = parseQuery(query);
  const places = index?.places || [];
  if (!q.compact && q.postcode) return places.filter((p) => p.type === "postcode" && p.code === q.postcode).map((place) => ({ place, score: 100, match: "exact" }));
  if (!q.compact) return [];
  const results = [];
  const fuzzyMax = q.compact.length >= 9 ? 2 : q.compact.length >= 5 ? 1 : 0;
  // De vraag ook zoals getypt, met haar cijfers: parseQuery laat een huisnummer weg, maar sommige straten hebben een
  // cijfer in hun naam ("Fort 7-straat", "De 7 schakenpad", "Pad nr. 25").
  // `v` is de ontlede vraag, `r` die met haar cijfers (leeg als ze gelijk zijn); een lege `r` past nergens.
  const v = q.compact;
  const r = q.ruw && q.ruw !== q.compact ? q.ruw : "";
  const begint = (n) => n.startsWith(v) || (r && n.startsWith(r));
  // Tikfoutsuggesties alleen als niets zeker past: eerst exact, begint met, woord en bevat voor alle plekken; de
  // (duurdere) tikfoutafstand pas daarna. Met de straten van heel de stad (site/stad-zoeken.js) zijn dat er bijna
  // 4.000. Een "bevat" is niet zeker: "Stenplein" zit in het Kunstenplein (Berchem), maar is een tikfout voor het
  // Steenplein. Passen er alleen zulke stukken, dan komen de tikfouten er ook bij (nakijkronde 12 oktober 2026).
  const rest = [];
  const neem = (place, score, match) => results.push({ place, score: counts ? score + Math.min(6, counts.get(place.key) || 0) : score, match });
  for (const place of places) {
    if (place.type === "postcode") {
      if (place.code.startsWith(q.compact)) results.push({ place, score: place.code === q.compact ? 100 : 70, match: "prefix" });
      continue;
    }
    if (q.postcode && (place.type === "straat" || place.type === "buiten") && place.postcode && place.postcode !== q.postcode) continue;
    const c = place.compact;
    const al = place.aliases;
    if (c === v || (r && c === r) || (al && (al.includes(v) || (r && al.includes(r))))) neem(place, 100, "exact");
    else if (begint(c) || (al && al.some(begint))) {
      // Hoe langer het stuk dat past, hoe hoger (de langste vorm die past).
      const lang = Math.max(...[v, r].filter((x) => x && (c.startsWith(x) || (al && al.some((n) => n.startsWith(x))))).map((x) => x.length));
      neem(place, 80 - Math.min(20, c.length - lang) / 2, "prefix");
    }
    // De woorden zijn al gevouwen (foldText): de staarten van de naam ("kristuskoningplein", "koningplein") één keer.
    else if ((place.staarten ||= place.words.map((w, i) => place.words.slice(i).join(""))).some(begint)) neem(place, 62, "word");
    else if ((v.length >= 3 && c.includes(v)) || (r.length >= 3 && c.includes(r))) neem(place, 45, "contains");
    else if (fuzzyMax) rest.push(place);
  }
  if (!results.some((r) => r.match !== "contains")) {
    for (const place of rest) {
      const d = Math.min(editDistance(q.compact, place.compact, fuzzyMax), ...((place.aliases || []).map((a) => editDistance(q.compact, a, fuzzyMax))));
      if (d <= fuzzyMax) neem(place, d <= 1 ? 50 : 25, "fuzzy");
      else if (q.compact.length >= 6 && place.compact.length > q.compact.length) {
        // Tikfout in het begin van een langere naam ("schrijfstr" → "schijfstraat").
        const head = place.compact.slice(0, q.compact.length);
        if (editDistance(q.compact, head, 1) <= 1) neem(place, 28, "fuzzy");
      }
    }
  }
  // Een tikfout in de hele naam ("Stenplein" voor Steenplein) ligt dichter bij de vraag dan een stuk midden uit een
  // langere naam (het Kunstenplein): daarom 50 tegen 45. Bij zulke halve treffers eerst de plekken van district
  // Antwerpen (die volgt deze agenda), dan de rest van de stad. Een zekere treffer (exact, begint met, woord: 62 of
  // meer) gaat altijd voor, ook in een ander district.
  const elders = (r) => (ZEKER.has(r.match) ? 0 : TYPE_RANK[r.place.type] >= TYPE_RANK.district ? 2 : 1);
  results.sort((a, b) => elders(a) - elders(b) || b.score - a.score || TYPE_RANK[a.place.type] - TYPE_RANK[b.place.type] || a.place.label.localeCompare(b.place.label, "nl") || String(a.place.postcode || "").localeCompare(String(b.place.postcode || "")));
  return results.slice(0, limit);
}

// Enter in de zoekbalk opent nooit een gok (stratentest van 12 oktober 2026: "Walemstraat" opende met Enter de
// Walenstraat, "Statiestraat" opende die van 2018 terwijl de bewoner die van Berchem zocht). Enter opent alleen:
// - de suggestie die de bewoner zelf koos (met de pijltjes: `gekozen`);
// - of de enige plek die precies zo heet (straatnaam, wijk of postcode), of de enige suggestie als die met de vraag
//   begint of een woord van haar naam ermee begint ("kammenstr" is de Kammenstraat).
// Heten meer plekken precies zo (dezelfde straatnaam in een andere postcode of een ander district), dan is het een
// keuze ("naamgenoten"); passen er meer ("meerdere"), dan ook. Past de vraag alleen ergens midden in een naam
// ("bevat": "Stenplein" in het Kunstenplein) of alleen met een tikfout, dan is elke suggestie een gok ("gok"): ook
// als het er maar één is (nakijkronde 12 oktober 2026). `resultaten`: wat searchPlaces teruggaf, in die volgorde.
// Twee stukken van dezelfde straat met dezelfde naam, postcode en wijk (twee ids in de straatas) zijn voor de bewoner
// één plek: daar is niets te kiezen.
const zelfdeVoorDeBewoner = (p) => [p.type, p.label, p.postcode || "", p.sub || ""].join("|");
export function enterKeuze(resultaten = [], { actief = -1, gekozen = false } = {}) {
  if (gekozen && resultaten[actief]) return { place: resultaten[actief].place };
  const uniek = (lijst) => {
    const gezien = new Map();
    for (const r of lijst) if (!gezien.has(zelfdeVoorDeBewoner(r.place))) gezien.set(zelfdeVoorDeBewoner(r.place), r);
    return [...gezien.values()];
  };
  const exact = uniek(resultaten.filter((r) => r.match === "exact"));
  if (exact.length === 1) return { place: exact[0].place };
  if (exact.length > 1) return { keuze: "naamgenoten", n: exact.length };
  const zeker = uniek(resultaten.filter((r) => ZEKER.has(r.match)));
  if (zeker.length === 1 && uniek(resultaten).length === 1) return { place: zeker[0].place };
  if (zeker.length) return { keuze: "meerdere", n: zeker.length };
  return { keuze: resultaten.length ? "gok" : "niets", n: resultaten.length };
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
  if (place.type === "straat" && place.ambiguous) return `${prefix}${place.label} ${place.postcode}`;
  return `${prefix}${place.type === "straat" ? place.label : place.name}`;
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
  // Eerst de naam zoals in de link, met haar cijfers ("De 7 schakenpad", "4 septemberpad"): parseQuery laat die als
  // huisnummer weg. Dan de ontlede vraag (straat zonder huisnummer). Een straat ook bij haar naam met
  // homoniemtoevoeging.
  const heet = (p, vorm) => p.compact === vorm || (p.type === "straat" && (p.aliases || []).includes(vorm));
  for (const vorm of [q.ruw, q.compact]) {
    if (!vorm) continue;
    const exact = candidates.filter((p) => p.type !== "postcode" && heet(p, vorm) && (!q.postcode || p.type !== "straat" || p.postcode === q.postcode));
    exact.sort((a, b) => TYPE_RANK[a.type] - TYPE_RANK[b.type]);
    if (exact[0]) return exact[0];
  }
  return null;
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

// "Alles" heeft geen einde: alle bekende komende en lopende items, hoe ver ze ook vooruit liggen.
export const PERIODS = Object.freeze([
  ["week", "7 dagen", 7],
  ["maand", "30 dagen", 30],
  ["kwartaal", "3 maanden", 92],
  ["alles", "Alles", Infinity],
]);
export const ALLES_TOT = "9999-12-31";
export function periodRange(key, today) {
  const days = (PERIODS.find(([k]) => k === key) || PERIODS[1])[2];
  return { from: today, to: Number.isFinite(days) ? addDays(today, days - 1) : ALLES_TOT };
}
// De vertrekstand van de periode (wens van 12 oktober 2026: "bij de straat zelf moet niet beperkt zijn, gewoon
// alle data die je hebt"). Wie een straat, wijk of postcode kiest, ziet alles; zonder plek (het overzicht van het
// hele district) blijft het de komende 30 dagen. Een periode uit de URL of een knop gaat altijd voor, ook in een
// oude link met ?periode=maand.
export const standaardPeriode = (place = null) => (place ? "alles" : "maand");
export const geldigePeriode = (key) => (PERIODS.some(([k]) => k === key) ? key : "");

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
// het evenement; valt alleen de opbouw in de periode, dan op de eerste dag van de opbouw. Een
// evenement van vandaag staat altijd bovenaan "nu bezig", ook als het maar één dag duurt (een koers,
// een stoet): het zakt niet onder de lopende werven in een aparte sectie "Vandaag".
export function groupForList(entries, { from, to, today }) {
  const running = [], days = new Map(), later = [], doorlopend = [];
  // Een evenement dat vandaag zelf plaatsvindt (niet de opbouw of de afbraak). Een periode van twee weken
  // of langer niet (een toelating van een maand of een jaar is geen evenement van vandaag), en bij losse
  // dagen (een maandag per maand) alleen als vandaag zo'n dag is.
  const vandaagEvenement = (e) => e.group === "evenementen" && !langEvenement(e) && (e.losseDagen?.length ? e.losseDagen.includes(today) : e.innameStart ? evenementFase(e, today) === "evenement" : Boolean(e.start) && e.start <= today && (e.end || e.start) >= today);
  for (const entry of entries) {
    const fase = evenementFase(entry, today);
    // Lang (twee weken of meer) en vandaag bezig: een eigen groep, onder wat vandaag echt gebeurt.
    if (langEvenement(entry)) {
      const p = periodeVan(entry);
      if (p.start && p.start <= today && (p.end || p.start) >= today) { doorlopend.push(entry); continue; }
    }
    // Opbouw of afbraak vandaag (een parkeerverbod dat nu geldt): bij "nu bezig", ook bij losse dagen.
    // Anders viel een dossier met losse dagen tijdens de afbraak na zijn laatste dag uit de lijst.
    if (fase === "opbouw" || fase === "afbraak") { running.push(entry); continue; }
    // Losse dagen: bij de eerstvolgende dag zelf, niet de hele periode bij "nu bezig".
    if (entry.losseDagen?.length && !vandaagEvenement(entry)) {
      const dag = entry.losseDagen.find((d) => d >= from && d >= today);
      if (!dag) continue;
      if (dag > to) { later.push({ ...entry, start: dag }); continue; }
      if (!days.has(dag)) days.set(dag, []);
      days.get(dag).push(entry);
      continue;
    }
    if (fase === "opbouw" || fase === "afbraak" || vandaagEvenement(entry)) { running.push(entry); continue; }
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
  // Een evenement van vandaag staat bovenaan "Loopt nu": het zakt niet onder de lopende werven en
  // werfzones. Daarna wat het eerst afloopt; een evenement van één dag loopt vandaag af, iets zonder
  // einde ("tot voorjaar 2027") komt achteraan.
  const eindVan = (e) => periodeVan(e).end || (e.openEnd ? "" : e.start) || "9999";
  running.sort((a, b) => Number(vandaagEvenement(b)) - Number(vandaagEvenement(a)) || String(eindVan(a)).localeCompare(String(eindVan(b))) || byTitle(a, b));
  later.sort((a, b) => a.start.localeCompare(b.start) || byTitle(a, b));
  doorlopend.sort((a, b) => String(eindVan(a)).localeCompare(String(eindVan(b))) || byTitle(a, b));
  return { running, days: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, list]) => [day, list.sort(byTitle)]), later, doorlopend };
}
// Een evenement (of evenementendossier) van twee weken of langer, zonder losse dagen: geen "Vandaag",
// een eigen groep "Doorlopend" in de lijst (klacht van 10 oktober 2026: maanden- en jaardossiers met
// "Vandaag" bovenaan). Werken en maatregelen blijven waar ze staan.
export const langEvenement = (e = {}) => e.group === "evenementen" && !e.losseDagen?.length && duurDagen(e.start, e.end) >= LANG_DAGEN;
// Het label bij een evenement op straat als de gewone fase ("Vandaag") niet klopt: een lange periode
// ("Loopt tot 29 okt") of losse dagen ("Vandaag" alleen op zo'n dag, anders "Volgende: 9 nov"). Anders
// null: dan de gewone badge van de fase (place-view.js, FASE_BADGE).
export function evenementBadge(entry = {}, today = "") {
  const fase = evenementFase(entry, today);
  if (!fase || fase === "voorbij" || fase === "gepland") return null;
  if (entry.losseDagen?.length) {
    if (entry.losseDagen.includes(today)) return { label: "Vandaag", soort: "now" };
    const volgende = entry.losseDagen.find((d) => d > today);
    return volgende ? { label: `Volgende: ${kortDatum(volgende, today)}`, soort: "planned" } : null;
  }
  if (fase === "evenement" && langEvenement(entry)) return { label: entry.end ? `Loopt tot ${kortDatum(entry.end, today)}` : "Doorlopend", soort: "period" };
  return null;
}
// Gebeurt er op dag `d` echt iets, voor een teken in de tijdlijn en de lijst van die dag? Opbouw en afbraak
// (een parkeerverbod) wel. Losse dagen (elke woensdag) alleen op die dagen, niet de hele periode ertussen;
// een werfzone met fasen en een gat ertussen alleen op de dagen van een fase; een parkeerverbod "alleen op
// weekdagen" niet op zaterdag en zondag. Een toelating van de stad van twee weken of langer niet per dag (de
// lijst zet ze bij "Doorlopend"), wel op haar eerste dag. Een agendapunt van weken (een foor, een expo) wel
// elke dag: dat gebeurt die dagen echt. Anders de periode zelf (overlaps).
export function opDag(entry = {}, d = "") {
  const fase = evenementFase(entry, d);
  if (fase === "opbouw" || fase === "afbraak") return true;
  if (entry.losseDagen?.length) return entry.losseDagen.includes(d);
  if (entry.fasen?.length > 1) return entry.fasen.some(([van, tot]) => van <= d && d <= (tot || van));
  if (entry.item?.kind === "parking" && alleenWeekdagen(entry.item) && weekdayMon0(d) >= 5) return false;
  if (langEvenement(entry) && entry.source !== "agenda") return d === entry.start;
  return overlaps(entry, d, d);
}
// Een parkeerverbod dat alleen op weekdagen geldt (A-Sign: EnkelWeekdagen, of "weekdag" in de omschrijving).
export const alleenWeekdagen = (row = {}) => row?.weekdaysOnly === true || /weekdag/i.test(String(row?.detail || ""));

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
// Het uur in Brussel van een tijdstip ("2026-10-13T05:00:00Z" → "07:00"); "" zonder uur in de bron.
const BRUSSELS_TIME = typeof Intl !== "undefined" ? new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Brussels", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : null;
export function uurOf(value) {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text) || !BRUSSELS_TIME) return "";
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? BRUSSELS_TIME.format(new Date(ms)) : "";
}
// De uren van een werk of een werfzone van één dag, uit het begin- en eindtijdstip van de bron (GIPOD,
// A-Sign): { time: "07:00", timeText: "van 7.00 tot 18.00 uur" }, of { time: "", timeText: "hele dag" } voor
// 0.00 tot 23.59. null als de bron geen uur geeft, of als het niet binnen één dag valt. Zo staat er geen
// "Uur onbekend" bij een werfzone van 9 tot 15 uur.
// Een begin om precies middernacht UTC ("2026-12-01T00:00:00Z") is een datum zonder uur: in Brussel werd dat
// "01.00" of "02.00" 's nachts, een uur dat de bron niet geeft (nakijkronde 13 oktober 2026, GIPOD 19176027 op het
// Steenplein). Dan geen uren, zoals vroeger.
const MIDDERNACHT_UTC = /T00:00(?::00(?:\.0+)?)?(?:Z|[+-]00:?00)$/;
export function urenVanDag(start, end) {
  if (MIDDERNACHT_UTC.test(String(start ?? ""))) return null;
  const van = uurOf(start), tot = uurOf(end);
  if (!van || !tot || dayOf(start) !== dayOf(end)) return null;
  if (van <= "00:01" && tot >= "23:59") return { time: "", timeText: "hele dag" };
  if (tot <= van) return null;
  return { time: van, timeText: `van ${uurKort(van)} tot ${uurKort(tot)} uur` };
}
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
    // De soort inname die de verversing bewaarde, als de soort nu uit iets anders komt (de fasen): die blijft erbij.
    ...(() => {
      const bewaardInname = bewaard.soort && /^soort inname\b/.test(String(bewaard.soortBron || "")) ? bewaard.soort : "";
      const inname = live.innameSoort || bewaard.innameSoort || (bewaardInname && live.soort && bewaardInname !== live.soort ? bewaardInname : "");
      return inname ? { innameSoort: inname } : {};
    })(),
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

// De identiteit van evenementendossiers: de met de hand nagekeken fiches (evenement-identiteit.json)
// winnen altijd van de automatische herkenning (evenement-identiteit-auto.json, zie
// lib/parcours-herkenning.mjs). Zonder fiche koppelt de kaart zelf live aan de agenda.
export function identiteitSamen(hand = null, auto = null) {
  if (!auto?.dossiers) return hand;
  return { ...(hand || {}), dossiers: { ...auto.dossiers, ...(hand?.dossiers || {}) } };
}

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
    // Ernstige hinder bij één van de stukken geldt voor de kaart: anders hing het licht van de weekzin
    // (dezeWeek) af van de volgorde in GIPOD (alleen het eerste stuk telde). De kaart zegt het dan ook, met
    // bij hoeveel stukken: info en uitleg komen van het eerste stuk, en dat heeft misschien geen ernstige hinder.
    const ernstigeStukken = lijst.filter((e) => e.item?.hindrance?.severe === true).length;
    const ernstig = ernstigeStukken > 0;
    const deel = `bij ${ernstigeStukken} van de ${lijst.length} stukken`;
    const info = ernstig && eerste.item?.hindrance?.severe !== true ? [eerste.info, `Ernstige hinder ${deel}`].filter(Boolean).join(" · ") : eerste.info;
    const hinderRegel = ernstig && ernstigeStukken < lijst.length ? [["Ernstige hinder", `${deel}, volgens GIPOD`]] : [];
    // `rijen`: alle stukken, voor de buurtkaart (een punt per stuk). Alleen voor de kaart, niet voor de tekst.
    return { ...eerste, info, reference: `GIPOD ${ids.join(", ")}`, werfzones: lijst.length, gipodIds: ids, ernstig, rijen: lijst.map((e) => e.item), uitleg: eerste.uitleg ? { ...eerste.uitleg, regels: [...eerste.uitleg.regels, regel, ...hinderRegel] } : eerste.uitleg };
  });
}
// Zo telt het plekoverzicht ("N items uit officiële bronnen"): een agendapunt per activiteit (titel en plek:
// een weekmarkt met acht marktdagen is er één), een kaart uit de live lagen per uid. "X in de lijst" onder de
// buurtkaart telt anders: de kaarten die de lijst echt toont, zoals de aantallen naast de koppen (place-view.js).
// Een kaartje van een wekelijkse markt (marktBundelEntry) telt zoals zijn marktdagen: per titel en plek.
export const lijstSleutel = (entry = {}) => entry.telSleutel || (entry.source === "agenda" || entry.source === "markt" ? `${entry.title}|${entry.location}` : entry.uid);
export const lijstAantal = (entries = []) => new Set(entries.map(lijstSleutel)).size;
// Voor de buurtkaart: de kaart tekent een punt per GIPOD-stuk, de lijst een kaart per werf (werkEntries).
// Per GIPOD-nummer van een stuk het nummer van zijn werf, zodat de kaart per kaart van de lijst telt.
export function werfPerStuk(entries = []) {
  const werf = {};
  for (const entry of entries) for (const id of entry.gipodIds || []) werf[id] = String(entry.gipodIds[0]);
  return werf;
}

// ---- soorten op de buurtkaart (P9) ----
// De legenda van de kaart: vijf soorten. De kleur is die van de rij in de lijst (kindInfo in place-view.js),
// en elke soort heeft ook een eigen vorm: kleur is nooit de enige drager. Agendapunten blijven pins in hun
// eigen categoriekleur; `cat` is daar alleen de kleur van de legendaknop.
export const KAART_SOORTEN = Object.freeze([
  Object.freeze({ key: "evenement", label: "Evenement & parcours", cat: "festival", vorm: "lijn" }),
  Object.freeze({ key: "werken", label: "Werken", cat: "works", vorm: "stip" }),
  Object.freeze({ key: "verkeer", label: "Omleiding, parkeerverbod & inname", cat: "publicSpace", vorm: "streep" }),
  Object.freeze({ key: "vergunning", label: "Vergunningen", cat: "permits", vorm: "ring" }),
  Object.freeze({ key: "agenda", label: "Agendapunten", cat: "other", vorm: "pin" }),
]);
// De soort van een kaart van de lijst. Een evenementendossier (ook een inname die geen evenement met publiek
// is) is een evenement; de andere publieke ruimte (parkeerverbod, werfzone, omleiding, losse inname) is verkeer.
// Een marktbundel (marktBundelEntry) is een agendapunt.
export function kaartSoort(e = {}) {
  // Een bundel (bundelLijst): de soort van haar leden.
  if (e.source === "bundel") return { terrassen: "vergunning", aanvragen: "vergunning", werfzones: "verkeer" }[e.bundel?.soort] || "evenement";
  if (e.source === "works") return "werken";
  if (e.source === "publicSpace") return String(e.uid || "").startsWith("publicSpace:dossier:") || e.item?.kind === "event" ? "evenement" : "verkeer";
  if (e.source === "permits" || e.source === "terraces") return "vergunning";
  return "agenda";
}
// Eén kaartje van de lijst per wekelijkse markt (bundleWeeklyMarkets in agenda-uitgaan.js), om te tellen. Het
// telt met dezelfde sleutel als de marktdagen zelf (lijstSleutel), die als pins op de kaart staan.
export const marktBundelEntry = (m = {}) => {
  const title = cleanText(m.title), location = cleanText(m.location);
  return { uid: `markt|${title}|${location}`, source: "markt", theme: "markets", group: "markten", title, location };
};
// Tellen per soort, met dezelfde sleutel als het plekoverzicht (lijstSleutel): een agendapunt op drie data is
// één, een kaart uit de live lagen per uid. Bij dezelfde sleutel wint het eerste voorkomen, zodat de som per
// soort altijd het totaal is. `soortVan`: sleutel → soort, voor de kaart.
// `items`: hoeveel items uit de bronnen dat zijn, met de leden van een bundel elk apart (een regel "28 terrassen" is 28
// items, geen 1): het getal van "N items uit officiële bronnen" (plekSubTekst, deelTekst). `totaal` en `per` tellen de
// kaarten van de lijst (een bundel één keer), zoals de legenda van de kaart (nakijkronde 13 oktober 2026: met bundels
// zei de zin "3 items" voor 1 activiteit, 3 aanvragen en 4 terrassen).
export function telPerSoort(lijst = []) {
  const per = Object.fromEntries(KAART_SOORTEN.map((s) => [s.key, 0]));
  const soortVan = new Map();
  let items = 0;
  for (const e of lijst) {
    const sleutel = lijstSleutel(e);
    if (soortVan.has(sleutel)) continue;
    const soort = kaartSoort(e);
    soortVan.set(sleutel, soort);
    per[soort] += 1;
    items += e?.bundel?.leden?.length ? new Set(e.bundel.leden.map((l) => l?.uid || l)).size : 1;
  }
  return { per, soortVan, totaal: soortVan.size, items };
}
// Wat de lijst toont bij periode "alles" (renderList in place-view.js): alle bakken van groupForList (wat
// "later gepland" is ook), elke kaart één keer (de bak "later" maakt een kopie met de volgende losse dag),
// de vergunningen, en één kaartje per wekelijkse markt (`markten`: de bundels die de lijst toont). Niet: een
// item zonder datum, een afgelopen item, een losse marktdag die geen wekelijkse markt is.
// Met bundels (bundelLijst): een bundel is één kaart, haar leden staan er niet apart in. `straat`: de gekozen straat.
export function lijstUniversum(entries = [], today = "", { markten = [], straat = "" } = {}) {
  const { losse, bundels } = bundelLijst(entries, { straat, vandaag: today });
  const dated = [...losse, ...bundels.filter((b) => b.bundel.soort === "studenten")].filter((e) => e.theme !== "markets" && e.group !== "vergunningen");
  const eigen = new Map();
  for (const e of dated) if (!eigen.has(e.uid)) eigen.set(e.uid, e);
  const { running, days, later, doorlopend } = groupForList(dated, { ...periodRange("alles", today), today });
  const uit = [], gezien = new Set();
  const neem = (e) => { if (!gezien.has(e.uid)) { gezien.add(e.uid); uit.push(eigen.get(e.uid) || e); } };
  for (const e of [...running, ...days.flatMap(([, lijst]) => lijst), ...doorlopend, ...later]) neem(e);
  for (const b of bundels) if (b.bundel.soort === "innames" || b.bundel.soort === "werfzones") neem(b);
  for (const e of losse) if (e.group === "vergunningen") neem(e);
  for (const b of bundels) if (b.bundel.soort === "aanvragen" || b.bundel.soort === "terrassen") neem(b);
  for (const m of markten) neem(marktBundelEntry(m));
  return uit;
}
// Waartoe de knoppen de lijst nu beperken, in één zin; leeg als de lijst alles toont (periode "Alles").
// `periodeLabel`: het label van de gekozen periode ("7 dagen"); `dagLabel`: de gekozen dag in de tijdlijn
// ("dinsdag 20 oktober"); `vergunningen`: hoeveel vergunningen en terrassen er op de plek staan (telPerSoort,
// soort "vergunning"). De tijdlijn en de maand tonen die nooit (renderTijdlijn en renderMonth in place-view.js):
// staan ze er, dan zegt de zin dat ook (nakijkbevinding: in de Offerandestraat waren 47 van de 49 items
// vergunningen of terrassen, en de zin gaf alleen de 14 dagen als reden). De maand zegt het altijd: ze toont per
// dag, en wat bij een dag hoort staat pas onder de kalender als je die dag kiest.
export function beperkingTekst({ mode = "lijst", periode = "alles", periodeLabel = "", dagLabel = "", vergunningen = 0 } = {}) {
  const zonder = vergunningen > 0 ? ", zonder vergunningen en terrassen" : "";
  if (mode === "tijdlijn") return `De tijdlijn toont alleen ${dagLabel || "de komende 14 dagen"}${zonder}; kies “Lijst” voor alles.`;
  if (mode === "maand") return `De maand toont per dag wat er gebeurt${zonder}; kies “Lijst” voor alles.`;
  if (periode === "alles" || !periodeLabel) return "";
  return `De lijst toont alleen de komende ${periodeLabel}; kies “Alles” voor de rest.`;
}
// De zin onder "Alles op deze plek": hoeveel er op de plek staat (wat de lijst bij periode "Alles" toont,
// lijstUniversum en telPerSoort), met de straal, en als de knoppen de lijst beperken ook dat (beperkingTekst).
// Zo kloppen het getal en de lijst eronder altijd: alles, of een zin die zegt waarom het er minder zijn.
export function plekSubTekst({ totaal = 0, straat = false, straal = 0, beperking = "" } = {}) {
  const rond = straat && straal ? `, ook ${straal >= 1000 ? "1 km" : `${straal} m`} rond de straat (terrassen alleen in de straat zelf)` : "";
  const basis = `${totaal} item${totaal === 1 ? "" : "s"} uit officiële bronnen${rond}.`;
  return beperking ? `${basis} ${beperking}` : basis;
}
// Wat "Deel" meestuurt (navigator.share) naast de link: de plek, hoeveel er staat, waartoe de link de lijst
// beperkt (een periode, de tijdlijn of de maand die in de link staat; een gekozen dag staat er niet in) en de zin van de
// komende 7 dagen als samenvatting.
export function deelTekst({ plek = "", totaal = 0, beperking = "", week = "" } = {}) {
  const kop = `${plek ? `${plek}: ` : ""}${totaal} item${totaal === 1 ? "" : "s"} uit officiële bronnen op de publieke agenda.`;
  return [kop, beperking, week].filter(Boolean).join(" ");
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
// Een agendapunt dat alleen uit de evenementendossiers van de stad komt (lib/asign-evenementen-agenda.mjs).
// Samengevoegd met de kalender of het nieuws telt het wel: dan is er een tweede bron.
export function alleenUitDossiers(item = {}) {
  const bronnen = Array.isArray(item?.sources) && item.sources.length ? item.sources.map((s) => s?.sourceId) : [item?.sourceId];
  return bronnen.every((id) => id === "district-asign-evenementen");
}

// ---- één kaart per dossiernummer ----
// Het dossiernummer van een agendapunt uit de evenementendossiers van de stad (lib/asign-evenementen-agenda.mjs),
// ook als het samengevoegd is met een andere bron; anders "".
export function dossierVanAgendapunt(item = {}) {
  const id = cleanText(item?.externalId);
  const uitDossiers = item?.sourceId === "district-asign-evenementen" || (Array.isArray(item?.sources) && item.sources.some((s) => s?.sourceId === "district-asign-evenementen"));
  return uitDossiers && /^ET\d{10}$/.test(id) ? id : "";
}
// Alle dossiers van zo'n agendapunt: het eigen nummer en de dossiers waarmee het samengevoegd is (`ookDossiers`
// uit lib/asign-evenementen-agenda.mjs; bij een bronbestand van vóór dat veld de zin "Ook dossier ET..." in de info).
const OOK_DOSSIER = /\bOok dossier (ET\d{10})\b/g;
export function dossiersVanAgendapunt(item = {}) {
  const eigen = dossierVanAgendapunt(item);
  if (!eigen) return [];
  const ook = Array.isArray(item?.ookDossiers) ? item.ookDossiers : [...cleanText(item?.info).matchAll(OOK_DOSSIER)].map((m) => m[1]);
  return [...new Set([eigen, ...ook.map(cleanText).filter((id) => /^ET\d{10}$/.test(id))])];
}
// De straten van zo'n agendapunt (het veld straten uit de feed), om het aan al zijn straten te koppelen. Alleen
// als de verversing zegt dat de lijst volledig en per dossier juist is (`stratenVolledig`, lib/asign-evenementen-
// agenda.mjs). Een ouder bronbestand voegde dossiers samen op een gegokte titel (de straten van het ene dossier
// bij het andere), nam het middelpunt van een reuzenvlak als straat (de Groenplaats bij ET2025007162) en kapte de
// zone af achter het parcours: dan geen lijst, en het punt hangt aan de straten uit zijn locatie, zoals vroeger.
// Een ouder bronbestand wel met `stratenBevestigd` (scripts/build-sources.mjs, stratenUitFiche: de straten die de
// handfiche of het uur van het punt zelf noemt): dan die straten plus de straten uit de locatie, nooit de rest van de
// oudere lijst (nakijkronde 13 oktober 2026: Winter in Antwerpen op de Groenplaats, het kratstapelen van AAAntwerp).
export function stratenVanAgendapunt(item = {}) {
  if (!dossierVanAgendapunt(item) || !Array.isArray(item?.straten)) return [];
  if (item?.stratenVolledig === true) return [...new Set(item.straten.map(cleanText).filter(Boolean))];
  const bevestigd = Array.isArray(item?.stratenBevestigd) ? item.stratenBevestigd.map(cleanText).filter(Boolean) : [];
  if (!bevestigd.length) return [];
  const locatie = ` ${foldText(item.location)} `;
  const uitLocatie = item.straten.map(cleanText).filter((n) => n && locatie.includes(` ${foldText(n)} `));
  return [...new Set([...uitLocatie, ...bevestigd])];
}
// Wat de kaart van een agendapunt over zijn straten toont (nakijkronde 13 oktober 2026: "Steenplein, Ernest Van
// Dijckkaai, Grote Markt en 8 andere straten" op de Groenplaats, zonder dat de Groenplaats ergens stond):
// - `jouwStraat`: de gekozen straat, als het punt haar raakt (stratenVanAgendapunt) en de plaats ze niet al noemt;
// - `straten`: de volledige lijst, met de gekozen straat vooraan, alleen als de verversing zegt dat ze volledig en per
//   dossier juist is (`stratenVolledig`). Dan komt "Toon alle N straten" uit dezelfde lijst als "en N andere straten"
//   in de plaats; een oudere lijst kan straten van een ander dossier bevatten, en die tonen we niet.
export function agendaStraten(item = {}, straat = "") {
  const lijst = stratenVanAgendapunt(item);
  const n = foldText(zonderHomoniem(cleanText(straat)));
  const eigen = n ? lijst.find((x) => foldText(zonderHomoniem(x)) === n) || "" : "";
  const inPlaats = Boolean(eigen) && ` ${foldText(item?.location)} `.includes(` ${foldText(eigen)} `);
  const volledig = item?.stratenVolledig === true && lijst.length > 3;
  return {
    jouwStraat: eigen && !inPlaats ? eigen : "",
    straten: volledig ? (eigen ? [eigen, ...lijst.filter((x) => x !== eigen)] : lijst) : [],
  };
}
// Toont dit agendapunt op deze straat het label "Aanvraag, nog niet goedgekeurd"? Het hele punt (geen dossier
// goedgekeurd), of een straat die alleen een dossier raakt dat nog niet goedgekeurd is (`nietGoedgekeurdStraten`:
// de lus van ET2026005657 bij het goedgekeurde ET2026004212). Zonder straat (een wijk): zoals de lijst.
export function nietGoedgekeurdOp(item = {}, straat = "") {
  if (item?.nietGoedgekeurd === true) return true;
  const naam = cleanText(straat);
  return Boolean(naam) && Array.isArray(item?.nietGoedgekeurdStraten) && item.nietGoedgekeurdStraten.some((s) => cleanText(s) === naam);
}
// Eén kaart per dossiernummer: staat de kaart van een evenementendossier er al (live of uit de stand van de
// ochtend), dan valt het agendapunt van datzelfde dossier weg uit de lijst; de kaart krijgt het agendapunt mee
// (`agendaPunt`, voor de deellink en de .ics). Zo stond de Najaarsfoor op de Dageraadplaats er twee keer, en een
// studentenactiviteit op de Groenplaats als kaart én als "markt". Een samengevoegd agendapunt telt voor al zijn
// dossiers (dossiersVanAgendapunt): de kaart van het partnerdossier is hetzelfde evenement. Geeft { agenda, live }
// terug, nieuwe lijsten.
export function eenKaartPerDossier(agenda = [], live = []) {
  const kaarten = new Map();
  for (const e of live) if (String(e?.uid || "").startsWith("publicSpace:dossier:") && e.id) kaarten.set(e.id, e);
  if (!kaarten.size) return { agenda, live };
  const punten = new Map();
  const blijft = agenda.filter((e) => {
    const dossier = e?.source === "agenda" ? dossiersVanAgendapunt(e.item).find((id) => kaarten.has(id)) : "";
    if (!dossier) return true;
    if (!punten.has(dossier)) punten.set(dossier, []);
    punten.get(dossier).push(e.item);
    return false;
  });
  // Alle agendapunten van het dossier gaan mee met de kaart (`agendaPunten`, per dag een deellink en een .ics; een
  // nakijkbevinding: met alleen het eerste viel de tweede dag uit de .ics). `agendaPunt` is het vroegste.
  // Wat het agendapunt over het dossier zei en de kaart niet ("laatst gewijzigd op 8 september 2026: aanvraag
  // goedgekeurd"), blijft op de kaart staan: het agendapunt verdwijnt uit de lijst (nakijkronde 13 oktober 2026).
  const metPunten = (e) => {
    const lijst = [...new Map(punten.get(e.id).map((i) => [String(i?.id ?? ""), i])).values()].sort((a, b) => String(a?.date).localeCompare(String(b?.date)));
    const stand = lijst.map((i) => cleanText(i?.info).match(/\(A-Sign\), (laatst gewijzigd op [^:]+: [^.]+)\./)?.[1]).find(Boolean) || "";
    const kaartTekst = JSON.stringify(e.uitleg || {});
    // De organisatie zoals het agendapunt ze noemt (uit een besluit of een fiche), als de kaart ze niet al zo noemt.
    const organisatie = lijst.map((i) => cleanText(i?.info).match(/\bOrganisatie: ([^.]{2,120}(?:\.(?! )[^.]*)*)\./)?.[1]).find(Boolean) || "";
    const erbij = [
      ...(stand && !kaartTekst.includes("laatst gewijzigd") ? [["Dossier in A-Sign", stand]] : []),
      ...(organisatie && !kaartTekst.includes(organisatie) ? [["Organisatie volgens het agendapunt", organisatie]] : []),
    ];
    const uitleg = erbij.length && e.uitleg ? { ...e.uitleg, regels: [...(e.uitleg.regels || []), ...erbij] } : e.uitleg;
    return { ...e, ...(uitleg ? { uitleg } : {}), agendaPunt: lijst[0], agendaPunten: lijst };
  };
  return { agenda: blijft, live: live.map((e) => (punten.has(e.id) && kaarten.get(e.id) === e ? metPunten(e) : e)) };
}

// ---- één werfkaart per dossiernummer (vaagheidsplan van 12 oktober 2026, stap 4) ----
// Een werf staat in drie bronnen: de werfzone (en omleiding) in A-Sign, een "werk" in GIPOD en parkeerverboden "voor
// een werf". GIPOD zet het dossiernummer van de werfzone in Reference (werfDossier in site/works-core.js; in de
// verversing bewaard als kaart-uitleg.json werken[gipodId].dossier). Op dat nummer worden ze één kaart:
// - staat het werk ook op de plek, dan is de werfkaart dat werk, met de werfzone en de parkeerverboden erin;
// - anders krijgt de werfzone het "waarvoor" uit GIPOD (de fasen of de soort uit de tekst van de beheerder).
// Nooit op datum alleen: twee werfzones in dezelfde straat met dezelfde data (GW2026-001601 en -001602 in de
// Blancefloerlaan) hebben elk hun eigen GIPOD-werk. Een parkeerverbod heeft in A-Sign geen dossiernummer van zijn
// werf (GipodID is leeg): het hoort bij een werfzone als het in dezelfde straat ligt als de werfzone, voor een werf
// is (de reden), en precies dezelfde dagen heeft als een fase van die werfzone, en als er precies één zo'n werfzone is.
// `alle`: alle rijen van de publieke ruimte (ook de fasen buiten de plek); `uitleg`: site/sources/kaart-uitleg.json.
const WERF_REDEN = /werfsignalisatie/i;
// Een soort die alleen uit de vaste soort inname van GIPOD komt ("Wegenwerken" bij "Wegeniswerken"), is bij een
// werfzone de standaard van de invoer, geen beschrijving (nakijkronde 12 oktober 2026): dan geen soort.
const echteSoort = (f) => (f?.soort && !/^soort inname\b/.test(String(f.soortBron || "")) ? f.soort : "");
const dagenVan = (r) => `${dayOf(r?.start)}|${dayOf(r?.end)}`;
// De fasen van de werfzones als index, één keer per samenWerven (nakijkronde 12 oktober 2026: per parkeerverbod
// opnieuw over alle fasen lopen kostte op een postcodepagina met 552 parkeerverboden en 480 fasen een halve seconde,
// op een gsm seconden, bij elke tekenbeurt). Per begin- en einddag (dagenVan) het dossier en de gevouwen straten van
// de werfzone. Een rij die er twee keer in staat (de lijst van de plek en de rijen van de kaarten overlappen), telt
// één keer.
export function werfzoneIndex(sgwRijen = []) {
  const perDagen = new Map(), gezien = new Set();
  for (const r of sgwRijen) {
    if (r?.kind !== "sgw") continue;
    const d = werfDossier(r.reference);
    if (!d) continue;
    const dagen = dagenVan(r);
    const sleutel = `${r.id ?? ""}|${dagen}|${d}`;
    if (gezien.has(sleutel)) continue;
    gezien.add(sleutel);
    const zone = (r.werfzoneStreets?.length ? r.werfzoneStreets : r.streets || []).map((x) => foldText(x?.name)).filter(Boolean);
    if (!perDagen.has(dagen)) perDagen.set(dagen, []);
    perDagen.get(dagen).push({ dossier: d, zone });
  }
  return perDagen;
}
// `sgw`: de rijen van de werfzones, of hun index (werfzoneIndex).
export function parkeerverbodVoorWerf(parkeer, sgw = []) {
  const eigen = parkeer?.rijen?.length ? parkeer.rijen : [parkeer?.item].filter(Boolean);
  if (!eigen.length || !eigen.every((r) => WERF_REDEN.test(cleanText(r?.reason || r?.title)))) return [];
  const index = sgw instanceof Map ? sgw : werfzoneIndex(sgw);
  const straten = new Set(eigen.flatMap((r) => (r?.streets || []).map((x) => foldText(x?.name))).filter(Boolean));
  const dossiers = new Set();
  for (const dagen of new Set(eigen.map(dagenVan))) {
    for (const fase of index.get(dagen) || []) if (fase.zone.some((n) => straten.has(n))) dossiers.add(fase.dossier);
  }
  return [...dossiers];
}
const uurKortTekst = (row) => parkeerUren(row);
// Wat de losse kaart van een parkeerverbod zei, blijft in de werfkaart staan (nakijkronde 13 oktober 2026: geen kaart
// mag minder feiten tonen dan vroeger): de periode, de uren, het nummer, de status in A-Sign en de reden van de stad.
function parkeerRegel(lijst, vandaag) {
  const delen = lijst.map((p) => {
    const r = p.item || {};
    const uren = uurKortTekst(r);
    const periode = kortePeriode(dayOf(r.start), dayOf(r.end), vandaag);
    const status = cleanText(p.status || statusNl(r.status));
    return `${periode}${uren ? `, ${uren}` : ""}${alleenWeekdagen(r) ? ", alleen op weekdagen" : ""} (${[cleanText(r.reference) || "A-Sign", status ? kleineLetter(status) : ""].filter(Boolean).join(", ")})`;
  });
  const redenen = [...new Set(lijst.map((p) => redenZin(parkeerReden(p.item || {}))).filter(Boolean))];
  const reden = redenen.length ? ` Reden volgens de stad: ${redenen.join("; ")}.` : "";
  return ["Parkeerverbod", `${delen.join(" · ")}.${reden} Zelfde straat en dezelfde dagen als een fase van de werfzone; A-Sign zet bij een parkeerverbod geen dossiernummer.`];
}
// Wat GIPOD over de werf van een werfzone zegt: de soort uit de tekst van de beheerder of de fasen, anders de fasen
// die iets zeggen (faseDoelen). Leeg als GIPOD alleen genummerde fasen heeft.
// `bron`: "fasen" als het doel letterlijk de naam van een fase is; anders waaruit de soort afgeleid is (soortBron).
// Eén keer per object met feiten (de werken van kaart-uitleg.json blijven dezelfde objecten tussen twee tekenbeurten).
const WERF_DOEL = new WeakMap();
export function werfDoel(feiten) {
  if (feiten && typeof feiten === "object" && WERF_DOEL.has(feiten)) return WERF_DOEL.get(feiten);
  const f = herzieneSoort(feiten);
  const soort = echteSoort(f);
  const fasen = soort ? [] : faseDoelen((f?.fasen || []).map((x) => x?.naam));
  const uit = soort ? { kort: soort.charAt(0).toLowerCase() + soort.slice(1), lijst: [soort], bron: cleanText(f.soortBron) || "de tekst in GIPOD" }
    : fasen.length ? { kort: fasen.slice(0, 3).map((x) => `“${x}”`).join(", "), lijst: fasen, bron: "fasen" } : null;
  if (feiten && typeof feiten === "object") WERF_DOEL.set(feiten, uit);
  return uit;
}
// Een soort die de verversing uit de namen van de fasen afleidde (soortBron), opnieuw met de code van nu: een betere
// herkenning geldt meteen, ook voor de bewaarde stand ("Afbraak werf" is geen sloop; nakijkronde 12 oktober 2026).
const FASEN_BRON = "fasen van de hinder in GIPOD";
function herzieneSoort(f) {
  if (!f || f.soortBron !== FASEN_BRON) return f;
  const nu = soortVanWerk({ omschrijving: f.omschrijving || "", fasen: (f.fasen || []).map((x) => x?.naam || ""), eigenaar: f.opdrachtgever || "" });
  return { ...f, soort: nu.soort || "", soortBron: nu.soort ? nu.bron : "" };
}
// Een afgeleide soort is geen uitspraak van GIPOD: "afgeleid uit de namen van de fasen in GIPOD".
const afgeleidUit = (bron) => `de ${String(bron).replace(/^fasen van de hinder\b/, "namen van de fasen").replace(/^de\s+/, "")}${/GIPOD/.test(bron) ? "" : " in GIPOD"}`;
export function waarvoorZin(doel) {
  if (!doel) return "";
  return doel.bron === "fasen" ? `Waarvoor, volgens de namen van de fasen in GIPOD (zelfde dossiernummer): ${doel.kort}.`
    : `Waarvoor, afgeleid uit ${afgeleidUit(doel.bron)} (zelfde dossiernummer): ${doel.kort}.`;
}
// Per dossiernummer het eerste GIPOD-werk van kaart-uitleg.json; één keer per bestand (WeakMap).
const GIPOD_PER_DOSSIER = new WeakMap();
function gipodPerDossier(uitleg) {
  if (!uitleg || typeof uitleg !== "object") return new Map();
  let gipod = GIPOD_PER_DOSSIER.get(uitleg);
  if (!gipod) {
    gipod = new Map();
    for (const [id, w] of Object.entries(uitleg.werken || {})) { const d = werfDossier(w?.dossier); if (d && !gipod.has(d)) gipod.set(d, { gipodId: Number(id), feiten: w }); }
    GIPOD_PER_DOSSIER.set(uitleg, gipod);
  }
  return gipod;
}
export function samenWerven(entries = [], { uitleg = null, straat = "", vandaag = "", alle = [] } = {}) {
  const werken = uitleg?.werken || {};
  const dossierVan = (w) => werfDossier(w?.dossier) || werfDossier(werken[w?.gipodId]?.dossier);
  // De werkkaarten met een werfdossier (een kaart met meer stukken: elk stuk telt).
  const werkKaart = new Map();
  for (const e of entries) {
    if (e?.source !== "works") continue;
    for (const w of e.rijen?.length ? e.rijen : [e.item]) { const d = dossierVan(w); if (d && !werkKaart.has(d)) werkKaart.set(d, e); }
  }
  const sgwKaart = new Map();
  for (const e of entries) { const d = e?.source === "publicSpace" && e.item?.kind === "sgw" ? werfDossier(e.item?.reference) : ""; if (d && !sgwKaart.has(d)) sgwKaart.set(d, e); }
  if (!werkKaart.size && !sgwKaart.size) return entries;
  const gipod = gipodPerDossier(uitleg);
  // Alle fasen van de werfzones die we kennen (ook buiten de plek), om een parkeerverbod aan zijn werfzone te hangen:
  // één index voor alle parkeerverboden (werfzoneIndex).
  const sgwIndex = werfzoneIndex([...(Array.isArray(alle) ? alle : []), ...entries.flatMap((e) => (e?.source === "publicSpace" && e.item?.kind === "sgw" ? e.rijen || [] : []))]);
  const bij = new Map(); // uid van de werfkaart → { sgw: [], parkeer: [] }
  const voeg = (uid) => { if (!bij.has(uid)) bij.set(uid, { sgw: [], parkeer: [] }); return bij.get(uid); };
  const weg = new Set();
  for (const [d, e] of sgwKaart) {
    const kaart = werkKaart.get(d);
    if (kaart) { voeg(kaart.uid).sgw.push(e); weg.add(e.uid); }
  }
  for (const e of entries) {
    if (e?.source !== "publicSpace" || e.item?.kind !== "parking") continue;
    const kandidaten = parkeerverbodVoorWerf(e, sgwIndex);
    if (kandidaten.length !== 1) continue;
    const kaart = werkKaart.get(kandidaten[0]) || sgwKaart.get(kandidaten[0]);
    if (!kaart) continue;
    voeg(kaart.uid).parkeer.push(e);
    weg.add(e.uid);
  }
  const uit = entries.filter((e) => !weg.has(e.uid)).map((e) => {
    if (e?.source === "works") {
      const dossiers = [...new Set((e.rijen?.length ? e.rijen : [e.item]).map(dossierVan).filter(Boolean))];
      return dossiers.length ? werfKaartBewaard(e, { dossiers, ...(bij.get(e.uid) || {}), uitleg, vandaag }) : e;
    }
    const d = e?.source === "publicSpace" && e.item?.kind === "sgw" ? werfDossier(e.item?.reference) : "";
    if (!d) return e;
    return werfzoneMetWerf(e, { dossier: d, gipod: gipod.get(d) || null, parkeer: bij.get(e.uid)?.parkeer || [], vandaag, straat });
  });
  // Een parkeerverbod dat later begint dan zijn werfkaart, staat ook op zijn eerste dag (nakijkronde 13 oktober 2026:
  // het begin van een nieuwe fase viel uit de dagsecties, zoals 17 oktober en 4 januari op de Sint-Andriesplaats).
  // Dezelfde uid als het losse parkeerverbod: de weekzin en de tellers tellen het één keer.
  if (!isoDay(vandaag)) return uit;
  const vervolg = [];
  for (const kaart of uit) {
    for (const p of Array.isArray(kaart?.werfParkeer) ? kaart.werfParkeer : []) {
      const van = p?.start || dayOf(p?.item?.start);
      if (van && van > vandaag && van > (kaart.start || "")) vervolg.push(vervolgParkeerverbod(p, kaart));
    }
  }
  return vervolg.length ? [...uit, ...vervolg] : uit;
}
// De kaart van een parkeerverbod dat later begint dan zijn werfkaart: wat het losse parkeerverbod zei, met de werf
// erbij (welke, en waarom die: dezelfde straat en dagen als een fase van de werfzone).
function vervolgParkeerverbod(p, kaart) {
  const dossier = cleanText(kaart.werf?.dossier);
  const titel = cleanText(kaart.title);
  return {
    ...p,
    title: `Parkeerverbod voor ${kaart.werfNaam || `de werf van dossier ${dossier}`}`,
    summary: metZin(p.summary, `Zelfde straat en dagen als een fase van “${titel}”${dossier ? ` (dossier ${dossier})` : ""}.`),
    regels: [...(Array.isArray(p.regels) ? p.regels : []), ["Werf", `${titel} (A-Sign${dossier ? `, dossier ${dossier}` : ""}): zelfde straat en dezelfde dagen als een fase van de werfzone. A-Sign zet bij een parkeerverbod geen dossiernummer.`]],
    bijWerf: kaart.uid,
  };
}
// Wat de kop van een werfkaart over haar parkeerverboden zegt (nakijkronde 13 oktober 2026: de kop zei alleen "Met
// werfzone en parkeerverboden (A-Sign)", zonder periode of uren, waar de losse kaart "Niet parkeren van 7.00 tot 17.00
// uur" zei). Het parkeerverbod dat nu loopt (het eerst aflopende), anders het eerstvolgende, met zijn uren en zijn
// laatste dag; dan de begindagen van wat later komt. Een parkeerverbod dat voorbij is, telt niet. Leeg zonder.
export function parkeerKopZin(parkeer = [], vandaag = "") {
  const lijst = (Array.isArray(parkeer) ? parkeer : []).map((p) => {
    const r = p?.item || {};
    const van = dayOf(r.start) || isoDay(p?.start);
    const tot = dayOf(r.end) || isoDay(p?.end);
    return { r, van, tot: tot > van ? tot : van, ref: cleanText(r.reference) };
  }).filter((x) => x.van && (!isoDay(vandaag) || x.tot >= vandaag));
  if (!lijst.length) return "";
  const nu = isoDay(vandaag) ? lijst.filter((x) => x.van <= vandaag).sort((a, b) => a.tot.localeCompare(b.tot)) : [];
  const later = lijst.filter((x) => !nu.includes(x)).sort((a, b) => a.van.localeCompare(b.van));
  const eerst = nu[0] || later[0];
  const uren = parkeerUren(eerst.r);
  const urenTekst = uren === "hele dag" ? ", de hele dag" : uren ? ` ${uren}` : "";
  const weekdagen = alleenWeekdagen(eerst.r) ? ", alleen op weekdagen" : "";
  const wanneer = nu[0] ? `t/m ${kortDatum(eerst.tot, vandaag)}` : eerst.tot > eerst.van ? `van ${kortDatum(eerst.van, vandaag)} t/m ${kortDatum(eerst.tot, vandaag)}` : `op ${kortDatum(eerst.van, vandaag)}`;
  const zin = `Niet parkeren${urenTekst}${weekdagen}, ${wanneer} (A-Sign${eerst.ref ? `, ${eerst.ref}` : ""}).`;
  const andereNu = nu.length - (nu[0] ? 1 : 0);
  const volgende = [...new Set(later.filter((x) => x !== eerst).map((x) => x.van))];
  const dagen = [...volgende.slice(0, 3).map((d) => kortDatum(d, vandaag)), ...(volgende.length > 3 ? [`nog ${volgende.length - 3} andere dagen`] : [])];
  const delen = [
    andereNu ? `Nog ${andereNu} ${andereNu === 1 ? "parkeerverbod loopt" : "parkeerverboden lopen"} nu.` : "",
    volgende.length ? `${volgende.length === 1 ? "Volgend parkeerverbod" : "Volgende parkeerverboden"} vanaf ${opsomming(dagen)}.` : "",
  ].filter(Boolean);
  return [zin, ...delen].join(" ");
}
// Een werk met het dossiernummer van een werfzone: "Werf" in plaats van "Werken van Stad Antwerpen", de fasen van
// GIPOD als wat, de werfzone (waar, omleiding, fasen in A-Sign) en de parkeerverboden erin. De uid blijft die van
// het werk (deellink, open kaartje). Zonder fase die iets zegt: één zin dat het doel nergens staat (onbekend).
// collect() loopt bij elke tekenbeurt (een andere periode, een filter, een laag die binnenkomt) en een werfkaart maken
// kost werkFeiten en werkKaartje opnieuw. Voor dezelfde GIPOD-rij (WeakMap), kaart-uitleg.json en dag, en dezelfde
// werfzones en parkeerverboden (de sleutel), is het dezelfde kaart: die wordt hergebruikt. Wat erna komt, maakt nieuwe
// objecten (eenKaartPerDossier, verrijkMetContext, bundelLijst), dus de bewaarde kaart verandert niet.
const WERF_KAARTEN = new WeakMap();
const GEEN_UITLEG_WERF = Object.freeze({});
function werfKaartBewaard(e, opties) {
  const work = e?.item;
  if (!work || typeof work !== "object") return werfKaart(e, opties);
  const u = opties.uitleg && typeof opties.uitleg === "object" ? opties.uitleg : GEEN_UITLEG_WERF;
  let perWerk = WERF_KAARTEN.get(work);
  if (!perWerk) { perWerk = new WeakMap(); WERF_KAARTEN.set(work, perWerk); }
  let kaarten = perWerk.get(u);
  if (!kaarten) { kaarten = new Map(); perWerk.set(u, kaarten); }
  const ids = (lijst) => (lijst || []).map((r) => r?.id ?? r?.gipodId ?? "").join(",");
  const sleutel = JSON.stringify([opties.vandaag, opties.dossiers, [e.uid, e.title, e.summary, e.start, e.end, e.location, e.info, e.reference, e.status, ids(e.rijen)],
    (opties.sgw || []).map((z) => [z.uid, z.title, z.time, z.timeText, z.item?.reference, z.regels, ids(z.rijen)]),
    (opties.parkeer || []).map((p) => [p.uid, p.item?.reference, p.item?.start, p.item?.end, p.item?.startTime, p.item?.endTime, p.item?.weekdaysOnly, p.item?.detail, ids(p.rijen)])]);
  if (!kaarten.has(sleutel)) {
    if (kaarten.size > 20) kaarten.clear();
    kaarten.set(sleutel, werfKaart(e, opties));
  }
  return kaarten.get(sleutel);
}
function werfKaart(e, { dossiers, sgw = [], parkeer = [], uitleg = null, vandaag = "" }) {
  const work = e.item || {};
  const f = herzieneSoort(samenWerk(werkFeiten(work), uitleg?.werken?.[work?.gipodId]));
  // Geen soort uit de tekst: opnieuw uit de fasen (ook de bewaarde van de verversing). Vinden de fasen niets, dan blijft
  // de soort inname van GIPOD ("Wegenwerken" bij "Wegeniswerken", "Verhuislift of levering"), zoals op de losse
  // werkkaart: dat zegt GIPOD, en zonder die soort zei de werfkaart minder dan vroeger (nakijkronde 13 oktober 2026).
  // Vinden de fasen wel een soort, dan noemt "Wat" de soort inname er nog bij.
  const innameSoort = !echteSoort(f) && f?.soort && /^soort inname\b/.test(String(f.soortBron || "")) ? f.soort : "";
  const opnieuw = echteSoort(f) ? null : soortVanWerk({ omschrijving: f.omschrijving, fasen: (f.fasen || []).map((x) => x.naam), eigenaar: f.opdrachtgever });
  const feiten = !opnieuw ? f : opnieuw.soort ? { ...f, soort: opnieuw.soort, soortBron: opnieuw.bron, ...(innameSoort && innameSoort !== opnieuw.soort ? { innameSoort } : {}) }
    : innameSoort ? f : { ...f, soort: "", soortBron: "" };
  const k = werkKaartje(work, { vandaag, feiten, werf: { dossier: dossiers[0] } });
  const doel = werfDoel(feiten) || (innameSoort && feiten.soort === innameSoort ? { kort: kleineLetter(innameSoort), lijst: [innameSoort], bron: f.soortBron } : null);
  // De werfzone zoals haar losse kaart ze beschreef: hoe ze de straat raakt ("De werfzone ligt in je straat; het verkeer
  // wordt omgeleid"), waar, de fasen, de uren, de status in A-Sign en het dossiernummer.
  const relatie = (z) => cleanText(z.summary).split(/(?<=\.)\s+/)[0].replace(/\.$/, "");
  const werfzoneRegel = (z) => ["Werfzone", [relatie(z), ...(z.regels || []).map(([a, b]) => (/ (?:in|via)$/.test(a) ? `${a} ${b}` : `${a}: ${b}`)), z.time ? z.timeText : "",
    z.status ? `status in A-Sign: ${kleineLetter(cleanText(z.status))}` : "", `A-Sign, dossier ${cleanText(z.item?.reference)}`].filter(Boolean).join(" · ")];
  const extra = [...sgw.map(werfzoneRegel), ...(parkeer.length ? [parkeerRegel(parkeer, vandaag)] : [])];
  const titels = new Set(sgw.map((z) => z.title));
  const zone = !sgw.length ? "" : titels.has("Werfzone met omleiding") || (titels.has("Werfzone") && titels.has("Omleiding")) ? "werfzone en omleiding" : titels.has("Omleiding") ? "omleiding" : "werfzone";
  // De parkeerverboden in de kop met hun uren en dagen (parkeerKopZin); alleen als ze allemaal voorbij zijn, het woord.
  const parkeerZin = parkeerKopZin(parkeer, vandaag);
  const met = [zone, parkeer.length && !parkeerZin ? (parkeer.length === 1 ? "parkeerverbod" : "parkeerverboden") : ""].filter(Boolean);
  const samenvatting = [k.samenvatting, met.length ? `Met ${met.join(" en ")} (A-Sign).` : "", parkeerZin].filter(Boolean).join(" ");
  // De straat van het werk, voor de kaart van een parkeerverbod dat later begint (vervolgParkeerverbod).
  const werkStraat = [...(feiten.straten || []), ...(work.streets || []).map((s) => s?.name)].map(cleanText).find((n) => n && !isTunnel(n)) || "";
  // Alle straten van de losse kaarten samen (het werk, de werfzone en de omleiding, de parkeerverboden): de losse kaarten
  // toonden ze ("Toon alle 25 straten"); de werfkaart toont ze ingeklapt (uitlegTemplate in site/place-view.js).
  const alleStraten = sorteerNl([...(feiten.straten || []), ...(e.straten || []), ...sgw.flatMap((z) => z.straten || []), ...parkeer.flatMap((p) => p.straten || (p.item?.streets || []).map((x) => x?.name))]);
  const samengevoegd = (sgw.length || parkeer.length) && alleStraten.length > 1;
  const stratenErbij = samengevoegd && alleStraten.length > 3 ? { straten: alleStraten } : {};
  // Tot drie straten toont de kaart geen ingeklapte lijst: dan staan ze in een eigen regel.
  if (samengevoegd && alleStraten.length <= 3) extra.push(["Straten", `${alleStraten.join(", ")} (het werk, de werfzone en de parkeerverboden samen)`]);
  return {
    ...e, title: k.titel, summary: samenvatting, location: k.plek || e.location, ...stratenErbij,
    uitleg: { ...k, samenvatting, regels: [...k.regels, ...extra], ...(stratenErbij.straten ? { stratenNoot: "De straten van het werk, van de werfzone en de omleiding, en van de parkeerverboden." } : {}) },
    werf: { dossier: dossiers[0], ...(dossiers.length > 1 ? { dossiers } : {}), werfzone: sgw[0]?.uid || "", parkeerverboden: parkeer.map((p) => cleanText(p.item?.reference)).filter(Boolean) },
    // De parkeerverboden zelf: de weekzin telt ze (dezeWeek), en wat later begint, krijgt een eigen kaart op die dag.
    ...(parkeer.length ? { werfParkeer: parkeer } : {}),
    werfNaam: werkStraat ? `de werf ${opStraat(werkStraat)}` : `de werf van dossier ${dossiers[0]}`,
    // Voor de buurtkaart: de vorm van de werfzone en de plaatsen van de parkeerverboden bij het punt van het werk.
    werfRijen: [...sgw.flatMap((z) => z.rijen || [z.item]), ...parkeer.flatMap((p) => p.rijen || [p.item])].filter(Boolean),
    ...(doel ? {} : { onbekend: [{ meter: "werf-zonder-doel", kern: true }] }),
  };
}
// Een werfzone zonder werkkaart op de plek: het waarvoor uit GIPOD (zelfde dossiernummer), en de parkeerverboden.
function werfzoneMetWerf(e, { dossier, gipod = null, parkeer = [], vandaag = "", straat = "" }) {
  const doel = gipod ? werfDoel(gipod.feiten) : null;
  // De straat van het werk in GIPOD (geen tunnel: die ligt onder de straten, zoals elders op de site).
  const waar = gipod ? [...(gipod.feiten?.straten || []), ...(gipod.feiten?.vlakStraten || [])].find((n) => n && !isTunnel(n)) || "" : "";
  const regels = [...(e.regels || [])];
  const doelTekst = !doel ? "" : doel.bron === "fasen" ? `fasen: ${doel.lijst.map((x) => `“${x}”`).join(" · ")}` : `${doel.lijst[0]} (afgeleid uit ${afgeleidUit(doel.bron)})`;
  if (gipod) regels.push(["Werf volgens GIPOD", [doelTekst, waar ? `werk ${opStraat(waar)}` : "", gipod.feiten?.opdrachtgever ? `beheerder in GIPOD: ${gipod.feiten.opdrachtgever}` : "", `GIPOD ${gipod.gipodId}, zelfde dossiernummer`].filter(Boolean).join(" · ")]);
  if (parkeer.length) regels.push(parkeerRegel(parkeer, vandaag));
  // De werf voor de kaart van een parkeerverbod dat later begint (vervolgParkeerverbod): de straat van het werk in GIPOD,
  // anders een straat van de werfzone zelf: de gekozen straat als de werfzone daar ligt, anders de eerste.
  const zoneStraten = (e.rijen?.length ? e.rijen : [e.item]).flatMap((r) => (r?.werfzoneStreets || []).map((s) => cleanText(s?.name))).filter(Boolean);
  const zoneStraat = zoneStraten.find((n) => foldText(n) === foldText(straat)) || zoneStraten[0] || "";
  const werfNaam = waar ? `de werf ${opStraat(waar)}` : zoneStraat ? `de werfzone ${opStraat(zoneStraat)}` : `de werfzone van dossier ${dossier}`;
  const uit = { ...e, regels, werf: { dossier, gipodId: gipod?.gipodId || null, parkeerverboden: parkeer.map((p) => cleanText(p.item?.reference)).filter(Boolean) }, werfNaam };
  if (parkeer.length) uit.rijen = [...(e.rijen || []), ...parkeer.flatMap((p) => p.rijen || [p.item])];
  // De parkeerverboden in de kop, met hun uren en dagen (parkeerKopZin), vóór de zin dat het waarvoor ontbreekt: anders
  // stonden ze alleen in het detail (nakijkronde 13 oktober 2026). De weekzin telt ze (werfParkeer, dezeWeek).
  const parkeerZin = parkeerKopZin(parkeer, vandaag);
  if (parkeer.length) uit.werfParkeer = parkeer;
  if (parkeerZin) {
    const s = cleanText(e.summary);
    const waarom = s.search(/\s*De stad publiceert niet waarvoor deze (?:werfzone|omleiding) dient\./);
    uit.summary = waarom >= 0 ? `${s.slice(0, waarom).trim()} ${parkeerZin} ${s.slice(waarom).trim()}`.trim() : metZin(s, parkeerZin);
  }
  // De straten van de parkeerverboden erbij (hun losse kaart toonde ze).
  if (parkeer.length) {
    const samen = sorteerNl([...(e.straten || []), ...parkeer.flatMap((p) => p.straten || (p.item?.streets || []).map((x) => x?.name))]);
    if (samen.length > (e.straten || []).length) uit.straten = samen;
  }
  if (!doel) return uit;
  // Het waarvoor staat in GIPOD: geen zin meer dat de stad het niet publiceert.
  // Ligt de straat alleen op de omleiding, dan is het voor die straat een omleiding (werfzoneEntry zet dan de locatie
  // "Omleiding via ...").
  const opOmleiding = /^Omleiding via /.test(String(e.location || ""));
  const titel = `${opOmleiding ? "Omleiding" : e.title} voor werken${waar ? ` ${opStraat(waar)}` : ""}`;
  const summary = String(e.summary || "").replace(/\s*De stad publiceert niet waarvoor deze (?:werfzone|omleiding) dient\./, "").trim();
  return { ...uit, title: titel, summary: [summary, waarvoorZin(doel), parkeerZin].filter(Boolean).join(" ").trim(), zonderDoel: false };
}

// ---- bundelen wat leeg blijft (vaagheidsplan van 12 oktober 2026, stap 5) ----
// Wat de bron niet beschrijft, staat niet als losse kaart tussen wat er echt gebeurt, maar per straat in één
// ingeklapte regel (alleen in de lijst; de tijdlijn en de maand tonen elke kaart op haar dag):
// - terrassen: één regel per straat ("28 terrassen en 1 uitstalling met vergunning"), uitklapbaar met de adressen;
// - innames zonder omschrijving (een evenementendossier zonder soort of naam, geen parcours of verkeersvrije zone);
// - werfzones en omleidingen zonder doel (ook niet in GIPOD);
// - omgevingsaanvragen zonder omschrijving of van twee jaar of ouder zonder beslissing (niet tijdens een openbaar
//   onderzoek: dat staat altijd bovenaan);
// - vermoedelijke studentenactiviteiten: één regel per dag (in de sectie van die dag).
// Een bundel vanaf BUNDEL_MIN kaarten: één enkele lege kaart blijft een gewone kaart (en telt als losse vage kaart),
// behalve een vermoedelijke studentenactiviteit (altijd de regel van die dag).
// Wat in een bundel staat, zegt de reden één keer (onbekendZin), niet op elke kaart. Geeft { losse, bundels };
// een bundel is een kaart met `bundel: { soort, leden, noot }` en telt als één kaart (lijstSleutel, kaartSoort).
export const BUNDEL_SOORTEN = Object.freeze(["terrassen", "innames", "werfzones", "aanvragen", "studenten"]);
// Vanaf hoeveel kaarten een bundel: vermoedelijke studentenactiviteiten altijd één regel per dag (ook één); de andere
// soorten vanaf twee (één lege kaart blijft een gewone kaart).
export const BUNDEL_MIN = Object.freeze({ studenten: 1, terrassen: 2, innames: 2, werfzones: 2, aanvragen: 2 });
const STUDENT = /\b(?:student\w*|doop\w*|dopen|dril\w*|welkomst\w*|kroegentocht\w*|ontgroening\w*)\b/i;
const aanvraagOud = (item, vandaag) => {
  const jaar = Number(dossierJaar(item?.project));
  return Boolean(jaar && vandaag && jaar <= Number(String(vandaag).slice(0, 4)) - 2 && omgevingsStatus(item).type === "aanvraag");
};
const aanvraagLeeg = (item) => Boolean(item?.inhoud?.leeg) || (!item?.inhoud && !cleanText(item?.purpose));
export function bundelSoort(e = {}, { vandaag = "" } = {}) {
  if (e.bundel) return "";
  if (e.source === "terraces") return "terrassen";
  if (e.source === "permits") return !e.item?.inzage && (aanvraagLeeg(e.item) || aanvraagOud(e.item, vandaag)) ? "aanvragen" : "";
  // Een werfzone met een parkeerverbod (samenWerven) blijft een gewone kaart, ook zonder doel: anders stond het
  // parkeerverbod ingeklapt onderaan in plaats van bij "Loopt nu" (nakijkronde 13 oktober 2026, de Thonetlaan).
  if (e.source === "publicSpace" && e.item?.kind === "sgw") return e.zonderDoel === true && !e.werf?.parkeerverboden?.length && !e.werfParkeer?.length ? "werfzones" : "";
  const dossierKaart = e.source === "publicSpace" && String(e.uid || "").startsWith("publicSpace:dossier:");
  // Een dossier dat alleen een parkeerverbod is, blijft los: een parkeerverbod staat nooit ingeklapt (nakijkronde 13
  // oktober 2026). Alleen een inname zonder omschrijving gaat in de bundel.
  if (dossierKaart && e.uitleg?.watBron === "leeg" && e.uitleg?.innameSoort === "Inname") return "innames";
  // Een vermoeden over een studentenactiviteit: de kaart van het dossier, of een agendapunt uit de dossiers.
  const vermoeden = dossierKaart ? ["vermoeden", "woord", "koppeling"].includes(e.uitleg?.watBron) && STUDENT.test(`${e.title} ${e.uitleg?.soortTekst || ""}`)
    : e.source === "agenda" && alleenUitDossiers(e.item) && /^Vermoedelijk\b/.test(cleanText(e.title)) && STUDENT.test(cleanText(e.title));
  return vermoeden && e.start ? "studenten" : "";
}
const nl = (n, een, veel) => `${n} ${n === 1 ? een : veel}`;
// De plek van een kaart zoals haar uitleg ze in de regel "Waar" zegt, zonder punt; anders haar plaats.
const plekVanLid = (e) => cleanText((e?.uitleg?.kern || []).find(([k]) => k === "Waar")?.[1] || "").replace(/\.$/, "") || cleanText(e?.location);
// De straat van een kaart zonder gekozen straat (een wijk of postcode): de eerste straat van de bron, anders de plaats
// zonder huisnummer of postcode ("Proefstraat 12, 2000 Antwerpen" wordt "Proefstraat").
const straatVanKaart = (e) => cleanText(e.item?.streets?.[0]?.name) || cleanText(e.location).replace(/,.*$/, "").replace(/\s+\d+\s*[a-z]?(?:\s*[-–]\s*\d+\s*[a-z]?)?$/i, "").trim();
// Huisnummers als getal sorteren (nummer 9 voor nummer 10), zonder adres achteraan.
const adresSleutel = (e) => { const m = cleanText(e.location).match(/^(.*?)(\d+)(.*)$/); return m ? [m[1], Number(m[2]), m[3]] : [cleanText(e.location), Infinity, ""]; };
const opAdres = (a, b) => { const [x, y] = [adresSleutel(a), adresSleutel(b)]; return x[0].localeCompare(y[0], "nl") || x[1] - y[1] || x[2].localeCompare(y[2], "nl"); };
function bundelKaart(soort, sleutel, leden, { straat = "", vandaag = "" } = {}) {
  const dagen = leden.map((e) => e.start).filter(Boolean).sort();
  const eind = leden.map((e) => e.end || e.start).filter(Boolean).sort().at(-1) || "";
  const waar = straat || cleanText(leden[0]?.location);
  const basis = { uid: `bundel:${soort}:${sleutel}`, id: `bundel:${soort}:${sleutel}`, source: "bundel", openEnd: false, time: "", timeText: "", location: waar, status: "", info: "", reference: "", url: "", sourceUrl: "", item: {} };
  if (soort === "terrassen") {
    const uit = leden.filter((e) => /uitstalling/i.test(e.title)).length, ter = leden.length - uit;
    const titel = [ter ? nl(ter, "terras", "terrassen") : "", uit ? nl(uit, "uitstalling", "uitstallingen") : ""].filter(Boolean).join(" en ");
    return { ...basis, theme: "permits", group: "vergunningen", title: `${titel} met vergunning`, start: "", end: "",
      summary: `Op het openbaar domein, met een vergunning van de stad (A-Sign). ${onbekendZin("terras-periode")}`,
      bundel: { soort, leden: [...leden].sort(opAdres), noot: onbekendZin("terras-periode") } };
  }
  if (soort === "aanvragen") {
    const leeg = leden.filter((e) => aanvraagLeeg(e.item)).length, oud = leden.length - leeg;
    const titel = leeg && oud ? `${nl(leden.length, "omgevingsaanvraag", "omgevingsaanvragen")} zonder omschrijving of van twee jaar of ouder`
      : leeg ? `${nl(leeg, "omgevingsaanvraag", "omgevingsaanvragen")} zonder omschrijving` : `${nl(oud, "omgevingsaanvraag", "omgevingsaanvragen")} van twee jaar of ouder zonder beslissing`;
    const noot = [leeg ? onbekendZin("aanvragen-omschrijving") : "", oud ? onbekendZin("aanvragen-oud") : ""].filter(Boolean).join(" ");
    return { ...basis, theme: "permits", group: "vergunningen", title: titel, start: "", end: "", summary: noot, bundel: { soort, leden, noot } };
  }
  if (soort === "studenten") {
    // De plek zoals de kaart van elk lid ze zegt (de regel "Waar" van de uitleg): de kop van de bundel noemde de wijken
    // van de straten rond de plekken ("50 straten in Historisch centrum en Eilandje"), de kaart erin de wijken van de
    // plekken zelf (nakijkronde 13 oktober 2026). Zonder uitleg de plaats van de kaart.
    const plekken = [...new Set(leden.map(plekVanLid).filter(Boolean))];
    const noot = onbekendZin("studenten-naam");
    // De leden hebben dezelfde dagen (studentenPeriode): de bundel loopt zoals elk lid, tot zijn laatste dag, met
    // dezelfde losse dagen en de opbouw en afbraak van de leden (groupForList, evenementFase). Zonder einde viel een
    // meerdaags lid na zijn eerste dag uit de lijst, de tellers en de buurtkaart (nakijkronde 12 oktober 2026).
    const lid = leden[0] || {};
    const metInname = leden.filter((e) => e.innameStart);
    const inname = metInname.length ? {
      innameStart: metInname.map((e) => e.innameStart).sort()[0],
      innameEind: metInname.map((e) => e.innameEind || e.end || e.start).filter(Boolean).sort().at(-1) || "",
    } : {};
    return { ...basis, theme: "publicSpace", group: "evenementen", title: `${nl(leden.length, "vermoedelijke studentenactiviteit", "vermoedelijke studentenactiviteiten")}`,
      start: lid.start || dagen[0] || "", end: lid.end && lid.end > lid.start ? lid.end : "", ...(lid.losseDagen?.length ? { losseDagen: [...lid.losseDagen] } : {}), ...inname,
      location: plekken.length <= 3 ? plekken.join(" · ") : `${plekken.slice(0, 2).join(" · ")} en ${plekken.length - 2} andere plekken`,
      summary: `Vermoedelijk, afgeleid uit het dossier, de plek en de periode; niet bevestigd. ${noot}`, bundel: { soort, leden, noot },
      onbekend: [onbekendVeld("studenten-naam")] };
  }
  const werf = soort === "werfzones";
  const noot = onbekendZin(werf ? "werfzones-waarvoor" : "innames-wat");
  const titel = werf ? `${nl(leden.length, "werfzone of omleiding", "werfzones of omleidingen")} zonder doel in de bron` : `${nl(leden.length, "inname", "innames")} zonder omschrijving`;
  // Met het jaartal als een periode niet in dit jaar valt ("3 mei – 30 apr 2027", niet "3 mei – 30 apr").
  const periodes = leden.map((e) => kortePeriode(e.start, e.end, vandaag)).filter(Boolean);
  return { ...basis, theme: "publicSpace", group: werf ? "werken" : "evenementen", title: titel, start: "", end: "",
    summary: `${periodes.length ? `${periodes.slice(0, 4).join(" · ")}${periodes.length > 4 ? ` en nog ${periodes.length - 4}` : ""}. ` : ""}${noot}`,
    bundel: { soort, leden: [...leden].sort((a, b) => String(a.start).localeCompare(String(b.start))), noot, van: dagen[0] || "", tot: eind } };
}
// Vermoedelijke studentenactiviteiten: één bundel per dag, en een meerdaagse activiteit (of een met losse dagen) bij
// de activiteiten met precies dezelfde dagen. Zo loopt de bundel zoals haar leden (bundelKaart).
const studentenPeriode = (e) => [e.start, e.end && e.end > e.start ? `tot ${e.end}` : "", e.losseDagen?.length ? `dagen ${e.losseDagen.join(" ")}` : ""].filter(Boolean).join(" ");
export function bundelLijst(entries = [], { straat = "", vandaag = "" } = {}) {
  const losse = [], groepen = new Map();
  for (const e of entries) {
    const soort = bundelSoort(e, { vandaag });
    if (!soort) { losse.push(e); continue; }
    // Per straat (de gekozen straat; in een wijk of postcode de eerste straat van de kaart), studenten per dag.
    // Per straat: de gekozen straat als de kaart die raakt, anders de eigen straat van de kaart (met een straal ligt
    // een aanvraag of een terras ook in een andere straat).
    const raakt = Boolean(cleanText(straat)) && (e.item?.streets || []).some((s) => foldText(s?.name) === foldText(straat));
    const per = soort === "studenten" ? studentenPeriode(e) : (raakt ? cleanText(straat) : straatVanKaart(e)) || cleanText(straat) || "plek";
    const sleutel = `${soort}|${per}`;
    if (!groepen.has(sleutel)) groepen.set(sleutel, { soort, per, leden: [] });
    groepen.get(sleutel).leden.push(e);
  }
  // Een bundel vanaf twee kaarten van dezelfde soort (per straat, of per dag): één lege kaart blijft een gewone kaart.
  for (const [sleutel, g] of groepen) if (g.leden.length < (BUNDEL_MIN[g.soort] || 2)) { losse.push(...g.leden); groepen.delete(sleutel); }
  const bundels = [...groepen.values()].map(({ soort, per, leden }) => bundelKaart(soort, foldText(per).replace(/\s+/g, "-") || "plek", leden, { straat: soort === "studenten" ? "" : per, vandaag }));
  // Een bundel kent zijn leden, en elk lid zijn bundel (telSleutel): de kaart en de tellers tellen de bundel één keer.
  return { losse, bundels: bundels.map((b) => ({ ...b, bundel: { ...b.bundel, leden: b.bundel.leden.map((l) => ({ ...l, telSleutel: b.uid, inBundel: b.uid })) } })) };
}

// ---- verrijken met wat al binnen is (vaagheidsplan van 12 oktober 2026, stap 7) ----
// Twee stappen op de kaarten van de plek, na samenWerven en eenKaartPerDossier, vóór bundelLijst:
// 1. Een parkeerverbod voor een evenement: A-Sign zet er geen dossiernummer bij. Eén beslissing per parkeerverbod
//    (A-Sign-nummer, dagen en al zijn straten), dezelfde op elke pagina (evenementVanParkeerverboden): staat er in zijn
//    straten op zijn dagen precies één agendapunt of evenementendossier, en is dat een evenement (geen markt) dat elke
//    dag van het parkeerverbod zelf plaatsvindt en korter is dan LANG_EVENEMENT dagen, dan hoort het daarbij: de kaart
//    zegt welk, met de bron, en krijgt de naam in de titel als dat evenement er een heeft ("Parkeerverbod voor ..."; bij
//    een vermoede naam "Parkeerverbod, vermoedelijk voor ..."), of de titel van het dossier als dat zelf zegt wat het
//    is ("Parkeerverbod voor buurtfeest op het ..."). De evenementkaart krijgt het parkeerverbod onder "Wat merk je".
//    Een tweede item, of een markt (nakijkronde 12 oktober 2026: de wekelijkse markt op het Sint-Jansplein viel op elke
//    dag van de parkeerverboden die de foor een naam gaven), of geen: zo laten, nooit gokken; "ook gepland hier" zegt
//    wat er die dag staat.
// 2. Ook gepland hier die dag: bij een kaart zonder naam (een evenementendossier, een parkeerverbod voor een evenement)
//    wat er die dag nog in dezelfde straat gepland staat, met de bron. Dat is context, geen verklaring: de kaart zegt
//    het er ook bij. Alleen met een gekozen straat, niet bij een kaart van meer dan CONTEXT_DAGEN dagen, en nooit een
//    toelating van LANG_EVENEMENT dagen of langer als context (een jaardossier is niet "gepland hier die dag").
// Wat de stad niet publiceert, blijft leeg. UiT (stad-uit) nemen we niet over, ook niet als context.
const LANG_EVENEMENT = 60;
const CONTEXT_DAGEN = 14;
const CONTEXT_MAX = 3;
const NAAM_ZEKER_IN_INFO = /\bNaam (?:met de hand nagekeken|automatisch herkend|uit een goedgekeurd besluit)\b/;
const NAAM_VERMOED_IN_INFO = /\bNaam vermoed via\b/;
const NIET_ALS_CONTEXT = new Set(["stad-uit"]);
const BRON_KORT = Object.freeze({
  "district-asign-evenementen": "A-Sign", "district-ebesluit-evenementen": "eBesluit", "district-ebesluit": "eBesluit", "district-kalender": "districtskalender",
  "district-nieuws": "districtsnieuws", "district-foren": "district Antwerpen", "district-projecten": "district Antwerpen", "stad-markten": "GIPOD",
  "stad-districten": "nieuws van de districten", "mail-district": "nieuwsbrief van het district", "mail-stad": "nieuwsbrief van de stad", "stad-koopzondagen": "stad Antwerpen",
});
const isDossierKaart = (e) => String(e?.uid || "").startsWith("publicSpace:dossier:");
const isEvenementParkeerverbod = (e) => e?.source === "publicSpace" && e.item?.kind === "parking" && /evenement/i.test(parkeerReden(e.item));
const dagNr = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || "")) ? Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000 : NaN);
// De dagen van een kaart: de losse dagen (een maandag per maand), anders van begin tot einde.
function dagenVanKaart(e) {
  const van = dayOf(e?.start), tot = dayOf(e?.end) > van ? dayOf(e.end) : van;
  if (!van) return null;
  const losse = Array.isArray(e?.losseDagen) && e.losseDagen.length ? new Set(e.losseDagen) : null;
  return { van, tot, losse, lengte: losse ? losse.size : dagNr(tot) - dagNr(van) + 1 };
}
const bevatDag = (d, dag) => Boolean(d) && (d.losse ? d.losse.has(dag) : dag >= d.van && dag <= d.tot);
function alleDagenVan(d, max = CONTEXT_DAGEN) {
  if (!d) return [];
  if (d.losse) return [...d.losse].sort().slice(0, max);
  const uit = [];
  for (let n = dagNr(d.van); n <= dagNr(d.tot) && uit.length < max; n++) uit.push(new Date(n * 86_400_000).toISOString().slice(0, 10));
  return uit;
}
// Raakt de kaart deze straat? De straten van de bron (een dossier, een agendapunt met zijn volledige stratenlijst),
// anders de plaats of de titel van een agendapunt die de straat letterlijk noemt.
// Per kaart één keer berekend (een parcours heeft tot honderd straten, en collect() loopt bij elke tekenbeurt).
const STRATEN_VAN_KAART = new WeakMap();
function stratenSleutels(e) {
  if (!e || typeof e !== "object") return { namen: new Set(), tekst: "" };
  let s = STRATEN_VAN_KAART.get(e);
  if (!s) {
    const namen = [...(Array.isArray(e.straten) ? e.straten : []), ...(e.item?.streets || []).map((x) => x?.name), ...(e.source === "agenda" ? stratenVanAgendapunt(e.item) : [])];
    s = { namen: new Set(namen.map(foldText).filter(Boolean)), tekst: e.source === "agenda" ? ` ${foldText(`${e.location || ""} ${e.title || ""}`)} ` : "" };
    STRATEN_VAN_KAART.set(e, s);
  }
  return s;
}
function raaktStraat(e, naam) {
  const n = foldText(naam);
  if (!n) return false;
  const s = stratenSleutels(e);
  return s.namen.has(n) || (Boolean(s.tekst) && s.tekst.includes(` ${n} `));
}
// De naam van een evenement, als het er een heeft: { naam, zeker }. Een evenementendossier: de naam uit een fiche
// (zeker) of uit een agendapunt op dezelfde dag en straat (vermoedelijk). Een agendapunt uit de dossiers alleen als
// de tekst zegt waar de naam vandaan komt; een agendapunt uit een andere bron: zijn titel.
function naamVanEvenement(e) {
  if (isDossierKaart(e)) {
    if (e.uitleg?.watBron === "naam") return { naam: cleanText(e.title), zeker: true };
    if (e.uitleg?.watBron === "koppeling") return { naam: cleanText(e.title).replace(/^Vermoedelijk:\s*/, ""), zeker: false };
    return null;
  }
  if (e?.source !== "agenda" || NIET_ALS_CONTEXT.has(e.item?.sourceId)) return null;
  if (alleenUitDossiers(e.item)) {
    const info = cleanText(e.item?.info);
    if (NAAM_ZEKER_IN_INFO.test(info)) return { naam: cleanText(e.title), zeker: true };
    if (NAAM_VERMOED_IN_INFO.test(info)) return { naam: cleanText(e.title).replace(/^Vermoedelijk:?\s*/i, ""), zeker: false };
    return null;
  }
  return { naam: cleanText(e.title), zeker: true };
}
function bronVanKaart(e) {
  if (isDossierKaart(e)) return `A-Sign, dossier ${e.id}`;
  if (e?.source === "agenda") {
    const dossier = dossierVanAgendapunt(e.item);
    const bron = BRON_KORT[e.item?.sourceId] || "agenda";
    return dossier ? `${bron}, dossier ${dossier}` : bron;
  }
  if (e?.source === "publicSpace") return `A-Sign${e.item?.reference ? `, ${cleanText(e.item.reference)}` : ""}`;
  return "";
}
const dossierSleutel = (e) => (isDossierKaart(e) ? e.id : e?.source === "agenda" ? dossierVanAgendapunt(e.item) || e.uid : e?.uid);
const isEvenement = (e) => (isDossierKaart(e) && !e.uitleg?.geenEvenement) || (e?.source === "agenda" && e.group === "evenementen" && !NIET_ALS_CONTEXT.has(e.item?.sourceId));
// Context: een evenement of een inname uit A-Sign, of een agendapunt (geen UiT); geen werken, terrassen of aanvragen.
const isContext = (e) => isDossierKaart(e) || (e?.source === "agenda" && !NIET_ALS_CONTEXT.has(e.item?.sourceId) && e.group !== "werken");
// "Markt op het Proefplein" wordt "markt op het Proefplein"; een afkorting of een naam in hoofdletters blijft.
const kleineLetter = (t) => (/^[A-ZÀ-Ý][a-zà-ÿ]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);
const metZin = (tekst, zin) => `${cleanText(tekst).replace(/[.\s]*$/, ".")} ${zin}`.trim();

// Stap 1: het evenement van een parkeerverbod voor een evenement, één beslissing per parkeerverbod.
// Kandidaten uit de hele stad, niet alleen van de plek (nakijkronde 12 oktober 2026: het parkeerverbod 2026-049518 in
// 7 straten heette op vier straatpagina's "Parkeerverbod voor TREK Antwerp Marathon" en op die van de Kloosterstraat,
// waar die dag ook een verkeersvrije zone in de Van Craesbeeckstraat begint, niet):
// - elk agendapunt (`agendaItems`: de hele agenda, los van filter en plek; ook een markt of een vergadering, en een
//   agendapunt van UiT, dat wel meetelt maar nooit genoemd of getoond wordt);
// - elk evenementendossier van de verversing (`uitleg`: kaart-uitleg.json, met zijn straten en de innameperiode);
// - de kaarten van de plek zelf (een dossier dat pas live binnenkwam): die kunnen alleen een naam tegenhouden.
// Een kandidaat telt als hij een straat van het parkeerverbod raakt (alle straten van het A-Sign-nummer: `straten`
// en de rijen, ook die buiten de plek) op een dag van het parkeerverbod (ook opbouw en afbraak), en korter loopt dan
// LANG_EVENEMENT dagen. Werken tellen niet mee (die hebben hun eigen parkeerverboden, samenWerven).
const LOKAAL_MAX = 10;
const GEEN_AGENDA = Object.freeze([]);
const GEEN_UITLEG = Object.freeze({});
const STADS_KANDIDATEN = new WeakMap();
// Een markt: een marktdag van de stad (GIPOD), of een evenementendossier dat (vermoedelijk) een markt is ("Vermoedelijk
// een markt op het De Coninckplein", "Kerstmarkt ..."). Bij een markt geen naam: alleen "ook gepland hier".
const MARKT_IN_TITEL = /^(?:vermoedelijk:?\s+)?(?:een\s+)?\p{L}*markt\b/iu;
const isMarktKaart = (e) => e?.theme === "markets" || e?.item?.sourceId === "stad-markten" || (Boolean(dossierVanAgendapunt(e?.item)) && MARKT_IN_TITEL.test(cleanText(e?.title)));
// Telt een kaart als kandidaat voor een parkeerverbod: een evenementendossier of een agendapunt dat geen werk is.
const telAlsKandidaat = (e) => isDossierKaart(e) || (e?.source === "agenda" && e.group !== "werken");
function stadsKandidaten(agendaItems, uitleg) {
  const a = Array.isArray(agendaItems) ? agendaItems : GEEN_AGENDA;
  const u = uitleg && typeof uitleg === "object" ? uitleg : GEEN_UITLEG;
  let perUitleg = STADS_KANDIDATEN.get(a);
  if (!perUitleg) { perUitleg = new WeakMap(); STADS_KANDIDATEN.set(a, perUitleg); }
  let idx = perUitleg.get(u);
  if (idx) return idx;
  const perSleutel = new Map(), alias = new Map();
  const kandidaat = (sleutel) => {
    if (!perSleutel.has(sleutel)) perSleutel.set(sleutel, { sleutel, dagen: new Set(), inname: new Set(), kaarten: [], straten: new Set(), buren: new Set(), lang: false });
    return perSleutel.get(sleutel);
  };
  for (const item of a) {
    const e = agendaEntry(item, item?.category || "other");
    if (!telAlsKandidaat(e)) continue;
    const d = dagenVanKaart(e);
    if (!d) continue;
    // Een samengevoegd agendapunt is één kandidaat voor al zijn dossiers (dossiersVanAgendapunt).
    const dossiers = dossiersVanAgendapunt(item);
    const sleutel = dossiers.map((x) => alias.get(x)).find(Boolean) || dossiers[0] || e.uid;
    for (const x of dossiers) if (!alias.has(x)) alias.set(x, sleutel);
    const k = kandidaat(sleutel);
    if (d.lengte >= LANG_EVENEMENT) { k.lang = true; continue; }
    for (const dag of alleDagenVan(d, LANG_EVENEMENT)) { k.dagen.add(dag); k.inname.add(dag); }
    k.kaarten.push(e);
    // De straten uit de feed, ook van een ouder bronbestand zonder `stratenVolledig`: alleen om een markt in de buurt van
    // het evenement te zien (een naam tegenhouden), nooit om er een te geven.
    if (dossiers.length && Array.isArray(item?.straten)) for (const s of item.straten) if (foldText(s)) k.buren.add(foldText(s));
  }
  for (const [dossier, b] of Object.entries(u.evenementen || {})) {
    if (!/^ET\d{10}$/.test(dossier)) continue;
    const d = dagenVanKaart({ start: b?.start, end: b?.eind });
    if (!d) continue;
    const k = kandidaat(alias.get(dossier) || dossier);
    if (d.lengte >= LANG_EVENEMENT) { k.lang = true; continue; }
    for (const dag of alleDagenVan(d, LANG_EVENEMENT)) k.inname.add(dag);
    for (const s of Array.isArray(b?.straten) ? b.straten : []) if (foldText(s)) k.straten.add(foldText(s));
    if (/markt/i.test(cleanText(b?.soort))) k.marktDossier = true;
  }
  const perDag = new Map();
  for (const k of perSleutel.values()) {
    if (k.lang) continue;
    k.markt = Boolean(k.marktDossier) || k.kaarten.some(isMarktKaart);
    for (const dag of k.inname) { if (!perDag.has(dag)) perDag.set(dag, []); perDag.get(dag).push(k); }
  }
  idx = { perDag, alias, beslist: new Map() };
  perUitleg.set(u, idx);
  return idx;
}
const raaktKandidaat = (k, straten) => straten.some((s) => k.straten.has(foldText(s)) || k.kaarten.some((e) => raaktStraat(e, s)));
// De straten van een kandidaat (gevouwen): van het dossier en van zijn agendapunten.
const stratenVanKandidaat = (k) => [...new Set([...k.straten, ...(k.buren || []), ...k.kaarten.flatMap((e) => [...stratenSleutels(e).namen])])];
// Alle straten van een parkeerverbod: de straten van zijn A-Sign-nummer (ook buiten de plek), anders die van de rijen.
const stratenVanParkeerverbod = (p) => sorteerNl([...(Array.isArray(p?.straten) ? p.straten : []), ...(p?.rijen || [p?.item]).flatMap((r) => (r?.streets || []).map((s) => s?.name))]);
// Welke dagen een kaart van de plek bezet (met opbouw en afbraak): om een naam tegen te houden.
function bezetteDagen(e) {
  const p = periodeVan(e);
  const d = e?.losseDagen?.length ? dagenVanKaart(e) : dagenVanKaart({ start: p.start, end: p.end });
  return d && d.lengte < LANG_EVENEMENT ? d : null;
}
// De beslissing voor één parkeerverbod: { kandidaat, ev } of null. Het stadsdeel (zonder de kaarten van de plek) één
// keer per parkeerverbod (idx.beslist), want collect() loopt bij elke tekenbeurt.
function beslisParkeerverbod(p, idx, plek) {
  const pd = dagenVanKaart(p);
  const straten = stratenVanParkeerverbod(p);
  if (!pd || !straten.length) return null;
  const pdagen = alleDagenVan(pd, 400);
  const sleutel = `${cleanText(p.item?.reference)}|${pdagen.join(",")}|${straten.join(",")}`;
  let stad = idx.beslist.get(sleutel);
  if (!stad) {
    stad = new Map();
    for (const dag of pdagen) for (const k of idx.perDag.get(dag) || []) if (!stad.has(k.sleutel) && raaktKandidaat(k, straten)) stad.set(k.sleutel, k);
    idx.beslist.set(sleutel, stad);
  }
  const gevonden = new Map(stad);
  for (const dag of pdagen) {
    for (const e of plek.get(dag) || []) {
      const s = idx.alias.get(dossierSleutel(e)) || dossierSleutel(e);
      if (!gevonden.has(s) && straten.some((n) => raaktStraat(e, n))) gevonden.set(s, { sleutel: s, kaarten: [], plek: true });
    }
  }
  if (gevonden.size !== 1) return null;
  const k = [...gevonden.values()][0];
  if (k.plek || k.markt) return null;
  // Een evenement uit de agenda (geen markt) dat elke dag van het parkeerverbod zelf plaatsvindt.
  const ev = k.kaarten.find((e) => isEvenement(e));
  if (!ev || !pdagen.every((d) => k.dagen.has(d))) return null;
  // Een markt die dag in een straat van dat evenement (de wekelijkse markt op het Sint-Jansplein naast de foor in de
  // De Pretstraat): dan volgen de parkeerverboden misschien de markt. Geen naam, alleen "ook gepland hier". Alleen bij
  // een evenement op een plein en zijn zijstraten (hoogstens LOKAAL_MAX straten): langs een parcours van 172 straten
  // (de marathon) zegt een rommelmarkt aan het andere eind niets over een parkeerverbod hier.
  const eigen = stratenVanKandidaat(k);
  if (eigen.length <= LOKAAL_MAX && pdagen.some((dag) => (idx.perDag.get(dag) || []).some((m) => m.markt && m !== k && raaktKandidaat(m, eigen)))) return null;
  return { kandidaat: k, ev, straten, pd };
}
function evenementVanParkeerverboden(entries, { vandaag = "", agendaItems = [], uitleg = null } = {}) {
  const uit = [...entries];
  if (!uit.some(isEvenementParkeerverbod)) return uit;
  const idx = stadsKandidaten(agendaItems, uitleg);
  // De kaarten van de plek per dag die ze bezetten, één keer.
  const plek = new Map();
  for (const e of uit) {
    if (!telAlsKandidaat(e)) continue;
    const d = bezetteDagen(e);
    for (const dag of alleDagenVan(d, LANG_EVENEMENT)) { if (!plek.has(dag)) plek.set(dag, []); plek.get(dag).push(e); }
  }
  const perEvenement = new Map();
  for (let i = 0; i < uit.length; i++) {
    const p = uit[i];
    if (!isEvenementParkeerverbod(p)) continue;
    const b = beslisParkeerverbod(p, idx, plek);
    if (!b) continue;
    const { kandidaat, ev, straten, pd } = b;
    const naam = naamVanEvenement(ev);
    // Een dossier zonder naam waarvan de titel zegt wat het is (de soort uit het dossier, niet "Vermoedelijk" en niet
    // "Evenement in ..."): die titel.
    const soortTitel = !naam && dossierVanAgendapunt(ev.item) && !/^(?:Vermoedelijk|Evenement)\b/.test(cleanText(ev.title)) ? cleanText(ev.title) : "";
    // Altijd "vermoedelijk": A-Sign legt geen verband tussen een parkeerverbod en een evenement; het is het enige
    // evenement in die straten op die dagen, en dat is een afleiding, geen feit (nakijkronde 13 oktober 2026). De regel
    // "Evenement" zegt waarop het steunt.
    const titel = naam ? `Parkeerverbod, vermoedelijk voor ${naam.naam}` : soortTitel ? `Parkeerverbod, vermoedelijk voor ${kleineLetter(soortTitel)}` : "";
    const meer = straten.length > 1, dagen = pd.tot > pd.van;
    const regel = ["Evenement", `${naam ? naam.naam : cleanText(ev.title)} (${bronVanKaart(ev)}): het enige evenement in ${meer ? "deze straten" : "deze straat"} op ${dagen ? "die dagen" : "die dag"}. A-Sign zet bij een parkeerverbod geen dossiernummer.`];
    // De kaart van het evenement op deze plek (een dossier, of het agendapunt zelf).
    const kaart = uit.find((e) => isDossierKaart(e) && (idx.alias.get(e.id) || e.id) === kandidaat.sleutel);
    uit[i] = {
      ...p,
      ...(titel ? { title: titel } : {}),
      regels: [...(Array.isArray(p.regels) ? p.regels : []), regel],
      evenementUid: kaart?.uid || ev.uid,
      evenementSleutel: kandidaat.sleutel,
    };
    if (kaart) {
      const wanneer = kortePeriode(pd.van, dagen ? pd.tot : "", vandaag);
      const waar = straten.length > 3 ? `${straten.slice(0, 3).join(", ")} en ${straten.length - 3} andere straten` : straten.join(", ");
      if (!perEvenement.has(kaart.uid)) perEvenement.set(kaart.uid, []);
      perEvenement.get(kaart.uid).push(`${waar} ${wanneer}${p.item?.reference ? ` (${cleanText(p.item.reference)})` : ""}`);
    }
  }
  // De evenementkaart: het parkeerverbod onder "Wat merk je".
  return uit.map((e) => {
    const lijst = perEvenement.get(e.uid);
    if (!lijst || !e.uitleg?.kern) return e;
    const zin = `Ook een parkeerverbod in de laag parkeerverboden van A-Sign: ${lijst.join(" · ")}. Zelfde straat en dagen, en dit is daar het enige evenement.`;
    const kern = e.uitleg.kern.some(([k]) => k === "Wat merk je") ? e.uitleg.kern.map(([k, v]) => (k === "Wat merk je" ? [k, metZin(v, zin)] : [k, v])) : [...e.uitleg.kern, ["Wat merk je", zin]];
    return { ...e, uitleg: { ...e.uitleg, kern } };
  });
}

// Stap 2: ook gepland hier die dag.
function ookGeplandHier(entries, { straat = "", vandaag = "" } = {}) {
  if (!cleanText(straat)) return entries;
  return entries.map((e) => {
    const zonderNaam = (isDossierKaart(e) && !naamVanEvenement(e)) || (isEvenementParkeerverbod(e) && cleanText(e.title) === "Parkeerverbod voor een evenement");
    if (!zonderNaam || !raaktStraat(e, straat)) return e;
    const d = dagenVanKaart(e);
    if (!d || d.lengte > CONTEXT_DAGEN) return e;
    const dagen = alleDagenVan(d);
    const eigen = new Set([dossierSleutel(e), e.evenementUid, e.evenementSleutel].filter(Boolean));
    const gezien = new Set();
    const andere = [];
    for (const o of entries) {
      if (o === e || !isContext(o) || eigen.has(dossierSleutel(o)) || eigen.has(o.uid) || !raaktStraat(o, straat)) continue;
      const od = dagenVanKaart(o);
      // Een toelating van LANG_EVENEMENT dagen of langer is niet "gepland hier die dag": een jaardossier met een plekje van
      // 2,4 m² zonder omschrijving stond als context bij elke dagkaart op de Groenplaats (nakijkronde 13 oktober 2026).
      // Een foor of een markt van een paar weken op dat plein zegt wel iets, en blijft.
      if (!od || od.lengte >= LANG_EVENEMENT || !dagen.some((dag) => bevatDag(od, dag))) continue;
      const k = dossierSleutel(o);
      if (gezien.has(k)) continue;
      gezien.add(k);
      andere.push({ o, lengte: od.lengte });
    }
    if (!andere.length) return e;
    andere.sort((a, b) => a.lengte - b.lengte || cleanText(a.o.title).localeCompare(cleanText(b.o.title), "nl"));
    const delen = andere.slice(0, CONTEXT_MAX).map(({ o }) => `${cleanText(o.title)} (${kortePeriode(o.start, o.end, vandaag)}; ${bronVanKaart(o)})`);
    const meer = andere.length > CONTEXT_MAX ? ` en nog ${andere.length - CONTEXT_MAX}` : "";
    const regel = [dagen.length > 1 ? "Ook gepland hier op die dagen" : "Ook gepland hier die dag", `${delen.join(" · ")}${meer}. Context: het zegt niet wat deze kaart is.`];
    if (e.uitleg) return { ...e, uitleg: { ...e.uitleg, regels: [...(e.uitleg.regels || []), regel] } };
    return { ...e, regels: [...(Array.isArray(e.regels) ? e.regels : []), regel] };
  });
}

// `agendaItems`: de hele agenda (window.PUBLIC_AGENDA_PUBLIC_ITEMS), `uitleg`: kaart-uitleg.json; allebei los van de
// plek, zodat een parkeerverbod op elke pagina dezelfde beslissing krijgt.
export function verrijkMetContext(entries = [], { straat = "", vandaag = "", agendaItems = [], uitleg = null } = {}) {
  return ookGeplandHier(evenementVanParkeerverboden(entries, { vandaag, agendaItems, uitleg }), { straat, vandaag });
}

// ---- zoeken: Enter ----
// Enter opent een suggestie alleen als ze echt overeenkomt (niet "Bedoelde je…"), of als de bewoner ze met de
// pijltjes koos. Zo werd "Vosstraat" (Borgerhout) met Enter de Gasstraat (vaagheidsplan 12-10-2026).
export const enterOpent = (suggestie, { pijltjes = false } = {}) => Boolean(suggestie?.place) && (pijltjes || suggestie.match !== "fuzzy");

const straatasVan = (index) => (index?.byName instanceof Map ? (naam) => index.byName.has(locationKey(naam)) || index.byName.has(foldText(naam)) : null);
export function evenementEntry(rows, { vandaag, alle = rows, uitleg = null, wijkVan, lijst = null, index = null, straat = "", straal = 0, identiteit = null, agendaItems = [], isStraat = null } = {}) {
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
  // Bewaarde omschrijvingen gaan opnieuw door de filter (geen huisnummer, geen naam), met de straten van het dossier.
  const bewaardeStraten = [...(bewaard?.straten || []), ...live.straten];
  // Met de straatas (isStraat), zoals de verversing ze filterde: anders viel een plek met twee straatnamen weg
  // ("Quinten Matsijslei - Van Eycklei", nakijkronde 13 oktober 2026).
  const straatas = typeof isStraat === "function" ? isStraat : straatasVan(index);
  const beschrijvingen = [...new Set([...live.beschrijvingen, ...(bewaard?.beschrijvingen || []).map((b) => veiligeOmschrijving(b, { straten: bewaardeStraten, isStraat: straatas }))].filter(Boolean))];
  // Een opname (de fase) wint; anders de soort uit alle omschrijvingen, zonder "vermoedelijk" alleen als
  // het hele dossier over dat ding gaat en elke inname een omschrijving heeft (soortEvenementMet).
  const sm = live.opname ? { soort: live.soort, zeker: live.soortZeker } : soortEvenementMet(beschrijvingen);
  const soort = sm.soort || live.soort || bewaard?.soort || "";
  const soortZeker = sm.soort ? Boolean(sm.zeker && (live.opname || live.alleOmschreven)) : Boolean(live.soortZeker);
  const feiten = bewaard
    ? { ...live, soort, soortZeker, soortBron: soort ? live.soortBron || "omschrijvingen in het dossier" : "", beschrijvingen, straten, langs, parcoursRelatie }
    : { ...live, straten, langs, parcoursRelatie };
  const id = identiteit?.dossiers?.[live.dossier] || null;
  // Koppeling aan de agenda. Een nagekeken evenement linkt alleen naar het agendapunt met dezelfde
  // naam; een dossier zonder fiche koppelt op dag en straat: eerst live (kent het agendapunt), anders
  // wat de verversing bewaarde.
  // Niet een agendapunt dat alleen uit de dossiers van de stad komt (district-asign-evenementen): dat is
  // geen tweede bron, en het kan van een buurdossier op dezelfde dag en straat zijn.
  const agenda = (Array.isArray(agendaItems) ? agendaItems : []).filter((item) => !alleenUitDossiers(item));
  const bekend = id && id.zekerheid !== "onbekend";
  const gekoppeld = bekend
    ? (id.zekerheid === "zeker" && id.naam && agenda.length ? koppelEvenement(feiten, agenda, { naam: id.naam }) : null)
    : (agenda.length ? koppelEvenement(feiten, agenda) : null) || bewaard?.gekoppeld || null;
  const k = evenementKaartje(feiten, { vandaag, gekoppeld, identiteit: id, straat, wijkVan });
  // Jouw straat: kort in de lijst (zonder openklappen), lang in de kaart (jouwStraat in kaart-uitleg.js).
  const jouwStraat = jouwStraatVoorLijst(straat, { lijst: stratenLijst, parcoursRelatie, rijen: alle, straal, geenEvenement: Boolean(k.geenEvenement) });
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
    // Wat de kaart niet zelf zegt (de uren): één keer boven de sectie, en de meter telt het (onbekend-zinnen.js).
    ...(k.onbekend?.length ? { onbekend: k.onbekend } : {}),
    // De echte dagen als die los liggen (een maandag per maand), voor de lijst en de badge (groupForList).
    losseDagen: k.losseDagen || [],
    // Alle innames van het dossier, ook buiten de gekozen plek: de buurtkaart tekent het hele parcours.
    rijen: alle,
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
// Eén stratenlijst per item voor tonen én filteren (agenda-view.js, setStreetLists), voor de plekpagina en de
// vaagheidsmeter samen (nakijkbevinding: de meter telde de werken langs hun werfzone en de evenementendossiers langs
// hun parcours niet mee, de browser wel). Een evenementendossier: de straten van zijn dossier (stratenFilter.refsVan);
// een agendapunt uit de dossiers: al zijn straten (stratenVanAgendapunt); een werk: de straat van zijn punt plus die
// van zijn werfzone (kaart-uitleg.json, vlakStraten). Anders null: dan de straten van het item zelf.
// `uitleg` en `straat` mogen functies zijn (de browser laadt kaart-uitleg.json later; de gekozen straat verandert).
export function straatLijstenVoor({ stratenFilter, uitleg = null, straat = "" } = {}) {
  const waarde = (v) => (typeof v === "function" ? v() : v);
  return (item) => {
    if (item?.kind === "iod" && isEvenementDossier(item) && item.reference) return stratenFilter.refsVan(item.reference, waarde(straat) || "");
    const agendaStraten = stratenVanAgendapunt(item);
    if (agendaStraten.length) return stratenFilter.naarRefs(agendaStraten);
    const vlak = !item?.kind && item?.gipodId != null ? waarde(uitleg)?.werken?.[item.gipodId]?.vlakStraten : null;
    if (Array.isArray(vlak) && vlak.length) {
      const eigen = Array.isArray(item.streets) ? item.streets : [];
      const al = new Set(eigen.map((r) => locationKey(r?.name)));
      return [...eigen, ...stratenFilter.naarRefs(vlak.filter((n) => !al.has(locationKey(n))))];
    }
    return null;
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
// Met { geenEvenement } (stickers, een bord, een opname): "deze inname", niet "dit evenement".
export function jouwStraatTekst(relatie, { viaParcours = false, straal = 0, geenEvenement = false } = {}) {
  const dit = geenEvenement ? "deze inname" : "dit evenement";
  if (relatie === "langs") return viaParcours
    ? { kort: "Het parcours loopt door je straat", lang: "Het parcours loopt door je straat." }
    : geenEvenement
      ? { kort: "Een plek van deze inname ligt in of naast je straat", lang: "Een plek van deze inname ligt in je straat of tot 18 m van de straatas." }
      : { kort: "Een zone van dit evenement ligt in of naast je straat", lang: "Een inname van dit evenement (zoals een parkeerverbod of een afgesloten zone) ligt in je straat of tot 18 m van de straatas." };
  if (relatie === "kruist") return { kort: "Je straat kruist het parcours", lang: "Je straat kruist het parcours of komt erop uit; het parcours loopt niet door je straat." };
  // Zonder vorm van het parcours (of nog zonder straatas): niet meer zeggen dan "in of naast".
  if (relatie === "naast") return { kort: "Het parcours ligt in of naast je straat", lang: "Het parcours ligt in of naast je straat." };
  if (straal > 0) {
    const afstand = straal >= 1000 ? "1 km" : `${straal} m`;
    return { kort: `Niet in je straat, wel binnen ${afstand}`, lang: `Niet in je straat: ${dit} ligt binnen ${afstand} van je straat.` };
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
export function jouwStraatVoorLijst(straat, { lijst = null, parcoursRelatie = null, rijen = [], straal = 0, geenEvenement = false } = {}) {
  const eigen = foldText(straat);
  if (!eigen) return null;
  if (parcoursRelatie === "op") return jouwStraatTekst("langs", { viaParcours: true });
  if (rijen.some((r) => !isParcoursRij(r) && (r?.streets || []).some((s) => foldText(s?.name) === eigen))) return jouwStraatTekst("langs", { geenEvenement });
  const relatie = straatRelatie(straat, lijst);
  if (parcoursRelatie === "kruist" || relatie === "kruist") return jouwStraatTekst("kruist");
  if (relatie === "langs") return jouwStraatTekst("naast");
  return jouwStraatTekst("", { straal, geenEvenement });
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
    if (jouw.kort === jouwStraatTekst("langs", { geenEvenement: Boolean(k.geenEvenement) }).kort && !/parcours/.test(k.kern[i][1])) k.kern[i] = ["Jouw straat", `${k.kern[i][1]} ${INNAME_18M}`];
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
// `isStraat(naam)`: staat die hele naam in de straatas? Voor de privacyfilter op de bewaarde omschrijvingen (een plek als
// "Quinten Matsijslei - Van Eycklei" is een straatnaam, geen persoon). Zonder: de straatas van `index` (byName).
export function publicSpaceEntries(rows = [], { vandaag = "", alle = rows, uitleg = null, wijkVan, straat = "", straal = 0, index = null, lijstVan = null, identiteit = null, agendaItems = [], isStraat = null } = {}) {
  if (!vandaag) return rows.map(publicSpaceEntry);
  const perDossier = bundelInnames(alle);
  const out = [];
  for (const [dossier, groep] of bundelInnames(rows)) {
    if (isEvenementDossier(groep[0])) out.push(evenementEntry(groep, { vandaag, alle: perDossier.get(dossier) || groep, uitleg, wijkVan, straat, straal, index, lijst: lijstVan ? lijstVan(dossier) : null, identiteit, agendaItems, isStraat }));
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
  // Zonder de toevoeging van de straatas bij een naamgenoot ("Maria-Theresialei_AN"): die is geen deel van de naam.
  const namen = [...new Set(straten.map((n) => zonderHomoniem(cleanText(n))).filter(Boolean))];
  if (namen.length <= 2) return namen.join(" en ");
  const eigen = foldText(gekozen) ? namen.find((n) => foldText(n) === foldText(zonderHomoniem(gekozen))) : "";
  return `${eigen || namen[0]} + ${namen.length - 1} andere straten`;
}
const stratenVan = (rows) => [...new Set(rows.flatMap((r) => (r?.streets || []).map((s) => s?.name)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "nl"));
// Ook voor scripts/build-straat-snapshots.mjs: welke rijen samen één kaart worden.
export const maatregelSleutel = (row) => (row?.kind === "sgw" && row.reference ? `sgw|${row.reference}`
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
    // De rijen van het dossier (alle plaatsen van het parkeerverbod, alle fasen van de werfzone), voor de buurtkaart.
    entry.rijen = dossierRijen;
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
// Raakt een fase (een rij van een werfzonedossier) de straat `eigen` (foldText), in de werfzone of op de omleiding?
const faseRaakt = (r, eigen) => [...(r?.werfzoneStreets || []), ...(r?.omleidingStreets || [])].some((s) => foldText(s?.name) === eigen);
function werfzoneEntry(dossierRijen, { vandaag = "", straat = "" } = {}) {
  const soorten = new Set(dossierRijen.flatMap((r) => String(r.kindLabel || r.title || "").split(/\s*\+\s*/)).filter(Boolean));
  const werfzone = soorten.has("Werfzone"), omleiding = soorten.has("Omleiding");
  const titel = werfzone && omleiding ? "Werfzone met omleiding" : omleiding ? "Omleiding" : "Werfzone";
  // Op een straat alleen de fasen waarin die straat in de werfzone of op de omleiding ligt: een omleiding van 75
  // straten voor vijf dagen betonstort is voor die straten geen "17 sep → 2 nov" (stratentoets van 12 oktober 2026,
  // GW2025-106999). Raakt geen fase de straat (een straal of een wijk), dan het hele dossier.
  const eigenStraat = foldText(straat);
  const hier = eigenStraat ? dossierRijen.filter((r) => faseRaakt(r, eigenStraat)) : [];
  const rijen = hier.length ? hier : dossierRijen;
  const begin = rijen.map((r) => dayOf(r.start)).filter(Boolean).sort()[0] || "";
  const einde = rijen.map((r) => dayOf(r.end)).filter(Boolean).sort().at(-1) || "";
  const heelBegin = dossierRijen.map((r) => dayOf(r.start)).filter(Boolean).sort()[0] || "";
  const heelEinde = dossierRijen.map((r) => dayOf(r.end)).filter(Boolean).sort().at(-1) || "";
  // Elke andere periode is een fase; twee fasen met dezelfde periode tellen één keer.
  const perioden = [...new Map(rijen.map((r) => [dayOf(r.start), dayOf(r.end)]).filter(([van]) => van).map(([van, tot]) => [`${van}|${tot}`, [van, tot]])).values()]
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  const lijst = perioden.slice(0, MAX_FASEN).map(([van, tot]) => kortePeriode(van, tot, vandaag)).join(" · ");
  const rest = perioden.length > MAX_FASEN ? ` · en nog ${perioden.length - MAX_FASEN}` : "";
  // Waar de werfzone zelf ligt en waar de omleiding loopt, apart: een straat op de omleiding heeft
  // geen werfzone. Ligt de gekozen straat in één van beide, dan staat dat vooraan.
  const werfStraten = namenVan(dossierRijen, "werfzoneStreets"), omlStraten = namenVan(dossierRijen, "omleidingStreets");
  const eigen = foldText(straat);
  const inWerf = Boolean(eigen) && werfStraten.some((n) => foldText(n) === eigen);
  const opOmleiding = !inWerf && Boolean(eigen) && omlStraten.some((n) => foldText(n) === eigen);
  const waarom = onbekendZin("werfzone-waarvoor", { wat: werfzone ? "werfzone" : "omleiding" });
  const wat = inWerf ? (omleiding ? "De werfzone ligt in je straat; het verkeer wordt omgeleid." : "De werfzone ligt in je straat.")
    : opOmleiding ? "Je straat ligt op de omleiding; de werfzone zelf ligt elders."
      : werfzone && omleiding ? "Een werfzone op straat, met een omleiding voor het verkeer." : omleiding ? "Een omleiding voor het verkeer." : "Een werfzone op straat.";
  const deel = hier.length && hier.length < dossierRijen.length && (heelBegin !== begin || heelEinde !== einde);
  // De fasen die de straat niet raken, blijven genoemd (nakijkronde 13 oktober 2026: de kaart zei vroeger alle fasen).
  const hierSleutels = new Set(perioden.map(([van, tot]) => `${van}|${tot}`));
  const andere = hier.length && hier.length < dossierRijen.length ? [...new Map(dossierRijen.map((r) => [dayOf(r.start), dayOf(r.end)]).filter(([van]) => van).map(([van, tot]) => [`${van}|${tot}`, [van, tot]])).entries()]
    .filter(([k]) => !hierSleutels.has(k)).map(([, v]) => v)
    // Een fase over de hele periode van de werfzone zegt niets meer dan "Hele werfzone".
    .filter(([van, tot]) => !(deel && van === heelBegin && (tot || van) === heelEinde))
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1])) : [];
  const andereLijst = `${andere.slice(0, MAX_FASEN).map(([van, tot]) => kortePeriode(van, tot, vandaag)).join(" · ")}${andere.length > MAX_FASEN ? ` · en nog ${andere.length - MAX_FASEN}` : ""}`;
  const andereTekst = deel && andere.length ? `; andere fasen: ${andereLijst}` : "";
  const regels = [
    ...(werfStraten.length ? [["Werfzone in", waarKort(werfStraten, straat)]] : []),
    ...(omlStraten.length ? [["Omleiding via", waarKort(omlStraten, straat)]] : []),
    ...(perioden.length > 1 ? [[`${perioden.length} fasen${deel ? " in je straat" : ""}`, `${lijst}${rest}`]] : []),
    ...(deel ? [["Hele werfzone", `${kortePeriode(heelBegin, heelEinde, vandaag)} (in je straat alleen op de dagen van deze kaart${andereTekst})`]] : []),
    ...(!deel && andere.length ? [["Andere fasen van de werfzone", `${andereLijst} (niet in je straat)`]] : []),
  ];
  // Een werfzone van één dag: de uren uit A-Sign (begin en einde van de fasen), zoals "van 9.00 tot 15.00 uur".
  // Meer vensters op die dag: het vroegste uur, en ze allemaal in de tekst.
  const vensters = !einde || einde === begin ? [...new Map(rijen.map((r) => urenVanDag(r.start, r.end)).filter(Boolean).map((u) => [u.timeText, u])).values()] : [];
  const uren = vensters.length ? { time: vensters.map((u) => u.time).filter(Boolean).sort()[0] || "", timeText: vensters.slice(0, 3).map((u) => u.timeText).join(" · ") } : null;
  return {
    title: titel,
    summary: `${wat} Vergund door de stad. ${waarom}`,
    // Waarvoor staat niet in A-Sign: samenWerven zoekt het in GIPOD, bundelLijst bundelt wat dan nog leeg is.
    zonderDoel: true,
    start: begin, end: einde && einde > begin ? einde : "",
    ...(uren ? uren : {}),
    // Alle fasen (niet alleen de eerste zes van de tekst): de tijdlijn en de weekzin tellen alleen de dagen
    // van een fase, niet het gat ertussen (opDag en dezeWeek).
    fasen: perioden,
    info: "",
    regels,
    ...(opOmleiding ? { location: `Omleiding via ${waarKort(omlStraten, straat)}` } : werfStraten.length ? { location: `Werfzone in ${waarKort(werfStraten, straat)}` } : {}),
  };
}
function workEntryBasis(work) {
  const consequences = work?.hindrance?.consequences || [];
  // Een werk van één dag: de uren uit GIPOD (begin en einde), of "hele dag".
  const uren = urenVanDag(work?.start, work?.end);
  return {
    uid: `works:${work?.gipodId}`, id: `gipod-${work?.gipodId}`, source: "works", theme: "works", group: "werken",
    title: cleanText(work?.title) || "Werk in openbaar domein", start: dayOf(work?.start), end: dayOf(work?.end), openEnd: false,
    time: uren?.time || "", timeText: uren?.timeText || "", location: streetNames(work), status: cleanText(work?.status),
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
  const weekdagen = alleenWeekdagen(row);
  const end = dayOf(row?.end);
  const enkeleDag = !end || end === base.start;
  return {
    ...base,
    title: parkeerTitel(reden),
    summary: [`Niet parkeren${uren ? (uren === "hele dag" ? ", de hele dag" : ` ${uren}`) : ""}${weekdagen ? ", alleen op weekdagen" : ""}.`, reden ? "" : onbekendZin("parkeerverbod-waarvoor")].filter(Boolean).join(" "),
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
    ? `Koopwaar buiten de winkel, op het openbaar domein, met een vergunning van de stad. ${onbekendZin("terras-periode")}`
    : `Een terras op het openbaar domein, met een vergunning van de stad. ${onbekendZin("terras-periode")}`;
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
      // Eén keer boven de sectie, niet op elke kaart: de startdatum van de werken (nooit in de bron), en bij een
      // ingediende aanvraag dat de bron niet zegt of ze volledig en ontvankelijk is.
      onbekend: [onbekendVeld("aanvragen-start"), ...(aanvraagZegtNiet(row) ? [onbekendVeld("aanvraag-ontvankelijk")] : [])],
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
    // Uit de stand van de ochtend (site/straat/<id>.json) komt een terras zonder adres (vaak met
    // huisnummer), wel met een groep per adres binnen de straat (scripts/build-straat-snapshots.mjs).
    const adres = foldText(row?.address) || (row?.adresGroep ? `groep:${row.adresGroep}` : "");
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
// Terrassen horen bij de groep "vergunningen" (één chip), maar de tegel telt ze apart: "12 vergunningen"
// mocht geen 9 terrassen meetellen. Zo ook een inname die geen evenement met publiek is (stickers, een
// bord, een opname): die staat in de groep "evenementen", maar de tegel telt ze apart.
export function summarize(entries, today) {
  const out = { evenementen: 0, werkenBezig: 0, werkenGepland: 0, inspraak: 0, markten: 0, raad: 0, vergunningen: 0, terrassen: 0, innamesOpStraat: 0 };
  const seen = new Set();
  for (const entry of entries) {
    const key = entry.source === "agenda" ? `${entry.group}|${entry.title}|${entry.location}` : entry.uid;
    if (entry.group === "werken") {
      if (entry.start && entry.start > today) out.werkenGepland += 1; else out.werkenBezig += 1;
      continue;
    }
    if (seen.has(key)) continue; // een reeks (elke dinsdag) telt één keer
    seen.add(key);
    if (entry.group === "vergunningen" && entry.source === "terraces") out.terrassen += 1;
    else if (entry.group === "evenementen" && entry.uitleg?.geenEvenement) out.innamesOpStraat += 1;
    else if (entry.group in out) out[entry.group] += 1;
  }
  return out;
}

// ---- "De komende 7 dagen in jouw straat": één zin met een verkeerslicht ----
// Uit dezelfde kaartjes als de lijst: wat de komende 7 dagen (vandaag inbegrepen, zoals de periode
// "7 dagen") op straat gebeurt. Hinder = een werk met ernstige hinder volgens GIPOD; let op = werken,
// parkeerverboden, innames of evenementen; rustig = niets van dat. Laadde niet alles, of telt een laag
// niet mee (`onbekend`), dan zeggen we nooit "rustig".
const WEEKDAG_KORT = Object.freeze(["zo", "ma", "di", "wo", "do", "vr", "za"]);
export const WEEK_LICHT = Object.freeze({ rustig: "Rustig", "let-op": "Let op", hinder: "Hinder", onbekend: "Onbekend" });
function weekDag(dag, today) {
  if (dag === today) return "vandaag";
  if (dag === addDays(today, 1)) return "morgen";
  return `${WEEKDAG_KORT[new Date(toUtc(dag)).getUTCDay()]} ${kortDatum(dag, today)}`;
}
const opsomming = (delen) => (delen.length > 1 ? `${delen.slice(0, -1).join(", ")} en ${delen.at(-1)}` : delen.join(""));
const metHoofdletter = (tekst) => tekst.charAt(0).toUpperCase() + tekst.slice(1);
// Wat een kaartje in het venster [today, einde] betekent, met de eerste dag die erin valt (dag) en
// zijn eigen begin (begin, voor "loopt al"). Een evenement op straat volgt zijn innameperiode
// (periodeVan): valt alleen de opbouw of de afbraak in het venster, dan staat dat er zo. Losse dagen
// tellen alleen als er één in het venster valt; een periode van twee weken of langer (een toelating
// voor een maand of een jaar) is geen evenement van vandaag maar loopt door, zoals "Doorlopend" in de lijst.
// Een werfzone met fasen telt alleen als een fase in het venster valt, met het begin van die fase.
function inWeek(e, today, einde) {
  const p = periodeVan(e);
  if (!p.start || p.start > einde || (!e.openEnd && (p.end || p.start) < today)) return null;
  const vanaf = (d) => (d > today ? d : today);
  if (e.source === "publicSpace" && e.item?.kind === "parking") return { soort: "parkeren", dag: vanaf(p.start), begin: p.start };
  if (e.group === "werken") {
    const fase = e.fasen?.length > 1 ? e.fasen.find(([van, tot]) => van <= einde && (tot || van) >= today) : null;
    if (e.fasen?.length > 1 && !fase) return null;
    const begin = fase ? fase[0] : p.start;
    return { soort: "werken", dag: vanaf(begin), begin, ernstig: (e.ernstig ?? e.item?.hindrance?.severe) === true };
  }
  if (e.group !== "evenementen") return null;
  const es = e.start || p.start, ee = e.end || es;
  const dag = e.losseDagen?.length ? e.losseDagen.find((d) => d >= today && d <= einde) || ""
    : es <= einde && ee >= today ? vanaf(es) : "";
  const inname = Boolean(e.uitleg?.geenEvenement);
  if (dag && (inname || langEvenement(e))) return inname ? { soort: "innames", dag } : { soort: "doorlopend", dag, begin: es };
  // Valt ook de opbouw of de afbraak (een parkeerverbod) in het venster, dan zegt de zin dat erbij: anders
  // leek het alsof de straat pas op de dag van het evenement iets merkt.
  if (dag) return { soort: "evenementen", dag, opbouw: p.start < es && es > today ? p.start : "", afbraak: p.end > ee && addDays(ee, 1) <= einde ? p.end : "" };
  // Geen dag van het evenement zelf in het venster: misschien wel de opbouw of de afbraak.
  if (p.start < es && p.start <= einde && addDays(es, -1) >= today) return inname ? { soort: "innames", dag: vanaf(p.start) } : { soort: "opbouw", dag: vanaf(p.start), begin: p.start };
  if (p.end > ee && addDays(ee, 1) <= einde && p.end >= today) return inname ? { soort: "innames", dag: vanaf(addDays(ee, 1)) } : { soort: "afbraak", dag: vanaf(addDays(ee, 1)), eind: p.end };
  return null;
}
// `onbekend`: lagen die de zin nodig heeft en waarvan de soort uit staat of die niet (volledig) geladen zijn,
// als [{ wat: "werken", uit: true, geladen: false, deels: false }]. Een laag die er niet (`geladen: false`) of
// maar deels is (`deels: true`, een deel laadde niet) maakt de zin nooit "rustig". Een laag die uit staat maar
// wel volledig geladen is, is nagekeken: die telt gewoon mee, ook voor "rustig".
export function dezeWeek(entries = [], today = "", { waar = "in jouw straat", onvolledig = false, onbekend = [] } = {}) {
  if (!isoDay(today)) return { licht: "onbekend", zin: "" };
  const einde = addDays(today, 6);
  const kop = `De komende 7 dagen ${waar}`;
  // Een reeks (elke dinsdag) telt één keer, met haar vroegste dag in het venster (de volgorde van de
  // invoer is niet gegarandeerd).
  const gevonden = new Map();
  // Een werfkaart draagt haar parkeerverboden (werfParkeer, samenWerven): die tellen elk als parkeerverbod, met hun
  // eigen begin, zoals toen ze nog losse kaarten waren (nakijkronde 13 oktober 2026: op de Sint-Andriesplaats zei de
  // zin "2 werken" terwijl er 2 parkeerverboden van kracht waren). Op hun uid: een parkeerverbod dat later begint en
  // ook een eigen kaart heeft, telt één keer.
  for (const kaart of entries) {
    for (const e of [kaart, ...(Array.isArray(kaart?.werfParkeer) ? kaart.werfParkeer : [])]) {
      const info = inWeek(e, today, einde);
      if (!info) continue;
      const key = e.source === "agenda" ? `${e.group}|${e.title}|${e.location}` : e.uid;
      const oud = gevonden.get(key);
      if (!oud || info.dag < oud.dag) gevonden.set(key, info);
    }
  }
  const per = (soort) => [...gevonden.values()].filter((i) => i.soort === soort);
  const aantal = (lijst, een, meer) => `${lijst.length} ${lijst.length === 1 ? een : meer}`;
  // "loopt al" als het vóór vandaag begon, "vanaf vandaag" alleen als het vandaag begint.
  const wanneer = (lijst) => {
    const al = lijst.filter((i) => i.begin < today).length;
    if (al === lijst.length) return al === 1 ? "loopt al" : "lopen al";
    if (al) return `${al} ${al === 1 ? "loopt" : "lopen"} al`;
    const eerste = lijst.map((i) => i.begin).sort()[0];
    return eerste === today ? "vanaf vandaag" : `vanaf ${weekDag(eerste, today)}`;
  };
  const eersteDag = (lijst) => `${lijst.length === 1 ? "" : "eerste "}${weekDag(lijst.map((i) => i.dag).sort()[0], today)}`;
  // Opbouw en afbraak rond een evenement in het venster: "opbouw vanaf vandaag", "afbraak tot en met do 22 okt".
  const rond = (lijst) => {
    const op = lijst.map((i) => i.opbouw).filter(Boolean).sort()[0], af = lijst.map((i) => i.afbraak).filter(Boolean).sort().at(-1);
    return [
      op ? `opbouw ${op < today ? "loopt al" : op === today ? "vanaf vandaag" : `vanaf ${weekDag(op, today)}`}` : "",
      af ? `afbraak tot en met ${weekDag(af, today)}` : "",
    ].filter(Boolean);
  };
  const werken = per("werken"), ernstig = werken.filter((i) => i.ernstig).length;
  const parkeren = per("parkeren"), evenementen = per("evenementen"), doorlopend = per("doorlopend");
  const opbouw = per("opbouw"), afbraak = per("afbraak"), innames = per("innames");
  const delen = [];
  const hinder = !ernstig ? "" : ernstig === werken.length ? (ernstig === 1 ? "met ernstige hinder" : "alle met ernstige hinder") : `${ernstig} met ernstige hinder`;
  if (werken.length) delen.push(`${aantal(werken, "werk", "werken")} (${[hinder, wanneer(werken)].filter(Boolean).join(", ")})`);
  if (parkeren.length) delen.push(`${aantal(parkeren, "parkeerverbod", "parkeerverboden")} (${wanneer(parkeren)})`);
  if (evenementen.length) delen.push(`${aantal(evenementen, "evenement", "evenementen")} (${[eersteDag(evenementen), ...rond(evenementen)].join(", ")})`);
  if (doorlopend.length) delen.push(`${aantal(doorlopend, "doorlopend evenement", "doorlopende evenementen")} (${wanneer(doorlopend)})`);
  if (opbouw.length) delen.push(`opbouw voor ${aantal(opbouw, "evenement", "evenementen")} (${wanneer(opbouw)})`);
  if (afbraak.length) delen.push(`afbraak na ${aantal(afbraak, "evenement", "evenementen")} (tot en met ${weekDag(afbraak.map((i) => i.eind).sort().at(-1), today)})`);
  if (innames.length) delen.push(`${aantal(innames, "inname", "innames")} op straat`);
  // Alleen wat niet (volledig) geladen is, telt als onbekend; een laag die uit staat maar geladen is, is nagekeken.
  const lagen = (Array.isArray(onbekend) ? onbekend : []).filter((o) => o?.wat && (!o.geladen || o.deels));
  const deels = lagen.filter((o) => o.deels).map((o) => o.wat);
  if (!delen.length) {
    if (onvolledig) return { licht: "onbekend", zin: `${kop}: niet alles laadde, dus we kunnen niet zeggen dat het rustig is.` };
    if (lagen.length) {
      const uit = lagen.filter((o) => !o.deels && o.uit).map((o) => o.wat), weg = lagen.filter((o) => !o.deels && !o.uit).map((o) => o.wat);
      const redenen = [uit.length ? `${opsomming(uit)} staan uit` : "", weg.length ? `${opsomming(weg)} zijn niet geladen` : "", deels.length ? `${opsomming(deels)} zijn niet volledig geladen` : ""].filter(Boolean);
      return { licht: "onbekend", zin: `${kop}: niets gevonden, maar ${opsomming(redenen)}. Of het rustig is, weten we dus niet.` };
    }
    return { licht: "rustig", zin: `${kop}: rustig. Geen werken, parkeerverboden of evenementen gepland.` };
  }
  // Wat niet (volledig) geladen is, zeggen we erbij; een laag die wel geladen is maar uit staat, telt gewoon mee.
  const ontbreekt = lagen.filter((o) => !o.deels).map((o) => o.wat);
  return {
    licht: ernstig ? "hinder" : "let-op",
    zin: `${kop}: ${opsomming(delen)}.${onvolledig ? " Niet alles laadde." : ""}${ontbreekt.length ? ` ${metHoofdletter(opsomming(ontbreekt))} zijn niet geladen.` : ""}${deels.length ? ` ${metHoofdletter(opsomming(deels))} zijn niet volledig geladen.` : ""}`,
  };
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
// Een aantal per soort in gewone taal, in enkelvoud of meervoud: "1 evenement", "2 markten". De namen van
// de soorten zelf ("Werken & verkeer") zijn geen telwoorden.
const SOORT_WOORD = Object.freeze({
  evenementen: ["evenement", "evenementen"],
  werken: ["werk of verkeersmaatregel", "werken of verkeersmaatregelen"],
  inspraak: ["item over inspraak of info", "items over inspraak of info"],
  markten: ["markt", "markten"],
  raad: ["vergadering van raad of commissie", "vergaderingen van raad of commissies"],
  vergunningen: ["vergunning", "vergunningen"],
});
export const soortAantal = (key, n) => `${n} ${(SOORT_WOORD[key] || ["item", "items"])[n === 1 ? 0 : 1]}`;
// Wat er op dag `d` gebeurt, voor de naam van een dagknop in de tijdlijn. `perGroep`: [[soortgroep, kaarten]].
// Een evenement op straat waarvan op die dag alleen de opbouw of de afbraak loopt (een parkeerverbod), heet
// zoals in de weekzin: "opbouw voor 1 evenement", "afbraak na 1 evenement".
export function dagInhoud(perGroep = [], d = "") {
  return perGroep.flatMap(([g, lijst]) => {
    if (g.key !== "evenementen") return [soortAantal(g.key, lijst.length)];
    const op = lijst.filter((e) => evenementFase(e, d) === "opbouw").length, af = lijst.filter((e) => evenementFase(e, d) === "afbraak").length;
    const ev = lijst.length - op - af;
    return [ev ? soortAantal("evenementen", ev) : "", op ? `opbouw voor ${soortAantal("evenementen", op)}` : "", af ? `afbraak na ${soortAantal("evenementen", af)}` : ""].filter(Boolean);
  }).join(", ");
}
// Toelatingen van twee weken of langer die op een dag doorlopen, zonder eigen teken: "1 toelating van twee
// weken of langer loopt door".
export const doorlopendTekst = (n) => `${n} ${n === 1 ? "toelating" : "toelatingen"} van twee weken of langer ${n === 1 ? "loopt" : "lopen"} door`;
// De noot bij "Doorlopend": wat erin staat, naar de bron. Een agendapunt van weken (een foor, een expo) is
// geen toelating van de stad. In de tijdlijn (`tijdlijn`) zegt ze ook waarom er geen teken per dag is.
export function doorlopendNoot(entries = [], { tijdlijn = false } = {}) {
  const toelating = entries.some((e) => e.source === "publicSpace"), ander = entries.some((e) => e.source !== "publicSpace");
  const wat = toelating && ander ? "Evenementen en toelatingen van de stad" : toelating ? "Toelatingen van de stad" : "Evenementen en activiteiten";
  return `${wat} die weken of maanden lopen. ${tijdlijn ? "Ze krijgen geen teken per dag, wel op de dag waarop ze beginnen." : "Wat op één dag of een paar dagen valt, staat hierboven."}`;
}
// Een dag zonder iets in de tijdlijn (de naam van de dagknop). Laadt een laag nog of laadde ze niet, dan
// nooit "niets gepland"; en anders "binnen je keuze": de soorten die uit staan, tellen niet mee. Loopt er die
// dag een toelating van twee weken of langer door (`doorlopend`), dan zegt de naam dat ook.
// `bezig`: de lagen die nog laden ("werken", "verkeersmaatregelen" ...); elk is een meervoud.
export function legeDagLabel({ bezig = [], onvolledig = false, doorlopend = 0 } = {}) {
  const apart = doorlopend ? " apart" : "";
  const zin = bezig.length ? `nog niets${apart} gevonden, ${opsomming(bezig)} worden nog geladen`
    : onvolledig ? `niets${apart} gevonden in wat geladen is, niet alles laadde`
    : `niets${apart} gepland binnen je keuze`;
  return doorlopend ? `${zin}; ${doorlopendTekst(doorlopend)}` : zin;
}
// Lege tijdlijn: eerlijk over die ene dag (`dag`) of over de komende 14 dagen, niet over de hele plek
// (dat doet legeStaatTekst). `andereDagen`: hoeveel andere dagen van de 14 wel iets hebben; `doorlopend`:
// hoeveel toelatingen van twee weken of langer er wel lopen (die staan eronder, zonder teken per dag).
export function legeTijdlijnTekst({ dag = false, bezig = [], onvolledig = false, aantalSoorten = 1, andereDagen = 0, doorlopend = 0 } = {}) {
  if (!aantalSoorten) return "Je hebt alle soorten uitgezet.";
  const wanneer = dag ? "op die dag" : "de komende 14 dagen";
  const behalve = doorlopend ? " behalve wat hieronder doorloopt" : "";
  const zin = bezig.length ? `In wat al geladen is, staat ${wanneer} niets${behalve}; ${opsomming(bezig)} worden nog geladen.`
    : onvolledig ? `In wat wel geladen is, staat ${wanneer} niets${behalve}.`
    : `Binnen je keuze staat ${wanneer} niets gepland${behalve}.`;
  if (!dag || !andereDagen) return zin;
  return `${zin} Op ${andereDagen === 1 ? "1 andere dag" : `${andereDagen} andere dagen`} van de komende 14 dagen staat wel iets: kies een dag met een teken.`;
}
// Voortgang van een meerdaagse periode: "Start over 13 dagen · duurt 8 dagen" of "Dag 3 van 8". Een
// periode van twee weken of langer is een toelating, geen evenement dat je dag per dag volgt: dan "Loopt
// sinds 1 okt · nog 19 dagen (t/m 29 okt)" of "Loopt heel 2026 · nog 82 dagen".
export function voortgangTekst(start, end, today) {
  const totaal = Math.max(1, daysBetween(start, end) + 1);
  const dagen = (n) => `${n} dag${n === 1 ? "" : "en"}`;
  if (start > today) return `Start over ${dagen(daysBetween(today, start))} · duurt ${dagen(totaal)}`;
  if (totaal >= LANG_DAGEN) {
    const nog = Math.max(0, daysBetween(today, end));
    const heelJaar = start.slice(5) === "01-01" && end.slice(5) === "12-31" && start.slice(0, 4) === end.slice(0, 4);
    return `${heelJaar ? `Loopt heel ${start.slice(0, 4)}` : `Loopt sinds ${kortDatum(start, today)}`} · ${nog ? `nog ${dagen(nog)}` : "laatste dag"}${heelJaar ? "" : ` (t/m ${kortDatum(end, today)})`}`;
  }
  return `Dag ${Math.min(totaal, Math.max(0, daysBetween(start, today) + 1))} van ${totaal}`;
}
// Losse dagen van een evenement op straat, in gewone taal: "Elke woensdag van 7 tot 28 oktober; de
// volgende is woensdag 21 oktober" (site/evenement-wat.js).
export function losseDagenTekst(entry = {}, today = "") {
  const p = patroonVan(entry.losseDagen || [], today);
  const t = p ? patroonTekst(p, today) : "";
  return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}` : "";
}
