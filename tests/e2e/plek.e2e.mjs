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
// Een verzonnen omgevingsaanvraag met een naam en een telefoonnummer in het vrije onderwerp:
// de kaart moet zeggen wat er gebeurt, zonder iets van dat onderwerp te tonen.
const PERMIT_TITLE = "Sloop en nieuwbouw (6 woningen en een winkel)";
// Inzageloket (site/inzage-status.js): de eerlijke zin zonder nagekeken stand en een vaste stand per toets.
const GEEN_INZAGE = "Deze site kon niet nagaan of er nu een openbaar onderzoek loopt. Het Inzageloket toont een aanvraag alleen tijdens het openbaar onderzoek en tijdens de beroepstermijn na de beslissing.";
const LOKET_LINK = "https://omgevingsloketinzage.omgeving.vlaanderen.be/2099000001";
const BEZWAAR_LABEL = "Zo dien je een bezwaar in (uitleg van Vlaanderen)";
const inzageStand = (dossier) => ({ schema: "inzage-status/1", uitleg: "e2e", dossiers: [{ project: "OMV_2099000001", gevonden: true, toestand: "openbaar onderzoek", bron: "handmatig", ...dossier }] });
const MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const dagTekst = (iso) => `${Number(iso.slice(8))} ${MAANDEN[Number(iso.slice(5, 7)) - 1]}${iso.slice(0, 4) === today.slice(0, 4) ? "" : ` ${iso.slice(0, 4)}`}`;

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

async function routeSources(page, street, { asign = null, work: withWork = true, assen = [], vergunningen = [], evenement = null, aanvraag = true } = {}) {
  const row = straten.streets.find((r) => String(r[0]) === street.id && r[2] === street.postcode);
  const [x1, y1, x2, y2] = row[4];
  const mid = [(x1 + x2) / 2, (y1 + y2) / 2];
  const axis = { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: [[x1, y1], [x2, y2]] }, properties: { LSTRNMID: Number(street.id), LSTRNM: street.name, RSTRNMID: Number(street.id), RSTRNM: street.name, postcode: Number(street.postcode), DISTRICT: "Antwerpen" } }, ...assen] };
  const work = {
    type: "FeatureCollection", links: [],
    features: [{ type: "Feature", geometry: { type: "Point", coordinates: mid }, properties: { GipodId: 999999901, Description: WORK_TITLE, Owner: "water-link", Status: "Concreet gepland", Start: `${addDays(today, 9)}T06:00:00Z`, End: `${addDays(today, 30)}T16:00:00Z`, Uri: "https://gipod.api.vlaanderen.be/api/v1/mobility-hindrances/999999901" } }],
  };
  const d = 0.0002;
  const permit = {
    attributes: { Dossiernummer: "20990001", DOSSIERTYPE: "OMV2019_AANVRAAG", AardAanvraag: "Aanvraag omgevingsproject", Onderwerp: "slopen van 2 panden en bouwen van een gemengd gebouw met een detailhandel en 6 woonentiteiten, aanvrager Jan Voorbeeld 0470 12 34 56", Volledig: "ja", Ontvankelijk: "ja", Ingetrokken: "nee", Stopgezet: "nee", ProjectnummerOmgevingsloket: "OMV_2099000001", behandelendeOverheid: "College van burgemeester en schepenen" },
    geometry: { rings: [[[mid[0] - d, mid[1] - d], [mid[0] + d, mid[1] - d], [mid[0] + d, mid[1] + d], [mid[0] - d, mid[1] + d], [mid[0] - d, mid[1] - d]]] },
  };
  const json = (body) => ({ status: 200, contentType: "application/json", body: typeof body === "string" ? body : JSON.stringify(body) });
  // Een verzonnen evenementendossier (A-Sign laag 23): een parcours over de gekozen straat.
  const fase = evenement && Date.parse(`${evenement.dag}T08:00:00Z`);
  const parcours = evenement && { attributes: { dossierNummer: evenement.dossier, faseId: "F1", innameId: "I1", dossierStatus: "aanvraag_goedgekeurd", faseNaam: "Evenement", type_dossier: "ETL", innameTypeNaam: "Parcours", innameBeschrijving: "", innameHinder: "True", faseStartDatum: fase, faseEindDatum: fase }, geometry: { paths: [[[x1, y1], [x2, y2]]] } };
  // Desgewenst een parkeerverbod tijdens de afbraak, na de dag van het evenement, in dezelfde straat.
  const afbraak = evenement?.afbraakTot && { attributes: { ...parcours.attributes, faseId: "F2", innameId: "I2", faseNaam: "Afbraak", innameTypeNaam: "Parkeerverbod in Straat", faseStartDatum: fase, faseEindDatum: Date.parse(`${evenement.afbraakTot}T08:00:00Z`) }, geometry: { paths: [[[x1, y1], [x2, y2]]] } };
  await page.route((url) => !/^http:\/\/127\.0\.0\.1/.test(url.href), (route) => {
    const url = route.request().url();
    if (url.includes("/collections/INNAME_PUNT/")) return route.fulfill(json(withWork ? work : { type: "FeatureCollection", features: [], links: [] }));
    if (url.includes("/collections/HINDER_PUNT/")) return route.fulfill(json({ type: "FeatureCollection", features: [], links: [] }));
    if (url.includes("/MapServer/109/")) return route.fulfill(json(district));
    if (url.includes("/MapServer/905/")) return route.fulfill(json(axis));
    if (asign && url.includes("/P_ASign/")) return asign.handle(route, url);
    if (vergunningen.length && url.includes("/pip2_vergunningen/")) return route.fulfill(json(url.includes("returnIdsOnly") ? { objectIds: vergunningen.map((_, i) => i + 1) } : { features: vergunningen }));
    if (parcours && url.includes("/MapServer/23/query")) return route.fulfill(json(url.includes("returnIdsOnly") ? { objectIds: afbraak ? [1, 2] : [1] } : { features: afbraak ? [parcours, afbraak] : [parcours] }));
    // Standaard één verzonnen aanvraag in de gekozen straat; `aanvraag: false` voor een lege straat.
    if (url.includes("/pip2_vergunningen/MapServer/5/")) return route.fulfill(json(url.includes("returnIdsOnly") ? { objectIds: aanvraag ? [1] : [] } : { features: aanvraag ? [permit] : [] }));
    if (url.includes("geodata.antwerpen.be")) return route.fulfill(json(url.includes("returnIdsOnly") ? { objectIds: [] } : { features: [] }));
    return route.abort();
  });
}

async function openPage(baseUrl, { width = 390, height = 844, query = "", street = null, asign = null, work = true, assen = [], vergunningen = [], kaartUitleg = null, evenement = null, aanvraag = true, inzage = null } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 500, hasTouch: width < 500, locale: "nl-BE", timezoneId: "Europe/Brussels" });
  const page = await context.newPage();
  if (kaartUitleg) await page.route("**/sources/kaart-uitleg.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(kaartUitleg) }));
  await page.clock.setFixedTime(new Date(`${today}T10:00:00+02:00`));
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const geodataFouten = [];
  page.on("requestfailed", (request) => { if (/geodata\.antwerpen\.be/.test(request.url())) geodataFouten.push(request.url()); });
  await routeSources(page, street || pickStreet.fallback, { asign, work, assen, vergunningen, evenement, aanvraag });
  // Een vaste nagekeken stand in het Inzageloket voor de verzonnen aanvraag (site/inzage-status.js).
  if (inzage) await page.route((url) => url.pathname === "/sources/inzage-status.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(inzage) }));
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

  await t.test("vergunning: de titel zegt wat er gebeurt, één statusregel, geen vrije tekst", async () => {
    const plek = `${encodeURIComponent(street.name)}${byName.get(locationKey(street.name)).length > 1 ? `%20${street.postcode}` : ""}`;
    const { page, context, errors } = await openPage(baseUrl, { street, query: `?plek=${plek}&soort=vergunningen` });
    const row = page.locator("section.pv-day", { hasText: "Omgevingsaanvragen en besluiten" }).locator(".pv-row").first();
    await row.waitFor({ timeout: 15000 });
    assert.equal(await row.locator(".pv-row-title").innerText(), PERMIT_TITLE);
    await row.locator(".pv-row-btn").click();
    const tekst = await row.innerText();
    assert.equal(tekst.match(/volledig en ontvankelijk verklaard/g)?.length, 1, tekst);
    assert.match(tekst, /Wie beslist/);
    assert.doesNotMatch(tekst, /Procedurestatus|doel niet|Voorbeeld|0470|20990001 · College/);
    const technisch = await row.locator("a.pv-bron-technisch").getAttribute("href");
    assert.equal(new URL(technisch).searchParams.get("where"), "Dossiernummer='20990001'");
    // Niet nagekeken in het Inzageloket: geen knop naar de startpagina, wel een eerlijke zin.
    assert.equal(await row.locator('a[href^="https://omgevingsloketinzage."]').count(), 0);
    assert.ok(tekst.includes(GEEN_INZAGE), tekst);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test("openbaar onderzoek: bovenaan de lijst, de termijn in de dichte kaart en een rechtstreekse link", async () => {
    const plek = `${encodeURIComponent(street.name)}${byName.get(locationKey(street.name)).length > 1 ? `%20${street.postcode}` : ""}`;
    const tot = addDays(today, 10);
    const inzage = inzageStand({ openbaarOnderzoek: { van: addDays(today, -19), totEnMet: tot }, nagekeken: addDays(today, -1) });
    const { page, context, errors } = await openPage(baseUrl, { street, inzage, query: `?plek=${plek}` });
    const sectie = page.locator("section.pv-day", { hasText: "Openbaar onderzoek: bezwaar indienen kan nu" });
    await sectie.waitFor({ timeout: 15000 });
    // De eerste sectie van de lijst, vóór "Nu bezig" en de dagen.
    assert.equal(await page.locator(".pv-results section.pv-day").first().getAttribute("aria-label"), "Openbaar onderzoek: bezwaar indienen kan nu");
    const row = sectie.locator(".pv-row").first();
    assert.equal(await row.locator(".pv-row-title").innerText(), PERMIT_TITLE);
    // Zichtbaar zonder openklappen.
    assert.equal(await row.locator(".pv-row-alert").innerText(), `Openbaar onderzoek loopt tot en met ${dagTekst(tot)}. Bezwaar indienen kan tot dan.`);
    assert.ok(await row.locator(".pv-row-alert").isVisible());
    assert.match(await row.locator(".pv-row-kind").innerText(), /Openbaar onderzoek/);
    await row.locator(".pv-row-btn").click();
    assert.equal(await row.locator(`a[href="${LOKET_LINK}"]`).count(), 1);
    assert.equal(await row.locator('a[href="https://omgevingsloketinzage.omgeving.vlaanderen.be/"]').count(), 0);
    assert.ok((await row.locator('a[href="https://www.vlaanderen.be/omgevingsvergunning/inzageloket"]').innerText()).startsWith(BEZWAAR_LABEL));
    assert.doesNotMatch(await row.innerText(), /kon niet nagaan/);
    // Niet dubbel: de aanvraag staat niet nog eens onderaan bij de gewone aanvragen.
    assert.equal(await page.locator(".pv-row", { hasText: PERMIT_TITLE }).count(), 1);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test("openbaar onderzoek dat niet vandaag loopt, of zonder einddatum: niet bovenaan, wel de melding in de dichte kaart", async () => {
    const plek = `${encodeURIComponent(street.name)}${byName.get(locationKey(street.name)).length > 1 ? `%20${street.postcode}` : ""}`;
    const van = addDays(today, 5), tot = addDays(today, 34);
    const gevallen = [
      // De termijn begint later (nagekeken moet binnen de termijn liggen).
      [inzageStand({ openbaarOnderzoek: { van, totEnMet: tot }, nagekeken: van }), `Openbaar onderzoek van ${dagTekst(van)} tot en met ${dagTekst(tot)}. Bezwaar indienen kan in die periode.`],
      // Gevonden in openbaar onderzoek, zonder afgelezen datums: alleen de dag waarop het liep.
      [inzageStand({ nagekeken: addDays(today, -1) }), `Op ${dagTekst(addDays(today, -1))} liep er een openbaar onderzoek, volgens het Inzageloket. Tot wanneer je bezwaar kunt indienen, staat in het loket bij "Toestand".`],
    ];
    for (const [inzage, melding] of gevallen) {
      const { page, context, errors } = await openPage(baseUrl, { street, inzage, query: `?plek=${plek}` });
      const sectie = page.locator("section.pv-day", { hasText: "Omgevingsaanvragen en besluiten" });
      await sectie.locator(".pv-row").first().waitFor({ timeout: 15000 });
      assert.equal(await page.locator('section.pv-day[aria-label="Openbaar onderzoek: bezwaar indienen kan nu"]').count(), 0, melding);
      const row = sectie.locator(".pv-row", { hasText: PERMIT_TITLE }).first();
      assert.equal(await row.locator(".pv-row-alert").innerText(), melding);
      assert.ok(await row.locator(".pv-row-alert").isVisible());
      assert.doesNotMatch(await row.locator(".pv-row-kind").innerText(), /Openbaar onderzoek/, "geen badge");
      await row.locator(".pv-row-btn").click();
      assert.equal(await row.locator(`a[href="${LOKET_LINK}"]`).count(), 1);
      assert.doesNotMatch(await row.innerText(), /kon niet nagaan/);
      assert.deepEqual(errors, []);
      await context.close();
    }
  });

  await t.test("lijst met alle omgevingsdossiers: melding, rechtstreekse link en eerlijke zin in een opengeklapte kaart", async () => {
    const tot = addDays(today, 10);
    for (const inzage of [inzageStand({ openbaarOnderzoek: { van: addDays(today, -19), totEnMet: tot }, nagekeken: addDays(today, -1) }), null]) {
      // De lijst toont alleen dossiers als de soort "vergunningen" aan staat.
      const { page, context, errors } = await openPage(baseUrl, { street, inzage, query: "?soort=vergunningen" });
      await page.click(".pv-more > summary");
      const kaart = page.locator("#permits-live .permit-card", { hasText: PERMIT_TITLE }).first();
      await kaart.waitFor({ timeout: 15000 });
      // Openklappen zoals een bewoner: één klik, tot de technische link onderaan de open kaart zichtbaar is.
      // Terwijl de andere lagen nog laden, kan de lijst opnieuw tekenen; de kaart moet dan open blijven.
      const onderaan = kaart.locator("details > summary", { hasText: "Technische stadsbron" });
      await kaart.locator("summary").first().click();
      await onderaan.waitFor({ state: "visible", timeout: 5000 });
      assert.ok(await onderaan.isVisible(), "de kaart klapt open");
      // Tekent de lijst opnieuw (zoals wanneer de wijk klaar is met laden), dan blijft de kaart open.
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("public-agenda:view-change")));
      assert.equal(await kaart.evaluate((el) => el.open), true, "de kaart blijft open als de lijst opnieuw tekent");
      assert.ok(await onderaan.isVisible());
      const tekst = await kaart.innerText();
      assert.equal(await kaart.locator('a[href="https://omgevingsloketinzage.omgeving.vlaanderen.be/"]').count(), 0, "nooit de startpagina van het loket");
      if (inzage) {
        // Eerst in de lijst, de termijn in de dichte kaart, de link naar het dossier zelf.
        assert.equal(await page.locator("#permits-live .permit-card").first().locator(".permit-alert").innerText(), `Openbaar onderzoek loopt tot en met ${dagTekst(tot)}. Bezwaar indienen kan tot dan.`);
        assert.equal(await kaart.locator(`a[href="${LOKET_LINK}"]`).innerText(), "Bekijk dit dossier en de plannen in het Inzageloket");
        assert.equal(await kaart.locator('a[href="https://www.vlaanderen.be/omgevingsvergunning/inzageloket"]').innerText(), BEZWAAR_LABEL);
        assert.doesNotMatch(tekst, /kon niet nagaan/);
      } else {
        assert.equal(await kaart.locator('a[href^="https://omgevingsloketinzage."]').count(), 0);
        assert.ok(tekst.includes(GEEN_INZAGE), tekst);
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
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

  await t.test("evenement op straat tijdens de afbraak: de kaart blijft staan, met 'Afbraak bezig'", async () => {
    const plek = `${street.name}${byName.get(locationKey(street.name)).length > 1 ? ` ${street.postcode}` : ""}`;
    // Het evenement was gisteren; het parkeerverbod van de afbraak loopt tot morgen.
    const { page, context, errors } = await openPage(baseUrl, { street, evenement: { dossier: "ET2099000078", dag: addDays(today, -1), afbraakTot: addDays(today, 1) }, query: `?plek=${encodeURIComponent(plek)}&soort=evenementen` });
    const row = page.locator(".pv-row", { hasText: "Evenement op straat" }).first();
    await row.waitFor({ timeout: 20000 });
    assert.match(await row.locator(".pv-row-btn").innerText(), /Afbraak bezig/);
    // In de sectie "Nu bezig", met het einde van de afbraak.
    const sectie = page.locator(".pv-day", { has: row });
    assert.match(await sectie.locator(".pv-day-title").innerText(), /Nu bezig/);
    assert.match(await row.locator(".pv-row-when").innerText(), /^t\/m /);
    await row.locator(".pv-row-btn").click();
    assert.match(await row.locator(".pv-kern").innerText(), /Jouw straat krijgt een parkeerverbod van /);
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
    const { page, context, errors } = await openPage(baseUrl, { street: peterselie, asign, work: false, aanvraag: false, query: "?plek=Peterseliestraat" });
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
  // Herstelplan O2: de knoppen +250 m tot +1 km toonden nooit een parcours of een vergunning (die hebben
  // geen eigen punt). Nu telt een item mee als zijn eigen vorm binnen de straal ligt. Nakijkbevinding 3:
  // niet zijn straat; een vergunning 900 m verder op een lange straat die tot 200 m komt, blijft weg.
  await t.test("straal zonder punt: parcours en vergunning in een straat 250 m verder", async () => {
    const peterselie = { id: "2289", name: "Peterseliestraat", postcode: "2000" };
    const huik = straten.streets.find((r) => r[1] === "Huikstraat" && r[2] === "2000");
    const [hx1, hy1, hx2, hy2] = huik[4];
    // Een verzonnen lange straat: begint 200 m ten oosten van de Peterseliestraat en loopt 1,5 km door.
    const [px1, py1, px2, py2] = straten.streets.find((r) => r[1] === "Peterseliestraat" && r[2] === "2000")[4];
    const oost = Math.max(px1, px2), pm = (py1 + py2) / 2, opM = (meter) => meter / 69760;
    const lang = [[oost + opM(200), pm], [oost + opM(1700), pm]];
    const assen = [
      { type: "Feature", geometry: { type: "LineString", coordinates: [[hx1, hy1], [hx2, hy2]] }, properties: { LSTRNMID: Number(huik[0]), LSTRNM: "Huikstraat", RSTRNMID: Number(huik[0]), RSTRNM: "Huikstraat", postcode: 2000, DISTRICT: "Antwerpen" } },
      { type: "Feature", geometry: { type: "LineString", coordinates: lang }, properties: { LSTRNMID: 99999001, LSTRNM: "Proeflaan", RSTRNMID: 99999001, RSTRNM: "Proeflaan", postcode: 2000, DISTRICT: "Antwerpen" } },
    ];
    // Een parcours van 12 m breed over de as van de Huikstraat, en een perceel ernaast (verzonnen).
    const lengte = Math.hypot((hx2 - hx1) * 69760, (hy2 - hy1) * 110540);
    const nx = (-(hy2 - hy1) * 110540 / lengte) * (6 / 69760), ny = ((hx2 - hx1) * 69760 / lengte) * (6 / 110540);
    const vlak = [[hx1 + nx, hy1 + ny], [hx2 + nx, hy2 + ny], [hx2 - nx, hy2 - ny], [hx1 - nx, hy1 - ny], [hx1 + nx, hy1 + ny]];
    const ms = (iso) => Date.parse(`${iso}T08:00:00Z`);
    const dag = addDays(today, 3);
    const asign = asignServer({ fixtures: { 22: [{ id: 990001, feature: { attributes: { dossierNummer: "ET2099000001", faseId: "F1", innameId: "I1", dossierStatus: "aanvraag_goedgekeurd", faseNaam: "Evenement", type_dossier: "ETL", innameTypeNaam: "Parcours", innameHinder: "True", faseStartDatum: ms(dag), faseEindDatum: ms(dag) }, geometry: { rings: [vlak] } } }] } });
    const [mx, my] = [(hx1 + hx2) / 2 + nx * 2.5, (hy1 + hy2) / 2 + ny * 2.5], d = 0.00004;
    const perceel = (x, y) => ({ rings: [[[x - d, y - d], [x + d, y - d], [x + d, y + d], [x - d, y + d], [x - d, y - d]]] });
    const maakVergunning = (nr, geometry) => ({ attributes: { DOSSIERTYPE: "Omgevingsvergunning", Dossiernummer: nr, AardAanvraag: "", Onderwerp: "", Beslissing: "", DatumBeslissing: null, Volledig: "", Ontvankelijk: "", Ingetrokken: "", Stopgezet: "", ProjectnummerOmgevingsloket: "", behandelendeOverheid: "", beslissingsoverheid: "" }, geometry });
    // De tweede vergunning ligt aan de Proeflaan, 900 m ten oosten van de Peterseliestraat.
    const vergunningen = [maakVergunning("OMV_2099000001", perceel(mx, my)), maakVergunning("OMV_2099000002", perceel(oost + opM(900), pm + 0.00008))];
    const { page, context, errors } = await openPage(baseUrl, { width: 1280, height: 900, street: peterselie, asign, work: false, assen, vergunningen, query: "?plek=Peterseliestraat" });
    await page.waitForFunction(() => { const l = window.PUBLIC_AGENDA_LIVE_STREETS || {}; return Array.isArray(l.publicSpace) && Array.isArray(l.permits); }, null, { timeout: 30000 });
    const parcours = page.locator(".pv-results .pv-row", { hasText: "Huikstraat" }).filter({ hasText: "Evenement op straat" });
    const vergunning = page.locator(".pv-results .pv-row", { hasText: "Vergunning" }).filter({ hasText: "Huikstraat" });
    await page.waitForTimeout(1500);
    assert.equal(await parcours.count(), 0, "alleen de straat zelf: het parcours ligt elders");
    assert.equal(await vergunning.count(), 0);
    await page.click('.pv-place [data-radius="500"]');
    await parcours.first().waitFor({ timeout: 15000 });
    assert.match(await parcours.first().innerText(), /Niet in je straat, wel binnen 500 m/);
    // Nakijkbevinding 6: de regel "jouw straat" is een eigen regel, nooit na twee regels afgekapt.
    assert.equal(await parcours.first().locator(".pv-row-jouw").evaluate((el) => el.classList.contains("pv-row-where") || getComputedStyle(el).webkitLineClamp !== "none"), false);
    await vergunning.first().waitFor({ timeout: 15000 });
    const ver = page.locator('.pv-results .pv-row[data-uid="permits:permit:OMV_2099000002"]');
    assert.equal(await ver.count(), 0, "een vergunning 900 m verder telt niet mee in +500 m, ook al komt haar straat tot 200 m");
    await page.click('.pv-place [data-radius="1000"]');
    await ver.first().waitFor({ timeout: 15000 });
    assert.match(await page.locator(".pv-sub").innerText(), /terrassen alleen in de straat zelf/);
    assert.deepEqual(errors, []);
    await context.close();
  });
  // Nakijkbevinding 4: per rij van een evenementendossier rekende de site alle straatnamen opnieuw uit.
  // Een dossier met 200 innames en 200 straten in kaart-uitleg.json legde zo een gsm seconden stil.
  await t.test("een groot evenementendossier: de filter rekent één lijst per dossier", async (st) => {
    const peterselie = { id: "2289", name: "Peterseliestraat", postcode: "2000" };
    const [px1, py1, px2, py2] = straten.streets.find((r) => r[1] === "Peterseliestraat" && r[2] === "2000")[4];
    const [mx, my] = [(px1 + px2) / 2, (py1 + py2) / 2], d = 0.00003;
    const ms = (iso) => Date.parse(`${iso}T08:00:00Z`);
    const dag = addDays(today, 5);
    const innames = Array.from({ length: 200 }, (_, i) => ({ id: 991000 + i, feature: { attributes: { dossierNummer: "ET2099000009", faseId: "F1", innameId: `I${i}`, dossierStatus: "aanvraag_goedgekeurd", faseNaam: "Evenement", type_dossier: "ETL", innameTypeNaam: "Parkeerverbod", innameHinder: "False", faseStartDatum: ms(dag), faseEindDatum: ms(dag) }, geometry: { rings: [[[mx - d, my - d], [mx + d, my - d], [mx + d, my + d], [mx - d, my + d], [mx - d, my - d]]] } } }));
    const namen = straten.streets.filter((r) => r[2] === "2000").slice(0, 200).map((r) => r[1]);
    const kaartUitleg = { schemaVersion: 1, generatedAt: `${today}T05:00:00Z`, vanaf: today, tot: addDays(today, 60), werken: {}, evenementen: { ET2099000009: { start: dag, eind: dag, soort: "", soortBron: "", beschrijvingen: [], straten: [...new Set([...namen, "Peterseliestraat"])], kruist: [], stratenTekst: "", gekoppeld: null, kaart: [] } } };
    const { page, context, errors } = await openPage(baseUrl, { width: 1280, height: 900, street: peterselie, asign: asignServer({ fixtures: { 22: innames } }), work: false, kaartUitleg, query: "?plek=Peterseliestraat" });
    await page.waitForFunction(() => Array.isArray((window.PUBLIC_AGENDA_LIVE_STREETS || {}).publicSpace), null, { timeout: 30000 });
    await page.locator(".pv-results .pv-row", { hasText: "Evenement op straat" }).first().waitFor({ timeout: 60000 });
    const duur = await page.evaluate(() => {
      const view = window.PUBLIC_AGENDA_VIEW, rijen = window.PUBLIC_AGENDA_LIVE_STREETS.publicSpace;
      view.resetRefs();
      const t0 = performance.now();
      const treffers = rijen.filter((r) => view.matchesStreet(r)).length;
      return { ms: performance.now() - t0, treffers, rijen: rijen.length };
    });
    assert.equal(duur.treffers, 200, "alle innames van het dossier horen bij de straat");
    st.diagnostic(`200 rijen filteren: ${Math.round(duur.ms)} ms`);
    assert.ok(duur.ms < 1000, `200 rijen filteren duurde ${Math.round(duur.ms)} ms`);
    assert.deepEqual(errors, []);
    await context.close();
  });
});
