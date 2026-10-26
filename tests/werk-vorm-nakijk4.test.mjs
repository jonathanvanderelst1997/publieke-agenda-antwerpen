// Nakijkronde van head d7e4238a (werken: adreskaart of gewone kaart, site/werk-vorm.js). Een adreskaart zonder nummer zegt
// alleen "huisnummers niet gepubliceerd" als de titel en de fasen in GIPOD geen enkel getal hebben; anders "geen zeker
// huisnummer in GIPOD" of "huisnummer weggelaten" (huisnummerWeg). Elke toets hieronder behalve de laatste faalt op d7e4238a.
// Alle straten, namen en nummers zijn verzonnen (Proefstraat, Proefmans); geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";

import * as V from "../site/werk-vorm.js";
import * as KU from "../site/kaart-uitleg.js";
import { ownerGroup } from "../site/works-core.js";
import { onbekendZin } from "../site/onbekend-zinnen.js";

const VANDAAG = "2099-03-10";
const PROEF = { id: "9101", name: "Proefstraat", postcode: "2000" };
const fase = (description) => ({ description, start: "2099-03-12T06:00:00Z", end: "2099-03-12T16:00:00Z", consequences: ["Parkeerverbod"] });
const hinder = (fasen) => ({ severe: false, consequences: ["Parkeerverbod"], start: "2099-03-11T06:00:00Z", end: "2099-03-20T16:00:00Z", phases: fasen });
// Een container (soort van main: een adreskaart) zoals collectWorks en de straatkoppeling hem geven (verzonnen).
const werk = (extra = {}) => ({
  gipodId: 990001, title: "Container", owner: "Proefmans", ownerGroup: ownerGroup("Proefmans"), status: "In uitvoering",
  start: "2099-03-01T06:00:00Z", end: "2099-03-30T16:00:00Z", workTypes: [], occupancyTypes: ["Container"], lastModified: "2099-02-01T00:00:00Z",
  point: [4.40005, 51.22005], recordCount: 1, boundaryConfidence: "point_inside_new", hindrance: null, hindranceSourceLoaded: true,
  streets: [PROEF], streetResolution: "nearest_official_axis", streetDistanceMeters: 3, ...extra,
});
const A = { schema: 1, adreskaart: [990001], gewoon: [] };
const poort = (item, vorm = null, opties = { magBeslissen: true }) => V.werkenVoorDeSite([item], vorm, opties)[0];
const kaart = (w) => KU.werkKaartje(w, { vandaag: VANDAAG });
const waar = (k) => Object.fromEntries(k.regels).Waar;
const NIET_GEPUBLICEERD = onbekendZin("werk-huisnummers");

test("HOOG a: een nummer dat MAAT meenam ('Proefstraat 12 - 3 dagen') geeft twijfel, niet 'niet gepubliceerd'", () => {
  for (const [title, fasen] of [
    ["Proefstraat 12 - 3 dagen", []],
    ["Proefstraat 12 – 14 dagen", []],
    ["Container", [fase("Proefstraat 2 - 3 uren")]],
    ["Proefstraat 12 7:30 tot 16:00", []],
  ]) {
    const a = poort(werk({ title, hindrance: fasen.length ? hinder(fasen) : null }));
    assert.equal(a.adresKaart, true, title);
    assert.equal(a.huisnummers, "", title);
    assert.equal(a.huisnummerWeg, "twijfel", title);
    const k = kaart(a);
    assert.equal(waar(k), `Proefstraat (${KU.NUMMER_WEG.twijfel})`, title);
    assert.equal(k.ontbreekt.includes(NIET_GEPUBLICEERD), false, title);
  }
});

test("HOOG b: al een adreskaart, later het spoor van een verhuizing in de titel: nooit 'niet gepubliceerd'", () => {
  for (const title of ["Proefstraat 12 verhuis", "Verhuis Proefstraat 12", "Proefstraat 12 (verhuislift)"]) {
    const a = poort(werk({ title }), A, {});
    assert.equal(a.adresKaart, true, title);
    assert.equal(a.huisnummers, "", title);
    assert.ok(["twijfel", "weggelaten"].includes(a.huisnummerWeg), `${title}: ${a.huisnummerWeg}`);
    const k = kaart(a);
    assert.equal(k.ontbreekt.includes(NIET_GEPUBLICEERD), false, title);
    // De vaste code zegt alleen dat er een nummer was; nooit het nummer of het spoor zelf.
    assert.doesNotMatch(JSON.stringify([a, k]), /\b12\b|verhui/i, title);
  }
  // Las de lezer het nummer in de titel van GIPOD vóór regel 9, dan "weggelaten".
  const a = poort(werk({ title: "Proefstraat 12", hindrance: hinder([fase("verhuis")]) }), A, {});
  assert.equal(a.huisnummers, "");
  assert.equal(a.huisnummerWeg, "weggelaten");
  assert.equal(waar(kaart(a)), `Proefstraat (${KU.NUMMER_WEG.weggelaten})`);
});

test("Ongewijzigd: zonder enig getal in de titel en de fasen zegt een adreskaart 'huisnummers niet gepubliceerd'", () => {
  for (const a of [poort(werk()), poort(werk({ title: "Container · Fase 2", hindrance: hinder([fase("Fase 1")]) })), poort(werk({ title: "Verhuis" }), A, {})]) {
    assert.equal(a.adresKaart, true);
    assert.equal(a.huisnummers, "");
    assert.equal(a.huisnummerWeg, undefined);
    assert.equal(kaart(a).ontbreekt.includes(NIET_GEPUBLICEERD), true);
  }
});
