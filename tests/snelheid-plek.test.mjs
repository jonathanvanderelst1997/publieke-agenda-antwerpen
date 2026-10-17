// Snelheid van de plekpagina op data ter grootte van een postcode (nakijkronde 12 oktober 2026): de stappen die
// collect() en renderList bij elke tekenbeurt doen na het maken van de kaarten (samenWerven, eenKaartPerDossier,
// verrijkMetContext, bundelLijst via lijstUniversum), op de rijen van alle straatbestanden van postcode 2000 (zo groot
// als een postcode- of wijkpagina, of een straat met een grote straal). Eerst liep samenWerven per parkeerverbod over
// alle fasen van alle werfzones: ~0,5 s per tekenbeurt in Node, seconden op een gsm. De toets in tests/e2e/snelheid
// gebruikt een verzonnen straat en zag dat niet.
//
// Vaste klok (de classificatiedag van de feed), geen netwerk. Het budget is relatief: de stappen samen mogen niet
// meer dan 1,25 keer zo lang duren als het maken van de kaarten zelf (dat deed de basis al bij elke tekenbeurt), zodat
// een trage of drukke machine de toets niet doet falen; plus een vaste bovengrens voor een grove terugval. Gemeten op
// 12 oktober 2026: kaarten 160-250 ms, stappen erna 65-160 ms; vóór de index 340-390 ms.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lees = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const POSTCODE = "2000";
const heeftData = ["site/straat-index.json", "site/geo/straten.json", "site/agenda-feed.js", "site/sources/kaart-uitleg.json"].every((p) => fs.existsSync(path.join(root, p)));
const mediaan = (lijst) => [...lijst].sort((a, b) => a - b)[Math.floor(lijst.length / 2)];
function tijd(fn, keer = 5) {
  fn(); // opwarmen
  const uit = [];
  for (let i = 0; i < keer; i++) { const s = performance.now(); fn(); uit.push(performance.now() - s); }
  return mediaan(uit);
}

test(`plekpagina op postcode ${POSTCODE}: de stappen na de kaarten blijven binnen het budget`, { skip: heeftData ? false : "geen straatbestanden" }, async (t) => {
  const PC = await import("../site/place-core.js");
  const { lagenUitStand } = await import("../site/straat-snapshot.js");
  const { agendaTheme } = await import("../site/agenda-view.js");
  await import("../site/event-types.js");
  await import("../site/agenda-uitgaan.js");
  const U = globalThis.PublicAgendaUitgaan, E = globalThis.PublicAgendaEventTypes;
  const tekst = fs.readFileSync(path.join(root, "site", "agenda-feed.js"), "utf8");
  const feed = JSON.parse(tekst.slice(tekst.indexOf("{"), tekst.lastIndexOf("}") + 1));
  const vandaag = String(feed.classificationAsOf || feed.generatedAt || "").slice(0, 10);
  const metSoort = (feed.items || []).filter((i) => (i.endDate || i.date) >= vandaag).map((i) => ({ ...i, feed: true, eventType: E.classifyEventType(i) }));
  const agendaItems = (U.markeerWekelijkseReeksen ? U.markeerWekelijkseReeksen(metSoort) : metSoort).map((i) => ({ ...i, category: U.categoryOf(i) }));
  const uitleg = lees("site/sources/kaart-uitleg.json");
  const identiteit = PC.identiteitSamen(lees("site/sources/evenement-identiteit.json"), lees("site/sources/evenement-identiteit-auto.json"));
  const index = lees("site/straat-index.json");
  const postcodeVan = new Map(lees("site/geo/straten.json").streets.map(([id, , pc]) => [String(id), String(pc || "")]));
  // De rijen van alle straatbestanden van de postcode, zonder dubbels (een rij staat in elke straat die ze raakt).
  const lagen = { works: new Map(), publicSpace: new Map(), permits: new Map(), terraces: new Map() };
  for (const id of Object.keys(index.straten || {})) {
    if (postcodeVan.get(id) !== POSTCODE) continue;
    const bestand = path.join(root, "site", "straat", `${id}.json`);
    if (!fs.existsSync(bestand)) continue;
    const live = lagenUitStand({ doc: JSON.parse(fs.readFileSync(bestand, "utf8")) }, { vandaag });
    for (const k of Object.keys(lagen)) for (const r of live[k] || []) { const s = `${r.id ?? r.gipodId}|${r.kind || ""}|${r.start || ""}`; if (!lagen[k].has(s)) lagen[k].set(s, r); }
  }
  const live = Object.fromEntries(Object.entries(lagen).map(([k, m]) => [k, [...m.values()]]));
  const agendaHier = agendaItems.map((i) => PC.agendaEntry(i, agendaTheme(i)));
  const bouw = () => [
    ...PC.werkEntries(live.works, { vandaag, uitleg }),
    ...PC.publicSpaceEntries(live.publicSpace, { vandaag, alle: live.publicSpace, uitleg, wijkVan: () => "", identiteit, agendaItems, straat: "", straal: 0, index: null, lijstVan: null }),
    ...live.permits.map((row) => PC.permitEntry(row)),
    ...PC.terrasEntries(live.terraces),
  ];
  const liveRuw = bouw();
  const parkeer = liveRuw.filter((e) => e.item?.kind === "parking").length, werfzones = live.publicSpace.filter((r) => r.kind === "sgw").length;
  assert.ok(liveRuw.length > 1000 && parkeer > 100 && werfzones > 100, `data ter grootte van een postcode (${liveRuw.length} kaarten, ${parkeer} parkeerverboden, ${werfzones} werfzonefasen)`);
  const stappen = (straat) => () => {
    const w = PC.samenWerven(liveRuw, { uitleg, straat, vandaag, alle: live.publicSpace });
    const e = PC.eenKaartPerDossier(agendaHier, w);
    const alles = PC.verrijkMetContext([...e.agenda, ...e.live], { straat, vandaag, agendaItems, uitleg });
    PC.lijstUniversum(alles, vandaag, { markten: [], straat });
  };
  const kaarten = tijd(bouw);
  const zonderStraat = tijd(stappen(""));
  const metStraat = tijd(stappen("Groenplaats"));
  const budget = Math.max(1.25 * kaarten, 60);
  const verslag = `kaarten maken ${Math.round(kaarten)} ms; stappen erna ${Math.round(zonderStraat)} ms (wijk), ${Math.round(metStraat)} ms (straat); budget ${Math.round(budget)} ms`;
  t.diagnostic(verslag);
  assert.ok(zonderStraat <= budget && metStraat <= budget, `te traag: ${verslag}`);
  assert.ok(zonderStraat < 1500 && metStraat < 1500, `grove terugval: ${verslag}`);
  // De index van samenWerven: één keer per aanroep, niet per parkeerverbod (een parkeerverbod zoekt alleen zijn dagen op).
  const s = performance.now();
  PC.samenWerven(liveRuw, { uitleg, straat: "", vandaag, alle: live.publicSpace });
  assert.ok(performance.now() - s <= budget, `samenWerven alleen: ${Math.round(performance.now() - s)} ms; ${verslag}`);
});
