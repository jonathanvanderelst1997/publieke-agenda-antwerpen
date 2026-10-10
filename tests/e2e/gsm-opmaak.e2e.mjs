// End-to-end: opmaak op een gsm (390 × 844) en toegankelijkheid van de plekweergave, in Chromium.
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
function parcoursRijen() {
  const dag = addDays(today, 8);
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

async function routeSources(page) {
  const [x1, y1, x2, y2] = row[4];
  const axis = { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: [[x1, y1], [x2, y2]] }, properties: { LSTRNMID: Number(STRAAT.id), LSTRNM: STRAAT.name, RSTRNMID: Number(STRAAT.id), RSTRNM: STRAAT.name, postcode: Number(STRAAT.postcode), DISTRICT: "Antwerpen" } }] };
  const json = (body) => ({ status: 200, contentType: "application/json", body: typeof body === "string" ? body : JSON.stringify(body) });
  await page.route((url) => !/^http:\/\/127\.0\.0\.1/.test(url.href), (route) => {
    const url = route.request().url();
    if (url.includes("/collections/")) return route.fulfill(json({ type: "FeatureCollection", features: [], links: [] }));
    if (url.includes("/MapServer/109/")) return route.fulfill(json(district));
    if (url.includes("/MapServer/905/")) return route.fulfill(json(axis));
    if (url.includes("geodata.antwerpen.be")) return route.fulfill(json(url.includes("returnIdsOnly") ? { objectIds: [] } : { features: [] }));
    return route.abort();
  });
}

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

async function openPlace(baseUrl, { width = 390, height = 844 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 500, hasTouch: width < 500, locale: "nl-BE", timezoneId: "Europe/Brussels" });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(`${today}T10:00:00+02:00`));
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await routeSources(page);
  await page.goto(`${baseUrl}/?plek=${encodeURIComponent(STRAAT.name)}&periode=alles`);
  await page.waitForSelector(".pv-place-name");
  // Eerst de (lege) live laag laten landen, dan het parcours inschuiven zoals de laag het zelf doet.
  await page.waitForFunction(() => Array.isArray(window.PUBLIC_AGENDA_LIVE_STREETS?.publicSpace), null, { timeout: 15000 });
  await page.evaluate((rows) => {
    window.PUBLIC_AGENDA_LIVE_STREETS.publicSpace = rows;
    window.dispatchEvent(new CustomEvent("public-agenda:street-layer", { detail: { name: "publicSpace", items: rows } }));
  }, parcoursRijen());
  const card = page.locator(".pv-row", { hasText: "parcours" }).first();
  await card.waitFor({ timeout: 15000 });
  return { page, context, errors, card };
}

test("opmaak op gsm en toegankelijkheid", { skip }, async (t) => {
  const server = await serve();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await browser.close(); });

  await t.test("open parcourskaart op 390 px: labels boven de waarden, geen woordbreuk, lager dan 1.500 px", async (t) => {
    const { page, context, errors, card } = await openPlace(baseUrl);
    await card.locator(".pv-row-btn").click();
    assert.equal(await card.locator(".pv-row-btn").getAttribute("aria-expanded"), "true");
    const meting = await card.evaluate((li) => {
      const detail = li.querySelector(".pv-detail").getBoundingClientRect();
      const paren = [...li.querySelectorAll(".pv-detail dl > div")].filter((d) => d.querySelector("dt")?.getClientRects().length).map((d) => {
        const dt = d.querySelector("dt").getBoundingClientRect(), dd = d.querySelector("dd").getBoundingClientRect();
        return { label: d.querySelector("dt").textContent, ddLinks: Math.round(dd.left - dt.left), ddOnder: dd.top >= dt.bottom - 1, ddBreed: Math.round(dd.width) };
      });
      return { hoogte: Math.round(li.getBoundingClientRect().height), detailBreed: Math.round(detail.width), paren };
    });
    t.diagnostic(`open parcourskaart: ${meting.hoogte}px hoog, detail ${meting.detailBreed}px breed`);
    assert.ok(meting.paren.length >= 4, `regels: ${JSON.stringify(meting.paren)}`);
    for (const p of meting.paren) {
      assert.ok(p.ddOnder && Math.abs(p.ddLinks) <= 1, `"${p.label}": waarde staat niet onder het label (${JSON.stringify(p)})`);
      assert.ok(p.ddBreed >= meting.detailBreed - 2, `"${p.label}": waardekolom ${p.ddBreed}px van ${meting.detailBreed}px`);
    }
    assert.deepEqual(await page.evaluate(brokenWordsIn, ".pv-place, .pv-row.open"), [], "geen woord breekt midden in");
    assert.ok(meting.hoogte < 1500, `open parcourskaart is ${meting.hoogte}px hoog`);
    // Wat over de bron gaat, staat ingeklapt en is met één tik te openen.
    const bron = card.locator("details.pv-bron-dossier");
    assert.equal(await bron.count(), 1);
    assert.equal(await bron.evaluate((d) => d.open), false);
    assert.match(await bron.textContent(), /Waarom in deze agenda\?/);
    assert.match(await bron.textContent(), new RegExp(`Dossier ${DOSSIER}`));
    await bron.locator("summary").click();
    assert.equal(await bron.evaluate((d) => d.open), true);
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

  await t.test("axe: geen overtredingen op de plek met een open kaart", { skip: axePath ? false : "zet AXE_CORE_PATH naar axe.min.js" }, async () => {
    const { page, context, card } = await openPlace(baseUrl);
    await card.locator(".pv-row-btn").click();
    await page.addScriptTag({ path: axePath });
    const violations = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`));
    assert.deepEqual(violations, []);
    await context.close();
  });
});
