// Parkeerverboden zonder huisnummer: elke verversing telt waarom (site/sources/parkeer-huisnummers.json).
//
// Regel van de eigenaar (26 oktober 2026, site/adres-privacy.js): een parkeerverbod staat er altijd met zijn exacte
// huisnummer, ook bij een verhuis; nooit de reden, het woord verhuis of een naam.
//
// Meting van 13 november 2026 (alleen gelezen): van de 2.378 bewaarde parkeerverboden stonden er 339 zonder huisnummer.
// Naast laag 20 van A-Sign gelegd: bij elk van de 328 die nog in de bron stonden, schrijft de stad zelf "0-0" waar het
// nummer hoort ("Proefstraat 0-0 2000 Antwerpen", verzonnen straat); de 11 andere waren al uit de actieve laag. De keten
// verloor er geen enkel: 2.352 van de 2.352 plaatsen kwamen er opnieuw precies zo uit. Het verlies zat vroeger: tot 26
// oktober 2026 bewaarde de historiek alleen de straat (docs/AGENDA_VERLEDEN.md).
//
// De bewaarde stand kan dat niet zelf zeggen: het adres van de bron staat nergens in de repo (de repo is publiek en
// bewaart alleen de plaats in de publieke vorm). Daarom telt de verversing het op het moment dat ze de bron leest, en
// bewaart ze alleen codes en aantallen: nooit een straat, een nummer, een dossier, een reden of een naam.
// De codes en de vorm van het bestand staan in lib/parkeer-huisnummers-validatie.mjs (zonder imports uit site/, zodat
// validate-data, de bouw en de bronstatus het bestand kunnen lezen zonder de modules van de site).
import fs from "node:fs";
import path from "node:path";

import { isParkeerItem } from "./parkeer-historiek.mjs";
import { EIGEN_VERLIES, PARKEER_HUISNUMMERS_FILE, PARKEER_HUISNUMMERS_SCHEMA, REDENEN, validateParkeerHuisnummers } from "./parkeer-huisnummers-validatie.mjs";
import { adresZonderHuisnummer, isPubliekParkeerAdres, noemtVerhuis, publiekParkeerAdres } from "../site/adres-privacy.js";
import { PUBLIC_PARKING_STATUSES, parkingKey } from "../site/public-space-core.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);

// Waarom staat een parkeerverbod met dit adres van de bron zonder huisnummer in wat bewaard wordt? Alleen een code uit
// REDENEN.
// `straatnamen`: de officiële straatnamen (site/geo/straten.json), zodat een straatnaam met een cijfer ("De 7
// schakenpad") niet als nummer telt.
export function redenZonderNummer(bronAdres, straatnamen = null) {
  const raw = clean(bronAdres).slice(0, 220);
  // A-Sign schrijft "<straat> <van>-<tot> <postcode> <gemeente>".
  const m = /^(.*?)\s+(\d{4})\s+([^\d]+)$/.exec(raw);
  if (!m) return "bron_onbekend";
  // Wat tussen de straat en de postcode staat, is het nummer van de bron (zoals publiekParkeerAdres het leest).
  const schoon = /^(.+), (\d{4}) (.+)$/.exec(adresZonderHuisnummer(raw, straatnamen));
  const slot = schoon && m[1].toLowerCase().startsWith(schoon[1].toLowerCase()) ? m[1].slice(schoon[1].length) : m[1];
  // "0-0", "00-00", "Onbekend-Onbekend", "hoek-hoek", "(2018) 0-0" of niets: de bron heeft geen nummer.
  if (!/[1-9]/.test(slot.replace(/\(\d{4}\)/g, " "))) return "bron_zonder_nummer";
  if (noemtVerhuis(raw)) return "verboden_woord";
  // De regel maakt er wel een plaats met het nummer van: dan viel het nummer later weg (de privacylaag of de opslag).
  if (publiekParkeerAdres(raw, adresZonderHuisnummer(raw, straatnamen), straatnamen)) return "niet_bewaard";
  // Zonder de lijst van officiële straten wel een plaats: dan lag het aan de straat, niet aan de vorm van het nummer.
  return publiekParkeerAdres(raw, adresZonderHuisnummer(raw, null), null) ? "straat_niet_officieel" : "vorm_niet_herkend";
}

// De telling van één verversing. `items`: de parkeerverboden zoals ze bewaard worden (de publieke-ruimtelaag van de
// historiek); `parkingFeatures`: de rijen van laag 20 van dezelfde verversing (alleen in het geheugen, ze komen nooit in
// een bestand). Puur: geen bestanden, geen klok.
export function telParkeerHuisnummers({ items = [], parkingFeatures = [], straatnamen = null, observedAt } = {}) {
  const adressen = new Map();
  for (const feature of Array.isArray(parkingFeatures) ? parkingFeatures : []) {
    const rij = isObject(feature?.attributes) ? feature.attributes : feature;
    const sleutel = parkingKey(rij);
    if (!sleutel || !PUBLIC_PARKING_STATUSES.has(clean(rij?.Status))) continue;
    if (!adressen.has(sleutel)) adressen.set(sleutel, []);
    adressen.get(sleutel).push(rij.Adres);
  }
  const redenen = Object.fromEntries(REDENEN.map((reden) => [reden, 0]));
  let totaal = 0;
  let metNummer = 0;
  for (const item of Array.isArray(items) ? items : []) {
    if (!isParkeerItem(item)) continue;
    totaal += 1;
    if (isPubliekParkeerAdres(item.location, straatnamen)) {
      metNummer += 1;
      continue;
    }
    const gevonden = (adressen.get(String(item.id).slice("parking:".length)) ?? []).map((adres) => redenZonderNummer(adres, straatnamen));
    // Eén rij met een nummer dat we niet bewaren, telt als eigen verlies, ook als een andere rij er geen had.
    redenen[EIGEN_VERLIES.find((reden) => gevonden.includes(reden)) ?? (gevonden.includes("bron_zonder_nummer") ? "bron_zonder_nummer" : "bron_onbekend")] += 1;
  }
  return { schemaVersion: PARKEER_HUISNUMMERS_SCHEMA, observedAt, totaal, metNummer, zonderNummer: totaal - metNummer, redenen };
}

// Schrijft de telling; een ongeldige telling wordt niet geschreven (validate-data zou de verversing tegenhouden).
export function schrijfParkeerHuisnummers({ rootDir, document }) {
  const fouten = validateParkeerHuisnummers(document);
  if (fouten.length) throw new Error(`parkeer-huisnummers ongeldig: ${fouten[0]}`);
  const file = path.join(rootDir, "site", "sources", PARKEER_HUISNUMMERS_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return file;
}
