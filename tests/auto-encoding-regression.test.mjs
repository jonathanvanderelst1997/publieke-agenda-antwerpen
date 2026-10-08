import test from "node:test";
import assert from "node:assert/strict";
import {enrichActions} from "../lib/automatic-event-action.mjs";

test("officiële stadspagina via ongecomprimeerde HTML, volledige titel- en datumcontrole blijft vereist",async()=>{
  const item={id:"tabletcafe-2026-10-23",title:"Tabletcafé",date:"2026-10-23",infoUrl:"https://www.antwerpen.be/nl/overzicht/district-antwerpen-1/senioren/tabletcafe-voor-senioren"};
  let requests=0;
  const fetchImpl=async (_url,options)=>{
    requests++;
    assert.equal(options.redirect,"manual");
    assert.equal(options.headers.accept,"text/html");
    assert.equal(options.headers["accept-encoding"],"identity");
    return {status:200,ok:true,headers:{get:name=>name==="content-type"?"text/html; charset=utf-8":null},
      text:async()=>"<h1>Tabletcafé voor senioren</h1><p>Vrijdag 23 oktober 2026, vooraf inschrijven via mail aan district.antwerpen@antwerpen.be.</p>"};
  };
  const result=await enrichActions([item],{fetchImpl});
  assert.equal(requests,1);
  assert.equal(result[0].actionChecked,true);
  assert.equal(result[0].actionKind,"email_district");
});

test("ongecomprimeerde HTTP-respons geeft nooit inschrijving voor verkeerde dag",async()=>{
  const item={id:"tabletcafe-2026-11-27",title:"Tabletcafé",date:"2026-11-27",infoUrl:"https://www.antwerpen.be/nl/overzicht/district-antwerpen-1/senioren/tabletcafe-voor-senioren"};
  const out=await enrichActions([item],{fetchImpl:async(_url,options)=>{
    assert.equal(options.headers["accept-encoding"],"identity");
    return {status:200,ok:true,headers:{get:()=>null},
      text:async()=>"<h1>Tabletcafé</h1><p>23 oktober 2026: Inschrijven via mail aan district.antwerpen@antwerpen.be.</p>"};
  }});
  assert.equal(out[0].actionChecked,undefined);
  assert.equal(out[0].actionKind,undefined);
  assert.equal(out[0].actionAttempted,true);
});
