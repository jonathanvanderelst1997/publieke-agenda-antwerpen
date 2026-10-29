// eBesluit zonder zoekfunctie (lib/ebesluit-kalender.mjs). /zoeken was op twee manieren onbruikbaar:
//   - vanaf 13-10-2026 gaf het bij elke vraag HTTP 500, ook in een gewone browser (en ook met kleinere pagina's, #201);
//   - sinds 26-10-2026 antwoordt het weer met 200, maar negeert het het venster op zittingsdatum: "markt" in oktober
//     2026 gaf 227.724 treffers met rijen uit 2008 tot 2013 bovenaan (vensterGenegeerd in lib/ebesluit-discovery.mjs).
// De maandlijst en de zittingspagina's werkten in beide gevallen. Dan zoekt de bron via die twee, met dezelfde rijen
// als de zoekfunctie, en faalt ze pas als ook die route faalt.
// Alle pagina's zijn verzonnen (tests/fixtures/ebesluit-kalender), in de opmaak van de echte site.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { EBESLUIT_KEYWORDS, VENSTER_GENEGEERD_MIN_RIJEN, discoverCivicDecisions, pageSizeChoice, searchKeyword, vensterGenegeerd, zoekfunctieStuk } from "../lib/ebesluit-discovery.mjs";
import { ontdekEvenementBesluiten } from "../lib/ebesluit-evenementen.mjs";
import { KALENDER_ORGANEN, maandenTussen, puntenUitZitting, zittingenUitLijst } from "../lib/ebesluit-kalender.mjs";
import { FetchError } from "../lib/fetch-util.mjs";
import { run as runEbesluit } from "../scripts/fetch-sources-ebesluit.mjs";

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

// Een zoekpagina zoals /zoeken ze sinds 26-10-2026 geeft: een teller voor de hele databank en rijen van jaren geleden,
// wat het venster ook was. Eén schriftelijke vraag met twee datums. Verzonnen titels en ids.
function zonderVenster(aantal = 50) {
  const rij = (i) => `<a href="#" class="result-row" data-type="MEETING_ITEM" data-id="15.1017.0000.${String(i).padStart(4, "0")}" data-meeting-id="15.1017.0001.${String(i).padStart(4, "0")}" data-content-published="true">
  <p class="title">District Proefdorp. Markten op feestdagen in 2011. Goedkeuring. Concretisering beleidsrichtlijn</p>
  <p class="metadata"><span class="date" hidden="hidden"></span><span class="date">30/11/2011 00:00</span><span class="organ">districtscollege Proefdorp</span></p>
</a>`;
  const vraag = `<a href="#" class="result-row" data-type="WRITTENQUESTION" data-id="15.1010.0000.0001" data-content-published="true">
  <p class="title">2013_SV_00001 - Schriftelijke vraag: stand van zaken proefproject</p>
  <p class="metadata"><span class="date">24/05/2013 11:44</span><span class="date">24/06/2013 19:30</span><span class="organ">gemeenteraad</span></p>
</a>`;
  return `<div class="search-header"><span class="result-count">227.724 resultaten gevonden</span></div><div class="search-results">${vraag}${Array.from({ length: aantal - 1 }, (_, i) => rij(i)).join("")}</div>`;
}

// Nep-eBesluit. zoek: wat /zoeken antwoordt: een status (500), "zonder-venster" (200, venster genegeerd) of 200 (de
// verzonnen zoekpagina voor "Evenementen"); lijstStatus / zittingStatus: om ook de kalenderroute te laten falen.
function nepEbesluit({ calls = [], zoek = 500, lijstStatus = 200, zittingStatus = 200 } = {}) {
  return async (url) => {
    const u = new URL(String(url));
    calls.push(`${u.pathname}${u.search}`);
    if (u.pathname === "/zoeken") {
      if (zoek === "zonder-venster") return resp(zonderVenster());
      if (zoek !== 200) return resp("<h1>Systeem tijdelijk onbeschikbaar</h1>", zoek);
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
const zoekverzoeken = (calls) => calls.filter((c) => c.startsWith("/zoeken"));
const kalenderverzoeken = (calls) => calls.filter((c) => !c.startsWith("/zoeken"));

// ---------- de kalender lezen ----------

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

// ---------- herkennen dat /zoeken het venster negeert ----------

test("vensterGenegeerd: een volle pagina met rijen van jaren geleden wel, een werkend venster of één afwijkende rij niet", () => {
  assert.equal(vensterGenegeerd(zonderVenster(), "2026-10-01", "2026-10-31"), true);
  assert.equal(vensterGenegeerd(zonderVenster(), "2011-01-01", "2013-12-31"), false, "dezelfde rijen in hun eigen venster");
  // De verzonnen zoekpagina van de evenementen: alle rijen binnen het venster.
  assert.equal(vensterGenegeerd(evenementen("zoeken.html"), "2026-08-11", "2027-02-07"), false);
  // Minder dan VENSTER_GENEGEERD_MIN_RIJEN rijen erbuiten bewijst niets; de meerderheid moet erbuiten liggen.
  assert.equal(vensterGenegeerd(zonderVenster(VENSTER_GENEGEERD_MIN_RIJEN), "2026-10-01", "2026-10-31"), true);
  assert.equal(vensterGenegeerd(zonderVenster(VENSTER_GENEGEERD_MIN_RIJEN - 1), "2026-10-01", "2026-10-31"), false);
  const erbuiten = zonderVenster(6).replace(/^[\s\S]*?<div class="search-results">/, "").replace(/<\/div>$/, "");
  const half = evenementen("zoeken.html").replace(/<\/div>\s*$/, `${erbuiten}</div>\n`);
  assert.equal(vensterGenegeerd(half, "2026-08-11", "2027-02-07"), false, "11 rijen binnen, 6 erbuiten: geen meerderheid");
  // Een schriftelijke vraag met één datum binnen het venster telt als binnen.
  const vraag = '<a class="result-row" data-id="v"><span class="date">24/05/2013 11:44</span><span class="date">05/10/2026 19:30</span></a>';
  assert.equal(vensterGenegeerd(vraag.repeat(5), "2026-10-01", "2026-10-31"), false);
  // Rijen zonder datum, of een ongeldig venster: niets te beslissen.
  assert.equal(vensterGenegeerd('<a class="result-row" data-id="x"><p class="title">x</p></a>'.repeat(10), "2026-10-01", "2026-10-31"), false);
  assert.equal(vensterGenegeerd(zonderVenster(), "", "2026-10-31"), false);
  // Wat de terugval laat beginnen: een blijvende 5xx of het genegeerde venster, met de fase van het zoeken.
  assert.deepEqual(["search_http_500", "search_http_503", "search_window_ignored"].map((c) => zoekfunctieStuk(new FetchError(c))), [true, true, true]);
  assert.deepEqual(["search_http_404", "search_incomplete", "source_timeout", "detail_http_500", "http_500"].map((c) => zoekfunctieStuk(new FetchError(c))), [false, false, false, false, false]);
});

test("/zoeken negeert het venster: één zoekpagina, dan de kalender voor elke zoekterm van de run", async () => {
  const calls = [];
  const fetchImpl = nepEbesluit({ calls, zoek: "zonder-venster" });
  const opties = { retryDelayMs: 0, sleepImpl: noSleep, vandaag: TODAY };
  const venster = { start: "2026-08-11", end: "2027-02-07" };
  const run = pageSizeChoice();
  const evenement = await searchKeyword(fetchImpl, "Evenementen", venster, opties, run);
  const muziek = await searchKeyword(fetchImpl, "muziekactiviteit", venster, opties, run);
  assert.equal(zoekverzoeken(calls).length, 1, "de eerste pagina verraadt het al; niet opsplitsen in maanden");
  assert.equal(run.zoekenStuk?.code, "search_window_ignored");
  assert.deepEqual([evenement.coverage.route, evenement.coverage.complete, muziek.coverage.route], ["kalender", true, "kalender"]);
  assert.deepEqual(evenement.rows.map((r) => r.id), ["26.0901.0001.0001", "26.0901.0002.0002", "26.0901.0004.0004", "26.0901.0009.0009", "26.0901.0010.0010"]);
  assert.deepEqual(muziek.rows.map((r) => r.id), ["26.0901.0005.0005", "26.0901.0006.0006"]);
  // Geen enkele rij van de genegeerde zoekpagina (uit 2011) komt mee.
  assert.ok([...evenement.rows, ...muziek.rows].every((r) => !r.id.startsWith("15.")));
});

test("/zoeken geeft 500: na de kleinere pagina's van #201 de kalender; /zoeken één keer per run, elke pagina één keer", async () => {
  const calls = [];
  const fetchImpl = nepEbesluit({ calls });
  const opties = { retryDelayMs: 0, sleepImpl: noSleep, vandaag: TODAY };
  const venster = { start: "2026-08-11", end: "2027-02-07" };
  const run = pageSizeChoice();
  const evenement = await searchKeyword(fetchImpl, "Evenementen", venster, opties, run);
  const muziek = await searchKeyword(fetchImpl, "muziekactiviteit", venster, opties, run);
  assert.deepEqual(evenement.rows.map((r) => [r.id, r.published, r.zitting]), [
    ["26.0901.0001.0001", true, "2026-09-25"],
    ["26.0901.0002.0002", false, "2026-09-25"],
    ["26.0901.0004.0004", true, "2026-09-25"],
    ["26.0901.0009.0009", true, "2026-09-25"],
    ["26.0901.0010.0010", false, "2026-09-25"],
  ]);
  assert.deepEqual(muziek.rows.map((r) => r.id), ["26.0901.0005.0005", "26.0901.0006.0006"]);
  assert.deepEqual([evenement.coverage.route, evenement.coverage.complete, muziek.coverage.complete], ["kalender", true, true]);
  assert.equal(run.zoekenStuk?.code, "search_http_500");
  // /zoeken: het venster met 500, 100 en 50 rijen en de eerste maand met 50 (elk met de herkansing), alleen voor de
  // eerste term; de tweede gaat meteen naar de kalender.
  assert.equal(zoekverzoeken(calls).length, 8);
  assert.ok(zoekverzoeken(calls).every((c) => c.includes("query=Evenementen")));
  // Augustus tot en met oktober (vandaag + 14 dagen), niet tot februari; elke maand één keer.
  assert.deepEqual(calls.filter((c) => c.startsWith("/zittingen/lijst")), [
    "/zittingen/lijst?month=08&year=2026", "/zittingen/lijst?month=09&year=2026", "/zittingen/lijst?month=10&year=2026",
  ]);
  // Alleen de drie organen; elke zitting één keer; geen zitting van Deurne of Berchem.
  assert.deepEqual(calls.filter((c) => /^\/zittingen\/[0-9.]+$/.test(c)), [
    "/zittingen/25.0901.0000.0001", "/zittingen/25.0901.0000.0005", "/zittingen/25.0901.0000.0007", "/zittingen/25.0901.0000.0098",
  ]);
});

test("een venster dat helemaal na vandaag + 14 dagen valt, vraagt de kalender niets", async () => {
  const calls = [];
  const result = await searchKeyword(nepEbesluit({ calls, zoek: "zonder-venster" }), "markt", 2027, { retryDelayMs: 0, sleepImpl: noSleep, vandaag: TODAY });
  assert.deepEqual([result.rows, result.coverage.complete, result.coverage.route], [[], true, "kalender"]);
  assert.deepEqual(kalenderverzoeken(calls), []);
});

test("faalt ook de kalender, dan faalt de zoekterm met de fout van /zoeken (fail-closed, vorige data blijft)", async () => {
  const venster = { start: "2026-08-11", end: "2026-10-31" };
  const opties = { retryDelayMs: 0, sleepImpl: noSleep, vandaag: TODAY };
  for (const [zoek, code] of [[500, "search_http_500"], ["zonder-venster", "search_window_ignored"]]) {
    for (const nep of [nepEbesluit({ zoek, lijstStatus: 503 }), nepEbesluit({ zoek, zittingStatus: 404 })]) {
      await assert.rejects(searchKeyword(nep, "Evenementen", venster, opties), (error) => error.code === code, String(zoek));
    }
  }
  // Een andere fout van /zoeken (geen 5xx, geen genegeerd venster) gaat niet langs de kalender.
  const calls = [];
  await assert.rejects(searchKeyword(nepEbesluit({ calls, zoek: 404 }), "Evenementen", venster, opties), (error) => error.code === "search_http_404");
  assert.deepEqual(kalenderverzoeken(calls), []);
  // Het tijdsbudget van de bron blijft source_timeout, ook in de kalender.
  const opBudget = async (url) => {
    if (new URL(String(url)).pathname === "/zoeken") return resp(zonderVenster());
    throw new FetchError("source_timeout");
  };
  await assert.rejects(searchKeyword(opBudget, "Evenementen", venster, opties), (error) => error.code === "source_timeout");
});

test("rustig: tussen twee verzoeken van de kalender een pauze", async () => {
  const pauzes = [];
  await searchKeyword(nepEbesluit({ zoek: "zonder-venster" }), "Evenementen", { start: "2026-09-01", end: "2026-09-30" }, { retryDelayMs: 0, sleepImpl: async (ms) => { pauzes.push(ms); }, vandaag: TODAY });
  // Geen pauze vóór de eerste pagina van de kalender (de lijst), wel 500 ms vóór de volgende (zitting 0001).
  assert.deepEqual(pauzes, [500]);
});

// ---------- de twee bronnen ----------

test("evenementen: via de kalender dezelfde besluiten van de drie organen als via de zoekfunctie", async () => {
  const opties = { today: TODAY, straten: [["1", "Rijnkaai", "2000", [], []], ["3", "Voorbeeldplein", "2000", [], []], ["4", "Proefstraat", "2018", [], []]], sleep: noSleep, intervalMs: 0 };
  const viaZoeken = await ontdekEvenementBesluiten({ ...opties, fetch: nepEbesluit({ zoek: 200 }) });
  const binnen = (besluiten) => besluiten.filter((b) => KALENDER_ORGANEN.test(b.orgaan)).map((b) => [b.id, b.code, b.status, b.gepubliceerd, b.gelezen, b.zitting, b.naam ?? null]);
  assert.ok(binnen(viaZoeken.besluiten).length >= 4, "de vergelijking heeft iets om te vergelijken");
  for (const zoek of [500, "zonder-venster"]) {
    const calls = [];
    const viaKalender = await ontdekEvenementBesluiten({ ...opties, fetch: nepEbesluit({ zoek, calls }) });
    assert.equal(viaKalender.complete, true, String(zoek));
    assert.deepEqual(binnen(viaKalender.besluiten), binnen(viaZoeken.besluiten), String(zoek));
    assert.deepEqual(viaKalender.gelezen, viaZoeken.gelezen);
    // Eén stand voor alle zoektermen: elke maandlijst één keer, hoeveel termen er ook zijn.
    const lijsten = calls.filter((c) => c.startsWith("/zittingen/lijst"));
    assert.ok(lijsten.length > 0);
    assert.deepEqual(lijsten, [...new Set(lijsten)], String(zoek));
  }
});

test("raadskalender (district-ebesluit): /zoeken onbruikbaar geeft geen fout meer, maar de kalender", async () => {
  for (const [zoek, zoekenNodig] of [[500, 10], ["zonder-venster", 1]]) {
    const calls = [];
    const result = await discoverCivicDecisions({ fetch: nepEbesluit({ calls, zoek }), year: 2026, retryDelayMs: 0, sleepImpl: noSleep, vandaag: TODAY });
    assert.equal(result.complete, true);
    assert.equal(result.route, "kalender");
    assert.ok(result.coverage.every((c) => c.route === "kalender"));
    assert.equal(zoekverzoeken(calls).length, zoekenNodig, "één term probeert /zoeken, de rest gaat meteen naar de kalender");
    // Januari tot en met oktober, elk één keer, ook al zoeken vier termen.
    assert.equal(calls.filter((c) => c.startsWith("/zittingen/lijst")).length, 10);
  }
});

test("district-ebesluit: negeert /zoeken het venster, dan schrijft de bron haar besluiten via de kalender (vroeger search_incomplete)", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ebesluit-kalender-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Een markt- en een foorbesluit van het districtscollege, als agendapunten van een zitting in oktober. Verzonnen.
  const markt = "Besluit 2026_DCAN_09101 - District Antwerpen - Openbare markten feestdagen 2026 - Goedkeuring districtscollege Antwerpen Het districtscollege antwerpen beslist: Artikel 1 zondag 1 november 2026, Allerheiligen: Falconplein; Artikel 2 Einde.";
  const foor = "Besluit 2026_DCAN_09102 - District Antwerpen - Kermissen 2026 - Goedkeuring districtscollege Antwerpen Het districtscollege antwerpen beslist: Artikel 1 Dageraadplaats - Najaarsfoor: 7 november 2026 tot en met 15 november 2026; Artikel 2 Einde.";
  const zitting = `<ul>
    <li class="agendapage" data-meeting-item-id="26.1005.0001.0001"><div class="item"><a href="/zittingen/25.0901.0000.0007/agendapunten/26.1005.0001.0001" class="title">2026_DCAN_09101 - District Antwerpen - Openbare markten feestdagen 2026 - Goedkeuring</a></div></li>
    <li class="agendapage" data-meeting-item-id="26.1005.0002.0002"><div class="item"><a href="/zittingen/25.0901.0000.0007/agendapunten/26.1005.0002.0002" class="title">2026_DCAN_09102 - District Antwerpen - Kermissen en foor 2026 - Goedkeuring</a></div></li>
  </ul>`;
  const calls = [];
  const fetchImpl = async (url) => {
    const u = new URL(String(url));
    calls.push(`${u.pathname}${u.search}`);
    if (u.pathname === "/zoeken") return resp(zonderVenster());
    if (u.pathname === "/zittingen/lijst") return resp(u.searchParams.get("month") === "10" && u.searchParams.get("year") === "2026" ? kalender("lijst-2026-10.html") : LEGE_LIJST);
    if (u.pathname === "/zittingen/25.0901.0000.0007") return resp(zitting);
    if (u.pathname.endsWith("/26.1005.0001.0001")) return resp(markt);
    if (u.pathname.endsWith("/26.1005.0002.0002")) return resp(foor);
    return /^\/zittingen\/[0-9.]+$/.test(u.pathname) ? resp("<ul></ul>") : resp("", 404);
  };
  const logs = [];
  const [status] = await runEbesluit({ rootDir: root, clock: () => new Date("2026-10-29T03:20:00Z"), fetch: fetchImpl, log: (regel) => logs.push(JSON.parse(regel)), sleep: noSleep });
  assert.deepEqual([status.fetchStatus, status.errorCode], ["ok", null], JSON.stringify(logs));
  const doc = JSON.parse(fs.readFileSync(path.join(root, "site", "sources", "district-ebesluit.json"), "utf8"));
  assert.deepEqual(doc.items.map((item) => [item.externalId, item.date]).sort(), [["2026_DCAN_09101", "2026-11-01"], ["2026_DCAN_09102", "2026-11-07"]]);
  assert.ok(doc.items.every((item) => item.sourceUrl.startsWith("https://ebesluit.antwerpen.be/zittingen/25.0901.0000.0007/agendapunten/")));
  assert.equal(logs.at(-1).route, "kalender", "de run zegt welke route het werd");
  // /zoeken één keer voor de hele run (vier termen, twee jaren); 2027 ligt na vandaag + 14 dagen en kost niets.
  assert.equal(EBESLUIT_KEYWORDS.length, 4);
  assert.equal(zoekverzoeken(calls).length, 1);
  assert.ok(calls.every((c) => !c.includes("year=2027")));
  assert.equal(calls.filter((c) => c.startsWith("/zittingen/lijst")).length, 11, "januari tot en met november 2026, elk één keer");
});
