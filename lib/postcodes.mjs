// Postcodes van district Antwerpen en van de hele stad Antwerpen.
// Bron: geodata.antwerpen.be, wegenregister straatas/postzone, opgehaald 2026-09-28.
// De districtsgrens zelf staat in lib/district-antwerpen-grens.geojson (officiële open data).
import fs from "node:fs";

import { pointInGeometry } from "../site/works-core.js";

export const DISTRICT_POSTCODES = Object.freeze(["2000", "2018", "2020", "2030", "2050", "2060"]);

export const CITY_POSTCODES = Object.freeze([
  ...DISTRICT_POSTCODES,
  "2040",
  "2100",
  "2140",
  "2150",
  "2170",
  "2180",
  "2600",
  "2610",
  "2660",
]);

const districtSet = new Set(DISTRICT_POSTCODES);
const citySet = new Set(CITY_POSTCODES);

// "district" voor een postcode van district Antwerpen, "stad" voor een andere
// postcode van de stad Antwerpen, anders null.
export function scopeForPostcode(postcode) {
  const value = String(postcode ?? "").trim();
  if (districtSet.has(value)) return "district";
  if (citySet.has(value)) return "stad";
  return null;
}

export function isDistrictPostcode(postcode) {
  return districtSet.has(String(postcode ?? "").trim());
}

export function postcodesInText(text) {
  const found = [];
  for (const match of String(text ?? "").matchAll(/\b(2\d{3})\b/g)) {
    if (citySet.has(match[1]) && !found.includes(match[1])) found.push(match[1]);
  }
  return found;
}

let cachedBoundary = null;

export function districtBoundary() {
  if (!cachedBoundary) {
    const collection = JSON.parse(
      fs.readFileSync(new URL("./district-antwerpen-grens.geojson", import.meta.url), "utf8")
    );
    const features = Array.isArray(collection.features) ? collection.features : [];
    if (features.length !== 1) throw new Error("De districtsgrens moet exact één feature bevatten.");
    cachedBoundary = features[0].geometry;
  }
  return cachedBoundary;
}

// point = [lengtegraad, breedtegraad] (GeoJSON-volgorde).
export function pointInDistrict(point, geometry = districtBoundary()) {
  return pointInGeometry(point, geometry);
}
