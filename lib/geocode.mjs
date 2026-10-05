// Geocodering van agendalocaties bij het verversen (nooit in de browser).
// Bron: de Geolocation-API van Digitaal Vlaanderen (Basisregisters Vlaanderen: adressen en
// straatnamen). Er gaat alleen de publieke locatietekst van een agendapunt naartoe, en een
// antwoord telt alleen als de straatnaam (en het huisnummer, als er een is) letterlijk in die
// locatietekst staat. Een plaats zonder straat ("Bib Permeke", "Toeristisch centrum") krijgt geen
// punt: die verschijnt op de site in de lijst "zonder vaste plek", nooit als gegokte marker.
import { CITY_POSTCODES, postcodesInText } from "./postcodes.mjs";
import { locationKey } from "../site/neighborhood-core.js";

export const GEOLOCATION_URL = "https://geo.api.vlaanderen.be/geolocation/v4/Location";
export const GEO_SOURCE = Object.freeze({
  text: "Coördinaten: Geolocation-API van Digitaal Vlaanderen (Basisregisters Vlaanderen, Modellicentie Gratis Hergebruik v1.0)",
  url: GEOLOCATION_URL,
});
// Ruim kader rond de stad Antwerpen (alle districten, ook Linkeroever en de haven).
export const CITY_BBOX = Object.freeze([4.2, 51.13, 4.52, 51.38]);
const citySet = new Set(CITY_POSTCODES);
const VAGUE = /(locatie via de officiele bron|exacte ligging volgens gipod|^district |^stad antwerpen|^online|^digitaal)/;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const has = (haystack, needle) => Boolean(needle) && ` ${haystack} `.includes(` ${needle} `);

// Welke zoekvragen een locatietekst oplevert: elk deel tussen komma's, streepjes, haakjes of "en"
// dat een woord bevat. Delen met een huisnummer eerst, hoogstens 3 delen. Per deel eerst met postcode;
// daarna zonder (relaxed), want een straat over twee postcodes ("Desguinlei") staat in het
// adressenregister maar onder één ervan.
export function geocodeQueries(location, postcodes = []) {
  const text = clean(location);
  const key = locationKey(text);
  if (!key || VAGUE.test(key)) return [];
  const postcode = postcodesInText(text)[0] || (postcodes || []).find((p) => citySet.has(String(p))) || "";
  const parts = text
    .split(/,|\s[-–]\s|\(|\)|\ben\b|\bter hoogte van\b|\bhoek\b/i)
    .map((part) => clean(part.replace(/\b2\d{3}\b/g, "").replace(/\b(antwerpen|merksem|deurne|berchem|wilrijk|hoboken|ekeren|borgerhout|borsbeek)\b\s*$/i, "").replace(/\b(\d+)\s*[/-]\s*\d+\b/, "$1")))
    .filter((part) => /[a-z]{3}/i.test(part) && part.length <= 80 && !VAGUE.test(locationKey(part)));
  const ranked = [...new Set(parts)].sort((a, b) => Number(/\d/.test(b)) - Number(/\d/.test(a))).slice(0, 3);
  const queries = [];
  for (const part of ranked) {
    if (postcode) queries.push({ q: `${part}, ${postcode} Antwerpen`, relaxed: false });
    queries.push({ q: `${part}, Antwerpen`, relaxed: true });
  }
  return queries;
}

// Neemt een antwoord alleen over als het een adres of straat in de stad is die letterlijk in de
// locatietekst staat. Geeft { point, precision, street, postcode } of null. relaxed: de postcode uit
// de tekst mag verschillen (de straat ligt over twee postcodes); dat mag alleen als het register die
// straatnaam in de antwoorden maar onder één postcode kent (zie pickGeocode).
export function acceptGeocode(result, location, { relaxed = false } = {}) {
  if (!result || typeof result !== "object") return null;
  const type = String(result.LocationType || "");
  if (!/^basisregisters_(huisnummer|straat)/.test(type)) return null;
  const postcode = String(result.Zipcode || "");
  if (!citySet.has(postcode)) return null;
  const wanted = postcodesInText(location);
  if (!relaxed && wanted.length && !wanted.includes(postcode)) return null;
  const key = locationKey(location);
  const street = clean(result.Thoroughfarename);
  if (!street || !has(key, locationKey(street))) return null;
  const number = clean(result.Housenumber);
  if (number && !has(key, locationKey(number))) return null;
  const lon = Number(result.Location?.Lon_WGS84), lat = Number(result.Location?.Lat_WGS84);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lon < CITY_BBOX[0] || lat < CITY_BBOX[1] || lon > CITY_BBOX[2] || lat > CITY_BBOX[3]) return null;
  return {
    point: [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5],
    precision: number ? "adres" : "straat",
    street,
    postcode,
  };
}

// Kiest uit een antwoordlijst. Zonder postcodecontrole (relaxed) moet de gevonden straatnaam in de
// antwoorden onder precies één postcode voorkomen; twee "Kerkstraat"-en in verschillende districten
// zijn dubbelzinnig en leveren niets op.
export function pickGeocode(results, location, { relaxed = false } = {}) {
  const list = Array.isArray(results) ? results : [];
  for (const result of list) {
    const hit = acceptGeocode(result, location, { relaxed });
    if (!hit) continue;
    if (relaxed) {
      const name = locationKey(hit.street);
      const postcodes = new Set(list.filter((r) => locationKey(r?.Thoroughfarename) === name).map((r) => String(r?.Zipcode || "")));
      if (postcodes.size !== 1) return null;
    }
    return hit;
  }
  return null;
}

// Controle van site/geo/locaties.json (ook in validate-data): vaste vorm, alleen punten in de stad,
// geen e-mailadres of telefoonnummer in een sleutel.
export function validateGeoCache(doc) {
  const errors = [];
  if (doc?.schemaVersion !== 1) errors.push("schemaVersion moet 1 zijn");
  if (!doc?.entries || typeof doc.entries !== "object") errors.push("entries ontbreekt");
  for (const [key, entry] of Object.entries(doc?.entries || {})) {
    if (key !== locationKey(key) || key.length > 200) errors.push(`ongeldige sleutel: ${key.slice(0, 40)}`);
    const [lon, lat] = Array.isArray(entry?.point) ? entry.point : [];
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < CITY_BBOX[0] || lat < CITY_BBOX[1] || lon > CITY_BBOX[2] || lat > CITY_BBOX[3]) errors.push(`punt buiten de stad: ${key.slice(0, 40)}`);
    if (!["adres", "straat"].includes(entry?.precision)) errors.push(`onbekende precisie: ${key.slice(0, 40)}`);
    const allowed = new Set(["point", "precision", "street", "postcode", "checkedOn"]);
    for (const field of Object.keys(entry || {})) if (!allowed.has(field)) errors.push(`onbekend veld ${field}`);
  }
  for (const key of [...Object.keys(doc?.entries || {}), ...Object.keys(doc?.misses || {})]) {
    if (/@/.test(key) || /\b(?:32|0)\d{1,2}(?: ?\d{2,3}){2,3}\b/.test(key)) errors.push(`verdachte sleutel: ${key.slice(0, 40)}`);
  }
  return errors;
}
