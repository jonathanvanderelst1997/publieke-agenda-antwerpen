import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  groupByPoint,
  itemPoint,
  locationKey,
  nearSegments,
  streetSegments,
  streetWijkMap,
  streetsInWijk,
  wijkFeatures,
  wijkOf,
} from "../site/neighborhood-core.js";
import { acceptGeocode, geocodeQueries, pickGeocode, validateGeoCache } from "../lib/geocode.mjs";
import { upcomingLocations } from "../scripts/geocode-locations.mjs";
import { normalizeWijk } from "../scripts/build-wijken.mjs";
import { buildStreetIndex, resolveAddressStreets } from "../site/street-core.js";
import { createAgendaView } from "../site/agenda-view.js";
import { createAreaMatcher } from "../site/neighborhood-map.js";

const square = (code, x, y, naam = code) => ({ type: "Feature", properties: { code, naam, district: "Antwerpen" }, geometry: { type: "Polygon", coordinates: [[[x, y], [x + 0.01, y], [x + 0.01, y + 0.01], [x, y + 0.01], [x, y]]] } });
const WIJKEN = [square("ANT01", 4.40, 51.20, "Noord"), square("ANT02", 4.41, 51.20, "Oost")];
const STREETS = buildStreetIndex([
  { type: "Feature", properties: { DISTRICT: "ANTWERPEN", LSTRNMID: 1, LSTRNM: "Teststraat", RSTRNMID: 1, RSTRNM: "Teststraat", postcode: 2000 }, geometry: { type: "LineString", coordinates: [[4.401, 51.205], [4.405, 51.205]] } },
  { type: "Feature", properties: { DISTRICT: "ANTWERPEN", LSTRNMID: 2, LSTRNM: "Oostlaan", RSTRNMID: 2, RSTRNM: "Oostlaan", postcode: 2060 }, geometry: { type: "LineString", coordinates: [[4.412, 51.205], [4.415, 51.205]] } },
  { type: "Feature", properties: { DISTRICT: "ANTWERPEN", LSTRNMID: 3, LSTRNM: "Lange Teststraat", RSTRNMID: 3, RSTRNM: "Lange Teststraat", postcode: 2000 }, geometry: { type: "LineString", coordinates: [[4.402, 51.207], [4.403, 51.207]] } },
]);
const GEO = { schemaVersion: 1, entries: { [locationKey("Buurthuis, Teststraat 4, 2000 Antwerpen")]: { point: [4.403, 51.2052], precision: "adres", street: "Teststraat", postcode: "2000" } }, misses: {} };

test("locationKey negeert hoofdletters, accenten en leestekens", () => {
  assert.equal(locationKey("  Poëzie-plein,  2000  Antwerpen "), "poezie plein 2000 antwerpen");
});

test("wijk volgt het punt; buiten elke wijk is geen wijk", () => {
  assert.equal(wijkOf([4.405, 51.205], WIJKEN), "ANT01");
  assert.equal(wijkOf([4.415, 51.205], WIJKEN), "ANT02");
  assert.equal(wijkOf([4.5, 51.3], WIJKEN), "");
  assert.equal(wijkOf(null, WIJKEN), "");
});

test("een item krijgt zijn punt uit GIPOD of uit de geocodering, nooit gegokt", () => {
  assert.deepEqual(itemPoint({ point: [4.41, 51.2] }, GEO), [4.41, 51.2]);
  assert.deepEqual(itemPoint({ location: "buurthuis, teststraat 4, 2000 antwerpen" }, GEO), [4.403, 51.2052]);
  assert.equal(itemPoint({ location: "Bib Permeke" }, GEO), null);
});

test("straat → wijk via de officiële straatas, ook zonder eigen punt", () => {
  const map = streetWijkMap(STREETS, WIJKEN);
  assert.ok(streetsInWijk([{ name: "Teststraat", postcode: "2000" }], "ANT01", map));
  assert.ok(!streetsInWijk([{ name: "Teststraat", postcode: "2000" }], "ANT02", map));
  assert.ok(streetsInWijk([{ name: "Oostlaan" }], "ANT02", map), "zonder postcode telt elke variant");
  assert.ok(!streetsInWijk([], "ANT01", map));
});

test("straal rond een straat in meter", () => {
  const segments = streetSegments(STREETS, { name: "Teststraat", postcode: "2000" });
  assert.equal(segments.length, 1);
  const near = [4.403, 51.2065]; // ±167 m ten noorden
  assert.ok(nearSegments(near, segments, 250));
  assert.ok(!nearSegments(near, segments, 100));
  assert.ok(!nearSegments(near, segments, 0));
});

test("markers bundelen items op hetzelfde punt", () => {
  const groups = groupByPoint([{ item: { id: "a" }, point: [4.4, 51.2] }, { item: { id: "b" }, point: [4.4, 51.2] }, { item: { id: "c" }, point: [4.41, 51.2] }]);
  assert.deepEqual(groups.map((g) => g.items.length).sort(), [1, 2]);
});

test("adres met meerdere straten koppelt aan elke straat, niet aan een kortere naam erin", () => {
  const names = resolveAddressStreets("Teststraat en Oostlaan", STREETS).streets.map((s) => s.name);
  assert.deepEqual(names.sort(), ["Oostlaan", "Teststraat"]);
  assert.deepEqual(resolveAddressStreets("Lange Teststraat 3, 2000 Antwerpen", STREETS).streets.map((s) => s.name), ["Lange Teststraat"]);
  assert.deepEqual(resolveAddressStreets("Bib Permeke", STREETS).streets, []);
});

test("agendaweergave: wijkfilter en straal werken samen met de straatfilter", () => {
  const view = createAgendaView({ resolveAddress: (text) => resolveAddressStreets(text, STREETS).streets });
  view.setAreaMatcher(createAreaMatcher({ wijken: WIJKEN, geo: GEO, streetIndex: STREETS }));
  const inWijk = { title: "Buurtfeest", location: "Buurthuis, Teststraat 4, 2000 Antwerpen" };
  const elsewhere = { title: "Markt", point: [4.414, 51.206] };
  const vague = { title: "Tabletcafé", location: "2000, 2020, 2050 Antwerpen" };
  const parking = { title: "Parkeerverbod", streets: [{ name: "Oostlaan", postcode: "2060" }] };

  assert.ok(view.matchesStreet(inWijk) && view.matchesStreet(vague), "zonder buurtkeuze verandert er niets");
  view.setArea({ wijk: "ANT01" });
  assert.equal(view.areaLabel, "Noord");
  assert.ok(view.matchesStreet(inWijk));
  assert.ok(!view.matchesStreet(elsewhere));
  assert.ok(!view.matchesStreet(vague), "zonder punt of straat valt een item buiten de wijk");
  view.setArea({ wijk: "ANT02" });
  assert.ok(view.matchesStreet(parking), "parkeerverbod volgt zijn officiële straat");

  view.setArea({ wijk: "", radius: 0 });
  view.setStreet("Oostlaan", { id: "2", name: "Oostlaan", postcode: "2060" });
  const near = { title: "Feest om de hoek", point: [4.4135, 51.2065] };
  assert.ok(!view.matchesStreet(near), "zonder straal alleen de straat zelf");
  view.setArea({ radius: 250 });
  assert.ok(view.matchesStreet(near));
  assert.ok(!view.matchesStreet(inWijk), "te ver van de straat");
  view.setArea({ radius: 123 });
  assert.equal(view.area.radius, 0, "alleen vaste stralen");
  view.setArea({ wijk: "<script>" });
  assert.equal(view.area.wijk, "");
});

test("zonder kaartgegevens filtert de wijk (nog) niet", () => {
  const view = createAgendaView();
  view.setArea({ wijk: "ANT01" });
  assert.ok(view.matchesStreet({ title: "x", location: "ergens" }));
});

test("geocodering: zoekvragen per straatdeel, vaag blijft leeg", () => {
  assert.deepEqual(geocodeQueries("Het Stadsmagazijn, Keistraat 5/7, 2000 Antwerpen").map((q) => q.q), [
    "Keistraat 5, 2000 Antwerpen",
    "Keistraat 5, Antwerpen",
    "Het Stadsmagazijn, 2000 Antwerpen",
    "Het Stadsmagazijn, Antwerpen",
  ]);
  assert.deepEqual(geocodeQueries("District Wilrijk, locatie via de officiële bron"), []);
  assert.ok(geocodeQueries("Gaston Burssenslaan en Hanegraefstraat, 2050 Antwerpen").some((q) => q.q.startsWith("Hanegraefstraat")));
});

const result = (fields) => ({ Municipality: "Antwerpen", Zipcode: "2000", Thoroughfarename: "Keistraat", Housenumber: "5", LocationType: "basisregisters_huisnummer_aangeduidDoorBeheerder", Location: { Lon_WGS84: 4.402089, Lat_WGS84: 51.225362 }, ...fields });

test("geocodering neemt alleen een straat over die letterlijk in de locatie staat", () => {
  const ok = acceptGeocode(result(), "Het Stadsmagazijn, Keistraat 5/7, 2000 Antwerpen");
  assert.deepEqual(ok, { point: [4.40209, 51.22536], precision: "adres", street: "Keistraat", postcode: "2000" });
  assert.equal(acceptGeocode(result({ Thoroughfarename: "Kaasstraat" }), "Keistraat 5, 2000 Antwerpen"), null, "andere straat");
  assert.equal(acceptGeocode(result({ Housenumber: "50" }), "Keistraat 5, 2000 Antwerpen"), null, "ander huisnummer");
  assert.equal(acceptGeocode(result({ Zipcode: "2018" }), "Keistraat 5, 2000 Antwerpen"), null, "andere postcode");
  assert.equal(acceptGeocode(result({ Zipcode: "9000" }), "Keistraat 5"), null, "buiten de stad");
  assert.equal(acceptGeocode(result({ LocationType: "crab_gemeente" }), "Keistraat 5"), null, "geen adres of straat");
  assert.equal(acceptGeocode(result({ Housenumber: null, LocationType: "basisregisters_straat" }), "Keistraat, 2000 Antwerpen").precision, "straat");
});

test("geocodering zonder postcode: alleen als de straatnaam maar één postcode heeft", () => {
  const desguin = result({ Thoroughfarename: "Desguinlei", Zipcode: "2018", Housenumber: null, LocationType: "basisregisters_straat" });
  assert.equal(pickGeocode([desguin], "Desguinlei, 2020 Antwerpen"), null, "strikt: postcode verschilt");
  assert.equal(pickGeocode([desguin], "Desguinlei, 2020 Antwerpen", { relaxed: true }).postcode, "2018");
  const twee = [result({ Thoroughfarename: "Kerkstraat", Zipcode: "2060", Housenumber: null, LocationType: "basisregisters_straat" }), result({ Thoroughfarename: "Kerkstraat", Zipcode: "2100", Housenumber: null, LocationType: "basisregisters_straat" })];
  assert.equal(pickGeocode(twee, "Kerkstraat", { relaxed: true }), null, "dubbelzinnig");
});

test("alleen komende locaties worden opgezocht", () => {
  const locations = upcomingLocations([
    { location: "Keistraat 5", date: "2026-10-27" },
    { location: "Oud plein", date: "2026-01-01" },
    { location: "Lang plein", date: "2026-09-01", endDate: "2026-11-01" },
  ], "2026-10-05");
  assert.deepEqual([...locations.keys()].sort(), ["keistraat 5", "lang plein"]);
});

test("locaties.json: vaste vorm, punten in de stad, geen persoonsgegevens", () => {
  const doc = JSON.parse(fs.readFileSync(new URL("../site/geo/locaties.json", import.meta.url), "utf8"));
  assert.deepEqual(validateGeoCache(doc), []);
  assert.ok(doc.entries[locationKey("Jan Vanhoenackerstraat, 2000 Antwerpen")], "de schoolstraat staat op de kaart");
  assert.ok(validateGeoCache({ schemaVersion: 1, entries: { "x": { point: [3.7, 51.05], precision: "adres" } } }).length, "Gent valt buiten de stad");
  assert.ok(validateGeoCache({ schemaVersion: 1, entries: {}, misses: { "bel 03 123 45 67": "2026-10-05" } }).length, "telefoonnummer");
});

test("wijken.geo.json: officiële wijken van district Antwerpen met bron en licentie", () => {
  const doc = JSON.parse(fs.readFileSync(new URL("../site/geo/wijken.geo.json", import.meta.url), "utf8"));
  assert.match(doc.metadata.source, /stad Antwerpen/i);
  assert.match(doc.metadata.license, /open data/i);
  const wijken = wijkFeatures(doc);
  const district = wijken.filter((f) => f.properties.code.startsWith("ANT"));
  assert.equal(district.length, 24);
  assert.ok(district.every((f) => f.properties.naam && f.properties.district === "Antwerpen"));
  assert.equal(wijkOf([4.4009, 51.2210], wijken), "ANT09", "Grote Markt ligt in het historisch centrum");
  assert.ok(fs.statSync(new URL("../site/geo/wijken.geo.json", import.meta.url)).size < 150_000, "klein genoeg voor gsm");
});

test("wijknaam en district uit de officiële laag", () => {
  const f = (code, wijknaam) => normalizeWijk({ properties: { wijkcode: code, wijknaam }, geometry: { type: "Polygon", coordinates: [] } }).properties;
  assert.deepEqual(f("ANT10", "Antwerpen - Kiel"), { code: "ANT10", naam: "Kiel", district: "Antwerpen" });
  assert.deepEqual(f("BOR05", "Borsbeek - Oost\r\n"), { code: "BOR05", naam: "Oost", district: "Borsbeek" });
  assert.equal(normalizeWijk({ properties: { wijkcode: "x", wijknaam: "y" } }), null);
});
