// Nakijkronde van "Parcours, vergunningen en werken aan de juiste straten": elke bevinding een toets.
// Echte vormen (tests/fixtures/parcours-echte-vormen.json: open geodata van de stad, bijgesneden) en
// verzonnen straten; geen live datums.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { buildStreetIndex } from "../site/street-core.js";
import { parcoursGeometrie, stratenVanParcours } from "../site/parcours-straten.js";
import { createAgendaView } from "../site/agenda-view.js";
import { createAreaMatcher } from "../site/neighborhood-map.js";
import { collectPermits } from "../site/permits-live-core.js";
import { collectPublicSpace } from "../site/public-space-live-core.js";

const ECHT = JSON.parse(fs.readFileSync(new URL("./fixtures/parcours-echte-vormen.json", import.meta.url), "utf8"));
const asFeature = (naam, coordinates, postcode = 2000, id = 1) => ({ type: "Feature", properties: { DISTRICT: "ANTWERPEN", LSTRNMID: id, LSTRNM: naam, RSTRNMID: id, RSTRNM: naam, postcode }, geometry: { type: "LineString", coordinates } });
// Meter rond een vaste oorsprong naar lengte- en breedtegraad (verzonnen straten).
const m = (x, y) => [4.4 + x / 69760, 51.2 + y / 110540];

// Bevinding 1 en 2: een parcours dat door de straat loopt, heette "kruist" (Arthur Goemaerelei, Singel,
// Ossenmarkt), en een hoek waar het parcours afslaat, heette "ligt in je straat" (Van Ertbornstraat).
test("echte vormen: loopt het parcours door de straat, of kruist het haar alleen?", () => {
  assert.ok(ECHT.gevallen.length >= 7);
  for (const g of ECHT.gevallen) {
    const index = buildStreetIndex(g.assen.map((p) => asFeature(g.straat, p, g.postcode)));
    const geometrie = parcoursGeometrie(g.vlakken.map((rings) => ({ geometry: { rings } })));
    // Zowel de verversing (alle straten) als de browser (alleen de gekozen straat): hetzelfde antwoord.
    for (const opties of [{}, { alleen: new Set([g.straat]) }]) {
      const p = stratenVanParcours(geometrie, index, opties);
      const ander = g.verwacht === "langs" ? "kruist" : "langs";
      assert.deepEqual(p[g.verwacht], [g.straat], `${g.straat} × ${g.dossier} hoort "${g.verwacht}": ${g.waarom}`);
      assert.deepEqual(p[ander], [], `${g.straat} × ${g.dossier}`);
    }
  }
});

test("een korte straat helemaal op het parcours loopt er langs; een tunnel eronder nooit", () => {
  // Een parcours van 20 m breed langs een lange weg; een steeg van 30 m ligt er helemaal in, een tunnel
  // loopt eronder over 300 m.
  const vlak = { rings: [[[-10, -10], [400, -10], [400, 10], [-10, 10], [-10, -10]].map(([x, y]) => m(x, y))] };
  const index = buildStreetIndex([
    asFeature("Lange Weg", [m(0, 0), m(390, 0)], 2000, 1),
    asFeature("Korte Steeg", [m(100, 2), m(130, 2)], 2000, 2),
    asFeature("Proeftunnel", [m(20, 1), m(330, 1)], 2000, 3),
  ]);
  const p = stratenVanParcours(parcoursGeometrie([{ geometry: vlak }]), index);
  assert.deepEqual(p.langs, ["Korte Steeg", "Lange Weg"]);
  assert.deepEqual(p.kruist, ["Proeftunnel"]);
});

// Bevinding 3: met +500 m rond de Peterseliestraat kwamen honderden items mee, en een deel lag verder
// dan de straal (een parkeerverbod op 922 m, evenementen op 504 tot 545 m). Een item telde mee zodra
// één van zijn straten binnen de straal kwam; een lange straat trok zo items van ver mee.
test("straal: de eigen vorm van het item telt, niet zijn straat; terrassen alleen in de straat zelf", () => {
  // Gekozen Straat (100 m, oost-west). Lange Straat begint 200 m noordelijker en loopt 2 km door.
  const index = buildStreetIndex([
    asFeature("Gekozen Straat", [m(0, 0), m(100, 0)], 2000, 1),
    asFeature("Lange Straat", [m(50, 200), m(50, 2200)], 2000, 2),
  ]);
  const view = createAgendaView();
  view.setAreaMatcher(createAreaMatcher({ wijken: [], geo: { entries: {} }, streetIndex: index }));
  view.setStreet("Gekozen Straat", { id: "1", name: "Gekozen Straat", postcode: "2000" });
  view.setArea({ radius: 500 });
  const lange = [{ id: "2", name: "Lange Straat", postcode: "2000" }];
  const vak = (x, y, b = 15) => ({ rings: [[[x, y], [x + b, y], [x + b, y + b], [x, y + b], [x, y]].map(([a, c]) => m(a, c))] });
  const vergunningVer = { id: "permit:ver", streets: lange, vorm: parcoursGeometrie([{ geometry: vak(55, 900) }]) };
  const vergunningDicht = { id: "permit:dicht", streets: lange, vorm: parcoursGeometrie([{ geometry: vak(55, 300) }]) };
  const parkeerVer = { id: "parking:ver", kind: "parking", streets: lange, vorm: parcoursGeometrie([{ geometry: { paths: [[m(52, 920), m(52, 970)]] } }]) };
  const parkeerDicht = { id: "parking:dicht", kind: "parking", streets: lange, vorm: parcoursGeometrie([{ geometry: { paths: [[m(52, 400), m(52, 450)]] } }]) };
  const evenementNet = { id: "iod:net", kind: "iod", streets: lange, vorm: parcoursGeometrie([{ geometry: vak(40, 504, 40) }]) };
  // Een werfzone ver weg met een omleiding die op 300 m voorbijkomt: de omleiding hoort bij de maatregel.
  const werfzone = { id: "sgw:1", kind: "sgw", streets: lange, vorm: parcoursGeometrie([{ geometry: vak(55, 1500) }, { geometry: { paths: [[m(-400, 300), m(400, 300)]] } }]) };
  const terras = { id: "terrace:1", streets: lange, terraceType: "Terraszone" }; // 250 m verder, zonder vorm
  assert.equal(view.matchesStreet(vergunningVer), false, "vergunning 900 m verder op een lange straat");
  assert.equal(view.matchesStreet(parkeerVer), false, "parkeerverbod 920 m verder");
  assert.equal(view.matchesStreet(evenementNet), false, "evenement op 504 m valt buiten 500 m");
  assert.equal(view.matchesStreet(terras), false, "terrassen tellen alleen in de straat zelf");
  assert.equal(view.matchesStreet(vergunningDicht), true);
  assert.equal(view.matchesStreet(parkeerDicht), true);
  assert.equal(view.matchesStreet(werfzone), true);
  view.setArea({ radius: 1000 });
  assert.equal(view.matchesStreet(vergunningVer), true, "met +1 km wel");
  assert.equal(view.matchesStreet(evenementNet), true);
});

test("live lagen geven elk item zijn eigen vorm mee (vergunning, parkeerverbod, inname, werfzone)", () => {
  const district = { type: "Polygon", coordinates: [[m(-1000, -1000), m(3000, -1000), m(3000, 3000), m(-1000, 3000), m(-1000, -1000)]] };
  const perceel = { rings: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]].map(([x, y]) => m(x, y))] };
  const [permit] = collectPermits({ features: [{ attributes: { Dossiernummer: "OMV_2099000002", DOSSIERTYPE: "Omgevingsvergunning" }, geometry: perceel }], districtGeometry: district });
  assert.equal(permit.vorm.vlakken.length, 1);
  const lijn = { paths: [[m(0, 0), m(30, 0)]] };
  const ms = (iso) => Date.parse(iso);
  const items = collectPublicSpace({
    parkingFeatures: [{ attributes: { Dossiernummer: "2099-000001", Locatienummer: "1", Status: "Goedgekeurd", Adres: "Proefstraat", Postcode: "2000", Reden: "Verhuis", Startdatum: ms("2026-10-20T00:00:00Z"), Einddatum: ms("2026-10-21T00:00:00Z") }, geometry: lijn }],
    iodFeatures: [{ attributes: { dossierNummer: "ET2099000003", faseId: "F1", innameId: "I1", dossierStatus: "aanvraag_goedgekeurd", faseNaam: "Evenement", type_dossier: "ETL", innameTypeNaam: "Zone", faseStartDatum: ms("2026-10-20T06:00:00Z"), faseEindDatum: ms("2026-10-20T16:00:00Z") }, geometry: perceel }],
    sgwFeatures: [{ kind: "Werfzone", feature: { attributes: { reference_id: "SGW-1", phase_id: "1", status: "vergund", StartDate: ms("2026-10-20T00:00:00Z"), EndDate: ms("2026-11-20T00:00:00Z") }, geometry: perceel } }],
    districtGeometry: district,
  });
  const per = Object.fromEntries(items.map((i) => [i.kind, i]));
  assert.equal(per.parking.vorm.lijnen.length, 1);
  assert.equal(per.iod.vorm.vlakken.length, 1);
  assert.equal(per.iod.parcours, undefined, "alleen een parcours krijgt ook `parcours`");
  assert.equal(per.sgw.vorm.vlakken.length, 1);
});
