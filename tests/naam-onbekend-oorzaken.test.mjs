// Waarom een evenementendossier "naam volgt" heette, per oorzaak een toets (12 van de 68 op 12-10-2026).
// De oorzaken, nagekeken bij de toegelaten bronnen (A-Sign, eBesluit, kalender, nieuws, stadsagenda):
//   1. de innamebeschrijving noemt wat het is ("Praalwagens"), maar het woord stond niet in de soortenlijst;
//   2. het besluit dat de naam geeft, werd pas na de ochtendverversing gepubliceerd: de volgende verversing
//      koppelt het (zelfde dag, eigen plek, opbouw de dag ervoor);
//   3. de naam staat alleen in besluiten over een bestek of standplaatsen, die de koppeling bewust overslaat:
//      een handfiche met die besluiten als bron, over de hele periode;
//   4. geen enkele toegelaten bron noemt het: dan geen belofte ("naam volgt") maar wat en waar, en waarom
//      er geen naam is.
// Alle gegevens zijn verzonnen: dossiers ET2099..., straten als Proefstraat, geen personen. Geen netwerk.
import assert from "node:assert/strict";
import test from "node:test";

import {
  NAAM_LATER_ZIN, ZONDER_NAAM_ZIN, asignAgendapunten, dossierFeiten, koppelBesluiten, titelVan, vormZonderNaam,
} from "../lib/asign-evenementen-agenda.mjs";
import { soortVanTitel } from "../lib/ebesluit-evenementen.mjs";
import * as L from "../lib/parcours-herkenning.mjs";
import { soortEvenement } from "../site/kaart-uitleg.js";

const VANDAAG = "2026-10-10";
const RETRIEVED = "2026-10-10T05:20:00.000Z";
const GOED = "aanvraag_goedgekeurd";
const feit = (dossier, velden = {}) => ({
  dossier, status: GOED, binnenDistrict: true, fasen: [{ naam: "Evenement", start: "2026-10-18", eind: "2026-10-18" }], dagen: ["2026-10-18"],
  langs: [], zone: [], kernStraten: ["Proefstraat"], beginStraat: "Proefstraat", wijk: "Proefwijk", postcodes: ["2000"], speelstraat: false, vorm: null,
  routeMeter: 0, lus: false, ...velden,
});
const fiche = (velden = {}) => ({ zekerheid: "onbekend", naam: "", soort: "", organisator: "", uren: "", link: "", methode: "kaart", dagen: [], binnenDistrict: true, ...velden });
const bouw = (opties) => asignAgendapunten({ vandaag: VANDAAG, retrievedAt: RETRIEVED, ...opties });
const besluit = (velden = {}) => ({
  id: "9.9.9.9.1", code: "2099_CBS_09001", soort: "evenement", status: "goedkeuring", orgaan: "college van burgemeester en schepenen", zitting: "2026-10-09",
  gepubliceerd: true, gelezen: true, naam: "Proefdag van de Jeugd 2026", organisator: null, dagen: ["2026-10-23"], uren: { start: "07:00", einde: "09:00" },
  plaats: "Proefplein", straten: ["Proefplein"], postcodes: ["2000"], inDistrict: true, opbouw: "2026-10-22", afbouw: "2026-10-23", wijziging: null, vervangt: [],
  bron: "https://ebesluit.antwerpen.be/zittingen/9.9/agendapunten/9.9.9.9.1", ...velden,
});

// ---------- oorzaak 1: de innamebeschrijving noemt praalwagens ----------

test("oorzaak 1: 'Praalwagens' in de innamebeschrijving is een stoet, in de herkenner en op de kaart", () => {
  assert.equal(L.eersteSoort(["Praalwagens"]), "stoet");
  assert.equal(L.eersteSoort(["Steenplein", "Productiezone", "praalwagen"]), "stoet");
  assert.equal(L.eersteSoort(["Praalwagenbouwers vzw"]), "", "een samenstelling is geen stoet");
  assert.equal(soortEvenement(["Inname: Praalwagens"]), "Stoet");
  // Van de beschrijving tot de titel: de soort komt uit het dossier zelf, dus zonder "vermoedelijk".
  const K = Math.cos((51.2 * Math.PI) / 180);
  const p = [4.4, 51.215], q = [p[0] + 40 / (111_320 * K), p[1]];
  const ring = [[p[0], p[1]], [q[0], q[1]], [q[0], q[1] + 0.0003], [p[0], p[1] + 0.0003], [p[0], p[1]]];
  const ms = (dag) => Date.UTC(+dag.slice(0, 4), +dag.slice(5, 7) - 1, +dag.slice(8, 10), 10);
  const feats = ["Proefplein", "Praalwagens"].map((beschrijving) => ({
    attributes: { dossierNummer: "ET2099700001", dossierStatus: GOED, faseNaam: "Evenement", faseStartDatum: ms("2026-11-14"), faseEindDatum: ms("2026-11-14"), innameTypeNaam: "Inname", innameBeschrijving: beschrijving, last_edited_date: Date.UTC(2026, 8, 1) },
    geometry: { rings: [ring] },
  }));
  const d = L.verrijk(L.dossiersUitAsign(feats).get("ET2099700001"), { straatBij: () => "Proefplein", wijkVan: () => "Proefwijk", wijkBijPunt: () => "Proefwijk", stratenLangs: () => ["Proefplein"] });
  const r = L.stapRegels(d, {});
  assert.equal(r.soortKey, "stoet", JSON.stringify(r));
  assert.equal(r.soortZeker, true);
  const titel = titelVan(feit("ET2099700001", { beginStraat: "Proefplein", kernStraten: ["Proefplein"] }), { auto: fiche({ zekerheid: r.zekerheid, soort: r.soort, methode: "regels", soortZeker: true }) });
  assert.doesNotMatch(titel.titel, /naam (?:volgt|onbekend)/);
  assert.match(titel.titel, /^(?:Vermoedelijk een stoet|Stoet) op het Proefplein$/);
});

// ---------- oorzaak 2: het besluit kwam na de ochtendverversing ----------

test("oorzaak 2: een besluit met dag, plein en opbouw de dag ervoor geeft het dossier zijn naam en uren zodra het gelezen is", () => {
  const dag = "2026-10-23";
  const f = feit("ET2099700002", {
    dagen: [dag], beginStraat: "Proefplein", kernStraten: ["Proefplein"], zone: ["Proefplein", "Tweedeplaats"],
    fasen: [{ naam: "Opbouw", start: "2026-10-22", eind: "2026-10-23" }, { naam: "Evenement", start: dag, eind: dag }, { naam: "Afbraak", start: dag, eind: dag }],
  });
  // Vóór het besluit gepubliceerd is: geen naam, en dat staat er eerlijk.
  const voor = bouw({ feiten: [f] }).items[0];
  assert.equal(voor.title, "Evenement op het Proefplein: verkeersvrije zone in 2 straten, naam onbekend");
  // De volgende verversing leest het besluit: zelfde dag, eigen plek van het dossier.
  const b = besluit();
  assert.equal(koppelBesluiten([f], [b]).get("ET2099700002"), b);
  const na = bouw({ feiten: [f], besluiten: [b] }).items[0];
  assert.equal(na.title, "Proefdag van de Jeugd 2026");
  assert.equal(na.timeSlot, "07:00");
  assert.equal(na.timeText, "7 tot 9 uur");
  assert.equal(na.infoUrl, b.bron);
  assert.match(na.info, /Naam uit een goedgekeurd besluit in eBesluit/);
  // Een besluit voor een andere dag, of voor een ander plein zonder dezelfde opbouw en afbouw, geeft geen naam.
  assert.equal(koppelBesluiten([f], [besluit({ dagen: ["2026-10-24"] })]).size, 0);
  assert.equal(koppelBesluiten([f], [besluit({ straten: ["Derdeplein"], plaats: "Derdeplein", opbouw: "2026-10-20", afbouw: "2026-10-25" })]).size, 0);
});

// ---------- oorzaak 3: de naam staat alleen in een bestek of een toewijzing van standplaatsen ----------

test("oorzaak 3: besluiten over een bestek of standplaatsen zijn geen organisatiebesluit; een handfiche over de hele periode geeft één agendapunt met de naam", () => {
  // Waarom de automatische koppeling ze overslaat (ze noemen geen dag en plaats in vaste zinnen).
  assert.equal(soortVanTitel("2099_CBS_09002 - Evenementen - Bestek PROEF_2099_001. Eindejaarsverlichting Proefwinter 2026-2027. Vastlegging krediet - Goedkeuring", "college van burgemeester en schepenen"), null);
  assert.equal(soortVanTitel("2099_CBS_09003 - Evenementen. Proefwinter 2026-2027 - Toewijzing standplaatsen kerstmarkt consumptie en koopwaar - Goedkeuring", "college van burgemeester en schepenen"), null);
  // De handfiche: alle evenementdagen (31), met de besluiten als bron.
  const dagen = Array.from({ length: 31 }, (_, i) => new Date(Date.UTC(2026, 11, 4 + i)).toISOString().slice(0, 10));
  assert.equal(dagen.at(-1), "2027-01-03");
  const f = feit("ET2099700003", {
    dagen: [dagen[0], dagen.at(-1)], beginStraat: "Proefplein", kernStraten: ["Proefplein", "Proefmarkt"], zone: ["Proefplein", "Proefmarkt"],
    fasen: [{ naam: "Opbouw", start: "2026-11-15", eind: "2026-12-04" }, { naam: "Evenement", start: dagen[0], eind: dagen.at(-1) }],
  });
  const hand = { dossiers: { ET2099700003: fiche({ zekerheid: "zeker", naam: "Proefwinter", dagen }) } };
  const items = asignAgendapunten({ vandaag: "2026-11-20", retrievedAt: RETRIEVED, feiten: [f], hand }).items;
  assert.equal(items.length, 1, "één agendapunt over de hele periode, niet één per dag");
  assert.deepEqual([items[0].title, items[0].date, items[0].endDate], ["Proefwinter", "2026-12-04", "2027-01-03"]);
  assert.match(items[0].info, /Naam met de hand nagekeken bij een publieke bron\./);
  assert.doesNotMatch(items[0].info, /Organisatie:/, "de besluiten noemen geen organisator: dan ook geen");
});

// ---------- oorzaak 4: geen enkele toegelaten bron noemt het ----------

test("oorzaak 4: zonder naam zegt de titel wat en waar, zonder 'naam volgt'", () => {
  assert.equal(vormZonderNaam(feit("x", { langs: ["Proefstraat", "Tweedestraat"], routeMeter: 3_300, lus: true })), "lus van 3,3 km");
  assert.equal(vormZonderNaam(feit("x", { langs: ["Proefstraat"], routeMeter: 800 })), "route van 800 m");
  assert.equal(vormZonderNaam(feit("x", { langs: ["Proefstraat", "Tweedestraat", "Derdestraat"] })), "parcours door 3 straten");
  assert.equal(vormZonderNaam(feit("x", { zone: ["Proefstraat"] })), "verkeersvrije zone");
  assert.equal(vormZonderNaam(feit("x", { zone: ["Proefstraat", "Tweedestraat"] })), "verkeersvrije zone in 2 straten");
  assert.equal(vormZonderNaam(feit("x")), "");
  const t = (velden) => titelVan(feit("ET2099700004", velden), {}).titel;
  assert.equal(t({ langs: ["Proefstraat", "Tweedestraat"], routeMeter: 3_300, lus: true }), "Evenement in de Proefstraat: lus van 3,3 km, naam onbekend");
  assert.equal(t({ beginStraat: "Proefplein", kernStraten: ["Proefplein"], zone: ["Proefplein", "Tweedestraat"] }), "Evenement op het Proefplein: verkeersvrije zone in 2 straten, naam onbekend");
  assert.equal(t({ beginStraat: "", kernStraten: [], wijk: "" }), "Evenement in district Antwerpen, naam onbekend");
});

test("oorzaak 4: dossierFeiten neemt de lengte van de parcourslijn en of ze een lus is uit de vorm", () => {
  const f = dossierFeiten({ dossier: "ET2099700005", status: GOED, binnenDistrict: true, dagen: ["2026-10-18"], vorm: { lijnen: [[[4.4, 51.2], [4.41, 51.2]]], lengte: 3_312, lus: false, keten: true, ketenLus: true, kern: [] } });
  assert.deepEqual([f.routeMeter, f.lus], [3_312, true]);
  const zonderLijn = dossierFeiten({ dossier: "ET2099700006", status: GOED, binnenDistrict: true, dagen: ["2026-10-18"], vorm: { lijnen: [], vlakken: [[]], lengte: 0, kern: [] } });
  assert.deepEqual([zonderLijn.routeMeter, zonderLijn.lus], [0, false]);
});

test("oorzaak 4: de tekst zegt waarom er geen naam is, met wat de handfiche nakeek, en noemt het dossier", () => {
  const f = feit("ET2099700007", { langs: ["Proefstraat", "Tweedestraat"], routeMeter: 4_800 });
  const zonder = bouw({ feiten: [f] }).items[0];
  assert.match(zonder.info, new RegExp(`${ZONDER_NAAM_ZIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} ${NAAM_LATER_ZIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(zonder.info, /Evenementendossier ET2099700007 van de stad \(A-Sign\)/);
  const reden = "Het dossier heeft geen naam of omschrijving, en geen publieke bron noemt een parcours op 18 oktober";
  const hand = { dossiers: { ET2099700007: fiche({ reden, dagen: ["2026-10-18"] }) } };
  const met = bouw({ feiten: [f], hand }).items[0];
  assert.match(met.info, /Naam onbekend\. Het dossier heeft geen naam of omschrijving, en geen publieke bron noemt een parcours op 18 oktober\. Komt er een besluit/);
  for (const item of [zonder, met]) {
    assert.doesNotMatch(`${item.title} ${item.info}`, /naam volgt|die volgt zodra/i);
    assert.ok(item.info.length <= 600);
  }
});

test("oorzaak 4: bij een lange tekst blijft er een korte reden staan, en het dossier altijd", () => {
  const veel = Array.from({ length: 30 }, (_, i) => `Proefstraat${String.fromCharCode(65 + (i % 26))}${i}`);
  const f = feit("ET2099700008", {
    langs: veel, zone: veel.slice(0, 20), routeMeter: 9_000, dagen: ["2026-10-17", "2026-10-18"],
    fasen: [{ naam: "Opbouw", start: "2026-10-12", eind: "2026-10-16" }, { naam: "Evenement", start: "2026-10-17", eind: "2026-10-18" }, { naam: "Afbraak", start: "2026-10-19", eind: "2026-10-20" }],
  });
  const hand = { dossiers: { ET2099700008: fiche({ reden: "Proefreden ".repeat(35).trim(), dagen: ["2026-10-17", "2026-10-18"] }) } };
  for (const item of bouw({ feiten: [f], hand }).items) {
    assert.ok(item.info.length <= 600, item.info.length);
    assert.match(item.info, /Naam onbekend/);
    assert.match(item.info, /Evenementendossier ET2099700008 van de stad \(A-Sign\): aanvraag goedgekeurd\.$/);
  }
});

test("oorzaak 4: ook bij een soort zonder naam belooft de tekst niets ('naam volgt')", () => {
  const f = feit("ET2099700009", { langs: ["Proefstraat", "Tweedestraat"] });
  for (const auto of [fiche({ zekerheid: "waarschijnlijk", soort: "een wielerwedstrijd", methode: "regels" }), fiche({ zekerheid: "zeker", soort: "wielerwedstrijd", methode: "kalender" })]) {
    const item = bouw({ feiten: [f], auto: { dossiers: { ET2099700009: auto } } }).items[0];
    assert.match(item.title, /wielerwedstrijd in de Proefstraat$/i);
    assert.match(item.info, /een naam komt er pas als een besluit, een kalender of de organisator hem noemt\./i);
    assert.doesNotMatch(item.info, /naam volgt/i);
  }
});
