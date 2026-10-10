// eBesluit als naamgever en bron (pakket P3, zoek- en leesdeel). Alle fixtures zijn verzonnen
// (tests/fixtures/ebesluit-evenementen). De klok staat vast: geen toets hangt af van de echte datum.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { EBESLUIT_MAX_PAGES, EBESLUIT_PAGE_SIZE, monthWindowsBetween, searchKeyword } from "../lib/ebesluit-discovery.mjs";
import {
  EVENEMENT_BESLUITEN_FILE,
  EVENEMENT_ZOEKTERMEN,
  agendapuntenUitBesluiten,
  dagenUitTekst,
  detailDelen,
  gespreideFetch,
  leesDetail,
  ontdekEvenementBesluiten,
  opbouwAfbouw,
  plaatsInDistrict,
  plaatsZonderNummers,
  soortVanTitel,
  straatIndex,
  urenUitTekst,
  validateEvenementBesluiten,
  zoekRijen,
  zoekVenster,
} from "../lib/ebesluit-evenementen.mjs";
import { validateSourceDocument } from "../lib/source-feed.mjs";
import { FETCHERS } from "../lib/source-registry.mjs";
import { readSources } from "../scripts/build-sources.mjs";
import { SOURCE_ID, run } from "../scripts/fetch-sources-ebesluit-evenementen.mjs";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "ebesluit-evenementen");
const fixture = (name) => fs.readFileSync(path.join(fixtureDir, name), "utf8");
const NOW = new Date("2026-10-10T04:00:00Z");
const TODAY = "2026-10-10";
// Verzonnen straatlijst in de vorm van site/geo/straten.json: [id, naam, postcode, wijken, kader].
const STRATEN = [
  ["1", "Rijnkaai", "2000", [], [4.4, 51.2, 4.41, 51.21]],
  ["2", "Kastanjedreef", "2050", [], [4.37, 51.22, 4.38, 51.23]],
  ["3", "Voorbeeldplein", "2000", [], [4.4, 51.2, 4.41, 51.21]],
  ["4", "Proefstraat", "2018", [], [4.41, 51.2, 4.42, 51.21]],
  ["5", "Meir", "2000", [], [4.4, 51.21, 4.41, 51.22]],
];
const INDEX = straatIndex(STRATEN);
const resp = (text, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => text });
const DETAILS = {
  "26.0901.0001.0001": "evenement.html",
  "26.0901.0005.0005": "muziek.html",
  "26.0901.0006.0006": "tuinfeest.html",
  "26.0901.0007.0007": "districtsfonds.html",
};

// Nep-eBesluit: "Evenementen" geeft de verzonnen zoekpagina, de andere termen niets.
function nepEbesluit({ calls = [], kapot = new Set(), zoekStatus = 200 } = {}) {
  return async (url) => {
    const u = new URL(String(url));
    calls.push(u);
    if (u.pathname === "/zoeken") {
      if (zoekStatus !== 200) return resp("", zoekStatus);
      return resp(u.searchParams.get("query") === "Evenementen" ? fixture("zoeken.html") : '<span class="result-count">0 resultaten gevonden</span>');
    }
    const id = u.pathname.split("/").pop();
    if (kapot.has(id)) return resp("", 404);
    return DETAILS[id] ? resp(fixture(DETAILS[id])) : resp("", 404);
  };
}

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ebesluit-evenementen-"));
  fs.mkdirSync(path.join(root, "site", "sources"), { recursive: true });
  fs.mkdirSync(path.join(root, "site", "geo"), { recursive: true });
  fs.writeFileSync(path.join(root, "site", "geo", "straten.json"), JSON.stringify({ schemaVersion: 1, streets: STRATEN }));
  return root;
}
const readJson = (root, name) => JSON.parse(fs.readFileSync(path.join(root, "site", "sources", name), "utf8"));
const noSleep = async () => {};
const runOnce = (root, fetchImpl, extra = {}) => run({ rootDir: root, clock: () => NOW, fetch: fetchImpl, log: () => {}, sleep: noSleep, ...extra });

// ---------- zoeken ----------

test("zoekvenster: zittingsdatum van 60 dagen terug tot 120 dagen vooruit", () => {
  assert.deepEqual(zoekVenster(TODAY), { start: "2026-08-11", end: "2027-02-07" });
  assert.deepEqual(EVENEMENT_ZOEKTERMEN, ["Evenementen", "muziekactiviteit", "Districtsfonds", "Intrede", "Halloween", "feestelijkheden"]);
});

test("zoekrijen: id, zitting, orgaan en publicatie uit de verzonnen zoekpagina", () => {
  const rijen = zoekRijen(fixture("zoeken.html"));
  assert.equal(rijen.length, 11);
  assert.deepEqual(rijen[0], {
    id: "26.0901.0001.0001", meetingId: "25.0901.0000.0001", published: true,
    title: "2026_CBS_09001 - Evenementen - Scheldekaaienloop 2026. Organisatie - Goedkeuring",
    organ: "college van burgemeester en schepenen", zitting: "2026-09-25",
  });
  assert.equal(rijen[1].published, false);
});

test("zoek-HTML met verzonnen titels geeft de juiste namen, soorten en organisatoren", () => {
  const soorten = zoekRijen(fixture("zoeken.html")).map((r) => soortVanTitel(r.title, r.organ));
  assert.deepEqual(soorten.map((s) => s && [s.soort, s.status, s.naam, s.organisator, s.plaats]), [
    ["evenement", "goedkeuring", "Scheldekaaienloop 2026", null, null],
    ["evenement", "goedkeuring", "Proefparade Zuid 2026", null, null],
    ["evenement", "goedkeuring", "Testfeest Deurne", null, null],
    ["evenement", "weigering", "Afgewezen Testfestival 2026", null, null],
    ["muziek", "goedkeuring", "Nachtelijke Testklanken", "Proefklank vzw", "Voorbeeldplein, 2000 Antwerpen"],
    // Een aanvrager zonder rechtsvorm komt er nooit in; het huisnummer ook niet.
    ["muziek", "goedkeuring", "Tuinfeest", null, "Proefstraat, 2018 Antwerpen"],
    ["districtsfonds", "goedkeuring", null, null, null],
    // Districtsfonds van een ander district, logistiek en een sponsorovereenkomst: geen evenementbesluit.
    null,
    null,
    null,
    ["evenement", "goedkeuring", "Deurne Proeft", null, null],
  ]);
});

test("titels: weigering, intrekking, programma van een district en een datum in de naam", () => {
  const cbs = "college van burgemeester en schepenen";
  assert.equal(soortVanTitel("2026_CBS_1 - Evenementen - Testdag 2026. Organisatie. Intrekking - Goedkeuring", cbs).status, "ingetrokken");
  assert.equal(soortVanTitel("2026_DCME_00160 - Halloween Proefrun 2026 - Programma - Goedkeuring", "districtscollege Merksem").naam, "Halloween Proefrun 2026");
  assert.equal(soortVanTitel("2026_CBS_1 - Evenementen - Organisatie en logistieke ondersteuning. Sint intrede. Zaterdag 14 november 2026 - Goedkeuring", cbs).naam, "Sint intrede");
  assert.equal(soortVanTitel("2026_CBS_1 - Ondersteuning. Evenementen. Testclub vzw - Proefdag 2026. Vastlegging nominatief krediet - Goedkeuring", cbs), null);
  assert.equal(soortVanTitel("2026_CBS_1 - Evenementen - Testdag 2026. Organisatie - Kennisneming", cbs), null);
  // Een rechtzetting van een muziektoelating, zonder aanhalingstekens rond de naam.
  const recht = soortVanTitel("2026_CBS_1 - Toelating muziekactiviteit - Rechtzetting materiële vergissing - Testklank bv, voor Proef - Avond, Meir 12-14, 2000 Antwerpen. Dossiernummer MUZA2026/1/EM - Goedkeuring", cbs);
  assert.deepEqual([recht.naam, recht.organisator, recht.plaats], ["Proef - Avond", "Testklank bv", "Meir, 2000 Antwerpen"]);
});

test("zoeken op een eigen venster hergebruikt searchKeyword en splitst per maand als het te veel is", async () => {
  const vensters = [];
  const row = (id) => `<a class="result-row" data-id="${id}" data-meeting-id="m-${id}" data-content-published="true"><p class="title">x</p><span class="date">01/09/2026 09:00</span></a>`;
  const fetchImpl = async (url) => {
    const u = new URL(String(url));
    const start = u.searchParams.get("meetingDateStart"), end = u.searchParams.get("meetingDateEnd");
    vensters.push(`${start}|${end}|${u.searchParams.get("page")}`);
    if (start === "2026-08-11" && end === "2027-02-07") return resp(`<span class="result-count">${EBESLUIT_MAX_PAGES * EBESLUIT_PAGE_SIZE + 1} resultaten gevonden</span>`);
    return resp(row(`r-${start}`));
  };
  const result = await searchKeyword(fetchImpl, "Evenementen", zoekVenster(TODAY), { retryDelayMs: 0, sleepImpl: noSleep, parseRows: zoekRijen });
  assert.equal(result.coverage.complete, true);
  assert.deepEqual(monthWindowsBetween("2026-08-11", "2027-02-07")[0], ["2026-08-11", "2026-08-31"]);
  assert.deepEqual(monthWindowsBetween("2026-08-11", "2027-02-07").at(-1), ["2027-02-01", "2027-02-07"]);
  assert.equal(result.rows.length, 7, "augustus tot en met februari");
  assert.equal(result.rows[0].zitting, "2026-09-01", "de eigen rijlezer gaat mee");
  assert.ok(vensters.every((v) => v.endsWith("|0")), "pagina's beginnen bij 0");
});

test("hoogstens 1 verzoek per seconde: de spreider wacht het verschil", async () => {
  let klok = 1_000;
  const wachten = [];
  const spreider = gespreideFetch(async () => resp("ok"), { intervalMs: 1_000, nu: () => klok, sleep: async (ms) => { wachten.push(ms); klok += ms; } });
  await spreider("https://ebesluit.antwerpen.be/a");
  klok += 300;
  await spreider("https://ebesluit.antwerpen.be/b");
  await spreider("https://ebesluit.antwerpen.be/c");
  assert.deepEqual(wachten, [700, 1_000]);
});

// ---------- lezen ----------

test("datums: één dag, reeksen, opsommingen, over de maandgrens en zonder jaartal", () => {
  assert.deepEqual(dagenUitTekst("op zondag 18 oktober 2026"), ["2026-10-18"]);
  assert.deepEqual(dagenUitTekst("zaterdag 3 en zondag 4 oktober 2026"), ["2026-10-03", "2026-10-04"]);
  assert.deepEqual(dagenUitTekst("van 3 tot en met 5 oktober 2026"), ["2026-10-03", "2026-10-04", "2026-10-05"]);
  assert.deepEqual(dagenUitTekst("31 oktober en 1 november 2026"), ["2026-10-31", "2026-11-01"]);
  assert.deepEqual(dagenUitTekst("van 30 december 2026 tot 2 januari 2027"), ["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  assert.deepEqual(dagenUitTekst("op 4 oktober", { jaar: 2026 }), ["2026-10-04"]);
  assert.deepEqual(dagenUitTekst("op 3 januari", { jaar: 2026, na: "2026-11-20" }), ["2027-01-03"], "een dag zonder jaartal valt niet vóór de zitting");
  assert.deepEqual(dagenUitTekst("zaterdag 14 november 2026 van 14 tot 18 uur"), ["2026-11-14"], "uren zijn geen dagen");
  assert.deepEqual(dagenUitTekst("31 februari 2026"), []);
});

test("uren: vaste zinnen, en nooit uit opbouw of afbouw", () => {
  assert.deepEqual(urenUitTekst("De wedstrijd vindt plaats op 20 september 2026 tussen 10.00 uur en 13.00 uur."), { start: "10:00", einde: "13:00" });
  assert.deepEqual(urenUitTekst("Op donderdag 24 september 2026 gaat het door op het plein, van 13.30 uur tot 23.00 uur."), { start: "13:30", einde: "23:00" });
  assert.deepEqual(urenUitTekst("De stoet vertrekt met kinderen en ouders om 14.00 uur aan het plein. Het einde is voorzien om 17.00 uur."), { start: "14:00", einde: "17:00" });
  assert.equal(urenUitTekst("De opbouw begint op 17 september 2026 om 08.00 uur en de afbraak eindigt om 20.00 uur."), null);
  assert.equal(urenUitTekst("Van 3 tot 5 oktober."), null, "een reeks dagen is geen uur");
});

test("opbouw en afbouw: met en zonder jaartal", () => {
  assert.deepEqual(opbouwAfbouw("De opbouw start op 12 oktober 2026 en de afbouw eindigt op 21 oktober 2026.", { eersteDag: "2026-10-18", laatsteDag: "2026-10-18" }), { opbouw: "2026-10-12", afbouw: "2026-10-21" });
  assert.deepEqual(opbouwAfbouw("De opbouw begint op 17 september 2026 om 08.00 uur en de afbraak is voorzien op 21 september en zal afgerond zijn om 20.00 uur.", { eersteDag: "2026-09-20", laatsteDag: "2026-09-20" }), { opbouw: "2026-09-17", afbouw: "2026-09-21" });
  assert.deepEqual(opbouwAfbouw("De opbouw start op 30 december en de afbouw eindigt op 3 januari.", { eersteDag: "2027-01-01", laatsteDag: "2027-01-01" }), { opbouw: "2026-12-30", afbouw: "2027-01-03" });
});

test("detailpagina: juiste dag, uren, plaats, opbouw en afbouw; de adviezen tellen niet", () => {
  const detail = leesDetail(fixture("evenement.html"), { soort: "evenement", zitting: "2026-09-25" });
  assert.deepEqual(detail.dagen, ["2026-11-08"]);
  assert.deepEqual(detail.uren, { start: "10:00", einde: "16:00" }, "niet 06.00 uur uit het advies over de brug");
  assert.deepEqual([detail.opbouw, detail.afbouw], ["2026-11-05", "2026-11-09"]);
  assert.equal(detail.organisator, "Testloop nv");
  assert.deepEqual(detail.plaatsKandidaten, ["Antwerpen", "Rijnkaai"]);
  assert.deepEqual(plaatsInDistrict("Rijnkaai", INDEX), { inDistrict: true, straten: ["Rijnkaai"], postcodes: ["2000"] });
});

test("muziekactiviteit: dag, uren tot na middernacht en de plaats van het evenement, niet het adres van de aanvrager", () => {
  const detail = leesDetail(fixture("muziek.html"), { soort: "muziek", zitting: "2026-10-02" });
  assert.deepEqual(detail.dagen, ["2026-11-07"]);
  assert.deepEqual(detail.uren, { start: "20:00", einde: "02:00" });
  assert.equal(detail.plaats, "Voorbeeldplein, 2000 Antwerpen");
});

test("plaats: huisnummers weg, district of niet", () => {
  assert.equal(plaatsZonderNummers("Noordersingel 28-30, 2140 Borgerhout"), "Noordersingel, 2140 Borgerhout");
  assert.equal(plaatsZonderNummers("Keistraat 5/7, 2000 Antwerpen"), "Keistraat, 2000 Antwerpen");
  assert.equal(plaatsZonderNummers("Leopold de Waelplaats zonder nummer (zn), 2000 Antwerpen"), "Leopold de Waelplaats, 2000 Antwerpen");
  assert.equal(plaatsInDistrict("Proefstraat, 2018 Antwerpen", INDEX).inDistrict, true);
  assert.equal(plaatsInDistrict("Vosplein, 2140 Borgerhout", INDEX).inDistrict, false);
  assert.equal(plaatsInDistrict("Spoor Oost", INDEX).inDistrict, false);
  assert.equal(plaatsInDistrict("verschillende locaties in de binnenstad", INDEX).inDistrict, true);
  assert.equal(plaatsInDistrict("Kastanjedreef", INDEX).postcodes[0], "2050");
  assert.equal(plaatsInDistrict("Antwerpen", INDEX).inDistrict, null, "alleen de stad zegt niets");
  assert.equal(plaatsInDistrict("Linkeroever", INDEX).inDistrict, true);
});

test("privacy: het blok Samenstelling, een persoonsnaam, een IBAN en adressen raken nooit de uitvoer", () => {
  const delen = detailDelen(fixture("districtsfonds.html"));
  assert.ok(!JSON.stringify(delen).includes("Testpersoon"), "Samenstelling is weggeknipt vóór het lezen");
  const detail = leesDetail(fixture("districtsfonds.html"), { soort: "districtsfonds", zitting: "2026-10-05" });
  assert.deepEqual([detail.naam, detail.organisator, detail.dagen, detail.plaats], ["Buurtfeest Proefstraat", null, ["2026-11-14"], "Proefstraat, 2018 Antwerpen"]);
  assert.deepEqual(detail.uren, { start: "14:00", einde: "18:00" });
  const tekst = JSON.stringify(detail);
  for (const verboden of ["Piet", "Proefpersoon", "Testpersoon", "Verzonnen", "Proefnaam", "BE00", "1234 5678", "Proefstraat 7", "0470", "EUR"]) {
    assert.ok(!tekst.includes(verboden), `${verboden} mag niet in de uitvoer`);
  }
});

test("validatie van evenement-besluiten.json: huisnummer, organisator zonder rechtsvorm, IBAN en onbekende sleutel", () => {
  const goed = {
    id: "26.0901.0001.0001", code: "2026_CBS_09001", soort: "evenement", status: "goedkeuring", orgaan: "college van burgemeester en schepenen",
    zitting: "2026-09-25", gepubliceerd: true, gelezen: true, naam: "Scheldekaaienloop 2026", organisator: "Testloop nv", dagen: ["2026-11-08"],
    uren: { start: "10:00", einde: "16:00" }, plaats: "Rijnkaai", straten: ["Rijnkaai"], postcodes: ["2000"], inDistrict: true,
    opbouw: "2026-11-05", afbouw: "2026-11-09", bron: "https://ebesluit.antwerpen.be/zittingen/25.0901.0000.0001/agendapunten/26.0901.0001.0001",
  };
  const doc = (b) => ({ schemaVersion: 1, bron: "https://ebesluit.antwerpen.be/", methode: "x", leesversie: 1, generatedAt: NOW.toISOString(), venster: { van: "2026-08-11", tot: "2027-02-07" }, zoektermen: [], samenvatting: {}, besluiten: [b] });
  assert.deepEqual(validateEvenementBesluiten(doc(goed)), []);
  assert.ok(validateEvenementBesluiten(doc({ ...goed, plaats: "Rijnkaai 12" })).some((e) => /huisnummer/.test(e)));
  assert.ok(validateEvenementBesluiten(doc({ ...goed, organisator: "Piet Proefpersoon" })).some((e) => /rechtsvorm/.test(e)));
  assert.ok(validateEvenementBesluiten(doc({ ...goed, naam: "Rekening BE00 1234 5678 9012" })).some((e) => /privacy: iban/.test(e)));
  assert.ok(validateEvenementBesluiten(doc({ ...goed, aanvrager: "x" })).some((e) => /onbekende sleutel aanvrager/.test(e)));
});

// ---------- bron en agendapunten ----------

test("fetcher: schrijft het besluitenbestand en agendapunten met een plaats in het district", async () => {
  const root = makeRoot();
  const calls = [];
  const [status] = await runOnce(root, nepEbesluit({ calls }));
  assert.deepEqual([status.sourceId, status.fetchStatus, status.errorCode], [SOURCE_ID, "ok", null]);

  const besluiten = readJson(root, EVENEMENT_BESLUITEN_FILE);
  assert.deepEqual(validateEvenementBesluiten(besluiten), []);
  const perCode = Object.fromEntries(besluiten.besluiten.map((b) => [b.code, b]));
  assert.deepEqual(Object.keys(perCode).sort(), ["2026_CBS_09001", "2026_CBS_09002", "2026_CBS_09004", "2026_CBS_09005", "2026_CBS_09006", "2026_DCAN_09007", "2026_DCDE_09003", "2026_DCDE_09011"]);
  const loop = perCode["2026_CBS_09001"];
  assert.deepEqual([loop.naam, loop.dagen, loop.uren, loop.plaats, loop.inDistrict, loop.opbouw, loop.afbouw, loop.organisator], ["Scheldekaaienloop 2026", ["2026-11-08"], { start: "10:00", einde: "16:00" }, "Rijnkaai", true, "2026-11-05", "2026-11-09", "Testloop nv"]);
  // Niet gepubliceerd: alleen titel en zitting. Een ander district of een weigering: geen detailpagina.
  assert.deepEqual([perCode["2026_CBS_09002"].gelezen, perCode["2026_CBS_09002"].naam, perCode["2026_CBS_09002"].zitting], [false, "Proefparade Zuid 2026", "2026-09-25"]);
  assert.equal(perCode["2026_DCDE_09003"].inDistrict, false);
  const opgehaald = calls.filter((u) => u.pathname !== "/zoeken").map((u) => u.pathname.split("/").pop()).sort();
  assert.deepEqual(opgehaald, ["26.0901.0001.0001", "26.0901.0005.0005", "26.0901.0006.0006", "26.0901.0007.0007"]);
  assert.deepEqual([...new Set(calls.filter((u) => u.pathname === "/zoeken").map((u) => u.searchParams.get("query")))], EVENEMENT_ZOEKTERMEN);

  const document = readJson(root, `${SOURCE_ID}.json`);
  assert.deepEqual(validateSourceDocument(document, { expectedSourceId: SOURCE_ID }), []);
  assert.deepEqual(document.items.map((i) => [i.title, i.date, i.timeSlot, i.timeText, i.location, i.theme]), [
    ["Nachtelijke Testklanken", "2026-11-07", "20:00", "vanaf 20.00 uur", "Voorbeeldplein, 2000 Antwerpen", "Activiteit"],
    ["Scheldekaaienloop 2026", "2026-11-08", "10:00", "10.00 tot 16.00 uur", "Rijnkaai, 2000 Antwerpen", "Sport"],
    ["Buurtfeest Proefstraat", "2026-11-14", "14:00", "14.00 tot 18.00 uur", "Proefstraat, 2018 Antwerpen", "Activiteit"],
  ], "geen agendapunt voor het tuinfeest van een privépersoon, de weigering of het andere district");
  const loopItem = document.items[1];
  assert.equal(loopItem.id, "ebesluit-ev-2026-cbs-09001-2026-11-08");
  assert.equal(loopItem.info, "Goedgekeurd door het college van burgemeester en schepenen (zitting van 25 september). Organisatie: Testloop nv. Opbouw vanaf 5 november, afbouw tot 9 november.");
  assert.match(document.items[0].info, /Einde om 02\.00 uur 's nachts\./);
  assert.ok(document.items.every((i) => i.inDistrict === true && i.sourceUrl.startsWith("https://ebesluit.antwerpen.be/zittingen/")));

  // De privacy-fixture: niets van de aanvrager, de Samenstelling of de betaaltabel in de bestanden.
  const alles = JSON.stringify([besluiten, document]);
  for (const verboden of ["Piet", "Proefpersoon", "Testpersoon", "Verzonnen", "Proefnaam", "BE00", "0123.456.789", "0987.654.321", "Proefstraat 7", "Proefstraat 12", "Proefstraat 99", "@"]) {
    assert.ok(!alles.includes(verboden), `${verboden} mag niet in de uitvoer`);
  }
});

test("cache: een tweede verversing haalt geen gelezen detailpagina opnieuw op", async () => {
  const root = makeRoot();
  await runOnce(root, nepEbesluit());
  const calls = [];
  await runOnce(root, nepEbesluit({ calls }));
  assert.deepEqual(calls.filter((u) => u.pathname !== "/zoeken"), [], "alleen de zoekpagina's");
  assert.equal(readJson(root, `${SOURCE_ID}.json`).items.length, 3);
});

test("een kapotte detailpagina houdt de rest niet tegen en komt de volgende keer opnieuw aan de beurt", async () => {
  const root = makeRoot();
  const [status] = await runOnce(root, nepEbesluit({ kapot: new Set(["26.0901.0001.0001"]) }));
  assert.equal(status.fetchStatus, "ok");
  const eerst = readJson(root, EVENEMENT_BESLUITEN_FILE);
  assert.equal(eerst.besluiten.find((b) => b.code === "2026_CBS_09001").gelezen, false);
  assert.equal(eerst.samenvatting.teLezen, 1);
  assert.equal(readJson(root, `${SOURCE_ID}.json`).items.length, 2);
  const calls = [];
  await runOnce(root, nepEbesluit({ calls }));
  assert.deepEqual(calls.filter((u) => u.pathname !== "/zoeken").map((u) => u.pathname.split("/").pop()), ["26.0901.0001.0001"]);
  assert.equal(readJson(root, `${SOURCE_ID}.json`).items.length, 3);
});

test("hoogstens N detailpagina's per verversing; de rest volgt later", async () => {
  const result = await ontdekEvenementBesluiten({ fetch: nepEbesluit(), today: TODAY, straten: STRATEN, sleep: noSleep, maxDetails: 2 });
  assert.equal(result.gelezen, 2);
  assert.equal(result.teLezen, 2);
});

test("een fout bij het zoeken laat beide bestanden staan en meldt error", async () => {
  const root = makeRoot();
  await runOnce(root, nepEbesluit());
  const voor = [EVENEMENT_BESLUITEN_FILE, `${SOURCE_ID}.json`].map((n) => fs.readFileSync(path.join(root, "site", "sources", n), "utf8"));
  const [status] = await runOnce(root, nepEbesluit({ zoekStatus: 500 }), { clock: () => new Date("2026-10-11T04:00:00Z") });
  assert.deepEqual([status.fetchStatus, status.errorCode, status.itemCount], ["error", "http_500", 3]);
  assert.equal(fs.readFileSync(path.join(root, "site", "sources", EVENEMENT_BESLUITEN_FILE), "utf8"), voor[0]);
  assert.equal(readJson(root, `${SOURCE_ID}.json`).fetchStatus, "error");
  assert.deepEqual(readJson(root, `${SOURCE_ID}.json`).items, JSON.parse(voor[1]).items);
});

test("agendapunten: alleen wat nog komt; uitzondering en toekenning over hetzelfde feest worden één punt", () => {
  const basis = { soort: "districtsfonds", status: "goedkeuring", orgaan: "districtscollege Antwerpen", gepubliceerd: true, gelezen: true, naam: "Heropening Proefstraat", organisator: "Proefwinkels vzw", uren: null, straten: ["Proefstraat"], postcodes: ["2018"], inDistrict: true, opbouw: null, afbouw: null };
  const besluiten = [
    { ...basis, id: "1.1", code: "2026_DCAN_00001", zitting: "2026-09-14", dagen: ["2026-10-17"], plaats: "Proefstraat en Lange Proefstraat, 2018 Antwerpen", bron: "https://ebesluit.antwerpen.be/zittingen/1/agendapunten/1.1" },
    { ...basis, id: "1.2", code: "2026_DCAN_00002", zitting: "2026-10-05", dagen: ["2026-10-17"], plaats: "Proefstraat, 2018 Antwerpen", bron: "https://ebesluit.antwerpen.be/zittingen/1/agendapunten/1.2" },
    { ...basis, id: "1.3", code: "2026_DCAN_00003", zitting: "2026-08-01", naam: "Voorbij Feest", dagen: ["2026-10-01"], plaats: "Meir", bron: "https://ebesluit.antwerpen.be/zittingen/1/agendapunten/1.3" },
    { ...basis, id: "1.4", code: "2026_DCAN_00004", zitting: "2026-08-01", naam: "Twee Weekends", dagen: ["2026-10-10", "2026-10-11", "2026-10-17"], plaats: "Meir", bron: "https://ebesluit.antwerpen.be/zittingen/1/agendapunten/1.4" },
  ];
  const items = agendapuntenUitBesluiten(besluiten, { today: TODAY, retrievedAt: NOW.toISOString() });
  assert.deepEqual(items.map((i) => [i.externalId, i.date, i.endDate, i.location]), [
    ["2026_DCAN_00002", "2026-10-17", null, "Proefstraat, 2018 Antwerpen"],
    ["2026_DCAN_00004", "2026-10-10", "2026-10-11", "Meir, 2018 Antwerpen"],
    ["2026_DCAN_00004", "2026-10-17", null, "Meir, 2018 Antwerpen"],
  ]);
});

test("register en bouw: de bron draait als laatste en het besluitenbestand is geen agendabron", async () => {
  assert.equal(FETCHERS.at(-1).name, SOURCE_ID);
  const root = makeRoot();
  await runOnce(root, nepEbesluit());
  const { documents } = readSources(root);
  assert.deepEqual(documents.map((d) => d.sourceId), [SOURCE_ID]);
});
