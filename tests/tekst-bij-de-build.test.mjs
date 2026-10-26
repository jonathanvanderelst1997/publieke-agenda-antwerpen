// Tekst bij de build (vaagheidsplan van 12 oktober 2026, stap 6): een agendapunt uit de evenementendossiers bewaart
// de feiten waaruit zijn titel en info komen, en de build maakt die tekst opnieuw met de code van nu. Een bronbestand
// van vóór de feiten krijgt alleen de zinnen van nu in plaats van een belofte. Alle gegevens zijn verzonnen: dossiers
// ET2099..., straten als Proefstraat, geen personen. Geen netwerk.
import assert from "node:assert/strict";
import test from "node:test";

import { asignAgendapunten, asignEvenementenDocument, bewaardeFeiten, feitenUitItem, oudeTekstBijwerken, tekstUitFeiten } from "../lib/asign-evenementen-agenda.mjs";
import { validateSourceDocument } from "../lib/source-feed.mjs";
import { verbodenIn } from "../lib/vaagheid.mjs";
import { buildFeed, tekstBijDeBuild } from "../scripts/build-sources.mjs";
import { onbekendZin } from "../site/onbekend-zinnen.js";

const VANDAAG = "2026-10-10";
const RETRIEVED = "2026-10-10T05:20:00.000Z";
const feit = (dossier, velden = {}) => ({
  dossier, status: "aanvraag_goedgekeurd", bijgewerkt: "2026-09-01", binnenDistrict: true, fasen: [{ naam: "Evenement", start: "2026-10-18", eind: "2026-10-18" }],
  dagen: ["2026-10-18"], langs: ["Proefstraat", "Tweedestraat"], zone: [], kernStraten: ["Proefstraat"], beginStraat: "Proefstraat", wijk: "Proefwijk",
  postcodes: ["2000"], speelstraat: false, vorm: null, routeMeter: 4_800, lus: false, ...velden,
});
const fiche = (velden = {}) => ({ zekerheid: "zeker", naam: "", soort: "", organisator: "", uren: "", link: "", methode: "kaart", dagen: ["2026-10-18"], binnenDistrict: true, ...velden });
const opties = (velden = {}) => ({ vandaag: VANDAAG, retrievedAt: RETRIEVED, feiten: [feit("ET2099800001")], ...velden });

test("een agendapunt bewaart zijn feiten: dagen, codes en de straten als plaats in `straten`, geen vrije tekst", () => {
  const [item] = asignAgendapunten(opties()).items;
  assert.ok(item.feiten, "feiten");
  assert.deepEqual(Object.keys(item.feiten).sort(), ["bijgewerkt", "beginStraat", "dagen", "dossier", "kern", "langs", "routeMeter", "status", "wijk", "zone"].sort());
  assert.equal(item.feiten.dossier, "ET2099800001");
  assert.deepEqual(item.feiten.dagen, ["2026-10-18"]);
  // De straten als plaats in de lijst van het item: geen tweede kopie van de namen.
  assert.deepEqual(item.feiten.langs.map((i) => item.straten[i]), ["Proefstraat", "Tweedestraat"]);
  assert.deepEqual(item.feiten.kern.map((i) => item.straten[i]), ["Proefstraat"]);
  // Terug naar de feiten van de herkenning.
  const f = feitenUitItem(item);
  assert.deepEqual([f.dossier, f.langs, f.kernStraten, f.routeMeter, f.dagen], ["ET2099800001", ["Proefstraat", "Tweedestraat"], ["Proefstraat"], 4_800, ["2026-10-18"]]);
  assert.equal(feitenUitItem({ title: "x" }), null);
  // Een straat die niet in de lijst staat, valt weg; een dag die geen dag is ook.
  assert.deepEqual(bewaardeFeiten({ dossier: "ET2099800001", langs: ["Elders"], kernStraten: ["Proefstraat"] }, { straten: ["Proefstraat"], dagen: ["2026-10-18", "morgen"] }).kern, [0]);
  assert.deepEqual(bewaardeFeiten({ dossier: "ET2099800001", langs: ["Elders"] }, { straten: ["Proefstraat"], dagen: ["morgen"] }).dagen, []);
});

test("de bronvalidatie neemt de feiten aan en weigert vrije tekst, een straat buiten de lijst of een ander dossiernummer", () => {
  const { document } = asignEvenementenDocument(opties());
  assert.deepEqual(validateSourceDocument(document), []);
  const met = (feiten) => ({ ...document, items: document.items.map((item, i) => (i ? item : { ...item, feiten: { ...item.feiten, ...feiten } })) });
  assert.match(validateSourceDocument(met({ omschrijving: "Podium" })).join("\n"), /onverwachte sleutel feiten\.omschrijving/);
  assert.match(validateSourceDocument(met({ kern: [99] })).join("\n"), /feiten\.kern ongeldig/);
  assert.match(validateSourceDocument(met({ dossier: "GW2099-000001" })).join("\n"), /feiten\.dossier ongeldig/);
  assert.match(validateSourceDocument(met({ lus: false })).join("\n"), /feiten\.lus mag alleen true zijn/);
});

test("tekstUitFeiten: dezelfde tekst als de verversing, en een fiche die later kwam staat meteen in de titel", () => {
  const [item] = asignAgendapunten(opties()).items;
  assert.deepEqual(tekstUitFeiten(item), { title: item.title, info: item.info });
  // Een handfiche met een naam, na de ochtendverversing: de build neemt ze mee zonder nieuwe verversing.
  const hand = { dossiers: { ET2099800001: fiche({ naam: "Proefloop" }) } };
  const [verwacht] = asignAgendapunten(opties({ hand })).items;
  const nieuw = tekstUitFeiten(item, { hand });
  assert.equal(nieuw.title, verwacht.title);
  assert.equal(nieuw.info, verwacht.info);
  assert.match(nieuw.title, /Proefloop/);
  assert.equal(tekstBijDeBuild(item, { hand }).title, verwacht.title);
  // Een samengevoegd punt houdt zijn andere dossiers.
  assert.match(tekstUitFeiten({ ...item, ookDossiers: ["ET2099800002"] }).info, /Ook dossier ET2099800002\./);
});

test("oudeTekstBijwerken: een belofte uit een ouder bronbestand wordt de zin van nu; de rest blijft", () => {
  const oud = {
    id: "asign-ev-et2099800001-2026-10-18", title: "Evenement in de Proefstraat — naam volgt",
    info: "Parcours door 2 straten: Proefstraat en Tweedestraat. De stad publiceert bij dit dossier geen naam; die volgt zodra een besluit, een kalender of de organisator hem noemt. Evenementendossier ET2099800001 van de stad (A-Sign): aanvraag goedgekeurd.",
  };
  const nu = oudeTekstBijwerken(oud);
  assert.equal(nu.title, "Evenement in de Proefstraat");
  assert.equal(nu.info, `Parcours door 2 straten: Proefstraat en Tweedestraat. ${onbekendZin("naam-dossier")} Evenementendossier ET2099800001 van de stad (A-Sign): aanvraag goedgekeurd.`);
  const soort = oudeTekstBijwerken({ title: "Vermoedelijk een stoet in de Proefstraat", info: "Soort vermoed via de omschrijving in het dossier; niet bevestigd. De naam volgt zodra een besluit, een kalender of de organisator hem noemt. Evenementendossier ET2099800001 van de stad (A-Sign): aanvraag goedgekeurd." });
  assert.match(soort.info, /niet bevestigd\. Een naam komt er pas als een besluit, een kalender of de organisator hem noemt\. Evenementendossier/);
  for (const x of [nu, soort]) assert.deepEqual(verbodenIn({ titel: x.title, teksten: [x.info] }), []);
  // Zonder belofte: hetzelfde item, niet eens een kopie. Een gedachtestreepje in een gewone titel blijft.
  const gewoon = { title: "Proefloop — editie 3", info: "Organisatie: Proef vzw." };
  assert.equal(oudeTekstBijwerken(gewoon), gewoon);
  // tekstBijDeBuild: zonder feiten de oude tekst, bijgewerkt.
  assert.equal(tekstBijDeBuild(oud).title, "Evenement in de Proefstraat");
});

test("oudeTekstBijwerken: de tekst van main sinds #169 (', naam onbekend' in de titel, 'Naam onbekend: het dossier noemt geen naam, ...') wordt die van nu", () => {
  // Zoals de verversingen van main van 13 tot 16 oktober 2026 het schreven, met verzonnen straten en dossier.
  const oud = {
    externalId: "ET2099800003", title: "Evenement in de Proefstraat: lus van 3,4 km, naam onbekend",
    info: "Parcours door 2 straten: Proefstraat en Tweedestraat. Naam onbekend: het dossier noemt geen naam, en geen besluit, kalender, nieuwsbericht of organisatoragenda die we nakijken noemt met zekerheid een evenement op die dag en plek. Komt er een besluit (meestal 2 tot 6 weken vooraf) of een aankondiging, dan verschijnt de naam hier vanzelf. Evenementendossier ET2099800003 van de stad (A-Sign): aanvraag nog niet goedgekeurd.",
  };
  const nu = oudeTekstBijwerken(oud);
  assert.equal(nu.title, "Evenement in de Proefstraat: lus van 3,4 km");
  assert.equal(nu.info, `Parcours door 2 straten: Proefstraat en Tweedestraat. ${onbekendZin("naam-onbekend-lang")} Komt er een besluit (meestal 2 tot 6 weken vooraf) of een aankondiging, dan verschijnt de naam hier vanzelf. Evenementendossier ET2099800003 van de stad (A-Sign): aanvraag nog niet goedgekeurd.`);
  assert.deepEqual(verbodenIn({ titel: nu.title, teksten: [nu.info] }), []);
  // Met een handfiche: de naam uit de fiche, en de zin over de ontbrekende naam wordt die van de fiche.
  const hand = { dossiers: { ET2099800003: { naam: "Proefloop", zekerheid: "zeker" } } };
  const metFiche = oudeTekstBijwerken(oud, { hand });
  assert.equal(metFiche.title, "Proefloop");
  assert.doesNotMatch(metFiche.info, /naam onbekend|noemt geen naam/i);
  // "Naam onbekend." alleen (een zin uit de lijst) blijft.
  const kort = { title: "Evenement op het Proefplein", info: "Naam onbekend. Evenementendossier ET2099800004 van de stad (A-Sign): aanvraag goedgekeurd." };
  assert.equal(oudeTekstBijwerken(kort), kort);
});

test("buildFeed: de tekst komt uit de feiten, en de feiten gaan niet mee naar de feed", () => {
  const { document } = asignEvenementenDocument(opties());
  const hand = { dossiers: { ET2099800001: fiche({ naam: "Proefloop" }) } };
  const { feed } = buildFeed({ status: null, documents: [document], tekst: { hand, auto: null, besluiten: [] } }, []);
  const [item] = feed.items.filter((i) => i.sourceId === "district-asign-evenementen");
  assert.match(item.title, /Proefloop/);
  assert.equal("feiten" in item, false);
  assert.equal("fasen" in item, false);
  // Zonder fiches: de tekst van de verversing.
  const { feed: zonder } = buildFeed({ status: null, documents: [document] }, []);
  assert.equal(zonder.items[0].title, document.items[0].title);
});
