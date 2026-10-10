// De samenvoeging van de zeven pakketten (#139, #146, #140, #142, #147, #141, #149): waar twee pakketten
// hetzelfde oplosten, is er nu één berekening. Deze toetsen falen op main (de functies of velden
// bestaan daar niet) en houden de samengevoegde keuzes vast:
// - één stratenberekening voor een parcours (site/parcours-straten.js): de verversing schrijft `langs`
//   (#140) en `kruist` (#146) uit dezelfde berekening;
// - "jouw straat" kort in de lijst (#146) en lang in de kaart (#140) uit dezelfde feiten;
// - "Waar" bij een aanvraag: "ook dicht bij" en geen tunnels (#146), de gekozen straat zichtbaar (#142);
// - een open evenementkaart: het parcours vooraan in "In het dossier", de parkeerverboden dicht (#149).
// Verzonnen straten en dossiers, zonder live datums.
//
//            Langsstraat (x=600, noord)
//                 |
//   Verrestraat (y=80, x 0–500)          het parcours: een vlak van 24 m breed langs de Leiweg
//   ----------------                     (y=0, x 0–600) en dan noordwaarts door de Langsstraat.
//   ===Leiweg=====|=====|====+           Kruisstraat (x=300) kruist het; Zijstraat (x=450) komt
//            Kruisstraat  Zijstraat      erop uit en krijgt ook een parkeerverbod.
import test from "node:test";
import assert from "node:assert/strict";

import { buildStreetIndex } from "../site/street-core.js";
import * as pc from "../site/place-core.js";
import * as ku from "../site/kaart-uitleg.js";
import * as pk from "../site/permit-clarity.js";
import * as refresh from "../lib/kaart-uitleg-refresh.mjs";

// parcours-straten.js bestaat op main nog niet: dynamisch laden, zodat elke toets apart faalt.
const ps = await import("../site/parcours-straten.js").catch(() => null);
const parcoursGeometrie = (features) => (ps ? ps.parcoursGeometrie(features) : null);

const m = (x, y) => [4.4 + x / 69760, 51.2 + y / 110540];
const as = (id, naam, punten) => ({ type: "Feature", properties: { DISTRICT: "ANTWERPEN", LSTRNMID: id, LSTRNM: naam, RSTRNMID: id, RSTRNM: naam, postcode: 2000 }, geometry: { type: "LineString", coordinates: punten.map(([x, y]) => m(x, y)) } });
const ASSEN = [
  as(1, "Leiweg", [[0, 0], [300, 0], [450, 0], [600, 0]]),
  as(2, "Langsstraat", [[600, 0], [600, 300]]),
  as(3, "Kruisstraat", [[300, -200], [300, 0], [300, 200]]),
  as(4, "Zijstraat", [[450, 0], [450, 200]]),
  as(5, "Verrestraat", [[0, 80], [500, 80]]),
];
const INDEX = buildStreetIndex(ASSEN);
const VLAK = { rings: [[[-20, -12], [612, -12], [612, 300], [588, 300], [588, 12], [-20, 12], [-20, -12]].map(([x, y]) => m(x, y))] };
const DOSSIER = "ET2099000101";
const straat = (name, i) => ({ id: String(i), name, postcode: "2000" });
const parcoursRij = (extra = {}) => ({
  id: `iod:${DOSSIER}|F1|I1`, kind: "iod", reference: DOSSIER, dossierType: "ETL", innameType: "Parcours", title: "Parcours",
  phase: "Evenement", status: "aanvraag_goedgekeurd", start: "2026-10-13T06:00:00Z", end: "2026-10-13T16:00:00Z",
  streets: ["Kruisstraat", "Langsstraat", "Leiweg", "Zijstraat"].map(straat), parcours: parcoursGeometrie([{ geometry: VLAK }]), ...extra,
});
const parkeerRij = { ...parcoursRij(), id: `iod:${DOSSIER}|F1|I2`, innameType: "Parkeerverbod", title: "Parkeerverbod", streets: [straat("Zijstraat", 4)], parcours: undefined };
const kern = (e) => Object.fromEntries(e.uitleg.kern);
const opties = { vandaag: "2026-10-06", wijkVan: () => "" };

test("verversing: `langs` en `kruist` uit één berekening, ook een kruisende straat met een parkeerverbod", async () => {
  const ms = (iso) => Date.parse(iso);
  const iod = (geometry, innameId, type) => ({ attributes: { dossierNummer: DOSSIER, faseId: "F1", innameId, dossierStatus: "aanvraag_goedgekeurd", faseNaam: "Evenement", type_dossier: "ETL", innameTypeNaam: type, innameBeschrijving: "", faseStartDatum: ms("2026-10-13T06:00:00Z"), faseEindDatum: ms("2026-10-13T16:00:00Z") }, geometry });
  const district = { type: "Polygon", coordinates: [[m(-1000, -1000), m(2000, -1000), m(2000, 2000), m(-1000, 2000), m(-1000, -1000)]] };
  // Een parkeerverbod langs de Zijstraat, 30 tot 90 m van het parcours.
  const parkeer = { paths: [[[452, 30], [452, 90]].map(([x, y]) => m(x, y))] };
  const { document } = await refresh.bouwKaartUitleg({ iodFeatures: [iod(VLAK, "I1", "Parcours"), iod(parkeer, "I2", "Parkeerverbod")], district, streetFeatures: ASSEN, fetch: null, clock: () => new Date("2026-10-06T05:00:00Z") });
  const e = document.evenementen[DOSSIER];
  assert.deepEqual(e.langs, ["Langsstraat", "Leiweg"], "langs: alleen waar het parcours zelf door loopt");
  assert.deepEqual(e.kruist, ["Kruisstraat", "Zijstraat"], "kruist: ook de Zijstraat met haar parkeerverbod");
  assert.ok(e.straten.includes("Zijstraat"), "de straat van het parkeerverbod hoort bij het dossier");
  assert.deepEqual(refresh.validateKaartUitleg(document), []);
  assert.ok(refresh.validateKaartUitleg({ ...document, evenementen: { [DOSSIER]: { ...e, langs: [""] } } }).some((x) => /langs ongeldig/.test(x)));
  // De site haalt de straten van het dossier uit `kruist`: de filter en de lijst blijven dezelfde.
  assert.deepEqual(pc.evenementStraten([parcoursRij()], { bewaard: e }).kruist, ["Kruisstraat"]);
  // Jouw straat: de Zijstraat krijgt een parkeerverbod én kruist het parcours.
  const zij = pc.evenementEntry([parcoursRij(), parkeerRij], { ...opties, uitleg: document, straat: "Zijstraat" });
  assert.equal(kern(zij)["Jouw straat"], "Jouw straat krijgt een parkeerverbod op dinsdag 13 oktober en kruist het parcours of komt erop uit.");
});

test("jouw straat: de korte regel in de lijst en de lange in de kaart zeggen hetzelfde", () => {
  assert.equal(typeof pc.parcoursRelatieVoorStraat, "function", "place-core.js kent parcoursRelatieVoorStraat");
  const met = (straatNaam, extra = {}) => pc.evenementEntry([parcoursRij(), parkeerRij], { ...opties, index: INDEX, straat: straatNaam, ...extra });
  // Het parcours loopt door de straat.
  const lei = met("Leiweg");
  assert.equal(lei.jouwStraat, "Het parcours loopt door je straat");
  assert.equal(kern(lei)["Jouw straat"], "Jouw straat ligt op het parcours.");
  // Kruist het parcours alleen.
  const kruis = met("Kruisstraat");
  assert.equal(kruis.jouwStraat, "Je straat kruist het parcours");
  assert.equal(kern(kruis)["Jouw straat"], "Jouw straat kruist het parcours of komt erop uit.");
  // Een parkeerverbod in de straat, en het parcours kruist haar: de korte regel zegt "in of naast" (18 m).
  const zij = met("Zijstraat");
  assert.equal(zij.jouwStraat, "Een zone van dit evenement ligt in of naast je straat");
  assert.equal(kern(zij)["Jouw straat"], "Jouw straat krijgt een parkeerverbod op dinsdag 13 oktober en kruist het parcours of komt erop uit.");
  // Niet in de straat, wel binnen de straal: ook de kaart zegt het.
  const ver = met("Verrestraat", { straal: 500 });
  assert.equal(ver.jouwStraat, "Niet in je straat, wel binnen 500 m");
  assert.equal(kern(ver)["Jouw straat"], "Niet in je straat: dit evenement ligt binnen 500 m van je straat.");
  assert.deepEqual(ver.uitleg.kern.map(([dt]) => dt).slice(-2), ["Jouw straat", "Wat merk je"]);
  // Eén "Jouw straat", nergens twee.
  for (const e of [lei, kruis, zij, ver]) assert.equal(e.uitleg.kern.filter(([dt]) => dt === "Jouw straat").length, 1);
});

test("jouw straat zonder vorm van het parcours: niet meer zeggen dan 'in of naast'", () => {
  // Nog geen straatas geladen en geen verversing: vroeger zei de lijst "Het parcours loopt door je straat".
  const e = pc.evenementEntry([parcoursRij({ parcours: undefined })], { ...opties, straat: "Kruisstraat" });
  assert.equal(e.jouwStraat, "Het parcours ligt in of naast je straat");
  assert.equal(kern(e)["Jouw straat"], "Jouw straat ligt op of naast het parcours.");
  assert.equal(pc.parcoursRelatieVoorStraat("Kruisstraat", { rijen: [parcoursRij({ parcours: undefined })] }), null);
  // Een verversing met `langs` maar zonder `kruist`: niet op het parcours, kruisen of naast niet bekend.
  assert.equal(pc.parcoursRelatieVoorStraat("Kruisstraat", { bewaard: { langs: ["Leiweg"] } }), "kruist-of-naast");
  assert.equal(ku.jouwStraat({ perSoort: { parcours: ["Kruisstraat"] }, parcoursRelatie: "kruist-of-naast" }, "Kruisstraat"), "Jouw straat kruist het parcours of ligt er vlak naast.");
  assert.equal(ku.jouwStraat({ perSoort: { parcours: ["Kruisstraat"] }, parcoursRelatie: "naast" }, "Kruisstraat"), "Jouw straat ligt vlak naast het parcours.");
});

test("jouw straat bij alleen een zone: de kaart zegt ook dat het om 18 m gaat", () => {
  const zone = { ...parkeerRij, id: `iod:${DOSSIER}|F1|I3`, innameType: "Zone", title: "Zone", streets: [straat("Buurstraat", 9)] };
  const e = pc.evenementEntry([zone], { ...opties, straat: "Buurstraat" });
  assert.equal(e.jouwStraat, "Een zone van dit evenement ligt in of naast je straat");
  assert.equal(kern(e)["Jouw straat"], "Jouw straat wordt gebruikt voor dit evenement op dinsdag 13 oktober; waarvoor precies, zegt de stad niet. Die inname ligt in je straat of tot 18 m van de straatas.");
});

test("'Waar' bij een aanvraag: ook dicht bij, geen tunnel, de gekozen straat zichtbaar, en geen '1 andere straten'", () => {
  assert.equal(typeof pk.waarTekst, "function", "permit-clarity.js kent waarTekst");
  const w = pk.waarTekst(["Lei", "Tunnelstraat", "Craeybeckxtunnel", "Kaai", "Plein", "Hoek"], "Hoek");
  assert.equal(w.kort, "Lei · ook dicht bij Hoek, Tunnelstraat en 2 andere straten");
  assert.deepEqual(w.straten, ["Lei", "Hoek", "Tunnelstraat", "Kaai", "Plein"]);
  assert.equal(w.ingeklapt, true);
  assert.equal(pk.waarTekst(["A", "B", "C", "D"]).kort, "A · ook dicht bij B, C en D");
  assert.equal(pk.waarTekst(["Kennedytunnel"]).kort, "Kennedytunnel", "alleen een tunnel: dan toch die naam");
  assert.equal(pc.vergunningWaar([{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }]), "A · ook dicht bij B, C en D");
  // De lijst en de kaart zeggen hetzelfde.
  const item = { id: "permit:OMV_2099000101", dossier: "OMV_2099000101", streets: ["Lei", "Kaai", "Hoek"].map((name) => ({ name })) };
  assert.equal(pc.permitEntry(item).location, pk.duidelijkeKaart({ source: "permits" }, item).waar.kort);
});

test("open evenementkaart: het parcours vooraan in 'In het dossier', de parkeerverboden dicht", async () => {
  const pv = await import("../site/place-view.js");
  assert.equal(typeof pv.kaartIndeling, "function", "place-view.js kent kaartIndeling");
  const rijen = [
    { ...parkeerRij, description: "Parkeerverbod langs het parcours" },
    { ...parcoursRij(), id: `iod:${DOSSIER}|F1|I4`, description: "Parcours volwassenen 10 km" },
    { ...parcoursRij(), id: `iod:${DOSSIER}|F1|I5`, description: "Parcours jeugd 5 km" },
    { ...parkeerRij, id: `iod:${DOSSIER}|F1|I6`, description: "Parkeerverbod aan de start" },
    { ...parkeerRij, id: `iod:${DOSSIER}|F1|I7`, description: "Parkeerverbod aan de finish" },
  ];
  const e = pc.evenementEntry(rijen, opties);
  assert.ok(Array.isArray(e.uitleg.kern), "de evenementkaart van #140");
  const { dossier } = pv.kaartIndeling(e.uitleg, { reference: e.reference, straten: e.straten.length });
  assert.deepEqual(dossier.zichtbaar.slice(0, 2), ["Parcours: Parcours volwassenen 10 km", "Parcours: Parcours jeugd 5 km"]);
  assert.ok(dossier.dicht.length >= 2 && dossier.dicht.every((b) => /^Parkeerverbod/.test(b)), JSON.stringify(dossier));
});
