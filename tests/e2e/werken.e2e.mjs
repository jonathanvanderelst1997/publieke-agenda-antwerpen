// End-to-end: één werkkaart in een echte browser (Playwright + Chromium), tegen de gebouwde site/.
// Draai met `node --test tests/e2e/werken.e2e.mjs`. Alles buiten de lokale site wordt onderschept:
// GIPOD krijgt één verzonnen werf over de jaargrens (warmtenet, nog "concreet gepland") met een
// afsluiting die vroeger stopt dan de werf. De klok staat vast. Zonder Playwright: overgeslagen.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const site = path.join(root, "site");

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

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };
function serve() {
  const server = http.createServer((req, res) => {
    let file = path.normalize(path.join(site, decodeURIComponent(new URL(req.url, "http://x").pathname)));
    if (!file.startsWith(site)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) file = path.join(site, "index.html");
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const VANDAAG = "2026-10-09";
const GIPOD_ID = 999999911;
const straten = JSON.parse(fs.readFileSync(path.join(site, "geo", "straten.json"), "utf8")).streets;
const straat = straten.find((r) => r[1] === "Kammenstraat" && String(r[2]) === "2000");
const district = fs.readFileSync(path.join(root, "lib", "district-antwerpen-grens.geojson"), "utf8");
const RUW = "2000 Antwerpen - Voorbeeldsite - Kammenstraat Aanleg warmtenet staal DN300 lengte 1650m (e2e)";

async function routeSources(page) {
  const [id, name, postcode, , [x1, y1, x2, y2]] = straat;
  const mid = [(x1 + x2) / 2, (y1 + y2) / 2];
  const axis = { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: [[x1, y1], [x2, y2]] }, properties: { LSTRNMID: Number(id), LSTRNM: name, RSTRNMID: Number(id), RSTRNM: name, postcode: Number(postcode), DISTRICT: "Antwerpen" } }] };
  const werk = { type: "FeatureCollection", links: [], features: [{ type: "Feature", geometry: { type: "Point", coordinates: mid }, properties: {
    GipodId: GIPOD_ID, Description: RUW, Owner: "Fluvius Site Warmte", Status: "Concreet gepland", Type: "Grondwerk",
    Start: "2026-01-05T05:00:00Z", End: "2027-07-06T16:00:00Z", PublicDomainOccupancyTypes: "Thermisch", GroundworkSpecification: "distributienet;transportnet;(her)aanleg",
  } }] };
  const hinder = { type: "FeatureCollection", links: [], features: [{ type: "Feature", geometry: { type: "Point", coordinates: mid }, properties: {
    HindranceStatus: "Gevalideerd", HindranceConsequenceOf: `https://gipod.api.vlaanderen.be/api/v1/groundworks/${GIPOD_ID}`, HindranceGipodId: 1,
    HindranceDescription: "Fase 1", HindranceStart: "2026-10-01T04:00:00Z", HindranceEnd: "2026-11-30T16:00:00Z", Consequences: "Geen doorgang voor gemotoriseerd verkeer;Geen doorgang voor fietsers",
  } }] };
  const json = (body) => ({ status: 200, contentType: "application/json", body: typeof body === "string" ? body : JSON.stringify(body) });
  await page.route((url) => !/^http:\/\/127\.0\.0\.1/.test(url.href), (route) => {
    const url = route.request().url();
    if (url.includes("/collections/INNAME_PUNT/")) return route.fulfill(json(werk));
    if (url.includes("/collections/HINDER_PUNT/")) return route.fulfill(json(hinder));
    if (url.includes("/MapServer/109/")) return route.fulfill(json(district));
    if (url.includes("/MapServer/905/")) return route.fulfill(json(axis));
    if (url.includes("geodata.antwerpen.be")) return route.fulfill(json(url.includes("returnIdsOnly") ? { objectIds: [] } : { features: [] }));
    return route.abort();
  });
}

test("werkkaart: jaartal, soort, eigen afsluitingsperiode, geen \"Nu bezig\" bij concreet gepland", { skip }, async (t) => {
  const server = await serve();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await browser.close(); });
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    const context = await browser.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500, locale: "nl-BE", timezoneId: "Europe/Brussels" });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(`${VANDAAG}T10:00:00+02:00`));
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await routeSources(page);
    await page.goto(`${baseUrl}/?plek=Kammenstraat`);
    const rij = page.locator(`li.pv-row[data-uid="works:${GIPOD_ID}"]`);
    await rij.waitFor({ timeout: 20000 });
    assert.equal(await rij.locator(".pv-row-title").innerText(), "Werken aan het warmtenet in de Kammenstraat: afgesloten voor auto's tot 30 november; werken tot 6 juli 2027 (nog 270 dagen)");
    assert.equal(await rij.locator(".pv-badge").innerText(), "Periode loopt");
    assert.equal((await rij.locator(".pv-row-when").innerText()).replace(/\s+/g, " "), "t/m 6 jul 2027");
    assert.equal(await rij.locator(".pv-row-range").innerText(), "5 jan 2026 → 6 jul 2027");
    await rij.locator(".pv-row-btn").click();
    const detail = rij.locator(".pv-detail");
    assert.match(await detail.innerText(), /Stand\s+De geplande periode loopt sinds 5 januari, maar GIPOD meldt het werk nog als “concreet gepland”/);
    assert.doesNotMatch(await detail.locator("dl.pv-uitleg").innerText(), /2000 Antwerpen|Voorbeeldsite/);
    const ruw = detail.locator("details.pv-bron-tekst");
    assert.equal(await ruw.locator("summary").innerText(), "Tekst van de beheerder in GIPOD");
    assert.equal(await ruw.locator("p").isVisible(), false);
    await ruw.locator("summary").click();
    assert.equal(await ruw.locator("p").innerText(), RUW);
    const [scroll, breedte] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    assert.ok(scroll <= breedte, `horizontale scroll op ${viewport.width} px: ${scroll} > ${breedte}`);
    assert.deepEqual(errors, []);
    await context.close();
  }
});
