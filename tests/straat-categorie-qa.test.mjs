// Vaste bron-/zoekproeven, geen browser of externe bronnen. Eén representatieve
// straat per postcode plus grensgevallen. Dit is geen live-e2e-test.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPlaceIndex, searchPlaces, otherDistrictFor } from "../site/place-core.js";
import { createAgendaView, DEFAULT_THEMES, VIEW_THEMES } from "../site/agenda-view.js";
import { wijkFeatures, bboxOf } from "../site/neighborhood-core.js";
import "../site/event-types.js";
import "../site/agenda-uitgaan.js";

const streets = JSON.parse(readFileSync(new URL("../site/geo/straten.json", import.meta.url), "utf8")).streets;
const wijken = wijkFeatures(JSON.parse(readFileSync(new URL("../site/geo/wijken.geo.json", import.meta.url), "utf8")))
  .filter(f => f.properties.code.startsWith("ANT"))
  .map(f => ({ code: f.properties.code, naam: f.properties.naam, box: bboxOf(f.geometry) }));
const index = buildPlaceIndex({ streets, wijken });

const examples = [
  ["Kammenstraat", "2000"], ["Nationalestraat", "2000"], ["Meir", "2000"],
  ["Jan Vanhoenackerstraat", "2000"], ["Rijnkaai", "2000"],
  ["De Keyserlei", "2018"], ["Brederodestraat", "2018"],
  ["Boomsesteenweg", "2020"],
  ["Columbiastraat", "2030"], ["Dublinstraat", "2030"],
  ["Gaston Burssenslaan", "2050"],
  ["Sint-Jansplein", "2060"], ["Vondelstraat", "2060"], ["Van Maerlantstraat", "2060"],
];
test("plaatszoeken: straten uit elk van de zes postcodes met een officiële exact-match", () => {
  assert.deepEqual([...new Set(examples.map(([, code]) => code))].sort(),
    ["2000", "2018", "2020", "2030", "2050", "2060"]);
  for (const [name, postcode] of examples) {
    const real = streets.find(s => s[1] === name && s[2] === postcode);
    assert.ok(real, name + " " + postcode + " ontbreekt in officieel straatbestand");
    const results = searchPlaces(index, name + " " + postcode, { limit: 20 });
    assert.ok(results.some(hit => hit.place.name === name && String(hit.place.postcode) === postcode),
      name + " " + postcode + " is niet te vinden in de suggesties");
  }
});
test("de Keyserlei heeft twee zones; filters mogen niet stil overlopen", () => {
  const lijst = streets.filter(s => s[1] === "De Keyserlei");
  assert.deepEqual([...new Set(lijst.map(s => s[2]))].sort(), ["2000", "2018"]);
  const gekozen = searchPlaces(index, "De Keyserlei 2018", { limit: 10 }).find(hit =>
    hit.place.name === "De Keyserlei" && String(hit.place.postcode) === "2018").place;
  const view = createAgendaView();
  view.setStreet(gekozen.name, { id: gekozen.id, name: gekozen.name, postcode: gekozen.postcode });
  assert.equal(view.matchesStreet({ streets: [{ id: gekozen.id, name: gekozen.name, postcode: "2018" }] }), true);
  assert.equal(view.matchesStreet({ streets: [{ id: gekozen.id, name: gekozen.name, postcode: "2000" }] }), false);
});
test("buiten district en onzinzoekterm worden geen verzonnen exacte straat", () => {
  assert.equal(streets.some(s => s[1] === "Turnhoutsebaan"), false);
  assert.equal(otherDistrictFor("berchem"), "Berchem");
  assert.equal(searchPlaces(index, "qzzzzqzzz", { limit: 8 }).length, 0);
});
test("categorieën volgen juiste standaardkeuze en zijn afzonderlijk aan/uit zetbaar", () => {
  const all = VIEW_THEMES.map(([key]) => key);
  const view = createAgendaView({ defaultThemes: DEFAULT_THEMES });
  assert.equal(all.length, new Set(all).size);
  for (const c of ["festival", "neighborhood", "culture", "family", "parade", "sport", "flea", "shopping"])
    assert.equal(view.enabled(c), true, c + " moet in uitgaansstand zichtbaar zijn");
  for (const c of ["meetings", "info", "admin", "calls", "works", "markets", "other", "publicSpace", "permits"])
    assert.equal(view.enabled(c), false, c + " blijft in uitgaansstand optioneel");
  view.setThemes(all);
  assert.ok(all.every(key => view.enabled(key)), "na Alles moet elk onderwerp actief zijn");
  view.setThemes(["works", "publicSpace"]);
  assert.ok(view.enabled("works") && view.enabled("publicSpace"));
  assert.equal(view.enabled("festival"), false);
});
test("categorieën worden begrijpelijk onderscheiden, ook de beleidsmatige verborgen soorten", () => {
  const categoriseer = globalThis.PublicAgendaUitgaan.categoryOf;
  const voorbeelden = [
    ["Buurtfeest Gaston Burssenslaan", "neighborhood"],
    ["Districtsraad Antwerpen", "meetings"],
    ["Rommelmarkt op het plein", "flea"],
    ["Koopzondag stad Antwerpen", "shopping"],
    ["Loopwedstrijd door Antwerpen", "sport"],
    ["Concert op het plein", "culture"],
    ["Bevraging proefperiode schoolstraat", "admin"],
  ];
  for (const [title, expected] of voorbeelden) {
    const category = categoriseer({ title, location: "Antwerpen", timeSlot: "14:00" });
    assert.equal(category, expected, title);
  }
});
