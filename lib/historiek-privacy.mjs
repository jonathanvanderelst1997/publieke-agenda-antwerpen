// Privacy van de historiek (site/history): alleen district Antwerpen; bij een parkeerverbod nooit een huisnummer, bij
// een werk de plaats exact maar nooit "verhuis".
//
// De repo is publiek. Een parkeerverbod is vaak een verhuis of een container bij één woning: het huisnummer is dan een
// privéadres. Een werk van GIPOD ("2000 Antwerpen, Xstraat 12", een aansluiting bij één huis) houdt zijn huisnummer:
// besluit van de eigenaar van 18 oktober 2026 (site/works-core.js), de PLAATS mag exact (straat en huisnummer of bereik,
// zoals de bron ze geeft, ook "PROEFSTRAAT 1DN02"), maar niets dat over een persoon of zijn huishouden vertelt. Een tekst
// van een werk met "verhuis" telt daarom als niet gegeven (de titel van een werk zonder omschrijving, een fase met dat
// woord valt weg), de soort inname "(Verhuis)lift/levering" heet "Lift/levering" (werkZonderVerhuis in
// site/works-core.js), en de scan meldt het woord bij een werk (`verhuis`).
// Een werk is een item met een id "work:…" (ook een wijziging van zo'n item). Voor de rest (parkeerverboden en de andere
// items van A-Sign):
// - adressen worden "Straat, 2000 Antwerpen" (zelfde vorm als de live laag in de browser);
// - in vrije tekst valt elk nummer achter een straatnaam weg ("Xstraat 12-14", "Xstraat 3 bus 2",
//   "Xstraat | 12", "Xstraat - 12 - werken", "Xstraat, 12", "Xstraat thv 12"), ook hele reeksen
//   ("12 tem 14", "12, 14 en 16", "12 14 16"), en "huisnummer 12" altijd;
// - A-Sign "District='ANTWERPEN'" is de hele stad: een parkeerverbod telt alleen mee met een
//   postcode van het district (lib/postcodes.mjs);
// - een naam na een dossiercode ("DNW12345678_Voornaam Achternaam LS_…") is een persoon (bv. een
//   werkleider): die valt weg, met dezelfde regel als de kaartjes (naamNaCodeWeg in site/kaart-uitleg.js).
// - de homoniemtoevoeging van de straatas ("2018 ANTWERPEN, PROEFSTRAAT_AN 12" in een titel van GIPOD) is geen deel van de
//   naam: ze valt weg (site/witte-lijst.js), en het huisnummer erachter ook (een straatnaam met toevoeging is een straat).
//   De bronnen geven de naam al zonder toevoeging (gipodTekst, straatasNaam); dit is het vangnet voor wat al bewaard was.
// De verversing (scripts/refresh-live-history.mjs) past dit toe vóór ze vergelijkt en schrijft, en
// scripts/opkuis-historiek-privacy.mjs kuist de bestaande bestanden één keer op. De scan
// (historiekPrivacyBevindingen) gebruikt dezelfde regels: wat de opkuis teruggeeft, is altijd schoon
// (tot er niets meer gevonden wordt, met een vangnet), en opnieuw opkuisen verandert niets.
import crypto from "node:crypto";
import fs from "node:fs";

import { isDistrictPostcode, pointInDistrict } from "./postcodes.mjs";
import { isEenHuis, naamNaCodeWeg, werkFeiten, werkVoorPubliek } from "../site/kaart-uitleg.js";
import { heeftToevoeging, zonderToevoegingInTekst } from "../site/witte-lijst.js";
import { VERHUIS, werkZonderVerhuis } from "../site/works-core.js";

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

// Is deze hele naam een officiële straat van het district? Voor het adres van een werk voor één huis (werkVoorPubliek in
// site/kaart-uitleg.js: "2020 ANTWERPEN, PROEFBROEK" houdt zijn straat, ook zonder gekende uitgang), zoals de grondregel van
// de privacyfilter: een volledige officiële straatnaam is een plek, geen persoon.
export const isOfficieleStraat = (naam) => { const k = vouw(naam); return Boolean(k) && officieleStraten().namen.has(k); };
const PUBLIEK_OPTIES = Object.freeze({ isStraat: isOfficieleStraat });

// Uitgangen van Vlaamse straatnamen. "Havenwegen" eindigt niet op "weg": de uitgang moet het einde
// van het woord zijn.
const STRAATUITGANG = /(?:straat|laan|lei|plein|plaats|weg|dreef|kaai|kade|vest|markt|rui|vliet|dijk|dok|hof|pad|park|singel|brug|berg|baan|gang|poort|wal|oord|veld|steeg|erf|boulevard|square)$/;

function eindigtOpStraat(voor) {
  // "Veldstraat [Antwerpen]", "Berkenlaan (2610)": de toevoeging tussen haakjes telt niet.
  // "PROEFSTRAAT_AN 12": de homoniemtoevoeging telt niet, de straat ervoor wel.
  const tekst = zonderToevoegingInTekst(voor).replace(/(?:\s*[[(][^\])]*[\])])+\s*$/, "");
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

// Stukken met een officiële straatnaam met een cijfer: [begin, einde) in de tekst. Ook voor de
// straatbestanden (lib/straat-bestanden.mjs): "Buurtweg nr 11" is een straat, geen huisnummer.
export function cijferstraatStukken(tekst) {
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

// A-Sign schrijft "Xstraat 26-26 2000 Antwerpen", "Xlaan (2610) 34-hoek 2610 Antwerpen",
// "Ystraat hoek-64 2060 Antwerpen" of "Xstraat 12 bus 3 2000 Antwerpen". Na de opkuis:
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
const VASTE_VELDEN = new Set(["id", "reference", "dossier", "gipodId", "start", "end", "observedAt", "lastAttemptAt", "lastSuccessAt", "digest", "kind", "layer", "type", "status", "streetResolution", "errorCode", "date", "file"]);

// Een werk van GIPOD: een item met een id "work:…" (lib/live-history.mjs, scripts/build-straat-snapshots.mjs), of een werk
// zoals collectWorks het maakt (site/works-core.js: een GIPOD-nummer, geen id en geen soort van A-Sign), dat
// resultaatVoorHistoriek krijgt vóór lib/live-history.mjs er een id aan geeft.
export const isWerkId = (id) => String(id || "").startsWith("work:");
const isWerkItem = (item) => isObject(item) && (isWerkId(item.id) || (!item.id && !item.kind && item.gipodId != null && Number.isFinite(Number(item.gipodId))));

// `werk`: de waarde hoort bij een werk. Dan blijven de huisnummers (de plaats mag exact) en valt "verhuis" weg
// (werkZonderVerhuis, per veld: een tekst, de soort inname, de opdrachtgever); de naam na een dossiercode en de
// homoniemtoevoeging vallen weg zoals bij elk item.
function schoonWaarde(sleutel, waarde, werk = false) {
  if (typeof waarde === "string") {
    if (VASTE_VELDEN.has(sleutel)) return waarde;
    const zonderNaam = naamNaCodeWeg(zonderToevoegingInTekst(waarde));
    if (werk) return werkZonderVerhuis(zonderNaam, sleutel);
    const schoon = sleutel === "location" ? adresAlleenStraat(zonderNaam) : tekstZonderHuisnummers(zonderNaam);
    return tekstMetHuisnummer(sleutel, schoon) ? alleenStraatnaam(sleutel, schoon) : schoon;
  }
  // Bij een werk houdt een lijst de naam van haar veld (occupancyTypes: de soort inname), en een fase met "verhuis" valt
  // eruit (werkZonderVerhuis: zoals een hinderfase zonder omschrijving).
  if (Array.isArray(waarde)) return (werk ? werkZonderVerhuis(waarde, sleutel) : waarde).map((kind) => schoonWaarde(sleutel === "fields" ? "fields" : werk ? sleutel : "", kind, werk));
  if (isObject(waarde)) return itemVoorHistoriek(waarde, { werk });
  return waarde;
}

// Eén item (of de gewijzigde velden van een wijziging) zonder naam na een dossiercode; een parkeerverbod en elk ander
// item zonder huisnummers, een werk (`werk`, of een id "work:…") met zijn huisnummers maar zonder "verhuis", en bij een werk
// voor één huis zonder vrije tekst van de beheerder (werkVoorPubliek in site/kaart-uitleg.js: de titel wordt het adres;
// nakijkronde van head c4bb2927: de regel gold alleen op de kaart, en de historiek hield "Container voor Proefmans,
// Proefstraat 12"). Een wijziging kent alleen haar eigen velden: zij beslist met wat ze heeft (de laag zelf beslist met het
// hele werk).
export function itemVoorHistoriek(item, { werk = false } = {}) {
  if (!isObject(item)) return item;
  const alsWerk = werk || isWerkItem(item);
  const uit = {};
  for (const [sleutel, waarde] of Object.entries(item)) uit[sleutel] = sleutel === "fields" ? waarde : schoonWaarde(sleutel, waarde, alsWerk);
  return alsWerk ? werkVoorPubliek(uit, PUBLIEK_OPTIES) : uit;
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
  // De velden van een wijziging van een werk dragen geen id: het werk is de wijziging zelf.
  const werk = isWerkId(entry.id);
  const before = itemVoorHistoriek(entry.before ?? null, { werk });
  const after = itemVoorHistoriek(entry.after ?? null, { werk });
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

// De overgang van 18 oktober 2026: de historiek van daarvoor bewaarde een werk zonder huisnummer ("2000 Antwerpen,
// Xstraat"), de verversing van nu geeft het met ("2000 Antwerpen, Xstraat 12"). Dat is geen wijziging in GIPOD. Voor de
// vergelijking (lib/live-history.mjs) krijgt een vorig werk daarom de tekst van nu als die zonder huisnummers (de oude
// regel, tekstZonderHuisnummers) precies de vorige tekst is: zo maakt de overgang geen honderden "changed". Een ander
// verschil blijft een wijziging, en na de eerste verversing vergelijkt de historiek gewoon.
export function werkenVoorVergelijking(vorigeLaag, nieuweLaag) {
  if (!Array.isArray(vorigeLaag?.items) || !Array.isArray(nieuweLaag?.items)) return vorigeLaag;
  const nu = new Map(nieuweLaag.items.map((item) => [item?.id, item]));
  let anders = false;
  const items = vorigeLaag.items.map((oud) => {
    const nieuw = isObject(oud) && isWerkId(oud.id) ? nu.get(oud.id) : null;
    if (!nieuw) return oud;
    let item = oud;
    for (const veld of ["title", "owner"]) {
      const a = oud[veld], b = nieuw[veld];
      if (typeof a === "string" && typeof b === "string" && a !== b && tekstZonderHuisnummers(b) === a) { item = { ...item, [veld]: b }; anders = true; }
    }
    return item;
  });
  return anders ? { ...vorigeLaag, items } : vorigeLaag;
}

// Een werk voor één huis dat de historiek al kende, wordt niet onthullender (nakijkronde van head c4bb2927). Main bewaarde zo'n
// werk zonder huisnummer ("2000 ANTWERPEN, PROEFSTRAAT"), soms naast "verhuis" of een naam; wie die stand naast de stand van
// nu legt, zou anders straat, nummer en dag van een verhuis kennen. Is de titel van nu (zoals hij bewaard wordt,
// werkVoorPubliek) de vorige titel met alleen een huisnummer erbij, dan houdt het werk zijn vorige titel: in de historiek, in
// kaart-uitleg.json en in de straatbestanden (scripts/refresh-live-history.mjs geeft deze lijst aan alle drie). Zonder spoor:
// het geldt voor elk werk voor één huis dat al bekend was, niet voor een bepaalde soort. Een ander werk (een publiek project:
// riolering, wegen, tram) krijgt zijn nummer gewoon (werkenVoorVergelijking), en een nieuw werk heeft geen vorige titel.
// Zolang GIPOD de tekst niet wijzigt, blijft het zo; `vorigeLaag`: de werkenlaag van de vorige stand (opgekuist).
export function werkenZoalsBekend(items = [], vorigeLaag = null) {
  if (!Array.isArray(items) || !Array.isArray(vorigeLaag?.items)) return items;
  const bekend = new Map(vorigeLaag.items.filter((w) => isObject(w) && isWerkId(w.id) && typeof w.title === "string").map((w) => [Number(w.gipodId), w.title]));
  return items.map((item) => {
    const vorig = bekend.get(Number(item?.gipodId));
    if (vorig === undefined || typeof item?.title !== "string" || !isEenHuis(werkFeiten(item))) return item;
    const titel = werkVoorPubliek(item, PUBLIEK_OPTIES).title;
    return titel !== vorig && tekstZonderHuisnummers(titel) === vorig ? { ...item, title: vorig } : item;
  });
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
// - huisnummer: een nummer achter een straatnaam, of een cijfer in een adres buiten de postcode; niet bij een werk (een
//   item of wijziging met een id "work:…"): daar mag de plaats exact zijn (besluit van 18 oktober 2026);
// - verhuis: het woord "verhuis" ("verhuislift", "verhuizing" ...) in een tekst van een werk;
// - vrije_tekst: een werk voor één huis met vrije tekst van de beheerder naast het adres (werkVoorPubliek in
//   site/kaart-uitleg.js zou ze weghalen);
// - buiten_district: een parkeerverbod of een straat met een postcode buiten het district;
// - punt_buiten_district: een coördinaat buiten de districtsgrens (lib/district-antwerpen-grens.geojson);
// - naam: een naam na een dossiercode;
// - toevoeging: een homoniemtoevoeging van de straatas ("Proefstraat_AN").
export function historiekPrivacyBevindingen(value, path = "$") {
  const findings = [];
  const visit = (node, at, sleutel, parkeer, werk = false) => {
    if (typeof node === "string") {
      if (VASTE_VELDEN.has(sleutel)) return;
      if (werk && VERHUIS.test(node)) findings.push({ code: "verhuis", path: at });
      if (!werk && tekstMetHuisnummer(sleutel, node)) findings.push({ code: "huisnummer", path: at });
      if (naamNaCodeWeg(node) !== node) findings.push({ code: "naam", path: at });
      if (heeftToevoeging(node)) findings.push({ code: "toevoeging", path: at });
      return;
    }
    if (Array.isArray(node)) {
      if (isBelgischPunt(node)) {
        if (!pointInDistrict(node.slice(0, 2))) findings.push({ code: "punt_buiten_district", path: at });
        return;
      }
      node.forEach((child, index) => visit(child, `${at}[${index}]`, sleutel === "streets" ? "streets" : "", parkeer, werk));
      return;
    }
    if (!isObject(node)) return;
    const binnenWerk = werk || isWerkItem(node);
    const binnenParkeer = parkeer || isParkeerItem(node);
    if (binnenWerk && typeof node.title === "string" && werkVoorPubliek(node, PUBLIEK_OPTIES) !== node) findings.push({ code: "vrije_tekst", path: at });
    if (binnenParkeer && typeof node.location === "string" && parkeerverbodInDistrict(node) === false) findings.push({ code: "buiten_district", path: at });
    if (sleutel === "streets" && typeof node.postcode === "string" && node.postcode && !isDistrictPostcode(node.postcode)) findings.push({ code: "buiten_district", path: at });
    for (const [x, y] of [["x", "y"], ["lon", "lat"], ["lng", "lat"], ["longitude", "latitude"]]) {
      if (Number.isFinite(node[x]) && Number.isFinite(node[y]) && isBelgischPunt([node[x], node[y]]) && !pointInDistrict([node[x], node[y]])) findings.push({ code: "punt_buiten_district", path: at });
    }
    for (const [key, child] of Object.entries(node)) visit(child, `${at}.${key}`, key, binnenParkeer, binnenWerk);
  };
  visit(value, path, "", false);
  return findings;
}
