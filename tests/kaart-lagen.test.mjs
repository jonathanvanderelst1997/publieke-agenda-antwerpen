// P9 "Een kaart die vertelt": de pure delen van de buurtkaart, zonder browser. Verzonnen gegevens.
// - de kaartbibliotheken voor de e2e-toetsen (tests/helpers/kaart-fixture.mjs, tests/fixtures/kaart/);
// - de soorten op de kaart en de telling (site/place-core.js: kaartSoort, telPerSoort, lijstUniversum).
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
import { LEAFLET_DIR, LEAFLET_PREFIX, MAPLIBRE_PREFIX, MAPLIBRE_SRI, kaartAntwoord, sri } from "./helpers/kaart-fixture.mjs";

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
