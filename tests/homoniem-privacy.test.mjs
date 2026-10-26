// De homoniemtoevoeging van de straatas ("Proefstraat_AN": een straatnaam die ook in een ander district bestaat) is geen
// deel van de naam en komt nergens in de uitvoer. Ze gaat weg op één plek per bron, bij de ingang (site/witte-lijst.js):
// de straatas (straatasNaam in site/street-core.js, lib/street-resolver.mjs, lib/parcours-herkenning-refresh.mjs,
// scripts/build-straten-stad.mjs), de tekst van GIPOD (gipodTekst in site/works-core.js) en het adres van A-Sign
// (site/adres-privacy.js). Wat de verversing bewaart, schrijft ze ook zonder (kaart-uitleg, straatbestanden, historiek),
// en een huisnummer na een straatnaam met toevoeging valt weg (vangnet). Twee straten met dezelfde naam verschillen door
// hun id. Deze toetsen sturen een verzonnen straatas ("Proefstraat_AN" in 2018, "Proefstraat_XY" in 2000, een code die
// niet gemeten is) en verzonnen bronrijen met een huisnummer door het hele pad: de straatindex en straten.json, de werken,
// de parkeerverboden, de historiek, de straatbestanden, kaart-uitleg.json, de agenda (feed, eventpagina, .ics), de
// plekpagina (place-core, de kaartzin van neighborhood-map, street-overview), de herkenning van een parcours en de
// privacyfilter. Nergens mag een toevoeging of een huisnummer na de straatnaam overblijven. Alleen verzonnen straten,
// namen en nummers; geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as W from "../site/witte-lijst.js";
import * as KU from "../site/kaart-uitleg.js";
import { applyWorkStreetResolution, buildStreetIndex, nearbyStreets, resolvePointStreet, straatasNaam } from "../site/street-core.js";
import { buildStreetIndex as historiekStraatas } from "../lib/street-resolver.mjs";
import { collectWorks, gipodTekst } from "../site/works-core.js";
import { collectHindrance } from "../site/works-hindrance.js";
import { normalizeIod, normalizeParking } from "../site/public-space-core.js";
import { adresZonderHuisnummer, publiekParkeerAdres } from "../site/adres-privacy.js";
import {
  agendaStraten, buildPlaceIndex, evenementEntry, placeParam, publicSpaceEntry, resolvePlaceParam, waarKort, workEntry,
} from "../site/place-core.js";
import { kaartStatusZin } from "../site/neighborhood-map.js";
import { buildDistrictRadar, buildStreetGroups } from "../site/street-overview.js";
import { leesBewaardeStraten, OPSLAG_SLEUTEL } from "../site/bewaarde-straten.js";
import { straatItems } from "../site/straat-snapshot.js";
import { historiekPrivacyBevindingen, historiekVoorPubliek, resultaatVoorHistoriek, tekstZonderHuisnummers } from "../lib/historiek-privacy.mjs";
import { itemVoorStraat, schrijfStraatSnapshots, straatBestandenProblemen, straatDocument, STRAAT_SCHEMA } from "../scripts/build-straat-snapshots.mjs";
import { buildStreetList } from "../scripts/build-straten.mjs";
import { bouwStadStraten, districtenTabel, schoneNaam } from "../scripts/build-straten-stad.mjs";
import { crabStraatWhere, huisnummersVoorWerk, kaartUitlegVoorPubliek, schrijfKaartUitleg, stratenLangsLijn } from "../lib/kaart-uitleg-refresh.mjs";
import { KAART_UITLEG_FILE, validateKaartUitleg } from "../lib/kaart-uitleg-validatie.mjs";
import * as L from "../lib/parcours-herkenning.mjs";
import { straatBijPunt, straatBijPuntOnline } from "../lib/parcours-herkenning-refresh.mjs";
import { asignAgendapunten, dossierFeiten, tekstUitFeiten } from "../lib/asign-evenementen-agenda.mjs";
import { straatasPredicaat } from "../lib/plaatsnaam.mjs";
import { buildStraatIndex, zoekStraat } from "../lib/straatnamen.mjs";
import { opkuisStraatnamen, telToevoegingen } from "../scripts/opkuis-straatnamen.mjs";
await import("../site/agenda-ics.js");
const { buildIndividualIcs } = globalThis.AgendaIcs;

const lees = (rel) => JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), "utf8"));
const CODES = ["AN", "BE", "BO", "DE", "EK", "HO", "WI"];

// ---------- wat nergens mag staan ----------

// Een toevoeging van de straatas (ook een code die niet gemeten is).
const TOEVOEGING = /\p{L}_[A-Z]{2}(?![\p{L}\p{N}_])/u;
// Een huisnummer na de verzonnen straatnaam ("Proefstraat 12", "PROEFSTRAAT_AN 12", "Proefstraat, 12").
const NUMMER_NA_STRAAT = /proefstraat(?:_[a-z]{2})?\s*[,:-]?\s*\d{1,3}(?!\d)/iu;
// Alle teksten in een waarde (getallen en coördinaten niet).
const teksten = (waarde, uit = []) => {
  if (typeof waarde === "string") uit.push(waarde);
  else if (Array.isArray(waarde)) for (const v of waarde) teksten(v, uit);
  else if (waarde && typeof waarde === "object") for (const v of Object.values(waarde)) teksten(v, uit);
  return uit;
};
const nergens = (waarde, wat, { nummer = false } = {}) => {
  for (const t of teksten(waarde)) {
    assert.doesNotMatch(t, TOEVOEGING, `${wat}: toevoeging in ${JSON.stringify(t)}`);
    if (!nummer) assert.doesNotMatch(t, NUMMER_NA_STRAAT, `${wat}: huisnummer in ${JSON.stringify(t)}`);
  }
};

// ---------- de verzonnen straatas ----------

// Twee straten die allebei "Proefstraat" heten (de straatas noemt ze "Proefstraat_AN" in 2018 en "Proefstraat_XY" in
// 2000) en een Voorbeeldlaan die ze kruist. In het centrum van Antwerpen, ruim binnen het district.
const X0 = 4.4000, Y0 = 51.2100;
const P = (dx, dy) => [Number((X0 + dx).toFixed(6)), Number((Y0 + dy).toFixed(6))];
const lijnVan = (a, b, n = 8) => Array.from({ length: n + 1 }, (_, i) => [Number((a[0] + ((b[0] - a[0]) * i) / n).toFixed(6)), Number((a[1] + ((b[1] - a[1]) * i) / n).toFixed(6))]);
const as = (id, naam, postcode, a, b) => ({ type: "Feature", properties: { LSTRNMID: id, LSTRNM: naam, RSTRNMID: id, RSTRNM: naam, postcode, DISTRICT: "Antwerpen" }, geometry: { type: "LineString", coordinates: lijnVan(a, b) } });
const STRAATAS = [
  as(990001, "Proefstraat_AN", "2018", P(0, 0), P(0.004, 0)),
  as(990002, "Proefstraat_XY", "2000", P(0, 0.004), P(0.004, 0.004)),
  as(990003, "Voorbeeldlaan", "2018", P(0.006, -0.002), P(0.006, 0.006)),
];
const PUNT_AN = P(0.001, 0.00001), PUNT_XY = P(0.001, 0.00401);

const index = buildStreetIndex(STRAATAS);
const rijen = buildStreetList(index, []);
const plekken = buildPlaceIndex({ streets: rijen });
const isStraat = straatasPredicaat({ index });

test("homoniem: de straatas komt binnen zonder toevoeging; twee naamgenoten verschillen door hun id (straatindex, straten.json, historiek)", () => {
  for (const ruw of ["Proefstraat_AN", " Proefstraat_AN ", "Proefstraat_XY", "Lange Testlei_DE"]) assert.equal(straatasNaam(ruw), ruw.trim().slice(0, -3));
  assert.equal(straatasNaam("Voorbeeldlaan"), "Voorbeeldlaan");
  const refs = [...index.byName.values()].flat();
  nergens(refs, "straatindex");
  assert.deepEqual(index.byName.get("proefstraat").map((r) => `${r.id}|${r.name}|${r.postcode}`).sort(), ["990001|Proefstraat|2018", "990002|Proefstraat|2000"]);
  assert.equal(resolvePointStreet(PUNT_AN, index).streets[0].id, "990001");
  assert.equal(resolvePointStreet(PUNT_XY, index).streets[0].id, "990002");
  nergens(nearbyStreets(PUNT_AN, index, { maxDistanceMeters: 600, count: 5 }), "nearbyStreets");
  // straten.json zoals scripts/build-straten.mjs het schrijft.
  assert.deepEqual(rijen.map((r) => [r[0], r[1], r[2]]).sort(), [["990001", "Proefstraat", "2018"], ["990002", "Proefstraat", "2000"], ["990003", "Voorbeeldlaan", "2018"]]);
  // De straatas van de historiek (lib/street-resolver.mjs) en die van de andere districten (straten-stad.json).
  nergens([...historiekStraatas(STRAATAS).byName.values()], "straatas van de historiek");
  assert.equal(schoneNaam("Proefstraat_XY"), "Proefstraat");
  const ekeren = districtenTabel().find((d) => d.label === "Ekeren");
  const stad = bouwStadStraten({ asRijen: [{ id: 1, naam: "Proefstraat_EK", postcode: ekeren.postcodes[0], district: "Ekeren" }, { id: 2, naam: "Proefstraat", postcode: ekeren.postcodes[0], district: "Ekeren" }] });
  assert.deepEqual(stad.straten.map((r) => r[0]), ["Proefstraat"]);
  // Een straatnaam uit een stadslaag (de foren, de schoolstraten) tegen straten.json.
  const stadslaag = buildStraatIndex({ streets: rijen });
  assert.equal(zoekStraat("PROEFSTRAAT_AN", stadslaag).naam, "Proefstraat");
  assert.equal(zoekStraat("ONBEKENDLEI_XY", stadslaag).naam, "Onbekendlei");
});

test("homoniem: de straatas van de andere districten (één vraag per punt) geeft de naam zonder toevoeging", async () => {
  const antwoord = { type: "FeatureCollection", features: [{ type: "Feature", properties: { LSTRNM: "Proefstraat_WI", RSTRNM: "Proefstraat_WI" }, geometry: { type: "LineString", coordinates: [P(0, 0), P(0.001, 0)] } }] };
  const nep = async () => new Response(JSON.stringify(antwoord), { status: 200, headers: { "content-type": "application/json" } });
  assert.equal(await straatBijPuntOnline(nep, P(0.0005, 0)), "Proefstraat");
});

// ---------- de bronnen: GIPOD en A-Sign ----------

const GIPOD = (id, Description, punt = PUNT_AN) => ({ type: "Feature", geometry: { type: "Point", coordinates: punt }, properties: { GipodId: id, Description, Owner: "Proefnet", Status: "In uitvoering", Start: "2026-10-15T00:00:00Z", End: "2026-10-30T00:00:00Z", Uri: `https://gipod.api.vlaanderen.be/api/v1/groundworks/${id}` } });
const werken = applyWorkStreetResolution(collectWorks([
  GIPOD(990101, "2018 ANTWERPEN, PROEFSTRAAT_AN 12"),
  GIPOD(990102, "2000 ANTWERPEN, PROEFSTRAAT_XY 12 DN40", PUNT_XY),
  // Geen straat op het punt: de dichtste straat (streetNearby), of de straat die de titel noemt.
  GIPOD(990103, "Nieuwe aansluiting", P(0.001, 0.0008)),
  GIPOD(990104, "Nieuwe aansluiting Proefstraat_AN 12", P(0.001, 0.0008)),
], new Set([990101, 990102, 990103, 990104])), index);
const parkeer = normalizeParking({ Dossiernummer: "PV2099", Locatienummer: "1", Status: "Goedgekeurd", Adres: "Proefstraat_AN 12 2018 Antwerpen", Postcode: "2018", Reden: "Verhuis", Startdatum: Date.UTC(2026, 9, 18), Einddatum: Date.UTC(2026, 9, 18) });

test("homoniem: GIPOD en A-Sign komen binnen zonder toevoeging (werken, hinder, parkeerverbod)", () => {
  assert.equal(gipodTekst("2018 ANTWERPEN, PROEFSTRAAT_AN 12"), "2018 ANTWERPEN, PROEFSTRAAT 12");
  assert.deepEqual(werken.map((w) => w.title).sort(), ["2000 ANTWERPEN, PROEFSTRAAT 12 DN40", "2018 ANTWERPEN, PROEFSTRAAT 12", "Nieuwe aansluiting", "Nieuwe aansluiting Proefstraat 12"]);
  const per = Object.fromEntries(werken.map((w) => [w.gipodId, w]));
  assert.deepEqual(per[990101].streets, [{ id: "990001", name: "Proefstraat", postcode: "2018" }]);
  assert.deepEqual(per[990102].streets, [{ id: "990002", name: "Proefstraat", postcode: "2000" }]);
  assert.equal(per[990103].streetNearby?.[0]?.name, "Proefstraat");
  assert.equal(per[990104].streets?.[0]?.name, "Proefstraat");
  for (const w of werken) for (const t of teksten(w)) assert.doesNotMatch(t, TOEVOEGING, t);
  const hinder = collectHindrance([{ type: "Feature", geometry: { type: "Point", coordinates: PUNT_AN }, properties: { HindranceStatus: "Gevalideerd", HindranceConsequenceOf: "https://gipod.api.vlaanderen.be/api/v1/works/990101;", HindranceGipodId: 1, HindranceDescription: "Fase 1: Proefstraat_AN afgesloten", HindranceStart: "2026-10-15", HindranceEnd: "2026-10-30", Consequences: "Afgesloten" } }]);
  const fasen = [...hinder.values()].flatMap((h) => h.phases.map((f) => f.description));
  assert.deepEqual(fasen, ["Fase 1: Proefstraat afgesloten"]);
  assert.equal(parkeer.address, "Proefstraat, 2018 Antwerpen");
  assert.equal(adresZonderHuisnummer("Proefstraat_XY 12-14 2000 Antwerpen"), "Proefstraat, 2000 Antwerpen");
  assert.doesNotMatch(publiekParkeerAdres("Proefstraat_AN 12-14 2018 Antwerpen", "Proefstraat, 2018 Antwerpen"), TOEVOEGING);
});

test("homoniem: de huisnummers van een werk vinden de straat ook als de adresposities van de stad ze met toevoeging schrijven", async () => {
  // De adresposities (CRAB) kennen de straat alleen als "Proefstraat_AN"; de straat van het werk heet "Proefstraat".
  assert.equal(crabStraatWhere("Proefstraat"), "STRAATNM='Proefstraat' OR STRAATNM LIKE 'Proefstraat\\_%' ESCAPE '\\'");
  assert.equal(crabStraatWhere("Proef'straat_1%"), "STRAATNM='Proef''straat_1%' OR STRAATNM LIKE 'Proef''straat\\_1\\%\\_%' ESCAPE '\\'");
  const crab = [{ STRAATNM: "Proefstraat_AN", HUISNR: "12" }, { STRAATNM: "Proefstraat_AN", HUISNR: "40" }];
  const nep = async (url, init = {}) => {
    const where = new URLSearchParams(String(init.body || "")).get("where") || "";
    const past = (naam) => where.includes(`STRAATNM='${naam}'`) || where.includes(`STRAATNM LIKE '${naam.replace(/_[A-Z]{2}$/, "")}\\_%'`);
    return { ok: true, json: async () => ({ features: crab.filter((a) => past(a.STRAATNM)).map((a) => ({ attributes: a })) }) };
  };
  const vierkant = [[P(0, 0), P(0.001, 0), P(0.001, 0.0005), P(0, 0.0005), P(0, 0)]];
  assert.equal(await huisnummersVoorWerk({ gipodId: 990101, straat: "Proefstraat", rings: vierkant }, nep), "nr. 12–40");
});

// ---------- de historiek ----------

test("homoniem: de historiek houdt geen toevoeging en geen huisnummer na zo'n straat, ook niet uit een oud bestand (vangnet)", () => {
  // De huisnummerregel: een straatnaam met toevoeging is een straatnaam.
  for (const t of ["2018 ANTWERPEN, PROEFSTRAAT_AN 12", "Proefstraat_AN 12 bus 3", "Proeflei_DE 7", "2000 ANTWERPEN, PROEFSTRAAT_XY 12 DN40"]) {
    assert.doesNotMatch(tekstZonderHuisnummers(t), /\b(?:12|7)\b/, t);
  }
  const oud = { id: "work:990101", gipodId: 990101, title: "2018 ANTWERPEN, PROEFSTRAAT_AN 12", status: "In uitvoering", streets: [{ id: "990001", name: "Proefstraat_AN", postcode: "2018" }] };
  const doc = {
    schemaVersion: 1, observedAt: "2026-10-17T03:00:00.000Z",
    layers: { works: { status: "ok", items: werken.map(({ point, sourceUrls, ...w }) => w) }, publicSpace: { status: "ok", items: [{ id: "parking:PV2099|1", kind: "parking", location: "Proefstraat_AN 12 2018 Antwerpen", streets: [{ id: "990001", name: "Proefstraat_AN", postcode: "2018" }] }] } },
    changes: [{ id: oud.id, type: "added", observedAt: "2026-10-16T03:00:00.000Z", after: oud }, { id: oud.id, type: "changed", observedAt: "2026-10-17T03:00:00.000Z", fields: ["title"], before: { title: "2018 ANTWERPEN, PROEFSTRAAT_AN 12" }, after: { title: "2018 ANTWERPEN, PROEFSTRAAT_AN 14" } }],
  };
  const codes = new Set(historiekPrivacyBevindingen(doc).map((f) => f.code));
  assert.ok(codes.has("huisnummer") && codes.has("toevoeging"), [...codes].join(", "));
  const schoon = historiekVoorPubliek(doc);
  nergens(schoon, "historiek");
  assert.deepEqual(historiekPrivacyBevindingen(schoon), []);
  // Een wijziging die alleen het huisnummer was, valt weg.
  assert.equal(schoon.changes.length, 1);
  nergens(resultaatVoorHistoriek({ ok: true, items: werken }), "resultaat van de verversing");
});

// ---------- de straatbestanden ----------

test("homoniem: de straatbestanden: een nieuw item en een vorige stand zonder toevoeging; herschrijven maakt een oud bestand schoon", (t) => {
  const nieuw = werken.map((w) => itemVoorStraat(w, { laag: "werken" })).filter(Boolean);
  assert.equal(nieuw.length, werken.length);
  nergens(nieuw, "itemVoorStraat");
  // Een vorige stand (een laag die vandaag niet laadde) met de oude naam in de tabel en de titel.
  const vorig = { id: "work:990199", gipodId: 990199, title: "2018 ANTWERPEN, PROEFSTRAAT_AN", status: "In uitvoering", start: "2026-10-01", end: "2026-10-30", streets: [{ id: "990001", name: "Proefstraat_AN", postcode: "2018" }] };
  const doc = straatDocument("990001", { werken: new Map([...nieuw, vorig].map((w) => [w.id, w])) }, { namen: [{ id: "990001", name: "Proefstraat_AN", postcode: "2018" }], ververst: "2026-10-17T03:00:00.000Z" });
  nergens(doc, "straatDocument");
  assert.deepEqual(doc.straten.filter((s) => s[0] === "990001"), [["990001", "Proefstraat", "2018"]], "één rij per straat");
  nergens(straatItems(doc, "werken"), "straatItems");

  // Het hele schrijven, in een tijdelijke map: een oud bestand (met toevoeging) herschreven met de regels van nu.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "homoniem-straat-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "site", "geo"), { recursive: true });
  fs.mkdirSync(path.join(root, "site", "straat"), { recursive: true });
  fs.writeFileSync(path.join(root, "site", "geo", "straten.json"), JSON.stringify({ schemaVersion: 1, streets: rijen }));
  const oud = { schemaVersion: STRAAT_SCHEMA, ververst: "2026-10-16T03:00:00.000Z", inhoud: "oud", straat: { id: "990001", namen: [{ name: "Proefstraat_AN", postcode: "2018" }] }, straten: [["990001", "Proefstraat_AN", "2018"]], werken: [{ id: "work:990101", gipodId: 990101, title: "2018 ANTWERPEN, PROEFSTRAAT_AN", status: "In uitvoering", start: "2026-10-15", end: "2026-10-30", streets: [0] }, { id: "work:990102", gipodId: 990102, title: "2018 ANTWERPEN, PROEFSTRAAT_AN 12", status: "In uitvoering", start: "2026-10-15", end: "2026-10-30", streets: [0] }], publiekeRuimte: [], vergunningen: [], terrassen: [], evenementen: [] };
  fs.writeFileSync(path.join(root, "site", "straat", "990001.json"), JSON.stringify(oud));
  const stand = { status: "ok", sinds: "2026-10-16T03:00:00.000Z" };
  fs.writeFileSync(path.join(root, "site", "straat-index.json"), JSON.stringify({ schemaVersion: STRAAT_SCHEMA, ververst: "2026-10-16T03:00:00.000Z", lagen: { werken: stand, publiekeRuimte: stand, vergunningen: stand, terrassen: stand, evenementen: stand }, straten: { 990001: "oud" } }));
  schrijfStraatSnapshots({ rootDir: root, herschrijf: true, agendaItems: [], history: null, clock: () => new Date("2026-10-17T10:00:00Z") });
  const herschreven = JSON.parse(fs.readFileSync(path.join(root, "site", "straat", "990001.json"), "utf8"));
  nergens(herschreven, "herschreven straatbestand");
  // Een oud bestand van vóór de regel: "PROEFSTRAAT_AN 12" telde toen niet als straat met huisnummer. Zonder de
  // toevoeging is 12 een huisnummer; het valt weg zoals bij een nieuw item (itemVoorStraat), en het item blijft.
  assert.deepEqual(herschreven.werken.map((w) => w.title), ["2018 ANTWERPEN, PROEFSTRAAT", "2018 ANTWERPEN, PROEFSTRAAT"]);
  assert.deepEqual(straatBestandenProblemen(root), []);
  const idx = JSON.parse(fs.readFileSync(path.join(root, "site", "straat-index.json"), "utf8"));
  assert.equal(idx.ververst, "2026-10-16T03:00:00.000Z", "herschrijven is geen verversing");
  assert.deepEqual(idx.lagen.werken, stand);
  assert.equal(idx.straten["990001"], herschreven.inhoud);
});

// ---------- kaart-uitleg.json ----------

test("homoniem: kaart-uitleg.json: geen toevoeging, ook niet in wat uit de vorige stand meegaat", async (t) => {
  const document = (velden = {}) => ({ schemaVersion: 1, generatedAt: "2026-10-16T05:00:00.000Z", vanaf: "2026-10-16", tot: "2026-12-15", werken: {}, evenementen: {}, ...velden });
  const werk = { soort: "Nieuwe aansluiting", soortBron: "soort inname", omschrijving: "Nieuwe aansluiting", opdrachtgever: "", huisnummers: "", huisnummerBron: "", bijgewerkt: "2026-10-01", straten: ["Proefstraat_AN"], vlakStraten: ["Proefstraat_AN", "Proefstraat_XY"], gevolgen: [], fasen: [] };
  const evenement = { start: "2026-10-20", eind: "2026-10-20", soort: "", soortBron: "", beschrijvingen: ["Parcours: Proefstraat"], straten: ["Proefstraat_AN", "Voorbeeldlaan"], kruist: ["Proefstraat_XY"], langs: ["Proefstraat_AN"], stratenTekst: "Proefstraat_AN en Voorbeeldlaan", gekoppeld: null, kaart: [], kaartDeel: false };
  const vorige = document({ werken: { 990101: werk }, evenementen: { ET2099000301: evenement } });
  const schoon = kaartUitlegVoorPubliek(vorige);
  nergens({ werken: schoon.werken, evenementen: schoon.evenementen }, "kaartUitlegVoorPubliek");
  assert.deepEqual(validateKaartUitleg(schoon), []);
  assert.equal(telToevoegingen(vorige), 7);
  assert.equal(telToevoegingen(schoon), 0);
  // De verversing: de lagen laden niet, de vorige feiten gaan mee, en worden zonder toevoeging geschreven.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "homoniem-uitleg-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "site", "sources"), { recursive: true });
  const bestand = path.join(root, "site", "sources", KAART_UITLEG_FILE);
  fs.writeFileSync(bestand, JSON.stringify(vorige));
  const logs = [];
  const uit = await schrijfKaartUitleg({ rootDir: root, works: { ok: false, items: [] }, publicSpace: { ok: false }, fetch: null, clock: () => new Date("2026-10-17T05:00:00Z"), log: (r) => logs.push(r) });
  assert.ok(uit, logs.join(" "));
  const geschreven = JSON.parse(fs.readFileSync(bestand, "utf8"));
  nergens({ werken: geschreven.werken, evenementen: geschreven.evenementen }, "geschreven kaart-uitleg.json");
  assert.deepEqual(geschreven.werken["990101"].vlakStraten, ["Proefstraat", "Proefstraat"]);
});

// ---------- een evenement: herkenning, agenda, feed, eventpagina, .ics ----------

const ms = (dag) => Date.parse(`${dag}T00:00:00Z`);
const IOD = (nr, type, geometry, beschrijving = "") => ({ attributes: { dossierNummer: nr, dossierStatus: "aanvraag_goedgekeurd", faseNaam: "Evenement", faseStartDatum: ms("2026-10-20"), faseEindDatum: ms("2026-10-20"), innameTypeNaam: type, innameBeschrijving: beschrijving, last_edited_date: Date.UTC(2026, 8, 1) }, geometry });
const ROUTE = { paths: [lijnVan(P(0.0005, 0), P(0.0035, 0), 12)] };
const dossier = (() => {
  const d = L.dossiersUitAsign([IOD("ET2099000401", "Parcours", ROUTE, "Start Proefstraat_AN 12 bij Testpersoon")]).get("ET2099000401");
  return L.verrijk(d, {
    straatBij: (p) => straatBijPunt(p, index), postcodeBij: (p) => resolvePointStreet(p, index).streets[0]?.postcode || "",
    stratenLangs: (lijnen) => stratenLangsLijn(lijnen, index), wijkVan: () => "Proefwijk", wijkBijPunt: () => "Proefwijk", isStraat, stratenRond: (p) => nearbyStreets(p, index, { maxDistanceMeters: 150, count: 30 }).map((x) => x.name),
  });
})();

test("homoniem: de herkenning van een parcours (plek en waar van de automatische fiche) noemt de straat zonder toevoeging", () => {
  const plek = L.plekKort({ ...dossier, vorm: { ...dossier.vorm, heeftParcours: true }, vertrekStraat: straatBijPunt(P(0.0005, 0), index) });
  assert.equal(plek, "vanaf de Proefstraat");
  const waar = L.routeZin(dossier, { vandaag: "2026-10-17" });
  assert.match(waar, /Proefstraat/);
  nergens({ plek, waar, kaartzin: L.kaartzin(dossier, { vandaag: "2026-10-17" }) }, "herkenning");
});

test("homoniem: agenda, feed, eventpagina en .ics noemen de straat zonder toevoeging en zonder huisnummer", () => {
  // In het district (de grens van het district laat deze toets weg: verrijk zet binnenDistrict alleen met die grens).
  const feiten = [{ ...dossierFeiten(dossier, { index }), binnenDistrict: true }];
  assert.ok(feiten[0].langs.includes("Proefstraat"), feiten[0].langs.join(", "));
  const auto = { dossiers: { ET2099000401: { zekerheid: "waarschijnlijk", naam: "", soort: "een wandeling", organisator: "", uren: "", link: "", methode: "regels", dagen: [], binnenDistrict: true, plek: L.plekKort(dossier), waar: L.routeZin(dossier, { vandaag: "2026-10-17" }) } } };
  const { items } = asignAgendapunten({ feiten, auto, vandaag: "2026-10-17", retrievedAt: "2026-10-17T05:20:00.000Z" });
  assert.equal(items.length, 1);
  const item = items[0];
  // Wat de feed bewaart, wat de eventpagina toont (titel, info, plaats), de tekst die build-sources opnieuw maakt en de .ics.
  const ics = buildIndividualIcs({ ...item, link: item.sourceUrl }, { now: "2026-10-17T05:20:00.000Z" }).replace(/\r\n[ \t]/g, "");
  nergens({ item, build: tekstUitFeiten(item, { auto }), ics }, "agendapunt");
  assert.match(item.location, /Proefstraat/);
  assert.ok(item.straten.includes("Proefstraat"));
  // De plekpagina: de plaats noemt de straat al, dus geen extra regel "Ook in jouw straat" (nakijkronde 3, laag).
  assert.deepEqual(agendaStraten(item, "Proefstraat").jouwStraat, "");
});

// ---------- de plekpagina ----------

test("homoniem: de plekpagina (zoekbalk, link, kaartzin, kaartjes, alles per straat) noemt de straat zonder toevoeging", () => {
  const straten = plekken.places.filter((p) => p.type === "straat");
  nergens(straten.map(({ box, ...p }) => p), "plekindex");
  const an = plekken.places.find((p) => p.id === "990001"), xy = plekken.places.find((p) => p.id === "990002");
  assert.ok(an.ambiguous && xy.ambiguous, "twee straten met dezelfde naam: de link noemt de postcode");
  assert.equal(placeParam(an, plekken), "Proefstraat 2018");
  assert.equal(resolvePlaceParam(plekken, "Proefstraat 2018"), an);
  // Een oude link of een bewaarde straat met de toevoeging vindt de straat nog.
  assert.equal(resolvePlaceParam(plekken, "Proefstraat_AN 2018"), an);
  assert.equal(resolvePlaceParam(plekken, "straat:990001|Proefstraat_AN|2018"), an);
  const opslag = { getItem: (k) => (k === OPSLAG_SLEUTEL ? JSON.stringify(["straat:990001|Proefstraat_AN|2018"]) : null) };
  assert.deepEqual(leesBewaardeStraten(opslag), [an.key]);
  // De kaartzin onder de kaart (neighborhood-map.js: de naam van de gekozen straat, place-view.js streetRef).
  nergens(kaartStatusZin({ where: `${an.name} + 150 m`, mapped: 2, opKaart: 2 }), "kaartzin");
  // De kaartjes van een werk, een parkeerverbod en een evenement. Een werk toont zijn huisnummer (regel van de eigenaar van
  // 26 oktober 2026: het huisnummer staat er altijd, behalve bij een verhuizing), maar nooit de toevoeging.
  for (const w of werken) nergens((({ title, summary, location, uitleg }) => ({ title, summary, location, uitleg }))(workEntry(w, { vandaag: "2026-10-17" })), `werk ${w.gipodId}`, { nummer: true });
  assert.match(JSON.stringify(workEntry(werken.find((w) => w.gipodId === 990104), { vandaag: "2026-10-17" }).uitleg), /Proefstraat 12/);
  const pv = publicSpaceEntry({ ...parkeer, id: "parking:PV2099|1", kind: "parking", title: "Parkeerverbod", location: parkeer.address, streets: resolvePointStreet(PUNT_AN, index).streets, start: "2026-10-18", end: "2026-10-18" });
  nergens((({ title, location, info }) => ({ title, location, info }))(pv), "parkeerverbod");
  const rij = { id: "iod:ET2099000401|Evenement|1", kind: "iod", title: "Parcours", innameType: "Parcours", reference: "ET2099000401", dossierType: "ETL", phase: "Evenement", hindrance: "True", start: "2026-10-20", end: "2026-10-20", status: "aanvraag_goedgekeurd", streets: resolvePointStreet(PUNT_AN, index).streets, description: normalizeIod({ innameBeschrijving: "Start Proefstraat_AN 12 bij Testpersoon" }, { isStraat }).description };
  const ev = evenementEntry([rij], { vandaag: "2026-10-17", wijkVan: () => "", straat: an.name, index });
  nergens((({ title, summary, location, uitleg, jouwStraat }) => ({ title, summary, location, uitleg, jouwStraat }))(ev), "evenementkaartje");
  assert.equal(waarKort(["Proefstraat", "Voorbeeldlaan", "Testkaai"], an.name), "Proefstraat + 2 andere straten");
  // Alles per straat en de district-radar op de voorpagina (street-overview.js).
  const groepen = buildStreetGroups({ works: werken, publicSpace: [pv.item || { ...parkeer, id: "parking:PV2099|1", kind: "parking", streets: rij.streets }] });
  assert.ok(groepen.length >= 2, `${groepen.length} groepen`);
  nergens(groepen.map((g) => g.street), "alles per straat");
  nergens(buildDistrictRadar(groepen, null), "district-radar");
});

// ---------- de privacyfilter ----------

test("homoniem: de privacyfilter laat de toevoeging nooit door en herkent de straat onder haar naam", () => {
  const rond = nearbyStreets(PUNT_AN, index, { maxDistanceMeters: 150, count: 30 }).map((x) => x.name);
  const straten = resolvePointStreet(PUNT_AN, index).streets;
  const vormen = (s, c) => [`${s} ${c}`, `${s}-${c}`, `${s}_${c}`, `${s}'${c}`, `${s.toUpperCase()} ${c}`, `${s}_XY`];
  for (const code of CODES) {
    for (const t of vormen("Proefstraat", code)) {
      for (const opties of [{ straten }, { rond }, { isStraat }]) {
        const uit = W.witteLijst(`Opbouw ${t} 12 bij Testpersoon`, opties);
        assert.equal(uit.tekst, /^PROEFSTRAAT/.test(t) ? "PROEFSTRAAT" : "Proefstraat", `${t} → ${uit.tekst}`);
      }
    }
  }
  // Een reeks die op een code eindigt is nooit een plek (de twee letters kunnen initialen zijn).
  assert.equal(W.witteTekst("Testpersoon AN", { isStraat }), "");
  assert.equal(normalizeIod({ innameBeschrijving: "Proefstraat_XY 7 bij Testpersoon" }, { isStraat }).description, "Proefstraat");
  // Eigenschap: met elke code, scheiding en naam ernaast blijft geen toevoeging, losse code of cijfer over.
  let zaad = 20261017;
  const r = () => { zaad = (zaad * 1103515245 + 12345) % 2147483648; return zaad / 2147483648; };
  const kies = (lijst) => lijst[Math.floor(r() * lijst.length)];
  const NAMEN = ["Testpersoon", "Van Proefmans", "T. Voorbeeld", "fam. Testers", "Zorvex Quilxan"];
  for (let i = 0; i < 2000; i += 1) {
    const code = kies([...CODES, "XY", "ME"]);
    const t = kies([() => kies(vormen("Proefstraat", code)), () => `${kies(NAMEN)} ${kies(vormen("Proefstraat", code))} ${1 + Math.floor(r() * 99)}`, () => `Opbouw Proefstraat_${code}, ${kies(NAMEN)}`])();
    const uit = W.witteLijst(t, kies([{ straten }, { rond }, { isStraat }]));
    assert.doesNotMatch(uit.tekst, /_|\d/, `${t} → ${uit.tekst}`);
    for (const p of uit.plekken) assert.equal(W.sleutel(p), "proefstraat", `${t} → ${p}`);
  }
});

// ---------- vangnetten en de bewaarde bestanden ----------

test("homoniem: vangnet: een huisnummer na een straatnaam met toevoeging valt ook weg in de tekst van een kaartje", () => {
  assert.doesNotMatch(KU.zonderLosseHuisnummers("2018 ANTWERPEN, PROEFSTRAAT_AN 12", ["Proefstraat"]), /12/);
  assert.doesNotMatch(KU.zonderLosseHuisnummers("Proefstraat_XY 7 werken", []), /7/);
  assert.doesNotMatch(KU.zonderHuisnummers("PROEFSTRAAT_AN 12"), /12/);
  assert.equal(W.zonderToevoegingInData({ a: ["Proefstraat_AN"], url: "https://voorbeeld.test/x_AN" }).url, "https://voorbeeld.test/x_AN", "een link blijft ongewijzigd");
});

test("homoniem: de bewaarde bestanden van de repo hebben geen toevoeging, en de opkuis vindt niets meer", () => {
  const namen = [...lees("../site/geo/straten.json").streets.map((s) => s[1]), ...lees("../site/geo/straten-stad.json").straten.map((s) => s[0])];
  assert.ok(namen.length > 3000, `${namen.length} namen`);
  assert.deepEqual(namen.filter((n) => TOEVOEGING.test(n)), [], "straten.json en straten-stad.json");
  // Geen straatnaam eindigt op een losse code: de regel "Proefstraat AN is geen plek" kost geen echte straat.
  assert.deepEqual(namen.filter((n) => { const w = W.sleutel(n).split(" "); return w.length > 1 && CODES.includes(w.at(-1).toUpperCase()); }), []);
  const map = new URL("../site/", import.meta.url);
  const bestanden = [
    "history/live-layers.json", "sources/kaart-uitleg.json", "sources/evenement-identiteit-auto.json", "sources/district-asign-evenementen.json", "sources/evenement-patronen.json", "history/radar.json",
    ...fs.readdirSync(new URL("history/archive/", map)).filter((f) => f.endsWith(".json")).map((f) => `history/archive/${f}`),
    ...fs.readdirSync(new URL("straat/", map)).filter((f) => f.endsWith(".json")).map((f) => `straat/${f}`),
  ];
  const fout = [];
  for (const rel of bestanden) {
    const tel = telToevoegingen(JSON.parse(fs.readFileSync(new URL(rel, map), "utf8")));
    if (tel) fout.push(`${rel}: ${tel}`);
  }
  assert.deepEqual(fout, []);
  const rapport = opkuisStraatnamen({ rootDir: path.resolve(new URL("..", import.meta.url).pathname), write: false });
  assert.equal(rapport.kaartUitleg.gewijzigd, false);
  assert.deepEqual(rapport.historiek.gewijzigd, []);
});
