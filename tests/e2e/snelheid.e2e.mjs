// End-to-end (P5, snelheid): de voorpagina vraagt live-layers.json niet meer op, en de plekpagina toont
// een straat meteen uit de stand van de ochtend (site/straat/<id>.json) en kijkt daarna live alleen het
// kader van die straat na. Playwright + Chromium tegen de gebouwde site/; alles buiten de lokale site wordt
// onderschept. De straatbestanden komen van de echte bouwer (scripts/build-straat-snapshots.mjs) op
// verzonnen items (tests/helpers/straat-fixture.mjs), zodat de toets niet afhangt van de data van vandaag.
// Op de basistak bestaan de bouwer en de straatbestanden niet: dan draait dit bestand toch, zonder
// straatbestanden, en faalt het op wat de bewoner merkt (geen tegels binnen 3 s, live-layers.json opgevraagd).
// Zonder Playwright of Chromium wordt de toets overgeslagen (CI installeert geen browser).
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
const rijenVan = (lijst) => lijst.map(([fase, naam, type, van, tot, pad], i) => ({ id: i + 1, feature: { attributes: { dossierNummer: "ET2099000077", faseId: fase, innameId: `I${i + 1}`, dossierStatus: "aanvraag_goedgekeurd", faseNaam: naam, type_dossier: "ETL", innameTypeNaam: type, innameBeschrijving: "", innameHinder: "True", faseStartDatum: ms(van), faseEindDatum: ms(tot) }, geometry: { paths: [pad] } } }));
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
const assen = [[kam, [x1, y1], [x2, y2]], [ANDERE, ...ELDERS], [DERDE, ...ELDERS2]].map(([r, a, b]) => ({ type: "Feature", geometry: { type: "LineString", coordinates: [a, b] }, properties: { LSTRNMID: Number(r[0]), LSTRNM: r[1], RSTRNMID: Number(r[0]), RSTRNM: r[1], postcode: 2000, DISTRICT: "Antwerpen" } }));
// Het verzonnen dossier loopt in openbaar onderzoek op 10 maart 2099.
const INZAGE = { schema: "inzage-status/1", uitleg: "verzonnen", dossiers: [{ project: "OMV_2099000077", gevonden: true, toestand: "openbaar onderzoek", bron: "handmatig", nagekeken: "2099-03-05", openbaarOnderzoek: { van: "2099-03-01", totEnMet: "2099-03-30" } }] };
// De verversing kent het dossier (zoals elk evenementendossier in het district).
const UITLEG = { schemaVersion: 1, generatedAt: "2099-03-10T04:22:00.000Z", vanaf: "2099-03-10", tot: "2099-05-09", werken: {}, evenementen: { ET2099000077: { start: "2099-03-12", eind: "2099-03-16", soort: "", soortBron: "", beschrijvingen: [], straten: ["Kammenstraat"], kruist: [], langs: ["Kammenstraat"], stratenTekst: "", gekoppeld: null, kaart: [] } } };
const bboxVan = (pad) => [Math.min(...pad.map((p) => p[0])), Math.min(...pad.map((p) => p[1])), Math.max(...pad.map((p) => p[0])), Math.max(...pad.map((p) => p[1]))];
const kaderVanFeature = (f) => bboxVan([...(f.geometry.paths || []), ...(f.geometry.rings || [])].flat());
const raakt = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
// ArcGIS: eerst de ids (met een kader: alleen wat het kader raakt; met "faseEindDatum >= DATE '…'" of
// zo: alleen wat dan nog loopt, zoals A-Sign), dan de details per id.
function arcgis(records, url) {
  const u = new URL(url);
  if (u.searchParams.get("returnIdsOnly") === "true") {
    const env = (u.searchParams.get("geometry") || "").split(",").map(Number);
    const [, veld, vanaf] = /(faseEindDatum|Einddatum|EndDate) >= DATE '(\d{4}-\d{2}-\d{2})'/.exec(u.searchParams.get("where") || "") || [];
    return { objectIds: records.filter((r) => (env.length !== 4 || raakt(env, kaderVanFeature(r.feature))) && (!vanaf || r.feature.attributes[veld] >= ms(vanaf))).map((r) => r.id) };
  }
  const ids = new Set(String(u.searchParams.get("objectIds") || "").split(",").map(Number));
  return { features: records.filter((r) => ids.has(r.id)).map((r) => r.feature) };
}

async function openStraat(baseUrl, { stand = null, bronnen = "geblokkeerd", width = 390, height = 844, query = "?plek=Kammenstraat", inzage = null, uitleg = null, evenement = EVENEMENTEN["opbouw en afbraak elders"] } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 500, hasTouch: width < 500, locale: "nl-BE", timezoneId: "Europe/Brussels" });
  const page = await context.newPage();
  await page.clock.setFixedTime(NU);
  const errors = [], extern = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if (inzage) await page.route((url) => url.hostname === "127.0.0.1" && url.pathname === "/sources/inzage-status.json", (route) => route.fulfill(json(inzage)));
  if (uitleg) await page.route((url) => url.hostname === "127.0.0.1" && url.pathname === "/sources/kaart-uitleg.json", (route) => route.fulfill(json(uitleg)));
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
    if (bronnen === "geblokkeerd") return route.abort();
    // "volledig": de hele nagebootste stad hierboven, met het kader nagekeken.
    if (bronnen === "volledig") {
      if (url.includes("/collections/INNAME_PUNT/")) return route.fulfill(json({ type: "FeatureCollection", links: [], features: [{ type: "Feature", geometry: { type: "Point", coordinates: midden }, properties: { GipodId: 990001, Description: "Proefwerk riolering (snel)", Owner: "water-link", Status: "Concreet gepland", Start: "2099-03-19T06:00:00Z", End: "2099-04-09T16:00:00Z", Uri: "https://gipod.api.vlaanderen.be/api/v1/groundworks/990001" } }] }));
      if (url.includes("/collections/HINDER_PUNT/")) return route.fulfill(json({ type: "FeatureCollection", links: [], features: [] }));
      if (url.includes("/MapServer/109/")) return route.fulfill(json(district));
      if (url.includes("/MapServer/905/")) return route.fulfill(json({ type: "FeatureCollection", features: assen }));
      if (url.includes("/P_ASign/ASign/MapServer/23/query")) return route.fulfill(json(arcgis(evenement, url)));
      const laag = Number((url.match(/\/P_ASign\/ASign\/MapServer\/(\d+)\/query/) || [])[1]);
      if ([20, 47, 48].includes(laag)) return route.fulfill(json(arcgis([...werfzone, ...parkeerverbod].filter((r) => r.laag === laag), url)));
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

  await t.test("zonder straatbestanden werkt de plekpagina zoals vroeger (alles live)", async () => {
    const { page, context, errors, extern } = await openStraat(baseUrl, { stand: null, bronnen: "live" });
    await page.locator('.pv-results .pv-row[data-uid="works:990002"]').waitFor({ timeout: 15000 });
    assert.ok(extern.some((u) => u.includes("/GIPOD/") && decodeURIComponent(u).includes(DISTRICT_BBOX)), "de werken van het hele district");
    assert.equal(await page.locator(".pv-place .pv-stand").count(), 0);
    assert.deepEqual(errors, []);
    await context.close();
  });
});
