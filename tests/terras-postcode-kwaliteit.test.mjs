import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeTerrace, terrasPostcodeMelding } from "../site/terraces-live-core.js";

const bron = (postcode) => normalizeTerrace({ ROLnet_ID: "R-1", TypeTerrasZone: "buiten kern", Status: "actief", postcode });
const straat = (naam, postcode) => ({ id: naam, name: naam, postcode });

test("lege en ongeldige terraspostcodes worden nooit de fictieve postcode 0", () => {
  for (const value of [null, undefined, "", "0", 0, "geen", "20a0", "205", "20501"]) {
    assert.equal(bron(value).postcode, "", String(value));
  }
  for (const value of [2000, "2000", " 2050 ", 2060]) {
    assert.equal(bron(value).postcode, String(value).trim());
  }
});
test("een conflict tussen bronpostcode en officiële straatcode levert een zichtbare noot", () => {
  const item = { postcode: "2000", streets: [straat("Blancefloerlaan", "2050")] };
  const noot = terrasPostcodeMelding(item);
  assert.match(noot, /A-Sign vermeldt postcode 2000/);
  assert.match(noot, /2050/);
  assert.match(noot, /niet bevestigd/);
  assert.equal(item.postcode, "2000");
});
test("meerdere geldige straatpostcodes: een bronmatch is geen conflict", () => {
  const streets = [straat("Noorderlaan", "2030"), straat("Noorderlaan", "2060")];
  assert.equal(terrasPostcodeMelding({ postcode: "2060", streets }), "");
  assert.equal(terrasPostcodeMelding({ postcode: "2030", streets }), "");
  assert.match(terrasPostcodeMelding({ postcode: "2000", streets }), /2030 of 2060/);
});
test("onvoldoende gegevens geeft geen verzonnen conclusie", () => {
  assert.equal(terrasPostcodeMelding({ postcode: "2000", streets: [] }), "");
  assert.equal(terrasPostcodeMelding({ postcode: "", streets: [straat("Teststraat", "2050")] }), "");
  assert.equal(terrasPostcodeMelding({ postcode: "0", streets: [straat("Teststraat", "2050")] }), "");
});
test("live terraslijst toont bronpostcode en legt conflict uit", () => {
  const source = readFileSync(new URL("../site/terraces-live.js", import.meta.url), "utf8");
  assert.match(source, /terrasPostcodeMelding\(item\)/);
  assert.match(source, /Bronpostcode \(A-Sign\)/);
  assert.match(source, /terrace-postcode-warning/);
});
