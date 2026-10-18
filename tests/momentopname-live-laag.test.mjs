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
  assert.deepEqual(kiesLaag({ district: { items: ["d"], mislukt: [] }, straat }), { items: ["d"], mislukt: [], heelDistrict: true });
  assert.deepEqual(kiesLaag({ district: { items: [], mislukt: ["parkeerverboden"] }, straat }), { items: ["s"], mislukt: [], heelDistrict: false });
  assert.deepEqual(kiesLaag({ district: { items: null, mislukt: ["werken"] }, straat }), { items: ["s"], mislukt: [], heelDistrict: false });
  // Geen momentopname en het kader faalde: de halve lijst van het district gaat voor.
  assert.deepEqual(kiesLaag({ district: { items: [], mislukt: ["omleidingen"] }, straat: { items: null, mislukt: ["parkeerverboden en innames"] } }), { items: [], mislukt: ["omleidingen"], heelDistrict: false });
  assert.deepEqual(kiesLaag({ straat: { items: null, mislukt: ["werken"] } }), { items: null, mislukt: ["werken"], heelDistrict: false });
  assert.equal(kiesLaag({}), null);
});
