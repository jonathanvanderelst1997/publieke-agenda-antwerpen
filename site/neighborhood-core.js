// Buurtweergave: pure functies voor wijken, coördinaten en "in mijn buurt".
// Geen netwerk, geen DOM: dezelfde code draait in de browser (kaart en filter) en in Node
// (geocodering bij het verversen en de toetsen).
import { pointInGeometry } from "./works-core.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

// Sleutel van een locatietekst in site/geo/locaties.json. Hoofdletters, accenten, leestekens en
// dubbele spaties tellen niet mee, zodat "Groenplaats" en "groenplaats " hetzelfde punt zijn.
export function locationKey(value) {
  return clean(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export const RADIUS_OPTIONS = Object.freeze([0, 250, 500, 1000]);

export function isPoint(point) {
  return Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

// Afstand in meter tussen twee punten [lengtegraad, breedtegraad] (vlakke benadering; genoeg op stadsschaal).
function xy(point, origin) {
  const lat = (((point[1] + origin[1]) / 2) * Math.PI) / 180;
  return [(point[0] - origin[0]) * 111320 * Math.cos(lat), (point[1] - origin[1]) * 110540];
}
export function distanceMeters(a, b) {
  const [x, y] = xy(b, a);
  return Math.hypot(x, y);
}
export function pointSegmentMeters(point, a, b) {
  const A = xy(a, point), B = xy(b, point), dx = B[0] - A[0], dy = B[1] - A[1];
  if (dx === 0 && dy === 0) return Math.hypot(A[0], A[1]);
  const t = Math.max(0, Math.min(1, -(A[0] * dx + A[1] * dy) / (dx * dx + dy * dy)));
  return Math.hypot(A[0] + t * dx, A[1] + t * dy);
}

// ---- wijken ----
export function wijkFeatures(collection) {
  return (Array.isArray(collection?.features) ? collection.features : []).filter(
    (f) => f?.properties?.code && ["Polygon", "MultiPolygon"].includes(f?.geometry?.type)
  );
}

export function wijkOf(point, wijken) {
  if (!isPoint(point)) return "";
  for (const feature of wijken || []) if (pointInGeometry(point, feature.geometry)) return feature.properties.code;
  return "";
}

// Omhullend kader [minLon, minLat, maxLon, maxLat] van een (Multi)Polygon.
export function bboxOf(geometry) {
  const rings = geometry?.type === "Polygon" ? geometry.coordinates : geometry?.type === "MultiPolygon" ? geometry.coordinates.flat() : [];
  let box = null;
  for (const ring of rings) for (const [x, y] of ring) box = box ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)] : [x, y, x, y];
  return box;
}

// ---- coördinaten van een item ----
// Werken hebben zelf een GIPOD-punt; een agendapunt krijgt het zijne bij het verversen
// (site/geo/locaties.json), nooit in de browser.
export function geoEntryFor(item, geo) {
  if (!item || !geo?.entries) return null;
  const entry = geo.entries[locationKey(item.location || item.address || "")];
  return entry && isPoint(entry.point) ? entry : null;
}
export function itemPoint(item, geo) {
  if (isPoint(item?.point)) return item.point.slice(0, 2);
  return geoEntryFor(item, geo)?.point || null;
}

// ---- straat + straal ----
// Segmenten van één gekozen straat uit de officiële straatas (street-core.buildStreetIndex).
export function streetSegments(index, street) {
  if (!index?.segments || !street?.name) return [];
  const name = locationKey(street.name);
  return index.segments.filter((segment) =>
    (segment.refs || []).some((ref) => locationKey(ref.name) === name && (!street.postcode || !ref.postcode || String(ref.postcode) === String(street.postcode)))
  );
}
export function nearSegments(point, segments, radius) {
  if (!isPoint(point) || !segments?.length || !(radius > 0)) return false;
  return segments.some((s) => pointSegmentMeters(point, s.a, s.b) <= radius);
}

// Straatnaam → wijkcodes, via het midden van elk straatsegment. Zo kan ook een item zonder punt maar
// met een officiële straat (parkeerverbod, vergunning, terras) in een wijk vallen.
export function streetWijkMap(index, wijken) {
  const map = new Map();
  for (const segment of index?.segments || []) {
    const mid = [(segment.a[0] + segment.b[0]) / 2, (segment.a[1] + segment.b[1]) / 2];
    const code = wijkOf(mid, wijken);
    if (!code) continue;
    for (const ref of segment.refs || []) {
      const key = `${locationKey(ref.name)}|${ref.postcode || ""}`;
      const set = map.get(key) || new Set();
      set.add(code);
      map.set(key, set);
    }
  }
  return map;
}
export function streetsInWijk(streets, code, map) {
  if (!code || !map) return false;
  return (streets || []).some((ref) => {
    const exact = map.get(`${locationKey(ref?.name)}|${ref?.postcode || ""}`);
    if (exact) return exact.has(code);
    // Zonder postcode: elke variant van die straatnaam telt.
    if (ref?.postcode) return false;
    const prefix = `${locationKey(ref?.name)}|`;
    for (const [key, set] of map) if (key.startsWith(prefix) && set.has(code)) return true;
    return false;
  });
}

// Eén beslissing voor "in mijn buurt". area = { wijk, street, radius, streetSegments }.
// - wijk: het item ligt in de wijk (eigen punt), of één van zijn officiële straten loopt erdoor;
// - straat met straal: het item ligt op die straat (bestaande straatfilter) of binnen de straal ervan.
// Items zonder punt en zonder straat vallen bij een wijkfilter weg: nooit gokken.
export function matchesWijk(item, code, { geo, wijken, streetMap, streets = [] } = {}) {
  if (!code) return true;
  const point = itemPoint(item, geo);
  if (point) return wijkOf(point, (wijken || []).filter((f) => f.properties.code === code)) === code;
  return streetsInWijk(streets, code, streetMap);
}

export function groupByPoint(entries) {
  const groups = new Map();
  for (const entry of entries || []) {
    if (!isPoint(entry.point)) continue;
    const key = `${entry.point[0].toFixed(5)},${entry.point[1].toFixed(5)}`;
    const group = groups.get(key) || { point: entry.point, items: [] };
    group.items.push(entry.item);
    groups.set(key, group);
  }
  return [...groups.values()];
}
