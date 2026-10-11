// End-to-end: opmaak op een gsm (390 × 844 en 360 px) en toegankelijkheid van de plekweergave, in Chromium.
// Zelfde opzet als plek.e2e.mjs: de site/ lokaal, elke externe bron onderschept, een vaste klok.
// Een evenement op straat met parcours (een fictief dossier) wordt als live A-Sign-laag ingeschoven,
// in de vorm die public-space-live.js zelf aanmaakt; zo valt een volle parcourskaart te meten
// zonder live gegevens. axe-core is optioneel: zet AXE_CORE_PATH naar axe.min.js, anders wordt
// die deeltoets overgeslagen. Zonder Playwright of Chromium wordt alles overgeslagen.
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
const axePath = process.env.AXE_CORE_PATH && fs.existsSync(process.env.AXE_CORE_PATH) ? process.env.AXE_CORE_PATH : "";

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };
function serve() {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = path.normalize(path.join(site, pathname));
    if (!file.startsWith(site)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) file = path.join(site, "index.html");
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// ---- vaste gegevens ----
const straten = JSON.parse(fs.readFileSync(path.join(site, "geo", "straten.json"), "utf8")).streets;
const feedText = fs.readFileSync(path.join(site, "agenda-feed.js"), "utf8");
const today = JSON.parse(feedText.slice(feedText.indexOf("{"), feedText.lastIndexOf("}") + 1)).generatedAt.slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const district = fs.readFileSync(path.join(root, "lib", "district-antwerpen-grens.geojson"), "utf8");
// Een lange straatnaam: die brak op een gsm midden in het woord.
const row = straten.find((r) => r[1] === "Van Kerckhovenstraat" && r[2] === "2060");
const STRAAT = { id: String(row[0]), name: row[1], postcode: row[2] };
const DOSSIER = "ET2099000001"; // fictief dossier
const ref = (r) => ({ id: String(r[0]), name: r[1], postcode: String(r[2]) });
const parcoursStraten = [STRAAT, ...straten.filter((r) => r[2] === "2060" && r[1] !== STRAAT.name).slice(0, 39).map(ref)];

// Innames van één evenementendossier, zoals iodItems() in public-space-live-core.js ze aanmaakt.
function parcoursRijen(dagen = 8) {
  const dag = addDays(today, dagen);
  const onderdelen = [
    ["Parcours", "Parcours volwassenen 10 km"], ["Parcours", "Parcours jeugd 5 km"], ["Parkeerverbod", "Parkeerverbod langs het parcours"],
    ["Omleiding", "Omleiding voor fietsers tijdens de wedstrijd"], ["Parkeerverbod", "Servicepunt aan de start"], ["Parcours", "Ronde voor de jeugd, halve ronde"],
  ];
  return onderdelen.map(([type, beschrijving], i) => ({
    id: `iod:${DOSSIER}|${i + 1}|${i + 1}`, kind: "iod", kindLabel: "Inname openbaar domein", title: type, innameType: type,
    location: "", start: `${dag}T05:00:00.000Z`, end: `${dag}T17:00:00.000Z`, status: "toelating_gegenereerd", reference: DOSSIER,
    detail: "", phase: "Evenement", dossierType: "ETL", hindrance: "True", description: beschrijving,
    sourceLabel: "A-Sign IOD", sourceUrl: "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/22",
    streets: i === 0 ? parcoursStraten : parcoursStraten.slice(i, i + 4), streetResolution: "exact", streetDistanceMeters: 0,
  }));
}

// Nog twee verzonnen dossiers in de straat, in dezelfde vorm: een op losse dagen (vandaag + 2 en + 9) en een
// van 90 dagen dat al loopt (twee weken of langer: "Doorlopend"). `perioden`: [van, tot] in dagen na vandaag.
const LOSSE_DAGEN = "ET2099000002", LANG_DOSSIER = "ET2099000003";
function dossierRijen(dossier, perioden) {
  return perioden.map(([van, tot], i) => ({
    id: `iod:${dossier}|${i + 1}|${i + 1}`, kind: "iod", kindLabel: "Inname openbaar domein", title: "Inname", innameType: "Inname",
    location: "", start: `${addDays(today, van)}T05:00:00.000Z`, end: `${addDays(today, tot)}T17:00:00.000Z`, status: "toelating_gegenereerd", reference: dossier,
    detail: "", phase: "Evenement", dossierType: "ETL", hindrance: "True", description: "",
    sourceLabel: "A-Sign IOD", sourceUrl: "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/22",
    streets: [STRAAT], streetResolution: "exact", streetDistanceMeters: 0,
  }));
}
const losseDagenRijen = () => dossierRijen(LOSSE_DAGEN, [[2, 2], [9, 9]]);
const langeRijen = () => dossierRijen(LANG_DOSSIER, [[-30, 60]]);

// `werkenHangen`: GIPOD (de werken) antwoordt niet, zoals een laag die nog onderweg is.
async function routeSources(page, { werkenHangen = false } = {}) {
  // Zonder straatbestanden (P5): deze toetsen gaan over de volledige live lagen, niet over de stand van
  // de ochtend (die toetst tests/e2e/snelheid.e2e.mjs), en hangen zo niet af van wat er in site/straat staat.
  await page.route((url) => url.hostname === "127.0.0.1" && url.pathname === "/straat-index.json", (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "" }));
  const [x1, y1, x2, y2] = row[4];
  const axis = { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: [[x1, y1], [x2, y2]] }, properties: { LSTRNMID: Number(STRAAT.id), LSTRNM: STRAAT.name, RSTRNMID: Number(STRAAT.id), RSTRNM: STRAAT.name, postcode: Number(STRAAT.postcode), DISTRICT: "Antwerpen" } }] };
  const json = (body) => ({ status: 200, contentType: "application/json", body: typeof body === "string" ? body : JSON.stringify(body) });
  await page.route((url) => !/^http:\/\/127\.0\.0\.1/.test(url.href), (route) => {
    const url = route.request().url();
    if (url.includes("/collections/") && werkenHangen) return undefined;
    if (url.includes("/collections/")) return route.fulfill(json({ type: "FeatureCollection", features: [], links: [] }));
    if (url.includes("/MapServer/109/")) return route.fulfill(json(district));
    if (url.includes("/MapServer/905/")) return route.fulfill(json(axis));
    if (url.includes("geodata.antwerpen.be")) return route.fulfill(json(url.includes("returnIdsOnly") ? { objectIds: [] } : { features: [] }));
    return route.abort();
  });
}

// Een omgevingsaanvraag zonder bevestigd doel: de titel begint met het lange woord "Omgevingsaanvraag",
// dat op 360 px midden in brak toen de tijdkolom ernaast stond. Fictief dossier, geen huisnummer.
const VERGUNNING = {
  id: "permit:E2E-OMV-2099-0001", dossier: "OMV_2099000001", dossierType: "Omgevingsvergunning", address: STRAAT.name,
  streets: [STRAAT], decision: "", authority: "", sourceUrl: "https://www.omgevingsloket.be/",
};
// Een aanvraag over vier straten, de gekozen straat als laatste: op 360 px kapte de regel "Waar"
// (twee regels) die straat af toen de tijdkolom ernaast stond. Fictief dossier, alleen straatnamen.
const naast = ["Beatrijslaan", "Blancefloerlaan", "Sint-Annatunnel"].map((naam) => ref(straten.find((r) => r[1] === naam)));
const VERGUNNING_STRATEN = {
  id: "permit:E2E-OMV-2099-0002", dossier: "OMV_2099000002", dossierType: "Omgevingsvergunning", address: "",
  streets: [...naast, STRAAT], decision: "", authority: "", sourceUrl: "https://www.omgevingsloket.be/",
};

// In de pagina: woorden die over twee regels lopen zonder spatie of koppelteken als breekpunt.
function brokenWordsIn(selector) {
  const out = [];
  for (const root of document.querySelectorAll(selector)) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode, el = node.parentElement;
      if (!el || el.closest("[hidden], .pv-sr") || (el.closest("details:not([open])") && !el.closest("summary"))) continue;
      const re = /[^\s\-­‐-―/·,.;:()–—]+/g;
      let m;
      while ((m = re.exec(node.data))) {
        if (m[0].length < 3) continue;
        const range = document.createRange();
        range.setStart(node, m.index); range.setEnd(node, m.index + m[0].length);
        const lines = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
        if (lines.size > 1) out.push(m[0]);
      }
    }
  }
  return out;
}

// Telt de pixels die duidelijk verschillen tussen twee schermafdrukken (in de browser zelf, zonder extra pakket).
function duidelijkAnderePixelsIn(page, a, b) {
  return page.evaluate(async ([srcA, srcB]) => {
    const laad = (src) => new Promise((ok, fout) => { const img = new Image(); img.onload = () => ok(img); img.onerror = fout; img.src = src; });
    const [ia, ib] = await Promise.all([laad(srcA), laad(srcB)]);
    const doek = document.createElement("canvas");
    doek.width = ia.width; doek.height = ia.height;
    const ctx = doek.getContext("2d");
    ctx.drawImage(ia, 0, 0);
    const da = ctx.getImageData(0, 0, doek.width, doek.height).data;
    ctx.clearRect(0, 0, doek.width, doek.height);
    ctx.drawImage(ib, 0, 0);
    const db = ctx.getImageData(0, 0, doek.width, doek.height).data;
    let n = 0;
    for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 60) n += 1;
    return n;
  }, [`data:image/png;base64,${a.toString("base64")}`, `data:image/png;base64,${b.toString("base64")}`]);
}

// `extra`: nog rijen in de laag (dossierRijen); `kaart: false` wacht niet op de parcourskaart (die staat niet
// in de tijdlijn als het parcours later dan 14 dagen valt).
async function openPlace(baseUrl, { width = 390, height = 844, weergave = "", dagen = 8, vergunning = false, colorScheme = "light", extra = [], werkenHangen = false, kaart = true } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 500, hasTouch: width < 500, locale: "nl-BE", timezoneId: "Europe/Brussels", colorScheme });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(`${today}T10:00:00+02:00`));
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await routeSources(page, { werkenHangen });
  await page.goto(`${baseUrl}/?plek=${encodeURIComponent(STRAAT.name)}&periode=alles${weergave ? `&weergave=${weergave}` : ""}`);
  await page.waitForSelector(".pv-place-name");
  // Eerst de (lege) live laag laten landen, dan het parcours inschuiven zoals de laag het zelf doet.
  await page.waitForFunction(() => Array.isArray(window.PUBLIC_AGENDA_LIVE_STREETS?.publicSpace), null, { timeout: 15000 });
  await page.evaluate(([rows, permits]) => {
    window.PUBLIC_AGENDA_LIVE_STREETS.publicSpace = rows;
    window.dispatchEvent(new CustomEvent("public-agenda:street-layer", { detail: { name: "publicSpace", items: rows } }));
    if (!permits.length) return;
    window.PUBLIC_AGENDA_LIVE_STREETS.permits = permits;
    window.dispatchEvent(new CustomEvent("public-agenda:street-layer", { detail: { name: "permits", items: permits } }));
  }, [[...parcoursRijen(dagen), ...extra], vergunning ? [VERGUNNING, VERGUNNING_STRATEN] : []]);
  const card = page.locator(".pv-row", { hasText: "parcours" }).first();
  if (kaart) await card.waitFor({ timeout: 15000 });
  return { page, context, errors, card };
}

test("opmaak op gsm en toegankelijkheid", { skip }, async (t) => {
  const server = await serve();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await browser.close(); });

  for (const width of [390, 360]) await t.test(`open parcourskaart op ${width} px: labels boven de waarden, geen woordbreuk, lager dan 1.500 px`, async (t) => {
    const { page, context, errors, card } = await openPlace(baseUrl, { width });
    await card.locator(".pv-row-btn").click();
    assert.equal(await card.locator(".pv-row-btn").getAttribute("aria-expanded"), "true");
    const meting = await card.evaluate((li) => {
      const detail = li.querySelector(".pv-detail").getBoundingClientRect();
      const paren = [...li.querySelectorAll(".pv-detail dl > div")].filter((d) => d.querySelector("dt")?.getClientRects().length).map((d) => {
        const dt = d.querySelector("dt").getBoundingClientRect(), dd = d.querySelector("dd").getBoundingClientRect();
        // De kern van een evenementkaart (#140) is een kader met binnenmarge: meet tegen de binnenkant van die lijst.
        const dl = d.closest("dl"), st = getComputedStyle(dl);
        const binnen = dl.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight);
        return { label: d.querySelector("dt").textContent, ddLinks: Math.round(dd.left - dt.left), ddOnder: dd.top >= dt.bottom - 1, ddBreed: Math.round(dd.width), binnen: Math.round(binnen) };
      });
      return { hoogte: Math.round(li.getBoundingClientRect().height), detailBreed: Math.round(detail.width), paren };
    });
    t.diagnostic(`open parcourskaart op ${width} px: ${meting.hoogte}px hoog, detail ${meting.detailBreed}px breed`);
    assert.ok(meting.paren.length >= 4, `regels: ${JSON.stringify(meting.paren)}`);
    for (const p of meting.paren) {
      assert.ok(p.ddOnder && Math.abs(p.ddLinks) <= 1, `"${p.label}": waarde staat niet onder het label (${JSON.stringify(p)})`);
      assert.ok(p.ddBreed >= Math.min(meting.detailBreed, p.binnen) - 2, `"${p.label}": waardekolom ${p.ddBreed}px van ${Math.min(meting.detailBreed, p.binnen)}px`);
    }
    assert.deepEqual(await page.evaluate(brokenWordsIn, ".pv-place, .pv-row.open"), [], "geen woord breekt midden in");
    assert.ok(meting.hoogte < 1500, `open parcourskaart is ${meting.hoogte}px hoog`);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test("open parcourskaart: welk parcours, wat er nog gebeurt, wat, wanneer, waar en waarom zichtbaar; alleen nummer en codes dicht", async () => {
    const { context, card } = await openPlace(baseUrl);
    await card.locator(".pv-row-btn").click();
    const zicht = await card.evaluate((li, dossier) => {
      const zichtbaar = (el) => Boolean(el.getClientRects().length) && !el.closest("details:not([open]), [hidden]");
      // De zichtbare tekst: elk tekstknooppunt waarvan het element te zien is (niet in een dichte details).
      const delen = [], loper = document.createTreeWalker(li.querySelector(".pv-detail"), NodeFilter.SHOW_TEXT);
      while (loper.nextNode()) if (loper.currentNode.textContent.trim() && zichtbaar(loper.currentNode.parentElement)) delen.push(loper.currentNode.textContent.trim());
      const tekst = delen.join(" \n ");
      const bron = li.querySelector("details.pv-bron-dossier");
      return {
        tekst,
        labels: [...li.querySelectorAll(".pv-detail dt")].filter(zichtbaar).map((d) => d.textContent.trim()),
        // Wat dicht staat onder "Bron en dossier": regels en links.
        dicht: [...(bron?.querySelectorAll("dt") || [])].map((d) => d.textContent.trim()),
        bronOpen: bron?.open ?? null,
        losNummer: [...li.querySelectorAll(".pv-detail *")].some((el) => zichtbaar(el) && el.textContent.trim() === `Dossier ${dossier}`),
        knoppen: [...li.querySelectorAll(".pv-detail details:not(.pv-bron-dossier) > summary")].map((s) => s.textContent.trim()),
        straten: [...li.querySelectorAll(".pv-detail details.pv-streets")].find((d) => /^Toon alle/.test(d.querySelector("summary").textContent))?.textContent || "",
      };
    }, DOSSIER);
    // Welk parcours: elk parcoursdeel uit het dossier staat zichtbaar (Jonathan: "welke race, welk parcours"),
    // en wat er verder gebeurt (de omleiding) ook. Alleen de parkeerverboden staan ingeklapt.
    for (const deel of ["Parcours volwassenen 10 km", "Parcours jeugd 5 km", "Ronde voor de jeugd, halve ronde", "Omleiding voor fietsers tijdens de wedstrijd"]) assert.match(zicht.tekst, new RegExp(deel), deel);
    assert.doesNotMatch(zicht.tekst, /Parkeerverbod langs het parcours|Servicepunt aan de start/);
    assert.ok(zicht.knoppen.includes("Toon de 2 parkeerverboden uit het dossier"), zicht.knoppen.join(" | "));
    for (const label of ["Wat", "Wanneer", "Waar"]) assert.ok(zicht.labels.includes(label), `${label} zichtbaar: ${zicht.labels.join(", ")}`);
    // Waarom het in de agenda staat, blijft zichtbaar (of de kaart het zo noemt of niet).
    assert.match(zicht.tekst, /toegelaten inname|toelating/);
    // Dicht staan alleen de organisator (niet openbaar; "Niet in de bron" zegt dat al), het nummer en de codes.
    // Na de samenvoeging met #140 heeft een evenementkaart geen codes meer, en staat het dossiernummer in
    // de korte bronzin onderaan ("De stad gaf toelating voor dit evenement (dossier …)"): dan is er geen
    // blok "Bron en dossier".
    assert.notEqual(zicht.bronOpen, true);
    for (const label of zicht.dicht) assert.ok(["Organisator", "Referentie"].includes(label), `"${label}" staat dicht`);
    assert.equal(zicht.losNummer, false, "het dossiernummer staat niet als losse regel open");
    assert.doesNotMatch(zicht.tekst, /IOD = |ETL = /, "de codes staan niet open");
    assert.match(zicht.tekst, new RegExp(`\\(dossier ${DOSSIER}\\)`), "het dossiernummer staat in de bronzin");
    // De uitleg bij de stratenlijst staat bij die lijst, niet als losse regel.
    assert.doesNotMatch(zicht.tekst, /berekend uit de kaart van de stad\. Ze zijn niet allemaal tegelijk dicht/);
    assert.match(zicht.straten, /Straten langs het parcours, berekend uit de kaart van de stad/);
    await context.close();
  });

  await t.test("smalle gsm (360 en 320 px) en tekst 200 %: de tijd boven de soort, de titel en de straten over de volle breedte", async () => {
    const meet = (page) => page.$$eval(".pv-row-btn", (knoppen) => knoppen.filter((b) => b.getClientRects().length).map((b) => {
      const r = (s) => b.querySelector(s)?.getBoundingClientRect();
      const tijd = r(".pv-row-when"), soort = r(".pv-row-kind"), titel = r(".pv-row-title");
      return { titel: b.querySelector(".pv-row-title")?.textContent.slice(0, 40), boven: tijd.bottom <= soort.top + 1, links: Math.round(titel.left - tijd.left), breed: Math.round(titel.width), knop: Math.round(b.clientWidth) };
    }));
    for (const width of [360, 320]) {
      const smal = await openPlace(baseUrl, { width, height: 780, vergunning: true });
      await smal.page.locator(".pv-row-title", { hasText: "Omgevingsaanvraag" }).first().waitFor({ timeout: 15000 });
      const rijen = await meet(smal.page);
      assert.ok(rijen.length >= 3, JSON.stringify(rijen));
      for (const rij of rijen) {
        assert.ok(rij.boven && Math.abs(rij.links) <= 1, `${width} px: tijd niet boven de titel: ${JSON.stringify(rij)}`);
        assert.ok(rij.breed >= rij.knop - 40, `${width} px: titel ${rij.breed}px in een knop van ${rij.knop}px: ${JSON.stringify(rij)}`);
      }
      assert.deepEqual(await smal.page.evaluate(brokenWordsIn, ".pv-row"), [], `geen woord breekt midden in op ${width} px`);
      // De regel "Waar" (hoogstens twee regels) kapt de gekozen straat niet af.
      const waar = await smal.page.locator(".pv-row-where", { hasText: naast[0].name }).evaluate((el) => ({ tekst: el.textContent, past: el.scrollHeight <= el.clientHeight + 1 }));
      // Na de samenvoeging met #146: de dichtste straat eerst, de gekozen straat meteen na "ook dicht bij".
      assert.ok(waar.past && waar.tekst.includes(STRAAT.name), `${width} px: ${JSON.stringify(waar)}`);
      await smal.context.close();
    }
    // Tekst 200 % op een gsm van 390 px: de tijdkolom groeide mee en drukte de titel smal; en de pagina
    // schoof opzij door de kop "Omgevingsaanvragen en besluiten".
    const groot = await openPlace(baseUrl, { vergunning: true });
    await groot.page.locator(".pv-day-title", { hasText: "Omgevingsaanvragen" }).waitFor({ timeout: 15000 });
    await groot.page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    for (const rij of await meet(groot.page)) assert.ok(rij.boven && Math.abs(rij.links) <= 1, `tekst 200 %: ${JSON.stringify(rij)}`);
    assert.deepEqual(await groot.page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]), [390, 390], "tekst 200 %: de pagina schuift niet opzij");
    await groot.context.close();
  });

  await t.test("geen pagina die opzij schuift op 360 en 320 px (lijst, tijdlijn, maand), en de straalknoppen houden hun tekst binnen", async () => {
    for (const width of [360, 320]) {
      for (const weergave of ["", "tijdlijn", "maand"]) {
        const { page, context } = await openPlace(baseUrl, { width, height: 780, weergave, dagen: 0 });
        if (weergave) await page.locator(weergave === "maand" ? ".pv-nav:not([hidden])" : ".pv-tl-strip").waitFor({ timeout: 15000 });
        const m = await page.evaluate(() => ({
          scroll: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
          straal: [...document.querySelectorAll(".pv-radius button")].map((b) => ({ tekst: b.textContent, sw: b.scrollWidth, cw: b.clientWidth, links: Math.round(b.getBoundingClientRect().left), rechts: Math.round(b.getBoundingClientRect().right) })),
        }));
        assert.deepEqual(m.scroll, [width, width], `${width} px ${weergave || "lijst"}: de pagina schuift ${m.scroll[0] - m.scroll[1]}px opzij`);
        assert.equal(m.straal.length, 4);
        for (const [i, b] of m.straal.entries()) {
          assert.ok(b.sw <= b.cw, `${width} px: "${b.tekst}" loopt uit de knop (${b.sw} > ${b.cw})`);
          if (i) assert.ok(m.straal[i - 1].rechts <= b.links, `${width} px: "${m.straal[i - 1].tekst}" en "${b.tekst}" overlappen`);
        }
        await context.close();
      }
    }
  });

  await t.test("sectiekop op 360 px: ook over twee regels staat het aantal ernaast, en geen woord breekt", async () => {
    const { page, context } = await openPlace(baseUrl, { width: 360, height: 780, vergunning: true });
    await page.locator(".pv-day-title", { hasText: "Omgevingsaanvragen" }).waitFor({ timeout: 15000 });
    assert.deepEqual(await page.evaluate(brokenWordsIn, ".pv-day-title"), []);
    // Het aantal staat naast de kop en niet op een eigen regel eronder.
    const koppen = await page.$$eval(".pv-day-title", (hs) => hs.map((h) => {
      const n = h.querySelector(".pv-day-n").getBoundingClientRect(), r = h.getBoundingClientRect();
      return { kop: h.textContent, naast: n.bottom <= r.top + n.height + 12 };
    }));
    for (const k of koppen) assert.ok(k.naast, `het aantal staat onder de kop: ${k.kop}`);
    await context.close();
  });

  await t.test("tijdlijn: 14 dagen binnen de breedte, een stip per soort, en tikken op een dag filtert de lijst", async () => {
    for (const width of [390, 1280]) {
      const { page, context } = await openPlace(baseUrl, { width, height: 900, weergave: "tijdlijn" });
      await page.locator(".pv-tl-strip").waitFor({ timeout: 15000 });
      const m = await page.evaluate(() => ({
        dagen: [...document.querySelectorAll(".pv-tl-dag")].map((b) => { const r = b.getBoundingClientRect(); return { d: b.dataset.tlDag, links: r.left, rechts: r.right, stippen: b.querySelectorAll(".pv-tl-stippen i").length }; }),
        breed: document.documentElement.clientWidth,
      }));
      assert.equal(m.dagen.length, 14);
      for (const d of m.dagen) assert.ok(d.links >= 0 && d.rechts <= m.breed, `${width} px: ${d.d} valt buiten beeld`);
      // Het parcours loopt de komende dagen: die dagen hebben een stip, en tikken toont alleen wat die dag loopt.
      const metStip = m.dagen.find((d) => d.stippen);
      assert.ok(metStip, "minstens één dag met een stip");
      await page.click(`[data-tl-dag="${metStip.d}"]`);
      const rijen = await page.locator(".pv-results .pv-row").count();
      assert.ok(rijen >= 1, "de gekozen dag toont zijn items");
      assert.match(await page.locator(".pv-results .pv-day-title").first().innerText(), new RegExp(String(Number(metStip.d.slice(8)))));
      await page.click(".pv-tl-alle");
      assert.equal(await page.locator(".pv-tl-dag[aria-pressed=\"true\"]").count(), 0);
      await context.close();
    }
  });

  // ---- nakijkbevindingen bij de tijdlijn (PR #166) ----
  const WEEKDAGEN = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
  const MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
  const langeDatum = (iso) => `${WEEKDAGEN[new Date(`${iso}T12:00:00Z`).getUTCDay()]} ${Number(iso.slice(8))} ${MAANDEN[Number(iso.slice(5, 7)) - 1]}`;
  const tlDag = (n) => addDays(today, n);
  const dagKnoppen = (page) => page.$$eval(".pv-tl-dag", (bs) => bs.map((b) => ({ d: b.dataset.tlDag, naam: b.getAttribute("aria-label"), tekens: [...b.querySelectorAll(".pv-tl-stippen > *")].map((i) => i.className) })));
  const dossierRij = (page, dossier) => page.locator(`.pv-results .pv-row[data-uid="publicSpace:dossier:${dossier}"]`);
  const sectieVan = (rij) => rij.evaluate((li) => li.closest("section.pv-day")?.getAttribute("aria-label") || "");

  await t.test("tijdlijn: een dossier op losse dagen staat alleen op die dagen; twee weken of langer staat bij 'Doorlopend', zonder teken per dag", async () => {
    const { page, context, errors } = await openPlace(baseUrl, { weergave: "tijdlijn", extra: [...losseDagenRijen(), ...langeRijen()] });
    await dossierRij(page, LOSSE_DAGEN).waitFor({ timeout: 15000 });
    // Alle afwijkingen samen melden: zo toont een rode toets elk deel dat niet klopt.
    const fouten = [];
    const zeker = (ok, melding) => { if (!ok) fouten.push(melding); };
    // Op een losse dag staat het dossier in de lijst van die dag; op de dagen ertussen niet.
    for (const [n, opDieDag] of [[2, true], [3, false], [5, false], [9, true]]) {
      const d = tlDag(n);
      await page.click(`[data-tl-dag="${d}"]`);
      assert.equal(await page.locator(`[data-tl-dag="${d}"]`).getAttribute("aria-pressed"), "true");
      const aantal = await dossierRij(page, LOSSE_DAGEN).count();
      zeker(aantal === (opDieDag ? 1 : 0), `${d} (+${n}): het dossier met losse dagen staat ${aantal ? "wel" : "niet"} bij die dag`);
      if (opDieDag && aantal) zeker(await sectieVan(dossierRij(page, LOSSE_DAGEN)) === langeDatum(d), `${d}: niet onder de kop van die dag`);
      // Zonder iets van die dag zelf in de lijst: geen teken en geen evenement in de naam van de dagknop.
      if (!opDieDag && !(await page.locator(".pv-results section.pv-day:not([aria-label^='Doorlopend'])").count())) {
        const knop = (await dagKnoppen(page)).find((k) => k.d === d);
        zeker(!knop.tekens.length, `${d}: tekens ${knop.tekens.join(", ")} op een dag zonder iets`);
        zeker(!/evenement/.test(knop.naam), `${d}: "${knop.naam}"`);
      }
      // Het lange dossier loopt die dag, maar niet als iets van die dag: bij "Doorlopend".
      const lang = await sectieVan(dossierRij(page, LANG_DOSSIER));
      zeker(/^Doorlopend/.test(lang), `${d}: het lange dossier staat onder "${lang}", niet bij "Doorlopend"`);
    }
    // De tekens in de strook: het dossier met losse dagen op +2 en +9.
    const knoppen = await dagKnoppen(page);
    for (const n of [2, 9]) zeker(knoppen.find((k) => k.d === tlDag(n)).tekens.some((c) => /cat-festival/.test(c)), `+${n} heeft geen teken`);
    // Zonder gekozen dag: het dossier met losse dagen bij de 14 dagen, het lange bij "Doorlopend".
    await page.click(".pv-tl-alle");
    zeker(/^Komende 14 dagen/.test(await sectieVan(dossierRij(page, LOSSE_DAGEN))), "zonder gekozen dag: losse dagen niet bij de 14 dagen");
    zeker(/^Doorlopend/.test(await sectieVan(dossierRij(page, LANG_DOSSIER))), "zonder gekozen dag: het lange dossier niet bij 'Doorlopend'");
    assert.deepEqual(fouten, []);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test("tijdlijn: de naam van een dagknop begint met 'Vandaag' en telt in enkelvoud of meervoud", async () => {
    const { page, context } = await openPlace(baseUrl, { weergave: "tijdlijn" });
    const knoppen = await dagKnoppen(page);
    const fouten = [];
    assert.equal(knoppen[0].d, today);
    if (!new RegExp(`^Vandaag, ${langeDatum(today)}: `).test(knoppen[0].naam)) fouten.push(`vandaag: "${knoppen[0].naam}"`);
    for (const k of knoppen.slice(1)) if (!new RegExp(`^${langeDatum(k.d)}: `).test(k.naam)) fouten.push(`${k.d}: "${k.naam}"`);
    // Nooit "1 evenementen" of "1 markten": bij 1 het enkelvoud.
    for (const k of knoppen) if (/(^|\D)1 (evenementen|markten|werken|items|vergaderingen)\b/.test(k.naam)) fouten.push(`meervoud bij 1: "${k.naam}"`);
    // Het parcours over 8 dagen: "1 evenement" (of meer, als de data die dag nog een evenement heeft).
    const parcoursDag = knoppen.find((k) => k.d === tlDag(8)).naam;
    if (!/: (.*, )?(1 evenement(?!en)|([2-9]|\d{2,}) evenementen)/.test(parcoursDag)) fouten.push(`parcoursdag: "${parcoursDag}"`);
    assert.deepEqual(fouten, []);
    await context.close();
  });

  await t.test("tijdlijn: zolang de werken laden, zegt geen dag 'niets gepland', ook niet de lege dag zelf", async () => {
    const { page, context, errors } = await openPlace(baseUrl, { weergave: "tijdlijn", werkenHangen: true });
    await page.locator(".pv-tl-strip").waitFor({ timeout: 15000 });
    const leeg = (await dagKnoppen(page)).filter((k) => !k.tekens.length);
    assert.ok(leeg.length, "minstens één dag zonder teken");
    for (const k of leeg) {
      assert.doesNotMatch(k.naam, /niets gepland/, k.naam);
      assert.match(k.naam, /: nog niets gevonden, werken wordt nog geladen$/, k.naam);
    }
    await page.click(`[data-tl-dag="${leeg[0].d}"]`);
    const tekst = await page.locator(".pv-results .pv-empty").innerText();
    assert.doesNotMatch(tekst, /niets gepland|niets op de agenda/i, tekst);
    assert.match(tekst, /In wat al geladen is, staat op die dag niets; werken wordt nog geladen\./, tekst);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test("tijdlijn: een lege dag zegt dat over die dag, niet 'niets voor deze straat'; leeg over 14 dagen wijst naar wat later komt", async () => {
    let { page, context, errors } = await openPlace(baseUrl, { weergave: "tijdlijn" });
    const fouten = [];
    const knoppen = await dagKnoppen(page);
    const leeg = knoppen.find((k) => !k.tekens.length);
    const metIets = knoppen.filter((k) => k.d !== leeg.d && k.tekens.length).length;
    // Alles geladen: de naam van de lege dag zegt "binnen je keuze" (soorten die uit staan, tellen niet mee).
    if (!/: niets gepland binnen je keuze$/.test(leeg.naam)) fouten.push(`naam van de lege dag: "${leeg.naam}"`);
    await page.click(`[data-tl-dag="${leeg.d}"]`);
    let blok = page.locator(".pv-results .pv-empty");
    let kop = await blok.locator("h3").innerText();
    if (kop !== `Niets gevonden in ${STRAAT.name} op ${langeDatum(leeg.d)}`) fouten.push(`lege dag, kop: "${kop}"`);
    let tekst = await blok.innerText();
    if (/voor deze straat|niets op de agenda/i.test(tekst)) fouten.push(`lege dag spreekt over de hele straat: "${tekst}"`);
    if (!new RegExp(`Binnen je keuze staat op die dag niets gepland\\. Op ${metIets === 1 ? "1 andere dag" : `${metIets} andere dagen`} van de komende 14 dagen staat wel iets`).test(tekst)) fouten.push(`lege dag, uitleg: "${tekst}"`);
    assert.equal(await page.locator(".pv-tl-alle").count(), 1, "'Toon alle 14 dagen' staat eronder");
    assert.deepEqual(errors, []);
    await context.close();
    // Het parcours pas over 20 dagen en verder niets in de straat: zeg dat over de 14 dagen, met de tip voor later.
    ({ page, context, errors } = await openPlace(baseUrl, { weergave: "tijdlijn", dagen: 20, kaart: false }));
    blok = page.locator(".pv-results .pv-empty");
    await blok.locator("h3").waitFor({ timeout: 15000 });
    kop = await blok.locator("h3").innerText();
    if (kop !== `Niets gevonden in ${STRAAT.name} in de komende 14 dagen`) fouten.push(`14 dagen leeg, kop: "${kop}"`);
    tekst = await blok.innerText();
    if (/voor deze straat|niets op de agenda/i.test(tekst)) fouten.push(`14 dagen leeg spreekt over de hele straat: "${tekst}"`);
    if (!/Binnen je keuze staat de komende 14 dagen niets gepland\./.test(tekst)) fouten.push(`14 dagen leeg, uitleg: "${tekst}"`);
    const later = blok.getByRole("button", { name: "Toon ook wat later komt" });
    if (await later.count()) {
      await later.click();
      await page.locator(".pv-row", { hasText: "parcours" }).first().waitFor({ timeout: 15000 });
    } else fouten.push("14 dagen leeg: geen knop 'Toon ook wat later komt'");
    assert.deepEqual(fouten, []);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test("tijdlijn bij tekst 200 % en op smalle schermen: dagnaam en dagnummer blijven in hun knop, geen knoppen over elkaar", async (t) => {
    for (const [width, schaal] of [[320, "100%"], [360, "100%"], [390, "100%"], [1280, "100%"], [320, "200%"], [390, "200%"], [1040, "200%"]]) {
      const { page, context } = await openPlace(baseUrl, { width, height: 900, weergave: "tijdlijn" });
      await page.evaluate((s) => { document.documentElement.style.fontSize = s; }, schaal);
      const m = await page.evaluate(() => {
        const knoppen = [...document.querySelectorAll(".pv-tl-dag")];
        const vakken = knoppen.map((b) => b.getBoundingClientRect());
        const fouten = [];
        knoppen.forEach((b, i) => {
          const r = vakken[i];
          for (const s of b.querySelectorAll(".pv-tl-wd, .pv-tl-n")) {
            const v = s.getBoundingClientRect();
            if (v.left < r.left - 0.5 || v.right > r.right + 0.5) fouten.push(`${b.dataset.tlDag} "${s.textContent}" (${Math.round(v.left)}–${Math.round(v.right)}) buiten de knop (${Math.round(r.left)}–${Math.round(r.right)})`);
          }
          for (let j = i + 1; j < vakken.length; j += 1) {
            const a = r, c = vakken[j];
            if (a.left < c.right - 0.5 && c.left < a.right - 0.5 && a.top < c.bottom - 0.5 && c.top < a.bottom - 0.5) fouten.push(`knoppen ${b.dataset.tlDag} en ${knoppen[j].dataset.tlDag} overlappen`);
          }
        });
        // Hoeveel dagen er naast elkaar staan: de langste rij.
        const perRij = new Map();
        for (const r of vakken) perRij.set(Math.round(r.top), (perRij.get(Math.round(r.top)) || 0) + 1);
        return { fouten, kolommen: Math.max(0, ...perRij.values()), scroll: [document.documentElement.scrollWidth, document.documentElement.clientWidth], buiten: vakken.filter((r) => r.left < 0 || r.right > document.documentElement.clientWidth).length };
      });
      t.diagnostic(`${width} px, tekst ${schaal}: ${m.kolommen} dagen naast elkaar`);
      assert.deepEqual(m.fouten, [], `${width} px, tekst ${schaal}`);
      assert.equal(m.buiten, 0, `${width} px, tekst ${schaal}: een dag valt buiten beeld`);
      assert.equal(m.scroll[0], m.scroll[1], `${width} px, tekst ${schaal}: de pagina schuift opzij`);
      // Gewone tekst: op een gsm een week per rij, breed alle 14 dagen naast elkaar.
      if (schaal === "100%" && width >= 360) assert.equal(m.kolommen, width >= 1280 ? 14 : 7, `${width} px`);
      await context.close();
    }
  });

  await t.test("tijdlijn: elke soort een eigen vorm (ook in de legende), en tekens met minstens 3:1 contrast in licht en donker", async () => {
    const meet = (page) => page.evaluate(() => {
      const doek = document.createElement("canvas");
      doek.width = doek.height = 1;
      const ctx = doek.getContext("2d", { willReadFrequently: true });
      const rgb = (kleur) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = "#000"; ctx.fillStyle = kleur; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
      const lum = (c) => { const [r, g, b] = c.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      const vlak = (el) => { for (let e = el.parentElement; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return c; } return "#fff"; };
      const tekens = [...document.querySelectorAll(".pv-tl-stippen > *, .pv-tl .pv-legend-item > :first-child")]
        .map((i) => ({ waar: i.closest(".pv-tl-dag")?.dataset.tlDag || "legende", soort: i.className, contrast: Math.round(contrast(rgb(getComputedStyle(i).backgroundColor), rgb(vlak(i))) * 100) / 100 }));
      const vormen = [...document.querySelectorAll(".pv-tl .pv-legend-item > :first-child")].map((i) => { const s = getComputedStyle(i); return [s.borderRadius, s.clipPath, s.width, s.height].join(" "); });
      return { tekens, vormen };
    });
    const fouten = [];
    for (const colorScheme of ["light", "dark"]) {
      const { page, context } = await openPlace(baseUrl, { weergave: "tijdlijn", colorScheme, extra: losseDagenRijen() });
      await page.locator(".pv-tl-strip").waitFor({ timeout: 15000 });
      let m = await meet(page);
      // Vijf soorten in de legende (zonder vergunningen), vijf verschillende vormen.
      assert.equal(m.vormen.length, 5, m.vormen.join(" | "));
      if (new Set(m.vormen).size !== 5) fouten.push(`${colorScheme}: vormen in de legende: ${m.vormen.join(" | ")}`);
      assert.ok(m.tekens.some((i) => i.waar !== "legende"), "minstens één teken in de strook");
      for (const i of m.tekens) if (i.contrast < 3) fouten.push(`${colorScheme}: teken ${i.soort} op ${i.waar} heeft ${i.contrast}:1`);
      // Een gekozen dag (donker vlak in licht, licht vlak in donker): de tekens blijven zichtbaar.
      await page.click(`[data-tl-dag="${tlDag(8)}"]`);
      m = await meet(page);
      const gekozen = m.tekens.filter((i) => i.waar === tlDag(8));
      assert.ok(gekozen.length, "de gekozen dag heeft een teken");
      for (const i of gekozen) if (i.contrast < 3) fouten.push(`${colorScheme}, gekozen dag: teken ${i.soort} heeft ${i.contrast}:1`);
      await context.close();
    }
    assert.deepEqual(fouten, []);
  });

  await t.test("tijdlijn met het toetsenbord: na uitzetten blijft de focus op die dag; na 'Toon alle 14 dagen' op de gekozen dag, en in beeld", async () => {
    const { page, context, errors } = await openPlace(baseUrl, { weergave: "tijdlijn", height: 640 });
    const d = tlDag(8); // de dag van het parcours
    const focus = () => page.evaluate(() => { const e = document.activeElement, r = e.getBoundingClientRect(); return { d: e.dataset?.tlDag ?? null, ingedrukt: e.getAttribute("aria-pressed"), boven: Math.round(r.top), onder: Math.round(r.bottom), hoogte: innerHeight }; });
    await page.locator(`[data-tl-dag="${d}"]`).focus();
    await page.keyboard.press("Enter");
    assert.deepEqual([(await focus()).d, (await focus()).ingedrukt], [d, "true"]);
    await page.keyboard.press("Enter");
    assert.deepEqual([(await focus()).d, (await focus()).ingedrukt], [d, "false"], "na uitzetten blijft de focus op dezelfde dag");
    // Weer aan, de (lange) parcourskaart open, en dan "Toon alle 14 dagen" onderaan met het toetsenbord.
    await page.keyboard.press("Enter");
    await page.locator(".pv-results .pv-row", { hasText: "parcours" }).first().locator(".pv-row-btn").click();
    await page.locator(".pv-tl-alle").focus();
    await page.keyboard.press("Enter");
    const f = await focus();
    assert.deepEqual([f.d, f.ingedrukt], [d, "false"], "na 'Toon alle 14 dagen' staat de focus op de dag die gekozen was");
    assert.ok(f.boven >= 0 && f.onder <= f.hoogte, `de focus staat buiten beeld (${f.boven}–${f.onder}, scherm ${f.hoogte})`);
    assert.equal(await page.locator(".pv-tl-dag[aria-pressed=\"true\"]").count(), 0);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test("tijdkolom leesbaar: geen tekst die eruit loopt, op gsm en desktop", async () => {
    for (const width of [390, 1280]) {
      const { page, context } = await openPlace(baseUrl, { width, height: 900 });
      const over = await page.$$eval(".pv-row-when", (els) => els.filter((e) => e.scrollWidth > e.clientWidth).map((e) => `${e.textContent} (${e.scrollWidth} > ${e.clientWidth})`));
      assert.ok(await page.locator(".pv-row-when", { hasText: "Uur onbekend" }).count() >= 1, "de parcourskaart toont \"Uur onbekend\"");
      assert.deepEqual(over, [], `breedte ${width}`);
      await context.close();
    }
  });

  await t.test("focusrand zichtbaar op een kaartknop", async () => {
    const { page, context, card } = await openPlace(baseUrl);
    const btn = card.locator(".pv-row-btn");
    await btn.scrollIntoViewIfNeeded();
    const zonder = await card.screenshot();
    await btn.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    assert.equal(await btn.evaluate((b) => document.activeElement === b && b.matches(":focus-visible")), true);
    const met = await card.screenshot();
    // Een rand van 3 px rond de kaart verandert honderden pixels duidelijk; afrondingsruis aan de
    // hoeken (een verschil van 1 of 2 op 255) telt niet mee.
    const anders = await duidelijkAnderePixelsIn(page, zonder, met);
    assert.ok(anders >= 200, `met focus verschillen maar ${anders} pixels duidelijk van zonder focus`);
    await context.close();
  });

  await t.test("zoekveld: één zichtbaar label is de naam, en de voorbeeldtekst past", async () => {
    const { page, context } = await openPlace(baseUrl);
    const veld = await page.evaluate(() => {
      const input = document.querySelector("#agenda-street-jump");
      const cs = getComputedStyle(input);
      const ctx = document.createElement("canvas").getContext("2d");
      ctx.font = `500 ${cs.fontSize} ${cs.fontFamily}`;
      return { labels: [...input.labels].map((l) => l.textContent.trim()), aria: input.getAttribute("aria-label"), breed: ctx.measureText(input.placeholder).width, ruimte: input.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) };
    });
    assert.deepEqual(veld.labels, ["Zoek je straat, wijk of postcode"]);
    assert.equal(veld.aria, null);
    assert.equal(await page.getByRole("combobox", { name: "Zoek je straat, wijk of postcode", exact: true }).count(), 1);
    assert.ok(veld.breed <= veld.ruimte, `voorbeeldtekst ${Math.round(veld.breed)}px in ${Math.round(veld.ruimte)}px`);
    await context.close();
  });

  await t.test("straatnaam, actieknop, kaartregio en volgorde op gsm", async () => {
    const { page, context } = await openPlace(baseUrl);
    assert.deepEqual(await page.evaluate(brokenWordsIn, ".pv-place-name"), [], "straatnaam breekt niet midden in een woord");
    // "Alle onderwerpen verbergen" is een actie, geen aan/uit-knop.
    assert.equal(await page.locator('[data-group="*"]').getAttribute("aria-pressed"), null);
    // De kaart is geen aside binnen een section (axe: landmark-complementary-is-top-level).
    assert.equal(await page.locator("section aside, section [role=complementary]").count(), 0);
    assert.equal(await page.locator('.pv-aside[role="region"][aria-label="Kaart"]').count(), 1);
    // Op gsm eerst de lijst, dan de kaart.
    assert.ok(Number(await page.locator(".pv-aside").evaluate((a) => getComputedStyle(a).order)) >= 0);
    await context.close();
  });

  await t.test("focus op de kop raakt de regel eronder niet", async () => {
    const { page, context } = await openPlace(baseUrl);
    const input = page.locator("#agenda-street-jump");
    await input.fill("2060");
    await input.press("Enter");
    await page.waitForFunction(() => document.activeElement?.id === "pv-title");
    const kop = await page.evaluate(() => {
      const h = document.querySelector("#pv-title"), sub = document.querySelector(".pv-sub"), cs = getComputedStyle(h);
      return { onder: h.getBoundingClientRect().bottom + parseFloat(cs.outlineOffset) + parseFloat(cs.outlineWidth), sub: sub.getBoundingClientRect().top, fv: h.matches(":focus-visible") };
    });
    assert.ok(kop.onder < kop.sub, `focusrand tot ${kop.onder}, regel eronder op ${kop.sub}`);
    await context.close();
  });

  // Hertest, restpunt 6: na het kiezen van een suggestie krijgt de kop de focus (voor schermlezers), maar
  // zonder kader rond "Alles op deze plek". Een knop die je daarna met Tab bereikt, toont de focus wel.
  await t.test("na het kiezen van een suggestie: focus op de kop, zonder kader", async () => {
    const { page, context } = await openPlace(baseUrl);
    const input = page.locator("#agenda-street-jump");
    await input.fill("2060");
    await input.press("Enter");
    await page.waitForFunction(() => document.activeElement?.id === "pv-title");
    const kop = await page.evaluate(() => { const cs = getComputedStyle(document.querySelector("#pv-title")); return { stijl: cs.outlineStyle, breedte: parseFloat(cs.outlineWidth) }; });
    assert.ok(kop.stijl === "none" || kop.breedte === 0, `kader rond de kop: ${kop.stijl} ${kop.breedte}px`);
    await page.keyboard.press("Tab");
    const volgende = await page.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); return { id: e.id, fv: e.matches(":focus-visible"), stijl: cs.outlineStyle, breedte: parseFloat(cs.outlineWidth) }; });
    assert.notEqual(volgende.id, "pv-title");
    assert.ok(volgende.fv && volgende.stijl !== "none" && volgende.breedte >= 2, `focus na Tab: ${JSON.stringify(volgende)}`);
    await context.close();
  });

  // Licht en donker: de weekzin met zijn verkeerslicht moet in beide genoeg contrast hebben.
  for (const colorScheme of ["light", "dark"]) await t.test(`axe (${colorScheme}): geen overtredingen op de plek met een open kaart`, { skip: axePath ? false : "zet AXE_CORE_PATH naar axe.min.js" }, async () => {
    const { page, context, card } = await openPlace(baseUrl, { colorScheme });
    await card.locator(".pv-row-btn").click();
    await page.locator(".pv-dezeweek").waitFor();
    await page.addScriptTag({ path: axePath });
    const violations = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`));
    assert.deepEqual(violations, []);
    await context.close();
  });
});
