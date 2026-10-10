// Privacy van de historiek (site/history): alleen district Antwerpen en nooit een huisnummer.
//
// De repo is publiek. Een parkeerverbod is vaak een verhuis of een container bij één woning, en een
// GIPOD-titel als "2000 Antwerpen, Xstraat 12" wijst vaak naar een aansluiting bij één huis. Het
// huisnummer is dan een privéadres. Daarom:
// - adressen worden "Straat, 2000 Antwerpen" (zelfde vorm als de live laag in de browser);
// - in vrije tekst valt elk nummer achter een straatnaam weg ("Xstraat 12-14", "Xstraat 3 bus 2",
//   "Xstraat | 12", "Xstraat - 12 - werken", "Xstraat, 12", "Xstraat thv 12"), ook hele reeksen
//   ("12 tem 14", "12, 14 en 16", "12 14 16"), en "huisnummer 12" altijd;
// - A-Sign "District='ANTWERPEN'" is de hele stad: een parkeerverbod telt alleen mee met een
//   postcode van het district (lib/postcodes.mjs).
// De verversing (scripts/refresh-live-history.mjs) past dit toe vóór ze vergelijkt en schrijft, en
// scripts/opkuis-historiek-privacy.mjs kuist de bestaande bestanden één keer op. De scan
// (historiekPrivacyBevindingen) gebruikt dezelfde regels: wat de opkuis teruggeeft, is altijd schoon
// (tot er niets meer gevonden wordt, met een vangnet), en opnieuw opkuisen verandert niets.
import crypto from "node:crypto";
import fs from "node:fs";

import { isDistrictPostcode, pointInDistrict } from "./postcodes.mjs";

const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const vouw = (value) => clean(value).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ---------- officiële straatnamen ----------

// site/geo/straten.json (de stratenlijst van het district). Ontbreekt het bestand, dan geldt alleen de
// regel met de straatuitgangen hieronder.
let straten;
function officieleStraten() {
  if (straten !== undefined) return straten;
  straten = { namen: new Set(), cijfernamen: [] };
  try {
    const doc = JSON.parse(fs.readFileSync(new URL("../site/geo/straten.json", import.meta.url), "utf8"));
    for (const row of Array.isArray(doc?.streets) ? doc.streets : []) {
      const naam = clean(row?.[1]);
      if (!naam) continue;
      straten.namen.add(vouw(naam));
      // Een straatnaam met een cijfer ("4 septemberpad", "Buurtweg nr 11", "Kanaaldok B1") mag de
      // nummerregel niet verminken.
      if (/\d/.test(naam)) straten.cijfernamen.push(vouw(naam));
    }
    straten.cijfernamen.sort((a, b) => b.length - a.length);
  } catch {
    // geen stratenlijst: alleen de straatuitgangen
  }
  return straten;
}

// Uitgangen van Vlaamse straatnamen. "Havenwegen" eindigt niet op "weg": de uitgang moet het einde
// van het woord zijn.
const STRAATUITGANG = /(?:straat|laan|lei|plein|plaats|weg|dreef|kaai|kade|vest|markt|rui|vliet|dijk|dok|hof|pad|park|singel|brug|berg|baan|gang|poort|wal|oord|veld|steeg|erf|boulevard|square)$/;

function eindigtOpStraat(voor) {
  // "Veldstraat [Antwerpen]", "Berkenlaan (2610)": de toevoeging tussen haakjes telt niet.
  const tekst = voor.replace(/(?:\s*[[(][^\])]*[\])])+\s*$/, "");
  if (!/[\p{L}.]$/u.test(tekst)) return false;
  const woorden = vouw(tekst).split(" ");
  const laatste = woorden.at(-1).replace(/\.$/, "");
  // "Xstr. 12": de afkorting van straat.
  if (STRAATUITGANG.test(laatste) || /str$/.test(laatste)) return true;
  const { namen } = officieleStraten();
  for (let k = 1; k <= Math.min(6, woorden.length); k += 1) {
    if (namen.has(woorden.slice(-k).join(" "))) return true;
  }
  return false;
}

// Stukken met een officiële straatnaam met een cijfer: [begin, einde) in de tekst.
function cijferstraatStukken(tekst) {
  const { cijfernamen } = officieleStraten();
  if (!cijfernamen.length || !/\d/.test(tekst)) return [];
  // Vouwen houdt de lengte gelijk voor letters met één accent (NFD + weglaten van het accent kan de
  // lengte veranderen); daarom per teken vouwen.
  const gevouwen = Array.from({ length: tekst.length }, (_, i) => tekst[i].normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().slice(0, 1) || tekst[i]).join("");
  const stukken = [];
  for (const naam of cijfernamen) {
    let vanaf = 0;
    for (;;) {
      const plek = gevouwen.indexOf(naam, vanaf);
      if (plek < 0) break;
      const einde = plek + naam.length;
      const voor = plek === 0 || !/[\p{L}\d]/u.test(gevouwen[plek - 1]);
      const na = einde === gevouwen.length || !/[\p{L}\d]/u.test(gevouwen[einde]);
      if (voor && na && !stukken.some(([a, b]) => plek < b && einde > a)) stukken.push([plek, einde]);
      vanaf = einde;
    }
  }
  return stukken.sort((a, b) => a[0] - b[0]);
}

// ---------- huisnummers in vrije tekst ----------

// Een nummer achter een straatnaam: "12", "12b", "12RO", "3B_BIS", "12bus3", "12-14", "12 tem 14",
// "12 t.e.m. 20", "12 tot en met 20", "12 → 20", "12 en 14", "12, 14 en 16", "12 14 16", "123-125A",
// "12/3", "12 bus 3", "(12)". Als scheiding een spatie, een komma, " - ", " | ", ": " of "(", en
// eventueel "nr", "nrs", "huisnummer", "thv", "t.h.v." of "ter hoogte van" vóór het nummer.
const GRENS = String.raw`(?=bus\s*[a-z0-9]|[^\p{L}\d_]|$)`;
// "nr", "huisnummer", "thv", "t.h.v. nr", "ter hoogte van nr" vóór een nummer. Ook het einde van een
// reeks waarvan het begin al wegviel: "Xstraat t.e.m. 20" (de oude opkuis liet dat zo achter).
const VOORVOEGSEL = String.raw`(?:(?:t\.\s?e\.\s?m\.?|tem|tm|t\/m|tot\s+en\s+met|→|->)\s*)?(?:(?:thv|t\.\s?h\.\s?v\.?|ter\s+hoogte\s+van)\s*)?(?:(?:nrs?|no|n°|hnr|huisnummers?)\.?\s*)?`;
// Een volgend nummer in een reeks ("12, thv nr 14 en thv nr 16" ook). Geen jaartal of postcode:
// "Xstraat 12 2000 Antwerpen" en "Xstraat 12, 2000 Antwerpen" houden hun postcode.
const VERVOLG = String.raw`${VOORVOEGSEL}(?!(?:19|[2-9]\d)\d\d(?!\d))\d{1,4}(?:[a-z]{0,2}_?bis|(?!bus)[a-z]{1,2})?${GRENS}`;
// Alleen een spatie of een komma ertussen: geen maat ("Xstraat 12 30 m" houdt "30 m").
const GEEN_MAAT = String.raw`(?!\s*(?:m|m²|m2|meter|km|kv|mm|cm)(?![\p{L}\d]))`;
const KANDIDAAT = new RegExp([
  String.raw`(?<scheiding>\s*[|:,(–—-]\s*|\s+)`,
  String.raw`(?<voorvoegsel>${VOORVOEGSEL})`,
  String.raw`(?<nummer>\d{1,4})`,
  String.raw`(?<letter>[a-z]{0,2}_?(?:bis|ter)|(?!bus)[a-z]{1,3})?${GRENS}`,
  String.raw`(?<reeks>(?:\s*(?:-|–|—|\/|\+|&|→|->|tot\s+en\s+met|t\.\s?e\.\s?m\.?|tem|tm|t\/m|tot|en)\s*${VERVOLG}|(?:\s*,\s*|\s+)${VERVOLG}${GEEN_MAAT})*)`,
  String.raw`(?<bus>\s*bus\s*[a-z0-9]{1,6}(?![\p{L}\d]))?`,
  String.raw`(?<losseLetter>\s[a-z](?![\p{L}\d.]))?`,
  String.raw`(?<sluit>\s*\))?`,
].join(""), "giu");
const EENHEID = /^(?:m|km|cm|mm|kv|m2|m²)$/i;
const NA_EENHEID = /^\s*(?:m|m²|m2|meter|km|kv|mm|cm)(?![\p{L}\d])/iu;

// [begin, einde) van elk huisnummer (met de scheiding ervoor) in `tekst`.
export function huisnummerStukken(tekst) {
  const waarde = String(tekst ?? "");
  if (!/\d/.test(waarde)) return [];
  const beschermd = cijferstraatStukken(waarde);
  const stukken = [];
  for (const match of waarde.matchAll(KANDIDAAT)) {
    const { scheiding, voorvoegsel, nummer, letter = "", reeks, bus = "", losseLetter = "", sluit = "" } = match.groups;
    const begin = match.index;
    const nummerBegin = begin + scheiding.length + voorvoegsel.length;
    const haakje = scheiding.includes("(");
    // Een ")" hoort alleen bij het stuk als het met "(" begon: "Ystraat (Xstraat 12)" houdt zijn ")".
    const einde = begin + match[0].length - (haakje ? 0 : sluit.length);
    if (beschermd.some(([a, b]) => nummerBegin < b && einde > a)) continue;
    // Een maat, geen huisnummer: "150m", "Xstraat - 30 m".
    if (EENHEID.test(letter) || NA_EENHEID.test(losseLetter + waarde.slice(begin + match[0].length - sluit.length))) continue;
    // Een los getal van vier cijfers vanaf 1900 is een jaartal of een postcode, geen huisnummer:
    // "Bevrijdingstunnel 2026 - Antwerpen", "Xstraat 2000 Antwerpen" (zonder komma). Na een komma is
    // een los getal van vier cijfers altijd een postcode: "Xstraat, 1000 Brussel".
    const los = !letter && !reeks && !bus && !losseLetter && nummer.length === 4;
    if (los && (Number(nummer) >= 1900 || scheiding.includes(","))) continue;
    // "(" telt alleen met alleen het nummer tussen de haakjes: "Xstraat (12)". "Xstraat (9 kranen)"
    // is een aantal.
    if (haakje && !sluit) continue;
    // "huisnummer 12" en "ter hoogte van nr 12" zijn altijd een huisnummer, ook zonder straat ervoor.
    const zeker = /huisnummer/i.test(voorvoegsel) || (/thv|t\.\s?h\.\s?v|hoogte/i.test(voorvoegsel) && /(?:^|[^\p{L}])(?:nrs?|no|n°|hnr)(?![\p{L}])/iu.test(voorvoegsel));
    const voor = waarde.slice(0, begin);
    const naBescherming = beschermd.some(([, b]) => b === begin);
    if (!zeker && !naBescherming && !eindigtOpStraat(voor)) continue;
    stukken.push([begin, einde]);
  }
  return stukken;
}

const netjes = (tekst) => tekst.replace(/\s+([,.;)\]])/g, "$1").replace(/\(\s+/g, "(").replace(/\s{2,}/g, " ").trim();

// Herhaalt tot er geen nummer meer gevonden wordt. Dat stopt altijd: elke ronde haalt minstens één
// cijfer weg. Zo is het resultaat een vast punt: opnieuw opkuisen verandert niets (een verversing na
// de opkuis maakt dus geen valse "changed").
export function tekstZonderHuisnummers(tekst) {
  let uit = String(tekst ?? "");
  for (let stukken = huisnummerStukken(uit); stukken.length; stukken = huisnummerStukken(uit)) {
    // Het stuk begint met de scheiding vóór het nummer: "Xstraat 12 (aansluiting)" wordt
    // "Xstraat (aansluiting)", "Xstraat - 12 - werken" wordt "Xstraat - werken".
    for (const [begin, einde] of stukken.reverse()) uit = uit.slice(0, begin) + uit.slice(einde);
    uit = netjes(uit);
  }
  return uit;
}

// ---------- adressen (parkeerverboden) ----------

// A-Sign schrijft "Xstraat 26-26 2000 Antwerpen", "Berkenlaan (2610) 34-hoek 2610 Antwerpen",
// "Handelstraat hoek-64 2060 Antwerpen" of "Xstraat 12 bus 3 2000 Antwerpen". Na de opkuis:
// "Xstraat, 2000 Antwerpen". Een al opgekuist adres blijft gelijk.
const ADRES = /^(?:(.*?)[\s,]+)?(\d{4})\s+([^\d,]+)$/;
// Opvulling waar een huisnummer hoort: "hoek", "Onbekend-Onbekend", "hnr nvt-hnr nvt".
const VULWOORD = /^(?:hoek|nvt|hnr|onbekend|bus|nr\.?|no\.?|z\/n|zn)$/i;
const isVulwoord = (woord) => woord.split("-").every((deel) => VULWOORD.test(deel));

function adresDelen(adres) {
  const tekst = clean(adres).slice(0, 220);
  const match = tekst.match(ADRES);
  return match ? { straat: match[1] || "", postcode: match[2], gemeente: clean(match[3]) } : { straat: tekst, postcode: "", gemeente: "" };
}

export function adresAlleenStraat(adres) {
  const { straat: ruw, postcode, gemeente } = adresDelen(adres);
  let straat = ruw.replace(/\s*\(\d{4}\)/g, "").trim();
  const gevouwen = vouw(straat);
  const cijfernaam = officieleStraten().cijfernamen.find((naam) => gevouwen === naam || gevouwen.startsWith(`${naam} `));
  if (cijfernaam) {
    straat = straat.slice(0, cijfernaam.length);
  } else {
    // Vanaf het eerste stuk met een cijfer is het geen straatnaam meer ("12-14", "hoek-64", "12A").
    straat = straat.replace(/(?:^|\s+)\S*\d.*$/, "").trim();
    const woorden = straat.split(" ").filter(Boolean);
    while (woorden.length > 1 && isVulwoord(woorden.at(-1))) woorden.pop();
    straat = woorden.join(" ");
  }
  straat = straat.replace(/[,\s]+$/, "");
  if (straat) straat = straat[0].toUpperCase() + straat.slice(1);
  // Zekerheid: wat dan nog als huisnummer gelezen wordt, valt weg.
  straat = tekstZonderHuisnummers(straat);
  if (!postcode) return straat;
  return straat ? `${straat}, ${postcode} ${gemeente}` : `${postcode} ${gemeente}`;
}

export function adresPostcode(adres) {
  return adresDelen(adres).postcode;
}

// ---------- district ----------

export const isParkeerId = (id) => String(id || "").startsWith("parking:");
const isParkeerItem = (item) => isObject(item) && (item.kind === "parking" || isParkeerId(item.id));

// Ligt een parkeerverbod in het district? De postcode van het adres beslist. Zonder postcode: alleen als
// het adres op een officiële straat van het district viel (lib/street-resolver.mjs). `null` als het
// niet te zeggen is (een wijziging zonder adres).
export function parkeerverbodInDistrict(item) {
  if (!isObject(item)) return null;
  if (typeof item.location === "string" && item.location.trim()) {
    const postcode = adresPostcode(item.location);
    if (postcode) return isDistrictPostcode(postcode);
  }
  if (Array.isArray(item.streets)) return item.streets.length > 0 && item.streets.every((ref) => isDistrictPostcode(ref?.postcode));
  if (typeof item.location === "string" && item.location.trim()) return false;
  return null;
}

// ---------- items en wijzigingen ----------

// Velden die nooit een adres zijn (ids, datums, digests): ongemoeid laten.
const VASTE_VELDEN = new Set(["id", "reference", "gipodId", "start", "end", "observedAt", "lastAttemptAt", "lastSuccessAt", "digest", "kind", "layer", "type", "status", "streetResolution", "errorCode", "date", "file"]);

function schoonWaarde(sleutel, waarde) {
  if (typeof waarde === "string") {
    if (VASTE_VELDEN.has(sleutel)) return waarde;
    const schoon = sleutel === "location" ? adresAlleenStraat(waarde) : tekstZonderHuisnummers(waarde);
    return tekstMetHuisnummer(sleutel, schoon) ? alleenStraatnaam(sleutel, schoon) : schoon;
  }
  if (Array.isArray(waarde)) return waarde.map((kind) => schoonWaarde(sleutel === "fields" ? "fields" : "", kind));
  if (isObject(waarde)) return itemVoorHistoriek(waarde);
  return waarde;
}

// Eén item (of de gewijzigde velden van een wijziging) zonder huisnummers.
export function itemVoorHistoriek(item) {
  if (!isObject(item)) return item;
  const uit = {};
  for (const [sleutel, waarde] of Object.entries(item)) uit[sleutel] = sleutel === "fields" ? waarde : schoonWaarde(sleutel, waarde);
  return uit;
}

// Welke parkeerverboden liggen in het district, per id, uit alle volledige items die we kennen.
export function parkeerDistrictOpzoeking(documenten = []) {
  const opzoeking = new Map();
  const zet = (item) => {
    if (!isParkeerItem(item)) return;
    const binnen = parkeerverbodInDistrict(item);
    if (binnen !== null && !opzoeking.has(item.id)) opzoeking.set(item.id, binnen);
  };
  const wijziging = (entry) => {
    if (!isObject(entry) || !isParkeerId(entry.id)) return;
    for (const kant of [entry.after, entry.before]) {
      const binnen = parkeerverbodInDistrict(kant);
      if (binnen !== null && !opzoeking.has(entry.id)) opzoeking.set(entry.id, binnen);
    }
  };
  for (const doc of documenten) {
    if (!isObject(doc)) continue;
    for (const laag of Object.values(isObject(doc.layers) ? doc.layers : {})) for (const item of laag?.items || []) zet(item);
    for (const entry of Array.isArray(doc.changes) ? doc.changes : []) wijziging(entry);
    for (const entry of Array.isArray(doc.events) ? doc.events : []) wijziging(entry);
  }
  return opzoeking;
}

// Een wijziging in het district, of `onbekend` als er geen adres te vinden is.
function wijzigingInDistrict(entry, opzoeking, onbekend) {
  if (!isObject(entry) || !isParkeerId(entry.id)) return true;
  for (const kant of [entry.after, entry.before]) {
    const binnen = parkeerverbodInDistrict(kant);
    if (binnen !== null) return binnen;
  }
  return opzoeking.has(entry.id) ? opzoeking.get(entry.id) : onbekend;
}

// Een wijziging zonder huisnummers. Een "changed" die daarna niets meer wijzigt (bv. alleen een ander
// huisnummer) valt weg: null.
export function wijzigingVoorHistoriek(entry) {
  if (!isObject(entry)) return entry;
  const before = itemVoorHistoriek(entry.before ?? null);
  const after = itemVoorHistoriek(entry.after ?? null);
  if (entry.type !== "changed" || !isObject(before) || !isObject(after)) return { ...entry, before, after };
  const fields = (Array.isArray(entry.fields) ? entry.fields : []).filter((field) => JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null));
  if (!fields.length) return null;
  const pick = (value) => Object.fromEntries(fields.map((field) => [field, value[field] ?? null]));
  return { ...entry, fields, before: pick(before), after: pick(after) };
}

function wijzigingenVoorHistoriek(entries, opzoeking, onbekend) {
  return entries.filter((entry) => wijzigingInDistrict(entry, opzoeking, onbekend)).map(wijzigingVoorHistoriek).filter(Boolean);
}

const itemsVoorHistoriek = (items = []) => items.filter((item) => !isParkeerItem(item) || parkeerverbodInDistrict(item) !== false).map(itemVoorHistoriek);

// ---------- documenten ----------

// Zelfde digest als lib/live-history.mjs (gesorteerd op id, sha256 van de JSON).
function liveDigest(items) {
  const stable = [...items].sort((a, b) => String(a.id).localeCompare(String(b.id), "nl"));
  return crypto.createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

// Een resultaat van de verversing ({ ok, items }) vóór het naar de historiek gaat.
export function resultaatVoorHistoriek(result) {
  if (!result?.ok || !Array.isArray(result.items)) return result;
  const items = itemsVoorHistoriek(result.items);
  return { ...result, items, buitenDistrict: result.items.length - items.length };
}

// site/history/live-layers.json. `onbekend`: wat met een wijziging van een parkeerverbod waarvan geen
// adres te vinden is (de verversing houdt ze: haar bron is al gefilterd).
export function historiekVoorPubliek(document, { onbekend = true, opzoeking = null } = {}) {
  if (!isObject(document) || !isObject(document.layers)) return document;
  const kaart = opzoeking || parkeerDistrictOpzoeking([document]);
  const layers = {};
  for (const [naam, laag] of Object.entries(document.layers)) {
    if (!isObject(laag) || !Array.isArray(laag.items)) {
      layers[naam] = laag;
      continue;
    }
    const items = itemsVoorHistoriek(laag.items);
    layers[naam] = { ...laag, items, count: items.length, digest: typeof laag.digest === "string" ? liveDigest(items) : laag.digest };
  }
  const changes = Array.isArray(document.changes) ? wijzigingenVoorHistoriek(document.changes, kaart, onbekend) : document.changes;
  return { ...document, layers, changes };
}

// site/history/archive/baseline.json
export function archiefBaselineVoorPubliek(document) {
  if (!isObject(document) || !isObject(document.layers)) return document;
  const layers = {};
  for (const [naam, laag] of Object.entries(document.layers)) {
    layers[naam] = isObject(laag) && Array.isArray(laag.items) ? { ...laag, items: itemsVoorHistoriek(laag.items) } : laag;
  }
  return { ...document, layers };
}

// site/history/archive/<dag>.json
export function archiefDagVoorPubliek(document, { onbekend = true, opzoeking = null } = {}) {
  if (!isObject(document) || !Array.isArray(document.events)) return document;
  const kaart = opzoeking || parkeerDistrictOpzoeking([document]);
  const seen = new Set();
  const events = [];
  for (const event of wijzigingenVoorHistoriek(document.events, kaart, onbekend)) {
    // Twee events die na de opkuis gelijk zijn, worden er één (zoals updateHistoryArchiveDay ontdubbelt).
    const sleutel = JSON.stringify(event);
    if (seen.has(sleutel)) continue;
    seen.add(sleutel);
    events.push(event);
  }
  return { ...document, events };
}

// ---------- scan ----------

const LOCATIE_REST = (waarde) => {
  // Wat er van een adres overblijft zonder postcode en gemeente en zonder officiële cijferstraat.
  const { straat, postcode } = adresDelen(waarde);
  let rest = postcode ? straat.replace(/\s*\(\d{4}\)/g, "") : clean(waarde);
  for (const [begin, einde] of cijferstraatStukken(rest).reverse()) rest = rest.slice(0, begin) + rest.slice(einde);
  return rest;
};

// Leest de scan in deze tekst een huisnummer? (Dezelfde regel voor de scan en voor het vangnet.)
function tekstMetHuisnummer(sleutel, tekst) {
  return huisnummerStukken(tekst).length > 0 || (sleutel === "location" && /\d/.test(LOCATIE_REST(tekst)));
}

// Laatste vangnet van de opkuis: leest de scan in de opgekuiste tekst toch nog een huisnummer, dan
// blijft alleen de straatnaam over. Van een adres de woorden zonder cijfer, met postcode en gemeente;
// van vrije tekst alles vóór het eerste nummer. Zo geeft de opkuis nooit iets terug dat de scan
// afkeurt (en dat de dagelijkse verversing in validate-data zou tegenhouden).
function alleenStraatnaam(sleutel, tekst) {
  let uit = tekst;
  if (sleutel === "location" && tekstMetHuisnummer(sleutel, uit)) {
    const { straat, postcode, gemeente } = adresDelen(uit);
    let naam = (postcode ? straat : clean(uit)).split(" ").filter((woord) => woord && !/\d/.test(woord)).join(" ").replace(/[,\s]+$/, "");
    if (naam) naam = naam[0].toUpperCase() + naam.slice(1);
    uit = postcode ? [naam, `${postcode} ${gemeente}`].filter(Boolean).join(", ") : naam;
  }
  for (let stukken = huisnummerStukken(uit); stukken.length; stukken = huisnummerStukken(uit)) uit = netjes(uit.slice(0, stukken[0][0]));
  return uit;
}

const isBelgischPunt = (value) => Array.isArray(value) && value.length >= 2 && value.length <= 3
  && Number.isFinite(value[0]) && Number.isFinite(value[1]) && value[0] > 2 && value[0] < 7 && value[1] > 49 && value[1] < 52;

// Bevindingen in één historiekbestand: { code, path }. Nooit de gevonden waarde zelf (publieke logs).
// - huisnummer: een nummer achter een straatnaam, of een cijfer in een adres buiten de postcode;
// - buiten_district: een parkeerverbod of een straat met een postcode buiten het district;
// - punt_buiten_district: een coördinaat buiten de districtsgrens (lib/district-antwerpen-grens.geojson).
export function historiekPrivacyBevindingen(value, path = "$") {
  const findings = [];
  const visit = (node, at, sleutel, parkeer) => {
    if (typeof node === "string") {
      if (VASTE_VELDEN.has(sleutel)) return;
      if (tekstMetHuisnummer(sleutel, node)) findings.push({ code: "huisnummer", path: at });
      return;
    }
    if (Array.isArray(node)) {
      if (isBelgischPunt(node)) {
        if (!pointInDistrict(node.slice(0, 2))) findings.push({ code: "punt_buiten_district", path: at });
        return;
      }
      node.forEach((child, index) => visit(child, `${at}[${index}]`, sleutel === "streets" ? "streets" : "", parkeer));
      return;
    }
    if (!isObject(node)) return;
    const binnenParkeer = parkeer || isParkeerItem(node);
    if (binnenParkeer && typeof node.location === "string" && parkeerverbodInDistrict(node) === false) findings.push({ code: "buiten_district", path: at });
    if (sleutel === "streets" && typeof node.postcode === "string" && node.postcode && !isDistrictPostcode(node.postcode)) findings.push({ code: "buiten_district", path: at });
    for (const [x, y] of [["x", "y"], ["lon", "lat"], ["lng", "lat"], ["longitude", "latitude"]]) {
      if (Number.isFinite(node[x]) && Number.isFinite(node[y]) && isBelgischPunt([node[x], node[y]]) && !pointInDistrict([node[x], node[y]])) findings.push({ code: "punt_buiten_district", path: at });
    }
    for (const [key, child] of Object.entries(node)) visit(child, `${at}.${key}`, key, binnenParkeer);
  };
  visit(value, path, "", false);
  return findings;
}
