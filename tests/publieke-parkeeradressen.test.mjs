// Live toont een goedgekeurd parkeerverbod waar exact (publiekParkeerAdres); de opslag houdt alleen de straat. Verzonnen
// straat, dossier en reden (vierde nakijkronde van 18 oktober 2026: hier stond een echte straat met bestaande huisnummers
// naast een reden; een echte straat krijgt in de toetsen alleen huisnummer 999, tests/historiek-privacy.test.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { publiekParkeerAdres, adresZonderHuisnummer } from "../site/adres-privacy.js";
import { collectPublicSpace } from "../site/public-space-live-core.js";
import { publicSpaceEntries } from "../site/place-core.js";
import { itemVoorStraat } from "../scripts/build-straat-snapshots.mjs";
import { compactPublicSpaceItem } from "../lib/live-history.mjs";
const straat = "Proefkaai, 2000 Antwerpen";
const namen = ["Proefkaai", "De 7 Schakenpad"];
test("goedgekeurd parkeerverbod krijgt exact officieel huisnummer, geen bus of gok", () => {
  assert.equal(publiekParkeerAdres("Proefkaai 11-13 2000 Antwerpen",straat,namen),"Proefkaai 11–13, 2000 Antwerpen");
  assert.equal(publiekParkeerAdres("Proefkaai 18-18 2000 Antwerpen",straat,namen),"Proefkaai 18, 2000 Antwerpen");
  assert.equal(publiekParkeerAdres("Proefkaai 22-22 2000 Antwerpen",straat,namen),"Proefkaai 22, 2000 Antwerpen");
  // Zo exact als de bron (vierde nakijkronde van 18 oktober 2026): een omgekeerd bereik oplopend, een bus nooit, een
  // bereik over de hele straat zoals de bron het zegt (tests/parkeerverbod-waar-exact.test.mjs).
  assert.equal(publiekParkeerAdres("Proefkaai 15-11 2000 Antwerpen",straat,namen),"Proefkaai 11–15, 2000 Antwerpen");
  assert.equal(publiekParkeerAdres("Proefkaai 18 bus 3 2000 Antwerpen",straat,namen),"Proefkaai 18, 2000 Antwerpen");
  assert.equal(publiekParkeerAdres("Proefkaai 1-999 2000 Antwerpen",straat,namen),"Proefkaai 1–999, 2000 Antwerpen");
  for(const raw of ["Proefkaai nvt-nvt 2000 Antwerpen","Anderekaai 18-18 2000 Antwerpen",
     "Proefkaai 18-18 2000 Antwerpen Jan Voorbeeld"]){
     assert.equal(publiekParkeerAdres(raw,straat,namen),"",raw);
  }
});
const bron=(status="In effect")=>({
  Dossiernummer:"2099-000555",Locatienummer:"1",Status:status,
  Adres:"Proefkaai 18-18 2000 Antwerpen",Postcode:"2000",
  Reden:"Proefreden (e2e)",
  Startdatum:Date.parse("2099-10-08T00:00:00Z"),Einddatum:Date.parse("2099-10-23T00:00:00Z"),
});
test("live is precies, openbare snapshot en archief zijn nog steeds volledig nummerloos", () => {
  const [rij]=collectPublicSpace({parkingFeatures:[{attributes:bron()}],postcodes:["2000"],straatnamen:namen,alleenLive:true});
  const [zonderOptIn]=collectPublicSpace({parkingFeatures:[{attributes:bron()}],postcodes:["2000"],straatnamen:namen});
  assert.equal(zonderOptIn.location,straat,"zonder live-opt-in nooit een huisnummer in de bronverwerking");
  assert.equal(rij.location,"Proefkaai 18, 2000 Antwerpen");
  const kaarten=publicSpaceEntries([rij],{vandaag:"2099-10-13"});
  assert.ok(kaarten.some(c=>c.location.includes("Proefkaai 18")));
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
