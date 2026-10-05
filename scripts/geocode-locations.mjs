// Geeft agendalocaties een punt voor de buurtkaart: `npm run geo:refresh` (onderdeel van `npm run refresh`).
// Leest de komende agendapunten (handmatig + feed), zoekt elke nieuwe locatietekst één keer op bij de
// Geolocation-API van Digitaal Vlaanderen en schrijft site/geo/locaties.json. Faalt de API, dan blijft
// het vorige bestand staan en eindigt het script toch met 0: de kaart is een extra, nooit een reden om
// de dataverversing te laten falen. `npm run check` gebruikt geen netwerk en leest alleen het bestand.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GEO_SOURCE, GEOLOCATION_URL, geocodeQueries, pickGeocode, validateGeoCache } from "../lib/geocode.mjs";
import { USER_AGENT, fetchWithTimeout, isMainModule } from "../lib/fetch-util.mjs";
import { brusselsDate } from "../lib/html-text.mjs";
import { locationKey } from "../site/neighborhood-core.js";
import { loadExpandedAgendaItems } from "./agenda-source.mjs";

export const GEO_FILE = path.join("site", "geo", "locaties.json");
export const MAX_QUERIES = 150;
export const BUDGET_MS = 2 * 60_000;
export const RETRY_MISS_DAYS = 14;

const addDays = (iso, days) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export function readGeoCache(rootDir) {
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(rootDir, GEO_FILE), "utf8"));
    return validateGeoCache(doc).length ? emptyCache() : doc;
  } catch {
    return emptyCache();
  }
}
function emptyCache() {
  return { schemaVersion: 1, source: GEO_SOURCE, entries: {}, misses: {} };
}

// Locaties van agendapunten die vandaag of later nog lopen.
export function upcomingLocations(items, today) {
  const out = new Map();
  for (const item of items) {
    const last = item.endDate && item.endDate > item.date ? item.endDate : item.date;
    if (!last || last < today) continue;
    const key = locationKey(item.location);
    if (key && !out.has(key)) out.set(key, { location: String(item.location), postcodes: item.postcodes || [] });
  }
  return out;
}

export async function geocodeLocations({ rootDir, fetch: fetchImpl = globalThis.fetch, clock = () => new Date(), log = console.log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), items } = {}) {
  const today = brusselsDate(clock());
  const started = Date.now();
  const previous = readGeoCache(rootDir);
  const wanted = upcomingLocations(items ?? loadExpandedAgendaItems(rootDir), today);
  const entries = {}, misses = {};
  const stats = { locations: wanted.size, cached: 0, queried: 0, found: 0, missed: 0, skipped: 0, errors: 0 };
  for (const [key, { location, postcodes }] of [...wanted].sort(([a], [b]) => a.localeCompare(b))) {
    if (previous.entries?.[key]) { entries[key] = previous.entries[key]; stats.cached++; continue; }
    const missedOn = previous.misses?.[key];
    if (missedOn && addDays(missedOn, RETRY_MISS_DAYS) > today) { misses[key] = missedOn; stats.cached++; continue; }
    const queries = geocodeQueries(location, postcodes);
    if (!queries.length) { misses[key] = today; stats.skipped++; continue; }
    let hit = null, failed = false;
    for (const { q, relaxed } of queries) {
      if (stats.queried >= MAX_QUERIES || Date.now() - started > BUDGET_MS) { failed = true; break; }
      stats.queried++;
      try {
        const url = new URL(GEOLOCATION_URL);
        url.search = new URLSearchParams({ q, c: "3" }).toString();
        const response = await fetchWithTimeout(fetchImpl, url.href, { headers: { "user-agent": USER_AGENT, accept: "application/json" }, redirect: "error" }, 10_000);
        if (!response.ok) throw new Error(`http_${response.status}`);
        const json = await response.json();
        hit = pickGeocode(json?.LocationResult, location, { relaxed });
      } catch {
        stats.errors++;
        failed = true;
      }
      if (hit) break;
      await sleep(150);
    }
    if (hit) { entries[key] = { ...hit, checkedOn: today }; stats.found++; }
    else if (!failed) { misses[key] = today; stats.missed++; }
  }
  const doc = { schemaVersion: 1, source: GEO_SOURCE, entries, misses };
  const errors = validateGeoCache(doc);
  if (errors.length) {
    log(JSON.stringify({ geo: "rejected", errors: errors.slice(0, 5) }));
    return { written: false, stats };
  }
  const file = path.join(rootDir, GEO_FILE);
  const text = `${JSON.stringify(doc, null, 1)}\n`;
  const changed = !fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text;
  if (changed) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  log(JSON.stringify({ geo: changed ? "written" : "unchanged", ...stats }));
  return { written: changed, stats };
}

if (isMainModule(import.meta.url)) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  geocodeLocations({ rootDir }).catch((error) => {
    // Nooit de verversing breken: de vorige locaties blijven staan.
    console.error(JSON.stringify({ geo: "error", message: String(error?.message || error).slice(0, 200) }));
  });
}
