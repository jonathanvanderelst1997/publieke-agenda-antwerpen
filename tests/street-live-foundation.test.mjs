import test from "node:test";import assert from "node:assert/strict";
import{buildStreetIndex,resolveAddressStreet,resolveGeometryStreets,resolvePointStreet}from"../site/street-core.js";
const features=[{type:"Feature",properties:{DISTRICT:"ANTWERPEN",LSTRNMID:1,LSTRNM:"Teststraat",RSTRNMID:1,RSTRNM:"Teststraat",postcode:2000},geometry:{type:"LineString",coordinates:[[4.4,51.2],[4.401,51.2]]}},{type:"Feature",properties:{DISTRICT:"ANTWERPEN",LSTRNMID:2,LSTRNM:"Zijstraat",RSTRNMID:2,RSTRNM:"Zijstraat",postcode:2000},geometry:{type:"LineString",coordinates:[[4.4005,51.1995],[4.4005,51.2005]]}}];const index=buildStreetIndex(features);
test("punt gebruikt officiële straatas",()=>assert.equal(resolvePointStreet([4.4002,51.20002],index).streets[0].name,"Teststraat"));
test("adres vindt straat ook na locatienaam",()=>assert.equal(resolveAddressStreet("Huis, Teststraat 4, 2000 Antwerpen",index).streets[0].name,"Teststraat"));
test("lijngeometrie kan meerdere straten raken",()=>{const r=resolveGeometryStreets({paths:[[[4.4,51.2],[4.4007,51.2]]]},index);assert.ok(r.streets.some(s=>s.name==="Teststraat"));assert.ok(r.streets.some(s=>s.name==="Zijstraat"))});
