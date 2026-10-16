import test from "node:test";
import assert from "node:assert/strict";
import { getHtml } from "../lib/ebesluit-discovery.mjs";
const url="https://ebesluit.antwerpen.be/zoeken?query=markt";
const reply=(status,body="")=>new Response(body,{status,headers:{"content-type":"text/html"}});
test("tijdelijke eBesluit 500 wordt één keer opnieuw geprobeerd, daarna werkt de bron",async()=>{
 const statuses=[500,200];let count=0,wacht=0;
 const html=await getHtml(async()=>{count++;return reply(statuses.shift(),"<p>Openbaar besluit</p>")},url,{retryDelayMs:10,sleepImpl:async ms=>{wacht=ms}});
 assert.equal(html,"<p>Openbaar besluit</p>");
 assert.equal(count,2);assert.equal(wacht,10);
});
test("een aanhoudende HTTP 500 mislukt na precies twee pogingen, zonder eindeloze reeks",async()=>{
 let count=0;
 await assert.rejects(getHtml(async()=>{count++;return reply(500)},url,{retryDelayMs:0,sleepImpl:async()=>{}}),/http_500/);
 assert.equal(count,2);
});
test("een blijvende 404 wordt niet herhaald, eerdere fail-closed bron blijft gelden",async()=>{
 let count=0;
 await assert.rejects(getHtml(async()=>{count++;return reply(404)},url,{retryDelayMs:0,sleepImpl:async()=>{}}),/http_404/);
 assert.equal(count,1);
});
test("ook gateway 502/504 worden maar één keer geprobeerd, goede respons niet",async()=>{
 for(const code of [502,503,504]){
  let calls=0;
  await assert.rejects(getHtml(async()=>{calls++;return reply(code)},url,{retryDelayMs:0,sleepImpl:async()=>{}}),new RegExp("http_"+code));
  assert.equal(calls,2);
 }
 let calls=0;const result=await getHtml(async()=>{calls++;return reply(200,"goed")},url,{sleepImpl:async()=>{throw Error("unexpected wait")}});
 assert.equal(result,"goed");assert.equal(calls,1);
});
