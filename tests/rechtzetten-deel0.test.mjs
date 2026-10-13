// Deel 0 van het plan van 12 oktober 2026 ("eerst rechtzetten"): fouten die de site nu zelf maakt.
//  0.1 verouderde historiek: een samenvatting van oudere code telt niet meer (ET2026004365, Groenplaats);
//  0.2 oppervlakte uit Shape_Area (ET2025006923: 101,5 m², niet "ongeveer 80");
//  0.3 de plaatsnamen van de 26 plekken, na het privacybeleid (docs/PUBLIC_SPACE_SOURCE_POLICY.md);
//  0.4 koopzondagen: de stad noemt geen uren (geen eigen zin over winkels);
//  0.5 handfiche EkeRun volgens de bronpagina;
//  0.7 een UiT-link in een mailsignaal wordt niet opgehaald.
// Geen netwerk, geen klok.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HISTORIEK_VERSIE, VELDEN_PER_LAAG, asignVraag, herkenParcours, historiekGeldig, historiekSleutel, historiekTaken, historiekVanDezeVersie } from "../lib/parcours-herkenning-refresh.mjs";
import { dossiersUitAsign, herkenDossier, omvangTekst, plekFeiten, plekKort, verrijk } from "../lib/parcours-herkenning.mjs";
import { plaatsnaamVan } from "../lib/plaatsnaam.mjs";
import { validateHerkenning } from "../lib/evenement-herkenning-validatie.mjs";
import { bruikbareBeschrijving, evenementFeiten, evenementKaartje } from "../site/kaart-uitleg.js";
import { INFO as KOOPZONDAG_INFO, KOOPZONDAGEN_URL } from "../lib/koopzondagen.mjs";
import { run as mailRun } from "../scripts/fetch-sources-mail.mjs";
import { sha256Hex } from "../lib/mail-signals.mjs";
import { validateSourceDocument } from "../lib/source-feed.mjs";
import { laadFixtures, VANDAAG } from "./helpers/parcours-herkenning-evaluatie.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------- 0.1 verouderde historiek ----------

const F = laadFixtures(root);
const ID = "ET2026004615";
// Zoals de A-Sign-features van tests/parcours-herkenning.test.mjs (nepFetch): het dossier zelf, laatst bewerkt op
// 1 september 2026; de historiek (oudere jaren) is er niet (geen netwerk), dus de bewaarde samenvatting beslist.
const features = F.asign.features.filter((f) => f.attributes.dossierNummer === ID).map((f, i) => ({ ...f, attributes: { ...f.attributes, OBJECTID: i + 1, last_edited_date: Date.UTC(2026, 8, 1) } }));
function nepAsign() {
  const laag = (url) => (String(url).includes("/MapServer/23/") ? "paths" : "rings");
  const antwoord = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });
  return async (url) => {
    const u = String(url);
    const isAsign = u.includes("/P_ASign/ASign/MapServer/");
    const isHistoriek = isAsign && /faseStartDatum >= DATE '20(?:23|24|25)/.test(decodeURIComponent(u).replace(/\+/g, " "));
    if (!isAsign || isHistoriek) throw Object.assign(new Error("geen netwerk"), { code: "network_error" });
    const mine = features.filter((f) => (laag(u) === "paths" ? f.geometry?.paths : f.geometry?.rings));
    if (u.includes("returnIdsOnly=true")) return antwoord({ objectIds: mine.map((f) => f.attributes.OBJECTID) });
    const gevraagd = new Set((new URL(u).searchParams.get("objectIds") || "").split(",").map(Number));
    return antwoord({ features: mine.filter((f) => gevraagd.has(f.attributes.OBJECTID)) });
  };
}
function tijdelijkeRoot(cache) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rechtzetten-"));
  for (const sub of [["site", "sources"], ["site", "geo"], ["lib"]]) fs.mkdirSync(path.join(dir, ...sub), { recursive: true });
  for (const f of ["studentencharter.json", "districten-antwerpen.geojson", "district-antwerpen-grens.geojson"]) fs.copyFileSync(path.join(root, "lib", f), path.join(dir, "lib", f));
  fs.writeFileSync(path.join(dir, "lib", "organisator-feeds.json"), JSON.stringify({ feeds: [] }));
  fs.writeFileSync(path.join(dir, "site", "sources", "evenement-identiteit.json"), JSON.stringify({ schemaVersion: 1, bijgewerkt: VANDAAG, uitleg: "", dossiers: {} }));
  fs.writeFileSync(path.join(dir, "site", "sources", "evenement-patronen.json"), JSON.stringify({ schemaVersion: 1, bijgewerkt: VANDAAG, uitleg: "", patronen: {}, cache: { historiek: cache, straten: {} } }));
  return dir;
}
// Het dossier zoals de verversing het ziet (dezelfde sleutel als historiekSleutel in de verversing).
const dossier = verrijk(dossiersUitAsign(features).get(ID), { districten: F.districten });
// Een oud studentensignaal: twee andere dossiers op dezelfde plek, zoals bij ET2026004365 (zonder "dag").
const studentItems = [{ dossier: "ET2024000001", jaar: "2024", soorten: ["student"], overlap: 1 }, { dossier: "ET2025000002", jaar: "2025", soorten: ["student"], overlap: 1 }];
const oudeSleutel = historiekSleutel(dossier).replace(`${HISTORIEK_VERSIE}|`, "");

test("0.1 cache: een sleutel zonder codeversie is niet meer geldig, en het dossier vraagt zijn historiek opnieuw", () => {
  assert.match(historiekSleutel(dossier), new RegExp(`^${HISTORIEK_VERSIE}\\|`));
  assert.equal(historiekGeldig({ sleutel: oudeSleutel, items: studentItems }, dossier), false);
  assert.equal(historiekGeldig({ sleutel: `b2|${oudeSleutel}`, items: studentItems }, dossier), false);
  assert.equal(historiekGeldig({ sleutel: historiekSleutel(dossier), items: [] }, dossier), true);
  assert.equal(historiekVanDezeVersie({ sleutel: oudeSleutel }), false);
  assert.equal(historiekVanDezeVersie({ sleutel: `b2|${historiekSleutel(dossier)}` }), true);
  assert.deepEqual(historiekTaken([dossier], { oud: { [ID]: { sleutel: oudeSleutel, items: studentItems } } }).map((d) => d.dossier), [ID]);
});

test("0.1 cache: een oude samenvatting zonder dag draagt haar signaal niet meer, ook niet tot ze opnieuw gevraagd is", async () => {
  const signaal = async (sleutel, items = studentItems) => {
    const dir = tijdelijkeRoot({ [ID]: { sleutel, items } });
    try {
      const doc = await herkenParcours({ rootDir: dir, fetch: nepAsign(), clock: () => new Date(`${VANDAAG}T08:00:00Z`), log: () => {}, historiekBudgetMs: 1_000, streetFeatures: { features: [] } });
      assert.ok(doc, "de herkenning liep");
      const cache = JSON.parse(fs.readFileSync(path.join(dir, "site", "sources", "evenement-patronen.json"), "utf8")).cache.historiek;
      return { signalen: doc.dossiers[ID].signalen.join(" | "), cache: cache[ID] || null };
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };
  // Controle: met de sleutel van deze versie telt het bewaarde antwoord (zo zie je dat de toets iets meet).
  const nu = await signaal(historiekSleutel(dossier));
  assert.match(nu.signalen, /vroeger op dezelfde plek: studentenactiviteit \(2024, 2025\)/);
  // Een samenvatting van oudere code (zonder versie) met items zonder dag: weg, ook als de historiek nu niet
  // opnieuw op te vragen is.
  const oud = await signaal(oudeSleutel);
  assert.doesNotMatch(oud.signalen, /studentenactiviteit/);
  assert.equal(oud.cache, null, "de oude samenvatting blijft niet in de cache staan");
  // Items van oudere code mét dag (de vorm sinds de weekcontrole): die blijven tot de nieuwe samenvatting er
  // is (geen flapperende fiche), met de oude sleutel zodat ze opnieuw gevraagd worden.
  const metDag = studentItems.map((h) => ({ ...h, dag: `${h.jaar}-10-20` }));
  const blijft = await signaal(oudeSleutel, metDag);
  assert.match(blijft.signalen, /vroeger op dezelfde plek: studentenactiviteit/);
  assert.equal(blijft.cache.sleutel, oudeSleutel, "de volgende verversing vraagt het opnieuw");
});

// ---------- 0.2 en 0.3: oppervlakte en plaatsnamen van ET2025006923 ----------

// De 26 plekken van ET2025006923 zoals A-Sign ze geeft (laag 22, 12 oktober 2026): omschrijving, Shape_Area
// en het midden. De vorm in de toets is een vierkantje van een paar dm (zoals een sterk vereenvoudigde vorm):
// de oppervlakte moet dus uit Shape_Area komen.
const PLEKKEN = [
  ["Teniersplaats", 25.01, 4.41477, 51.21816], ["De Coninckplein", 6.6, 4.42037, 51.22159], ["Elisabeth", 3.05, 4.42461, 51.22272],
  ["Groenplaats", 2.39, 4.40134, 51.21884], ["Abdijstraat", 2.24, 4.37852, 51.19009], ["Offerande-Dambrugge", 3.88, 4.42354, 51.21941],
  ["Sint-Jansplein", 3.67, 4.41764, 51.22483], ["Gummarus", 3.73, 4.41969, 51.22465], ["Astridplein", 1.98, 4.42067, 51.21853],
  ["Quinten Matsijslei - Van Eycklei", 3.15, 4.41744, 51.21048], ["Mechelsplein", 3.97, 4.40523, 51.2127], ["Pleintje Schrijnwerksttraat- Lombardenvest", 3.18, 4.40399, 51.21746],
  ["Theodoor Van Rijswijckplaats", 3.41, 4.39966, 51.21677], ["Pleintje Lijnwaadmarkt-Melkmarkt", 1.59, 4.4022, 51.22047], ["Van Eedenplein", 2.52, 4.38672, 51.22057],
  ["Brederodestraat (terminus)", 4.57, 4.39159, 51.20121], ["Montigny-ieperstraat", 2.13, 4.39164, 51.20318], ["Middelheimpark", 2.32, 4.40723, 51.18324],
  ["Metrostation Handel", 2.83, 4.43206, 51.22416], ["Van Stralenstraat-Gemeentestraat", 4.04, 4.41848, 51.21977], ["Ellermanstraat-Lange Dijkstraat", 3.25, 4.42035, 51.22969],
  ["Scheldekaaien (buurt Steenplein)", 4.69, 4.39695, 51.22248], ["Willemsdok", 1.21, 4.40583, 51.22828], ["Kattendijkdok", 1.04, 4.40812, 51.2335],
  ["Sint-Jansplein-Van De Wervestraat", 1.16, 4.41651, 51.22603], ["Jos Smoldersstraat – Leon Stynenstraat", 3.84, 4.38443, 51.20664],
];
const vierkantje = ([x, y], d = 0.000003) => [[[x - d, y - d], [x + d, y - d], [x + d, y + d], [x - d, y + d], [x - d, y - d]]];
const plekFeatures = PLEKKEN.map(([naam, m2, x, y], i) => ({
  attributes: { dossierNummer: "ET2025006923", dossierStatus: "aanvraag_goedgekeurd", faseNaam: "Evenement", faseStartDatum: Date.UTC(2026, 0, 1), faseEindDatum: Date.UTC(2026, 11, 31), innameTypeNaam: "Inname", innameBeschrijving: naam, last_edited_date: Date.UTC(2025, 10, 30), Shape_Area: m2, OBJECTID: i + 1 },
  geometry: { rings: vierkantje([x, y]) },
}));
// De straten binnen 150 m die de straatas geeft voor de namen die niet op een zekere plaatsuitgang eindigen
// (nagekeken op 12 oktober 2026 met de straatas van de stad, alleen de straten die het bewijs leveren): de
// Sint-Elisabethstraat, de Sint-Gummarusstraat, de Offerande- en Dambruggestraat, de Handelstraat bij
// "Metrostation Handel", de Montignystraat, en de straten die een voornaam dragen ("Quinten", "Theodoor", "Jos",
// "Leon", "Lange") of op -lei of -vest eindigen. Elders: een straat zonder die woorden.
const RONDOM = {
  Elisabeth: ["Greinstraat", "Sint-Elisabethstraat"], Gummarus: ["Sint-Jansplein", "Sint-Gummarusstraat"], "Offerande-Dambrugge": ["Offerandestraat", "Dambruggestraat"],
  "Quinten Matsijslei - Van Eycklei": ["Quinten Matsijslei", "Van Eycklei"], "Theodoor Van Rijswijckplaats": ["Theodoor Van Rijswijckplaats"],
  "Pleintje Schrijnwerksttraat- Lombardenvest": ["Schrijnwerkersstraat", "Lombardenvest"], "Montigny-ieperstraat": ["Ieperstraat", "Montignystraat"],
  "Metrostation Handel": ["Handelstraat"], "Ellermanstraat-Lange Dijkstraat": ["Lange Dijkstraat", "Ellermanstraat"],
  "Jos Smoldersstraat – Leon Stynenstraat": ["Jos Smolderenstraat", "Léon Stynenstraat"],
};
const stratenRond = (p) => {
  const plek = PLEKKEN.find(([, , x, y]) => Math.abs(x - p[0]) < 0.0002 && Math.abs(y - p[1]) < 0.0002);
  return RONDOM[plek?.[0]] || ["Proefstraat"];
};

test("0.2 A-Sign: Shape_Area wordt gevraagd in laag 22 (niet in laag 23, die het veld niet heeft), nooit dossierBeheerder", async () => {
  assert.match(VELDEN_PER_LAAG[22], /(?:^|,)Shape_Area(?:,|$)/);
  assert.doesNotMatch(VELDEN_PER_LAAG[23], /Shape_Area/);
  for (const v of Object.values(VELDEN_PER_LAAG)) assert.doesNotMatch(v, /dossierBeheerder|aanvrager/i);
  const gevraagd = [];
  const nep = async (url) => {
    gevraagd.push(new URL(String(url)));
    const body = String(url).includes("returnIdsOnly=true") ? { objectIds: [1] } : { features: [] };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
  await asignVraag(nep, 22, { where: "1=1" });
  await asignVraag(nep, 23, { where: "1=1" });
  const velden = gevraagd.filter((u) => u.searchParams.get("outFields")).map((u) => [u.pathname.match(/MapServer\/(\d+)/)[1], u.searchParams.get("outFields")]);
  assert.deepEqual(velden.map(([l, v]) => [l, v.includes("Shape_Area")]), [["22", true], ["23", false]]);
});

test("0.2 oppervlakte: 26 plekken van ET2025006923 zijn samen 101,5 m² (\"ongeveer 100 m²\"), niet 80", () => {
  const d = dossiersUitAsign(plekFeatures).get("ET2025006923");
  // A-Sign: samen 101,5 m² (101,45 met de twee decimalen van deze toets).
  assert.ok(Math.abs(d.innames.reduce((n, i) => n + i.m2, 0) - 101.45) < 0.01);
  const pf = plekFeiten(d.innames, { stratenRond });
  assert.equal(pf.aantal, 26);
  assert.equal(pf.m2, 101);
  const v = verrijk(d, { districten: F.districten, stratenRond });
  assert.match(omvangTekst(v), /^26 kleine plekken, samen ongeveer 100 m²$/);
  // Zonder Shape_Area (een oudere stand): dan de vorm zelf, en die is hier veel te klein.
  const zonder = dossiersUitAsign(plekFeatures.map((f) => ({ ...f, attributes: { ...f.attributes, Shape_Area: null } }))).get("ET2025006923");
  assert.ok(plekFeiten(zonder.innames).m2 < 10);
});

test("0.3 plaatsnamen: alle 26 namen staan in de fiche, de titel noemt de eerste, nergens \"verspreid over de stad\"", () => {
  const d = verrijk(dossiersUitAsign(plekFeatures).get("ET2025006923"), { districten: F.districten, stratenRond });
  assert.deepEqual(d.plekken.namen, PLEKKEN.map(([n]) => n));
  assert.equal(plekKort(d), "op 26 plekken: Teniersplaats, De Coninckplein, Elisabeth en 23 andere");
  const r = herkenDossier(d, { vandaag: "2026-10-12" });
  assert.deepEqual(r.plekNamen, PLEKKEN.map(([n]) => n));
  assert.match(r.waar, /^26 kleine plekken, samen ongeveer 100 m²: Teniersplaats, De Coninckplein, Elisabeth, Groenplaats, Abdijstraat, Offerande-Dambrugge en 20 andere/);
  for (const t of [r.waar, r.plek, r.kaartzin]) assert.doesNotMatch(t, /verspreid over de stad/);
  assert.deepEqual(validateHerkenning({ schemaVersion: 1, generatedAt: "2026-10-12T05:00:00Z", bijgewerkt: "2026-10-12", uitleg: "", samenvatting: { dossiers: 1, metHandfiche: 0, automatisch: 1, zeker: 0, waarschijnlijk: 0, alleenKaartzin: 0 }, dossiers: { ET2025006923: r } }), []);
  // De kaart: titel met de plek, en alle 26 namen in het detail ("Plekken").
  const rows = plekFeatures.map((f) => ({ reference: "ET2025006923", kind: "iod", dossierType: "ETL", phase: "Evenement", innameType: "Inname", start: "2026-01-01", end: "2026-12-31", streets: [] }));
  const k = evenementKaartje(evenementFeiten(rows), { vandaag: "2026-10-12", identiteit: r });
  assert.equal(k.titel, "Innames op 26 plekken: Teniersplaats, De Coninckplein, Elisabeth en 23 andere");
  const plekken = k.regels.find(([dt]) => dt === "Plekken")?.[1] || "";
  for (const [naam] of PLEKKEN) assert.ok(plekken.includes(naam), naam);
  assert.doesNotMatch(JSON.stringify(k), /verspreid over de stad/);
});

test("0.3 privacyfilter: geen e-mail, telefoon, link, huisnummer of persoonsnaam; een los woord alleen met een straat in de buurt", () => {
  for (const [naam] of PLEKKEN) assert.equal(plaatsnaamVan(naam, { rond: RONDOM[naam] || [] }), naam, naam);
  // De straatas als geheel (isStraat, de verversing gebruikt index.byName) bewijst een hele straatnaam ook zonder
  // straten in de buurt.
  const isStraat = (n) => ["quinten matsijslei", "van eycklei"].includes(n.toLowerCase());
  assert.equal(plaatsnaamVan("Quinten Matsijslei - Van Eycklei", { rond: [], isStraat }), "Quinten Matsijslei - Van Eycklei");
  for (const t of ["Testpersoon Voorbeeld", "Proefkring Testpersoon Voorbeeld", "info@voorbeeld.test", "bel 0470 12 34 56", "www.voorbeeld.test", "Proefstraat 12", "grote markt, verkoop", "Startlocatie doop", "Testpersoon Proef Kerkstraat"]) assert.equal(plaatsnaamVan(t, { rond: ["Proefstraat"] }), "", t);
  // "Elisabeth" alleen kan een voornaam zijn: zonder een Elisabethstraat in de buurt geen plaatsnaam.
  assert.equal(plaatsnaamVan("Elisabeth", { rond: ["Greinstraat", "Diepestraat"] }), "");
  assert.equal(plaatsnaamVan("Elisabeth", { rond: ["Sint-Elisabethstraat"] }), "Elisabeth");
  // Een plek zonder plaatsnaam telt mee bij het aantal, niet bij de namen.
  const d = verrijk(dossiersUitAsign(plekFeatures).get("ET2025006923"), { districten: F.districten, stratenRond: () => [] });
  assert.equal(d.plekken.aantal, 26);
  assert.deepEqual(d.plekken.namen.filter((n) => ["Elisabeth", "Gummarus", "Offerande-Dambrugge"].includes(n)), []);
  // De omschrijvingen met een trefwoord (de kaart van een evenement) krijgen dezelfde filter op persoonsnamen.
  assert.equal(bruikbareBeschrijving("Startlocatie doop"), "Startlocatie doop");
  assert.equal(bruikbareBeschrijving("tweede stop (Falconplein)"), "tweede stop (Falconplein)");
  // Een gewoon woord met een hoofdletter ("Tweede", "Stop") kan een achternaam zijn (nakijkronde 13 oktober 2026).
  assert.equal(bruikbareBeschrijving("Tweede Stop (Falconplein)"), "");
  assert.equal(bruikbareBeschrijving("Doopfeest Testpersoon Voorbeeld"), "");
});

// Nakijkronde van tak #170: de filter hield zich niet aan zijn eigen contract. Verzonnen proefteksten.
test("0.3 privacyfilter (nakijk): elke naam moet in de straatas staan, ook één naam voor een plaatswoord of na Parking, Hoek of Buurt", () => {
  // Zonder straten rond (of alleen een straat zonder die namen) geeft geen enkele hiervan een plaatsnaam.
  const proef = ["Testpersoon Groenplaats", "Voorbeeld Kerkstraat", "Hoek Voorbeeldmans", "Buurt Voorbeeld", "Hoek Testpersoon", "Parking Testpersoon",
    "Familie Van Proefdijk", "Testpersoon Van Proefdijk", "Testpersoon Voorbeeldberg", "Testpersoon Proefberg", "Testpersoon De Proeflaan", "Testpersoon Vandeproefveld", "Van Proefdijk", "Voorbeeldberg",
    "Sticker Koningstraat", "Sticker plein Mutsaard", "Sticker Varkensmarkt", "Demo's Kattendijkdok", "Demo's Bonapartedok",
    "Feestverlichting Galifortlei", "Opbouw Gallifortlei", "Parking catering", "Parkeerverbod op plein", "voetpad", "catering"];
  for (const t of proef) {
    assert.equal(plaatsnaamVan(t, { rond: [] }), "", t);
    assert.equal(plaatsnaamVan(t, { rond: ["Proefstraat", "Kerkstraat", "Koningstraat"] }), "", t);
  }
  // Twee namen na elkaar ("Jan Blom") zijn geen stuk van een straatnaam (de Jan Blomstraat): alleen hele woorden.
  assert.equal(plaatsnaamVan("Jan Blom", { rond: ["Jan Blomstraat"] }), "");
  // Wel: de naam van een metrostation die een straat in de buurt draagt, en een samengesteld woord op een zekere uitgang.
  assert.equal(plaatsnaamVan("Metrostation Handel", { rond: ["Handelstraat"] }), "Metrostation Handel");
  assert.equal(plaatsnaamVan("Metrostation Handel", { rond: ["Proefstraat"] }), "");
  assert.equal(plaatsnaamVan("Middelheimpark", { rond: [] }), "Middelheimpark");
  // Volledig nagespeeld: De Coninckplein wordt "Familie Van Proefdijk". Die naam komt nergens in de fiche of de kaart.
  const metNaam = plekFeatures.map((f) => (f.attributes.innameBeschrijving === "De Coninckplein" ? { ...f, attributes: { ...f.attributes, innameBeschrijving: "Familie Van Proefdijk" } } : f));
  const d = verrijk(dossiersUitAsign(metNaam).get("ET2025006923"), { districten: F.districten, stratenRond });
  assert.equal(d.plekken.aantal, 26);
  assert.ok(!d.plekken.namen.includes("Familie Van Proefdijk"));
  const r = herkenDossier(d, { vandaag: "2026-10-12" });
  assert.doesNotMatch(JSON.stringify(r), /Familie Van Proefdijk/);
  assert.match(r.plek, /^op 26 plekken: Teniersplaats, Elisabeth, Groenplaats en 23 andere$/);
  const rows = metNaam.map(() => ({ reference: "ET2025006923", kind: "iod", dossierType: "ETL", phase: "Evenement", innameType: "Inname", start: "2026-01-01", end: "2026-12-31", streets: [] }));
  assert.doesNotMatch(JSON.stringify(evenementKaartje(evenementFeiten(rows), { vandaag: "2026-10-12", identiteit: r })), /Familie Van Proefdijk/);
});

test("0.3 omschrijvingen (nakijk): een losse naam naast een trefwoord, 'Van' of 'De' tussen namen en een achternaam op -dijk of -berg", () => {
  for (const t of ["Feest Testpersoon", "Startlocatie doop Testpersoon Van Proefdijk", "Start Testpersoon Voorbeeldberg", "Doopfeest Testpersoon Voorbeeld", "Wandelen van Zomaar een Dak naar de Proefstraat", "Stop bij Familie De Laan"]) assert.equal(bruikbareBeschrijving(t), "", t);
  // "Van" is geen trefwoord: een straatnaam alleen is geen omschrijving van het evenement.
  assert.equal(bruikbareBeschrijving("Van Eycklei"), "");
  // Een plek die de straatas kent, telt niet als naam: als hele straatnaam (isStraat) of als straat van de inname.
  assert.equal(bruikbareBeschrijving("eerste stop (Proefwaag)"), "");
  assert.equal(bruikbareBeschrijving("eerste stop (Proefwaag)", { isStraat: (n) => n === "Proefwaag" }), "eerste stop (Proefwaag)");
  assert.equal(bruikbareBeschrijving("eerste stop (Proefwaag)", { straten: [{ name: "Proefwaag" }] }), "eerste stop (Proefwaag)");
  // "Eerste" en "Stop" met een hoofdletter kunnen achternamen zijn: de straatas bewijst alleen de plek.
  assert.equal(bruikbareBeschrijving("Eerste Stop (Proefwaag)", { isStraat: (n) => n === "Proefwaag" }), "");
  assert.equal(bruikbareBeschrijving("wandelen van de Proefwaag naar het Falconplein", { straten: ["Proefwaag"] }), "wandelen van de Proefwaag naar het Falconplein");
  // Een samenstelling van gewone woorden ("Verkeersvrije": verkeer-s-vrij-e) en een klein woord ("Enkel") zijn geen naam.
  assert.equal(bruikbareBeschrijving("Verkeersvrije zone. Enkel tijdens de stoet"), "Verkeersvrije zone. Enkel tijdens de stoet");
});

test("0.3 dossierBeheerder staat nergens in wat de site publiceert, en het beleid zegt het", () => {
  const treffers = [];
  const kijk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) kijk(p);
      else if (/\.(?:json|js|html)$/.test(e.name) && fs.readFileSync(p, "utf8").includes("dossierBeheerder")) treffers.push(path.relative(root, p));
    }
  };
  kijk(path.join(root, "site"));
  assert.deepEqual(treffers, []);
  const beleid = fs.readFileSync(path.join(root, "docs", "PUBLIC_SPACE_SOURCE_POLICY.md"), "utf8");
  assert.match(beleid, /dossierBeheerder wordt nooit opgehaald, bewaard of getoond/);
  assert.match(beleid, /innameBeschrijving[^\n]*opgehaald, maar nooit als vrije tekst gepubliceerd/);
  assert.match(beleid, /een plaatsnaam/);
});

// ---------- 0.4 koopzondagen ----------

test("0.4 koopzondagen: de tekst schrijft de stad geen uitspraak toe die ze niet doet", () => {
  assert.doesNotMatch(KOOPZONDAG_INFO, /verschillen per winkel/i);
  assert.match(KOOPZONDAG_INFO, /De stad noemt geen uren/);
  assert.equal(KOOPZONDAGEN_URL, "https://www.antwerpen.be/info/koopzondagen");
});

// ---------- 0.5 handfiche EkeRun ----------

test("0.5 EkeRun (ET2026004192): verzamelen aan de kantine van atletiekclub Break in het Hagelkruispark, zoals de bronpagina zegt", () => {
  const hand = JSON.parse(fs.readFileSync(path.join(root, "site", "sources", "evenement-identiteit.json"), "utf8")).dossiers.ET2026004192;
  assert.match(hand.waar, /kantine van atletiekclub Break in het Hagelkruispark/);
  assert.doesNotMatch(hand.waar, /Schinde/);
  assert.equal(hand.uren, "verzamelen om 9.30 uur");
  assert.ok(hand.bron.includes(hand.link) && /^https:\/\/www\.antwerpen\.be\/info\//.test(hand.link));
});

// ---------- 0.7 UiT-links in mailsignalen ----------

test("0.7 een UiT-link in een mail wordt niet opgehaald en niet gepubliceerd (niemand keek titel en datum na); ook niet via een doorverwijzing", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rechtzetten-mail-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "site", "sources"), { recursive: true });
  const ENDPOINT = "https://gateway.example.invalid/v1/publiek/publieke-agenda/mail-signalen.json";
  const UIT = "https://www.uitinvlaanderen.be/agenda/e/proefwandeling/00000000-aaaa-4bbb-8ccc-000000000009";
  // Een kortelink van de stad die doorverwijst naar UiT (nagespeeld in de nakijkronde): ook die UiT-pagina niet.
  const KORT = "https://www.antwerpen.be/info/proef-kortelink";
  const signaal = (url, titel, dag) => ({ id: sha256Hex(url), title: titel, start: `${dag}T10:00`, end: `${dag}T17:00`, all_day: false, place: "Proefplein, 2000 Antwerpen", url, group: "stad", source: "mail-nieuwsbrief", sender_class: "participatie", first_seen: "2026-10-11", page_checked_on: "2026-10-11" });
  const gevraagd = [];
  const fetchImpl = async (url) => {
    gevraagd.push(String(url));
    if (String(url) === KORT) return { ok: false, status: 302, headers: { get: (h) => (h === "location" ? "https://www.uitinvlaanderen.be/agenda/e/proef/1234" : null) }, text: async () => "" };
    if (String(url) !== ENDPOINT) throw new Error(`onverwacht verzoek naar ${url}`);
    const body = JSON.stringify({ schema_version: 1, generated_on: "2026-10-11", items: [signaal(UIT, "Verkeerd overgetypte titel van een wandeling", "2026-10-20"), signaal(KORT, "Proefwandeling door het oude centrum", "2026-10-21")] });
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => body, json: async () => JSON.parse(body) };
  };
  const log = [];
  await mailRun({ rootDir: dir, env: { MAIL_SIGNALEN_URL: ENDPOINT }, fetch: fetchImpl, clock: () => new Date("2026-10-12T06:00:00Z"), log: (r) => log.push(r) });
  assert.deepEqual(gevraagd, [ENDPOINT, KORT], "de UiT-pagina wordt nooit opgehaald, ook niet na een doorverwijzing");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "site", "sources", "mail-stad.json"), "utf8")).items, [], "niets ongecontroleerd online");
  assert.match(log.join("\n"), /"uit_niet_nagekeken":1/);
  assert.match(log.join("\n"), /"uit_not_fetched":1/);
  // De bronvermelding van de mailbronnen blijft waar: elk item is nagekeken. Een item met een UiT-link haalt de
  // validatie niet.
  const doc = JSON.parse(fs.readFileSync(path.join(dir, "site", "sources", "mail-stad.json"), "utf8"));
  assert.match(doc.attribution.text, /opnieuw gecontroleerd/);
  const item = { id: "mail-0123456789abcdef-2026-10-20", externalId: "0123456789abcdef", title: "Proefwandeling door het oude centrum", theme: "Activiteit", className: "activity", date: "2026-10-20", endDate: null, timeSlot: "Info", timeText: "", location: "locatie via de officiële bron", postcodes: [], info: "", kind: "activity", sourceUrl: UIT, retrievedAt: "2026-10-12T06:00:00.000Z", reviewRequired: false };
  assert.ok(validateSourceDocument({ ...doc, items: [item] }, { expectedSourceId: "mail-stad" }).some((f) => /UiT is niet nagekeken/.test(f)));
  assert.deepEqual(validateSourceDocument({ ...doc, items: [{ ...item, sourceUrl: "https://www.antwerpen.be/info/proef" }] }, { expectedSourceId: "mail-stad" }), []);
});
