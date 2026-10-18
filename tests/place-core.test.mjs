import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  foldText, parseQuery, editDistance, buildPlaceIndex, searchPlaces, otherDistrictFor, placeParam, resolvePlaceParam,
  periodRange, monthWeeks, startOfWeek, layoutWeekBars, groupForList, overlaps, dayOf,
  agendaEntry, workEntry, publicSpaceEntry, publicSpaceEntries, werkEntries, summarize, KIND_GROUPS, DEFAULT_GROUPS, themesForGroups, groupsForThemes, groupOfTheme,
  plekWaar, legeStaatTekst, voortgangTekst, dezeWeek, WEEK_LICHT,
} from "../site/place-core.js";
import { createAgendaView, DEFAULT_THEMES, VIEW_THEMES } from "../site/agenda-view.js";
import { buildStreetList } from "../scripts/build-straten.mjs";
import { wijkFeatures, bboxOf } from "../site/neighborhood-core.js";

const straten = JSON.parse(fs.readFileSync(new URL("../site/geo/straten.json", import.meta.url), "utf8"));
const wijkDoc = JSON.parse(fs.readFileSync(new URL("../site/geo/wijken.geo.json", import.meta.url), "utf8"));
const wijken = wijkFeatures(wijkDoc).filter((f) => f.properties.code.startsWith("ANT")).map((f) => ({ code: f.properties.code, naam: f.properties.naam, box: bboxOf(f.geometry) }));
const index = buildPlaceIndex({ streets: straten.streets, wijken });
const top = (query) => searchPlaces(index, query, { limit: 5 })[0]?.place;

test("normaliseren: hoofdletters, accenten, huisnummers, postcode en afkortingen", () => {
  assert.equal(foldText("  Één-Café’s  "), "een cafes");
  assert.deepEqual(parseQuery("Kammenstr. 12"), { text: "kammenstraat", compact: "kammenstraat", postcode: "", ruw: "kammenstr12" });
  assert.deepEqual(parseQuery("Gaston Burssenslaan 12 bus 3, 2050 Antwerpen"), { text: "gaston burssenslaan", compact: "gastonburssenslaan", postcode: "2050", ruw: "gastonburssenslaan12bus3antwerpen" });
  // `ruw` houdt de cijfers (een straatnaam kan er een hebben), zonder de postcode (nakijkronde 12 oktober 2026).
  assert.deepEqual(parseQuery("Fort 7-straat 2610"), { text: "fortstraat", compact: "fortstraat", postcode: "2610", ruw: "fort7straat" });
  assert.equal(parseQuery("2610 Pad nr. 25").ruw, "padnr25");
  assert.equal(parseQuery("St.-Jansplein").compact, "sintjansplein");
  assert.equal(parseQuery("Nationale str").compact, "nationalestraat");
  assert.equal(parseQuery("Lange Elzenstr 5A").compact, "langeelzenstraat");
  assert.equal(parseQuery("wijk Zurenborg").compact, "zurenborg");
  assert.equal(editDistance("schrijfstraat", "schijfstraat"), 1);
  assert.equal(editDistance("abcdef", "badcfe", 1), 2);
});

test("straatnamenlijst: officiële straten van district Antwerpen met wijk, postcode en kader", () => {
  assert.ok(straten.streets.length > 1000);
  assert.match(straten.metadata.source, /straatas/);
  assert.match(straten.metadata.license, /open data/i);
  for (const [id, name, postcode, codes, box] of straten.streets) {
    assert.match(String(id), /^-?\d+$/);
    assert.ok(name && typeof name === "string");
    assert.match(postcode, /^(2000|2018|2020|2030|2050|2060)$/);
    assert.ok(Array.isArray(codes) && codes.every((c) => /^ANT\d{2}$/.test(c)));
    assert.equal(box.length, 4);
    assert.ok(box[0] > 4.2 && box[2] < 4.5 && box[1] > 51.1 && box[3] < 51.4);
  }
  // Geen persoonsgegevens: alleen de velden van het schema.
  assert.deepEqual(Object.keys(straten).sort(), ["metadata", "schemaVersion", "streets"]);
});

test("straatlijst bouwen uit de straatas: wijk via het midden van elk segment", () => {
  const square = { type: "Feature", properties: { code: "ANT99", naam: "Proef" }, geometry: { type: "Polygon", coordinates: [[[4.0, 51.0], [4.1, 51.0], [4.1, 51.1], [4.0, 51.1], [4.0, 51.0]]] } };
  const segment = { a: [4.01, 51.01], b: [4.02, 51.02], refs: [{ id: "7", name: "Proefstraat", postcode: "2000" }] };
  const outside = { a: [4.2, 51.2], b: [4.21, 51.21], refs: [{ id: "7", name: "Proefstraat", postcode: "2000" }] };
  assert.deepEqual(buildStreetList({ segments: [segment, outside] }, [square]), [["7", "Proefstraat", "2000", ["ANT99"], [4.01, 51.01, 4.21, 51.21]]]);
});

test("zoeken: straat, gedeeltelijke naam, huisnummer, wijk, postcode en alias", () => {
  assert.equal(top("Kammenstraat").name, "Kammenstraat");
  assert.equal(top("kammenstr").name, "Kammenstraat");
  assert.equal(top("KAMMENSTRAAT 12").name, "Kammenstraat");
  assert.equal(top("Gaston Burssenslaan 12, 2050 Antwerpen").name, "Gaston Burssenslaan");
  assert.equal(top("de coninck plein").name, "De Coninckplein");
  assert.equal(top("st.-jansplein").name, "Sint-Jansplein");
  const kiel = searchPlaces(index, "Kiel", { limit: 5 });
  assert.equal(kiel[0].place.type, "wijk");
  assert.ok(kiel.slice(1).every((r) => r.place.type === "straat" && r.place.name.startsWith("Kiel")));
  assert.equal(top("zurenborg").type, "wijk");
  assert.equal(top("2060").type, "postcode");
  assert.equal(top("'t Zuid").label, "Zuid");
  assert.equal(top("centrum").label, "Historisch centrum");
  // Een postcode in de vraag beperkt straten met dezelfde naam.
  const keyserlei = searchPlaces(index, "De Keyserlei 2018");
  assert.equal(keyserlei.length, 1);
  assert.equal(keyserlei[0].place.postcode, "2018");
});

test("zoeken: tikfout geeft 'bedoelde je', maar nooit boven een echte treffer", () => {
  const typo = searchPlaces(index, "Schrijfstraat 105");
  assert.equal(typo[0].place.name, "Schijfstraat");
  assert.equal(typo[0].match, "fuzzy");
  assert.ok(searchPlaces(index, "Kammenstraat").every((r) => r.match !== "fuzzy"));
  assert.deepEqual(searchPlaces(index, "qqqqqq"), []);
  assert.deepEqual(searchPlaces(index, "   "), []);
});

test("andere districten krijgen uitleg in plaats van gegokte straten", () => {
  assert.equal(otherDistrictFor("berchem"), "Berchem");
  assert.equal(otherDistrictFor("Kammenstraat"), "");
});

test("plek in de URL: leesbaar, deelbaar en terug te lezen", () => {
  for (const value of ["Kammenstraat", "Zurenborg", "2060", "De Keyserlei 2018", "Historisch centrum"]) {
    const place = resolvePlaceParam(index, value);
    assert.ok(place, value);
    assert.equal(resolvePlaceParam(index, placeParam(place, index)), place);
  }
  assert.equal(placeParam(resolvePlaceParam(index, "kammenstraat"), index), "Kammenstraat");
  assert.equal(resolvePlaceParam(index, "wijk:Kiel").type, "wijk");
  assert.equal(resolvePlaceParam(index, "Kammen"), null); // deellink nooit als gok
  assert.equal(resolvePlaceParam(index, ""), null);
});

test("periodes, weken en maandrooster", () => {
  assert.deepEqual(periodRange("week", "2026-10-06"), { from: "2026-10-06", to: "2026-10-12" });
  assert.equal(startOfWeek("2026-10-11"), "2026-10-05");
  const weeks = monthWeeks("2026-10-01");
  assert.equal(weeks[0], "2026-09-28");
  assert.equal(weeks.at(-1), "2026-10-26");
  assert.equal(dayOf("2026-10-11T22:00:00Z"), "2026-10-12"); // Brusselse kalenderdag
  assert.equal(dayOf("2026-10-11"), "2026-10-11");
  assert.equal(overlaps({ start: "2026-10-01", end: "2026-10-20" }, "2026-10-05", "2026-10-11"), true);
  assert.equal(overlaps({ start: "2026-10-12" }, "2026-10-05", "2026-10-11"), false);
});

test("balken: een geplande werkperiode loopt over haar dagen en banen overlappen niet", () => {
  const work = { title: "Riolering", start: "2026-10-07", end: "2026-10-23" };
  const event = { title: "Buurtfeest", start: "2026-10-10" };
  const long = { title: "Heraanleg", start: "2026-09-01", end: "2026-12-01" };
  const week = layoutWeekBars([work, event, long], "2026-10-05");
  const bar = (title) => week.bars.find((b) => b.entry.title === title);
  assert.deepEqual([bar("Riolering").col, bar("Riolering").span, bar("Riolering").clippedEnd], [2, 5, true]);
  assert.deepEqual([bar("Heraanleg").col, bar("Heraanleg").span, bar("Heraanleg").clippedStart], [0, 7, true]);
  assert.equal(bar("Buurtfeest").span, 1);
  const lanes = new Set(week.bars.filter((b) => b.col <= 5 && b.col + b.span > 5).map((b) => b.lane));
  assert.equal(lanes.size, 3);
  const capped = layoutWeekBars([work, event, long], "2026-10-05", 1);
  assert.equal(capped.bars.length, 1);
  assert.equal(capped.overflow[5], 2);
});

test("lijst: nu bezig, per dag binnen de periode en later gepland", () => {
  const today = "2026-10-06";
  const entries = [
    { title: "Lopend werk", start: "2026-09-01", end: "2026-11-01" },
    { title: "Gepland werk", start: "2026-10-15", end: "2026-12-01" },
    { title: "Feest", start: "2026-10-10", time: "14:00" },
    { title: "Ver weg", start: "2027-03-01" },
    { title: "Voorbij", start: "2026-09-01", end: "2026-09-30" },
    { title: "Handmatig werk", start: "2026-08-03", openEnd: true },
  ];
  const { running, days, later } = groupForList(entries, { ...periodRange("maand", today), today });
  assert.deepEqual(running.map((e) => e.title), ["Lopend werk", "Handmatig werk"]);
  assert.deepEqual(days.map(([d, l]) => [d, l.map((e) => e.title)]), [["2026-10-10", ["Feest"]], ["2026-10-15", ["Gepland werk"]]]);
  assert.deepEqual(later.map((e) => e.title), ["Ver weg"]);
});

test("entries: agenda, GIPOD-werk en A-Sign in één vorm, zonder onveilige links", () => {
  const agenda = agendaEntry({ id: "x", title: "Expo", date: "2026-09-09", endDate: "2026-10-22", timeSlot: "Info", location: "CO Nova", link: "javascript:alert(1)", sourceUrl: "https://www.antwerpen.be/x" }, "culture");
  assert.equal(agenda.group, "evenementen");
  assert.equal(agenda.end, "2026-10-22");
  assert.equal(agenda.url, "https://www.antwerpen.be/x");
  const manual = agendaEntry({ id: "m", title: "Heraanleg", theme: "Werken", date: "2026-08-03", dateLabel: "3 augustus 2026 tot voorjaar 2027" }, "works");
  assert.equal(manual.openEnd, true);
  assert.equal(manual.group, "werken");
  const work = workEntry({ gipodId: 12, title: "Riolering", status: "Concreet gepland", start: "2026-10-14T22:00:00Z", end: "2026-11-30T22:00:00Z", streets: [{ name: "Kammenstraat" }], sourceUrls: ["https://gipod.api.vlaanderen.be/x"] });
  assert.deepEqual([work.start, work.end, work.location, work.group], ["2026-10-15", "2026-11-30", "Kammenstraat", "werken"]);
  // Een oudere bronlink naar het ruwe record (sourceUrls) telt niet: de bron van een werk is de datasetfiche.
  assert.equal(work.sourceUrl, "https://metadata.vlaanderen.be/srv/api/records/2b4b3bb7-cadc-41a0-b5ae-796a84a20b52");
  const sign = publicSpaceEntry({ id: "parking:1", kind: "parking", title: "Verhuis", start: "2026-10-09T22:00:00Z", end: "2026-10-10T21:59:00Z", streets: [{ name: "Kammenstraat" }] });
  assert.equal(sign.title, "Parkeerverbod voor een verhuis");
  const sum = summarize([agenda, { ...agenda, uid: "y" }, work, sign, manual], "2026-10-06");
  assert.equal(sum.evenementen, 1); // een reeks telt één keer
  assert.equal(sum.werkenGepland, 2);
  assert.equal(sum.werkenBezig, 1);
});

test("soortgroepen dekken elke soort precies één keer", () => {
  const all = KIND_GROUPS.flatMap((g) => g.themes);
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual([...new Set(all)].sort(), VIEW_THEMES.map(([key]) => key).sort());
  assert.deepEqual(themesForGroups(DEFAULT_GROUPS).sort(), [...DEFAULT_THEMES, "other"].sort().filter((k, i, a) => a.indexOf(k) === i));
  assert.deepEqual(groupsForThemes(["works", "admin"]), ["werken", "inspraak"]);
  assert.equal(groupOfTheme("publicSpace"), "werken");
});

test("plekfilter: postcode, straat en wijk via dezelfde filter voor alle lagen", () => {
  const kammen = { id: "1416", name: "Kammenstraat", postcode: "2000" };
  const view = createAgendaView();
  view.setArea({ postcode: "2000" });
  assert.equal(view.hasPlace, true);
  assert.equal(view.matches({ streets: [kammen] }, "works"), true);
  assert.equal(view.matches({ streets: [{ ...kammen, postcode: "2018" }] }, "works"), false);
  assert.equal(view.matches({ postcodes: ["2000"], location: "ergens" }, "works"), true);
  assert.equal(view.matches({ location: "onbekend" }, "works"), false); // nooit gokken
  view.setArea({ postcode: "" });
  assert.equal(view.hasPlace, false);
  // Een resolver (statische straatlijst of geocodering) koppelt vrije locatietekst.
  view.setResolver((address) => (/kammenstraat/i.test(address) ? [kammen] : []));
  view.setStreet("Kammenstraat", kammen);
  assert.equal(view.matchesAgenda({ title: "Braderie", eventType: "flea_braderie", location: "Kammenstraat 12" }), true);
  assert.equal(view.matchesAgenda({ title: "Braderie", eventType: "flea_braderie", location: "Meir 1" }), false);
  view.setArea({ postcode: "9999" });
  assert.equal(view.area.postcode, ""); // alleen geldige postcodes
});

// Herstelplan O10: de lege staat en de voortgang in korte, kloppende zinnen.
test("lege staat: geen lidwoord voor de straat, en 'gekozen soorten' alleen als de bewoner koos", () => {
  const straat = { type: "straat", label: "Rozemiekepad" };
  assert.equal(plekWaar(straat), "in Rozemiekepad");
  assert.equal(plekWaar({ type: "wijk", label: "Zurenborg" }), "in de wijk Zurenborg");
  assert.equal(plekWaar({ type: "postcode", code: "2060" }), "in postcode 2060");
  assert.equal(plekWaar(null), "in district Antwerpen");
  assert.equal(legeStaatTekst({ place: straat, gekozen: false, aantalSoorten: 6 }), "Er staat niets op de agenda voor deze straat.");
  assert.equal(legeStaatTekst({ place: { type: "wijk" }, gekozen: false, aantalSoorten: 6 }), "Er staat niets op de agenda voor deze wijk.");
  assert.equal(legeStaatTekst({ place: straat, gekozen: true, aantalSoorten: 2 }), "Binnen de gekozen soorten staat hier niets gepland.");
  assert.equal(legeStaatTekst({ place: straat, gekozen: true, aantalSoorten: 0 }), "Je hebt alle soorten uitgezet.");
});

test("voortgang: de tweede duur is de lengte van de periode", () => {
  assert.equal(voortgangTekst("2026-10-22", "2026-10-29", "2026-10-09"), "Start over 13 dagen · duurt 8 dagen");
  assert.equal(voortgangTekst("2026-10-10", "2026-10-11", "2026-10-09"), "Start over 1 dag · duurt 2 dagen");
  assert.equal(voortgangTekst("2026-10-07", "2026-10-14", "2026-10-09"), "Dag 3 van 8");
});

test("de komende 7 dagen: één zin met een verkeerslicht, uit dezelfde kaartjes als de lijst", () => {
  const vandaag = "2026-10-12"; // maandag
  const werk = (id, start, end, severe = false) => ({ ...workEntry({ gipodId: id, title: "Riolering", status: "In uitvoering", start, end, streets: [{ name: "Voorbeeldstraat" }] }), item: { gipodId: id, hindrance: severe ? { severe: true, consequences: [] } : null } });
  const parkeer = (id, start, end) => publicSpaceEntry({ id: `parking:${id}`, kind: "parking", title: "Verhuis", start, end, streets: [{ name: "Voorbeeldstraat" }] });
  const feest = (id, date, endDate = date) => agendaEntry({ id, title: `Buurtfeest ${id}`, date, endDate, location: "Voorbeeldplein" }, "culture");

  assert.deepEqual(dezeWeek([], vandaag), { licht: "rustig", zin: "De komende 7 dagen in jouw straat: rustig. Geen werken, parkeerverboden of evenementen gepland." });
  // Niet alles geladen: nooit "rustig".
  assert.equal(dezeWeek([], vandaag, { onvolledig: true }).licht, "onbekend");
  assert.doesNotMatch(dezeWeek([], vandaag, { onvolledig: true }).zin, /rustig\./);
  assert.equal(dezeWeek([], "").licht, "onbekend");

  const week = dezeWeek([werk(1, "2026-10-01", "2026-11-30"), werk(2, "2026-10-14", "2026-10-20"), parkeer(1, "2026-10-14T06:00:00Z", "2026-10-14T16:00:00Z"), feest("a", "2026-10-17"), feest("b", "2026-10-13")], vandaag);
  assert.equal(week.licht, "let-op");
  assert.equal(week.zin, "De komende 7 dagen in jouw straat: 2 werken (1 loopt al), 1 parkeerverbod (vanaf wo 14 okt) en 2 evenementen (eerste morgen).");

  // Ernstige hinder kleurt rood; het aantal staat erbij.
  const hinder = dezeWeek([werk(3, "2026-10-12", "2026-10-30", true), werk(4, "2026-10-12", "2026-10-30")], vandaag);
  assert.equal(hinder.licht, "hinder");
  assert.match(hinder.zin, /2 werken \(1 met ernstige hinder, vanaf vandaag\)/);

  // Buiten de zeven dagen telt niet: voorbij zondag, of al afgelopen.
  assert.equal(dezeWeek([werk(5, "2026-10-19", "2026-10-25"), feest("c", "2026-10-11"), parkeer(2, "2026-10-01", "2026-10-05")], vandaag).licht, "rustig");
  // Een reeks (elke dinsdag) telt één keer, net als in summarize.
  const reeks = [feest("d", "2026-10-13"), { ...feest("d", "2026-10-13"), uid: "d2" }];
  assert.match(dezeWeek(reeks, vandaag).zin, /1 evenement \(morgen\)/);
  // Parkeerverbod vandaag, en een andere plek in de zin.
  assert.match(dezeWeek([parkeer(3, "2026-10-12", "2026-10-12")], vandaag, { waar: "in Zurenborg" }).zin, /^De komende 7 dagen in Zurenborg: 1 parkeerverbod \(vanaf vandaag\)\.$/);
  // Iets gevonden maar niet alles geladen: alleen wat gevonden is, zonder te zeggen dat iets niet laadde (besluit van
  // 18-10-2026).
  assert.equal(dezeWeek([werk(6, "2026-10-12", "2026-10-13")], vandaag, { onvolledig: true }).zin, "De komende 7 dagen in jouw straat: 1 werk (vanaf vandaag).");
  for (const licht of ["rustig", "let-op", "hinder", "onbekend"]) assert.ok(WEEK_LICHT[licht]);
});

// Nakijkbevinding (reeks): twee voorkomens met verschillende datums, in aflopende volgorde. De zin
// noemt het vroegste, niet het eerst geziene.
test("de komende 7 dagen: een reeks noemt haar vroegste dag, ook in aflopende volgorde", () => {
  const vandaag = "2026-10-12";
  const feest = (id, date) => agendaEntry({ id, title: "Buurtfeest", date, location: "Voorbeeldplein" }, "culture");
  assert.equal(dezeWeek([feest("r2", "2026-10-16"), feest("r1", "2026-10-13")], vandaag).zin, "De komende 7 dagen in jouw straat: 1 evenement (morgen).");
  const anderFeest = agendaEntry({ id: "z", title: "Rommelmarkt", date: "2026-10-14", location: "Voorbeeldplein" }, "flea");
  assert.match(dezeWeek([feest("r2", "2026-10-16"), anderFeest, feest("r1", "2026-10-13")], vandaag).zin, /2 evenementen \(eerste morgen\)/);
});

// Nakijkbevinding (opbouw en afbraak): een evenement op straat telt met zijn innameperiode, zoals de lijst.
test("de komende 7 dagen: opbouw en afbraak van een evenement op straat tellen mee", () => {
  const vandaag = "2026-10-12"; // maandag
  let n = 0;
  const rij = (dossier, phase, type, start, end) => ({
    id: `iod:${dossier}|${phase}|${(n += 1)}`, kind: "iod", title: type, innameType: type, reference: dossier, dossierType: "ETL",
    phase, hindrance: "True", description: "", start, end, status: "aanvraag_goedgekeurd",
    streets: [{ id: `p${n}`, name: "Proefstraat", postcode: "2000" }], sourceUrl: "https://geodata.antwerpen.be/x",
  });
  const opties = { vandaag, straat: "Proefstraat", wijkVan: () => "" };
  // Het evenement is pas op za 24 okt, maar het parkeerverbod voor de opbouw geldt vanaf vr 16 okt.
  const opbouw = publicSpaceEntries([
    rij("ET2099000101", "Opbouw", "Parkeerverbod in Straat", "2026-10-16", "2026-10-23"),
    rij("ET2099000101", "Evenement", "Parcours", "2026-10-24", "2026-10-24"),
    rij("ET2099000101", "Afbraak", "Parkeerverbod in Straat", "2026-10-25", "2026-10-25"),
  ], opties);
  const metOpbouw = dezeWeek(opbouw, vandaag);
  assert.equal(metOpbouw.licht, "let-op");
  assert.equal(metOpbouw.zin, "De komende 7 dagen in jouw straat: opbouw voor 1 evenement (vanaf vr 16 okt).");
  // Het evenement was gisteren; de afbraak (een parkeerverbod) loopt tot en met morgen.
  const afbraak = publicSpaceEntries([
    rij("ET2099000102", "Evenement", "Parcours", "2026-10-11", "2026-10-11"),
    rij("ET2099000102", "Afbraak", "Parkeerverbod in Straat", "2026-10-12", "2026-10-13"),
  ], opties);
  const metAfbraak = dezeWeek(afbraak, vandaag);
  assert.equal(metAfbraak.licht, "let-op");
  assert.equal(metAfbraak.zin, "De komende 7 dagen in jouw straat: afbraak na 1 evenement (tot en met morgen).");
  // Valt de dag van het evenement zelf in het venster, dan die dag, en (nakijkbevinding, frisse ogen) ook de
  // opbouw die al loopt en de afbraak erna: de straat merkt meer dan alleen zaterdag.
  assert.equal(dezeWeek(opbouw, "2026-10-20").zin, "De komende 7 dagen in jouw straat: 1 evenement (za 24 okt, opbouw loopt al, afbraak tot en met zo 25 okt).");
});

// Nakijkbevinding (frisse ogen): de weekzin verzweeg de opbouw zodra de evenementdag ook in de 7 dagen viel.
// Maandag 12 okt: een parkeerverbod voor de opbouw van 12 tot 16 okt, het parcours op za 17 okt.
test("de komende 7 dagen: opbouw en evenementdag samen in het venster, dan staan ze er allebei", () => {
  const vandaag = "2026-10-12";
  let n = 0;
  const rij = (phase, type, start, end) => ({
    id: `iod:ET2099000103|${phase}|${(n += 1)}`, kind: "iod", title: type, innameType: type, reference: "ET2099000103", dossierType: "ETL",
    phase, hindrance: "True", description: "", start, end, status: "aanvraag_goedgekeurd",
    streets: [{ id: `p${n}`, name: "Proefstraat", postcode: "2000" }], sourceUrl: "https://geodata.antwerpen.be/x",
  });
  const opties = { vandaag, straat: "Proefstraat", wijkVan: () => "" };
  const kaarten = publicSpaceEntries([rij("Opbouw", "Parkeerverbod in Straat", "2026-10-12", "2026-10-16"), rij("Evenement", "Parcours", "2026-10-17", "2026-10-17")], opties);
  assert.equal(dezeWeek(kaarten, vandaag).zin, "De komende 7 dagen in jouw straat: 1 evenement (za 17 okt, opbouw vanaf vandaag).");
  // De opbouw begint morgen: "vanaf morgen".
  assert.equal(dezeWeek(kaarten, "2026-10-11").zin, "De komende 7 dagen in jouw straat: 1 evenement (za 17 okt, opbouw vanaf morgen).");
  // Zonder opbouw of afbraak in het venster blijft de zin zoals hij was.
  const zonder = publicSpaceEntries([rij("Evenement", "Parcours", "2026-10-15", "2026-10-15")], opties);
  assert.equal(dezeWeek(zonder, vandaag).zin, "De komende 7 dagen in jouw straat: 1 evenement (do 15 okt).");
});

// Nakijkbevinding (weekzin, werfzone): een werfzone met fasen en een gat ertussen telde als "1 werk (loopt al)"
// in een week zonder fase. Verzonnen dossier, twee sgw-rijen met dezelfde referentie.
test("de komende 7 dagen: een werfzone telt alleen als een fase in het venster valt", () => {
  const sgw = (id, start, end) => ({ id: `sgw:${id}`, kind: "sgw", kindLabel: "Werfzone", title: "Werfzone", reference: "SGW_2099_0001", start: `${start}T00:00:00.000Z`, end: `${end}T00:00:00.000Z`, status: "vergund", streets: [{ name: "Proefstraat", postcode: "2000" }] });
  const metGat = publicSpaceEntries([sgw(1, "2026-10-01", "2026-10-05"), sgw(2, "2026-10-20", "2026-10-30")], { vandaag: "2026-10-12", straat: "Proefstraat" });
  assert.equal(metGat.length, 1);
  assert.deepEqual(metGat[0].fasen, [["2026-10-01", "2026-10-05"], ["2026-10-20", "2026-10-30"]]);
  // Vandaag 12 okt: de komende 7 dagen (12–18 okt) vallen in het gat.
  assert.deepEqual(dezeWeek(metGat, "2026-10-12"), { licht: "rustig", zin: "De komende 7 dagen in jouw straat: rustig. Geen werken, parkeerverboden of evenementen gepland." });
  // Vandaag 17 okt: de tweede fase begint over 3 dagen.
  assert.equal(dezeWeek(metGat, "2026-10-17").zin, "De komende 7 dagen in jouw straat: 1 werk (vanaf di 20 okt).");
  // Vandaag 3 okt: de eerste fase loopt al.
  assert.equal(dezeWeek(metGat, "2026-10-03").zin, "De komende 7 dagen in jouw straat: 1 werk (loopt al).");
});

// Nakijkbevinding (losse dagen en jaartoelatingen): alleen een echte dag in het venster telt, met die dag.
test("de komende 7 dagen: losse dagen en een toelating van een jaar zijn geen evenement van vandaag", () => {
  const vandaag = "2026-10-12"; // maandag
  const dossier = (id, start, end, losseDagen = []) => ({ uid: `publicSpace:dossier:${id}`, id, source: "publicSpace", group: "evenementen", title: "Proefevenement", start, end, losseDagen, item: { kind: "event" } });
  // Losse dagen op 5 okt en 2 nov: deze week gebeurt er niets.
  assert.equal(dezeWeek([dossier("ET1", "2026-10-05", "2026-11-02", ["2026-10-05", "2026-11-02"])], vandaag).licht, "rustig");
  // Elke woensdag: de woensdag van deze week, niet "vandaag".
  assert.equal(dezeWeek([dossier("ET2", "2026-10-07", "2026-10-28", ["2026-10-07", "2026-10-14", "2026-10-21", "2026-10-28"])], vandaag).zin, "De komende 7 dagen in jouw straat: 1 evenement (wo 14 okt).");
  // Een toelating voor heel 2026: loopt door, geen "1 evenement (vandaag)".
  const jaar = dezeWeek([dossier("ET3", "2026-01-01", "2026-12-31")], vandaag);
  assert.equal(jaar.zin, "De komende 7 dagen in jouw straat: 1 doorlopend evenement (loopt al).");
  assert.doesNotMatch(jaar.zin, /vandaag/);
});

// Nakijkbevinding (ernstige hinder): een werf in stukken wordt één kaart; ernstige hinder bij één stuk
// telt, in welke volgorde GIPOD de stukken ook geeft.
test("de komende 7 dagen: ernstige hinder bij een werf in stukken hangt niet af van de volgorde", () => {
  const vandaag = "2026-10-12";
  const stuk = (id, severe) => ({ gipodId: id, title: "Riolering", status: "In uitvoering", owner: "Proefbeheerder", start: "2026-10-12", end: "2026-10-30", streets: [{ name: "Proefstraat" }], hindrance: { severe, consequences: ["Rijbaanversmalling"] } });
  for (const stukken of [[stuk(101, false), stuk(102, true)], [stuk(102, true), stuk(101, false)]]) {
    const kaarten = werkEntries(stukken);
    assert.equal(kaarten.length, 1);
    assert.equal(kaarten[0].ernstig, true);
    assert.deepEqual(dezeWeek(kaarten, vandaag), { licht: "hinder", zin: "De komende 7 dagen in jouw straat: 1 werk (met ernstige hinder, vanaf vandaag)." });
    // Nakijkbevinding (frisse ogen): de kaart zegt het ook, in beide volgordes (info zonder uitleg, en de uitleg).
    assert.match(kaarten[0].info, /Ernstige hinder/, kaarten[0].info);
    const metUitleg = werkEntries(stukken, { vandaag })[0];
    const regels = metUitleg.uitleg.regels.map(([dt, dd]) => `${dt}: ${dd}`).join(" | ");
    assert.match(regels, /ernstige hinder/i, regels);
    assert.ok(metUitleg.uitleg.regels.some(([dt, dd]) => dt === "Ernstige hinder" && dd === "bij 1 van de 2 stukken, volgens GIPOD"), regels);
  }
  // Allebei ernstig: geen regel "bij 2 van de 2".
  const beide = werkEntries([stuk(103, true), stuk(104, true)], { vandaag })[0];
  assert.ok(!beide.uitleg.regels.some(([dt]) => dt === "Ernstige hinder"));
  assert.equal(beide.info.match(/Ernstige hinder/g)?.length, 1, beide.info);
});

// Nakijkbevinding ("vanaf vandaag"): alleen als het vandaag begint; wat al eerder begon, "loopt al".
test("de komende 7 dagen: een parkeerverbod dat al eerder begon, loopt al", () => {
  const vandaag = "2026-10-11";
  const parkeer = (id, start, end) => publicSpaceEntry({ id: `parking:${id}`, kind: "parking", title: "Verhuis", start, end, streets: [{ name: "Voorbeeldstraat" }] });
  assert.equal(dezeWeek([parkeer(1, "2026-10-05", "2026-10-14")], vandaag).zin, "De komende 7 dagen in jouw straat: 1 parkeerverbod (loopt al).");
  assert.equal(dezeWeek([parkeer(2, "2026-10-11", "2026-10-14")], vandaag).zin, "De komende 7 dagen in jouw straat: 1 parkeerverbod (vanaf vandaag).");
  assert.equal(dezeWeek([parkeer(1, "2026-10-05", "2026-10-14"), parkeer(3, "2026-10-13", "2026-10-13")], vandaag).zin, "De komende 7 dagen in jouw straat: 2 parkeerverboden (1 loopt al).");
});

// Nakijkbevinding (venster): het zijn de komende 7 dagen, geen kalenderweek; een werk dat nog moet
// beginnen krijgt zijn datum.
test("de komende 7 dagen: de zin zegt dat het 7 dagen zijn, en een werk dat later begint krijgt een datum", () => {
  const werkLater = workEntry({ gipodId: 7, title: "Riolering", status: "Concreet gepland", start: "2026-10-21", end: "2026-11-30" });
  // Zondag 18 okt: het werk begint woensdag 21 okt, in de volgende kalenderweek.
  assert.equal(dezeWeek([werkLater], "2026-10-18").zin, "De komende 7 dagen in jouw straat: 1 werk (vanaf wo 21 okt).");
  assert.doesNotMatch(dezeWeek([werkLater], "2026-10-18").zin, /^Deze week/);
});

// Nakijkbevinding (soortkeuze): een laag die de zin nodig heeft en die uit staat of niet geladen is, maakt
// de zin nooit "rustig".
test("de komende 7 dagen: staat een laag uit of is ze niet geladen, dan nooit 'rustig'", () => {
  const vandaag = "2026-10-12";
  const uit = [{ wat: "werken", uit: true, geladen: false }];
  const leeg = dezeWeek([], vandaag, { onbekend: uit });
  assert.equal(leeg.licht, "onbekend");
  assert.equal(leeg.zin, "De komende 7 dagen in jouw straat: niets gevonden, maar werken staan uit. Of het rustig is, weten we dus niet.");
  assert.doesNotMatch(leeg.zin, /rustig\.|Geen werken/);
  // Niet geladen zonder dat de bezoeker ze uit zette: nooit "rustig", maar ook geen reden (besluit van 18-10-2026). Niets
  // gevonden zonder betrouwbare stand: geen weekzin (nakijkronde 3: "Onbekend … niets gevonden." verraadde de fout).
  const nietGeladen = dezeWeek([], vandaag, { onbekend: [{ wat: "parkeerverboden", uit: false, geladen: false }, { wat: "evenementen op straat", uit: false, geladen: false }] });
  assert.deepEqual(nietGeladen, { licht: "onbekend", zin: "" });
  // Iets gevonden: dat staat er, met wat uit staat en daarom niet geladen is.
  const feest = agendaEntry({ id: "f", title: "Buurtfeest", date: "2026-10-16", location: "Voorbeeldplein" }, "culture");
  assert.equal(dezeWeek([feest], vandaag, { onbekend: uit }).zin, "De komende 7 dagen in jouw straat: 1 evenement (vr 16 okt). Werken zijn niet geladen.");
  // Uit maar wel geladen: wat er is, telt gewoon mee (geen "niet geladen").
  assert.equal(dezeWeek([feest], vandaag, { onbekend: [{ wat: "werken", uit: true, geladen: true }] }).zin, "De komende 7 dagen in jouw straat: 1 evenement (vr 16 okt).");
});

// Nakijkbevinding (weekzin): een laag die uit staat maar volledig geladen is, is nagekeken. Een lege week is dan
// "rustig", met alle soorten aan of niet: de zin hing anders van de chips af.
test("de komende 7 dagen: een laag die uit staat maar geladen is, maakt een lege week niet 'onbekend'", () => {
  const vandaag = "2026-10-12";
  assert.equal(dezeWeek([], vandaag, { onbekend: [{ wat: "werken", uit: true, geladen: true }] }).licht, "rustig");
  const allesUit = ["werken", "parkeerverboden", "evenementen op straat"].map((wat) => ({ wat, uit: true, geladen: true }));
  assert.deepEqual(dezeWeek([], vandaag, { onbekend: allesUit }), dezeWeek([], vandaag));
  // Niet geladen: wel "onbekend".
  assert.equal(dezeWeek([], vandaag, { onbekend: [{ wat: "werken", uit: true, geladen: false }] }).licht, "onbekend");
});

// Nakijkbevinding (weekzin): een werkenlaag die deels mislukte terwijl werken uit staan, telde als geladen. Sinds het
// besluit van 18-10-2026 zegt de zin niet meer dat ze maar deels laadde; "rustig" wordt ze nog altijd nooit.
test("de komende 7 dagen: een laag die maar deels laadde, is nooit 'rustig', zonder te zeggen waarom", () => {
  const vandaag = "2026-10-12";
  const deels = [{ wat: "werken", uit: true, geladen: false, deels: true }];
  const feest = agendaEntry({ id: "f", title: "Buurtfeest", date: "2026-10-16", location: "Voorbeeldplein" }, "culture");
  assert.equal(dezeWeek([feest], vandaag, { onbekend: deels }).zin, "De komende 7 dagen in jouw straat: 1 evenement (vr 16 okt).");
  const leeg = dezeWeek([], vandaag, { onbekend: deels });
  assert.notEqual(leeg.licht, "rustig");
  assert.equal(leeg.zin, "", "niets gevonden zonder betrouwbare stand: geen weekzin");
});
