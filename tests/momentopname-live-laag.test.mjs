// Nakijkronde 3 (18-10-2026), bevinding HOOG: de momentopname van een straat (site/straat/<id>.json) verdween zonder
// melding zodra de bezoeker op de plekpagina "Alle lijsten, bronnen en instellingen" openklapte terwijl A-Sign of GIPOD
// niet antwoordde. De lijst van het hele district (site/public-space-live.js) meldde dan een lege laag "voor het hele
// district", ook als alle A-Sign-lagen faalden, en zette die over de straatlaag heen; site/works-live.js zette de werken
// op mislukt. Echte parkeerverboden, werfzones en evenementen vielen weg uit de weekzin, de tegels en de lijst.
// Besluit van de eigenaar: "niemand moet weten als er iets faalt, de momentopname blijft wel goed". Een live laag die
// (deels) faalt, vervangt of leegt de momentopname dus nooit; alleen een gelukte live laag vervangt ze.
// Alleen verzonnen data (tests/helpers/straat-fixture.mjs); er wordt niets opgehaald.
import assert from "node:assert/strict";
import test from "node:test";

import * as liveLagen from "../site/live-lagen.js";
import { dezeWeek, publicSpaceEntries, summarize, werkEntries } from "../site/place-core.js";
import { NU, parkeerverbod, werk } from "./helpers/straat-fixture.mjs";

const { meldLiveLaag, mislukteOnderdelenPublicSpace, ontbrekendeOnderdelen } = liveLagen;
const VANDAAG = NU.toISOString().slice(0, 10);

// Een nagebootst venster: meldLiveLaag schrijft in window.PUBLIC_AGENDA_LIVE_STREETS en stuurt een gebeurtenis.
function venster(t) {
  const vorige = Object.getOwnPropertyDescriptor(globalThis, "window");
  const w = new EventTarget();
  Object.defineProperty(globalThis, "window", { value: w, configurable: true, writable: true });
  t.after(() => { if (vorige) Object.defineProperty(globalThis, "window", vorige); else delete globalThis.window; });
  const meldingen = [];
  w.addEventListener("public-agenda:street-layer", (event) => meldingen.push(event.detail));
  return { live: () => w.PUBLIC_AGENDA_LIVE_STREETS || {}, meldingen };
}

// Wat de plekpagina toont uit de live lagen (zoals collect() in site/place-view.js): de weekzin, de tegels, de items
// en welke onderdelen intern als mislukt gelden (geen "rustig", een streepje op een tegel).
function watJeZiet(live) {
  const entries = [
    ...werkEntries(live.works || [], { vandaag: VANDAAG }),
    ...publicSpaceEntries(live.publicSpace || [], { vandaag: VANDAAG, alle: live.publicSpace || [] }),
  ];
  const failed = ontbrekendeOnderdelen(live.failed || {});
  return {
    week: dezeWeek(entries, VANDAAG, { onvolledig: failed.some((o) => o !== "terrassen" && o !== "vergunningen") }),
    tegels: summarize(entries, VANDAAG),
    items: entries.map((e) => e.uid).sort(),
    mislukt: failed,
    lagen: Object.fromEntries(["works", "publicSpace", "permits", "terraces"].map((naam) => [naam, Array.isArray(live[naam]) ? live[naam].length : null])),
  };
}

// De momentopname van de verzonnen Kammenstraat: een werk, twee parkeerverboden, geen vergunningen en geen terrassen
// (een lege maar geladen laag). place-view.js meldt ze als laag van de straat.
const ochtend = { works: [werk()], publicSpace: [parkeerverbod(1), parkeerverbod(2)], permits: [], terraces: [] };
function metOchtend() {
  for (const [naam, items] of Object.entries(ochtend)) meldLiveLaag(naam, items, [], { bron: "straat" });
}
// Alles buiten de site antwoordt niet: de lijsten van het hele district falen.
const ALLE_ASIGN = ["parking", "iod22", "iod23", "sgw47", "sgw48", "district", "streets"];
function districtFaalt() {
  meldLiveLaag("works", null, ["werken"]);
  meldLiveLaag("publicSpace", [], mislukteOnderdelenPublicSpace(ALLE_ASIGN));
  meldLiveLaag("permits", null, ["vergunningen"]);
  meldLiveLaag("terraces", null, ["terrassen"]);
}

test("de lijsten van het district falen na het openklappen: dezelfde weekzin, tegels en items als ervoor (de momentopname)", (t) => {
  const { live, meldingen } = venster(t);
  metOchtend();
  const voor = watJeZiet(live());
  assert.match(voor.week.zin, /2 parkeerverboden/, "de verzonnen ochtend heeft parkeerverboden deze week");
  assert.deepEqual(voor.mislukt, []);
  districtFaalt();
  assert.deepEqual(watJeZiet(live()), voor);
  // Wat de andere delen van de pagina horen (de vooruitblik, "Alles per straat"): ook de momentopname, zonder mislukking.
  const laatste = Object.fromEntries(meldingen.map((d) => [d.name, d]));
  for (const naam of Object.keys(ochtend)) {
    assert.deepEqual(laatste[naam].items, ochtend[naam], naam);
    assert.deepEqual(laatste[naam].failed, [], naam);
    assert.equal(liveLagen.laagStand(laatste[naam]), "ok", naam);
  }
});

test("ook als de lijst van het district maar deels laadt, of faalt vóór de momentopname binnen is", (t) => {
  const { live } = venster(t);
  // Faalt eerst (de bezoeker klapte meteen open), dan komt de momentopname: die telt.
  districtFaalt();
  metOchtend();
  const voor = watJeZiet(live());
  assert.deepEqual(voor.mislukt, []);
  assert.equal(voor.lagen.publicSpace, 2);
  // A-Sign deels: de parkeerverboden laadden (leeg), de innames niet. Een halve lijst vervangt de momentopname niet.
  meldLiveLaag("publicSpace", [], mislukteOnderdelenPublicSpace(["iod22", "iod23"]));
  assert.deepEqual(watJeZiet(live()), voor);
});

test("alleen een gelukte live laag van het district vervangt de momentopname", (t) => {
  const { live } = venster(t);
  metOchtend();
  const nieuw = werk(990002, { title: "2000 Antwerpen, Proefstraat 1 - Nieuw proefwerk (snel)" }); // verzonnen
  meldLiveLaag("works", [nieuw], []);
  assert.deepEqual(live().works, [nieuw]);
  assert.deepEqual(live().failed.works, []);
  assert.equal(live().heelDistrict?.works, true);
  // Een momentopname die daarna nog binnenkomt, verdringt de volledige lijst niet.
  meldLiveLaag("works", ochtend.works, [], { bron: "straat" });
  assert.deepEqual(live().works, [nieuw]);
  // De publieke ruimte faalde: die blijft de momentopname.
  meldLiveLaag("publicSpace", [], mislukteOnderdelenPublicSpace(ALLE_ASIGN));
  assert.deepEqual(live().publicSpace, ochtend.publicSpace);
  assert.equal(live().heelDistrict?.publicSpace, undefined);
});

test("weg van de straat: de momentopname gaat weg en wat de lijst van het district gaf, telt weer (geen eeuwig 'laden')", (t) => {
  const { live } = venster(t);
  metOchtend();
  districtFaalt();
  for (const naam of Object.keys(ochtend)) liveLagen.wisLiveLaag(naam, "straat");
  assert.equal(live().works, undefined);
  assert.deepEqual(live().failed.works, ["werken"], "de werken van het district faalden: niet meer 'nog onderweg'");
  assert.deepEqual(live().publicSpace, [], "de halve lijst van het district");
  assert.deepEqual(live().failed.publicSpace, mislukteOnderdelenPublicSpace(ALLE_ASIGN));
  // Zonder lijst van het district: niets, en niets mislukt (de laag is nog niet gevraagd).
  globalThis.window.PUBLIC_AGENDA_LIVE_STREETS = undefined;
  meldLiveLaag("terraces", [], [], { bron: "straat" });
  liveLagen.wisLiveLaag("terraces", "straat");
  assert.equal(live().terraces, undefined);
  assert.deepEqual(live().failed.terraces, []);
});

test("kiesLaag: gelukt district, dan de straat met items, dan wat er wel is", () => {
  const { kiesLaag } = liveLagen;
  const straat = { items: ["s"], mislukt: [] };
  // `gedekt`: de gekozen bron dekt het gebied van de bezoeker (tests/gebied-momentopname.test.mjs); zonder dekking altijd.
  assert.deepEqual(kiesLaag({ district: { items: ["d"], mislukt: [] }, straat }), { items: ["d"], mislukt: [], heelDistrict: true, gedekt: true });
  assert.deepEqual(kiesLaag({ district: { items: [], mislukt: ["parkeerverboden"] }, straat }), { items: ["s"], mislukt: [], heelDistrict: false, gedekt: true });
  assert.deepEqual(kiesLaag({ district: { items: null, mislukt: ["werken"] }, straat }), { items: ["s"], mislukt: [], heelDistrict: false, gedekt: true });
  // Geen momentopname en het kader faalde: de halve lijst van het district gaat voor.
  assert.deepEqual(kiesLaag({ district: { items: [], mislukt: ["omleidingen"] }, straat: { items: null, mislukt: ["parkeerverboden en innames"] } }), { items: [], mislukt: ["omleidingen"], heelDistrict: false, gedekt: true });
  assert.deepEqual(kiesLaag({ straat: { items: null, mislukt: ["werken"] } }), { items: null, mislukt: ["werken"], heelDistrict: false, gedekt: true });
  assert.equal(kiesLaag({}), null);
});

// ---- nakijkronde 4 (18-10-2026): een live laag die maar deels laadt ----
// Bevinding HOOG: de werkenlijst van het hele district (site/works-live.js) meldde zich als volledig, ook als de
// districtsgrens, de straatassen of de GIPOD-hinder niet laadden, en verving zo de momentopname van een straat. Bevinding
// MIDDEL: het live kader van een straat (werkenInKader) gold zonder GIPOD-hinder als gelukt. Beide vragen nu dezelfde
// functie wat de werkenlaag mist (werkenMislukt): zonder grens blijven alleen de werken van de exacte snapshot over,
// zonder straatassen hangt geen werk aan een straat, zonder hinder ontbreekt de (ernstige) hinder.
test("werkenMislukt: zonder districtsgrens, straatassen of GIPOD-hinder is de werkenlaag deels geladen, en vervangt ze de momentopname niet", async (t) => {
  const { werkenMislukt } = await import("../site/works-live.js");
  assert.deepEqual(werkenMislukt(), []);
  assert.deepEqual(werkenMislukt({ grens: true, assen: true, hinder: true }), []);
  for (const ontbreekt of ["grens", "assen", "hinder"]) assert.deepEqual(werkenMislukt({ [ontbreekt]: false }), ["werken"], ontbreekt);
  const { live } = venster(t);
  metOchtend();
  const voor = watJeZiet(live());
  meldLiveLaag("works", [], werkenMislukt({ grens: false }));
  assert.deepEqual(watJeZiet(live()), voor);
  assert.equal(live().heelDistrict?.works, undefined);
});

// Het kader van één straat, met een nagebootst net: alleen verzonnen antwoorden, niets gaat naar buiten.
async function kaderMet(t, { hinderOk = true } = {}) {
  const vorige = globalThis.fetch;
  t.after(() => { globalThis.fetch = vorige; });
  const punt = [4.401, 51.217];
  const vraag = [];
  globalThis.fetch = async (input) => {
    const url = String(input?.url || input);
    vraag.push(url);
    const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/collections/INNAME_PUNT/")) return json({ type: "FeatureCollection", links: [], features: [{ type: "Feature", geometry: { type: "Point", coordinates: punt }, properties: { GipodId: 990001, Description: "Proefwerk (verzonnen)", Owner: "water-link", Status: "In uitvoering", Start: "2099-03-05T06:00:00Z", End: "2099-04-09T16:00:00Z" } }] });
    if (url.includes("/collections/HINDER_PUNT/")) return hinderOk ? json({ type: "FeatureCollection", links: [], features: [] }) : new Response("", { status: 500 });
    if (url.includes("returnIdsOnly")) return json({ objectIds: [] });
    return new Response("", { status: 404 });
  };
  const { werkenInKader } = await import("../site/works-live.js");
  const { buildStreetIndex } = await import("../site/street-core.js");
  const { default: fs } = await import("node:fs");
  const district = JSON.parse(fs.readFileSync(new URL("../lib/district-antwerpen-grens.geojson", import.meta.url), "utf8"));
  const grens = district.type === "FeatureCollection" ? district.features[0].geometry : district.geometry || district;
  const as = { type: "Feature", geometry: { type: "LineString", coordinates: [[4.4005, 51.2165], [4.4015, 51.2175]] }, properties: { LSTRNMID: 1416, LSTRNM: "Kammenstraat", RSTRNMID: 1416, RSTRNM: "Kammenstraat", postcode: 2000, DISTRICT: "Antwerpen" } };
  const r = await werkenInKader([4.4, 51.216, 4.402, 51.218], { district: grens, streetIndex: buildStreetIndex([as]) });
  return { r, vraag };
}
test("werkenInKader: zonder GIPOD-hinder is het kader van de straat deels geladen (mislukt), met hinder volledig", async (t) => {
  const zonder = await kaderMet(t, { hinderOk: false });
  assert.ok(zonder.vraag.some((u) => u.includes("/collections/HINDER_PUNT/")), "het kader vroeg de hinder");
  assert.deepEqual(zonder.r.items.map((i) => [i.gipodId, i.hindranceSourceLoaded]), [[990001, false]]);
  assert.deepEqual(zonder.r.mislukt, ["werken"]);
  const met = await kaderMet(t, { hinderOk: true });
  assert.deepEqual(met.r.items.map((i) => [i.gipodId, i.hindranceSourceLoaded]), [[990001, true]]);
  assert.deepEqual(met.r.mislukt, []);
});

// Bij het herstel gevonden: een mislukt onderdeel dat niet in ONDERDELEN staat (de plekpagina meldde
// "parkeerverboden en innames"), viel weg in ontbrekendeOnderdelen; de laag gold dan als volledig ("Rustig"). Een
// onbekend onderdeel of een onbekende bron telt nu als mislukt.
test("een onbekend mislukt onderdeel of een onbekende bron valt nooit weg", () => {
  assert.deepEqual(ontbrekendeOnderdelen({ publicSpace: ["parkeerverboden en innames"] }), ["parkeerverboden en innames"]);
  assert.deepEqual(ontbrekendeOnderdelen({ works: ["werken"], publicSpace: ["iets anders", "omleidingen"] }), ["werken", "omleidingen", "iets anders"]);
  assert.deepEqual(mislukteOnderdelenPublicSpace(["onbekend"]), mislukteOnderdelenPublicSpace(["streets"]));
  assert.deepEqual(liveLagen.mislukteOnderdelen("works", ["onbekend"]), ["werken"]);
  assert.deepEqual(liveLagen.mislukteOnderdelen("works", []), []);
});
