// End-to-end: de lijst "Werken en hinder" van het district in een echte browser (Playwright + Chromium), tegen de
// gebouwde site/. Twee aanvullingen bij de GIPOD-werken: de AWV-werfdata (site/works-awv-supplement.js, alleen op
// hetzelfde GIPOD-id) en het blok "Hinder zonder gepubliceerd werk" (site/works-hindrance.js, losseHinder).
// Alles buiten de lokale site wordt onderschept; het AWV-bestand van de verversing ook. Verzonnen werken,
// hinder en werfnummers; de klok staat vast. Zonder Playwright: overgeslagen.
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

const NU = new Date("2026-10-17T10:00:00+02:00");
const WERK = 999999921, LOSSE_HINDER = 999999931, LOSSE_OORZAAK = 999999930;
const straten = JSON.parse(fs.readFileSync(path.join(site, "geo", "straten.json"), "utf8")).streets;
const straat = straten.find((r) => r[1] === "Kammenstraat" && String(r[2]) === "2000");
const district = fs.readFileSync(path.join(root, "lib", "district-antwerpen-grens.geojson"), "utf8");
const awvDoc = (retrievedAt) => ({
  schemaVersion: 1, sourceId: "awv-werf-supplement", retrievedAt, fetchStatus: "ok", contentVersion: "2026-10-16",
  items: [{ gipodId: WERK, werfId: 90001, afdeling: "Antwerpen", soort: ["VRI", "Verzonnen Proefsoort"], fasen: ["Fase 2"], date: "2026-10-01", endDate: "2026-11-30",
    innametypes: ["Rijstrook 1"], doorgang: ["1 rijstrook, versmald"], snelheidsbeperking: true, doorsteek: false, bypass: [], omleidingVoor: ["fietsers"],
    lokaleOmleidingen: 1, opUvRoute: false, gewijzigd: "2026-10-16", innames: 1 }],
});

async function routeSources(page, { awv }) {
  await page.route((url) => url.hostname === "127.0.0.1" && url.pathname === "/straat-index.json", (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "" }));
  await page.route((url) => url.hostname === "127.0.0.1" && url.pathname === "/sources/awv-werf-supplement.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(awv) }));
  const [id, name, postcode, , [x1, y1, x2, y2]] = straat;
  const mid = [(x1 + x2) / 2, (y1 + y2) / 2];
  const axis = { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: [[x1, y1], [x2, y2]] }, properties: { LSTRNMID: Number(id), LSTRNM: name, RSTRNMID: Number(id), RSTRNM: name, postcode: Number(postcode), DISTRICT: "Antwerpen" } }] };
  const werk = { type: "FeatureCollection", links: [], features: [{ type: "Feature", geometry: { type: "Point", coordinates: mid }, properties: {
    GipodId: WERK, Description: "Proefwerk aan de verkeerslichten (e2e)", Owner: "Agentschap Wegen en Verkeer - Afdeling Wegen en Verkeer Antwerpen", Status: "In uitvoering", Type: "Werk",
    Start: "2026-10-01T05:00:00Z", End: "2026-11-30T16:00:00Z",
    // Zoals een ruw GIPOD-record: een Uri en (verzonnen) contactgegevens. Geen van beide mag op de kaart komen.
    Uri: `https://gipod.api.vlaanderen.be/api/v1/works/${WERK}`,
    ContactOrganisations: JSON.stringify([{ ContactRole: "Dossierbeheerder", OrganisationName: "Voorbeeldorganisatie", ContactName: "Voorbeeld Persoon", Email: "voorbeeld@example.org" }]),
  } }] };
  const hinder = { type: "FeatureCollection", links: [], features: [{ type: "Feature", geometry: { type: "Point", coordinates: mid }, properties: {
    HindranceStatus: "Gevalideerd", HindranceGipodId: LOSSE_HINDER, ZoneType: "WerfZone", SevereHindrance: true,
    HindranceConsequenceOf: `https://gipod.api.vlaanderen.be/api/v1/groundworks/${LOSSE_OORZAAK};`, HindranceDescription: "Proefstraat 12: niet tonen",
    HindranceOwner: "Verzonnen Nutsbedrijf", HindranceStart: "2026-11-02T05:00:00Z", HindranceEnd: "2026-11-13T16:00:00Z",
    HindranceLastModifiedOn: "2026-10-10T08:00:00Z", Consequences: "Geen doorgang voor gemotoriseerd verkeer",
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

async function openWerken(baseUrl, awv) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "nl-BE", timezoneId: "Europe/Brussels" });
  const page = await context.newPage();
  await page.clock.setFixedTime(NU);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await routeSources(page, { awv });
  // Zonder plek, met de soort "Werken & verkeer" aan: de lijst van het hele district.
  await page.goto(`${baseUrl}/?soort=werken`);
  await page.waitForSelector(".pv-more > summary");
  await page.click(".pv-more > summary");
  await page.locator("#works-live").scrollIntoViewIfNeeded();
  await page.locator("#works-live [data-works-list] .works-live-card").first().waitFor({ timeout: 20000 });
  return { page, context, errors };
}

test("werkenlijst: AWV-werfdata op hetzelfde GIPOD-id, en losse hinder in een eigen blok", { skip }, async (t) => {
  const server = await serve();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await browser.close(); });

  await t.test("een vers AWV-bestand: de zin, de bron met datum en het blok losse hinder", async () => {
    const { page, context, errors } = await openWerken(baseUrl, awvDoc(new Date(NU.getTime() - 5 * 3_600_000).toISOString()));
    const kaart = page.locator("#works-live .works-live-card").first();
    const awv = kaart.locator(".works-live-awv");
    assert.match(await awv.innerText(), /Volgens AWV-werfdata: ingenomen: Rijstrook 1; doorgang: 1 rijstrook, versmald; snelheidsbeperking; omleiding voor fietsers \(1 lokale omleiding\); fase: Fase 2/);
    assert.equal(await awv.locator("a").innerText(), "Bron: Agentschap Wegen en Verkeer (AWV), open data Werf, bijgewerkt op 16 oktober 2026");
    // Soort werk alleen uit de vaste lijst: een onbekende waarde in het bestand verschijnt niet.
    assert.match(await awv.innerText(), /soort werk: VRI;/);
    assert.doesNotMatch(await awv.innerText(), /Verzonnen Proefsoort/);
    // De status blijft die van GIPOD.
    assert.equal(await kaart.locator(".works-live-status").innerText(), "In uitvoering");
    // Geen link naar het ruwe GIPOD-record (contactgegevens, site/gipod-bron.js), ook niet via Hinder in Kaart
    // met gipodid (dat opent het detailpaneel van het record): op de kaart geen link; onder de lijst de algemene
    // kaart van Hinder in Kaart en één bronvermelding met de datasetfiche.
    assert.equal(await kaart.locator("footer a").count(), 0);
    assert.doesNotMatch(await kaart.innerHTML(), /Technische GIPOD-bron|Hinder in Kaart|gipodid=|gipod\.api\.vlaanderen\.be|geo\.api\.vlaanderen\.be|Voorbeeld Persoon|example\.org/i);
    const bron = page.locator("#works-live [data-works-bron]");
    assert.equal(await bron.isVisible(), true);
    assert.deepEqual(await bron.locator("a").evaluateAll((els) => els.map((a) => [a.textContent, a.href])), [
      ["Officiële kaart: Hinder in Kaart", "https://www.geopunt.be/?app=hinder-in-kaart"],
      ["Bron: GIPOD (Digitaal Vlaanderen)", "https://metadata.vlaanderen.be/srv/api/records/2b4b3bb7-cadc-41a0-b5ae-796a84a20b52"],
    ]);
    const alleLinks = await page.locator("#works-live a").evaluateAll((els) => els.map((a) => a.href));
    assert.equal(alleLinks.some((h) => /gipod\.api\.vlaanderen\.be|geo\.api\.vlaanderen\.be\/GIPOD|gipodid=/i.test(h)), false, alleLinks.join(" "));
    const los = page.locator("#works-live [data-works-loose]");
    await los.waitFor({ state: "visible", timeout: 5000 });
    const tekst = await los.innerText();
    assert.match(tekst, /Hinder zonder gepubliceerd werk \(GIPOD\)/);
    assert.match(tekst, /GIPOD publiceert deze gevalideerde hinder, maar het werk zelf staat niet bij de getoonde werken\./);
    assert.doesNotMatch(tekst, /open GIPOD-laag/);
    assert.match(tekst, /Kammenstraat/);
    assert.match(tekst, /Ernstige hinder/);
    assert.match(tekst, /Geen doorgang voor gemotoriseerd verkeer/);
    assert.doesNotMatch(tekst, /Proefstraat|Verzonnen Nutsbedrijf/);
    // Geen link per hinder (het ruwe HINDER_PUNT-record heeft contactgegevens): één bronvermelding met de datasetfiche.
    assert.equal(await los.locator("li a").count(), 0);
    assert.equal(await los.locator("a").count(), 1);
    assert.equal(await los.locator("a").innerText(), "Bron: GIPOD (Digitaal Vlaanderen)");
    assert.equal(await los.locator("a").getAttribute("href"), "https://metadata.vlaanderen.be/srv/api/records/2b4b3bb7-cadc-41a0-b5ae-796a84a20b52");
    assert.doesNotMatch(await los.innerHTML(), /HINDER_PUNT|HindranceGipodId/);
    assert.match(await page.locator("#works-live [data-works-meta]").innerText(), /1 met AWV-werfdata · .*1 hinder zonder gepubliceerd werk/);
    assert.deepEqual(errors, []);
    await context.close();
  });

  // Besluit van de eigenaar (18-10-2026): "niemand moet weten als er iets faalt". Vroeger zei de notitie "De
  // AWV-werfdata is ouder dan 3 dagen en wordt daarom niet getoond."
  await t.test("een AWV-bestand van 4 dagen oud: niets van AWV, en geen notitie dat het oud is", async () => {
    const { page, context, errors } = await openWerken(baseUrl, awvDoc(new Date(NU.getTime() - 4 * 24 * 3_600_000).toISOString()));
    assert.equal(await page.locator("#works-live .works-live-awv").count(), 0);
    const notitie = page.locator("#works-live [data-works-note]");
    await page.waitForFunction(() => /^Live GIPOD/.test(document.querySelector("#works-live [data-works-note]")?.textContent || ""), null, { timeout: 15000 });
    assert.doesNotMatch(await notitie.innerText(), /AWV|ouder dan|kon nu niet|niet geladen/);
    assert.deepEqual(errors, []);
    await context.close();
  });
});
