// Laatste nakijkronde van 13 oktober 2026 (vaag-eind): wat na ed3e305 nog openstond. De privacyfilter laat geen achternaam
// meer door die precies een gewoon woord is ("Groot", "Klein", "Bus", "Werf"); één getal per lijst onder de kaart; een uur
// uit de tekst alleen als het bij het hele item hoort; echte nachturen in de winter; de vergelijking met de basis slaagt
// niet meer stil. Verzonnen proefdata (dossiers 2099, straten als Proefstraat, Testpersoon als naam). Geen netwerk.
// De modules als geheel geïmporteerd: een functie die er nog niet is, laat één toets falen, niet het hele bestand.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import * as KU from "../site/kaart-uitleg.js";
import * as PN from "../lib/plaatsnaam.mjs";
import * as PC from "../site/place-core.js";
import * as NM from "../site/neighborhood-map.js";
import * as BB from "../site/bezoekers-bronnen.js";
import * as VB from "../scripts/vaagheid-tegen-basis.mjs";

const lees = (rel) => JSON.parse(fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8"));
const VANDAAG = "2099-03-01";
const straat = (name) => ({ id: name, name, postcode: "2060" });
const PROEF = straat("Proefstraat");

// ---- privacyfilter: sinds de witte lijst (site/witte-lijst.js) blijft van een naam niets over ----
// Een woord dat niet op de vaste lijst staat, valt weg; een woord van de lijst dat ook een achternaam kan zijn, valt weg
// naast een voorvoegsel met een hoofdletter, een persoonswoord of een ander woord met een hoofdletter dat wegvalt.
const woordenVan = (t) => (String(t ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
const zonderNaam = (t, naam, opties = {}) => {
  for (const uit of [KU.bruikbareBeschrijving(t, opties), KU.veiligeOmschrijving(`Inname: ${t}`, opties)]) {
    const hier = new Set(woordenVan(uit));
    for (const w of woordenVan(naam)) assert.ok(!hier.has(w), `${JSON.stringify(t)} gaf ${JSON.stringify(uit)}`);
  }
};

test("privacyfilter: een achternaam die precies een gewoon woord is, gaat nooit door, ook niet na De, Den of Van den", () => {
  const namen = [
    ["Feest bij De Groot", "Groot"], ["Tent familie Klein", "Klein"], ["Tent De Bus", "Bus"], ["Feest Groot", "Groot"], ["Feest Oud", "Oud"],
    ["Doopfeest De Groote", "Groote"], ["Doopfeest De Kleine", "Kleine"], ["Feest familie Van den Hoek", "Hoek"], ["Feest familie Den Ouden", "Ouden"],
    ["Feest familie De Laatste", "Laatste"], ["Tent Werf", "Werf"], ["Kraam Stoel", "Stoel"], ["feest Nieuwe", "Nieuwe"], ["Feest familie Feest", "familie"],
  ];
  for (const [t, naam] of namen) zonderNaam(t, naam);
  assert.equal(KU.bruikbareBeschrijving("Feest bij De Groot"), "Feest");
  assert.equal(KU.bruikbareBeschrijving("Doopfeest De Kleine"), "Doopfeest");
});

test("privacyfilter: een woord met een hoofdletter vooraan valt weg tenzij het op de lijst staat; een gebeurteniswoord blijft", () => {
  for (const [t, naam] of [["Groot feest", "Groot"], ["Hoek parcours", "Hoek"], ["Bus stoet", "Bus"], ["Werf feest", "Werf"]]) zonderNaam(t, naam);
  // Een gebeurteniswoord ("Doop", "Stoet", "Drill", "Tweede", "Event") blijft, ook met een hoofdletter vooraan, alleen of midden in de zin.
  for (const t of ["Doop", "Stoet", "Drill", "Tweede halte", "Startlocatie Doop", "Event verkeersvrij, enkel fiets", "doop", "stoet", "tweede halte", "startlocatie doop",
    "event verkeersvrij, enkel fiets"]) {
    assert.equal(KU.bruikbareBeschrijving(t), t, t);
  }
  // Een woord dat niet op de lijst staat ("grote", "Proefplein" zonder straatas), valt weg; een gebeurteniswoord met een
  // hoofdletter naast zo'n woord ook ("Kraam Proefplein": "Kraam" kan een achternaam zijn).
  assert.equal(KU.bruikbareBeschrijving("grote tent"), "tent");
  assert.equal(KU.bruikbareBeschrijving("kraam Proefplein"), "kraam");
  assert.equal(KU.bruikbareBeschrijving("Kraam Proefplein"), "");
  assert.equal(KU.bruikbareBeschrijving("Kraam Proefplein", { isStraat: (n) => n === "Proefplein" }), "Kraam Proefplein");
});

test("privacyfilter: een samenstelling van woorden van de lijst blijft, behalve na een voorvoegsel met een hoofdletter", () => {
  for (const t of ["Startlocatie doop", "Doopfeest", "Verzamelpunt", "Wandelroute van start naar eind", "Verkeersvrije zone. enkel tijdens de stoet", "Teambuilding met doop",
    "Reuzenrad op het plein"]) {
    assert.equal(KU.bruikbareBeschrijving(t), t, t);
  }
  // "Enkel" met een hoofdletter is ook een familienaam: dat kleine woord blijft alleen in kleine letters.
  assert.equal(KU.bruikbareBeschrijving("Verkeersvrije zone. Enkel tijdens de stoet"), "Verkeersvrije zone … stoet");
  assert.equal(KU.bruikbareBeschrijving("Spelletjeslocatie -> dooplocatie"), "Spelletjeslocatie → dooplocatie");
  assert.equal(KU.bruikbareBeschrijving("Parkeerverbod voor hub bladslag"), "Parkeerverbod … bladslag");
  // Na "De", "Van" of "Den" valt ook een samenstelling weg; een woord dat geen samenstelling van de lijst is ook.
  for (const [t, naam] of [["feest Van Standbar", "Standbar"], ["tent De Werfkant", "Werfkant"], ["feest Grootwerf", "Grootwerf"], ["kraam Nieuwstand", "Nieuwstand"],
    ["doop Oudkerk", "Oudkerk"], ["doop De Testkerk", "Testkerk"], ["doop Van Testschool", "Testschool"]]) zonderNaam(t, naam);
});

test("privacyfilter: een plaatsnaam blijft als hele naam in de straatas, als straat van de inname of in de vaste lijst", () => {
  const isStraat = (n) => ["Grote Markt", "Proefwaag"].includes(n);
  assert.equal(KU.bruikbareBeschrijving("kraam Grote Markt", { isStraat }), "kraam Grote Markt");
  assert.equal(KU.bruikbareBeschrijving("kraam Grote Markt"), "kraam", "zonder straatas is 'Grote Markt' niet bewezen: 'Grote' valt weg, en 'Markt' ernaast ook");
  assert.equal(KU.bruikbareBeschrijving("kraam Grote Markt", { straten: [{ name: "Grote Markt" }] }), "kraam Grote Markt", "een straat van de inname zelf");
  // Een stuk van een straatnaam bewijst niets: "Kerk" is geen Kerkstraat, maar "kerk" is wel een woord van de lijst.
  assert.equal(KU.bruikbareBeschrijving("feest kerk", { straten: [{ name: "Kerkstraat" }] }), "feest kerk");
  zonderNaam("feest Proefmans", "Proefmans", { straten: [{ name: "Proefmansstraat" }] });
  // De bekende plaatsnamen (lib/vaste-plekken.json en de plekken van het studentencharter): ook zonder straatas.
  assert.equal(KU.bruikbareBeschrijving("doop Park Spoor Noord"), "doop Park Spoor Noord");
  assert.equal(KU.bruikbareBeschrijving("doop op het Plein aan de Mutsaardstraat"), "doop op het Plein aan de Mutsaardstraat");
  assert.equal(KU.bruikbareBeschrijving("start in park Den Brandt"), "start in park Den Brandt");
  // Elke naam uit de twee bronlijsten staat in de lijst van de filter (die in de browser draait en geen lib/ leest).
  const bekend = new Set((KU.BEKENDE_PLAATSNAMEN || []).map((n) => n.toLowerCase()));
  const bron = [...lees("lib/vaste-plekken.json").plekken.map((p) => p.naam), ...lees("lib/studentencharter.json").plekken.flatMap((p) => p.naam.split(/\s*,\s*/))];
  for (const n of bron) assert.ok(bekend.has(n.toLowerCase()), `${n} ontbreekt in BEKENDE_PLAATSNAMEN`);
});

test("plaatsnaam: een soort plek alleen ('Hoek', 'Park', 'Metrostation') noemt geen plek; een hele straatnaam of vaste plek wel", () => {
  for (const t of ["Hoek", "Park", "Plein", "Metrostation Handel"]) assert.equal(PN.plaatsnaamVan(t, { rond: ["Groenproef", "Handelstraat"] }), "", t);
  assert.equal(PN.plaatsnaamVan("Hoek, Proefplaats", { rond: ["Proefplaats"] }), "Proefplaats");
  assert.equal(PN.plaatsnaamVan("Metrostation Proefplaats", { rond: ["Proefplaats"] }), "Metrostation Proefplaats");
  assert.equal(PN.plaatsnaamVan("Scheldekaaien (buurt Proefplein)", { rond: ["Proefplein"] }), "Scheldekaaien, buurt Proefplein");
});

test("privacyfilter: de bewaarde omschrijvingen van de evenementen, zoals de pagina ze opnieuw filtert", () => {
  // Wat in kaart-uitleg.json stond (de verversing van 12 oktober 2026, vast in tests/fixtures: de dossiers van toen zijn
  // voorbij en een verversing haalt ze uit het bestand), met een straatas die de straatnamen van de inname kent.
  const uitleg = lees("tests/fixtures/kaart-uitleg-omschrijvingen.json");
  const getoond = Object.values(uitleg.evenementen).flatMap((e) => (e.beschrijvingen || []).map((b) => KU.veiligeOmschrijving(b, { straten: e.straten || [], isStraat: (n) => /^(?:Grote Markt|Stadswaag|Quinten Matsijslei|Van Eycklei|Theodoor Van Rijswijckplaats|Falconplein)$/.test(n) }))).filter(Boolean);
  // Een woord dat niet op de lijst staat ("Teambuimding", "zelf") valt weg, de rest blijft; na "Van" een plek die de straatas niet kent: weg.
  for (const weg of ["Inname: Teambuimding (doop) zelf", "Inname: Van Eedenplein"]) assert.ok(!getoond.includes(weg), `${weg} gaat niet meer door`);
  assert.ok(getoond.includes("Inname: doop"));
  for (const blijft of ["Inname: Grote Markt", "Inname: Verzamelpunt", "Parcours: Wandelroute van start naar eind", "Inname: spelletjes / teambuilding", "Inname: doop", "Parcours: Spelletjeslocatie → dooplocatie, voor de trappen", "Inname: Quinten Matsijslei - Van Eycklei", "Inname: Sint-Jansplein-Van De Wervestraat",
    "Inname: Doop", "Parcours: Stoet", "Inname: Drill", "Inname: Startlocatie Doop", "Inname: Eerste Stop, Stadswaag", "Inname: Tweede Stop, Falconplein", "Verkeersvrije Zone: Correct verkeersvrij", "Verkeersvrije Zone: Event verkeersvrij, enkel fiets en voetganger", "Parcours: Wandelen van de Stadswaag naar het Falconplein"]) {
    assert.ok(getoond.includes(blijft), `${blijft} blijft`);
  }
});

// ---- één getal per lijst onder de kaart ----

test("onder de kaart: met een ingeklapte regel zegt de zin 'regels' en hoeveel items dat samen zijn, zoals het getal boven de lijst", () => {
  const basis = { where: "Proefplein", werkenAan: true, werkenGeladen: true, metPlek: true, werken: [], mapped: 0, werkenGetekend: 0, opKaart: 4, without: 17 };
  assert.equal(NM.kaartStatusZin({ ...basis, lijstAantal: 21, lijstItems: 49 }), "21 regels in de lijst (samen 49 items), 4 op de kaart in Proefplein · 17 hier zonder vaste plek.");
  // Zonder bundel: zoals vroeger.
  assert.equal(NM.kaartStatusZin({ ...basis, lijstAantal: 21, lijstItems: 21 }), "21 in de lijst, 4 op de kaart in Proefplein · 17 hier zonder vaste plek.");
  assert.equal(NM.kaartStatusZin({ ...basis, lijstAantal: 21 }), "21 in de lijst, 4 op de kaart in Proefplein · 17 hier zonder vaste plek.");
});

test("wat de lijst toont, in regels en in items: een bundel is één regel en zoveel items als ze leden heeft", () => {
  const terrassen = PC.terrasEntries([1, 2, 3, 4].map((i) => ({ id: `terrace:${i}`, address: `Proefstraat ${i}`, terraceType: "Terras", status: "vergund" })));
  const { losse, bundels } = PC.bundelLijst(terrassen, { straat: "Proefstraat", vandaag: VANDAAG });
  assert.equal(losse.length, 0);
  const punt = PC.agendaEntry({ id: "act", title: "Proefactiviteit", date: "2099-03-14", location: "Proefstraat 1" }, "culture");
  assert.deepEqual(PC.lijstTelling?.([[punt], bundels]), { regels: 2, items: 5 });
  // Het getal boven de lijst (telPerSoort.items) en de zin onder de kaart tellen dezelfde items.
  const tel = PC.telPerSoort(PC.lijstUniversum([punt, ...terrassen], VANDAAG));
  assert.equal(tel.items, 5);
  // De lijst geeft beide door aan de kaart (place-view.js, meldKaart).
  const view = fs.readFileSync(new URL("../site/place-view.js", import.meta.url), "utf8");
  assert.match(view, /lijstTelling\(/);
  assert.match(fs.readFileSync(new URL("../site/neighborhood-map.js", import.meta.url), "utf8"), /lijstItems: lijstStand\?\.items/);
});

// ---- een uur uit de tekst alleen als het bij het hele item hoort ----

test("leesbaarUur: het uur van een deelactiviteit elders is geen beginuur; een uur vooraan wel, met twee cijfers", () => {
  const punt = (timeText) => ({ source: "agenda", start: "2099-03-14", item: { timeSlot: "Info", timeText }, timeText });
  assert.equal(BB.leesbaarUur(punt("kratstapelen op het Proefplein van 12 tot 17 uur; muzikanten in de namiddag")), "Zie uren");
  assert.equal(BB.leesbaarUur(punt("optocht van 15 tot 15.30 uur")), "Zie uren");
  assert.equal(BB.leesbaarUur(punt("9 tot 12 uur, met aansluitend een toonmoment")), "09.00");
  assert.equal(BB.leesbaarUur(punt("van 14 tot 17 uur")), "14.00");
  assert.equal(BB.leesbaarUur(punt("vanaf 10 uur")), "10.00");
  assert.equal(BB.leesbaarUur(punt("om 20u30")), "20.30");
  assert.equal(BB.leesbaarUur(punt("op schooldagen: ma, di, do, vr 8.00-8.30 en 15.15-15.35")), "08.00");
  assert.equal(BB.leesbaarUur(punt("op 3 plekken in 2099")), "Uur onbekend", "een aantal of een jaartal is geen uur");
  // Zelfde vorm als een uur uit de bron ("07:00" wordt "07.00").
  assert.equal(BB.leesbaarUur({ source: "agenda", start: "2099-03-14", time: "07:00" }), "07.00");
});

// ---- echte nachturen in de winter ----

test("een A-Sign-fase van 1.00 tot 5.00 uur in de winter (00:00Z tot 04:00Z) houdt haar uren; een GIPOD-werk om 00:00Z niet", () => {
  assert.deepEqual(PC.urenVanDag("2099-11-10T00:00:00.000Z", "2099-11-10T04:00:00.000Z"), { time: "01:00", timeText: "van 1.00 tot 5.00 uur" });
  const rij = { id: "sgw:GW2099-000951|1", kind: "sgw", kindLabel: "Werfzone", title: "Werfzone", location: "", reference: "GW2099-000951", detail: "Fase 1", status: "vergund",
    start: "2099-11-10T00:00:00.000Z", end: "2099-11-10T04:00:00.000Z", streets: [PROEF], werfzoneStreets: [PROEF], omleidingStreets: [] };
  const [zone] = PC.publicSpaceEntries([rij], { vandaag: "2099-11-01", alle: [rij], straat: PROEF.name });
  assert.equal(zone.time, "01:00");
  assert.equal(zone.timeText, "van 1.00 tot 5.00 uur");
  // GIPOD: een begin om middernacht UTC is een datum zonder uur (GIPOD 19176027 op het Steenplein).
  const [w] = PC.werkEntries([{ gipodId: 990951, title: "Gasleiding", owner: "Proefnet", status: "Concreet gepland", start: "2099-12-01T00:00:00Z", end: "2099-12-01T18:00:00Z", streets: [PROEF] }], { vandaag: "2099-11-01" });
  assert.equal(w.time, "");
  assert.equal(PC.urenVanWerk?.("2099-12-01T00:00:00Z", "2099-12-01T18:00:00Z"), null);
  assert.deepEqual(PC.urenVanWerk?.("2099-12-01T07:00:00Z", "2099-12-01T15:00:00Z"), { time: "08:00", timeText: "van 8.00 tot 16.00 uur" });
});

// ---- een parkeerverbod dat later begint: de werf zonder "nog N dagen" ----

test("de kaart van een parkeerverbod dat later begint, citeert de werf zonder relatieve tijd", () => {
  assert.equal(PC.zonderDuurStaart?.("Stelling in de Proefstraat: voetgangers beperkt tot 13 november (nog 32 dagen)"), "Stelling in de Proefstraat: voetgangers beperkt tot 13 november");
  assert.equal(PC.zonderDuurStaart?.("Werf in de Proefstraat vanaf 3 mei (start over 9 dagen)"), "Werf in de Proefstraat vanaf 3 mei");
  assert.equal(PC.zonderDuurStaart?.("Werf in de Proefstraat (laatste dag vandaag)"), "Werf in de Proefstraat");
  const uitleg = { werken: { 961: { dossier: "GW2099-000961", soort: "", soortBron: "", omschrijving: "", opdrachtgever: "Stad Antwerpen - Stadsontwikkeling", straten: ["Proefstraat"], gevolgen: [], huisnummers: "", huisnummerBron: "", bijgewerkt: "", fasen: [{ naam: "Onderbouw", start: "2099-02-01", eind: "2099-06-30" }] } } };
  // Een werk met een werfzone in twee fasen, elk met een parkeerverbod op dezelfde dagen (samenWerven); het tweede begint later.
  const fase = (nr, van, tot) => ({ id: `sgw:GW2099-000961|${nr}`, kind: "sgw", kindLabel: "Werfzone", title: "Werfzone", location: "", reference: "GW2099-000961", detail: `Fase ${nr}`, status: "vergund", start: `${van}T06:00:00Z`, end: `${tot}T16:00:00Z`, streets: [PROEF], werfzoneStreets: [PROEF], omleidingStreets: [] });
  const verbod = (ref, van, tot) => ({ id: `parking:${ref}|1`, kind: "parking", kindLabel: "Parkeerverbod", title: "Melding ikv werfsignalisaties", reason: "Melding ikv werfsignalisaties", location: "Proefstraat, 2060 Antwerpen", start: `${van}T00:00:00.000Z`, end: `${tot}T00:00:00.000Z`, status: "Goedgekeurd", reference: ref, detail: "", startTime: "07:00", endTime: "17:00", weekdaysOnly: false, streets: [PROEF] });
  const rijen = [fase(1, "2099-02-01", "2099-03-31"), fase(2, "2099-04-01", "2099-06-30"), verbod("2099-000961", "2099-02-01", "2099-03-31"), verbod("2099-000962", "2099-04-01", "2099-06-30")];
  const werk = { gipodId: 961, dossier: "GW2099-000961", title: "Werk in openbaar domein", owner: "Stad Antwerpen - Stadsontwikkeling", ownerGroup: "Stad Antwerpen", status: "In uitvoering", start: "2099-02-01T06:00:00Z", end: "2099-06-30T16:00:00Z", workTypes: [], occupancyTypes: ["Andere"], sourceUrls: [], point: [4.43, 51.23], streets: [PROEF] };
  const kaarten = PC.samenWerven([...PC.werkEntries([werk], { vandaag: VANDAAG, uitleg }), ...PC.publicSpaceEntries(rijen, { vandaag: VANDAAG, alle: rijen, uitleg, straat: PROEF.name })], { uitleg, straat: PROEF.name, vandaag: VANDAAG, alle: rijen });
  const werf = kaarten.find((e) => e.source === "works");
  assert.match(werf.title, /\(nog \d+ dagen\)$/, "de werfkaart zelf zegt hoelang nog");
  const later = kaarten.find((e) => e.uid === "publicSpace:parking:2099-000962|1");
  assert.ok(later?.bijWerf, "het parkeerverbod van april heeft een eigen kaart bij de werf");
  assert.match(later.summary, /Zelfde straat en dagen als een fase van “Bouwwerf in de Proefstraat tot 30 juni” \(dossier GW2099-000961\)\./);
  assert.doesNotMatch(JSON.stringify(later.regels), /\(nog \d+ dagen\)/);
});

// ---- de vergelijking met de basis slaagt niet stil ----

test("vaagheid tegen de basis: overslaan geeft een waarschuwing in de checks; een fout die niet van onbekende data komt, faalt", () => {
  assert.equal(typeof VB.meldingBijOverslaan, "function");
  // De basis kent een veld of een bron van deze data niet: niet te vergelijken, wel zichtbaar als waarschuwing.
  const data = VB.meldingBijOverslaan("FETCH_HEAD", { overgeslagen: "de basis bouwt deze data niet (Error: Ongeldige brondata: x)", soort: "data" });
  assert.equal(data.exitCode, 0);
  assert.match(data.regel, /^::warning title=Vaagheid tegen FETCH_HEAD niet vergeleken::/);
  // Elke andere fout (de basis bouwt niet om een andere reden, of de meter loopt niet): de controle faalt.
  for (const soort of ["bouw", "meter"]) {
    const fout = VB.meldingBijOverslaan("FETCH_HEAD", { overgeslagen: "de meter liep niet op de code van de basis (TypeError: x is not a function)", soort });
    assert.equal(fout.exitCode, 1, soort);
    assert.match(fout.regel, /^::error title=Vaagheid tegen FETCH_HEAD niet vergeleken::/, soort);
  }
  // Welke bouwfout van onbekende data komt.
  assert.equal(VB.soortBouwfout?.("Error: Ongeldige brondata:\nsite/sources/x.json: onbekend veld"), "data");
  assert.equal(VB.soortBouwfout?.("Error: Onbekende bron: proef-bron"), "data");
  assert.equal(VB.soortBouwfout?.("TypeError: Cannot read properties of undefined"), "bouw");
});

// ---- privacyfilter, nagekeken bij het afmaken: wat de filter nog doorliet ----

test("privacyfilter: een voorletter met punt vóór de naam ('J.Groot') laat niets van de naam over", () => {
  for (const [t, naam] of [["feest J.Groot", "Groot"], ["tent K.Klein", "Klein"], ["feest T.Testpersoon", "Testpersoon"], ["doop A.B.Voorbeeld", "Voorbeeld"]]) zonderNaam(t, naam);
  assert.equal(KU.bruikbareBeschrijving("start t.h.v. de kaai"), "start … kaai");
});

test("privacyfilter: een achternaam in hoofdletters ('TESTPERSOON', 'GROOT') valt weg; een plek of een woord van de lijst in hoofdletters blijft", () => {
  for (const [t, naam] of [["tent TESTPERSOON", "TESTPERSOON"], ["feest VOORBEELD", "VOORBEELD"], ["feest bij GROOT", "GROOT"], ["kraam DE KLEIN", "KLEIN"], ["doop familie VOORBEELDBERG", "VOORBEELDBERG"]]) zonderNaam(t, naam);
  for (const t of ["kraam aan het MAS", "PARKEERVERBOD langs het parcours"]) assert.equal(KU.bruikbareBeschrijving(t), t, t);
  assert.equal(KU.bruikbareBeschrijving("doopfeest MTS"), "doopfeest");
});

test("privacyfilter: na een persoonswoord ('familie', 'fam.', 'dhr.', 'mevrouw') blijft niets van de naam, ook in kleine letters", () => {
  for (const [t, naam] of [["tent familie klein", "klein"], ["feest fam. groot", "groot"], ["feest fam klein", "klein"], ["kraam dhr. voorbeeld", "voorbeeld"], ["doop mevrouw testpersoon", "testpersoon"],
    ["feest bij meneer klein", "klein"], ["tent gezin voorbeeld", "voorbeeld"], ["feest bij de groot", "groot"], ["tent van de kleine", "kleine"], ["doop bij den ouden. start om 9 uur", "ouden"]]) zonderNaam(t, naam);
  assert.equal(KU.bruikbareBeschrijving("naar de grote tent"), "tent");
  assert.equal(KU.bruikbareBeschrijving("familiefeest: tent op het plein"), "tent op het plein");
});

test("plaatsnaam: een gewoon woord ('Klein', 'Groot', 'Werf') is alleen een plek als de hele naam in de straatas of de vaste lijst staat", () => {
  // Een stuk van een straat in de buurt bewijst niets.
  for (const t of ["Hoek Klein", "Parking Groot", "Werf", "Pleintje Klein"]) {
    assert.equal(PN.plaatsnaamVan(t, { rond: ["Kleine Proefberg", "Grootstraat", "Werfstraat", "Klein Proefveld"] }), "", t);
  }
  // Wel: een hele straatnaam uit de straatas of de buurt, of een bekende plaatsnaam.
  assert.equal(PN.plaatsnaamVan("Klein Proefveld", { rond: [], isStraat: (n) => n === "Klein Proefveld" }), "Klein Proefveld");
  assert.equal(PN.plaatsnaamVan("Klein Proefveld", { rond: ["Klein Proefveld"] }), "Klein Proefveld");
  assert.equal(PN.plaatsnaamVan("Park Spoor Noord", { rond: [] }), "Park Spoor Noord");
});

// ---- een eventpagina zonder uur of plaats: alleen "niet in de bron" waar de bron er nooit een heeft ----

test("eventpagina zonder uur of plaats: 'Geen uur in de bron.' alleen voor A-Sign en de koopzondagen; bij een bericht of een kalender 'Geen uur gevonden'", async () => {
  const OZ = await import("../site/onbekend-zinnen.js");
  assert.equal(typeof OZ.eventpaginaZin, "function");
  for (const bron of ["district-asign-evenementen", "stad-koopzondagen"]) {
    assert.equal(OZ.eventpaginaZin("uur", bron), "Geen uur in de bron.", bron);
    assert.equal(OZ.eventpaginaZin("plaats", bron), "Geen plaats in de bron.", bron);
  }
  // Bij een artikel of een kalender vond onze lezer geen uur; of de officiële pagina er een noemt, is niet nagekeken.
  for (const bron of ["stad-districten", "district-nieuws", "district-kalender", "district-ebesluit", "district-ebesluit-evenementen", "proef-bron"]) {
    assert.equal(OZ.eventpaginaZin("uur", bron), "Geen uur gevonden; zie de officiële bron.", bron);
    assert.equal(OZ.eventpaginaZin("plaats", bron), "Geen plaats gevonden; zie de officiële bron.", bron);
  }
  // De meter telt beide als vaag (kern), zoals vroeger.
  const { TEKST_PATRONEN } = await import("../lib/vaagheid.mjs");
  const uur = TEKST_PATRONEN.find((p) => p.id === "uur-niet-in-bron"), plek = TEKST_PATRONEN.find((p) => p.id === "plek-niet-in-bron");
  assert.match("Geen uur gevonden; zie de officiële bron.", uur.re);
  assert.match("Geen plaats gevonden; zie de officiële bron.", plek.re);
  // De build gebruikt die keuze voor elke eventpagina.
  const build = fs.readFileSync(new URL("../scripts/build-agenda.mjs", import.meta.url), "utf8");
  assert.match(build, /eventpaginaZin\("uur", item\.sourceId\)/);
  assert.match(build, /eventpaginaZin\("plaats", item\.sourceId\)/);
});
