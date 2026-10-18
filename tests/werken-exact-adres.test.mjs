// Besluit van de eigenaar (18 oktober 2026) voor de werken van GIPOD: de PLAATS mag exact (de straat met het huisnummer of
// het bereik, zoals de bron ze geeft, ook als het nummer aan een code plakt: "PROEFSTRAAT 1DN02"), maar niets dat over een
// persoon of zijn huishouden vertelt. Het woord "verhuis" komt bij een werk nergens publiek: een werk met de soort inname
// "(Verhuis)lift/levering" heet "Inname voor een lift of levering", een tekst met "verhuis" houdt alleen zijn adres (zonder
// eigen spoor: tests/werken-verhuis-spoor.test.mjs). Namen en contactgegevens blijven weg. De regel staat in site/works-core.js (de ingang), site/kaart-uitleg.js (de
// kaart), lib/kaart-uitleg-refresh.mjs, lib/historiek-privacy.mjs en lib/straat-bestanden.mjs (wat bewaard wordt, met de
// scans van validate-data). Een parkeerverbod verandert hier niet (tak claude/parkeerverbod-zonder-reden).
// Alle straten, nummers, namen en codes zijn verzonnen; geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as KU from "../site/kaart-uitleg.js";
import * as SC from "../site/street-core.js";
import * as LSR from "../lib/street-resolver.mjs";
import { GEEN_OMSCHRIJVING, INNAME_LIFT, collectWorks, innameZonderVerhuis, werkZonderVerhuis, zonderVerhuis } from "../site/works-core.js";
import { attachHindrance } from "../site/works-hindrance.js";
import { publicSpaceEntries, samenWerven, werkEntries, workEntry } from "../site/place-core.js";
import { compactWorkItem, updateLiveHistory } from "../lib/live-history.mjs";
import { historiekPrivacyBevindingen, historiekVoorPubliek, itemVoorHistoriek, resultaatVoorHistoriek, tekstZonderHuisnummers, werkenZoalsBekend } from "../lib/historiek-privacy.mjs";
import { straatItemPrivacy } from "../lib/straat-bestanden.mjs";
import { STRAAT_SCHEMA, itemVoorStraat, schrijfStraatSnapshots, straatBestandenProblemen } from "../scripts/build-straat-snapshots.mjs";
import { bouwKaartUitleg, kaartUitlegVoorPubliek, schoonWerk } from "../lib/kaart-uitleg-refresh.mjs";
import { validateKaartUitleg, werkFouten } from "../lib/kaart-uitleg-validatie.mjs";
import { refreshLiveHistory } from "../scripts/refresh-live-history.mjs";

const VANDAAG = "2099-03-10";
const VERHUIS = /verhui[sz]/i;
// Ook met een verborgen teken of een accent (tests/werken-verhuis-spoor.test.mjs).
const plat = (t) => String(t).normalize("NFKD").replace(/[\p{Cf}\p{M}]/gu, "");
const PUNT = [4.4, 51.22];
// Een GIPOD-werk zoals INNAME_PUNT het geeft (verzonnen).
const gipod = (id, properties) => ({ type: "Feature", geometry: { type: "Point", coordinates: PUNT }, properties: { GipodId: id, Status: "In uitvoering", Start: "2099-03-01T06:00:00Z", End: "2099-03-30T16:00:00Z", LastModifiedOn: "2099-02-01T00:00:00Z", ...properties } });
const hinder = (gipodId, description) => ({ type: "Feature", geometry: { type: "Point", coordinates: PUNT }, properties: { HindranceStatus: "Gevalideerd", HindranceConsequenceOf: `https://gipod.api.vlaanderen.be/api/v1/works/${gipodId}`, HindranceGipodId: gipodId + 5000, HindranceDescription: description, HindranceStart: "2099-03-12T06:00:00Z", HindranceEnd: "2099-03-12T16:00:00Z", Consequences: "Parkeerverbod" } });
const AANSLUITING = gipod(990801, { Description: "2018 ANTWERPEN, PROEFSTRAAT 1DN02", Owner: "Fluvius System Operator", PublicDomainOccupancyTypes: "Elektriciteit", GroundworkSpecification: "klantaansluiting" });
const LIFT = gipod(990802, { Description: "2000 ANTWERPEN, TESTLAAN 12", Owner: "Stad Antwerpen - Proefdienst", PublicDomainOccupancyTypes: "(Verhuis)lift/levering" });
// Een tekst met "verhuis" en een naam (verzonnen): alleen het adres komt op de site.
const MET_NAAM = gipod(990803, { Description: "Verhuis fam. Proefmans, Testlaan 14", Owner: "Verhuizingen Proefmans BV", PublicDomainOccupancyTypes: "Container;(Verhuis)lift/levering" }); // verzonnen
const STRATEN = { 990801: [{ id: "9101", name: "Proefstraat", postcode: "2018" }], 990802: [{ id: "9102", name: "Testlaan", postcode: "2000" }], 990803: [{ id: "9102", name: "Testlaan", postcode: "2000" }] };
// De straatas zoals de ingang ze krijgt (collectWorks, verzonnen): alleen een straat die we kennen is een straat (adresDeel in
// site/huisnummers.js).
const isStraat = (naam) => ["proefstraat", "testlaan", "voorbeeldlaan"].includes(String(naam).toLowerCase());
const werken = () => attachHindrance(collectWorks([AANSLUITING, LIFT, MET_NAAM], new Set([990801, 990802, 990803]), null, { isStraat }), [hinder(990802, "Verhuis"), hinder(990803, "Verhuislift fam. Proefmans")], true)
  .map((w) => ({ ...w, streets: STRATEN[w.gipodId], streetResolution: "nearest_official_axis", streetDistanceMeters: 2 }));
const per = (lijst) => Object.fromEntries(lijst.map((w) => [w.gipodId, w]));
const teksten = (waarde, uit = []) => {
  if (typeof waarde === "string") uit.push(waarde);
  else if (Array.isArray(waarde)) for (const v of waarde) teksten(v, uit);
  else if (waarde && typeof waarde === "object") for (const v of Object.values(waarde)) teksten(v, uit);
  return uit;
};
const nergensVerhuis = (waarde, wat) => { for (const t of teksten(waarde)) assert.doesNotMatch(plat(t), VERHUIS, `${wat}: ${JSON.stringify(t)}`); };
const kaart = (w) => KU.werkKaartje(w, { vandaag: VANDAAG, isStraat });
const regels = (k) => Object.fromEntries(k.regels);
const getoond = (k) => [k.titel, k.samenvatting, k.plek, k.bronTekst, ...k.regels.flat(), ...k.ontbreekt].join(" ¶ ");

// ---------- de ingang: GIPOD ----------

test("ingang: een tekst met 'verhuis' houdt alleen zijn adres, '(Verhuis)lift/levering' heet 'Lift/levering', een opdrachtgever met 'verhuis' valt weg", () => {
  const w = per(werken());
  assert.equal(w[990801].title, "2018 ANTWERPEN, PROEFSTRAAT 1DN02", "een titel zonder 'verhuis' blijft zoals GIPOD hem geeft");
  assert.deepEqual(w[990802].occupancyTypes, ["Lift/levering"]);
  // Alleen het adres zoals de beheerder het schreef (nakijkronde van head c4bb2927: de plaats exact, ook bij één huis); de
  // naam en het woord vallen weg. Zonder adres: de titel van een werk zonder omschrijving.
  assert.equal(w[990803].title, "Testlaan 14"); // verzonnen
  assert.equal(collectWorks([gipod(990806, { Description: "Verhuislift fam. Proefmans" })], new Set([990806]))[0].title, GEEN_OMSCHRIJVING); // verzonnen
  assert.equal(w[990803].owner, "");
  assert.deepEqual(w[990803].occupancyTypes, ["Container;Lift/levering"]);
  // De hinderfase met dat woord is er niet (zoals een fase zonder omschrijving); haar gevolgen blijven bij het werk.
  assert.deepEqual(w[990802].hindrance.phases, []);
  assert.deepEqual(w[990803].hindrance.phases, []);
  assert.deepEqual(w[990802].hindrance.consequences, ["Parkeerverbod"]);
  nergensVerhuis(werken(), "collectWorks");
  assert.doesNotMatch(JSON.stringify(werken()), /Proefmans/);
  // De regels zelf: elke vorm van het woord, en niets anders verandert.
  for (const t of ["Verhuis", "verhuislift", "VERHUISWAGEN", "Verhuizing fam. Proefmans", "verhuizen"]) assert.equal(zonderVerhuis(t), "", t);
  assert.equal(zonderVerhuis("Levering van een container"), "Levering van een container");
  assert.equal(innameZonderVerhuis("(Verhuis)lift/levering"), "Lift/levering");
  assert.equal(innameZonderVerhuis("Kunstwerk;(verhuis)Lift/levering;Container"), "Kunstwerk;Lift/levering;Container");
  assert.equal(innameZonderVerhuis("Verhuiswagen"), "Andere");
  assert.deepEqual(werkZonderVerhuis({ soort: "Verhuis", innameSoort: "Verhuislift of levering", inname: ["verhuislift of levering", "container"], opdrachtgever: "Verhuizingen Proef", fasen: [{ naam: "verhuis", start: "2099-03-12" }] }),
    { soort: "", innameSoort: INNAME_LIFT, inname: ["lift of levering", "container"], opdrachtgever: "", fasen: [] });
});

// ---------- de kaart ----------

test("kaart: een aansluiting op 'PROEFSTRAAT 1DN02' toont dat adres, in de titel en bij 'Waar', zonder iets weg te schrijven", () => {
  const k = kaart(per(werken())[990801]);
  assert.match(k.titel, /^Nieuwe aansluiting op het elektriciteitsnet in de Proefstraat nr\. 1DN02 /);
  assert.equal(regels(k).Waar, "Proefstraat, nr. 1DN02 (omschrijving van de beheerder)");
  assert.equal(k.plek, "Proefstraat nr. 1DN02");
  assert.doesNotMatch(getoond(k), /weggelaten|huisnummers niet gepubliceerd/);
  const f = KU.werkFeiten(per(werken())[990801]);
  assert.equal(f.omschrijving, "2018 ANTWERPEN, PROEFSTRAAT 1DN02");
  assert.equal(f.huisnummers, "nr. 1DN02");
  // Ook één gewoon nummer en een nummer met een woord eraan; geen maat, uur of rangtelwoord.
  assert.equal(KU.huisnummersUitTekst("2018 ANTWERPEN, PROEFSTRAAT 12", "Proefstraat"), "nr. 12");
  assert.equal(KU.huisnummersUitTekst("2018 ANTWERPEN, PROEFSTRAAT 8werf", "Proefstraat"), "nr. 8werf");
  for (const t of ["Proefstraat 30m kabel", "Proefstraat 8u tot 17u", "Proefstraat 2de fase", "Proefstraat 2001AB"]) assert.equal(KU.huisnummersUitTekst(t, "Proefstraat"), "", t); // verzonnen
  assert.equal(KU.geldigeHuisnummers("nr. 1DN02"), "nr. 1DN02");
  assert.equal(KU.geldigeHuisnummers("nr. 0DN02"), "");
});

test("kaart: een werk met '(Verhuis)lift/levering' toont zijn adres en heet neutraal, nergens 'verhuis'", () => {
  const k = kaart(per(werken())[990802]);
  assert.match(k.titel, new RegExp(`^${INNAME_LIFT} in de Testlaan nr\\. 12\\b`));
  assert.equal(regels(k).Waar, "Testlaan, nr. 12 (omschrijving van de beheerder)");
  assert.match(regels(k).Wat, /^Inname voor een lift of levering, afgeleid uit de soort inname in GIPOD\./);
  // De fase met dat woord is er niet; haar gevolg staat bij het werk.
  assert.equal(regels(k).Fasen, undefined);
  assert.match(regels(k).Gevolgen, /^Parkeerverbod \(12 maart\)/);
  nergensVerhuis(k, "kaartje");
  // Wat GIPOD als leesbare soort geeft, ook naast een andere soort.
  assert.deepEqual(KU.innameLeesbaar(["Container;(Verhuis)lift/levering"]), ["container", "lift of levering"]);
  const twee = kaart(per(werken())[990803]);
  // Het adres in de tekst met "verhuis" blijft (nakijkronde van head c4bb2927), de rest van die tekst niet.
  assert.match(twee.titel, new RegExp(`^${INNAME_LIFT} in de Testlaan nr\\. 14: `));
  assert.match(regels(twee).Wat, /Volgens GIPOD: container · lift of levering\./);
  // De vaste tekst is niet de tekst van de beheerder: geen "De beheerder schrijft", geen naam, geen opdrachtgever.
  assert.equal(twee.bronTekst, "");
  assert.doesNotMatch(getoond(twee), /De beheerder schrijft|Proefmans/); // verzonnen
  nergensVerhuis(twee, "kaartje met een naam");
  // Het woord zelf geeft geen soort; de soort inname van GIPOD wel.
  assert.equal(KU.soortVanWerk({ fasen: ["Verhuis"] }).soort, "");
  assert.equal(KU.soortVanWerk({ fasen: [], occupancyTypes: ["Lift/levering"] }).soort, INNAME_LIFT);
});

test("kaart: feiten van een oudere verversing ('Verhuis', 'Verhuislift of levering') worden neutraal, ook op de plekpagina", () => {
  const oud = {
    soort: "Verhuis", soortBron: "fasen van de hinder in GIPOD", innameSoort: "Verhuislift of levering", omschrijving: "", opdrachtgever: "Stad Antwerpen - Proefdienst",
    straten: ["Testlaan"], huisnummers: "nr. 12", huisnummerBron: "afgeleid uit de werfzone en het adressenregister", gevolgen: [], fasen: [{ naam: "Verhuis", start: "2099-03-12", eind: "2099-03-12" }], bijgewerkt: "x",
  };
  const live = { gipodId: 990804, title: "Werk in openbaar domein", status: "In uitvoering", start: "2099-03-01T06:00:00Z", end: "2099-03-30T16:00:00Z", owner: "Stad Antwerpen - Proefdienst", ownerGroup: "Stad Antwerpen", streets: [{ name: "Testlaan" }], occupancyTypes: [], workTypes: [], hindrance: null };
  const e = workEntry(live, { vandaag: VANDAAG, uitleg: { werken: { 990804: oud } } });
  assert.match(e.title, new RegExp(`^${INNAME_LIFT} in de Testlaan nr\\. 12 `));
  nergensVerhuis({ title: e.title, summary: e.summary, location: e.location, uitleg: e.uitleg }, "plekpagina");
  // Het bestand zelf: de validatie keurt "verhuis" bij een werk af, de opkuis maakt het neutraal.
  assert.deepEqual(werkFouten("990804", oud), ["werken.990804: verhuis in een tekst"]);
  const schoon = schoonWerk(oud);
  assert.deepEqual(werkFouten("990804", schoon), []);
  assert.equal(schoon.soort, INNAME_LIFT);
  assert.equal(schoon.soortBron, "soort inname in GIPOD");
  assert.equal("innameSoort" in schoon, false);
  assert.deepEqual(schoon.fasen, [], "de fase met dat woord valt weg");
  assert.equal(schoon.huisnummers, "nr. 12", "het huisnummer blijft");
  const doc = { schemaVersion: 1, generatedAt: "2099-03-10T05:00:00.000Z", vanaf: "2099-03-10", tot: "2099-05-09", werken: { 990804: oud }, evenementen: {} };
  assert.ok(validateKaartUitleg(doc).some((f) => /verhuis in een tekst/.test(f)));
  const publiek = kaartUitlegVoorPubliek(doc);
  assert.deepEqual(validateKaartUitleg(publiek), []);
  nergensVerhuis(publiek.werken, "kaartUitlegVoorPubliek");
  // Een oudere verversing hield alleen een reeks: het nummer van de beheerder komt terug uit zijn tekst.
  assert.equal(schoonWerk({ ...oud, soort: "Nieuwe aansluiting op het gasnet", innameSoort: undefined, omschrijving: "2000 ANTWERPEN, TESTLAAN 7", huisnummers: "", fasen: [] }).huisnummers, "nr. 7");
});

test("werf: een werfkaart en een werfzone met feiten van een oudere verversing zeggen nergens 'verhuis'", () => {
  const TESTLAAN = { id: "9102", name: "Testlaan", postcode: "2000" };
  const oud = {
    dossier: "GW2099-000807", soort: "Verhuislift of levering", soortBron: "soort inname in GIPOD", omschrijving: "", opdrachtgever: "Verhuizingen Proefmans BV", straten: ["Testlaan"], gevolgen: [],
    huisnummers: "nr. 12", huisnummerBron: "afgeleid uit de werfzone en het adressenregister", bijgewerkt: "", fasen: [{ naam: "Verhuis", start: "2099-03-12", eind: "2099-03-12" }],
  };
  const uitleg = { werken: { 990807: oud } };
  const werk = { gipodId: 990807, dossier: "GW2099-000807", title: "Werk in openbaar domein", owner: "Stad Antwerpen - Proefdienst", ownerGroup: "Stad Antwerpen", status: "In uitvoering", start: "2099-03-01T06:00:00Z", end: "2099-03-30T16:00:00Z", workTypes: [], occupancyTypes: ["Andere"], point: PUNT, streets: [TESTLAAN] };
  // De werfkaart (het werk met het dossiernummer van een werfzone): de soort inname van GIPOD gaat voor op de vaste tekst
  // van de fase, met het adres, en nergens "verhuis" of de opdrachtgever met dat woord.
  const [kaartje] = samenWerven(werkEntries([werk], { vandaag: VANDAAG, uitleg }), { uitleg, straat: "Testlaan", vandaag: VANDAAG, alle: [] });
  assert.equal(kaartje.werf?.dossier, "GW2099-000807");
  assert.match(kaartje.title, new RegExp(`^${INNAME_LIFT} in de Testlaan nr\\. 12 `));
  assert.equal(regels(kaartje.uitleg).Fasen, undefined, "de fase met dat woord valt weg");
  nergensVerhuis(kaartje, "werfkaart");
  // Een werfzone van A-Sign zonder werkkaart op de plek: "Werf volgens GIPOD" komt uit de bewaarde feiten.
  const zone = { id: "sgw:GW2099-000807|1", kind: "sgw", kindLabel: "Werfzone", title: "Werfzone", location: "", reference: "GW2099-000807", detail: "Fase 1", status: "vergund", start: "2099-03-01", end: "2099-03-30", streets: [TESTLAAN], werfzoneStreets: [TESTLAAN], omleidingStreets: [] };
  const kaarten = samenWerven(publicSpaceEntries([zone], { vandaag: VANDAAG, alle: [zone], uitleg, straat: "Testlaan" }), { uitleg, straat: "Testlaan", vandaag: VANDAAG, alle: [zone] });
  const werfzone = kaarten.find((e) => e.item?.kind === "sgw");
  const volgensGipod = (werfzone?.regels || werfzone?.uitleg?.regels || []).find(([naam]) => naam === "Werf volgens GIPOD")?.[1] || "";
  assert.match(volgensGipod, /GIPOD 990807, zelfde dossiernummer/);
  assert.doesNotMatch(volgensGipod, /beheerder in GIPOD/, "de opdrachtgever met 'verhuis' valt weg");
  nergensVerhuis(kaarten, "werfzone");
});

test("kaart: namen, contactgegevens en vrije tekst blijven geweerd", () => {
  const met = (title, extra = {}) => kaart({ gipodId: 990805, title, status: "In uitvoering", start: "2099-03-01T06:00:00Z", end: "2099-03-30T16:00:00Z", owner: "Proefnet", ownerGroup: "Andere", streets: [{ name: "Proefstraat" }], occupancyTypes: ["Telecom"], workTypes: [], hindrance: null, ...extra });
  // Een naam na een dossiercode (een werkleider): weg, ook naast een huisnummer dat blijft.
  const naam = met("Proefstraat 12 DNW12345678_Jan Proefmans LS_kast vervangen"); // verzonnen
  assert.match(naam.titel, /Proefstraat nr\. 12 /);
  assert.doesNotMatch(getoond(naam), /Jan|Proefmans/);
  // Contactgegevens: de tekst van de beheerder valt helemaal weg, net als een fase met een telefoonnummer.
  const contact = met("Proefstraat 12 - info: proef@voorbeeld.invalid", { hindrance: { severe: false, consequences: [], start: "2099-03-12T06:00:00Z", end: "2099-03-12T16:00:00Z", phases: [{ description: "Bel 0470 12 34 56", start: "2099-03-12T06:00:00Z", end: "2099-03-12T16:00:00Z", consequences: [] }] } });
  assert.doesNotMatch(getoond(contact), /@|0470/);
  assert.match(contact.titel, /Proefstraat nr\. 12 /, "het adres zelf blijft");
  // De vrije tekst van een inname van A-Sign: nog altijd alleen een volledige straatnaam (de grondregel).
  const alleenProefstraat = (n) => n === "Proefstraat";
  assert.equal(KU.veiligeTekst("Verhuis fam. Proefmans Proefstraat 12", { isStraat: alleenProefstraat }), "Proefstraat"); // verzonnen
  assert.equal(KU.veiligeTekst("Verhuislift voor Proefmans", { isStraat: alleenProefstraat }), "");
});

// ---------- wat bewaard wordt: historiek, straatbestanden, kaart-uitleg.json ----------

test("historiek: een werk houdt zijn huisnummer en heeft nergens 'verhuis'; een parkeerverbod blijft zonder huisnummer", () => {
  const T = "2099-03-10T03:00:00.000Z";
  const parkeer = { id: "parking:PROEF-1|L1", kind: "parking", kindLabel: "Parkeerverbod", title: "Parkeerverbod", location: "Proefstraat 12-14 2018 Antwerpen", start: T, end: T, status: "Goedgekeurd", reference: "PROEF-1", detail: "", streets: [{ id: "9101", name: "Proefstraat", postcode: "2018" }] }; // verzonnen
  const h = updateLiveHistory(null, { observedAt: T, worksResult: resultaatVoorHistoriek({ ok: true, items: werken() }), publicSpaceResult: resultaatVoorHistoriek({ ok: true, items: [parkeer] }) });
  const werk = Object.fromEntries(h.layers.works.items.map((w) => [w.gipodId, w]));
  assert.equal(werk[990801].title, "2018 ANTWERPEN, PROEFSTRAAT 1DN02");
  assert.equal(werk[990802].title, "2000 ANTWERPEN, TESTLAAN 12");
  assert.deepEqual(werk[990802].occupancyTypes, ["Lift/levering"]);
  assert.equal(h.layers.publicSpace.items[0].location, "Proefstraat, 2018 Antwerpen");
  nergensVerhuis(h.layers.works, "historiek");
  assert.deepEqual(historiekPrivacyBevindingen(h), []);
  // Een oude stand (van vóór 18 oktober 2026) met "verhuis": de scan meldt het pad, nooit de waarde; de opkuis maakt het neutraal.
  const oud = { ...h, layers: { ...h.layers, works: { ...h.layers.works, items: [{ ...werk[990802], occupancyTypes: ["(Verhuis)lift/levering"], title: "Verhuis Testlaan 12" }] } } }; // verzonnen
  const vondsten = historiekPrivacyBevindingen(oud);
  // Ook "vrije_tekst": een lift is een werk voor één huis, en "Verhuis" naast het adres is vrije tekst van de beheerder.
  assert.deepEqual(vondsten.map((v) => v.code), ["vrije_tekst", "verhuis", "verhuis"]);
  assert.ok(vondsten.every((v) => !/verhuis|Testlaan/i.test(v.path)));
  const schoon = historiekVoorPubliek(oud);
  assert.deepEqual(historiekPrivacyBevindingen(schoon), []);
  assert.deepEqual(schoon.layers.works.items[0].occupancyTypes, ["Lift/levering"]);
  assert.equal(schoon.layers.works.items[0].title, "Testlaan 12", "alleen het adres"); // verzonnen
  // Een wijziging van een werk (zonder id in de velden) volgt dezelfde regel.
  const wijziging = historiekVoorPubliek({ ...h, changes: [{ observedAt: T, layer: "works", id: "work:990802", type: "changed", fields: ["occupancyTypes", "title"], before: { occupancyTypes: [], title: "Testlaan 10" }, after: { occupancyTypes: ["(Verhuis)lift/levering"], title: "Testlaan 12" } }] }); // verzonnen
  assert.deepEqual(wijziging.changes[0].after, { occupancyTypes: ["Lift/levering"], title: "Testlaan 12" }); // verzonnen
  assert.deepEqual(wijziging.changes[0].before, { occupancyTypes: [], title: "Testlaan 10" }); // verzonnen
  // Buiten een werk blijft de oude regel: een huisnummer valt weg, en "verhuis" is daar geen vondst van deze regel.
  assert.deepEqual(itemVoorHistoriek({ title: "2000 Antwerpen, Proefstraat 12" }).title, "2000 Antwerpen, Proefstraat"); // verzonnen
  assert.deepEqual(historiekPrivacyBevindingen({ title: "2000 Antwerpen, Proefstraat 12" }).map((v) => v.code), ["huisnummer"]); // verzonnen
});

test("historiek: de overgang maakt geen valse wijziging; een werk voor één huis houdt de titel die de historiek kende, een ander werk zijn huisnummer", () => {
  const T1 = "2099-03-09T03:00:00.000Z", T2 = "2099-03-10T03:00:00.000Z", T3 = "2099-03-11T03:00:00.000Z";
  const resultaat = (items) => resultaatVoorHistoriek({ ok: true, items });
  const leeg = { ok: true, items: [] };
  // Naast de werken voor één huis een publiek project (riolering) met een huisnummer (verzonnen).
  const RIOOL = { ...per(werken())[990801], gipodId: 990820, title: "2018 ANTWERPEN, PROEFSTRAAT 30 - vervanging riolering", owner: "Proefwater", ownerGroup: "Andere", occupancyTypes: ["Riolering"], workTypes: [] }; // verzonnen
  const lijst = () => [...werken(), RIOOL];
  const eerst = updateLiveHistory(null, { observedAt: T1, worksResult: resultaat(lijst()), publicSpaceResult: leeg });
  // De historiek zoals de regel van vóór 18 oktober 2026 ze schreef: zonder huisnummers in de titel.
  const oud = { ...eerst, layers: { ...eerst.layers, works: { ...eerst.layers.works, items: eerst.layers.works.items.map((w) => ({ ...w, title: tekstZonderHuisnummers(w.title) })) } } };
  assert.ok(oud.layers.works.items.some((w) => w.title === "2000 ANTWERPEN, TESTLAAN"), "de oude stand had geen huisnummer");
  // Zoals scripts/refresh-live-history.mjs: eerst werkenZoalsBekend (lib/historiek-privacy.mjs), dan de historiek.
  const nu = (items, vorige) => resultaat(werkenZoalsBekend(items, vorige.layers.works));
  const daarna = updateLiveHistory(oud, { observedAt: T2, worksResult: nu(lijst(), oud), publicSpaceResult: leeg });
  assert.deepEqual(daarna.changes.filter((c) => c.layer === "works"), [], "geen 'changed'");
  const titel = Object.fromEntries(daarna.layers.works.items.map((w) => [w.gipodId, w.title]));
  // Een werk voor één huis wordt niet onthullender dan wat de historiek kende (nakijkronde van head c4bb2927).
  assert.equal(titel[990802], "2000 ANTWERPEN, TESTLAAN");
  // De oude regel van de historiek liet een nummer met een code staan ("1DN02"): dat kende ze dus al.
  assert.equal(titel[990801], "2018 ANTWERPEN, PROEFSTRAAT 1DN02");
  // Een publiek project krijgt zijn huisnummer terug (werkenVoorVergelijking): dat stond al in kaart-uitleg.json van main.
  assert.equal(titel[990820], "2018 ANTWERPEN, PROEFSTRAAT 30 - vervanging riolering");
  // Een nieuw werk voor één huis krijgt zijn exacte adres; een andere plaats in GIPOD blijft een wijziging. Alleen een ander
  // huisnummer is dat niet: de historiek kende het werk zonder nummer, en zo blijft het.
  // De andere plaats ligt aan een andere straat: die krijgt het werk ook (de straatas; alleen een straat die we kennen houdt
  // een werk voor één huis in zijn titel).
  const ander = lijst().map((w) => (w.gipodId === 990802 ? { ...w, title: "2000 ANTWERPEN, VOORBEELDLAAN 14 - levering", streets: [{ id: "9104", name: "Voorbeeldlaan", postcode: "2000" }] } : w.gipodId === 990802 + 18 ? { ...w, title: "2018 ANTWERPEN, PROEFSTRAAT 32 - vervanging riolering" } : w)); // verzonnen
  const later = updateLiveHistory(daarna, { observedAt: T3, worksResult: nu([...ander, { ...per(werken())[990802], gipodId: 990821 }], daarna), publicSpaceResult: leeg });
  assert.deepEqual(later.changes.filter((c) => c.layer === "works").map((c) => [c.id, c.type, c.fields]), [["work:990802", "changed", ["title"]], ["work:990820", "changed", ["title"]], ["work:990821", "added", []]]);
  assert.equal(later.layers.works.items.find((w) => w.gipodId === 990821).title, "2000 ANTWERPEN, TESTLAAN 12");
  assert.equal(later.layers.works.items.find((w) => w.gipodId === 990802).title, "2000 ANTWERPEN, VOORBEELDLAAN 14");
  // Bij een publiek project is een ander huisnummer wel een wijziging.
  assert.equal(later.layers.works.items.find((w) => w.gipodId === 990820).title, "2018 ANTWERPEN, PROEFSTRAAT 32 - vervanging riolering");
});

test("straatbestanden: een werk houdt zijn huisnummer (ook na 'gevel nummer'), zonder 'verhuis'; de scan van validate-data volgt", () => {
  const w = per(werken());
  const fase = { description: "stelling aan gevel nummer 3", start: "2099-03-12T06:00:00Z", end: "2099-03-12T16:00:00Z", consequences: ["Parkeerverbod"] };
  const item = itemVoorStraat({ ...w[990801], hindrance: { severe: false, consequences: [], phases: [fase] } }, { laag: "werken" });
  assert.equal(item.title, "2018 ANTWERPEN, PROEFSTRAAT 1DN02");
  // Een aansluiting is een werk voor één huis: de fase houdt haar dag en gevolgen, haar vrije tekst niet
  // (tests/werken-nakijk3.test.mjs 3). Een publiek project (riolering) houdt de tekst, met het nummer na "gevel nummer".
  assert.equal(item.hindrance.phases[0].description, "");
  assert.deepEqual(item.hindrance.phases[0].consequences, ["Parkeerverbod"]);
  assert.deepEqual(straatItemPrivacy({ werken: [item] }), []);
  const riool = itemVoorStraat({ ...w[990801], gipodId: 990899, title: "2018 ANTWERPEN, PROEFSTRAAT 1-9 - riolering", occupancyTypes: ["Riolering"], workTypes: [], hindrance: { severe: false, consequences: [], phases: [fase] } }, { laag: "werken" }); // verzonnen
  assert.equal(riool.hindrance.phases[0].description, "stelling aan gevel nummer 3");
  assert.deepEqual(straatItemPrivacy({ werken: [riool] }), []);
  const lift = itemVoorStraat(w[990802], { laag: "werken" });
  assert.equal(lift.title, "2000 ANTWERPEN, TESTLAAN 12");
  nergensVerhuis(lift, "straatbestand");
  // Een oud item met "verhuis": een vondst, en itemVoorStraat maakt het neutraal.
  const oud = { ...lift, occupancyTypes: ["(Verhuis)lift/levering"] };
  assert.deepEqual(straatItemPrivacy({ werken: [oud] }).map((v) => v.code), ["verhuis"]);
  assert.deepEqual(itemVoorStraat(oud, { laag: "werken" }).occupancyTypes, ["Lift/levering"]);
});

test("straatbestanden: een oud bestand met 'verhuis' bij een werk wordt bij het herschrijven neutraal en houdt het adres", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "werken-exact-adres-straat-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "site", "geo"), { recursive: true });
  fs.mkdirSync(path.join(root, "site", "straat"), { recursive: true });
  fs.writeFileSync(path.join(root, "site", "geo", "straten.json"), JSON.stringify({ schemaVersion: 1, streets: [["9102", "Testlaan", "2000", ["2000-01"], [4.399, 51.219, 4.401, 51.221]]] }));
  // Een straatbestand van vóór 18 oktober 2026 (verzonnen): de soort inname en de fase met "verhuis".
  const oudWerk = {
    id: "work:990808", gipodId: 990808, title: "2000 ANTWERPEN, TESTLAAN 12", status: "In uitvoering", start: "2099-03-01", end: "2099-03-30", occupancyTypes: ["(Verhuis)lift/levering"],
    hindrance: { severe: false, consequences: [], phases: [{ description: "Verhuis", start: "2099-03-12T06:00:00Z", end: "2099-03-12T16:00:00Z", consequences: [] }] }, streets: [0],
  };
  const oud = { schemaVersion: STRAAT_SCHEMA, ververst: "2099-03-09T03:00:00.000Z", inhoud: "oud", straat: { id: "9102", namen: [{ name: "Testlaan", postcode: "2000" }] }, straten: [["9102", "Testlaan", "2000"]], werken: [oudWerk], publiekeRuimte: [], vergunningen: [], terrassen: [], evenementen: [] };
  fs.writeFileSync(path.join(root, "site", "straat", "9102.json"), JSON.stringify(oud));
  const stand = { status: "ok", sinds: "2099-03-09T03:00:00.000Z" };
  fs.writeFileSync(path.join(root, "site", "straat-index.json"), JSON.stringify({ schemaVersion: STRAAT_SCHEMA, ververst: "2099-03-09T03:00:00.000Z", lagen: { werken: stand, publiekeRuimte: stand, vergunningen: stand, terrassen: stand, evenementen: stand }, straten: { 9102: "oud" } }));
  assert.deepEqual(straatBestandenProblemen(root).length > 0, true, "het oude bestand is een vondst van de scan");
  schrijfStraatSnapshots({ rootDir: root, herschrijf: true, agendaItems: [], history: null, clock: () => new Date("2099-03-10T10:00:00Z") });
  const herschreven = JSON.parse(fs.readFileSync(path.join(root, "site", "straat", "9102.json"), "utf8"));
  assert.equal(herschreven.werken.length, 1, "het werk blijft");
  assert.equal(herschreven.werken[0].title, "2000 ANTWERPEN, TESTLAAN 12", "met zijn huisnummer");
  assert.deepEqual(herschreven.werken[0].occupancyTypes, ["Lift/levering"]);
  assert.deepEqual(herschreven.werken[0].hindrance.phases, []);
  nergensVerhuis(herschreven, "herschreven straatbestand");
  assert.deepEqual(straatBestandenProblemen(root), []);
});

test("verversing: GIPOD met '1DN02' en '(Verhuis)lift/levering' geeft een historiek, kaart-uitleg.json en straatbestanden met het adres en zonder 'verhuis'", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "werken-exact-adres-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const DISTRICT = { type: "Polygon", coordinates: [[[4.38, 51.2], [4.43, 51.2], [4.43, 51.24], [4.38, 51.24], [4.38, 51.2]]] };
  const as = (id, naam, postcode, coords) => ({ type: "Feature", properties: { LSTRNMID: id, LSTRNM: naam, RSTRNMID: id, RSTRNM: naam, postcode, DISTRICT: "ANTWERPEN" }, geometry: { type: "LineString", coordinates: coords } });
  const STRAAT = as("9101", "Proefstraat", "2018", [[4.399, 51.219], [4.401, 51.221]]);
  const nepFetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/portal_publiek9/MapServer/905/")) return Response.json({ type: "FeatureCollection", features: [STRAAT] });
    if (url.pathname.includes("/portal_publiek2/MapServer/109/")) return Response.json({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: DISTRICT }] });
    if (url.pathname.endsWith("/collections/INNAME_PUNT/items")) return Response.json({ type: "FeatureCollection", features: [AANSLUITING, { ...LIFT, properties: { ...LIFT.properties, Description: "2018 ANTWERPEN, PROEFSTRAAT 12" } }], links: [] });
    if (url.pathname.endsWith("/collections/HINDER_PUNT/items")) return Response.json({ type: "FeatureCollection", features: [hinder(990802, "Verhuis")], links: [] });
    if (/\/P_ASign\/ASign\/MapServer\/\d+\/query$/.test(url.pathname)) return Response.json(url.searchParams.get("returnIdsOnly") === "true" ? { objectIds: [] } : { features: [] });
    return new Response("", { status: 404 });
  };
  fs.mkdirSync(path.join(root, "site", "geo"), { recursive: true });
  fs.writeFileSync(path.join(root, "site", "geo", "straten.json"), JSON.stringify({ schemaVersion: 1, streets: [["9101", "Proefstraat", "2018", ["2018-01"], [4.399, 51.219, 4.401, 51.221]]] }));
  const history = await refreshLiveHistory({ rootDir: root, fetch: nepFetch, clock: () => new Date("2099-03-10T03:00:00Z"), log: () => {} });
  const werk = Object.fromEntries(history.layers.works.items.map((w) => [w.gipodId, w]));
  assert.equal(werk[990801].title, "2018 ANTWERPEN, PROEFSTRAAT 1DN02");
  assert.equal(werk[990802].title, "2018 ANTWERPEN, PROEFSTRAAT 12");
  nergensVerhuis(history, "live-layers.json");
  const uitleg = JSON.parse(fs.readFileSync(path.join(root, "site", "sources", "kaart-uitleg.json"), "utf8"));
  assert.equal(uitleg.werken["990801"].huisnummers, "nr. 1DN02");
  assert.equal(uitleg.werken["990802"].huisnummers, "nr. 12");
  assert.equal(uitleg.werken["990802"].soort, INNAME_LIFT);
  assert.deepEqual(validateKaartUitleg(uitleg), []);
  nergensVerhuis(uitleg.werken, "kaart-uitleg.json");
  // De straatbestanden uit de tussenstand van de verversing (geen netwerk meer).
  schrijfStraatSnapshots({ rootDir: root, agendaItems: [], clock: () => new Date("2099-03-10T05:00:00Z") });
  const straat = JSON.parse(fs.readFileSync(path.join(root, "site", "straat", "9101.json"), "utf8"));
  assert.deepEqual(straat.werken.map((w) => w.title).sort(), ["2018 ANTWERPEN, PROEFSTRAAT 12", "2018 ANTWERPEN, PROEFSTRAAT 1DN02"]);
  nergensVerhuis(straat, "straatbestand");
  assert.deepEqual(straatItemPrivacy(straat), []);
});

// ---------- het nummer na een scheiding, en het adres van de beheerder op een andere straat dan het punt ----------

test("kaart: het huisnummer na een scheiding ('PROEFSTRAAT | 12', '- PROEFSTRAAT - 12 -', 'thv 12') staat bij 'Waar' en in de titel", () => {
  // GIPOD schrijft een adres vaak met een scheiding tussen de straat en het nummer (verzonnen straten en nummers).
  const met = [
    ["2000 | Antwerpen | PROEFSTRAAT | 12", "nr. 12"], ["- PROEFSTRAAT - 12 -", "nr. 12"], ["Proefstraat, 12", "nr. 12"], ["Proefstraat: 12", "nr. 12"], // verzonnen
    ["Proefstraat thv 12", "nr. 12"], ["Proefstraat t.h.v. 12", "nr. 12"], ["Proefstraat ter hoogte van 12", "nr. 12"], ["Proefstraat nr. 12", "nr. 12"], // verzonnen
    ["Proefstraat (12)", "nr. 12"], ["Proefstraat - 12 bus 3", "nr. 12"], ["2000 | Antwerpen | PROEFSTRAAT | 12-14", "nr. 12–14"], ["PROEFSTRAAT | 1DN02", "nr. 1DN02"], // verzonnen
    ["2000 | ANTWERPEN | DESIRE PROEFSTRAAT | 12", "nr. 12", "Désiré Proefstraat"], // verzonnen
  ];
  for (const [t, nr, straat = "Proefstraat"] of met) assert.equal(KU.huisnummersUitTekst(t, straat), nr, t);
  // Geen huisnummer: een duur, een maat, een postcode, een aantal, een volgnummer, een uur, 0.
  for (const t of ["Proefstraat, 3 dagen", "Proefstraat - 30 m", "Proefstraat | 30m", "Proefstraat, 2000 Antwerpen", "Proefstraat: 2 rijstroken", "Proefstraat - deel 3", "Proefstraat - 8u tot 17u", "Proefstraat | 0"]) { // verzonnen
    assert.equal(KU.huisnummersUitTekst(t, "Proefstraat"), "", t);
  }
  const werk = { gipodId: 990809, title: "2000 | Antwerpen | PROEFSTRAAT | 12", status: "In uitvoering", start: "2099-03-01T06:00:00Z", end: "2099-03-30T16:00:00Z", owner: "Proefnet", ownerGroup: "Andere", streets: [{ name: "Proefstraat" }], occupancyTypes: ["Hoogtewerker"], workTypes: [], hindrance: null }; // verzonnen
  const k = kaart(werk);
  assert.equal(regels(k).Waar, "Proefstraat, nr. 12 (omschrijving van de beheerder)");
  assert.match(k.titel, /in de Proefstraat nr\. 12\b/);
  assert.doesNotMatch(k.ontbreekt.join(" · "), /huisnummers niet gepubliceerd/);
  assert.equal(KU.werkKaartje({ ...werk, title: "- PROEFSTRAAT - 12 -" }, { vandaag: VANDAAG }).plek, "Proefstraat nr. 12"); // verzonnen
  // Ook de bewaarde feiten (kaart-uitleg.json): het nummer van de beheerder komt terug uit zijn tekst.
  assert.equal(schoonWerk({ soort: "Nutswerken met een hoogtewerker", soortBron: "soort inname in GIPOD", omschrijving: "2000 | Antwerpen | PROEFSTRAAT | 12", straten: ["Proefstraat"], huisnummers: "", huisnummerBron: "", fasen: [], gevolgen: [] }).huisnummers, "nr. 12"); // verzonnen
});

// Twee verzonnen straten op een hoek: de Testlaan loopt noord-zuid, de Proefstraat begint aan de hoek en loopt naar het oosten.
const straatas = (id, naam, postcode, coords) => ({ type: "Feature", properties: { LSTRNMID: id, LSTRNM: naam, RSTRNMID: id, RSTRNM: naam, postcode, DISTRICT: "ANTWERPEN" }, geometry: { type: "LineString", coordinates: coords } });
const HOEKSTRATEN = [straatas("9101", "Proefstraat", "2018", [[4.4, 51.22], [4.402, 51.22]]), straatas("9103", "Testlaan", "2018", [[4.4, 51.219], [4.4, 51.223]])];
// Het punt van GIPOD: 20 m van de Testlaan, 40 m van de Proefstraat. Op de hoek: even ver van allebei. Ver: 166 m van de Proefstraat.
const BIJ_TESTLAAN = [4.40029, 51.22036], OP_DE_HOEK = [4.40014, 51.22009], VER = [4.40029, 51.2215];
const aansluiting = (id, point, Description = "2018 ANTWERPEN, PROEFSTRAAT 1DN02") => collectWorks([{ ...gipod(id, { Description, Owner: "Fluvius System Operator", PublicDomainOccupancyTypes: "Elektriciteit", GroundworkSpecification: "klantaansluiting" }), geometry: { type: "Point", coordinates: point } }], new Set([id]), null, { isStraat })[0]; // verzonnen
const RESOLVERS = [["site", SC.applyWorkStreetResolution, SC.buildStreetIndex(HOEKSTRATEN)], ["historiek", LSR.applyWorkStreetResolution, LSR.buildStreetIndex(HOEKSTRATEN)]];

test("straat: het adres van de beheerder ('PROEFSTRAAT 1DN02') is de plaats, ook als het punt van GIPOD dichter bij een zijstraat ligt", () => {
  for (const [wie, apply, index] of RESOLVERS) {
    const [bij, hoek] = apply([aansluiting(990810, BIJ_TESTLAAN), aansluiting(990811, OP_DE_HOEK)], index);
    assert.deepEqual(bij.streets.map((s) => s.name), ["Proefstraat"], wie);
    assert.equal(bij.streetResolution, "official_address_match", wie);
    assert.equal(bij.streetDistanceMeters, 40, wie);
    assert.deepEqual(hoek.streets.map((s) => s.name), ["Proefstraat"], `${wie}: op de hoek`);
    assert.equal(hoek.streetResolution, "official_address_match", `${wie}: op de hoek`);
    // De kaart: het exacte adres in de titel en bij "Waar", niet de zijstraat en niet "huisnummers niet gepubliceerd".
    const k = kaart(bij);
    assert.match(k.titel, /^Nieuwe aansluiting op het elektriciteitsnet in de Proefstraat nr\. 1DN02 /, wie);
    assert.equal(regels(k).Waar, "Proefstraat, nr. 1DN02 (straat en huisnummer uit de omschrijving van de beheerder; het punt in GIPOD ligt er ongeveer 40 m van)", wie);
    assert.doesNotMatch(getoond(k), /Testlaan|huisnummers niet gepubliceerd/, wie);
    assert.doesNotMatch(regels(k).Wat, /1DN02/, `${wie}: "Wat" zegt wat, niet waar`);
  }
});

test("straat: het adres van de beheerder wint niet als hij de straat van het punt zelf noemt, als het verder dan 150 m ligt of als er geen huisnummer bij staat", () => {
  for (const [wie, apply, index] of RESOLVERS) {
    const [eigen, ver, zonderNummer] = apply([
      aansluiting(990812, BIJ_TESTLAAN, "2018 ANTWERPEN, TESTLAAN - PROEFSTRAAT 12"), // verzonnen
      aansluiting(990813, VER),
      aansluiting(990814, BIJ_TESTLAAN, "2018 ANTWERPEN, PROEFSTRAAT - kabelwerken"),
    ], index);
    for (const [w, wat] of [[eigen, "de straat van het punt staat in de tekst"], [ver, "166 m ver"], [zonderNummer, "geen huisnummer"]]) {
      assert.deepEqual(w.streets.map((s) => s.name), ["Testlaan"], `${wie}: ${wat}`);
      assert.equal(w.streetResolution, "nearest_official_axis", `${wie}: ${wat}`);
    }
    // Het nummer hoort bij de Proefstraat: bij de Testlaan staat het niet als huisnummer; wel als het adres dat de beheerder
    // noemt (een aansluiting is een werk voor één huis, zijn tekst staat er niet: alleen straat en nummer).
    assert.equal(regels(kaart(eigen)).Waar, "Testlaan; de beheerder noemt PROEFSTRAAT 12", wie);
    // Ver van het punt: het adres staat niet als werk bij "Wat" en de tekst van de beheerder staat er niet
    // (tests/werken-een-huis.test.mjs), maar het adres zelf wel, bij "Waar" (nakijkronde van head c4bb2927: het stond
    // daarna nergens meer op de kaart).
    const k = kaart(ver);
    assert.doesNotMatch(regels(k).Wat, /Volgens de beheerder/, wie);
    assert.equal(k.bronTekst, "", wie);
    assert.equal(regels(k).Waar, "Testlaan; de beheerder noemt PROEFSTRAAT 1DN02", wie);
  }
});

test("verversing: het adres van de beheerder op een andere straat komt in de historiek, kaart-uitleg.json en op de plekpagina", async () => {
  const [resolved] = LSR.applyWorkStreetResolution([aansluiting(990815, BIJ_TESTLAAN)], LSR.buildStreetIndex(HOEKSTRATEN));
  const live = compactWorkItem(resolved);
  assert.deepEqual(live.streets.map((s) => s.name), ["Proefstraat"]);
  const { document } = await bouwKaartUitleg({ works: [resolved], fetch: null, clock: () => new Date("2099-03-10T03:00:00Z") });
  const bewaard = document.werken["990815"];
  assert.deepEqual(bewaard.straten, ["Proefstraat"]);
  assert.equal(bewaard.huisnummers, "nr. 1DN02");
  assert.equal(bewaard.straatBron, "omschrijving van de beheerder");
  const e = workEntry(live, { vandaag: VANDAAG, uitleg: document });
  assert.match(e.title, /^Nieuwe aansluiting op het elektriciteitsnet in de Proefstraat nr\. 1DN02 /);
  assert.equal(e.location, "Proefstraat nr. 1DN02");
  assert.doesNotMatch(e.uitleg.ontbreekt.join(" · "), /huisnummers niet gepubliceerd/);
});

test("historiek: een werk dat nu de straat van het adres van de beheerder krijgt, is geen wijziging; een ander adres wel", () => {
  const T1 = "2099-03-09T03:00:00.000Z", T2 = "2099-03-10T03:00:00.000Z", T3 = "2099-03-11T03:00:00.000Z";
  const leeg = { ok: true, items: [] };
  const index = LSR.buildStreetIndex(HOEKSTRATEN);
  const nu = LSR.applyWorkStreetResolution([aansluiting(990816, BIJ_TESTLAAN), aansluiting(990817, OP_DE_HOEK)], index);
  // De historiek van vóór deze regel: de straat van het punt (de zijstraat), of geen straat bij twijfel op de hoek.
  const vroeger = nu.map((w) => (w.gipodId === 990816
    ? { ...w, streets: [{ id: "9103", name: "Testlaan", postcode: "2018" }], streetResolution: "nearest_official_axis", streetDistanceMeters: 20 }
    : { ...w, streets: [], streetResolution: "ambiguous", streetDistanceMeters: 10 }));
  // Zoals die historiek ze schreef (zonder de regel voor één huis van nu, die alleen een straat kent die we kennen: de
  // verzonnen Proefstraat staat niet in de stratenlijst van de repo).
  const eerst = updateLiveHistory(null, { observedAt: T1, worksResult: { ok: true, items: vroeger }, publicSpaceResult: leeg });
  const daarna = updateLiveHistory(eerst, { observedAt: T2, worksResult: resultaatVoorHistoriek({ ok: true, items: nu }), publicSpaceResult: leeg });
  assert.deepEqual(daarna.changes.filter((c) => c.layer === "works"), [], "geen 'changed' omdat de straat nu die van het adres is");
  assert.deepEqual(daarna.layers.works.items.map((w) => w.streets.map((s) => s.name)), [["Proefstraat"], ["Proefstraat"]]);
  // Een ander adres in GIPOD blijft een wijziging.
  const ander = LSR.applyWorkStreetResolution([aansluiting(990816, BIJ_TESTLAAN, "2018 ANTWERPEN, PROEFSTRAAT 3"), aansluiting(990817, OP_DE_HOEK)], index); // verzonnen
  const later = updateLiveHistory(daarna, { observedAt: T3, worksResult: resultaatVoorHistoriek({ ok: true, items: ander }), publicSpaceResult: leeg });
  assert.deepEqual(later.changes.filter((c) => c.layer === "works").map((c) => [c.id, c.type, c.fields]), [["work:990816", "changed", ["title"]]]);
});
