// Parkeerverboden zonder huisnummer: elke verversing telt waarom (lib/parkeer-huisnummers.mjs).
//
// Regel van de eigenaar (26 oktober 2026): altijd het exacte huisnummer, ook bij een verhuis; het woord verhuis, de
// reden en namen nooit. Meting van 13 november 2026: bij elk bewaard parkeerverbod zonder nummer dat nog in de bron
// stond, schrijft de stad zelf "0-0" waar het nummer hoort; de keten verloor er geen enkel. Eén vorm van de stad kende
// de regel niet: een nummer met een nul ervoor ("01-5").
// Deze toetsen bewaken:
// - een nummer met een nul ervoor blijft bewaard, en "0-0" blijft zonder nummer (niets verzinnen);
// - de telling zegt per parkeerverbod zonder nummer waarom, met een vaste code;
// - het bestand en de log houden alleen codes en aantallen in: nooit een straat, een nummer, een dossier, een reden,
//   het woord verhuis of een naam;
// - de verversing schrijft de telling, de bouw en de gegevenscontrole kennen het bestand, de bronstatus waarschuwt
//   alleen als de agenda zelf een nummer van de bron niet bewaart.
// Verzonnen straten, dossiers en redenen. Elke toets schrijft alleen in een tijdelijke map.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { adresZonderHuisnummer, isPubliekParkeerAdres, noemtVerhuis, publiekParkeerAdres } from "../site/adres-privacy.js";
import { collectPublicSpace } from "../site/public-space-live-core.js";
import { resultaatVoorHistoriek } from "../lib/historiek-privacy.mjs";
import { compactPublicSpaceItem } from "../lib/live-history.mjs";
import { statusEntry } from "../lib/fetch-util.mjs";
import { privacyFindings } from "../lib/source-feed.mjs";
import { redenZonderNummer, schrijfParkeerHuisnummers, telParkeerHuisnummers } from "../lib/parkeer-huisnummers.mjs";
import { EIGEN_VERLIES, PARKEER_HUISNUMMERS_FILE, REDENEN, eigenVerlies, parkeerHuisnummerStand, validateParkeerHuisnummers } from "../lib/parkeer-huisnummers-validatie.mjs";
import { readSources } from "../scripts/build-sources.mjs";
import { refreshLiveHistory } from "../scripts/refresh-live-history.mjs";
import { checkHealth } from "../scripts/sources-health.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Verzonnen straten; "Proef 7 laan" is een straatnaam met een cijfer (zoals er echte bestaan).
const NAMEN = ["Proefstraat", "Proef 7 laan"];
const P = "Proefstraat, 2000 Antwerpen";
const T = "2099-03-10T04:22:00.000Z";
const START = Date.parse("2099-03-12T06:00:00Z");
const EINDE = Date.parse("2099-03-13T18:00:00Z");
const NAAM = "Voornaam Achternaam"; // geen echte naam: de vulling die de repo overal gebruikt
const rij = (nr, adres, extra = {}) => ({
  attributes: { OBJECTID: nr, Dossiernummer: `2099-00077${nr}`, Locatienummer: `L${nr}`, Status: "Goedgekeurd", Adres: adres, Postcode: "2000", Reden: `Aanvraag tot een verhuis ${NAAM}`, Startdatum: START, Einddatum: EINDE, EnkelWeekdagen: "0", GipodID: null, District: "ANTWERPEN", ...extra },
});
// De keten van de verversing zonder netwerk: de site maakt de plaats, de privacylaag en de opslag houden ze.
const bewaard = (features, straatnamen = NAMEN) => resultaatVoorHistoriek({ ok: true, items: collectPublicSpace({ parkingFeatures: features, straatnamen }) }).items.map(compactPublicSpaceItem);
// Wat nooit in een bestand of een log van de telling mag staan.
const VERBODEN_IN_TELLING = /verhui|Proef|Voornaam|Achternaam|2099-0007|\bL\d\b|Aanvraag|Antwerpen|\bbus\b/i;

// ---------- een nummer met een nul ervoor ----------

test("een huisnummer met een nul ervoor blijft bewaard; 0-0 blijft zonder nummer", () => {
  assert.equal(publiekParkeerAdres("Proefstraat 01-5 2000 Antwerpen", P, NAMEN), "Proefstraat 1–5, 2000 Antwerpen");
  assert.equal(publiekParkeerAdres("Proefstraat 07-07 2000 Antwerpen", P, NAMEN), "Proefstraat 7, 2000 Antwerpen");
  assert.equal(publiekParkeerAdres("Proefstraat 012-014 2000 Antwerpen", P, NAMEN), "Proefstraat 12–14, 2000 Antwerpen");
  assert.equal(publiekParkeerAdres("Proefstraat 05A-hoek 2000 Antwerpen", P, NAMEN), "Proefstraat 5A–hoek, 2000 Antwerpen");
  assert.equal(publiekParkeerAdres("Proefstraat 03/05 2000 Antwerpen", P, NAMEN), "Proefstraat 3 en 5, 2000 Antwerpen");
  // Een nul midden in of achter een nummer is geen nul ervoor.
  assert.equal(publiekParkeerAdres("Proefstraat 10-105 2000 Antwerpen", P, NAMEN), "Proefstraat 10–105, 2000 Antwerpen");
  assert.equal(publiekParkeerAdres("Proefstraat 100-100 2000 Antwerpen", P, NAMEN), "Proefstraat 100, 2000 Antwerpen");
  // Niets verzinnen: geen nummer in de bron blijft geen nummer; een 0 naast een nummer blijft dat nummer.
  for (const zonder of ["Proefstraat 0-0 2000 Antwerpen", "Proefstraat 00-00 2000 Antwerpen", "Proefstraat (2000) 00-00 2000 Antwerpen", "Proefstraat 000-0 2000 Antwerpen"]) {
    assert.equal(publiekParkeerAdres(zonder, P, NAMEN), "", zonder);
  }
  assert.equal(publiekParkeerAdres("Proefstraat 012-00 2000 Antwerpen", P, NAMEN), "Proefstraat 12, 2000 Antwerpen");
  assert.equal(publiekParkeerAdres("Proefstraat 0-012 2000 Antwerpen", P, NAMEN), "Proefstraat 12, 2000 Antwerpen");
});

test("een nummer met een nul ervoor staat exact in wat de verversing bewaart, ook bij een verhuis, zonder reden", () => {
  const [item] = bewaard([rij(1, "Proefstraat 01-5 2000 Antwerpen")]);
  assert.equal(item.location, "Proefstraat 1–5, 2000 Antwerpen");
  assert.ok(isPubliekParkeerAdres(item.location, NAMEN));
  assert.equal(item.title, "Parkeerverbod");
  assert.equal("reason" in item, false);
  assert.equal(noemtVerhuis(JSON.stringify(item)), false);
  assert.equal(JSON.stringify(item).includes("Achternaam"), false);
  // En terug naar de straat: dezelfde straat als zonder nummer (geen valse wijziging in de historiek).
  assert.equal(adresZonderHuisnummer(item.location, NAMEN), P);
});

// ---------- waarom geen nummer ----------

test("redenZonderNummer: de stad geeft geen nummer", () => {
  for (const adres of [
    "Proefstraat 0-0 2000 Antwerpen", "Proefstraat 00-00 2000 Antwerpen", "Proefstraat (2000) 0-0 2000 Antwerpen", "Proefstraat Onbekend-Onbekend 2000 Antwerpen",
    "Proefstraat hoek-hoek 2000 Antwerpen", "Proefstraat hnr nvt-hnr nvt 2000 Antwerpen", "Proefstraat 2000 Antwerpen", "PROEFSTRAAT 0-0 2000 Antwerpen",
    // Een straatnaam met een cijfer is geen huisnummer; de toevoeging van de straatas ("_AN") ook niet.
    "Proef 7 laan 0-0 2000 Antwerpen", "Proefstraat_AN 0-0 2000 Antwerpen",
  ]) assert.equal(redenZonderNummer(adres, NAMEN), "bron_zonder_nummer", adres);
  // Zonder de lijst van officiële straten telt het cijfer van zo'n straatnaam wel als een nummer: de verversing geeft de
  // lijst daarom altijd mee.
  assert.notEqual(redenZonderNummer("Proef 7 laan 0-0 2000 Antwerpen", null), "bron_zonder_nummer");
});

test("redenZonderNummer: de stad geeft een nummer en de agenda bewaart het niet (eigen verlies), met de juiste code", () => {
  // Een vorm die publiekParkeerAdres niet kent.
  for (const adres of ["Proefstraat 12-14-16 2000 Antwerpen", "Proefstraat 12 A-14 2000 Antwerpen", "Proefstraat 12-Onbekend 2000 Antwerpen"]) {
    assert.equal(publiekParkeerAdres(adres, adresZonderHuisnummer(adres, NAMEN), NAMEN), "", `${adres}: de regel kent deze vorm niet`);
    assert.equal(redenZonderNummer(adres, NAMEN), "vorm_niet_herkend", adres);
  }
  // Een bekende vorm, maar geen officiële straat ervoor (dan kan het een naam of vrije tekst zijn).
  assert.equal(redenZonderNummer("Proefstraat thv 12 2000 Antwerpen", NAMEN), "straat_niet_officieel");
  assert.equal(redenZonderNummer(`${NAAM} 12-14 2000 Antwerpen`, NAMEN), "straat_niet_officieel");
  // Een woord dat nooit bij een parkeerverbod komt.
  assert.equal(redenZonderNummer("Proefstraat verhuis 12 2000 Antwerpen", NAMEN), "verboden_woord");
  // Niet te lezen: geen postcode met gemeente.
  for (const adres of ["", "Proefstraat 12", null, undefined]) assert.equal(redenZonderNummer(adres, NAMEN), "bron_onbekend", String(adres));
  // De regel maakt er een plaats met het nummer van; staat het parkeerverbod toch zonder nummer in wat bewaard wordt,
  // dan viel het nummer later weg (zo ging het in de opslag van vóór 26 oktober 2026).
  for (const adres of ["Proefstraat 12-14 2000 Antwerpen", "Proefstraat 12 bus 3 2000 Antwerpen", "Proefstraat hoek-64 2000 Antwerpen", "Proefstraat_AN 12-14 2000 Antwerpen", "Proef 7 laan 12-14 2000 Antwerpen"]) assert.equal(redenZonderNummer(adres, NAMEN), "niet_bewaard", adres);
  for (const reden of ["vorm_niet_herkend", "straat_niet_officieel", "verboden_woord", "niet_bewaard"]) assert.ok(EIGEN_VERLIES.includes(reden) && REDENEN.includes(reden));
  assert.deepEqual(REDENEN.filter((reden) => !EIGEN_VERLIES.includes(reden)), ["bron_zonder_nummer", "bron_onbekend"]);
  // Geen code noemt het woord verhuis (dat staat nergens bij een parkeerverbod, ook niet in een telbestand).
  for (const reden of REDENEN) assert.equal(noemtVerhuis(reden), false, reden);
});

// ---------- de telling ----------

const FEATURES = [
  rij(1, "Proefstraat 12 bus 3 2000 Antwerpen"), // nummer 12
  rij(2, "Proefstraat 14-16 2000 Antwerpen"), // bereik
  rij(3, "Proefstraat 0-0 2000 Antwerpen"), // de stad geeft geen nummer
  rij(4, "Proefstraat 01-5 2000 Antwerpen"), // een nul ervoor: 1–5
  rij(5, "Proefstraat 12-14-16 2000 Antwerpen"), // een vorm die de regel niet kent
  rij(6, "Proefstraat 30-32 2000 Antwerpen", { Status: "Ingediend" }), // niet publiek: telt niet
  rij(7, "Proefweg 7 2100 Antwerpen", { Postcode: "2100" }), // buiten het district: telt niet
];

test("telParkeerHuisnummers: per bewaard parkeerverbod zonder nummer één code; de sommen kloppen", () => {
  const items = bewaard(FEATURES);
  const telling = telParkeerHuisnummers({ items, parkingFeatures: FEATURES, straatnamen: NAMEN, observedAt: T });
  assert.deepEqual(telling, {
    schemaVersion: 1, observedAt: T, totaal: 5, metNummer: 3, zonderNummer: 2,
    redenen: { bron_zonder_nummer: 1, vorm_niet_herkend: 1, straat_niet_officieel: 0, verboden_woord: 0, niet_bewaard: 0, bron_onbekend: 0 },
  });
  assert.deepEqual(validateParkeerHuisnummers(telling), []);
  assert.equal(eigenVerlies(telling), 1);
  // Uit de bron gerekend, niet vast: wat een nummer heeft, telt de regel van de opslag zelf.
  assert.equal(telling.metNummer, items.filter((item) => isPubliekParkeerAdres(item.location, NAMEN)).length);
  // Alles van de stad zonder nummer en niets verloren: geen eigen verlies.
  const alleenBron = [rij(1, "Proefstraat 12-12 2000 Antwerpen"), rij(3, "Proefstraat 0-0 2000 Antwerpen")];
  assert.equal(eigenVerlies(telParkeerHuisnummers({ items: bewaard(alleenBron), parkingFeatures: alleenBron, straatnamen: NAMEN, observedAt: T })), 0);
  // Een bewaard parkeerverbod zonder rij in de bron: bron_onbekend, nooit stil weg uit de telling.
  const los = telParkeerHuisnummers({ items: bewaard([rij(3, "Proefstraat 0-0 2000 Antwerpen")]), parkingFeatures: [], straatnamen: NAMEN, observedAt: T });
  assert.deepEqual([los.totaal, los.zonderNummer, los.redenen.bron_onbekend], [1, 1, 1]);
  // Wat bewaard wordt, heeft alleen de straat, en de bron heeft een nummer dat de regel kent: het nummer viel later weg.
  const alleenStraat = { id: "parking:2099-000771|L1", kind: "parking", location: "Proefstraat, 2000 Antwerpen" };
  const weg = telParkeerHuisnummers({ items: [alleenStraat], parkingFeatures: [rij(1, "Proefstraat 12-14 2000 Antwerpen")], straatnamen: NAMEN, observedAt: T });
  assert.deepEqual([weg.zonderNummer, weg.redenen.niet_bewaard, eigenVerlies(weg)], [1, 1, 1]);
  // Een rij die niet publiek is (nog niet goedgekeurd), telt niet mee: alleen de goedgekeurde rij zegt waarom.
  const metOntwerp = [rij(1, "Proefstraat 0-0 2000 Antwerpen"), rij(1, "Proefstraat 12-14 2000 Antwerpen", { Status: "Ingediend" })];
  assert.equal(telParkeerHuisnummers({ items: [alleenStraat], parkingFeatures: metOntwerp, straatnamen: NAMEN, observedAt: T }).redenen.bron_zonder_nummer, 1);
  // Twee goedgekeurde rijen van hetzelfde parkeerverbod, één zonder nummer en één met een nummer dat we niet bewaren:
  // dat is eigen verlies.
  const tweeRijen = [rij(1, "Proefstraat 0-0 2000 Antwerpen"), rij(1, "Proefstraat 12-14-16 2000 Antwerpen")];
  assert.equal(telParkeerHuisnummers({ items: [alleenStraat], parkingFeatures: tweeRijen, straatnamen: NAMEN, observedAt: T }).redenen.vorm_niet_herkend, 1);
  // Andere lagen (een inname, een werfzone) tellen niet mee.
  const anders = telParkeerHuisnummers({ items: [{ id: "iod:X|1|1", kind: "iod", location: "" }, { id: "sgw:GW2099-000777|1", kind: "sgw", location: "" }], parkingFeatures: [], straatnamen: NAMEN, observedAt: T });
  assert.equal(anders.totaal, 0);
});

test("de telling houdt alleen codes en aantallen in: geen straat, nummer, dossier, reden, het woord verhuis of een naam", () => {
  const features = [...FEATURES, rij(8, `${NAAM} 12-14 2000 Antwerpen`), rij(9, "Proefstraat verhuis 12 2000 Antwerpen")];
  const telling = telParkeerHuisnummers({ items: bewaard(features), parkingFeatures: features, straatnamen: NAMEN, observedAt: T });
  // Elke soort eigen verlies komt in deze telling voor: de toets kijkt dus elke code na.
  assert.deepEqual(telling.redenen, { bron_zonder_nummer: 1, vorm_niet_herkend: 1, straat_niet_officieel: 1, verboden_woord: 1, niet_bewaard: 0, bron_onbekend: 0 });
  const tekst = JSON.stringify(telling);
  assert.doesNotMatch(tekst.replace(T, ""), VERBODEN_IN_TELLING);
  assert.equal(noemtVerhuis(tekst), false);
  // Alleen de vaste sleutels, gehele getallen en het tijdstip.
  assert.match(tekst, /^\{"schemaVersion":1,"observedAt":"[0-9T:.Z-]+","totaal":\d+,"metNummer":\d+,"zonderNummer":\d+,"redenen":\{(?:"[a-z_]+":\d+,?)+\}\}$/);
  assert.deepEqual(Object.keys(telling.redenen), [...REDENEN]);
  assert.deepEqual(privacyFindings(telling), []);
  // De stand voor de eigenaar ook: aantallen en vaste woorden.
  const stand = parkeerHuisnummerStand(telling);
  for (const zin of [stand.regel.replace(T, ""), stand.waarschuwing]) {
    assert.doesNotMatch(zin, /verhui|Proef|Voornaam|Achternaam|2099-0007|Aanvraag/i);
  }
});

test("validateParkeerHuisnummers: alleen de vaste vorm; een fout noemt nooit een waarde uit het bestand", () => {
  const goed = { schemaVersion: 1, observedAt: T, totaal: 5, metNummer: 3, zonderNummer: 2, redenen: { bron_zonder_nummer: 2, vorm_niet_herkend: 0, straat_niet_officieel: 0, verboden_woord: 0, niet_bewaard: 0, bron_onbekend: 0 } };
  assert.deepEqual(validateParkeerHuisnummers(goed), []);
  const fout = (wijziging) => validateParkeerHuisnummers({ ...goed, ...wijziging });
  const GEHEIM = "Proefstraat 12 verhuis";
  for (const [naam, wijziging] of Object.entries({
    "een extra sleutel (voorbeelden)": { voorbeelden: [GEHEIM] },
    "een extra sleutel met een adres als naam": { [GEHEIM]: 1 },
    "tekst waar een aantal hoort": { totaal: GEHEIM },
    "een onbekende reden": { redenen: { ...goed.redenen, [GEHEIM]: 0 } },
    "een reden met tekst": { redenen: { ...goed.redenen, bron_onbekend: GEHEIM } },
    "een reden ontbreekt": { redenen: { bron_zonder_nummer: 2 } },
    "geen redenen": { redenen: [GEHEIM] },
    "een negatief aantal": { metNummer: -1 },
    "een kommagetal": { zonderNummer: 2.5 },
    "de som klopt niet": { totaal: 6 },
    "de redenen tellen niet op": { redenen: { ...goed.redenen, bron_zonder_nummer: 1 } },
    "geen tijdstip": { observedAt: GEHEIM },
    "een ander schema": { schemaVersion: 2 },
  })) {
    const fouten = fout(wijziging);
    assert.ok(fouten.length > 0, naam);
    assert.equal(fouten.join("\n").includes("Proef"), false, `${naam}: de fout noemt de waarde`);
    assert.equal(noemtVerhuis(fouten.join("\n")), false, `${naam}: de fout noemt het woord`);
  }
  for (const geen of [null, [], "x", 3]) assert.deepEqual(validateParkeerHuisnummers(geen), ["geen object"]);
  // Een ongeldige telling wordt nooit geschreven.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "parkeer-huisnummers-ongeldig-"));
  try {
    assert.throws(() => schrijfParkeerHuisnummers({ rootDir: root, document: { ...goed, voorbeelden: [GEHEIM] } }), /parkeer-huisnummers ongeldig/);
    assert.equal(fs.existsSync(path.join(root, "site", "sources", PARKEER_HUISNUMMERS_FILE)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("parkeerHuisnummerStand: geen waarschuwing als alleen de stad geen nummer geeft; wel bij eigen verlies", () => {
  const basis = { schemaVersion: 1, observedAt: T, totaal: 10, metNummer: 7, zonderNummer: 3, redenen: { bron_zonder_nummer: 3, vorm_niet_herkend: 0, straat_niet_officieel: 0, verboden_woord: 0, niet_bewaard: 0, bron_onbekend: 0 } };
  const rustig = parkeerHuisnummerStand(basis);
  assert.equal(rustig.waarschuwing, null);
  assert.equal(rustig.regel, `parkeer-huisnummers\tok\ttotaal=10\tmet=7\tzonder=3\tbron_zonder_nummer=3\teigen_verlies=0\tbron_onbekend=0\tobservedAt=${T}`);
  const verlies = parkeerHuisnummerStand({ ...basis, redenen: { ...basis.redenen, bron_zonder_nummer: 1, vorm_niet_herkend: 2 } });
  assert.match(verlies.regel, /^parkeer-huisnummers\tverlies\t.*\teigen_verlies=2\t/);
  assert.match(verlies.waarschuwing, /^2 van 10 parkeerverboden hebben bij de stad een huisnummer dat de agenda niet bewaart \(vorm van het nummer niet herkend: 2\)\./);
  const later = parkeerHuisnummerStand({ ...basis, redenen: { ...basis.redenen, bron_zonder_nummer: 0, niet_bewaard: 2, straat_niet_officieel: 1 } });
  assert.match(later.waarschuwing, /^3 van 10 .* \(straat geen officiële straatnaam: 1; nummer herkend maar niet bewaard: 2\)\./);
  // Een ongeldig bestand geeft geen aantallen door.
  assert.deepEqual(parkeerHuisnummerStand({ ...basis, voorbeelden: ["x"] }), { regel: "parkeer-huisnummers\tongeldig", waarschuwing: null });
});

// ---------- de verversing schrijft de telling ----------

const DISTRICT = { type: "Polygon", coordinates: [[[4.38, 51.2], [4.43, 51.2], [4.43, 51.24], [4.38, 51.24], [4.38, 51.2]]] };
const STRAAT = {
  type: "Feature",
  properties: { LSTRNMID: "9001", LSTRNM: "Proefstraat", RSTRNMID: "9001", RSTRNM: "Proefstraat", postcode: "2000", DISTRICT: "ANTWERPEN" },
  geometry: { type: "LineString", coordinates: [[4.399, 51.219], [4.401, 51.221]] },
};
// Een nagemaakte bron (geen netwerk): de straatas, de districtsgrens, geen werken, en laag 20 met `rijen`.
// `laag20Faalt`: de parkeerlaag antwoordt met een fout.
function nepFetch(rijen, { laag20Faalt = false } = {}) {
  return async (input) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/portal_publiek9/MapServer/905/")) return Response.json({ type: "FeatureCollection", features: [STRAAT] });
    if (url.pathname.includes("/portal_publiek2/MapServer/109/")) return Response.json({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: DISTRICT }] });
    if (url.pathname.endsWith("/collections/INNAME_PUNT/items") || url.pathname.endsWith("/collections/HINDER_PUNT/items")) return Response.json({ type: "FeatureCollection", features: [], links: [] });
    const laag = url.pathname.match(/\/P_ASign\/ASign\/MapServer\/(\d+)\/query$/)?.[1];
    if (laag) {
      if (laag === "20" && laag20Faalt) return new Response("", { status: 503 });
      const lijst = laag === "20" ? rijen : [];
      if (url.searchParams.get("returnIdsOnly") === "true") return Response.json({ objectIds: lijst.map((feature) => feature.attributes.OBJECTID) });
      const ids = (url.searchParams.get("objectIds") || "").split(",").map(Number);
      return Response.json({ features: lijst.filter((feature) => ids.includes(feature.attributes.OBJECTID)) });
    }
    return new Response("", { status: 404 });
  };
}

test("de verversing schrijft de telling naast de historiek: alleen aantallen, ook in de log; faalt de laag, dan blijft de vorige telling", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "parkeer-huisnummers-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const regels = [];
  const log = (regel) => regels.push(String(regel));
  const bestand = path.join(root, "site", "sources", PARKEER_HUISNUMMERS_FILE);
  const rijen = FEATURES;

  const history = await refreshLiveHistory({ rootDir: root, fetch: nepFetch(rijen), clock: () => new Date(T), log });
  const parkeer = history.layers.publicSpace.items.filter((item) => item.kind === "parking");
  assert.deepEqual(Object.fromEntries(parkeer.map((item) => [item.id.split("|")[1], item.location])), {
    L1: "Proefstraat 12, 2000 Antwerpen", L2: "Proefstraat 14–16, 2000 Antwerpen", L3: "Proefstraat, 2000 Antwerpen", L4: "Proefstraat 1–5, 2000 Antwerpen", L5: "Proefstraat, 2000 Antwerpen",
  });
  const tekst = fs.readFileSync(bestand, "utf8");
  const telling = JSON.parse(tekst);
  assert.deepEqual(telling, {
    schemaVersion: 1, observedAt: T, totaal: 5, metNummer: 3, zonderNummer: 2,
    redenen: { bron_zonder_nummer: 1, vorm_niet_herkend: 1, straat_niet_officieel: 0, verboden_woord: 0, niet_bewaard: 0, bron_onbekend: 0 },
  });
  assert.deepEqual(validateParkeerHuisnummers(telling), []);
  assert.doesNotMatch(tekst.replace(T, ""), VERBODEN_IN_TELLING);
  // De log (publiek) zegt dezelfde aantallen, zonder straat, nummer, dossier of reden.
  const gelogd = regels.map((regel) => JSON.parse(regel)).find((regel) => regel.parkeerHuisnummers)?.parkeerHuisnummers;
  assert.deepEqual(gelogd, { totaal: 5, metNummer: 3, zonderNummer: 2, redenen: telling.redenen });
  assert.doesNotMatch(regels.join("\n"), /verhui|Proefstraat|Voornaam|Achternaam|2099-0007|Aanvraag/i);

  // Een dag later antwoordt de parkeerlaag niet: de historiek houdt haar vorige stand, en de telling ook (met haar
  // eigen tijdstip, zodat te zien is dat ze oud is).
  regels.length = 0;
  const later = await refreshLiveHistory({ rootDir: root, fetch: nepFetch(rijen, { laag20Faalt: true }), clock: () => new Date("2099-03-11T04:22:00.000Z"), log });
  assert.equal(later.layers.publicSpace.status, "stale");
  assert.equal(fs.readFileSync(bestand, "utf8"), tekst);
  assert.equal(regels.some((regel) => regel.includes("parkeerHuisnummers")), false);
});

// ---------- de bouw, de gegevenscontrole en de bronstatus kennen het bestand ----------

const GELDIG = { schemaVersion: 1, observedAt: T, totaal: 5, metNummer: 3, zonderNummer: 2, redenen: { bron_zonder_nummer: 2, vorm_niet_herkend: 0, straat_niet_officieel: 0, verboden_woord: 0, niet_bewaard: 0, bron_onbekend: 0 } };

test("de bouw leest de telling niet als agendabron (anders stopt elke verversing op 'Ongeldige brondata')", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "parkeer-huisnummers-bouw-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  schrijfParkeerHuisnummers({ rootDir: root, document: GELDIG });
  const gelezen = readSources(root);
  assert.deepEqual(gelezen.documents, []);
  assert.equal(gelezen.status, null);
});

test("validate-data kent de telling: een geldige is in orde, een met een extra veld is een fout zonder de waarde", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "parkeer-huisnummers-validatie-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(path.join(repoRoot, "lib"), path.join(root, "lib"), { recursive: true });
  fs.mkdirSync(path.join(root, "scripts"));
  fs.copyFileSync(path.join(repoRoot, "scripts", "validate-data.mjs"), path.join(root, "scripts", "validate-data.mjs"));
  fs.mkdirSync(path.join(root, "site", "sources"), { recursive: true });
  for (const name of fs.readdirSync(path.join(repoRoot, "site")).filter((entry) => entry.endsWith(".js"))) fs.copyFileSync(path.join(repoRoot, "site", name), path.join(root, "site", name));
  const over = (document) => {
    fs.writeFileSync(path.join(root, "site", "sources", PARKEER_HUISNUMMERS_FILE), JSON.stringify(document));
    const run = spawnSync(process.execPath, [path.join(root, "scripts", "validate-data.mjs")], { encoding: "utf8" });
    return { regels: `${run.stdout}\n${run.stderr}`.split("\n").filter((regel) => regel.includes(PARKEER_HUISNUMMERS_FILE)), alles: `${run.stdout}\n${run.stderr}` };
  };
  assert.deepEqual(over(GELDIG).regels, []);
  const fout = over({ ...GELDIG, voorbeelden: ["Proefstraat 12 verhuis"] });
  assert.deepEqual(fout.regels, [`${PARKEER_HUISNUMMERS_FILE}: onbekende sleutel`]);
  assert.equal(fout.alles.includes("Proefstraat 12"), false);
});

test("sources:health toont de telling als regel; een waarschuwing alleen bij eigen verlies, nooit een fout en nooit in het meldingsissue", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "parkeer-huisnummers-health-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const NU = Date.parse(T) + 3_600_000;
  fs.mkdirSync(path.join(root, "site", "sources"), { recursive: true });
  const status = { schemaVersion: 1, generatedAt: T, classificationAsOf: "2099-03-10", sources: [statusEntry("district-kalender", { fetchStatus: "ok", retrievedAt: T, itemCount: 0 })] };
  fs.writeFileSync(path.join(root, "site", "sources", "refresh-status.json"), JSON.stringify(status));
  const gezond = (document) => {
    if (document) schrijfParkeerHuisnummers({ rootDir: root, document });
    return checkHealth({ rootDir: root, at: NU, baseline: null });
  };
  const zonderBestand = gezond(null);
  assert.equal(zonderBestand.lines.some((regel) => regel.startsWith("parkeer-huisnummers")), false, "vóór de eerste telling: geen regel");

  const rustig = gezond(GELDIG);
  assert.ok(rustig.lines.includes(parkeerHuisnummerStand(GELDIG).regel));
  assert.equal((rustig.meldingen || []).some((melding) => /[Pp]arkeerverbod/.test(melding.titel)), false);
  assert.equal(rustig.unhealthy, zonderBestand.unhealthy, "de telling maakt de bronstatus nooit rood");

  const VERLIES = { ...GELDIG, redenen: { ...GELDIG.redenen, bron_zonder_nummer: 1, vorm_niet_herkend: 1 } };
  const verlies = gezond(VERLIES);
  assert.deepEqual((verlies.meldingen || []).filter((melding) => /[Pp]arkeerverbod/.test(melding.titel)), [{ titel: "Parkeerverbod zonder huisnummer", tekst: parkeerHuisnummerStand(VERLIES).waarschuwing }]);
  assert.ok(verlies.warnings.includes(parkeerHuisnummerStand(VERLIES).waarschuwing));
  assert.equal(verlies.unhealthy, zonderBestand.unhealthy);
  assert.equal(verlies.exitCode, zonderBestand.exitCode);
});
