// Hinder zonder gepubliceerd werk (site/works-hindrance.js, losseHinder): gevalideerde GIPOD-hinder in het
// district waarvan het werk niet in de open GIPOD-laag staat. Alleen verzonnen features en een verzonnen vierkant
// als district.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { hinderBronUrl, losseHinder, oorzakenVan } from "../site/works-hindrance.js";
import { applyWorkStreetResolution, buildStreetIndex } from "../site/street-core.js";

const DISTRICT = { type: "Polygon", coordinates: [[[4.0, 51.0], [5.0, 51.0], [5.0, 52.0], [4.0, 52.0], [4.0, 51.0]]] };
const NU = new Date("2026-10-17T12:00:00Z");
const BINNEN = [4.5, 51.5], BUITEN = [6.0, 51.5];

function zone(id, props = {}, punt = BINNEN) {
  return {
    type: "Feature",
    id: `HINDER_PUNT.verzonnen-${id}-${props.ZoneId || "a"}-2610170600`,
    geometry: { type: "Point", coordinates: punt },
    properties: {
      ZoneId: "a",
      ZoneType: "WerfZone",
      SevereHindrance: false,
      Consequences: "Geen doorgang voor gemotoriseerd verkeer",
      HindranceGipodId: id,
      HindranceURI: `https://gipod.api.vlaanderen.be/api/v1/mobility-hindrances/${id}`,
      HindranceConsequenceOf: `https://gipod.api.vlaanderen.be/api/v1/groundworks/${id - 1};`,
      HindranceDescription: "Proefstraat 12 tot 20: fase 1",
      HindranceOwner: "Verzonnen Nutsbedrijf",
      HindranceContactOrganisations: "Verzonnen Aannemer",
      HindranceStart: "2026-11-02T06:00:00Z",
      HindranceEnd: "2026-11-13T16:00:00Z",
      HindranceStatus: "Gevalideerd",
      HindranceLastModifiedOn: "2026-10-01T08:00:00Z",
      ...props,
    },
  };
}
const los = (features, opties = {}) => losseHinder(features, { getoond: new Set(), inRespons: new Set(), district: DISTRICT, nu: NU, ...opties });

test("oorzaken met hun soort: werk, grondwerk, evenement", () => {
  assert.deepEqual(oorzakenVan("https://gipod.api.vlaanderen.be/api/v1/works/11; https://gipod.api.vlaanderen.be/api/v1/groundworks/12;https://gipod.api.vlaanderen.be/api/v1/events/13"), [
    { soort: "works", id: 11 }, { soort: "groundworks", id: 12 }, { soort: "events", id: 13 },
  ]);
  assert.deepEqual(oorzakenVan(""), []);
});

test("een losse hinder in het district wordt één item, met punt en vaste bronlink, zonder vrije tekst of contacten", () => {
  const [item] = los([zone(900002)]);
  assert.deepEqual(item, {
    hindranceGipodId: 900002,
    severe: false,
    consequences: ["Geen doorgang voor gemotoriseerd verkeer"],
    start: "2026-11-02T06:00:00Z",
    end: "2026-11-13T16:00:00Z",
    zoneTypes: ["WerfZone"],
    oorzaak: "grondwerk",
    point: BINNEN,
    bronUrl: "https://geo.api.vlaanderen.be/GIPOD/ogc/features/v1/collections/HINDER_PUNT/items?f=json&filter-lang=cql2-text&filter=HindranceGipodId%3D900002",
  });
  const tekst = JSON.stringify(item);
  for (const verboden of ["Proefstraat", "Verzonnen Nutsbedrijf", "Verzonnen Aannemer", "mobility-hindrances", "HindranceDescription", "HindranceOwner", "HindranceURI", "Contact"]) {
    assert.ok(!tekst.includes(verboden), verboden);
  }
  assert.equal(hinderBronUrl(5), "https://geo.api.vlaanderen.be/GIPOD/ogc/features/v1/collections/HINDER_PUNT/items?f=json&filter-lang=cql2-text&filter=HindranceGipodId%3D5");
});

test("twee zones met hetzelfde id worden één item: gevolgen samen, ernstig als één zone ernstig is, vroegste start, laatste einde", () => {
  const items = los([
    zone(900004, { ZoneId: "a", Consequences: "Versmalde rijstroken", HindranceStart: "2026-11-05T06:00:00Z" }, BUITEN),
    zone(900004, { ZoneId: "b", ZoneType: "HinderZone", SevereHindrance: true, Consequences: "Geen doorgang voor fietsers;Versmalde rijstroken", HindranceEnd: "2026-12-01T16:00:00Z" }),
  ]);
  assert.equal(items.length, 1);
  assert.deepEqual([items[0].severe, items[0].consequences, items[0].start, items[0].end, items[0].zoneTypes, items[0].point], [
    true, ["Geen doorgang voor fietsers", "Versmalde rijstroken"], "2026-11-02T06:00:00Z", "2026-12-01T16:00:00Z", ["HinderZone", "WerfZone"], BINNEN,
  ]);
});

test("weg: buiten het district, voorbij, niet gevalideerd, en een oorzaak die een evenement is", () => {
  assert.deepEqual(los([zone(900006, {}, BUITEN)]), []);
  assert.deepEqual(los([zone(900008, { HindranceEnd: "2026-10-16T16:00:00Z", HindranceStart: "2026-10-01T06:00:00Z" })]), []);
  assert.deepEqual(los([zone(900010, { HindranceStatus: "In opmaak" })]), []);
  assert.deepEqual(los([zone(900012, { HindranceConsequenceOf: "https://gipod.api.vlaanderen.be/api/v1/events/900011;" })]), []);
  assert.deepEqual(los([zone(900014, { HindranceConsequenceOf: "https://gipod.api.vlaanderen.be/api/v1/works/1;https://gipod.api.vlaanderen.be/api/v1/public-domain-occupancies/2" })]), []);
  assert.deepEqual(los([zone(900016, { HindranceConsequenceOf: "" })]), [], "zonder oorzaak weten we niet of het om een werk gaat");
});

test("weg: een oorzaak die al getoond wordt (ook als maar één van twee oorzaken), of die in de open laag staat", () => {
  const twee = zone(900018, { HindranceConsequenceOf: "https://gipod.api.vlaanderen.be/api/v1/works/700001;https://gipod.api.vlaanderen.be/api/v1/groundworks/700002" });
  assert.equal(los([twee]).length, 1);
  assert.deepEqual(los([twee], { getoond: new Set([700002]) }), []);
  // In het antwoord van INNAME_PUNT maar niet getoond (bijvoorbeeld buiten de grens): dan klopt "het werk staat
  // niet in de open laag" niet meer.
  assert.deepEqual(los([twee], { inRespons: new Set([700001]) }), []);
  assert.equal(los([twee])[0].oorzaak, "grondwerk en werk");
});

test("weg: zonder gevolgen en niet ernstig; wel zonder gevolgen maar ernstig", () => {
  assert.deepEqual(los([zone(900020, { Consequences: "" })]), []);
  assert.equal(los([zone(900022, { Consequences: "", SevereHindrance: true })]).length, 1);
});

test("weg: rotte records (einde meer dan 2 jaar ver, of al lopend en meer dan 12 maanden niet gewijzigd)", () => {
  assert.deepEqual(los([zone(900024, { HindranceStart: "2026-01-01T06:00:00Z", HindranceEnd: "2073-12-31T16:00:00Z" })]), []);
  assert.deepEqual(los([zone(900026, { HindranceStart: "2025-01-01T06:00:00Z", HindranceEnd: "2027-01-01T16:00:00Z", HindranceLastModifiedOn: "2025-06-01T08:00:00Z" })]), []);
  // Nog niet begonnen: een oude wijziging is dan geen teken van een vergeten record.
  assert.equal(los([zone(900028, { HindranceLastModifiedOn: "2025-06-01T08:00:00Z" })]).length, 1);
});

test("faalt gesloten: zonder districtsgrens of met een ongeldige tijd geen blok (null), niet een lege lijst", () => {
  assert.equal(losseHinder([zone(900030)], { district: null, nu: NU }), null);
  assert.equal(losseHinder([zone(900030)], { district: DISTRICT, nu: "geen datum" }), null);
});

test("de plaats: alleen een straatnaam uit de straatas, nooit een huisnummer", () => {
  const index = buildStreetIndex([{ properties: { LSTRNMID: "1", LSTRNM: "Verzonnenlaan", RSTRNMID: "1", RSTRNM: "Verzonnenlaan", postcode: "2000" }, geometry: { type: "LineString", coordinates: [[4.4999, 51.4999], [4.5001, 51.5001]] } }]);
  const [item] = applyWorkStreetResolution(los([zone(900032)]), index);
  assert.deepEqual(item.streets.map((s) => s.name), ["Verzonnenlaan"]);
  assert.doesNotMatch(JSON.stringify(item), /Proefstraat|\b12\b/);
});

test("de werkenlaag toont het blok apart, met de vaste zin, en meldt het als eigen laag", () => {
  const bron = fs.readFileSync(new URL("../site/works-live.js", import.meta.url), "utf8");
  assert.match(bron, /Hinder zonder gepubliceerd werk \(GIPOD\)/);
  assert.match(bron, /GIPOD publiceert deze gevalideerde hinder, maar het werk zelf staat niet in de open GIPOD-laag\./);
  assert.match(bron, /meldLiveLaag\("losseHinder",/);
  assert.match(bron, /inRespons:new Set\(features\.map/);
  // Faalt gesloten: zonder hinderbron geen blok, wel een notitie.
  assert.match(bron, /hinderResult\.ok\?losseHinder\(/);
  assert.match(bron, /Hinder zonder gepubliceerd werk kon nu niet bepaald worden/);
  const html = fs.readFileSync(new URL("../site/index.html", import.meta.url), "utf8");
  assert.match(html, /data-works-loose hidden/);
});
