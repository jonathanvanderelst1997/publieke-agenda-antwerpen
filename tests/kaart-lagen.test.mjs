// P9 "Een kaart die vertelt": de pure delen van de buurtkaart, zonder browser. Verzonnen gegevens.
// - de kaartbibliotheken voor de e2e-toetsen (tests/helpers/kaart-fixture.mjs, tests/fixtures/kaart/).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { LEAFLET } from "../site/neighborhood-map.js";
import { LEAFLET_DIR, LEAFLET_PREFIX, MAPLIBRE_PREFIX, MAPLIBRE_SRI, kaartAntwoord, sri } from "./helpers/kaart-fixture.mjs";

// ---- stap 1: Leaflet byte-exact uit de fixture ----
test("de Leaflet-fixture is byte-gelijk aan wat de site met SRI vraagt", () => {
  const js = fs.readFileSync(path.join(LEAFLET_DIR, "leaflet.js"));
  const css = fs.readFileSync(path.join(LEAFLET_DIR, "leaflet.css"));
  assert.equal(js.length, 147552);
  assert.equal(css.length, 14806);
  assert.equal(sri(js), LEAFLET.js.integrity);
  assert.equal(sri(css), LEAFLET.css.integrity);
  assert.equal(LEAFLET_PREFIX, "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/");
  assert.equal(LEAFLET.js.src, `${LEAFLET_PREFIX}leaflet.js`);
  assert.equal(LEAFLET.css.href, `${LEAFLET_PREFIX}leaflet.css`);
  assert.match(fs.readFileSync(path.join(LEAFLET_DIR, "LICENSE"), "utf8"), /^BSD 2-Clause License/);
});

test("kaartAntwoord: Leaflet met CORS-kop en type; al de rest null (de toets breekt het af)", () => {
  const js = kaartAntwoord(`${LEAFLET_PREFIX}leaflet.js`);
  assert.equal(js.status, 200);
  assert.deepEqual(js.headers, { "access-control-allow-origin": "*", "content-type": "text/javascript; charset=utf-8" });
  assert.equal(sri(js.body), LEAFLET.js.integrity);
  const css = kaartAntwoord(`${LEAFLET_PREFIX}leaflet.css?v=1`);
  assert.equal(css.headers["content-type"], "text/css; charset=utf-8");
  assert.equal(sri(css.body), LEAFLET.css.integrity);
  for (const url of [
    `${LEAFLET_PREFIX}images/marker-icon.png`,
    `${LEAFLET_PREFIX}../leaflet.js`,
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.3/leaflet.js",
    "https://tile.openstreetmap.org/15/16800/10900.png",
    "https://tiles.openfreemap.org/styles/positron",
    `${MAPLIBRE_PREFIX}maplibre-gl.js`, // zonder maplibreDir: niet beantwoord
  ]) assert.equal(kaartAntwoord(url), null, url);
});

test("kaartAntwoord: MapLibre alleen als de bestanden in maplibreDir de vaste SRI hebben", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kaart-fixture-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "maplibre-gl.js"), "/* geen echte MapLibre */");
  fs.writeFileSync(path.join(dir, "maplibre-gl.css"), ".verzonnen{}");
  assert.equal(kaartAntwoord(`${MAPLIBRE_PREFIX}maplibre-gl.js`, { maplibreDir: dir }), null);
  assert.equal(kaartAntwoord(`${MAPLIBRE_PREFIX}maplibre-gl.css`, { maplibreDir: dir }), null);
  assert.equal(kaartAntwoord(`${MAPLIBRE_PREFIX}maplibre-gl.min.js`, { maplibreDir: dir }), null);
  assert.deepEqual(Object.keys(MAPLIBRE_SRI), ["maplibre-gl.js", "maplibre-gl.css"]);
  assert.ok(Object.values(MAPLIBRE_SRI).every((w) => /^sha512-[A-Za-z0-9+/]{86}==$/.test(w)));
});

test("kaartAntwoord: de echte MapLibre 5.24.0 uit MAPLIBRE_DIR", { skip: process.env.MAPLIBRE_DIR ? false : "MAPLIBRE_DIR niet gezet" }, () => {
  const maplibreDir = process.env.MAPLIBRE_DIR;
  const js = kaartAntwoord(`${MAPLIBRE_PREFIX}maplibre-gl.js`, { maplibreDir });
  const css = kaartAntwoord(`${MAPLIBRE_PREFIX}maplibre-gl.css`, { maplibreDir });
  assert.equal(js?.headers["access-control-allow-origin"], "*");
  assert.equal(sri(js.body), MAPLIBRE_SRI["maplibre-gl.js"]);
  assert.equal(css?.headers["content-type"], "text/css; charset=utf-8");
});
