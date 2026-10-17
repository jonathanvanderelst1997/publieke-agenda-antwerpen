// Nakijkronde van head 0b264665 (vaag-eind): de gaten in de privacyfilter van de omschrijvingen (site/kaart-uitleg.js:
// lijktPersoonsnaam, veiligeTekst, bruikbareBeschrijving, veiligeOmschrijving, CONTACT) en de plaatsnamen
// (lib/plaatsnaam.mjs: plaatsnaamVan). Elke toets hieronder faalt op 0b264665 en slaagt nu; die van de nakijkronde van
// head c7f1a651 (onderaan) falen op c7f1a651. De regel: bij twijfel weg, liever een plaatsnaam te weinig dan een naam te
// veel. Alleen verzonnen proefdata (Testpersoon, Voorbeeld, Proefstraat, .test-domeinen); geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as KU from "../site/kaart-uitleg.js";
import * as PN from "../lib/plaatsnaam.mjs";
import * as PC from "../site/place-core.js";

// Zoals de kaart een bewaarde omschrijving opnieuw filtert (veiligeOmschrijving), en zoals de verversing de omschrijving
// van de live laag nog eens door de filter haalt (evenementFeiten: zonder straatas).
const nergensDoor = (t, opties = {}) => {
  assert.equal(KU.bruikbareBeschrijving(t, opties), "", t);
  assert.equal(KU.veiligeOmschrijving(`Inname: ${t}`, opties), "", `Inname: ${t}`);
};

// ---- HOOG: een naam die niet de vorm Hoofdletter + kleine letters heeft ----

test("een naam met D', O', IJ, Mc, een voorvoegsel eraan vast of een hoofdletter in het midden telt als naam", () => {
  for (const t of ["feest D'Testpersoon", "feest d'Testpersoon", "tent O'Testpersoon", "feest D'hondtproef", "feest IJsproef", "tent McTestpersoon",
    "feest DeProef", "feest VandeProef", "feest VanTestpersoon", "feest TestPersoon"]) {
    nergensDoor(t);
    assert.equal(KU.lijktPersoonsnaam(t), true, t);
  }
});

test("een naam tussen aanhalingstekens, haakjes of symbolen, of vastgeplakt met -, _, & of +, telt als naam", () => {
  for (const t of ["feest-Testpersoon", "tent bij-Testpersoon", "feest Testpersoon_Voorbeeld", "feest Testpersoon&Voorbeeld", "feest Testpersoon+Voorbeeld",
    "feest “Testpersoon”", "feest „Testpersoon”", "feest «Testpersoon»", "feest [Testpersoon]", "feest {Testpersoon}", "feest *Testpersoon*", "feest #Testpersoon", "feest |Testpersoon|",
    "feest Testpersoon2026"]) {
    nergensDoor(t);
  }
  // Wat geen naam is, blijft: trefwoorden, samenstellingen, zekere plekken, een plek met "Sint-".
  for (const t of ["Startlocatie doop", "Spelletjeslocatie -> dooplocatie (voor de trappen)", "tweede stop (Falconplein)", "kraam Proefplein", "doop Sint-Jansplein", "parcours 10K"]) {
    assert.equal(KU.bruikbareBeschrijving(t), t, t);
  }
});

// ---- MIDDEL: een zekere plek gaat niet meer vóór "na De/Van altijd een naam" en "groot/klein/oud/nieuw vooraan" ----

test("na De of Van is ook een woord op -kerk, -school, -park, -station of -dok een naam; met oud, nieuw of groot vooraan ook", () => {
  for (const t of ["doop Oudkerk", "doop Nieuwkerk", "doop Grootkerk", "doop De Testkerk", "doop Van Testschool", "doop Van Proefpark",
    "doop De Proefstation", "doop Testcentrum", "feest Verschool", "feest Van Testdok", "feest Testzaal"]) {
    nergensDoor(t);
  }
  // In de straatas of als straat van de inname bewezen: dan wel.
  assert.equal(KU.bruikbareBeschrijving("doop Van Testschool", { isStraat: (n) => n === "Van Testschool" }), "doop Van Testschool");
  assert.equal(KU.bruikbareBeschrijving("doop Oudkerk", { straten: [{ name: "Oudkerk" }] }), "doop Oudkerk");
  // Dezelfde zekere uitgangen als lib/plaatsnaam.mjs: -kerk is daar geen plek.
  assert.equal(PN.plaatsnaamVan("Testkerk"), "");
  assert.equal(PN.plaatsnaamVan("Proefplein"), "Proefplein");
});

// ---- MIDDEL: twee namen na elkaar, elk door een andere straat gedekt ----

test("voornaam + achternaam is één blok: een stuk van twee verschillende straten bewijst het niet", () => {
  assert.equal(PN.plaatsnaamVan("Pieter Voorbeeld", { rond: ["Pieter Testlaan", "Voorbeeldstraat"] }), "");
  assert.equal(PN.plaatsnaamVan("Hendrik Proefmans", { rond: ["Hendrik Testpleinstraat", "Proefmansstraat"] }), "");
  assert.equal(PN.plaatsnaamVan("Testpersoon Voorbeeld", { rond: ["Testpersoon Voorbeeldstraat"] }), "");
  assert.equal(PN.plaatsnaamVan("Testpersoon van Voorbeeld", { rond: ["Testpersoonlaan", "Voorbeeldstraat"] }), "");
  const straten = [{ name: "Hendrik Testpleinstraat" }, { name: "Proefmansstraat" }];
  nergensDoor("feest Hendrik Proefmans", { straten });
  nergensDoor("feest Hendrik van Proefmans", { straten });
  // Eén naam die een stuk van een straat in de buurt is, blijft; en een blok dat als geheel een straat is ook.
  assert.equal(PN.plaatsnaamVan("Proefmans", { rond: ["Proefmansstraat"] }), "Proefmans");
  assert.equal(KU.bruikbareBeschrijving("feest Proefmans", { straten: [{ name: "Proefmansstraat" }] }), "feest Proefmans");
  assert.equal(PN.plaatsnaamVan("Hendrik Proefmans", { rond: ["Hendrik Proefmanslaan"], isStraat: (n) => n === "Hendrik Proefmans" }), "Hendrik Proefmans");
  assert.equal(PN.plaatsnaamVan("Hendrik Proefmans", { rond: ["Hendrik Proefmans Testlaan"] }), "Hendrik Proefmans", "hele woorden van één straat");
});

// ---- MIDDEL: een huisnummer als "datum" (12/3) of als "aantal" (oprit 14 vrijhouden) ----

test("na een straat van de inname of uit de straatas gaat elk getal weg, ook 12/3, 12-14 en 12e", () => {
  const straten = [{ name: "Proefdorp" }];
  for (const t of ["feest Proefdorp 12/3", "parkeerverbod Proefdorp 12/14", "feest proefdorp 12 achtertuin", "parkeerverbod Proefdorp 12-14", "feest Proefdorp 12e"]) {
    assert.doesNotMatch(KU.bruikbareBeschrijving(t, { straten }), /\d/, t);
    assert.doesNotMatch(KU.veiligeOmschrijving(`Inname: ${t}`, { straten }), /\d/, t);
  }
  assert.equal(KU.bruikbareBeschrijving("feest Proefdorp 12/3", { straten }), "feest Proefdorp");
  // Uit de straatas (isStraat), ook een straat zonder straatuitgang.
  assert.equal(KU.bruikbareBeschrijving("feest Proefmeir 12/3", { isStraat: (n) => n === "Proefmeir" }), "feest Proefmeir");
  // Een woord op een straatuitgang (ook -dorp, -gang, -berg, -vliet) zonder straatas.
  for (const t of ["kraam Proefplein 12/3", "kraam Proefplein 12e"]) assert.equal(KU.bruikbareBeschrijving(t), "kraam Proefplein", t);
  assert.doesNotMatch(KU.zonderAdresNummers("parkeerverbod testgang 7/2"), /\d/);
});

test("een getal naast oprit, deur, garage, huis of woning is een huisnummer; een aantal alleen van iets telbaars", () => {
  for (const t of ["parkeerverbod oprit 14 vrijhouden", "tent voor deur 12 vrijhouden", "parkeerverbod garage 7 vrij", "tent 12e huis links", "parkeerverbod woning 3"]) {
    const uit = KU.bruikbareBeschrijving(t);
    assert.doesNotMatch(uit, /\d/, t);
  }
  // Een los getal voor een gewoon woord is geen aantal meer: dan is de omschrijving niet bruikbaar.
  assert.equal(KU.bruikbareBeschrijving("feest 12 achtertuin"), "");
  assert.equal(KU.veiligNummer("feest 12 achtertuin"), false);
  // Wat wel een aantal, afstand, maat, datum of volgnummer is, blijft.
  for (const t of ["12 fietsennadars", "op de 3 parkeerstroken", "4 kramen op het plein", "parkeerverbod 12-14 okt generator", "wandelen 5 km · stop 2 stadspark", "kraam van 3mx3m", "loop Proefstraat 5 km"]) {
    assert.equal(KU.bruikbareBeschrijving(t), t, t);
  }
});

// ---- MIDDEL: een mailadres zonder gewone @ ----

test("een mailadres met (at), [at], een volle-breedte ＠ of als losse domeinnaam gaat nooit door", () => {
  for (const t of ["feest info testpersoon(at)voorbeeld.test", "feest testpersoon[at]voorbeeld.test", "feest testpersoon＠voorbeeld.test", "feest inschrijven via voorbeeld.test",
    "feest testpersoon at voorbeeld punt test", "feest testpersoon (at) voorbeeld (punt) test", "feest mail naar testpersoon﹫voorbeeld.test"]) {
    nergensDoor(t);
    assert.equal(KU.veiligeTekst(t), "", t);
    assert.equal(KU.CONTACT.test(t), true, t);
  }
  assert.equal(PN.plaatsnaamVan("Proefplein voorbeeld.test"), "");
  // Ook in de tekst van een beheerder (GIPOD).
  assert.equal(KU.beheerderTekst("Herstelling voetpad, info testpersoon(at)voorbeeld.test"), "");
  // Een gewone zin met een punt blijft.
  assert.equal(KU.CONTACT.test("Verzamelen. Daarna stoet"), false);
  assert.equal(KU.CONTACT.test("St.-Jansplein t.o.v. de kerk"), false);
});

// ---- LAAG: de restgaten ----

test("een korte naam in hoofdletters na DE of VAN telt als naam; een afkorting na een gewoon lidwoord niet", () => {
  for (const t of ["tent DE TES", "tent VAN TES", "tent De TES", "tent Van TES"]) nergensDoor(t);
  assert.equal(KU.bruikbareBeschrijving("start aan het MAS"), "start aan het MAS");
  assert.equal(KU.bruikbareBeschrijving("parcours langs de MAS-toren"), "parcours langs de MAS-toren");
});

test("een achternaam in kleine letters na de/van telt ook vóór 'en', 'met', '&' of een komma", () => {
  for (const t of ["feest bij de groot en vrienden", "feest bij de groot, met muziek", "feest bij de groot met muziek", "tent van de kleine & co"]) nergensDoor(t);
  // Een bijvoeglijk naamwoord voor een ander woord blijft.
  assert.equal(KU.bruikbareBeschrijving("naar de grote tent"), "naar de grote tent");
});

test("letters buiten het Latijnse schrift, NFD en een titelletter: weg", () => {
  for (const t of ["feest تستبرسون", "feest 测试人", "feest Тестперсон", "feest Testpersön".normalize("NFD"), "feest ǅproefpersoon"]) {
    nergensDoor(t);
    assert.equal(KU.lijktPersoonsnaam(t), true, t);
  }
  assert.equal(PN.plaatsnaamVan("测试广场"), "");
  assert.equal(PN.plaatsnaamVan("Тестплощадь"), "");
  // Een Latijnse letter met een accent blijft gewoon een letter (NFC of NFD).
  assert.equal(KU.bruikbareBeschrijving("doop op de Proefplaats café".normalize("NFD")), "doop op de Proefplaats café");
});

// ======== Nakijkronde van head c7f1a651 (vaag-eind) ========
// Elke toets hieronder faalt op c7f1a651 en slaagt nu. De voorbeelden van de reviewers zijn vervangen door verzonnen namen
// met dezelfde vorm (een achternaam in kleine letters na De/Van, een D-naam met een ander apostrofteken, een naam van twee
// of drie letters in hoofdletters); geen echte namen, straten of nummers.

// ---- HOOG: na een voorvoegsel met een hoofdletter is ook een achternaam in kleine letters een naam ----

test("c7f1a651: na De, Van, Vanden, VAN ... is het eerste woord een naam, ook in kleine letters", () => {
  const isStraat = (n) => n.toLowerCase() === "de testpersoonstraat";
  for (const t of ["feest De testpersoon", "tent Van voorbeeld", "feest bij De proefman", "feest Van den proefbroeck", "feest VAN voorbeeld", "feest Vanden testpersoon"]) {
    nergensDoor(t);
    nergensDoor(t, { isStraat });
    assert.equal(KU.lijktPersoonsnaam(t), true, t);
  }
  // Een straat met die naam erin bewijst de naam niet: niet in de straatas, niet als stuk van een straat van de inname.
  nergensDoor("feest bij De testpersoon", { isStraat });
  nergensDoor("feest bij De Testpersoon", { straten: [{ name: "De Testpersoonstraat" }] });
  // Ook met kleine voorvoegsels ertussen is een samenstelling een naam ("Van de Werfkant").
  nergensDoor("feest Van de Werfkant");
  // Een gewoon woord na De of Van blijft.
  for (const t of ["De stoet vertrekt", "Van start aan de kaai"]) assert.equal(KU.bruikbareBeschrijving(t), t, t);
  // Een straat in kleine letters na Van: alleen als de straatas of de straten van de inname ze kennen.
  const t = "parkeerverbod Van proefbeeckstraat";
  assert.equal(KU.bruikbareBeschrijving(t), "");
  assert.equal(KU.bruikbareBeschrijving(t, { straten: [{ name: "Van Proefbeeckstraat" }] }), t);
  assert.equal(KU.bruikbareBeschrijving(t, { isStraat: (n) => n.toLowerCase() === "van proefbeeckstraat" }), t);
});

// ---- MIDDEL: een D-naam met een ander apostrofteken, een spatie of een punt ----

test("c7f1a651: D`, D´, D‘, D met een spatie of een punt: ook dat is een D-naam", () => {
  for (const t of ["feest D`testpersoon", "feest d`testpersoon", "tent O`voorbeeld", "feest D‘testpersoon", "feest D testpersoon", "feest D.testpersoon", "feest D´testpersoon",
    "feest D‛testpersoon", "feest D′testpersoon", "feest D-testpersoon"]) {
    nergensDoor(t);
    assert.equal(KU.lijktPersoonsnaam(t), true, t);
  }
  // Wat geen D-naam is, blijft: een afkorting met punten en een losse letter voor een gewoon woord.
  for (const t of ["parkeerverbod t.o.v. de kaai", "stoet langs de O.L.V.-kerk", "parking D tent"]) assert.equal(KU.bruikbareBeschrijving(t), t, t);
});

// ---- MIDDEL: een naam van twee of drie letters in hoofdletters ----

test("c7f1a651: een naam van twee of drie letters in hoofdletters is een naam; een afkorting alleen uit de vaste lijst", () => {
  for (const t of ["feest TEP VOK", "feest bij JAX VOK", "tent LUP BOK", "feest BEX ALK", "feest AIX ALK", "feest bij EX HAX", "feest bij QI WEX", "tent bij KIX QI",
    "feest ALK ER", "feest bij JAX", "feest QO"]) {
    nergensDoor(t);
    nergensDoor(t, { isStraat: (n) => n === "Proefstraat" });
  }
  // Ook naast een voornaam die een stuk van een straat van de inname is.
  nergensDoor("feest Hendrik VOK", { straten: [{ name: "Hendrik Testlaan" }] });
  // Afkortingen uit de lijst en een Romeins cijfer blijven.
  for (const t of ["start aan het MAS", "parcours langs de MAS-toren", "feest met DJ en BBQ", "stoet langs het OCMW", "tent bij Fort VI", "parcours fase II", "tent KSA"]) {
    assert.equal(KU.bruikbareBeschrijving(t, { isStraat: (n) => n === "Fort VI" }), t, t);
  }
});

// ---- MIDDEL: een huisnummer als "datum" na een afgekorte, verkeerd gespelde of onbekende straat ----

// Zonder en met een straatas die de straat niet kent.
const zonderNummer = (t, opties = {}) => {
  for (const o of [opties, { ...opties, isStraat: opties.isStraat || ((n) => n === "Testplein") }]) {
    assert.doesNotMatch(KU.bruikbareBeschrijving(t, o), /\d/, t);
    assert.doesNotMatch(KU.veiligeOmschrijving(`Inname: ${t}`, o), /\d/, t);
  }
};

test("c7f1a651: een huisnummer na een afgekorte straat (str., stwg., ln.), een tikfout of -veld, -heide, -park, -hoeve gaat weg", () => {
  for (const t of ["parkeerverbod proefstr 12-14", "parkeerverbod proefstr. 12/3", "parkeerverbod proefstwg 12-14", "feest proefln 12/3", "parkeerverbod proefstaat 12-14",
    "parkeerverbod proefstraaat 12/3", "parkeerverbod proefveld 12-14", "parkeerverbod proefheide 12-14", "parkeerverbod proefpark 12-14", "parkeerverbod proefhoeve 12/3"]) zonderNummer(t);
  // Ook als de straatas de straat voluit kent ("Lange Proefstraat").
  zonderNummer("parkeerverbod lange proefstr. 12-14", { isStraat: (n) => n.toLowerCase() === "lange proefstraat" });
  assert.equal(KU.bruikbareBeschrijving("parkeerverbod proefstr. 12/3"), "parkeerverbod proefstr.");
  // Een "#" zonder nummer erachter blijft niet staan.
  assert.equal(KU.bruikbareBeschrijving("parkeerverbod Proefstraat #3", { straten: ["Proefstraat"] }), "parkeerverbod Proefstraat");
});

test("c7f1a651: een datum zonder maandnaam alleen met een datumwoord ervoor en een maand tot 12, of voluit met jaartal", () => {
  for (const t of ["kraam 12-14", "kraam op 12/14", "kraam 12/3", "parkeerverbod 12/3 proefstraat"]) {
    assert.equal(KU.veiligNummer(t), false, t);
    zonderNummer(t);
  }
  for (const t of ["kraam op 12/10", "kraam van 12/10 tot 14/10", "kraam zaterdag 3/10", "kraam 01/10/2026", "parkeerverbod 16-18 okt generator", "stop 3 proefwaag"]) {
    assert.equal(KU.bruikbareBeschrijving(t, { straten: ["Proefwaag"] }), t, t);
  }
});

test("c7f1a651: een getal vlak vóór een straat van de inname of uit de straatas gaat weg, behalve een volgnummer", () => {
  const isStraat = (n) => n.toLowerCase() === "proefstraat";
  assert.equal(KU.bruikbareBeschrijving("parkeerverbod op 12/3 proefstraat", { isStraat }), "parkeerverbod op proefstraat");
  assert.equal(KU.bruikbareBeschrijving("parkeerverbod op 12/3 Proefstraat", { straten: ["Proefstraat"] }), "parkeerverbod op Proefstraat");
  assert.equal(KU.bruikbareBeschrijving("stop 3 Proefstraat", { straten: ["Proefstraat"] }), "stop 3 Proefstraat");
});

test("c7f1a651: een getal na 'garage van', 'oprit van' of 'deur nr' is een huisnummer", () => {
  for (const t of ["parkeerverbod voor garage van 12-14", "parkeerverbod oprit van 7", "tent voor deur nr. 3"]) zonderNummer(t);
  assert.equal(KU.bruikbareBeschrijving("parkeerverbod voor garage van 12-14"), "parkeerverbod voor garage");
});

// ---- MIDDEL: een telefoonnummer met koppeltekens, punten of schuine strepen ----

test("c7f1a651: een telefoonnummer met koppeltekens, punten of schuine strepen gaat nooit door, ook niet in stukken", () => {
  for (const t of ["feest info 03-123-45-67", "feest info 03/123-45-67", "feest info +32-3-123-45-67", "feest info 04/71/12/34/56", "feest 04-71-12-34-56",
    "tent, bel 0471 12-34-56", "tent, bel 03-123.45.67", "feest info 0032 3 123 45 67"]) {
    nergensDoor(t);
    assert.equal(KU.CONTACT.test(t), true, t);
  }
  // Zonder 0 of +32 vooraan: geen contact, maar ook geen datum, dus niet bruikbaar.
  nergensDoor("feest info 3-123-45-67");
  // Een datum is geen telefoonnummer.
  for (const t of ["01/10/2026", "van 01/10/2026 tot 05/10/2026", "02/10 - 05/10 - 08/10", "09.00-12.00 en 14.00-17.00"]) assert.equal(KU.CONTACT.test(t), false, t);
});

// ---- MIDDEL: de straatas overal, ook in de verversing en de terugval ----

const PROEF_AS = (n) => ["de testplein", "van testlei", "proefstraat"].includes(String(n).toLowerCase());

test("c7f1a651: evenementFeiten filtert met de straatas: een plek met De of Van die niet bij de inname staat, blijft", () => {
  const rij = (innameType, description, streets) => ({ reference: "ET2099000501", dossierType: "ETL", phase: "Evenement", innameType, description, streets, start: "2099-03-01", end: "2099-03-01" });
  const rows = [rij("Inname", "markt op het De Testplein", [{ name: "Proefstraat" }]), rij("Parcours", "stoet over de Van Testlei", [])];
  assert.deepEqual(KU.evenementFeiten(rows).beschrijvingen, []);
  assert.deepEqual(KU.evenementFeiten(rows, { isStraat: PROEF_AS }).beschrijvingen, ["Inname: markt op het De Testplein", "Parcours: stoet over de Van Testlei"]);
});

test("c7f1a651: in de browser filtert evenementEntry de live omschrijvingen met de straatas van de site", () => {
  const rij = (innameType, description, streets) => ({ reference: "ET2099000501", dossierType: "ETL", phase: "Evenement", innameType, description, streets, start: "2099-03-01", end: "2099-03-01" });
  const rows = [rij("Inname", "markt op het De Testplein", [{ name: "Proefstraat" }]), rij("Parcours", "stoet over de Van Testlei", [])];
  const index = { byName: new Map([["de testplein", []], ["van testlei", []]]) };
  const entry = PC.evenementEntry(rows, { vandaag: "2099-02-20", index });
  assert.deepEqual(entry.uitleg.beschrijvingen, ["Inname: markt op het De Testplein", "Parcours: stoet over de Van Testlei"]);
});

const as = (id, naam, coords) => ({ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: { LSTRNMID: id, LSTRNM: naam, RSTRNMID: id, RSTRNM: naam, postcode: 2000, DISTRICT: "Antwerpen" } });

test("c7f1a651: de verversing filtert met de straatas, ook een parcours zonder straten per inname", async () => {
  const { bouwKaartUitleg } = await import("../lib/kaart-uitleg-refresh.mjs");
  const streetFeatures = [as(1, "Proefstraat", [[4.400, 51.2], [4.405, 51.2]]), as(2, "De Testplein", [[4.41, 51.205], [4.412, 51.205]]), as(3, "Van Testlei", [[4.415, 51.206], [4.417, 51.206]])];
  const district = { type: "Polygon", coordinates: [[[4.39, 51.19], [4.42, 51.19], [4.42, 51.21], [4.39, 51.21], [4.39, 51.19]]] };
  const dag = Date.UTC(2099, 2, 1, 8);
  const attrs = (innameId, innameTypeNaam, innameBeschrijving) => ({ dossierNummer: "ET2099000502", faseId: "F1", innameId, dossierStatus: "aanvraag_goedgekeurd", faseNaam: "Evenement", type_dossier: "ETL", innameTypeNaam, innameBeschrijving, innameHinder: "True", faseStartDatum: dag, faseEindDatum: dag });
  const iodFeatures = [
    { attributes: attrs("I1", "Parcours", "stoet over het De Testplein"), geometry: { paths: [[[4.4001, 51.2], [4.4049, 51.2]]] } },
    { attributes: attrs("I2", "Inname", "markt aan de Van Testlei"), geometry: { rings: [[[4.4010, 51.1999], [4.4020, 51.1999], [4.4020, 51.2001], [4.4010, 51.2001], [4.4010, 51.1999]]] } },
  ];
  const { document } = await bouwKaartUitleg({ iodFeatures, district, streetFeatures, clock: () => new Date("2099-02-25T05:00:00Z"), fetch: null });
  assert.deepEqual([...document.evenementen.ET2099000502.beschrijvingen].sort(), ["Inname: markt aan de Van Testlei", "Parcours: stoet over het De Testplein"]);
});

test("c7f1a651: de terugval bij een storing van A-Sign filtert de vorige omschrijvingen met de straatas", async (t) => {
  const { schrijfKaartUitleg, KAART_UITLEG_FILE } = await import("../lib/kaart-uitleg-refresh.mjs");
  const streetFeatures = [as(1, "Proefstraat", [[4.400, 51.2], [4.405, 51.2]]), as(2, "De Testplein", [[4.41, 51.205], [4.412, 51.205]]), as(3, "Van Testlei", [[4.415, 51.206], [4.417, 51.206]])];
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "privacy-c7f1a651-"));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(rootDir, "site", "sources"), { recursive: true });
  const vorige = { schemaVersion: 1, generatedAt: "2099-02-24T05:00:00Z", vanaf: "2099-02-24", tot: "2099-04-24", werken: {}, evenementen: {
    ET2099000503: { start: "2099-03-01", eind: "2099-03-01", soort: "", soortBron: "", beschrijvingen: ["Inname: Proefstraat - Van Testlei", "Inname: markt op het De Testplein", "Inname: feest De testpersoon"], straten: ["Proefstraat"], kruist: [], stratenTekst: "", gekoppeld: null, kaart: [], kaartDeel: false },
  } };
  const bestand = path.join(rootDir, "site", "sources", KAART_UITLEG_FILE);
  fs.writeFileSync(bestand, JSON.stringify(vorige));
  const stil = () => {};
  const gehouden = await schrijfKaartUitleg({ rootDir, works: { ok: false, items: [] }, publicSpace: { ok: false }, streetFeatures, fetch: null, clock: () => new Date("2099-02-25T05:00:00Z"), log: stil });
  assert.deepEqual(gehouden.evenementen.ET2099000503.beschrijvingen, ["Inname: Proefstraat - Van Testlei", "Inname: markt op het De Testplein"]);
});

// ---- MIDDEL: een gebeurteniswoord met een hoofdletter of in hoofdletters is geen achternaam ----

test("c7f1a651: een gebeurteniswoord vooraan, alleen of in hoofdletters is geen naam; een stam die een achternaam kan zijn wel", () => {
  for (const t of ["NADARS", "PARCOURS CRITERIUM", "Start aan de Proefplaats", "Stoet", "Feest op de Proefplaats", "Opbouw podium", "OPBOUW PODIUM", "Wandelen van de Proefplaats naar het Testplein", "Event verkeersvrij"]) {
    assert.equal(KU.bruikbareBeschrijving(t), t, t);
    assert.equal(KU.veiligeOmschrijving(`Inname: ${t}`), `Inname: ${t}`, t);
  }
  // Namen blijven namen: een echte naam, een stam die ook een achternaam is, na een voorvoegsel of na een persoonswoord.
  for (const t of ["feest Testpersoon", "tent TESTPERSOON", "feest bij De Groot", "tent familie Klein", "De Stoet vertrekt", "tent familie Feest", "Hoek feest", "STOET HOEK"]) nergensDoor(t);
});
