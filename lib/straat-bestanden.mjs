// Snelheid (P5): de vorm, de grenzen en de privacyscan van de straatbestanden (site/straat/<id>.json,
// site/straat-index.json) en de radar (site/history/radar.json). De bouwer staat in
// scripts/build-straat-snapshots.mjs; scripts/validate-data.mjs kijkt met straatBestandenProblemen() na.
import fs from "node:fs";
import path from "node:path";

import { historiekPrivacyBevindingen } from "./historiek-privacy.mjs";
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
// van een aanvrager of een terrasadres (met huisnummer), en de velden die meteen weg moeten.
export const NOOIT = new Set([
  "point", "vorm", "parcours", "geometry", "description", "address", "aSignSupplement", "lastModified",
  "creator", "assignee", "lockOwner", "dossierBeheerder", "aanvrager", "onderwerp", "Onderwerp",
]);
// Wat er na de opkuis nog privé is: huisnummers en namen (zelfde scan als de historiek), en e-mail,
// telefoon, IBAN, volglinks en verboden velden (zelfde scan als de bronnen). Een bronlink met een
// vraag (de technische link van een vergunning) is geen vondst.
export function straatItemPrivacy(value) {
  return [
    ...historiekPrivacyBevindingen(value),
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
