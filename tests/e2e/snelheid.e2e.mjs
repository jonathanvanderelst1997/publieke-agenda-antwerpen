// End-to-end (P5, snelheid): de voorpagina vraagt live-layers.json niet meer op, en de plekpagina toont
// een straat meteen uit de stand van de ochtend (site/straat/<id>.json) en kijkt daarna live alleen het
// kader van die straat na. Playwright + Chromium tegen de gebouwde site/; alles buiten de lokale site wordt
// onderschept. De straatbestanden komen van de echte bouwer (scripts/build-straat-snapshots.mjs) op
// verzonnen items (tests/helpers/straat-fixture.mjs), zodat de toets niet afhangt van de data van vandaag.
// Op de basistak bestaan de bouwer en de straatbestanden niet: dan draait dit bestand toch, zonder
// straatbestanden, en faalt het op wat de bewoner merkt (geen tegels binnen 3 s, live-layers.json opgevraagd).
// Zonder Playwright of Chromium wordt de toets overgeslagen (CI installeert geen browser).
// P9 ("een kaart die vertelt"): de legenda telt wat de lijst toont, en de buurtkaart valt terug op Leaflet. De
// e2e weigeren alles naar buiten, dus ook cdnjs; met `kaart: "leaflet"` antwoordt de vangnetroute Leaflet 1.9.4
// byte-exact uit tests/fixtures/kaart/ (tests/helpers/kaart-fixture.mjs), zodat de SRI klopt en de kaart echt laadt.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const site = path.join(root, "site");
const fixture = await import("../helpers/straat-fixture.mjs").catch(() => null);
const { feedScript, kalenderItem, proefFeed } = await import("../helpers/proef-feed.mjs");
const { kaartAntwoord } = await import("../helpers/kaart-fixture.mjs");

async function loadPlaywright() {
  for (const spec of [process.env.PLAYWRIGHT_MODULE, "playwright"].filter(Boolean)) {
    try { return await import(spec); } catch { /* volgende */ }
  }
  try {
    const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
    return await import(path.join(globalRoot, "playwright", "index.mjs"));
  } catch { return null; }
}
const pw = await loadPlaywright();
let browser = null;
if (pw) {
  try { browser = await pw.chromium.launch(); } catch {
    try { browser = await pw.chromium.launch({ executablePath: path.join(process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers", "chromium") }); } catch { browser = null; }
  }
}
const skip = browser ? false : "Playwright/Chromium niet beschikbaar";
const axePath = process.env.AXE_CORE_PATH && fs.existsSync(process.env.AXE_CORE_PATH) ? process.env.AXE_CORE_PATH : "";

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };
function serve(gevraagd) {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
    gevraagd.push(pathname);
    let file = path.normalize(path.join(site, pathname));
    if (!file.startsWith(site)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) file = path.join(site, "index.html"); // zoals de rewrite in render.yaml
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const straten = JSON.parse(fs.readFileSync(path.join(site, "geo", "straten.json"), "utf8")).streets;
const kam = straten.find((r) => r[1] === "Kammenstraat" && String(r[2]) === "2000");
const [x1, y1, x2, y2] = kam[4];
const midden = [(x1 + x2) / 2, (y1 + y2) / 2];
const district = fs.readFileSync(path.join(root, "lib", "district-antwerpen-grens.geojson"), "utf8");
const json = (body) => ({ status: 200, contentType: "application/json", body: typeof body === "string" ? body : JSON.stringify(body) });
// 10 maart 2099, 10.00 uur in Brussel: de stand van de verzonnen ochtend is van 05:22.
const NU = new Date("2099-03-10T09:00:00.000Z");
const DISTRICT_BBOX = "4.300791,51.175458,4.444331,51.313629";

// De straatbestanden van de verzonnen ochtend, gemaakt door de echte bouwer in een tijdelijke map.
async function standVanDeOchtend(t) {
  if (!fixture) return null;
  const map = fs.mkdtempSync(path.join(os.tmpdir(), "snelheid-e2e-"));
  t.after(() => fs.rmSync(map, { recursive: true, force: true }));
  fixture.maakWerkmap(map);
  await fixture.bouw(map);
  const lees = (rel) => fs.readFileSync(path.join(map, rel), "utf8");
  const index = JSON.parse(lees("site/straat-index.json"));
  return { index: lees("site/straat-index.json"), bestanden: Object.fromEntries(Object.keys(index.straten).map((id) => [id, lees(`site/straat/${id}.json`)])) };
}

// ---- een volledige nagebootste stad (voor "dezelfde kaartjes als met alle live lagen") ----
// Verzonnen: een werk, een aanvraag in openbaar onderzoek en een evenement met een parcours in de
// Kammenstraat, waarvan de opbouw en de afbraak elders liggen (buiten het kader van de straat), zoals de
// start- en aankomstzone van een loop. De nagebootste A-Sign en vergunningenlaag kijken het kader na.
const ms = (dag) => Date.parse(`${dag}T00:00:00Z`);
const ELDERS = [[4.4105, 51.2105], [4.4112, 51.2109]];
// Opbouw en afbraak van het evenement: elders, op een plek zonder straatas. Bewust: "Wat merk je" noemt in
// de snelle weg alleen de straten van de rijen in het straatbestand of in het live kader (een straatbestand
// met alle straten van een groot parcours werd te groot; zie scripts/build-straat-snapshots.mjs).
const ELDERS_EV = [[4.4170, 51.2160], [4.4176, 51.2163]];
const HIER = [[x1, y1], [x2, y2]];
const rijenVan = (lijst, { dossier = "ET2099000077", eerste = 1 } = {}) => lijst.map(([fase, naam, type, van, tot, pad], i) => ({ id: eerste + i, feature: { attributes: { OBJECTID: eerste + i, dossierNummer: dossier, faseId: fase, innameId: `I${eerste + i}`, dossierStatus: "aanvraag_goedgekeurd", faseNaam: naam, type_dossier: "ETL", innameTypeNaam: type, innameBeschrijving: "", innameHinder: "True", faseStartDatum: ms(van), faseEindDatum: ms(tot) }, geometry: { paths: [pad] } } }));
// Twee verzonnen evenementen: (1) zaterdag, met het parcours in de straat en de opbouw en de afbraak
// elders; (2) morgen elders, met in de straat alleen een parkeerverbod tijdens de opbouw (vandaag).
const EVENEMENTEN = {
  "opbouw en afbraak elders": rijenVan([
    ["F1", "Evenement", "Parcours", "2099-03-14", "2099-03-14", HIER],
    ["F2", "Opbouw", "Parkeerverbod in Straat", "2099-03-12", "2099-03-13", ELDERS_EV],
    ["F3", "Afbraak", "Parkeerverbod in Straat", "2099-03-15", "2099-03-16", ELDERS_EV],
  ]),
  "opbouw bezig in de straat": rijenVan([
    ["F1", "Evenement", "Parcours", "2099-03-11", "2099-03-11", ELDERS_EV],
    ["F2", "Opbouw", "Parkeerverbod in Straat", "2099-03-10", "2099-03-11", HIER],
    ["F3", "Afbraak", "Parkeerverbod in Straat", "2099-03-12", "2099-03-13", ELDERS_EV],
  ]),
};
const d = 0.0002;
const aanvraag = [{ id: 1, feature: { attributes: { OBJECTID: 1, Dossiernummer: "20990077", DOSSIERTYPE: "OMV2019_AANVRAAG", AardAanvraag: "Aanvraag omgevingsproject", Onderwerp: "verbouwen van een woning", Volledig: "ja", Ontvankelijk: "ja", Ingetrokken: "nee", Stopgezet: "nee", ProjectnummerOmgevingsloket: "OMV_2099000077", behandelendeOverheid: "College van burgemeester en schepenen" }, geometry: { rings: [[[midden[0] - d, midden[1] - d], [midden[0] + d, midden[1] - d], [midden[0] + d, midden[1] + d], [midden[0] - d, midden[1] + d], [midden[0] - d, midden[1] - d]]] } } }];
// Een verzonnen werfzone met omleiding: in fase 1 loopt de omleiding door de Kammenstraat en ligt de
// werfzone elders; fase 2 (later) ligt alleen elders. En een verzonnen parkeerverbod op twee plaatsen:
// in de Kammenstraat en op twee plaatsen elders (op verzonnen straatassen van twee echte straten). Elders =
// buiten het kader van de straat.
const ANDERE = straten.find((r) => r[1] === "Nationalestraat" && String(r[2]) === "2000");
const DERDE = straten.find((r) => r[1] === "Huikstraat" && String(r[2]) === "2000");
const ELDERS2 = [[4.4125, 51.2120], [4.4131, 51.2124]];
const vlak = (pad) => ({ rings: [[...pad, [pad[0][0], pad[0][1] + 0.0003], pad[0]]] });
const werfzone = [
  { laag: 47, id: 1, feature: { attributes: { OBJECTID: 1, reference_id: "GW2099-000077", phase_id: "P1", status: "vergund", StartDate: ms("2099-03-08"), EndDate: ms("2099-03-20") }, geometry: { paths: [HIER] } } },
  { laag: 48, id: 2, feature: { attributes: { OBJECTID: 2, reference_id: "GW2099-000077", phase_id: "P1", status: "vergund", StartDate: ms("2099-03-08"), EndDate: ms("2099-03-20") }, geometry: vlak(ELDERS) } },
  { laag: 48, id: 3, feature: { attributes: { OBJECTID: 3, reference_id: "GW2099-000077", phase_id: "P2", status: "vergund", StartDate: ms("2099-04-01"), EndDate: ms("2099-04-10") }, geometry: vlak(ELDERS) } },
];
const UUR = (u) => Date.parse(`1970-01-01T${u}:00Z`);
const parkeerverbod = [[1, "L1", "Kammenstraat", HIER], [2, "L2", ANDERE[1], ELDERS], [3, "L3", DERDE[1], ELDERS2]].map(([id, locatie, straat, pad]) => ({ laag: 20, id, feature: { attributes: { OBJECTID: id, Dossiernummer: "PROEF-PV77", Locatienummer: locatie, Status: "Goedgekeurd", Adres: `${straat}, 2000 Antwerpen`, Postcode: "2000", Reden: "Verhuis", Startdatum: ms("2099-03-12"), Einddatum: ms("2099-03-12"), Starttijd: UUR("07:00"), Eindtijd: UUR("17:00"), EnkelWeekdagen: 0, GipodID: null, District: "ANTWERPEN" }, geometry: { paths: [pad] } } }));
// Een buurstraat op ongeveer 150 m van de Kammenstraat (verzonnen as van een echte straat): binnen een
// straal van 250 m, buiten het kader van de straat zelf. Daar een parkeerverbod dat ook op twee plaatsen
// ver weg geldt, en een evenement met zijn parcours in de buurstraat en opbouw en afbraak ver weg (een
// parkeerverbod in de Huikstraat). Alleen voor de toets met een straal (`buren`).
const BUUR = straten.find((r) => r[1] === "Lombardenvest" && String(r[2]) === "2000");
const BUUR_AS = [[x2 + 0.0015, (y1 + y2) / 2], [x2 + 0.0015, (y1 + y2) / 2 + 0.0006]];
const BUUR_EVENEMENT = rijenVan([
  ["F1", "Evenement", "Parcours", "2099-03-14", "2099-03-14", BUUR_AS],
  ["F2", "Opbouw", "Parkeerverbod in Straat", "2099-03-12", "2099-03-13", ELDERS2],
  ["F3", "Afbraak", "Parkeerverbod in Straat", "2099-03-15", "2099-03-16", ELDERS2],
], { dossier: "ET2099000078", eerste: 11 });
const BUUR_PARKEERVERBOD = [[11, "L1", BUUR[1], BUUR_AS], [12, "L2", ANDERE[1], ELDERS], [13, "L3", DERDE[1], ELDERS2]].map(([id, locatie, straat, pad]) => ({ laag: 20, id, feature: { attributes: { OBJECTID: id, Dossiernummer: "PROEF-PV78", Locatienummer: locatie, Status: "Goedgekeurd", Adres: `${straat}, 2000 Antwerpen`, Postcode: "2000", Reden: "Verhuis", Startdatum: ms("2099-03-13"), Einddatum: ms("2099-03-13"), Starttijd: UUR("08:00"), Eindtijd: UUR("18:00"), EnkelWeekdagen: 0, GipodID: null, District: "ANTWERPEN" }, geometry: { paths: [pad] } } }));
const assen = [[kam, [x1, y1], [x2, y2]], [ANDERE, ...ELDERS], [DERDE, ...ELDERS2], [BUUR, ...BUUR_AS]].map(([r, a, b]) => ({ type: "Feature", geometry: { type: "LineString", coordinates: [a, b] }, properties: { LSTRNMID: Number(r[0]), LSTRNM: r[1], RSTRNMID: Number(r[0]), RSTRNM: r[1], postcode: 2000, DISTRICT: "Antwerpen" } }));
// Het verzonnen dossier loopt in openbaar onderzoek op 10 maart 2099.
const INZAGE = { schema: "inzage-status/1", uitleg: "verzonnen", dossiers: [{ project: "OMV_2099000077", gevonden: true, toestand: "openbaar onderzoek", bron: "handmatig", nagekeken: "2099-03-05", openbaarOnderzoek: { van: "2099-03-01", totEnMet: "2099-03-30" } }] };
// De verversing kent het dossier (zoals elk evenementendossier in het district).
const UITLEG = { schemaVersion: 1, generatedAt: "2099-03-10T04:22:00.000Z", vanaf: "2099-03-10", tot: "2099-05-09", werken: {}, evenementen: { ET2099000077: { start: "2099-03-12", eind: "2099-03-16", soort: "", soortBron: "", beschrijvingen: [], straten: ["Kammenstraat"], kruist: [], langs: ["Kammenstraat"], stratenTekst: "", gekoppeld: null, kaart: [] } } };
const bboxVan = (pad) => [Math.min(...pad.map((p) => p[0])), Math.min(...pad.map((p) => p[1])), Math.max(...pad.map((p) => p[0])), Math.max(...pad.map((p) => p[1]))];
const kaderVanFeature = (f) => bboxVan([...(f.geometry.paths || []), ...(f.geometry.rings || [])].flat());
const raakt = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
// ArcGIS: eerst de ids (met een kader: alleen wat het kader raakt; met "faseEindDatum >= DATE '…'" of
// zo: alleen wat dan nog loopt, zoals A-Sign; met "dossierNummer IN ('…')" of zo: alleen die dossiers),
// dan de details per id.
function arcgis(records, url) {
  const u = new URL(url);
  if (u.searchParams.get("returnIdsOnly") === "true") {
    const env = (u.searchParams.get("geometry") || "").split(",").map(Number);
    const where = u.searchParams.get("where") || "";
    const [, veld, vanaf] = /(faseEindDatum|Einddatum|EndDate) >= DATE '(\d{4}-\d{2}-\d{2})'/.exec(where) || [];
    const [, dossierVeld, dossierLijst] = /(Dossiernummer|dossierNummer|reference_id) IN \(([^)]*)\)/.exec(where) || [];
    const dossiers = dossierLijst ? new Set(dossierLijst.split(",").map((d) => d.trim().replace(/^'|'$/g, ""))) : null;
    return { objectIds: records.filter((r) => (env.length !== 4 || raakt(env, kaderVanFeature(r.feature))) && (!vanaf || r.feature.attributes[veld] >= ms(vanaf)) && (!dossiers || dossiers.has(String(r.feature.attributes[dossierVeld])))).map((r) => r.id) };
  }
  const ids = new Set(String(u.searchParams.get("objectIds") || "").split(",").map(Number));
  return { features: records.filter((r) => ids.has(r.id)).map((r) => r.feature) };
}

// Een nagebootste OpenFreeMap voor de vectorkaart (alleen met MAPLIBRE_DIR): een kleine eigen stijl met de bron
// "openmaptiles", een tilejson met de laag-id's van het echte schema (OpenMapTiles) en lege vectortegels.
const OFM = "https://tiles.openfreemap.org";
const PROEF_STIJL = {
  version: 8, name: "proef (e2e)",
  sources: { openmaptiles: { type: "vector", url: `${OFM}/planet` } },
  layers: [
    { id: "achtergrond", type: "background", paint: { "background-color": "#f2efe9" } },
    { id: "water", type: "fill", source: "openmaptiles", "source-layer": "water", paint: { "fill-color": "#aad3df" } },
    { id: "wegen", type: "line", source: "openmaptiles", "source-layer": "transportation", paint: { "line-color": "#ffffff", "line-width": 2 } },
  ],
};
const PROEF_TILEJSON = {
  tilejson: "3.0.0", minzoom: 0, maxzoom: 14, tiles: [`${OFM}/planet/proef-e2e/{z}/{x}/{y}.pbf`],
  vector_layers: ["aerodrome_label", "aeroway", "boundary", "building", "housenumber", "landcover", "landuse", "mountain_peak", "park", "place", "poi", "transportation", "transportation_name", "water", "water_name", "waterway"].map((id) => ({ id, fields: {}, minzoom: 0, maxzoom: 14 })),
};
const cors = (type, body) => ({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": type }, body });
// `openfreemap`: "stijl" (alleen de stijl; de tilejson faalt) of "tegels" (stijl, tilejson en lege tegels).
function openfreemapAntwoord(url, openfreemap) {
  if (!openfreemap || !url.startsWith(`${OFM}/`)) return null;
  if (url.startsWith(`${OFM}/styles/`)) return cors("application/json", JSON.stringify(PROEF_STIJL));
  if (openfreemap !== "tegels") return null;
  if (url === `${OFM}/planet`) return cors("application/json", JSON.stringify(PROEF_TILEJSON));
  if (url.startsWith(`${OFM}/planet/proef-e2e/`)) return cors("application/x-protobuf", Buffer.alloc(0));
  return null;
}
const MAPLIBRE_DIR = process.env.MAPLIBRE_DIR && fs.existsSync(path.join(process.env.MAPLIBRE_DIR, "maplibre-gl.js")) ? process.env.MAPLIBRE_DIR : "";

// `kaart`: "geblokkeerd" (standaard: geen kaartbibliotheek, zoals in alle andere toetsen) of "leaflet" (Leaflet uit
// de fixture); `maplibreDir`: desgewenst ook MapLibre 5.24.0 uit die map (de npm-dist, byte-gelijk aan cdnjs), en
// `openfreemap` (zie hierboven) voor de stijl en de tegels. `colorScheme`: licht of donker (prefers-color-scheme).
async function openStraat(baseUrl, { stand = null, bronnen = "geblokkeerd", width = 390, height = 844, query = "?plek=Kammenstraat", inzage = null, uitleg = null, evenement = EVENEMENTEN["opbouw en afbraak elders"], buren = false, feed = null, kaart = "geblokkeerd", maplibreDir = "", openfreemap = null, zuinig = false, verbinding = null, colorScheme = "light" } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 500, hasTouch: width < 500, locale: "nl-BE", timezoneId: "Europe/Brussels", colorScheme });
  const page = await context.newPage();
  // `zuinig`: de browser meldt databesparing (navigator.connection.saveData); `verbinding`: wat de browser over de
  // verbinding meldt (navigator.connection, bv. { effectiveType: "3g" }).
  const connection = verbinding || (zuinig ? { saveData: true } : null);
  if (connection) await page.addInitScript((c) => Object.defineProperty(Navigator.prototype, "connection", { configurable: true, get: () => c }), connection);
  await page.clock.setFixedTime(NU);
  const errors = [], extern = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if (inzage) await page.route((url) => url.hostname === "127.0.0.1" && url.pathname === "/sources/inzage-status.json", (route) => route.fulfill(json(inzage)));
  if (uitleg) await page.route((url) => url.hostname === "127.0.0.1" && url.pathname === "/sources/kaart-uitleg.json", (route) => route.fulfill(json(uitleg)));
  // Desgewenst een verzonnen agendafeed (tests/helpers/proef-feed.mjs), los van wat er in de echte feed staat.
  if (feed) await page.route((url) => url.hostname === "127.0.0.1" && url.pathname === "/agenda-feed.js", (route) => route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: feedScript(feed) }));
  // De straatbestanden: uit de fixture, nooit uit wat er toevallig in site/ staat.
  await page.route((url) => url.hostname === "127.0.0.1" && (url.pathname === "/straat-index.json" || url.pathname.startsWith("/straat/")), (route) => {
    const pad = new URL(route.request().url()).pathname;
    if (!stand) return route.fulfill({ status: 404, contentType: "text/plain", body: "" });
    if (pad === "/straat-index.json") return route.fulfill(json(stand.index));
    const id = (pad.match(/^\/straat\/(\d+)\.json$/) || [])[1];
    return stand.bestanden[id] ? route.fulfill(json(stand.bestanden[id])) : route.fulfill({ status: 404, body: "" });
  });
  await page.route((url) => url.hostname !== "127.0.0.1", (route) => {
    const url = route.request().url();
    extern.push(url);
    // De kaartbibliotheek uit de fixture, vóór de bronnen: `extern` blijft alles tellen.
    const bibliotheek = kaart === "geblokkeerd" ? null : kaartAntwoord(url, { maplibreDir }) || openfreemapAntwoord(url, openfreemap);
    if (bibliotheek) return route.fulfill(bibliotheek);
    if (bronnen === "geblokkeerd") return route.abort();
    // "volledig": de hele nagebootste stad hierboven, met het kader nagekeken.
    if (bronnen === "volledig") {
      if (url.includes("/collections/INNAME_PUNT/")) return route.fulfill(json({ type: "FeatureCollection", links: [], features: [{ type: "Feature", geometry: { type: "Point", coordinates: midden }, properties: { GipodId: 990001, Description: "Proefwerk riolering (snel)", Owner: "water-link", Status: "Concreet gepland", Start: "2099-03-19T06:00:00Z", End: "2099-04-09T16:00:00Z", Uri: "https://gipod.api.vlaanderen.be/api/v1/groundworks/990001" } }] }));
      if (url.includes("/collections/HINDER_PUNT/")) return route.fulfill(json({ type: "FeatureCollection", links: [], features: [] }));
      if (url.includes("/MapServer/109/")) return route.fulfill(json(district));
      if (url.includes("/MapServer/905/")) return route.fulfill(json({ type: "FeatureCollection", features: assen }));
      if (url.includes("/P_ASign/ASign/MapServer/23/query")) return route.fulfill(json(arcgis([...evenement, ...(buren ? BUUR_EVENEMENT : [])], url)));
      const laag = Number((url.match(/\/P_ASign\/ASign\/MapServer\/(\d+)\/query/) || [])[1]);
      if ([20, 47, 48].includes(laag)) return route.fulfill(json(arcgis([...werfzone, ...parkeerverbod, ...(buren ? BUUR_PARKEERVERBOD : [])].filter((r) => r.laag === laag), url)));
      if (url.includes("/pip2_vergunningen/MapServer/5/query")) return route.fulfill(json(arcgis(aanvraag, url)));
      if (url.includes("geodata.antwerpen.be")) return route.fulfill(json(url.includes("returnIdsOnly") ? { objectIds: [] } : { features: [] }));
      return route.abort();
    }
    // "live": GIPOD en de straatas antwoorden, de rest van geodata (A-Sign, vergunningen) faalt.
    if (url.includes("/collections/INNAME_PUNT/")) return route.fulfill(json({ type: "FeatureCollection", links: [], features: [990001, 990002].map((id, i) => ({ type: "Feature", geometry: { type: "Point", coordinates: midden }, properties: { GipodId: id, Description: i ? "Proef nieuw werk (snel)" : "Proefwerk riolering (snel)", Owner: "water-link", Status: "Concreet gepland", Start: "2099-03-19T06:00:00Z", End: "2099-04-09T16:00:00Z", Uri: `https://gipod.api.vlaanderen.be/api/v1/groundworks/${id}` } })) }));
    if (url.includes("/collections/HINDER_PUNT/")) return route.fulfill(json({ type: "FeatureCollection", links: [], features: [] }));
    if (url.includes("/MapServer/109/")) return route.fulfill(json(district));
    if (url.includes("/MapServer/905/")) return route.fulfill(json({ type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: [[x1, y1], [x2, y2]] }, properties: { LSTRNMID: Number(kam[0]), LSTRNM: kam[1], RSTRNMID: Number(kam[0]), RSTRNM: kam[1], postcode: 2000, DISTRICT: "Antwerpen" } }] }));
    return route.abort();
  });
  const start = Date.now();
  await page.goto(`${baseUrl}/${query}`);
  return { page, context, errors, extern, start };
}

// Wat een bewoner ziet: de tegels, elke sectie met haar dichte kaartjes (soort, titel, wanneer, badge,
// melding) en elke open kaart van de publieke ruimte (evenement, werfzone, parkeerverbod).
async function watJeZiet(page) {
  const lijst = await page.evaluate(() => ({
    tegels: document.querySelector(".pv-place .pv-stats")?.innerText.trim() || "",
    secties: [...document.querySelectorAll(".pv-results section.pv-day")].map((s) => [s.getAttribute("aria-label") || s.querySelector(".pv-day-title")?.textContent.trim() || "", [...s.querySelectorAll(".pv-row")].map((r) => [r.dataset.uid, (r.querySelector(".pv-row-btn") || r).innerText.trim()])]),
  }));
  const open = {};
  for (const uid of lijst.secties.flatMap(([, rijen]) => rijen.map(([u]) => u)).filter((u) => u.startsWith("publicSpace:"))) {
    const rij = page.locator(`.pv-results .pv-row[data-uid="${uid}"]`).first();
    await rij.locator(".pv-row-btn").click();
    open[uid] = (await rij.innerText()).trim();
    await rij.locator(".pv-row-btn").click();
  }
  return { ...lijst, open };
}

test("snelheid: voorpagina en plekpagina", { skip }, async (t) => {
  const gevraagd = [];
  const server = await serve(gevraagd);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await browser.close(); });

  await t.test("de voorpagina vraagt live-layers.json niet op (8 tot 12 MB per bezoek), wel de kleine radar", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "nl-BE", timezoneId: "Europe/Brussels" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route((url) => url.hostname !== "127.0.0.1", (route) => route.abort());
    gevraagd.length = 0;
    await page.goto(`${baseUrl}/`);
    await page.waitForSelector(".pv-chip");
    // Ook de radar onder "Alle lijsten" openen: die las vroeger live-layers.json.
    await page.click(".pv-more > summary");
    await page.locator(".view-radar > summary").click();
    await page.waitForTimeout(1500);
    assert.equal(gevraagd.filter((p) => p === "/history/live-layers.json").length, 0, "live-layers.json opgevraagd");
    assert.ok(gevraagd.includes("/history/radar.json"), "de radar komt uit radar.json");
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test("de plekpagina toont de tegels binnen 3 s, ook als alle verzoeken naar geodata geblokkeerd zijn", async (st) => {
    const stand = await standVanDeOchtend(st);
    const { page, context, errors, extern, start } = await openStraat(baseUrl, { stand, bronnen: "geblokkeerd" });
    // De tegel "werken gepland" toont een getal (niet "…" of "?"), uit de stand van de ochtend.
    await page.waitForFunction(() => /^\d+$/.test(document.querySelector(".pv-place .pv-stat.pv-stat-planned strong")?.textContent.trim() || ""), null, { timeout: Math.max(1, 3000 - (Date.now() - start)) }).catch(() => {});
    const duur = Date.now() - start;
    assert.ok(duur < 3000, `tegels na ${duur} ms`);
    // Gepland: het werk, het parkeerverbod en de inname van de verzonnen ochtend.
    assert.equal(await page.locator(".pv-place .pv-stat.pv-stat-planned strong").innerText(), "3");
    await page.locator('.pv-results .pv-row[data-uid="works:990001"]').waitFor({ timeout: 2000 });
    assert.ok(extern.some((u) => /geodata\.antwerpen\.be|geo\.api\.vlaanderen\.be/.test(u)), "de pagina probeerde live na te kijken");
    // Live lukt niet: de stand van de ochtend blijft staan, met een eerlijke zin.
    await page.waitForFunction(() => /lukte nu niet/.test(document.querySelector(".pv-place .pv-stand")?.textContent || ""), null, { timeout: 10000 });
    assert.equal((await page.locator(".pv-place .pv-stand").innerText()).trim(), "Live nakijken lukte nu niet. Je ziet de stand van de verversing van 05:22.");
    // Een schermlezer hoort de zin veranderen.
    assert.equal(await page.locator(".pv-place .pv-stand").getAttribute("role"), "status");
    assert.equal(await page.locator('.pv-results .pv-row[data-uid="works:990001"]').count(), 1, "het werk van de ochtend blijft staan");
    assert.equal(await page.locator(".pv-place .pv-place-failed").count(), 0, "geen melding 'onvolledig': de stand van de ochtend is er");
    // P9: op een gsm staat de kaart onder de lijst; ze laadt pas als je erheen scrolt. Geen kaartbibliotheek,
    // geen stijl en geen tegels tijdens het eerste scherm.
    assert.deepEqual(extern.filter((u) => /openfreemap|maplibre-gl|leaflet|tile\.openstreetmap/.test(u)), [], "kaartverzoeken op het eerste scherm");
    assert.deepEqual(errors, []);
    await context.close();
  });

  // P9 en het budget van P5: op een groot scherm laadt de kaart naast de lijst, maar pas als de browser even
  // niets te doen heeft. De tegels halen hun 3 s, en daarna staat de kaart er (Leaflet uit de fixture). Op
  // 1280×900 staat de kaart nog net onder het beeld (de bewoner scrolt), op 1280×1200 meteen in beeld.
  for (const height of [900, 1200]) await t.test(`P9: de kaart vertraagt de tegels niet (1280×${height}, stand van de ochtend, alles geblokkeerd behalve Leaflet)`, async (st) => {
    const stand = await standVanDeOchtend(st);
    const { page, context, errors, start } = await openStraat(baseUrl, { stand, bronnen: "geblokkeerd", kaart: "leaflet", width: 1280, height });
    await page.waitForFunction(() => document.querySelector(".pv-place .pv-stat.pv-stat-planned strong")?.textContent.trim() === "3", null, { timeout: Math.max(1, 3000 - (Date.now() - start)) }).catch(() => {});
    const duur = Date.now() - start;
    assert.ok(duur < 3000, `tegels na ${duur} ms`);
    assert.equal(await page.locator(".pv-place .pv-stat.pv-stat-planned strong").innerText(), "3");
    if (height === 900) await page.locator("#buurtkaart .buurt-map").scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector(".buurt-map")?.dataset.kaart === "leaflet", null, { timeout: 10000 })
      .catch(async () => assert.fail(`data-kaart ${await page.locator(".buurt-map").getAttribute("data-kaart")}`));
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test("P9: met databesparing laadt de kaart alleen met de knop", async (st) => {
    const stand = await standVanDeOchtend(st);
    const { page, context, errors, extern } = await openStraat(baseUrl, { stand, bronnen: "geblokkeerd", kaart: "leaflet", width: 1280, height: 1200, zuinig: true });
    await page.waitForFunction(() => /databesparing/.test(document.querySelector(".buurt-map-load")?.textContent || ""), null, { timeout: 10000 });
    await page.locator('.pv-results .pv-row[data-uid="works:990001"]').waitFor({ timeout: 5000 });
    await page.waitForTimeout(2000);
    assert.equal(await page.locator(".buurt-map").getAttribute("data-kaart"), "geen");
    assert.deepEqual(extern.filter((u) => /openfreemap|maplibre-gl|leaflet|tile\.openstreetmap/.test(u)), []);
    await page.locator(".buurt-map-load").click();
    await page.waitForFunction(() => document.querySelector(".buurt-map")?.dataset.kaart === "leaflet", null, { timeout: 10000 });
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test("daarna kijkt de pagina live alleen het kader van de straat na en zegt ze wat nieuw is", async (st) => {
    const stand = await standVanDeOchtend(st);
    const { page, context, errors, extern } = await openStraat(baseUrl, { stand, bronnen: "live" });
    await page.waitForFunction(() => /Live nagekeken/.test(document.querySelector(".pv-place .pv-stand")?.textContent || ""), null, { timeout: 15000 });
    const zin = (await page.locator(".pv-place .pv-stand").innerText()).trim();
    assert.ok(zin.startsWith("Live nagekeken: 1 nieuw sinds 05:22."), zin);
    // A-Sign, de vergunningen en de terrassen faalden: dat staat erbij, en hun stand van de ochtend blijft.
    assert.match(zin, /Live nakijken lukte nu niet voor parkeerverboden en innames, vergunningen, terrassen/);
    await page.locator('.pv-results .pv-row[data-uid="works:990002"]').waitFor({ timeout: 5000 });
    await page.waitForFunction(() => document.querySelector(".pv-place .pv-stat.pv-stat-planned strong")?.textContent.trim() === "4", null, { timeout: 5000 });
    // Alleen het kader van de straat: geen GIPOD-pagina's of A-Sign-blokken van het hele district.
    const gipod = extern.filter((u) => u.includes("/GIPOD/"));
    assert.ok(gipod.length > 0 && gipod.every((u) => !decodeURIComponent(u).includes(DISTRICT_BBOX)), gipod.join("\n"));
    t.diagnostic(`live: ${extern.length} verzoeken naar buiten`);
    assert.ok(extern.length < 30, `${extern.length} verzoeken naar buiten`);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test("axe: geen overtredingen op de plek met de stand van de ochtend en de zin eronder (gsm)", { skip: axePath ? false : "zet AXE_CORE_PATH naar axe.min.js" }, async (st) => {
    const stand = await standVanDeOchtend(st);
    const { page, context } = await openStraat(baseUrl, { stand, bronnen: "geblokkeerd" });
    await page.waitForFunction(() => /lukte nu niet/.test(document.querySelector(".pv-place .pv-stand")?.textContent || ""), null, { timeout: 10000 });
    await page.locator('.pv-results .pv-row[data-uid="works:990001"] .pv-row-btn').click();
    await page.addScriptTag({ path: axePath });
    const violations = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`));
    assert.deepEqual(violations, []);
    await context.close();
  });

  await t.test("met een straal en zonder live bronnen: de zin zegt dat je alleen de straat zelf ziet", async (st) => {
    const stand = await standVanDeOchtend(st);
    const { page, context, errors } = await openStraat(baseUrl, { stand, bronnen: "geblokkeerd", query: "?plek=Kammenstraat&straal=500" });
    await page.waitForFunction(() => /kon nu niet|lukte nu niet/.test(document.querySelector(".pv-place .pv-stand")?.textContent || ""), null, { timeout: 10000 });
    assert.equal((await page.locator(".pv-place .pv-stand").innerText()).trim(), "Rond de straat kon nu niet live geladen worden. Je ziet alleen de straat zelf, met de stand van de verversing van 05:22.");
    assert.deepEqual(errors, []);
    await context.close();
  });

  // Nakijkbevinding (weekzin): met de stand van de ochtend zijn alle lagen geladen, ook die van soorten die uit
  // staan. Een rustige week bleef met alle soorten aan "Rustig", maar werd met ?soort=inspraak "Onbekend ... staan
  // uit", terwijl alles nagekeken was. Verzonnen ochtend: alleen een werk dat pas na de 7 dagen begint.
  await t.test("de komende 7 dagen: met de stand van de ochtend hetzelfde licht en dezelfde zin, welke soorten ook aan staan", async (st) => {
    const map = fs.mkdtempSync(path.join(os.tmpdir(), "snelheid-e2e-"));
    st.after(() => fs.rmSync(map, { recursive: true, force: true }));
    fixture.maakWerkmap(map);
    await fixture.bouw(map, { bronnenDoc: await fixture.bronnenUitLiveLagen({ works: [fixture.werk()] }) });
    const lees = (rel) => fs.readFileSync(path.join(map, rel), "utf8");
    const index = JSON.parse(lees("site/straat-index.json"));
    const stand = { index: lees("site/straat-index.json"), bestanden: Object.fromEntries(Object.keys(index.straten).map((id) => [id, lees(`site/straat/${id}.json`)])) };
    const zinnen = [];
    for (const query of ["?plek=Kammenstraat", "?plek=Kammenstraat&soort=inspraak", "?plek=Kammenstraat&soort=evenementen"]) {
      const { page, context, errors } = await openStraat(baseUrl, { stand, bronnen: "geblokkeerd", query, feed: proefFeed("2099-03-10", []) });
      await page.waitForFunction(() => /lukte nu niet/.test(document.querySelector(".pv-place .pv-stand")?.textContent || ""), null, { timeout: 10000 });
      await page.waitForFunction(() => document.querySelector(".pv-dezeweek") && !/nog geladen/.test(document.querySelector(".pv-dezeweek").textContent), null, { timeout: 10000 });
      const week = page.locator(".pv-dezeweek");
      zinnen.push([query, (await week.getAttribute("class")).match(/pv-dezeweek-(\S+)/)[1], (await week.innerText()).trim()]);
      assert.deepEqual(errors, []);
      await context.close();
    }
    for (const [query, licht, zin] of zinnen) {
      assert.equal(licht, "rustig", `${query}: ${zin}`);
      assert.equal(zin.replace(/\s+/g, " "), "Rustig De komende 7 dagen in jouw straat: rustig. Geen werken, parkeerverboden of evenementen gepland.", query);
    }
  });

  for (const [scenario, evenement] of Object.entries(EVENEMENTEN)) await t.test(`dezelfde kaartjes als met alle live lagen (${scenario}): openbaar onderzoek bovenaan, opbouw en afbraak bij het evenement, met en zonder live`, async (st) => {
    // 1. Zoals vroeger: alles live voor het hele district (geen straatbestanden).
    const basis = await openStraat(baseUrl, { stand: null, bronnen: "volledig", inzage: INZAGE, uitleg: UITLEG, evenement });
    await basis.page.locator('.pv-results section.pv-day[aria-label="Openbaar onderzoek: bezwaar indienen kan nu"] .pv-row').first().waitFor({ timeout: 20000 });
    await basis.page.locator('.pv-results .pv-row[data-uid="publicSpace:dossier:ET2099000077"]').waitFor({ timeout: 20000 });
    await basis.page.locator('.pv-results .pv-row[data-uid="works:990001"]').waitFor({ timeout: 20000 });
    await basis.page.locator('.pv-results .pv-row[data-uid^="publicSpace:sgw:GW2099-000077"]').waitFor({ timeout: 20000 });
    await basis.page.locator('.pv-results .pv-row[data-uid^="publicSpace:parking:PROEF-PV77"]').waitFor({ timeout: 20000 });
    await basis.page.waitForTimeout(500);
    const verwacht = await watJeZiet(basis.page);
    const kaart = verwacht.open["publicSpace:dossier:ET2099000077"];
    if (scenario === "opbouw en afbraak elders") assert.match(kaart, /Opbouw vanaf .*12 maart en afbraak tot .*16 maart/, kaart);
    else assert.match(kaart, /Opbouw vanaf .*10 maart en afbraak tot .*13 maart/, kaart);
    // De werfzone: met omleiding, twee fasen; het parkeerverbod: ook in de twee andere straten.
    const alles = JSON.stringify(verwacht);
    assert.match(alles, /Werfzone met omleiding/);
    assert.match(alles, /2 fasen/i);
    assert.match(alles, /Kammenstraat \+ 2 andere straten/);
    // 2. De stand van de ochtend: de echte bouwer, op de items die de browser hierboven zelf maakte.
    const lagen = await basis.page.evaluate(() => { const l = window.PUBLIC_AGENDA_LIVE_STREETS || {}; return { works: l.works, publicSpace: l.publicSpace, permits: l.permits }; });
    assert.deepEqual(basis.errors, []);
    await basis.context.close();
    const map = fs.mkdtempSync(path.join(os.tmpdir(), "snelheid-e2e-"));
    st.after(() => fs.rmSync(map, { recursive: true, force: true }));
    fixture.maakWerkmap(map, { uitleg: UITLEG });
    await fixture.bouw(map, { bronnenDoc: await fixture.bronnenUitLiveLagen(lagen) });
    const lees = (rel) => fs.readFileSync(path.join(map, rel), "utf8");
    const index = JSON.parse(lees("site/straat-index.json"));
    const stand = { index: lees("site/straat-index.json"), bestanden: Object.fromEntries(Object.keys(index.straten).map((id) => [id, lees(`site/straat/${id}.json`)])) };
    // 3. Snel, zonder live bronnen, en snel met live alleen het kader van de straat.
    for (const [bronnen, klaar] of [["geblokkeerd", /lukte nu niet/], ["volledig", /Live nagekeken/]]) {
      const snel = await openStraat(baseUrl, { stand, bronnen, inzage: INZAGE, uitleg: UITLEG, evenement });
      await snel.page.waitForFunction((re) => new RegExp(re).test(document.querySelector(".pv-place .pv-stand")?.textContent || ""), klaar.source, { timeout: 15000 });
      await snel.page.waitForTimeout(500);
      assert.deepEqual(await watJeZiet(snel.page), verwacht, `snel, bronnen ${bronnen}`);
      if (bronnen === "volledig") assert.match(await snel.page.locator(".pv-place .pv-stand").innerText(), /^Live nagekeken: niets nieuw sinds 05:22\.$/);
      assert.deepEqual(snel.errors, []);
      await snel.context.close();
    }
  });

  await t.test("met een straal van 250 m: dezelfde kaartjes als met alle live lagen, ook voor een parkeerverbod en een evenement in een buurstraat", async (st) => {
    const query = "?plek=Kammenstraat&straal=250&periode=alles";
    const opties = { inzage: INZAGE, uitleg: UITLEG, query, buren: true, width: 1280, height: 900 };
    // 1. Zoals vroeger: alles live voor het hele district.
    const basis = await openStraat(baseUrl, { ...opties, stand: null, bronnen: "volledig" });
    const buurVerbod = basis.page.locator('.pv-results .pv-row[data-uid^="publicSpace:parking:PROEF-PV78"]');
    await buurVerbod.first().waitFor({ timeout: 20000 });
    await basis.page.locator('.pv-results .pv-row[data-uid="publicSpace:dossier:ET2099000078"]').waitFor({ timeout: 20000 });
    await basis.page.locator('.pv-results .pv-row[data-uid="works:990001"]').waitFor({ timeout: 20000 });
    await basis.page.waitForTimeout(500);
    const verwacht = await watJeZiet(basis.page);
    // Het parkeerverbod in de buurstraat geldt ook op twee plaatsen ver weg; het evenement heeft opbouw en
    // afbraak ver weg, met een parkeerverbod in de Huikstraat.
    assert.match(verwacht.open["publicSpace:parking:PROEF-PV78|L1"], /Huikstraat \+ 2 andere straten\nToon alle 3 straten/);
    const buurEvenement = verwacht.open["publicSpace:dossier:ET2099000078"];
    assert.match(buurEvenement, /Opbouw vanaf .*12 maart en afbraak tot .*16 maart/, buurEvenement);
    assert.match(buurEvenement, /Parkeerverbod in Huikstraat/, buurEvenement);
    const lagen = await basis.page.evaluate(() => { const l = window.PUBLIC_AGENDA_LIVE_STREETS || {}; return { works: l.works, publicSpace: l.publicSpace, permits: l.permits }; });
    assert.deepEqual(basis.errors, []);
    await basis.context.close();
    // 2. De stand van de ochtend: de echte bouwer, op de items die de browser hierboven zelf maakte.
    const map = fs.mkdtempSync(path.join(os.tmpdir(), "snelheid-e2e-"));
    st.after(() => fs.rmSync(map, { recursive: true, force: true }));
    fixture.maakWerkmap(map, { uitleg: UITLEG });
    await fixture.bouw(map, { bronnenDoc: await fixture.bronnenUitLiveLagen(lagen) });
    const lees = (rel) => fs.readFileSync(path.join(map, rel), "utf8");
    const index = JSON.parse(lees("site/straat-index.json"));
    const stand = { index: lees("site/straat-index.json"), bestanden: Object.fromEntries(Object.keys(index.straten).map((id) => [id, lees(`site/straat/${id}.json`)])) };
    // 3. Snel, met live het kader van de straat plus de straal: de dossiers in de buurstraat met al hun rijen.
    const snel = await openStraat(baseUrl, { ...opties, stand, bronnen: "volledig" });
    await snel.page.waitForFunction(() => { const t = document.querySelector(".pv-place .pv-stand")?.textContent || ""; return /Live nagekeken/.test(t) && !/laadt nog/.test(t); }, null, { timeout: 20000 });
    await snel.page.waitForTimeout(500);
    assert.deepEqual(await watJeZiet(snel.page), verwacht);
    assert.match(await snel.page.locator(".pv-place .pv-stand").innerText(), /^Live nagekeken: niets nieuw sinds 05:22\.$/);
    // De andere rijen kwamen op dossiernummer, niet met de A-Sign-blokken van het hele district.
    const vraag = (u) => decodeURIComponent(u.replace(/\+/g, " "));
    // Eén vraag per laag (20: parkeerverboden, 22 en 23: innames, 47 en 48: werfzones), met de dossiers uit het kader.
    const dossierVragen = snel.extern.map(vraag).filter((u) => /returnIdsOnly=true/.test(u)).map((u) => [Number(/MapServer\/(\d+)\//.exec(u)?.[1]), /(?:Dossiernummer|dossierNummer|reference_id) IN \(([^)]*)\)/.exec(u)?.[1]]).filter(([, lijst]) => lijst);
    assert.deepEqual(dossierVragen.sort((a, b) => a[0] - b[0]), [[20, "'PROEF-PV77','PROEF-PV78'"], [22, "'ET2099000077','ET2099000078'"], [23, "'ET2099000077','ET2099000078'"], [47, "'GW2099-000077'"], [48, "'GW2099-000077'"]]);
    const idsVragen = snel.extern.map(vraag).filter((u) => /\/P_ASign\/ASign\/MapServer\/\d+\/query/.test(u) && /returnIdsOnly=true/.test(u));
    assert.ok(idsVragen.every((u) => /(Dossiernummer|dossierNummer|reference_id) IN \('/.test(u) || (/geometry=/.test(u) && !u.includes(DISTRICT_BBOX))), `geen A-Sign van het hele district:\n${idsVragen.join("\n")}`);
    assert.deepEqual(snel.errors, []);
    await snel.context.close();
  });

  // ---- P9: de legenda en de buurtkaart ----
  const CAT_VAN = { evenement: "cat-festival", werken: "cat-works", verkeer: "cat-publicSpace", vergunning: "cat-permits" };
  // Het werk, het evenement, de werfzone en het parkeerverbod (de laatste twee met een fase of plaats achter de uid).
  const VIER = ['[data-uid="works:990001"]', '[data-uid="publicSpace:dossier:ET2099000077"]', '[data-uid^="publicSpace:sgw:GW2099-000077"]', '[data-uid^="publicSpace:parking:PROEF-PV77"]'];
  const wachtOpDeVier = async (page) => {
    for (const rij of VIER) await page.locator(`.pv-results .pv-row${rij}`).first().waitFor({ timeout: 20000 });
  };
  // Wat de legenda zegt en wat de lijst toont (alles uitgeklapt), per soort.
  const legendaEnLijst = (page) => page.evaluate(() => {
    const knoppen = [...document.querySelectorAll("#buurtkaart [data-kaartsoort]")].filter((b) => !b.hidden);
    const legenda = Object.fromEntries(knoppen.map((b) => [b.dataset.kaartsoort, Number(b.querySelector(".pv-chip-n").textContent)]));
    const soorten = [...new Set([...document.querySelectorAll(".pv-results [data-soort]")].map((el) => el.dataset.soort))];
    const lijst = Object.fromEntries(soorten.map((s) => [s, new Set([...document.querySelectorAll(`.pv-results [data-soort="${s}"]`)].map((el) => el.dataset.tel)).size]));
    return {
      legenda, lijst,
      sub: Number((document.querySelector(".pv-sub")?.textContent || "").match(/^(\d+) item/)?.[1]),
      cats: [...document.querySelectorAll(".pv-results .pv-row[data-soort]")].filter((r) => r.dataset.soort !== "agenda").map((r) => [r.dataset.soort, [...r.classList].find((c) => c.startsWith("cat-"))]),
      rijen: document.querySelectorAll(".pv-results .pv-row").length,
      hint: document.querySelector("#buurtkaart .buurt-leg-hint")?.textContent || "",
    };
  });
  // Toegankelijkheid van de geladen kaart: axe (met AXE_CORE_PATH) en unieke namen voor de regio's: "Kaart" (de
  // zijkolom), "Kaart van district …" (de buurtkaart) en, op de vectorkaart, "Kaartbeeld" (het canvas).
  const kaartToegankelijk = async (page, verwacht) => {
    const regios = await page.evaluate(() => [...document.querySelectorAll('[role="region"]')].map((r) => r.getAttribute("aria-label")).filter((n) => /kaart/i.test(n || "")));
    assert.deepEqual(regios.sort(), [...verwacht].sort());
    if (!axePath) return;
    await page.addScriptTag({ path: axePath });
    const violations = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`));
    assert.deepEqual(violations, []);
  };
  const REGIO_KAART = ["Kaart", "Kaart van district Antwerpen met de agenda in je buurt"];
  await t.test("P9: de tellers in de legenda zijn gelijk aan de lijst, volledig live en met de stand van de ochtend; de legenda filtert alleen de kaart", async (st) => {
    // Langs twee wegen met dezelfde items: eerst alles live, dan de stand van de ochtend die de echte bouwer maakt
    // uit wat de browser live zag (zoals "dezelfde kaartjes" hierboven), met alles naar buiten geblokkeerd.
    let stand = null;
    for (const [weg, opties] of [["volledig live", { bronnen: "volledig" }], ["stand van de ochtend, alles geblokkeerd", { bronnen: "geblokkeerd" }]]) {
      const { page, context, errors } = await openStraat(baseUrl, { ...opties, stand, inzage: INZAGE, uitleg: UITLEG, query: "?plek=Kammenstraat&periode=alles" });
      await wachtOpDeVier(page);
      if (opties.bronnen === "geblokkeerd") await page.waitForFunction(() => /lukte nu niet/.test(document.querySelector(".pv-place .pv-stand")?.textContent || ""), null, { timeout: 15000 });
      else await page.waitForFunction(() => Array.isArray(window.PUBLIC_AGENDA_LIVE_STREETS?.permits), null, { timeout: 15000 });
      await page.waitForTimeout(300);
      // Alles uitklappen: wat achter "Toon alle N" zit, telt ook.
      for (let i = 0; i < 10 && await page.locator(".pv-results [data-expand]").count(); i += 1) await page.locator(".pv-results [data-expand]").first().click();
      const m = await legendaEnLijst(page);
      t.diagnostic(`${weg}: ${JSON.stringify({ legenda: m.legenda, sub: m.sub })}`);
      assert.deepEqual(m.legenda, m.lijst, `${weg}: legenda en lijst per soort`);
      assert.equal(Object.values(m.legenda).reduce((a, b) => a + b, 0), m.sub, `${weg}: de som van de legenda is het getal boven de lijst`);
      if (opties.bronnen === "volledig") for (const s of ["evenement", "werken", "verkeer", "vergunning"]) assert.ok(m.legenda[s] > 0, `${weg}: ${s}`);
      for (const [soort, cat] of m.cats) assert.equal(cat, CAT_VAN[soort], `${weg}: een rij ${soort} heeft de kleur van de legenda`);
      assert.match(m.hint, /De lijst blijft volledig/);
      // Verkeer uit: alleen de kaart verandert, de lijst en het getal erboven niet.
      const verkeer = page.locator('#buurtkaart [data-kaartsoort="verkeer"]');
      const sub = await page.locator(".pv-sub").innerText();
      await verkeer.click();
      assert.equal(await verkeer.getAttribute("aria-pressed"), "false");
      assert.equal(await verkeer.locator(".buurt-vh").innerText(), "op deze plek, verborgen op de kaart");
      const na = await legendaEnLijst(page);
      assert.equal(na.rijen, m.rijen, `${weg}: de lijst blijft volledig`);
      assert.equal(await page.locator(".pv-sub").innerText(), sub);
      assert.deepEqual(na.legenda, m.legenda, `${weg}: de tellers in de lijst blijven`);
      const breedte = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(breedte <= 390, `${weg}: horizontale scroll (${breedte} px)`);
      if (!stand) {
        const lagen = await page.evaluate(() => { const l = window.PUBLIC_AGENDA_LIVE_STREETS || {}; return { works: l.works, publicSpace: l.publicSpace, permits: l.permits }; });
        const map = fs.mkdtempSync(path.join(os.tmpdir(), "snelheid-e2e-"));
        st.after(() => fs.rmSync(map, { recursive: true, force: true }));
        fixture.maakWerkmap(map, { uitleg: UITLEG });
        await fixture.bouw(map, { bronnenDoc: await fixture.bronnenUitLiveLagen(lagen) });
        const lees = (rel) => fs.readFileSync(path.join(map, rel), "utf8");
        const index = JSON.parse(lees("site/straat-index.json"));
        stand = { index: lees("site/straat-index.json"), bestanden: Object.fromEntries(Object.keys(index.straten).map((id) => [id, lees(`site/straat/${id}.json`)])) };
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
  });

  await t.test("P9: de kaart valt terug op Leaflet als de tegels niet laden; kaart en lijst wijzen naar elkaar", async () => {
    const { page, context, errors, extern } = await openStraat(baseUrl, { stand: null, bronnen: "volledig", kaart: "leaflet", width: 1280, height: 900, inzage: INZAGE, uitleg: UITLEG, query: "?plek=Kammenstraat&periode=alles" });
    await wachtOpDeVier(page);
    await page.locator("#buurtkaart .buurt-map").scrollIntoViewIfNeeded();
    await page.locator(".buurt-map[data-kaart=leaflet] .leaflet-container").waitFor({ timeout: 10000 });
    await page.waitForFunction(() => Array.isArray(window.PUBLIC_AGENDA_LIVE_STREETS?.permits), null, { timeout: 15000 });
    // Elke soort van de live lagen staat op de kaart, als SVG-pad met een klasse per soort.
    await page.waitForFunction(() => ["werken", "evenement", "verkeer", "vergunning"].every((s) => document.querySelector(`#buurtkaart path.kaart-${s}`)), null, { timeout: 15000 })
      .catch(async () => assert.fail(`niet elke soort op de kaart: ${await page.evaluate(() => [...document.querySelectorAll("#buurtkaart path.kaart-obj")].map((p) => p.getAttribute("class")).join(" | "))}`));
    const zin = await page.locator(".buurt-status").innerText();
    assert.match(zin, /^\d+ in de lijst, \d+ op de kaart in /);
    const opKaart = Number(await page.locator(".buurt-map").getAttribute("data-op-kaart"));
    assert.ok(opKaart > 0, `data-op-kaart ${opKaart}`);
    // Kaartverzoeken naar buiten: Leaflet (2) en de tegels van OpenStreetMap (geweigerd). Geen MapLibre.
    const kaartVerzoeken = extern.filter((u) => /openfreemap|maplibre-gl|leaflet|tile\.openstreetmap/.test(u));
    t.diagnostic(`kaartverzoeken naar buiten: ${kaartVerzoeken.length} (${extern.length} in totaal)`);
    assert.ok(kaartVerzoeken.length <= 20, kaartVerzoeken.join("\n"));
    assert.equal(extern.filter((u) => /maplibre-gl/.test(u)).length, 0, "MapLibre gedownload");
    // Met WebGL probeerde de pagina eerst de vectorkaart: de stijl van OpenFreeMap (die faalt hier), en dan
    // niet eens MapLibre. Zonder WebGL meteen Leaflet.
    const webgl = await page.evaluate(() => { const c = document.createElement("canvas"); return Boolean(c.getContext("webgl2") || c.getContext("webgl")); });
    if (webgl) assert.ok(extern.some((u) => u.startsWith("https://tiles.openfreemap.org/styles/")), "geen poging tot de vectorkaart");
    await kaartToegankelijk(page, REGIO_KAART);
    // Van de kaart naar de lijst: het werk aantikken, dan "Toon in de lijst".
    await page.locator("#buurtkaart path.kaart-werken").first().click();
    await page.locator('#buurtkaart .leaflet-popup [data-open-uid="works:990001"]').click();
    await page.waitForFunction(() => document.querySelector('.pv-results .pv-row.open[data-uid="works:990001"]') && document.activeElement?.matches('.pv-row[data-uid="works:990001"] .pv-row-btn'), null, { timeout: 5000 })
      .catch(async () => assert.fail(`niet open of geen focus: ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120))}`));
    // Van de lijst naar de kaart: het evenement openklappen markeert het op de kaart.
    const dossier = "publicSpace:dossier:ET2099000077";
    await page.locator(`.pv-results .pv-row[data-uid="${dossier}"] .pv-row-btn`).click();
    await page.waitForFunction((uid) => document.querySelector(".buurt-map")?.dataset.gemarkeerd === uid, dossier, { timeout: 5000 });
    assert.ok(await page.locator("#buurtkaart .is-gemarkeerd").count() >= 1);
    // De legenda: verkeer uit haalt het van de kaart, en er staat minder op de kaart.
    await page.locator('#buurtkaart [data-kaartsoort="verkeer"]').click();
    await page.waitForFunction(() => !document.querySelector("#buurtkaart path.kaart-verkeer"), null, { timeout: 5000 });
    assert.ok(Number(await page.locator(".buurt-map").getAttribute("data-op-kaart")) < opKaart);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test("P9: zonder kaartbestanden staat de legenda er toch, met haar tellers", async (st) => {
    const stand = await standVanDeOchtend(st);
    const { page, context, errors } = await openStraat(baseUrl, { stand, bronnen: "geblokkeerd", width: 1280, height: 900 });
    // De kaart staat onder de kop van de plek: de bewoner scrolt erheen, en dan probeert ze te laden.
    await page.locator('.pv-results .pv-row[data-uid="works:990001"]').waitFor({ timeout: 5000 });
    await page.locator("#buurtkaart .buurt-map").scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector(".buurt-map-load")?.textContent === "Kaart niet beschikbaar · opnieuw proberen", null, { timeout: 15000 })
      .catch(async () => assert.fail(await page.evaluate(() => JSON.stringify({ knop: document.querySelector(".buurt-map-load")?.textContent, kaart: document.querySelector(".buurt-map")?.dataset.kaart }))));
    await page.locator('.pv-results .pv-row[data-uid="works:990001"]').waitFor({ timeout: 5000 });
    const legenda = page.locator("#buurtkaart .buurt-legenda");
    await legenda.waitFor({ state: "visible", timeout: 5000 });
    assert.equal(await legenda.getAttribute("role"), "group");
    assert.ok(await legenda.locator("[data-kaartsoort]:not([hidden]) .pv-chip-n").count() > 0);
    assert.equal(await page.locator(".buurt-map").getAttribute("data-kaart"), "geen");
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test("P9: \"Toon op de kaart\" op gsm: de kaart komt in beeld, laadt en markeert het kaartje", async () => {
    const { page, context, errors } = await openStraat(baseUrl, { stand: null, bronnen: "volledig", kaart: "leaflet", inzage: INZAGE, uitleg: UITLEG });
    const rij = page.locator('.pv-results .pv-row[data-uid^="publicSpace:parking:PROEF-PV77"]').first();
    await rij.waitFor({ timeout: 20000 });
    const uid = await rij.getAttribute("data-uid");
    await rij.locator(".pv-row-btn").click();
    await rij.locator(".pv-op-kaart").click();
    await page.waitForFunction((u) => { const m = document.querySelector(".buurt-map"); return m?.dataset.kaart === "leaflet" && m.dataset.gemarkeerd === u; }, uid, { timeout: 10000 })
      .catch(async () => assert.fail(`kaart ${await page.locator(".buurt-map").getAttribute("data-kaart")}, gemarkeerd "${await page.locator(".buurt-map").getAttribute("data-gemarkeerd")}"`));
    const inBeeld = await page.evaluate(() => { const r = document.querySelector("#buurtkaart .buurt-map").getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; });
    assert.equal(inBeeld, true, "de kaart staat in beeld");
    assert.match(await page.locator(".buurt-status").innerText(), /Gemarkeerd op de kaart: /);
    assert.deepEqual(errors, []);
    await context.close();
  });

  // ---- P9-review: nakijkbevindingen bij de buurtkaart ----
  // (1) De legenda zei "N in de lijst" met N uit de lijst bij periode "alles"; de zin eronder zegt "X in de lijst"
  // met X wat de lijst nu echt toont. In de week, de tijdlijn of op een gekozen dag stonden er zo twee verschillende
  // getallen "in de lijst" in één kaartblok. De legenda telt wat er op deze plek is (zoals het getal boven de lijst);
  // alleen de zin eronder zegt "in de lijst". Verzonnen: een voorstelling op drie avonden in de straat.
  const kaartTellers = (page) => page.evaluate(() => {
    const knoppen = [...document.querySelectorAll("#buurtkaart [data-kaartsoort]")].filter((b) => !b.hidden);
    const zinnen = knoppen.map((b) => `${b.querySelector(".pv-chip-n").textContent}${b.querySelector(".buurt-vh").textContent}`);
    const status = document.querySelector("#buurtkaart .buurt-status")?.textContent || "";
    const getallen = [...new Set([...zinnen, status].flatMap((z) => [...z.matchAll(/(\d+) in de lijst/g)].map((m) => Number(m[1]))))];
    return { zinnen, status, getallen, som: knoppen.reduce((n, b) => n + Number(b.querySelector(".pv-chip-n").textContent), 0), sub: Number((document.querySelector(".pv-sub")?.textContent || "").match(/^(\d+) item/)?.[1]) };
  });
  const DRIE_AVONDEN = proefFeed("2099-03-10", (stempel) => ["2099-03-11", "2099-03-12", "2099-03-13"].map((dag, i) => kalenderItem(stempel, {
    id: `e2e-reeks-${i + 1}`, externalId: `e2e-reeks-${i + 1}`, title: "Proefvoorstelling in de straat (e2e)", date: dag, timeSlot: "20:00",
    location: "Kammenstraat, 2000 Antwerpen", postcodes: ["2000"],
  })));
  await t.test("P9: onder de kaart nooit twee getallen 'in de lijst': in de week, de tijdlijn en op een gekozen dag", async () => {
    const { page, context, errors } = await openStraat(baseUrl, { stand: null, bronnen: "volledig", inzage: INZAGE, uitleg: UITLEG, feed: DRIE_AVONDEN, width: 1280, height: 900, query: "?plek=Kammenstraat&periode=week" });
    await page.locator('.pv-results .pv-row[data-uid="publicSpace:dossier:ET2099000077"]').waitFor({ timeout: 20000 });
    await page.locator('.pv-results .pv-row[data-uid="agenda:e2e-reeks-1"]').waitFor({ timeout: 20000 });
    await page.waitForFunction(() => Array.isArray(window.PUBLIC_AGENDA_LIVE_STREETS?.permits) && /in de lijst/.test(document.querySelector("#buurtkaart .buurt-status")?.textContent || ""), null, { timeout: 15000 });
    const stappen = [
      ["lijst, periode week", async () => {}],
      ["tijdlijn", () => page.click('[data-mode="tijdlijn"]')],
      ["tijdlijn, zaterdag 14 maart", () => page.click('[data-tl-dag="2099-03-14"]')],
      ["lijst, periode alles", async () => { await page.click('[data-mode="lijst"]'); await page.click('[data-period="alles"]'); }],
    ];
    for (const [stap, doe] of stappen) {
      await doe();
      await page.waitForTimeout(400);
      const m = await kaartTellers(page);
      t.diagnostic(`${stap}: ${JSON.stringify(m)}`);
      assert.ok(m.getallen.length === 1, `${stap}: getallen "in de lijst": ${JSON.stringify(m)}`);
      assert.match(m.status, /^\d+ in de lijst, \d+ op de kaart in Kammenstraat/, stap);
      for (const z of m.zinnen) assert.match(z, /^\d+ op deze plek, (\d+|verborgen) op de kaart$/, stap);
      assert.equal(m.som, m.sub, `${stap}: de legenda telt wat er op deze plek is, zoals het getal boven de lijst`);
    }
    assert.deepEqual(errors, []);
    await context.close();
  });

  // (2) Privacy, (4) een eigen vorm per soort en (5) kaartjes op hetzelfde punt: het parkeerverbod (PROEF-PV77, L1)
  // en de aanvraag (20990077) liggen in de nagebootste stad allebei bij het midden van de Kammenstraat. Op de
  // Leaflet-kaart waren het twee identieke ringen op elkaar: het parkeerverbod was nooit aan te tikken. En de
  // parkeerverboden van het evenement (opbouw en afbraak elders) stonden er exact.
  const ongeveerPaden = (page) => page.evaluate(() => Object.fromEntries(["verkeer", "vergunning"].map((s) => {
    const p = [...document.querySelectorAll(`#buurtkaart path.kaart-${s}.kaart-ongeveer`)].find((el) => el.getBoundingClientRect().width > 0);
    return [s, p ? { d: p.getAttribute("d"), streep: getComputedStyle(p).strokeDasharray } : null];
  })));
  await t.test("P9: op de kaart heeft elke plek bij benadering de vorm van haar soort, elk kaartje op dat punt is aan te tikken, en van een evenement staan de parkeerverboden bij benadering", async () => {
    const { page, context, errors } = await openStraat(baseUrl, { stand: null, bronnen: "volledig", kaart: "leaflet", width: 1280, height: 900, inzage: INZAGE, uitleg: UITLEG, query: "?plek=Kammenstraat&periode=alles" });
    await wachtOpDeVier(page);
    await page.waitForFunction(() => Array.isArray(window.PUBLIC_AGENDA_LIVE_STREETS?.permits), null, { timeout: 15000 });
    await page.locator("#buurtkaart .buurt-map").scrollIntoViewIfNeeded();
    await page.locator(".buurt-map[data-kaart=leaflet] .leaflet-container").waitFor({ timeout: 10000 });
    await page.waitForFunction(() => document.querySelector("#buurtkaart path.kaart-verkeer.kaart-ongeveer") && document.querySelector("#buurtkaart path.kaart-vergunning.kaart-ongeveer"), null, { timeout: 15000 });
    await page.waitForTimeout(600); // het inzoomen op de straat
    // Een eigen vorm (niet alleen een andere kleur), en een eigen rand.
    const vormen = await ongeveerPaden(page);
    assert.ok(vormen.verkeer && vormen.vergunning, JSON.stringify(vormen));
    assert.notEqual(vormen.verkeer.d, vormen.vergunning.d, "parkeerverbod en vergunning: dezelfde vorm");
    assert.notEqual(vormen.verkeer.streep, vormen.vergunning.streep, "parkeerverbod en vergunning: dezelfde rand");
    // De legenda toont die vormen ook.
    assert.equal(await page.locator('#buurtkaart [data-kaartsoort="verkeer"] .buurt-teken-vierkant').count(), 1);
    assert.equal(await page.locator('#buurtkaart [data-kaartsoort="evenement"] .buurt-teken-ruit').count(), 1);
    assert.equal(await page.locator('#buurtkaart [data-kaartsoort="vergunning"] .buurt-teken-ring').count(), 1);
    // Elk van de twee is ergens zelf aan te tikken, en de popup noemt dan allebei de kaartjes op dat punt.
    for (const soort of ["verkeer", "vergunning"]) {
      const punt = await page.evaluate((s) => {
        const paden = [...document.querySelectorAll(`#buurtkaart path.kaart-${s}.kaart-ongeveer`)];
        for (const p of paden) {
          const r = p.getBoundingClientRect();
          for (let i = 1; i < 12; i += 1) for (let j = 1; j < 12; j += 1) {
            const x = r.left + (r.width * i) / 12, y = r.top + (r.height * j) / 12;
            if (document.elementFromPoint(x, y) === p) return [x, y];
          }
        }
        return null;
      }, soort);
      assert.ok(punt, `${soort}: nergens aan te tikken (een ander kaartje ligt erover)`);
      await page.mouse.click(punt[0], punt[1]);
      const popup = page.locator("#buurtkaart .leaflet-popup");
      await popup.waitFor({ timeout: 5000 });
      const uids = await popup.locator("[data-open-uid]").evaluateAll((knoppen) => knoppen.map((k) => k.dataset.openUid));
      assert.ok(uids.includes("permits:permit:20990077") && uids.some((u) => u.startsWith("publicSpace:parking:PROEF-PV77")), `${soort}: de popup noemt ${uids.join(", ")}`);
      assert.match(await popup.innerText(), /bij benadering \(privacy\)/);
      // Sluiten met een klik op het kruisje (dispatchEvent): de klok staat vast in deze toets (setFixedTime), en
      // Leaflet meet zijn pan-animatie met new Date(), dus autoPan schuift de popup hier nooit helemaal in beeld.
      await popup.locator(".leaflet-popup-close-button").dispatchEvent("click");
      await popup.waitFor({ state: "detached", timeout: 5000 });
    }
    // Van het evenement staat het parcours exact; de parkeerverboden van opbouw en afbraak bij benadering (een
    // omleiding en een verkeersvrije zone van een evenement staan ook exact: tests/kaart-lagen.test.mjs).
    const evenement = await page.evaluate(() => [...document.querySelectorAll("#buurtkaart path.kaart-evenement")].map((p) => p.getAttribute("class")));
    assert.ok(evenement.some((c) => /kaart-parcours/.test(c)), `geen parcours: ${evenement.join(" | ")}`);
    assert.ok(evenement.some((c) => /kaart-ongeveer/.test(c)), `de innames van het evenement ontbreken: ${evenement.join(" | ")}`);
    assert.deepEqual(evenement.filter((c) => !/kaart-parcours|kaart-ongeveer/.test(c)), [], "een inname van het evenement staat exact op de kaart");
    assert.match(await page.locator("#buurtkaart .buurt-attrib").innerText(), /innames \(ook die van een evenement\)[^.]*bij benadering/);
    assert.deepEqual(errors, []);
    await context.close();
  });

  // (6) In donkere modus was --pa-ink-strong wit: de gekozen straat en de markering werden wit op de lichte tegels
  // van OpenStreetMap (ook gedimd blijven die licht). De inkt volgt de onderkaart die je ziet, niet het thema.
  const KAART_LAND = [242, 239, 233]; // land op de tegels van OpenStreetMap (#f2efe9)
  const lum = ([r, g, b]) => { const c = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const verhouding = (a, b) => { const [h, l] = [lum(a), lum(b)].sort((x, y) => y - x); return (h + 0.05) / (l + 0.05); };
  // "rgb(18, 24, 33)" of "#121821" (een CSS-variabele) naar [r, g, b].
  const rgb = (tekst) => {
    const hex = /^#([0-9a-f]{6})$/i.exec(String(tekst).trim());
    if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16));
    return (String(tekst).match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
  };
  await t.test("P9: in donkere modus blijven de gekozen straat en de markering donker (minstens 3:1) op de lichte tegels van Leaflet", async () => {
    const { page, context, errors } = await openStraat(baseUrl, { stand: null, bronnen: "volledig", kaart: "leaflet", width: 1280, height: 900, inzage: INZAGE, uitleg: UITLEG, query: "?plek=Kammenstraat&periode=alles", colorScheme: "dark" });
    await wachtOpDeVier(page);
    await page.locator("#buurtkaart .buurt-map").scrollIntoViewIfNeeded();
    await page.locator(".buurt-map[data-kaart=leaflet] .leaflet-container").waitFor({ timeout: 10000 });
    await page.waitForFunction(() => document.querySelector("#buurtkaart path.kaart-werken"), null, { timeout: 15000 });
    // De site staat echt in donker: de gewone inkt is licht.
    assert.ok(lum(rgb(await page.evaluate(() => getComputedStyle(document.querySelector(".pv-sub")).color))) > 0.4, "de site staat niet in donker");
    await page.locator('.pv-results .pv-row[data-uid="works:990001"] .pv-row-btn').click();
    await page.waitForFunction(() => document.querySelector("#buurtkaart path.kaart-werken.is-gemarkeerd"), null, { timeout: 5000 });
    const markering = await page.evaluate(() => getComputedStyle(document.querySelector("#buurtkaart path.kaart-werken.is-gemarkeerd")).stroke);
    assert.ok(verhouding(rgb(markering), KAART_LAND) >= 3, `markering ${markering}: ${verhouding(rgb(markering), KAART_LAND).toFixed(2)}:1`);
    // De gekozen straat (een pad met een klasse, zodat ze na te meten is), met een lichte rand eronder.
    const straat = await page.evaluate(() => { const p = document.querySelector("#buurtkaart path.kaart-straat"); return p ? getComputedStyle(p).stroke : ""; });
    assert.ok(straat, "de gekozen straat staat niet als pad op de kaart");
    assert.ok(verhouding(rgb(straat), KAART_LAND) >= 3, `straat ${straat}: ${verhouding(rgb(straat), KAART_LAND).toFixed(2)}:1`);
    assert.ok(await page.locator("#buurtkaart path.kaart-straat-rand").count() > 0, "geen rand onder de straat");
    assert.equal(await page.locator(".buurt-map").getAttribute("data-onderkaart"), "licht");
    assert.deepEqual(errors, []);
    await context.close();
  });

  // (7) Op een laptop werd de vaste zijkolom met de legenda hoger dan het venster: de onderste knoppen kregen de focus
  // buiten beeld. Verzonnen: 40 activiteiten in de straat, zodat de lijst lang is en de kolom vast staat.
  const VEEL = proefFeed("2099-03-10", (stempel) => Array.from({ length: 40 }, (_, i) => kalenderItem(stempel, {
    id: `e2e-lang-${i + 1}`, externalId: `e2e-lang-${i + 1}`, title: `Proefactiviteit ${i + 1} (e2e)`, date: `2099-03-${String(11 + (i % 18)).padStart(2, "0")}`, timeSlot: "19:00",
    location: "Kammenstraat, 2000 Antwerpen", postcodes: ["2000"],
  })));
  for (const [width, height] of [[1366, 650], [1280, 720]]) await t.test(`P9: op een laptop (${width}×${height}) blijft elke knop van de vaste kaartkolom in beeld als ze de focus krijgt`, async (st) => {
    const stand = await standVanDeOchtend(st);
    const { page, context, errors } = await openStraat(baseUrl, { stand, bronnen: "geblokkeerd", feed: VEEL, width, height });
    await page.locator('.pv-results .pv-row[data-uid="agenda:e2e-lang-1"]').waitFor({ timeout: 15000 });
    await page.locator("#buurtkaart .buurt-legenda").waitFor({ state: "visible", timeout: 15000 });
    await page.waitForFunction(() => /lukte nu niet/.test(document.querySelector(".pv-place .pv-stand")?.textContent || ""), null, { timeout: 15000 });
    await page.evaluate(() => window.scrollTo(0, 1600));
    await page.waitForTimeout(300);
    assert.ok(await page.evaluate(() => window.scrollY) > 1000, "de lijst is niet lang genoeg");
    await page.locator("#buurtkaart [data-kaartsoort]:not([hidden])").first().focus();
    const buiten = [];
    let bezocht = 0;
    for (let i = 0; i < 40; i += 1) {
      const el = await page.evaluate(() => {
        const a = document.activeElement;
        if (!a?.closest(".pv-aside")) return null;
        const r = a.getBoundingClientRect();
        return { naam: (a.getAttribute("aria-label") || a.textContent || "").trim().slice(0, 50), top: Math.round(r.top), bottom: Math.round(r.bottom), venster: innerHeight };
      });
      if (!el) break;
      bezocht += 1;
      if (el.top < 0 || el.bottom > el.venster) buiten.push(el);
      await page.keyboard.press("Tab");
    }
    assert.ok(bezocht >= 5, `${bezocht} knoppen in de kaartkolom bezocht`);
    assert.deepEqual(buiten, [], "focus buiten beeld");
    assert.deepEqual(errors, []);
    await context.close();
  });

  // (8) en (9) "Toon op de kaart" voor een kaartje zonder plek (de stand van de ochtend heeft geen vormen): de uitleg
  // stond alleen in de zin onder de legenda, op een kleine gsm of met grote tekst buiten beeld; en de focus bleef op
  // de knop in de lijst, boven het venster: de volgende Tab sprong terug naar de lijst.
  for (const [width, height, tekst] of [[320, 640, ""], [360, 740, ""], [390, 844, "200%"]]) await t.test(`P9: "Toon op de kaart" zonder plek (${width}×${height}${tekst ? `, tekst ${tekst}` : ""}): de uitleg staat bij de kaart in beeld, en de focus gaat naar de kaart`, async (st) => {
    const stand = await standVanDeOchtend(st);
    const { page, context, errors } = await openStraat(baseUrl, { stand, bronnen: "geblokkeerd", kaart: "leaflet", width, height });
    if (tekst) await page.evaluate((f) => { document.documentElement.style.fontSize = f; }, tekst);
    const rij = page.locator('.pv-results .pv-row[data-uid="works:990001"]');
    await rij.waitFor({ timeout: 5000 });
    await page.waitForFunction(() => /lukte nu niet/.test(document.querySelector(".pv-place .pv-stand")?.textContent || ""), null, { timeout: 15000 });
    await rij.locator(".pv-row-btn").click();
    await rij.locator(".pv-op-kaart").focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => /geen plek op de kaart/.test(document.querySelector("#buurtkaart .buurt-status")?.textContent || ""), null, { timeout: 10000 });
    await page.waitForFunction(() => document.querySelector(".buurt-map")?.dataset.kaart === "leaflet", null, { timeout: 10000 });
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => {
      const zichtbaar = [...document.querySelectorAll("#buurtkaart *")].filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && /geen plek op de kaart/.test(n.data))
        && !el.closest("[hidden]") && el.getClientRects().length && getComputedStyle(el).visibility !== "hidden");
      const inBeeld = zichtbaar.filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.bottom <= innerHeight; });
      const a = document.activeElement, ra = a?.getBoundingClientRect();
      return { zichtbaar: zichtbaar.map((el) => el.className), inBeeld: inBeeld.map((el) => el.className), focus: a ? `${a.tagName.toLowerCase()}.${a.className}` : "", focusInKaart: Boolean(a?.closest("#buurtkaart")), focusInBeeld: Boolean(ra && ra.bottom > 0 && ra.top < innerHeight) };
    });
    assert.ok(m.inBeeld.length > 0, `de uitleg staat niet in beeld: ${JSON.stringify(m)}`);
    assert.ok(m.focusInKaart && m.focusInBeeld, `de focus: ${JSON.stringify(m)}`);
    assert.deepEqual(errors, []);
    await context.close();
  });

  // (10) Op een trage verbinding haalde de vectorkaart haar wachttijd niet: de bewoner downloadde beide kaarten en zag
  // de kaart later dan met Leaflet alleen. Meldt de browser een verbinding trager dan 4g, dan meteen Leaflet.
  await t.test("P9: op een trage verbinding (de browser schat ze lager dan 4g) meteen Leaflet: geen stijl van OpenFreeMap, geen MapLibre", async (st) => {
    const stand = await standVanDeOchtend(st);
    const { page, context, errors, extern } = await openStraat(baseUrl, { stand, bronnen: "geblokkeerd", kaart: "leaflet", width: 1280, height: 1200, verbinding: { effectiveType: "3g", saveData: false, downlink: 1.6, rtt: 550 } });
    await page.waitForFunction(() => document.querySelector(".buurt-map")?.dataset.kaart === "leaflet", null, { timeout: 15000 })
      .catch(async () => assert.fail(`data-kaart ${await page.locator(".buurt-map").getAttribute("data-kaart")}`));
    const webgl = await page.evaluate(() => { const c = document.createElement("canvas"); return Boolean(c.getContext("webgl2") || c.getContext("webgl")); });
    t.diagnostic(`trage verbinding: WebGL ${webgl}, ${extern.filter((u) => /openfreemap|maplibre-gl/.test(u)).length} verzoeken voor de vectorkaart`);
    assert.deepEqual(extern.filter((u) => /openfreemap|maplibre-gl/.test(u)), [], "de vectorkaart werd toch geprobeerd");
    assert.deepEqual(errors, []);
    await context.close();
  });

  // ---- P9b, ronde 1: nakijkbevindingen bij de buurtkaart ----
  // (1) De melding bij de kaart (.buurt-melding, z-index 1100, over de kaart) verscheen ook bij een gelukte markering,
  // bleef staan tot een andere rij openging en lag boven de popups van Leaflet (z-index 700) en boven de knop in de
  // sluier: op gsm bedekte ze de titel van een popup, en offline met grote tekst de enige knop om de kaart opnieuw te
  // laden. Nu ligt er niets van het kaartblok over de kaart: de melding "geen plek" staat erboven, in de flow.
  // Tekst van #buurtkaart buiten de kaart zelf (en buiten de sluier, die bewust over de kaart ligt) die zichtbaar
  // over `vak` ligt (standaard: het kaartvlak).
  const tekstOver = (page, vak = ".buurt-map") => page.evaluate((sel) => {
    const v = document.querySelector(`#buurtkaart ${sel}`).getBoundingClientRect();
    const raakt = (r) => r.width > 0 && r.height > 0 && r.left < v.right && v.left < r.right && r.top < v.bottom && v.top < r.bottom;
    return [...document.querySelectorAll("#buurtkaart *")]
      .filter((el) => !el.closest(".buurt-map, .buurt-map-veil") && [...el.childNodes].some((n) => n.nodeType === 3 && n.data.trim())
        && getComputedStyle(el).visibility !== "hidden" && [...el.getClientRects()].some(raakt))
      .map((el) => `${el.className}: ${el.textContent.trim().slice(0, 60)}`);
  }, vak);
  await t.test("P9b (1): na een gelukte \"Toon op de kaart\" ligt er geen melding over de kaart, en niets ligt over de popup van een werk (390×844)", async () => {
    const { page, context, errors } = await openStraat(baseUrl, { stand: null, bronnen: "volledig", kaart: "leaflet", inzage: INZAGE, uitleg: UITLEG, query: "?plek=Kammenstraat&periode=alles" });
    await wachtOpDeVier(page);
    await page.waitForFunction(() => Array.isArray(window.PUBLIC_AGENDA_LIVE_STREETS?.permits), null, { timeout: 15000 });
    const dossier = "publicSpace:dossier:ET2099000077";
    const rij = page.locator(`.pv-results .pv-row[data-uid="${dossier}"]`);
    await rij.locator(".pv-row-btn").click();
    await rij.locator(".pv-op-kaart").click();
    await page.waitForFunction((u) => { const m = document.querySelector(".buurt-map"); return m?.dataset.kaart === "leaflet" && m.dataset.gemarkeerd === u; }, dossier, { timeout: 10000 });
    await page.waitForFunction(() => document.querySelector("#buurtkaart path.kaart-werken"), null, { timeout: 10000 });
    await page.waitForTimeout(600);
    // De zin onder de kaart zegt het (aria-live); over de kaart zelf ligt niets.
    assert.match(await page.locator(".buurt-status").innerText(), /Gemarkeerd op de kaart: /);
    const naToon = await tekstOver(page);
    // Een werk aantikken: niets van het kaartblok ligt over zijn popup.
    // (Een plek op de stip waar niets anders bovenop ligt: het gemarkeerde parcours loopt erdoor.)
    const punt = await page.evaluate(() => {
      for (const p of document.querySelectorAll("#buurtkaart path.kaart-werken")) {
        const r = p.getBoundingClientRect();
        for (let i = 1; i < 12; i += 1) for (let j = 1; j < 12; j += 1) {
          const x = r.left + (r.width * i) / 12, y = r.top + (r.height * j) / 12;
          if (document.elementFromPoint(x, y) === p) return [x, y];
        }
      }
      return null;
    });
    assert.ok(punt, `het werk is niet aan te tikken: ${await page.evaluate(() => JSON.stringify({ kaart: document.querySelector("#buurtkaart .buurt-map").getBoundingClientRect(), werken: [...document.querySelectorAll("#buurtkaart path.kaart-werken")].map((p) => { const r = p.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), el?.className?.baseVal ?? el?.className]; }) }))}`);
    await page.mouse.click(punt[0], punt[1]);
    await page.locator("#buurtkaart .leaflet-popup").waitFor({ timeout: 5000 });
    await page.waitForTimeout(300);
    const overPopup = await tekstOver(page, ".leaflet-popup-content-wrapper");
    t.diagnostic(`na "Toon op de kaart": ${JSON.stringify(naToon)}; over de popup: ${JSON.stringify(overPopup)}`);
    assert.deepEqual(overPopup, [], "tekst van het kaartblok ligt over de popup");
    assert.deepEqual(naToon, [], "na een gelukte markering ligt er een melding over de kaart");
    assert.deepEqual(errors, []);
    await context.close();
  });

  for (const [width, height] of [[320, 640], [360, 740], [390, 844], [412, 915]]) await t.test(`P9b (1): offline met tekst 200 % (${width}×${height}): "geen plek" ligt niet over de knop om de kaart opnieuw te laden, en staat in beeld`, async (st) => {
    const stand = await standVanDeOchtend(st);
    const { page, context, errors } = await openStraat(baseUrl, { stand, bronnen: "geblokkeerd", width, height });
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    const rij = page.locator('.pv-results .pv-row[data-uid="works:990001"]');
    await rij.waitFor({ timeout: 5000 });
    await page.waitForFunction(() => /lukte nu niet/.test(document.querySelector(".pv-place .pv-stand")?.textContent || ""), null, { timeout: 15000 });
    await rij.locator(".pv-row-btn").click();
    await rij.locator(".pv-op-kaart").focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => /geen plek op de kaart/.test(document.querySelector("#buurtkaart .buurt-status")?.textContent || "")
      && document.querySelector("#buurtkaart .buurt-map-load")?.textContent === "Kaart niet beschikbaar · opnieuw proberen", null, { timeout: 15000 });
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const knop = document.querySelector("#buurtkaart .buurt-map-load"), r = knop.getBoundingClientRect();
      // Op negen punten in de knop is het bovenste element de knop zelf (tikbaar). Dat volstaat niet: de oude melding
      // had pointer-events: none, dus een tik ging erdoor, maar ze lag wel zichtbaar over de knop (opKnop hieronder).
      const bedekt = [];
      for (const fx of [0.1, 0.5, 0.9]) for (const fy of [0.15, 0.5, 0.85]) {
        const x = r.left + r.width * fx, y = r.top + r.height * fy, el = document.elementFromPoint(x, y);
        if (!el || !(el === knop || knop.contains(el))) bedekt.push(`${Math.round(x)},${Math.round(y)}: ${el ? el.className || el.tagName : "buiten beeld"}`);
      }
      const uitleg = [...document.querySelectorAll("#buurtkaart *")].filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && /geen plek op de kaart/.test(n.data))
        && !el.closest("[hidden]") && el.getClientRects().length && getComputedStyle(el).visibility !== "hidden");
      const inBeeld = uitleg.filter((el) => { const q = el.getBoundingClientRect(); return q.width > 0 && q.top >= 0 && q.bottom <= innerHeight; }).map((el) => el.className);
      // En geen enkele uitleg ligt (ook maar deels) op de knop.
      const opKnop = uitleg.filter((el) => [...el.getClientRects()].some((q) => q.left < r.right && r.left < q.right && q.top < r.bottom && r.top < q.bottom)).map((el) => el.className);
      const rh = (q) => [q.left, q.top, q.right, q.bottom].map(Math.round);
      return { bedekt, opKnop, knop: rh(r), uitleg: uitleg.map((el) => rh(el.getBoundingClientRect())), venster: innerHeight, inBeeld };
    });
    t.diagnostic(`${width}×${height}, 200 %: ${JSON.stringify(m)}`);
    assert.deepEqual(m.bedekt, [], `de knop "opnieuw proberen" is bedekt: ${JSON.stringify(m)}`);
    assert.deepEqual(m.opKnop, [], `de uitleg ligt op de knop: ${JSON.stringify(m)}`);
    assert.ok(m.inBeeld.length > 0, `de uitleg staat niet in beeld: ${JSON.stringify(m)}`);
    assert.deepEqual(await tekstOver(page), [], "tekst van het kaartblok over de kaart");
    assert.deepEqual(errors, []);
    await context.close();
  });

  // (2) "Toon op de kaart" zet de focus op de kaart (tabindex -1), maar de focusrand lag binnen de kaart, onder de lagen
  // van Leaflet (of het canvas van MapLibre): onzichtbaar (WCAG 2.4.7). Gemeten in pixels: twee schermafdrukken van
  // de rand van de kaart (8 px erbinnen en erbuiten), met en zonder focus.
  const RAND = 8, MARGE = 12;
  const randPixels = (page, { met, zonder, clip, kaart }) => page.evaluate(async ({ met, zonder, clip, kaart, RAND }) => {
    const lees = async (b64) => {
      const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: "image/png" }));
      const doek = new OffscreenCanvas(bmp.width, bmp.height), ctx = doek.getContext("2d");
      ctx.drawImage(bmp, 0, 0);
      return ctx.getImageData(0, 0, bmp.width, bmp.height);
    };
    const [a, b] = [await lees(met), await lees(zonder)];
    const s = a.width / clip.width;
    let verschil = 0;
    for (let y = 0; y < a.height; y += 1) for (let x = 0; x < a.width; x += 1) {
      // Afstand (CSS-px) tot de rand van de kaart, binnen of buiten.
      const cx = clip.x + x / s - kaart.x, cy = clip.y + y / s - kaart.y;
      const dx = Math.max(-cx, 0, cx - kaart.w), dy = Math.max(-cy, 0, cy - kaart.h);
      const afstand = dx || dy ? Math.hypot(dx, dy) : Math.min(cx, kaart.w - cx, cy, kaart.h - cy);
      if (afstand > RAND) continue;
      const i = (y * a.width + x) * 4;
      if (Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2])) > 32) verschil += 1;
    }
    return Math.round(verschil / (s * s));
  }, { met, zonder, clip, kaart, RAND });
  for (const [width, height] of [[390, 844], [1280, 900]]) await t.test(`P9b (2): met het toetsenbord "Toon op de kaart" (${width}×${height}): de focusrand van de kaart is te zien`, async (st) => {
    const stand = await standVanDeOchtend(st);
    const { page, context, errors } = await openStraat(baseUrl, { stand, bronnen: "geblokkeerd", kaart: "leaflet", width, height });
    const rij = page.locator('.pv-results .pv-row[data-uid="works:990001"]');
    await rij.waitFor({ timeout: 5000 });
    await page.waitForFunction(() => /lukte nu niet/.test(document.querySelector(".pv-place .pv-stand")?.textContent || ""), null, { timeout: 15000 });
    await rij.locator(".pv-row-btn").focus();
    await page.keyboard.press("Enter");
    await rij.locator(".pv-op-kaart").focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector(".buurt-map")?.dataset.kaart === "leaflet" && document.activeElement?.matches(".buurt-map:focus-visible"), null, { timeout: 15000 })
      .catch(async () => assert.fail(`focus: ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120))}`));
    await page.waitForTimeout(500);
    const kaart = await page.evaluate(() => { const q = document.querySelector("#buurtkaart .buurt-map-wrap").getBoundingClientRect(); return { x: q.left, y: q.top, w: q.width, h: q.height }; });
    const venster = page.viewportSize();
    const x0 = Math.max(0, Math.floor(kaart.x - MARGE)), y0 = Math.max(0, Math.floor(kaart.y - MARGE));
    const clip = { x: x0, y: y0, width: Math.min(venster.width, Math.ceil(kaart.x + kaart.w + MARGE)) - x0, height: Math.min(venster.height, Math.ceil(kaart.y + kaart.h + MARGE)) - y0 };
    const met = (await page.screenshot({ clip })).toString("base64");
    await page.evaluate(() => document.activeElement?.blur());
    await page.waitForTimeout(200);
    const zonder = (await page.screenshot({ clip })).toString("base64");
    const verschil = await randPixels(page, { met, zonder, clip, kaart });
    const omtrek = Math.round(2 * (kaart.w + kaart.h));
    t.diagnostic(`${width}×${height}: ${verschil} pixels verschillen aan de rand van de kaart (omtrek ${omtrek} px)`);
    // Een rand van minstens 2 px rondom (een rand van 3 px geeft ongeveer 3 × de omtrek).
    assert.ok(verschil >= 1.5 * omtrek, `focusrand niet te zien: ${verschil} pixels verschillen, omtrek ${omtrek}`);
    assert.deepEqual(errors, []);
    await context.close();
  });

  // (3) Meer dan 40 kaartjes zonder vaste plek (periode week): onder "Zonder vaste plek" stond "en nog N in de lijst",
  // met N geteld op deze plek (de lijst bij "alles"), niet wat de lijst toont: een tweede getal "in de lijst". En de zin
  // onder de kaart mengde "X in de lijst" (wat de lijst toont) met "Z zonder vaste plek" (op deze plek).
  await t.test("P9b (3): meer dan 40 kaartjes zonder vaste plek (periode week): één getal 'in de lijst'; wat er zonder plek is, telt hier", async (st) => {
    const stand = await standVanDeOchtend(st);
    const { page, context, errors } = await openStraat(baseUrl, { stand, bronnen: "geblokkeerd", feed: VEEL, width: 1280, height: 900, query: "?plek=Kammenstraat&periode=week" });
    await page.locator('.pv-results .pv-row[data-uid="agenda:e2e-lang-1"]').waitFor({ timeout: 15000 });
    await page.waitForFunction(() => /lukte nu niet/.test(document.querySelector(".pv-place .pv-stand")?.textContent || ""), null, { timeout: 15000 });
    await page.waitForFunction(() => /in de lijst/.test(document.querySelector("#buurtkaart .buurt-status")?.textContent || ""), null, { timeout: 15000 });
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const nogeo = document.querySelector("#buurtkaart .buurt-nogeo");
      const status = document.querySelector("#buurtkaart .buurt-status").textContent;
      const teksten = [status, nogeo.textContent, ...[...document.querySelectorAll("#buurtkaart [data-kaartsoort]:not([hidden])")].map((b) => b.textContent)];
      return {
        status, kop: nogeo.querySelector("summary").textContent, knoppen: nogeo.querySelectorAll("[data-open-uid]").length, rest: nogeo.querySelector("li:last-child")?.textContent || "",
        getallen: [...new Set(teksten.flatMap((z) => [...z.matchAll(/(\d+) in de lijst/g)].map((x) => Number(x[1]))))],
      };
    });
    t.diagnostic(JSON.stringify(m));
    assert.equal(m.knoppen, 40, JSON.stringify(m));
    assert.match(m.rest, /^en nog \d+/);
    assert.doesNotMatch(m.rest, /in de lijst/, "het getal onder de 40 kaartjes zonder plek is niet wat de lijst toont");
    assert.equal(m.getallen.length, 1, `getallen "in de lijst": ${JSON.stringify(m)}`);
    const z = Number(m.kop.match(/\((\d+)\)/)?.[1]);
    assert.match(m.status, new RegExp(`^\\d+ in de lijst, \\d+ op de kaart in Kammenstraat · ${z} hier zonder vaste plek\\.$`));
    assert.deepEqual(errors, []);
    await context.close();
  });

  // Het vectorpad (alleen met MAPLIBRE_DIR: MapLibre staat niet in de repo). Offline toetst de rest van dit bestand
  // alleen de terugval; hier komen MapLibre, de stijl en de tegels uit een nagebootste OpenFreeMap.
  const metMapLibre = MAPLIBRE_DIR ? false : "zet MAPLIBRE_DIR naar de npm-dist van maplibre-gl 5.24.0";
  await t.test("P9 (MAPLIBRE_DIR): de stijl komt, de tilejson niet: MapLibre werd gevraagd, en de kaart valt terug op Leaflet", { skip: metMapLibre }, async () => {
    const { page, context, errors, extern } = await openStraat(baseUrl, { stand: null, bronnen: "volledig", kaart: "leaflet", maplibreDir: MAPLIBRE_DIR, openfreemap: "stijl", width: 1280, height: 900, inzage: INZAGE, uitleg: UITLEG });
    await page.locator('.pv-results .pv-row[data-uid="works:990001"]').waitFor({ timeout: 20000 });
    await page.locator("#buurtkaart .buurt-map").scrollIntoViewIfNeeded();
    await page.locator(".buurt-map[data-kaart=leaflet] .leaflet-container").waitFor({ timeout: 15000 });
    assert.ok(extern.some((u) => u.endsWith("/maplibre-gl.js")), "MapLibre werd gevraagd");
    assert.equal(await page.locator("#buurtkaart .buurt-vector").count(), 0, "de vectorkaart ruimde zich op");
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test("P9 (MAPLIBRE_DIR): met stijl, tilejson en (lege) tegels wordt het de vectorkaart, met \"Kaartbeeld\" en de legenda", { skip: metMapLibre }, async () => {
    const { page, context, errors } = await openStraat(baseUrl, { stand: null, bronnen: "volledig", kaart: "leaflet", maplibreDir: MAPLIBRE_DIR, openfreemap: "tegels", width: 1280, height: 900, inzage: INZAGE, uitleg: UITLEG, query: "?plek=Kammenstraat&periode=alles" });
    await wachtOpDeVier(page);
    await page.waitForFunction(() => Array.isArray(window.PUBLIC_AGENDA_LIVE_STREETS?.permits), null, { timeout: 15000 });
    await page.locator("#buurtkaart .buurt-map").scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector(".buurt-map")?.dataset.kaart === "vector", null, { timeout: 15000 })
      .catch(async () => assert.fail(`data-kaart ${await page.locator(".buurt-map").getAttribute("data-kaart")}`));
    assert.equal(await page.locator('#buurtkaart canvas[aria-label="Kaartbeeld"]').count(), 1);
    assert.equal(await page.locator("#buurtkaart .leaflet-container").count(), 0);
    await kaartToegankelijk(page, [...REGIO_KAART, "Kaartbeeld"]);
    const opKaart = Number(await page.locator(".buurt-map").getAttribute("data-op-kaart"));
    assert.ok(opKaart > 0);
    await page.locator('#buurtkaart [data-kaartsoort="verkeer"]').click();
    await page.waitForFunction((voor) => Number(document.querySelector(".buurt-map")?.dataset.opKaart) < voor, opKaart, { timeout: 5000 });
    // Van de lijst naar de kaart werkt ook hier.
    const dossier = "publicSpace:dossier:ET2099000077";
    await page.locator(`.pv-results .pv-row[data-uid="${dossier}"] .pv-row-btn`).click();
    await page.waitForFunction((uid) => document.querySelector(".buurt-map")?.dataset.gemarkeerd === uid, dossier, { timeout: 5000 });
    // P9-review (6): de stijl (positron, licht) blijft na een themawissel; de inkt van straat en markering volgt die
    // onderkaart, niet het thema van de site (dat wordt wit in donker).
    await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
    for (let i = 0; i < 2; i += 1) await page.locator('#buurtkaart [data-kaartsoort="werken"]').click();
    const inkt = await page.evaluate(() => ({ kaart: getComputedStyle(document.querySelector(".buurt-map")).getPropertyValue("--kaart-inkt").trim(), site: getComputedStyle(document.documentElement).getPropertyValue("--pa-ink-strong").trim() }));
    assert.ok(lum(rgb(inkt.site)) > 0.5, `de site staat niet in donker: ${inkt.site}`);
    assert.ok(inkt.kaart && verhouding(rgb(inkt.kaart), KAART_LAND) >= 3, `inkt op de lichte vectorkaart na de themawissel: ${JSON.stringify(inkt)}`);
    assert.equal(await page.locator(".buurt-map").getAttribute("data-onderkaart"), "licht");
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test("zonder straatbestanden werkt de plekpagina zoals vroeger (alles live)", async () => {
    const { page, context, errors, extern } = await openStraat(baseUrl, { stand: null, bronnen: "live" });
    await page.locator('.pv-results .pv-row[data-uid="works:990002"]').waitFor({ timeout: 15000 });
    assert.ok(extern.some((u) => u.includes("/GIPOD/") && decodeURIComponent(u).includes(DISTRICT_BBOX)), "de werken van het hele district");
    assert.equal(await page.locator(".pv-place .pv-stand").count(), 0);
    assert.deepEqual(errors, []);
    await context.close();
  });
});
