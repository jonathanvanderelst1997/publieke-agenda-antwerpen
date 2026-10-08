import test from "node:test";
import assert from "node:assert/strict";
import {enrichActions} from "../lib/automatic-event-action.mjs";
import {sourceDocument,validateSourceDocument} from "../lib/source-feed.mjs";
import {bezoekersLinks,bezoekersHint} from "../site/bezoekers-bronnen.js";
const item=(date="2026-10-23")=>({
 id:"district-kal-0123456789abcdef01234567-"+date,externalId:"0123456789abcdef01234567",
 title:"Vrijdagen van de Poëzie",theme:"Activiteit",className:"activity",date,endDate:null,timeSlot:"15:00",
 timeText:"15 tot 16 uur",location:"Harmonie",postcodes:["2018"],info:"",
 infoUrl:"https://www.antwerpen.be/nl/overzicht/district-antwerpen-1/cultuur/vrijdagen-van-de-poezie-in-districtshuis-harmonie",
 kind:"activity",sourceUrl:"https://www.antwerpen.be/info/5efb0477b118f7b19c627b69/wat-beleef-je-in-district-antwerpen",
 retrievedAt:"2026-10-08T11:00:00.000Z",reviewRequired:false
});
const toEntry=i=>({source:"agenda",url:i.infoUrl,sourceUrl:i.sourceUrl,item:{...i,sourceId:"district-kalender"}});
test("verdwenen detailpagina laat GEEN oude datumgecodeerde ticketlink terugkeren",async()=>{
 const old={...item(),actionChecked:true,actionKind:"ticket",actionCode:"CID-STA-20261023"};
 const [current]=await enrichActions([old],{fetchImpl:async()=>({status:404,ok:false,headers:{get:()=>null}})});
 assert.equal(current.actionAttempted,true);
 assert.equal(current.actionChecked,undefined);
 assert.equal(current.actionKind,undefined);
 const links=bezoekersLinks(toEntry(current));
 assert.equal(links.some(x=>x.label.includes("Tickets")||x.url.includes("CID-STA-20261023")),false);
 assert.match(links[0].label,/Officiële informatie/);
 assert.match(bezoekersHint(toEntry(current)),/niet bevestigd/);
});
test("maximumbudget overschreden: niet verwerkte eventpagina levert evenmin een verouderde ticketknop",async()=>{
 let calls=0;
 const [current]=await enrichActions([item()],{limit:0,fetchImpl:async()=>{calls++;throw Error("mag niet")}});
 assert.equal(calls,0);
 assert.equal(current.actionAttempted,true);
 assert.equal(bezoekersLinks(toEntry(current)).some(x=>/Tickets/.test(x.label)),false);
});
test("gecontroleerde status klopt in privacycontract en mag niet op false worden ingesteld",()=>{
 const good={...item(),actionAttempted:true};
 const source=sourceDocument("district-kalender",{retrievedAt:good.retrievedAt,fetchStatus:"ok",items:[good]});
 assert.deepEqual(validateSourceDocument(source),[]);
 const bad=sourceDocument("district-kalender",{retrievedAt:good.retrievedAt,fetchStatus:"ok",items:[{...good,actionAttempted:false}]});
 assert.ok(validateSourceDocument(bad).some(e=>/actionAttempted/.test(e)));
});
test("voor de eerste automatische bronronde blijven eerder gecontroleerde links beschikbaar",()=>{
 const data=item();
 const links=bezoekersLinks(toEntry(data));
 assert.ok(links.some(x=>x.url.includes("CID-STA-20261023")&&x.label.includes("Tickets")));
});
