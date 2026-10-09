import test from "node:test";
import assert from "node:assert/strict";
import {omgevingsStatus,duidelijkeKaart} from "../site/permit-clarity.js";
import {evenementKaartje} from "../site/kaart-uitleg.js";
test("een omgevingsaanvraag is niet automatisch een verleende vergunning",()=>{
 const pending=omgevingsStatus({decision:""}),advice=omgevingsStatus({decision:"Gunstig advies"});
 assert.equal(pending.type,"aanvraag");
 assert.equal(advice.type,"onduidelijk");
 assert.equal(omgevingsStatus({decision:"Vergunning geweigerd"}).type,"geweigerd");
 const permit=omgevingsStatus({decision:"Voorwaardelijk vergund"});
 assert.equal(permit.type,"vergund");
 assert.match(permit.label,/startdatum.*niet bevestigd/);
});
test("vergunningkaart laat uitvoering niet als reeds begonnen zien en toont alleen echte besluitdatum",()=>{
 const e={source:"permits"},item={purpose:"Verbouwing of uitbreiding",decision:"Vergund",decisionDateLabel:"8 oktober 2026"};
 const x=duidelijkeKaart(e,item);
 assert.match(x.samenvatting,/verleend volgens/);
 assert.equal(x.tijd,"Vergund");
 assert.ok(x.regels.some(([k,v])=>k==="Beslissingsdatum"&&v==="8 oktober 2026"));
 assert.ok(x.regels.some(([k,v])=>k==="Start van de werken"&&v==="Niet gepubliceerd"));
 const y=duidelijkeKaart(e,{purpose:"Nieuwbouw"});
 assert.equal(y.regels.some(([k])=>k==="Beslissingsdatum"),false);
});
test("naamloos parcours zegt eerlijk dat de stad niet bekendmaakt wat het is, zonder vaste parcourszin of codes",()=>{
 const input={start:"2026-10-13",eind:"2026-10-13",dossier:"ET2026003793",dossierType:"ETL",straten:Array.from({length:115},(_,i)=>"Straat "+i),soorten:["Parcours"],parcours:1,fasen:["Evenement"],beschrijvingen:[],soort:"",soortBron:"",hinder:"True"};
 const x=evenementKaartje(input,{vandaag:"2026-10-08",wijkVan:()=> "Centrum"});
 const kern=Object.fromEntries(x.kern);
 assert.equal(x.titel,"Evenement met toelating van de stad");
 assert.match(kern.Wat,/de stad maakt niet bekend wat het is/);
 assert.match(kern.Wanneer,/^Dinsdag 13 oktober; de uren zijn niet gepubliceerd/);
 assert.match(kern["Wat merk je"],/welke en hoe laat, maakt de stad niet bekend/);
 assert.match(x.regels.find(([label])=>label==="Straten")[1],/^115 straten langs het parcours \(berekend uit de kaart van de stad; niet allemaal tegelijk dicht\)$/);
 assert.doesNotMatch(JSON.stringify(x),/uit een parcours alleen volgt niet|volgens het dossier|ETL|IOD|Kijk bij de officiële bron hieronder/);
 assert.doesNotMatch(x.titel,/loopwedstrijd/i);
});
