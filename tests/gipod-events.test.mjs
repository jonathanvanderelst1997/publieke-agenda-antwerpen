import test from "node:test";import assert from "node:assert/strict";import fs from "node:fs";import os from "node:os";import path from "node:path";
import {classifyGipodEvent,eventLabels,eventsFromGipod,gipodEventQueryUrl} from "../lib/gipod-events.mjs";
import {run} from "../scripts/fetch-sources-gipod-events.mjs";import {validateSourceDocument} from "../lib/source-feed.mjs";
const NOW=new Date("2026-09-29T00:00:00Z");
const event=(id,overrides={})=>({id:`INNAME_PUNT.${id}-2610011200`,type:"Feature",geometry:{type:"Point",coordinates:[4.41,51.22]},properties:{GipodId:id,Description:"2000 Antwerpen, Teststraat : Buurtfeest Teststraat",Reference:"EV1",Type:"Evenement",PublicDomainOccupancyTypes:"Feest/kermis",Status:"Concreet gepland",Start:"2026-10-01T12:00:00Z",End:"2026-10-01T18:00:00Z",...overrides}});
test("query is begrensd",()=>{const u=new URL(gipodEventQueryUrl(NOW));assert.equal(u.searchParams.get("bbox"),"4.300791,51.175458,4.444331,51.313629");assert.equal(u.searchParams.get("filter"),"Type='Evenement' AND Status IN ('Concreet gepland','Lopende')");assert.equal(u.searchParams.get("datetime"),"2026-09-29T00:00:00Z/2026-10-29T00:00:00Z")});
test("allowlist is conservatief",()=>{assert.equal(classifyGipodEvent(event("100"),NOW).ok,true);assert.equal(classifyGipodEvent(event("101",{PublicDomainOccupancyTypes:"Markt"}),NOW).reason,"commercial_or_market");assert.equal(classifyGipodEvent(event("102",{PublicDomainOccupancyTypes:"Terras vast"}),NOW).reason,"commercial_or_market");assert.equal(classifyGipodEvent(event("103",{PublicDomainOccupancyTypes:"Andere",Description:"Parkeerplaatsen vrijhouden"}),NOW).reason,"not_explicit_event");assert.equal(classifyGipodEvent(event("104",{PublicDomainOccupancyTypes:"Andere",Description:"Carnavalstoet centrum"}),NOW).ok,true)});
test("punt buiten district valt weg",()=>assert.equal(classifyGipodEvent({...event("105"),geometry:{type:"Point",coordinates:[4.5,51.2]}},NOW).reason,"outside_district"));
test("adresprefix wordt locatie",()=>assert.deepEqual(eventLabels("2000 Antwerpen, Teststraat : Buurtfeest Teststraat","1"),{title:"Buurtfeest Teststraat",location:"2000 Antwerpen, Teststraat"}));
test("contactorganisaties lekken niet",()=>{const {items}=eventsFromGipod({features:[event("106",{ContactOrganisations:[{Email:"persoon@example.be"}]})]},{now:NOW});assert.equal(items.length,1);assert.equal(JSON.stringify(items).includes("@"),false);assert.equal(items[0].inDistrict,true)});
test("fetcher schrijft geldig document en nul events is gezond",async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),"gipod-events-"));const reply=features=>({ok:true,json:async()=>({type:"FeatureCollection",features,links:[]})});const status=await run({rootDir:root,clock:()=>NOW,fetch:async()=>reply([event("107")]),log:()=>{}});assert.deepEqual([status[0].fetchStatus,status[0].itemCount],["ok",1]);const doc=JSON.parse(fs.readFileSync(path.join(root,"site","sources","district-gipod-evenementen.json"),"utf8"));assert.deepEqual(validateSourceDocument(doc,{expectedSourceId:"district-gipod-evenementen"}),[]);const empty=await run({rootDir:root,clock:()=>NOW,fetch:async()=>reply([]),log:()=>{}});assert.deepEqual([empty[0].fetchStatus,empty[0].itemCount],["ok",0])});

test("speelstraat wordt alleen met concrete districtsstraat en maximaal 14 dagen aanvaard",()=>{
  const ok=event("108",{Description:"2000 Antwerpen, Teststraat : Speelstraat",PublicDomainOccupancyTypes:"Speelstraat",Start:"2026-10-01T08:00:00Z",End:"2026-10-05T18:00:00Z"});
  const parsed=classifyGipodEvent(ok,NOW);
  assert.equal(parsed.ok,true);
  assert.equal(parsed.playStreet,true);
  const {items,counts}=eventsFromGipod({features:[ok]},{now:NOW});
  assert.equal(items.length,1);
  assert.equal(items[0].title,"Speelstraat · Teststraat");
  assert.equal(items[0].location,"2000 Antwerpen, Teststraat");
  assert.match(items[0].info,/Publieke speelstraat volgens GIPOD/);
  assert.equal(counts.playStreets,1);
  assert.equal(classifyGipodEvent(event("109",{Description:"Speelstraat",PublicDomainOccupancyTypes:"Speelstraat"}),NOW).reason,"playstreet_missing_location");
  assert.equal(classifyGipodEvent(event("110",{Description:"2000 Antwerpen, Teststraat : Speelstraat",PublicDomainOccupancyTypes:"Speelstraat",Start:"2026-10-01T08:00:00Z",End:"2026-10-20T18:00:00Z"}),NOW).reason,"playstreet_duration");
});

test("fetcher volgt begrensde GIPOD-paginering op exact dezelfde collectie",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"gipod-events-pages-"));
  const calls=[];
  const fetchImpl=async url=>{
    calls.push(String(url));
    if(calls.length===1){
      const next=new URL(String(url));
      next.searchParams.set("cursor","page2");
      return{ok:true,status:200,json:async()=>({type:"FeatureCollection",features:[event("201")],links:[{rel:"next",href:next.href}]})};
    }
    return{ok:true,status:200,json:async()=>({type:"FeatureCollection",features:[event("202")],links:[]})};
  };
  const status=await run({rootDir:root,clock:()=>NOW,fetch:fetchImpl,log:()=>{}});
  assert.equal(status[0].fetchStatus,"ok");
  assert.equal(calls.length,2);
  assert.equal(new URL(calls[1]).searchParams.get("cursor"),"page2");
});

test("fetcher weigert een next-link naar een andere host",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"gipod-events-host-"));
  const fetchImpl=async()=>({ok:true,status:200,json:async()=>({type:"FeatureCollection",features:[event("203")],links:[{rel:"next",href:"https://evil.example/items?page=2"}]})});
  const status=await run({rootDir:root,clock:()=>NOW,fetch:fetchImpl,log:()=>{}});
  assert.equal(status[0].fetchStatus,"error");
  assert.equal(status[0].errorCode,"unexpected_pagination");
});
