// Snelheid (P5): de vorm, de grenzen en de privacyscan van de straatbestanden (site/straat/<id>.json,
// site/straat-index.json) en de radar (site/history/radar.json). De bouwer staat in
// scripts/build-straat-snapshots.mjs; scripts/validate-data.mjs kijkt met straatBestandenProblemen() na.
import fs from "node:fs";
import path from "node:path";

import { cijferstraatStukken, historiekPrivacyBevindingen } from "./historiek-privacy.mjs";
import { liveLaagGezondheid } from "./live-history.mjs";
import { privacyFindings } from "./source-feed.mjs";

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
// de plekpagina die van origin/main (die komt dan uit de bewaarde kenmerken van kaart-uitleg.json).
export const NOOIT = new Set([
  "point", "vorm", "parcours", "geometry", "description", "kenmerk", "address", "aSignSupplement", "lastModified",
  "creator", "assignee", "lockOwner", "dossierBeheerder", "aanvrager", "onderwerp", "Onderwerp",
]);
// ---------- een nummer na "gevel", "pand", "nummer" ----------

// Vrije tekst van een beheerder (de omschrijving van een GIPOD-hinderfase) noemt soms een huisnummer
// zonder straatnaam ervoor: "stelling aan gevel nummer 12", "pand nr. 5", "woning 7b", "nummer 12-14",
// "thv 15", "ter hoogte van 15", "tegenover 8", "voor de deur van 23", "appartement 5", "nr°45",
// "nummer 12 bus 3". Samen met de straat van het bestand is dat een adres. De scan van de historiek ziet
// dat niet (die zoekt een nummer na een straatnaam). Het woord blijft staan ("aan gevel"), het nummer valt
// weg. Een officiële straatnaam met een cijfer ("Buurtweg nr 11") blijft heel, net als een postcode na een
// komma ("nr. 12, 2000 Antwerpen": alleen "nr. 12" valt weg) en een buslijn ("bus 30" zonder huisnummer
// ervoor) of tramlijn ("lijn 4").
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
// Een item (diep) zonder zo'n nummer in zijn vrije tekst.
export function itemZonderPandnummers(value, sleutel = "") {
  if (typeof value === "string") return GEEN_VRIJE_TEKST.has(sleutel) ? value : zonderPandnummers(value);
  if (Array.isArray(value)) return GEEN_VRIJE_TEKST.has(sleutel) ? value : value.map((kind) => itemZonderPandnummers(kind, ""));
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, GEEN_VRIJE_TEKST.has(k) ? v : itemZonderPandnummers(v, k)]));
}
function pandnummerBevindingen(value, at = "$", sleutel = "") {
  if (GEEN_VRIJE_TEKST.has(sleutel)) return [];
  if (typeof value === "string") return pandnummerStukken(value).length ? [{ code: "huisnummer", path: at }] : [];
  if (Array.isArray(value)) return value.flatMap((kind, i) => pandnummerBevindingen(kind, `${at}[${i}]`, ""));
  if (!isObject(value)) return [];
  return Object.entries(value).flatMap(([k, v]) => pandnummerBevindingen(v, `${at}.${k}`, k));
}

// Wat er na de opkuis nog privé is: huisnummers en namen (zelfde scan als de historiek), een nummer na
// "gevel", "pand" of "nummer" (hierboven), en e-mail, telefoon, IBAN, volglinks en verboden velden (zelfde
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

// Velden die nooit in een straatbestand mogen staan, ook niet leeg (een punt of vorm wijst een plek aan).
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
    for (const vondst of straatItemPrivacy(doc)) problemen.push(`${relatief}: privacy ${vondst.code} op ${vondst.path}`);
    for (const [laag] of [...STRAAT_LAGEN, ["evenementen"]]) {
      (Array.isArray(doc?.[laag]) ? doc[laag] : []).forEach((item, i) => {
        for (const veld of Object.keys(item || {})) if (NOOIT_IN_BESTAND.has(veld) || veld.startsWith("__")) problemen.push(`${relatief}: veld ${veld} op $.${laag}[${i}]`);
        if (item?.address) problemen.push(`${relatief}: adres op $.${laag}[${i}]`);
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
