import test from "node:test";
import assert from "node:assert/strict";
import { analyseerWerkHistoriek, samenvattingWerkHistoriek } from "../site/werk-historiek.js";
const index={lastObservedAt:"2026-10-13T07:00:00Z"};
const baseline={layers:{works:{observedAt:"2026-10-01T05:00:00Z",items:[{id:"work:17190864"}]}}};
const dagen=[
 {events:[{layer:"works",id:"work:17190864",observedAt:"2026-10-07T07:00:00Z",type:"changed"},{layer:"works",id:"work:17190864",observedAt:"2026-10-08T07:00:00Z",type:"removed"}]},
 {events:[{layer:"works",id:"work:17190864",observedAt:"2026-10-10T07:00:00Z",type:"added"},{layer:"works",id:"work:17190864",observedAt:"2026-10-12T07:00:00Z",type:"changed"}]},
];
test("dossier al aanwezig bij eerste archiefmeting blijft minstens die datum hebben",()=>{
 const r=analyseerWerkHistoriek("work:17190864",index,baseline,dagen);
 assert.equal(r.gevonden,true);assert.equal(r.inBaseline,true);
 assert.equal(r.eerste,"2026-10-01T05:00:00Z");
 assert.equal(r.sessieSinds,"2026-10-10T07:00:00Z");
 assert.equal(r.wijzigingen,2);assert.equal(r.verdwenen,1);
 assert.match(samenvattingWerkHistoriek(r),/niet de echte startdatum/);
});
test("eerste toevoeging na baseline is alleen de eerste waarneming",()=>{
 const id="work:17555555";
 const r=analyseerWerkHistoriek(id,index,baseline,[{events:[{layer:"works",id,observedAt:"2026-10-11T07:00:00Z",type:"added"}]}]);
 assert.equal(r.inBaseline,false);assert.equal(r.eerste,"2026-10-11T07:00:00Z");
});
test("verwijderd en niet opnieuw verschenen is niet actief verklaard",()=>{
 const r=analyseerWerkHistoriek("work:17190864",index,baseline, dagen.slice(0,1));
 assert.equal(r.verwijderd,true);
 assert.match(samenvattingWerkHistoriek(r),/verwijdering uit de bron/);
});
test("geen aantoonbaar dossier of ongeldig id geeft geen startdatum",()=>{
 assert.equal(analyseerWerkHistoriek("work:88888",index,baseline,[]).gevonden,false);
 assert.equal(analyseerWerkHistoriek("https://example.com",index,baseline,[]).fout,true);
 assert.match(samenvattingWerkHistoriek(analyseerWerkHistoriek("work:88888",index,baseline,[])),/bewijst niet/);
});
test("beperkt historisch venster wordt expliciet vermeld",()=>{
 const r=analyseerWerkHistoriek("work:17190864",index,baseline, dagen);
 assert.match(samenvattingWerkHistoriek(r,{ingekort:true}),/recentste 90 wijzigingsdagen/);
});
