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
import { GEEN_OMSCHRIJVING, INNAME_LIFT, collectWorks, werkZonderVerhuis } from "../site/works-core.js";
import { attachHindrance } from "../site/works-hindrance.js";
import { updateLiveHistory } from "../lib/live-history.mjs";
import { historiekVoorPubliek, resultaatVoorHistoriek } from "../lib/historiek-privacy.mjs";
import { itemVoorStraat } from "../scripts/build-straat-snapshots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VANDAAG = "2099-03-10";
const PUNT = [4.4, 51.22];
// Een GIPOD-werk zoals INNAME_PUNT het geeft, en een hinderfase (verzonnen).
const gipod = (id, properties) => ({ type: "Feature", geometry: { type: "Point", coordinates: PUNT }, properties: { GipodId: id, Status: "In uitvoering", Start: "2099-03-01T06:00:00Z", End: "2099-03-30T16:00:00Z", LastModifiedOn: "2099-02-01T00:00:00Z", ...properties } });
const hinder = (gipodId, HindranceDescription, nr = 1) => ({ type: "Feature", geometry: { type: "Point", coordinates: PUNT }, properties: { HindranceStatus: "Gevalideerd", HindranceConsequenceOf: `https://gipod.api.vlaanderen.be/api/v1/works/${gipodId}`, HindranceGipodId: gipodId * 10 + nr, HindranceDescription, HindranceStart: `2099-03-1${nr}T06:00:00Z`, HindranceEnd: `2099-03-1${nr}T16:00:00Z`, Consequences: "Parkeerverbod" } });
const kaart = (w) => KU.werkKaartje(w, { vandaag: VANDAAG });

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
