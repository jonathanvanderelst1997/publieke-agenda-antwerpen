// eBesluit faalt sinds 12/13 oktober 2026 elke nacht met HTTP 500 (#180, #186). Twee dingen, getoetst zonder netwerk
// (alleen een fetch-nep met verzonnen besluiten, geen persoonsgegevens):
//   1. de reden van een fout staat in het bronbestand: lastError { code, at } en lastSuccessAt
//      (keepPreviousOnError in lib/fetch-util.mjs), de vorige, geverifieerde items blijven; intern, niet in de feed;
//   2. een zoekpagina van 500 rijen die na de herkansing een 5xx blijft geven, wordt opnieuw geprobeerd met 100 en
//      dan 50 rijen (lib/ebesluit-discovery.mjs). Pas als ook dat faalt, is het venster onvolledig; een
//      onvolledige zoekronde wordt nooit als volledig aanvaard (fail-closed, #186).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { EBESLUIT_FALLBACK_PAGE_SIZES, EBESLUIT_KEYWORDS, EBESLUIT_PAGE_SIZE, searchKeyword } from "../lib/ebesluit-discovery.mjs";
import { keepPreviousOnError, readSourceDocument, statusEntry } from "../lib/fetch-util.mjs";
import { sourceDocument, validateSourceDocument } from "../lib/source-feed.mjs";
import { buildFeed } from "../scripts/build-sources.mjs";
import { SOURCE_ID, run } from "../scripts/fetch-sources-ebesluit.mjs";

const NOW = new Date("2026-09-28T06:00:00Z");
const noSleep = async () => {};
const resp = (text, status = 200) => new Response(text, { status, headers: { "content-type": "text/html; charset=utf-8" } });

// Verzonnen besluiten in de opmaak van eBesluit (zoals tests/ebesluit-suppression.test.mjs): een foor en een
// feestdagregeling voor markten.
const zoekRij = (id, vergadering) => `<a class="result-row" data-id="${id}" data-meeting-id="${vergadering}" data-content-published="true"></a>`;
const ZOEKPAGINA = [zoekRij("foor", "m1"), zoekRij("markt", "m2")].join("");
const DETAILS = {
  foor: "Besluit 2026_DCAN_00001 - District Antwerpen - Kermissen 2026 - Goedkeuring districtscollege Antwerpen Het districtscollege antwerpen beslist: Artikel 1 Dageraadplaats - Najaarsfoor: 3 oktober 2026 tot en met 18 oktober 2026; Artikel 2 Einde.",
  markt: "Besluit 2026_DCAN_00002 - District Antwerpen - Openbare markten feestdagen 2026 - Goedkeuring districtscollege Antwerpen Het districtscollege antwerpen beslist: Artikel 1 zondag 5 april 2026, Pasen: Falconplein; Artikel 2 donderdag 14 mei 2026, Hemelvaartsdag: Dageraadplaats; Artikel 3 Einde.",
};

// fetch-nep: `weigert(pageSize)` zegt welke zoekpagina's HTTP 500 geven; `zoek` maakt de zoekpagina.
function nepEbesluit({ weigert = () => false, zoek = () => ZOEKPAGINA, calls = [] } = {}) {
  return async (url) => {
    const u = new URL(String(url));
    assert.equal(u.origin, "https://ebesluit.antwerpen.be");
    calls.push(u);
    if (u.pathname === "/zoeken") return weigert(Number(u.searchParams.get("pageSize"))) ? resp("Internal Server Error", 500) : resp(zoek(u));
    const id = u.pathname.split("/").pop();
    return DETAILS[id] ? resp(DETAILS[id]) : resp("", 404);
  };
}
const ALTIJD = () => true;
const zoekGroottes = (calls) => calls.filter((u) => u.pathname === "/zoeken").map((u) => Number(u.searchParams.get("pageSize")));

function makeRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ebesluit-terugval-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
const leesBron = (root) => JSON.parse(fs.readFileSync(path.join(root, "site", "sources", `${SOURCE_ID}.json`), "utf8"));
const draai = (root, fetchImpl, clock = NOW) => run({ rootDir: root, clock: () => clock, fetch: fetchImpl, log: () => {}, sleep: noSleep });

// ---------- 2. kleinere zoekpagina's ----------

test("de terugval: na 500 rijen eerst 100, dan 50", () => {
  assert.equal(EBESLUIT_PAGE_SIZE, 500);
  assert.deepEqual([...EBESLUIT_FALLBACK_PAGE_SIZES], [100, 50]);
});

test("pagina's van 500 rijen geven HTTP 500, met 100 antwoordt eBesluit: de zoekronde is volledig en het bronbestand ok", async (t) => {
  const root = makeRoot(t);
  const calls = [];
  const [status] = await draai(root, nepEbesluit({ weigert: (n) => n === 500, calls }));
  assert.deepEqual([status.fetchStatus, status.errorCode, status.itemCount], ["ok", null, 2]);
  const doc = leesBron(root);
  assert.deepEqual(validateSourceDocument(doc, { expectedSourceId: SOURCE_ID }), []);
  assert.equal(doc.fetchStatus, "ok");
  assert.ok(!("lastError" in doc) && !("lastSuccessAt" in doc), "een geslaagde verversing heeft geen lastError");
  assert.deepEqual(doc.items.map((item) => item.externalId).sort(), ["2026_DCAN_00001", "2026_DCAN_00002"]);
  // Per zoekterm en jaar: 500 (met de bestaande herkansing: 2 verzoeken), dan 100; nooit 50.
  const perZoekronde = EBESLUIT_KEYWORDS.length * 2;
  assert.deepEqual(zoekGroottes(calls), Array.from({ length: perZoekronde }, () => [500, 500, 100]).flat());
});

test("binnen de paginagrenzen: met 100 rijen per pagina wordt een venster helemaal doorlopen, en het volgende venster begint meteen bij 100", async () => {
  // Een venster van twee maanden met 300 treffers. 20 pagina's van 100 is 2.000: het hele venster lukt in 3 pagina's
  // van 100, na de geweigerde pagina van 500 (met haar herkansing).
  const rij = (n) => zoekRij(`r-${n}`, "m-test");
  const pagina = (totaal, ids) => `<span class="result-count">${totaal} resultaten gevonden</span>${ids.map(rij).join("")}`;
  const calls = [];
  const fetchImpl = nepEbesluit({
    calls,
    weigert: (n) => n === 500,
    zoek: (u) => {
      const p = Number(u.searchParams.get("page")), grootte = Number(u.searchParams.get("pageSize"));
      return pagina(300, Array.from({ length: Math.max(0, Math.min(grootte, 300 - p * grootte)) }, (_, i) => p * grootte + i + 1));
    },
  });
  const volledig = await searchKeyword(fetchImpl, "markt", { start: "2026-10-01", end: "2026-11-30" }, { retryDelayMs: 0, sleepImpl: noSleep });
  assert.equal(volledig.coverage.complete, true);
  assert.equal(volledig.rows.length, 300);
  assert.deepEqual(zoekGroottes(calls), [500, 500, 100, 100, 100]);

  // Meer treffers dan 20 pagina's van 100 (2.500 in het venster): onvolledig, dan per maand (2.100 elk, ook te veel)
  // en dus fail-closed onvolledig. De maanden beginnen meteen bij 100: geen geweigerde 500 meer.
  const calls2 = [];
  const teVeel = nepEbesluit({ calls: calls2, weigert: (n) => n === 500, zoek: (u) => pagina(u.searchParams.get("meetingDateStart") === "2026-10-01" && u.searchParams.get("meetingDateEnd") === "2026-11-30" ? 2500 : 2100, [1]) });
  const onvolledig = await searchKeyword(teVeel, "markt", { start: "2026-10-01", end: "2026-11-30" }, { retryDelayMs: 0, sleepImpl: noSleep });
  assert.equal(onvolledig.coverage.complete, false);
  assert.deepEqual(zoekGroottes(calls2), [500, 500, 100, 100, 100]);
});

test("ook een kleinere pagina die halverwege faalt, telt niet: de rijen van die poging vallen weg en 50 begint opnieuw", async () => {
  // 120 treffers; 500 geeft altijd 503, 100 alleen op pagina 1, 50 werkt.
  const calls = [];
  const fetchImpl = nepEbesluit({
    calls,
    weigert: () => false,
    zoek: (u) => {
      const p = Number(u.searchParams.get("page")), grootte = Number(u.searchParams.get("pageSize"));
      const ids = Array.from({ length: Math.max(0, Math.min(grootte, 120 - p * grootte)) }, (_, i) => p * grootte + i + 1);
      return `<span class="result-count">120 resultaten gevonden</span>${ids.map((n) => zoekRij(`r-${n}`, "m-test")).join("")}`;
    },
  });
  const metFouten = async (url) => {
    const u = new URL(String(url));
    const grootte = Number(u.searchParams.get("pageSize")), p = Number(u.searchParams.get("page"));
    if (grootte === 500 || (grootte === 100 && p === 1)) { calls.push(u); return resp("", 503); }
    return fetchImpl(url);
  };
  const r = await searchKeyword(metFouten, "markt", { start: "2026-10-01", end: "2026-10-31" }, { retryDelayMs: 0, sleepImpl: noSleep });
  assert.equal(r.coverage.complete, true);
  assert.equal(r.rows.length, 120);
  assert.deepEqual(zoekGroottes(calls), [500, 500, 100, 100, 100, 50, 50, 50]);
});

// ---------- 1. de reden in het bronbestand ----------

test("altijd HTTP 500: fout http_500 met lastError in het bronbestand, de vorige items blijven, begrensd aantal verzoeken", async (t) => {
  const root = makeRoot(t);
  await draai(root, nepEbesluit());
  const vorige = leesBron(root);
  assert.equal(vorige.fetchStatus, "ok");

  const toen = new Date("2026-09-29T06:00:00Z");
  const calls = [];
  const [status] = await draai(root, nepEbesluit({ weigert: ALTIJD, calls }), toen);
  assert.deepEqual([status.fetchStatus, status.errorCode, status.itemCount, status.retrievedAt], ["error", "http_500", 2, NOW.toISOString()]);
  const doc = leesBron(root);
  assert.deepEqual(validateSourceDocument(doc, { expectedSourceId: SOURCE_ID }), []);
  assert.equal(doc.fetchStatus, "error");
  assert.deepEqual(doc.lastError, { code: "http_500", at: toen.toISOString() });
  assert.equal(doc.lastSuccessAt, NOW.toISOString());
  assert.equal(doc.retrievedAt, NOW.toISOString());
  assert.deepEqual(doc.items, vorige.items, "de vorige, geverifieerde items blijven");
  assert.deepEqual(doc.suppressions, vorige.suppressions);
  // Geen URL, zoekterm of andere vrije tekst in de reden.
  assert.deepEqual(Object.keys(doc.lastError), ["code", "at"]);
  assert.doesNotMatch(JSON.stringify(doc.lastError), /:\/\/|zoeken|query|speelstraat|kermis|foor|markt/);
  // Begrensd: het jaarvenster met 500, 100 en 50 (elk met de herkansing), het eerste kwartaal en de eerste maand
  // alleen nog met 50; dan stopt de zoekronde (ze kan niet meer volledig worden), zonder detailpagina's.
  assert.deepEqual(zoekGroottes(calls), [500, 500, 100, 100, 50, 50, 50, 50, 50, 50]);
  assert.equal(calls.length, 10);
  assert.deepEqual([...new Set(calls.map((u) => u.searchParams.get("query")))], [EBESLUIT_KEYWORDS[0]]);

  // De volgende nacht weer HTTP 500: het bestand is leesbaar (readSourceDocument), de items blijven, lastError schuift op.
  assert.ok(readSourceDocument(root, SOURCE_ID), "een bronbestand met lastError is geldig");
  const nog = new Date("2026-09-30T06:00:00Z");
  await draai(root, nepEbesluit({ weigert: ALTIJD }), nog);
  const tweede = leesBron(root);
  assert.deepEqual([tweede.lastError, tweede.lastSuccessAt], [{ code: "http_500", at: nog.toISOString() }, NOW.toISOString()]);
  assert.deepEqual(tweede.items, vorige.items);

  // Lukt het weer, dan valt de reden weg.
  const weer = new Date("2026-10-01T06:00:00Z");
  const [ok] = await draai(root, nepEbesluit(), weer);
  assert.equal(ok.fetchStatus, "ok");
  const hersteld = leesBron(root);
  assert.equal(hersteld.retrievedAt, weer.toISOString());
  assert.ok(!("lastError" in hersteld) && !("lastSuccessAt" in hersteld));
});

test("ook een andere fout staat er: no_decisions en search_incomplete", async (t) => {
  const root = makeRoot(t);
  await draai(root, nepEbesluit());
  await draai(root, nepEbesluit({ zoek: () => '<span class="result-count">0 resultaten gevonden</span>' }), new Date("2026-09-29T06:00:00Z"));
  assert.deepEqual(leesBron(root).lastError, { code: "no_decisions", at: "2026-09-29T06:00:00.000Z" });
  // Een zoekpagina die meer treffers meldt dan ze toont: onvolledig, nooit als volledig aanvaard (#186).
  await draai(root, nepEbesluit({ zoek: () => `<span class="result-count">3 resultaten gevonden</span>${ZOEKPAGINA}` }), new Date("2026-09-30T06:00:00Z"));
  const doc = leesBron(root);
  assert.deepEqual([doc.fetchStatus, doc.lastError, doc.lastSuccessAt, doc.items.length], ["error", { code: "search_incomplete", at: "2026-09-30T06:00:00.000Z" }, NOW.toISOString(), 2]);
});

test("keepPreviousOnError zonder vorig bestand: lastSuccessAt null, en de reden staat er toch", (t) => {
  const root = makeRoot(t);
  const status = keepPreviousOnError(root, SOURCE_ID, null, "http_503", { at: "2026-10-13T03:20:00.000Z" });
  assert.deepEqual([status.fetchStatus, status.errorCode, status.itemCount], ["error", "http_503", 0]);
  const doc = leesBron(root);
  assert.deepEqual([doc.retrievedAt, doc.lastSuccessAt, doc.lastError], [null, null, { code: "http_503", at: "2026-10-13T03:20:00.000Z" }]);
  assert.deepEqual(validateSourceDocument(doc, { expectedSourceId: SOURCE_ID }), []);
  // Een ongeldig moment of een foutcode met vrije tekst breekt het bewaren niet.
  keepPreviousOnError(root, SOURCE_ID, null, "https://ebesluit.antwerpen.be/zoeken?query=markt", { at: "gisteren" });
  const tweede = leesBron(root);
  assert.equal(tweede.lastError.code, "unexpected_error");
  assert.ok(Number.isFinite(Date.parse(tweede.lastError.at)));
});

test("schema: lastError alleen als vaste foutcode met moment, samen met lastSuccessAt en alleen bij een fout", () => {
  const ok = sourceDocument(SOURCE_ID, { retrievedAt: NOW.toISOString(), fetchStatus: "error", lastError: { code: "http_500", at: "2026-10-13T03:20:00.000Z" }, lastSuccessAt: NOW.toISOString() });
  assert.deepEqual(validateSourceDocument(ok), []);
  // Een bestand van vóór deze velden blijft geldig.
  assert.deepEqual(validateSourceDocument(sourceDocument(SOURCE_ID, { retrievedAt: NOW.toISOString(), fetchStatus: "error" })), []);
  const fout = (wijziging) => validateSourceDocument({ ...ok, ...wijziging });
  assert.ok(fout({ lastError: { code: "https://ebesluit.antwerpen.be/zoeken?query=markt", at: ok.lastError.at } }).includes("ongeldige lastError.code"));
  assert.ok(fout({ lastError: { code: "HTTP 500 bij markt", at: ok.lastError.at } }).includes("ongeldige lastError.code"));
  assert.ok(fout({ lastError: { ...ok.lastError, url: "https://ebesluit.antwerpen.be/" } }).includes("ongeldige lastError"));
  assert.ok(fout({ lastError: { code: "http_500", at: "gisteren" } }).includes("ongeldige lastError.at"));
  assert.ok(fout({ lastError: "http_500" }).includes("ongeldige lastError"));
  assert.ok(fout({ lastSuccessAt: "vorige week" }).includes("ongeldige lastSuccessAt"));
  assert.ok(fout({ fetchStatus: "ok" }).includes("lastError alleen bij fetchStatus error"));
  const { lastSuccessAt: _weg, ...zonder } = ok;
  assert.ok(validateSourceDocument(zonder).includes("lastError en lastSuccessAt horen samen"));
});

test("intern: de feed draagt lastError en lastSuccessAt niet, wel fetchStatus en errorCode", () => {
  const retrievedAt = "2026-10-12T03:21:00.000Z";
  const document = sourceDocument(SOURCE_ID, { retrievedAt, fetchStatus: "error", lastError: { code: "http_500", at: "2026-10-18T03:18:00.000Z" }, lastSuccessAt: retrievedAt });
  const status = {
    schemaVersion: 1,
    generatedAt: "2026-10-18T03:18:00.000Z",
    classificationAsOf: "2026-10-18",
    sources: [statusEntry(SOURCE_ID, { fetchStatus: "error", retrievedAt, itemCount: 0, errorCode: "http_500" })],
  };
  const { feed } = buildFeed({ status, documents: [document] }, []);
  const bron = feed.sources.find((s) => s.sourceId === SOURCE_ID);
  assert.ok(!("lastError" in bron) && !("lastSuccessAt" in bron));
  assert.deepEqual([bron.fetchStatus, bron.errorCode], ["error", "http_500"]);
});
