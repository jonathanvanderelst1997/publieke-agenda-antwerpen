// De kaartbibliotheken voor de e2e-toetsen (P9). De e2e weigeren alles buiten 127.0.0.1, dus ook cdnjs: zonder
// deze helper laadt de kaart in geen enkele toets. Leaflet 1.9.4 staat byte-exact in tests/fixtures/kaart/
// (uit npm leaflet@1.9.4, gelijk aan cdnjs; BSD-2, zie LICENSE daar). MapLibre (1 MB) staat niet in de repo:
// een toets die het nodig heeft, geeft een map mee (`maplibreDir`, de npm-dist van 5.24.0).
//
// kaartAntwoord(url) geeft de opties voor route.fulfill() van Playwright, of null (dan breekt de toets het
// verzoek af, zoals elk ander verzoek naar buiten). Een bestand wordt alleen beantwoord als zijn sha512 gelijk
// is aan de SRI die de site vraagt: anders weigert de browser het toch, en zoekt de toets in de verkeerde hoek.
// De kop access-control-allow-origin is nodig: de site laadt met crossOrigin "anonymous" en SRI, en zonder
// CORS-kop faalt die controle.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LEAFLET } from "../../site/neighborhood-map.js";

export const KAART_FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/kaart");
export const LEAFLET_DIR = path.join(KAART_FIXTURES, "leaflet-1.9.4");
const map = (url) => url.slice(0, url.lastIndexOf("/") + 1);
// Dezelfde map als in site/neighborhood-map.js: wie de versie daar verandert, moet ook de fixture vervangen.
export const LEAFLET_PREFIX = map(LEAFLET.js.src);
export const MAPLIBRE_PREFIX = "https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.24.0/";
// De vaste SRI van MapLibre 5.24.0 op cdnjs (plan P9). Laadt de site MapLibre, dan met precies deze waarden.
export const MAPLIBRE_SRI = Object.freeze({
  "maplibre-gl.js": "sha512-rOFgoUgWaVi69JW1dzBu6PWF9xKW9rxYfY5u2SexFABHhWk0qUWkJoWNz4UuZRMvSXsNZG66+tU5B+HlwWF5kA==",
  "maplibre-gl.css": "sha512-KIMsMWIdnoG9OwZa+oaIafmbDonqck1UCmq+/zcUi2aaZ97N9QE6TqpTM+n36EO40HGh64hU/375zxtjx7WTyQ==",
});
const LEAFLET_SRI = Object.freeze({ "leaflet.js": LEAFLET.js.integrity, "leaflet.css": LEAFLET.css.integrity });
const TYPES = Object.freeze({ ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" });

export const sri = (inhoud) => `sha512-${crypto.createHash("sha512").update(inhoud).digest("base64")}`;

const gelezen = new Map();
function lees(bestand) {
  if (!gelezen.has(bestand)) gelezen.set(bestand, fs.existsSync(bestand) && fs.statSync(bestand).isFile() ? fs.readFileSync(bestand) : null);
  return gelezen.get(bestand);
}

// Welk bestand hoort bij de url, en welke SRI moet het hebben? Alleen de bestanden die de site laadt.
function zoek(url, maplibreDir) {
  const tekst = String(url || "").split(/[?#]/)[0];
  if (tekst.startsWith(LEAFLET_PREFIX)) {
    const naam = tekst.slice(LEAFLET_PREFIX.length);
    return LEAFLET_SRI[naam] ? { bestand: path.join(LEAFLET_DIR, naam), verwacht: LEAFLET_SRI[naam] } : null;
  }
  if (maplibreDir && tekst.startsWith(MAPLIBRE_PREFIX)) {
    const naam = tekst.slice(MAPLIBRE_PREFIX.length);
    return MAPLIBRE_SRI[naam] ? { bestand: path.join(maplibreDir, naam), verwacht: MAPLIBRE_SRI[naam] } : null;
  }
  return null;
}

export function kaartAntwoord(url, { maplibreDir = "" } = {}) {
  const gevonden = zoek(url, maplibreDir);
  const body = gevonden && lees(gevonden.bestand);
  if (!body || sri(body) !== gevonden.verwacht) return null;
  return {
    status: 200,
    headers: { "access-control-allow-origin": "*", "content-type": TYPES[path.extname(gevonden.bestand)] },
    body,
  };
}
