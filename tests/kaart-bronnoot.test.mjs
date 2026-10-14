import test from "node:test";
import assert from "node:assert/strict";
import { kaartBronNoot } from "../site/kaart-bronnoot.js";
test("naam en uur van een publiek evenement komen niet uit verzonnen gegevens", () => {
  const item = { source:"publicSpace", item:{kind:"iod"}, uitleg:{ontbreekt:["naam van het evenement niet gepubliceerd door de stad","uren niet gepubliceerd","organisator niet gepubliceerd"]} };
  assert.equal(kaartBronNoot(item), "Naam van het evenement niet gepubliceerd · Uur niet gepubliceerd.");
  assert.equal(kaartBronNoot(item,{zichtbaar:["Naam niet gepubliceerd"]}), "Uur niet gepubliceerd.");
});
test("onbekende activiteit wordt onderscheiden van ontbrekende evenementnaam", () => {
  const item = { source:"publicSpace",item:{kind:"event"},uitleg:{ontbreekt:["wat er gebeurt en de naam niet gepubliceerd door de stad"]} };
  assert.match(kaartBronNoot(item),/Welke activiteit hier plaatsvindt/);
});
test("een A-Sign omleiding vermeldt niet vanzelf de reden van de werf", () => {
  const item = { source:"publicSpace",item:{kind:"sgw"},title:"Werfzone + Omleiding" };
  assert.match(kaartBronNoot(item),/niet bevestigd/);
  assert.doesNotMatch(kaartBronNoot(item),/riolering|asfalt|nutsleidingen/);
});
test("terrasstatus krijgt privacycontext zonder verdwenen kaarten", () => {
  const item = {source:"terraces",item:{kind:"terrace"}};
  assert.match(kaartBronNoot(item),/uitbater en huisnummer/);
});
test("normale niet-vage kaarten krijgen geen onnodige waarschuwing", () => {
  assert.equal(kaartBronNoot({source:"agenda",title:"Concert",item:{}}),"");
  assert.equal(kaartBronNoot({source:"works",uitleg:{ontbreekt:[]}}),"");
  assert.match(kaartBronNoot({source:"works",uitleg:{ontbreekt:["omschrijving niet gepubliceerd door de beheerder"]}}),/geen vrije omschrijving/);
});
