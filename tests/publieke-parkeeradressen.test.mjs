import test from "node:test";
import assert from "node:assert/strict";
import { publiekParkeerAdres, adresZonderHuisnummer } from "../site/adres-privacy.js";
import { collectPublicSpace } from "../site/public-space-live-core.js";
import { publicSpaceEntries } from "../site/place-core.js";
import { itemVoorStraat } from "../scripts/build-straat-snapshots.mjs";
import { compactPublicSpaceItem } from "../lib/live-history.mjs";
const straat = "Cockerillkaai, 2000 Antwerpen";
const namen = ["Cockerillkaai", "De 7 Schakenpad"];
test("goedgekeurd parkeerverbod krijgt exact officieel huisnummer, geen bus of gok", () => {
  assert.equal(publiekParkeerAdres("Cockerillkaai 11-13 2000 Antwerpen",straat,namen),"Cockerillkaai 11–13, 2000 Antwerpen");
  assert.equal(publiekParkeerAdres("Cockerillkaai 18-18 2000 Antwerpen",straat,namen),"Cockerillkaai 18, 2000 Antwerpen");
  assert.equal(publiekParkeerAdres("Cockerillkaai 22-22 2000 Antwerpen",straat,namen),"Cockerillkaai 22, 2000 Antwerpen");
  for(const raw of ["Cockerillkaai nvt-nvt 2000 Antwerpen","Cockerillkaai 15-11 2000 Antwerpen",
     "Cockerillkaai 18 bus 3 2000 Antwerpen","Anderekaai 18-18 2000 Antwerpen",
     "Cockerillkaai 18-18 2000 Antwerpen Jan Voorbeeld", "Cockerillkaai 1-999 2000 Antwerpen"]){
     assert.equal(publiekParkeerAdres(raw,straat,namen),"",raw);
  }
});
const bron=(status="In effect")=>({
  Dossiernummer:"2026-055332",Locatienummer:"1185215",Status:status,
  Adres:"Cockerillkaai 18-18 2000 Antwerpen",Postcode:"2000",
  Reden:"Aanvraag tot het inrichten van een laad-en loszone",
  Startdatum:Date.parse("2026-10-08T00:00:00Z"),Einddatum:Date.parse("2026-10-23T00:00:00Z"),
});
test("live is precies, openbare snapshot en archief zijn nog steeds volledig nummerloos", () => {
  const [rij]=collectPublicSpace({parkingFeatures:[{attributes:bron()}],postcodes:["2000"],straatnamen:namen});
  assert.equal(rij.location,"Cockerillkaai 18, 2000 Antwerpen");
  const kaarten=publicSpaceEntries([rij],{vandaag:"2026-10-13"});
  assert.ok(kaarten.some(c=>c.location.includes("Cockerillkaai 18")));
  const voorBestand=itemVoorStraat(rij,{laag:"publiekeRuimte"});
  assert.ok(voorBestand);
  assert.equal(voorBestand.location,straat);
  assert.equal(compactPublicSpaceItem(rij).location,straat);
  assert.equal(adresZonderHuisnummer(rij.location,namen),straat);
});
test("alleen goedgekeurde publieke maatregelen van district Antwerpen tonen",()=>{
  assert.equal(collectPublicSpace({parkingFeatures:[{attributes:bron("Ingediend")}],postcodes:["2000"]}).length,0);
  assert.equal(collectPublicSpace({parkingFeatures:[{attributes:bron()}],postcodes:["2600"]}).length,0);
});
