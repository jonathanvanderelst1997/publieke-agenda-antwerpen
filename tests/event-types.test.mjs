import test from"node:test";import assert from"node:assert/strict";await import("../site/event-types.js");
const{classifyEventType:c,labelFor,types}=globalThis.PublicAgendaEventTypes;const i=(title,fields={})=>({title,theme:"Activiteit",sourceId:"district-kalender",info:"",location:"",...fields});
test("typen",()=>{
  for(const x of["Buurtfeest Zuid","Wijkfeest Kiel","Straatfeest Kammenstraat","Pleinfeest Sint-Jansplein","Burenfeest Eilandje","Buurtbarbecue Noord","Buurt barbecue Linkeroever","Straatbarbecue Zuid","Buurtpicknick Linkeroever","Buurt picknick Linkeroever","Burenpicknick Eilandje","Straatpicknick Noord"])assert.equal(c(i(x)),"neighborhood");
  assert.equal(c(i("Carnavalstoet")),"parade");assert.equal(c(i("Speelstraat Teststraat")),"playstreet");assert.equal(c(i("Rommelmarkt")),"flea_braderie");
  for(const x of["Openluchtconcert","Muziekfestival","Straattheater"])assert.equal(c(i(x)),"culture");
  assert.equal(c(i("Burgerbegroting infomoment")),"participation");assert.equal(c(i("Districtsraad",{sourceId:"district-vergaderingen"})),"public_meeting");
  assert.equal(c(i("Koopzondag",{sourceId:"stad-koopzondagen"})),"shopping");assert.equal(c(i("Training",{theme:"Sport"})),"sport");
  assert.equal(labelFor("neighborhood"),"Buurt & straat");assert.ok(types.length>=10);
});

test("herkent vorming, welzijn, groen en manifestaties",()=>{
  assert.equal(c({title:"Workshop omgaan met piekeren"}),"learning");
  assert.equal(c({title:"Tabletcafé"}),"learning");
  assert.equal(c({title:"Praatcafé Dementie"}),"social");
  assert.equal(c({title:"Groeidag",info:"Vergroen mee je buurt"}),"green_action");
  assert.equal(c({title:"Klimaatmars door Antwerpen"}),"demonstration");
});
test("herkent cultuur en participatie breder zonder algemene woorden te gokken",()=>{
  assert.equal(c({title:"Vrijdagen van de Poëzie"}),"culture");
  assert.equal(c({title:"Kunstendag voor kinderen"}),"culture");
  assert.equal(c({title:"Vliegend College komt naar de wijken"}),"participation");
});
test("een evenement op straat uit de dossiers van de stad zonder herkenbare soort hoort bij buurt & straat",()=>{
  const s="district-asign-evenementen";
  assert.equal(c({title:"Evenement in de Proefstraat — naam volgt",sourceId:s}),"neighborhood");
  assert.equal(c({title:"Studentenactiviteit op het Proefplein",sourceId:s}),"neighborhood");
  assert.equal(c({title:"Speelstraat in de Proefstraat",sourceId:s}),"playstreet");
  assert.equal(c({title:"Proefloop Zuid",theme:"Sport",sourceId:s}),"sport");
  assert.equal(c({title:"Evenement in de Proefstraat",sourceId:"district-kalender"}),"other","andere bronnen blijven ongewijzigd");
});
