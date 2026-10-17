// De privacyfilter van de vrije tekst uit A-Sign (innameBeschrijving) als WITTE LIJST (site/witte-lijst.js), na de
// nakijkronde van head ba03ff4: na twee rondes met een zwarte lijst van naamvormen (lijktPersoonsnaam) bleven er steeds
// nieuwe vormen doorglippen. Nu blijft uit de tekst alleen over wat aantoonbaar een plek of een trefwoord is: een
// volledige officiële straatnaam (exact, hele naam), een woord uit de vaste lijst van soorten plekken en gebeurtenissen,
// of een district, wijk of bekende plek uit de vaste lijst. Al de rest valt weg.
//
// Deze toetsen kijken niet of de filter een naam herkent, maar of er van een naam niets overblijft: geen enkel woord van
// de naam in de uitvoer van bruikbareBeschrijving, veiligeOmschrijving en plaatsnaamVan, geen cijfer, geen @. Elke toets
// met "ba03ff4" in de naam faalt op ba03ff4 (de zwarte lijst) en slaagt nu. Alleen verzonnen proefdata (Testpersoon,
// Voorbeeld, Proefstraat, .test-domeinen); geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as KU from "../site/kaart-uitleg.js";
import * as PN from "../lib/plaatsnaam.mjs";
import * as PC from "../site/place-core.js";
import * as EW from "../site/evenement-wat.js";

// De woorden van een tekst zoals een lezer ze ziet: zonder accenten, onzichtbare tekens of hoofdletters.
const woorden = (t) => (String(t ?? "").normalize("NFKC").replace(/[\p{Cf}]/gu, "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
const uitvoer = (t, opties = {}) => [
  KU.bruikbareBeschrijving(t, opties),
  KU.veiligeOmschrijving(`Inname: ${t}`, opties),
  PN.plaatsnaamVan(t, { isStraat: opties.isStraat || (() => false), rond: (opties.straten || []).map((s) => s?.name ?? s) }),
];
// Van de naam (één of meer woorden) blijft niets over, ook geen cijfer of @.
const geenNaam = (t, naam, opties = {}) => {
  const verboden = woorden(naam).filter((w) => w.length >= 2);
  for (const uit of uitvoer(t, opties)) {
    const hier = new Set(woorden(uit));
    for (const v of verboden) assert.ok(!hier.has(v), `${JSON.stringify(t)} gaf ${JSON.stringify(uit)}: "${v}" blijft staan`);
    assert.doesNotMatch(uit, /\d|@|＠/u, `${JSON.stringify(t)} gaf ${JSON.stringify(uit)}`);
  }
};
const geenCijfer = (t, opties = {}) => {
  for (const uit of uitvoer(t, opties)) assert.doesNotMatch(uit, /[\p{N}@]/u, `${JSON.stringify(t)} gaf ${JSON.stringify(uit)}`);
};

// ======== ba03ff4: wat de zwarte lijst nog doorliet ========

// HOOG: in de straatas staan straatnamen van één woord zonder plaatsuitgang (in Antwerpen o.a. voornamen en familienamen).
// Hier verzonnen: een straatas die "Testdries", "Proefrosier", "Proefoever", "Testzand", "Proefzandvoort" en
// "Testguldenberg" als hele straatnaam kent.
const EEN_WOORD = (n) => ["testdries", "proefrosier", "proefoever", "testzand", "proefzandvoort", "testguldenberg", "proefstraat"].includes(String(n).toLowerCase());

test("ba03ff4 HOOG: een straatnaam van één woord zonder plaatsuitgang laat geen voornaam of achternaam door, ook na De/Van en in een blok", () => {
  const gevallen = [
    ["Feest Testdries Van den Proefoever", "Testdries Proefoever"], ["Feest Testdries Proefrosier", "Testdries Proefrosier"],
    ["Doopfeest Testdries Van Proefzandvoort", "Testdries Proefzandvoort"], ["Tent Van den Proefoever", "Proefoever"], ["Tent Van der Testzand", "Testzand"],
    ["Feest Van Proefzandvoort", "Proefzandvoort"], ["Feest Van Proefrosier", "Proefrosier"], ["Feest bij Testguldenberg", "Testguldenberg"],
    ["Stoet van Testdries Proefrosier naar Proefstraat", "Testdries Proefrosier"], ["Feest Testrune Van den Proefoever", "Testrune Proefoever"],
  ];
  for (const [t, naam] of gevallen) {
    geenNaam(t, naam, { isStraat: EEN_WOORD });
    geenNaam(t, naam, { straten: [{ name: "Proefoever" }, { name: "Testdries" }] });
  }
  // Ook in de verversing (evenementFeiten met de straatas): de naam komt niet in kaart-uitleg.json.
  const rij = { reference: "ET2099000601", dossierType: "ETL", phase: "Evenement", innameType: "Inname", description: "Feest Testdries Van den Proefoever", streets: [], start: "2099-03-01", end: "2099-03-01" };
  for (const b of KU.evenementFeiten([rij], { isStraat: EEN_WOORD }).beschrijvingen) assert.doesNotMatch(b, /testdries|proefoever/i, b);
  assert.equal(PN.plaatsnaamVan("Testdries Van den Proefoever", { isStraat: EEN_WOORD }), "");
  assert.equal(PN.plaatsnaamVan("Proefrosier Testguldenberg", { isStraat: EEN_WOORD }), "");
  // Een straat op een zekere uitgang blijft wel: "Stoet van ... naar Proefstraat".
  assert.match(KU.bruikbareBeschrijving("Stoet van Testdries Proefrosier naar Proefstraat", { isStraat: EEN_WOORD }), /Proefstraat$/);
});

test("ba03ff4: een achternaam in kleine letters na De of Van, een voorletter, een korte naam in hoofdletters", () => {
  for (const [t, naam] of [
    ["Feest bij De proefgroot", "proefgroot"], ["Feest DE proefgroot", "proefgroot"], ["feest De proefsmet", "proefsmet"], ["tent Van proefdamme", "proefdamme"],
    ["feest bij De proefwolf", "proefwolf"], ["feest Van den proefbroeck", "proefbroeck"], ["feest VAN proefdamme", "proefdamme"], ["Feest Op de proefbeeck", "proefbeeck"],
    ["Feest In 't proefzand", "proefzand"], ["Feest bij D. testpersoon", "testpersoon"], ["Feest bij O. voorbeeld", "voorbeeld"], ["Feest v.d. testpersoon", "testpersoon"],
    ["Feest J.-P. testpersoon", "testpersoon"], ["Feest bij j. proefmans", "proefmans"], ["feest TEP VOK", "TEP VOK"], ["feest bij JAX", "JAX"], ["feest QO", "QO"],
  ]) geenNaam(t, naam);
});

test("ba03ff4: een stam met een uitgang ('Rune' = run + e), een samenstelling van stammen ('Vrijdag') of een stam die een familienaam is", () => {
  for (const [t, naam] of [["Feest Testrune", "Testrune"], ["Feest Rune", "Rune"], ["Doopfeest Rune", "Rune"], ["Feest Rune Koers", "Rune Koers"], ["Feest Koers", "Koers"],
    ["Feest Enkel", "Enkel"], ["feest Vrijdag", "Vrijdag"], ["Feest bij De Bus", "Bus"], ["Tent De Werf", "Werf"], ["feest Van Standbar", "Standbar"], ["tent De Werfkant", "Werfkant"],
    ["feest familie Feestman", "Feestman"], ["Tent familie Klein", "Klein"], ["feest Hoek", "Hoek"]]) geenNaam(t, naam);
});

test("ba03ff4: onzichtbare tekens, losse accenten, klein-kapitalen en cijfers uit een ander schrift verbergen geen naam meer", () => {
  for (const t of ["Feest T­estpersoon", "Feest T​estpersoon", "Feest bij T⁠estpersoon", "Feest bij T‌estpersoon", "Feest bij T﻿estpersoon",
    "Feest bij T̈estpersoon", "Feest bij T͏estpersoon", "Feest ᴛᴇsᴛᴘᴇʀsᴏᴏɴ", "feest Testpersön".normalize("NFD"), "feest ǅproefpersoon"]) {
    geenNaam(t, "testpersoon estpersoon proefpersoon");
    for (const uit of uitvoer(t)) assert.match(uit, /^[A-Za-zÀ-ÿ\s,.:…→/+-]*$/u, uit);
  }
  for (const t of ["Feest info ٠٤٧٢ ١٢ ٣٤ ٥٦", "Stoet Proefstraat ١٢", "feest تستبرسون", "feest 测试人", "feest Тестперсон"]) {
    geenCijfer(t, { isStraat: (n) => n === "Proefstraat" });
    for (const uit of uitvoer(t)) assert.match(uit, /^[\p{sc=Latin}\s,.:…→/+-]*$/u, uit);
  }
});

test("ba03ff4: elk huisnummer, telefoonnummer en mailadres valt weg, in elke vorm, ook als 'datum' na een straat", () => {
  const isStraat = (n) => ["proefstraat", "lange proefstraat"].includes(String(n).toLowerCase());
  for (const t of ["Parkeerverbod Proefstraat van 2-12", "parkeerverbod proefstraat van 4-8", "parkeerverbod proefstraat van 2/4", "Parkeerverbod Proefstraat vanaf 2/4",
    "parkeerverbod proefstraat op 12/3", "parkeerverbod lange proefstr. 12-14", "parkeerverbod proefstaat 12-14", "parkeerverbod 12/3 proefstraat", "parkeerverbod voor garage van 12-14",
    "parkeerverbod oprit 14 vrijhouden", "tent 12e huis links", "Stoet Proefstraat nr. 12", "1 A-tent", "parkeerverbod Proefstraat #3"]) geenCijfer(t, { isStraat });
  for (const [t, naam] of [
    ["feest info 03-123-45-67", "info"], ["feest info +32-3-123-45-67", "info"], ["feest info 04/71/12/34/56", "info"], ["tent, bel 0471 12-34-56", "bel"],
    ["feest info testpersoon(at)voorbeeld.test", "testpersoon voorbeeld test"], ["feest testpersoon＠voorbeeld.test", "testpersoon voorbeeld test"],
    ["Feest info testpersoon apenstaartje voorbeeld punt test", "testpersoon voorbeeld punt test"], ["feest testpersoon arobase voorbeeld point test", "testpersoon voorbeeld point test"],
    ["Feest info voorbeeld .test", "voorbeeld test"], ["feest inschrijven via voorbeeld.BE", "voorbeeld be"], ["feest info testpersoon at voorbeeld .be", "testpersoon voorbeeld be"],
  ]) geenNaam(t, naam);
  // De filter maakt zelf nooit een domeinnaam of een mailadres: tussen twee woorden staat altijd een spatie of een koppelteken.
  for (const t of ["feest info voorbeeld .test", "stoet.markt", "kraam.be", "feest . be"]) for (const uit of uitvoer(t)) assert.equal(KU.CONTACT.test(uit), false, uit);
});

test("ba03ff4: een titel, een losse familienaam in kleine letters of een naam die het begin van een straat in de buurt is", () => {
  for (const [t, naam] of [["feest de heer proefmans", "proefmans"], ["feest bij dr testpersoon", "testpersoon"], ["feest madame testpersoon", "testpersoon"],
    ["feest bij proefmans", "proefmans"], ["tent van testoglu", "testoglu"], ["feest bij Le", "le"], ["feest bij Per", "per"], ["feest MAS-proef", "proef"]]) geenNaam(t, naam);
  // Een naam die het begin is van een straat van de inname of in de buurt, bewijst niets: alleen een hele straatnaam telt.
  const straten = [{ name: "Jan Proefmansstraat" }, { name: "Van Testpersoonstraat" }];
  for (const [t, naam] of [["feest Proefmans", "Proefmans"], ["stoet Jan", "Jan"], ["Feest Van Testpersoon", "Testpersoon"]]) geenNaam(t, naam, { straten });
  assert.equal(PN.plaatsnaamVan("Van Testpersoon", { rond: ["Van Testpersoonstraat"] }), "");
  assert.equal(PN.plaatsnaamVan("De Proefmans", { rond: ["De Proefmansstraat"] }), "");
  assert.equal(PN.plaatsnaamVan("Hoek Van Testpersoon", { rond: ["Jan Van Testpersoonlaan"] }), "");
});

// ======== wat blijft: hele straatnamen, de vaste woorden, de vaste plekken ========

test("ba03ff4: een plaatsnaam in een ander district blijft als hele officiële straatnaam (straten-stad.json), nooit als stuk", () => {
  const isStraat = PN.straatasPredicaat({ index: { byName: new Map([["proefstraat", []]]) }, stadStraten: [["Proefdorpplaats", 7, "2180"], ["Testheide", 2, "2100"]] });
  assert.equal(isStraat("Proefstraat"), true);
  assert.equal(isStraat("proefdorpplaats"), true);
  assert.equal(isStraat("Proefdorp"), false);
  assert.equal(PN.plaatsnaamVan("Kermis Proefdorpplaats", { isStraat }), "Proefdorpplaats");
  // Een straatnaam van één woord zonder zekere uitgang ("Testheide") telt ook in een ander district niet.
  assert.equal(PN.plaatsnaamVan("Feest Testheide", { isStraat }), "");
  // De verversing van de herkenner gebruikt die straatnamen (lib/parcours-herkenning-refresh.mjs).
  assert.match(fs.readFileSync(new URL("../lib/parcours-herkenning-refresh.mjs", import.meta.url), "utf8"), /straatasPredicaat\(\{ index, stadStraten: leesJson\(path\.join\(rootDir, "site", "geo", "straten-stad\.json"\)\)/);
});

test("ba03ff4: een hele straatnaam met De of Van blijft, ook alleen, ook twee na elkaar met een koppelteken, in elke verversing", () => {
  const isStraat = (n) => ["van proefstraat", "testplein", "de proefplein", "van testlei", "proef van testplaats", "van proefbeeckstraat"].includes(String(n).toLowerCase());
  for (const t of ["Van Proefstraat - Testplein", "Van Proefstraat-Testplein", "Proef Van Testplaats", "Van proefbeeckstraat", "markt op het De Proefplein", "wandeling langs de Van Testlei"]) {
    assert.equal(KU.bruikbareBeschrijving(t, { isStraat }), t, t);
    assert.equal(KU.veiligeOmschrijving(`Inname: ${t}`, { isStraat }), `Inname: ${t}`, t);
  }
  // Ook in evenementFeiten (de verversing en de live laag), niet alleen in het bewaarde bestand.
  const rij = (description) => ({ reference: "ET2099000602", dossierType: "ETL", phase: "Evenement", innameType: "Inname", description, streets: [], start: "2099-03-01", end: "2099-03-01" });
  assert.deepEqual(KU.evenementFeiten([rij("Van Proefstraat - Testplein"), rij("Van proefbeeckstraat")], { isStraat }).beschrijvingen, ["Inname: Van Proefstraat - Testplein", "Inname: Van proefbeeckstraat"]);
  // Zonder straatas: de straat is niet bewezen en valt weg.
  assert.equal(KU.bruikbareBeschrijving("Van Proefstraat - Testplein"), "");
});

test("ba03ff4: gebeurteniswoorden, kerken en bekende plekken uit de vaste lijst blijven, ook met een hoofdletter of in hoofdletters", () => {
  for (const t of ["NADARS", "PARCOURS CRITERIUM", "Stoet", "Doop", "Drill", "Opbouw podium", "OPBOUW PODIUM", "Event verkeersvrij", "Wandeling naar de kaai", "Fietstocht",
    "Opening van de markt", "Optreden op het podium", "Tribune parcours", "Verzamelpunt", "Tweede halte", "Wandelroute van start naar eind", "Startlocatie doop", "Doopfeest",
    "Spelletjeslocatie", "Kraampjes", "Verkeersvrije zone", "Teambuilding met doop", "Reuzenrad op het plein", "Wandeling in het Stadspark", "Markt in Zurenborg",
    "Stoet door het Schipperskwartier", "Podium op het Eilandje", "Processie rond de Sint-Andrieskerk", "Verzamelen aan de Kathedraal", "Markt in Berchem", "kraam op de Meir"]) {
    assert.equal(KU.bruikbareBeschrijving(t), t, t);
    assert.equal(KU.veiligeOmschrijving(`Inname: ${t}`), `Inname: ${t}`, t);
  }
  // Een plek uit de vaste lijst zonder zekere uitgang naast een woord dat wegvalt, of na "Van"/"van": weg (het kan een naam zijn).
  for (const [t, naam] of [["Feest Van Berchem", "Berchem"], ["feest van Kiel", "Kiel"], ["Feest Testpersoon Meir", "Testpersoon Meir"], ["Feest Meir Testpersoon", "Meir Testpersoon"]]) geenNaam(t, naam);
});

// ======== de soort van een evenement komt niet uit de getoonde tekst ========

test("ba03ff4: de soort van een evenement blijft, ook als de witte lijst de omschrijving bijna helemaal weglaat (kenmerk uit normalizeIod)", async () => {
  const { normalizeIod } = await import("../site/public-space-core.js");
  const attrs = (innameId, innameTypeNaam, innameBeschrijving) => ({ dossierNummer: "ET2099000603", faseId: "F1", innameId, dossierStatus: "aanvraag_goedgekeurd", faseNaam: "Evenement", type_dossier: "ETL", innameTypeNaam, innameBeschrijving, innameHinder: "True", faseStartDatum: Date.UTC(2099, 2, 1), faseEindDatum: Date.UTC(2099, 2, 1) });
  const rij = (n) => ({ reference: n.dossier, dossierType: n.dossierType, phase: n.phase, innameType: n.type, description: n.description, kenmerk: n.kenmerk, streets: [], start: n.start, end: n.end });
  // De doop van een schip: "MTS Testboot" valt weg, de soort niet.
  const schip = normalizeIod(attrs("I1", "Inname", "Doopfeest MTS Testboot"));
  assert.equal(schip.description, "Doopfeest");
  assert.doesNotMatch(JSON.stringify(schip), /testboot|MTS/i);
  assert.equal(KU.evenementFeiten([rij(schip)]).soort, "Doop van een schip");
  // Een studentendoop: "Teamproef (doop) zelf" en een stoet.
  const doop = [normalizeIod(attrs("I2", "Inname", "Teamproef (doop) zelf")), normalizeIod(attrs("I3", "Parcours", "Stoet"))];
  assert.equal(KU.evenementFeiten(doop.map(rij)).soort, "Studentendoop");
  // Een loop met afstand: het getal valt weg uit de tekst, de soort blijft.
  const loop = normalizeIod(attrs("I4", "Parcours", "parcours volwassenen 10 km"));
  assert.equal(loop.description, "parcours volwassenen");
  assert.equal(KU.evenementFeiten([rij(loop)]).soort, "Loopwedstrijd");
  // Het kenmerk is alleen een rij vaste woorden, nooit de tekst zelf.
  for (const t of ["Feest Testpersoon Voorbeeld 12", "Reuzenrad familie Proefmans", "Doopfeest MTS Testboot", "kermis bij Testpersoon (geen stickers)"]) {
    const k = KU.kenmerkTekst(t);
    assert.doesNotMatch(k, /testpersoon|voorbeeld|proefmans|testboot|\d/i, `${t} → ${k}`);
  }
});

// Voor elke soort, elk ding en elk voorwerp: dezelfde uitkomst op het kenmerk als op de ruwe tekst.
test("ba03ff4: kenmerkTekst geeft dezelfde soort, dezelfde dingen en dezelfde voorwerpen als de ruwe tekst", () => {
  const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/parcours-herkenning/asign.json", import.meta.url), "utf8"));
  const perDossier = new Map();
  for (const f of fixture.features) {
    const a = f.attributes || {};
    if (!a.innameBeschrijving) continue;
    perDossier.set(a.dossierNummer, [...(perDossier.get(a.dossierNummer) || []), a.innameBeschrijving]);
  }
  const extra = [["Doopfeest MTS Testboot"], ["Reuzenrad", "Proefstraat"], ["kermis", "opslag reuzenrad"], ["vlaggen boven de straat", "reuzenboeken", "kerstverlichting"], ["tent met DJ", "sticker"],
    ["geen kermis", "braderie"], ["parcours 10K"], ["foodtruck en dixitoilet", "buitenpodium"], ["Stoet van de doop", "studenten"]];
  let n = 0;
  for (const teksten of [...perDossier.values(), ...extra]) {
    const kenmerken = teksten.map((t) => KU.kenmerkTekst(t)).filter(Boolean);
    const ruw = teksten.filter((t) => !KU.CONTACT.test(t));
    assert.deepEqual(KU.soortEvenementMet(kenmerken), KU.soortEvenementMet(ruw), teksten.join(" | "));
    assert.deepEqual(EW.voorwerpenIn(kenmerken), EW.voorwerpenIn(ruw), teksten.join(" | "));
    assert.deepEqual(EW.dingenIn(kenmerken), EW.dingenIn(ruw), teksten.join(" | "));
    assert.equal(EW.versieringTekst(kenmerken), EW.versieringTekst(ruw), teksten.join(" | "));
    n += 1;
  }
  assert.ok(n > 40, `${n} dossiers nagekeken`);
});

// ======== eigenschap: voor duizenden verzonnen naam- en nummervormen blijft niets over dat niet op de witte lijst staat ========

// Een vaste toevalsgenerator (mulberry32), zodat elke run dezelfde vormen nakijkt.
const toeval = (zaad) => () => { zaad |= 0; zaad = (zaad + 0x6D2B79F5) | 0; let t = Math.imul(zaad ^ (zaad >>> 15), 1 | zaad); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const LETTERGREPEN = ["zor", "vex", "quil", "xan", "dux", "kyl", "wix", "fax", "jor", "nix", "plo", "gav", "yur", "tev", "hox", "mur", "zil", "vor", "qua", "bix", "ryx", "sym"];
// Wat de sjablonen zelf aan woorden aanbrengen: alleen die woorden (en de verzonnen straten) mogen in de uitvoer staan.
const TREFWOORDEN = ["feest", "Feest", "stoet", "Stoet", "kraam", "parkeerverbod", "Doopfeest", "tent", "NADARS", "podium", "markt", "Startlocatie", "kerk", "school"];
const STRATEN = ["Proefstraat", "Van Testlei", "De Proefplein", "Testplaats"];
const VASTE = ["Meir", "Berchem", "Zurenborg", "Park Spoor Noord"];
const KLEIN = ["aan", "op", "de", "het", "naar", "bij", "van", "langs", "en", "in"];
const isStraatProef = (n) => STRATEN.some((s) => s.toLowerCase() === String(n).toLowerCase());

function naamVorm(r) {
  const kies = (lijst) => lijst[Math.floor(r() * lijst.length)];
  const deel = () => { let w = ""; for (let i = 0, n = 2 + Math.floor(r() * 2); i < n; i += 1) w += kies(LETTERGREPEN); return w; };
  const groot = (w) => w[0].toUpperCase() + w.slice(1);
  const voor = deel(), achter = deel();
  const vormen = [
    () => `${groot(voor)} ${groot(achter)}`, () => groot(achter), () => achter, () => achter.toUpperCase(), () => `${voor.toUpperCase()} ${achter.toUpperCase()}`,
    () => `Van ${groot(achter)}`, () => `van ${achter}`, () => `De ${achter}`, () => `DE ${achter.toUpperCase()}`, () => `Van den ${groot(achter)}`, () => `${groot(voor)} Van der ${groot(achter)}`,
    () => `D'${groot(achter)}`, () => `D\`${achter}`, () => `D´${achter}`, () => `D ${achter}`, () => `D.${achter}`, () => `O'${groot(achter)}`, () => `Mc${groot(achter)}`,
    () => `${groot(achter)} ${groot(voor)}`, () => `${voor[0].toUpperCase()}. ${groot(achter)}`, () => `${voor[0].toUpperCase()}.${groot(achter)}`, () => `${groot(voor)}-${groot(achter)}`,
    () => `${groot(achter)}_${groot(voor)}`, () => `familie ${groot(achter)}`, () => `fam. ${achter}`, () => `dhr ${groot(achter)}`, () => `mevrouw ${achter}`,
    () => `${groot(achter).slice(0, 1)}​${achter.slice(1)}`, () => `${groot(achter).slice(0, 1)}­${achter.slice(1)}`, () => `${groot(achter)}`.normalize("NFD"),
    () => `${groot(achter)}̈`, () => `“${groot(achter)}”`, () => `#${groot(achter)}`, () => `${groot(achter)}2099`, () => `${groot(voor)} ${groot(achter)}`.toUpperCase(),
  ];
  return kies(vormen)();
}
function nummerVorm(r) {
  const n = () => 1 + Math.floor(r() * 150);
  const kies = (lijst) => lijst[Math.floor(r() * lijst.length)];
  return kies([
    () => `${n()}`, () => `${n()}-${n()}`, () => `${n()}/${n()}`, () => `${n()}a`, () => `nr ${n()}`, () => `nr. ${n()} bus ${n()}`, () => `${n()} tot ${n()}`, () => `${n()}e`,
    () => `03-${n()}-45-67`, () => `+32 471 ${n()} 34 56`, () => `0471/${n()}.34.56`, () => `${n()}${n()}${n()}${n()}`, () => `٠٤٧٢ ${n()}`,
  ])();
}
const SJABLONEN = [
  (x) => `${x.kw} ${x.naam}`, (x) => `${x.naam} ${x.kw}`, (x) => `${x.kw} bij ${x.naam} op de ${x.straat}`, (x) => `${x.kw} ${x.naam} ${x.nummer}`,
  (x) => `${x.straat} ${x.nummer} ${x.naam}`, (x) => `${x.kw} van ${x.naam} naar ${x.straat}`, (x) => `${x.kw} ${x.naam} ${x.vast}`, (x) => `${x.vast} ${x.naam}`,
  (x) => `${x.kw}: ${x.naam} (${x.nummer})`, (x) => `${x.kw} ${x.naam}@voorbeeld.test`, (x) => `${x.naam}, ${x.kw} aan het ${x.straat}`, (x) => `${x.kw} ${x.naam} en ${x.naam2}`,
];

test("eigenschap: voor duizenden verzonnen naam- en nummervormen blijft niets over dat niet op de witte lijst staat", () => {
  const r = toeval(20261017);
  const kies = (lijst) => lijst[Math.floor(r() * lijst.length)];
  // Wat mag blijven: de woorden van de sjablonen zelf, de verzonnen straten en de vaste plekken.
  const toegestaan = new Set([...TREFWOORDEN, ...STRATEN, ...VASTE, ...KLEIN, "Inname"].flatMap(woorden));
  let gezien = 0, metUitvoer = 0;
  for (let i = 0; i < 4000; i += 1) {
    const x = { kw: kies(TREFWOORDEN), naam: naamVorm(r), naam2: naamVorm(r), nummer: nummerVorm(r), straat: kies(STRATEN), vast: kies(VASTE) };
    const t = kies(SJABLONEN)(x);
    const naamWoorden = new Set([...woorden(x.naam), ...woorden(x.naam2)].filter((w) => !toegestaan.has(w)));
    for (const opties of [{}, { isStraat: isStraatProef }, { isStraat: (n) => isStraatProef(n) || woorden(n).every((w) => naamWoorden.has(w)) }]) {
      for (const uit of uitvoer(t, opties)) {
        gezien += 1;
        if (uit) metUitvoer += 1;
        assert.doesNotMatch(uit, /[\p{N}@＠]/u, `${JSON.stringify(t)} → ${JSON.stringify(uit)}`);
        for (const w of woorden(uit)) assert.ok(toegestaan.has(w) && !naamWoorden.has(w), `${JSON.stringify(t)} → ${JSON.stringify(uit)}: "${w}" staat niet op de witte lijst`);
      }
    }
  }
  // De toets zegt alleen iets als er ook uitvoer is: de trefwoorden en straten blijven staan.
  assert.ok(gezien >= 36000 && metUitvoer > 5000, `${gezien} uitvoeren, ${metUitvoer} niet leeg`);
});

// Nakijkronde van head e2969b3: de verzonnen lettergrepen hierboven staan nooit op de lijst. Hier komt de "naam" uit de lijst
// zelf: stammen die ook een familienaam of voornaam kunnen zijn ("Tent", "Bar", "Zaal"), de namen die er vroeger op stonden
// ("Pier", "Kersten", "Dağ") en de vaste plekken zonder zekere uitgang ("Meir", "Dam", "Kiel", "Lillo"), in de vormen waarin
// een naam staat: na fam., dhr. of mevr., voor of na een telefoonnummer, na "van der", "van", "voor" of "bij", als voornaam
// met achternaam, en in HOOFDLETTERS. Van X mag niets in de uitvoer staan.
const LIJST_NAMEN = ["Tent", "Kraam", "Bar", "Zaal", "Steiger", "Stand", "Toog", "Kerk", "Park", "Lei", "Feest", "Doop", "Stoet", "Wagen", "Loop", "Ronde", "Kaai",
  "Dok", "Brug", "Tuin", "School", "Plein", "Halte", "Haven", "Trap", "Muziek", "Dans", "Film", "Foto", "Sport", "Nacht", "Avond", "Dag", "Pier", "Kersten", "Dağ", "Kerst"];
const LIJST_PLEKKEN = (KU.VASTE_PLEKKEN || ["Meir", "Dam", "Kiel", "Lillo", "MAS", "Bourla", "Berchem", "Zuid"])
  .filter((n) => /^[A-Za-z]+$/.test(n) && !/(?:plein|park|kaai|kaaien|kathedraal|kerk|markt|straat|station|dok|lei|laan)$/i.test(n));
const LIJST_SJABLONEN = [
  (x) => `${x.kw} fam. ${x.X}`, (x) => `${x.kw} dhr. ${x.X}`, (x) => `mevr. ${x.X} ${x.kw}`, (x) => `${x.kw} (fam. ${x.X})`, (x) => `${x.kw} ${x.X}, 0470 12 34 56`,
  (x) => `${x.X} - 0470/12.34.56 - ${x.kw}`, (x) => `${x.kw}: ${x.X} +32 471 12 34 56`, (x) => `${x.kw} van der ${x.X}`, (x) => `${x.kw} Van Der ${x.X}`,
  (x) => `${x.kw} van ${x.X}`, (x) => `${x.kw} voor ${x.X}`, (x) => `${x.kw} bij ${x.X}`, (x) => `${x.kw} ${x.X.toLowerCase()}@voorbeeld.test`,
];
// Ook in HOOFDLETTERS: de vormen met fam., dhr., een telefoonnummer en "van der".
const LIJST_HOOFDLETTERS = LIJST_SJABLONEN.slice(0, 10);

test("eigenschap (e2969b3): een naam die zelf op de lijst staat, blijft niet over na fam., dhr., bij een telefoonnummer, na van der, en in HOOFDLETTERS", () => {
  const r = toeval(20261018);
  const kies = (lijst) => lijst[Math.floor(r() * lijst.length)];
  assert.ok(LIJST_PLEKKEN.includes("Meir") && LIJST_PLEKKEN.includes("Dam") && LIJST_PLEKKEN.includes("Kiel"), LIJST_PLEKKEN.join(", "));
  const namen = [...LIJST_NAMEN, ...LIJST_PLEKKEN];
  let gezien = 0, metUitvoer = 0;
  for (let i = 0; i < 3000; i += 1) {
    const X = kies(namen);
    const naamWoorden = new Set(woorden(X));
    const kw = kies(TREFWOORDEN.filter((t) => !woorden(t).some((w) => naamWoorden.has(w))));
    const hoofdletters = r() < 0.35;
    const t0 = kies(hoofdletters ? LIJST_HOOFDLETTERS : LIJST_SJABLONEN)({ kw, X });
    const t = hoofdletters ? t0.toUpperCase() : t0;
    const toegestaan = new Set([...woorden(kw), ...KLEIN, "inname"]);
    for (const opties of [{}, { isStraat: isStraatProef }, { isStraat: (n) => woorden(n).every((w) => naamWoorden.has(w)) }]) {
      for (const uit of uitvoer(t, opties)) {
        gezien += 1;
        if (uit) metUitvoer += 1;
        assert.doesNotMatch(uit, /[\p{N}@＠]/u, `${JSON.stringify(t)} → ${JSON.stringify(uit)}`);
        for (const w of woorden(uit)) assert.ok(toegestaan.has(w) && !naamWoorden.has(w), `${JSON.stringify(t)} → ${JSON.stringify(uit)}: "${w}" is (een stuk van) de naam`);
      }
    }
  }
  // Ook voornaam met achternaam, allebei van de lijst ("Kraam Bar", "Tent Zaal"): allebei weg.
  const voornamen = LIJST_NAMEN.filter((n) => /^[A-Z][a-z]+$/.test(n) && !["Kersten", "Pier", "Kerst"].includes(n));
  for (let i = 0; i < 500; i += 1) {
    const X = kies(voornamen), Y = kies(voornamen);
    const naamWoorden = new Set([...woorden(X), ...woorden(Y)]);
    const kw = kies(TREFWOORDEN.filter((t) => !woorden(t).some((w) => naamWoorden.has(w))));
    const t = `${kw} ${X} ${Y}`;
    for (const uit of uitvoer(t)) for (const w of woorden(uit)) assert.ok(!naamWoorden.has(w), `${JSON.stringify(t)} → ${JSON.stringify(uit)}`);
  }
  // De toets zegt alleen iets als er ook uitvoer is: het trefwoord blijft vaak staan.
  assert.ok(gezien >= 27000 && metUitvoer > 3000, `${gezien} uitvoeren, ${metUitvoer} niet leeg`);
});

// ======== de straatas overal: de verversing, de live laag en de terugval ========

const PROEF_AS = (n) => ["de testplein", "van testlei", "proefstraat"].includes(String(n).toLowerCase());

test("evenementFeiten filtert met de straatas: een plek met De of Van die niet bij de inname staat, blijft; zonder straatas alleen het trefwoord", () => {
  const rij = (innameType, description, streets) => ({ reference: "ET2099000501", dossierType: "ETL", phase: "Evenement", innameType, description, streets, start: "2099-03-01", end: "2099-03-01" });
  const rows = [rij("Inname", "markt op het De Testplein", [{ name: "Proefstraat" }]), rij("Parcours", "stoet over de Van Testlei", [])];
  assert.deepEqual(KU.evenementFeiten(rows).beschrijvingen, ["Inname: markt", "Parcours: stoet"]);
  assert.deepEqual(KU.evenementFeiten(rows, { isStraat: PROEF_AS }).beschrijvingen, ["Inname: markt op het De Testplein", "Parcours: stoet over de Van Testlei"]);
});

test("in de browser filtert evenementEntry de live omschrijvingen met de straatas van de site", () => {
  const rij = (innameType, description, streets) => ({ reference: "ET2099000501", dossierType: "ETL", phase: "Evenement", innameType, description, streets, start: "2099-03-01", end: "2099-03-01" });
  const rows = [rij("Inname", "markt op het De Testplein", [{ name: "Proefstraat" }]), rij("Parcours", "stoet over de Van Testlei", [])];
  const index = { byName: new Map([["de testplein", []], ["van testlei", []]]) };
  const entry = PC.evenementEntry(rows, { vandaag: "2099-02-20", index });
  assert.deepEqual(entry.uitleg.beschrijvingen, ["Inname: markt op het De Testplein", "Parcours: stoet over de Van Testlei"]);
});

const as = (id, naam, coords) => ({ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: { LSTRNMID: id, LSTRNM: naam, RSTRNMID: id, RSTRNM: naam, postcode: 2000, DISTRICT: "Antwerpen" } });

test("de verversing filtert met de straatas, ook een parcours zonder straten per inname, en houdt de soort", async () => {
  const { bouwKaartUitleg } = await import("../lib/kaart-uitleg-refresh.mjs");
  const streetFeatures = [as(1, "Proefstraat", [[4.400, 51.2], [4.405, 51.2]]), as(2, "De Testplein", [[4.41, 51.205], [4.412, 51.205]]), as(3, "Van Testlei", [[4.415, 51.206], [4.417, 51.206]])];
  const district = { type: "Polygon", coordinates: [[[4.39, 51.19], [4.42, 51.19], [4.42, 51.21], [4.39, 51.21], [4.39, 51.19]]] };
  const dag = Date.UTC(2099, 2, 1, 8);
  const attrs = (innameId, innameTypeNaam, innameBeschrijving) => ({ dossierNummer: "ET2099000502", faseId: "F1", innameId, dossierStatus: "aanvraag_goedgekeurd", faseNaam: "Evenement", type_dossier: "ETL", innameTypeNaam, innameBeschrijving, innameHinder: "True", faseStartDatum: dag, faseEindDatum: dag });
  const iodFeatures = [
    { attributes: attrs("I1", "Parcours", "stoet over het De Testplein"), geometry: { paths: [[[4.4001, 51.2], [4.4049, 51.2]]] } },
    { attributes: attrs("I2", "Inname", "markt aan de Van Testlei"), geometry: { rings: [[[4.4010, 51.1999], [4.4020, 51.1999], [4.4020, 51.2001], [4.4010, 51.2001], [4.4010, 51.1999]]] } },
    { attributes: attrs("I3", "Inname", "Doopfeest MTS Testboot"), geometry: { rings: [[[4.4010, 51.1999], [4.4020, 51.1999], [4.4020, 51.2001], [4.4010, 51.2001], [4.4010, 51.1999]]] } },
  ];
  const { document } = await bouwKaartUitleg({ iodFeatures, district, streetFeatures, clock: () => new Date("2099-02-25T05:00:00Z"), fetch: null });
  const e = document.evenementen.ET2099000502;
  assert.deepEqual([...e.beschrijvingen].sort(), ["Inname: Doopfeest", "Inname: markt aan de Van Testlei", "Parcours: stoet over het De Testplein"]);
  assert.equal(e.soort, "Doop van een schip");
  assert.doesNotMatch(JSON.stringify(document), /testboot/i);
});

test("de terugval bij een storing van A-Sign filtert de vorige omschrijvingen met de straatas en de witte lijst", async (t) => {
  const { schrijfKaartUitleg, KAART_UITLEG_FILE } = await import("../lib/kaart-uitleg-refresh.mjs");
  const streetFeatures = [as(1, "Proefstraat", [[4.400, 51.2], [4.405, 51.2]]), as(2, "De Testplein", [[4.41, 51.205], [4.412, 51.205]]), as(3, "Van Testlei", [[4.415, 51.206], [4.417, 51.206]])];
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "privacy-ba03ff4-"));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(rootDir, "site", "sources"), { recursive: true });
  const vorige = { schemaVersion: 1, generatedAt: "2099-02-24T05:00:00Z", vanaf: "2099-02-24", tot: "2099-04-24", werken: {}, evenementen: {
    ET2099000503: { start: "2099-03-01", eind: "2099-03-01", soort: "", soortBron: "", beschrijvingen: ["Inname: Proefstraat - Van Testlei", "Inname: markt op het De Testplein", "Inname: feest De testpersoon", "Testpersoon Voorbeeld: feest"], straten: ["Proefstraat"], kruist: [], stratenTekst: "", gekoppeld: null, kaart: [], kaartDeel: false },
  } };
  const bestand = path.join(rootDir, "site", "sources", KAART_UITLEG_FILE);
  fs.writeFileSync(bestand, JSON.stringify(vorige));
  const stil = () => {};
  const gehouden = await schrijfKaartUitleg({ rootDir, works: { ok: false, items: [] }, publicSpace: { ok: false }, streetFeatures, fetch: null, clock: () => new Date("2099-02-25T05:00:00Z"), log: stil });
  // De naam valt weg, ook als soort vooraan: "Testpersoon Voorbeeld: feest" wordt "Inname: feest".
  assert.deepEqual(gehouden.evenementen.ET2099000503.beschrijvingen, ["Inname: Proefstraat - Van Testlei", "Inname: markt op het De Testplein", "Inname: feest"]);
});
