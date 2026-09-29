import assert from "node:assert/strict";import fs from "node:fs";import os from "node:os";import path from "node:path";import test from "node:test";
import{discoverCivicDecisions}from"../lib/ebesluit-discovery.mjs";import{mergeEvents}from"../lib/merge-events.mjs";import{validateSourceDocument}from"../lib/source-feed.mjs";import{run as runEbesluit}from"../scripts/fetch-sources-ebesluit.mjs";
const NOW=new Date("2026-09-28T06:00:00Z"),row=(id,m)=>`<a class="result-row" data-id="${id}" data-meeting-id="${m}" data-content-published="true"></a>`,search=[row("fair","m1"),row("market","m2"),row("play","m3")].join("");
const fair=`Besluit 2026_DCAN_00001 - District Antwerpen - Kermissen 2026 - Goedkeuring districtscollege Antwerpen Het districtscollege antwerpen beslist: Artikel 1 Dageraadplaats - Najaarsfoor: 3 oktober 2026 tot en met 18 oktober 2026; Artikel 2 Einde.`;const market=`Besluit 2026_DCAN_00002 - District Antwerpen - Openbare markten feestdagen 2026 - Goedkeuring districtscollege Antwerpen Het districtscollege antwerpen beslist: Artikel 1 zondag 5 april 2026, Pasen: Falconplein; Artikel 2 donderdag 14 mei 2026, Hemelvaartsdag: Dageraadplaats; Artikel 3 Einde.`;const play=`Besluit 2026_DCAN_00003 - Binnengemeentelijke decentralisatie - Aanvragen speelstraten paasvakantie 2026 - Goedkeuring districtscollege Antwerpen Het districtscollege antwerpen beslist: Artikel 1 goed volgens bijlage. Artikel 2 Einde. <a href="/files/speelstraten.pdf">speelstraten.pdf</a>`;
const resp=(text,status=200)=>({ok:status>=200&&status<300,status,text:async()=>text}),fake=url=>{const u=new URL(String(url));if(u.pathname==="/zoeken")return Promise.resolve(resp(search));if(u.pathname.endsWith("/fair"))return Promise.resolve(resp(fair));if(u.pathname.endsWith("/market"))return Promise.resolve(resp(market));if(u.pathname.endsWith("/play"))return Promise.resolve(resp(play));return Promise.resolve(resp("",404))};
test("eBesluit discovery blijft speelstraten fail-closed",async()=>{const d=await discoverCivicDecisions({fetch:fake,year:2026});assert.equal(d.complete,true);assert.equal(d.calendarItems.length,2);assert.equal(d.exceptions.length,1);assert.equal(d.playStreetAttachments.length,1)});
test("fetcher schrijft bronitems en gevalideerde suppressies",async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),"ebesluit-"));await runEbesluit({rootDir:root,clock:()=>NOW,fetch:fake,log:()=>{}});const doc=JSON.parse(fs.readFileSync(path.join(root,"site","sources","district-ebesluit.json"),"utf8"));assert.deepEqual(validateSourceDocument(doc,{expectedSourceId:"district-ebesluit"}),[]);assert.equal(doc.suppressions.length,1);assert.ok(doc.items.every(x=>!x.title.toLowerCase().includes("speelstraat")))});
test("annulering onderdrukt alleen de bedoelde stad-markt",()=>{const base={externalId:"x",theme:"Activiteit",className:"activity",date:"2026-05-14",endDate:null,timeSlot:"08:00",timeText:"",postcodes:[],info:"",kind:"activity",retrievedAt:NOW.toISOString(),reviewRequired:false};const markt={...base,id:"markt-x",title:"Gemengde markt Dageraadplaats",location:"Dageraadplaats, 2018 Antwerpen",sourceUrl:"https://geo.api.vlaanderen.be/GIPOD/ogc/features/v1/collections/INNAME_PUNT/items/x"},feest={...base,id:"district-kal-x",title:"Buurtfeest",location:"Dageraadplaats, 2018 Antwerpen",sourceUrl:"https://www.antwerpen.be/info/x"};const r=mergeEvents({"stad-markten":{scope:"stad",items:[markt]},"district-kalender":{scope:"district",items:[feest]}},[],[{targetSourceId:"stad-markten",date:"2026-05-14",location:"Dageraadplaats",decisionCode:"2026_DCAN_00002",sourceUrl:"https://ebesluit.antwerpen.be/zittingen/x/agendapunten/y"}]);assert.deepEqual(r.items.map(x=>x.id),["district-kal-x"]);assert.equal(r.suppressed[0].id,"markt-x")});

test("eBesluit probeert een tijdelijke 503 precies één keer opnieuw",async()=>{
  let calls=0;
  const fetch503Once=async url=>{calls++;if(calls===1)return resp("",503);return fake(url)};
  const result=await discoverCivicDecisions({fetch:fetch503Once,year:2026,retryDelayMs:0,sleepImpl:async()=>{}});
  assert.equal(result.complete,true);
  assert.ok(calls>1);
});
test("eBesluit blijft fail-closed na twee 503-antwoorden",async()=>{
  let calls=0;
  const always503=async()=>{calls++;return resp("",503)};
  await assert.rejects(()=>discoverCivicDecisions({fetch:always503,year:2026,retryDelayMs:0,sleepImpl:async()=>{}}),error=>error?.code==="http_503");
  assert.equal(calls,2);
});
test("eBesluit herhaalt een niet-tijdelijke 404 niet",async()=>{
  let calls=0;
  const always404=async()=>{calls++;return resp("",404)};
  await assert.rejects(()=>discoverCivicDecisions({fetch:always404,year:2026,retryDelayMs:0,sleepImpl:async()=>{}}),error=>error?.code==="http_404");
  assert.equal(calls,1);
});
