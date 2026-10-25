// eBesluit zonder zoekfunctie (lib/ebesluit-kalender.mjs). Sinds 13-10-2026 geeft /zoeken bij elke vraag
// HTTP 500, ook in een gewone browser; de maandlijst en de zittingspagina's werken. Dan zoekt de bron via
// die twee, met dezelfde rijen als de zoekfunctie, en faalt ze pas als ook die route faalt.
// Alle pagina's zijn verzonnen (tests/fixtures/ebesluit-kalender), in de opmaak van de echte site.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { discoverCivicDecisions, searchKeyword } from "../lib/ebesluit-discovery.mjs";
import { ontdekEvenementBesluiten } from "../lib/ebesluit-evenementen.mjs";
import { KALENDER_ORGANEN, maandenTussen, puntenUitZitting, zittingenUitLijst } from "../lib/ebesluit-kalender.mjs";

const hier = path.dirname(fileURLToPath(import.meta.url));
const kalender = (naam) => fs.readFileSync(path.join(hier, "fixtures", "ebesluit-kalender", naam), "utf8");
const evenementen = (naam) => fs.readFileSync(path.join(hier, "fixtures", "ebesluit-evenementen", naam), "utf8");
const resp = (text, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => text });
const noSleep = async () => {};
const TODAY = "2026-10-10";
const LEGE_LIJST = '<div class="list-view"></div>';
const DETAILS = {
  "26.0901.0001.0001": "evenement.html",
  "26.0901.0005.0005": "muziek.html",
  "26.0901.0006.0006": "tuinfeest.html",
  "26.0901.0007.0007": "districtsfonds.html",
};

// Nep-eBesluit. zoekStatus: wat /zoeken antwoordt (200 geeft de verzonnen zoekpagina voor "Evenementen");
// lijstStatus / zittingStatus: om ook de kalenderroute te laten falen.
function nepEbesluit({ calls = [], zoekStatus = 500, lijstStatus = 200, zittingStatus = 200 } = {}) {
  return async (url) => {
    const u = new URL(String(url));
    calls.push(`${u.pathname}${u.search}`);
    if (u.pathname === "/zoeken") {
      if (zoekStatus !== 200) return resp("<h1>Systeem tijdelijk onbeschikbaar</h1>", zoekStatus);
      if (u.searchParams.get("query") !== "Evenementen") return resp('<span class="result-count">0 resultaten gevonden</span>');
      return resp(evenementen("zoeken.html"));
    }
    if (u.pathname === "/zittingen/lijst") {
      if (lijstStatus !== 200) return resp("", lijstStatus);
      const naam = `lijst-${u.searchParams.get("year")}-${u.searchParams.get("month")}.html`;
      return resp(fs.existsSync(path.join(hier, "fixtures", "ebesluit-kalender", naam)) ? kalender(naam) : LEGE_LIJST);
    }
    const punt = u.pathname.match(/^\/zittingen\/[^/]+\/agendapunten\/([^/]+)$/)?.[1];
    if (punt) return DETAILS[punt] ? resp(evenementen(DETAILS[punt])) : resp("", 404);
    const zitting = u.pathname.match(/^\/zittingen\/([0-9.]+)$/)?.[1];
    if (zitting) {
      if (zittingStatus !== 200) return resp("", zittingStatus);
      const naam = `zitting-${zitting}.html`;
      return fs.existsSync(path.join(hier, "fixtures", "ebesluit-kalender", naam)) ? resp(kalender(naam)) : resp("", 404);
    }
    return resp("", 404);
  };
}

test("maandlijst: zitting-id, orgaan, dag en uur; de navigatielinks tellen niet", () => {
  assert.deepEqual(zittingenUitLijst(kalender("lijst-2026-10.html")), [
    { zittingId: "25.0901.0000.0005", orgaan: "college van burgemeester en schepenen", datum: "2026-10-02", uur: "09:30" },
    { zittingId: "25.0901.0000.0007", orgaan: "districtscollege Antwerpen", datum: "2026-10-05", uur: "13:30" },
    { zittingId: "25.0901.0000.0008", orgaan: "districtscollege Berchem", datum: "2026-10-05", uur: "13:30" },
    { zittingId: "25.0901.0000.0098", orgaan: "districtsraad Antwerpen", datum: "2026-10-19", uur: "20:00" },
  ]);
  assert.deepEqual(zittingenUitLijst(LEGE_LIJST), []);
  assert.deepEqual(["college van burgemeester en schepenen", "districtscollege Antwerpen", "districtsraad Antwerpen"].map((o) => KALENDER_ORGANEN.test(o)), [true, true, true]);
  assert.deepEqual(["districtscollege Berchem", "districtsraad Antwerpen-Noord", "burgemeester", "gemeenteraad"].map((o) => KALENDER_ORGANEN.test(o)), [false, false, false, false]);
});

test("zittingspagina: per punt id, titel en of het gepubliceerd is; zelfde vorm als een zoekrij", () => {
  const zitting = { zittingId: "25.0901.0000.0007", orgaan: "districtscollege Antwerpen", datum: "2026-10-05" };
  assert.deepEqual(puntenUitZitting(kalender("zitting-25.0901.0000.0007.html"), zitting), [
    { id: "25.1219.5009.9352", meetingId: "25.0901.0000.0007", published: false, title: "13:45 Toelichting Proefstraat", organ: "districtscollege Antwerpen", zitting: "2026-10-05" },
    { id: "26.0901.0007.0007", meetingId: "25.0901.0000.0007", published: true, title: "2026_DCAN_09007 - Ondersteuning. Districtsfonds: beleef je buurt! - Piet Proefpersoon. Toekenning en uitbetaling - Goedkeuring", organ: "districtscollege Antwerpen", zitting: "2026-10-05" },
  ]);
  const cbs = puntenUitZitting(kalender("zitting-25.0901.0000.0005.html"), { zittingId: "25.0901.0000.0005", orgaan: "college van burgemeester en schepenen", datum: "2026-10-02" });
  assert.match(cbs[0].title, /voor "Nachtelijke Testklanken",/, "entiteiten ontcijferd zoals in een zoekrij");
  assert.deepEqual(maandenTussen("2026-08-11", "2026-10-24"), [[2026, 8], [2026, 9], [2026, 10]]);
  assert.deepEqual(maandenTussen("2026-12-01", "2027-01-31"), [[2026, 12], [2027, 1]]);
});

test("/zoeken geeft 500: de zoekterm komt uit de kalender, /zoeken wordt maar één keer geprobeerd en elke pagina één keer gehaald", async () => {
  const calls = [];
  const fetchImpl = nepEbesluit({ calls });
  const opties = { retryDelayMs: 0, sleepImpl: noSleep, vandaag: TODAY };
  const venster = { start: "2026-08-11", end: "2027-02-07" };
  const evenement = await searchKeyword(fetchImpl, "Evenementen", venster, opties);
  const muziek = await searchKeyword(fetchImpl, "muziekactiviteit", venster, opties);
  assert.deepEqual(evenement.rows.map((r) => [r.id, r.published, r.zitting]), [
    ["26.0901.0001.0001", true, "2026-09-25"],
    ["26.0901.0002.0002", false, "2026-09-25"],
    ["26.0901.0004.0004", true, "2026-09-25"],
    ["26.0901.0009.0009", true, "2026-09-25"],
    ["26.0901.0010.0010", false, "2026-09-25"],
  ]);
  assert.deepEqual(muziek.rows.map((r) => r.id), ["26.0901.0005.0005", "26.0901.0006.0006"]);
  assert.deepEqual([evenement.coverage.route, evenement.coverage.complete, muziek.coverage.complete], ["kalender", true, true]);
  // /zoeken: twee keer (de eigen herkansing), alleen voor de eerste term.
  assert.equal(calls.filter((c) => c.startsWith("/zoeken")).length, 2);
  // Augustus tot en met oktober (vandaag + 14 dagen), niet tot februari; elke maand één keer.
  assert.deepEqual(calls.filter((c) => c.startsWith("/zittingen/lijst")), [
    "/zittingen/lijst?month=08&year=2026", "/zittingen/lijst?month=09&year=2026", "/zittingen/lijst?month=10&year=2026",
  ]);
  // Alleen de drie organen; elke zitting één keer; geen zitting van Deurne of Berchem.
  assert.deepEqual(calls.filter((c) => /^\/zittingen\/[0-9.]+$/.test(c)), [
    "/zittingen/25.0901.0000.0001", "/zittingen/25.0901.0000.0005", "/zittingen/25.0901.0000.0007", "/zittingen/25.0901.0000.0098",
  ]);
});

test("een venster dat helemaal na vandaag + 14 dagen valt, vraagt niets op", async () => {
  const calls = [];
  const result = await searchKeyword(nepEbesluit({ calls }), "markt", 2027, { retryDelayMs: 0, sleepImpl: noSleep, vandaag: TODAY });
  assert.deepEqual([result.rows, result.coverage.complete], [[], true]);
  assert.deepEqual(calls.filter((c) => !c.startsWith("/zoeken")), []);
});

test("faalt ook de kalender, dan faalt de zoekterm met de oorspronkelijke fout (fail-closed, vorige data blijft)", async () => {
  for (const nep of [nepEbesluit({ lijstStatus: 503 }), nepEbesluit({ zittingStatus: 404 })]) {
    await assert.rejects(searchKeyword(nep, "Evenementen", { start: "2026-08-11", end: "2026-10-31" }, { retryDelayMs: 0, sleepImpl: noSleep, vandaag: TODAY }), (error) => error.code === "http_500");
  }
  // Een andere fout van /zoeken (geen 5xx) gaat niet langs de kalender.
  const calls = [];
  await assert.rejects(searchKeyword(nepEbesluit({ calls, zoekStatus: 404 }), "Evenementen", { start: "2026-08-11", end: "2026-10-31" }, { retryDelayMs: 0, sleepImpl: noSleep, vandaag: TODAY }), (error) => error.code === "http_404");
  assert.deepEqual(calls.filter((c) => !c.startsWith("/zoeken")), []);
});

test("rustig: tussen twee verzoeken van de kalender een pauze", async () => {
  const pauzes = [];
  await searchKeyword(nepEbesluit(), "Evenementen", { start: "2026-09-01", end: "2026-09-30" }, { retryDelayMs: 0, sleepImpl: async (ms) => { pauzes.push(ms); }, vandaag: TODAY });
  // Herkansing van /zoeken (0 ms), daarna 500 ms vóór elke nieuwe pagina na de eerste (lijst, zitting 0001).
  assert.deepEqual(pauzes, [0, 500]);
});

test("evenementen: via de kalender dezelfde besluiten van de drie organen als via de zoekfunctie", async () => {
  const opties = { today: TODAY, straten: [["1", "Rijnkaai", "2000", [], []], ["3", "Voorbeeldplein", "2000", [], []], ["4", "Proefstraat", "2018", [], []]], sleep: noSleep, intervalMs: 0 };
  const viaZoeken = await ontdekEvenementBesluiten({ ...opties, fetch: nepEbesluit({ zoekStatus: 200 }) });
  const viaKalender = await ontdekEvenementBesluiten({ ...opties, fetch: nepEbesluit({ zoekStatus: 500 }) });
  assert.equal(viaKalender.complete, true);
  const binnen = (besluiten) => besluiten.filter((b) => KALENDER_ORGANEN.test(b.orgaan)).map((b) => [b.id, b.code, b.status, b.gepubliceerd, b.gelezen, b.zitting, b.naam ?? null]);
  assert.ok(binnen(viaZoeken.besluiten).length >= 4, "de vergelijking heeft iets om te vergelijken");
  assert.deepEqual(binnen(viaKalender.besluiten), binnen(viaZoeken.besluiten));
  assert.deepEqual(viaKalender.gelezen, viaZoeken.gelezen);
});

test("raadskalender (district-ebesluit): bij een 500 op /zoeken geen fout meer, maar de kalender", async () => {
  const calls = [];
  const result = await discoverCivicDecisions({ fetch: nepEbesluit({ calls }), year: 2026, retryDelayMs: 0, sleepImpl: noSleep, vandaag: TODAY });
  assert.equal(result.complete, true);
  assert.ok(result.coverage.every((c) => c.route === "kalender"));
  assert.equal(calls.filter((c) => c.startsWith("/zoeken")).length, 2, "één term probeert /zoeken, de rest gaat meteen naar de kalender");
  // Januari tot en met oktober, elk één keer, ook al zoeken vier termen.
  assert.equal(calls.filter((c) => c.startsWith("/zittingen/lijst")).length, 10);
});
