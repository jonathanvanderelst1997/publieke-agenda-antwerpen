// "X in de lijst, Y op de kaart" onder de buurtkaart (site/neighborhood-map.js, kaartStatusZin): de lijst
// en de kaart tellen op dezelfde manier. Een werf in stukken is één kaart in de lijst (werkEntries in
// site/place-core.js) en telt ook één keer op de kaart, ook al tekent de kaart een punt per stuk.
// Wat de lijst echt toont (periode, tijdlijn, gekozen dag) en het missen van het eerste bericht toetst
// tests/e2e/plek.e2e.mjs in een echte browser. Verzonnen gegevens.
import test from "node:test";
import assert from "node:assert/strict";

import { lijstAantal, werfPerStuk, werkEntries } from "../site/place-core.js";
import { kaartStatusZin, werkKaarten } from "../site/neighborhood-map.js";

const VANDAAG = "2026-10-11";
const stuk = (id, punt, extra = {}) => ({
  gipodId: id, title: "R1 - Proefpark - Antwerpen", status: "In uitvoering", owner: "Proefbeheerder",
  start: "2026-10-05T06:00:00Z", end: "2026-11-30T16:00:00Z", streets: [{ name: "Proeflaan", postcode: "2000" }], point: punt, ...extra,
});
const zin = (werken, kaarten, extra = {}) => kaartStatusZin({
  where: "Proeflaan", mapped: 0, werken, werfPerStuk: werfPerStuk(kaarten), werkenAan: true, werkenGeladen: true, metPlek: true, lijstAantal: lijstAantal(kaarten), ...extra,
});

test("een werf in drie stukken: één kaart in de lijst, en ook één op de kaart", () => {
  const stukken = [stuk(90000201, [4.40, 51.2]), stuk(90000202, [4.401, 51.2]), stuk(90000203, [4.402, 51.2])];
  const kaarten = werkEntries(stukken, { vandaag: VANDAAG });
  assert.equal(kaarten.length, 1, "de lijst voegt de stukken samen");
  assert.deepEqual(kaarten[0].gipodIds, [90000201, 90000202, 90000203]);
  assert.equal(zin(stukken, kaarten), "1 in de lijst, 1 op de kaart in Proeflaan.");
});

test("twee werven, waarvan één in twee stukken, en een agendapunt: twee werken op de kaart", () => {
  const stukken = [stuk(90000301, [4.40, 51.2]), stuk(90000302, [4.401, 51.2]), stuk(90000303, [4.402, 51.2], { title: "Proefwerk riolering", owner: "Andere proefbeheerder" })];
  const kaarten = werkEntries(stukken, { vandaag: VANDAAG });
  assert.equal(kaarten.length, 2);
  assert.equal(werkKaarten(stukken, werfPerStuk(kaarten)), 2);
  assert.equal(zin(stukken, kaarten, { mapped: 1, lijstAantal: 3 }), "3 in de lijst, 3 op de kaart in Proeflaan.");
  // Zonder gekozen plek (of in de maand, zonder lijst): dezelfde telling bij "werken en hinder".
  assert.equal(zin(stukken, kaarten, { mapped: 4, metPlek: false }), "4 agendapunten op de kaart in Proeflaan · 2 werken en hinder.");
  assert.equal(zin(stukken, kaarten, { mapped: 4, lijstAantal: null }), "4 agendapunten op de kaart in Proeflaan · 2 werken en hinder.");
});

test("twee aansluitingen naast elkaar (andere huisnummers): één kaart in de lijst en op de kaart", () => {
  const aansluiting = (id, nummer, punt) => stuk(id, punt, { title: `2018 ANTWERPEN, PROEFSTRAAT ${nummer}`, owner: "Proefnet", ownerGroup: "Proefnet" });
  const stukken = [aansluiting(90000401, 44, [4.40, 51.2]), aansluiting(90000402, 46, [4.4001, 51.2])];
  const kaarten = werkEntries(stukken, { vandaag: VANDAAG });
  assert.equal(kaarten.length, 1);
  assert.equal(zin(stukken, kaarten), "1 in de lijst, 1 op de kaart in Proeflaan.");
});

test("zonder indeling van de lijst telt elk getekend werk apart; een stuk zonder punt telt niet op de kaart", () => {
  const stukken = [stuk(90000501, [4.40, 51.2]), stuk(90000502, [4.401, 51.2])];
  assert.equal(werkKaarten(stukken, null), 2);
  assert.equal(werkKaarten(stukken, {}), 2);
  // De lijst kent drie stukken van één werf; de kaart tekent er twee (het derde heeft geen punt): één werf.
  const kaarten = werkEntries([...stukken, stuk(90000503, null)], { vandaag: VANDAAG });
  assert.equal(kaarten.length, 1);
  assert.equal(werkKaarten(stukken, werfPerStuk(kaarten)), 1);
});

test("werken die nog laden of uit staan: geen getal voor de werken", () => {
  const stukken = [stuk(90000601, [4.40, 51.2])];
  const kaarten = werkEntries(stukken, { vandaag: VANDAAG });
  assert.equal(zin(stukken, kaarten, { mapped: 2, werkenGeladen: false, lijstAantal: 5, without: 1 }), "5 in de lijst, 2 op de kaart in Proeflaan · werken en hinder worden geladen… · 1 zonder vaste plek.");
  assert.equal(zin(stukken, kaarten, { mapped: 2, werkenAan: false, lijstAantal: 5, without: 1 }), "5 in de lijst, 2 op de kaart in Proeflaan · 1 zonder vaste plek.");
});
