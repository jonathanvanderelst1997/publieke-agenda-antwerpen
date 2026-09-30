// Leest de openbare markten van stad Antwerpen uit GIPOD (Digitaal Vlaanderen, OGC API Features,
// collectie INNAME_PUNT) en, als verrijking, de marktlijst van geodata.antwerpen.be (MapServer/202).
// Licentie: Modellicentie Gratis Hergebruik v1.0, met bronvermelding.
// Puur: geen klok (het moment wordt meegegeven), geen netwerk. Alleen een vaste lijst velden wordt
// gelezen; contactorganisaties en de rest van een GIPOD-rij worden nooit overgenomen.
import { isValidIsoDate } from "./html-text.mjs";
import { CITY_POSTCODES, pointInDistrict } from "./postcodes.mjs";

export const GIPOD_COLLECTION_URL = "https://geo.api.vlaanderen.be/GIPOD/ogc/features/v1/collections/INNAME_PUNT";
export const GIPOD_ITEMS_URL = `${GIPOD_COLLECTION_URL}/items`;
export const MARKET_LIST_URL = "https://geodata.antwerpen.be/arcgissql/rest/services/P_Portal/portal_publiek3/MapServer/202/query";
// Het grondgebied van de stad (met Berendrecht-Zandvliet-Lillo en Borsbeek), in WGS84.
export const CITY_BBOX = Object.freeze([4.2, 51.14, 4.53, 51.39]);
export const WINDOW_DAYS = 365;
export const PAGE_SIZE = 500;
export const GIPOD_FILTER = "Type='Evenement' AND PublicDomainOccupancyTypes LIKE 'Markt%' AND Owner LIKE 'Stad Antwerpen%'";

const BRUSSELS = "Europe/Brussels";
const FEATURE_ID = /^INNAME_PUNT\.\d{1,12}-\d{1,12}$/;
const REFERENCE = /^[A-Z]{1,4}\d{1,4}$/;
const CANCELLED = /annul|ingetrokken|geweigerd|stopgezet|verwijderd/i;
const DISTRICT_LABELS = Object.freeze({ BEZALI: "Berendrecht-Zandvliet-Lillo" });

function isoSeconds(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

// Eén GIPOD-verzoek: markten van de stad in het venster [nu, nu + WINDOW_DAYS dagen].
export function gipodQueryUrl(now, { days = WINDOW_DAYS } = {}) {
  const until = new Date(now.getTime() + days * 86_400_000);
  const params = new URLSearchParams({
    f: "json",
    limit: String(PAGE_SIZE),
    bbox: CITY_BBOX.join(","),
    "filter-lang": "cql-text",
    filter: GIPOD_FILTER,
    datetime: `${isoSeconds(now)}/${isoSeconds(until)}`,
  });
  return `${GIPOD_ITEMS_URL}?${params}`;
}

export function marketListQueryUrl() {
  const params = new URLSearchParams({ where: "1=1", outFields: "id,type,locatie,postcode,district,soort", returnGeometry: "false", f: "json" });
  return `${MARKET_LIST_URL}?${params}`;
}

function capitalize(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

const PARTICLES = new Set(["van", "de", "der", "den", "het", "ten", "ter", "op", "en"]);

// "SINT-FRANCISCUSPLEIN" → "Sint-Franciscusplein", "FREDERIK VAN EEDENPLEIN" → "Frederik van Eedenplein".
// Tekst die al kleine letters heeft, blijft zoals hij is.
export function placeName(text) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim().replace(/[.]+$/, "");
  if (!value || value !== value.toUpperCase()) return value;
  return value
    .toLowerCase()
    .split(" ")
    .map((word, index) => (index > 0 && PARTICLES.has(word) ? word : word.replace(/(^|[-(])(\p{L})/gu, (whole, lead, letter) => lead + letter.toUpperCase())))
    .join(" ");
}

// GIPOD schrijft "Gemengde markt\nKioskplaats" of "SINT-FRANCISCUSPLEIN\nGemengde markt" of één regel.
export function marketTitle(description) {
  const lines = String(description ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (!lines.length) return { title: "", place: "" };
  if (lines.length === 1) return { title: capitalize(placeName(lines[0])), place: "" };
  // De soort staat in gewone tekst ("Gemengde markt"); de plaats vaak in hoofdletters ("BOTERMARKT").
  const plain = lines.findIndex((line) => /markt/i.test(line) && line !== line.toUpperCase());
  const kindIndex = plain >= 0 ? plain : Math.max(lines.findIndex((line) => /markt/i.test(line)), 0);
  const kind = lines[kindIndex];
  const place = placeName(lines.find((line, index) => index !== kindIndex) ?? "");
  const label = /markt/i.test(kind) ? capitalize(kind) : `Markt voor ${kind.toLowerCase()}`;
  return { title: `${label} ${place}`.trim(), place };
}

// De marktlijst van de stad: id (MA1 …) → district en postcode. Parkeervoorzieningen vallen weg.
export function parseMarketList(json) {
  const byId = new Map();
  for (const feature of Array.isArray(json?.features) ? json.features : []) {
    const attributes = feature?.attributes ?? {};
    const id = String(attributes.id ?? "").trim();
    const postcode = String(attributes.postcode ?? "").trim();
    if (!REFERENCE.test(id) || !/^openbare markt$/i.test(String(attributes.type ?? "").trim())) continue;
    if (!CITY_POSTCODES.includes(postcode)) continue;
    const district = String(attributes.district ?? "").trim().toUpperCase();
    byId.set(id, {
      postcode,
      district,
      districtLabel: DISTRICT_LABELS[district] ?? placeName(district),
      inDistrict: district === "ANTWERPEN",
    });
  }
  return byId;
}

const clockFormat = new Intl.DateTimeFormat("en-GB", { timeZone: BRUSSELS, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function brussels(instant) {
  const parts = Object.fromEntries(clockFormat.formatToParts(instant).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function spokenTime(time) {
  const [hours, minutes] = time.split(":");
  return minutes === "00" ? String(Number(hours)) : `${Number(hours)}.${minutes}`;
}

function occupancyTypes(value) {
  return String(value ?? "")
    .split(";")
    .map((type) => type.trim())
    .filter(Boolean);
}

// Waarom een GIPOD-rij geen markt voor de agenda is, of null.
function rejection(feature, now) {
  const properties = feature?.properties ?? {};
  const reference = String(properties.Reference ?? "").trim();
  const types = occupancyTypes(properties.PublicDomainOccupancyTypes);
  if (/_P$/i.test(reference) || /^parkeervoorziening/i.test(String(properties.Description ?? "").trim())) return "parking";
  if (types.some((type) => /ambulante handel/i.test(type)) || !types.includes("Markt")) return "not_a_market";
  if (properties.Type !== "Evenement" || !String(properties.Owner ?? "").startsWith("Stad Antwerpen")) return "not_a_city_market";
  if (CANCELLED.test(String(properties.Status ?? ""))) return "cancelled";
  if (!FEATURE_ID.test(String(feature?.id ?? ""))) return "invalid_id";
  const start = Date.parse(properties.Start ?? "");
  const end = Date.parse(properties.End ?? "");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return "invalid_time";
  if (end < now.getTime()) return "past";
  const coordinates = feature?.geometry?.type === "Point" ? feature.geometry.coordinates : null;
  if (!Array.isArray(coordinates) || !coordinates.every(Number.isFinite)) return "invalid_geometry";
  return null;
}

// Alle officieel gepubliceerde marktdagen binnen het queryvenster. Dezelfde markt kan dus meerdere
// datums opleveren. Alleen exacte dubbels per markt + Brusselse datum worden samengevoegd.
export function marketsFromGipod(geojson, { now, marketList = null }) {
  const counts = { rows: 0, markets: 0, series: 0, conflicts: 0, rejected: {} };
  const occurrences = new Map();
  const series = new Set();
  for (const feature of Array.isArray(geojson?.features) ? geojson.features : []) {
    counts.rows += 1;
    const reason = rejection(feature, now);
    if (reason) { counts.rejected[reason] = (counts.rejected[reason] ?? 0) + 1; continue; }
    const properties = feature.properties;
    const reference = String(properties.Reference ?? "").trim();
    const key = REFERENCE.test(reference) ? reference : `G${properties.GipodId}`;
    const start = brussels(new Date(properties.Start));
    if (!isValidIsoDate(start.date)) { counts.rejected.invalid_date = (counts.rejected.invalid_date ?? 0) + 1; continue; }
    series.add(key);
    const occurrenceKey = `${key}|${start.date}`;
    const previous = occurrences.get(occurrenceKey);
    if (!previous || Date.parse(properties.Start) < Date.parse(previous.properties.Start)) occurrences.set(occurrenceKey, feature);
  }
  const items = [];
  for (const [occurrenceKey, feature] of [...occurrences.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const properties = feature.properties;
    const reference = String(properties.Reference ?? "").trim();
    const key = REFERENCE.test(reference) ? reference : `G${properties.GipodId}`;
    const { title, place } = marketTitle(properties.Description);
    if (!title) { counts.rejected.missing_title = (counts.rejected.missing_title ?? 0) + 1; continue; }
    const start = brussels(new Date(properties.Start));
    const end = brussels(new Date(properties.End));
    const inDistrict = pointInDistrict(feature.geometry.coordinates);
    const listed = marketList?.get(key) ?? null;
    if (listed && listed.inDistrict !== inDistrict) { counts.conflicts += 1; continue; }
    const where = place || title.replace(/^.*markt\s+/i, "");
    const location = listed ? `${where}, ${listed.postcode} ${listed.districtLabel}` : `${where}, Antwerpen`;
    items.push({
      id: `markt-${key.toLowerCase()}-${start.date}`,
      externalId: String(properties.GipodId ?? key),
      title, theme: "Activiteit", className: "activity", date: start.date,
      endDate: end.date > start.date ? end.date : null,
      timeSlot: start.time, timeText: `${spokenTime(start.time)} tot ${spokenTime(end.time)} uur`,
      location, postcodes: listed ? [listed.postcode] : [],
      info: "Openbare markt van stad Antwerpen. Marktdag volgens GIPOD.",
      kind: "activity", sourceUrl: `${GIPOD_ITEMS_URL}/${feature.id}`,
      retrievedAt: null, reviewRequired: false, inDistrict,
    });
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || a.timeSlot.localeCompare(b.timeSlot) || a.id.localeCompare(b.id));
  counts.markets = items.length;
  counts.series = series.size;
  return { items, counts };
}
