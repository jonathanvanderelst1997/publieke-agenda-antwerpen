// Nakijkronde van "Parcours, vergunningen en werken aan de juiste straten": elke bevinding een toets.
// Echte vormen (tests/fixtures/parcours-echte-vormen.json: open geodata van de stad, bijgesneden) en
// verzonnen straten; geen live datums.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { buildStreetIndex } from "../site/street-core.js";
import { parcoursGeometrie, stratenVanParcours } from "../site/parcours-straten.js";

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
