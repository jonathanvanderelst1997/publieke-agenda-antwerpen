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
import { ONGEVEER_DECIMALEN, isTegelFout, kaartLagen, kiesKaart, popupHtml, vormVoor } from "../site/kaart-lagen.js";
import { LEAFLET_DIR, LEAFLET_PREFIX, MAPLIBRE_PREFIX, MAPLIBRE_SRI, kaartAntwoord, sri } from "./helpers/kaart-fixture.mjs";
import { MAPLIBRE, STIJL } from "../site/kaart-vector.js";

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
  assert.equal(parking.title, "Parkeerverbod voor een verhuis");
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

test("vormVoor: een evenementendossier tekent ook de rijen elders, het parcours met parcours=true", () => {
  const parcours = inname("ET2099000601", "Evenement", "Parcours", "2026-10-24", ["Proefstraat"], { vorm: vormLijn(LIJN_HIER), parcours: vormLijn(LIJN_HIER) });
  const opbouw = inname("ET2099000601", "Opbouw", "Parkeerverbod in Straat", "2026-10-23", ["Verre Proefkaai"], { vorm: vormLijn(LIJN_ELDERS) });
  const [dossier] = publicSpaceEntries([parcours], { ...psOpties, alle: [parcours, opbouw] });
  const delen = vormVoor(dossier);
  assert.deepEqual(delen.map((d) => [d.geometry.type, d.parcours, d.ongeveer]), [["LineString", false, false], ["LineString", true, false]]);
  assert.deepEqual(delen[0].geometry.coordinates, LIJN_ELDERS, "de opbouw elders staat er ook, exact");
  assert.deepEqual(delen[1].geometry.coordinates, LIJN_HIER);
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

test("kaart-lagen.js raakt geen DOM aan en importeert in Node", async () => {
  const bron = fs.readFileSync(new URL("../site/kaart-lagen.js", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(bron, /\b(document|window)\./);
  const mod = await import("../site/kaart-lagen.js");
  assert.deepEqual(Object.keys(mod).sort(), ["MAX_PER_SOORT", "ONGEVEER_DECIMALEN", "isTegelFout", "kaartLagen", "kiesKaart", "popupHtml", "vormVoor"]);
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
  assert.deepEqual(Object.keys(mod).sort(), ["MAPLIBRE", "STIJL", "haalStijl", "laadMapLibre", "maakVectorKaart"]);
});

test("neighborhood-map.js laadt kaart-vector.js alleen dynamisch, en MapLibre pas na de stijl", () => {
  const bron = fs.readFileSync(new URL("../site/neighborhood-map.js", import.meta.url), "utf8");
  assert.doesNotMatch(bron, /^import[^;]*kaart-vector/m);
  assert.match(bron, /import\("\.\/kaart-vector\.js"\)/);
  assert.match(bron, /m\.haalStijl\(themaNu\(\), signal\)\s*\.then\(\(stijl\) => m\.laadMapLibre\(\)/);
  assert.match(bron, /searchParams\.get\("kaart"\) === "leaflet"/);
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
