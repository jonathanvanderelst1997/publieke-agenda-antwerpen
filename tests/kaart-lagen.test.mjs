// P9 "Een kaart die vertelt": de pure delen van de buurtkaart, zonder browser. Verzonnen gegevens.
// - de kaartbibliotheken voor de e2e-toetsen (tests/helpers/kaart-fixture.mjs, tests/fixtures/kaart/);
// - de soorten op de kaart en de telling (site/place-core.js: kaartSoort, telPerSoort, lijstUniversum);
// - de pure laag van de kaart (site/kaart-lagen.js: vormen, privacy, legendafilter, popup, foutregel, kiesKaart).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { LEAFLET } from "../site/neighborhood-map.js";
import {
  KAART_SOORTEN, agendaEntry, kaartSoort, lijstAantal, lijstSleutel, lijstUniversum, marktBundelEntry, permitEntry, publicSpaceEntries,
  telPerSoort, terrasEntries, werkEntries,
} from "../site/place-core.js";
import { MAX_PER_SOORT, ONGEVEER_DECIMALEN, ONGEVEER_VORM, isTegelFout, kaartLagen, kaartMax, kiesKaart, magVectorKaart, ongeveerPolygoon, popupHtml, vormVoor } from "../site/kaart-lagen.js";
import { LEAFLET_DIR, LEAFLET_PREFIX, MAPLIBRE_PREFIX, MAPLIBRE_SRI, kaartAntwoord, sri } from "./helpers/kaart-fixture.mjs";
import { MAPLIBRE, STIJL, eigenLagen } from "../site/kaart-vector.js";

// ---- stap 1: Leaflet byte-exact uit de fixture ----
test("de Leaflet-fixture is byte-gelijk aan wat de site met SRI vraagt", () => {
  const js = fs.readFileSync(path.join(LEAFLET_DIR, "leaflet.js"));
  const css = fs.readFileSync(path.join(LEAFLET_DIR, "leaflet.css"));
  assert.equal(js.length, 147552);
  assert.equal(css.length, 14806);
  assert.equal(sri(js), LEAFLET.js.integrity);
  assert.equal(sri(css), LEAFLET.css.integrity);
  assert.equal(LEAFLET_PREFIX, "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/");
  assert.equal(LEAFLET.js.src, `${LEAFLET_PREFIX}leaflet.js`);
  assert.equal(LEAFLET.css.href, `${LEAFLET_PREFIX}leaflet.css`);
  assert.match(fs.readFileSync(path.join(LEAFLET_DIR, "LICENSE"), "utf8"), /^BSD 2-Clause License/);
});

test("kaartAntwoord: Leaflet met CORS-kop en type; al de rest null (de toets breekt het af)", () => {
  const js = kaartAntwoord(`${LEAFLET_PREFIX}leaflet.js`);
  assert.equal(js.status, 200);
  assert.deepEqual(js.headers, { "access-control-allow-origin": "*", "content-type": "text/javascript; charset=utf-8" });
  assert.equal(sri(js.body), LEAFLET.js.integrity);
  const css = kaartAntwoord(`${LEAFLET_PREFIX}leaflet.css?v=1`);
  assert.equal(css.headers["content-type"], "text/css; charset=utf-8");
  assert.equal(sri(css.body), LEAFLET.css.integrity);
  for (const url of [
    `${LEAFLET_PREFIX}images/marker-icon.png`,
    `${LEAFLET_PREFIX}../leaflet.js`,
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.3/leaflet.js",
    "https://tile.openstreetmap.org/15/16800/10900.png",
    "https://tiles.openfreemap.org/styles/positron",
    `${MAPLIBRE_PREFIX}maplibre-gl.js`, // zonder maplibreDir: niet beantwoord
  ]) assert.equal(kaartAntwoord(url), null, url);
});

test("kaartAntwoord: MapLibre alleen als de bestanden in maplibreDir de vaste SRI hebben", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kaart-fixture-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "maplibre-gl.js"), "/* geen echte MapLibre */");
  fs.writeFileSync(path.join(dir, "maplibre-gl.css"), ".verzonnen{}");
  assert.equal(kaartAntwoord(`${MAPLIBRE_PREFIX}maplibre-gl.js`, { maplibreDir: dir }), null);
  assert.equal(kaartAntwoord(`${MAPLIBRE_PREFIX}maplibre-gl.css`, { maplibreDir: dir }), null);
  assert.equal(kaartAntwoord(`${MAPLIBRE_PREFIX}maplibre-gl.min.js`, { maplibreDir: dir }), null);
  assert.deepEqual(Object.keys(MAPLIBRE_SRI), ["maplibre-gl.js", "maplibre-gl.css"]);
  assert.ok(Object.values(MAPLIBRE_SRI).every((w) => /^sha512-[A-Za-z0-9+/]{86}==$/.test(w)));
});

test("kaartAntwoord: de echte MapLibre 5.24.0 uit MAPLIBRE_DIR", { skip: process.env.MAPLIBRE_DIR ? false : "MAPLIBRE_DIR niet gezet" }, () => {
  const maplibreDir = process.env.MAPLIBRE_DIR;
  const js = kaartAntwoord(`${MAPLIBRE_PREFIX}maplibre-gl.js`, { maplibreDir });
  const css = kaartAntwoord(`${MAPLIBRE_PREFIX}maplibre-gl.css`, { maplibreDir });
  assert.equal(js?.headers["access-control-allow-origin"], "*");
  assert.equal(sri(js.body), MAPLIBRE_SRI["maplibre-gl.js"]);
  assert.equal(css?.headers["content-type"], "text/css; charset=utf-8");
});

// ---- stap 2: soorten en telling (site/place-core.js) ----
const VANDAAG = "2026-10-11";
const straat = (name) => ({ id: name, name, postcode: "2000" });
const agendapunt = (id, date, extra = {}) => agendaEntry({ id, title: "Proefconcert", date, location: "Proefplein", category: "culture", ...extra }, extra.category || "culture");
const werkStuk = (id, punt) => ({ gipodId: id, title: "Proefwerk riolering", status: "In uitvoering", owner: "Proefbeheerder", start: "2026-10-05T06:00:00Z", end: "2026-11-30T16:00:00Z", streets: [straat("Proeflaan")], point: punt });
const parkeer = (plaats) => ({ id: `parking:PV1|${plaats}`, kind: "parking", title: "Verhuis", reason: "Verhuis", reference: "PV1", location: "Proefstraat", start: "2026-10-16T22:00:00.000Z", end: "2026-10-16T22:00:00.000Z", startTime: "00:00", endTime: "23:59", status: "Goedgekeurd", streets: [straat("Proefstraat")] });
const fase = (nr, van, tot) => ({ id: `sgw:GW9|${nr}`, kind: "sgw", kindLabel: "Omleiding + Werfzone", title: "Omleiding + Werfzone", reference: "GW9", phase: String(nr), status: "vergund", start: van, end: tot, streets: [straat("Astraat"), straat("Bstraat")], werfzoneStreets: [straat("Astraat")], omleidingStreets: [straat("Bstraat")] });
const inname = (dossier, phase, type, start, straten, extra = {}) => ({ id: `iod:${dossier}|${phase}|${type}|${straten[0]}`, kind: "iod", title: type, innameType: type, reference: dossier, dossierType: "ETL", phase, hindrance: "True", description: "", start, end: start, status: "aanvraag_goedgekeurd", streets: straten.map(straat), ...extra });
const losseInname = { id: "iod:GW77|1|Container", kind: "iod", title: "Container", innameType: "Container", reference: "GW77", dossierType: "", phase: "1", start: "2026-10-20", end: "2026-10-21", status: "vergund", streets: [straat("Proefstraat")] };
const vergunning = permitEntry({ id: "omv:1", dossier: "OMV_2099000001", streets: [straat("Proefstraat")] });
const [terras] = terrasEntries([{ id: "terrace:1", terraceType: "binnen kern", status: "actief", streets: [straat("Proefplein")] }]);
const psOpties = { vandaag: VANDAAG, wijkVan: () => "" };

test("kaartSoort per bouwer: agenda, werk, parkeerverbod, werfzone, losse inname, evenementendossier, vergunning, terras", () => {
  const [werk] = werkEntries([werkStuk(90000701, [4.40, 51.2])], { vandaag: VANDAAG });
  const [parking] = publicSpaceEntries([parkeer("L1"), parkeer("L2")], psOpties);
  const [werf] = publicSpaceEntries([fase(1, "2026-10-26T06:00:00Z", "2026-10-26T16:00:00Z"), fase(2, "2026-10-27T06:00:00Z", "2026-10-28T16:00:00Z")], psOpties);
  const [los] = publicSpaceEntries([losseInname], psOpties);
  const [dossier] = publicSpaceEntries([inname("ET2099000501", "Evenement", "Parcours", "2026-10-24", ["Proefstraat"])], psOpties);
  assert.equal(kaartSoort(agendapunt("a1", "2026-10-20")), "agenda");
  assert.equal(kaartSoort(agendapunt("a2", "2026-10-20", { category: "permits" })), "agenda", "een agendapunt blijft een agendapunt, ook bij de vergunningen");
  assert.equal(kaartSoort(werk), "werken");
  assert.equal(kaartSoort(parking), "verkeer");
  assert.equal(parking.title, "Parkeerverbod");
  assert.equal(kaartSoort(werf), "verkeer");
  assert.equal(werf.title, "Werfzone met omleiding");
  assert.equal(kaartSoort(los), "verkeer");
  assert.equal(los.uid, "publicSpace:iod:GW77|1|Container");
  assert.equal(kaartSoort(dossier), "evenement");
  assert.equal(dossier.uid, "publicSpace:dossier:ET2099000501");
  assert.equal(kaartSoort(vergunning), "vergunning");
  assert.equal(kaartSoort(terras), "vergunning");
  assert.equal(kaartSoort(marktBundelEntry({ title: "Proefmarkt", location: "Proefplein" })), "agenda");
  assert.deepEqual(KAART_SOORTEN.map((s) => [s.key, s.cat, s.vorm]), [["evenement", "festival", "lijn"], ["werken", "works", "stip"], ["verkeer", "publicSpace", "streep"], ["vergunning", "permits", "ring"], ["agenda", "other", "pin"]]);
});

test("rijen: een werf in stukken, een evenementendossier, een parkeerverbod en een werfzone dragen hun rijen mee", () => {
  const stukken = [werkStuk(90000801, [4.40, 51.2]), werkStuk(90000802, [4.401, 51.2]), werkStuk(90000803, [4.402, 51.2])];
  const [werf] = werkEntries(stukken, { vandaag: VANDAAG });
  assert.deepEqual(werf.rijen, stukken);
  assert.equal(werkEntries([stukken[0]], { vandaag: VANDAAG })[0].rijen, undefined, "één stuk: het punt van het item zelf");
  // Het dossier: ook de innames buiten de gekozen plek (alle), voor het hele parcours.
  const hier = inname("ET2099000502", "Evenement", "Parcours", "2026-10-24", ["Proefstraat"]);
  const elders = inname("ET2099000502", "Opbouw", "Inname", "2026-10-23", ["Verre Proefkaai"]);
  const [dossier] = publicSpaceEntries([hier], { ...psOpties, alle: [hier, elders] });
  assert.deepEqual(dossier.rijen, [hier, elders]);
  const [parking] = publicSpaceEntries([parkeer("L1")], { ...psOpties, alle: [parkeer("L1"), parkeer("L2")] });
  assert.deepEqual(parking.rijen.map((r) => r.id), ["parking:PV1|L1", "parking:PV1|L2"]);
  const fasen = [fase(1, "2026-10-26T06:00:00Z", "2026-10-26T16:00:00Z"), fase(2, "2026-10-27T06:00:00Z", "2026-10-28T16:00:00Z")];
  assert.deepEqual(publicSpaceEntries(fasen, psOpties)[0].rijen, fasen);
});

test("telPerSoort: een agendapunt op 3 data telt 1 keer; de som per soort is het totaal", () => {
  const drieData = ["2026-10-20", "2026-10-27", "2026-11-03"].map((d, i) => agendapunt(`r${i}`, d));
  assert.deepEqual(telPerSoort(drieData).per, { evenement: 0, werken: 0, verkeer: 0, vergunning: 0, agenda: 1 });
  assert.equal(telPerSoort(drieData).totaal, 1);
  const werken = werkEntries([werkStuk(90000901, [4.40, 51.2]), { ...werkStuk(90000902, [4.41, 51.2]), title: "Ander proefwerk" }], { vandaag: VANDAAG });
  const lijst = [
    ...drieData, agendapunt("x1", "2026-10-21", { title: "Proeflezing" }),
    ...werken, ...werken, // twee keer dezelfde kaarten: één keer geteld
    ...publicSpaceEntries([parkeer("L1")], psOpties), ...publicSpaceEntries([losseInname], psOpties),
    ...publicSpaceEntries([inname("ET2099000503", "Evenement", "Parcours", "2026-10-24", ["Proefstraat"])], psOpties),
    vergunning, terras, marktBundelEntry({ title: "Proefmarkt", location: "Proefplein" }),
  ];
  const tel = telPerSoort(lijst);
  assert.deepEqual(tel.per, { evenement: 1, werken: 2, verkeer: 2, vergunning: 2, agenda: 3 });
  assert.equal(Object.values(tel.per).reduce((a, b) => a + b, 0), tel.totaal);
  assert.equal(tel.totaal, 10);
  assert.equal(tel.soortVan.get(lijstSleutel(drieData[1])), "agenda");
  assert.equal(tel.soortVan.get("publicSpace:dossier:ET2099000503"), "evenement");
  assert.equal(tel.soortVan.get("Proefmarkt|Proefplein"), "agenda", "een markt telt per titel en plek, zoals haar marktdagen");
  assert.equal(lijstSleutel(marktBundelEntry({ title: "Proefmarkt ", location: "Proefplein" })), lijstSleutel(agendapunt("md1", "2026-10-14", { title: "Proefmarkt", category: "markets" })));
  // Dezelfde sleutel bij twee soorten: het eerste voorkomen wint, de som blijft het totaal.
  const dubbel = telPerSoort([{ uid: "x:1", source: "works" }, { uid: "x:1", source: "permits" }]);
  assert.deepEqual([dubbel.per.werken, dubbel.per.vergunning, dubbel.totaal], [1, 0, 1]);
});

test("lijstUniversum: wat de lijst bij 'alles' toont; zonder start en afgelopen vallen weg, een vergunning zonder datum en iets ver in de toekomst blijven", () => {
  const zonderStart = agendapunt("z1", "", { title: "Proefactiviteit zonder datum" });
  const afgelopen = agendapunt("v1", "2026-09-01", { title: "Afgelopen proefactiviteit" });
  const ver = agendapunt("t1", "2099-05-01", { title: "Proefjubileum" });
  const morgen = agendapunt("m1", "2026-10-12", { title: "Proefvoorstelling van morgen" });
  const losseMarktdag = agendapunt("m2", "2026-10-14", { title: "Proefrommelmarkt", category: "markets" });
  // Losse dagen ver weg: de bak "later" maakt een kopie met die dag; het universum houdt het origineel.
  const losse = { ...publicSpaceEntries([inname("ET2099000504", "Evenement", "Parcours", "2040-01-01", ["Proefstraat"])], psOpties)[0], losseDagen: ["2040-01-01", "2040-02-01"] };
  const entries = [zonderStart, afgelopen, ver, morgen, morgen, losseMarktdag, losse, vergunning, terras];
  const uit = lijstUniversum(entries, VANDAAG, { markten: [{ title: "Proefmarkt", location: " Proefplein " }] });
  const uids = uit.map((e) => e.uid);
  assert.ok(!uids.includes("agenda:z1"), "zonder start: niet in de lijst");
  assert.ok(!uids.includes("agenda:v1"), "afgelopen: niet in de lijst");
  assert.ok(!uids.includes("agenda:m2"), "een losse marktdag staat niet in de lijst (alleen wekelijkse markten)");
  // Eén aanvraag zonder omschrijving en één terras blijven gewone kaarten (een bundel vanaf twee, bundelLijst).
  assert.deepEqual(uids.sort(), ["agenda:m1", "agenda:t1", "markt|Proefmarkt|Proefplein", "permits:omv:1", "publicSpace:dossier:ET2099000504", "terraces:terrace:1"]);
  assert.equal(uit.find((e) => e.uid === losse.uid), losse, "het origineel, niet de kopie van de bak 'later'");
  const tel = telPerSoort(uit);
  assert.equal(tel.totaal, 6);
  assert.deepEqual(tel.per, { evenement: 1, werken: 0, verkeer: 0, vergunning: 2, agenda: 3 });
  assert.equal(lijstAantal(entries), 8, "het oude getal telde ook wat de lijst nooit toont");
});

// ---- stap 4: de pure laag (site/kaart-lagen.js) ----
// Verzonnen vormen met zes decimalen, zoals A-Sign ze levert.
const LIJN_HIER = [[4.401234, 51.215678], [4.402345, 51.216789]];
const LIJN_ELDERS = [[4.417012, 51.216034], [4.417613, 51.216345]];
const VLAK = [[[4.405111, 51.210222], [4.405999, 51.210222], [4.405999, 51.210888], [4.405111, 51.210222]]];
const vormLijn = (l) => ({ vlakken: [], lijnen: [l] });
const coordinaten = (fc) => JSON.stringify(fc).match(/-?\d+\.\d+/g).map(Number);

test("vormVoor: een werk is een punt; een werf in stukken een punt per stuk", () => {
  const [werk] = werkEntries([werkStuk(90001001, [4.400111, 51.200222])], { vandaag: VANDAAG });
  assert.deepEqual(vormVoor(werk), [{ geometry: { type: "Point", coordinates: [4.400111, 51.200222] }, parcours: false, ongeveer: false }]);
  const [werf] = werkEntries([werkStuk(90001002, [4.40, 51.2]), werkStuk(90001003, [4.401, 51.2]), werkStuk(90001004, null)], { vandaag: VANDAAG });
  assert.deepEqual(vormVoor(werf)[0].geometry, { type: "MultiPoint", coordinates: [[4.40, 51.2], [4.401, 51.2]] });
  assert.equal(vormVoor(werkEntries([werkStuk(90001005, null)], { vandaag: VANDAAG })[0]), null);
});

test("vormVoor: een werfzone geeft een vlak (de werfzone) en een lijn (de omleiding), exact", () => {
  const rijen = [{ ...fase(1, "2026-10-26T06:00:00Z", "2026-10-26T16:00:00Z"), vorm: { vlakken: [VLAK], lijnen: [LIJN_HIER] } }, { ...fase(2, "2026-10-27T06:00:00Z", "2026-10-28T16:00:00Z"), vorm: { vlakken: [], lijnen: [LIJN_ELDERS] } }];
  const [werf] = publicSpaceEntries(rijen, psOpties);
  const delen = vormVoor(werf);
  assert.deepEqual(delen.map((d) => [d.geometry.type, d.ongeveer]), [["Polygon", false], ["MultiLineString", false]]);
  assert.deepEqual(delen[0].geometry.coordinates, VLAK);
  assert.deepEqual(delen[1].geometry.coordinates, [LIJN_HIER, LIJN_ELDERS]);
});

// Nakijkbevinding (P9-review, privacy): de parkeerverboden en andere innames van een evenementendossier stonden
// exact op de kaart (een vlak of lijn, zonder "bij benadering"), ook die buiten de gekozen plek, terwijl de zin
// onder de kaart zegt dat parkeerverboden en innames er bij benadering staan. Alleen het parcours staat exact.
test("vormVoor: van een evenementendossier staat het parcours exact; de parkeerverboden en andere innames, ook elders, zijn een punt bij benadering", () => {
  const parcours = inname("ET2099000601", "Evenement", "Parcours", "2026-10-24", ["Proefstraat"], { vorm: vormLijn(LIJN_HIER), parcours: vormLijn(LIJN_HIER) });
  const opbouw = inname("ET2099000601", "Opbouw", "Parkeerverbod in Straat", "2026-10-23", ["Verre Proefkaai"], { vorm: vormLijn(LIJN_ELDERS) });
  const afbraak = inname("ET2099000601", "Afbraak", "Parkeerverbod in Straat", "2026-10-25", ["Verre Proefkaai"], { vorm: vormLijn(LIJN_ELDERS) });
  const podium = inname("ET2099000601", "Evenement", "Podium", "2026-10-24", ["Proefstraat"], { vorm: { vlakken: [VLAK], lijnen: [] } });
  const [dossier] = publicSpaceEntries([parcours], { ...psOpties, alle: [parcours, opbouw, afbraak, podium] });
  assert.equal(dossier.uid, "publicSpace:dossier:ET2099000601");
  const delen = vormVoor(dossier);
  assert.deepEqual(delen.map((d) => [d.geometry.type, d.parcours, d.ongeveer]), [["LineString", true, false], ["MultiPoint", false, true]]);
  assert.deepEqual(delen[0].geometry.coordinates, LIJN_HIER, "het parcours exact");
  // Opbouw en afbraak op dezelfde plek: één punt; het podium (een vlak) een tweede. Afgerond op 3 decimalen.
  assert.deepEqual(delen[1].geometry.coordinates, [[4.417, 51.216], [4.406, 51.211]]);
  const { fc } = kaartLagen([dossier]);
  assert.ok(fc.features.every((f) => f.properties.soort === "evenement"));
  const origineel = new Set([...LIJN_ELDERS, ...VLAK[0]].flat());
  assert.deepEqual(coordinaten(fc).filter((n) => origineel.has(n)), [], "geen coördinaat van een inname van het evenement");
  // De popup zegt het: het parcours exact, de andere innames bij benadering.
  assert.match(popupHtml([dossier], VANDAAG), /bij benadering \(privacy\)/);
  // Zonder parcours bij de rijen: de schets van de verversing, en de innames nog altijd bij benadering.
  const [zonder] = publicSpaceEntries([opbouw], { ...psOpties, alle: [opbouw], uitleg: { evenementen: { ET2099000601: { kaart: [LIJN_HIER], straten: ["Proefstraat"] } } } });
  assert.deepEqual(vormVoor(zonder).map((d) => [d.geometry.type, d.parcours, d.ongeveer]), [["LineString", true, false], ["Point", false, true]]);
  // Een evenement met alleen innames (geen parcours, geen schets): één punt bij benadering, geen lijn.
  assert.deepEqual(vormVoor({ ...zonder, kaart: [] }).map((d) => [d.geometry.type, d.ongeveer]), [["Point", true]]);
  assert.match(popupHtml([{ ...zonder, kaart: [] }], VANDAAG), /Plek bij benadering \(privacy\)/);
});

// Nakijkbevinding (P9b, ronde 1, privacy): het herstel hierboven rondde elke rij van een evenement af die geen parcours
// is, ook een omleiding en een verkeersvrije zone, terwijl het plan zegt dat omleidingen exact staan. Die twee zijn
// verkeersmaatregelen van het evenement op de openbare weg, geen inname van een plek door iemand: exact. Parkeerverboden,
// "Inname", "Blokken op shot" en wat de kaart niet kent, blijven één afgerond punt.
const LIJN_PV = [[4.408123, 51.213456], [4.408789, 51.213987]];
test("vormVoor: van een evenementendossier staan parcours, omleiding en verkeersvrije zone exact; parkeerverboden en andere innames bij benadering", () => {
  const parcours = inname("ET2099000604", "Evenement", "Parcours", "2026-10-24", ["Proefstraat"], { vorm: vormLijn(LIJN_HIER), parcours: vormLijn(LIJN_HIER) });
  const omleiding = inname("ET2099000604", "Evenement", "Omleiding", "2026-10-24", ["Verre Proefkaai"], { vorm: vormLijn(LIJN_ELDERS) });
  const vrij = inname("ET2099000604", "Evenement", "Verkeersvrije Zone", "2026-10-24", ["Proefplein"], { vorm: { vlakken: [VLAK], lijnen: [] } });
  const pv = inname("ET2099000604", "Opbouw", "Parkeerverbod in Straat", "2026-10-23", ["Proefdreef"], { vorm: vormLijn(LIJN_PV) });
  const blokken = inname("ET2099000604", "Evenement", "Blokken op shot", "2026-10-24", ["Proefdreef"], { vorm: vormLijn(LIJN_PV) });
  const [dossier] = publicSpaceEntries([parcours], { ...psOpties, alle: [parcours, omleiding, vrij, pv, blokken] });
  const delen = vormVoor(dossier);
  assert.deepEqual(delen.map((d) => [d.geometry.type, d.parcours, d.ongeveer]), [["LineString", true, false], ["Polygon", false, false], ["LineString", false, false], ["Point", false, true]]);
  assert.deepEqual(delen[0].geometry.coordinates, LIJN_HIER, "het parcours exact");
  assert.deepEqual(delen[1].geometry.coordinates, VLAK, "de verkeersvrije zone exact");
  assert.deepEqual(delen[2].geometry.coordinates, LIJN_ELDERS, "de omleiding exact");
  // Het parkeerverbod en de blokken op dezelfde plaats: één afgerond punt, en hun eigen coördinaten nergens.
  assert.deepEqual(delen[3].geometry.coordinates, [4.408, 51.214]);
  const { fc } = kaartLagen([dossier]);
  assert.ok(fc.features.every((f) => f.properties.soort === "evenement"));
  const origineel = new Set(LIJN_PV.flat());
  assert.deepEqual(coordinaten(fc).filter((n) => origineel.has(n)), [], "geen coördinaat van een parkeerverbod of inname van het evenement");
  assert.match(popupHtml([dossier], VANDAAG), /Parcours, omleidingen en verkeersvrije zones exact; parkeerverboden en andere innames bij benadering \(privacy\)/);
  // Alleen een omleiding (geen parcours, geen schets): een exacte lijn, en de popup zegt niets over benadering.
  const [alleenOmleiding] = publicSpaceEntries([omleiding], { ...psOpties, alle: [omleiding] });
  assert.deepEqual(vormVoor({ ...alleenOmleiding, kaart: [] }).map((d) => [d.geometry.type, d.parcours, d.ongeveer]), [["LineString", false, false]]);
  assert.doesNotMatch(popupHtml([{ ...alleenOmleiding, kaart: [] }], VANDAAG), /benadering/);
  // Zonder live parcours komt de schets er nog altijd bij, naast de omleiding.
  const [metSchets] = publicSpaceEntries([omleiding], { ...psOpties, alle: [omleiding], uitleg: { evenementen: { ET2099000604: { kaart: [LIJN_HIER], straten: ["Proefstraat"] } } } });
  assert.deepEqual(vormVoor(metSchets).map((d) => [d.geometry.type, d.parcours, d.ongeveer]), [["LineString", true, false], ["LineString", false, false]]);
});

test("vormVoor: zonder live vorm komt de lijn van het evenement uit de schets van de verversing (entry.kaart)", () => {
  const rij = inname("ET2099000602", "Evenement", "Parcours", "2026-10-24", ["Proefstraat"]);
  const kaart = [[[4.4, 51.21], [4.401, 51.211], [4.402, 51.211]]];
  const [dossier] = publicSpaceEntries([rij], { ...psOpties, uitleg: { evenementen: { ET2099000602: { kaart, straten: ["Proefstraat"] } } } });
  assert.deepEqual(dossier.kaart, kaart);
  assert.deepEqual(vormVoor(dossier), [{ geometry: { type: "LineString", coordinates: kaart[0] }, parcours: true, ongeveer: false }]);
  assert.equal(vormVoor({ ...dossier, kaart: [] }), null);
});

test("privacy: een parkeerverbod en een vergunning zijn één punt met 3 decimalen; geen oorspronkelijke coördinaat in de GeoJSON", () => {
  const perceel = { vlakken: [[[[4.403456, 51.212345], [4.403987, 51.212345], [4.403987, 51.212876], [4.403456, 51.212345]]]], lijnen: [] };
  const aanvraag = permitEntry({ id: "omv:7", dossier: "OMV_2099000007", streets: [straat("Proefstraat")], vorm: perceel });
  const [parking] = publicSpaceEntries([{ ...parkeer("L1"), vorm: vormLijn(LIJN_HIER) }, { ...parkeer("L2"), vorm: vormLijn(LIJN_ELDERS) }], psOpties);
  const [los] = publicSpaceEntries([{ ...losseInname, vorm: { vlakken: [VLAK], lijnen: [] } }], psOpties);
  for (const entry of [aanvraag, parking, los]) {
    const delen = vormVoor(entry);
    assert.equal(delen.length, 1);
    assert.equal(delen[0].geometry.type, "Point");
    assert.equal(delen[0].ongeveer, true);
    for (const c of delen[0].geometry.coordinates) assert.ok(Math.abs(c * 1000 - Math.round(c * 1000)) < 1e-6, `${c} heeft hoogstens 3 decimalen`);
  }
  // Het parkeerverbod op twee plaatsen: één punt bij de rij op de gekozen plek (het midden van LIJN_HIER).
  assert.deepEqual(vormVoor(parking)[0].geometry.coordinates, [4.402, 51.216]);
  assert.equal(ONGEVEER_DECIMALEN, 3);
  const { fc } = kaartLagen([aanvraag, parking, los]);
  assert.equal(fc.features.length, 3);
  assert.ok(fc.features.every((f) => f.properties.ongeveer && f.geometry.type === "Point"));
  const origineel = new Set([...LIJN_HIER, ...LIJN_ELDERS, ...VLAK[0], ...perceel.vlakken[0][0]].flat());
  const verraden = coordinaten(fc).filter((n) => origineel.has(n));
  assert.deepEqual(verraden, [], "geen enkele oorspronkelijke coördinaat");
});

test("kaartLagen: properties, een terras in `zonder`, een verborgen soort, max en de agendapinnen", () => {
  const geo = { entries: { proefplein: { point: [4.4011, 51.2111] } } };
  const werken = werkEntries([1, 2, 3, 4, 5].map((i) => ({ ...werkStuk(90001100 + i, [[4.401, 4.402, 4.403, 4.404, 4.405][i - 1], 51.2]), title: `Proefwerk ${"abcde"[i - 1]}` })), { vandaag: VANDAAG });
  assert.equal(werken.length, 5);
  const [parking] = publicSpaceEntries([{ ...parkeer("L1"), vorm: vormLijn(LIJN_HIER) }], psOpties);
  const drieData = ["2026-10-20", "2026-10-27", "2026-11-03"].map((d, i) => agendapunt(`p${i}`, d));
  const zonderPlek = agendapunt("q1", "2026-10-22", { title: "Proefquiz", location: "Onbekende proefzaal" });
  const teken = [...werken, parking, terras, ...drieData, zonderPlek, zonderPlek];
  const tel = telPerSoort(teken);
  const alles = kaartLagen(teken, { geo, soortVan: tel.soortVan });
  for (const f of alles.fc.features) assert.deepEqual(Object.keys(f.properties).sort(), ["cat", "ongeveer", "parcours", "soort", "tel", "uid"]);
  assert.deepEqual(alles.fc.features.find((f) => f.properties.soort === "verkeer").properties, { uid: parking.uid, tel: parking.uid, soort: "verkeer", cat: "publicSpace", parcours: false, ongeveer: true });
  assert.ok(alles.fc.features.filter((f) => f.properties.soort === "werken").every((f) => f.properties.cat === "works"));
  assert.deepEqual(alles.zonder.map((e) => e.uid), [terras.uid, "agenda:q1"], "het terras en het agendapunt zonder plek (één keer)");
  assert.equal(alles.pins.length, 1);
  assert.deepEqual(alles.pins[0].point, [4.4011, 51.2111]);
  assert.deepEqual(alles.pins[0].uids, ["agenda:p0", "agenda:p1", "agenda:p2"]);
  assert.deepEqual(alles.perSoort, { evenement: 0, werken: 5, verkeer: 1, vergunning: 0, agenda: 1 });
  assert.equal(alles.opKaart, 7);
  assert.deepEqual(alles.kaderVan.get(werken[0].uid), [4.401, 51.2, 4.401, 51.2]);
  assert.deepEqual(alles.kader, [4.401, 51.2, 4.405, 51.216]);
  // Verkeer verborgen: weg uit fc, maar de telling van de lijst verandert niet.
  const zonderVerkeer = kaartLagen(teken, { geo, soortVan: tel.soortVan, verborgen: new Set(["verkeer"]) });
  assert.equal(zonderVerkeer.fc.features.filter((f) => f.properties.soort === "verkeer").length, 0);
  assert.equal(zonderVerkeer.perSoort.verkeer, 0);
  assert.equal(zonderVerkeer.opKaart, 6);
  assert.deepEqual(telPerSoort(teken), tel);
  // max=2 bij 5 werken: 2 getekende werken.
  const twee = kaartLagen(teken, { geo, max: 2 });
  assert.equal(twee.fc.features.filter((f) => f.properties.soort === "werken").length, 2);
  assert.equal(twee.perSoort.werken, 2);
});

// Wens van 12 oktober 2026 ("bij de straat zelf ... gewoon alle data die je hebt"): met een gekozen plek tekent de
// kaart alles van die plek. Alleen het hele district zonder plek houdt MAX_PER_SOORT. Meting op de echte feed: de
// drukste straat had hoogstens 45 kaartjes van één soort, postcode 2000 met het hele district 1.232 vergunningen.
test("kaartMax: met een plek geen grens per soort, zonder plek MAX_PER_SOORT", () => {
  assert.equal(MAX_PER_SOORT, 600);
  assert.equal(kaartMax(true), Infinity);
  assert.equal(kaartMax(false), MAX_PER_SOORT);
  assert.equal(kaartMax(), MAX_PER_SOORT);
  const n = MAX_PER_SOORT + 50;
  // Een eigen titel per werk, in letters (cijfers in de titel tellen niet: dan zou het één werf in stukken zijn).
  const letters = (i) => `${"abcdefghijklmnopqrstuvwxyz"[Math.floor(i / 26)]}${"abcdefghijklmnopqrstuvwxyz"[i % 26]}`;
  const werken = werkEntries(Array.from({ length: n }, (_, i) => ({ ...werkStuk(90100000 + i, [4.40 + (i % 100) * 0.0001, 51.20 + Math.floor(i / 100) * 0.0001]), title: `Proefwerk ${letters(i)}` })), { vandaag: VANDAAG });
  assert.equal(werken.length, n, "elk verzonnen werk is een eigen kaart");
  const metPlek = kaartLagen(werken, { max: kaartMax(true) });
  assert.equal(metPlek.perSoort.werken, n, "met een plek: alles op de kaart");
  assert.equal(metPlek.opKaart, n);
  const district = kaartLagen(werken, { max: kaartMax(false) });
  assert.equal(district.perSoort.werken, MAX_PER_SOORT, "zonder plek: de grens van het district");
});

// Nakijkbevindingen (P9-review, toegankelijkheid): (1) een parkeerverbod of losse inname bij benadering kreeg
// dezelfde ring als een vergunning, alleen de kleur verschilde; (2) kaartjes bij benadering op hetzelfde afgeronde
// punt lagen op Leaflet als identieke paden op elkaar: alleen het bovenste was aan te tikken.
test("plekken bij benadering: elke soort een eigen vorm (vergunning een ring, verkeer een vierkant, de innames van een evenement een ruit)", () => {
  assert.deepEqual({ ...ONGEVEER_VORM }, { evenement: "ruit", verkeer: "vierkant", vergunning: "ring" });
  const p = [4.402, 51.216];
  const ring = ongeveerPolygoon(p, "vergunning"), vierkant = ongeveerPolygoon(p, "verkeer"), ruit = ongeveerPolygoon(p, "evenement");
  for (const g of [ring, vierkant, ruit]) {
    assert.equal(g.type, "Polygon");
    const r = g.coordinates[0];
    assert.deepEqual(r[0], r.at(-1), "een gesloten ring");
  }
  const hoeken = (g) => g.coordinates[0].length - 1;
  assert.equal(hoeken(vierkant), 4);
  assert.equal(hoeken(ruit), 4);
  assert.ok(hoeken(ring) >= 24, "een ring is rond");
  // Het vierkant staat recht, de ruit op een punt: geen twee dezelfde vormen.
  const [[x0, y0], [x1, y1]] = vierkant.coordinates[0];
  assert.ok(Math.abs(y0 - y1) < 1e-12 && x1 > x0, "een zijde van het vierkant ligt horizontaal");
  assert.ok(ruit.coordinates[0].some(([x, y]) => Math.abs(x - p[0]) < 1e-12 && y > p[1]), "de ruit heeft een punt recht boven het midden");
  // Ongeveer ONGEVEER_STRAAL meter rond het punt: zo groot als de ring op de kaart was (60 m).
  const noord = Math.max(...ring.coordinates[0].map(([, y]) => y));
  assert.ok(Math.abs((noord - p[1]) * 111320 - 60) < 1, `${(noord - p[1]) * 111320} m`);
});

test("kaartLagen: kaartjes bij benadering op hetzelfde afgeronde punt staan samen in `ongeveer`; een tik op een van hun vormen noemt ze allemaal", () => {
  const perceel = { vlakken: [[[[4.401800, 51.215900], [4.402200, 51.215900], [4.402200, 51.216100], [4.401800, 51.215900]]]], lijnen: [] };
  const aanvraag = permitEntry({ id: "omv:8", dossier: "OMV_2099000008", streets: [straat("Proefstraat")], vorm: perceel });
  const [parking] = publicSpaceEntries([{ ...parkeer("L1"), vorm: vormLijn(LIJN_HIER) }], psOpties);
  const [los] = publicSpaceEntries([{ ...losseInname, vorm: { vlakken: [VLAK], lijnen: [] } }], psOpties);
  const lagen = kaartLagen([aanvraag, parking, los]);
  // Het perceel en het parkeerverbod liggen allebei bij (4.402, 51.216); de losse inname elders.
  assert.deepEqual(lagen.ongeveer.map((g) => [g.point, g.soort, g.uids, g.samen]), [
    [[4.402, 51.216], "vergunning", [aanvraag.uid], [aanvraag.uid, parking.uid]],
    [[4.402, 51.216], "verkeer", [parking.uid], [aanvraag.uid, parking.uid]],
    [[4.406, 51.211], "verkeer", [los.uid], [los.uid]],
  ]);
  // Elk een eigen vorm, in de soort van het kaartje.
  assert.deepEqual(lagen.ongeveer.map((g) => g.vorm), ["ring", "vierkant", "vierkant"]);
  assert.deepEqual(lagen.ongeveer[0].geometry, ongeveerPolygoon([4.402, 51.216], "vergunning"));
  assert.deepEqual(lagen.ongeveer[1].geometry, ongeveerPolygoon([4.402, 51.216], "verkeer"));
  // De vormen komen alleen uit het afgeronde punt: geen enkele oorspronkelijke coördinaat.
  const origineel = new Set([...LIJN_HIER, ...VLAK[0], ...perceel.vlakken[0][0]].flat());
  assert.deepEqual(coordinaten(lagen.ongeveer).filter((n) => origineel.has(n)), []);
  // Een verborgen soort valt ook hier weg; de andere kaartjes op dat punt blijven.
  const zonderVerkeer = kaartLagen([aanvraag, parking, los], { verborgen: new Set(["verkeer"]) });
  assert.deepEqual(zonderVerkeer.ongeveer.map((g) => [g.soort, g.samen]), [["vergunning", [aanvraag.uid]]]);
});

test("popupHtml: hoogstens 6, alles geëscaped, een knop naar de lijst en 'plek bij benadering'", () => {
  const boos = agendapunt("x<1>", "2026-10-20", { title: `<script>alert("x")</script>`, location: `Plein "<b>"` });
  const html = popupHtml([boos], VANDAAG);
  assert.doesNotMatch(html, /<script>|<b>/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.match(html, /<button type="button" class="buurt-open" data-open-uid="agenda:x&lt;1&gt;">Toon in de lijst<\/button>/);
  assert.doesNotMatch(html, /bij benadering/);
  const [parking] = publicSpaceEntries([parkeer("L1")], psOpties);
  assert.match(popupHtml([parking], VANDAAG), /Plek bij benadering \(privacy\)/);
  const acht = Array.from({ length: 8 }, (_, i) => agendapunt(`z${i}`, `2026-10-2${i}`, { title: `Proefavond ${i}` }));
  const veel = popupHtml([...acht, acht[0]], VANDAAG);
  assert.equal(veel.match(/data-open-uid=/g).length, 6);
  assert.match(veel, /en nog 2 …/);
});

test("isTegelFout: alleen fouten van de tegelbron of met een URL van OpenFreeMap", () => {
  assert.equal(isTegelFout({ sourceId: "openmaptiles", error: new Error("x") }), true);
  assert.equal(isTegelFout({ error: Object.assign(new Error("Failed to fetch"), { url: "https://tiles.openfreemap.org/planet/20990101_001001_pt/14/8400/5450.pbf" }) }), true);
  assert.equal(isTegelFout({ error: new Error("AJAXError: Not Found (404): https://tiles.openfreemap.org/planet") }), true);
  assert.equal(isTegelFout({ error: new Error('Source layer "proef" does not exist on source "openmaptiles" as specified by style layer "x".') }), false);
  assert.equal(isTegelFout({ error: new Error("Image \"proef\" could not be loaded.") }), false);
  assert.equal(isTegelFout({ sourceId: "pa-items", error: new Error("x") }), false);
  assert.equal(isTegelFout({ error: { url: "https://example.invalid/openfreemap.org/x" } }), false);
  assert.equal(isTegelFout(undefined), false);
});

test("kiesKaart: de vector lukt, faalt of hangt; zonder vector; ook de basis faalt (wachttijd 20 ms)", async () => {
  const basis = async () => "basis";
  let signaal = null, gevraagd = 0;
  assert.equal(await kiesKaart({ magVector: true, vector: async (s) => { signaal = s; return "vector"; }, basis: () => assert.fail("geen basis"), wachttijd: 20 }), "vector");
  assert.equal(signaal.aborted, false);
  assert.equal(await kiesKaart({ magVector: true, vector: async (s) => { signaal = s; throw new Error("geen WebGL"); }, basis, wachttijd: 20 }), "basis");
  assert.equal(signaal.aborted, true);
  assert.equal(await kiesKaart({ magVector: true, vector: (s) => { signaal = s; return new Promise(() => {}); }, basis, wachttijd: 20 }), "basis");
  assert.equal(signaal.aborted, true, "de hangende vector krijgt een abort");
  assert.equal(await kiesKaart({ magVector: false, vector: () => { gevraagd += 1; return "vector"; }, basis, wachttijd: 20 }), "basis");
  assert.equal(gevraagd, 0, "zonder WebGL, met databesparing of ?kaart=leaflet: de vector wordt niet eens gevraagd");
  await assert.rejects(kiesKaart({ magVector: true, vector: async () => { throw new Error("stijl niet bereikbaar"); }, basis: async () => { throw new Error("Leaflet kon niet laden"); }, wachttijd: 20 }), /Leaflet kon niet laden/);
  // Te laat toch klaar: de vectorkaart wordt opgeruimd, de basis blijft.
  let opgeruimd = false;
  const laat = { verwijder: () => { opgeruimd = true; } };
  assert.equal(await kiesKaart({ magVector: true, vector: () => new Promise((r) => setTimeout(() => r(laat), 60)), basis, wachttijd: 20 }), "basis");
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(opgeruimd, true);
});

// Nakijkbevinding (P9-review, terugval): op een trage gsm-verbinding haalde de vectorkaart de 8 s niet. kiesKaart
// gooide dan een kaart weg die bijna klaar was (de eerste tegel was binnen, de letters nog niet) en laadde Leaflet er
// nog bovenop: beide kaarten gedownload, en de kaart 7 s later dan met Leaflet alleen.
test("kiesKaart: een vectorkaart met haar eerste tegel binnen wordt niet meer op de klok weggegooid (één keer nog een wachttijd)", async () => {
  const basis = async () => "basis";
  let opgeruimd = 0;
  const kaart = { verwijder: () => { opgeruimd += 1; } };
  // De wachttijd is 40 ms; de eerste tegel na 25 ms, klaar na 50 ms (vroeger: weggegooid na 40 ms).
  const bijna = (s, { bijnaKlaar }) => new Promise((r) => { setTimeout(() => bijnaKlaar(), 25); setTimeout(() => r(kaart), 50); });
  assert.equal(await kiesKaart({ magVector: true, vector: bijna, basis, wachttijd: 40 }), kaart);
  assert.equal(opgeruimd, 0);
  // Nog eens bijna klaar zeggen verlengt niet: hangt ze daarna, dan toch de basis (na wachttijd + nawacht).
  let signaal = null;
  const hangt = (s, { bijnaKlaar }) => { signaal = s; setTimeout(() => bijnaKlaar(), 5); setTimeout(() => bijnaKlaar(), 30); return new Promise(() => {}); };
  const start = Date.now();
  assert.equal(await kiesKaart({ magVector: true, vector: hangt, basis, wachttijd: 20, nawacht: 40 }), "basis");
  assert.ok(Date.now() - start >= 40, `${Date.now() - start} ms`);
  assert.equal(signaal.aborted, true);
});

// Nakijkbevinding (P9b, ronde 1): in Safari en Firefox (geen navigator.connection, dus geen schatting van de verbinding)
// brak de klok de vectorkaart af als de eerste tegel net na de wachttijd binnenkwam, ook als de stijl en MapLibre
// aantoonbaar binnen waren: dan downloadde de bewoner MapLibre en Leaflet. Elke stap die binnen is (`voortgang`: de
// stijl, MapLibre) geeft de volgende stap opnieuw de wachttijd, tot hoogstens `maxWacht`; de eerste tegel daarna nog
// één keer `nawacht`.
test("kiesKaart: zolang de vectorkaart aantoonbaar vordert (stijl, MapLibre), groeit de wachttijd mee, tot hoogstens maxWacht", async () => {
  const basis = async () => "basis";
  let opgeruimd = 0;
  const kaart = { verwijder: () => { opgeruimd += 1; } };
  // Wachttijd 30 ms: de stijl na 20, MapLibre na 40, de eerste tegel na 60, klaar na 75 (vroeger: weggegooid na 30 ms).
  const traag = (s, h = {}) => new Promise((r) => { setTimeout(() => h.voortgang?.(), 20); setTimeout(() => h.voortgang?.(), 40); setTimeout(() => h.bijnaKlaar?.(), 60); setTimeout(() => r(kaart), 75); });
  assert.equal(await kiesKaart({ magVector: true, vector: traag, basis, wachttijd: 30, maxWacht: 200 }), kaart);
  assert.equal(opgeruimd, 0);
  // Een stap die te lang duurt, ook na voortgang: de basis (na de wachttijd van die stap).
  const blijftHangen = (s, h = {}) => { setTimeout(() => h.voortgang?.(), 10); return new Promise(() => {}); };
  let start = Date.now();
  assert.equal(await kiesKaart({ magVector: true, vector: blijftHangen, basis, wachttijd: 30, maxWacht: 200 }), "basis");
  assert.ok(Date.now() - start >= 38 && Date.now() - start < 150, `${Date.now() - start} ms`);
  // Vordert ze steeds, maar wordt ze nooit klaar: toch de basis, na hoogstens maxWacht, met een abort.
  let signaal = null;
  const vordertAltijd = (s, h = {}) => { signaal = s; const tik = setInterval(() => (s.aborted ? clearInterval(tik) : h.voortgang?.()), 10); return new Promise(() => {}); };
  start = Date.now();
  assert.equal(await kiesKaart({ magVector: true, vector: vordertAltijd, basis, wachttijd: 30, maxWacht: 80 }), "basis");
  const duur = Date.now() - start;
  assert.ok(duur >= 78 && duur < 200, `${duur} ms`);
  assert.equal(signaal.aborted, true);
});

test("magVectorKaart: niet met ?kaart=leaflet, databesparing, een trage verbinding (lager dan 4g) of zonder WebGL", () => {
  const webgl = () => true;
  assert.equal(magVectorKaart({ webgl }), true, "geen Network Information API (Safari, Firefox): de vectorkaart mag");
  assert.equal(magVectorKaart({ verbinding: { effectiveType: "4g", saveData: false }, webgl }), true);
  for (const traag of ["3g", "2g", "slow-2g"]) assert.equal(magVectorKaart({ verbinding: { effectiveType: traag }, webgl }), false, traag);
  assert.equal(magVectorKaart({ verbinding: { effectiveType: "4g", saveData: true }, webgl }), false);
  assert.equal(magVectorKaart({ kaart: "leaflet", webgl }), false);
  assert.equal(magVectorKaart({ webgl: () => false }), false);
  // WebGL wordt pas getoetst (een proefcanvas) als de rest het toelaat.
  let getoetst = 0;
  assert.equal(magVectorKaart({ verbinding: { effectiveType: "3g" }, webgl: () => { getoetst += 1; return true; } }), false);
  assert.equal(getoetst, 0);
});

test("kaart-lagen.js raakt geen DOM aan en importeert in Node", async () => {
  const bron = fs.readFileSync(new URL("../site/kaart-lagen.js", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(bron, /\b(document|window)\./);
  const mod = await import("../site/kaart-lagen.js");
  assert.deepEqual(Object.keys(mod).sort(), ["MAX_PER_SOORT", "ONGEVEER_DECIMALEN", "ONGEVEER_STRAAL", "ONGEVEER_VORM", "isTegelFout", "kaartLagen", "kaartMax", "kiesKaart", "magVectorKaart", "ongeveerPolygoon", "popupHtml", "vormVoor"]);
});

// ---- stap 8: de vectorkaart (site/kaart-vector.js) ----
test("MAPLIBRE: precies 5.24.0 van cdnjs (de laatste met een JS-bestand), met de vaste SRI, crossOrigin en geen referrer", () => {
  assert.equal(MAPLIBRE.versie, "5.24.0");
  assert.equal(MAPLIBRE.js.src, "https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.24.0/maplibre-gl.js");
  assert.equal(MAPLIBRE.css.href, "https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.24.0/maplibre-gl.css");
  assert.equal(MAPLIBRE.js.integrity, "sha512-rOFgoUgWaVi69JW1dzBu6PWF9xKW9rxYfY5u2SexFABHhWk0qUWkJoWNz4UuZRMvSXsNZG66+tU5B+HlwWF5kA==");
  assert.equal(MAPLIBRE.css.integrity, "sha512-KIMsMWIdnoG9OwZa+oaIafmbDonqck1UCmq+/zcUi2aaZ97N9QE6TqpTM+n36EO40HGh64hU/375zxtjx7WTyQ==");
  assert.equal(MAPLIBRE.crossOrigin, "anonymous");
  assert.equal(MAPLIBRE.referrerPolicy, "no-referrer");
  assert.equal(MAPLIBRE_PREFIX, "https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.24.0/");
  assert.deepEqual(STIJL, { licht: "https://tiles.openfreemap.org/styles/positron", donker: "https://tiles.openfreemap.org/styles/dark" });
});

test("kaart-vector.js: alleen cdnjs en OpenFreeMap, geen sleutel; geen DOM bovenaan en te importeren in Node", async () => {
  const bron = fs.readFileSync(new URL("../site/kaart-vector.js", import.meta.url), "utf8");
  const hosts = [...new Set([...bron.matchAll(/https?:\/\/([^/"'`\s)]+)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(hosts, ["cdnjs.cloudflare.com", "tiles.openfreemap.org"]);
  assert.doesNotMatch(bron, /key=|api[_-]?key|access[_-]?token/i);
  // Bovenaan (buiten functies) geen document of window: alleen binnen de functies die de kaart maken.
  const bovenaan = bron.split("\n").filter((r) => /^\S/.test(r) && !/^\/\//.test(r)).join("\n");
  assert.doesNotMatch(bovenaan, /\b(document|window)\./);
  const mod = await import("../site/kaart-vector.js");
  assert.deepEqual(Object.keys(mod).sort(), ["MAPLIBRE", "STIJL", "eigenLagen", "haalStijl", "laadMapLibre", "maakVectorKaart"]);
});

// Nakijkbevinding (P9-review, toegankelijkheid): op de vectorkaart vielen een parkeerverbod en een vergunning bij
// benadering in één cirkellaag (dezelfde volle ring, alleen de kleur verschilde), en werfzones en evenementen
// deelden één vullaag zonder streeprand. Elke soort heeft ook hier een eigen vorm, zoals op de Leaflet-kaart.
test("eigenLagen (vectorkaart): plekken bij benadering als vorm per soort, verkeersvlakken met een streeprand, de straat met een rand", () => {
  const lagen = eigenLagen();
  const id = (naam) => lagen.find((l) => l.id === naam);
  const tekst = (l) => JSON.stringify(l.filter || null);
  // Geen cirkel meer voor een plek bij benadering: een vlak per vorm, en een rand per vorm met een eigen streep.
  assert.ok(!lagen.some((l) => l.type === "circle" && /ongeveer/.test(tekst(l)) && !/"!="/.test(tekst(l))), "een cirkel bij benadering");
  const ongeveer = lagen.filter((l) => l.source === "pa-ongeveer");
  assert.ok(ongeveer.some((l) => l.type === "fill"), "een vlak (om aan te tikken)");
  const randen = Object.fromEntries(["ring", "vierkant", "ruit"].map((v) => [v, ongeveer.find((l) => l.type === "line" && tekst(l).includes(`"${v}"`))]));
  for (const [v, l] of Object.entries(randen)) assert.ok(l, `geen rand voor ${v}`);
  const streep = (l) => JSON.stringify(l.paint["line-dasharray"] || "vol");
  assert.equal(new Set(Object.values(randen).map(streep)).size, 3, `elke vorm een eigen rand: ${Object.values(randen).map(streep).join(" | ")}`);
  // Verkeersvlakken (werfzone) met een streeprand, de andere vlakken met een volle rand.
  const vlakRand = lagen.filter((l) => l.source === "pa-items" && l.type === "line" && /Polygon/.test(tekst(l)));
  assert.ok(vlakRand.some((l) => /"verkeer"/.test(tekst(l)) && /"=="/.test(tekst(l)) && l.paint["line-dasharray"]), "een streeprand voor verkeersvlakken");
  assert.ok(vlakRand.some((l) => /"verkeer"/.test(tekst(l)) && /"!="/.test(tekst(l)) && !l.paint["line-dasharray"]), "een volle rand voor de andere vlakken");
  // De gekozen straat met een rand eronder, en de markering ook voor een plek bij benadering.
  const volgorde = lagen.map((l) => l.id);
  assert.ok(id("pa-straat-rand") && volgorde.indexOf("pa-straat-rand") < volgorde.indexOf("pa-straat"));
  assert.ok(ongeveer.some((l) => l.id === "pa-ongeveer-markering"));
  // Allemaal eigen bronnen (geen laag op de tegels van OpenFreeMap), en elke id één keer.
  assert.ok(lagen.every((l) => /^pa-/.test(l.source)));
  assert.equal(new Set(volgorde).size, volgorde.length);
});

test("neighborhood-map.js laadt kaart-vector.js alleen dynamisch, en MapLibre pas na de stijl", () => {
  const bron = fs.readFileSync(new URL("../site/neighborhood-map.js", import.meta.url), "utf8");
  assert.doesNotMatch(bron, /^import[^;]*kaart-vector/m);
  assert.match(bron, /import\("\.\/kaart-vector\.js"\)/);
  assert.match(bron, /m\.haalStijl\(thema, signal\)\s*\.then\(\(stijl\) => \{\s*voortgang\?\.\(\);\s*return m\.laadMapLibre\(\)/);
  // Elke stap die binnen is, zegt het aan kiesKaart (voortgang): de stijl, en MapLibre.
  assert.match(bron, /m\.laadMapLibre\(\)\.then\(\(maplibregl\) => \{\s*voortgang\?\.\(\);/);
  assert.match(bron, /maxWacht: \d+/);
  assert.match(bron, /magVectorKaart\(\{ kaart: new URL\(window\.location\.href\)\.searchParams\.get\("kaart"\)/);
  assert.match(bron, /saveData/);
});

test("haalStijl: de stijl van OpenFreeMap met een wachttijd; zonder bron openmaptiles of met een fout faalt ze", async (t) => {
  const { haalStijl } = await import("../site/kaart-vector.js");
  const echt = globalThis.fetch;
  t.after(() => { globalThis.fetch = echt; });
  const gevraagd = [];
  globalThis.fetch = async (url, opties) => { gevraagd.push([url, opties.credentials]); return { ok: true, json: async () => ({ version: 8, sources: { openmaptiles: { type: "vector" } }, layers: [] }) }; };
  assert.equal((await haalStijl("donker")).version, 8);
  assert.deepEqual(gevraagd, [["https://tiles.openfreemap.org/styles/dark", "omit"]]);
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ version: 8, sources: {}, layers: [] }) });
  await assert.rejects(haalStijl("licht"), /openmaptiles/);
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  await assert.rejects(haalStijl("licht"), /503/);
  // Het signaal van kiesKaart breekt het ophalen af.
  globalThis.fetch = (url, { signal }) => new Promise((_, nee) => signal.addEventListener("abort", () => nee(new Error("afgebroken"))));
  const ctrl = new AbortController();
  const bezig = haalStijl("licht", ctrl.signal);
  ctrl.abort();
  await assert.rejects(bezig, /afgebroken/);
});
