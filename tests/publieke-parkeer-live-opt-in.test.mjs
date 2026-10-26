// Regel van de eigenaar van 26 oktober 2026: een parkeerverbod heeft overal zijn exacte plaats, live én in wat de
// verversing bewaart (de ochtendstand, de historiek, de straatbestanden). Er is dus geen aparte "live"-schakelaar meer
// die het huisnummer alleen in de browser toont: geen enkele aanroep vraagt nog `alleenLive`.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
test("geen aparte live-schakelaar voor het huisnummer van een parkeerverbod",()=>{
 for(const pad of ["site/public-space-live.js","site/public-space-live-core.js","scripts/build-straat-snapshots.mjs","scripts/refresh-live-history.mjs","lib/live-history.mjs"]){
  const bron=fs.readFileSync(new URL(`../${pad}`,import.meta.url),"utf8");
  assert.doesNotMatch(bron,/alleenLive\s*:/,pad);
 }
 const browser=fs.readFileSync(new URL("../site/public-space-live.js",import.meta.url),"utf8");
 assert.match(browser,/postcodes:DISTRICT_POSTCODES\}/);
});
