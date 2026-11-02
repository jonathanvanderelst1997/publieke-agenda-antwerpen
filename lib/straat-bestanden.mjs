// Snelheid (P5): de vorm, de grenzen en de privacyscan van de straatbestanden (site/straat/<id>.json,
// site/straat-index.json) en de radar (site/history/radar.json). De bouwer staat in
// scripts/build-straat-snapshots.mjs; scripts/validate-data.mjs kijkt met straatBestandenProblemen() na.
import fs from "node:fs";
import path from "node:path";

import { cijferstraatStukken, historiekPrivacyBevindingen, isWerkId } from "./historiek-privacy.mjs";
import { liveLaagGezondheid } from "./live-history.mjs";
import { privacyFindings } from "./source-feed.mjs";
import { WERF_DOSSIER } from "../site/works-core.js";
import { EVENEMENT_SLEUTEL } from "../site/adres-privacy.js";

export const STRAAT_SCHEMA = 1;
export const STRAAT_MAP = "site/straat";
export const STRAAT_INDEX = "site/straat-index.json";
export const RADAR_BESTAND = "site/history/radar.json";
export const BRONNEN_BESTAND = ".cache/straat-bronnen.json";
// Budgetten (toetsen en validate-data): een straatbestand blijft onder 100 kB, de radar onder 50 kB.
export const MAX_STRAAT_BYTES = 100_000;
export const MAX_RADAR_BYTES = 50_000;
// De radar toont "laatste 7 dagen" vanaf nu; nu ligt na de verversing, dus 7 dagen vóór de verversing
// is genoeg (street-overview.js laat ook dan wat ouder is dan 7 dagen weg).
export const RADAR_DAGEN = 7;
// De lagen in een straatbestand, met de naam van de live laag in de browser (window.PUBLIC_AGENDA_LIVE_STREETS).
export const STRAAT_LAGEN = Object.freeze([
  ["werken", "works"],
  ["publiekeRuimte", "publicSpace"],
  ["vergunningen", "permits"],
  ["terrassen", "terraces"],
]);
// Krimp: een laag met minstens zoveel items die meer dan de helft verliest, houdt de vorige stand.
export const KRIMP_MINIMUM = 20;
export const KRIMP_MAX_VERLIES = 0.5;

const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);

// Velden die nooit in een straatbestand komen: een precieze plek (punt, vorm, parcourslijn), vrije tekst
// van een aanvrager of een terrasadres (met huisnummer), en de velden die meteen weg moeten. Ook het kenmerk van een
// inname niet (vaste woorden, site/kaart-uitleg.js): een straatbestand had nooit een omschrijving, en zo blijft de soort op
// de plekpagina die van origin/main (die komt dan uit de bewaarde kenmerken van kaart-uitleg.json). En nooit de reden
// van een parkeerverbod (`reason`): waar en wanneer wel, waarom nooit (site/adres-privacy.js); de scan meldt ook een
// parkeerverbod met een andere titel dan "Parkeerverbod" (historiekPrivacyBevindingen, code `reden`).
export const NOOIT = new Set([
  "point", "vorm", "parcours", "geometry", "description", "kenmerk", "address", "aSignSupplement", "lastModified",
  "creator", "assignee", "lockOwner", "dossierBeheerder", "aanvrager", "onderwerp", "Onderwerp", "reason",
]);
// Het adres van een terras (A-Sign) of van het perceel van een vergunning (adressenVoorVergunningen in
// site/permits-live-core.js) bewaart een straatbestand wel, met huisnummer (regel van de eigenaar van 26 oktober 2026: ook in de
// ochtendstand het exacte adres), maar alleen in de vorm "Straat 12", "Straat 12-14", "Straat 12–16 en Andere Straat 3": een
// straatnaam (letters, geen cijfer) met haar nummer, nooit een naam, een busnummer of een toevoeging ("(zijde ...)" valt
// weg). De straat moet een officiële straat van het district zijn (site/geo/straten.json): zo kan er nooit een naam vóór staan.
// De lagen waarin dat mag, en de vorm.
export const ADRES_LAGEN = Object.freeze(["terrassen", "vergunningen"]);
const ADRES_DEEL = /^([\p{L}][\p{L}\p{M}'’. -]*[\p{L}.]) [1-9]\d{0,3}[A-Za-z]{0,2}(?:[-–/][1-9]\d{0,3}[A-Za-z]{0,2}){0,4}$/u;
const vouw = (value) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
// De sleutel van een straatnaam zonder spaties, streepjes, punten en apostrofs: "Proef straat" is "Proefstraat",
// "Oudeproefmarkt" is "Oude Proefmarkt" (nakijkronde van head 533ac5f4: zo'n schrijfwijze van A-Sign gooide het hele adres
// weg; verzonnen straten).
const sleutel = (value) => vouw(value).replace(/[\s.'’-]+/g, "");
// Eén letter verschil telt alleen bij een naam van minstens tien letters, en alleen als er precies één officiële straat zo dichtbij ligt
// ("Sint-Proefgoniskaai" voor "Sint-Proefgondiskaai").
function eenLetterVerschil(a, b) {
  if (Math.abs(a.length - b.length) > 1 || a === b) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  const ra = a.slice(i), rb = b.slice(i);
  return ra.slice(1) === rb.slice(1) || ra.slice(1) === rb || ra === rb.slice(1);
}
let officieel;
// De officiële schrijfwijze van een straat van de stad (site/geo/straten.json en de andere districten in
// site/geo/straten-stad.json: een perceel of terras op de districtsgrens), of "" als het geen straat is.
function officieleNaam(naam) {
  if (officieel === undefined) {
    officieel = new Map();
    const lees = (rel) => { try { return JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), "utf8")); } catch { return null; } };
    const district = lees("../site/geo/straten.json");
    for (const rij of Array.isArray(district?.streets) ? district.streets : []) if (rij?.[1] && !officieel.has(sleutel(rij[1]))) officieel.set(sleutel(rij[1]), String(rij[1]));
    const stad = lees("../site/geo/straten-stad.json");
    for (const rij of Array.isArray(stad?.straten) ? stad.straten : []) if (rij?.[0] && !officieel.has(sleutel(rij[0]))) officieel.set(sleutel(rij[0]), String(rij[0]));
  }
  const k = sleutel(naam);
  if (!k) return "";
  if (officieel.has(k)) return officieel.get(k);
  // Zonder lidwoord vooraan ("Proefplein" voor "De Proefplein").
  for (const lidwoord of ["de", "het"]) if (officieel.has(`${lidwoord}${k}`)) return officieel.get(`${lidwoord}${k}`);
  if (k.length < 10) return "";
  const dicht = [...officieel.keys()].filter((o) => o[0] === k[0] && eenLetterVerschil(k, o));
  return dicht.length === 1 ? officieel.get(dicht[0]) : "";
}
// `isStraat`: is dit een officiële straat (een toets geeft haar eigen verzonnen straten; dan blijft de schrijfwijze). Zonder:
// de officiële straten van de stad, en dan staat de officiële schrijfwijze in het adres. Eerst opgekuist: een busnummer valt
// weg ("Proefstraat 46 bus A" is "Proefstraat 46"), een losse letter hoort bij het nummer ("95 A" is "95A"), en leestekens
// op het einde vallen weg (nakijkronde van head 533ac5f4: 50 van de 1777 terrassen verloren zo hun adres).
export function straatAdres(tekst, { isStraat = null } = {}) {
  const naamVan = isStraat ? (naam) => (isStraat(naam) ? naam : "") : officieleNaam;
  const schoon = String(tekst ?? "").replace(/\s*\([^)]*\)/g, " ").replace(/(\p{L})(\d)/gu, "$1 $2")
    .replace(/(\d)\s*\bbus\b\s*[\p{L}\d-]+/giu, "$1").replace(/(\d)\s*bus\s*[\p{L}\d-]+/giu, "$1")
    .replace(/\s*([-–/])\s*/g, "$1").replace(/(\d) ([A-Za-z])(?![\p{L}\d])/gu, "$1$2")
    .replace(/\s+/g, " ").replace(/[\s,.;:]+$/u, "").trim();
  if (!schoon || schoon.length > 120) return "";
  const geldig = (deel) => {
    const m = deel.match(ADRES_DEEL);
    if (!m || /\bbus\b/i.test(deel)) return "";
    const naam = naamVan(m[1]);
    return naam ? `${naam}${deel.slice(m[1].length)}` : "";
  };
  const een = geldig(schoon);
  if (een) return een;
  // Twee straten met " en " ertussen; een straatnaam kan zelf " en " hebben ("Xstraat en Ystraatlei 11").
  for (let i = schoon.indexOf(" en "); i > 0; i = schoon.indexOf(" en ", i + 1)) {
    const a = geldig(schoon.slice(0, i)), b = a && geldig(schoon.slice(i + 4));
    if (a && b) return `${a} en ${b}`;
  }
  return "";
}
// Een straatbestand zonder de geldige adressen van terrassen en vergunningen, voor de privacyscan (die een nummer na een
// straatnaam zoekt): elders blijft elk huisnummer een vondst.
export function zonderGeldigeAdressen(doc) {
  if (!isObject(doc)) return doc;
  const uit = { ...doc };
  for (const laag of ADRES_LAGEN) {
    if (!Array.isArray(doc[laag])) continue;
    uit[laag] = doc[laag].map((item) => (isObject(item) && item.address && straatAdres(item.address) === item.address ? { ...item, address: "" } : item));
  }
  return uit;
}
// Het enige verband van een parkeerverbod met waarvoor het is, dat een straatbestand bewaart: het dossiernummer van zijn
// werfzone (`werfzoneDossier`, parkeerverbodenAanWerfzone in site/place-core.js; de werfkaart toont dat verband ook). Alleen
// dat patroon ("GW2026-001601") en alleen bij een parkeerverbod: nooit vrije tekst of een reden in dat veld.
export const geldigWerfzoneDossier = (item) => (item?.kind === "parking" || String(item?.id || "").startsWith("parking:"))
  && typeof item?.werfzoneDossier === "string" && WERF_DOSSIER.test(item.werfzoneDossier);
// Net zo bij een evenement: alleen de sleutel van het evenement waar de verversing het parkeerverbod bij vond
// (`evenementSleutel`, parkeerverbodenAanEvenement in site/place-core.js): een evenementendossier ("ET2099000001") of een
// agendapunt ("agenda:<id>"), alleen bij een parkeerverbod. Nooit vrije tekst of een reden.
export const geldigEvenementSleutel = (item) => (item?.kind === "parking" || String(item?.id || "").startsWith("parking:"))
  && typeof item?.evenementSleutel === "string" && EVENEMENT_SLEUTEL.test(item.evenementSleutel);
// Het verband van een parkeerverbod in een straatbestand (waarbij het hoort, nooit waarom), veld per veld met zijn nakijk.
// Eén lijst voor elke plek waar een rij geschreven of nagekeken wordt: itemVoorStraat laat een ongeldige waarde weg,
// straatBestandenProblemen (validate-data) meldt ze, en een bundelrij (de andere straten van hetzelfde parkeerverbod,
// BUNDEL_VELDEN in scripts/build-straat-snapshots.mjs) draagt elk veld mee. Derde nakijkronde van 18 oktober 2026: die
// velden stonden apart in elke plek, en zonder `werfzoneDossier` op de bundelrij verloor de ochtendstand ongeveer de
// helft van de koppelingen met een werfzone (parkeerverbodVoorWerf eist het dossier op elke rij), zonder dat een toets
// het merkte. Een nieuw verband komt hier, en dan overal.
export const PARKEERVERBOD_VERBAND = Object.freeze({
  werfzoneDossier: Object.freeze({ geldig: geldigWerfzoneDossier, melding: "geen dossiernummer van een werfzone bij een parkeerverbod" }),
  evenementSleutel: Object.freeze({ geldig: geldigEvenementSleutel, melding: "geen sleutel van een evenement bij een parkeerverbod" }),
});
// ---------- een nummer na "gevel", "pand", "nummer" ----------

// Vrije tekst van een beheerder (de omschrijving van een GIPOD-hinderfase) noemt soms een huisnummer
// zonder straatnaam ervoor: "stelling aan gevel nummer 12", "pand nr. 5", "woning 7b", "nummer 12-14",
// "thv 15", "ter hoogte van 15", "tegenover 8", "voor de deur van 23", "appartement 5", "nr°45",
// "nummer 12 bus 3". Samen met de straat van het bestand is dat een adres. De scan van de historiek ziet
// dat niet (die zoekt een nummer na een straatnaam). Het woord blijft staan ("aan gevel"), het nummer valt
// weg. Een officiële straatnaam met een cijfer ("Buurtweg nr 11") blijft heel, net als een postcode na een
// komma ("nr. 12, 2000 Antwerpen": alleen "nr. 12" valt weg) en een buslijn ("bus 30" zonder huisnummer
// ervoor) of tramlijn ("lijn 4"). Niet bij een werk (id "work:<GIPOD-id>"): dat staat er met zijn exacte adres (regel van
// de eigenaar van 26 oktober 2026, lib/historiek-privacy.mjs).
const PANDNUMMER = /(?<![\p{L}\d])(?:(?<woord>gevels?|panden|pand|woningen|woning|huizen|huis|thv|t\.h\.v\.|ter hoogte van|tegenover|naast|voor de deur van|appartementen|appartement|app\.)\s+(?:(?:huis)?(?:nummers?|nrs?°?|n°)\.?\s*)?|(?:huis)?(?:nummers?|nrs?°?|n°)\.?\s*)\d{1,4}[a-z]{0,3}(?:\s*(?:-|–|\/|en|tot|t\/m|tem)\s*\d{1,4}[a-z]{0,3}|\s*,\s*(?!2\d{3}(?![\p{L}\d]))\d{1,4}[a-z]{0,3}|\s+bus\s+\d{1,4}[a-z]{0,3})*(?![\p{L}\d])/giu;
// Velden die nooit vrije tekst zijn (ids, datums, links, straten uit de officiële lijst).
const GEEN_VRIJE_TEKST = new Set(["id", "reference", "gipodId", "start", "end", "status", "kind", "sourceUrl", "sourceUrls", "dossier", "project", "date", "endDate", "ververst", "inhoud", "kader", "straat", "straten", ...["streets", "werfzoneStreets", "omleidingStreets"]]);

// [begin, einde, woord] van elk zo'n nummer in `tekst`.
export function pandnummerStukken(tekst) {
  const waarde = String(tekst ?? "");
  if (!/\d/.test(waarde)) return [];
  const beschermd = cijferstraatStukken(waarde);
  const stukken = [];
  for (const match of waarde.matchAll(PANDNUMMER)) {
    const begin = match.index, einde = begin + match[0].length;
    if (beschermd.some(([a, b]) => begin < b && einde > a)) continue;
    stukken.push([begin, einde, match.groups.woord || ""]);
  }
  return stukken;
}
// Herhaalt tot er niets meer gevonden wordt (elke ronde haalt minstens één cijfer weg).
export function zonderPandnummers(tekst) {
  let uit = String(tekst ?? "");
  for (let stukken = pandnummerStukken(uit); stukken.length; stukken = pandnummerStukken(uit)) {
    for (const [begin, einde, woord] of stukken.reverse()) uit = `${uit.slice(0, begin)}${woord}${uit.slice(einde)}`;
    uit = uit.replace(/\s+([,.;:)\]])/g, "$1").replace(/\(\s*\)/g, "").replace(/\s{2,}/g, " ").trim();
  }
  return uit;
}
// Een item (diep) zonder zo'n nummer in zijn vrije tekst; een werk blijft zoals het is.
export function itemZonderPandnummers(value, sleutel = "") {
  if (typeof value === "string") return GEEN_VRIJE_TEKST.has(sleutel) ? value : zonderPandnummers(value);
  if (Array.isArray(value)) return GEEN_VRIJE_TEKST.has(sleutel) ? value : value.map((kind) => itemZonderPandnummers(kind, ""));
  if (!isObject(value) || isWerkId(value.id)) return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, GEEN_VRIJE_TEKST.has(k) ? v : itemZonderPandnummers(v, k)]));
}
function pandnummerBevindingen(value, at = "$", sleutel = "") {
  if (GEEN_VRIJE_TEKST.has(sleutel)) return [];
  if (typeof value === "string") return pandnummerStukken(value).length ? [{ code: "huisnummer", path: at }] : [];
  if (Array.isArray(value)) return value.flatMap((kind, i) => pandnummerBevindingen(kind, `${at}[${i}]`, ""));
  if (!isObject(value) || isWerkId(value.id)) return [];
  return Object.entries(value).flatMap(([k, v]) => pandnummerBevindingen(v, `${at}.${k}`, k));
}

// Wat er na de opkuis nog privé is: huisnummers (buiten een werk) en namen (zelfde scan als de historiek), een nummer na
// "gevel", "pand" of "nummer" (hierboven, buiten een werk), en e-mail, telefoon, IBAN, volglinks en verboden velden (zelfde
// scan als de bronnen). Een bronlink met een vraag (de technische link van een vergunning) is geen vondst.
export function straatItemPrivacy(value) {
  return [
    ...historiekPrivacyBevindingen(value),
    ...pandnummerBevindingen(value),
    ...privacyFindings(value).filter((vondst) => vondst.code !== "url_query"),
  ];
}

export const aantalItems = (doc) => [...STRAAT_LAGEN.map(([n]) => n), "evenementen"].reduce((som, naam) => som + (Array.isArray(doc?.[naam]) ? doc[naam].length : 0), 0);

function leesJson(bestand) {
  try {
    return JSON.parse(fs.readFileSync(bestand, "utf8"));
  } catch {
    return null;
  }
}

// ---------- nakijken ----------

// Velden die nooit in een straatbestand mogen staan, ook niet leeg (een punt of vorm wijst een plek aan). Een adres alleen bij een
// terras of een vergunning, en alleen in de vorm van straatAdres.
const NOOIT_IN_BESTAND = new Set([...NOOIT].filter((veld) => veld !== "address"));
// Problemen in site/straat/, site/straat-index.json en site/history/radar.json: vorm, grootte, privacy.
// Alleen paden en codes, nooit een waarde (de logs zijn publiek). Zonder index (nog geen verversing met
// straatbestanden): niets na te kijken.
export function straatBestandenProblemen(rootDir) {
  const problemen = [];
  const radar = path.join(rootDir, RADAR_BESTAND);
  if (fs.existsSync(radar) && fs.statSync(radar).size > MAX_RADAR_BYTES) problemen.push(`${RADAR_BESTAND}: groter dan ${MAX_RADAR_BYTES} bytes`);
  const indexBestand = path.join(rootDir, STRAAT_INDEX);
  if (!fs.existsSync(indexBestand)) return problemen;
  const index = leesJson(indexBestand);
  if (!isObject(index) || index.schemaVersion !== STRAAT_SCHEMA || !isObject(index.straten) || !Number.isFinite(Date.parse(index.ververst || ""))) return [...problemen, `${STRAAT_INDEX}: ongeldige vorm`];
  const map = path.join(rootDir, STRAAT_MAP);
  const bestanden = new Set(fs.existsSync(map) ? fs.readdirSync(map) : []);
  for (const naam of bestanden) if (!/^\d+\.json$/.test(naam)) problemen.push(`${STRAAT_MAP}/${naam}: onverwacht bestand`);
  for (const [id, hash] of Object.entries(index.straten)) {
    const relatief = `${STRAAT_MAP}/${id}.json`;
    if (!bestanden.has(`${id}.json`)) { problemen.push(`${relatief}: ontbreekt (staat in de index)`); continue; }
    const tekst = fs.readFileSync(path.join(map, `${id}.json`), "utf8");
    if (Buffer.byteLength(tekst) > MAX_STRAAT_BYTES) problemen.push(`${relatief}: groter dan ${MAX_STRAAT_BYTES} bytes`);
    let doc;
    try { doc = JSON.parse(tekst); } catch { problemen.push(`${relatief}: geen geldige JSON`); continue; }
    if (doc?.inhoud !== hash) problemen.push(`${relatief}: hash wijkt af van de index`);
    if (!aantalItems(doc)) problemen.push(`${relatief}: geen items`);
    for (const vondst of straatItemPrivacy(zonderGeldigeAdressen(doc))) problemen.push(`${relatief}: privacy ${vondst.code} op ${vondst.path}`);
    for (const [laag] of [...STRAAT_LAGEN, ["evenementen"]]) {
      (Array.isArray(doc?.[laag]) ? doc[laag] : []).forEach((item, i) => {
        for (const veld of Object.keys(item || {})) if (NOOIT_IN_BESTAND.has(veld) || veld.startsWith("__")) problemen.push(`${relatief}: veld ${veld} op $.${laag}[${i}]`);
        if (item?.address && !(ADRES_LAGEN.includes(laag) && straatAdres(item.address) === item.address)) problemen.push(`${relatief}: adres op $.${laag}[${i}]`);
        for (const [veld, { geldig, melding }] of Object.entries(PARKEERVERBOD_VERBAND)) if (item && veld in item && !geldig(item)) problemen.push(`${relatief}: ${veld} ${melding} op $.${laag}[${i}]`);
      });
    }
  }
  for (const naam of bestanden) if (/^\d+\.json$/.test(naam) && !(naam.slice(0, -5) in index.straten)) problemen.push(`${STRAAT_MAP}/${naam}: niet in de index`);
  return problemen;
}

// ---------- stand voor sources:health ----------

// Ouder dan dit: de straatbestanden zijn niet meer van de laatste ochtendverversing (die draait elke dag).
export const STRAAT_MAX_UUR = 26;
// Eén regel, de waarschuwingen en de fouten voor scripts/sources-health.mjs. Per laag dezelfde regel als de historiek
// (liveLaagGezondheid in lib/live-history.mjs, ook in de job source-health): een laag op "stale" (de straatbestanden
// houden dan de vorige stand) met een stand van hoogstens 48 uur is een waarschuwing; geen stand, of een oudere, is
// een fout (rood, en dan het alarm-issue). Een bouw die al meer dan een dag niet meer lukte, is een waarschuwing. De
// plekpagina zegt bezoekers niet dat een laag faalt (besluit van 18-10-2026): dit is het signaal voor de eigenaar.
export function straatIndexStand(index, { at = Date.now(), maxUur = STRAAT_MAX_UUR } = {}) {
  if (!index) return { regel: "straatbestanden\tnog niet gebouwd\twacht op de eerste verversing met straatbestanden", waarschuwingen: [], fouten: [] };
  if (!isObject(index) || !isObject(index.straten)) return { regel: "straatbestanden\tongeldig\tsite/straat-index.json", waarschuwingen: ["straatbestanden: site/straat-index.json is ongeldig"], fouten: [] };
  const waarschuwingen = [];
  const fouten = [];
  const lagen = Object.entries(isObject(index.lagen) ? index.lagen : {});
  for (const [naam, laag] of lagen) {
    const gezondheid = liveLaagGezondheid({ status: laag?.status, sinds: laag?.sinds }, { at });
    if (gezondheid === "ok") continue;
    if (gezondheid === "error") {
      fouten.push([`straatbestanden:${naam}`, "error", `status=${laag?.status || "-"}`, `sinds=${laag?.sinds || "-"}`, `errorCode=${laag?.errorCode || "-"}`].join("\t"));
      continue;
    }
    waarschuwingen.push(`straatbestanden: laag ${naam} op "${laag?.status || "onbekend"}"${laag?.sinds ? ` (stand van ${laag.sinds})` : ""}${laag?.errorCode ? `, errorCode=${laag.errorCode}` : ""}`);
  }
  const ververst = Date.parse(index.ververst || "");
  const uur = Number.isFinite(ververst) ? (at - ververst) / 3_600_000 : Infinity;
  if (!(uur <= maxUur)) waarschuwingen.push(`straatbestanden: laatste bouw ${Number.isFinite(ververst) ? `${Math.floor(uur)} uur geleden` : "onbekend"} (meer dan ${maxUur} uur): kijk de stap build:straten in de verversing na`);
  const status = fouten.length ? "fout" : waarschuwingen.length ? "let op" : "ok";
  const regel = ["straatbestanden", status, `straten=${Object.keys(index.straten).length}`, ...lagen.map(([naam, laag]) => `${naam}=${laag?.status || "-"}`), `ververst=${index.ververst || "-"}`].join("\t");
  return { regel, waarschuwingen, fouten };
}
