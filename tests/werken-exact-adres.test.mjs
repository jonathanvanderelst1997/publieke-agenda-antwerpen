// Besluit van de eigenaar (18 oktober 2026) voor de werken van GIPOD: de PLAATS mag exact (de straat met het huisnummer of
// het bereik, zoals de bron ze geeft, ook als het nummer aan een code plakt: "PROEFSTRAAT 1DN02"), maar niets dat over een
// persoon of zijn huishouden vertelt. Het woord "verhuis" komt bij een werk nergens publiek: een werk met de soort inname
// "(Verhuis)lift/levering" heet "Inname voor een lift of levering", een tekst met "verhuis" wordt "Inname van de openbare
// weg". Namen en contactgegevens blijven weg. De regel staat in site/works-core.js (de ingang), site/kaart-uitleg.js (de
// kaart), lib/kaart-uitleg-refresh.mjs, lib/historiek-privacy.mjs en lib/straat-bestanden.mjs (wat bewaard wordt, met de
// scans van validate-data). Een parkeerverbod verandert hier niet (tak claude/parkeerverbod-zonder-reden).
// Alle straten, nummers, namen en codes zijn verzonnen; geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as KU from "../site/kaart-uitleg.js";
import { INNAME_LIFT, INNAME_WEG, collectWorks, innameZonderVerhuis, werkZonderVerhuis, zonderVerhuis } from "../site/works-core.js";
import { attachHindrance } from "../site/works-hindrance.js";
import { publicSpaceEntries, samenWerven, werkEntries, workEntry } from "../site/place-core.js";
import { updateLiveHistory } from "../lib/live-history.mjs";
import { historiekPrivacyBevindingen, historiekVoorPubliek, itemVoorHistoriek, resultaatVoorHistoriek } from "../lib/historiek-privacy.mjs";
import { straatItemPrivacy } from "../lib/straat-bestanden.mjs";
import { STRAAT_SCHEMA, itemVoorStraat, schrijfStraatSnapshots, straatBestandenProblemen } from "../scripts/build-straat-snapshots.mjs";
import { bouwKaartUitleg, kaartUitlegVoorPubliek, schoonWerk } from "../lib/kaart-uitleg-refresh.mjs";
import { validateKaartUitleg, werkFouten } from "../lib/kaart-uitleg-validatie.mjs";
import { refreshLiveHistory } from "../scripts/refresh-live-history.mjs";

const VANDAAG = "2099-03-10";
const VERHUIS = /verhui[sz]/i;
const PUNT = [4.4, 51.22];
// Een GIPOD-werk zoals INNAME_PUNT het geeft (verzonnen).
const gipod = (id, properties) => ({ type: "Feature", geometry: { type: "Point", coordinates: PUNT }, properties: { GipodId: id, Status: "In uitvoering", Start: "2099-03-01T06:00:00Z", End: "2099-03-30T16:00:00Z", LastModifiedOn: "2099-02-01T00:00:00Z", ...properties } });
const hinder = (gipodId, description) => ({ type: "Feature", geometry: { type: "Point", coordinates: PUNT }, properties: { HindranceStatus: "Gevalideerd", HindranceConsequenceOf: `https://gipod.api.vlaanderen.be/api/v1/works/${gipodId}`, HindranceGipodId: gipodId + 5000, HindranceDescription: description, HindranceStart: "2099-03-12T06:00:00Z", HindranceEnd: "2099-03-12T16:00:00Z", Consequences: "Parkeerverbod" } });
const AANSLUITING = gipod(990801, { Description: "2018 ANTWERPEN, PROEFSTRAAT 1DN02", Owner: "Fluvius System Operator", PublicDomainOccupancyTypes: "Elektriciteit", GroundworkSpecification: "klantaansluiting" });
const LIFT = gipod(990802, { Description: "2000 ANTWERPEN, TESTLAAN 12", Owner: "Stad Antwerpen - Proefdienst", PublicDomainOccupancyTypes: "(Verhuis)lift/levering" });
// Een tekst met "verhuis" en een naam (verzonnen): hij komt in zijn geheel niet op de site.
const MET_NAAM = gipod(990803, { Description: "Verhuis fam. Proefmans, Testlaan 14", Owner: "Verhuizingen Proefmans BV", PublicDomainOccupancyTypes: "Container;(Verhuis)lift/levering" }); // verzonnen
const STRATEN = { 990801: [{ id: "9101", name: "Proefstraat", postcode: "2018" }], 990802: [{ id: "9102", name: "Testlaan", postcode: "2000" }], 990803: [{ id: "9102", name: "Testlaan", postcode: "2000" }] };
const werken = () => attachHindrance(collectWorks([AANSLUITING, LIFT, MET_NAAM], new Set([990801, 990802, 990803])), [hinder(990802, "Verhuis"), hinder(990803, "Verhuislift fam. Proefmans")], true)
  .map((w) => ({ ...w, streets: STRATEN[w.gipodId], streetResolution: "nearest_official_axis", streetDistanceMeters: 2 }));
const per = (lijst) => Object.fromEntries(lijst.map((w) => [w.gipodId, w]));
const teksten = (waarde, uit = []) => {
  if (typeof waarde === "string") uit.push(waarde);
  else if (Array.isArray(waarde)) for (const v of waarde) teksten(v, uit);
  else if (waarde && typeof waarde === "object") for (const v of Object.values(waarde)) teksten(v, uit);
  return uit;
};
const nergensVerhuis = (waarde, wat) => { for (const t of teksten(waarde)) assert.doesNotMatch(t, VERHUIS, `${wat}: ${JSON.stringify(t)}`); };
const kaart = (w) => KU.werkKaartje(w, { vandaag: VANDAAG });
const regels = (k) => Object.fromEntries(k.regels);
const getoond = (k) => [k.titel, k.samenvatting, k.plek, k.bronTekst, ...k.regels.flat(), ...k.ontbreekt].join(" ¶ ");

// ---------- de ingang: GIPOD ----------

test("ingang: een tekst met 'verhuis' wordt de vaste tekst, '(Verhuis)lift/levering' heet 'Lift/levering', een opdrachtgever met 'verhuis' valt weg", () => {
  const w = per(werken());
  assert.equal(w[990801].title, "2018 ANTWERPEN, PROEFSTRAAT 1DN02", "een titel zonder 'verhuis' blijft zoals GIPOD hem geeft");
  assert.deepEqual(w[990802].occupancyTypes, ["Lift/levering"]);
  assert.equal(w[990803].title, INNAME_WEG, "de hele tekst, ook de naam en het andere adres");
  assert.equal(w[990803].owner, "");
  assert.deepEqual(w[990803].occupancyTypes, ["Container;Lift/levering"]);
  assert.deepEqual(w[990802].hindrance.phases.map((f) => f.description), [INNAME_WEG]);
  assert.deepEqual(w[990803].hindrance.phases.map((f) => f.description), [INNAME_WEG]);
  nergensVerhuis(werken(), "collectWorks");
  assert.doesNotMatch(JSON.stringify(werken()), /Proefmans/);
  // De regels zelf: elke vorm van het woord, en niets anders verandert.
  for (const t of ["Verhuis", "verhuislift", "VERHUISWAGEN", "Verhuizing fam. Proefmans", "verhuizen"]) assert.equal(zonderVerhuis(t), INNAME_WEG, t);
  assert.equal(zonderVerhuis("Levering van een container"), "Levering van een container");
  assert.equal(innameZonderVerhuis("(Verhuis)lift/levering"), "Lift/levering");
  assert.equal(innameZonderVerhuis("Kunstwerk;(verhuis)Lift/levering;Container"), "Kunstwerk;Lift/levering;Container");
  assert.equal(innameZonderVerhuis("Verhuiswagen"), "Andere");
  assert.deepEqual(werkZonderVerhuis({ soort: "Verhuis", innameSoort: "Verhuislift of levering", inname: ["verhuislift of levering", "container"], opdrachtgever: "Verhuizingen Proef", fasen: [{ naam: "verhuis", start: "2099-03-12" }] }),
    { soort: INNAME_WEG, innameSoort: INNAME_LIFT, inname: ["lift of levering", "container"], opdrachtgever: "", fasen: [{ naam: INNAME_WEG, start: "2099-03-12" }] });
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
  assert.match(regels(k).Fasen, /^Inname van de openbare weg \(12 maart\): parkeerverbod$/);
  nergensVerhuis(k, "kaartje");
  // Wat GIPOD als leesbare soort geeft, ook naast een andere soort.
  assert.deepEqual(KU.innameLeesbaar(["Container;(Verhuis)lift/levering"]), ["container", "lift of levering"]);
  const twee = kaart(per(werken())[990803]);
  // Het adres stond alleen in de tekst met "verhuis" en die komt niet over: alleen de straat van het punt.
  assert.match(twee.titel, new RegExp(`^${INNAME_LIFT} in de Testlaan: `));
  assert.match(regels(twee).Wat, /Volgens GIPOD: container · lift of levering\./);
  // De vaste tekst is niet de tekst van de beheerder: geen "De beheerder schrijft", geen naam, geen opdrachtgever.
  assert.equal(twee.bronTekst, "");
  assert.doesNotMatch(getoond(twee), /De beheerder schrijft|Proefmans|Testlaan 14/); // verzonnen
  nergensVerhuis(twee, "kaartje met een naam");
  // Zonder soort inname zegt de tekst alleen "Inname van de openbare weg".
  assert.equal(KU.soortVanWerk({ omschrijving: INNAME_WEG }).soort, INNAME_WEG);
  assert.equal(KU.soortVanWerk({ fasen: ["Verhuis"] }).soort, INNAME_WEG);
  assert.equal(KU.soortVanWerk({ fasen: [INNAME_WEG], occupancyTypes: ["Lift/levering"] }).soort, INNAME_LIFT);
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
  assert.deepEqual(schoon.fasen.map((f) => f.naam), [INNAME_WEG]);
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
  assert.match(regels(kaartje.uitleg).Fasen, new RegExp(`^${INNAME_WEG} \\(12 maart\\)$`));
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
  const isStraat = (n) => n === "Proefstraat";
  assert.equal(KU.veiligeTekst("Verhuis fam. Proefmans Proefstraat 12", { isStraat }), "Proefstraat"); // verzonnen
  assert.equal(KU.veiligeTekst("Verhuislift voor Proefmans", { isStraat }), "");
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
  assert.deepEqual(vondsten.map((v) => v.code), ["verhuis", "verhuis"]);
  assert.ok(vondsten.every((v) => !/verhuis|Testlaan/i.test(v.path)));
  const schoon = historiekVoorPubliek(oud);
  assert.deepEqual(historiekPrivacyBevindingen(schoon), []);
  assert.deepEqual(schoon.layers.works.items[0].occupancyTypes, ["Lift/levering"]);
  assert.equal(schoon.layers.works.items[0].title, INNAME_WEG);
  // Een wijziging van een werk (zonder id in de velden) volgt dezelfde regel.
  const wijziging = historiekVoorPubliek({ ...h, changes: [{ observedAt: T, layer: "works", id: "work:990802", type: "changed", fields: ["occupancyTypes", "title"], before: { occupancyTypes: [], title: "Testlaan 10" }, after: { occupancyTypes: ["(Verhuis)lift/levering"], title: "Testlaan 12" } }] }); // verzonnen
  assert.deepEqual(wijziging.changes[0].after, { occupancyTypes: ["Lift/levering"], title: "Testlaan 12" }); // verzonnen
  assert.deepEqual(wijziging.changes[0].before, { occupancyTypes: [], title: "Testlaan 10" }); // verzonnen
  // Buiten een werk blijft de oude regel: een huisnummer valt weg, en "verhuis" is daar geen vondst van deze regel.
  assert.deepEqual(itemVoorHistoriek({ title: "2000 Antwerpen, Proefstraat 12" }).title, "2000 Antwerpen, Proefstraat"); // verzonnen
  assert.deepEqual(historiekPrivacyBevindingen({ title: "2000 Antwerpen, Proefstraat 12" }).map((v) => v.code), ["huisnummer"]); // verzonnen
});

test("straatbestanden: een werk houdt zijn huisnummer (ook na 'gevel nummer'), zonder 'verhuis'; de scan van validate-data volgt", () => {
  const w = per(werken());
  const item = itemVoorStraat({ ...w[990801], hindrance: { severe: false, consequences: [], phases: [{ description: "stelling aan gevel nummer 3", start: "2099-03-12T06:00:00Z", end: "2099-03-12T16:00:00Z", consequences: [] }] } }, { laag: "werken" });
  assert.equal(item.title, "2018 ANTWERPEN, PROEFSTRAAT 1DN02");
  assert.equal(item.hindrance.phases[0].description, "stelling aan gevel nummer 3");
  assert.deepEqual(straatItemPrivacy({ werken: [item] }), []);
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
  assert.deepEqual(herschreven.werken[0].hindrance.phases.map((f) => f.description), [INNAME_WEG]);
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
