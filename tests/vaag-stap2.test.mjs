// Stap 2 van het vaagheidsplan van 12 oktober 2026: fouten die nu iets verkeerd zeggen, zonder nieuwe bron.
//  a. "Wekelijkse markten" alleen voor een echte stadsmarkt of minstens 3 data op dezelfde weekdag; Winter in
//     Antwerpen en een studentenactiviteit nooit;
//  b. één kaart per dossiernummer;
//  c. een aanvraag die nog niet goedgekeurd is: zichtbaar label, geen .ics, niet in "Dit weekend";
//  d. echte uren voor werken en werfzones, "op <dag>" bij werk van één dag;
//  e. meer woorden voor werken (HS cabine, betonstort, maaien, tunnel, vegen en kolken);
//  f. een agendapunt aan al zijn straten;
//  g. Enter opent geen gok.
// Alle data is verzonnen; "vandaag" ligt vast. Geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";

import "../site/event-types.js";
import "../site/agenda-uitgaan.js";
import * as pc from "../site/place-core.js";
import * as ku from "../site/kaart-uitleg.js";
import { leesbaarUur } from "../site/bezoekers-bronnen.js";
import { createAgendaView } from "../site/agenda-view.js";
import { buildFeed, nietGoedgekeurd } from "../scripts/build-sources.mjs";

const U = globalThis.PublicAgendaUitgaan, E = globalThis.PublicAgendaEventTypes;
const VANDAAG = "2026-10-12";
const ASIGN = "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/22";
const dossierPunt = (extra = {}) => ({
  id: "asign-ev-et2099000001-2026-10-21", externalId: "ET2099000001", title: "Vermoedelijk een studentenactiviteit op de Grote Markt", theme: "Activiteit", className: "activity",
  date: "2026-10-21", endDate: null, timeSlot: "Info", timeText: "", location: "Grote Markt, Proefstraat en Tweedestraat", postcodes: [], kind: "activity",
  info: "Evenementendossier ET2099000001 van de stad (A-Sign), laatst gewijzigd op 1 september 2026: aanvraag goedgekeurd.", sourceUrl: ASIGN, link: ASIGN,
  sourceId: "district-asign-evenementen", scope: "district", inDistrict: true, sources: [{ sourceId: "district-asign-evenementen", url: ASIGN, scope: "district" }], ...extra,
});
const markt = (titel, dag, extra = {}) => ({ id: `kal-${titel}-${dag}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"), title: titel, date: dag, endDate: null, location: "Proefplein, 2000 Antwerpen", info: "Verzonnen.", sourceId: "district-kalender", scope: "district", ...extra });
const categorie = (items) => U.markeerWekelijkseReeksen(items.map((i) => ({ ...i, eventType: E.classifyEventType(i) }))).map((i) => ({ ...i, category: U.categoryOf(i) }));

// ---------- a. markten ----------

test("a. een studentenactiviteit of Winter in Antwerpen op de Grote Markt is geen (wekelijkse) markt", () => {
  const [student] = categorie([dossierPunt()]);
  assert.notEqual(student.eventType, "market_fair", "Grote Markt is een plein, geen markt");
  assert.notEqual(student.category, "markets");
  const winter = { ...dossierPunt({ id: "asign-ev-et2099000222-2026-12-04", externalId: "ET2099000222", title: "Winter in Antwerpen", date: "2026-12-04", endDate: "2027-01-03", location: "Steenplein, Grote Markt en Groenplaats", info: "Kerstmarkt en ijsbaan. Evenementendossier ET2099000222 van de stad (A-Sign): aanvraag goedgekeurd." }) };
  const [w] = categorie([winter]);
  assert.notEqual(w.category, "markets");
  assert.equal(U.isWeeklyMarket(w), false);
  // Ook als een andere bron het een markt noemt, op drie vrijdagen: Winter in Antwerpen en studenten nooit.
  const reeks = categorie(["2026-12-04", "2026-12-11", "2026-12-18"].map((d) => markt("Winter in Antwerpen markt", d)));
  assert.ok(reeks.every((i) => i.category !== "markets"));
  const doop = categorie(["2026-10-13", "2026-10-20", "2026-10-27"].map((d) => markt("Studentendoop markt", d)));
  assert.ok(doop.every((i) => i.category !== "markets"));
  assert.equal(U.bundleWeeklyMarkets([w, student, ...reeks, ...doop], VANDAAG).length, 0);
});

test("a. een markt van een andere bron is pas wekelijks bij minstens 3 data op dezelfde weekdag; een stadsmarkt altijd", () => {
  const drie = categorie(["2026-10-17", "2026-10-24", "2026-10-31"].map((d) => markt("Markt op het Proefplein", d)));
  assert.deepEqual(drie.map((i) => i.category), ["markets", "markets", "markets"]);
  assert.deepEqual(U.bundleWeeklyMarkets(drie, VANDAAG).map((b) => [b.title, b.weekdays.join(","), b.count]), [["Markt op het Proefplein", "za", 3]]);
  const twee = categorie(["2026-10-17", "2026-10-24"].map((d) => markt("Markt op het Proefplein", d)));
  assert.ok(twee.every((i) => i.category !== "markets"), "twee data: geen reeks");
  // Drie data op verschillende weekdagen: geen weekmarkt (vroeger werd 13-14 okt "di, wo").
  const verspreid = categorie(["2026-10-13", "2026-10-14", "2026-10-15"].map((d) => markt("Markt op het Proefplein", d)));
  assert.ok(verspreid.every((i) => i.category !== "markets"));
  const stad = categorie([{ ...markt("Vogelenmarkt", "2026-10-18"), sourceId: "stad-markten" }]);
  assert.equal(stad[0].category, "markets");
});

// ---------- b. één kaart per dossiernummer ----------

test("b. het agendapunt van een dossier valt weg naast de kaart van datzelfde dossier; de kaart krijgt het agendapunt", () => {
  const punt = pc.agendaEntry(dossierPunt(), "neighborhood");
  const ander = pc.agendaEntry(dossierPunt({ id: "asign-ev-et2099000002-2026-10-21", externalId: "ET2099000002" }), "neighborhood");
  const kalender = pc.agendaEntry({ id: "kal-1", externalId: "ET2099000001", title: "Proefconcert", date: "2026-10-21", sourceId: "district-kalender" }, "culture");
  const kaart = { uid: "publicSpace:dossier:ET2099000001", id: "ET2099000001", source: "publicSpace", group: "evenementen", title: "Studentenactiviteit op de Grote Markt" };
  const { agenda, live } = pc.eenKaartPerDossier([punt, ander, kalender], [kaart, { uid: "works:1", id: "gipod-1", source: "works" }]);
  assert.deepEqual(agenda.map((e) => e.id), [ander.id, kalender.id], "alleen het agendapunt van hetzelfde dossier valt weg");
  assert.equal(live[0].agendaPunt.id, punt.id, "de kaart krijgt het agendapunt (deellink en .ics)");
  assert.equal(live.length, 2);
  // Zonder kaart van het dossier: alles blijft.
  assert.equal(pc.eenKaartPerDossier([punt, ander], []).agenda.length, 2);
  // Een agendapunt dat samengevoegd is met de kalender, is ook van het dossier.
  assert.equal(pc.dossierVanAgendapunt({ externalId: "ET2099000001", sourceId: "district-kalender", sources: [{ sourceId: "district-kalender" }, { sourceId: "district-asign-evenementen" }] }), "ET2099000001");
  assert.equal(pc.dossierVanAgendapunt({ externalId: "ET2099000001", sourceId: "district-kalender" }), "");
});

// ---------- c. nog niet goedgekeurd ----------

test("c. een aanvraag die nog niet goedgekeurd is: gemarkeerd in de feed, niet in 'Dit weekend'", () => {
  const bron = (items) => ({ sourceId: "district-asign-evenementen", scope: "district", items });
  const kal = { id: "kal-proefloop", externalId: "kal-proefloop", title: "Proefloop door de Proefstraat", theme: "Activiteit", className: "activity", date: "2026-10-17", endDate: null, timeSlot: "10:00", timeText: "10 uur", location: "Proefstraat", postcodes: [], info: "", kind: "activity", sourceUrl: "https://www.antwerpen.be/info/aaaaaaaaaaaaaaaaaaaaaaaa/proefloop", retrievedAt: "2026-10-12T05:00:00.000Z", reviewRequired: false };
  const met = { ...dossierPunt({ id: "asign-ev-et2099000003-2026-10-17", externalId: "ET2099000003", title: "Evenement in de Tweedestraat", date: "2026-10-17", location: "Tweedestraat", info: "Evenementendossier ET2099000003 van de stad (A-Sign): aanvraag nog niet goedgekeurd.", nietGoedgekeurd: true, retrievedAt: "2026-10-12T05:00:00.000Z", reviewRequired: false }) };
  // Een bronbestand van vóór het veld: de vaste slotzin van de info.
  const oud = { ...dossierPunt({ id: "asign-ev-et2099000004-2026-10-18", externalId: "ET2099000004", title: "Evenement in de Derdestraat", date: "2026-10-18", location: "Derdestraat", info: "Evenementendossier ET2099000004 van de stad (A-Sign), laatst gewijzigd op 8 juni 2026: aanvraag nog niet goedgekeurd.", retrievedAt: "2026-10-12T05:00:00.000Z", reviewRequired: false }) };
  const goed = { ...dossierPunt({ id: "asign-ev-et2099000005-2026-10-18", externalId: "ET2099000005", date: "2026-10-18", location: "Vierdestraat", title: "Evenement in de Vierdestraat", retrievedAt: "2026-10-12T05:00:00.000Z", reviewRequired: false }) };
  for (const i of [met, oud, goed]) { delete i.sources; delete i.link; delete i.scope; delete i.sourceId; }
  const { feed } = buildFeed({ status: { generatedAt: "2026-10-12T05:00:00Z", classificationAsOf: VANDAAG, sources: [] }, documents: [bron([met, oud, goed]), { sourceId: "district-kalender", scope: "district", items: [kal] }] }, []);
  const per = Object.fromEntries(feed.items.map((i) => [i.externalId, i]));
  assert.equal(per.ET2099000003.nietGoedgekeurd, true);
  assert.equal(per.ET2099000004.nietGoedgekeurd, true, "ook uit de slotzin van een ouder bronbestand");
  assert.equal(per.ET2099000005.nietGoedgekeurd, undefined);
  // Samengevoegd met een andere bron (een aankondiging): geen label.
  assert.equal(nietGoedgekeurd({ ...met, sourceId: "district-asign-evenementen", sources: [{ sourceId: "district-asign-evenementen" }, { sourceId: "district-kalender" }] }), false);
  // "Dit weekend" (pickHighlights): de aanvraag niet, het goedgekeurde dossier en de kalender wel.
  const weekend = U.rangesFor("2026-10-14").weekend;
  const items = categorie([per.ET2099000003, per.ET2099000005, { ...kal, sourceId: "district-kalender", scope: "district", inDistrict: true }]);
  assert.deepEqual(U.pickHighlights(items, weekend, Infinity).map((i) => i.id).sort(), [kal.id, per.ET2099000005.id].sort());
});

test("c. de site toont het label en geen .ics voor een aanvraag (agenda.js en place-view.js)", async () => {
  const fs = await import("node:fs");
  const agenda = fs.readFileSync(new URL("../site/agenda.js", import.meta.url), "utf8");
  const plek = fs.readFileSync(new URL("../site/place-view.js", import.meta.url), "utf8");
  assert.match(agenda, /item\.nietGoedgekeurd \? `<span class="aanvraag-badge">\$\{esc\(NIET_GOEDGEKEURD_LABEL\)\}<\/span>`/);
  assert.match(agenda, /item\.nietGoedgekeurd \? "" : `<button type="button" class="event-calendar"/);
  assert.match(plek, /Aanvraag, nog niet goedgekeurd/);
  // Het label en de .ics per straat (nietGoedgekeurdOp in place-core.js): ook een straat die alleen een dossier
  // raakt dat nog niet goedgekeurd is.
  assert.match(plek, /!nietGoedgekeurdOp\(agendaPunt, straatNu\) && window\.AgendaIcs/);
  assert.match(plek, /const nietGoedgekeurd = entry\.source === "agenda" && nietGoedgekeurdOp\(item, straatNu\);/);
});

// ---------- d. uren van werken en werfzones ----------

test("d. een werfzone van één dag krijgt haar uren uit A-Sign; geen 'Uur onbekend'", () => {
  const rij = (id, start, end, extra = {}) => ({ id: `sgw:GW2099-000001|${id}`, kind: "sgw", kindLabel: "Werfzone", title: "Werfzone", start, end, status: "vergund", reference: "GW2099-000001", streets: [{ name: "Proefstraat", postcode: "2000" }], werfzoneStreets: [{ name: "Proefstraat" }], ...extra });
  const [e] = pc.publicSpaceEntries([rij(1, "2026-10-13T07:00:00.000Z", "2026-10-13T13:00:00.000Z")], { vandaag: VANDAAG, straat: "Proefstraat" });
  assert.equal(e.time, "09:00");
  assert.equal(e.timeText, "van 9.00 tot 15.00 uur");
  assert.equal(leesbaarUur(e, { multi: false }), "09.00");
  // Een werfzone van weken: geen uur (en ook geen "Uur onbekend": die toont "Start" of "Loopt").
  const [lang] = pc.publicSpaceEntries([rij(2, "2026-10-01T05:00:00.000Z", "2026-11-20T16:00:00.000Z")], { vandaag: VANDAAG, straat: "Proefstraat" });
  assert.equal(lang.time || "", "");
  assert.notEqual(leesbaarUur(lang, { multi: true, running: true }), "Uur onbekend");
});

test("d. een GIPOD-werk van één dag: de uren of 'hele dag', en 'op <dag>' in de titel", () => {
  const werk = (start, end, extra = {}) => ({ gipodId: 90000201, title: "Werken aan de waterleiding", status: "Concreet gepland", start, end, owner: "Proefbeheerder", ownerGroup: "Andere", workTypes: [], occupancyTypes: ["Water"], streets: [{ id: "1", name: "Proefstraat", postcode: "2000" }], hindrance: null, ...extra });
  const uren = pc.workEntry(werk("2026-10-15T12:00:00Z", "2026-10-15T16:06:00Z"), { vandaag: VANDAAG });
  assert.equal(uren.time, "14:00");
  assert.equal(uren.timeText, "van 14.00 tot 18.06 uur");
  assert.equal(leesbaarUur(uren, { multi: false }), "14.00");
  const heel = pc.workEntry(werk("2026-11-30T23:01:00Z", "2026-12-01T22:59:00Z"), { vandaag: VANDAAG });
  assert.equal(leesbaarUur(heel, { multi: false }), "Hele dag");
  assert.match(uren.title, /op 15 oktober \(start over 3 dagen\)$/);
  assert.doesNotMatch(uren.title, /vanaf/);
  // Vandaag, de enige dag: "vandaag", niet "tot 12 oktober (laatste dag vandaag)".
  const vandaag = pc.workEntry(werk("2026-10-12T06:00:00Z", "2026-10-12T14:00:00Z", { status: "In uitvoering" }), { vandaag: VANDAAG });
  assert.match(vandaag.title, / vandaag$/);
  // Meer dagen: zoals vroeger.
  assert.match(pc.workEntry(werk("2026-10-15T05:00:00Z", "2026-10-20T16:00:00Z"), { vandaag: VANDAAG }).title, /vanaf 15 oktober/);
});

// ---------- e. werkwoorden ----------

test("e. HS cabine, betonstort, maaien, tunnel, vegen en kolken: een soort in plaats van 'Wegenwerken' of niets", () => {
  const soort = (t) => ku.soortWerk([{ tekst: t, bron: "fasen van de hinder in GIPOD" }]).soort;
  assert.equal(soort("HS cabine"), "Werken aan een elektriciteitscabine");
  assert.equal(soort("Bijkomende betonstort plan 16B"), "Betonstort");
  assert.equal(soort("Fase 1 : Maaien"), "Maaien (groenonderhoud)");
  assert.equal(soort("Fase 1 : Afsluiten tunnel"), "Tunnelafsluiting");
  assert.equal(soort("Onderhoudssluiting Proeftunnel nacht 1/2/3"), "Tunnelafsluiting");
  assert.equal(soort("Fase 2 : tunnel"), "Tunnelwerken");
  assert.equal(soort("Vegen en kolken"), "Straatreiniging (vegen, kolken of zwerfvuil)");
  assert.equal(soort("Fase 1 - stockagezone"), "Opslagzone (stockage)");
  // Een specifieker woord gaat voor.
  assert.equal(soort("Rioleringswerken onder de tunnel"), "Rioleringswerken");
  assert.equal(soort("telefooncabine verplaatsen"), "");
});

// ---------- f. een agendapunt aan al zijn straten ----------

test("f. een agendapunt uit de dossiers hangt aan al zijn straten, niet alleen aan de drie in de locatie", () => {
  const punt = dossierPunt({ location: "Eerstestraat, Tweedestraat, Derdestraat en 2 andere straten", straten: ["Eerstestraat", "Tweedestraat", "Derdestraat", "Vierdestraat", "Vijfdestraat"], stratenVolledig: true });
  const refs = new Map(punt.straten.map((n, i) => [n, [{ id: String(100 + i), name: n, postcode: "2000" }]]));
  const view = createAgendaView();
  view.setResolver((adres) => [...refs.keys()].filter((n) => adres.includes(n)).flatMap((n) => refs.get(n)));
  view.setStreet("Vijfdestraat", { id: "104", name: "Vijfdestraat", postcode: "2000" });
  assert.equal(view.matchesStreet(punt), false, "zonder stratenlijst: alleen de straten van de locatietekst");
  view.setStreetLists((item) => { const n = pc.stratenVanAgendapunt(item); return n.length ? n.flatMap((x) => refs.get(x) || []) : null; });
  assert.equal(view.matchesStreet(punt), true);
  // Een bronbestand van vóór stratenVolledig (oudere code: samengevoegd op een gegokte titel, een reuzenvlak, een
  // afgekapte zone): dan alleen de straten uit de locatie, zoals vroeger.
  assert.equal(view.matchesStreet({ ...punt, stratenVolledig: undefined }), false);
  // De feed houdt de straten (scripts/build-sources.mjs).
  const doc = { sourceId: "district-asign-evenementen", scope: "district", items: [{ ...punt, retrievedAt: "2026-10-12T05:00:00.000Z", reviewRequired: false, sourceId: undefined, sources: undefined, link: undefined, scope: undefined }] };
  for (const k of ["sourceId", "sources", "link", "scope"]) delete doc.items[0][k];
  const { feed } = buildFeed({ status: { generatedAt: "2026-10-12T05:00:00Z", classificationAsOf: VANDAAG, sources: [] }, documents: [doc] }, []);
  assert.deepEqual(feed.items[0].straten, punt.straten);
  assert.equal(feed.items[0].stratenVolledig, true);
});

// ---------- g. Enter ----------

test("g. Enter opent geen gok: alleen een echte overeenkomst, of een keuze met de pijltjes", () => {
  const plekken = pc.buildPlaceIndex({ streets: [["1", "Kammenstraat", "2000"], ["2", "Gasstraat", "2060"]], wijken: [] });
  const gok = pc.searchPlaces(plekken, "Kammenstrat", { limit: 8 });
  assert.equal(gok[0].match, "fuzzy");
  assert.equal(pc.enterOpent(gok[0]), false);
  assert.equal(pc.enterOpent(gok[0], { pijltjes: true }), true);
  const echt = pc.searchPlaces(plekken, "kammenstr", { limit: 8 });
  assert.notEqual(echt[0].match, "fuzzy");
  assert.equal(pc.enterOpent(echt[0]), true);
});
