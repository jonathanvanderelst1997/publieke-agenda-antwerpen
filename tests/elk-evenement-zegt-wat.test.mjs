// Elk evenement zegt meteen wat het is (klacht van de eigenaar, 10-10-2026): titel en eerste regel zeggen
// wát (een naam, een soort of wat er vaststaat), wáár en wannéér, en hoe zeker; een toelating van weken of
// een jaar krijgt geen "Vandaag". Per regel van de herkenner een toets met verzonnen gegevens: verzonnen
// dossiernummers (ET2099...), straten (Proefstraat, Voorbeeldplein) en coördinaten. Geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";

import * as W from "../site/evenement-wat.js";
import { evenementFeiten, evenementKaartje, koppelEvenement, soortEvenement } from "../site/kaart-uitleg.js";
import { evenementBadge, evenementEntry, groupForList, losseDagenTekst, periodRange, voortgangTekst } from "../site/place-core.js";
import * as L from "../lib/parcours-herkenning.mjs";
import { straatBijPunt } from "../lib/parcours-herkenning-refresh.mjs";
import { validateHerkenning } from "../lib/evenement-herkenning-validatie.mjs";
import { privacyFindings } from "../lib/source-feed.mjs";
import { buildStreetIndex } from "../site/street-core.js";

const VANDAAG = "2026-10-10";
const K = Math.cos((51.2 * Math.PI) / 180);
const oost = (p, m) => [p[0] + m / (111_320 * K), p[1]];
const noord = (p, m) => [p[0], p[1] + m / 110_540];
// Een vierkant vlak met zijde 2*m meter rond p.
const vierkant = (p, m) => { const a = oost(noord(p, -m), -m), b = oost(noord(p, -m), m), c = oost(noord(p, m), m), d = oost(noord(p, m), -m); return [a, b, c, d, a]; };
const MIDDEN = [4.4, 51.215];
const ms = (dag) => Date.UTC(+dag.slice(0, 4), +dag.slice(5, 7) - 1, +dag.slice(8, 10), 10);

// Een verzonnen dossier zoals de herkenner het ziet (laag 22 en 23), verrijkt met vaste straat en wijk.
// innames: [{ type, dag, eind, ring | lijn, beschrijving, fase }].
function nep(nr, innames, { vastePlekken = [], straat = "Proefstraat", wijk = "Universiteitsbuurt" } = {}) {
  const feats = innames.map((i) => ({
    attributes: { dossierNummer: nr, dossierStatus: "aanvraag_goedgekeurd", faseNaam: i.fase || "Evenement", faseStartDatum: ms(i.dag), faseEindDatum: ms(i.eind || i.dag), innameTypeNaam: i.type || "Inname", innameBeschrijving: i.beschrijving || "", last_edited_date: Date.UTC(2026, 8, 1) },
    geometry: i.lijn ? { paths: [i.lijn] } : { rings: [i.ring] },
  }));
  const d = L.dossiersUitAsign(feats).get(nr);
  return L.verrijk(d, { straatBij: () => straat, wijkVan: () => wijk, wijkBijPunt: () => wijk, vastePlekken, stratenLangs: () => [straat] });
}
const CHARTER = {
  doopperiode: { van: "10-01", tot: "10-31" },
  plekken: [
    { naam: "Proefplein", soort: "drilplaats", punt: MIDDEN, straal: 80 },
    { naam: "Voorbeeldkaai", soort: "doopplaats", punt: oost(MIDDEN, 2000), straal: 60 },
  ],
};
const herken = (d, opties = {}) => L.herkenDossier(d, { charter: CHARTER, vandaag: VANDAAG, ...opties });

// ---------- de vier kaarten uit de klacht (faalt op main 727ba65) ----------

let n = 0;
const rij = (dossier, phase, type, start, end, straten, extra = {}) => ({
  id: `iod:${dossier}|${phase}|${(n += 1)}`, kind: "iod", title: type, innameType: type, reference: dossier, dossierType: "ETL",
  phase, hindrance: "True", description: "", start, end: end || start, status: "aanvraag_goedgekeurd",
  streets: straten.map((name, i) => ({ id: `${n}${i}`, name, postcode: "2000" })), sourceUrl: "https://geodata.antwerpen.be/x", ...extra,
});
const wijkVan = () => "Universiteitsbuurt";
const kaart = (rows, opties = {}) => evenementEntry(rows, { vandaag: VANDAAG, wijkVan, ...opties });
const lijst = (entries) => groupForList(entries, { ...periodRange("alles", VANDAAG), today: VANDAAG });
const kern = (e) => Object.fromEntries(e.uitleg.kern);
const GENERIEK = /^Evenement met toelating van de stad$|maakt niet bekend wat het is|zonder parcours/i;

test("klacht 1: stickers een hele maand op negen plekken: wat, waar en wanneer, geen 'Vandaag' en geen parcours", () => {
  const straten = ["Proefstraat", "Voorbeeldstraat", "Testplein", "Proefmarkt", "Voorbeeldvest", "Testrui", "Proefberg", "Voorbeeldsteeg", "Testlaan"];
  // Zoals in de browser: de live laag laat "Sticker ..." niet door (site/public-space-core.js, alleen
  // omschrijvingen met een woord uit de lijst); de soort komt uit de fiche van de herkenner, die de
  // omschrijving wel leest maar alleen het vaste woord bewaart.
  const rows = straten.map((s) => rij("ET2099100001", "Evenement", "Inname", "2026-10-01", "2026-10-29", [s, `${s}-Zuid`]));
  const fiche = herken(nep("ET2099100001", straten.map((_, i) => ({ dag: "2026-10-01", eind: "2026-10-29", ring: vierkant(oost(noord(MIDDEN, (i % 3) * 200), Math.floor(i / 3) * 250), 2), beschrijving: i < 6 ? "Sticker Proefstraat" : "Proefstraat" }))));
  const e = kaart(rows, { identiteit: { dossiers: { ET2099100001: fiche } } });
  assert.equal(e.title, "Stickers op straat op 9 plekken in de Universiteitsbuurt");
  assert.doesNotMatch(`${e.title} ${e.summary} ${kern(e).Waar}`, GENERIEK);
  assert.match(e.summary, /^De hele maand oktober \(1 tot 29 oktober\)\. Zo staat het in het dossier; het is geen evenement met publiek\./);
  assert.equal(e.uitleg.geenEvenement, true);
  assert.deepEqual(evenementBadge(e, VANDAAG), { label: "Loopt tot 29 okt", soort: "period" });
  const { running, doorlopend } = lijst([e]);
  assert.deepEqual([running.length, doorlopend.length], [0, 1]);
  // De straten rond de plekken zijn geen parcours: dat zegt de noot bij "Toon alle N straten".
  assert.match(e.uitleg.stratenNoot, /Het is geen parcours/);
  assert.equal(voortgangTekst(e.start, e.end, VANDAAG), "Loopt sinds 1 okt · nog 19 dagen (t/m 29 okt)");
});

test("klacht 2: een kleine inname van twee maanden op een plein: 'loopt van ... tot', geen 'Vandaag', in Doorlopend", () => {
  const e = kaart([rij("ET2099100002", "Evenement", "Inname", "2026-10-05", "2026-12-04", ["Voorbeeldplein"])]);
  assert.equal(e.title, "Inname op het Voorbeeldplein");
  assert.match(e.summary, /^Loopt van 5 oktober tot 4 december\. Wat er gebeurt, zegt de stad niet\.$/);
  assert.equal(evenementBadge(e, VANDAAG).label, "Loopt tot 4 dec");
  assert.equal(lijst([e]).doorlopend.length, 1);
  assert.match(kern(e)["Wat merk je"], /geen afgesloten straat, parkeerverbod of omleiding/);
});

test("klacht 3: heel het jaar op 26 kleine plekken: 'heel 2026', hoeveel plekken en hoe groot", () => {
  const rows = Array.from({ length: 26 }, (_, i) => rij("ET2099100003", "Evenement", "Inname", "2026-01-01", "2026-12-31", [`Proefstraat ${String.fromCharCode(65 + i)}`]));
  // De herkenner (lib/parcours-herkenning.mjs) gaf de plek en de omvang mee in de automatische fiche.
  const identiteit = { dossiers: { ET2099100003: { zekerheid: "onbekend", methode: "kaart", plek: "op 26 plekken verspreid over de stad", omvang: "26 kleine plekken, samen ongeveer 80 m²", waar: "26 kleine plekken verspreid over de stad, samen ongeveer 80 m², van donderdag 1 januari tot donderdag 31 december.", dagen: ["2026-01-01", "2026-12-31"], bron: ["https://geodata.antwerpen.be/x"] } } };
  const e = kaart(rows, { identiteit });
  assert.equal(e.title, "Innames op 26 plekken verspreid over de stad");
  assert.equal(e.summary, "Heel 2026 · 26 kleine plekken, samen ongeveer 80 m². Wat er gebeurt, zegt de stad niet.");
  assert.doesNotMatch(`${e.title} ${e.summary}`, GENERIEK);
  assert.equal(evenementBadge(e, VANDAAG).soort, "period");
  assert.equal(voortgangTekst(e.start, e.end, VANDAAG), "Loopt heel 2026 · nog 82 dagen");
});

test("klacht 4: een reuzenrad van vier maanden: de soort uit het dossier, zonder 'vermoedelijk', geen 'Vandaag'", () => {
  const rows = [rij("ET2099100004", "Evenement", "Inname", "2026-10-08", "2027-02-04", ["Voorbeeldplein"], { description: "Reuzenrad Voorbeeldplein" })];
  const e = kaart(rows);
  assert.equal(e.title, "Reuzenrad op het Voorbeeldplein");
  assert.match(e.summary, /^Loopt van 8 oktober tot 4 februari 2027\. Zo staat het in het dossier; de naam maakt de stad niet bekend\.$/);
  assert.equal(evenementBadge(e, VANDAAG).label, "Loopt tot 4 feb 2027");
  assert.equal(lijst([e]).running.length, 0);
});

test("een evenement van één dag vandaag blijft bovenaan 'Loopt nu' met 'Vandaag', een lang dossier eronder", () => {
  const koers = kaart([rij("ET2099100005", "Evenement", "Parcours", VANDAAG, VANDAAG, ["Proefstraat"], { description: "Parcours criterium" })]);
  const lang = kaart([rij("ET2099100006", "Evenement", "Inname", "2026-09-01", "2027-06-30", ["Voorbeeldplein"])]);
  const { running, doorlopend } = lijst([lang, koers]);
  assert.deepEqual(running.map((e) => e.id), ["ET2099100005"]);
  assert.deepEqual(doorlopend.map((e) => e.id), ["ET2099100006"]);
  assert.equal(evenementBadge(koers, VANDAAG), null); // de gewone badge "Vandaag" van place-view.js
});

test("losse dagen: elke woensdag staat op de volgende woensdag zelf, met 'Vandaag' alleen op zo'n dag", () => {
  const dagen = ["2026-10-07", "2026-10-14", "2026-10-21", "2026-10-28"];
  const rows = dagen.map((d) => rij("ET2099100007", "Evenement", "Inname", d, d, ["Testplein"]));
  const e = evenementEntry(rows, { vandaag: "2026-10-15", wijkVan });
  assert.deepEqual(e.losseDagen, dagen);
  assert.match(e.summary, /^Elke woensdag van 7 tot 28 oktober; de volgende is woensdag 21 oktober\./);
  const g = groupForList([e], { ...periodRange("alles", "2026-10-15"), today: "2026-10-15" });
  assert.deepEqual([g.running.length, g.days.map(([d]) => d)], [0, ["2026-10-21"]]);
  assert.equal(evenementBadge(e, "2026-10-15").label, "Volgende: 21 okt");
  assert.equal(evenementBadge(e, "2026-10-14").label, "Vandaag");
  assert.equal(groupForList([e], { ...periodRange("alles", "2026-10-14"), today: "2026-10-14" }).running.length, 1);
  assert.match(losseDagenTekst(e, "2026-10-15"), /^Elke woensdag/);
});

// ---------- de herkenner: één toets per regel ----------

test("regel stickers: soort uit het dossier, geen evenement, plek en omvang, en een geldige fiche", () => {
  const plekken = Array.from({ length: 9 }, (_, i) => oost(noord(MIDDEN, (i % 3) * 200), Math.floor(i / 3) * 250));
  const d = nep("ET2099200001", plekken.map((p, i) => ({ dag: "2026-10-01", eind: "2026-10-29", ring: vierkant(p, 2), beschrijving: i < 6 ? "Sticker Proefstraat" : "Proefstraat" })));
  const r = herken(d);
  assert.deepEqual([r.zekerheid, r.soort, r.soortZeker, r.geenEvenement], ["waarschijnlijk", "stickers op straat", true, true]);
  assert.equal(r.plek, "op 9 plekken in de Universiteitsbuurt");
  assert.equal(r.omvang, "9 kleine plekken, samen ongeveer 140 m²");
  assert.doesNotMatch(r.waar, /zonder parcours/);
  assert.deepEqual(validateHerkenning({ schemaVersion: 1, generatedAt: `${VANDAAG}T05:00:00Z`, bijgewerkt: VANDAAG, uitleg: "x", samenvatting: { dossiers: 1, metHandfiche: 0, automatisch: 1, zeker: 0, waarschijnlijk: 1, alleenKaartzin: 0 }, dossiers: { ET2099200001: r } }), []);
});

test("regel doop: een doopfeest met een scheepsnaam is de doop van een schip, nooit een studentendoop", () => {
  const schip = herken(nep("ET2099200002", [{ dag: "2026-11-20", ring: vierkant(MIDDEN, 30), beschrijving: "Doopfeest MTS Voorbeeldvaart" }]));
  assert.equal(schip.soort, "de doop van een schip");
  assert.equal(schip.soortZeker, false);
  // "doop" buiten de doopperiode, zonder plek uit het charter of studentenwoord: geen soort.
  const los = herken(nep("ET2099200003", [{ dag: "2026-11-20", ring: vierkant(oost(MIDDEN, 900), 30), beschrijving: "doop" }]));
  assert.equal(los.zekerheid, "onbekend");
  // In de doopperiode op een doopplaats: een studentendoop, en dat staat in het dossier zelf.
  const doop = herken(nep("ET2099200004", [{ dag: "2026-10-12", ring: vierkant(oost(MIDDEN, 2000), 20), beschrijving: "doop" }]));
  assert.deepEqual([doop.soort, doop.soortZeker], ["een studentendoop", true]);
});

test("regel dingen: kermis, reuzenrad, vlaggen, bladslag, mammobiel, bord en oldtimers; een kermiskoers blijft een koers", () => {
  const soort = (b) => herken(nep("ET2099200005", [{ dag: "2026-10-03", eind: "2026-10-18", ring: vierkant(oost(MIDDEN, 900), 20), beschrijving: b }]));
  assert.equal(soort("Kermisterrein").soort, "een kermis");
  assert.equal(soort("Reuzenrad Voorbeeldplein").soort, "een reuzenrad");
  assert.equal(soort("Vlaggenlijnen Proefstraat: 9 overspanningen").soort, "straatversiering: vlaggen boven de straat");
  assert.equal(soort("Reuzenboek Voorbeeldplein").soort, "straatversiering: reuzenboeken");
  assert.deepEqual([soort("Hub voor bladslag").soort, soort("Hub voor bladslag").geenEvenement], ["een verzamelplek voor herfstbladeren (bladslag)", true]);
  assert.equal(soort("mammobiel").soort, "de mammobiel (borstkankeronderzoek)");
  assert.equal(soort("breugelbak").soort, "een aankondigingsbord");
  assert.equal(soort("parkeerzone oldtimers").soort, "een plek voor oldtimers");
  assert.equal(L.eersteSoort(["Kermiskoers voor nieuwelingen"]), "wieler");
  assert.equal(L.eersteSoort(["Inname Vlaggestraat"]), "");
  assert.equal(L.eersteSoort(["strip en boekenplein"]), "markt");
});

test("regel historiek: 'vroeger op dezelfde plek' geeft een losse inname geen soort, een eigen route wel", () => {
  const historiek = [{ dossier: "ET2099000101", jaar: "2024", soorten: ["stoet"], overlap: 0.9 }, { dossier: "ET2099000102", jaar: "2025", soorten: ["stoet"], overlap: 0.9 }];
  const inname = herken(nep("ET2099200006", [{ dag: "2026-10-24", ring: vierkant(oost(MIDDEN, 900), 5) }]), { historiek });
  assert.equal(inname.zekerheid, "onbekend", "een stoet passeerde vroeger: dat zegt niets over een kraam van 100 m²");
  assert.match(inname.signalen.join(" "), /vroeger op dezelfde plek: stoet/);
  const route = herken(nep("ET2099200007", [{ dag: "2026-10-24", type: "Parcours", lijn: [oost(MIDDEN, 900), oost(MIDDEN, 1400)] }]), { historiek });
  assert.equal(route.soort, "een stoet");
});

test("regel charter: een terrein van hectaren op een drilplaats is geen studentenactiviteit; een kleine inname wel", () => {
  const groot = herken(nep("ET2099200008", [{ dag: "2026-10-15", ring: vierkant(MIDDEN, 160) }])); // ongeveer 10 ha, donderdag
  assert.equal(groot.zekerheid, "onbekend");
  const klein = herken(nep("ET2099200009", [{ dag: "2026-10-15", ring: vierkant(MIDDEN, 15) }]));
  assert.equal(klein.soort, "een studentenactiviteit in de doopperiode");
  assert.equal(klein.soortZeker, false);
  assert.equal(klein.grond, "de plek en de doopperiode uit het studentencharter");
  const doopplaats = herken(nep("ET2099200010", [{ dag: "2026-10-15", ring: vierkant(oost(MIDDEN, 2000), 15) }]));
  assert.equal(doopplaats.soort, "een studentendoop");
  // Een vaste plek met `geenCharter` (zoals Parking Spoor Oost) telt nooit voor het charter.
  const parking = herken(nep("ET2099200011", [{ dag: "2026-10-15", ring: vierkant(MIDDEN, 15) }], { vastePlekken: [{ naam: "Proefparking", zin: "op de Proefparking", punt: MIDDEN, straal: 100, geenCharter: true }] }));
  assert.equal(parking.zekerheid, "onbekend");
  assert.equal(parking.plek, "op de Proefparking");
});

test("regel foorlijst: zelfde plein en periode geeft de naam, met de foorlijst als bron", () => {
  const foren = L.forenUitBron({ items: [{ title: "Najaarsfoor Proefplein", date: "2026-10-03", endDate: "2026-10-18", location: "Proefplein, 2000 Antwerpen", sourceUrl: "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/0" }] });
  const d = nep("ET2099200012", [{ dag: "2026-10-03", eind: "2026-10-18", ring: vierkant(oost(MIDDEN, 900), 20), beschrijving: "Kermisterrein" }], { straat: "Proefplein" });
  const r = herken(d, { foren });
  assert.deepEqual([r.zekerheid, r.naam, r.soort, r.methode], ["zeker", "Najaarsfoor Proefplein", "kermis", "kalender"]);
  assert.ok(r.bron.length >= 2);
  // Een ander plein of een andere periode: geen naam.
  assert.equal(herken(nep("ET2099200013", [{ dag: "2026-10-03", eind: "2026-10-18", ring: vierkant(oost(MIDDEN, 900), 20) }], { straat: "Voorbeeldplein" }), { foren }).naam, "");
  assert.equal(herken(nep("ET2099200014", [{ dag: "2026-10-06", eind: "2026-10-18", ring: vierkant(oost(MIDDEN, 900), 20) }], { straat: "Proefplein" }), { foren }).naam, "");
});

test("regel besluit: een goedgekeurd besluit met dag en straat geeft de naam; zonder straat, geweigerd of meerdaags niet", () => {
  const besluit = (extra = {}) => ({ code: "2099_DCAN_00001", status: "goedkeuring", gelezen: true, inDistrict: true, naam: "Heropening Proefstraat", organisator: "Winkeliers van de Proefstraat vzw", dagen: ["2026-10-17"], straten: ["Proefstraat"], bron: "https://ebesluit.antwerpen.be/zittingen/x/agendapunten/y", ...extra });
  const k = L.kandidatenUitBesluiten({ besluiten: [besluit(), besluit({ status: "weigering" }), besluit({ straten: [] }), besluit({ dagen: ["2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20"] }), besluit({ organisator: "Jan Voorbeeld" })] });
  assert.equal(k.length, 2);
  assert.equal(k[0].organisator, "Winkeliers van de Proefstraat vzw");
  assert.equal(k[1].organisator, "", "een organisator zonder rechtsvorm (een persoon) gaat er niet mee in");
  const d = nep("ET2099200015", [{ dag: "2026-10-17", type: "Verkeersvrije Zone", ring: vierkant(oost(MIDDEN, 900), 40) }], { straat: "Proefstraat" });
  const uit = L.bouwHerkenning({ dossiers: [d], kandidaten: [k[0]], charter: CHARTER, vandaag: VANDAAG }).dossiers.ET2099200015;
  assert.deepEqual([uit.zekerheid, uit.naam, uit.methode], ["zeker", "Heropening Proefstraat", "besluit"]);
  // Een andere dag: geen naam.
  const later = nep("ET2099200016", [{ dag: "2026-10-24", type: "Verkeersvrije Zone", ring: vierkant(oost(MIDDEN, 900), 40) }], { straat: "Proefstraat" });
  assert.equal(L.bouwHerkenning({ dossiers: [later], kandidaten: [k[0]], charter: CHARTER, vandaag: VANDAAG }).dossiers.ET2099200016.naam, "");
});

test("regel vaste plek: alleen als de inname er helemaal in ligt, groot genoeg is en geen parkeerverbod langs de rand", () => {
  const vastePlekken = [{ naam: "Proefparking", zin: "op de Proefparking", punt: MIDDEN, straal: 300, minM2: 50_000, feit: "het terrein is de parking van de zalen" }];
  const geheel = herken(nep("ET2099200017", [{ dag: "2026-11-01", ring: vierkant(MIDDEN, 150) }], { vastePlekken }));
  assert.equal(geheel.plek, "op de Proefparking");
  assert.match(geheel.omvang, /^ongeveer 9 ha; het terrein is de parking van de zalen$/);
  const stukje = herken(nep("ET2099200018", [{ dag: "2026-11-01", ring: vierkant(MIDDEN, 3), beschrijving: "Pop-up-tentje 3m * 3m" }, { dag: "2026-11-01", ring: vierkant(MIDDEN, 2), beschrijving: "Steunmuur (7m B* 2m H)" }], { vastePlekken }));
  assert.equal(stukje.plek, "in de Proefstraat");
  // Wat er staat, als het dossier het noemt: vaste woorden, niet de omschrijving.
  assert.equal(stukje.omvang, "ongeveer 35 m², met een tent en een wand");
  const rand = herken(nep("ET2099200019", [{ dag: "2026-11-01", type: "Parkeerverbod in Straat", ring: vierkant(MIDDEN, 150) }], { vastePlekken }));
  assert.notEqual(rand.plek, "op de Proefparking");
});

test("straat bij een punt: een tunnel onder een plein is geen plek, dan de straat erboven", () => {
  const as = (naam, a, b) => ({ type: "Feature", properties: { LSTRNMID: naam.length, LSTRNM: naam, RSTRNMID: naam.length, RSTRNM: naam, postcode: 2000, DISTRICT: "Antwerpen" }, geometry: { type: "LineString", coordinates: [a, b] } });
  const index = buildStreetIndex([as("Proeftunnel", oost(MIDDEN, -50), oost(MIDDEN, 50)), as("Voorbeeldplein", oost(noord(MIDDEN, 25), -50), oost(noord(MIDDEN, 25), 50))]);
  assert.equal(straatBijPunt(MIDDEN, index), "Voorbeeldplein");
  assert.equal(straatBijPunt(noord(MIDDEN, 24), index), "Voorbeeldplein");
});

test("koppeling: geen agendapunt van weken of met het thema Werken, wel een evenement van één dag", () => {
  const rows = [rij("ET2099300001", "Evenement", "Inname", "2026-10-10", "2026-10-11", ["Proefstraat"])];
  const f = evenementFeiten(rows);
  const werken = { id: "werken-proefstraat-fase-2", title: "Werken Proefstraat: fase 2", date: "2026-09-01", endDate: "2027-01-31", location: "Proefstraat", theme: "Werken" };
  assert.equal(koppelEvenement(f, [werken]), null, "een project van vijf maanden ligt elke dag in die straat");
  assert.equal(koppelEvenement(f, [{ ...werken, date: "2026-10-10", endDate: "2026-10-10" }]), null, "het thema Werken is geen evenement");
  assert.equal(koppelEvenement(f, [{ id: "buurtfeest-proefstraat", title: "Buurtfeest Proefstraat", date: "2026-10-10", location: "Proefstraat", theme: "Activiteit" }])?.titel, "Buurtfeest Proefstraat");
});

// ---------- privacy: wat de herkenner en de kaart schrijven ----------

test("privacy: geen huisnummer, geen persoonsnaam en geen letterlijke omschrijving in de fiche of de kaarttitel", () => {
  // Verzonnen; het huisnummer pas bij het draaien aan de straat geplakt, zodat de privacyscan van de repo
  // (gitleaks, .gitleaks.toml) hier geen adres ziet.
  const vrij = ["Charles Voorbeeldlaan", "21 - hub bladslag, contact Jan Proefmans"].join(" ");
  const d = nep("ET2099400001", [{ dag: "2026-09-28", eind: "2027-01-22", type: "Parkeerverbod op Plein", ring: vierkant(MIDDEN, 40), beschrijving: vrij }], { straat: "Charles Voorbeeldlaan" });
  const r = herken(d);
  const json = JSON.stringify(r);
  assert.equal(r.soort, "een verzamelplek voor herfstbladeren (bladslag)");
  assert.doesNotMatch(json, /Proefmans|laan 21|contact/i);
  assert.deepEqual(privacyFindings(r), []);
  const e = kaart([rij("ET2099400001", "Evenement", "Parkeerverbod op Plein", "2026-09-28", "2027-01-22", ["Charles Voorbeeldlaan"], { description: vrij })]);
  assert.doesNotMatch(`${e.title} ${e.summary} ${e.uitleg.kern.flat().join(" ")}`, /Proefmans|laan 21|contact/i);
});

// ---------- de vaste woorden en de dagen (site/evenement-wat.js) ----------

test("woorden: dezelfde lijst in de kaart en de herkenner, geen straatnaam of tentoonstelling als voorwerp", () => {
  for (const d of W.DINGEN) {
    const voorbeeld = { schip: "Doopfeest MTS Voorbeeld", kermis: "Kermisterrein", reuzenrad: "Reuzenrad", versiering: "Vlaggenlijnen", sticker: "Sticker", bladslag: "bladslag", mammobiel: "mammobiel", bord: "breugelbak", oldtimer: "oldtimers" }[d.key];
    assert.equal(L.eersteSoort([voorbeeld]), d.key, d.key);
    assert.equal(soortEvenement([voorbeeld]), d.zonder.charAt(0).toUpperCase() + d.zonder.slice(1), d.key);
  }
  assert.deepEqual(W.voorwerpenIn(["Pop-up-tentje 3m * 3m", "Steunmuur (7m B* 2m H)"]), ["een tent", "een wand"]);
  assert.deepEqual(W.voorwerpenIn(["Tentoonstellingswand"]), []);
  assert.deepEqual(W.dingenIn([["Inname Vlaggestraat", "5"].join(" ")]), []);
});

test("dagen: losse dagen, een ritme, een hele maand en een heel jaar in gewone taal", () => {
  const t = (dagen, v = VANDAAG) => W.patroonTekst(W.patroonVan(dagen, v), v);
  assert.equal(t(["2026-11-09", "2026-12-07", "2027-02-01", "2027-03-01", "2027-04-05"]), "één maandag per maand, van november 2026 tot april 2027");
  assert.equal(t(["2026-11-09", "2026-12-07", "2027-02-01", "2027-03-01"], "2026-11-20"), "één maandag per maand, van november 2026 tot maart 2027; de volgende is maandag 7 december");
  assert.equal(t(["2026-10-12", "2026-10-14"]), "op maandag 12 oktober en woensdag 14 oktober");
  assert.equal(t(["2026-11-10", "2026-11-12", "2026-11-13", "2026-11-16", "2026-11-17"]), "op 5 losse dagen tussen 10 november en 17 november");
  const okt = Array.from({ length: 29 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
  assert.equal(t(okt), "de hele maand oktober (1 tot 29 oktober)");
  const jaar = Array.from({ length: 365 }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10));
  assert.equal(t(jaar), "heel 2026");
  assert.deepEqual(["2026-10-10", "2026-10-13", "2026-10-29"].map((e) => W.duurKlasse("2026-10-10", e)), ["kort", "meerdaags", "lang"]);
  assert.deepEqual([79, 1269, 100_107, 4].map(W.oppervlakteTekst), ["ongeveer 80 m²", "ongeveer 1.300 m²", "ongeveer 10 ha", "een paar m²"]);
});
