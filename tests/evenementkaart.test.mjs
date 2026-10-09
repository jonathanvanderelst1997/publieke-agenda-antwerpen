// Evenementkaart duidelijk: welke race of welk evenement, uren, link en jouw straat (site/kaart-uitleg.js,
// site/place-core.js) met de nagekeken identiteit uit site/sources/evenement-identiteit.json. De
// innames hieronder zijn verzonnen; de dossiernummers en de identiteit zijn de echte publieke gegevens.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { evenementFeiten, evenementKaartje, koppelEvenement, soortEvenement } from "../site/kaart-uitleg.js";
import { evenementEntry, publicSpaceEntries, summarize, KIND_GROUPS } from "../site/place-core.js";
import { bezoekersLinks, bezoekersHint } from "../site/bezoekers-bronnen.js";
import { privacyFindings } from "../lib/source-feed.mjs";
import { readSources } from "../scripts/build-sources.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IDENTITEIT = JSON.parse(fs.readFileSync(path.join(root, "site", "sources", "evenement-identiteit.json"), "utf8"));
const VANDAAG = "2026-10-09";

// Eén inname zoals de live A-Sign-laag ze levert (public-space-live-core.js).
let n = 0;
const rij = (dossier, phase, type, start, end, straten, extra = {}) => ({
  id: `iod:${dossier}|${phase}|${(n += 1)}`, kind: "iod", title: type, innameType: type, reference: dossier, dossierType: "ETL",
  phase, hindrance: "True", description: "", start, end: end || start, status: "aanvraag_goedgekeurd",
  streets: straten.map((name, i) => ({ id: `${n}${i}`, name, postcode: "2000" })), sourceUrl: "https://geodata.antwerpen.be/x", ...extra,
});
const marathon = [
  rij("ET2026001217", "Opbouw", "Inname", "2026-10-12", "2026-10-17", ["Kattendijkdok-Westkaai"]),
  rij("ET2026001217", "Evenement", "Parcours", "2026-10-18", "2026-10-18", ["Rijnkaai", "Meir", "Van Ertbornstraat", "Pelikaanstraat"]),
  rij("ET2026001217", "Afbraak", "Inname", "2026-10-19", "2026-10-20", ["Kattendijkdok-Westkaai"]),
];
const criterium = [
  rij("ET2026003440", "Afbraak", "Verkeersvrije Zone", "2026-10-11", "2026-10-11", ["Abraham Verhoevenlaan"]),
  rij("ET2026003440", "Evenement", "Parcours", "2026-10-10", "2026-10-10", ["Beatrijslaan", "Abraham Verhoevenlaan", "Meeuwstraat"]),
  rij("ET2026003440", "Opbouw", "Inname", "2026-10-09", "2026-10-10", ["Beatrijslaan"]),
  rij("ET2026003440", "Evenement", "Parkeerverbod in Straat", "2026-10-10", "2026-10-10", ["Meeuwstraat"], { description: "parkeerverbod beatrijslaan 34" }),
];
const doop = [rij("ET2026004331", "Evenement", "Parcours", "2026-10-13", "2026-10-13", ["Lindendreef", "Groenenborgerlaan", "Pieter Coeckelaan"])];
const kern = (k) => Object.fromEntries(k.kern);
const opties = { vandaag: VANDAAG, identiteit: IDENTITEIT, wijkVan: () => "" };

test("18 oktober: de kaart zegt TREK Antwerp Marathon, met de uren van de race en de officiële link", () => {
  const e = evenementEntry(marathon, { ...opties, straat: "Van Ertbornstraat" });
  assert.equal(e.title, "TREK Antwerp Marathon");
  assert.equal(e.start, "2026-10-18"); // de dag van de race, niet het begin van de opbouw
  assert.equal(e.time, "09:00");
  const k = kern(e.uitleg);
  assert.match(k.Wat, /^Loopwedstrijd: marathon, halve marathon en 10 km\. Organisator: Golazo\.$/);
  assert.match(k.Wanneer, /^Zondag 18 oktober, start marathon en 10 km om 9 uur, halve marathon om 14 uur/);
  assert.match(k.Wanneer, /verkeersvrij van 8 tot 18 uur\. Opbouw vanaf maandag 12 oktober en afbraak tot dinsdag 20 oktober\.$/);
  assert.match(k.Waar, /Start aan de Rijnkaai/);
  assert.equal(k["Jouw straat"], "Jouw straat ligt op of naast het parcours.");
  assert.match(k["Wat merk je"], /verkeersvrij van 8 tot 18 uur/);
  assert.deepEqual(e.uitleg.links[0], { url: "https://antwerpmarathon.com/nl/het-parcours/", label: "Officiële info over dit evenement", uitleg: "" });
  const links = bezoekersLinks(e);
  assert.equal(links[0].label, "Officiële info over dit evenement");
  assert.equal(links.at(-1).label, "Technische gegevens van de stad (geen infopagina)");
  assert.equal(bezoekersHint(e), "");
  assert.match(e.uitleg.voetnoot, /^De stad gaf toelating voor dit evenement \(dossier ET2026001217\)\. Wat het is, hebben we nagekeken op antwerpmarathon\.com en slimnaarantwerpen\.be \(9 oktober 2026\)\.$/);
});

test("10 oktober: Linkeroever Criterium, koersdag apart van opbouw en afbraak, fasen in volgorde", () => {
  const f = evenementFeiten(criterium);
  assert.deepEqual(f.fasen, ["Opbouw", "Evenement", "Afbraak"]);
  assert.deepEqual(f.evenementDag, { start: "2026-10-10", eind: "2026-10-10" });
  const e = evenementEntry(criterium, { ...opties, straat: "Meeuwstraat" });
  assert.equal(e.title, "Linkeroever Criterium");
  assert.equal(e.start, "2026-10-10");
  assert.equal(e.end, "");
  assert.equal(e.uitleg.samenvatting, "Zaterdag 10 oktober, 11 tot 18.30 uur. Jouw straat krijgt een parkeerverbod en ligt op of naast het parcours.");
  assert.equal(kern(e.uitleg).Wanneer, "Zaterdag 10 oktober, 11 tot 18.30 uur. Opbouw vanaf vrijdag 9 oktober en afbraak tot zondag 11 oktober.");
  assert.equal(e.uitleg.regels.find(([l]) => l === "Opbouw en afbraak")[1], "opbouw: 9 oktober – 10 oktober · dag van het evenement: 10 oktober · afbraak: 11 oktober");
  assert.equal(e.uitleg.links[0].uitleg, "Op de districtskalender van district Antwerpen, bij 10 oktober.");
  // Geen uren van de koers achter de innameperiode ("9 oktober – 11 oktober 11 tot 18.30 uur").
  assert.doesNotMatch(`${e.title} ${e.summary}`, /11 oktober 11 tot/);
  // Het agendapunt met dezelfde naam, niet het buurtfeest dat dezelfde dag langs het parcours staat.
  const agenda = [
    { id: "buurtfeest-gaston-burssenslaan-hanegraefstraat-2026-10-10", title: "Buurtfeest Gaston Burssenslaan en Hanegraefstraat", date: "2026-10-10", location: "Gaston Burssenslaan", category: "neighborhood" },
    { id: "district-kal-6a746a7ff4182b8edf63a777-2026-10-10", title: "Linkeroever Criterium", date: "2026-10-10", location: "Poisson Pilote", category: "sport" },
  ];
  const metAgenda = evenementEntry(criterium, { ...opties, agendaItems: agenda });
  assert.deepEqual(metAgenda.uitleg.links.map((l) => l.label), ["Officiële info over dit evenement", "Agendapunt: Linkeroever Criterium"]);
  assert.equal(evenementEntry(doop, { ...opties, agendaItems: agenda }).uitleg.links.length, 0); // vermoedelijk: geen gegokt agendapunt
  // Een huisnummer uit een vrij veld van het dossier gaat niet mee.
  assert.ok(e.uitleg.beschrijvingen.includes("Parkeerverbod in Straat: parkeerverbod beatrijslaan"));
  assert.doesNotMatch(JSON.stringify(e.uitleg), /beatrijslaan 34/i);
});

test("13 oktober: een eerlijke 'vermoedelijk studentendoop' met de reden, zonder verzonnen naam of uren", () => {
  const e = evenementEntry(doop, { ...opties, straat: "Pieter Coeckelaan" });
  assert.equal(e.title, "Vermoedelijk een studentendoop met een doopstoet naar Fort VI");
  const k = kern(e.uitleg);
  assert.match(k.Wat, /Fort VI, een officiële doopplaats, en 13 oktober valt in de doopperiode/);
  assert.match(k.Wanneer, /^Dinsdag 13 oktober; de uren zijn niet gepubliceerd\. Het studentencharter laat een stoet toe tussen 10 en 22 uur/);
  assert.equal(e.time, "");
  assert.equal(e.uitleg.links.length, 0); // geen officiële pagina: dan ook geen knop
  assert.ok(e.uitleg.ontbreekt.includes("uren niet gepubliceerd"));
  const ook = IDENTITEIT.dossiers.ET2026004943;
  assert.equal(ook.zekerheid, "waarschijnlijk");
  assert.match(ook.reden, /12 oktober valt in de doopperiode/);
});

test("onbekend: één korte eerlijke zin, geen gegokte soort", () => {
  const rows = [rij("ET2026005554", "Evenement", "Parcours", "2026-10-17", "2026-10-17", ["Kloosterstraat"])];
  const e = evenementEntry(rows, opties);
  assert.equal(e.title, "Evenement met toelating van de stad");
  assert.equal(kern(e.uitleg).Wat, "Evenement met toelating van de stad; de stad maakt niet bekend wat het is.");
  assert.match(kern(e.uitleg).Waar, /Zuidpark en de Scheldekaaien/); // waar komt wel uit de nagekeken fiche
});

test("nieuw dossier zonder fiche: gekoppeld aan een agendapunt op dezelfde dag en in dezelfde straat", () => {
  const rows = [
    rij("ET2099000009", "Opbouw", "Inname", "2026-10-23", "2026-10-23", ["Voorbeeldplein"]),
    rij("ET2099000009", "Evenement", "Parcours", "2026-10-24", "2026-10-24", ["Voorbeeldplein", "Proefstraat"]),
  ];
  const agenda = [
    { id: "buurtloop-voorbeeldplein-2026-10-24", title: "Buurtloop Voorbeeldplein", date: "2026-10-24", timeText: "14 tot 17 uur", location: "Voorbeeldplein 12", category: "sport", sourceUrl: "https://www.antwerpen.be/info/voorbeeld" },
    { id: "markt-voorbeeldplein", title: "Gemengde markt Voorbeeldplein", date: "2026-10-24", location: "Voorbeeldplein", category: "markets" },
  ];
  const e = evenementEntry(rows, { ...opties, agendaItems: agenda });
  assert.equal(e.title, "Buurtloop Voorbeeldplein");
  assert.match(kern(e.uitleg).Wat, /^Buurtloop Voorbeeldplein \(Voorbeeldplein\)\. Gekoppeld aan agendapunt/);
  assert.equal(e.uitleg.links[0].url, "/event/buurtloop-voorbeeldplein-2026-10-24/");
  assert.equal(bezoekersLinks(e)[0].url, "/event/buurtloop-voorbeeldplein-2026-10-24/");
  assert.equal(e.time, "14:00");
  // Alleen de opbouwdag of een inname van weken koppelt niet.
  assert.equal(koppelEvenement(evenementFeiten(rows), [{ ...agenda[0], date: "2026-10-23" }]), null);
  const lang = [rij("ET2099000010", "Evenement", "Inname", "2026-10-01", "2026-12-31", ["Voorbeeldplein"])];
  assert.equal(koppelEvenement(evenementFeiten(lang), agenda), null);
  // Zonder koppeling: de eerlijke korte zin.
  assert.equal(evenementEntry(rows, { ...opties, agendaItems: [] }).title, "Evenement met toelating van de stad");
});

test("jouw straat: op het parcours of alleen kruisend, als de verversing de straten langs de lijn kent", () => {
  const uitleg = { evenementen: { ET2026001217: { straten: ["Meir", "Rijnkaai"], langs: ["Meir", "Rijnkaai"], gekoppeld: null, kaart: [] } } };
  assert.equal(kern(evenementEntry(marathon, { ...opties, uitleg, straat: "Meir" }).uitleg)["Jouw straat"], "Jouw straat ligt op het parcours.");
  assert.equal(kern(evenementEntry(marathon, { ...opties, uitleg, straat: "Pelikaanstraat" }).uitleg)["Jouw straat"], "Jouw straat kruist het parcours of ligt er vlak naast.");
  assert.equal(kern(evenementEntry(marathon, { ...opties, uitleg }).uitleg)["Jouw straat"], undefined); // geen straat gekozen
});

test("een evenement op straat telt als evenement: groep, teller en filter", () => {
  const entries = publicSpaceEntries([...marathon, { id: "parking:1", kind: "parking", title: "Verhuis", start: "2026-10-20", end: "2026-10-20" }], opties);
  const ev = entries.filter((e) => e.group === "evenementen"), werk = entries.filter((e) => e.group === "werken");
  assert.equal(ev.length, 1); // 3 innames, 1 kaart
  assert.equal(werk.length, 1);
  const sum = summarize(entries, VANDAAG);
  assert.equal(sum.evenementen, 1);
  assert.equal(sum.werkenGepland, 1);
  // De chip "Evenementen" is de groep van deze kaart; zonder "Werken & verkeer" blijft ze zichtbaar.
  const alleenEvenementen = new Set(["evenementen"]);
  assert.deepEqual(entries.filter((e) => alleenEvenementen.has(e.group)).map((e) => e.title), ["TREK Antwerp Marathon"]);
  assert.ok(KIND_GROUPS.some((g) => g.key === "evenementen"));
});

test("plekoverzicht: vijfde tegel voor vergunningen, chips tellen kaarten, A-Sign laadt ook voor Evenementen", () => {
  const view = fs.readFileSync(path.join(root, "site", "place-view.js"), "utf8");
  assert.match(view, /tile\(summary\.vergunningen/);
  assert.equal((view.match(/\$\{tile\(/g) || []).length, 5);
  assert.match(view, /liveEntries\.filter\(\(entry\) => state\.groups\.has\(entry\.group\)\)/);
  assert.match(view, /new Set\(liveEntries\.filter\(\(e\) => e\.group === group\)\.map\(\(e\) => e\.uid\)\)\.size/);
  assert.match(view, /view\.wantsStreetEvents = state\.groups\.has\("evenementen"\)/);
  const live = fs.readFileSync(path.join(root, "site", "public-space-live.js"), "utf8");
  assert.match(live, /v\?\.enabled\("publicSpace"\)\|\|v\?\.wantsStreetEvents/);
});

test("schets: jouw straat in een eigen kleur, ook net naast het parcours", async () => {
  const { kaartSvg } = await import("../site/kaart-uitleg.js");
  const route = [[[4.40, 51.20], [4.41, 51.20]]];
  const naast = [[[4.412, 51.203], [4.413, 51.204]]]; // net buiten het kader van het parcours
  assert.match(kaartSvg(route, [], { gekozen: naast }), /<g class="ku-jouw"><polyline/);
  assert.doesNotMatch(kaartSvg(route, [], { gekozen: [[[4.5, 51.3], [4.51, 51.3]]] }), /ku-jouw/); // ver weg: niet
  assert.doesNotMatch(kaartSvg(route, []), /ku-jouw/);
});

test("'Grote Markt' in een dossier maakt er geen markt van", () => {
  assert.equal(soortEvenement(["Inname: grote markt, verkoop"]), "");
  assert.equal(soortEvenement(["Inname: verplaatsbare markt"]), "Markt");
  // De browser kent soms alleen de parcourslijn ("Wandelroute"); de verversing ook de inname ("Doop").
  const rows = [rij("ET2099000031", "Evenement", "Parcours", "2026-10-22", "2026-10-22", ["Proefstraat"], { description: "Wandelroute van start naar eind" })];
  const uitleg = { evenementen: { ET2099000031: { straten: ["Proefstraat"], beschrijvingen: ["Inname: Startlocatie Doop", "Parkeerverbod in Straat: proefstraat 12"], soort: "Wandeling", gekoppeld: null, kaart: [] } } };
  const e = evenementEntry(rows, { ...opties, uitleg });
  assert.equal(e.title, "Vermoedelijk een studentendoop");
  assert.ok(e.uitleg.beschrijvingen.includes("Parkeerverbod in Straat: proefstraat"));
  // Een doopwandeling is een studentendoop, geen gewone wandeling.
  assert.equal(soortEvenement(["Parcours: Wandelroute van start naar eind", "Inname: Startlocatie Doop"]), "Studentendoop");
});

test("de kaart zonder jargon en zonder lappen 'niet in de bron'", () => {
  for (const rows of [marathon, criterium, doop]) {
    const e = evenementEntry(rows, opties);
    const tekst = JSON.stringify([e.title, e.summary, e.uitleg.kern, e.uitleg.regels, e.uitleg.voetnoot]);
    assert.doesNotMatch(tekst, /ETL|IOD|\bTrue\b|Niet in de bron|volgens het dossier|uit een parcours alleen volgt niet|Kijk bij de officiële bron/);
  }
  assert.doesNotMatch(JSON.stringify(evenementKaartje(evenementFeiten(doop), { vandaag: VANDAAG })), /ETL|IOD/);
});

test("identiteitsbestand: geldig, publiek en zonder persoonsgegevens", async () => {
  const { validateEvenementIdentiteit } = await import("../lib/evenement-identiteit-validatie.mjs");
  assert.deepEqual(validateEvenementIdentiteit(IDENTITEIT), []);
  assert.deepEqual(privacyFindings(IDENTITEIT), []);
  assert.equal(Object.keys(IDENTITEIT.dossiers).length, 38);
  const fout = structuredClone(IDENTITEIT);
  fout.dossiers.ET2026001217.link = "https://example.org/?mail=x";
  fout.dossiers.ET2026001217.waar = "Start aan Voorbeeldstraat 12";
  fout.dossiers.ET2026003440.naam = "";
  const errors = validateEvenementIdentiteit(fout);
  assert.ok(errors.some((e) => /ET2026001217\.link/.test(e)));
  assert.ok(errors.some((e) => /ET2026001217\.waar bevat een huisnummer/.test(e)));
  assert.ok(errors.some((e) => /ET2026003440: zeker zonder naam/.test(e)));
  // Geen agendabron: de feed-bouw leest het bestand niet als bron.
  const { documents } = readSources(root);
  assert.ok(!documents.some((d) => /identiteit/.test(JSON.stringify(d.sourceId || d.document?.sourceId || ""))));
});

test("verversing bewaart de straten langs de lijn apart, zodat 'ligt op' en 'kruist' verschillen", async () => {
  const { bouwKaartUitleg, validateKaartUitleg } = await import("../lib/kaart-uitleg-refresh.mjs");
  const { buildStreetIndex } = await import("../site/street-core.js");
  const { collectPublicSpace } = await import("../site/public-space-live-core.js");
  const district = { type: "Polygon", coordinates: [[[4.39, 51.19], [4.42, 51.19], [4.42, 51.21], [4.39, 51.21], [4.39, 51.19]]] };
  const as = (id, naam, coords) => ({ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: { LSTRNMID: id, LSTRNM: naam, RSTRNMID: id, RSTRNM: naam, postcode: 2000, DISTRICT: "Antwerpen" } });
  const streetFeatures = [as(1, "Langsstraat", [[4.400, 51.2], [4.405, 51.2]]), as(2, "Kruisstraat", [[4.4025, 51.198], [4.4025, 51.202]])];
  const dag = Date.UTC(2026, 9, 13, 8);
  const iodFeatures = [{ attributes: { dossierNummer: "ET2099000020", faseId: "F1", innameId: "I1", dossierStatus: "aanvraag_goedgekeurd", faseNaam: "Evenement", type_dossier: "ETL", innameTypeNaam: "Parcours", innameBeschrijving: "", innameHinder: "True", faseStartDatum: dag, faseEindDatum: dag }, geometry: { paths: [[[4.4001, 51.2], [4.4049, 51.2]]] } }];
  const { document } = await bouwKaartUitleg({ iodFeatures, district, streetFeatures, clock: () => new Date("2026-10-06T05:00:00Z"), fetch: null });
  assert.deepEqual(validateKaartUitleg(document), []);
  assert.deepEqual(document.evenementen.ET2099000020.langs, ["Langsstraat"]);
  // In de browser hangt het parcours (18 m marge) ook aan de kruisende straat; de kaart zegt het verschil.
  const rows = collectPublicSpace({ iodFeatures, districtGeometry: district, streetIndex: buildStreetIndex(streetFeatures) });
  assert.deepEqual(rows[0].streets.map((s) => s.name).sort(), ["Kruisstraat", "Langsstraat"]);
  const jouw = (straat) => kern(evenementEntry(rows, { vandaag: "2026-10-06", uitleg: document, straat }).uitleg)["Jouw straat"];
  assert.equal(jouw("Langsstraat"), "Jouw straat ligt op het parcours.");
  assert.equal(jouw("Kruisstraat"), "Jouw straat kruist het parcours of ligt er vlak naast.");
});
