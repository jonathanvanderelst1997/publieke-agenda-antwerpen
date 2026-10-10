// Nakijkronde van "A-Sign-lagen echt laden": snelheid op een gsm, kale items, technische links,
// de melding boven de tegels, oude huisnummers in het archief en kleine fouten. Alle data is verzonnen.
// De modules worden los geladen: ontbreekt een functie (zoals op main), dan faalt alleen die toets.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const laad = async (pad) => { try { return await import(new URL(pad, import.meta.url)); } catch { return {}; } };
const asq = await laad("../site/asign-query.js");
const psc = await laad("../site/public-space-core.js");
const { DISTRICT_POSTCODES: LIB_POSTCODES } = await laad("../lib/postcodes.mjs");
const psl = await laad("../site/public-space-live-core.js");
const { createAgendaView } = await laad("../site/agenda-view.js");
const { adresZonderHuisnummer } = await laad("../site/adres-privacy.js");
const pc = await laad("../site/place-core.js");
const tlc = await laad("../site/terraces-live-core.js");
const sc = await laad("../site/street-core.js");
const { pointInGeometry } = await laad("../site/works-core.js");
const bb = await laad("../site/bezoekers-bronnen.js");
const pk = await laad("../site/permit-clarity.js");
const lh = await laad("../lib/live-history.mjs");
const lha = await laad("../lib/live-history-archive.mjs");
const ph = await laad("../lib/parkeer-historiek.mjs");

const bron = (pad) => { try { return fs.readFileSync(new URL(`../${pad}`, import.meta.url), "utf8"); } catch { return ""; } };
const dag = Date.UTC(2026, 9, 14), dag2 = Date.UTC(2026, 9, 16);
// A-Sign bewaart een uur als een tijdstip op 30 december 1899.
const uur = (h, m = 0) => Date.UTC(1899, 11, 30, h, m);
const parkeer = (extra = {}) => ({ attributes: { Dossiernummer: "2026-000001", Locatienummer: "L1", Status: "Goedgekeurd", Adres: "Proefstraat 12-12 2000 Antwerpen", Postcode: "2000", Reden: "Aanvraag tot een verhuis met of zonder ladderlift, verhuiswagen", Startdatum: dag, Einddatum: dag, Starttijd: uur(7), Eindtijd: uur(17), EnkelWeekdagen: "0", GipodID: null, ...extra } });
// Vaste toevalsreeks, zodat elke run dezelfde proefgeometrie maakt.
const reeks = (zaad) => () => { zaad = (zaad + 0x6d2b79f5) | 0; let t = Math.imul(zaad ^ (zaad >>> 15), 1 | zaad); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// ---- 1. Ernstig: de pagina hing op een gsm ----
test("parkeerverboden: alleen de postcodes van het district, ook in de vraag aan A-Sign", () => {
  assert.deepEqual([...(psc.DISTRICT_POSTCODES || [])], [...LIB_POSTCODES]);
  const where = psc.parkeerverbodWhere("DATE '2026-10-09'");
  assert.match(where, /District='ANTWERPEN' AND Postcode IN \('2000','2018','2020','2030','2050','2060'\)/);
  assert.match(bron("site/public-space-live.js"), /layer\(20,\{where:parkeerverbodWhere\(dateSql\)/);
  assert.match(bron("site/public-space-live.js"), /postcodes:DISTRICT_POSTCODES/);
  const items = psl.collectPublicSpace({
    parkingFeatures: [
      parkeer(),
      parkeer({ Locatienummer: "L2", Adres: "Proeflaan 4-4 2100 Deurne", Postcode: "2100" }),
      parkeer({ Locatienummer: "L3", Adres: "Grensstraat 9-9 2018 Antwerpen", Postcode: "2018" }),
    ],
    postcodes: psc.DISTRICT_POSTCODES,
  });
  assert.deepEqual(items.map((i) => i.location).sort(), ["Grensstraat, 2018 Antwerpen", "Proefstraat, 2000 Antwerpen"]);
});

test("de straten van een item worden één keer opgezocht, niet bij elke filterbeurt", () => {
  let aanroepen = 0;
  const view = createAgendaView({ resolveAddress: () => { aanroepen += 1; return [{ id: "1", name: "Proefstraat", postcode: "2000" }]; } });
  view.setStreet("Proefstraat", { id: "1", name: "Proefstraat", postcode: "2000" });
  const item = { location: "Proefstraat, 2000 Antwerpen" };
  for (let i = 0; i < 5; i += 1) assert.equal(view.matchesStreet(item), true);
  assert.equal(aanroepen, 1, "één opzoeking voor vijf filterbeurten");
  view.resetRefs();
  view.matchesStreet(item);
  assert.equal(aanroepen, 2, "een nieuwe straatindex wist het geheugen");
  view.setResolver(() => { aanroepen += 1; return []; });
  assert.equal(view.matchesStreet(item), false, "een nieuwe resolver telt meteen");
  assert.match(bron("site/place-view.js"), /liveIndex = live; view\.resetRefs\?\.\(\)/);
});

test("parkeerverboden met hetzelfde adres: één straatopzoeking per adres", () => {
  // Een straatindex die telt hoe vaak alle straatnamen doorlopen worden.
  let rondes = 0;
  class TelMap extends Map { [Symbol.iterator]() { rondes += 1; return super[Symbol.iterator](); } }
  const byName = new TelMap([["proefstraat", [{ id: "1", name: "Proefstraat", postcode: "2000" }]]]);
  const items = psl.collectPublicSpace({
    parkingFeatures: [parkeer(), parkeer({ Locatienummer: "L2", Adres: "Proefstraat 14-16 2000 Antwerpen" }), parkeer({ Dossiernummer: "2026-000002", Adres: "Proefstraat 30-30 2000 Antwerpen" })],
    streetIndex: { byName },
  });
  assert.equal(items.length, 3);
  assert.ok(items.every((i) => i.streets[0]?.name === "Proefstraat"));
  assert.equal(rondes, 1, "drie parkeerverboden in dezelfde straat: één opzoeking");
});

// De oude straatkoppeling, letterlijk, om te toetsen dat de snelle versie exact hetzelfde geeft.
function oudeStraatKoppeling(g, index, maxDistanceMeters = 18) {
  const CELL = 0.002;
  const segBox = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  const candidates = (box, pad) => { const out = new Set(); for (let x = Math.floor((box[0] - pad) / CELL); x <= Math.floor((box[2] + pad) / CELL); x++) for (let y = Math.floor((box[1] - pad) / CELL); y <= Math.floor((box[3] + pad) / CELL); y++) for (const s of index.grid.get(`${x}:${y}`) || []) out.add(s); return [...out]; };
  const xy = (point, origin) => { const lat = ((point[1] + origin[1]) / 2) * Math.PI / 180; return [(point[0] - origin[0]) * 111320 * Math.cos(lat), (point[1] - origin[1]) * 110540]; };
  const pointSeg = (point, a, b) => { const A = xy(a, point), B = xy(b, point), dx = B[0] - A[0], dy = B[1] - A[1]; if (dx === 0 && dy === 0) return Math.hypot(A[0], A[1]); const t = Math.max(0, Math.min(1, -(A[0] * dx + A[1] * dy) / (dx * dx + dy * dy))); return Math.hypot(A[0] + t * dx, A[1] + t * dy); };
  const orient = (a, b, c) => { const v = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]); return Math.abs(v) < 1e-12 ? 0 : v > 0 ? 1 : 2; };
  const onSeg = (a, b, c) => b[0] <= Math.max(a[0], c[0]) + 1e-12 && b[0] >= Math.min(a[0], c[0]) - 1e-12 && b[1] <= Math.max(a[1], c[1]) + 1e-12 && b[1] >= Math.min(a[1], c[1]) - 1e-12;
  const intersects = (a, b, c, d) => { const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b); if (o1 !== o2 && o3 !== o4) return true; if (o1 === 0 && onSeg(a, c, b)) return true; if (o2 === 0 && onSeg(a, d, b)) return true; if (o3 === 0 && onSeg(c, a, d)) return true; return o4 === 0 && onSeg(c, b, d); };
  const segDistance = (a, b, c, d) => (intersects(a, b, c, d) ? 0 : Math.min(pointSeg(a, c, d), pointSeg(b, c, d), pointSeg(c, a, b), pointSeg(d, a, b)));
  const dist = new Map();
  for (const line of g.paths || g.coordinates) for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    for (const s of candidates(segBox(a, b), maxDistanceMeters / 70000)) {
      const d = segDistance(a, b, s.a, s.b); if (d > maxDistanceMeters) continue;
      for (const ref of s.refs) { const k = `${ref.id}|${ref.name}|${ref.postcode}`; if (!dist.has(k) || d < dist.get(k).distance) dist.set(k, { ref, distance: d }); }
    }
  }
  const rows = [...dist.values()];
  return { namen: rows.map((x) => x.ref.name).sort(), afstand: rows.length ? Math.round(Math.min(...rows.map((x) => x.distance))) : null };
}

test("straatkoppeling van vlakken en lijnen: exact hetzelfde, maar zonder nutteloze metingen", () => {
  const r = reeks(7);
  const straten = [];
  for (let i = 0; i < 60; i += 1) {
    const x = 4.4 + r() * 0.01, y = 51.2 + r() * 0.006;
    straten.push({ properties: { DISTRICT: "ANTWERPEN", LSTRNMID: i, LSTRNM: `Proefstraat ${i}`, RSTRNMID: i, RSTRNM: `Proefstraat ${i}`, postcode: 2000 }, geometry: { type: "LineString", coordinates: [[x, y], [x + (r() - 0.5) * 0.003, y + (r() - 0.5) * 0.002], [x + (r() - 0.5) * 0.004, y + (r() - 0.5) * 0.003]] } });
  }
  const index = sc.buildStreetIndex(straten);
  for (let n = 0; n < 150; n += 1) {
    const x = 4.4 + r() * 0.01, y = 51.2 + r() * 0.006, punten = [];
    for (let k = 0; k < 2 + Math.floor(r() * 30); k += 1) punten.push([x + (r() - 0.5) * 0.002, y + (r() - 0.5) * 0.0015]);
    const g = n % 2 ? { paths: [punten] } : { type: "Polygon", coordinates: [[...punten, punten[0]]] };
    for (const m of [18, 24]) {
      const nieuw = sc.resolveGeometryStreets(g, index, { maxDistanceMeters: m });
      const oud = oudeStraatKoppeling(g, index, m);
      assert.deepEqual([nieuw.streets.map((s) => s.name).sort(), nieuw.distanceMeters], [oud.namen, oud.afstand], `geometrie ${n}, ${m} m`);
    }
  }
  // Een stuk geometrie in hetzelfde rastervak als een straat, maar 60 m verder: geen enkele meting.
  const een = sc.buildStreetIndex([{ properties: { DISTRICT: "ANTWERPEN", LSTRNMID: 1, LSTRNM: "Proefstraat", RSTRNMID: 1, RSTRNM: "Proefstraat", postcode: 2000 }, geometry: { type: "LineString", coordinates: [[4.4001, 51.2001], [4.4003, 51.2001]] } }]);
  const ver = {}, dicht = {};
  assert.deepEqual(sc.resolveGeometryStreets({ paths: [[[4.4001, 51.20065], [4.4003, 51.20065]]] }, een, { stats: ver }).streets, []);
  assert.equal(ver.gemeten, 0, "60 m van de straat: niets te meten");
  assert.deepEqual(sc.resolveGeometryStreets({ paths: [[[4.4001, 51.20015], [4.4003, 51.20015]]] }, een, { stats: dicht }).streets.map((s) => s.name), ["Proefstraat"]);
  assert.equal(dicht.gemeten, 1);
});

test("districtsgrens: hetzelfde antwoord, met de grens één keer voorbereid", () => {
  // De oude toets, letterlijk: punt binnen, snijdende segmenten, of de grens binnen het vlak.
  const segs = (g) => (g.paths || g.rings || g.coordinates).flatMap((l) => l.slice(1).map((p, i) => [l[i], p]));
  const orientation = (a, b, c) => { const v = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]); return Math.abs(v) < 1e-10 ? 0 : v > 0 ? 1 : 2; };
  const onSegment = (a, b, c) => b[0] <= Math.max(a[0], c[0]) + 1e-10 && b[0] >= Math.min(a[0], c[0]) - 1e-10 && b[1] <= Math.max(a[1], c[1]) + 1e-10 && b[1] >= Math.min(a[1], c[1]) - 1e-10;
  const snijdt = (a, b, c, d) => { const o1 = orientation(a, b, c), o2 = orientation(a, b, d), o3 = orientation(c, d, a), o4 = orientation(c, d, b); if (o1 !== o2 && o3 !== o4) return true; if (o1 === 0 && onSegment(a, c, b)) return true; if (o2 === 0 && onSegment(a, d, b)) return true; if (o3 === 0 && onSegment(c, a, d)) return true; return o4 === 0 && onSegment(c, b, d); };
  const ringBevat = (p, ring) => { let binnen = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[j], b = ring[i]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) binnen = !binnen; } return binnen; };
  const oud = (g, district) => {
    const punten = (g.paths || g.rings).flat();
    if (punten.some((p) => pointInGeometry(p, district))) return true;
    for (const [a, b] of segs(g)) for (const [c, d] of segs(district)) if (snijdt(a, b, c, d)) return true;
    return Boolean(g.rings && ringBevat(district.coordinates[0][0], g.rings[0]));
  };
  const r = reeks(11);
  const rand = [];
  for (let i = 0; i < 80; i += 1) { const t = (i / 80) * Math.PI * 2, s = 0.01 + r() * 0.004; rand.push([4.4 + Math.cos(t) * s, 51.2 + Math.sin(t) * s * 0.7]); }
  const district = { type: "Polygon", coordinates: [[...rand, rand[0]]] };
  let binnen = 0;
  for (let n = 0; n < 300; n += 1) {
    const x = 4.4 + (r() - 0.5) * 0.04, y = 51.2 + (r() - 0.5) * 0.03, p = [];
    for (let k = 0; k < 2 + Math.floor(r() * 6); k += 1) p.push([x + (r() - 0.5) * (n % 10 === 0 ? 0.05 : 0.004), y + (r() - 0.5) * (n % 10 === 0 ? 0.04 : 0.003)]);
    const g = n % 2 ? { paths: [p] } : { rings: [[...p, p[0]]] };
    const verwacht = oud(g, district);
    assert.equal(psl.geometryIntersectsDistrict(g, district), verwacht, `geometrie ${n}`);
    binnen += verwacht ? 1 : 0;
  }
  assert.ok(binnen > 30 && binnen < 270, "de proef heeft geometrie binnen én buiten");
});

test("in de browser: de lagen worden in stappen verwerkt, met precies hetzelfde resultaat", async () => {
  assert.equal(typeof psl.collectPublicSpaceInStappen, "function");
  assert.equal(typeof tlc.collectTerracesInStappen, "function");
  const district = { type: "Polygon", coordinates: [[[4.39, 51.19], [4.42, 51.19], [4.42, 51.22], [4.39, 51.22], [4.39, 51.19]]] };
  const vlak = (x) => ({ rings: [[[x, 51.2], [x + 0.0002, 51.2], [x + 0.0002, 51.2002], [x, 51.2002], [x, 51.2]]] });
  const sgw = Array.from({ length: 40 }, (_, i) => ({ feature: { attributes: { reference_id: `GW${i}`, phase_id: "1", status: "vergund", StartDate: dag, EndDate: dag2 }, geometry: vlak(4.4 + i * 0.0003) }, kind: "Werfzone" }));
  const parking = Array.from({ length: 40 }, (_, i) => parkeer({ Locatienummer: `L${i}` }));
  const opties = { parkingFeatures: parking, sgwFeatures: sgw, districtGeometry: district };
  // Een nepklok: elke blik op de klok kost 10 ms; om de 40 ms moet de pagina lucht krijgen.
  let klok = 0, pauzes = 0;
  const stappen = { budgetMs: 40, nu: () => (klok += 10), pauze: async () => { pauzes += 1; } };
  const inStappen = await psl.collectPublicSpaceInStappen(opties, stappen);
  assert.deepEqual(inStappen, psl.collectPublicSpace(opties));
  assert.equal(inStappen.length, 80);
  assert.ok(pauzes >= 15, `de pagina kreeg ${pauzes} keer lucht`);
  const terrassen = Array.from({ length: 30 }, (_, i) => ({ attributes: { ROLnet_ID: `T${i}`, TypeTerrasZone: "binnen kern", Status: "actief", adres: `Proefstraat ${i}`, postcode: 2000 }, geometry: vlak(4.4 + i * 0.0003) }));
  pauzes = 0;
  assert.deepEqual(await tlc.collectTerracesInStappen(terrassen, district, null, stappen), tlc.collectTerraces(terrassen, district, null));
  assert.ok(pauzes >= 5);
  assert.match(bron("site/public-space-live.js"), /await collectPublicSpaceInStappen\(/);
  assert.match(bron("site/terraces-live.js"), /await collectTerracesInStappen\(/);
});

// ---- 2. Kale items: wat, waarom, wanneer ----
test("werfzone en omleiding: de straten van elk apart", () => {
  const index = sc.buildStreetIndex([
    { properties: { DISTRICT: "ANTWERPEN", LSTRNMID: 1, LSTRNM: "Werfstraat", RSTRNMID: 1, RSTRNM: "Werfstraat", postcode: 2000 }, geometry: { type: "LineString", coordinates: [[4.4, 51.2], [4.401, 51.2]] } },
    { properties: { DISTRICT: "ANTWERPEN", LSTRNMID: 2, LSTRNM: "Ommetjeslaan", RSTRNMID: 2, RSTRNM: "Ommetjeslaan", postcode: 2000 }, geometry: { type: "LineString", coordinates: [[4.405, 51.205], [4.406, 51.205]] } },
  ]);
  const district = { type: "Polygon", coordinates: [[[4.39, 51.19], [4.42, 51.19], [4.42, 51.22], [4.39, 51.22], [4.39, 51.19]]] };
  const attributes = { reference_id: "GW1", phase_id: "1", status: "vergund", StartDate: dag, EndDate: dag2 };
  const [item] = psl.collectPublicSpace({ districtGeometry: district, streetIndex: index, sgwFeatures: [
    { feature: { attributes, geometry: { rings: [[[4.4002, 51.19995], [4.4004, 51.19995], [4.4004, 51.20005], [4.4002, 51.20005], [4.4002, 51.19995]]] } }, kind: "Werfzone" },
    { feature: { attributes, geometry: { paths: [[[4.4005, 51.2], [4.4055, 51.205]]] } }, kind: "Omleiding" },
  ] });
  assert.deepEqual(item.werfzoneStreets.map((s) => s.name), ["Werfstraat"]);
  assert.deepEqual(item.omleidingStreets.map((s) => s.name), ["Ommetjeslaan", "Werfstraat"]);
  assert.deepEqual(item.streets.map((s) => s.name), ["Ommetjeslaan", "Werfstraat"]);
});

test("parkeerverbod: weekdagen alleen bij \"1\", de uren uit de bron, en een GIPOD-id als die er is", () => {
  const nul = psc.normalizeParking(parkeer().attributes);
  assert.equal(nul.weekdaysOnly, false, "\"0\" is geen weekdagregel");
  assert.equal(psc.normalizeParking(parkeer({ EnkelWeekdagen: "1" }).attributes).weekdaysOnly, true);
  assert.deepEqual([nul.startTime, nul.endTime], ["07:00", "17:00"]);
  assert.equal(nul.gipodId, null);
  const [item] = psl.collectPublicSpace({ parkingFeatures: [parkeer({ GipodID: "12345678" })] });
  assert.equal(item.detail, "");
  assert.equal(item.gipodId, 12345678);
  assert.equal(bb.bezoekersLinks(pc.publicSpaceEntry(item))[0].url, "https://www.geopunt.be/?app=hinder-in-kaart&gipodid=12345678");
  assert.match(bron("site/public-space-live.js"), /Starttijd,Eindtijd/);
});

test("parkeerverbod in gewone taal: waarvoor, de uren, en een eerlijke zin zonder reden", () => {
  assert.equal(pc.parkeerTitel("Aanvraag tot een verhuis met of zonder ladderlift, verhuiswagen"), "Parkeerverbod voor een verhuis");
  assert.equal(pc.parkeerTitel("Melding ikv werfsignalisaties"), "Parkeerverbod voor een werf");
  assert.equal(pc.parkeerTitel("Aanvraag tot het inrichten van een laad-en loszone"), "Parkeerverbod voor een laad- en loszone");
  assert.equal(pc.parkeerTitel("Aanvraag tot het plaatsen van een beweegbaar toestel (voorbeeld: ladderlift, schaarlift, hoogtewerker)"), "Parkeerverbod voor een lift of hoogtewerker");
  assert.equal(pc.parkeerTitel(""), "Tijdelijk parkeerverbod");
  assert.equal(pc.parkeerTitel("Iets nieuws"), "Tijdelijk parkeerverbod");
  assert.equal(pc.parkeerUren({ startTime: "00:00", endTime: "23:59" }), "hele dag");
  assert.equal(pc.parkeerUren({ startTime: "07:00", endTime: "17:00" }), "van 7.00 tot 17.00 uur");
  const [item] = psl.collectPublicSpace({ parkingFeatures: [parkeer({ Status: "In effect" })] });
  const e = pc.publicSpaceEntry(item);
  assert.equal(e.title, "Parkeerverbod voor een verhuis");
  assert.equal(e.summary, "Niet parkeren van 7.00 tot 17.00 uur.");
  assert.equal(e.status, "Van kracht");
  assert.equal(e.time, "07:00");
  assert.equal(e.info, "Reden volgens de stad: aanvraag tot een verhuis met of zonder ladderlift, verhuiswagen");
  assert.equal(pc.publicSpaceEntry({ ...item, reason: "Melding ikv werfsignalisaties" }).info, "Reden volgens de stad: melding in het kader van werfsignalisaties");
  const [zonder] = psl.collectPublicSpace({ parkingFeatures: [parkeer({ Reden: null, Starttijd: uur(0), Eindtijd: uur(23, 59), EnkelWeekdagen: "1", Einddatum: dag2 })] });
  const z = pc.publicSpaceEntry(zonder);
  assert.equal(z.title, "Tijdelijk parkeerverbod");
  assert.equal(z.summary, "Niet parkeren, de hele dag, alleen op weekdagen. De stad publiceert niet waarvoor.");
  assert.doesNotMatch(z.title, /Parkeerverbod: /);
  assert.equal(pc.statusNl("vergund"), "Vergund door de stad");
});

test("één rij per parkeerverbod-dossier en per werfzone-dossier, met jouw straat eerst", () => {
  const straat = (name) => ({ id: name, name, postcode: "2018" });
  const p = (loc, s) => ({ id: `parking:D1|${loc}`, kind: "parking", title: "Verhuis", reason: "Verhuis", reference: "D1", location: "Proefstraat, 2018 Antwerpen", start: "2026-10-16T22:00:00.000Z", end: "2026-10-16T22:00:00.000Z", startTime: "00:00", endTime: "23:59", status: "Goedgekeurd", streets: [straat(s)] });
  const parkeren = pc.publicSpaceEntries([p("L1", "Proefstraat"), p("L2", "Proefstraat")], { vandaag: "2026-10-09" });
  assert.equal(parkeren.length, 1, "twee plaatsen van één dossier: één rij");
  assert.equal(parkeren[0].location, "Proefstraat, 2018 Antwerpen");

  const namen = ["Astraat", "Bstraat", "Cstraat", "Dstraat", "Proefstraat"];
  // Werfzone in Astraat en Bstraat; de omleiding loopt via Bstraat tot Proefstraat.
  const fase = (nr, van, tot, kind = "Omleiding + Werfzone") => ({ id: `sgw:GW1|${nr}`, kind: "sgw", kindLabel: kind, title: kind, reference: "GW1", phase: String(nr), detail: `Fase ${nr}`, status: "vergund", start: van, end: tot, streets: namen.map(straat), werfzoneStreets: ["Astraat", "Bstraat"].map(straat), omleidingStreets: kind.includes("Omleiding") ? namen.slice(1).map(straat) : [] });
  const fasen = [fase(1, "2026-10-26T06:00:00Z", "2026-10-26T16:00:00Z"), fase(2, "2026-10-27T06:00:00Z", "2026-10-28T16:00:00Z"), fase(3, "2026-10-29T06:00:00Z", "2026-10-31T16:00:00Z", "Werfzone")];
  const werf = pc.publicSpaceEntries(fasen, { vandaag: "2026-10-09", straat: "Proefstraat" });
  assert.equal(werf.length, 1, "drie fasen: één rij");
  assert.equal(werf[0].title, "Werfzone met omleiding");
  assert.equal(werf[0].summary, "Je straat ligt op de omleiding; de werfzone zelf ligt elders. Vergund door de stad. De stad publiceert niet waarvoor deze werfzone dient.");
  assert.equal(werf[0].location, "Omleiding via Proefstraat + 3 andere straten");
  assert.deepEqual([werf[0].start, werf[0].end], ["2026-10-26", "2026-10-31"]);
  assert.deepEqual(werf[0].regels, [["Werfzone in", "Astraat en Bstraat"], ["Omleiding via", "Proefstraat + 3 andere straten"], ["3 fasen", "26 okt · 27–28 okt · 29–31 okt"]]);
  assert.doesNotMatch(JSON.stringify([werf[0].title, werf[0].info, werf[0].regels]), /Fase \d/);
  assert.equal(werf[0].straten.length, 5);
  assert.deepEqual(pk.duidelijkeKaart(werf[0], werf[0].item).regels, werf[0].regels, "de regels komen op de kaart");
  const inDeWerf = pc.publicSpaceEntries(fasen, { vandaag: "2026-10-09", straat: "Astraat" })[0];
  assert.match(inDeWerf.summary, /^De werfzone ligt in je straat; het verkeer wordt omgeleid\./);
  assert.equal(inDeWerf.location, "Werfzone in Astraat en Bstraat");
  const zonderStraat = pc.publicSpaceEntries(fasen, { vandaag: "2026-10-09" })[0];
  assert.match(zonderStraat.summary, /^Een werfzone op straat, met een omleiding voor het verkeer\./);
  // Dezelfde fase twee keer (omleiding en werfzone apart opgeslagen) telt één keer.
  const dubbel = pc.publicSpaceEntries([fase(1, "2026-10-26T06:00:00Z", "2026-10-26T16:00:00Z"), { ...fase(9, "2026-10-26T06:00:00Z", "2026-10-26T16:00:00Z"), kindLabel: "Omleiding", title: "Omleiding" }], { vandaag: "2026-10-09" });
  assert.equal(dubbel.length, 1);
  assert.equal(dubbel[0].regels.some(([dt]) => /fasen/.test(dt)), false);
  assert.equal(pc.waarKort(["A", "B"], "B"), "A en B");
  assert.equal(pc.waarKort(namen, "onbekend"), "Astraat + 4 andere straten");
  assert.match(bron("site/place-view.js"), /straat: state\.place\?\.type === "straat" \? state\.place\.name : ""/);
});

test("terrassen: geen \"niet actief\", de straat van het adres, en een titel in gewone taal", () => {
  const index = sc.buildStreetIndex([
    { properties: { DISTRICT: "ANTWERPEN", LSTRNMID: 1, LSTRNM: "Proefstraat", RSTRNMID: 1, RSTRNM: "Proefstraat", postcode: 2000 }, geometry: { type: "LineString", coordinates: [[4.4, 51.2], [4.41, 51.2]] } },
    { properties: { DISTRICT: "ANTWERPEN", LSTRNMID: 2, LSTRNM: "Hoekstraat", RSTRNMID: 2, RSTRNM: "Hoekstraat", postcode: 2000 }, geometry: { type: "LineString", coordinates: [[4.4002, 51.1995], [4.4002, 51.2005]] } },
  ]);
  const district = { type: "Polygon", coordinates: [[[4.39, 51.19], [4.42, 51.19], [4.42, 51.22], [4.39, 51.22], [4.39, 51.19]]] };
  const zone = { type: "Polygon", coordinates: [[[4.4001, 51.1999], [4.4003, 51.1999], [4.4003, 51.2001], [4.4001, 51.2001], [4.4001, 51.1999]]] };
  const terras = (id, status, adres) => ({ properties: { ROLnet_ID: id, TypeTerrasZone: "buiten kern", Status: status, adres, postcode: 2000 }, geometry: zone });
  const rows = tlc.collectTerraces([terras("T1", "actief", "Proefstraat 3"), terras("T2", "niet actief", "Proefstraat 5"), terras("T3", "actief", "")], district, index);
  assert.deepEqual(rows.map((r) => r.recordId).sort(), ["T1", "T3"], "\"niet actief\" valt weg");
  assert.deepEqual(rows.find((r) => r.recordId === "T1").streets.map((s) => s.name), ["Proefstraat"], "hoekterras: alleen de straat van het adres");
  assert.deepEqual(rows.find((r) => r.recordId === "T3").streets.map((s) => s.name).sort(), ["Hoekstraat", "Proefstraat"], "zonder adres: de straten bij de zone");
  const e = pc.permitEntry(rows[0], "terraces");
  assert.equal(e.title, "Terras met vergunning");
  assert.equal(e.status, "Actief");
  assert.equal(e.info, "Soort zone volgens de stad: buiten kern");
  assert.equal(e.summary, "Een terras op het openbaar domein, met een vergunning van de stad. Een periode publiceert de stad niet.");
  assert.equal(pc.permitEntry({ id: "terrace:U", terraceType: "uitstalling", status: "actief" }, "terraces").title, "Uitstalling met vergunning");
  // Twee zones van dezelfde soort op hetzelfde adres: één rij.
  const t1 = rows.find((r) => r.recordId === "T1");
  const zones = pc.terrasEntries([{ ...t1, id: "terrace:A" }, { ...t1, id: "terrace:B" }, { ...t1, id: "terrace:C", address: "Proefstraat 9" }]);
  assert.equal(zones.length, 2);
  assert.equal(zones[0].info, "Soort zone volgens de stad: buiten kern · 2 zones op dit adres");
  // Na de samenvoeging met de evenementkaart (#140) kiest collect() eerst alles op de plek en filtert
  // daarna per groep (de chips tellen ook soorten die uit staan): inPlace in plaats van pick.
  assert.match(bron("site/place-view.js"), /\.\.\.terrasEntries\(inPlace\(live\.terraces\)\)/);
  // Ook de volledige lijsten onderaan gebruiken de titels in gewone taal, zonder fasenummer.
  assert.match(bron("site/terraces-live.js"), /<h3>\$\{esc\(terrasTitel\(item\.terraceType\)\)\}<\/h3>/);
  assert.match(bron("site/public-space-live.js"), /parkeerTitel\(i\.reason\?\?i\.title\)/);
  assert.doesNotMatch(bron("site/public-space-live.js"), /<h3>\$\{esc\(i\.title\)\}/);
});

test("de bronzin past bij de soort: geen \"evenementenpagina\" bij een parkeerverbod of werfzone", () => {
  for (const kind of ["parking", "sgw", "iod"]) assert.doesNotMatch(bb.bezoekersHint({ source: "publicSpace", item: { kind } }), /evenementenpagina/, kind);
  assert.match(bb.bezoekersHint({ source: "publicSpace", item: { kind: "parking" } }), /borden ter plaatse/);
});

// ---- 3. De enige link was een technisch ArcGIS-blad ----
test("een ruwe databron staat apart, in een ingeklapt blok \"Technische details\"", () => {
  const links = bb.bezoekersLinks({ source: "publicSpace", item: { kind: "parking" }, sourceUrl: "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/20" });
  const { gewoon, technisch } = bb.splitsLinks(links);
  assert.equal(gewoon.length, 0);
  assert.equal(technisch.length, 1);
  assert.equal(bb.splitsLinks([{ url: "https://www.antwerpen.be/info/x", type: "source", label: "Officiële bronpagina" }]).gewoon.length, 1);
  assert.match(bron("site/place-view.js"), /<details class="pv-tech"><summary>Technische details<\/summary>/);
});

// ---- 4. De melding viel op een gsm buiten het eerste scherm ----
test("de melding over een laag die niet laadde, staat boven de tegels; tegels tonen geen valse 0", () => {
  const view = bron("site/place-view.js");
  const start = view.indexOf("placeBox.innerHTML = `");
  const sjabloon = view.slice(start, view.indexOf("`;", start));
  assert.ok(sjabloon.indexOf("pv-place-failed") > 0 && sjabloon.indexOf("pv-place-failed") < sjabloon.indexOf('class="pv-stats"'), "melding vóór de tegels");
  assert.match(view, /state\.werkenOnvolledig \? "\?"/);
  assert.match(view, /loading\.push\("terrassen"\)/, "ook terrassen melden dat ze nog laden");
});

// ---- 5. Oude huisnummers in het archief ----
test("archief: de baseline en oudere dagen verliezen hun huisnummers en de foute weekdagregel", () => {
  const item = { id: "parking:D|L", kind: "parking", kindLabel: "Parkeerverbod", title: "Verhuis", location: "Proefstraat 26-28 2000 Antwerpen", start: "2026-10-01T00:00:00.000Z", end: "2026-10-02T00:00:00.000Z", status: "Goedgekeurd", reference: "D", detail: "Alleen op weekdagen", streets: [], streetResolution: "unresolved", streetDistanceMeters: null };
  const baseline = lha.updateHistoryArchiveBaseline({ schemaVersion: 1, layers: { works: null, publicSpace: { observedAt: "2026-10-01T00:00:00.000Z", items: [item] } } }, { observedAt: "2026-10-09T00:00:00.000Z", layers: {} });
  assert.equal(baseline.layers.publicSpace.items[0].location, "Proefstraat, 2000 Antwerpen");
  assert.equal(baseline.layers.publicSpace.items[0].detail, "");
  const t = "2026-10-05T03:00:00.000Z";
  const oud = { schemaVersion: 1, date: "2026-10-05", events: [
    { observedAt: t, layer: "publicSpace", id: "parking:D|L", type: "removed", fields: [], before: item, after: null },
    { observedAt: t, layer: "publicSpace", id: "parking:D|M", type: "changed", fields: ["location"], before: { location: "Proefstraat 3-3 2000 Antwerpen" }, after: { location: "Proefstraat 5-5 2000 Antwerpen" } },
    { observedAt: t, layer: "works", id: "work:1", type: "changed", fields: ["status"], before: { status: "Gepland" }, after: { status: "Bezig" } },
  ] };
  const schoon = lha.scrubHistoryArchiveDay(oud);
  assert.doesNotMatch(JSON.stringify(schoon), /26-28|3-3|5-5|Alleen op weekdagen/);
  assert.equal(schoon.events.length, 2, "een wijziging van alleen het huisnummer valt weg");
  assert.deepEqual(lha.validateHistoryArchiveDay(schoon), []);
  assert.equal(lha.scrubHistoryArchiveDay(schoon), schoon, "tweede keer: niets te doen");
  const index = lha.updateHistoryArchiveIndexDay({ schemaVersion: 1, days: [{ date: "2026-10-05", file: "site/history/archive/2026-10-05.json", count: 3, digest: "x" }] }, schoon);
  assert.equal(index.days[0].count, 2);
  assert.match(index.days[0].digest, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(lha.updateHistoryArchiveDay(oud, t, [])), /26-28|Alleen op weekdagen/);
  assert.match(bron("scripts/refresh-live-history.mjs"), /scrubHistoryArchiveDay\(before\)/);
});

test("historiek: geen weekdagregel bij parkeerverboden, en geen massa wijzigingen bij de overgang", () => {
  const live = { id: "parking:D|L", kind: "parking", kindLabel: "Parkeerverbod", title: "Verhuis", location: "Proefstraat, 2000 Antwerpen", start: "2026-10-13T00:00:00.000Z", end: "2026-10-14T00:00:00.000Z", status: "Goedgekeurd", reference: "D", detail: "Alleen op weekdagen", streets: [], streetResolution: "unresolved", streetDistanceMeters: null };
  assert.equal(lh.compactPublicSpaceItem(live).detail, "");
  const t1 = "2026-10-08T03:00:00.000Z", t2 = "2026-10-09T03:00:00.000Z";
  const vorige = { schemaVersion: 1, observedAt: t1, baselineInitializedAt: t1, layers: {
    works: { status: "ok", lastAttemptAt: t1, lastSuccessAt: t1, errorCode: null, count: 0, digest: null, items: [] },
    publicSpace: { status: "ok", lastAttemptAt: t1, lastSuccessAt: t1, errorCode: null, count: 1, digest: null, items: [{ ...live, location: "Proefstraat 26-26 2000 Antwerpen" }] },
  }, changes: [] };
  const volgende = lh.updateLiveHistory(vorige, { observedAt: t2, worksResult: { ok: true, items: [] }, publicSpaceResult: { ok: true, items: [{ ...live, detail: "" }] } });
  assert.equal(volgende.changes.length, 0);
  assert.doesNotMatch(JSON.stringify(volgende), /26-26|Alleen op weekdagen/);
});

// ---- 6. Klein ----
test("straatnamen met een cijfer blijven heel, en een tweede opkuis verandert niets", () => {
  const namen = ["4 septemberpad", "De 7 schakenpad", "Kanaaldok B1", "Kanaaldok B1-Oostkaai", "Proefstraat"];
  const voorbeelden = {
    "4 septemberpad 12-12 2000 Antwerpen": "4 septemberpad, 2000 Antwerpen",
    "De 7 schakenpad 3-5 2000 Antwerpen": "De 7 schakenpad, 2000 Antwerpen",
    "Kanaaldok B1-Oostkaai 5-5 2030 Antwerpen": "Kanaaldok B1-Oostkaai, 2030 Antwerpen",
    "Kanaaldok B1 hoek-7 2030 Antwerpen": "Kanaaldok B1, 2030 Antwerpen",
    "Proefstraat 4-4 2000 Antwerpen": "Proefstraat, 2000 Antwerpen",
  };
  for (const [in_, uit] of Object.entries(voorbeelden)) {
    assert.equal(adresZonderHuisnummer(in_, namen), uit, in_);
    assert.equal(adresZonderHuisnummer(uit), uit, `opnieuw zonder namen: ${uit}`);
  }
  // Zonder namen blijft de strenge regel: geen huisnummer, ook niet in een vreemde vorm.
  assert.equal(adresZonderHuisnummer("Proefstraat 12/14 2000 Antwerpen"), "Proefstraat, 2000 Antwerpen");
  assert.equal(adresZonderHuisnummer("Proefstraat 12b, 2000 Antwerpen"), "Proefstraat, 2000 Antwerpen");
  assert.equal(adresZonderHuisnummer("Proefstraat 12/14, 2000 Antwerpen"), "Proefstraat, 2000 Antwerpen");
  assert.equal(adresZonderHuisnummer("Proefstraat 3.5, 2000 Antwerpen"), "Proefstraat, 2000 Antwerpen");
  assert.equal(adresZonderHuisnummer("12, 2000 Antwerpen"), "2000 Antwerpen");
  const [item] = psl.collectPublicSpace({ parkingFeatures: [parkeer({ Adres: "De 7 schakenpad 3-5 2000 Antwerpen" })], streetIndex: { byName: new Map([["de 7 schakenpad", [{ id: "7", name: "De 7 schakenpad", postcode: "2000" }]]]) } });
  assert.equal(item.location, "De 7 schakenpad, 2000 Antwerpen");
  assert.deepEqual(item.streets.map((s) => s.name), ["De 7 schakenpad"]);
  // De historiek kuist bij elke verversing opnieuw op, met de officiële stratenlijst van de site.
  for (const adres of ["Buurtweg nr 11 4-4 2000 Antwerpen", "Buurtweg nr 11, 2000 Antwerpen"]) {
    assert.equal(ph.parkeerItemVoorHistoriek({ id: "parking:X|1", kind: "parking", location: adres }).location, "Buurtweg nr 11, 2000 Antwerpen");
  }
});

test("lege staat met een laag die niet laadde: alleen iets zeggen over wat wel geladen is", () => {
  const straat = { type: "straat", label: "Proefstraat" };
  assert.equal(pc.legeStaatTekst({ place: straat, aantalSoorten: 6, onvolledig: true }), "In wat wel geladen is, staat niets voor deze straat.");
  assert.equal(pc.legeStaatTekst({ place: straat, aantalSoorten: 6, onvolledig: false }), "Er staat niets op de agenda voor deze straat.");
  assert.match(bron("site/place-view.js"), /onvolledig: Boolean\(state\.onvolledig\)/);
});

test("één tijdelijke hapering laat de laag niet vallen; twee keer na elkaar wel", async () => {
  assert.equal(asq.ASIGN_POGINGEN, 2);
  const maak = (faalKeer) => {
    const gezien = new Map();
    return async (url) => {
      const u = new URL(url);
      if (u.searchParams.get("returnIdsOnly") === "true") return Response.json({ objectIds: [1, 2, 3] });
      const n = (gezien.get(url) || 0) + 1;
      gezien.set(url, n);
      if (n <= faalKeer) return new Response("fout", { status: 503 });
      return Response.json({ features: u.searchParams.get("objectIds").split(",").map((OBJECTID) => ({ attributes: { OBJECTID: Number(OBJECTID) } })) });
    };
  };
  const rijen = await asq.asignLayer(20, { outFields: "Adres" }, { fetch: maak(1), begrenzer: asq.maakBegrenzer(4) });
  assert.equal(rijen.length, 3);
  await assert.rejects(asq.asignLayer(20, { outFields: "Adres" }, { fetch: maak(2), begrenzer: asq.maakBegrenzer(4) }), /HTTP 503/);
});
