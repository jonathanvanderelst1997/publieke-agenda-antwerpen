// Tweede nakijkronde van 13 oktober 2026 (vaag-eind): wat twee controleurs in de browser naspeelden. Parkeerverboden
// in een werfkaart staan weer in de weekzin, in de kop en op hun eigen dag; een werfzone met een parkeerverbod belandt
// niet in een ingeklapte bundel; wat niet in het evenementendossier staat, staat ook op een kaart met een kern en in de
// sectie van een bundel; een uur in de tekst is nooit "Uur onbekend"; geen jaardossier als "ook gepland hier die dag";
// geen verzonnen uur om middernacht UTC; geen persoonsnaam die met een gewoon woord begint. Verzonnen proefdata
// (dossiers 2099, straten als Proefstraat, Testpersoon als naam). Geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  agendaEntry, agendaStraten, bundelLijst, bundelSoort, dezeWeek, groupForList, lijstUniversum, parkeerKopZin, periodRange, permitEntry,
  plekSubTekst, publicSpaceEntries, publicSpaceEntry, samenWerven, telPerSoort, terrasEntries, urenVanDag, urenVanWerk, verrijkMetContext, werkEntries,
} from "../site/place-core.js";
import { leesbaarUur } from "../site/bezoekers-bronnen.js";
import { bruikbareBeschrijving, evenementFeiten, evenementKaartje, lijktPersoonsnaam } from "../site/kaart-uitleg.js";
import { ontbreektRegel, sectieZinIds } from "../site/place-view.js";
import { onbekendVeld } from "../site/onbekend-zinnen.js";
import { buildPlaceIndex } from "../site/place-core.js";
import { watDeSiteKent, zoekIndex } from "../site/stad-zoeken.js";
import { districtenTabel } from "../scripts/build-straten-stad.mjs";
import { wijkFeatures, bboxOf } from "../site/neighborhood-core.js";
import { detailVanKaart } from "../scripts/meet-vaagheid.mjs";
import { kaartIndeling } from "../site/place-view.js";
import { vaagheidVanKaart } from "../lib/vaagheid.mjs";

const VANDAAG = "2099-03-01";
const straat = (name) => ({ id: name, name, postcode: "2060" });
const PROEF = straat("Proefstraat"), ANDER = straat("Anderestraat");
const fase = (dossier, nr, van, tot, { werfzone = [PROEF], omleiding = [] } = {}) => ({
  id: `sgw:${dossier}|${nr}`, kind: "sgw", kindLabel: "Werfzone", title: "Werfzone", location: "", reference: dossier, detail: `Fase ${nr}`, status: "vergund",
  start: `${van}T06:00:00Z`, end: `${tot}T16:00:00Z`, streets: [...werfzone, ...omleiding], werfzoneStreets: werfzone, omleidingStreets: omleiding,
});
const verbod = (ref, van, tot, { plek = PROEF, reden = "Melding ikv werfsignalisaties" } = {}) => ({
  id: `parking:${ref}|1`, kind: "parking", kindLabel: "Parkeerverbod", title: reden, reason: reden, location: `${plek.name}, 2060 Antwerpen`,
  start: `${van}T00:00:00.000Z`, end: `${tot}T00:00:00.000Z`, status: "Goedgekeurd", reference: ref, detail: "", startTime: "07:00", endTime: "17:00", weekdaysOnly: false, streets: [plek],
});
const werk = (gipodId, dossier, van, tot) => ({
  gipodId, dossier, title: "Werk in openbaar domein", owner: "Stad Antwerpen - Stadsontwikkeling", ownerGroup: "Stad Antwerpen", status: "In uitvoering",
  start: `${van}T06:00:00Z`, end: `${tot}T16:00:00Z`, workTypes: [], occupancyTypes: ["Andere"], sourceUrls: [], point: [4.43, 51.23], streets: [PROEF],
});
const bouw = ({ works = [], rows = [], vandaag = VANDAAG, uitleg = null }) => samenWerven(
  [...werkEntries(works, { vandaag, uitleg }), ...publicSpaceEntries(rows, { vandaag, alle: rows, uitleg, straat: PROEF.name })],
  { uitleg, straat: PROEF.name, vandaag, alle: rows },
);
// Een werfzone zonder doel (geen GIPOD-werk met hetzelfde dossiernummer) met twee fasen in de Proefstraat, elk met een
// parkeerverbod voor een werf op dezelfde dagen; en twee andere werfzones zonder doel en zonder parkeerverbod.
const RIJEN = [
  fase("GW2099-000901", 1, "2099-02-01", "2099-03-31"), fase("GW2099-000901", 2, "2099-04-01", "2099-06-30"),
  verbod("2099-000901", "2099-02-01", "2099-03-31"), verbod("2099-000902", "2099-04-01", "2099-06-30"),
  fase("GW2099-000902", 1, "2099-02-01", "2099-12-31"), fase("GW2099-000903", 1, "2099-05-03", "2100-04-30"),
];

test("werfzone met parkeerverboden: niet in de bundel 'zonder doel', 'Niet parkeren' met de uren in de kop, en in de weekzin", () => {
  const kaarten = bouw({ rows: RIJEN });
  const zone = kaarten.find((e) => e.uid === "publicSpace:sgw:GW2099-000901|1");
  assert.deepEqual(zone.werf.parkeerverboden, ["2099-000901", "2099-000902"]);
  // De kop: het parkeerverbod dat nu loopt, met zijn uren en zijn laatste dag, vóór de zin dat het waarvoor ontbreekt.
  assert.equal(zone.summary, "De werfzone ligt in je straat. Vergund door de stad. Niet parkeren van 7.00 tot 17.00 uur, t/m 31 mrt (A-Sign, 2099-000901). Volgend parkeerverbod vanaf 1 apr. De stad publiceert niet waarvoor deze werfzone dient.");
  // Nooit in een bundel: een parkeerverbod staat bij "Loopt nu", niet ingeklapt onderaan.
  assert.equal(bundelSoort(zone), "");
  const { losse, bundels } = bundelLijst(kaarten, { straat: PROEF.name, vandaag: VANDAAG });
  assert.ok(losse.some((e) => e.uid === zone.uid));
  assert.deepEqual(bundels.map((b) => b.bundel.leden.map((l) => l.uid)), [["publicSpace:sgw:GW2099-000902|1", "publicSpace:sgw:GW2099-000903|1"]]);
  const { running } = groupForList(losse, { ...periodRange("alles", VANDAAG), today: VANDAAG });
  assert.ok(running.some((e) => e.uid === zone.uid), "de werfzone met het lopende parkeerverbod staat bij Loopt nu");
  // De weekzin telt het lopende parkeerverbod, zoals toen het een losse kaart was.
  assert.match(dezeWeek(kaarten, VANDAAG).zin, /1 parkeerverbod \(loopt al\)/);
});

test("een parkeerverbod dat later begint: een eigen kaart op zijn eerste dag, met de werf erbij; de weekzin telt het één keer", () => {
  const kaarten = bouw({ rows: RIJEN });
  const later = kaarten.filter((e) => e.uid === "publicSpace:parking:2099-000902|1");
  assert.equal(later.length, 1);
  const [k] = later;
  assert.equal(k.title, "Parkeerverbod voor de werfzone in de Proefstraat");
  assert.equal(k.summary, "Niet parkeren van 7.00 tot 17.00 uur. Zelfde straat en dagen als een fase van “Werfzone” (dossier GW2099-000901).");
  assert.deepEqual(k.regels.at(-1), ["Werf", "Werfzone (A-Sign, dossier GW2099-000901): zelfde straat en dezelfde dagen als een fase van de werfzone. A-Sign zet bij een parkeerverbod geen dossiernummer."]);
  assert.equal(k.bijWerf, "publicSpace:sgw:GW2099-000901|1");
  const { days } = groupForList(kaarten, { ...periodRange("alles", VANDAAG), today: VANDAAG });
  assert.ok(days.find(([dag]) => dag === "2099-04-01")?.[1].some((e) => e.uid === k.uid), "het begin van de nieuwe fase staat in de sectie van 1 april");
  // Wat al loopt, krijgt geen eigen kaart (dat zegt de kop van de werfzone).
  assert.ok(!kaarten.some((e) => e.uid === "publicSpace:parking:2099-000901|1"));
  // Op 30 maart: het lopende en het volgende parkeerverbod, elk één keer (de eigen kaart en de werfzone hebben dezelfde uid).
  const eind = bouw({ rows: RIJEN, vandaag: "2099-03-30" });
  assert.match(dezeWeek(eind, "2099-03-30").zin, /2 parkeerverboden \(1 loopt al\)/);
});

test("werfkaart (werk en werfzone): de kop zegt 'Niet parkeren' met uren en dagen, niet alleen 'Met parkeerverbod'", () => {
  const uitleg = { werken: { 911: { dossier: "GW2099-000911", soort: "", soortBron: "", omschrijving: "", opdrachtgever: "Stad Antwerpen - Stadsontwikkeling", straten: ["Proefstraat"], gevolgen: [], huisnummers: "", huisnummerBron: "", bijgewerkt: "", fasen: [{ naam: "Onderbouw", start: "2099-02-01", eind: "2099-06-30" }] } } };
  const rows = [fase("GW2099-000911", 1, "2099-02-01", "2099-06-30"), verbod("2099-000911", "2099-02-01", "2099-06-30")];
  const [k] = bouw({ works: [werk(911, "GW2099-000911", "2099-02-01", "2099-06-30")], rows, uitleg });
  assert.equal(k.source, "works");
  assert.match(k.summary, / Met werfzone \(A-Sign\)\. Niet parkeren van 7\.00 tot 17\.00 uur, t\/m 30 jun \(A-Sign, 2099-000911\)\.$/);
  assert.match(dezeWeek([k], VANDAAG).zin, /1 werk \(loopt al\) en 1 parkeerverbod \(loopt al\)/);
  // Alleen voorbije parkeerverboden: dan alleen het woord, zoals vroeger.
  assert.equal(parkeerKopZin(k.werfParkeer, "2099-07-01"), "");
  assert.equal(parkeerKopZin(k.werfParkeer, "2099-01-15"), "Niet parkeren van 7.00 tot 17.00 uur, van 1 feb t/m 30 jun (A-Sign, 2099-000911).");
});

test("wat niet in het evenementendossier staat: ook op een kaart met een kern, en de sectiezin ook voor de leden van een bundel", () => {
  const rijen = [{ id: "iod:ET2099000931|EVENT|1", kind: "iod", title: "Inname", innameType: "Inname", reference: "ET2099000931", status: "aanvraag_goedgekeurd", start: "2099-03-20T00:00:00.000Z", end: "2099-03-20T00:00:00.000Z", phase: "Evenement", dossierType: "ETL", streets: [PROEF] }];
  const k = evenementKaartje(evenementFeiten(rijen), { vandaag: VANDAAG, straat: PROEF.name });
  assert.ok(k.kern, "een evenementendossier heeft een kern");
  assert.deepEqual(ontbreektRegel(k), { kop: "Niet in het evenementendossier ET2099000931 (A-Sign)", tekst: "wat er gebeurt en de naam (geen omschrijving die dat zegt) · uren (A-Sign geeft alleen de dag) · organisator." });
  assert.equal(ontbreektRegel({ ontbreekt: [] }), null);
  // De meter telt dezelfde regel (detailVanKaart met ontbreektRegel); een oudere code zonder die functie toonde ze bij
  // een kaart met een kern niet, en dan telt de meter ze ook niet.
  const e = { uitleg: k, reference: "Dossier ET2099000931", straten: [] };
  const metRegel = detailVanKaart(e, {}, { kaartIndeling, bezoekersHint: () => "", ontbreektRegel });
  assert.ok(metRegel.includes("Niet in het evenementendossier ET2099000931 (A-Sign): wat er gebeurt en de naam (geen omschrijving die dat zegt) · uren (A-Sign geeft alleen de dag) · organisator."));
  assert.ok(!detailVanKaart(e, {}, { kaartIndeling, bezoekersHint: () => "" }).some((x) => /^Niet in het evenementendossier/.test(x)));
  // De sectie van een bundel: de zin over de uren staat er ook als alleen een lid het veld draagt.
  const lid = { uid: "publicSpace:dossier:ET2099000931", onbekend: [onbekendVeld("evenement-uren")] };
  const bundel = { uid: "bundel:innames:proefstraat", bundel: { soort: "innames", leden: [lid, { uid: "x", onbekend: [] }] } };
  assert.deepEqual(sectieZinIds([bundel]), ["evenementen-uren"]);
  assert.deepEqual(sectieZinIds([lid]), ["evenementen-uren"]);
  assert.deepEqual(sectieZinIds([{ uid: "y" }]), []);
});

test("een uur in de tekst is nooit 'Uur onbekend'", () => {
  const punt = (timeText, extra = {}) => ({ start: "2099-03-14", timeText, item: { timeSlot: "Info", timeText }, ...extra });
  // Een uur van een deel van het item ("kratstapelen op het Proefplein") is geen beginuur van het hele item: "Zie uren"
  // (laatste nakijkronde, tests/vaag-eind-slot.test.mjs). Nooit "Uur onbekend".
  assert.equal(leesbaarUur(punt("kratstapelen op het Proefplein van 12 tot 17 uur; muzikanten in de namiddag")), "Zie uren");
  assert.equal(leesbaarUur(punt("optocht van 15 tot 15.30 uur")), "Zie uren");
  assert.equal(leesbaarUur(punt("9 tot 12 uur, met aansluitend een toonmoment")), "09.00");
  assert.equal(leesbaarUur(punt("deuren om 20u30")), "Zie uren");
  assert.equal(leesbaarUur(punt("om 20u30")), "20.30");
  assert.equal(leesbaarUur(punt("")), "Uur onbekend");
  assert.equal(leesbaarUur(punt("op 3 plekken in 2099")), "Uur onbekend", "een aantal of een jaartal is geen uur");
  assert.equal(leesbaarUur(punt("van 12 tot 17 uur", { time: "10:00" })), "10.00", "een echt uur van de bron gaat voor");
});

test("ook gepland hier die dag: geen jaardossier (60 dagen of langer) als context", () => {
  const inname = (dossier, van, tot = van) => ({ id: `iod:${dossier}|1|1`, kind: "iod", kindLabel: "Inname openbaar domein", title: "Inname", innameType: "Inname", location: "", start: `${van}T00:00:00.000Z`, end: `${tot}T00:00:00.000Z`, status: "aanvraag_goedgekeurd", reference: dossier, detail: "", phase: "Evenement", dossierType: "ETL", streets: [straat("Proefplein")] });
  const kaarten = publicSpaceEntries([inname("ET2099000951", "2099-03-20"), inname("ET2099000952", "2099-01-01", "2099-12-31"), inname("ET2099000953", "2099-03-20")], { vandaag: VANDAAG, straat: "Proefplein" });
  const regel = (e) => (e.uitleg?.regels || []).find(([k]) => k === "Ook gepland hier die dag")?.[1] || "";
  const dag = verrijkMetContext(kaarten, { straat: "Proefplein", vandaag: VANDAAG }).find((e) => e.id === "ET2099000951");
  assert.match(regel(dag), /dossier ET2099000953/, "een andere dagkaart wel");
  assert.doesNotMatch(regel(dag), /ET2099000952/, "het jaardossier niet");
});

test("een werk dat om middernacht UTC begint, krijgt geen verzonnen beginuur", () => {
  // Alleen voor GIPOD-werken (urenVanWerk); een A-Sign-fase om 00:00Z houdt haar nachtuur (tests/vaag-eind-slot.test.mjs).
  assert.equal(urenVanWerk("2099-12-01T00:00:00Z", "2099-12-01T18:00:00Z"), null);
  assert.equal(urenVanWerk("2099-11-04T00:00:00.000Z", "2099-11-04T21:59:00Z"), null);
  const [w] = werkEntries([{ gipodId: 19176027, title: "Gasleiding", owner: "Proefnet", status: "Concreet gepland", start: "2099-12-01T00:00:00Z", end: "2099-12-01T18:00:00Z", streets: [PROEF] }]);
  assert.deepEqual([w.time, w.timeText], ["", ""]);
  assert.equal(leesbaarUur(w), "Uur onbekend");
  // Een echt uur blijft, ook 's nachts, en 0.00 tot 23.59 in Brussel is de hele dag.
  assert.deepEqual(urenVanDag("2099-10-15T23:00:00Z", "2099-10-16T03:00:00Z"), { time: "01:00", timeText: "van 1.00 tot 5.00 uur" });
  assert.deepEqual(urenVanDag("2099-10-14T22:01:00Z", "2099-10-15T21:59:00Z"), { time: "", timeText: "hele dag" });
});

test("een bundel studentenactiviteiten noemt de plek zoals de kaart erin; een bundel werfzones de periode met het jaar", () => {
  const lid = (dossier, waar, location) => ({ uid: `publicSpace:dossier:${dossier}`, id: dossier, source: "publicSpace", theme: "publicSpace", group: "evenementen", title: "Vermoedelijk een studentenactiviteit in de doopperiode",
    start: "2099-03-12", end: "", location, item: { kind: "event", streets: [] }, uitleg: { watBron: "vermoeden", soortTekst: "", kern: [["Wat", "Vermoedelijk een studentenactiviteit."], ["Waar", waar]] } });
  const { bundels } = bundelLijst([lid("ET2099000961", "10 plekken van samen ongeveer 9,5 ha in de wijken Proefwijk en Testwijk.", "50 straten in Proefwijk en Anderwijk")], { vandaag: VANDAAG });
  assert.equal(bundels[0].location, "10 plekken van samen ongeveer 9,5 ha in de wijken Proefwijk en Testwijk");
  // De werfzones: "3 mei 2099 – 30 apr 2100", niet "3 mei – 30 apr" (dat leest als omgekeerd).
  const kaarten = bouw({ rows: RIJEN.filter((r) => !/000901/.test(r.reference || "") || r.kind !== "parking") });
  const werfzones = bundelLijst(kaarten, { straat: PROEF.name, vandaag: VANDAAG }).bundels.find((b) => b.bundel.soort === "werfzones");
  assert.match(werfzones.summary, /^1 feb – 31 dec · 3 mei 2099 – 30 apr 2100\. /);
});

test("een agendapunt in meer straten: de gekozen straat staat erbij als de plaats ze niet noemt; de volledige lijst als ze volledig is", () => {
  const item = { id: "asign-ev-et2099000971-2099-12-04", externalId: "ET2099000971", sourceId: "district-asign-evenementen", title: "Proefwinter", date: "2099-12-04",
    location: "Proefplein, Testkaai, Voorbeeldmarkt en 3 andere straten", straten: ["Proefplein", "Testkaai", "Voorbeeldmarkt", "Anderestraat", "Proefstraat", "Derdestraat"], stratenBevestigd: ["Proefstraat"] };
  // Een ouder bronbestand (niet volledig): alleen de gekozen straat, nooit de rest van de oudere lijst.
  assert.deepEqual(agendaStraten(item, "Proefstraat"), { jouwStraat: "Proefstraat", straten: [] });
  assert.deepEqual(agendaStraten(item, "Testkaai"), { jouwStraat: "", straten: [] }, "de plaats noemt de Testkaai al");
  assert.deepEqual(agendaStraten(item, "Anderestraat"), { jouwStraat: "", straten: [] }, "een straat die alleen de oudere lijst noemt: niet");
  // Een volledige lijst: alle zes, de gekozen straat vooraan, evenveel als "en 3 andere straten" in de plaats.
  const volledig = agendaStraten({ ...item, stratenVolledig: true }, "Derdestraat");
  assert.equal(volledig.jouwStraat, "Derdestraat");
  assert.deepEqual(volledig.straten, ["Derdestraat", "Proefplein", "Testkaai", "Voorbeeldmarkt", "Anderestraat", "Proefstraat"]);
});

test("districtsnieuws zonder plaats of uur zegt dat het bericht die niet geeft", () => {
  const lees = (rel) => JSON.parse(fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8"));
  const wijken = wijkFeatures(lees("site/geo/wijken.geo.json")).filter((f) => f.properties.code.startsWith("ANT")).map((f) => ({ code: f.properties.code, naam: f.properties.naam, box: bboxOf(f.geometry) }));
  const index = zoekIndex(buildPlaceIndex({ streets: lees("site/geo/straten.json").streets, wijken }), lees("site/geo/straten-stad.json"));
  const ekeren = districtenTabel().find((d) => d.key === "ekeren");
  const nieuws = (id, extra) => ({ id: `stad-news-ekeren-${id}-2099-11-08`, sourceId: "stad-districten", title: `Proefloop ${id}`, date: "2099-11-08", timeSlot: "Info", timeText: "", location: "District Ekeren, locatie via de officiële bron", link: "https://www.antwerpen.be/info/proef/x", ...extra });
  const items = [nieuws("a"), nieuws("b", { location: "Proefpark" }), nieuws("c", { timeSlot: "10:00", timeText: "10 uur" }), nieuws("d", { location: "Proefpark", timeText: "10 uur" })];
  const lijst = watDeSiteKent(ekeren, items, "2099-11-01", { index }).nieuws;
  assert.deepEqual(lijst.map((n) => n.ontbreekt || ""), ["Plaats en uur staan niet in het bericht.", "Het uur staat niet in het bericht.", "De plaats staat niet in het bericht.", ""]);
  // De meter telt het als vaag (een eerlijke zin, geen gok).
  assert.equal(vaagheidVanKaart({ titel: "Proefloop a", regels: [lijst[0].ontbreekt] }).kern, true);
});

test("privacyfilter: een achternaam die met een gewoon woord begint, of een naam vooraan, gaat nooit door", () => {
  for (const t of ["Doopfeest Standproefaert", "Feest Dagtesteaux", "Tent Spelvoorbeeldier", "Startlocatie doop Bartestier", "Feest Parktester", "Testpersoon feest", "Testpersoon tent", "Stand Testpersoon"]) {
    assert.equal(bruikbareBeschrijving(t), "", t);
    assert.equal(lijktPersoonsnaam(t), true, t);
  }
  // Trefwoorden, samenstellingen en plekken blijven.
  // (Een los gewoon woord met een hoofdletter, "Tweede halte" of "Kraam Proefplein", kan een naam zijn: tests/vaag-eind-slot.test.mjs.)
  for (const t of ["Startlocatie doop", "Doopfeest", "Wandelroute van start naar eind", "Spelletjeslocatie -> dooplocatie", "Verzamelpunt", "tweede halte", "kraam Proefplein", "Voor de trappen: doop", "Parkeerverbod voor hub bladslag"]) assert.equal(bruikbareBeschrijving(t), t, t);
  // Twee plekken met een koppelteken, met een straatnaam die met "Van" begint. Na "Van" of "De" is elk woord met een
  // hoofdletter een mogelijke naam, ook een woord op -straat (nakijkronde van head 0b264665): alleen een straat van de
  // inname of de straatas bewijst "Van De Teststraat".
  assert.equal(bruikbareBeschrijving("Inname: Proefplein-Van De Testerstraat"), "");
  assert.equal(lijktPersoonsnaam("Proefplein-Van De Teststraat"), true);
  assert.equal(lijktPersoonsnaam("Proefplein-Van De Teststraat", { straten: [{ name: "Van De Teststraat" }] }), false);
  assert.equal(lijktPersoonsnaam("Proefplein-Van De Teststraat", { isStraat: (n) => n === "Van De Teststraat" }), false);
});

test("het getal boven de lijst telt de items van een bundel mee; de legenda telt kaarten", () => {
  const punt = agendaEntry({ id: "act", title: "Proefactiviteit", date: "2099-03-14", location: "Proefstraat 1" }, "culture");
  const aanvragen = [1, 2, 3].map((i) => permitEntry({ id: `permit:${i}`, dossier: `OMV_20990000${i}0`, streets: [{ name: "Proefstraat" }] }));
  const terrassen = terrasEntries([1, 2, 3, 4].map((i) => ({ id: `terrace:${i}`, address: `Proefstraat ${i}`, terraceType: "Terras", status: "vergund" })));
  const tel = telPerSoort(lijstUniversum([punt, ...aanvragen, ...terrassen], VANDAAG));
  assert.deepEqual([tel.totaal, tel.items], [3, 8]);
  assert.equal(plekSubTekst({ totaal: tel.items, straat: true }), "8 items uit officiële bronnen.");
});

test("parkeerverbod bij het enige evenement: de titel zegt 'vermoedelijk', want A-Sign legt dat verband niet", () => {
  const p = publicSpaceEntry({ id: "parking:2099-000981|1", kind: "parking", kindLabel: "Parkeerverbod", title: "Aanvraag voor evenementen gesteund door de stad", reason: "Aanvraag voor evenementen gesteund door de stad", location: "Proefplein, 2000 Antwerpen", start: "2099-03-14T00:00:00.000Z", end: "2099-03-14T00:00:00.000Z", status: "Goedgekeurd", reference: "2099-000981", startTime: "00:00", endTime: "23:59", streets: [straat("Proefplein")] });
  const loop = { id: "asign-ev-et2099000981-2099-03-14", externalId: "ET2099000981", sourceId: "district-asign-evenementen", title: "Proefloop", date: "2099-03-14", location: "Proefplein", straten: ["Proefplein"], stratenVolledig: true, info: "Naam met de hand nagekeken bij een publieke bron. Evenementendossier ET2099000981 van de stad (A-Sign).", category: "sport" };
  const [pn] = verrijkMetContext([p], { straat: "Proefplein", vandaag: VANDAAG, agendaItems: [loop] });
  assert.equal(pn.title, "Parkeerverbod, vermoedelijk voor Proefloop");
  assert.match(pn.regels.find(([k]) => k === "Evenement")[1], /het enige evenement in deze straat op die dag/);
});

test("een parkeerverbod buiten de straten van de werfzone hoort er niet bij: het blijft een losse kaart", () => {
  // Een parkeerverbod in de Anderestraat (een straat van de omleiding, niet van de werfzone): geen werfkaart.
  const rows = [fase("GW2099-000991", 1, "2099-02-01", "2099-03-31", { omleiding: [ANDER] }), verbod("2099-000991", "2099-02-01", "2099-03-31", { plek: ANDER })];
  const kaarten = bouw({ rows });
  assert.ok(kaarten.some((e) => e.uid === "publicSpace:parking:2099-000991|1"), "het parkeerverbod blijft los");
  assert.equal(kaarten.find((e) => e.item?.kind === "sgw").werf.parkeerverboden.length, 0);
});

test("een parkeerverbod staat nooit in een ingeklapte bundel: los, aan een werfzone, of als enige inname van een dossier", () => {
  const p = publicSpaceEntry(verbod("2099-000999", "2099-03-01", "2099-03-02"));
  assert.equal(bundelSoort(p), "");
  const zone = bouw({ rows: RIJEN }).find((e) => e.uid === "publicSpace:sgw:GW2099-000901|1");
  assert.equal(bundelSoort(zone), "");
  const dossier = (innameSoort) => ({ uid: "publicSpace:dossier:ET2099000999", source: "publicSpace", start: "2099-03-05", uitleg: { watBron: "leeg", innameSoort } });
  assert.equal(bundelSoort(dossier("Parkeerverbod")), "");
  assert.equal(bundelSoort(dossier("Inname")), "innames", "een inname zonder omschrijving wel");
});
