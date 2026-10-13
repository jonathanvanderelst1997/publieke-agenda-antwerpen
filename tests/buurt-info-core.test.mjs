import test from "node:test";
import assert from "node:assert/strict";
import { radarVoorStraat } from "../site/buurt-info-core.js";
const straat = { id:"101", name:"Bredastraat", postcode:"2000" };
const nu = Date.parse("2026-10-13T12:00:00Z");
const radar = {
  ververst:"2026-10-13T09:00:00Z",
  runs:["2026-10-12T09:00:00Z","2026-10-13T09:00:00Z"],
  lagen:{ works:{status:"ok"}, publicSpace:{status:"ok"} },
  straten:{"101|Bredastraat|2000":[[0,2,1,0],[1,1,3,2]]},
};
test("telt de waarnemingen van de officiële straat correct", () => {
  const a=radarVoorStraat(radar,straat,{nu});
  assert.equal(a.status,"ok");
  assert.deepEqual([a.nieuw,a.gewijzigd,a.afgelopen],[3,4,2]);
  assert.match(a.periodenoot,/laatste 7 dagen/);
});
test("onbekende straat is nul wijzigingen maar niet nul werken", () => {
  const a=radarVoorStraat(radar,{id:"201",name:"Zonderstraat",postcode:"2000"},{nu});
  assert.equal(a.status,"ok");assert.deepEqual([a.nieuw,a.gewijzigd,a.afgelopen],[0,0,0]);
});
test("afwezige, onvolledige en oude bronnen zijn niet betrouwbaar", () => {
  assert.equal(radarVoorStraat(null,straat,{nu}).status,"onbeschikbaar");
  assert.equal(radarVoorStraat({...radar,lagen:{works:{status:"stale"},publicSpace:{status:"ok"}}},straat,{nu}).status,"gedeeltelijk");
  assert.equal(radarVoorStraat({...radar,ververst:"2026-10-10T09:00:00Z"},straat,{nu}).status,"verouderd");
});
test("ingekorte radar noemt alleen het beschikbare venster en negeert foute tellingen", () => {
  const a=radarVoorStraat({...radar,ingekort:true,straten:{"101|Bredastraat|2000":[[0,-1,2,1],[99,100,100,100]]}},straat,{nu});
  assert.equal(a.nieuw,0);assert.equal(a.gewijzigd,2);assert.equal(a.afgelopen,1);
  assert.match(a.periodenoot,/ingekort/);
});
