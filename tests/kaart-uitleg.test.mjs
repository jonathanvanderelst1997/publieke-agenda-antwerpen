// Kaartjes in gewone taal (site/kaart-uitleg.js, lib/kaart-uitleg-refresh.mjs). Alle data is verzonnen.
import test from "node:test";
import assert from "node:assert/strict";

import {
  NIET_GEPUBLICEERD, bruikbareBeschrijving, evenementFeiten, evenementKaartje, huisnummerBereik, huisnummersUitTekst,
  koppelEvenement, resterendeDuur, soortEvenement, soortWerk, stratenSamenvatting, werkFeiten, werkKaartje, kaartSvg, vereenvoudigLijnen,
} from "../site/kaart-uitleg.js";
import { collectHindrance } from "../site/works-hindrance.js";
import { normalizeIod } from "../site/public-space-core.js";
import { publicSpaceEntries, workEntry } from "../site/place-core.js";
import { bouwKaartUitleg, inVenster, validateKaartUitleg } from "../lib/kaart-uitleg-refresh.mjs";
import { privacyFindings } from "../lib/source-feed.mjs";

const VANDAAG = "2026-10-06";

// Een verzonnen werk zoals de live laag het levert: geen omschrijving, wel hinderfasen.
const werk = (extra = {}) => ({
  gipodId: 90000001, title: "Werk in openbaar domein", status: "In uitvoering",
  start: "2026-08-24T04:00:00Z", end: "2026-11-13T16:00:00Z", owner: "Stad Antwerpen - Voorbeelddienst", ownerGroup: "Stad Antwerpen",
  workTypes: [], occupancyTypes: ["Andere"], streets: [{ id: "1", name: "Voorbeeldstraat", postcode: "2000" }],
  hindrance: {
    severe: false, consequences: ["Beperkte doorgang voor voetgangers"], start: "2026-09-05T04:00:00Z", end: "2026-11-13T16:00:00Z",
    phases: [
      { description: "Fase 2: instandhouding stelling", start: "2026-09-05T04:00:00Z", end: "2026-10-30T16:00:00Z", consequences: ["Beperkte doorgang voor voetgangers"] },
      { description: "Fase 3: afbouw stelling", start: "2026-10-31T04:00:00Z", end: "2026-11-13T16:00:00Z", consequences: ["Beperkte doorgang voor voetgangers"] },
    ],
  },
  ...extra,
});

test("resterende duur: bezig, gepland, laatste dag en zonder einddatum", () => {
  assert.equal(resterendeDuur({ start: "2026-08-24", eind: "2026-11-13T16:00:00Z", vandaag: VANDAAG }).tekst, "nog 38 dagen");
  assert.equal(resterendeDuur({ start: "2026-10-12", eind: "2026-10-20", vandaag: VANDAAG }).tekst, "start over 6 dagen");
  assert.equal(resterendeDuur({ start: "2026-10-01", eind: VANDAAG, vandaag: VANDAAG }).tekst, "laatste dag vandaag");
  assert.equal(resterendeDuur({ start: "2026-10-01", eind: "", vandaag: VANDAAG }).tekst, "einddatum niet gepubliceerd");
});

test("soort werk komt uit de bron, met de bron erbij", () => {
  assert.deepEqual(soortWerk([{ tekst: "Vernieuwen riolering en wegenis", bron: "omschrijving" }]), { soort: "Rioleringswerken", bron: "omschrijving" });
  assert.equal(soortWerk([{ tekst: "Fase 3 Afbraak van de stelling", bron: "fase" }]).soort, "Stelling (steiger)");
  assert.equal(soortWerk([{ tekst: "Andere", bron: "type" }]).soort, "");
});

test("werk zonder omschrijving: duidelijke titel, eerlijk over wat ontbreekt", () => {
  const k = werkKaartje(werk(), { vandaag: VANDAAG, feiten: werkFeiten(werk(), { huisnummers: "nr. 12–40", huisnummerBron: "afgeleid uit de werfzone en het adressenregister" }) });
  assert.equal(k.titel, "Stelling (steiger) Voorbeeldstraat nr. 12–40: voetgangers beperkt tot 13 november (nog 38 dagen)");
  assert.ok(k.ontbreekt.includes(NIET_GEPUBLICEERD));
  assert.ok(!k.ontbreekt.some((t) => /huisnummers/.test(t)));
  const regels = Object.fromEntries(k.regels);
  assert.match(regels.Wat, /afgeleid uit de fasen van de hinder/);
  assert.match(regels.Fasen, /Fase 3: afbouw stelling \(31 oktober – 13 november\)/);
  assert.equal(regels.Opdrachtgever, "Stad Antwerpen - Voorbeelddienst");
  assert.match(regels.Duur, /nog 38 dagen/);
  assert.equal("Bus en tram" in regels, false); // de bron noemt geen bus of tram, dus wij ook niet
});

test("werk zonder hinder en huisnummers zegt dat ze niet gepubliceerd zijn", () => {
  const w = werk({ hindrance: null, title: "2000 Antwerpen Voorbeeldstraat, Klantaansluiting elektriciteit", start: "2026-10-12T05:00:00Z", end: "2026-10-20T15:00:00Z" });
  const k = werkKaartje(w, { vandaag: VANDAAG });
  assert.equal(k.titel, "Nieuwe aansluiting op het net Voorbeeldstraat vanaf 12 oktober (start over 6 dagen)");
  assert.ok(k.ontbreekt.includes("huisnummers niet gepubliceerd"));
  assert.ok(k.ontbreekt.includes("gevolgen voor het verkeer niet gepubliceerd"));
  assert.ok(!k.ontbreekt.includes(NIET_GEPUBLICEERD));
});

test("bus en tram alleen als de bron ze noemt", () => {
  const w = werk({ hindrance: { ...werk().hindrance, phases: [{ description: "In gebruikname tijdelijke haltes", start: "2026-10-01", end: "2026-10-30" }] } });
  assert.equal(Object.fromEntries(werkKaartje(w, { vandaag: VANDAAG }).regels)["Bus en tram"], "In gebruikname tijdelijke haltes");
});

test("huisnummers: bereik en uit de tekst van de beheerder", () => {
  assert.equal(huisnummerBereik(["60", "47B", "49", "53"]), "nr. 47–60");
  assert.equal(huisnummerBereik(["8"]), "nr. 8");
  assert.equal(huisnummerBereik([]), "");
  assert.equal(huisnummersUitTekst("Voorbeeldstraat 18 - 24", "Voorbeeldstraat"), "nr. 18–24");
  assert.equal(huisnummersUitTekst("Andere straat 3", "Voorbeeldstraat"), "");
});

test("hinderfasen worden bewaard per omschrijving", () => {
  const f = (d, s, e, c) => ({ properties: { HindranceStatus: "Gevalideerd", HindranceConsequenceOf: "https://gipod.api.vlaanderen.be/api/v1/works/7;", HindranceDescription: d, HindranceStart: s, HindranceEnd: e, Consequences: c, HindranceGipodId: 1 } });
  const h = collectHindrance([f("Fase 1", "2026-10-01T00:00:00Z", "2026-10-05T00:00:00Z", "Parkeerverbod"), f("Fase 1", "2026-10-01T00:00:00Z", "2026-10-05T00:00:00Z", ""), f("Fase 2", "2026-10-06T00:00:00Z", "2026-10-09T00:00:00Z", "")]).get(7);
  assert.deepEqual(h.phases.map((p) => [p.description, p.consequences]), [["Fase 1", ["Parkeerverbod"]], ["Fase 2", []]]);
});

// Verzonnen evenementendossier: drie parcoursdelen en een inname, zoals de live IOD-laag ze geeft.
const rij = (i, type, beschrijving, straten) => ({
  id: `iod:ET2099000001|EVENT|x${i}`, kind: "iod", title: type, innameType: type, reference: "ET2099000001", dossierType: "ETL",
  phase: "Evenement", hindrance: "True", description: beschrijving, start: "2026-10-13T00:00:00.000Z", end: "2026-10-13T00:00:00.000Z",
  status: "aanvraag_goedgekeurd", detail: "Fase Evenement · Dossiertype ETL · Hinder volgens IOD: True",
  streets: straten.map((name, j) => ({ id: `${i}${j}`, name, postcode: "2000" })), sourceUrl: "https://geodata.antwerpen.be/x",
});
const rijen = [
  rij(1, "Parcours", "10K volwassenen", ["Aaastraat", "Beestraat", "Ceestraat"]),
  rij(2, "Parcours", "maurits", ["Deestraat", "Eestraat"]),
  rij(3, "Inname", "Startzone en aankomst", ["Aaastraat"]),
];

test("vrije tekst uit het dossier alleen als ze over het evenement gaat", () => {
  assert.equal(bruikbareBeschrijving("maurits"), "");
  assert.equal(bruikbareBeschrijving("Wandelen van het plein naar de kaai"), "Wandelen van het plein naar de kaai");
  assert.equal(bruikbareBeschrijving("bel 0470 12 34 56 voor parkeren"), "");
  assert.equal(bruikbareBeschrijving("Startlocatie -&gt; drillocatie"), "Startlocatie -> drillocatie");
});

test("parcours: één kaartje, soort uit het dossier, codes vertaald, eerlijk over naam en uren", () => {
  const f = evenementFeiten(rijen);
  assert.equal(f.soort, "Loopwedstrijd");
  assert.equal(f.straten.length, 5);
  assert.deepEqual(f.beschrijvingen, ["Parcours: 10K volwassenen", "Inname: Startzone en aankomst"]);
  const wijk = (s) => (s === "Eestraat" ? "Zuid" : "Centrum");
  const k = evenementKaartje(f, { vandaag: VANDAAG, wijkVan: wijk });
  assert.equal(k.titel, "Loopwedstrijd met parcours door 5 straten in Centrum en Zuid, 13 oktober");
  assert.ok(k.ontbreekt.includes("naam van het evenement niet gepubliceerd door de stad"));
  assert.ok(k.ontbreekt.includes("uren niet gepubliceerd"));
  assert.ok(k.ontbreekt.includes("organisator niet gepubliceerd"));
  assert.doesNotMatch(`${k.titel} ${k.samenvatting} ${k.regels.flat().join(" ")}`, /ETL|IOD|True|maurits/);
  assert.match(k.technisch, /ETL = evenementendossier van de stad/);
  assert.match(k.technisch, /IOD = inname van het openbaar domein/);
});

test("parcours gekoppeld aan een bekend evenement via datum en straat", () => {
  const f = evenementFeiten(rijen);
  const items = [
    { title: "Markt", date: "2026-10-13", location: "Aaastraat", theme: "Markt" },
    { title: "Voorbeeldloop", date: "2026-10-13", timeText: "9 tot 14 uur", location: "Start op de Beestraat", sourceUrl: "https://www.example.org/loop" },
    { title: "Ander feest", date: "2026-10-13", location: "Elders" },
  ];
  const g = koppelEvenement(f, items);
  assert.deepEqual([g.titel, g.tijd], ["Voorbeeldloop", "9 tot 14 uur"]);
  const k = evenementKaartje(f, { vandaag: VANDAAG, gekoppeld: g });
  assert.equal(k.titel, "Voorbeeldloop: parcours door 5 straten, 13 oktober 9 tot 14 uur");
  assert.ok(!k.ontbreekt.some((t) => /naam|uren/.test(t)));
  assert.equal(koppelEvenement(f, [{ title: "Alleen dezelfde dag", date: "2026-10-13", location: "Elders" }]), null);
});

test("lange straatlijst wordt een telling met de wijken", () => {
  assert.equal(stratenSamenvatting(["A", "B"]), "A, B");
  assert.equal(stratenSamenvatting(Array.from({ length: 38 }, (_, i) => `S${i}`), () => "Binnenstad"), "38 straten in Binnenstad");
});

test("de site bundelt innames per dossier en geeft werken een duidelijke titel", () => {
  const entries = publicSpaceEntries(rijen.slice(0, 1), { vandaag: VANDAAG, alle: rijen, uitleg: null, wijkVan: () => "" });
  assert.equal(entries.length, 1);
  assert.match(entries[0].title, /^Loopwedstrijd met parcours door 5 straten/);
  assert.equal(entries[0].straten.length, 5);
  assert.match(entries[0].sourceUrl, /^https:\/\/geodata\.antwerpen\.be\//);
  const parking = publicSpaceEntries([{ id: "parking:1", kind: "parking", title: "Verhuis", start: "2026-10-09", end: "2026-10-10" }], { vandaag: VANDAAG });
  assert.equal(parking[0].title, "Parkeerverbod: Verhuis");
  const w = workEntry(werk(), { vandaag: VANDAAG, uitleg: { werken: { 90000001: { huisnummers: "nr. 12–40", huisnummerBron: "afgeleid" } } } });
  assert.equal(w.title, "Stelling (steiger) Voorbeeldstraat nr. 12–40: voetgangers beperkt tot 13 november (nog 38 dagen)");
  assert.match(w.sourceUrl, /GipodId%3D90000001/);
  assert.equal(workEntry(werk()).title, "Werk in openbaar domein"); // zonder vandaag: ongewijzigd
});

test("A-Sign-omschrijving gaat mee door de normalisatie", () => {
  assert.equal(normalizeIod({ dossierNummer: "ET1", faseId: "F", innameId: "I", innameBeschrijving: " Start  zone ", dossierStatus: "aanvraag_goedgekeurd" }).description, "Start zone");
});

test("kaartschets: vereenvoudigd en zonder netwerk", () => {
  const lijn = Array.from({ length: 100 }, (_, i) => [4.4 + i * 0.0001, 51.2 + i * 0.00005]);
  const [kort] = vereenvoudigLijnen([lijn], 10);
  assert.ok(kort.length <= 11 && kort.length >= 2);
  assert.match(kaartSvg([kort], [[[4.4, 51.2], [4.41, 51.2]]]), /^<svg class="ku-kaart"/);
  assert.equal(kaartSvg([], []), "");
});

test("verversing: huisnummers uit werfzone en adressenregister, bewaard tot GIPOD wijzigt", async () => {
  const calls = [];
  const fakeFetch = async (url, init = {}) => {
    calls.push(String(url));
    const body = String(url).includes("GIPOD")
      ? { type: "FeatureCollection", features: [{ geometry: { type: "Polygon", coordinates: [[[4.4, 51.2], [4.4001, 51.2], [4.4001, 51.2001], [4.4, 51.2]]] } }] }
      : { features: ["12", "14", "40", "22A"].map((n) => ({ attributes: { STRAATNM: "Voorbeeldstraat", HUISNR: n } })) };
    assert.ok(!String(url).includes("CRAB") || String(init.body).includes("STRAATNM%3D%27Voorbeeldstraat%27"));
    return { ok: true, json: async () => body };
  };
  const works = [werk({ lastModified: "2026-09-01T00:00:00Z" }), werk({ gipodId: 90000002, start: "2027-03-01T00:00:00Z", end: "2027-04-01T00:00:00Z" })];
  const clock = () => new Date("2026-10-06T05:00:00Z");
  const eerste = await bouwKaartUitleg({ works, fetch: fakeFetch, clock });
  assert.deepEqual(Object.keys(eerste.document.werken), ["90000001"]); // het tweede werk valt buiten het venster
  const w = eerste.document.werken["90000001"];
  assert.equal(w.huisnummers, "nr. 12–40");
  assert.equal(w.huisnummerBron, "afgeleid uit de werfzone en het adressenregister");
  assert.deepEqual(validateKaartUitleg(eerste.document), []);
  assert.deepEqual(privacyFindings(eerste.document), []);
  const voor = calls.length;
  const tweede = await bouwKaartUitleg({ works, fetch: fakeFetch, clock, vorige: eerste.document });
  assert.equal(calls.length, voor); // niets opnieuw opgezocht
  assert.equal(tweede.document.werken["90000001"].huisnummers, "nr. 12–40");
  const gewijzigd = await bouwKaartUitleg({ works: [werk({ lastModified: "2026-10-05T00:00:00Z" })], fetch: fakeFetch, clock, vorige: eerste.document });
  assert.ok(calls.length > voor);
  assert.equal(gewijzigd.stats.adresOpgezocht, 1);
});

test("verversing: een falende adresbron laat het werk zonder huisnummers, niet zonder kaartje", async () => {
  const kapot = async () => { throw Object.assign(new Error("weg"), { code: "http_503" }); };
  const { document, stats } = await bouwKaartUitleg({ works: [werk()], fetch: kapot, clock: () => new Date("2026-10-06T05:00:00Z") });
  assert.equal(document.werken["90000001"].huisnummers, "");
  assert.equal(document.werken["90000001"].soort, "Stelling (steiger)");
  assert.equal(stats.adresFouten, 1);
});

test("venster en validatie", () => {
  assert.equal(inVenster("2026-01-01", "2026-10-05", VANDAAG), false);
  assert.equal(inVenster("2026-11-01", "2026-12-01", VANDAAG), true);
  assert.equal(inVenster("2027-01-01", "2027-02-01", VANDAAG), false);
  assert.ok(validateKaartUitleg({ schemaVersion: 1, generatedAt: "x", vanaf: "", tot: "", werken: {}, evenementen: {} }).includes("generatedAt ongeldig"));
  assert.ok(validateKaartUitleg({ schemaVersion: 1, generatedAt: "2026-10-06T05:00:00Z", vanaf: VANDAAG, tot: VANDAAG, werken: {}, evenementen: { ET2099000001: { start: "", eind: "", straten: [], beschrijvingen: [], kaart: [], gekoppeld: { titel: "x", bronUrl: "https://a.b/?q=1" } } } }).some((e) => /gekoppeld/.test(e)));
});

test("inhaakpunt: schrijft het bestand, en een mislukte laag houdt haar vorige feiten", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { schrijfKaartUitleg, KAART_UITLEG_FILE } = await import("../lib/kaart-uitleg-refresh.mjs");
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "kaart-uitleg-"));
  const clock = () => new Date("2026-10-06T05:00:00Z");
  const geenNet = async () => { throw new Error("geen netwerk in toetsen"); };
  const stil = () => {};
  const eerste = await schrijfKaartUitleg({ rootDir, works: { ok: true, items: [werk()] }, publicSpace: { ok: false }, fetch: geenNet, clock, log: stil });
  assert.ok(eerste.werken["90000001"]);
  const file = path.join(rootDir, "site", "sources", KAART_UITLEG_FILE);
  assert.deepEqual(validateKaartUitleg(JSON.parse(fs.readFileSync(file, "utf8"))), []);
  const tweede = await schrijfKaartUitleg({ rootDir, works: { ok: false, items: [] }, publicSpace: { ok: false }, fetch: geenNet, clock, log: stil });
  assert.deepEqual(Object.keys(tweede.werken), ["90000001"]);
});

// Herstelplan O1/4: het losse woord "markt" maakte van elke inname op een plein een "Markt".
test("soort evenement: een plein met 'markt' in de naam is geen markt", () => {
  for (const tekst of ["grote markt, verkoop", "Grote Markt", "Inname: Veemarkt", "Vrijdagmarkt - podium", "Parkeerverbod op Paardenmarkt"]) {
    assert.equal(soortEvenement([tekst]), "", tekst);
  }
  for (const tekst of ["rommelmarkt", "Braderie Proefstraat", "verplaatsbare markt", "kerstmarkt op het plein"]) {
    assert.equal(soortEvenement([tekst]), "Markt", tekst);
  }
  const feiten = evenementFeiten([
    { kind: "iod", reference: "ET2026000001", dossierType: "ETL", innameType: "Inname", description: "theaterplein - drill", start: "2026-10-15T00:00:00.000Z", end: "2026-10-15T00:00:00.000Z", streets: [] },
    { kind: "iod", reference: "ET2026000001", dossierType: "ETL", innameType: "Inname", description: "grote markt, verkoop", start: "2026-10-15T00:00:00.000Z", end: "2026-10-15T00:00:00.000Z", streets: [] },
  ]);
  assert.notEqual(feiten.soort, "Markt");
});
