// Nakijkronde 6 (18-10-2026): drie bevindingen MIDDEL over de plekpagina als live lagen falen. Besluit van de eigenaar
// (18-10-2026): "niemand moet weten als er iets faalt, de momentopname blijft wel goed".
// 1. Eén straat zonder momentopname (een afgebroken /straat/<id>.json, een straat in "alleenLive", of een straat-index die
//    één keer niet laadde) zette de momentopname uit voor elke straat daarna, tot de pagina herlaadde. Nu is het per
//    straat, en een mislukte index wordt later opnieuw gevraagd (begrensd).
// 2. Met een straal hing alles rond de straat af van de live straatassen. Faalden die, dan vielen de agendapunten rond de
//    straat stil weg en bleef een te laag getal staan onder "in en rond jouw straat". Nu valt de straal terug op het kader
//    van de straat uit site/geo/straten.json; wat daarmee niet zeker binnen of buiten de straal ligt, maakt de straal
//    onzeker, en dan staat er voor de straal geen getal.
// 3. Bij een falende lijst van het district toonde een wijk werken uit de momentopname van haar straten die de gezonde
//    pagina niet aan die wijk toekent (een valse "Let op"): live ligt een werk via zijn GIPOD-punt in één wijk, in het
//    straatbestand staat geen punt. Een werk uit de momentopname hoort nu alleen bij een wijk als dat ondubbelzinnig is
//    (een straat ervan ligt helemaal in die wijk). De andere lagen hebben ook live geen punt en blijven via hun straten.
// Alleen verzonnen data; er wordt niets opgehaald.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { KAM, PET, bouw, maakWerkmap } from "./helpers/straat-fixture.mjs";

function werkmap(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plek-terugval-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  maakWerkmap(root);
  return root;
}
const vers = () => import(`../site/straat-snapshot.js?terugval=${Math.random()}`);

// ---- 1. een straat zonder stand schakelt de andere niet uit ----

test("laadStraatIndex: een mislukte index wordt bij de volgende vraag opnieuw gevraagd, een gelukte niet", async (t) => {
  const root = werkmap(t);
  await bouw(root);
  const index = fs.readFileSync(path.join(root, "site", "straat-index.json"), "utf8");
  for (const fout of ["afgebroken", "404", "kapot"]) {
    let vragen = 0;
    const nep = async (url) => {
      const pad = new URL(String(url), "http://x").pathname;
      if (pad === "/straat-index.json") {
        vragen += 1;
        if (vragen === 1) {
          if (fout === "afgebroken") throw new TypeError("Failed to fetch");
          return new Response(fout === "404" ? "" : "<!doctype html>", { status: fout === "404" ? 404 : 200 });
        }
        return new Response(index, { status: 200 });
      }
      const bestand = path.join(root, "site", pad);
      return fs.existsSync(bestand) ? new Response(fs.readFileSync(bestand), { status: 200 }) : new Response("", { status: 404 });
    };
    const { laadStraat, laadStraatIndex } = await vers();
    assert.equal(await laadStraat(KAM.id, { fetch: nep }), null, `${fout}: de eerste keer geen index, dus geen stand`);
    const stand = await laadStraat(PET.id, { fetch: nep });
    assert.ok(stand?.doc, `${fout}: de volgende straat vraagt de index opnieuw en heeft haar stand`);
    assert.ok((await laadStraat(KAM.id, { fetch: nep }))?.doc, `${fout}: ook de eerste straat, later`);
    await laadStraatIndex({ fetch: nep });
    assert.equal(vragen, 2, `${fout}: een gelukte index wordt niet opnieuw gevraagd`);
  }
});

test("laadStraatIndex: hoogstens MAX_INDEX_POGINGEN keer per pagina, en niet twee keer tegelijk", async () => {
  const { laadStraatIndex, MAX_INDEX_POGINGEN } = await vers();
  assert.ok(Number.isInteger(MAX_INDEX_POGINGEN) && MAX_INDEX_POGINGEN >= 2 && MAX_INDEX_POGINGEN <= 5, String(MAX_INDEX_POGINGEN));
  let vragen = 0;
  let laat = null;
  const nep = () => { vragen += 1; return new Promise((_, nee) => { laat = () => nee(new TypeError("Failed to fetch")); }); };
  // Twee vragen terwijl de eerste nog loopt: één verzoek.
  const a = laadStraatIndex({ fetch: nep }), b = laadStraatIndex({ fetch: nep });
  await Promise.resolve(); await Promise.resolve();
  laat();
  assert.deepEqual(await Promise.all([a, b]), [null, null]);
  assert.equal(vragen, 1);
  const altijdFout = async () => { vragen += 1; throw new TypeError("Failed to fetch"); };
  for (let i = 0; i < MAX_INDEX_POGINGEN + 3; i++) assert.equal(await laadStraatIndex({ fetch: altijdFout }), null);
  assert.equal(vragen, MAX_INDEX_POGINGEN, "daarna niet meer");
});

test("place-view.js: geen vergrendeling meer voor elke straat na één straat zonder stand", () => {
  const bron = fs.readFileSync(new URL("../site/place-view.js", import.meta.url), "utf8");
  assert.doesNotMatch(bron, /snelMogelijk/);
  assert.match(bron, /view\.straatSnel = place\?\.type === "straat";/);
});

// ---- 2. de straal zonder straatassen: het kader van de straat ----

const STRATEN = JSON.parse(fs.readFileSync(new URL("../site/geo/straten.json", import.meta.url), "utf8")).streets;
const WIJKEN = JSON.parse(fs.readFileSync(new URL("../site/geo/wijken.geo.json", import.meta.url), "utf8"));
const KAM_RIJ = STRATEN.find((r) => r[1] === KAM.name && String(r[2]) === KAM.postcode);
const KAM_BOX = KAM_RIJ[4];
const meterLon = 111320 * Math.cos((((KAM_BOX[1] + KAM_BOX[3]) / 2) * Math.PI) / 180);
const oost = (meter) => [KAM_BOX[2] + meter / meterLon, (KAM_BOX[1] + KAM_BOX[3]) / 2];

test("straalVolgensKader: zeker binnen, zeker buiten, of onzeker; met een punt of een vorm", async () => {
  const { straalVolgensKader, KADER_MARGE } = await import("../site/neighborhood-core.js");
  assert.ok(KADER_MARGE > 0 && KADER_MARGE <= 5);
  // De Kammenstraat: ongeveer 127 m breed en 341 m hoog. 30 m ten oosten: hoogstens ~175 m van de straat.
  assert.equal(straalVolgensKader({ point: oost(30) }, KAM_BOX, 250), "ja");
  // 200 m ten oosten: minstens 200 m, hoogstens ~263 m: met 250 m niet zeker, met 500 m zeker.
  assert.equal(straalVolgensKader({ point: oost(200) }, KAM_BOX, 250), "onzeker");
  assert.equal(straalVolgensKader({ point: oost(200) }, KAM_BOX, 500), "ja");
  assert.equal(straalVolgensKader({ point: oost(2000) }, KAM_BOX, 1000), "nee");
  // In het kader zelf: zeker binnen elke straal die groter is dan de halve hoogte.
  assert.equal(straalVolgensKader({ point: [(KAM_BOX[0] + KAM_BOX[2]) / 2, (KAM_BOX[1] + KAM_BOX[3]) / 2] }, KAM_BOX, 250), "ja");
  // Een vorm (parkeerverbod, vergunning): het dichtste hoekpunt telt voor "ja", het kader van de vorm voor "nee".
  const lijn = (a, b) => ({ vorm: { vlakken: [], lijnen: [[a, b]] } });
  assert.equal(straalVolgensKader(lijn(oost(20), oost(900)), KAM_BOX, 250), "ja");
  assert.equal(straalVolgensKader(lijn(oost(1500), oost(1600)), KAM_BOX, 1000), "nee");
  assert.equal(straalVolgensKader(lijn(oost(220), oost(240)), KAM_BOX, 250), "onzeker");
  // Zonder punt en zonder vorm (een terras): alleen in de straat zelf, zoals nearStreet.
  assert.equal(straalVolgensKader({ id: "terrace:x" }, KAM_BOX, 1000), "nee");
  // Een agendapunt met een geocodering (site/geo/locaties.json).
  const geo = { entries: { "proeflocatie e2e": { point: oost(30) } } };
  assert.equal(straalVolgensKader({ location: "Proeflocatie (e2e)" }, KAM_BOX, 250, geo), "ja");
  // Geen geldig kader: onzeker.
  assert.equal(straalVolgensKader({ point: oost(30) }, null, 250), "onzeker");
});

test("de straal valt terug op het kader van de straat als de straatassen niet laadden", async () => {
  const { createAreaMatcher } = await import("../site/neighborhood-map.js");
  const { createAgendaView } = await import("../site/agenda-view.js");
  const { wijkFeatures } = await import("../site/neighborhood-core.js");
  const wijken = wijkFeatures(WIJKEN);
  const geo = { entries: { "proeflocatie dichtbij e2e": { point: oost(30) }, "proeflocatie twijfel e2e": { point: oost(200) }, "proeflocatie ver e2e": { point: oost(2000) } } };
  const dichtbij = { id: "a", location: "Proeflocatie dichtbij (e2e)" }, twijfel = { id: "b", location: "Proeflocatie twijfel (e2e)" }, ver = { id: "c", location: "Proeflocatie ver (e2e)" };
  const inStraat = { id: "d", location: "Kammenstraat 999", streets: [KAM] };
  const maak = (opties) => {
    const view = createAgendaView();
    view.setStreet(KAM.name, { ...KAM, box: KAM_BOX });
    view.setArea({ radius: 250 });
    view.setAreaMatcher(createAreaMatcher({ wijken, geo, ...opties }));
    return view;
  };
  // Zolang de straatassen laden: niets rond de straat, en geen terugval.
  const laadt = maak({});
  assert.equal(laadt.straalStand, "laadt");
  assert.equal(laadt.matchesStreet(dichtbij), false);
  // Ze laadden niet: het kader van de straat.
  const view = maak({ straatasMislukt: true });
  assert.equal(view.straalStand, "kader");
  assert.equal(view.matchesStreet(dichtbij), true, "zeker binnen 250 m");
  assert.equal(view.matchesStreet(twijfel), false);
  assert.equal(view.straalOnzeker(twijfel), true, "niet zeker: dan geen getal voor de straal");
  assert.equal(view.matchesStreet(ver), false);
  assert.equal(view.straalOnzeker(ver), false);
  assert.equal(view.straalOnzeker(dichtbij), false);
  assert.equal(view.matchesStreet(inStraat), true);
  assert.equal(view.straalOnzeker(inStraat), false, "in de straat zelf is zeker");
  // Zonder kader voor de gekozen straat: geen terugval.
  view.setStreet(KAM.name, { ...KAM });
  assert.equal(view.straalStand, "mislukt");
  assert.equal(view.matchesStreet(dichtbij), false);
  // Zonder straal: niets onzeker.
  view.setStreet(KAM.name, { ...KAM, box: KAM_BOX });
  view.setArea({ radius: 0 });
  assert.equal(view.straalOnzeker(twijfel), false);
});

test("place-view.js: met een straal geen te laag getal, en de weekzin over de straat zelf", () => {
  const bron = fs.readFileSync(new URL("../site/place-view.js", import.meta.url), "utf8");
  // De tegel: "…" zolang wat ze telt laadt, "–" als het de straal niet (zeker) dekt, ook bij een getal dat geen 0 is.
  assert.match(bron, /const tegelGetal = \(n, group\) => \(state\.straalLaadt\?\.has\(group\) \? "…" : state\.straalOnvolledig\?\.has\(group\) \? "–"/);
  assert.match(bron, /if \(state\.straalLaadt\.has\(g\.key\) \|\| state\.straalOnvolledig\.has\(g\.key\)\) state\.counts\[g\.key\] = undefined;/);
  assert.match(bron, /view\.setStreet\(place\.name, \{ \.\.\.streetRef\(place\), box: place\.box \}\)/);
  assert.match(bron, /alleenStraat: true/);
});

// ---- 3. een item uit de momentopname hoort alleen bij een wijk als dat ondubbelzinnig is ----

test("straatWijkKeuze: ja als een straat helemaal in de wijk ligt, twijfel als ze ook door een andere loopt", async () => {
  const { straatWijkKeuze, streetsInWijk } = await import("../site/neighborhood-core.js");
  const map = new Map([["kammenstraat|2000", new Set(["ANT18", "ANT09", "ANT22"])], ["peterseliestraat|2000", new Set(["ANT09"])], ["proefstraat|2000", new Set(["ANT01"])], ["proefstraat|2018", new Set(["ANT01", "ANT24"])]]);
  const kam = { name: "Kammenstraat", postcode: "2000" }, pet = { name: "Peterseliestraat", postcode: "2000" };
  assert.equal(straatWijkKeuze([kam], "ANT18", map), "twijfel");
  assert.equal(straatWijkKeuze([kam], "ANT05", map), "nee");
  assert.equal(straatWijkKeuze([pet], "ANT09", map), "ja");
  assert.equal(straatWijkKeuze([kam, pet], "ANT09", map), "ja", "via de Peterseliestraat");
  assert.equal(straatWijkKeuze([kam, pet], "ANT18", map), "twijfel");
  assert.equal(straatWijkKeuze([], "ANT09", map), "nee");
  assert.equal(straatWijkKeuze([pet], "ANT09", null), "nee");
  // Zonder postcode: elke straat met die naam; alleen "ja" als ze allemaal helemaal in de wijk liggen.
  assert.equal(straatWijkKeuze([{ name: "Proefstraat" }], "ANT01", map), "twijfel");
  assert.equal(straatWijkKeuze([{ name: "Peterseliestraat" }], "ANT09", map), "ja");
  // Wat streetsInWijk aan de wijk hangt, is "ja" of "twijfel" (de oude regel, voor live items).
  for (const [refs, code] of [[[kam], "ANT18"], [[kam], "ANT05"], [[pet], "ANT09"], [[{ name: "Proefstraat" }], "ANT24"]]) {
    assert.equal(straatWijkKeuze(refs, code, map) !== "nee", streetsInWijk(refs, code, map), JSON.stringify([refs, code]));
  }
});

test("een wijk met de momentopname: een item zonder punt alleen als het ondubbelzinnig in de wijk ligt", async () => {
  const { createAreaMatcher } = await import("../site/neighborhood-map.js");
  const { createAgendaView } = await import("../site/agenda-view.js");
  const { wijkFeatures, locationKey } = await import("../site/neighborhood-core.js");
  const wijken = wijkFeatures(WIJKEN);
  // De wijken per straat uit site/geo/straten.json, zoals place-view.js ze meegeeft.
  const reserve = new Map(STRATEN.filter((r) => Array.isArray(r[3]) && r[3].length).map((r) => [`${locationKey(r[1])}|${r[2]}`, new Set(r[3])]));
  assert.deepEqual([...reserve.get("kammenstraat|2000")].sort(), ["ANT09", "ANT18", "ANT22"]);
  assert.deepEqual([...reserve.get("peterseliestraat|2000")], ["ANT09"]);
  const view = createAgendaView();
  view.setAreaMatcher(createAreaMatcher({ wijken, geo: { entries: {} }, straatasMislukt: true }));
  view.setStraatWijken(reserve);
  const werk = { gipodId: 990001, streets: [KAM] }, evenement = { id: "iod:ET2099000001|EVENT|e1", streets: [KAM, PET] };
  const metPunt = { gipodId: 990002, point: [4.40112, 51.21725], streets: [KAM] };
  for (const [code, verwacht] of [["ANT18", [false, false]], ["ANT09", [false, true]], ["ANT22", [false, false]]]) {
    view.setArea({ wijk: code });
    assert.deepEqual([view.matchesStreet(werk, { strikt: true }), view.matchesStreet(evenement, { strikt: true })], verwacht, code);
    // Zonder `strikt` (een live item zonder punt): zoals vroeger, aan elke wijk van zijn straten.
    assert.equal(view.matchesStreet(werk), true, code);
    assert.equal(view.wijkTwijfel(werk), true, `${code}: twijfel`);
    // Met een punt: het punt beslist, ook strikt.
    assert.equal(view.matchesStreet(metPunt, { strikt: true }), view.matchesStreet(metPunt), code);
    assert.equal(view.wijkTwijfel(metPunt), false);
  }
  view.setArea({ wijk: "ANT09" });
  assert.equal(view.wijkTwijfel(evenement), false, "zeker in ANT09 via de Peterseliestraat");
  view.setArea({ wijk: "ANT05" });
  assert.equal(view.wijkTwijfel(werk), false, "de Kammenstraat loopt niet door ANT05");
});

test("place-view.js: op een wijk met de momentopname filtert de plek de werken strikt, en twijfel maakt die laag deels geladen", () => {
  const bron = fs.readFileSync(new URL("../site/place-view.js", import.meta.url), "utf8");
  assert.match(bron, /const uitWijkStand = \(naam\) => naam === "works" && state\.place\?\.type === "wijk" && Array\.isArray\(live\[naam\]\) && live\[naam\] === live\.bronnen\?\.straat\?\.\[naam\]\?\.items;/);
  assert.match(bron, /view\.matchesStreet\(row, \{ strikt: true \}\)/);
  assert.match(bron, /for \(const naam of twijfel\) mislukt\[naam\] = \[\.\.\.new Set\(\[\.\.\.\(mislukt\[naam\] \|\| \[\]\), \.\.\.alleOnderdelen\(naam\)\]\)\];/);
  assert.match(bron, /werkEntries\(inPlace\(live\.works, "works"\)/);
  // De andere lagen: zoals live, via hun straten (geen `naam`, dus nooit strikt).
  for (const naam of ["publicSpace", "permits", "terraces"]) assert.match(bron, new RegExp(`inPlace\\(live\\.${naam}\\)`), naam);
});
