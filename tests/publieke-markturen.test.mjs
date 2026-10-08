import test from "node:test";
import assert from "node:assert/strict";
import {publiekeMarktUur,MARKTENGIDS} from "../site/publieke-markturen.js";
import {readFile} from "node:fs/promises";
const market=(location,date,extra={})=>({sourceId:"stad-markten",inDistrict:true,location,date,...extra});
test("Falconplein: officiële bezoekersuren 9–16, ondanks GIPOD-inname vanaf 8 uur",()=>{
 const x=publiekeMarktUur(market("Falconplein, 2000 Antwerpen","2026-10-11",{timeSlot:"08:00",timeText:"8 tot 16 uur"}));
 assert.equal(x.start,"09:00");
 assert.equal(x.end,"16:00");
 assert.equal(x.bron,MARKTENGIDS);
 assert.match(x.status,/feestdagen/);
});
test("Oudevaartplaats zondag: 8–14 uur in zomertijd en 8–13 uur in wintertijd",()=>{
 assert.equal(publiekeMarktUur(market("Oudevaartplaats, 2000 Antwerpen","2026-10-11")).end,"14:00");
 assert.equal(publiekeMarktUur(market("Oudevaartplaats, 2000 Antwerpen","2026-10-25")).end,"13:00");
 assert.equal(publiekeMarktUur(market("Oudevaartplaats, 2000 Antwerpen","2026-11-01")).end,"13:00");
 assert.equal(publiekeMarktUur(market("Oudevaartplaats, 2000 Antwerpen","2026-10-17")).tekst,"8.00–16.00 uur");
});
test("zeven andere bevestigde locatie/weekdagcombinaties uit de stadsmarktengids",()=>{
 const checks=[
 ["Desguinlei","2026-10-09","11:30","16:30"],
 ["Sint-Jansplein","2026-10-14","08:00","13:00"],
 ["Sint-Jansplein","2026-10-16","08:00","13:00"],
 ["Dageraadplaats","2026-10-15","08:00","13:00"],
 ["Frederik van Eedenplein","2026-10-15","08:00","13:00"],
 ["Sint-Jansvliet","2026-10-11","09:00","17:00"]
 ];
 for(const [name,date,start,end] of checks){
  const x=publiekeMarktUur(market(name,date));
  assert.equal(x.start,start,name);
  assert.equal(x.end,end,name);
 }
});
test("andere districten, verkeerde marktdag of onbetrouwbare bron blijven ongemoeid",()=>{
 assert.equal(publiekeMarktUur(market("Falconplein","2026-10-11",{inDistrict:false})),null);
 assert.equal(publiekeMarktUur(market("Falconplein","2026-10-11",{sourceId:"andere-bron"})),null);
 assert.equal(publiekeMarktUur(market("Falconplein","2026-10-12")),null);
 assert.equal(publiekeMarktUur(market("Onbekende markt","2026-10-11")),null);
});
test("wekelijkse marktkaart en dagkaart vervangen innameuren alleen als stad marktuur bevestigt",async()=>{
 const src=await readFile(new URL("../site/place-view.js",import.meta.url),"utf8");
 assert.match(src,/publiekeMarktUur\(entry\.item\)/);
 assert.match(src,/publiekeMarktUur\(\{sourceId:"stad-markten"/);
 assert.match(src,/normale bezoekersuren stad/);
});
