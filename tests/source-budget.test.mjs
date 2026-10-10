// Tijdsbudget per bron: één hangende of trage bron mag `npm run refresh` niet meer over de jobgrens
// van 20 minuten duwen. Ze valt in haar gewone foutpad (vorige data blijft, fetchStatus "error",
// errorCode "source_timeout"); de andere bronnen gaan door. Plus de eBesluit-zoekronde die daarvoor
// de oorzaak was: duizenden detailpagina's voor treffers die nooit konden meetellen.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { EBESLUIT_MAX_PAGES, EBESLUIT_PAGE_SIZE, discoverCivicDecisions, needsDetail, resultCountFromSearch, rowsFromSearch, searchKeyword } from "../lib/ebesluit-discovery.mjs";
import { FetchError, SOURCE_TIMEOUT_CODE, deadlineFetch, fetchWithTimeout, keepPreviousOnError, readSourceDocument, statusEntry } from "../lib/fetch-util.mjs";
import { REFRESH_BUDGET_CODE, refreshAll } from "../scripts/refresh-fetch.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOW = new Date("2026-10-02T04:00:00Z");
const never = () => new Promise(() => {});
const resp = (text, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) });

function makeRoot(t, sourceIds) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "source-budget-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "site", "sources"), { recursive: true });
  for (const id of sourceIds) fs.copyFileSync(path.join(repoRoot, "site", "sources", `${id}.json`), path.join(root, "site", "sources", `${id}.json`));
  return root;
}

const fetcher = (name, run, extra = {}) => ({ name, sourceIds: [name], load: async () => ({ run }), ...extra });
const okRun = (sourceId) => async ({ rootDir }) => {
  const previous = readSourceDocument(rootDir, sourceId);
  return [statusEntry(sourceId, { fetchStatus: "ok", retrievedAt: NOW.toISOString(), itemCount: previous?.items?.length ?? 0 })];
};

test("deadlineFetch: hangend verzoek en hangende body worden source_timeout, daarna faalt alles meteen", async () => {
  const controller = new AbortController();
  const guarded = deadlineFetch(async (url) => (String(url).includes("hang") ? never() : { ok: true, status: 200, text: never }), controller.signal);
  const response = await guarded("https://voorbeeld.test/ok");
  const pendingRequest = guarded("https://voorbeeld.test/hang");
  const pendingBody = response.text();
  controller.abort();
  await assert.rejects(pendingRequest, (error) => error instanceof FetchError && error.code === SOURCE_TIMEOUT_CODE);
  await assert.rejects(pendingBody, (error) => error.code === SOURCE_TIMEOUT_CODE);
  let calls = 0;
  const after = deadlineFetch(async () => { calls += 1; return resp("x"); }, controller.signal);
  await assert.rejects(after("https://voorbeeld.test/later"), (error) => error.code === SOURCE_TIMEOUT_CODE);
  assert.equal(calls, 0, "na het budget gaat er geen verzoek meer de deur uit");
});

test("deadlineFetch: binnen het budget verandert er niets, ook niet aan gewone fouten en de eigen timeout", async () => {
  const controller = new AbortController();
  const guarded = deadlineFetch(async (url, options) => {
    assert.ok(options.signal instanceof AbortSignal, "het budgetsignaal gaat mee naar fetch");
    if (String(url).endsWith("/kapot")) throw new TypeError("fetch failed");
    return resp('{"a":1}');
  }, controller.signal);
  assert.deepEqual(await (await guarded("https://voorbeeld.test/")).json(), { a: 1 });
  await assert.rejects(guarded("https://voorbeeld.test/kapot"), TypeError);
  // fetchWithTimeout houdt zijn eigen code "timeout" voor één traag verzoek.
  const slow = deadlineFetch((url, options) => new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted")))), controller.signal);
  await assert.rejects(fetchWithTimeout(slow, "https://voorbeeld.test/traag", {}, 10), (error) => error.code === "timeout");
});

test("refreshAll: een hangende bron krijgt source_timeout met haar vorige data, de volgende bron loopt gewoon", async (t) => {
  const root = makeRoot(t, ["district-ebesluit", "district-kalender"]);
  const before = fs.readFileSync(path.join(root, "site", "sources", "district-ebesluit.json"), "utf8");
  const logs = [];
  const status = await refreshAll({
    rootDir: root,
    clock: () => NOW,
    log: (line) => logs.push(line),
    sourceBudgetMs: 30,
    graceMs: 20,
    fetchers: [
      fetcher("district-ebesluit", async () => never()), // hangt zonder ooit fetch te gebruiken
      fetcher("district-kalender", okRun("district-kalender")),
    ],
  });
  const byId = Object.fromEntries(status.sources.map((entry) => [entry.sourceId, entry]));
  assert.equal(byId["district-ebesluit"].fetchStatus, "error");
  assert.equal(byId["district-ebesluit"].errorCode, SOURCE_TIMEOUT_CODE);
  assert.equal(byId["district-kalender"].fetchStatus, "ok");
  assert.equal(fs.readFileSync(path.join(root, "site", "sources", "district-ebesluit.json"), "utf8"), before, "vorige data blijft onaangeroerd");
  assert.ok(logs.some((line) => line.includes('"errorCode":"source_timeout"')));
});

test("refreshAll: een bron die na haar budget via het eigen foutpad eindigt, houdt vorige data en heet source_timeout", async (t) => {
  const root = makeRoot(t, ["district-kalender"]);
  const previous = readSourceDocument(root, "district-kalender");
  const status = await refreshAll({
    rootDir: root,
    clock: () => NOW,
    log: () => {},
    sourceBudgetMs: 30,
    graceMs: 5_000,
    fetchers: [
      fetcher("district-kalender", async ({ fetch, rootDir }) => {
        try {
          await fetchWithTimeout(fetch, "https://www.antwerpen.be/hangt", {}, 60_000);
          throw new Error("mag niet slagen");
        } catch (error) {
          assert.equal(error.code, SOURCE_TIMEOUT_CODE);
          return [keepPreviousOnError(rootDir, "district-kalender", previous, error.code)];
        }
      }),
    ],
    fetch: never,
  });
  const entry = status.sources[0];
  assert.equal(entry.fetchStatus, "error");
  assert.equal(entry.errorCode, SOURCE_TIMEOUT_CODE);
  assert.equal(entry.itemCount, previous.items.length);
  assert.equal(entry.retrievedAt, previous.retrievedAt);
  assert.deepEqual(readSourceDocument(root, "district-kalender").items, previous.items);
});

test("refreshAll: is het totaalbudget op, dan worden latere bronnen niet meer gestart en houden ze hun data", async (context) => {
  const root = makeRoot(context, ["district-kalender", "district-nieuws"]);
  let t = 0;
  let loaded = 0;
  const status = await refreshAll({
    rootDir: root,
    clock: () => NOW,
    log: () => {},
    refreshBudgetMs: 1_000,
    now: () => t,
    fetchers: [
      fetcher("district-kalender", async (args) => { t += 1_000; return okRun("district-kalender")(args); }),
      { name: "district-nieuws", sourceIds: ["district-nieuws"], load: async () => { loaded += 1; return { run: okRun("district-nieuws") }; } },
    ],
  });
  const byId = Object.fromEntries(status.sources.map((entry) => [entry.sourceId, entry]));
  assert.equal(byId["district-kalender"].fetchStatus, "ok");
  assert.equal(byId["district-nieuws"].fetchStatus, "error");
  assert.equal(byId["district-nieuws"].errorCode, REFRESH_BUDGET_CODE);
  assert.equal(byId["district-nieuws"].itemCount, readSourceDocument(root, "district-nieuws").items.length);
  assert.equal(loaded, 0);
});

test("refreshAll: een eigen budget per fetcher gaat voor het standaardbudget", async (t) => {
  const root = makeRoot(t, ["district-kalender"]);
  const status = await refreshAll({
    rootDir: root,
    clock: () => NOW,
    log: () => {},
    sourceBudgetMs: 10,
    graceMs: 10,
    fetchers: [fetcher("district-kalender", async (args) => { await new Promise((resolve) => setTimeout(resolve, 40)); return okRun("district-kalender")(args); }, { budgetMs: 2_000 })],
  });
  assert.equal(status.sources[0].fetchStatus, "ok");
});

// ---------- eBesluit ----------
const searchRow = (id, meetingId, title, organ = "districtscollege Antwerpen") =>
  `<a href="#" class="result-row" data-type="MEETING_ITEM" data-id="${id}" data-meeting-id="${meetingId}" data-content-published="true">
     <p class="title">${title}</p>
     <p class="metadata"><span class="date" hidden="hidden"></span><span class="date">28/07/2026 13:00</span><span class="organ">${organ}</span></p>
   </a>`;

test("eBesluit-zoekrij levert titel, orgaan en het totaal aantal treffers", () => {
  const html = `<span class="result-count">10.721 resultaten gevonden</span>${searchRow("a1", "m1", "2026_DCBE_00141 - Markten - Wekelijkse openbare markt &amp; braderie - Goedkeuring", "districtscollege Berchem")}`;
  assert.equal(resultCountFromSearch(html), 10721);
  assert.equal(resultCountFromSearch("<p>geen teller</p>"), null);
  assert.deepEqual(rowsFromSearch(html), [{ id: "a1", meetingId: "m1", published: true, title: "2026_DCBE_00141 - Markten - Wekelijkse openbare markt & braderie - Goedkeuring", organ: "districtscollege Berchem" }]);
});

test("needsDetail: alleen overslaan wat de detailronde zeker zou laten vallen", () => {
  const row = (title, organ = "districtscollege Antwerpen") => ({ id: "x", meetingId: "m", published: true, title, organ });
  assert.equal(needsDetail(row("2026_DCAN_00044 - Markten - Openbare markten op feestdagen 2026 - Goedkeuring")), true);
  assert.equal(needsDetail(row("2026_CBS_01367 - Kermissen - Augustusfoor Steenplein 2026 - Goedkeuring", "college van burgemeester en schepenen")), true);
  assert.equal(needsDetail(row("2026_CBS_02031 - Aanvragen speelstraten paasvakantie 2026 - Goedkeuring", "college van burgemeester en schepenen")), true);
  assert.equal(needsDetail(row("2026_DRAN_00007 - Speelstraten - Delegatie - Goedkeuring", "districtsraad Antwerpen")), true);
  assert.equal(needsDetail(row("2026_DCAN_00100 - Marktonderzoek communicatie - Kennisname")), false, "titel valt onder other");
  assert.equal(needsDetail(row("2026_DCDE_00044 - Markten - Openbare markten in Deurne op feestdagen 2026 - Goedkeuring", "districtscollege Deurne")), false, "ander district");
  assert.equal(needsDetail(row("2026_DCDE_00045 - District Antwerpen - Markten op feestdagen - Goedkeuring", "districtscollege Deurne")), true, "titel noemt District Antwerpen");
  assert.equal(needsDetail({ id: "x", meetingId: "m", published: true, title: null, organ: null }), true, "andere opmaak: altijd de detailpagina");
  assert.equal(needsDetail({ id: "x", meetingId: "m", published: true }), true);
});

test("eBesluit haalt geen detailpagina's op voor treffers die nooit kunnen meetellen", async () => {
  const fair = "Besluit 2026_DCAN_00001 - District Antwerpen - Kermissen 2026 - Goedkeuring districtscollege Antwerpen Het districtscollege antwerpen beslist: Artikel 1 Dageraadplaats - Najaarsfoor: 3 oktober 2026 tot en met 18 oktober 2026; Artikel 2 Einde.";
  const rows = [
    searchRow("fair", "m1", "2026_DCAN_00001 - District Antwerpen - Kermissen 2026 - Goedkeuring"),
    ...Array.from({ length: 30 }, (_, i) => searchRow(`ruis-${i}`, `mr-${i}`, `2026_CBS_0${1000 + i} - Marktconsultatie stadsdiensten - Goedkeuring`, "college van burgemeester en schepenen")),
    ...Array.from({ length: 10 }, (_, i) => searchRow(`deurne-${i}`, `md-${i}`, `2026_DCDE_0${100 + i} - Markten - Openbare markten op feestdagen - Goedkeuring`, "districtscollege Deurne")),
  ].join("");
  const details = [];
  const fetchImpl = async (url) => {
    const u = new URL(String(url));
    if (u.pathname === "/zoeken") return resp(rows);
    details.push(u.pathname);
    return u.pathname.endsWith("/fair") ? resp(fair) : resp("", 404);
  };
  const result = await discoverCivicDecisions({ fetch: fetchImpl, year: 2026, retryDelayMs: 0, sleepImpl: async () => {} });
  assert.equal(result.complete, true);
  assert.deepEqual(details, ["/zittingen/m1/agendapunten/fair"]);
  assert.equal(result.detailPages, 1);
  assert.equal(result.skippedByTitle, 40);
  assert.equal(result.calendarItems.length, 1);
});

test("eBesluit splitst meteen als de teller meer treffers meldt dan een venster kan doorlopen", async () => {
  const cap = EBESLUIT_MAX_PAGES * EBESLUIT_PAGE_SIZE;
  const requests = [];
  const fetchImpl = async (url) => {
    const u = new URL(String(url));
    const start = u.searchParams.get("meetingDateStart");
    const end = u.searchParams.get("meetingDateEnd");
    requests.push(`${start}|${end}|${u.searchParams.get("page")}`);
    if (start === "2026-01-01" && end === "2026-12-31") return resp(`<span class="result-count">${cap + 1} resultaten gevonden</span>${searchRow("jaar", "mj", "x")}`);
    return resp(`<span class="result-count">1 resultaten gevonden</span>${searchRow(`q-${start}`, `mq-${start}`, "2026_DCAN_1 - Markten op feestdagen - Goedkeuring")}`);
  };
  const result = await searchKeyword(fetchImpl, "markt", 2026, { retryDelayMs: 0, sleepImpl: async () => {} });
  assert.equal(result.coverage.complete, true);
  assert.equal(result.rows.length, 4);
  assert.equal(requests.filter((entry) => entry.startsWith("2026-01-01|2026-12-31")).length, 1, "het jaarvenster kost precies één pagina");
  assert.equal(requests.length, 5);
});
