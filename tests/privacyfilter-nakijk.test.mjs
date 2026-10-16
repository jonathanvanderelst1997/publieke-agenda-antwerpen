// Nakijkronde van head 0b264665 (vaag-eind): de gaten in de privacyfilter van de omschrijvingen (site/kaart-uitleg.js:
// lijktPersoonsnaam, veiligeTekst, bruikbareBeschrijving, veiligeOmschrijving, CONTACT) en de plaatsnamen
// (lib/plaatsnaam.mjs: plaatsnaamVan). Elke toets hieronder faalt op 0b264665 en slaagt nu. De regel: bij twijfel weg,
// liever een plaatsnaam te weinig dan een naam te veel. Alleen verzonnen proefdata (Testpersoon, Voorbeeld, Proefstraat,
// .test-domeinen); geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";

import * as KU from "../site/kaart-uitleg.js";
import * as PN from "../lib/plaatsnaam.mjs";

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
