// Werkkaarten (O7 uit de test van 18 straten): jaartal, juiste soort, leesbare titel met "in" en
// altijd een plek, de afsluiting met haar eigen periode, geen "Nu bezig" naast "concreet gepland",
// de ruwe GIPOD-tekst apart en geen dubbele kaarten. Alle data is verzonnen; "vandaag" ligt vast.
// Namespace-imports: op de oude code faalt elke toets op haar eigen bewering, niet op een import.
import test from "node:test";
import assert from "node:assert/strict";

import * as ku from "../site/kaart-uitleg.js";
import * as pc from "../site/place-core.js";
import * as sc from "../site/street-core.js";

const VANDAAG = "2026-10-09";
const werk = (extra = {}) => ({
  gipodId: 90000101, title: "Werk in openbaar domein", status: "In uitvoering", start: "2026-09-01T05:00:00Z", end: "2026-11-20T16:00:00Z",
  owner: "Voorbeeldbeheerder", ownerGroup: "Andere", workTypes: [], occupancyTypes: ["Andere"],
  streets: [{ id: "1", name: "Voorbeeldstraat", postcode: "2000" }], hindrance: null, ...extra,
});
const kaart = (w, vandaag = VANDAAG) => ku.werkKaartje(w, { vandaag });
const regels = (k) => Object.fromEntries(k.regels);
const alleTekst = (k) => [k.titel, k.samenvatting, k.plek, k.bronTekst || "", ...k.regels.flat()].join(" ");

test("jaartal: een werf over de jaargrens noemt het jaar, een werf van dit jaar niet", () => {
  const lang = kaart(werk({ start: "2025-12-08T07:00:00Z", end: "2034-01-01T16:00:00Z" }));
  assert.match(lang.titel, /tot 1 januari 2034 \(nog ruim 7 jaar\)$/);
  assert.equal(regels(lang).Duur, "8 december 2025 – 1 januari 2034 · nog ruim 7 jaar");
  const volgendJaar = kaart(werk({ start: "2026-10-01T05:00:00Z", end: "2027-07-06T16:00:00Z" }));
  assert.match(volgendJaar.titel, /tot 6 juli 2027 /);
  assert.equal(regels(volgendJaar).Duur.split(" · ")[0], "1 oktober 2026 – 6 juli 2027");
  const ditJaar = kaart(werk());
  assert.match(ditJaar.titel, /tot 20 november \(nog 42 dagen\)$/);
  assert.equal(regels(ditJaar).Duur.split(" · ")[0], "1 september – 20 november");
  // Gepland voor volgend jaar: ook de startdatum krijgt het jaar.
  assert.match(kaart(werk({ start: "2027-01-20T05:00:00Z", end: "2027-02-20T16:00:00Z" })).titel, /vanaf 20 januari 2027 \(start over 103 dagen\)$/);
});

test("jaartal: geen enkele werkkaart heeft een datum in een ander jaar zonder jaartal", () => {
  const MAAND = "(?:januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)";
  const fixtures = [
    werk({ start: "2025-12-08T07:00:00Z", end: "2034-01-01T16:00:00Z" }),
    werk({ start: "2026-01-05T05:00:00Z", end: "2027-07-06T16:00:00Z", hindrance: { severe: true, consequences: ["Geen doorgang voor fietsers"], start: "2026-10-01T04:00:00Z", end: "2027-03-30T16:00:00Z", phases: [{ description: "Fase 1", start: "2026-10-01T04:00:00Z", end: "2027-03-30T16:00:00Z", consequences: ["Geen doorgang voor fietsers"] }] } }),
  ];
  for (const w of fixtures) {
    const k = kaart(w);
    const tekst = [k.titel, ...k.regels.map(([, v]) => v)].join(" | ");
    // Elke datum in 2025 of 2027+ moet met jaartal staan: zoek "1 januari" gevolgd door iets anders dan een jaartal.
    for (const d of [w.start, w.end].map((x) => x.slice(0, 10)).filter((x) => x.slice(0, 4) !== VANDAAG.slice(0, 4))) {
      const kaal = new RegExp(`\\b${Number(d.slice(8, 10))} ${ku.datumTekst(d).split(" ")[1]}(?! ${d.slice(0, 4)})`);
      assert.doesNotMatch(tekst, kaal, `${d} zonder jaartal in: ${tekst}`);
    }
    assert.ok(new RegExp(`${MAAND} 20\\d\\d`).test(k.titel), k.titel);
  }
});

test("soort: warmtenet en gasleiding worden niet langer elektriciteitsnet", () => {
  const warmte = kaart(werk({
    title: "2030 Antwerpen - Voorbeeldsite - Voorbeeldlaan Aanleg warmtenet staal DN300 lengte 1650m", owner: "Fluvius Site Warmte", ownerGroup: "Fluvius",
    occupancyTypes: ["Thermisch"], workTypes: ["distributienet;transportnet;(her)aanleg"], streets: [{ id: "2", name: "Voorbeeldlaan", postcode: "2030" }],
  }));
  assert.match(warmte.titel, /^Werken aan het warmtenet in de Voorbeeldlaan/);
  assert.doesNotMatch(alleTekst(warmte), /elektriciteit/i);
  // Ook zonder het woord in de omschrijving: de soort inname "Thermisch" zegt het.
  assert.match(kaart(werk({ title: "Werk in openbaar domein", occupancyTypes: ["Thermisch"], workTypes: ["distributienet"] })).titel, /^Werken aan het warmtenet /);
  const gas = kaart(werk({ title: "2050 ANTWERPEN VOORBEELDLAAN G, Initiatief Regio (lengte: 23m)", owner: "Fluvius Site Antwerpen", ownerGroup: "Fluvius", occupancyTypes: ["Olie, gas, chemicaliën"], workTypes: ["distributienet"] }));
  assert.match(gas.titel, /^Werken aan de gasleiding in de Voorbeeldstraat/);
  // Een andere beheerder: niet meer zeggen dan GIPOD ("olie, gas, chemicaliën").
  assert.match(kaart(werk({ owner: "Voorbeeld Pijpleidingen", occupancyTypes: ["Olie, gas, chemicaliën"], workTypes: ["transportnet"] })).titel, /^Werken aan een leiding voor gas, olie of chemicaliën /);
});

test("soort: Fluvius zegt welk net, telecom en hoogtewerker vallen niet weg", () => {
  const e = kaart(werk({ title: "2060 ANTWERPEN VOORBEELDSTRAAT E, Initiatief Regio (lengte: 107m)", owner: "Fluvius Site Antwerpen", ownerGroup: "Fluvius", occupancyTypes: ["Elektriciteit"], workTypes: ["distributienet"] }));
  assert.match(e.titel, /^Werken aan het elektriciteitsnet in de Voorbeeldstraat/);
  const aansluiting = kaart(werk({ title: "2000 ANTWERPEN, VOORBEELDSTRAAT 77", owner: "Fluvius Site Antwerpen", ownerGroup: "Fluvius", occupancyTypes: ["Elektriciteit"], workTypes: ["klantaansluiting"] }));
  assert.match(aansluiting.titel, /^Nieuwe aansluiting op het elektriciteitsnet in de Voorbeeldstraat/);
  const tweeNetten = kaart(werk({ title: "2050, ANTWERPEN, VOORBEELDLAAN: E,G en OV nieuw distributienet in verkaveling (42m)", owner: "Fluvius Site Antwerpen", ownerGroup: "Fluvius", occupancyTypes: ["Elektriciteit;Openbare verlichting;Olie, gas, chemicaliën"], workTypes: ["distributienet;verkaveling"] }));
  assert.match(tweeNetten.titel, /^Werken aan gas, elektriciteit en straatverlichting in de Voorbeeldstraat/);
  assert.match(kaart(werk({ title: "Voorbeeldstraat - werken aan nutsleiding - 3m.", owner: "Voorbeeld Telecom", occupancyTypes: ["Telecom"], workTypes: ["distributienet"] })).titel, /^Telecomwerken \(kabels of glasvezel\) in de Voorbeeldstraat/);
  assert.match(kaart(werk({ title: "Werken in opdracht van een operator: Huisaansluiting", occupancyTypes: ["Telecom"], workTypes: ["klantaansluiting;(her)aanleg"] })).titel, /^Nieuwe aansluiting op het telecomnet /);
  assert.match(kaart(werk({ title: "2018 | Antwerpen | Voorbeeldstraat | 91", occupancyTypes: ["Hoogtewerker;Nutswerken"] })).titel, /^Nutswerken met een hoogtewerker in de Voorbeeldstraat/);
  // Klantaansluiting met het net alleen in de tekst.
  assert.match(kaart(werk({ title: "2000 Antwerpen Voorbeeldstraat, Klantaansluiting elektriciteit" })).titel, /^Nieuwe aansluiting op het elektriciteitsnet /);
});

test("soort: een straatnaam telt niet als soort, en een grote werf is geen gewone riolering", () => {
  const boom = kaart(werk({ title: "2018 Antwerpen Boomweidestraat werken distributieleiding)", occupancyTypes: ["Water"], streets: [{ id: "3", name: "Boomweidestraat", postcode: "2018" }] }));
  assert.match(boom.titel, /^Werken aan de waterleiding in de Boomweidestraat/);
  const ring = kaart(werk({ title: "R1 - Voorbeeldpark - Antwerpen", occupancyTypes: ["Kunstwerk;Wegeniswerken;Andere;Elektriciteit;Riolering;Openbare verlichting"], workTypes: ["toplaag;(her)aanleg"] }));
  assert.match(ring.titel, /^Wegen- en nutswerken in de Voorbeeldstraat/);
  assert.match(regels(ring).Wat, /Volgens GIPOD: brug, tunnel of viaduct · wegenwerken · elektriciteit · riolering · straatverlichting\./);
  assert.match(kaart(werk({ title: "Peilbuizen plaatsen in de zachte berm. Uitgevoerd zonder hinder." })).titel, /^Bodemonderzoek /);
  assert.match(kaart(werk({ title: "Uitvoering van boringen onder de wegenis voor kabelwegen", occupancyTypes: ["Spoorwerken"], workTypes: ["boring"] })).titel, /^Boringen in de grond /);
});

test("huisnummers: nooit nr. 0 of een postcode als huisnummer, ook niet uit een oudere verversing", () => {
  const postcode = kaart(werk({ title: "2000 ANTWERPEN, VOORBEELDMARKT 2001", streets: [{ id: "4", name: "Voorbeeldmarkt", postcode: "2000" }] }));
  assert.doesNotMatch(alleTekst(postcode), /nr\. 2001/);
  const nul = kaart(werk({ title: "2050 Antwerpen Voorbeeldstraat 0 werken distributieleiding)", occupancyTypes: ["Water"] }));
  assert.doesNotMatch(alleTekst(nul), /nr\. 0\b/);
  assert.equal(ku.huisnummersUitTekst("Voorbeeldstraat 18 - 24", "Voorbeeldstraat"), "nr. 18–24");
  // Bewaard in site/sources/kaart-uitleg.json vóór deze herstelling.
  const bewaard = { werken: { 90000101: { huisnummers: "nr. 2001", huisnummerBron: "omschrijving van de beheerder" } } };
  const entry = pc.workEntry(werk({ title: "Gevelwerken" }), { vandaag: VANDAAG, uitleg: bewaard });
  assert.doesNotMatch(`${entry.title} ${entry.uitleg.regels.flat().join(" ")}`, /2001/);
  assert.match(pc.workEntry(werk({ title: "Gevelwerken" }), { vandaag: VANDAAG, uitleg: { werken: { 90000101: { huisnummers: "nr. 12–40", huisnummerBron: "afgeleid" } } } }).title, /in de Voorbeeldstraat nr\. 12–40 /);
});

test("huisnummers: een aansluiting of verhuis toont de straat, nooit het huisnummer van één adres", () => {
  const k = kaart(werk({ title: "2018 ANTWERPEN, VOORBEELDSTRAAT 44", owner: "Fluvius Site Antwerpen", ownerGroup: "Fluvius", occupancyTypes: ["Olie, gas, chemicaliën"], workTypes: ["klantaansluiting"] }));
  assert.match(k.titel, /^Nieuwe aansluiting op het gasnet in de Voorbeeldstraat /);
  assert.doesNotMatch(alleTekst(k), /\b44\b/);
  assert.match(regels(k).Waar, /huisnummer weggelaten/);
  const entry = pc.workEntry(werk({ title: "Verhuislift Voorbeeldstraat 12" }), { vandaag: VANDAAG, uitleg: { werken: { 90000101: { huisnummers: "nr. 12", huisnummerBron: "afgeleid" } } } });
  assert.doesNotMatch(`${entry.title} ${entry.location} ${entry.uitleg.regels.flat().join(" ")}`, /\b12\b/);
});

test("titel: met \"in\" en het juiste lidwoord", () => {
  assert.match(kaart(werk({ title: "Gevelwerken" })).titel, /^Gevelwerken in de Voorbeeldstraat tot /);
  assert.equal(ku.opStraat("Voorbeeldplein"), "op het Voorbeeldplein");
  assert.equal(ku.opStraat("Voorbeeldpad"), "in het Voorbeeldpad");
  assert.equal(ku.opStraat("Voorbeeldmarkt"), "op de Voorbeeldmarkt");
  assert.equal(ku.opStraat("Voorbeeldlei"), "in de Voorbeeldlei");
  assert.equal(ku.opStraat("Leguit"), "in Leguit"); // geen herkenbaar einde: geen gegokt lidwoord
});

test("plek: zonder eenduidige straat het kruispunt of de dichtste straat, en altijd een regel Waar", () => {
  const kruispunt = kaart(werk({ streets: [], streetResolution: "ambiguous", streetNearby: [{ name: "Astraat", distanceMeters: 4 }, { name: "Beplein", distanceMeters: 7 }], streetsMeet: true }));
  assert.match(kruispunt.titel, / bij het kruispunt van Astraat en Beplein /);
  assert.match(regels(kruispunt).Waar, /^Bij het kruispunt van Astraat en Beplein/);
  const ver = kaart(werk({ streets: [], streetResolution: "unresolved", streetNearby: [{ name: "Ceelaan", distanceMeters: 61 }] }));
  assert.match(ver.titel, / nabij de Ceelaan /);
  assert.match(regels(ver).Waar, /dichtste straat is Ceelaan \(ongeveer 61 m\)/);
  const niets = kaart(werk({ streets: [] }));
  assert.ok("Waar" in regels(niets));
  // De straatassen: een punt op een kruispunt krijgt de twee straten mee, een punt op een straat niets extra.
  const axis = (name, coords) => ({ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: { LSTRNMID: name.length, LSTRNM: name, RSTRNMID: name.length, RSTRNM: name, postcode: "2000", DISTRICT: "ANTWERPEN" } });
  const index = sc.buildStreetIndex([axis("Astraat", [[4.40, 51.20], [4.41, 51.20]]), axis("Beplein", [[4.405, 51.195], [4.405, 51.205]])]);
  const [op, hoek] = sc.applyWorkStreetResolution([{ point: [4.401, 51.20001] }, { point: [4.40501, 51.20001] }], index);
  assert.equal(op.streets[0].name, "Astraat");
  assert.equal(op.streetNearby, undefined);
  assert.equal(hoek.streetResolution, "ambiguous");
  assert.deepEqual(hoek.streetNearby.map((s) => s.name).sort(), ["Astraat", "Beplein"]);
  assert.equal(hoek.streetsMeet, true);
});

test("afsluiting: met haar eigen einddatum, niet die van het hele werk", () => {
  const hinder = (fasen) => ({ severe: true, consequences: [...new Set(fasen.flatMap((f) => f.consequences))], start: fasen[0].start, end: fasen.at(-1).end, phases: fasen });
  const lopend = kaart(werk({
    start: "2026-01-05T05:00:00Z", end: "2027-07-06T16:00:00Z", status: "Concreet gepland",
    hindrance: hinder([
      { description: "Fase 1", start: "2026-10-01T04:00:00Z", end: "2026-11-30T16:00:00Z", consequences: ["Geen doorgang voor gemotoriseerd verkeer", "Geen doorgang voor fietsers"] },
      { description: "Fase 2", start: "2026-12-01T04:00:00Z", end: "2027-07-06T16:00:00Z", consequences: ["Beperkte doorgang voor voetgangers"] },
    ]),
  }));
  assert.match(lopend.titel, /: afgesloten voor auto's tot 30 november; werken tot 6 juli 2027 \(nog 270 dagen\)$/);
  assert.match(regels(lopend).Fasen, /Fase 1 \(1 oktober – 30 november\): afgesloten voor auto's, geen doorgang voor fietsers/);
  // Een afsluiting die nog moet komen, en een die al voorbij is.
  const komend = kaart(werk({ hindrance: hinder([{ description: "Fase 3", start: "2026-11-02T04:00:00Z", end: "2026-11-06T16:00:00Z", consequences: ["Geen doorgang voor gemotoriseerd verkeer"] }]) }));
  assert.match(komend.titel, /: afgesloten voor auto's van 2 tot 6 november; werken tot 20 november/);
  const voorbij = kaart(werk({ hindrance: hinder([{ description: "Fase 1", start: "2026-09-01T04:00:00Z", end: "2026-09-20T16:00:00Z", consequences: ["Geen doorgang voor gemotoriseerd verkeer"] }]) }));
  assert.doesNotMatch(voorbij.titel, /afgesloten/);
});

test("status: geen \"Nu bezig\" naast \"Concreet gepland\"", () => {
  const entry = { source: "works", group: "werken", status: "Concreet gepland", start: "2026-01-05", end: "2027-07-06" };
  assert.equal(pc.periodeBadge(entry, VANDAAG)?.label, "Periode loopt");
  assert.equal(pc.periodeBadge({ ...entry, status: "In uitvoering" }, VANDAAG)?.label, "Nu bezig");
  assert.equal(pc.periodeBadge({ ...entry, start: "2026-10-20" }, VANDAAG)?.label, "Gepland");
  assert.equal(pc.periodeBadge({ source: "agenda", group: "evenementen", start: "2026-10-01", end: "2026-10-20" }, VANDAAG), null);
  const k = kaart(werk({ status: "Concreet gepland" }));
  assert.match(regels(k).Stand, /periode loopt sinds 1 september, maar GIPOD meldt het werk nog als “concreet gepland”/);
  assert.equal("Stand" in regels(kaart(werk())), false);
});

test("wat: eerst één zin in gewone taal, de ruwe GIPOD-tekst apart", () => {
  const ruw = "2030 Antwerpen - Voorbeeldsite - Voorbeeldlaan - Anderestraat Aanleg warmtenet staal DN300 lengte 1650m";
  const k = kaart(werk({ title: ruw, occupancyTypes: ["Thermisch"] }));
  assert.equal(regels(k).Wat, "Werken aan het warmtenet, afgeleid uit de omschrijving van de beheerder.");
  assert.doesNotMatch(regels(k).Wat, /2030|Anderestraat/);
  assert.equal(k.bronTekst, ruw);
  // Zonder herkende soort: de tekst van de beheerder, duidelijk als zijn tekst.
  assert.match(regels(kaart(werk({ title: "Onderhoud van de voorbeeldinstallatie" }))).Wat, /^De beheerder schrijft: “Onderhoud van de voorbeeldinstallatie”$/);
  // Contactgegevens gaan nooit mee.
  assert.equal(kaart(werk({ title: "Gevelwerken, bel 0470 12 34 56" })).bronTekst, "");
});

test("dubbele kaarten: één werf in stukken wordt één kaart met alle GIPOD-nummers", () => {
  const stuk = (id, extra = {}) => werk({ gipodId: id, title: "R1 - Voorbeeldpark - Antwerpen", occupancyTypes: ["Wegeniswerken"], ...extra });
  const entries = pc.werkEntries([stuk(90000201), stuk(90000202), stuk(90000203), stuk(90000204, { end: "2026-12-20T16:00:00Z" })], { vandaag: VANDAAG });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].reference, "GIPOD 90000201, 90000202, 90000203");
  assert.deepEqual(entries[0].uitleg.regels.at(-1), ["Aantal", "3 dossiers in GIPOD met dezelfde soort, plek en periode"]);
  assert.equal(entries[1].reference, "GIPOD 90000204");
  // Twee aansluitingen naast elkaar (andere huisnummers in de omschrijving) zijn ook één kaart.
  const aansluiting = (id, nummer) => werk({ gipodId: id, title: `2018 ANTWERPEN, VOORBEELDSTRAAT ${nummer}`, owner: "Fluvius Site Antwerpen", ownerGroup: "Fluvius", occupancyTypes: ["Elektriciteit"], workTypes: ["klantaansluiting"] });
  assert.equal(pc.werkEntries([aansluiting(90000301, 44), aansluiting(90000302, 46)], { vandaag: VANDAAG }).length, 1);
});

test("lijst: korte datums met jaartal als het jaar niet dit jaar is", () => {
  assert.equal(pc.kortBereik("2025-12-08", "2034-01-01", VANDAAG), "8 dec 2025 → 1 jan 2034");
  assert.equal(pc.kortBereik("2026-09-01", "2026-11-20", VANDAAG), "1 sep → 20 nov");
  assert.equal(pc.kortBereik("2026-12-28", "2027-01-03", VANDAAG), "28 dec 2026 → 3 jan 2027");
  assert.equal(pc.kortDatum("2034-01-01", VANDAAG), "1 jan 2034");
  assert.equal(pc.kortDatum("2026-11-30", VANDAAG), "30 nov");
});
