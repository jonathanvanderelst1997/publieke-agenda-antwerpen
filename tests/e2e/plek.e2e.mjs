// End-to-end: zoeken op plek in een echte browser (Playwright + Chromium), tegen de gebouwde site/.
// Draai met `npm run test:e2e`. Alles buiten de lokale site wordt onderschept: de live bronnen (GIPOD,
// straatas, A-Sign, vergunningen) krijgen kleine vaste antwoorden en de kaarttegels/Leaflet worden
// geweigerd, zodat de test offline en deterministisch is. De klok staat op de dag van de data.
// Zonder Playwright of Chromium wordt de test overgeslagen (CI installeert geen browser).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { resolveAddressStreets } from "../../site/street-core.js";
import { locationKey } from "../../site/neighborhood-core.js";

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

// ---- lokale server voor site/ ----
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".xml": "application/xml", ".txt": "text/plain" };
function serve() {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = path.normalize(path.join(site, pathname));
    if (!file.startsWith(site)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) file = path.join(site, "index.html"); // zoals de rewrite in render.yaml
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// ---- data en vaste antwoorden ----
const straten = JSON.parse(fs.readFileSync(path.join(site, "geo", "straten.json"), "utf8"));
const byName = new Map();
for (const [id, name, postcode] of straten.streets) byName.set(locationKey(name), [...(byName.get(locationKey(name)) || []), { id: String(id), name, postcode }]);
const feedText = fs.readFileSync(path.join(site, "agenda-feed.js"), "utf8");
const generatedAt = JSON.parse(feedText.slice(feedText.indexOf("{"), feedText.lastIndexOf("}") + 1)).generatedAt;
const today = generatedAt.slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const district = fs.readFileSync(path.join(root, "lib", "district-antwerpen-grens.geojson"), "utf8");
const WORK_TITLE = "Proefwerk riolering (e2e)";
// De titel van een werk komt uit de kaartuitleg; de rij vinden we daarom op haar id.
const WORK_ROW = '.pv-row[data-uid="works:999999901"]';

// Een nagebootste A-Sign-server: veel ids zoals in het echt (laag 20 had op 9/10 5.781 ids), een
// 404 voor een URL boven 2.000 tekens zoals de stadsserver, en telling van gelijktijdige verzoeken.
// `fail` zijn laagnummers die niet antwoorden; `fixtures` zijn records per laag die terugkomen.
const reeks = (n, vanaf) => Array.from({ length: n }, (_, i) => vanaf + i);
function asignServer({ fail = [], fixtures = {} } = {}) {
  const stats = { urls: [], teLang: 0, bezig: 0, maxBezig: 0 };
  const ids = { 19: [], 20: reeks(5781, 700000), 22: reeks(581, 10000), 23: reeks(148, 1000), 47: reeks(1026, 20000), 48: reeks(1738, 30000), 49: reeks(2912, 1000) };
  for (const [laag, records] of Object.entries(fixtures)) for (const r of records) if (!ids[laag].includes(r.id)) ids[laag].push(r.id);
  const handle = async (route, url) => {
    const laag = Number((url.match(/MapServer\/(\d+)\/query/) || [])[1]);
    if (fail.includes(laag)) return route.abort();
    stats.urls.push(url.length);
    stats.bezig += 1; stats.maxBezig = Math.max(stats.maxBezig, stats.bezig);
    await new Promise((r) => setTimeout(r, 15));
    try {
      if (url.length > 2000) { stats.teLang += 1; await route.fulfill({ status: 404, contentType: "text/html", body: "Not Found" }); return; }
      const u = new URL(url);
      const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      if (u.searchParams.get("returnIdsOnly") === "true") { await json({ objectIds: ids[laag] || [] }); return; }
      const gevraagd = new Set(String(u.searchParams.get("objectIds") || "").split(",").map(Number));
      await json({ features: (fixtures[laag] || []).filter((r) => gevraagd.has(r.id)).map((r) => r.feature) });
    } finally { stats.bezig -= 1; }
  };
  return { stats, handle };
}

async function routeSources(page, street, { asign = null, work: withWork = true } = {}) {
  const row = straten.streets.find((r) => String(r[0]) === street.id && r[2] === street.postcode);
  const [x1, y1, x2, y2] = row[4];
  const mid = [(x1 + x2) / 2, (y1 + y2) / 2];
  const axis = { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: [[x1, y1], [x2, y2]] }, properties: { LSTRNMID: Number(street.id), LSTRNM: street.name, RSTRNMID: Number(street.id), RSTRNM: street.name, postcode: Number(street.postcode), DISTRICT: "Antwerpen" } }] };
  const work = {
    type: "FeatureCollection", links: [],
    features: [{ type: "Feature", geometry: { type: "Point", coordinates: mid }, properties: { GipodId: 999999901, Description: WORK_TITLE, Owner: "water-link", Status: "Concreet gepland", Start: `${addDays(today, 9)}T06:00:00Z`, End: `${addDays(today, 30)}T16:00:00Z`, Uri: "https://gipod.api.vlaanderen.be/api/v1/mobility-hindrances/999999901" } }],
  };
  const json = (body) => ({ status: 200, contentType: "application/json", body: typeof body === "string" ? body : JSON.stringify(body) });
  await page.route((url) => !/^http:\/\/127\.0\.0\.1/.test(url.href), (route) => {
    const url = route.request().url();
    if (url.includes("/collections/INNAME_PUNT/")) return route.fulfill(json(withWork ? work : { type: "FeatureCollection", features: [], links: [] }));
    if (url.includes("/collections/HINDER_PUNT/")) return route.fulfill(json({ type: "FeatureCollection", features: [], links: [] }));
    if (url.includes("/MapServer/109/")) return route.fulfill(json(district));
    if (url.includes("/MapServer/905/")) return route.fulfill(json(axis));
    if (asign && url.includes("/P_ASign/")) return asign.handle(route, url);
    if (url.includes("geodata.antwerpen.be")) return route.fulfill(json(url.includes("returnIdsOnly") ? { objectIds: [] } : { features: [] }));
    return route.abort();
  });
}

async function openPage(baseUrl, { width = 390, height = 844, query = "", street = null, asign = null, work = true } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 500, hasTouch: width < 500, locale: "nl-BE", timezoneId: "Europe/Brussels" });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(`${today}T10:00:00+02:00`));
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const geodataFouten = [];
  page.on("requestfailed", (request) => { if (/geodata\.antwerpen\.be/.test(request.url())) geodataFouten.push(request.url()); });
  await routeSources(page, street || pickStreet.fallback, { asign, work });
  await page.goto(`${baseUrl}/${query}`);
  await page.waitForSelector(".pv-chip");
  return { page, context, errors, geodataFouten };
}

// Een komend evenement waarvan de locatie aan precies één officiële straat hangt.
async function pickStreet(baseUrl) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(`${today}T10:00:00+02:00`));
  await page.route((url) => !/^http:\/\/127\.0\.0\.1/.test(url.href), (route) => route.abort());
  await page.goto(`${baseUrl}/`);
  await page.waitForSelector(".pv-chip");
  await page.click('[data-group="*"]');
  const items = await page.evaluate(() => (window.PUBLIC_AGENDA_VISIBLE_ITEMS || []).map((i) => ({ id: i.id, title: i.title, date: i.date, endDate: i.endDate || "", location: i.location || "", category: i.category })));
  await context.close();
  const horizon = addDays(today, 29);
  for (const item of items.sort((a, b) => a.date.localeCompare(b.date))) {
    if (item.date < today || item.date > horizon || item.endDate || ["markets", "meetings", "works"].includes(item.category)) continue;
    const streets = resolveAddressStreets(item.location, { byName }).streets;
    if (streets.length === 1) return { event: item, street: streets[0] };
  }
  return null;
}
pickStreet.fallback = { id: "1416", name: "Kammenstraat", postcode: "2000" };

test("zoeken op plek, end-to-end", { skip }, async (t) => {
  const server = await serve();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await browser.close(); });
  const pick = await pickStreet(baseUrl);
  assert.ok(pick, "de data heeft een komend evenement in een officiële straat");
  const { event, street } = pick;
  t.diagnostic(`plek: ${street.name} ${street.postcode} · evenement: ${event.title} (${event.date})`);

  await t.test("straat typen → suggestie → plekoverzicht met evenement én gepland werk", async () => {
    const { page, context, errors } = await openPage(baseUrl, { street });
    const input = page.locator("#agenda-street-jump");
    // Zoals een bewoner typt: kleine letters, afgekort, met huisnummer.
    const typed = `${street.name.toLowerCase().replace(/straat$/, "str.")} 12`;
    await input.fill(typed);
    const option = page.locator("#pv-suggestions [role=option]").first();
    await option.waitFor();
    assert.match(await option.innerText(), new RegExp(street.name));
    assert.equal(await input.getAttribute("aria-expanded"), "true");
    await input.press("Enter");
    await page.waitForFunction(() => new URL(location.href).searchParams.has("plek"));
    assert.equal(await page.locator(".pv-place-name").innerText(), street.name);
    await page.locator(".pv-results").getByText(event.title, { exact: false }).first().waitFor();
    const row = page.locator(`.pv-results ${WORK_ROW}`).first();
    await row.waitFor({ timeout: 15000 });
    assert.match(await row.innerText(), /Gepland/);
    // Details openen inline, zonder pop-up.
    await row.locator(".pv-row-btn").click();
    assert.equal(await row.locator(".pv-row-btn").getAttribute("aria-expanded"), "true");
    assert.match(await row.locator(".pv-detail").innerText(), /water-link/);
    // De voortgang zegt wat de tweede duur is: de lengte van het werk.
    assert.equal(await row.locator(".pv-progress-text").innerText(), "Start over 9 dagen · duurt 22 dagen");
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test("deellink ?plek= opent dezelfde plek; kalender toont de werkperiode als balk", async () => {
    const { page, context, errors } = await openPage(baseUrl, { width: 1280, height: 900, street, query: `?plek=${encodeURIComponent(street.name)}${byName.get(locationKey(street.name)).length > 1 ? `%20${street.postcode}` : ""}&weergave=maand` });
    await page.locator(".pv-cal").waitFor();
    const start = addDays(today, 9), end = addDays(today, 30);
    // Naar de maand van de start van het werk.
    for (let i = 0; i < 3 && !(await page.locator(`[data-day="${start}"]:not(.out)`).count()); i += 1) await page.click(".pv-nav-next");
    const bar = page.locator(".pv-bar.multi.cat-works").first();
    await bar.waitFor({ timeout: 15000 });
    const spans = await page.locator(".pv-bar.multi.cat-works").evaluateAll((els) => els.map((el) => Number((el.style.gridColumn.match(/span (\d+)/) || [])[1] || 1)));
    // Elke week waarin het werk loopt krijgt een balk; samen dekken ze de dagen van deze maand.
    assert.ok(spans.reduce((a, b) => a + b, 0) >= 7, `balken: ${spans}`);
    assert.match(await bar.getAttribute("title"), new RegExp(`${Number(start.slice(8))} .* → ${Number(end.slice(8))} `));
    await page.click(`[data-day="${start}"]`);
    await page.locator(`.pv-cal-daypanel ${WORK_ROW}`).waitFor();
    // Weekweergave: hetzelfde werk met zijn dagen ingekleurd.
    await page.click('[data-mode="week"]');
    while (!(await page.locator(WORK_ROW).count())) await page.click(".pv-nav-next");
    const onDays = await page.locator(WORK_ROW).first().locator(".pv-track i.on").count();
    assert.ok(onDays >= 1 && onDays <= 7);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test("wijk en postcode, lege staat met uitleg, toetsenbord", async () => {
    const { page, context } = await openPage(baseUrl, { street });
    const input = page.locator("#agenda-street-jump");
    await input.focus();
    await page.keyboard.type("zurenb");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    assert.equal(await page.locator(".pv-place-name").innerText(), "Zurenborg");
    assert.match(page.url(), /plek=Zurenborg/);
    await page.click(".pv-close");
    await input.fill("Berchem");
    await page.locator(".pv-sugg-note").getByText("ander district").waitFor();
    await input.fill("Schrijfstraat 105");
    await page.locator("#pv-suggestions").getByText("Bedoelde je").waitFor();
    await input.fill("2060");
    await input.press("Enter");
    assert.match(await page.locator(".pv-place-kind").innerText(), /postcode/i);
    // Alles uit → lege staat met concrete tips.
    await page.click('[data-group="*"]');
    await page.locator(".pv-empty").waitFor();
    assert.ok(await page.locator(".pv-empty-tips button").count() >= 1);
    await context.close();
  });

  await t.test("gsm (390 px): geen horizontale scroll in zoeken, plek, lijst, week en maand", async () => {
    const { page, context } = await openPage(baseUrl, { street });
    const noScroll = async (label) => {
      const [scroll, width] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      assert.ok(scroll <= width, `${label}: ${scroll} > ${width}`);
    };
    await noScroll("start");
    await page.locator("#agenda-street-jump").fill(street.name);
    await noScroll("suggesties");
    await page.locator("#agenda-street-jump").press("Enter");
    await page.locator(`.pv-results ${WORK_ROW}`).first().waitFor({ timeout: 15000 });
    await noScroll("plek");
    await page.click('[data-mode="week"]');
    await noScroll("week");
    await page.click('[data-mode="maand"]');
    await noScroll("maand");
    await page.click(".pv-more > summary");
    await noScroll("meer");
    await context.close();
  });

  // Herstelplan O1: de A-Sign-lagen faalden bij elke laadbeurt (URL's van 3.000 tot 4.800 tekens).
  await t.test("A-Sign met duizenden ids: korte URL's, hoogstens 4 tegelijk, parkeerverbod zonder huisnummer en terras in de straat", async () => {
    const [x1, y1, x2, y2] = straten.streets.find((r) => String(r[0]) === street.id && r[2] === street.postcode)[4];
    const [mx, my] = [(x1 + x2) / 2, (y1 + y2) / 2], d = 0.00004;
    const ms = (iso) => Date.parse(`${iso}T00:00:00Z`);
    const asign = asignServer({ fixtures: {
      20: [{ id: 700123, feature: { attributes: { Dossiernummer: "2026-999001", Locatienummer: "1", Status: "Goedgekeurd", Adres: `${street.name} 12-14 ${street.postcode} Antwerpen`, Reden: "Verhuis (e2e)", Startdatum: ms(addDays(today, 2)), Einddatum: ms(addDays(today, 3)), EnkelWeekdagen: 0, GipodID: null, District: "ANTWERPEN" } } }],
      49: [{ id: 1234, feature: { attributes: { OBJECTID: 1234, ROLnet_ID: "E2E-1", TypeTerrasZone: "Terraszone (e2e)", Status: "Actief", adres: street.name, postcode: Number(street.postcode) }, geometry: { rings: [[[mx - d, my - d], [mx + d, my - d], [mx + d, my + d], [mx - d, my + d], [mx - d, my - d]]] } } }],
    } });
    const query = `?plek=${encodeURIComponent(street.name)}${byName.get(locationKey(street.name)).length > 1 ? `%20${street.postcode}` : ""}`;
    const { page, context, errors, geodataFouten } = await openPage(baseUrl, { width: 1280, height: 900, street, asign, query });
    // Wachten tot beide lagen binnen zijn of tot de pagina stilvalt (op de oude code laadt het terras nooit).
    await page.waitForFunction(() => { const l = window.PUBLIC_AGENDA_LIVE_STREETS || {}; return Array.isArray(l.publicSpace) && (Array.isArray(l.terraces) || l.failed?.terraces?.length); }, null, { timeout: 20000 }).catch(() => {});
    assert.equal(asign.stats.teLang, 0, `geen URL boven 2.000 tekens (langste: ${Math.max(...asign.stats.urls)})`);
    assert.deepEqual(geodataFouten, [], "geen mislukte verzoeken naar geodata.antwerpen.be");
    assert.ok(Math.max(...asign.stats.urls) < 1800, `langste URL ${Math.max(...asign.stats.urls)}`);
    assert.ok(asign.stats.maxBezig <= 4, `${asign.stats.maxBezig} verzoeken tegelijk`);
    assert.ok(asign.stats.urls.length > 120, `${asign.stats.urls.length} verzoeken: alle blokken opgevraagd`);
    const parkeer = page.locator(".pv-results .pv-row", { hasText: "Verhuis (e2e)" }).first();
    await parkeer.waitFor({ timeout: 15000 });
    assert.match(await parkeer.innerText(), new RegExp(`${street.name}, ${street.postcode} Antwerpen`));
    assert.doesNotMatch(await parkeer.innerText(), /12-14/, "geen huisnummer bij een parkeerverbod");
    // Een titel in gewone taal; de technische bron zit ingeklapt.
    assert.match(await parkeer.innerText(), /Parkeerverbod voor een verhuis/);
    assert.doesNotMatch(await parkeer.innerText(), /Parkeerverbod: /);
    await parkeer.locator(".pv-row-btn").click();
    await parkeer.locator(".pv-tech summary").waitFor();
    assert.equal(await parkeer.locator(".pv-tech").evaluate((el) => el.open), false, "technische details dicht");
    await page.locator(".pv-results .pv-row", { hasText: "Terraszone (e2e)" }).first().waitFor({ timeout: 15000 });
    assert.equal(await page.locator(".pv-place-failed").count(), 0);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test("een A-Sign-laag laadt niet: melding bovenaan en in de lege staat", async () => {
    const peterselie = { id: "2289", name: "Peterseliestraat", postcode: "2000" };
    const asign = asignServer({ fail: [20, 47, 49] });
    const { page, context, errors } = await openPage(baseUrl, { street: peterselie, asign, work: false, query: "?plek=Peterseliestraat" });
    const melding = "Parkeerverboden, omleidingen en terrassen konden nu niet geladen worden. Dit overzicht is onvolledig.";
    // De plek tekent opnieuw bij het volgende beeld; wacht tot de laatste laag erin zit.
    await page.waitForFunction((m) => document.querySelector(".pv-place .pv-place-failed")?.innerText.trim() === m, melding, { timeout: 20000 }).catch(() => {});
    assert.equal(await page.locator(".pv-place .pv-place-failed").count(), 1, "melding bovenaan de plek ontbreekt");
    assert.equal((await page.locator(".pv-place .pv-place-failed").innerText()).trim(), melding);
    const leeg = page.locator(".pv-results .pv-empty");
    await leeg.waitFor();
    const tekst = await leeg.innerText();
    assert.match(tekst, /Niets gevonden in Peterseliestraat/);
    assert.ok(tekst.includes(melding), tekst);
    // Een laag laadde niet: alleen iets zeggen over wat wel geladen is.
    assert.match(tekst, /In wat wel geladen is, staat niets voor deze straat\./);
    assert.doesNotMatch(tekst, /Er staat niets op de agenda/);
    // Op een gsm valt de melding binnen het eerste scherm: boven de tegels.
    const melder = await page.locator(".pv-place .pv-place-failed").boundingBox();
    const tegels = await page.locator(".pv-place .pv-stats").boundingBox();
    assert.ok(melder && tegels && melder.y < tegels.y, "melding staat boven de tegels");
    assert.doesNotMatch(tekst, /gekozen soorten/);
    assert.deepEqual(errors, []);
    await context.close();
  });
});
