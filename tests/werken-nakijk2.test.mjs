// Werkkaarten, tweede nakijkronde: hinder vóór een gepland werk krijgt haar begindatum; bij één adres
// geen huisnummer in de naam van een fase, en ook niet in wat de verversing bewaart; geen naam van een
// persoon; de juiste soort bij een netbeheerder en bij "renovatie"; het project van de beheerder
// zichtbaar; geen gevolg uit een fase buiten het district in de titel; de kop "Nu bezig" en lidwoorden.
// Alle data en namen zijn verzonnen; "vandaag" ligt vast. Namespace-imports: op de oude code faalt elke
// toets op haar eigen bewering, niet op een import.
import test from "node:test";
import assert from "node:assert/strict";

import * as ku from "../site/kaart-uitleg.js";
import * as pc from "../site/place-core.js";
import * as ref from "../lib/kaart-uitleg-refresh.mjs";

const VANDAAG = "2026-10-10";
const werk = (extra = {}) => ({
  gipodId: 90000601, title: "Werk in openbaar domein", status: "Concreet gepland", start: "2026-09-01T05:00:00Z", end: "2026-11-20T16:00:00Z",
  owner: "Voorbeeldbeheerder", ownerGroup: "Andere", workTypes: [], occupancyTypes: ["Andere"],
  streets: [{ id: "1", name: "Voorbeeldlaan", postcode: "2020" }], hindrance: null, ...extra,
});
const fluvius = { owner: "Fluvius Site Antwerpen", ownerGroup: "Fluvius" };
const kaart = (w, vandaag = VANDAAG) => ku.werkKaartje(w, { vandaag });
const regels = (k) => Object.fromEntries(k.regels);
const fase = (description, start, end, consequences) => ({ description, start, end, consequences });
const hinder = (fasen, extra = {}) => ({ severe: false, consequences: [...new Set(fasen.flatMap((f) => f.consequences))], start: fasen.map((f) => f.start).sort()[0], end: fasen.map((f) => f.end).sort().at(-1), phases: fasen, ...extra });
// Alle cijfers behalve datums, duur en postcodes: daar mag geen huisnummer tussen zitten.
const cijfersZonderDatums = (t) => t.replace(/\b\d{4}\b/g, "")
  .replace(/\b\d+ (?:dagen|dag|maanden|jaar|januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\b/g, "")
  .replace(/\b(?:van|tot) \d+\b/g, "").replace(/\bFase \d+\b/g, "");

test("1. hinder vóór of bij de start van een gepland werk krijgt altijd haar begindatum", () => {
  // Zoals GIPOD 19462234: het werk start op 9 november, de straat is alleen op 30 oktober dicht.
  const voor = kaart(werk({
    ...fluvius, start: "2026-11-09T00:00:00Z", end: "2026-11-10T16:00:00Z", occupancyTypes: ["Elektriciteit"], workTypes: ["distributienet"],
    hindrance: hinder([
      fase("Fase 1", "2026-10-29T06:00:00Z", "2026-10-30T16:00:00Z", ["Beperkte doorgang voor voetgangers", "Versmalde rijstroken"]),
      fase("Fase 3", "2026-10-30T06:00:00Z", "2026-10-30T16:00:00Z", ["Beperkte doorgang voor voetgangers", "Geen doorgang voor gemotoriseerd verkeer"]),
      fase("Fase 5", "2026-11-02T06:00:00Z", "2026-11-02T16:00:00Z", ["Beperkte doorgang voor voetgangers"]),
    ]),
  }));
  assert.equal(voor.titel, "Werken aan het elektriciteitsnet in de Voorbeeldlaan: afgesloten voor auto's op 30 oktober; werken vanaf 9 november (start over 30 dagen)");
  assert.equal(regels(voor).Duur, "9 november – 10 november · start over 30 dagen · GIPOD meldt de hinder vóór de werkperiode (van 29 oktober tot 2 november)");
  // Zoals 17942182: hinder in oktober, werk in januari.
  const lang = kaart(werk({ start: "2027-01-04T00:00:00Z", end: "2027-01-15T16:00:00Z", hindrance: hinder([fase("Fase 1", "2026-10-19T06:00:00Z", "2026-10-23T16:00:00Z", ["Beperkte doorgang voor voetgangers"])]) }));
  assert.equal(lang.titel, "Werken in de Voorbeeldlaan: voetgangers beperkt van 19 tot 23 oktober; werken vanaf 4 januari 2027 (start over 86 dagen)");
  // Zoals 17022995: hinder vanaf de eerste dag, maar veel korter dan het werk.
  const kort = kaart(werk({ start: "2026-10-19T00:00:00Z", end: "2027-01-08T16:00:00Z", hindrance: hinder([fase("Fase 1", "2026-10-19T06:00:00Z", "2026-10-23T16:00:00Z", ["Geen doorgang voor gemotoriseerd verkeer"])]) }));
  assert.equal(kort.titel, "Werken in de Voorbeeldlaan: afgesloten voor auto's van 19 tot 23 oktober; werken vanaf 19 oktober (start over 9 dagen)");
  // Hinder die samen met het werk start en (bijna) even lang loopt: één "vanaf", zoals voorheen.
  const samen = kaart(werk({ start: "2026-10-26T00:00:00Z", end: "2026-11-20T16:00:00Z", hindrance: hinder([fase("Fase 1", "2026-10-26T06:00:00Z", "2026-11-20T16:00:00Z", ["Geen doorgang voor gemotoriseerd verkeer"])]) }));
  assert.equal(samen.titel, "Werken in de Voorbeeldlaan: afgesloten voor auto's vanaf 26 oktober (start over 16 dagen)");
  // Hinder die al loopt vóór een gepland werk: "tot" klopt dan wel, en "Duur" zegt dat ze vóór het werk valt.
  const loopt = kaart(werk({ start: "2026-11-09T00:00:00Z", end: "2026-11-20T16:00:00Z", hindrance: hinder([fase("Fase 1", "2026-10-05T06:00:00Z", "2026-10-30T16:00:00Z", ["Geen doorgang voor gemotoriseerd verkeer"])]) }));
  assert.equal(loopt.titel, "Werken in de Voorbeeldlaan: afgesloten voor auto's tot 30 oktober; werken vanaf 9 november (start over 30 dagen)");
  assert.match(regels(loopt).Duur, / · GIPOD meldt de hinder vóór de werkperiode \(van 5 tot 30 oktober\)$/);
});

test("2. bij één adres staat het huisnummer ook niet in de naam van een fase", () => {
  // Zoals 19929983: "Fase 1 Simonsstraat 8" naast "huisnummer weggelaten: het gaat om één adres".
  const w = werk({
    ...fluvius, title: "2018 ANTWERPEN, VOORBEELDLAAN 8", occupancyTypes: ["Elektriciteit"], workTypes: ["klantaansluiting"], start: "2026-10-14T00:00:00Z", end: "2026-10-21T16:00:00Z",
    hindrance: hinder([fase("Fase 1 Voorbeeldlaan 8", "2026-10-15T06:00:00Z", "2026-10-16T16:00:00Z", ["Beperkte doorgang voor voetgangers"])]),
  });
  const k = kaart(w);
  assert.match(regels(k).Waar, /huisnummer weggelaten: het gaat om één adres/);
  assert.equal(regels(k).Fasen, "Fase 1 Voorbeeldlaan (15 oktober – 16 oktober): voetgangers beperkt");
  const alles = [k.titel, k.samenvatting, k.bronTekst, ...k.regels.flat()].join(" ");
  assert.doesNotMatch(cijfersZonderDatums(alles), /\d/, alles);
  // Ook als de fasen uit een oudere verversing komen (kaart-uitleg.json) en de live laag er geen heeft.
  const bewaard = { werken: { 90000601: { soort: "Nieuwe aansluiting op het elektriciteitsnet", fasen: [{ naam: "Fase 1 Voorbeeldlaan 8", start: "2026-10-15", eind: "2026-10-16" }], huisnummers: "nr. 8", huisnummerBron: "x" } } };
  const e = pc.workEntry({ ...w, hindrance: null }, { vandaag: VANDAAG, uitleg: bewaard });
  assert.equal(Object.fromEntries(e.uitleg.regels).Fasen, "Fase 1 Voorbeeldlaan (15 oktober – 16 oktober)");
  assert.doesNotMatch(e.title, /nr\. 8/);
  // Een volgnummer van een fase is geen huisnummer.
  assert.equal(ku.zonderHuisnummers("Fase 2 Voorbeeldlaan 14 - deel 3"), "Fase 2 Voorbeeldlaan - deel 3");
});

test("3. de soort: een netbeheerder werkt aan zijn net, en \"renovatie\" is alleen bij een gebouw een bouwwerf", () => {
  // Zoals 20092573: "Renovatie Havenwegen" van AWV is geen bouwwerf.
  const awv = kaart(werk({ owner: "Agentschap Wegen en Verkeer", title: "N1800001 - Renovatie Voorbeeldwegen N180 - Voorbeeldhaven - Antwerpen", occupancyTypes: ["Wegeniswerken;Andere;Elektriciteit;Riolering"], workTypes: ["toplaag;(her)aanleg"] }));
  assert.match(awv.titel, /^Wegen- en nutswerken in de Voorbeeldlaan /);
  assert.equal(ku.soortWerk([{ tekst: "Renovatie van de woning", bron: "x" }]).soort, "Bouwwerf");
  assert.equal(ku.soortWerk([{ tekst: "Gevelrenovatie", bron: "x" }]).soort, "Gevelwerken");
  // Zoals 15277243: "E, G, OV, Wegeniswerken" van Fluvius: de netten eerst, de wegenwerken erbij.
  const wapper = kaart(werk({ ...fluvius, title: "2000 ANTWERPEN VOORBEELDLAAN E, G, OV, Wegeniswerken", occupancyTypes: ["Elektriciteit;Olie, gas, chemicaliën;Openbare verlichting"], workTypes: ["distributienet"] }));
  assert.match(wapper.titel, /^Werken aan gas, elektriciteit en straatverlichting, samen met wegenwerken in de Voorbeeldlaan /);
  // Zoals 20730319 en 19952628: een voetpadkast en de bestrating van een werkput zijn geen wegenwerken.
  const kast = kaart(werk({ ...fluvius, title: "2020_ANTWERPEN-Voorbeeldwijk_Voorbeeldlaan LS_voetpadkast vervangen wegens schade", occupancyTypes: ["Elektriciteit"], workTypes: ["distributienet;herstel/onderhoud"] }));
  assert.match(kast.titel, /^Werken aan het elektriciteitsnet in de Voorbeeldlaan /);
  const put = kaart(werk({ ...fluvius, title: "2060 ANTWERPEN, VOORBEELDLAAN 9 Grondwerk Werkput (openb): Bestrating, 1 st Sleufwerk (openb): Volle grond, 19 m", occupancyTypes: ["Elektriciteit"] }));
  assert.match(put.titel, /^Werken aan het elektriciteitsnet in de Voorbeeldlaan /);
  assert.equal(ku.soortWerk([{ tekst: "LS_voetpadkast vervangen", bron: "x" }]).soort, "");
  // Een wegbeheerder die voetpaden heraanlegt, doet nog altijd wegenwerken.
  assert.match(kaart(werk({ owner: "Stad Antwerpen - Voorbeelddienst", title: "Heraanleg voetpaden", occupancyTypes: ["Wegeniswerken;Elektriciteit"] })).titel, /^Wegenwerken in de Voorbeeldlaan /);
});

test("4. wat de beheerder over het project zegt, staat zichtbaar, zonder adres, netcodes en soortwoorden", () => {
  // Zoals 18184624 (Emiel Vloorsstraat): "R1 - Ringpark Zuid" verdween in het ingeklapte blok.
  const ring = kaart(werk({ owner: "Agentschap Wegen en Verkeer", title: "R1 - Voorbeeldpark Zuid - Antwerpen", occupancyTypes: ["Kunstwerk;Wegeniswerken;Andere;Elektriciteit"] }));
  assert.equal(regels(ring).Wat, "Wegen- en nutswerken, afgeleid uit de soort inname in GIPOD. Volgens de beheerder: “R1 - Voorbeeldpark Zuid”. Volgens GIPOD: brug, tunnel of viaduct · wegenwerken · elektriciteit.");
  assert.match(ring.samenvatting, /^Volgens de beheerder: R1 - Voorbeeldpark Zuid\. Opdrachtgever: /);
  // Zoals 15844861 (Argentiniëlaan): de straat van de kaart en de postcode vallen weg.
  assert.equal(ku.projectTekst("2030 Antwerpen - Voorbeeldsite - Voorbeeldlaan - Anderesteenweg Aanleg warmtenet totaal: 2750m", { straten: ["Voorbeeldlaan"] }), "Voorbeeldsite - Anderesteenweg Aanleg warmtenet totaal: 2750m");
  assert.equal(ku.projectTekst("2018 ANTWERPEN ANDERESTRAAT E, Regio – Energietransitie (lengte: 355m)", { straten: ["Voorbeeldlaan"] }), "Regio – Energietransitie");
  assert.equal(ku.projectTekst("Locatie: Voorbeeldlaan 272-274 Aard van de werken: Betonherstel op trambaan", { straten: ["Voorbeeldlaan"] }), "Betonherstel op trambaan");
  // Een lopende zin blijft heel, ook als de straat van de kaart erin staat.
  assert.equal(ku.projectTekst("Peilbuizen plaatsen in de berm van de Voorbeeldlaan.", { straten: ["Voorbeeldlaan"] }), "Peilbuizen plaatsen in de berm van de Voorbeeldlaan.");
  assert.equal(ku.projectTekst("2050 ANTWERPEN VOORBEELDLAAN E Klantaansluiting, Verkaveling (lengte: 548m)", { straten: ["Voorbeeldlaan"] }), "Verkaveling");
  // Niets meer dan adres en codes: geen projectregel.
  assert.equal(ku.projectTekst("2000 ANTWERPEN VOORBEELDLAAN E, G, OV, Wegeniswerken", { straten: ["Voorbeeldlaan"] }), "");
  assert.equal(ku.projectTekst("2018 Antwerpen: Voorbeeldlaan - Andere", { straten: ["Voorbeeldlaan"] }), "");
  assert.equal(ku.projectTekst("Anderestraat | 39", { straten: ["Voorbeeldlaan"] }), "");
  assert.equal(ku.projectTekst("2018 Antwerpen - (Antwerpen) - Voorbeeldlaan 24. - werken aan nutsleiding - 13m.", { straten: ["Voorbeeldlaan"] }), "");
  // Herhaalt de tekst alleen de soort, dan geen regel ("Riolering" bij "Rioleringswerken").
  assert.doesNotMatch(regels(kaart(werk({ title: "Riolering" }))).Wat, /Volgens de beheerder/);
  assert.doesNotMatch(regels(kaart(werk({ ...fluvius, title: "2000 ANTWERPEN VOORBEELDLAAN E, G, OV, Wegeniswerken", occupancyTypes: ["Elektriciteit"] }))).Wat, /Volgens de beheerder/);
});

test("5. de verversing bewaart bij één adres geen huisnummer en zoekt het niet op; geen naam na een dossiercode", async () => {
  const aansluiting = werk({ ...fluvius, title: "2018 ANTWERPEN, VOORBEELDLAAN 8", occupancyTypes: ["Elektriciteit"], workTypes: ["klantaansluiting"], lastModified: "2026-10-01T00:00:00Z",
    start: "2026-10-14T00:00:00Z", end: "2026-10-21T16:00:00Z", hindrance: hinder([fase("Fase 1 Voorbeeldlaan 8", "2026-10-15T06:00:00Z", "2026-10-16T16:00:00Z", ["Beperkte doorgang voor voetgangers"])]) });
  const f = ku.werkFeiten(aansluiting, { huisnummers: "nr. 8", huisnummerBron: "afgeleid uit de werfzone en het adressenregister" });
  assert.equal(f.huisnummers, "");
  assert.equal(f.huisnummerBron, "");
  assert.equal(f.omschrijving, "2018 ANTWERPEN, VOORBEELDLAAN");
  assert.deepEqual(f.fasen.map((x) => x.naam), ["Fase 1 Voorbeeldlaan"]);
  // De verversing zoekt het adres niet op en neemt een oud adres niet over.
  const calls = [];
  const fakeFetch = async (url) => { calls.push(String(url)); return { ok: true, json: async () => ({ features: [] }) }; };
  const vorige = { werken: { 90000601: { soort: "Nieuwe aansluiting op het elektriciteitsnet", bijgewerkt: "2026-10-01T00:00:00Z", adres: "nr. 8", huisnummers: "nr. 8", fasen: [], straten: [], gevolgen: [] } } };
  const { document } = await ref.bouwKaartUitleg({ works: [aansluiting], fetch: fakeFetch, clock: () => new Date("2026-10-10T05:00:00Z"), vorige });
  assert.deepEqual(calls, []);
  const bewaard = document.werken["90000601"];
  assert.equal(bewaard.huisnummers, "");
  assert.equal("adres" in bewaard, false);
  assert.doesNotMatch(JSON.stringify(bewaard), /VOORBEELDLAAN 8|Voorbeeldlaan 8|nr\. 8/);
  // Een naam na een dossiercode is een persoon: niet bewaren, niet tonen. De code zelf blijft.
  const naam = ku.werkFeiten(werk({ ...fluvius, title: "2020_ANTWERPEN-Voorbeeldwijk_Voorbeeldlaan 28 DNW12345678_Jan Voorbeeldman LS_voetpadkast vervangen", occupancyTypes: ["Elektriciteit"] }));
  assert.doesNotMatch(naam.omschrijving, /Jan|Voorbeeldman/);
  assert.match(naam.omschrijving, /DNW12345678_ LS_voetpadkast vervangen$/);
  assert.equal(ku.zonderNamen("Spoorwerken PG0971_N1_Intra_Muros"), "Spoorwerken PG0971_N1_Intra_Muros");
});

test("6. een fase buiten het district (andere postcode) geeft geen gevolg in de titel", () => {
  // Zoals 17090671 (Beatrijslaan): de enige hinder ligt in een fase in postcode 2070.
  const k = kaart(werk({
    ...fluvius, title: "2050 ANTWERPEN VOORBEELDLAAN E, G, OV, Wegeniswerken (lengte: 7427m)", status: "In uitvoering", start: "2025-11-03T00:00:00Z", end: "2027-01-05T16:00:00Z",
    occupancyTypes: ["Elektriciteit;Olie, gas, chemicaliën;Openbare verlichting"], workTypes: ["distributienet"],
    hindrance: hinder([fase("2070 Voorbeeldgemeente, Andere Voorbeeldlaan : Werken aan nutsvoorzieningen (kleine hinder)", "2026-10-19T06:00:00Z", "2026-10-23T16:00:00Z", ["Beperkte doorgang voor voetgangers", "Parkeerverbod"])]),
  }));
  assert.equal(k.titel, "Werken aan gas, elektriciteit en straatverlichting, samen met wegenwerken in de Voorbeeldlaan tot 5 januari 2027 (nog 87 dagen)");
  // Met daarnaast een fase in de straat zelf (met een dossiernummer in de naam): dan haar gevolg, en ze staat bij "Fasen".
  const beide = kaart(werk({
    ...fluvius, title: "2050 ANTWERPEN VOORBEELDLAAN E, G, OV, Wegeniswerken (lengte: 7427m)", status: "In uitvoering", start: "2025-11-03T00:00:00Z", end: "2027-01-05T16:00:00Z",
    occupancyTypes: ["Elektriciteit;Olie, gas, chemicaliën;Openbare verlichting"], workTypes: ["distributienet"],
    hindrance: hinder([
      fase("2070 Voorbeeldgemeente, Andere Voorbeeldlaan : Werken aan nutsvoorzieningen (kleine hinder)", "2026-10-19T06:00:00Z", "2026-10-23T16:00:00Z", ["Beperkte doorgang voor voetgangers", "Parkeerverbod"]),
      fase("Antwerpen - Voorbeeldlaan - 20330374 - Koppelput", "2026-10-19T06:00:00Z", "2026-10-23T16:00:00Z", ["Beperkte doorgang voor fietsers"]),
    ]),
  }));
  assert.match(beide.titel, /in de Voorbeeldlaan: fietsers beperkt van 19 tot 23 oktober; werken tot 5 januari 2027/);
  assert.match(regels(beide).Fasen, / · Antwerpen - Voorbeeldlaan - Koppelput \(19 oktober – 23 oktober\): fietsers beperkt$/);
  assert.doesNotMatch(k.samenvatting, /voetgangers|parkeerverbod/i);
  assert.match(regels(k).Fasen, /^2070 Voorbeeldgemeente, Andere Voorbeeldlaan : Werken aan nutsvoorzieningen \(kleine hinder\) \(buiten district Antwerpen\) \(19 oktober – 23 oktober\)/);
  assert.match(regels(k).Gevolgen, / · deels in een fase buiten district Antwerpen \(zie Fasen\)$/);
  // Een fase in het district telt wel; een fase zonder postcode ook.
  assert.equal(ku.faseBuitenDistrict("2018 Antwerpen, Voorbeeldlaan"), false);
  assert.equal(ku.faseBuitenDistrict("Fase 1"), false);
  assert.equal(ku.faseBuitenDistrict("2600 Berchem, Voorbeeldlaan"), true);
  const gemengd = kaart(werk({ status: "In uitvoering", start: "2026-09-01T00:00:00Z", end: "2027-01-05T16:00:00Z", hindrance: hinder([
    fase("2070 Voorbeeldgemeente, Andere Voorbeeldlaan", "2026-10-19T06:00:00Z", "2026-10-23T16:00:00Z", ["Geen doorgang voor gemotoriseerd verkeer"]),
    fase("2020 Antwerpen, Voorbeeldlaan", "2026-09-01T06:00:00Z", "2026-11-30T16:00:00Z", ["Beperkte doorgang voor voetgangers"]),
  ]) }));
  assert.equal(gemengd.titel, "Werken in de Voorbeeldlaan: voetgangers beperkt tot 30 november; werken tot 5 januari 2027 (nog 87 dagen)");
});

test("7. de kop boven wat loopt zegt niet \"Nu bezig\" als er een kaart met \"Periode loopt\" onder staat", () => {
  const lopend = { source: "works", group: "werken", start: "2026-09-01", end: "2026-11-20", status: "Concreet gepland" };
  assert.equal(pc.lopendKop?.([lopend], VANDAAG)?.titel, "Loopt nu");
  assert.equal(pc.periodeBadge(lopend, VANDAAG)?.label, "Periode loopt");
  assert.match(pc.lopendKop([lopend], VANDAAG).noot, /Periode loopt/);
  assert.equal(pc.lopendKop([{ ...lopend, status: "In uitvoering" }], VANDAAG).titel, "Nu bezig");
});

test("8. lidwoorden: een plein, een vliet of de Singel is \"op de\"", () => {
  // "in Wapper", "in Oudaan", "in de Singel", "in de Sint-Jansvliet" uit de nakijkronde.
  assert.match(kaart(werk({ streets: [{ id: "9", name: "Wapper", postcode: "2000" }] })).titel, /^Werken op de Wapper /);
  assert.match(kaart(werk({ streets: [{ id: "9", name: "Sint-Jansvliet", postcode: "2000" }] })).titel, /^Werken op de Sint-Jansvliet /);
  assert.equal(ku.opStraat("Oudaan"), "op de Oudaan");
  assert.equal(ku.opStraat("Singel"), "op de Singel");
  assert.equal(ku.opStraat("Voorbeeldstraat"), "in de Voorbeeldstraat");
});
