// Nakijkronde 5 (18-10-2026): een plek die groter is dan één straat.
// Bevinding HOOG: met een straal (+250 m) en een live kader dat faalde, zei de plekpagina "Rustig" over "in en rond jouw
// straat" en toonde ze tegels met 0. De momentopname van een straat (site/straat/<id>.json) zegt alleen iets over die
// straat, en toch gold ze als volledig voor het hele gebied rond de straat.
// Bevinding MIDDEL: op een wijk- of postcodepagina werd de momentopname nooit gebruikt: falen de live lagen, dan
// verdwenen alle werken, parkeerverboden en vergunningen, hoewel de straatbestanden van de ochtend bestaan.
// Eén oorzaak in het ontwerp, die al eerder terugkwam (nakijkronde 4: de laag van een vorige straat gold als volledige
// laag voor de nieuwe plek): of een laag volledig is, hing alleen af van wat er mislukte, niet van het gebied dat ze
// dekt. Nu draagt elke laag van de plekpagina haar dekking (welk gebied ze nakeek) en kent live.gebied het gebied dat de
// bezoeker koos (site/live-lagen.js): een laag die dat gebied niet dekt, is deels geladen (nooit "rustig", nooit een
// valse 0), en houdt haar items. Een wijk of postcode krijgt de momentopname van al haar straten (laadGebied en
// lagenUitGebied in site/straat-snapshot.js).
// Alleen verzonnen data (tests/helpers/straat-fixture.mjs); er wordt niets opgehaald.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import * as liveLagen from "../site/live-lagen.js";
import { createAreaMatcher } from "../site/neighborhood-map.js";
import { wijkFeatures } from "../site/neighborhood-core.js";
import { HUIK, KAM, PET, VERVERST, bouw, maakWerkmap, parkeerverbod, werk } from "./helpers/straat-fixture.mjs";

const { meldLiveLaag, mislukteOnderdelenPublicSpace } = liveLagen;

function venster(t) {
  const vorige = Object.getOwnPropertyDescriptor(globalThis, "window");
  const w = new EventTarget();
  Object.defineProperty(globalThis, "window", { value: w, configurable: true, writable: true });
  t.after(() => { if (vorige) Object.defineProperty(globalThis, "window", vorige); else delete globalThis.window; });
  const meldingen = [];
  w.addEventListener("public-agenda:street-layer", (event) => meldingen.push(event.detail));
  return { live: () => w.PUBLIC_AGENDA_LIVE_STREETS || {}, meldingen };
}

const STRAAT = "straat:1416|Kammenstraat|2000";
const ALLES_PS = mislukteOnderdelenPublicSpace(["streets"]);
const ochtend = { works: [werk()], publicSpace: [parkeerverbod(1)], permits: [], terraces: [] };
const metOchtend = (plek = STRAAT) => {
  for (const [naam, items] of Object.entries(ochtend)) meldLiveLaag(naam, items, [], { bron: "straat", dekking: { plek, straal: 0 } });
};
const mislukt = (live) => Object.fromEntries(Object.keys(ochtend).map((naam) => [naam, live.failed?.[naam] || []]));

test("de onderdelen van elke laag van de plekpagina, in de woorden van ONDERDELEN", () => {
  assert.deepEqual(liveLagen.alleOnderdelen("works"), ["werken"]);
  assert.deepEqual(liveLagen.alleOnderdelen("publicSpace"), ALLES_PS);
  assert.deepEqual(liveLagen.alleOnderdelen("permits"), ["vergunningen"]);
  assert.deepEqual(liveLagen.alleOnderdelen("terraces"), ["terrassen"]);
  for (const naam of ["works", "publicSpace", "permits", "terraces"]) {
    for (const o of liveLagen.alleOnderdelen(naam)) assert.ok(liveLagen.ONDERDELEN.includes(o), `${naam}: ${o}`);
  }
});

test("dektGebied: een lijst van het district dekt elk gebied, een straatlaag alleen haar plek en straal", () => {
  const { dektGebied } = liveLagen;
  assert.equal(dektGebied(null, { plek: STRAAT, straal: 1000 }), true, "de lijst van het hele district");
  assert.equal(dektGebied(undefined, null), true);
  assert.equal(dektGebied({ plek: STRAAT, straal: 0 }, { plek: STRAAT, straal: 0 }), true);
  assert.equal(dektGebied({ plek: STRAAT, straal: 0 }, { plek: STRAAT, straal: 250 }), false, "de straat zelf is niet de straat met 250 m rond");
  assert.equal(dektGebied({ plek: STRAAT, straal: 500 }, { plek: STRAAT, straal: 250 }), true, "een groter kader dekt een kleiner");
  assert.equal(dektGebied({ plek: STRAAT, straal: 250 }, { plek: STRAAT, straal: 500 }), false);
  assert.equal(dektGebied({ plek: STRAAT, straal: 0 }, { plek: "wijk:ANT18", straal: 0 }), false, "een andere plek");
  assert.equal(dektGebied({ plek: STRAAT, straal: 0 }, null), false, "een straatlaag dekt niet het hele district");
});

test("met een straal is de momentopname van de straat deels geladen: de items blijven, maar nooit volledig", (t) => {
  const { live, meldingen } = venster(t);
  liveLagen.meldGebied({ plek: STRAAT, straal: 0 });
  metOchtend();
  assert.deepEqual(mislukt(live()), { works: [], publicSpace: [], permits: [], terraces: [] }, "de straat zelf: volledig");
  meldingen.length = 0;
  // De bezoeker kiest +250 m: elke laag meldt zich opnieuw, met dezelfde items maar deels geladen.
  liveLagen.meldGebied({ plek: STRAAT, straal: 250 });
  assert.deepEqual(mislukt(live()), { works: ["werken"], publicSpace: ALLES_PS, permits: ["vergunningen"], terraces: ["terrassen"] });
  assert.deepEqual(live().works, ochtend.works, "de momentopname van de straat blijft staan");
  assert.deepEqual(live().publicSpace, ochtend.publicSpace);
  assert.deepEqual(meldingen.map((d) => d.name).sort(), ["permits", "publicSpace", "terraces", "works"]);
  assert.equal(liveLagen.laagStand(meldingen.find((d) => d.name === "works")), "mislukt");
  // Het live kader met 250 m lukte voor de werken: dat dekt het gebied.
  const live250 = [werk(), werk(990002)];
  meldLiveLaag("works", live250, [], { bron: "straat", dekking: { plek: STRAAT, straal: 250 } });
  assert.deepEqual(live().failed.works, []);
  assert.deepEqual(live().works, live250);
  // +500 m: het kader van 250 m dekt dat niet meer.
  liveLagen.meldGebied({ plek: STRAAT, straal: 500 });
  assert.deepEqual(live().failed.works, ["werken"]);
  // Terug naar de straat zelf: alles weer volledig.
  liveLagen.meldGebied({ plek: STRAAT, straal: 0 });
  assert.deepEqual(mislukt(live()), { works: [], publicSpace: [], permits: [], terraces: [] });
});

test("een gelukte lijst van het hele district dekt elk gebied; een straatlaag van een andere plek nooit", (t) => {
  const { live } = venster(t);
  liveLagen.meldGebied({ plek: STRAAT, straal: 1000 });
  metOchtend();
  meldLiveLaag("works", [werk(990003)], []);
  assert.deepEqual(live().failed.works, [], "de werken van het hele district");
  assert.equal(live().heelDistrict.works, true);
  // Een andere plek (de laag van de vorige straat bleef staan): deels geladen, nooit volledig.
  liveLagen.meldGebied({ plek: "wijk:ANT18", straal: 0 });
  assert.deepEqual(live().failed.publicSpace, ALLES_PS);
  assert.deepEqual(live().failed.works, [], "de lijst van het district dekt ook de wijk");
});

test("kiesLaag: een straatlaag die het gebied niet dekt, houdt haar items en mist alle onderdelen van de laag", () => {
  const { kiesLaag } = liveLagen;
  const straat = { items: ["s"], mislukt: [], dekking: { plek: STRAAT, straal: 0 } };
  assert.deepEqual(kiesLaag({ naam: "works", straat, gebied: { plek: STRAAT, straal: 0 } }), { items: ["s"], mislukt: [], heelDistrict: false, gedekt: true });
  assert.deepEqual(kiesLaag({ naam: "works", straat, gebied: { plek: STRAAT, straal: 250 } }), { items: ["s"], mislukt: ["werken"], heelDistrict: false, gedekt: false });
  assert.deepEqual(kiesLaag({ naam: "publicSpace", straat: { ...straat, mislukt: ["omleidingen"] }, gebied: { plek: STRAAT, straal: 250 } }), { items: ["s"], mislukt: ALLES_PS, heelDistrict: false, gedekt: false });
  assert.deepEqual(kiesLaag({ naam: "works", district: { items: ["d"], mislukt: [] }, straat, gebied: { plek: STRAAT, straal: 250 } }), { items: ["d"], mislukt: [], heelDistrict: true, gedekt: true });
  // Zonder dekking (een straatlaag zoals vroeger): ze dekt alles.
  assert.deepEqual(kiesLaag({ naam: "works", straat: { items: ["s"], mislukt: [] }, gebied: { plek: STRAAT, straal: 250 } }), { items: ["s"], mislukt: [], heelDistrict: false, gedekt: true });
});

// ---- de momentopname van een gebied: alle straten van een wijk of postcode ----
function werkmap(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gebied-momentopname-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  maakWerkmap(root);
  return root;
}
// Een nagebootst net dat de gebouwde straatbestanden geeft; `faal`: ids waarvan het bestand niet laadt.
function netVan(root, { faal = [], index: pasAan = null } = {}) {
  const gevraagd = [];
  const nep = async (url) => {
    const pad = new URL(String(url), "http://x").pathname;
    gevraagd.push(pad);
    if (pad === "/straat-index.json") {
      const index = JSON.parse(fs.readFileSync(path.join(root, "site", "straat-index.json"), "utf8"));
      if (pasAan) pasAan(index);
      return new Response(JSON.stringify(index), { status: 200 });
    }
    const id = (pad.match(/^\/straat\/(\d+)\.json$/) || [])[1];
    if (faal.includes(id)) throw new TypeError("Failed to fetch");
    const bestand = path.join(root, "site", pad);
    return fs.existsSync(bestand) ? new Response(fs.readFileSync(bestand), { status: 200 }) : new Response("", { status: 404 });
  };
  return { nep, gevraagd };
}
const vers = () => import(`../site/straat-snapshot.js?gebied=${Math.random()}`);

test("laadGebied en lagenUitGebied: de momentopname van alle straten van een gebied, elk item één keer", async (t) => {
  const root = werkmap(t);
  await bouw(root);
  const { nep, gevraagd } = netVan(root);
  const { laadGebied, lagenUitGebied } = await vers();
  // Een straat zonder bestand (123: niets bij de verversing) vraagt niets.
  const gebied = await laadGebied([KAM.id, PET.id, HUIK.id, "123"], { fetch: nep });
  assert.equal(gebied.ontbrekend, 0);
  assert.deepEqual(gevraagd.filter((p) => p.startsWith("/straat/")).sort(), [`/straat/${HUIK.id}.json`, `/straat/${KAM.id}.json`, `/straat/${PET.id}.json`]);
  const { lagen, volledig, ververst } = lagenUitGebied(gebied, { vandaag: "2099-03-10" });
  assert.equal(volledig, true);
  assert.equal(ververst, VERVERST);
  assert.deepEqual(Object.keys(lagen).sort(), ["permits", "publicSpace", "terraces", "works"]);
  assert.deepEqual(lagen.works.map((w) => w.gipodId), [990001], "het werk één keer, ook al hangt het aan meer straten");
  const ids = lagen.publicSpace.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, `elk item één keer: ${ids.join(", ")}`);
  // De rij van het evenement staat in het bestand van elke straat van het parcours, telkens met alleen die straat: in het
  // gebied met al die straten.
  const evenement = lagen.publicSpace.find((i) => i.id === "iod:ET2099000001|EVENT|e1");
  assert.deepEqual(evenement.streets.map((s) => s.name).sort(), ["Kammenstraat", "Peterseliestraat"]);
  assert.equal(lagen.permits.length, 1);
  assert.equal(lagen.terraces.length, 3);
});

test("laadGebied: een straat die alleen live mag, of een bestand dat niet laadt, maakt de momentopname van het gebied onvolledig", async (t) => {
  const root = werkmap(t);
  await bouw(root);
  for (const opties of [{ faal: [PET.id] }, { index: (index) => { index.alleenLive = [HUIK.id]; } }]) {
    const { nep } = netVan(root, opties);
    const { laadGebied, lagenUitGebied } = await vers();
    const gebied = await laadGebied([KAM.id, PET.id, HUIK.id], { fetch: nep });
    assert.equal(gebied.ontbrekend, 1, JSON.stringify(opties));
    const { lagen, volledig } = lagenUitGebied(gebied, { vandaag: "2099-03-10" });
    assert.equal(volledig, false);
    assert.deepEqual(lagen.works.map((w) => w.gipodId), [990001], "wat wel laadde, blijft");
  }
  // Een laag zonder bruikbare stand in de index (ouder dan 48 uur: "error") komt er niet in.
  const { nep } = netVan(root, { index: (index) => { index.lagen.werken = { status: "error", errorCode: "niet_geladen" }; } });
  const { laadGebied, lagenUitGebied } = await vers();
  const { lagen } = lagenUitGebied(await laadGebied([KAM.id], { fetch: nep }), { vandaag: "2099-03-10" });
  assert.equal(lagen.works, undefined);
  assert.ok(Array.isArray(lagen.publicSpace));
  // Zonder index: geen momentopname.
  const { laadGebied: zonder } = await vers();
  assert.equal(await zonder([KAM.id], { fetch: async () => new Response("", { status: 404 }) }), null);
});

test("laadGebied vraagt hoogstens `gelijktijdig` bestanden tegelijk", async (t) => {
  const root = werkmap(t);
  await bouw(root);
  const { nep } = netVan(root);
  let bezig = 0, max = 0;
  const traag = async (url, opties) => {
    bezig += 1; max = Math.max(max, bezig);
    await new Promise((r) => setTimeout(r, 5));
    try { return await nep(url, opties); } finally { bezig -= 1; }
  };
  const { laadGebied } = await vers();
  await laadGebied([KAM.id, PET.id, HUIK.id], { fetch: traag, gelijktijdig: 2 });
  assert.ok(max <= 2, `hoogstens 2 tegelijk, niet ${max}`);
});

// Op een wijkpagina hangt een item zonder eigen punt (een parkeerverbod, een werk uit de momentopname) aan de wijk via
// zijn straten. Dat vroeg de straatassen van het hele district (streetWijkMap); laadden die niet, dan viel elk zo'n item
// weg uit de wijk. site/geo/straten.json kent per straat dezelfde wijken (scripts/build-straten.mjs, dezelfde regel):
// die vangt het op.
test("een wijk zonder straatassen: de wijken per straat uit de stratenlijst vangen het op", () => {
  const wijken = wijkFeatures(JSON.parse(fs.readFileSync(new URL("../site/geo/wijken.geo.json", import.meta.url), "utf8")));
  const matcher = createAreaMatcher({ wijken, geo: { entries: {} }, streetIndex: null, straatasMislukt: true });
  const item = { id: "parking:PROEF-1|L1", kind: "parking" };
  const refs = [{ id: KAM.id, name: KAM.name, postcode: KAM.postcode }];
  assert.equal(matcher.inWijk(item, "ANT18", refs), false, "zonder straatassen en zonder reserve");
  const reserve = new Map([["kammenstraat|2000", new Set(["ANT18", "ANT09", "ANT22"])]]);
  assert.equal(matcher.inWijk(item, "ANT18", refs, reserve), true);
  assert.equal(matcher.inWijk(item, "ANT05", refs, reserve), false);
});
