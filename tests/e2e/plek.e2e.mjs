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

async function routeSources(page, street, { evenement = null } = {}) {
  const row = straten.streets.find((r) => String(r[0]) === street.id && r[2] === street.postcode);
  const [x1, y1, x2, y2] = row[4];
  const mid = [(x1 + x2) / 2, (y1 + y2) / 2];
  const axis = { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: [[x1, y1], [x2, y2]] }, properties: { LSTRNMID: Number(street.id), LSTRNM: street.name, RSTRNMID: Number(street.id), RSTRNM: street.name, postcode: Number(street.postcode), DISTRICT: "Antwerpen" } }] };
  const work = {
    type: "FeatureCollection", links: [],
    features: [{ type: "Feature", geometry: { type: "Point", coordinates: mid }, properties: { GipodId: 999999901, Description: WORK_TITLE, Owner: "water-link", Status: "Concreet gepland", Start: `${addDays(today, 9)}T06:00:00Z`, End: `${addDays(today, 30)}T16:00:00Z`, Uri: "https://gipod.api.vlaanderen.be/api/v1/mobility-hindrances/999999901" } }],
  };
  const json = (body) => ({ status: 200, contentType: "application/json", body: typeof body === "string" ? body : JSON.stringify(body) });
  // Een verzonnen evenementendossier (A-Sign laag 23): een parcours over de gekozen straat.
  const fase = evenement && Date.parse(`${evenement.dag}T08:00:00Z`);
  const parcours = evenement && { attributes: { dossierNummer: evenement.dossier, faseId: "F1", innameId: "I1", dossierStatus: "aanvraag_goedgekeurd", faseNaam: "Evenement", type_dossier: "ETL", innameTypeNaam: "Parcours", innameBeschrijving: "", innameHinder: "True", faseStartDatum: fase, faseEindDatum: fase }, geometry: { paths: [[[x1, y1], [x2, y2]]] } };
  await page.route((url) => !/^http:\/\/127\.0\.0\.1/.test(url.href), (route) => {
    const url = route.request().url();
    if (url.includes("/collections/INNAME_PUNT/")) return route.fulfill(json(work));
    if (url.includes("/collections/HINDER_PUNT/")) return route.fulfill(json({ type: "FeatureCollection", features: [], links: [] }));
    if (url.includes("/MapServer/109/")) return route.fulfill(json(district));
    if (url.includes("/MapServer/905/")) return route.fulfill(json(axis));
    if (parcours && url.includes("/MapServer/23/query")) return route.fulfill(json(url.includes("returnIdsOnly") ? { objectIds: [1] } : { features: [parcours] }));
    if (url.includes("geodata.antwerpen.be")) return route.fulfill(json(url.includes("returnIdsOnly") ? { objectIds: [] } : { features: [] }));
    return route.abort();
  });
}

async function openPage(baseUrl, { width = 390, height = 844, query = "", street = null, evenement = null } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 500, hasTouch: width < 500, locale: "nl-BE", timezoneId: "Europe/Brussels" });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(`${today}T10:00:00+02:00`));
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await routeSources(page, street || pickStreet.fallback, { evenement });
  await page.goto(`${baseUrl}/${query}`);
  await page.waitForSelector(".pv-chip");
  return { page, context, errors };
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
    await page.locator(".pv-results").getByText(WORK_TITLE).first().waitFor({ timeout: 15000 });
    const row = page.locator(".pv-row", { hasText: WORK_TITLE }).first();
    assert.match(await row.innerText(), /Gepland/);
    // Details openen inline, zonder pop-up.
    await row.locator(".pv-row-btn").click();
    assert.equal(await row.locator(".pv-row-btn").getAttribute("aria-expanded"), "true");
    assert.match(await row.locator(".pv-detail").innerText(), /water-link/);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test("deellink ?plek= opent dezelfde plek; kalender toont de werkperiode als balk", async () => {
    const { page, context, errors } = await openPage(baseUrl, { width: 1280, height: 900, street, query: `?plek=${encodeURIComponent(street.name)}${byName.get(locationKey(street.name)).length > 1 ? `%20${street.postcode}` : ""}&weergave=maand` });
    await page.locator(".pv-cal").waitFor();
    const start = addDays(today, 9), end = addDays(today, 30);
    // Naar de maand van de start van het werk.
    for (let i = 0; i < 3 && !(await page.locator(`[data-day="${start}"]:not(.out)`).count()); i += 1) await page.click(".pv-nav-next");
    const bar = page.locator(`.pv-bar.multi[title*="${WORK_TITLE}"]`).first();
    await bar.waitFor({ timeout: 15000 });
    const spans = await page.locator(`.pv-bar.multi[title*="${WORK_TITLE}"]`).evaluateAll((els) => els.map((el) => Number((el.style.gridColumn.match(/span (\d+)/) || [])[1] || 1)));
    // Elke week waarin het werk loopt krijgt een balk; samen dekken ze de dagen van deze maand.
    assert.ok(spans.reduce((a, b) => a + b, 0) >= 7, `balken: ${spans}`);
    assert.match(await bar.getAttribute("title"), new RegExp(`${Number(start.slice(8))} .* → ${Number(end.slice(8))} `));
    await page.click(`[data-day="${start}"]`);
    await page.locator(".pv-cal-daypanel").getByText(WORK_TITLE).waitFor();
    // Weekweergave: hetzelfde werk met zijn dagen ingekleurd.
    await page.click('[data-mode="week"]');
    while (!(await page.locator(".pv-row", { hasText: WORK_TITLE }).count())) await page.click(".pv-nav-next");
    const onDays = await page.locator(".pv-row", { hasText: WORK_TITLE }).first().locator(".pv-track i.on").count();
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

  await t.test("evenement op straat: telt als evenement, alleen 'Evenementen' toont het, kaart begint met wat en wanneer", async () => {
    const plek = `${street.name}${byName.get(locationKey(street.name)).length > 1 ? ` ${street.postcode}` : ""}`;
    const { page, context, errors } = await openPage(baseUrl, { street, evenement: { dossier: "ET2099000077", dag: addDays(today, 5) }, query: `?plek=${encodeURIComponent(plek)}&soort=evenementen&periode=alles` });
    const row = page.locator(".pv-row", { hasText: "Evenement op straat" }).first();
    await row.waitFor({ timeout: 20000 });
    assert.match(await row.innerText(), /Evenement met toelating van de stad/);
    // Chips en tegels tellen kaarten: het dossier is één evenement; de vijfde tegel is vergunningen.
    await page.waitForFunction(() => document.querySelector('[data-group="evenementen"] .pv-chip-n'));
    const chip = Number(await page.locator('[data-group="evenementen"] .pv-chip-n').innerText());
    assert.equal(chip, await page.locator(".pv-results .pv-row").count());
    assert.equal(await page.locator(".pv-stats .pv-stat").count(), 5);
    assert.match(await page.locator(".pv-stats").innerText(), /vergunning/);
    await row.locator(".pv-row-btn").click();
    const labels = await row.locator(".pv-kern dt").evaluateAll((els) => els.map((el) => el.textContent));
    assert.deepEqual(labels.slice(0, 3), ["Wat", "Wanneer", "Waar"]);
    assert.ok(labels.includes("Jouw straat") && labels.includes("Wat merk je"));
    assert.doesNotMatch(await row.locator(".pv-detail").innerText(), /ETL|IOD|Niet in de bron/);
    assert.deepEqual(errors, []);
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
    await page.locator(".pv-results").getByText(WORK_TITLE).first().waitFor({ timeout: 15000 });
    await noScroll("plek");
    await page.click('[data-mode="week"]');
    await noScroll("week");
    await page.click('[data-mode="maand"]');
    await noScroll("maand");
    await page.click(".pv-more > summary");
    await noScroll("meer");
    await context.close();
  });
});
