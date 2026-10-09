// Werkkaarten, nakijkronde: wat de kaart zegt moet kloppen. Een netproject is geen aansluiting van één
// adres; "geen straat in de buurt" alleen als er gezocht is; geen huisnummer in de tekst van de
// beheerder bij één adres; een hoogtewerker zegt niet wat er gebeurt; "doorloopstelling" is geen sloop;
// geen "werken tot" vóór de hinder; "op 12 oktober" en geen dubbele datum; maanden in plaats van
// "ruim een jaar"; alleen een kruispunt als de straten elkaar raken; en de straat die de beheerder noemt
// verdwijnt niet. Alle data is verzonnen; "vandaag" ligt vast. Namespace-imports: op de oude code faalt
// elke toets op haar eigen bewering, niet op een import.
import test from "node:test";
import assert from "node:assert/strict";

import * as ku from "../site/kaart-uitleg.js";
import * as sc from "../site/street-core.js";

const VANDAAG = "2026-10-09";
const werk = (extra = {}) => ({
  gipodId: 90000501, title: "Werk in openbaar domein", status: "In uitvoering", start: "2026-09-01T05:00:00Z", end: "2026-11-20T16:00:00Z",
  owner: "Voorbeeldbeheerder", ownerGroup: "Andere", workTypes: [], occupancyTypes: ["Andere"],
  streets: [{ id: "1", name: "Voorbeeldstraat", postcode: "2000" }], hindrance: null, ...extra,
});
const kaart = (w, vandaag = VANDAAG) => ku.werkKaartje(w, { vandaag });
const regels = (k) => Object.fromEntries(k.regels);
const alleTekst = (k) => [k.titel, k.samenvatting, k.plek, k.bronTekst || "", ...k.regels.flat()].join(" ");
const hinder = (fasen) => ({ severe: false, consequences: [...new Set(fasen.flatMap((f) => f.consequences))], start: fasen[0].start, end: fasen.at(-1).end, phases: fasen });
const fluvius = { owner: "Fluvius Site Antwerpen", ownerGroup: "Fluvius" };
// Straatassen zoals de stad ze geeft: een naam links en rechts; " " is een as zonder naam (zoals de Ring).
const as = (naam, coords, id = naam.length) => ({ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: { LSTRNMID: naam.trim() ? id : -9, LSTRNM: naam, RSTRNMID: naam.trim() ? id : -9, RSTRNM: naam, postcode: "2000", DISTRICT: "Antwerpen" } });

test("1. een netproject met \"klantaansluiting\" is geen aansluiting van één adres", () => {
  // 5898 m elektriciteit en straatverlichting, grondwerk distributienet;klantaansluiting.
  const net = kaart(werk({
    ...fluvius, title: "2050 ANTWERPEN VOORBEELDLAAN E, OV Klantaansluiting, Wegeniswerken (lengte: 5898m)",
    occupancyTypes: ["Elektriciteit;Openbare verlichting"], workTypes: ["distributienet;klantaansluiting"], streets: [{ id: "2", name: "Voorbeeldlaan", postcode: "2050" }],
  }));
  assert.match(net.titel, /^Werken aan elektriciteit en straatverlichting in de Voorbeeldlaan /);
  assert.doesNotMatch(alleTekst(net), /Nieuwe aansluiting|één adres/);
  assert.match(net.bronTekst, /lengte: 5898m/); // de tekst van de beheerder blijft nalezen
  // Een verkaveling is ook meer dan één adres.
  const verkaveling = kaart(werk({ ...fluvius, title: "2050 ANTWERPEN VOORBEELDLAAN E Klantaansluiting, Verkaveling (lengte: 548m)", occupancyTypes: ["Elektriciteit"], workTypes: ["verkaveling;klantaansluiting"] }));
  assert.match(verkaveling.titel, /^Werken aan het elektriciteitsnet in de Voorbeeldstraat /);
  assert.doesNotMatch(regels(verkaveling).Waar, /één adres/);
  // Zonder soort inname, met het net in de tekst.
  assert.match(kaart(werk({ title: "Klantaansluiting elektriciteit en uitbreiding net", workTypes: ["distributienet;klantaansluiting"] })).titel, /^Werken aan het elektriciteitsnet /);
  // Een echte aansluiting blijft een aansluiting.
  assert.match(kaart(werk({ ...fluvius, title: "2000 ANTWERPEN, VOORBEELDSTRAAT 12", occupancyTypes: ["Elektriciteit"], workTypes: ["klantaansluiting"] })).titel, /^Nieuwe aansluiting op het elektriciteitsnet /);
});

test("2. een as zonder naam telt niet als straat: dan de straat uit de omschrijving, of eerlijk wat er gezocht is", () => {
  const index = sc.buildStreetIndex([
    as(" ", [[4.400, 51.2000], [4.410, 51.2000]]), // as zonder naam, het punt ligt erop
    as("Voorbeeldplein", [[4.400, 51.2015], [4.410, 51.2015]]), // ongeveer 166 m verder
  ]);
  const [genoemd, niets, geenPunt] = sc.applyWorkStreetResolution([
    { point: [4.405, 51.2000], title: "2000 Antwerpen Voorbeeldplein 26 werken distributieleiding)" },
    { point: [4.405, 51.2000], title: "Werk in openbaar domein" },
    { title: "Werk in openbaar domein" },
  ], index);
  assert.deepEqual(genoemd.streets.map((s) => s.name), ["Voorbeeldplein"]);
  assert.equal(genoemd.streetResolution, "official_address_match");
  const k = kaart(werk({ ...genoemd, occupancyTypes: ["Water"] }));
  assert.match(k.titel, /^Werken aan de waterleiding op het Voorbeeldplein nr\. 26 /);
  assert.match(regels(k).Waar, /^Voorbeeldplein, nr\. 26 \(straat en huisnummer uit de omschrijving van de beheerder; het punt in GIPOD ligt er ongeveer 16\d m van\)$/);
  // Gezocht, en geen straat met naam binnen 150 m: zeg dat, niet "geen straat in de buurt".
  assert.deepEqual(niets.streets, []);
  assert.deepEqual(niets.streetNearby, []);
  const leeg = kaart(werk({ ...niets }));
  assert.equal(regels(leeg).Waar, "Alleen als punt op de kaart van GIPOD; geen straat met naam binnen 150 m van dat punt");
  // Niet gezocht (geen punt, of de straatassen laadden niet): dan ook niet beweren dat er niets is.
  assert.equal(geenPunt.streetNearby, undefined);
  const onbekend = kaart(werk({ streets: [], streetResolution: "unresolved" }));
  assert.equal(regels(onbekend).Waar, "Alleen als punt op de kaart van GIPOD; de straat kon nu niet bepaald worden");
  for (const x of [leeg, onbekend]) assert.doesNotMatch(alleTekst(x), /geen straat in de buurt gevonden/);
});

test("3. bij één adres staat nergens een huisnummer, ook niet in de tekst van de beheerder", () => {
  const vormen = ["LANGE VOORBEELDSTRAAT 79WERF", "VOORBEELDSTRAAT 6werf", "VOORBEELDBROEK 4B_BIS", "SINT-VOORBEELDVLIET 9", "VOORBEELDUIT 29", "Voorbeeldsteeg | 13"];
  for (const vorm of vormen) {
    const t = ku.beheerderTekst(`2018 ANTWERPEN, ${vorm}, kabel naar de achterbouw`, { zonderNummers: true, straten: [] });
    assert.match(t, /achterbouw/, vorm);
    assert.doesNotMatch(t.replace(/\b\d{4}\b/g, ""), /\d/, `${vorm} → ${t}`);
    const k = kaart(werk({ ...fluvius, title: `2018 ANTWERPEN, ${vorm}, kabel naar de achterbouw`, occupancyTypes: ["Elektriciteit"], workTypes: ["klantaansluiting"] }));
    assert.match(regels(k).Waar, /huisnummer weggelaten: het gaat om één adres/);
    assert.doesNotMatch(alleTekst(k).replace(/\b\d{4}\b/g, "").replace(/\b\d+ (?:dagen|dag|maanden|jaar|januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\b/g, ""), /\d/, `${vorm} → ${alleTekst(k)}`);
  }
  // Een maat of een postcode is geen huisnummer.
  assert.equal(ku.beheerderTekst("2000 Antwerpen - Voorbeeldstraat - Plaatsen leidingen - 25m", { zonderNummers: true }), "2000 Antwerpen - Voorbeeldstraat - Plaatsen leidingen - 25m");
});

test("4. een hoogtewerker is een middel: \"Nutswerken met een hoogtewerker\", en een tunnelsluiting blijft wegenwerken", () => {
  assert.match(kaart(werk({ title: "2018 | Antwerpen | Voorbeeldstraat | 91", occupancyTypes: ["Hoogtewerker;Nutswerken"] })).titel, /^Nutswerken met een hoogtewerker in de Voorbeeldstraat /);
  const tunnel = kaart(werk({
    occupancyTypes: ["Wegeniswerken"], streets: [{ id: "3", name: "Voorbeeldtunnel", postcode: "2000" }],
    hindrance: hinder([
      { description: "Lossen hoogtewerkers Voorbeeldtunnel", start: "2026-10-26T04:00:00Z", end: "2026-10-26T14:00:00Z", consequences: ["Vermindering van rijstroken"] },
      { description: "Onderhoudssluiting Voorbeeldtunnel nacht 1", start: "2026-10-26T20:00:00Z", end: "2026-10-27T05:00:00Z", consequences: ["Geen doorgang voor gemotoriseerd verkeer"] },
    ]),
  }));
  assert.match(tunnel.titel, /^Wegenwerken in de Voorbeeldtunnel: afgesloten voor auto's /);
  assert.doesNotMatch(tunnel.titel, /hoogtewerker/);
  // Alleen een hoogtewerker, niets anders: dan blijft hij staan.
  assert.match(kaart(werk({ occupancyTypes: ["Hoogtewerker"] })).titel, /^Werk met een hoogtewerker /);
});

test("5. een doorloop-, gevel- of torenstelling is een stelling, een herstelling niet", () => {
  const doorloop = kaart(werk({ hindrance: hinder([
    { description: "Fase 3 - instandhouding doorloopstelling", start: "2026-08-14T05:00:00Z", end: "2027-01-20T16:00:00Z", consequences: [] },
    { description: "Fase 4 - afbraak & ophaling doorloopstelling", start: "2027-01-21T04:00:00Z", end: "2027-01-21T08:00:00Z", consequences: [] },
  ]) }));
  assert.match(doorloop.titel, /^Stelling \(steiger\) /);
  for (const t of ["Gevelstelling", "Plaatsen torenstelling"]) assert.equal(ku.soortWerk([{ tekst: t, bron: "x" }]).soort, "Stelling (steiger)", t);
  assert.equal(ku.soortWerk([{ tekst: "Herstelling van de rijweg", bron: "x" }]).soort, "Wegenwerken");
});

test("6. hinder die pas na het einde van het werk begint: geen \"werken tot\" ervoor", () => {
  const k = kaart(werk({
    start: "2024-10-24T22:01:00Z", end: "2026-10-09T21:59:00Z",
    hindrance: hinder([{ description: "Fase 2", start: "2026-10-20T04:00:00Z", end: "2026-11-06T16:00:00Z", consequences: ["Beperkte doorgang voor fietsers"] }]),
  }));
  assert.equal(k.titel, "Werken in de Voorbeeldstraat: fietsers beperkt van 20 oktober tot 6 november");
  assert.match(regels(k).Duur, / · laatste dag vandaag · GIPOD meldt nog hinder tot 6 november$/);
  // Een werk dat nog moet beginnen, houdt zijn startdatum.
  const gepland = kaart(werk({ start: "2026-10-26T05:00:00Z", end: "2026-11-10T16:00:00Z", hindrance: hinder([{ description: "Fase 1", start: "2026-11-23T04:00:00Z", end: "2026-11-27T16:00:00Z", consequences: ["Geen doorgang voor gemotoriseerd verkeer"] }]) }));
  assert.equal(gepland.titel, "Werken in de Voorbeeldstraat: afgesloten voor auto's van 23 tot 27 november; werken vanaf 26 oktober (start over 17 dagen)");
});

test("7. een eigen periode in gewone taal: \"op 12 oktober\", geen dubbele datum, geen ruis van één dag", () => {
  const eenDag = kaart(werk({ start: "2026-03-27T06:00:00Z", end: "2026-12-18T16:00:00Z", hindrance: hinder([
    { description: "Afwerking", start: "2026-09-16T05:00:00Z", end: "2026-12-18T16:00:00Z", consequences: [] },
    { description: "Eén dag dicht", start: "2026-10-12T05:00:00Z", end: "2026-10-12T15:00:00Z", consequences: ["Geen doorgang voor gemotoriseerd verkeer"] },
  ]) }));
  assert.match(eenDag.titel, /: afgesloten voor auto's op 12 oktober; werken tot 18 december \(nog 70 dagen\)$/);
  // Alleen op de laatste dag van het werk: die datum één keer.
  const laatste = kaart(werk({ start: "2026-01-05T05:00:00Z", end: "2027-01-04T16:00:00Z", hindrance: hinder([{ description: "Fase 9", start: "2027-01-04T05:00:00Z", end: "2027-01-04T16:00:00Z", consequences: ["Beperkte doorgang voor voetgangers"] }]) }));
  assert.equal(laatste.titel, "Werken in de Voorbeeldstraat: voetgangers beperkt op 4 januari 2027, de laatste dag van de werken (nog 87 dagen)");
  // Eén dag korter dan het werk: geen "tot 15 februari 2028; werken tot 16 februari 2028".
  const bijna = kaart(werk({ start: "2026-01-05T05:00:00Z", end: "2028-02-16T16:00:00Z", hindrance: hinder([{ description: "Fase 1", start: "2026-01-05T05:00:00Z", end: "2028-02-15T16:00:00Z", consequences: ["Vermindering van rijstroken"] }]) }));
  assert.equal(bijna.titel, "Werken in de Voorbeeldstraat: minder rijstroken tot 15 februari 2028 (nog ruim 16 maanden)");
  // Een gevolg van een paar dagen midden in het werk: "van … tot …".
  assert.equal(ku.vanTot("2026-11-02", "2026-11-06", VANDAAG), "van 2 tot 6 november");
  assert.equal(ku.vanTot("2026-11-30", "2027-10-02", VANDAAG), "van 30 november 2026 tot 2 oktober 2027");
});

test("8. tussen een en twee jaar in maanden, niet \"ruim een jaar\"", () => {
  assert.equal(ku.resterendeDuur({ start: "2026-01-01", eind: "2028-07-01", vandaag: VANDAAG }).tekst, "nog ruim 20 maanden");
  assert.equal(ku.resterendeDuur({ start: "2026-01-01", eind: "2027-10-09", vandaag: VANDAAG }).tekst, "nog 12 maanden");
  assert.equal(ku.resterendeDuur({ start: "2027-11-20", eind: "2028-01-01", vandaag: VANDAAG }).tekst, "start over ruim 13 maanden");
  assert.equal(ku.resterendeDuur({ start: "2026-01-01", eind: "2034-01-01", vandaag: VANDAAG }).tekst, "nog ruim 7 jaar");
  assert.equal(ku.resterendeDuur({ start: "2026-01-01", eind: "2026-11-20", vandaag: VANDAAG }).tekst, "nog 42 dagen");
});

test("9. alleen een kruispunt als de straten elkaar raken; de straat die de beheerder noemt, wint", () => {
  // Twee evenwijdige straten op ongeveer 30 m van elkaar, het punt ertussen.
  const index = sc.buildStreetIndex([
    as("Astraat", [[4.400, 51.20000], [4.410, 51.20000]], 11),
    as("Bestraat", [[4.400, 51.20027], [4.410, 51.20027]], 12),
    as("Celaan", [[4.420, 51.19500], [4.420, 51.20500]], 13), // kruist Destraat
    as("Destraat", [[4.415, 51.20000], [4.425, 51.20000]], 14),
  ]);
  const [tussen, hoek, genoemd] = sc.applyWorkStreetResolution([
    { point: [4.405, 51.200135], title: "Werk in openbaar domein" },
    { point: [4.42005, 51.20005], title: "Werk in openbaar domein" },
    { point: [4.405, 51.200135], title: "2000 ANTWERPEN, BESTRAAT 124" },
  ], index);
  assert.equal(tussen.streetResolution, "ambiguous");
  assert.equal(tussen.streetsMeet, false);
  const kt = kaart(werk({ ...tussen }));
  assert.match(kt.titel, /^Werken tussen Astraat en Bestraat /);
  assert.doesNotMatch(alleTekst(kt), /kruispunt/);
  assert.match(regels(kt).Waar, /de twee straten raken elkaar daar niet/);
  assert.equal(hoek.streetsMeet, true);
  assert.match(kaart(werk({ ...hoek })).titel, /^Werken bij het kruispunt van Celaan en Destraat /);
  // De beheerder schrijft "BESTRAAT 124": dan die straat, niet "tussen" of "kruispunt".
  assert.deepEqual(genoemd.streets.map((s) => s.name), ["Bestraat"]);
  assert.match(kaart(werk({ ...genoemd })).titel, /^Werken in de Bestraat /);
});

test("10. noemt de beheerder een andere straat dan de kaart, dan blijft zijn tekst staan", () => {
  assert.equal(ku.beheerderTekst("2000 | Antwerpen | Anderestraat | 38", { straten: ["Voorbeeldstraat"] }), "2000 | Antwerpen | Anderestraat | 38");
  const k = kaart(werk({ title: "2000 | Antwerpen | Anderestraat | 38", occupancyTypes: ["Hoogtewerker;Nutswerken"] }));
  assert.match(k.bronTekst, /Anderestraat/);
  // Alleen het adres van de kaart zelf (ook in hoofdletters zonder trema): geen herhaling.
  assert.equal(ku.beheerderTekst("2030 ANTWERPEN, VOORBEELDIELAAN", { straten: ["Voorbeeldiëlaan"] }), "");
  assert.equal(ku.beheerderTekst("2018 Antwerpen: Voorbeeldstraat - Andere", { straten: ["Voorbeeldstraat"] }), "");
});
