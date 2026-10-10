// Automatische parcoursherkenning (lib/parcours-herkenning.mjs en lib/parcours-herkenning-refresh.mjs).
// Grondwaarheid: de 38 met de hand nagekeken evenementendossiers van 9 en 10 oktober 2026
// (tests/fixtures/parcours-herkenning, vastgelegd uit A-Sign, de agendabronnen, GIPOD en de
// organisatorfeeds). Geen netwerk: de verversing krijgt een nagemaakte fetch.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  bibliotheekUit, bijwerkenPatronen, bouwHerkenning, compact, dossiersUitAsign, herkenDossier, kaartzin, metStraat, naamBewijs,
  routeZin, soortenIn, verrijk, zelfdeTitel,
} from "../lib/parcours-herkenning.mjs";
import { haalFeeds, herkenParcours, kandidatenUitFeed, kandidatenUitGipod, leesBody, parseIcs, parseJsonLd, parseSquarespace } from "../lib/parcours-herkenning-refresh.mjs";
import { locationKey } from "../site/neighborhood-core.js";
import { validateHerkenning, validatePatronen } from "../lib/evenement-herkenning-validatie.mjs";
import { HUISNUMMERS_TEST, evalueer, laadFixtures, VANDAAG } from "./helpers/parcours-herkenning-evaluatie.mjs";
import { evenementKaartje, evenementFeiten } from "../site/kaart-uitleg.js";
import { identiteitSamen } from "../site/place-core.js";
import { privacyFindings } from "../lib/source-feed.mjs";
import { main as herkenMain } from "../scripts/herken-parcours.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const F = laadFixtures(root);
const LOO = evalueer(root);

test("leave-one-out op de 38: nooit een verkeerde naam als 'zeker', en de dekking blijft", () => {
  const t = LOO.telling;
  assert.equal(t.totaal, 38);
  assert.equal(t["zeker-FOUT"] || 0, 0, "een verkeerde naam als 'zeker' is erger dan geen naam");
  assert.equal(t["waarsch-naam-fout"] || 0, 0, "ook als vermoeden geen verkeerde naam");
  assert.equal(t["waarsch-te-stellig"] || 0, 0, "een dossier dat met de hand onbekend bleef, wordt geen vermoeden");
  assert.ok((t["zeker-juist"] || 0) >= 2, `zeker juist: ${t["zeker-juist"]}`);
  assert.ok((t["zeker-juist"] || 0) + (t["waarsch-juist"] || 0) >= 23, JSON.stringify(t));
  assert.equal(t["onbekend-juist"], 9, "de 9 onbekende blijven onbekend");
  // De twee die vandaag automatisch 'zeker' horen te zijn: een bron die dag en plek noemt, dichtbij, en
  // het dossier zelf noemt de soort ("PARCOURS CRITERIUM") of de naam ("Ekerun").
  const zeker = Object.fromEntries(LOO.rijen.filter((r) => r.auto.zekerheid === "zeker").map((r) => [r.dossier, r.auto]));
  assert.deepEqual(Object.keys(zeker).sort(), ["ET2026003440", "ET2026004192"]);
  assert.equal(zeker.ET2026003440?.naam, "Linkeroever Criterium");
  assert.equal(zeker.ET2026003440.methode, "kalender");
  assert.match(zeker.ET2026004192?.naam || "", /EkeRun/);
  for (const r of Object.values(zeker)) assert.ok(r.bron.length >= 2 && r.bron.some((b) => !/geodata\.antwerpen\.be/.test(b)), "zeker steunt op een eigen publieke bron");
  // De doop van Fabiant: alleen een punt vlakbij in de agenda van de club, het dossier zegt zelf niets.
  // Een andere club kan daar die dag ook iets doen: een vermoeden met naam, geen 'zeker'.
  const fabiant = LOO.rijen.find((r) => r.dossier === "ET2026004447").auto;
  assert.equal(fabiant.zekerheid, "waarschijnlijk");
  assert.match(fabiant.naam, /Fabiant/);
  assert.equal(fabiant.methode, "organisator");
});

test("de kaartzin is er voor elk dossier, zonder huisnummer of gissing", () => {
  for (const r of LOO.rijen) {
    assert.ok(r.auto.kaartzin, r.dossier);
    assert.match(r.auto.kaartzin, /Stand in A-Sign op 10 oktober 2026: aanvraag (?:goedgekeurd|nog niet goedgekeurd)\.$/);
    assert.doesNotMatch(r.auto.kaartzin, HUISNUMMERS_TEST, r.dossier);
    assert.ok(r.auto.waar && r.auto.dagen.length, r.dossier);
    if (r.auto.zekerheid === "onbekend") assert.doesNotMatch(`${r.auto.waar} ${r.auto.reden}`, /mogelijk|waarschijnlijk|vermoedelijk/i);
  }
  const criterium = LOO.rijen.find((r) => r.dossier === "ET2026003440").auto;
  assert.match(criterium.waar, /^(?:Lus|Route) van ongeveer [\d,]+ km in Linkeroever \(district Antwerpen\), begin en einde aan de Beatrijslaan, op zaterdag 10 oktober\.$/);
});

test("patroon: volgend jaar op de route van de marathon heet het vanzelf weer TREK Antwerp Marathon", () => {
  // Een verzonnen dossier van 2027 met exact de lijnen van ET2026001217, een dag eerder in het jaar.
  const jaarLater = (ms) => ms + 364 * 86_400_000;
  const nep = F.asign.features.filter((f) => f.attributes.dossierNummer === "ET2026001217").map((f) => ({
    ...f, attributes: { ...f.attributes, dossierNummer: "ET2027009999", faseStartDatum: jaarLater(f.attributes.faseStartDatum), faseEindDatum: jaarLater(f.attributes.faseEindDatum), innameBeschrijving: "" },
  }));
  const d = verrijk(dossiersUitAsign(nep).get("ET2027009999"), { districten: F.districten });
  const bibliotheek = bibliotheekUit(bijwerkenPatronen(null, { dossiers: F.dossiers, hand: F.hand, vandaag: VANDAAG }));
  const r = herkenDossier(d, { bibliotheek, charter: F.charter, vandaag: "2027-10-01" });
  assert.equal(r.zekerheid, "waarschijnlijk", "een patroon alleen is nooit 'zeker'");
  assert.equal(r.methode, "patroon");
  assert.equal(r.naam, "TREK Antwerp Marathon");
  assert.match(r.reden, /Dezelfde route als TREK Antwerp Marathon op zondag 18 oktober 2026 \(dossier ET2026001217\)/);
  assert.ok(r.signalen.some((s) => s.startsWith("zelfde route als ET2026001217/2026")));
  // Dezelfde dag maar een andere route (het criterium): geen marathon.
  const ander = F.asign.features.filter((f) => f.attributes.dossierNummer === "ET2026003440").map((f) => ({ ...f, attributes: { ...f.attributes, dossierNummer: "ET2027009998", faseStartDatum: jaarLater(Date.UTC(2026, 9, 17, 22)), faseEindDatum: jaarLater(Date.UTC(2026, 9, 17, 22)), innameBeschrijving: "" } }));
  const d2 = verrijk(dossiersUitAsign(ander).get("ET2027009998"), { districten: F.districten });
  const r2 = herkenDossier(d2, { bibliotheek, charter: F.charter, vandaag: "2027-10-01" });
  assert.notEqual(r2.naam, "TREK Antwerp Marathon");
});

test("twijfel verlaagt: een tweede activiteit op dezelfde dag en plek maakt van 'zeker' hoogstens een vermoeden", () => {
  const hand = { ...F.hand, dossiers: Object.fromEntries(Object.entries(F.hand.dossiers).filter(([k]) => k !== "ET2026003440")) };
  const crit = F.kandidaten.find((k) => k.titel === "Linkeroever Criterium");
  const bouw = (kandidaten) => bouwHerkenning({ dossiers: F.dossiers.map((d) => ({ ...d })), hand, kandidaten, historiek: F.historiek, charter: F.charter, vandaag: VANDAAG, generatedAt: `${VANDAAG}T08:00:00.000Z` }).dossiers.ET2026003440;
  assert.equal(bouw(F.kandidaten).zekerheid, "zeker");
  // Een andere wielerwedstrijd op dezelfde plek en dag (een woord gemeen, maar een andere titel).
  const r = bouw([...F.kandidaten, { ...crit, titel: "Criterium voor nieuwelingen" }]);
  assert.notEqual(r.zekerheid, "zeker");
  assert.notEqual(r.naam, "Linkeroever Criterium");
  // Dezelfde activiteit uit twee bronnen telt wel als één kandidaat.
  assert.equal(bouw([...F.kandidaten, { ...crit, bronLabel: "nieuws van district Antwerpen" }]).zekerheid, "zeker");
});

test("naambewijs: een eigen naam of afkorting uit het dossier, geen gewoon woord", () => {
  assert.equal(naamBewijs("Ontdek de pracht van Muisbroek tijdens de EkeRun!", ["Ekerun 10 km"]), "ekerun");
  assert.equal(naamBewijs("Lopen en griezelen tijdens de Halloween Survival Run", ["Parkeerverbod HSR"]), "hsr");
  assert.equal(naamBewijs("De Jaak Schram Parkloop", ["opbouw JSP"]), "jsp");
  assert.equal(naamBewijs("Straatfeest waarbij de straat dicht gaat", ["straatfeest"]), "");
  assert.equal(naamBewijs("Schachtenkoning(in) verkiezing", ["schachtenkoning cantus"]), "");
  assert.equal(naamBewijs("Parkeerverbod in de straat", ["Parkeerverbod"]), "");
  assert.ok(zelfdeTitel("Campustrail Multiversum", "Campus Trailrun en Kidsrun"));
  assert.ok(!zelfdeTitel("Halloween", "Feest voor de Sint"));
});

test("soorten: alleen trefwoorden uit de vaste lijst", () => {
  assert.deepEqual(soortenIn(["Teambuimding (doop) zelf", "Stoet"]).slice(0, 1), ["student"]);
  assert.equal(soortenIn(["PARCOURS CRITERIUM"])[0], "wieler");
  assert.equal(soortenIn(["Nationale Sluitingsprijs komt door Berendrecht"])[0], "wieler");
  assert.equal(soortenIn(["Feest voor de Sint"])[0], "sint");
  assert.equal(soortenIn(["Sint Jacobskerk"]).length, 0);
  assert.equal(soortenIn(["trailer met podium"]).length, 0);
  assert.equal(soortenIn(["10K"])[0], "loop");
  assert.equal(metStraat("Theaterplein"), "het Theaterplein");
  assert.equal(metStraat("Belegstraat"), "de Belegstraat");
  assert.ok(!compact([[4.4, 51.2], [4.41, 51.2], [4.41, 51.2003], [4.4, 51.2003], [4.4, 51.2]]), "een gang van 20 m op 700 m is geen plein");
  assert.ok(compact([[4.4, 51.2], [4.4007, 51.2], [4.4007, 51.2004], [4.4, 51.2004], [4.4, 51.2]]));
});

test("feeds: iCal (met GEO en TZID), Squarespace en schema.org Event; geen punten buiten de stad", () => {
  const ics = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "DTSTART:20261020T163000Z", "DTEND:20261020T215900Z", "SUMMARY:Doopdag", "GEO:51.164725;4.405753", "LOCATION:Voorbeeldlaan\\, 2610 Antwerpen", "END:VEVENT",
    "BEGIN:VEVENT", "DTSTART;TZID=Europe/Brussels:20261013T200000", "DTEND;TZID=Europe/Brussels:20261013T230000", "SUMMARY:Cantus", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const [a, b] = parseIcs(ics);
  assert.deepEqual([a.titel, a.dag, a.tijd, a.punt], ["Doopdag", "2026-10-20", "18.30 tot 23.59 uur", [4.405753, 51.164725]]);
  assert.equal(a.locatie, "Voorbeeldlaan, 2610 Antwerpen");
  assert.deepEqual([b.dag, b.tijd, b.punt], ["2026-10-13", "20 tot 23 uur", null]);
  const sq = parseSquarespace({ upcoming: [{ title: "Activiteit", startDate: Date.UTC(2026, 9, 20, 16, 30), endDate: Date.UTC(2026, 9, 20, 21, 59), location: { addressLine1: "Voorbeeldlaan", markerLat: 40.72, markerLng: -74.0 } }] });
  assert.equal(sq[0].dag, "2026-10-20");
  const ld = parseJsonLd(`<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Event","name":"Wandeling","startDate":"2026-10-24T14:00","location":{"name":"Zaal","geo":{"latitude":51.2,"longitude":4.43}}}]}</script>`);
  assert.deepEqual([ld[0].titel, ld[0].dag, ld[0].punt], ["Wandeling", "2026-10-24", [4.43, 51.2]]);
});

test("GIPOD: titel na het adres, geen stad Antwerpen, geen markten, geen privéfeesten", () => {
  const feat = (id, Description, extra = {}) => ({ id: `INNAME.${id}`, geometry: { type: "Polygon", coordinates: [[[4.45, 51.18], [4.46, 51.18], [4.46, 51.19], [4.45, 51.18]]] }, properties: { Type: "Evenement", Status: "Concreet gepland", Owner: "Stad Mortsel", PublicDomainOccupancyTypes: "Andere", Start: "2026-10-11T06:00:00Z", End: "2026-10-11T18:00:00Z", Description, ...extra } });
  const k = kandidatenUitGipod({ features: [
    feat("1-1", "2640 Mortsel, Voorbeeldstraat 2 : Campustrail"),
    feat("2-1", "Markt", { Owner: "Stad Antwerpen - Stadsbeheer" }),
    feat("3-1", "2640 Mortsel, Voorbeeldstraat : Wekelijkse markt", { PublicDomainOccupancyTypes: "Markt" }),
    feat("4-1", "2640 Mortsel, Voorbeeldstraat : Foodtruck voor verjaardag"),
    feat("5-1", "• Parkeerverbod in de voorbeeldstraat vanaf de kruising"),
  ] });
  assert.deepEqual(k.map((x) => x.titel), ["Campustrail"]);
  assert.equal(k[0].link, "https://geo.api.vlaanderen.be/GIPOD/ogc/features/v1/collections/INNAME/items/INNAME.1-1");
  assert.equal(k[0].bron, "gipod");
});

test("validatie: 'zeker' alleen met een bron die dag en plek noemt; de echte uitvoer is geldig en publiek", () => {
  const auto = LOO.rijen.find((r) => r.dossier === "ET2026003440").auto;
  const doc = { schemaVersion: 1, generatedAt: `${VANDAAG}T08:00:00.000Z`, bijgewerkt: VANDAAG, uitleg: "x", samenvatting: { dossiers: 1, metHandfiche: 0, automatisch: 1, zeker: 1, waarschijnlijk: 0, alleenKaartzin: 0 }, dossiers: { ET2026003440: auto } };
  assert.deepEqual(validateHerkenning(doc), []);
  assert.deepEqual(privacyFindings(doc), []);
  assert.match(validateHerkenning({ ...doc, dossiers: { ET2026003440: { ...auto, methode: "patroon" } } }).join(" "), /zeker zonder bron die dag en plek noemt/);
  assert.match(validateHerkenning({ ...doc, dossiers: { ET2026003440: { ...auto, bron: [auto.bron.at(-1)] } } }).join(" "), /zeker zonder eigen bron/);
  assert.match(validateHerkenning({ ...doc, dossiers: { ET2026003440: { ...auto, waar: "Aan de Beatrijslaan 32." } } }).join(" "), /huisnummer/);
  assert.match(validateHerkenning({ ...doc, dossiers: { ET2026003440: { ...auto, geheim: 1 } } }).join(" "), /onverwachte sleutel geheim/);
  const pat = bijwerkenPatronen(null, { dossiers: F.dossiers, hand: F.hand, vandaag: VANDAAG });
  assert.deepEqual(validatePatronen(pat), []);
  assert.ok(pat.patronen.ET2026001217.naam === "TREK Antwerp Marathon" && pat.patronen.ET2026001217.vorm.lijnen.length);
  // Vrije tekst uit A-Sign ("maurits", een losse naam) komt nooit in een fiche.
  assert.doesNotMatch(JSON.stringify(LOO.rijen.map((r) => r.auto)), /maurits|Tess\b/i);
});

test("site: een handfiche wint altijd, en een automatische fiche zegt dat ze niet nagekeken is", () => {
  const hand = { dossiers: { ET2026003440: { zekerheid: "zeker", naam: "Met de hand" } } };
  const auto = { dossiers: { ET2026003440: { zekerheid: "zeker", naam: "Automatisch" }, ET2026000001: { zekerheid: "waarschijnlijk" } } };
  const samen = identiteitSamen(hand, auto);
  assert.equal(samen.dossiers.ET2026003440.naam, "Met de hand");
  assert.equal(samen.dossiers.ET2026000001.zekerheid, "waarschijnlijk");
  assert.equal(identiteitSamen(hand, null), hand);
  const rij = { kind: "iod", reference: "ET2026003440", dossierType: "ETL", phase: "Evenement", innameType: "Parcours", start: "2026-10-10", end: "2026-10-10", streets: [{ name: "Beatrijslaan" }], status: "aanvraag_goedgekeurd" };
  const id = LOO.rijen.find((r) => r.dossier === "ET2026003440").auto;
  const k = evenementKaartje(evenementFeiten([rij]), { vandaag: VANDAAG, identiteit: id });
  assert.equal(k.titel, "Linkeroever Criterium");
  assert.match(k.voetnoot, /De naam is automatisch gevonden in een agenda met dezelfde dag en plek \(antwerpen\.be\); niet met de hand nagekeken\.$/);
  const regels = LOO.rijen.find((r) => r.dossier === "ET2026004615").auto;
  const k2 = evenementKaartje(evenementFeiten([{ ...rij, reference: "ET2026004615" }]), { vandaag: VANDAAG, identiteit: regels });
  assert.equal(k2.titel, "Vermoedelijk een schoolactiviteit");
  assert.match(k2.voetnoot, /automatisch afgeleid uit de omschrijving in het dossier/);
});

// Een nagemaakte A-Sign: id's en features uit de vaste testdata (een paar dossiers, of alle met
// ids: null). historiek: "netwerk" (faalt) of een HTTP-status; asign: true, false (faalt) of "leeg"
// (objectIds null). feeds: { begin van de url: inhoud of functie }. verzoeken: elk verzoek met headers.
function nepFetch({ asign = true, ids = ["ET2026003440", "ET2026004192", "ET2026004615"], historiek = "netwerk", feeds = {}, verzoeken = [] } = {}) {
  const features = F.asign.features.filter((f) => !ids || ids.includes(f.attributes.dossierNummer)).map((f, i) => ({ ...f, attributes: { ...f.attributes, OBJECTID: i + 1, last_edited_date: Date.UTC(2026, 8, 1) } }));
  const laag = (url) => (String(url).includes("/MapServer/23/") ? "paths" : "rings");
  const antwoord = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });
  return async (url, init = {}) => {
    const u = String(url);
    verzoeken.push({ url: u, headers: init.headers || {} });
    for (const [begin, inhoud] of Object.entries(feeds)) if (u.startsWith(begin)) return typeof inhoud === "function" ? inhoud() : { ok: true, status: 200, text: async () => (typeof inhoud === "string" ? inhoud : JSON.stringify(inhoud)) };
    const isAsign = u.includes("/P_ASign/ASign/MapServer/");
    const isHistoriek = isAsign && /faseStartDatum >= DATE '20(?:23|24|25)/.test(decodeURIComponent(u).replace(/\+/g, " "));
    if (isHistoriek && historiek !== "netwerk") return { ok: false, status: historiek, json: async () => ({}), text: async () => "" };
    if (!asign || !isAsign || isHistoriek) throw Object.assign(new Error("geen netwerk"), { code: "network_error" });
    const mine = features.filter((f) => (laag(u) === "paths" ? f.geometry?.paths : f.geometry?.rings));
    if (u.includes("returnIdsOnly=true")) return antwoord({ objectIds: asign === "leeg" ? null : mine.map((f) => f.attributes.OBJECTID) });
    const gevraagd = new Set((new URL(u).searchParams.get("objectIds") || "").split(",").map(Number));
    return antwoord({ features: mine.filter((f) => gevraagd.has(f.attributes.OBJECTID)) });
  };
}
// Een vaste districtskalender met het criterium van 10-10 en de geocode van zijn plek: de toets hangt
// niet af van de echte site/sources (die verversen elke dag, en het criterium valt er ooit uit).
const CRIT = F.kandidaten.find((k) => k.titel === "Linkeroever Criterium");
function vasteKalender(dir) {
  const item = { id: "linkeroever-criterium", title: CRIT.titel, date: CRIT.dag, endDate: CRIT.eind, timeText: CRIT.tijd, location: CRIT.locatie, infoUrl: CRIT.link };
  fs.writeFileSync(path.join(dir, "site", "sources", "district-kalender.json"), JSON.stringify({ items: [item] }));
  fs.writeFileSync(path.join(dir, "site", "geo", "locaties.json"), JSON.stringify({ entries: { [locationKey(CRIT.locatie)]: { point: CRIT.punt, precision: "adres" } } }));
}
function tijdelijkeRoot({ zonderHand = [], feeds = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parcours-herkenning-"));
  fs.mkdirSync(path.join(dir, "site", "sources"), { recursive: true });
  fs.mkdirSync(path.join(dir, "site", "geo"), { recursive: true });
  fs.mkdirSync(path.join(dir, "lib"), { recursive: true });
  for (const f of ["studentencharter.json", "districten-antwerpen.geojson", "district-antwerpen-grens.geojson", "organisator-feeds.json"]) fs.copyFileSync(path.join(root, "lib", f), path.join(dir, "lib", f));
  if (feeds) fs.writeFileSync(path.join(dir, "lib", "organisator-feeds.json"), JSON.stringify({ feeds }));
  const hand = JSON.parse(fs.readFileSync(path.join(root, "tests", "fixtures", "parcours-herkenning", "hand.json"), "utf8"));
  for (const id of zonderHand) delete hand.dossiers[id];
  fs.writeFileSync(path.join(dir, "site", "sources", "evenement-identiteit.json"), JSON.stringify(hand));
  vasteKalender(dir);
  return dir;
}
const leesUit = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, "site", "sources", f), "utf8"));
const klok = () => new Date(`${VANDAAG}T08:00:00Z`);

test("een falende bron breekt de verversing niet: zonder straatas, GIPOD, feeds en historiek komt er toch een fiche met kaartzin", async () => {
  const dir = tijdelijkeRoot({ zonderHand: ["ET2026003440", "ET2026004615"] });
  const logs = [];
  const doc = await herkenParcours({ rootDir: dir, fetch: nepFetch(), clock: () => new Date(`${VANDAAG}T08:00:00Z`), log: (l) => logs.push(l), historiekBudgetMs: 2_000 });
  assert.ok(doc, logs.join("\n"));
  assert.deepEqual(validateHerkenning(doc), []);
  assert.deepEqual(Object.keys(doc.dossiers).sort(), ["ET2026003440", "ET2026004615"]);
  assert.equal(doc.dossiers.ET2026003440.zekerheid, "zeker", "de districtskalender (al opgehaald) volstaat voor het criterium");
  assert.equal(doc.dossiers.ET2026004615.soort, "een schoolactiviteit");
  for (const r of Object.values(doc.dossiers)) assert.match(r.kaartzin, /Stand in A-Sign/);
  assert.ok(doc.samenvatting.bronFouten.some((f) => /^gipod: /.test(f)));
  assert.ok(doc.samenvatting.bronFouten.some((f) => /^feed /.test(f)));
  const opgeslagen = fs.readFileSync(path.join(dir, "site", "sources", "evenement-identiteit-auto.json"), "utf8");
  assert.deepEqual(JSON.parse(opgeslagen).dossiers, doc.dossiers);
  assert.deepEqual(validatePatronen(JSON.parse(fs.readFileSync(path.join(dir, "site", "sources", "evenement-patronen.json"), "utf8"))), []);
  // Zonder A-Sign: geen fout naar buiten, en de vorige bestanden blijven staan.
  const out = await herkenMain({ rootDir: dir, fetch: nepFetch({ asign: false }), log: (l) => logs.push(l), budgetMs: 5_000 });
  assert.equal(out, null);
  assert.equal(fs.readFileSync(path.join(dir, "site", "sources", "evenement-identiteit-auto.json"), "utf8"), opgeslagen);
  assert.match(logs.at(-1), /"parcoursHerkenning":"niet bijgewerkt"/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("routezin: vorm, lengte, straten met lidwoord, district en datum", () => {
  const d = F.dossiers.find((x) => x.dossier === "ET2026004615");
  assert.match(routeZin(d, { vandaag: VANDAAG }), /^Lus van ongeveer 1,[01] km in Brederode \(district Antwerpen\), van de Belegstraat naar de Lange Batterijstraat, op vrijdag 20 november\.$/);
  assert.match(kaartzin(d, { vandaag: VANDAAG }), /Stand in A-Sign op 10 oktober 2026: aanvraag goedgekeurd\.$/);
});

// ---------- robuustheid van de verversing (nakijkronde op #144) ----------

const ics = (...events) => ["BEGIN:VCALENDAR", ...events.flatMap((e) => ["BEGIN:VEVENT", ...e, "END:VEVENT"]), "END:VCALENDAR"].join("\r\n");

test("privacy: een titel met een @ uit een agenda komt nooit in een fiche of patroon (de verversing blijft groen)", async () => {
  const club = { id: "club", organisatie: "Voorbeeldkring (studentenvereniging)", soort: "ics", url: "https://voorbeeldkring.example/agenda.ics", pagina: "https://voorbeeldkring.example/agenda" };
  const dir = tijdelijkeRoot({ zonderHand: ["ET2026004447"], feeds: [club] });
  const feed = ics(["DTSTART:20261020T163000Z", "DTEND:20261020T215900Z", "SUMMARY:D%p @ Ask-Veldje", "GEO:51.1651;4.40602"]);
  const logs = [];
  const doc = await herkenParcours({ rootDir: dir, fetch: nepFetch({ ids: ["ET2026004447"], feeds: { [club.url]: feed } }), clock: klok, log: (l) => logs.push(l), historiekBudgetMs: 1_000 });
  assert.ok(doc, logs.join("\n"));
  assert.equal(doc.dossiers.ET2026004447.naam, "");
  assert.equal(doc.dossiers.ET2026004447.zekerheid, "onbekend");
  assert.match(doc.dossiers.ET2026004447.kaartzin, /Stand in A-Sign/);
  assert.deepEqual(privacyFindings(leesUit(dir, "evenement-identiteit-auto.json")), []);
  assert.deepEqual(privacyFindings(leesUit(dir, "evenement-patronen.json")), []);
  assert.ok(doc.samenvatting.bronFouten.some((f) => /^fiche ET2026004447: privacy at_sign/.test(f)), JSON.stringify(doc.samenvatting.bronFouten));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("A-Sign geeft plots niets: de vorige fiches en de cache blijven staan; duurt het langer dan drie dagen, dan is het echt", async () => {
  const dir = tijdelijkeRoot();
  const eerst = await herkenParcours({ rootDir: dir, fetch: nepFetch({ ids: null }), clock: klok, log: () => {}, historiekBudgetMs: 1_000 });
  assert.ok(eerst && eerst.samenvatting.dossiers >= 100, JSON.stringify(eerst?.samenvatting));
  const auto = fs.readFileSync(path.join(dir, "site", "sources", "evenement-identiteit-auto.json"), "utf8");
  const pat = fs.readFileSync(path.join(dir, "site", "sources", "evenement-patronen.json"), "utf8");
  const logs = [];
  assert.equal(await herkenParcours({ rootDir: dir, fetch: nepFetch({ ids: null, asign: "leeg" }), clock: klok, log: (l) => logs.push(l) }), null);
  assert.match(logs.at(-1), /"errorCode":"asign_krimp"/);
  assert.equal(fs.readFileSync(path.join(dir, "site", "sources", "evenement-identiteit-auto.json"), "utf8"), auto);
  assert.equal(fs.readFileSync(path.join(dir, "site", "sources", "evenement-patronen.json"), "utf8"), pat);
  // Vier dagen later nog altijd leeg: dan schrijft de verversing wel (de stand is dan echt zo).
  const later = await herkenParcours({ rootDir: dir, fetch: nepFetch({ ids: null, asign: "leeg" }), clock: () => new Date("2026-10-14T08:00:00Z"), log: () => {} });
  assert.ok(later);
  assert.equal(later.samenvatting.dossiers, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("een haperende A-Sign krijgt rust: na een 503 of vijf fouten op rij vraagt de verversing geen historiek meer", async () => {
  const dir = tijdelijkeRoot();
  const isHist = (v) => /faseStartDatum >= DATE '20(?:23|24|25)/.test(decodeURIComponent(v.url).replace(/\+/g, " "));
  for (const historiek of [503, "netwerk"]) {
    const verzoeken = [];
    const doc = await herkenParcours({ rootDir: dir, fetch: nepFetch({ ids: null, historiek, verzoeken }), clock: klok, log: () => {}, historiekBudgetMs: 5_000 });
    assert.ok(doc);
    const n = verzoeken.filter(isHist).length;
    assert.ok(n <= (historiek === 503 ? 4 : 8), `${historiek}: ${n} historiekverzoeken`);
    assert.ok(doc.samenvatting.bronFouten.some((f) => /^historiek: \d+ dossiers volgende keer \(gestopt: /.test(f)), JSON.stringify(doc.samenvatting.bronFouten));
    fs.rmSync(path.join(dir, "site", "sources", "evenement-identiteit-auto.json"));
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test("een feed die de body niet afmaakt of te groot is, houdt de verversing niet op", async () => {
  const hangt = () => new Response(new ReadableStream({ start() {} }), { headers: { "content-type": "text/calendar" } });
  await assert.rejects(leesBody(hangt(), { timeoutMs: 50 }), (e) => e.code === "timeout");
  const feeds = [
    { id: "traag", organisatie: "Voorbeeldkring", soort: "ics", url: "https://traag.example/a.ics", pagina: "https://traag.example/" },
    { id: "groot", organisatie: "Voorbeeldkring", soort: "ics", url: "https://groot.example/a.ics", pagina: "https://groot.example/" },
  ];
  const fetchImpl = async (url) => (String(url).startsWith("https://traag") ? hangt() : new Response(`BEGIN:VCALENDAR\r\n${"x".repeat(6 * 1024 * 1024)}`));
  const uit = await Promise.race([haalFeeds(fetchImpl, feeds, { vandaag: VANDAAG, timeoutMs: 100 }), new Promise((r) => setTimeout(() => r("hangt"), 3_000))]);
  assert.notEqual(uit, "hangt");
  assert.deepEqual(uit.fouten.sort(), ["feed groot: too_large", "feed traag: timeout"]);
  // Een agenda in Latin-1 blijft leesbaar.
  const latin = new Response(Buffer.from(ics(["DTSTART:20261020T180000Z", "SUMMARY:Café Doop"]), "latin1"), { headers: { "content-type": "text/calendar; charset=ISO-8859-1" } });
  assert.equal(parseIcs(await leesBody(latin))[0].titel, "Café Doop");
});

test("iCal: een afspraak voor een hele dag (VALUE=DATE, DTEND exclusief) duurt één dag", () => {
  const [a] = parseIcs(ics(["DTSTART;VALUE=DATE:20261013", "DTEND;VALUE=DATE:20261014", "SUMMARY:Doopdag"]));
  assert.deepEqual([a.dag, a.eind], ["2026-10-13", "2026-10-13"]);
  const [b] = parseIcs(ics(["DTSTART;VALUE=DATE:20261013", "DTEND;VALUE=DATE:20261015", "SUMMARY:Doopweekend"]));
  assert.equal(b.eind, "2026-10-14");
});

test("privéfeesten tellen ook in de agenda's van organisaties niet (pensioen, afscheid), een familiedag wel", () => {
  const feed = { id: "x", organisatie: "Voorbeeldkring", soort: "ics", pagina: "https://voorbeeldkring.example/" };
  const inhoud = ics(["DTSTART:20261020T180000Z", "SUMMARY:Pensioenfeest"], ["DTSTART:20261020T180000Z", "SUMMARY:Afscheidsreceptie"], ["DTSTART:20261021T180000Z", "SUMMARY:Familiedag"], ["DTSTART:20261021T180000Z", "SUMMARY:Cantus"]);
  assert.deepEqual(kandidatenUitFeed(feed, inhoud, { vandaag: VANDAAG }).map((k) => k.titel), ["Familiedag", "Cantus"]);
  const feat = { id: "INNAME.9-1", geometry: null, properties: { Type: "Evenement", Status: "Concreet gepland", Owner: "Gemeente Voorbeeld", PublicDomainOccupancyTypes: "Andere", Start: "2026-10-11T06:00:00Z", End: "2026-10-11T18:00:00Z", Description: "2640 Mortsel, Voorbeeldstraat : Pensioenfeest" } };
  assert.deepEqual(kandidatenUitGipod({ features: [feat] }), []);
});

test("een mislukte historiekvraag voor een gewijzigd dossier houdt het oude antwoord: geen flapperende fiche", async () => {
  const id = "ET2026004667";
  const dir = tijdelijkeRoot({ zonderHand: [id] });
  const items = F.historiek[id];
  assert.ok(items?.length);
  fs.writeFileSync(path.join(dir, "site", "sources", "evenement-patronen.json"), JSON.stringify({ schemaVersion: 1, bijgewerkt: "2026-10-09", uitleg: "x", patronen: {}, cache: { historiek: { [id]: { sleutel: "vorige sleutel", items } }, straten: {} } }));
  const doc = await herkenParcours({ rootDir: dir, fetch: nepFetch({ ids: [id] }), clock: klok, log: () => {}, historiekBudgetMs: 1_000 });
  assert.equal(doc.dossiers[id].soort, LOO.rijen.find((r) => r.dossier === id).auto.soort);
  const cache = leesUit(dir, "evenement-patronen.json").cache.historiek[id];
  assert.equal(cache.sleutel, "vorige sleutel", "de volgende verversing vraagt het opnieuw");
  assert.deepEqual(cache.items, items);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("feeds: een kapotte feed is een melding, een voorbije pagina over één evenement wordt niet meer gevraagd; de straatas krijgt een User-Agent", async () => {
  const dir = tijdelijkeRoot({ feeds: [
    { id: "kapot", organisatie: "Voorbeeldkring", soort: "ics", url: "https://kapot.example/a.ics", pagina: "https://kapot.example/" },
    { id: "voorbij", organisatie: "Voorbeeldzaal", soort: "jsonld", url: "https://voorbij.example/event", pagina: "https://voorbij.example/event", tot: "2026-10-01" },
  ] });
  const verzoeken = [];
  const doc = await herkenParcours({ rootDir: dir, fetch: nepFetch({ feeds: { "https://kapot.example": "<html>verhuisd</html>" }, verzoeken }), clock: klok, log: () => {}, historiekBudgetMs: 1_000 });
  assert.ok(doc.samenvatting.bronFouten.includes("feed kapot: geen_ical"), JSON.stringify(doc.samenvatting.bronFouten));
  assert.ok(!verzoeken.some((v) => v.url.startsWith("https://voorbij.example")));
  const straat = verzoeken.filter((v) => v.url.includes("/MapServer/905/"));
  assert.ok(straat.length);
  for (const v of straat) assert.match(v.headers["user-agent"] || "", /publieke-agenda-antwerpen/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("één slecht oud patroon bevriest de verversing niet: het valt weg, de rest blijft", async () => {
  const dir = tijdelijkeRoot();
  const vorige = bijwerkenPatronen(null, { dossiers: F.dossiers, hand: F.hand, vandaag: VANDAAG });
  vorige.patronen.ET2025000001 = { ...vorige.patronen.ET2026001217, link: `https://voorbeeld.example/${"x".repeat(400)}` };
  fs.writeFileSync(path.join(dir, "site", "sources", "evenement-patronen.json"), JSON.stringify(vorige));
  const doc = await herkenParcours({ rootDir: dir, fetch: nepFetch(), clock: klok, log: () => {}, historiekBudgetMs: 1_000 });
  assert.ok(doc);
  const pat = leesUit(dir, "evenement-patronen.json");
  assert.equal(pat.patronen.ET2025000001, undefined);
  assert.ok(pat.patronen.ET2026001217);
  assert.deepEqual(validatePatronen(pat), []);
  assert.ok(doc.samenvatting.bronFouten.some((f) => /^patroon ET2025000001: /.test(f)));
  fs.rmSync(dir, { recursive: true, force: true });
});
