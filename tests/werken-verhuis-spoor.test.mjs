// Een verhuis is privé (besluit van de eigenaar van 18 oktober 2026, site/works-core.js): het woord komt bij een werk nergens
// publiek. Nakijkronde van head 1ed84e65: een tekst met het woord werd een vaste vervangtekst, die alleen stond waar het woord
// had gestaan; wie de publieke code las, kon dat terugrekenen. Nu telt zo'n tekst als een tekst die de beheerder niet gaf:
// het werk is precies een werk zonder omschrijving en zonder die fase, ook in wat al bewaard was.
// Alle straten, nummers, namen en codes zijn verzonnen; geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as KU from "../site/kaart-uitleg.js";
import { GEEN_OMSCHRIJVING, INNAME_LIFT, VERHUIS, collectWorks, innameZonderVerhuis, werkZonderVerhuis, zonderVerhuis } from "../site/works-core.js";
import { attachHindrance } from "../site/works-hindrance.js";
import { updateLiveHistory } from "../lib/live-history.mjs";
import { historiekPrivacyBevindingen, historiekVoorPubliek, resultaatVoorHistoriek } from "../lib/historiek-privacy.mjs";
import { straatItemPrivacy } from "../lib/straat-bestanden.mjs";
import { itemVoorStraat } from "../scripts/build-straat-snapshots.mjs";
import { validateKaartUitleg, werkFouten } from "../lib/kaart-uitleg-validatie.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VANDAAG = "2099-03-10";
const PUNT = [4.4, 51.22];
// Een GIPOD-werk zoals INNAME_PUNT het geeft, en een hinderfase (verzonnen).
const gipod = (id, properties) => ({ type: "Feature", geometry: { type: "Point", coordinates: PUNT }, properties: { GipodId: id, Status: "In uitvoering", Start: "2099-03-01T06:00:00Z", End: "2099-03-30T16:00:00Z", LastModifiedOn: "2099-02-01T00:00:00Z", ...properties } });
const hinder = (gipodId, HindranceDescription, nr = 1) => ({ type: "Feature", geometry: { type: "Point", coordinates: PUNT }, properties: { HindranceStatus: "Gevalideerd", HindranceConsequenceOf: `https://gipod.api.vlaanderen.be/api/v1/works/${gipodId}`, HindranceGipodId: gipodId * 10 + nr, HindranceDescription, HindranceStart: `2099-03-1${nr}T06:00:00Z`, HindranceEnd: `2099-03-1${nr}T16:00:00Z`, Consequences: "Parkeerverbod" } });
const kaart = (w) => KU.werkKaartje(w, { vandaag: VANDAAG });
const teksten = (waarde, uit = []) => {
  if (typeof waarde === "string") uit.push(waarde);
  else if (Array.isArray(waarde)) for (const v of waarde) teksten(v, uit);
  else if (waarde && typeof waarde === "object") for (const v of Object.values(waarde)) teksten(v, uit);
  return uit;
};
// Een eigen vergelijking (niet die van site/works-core.js), ook met een verborgen teken of een accent.
const plat = (t) => String(t).normalize("NFKD").replace(/[\p{Cf}\p{M}]/gu, "");
const nergensVerhuis = (waarde, wat) => { for (const t of teksten(waarde)) assert.doesNotMatch(plat(t), /verhui[sz]/i, `${wat}: ${JSON.stringify(t)}`); };

test("een werk met 'verhuis' in de tekst is precies een werk zonder omschrijving: dezelfde titel, fasen, kaart, historiek en straatbestand", () => {
  const id = 990901;
  const eigen = { Owner: "Stad Antwerpen - Proefdienst", PublicDomainOccupancyTypes: "Andere" };
  const met = attachHindrance(collectWorks([gipod(id, { ...eigen, Description: "Verhuis fam. Proefmans, Proefstraat 12" })], new Set([id])), [hinder(id, "Verhuislift fam. Proefmans", 1), hinder(id, "Fase 2", 2)], true); // verzonnen
  const zonder = attachHindrance(collectWorks([gipod(id, eigen)], new Set([id])), [hinder(id, "", 1), hinder(id, "Fase 2", 2)], true);
  assert.deepEqual(met, zonder, "de ingang: de tekst en de fase met dat woord zijn er gewoon niet");
  assert.equal(met[0].title, GEEN_OMSCHRIJVING, "dezelfde titel als een werk waarvoor GIPOD geen omschrijving geeft");
  assert.deepEqual(met[0].hindrance.phases.map((f) => f.description), ["Fase 2"]);
  const metStraat = (lijst) => lijst.map((w) => ({ ...w, streets: [{ id: "9101", name: "Proefstraat", postcode: "2018" }], streetResolution: "nearest_official_axis", streetDistanceMeters: 2 }));
  assert.deepEqual(kaart(metStraat(met)[0]), kaart(metStraat(zonder)[0]), "de kaart");
  const T = "2099-03-10T03:00:00.000Z";
  const historiek = (lijst) => updateLiveHistory(null, { observedAt: T, worksResult: resultaatVoorHistoriek({ ok: true, items: metStraat(lijst) }), publicSpaceResult: { ok: true, items: [] } });
  assert.deepEqual(historiek(met).layers.works, historiek(zonder).layers.works, "de historiek");
  assert.deepEqual(itemVoorStraat(metStraat(met)[0], { laag: "werken" }), itemVoorStraat(metStraat(zonder)[0], { laag: "werken" }), "het straatbestand");
});

test("wat al bewaard was (een oudere verversing) wordt hetzelfde als zonder die tekst, niet een vaste vervangtekst", () => {
  const fase1 = { description: "Fase 1", start: "2099-03-12T06:00:00Z", end: "2099-03-12T16:00:00Z", consequences: [] };
  const oud = { id: "work:990902", gipodId: 990902, title: "Verhuis Proefstraat 12", owner: "Stad Antwerpen - Proefdienst", ownerGroup: "Stad Antwerpen", occupancyTypes: ["Andere"], hindrance: { severe: false, consequences: [], phases: [{ ...fase1, description: "Verhuislift" }, fase1] } }; // verzonnen
  const zonder = { ...oud, title: GEEN_OMSCHRIJVING, hindrance: { ...oud.hindrance, phases: [fase1] } };
  assert.deepEqual(werkZonderVerhuis(oud), zonder);
  assert.deepEqual(historiekVoorPubliek({ layers: { works: { items: [oud] } } }).layers.works.items[0], zonder, "de historiek en de straatbestanden");
  // De feiten van kaart-uitleg.json: geen soort uit dat woord, geen omschrijving, de fase valt weg.
  const naam = { naam: "Fase 1", start: "2099-03-12", eind: "2099-03-12", gevolgen: [] };
  const feiten = { soort: "Verhuis", soortBron: "fasen van de hinder in GIPOD", omschrijving: "Verhuis fam. Proefmans", fasen: [{ ...naam, naam: "Verhuis" }, naam], opdrachtgever: "Stad Antwerpen - Proefdienst", straten: ["Proefstraat"], huisnummers: "nr. 12", huisnummerBron: "afgeleid uit de werfzone en het adressenregister", gevolgen: [] }; // verzonnen
  assert.deepEqual(KU.feitenZonderVerhuis(feiten), { ...feiten, soort: "", soortBron: "", omschrijving: "", fasen: [naam] });
  // Met de vaste soort inname van GIPOD voor een lift of levering: die is de soort, zoals bij elk werk met die soort inname.
  assert.deepEqual(KU.feitenZonderVerhuis({ ...feiten, innameSoort: "Verhuislift of levering" }), { ...feiten, soort: INNAME_LIFT, soortBron: "soort inname in GIPOD", omschrijving: "", fasen: [naam] });
  // Een andere soort inname met dat woord is er niet.
  assert.equal("innameSoort" in KU.feitenZonderVerhuis({ ...feiten, soort: "Gevelwerken", innameSoort: "Verhuis" }), false);
  assert.deepEqual(KU.soortVanWerk({ omschrijving: "", fasen: ["Fase 1"] }), { soort: "", bron: "" });
});

test("de vaste vervangtekst van vroeger staat nergens meer in de code of de docs, en de docs leggen geen vertaling uit", () => {
  const OUD = /Inname van de openbare weg/i;
  for (const f of ["site/works-core.js", "site/kaart-uitleg.js", "site/place-core.js", "site/works-hindrance.js", "lib/historiek-privacy.mjs", "docs/PUBLIC_SPACE_SOURCE_POLICY.md"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, f), "utf8"), OUD, f);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(root, "docs", "PUBLIC_SPACE_SOURCE_POLICY.md"), "utf8"), /verhuis[^.]{0,80}\bwordt\b[^.]{0,60}\bvaste tekst/i);
});

// ---------- het woord met een verborgen teken of een accent ----------

test("'verhuis' met een zachte afbreking, een zero-width teken, een accent of in volle breedte telt ook, bij de ingang en in de scans", () => {
  const vormen = ["Ver\u00ADhuis fam. Proefmans", "Ver\u200Bhuislift", "Verh\u00FAis Proefstraat 12", "Verhu\u0301is", "VER\u2060HUIZING", "\uFF56\uFF45\uFF52\uFF48\uFF55\uFF49\uFF53"]; // verzonnen
  for (const t of vormen) {
    assert.equal(VERHUIS.test(t), true, JSON.stringify(t));
    assert.equal(zonderVerhuis(t), "", JSON.stringify(t));
  }
  assert.equal(zonderVerhuis("Levering van een container"), "Levering van een container");
  assert.equal(innameZonderVerhuis("(Ver\u00ADhuis)lift/levering"), "Lift/levering");
  assert.equal(innameZonderVerhuis("Container;(Verh\u00FAis)lift/levering"), "Container;Lift/levering");
  assert.equal(innameZonderVerhuis("Olie, gas, chemicali\u00EBn"), "Olie, gas, chemicali\u00EBn", "een soort zonder dat woord blijft letterlijk");
  // De ingang: de titel en de fase.
  const [w] = attachHindrance(collectWorks([gipod(990903, { Description: "Ver\u00ADhuis fam. Proefmans, Proefstraat 12", Owner: "Stad Antwerpen - Proefdienst" })], new Set([990903])), [hinder(990903, "Verhu\u0301islift")], true); // verzonnen
  assert.equal(w.title, GEEN_OMSCHRIJVING);
  assert.deepEqual(w.hindrance.phases, []);
  // De scans van validate-data: de historiek, de straatbestanden en kaart-uitleg.json; en de opkuis van wat bewaard was.
  const feiten = (t) => ({ soort: "", soortBron: "", omschrijving: t, opdrachtgever: "", straten: [], huisnummers: "", huisnummerBron: "", gevolgen: [], fasen: [] });
  for (const t of vormen) {
    assert.deepEqual(historiekPrivacyBevindingen({ id: "work:990903", title: t }).map((v) => v.code), ["verhuis"], JSON.stringify(t));
    assert.deepEqual(straatItemPrivacy({ werken: [{ id: "work:990903", title: t }] }).map((v) => v.code), ["verhuis"], JSON.stringify(t));
    assert.deepEqual(werkFouten("990903", feiten(t)), ["werken.990903: verhuis in een tekst"], JSON.stringify(t));
    assert.ok(validateKaartUitleg({ schemaVersion: 1, generatedAt: "2099-03-10T05:00:00.000Z", vanaf: "2099-03-10", tot: "2099-05-09", werken: { 990903: feiten(t) }, evenementen: {} }).some((f) => /verhuis in een tekst/.test(f)), JSON.stringify(t));
    nergensVerhuis(werkZonderVerhuis({ id: "work:990903", title: t, owner: t, occupancyTypes: [`(${t})lift/levering`], hindrance: { phases: [{ description: t }] } }), JSON.stringify(t));
    nergensVerhuis(historiekVoorPubliek({ layers: { works: { items: [{ id: "work:990903", title: t, hindrance: { phases: [{ description: t }] } }] } } }), JSON.stringify(t));
    nergensVerhuis(KU.feitenZonderVerhuis({ ...feiten(t), soort: t, soortBron: "omschrijving van de beheerder", fasen: [{ naam: t, start: "", eind: "", gevolgen: [] }], opdrachtgever: t }), JSON.stringify(t));
  }
});
