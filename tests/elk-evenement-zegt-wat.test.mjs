// Elk evenement zegt meteen wat het is (klacht van de eigenaar, 10-10-2026): titel en eerste regel zeggen
// wát (een naam, een soort of wat er vaststaat), wáár en wannéér, en hoe zeker; een toelating van weken of
// een jaar krijgt geen "Vandaag". Per regel van de herkenner een toets met verzonnen gegevens: verzonnen
// dossiernummers (ET2099...), straten (Proefstraat, Voorbeeldplein) en coördinaten. Geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";

import * as W from "../site/evenement-wat.js";
import * as KU from "../site/kaart-uitleg.js";
import { evenementFeiten, evenementKaartje, koppelEvenement, soortEvenement } from "../site/kaart-uitleg.js";
import * as PC from "../site/place-core.js";
import { evenementBadge, evenementEntry, groupForList, losseDagenTekst, periodRange, voortgangTekst } from "../site/place-core.js";
import * as L from "../lib/parcours-herkenning.mjs";
import * as R from "../lib/parcours-herkenning-refresh.mjs";
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
function nep(nr, innames, { vastePlekken = [], straat = "Proefstraat", wijk = "Universiteitsbuurt", straatBij = () => straat, wijkVan = () => wijk } = {}) {
  const feats = innames.map((i) => ({
    attributes: { dossierNummer: nr, dossierStatus: "aanvraag_goedgekeurd", faseNaam: i.fase || "Evenement", faseStartDatum: ms(i.dag), faseEindDatum: ms(i.eind || i.dag), innameTypeNaam: i.type || "Inname", innameBeschrijving: i.beschrijving || "", last_edited_date: Date.UTC(2026, 8, 1) },
    geometry: i.lijn ? { paths: [i.lijn] } : { rings: [i.ring] },
  }));
  const d = L.dossiersUitAsign(feats).get(nr);
  return L.verrijk(d, { straatBij, wijkVan, wijkBijPunt: () => wijk, vastePlekken, stratenLangs: () => [straat] });
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

test("klacht 1: stickers een maand op zes van de negen plekken: wat, waar en wanneer, geen 'Vandaag' en geen parcours", () => {
  const straten = ["Proefstraat", "Voorbeeldstraat", "Testplein", "Proefmarkt", "Voorbeeldvest", "Testrui", "Proefberg", "Voorbeeldsteeg", "Testlaan"];
  // Zoals in de browser: de live laag laat "Sticker ..." niet door (site/public-space-core.js, alleen
  // omschrijvingen met een woord uit de lijst); de soort komt uit de fiche van de herkenner, die de
  // omschrijving wel leest maar alleen het vaste woord bewaart.
  const rows = straten.map((s) => rij("ET2099100001", "Evenement", "Inname", "2026-10-01", "2026-10-29", [s, `${s}-Zuid`]));
  const fiche = herken(nep("ET2099100001", straten.map((_, i) => ({ dag: "2026-10-01", eind: "2026-10-29", ring: vierkant(oost(noord(MIDDEN, (i % 3) * 200), Math.floor(i / 3) * 250), 2), beschrijving: i < 6 ? "Sticker Proefstraat" : "Proefstraat" }))));
  const e = kaart(rows, { identiteit: { dossiers: { ET2099100001: fiche } } });
  // Alleen de plekken die stickers noemen (nakijkronde 11-10: 6 van de 9, niet "op 9 plekken").
  assert.equal(e.title, "Stickers op straat op 6 plekken in de Universiteitsbuurt");
  assert.doesNotMatch(`${e.title} ${e.summary} ${kern(e).Waar}`, GENERIEK);
  // 1 tot 29 oktober is niet "de hele maand oktober" (die heeft 31 dagen).
  assert.match(e.summary, /^Loopt van 1 tot 29 oktober\. Zo staat het in het dossier; het is geen evenement met publiek\./);
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
  // Over de jaarwissel: beide jaartallen.
  assert.match(e.summary, /^Loopt van 8 oktober 2026 tot 4 februari 2027\. Zo staat het in het dossier; de naam maakt de stad niet bekend\.$/);
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
  assert.equal(r.plek, "op 6 plekken in de Universiteitsbuurt");
  assert.match(r.reden, /stickers op straat, op 6 van de 9 plekken\.$/);
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
  assert.equal(soort("Kermis op het plein").soort, "een kermis");
  assert.equal(soort("Reuzenrad Voorbeeldplein").soort, "een reuzenrad");
  assert.equal(soort("Vlaggenlijnen Proefstraat: 9 overspanningen").soort, "straatversiering: vlaggen boven de straat");
  assert.equal(soort("Reuzenboek Voorbeeldplein").soort, "straatversiering: reuzenboeken");
  assert.deepEqual([soort("Verzamelpunt bladslag").soort, soort("Verzamelpunt bladslag").geenEvenement], ["een verzamelplek voor herfstbladeren (bladslag)", true]);
  assert.equal(soort("Standplaats mammobiel").soort, "de mammobiel (borstkankeronderzoek)");
  assert.equal(soort("twee breugelbakken").soort, "een aankondigingsbord");
  assert.equal(soort("oldtimers bij de ingang").soort, "een plek voor oldtimers");
  assert.equal(L.eersteSoort(["Kermiskoers voor nieuwelingen"]), "wieler");
  assert.equal(L.eersteSoort(["Inname Vlaggestraat"]), "");
  assert.equal(L.eersteSoort(["boekenplein met strips"]), "markt");
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
  const d = nep("ET2099200012", [{ dag: "2026-10-03", eind: "2026-10-18", ring: vierkant(oost(MIDDEN, 900), 20), beschrijving: "Kermis op het plein" }], { straat: "Proefplein" });
  const r = herken(d, { foren });
  // Een eigen methode: de voetnoot zegt "de foorlijst", niet "een agenda" (nakijkronde 11-10).
  assert.deepEqual([r.zekerheid, r.naam, r.soort, r.methode], ["zeker", "Najaarsfoor Proefplein", "kermis", "foorlijst"]);
  assert.match(KU.AUTO_HERKOMST[r.methode] || "", /foorlijst van de stad/);
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
  const stukje = herken(nep("ET2099200018", [{ dag: "2026-11-01", ring: vierkant(MIDDEN, 3), beschrijving: "Partytentje 4m x 4m" }, { dag: "2026-11-01", ring: vierkant(MIDDEN, 2), beschrijving: "Steunmuur van 5m" }], { vastePlekken }));
  assert.equal(stukje.plek, "in de Proefstraat");
  // Wat er staat, als het dossier het noemt: vaste woorden, niet de omschrijving.
  assert.equal(stukje.omvang, "ongeveer 35 m², met een tent en een wand");
  const rand = herken(nep("ET2099200019", [{ dag: "2026-11-01", type: "Parkeerverbod in Straat", ring: vierkant(MIDDEN, 150) }], { vastePlekken }));
  assert.notEqual(rand.plek, "op de Proefparking");
});

test("regel buurtactie: Herfstklaar alleen in het weekend, met het profiel en een vorige editie op dezelfde plek", () => {
  const acties = [{ naam: "Herfstklaar", woord: "herfstklaar", wat: "bewoners maken samen hun straat groener", edities: [{ van: "2025-11-07", tot: "2025-11-11" }] }];
  const nieuws = { titel: "Maak je straat Herfstklaar op 23, 24 of 25 oktober", dag: "2026-10-23", eind: "2026-10-25", link: "https://www.antwerpen.be/info/voorbeeld/herfstklaar", bron: "kalender" };
  assert.deepEqual(L.buurtVensters([nieuws], acties).map((v) => [v.naam, v.van, v.tot]), [["Herfstklaar", "2026-10-23", "2026-10-25"]]);
  const plek = oost(MIDDEN, 1500);
  const nu = nep("ET2099500001", [{ dag: "2026-10-24", ring: vierkant(plek, 3) }]);
  // Vorig jaar, tijdens Herfstklaar, een kleine inname die deze plek raakt (een iets ander stukje stoep).
  const vorig = nep("ET2099500002", [{ dag: "2025-11-08", ring: vierkant(oost(plek, 5), 3), beschrijving: "Proefstraat 2-10" }]);
  const historiek = L.vatHistoriekSamen(nu, [{ ...vorig, dag: "2025-11-08", eind: "2025-11-08" }], { buurtacties: acties });
  assert.deepEqual(historiek.map((h) => h.soorten), [["buurtactie"]]);
  assert.equal(historiek[0].dag, "2025-11-08", "de dag van het oude dossier gaat mee (zelfde week, stapRegels)");
  const bouw = (dossiers, h = { ET2099500001: historiek }) => L.bouwHerkenning({ dossiers, kandidaten: [nieuws], historiek: h, charter: CHARTER, vandaag: VANDAAG, buurtacties: acties }).dossiers;
  const r = bouw([nu]).ET2099500001;
  assert.deepEqual([r.zekerheid, r.soort, r.geenEvenement, r.link], ["waarschijnlijk", "Herfstklaar (buurtactie van het district)", true, nieuws.link]);
  assert.match(r.reden, /^Valt in het Herfstklaar-weekend van het district \(23 tot 25 oktober\)/);
  // Zonder vorige editie op die plek: geen label, wel de feiten.
  assert.equal(bouw([nu], {}).ET2099500001.zekerheid, "onbekend");
  // Een podium of een markt valt buiten het profiel, ook in het weekend.
  const podium = nep("ET2099500003", [{ dag: "2026-10-24", ring: vierkant(plek, 3), beschrijving: "podium en promotruck" }]);
  assert.equal(bouw([podium], { ET2099500003: historiek }).ET2099500003.zekerheid, "onbekend");
  // Een reeks op hetzelfde vlak (elke zondag) is geen buurtactie.
  const reeks = ["2026-10-11", "2026-10-18", "2026-10-25"].map((dag, i) => nep(`ET209950001${i}`, [{ dag, ring: vierkant(plek, 3) }]));
  assert.equal(bouw(reeks, { ET2099500012: historiek }).ET2099500012.zekerheid, "onbekend");
  // Buiten het weekend: niets.
  const later = nep("ET2099500004", [{ dag: "2026-10-31", ring: vierkant(plek, 3) }]);
  assert.equal(bouw([later], { ET2099500004: historiek }).ET2099500004.zekerheid, "onbekend");
});

test("straat bij een punt: een tunnel onder een plein is geen plek, dan de straat erboven", () => {
  const as = (naam, a, b) => ({ type: "Feature", properties: { LSTRNMID: naam.length, LSTRNM: naam, RSTRNMID: naam.length, RSTRNM: naam, postcode: 2000, DISTRICT: "Antwerpen" }, geometry: { type: "LineString", coordinates: [a, b] } });
  const index = buildStreetIndex([as("Proeftunnel", oost(MIDDEN, -50), oost(MIDDEN, 50)), as("Voorbeeldplein", oost(noord(MIDDEN, 25), -50), oost(noord(MIDDEN, 25), 50))]);
  assert.equal(R.straatBijPunt(MIDDEN, index), "Voorbeeldplein");
  assert.equal(R.straatBijPunt(noord(MIDDEN, 24), index), "Voorbeeldplein");
});

test("koppeling: geen agendapunt van weken of met het thema Werken, wel een evenement van één dag", () => {
  const rows = [rij("ET2099300001", "Evenement", "Inname", "2026-10-10", "2026-10-11", ["Proefstraat"])];
  const f = evenementFeiten(rows);
  const werken = { id: "werken-proefstraat-fase-2", title: "Werken Proefstraat: fase 2", date: "2026-09-01", endDate: "2027-01-31", location: "Proefstraat", theme: "Werken" };
  assert.equal(koppelEvenement(f, [werken]), null, "een project van vijf maanden ligt elke dag in die straat");
  assert.equal(koppelEvenement(f, [{ ...werken, date: "2026-10-10", endDate: "2026-10-10" }]), null, "het thema Werken is geen evenement");
  assert.equal(koppelEvenement(f, [{ id: "buurtfeest-proefstraat", title: "Buurtfeest Proefstraat", date: "2026-10-10", location: "Proefstraat", theme: "Activiteit" }])?.titel, "Buurtfeest Proefstraat");
});

test("koppeling uit een oud bestand: 'Werken ...' of 'Schoolstraat ...' wordt nooit de titel van een dossier", () => {
  const rows = [rij("ET2099300002", "Evenement", "Inname", "2026-10-10", "2026-10-11", ["Proefstraat"])];
  const uitleg = { evenementen: { ET2099300002: { straten: ["Proefstraat"], gekoppeld: { titel: "Werken Proefstraat & Voorbeeldweg: fase 2 (tunnel noord)", tijd: "september 2026 - januari 2027 (data bij benadering)", locatie: "Proefstraat", bronUrl: "", agendaId: "werken-proefstraat-fase-2" } } } };
  const e = kaart(rows, { uitleg });
  assert.equal(e.title, "Inname in de Proefstraat");
  assert.doesNotMatch(JSON.stringify(e.uitleg), /Werken Proefstraat/);
});

// ---------- privacy: wat de herkenner en de kaart schrijven ----------

test("privacy: geen huisnummer, geen persoonsnaam en geen letterlijke omschrijving in de fiche of de kaarttitel", () => {
  const vrij = "Proeflaan 999 - hub bladslag, contact Jan Proefmans"; // verzonnen adres en naam
  const d = nep("ET2099400001", [{ dag: "2026-09-28", eind: "2027-01-22", type: "Parkeerverbod op Plein", ring: vierkant(MIDDEN, 40), beschrijving: vrij }], { straat: "Proeflaan" });
  const r = herken(d);
  const json = JSON.stringify(r);
  assert.equal(r.soort, "een verzamelplek voor herfstbladeren (bladslag)");
  assert.doesNotMatch(json, /Proefmans|laan 999|contact/i);
  assert.deepEqual(privacyFindings(r), []);
  const e = kaart([rij("ET2099400001", "Evenement", "Parkeerverbod op Plein", "2026-09-28", "2027-01-22", ["Proeflaan"], { description: vrij })]);
  assert.doesNotMatch(`${e.title} ${e.summary} ${e.uitleg.kern.flat().join(" ")}`, /Proefmans|laan 999|contact/i);
});

// ---------- de vaste woorden en de dagen (site/evenement-wat.js) ----------

test("woorden: dezelfde lijst in de kaart en de herkenner, geen straatnaam of tentoonstelling als voorwerp", () => {
  for (const d of W.DINGEN) {
    const voorbeeld = { schip: "Doopfeest MTS Voorbeeld", kermis: "Kermis op het plein", reuzenrad: "Reuzenrad", versiering: "Vlaggenlijnen", sticker: "Sticker", bladslag: "bladslag", mammobiel: "mammobiel", bord: "breugelbak", oldtimer: "oldtimers" }[d.key];
    assert.equal(L.eersteSoort([voorbeeld]), d.key, d.key);
    assert.equal(soortEvenement([voorbeeld]), d.zonder.charAt(0).toUpperCase() + d.zonder.slice(1), d.key);
  }
  assert.deepEqual(W.voorwerpenIn(["Partytentje 4m x 4m", "Steunmuur van 5m"]), ["een tent", "een wand"]);
  assert.deepEqual(W.voorwerpenIn(["Tentoonstellingswand"]), []);
  assert.deepEqual(W.dingenIn([["Inname Vlaggestraat", "5"].join(" ")]), []);
});

test("dagen: losse dagen, een ritme, een hele maand en een heel jaar in gewone taal", () => {
  const t = (dagen, v = VANDAAG) => W.patroonTekst(W.patroonVan(dagen, v), v);
  assert.equal(t(["2026-11-09", "2026-12-07", "2027-02-01", "2027-03-01", "2027-04-05"]), "één maandag per maand, van november 2026 tot april 2027");
  assert.equal(t(["2026-11-09", "2026-12-07", "2027-02-01", "2027-03-01"], "2026-11-20"), "één maandag per maand, van november 2026 tot maart 2027; de volgende is maandag 7 december");
  assert.equal(t(["2026-10-12", "2026-10-14"]), "op maandag 12 oktober en woensdag 14 oktober");
  assert.equal(t(["2026-11-10", "2026-11-12", "2026-11-13", "2026-11-16", "2026-11-17"]), "op 5 losse dagen tussen 10 november en 17 november");
  // "De hele maand" alleen tot de echte laatste dag (oktober heeft 31 dagen, februari 2028 er 29).
  const okt = (n) => Array.from({ length: n }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
  assert.equal(t(okt(29)), "van 1 tot 29 oktober");
  assert.equal(t(okt(31)), "de hele maand oktober (1 tot 31 oktober)");
  assert.equal(t(Array.from({ length: 29 }, (_, i) => `2028-02-${String(i + 1).padStart(2, "0")}`), "2028-02-10"), "de hele maand februari (1 tot 29 februari)");
  // Over de jaarwissel: beide jaartallen.
  assert.equal(t(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]), "van 30 december 2026 tot 2 januari 2027");
  const jaar = Array.from({ length: 365 }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10));
  assert.equal(t(jaar), "heel 2026");
  assert.deepEqual(["2026-10-10", "2026-10-13", "2026-10-29"].map((e) => W.duurKlasse("2026-10-10", e)), ["kort", "meerdaags", "lang"]);
  assert.deepEqual([79, 1269, 100_107, 4].map(W.oppervlakteTekst), ["ongeveer 80 m²", "ongeveer 1.300 m²", "ongeveer 10 ha", "een paar m²"]);
});

// ---------- nakijkronde 11-10-2026 (juistheid, privacy, beeld): elk punt een toets ----------

const een = (nr, b, { dag = "2026-11-14", plek = oost(MIDDEN, 900), m = 20, ...rest } = {}) => nep(nr, [{ dag, ring: vierkant(plek, m), beschrijving: b, ...rest }]);

test("H1: een adres, een samenstelling of een ontkenning is geen soort", () => {
  assert.equal(L.eersteSoort(["Markt 998", "Markt 996 tot 997"]), "", "een adres in een straat die Markt heet"); // verzonnen huisnummers
  assert.equal(L.eersteSoort(["het winkelwandelgebied van de Proefstraat"]), "");
  assert.equal(L.eersteSoort(["workshop"]), "");
  assert.equal(L.eersteSoort(["reuzendoop"]), "");
  assert.equal(L.eersteSoort(["Proefstoetfoor"]), "kermis", "een foor bij een stoet is een foor");
  assert.equal(L.eersteSoort(["geen kermis, wel een podium"]), "");
  assert.equal(L.eersteSoort(["geen stickers"]), "");
  assert.equal(herken(een("ET2099600001", "Markt 998")).zekerheid, "onbekend"); // verzonnen huisnummer
  // De kaart zonder fiche: dezelfde woordgrenzen.
  assert.equal(soortEvenement(["Inname: het winkelwandelgebied van de Proefstraat"]), "");
  assert.equal(soortEvenement(["Inname: reuzendoop"]), "");
  assert.equal(soortEvenement(["Inname: geen kermis, wel een podium"]), "");
});

test("H1: een zwak woord (lopen, Grote Prijs, 11 november) telt alleen met een parcours, en nooit zonder 'vermoedelijk'", () => {
  assert.equal(herken(een("ET2099600002", "Grote Prijs zang")).zekerheid, "onbekend");
  assert.equal(herken(een("ET2099600003", "rommelmarkt, bezoekers lopen door de straat")).soort, "een markt");
  assert.equal(herken(een("ET2099600004", "tweedehandsmarkt 11 november", { dag: "2026-11-11" })).soort, "een markt");
  const loop = herken(nep("ET2099600005", [{ dag: "2026-11-14", type: "Parcours", lijn: [oost(MIDDEN, 900), oost(MIDDEN, 1400)], beschrijving: "bezoekers lopen hier" }]));
  assert.deepEqual([loop.soort, loop.soortZeker], ["een loopwedstrijd of loop", false]);
  // Een sterk woord met een soort die er niet bij past: een vermoeden.
  const twee = herken(een("ET2099600006", "braderij en een stoet met praalwagens"));
  assert.equal(twee.soortZeker, false);
});

test("H1: een fase 'Opname' is een film- of foto-opname, wat de omschrijving ook zegt", () => {
  const r = herken(nep("ET2099600010", [{ dag: "2026-11-18", fase: "Opname periode 1", type: "Parcours", lijn: [oost(MIDDEN, 900), oost(MIDDEN, 1400)], beschrijving: "Wandelpad voor de scène" }]));
  assert.deepEqual([r.soort, r.soortZeker, r.geenEvenement], ["een film- of foto-opname", true, true]);
  const e = kaart([rij("ET2099600010", "Opname periode 1", "Inname", "2026-11-18", "2026-11-18", ["Proefstraat"], { description: "Wandelpad voor de scène" })]);
  assert.match(e.title, /^Film- of foto-opname in de Proefstraat$/);
  assert.equal(e.uitleg.geenEvenement, true);
});

test("H1: zonder 'vermoedelijk' alleen als het hele dossier over het ding gaat; opslag of materiaal blijft een vermoeden", () => {
  assert.equal(herken(een("ET2099600011", "opslag reuzenrad")).soortZeker, false);
  const r = herken(nep("ET2099600012", [{ dag: "2026-11-14", ring: vierkant(oost(MIDDEN, 900), 20), beschrijving: "Reuzenrad" }, { dag: "2026-11-14", ring: vierkant(oost(MIDDEN, 960), 5), beschrijving: "Proefstraat" }]));
  assert.deepEqual([r.soort, r.soortZeker], ["een reuzenrad", true], "een omschrijving die alleen een plek noemt, spreekt niet tegen");
});

test("H2: een bord, een vlaggenmast of kerstverlichting is niet wat een dossier met tenten, een markt of een loop is", () => {
  // Tenten, een DJ en één inname met een bord: geen "aankondigingsbord", wel een evenement met publiek.
  const feest = herken(nep("ET2099600020", [
    { dag: "2027-01-03", ring: vierkant(oost(MIDDEN, 900), 10), beschrijving: "tent voor de inschrijvingen" },
    { dag: "2027-01-03", ring: vierkant(oost(MIDDEN, 960), 10), beschrijving: "DJ-booth" },
    { dag: "2027-01-03", ring: vierkant(oost(MIDDEN, 1020), 5), beschrijving: "bord met de aankondiging (breugelbak)" },
  ]));
  assert.deepEqual([feest.zekerheid, feest.geenEvenement], ["onbekend", false]);
  assert.match(feest.omvang, /een aankondigingsbord/);
  // Kerstbomen bij een vlaggenmast: geen vlaggen boven de straat.
  const bomen = herken(nep("ET2099600021", [{ dag: "2026-12-01", eind: "2027-01-15", ring: vierkant(oost(MIDDEN, 900), 3), beschrijving: "twee kerstbomen naast de vlaggenmast" }, { dag: "2026-12-01", eind: "2027-01-15", ring: vierkant(oost(MIDDEN, 960), 3), beschrijving: "twee kerstbomen in de plantenbak" }]));
  assert.equal(bomen.soort, "straatversiering: kerstbomen");
  // Een kerstmarkt met kerstverlichting is een markt; een loop met vlaggen aan de finish een loop.
  assert.equal(herken(nep("ET2099600022", [{ dag: "2026-12-13", ring: vierkant(oost(MIDDEN, 900), 20), beschrijving: "kerstmarkt" }, { dag: "2026-12-13", ring: vierkant(oost(MIDDEN, 960), 5), beschrijving: "kerstverlichting" }])).soort, "een markt");
  assert.equal(herken(nep("ET2099600023", [{ dag: "2026-11-15", type: "Parcours", lijn: [oost(MIDDEN, 900), oost(MIDDEN, 1900)], beschrijving: "Parcours 8 km" }, { dag: "2026-11-15", ring: vierkant(oost(MIDDEN, 1900), 5), beschrijving: "vlaggen aan de finish" }])).soort, "een loopwedstrijd of loop");
  // De kaart zegt hetzelfde als de herkenner (zelfde regel, zelfde volgorde).
  assert.equal(soortEvenement(["Inname: kerstmarkt", "Inname: kerstverlichting"]), "Markt");
  assert.equal(soortEvenement(["Inname: tent", "Inname: breugelbak"]), "");
});

test("H3: 'doop' in oktober is alleen zonder 'vermoedelijk' een studentendoop met een plek uit het charter of een studentenwoord", () => {
  const d = (nr, b, plek = oost(MIDDEN, 900)) => herken(een(nr, b, { dag: "2026-10-14", plek }));
  assert.equal(d("ET2099600030", "reuzendoop").zekerheid, "onbekend");
  assert.equal(d("ET2099600031", "doop nieuwe tunnelboormachine").zekerheid, "onbekend");
  assert.equal(d("ET2099600032", "doop nieuwe veerboot").zekerheid, "onbekend");
  assert.equal(d("ET2099600033", "doopfeest van een kleindochter", oost(MIDDEN, 2000)).zekerheid, "onbekend", "ook niet op een doopplaats");
  const los = d("ET2099600034", "Doop");
  assert.deepEqual([los.soort, los.soortZeker], ["een studentendoop", false]);
  assert.doesNotMatch(los.reden, /noemt studenten/);
  assert.equal(d("ET2099600035", "Doop", oost(MIDDEN, 2000)).soortZeker, true);
  assert.equal(d("ET2099600036", "schachtendoop").soortZeker, true);
});

test("H4: de doop van een schip vraagt een scheepswoord, of een boot buiten de doopperiode; de reden zegt alleen wat nagekeken is", () => {
  const boot = herken(een("ET2099600040", "doop, daarna met de boot naar de overkant", { dag: "2026-10-13", plek: oost(MIDDEN, 2000) }));
  assert.equal(boot.soort, "een studentendoop");
  const nov = herken(een("ET2099600041", "doop van de nieuwe boot", { dag: "2026-11-20" }));
  assert.equal(nov.soort, "de doop van een schip");
  assert.match(nov.reden, /buiten de doopperiode/);
  assert.doesNotMatch(nov.reden, /kaai|naam van een schip/);
  const mts = herken(een("ET2099600042", "Doopfeest MTS Voorbeeldvaart", { dag: "2026-10-13" }));
  assert.equal(mts.soort, "de doop van een schip");
  assert.doesNotMatch(mts.reden, /buiten de doopperiode/);
});

test("M1: 'vanaf' alleen met een echt vertrekpunt; een lus of losse lijnen niet", () => {
  const A = oost(MIDDEN, 900), B = oost(noord(MIDDEN, 400), 1300), C = oost(MIDDEN, 1700);
  // Straat per punt: west van A+200 m de Proefstraat, noordelijk het Voorbeeldplein, anders de Testlaan.
  const straatBij = (p) => (p[0] < oost(MIDDEN, 1100)[0] ? "Proefstraat" : p[1] > noord(MIDDEN, 200)[1] ? "Voorbeeldplein" : "Testlaan");
  const lijn = (a, b, extra = {}) => ({ dag: "2026-10-13", type: "Parcours", lijn: [a, b], beschrijving: "stop", ...extra });
  const pk = (innames) => L.plekKort(nep("ET2099600050", innames, { straatBij }));
  assert.equal(pk([lijn(A, C)]), "vanaf de Proefstraat", "één lijn: het begin is het vertrekpunt");
  assert.doesNotMatch(pk([lijn(A, B), lijn(B, C), lijn(C, A)]), /vanaf/, "een lus: geen vertrekpunt");
  assert.doesNotMatch(pk([lijn(B, C), lijn(A, oost(A, 50))]), /vanaf/, "losse stukken: geen vertrekpunt");
  assert.equal(pk([lijn(A, B, { dag: "2026-10-12" }), lijn(A, C, { dag: "2026-10-14" })]), "vanaf de Proefstraat", "twee stoeten vanaf dezelfde plek");
  // Een inname die zelf "begin" zegt, wint: de straat komt uit de straatas, niet uit de tekst.
  assert.equal(pk([lijn(A, B), lijn(B, C), lijn(C, A), { dag: "2026-10-13", ring: vierkant(B, 10), beschrijving: "vertrekpunt van de tocht" }]), "vanaf het Voorbeeldplein");
  // De zin bij "Waar" zegt bij een lus ook geen "van ... naar ...".
  const waar = L.routeZin(nep("ET2099600051", [lijn(A, B), lijn(B, C), lijn(C, A)], { straatBij }), { vandaag: VANDAAG });
  assert.doesNotMatch(waar, / van de \S+ naar /);
  assert.match(waar, /^Lus van ongeveer/);
  // Een tocht met haltes die aan een doopplaats eindigt, in de doopperiode: vermoedelijk een studentendoop.
  const doop = herken(nep("ET2099600052", [lijn(MIDDEN, oost(MIDDEN, 1990))]));
  assert.equal(doop.soort, "een studentendoop: een tocht te voet langs haltes naar de doopplaats");
  assert.match(doop.reden, /uiteinde aan Voorbeeldkaai/);
});

test("M3 en L6: de handfiches zeggen geen doop waar een doop niet mag, noemen beide dinsdagen en geen café", () => {
  const hand = JSON.parse(fs.readFileSync(new URL("../site/sources/evenement-identiteit.json", import.meta.url), "utf8")).dossiers;
  for (const id of ["ET2026005479", "ET2026005502"]) assert.doesNotMatch(hand[id].soort, /doop/i, id);
  assert.deepEqual(hand.ET2026004449.dagen, ["2026-10-20", "2026-10-27"]);
  assert.doesNotMatch(JSON.stringify(hand.ET2026004253), /caf[eé]/i);
});

test("M4: een markt van een jaar op het vlak van een openbare markt zegt 'elke vrijdag' en de uren, met 'Vandaag' alleen op vrijdag", () => {
  const vlak = vierkant(oost(MIDDEN, 900), 40);
  const markten = L.marktenUitAsign([{ attributes: { id: "MA99", locatie: "PROEFPLEIN", marktdag1: "Vrijdag", marktdag2: "geen", van: "8.00", tot: "13.00", soort: "Gemengde markt" }, geometry: { rings: [vlak] } }]);
  const marktDagen = L.marktDagenUitBron({ items: [{ title: "Gemengde markt Proefplein", date: "2026-10-16", location: "Proefplein, 2000 Antwerpen", sourceUrl: "https://geo.api.vlaanderen.be/GIPOD/ogc/features/v1/collections/INNAME_PUNT/items/INNAME_PUNT.1-2610160800" }] });
  const jaar = { dag: "2026-04-17", eind: "2027-04-30", ring: vierkant(oost(MIDDEN, 910), 30) };
  const r = herken(nep("ET2099600060", [{ ...jaar, beschrijving: "tijdelijke markt" }], { straat: "Proefplein" }), { markten, marktDagen });
  assert.deepEqual([r.zekerheid, r.methode, r.naam, r.uren], ["zeker", "markt", "Gemengde markt Proefplein", "8 tot 13 uur"]);
  assert.ok(r.dagen.length > 50 && r.dagen.every((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === 5));
  // Zonder het woord markt (kleine plekken van een jaar) of met losse dagen: geen markt.
  assert.notEqual(herken(nep("ET2099600061", [jaar], { straat: "Proefplein" }), { markten, marktDagen }).methode, "markt");
  // De kaart: elke vrijdag, de uren, "Volgende: 16 okt" en "Vandaag" alleen op vrijdag.
  const rows = [rij("ET2099600060", "Evenement", "Inname", "2026-04-17", "2027-04-30", ["Proefplein"], { description: "tijdelijke markt" })];
  const e = kaart(rows, { identiteit: { dossiers: { ET2099600060: r } } });
  assert.equal(e.title, "Gemengde markt Proefplein");
  assert.match(e.summary, /^Elke vrijdag van 17 april 2026 tot 30 april 2027; de volgende is vrijdag 16 oktober, 8 tot 13 uur\./);
  assert.equal(evenementBadge(e, VANDAAG).label, "Volgende: 16 okt");
  assert.equal(evenementBadge(e, "2026-10-16").label, "Vandaag");
  assert.deepEqual(lijst([e]).days.map(([d]) => d), ["2026-10-16"]);
});

test("L1: een vaste plek die een doopplaats is, een zusterdossier met een shopevent, en dubbele agendapunten", () => {
  // Een park dat zelf een doopplaats uit het charter is (de straal van het charter dekt het niet helemaal).
  const vastePlekken = [{ naam: "Proefpark", zin: "in het Proefpark", punt: oost(MIDDEN, 3000), straal: 300, charter: "Proefweide" }];
  const charter = { ...CHARTER, plekken: [...CHARTER.plekken, { naam: "Proefweide", soort: "doopplaats", punt: oost(MIDDEN, 3150), straal: 60 }] };
  const park = L.herkenDossier(nep("ET2099600070", [{ dag: "2026-10-19", ring: vierkant(oost(MIDDEN, 2950), 25) }], { vastePlekken }), { charter, vandaag: VANDAAG });
  assert.equal(park.soort, "een studentendoop");
  // Een kleine inname op de route van een shopevent, dezelfde dag: vermoedelijk een winkelevenement.
  const shop = nep("ET2099600071", [{ dag: "2026-10-17", type: "Parcours", lijn: [oost(MIDDEN, 4000), oost(MIDDEN, 4300)], beschrijving: "optreden tijdens de shopdag" }]);
  const stand = nep("ET2099600072", [{ dag: "2026-10-17", ring: vierkant(oost(MIDDEN, 4100), 4) }]);
  const uit = L.bouwHerkenning({ dossiers: [shop, stand], charter: CHARTER, vandaag: VANDAAG }).dossiers;
  assert.deepEqual([uit.ET2099600072.soort, uit.ET2099600072.soortZeker], ["een winkelevenement", false]);
  // Naast een koers niet: die passeert vanzelf van alles.
  const koers = nep("ET2099600073", [{ dag: "2026-10-17", type: "Parcours", lijn: [oost(MIDDEN, 4000), oost(MIDDEN, 4300)], beschrijving: "parcours criterium" }]);
  assert.equal(L.bouwHerkenning({ dossiers: [koers, nep("ET2099600072", [{ dag: "2026-10-17", ring: vierkant(oost(MIDDEN, 4100), 4) }])], charter: CHARTER, vandaag: VANDAAG }).dossiers.ET2099600072.zekerheid, "onbekend");
  // Hetzelfde evenement in de kalender en in het nieuws (zelfde dag, uren en straat): geen twijfel.
  const feest = nep("ET2099600074", [{ dag: "2026-10-31", type: "Verkeersvrije Zone", ring: vierkant(oost(MIDDEN, 5000), 30) }]);
  const k1 = { titel: "Halloween", dag: "2026-10-31", eind: "2026-10-31", tijd: "14 tot 20 uur", locatie: "Proefzaal, Proefstraat", bron: "kalender", bronLabel: "districtskalender", punt: oost(MIDDEN, 5000), link: "https://www.antwerpen.be/info/voorbeeld-kalender", district: "", postcodes: [] };
  const k2 = { ...k1, titel: "Griezelfeest in de Proefzaal op Halloween", tijd: "van 14 tot 20 uur", bronLabel: "districtsnieuws", punt: null, link: "https://www.antwerpen.be/info/voorbeeld-nieuws" };
  const r = L.bouwHerkenning({ dossiers: [feest], kandidaten: [k1, k2], charter: CHARTER, vandaag: VANDAAG }).dossiers.ET2099600074;
  assert.doesNotMatch(r.signalen.join(" "), /twijfel/);
  assert.equal(r.uren, "14 tot 20 uur");
});

test("L1: drie jaar op rij in dezelfde week hetzelfde op een kleine plek, en nooit iets anders: een vermoeden", () => {
  const plekje = een("ET2099600075", "", { dag: "2026-11-11", plek: oost(MIDDEN, 6000), m: 10 });
  const h = (dossier, dag, soorten = ["buurtfeest"]) => ({ dossier, jaar: dag.slice(0, 4), dag, soorten, overlap: 0.95 });
  const drie = [h("ET2099000201", "2023-11-11"), h("ET2099000202", "2024-11-09"), h("ET2099000203", "2025-11-12")];
  const r = herken(plekje, { historiek: drie });
  assert.deepEqual([r.soort, r.soortZeker], ["een buurtfeest", false]);
  assert.equal(herken(plekje, { historiek: drie.slice(0, 2) }).zekerheid, "onbekend", "twee jaren");
  assert.equal(herken(plekje, { historiek: [...drie.slice(0, 2), h("ET2099000204", "2025-10-01")] }).zekerheid, "onbekend", "een andere week");
  assert.equal(herken(plekje, { historiek: [...drie, h("ET2099000205", "2024-11-10", ["stoet"])] }).zekerheid, "onbekend", "ook iets anders");
  assert.equal(herken(plekje, { historiek: drie.map(({ dag, ...rest }) => rest) }).zekerheid, "onbekend", "een samenvatting zonder dag telt niet");
});

test("L2: de zin bij 'Waar' van een automatische fiche zegt geen dagen; die staan bij 'Wanneer', uit de innames", () => {
  const waar = "Inname van ongeveer 80 m² in de Proefstraat (Universiteitsbuurt, district Antwerpen), op dinsdag 20 oktober en maandag 9 november.";
  assert.equal(KU.waarZonderDagen(waar), "Inname van ongeveer 80 m² in de Proefstraat (Universiteitsbuurt, district Antwerpen).");
  assert.equal(KU.waarZonderDagen("Route van ongeveer 2,4 km in Brederode (district Antwerpen), van de Proefstraat naar de Testlaan, van 1 tot 29 oktober."), "Route van ongeveer 2,4 km in Brederode (district Antwerpen), van de Proefstraat naar de Testlaan.");
  const id = { zekerheid: "onbekend", methode: "kaart", plek: "in de Proefstraat", omvang: "ongeveer 80 m²", waar, dagen: ["2026-10-20", "2026-11-09"], bron: ["https://geodata.antwerpen.be/x"] };
  const e = kaart([rij("ET2099600080", "Evenement", "Inname", "2026-11-09", "2026-11-09", ["Proefstraat"])], { identiteit: { dossiers: { ET2099600080: id } } });
  assert.doesNotMatch(kern(e).Waar, /oktober|november/);
  assert.match(e.summary, /^Maandag 9 november/);
});

test("L3: wijknamen zoals op de kaart, één keer haakjes, geen 'Evenement.' en altijd een plek in de titel", () => {
  // Twee wijken: "Theaterbuurt en Meir", niet "Theaterbuurt & Meir".
  const wijkVan = (s) => (s === "Proefstraat" ? "Theaterbuurt & Meir" : "Historisch centrum");
  const straatBij = (p) => (p[0] < oost(MIDDEN, 2000)[0] ? "Proefstraat" : "Testlaan");
  const d = nep("ET2099600081", [{ dag: "2026-11-14", ring: vierkant(oost(MIDDEN, 900), 3) }, { dag: "2026-11-14", ring: vierkant(oost(MIDDEN, 3000), 3) }], { straatBij, wijkVan });
  assert.equal(L.plekKort(d), "op 2 plekken in de wijken Historisch centrum en Theaterbuurt en Meir");
  // Een vaste plek die zelf haakjes heeft: daarin het district, geen tweede paar met de wijk.
  const vastePlekken = [{ naam: "Proefpark", zin: "in het Proefpark (Proefwijk)", punt: oost(MIDDEN, 900), straal: 300 }];
  const vast = nep("ET2099600082", [{ dag: "2026-11-14", ring: vierkant(oost(MIDDEN, 900), 20) }], { vastePlekken, wijk: "Nieuw-zuid" });
  assert.match(L.routeZin({ ...vast, district: "Antwerpen" }), /^Inname van ongeveer [\d.]+ m² in het Proefpark \(Proefwijk, district Antwerpen\), /);
  // Een naam uit een besluit zonder soort: niet alleen "Evenement.".
  const besluit = { zekerheid: "zeker", methode: "besluit", naam: "Heropening Proefstraat", soort: "evenement", grond: "een besluit met dezelfde dag en straat", dagen: ["2026-10-17"], bron: ["https://ebesluit.antwerpen.be/x", "https://geodata.antwerpen.be/x"] };
  const e = kaart([rij("ET2099600083", "Evenement", "Inname", "2026-10-17", "2026-10-17", ["Proefstraat"])], { identiteit: { dossiers: { ET2099600083: besluit } } });
  assert.notEqual(kern(e).Wat, "Evenement.");
  assert.match(kern(e).Wat, /^Heropening Proefstraat: die naam staat in een besluit/);
  // Zonder wijk (buiten district Antwerpen): de straat, met "en omgeving".
  const buiten = evenementEntry([rij("ET2099600084", "Evenement", "Inname", "2026-12-16", "2026-12-16", ["Proefkaai", "Testlaan"])], { vandaag: VANDAAG, wijkVan: () => "" });
  assert.equal(buiten.title, "Inname op de Proefkaai en omgeving");
});

test("privacy 2 en L5: alleen een dossier dat een buurtactie kan zijn, vraagt zijn historiek opnieuw", () => {
  const vensters = [{ naam: "Herfstklaar", van: "2026-10-23", tot: "2026-10-25" }];
  const buurt = een("ET2099600090", "", { dag: "2026-10-24", plek: oost(MIDDEN, 7000), m: 3 });
  const ander = een("ET2099600091", "", { dag: "2026-11-24", plek: oost(MIDDEN, 7000), m: 3 });
  const oud = (d) => ({ sleutel: R.historiekSleutel(d, []), items: [] });
  assert.equal(R.historiekGeldig(oud(ander), ander, vensters), true, "de cache van een gewoon dossier blijft geldig");
  assert.equal(R.historiekGeldig(oud(buurt), buurt, vensters), false, "een mogelijke buurtactie vraagt opnieuw");
  assert.match(R.historiekSleutel(buurt, vensters), /^b2\|/);
  assert.equal(R.historiekGeldig({ sleutel: R.historiekSleutel(buurt, vensters) }, buurt, vensters), true);
  assert.equal(R.historiekGeldig({ sleutel: `b2|${R.historiekSleutel(ander, [])}` }, ander, vensters), true, "een b2-samenvatting geldt ook voor de rest");
});

test("privacy 3: een dossier met losse dagen blijft tijdens de afbraak bij 'Nu bezig'", () => {
  const rows = [
    rij("ET2099600095", "Evenement", "Inname", "2026-10-07", "2026-10-07", ["Testplein"]),
    rij("ET2099600095", "Evenement", "Inname", "2026-10-14", "2026-10-14", ["Testplein"]),
    rij("ET2099600095", "Afbraak", "Parkeerverbod in Straat", "2026-10-14", "2026-10-15", ["Testplein"]),
  ];
  const e = evenementEntry(rows, { vandaag: "2026-10-15", wijkVan });
  assert.deepEqual(e.losseDagen, ["2026-10-07", "2026-10-14"]);
  const g = groupForList([e], { ...periodRange("alles", "2026-10-15"), today: "2026-10-15" });
  assert.equal(g.running.length, 1);
});

test("privacy 4: één fout woord in lib/buurtacties.json breekt de herkenning niet", () => {
  assert.doesNotThrow(() => L.buurtVensters([{ titel: "Lenteklaar", dag: "2027-03-20" }], [{ naam: "Lenteklaar", woord: "lente(" }]));
});

test("beeld 3: een inname die geen evenement is, heet nergens 'dit evenement', en een bekende soort zegt niet 'waarvoor precies'", () => {
  const rows = [rij("ET2099600096", "Evenement", "Inname", "2026-10-01", "2026-10-29", ["Proefstraat"], { description: "Sticker Proefstraat" })];
  const e = kaart(rows, { straat: "Proefstraat" });
  const tekst = `${e.summary} ${e.uitleg.kern.flat().join(" ")} ${e.jouwStraat}`;
  assert.equal(e.uitleg.geenEvenement, true);
  assert.doesNotMatch(tekst, /dit evenement|waarvoor precies/);
  assert.match(tekst, /deze inname/);
  assert.equal(PC.jouwStraatTekst("", { straal: 250, geenEvenement: true }).lang, "Niet in je straat: deze inname ligt binnen 250 m van je straat.");
  // De tegel bovenaan telt zo'n inname apart: "1 evenement (+ 1 inname)".
  const feest = kaart([rij("ET2099600097", "Evenement", "Inname", VANDAAG, VANDAAG, ["Proefstraat"], { description: "buurtfeest" })]);
  assert.deepEqual([PC.summarize([e, feest], VANDAAG).evenementen, PC.summarize([e, feest], VANDAAG).innamesOpStraat], [1, 1]);
});

test("beeld: een lange titel zet de plek in de eerste regel; over de jaarwissel staan beide jaren", () => {
  const plek = "op 10 plekken in de wijken Historisch centrum en Centraal Station en omgeving";
  const id = { zekerheid: "waarschijnlijk", methode: "regels", soort: "een studentenactiviteit in de doopperiode", reden: "x", grond: "de plek en de doopperiode uit het studentencharter", plek, dagen: ["2026-10-12"], bron: ["https://geodata.antwerpen.be/x"] };
  const e = kaart([rij("ET2099600098", "Evenement", "Inname", "2026-10-12", "2026-10-12", ["Proefstraat"])], { identiteit: { dossiers: { ET2099600098: id } } });
  assert.equal(e.title, "Vermoedelijk een studentenactiviteit in de doopperiode");
  assert.match(e.summary, new RegExp(`^Maandag 12 oktober, ${plek}\\.`));
  assert.equal(KU.dagenTekst("2026-04-17", "2027-04-30"), "van vrijdag 17 april 2026 tot vrijdag 30 april 2027");
});
