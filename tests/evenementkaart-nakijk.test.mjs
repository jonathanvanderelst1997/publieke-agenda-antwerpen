// Nakijkpunten bij de evenementkaart (PR "Evenementkaart duidelijk"): de kaart blijft zichtbaar tijdens
// opbouw en afbraak, geen statuszinnen of gissingen in de nagekeken identiteit, een schets van het hele
// parcours, "onbekend" blijft onbekend, de woorden van de bron, een koppeling blijft een vermoeden,
// geen herhalingen en geen gissing in "Jouw straat". De innames zijn verzonnen; de dossiernummers en
// de identiteit zijn de echte publieke gegevens.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Namespace-imports en een identiteit die mag ontbreken: zo faalt op een oudere versie elke toets
// apart, in plaats van het hele bestand bij het laden.
import * as ku from "../site/kaart-uitleg.js";
import * as pc from "../site/place-core.js";
const { evenementFeiten, evenementKaartje } = ku;
const jouwStraat = (...a) => ku.jouwStraat(...a), routeSchets = (...a) => ku.routeSchets(...a);
const evenementEntry = (...a) => pc.evenementEntry(...a);
const { overlaps, groupForList, layoutWeekBars, periodRange } = pc;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lees = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");
const IDENTITEIT = (() => { try { return JSON.parse(lees("site", "sources", "evenement-identiteit.json")); } catch { return { dossiers: {} }; } })();
const VANDAAG = "2026-10-09";
const opties = { vandaag: VANDAAG, identiteit: IDENTITEIT, wijkVan: () => "" };
const kern = (k) => Object.fromEntries(k.kern);

let n = 0;
const rij = (dossier, phase, type, start, end, straten, extra = {}) => ({
  id: `iod:${dossier}|${phase}|${(n += 1)}`, kind: "iod", title: type, innameType: type, reference: dossier, dossierType: "ETL",
  phase, hindrance: "True", description: "", start, end: end || start, status: "aanvraag_goedgekeurd",
  streets: straten.map((name, i) => ({ id: `${n}${i}`, name, postcode: "2050" })), sourceUrl: "https://geodata.antwerpen.be/x", ...extra,
});
// Linkeroever Criterium zoals A-Sign het publiceert: in de Abraham Verhoevenlaan een parkeerverbod
// tijdens de opbouw (9-10/10), de koers (10/10) en de afbraak (10-11/10).
const criterium = [
  rij("ET2026003440", "Opbouw", "Parkeerverbod in Straat", "2026-10-09", "2026-10-10", ["Abraham Verhoevenlaan"]),
  rij("ET2026003440", "Evenement", "Parcours", "2026-10-10", "2026-10-10", ["Beatrijslaan", "Abraham Verhoevenlaan"]),
  rij("ET2026003440", "Evenement", "Parkeerverbod in Straat", "2026-10-10", "2026-10-10", ["Abraham Verhoevenlaan"]),
  rij("ET2026003440", "Afbraak", "Parkeerverbod in Straat", "2026-10-10", "2026-10-11", ["Abraham Verhoevenlaan"]),
];

test("1. tijdens de afbraak blijft de kaart staan, en opbouw en afbraak heten zo", () => {
  const e = evenementEntry(criterium, { ...opties, straat: "Abraham Verhoevenlaan" });
  // De titel en de plaats in de lijst blijven de koersdag; filter en overlap volgen de innameperiode.
  assert.equal(e.start, "2026-10-10");
  assert.equal(e.end, "");
  assert.equal(overlaps(e, "2026-10-11", "2026-10-11"), true);
  assert.equal(overlaps(e, "2026-10-09", "2026-10-09"), true);
  assert.equal(overlaps(e, "2026-10-12", "2026-10-12"), false);
  // Op 11/10 (afbraak) en 9/10 (opbouw) staat de kaart bij "nu bezig", niet "niets gevonden" of "gepland".
  for (const today of ["2026-10-11", "2026-10-09"]) {
    const { running, days, later } = groupForList([e], { ...periodRange("alles", today), today });
    assert.deepEqual([running.length, days.length, later.length], [1, 0, 0], today);
  }
  // Vóór de opbouw: op de dag van de koers.
  const vooraf = groupForList([e], { ...periodRange("week", "2026-10-05"), today: "2026-10-05" });
  assert.deepEqual(vooraf.days.map(([d]) => d), ["2026-10-10"]);
  // De maandbalk loopt van opbouw tot afbraak, ook in een week die alleen de afbraak raakt.
  const week = layoutWeekBars([{ ...e, start: "2026-10-11", innameStart: "2026-10-09", innameEind: "2026-10-13" }], "2026-10-12");
  assert.equal(week.bars.length, 1);
  assert.equal(week.bars[0].span, 2);
  // De badge in de lijst: "Opbouw bezig" / "Afbraak bezig" (place-view.js).
  const view = lees("site", "place-view.js");
  assert.match(view, /opbouw: \["Opbouw bezig", "now"\], afbraak: \["Afbraak bezig", "now"\]/);
  assert.match(view, /evenementFase\(entry, today\)/);
  // Jouw straat zegt wanneer het parkeerverbod er geldt.
  assert.equal(kern(e.uitleg)["Jouw straat"], "Jouw straat krijgt een parkeerverbod van vrijdag 9 oktober tot zondag 11 oktober en ligt op of naast het parcours.");
});

test("1b. de innameperiode komt van de innames op de gekozen plek", () => {
  const marathon = [
    rij("ET2026001217", "Opbouw", "Inname", "2026-10-12", "2026-10-17", ["Kattendijkdok-Westkaai"]),
    rij("ET2026001217", "Evenement", "Parcours", "2026-10-18", "2026-10-18", ["Van Ertbornstraat", "Meir"]),
  ];
  // Van Ertbornstraat: alleen het parcours op 18/10. De opbouw aan het Eilandje maakt hier niets "bezig".
  const hier = evenementEntry(marathon.slice(1), { ...opties, alle: marathon, straat: "Van Ertbornstraat" });
  assert.deepEqual([hier.innameStart, hier.innameEind], ["2026-10-18", "2026-10-18"]);
  assert.equal(groupForList([hier], { ...periodRange("alles", "2026-10-13"), today: "2026-10-13" }).running.length, 0);
});

test("2. geen statuszinnen in het identiteitsbestand: de status komt live uit A-Sign", async () => {
  const { validateEvenementIdentiteit } = await import("../lib/evenement-identiteit-validatie.mjs");
  assert.doesNotMatch(lees("site", "sources", "evenement-identiteit.json"), /toegestaan|weiger/i);
  assert.deepEqual(validateEvenementIdentiteit(IDENTITEIT), []);
  const fout = structuredClone(IDENTITEIT);
  fout.dossiers.ET2026005710.watMerkJe = "Een groep te voet. De aanvraag is nog niet toegestaan.";
  fout.dossiers.ET2026005653.reden = "De stad is de aanvraag aan het weigeren.";
  fout.dossiers.ET2026005653.watMerkJe = "Waarschijnlijk niets: de aanvraag wordt geweigerd.";
  const errors = validateEvenementIdentiteit(fout);
  assert.ok(errors.includes("dossiers.ET2026005710.watMerkJe bevat de status van de aanvraag"));
  assert.ok(errors.includes("dossiers.ET2026005653.reden bevat de status van de aanvraag"));
  assert.ok(errors.includes("dossiers.ET2026005653.watMerkJe bevat de status van de aanvraag"));
  // Een regel voor fietsers is geen status van de aanvraag.
  const fietsers = structuredClone(IDENTITEIT);
  fietsers.dossiers.ET2026001217.watMerkJe = "Fietsers zijn niet toegestaan op het parcours.";
  assert.deepEqual(validateEvenementIdentiteit(fietsers), []);
  // Een goedgekeurd dossier zegt nergens meer dat het niet toegestaan is.
  const e = evenementEntry([rij("ET2026005554", "Evenement", "Parcours", "2026-10-17", "2026-10-17", ["Kloosterstraat"])], opties);
  assert.doesNotMatch(JSON.stringify(e.uitleg), /toegestaan|weiger/i);
});

test("3. de schets toont het hele parcours, niet de eerste 12 lijnen", async () => {
  // 30 lijnen van 50 punten, van zuid naar noord: alles blijft, binnen het puntenbudget.
  const lijnen = Array.from({ length: 30 }, (_, i) => Array.from({ length: 50 }, (_, j) => [4.40 + j * 0.0001, 51.196 + i * 0.0016 + j * 0.00003]));
  const s = routeSchets(lijnen);
  assert.equal(s.lijnen.length, 30);
  assert.equal(s.deel, false);
  assert.ok(s.lijnen.flat().length <= 340, `te veel punten: ${s.lijnen.flat().length}`);
  const ys = s.lijnen.flat().map((p) => p[1]);
  assert.equal(Math.min(...ys), 51.196);
  assert.ok(Math.max(...ys) > 51.24);
  // Dubbele lijnen (dezelfde lijn in twee lagen) tellen één keer; te veel lijnen: dan "deel".
  assert.equal(routeSchets([lijnen[0], lijnen[0]]).lijnen.length, 1);
  assert.equal(routeSchets(lijnen, { maxPunten: 20 }).deel, true);
  // De verversing bewaart het hele parcours en zegt of het volledig is.
  const { bouwKaartUitleg, validateKaartUitleg } = await import("../lib/kaart-uitleg-refresh.mjs");
  const district = { type: "Polygon", coordinates: [[[4.39, 51.19], [4.42, 51.19], [4.42, 51.25], [4.39, 51.25], [4.39, 51.19]]] };
  const dag = Date.UTC(2026, 9, 13, 8);
  const iodFeatures = lijnen.map((l, i) => ({ attributes: { dossierNummer: "ET2099000040", faseId: "F1", innameId: `I${i}`, dossierStatus: "aanvraag_goedgekeurd", faseNaam: "Evenement", type_dossier: "ETL", innameTypeNaam: "Parcours", innameBeschrijving: "", innameHinder: "True", faseStartDatum: dag, faseEindDatum: dag }, geometry: { paths: [l] } }));
  const { document } = await bouwKaartUitleg({ iodFeatures, district, clock: () => new Date("2026-10-06T05:00:00Z"), fetch: null });
  assert.deepEqual(validateKaartUitleg(document), []);
  assert.equal(document.evenementen.ET2099000040.kaart.length, 30);
  assert.equal(document.evenementen.ET2099000040.kaartDeel, false);
  // Een bestand van vóór deze markering met 12 lijnen kan afgekapt zijn: dan zegt het onderschrift "een deel".
  const rows = [rij("ET2099000040", "Evenement", "Parcours", "2026-10-13", "2026-10-13", ["Proefstraat"])];
  const oud = { evenementen: { ET2099000040: { straten: ["Proefstraat"], gekoppeld: null, kaart: lijnen.slice(0, 12) } } };
  assert.equal(evenementEntry(rows, { ...opties, uitleg: oud }).kaartDeel, true);
  assert.equal(evenementEntry(rows, { ...opties, uitleg: { evenementen: { ET2099000040: { ...oud.evenementen.ET2099000040, kaartDeel: false } } } }).kaartDeel, false);
  assert.match(lees("site", "place-view.js"), /entry\.kaartDeel \? "een deel van het parcours" : "het parcours"/);
});

test("4. zonder straatas weet de verversing niet wat langs het parcours ligt: geen lege lijst", async () => {
  const { bouwKaartUitleg, validateKaartUitleg } = await import("../lib/kaart-uitleg-refresh.mjs");
  const district = { type: "Polygon", coordinates: [[[4.39, 51.19], [4.42, 51.19], [4.42, 51.21], [4.39, 51.21], [4.39, 51.19]]] };
  const dag = Date.UTC(2026, 9, 13, 8);
  const feat = (dossier, path) => ({ attributes: { dossierNummer: dossier, faseId: "F1", innameId: "I1", dossierStatus: "aanvraag_goedgekeurd", faseNaam: "Evenement", type_dossier: "ETL", innameTypeNaam: "Parcours", innameBeschrijving: "", innameHinder: "True", faseStartDatum: dag, faseEindDatum: dag }, geometry: { paths: [path] } });
  const zonder = await bouwKaartUitleg({ iodFeatures: [feat("ET2099000041", [[4.4001, 51.2], [4.4049, 51.2]])], district, clock: () => new Date("2026-10-06T05:00:00Z"), fetch: null });
  assert.deepEqual(validateKaartUitleg(zonder.document), []);
  assert.equal("langs" in zonder.document.evenementen.ET2099000041, false);
  // De site zegt dan voorzichtig "op of naast", niet "kruist".
  const rows = [rij("ET2099000041", "Evenement", "Parcours", "2026-10-13", "2026-10-13", ["Langsstraat"])];
  assert.equal(kern(evenementEntry(rows, { vandaag: "2026-10-06", uitleg: zonder.document, straat: "Langsstraat" }).uitleg)["Jouw straat"], "Jouw straat ligt op of naast het parcours.");
  // Een korte straat (ongeveer 40 m) waar het parcours helemaal over loopt, ligt op het parcours.
  const as = (id, naam, coords) => ({ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: { LSTRNMID: id, LSTRNM: naam, RSTRNMID: id, RSTRNM: naam, postcode: 2000, DISTRICT: "Antwerpen" } });
  const streetFeatures = [as(3, "Kortstraat", [[4.41, 51.2], [4.41057, 51.2]]), as(4, "Dwarsstraat", [[4.4103, 51.198], [4.4103, 51.202]])];
  const kort = await bouwKaartUitleg({ iodFeatures: [feat("ET2099000042", [[4.41001, 51.2], [4.41056, 51.2]])], district, streetFeatures, clock: () => new Date("2026-10-06T05:00:00Z"), fetch: null });
  assert.deepEqual(kort.document.evenementen.ET2099000042.langs, ["Kortstraat"]);
});

test("5. de marathon in de woorden van de bron", () => {
  const m = IDENTITEIT.dossiers.ET2026001217;
  assert.match(m.waar, /^Start aan de Kattendijkbrug \(de 10 km start op de Orteliuskaai\), finish aan het MAS\./);
  assert.doesNotMatch(m.waar, /Rijnkaai/);
  assert.doesNotMatch(m.watMerkJe, /middernacht|moeten afstappen/);
  assert.match(m.watMerkJe, /Fietsers zijn niet toegelaten op het parcours: stap af en ga verder als voetganger\./);
  assert.match(m.watMerkJe, /Het parcours is verkeersvrij van 8 tot 18 uur\./);
});

test("6. een onbekend dossier gist niet", async () => {
  const { validateEvenementIdentiteit } = await import("../lib/evenement-identiteit-validatie.mjs");
  for (const [id, d] of Object.entries(IDENTITEIT.dossiers)) {
    if (d.zekerheid === "onbekend") assert.doesNotMatch(`${d.watMerkJe} ${d.waar} ${d.reden}`, /\b(?:mogelijk|waarschijnlijk|vermoedelijk|misschien|wellicht)\b/i, id);
  }
  const fout = structuredClone(IDENTITEIT);
  fout.dossiers.ET2026005129.watMerkJe = "Mogelijk een laad- en loszone op de Cornelissenlaan.";
  assert.ok(validateEvenementIdentiteit(fout).includes("dossiers.ET2026005129.watMerkJe gist bij een onbekend dossier"));
  // Bij een vermoeden (waarschijnlijk) mag het woord wel: daar is het vermoeden het punt.
  const ok = structuredClone(IDENTITEIT);
  ok.dossiers.ET2026004667.watMerkJe = "Vermoedelijk 's avonds een groep studenten.";
  assert.deepEqual(validateEvenementIdentiteit(ok), []);
});

test("7. 'Studentendoop' is een soort, geen naam: vermoedelijk, op grond van het dossier", () => {
  const d = IDENTITEIT.dossiers.ET2026005074;
  assert.equal(d.zekerheid, "waarschijnlijk");
  assert.equal(d.naam, "");
  assert.match(d.reden, /omschrijving in het dossier/);
  const e = evenementEntry([rij("ET2026005074", "Evenement", "Parcours", "2026-10-27", "2026-10-27", ["Frans Halsplein"])], opties);
  assert.equal(e.title, "Vermoedelijk een studentendoop: een stoet met dril, spelletjes en een doop");
  assert.match(e.uitleg.voetnoot, /zonder naam\. Het vermoeden steunt op het dossier/);
});

test("8. een koppeling op dag en straat is een vermoeden, met de officiële link en eerlijke uren", () => {
  const rows = [
    rij("ET2099000050", "Evenement", "Parcours", "2026-10-31", "2026-10-31", ["Voorbeeldlei"]),
    rij("ET2099000050", "Evenement", "Parkeerverbod in Straat", "2026-10-31", "2026-10-31", ["Voorbeeldlei", "Proefstraat"]),
  ];
  const agenda = [{ id: "halloween-voorbeeldlei-2026-10-31", title: "Halloween in de Voorbeeldlei", date: "2026-10-31", timeText: "14 tot 20 uur", location: "Voorbeeldlei", category: "neighborhood", sourceUrl: "https://www.antwerpen.be/info/halloween-voorbeeld" }];
  const e = evenementEntry(rows, { ...opties, agendaItems: agenda });
  assert.equal(e.title, "Vermoedelijk: Halloween in de Voorbeeldlei");
  assert.deepEqual(e.uitleg.links.map((l) => l.url), ["https://www.antwerpen.be/info/halloween-voorbeeld", "/event/halloween-voorbeeldlei-2026-10-31/"]);
  const k = kern(e.uitleg);
  assert.match(k.Wanneer, /14 tot 20 uur/);
  assert.match(k["Wat merk je"], /^Parkeerverbod in Proefstraat, Voorbeeldlei\. De uren van het parkeerverbod staan niet in het dossier\./);
});

test("9. de open kaart herhaalt niets: opbouw, afbraak en het aantal straten staan er één keer", () => {
  const straten = Array.from({ length: 12 }, (_, i) => `Straat ${i}`);
  const rows = [
    rij("ET2026003440", "Opbouw", "Inname", "2026-10-09", "2026-10-10", ["Beatrijslaan"]),
    rij("ET2026003440", "Evenement", "Parcours", "2026-10-10", "2026-10-10", straten),
    rij("ET2026003440", "Afbraak", "Inname", "2026-10-11", "2026-10-11", ["Beatrijslaan"]),
  ];
  const k = evenementKaartje(evenementFeiten(rows), { vandaag: VANDAAG, identiteit: IDENTITEIT.dossiers.ET2026003440 });
  const tekst = JSON.stringify([k.kern, k.regels]);
  assert.equal((tekst.match(/9 oktober/g) || []).length, 1);
  assert.equal((tekst.match(/11 oktober/g) || []).length, 1);
  assert.equal(k.regels.some(([l]) => l === "Straten" || l === "Opbouw en afbraak"), false);
  assert.match(k.stratenNoot, /niet allemaal tegelijk dicht/);
  // Open evenementkaart: de samenvatting bovenaan verdwijnt (ze staat al in de kern).
  assert.match(lees("site", "place-view.css"), /\.pv-row\.open\.pv-row-kern \.pv-row-summary \{ display: none; \}/);
  assert.match(lees("site", "place-view.js"), /entry\.uitleg\?\.kern \? " pv-row-kern" : ""/);
});

test("10. 'Jouw straat' gist niet waarvoor een inname dient", () => {
  const f = evenementFeiten([rij("ET2099000060", "Evenement", "Inname", "2026-10-20", "2026-10-20", ["Proefstraat"])]);
  assert.equal(jouwStraat(f, "Proefstraat", VANDAAG), "Jouw straat wordt gebruikt voor dit evenement op dinsdag 20 oktober; waarvoor precies, zegt de stad niet.");
  assert.equal(jouwStraat({ ...f, perSoort: {}, straten: ["Proefstraat"] }, "Proefstraat"), "Jouw straat staat in het dossier van dit evenement; waarvoor, zegt de stad niet.");
  assert.doesNotMatch(lees("site", "kaart-uitleg.js"), /zoals tenten, nadars of een stand|bijvoorbeeld voor een omleiding of een parkeerverbod/);
});
