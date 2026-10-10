// Nakijkronde op P2 (evenementdossiers als agendapunten): elke bevinding met een toets die op de vorige kop
// faalde. Alle gegevens zijn verzonnen: geen echte dossiers, straten, organisatoren of personen.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ASIGN_EVENEMENTEN_SOURCE_ID, KRIMP_DAGEN, VOORUIT_DAGEN, asignAgendapunten, dossierFeiten, koppelBesluiten, schrijfAsignEvenementen,
} from "../lib/asign-evenementen-agenda.mjs";
import { sourceHealthOf } from "../lib/fetch-util.mjs";
import { mergeEvents } from "../lib/merge-events.mjs";
import { sourceDocument, validateRefreshStatus } from "../lib/source-feed.mjs";
import { buildFeed } from "../scripts/build-sources.mjs";
import { refreshAll } from "../scripts/refresh-fetch.mjs";
import { checkHealth } from "../scripts/sources-health.mjs";
import { buildStreetIndex } from "../site/street-core.js";

const VANDAAG = "2026-10-10";
const RETRIEVED = "2026-10-10T05:20:00.000Z";
const GOED = "aanvraag_goedgekeurd";
const ID = ASIGN_EVENEMENTEN_SOURCE_ID;

const feit = (dossier, velden = {}) => ({
  dossier, status: GOED, binnenDistrict: true, fasen: [{ naam: "Evenement", start: "2026-10-18", eind: "2026-10-18" }], dagen: ["2026-10-18"],
  langs: [], zone: [], kernStraten: ["Proefstraat"], beginStraat: "Proefstraat", wijk: "Proefwijk", postcodes: ["2000"], speelstraat: false, vorm: null,
  ...velden,
});
const fiche = (velden = {}) => ({ zekerheid: "onbekend", naam: "", soort: "", organisator: "", uren: "", link: "", methode: "kaart", dagen: [], binnenDistrict: true, ...velden });
const bouw = (opties) => asignAgendapunten({ vandaag: VANDAAG, retrievedAt: RETRIEVED, ...opties });
const besluit = (velden = {}) => ({
  id: "1.2.3.4.9", code: "2099_CBS_00009", soort: "evenement", status: "goedkeuring", orgaan: "College van burgemeester en schepenen", zitting: "2026-09-20",
  gepubliceerd: true, gelezen: true, naam: "Proeffeest", organisator: null, dagen: ["2026-10-18"], uren: null, plaats: "Proefplein", straten: ["Proefplein"],
  postcodes: ["2000"], inDistrict: true, opbouw: null, afbouw: null, wijziging: null, vervangt: [], bron: "https://ebesluit.antwerpen.be/zittingen/1.2/agendapunten/1.2.3.4.9",
  ...velden,
});
const as = (id, naam, coordinates) => ({ properties: { DISTRICT: "ANTWERPEN", LSTRNMID: id, LSTRNM: naam, RSTRNMID: id, RSTRNM: naam, postcode: 2000 }, geometry: { type: "LineString", coordinates } });

function tijdelijk(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "asign-nakijk-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "site", "sources"), { recursive: true });
  return root;
}
const statusBestand = (root, sources = []) => fs.writeFileSync(path.join(root, "site", "sources", "refresh-status.json"), JSON.stringify({ schemaVersion: 1, generatedAt: RETRIEVED, classificationAsOf: VANDAAG, sources }));
const leesStatus = (root) => JSON.parse(fs.readFileSync(path.join(root, "site", "sources", "refresh-status.json"), "utf8"));
const bronBestand = (root) => path.join(root, "site", "sources", `${ID}.json`);
// Dossiers zoals de parcoursherkenning ze verrijkt: één evenementdag, een eigen plek in een straat van de straatas.
const verrijkt = (n, straat = "Voorbeeldlaan", dag = "2026-10-18") => ({
  dossier: `ET2099${String(200000 + n)}`, status: GOED, binnenDistrict: true, fasen: [{ naam: "Evenement", start: dag, eind: dag }], dagen: [dag],
  innames: [], beschrijvingen: [], beginStraat: straat, eindStraat: "", kernStraten: [straat], wijk: "", postcodes: ["2000"], vorm: null, bijgewerkt: "2026-09-01",
});
const metSoort = (dossiers) => ({ dossiers: Object.fromEntries(dossiers.map((d) => [d.dossier, fiche({ zekerheid: "waarschijnlijk", soort: "een wielerwedstrijd", methode: "regels" })])) });

// ---------- H1: zonder straatas geen halve bron ----------

test("H1: zonder straatas blijft het vorige bestand byte voor byte staan, en refresh-status.json meldt de fout", (t) => {
  const root = tijdelijk(t);
  statusBestand(root);
  const index = buildStreetIndex([as(2, "Voorbeeldlaan", [[4.406, 51.2], [4.406, 51.204]])]);
  const dossiers = [verrijkt(1)];
  const log = [];
  assert.ok(schrijfAsignEvenementen({ rootDir: root, dossiers, index, auto: metSoort(dossiers), vandaag: VANDAAG, generatedAt: RETRIEVED, log: (r) => log.push(r) }));
  const ok = leesStatus(root).sources.find((e) => e.sourceId === ID);
  assert.deepEqual([ok.fetchStatus, ok.itemCount, ok.upcomingCount, ok.retrievedAt, ok.errorCode], ["ok", 1, 1, RETRIEVED, null], "de bron staat in refresh-status.json");
  const voor = fs.readFileSync(bronBestand(root), "utf8");
  // De straatas antwoordt met 503: geen straten, dus niet schrijven.
  const later = "2026-10-11T05:20:00.000Z";
  assert.equal(schrijfAsignEvenementen({ rootDir: root, dossiers, index: null, straatasFout: "http_503", auto: metSoort(dossiers), vandaag: "2026-10-11", generatedAt: later, log: (r) => log.push(r) }), null);
  assert.equal(fs.readFileSync(bronBestand(root), "utf8"), voor, "byte voor byte het vorige bestand");
  assert.match(log.at(-1), /"asignEvenementen":"niet bijgewerkt","errorCode":"http_503"/);
  const status = leesStatus(root);
  assert.deepEqual(validateRefreshStatus(status), []);
  const fout = status.sources.find((e) => e.sourceId === ID);
  assert.deepEqual([fout.fetchStatus, fout.errorCode, fout.retrievedAt, fout.itemCount], ["error", "http_503", RETRIEVED, 1]);
  assert.equal(sourceHealthOf(fout, Date.parse(later)), "stale", "een 503 is tijdelijk: een waarschuwing, geen fout");
  // Een straatas die iets anders doet dan tijdelijk falen: een blijvende fout.
  schrijfAsignEvenementen({ rootDir: root, dossiers, index: buildStreetIndex([]), auto: metSoort(dossiers), vandaag: "2026-10-11", generatedAt: later, log: () => {} });
  assert.equal(leesStatus(root).sources.find((e) => e.sourceId === ID).errorCode, "straatas_ontbreekt");
  assert.equal(fs.readFileSync(bronBestand(root), "utf8"), voor);
});

test("H1: twee dossiers zonder straat met dezelfde soort op dezelfde dag blijven twee agendapunten; zonder straat en wijk geen agendapunt (L1)", () => {
  const zonderStraat = (dossier, wijk) => feit(dossier, { beginStraat: "", kernStraten: [], wijk });
  const auto = { dossiers: Object.fromEntries(["ET2099100001", "ET2099100002", "ET2099100003"].map((d) => [d, fiche({ zekerheid: "waarschijnlijk", soort: "een studentenactiviteit", methode: "regels" })])) };
  const { items, tellers } = bouw({ feiten: [zonderStraat("ET2099100001", "Proefwijk"), zonderStraat("ET2099100002", "Proefwijk"), zonderStraat("ET2099100003", "")], auto });
  assert.deepEqual(items.map((i) => [i.externalId, i.title]), [
    ["ET2099100001", "Vermoedelijk een studentenactiviteit in Proefwijk"],
    ["ET2099100002", "Vermoedelijk een studentenactiviteit in Proefwijk"],
  ], "zelfde algemene titel, maar geen straat of naam: niet samenvoegen");
  assert.equal(tellers.samengevoegd, 0);
  assert.equal(tellers.nietInLijst, 1, "'... in district Antwerpen' zegt niets over een straat: alleen op de plekpagina");
});

test("H1/M3: een plotse krimp overschrijft het vorige bestand niet; na KRIMP_DAGEN dagen of met AGENDA_ALLOW_DROP wel", (t) => {
  const root = tijdelijk(t);
  statusBestand(root);
  const straten = Array.from({ length: 10 }, (_, i) => `Proefstraat ${String.fromCharCode(65 + i)}`.replace(" ", ""));
  const index = buildStreetIndex(straten.map((naam, i) => as(10 + i, naam, [[4.40 + i * 0.001, 51.2], [4.40 + i * 0.001, 51.201]])));
  const tien = straten.map((straat, i) => verrijkt(10 + i, straat));
  const schrijf = (dossiers, vandaag, env = {}) => schrijfAsignEvenementen({ rootDir: root, dossiers, index, auto: metSoort(dossiers), vandaag, generatedAt: `${vandaag}T05:20:00.000Z`, env, log: () => {} });
  assert.ok(schrijf(tien, VANDAAG));
  const voor = fs.readFileSync(bronBestand(root), "utf8");
  assert.equal(schrijf(tien.slice(0, 2), "2026-10-11"), null, "van 10 naar 2 komende agendapunten: tegenhouden");
  assert.equal(fs.readFileSync(bronBestand(root), "utf8"), voor);
  const regel = leesStatus(root).sources.find((e) => e.sourceId === ID);
  assert.deepEqual([regel.fetchStatus, regel.errorCode, regel.itemCount], ["error", "suspicious_drop", 10]);
  assert.ok(schrijf(tien.slice(0, 2), "2026-10-11", { AGENDA_ALLOW_DROP: ID }), "de eigenaar laat de daling toe");
  fs.writeFileSync(bronBestand(root), voor);
  const laat = `2026-10-${String(10 + KRIMP_DAGEN + 1).padStart(2, "0")}`;
  assert.ok(schrijf(tien.slice(0, 2), laat), "duurt de krimp langer dan KRIMP_DAGEN dagen, dan is ze echt");
  assert.equal(JSON.parse(fs.readFileSync(bronBestand(root), "utf8")).items.length, 2);
  assert.equal(leesStatus(root).sources.find((e) => e.sourceId === ID).fetchStatus, "ok");
});

// ---------- H2: een meerdaags besluit blijft meerdaags ----------

const festival = besluit({ code: "2099_CBS_00003", id: "1.2.3.4.7", naam: "Proeffestival", dagen: ["2026-10-23", "2026-10-24", "2026-10-25"] });
const festivalItem = {
  id: "ebesluit-ev-2099-cbs-00003-2026-10-23", externalId: "2099_CBS_00003", title: "Proeffestival", theme: "Activiteit", className: "activity",
  date: "2026-10-23", endDate: "2026-10-25", timeSlot: "Info", timeText: "", location: "Proefplein, 2000 Antwerpen", postcodes: ["2000"], info: "",
  kind: "activity", sourceUrl: "https://ebesluit.antwerpen.be/zittingen/1.2/agendapunten/1.2.3.4.7", retrievedAt: RETRIEVED, reviewRequired: false,
};

test("H2: een festival van drie dagen uit een besluit, gekoppeld aan zijn dossier, blijft in de lijst van 23 tot 25 oktober", () => {
  const f = feit("ET2099100010", { beginStraat: "Proefplein", kernStraten: ["Proefplein"], dagen: festival.dagen, fasen: [{ naam: "Evenement", start: "2026-10-23", eind: "2026-10-25" }] });
  const { items } = bouw({ feiten: [f], besluiten: [festival], besluitItems: [festivalItem] });
  assert.deepEqual(items.map((i) => [i.title, i.date, i.endDate, i.sameAs]), [["Proeffestival", "2026-10-23", "2026-10-25", [festivalItem.id]]]);
  const merged = mergeEvents({ [ID]: { scope: "district", items }, "district-ebesluit-evenementen": { scope: "district", items: [festivalItem] } }).items;
  assert.deepEqual(merged.map((i) => [i.title, i.date, i.endDate]), [["Proeffestival", "2026-10-23", "2026-10-25"]], "elke dag van het festival staat in de lijst en de .ics");
  assert.deepEqual(merged[0].sources.map((s) => s.sourceId), [ID, "district-ebesluit-evenementen"]);
});

test("H2: mergeEvents houdt de ruimste periode van wat het primaire item zelf koppelt, maar rekt een kalenderpunt niet op", () => {
  const dag = { id: "asign-ev-et2099100011-2026-10-23", externalId: "ET2099100011", title: "Proeffestival", theme: "Activiteit", className: "activity", date: "2026-10-23", endDate: null, timeSlot: "Info", timeText: "", location: "Proefplein", postcodes: ["2000"], info: "", kind: "activity", sourceUrl: "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/22", retrievedAt: RETRIEVED, reviewRequired: false, sameAs: [festivalItem.id] };
  const samen = mergeEvents({ [ID]: { scope: "district", items: [dag] }, "district-ebesluit-evenementen": { scope: "district", items: [festivalItem] } }).items;
  assert.deepEqual(samen.map((i) => [i.date, i.endDate]), [["2026-10-23", "2026-10-25"]]);
  // Een dossier van weken (één item per reeks) dat naar een opening in de kalender wijst: de opening blijft één dag.
  const opening = { ...festivalItem, id: "district-kal-proefopening-2026-10-10", externalId: "proefopening", title: "Opening Proefwinter", date: "2026-10-10", endDate: null, sourceUrl: "https://www.antwerpen.be/info/proef/kalender" };
  const reeks = { ...dag, id: "asign-ev-et2099100012-2026-10-10", externalId: "ET2099100012", title: "Proefwinter", date: "2026-10-10", endDate: "2026-10-30", sameAs: [opening.id] };
  const kal = mergeEvents({ [ID]: { scope: "district", items: [reeks] }, "district-kalender": { scope: "district", items: [opening] } }).items;
  assert.deepEqual(kal.map((i) => [i.title, i.date, i.endDate]), [["Opening Proefwinter", "2026-10-10", null]]);
});

// ---------- M1: een besluit over één straat noemt niet elke stoet die erdoor loopt ----------

test("M1: een buurtfeest uit het Districtsfonds krijgt zijn naam; een stoet die de straat kruist niet, en beide blijven een agendapunt", () => {
  const dag = "2026-10-24";
  const fasen = [{ naam: "Evenement", start: dag, eind: dag }];
  const fonds = besluit({ id: "1.2.3.4.8", code: "2099_DCAN_00004", soort: "districtsfonds", orgaan: "Districtscollege", naam: "Buurtfeest Feestgang", dagen: [dag], plaats: "Feestgang", straten: ["Feestgang"] });
  const stoet = feit("ET2099100020", { dagen: [dag], fasen, beginStraat: "Eerstelaan", kernStraten: ["Eerstelaan", "Tweedelaan"], langs: ["Eerstelaan", "Feestgang", "Proefweg", "Testdreef", "Tweedelaan"] });
  const feest = feit("ET2099100021", { dagen: [dag], fasen, beginStraat: "Feestgang", kernStraten: ["Feestgang"] });
  const { items } = bouw({ feiten: [stoet, feest], besluiten: [fonds] });
  const per = Object.fromEntries(items.map((i) => [i.externalId, i]));
  assert.equal(items.length, 2, "twee evenementen blijven twee agendapunten");
  assert.equal(per.ET2099100021.title, "Buurtfeest Feestgang");
  assert.equal(per.ET2099100020.title, "Evenement in de Eerstelaan — naam volgt", "de stoet krijgt de naam van het buurtfeest niet");
  assert.equal(koppelBesluiten([stoet], [fonds]).size, 0, "ook zonder het buurtfeestdossier niet");
  const tweede = feit("ET2099100022", { dagen: [dag], fasen, beginStraat: "Feestgang", kernStraten: ["Feestgang"] });
  assert.equal(koppelBesluiten([feest, tweede], [fonds]).size, 0, "twee dossiers met hun eigen plek in die straat: twijfel, geen naam");
  // Een evenementbesluit (College) mag wel via de route, als het enige dossier: een marathon start aan de kaai.
  const marathon = besluit({ naam: "Proefmarathon 2026", dagen: [dag], plaats: "Proefkaai", straten: ["Proefkaai"] });
  const parcours = feit("ET2099100023", { dagen: [dag], fasen, beginStraat: "Startbrug", kernStraten: ["Startbrug"], langs: ["Eerstelaan", "Proefkaai", "Startbrug"] });
  assert.equal(koppelBesluiten([parcours], [marathon]).get("ET2099100023")?.naam, "Proefmarathon 2026");
  assert.equal(koppelBesluiten([parcours, stoet], [besluit({ naam: "Proefmarathon 2026", dagen: [dag], plaats: "Proefweg", straten: ["Proefweg"] })]).size, 1, "alleen de stoet loopt door de Proefweg");
});

// ---------- M2: een vermoede soort is geen feit ----------

test("M2: een soort met de hand nagekeken, uit het dossier of vermoed: elk met een eerlijke zin", () => {
  const f = feit("ET2099100030", { langs: ["Proefstraat", "Voorbeeldlaan"] });
  const info = (velden) => bouw({ feiten: [{ ...f, ...velden.feit }], hand: velden.hand ? { dossiers: { ET2099100030: velden.hand } } : null, auto: velden.auto ? { dossiers: { ET2099100030: velden.auto } } : null }).items[0];
  const vermoed = info({ auto: fiche({ zekerheid: "waarschijnlijk", soort: "een studentenactiviteit", methode: "regels" }) });
  assert.equal(vermoed.title, "Vermoedelijk een studentenactiviteit in de Proefstraat");
  assert.match(vermoed.info, /Soort vermoed via .*; niet bevestigd\. De naam volgt/);
  const hand = info({ hand: fiche({ zekerheid: "zeker", soort: "een studentenactiviteit" }) });
  assert.equal(hand.title, "Studentenactiviteit in de Proefstraat");
  assert.match(hand.info, /Soort met de hand nagekeken bij een publieke bron; de naam volgt/);
  const speelstraat = info({ feit: { speelstraat: true } });
  assert.equal(speelstraat.title, "Speelstraat in de Proefstraat");
  assert.match(speelstraat.info, /De soort staat in het dossier; de naam volgt/);
});

// ---------- L2: een evenement van een ander district dat de grens raakt ----------

test("L2: een dossier dat het district alleen aan de rand raakt, staat niet in de districtslijst; een handfiche beslist zelf", () => {
  // Een verzonnen grens (een vierkant) en een route die er voor een tiende in ligt.
  const grens = { type: "Polygon", coordinates: [[[4.40, 51.19], [4.41, 51.19], [4.41, 51.21], [4.40, 51.21], [4.40, 51.19]]] };
  const vorm = (van, tot) => ({ lijnen: [[[van, 51.2], [tot, 51.2]]], vlakken: [], kern: [[van, 51.2]], start: [van, 51.2] });
  const rand = dossierFeiten({ dossier: "ET2099100050", status: GOED, binnenDistrict: true, vorm: vorm(4.409, 4.419), dagen: ["2026-10-18"] }, { grens });
  assert.ok(rand.aandeelInDistrict > 0 && rand.aandeelInDistrict < 0.2, `aandeel ${rand.aandeelInDistrict}`);
  const midden = dossierFeiten({ dossier: "ET2099100051", status: GOED, binnenDistrict: true, vorm: vorm(4.401, 4.409), dagen: ["2026-10-18"] }, { grens });
  assert.equal(midden.aandeelInDistrict, 1);
  const langs = ["Proefstraat", "Voorbeeldlaan"];
  const { items, tellers } = bouw({ feiten: [feit("ET2099100050", { langs, aandeelInDistrict: rand.aandeelInDistrict }), feit("ET2099100051", { langs, aandeelInDistrict: 1 })] });
  assert.deepEqual(items.map((i) => i.externalId), ["ET2099100051"]);
  assert.equal(tellers.aanDeRand, 1);
  // De handfiche (met de hand nagekeken) gaat voor op de meting, in beide richtingen.
  const hand = { dossiers: { ET2099100050: fiche({ zekerheid: "zeker", naam: "Proefloop Noord", binnenDistrict: true }), ET2099100051: fiche({ zekerheid: "zeker", naam: "Proefloop Buiten", binnenDistrict: false }) } };
  const metHand = bouw({ feiten: [feit("ET2099100050", { langs, aandeelInDistrict: 0.1 }), feit("ET2099100051", { langs, aandeelInDistrict: 1 })], hand });
  assert.deepEqual(metHand.items.map((i) => i.title), ["Proefloop Noord"]);
});

// ---------- L4: de plaats en het beginuur uit het besluit ----------

test("L4: een gekoppeld besluit zet zijn plaats vooraan en geeft het beginuur als de handfiche geen reeks heeft", () => {
  const marathon = besluit({ naam: "Proefmarathon 2026", plaats: "Proefkaai", straten: ["Proefkaai"], uren: { start: "09:00", einde: "17:00" } });
  const f = feit("ET2099100040", { beginStraat: "Startbrug", kernStraten: ["Startbrug"], langs: ["Ankerweg", "Proefkaai", "Startbrug", "Zuidlaan"] });
  const hand = { dossiers: { ET2099100040: fiche({ zekerheid: "zeker", naam: "Proefmarathon van de Stad", uren: "start om 9 uur, finish sluit om 18 uur" }) } };
  const [item] = bouw({ feiten: [f], hand, besluiten: [marathon] }).items;
  assert.equal(item.title, "Proefmarathon van de Stad");
  assert.equal(item.timeSlot, "09:00");
  assert.equal(item.timeText, "start om 9 uur, finish sluit om 18 uur");
  assert.equal(item.location, "Proefkaai, Startbrug, Ankerweg en 1 andere straten");
  assert.equal(item.straten[0], "Proefkaai");
});

// ---------- L5: de tekst verandert niet elke ochtend ----------

test("L5: de tekst noemt de dag van de laatste wijziging in A-Sign, niet de dag van de verversing", () => {
  const f = feit("ET2099100060", { langs: ["Proefstraat", "Voorbeeldlaan"], bijgewerkt: "2026-09-01" });
  const vandaag = bouw({ feiten: [f] }).items[0].info;
  const morgen = asignAgendapunten({ feiten: [f], vandaag: "2026-10-11", retrievedAt: "2026-10-11T05:20:00.000Z" }).items[0].info;
  assert.equal(morgen, vandaag);
  assert.match(vandaag, /Evenementendossier ET2099100060 van de stad \(A-Sign\), laatst gewijzigd op 1 september 2026: aanvraag goedgekeurd\.$/);
  assert.doesNotMatch(vandaag, /stand op/);
});

// ---------- L6: de straat in de titel ligt op de route ----------

test("L6: begint een parcours aan een kruispunt, dan heet het naar de straat van de route, niet naar de dwarsstraat", () => {
  const index = buildStreetIndex([
    as(1, "Proefstraat", [[4.4, 51.2], [4.406, 51.2]]),
    as(2, "Voorbeeldlaan", [[4.406, 51.2], [4.406, 51.204]]),
    as(3, "Kruisweg", [[4.3996, 51.199], [4.3996, 51.201]]),
  ]);
  const route = [[4.4, 51.2], [4.406, 51.2], [4.406, 51.204]];
  const dossier = {
    dossier: "ET2099100070", status: GOED, binnenDistrict: true, fasen: [{ naam: "Evenement", start: "2026-10-18", eind: "2026-10-18" }], dagen: ["2026-10-18"],
    innames: [{ type: "Parcours", geometry: { paths: [route] } }], beschrijvingen: [], beginStraat: "Kruisweg", eindStraat: "Voorbeeldlaan",
    kernStraten: ["Kruisweg", "Voorbeeldlaan"], wijk: "Proefwijk", postcodes: ["2000"], vorm: { start: route[0], eind: route.at(-1), kern: [route[0], route.at(-1)], index: null },
  };
  const f = dossierFeiten(dossier, { index });
  assert.deepEqual(f.langs, ["Proefstraat", "Voorbeeldlaan"]);
  assert.equal(f.beginStraat, "Proefstraat");
  assert.equal(bouw({ feiten: [f] }).items[0].title, "Evenement in de Proefstraat — naam volgt");
});

// ---------- M3: de bron is zichtbaar in refresh-status.json en sources:health ----------

test("M3: refresh-fetch houdt de regel van de afgeleide bron, en sources:health telt ze zoals elke bron", async (t) => {
  const root = tijdelijk(t);
  fs.writeFileSync(bronBestand(root), JSON.stringify(sourceDocument(ID, { retrievedAt: RETRIEVED, fetchStatus: "ok", items: [] })));
  const regel = { sourceId: ID, file: `sources/${ID}.json`, scope: "district", fetchStatus: "error", retrievedAt: RETRIEVED, maxAgeHours: 48, itemCount: 0, errorCode: "suspicious_drop", upcomingCount: 0, emptySince: VANDAAG, contentStatus: "ok" };
  statusBestand(root, [regel]);
  assert.deepEqual(validateRefreshStatus(leesStatus(root)), []);
  const status = await refreshAll({ rootDir: root, fetchers: [], clock: () => new Date("2026-10-11T05:00:00Z"), log: () => {} });
  const over = status.sources.find((e) => e.sourceId === ID);
  assert.deepEqual([over?.fetchStatus, over?.errorCode, over?.retrievedAt, over?.emptySince], ["error", "suspicious_drop", RETRIEVED, VANDAAG], "de regel blijft tot refresh:herkenning ze bijwerkt");
  const health = checkHealth({ rootDir: root, at: Date.parse("2026-10-11T06:00:00Z"), env: {} });
  assert.equal(health.exitCode, 1, "een blijvende fout van de afgeleide bron is een fout, en heet ook zo");
  assert.match(health.lines.join("\n"), new RegExp(`^${ID}\\terror\\terror\\titems=0.*errorCode=suspicious_drop`, "m"));
  assert.doesNotMatch(health.lines.join("\n"), /afgeleid na/, "geen tweede regel uit het bestand");
});

test("M3: elke melding van sources:health heeft haar eigen titel (verouderd is niet leeg)", (t) => {
  const root = tijdelijk(t);
  statusBestand(root, [{ sourceId: "district-kalender", file: "sources/district-kalender.json", scope: "district", fetchStatus: "ok", retrievedAt: RETRIEVED, maxAgeHours: 48, itemCount: 0, errorCode: null, upcomingCount: 0, emptySince: "2026-10-08", contentStatus: "leeg" }]);
  fs.writeFileSync(bronBestand(root), JSON.stringify(sourceDocument(ID, { retrievedAt: "2026-10-06T05:20:00.000Z", fetchStatus: "ok", items: [] })));
  const health = checkHealth({ rootDir: root, at: Date.parse("2026-10-10T06:00:00Z"), env: {} });
  assert.deepEqual(health.meldingen.map((m) => m.titel), ["Bron leeg", "Bron verouderd"]);
  assert.equal(health.exitCode, 0);
});

// ---------- L3: de feed draagt geen velden die de site niet leest ----------

test("L3: de straten en fasen blijven in het bronbestand, niet in de feed", () => {
  const item = {
    id: "asign-ev-et2099100080-2026-10-18", externalId: "ET2099100080", title: "Evenement in de Proefstraat — naam volgt", theme: "Activiteit", className: "activity",
    date: "2026-10-18", endDate: null, timeSlot: "Info", timeText: "", location: "Proefstraat en Voorbeeldlaan", postcodes: ["2000"], info: "Parcours door 2 straten.",
    kind: "activity", sourceUrl: "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/22", retrievedAt: RETRIEVED, reviewRequired: false, inDistrict: true,
    fasen: [{ naam: "Evenement", start: "2026-10-18", eind: "2026-10-18" }], straten: ["Proefstraat", "Voorbeeldlaan"],
  };
  const document = sourceDocument(ID, { retrievedAt: RETRIEVED, fetchStatus: "ok", items: [item] });
  assert.deepEqual(document.items[0].straten, ["Proefstraat", "Voorbeeldlaan"]);
  const { feed } = buildFeed({ status: null, documents: [document] }, []);
  assert.equal(feed.items.length, 1);
  assert.equal("straten" in feed.items[0], false);
  assert.equal("fasen" in feed.items[0], false);
});

// ---------- grens van het venster ----------

test("venster: een evenementdag op precies VOORUIT_DAGEN dagen telt nog mee, een dag later niet", () => {
  assert.equal(VOORUIT_DAGEN, 60);
  const langs = ["Proefstraat", "Voorbeeldlaan"];
  const dag = (n) => new Date(Date.parse(`${VANDAAG}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const op = (n) => feit(`ET20991001${n}`, { langs, dagen: [dag(n)], fasen: [{ naam: "Evenement", start: dag(n), eind: dag(n) }] });
  const { items, tellers } = bouw({ feiten: [op(60), op(61), op(0)] });
  assert.deepEqual(items.map((i) => i.date), [VANDAAG, dag(60)]);
  assert.equal(tellers.buitenVenster, 1);
});
