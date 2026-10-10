// Buurtweergave: pure functies voor wijken, coördinaten en "in mijn buurt".
// Geen netwerk, geen DOM: dezelfde code draait in de browser (kaart en filter) en in Node
// (geocodering bij het verversen en de toetsen).
import { pointInGeometry } from "./works-core.js";
import { segmentenInKader } from "./street-core.js";

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
// Sleutels van alle straten waarvan een stuk binnen `radius` meter van de gekozen straat ligt:
// "naam|postcode" en "naam|" (voor een straat zonder postcode). Voor items zonder eigen punt.
export const straatSleutel = (ref) => `${locationKey(ref?.name)}|${ref?.postcode || ""}`;
export function stratenBinnenStraal(index, segments, radius) {
  const uit = new Set();
  if (!index?.segments || !segments?.length || !(radius > 0)) return uit;
  // Rooster van de gekozen straat (cellen van één straal groot): een kandidaat vergelijkt zich alleen
  // met de stukken van de straat in de cellen rond hem. Een lange straat (de Leien, 250 stukken) bleef
  // anders seconden rekenen.
  const cw = radius / 69000, ch = radius / 110000; // graden per straal op 51° NB, iets ruimer: nooit te krap
  const box = (s) => s.box || [Math.min(s.a[0], s.b[0]), Math.min(s.a[1], s.b[1]), Math.max(s.a[0], s.b[0]), Math.max(s.a[1], s.b[1])];
  const rooster = new Map();
  let kader = null;
  for (const s of segments) {
    const b = box(s);
    kader = kader ? [Math.min(kader[0], b[0]), Math.min(kader[1], b[1]), Math.max(kader[2], b[2]), Math.max(kader[3], b[3])] : [...b];
    for (let x = Math.floor(b[0] / cw); x <= Math.floor(b[2] / cw); x++) for (let y = Math.floor(b[1] / ch); y <= Math.floor(b[3] / ch); y++) {
      const k = `${x}:${y}`; const l = rooster.get(k); if (l) l.push(s); else rooster.set(k, [s]);
    }
  }
  const kandidaten = index.grid ? segmentenInKader(index, kader, cw) : index.segments;
  for (const t of kandidaten) {
    if ((t.refs || []).every((ref) => uit.has(straatSleutel(ref)))) continue;
    const b = box(t);
    let binnen = false;
    zoek: for (let x = Math.floor(b[0] / cw) - 1; x <= Math.floor(b[2] / cw) + 1; x++) for (let y = Math.floor(b[1] / ch) - 1; y <= Math.floor(b[3] / ch) + 1; y++) {
      for (const s of rooster.get(`${x}:${y}`) || []) {
        const sb = box(s);
        // Eerst de kaders (met iets kleinere meters per graad: nooit te streng): liggen die al verder
        // dan de straal, dan ook de stukken zelf.
        if (Math.hypot(Math.max(0, sb[0] - b[2], b[0] - sb[2]) * 69000, Math.max(0, sb[1] - b[3], b[1] - sb[3]) * 110000) > radius) continue;
        if (segmentSegmentMeters(s.a, s.b, t.a, t.b) <= radius) { binnen = true; break zoek; }
      }
    }
    if (!binnen) continue;
    for (const ref of t.refs || []) { uit.add(straatSleutel(ref)); uit.add(`${locationKey(ref?.name)}|`); }
  }
  return uit;
}
// Ligt één van deze straten binnen de straal? Een straat zonder postcode telt in elke postcode.
export function stratenInStraal(refs, binnen) {
  return (refs || []).some((ref) => ref?.name && binnen.has(ref.postcode ? straatSleutel(ref) : `${locationKey(ref.name)}|`));
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
