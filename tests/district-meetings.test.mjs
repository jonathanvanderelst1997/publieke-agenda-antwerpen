import assert from "node:assert/strict";import fs from "node:fs";import os from "node:os";import path from "node:path";import test from "node:test";import { parseDistrictMeetingPage, parseMeetingDates } from "../lib/district-meetings.mjs";
import { ebesluitMeetingMonthUrls, parseEbesluitMeetingCalendar } from "../lib/ebesluit-meetings.mjs";import { validateSourceDocument } from "../lib/source-feed.mjs";import { run } from "../scripts/fetch-sources-district-meetings.mjs";
const table=`<p><strong>Data districtsraden en raadscommissies 2026</strong></p><table><tr><th>Data algemene raadscommissie</th><th>Data districtsraad</th><th>Data bijzondere raadscommissies</th></tr><tr><td>maandag 12 oktober</td><td>maandag 19 oktober</td><td>dinsdag 13 oktober en woensdag 14 oktober</td></tr><tr><td>maandag 9 november</td><td>maandag 16 november</td><td>woensdag 18 november</td></tr></table>`;const page={currentVersion:"v1",updatedAt:"2026-09-20T10:00:00Z",snippets:[{id:"abc123def456",type:"wysiwyg",body:{text:table}}]};const response=(json,status=200)=>({ok:status>=200&&status<300,status,json:async()=>json});
test("jaartabel levert raad en commissies",()=>{const p=parseDistrictMeetingPage(page);assert.equal(p.year,2026);assert.deepEqual(p.issues,[]);assert.deepEqual(p.items.map(i=>[i.title,i.date]),[["Algemene raadscommissie Antwerpen","2026-10-12"],["Bijzondere raadscommissie Antwerpen","2026-10-13"],["Bijzondere raadscommissie Antwerpen","2026-10-14"],["Districtsraad Antwerpen","2026-10-19"],["Algemene raadscommissie Antwerpen","2026-11-09"],["Districtsraad Antwerpen","2026-11-16"],["Bijzondere raadscommissie Antwerpen","2026-11-18"]])});
test("weekdagfout wordt niet gegokt",()=>{const p=parseMeetingDates("dinsdag 12 oktober",2026);assert.deepEqual(p.dates,[]);assert.equal(p.issues[0].code,"weekday_mismatch")});
test("ontbrekende planning faalt gesloten",()=>assert.equal(parseDistrictMeetingPage({snippets:[{type:"wysiwyg",body:{text:"<p>Geen planning</p>"}}]}).items.length,0));
test("fetcher schrijft toekomstige vergaderdata",async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),"district-meetings-"));const s=await run({rootDir:root,clock:()=>new Date("2026-10-10T08:00:00Z"),fetch:async()=>response(page),log:()=>{}});assert.deepEqual([s[0].fetchStatus,s[0].itemCount],["ok",7]);const doc=JSON.parse(fs.readFileSync(path.join(root,"site","sources","district-vergaderingen.json"),"utf8"));assert.deepEqual(validateSourceDocument(doc,{expectedSourceId:"district-vergaderingen"}),[])});

test("meerdere jaartabellen gebruiken elk hun eigen jaartal",()=>{
  const parsed=parseDistrictMeetingPage({snippets:[{type:"wysiwyg",body:{text:"<p><strong>Data districtsraden en raadscommissies 2026</strong></p><table><tr><th>Data algemene raadscommissie</th><th>Data districtsraad</th></tr><tr><td>maandag 9 november</td><td>maandag 16 november</td></tr></table><p><strong>Data districtsraden en raadscommissies 2027</strong></p><table><tr><th>Data algemene raadscommissie</th><th>Data districtsraad</th></tr><tr><td>maandag 11 januari</td><td>maandag 18 januari</td></tr></table>"}}]});
  assert.deepEqual(parsed.years,[2026,2027]);
  assert.equal(parsed.year,2027);
  assert.deepEqual(parsed.items.map(item=>item.date),["2026-11-09","2026-11-16","2027-01-11","2027-01-18"]);
});

const calendarHtml=`<section><a href="/zittingen/26.1001.0001.0001">districtscollege Antwerpen ma 05/10/2026 - 13:30 Districtshuis Antwerpen - Zaal Christy</a><a href="/zittingen/26.1001.0001.0002">raadscommissie Antwerpen ma 12/10/2026 - 20:00 Provinciehuis Antwerpen</a><a href="/zittingen/26.1001.0001.0003">Bijzondere raadscommissie cultuur, evenementen en feestelijkheden, sport di 13/10/2026 - 20:00 Districtshuis Antwerpen - Zaal Benoit</a><a href="/zittingen/26.1001.0001.0004">districtsraad Antwerpen ma 19/10/2026 - 20:00 Provinciehuis Antwerpen</a></section>`;
test("eBesluit-kalender laat alleen openbare vergaderingen van district Antwerpen door",()=>{const items=parseEbesluitMeetingCalendar(calendarHtml);assert.deepEqual(items.map(item=>[item.title,item.date,item.timeSlot]),[["Raadscommissie Antwerpen","2026-10-12","20:00"],["Bijzondere raadscommissie cultuur, evenementen en feestelijkheden, sport","2026-10-13","20:00"],["Districtsraad Antwerpen","2026-10-19","20:00"]])});
test("eBesluit-maandurls gebruiken expliciet month/year",()=>assert.deepEqual(ebesluitMeetingMonthUrls(new Date("2026-09-30T08:00:00Z"),2),["https://ebesluit.antwerpen.be/zittingen/lijst?month=09&year=2026","https://ebesluit.antwerpen.be/zittingen/lijst?month=10&year=2026"]));
test("fetcher valt terug op eBesluit wanneer de oude jaartabel verdwenen is",async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),"district-meetings-fallback-"));const noSchedule={currentVersion:"v2",updatedAt:"2026-09-30T08:00:00Z",snippets:[{type:"wysiwyg",body:{text:"<p>Geen planning</p>"}}]};const fetch=async url=>String(url).includes("page-content-by-uuid")?response(noSchedule):{ok:true,status:200,text:async()=>calendarHtml};const s=await run({rootDir:root,clock:()=>new Date("2026-09-30T08:00:00Z"),fetch,log:()=>{},sleep:async()=>{}});assert.deepEqual([s[0].fetchStatus,s[0].itemCount],["ok",3]);const doc=JSON.parse(fs.readFileSync(path.join(root,"site","sources","district-vergaderingen.json"),"utf8"));assert.deepEqual(validateSourceDocument(doc,{expectedSourceId:"district-vergaderingen"}),[]);assert.ok(doc.items.every(item=>item.sourceUrl.startsWith("https://ebesluit.antwerpen.be/")))});

import { sourceHealthOf, isTransientErrorCode } from "../lib/fetch-util.mjs";
import { EBESLUIT_PAGE_GAP_MS, EBESLUIT_RETRY_DELAYS_MS } from "../lib/ebesluit-meetings.mjs";
const noScheduleEbesluit={currentVersion:"v2",updatedAt:"2026-09-30T08:00:00Z",snippets:[{type:"wysiwyg",body:{text:"<p>Geen planning</p>"}}]};
test("eBesluit: een 503 op één maandpagina wordt opnieuw geprobeerd, met pauzes tussen de pagina's",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"district-meetings-retry-"));
  let failures=1;const waits=[];
  const fetch=async url=>{if(String(url).includes("page-content-by-uuid"))return response(noScheduleEbesluit);if(String(url).includes("month=11")&&failures>0){failures-=1;return{ok:false,status:503,text:async()=>""}}return{ok:true,status:200,text:async()=>calendarHtml}};
  const s=await run({rootDir:root,clock:()=>new Date("2026-09-30T08:00:00Z"),fetch,log:()=>{},sleep:async ms=>{waits.push(ms)}});
  assert.equal(s[0].fetchStatus,"ok");
  assert.ok(waits.includes(EBESLUIT_RETRY_DELAYS_MS[0]),"wacht voor de nieuwe poging");
  assert.equal(waits.filter(ms=>ms===EBESLUIT_PAGE_GAP_MS).length,12,"pauze tussen de 13 maandpagina's");
});
test("eBesluit blijft 503 geven: vorige data blijft, de bron is stale en geen fout zolang ze binnen 48 uur valt",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"district-meetings-503-"));
  const ok=await run({rootDir:root,clock:()=>new Date("2026-09-30T08:00:00Z"),fetch:async url=>String(url).includes("page-content-by-uuid")?response(noScheduleEbesluit):{ok:true,status:200,text:async()=>calendarHtml},log:()=>{},sleep:async()=>{}});
  assert.equal(ok[0].itemCount,3);
  let calls=0;
  const s=await run({rootDir:root,clock:()=>new Date("2026-10-01T08:00:00Z"),fetch:async url=>{if(String(url).includes("page-content-by-uuid"))return response(noScheduleEbesluit);calls+=1;return{ok:false,status:503,text:async()=>""}},log:()=>{},sleep:async()=>{}});
  assert.deepEqual([s[0].fetchStatus,s[0].errorCode,s[0].itemCount],["error","http_503",3]);
  assert.equal(calls,1+EBESLUIT_RETRY_DELAYS_MS.length,"drie pogingen, dan opgeven");
  const entry={...s[0],maxAgeHours:48};
  assert.equal(sourceHealthOf(entry,Date.parse("2026-10-01T09:00:00Z")),"stale");
  assert.equal(sourceHealthOf(entry,Date.parse("2026-10-02T09:00:00Z")),"error","vorige data ouder dan 48 uur: wel een fout");
});
test("tijdelijk of blijvend: alleen 5xx, 429, time-out en netwerk zijn tijdelijk",()=>{
  for(const code of ["http_503","http_502","http_429","timeout","network_error","source_timeout","refresh_budget_exhausted","channel_http_503"])assert.equal(isTransientErrorCode(code),true,code);
  for(const code of ["http_404","suspicious_drop","no_list","invalid_json","no_schedule",null])assert.equal(isTransientErrorCode(code),false,String(code));
  const at=Date.parse("2026-10-05T12:00:00Z");
  assert.equal(sourceHealthOf({fetchStatus:"error",errorCode:"suspicious_drop",retrievedAt:"2026-10-05T10:00:00Z",maxAgeHours:48},at),"error");
  assert.equal(sourceHealthOf({fetchStatus:"ok",retrievedAt:"2026-10-02T10:00:00Z",maxAgeHours:48},at),"expired");
  assert.equal(sourceHealthOf({fetchStatus:"skipped_no_key",retrievedAt:null,maxAgeHours:48},at),"inactive");
});
