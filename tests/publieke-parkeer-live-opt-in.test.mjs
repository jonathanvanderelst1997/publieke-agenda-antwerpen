import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
test("alle openbare A-Sign-opvragingen vragen exacte nummers enkel live aan",()=>{
 const browser=fs.readFileSync(new URL("../site/public-space-live.js",import.meta.url),"utf8");
 assert.equal((browser.match(/alleenLive:true/g)||[]).length,2);
 assert.match(browser,/postcodes:DISTRICT_POSTCODES,alleenLive:true/);
 const builder=fs.readFileSync(new URL("../scripts/build-straat-snapshots.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(builder,/alleenLive\s*:\s*true/,"de ochtendstand mag niet worden verrijkt met een huisnummer");
 const historiek=fs.readFileSync(new URL("../lib/live-history.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(historiek,/alleenLive\s*:\s*true/,"de opgeslagen historiek mag geen detailadres bewaren");
});
