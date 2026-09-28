import test from "node:test";
import assert from "node:assert/strict";
import {civicCalendarFromDecision,classifyCivicDecisionTitle,extractPdfAttachments,isDistrictAntwerpenDecision,parseDutchDate,parseFairCalendar,parseMarketExceptionCalendar} from "../lib/civic-decision.mjs";
test("regulation change is not a concrete play street",()=>assert.deepEqual(classifyCivicDecisionTitle("Districtswerking en decentralisatie - Toelating tijdelijk gebruik straat als speelstraat. Wijziging aanvullend verkeersreglement - Goedkeuring"),{category:"play_street_rule",publishCandidate:false}));
test("play street refusal is excluded",()=>assert.deepEqual(classifyCivicDecisionTitle("Binnengemeentelijke decentralisatie - Aanvullend verkeersreglement. Aanvragen speelstraten buitenspeeldag mei 2026. Weigering - Goedkeuring"),{category:"play_street_refusal",publishCandidate:false}));
test("approved play street period is candidate",()=>assert.deepEqual(classifyCivicDecisionTitle("Binnengemeentelijke decentralisatie - Aanvullend verkeersreglement. Aanvragen speelstraten paasvakantie 2026 - Goedkeuring"),{category:"play_street_approval",publishCandidate:true}));
test("summer batch is candidate",()=>assert.equal(classifyCivicDecisionTitle("Binnengemeentelijke decentralisatie - Aanvullend verkeersreglement. Aanvragen speelstraten augustus 2026 - Deel III - Goedkeuring").publishCandidate,true));
test("fair approval is candidate",()=>assert.deepEqual(classifyCivicDecisionTitle("District Antwerpen - Najaarsfoor Dageraadplaats 2026 - Goedkeuring"),{category:"fair_calendar_candidate",publishCandidate:true}));
test("unrelated decision stays out",()=>assert.deepEqual(classifyCivicDecisionTitle("Publieke ruimte - Heraanleg plein - Goedkeuring"),{category:"other",publishCandidate:false}));
test("Dutch dates are normalized",()=>{assert.equal(parseDutchDate("3 oktober 2026"),"2026-10-03");assert.equal(parseDutchDate("31 februari 2026"),null)});
test("district decision detection is strict",()=>{assert.equal(isDistrictAntwerpenDecision("Het districtscollege antwerpen beslist:",""),true);assert.equal(isDistrictAntwerpenDecision("Het districtscollege deurne beslist:",""),false)});
test("fair calendar parses concrete place and period",()=>{
  const text="Besluit Het districtscollege antwerpen beslist: Artikel 1 Het districtscollege keurt de data goed: Sint-Jansplein - Voorjaarsfoor: 7 maart 2026 tot en met 29 maart 2026 - oprijden 4 maart 2026 om 15.00 uur; Dageraadplaats - Najaarsfoor: 3 oktober 2026 tot en met 18 oktober 2026 - oprijden 1 oktober 2026 om 15.00 uur; Artikel 2 Geen financiële gevolgen.";
  assert.deepEqual(parseFairCalendar(text),[
    {location:"Sint-Jansplein",name:"Voorjaarsfoor",start:"2026-03-07",end:"2026-03-29"},
    {location:"Dageraadplaats",name:"Najaarsfoor",start:"2026-10-03",end:"2026-10-18"}
  ]);
});
test("market exception separates running and cancelled",()=>{
  const text="Het districtscollege antwerpen beslist: Artikel 1 zondag 5 april 2026, Pasen: Falconplein en Sint-Jansvliet; vrijdag 1 mei 2026: Sint-Jansplein en Desguinlei; Artikel 2 donderdag 14 mei 2026, Hemelvaartsdag: Dageraadplaats en Linkeroever - Frederik Van Eedenplein; Artikel 3 Geen financiële gevolgen.";
  const x=parseMarketExceptionCalendar(text);
  assert.deepEqual(x.running,[{location:"Falconplein",date:"2026-04-05",occurs:true},{location:"Sint-Jansvliet",date:"2026-04-05",occurs:true},{location:"Sint-Jansplein",date:"2026-05-01",occurs:true},{location:"Desguinlei",date:"2026-05-01",occurs:true}]);
  assert.deepEqual(x.cancelled,[{location:"Dageraadplaats",date:"2026-05-14",occurs:false},{location:"Linkeroever - Frederik Van Eedenplein",date:"2026-05-14",occurs:false}]);
});
test("PDF attachment extraction keeps only same-origin PDFs",()=>{
  const html='<a href="/files/speelstraten.pdf">speelstraten.pdf</a><a href="https://evil.example/private.pdf">x.pdf</a><a href="/x">geen pdf</a>';
  assert.deepEqual(extractPdfAttachments(html),[{name:"speelstraten.pdf",url:"https://ebesluit.antwerpen.be/files/speelstraten.pdf"}]);
});
test("calendar extraction never needs raw composition text",()=>{
  const x=civicCalendarFromDecision({code:"2026_DCAN_1",title:"District Antwerpen - Kermissen 2026 - Goedkeuring",category:"fair_calendar_candidate",text:"Het districtscollege antwerpen beslist: Artikel 1 Dageraadplaats - Najaarsfoor: 3 oktober 2026 tot en met 18 oktober 2026; Artikel 2 einde",url:"https://ebesluit.antwerpen.be/x"});
  assert.equal(x.calendarItems.length,1);assert.equal("text" in x.calendarItems[0],false);
});
