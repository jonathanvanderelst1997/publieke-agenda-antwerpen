import test from "node:test";import assert from "node:assert/strict";
import{buildStreetIndex,resolveAddressStreet,resolveGeometryStreets,resolvePointStreet}from"../site/street-core.js";
import{fetchStreetFeatures}from"../site/street-source.js";
const features=[{type:"Feature",properties:{DISTRICT:"ANTWERPEN",LSTRNMID:1,LSTRNM:"Teststraat",RSTRNMID:1,RSTRNM:"Teststraat",postcode:2000},geometry:{type:"LineString",coordinates:[[4.4,51.2],[4.401,51.2]]}},{type:"Feature",properties:{DISTRICT:"ANTWERPEN",LSTRNMID:2,LSTRNM:"Zijstraat",RSTRNMID:2,RSTRNM:"Zijstraat",postcode:2000},geometry:{type:"LineString",coordinates:[[4.4005,51.1995],[4.4005,51.2005]]}}];const index=buildStreetIndex(features);
test("punt gebruikt officiële straatas",()=>assert.equal(resolvePointStreet([4.4002,51.20002],index).streets[0].name,"Teststraat"));
test("adres vindt straat ook na locatienaam",()=>assert.equal(resolveAddressStreet("Huis, Teststraat 4, 2000 Antwerpen",index).streets[0].name,"Teststraat"));
test("lijngeometrie kan meerdere straten raken",()=>{const r=resolveGeometryStreets({paths:[[[4.4,51.2],[4.4007,51.2]]]},index);assert.ok(r.streets.some(s=>s.name==="Teststraat"));assert.ok(r.streets.some(s=>s.name==="Zijstraat"))});

test("ruimtelijke grid beperkt kandidaten zonder resultaat te wijzigen",()=>{assert.ok(index.grid instanceof Map);const a=resolvePointStreet([4.4002,51.20002],index);const b=resolveGeometryStreets({paths:[[[4.4,51.2],[4.4007,51.2]]]},index);assert.equal(a.streets[0].name,"Teststraat");assert.ok(b.streets.length>=1)});

test("straatasbron gebruikt ArcGIS-paginering in plaats van alle objectIds",async()=>{
  const offsets=[];
  const fetchImpl=async url=>{
    const parsed=new URL(String(url));
    offsets.push(parsed.searchParams.get("resultOffset"));
    const offset=Number(parsed.searchParams.get("resultOffset"));
    const page=offset===0
      ? [{type:"Feature",properties:{DISTRICT:"ANTWERPEN",LSTRNMID:1,LSTRNM:"A",RSTRNMID:1,RSTRNM:"A",postcode:2000},geometry:{type:"LineString",coordinates:[[4.4,51.2],[4.401,51.2]]}},{type:"Feature",properties:{DISTRICT:"ANTWERPEN",LSTRNMID:2,LSTRNM:"B",RSTRNMID:2,RSTRNM:"B",postcode:2000},geometry:{type:"LineString",coordinates:[[4.4,51.21],[4.401,51.21]]}}]
      : [{type:"Feature",properties:{DISTRICT:"ANTWERPEN",LSTRNMID:3,LSTRNM:"C",RSTRNMID:3,RSTRNM:"C",postcode:2000},geometry:{type:"LineString",coordinates:[[4.4,51.22],[4.401,51.22]]}}];
    return{ok:true,status:200,json:async()=>({type:"FeatureCollection",features:page})};
  };
  const features=await fetchStreetFeatures({fetchImpl,pageSize:2,maxPages:3});
  assert.equal(features.length,3);
  assert.deepEqual(offsets,["0","2"]);
});

test("straatasbron faalt gesloten als de pagineringslimiet bereikt wordt",async()=>{
  const fetchImpl=async()=>({ok:true,status:200,json:async()=>({type:"FeatureCollection",features:[
    {type:"Feature",properties:{DISTRICT:"ANTWERPEN",LSTRNMID:1,LSTRNM:"A",RSTRNMID:1,RSTRNM:"A",postcode:2000},geometry:{type:"LineString",coordinates:[[4.4,51.2],[4.401,51.2]]}},
  ]})});
  await assert.rejects(()=>fetchStreetFeatures({fetchImpl,pageSize:1,maxPages:2}),error=>error?.code==="street_axis_pagination_limit");
});

test("straatasbron valt terug op lokale districtfilter als serverfilter leeg is",async()=>{
  const whereSeen=[];
  const fetchImpl=async url=>{
    const parsed=new URL(String(url));
    const where=parsed.searchParams.get("where");
    whereSeen.push(where);
    if(where!=="1=1")return{ok:true,status:200,json:async()=>({type:"FeatureCollection",features:[]})};
    return{ok:true,status:200,json:async()=>({type:"FeatureCollection",features:[
      {type:"Feature",properties:{DISTRICT:"Antwerpen",LSTRNMID:10,LSTRNM:"Fallbackstraat",RSTRNMID:10,RSTRNM:"Fallbackstraat",postcode:2000},geometry:{type:"LineString",coordinates:[[4.4,51.2],[4.401,51.2]]}},
      {type:"Feature",properties:{DISTRICT:"Borgerhout",LSTRNMID:11,LSTRNM:"Andere straat",RSTRNMID:11,RSTRNM:"Andere straat",postcode:2140},geometry:{type:"LineString",coordinates:[[4.42,51.21],[4.421,51.21]]}}
    ]})};
  };
  const rows=await fetchStreetFeatures({fetchImpl,pageSize:2000,maxPages:2});
  assert.equal(rows.length,1);
  assert.equal(rows[0].properties.LSTRNM,"Fallbackstraat");
  assert.deepEqual(whereSeen,["DISTRICT IN ('ANTWERPEN','Antwerpen','antwerpen')","1=1"]);
});
