// Krimpgrens: een bron die wel antwoordt maar (bijna) niets meer oplevert, mag nooit bestaande data
// wissen of een lege agenda publiceren. Nagebootst met de vastgelegde districtspagina en een nep-fetch.
// Het vertrekpunt is vaste, verzonnen testdata (tests/fixtures/source-shrink/), niet de live brondata
// in site/sources/: die verandert bij elke verversing, en een gewone schommeling (13 -> 12 items op
// 2 oktober 2026) mocht de dataverversing niet meer rood maken.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readSourceDocument, suspiciousDrop, upcomingCount } from "../lib/fetch-util.mjs";
import { DISTRICT_API_URL } from "../scripts/fetch-sources-district.mjs";
import { DISTRICT_NEWS_URL } from "../scripts/fetch-sources-district-news.mjs";
import { refreshAll } from "../scripts/refresh-fetch.mjs";
import { checkHealth } from "../scripts/sources-health.mjs";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "source-shrink");
const fixturePage = JSON.parse(fs.readFileSync(new URL("./fixtures/district-page-content-by-uuid-5efb0477.json", import.meta.url), "utf8"));
const NOW = new Date("2026-09-28T06:00:00Z");
const clock = () => NOW;
const NEW_MARKUP = "<p><strong>Nieuwe opmaak</strong><br>binnenkort meer</p>";

// De pagina na een opmaakwijziging: dezelfde blokken, maar geen enkele datumregel meer.
function changedPage() {
  const page = structuredClone(fixturePage);
  page.updatedAt = "2026-09-28T05:00:00+00:00";
  page.currentVersion = "ffffffffffffffffffffffff";
  for (const snippet of page.snippets) if (snippet?.body && typeof snippet.body.text === "string") snippet.body.text = NEW_MARKUP;
  return page;
}

function json(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) };
}

function routes({ page = fixturePage, news = { data: [] } } = {}) {
  return async (url) => {
    const target = String(url);
    if (target === DISTRICT_API_URL) return json(page);
    if (target === DISTRICT_NEWS_URL) return json(news);
    return json({ error: "not found" }, 404); // mail-signalen: nog niet uitgerold
  };
}

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "source-shrink-"));
  fs.mkdirSync(path.join(root, "site", "sources"), { recursive: true });
  // Vertrekpunt: vaste testdata. Kalender: 6 items, waarvan 1 voorbij en 1 lopend (5 komend op 28/09).
  // Nieuws: 2 komende items.
  for (const name of ["district-kalender.json", "district-nieuws.json"]) {
    fs.copyFileSync(path.join(fixtureDir, name), path.join(root, "site", "sources", name));
  }
  return root;
}

const read = (root, sourceId) => JSON.parse(fs.readFileSync(path.join(root, "site", "sources", `${sourceId}.json`), "utf8"));
const quiet = () => {};
// De districtskanalen pauzeren 3 s tussen verzoeken; in een toets hoeft dat niet.
const noSleep = async () => {};

test("suspiciousDrop: 0 na >0, of meer dan de helft minder vanaf 4; voorbije items tellen niet", () => {
  const item = (date, endDate = null) => ({ date, endDate });
  const today = "2026-09-28";
  const four = [item("2026-10-01"), item("2026-10-02"), item("2026-10-03"), item("2026-10-04")];
  assert.deepEqual(suspiciousDrop(four, [], today), { before: 4, after: 0 });
  assert.deepEqual(suspiciousDrop([item("2026-10-01")], [], today), { before: 1, after: 0 });
  assert.deepEqual(suspiciousDrop(four, [item("2026-10-01")], today), { before: 4, after: 1 });
  assert.equal(suspiciousDrop(four, four.slice(0, 2), today), null, "precies de helft is nog geen krimp");
  assert.equal(suspiciousDrop([item("2026-10-01"), item("2026-10-02"), item("2026-10-03")], [item("2026-10-01")], today), null, "onder 4 alleen de nulregel");
  assert.equal(suspiciousDrop([item("2026-09-01"), item("2026-09-20", "2026-09-27")], [], today), null, "alles al voorbij: geen krimp");
  assert.equal(suspiciousDrop([item("2026-09-01", "2026-10-05")], [], today)?.before, 1, "een lopend item telt mee");
});

test("vertrekpunt: vaste testdata, geldig en met komende items", () => {
  const root = makeRoot();
  // readSourceDocument geeft null bij een ongeldig document; dan zou de krimpgrens stil niets vergelijken.
  const kalender = readSourceDocument(root, "district-kalender");
  const nieuws = readSourceDocument(root, "district-nieuws");
  assert.ok(kalender && nieuws, "beide fixtures zijn geldige brondocumenten");
  assert.equal(kalender.items.length, 6);
  assert.equal(upcomingCount(kalender.items, "2026-09-28"), 5, "boven de drempel van 4: ook de halveringsregel geldt");
  assert.equal(upcomingCount(nieuws.items, "2026-09-28"), 2);
  assert.equal(upcomingCount(kalender.items, "2027-01-15"), 0, "alles voorbij op de latere klok");
});

test("gewijzigde districtspagina en leeg nieuwskanaal: error, vorige data blijft, health faalt", async () => {
  const root = makeRoot();
  const kalenderBefore = read(root, "district-kalender");
  const nieuwsBefore = read(root, "district-nieuws");
  assert.deepEqual([kalenderBefore.items.length, nieuwsBefore.items.length], [6, 2], "vertrekpunt heeft data");

  const logs = [];
  const status = await refreshAll({ rootDir: root, clock, env: {}, sleep: noSleep, fetch: routes({ page: changedPage(), news: { data: [] } }), log: (line) => logs.push(line) });
  const bySource = Object.fromEntries(status.sources.map((entry) => [entry.sourceId, entry]));
  assert.deepEqual([bySource["district-kalender"].fetchStatus, bySource["district-kalender"].errorCode], ["error", "suspicious_drop"]);
  assert.deepEqual([bySource["district-nieuws"].fetchStatus, bySource["district-nieuws"].errorCode], ["error", "no_articles"]);
  assert.equal(bySource["district-kalender"].itemCount, kalenderBefore.items.length);

  const kalenderAfter = read(root, "district-kalender");
  assert.equal(kalenderAfter.fetchStatus, "error");
  assert.deepEqual(kalenderAfter.items, kalenderBefore.items, "geen enkel item gewist");
  assert.equal(kalenderAfter.retrievedAt, kalenderBefore.retrievedAt, "het ophaalmoment blijft dat van de laatste goede data");
  assert.deepEqual(read(root, "district-nieuws").items, nieuwsBefore.items);
  assert.match(logs.join("\n"), /"errorCode":"suspicious_drop"/);

  const health = checkHealth({ rootDir: root, at: Date.parse("2026-09-28T07:00:00Z"), env: {} });
  assert.equal(health.exitCode, 1);
  assert.match(health.lines.join("\n"), /district-kalender\terror\terror\t.*errorCode=suspicious_drop/);
});

test("nieuwskanaal met artikels maar zonder één bruikbare datum: suspicious_drop", async () => {
  const root = makeRoot();
  const nieuwsBefore = read(root, "district-nieuws");
  const article = {
    id: "0123456789abcdef01234567",
    slug: "iets-zonder-datum",
    title: "Iets zonder datum",
    publishedAt: "2026-09-27T08:00:00+00:00",
    publishUntil: "2026-12-01T22:00:00+00:00",
    snippets: [{ type: "wysiwyg", body: { text: NEW_MARKUP } }],
  };
  const status = await refreshAll({ rootDir: root, clock, env: {}, sleep: noSleep, fetch: routes({ news: { data: [article] } }), log: quiet });
  const entry = status.sources.find((candidate) => candidate.sourceId === "district-nieuws");
  assert.deepEqual([entry.fetchStatus, entry.errorCode], ["error", "suspicious_drop"]);
  assert.deepEqual(read(root, "district-nieuws").items, nieuwsBefore.items);
  // De ongewijzigde districtspagina blijft gewoon "ok": de parser haalt er genoeg komende items uit
  // om niet als krimp te tellen. Een kapotte parser (0 of te weinig items) valt hier op.
  const kalender = status.sources.find((candidate) => candidate.sourceId === "district-kalender");
  assert.deepEqual([kalender.fetchStatus, kalender.errorCode], ["ok", null]);
  assert.ok(kalender.itemCount > 0);
});

test("AGENDA_ALLOW_DROP laat een bewuste daling door; voorbije items tellen nooit als krimp", async () => {
  const allowed = makeRoot();
  const status = await refreshAll({ rootDir: allowed, clock, sleep: noSleep, env: { AGENDA_ALLOW_DROP: "district-kalender" }, fetch: routes({ page: changedPage(), news: { data: [] } }), log: quiet });
  const entry = status.sources.find((candidate) => candidate.sourceId === "district-kalender");
  assert.deepEqual([entry.fetchStatus, entry.itemCount], ["ok", 0]);

  // Drie maanden later is alles van nu voorbij: een lege pagina is dan geen storing.
  const later = makeRoot();
  const laterClock = () => new Date("2027-01-15T06:00:00Z");
  const laterStatus = await refreshAll({ rootDir: later, clock: laterClock, env: {}, sleep: noSleep, fetch: routes({ page: changedPage() }), log: quiet });
  assert.equal(laterStatus.sources.find((candidate) => candidate.sourceId === "district-kalender").fetchStatus, "ok");
});

test("sources:health vergelijkt met de vastgelegde versie: ook zonder grendel in de fetcher faalt een lege agenda", () => {
  const root = makeRoot();
  const committed = { "district-kalender": read(root, "district-kalender"), "district-nieuws": read(root, "district-nieuws") };
  // Een fetcher die zich vergist en toch "ok" met 0 items wegschrijft.
  const emptied = { ...committed["district-kalender"], items: [], retrievedAt: "2026-09-28T06:00:00.000Z" };
  fs.writeFileSync(path.join(root, "site", "sources", "district-kalender.json"), `${JSON.stringify(emptied, null, 2)}\n`);
  const status = {
    schemaVersion: 1,
    generatedAt: "2026-09-28T06:00:00.000Z",
    classificationAsOf: "2026-09-28",
    sources: ["district-kalender", "district-nieuws"].map((sourceId) => ({
      sourceId,
      file: `sources/${sourceId}.json`,
      scope: "district",
      fetchStatus: "ok",
      retrievedAt: "2026-09-28T06:00:00.000Z",
      maxAgeHours: 48,
      itemCount: sourceId === "district-kalender" ? 0 : committed[sourceId].items.length,
      errorCode: null,
    })),
  };
  fs.writeFileSync(path.join(root, "site", "sources", "refresh-status.json"), `${JSON.stringify(status, null, 2)}\n`);
  const baseline = (sourceId) => committed[sourceId] ?? null;
  const at = Date.parse("2026-09-29T06:00:00Z");

  const withoutBaseline = checkHealth({ rootDir: root, at, env: {} });
  assert.equal(withoutBaseline.exitCode, 0, "zonder vergelijking zag niets de daling (de bevinding)");

  const result = checkHealth({ rootDir: root, at, env: {}, baseline, baselineLabel: "HEAD" });
  assert.equal(result.exitCode, 1);
  assert.match(result.lines.join("\n"), /district-kalender\tdrop\tkomend 5 -> 0 t\.o\.v\. HEAD/);

  const allowed = checkHealth({ rootDir: root, at, env: { AGENDA_ALLOW_DROP: "district-kalender" }, baseline, baselineLabel: "HEAD" });
  assert.equal(allowed.exitCode, 0);
  assert.match(allowed.lines.join("\n"), /district-kalender\tdrop-allowed/);
});
