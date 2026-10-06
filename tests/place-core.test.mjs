import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  foldText, parseQuery, editDistance, buildPlaceIndex, searchPlaces, otherDistrictFor, placeParam, resolvePlaceParam,
  periodRange, monthWeeks, startOfWeek, layoutWeekBars, groupForList, overlaps, dayOf,
  agendaEntry, workEntry, publicSpaceEntry, summarize, KIND_GROUPS, DEFAULT_GROUPS, themesForGroups, groupsForThemes, groupOfTheme,
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
  assert.deepEqual(parseQuery("Kammenstr. 12"), { text: "kammenstraat", compact: "kammenstraat", postcode: "" });
  assert.deepEqual(parseQuery("Gaston Burssenslaan 12 bus 3, 2050 Antwerpen"), { text: "gaston burssenslaan", compact: "gastonburssenslaan", postcode: "2050" });
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
  const sign = publicSpaceEntry({ id: "parking:1", kind: "parking", title: "Verhuis", start: "2026-10-09T22:00:00Z", end: "2026-10-10T21:59:00Z", streets: [{ name: "Kammenstraat" }] });
  assert.equal(sign.title, "Parkeerverbod: Verhuis");
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
