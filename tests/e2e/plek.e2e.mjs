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

async function routeSources(page, street) {
  const row = straten.streets.find((r) => String(r[0]) === street.id && r[2] === street.postcode);
  const [x1, y1, x2, y2] = row[4];
  const mid = [(x1 + x2) / 2, (y1 + y2) / 2];
  const axis = { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: [[x1, y1], [x2, y2]] }, properties: { LSTRNMID: Number(street.id), LSTRNM: street.name, RSTRNMID: Number(street.id), RSTRNM: street.name, postcode: Number(street.postcode), DISTRICT: "Antwerpen" } }] };
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
  await page.route((url) => !/^http:\/\/127\.0\.0\.1/.test(url.href), (route) => {
    const url = route.request().url();
    if (url.includes("/collections/INNAME_PUNT/")) return route.fulfill(json(work));
    if (url.includes("/collections/HINDER_PUNT/")) return route.fulfill(json({ type: "FeatureCollection", features: [], links: [] }));
    if (url.includes("/MapServer/109/")) return route.fulfill(json(district));
    if (url.includes("/MapServer/905/")) return route.fulfill(json(axis));
    if (url.includes("/pip2_vergunningen/MapServer/5/")) return route.fulfill(json(url.includes("returnIdsOnly") ? { objectIds: [1] } : { features: [permit] }));
    if (url.includes("geodata.antwerpen.be")) return route.fulfill(json(url.includes("returnIdsOnly") ? { objectIds: [] } : { features: [] }));
    return route.abort();
  });
}

async function openPage(baseUrl, { width = 390, height = 844, query = "", street = null, inzage = null } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 500, hasTouch: width < 500, locale: "nl-BE", timezoneId: "Europe/Brussels" });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(`${today}T10:00:00+02:00`));
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await routeSources(page, street || pickStreet.fallback);
  // Een vaste nagekeken stand in het Inzageloket voor de verzonnen aanvraag (site/inzage-status.js).
  if (inzage) await page.route((url) => url.pathname === "/sources/inzage-status.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(inzage) }));
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
      // Openklappen zoals een bewoner. Terwijl de andere lagen nog laden, kan de lijst opnieuw tekenen (en de
      // kaart weer dichtklappen): dan opnieuw, tot de technische link onderaan de open kaart zichtbaar is.
      const onderaan = kaart.locator("details > summary", { hasText: "Technische stadsbron" });
      for (let poging = 0; poging < 5 && !(await onderaan.isVisible()); poging += 1) {
        if (!(await kaart.evaluate((el) => el.open))) await kaart.locator("summary").first().click();
        await onderaan.waitFor({ state: "visible", timeout: 2000 }).catch(() => {});
      }
      assert.ok(await onderaan.isVisible(), "de kaart klapt open");
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
