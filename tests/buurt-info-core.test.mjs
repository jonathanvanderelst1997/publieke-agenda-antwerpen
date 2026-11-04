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

// In je buurt (wens van de eigenaar van 4-11-2026): evenementen en feesten tot ongeveer 500 m rond de straat, en nieuws
// van het district dat de straat of de wijk noemt. Alleen publieke agendapunten; een punt zonder plek wordt nooit gegokt.
import { afstandTotKader, inJeBuurt, noemtPlek } from "../site/buurt-info-core.js";

const proef = { id: "990001", name: "Proefstraat", postcode: "2000", box: [4.4000, 51.2200, 4.4010, 51.2210] };
const punten = { dichtbij: [4.4030, 51.2205], ver: [4.4300, 51.2400], erin: [4.4005, 51.2205] };
const punt = (item) => punten[item.plek] || null;
const ev = (id, extra = {}) => ({ id, title: `Feest ${id}`, date: "2026-11-10", category: "neighborhood", location: "Ergens", sourceId: "district-kalender", ...extra });

test("afstand tot het kader van de straat en een naam als geheel", () => {
  assert.equal(afstandTotKader(punten.erin, proef.box), 0);
  const d = afstandTotKader(punten.dichtbij, proef.box);
  assert.ok(d > 100 && d < 200, String(d));
  assert.equal(afstandTotKader(null, proef.box), Infinity);
  assert.equal(noemtPlek("Heraanleg Proefstraat, fase 2", "proefstraat"), true);
  assert.equal(noemtPlek("Proefstraatje", "Proefstraat"), false, "niet midden in een woord");
  assert.equal(noemtPlek("Kielpark", "Kiel"), false);
});

test("inJeBuurt: alleen komende evenementen met een gekende plek tot 500 m, niet de straat zelf, gesorteerd", () => {
  const items = [
    ev("a", { plek: "dichtbij", date: "2026-11-12" }),
    ev("b", { plek: "dichtbij", date: "2026-11-06" }),
    ev("c", { plek: "ver" }),
    ev("d"), // geen plek: nooit gegokt
    ev("e", { plek: "erin", location: "Proefstraat, 2000 Antwerpen" }), // in de straat zelf: staat al in de lijst
    ev("f", { plek: "dichtbij", date: "2026-11-01" }), // voorbij
    ev("g", { plek: "dichtbij", date: "2027-03-01" }), // later dan 60 dagen
    ev("h", { plek: "dichtbij", category: "works" }), // geen evenement
    ev("i", { plek: "dichtbij", date: "2026-10-20", endDate: "2026-11-30" }), // loopt nog
    ev("j", { plek: "dichtbij", noEventPage: true, link: "https://www.voorbeeld.be/feest" }),
  ];
  const { evenementen } = inJeBuurt({ items, straat: proef, punt, vandaag: "2026-11-04" });
  assert.deepEqual(evenementen.map((k) => k.id), ["i", "b", "j", "a"]);
  assert.equal(evenementen[1].link, "/event/b/");
  assert.equal(evenementen.find((k) => k.id === "j").link, "https://www.voorbeeld.be/feest");
  assert.ok(evenementen.every((k) => k.afstand >= 50 && k.afstand % 50 === 0));
  assert.deepEqual(inJeBuurt({ items, straat: null, punt, vandaag: "2026-11-04" }), { evenementen: [], nieuws: [] });
});

test("inJeBuurt: nieuws van het district dat de straat of de wijk noemt", () => {
  const items = [
    { id: "p1", title: "Inspraakmoment: heraanleg Proefstraat", date: "2026-11-20", location: "Zaal Proef", sourceId: "district-projecten" },
    { id: "p2", title: "Infomoment over het Proefpark", date: "2026-11-21", location: "Proefwijk", sourceId: "district-nieuws" },
    { id: "p3", title: "Heraanleg Andere straat", date: "2026-11-22", location: "Anderestraat", sourceId: "district-projecten" },
    { id: "p4", title: "Proefstraat in een ander district", date: "2026-11-22", location: "Proefstraat", sourceId: "stad-districten" },
  ];
  const { nieuws } = inJeBuurt({ items, straat: proef, wijk: "Proefwijk", punt, vandaag: "2026-11-04" });
  assert.deepEqual(nieuws.map((k) => k.id), ["p1", "p2"]);
});
