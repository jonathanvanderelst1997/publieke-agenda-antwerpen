// eBesluit als naamgever en bron (pakket P3, zoek- en leesdeel). Alle fixtures zijn verzonnen
// (tests/fixtures/ebesluit-evenementen). De klok staat vast: geen toets hangt af van de echte datum.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { EBESLUIT_MAX_PAGES, EBESLUIT_PAGE_SIZE, monthWindowsBetween, searchKeyword } from "../lib/ebesluit-discovery.mjs";
import * as ev from "../lib/ebesluit-evenementen.mjs";
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
  ["6", "Groenplaats", "2000", [], [4.4, 51.21, 4.41, 51.22]],
];
const INDEX = straatIndex(STRATEN);
const resp = (text, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => text });
const DETAILS = {
  "26.0901.0001.0001": "evenement.html",
  "26.0901.0005.0005": "muziek.html",
  "26.0901.0006.0006": "tuinfeest.html",
  "26.0901.0007.0007": "districtsfonds.html",
};

// Nep-eBesluit: "Evenementen" geeft de verzonnen zoekpagina (plus extraRijen), de andere termen niets.
// extraDetails: { id: fixturenaam } bovenop DETAILS.
function nepEbesluit({ calls = [], kapot = new Set(), zoekStatus = 200, extraRijen = "", extraDetails = {} } = {}) {
  return async (url) => {
    const u = new URL(String(url));
    calls.push(u);
    if (u.pathname === "/zoeken") {
      if (zoekStatus !== 200) return resp("", zoekStatus);
      return resp(u.searchParams.get("query") === "Evenementen" ? fixture("zoeken.html").replace(/<\/div>\s*$/, `${extraRijen}</div>\n`) : '<span class="result-count">0 resultaten gevonden</span>');
    }
    const id = u.pathname.split("/").pop();
    if (kapot.has(id)) return resp("", 404);
    const naam = extraDetails[id] ?? DETAILS[id];
    return naam ? resp(fixture(naam)) : resp("", 404);
  };
}
// Een verzonnen zoekrij in de opmaak van eBesluit.
const zoekRij = ({ id, titel, orgaan = "college van burgemeester en schepenen", zitting = "02/10/2026", gepubliceerd = true }) =>
  `<a href="#" class="result-row" data-type="MEETING_ITEM" data-id="${id}" data-meeting-id="25.0901.0000.0099" data-content-published="${gepubliceerd}"><p class="title">${titel}</p><p class="metadata"><span class="date">${zitting} 09:30</span><span class="organ">${orgaan}</span></p></a>`;

function makeRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ebesluit-evenementen-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
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
  assert.deepEqual(urenUitTekst("De deuren openen om 14.00 uur en het einde is voorzien om 23.30 uur. De meeste bezoekers komen tussen 19.00 uur en 20.00 uur."), { start: "14:00", einde: "23:30" }, "een publiekspiek is geen openingsuur");
  assert.deepEqual(urenUitTekst("Het evenement loopt van 10.00 uur tot 18.00 uur."), { start: "10:00", einde: "18:00" });
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
  const detail = leesDetail(fixture("districtsfonds.html"), { soort: "districtsfonds", zitting: "2026-10-05", index: INDEX });
  assert.deepEqual([detail.naam, detail.organisator, detail.dagen, detail.plaats], ["Buurtfeest Proefstraat", null, ["2026-11-14"], "Proefstraat, 2018 Antwerpen"]);
  assert.deepEqual(detail.uren, { start: "14:00", einde: "18:00" });
  const tekst = JSON.stringify(detail);
  for (const verboden of ["Piet", "Proefpersoon", "Testpersoon", "Verzonnen", "Proefnaam", "BE00", "1234 5678", "Proefstraat 7", "0470", "EUR"]) {
    assert.ok(!tekst.includes(verboden), `${verboden} mag niet in de uitvoer`);
  }
});

test("privacy: een lijst locaties met ontwerpers en hun adres geeft alleen straten en postcodes", () => {
  const detail = leesDetail(fixture("districtsfonds-locaties.html"), { soort: "districtsfonds", zitting: "2026-08-24", index: INDEX });
  assert.equal(detail.organisator, "Atelier Créatif Proef vzw", "HTML-entiteiten worden gewone letters");
  assert.equal(detail.naam, "Proefweek Juwelen 2026");
  assert.deepEqual(detail.dagen, ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]);
  assert.equal(detail.plaats, "Meir, Proefstraat, Rijnkaai, Voorbeeldplein, 2000 en 2018 Antwerpen");
  assert.deepEqual(detail.straten, ["Meir", "Proefstraat", "Rijnkaai", "Voorbeeldplein"]);
  const tekst = JSON.stringify(detail);
  for (const verboden of ["Gerda", "Verzonnen", "Lotte", "Fictief", "Proefhuis", "Proefgalerie", "Testschool", "51", "87", "GEHUURDE", ")"]) {
    assert.ok(!tekst.includes(verboden), `${verboden} mag niet in de uitvoer`);
  }
});

test("meerdaags evenement: 'van 11 tot 13 december' in Artikel 1, uren uit de programmaregel, opbouw en afbouw", () => {
  const detail = leesDetail(fixture("meerdaags.html"), { soort: "evenement", zitting: "2026-11-20", index: INDEX });
  assert.deepEqual(detail.dagen, ["2026-12-11", "2026-12-12", "2026-12-13"]);
  assert.equal(detail.organisator, "Proefsport nv");
  assert.equal(detail.plaats, "Groenplaats, Handschoenmarkt en Grote Markt");
  assert.deepEqual(detail.uren, { start: "12:00", einde: "22:00" });
  assert.deepEqual([detail.opbouw, detail.afbouw], ["2026-12-05", "2026-12-18"]);
});

test("Artikel 1: een plaats vóór de dag telt pas als laatste kandidaat; een naam met 'in' wordt geen plaats", () => {
  const html = (zin) => `<h2>Besluit</h2><h3>Artikel 1</h3><div><p>${zin}</p></div>`;
  const voor = leesDetail(html("Het college keurt de organisatie door Proefmuziek VZW, van het evenement Proefconcert in Merksem op 9 december 2026 goed."), { soort: "evenement", zitting: "2026-11-20", index: INDEX });
  assert.deepEqual([voor.organisator, voor.plaats, voor.dagen], ["Proefmuziek VZW", "Merksem", ["2026-12-09"]]);
  assert.equal(plaatsInDistrict(voor.plaats, INDEX).inDistrict, false);
  const naamMetIn = leesDetail(html("Het college keurt de organisatie door Proefstad nv van het evenement Kerst in de Stad op 12 december 2026 op de Groenplaats goed."), { soort: "evenement", zitting: "2026-11-20", index: INDEX });
  assert.deepEqual(naamMetIn.plaatsKandidaten, ["Groenplaats", "Stad"]);
  assert.equal(naamMetIn.plaats, "Groenplaats");
});

test("validatie van evenement-besluiten.json: huisnummer, organisator zonder rechtsvorm, IBAN en onbekende sleutel", () => {
  const goed = {
    id: "26.0901.0001.0001", code: "2026_CBS_09001", soort: "evenement", status: "goedkeuring", orgaan: "college van burgemeester en schepenen",
    zitting: "2026-09-25", gepubliceerd: true, gelezen: true, naam: "Scheldekaaienloop 2026", organisator: "Testloop nv", dagen: ["2026-11-08"],
    uren: { start: "10:00", einde: "16:00" }, plaats: "Rijnkaai", straten: ["Rijnkaai"], postcodes: ["2000"], inDistrict: true,
    opbouw: "2026-11-05", afbouw: "2026-11-09", wijziging: null, vervangt: [], bron: "https://ebesluit.antwerpen.be/zittingen/25.0901.0000.0001/agendapunten/26.0901.0001.0001",
  };
  const doc = (b) => ({ schemaVersion: 1, bron: "https://ebesluit.antwerpen.be/", methode: "x", leesversie: 1, generatedAt: NOW.toISOString(), venster: { van: "2026-08-11", tot: "2027-02-07" }, zoektermen: [], samenvatting: {}, besluiten: [b] });
  assert.deepEqual(validateEvenementBesluiten(doc(goed)), []);
  assert.ok(validateEvenementBesluiten(doc({ ...goed, plaats: "Rijnkaai 12" })).some((e) => /huisnummer/.test(e)));
  assert.ok(validateEvenementBesluiten(doc({ ...goed, organisator: "Piet Proefpersoon" })).some((e) => /rechtsvorm/.test(e)));
  assert.ok(validateEvenementBesluiten(doc({ ...goed, naam: "Rekening BE00 1234 5678 9012" })).some((e) => /privacy: iban/.test(e)));
  assert.ok(validateEvenementBesluiten(doc({ ...goed, aanvrager: "x" })).some((e) => /onbekende sleutel aanvrager/.test(e)));
});

// ---------- bron en agendapunten ----------

test("fetcher: schrijft het besluitenbestand en agendapunten met een plaats in het district", async (t) => {
  const root = makeRoot(t);
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

test("cache: een tweede verversing haalt geen gelezen detailpagina opnieuw op", async (t) => {
  const root = makeRoot(t);
  await runOnce(root, nepEbesluit());
  const calls = [];
  await runOnce(root, nepEbesluit({ calls }));
  assert.deepEqual(calls.filter((u) => u.pathname !== "/zoeken"), [], "alleen de zoekpagina's");
  assert.equal(readJson(root, `${SOURCE_ID}.json`).items.length, 3);
});

test("een kapotte detailpagina houdt de rest niet tegen en komt de volgende keer opnieuw aan de beurt", async (t) => {
  const root = makeRoot(t);
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

test("een fout bij het zoeken laat beide bestanden staan en meldt error", async (t) => {
  const root = makeRoot(t);
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

test("register en bouw: de bron draait als laatste en het besluitenbestand is geen agendabron", async (t) => {
  assert.equal(FETCHERS.at(-1).name, SOURCE_ID);
  const root = makeRoot(t);
  await runOnce(root, nepEbesluit());
  const { documents } = readSources(root);
  assert.deepEqual(documents.map((d) => d.sourceId), [SOURCE_ID]);
});

// ---------- herstellingen na de nakijkronde (B1 tot B5) ----------

const CBS = "college van burgemeester en schepenen";
const besluit = (extra) => ({
  id: "26.1.1", code: "2026_CBS_09105", soort: "muziek", status: "goedkeuring", orgaan: CBS, zitting: "2026-09-25", gepubliceerd: true, gelezen: true,
  naam: "Proefzomer Waterspel", organisator: "Proefzomer vzw", dagen: ["2026-11-07"], uren: null, plaats: "Rijnkaai, 2000 Antwerpen", straten: ["Rijnkaai"],
  postcodes: ["2000"], inDistrict: true, opbouw: null, afbouw: null, wijziging: null, vervangt: [], bron: "https://ebesluit.antwerpen.be/zittingen/1/agendapunten/26.1.1", ...extra,
});
const punten = (besluiten) => agendapuntenUitBesluiten(besluiten, { today: TODAY, retrievedAt: NOW.toISOString() }).map((i) => [i.externalId, i.date, i.endDate]);

test("B1: een muziektitel zonder postcode zet het adres niet in de naam", () => {
  const titel = (rest) => `2026_CBS_1 - Toelating muziekactiviteit - Proefklank vzw, voor ${rest}. Dossiernummer MUZA2026/1/EM - Goedkeuring`;
  const tuin = soortVanTitel(titel("Tuinfeest, Proefstraat 12. District Antwerpen"), CBS);
  assert.deepEqual([tuin.naam, tuin.plaats], ["Tuinfeest", "Proefstraat, District Antwerpen"]);
  assert.equal(plaatsInDistrict(tuin.plaats, INDEX).inDistrict, true);
  const elders = soortVanTitel(titel("Proefstress, Proeflaan 1. District Hoboken"), CBS);
  assert.deepEqual([elders.naam, elders.plaats], ["Proefstress", "Proeflaan, District Hoboken"]);
  assert.equal(plaatsInDistrict(elders.plaats, INDEX).inDistrict, false);
  const park = soortVanTitel(titel("Proeffeesten 2026, Rijnkaai zonder nummer (zn), Antwerpen"), CBS);
  assert.deepEqual([park.naam, park.plaats], ["Proeffeesten 2026", "Rijnkaai, Antwerpen"]);
  // Een huisnummer ná een straatwoord valt weg; jaartallen, dagen en gewone getallen blijven.
  assert.equal(ev.naamZonderAdres?.("Buurtfeest Proefstraat 12"), "Buurtfeest Proefstraat");
  assert.equal(ev.naamZonderAdres?.("Feest, Kleine Proefberg 22"), "Feest");
  for (const naam of ["Feesten in het Proefpark 2026", "Kiesweek. Proefplein 1 april 2026", "Zone 5", "Proef 10 Miles", "Kampioenschap 3x3 2026"]) {
    assert.equal(ev.naamZonderAdres?.(naam), naam, naam);
  }
});

test("B1: de validatie weigert ook een huisnummer in de naam", () => {
  const doc = (b) => ({ schemaVersion: 1, bron: "https://ebesluit.antwerpen.be/", methode: "x", leesversie: 2, generatedAt: NOW.toISOString(), venster: { van: "2026-08-11", tot: "2027-02-07" }, zoektermen: [], samenvatting: {}, besluiten: [b] });
  assert.ok(validateEvenementBesluiten(doc(besluit({ naam: "Tuinfeest, Proefstraat 12. District Antwerpen" }))).some((e) => /naam met huisnummer/.test(e)));
  assert.deepEqual(validateEvenementBesluiten(doc(besluit({ naam: "Proefpark 2026" }))), []);
});

test("B1: de fetcher schrijft nooit een huisnummer uit een muziektitel", async (t) => {
  const root = makeRoot(t);
  const extraRijen = zoekRij({ id: "26.0901.0101.0101", titel: "2026_CBS_09101 - Toelating muziekactiviteit - Proefklank vzw, voor Tuinfeest, Proefstraat 12. District Antwerpen. Dossiernummer MUZA2026/997/EM - Goedkeuring", gepubliceerd: false });
  const [status] = await runOnce(root, nepEbesluit({ extraRijen }));
  assert.equal(status.fetchStatus, "ok");
  const besluiten = readJson(root, EVENEMENT_BESLUITEN_FILE);
  const tuin = besluiten.besluiten.find((b) => b.code === "2026_CBS_09101");
  assert.deepEqual([tuin.naam, tuin.plaats, tuin.inDistrict], ["Tuinfeest", "Proefstraat, District Antwerpen", true]);
  assert.ok(!JSON.stringify(besluiten).includes("Proefstraat 12"));
});

test("B2: één besluit met een @ legt de bron niet stil", async (t) => {
  const root = makeRoot(t);
  await runOnce(root, nepEbesluit());
  const extraRijen = zoekRij({ id: "26.0901.0102.0102", titel: "2026_CBS_09102 - Evenementen - Cirque@proef 2026. Organisatie - Goedkeuring", gepubliceerd: false });
  const [status] = await runOnce(root, nepEbesluit({ extraRijen }), { clock: () => new Date("2026-10-11T04:00:00Z") });
  assert.deepEqual([status.fetchStatus, status.errorCode, status.itemCount], ["ok", null, 3]);
  const besluiten = readJson(root, EVENEMENT_BESLUITEN_FILE);
  assert.equal(besluiten.generatedAt, "2026-10-11T04:00:00.000Z", "het bestand is opnieuw geschreven");
  assert.equal(besluiten.besluiten.find((b) => b.code === "2026_CBS_09102").naam, "Cirqueatproef 2026");
  assert.ok(!JSON.stringify(besluiten).includes("@"));
});

test("B2: een straat van het district met een cijfer is geen huisnummer", () => {
  const index = straatIndex([...STRATEN, ["7", "De 7 Proefpad", "2050", [], [4.37, 51.22, 4.38, 51.23]], ["8", "4 Proefmaandpad", "2020", [], [4.39, 51.18, 4.4, 51.19]]]);
  const plaats = ev.plaatsUitStraten("De 7 Proefpad 3 en 4 Proefmaandpad, bij Piet Proefpersoon", index);
  assert.equal(plaats, "4 Proefmaandpad, De 7 Proefpad");
  const doc = (b) => ({ schemaVersion: 1, bron: "https://ebesluit.antwerpen.be/", methode: "x", leesversie: 2, generatedAt: NOW.toISOString(), venster: { van: "2026-08-11", tot: "2027-02-07" }, zoektermen: [], samenvatting: {}, besluiten: [b] });
  assert.deepEqual(validateEvenementBesluiten(doc(besluit({ soort: "districtsfonds", plaats, straten: ["4 Proefmaandpad", "De 7 Proefpad"] }))), []);
  assert.ok(validateEvenementBesluiten(doc(besluit({ soort: "districtsfonds", plaats: "De 7 Proefpad 3", straten: ["De 7 Proefpad"] }))).some((e) => /plaats met huisnummer/.test(e)), "een echt huisnummer blijft verboden");
});

test("B2: een ongeldig besluit wordt opgekuist of valt weg, de rest blijft", () => {
  const { besluiten, opgekuist, weggelaten } = ev.bruikbareBesluiten?.([
    besluit({ id: "26.1.1" }),
    besluit({ id: "26.1.2", organisator: "Piet Proefpersoon" }),
    besluit({ id: "26.1.3", dagen: ["2026-02-31"] }),
    besluit({ id: "26.1.1" }),
  ]) ?? {};
  assert.deepEqual([besluiten?.map((b) => b.id), opgekuist, weggelaten], [["26.1.1", "26.1.2"], 1, 2]);
  assert.deepEqual([besluiten[1].naam, besluiten[1].organisator, besluiten[1].plaats, besluiten[1].gelezen], [null, null, null, true], "blijft in de cache, wordt geen agendapunt");
});

test("B2: een ongeldig besluit in het vorige bestand gooit de cache niet weg", async (t) => {
  const root = makeRoot(t);
  await runOnce(root, nepEbesluit());
  const file = path.join(root, "site", "sources", EVENEMENT_BESLUITEN_FILE);
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  doc.besluiten.find((b) => b.code === "2026_CBS_09006").organisator = "Jan Verzonnen";
  fs.writeFileSync(file, JSON.stringify(doc));
  const calls = [];
  const [status] = await runOnce(root, nepEbesluit({ calls }));
  assert.equal(status.fetchStatus, "ok");
  assert.deepEqual(calls.filter((u) => u.pathname !== "/zoeken"), [], "geen enkele detailpagina opnieuw");
});

test("B3: een 'Aanpassing data' leest 'zal doorgaan van … tot en met …' en noemt het oude besluit", () => {
  const detail = leesDetail(fixture("aanpassing-data.html"), { soort: "muziek", zitting: "2026-10-02", index: INDEX, code: "2026_CBS_09106", wijziging: true });
  assert.deepEqual(detail.dagen, ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26"], "de nieuwe dagen, niet 7 november");
  assert.deepEqual(detail.uren, { start: "16:00", einde: "17:00" });
  assert.equal(detail.plaats, "Rijnkaai, 2000 Antwerpen");
  assert.deepEqual(detail.vervangt, ["2026_CBS_09105"]);
  assert.ok(!JSON.stringify(detail).includes("Proefstraat 99") && !JSON.stringify(detail).includes("0123.456.789"));
  const muziekTitel = (wat) => `2026_CBS_09106 - Toelating muziekactiviteit - ${wat} - Proefzomer vzw, voor Proefzomer Waterspel, Rijnkaai zonder nummer (zn), 2000 Antwerpen. Dossiernummer MUZA2026/990/EM - Goedkeuring`;
  assert.equal(soortVanTitel(muziekTitel("Aanpassing data"), CBS).wijziging, "data");
  assert.equal(soortVanTitel(muziekTitel("Rechtzetting materiële vergissing"), CBS).wijziging, "andere");
  assert.equal(soortVanTitel("2026_CBS_09105 - Toelating muziekactiviteit - Proefzomer vzw, voor Proefzomer Waterspel, Rijnkaai zonder nummer (zn), 2000 Antwerpen. Dossiernummer MUZA2026/990/EM - Goedkeuring", CBS).wijziging, null);
});

test("B3: een jongere datumaanpassing over dezelfde naam en plaats vervangt het oude, ook zonder dagen", () => {
  const oud = besluit({ id: "26.1.1", code: "2026_CBS_09105", zitting: "2026-09-25", dagen: ["2026-11-07"] });
  const zonderDagen = besluit({ id: "26.1.2", code: "2026_CBS_09106", zitting: "2026-10-02", dagen: [], wijziging: "data" });
  assert.deepEqual(punten([oud, zonderDagen]), [], "liever niets dan de oude dag");
  const metDagen = besluit({ id: "26.1.2", code: "2026_CBS_09106", zitting: "2026-10-02", dagen: ["2026-11-23", "2026-11-24"], wijziging: "data" });
  assert.deepEqual(punten([oud, metDagen]), [["2026_CBS_09106", "2026-11-23", "2026-11-24"]]);
  // Via `vervangt`, ook als de plaats anders geschreven is; een weigering vervangt niets.
  const anders = besluit({ id: "26.1.3", code: "2026_CBS_09107", zitting: "2026-10-02", plaats: "Rijnkaai", dagen: [], wijziging: "data", vervangt: ["2026_CBS_09105"] });
  assert.deepEqual(punten([oud, anders]), []);
  assert.deepEqual(punten([oud, { ...zonderDagen, status: "weigering" }]), [["2026_CBS_09105", "2026-11-07", null]]);
  // Een rechtzetting van iets anders (het geluidsniveau) zonder dagen laat de oude dag staan.
  const geluid = besluit({ id: "26.1.4", code: "2026_CBS_09108", zitting: "2026-10-02", dagen: [], wijziging: "andere", vervangt: ["2026_CBS_09105"] });
  assert.deepEqual(punten([oud, geluid]), [["2026_CBS_09105", "2026-11-07", null]]);
});

test("B4: 'Intrekking - Bekrachtiging' wordt herkend en schrapt wat ze intrekt", async (t) => {
  const dcan = "districtscollege Antwerpen";
  const intrekking = soortVanTitel("2026_DCAN_09108 - Ondersteuning. Districtsfonds: beleef je buurt! - Buurtfeest Proefstraat. Toekenning en uitbetaling. Intrekking - Bekrachtiging", dcan);
  assert.deepEqual(intrekking && [intrekking.soort, intrekking.status], ["districtsfonds", "ingetrokken"]);
  assert.deepEqual(soortVanTitel("2026_DRAN_1 - Evenementen - Proefdag 2026 - Bekrachtiging", "districtsraad Antwerpen") && soortVanTitel("2026_DRAN_1 - Evenementen - Proefdag 2026 - Bekrachtiging", "districtsraad Antwerpen").status, "goedkeuring");
  assert.equal(soortVanTitel("2026_CBS_1 - Evenementen - Testdag 2026. Organisatie. Intrekking - Goedkeuring", CBS).naam, "Testdag 2026");

  const detail = leesDetail(fixture("intrekking.html"), { soort: "districtsfonds", zitting: "2026-10-08", index: INDEX, code: "2026_DCAN_09108", wijziging: true });
  assert.deepEqual([detail.naam, detail.vervangt], ["Buurtfeest Proefstraat", ["2026_DCAN_09007"]], "niet de 151 uit de aanleiding");

  // Van zoekrij tot agenda: de intrekking wordt gelezen en het buurtfeest verdwijnt.
  const root = makeRoot(t);
  const extraRijen = zoekRij({ id: "26.0901.0108.0108", titel: "2026_DCAN_09108 - Ondersteuning. Districtsfonds: beleef je buurt! - Buurtfeest Proefstraat. Toekenning en uitbetaling. Intrekking - Bekrachtiging", orgaan: dcan, zitting: "08/10/2026" });
  await runOnce(root, nepEbesluit({ extraRijen, extraDetails: { "26.0901.0108.0108": "intrekking.html" } }));
  const besluiten = readJson(root, EVENEMENT_BESLUITEN_FILE);
  assert.deepEqual(besluiten.besluiten.find((b) => b.code === "2026_DCAN_09108")?.vervangt, ["2026_DCAN_09007"]);
  assert.deepEqual(readJson(root, `${SOURCE_ID}.json`).items.map((i) => i.title), ["Nachtelijke Testklanken", "Scheldekaaienloop 2026"]);
  assert.ok(!JSON.stringify(besluiten).includes("Proefpersoon"));
});

test("B5: een publieke instelling mag organisator zijn, een privépersoon niet", () => {
  const titel = (org) => `2026_CBS_1 - Toelating muziekactiviteit - ${org}, voor Proefstadsfeest, Groenplaats zonder nummer (zn), 2000 Antwerpen. Dossiernummer MUZA2026/1/EM - Goedkeuring`;
  for (const org of ["Stad Antwerpen", "District Antwerpen", "FOMU", "AG Proefinstellingen Antwerpen/Kunsten", "Provincie Antwerpen"]) {
    assert.equal(soortVanTitel(titel(org), CBS).organisator, org, org);
  }
  for (const org of ["Jan Verzonnen", "Stadsfeest Proef", "district"]) assert.equal(soortVanTitel(titel(org), CBS).organisator, null, org);
  const stad = besluit({ organisator: "Stad Antwerpen" });
  assert.ok(ev.wordtAgendapunt(stad));
  const doc = { schemaVersion: 1, bron: "https://ebesluit.antwerpen.be/", methode: "x", leesversie: 2, generatedAt: NOW.toISOString(), venster: { van: "2026-08-11", tot: "2027-02-07" }, zoektermen: [], samenvatting: {}, besluiten: [stad] };
  assert.deepEqual(validateEvenementBesluiten(doc), []);
});
