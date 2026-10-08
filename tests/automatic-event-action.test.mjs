import test from "node:test";
import assert from "node:assert/strict";
import {eventAction,enrichActions} from "../lib/automatic-event-action.mjs";
import {sourceDocument,validateSourceDocument} from "../lib/source-feed.mjs";
import {bezoekersLinks} from "../site/bezoekers-bronnen.js";
const info="https://www.antwerpen.be/info/69bcf7a1ff0ca8917752fe74/vrijdagen-van-de-poezie-in-districtshuis-harmonie";
const ev=(date,title="Vrijdagen van de Poëzie")=>({id:"district-kal-0123456789abcdef01234567-"+date,externalId:"0123456789abcdef01234567",title,theme:"Activiteit",className:"activity",date,endDate:null,timeSlot:"15:00",timeText:"15 tot 16 uur",location:"Harmoniepark 1",postcodes:["2018"],info:"",infoUrl:info,kind:"activity",sourceUrl:"https://www.antwerpen.be/info/5efb0477b118f7b19c627b69/wat-beleef-je-in-district-antwerpen",retrievedAt:"2026-10-08T11:00:00.000Z",reviewRequired:false});
const html=['<h1>Vrijdagen van de Poëzie</h1><h2>23 oktober</h2>','<a href="https://cid.recreatex.be/Tickets/Detail.aspx?code=CID-STA-20261023&amp;language=NL">Tickets</a>','<h2>20 november</h2>','<a href="https://cid.recreatex.be/Tickets/Detail.aspx?code=CID-STA-20261120">Tickets</a>'].join("");
test("één eventpagina geeft de juiste Recreatex-ticketcode per exacte datum",()=>{
 assert.deepEqual(eventAction(html,ev("2026-10-23")),{checked:true,kind:"ticket",code:"CID-STA-20261023"});
 assert.deepEqual(eventAction(html,ev("2026-11-20")),{checked:true,kind:"ticket",code:"CID-STA-20261120"});
 assert.equal(eventAction(html,ev("2026-12-18")).checked,false);
 assert.equal(eventAction(html,ev("2026-10-23","Andere voorstelling")).checked,false);
});
test("mail en tickets aan infostand worden zonder persoonsgegevens geclassificeerd",()=>{
 const a=eventAction("<h1>Verlangen naar verbinding</h1><p>10 november 2026</p><p>Inschrijven via mail aan district.antwerpen@antwerpen.be</p>",ev("2026-11-10","Verlangen naar verbinding"));
 assert.deepEqual(a,{checked:true,kind:"email_district"});
 assert.doesNotMatch(JSON.stringify(a),/@/);
 assert.equal(eventAction("<h1>Halloweenfeest</h1><p>31 oktober 2026</p><p>Gratis tickets aan de infostand</p>",ev("2026-10-31","Halloweenfeest")).kind,"onsite");
});
test("officiële redirect en één aanvraag per gedeelde pagina, oude actie vervalt",async()=>{
 const first="https://www.antwerpen.be/nl/overzicht/district-antwerpen-1/cultuur/vrijdagen-poezie";
 let calls=0;
 const fake=async(url)=>{calls++;return url===first?{status:301,headers:{get:k=>k==="location"?info:null}}:{status:200,ok:true,headers:{get:k=>k==="content-type"?"text/html":null},text:async()=>html}};
 const out=await enrichActions([{...ev("2026-10-23"),infoUrl:first},{...ev("2026-11-20"),infoUrl:first},{...ev("2026-12-18"),infoUrl:"https://facebook.com/a",actionChecked:true,actionKind:"ticket",actionCode:"CID-STA-20261218"}],{fetchImpl:fake});
 assert.equal(calls,2);
 assert.equal(out[0].actionCode,"CID-STA-20261023");
 assert.equal(out[1].actionCode,"CID-STA-20261120");
 assert.equal(out[2].actionKind,undefined);
});
test("externe bronnen worden nooit automatisch bezocht",async()=>{
 let calls=0;const out=await enrichActions([{...ev("2026-10-23"),infoUrl:"https://evil.example/a"}],{fetchImpl:async()=>{calls++;throw Error("bad")}});
 assert.equal(calls,0);assert.equal(out[0].actionChecked,undefined);
});
test("ticketstatus met datumgebonden code valideert contract en wordt publiekslink",()=>{
 const x={...ev("2026-10-23"),actionChecked:true,actionKind:"ticket",actionCode:"CID-STA-20261023"};
 const doc=sourceDocument("district-kalender",{retrievedAt:x.retrievedAt,fetchStatus:"ok",items:[x]});
 assert.deepEqual(validateSourceDocument(doc),[]);
 const links=bezoekersLinks({source:"agenda",url:x.infoUrl,sourceUrl:x.sourceUrl,item:{...x,sourceId:"district-kalender"}});
 assert.ok(links.some(a=>a.label.includes("Tickets")&&a.url.includes("CID-STA-20261023")));
 const bad=sourceDocument("district-kalender",{retrievedAt:x.retrievedAt,fetchStatus:"ok",items:[{...x,actionCode:"CID-STA-20261120"}]});
 assert.ok(validateSourceDocument(bad).some(e=>/actionCode/.test(e)));
});
