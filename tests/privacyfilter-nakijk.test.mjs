// De privacyfilter van de vrije tekst uit A-Sign (innameBeschrijving), site/witte-lijst.js, na de nakijkronde van head
// ba03ff4 (een zwarte lijst van naamvormen bleef lek) en sinds de GRONDREGEL: uit de tekst blijft alleen een volledige
// officiële straatnaam uit de straatas (exact, de hele naam) of een district van Antwerpen over. Al de rest valt weg: elk
// ander woord, ook een gebeurteniswoord of een soort plek, elk cijfer, elke naam (tests/grondregel-privacyfilter.test.mjs).
//
// Deze toetsen kijken niet of de filter een naam herkent, maar of er van een naam niets overblijft: geen enkel woord van
// de naam in de uitvoer van bruikbareBeschrijving, veiligeOmschrijving en plaatsnaamVan, geen cijfer, geen @. Een naam die
// zelf een hele straatnaam uit de straatas is, is volgens de grondregel een plek en blijft. Alleen verzonnen proefdata
// (Testpersoon, Voorbeeld, Proefstraat, .test-domeinen); geen netwerk.
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

test("ba03ff4 HOOG: een naam die geen hele straatnaam is, blijft nooit; een hele straatnaam uit de straatas wel, ook van één woord", () => {
  const gevallen = [
    ["Feest Testrune Van den Proefoever", "Testrune"], ["Tent Van den Testpersoon", "Testpersoon"], ["Feest bij Testguldenbergen", "Testguldenbergen"],
    ["Stoet van Testdries Proefrosiers naar Proefstraat", "Proefrosiers"], ["Doopfeest Testdries-Testrune", "Testdries Testrune"],
  ];
  for (const [t, naam] of gevallen) {
    geenNaam(t, naam, { isStraat: EEN_WOORD });
    geenNaam(t, naam, { straten: [{ name: "Proefoever" }, { name: "Testdries" }] });
  }
  // GRONDREGEL (a): een hele straatnaam uit de straatas blijft, ook van één woord; nooit een stuk ervan, en uit een woord met
  // koppeltekens alleen als het hele woord uit straatnamen bestaat ("Testdries-Proefzandvoort", niet "Testdries-Testrune").
  assert.equal(PN.plaatsnaamVan("Testdries Van den Proefoever", { isStraat: EEN_WOORD }), "Testdries … Proefoever");
  assert.equal(PN.plaatsnaamVan("Proefrosier Testguldenberg", { isStraat: EEN_WOORD }), "Proefrosier Testguldenberg");
  assert.equal(PN.plaatsnaamVan("Testdries-Proefzandvoort", { isStraat: EEN_WOORD }), "Testdries-Proefzandvoort");
  assert.equal(PN.plaatsnaamVan("Testdries-Testrune", { isStraat: EEN_WOORD }), "");
  assert.equal(KU.bruikbareBeschrijving("Stoet van Testdries Proefrosiers naar Proefstraat", { isStraat: EEN_WOORD }), "Testdries … Proefstraat");
  // Ook in de verversing (evenementFeiten met de straatas): alleen de hele straatnamen komen in kaart-uitleg.json.
  const rij = { reference: "ET2099000601", dossierType: "ETL", phase: "Evenement", innameType: "Inname", description: "Feest Testrune Van den Proefoever", streets: [], start: "2099-03-01", end: "2099-03-01" };
  assert.deepEqual(KU.evenementFeiten([rij], { isStraat: EEN_WOORD }).beschrijvingen, ["Inname: Proefoever"]);
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
  assert.equal(PN.plaatsnaamVan("Feest Testheide", { isStraat }), "Testheide");
  assert.equal(PN.plaatsnaamVan("Feest Proefdorp", { isStraat }), "");
  // De verversing van de herkenner gebruikt die straatnamen (lib/parcours-herkenning-refresh.mjs).
  assert.match(fs.readFileSync(new URL("../lib/parcours-herkenning-refresh.mjs", import.meta.url), "utf8"), /straatasPredicaat\(\{ index, stadStraten: leesJson\(path\.join\(rootDir, "site", "geo", "straten-stad\.json"\)\)/);
});

test("ba03ff4: een hele straatnaam met De of Van blijft, ook alleen, ook twee na elkaar met een koppelteken, in elke verversing", () => {
  const isStraat = (n) => ["van proefstraat", "testplein", "de proefplein", "van testlei", "proef van testplaats", "van proefbeeckstraat"].includes(String(n).toLowerCase());
  for (const [t, uit] of [["Van Proefstraat - Testplein", "Van Proefstraat - Testplein"], ["Proef Van Testplaats", "Proef Van Testplaats"], ["Van proefbeeckstraat", "Van proefbeeckstraat"],
    ["markt op het De Proefplein", "De Proefplein"], ["wandeling langs de Van Testlei", "Van Testlei"], ["Van Proefstraat-Testplein", "Van Proefstraat-Testplein"], ["Van Proefstraat-Testpersoon", ""]]) {
    assert.equal(KU.bruikbareBeschrijving(t, { isStraat }), uit, t);
    assert.equal(KU.veiligeOmschrijving(`Inname: ${t}`, { isStraat }), uit ? `Inname: ${uit}` : "", t);
  }
  // Ook in evenementFeiten (de verversing en de live laag), niet alleen in het bewaarde bestand.
  const rij = (description) => ({ reference: "ET2099000602", dossierType: "ETL", phase: "Evenement", innameType: "Inname", description, streets: [], start: "2099-03-01", end: "2099-03-01" });
  assert.deepEqual(KU.evenementFeiten([rij("Van Proefstraat - Testplein"), rij("Van proefbeeckstraat")], { isStraat }).beschrijvingen, ["Inname: Van Proefstraat - Testplein", "Inname: Van proefbeeckstraat"]);
  // Zonder straatas: de straat is niet bewezen en valt weg.
  assert.equal(KU.bruikbareBeschrijving("Van Proefstraat - Testplein"), "");
});

test("GRONDREGEL: gebeurteniswoorden, kerken en bekende plekken van de vroegere vaste lijst blijven niet meer; een district wel", () => {
  for (const t of ["NADARS", "PARCOURS CRITERIUM", "Stoet", "Doop", "Drill", "Opbouw podium", "OPBOUW PODIUM", "Event verkeersvrij", "Wandeling naar de kaai", "Fietstocht",
    "Opening van de markt", "Optreden op het podium", "Tribune parcours", "Verzamelpunt", "Tweede halte", "Wandelroute van start naar eind", "Startlocatie doop", "Doopfeest",
    "Spelletjeslocatie", "Kraampjes", "Verkeersvrije zone", "Teambuilding met doop", "Reuzenrad op het plein", "Wandeling in het Stadspark", "Markt in Zurenborg",
    "Stoet door het Schipperskwartier", "Podium op het Eilandje", "Processie rond de Sint-Andrieskerk", "Verzamelen aan de Kathedraal", "kraam op de Meir"]) {
    assert.equal(KU.bruikbareBeschrijving(t), "", t);
    assert.equal(KU.veiligeOmschrijving(`Inname: ${t}`), "", t);
  }
  assert.equal(KU.bruikbareBeschrijving("Markt in Berchem"), "Berchem");
  assert.equal(KU.veiligeOmschrijving("Inname: Markt in Berchem"), "Inname: Berchem");
  // Een district als achternaam blijft het district (GRONDREGEL (b)); een andere naam ernaast valt weg.
  for (const [t, naam] of [["Feest Van Berchem", "Van"], ["feest van Kiel", "Kiel"], ["Feest Testpersoon Meir", "Testpersoon Meir"], ["Feest Meir Testpersoon", "Meir Testpersoon"]]) geenNaam(t, naam);
});

// ======== de soort van een evenement komt niet uit de getoonde tekst ========

test("ba03ff4: de soort van een evenement blijft, ook als de privacyfilter de omschrijving helemaal weglaat (kenmerk uit normalizeIod)", async () => {
  const { normalizeIod } = await import("../site/public-space-core.js");
  const attrs = (innameId, innameTypeNaam, innameBeschrijving) => ({ dossierNummer: "ET2099000603", faseId: "F1", innameId, dossierStatus: "aanvraag_goedgekeurd", faseNaam: "Evenement", type_dossier: "ETL", innameTypeNaam, innameBeschrijving, innameHinder: "True", faseStartDatum: Date.UTC(2099, 2, 1), faseEindDatum: Date.UTC(2099, 2, 1) });
  const rij = (n) => ({ reference: n.dossier, dossierType: n.dossierType, phase: n.phase, innameType: n.type, description: n.description, kenmerk: n.kenmerk, streets: [], start: n.start, end: n.end });
  // De doop van een schip: van de tekst blijft niets, de soort wel.
  const schip = normalizeIod(attrs("I1", "Inname", "Doopfeest MTS Testboot"));
  assert.equal(schip.description, undefined);
  assert.doesNotMatch(JSON.stringify(schip), /testboot|MTS/i);
  assert.equal(KU.evenementFeiten([rij(schip)]).soort, "Doop van een schip");
  // Een studentendoop: "Teamproef (doop) zelf" en een stoet.
  const doop = [normalizeIod(attrs("I2", "Inname", "Teamproef (doop) zelf")), normalizeIod(attrs("I3", "Parcours", "Stoet"))];
  assert.equal(KU.evenementFeiten(doop.map(rij)).soort, "Studentendoop");
  // Een loop met afstand: de tekst valt weg, de soort blijft.
  const loop = normalizeIod(attrs("I4", "Parcours", "parcours volwassenen 10 km"));
  assert.equal(loop.description, undefined);
  assert.equal(KU.evenementFeiten([rij(loop)]).soort, "Loopwedstrijd");
  // Het kenmerk is alleen een rij vaste woorden, nooit de tekst zelf.
  for (const t of ["Feest Testpersoon Voorbeeld 12", "Reuzenrad familie Proefmans", "Doopfeest MTS Testboot", "kermis bij Testpersoon (geen stickers)"]) {
    const k = KU.kenmerkTekst(t);
    assert.doesNotMatch(k, /testpersoon|voorbeeld|proefmans|testboot|\d/i, `${t} → ${k}`);
    assert.equal(KU.isKenmerk(k) || k === "", true, `${t} → ${k}`);
  }
});

test("ba03ff4: kenmerkTekst geeft dezelfde soort, dezelfde dingen en dezelfde voorwerpen als de ruwe teksten die main voor de soort las", () => {
  const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/parcours-herkenning/asign.json", import.meta.url), "utf8"));
  const perDossier = new Map();
  for (const f of fixture.features) {
    const a = f.attributes || {};
    if (!a.innameBeschrijving) continue;
    perDossier.set(a.dossierNummer, [...(perDossier.get(a.dossierNummer) || []), a.innameBeschrijving]);
  }
  const extra = [["Doopfeest MTS Testboot"], ["Reuzenrad", "Proefstraat"], ["kermis", "opslag reuzenrad"], ["vlaggen boven de straat", "reuzenboeken", "kerstverlichting"], ["tent met DJ", "sticker"],
    ["geen kermis", "braderie"], ["parcours 10K"], ["foodtruck en dixitoilet", "buitenpodium"], ["Stoet van de doop", "studenten"], ["geen stoet"], ["Stickers van de buurt", "Proefstraat"],
    // Met een voorvoegsel (nakijkronde van head 3b178d9): main las de omschrijving met en de ruwe tekst zonder voorvoegsel.
    ["Stoet: verzamelen aan de Proefstraat"], ["Kermis: reuzenrad en kramen"], ["Doopfeest schip: verzamelen"], ["Tent: podium en bar", "Kermis: vlaggen van"]];
  // zonderHuisnummer zoals origin/main het had: main las de omschrijving voor de soort na deze functie.
  const zonderHuisnummerVanMain = (t) => t.replace(/(\p{L}*(?:straat|laan|lei|plein|baan|weg|kaai|vest|rui|markt|plaats|dreef|pad|hof|dijk|singel|brug))\s+\d+[a-z]?(?:\s*[-–]\s*\d+[a-z]?)?\b/giu, "$1");
  let n = 0;
  for (const teksten of [...perDossier.values(), ...extra]) {
    // Per inname de kenmerken, elk apart (de volle tekst en de tekst zonder voorvoegsel).
    const kenmerken = teksten.flatMap((t) => KU.kenmerkenVan({ description: t }));
    // Wat main voor de soort las: van elke tekst die zijn woordenfilter toonde (de eerste 140 tekens, telVoorSoort) de
    // omschrijving ("Inname: " + de tekst na zijn zonderHuisnummer) en de ruwe tekst.
    const ruw = teksten.map((t) => KU.telVoorSoort(t)).filter(Boolean);
    const vanMain = [...new Set(ruw.map((t) => `Inname: ${zonderHuisnummerVanMain(t)}`)), ...ruw];
    assert.equal(teksten.filter((t) => KU.kenmerkenVan({ description: t }).length).length, ruw.length, teksten.join(" | "));
    assert.deepEqual(KU.soortEvenementMet(kenmerken), KU.soortEvenementMet(vanMain), teksten.join(" | "));
    assert.deepEqual(EW.voorwerpenIn(kenmerken), EW.voorwerpenIn(ruw), teksten.join(" | "));
    assert.deepEqual(EW.dingenIn(kenmerken), EW.dingenIn(ruw), teksten.join(" | "));
    assert.equal(EW.versieringTekst(kenmerken), EW.versieringTekst(ruw), teksten.join(" | "));
    n += 1;
  }
  assert.ok(n > 40, `${n} dossiers nagekeken`);
});

// ======== eigenschap ========
// De eigenschapstoets (duizenden verzonnen naam-, nummer-, telefoon- en mailvormen, ook naast en binnen straatnamen) staat
// sinds de GRONDREGEL in tests/grondregel-privacyfilter.test.mjs.

// ======== de straatas overal: de verversing, de live laag en de terugval ========

const PROEF_AS = (n) => ["de testplein", "van testlei", "proefstraat"].includes(String(n).toLowerCase());

test("evenementFeiten filtert met de straatas: een plek met De of Van die niet bij de inname staat, blijft; zonder straatas niets", () => {
  const rij = (innameType, description, streets) => ({ reference: "ET2099000501", dossierType: "ETL", phase: "Evenement", innameType, description, streets, start: "2099-03-01", end: "2099-03-01" });
  const rows = [rij("Inname", "markt op het De Testplein", [{ name: "Proefstraat" }]), rij("Parcours", "stoet over de Van Testlei", [])];
  assert.deepEqual(KU.evenementFeiten(rows).beschrijvingen, []);
  assert.deepEqual(KU.evenementFeiten(rows, { isStraat: PROEF_AS }).beschrijvingen, ["Inname: De Testplein", "Parcours: Van Testlei"]);
  // De soort komt uit de ruwe tekst, niet uit wat de filter overlaat.
  assert.equal(KU.evenementFeiten(rows).soort, "Stoet");
});

test("in de browser filtert evenementEntry de live omschrijvingen met de straatas van de site", () => {
  const rij = (innameType, description, streets) => ({ reference: "ET2099000501", dossierType: "ETL", phase: "Evenement", innameType, description, streets, start: "2099-03-01", end: "2099-03-01" });
  const rows = [rij("Inname", "markt op het De Testplein", [{ name: "Proefstraat" }]), rij("Parcours", "stoet over de Van Testlei", [])];
  const index = { byName: new Map([["de testplein", []], ["van testlei", []]]) };
  const entry = PC.evenementEntry(rows, { vandaag: "2099-02-20", index });
  assert.deepEqual(entry.uitleg.beschrijvingen, ["Inname: De Testplein", "Parcours: Van Testlei"]);
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
  assert.deepEqual([...e.beschrijvingen].sort(), ["Inname: Van Testlei", "Parcours: De Testplein"]);
  assert.equal(e.soort, "Doop van een schip");
  // De kenmerken gaan mee (vaste woorden), de tekst niet.
  assert.ok(e.kenmerken.every((k) => KU.isKenmerk(k)), JSON.stringify(e.kenmerken));
  assert.doesNotMatch(JSON.stringify(document), /testboot/i);
});

test("de terugval bij een storing van A-Sign filtert de vorige omschrijvingen met de straatas en de privacyfilter", async (t) => {
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
  // Alleen de hele straatnamen blijven; de naam valt weg, ook als soort vooraan ("Testpersoon Voorbeeld: feest").
  assert.deepEqual(gehouden.evenementen.ET2099000503.beschrijvingen, ["Inname: Proefstraat - Van Testlei", "Inname: De Testplein"]);
  // Een bestand zonder kenmerken (van een oudere verversing) krijgt ze uit die oude omschrijvingen, vóór het filteren.
  assert.deepEqual(gehouden.evenementen.ET2099000503.kenmerken, ["straat", "overig"]);
});
