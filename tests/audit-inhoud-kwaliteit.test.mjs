import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {controleerAgendaInhoud,technischeLink} from "../scripts/audit-inhoud-kwaliteit.mjs";
const event=(x={})=>({id:"A",sourceId:"district-kalender",date:"2026-10-14",endDate:null,title:"Trefdag",location:"Grote Markt",
  sourceUrl:"https://www.antwerpen.be/info/abc",link:"https://www.antwerpen.be/info/abc",timeText:"12 uur",timeSlot:"12:00",...x});
const data=items=>({feed:{classificationAsOf:"2026-10-13",items},werken:{werken:{}},status:{sources:[{fetchStatus:"ok"}]}});
test("dubbel of ongeldig blokkeert, lopend meerdaags item telt mee",()=>{
 let r=controleerAgendaInhoud(data([event({date:"2026-09-01",endDate:"2026-11-01"})]));assert.equal(r.ok,true);assert.equal(r.metrieken.toekomstig,1);
 r=controleerAgendaInhoud(data([event({date:"2026-02-31",sourceUrl:""}),event()]));assert.equal(r.ok,false);
 assert.ok(r.fouten.some(x=>/dubbele/.test(x)));assert.ok(r.fouten.some(x=>/datum/.test(x)));
});
test("technische links en onbekende tijd worden gemeten, nooit verzonnen",()=>{
 const i=event({sourceId:"district-asign-evenementen",title:"naam onbekend",timeText:"",
   sourceUrl:"https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/22"});
 const r=controleerAgendaInhoud(data([i]));assert.equal(r.ok,true);
 assert.equal(r.metrieken.technischeLinkZonderBezoekerslink,1);
 assert.equal(r.metrieken.onbekendeUren,1);assert.equal(r.metrieken.onzekereTitels,1);
 assert.equal(technischeLink("https://www.antwerpen.be/info/foo"),false);
});
test("bronfouten en ontbrekende werksoort zijn aandachtspunten, geen nieuwe persoonsgegevens",()=>{
 const d=data([event()]);d.status.sources=[{fetchStatus:"error"},{fetchStatus:"skipped_no_key"}];
 d.werken.werken={x:{omschrijving:"",soort:"",huisnummerBron:"afgeleid uit de werfzone"}};
 const r=controleerAgendaInhoud(d);assert.equal(r.ok,true);assert.equal(r.metrieken.bronFouten,1);
 assert.equal(r.metrieken.indicatieveNummerbereiken,1);assert.equal(r.metrieken.werkenZonderOmschrijving,1);
});
test("de reeds bestaande dagelijkse controle gebruikt de nieuwe scanner",()=>{
 const pkg=JSON.parse(fs.readFileSync(new URL("../package.json",import.meta.url),"utf8"));
 assert.match(pkg.scripts.check,/audit:events/);
 const script=fs.readFileSync(new URL("../scripts/audit-events.mjs",import.meta.url),"utf8");
 assert.match(script,/controleerAgendaInhoud\(leesInhoudBronnen\(root\)\)/);
});
