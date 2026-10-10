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

async function openStraat(baseUrl, { stand = null, bronnen = "geblokkeerd", width = 390, height = 844 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 500, hasTouch: width < 500, locale: "nl-BE", timezoneId: "Europe/Brussels" });
  const page = await context.newPage();
  await page.clock.setFixedTime(NU);
  const errors = [], extern = [];
  page.on("pageerror", (error) => errors.push(error.message));
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
    // "live": GIPOD en de straatas antwoorden, de rest van geodata (A-Sign, vergunningen) faalt.
    if (url.includes("/collections/INNAME_PUNT/")) return route.fulfill(json({ type: "FeatureCollection", links: [], features: [990001, 990002].map((id, i) => ({ type: "Feature", geometry: { type: "Point", coordinates: midden }, properties: { GipodId: id, Description: i ? "Proef nieuw werk (snel)" : "Proefwerk riolering (snel)", Owner: "water-link", Status: "Concreet gepland", Start: "2099-03-19T06:00:00Z", End: "2099-04-09T16:00:00Z", Uri: `https://gipod.api.vlaanderen.be/api/v1/groundworks/${id}` } })) }));
    if (url.includes("/collections/HINDER_PUNT/")) return route.fulfill(json({ type: "FeatureCollection", links: [], features: [] }));
    if (url.includes("/MapServer/109/")) return route.fulfill(json(district));
    if (url.includes("/MapServer/905/")) return route.fulfill(json({ type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: [[x1, y1], [x2, y2]] }, properties: { LSTRNMID: Number(kam[0]), LSTRNM: kam[1], RSTRNMID: Number(kam[0]), RSTRNM: kam[1], postcode: 2000, DISTRICT: "Antwerpen" } }] }));
    return route.abort();
  });
  const start = Date.now();
  await page.goto(`${baseUrl}/?plek=Kammenstraat`);
  return { page, context, errors, extern, start };
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

  await t.test("zonder straatbestanden werkt de plekpagina zoals vroeger (alles live)", async () => {
    const { page, context, errors, extern } = await openStraat(baseUrl, { stand: null, bronnen: "live" });
    await page.locator('.pv-results .pv-row[data-uid="works:990002"]').waitFor({ timeout: 15000 });
    assert.ok(extern.some((u) => u.includes("/GIPOD/") && decodeURIComponent(u).includes(DISTRICT_BBOX)), "de werken van het hele district");
    assert.equal(await page.locator(".pv-place .pv-stand").count(), 0);
    assert.deepEqual(errors, []);
    await context.close();
  });
});
