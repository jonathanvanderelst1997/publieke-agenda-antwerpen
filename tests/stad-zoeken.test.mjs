// Zoeken in heel de stad (bouwplan stap 3): de straatnamen van de 9 andere districten (site/geo/straten-stad.json),
// de zoekbalk die naamgenoten toont en met Enter nooit gokt, en wat de site in een ander district wel kent.
// De 15 zoekopdrachten die in de stratentest van 12 oktober 2026 mislukten, staan hier als toets.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { buildPlaceIndex, searchPlaces, enterKeuze, placeParam, resolvePlaceParam } from "../site/place-core.js";
import { stadPlaces, zoekIndex, zoekOveral, buitenParam, resolveBuiten, naamgenoten, watDeSiteKent, districtVanMarkt } from "../site/stad-zoeken.js";
import { bouwStadStraten, districtenTabel, districtVan, districtUitPostcodes, postcodeUitAdres, schoneNaam, BRONNEN } from "../scripts/build-straten-stad.mjs";
import { wijkFeatures, bboxOf } from "../site/neighborhood-core.js";
import { DISTRICT_CHANNELS } from "../lib/district-channels.mjs";

const lees = (rel) => JSON.parse(fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8"));
const straten = lees("site/geo/straten.json");
const stadDoc = lees("site/geo/straten-stad.json");
const wijken = wijkFeatures(lees("site/geo/wijken.geo.json")).filter((f) => f.properties.code.startsWith("ANT")).map((f) => ({ code: f.properties.code, naam: f.properties.naam, box: bboxOf(f.geometry) }));
const districtIndex = buildPlaceIndex({ streets: straten.streets, wijken });
const index = zoekIndex(districtIndex, stadDoc);
const wat = (place) => (place.type === "buiten" ? `${place.name}|${place.district.label}|${place.postcode}` : place.type === "straat" ? `${place.label}|Antwerpen|${place.postcode}` : `${place.type}:${place.label}`);

test("straten-stad.json: alleen naam, district en postcode, met bron en licentie", () => {
  assert.deepEqual(Object.keys(stadDoc).sort(), ["districten", "metadata", "schemaVersion", "straten"]);
  assert.equal(stadDoc.schemaVersion, 1);
  const m = stadDoc.metadata;
  assert.deepEqual(m.fields, ["naam", "district (index in districten)", "postcode"]);
  assert.match(m.retrievedOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(m.bronnen.map((b) => b.sleutel), ["as", "register"]);
  for (const b of m.bronnen) {
    assert.match(b.url, /^https:\/\//);
    assert.match(b.licentieUrl, /^https:\/\//);
    assert.ok(b.licentie && b.bronvermelding);
  }
  assert.match(m.bronnen[0].licentie, /Gratis Open Data Licentie/);
  assert.equal(m.bronnen[0].bronvermelding, "bron stad Antwerpen");
  assert.match(m.bronnen[1].licentie, /Modellicentie voor gratis hergebruik/);
  // De 9 andere districten (Borsbeek sinds 2025), met hun pagina op antwerpen.be.
  assert.deepEqual(stadDoc.districten.map((d) => d.label), DISTRICT_CHANNELS.map((c) => c.label));
  for (const d of stadDoc.districten) assert.match(d.url, /^https:\/\/www\.antwerpen\.be\/nl\/overzicht\/district-/);
  // Elke rij: [naam, district, postcode van dat district]; nooit een postcode van district Antwerpen.
  const gezien = new Set();
  for (const rij of stadDoc.straten) {
    assert.equal(rij.length, 3);
    const [naam, i, postcode] = rij;
    assert.ok(typeof naam === "string" && /[A-Za-zÀ-ÿ]/.test(naam) && naam === naam.trim(), naam);
    assert.doesNotMatch(naam, /_[A-Z]{2}$/, `homoniemtoevoeging in ${naam}`);
    assert.ok(stadDoc.districten[i], `district ${i}`);
    assert.ok(stadDoc.districten[i].postcodes.includes(postcode), `${naam}: ${postcode}`);
    assert.ok(!["2000", "2018", "2020", "2030", "2050", "2060"].includes(postcode));
    const key = rij.join("|");
    assert.ok(!gezien.has(key), `dubbel: ${key}`);
    gezien.add(key);
  }
  assert.ok(stadDoc.straten.length > 2000, `${stadDoc.straten.length} straten`);
  for (let i = 0; i < stadDoc.districten.length; i += 1) assert.ok(stadDoc.straten.filter((r) => r[1] === i).length >= 100, stadDoc.districten[i].label);
  // Klein genoeg om pas bij het typen te laden.
  assert.ok(fs.statSync(new URL("../site/geo/straten-stad.json", import.meta.url)).size < 100_000);
});

// De stratentest van 12 oktober 2026 (plan 2, result.sw): 15 zoekopdrachten in andere districten, geen enkele gaf de
// juiste straat. Nu: één straat → die opent (met de uitleg), meer naamgenoten → een keuze met alle naamgenoten.
const STRATENTEST = [
  ["De Villegasstraat", ["De Villegasstraat|Berchem|2600"]],
  ["Walemstraat", ["Walemstraat|Berchem|2600"]],
  ["Turnhoutsebaan", ["Turnhoutsebaan|Deurne|2100", "Turnhoutsebaan|Borgerhout|2140"]],
  ["Vosstraat", ["Vosstraat|Deurne|2100", "Vosstraat|Borgerhout|2140", "Vosstraat|Berchem|2600"]],
  ["Generaal De Wetstraat", ["Generaal De Wetstraat|Borgerhout|2140"]],
  ["Herentalsebaan", ["Herentalsebaan|Deurne|2100", "Herentalsebaan|Borgerhout|2140", "Herentalsebaan|Borsbeek|2150"]],
  ["Arenaplein", ["Arenaplein|Deurne|2100"]],
  ["Bist", ["Bist|Ekeren|2180", "Bist|Wilrijk|2610"]],
  ["Boomsesteenweg", ["Boomsesteenweg|Antwerpen|2020", "Boomsesteenweg|Wilrijk|2610"]],
  ["Kioskplaats", ["Kioskplaats|Hoboken|2660"]],
  ["Sint-Bernardsesteenweg", ["Sint-Bernardsesteenweg|Antwerpen|2020", "Sint-Bernardsesteenweg|Hoboken|2660"]],
  ["Statiestraat", ["Statiestraat|Antwerpen|2018", "Statiestraat|Ekeren|2180", "Statiestraat|Berchem|2600"]],
  ["Bredabaan", ["Bredabaan|Merksem|2170"]],
  ["Kristus-Koningplein", ["Kristus-Koningplein|Ekeren|2180"]],
  ["Botermarkt", ["Botermarkt|Berendrecht-Zandvliet-Lillo|2040"]],
];

test("stratentest: de 15 mislukte zoekopdrachten vinden hun straat, met alle naamgenoten", () => {
  assert.equal(STRATENTEST.length, 15);
  for (const [vraag, verwacht] of STRATENTEST) {
    const res = zoekOveral(index, vraag);
    const exact = res.filter((r) => r.match === "exact").map((r) => wat(r.place));
    assert.deepEqual(exact.sort(), [...verwacht].sort(), vraag);
    const keuze = enterKeuze(res);
    if (verwacht.length === 1) assert.equal(wat(keuze.place), verwacht[0], `${vraag}: Enter opent de straat`);
    else assert.deepEqual([keuze.keuze, keuze.n], ["naamgenoten", verwacht.length], `${vraag}: Enter laat kiezen`);
    // Een straat van district Antwerpen met dezelfde naam staat eerst (die volgt deze agenda).
    if (verwacht[0].includes("|Antwerpen|")) assert.equal(res[0].place.type, "straat", vraag);
  }
  // Wat er vroeger misging: Enter opende de Walenstraat en de Gasstraat (tikfout), of de Statiestraat van 2018.
  for (const vraag of ["Walemstraat", "Vosstraat"]) assert.ok(!zoekOveral(index, vraag).some((r) => /Walenstraat|Gasstraat/.test(r.place.name)), vraag);
});

test("Enter opent nooit een gok", () => {
  const p = (name, extra = {}) => ({ type: "straat", label: name, name, postcode: "2000", sub: "2000", ...extra });
  // Alleen tikfouten: niets openen.
  assert.deepEqual(enterKeuze([{ place: p("Walenstraat"), match: "fuzzy" }]), { keuze: "gok", n: 1 });
  assert.deepEqual(enterKeuze(searchPlaces(districtIndex, "Walemstraat")).keuze, "gok", "zonder de lijst van de stad: geen Walenstraat");
  assert.deepEqual(enterKeuze(zoekOveral(index, "schrijfstraat")).keuze, "gok");
  // Zelf gekozen met de pijltjes: wel.
  assert.equal(enterKeuze([{ place: p("Walenstraat"), match: "fuzzy" }], { actief: 0, gekozen: true }).place.name, "Walenstraat");
  // Eén exacte, of één enkele suggestie die geen tikfout is.
  assert.equal(enterKeuze(zoekOveral(index, "Kammenstraat")).place.name, "Kammenstraat");
  assert.equal(enterKeuze(zoekOveral(index, "kammenstr. 12")).place.name, "Kammenstraat");
  assert.equal(enterKeuze(zoekOveral(index, "2060")).place.code, "2060");
  // Meer die half passen: kiezen.
  assert.equal(enterKeuze([{ place: p("Kammenstraat"), match: "prefix" }, { place: p("Kammenpoort"), match: "prefix" }]).keuze, "meerdere");
  // Naamgenoten in district Antwerpen zelf (twee postcodes): kiezen; twee ids die voor de bewoner gelijk zijn: openen.
  assert.equal(enterKeuze(zoekOveral(index, "De Keyserlei")).keuze, "naamgenoten");
  assert.equal(enterKeuze([{ place: p("Kempischplein", { id: "1" }), match: "exact" }, { place: p("Kempischplein", { id: "2" }), match: "exact" }]).place.id, "1");
  assert.deepEqual(enterKeuze([]), { keuze: "niets", n: 0 });
});

test("zoeken in heel de stad: district in de vraag, postcode, districtsnaam en volgorde", () => {
  assert.deepEqual(zoekOveral(index, "Statiestraat Berchem").map((r) => wat(r.place)), ["Statiestraat|Berchem|2600"]);
  assert.deepEqual(zoekOveral(index, "Statiestraat, 2180 Antwerpen").map((r) => wat(r.place)), ["Statiestraat|Ekeren|2180"]);
  assert.deepEqual(zoekOveral(index, "Wilrijk Bist").filter((r) => r.match === "exact").map((r) => wat(r.place)), ["Bist|Wilrijk|2610"]);
  assert.equal(wat(zoekOveral(index, "2600")[0].place), "district:District Berchem");
  assert.equal(wat(zoekOveral(index, "Zandvliet")[0].place), "district:District Berendrecht-Zandvliet-Lillo");
  assert.equal(wat(enterKeuze(zoekOveral(index, "Borsbeek")).place), "district:District Borsbeek");
  // Een straat van district Antwerpen blijft gewoon vooraan, ook met de rest van de stad erbij.
  assert.equal(zoekOveral(index, "Kammenstraat")[0].place.type, "straat");
  assert.equal(zoekOveral(index, "Zurenborg")[0].place.type, "wijk");
  assert.equal(zoekOveral(index, "2060")[0].place.type, "postcode");
  // Homoniemtoevoeging van de bron ("Turnhoutsebaan_DE") staat niet bij de straten van de andere districten.
  assert.ok(!index.places.some((p) => p.type === "buiten" && /_[A-Z]{2}$/.test(p.name)));
});

test("plek in de URL buiten district Antwerpen: altijd met postcode, één exacte plek of niets", () => {
  const bist = index.places.find((p) => p.type === "buiten" && p.name === "Bist" && p.postcode === "2610");
  assert.equal(buitenParam(bist), "Bist 2610");
  assert.equal(resolveBuiten(index, "Bist 2610"), bist);
  assert.equal(resolveBuiten(index, buitenParam(bist)), bist);
  assert.equal(resolveBuiten(index, "Bist"), null, "twee naamgenoten: de bewoner kiest");
  assert.equal(resolveBuiten(index, "Bredabaan").district.label, "Merksem");
  assert.equal(resolveBuiten(index, "district:Berchem").type, "district");
  assert.equal(buitenParam(resolveBuiten(index, "district:berchem")), "district:Berchem");
  assert.equal(resolveBuiten(index, "Kammenstraat"), null, "een straat van district Antwerpen is geen plek buiten het district");
  const stat = index.places.find((p) => p.type === "buiten" && p.name === "Statiestraat" && p.postcode === "2600");
  const g = naamgenoten(index, stat);
  assert.deepEqual(g.district.map((p) => `${p.name} ${p.postcode}`), ["Statiestraat 2018"]);
  assert.deepEqual(g.buiten.map((p) => `${p.name} ${p.postcode}`), ["Statiestraat 2180"]);
});

// Nakijkronde van 12 oktober 2026 (drie bevindingen, nagespeeld in Chromium).
// 1. Een tikfout in een straat van district Antwerpen die toevallig midden in een straatnaam van een ander district zit
//    ("Stenplein" in het Kunstenplein van Berchem): Enter opende die straat, en de bedoelde straat stond niet meer in
//    de lijst. Een "bevat" is een gok: Enter opent hem niet, en de tikfouten komen erbij, de straat van district
//    Antwerpen vooraan.
const TIKFOUTEN = [
  ["Stenplein", "Steenplein"], ["Pijstraat", "Pijlstraat"], ["Kistraat", "Keistraat"], ["Singl", "Singel"],
  ["Rckmansstraat", "Ryckmansstraat"], ["Giestraat", "Gierstraat"], ["Lmastraat", "Limastraat"], ["Nsestraat", "Nosestraat"],
  ["Besstraat", "Bresstraat"], ["Gststraat", "Giststraat"], ["Ogelstraat", "Orgelstraat"], ["Remstraat", "Riemstraat"], ["Wegstraat", "Wiegstraat"],
];
test("nakijkronde 1: een tikfout die midden in een straat van een ander district zit, opent die straat niet", () => {
  for (const [vraag, bedoeld] of TIKFOUTEN) {
    const res = zoekOveral(index, vraag);
    assert.ok(!res.some((r) => ["exact", "prefix", "word"].includes(r.match)), `${vraag}: niets past zeker`);
    assert.deepEqual(enterKeuze(res).keuze, "gok", `${vraag}: Enter opent geen gok (${res.map((r) => wat(r.place)).join(", ")})`);
    // De bedoelde straat van district Antwerpen staat erbij, vóór alles van de andere districten.
    const lijst = res.map((r) => `${wat(r.place)} ${r.match}`).join(", ");
    const i = res.findIndex((r) => r.place.type === "straat" && r.place.label === bedoeld);
    assert.ok(i >= 0, `${vraag}: ${lijst}`);
    assert.equal(res[i].match, "fuzzy");
    assert.ok(res.slice(0, i).every((r) => r.place.type === "straat" && r.match === "fuzzy"), `${vraag}: ${lijst}`);
  }
  // Wat de lijst vroeger als enige gaf, staat er nog bij (maar Enter opent het niet).
  assert.ok(zoekOveral(index, "Stenplein").some((r) => r.match === "contains" && wat(r.place) === "Kunstenplein|Berchem|2600"));
  assert.ok(!zoekOveral(index, "Pijstraat").slice(0, 1).some((r) => r.place.name === "Maatschappijstraat"));
  // Eén enkele "bevat" is ook een gok; één "begint met" of "woord" niet.
  const p = (name) => ({ type: "buiten", label: name, name, postcode: "2600", sub: "2600" });
  assert.deepEqual(enterKeuze([{ place: p("Kunstenplein"), match: "contains" }]), { keuze: "gok", n: 1 });
  assert.equal(enterKeuze([{ place: p("Kunstenplein"), match: "prefix" }]).place.name, "Kunstenplein");
  assert.equal(enterKeuze([{ place: p("Kunstenplein"), match: "word" }]).place.name, "Kunstenplein");
  // Een zekere treffer gaat altijd voor een tikfout, ook in een ander district: daar geen tikfouten bij.
  assert.deepEqual(zoekOveral(index, "Bredabaan").map((r) => r.match), ["exact"]);
  assert.ok(zoekOveral(index, "Kammenstraat").every((r) => r.match !== "fuzzy"));
});

// 2. "Maria-Theresialei" opende met Enter de straat in Ekeren: straten.json noemde die van 2018 "Maria-Theresialei_AN"
//    (de homoniemtoevoeging van de straatas), dus was die van Ekeren de enige exacte. Nu gaat de toevoeging weg bij het
//    inlezen van de straatas (straatasNaam in site/street-core.js), ook in straten.json.
test("nakijkronde 2: geen homoniemtoevoeging in district Antwerpen, Maria-Theresialei is een keuze tussen 2018 en Ekeren", () => {
  assert.deepEqual(straten.streets.filter((r) => /_[A-Z]{2}$/.test(r[1])).map((r) => r[1]), [], "straten.json is zonder homoniemtoevoeging");
  for (const p of districtIndex.places.filter((x) => x.type === "straat")) {
    assert.doesNotMatch(p.label, /_[A-Z]{2}$/, p.key);
    assert.doesNotMatch(placeParam(p, districtIndex), /_[A-Z]{2}\b/, p.key);
  }
  const res = zoekOveral(index, "Maria-Theresialei");
  assert.deepEqual(res.filter((r) => r.match === "exact").map((r) => wat(r.place)), ["Maria-Theresialei|Antwerpen|2018", "Maria-Theresialei|Ekeren|2180"]);
  assert.equal(res[0].place.type, "straat", "die van district Antwerpen eerst");
  assert.deepEqual(enterKeuze(res), { keuze: "naamgenoten", n: 2 });
  const ekeren = resolveBuiten(index, "Maria-Theresialei 2180");
  assert.equal(ekeren.district.label, "Ekeren");
  assert.deepEqual(naamgenoten(index, ekeren).district.map((p) => `${p.label} ${p.postcode}`), ["Maria-Theresialei 2018"]);
  // De straat zelf: naam en sleutel zijn die van de straatas, zonder toevoeging (zo koppelt ze aan de live lagen en de
  // ochtendstand, die ze ook zonder krijgen); een oude link of sleutel met de toevoeging werkt nog.
  const mt = res[0].place;
  assert.equal(mt.name, "Maria-Theresialei");
  assert.match(mt.key, /^straat:\d+\|Maria-Theresialei\|2018$/);
  assert.equal(placeParam(mt, districtIndex), "Maria-Theresialei");
  assert.equal(resolvePlaceParam(districtIndex, "Maria-Theresialei"), mt);
  assert.equal(resolvePlaceParam(districtIndex, "Maria-Theresialei_AN"), mt);
  assert.equal(resolvePlaceParam(districtIndex, mt.key.replace("|Maria-Theresialei|", "|Maria-Theresialei_AN|")), mt);
  assert.equal(enterKeuze(zoekOveral(index, "Maria-Theresialei 2018")).place, mt);
  assert.equal(enterKeuze(zoekOveral(index, "Maria-Theresialei Ekeren")).place, ekeren);
});

// 3. Een straatnaam met een cijfer ("Fort 7-straat", "Pad nr. 25", "De 7 schakenpad"): parseQuery liet het cijfer als
//    huisnummer weg, dus vond de deellink van de uitleg haar straat niet terug.
test("nakijkronde 3: elke deellink vindt haar plek terug, ook met een cijfer in de straatnaam", () => {
  const buiten = index.places.filter((p) => p.type === "buiten" || p.type === "district");
  assert.equal(buiten.filter((p) => p.type === "buiten").length, stadDoc.straten.length);
  const mis = buiten.filter((p) => resolveBuiten(index, buitenParam(p)) !== p).map(buitenParam);
  assert.deepEqual(mis, [], "resolveBuiten(buitenParam(p)) === p voor elke rij van straten-stad.json en elk district");
  // In district Antwerpen: placeParam terug naar dezelfde plek (of een stuk van dezelfde straat, voor de bewoner gelijk).
  const zelfde = (p) => [p.type, p.label, p.postcode || "", p.sub || ""].join("|");
  const misD = districtIndex.places.filter((p) => { const r = resolvePlaceParam(districtIndex, placeParam(p, districtIndex)); return !r || zelfde(r) !== zelfde(p); }).map((p) => placeParam(p, districtIndex));
  assert.deepEqual(misD, []);
  for (const [vraag, verwacht] of [
    ["Fort 7-straat", "Fort 7-straat|Wilrijk|2610"], ["Fort 7-straat 2610", "Fort 7-straat|Wilrijk|2610"], ["Pad nr. 25", "Pad nr. 25|Borsbeek|2150"],
    ["Voetweg 31", "Voetweg 31|Wilrijk|2610"], ["23 meipad", "23 meipad|Merksem|2170"], ["6-juni-plein", "6-juni-plein|Wilrijk|2610"],
    ["De 7 schakenpad", "De 7 schakenpad|Antwerpen|2050"], ["4 septemberpad", "4 septemberpad|Antwerpen|2020"], ["Buurtweg nr 11", "Buurtweg nr 11|Antwerpen|2030"],
  ]) {
    const res = zoekOveral(index, vraag);
    assert.equal(res[0].match, "exact", `${vraag}: ${res.map((r) => `${wat(r.place)} ${r.match}`).join(", ")}`);
    assert.equal(wat(enterKeuze(res).place), verwacht, vraag);
  }
  assert.equal(resolvePlaceParam(districtIndex, "De 7 schakenpad").label, "De 7 schakenpad");
  assert.equal(resolveBuiten(index, "Fort 7-straat 2610").name, "Fort 7-straat");
  // Een huisnummer blijft een huisnummer (een verzonnen nummer: geen echt adres in de toetsen).
  assert.equal(enterKeuze(zoekOveral(index, "Kammenstraat 9999")).place.label, "Kammenstraat");
  assert.equal(resolvePlaceParam(districtIndex, "Kammenstraat 9999").label, "Kammenstraat");
  assert.equal(resolveBuiten(index, "Bredabaan 9999 2170").name, "Bredabaan");
  // Halfweg getypt, met het cijfer: begint met, bovenaan (de Van Montfortstraat past er alleen half bij: kiezen).
  const half = zoekOveral(index, "Fort 7-str");
  assert.deepEqual([wat(half[0].place), half[0].match], ["Fort 7-straat|Wilrijk|2610", "prefix"]);
  assert.equal(enterKeuze(half).keuze, "meerdere");
  assert.equal(wat(enterKeuze(zoekOveral(index, "Fort 7-straat")).place), "Fort 7-straat|Wilrijk|2610");
});

const DISTRICTEN = districtenTabel();
const D = Object.fromEntries(DISTRICTEN.map((d) => [d.key, d]));
const markt = (id, title, location, date, extra = {}) => ({ id, sourceId: "stad-markten", scope: "stad", inDistrict: false, title, location, date, timeSlot: "08:00", timeText: "8 tot 13 uur", postcodes: (/(\d{4})/.exec(location) || [])[1] ? [(/(\d{4})/.exec(location))[1]] : [], link: `https://geo.api.vlaanderen.be/GIPOD/ogc/features/v1/collections/INNAME_PUNT/items/${id}`, ...extra });
const nieuws = (key, id, title, date, extra = {}) => ({ id: `stad-news-${key}-${id}-${date}`, sourceId: "stad-districten", scope: "stad", inDistrict: false, title, date, timeSlot: "Info", timeText: "", location: `District ${D[key].label}, locatie via de officiële bron`, link: `https://www.antwerpen.be/info/${id}/x`, ...extra });

test("wat de site kent in een ander district: markten van de stad en districtsnieuws, met bron, zonder iets erbij", () => {
  const vandaag = "2099-03-10";
  const items = [
    markt("m1", "Gemengde markt Kioskplaats", "Kioskplaats, 2660 Hoboken", "2099-03-16"),
    markt("m2", "Gemengde markt Kioskplaats", "Kioskplaats, 2660 Hoboken", "2099-03-23"),
    markt("m0", "Gemengde markt Kioskplaats", "Kioskplaats, 2660 Hoboken", "2099-03-09"), // voorbij
    markt("m3", "Vrijdagmarkt elders", "Elders, 2660 Hoboken", "2099-03-13", { timeText: "", timeSlot: "07:30" }),
    markt("m4", "Gemengde markt Michel Willemsplein", "Michel Willemsplein, Antwerpen", "2099-03-12", { postcodes: [] }),
    markt("m5", "Markt in district Antwerpen", "Theaterplein, 2000 Antwerpen", "2099-03-14", { inDistrict: true }),
    nieuws("hoboken", "a1", "VOLZET - Lezing in de bib", "2099-03-11", { timeSlot: "19:30", timeText: "19.30 uur" }),
    nieuws("hoboken", "a2", "Buurtfeest", "2099-03-20", { location: "Park Broydenborg" }),
    nieuws("hoboken", "a0", "Al voorbij", "2099-03-01"),
    nieuws("wilrijk", "b1", "In Wilrijk", "2099-03-12"),
    { ...nieuws("hoboken", "a3", "Onveilige link", "2099-03-21"), link: "javascript:alert(1)", sourceUrl: "http://example.org" },
  ];
  const hoboken = watDeSiteKent(D.hoboken, items, vandaag, { index, straat: "Kioskplaats" });
  assert.deepEqual(hoboken.markten.map((m) => [m.title, m.inStraat, m.dagen.map((d) => `${d.date} ${d.uur}`)]), [
    ["Gemengde markt Kioskplaats", true, ["2099-03-16 8 tot 13 uur", "2099-03-23 8 tot 13 uur"]],
    ["Vrijdagmarkt elders", false, ["2099-03-13 7.30 uur"]],
  ]);
  assert.match(hoboken.markten[0].bron, /\/items\/m1$/, "de bron van de eerstvolgende marktdag");
  assert.deepEqual(hoboken.nieuws.map((n) => [n.title, n.volzet, n.date, n.uur, n.location, Boolean(n.bron)]), [
    ["Lezing in de bib", true, "2099-03-11", "19.30 uur", "", true],
    ["Buurtfeest", false, "2099-03-20", "", "Park Broydenborg", true],
    ["Onveilige link", false, "2099-03-21", "", "", false],
  ]);
  // Een markt zonder postcode hoort bij het district waar de straatnaam als enige ligt (Michel Willemsplein: Wilrijk).
  assert.equal(districtVanMarkt(items[4], index)?.label, "Wilrijk");
  assert.deepEqual(watDeSiteKent(D.wilrijk, items, vandaag, { index }).markten.map((m) => m.title), ["Gemengde markt Michel Willemsplein"]);
  assert.deepEqual(watDeSiteKent(D.wilrijk, items, vandaag, { index }).nieuws.map((n) => n.title), ["In Wilrijk"]);
  assert.equal(districtVanMarkt(items[5], index), null, "district Antwerpen is geen ander district");
  assert.deepEqual(watDeSiteKent(null, items, vandaag), { markten: [], nieuws: [] });
});

test("de echte agenda: een markt die in de data staat, is via de straat te vinden (Kioskplaats, Kristus-Koningplein, Botermarkt)", () => {
  const tekst = fs.readFileSync(new URL("../site/agenda-feed.js", import.meta.url), "utf8");
  const feed = JSON.parse(tekst.slice(tekst.indexOf("{"), tekst.lastIndexOf("}") + 1));
  const vandaag = String(feed.classificationAsOf || feed.generatedAt || "").slice(0, 10);
  for (const naam of ["Kioskplaats", "Kristus-Koningplein", "Botermarkt"]) {
    const inData = feed.items.filter((i) => i.sourceId === "stad-markten" && String(i.location).startsWith(`${naam},`) && (i.endDate || i.date) >= vandaag);
    if (!inData.length) continue; // de markten van die ochtend zijn niet geladen: niets te toetsen
    const place = enterKeuze(zoekOveral(index, naam)).place;
    assert.equal(place?.type, "buiten", naam);
    const { markten } = watDeSiteKent(place.district, feed.items, vandaag, { index, straat: place.name });
    assert.ok(markten[0]?.inStraat && markten[0].location.startsWith(naam), `${naam}: ${JSON.stringify(markten[0])}`);
  }
});

test("bouwer: één rij per naam en district, homoniemtoevoeging weg, onbekend district of verkeerde postcode is een fout", () => {
  const as = [
    { naam: "Turnhoutsebaan_DE", id: 2866, postcode: "2100", district: "Deurne" },
    { naam: "Turnhoutsebaan", id: 2866, postcode: "2100", district: "Deurne" },
    { naam: "Turnhoutsebaan", id: 2867, postcode: "2140", district: "Borgerhout" },
    { naam: "Bist", id: 355, postcode: "2610", district: "WIlrijk" },
    { naam: "Kammenstraat", id: 1416, postcode: "2000", district: "Antwerpen" },
    { naam: " ", id: -9, postcode: "2100", district: "Deurne" },
    { naam: null, id: -9, postcode: "2100", district: "Deurne" },
  ];
  const { straten: rijen, uitRegister } = bouwStadStraten({ asRijen: as, aanvulling: [{ naam: "Arenaplein", district: "deurne", postcode: "2100" }] });
  const label = (r) => `${r[0]}|${DISTRICTEN[r[1]].label}|${r[2]}`;
  assert.deepEqual(rijen.map(label), ["Arenaplein|Deurne|2100", "Bist|Wilrijk|2610", "Turnhoutsebaan|Borgerhout|2140", "Turnhoutsebaan|Deurne|2100"]);
  assert.deepEqual(uitRegister, ["Arenaplein"]);
  assert.equal(schoneNaam("Krijgsbaan_WI"), "Krijgsbaan");
  assert.equal(schoneNaam("  Pad  nr. 25 "), "Pad nr. 25");
  assert.equal(districtVan("ANTWERPEN", DISTRICTEN), null);
  assert.throws(() => districtVan("Nieuwdistrict", DISTRICTEN), /onbekend district/);
  assert.throws(() => bouwStadStraten({ asRijen: [{ naam: "X", id: 1, postcode: "2600", district: "Deurne" }] }), /hoort niet bij district Deurne/);
  // Adressenregister: alleen de postcode van een adres, nooit het huisnummer; het district via die postcode.
  assert.equal(postcodeUitAdres("Arenaplein 1, 2100 Antwerpen"), "2100");
  assert.equal(postcodeUitAdres("zonder postcode"), "");
  assert.deepEqual(districtUitPostcodes(["2100", "2100"]), { district: "deurne", postcode: "2100" });
  assert.match(districtUitPostcodes([]).reden, /geen adres/);
  assert.match(districtUitPostcodes(["2000"]).reden, /district Antwerpen/);
  assert.match(districtUitPostcodes(["2100", "2140"]).reden, /niet bij één district/);
  assert.deepEqual(BRONNEN.map((b) => b.sleutel), ["as", "register"]);
  // stadPlaces: de herkomst per straat (voor de bronregel), en één plek per district.
  const places = stadPlaces({ districten: DISTRICTEN, metadata: { uitRegister }, straten: rijen });
  assert.equal(places.find((p) => p.name === "Arenaplein").bron, "register");
  assert.equal(places.find((p) => p.name === "Bist").bron, "as");
  assert.equal(places.filter((p) => p.type === "district").length, 9);
});
