import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DISTRICT_NEWS_MAX_PAGES,
  DISTRICT_NEWS_PAGE_SIZE,
  DISTRICT_NEWS_URL,
  districtNewsUrl,
  run,
} from "../scripts/fetch-sources-district-news.mjs";

const json=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
const article=(id)=>({
  id,
  slug:`nieuws-${id.slice(-4)}`,
  title:"Nieuws zonder datum",
  publishedAt:"2026-09-20T08:00:00+00:00",
  publishUntil:"2027-12-31T22:00:00+00:00",
  snippets:[{type:"wysiwyg",body:{text:"<p>Gewoon nieuws.</p>"}}],
});

test("eerste URL blijft compatibel en vervolgpagina gebruikt start-offset",()=>{
  assert.equal(DISTRICT_NEWS_URL,districtNewsUrl());
  assert.equal(new URL(DISTRICT_NEWS_URL).searchParams.get("start"),"0");
  assert.equal(new URL(districtNewsUrl({start:25})).searchParams.get("start"),"25");
  assert.equal(DISTRICT_NEWS_PAGE_SIZE,25);
  assert.equal(DISTRICT_NEWS_MAX_PAGES,8);
});

test("districtsnieuws haalt een tweede pagina als de eerste vol is",async(t)=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"district-news-pages-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,"site","sources"),{recursive:true});
  const requested=[];
  const first=Array.from({length:DISTRICT_NEWS_PAGE_SIZE},(_,index)=>article((index+1).toString(16).padStart(24,"0")));
  const fetch=async url=>{
    const parsed=new URL(String(url));requested.push(parsed.href);
    const start=Number(parsed.searchParams.get("start")||0);
    if(start===0)return json({data:first});
    if(start===DISTRICT_NEWS_PAGE_SIZE)return json({data:[article("ffffffffffffffffffffffff")]});
    return json({data:[]});
  };
  const [status]=await run({rootDir:root,clock:()=>new Date("2026-09-30T00:00:00Z"),fetch,log:()=>{}});
  assert.equal(status.fetchStatus,"ok");
  assert.equal(requested.length,2);
  assert.equal(new URL(requested[1]).searchParams.get("start"),String(DISTRICT_NEWS_PAGE_SIZE));
});

test("acht volledig gevulde pagina's falen gesloten als pagination_limit",async(t)=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"district-news-limit-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,"site","sources"),{recursive:true});
  let calls=0;
  const fetch=async()=>{
    const offset=calls++*DISTRICT_NEWS_PAGE_SIZE;
    return json({data:Array.from({length:DISTRICT_NEWS_PAGE_SIZE},(_,index)=>article((offset+index+1).toString(16).padStart(24,"0")))});
  };
  const [status]=await run({rootDir:root,clock:()=>new Date("2026-09-30T00:00:00Z"),fetch,log:()=>{}});
  assert.equal(status.fetchStatus,"error");
  assert.equal(status.errorCode,"pagination_limit");
  assert.equal(calls,DISTRICT_NEWS_MAX_PAGES);
});
