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

// Afstand in meter tussen twee straatsegmenten (0 als ze elkaar snijden).
function kruisen(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}
export function segmentSegmentMeters(a, b, c, d) {
  if (kruisen(a, b, c, d)) return 0;
  return Math.min(pointSegmentMeters(a, c, d), pointSegmentMeters(b, c, d), pointSegmentMeters(c, a, b), pointSegmentMeters(d, a, b));
}
// ---- straal voor een item zonder punt: zijn eigen vorm ----
// Een vergunning (perceel), een parkeerverbod (lijn), een inname of parcours (vlak) en een werfzone of
// omleiding hebben geen punt, maar wel een vorm uit hun bronlaag: `vorm` = { vlakken, lijnen } zoals
// parcoursGeometrie() (site/parcours-straten.js) ze maakt. Het item telt mee als die vorm ergens
// binnen de straal van de gekozen straat ligt: gemeten tussen de randen van de vorm en de stukken
// straatas, of de straat ligt in het vlak. Vroeger telde het item als één van zijn stráten binnen de
// straal lag: een lange straat trok zo vergunningen en parkeerverboden van 900 m ver mee.
const VORM_KADER = new WeakMap();
const isXY = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);
function vormKader(vorm) {
  if (VORM_KADER.has(vorm)) return VORM_KADER.get(vorm);
  let k = null;
  for (const lijn of [...(vorm.vlakken || []).flat(), ...(vorm.lijnen || [])]) for (const p of lijn || []) {
    if (!isXY(p)) continue;
    k = k ? [Math.min(k[0], p[0]), Math.min(k[1], p[1]), Math.max(k[2], p[0]), Math.max(k[3], p[1])] : [p[0], p[1], p[0], p[1]];
  }
  VORM_KADER.set(vorm, k);
  return k;
}
// De gekozen straat in een rooster met cellen van één straal groot (graden; iets ruimer gerekend dan
// op 51° NB: nooit te krap). Eén keer per straat en straal.
const ROOSTERS = new WeakMap();
function straatRooster(segments, radius) {
  let perStraal = ROOSTERS.get(segments);
  if (!perStraal) { perStraal = new Map(); ROOSTERS.set(segments, perStraal); }
  if (perStraal.has(radius)) return perStraal.get(radius);
  const cw = radius / 69000, ch = radius / 110000;
  const cellen = new Map();
  let kader = null;
  for (const s of segments) {
    const b = [Math.min(s.a[0], s.b[0]), Math.min(s.a[1], s.b[1]), Math.max(s.a[0], s.b[0]), Math.max(s.a[1], s.b[1])];
    kader = kader ? [Math.min(kader[0], b[0]), Math.min(kader[1], b[1]), Math.max(kader[2], b[2]), Math.max(kader[3], b[3])] : b;
    for (let x = Math.floor(b[0] / cw); x <= Math.floor(b[2] / cw); x++) for (let y = Math.floor(b[1] / ch); y <= Math.floor(b[3] / ch); y++) {
      const k = `${x}:${y}`; const l = cellen.get(k); if (l) l.push(s); else cellen.set(k, [s]);
    }
  }
  const rooster = { cw, ch, cellen, ruim: kader && [kader[0] - cw, kader[1] - ch, kader[2] + cw, kader[3] + ch] };
  perStraal.set(radius, rooster);
  return rooster;
}
function inRingen(p, ringen) {
  let binnen = false;
  for (const r of ringen) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if (isXY(a) && isXY(b) && (a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) binnen = !binnen;
  }
  return binnen;
}
export function vormBinnenStraal(vorm, segments, radius) {
  if (!vorm || !segments?.length || !(radius > 0)) return false;
  const k = vormKader(vorm);
  const r = straatRooster(segments, radius);
  if (!k || !r.ruim || k[0] > r.ruim[2] || k[2] < r.ruim[0] || k[1] > r.ruim[3] || k[3] < r.ruim[1]) return false;
  const randen = [];
  for (const ring of (vorm.vlakken || []).flat()) for (let i = 1; i < (ring || []).length; i++) randen.push([ring[i - 1], ring[i]]);
  for (const lijn of vorm.lijnen || []) for (let i = 1; i < (lijn || []).length; i++) randen.push([lijn[i - 1], lijn[i]]);
  for (const [a, b] of randen) {
    if (!isXY(a) || !isXY(b)) continue;
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
    if (x0 > r.ruim[2] || x1 < r.ruim[0] || y0 > r.ruim[3] || y1 < r.ruim[1]) continue;
    const gezien = new Set();
    for (let x = Math.floor(Math.max(x0, r.ruim[0]) / r.cw) - 1; x <= Math.floor(Math.min(x1, r.ruim[2]) / r.cw) + 1; x++) {
      for (let y = Math.floor(Math.max(y0, r.ruim[1]) / r.ch) - 1; y <= Math.floor(Math.min(y1, r.ruim[3]) / r.ch) + 1; y++) {
        for (const s of r.cellen.get(`${x}:${y}`) || []) {
          if (gezien.has(s)) continue;
          gezien.add(s);
          if (segmentSegmentMeters(s.a, s.b, a, b) <= radius) return true;
        }
      }
    }
  }
  // Een straat die helemaal binnen een groot vlak ligt (een werfzone over een plein), raakt geen rand.
  for (const vlak of vorm.vlakken || []) if (segments.some((s) => inRingen(s.a, vlak))) return true;
  return false;
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
