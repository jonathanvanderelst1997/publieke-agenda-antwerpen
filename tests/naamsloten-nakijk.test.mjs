// Nakijkrondes van head e2969b3 en 801ed9f (17 oktober 2026): de witte lijst van toen (site/witte-lijst.js) liet namen door
// die zelf op haar woordenlijst stonden, en kreeg er telkens een naamslot bij. Sinds de GRONDREGEL is er geen woordenlijst en
// geen naamslot meer: uit de tekst blijft alleen een volledige officiële straatnaam uit de straatas of een district over
// (tests/grondregel-privacyfilter.test.mjs). De invoer van die rondes blijft hier als regressie: van elke naam die geen
// straatnaam of district is, blijft niets over. De toetsen over de soort (de doop van een schip) blijven zoals ze waren.
// Alleen verzonnen proefdata (Testboot, Proefkaai, dossiers 2099); de straatas is de publieke van de repo (site/geo).
// Geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import * as KU from "../site/kaart-uitleg.js";
import * as PN from "../lib/plaatsnaam.mjs";
import * as PC from "../site/place-core.js";
import { sleutel } from "../site/witte-lijst.js";

const lees = (rel) => JSON.parse(fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8"));
// De straatas van de repo: district Antwerpen (site/geo/straten.json) en de andere districten (site/geo/straten-stad.json).
const STRAATAS = new Set([
  ...lees("site/geo/straten.json").streets.map((s) => sleutel(s[1])),
  ...lees("site/geo/straten-stad.json").straten.map((s) => sleutel(s[0])),
]);
const isStraat = (n) => STRAATAS.has(sleutel(n));

// De woorden van een tekst zoals een lezer ze ziet: zonder accenten en hoofdletters.
const woorden = (t) => (String(t ?? "").normalize("NFKC").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
const uitvoer = (t, opties = {}) => [
  KU.veiligeTekst(t, opties),
  KU.veiligeOmschrijving(`Inname: ${t}`, opties),
  PN.plaatsnaamVan(t, { isStraat: opties.isStraat || (() => false), rond: (opties.straten || []).map((s) => s?.name ?? s) }),
];
// Van de naam blijft geen enkel woord over, in geen enkele uitvoer, met en zonder straatas.
const geenNaam = (t, naam, opties = {}) => {
  for (const o of [{ ...opties }, { ...opties, isStraat }]) {
    for (const uit of uitvoer(t, o)) {
      const hier = new Set(woorden(uit));
      for (const w of woorden(naam)) assert.ok(!hier.has(w), `${JSON.stringify(t)} gaf ${JSON.stringify(uit)}: "${w}" is een naam`);
    }
  }
};

// De invoer van de nakijkronde van head e2969b3 en van head 801ed9f, met de naam die erin staat.
const RONDES = [
  ["Verhuis fam. Kerstproef", "Kerstproef"], ["Feest mevr. Bar", "Bar"], ["Verhuis Fam. Dağtest", "Dağtest"], ["Feest bij fam. Dam", "fam"], ["Verhuis (fam. Kerstproef)", "Kerstproef"],
  ["Tent dhr. Tent", "dhr Tent"], ["Kraam mevr. Kraam", "mevr Kraam"], ["Kerkstraat 12 - fam. Kerstproef - 0470 12 34 56", "Kerstproef 0470 12 34 56"],
  ["FEEST PJERTEST JANTESTENS", "PJERTEST JANTESTENS"], ["TESTPERSOON TENT", "TESTPERSOON TENT"], ["DOOP DAĞTEST YILTESTMAZ", "DAĞTEST YILTESTMAZ"], ["VERHUIS FAM. KERSTPROEF", "KERSTPROEF"],
  ["KRAAM TESTPERSOON", "TESTPERSOON"], ["PARKEERVERBOD DHR. TENT", "TENT"], ["Feest van Pjertest", "Pjertest"], ["Tent voor feest Pjertest", "Pjertest"],
  ["Feest 50 jaar Pjertest en Marietest", "Pjertest Marietest 50"], ["Kraam Pjertest Kerstproef", "Pjertest Kerstproef"], ["Feest Pjertest van der Zaal", "Pjertest Zaal"], ["Verhuis van der Steiger", "Steiger"],
  ["Doop Dağtest", "Dağtest"], ["Verhuislift voor Bourla", "Bourla"], ["Info: pjertest.kerstproef@voorbeeld.test", "pjertest kerstproef voorbeeld test"], ["Kraam bij Mas", "Mas"],
  ["Feest bij MAS", "MAS"], ["Feest voor Lillo", "Lillo"], ["Tent Kraam Bar", "Tent Kraam Bar"], ["Feest van der Tent", "Tent"], ["Feest Kerstproef", "Kerstproef"], ["Pjertest", "Pjertest"],
  ["Feest Doğtest", "Doğtest"], ["Feest Łuktest", "Łuktest"], ["Feest Søtest", "Søtest"], ["Feest Ayştest", "Ayştest"], ["Feest Muñtest", "Muñtest"],
  ["Verhuis Kerkstraat 12 Perron", "Perron 12"], ["Verhuis Kerkstraat 12, Perron", "Perron"], ["Verhuis Kerkstraat 12 bus 3 Kinders", "Kinders 12 3"],
  ["Verhuis Kerkstraat 12 - Steiger", "Steiger"], ["VERHUIS KERKSTRAAT 12 PERRON", "PERRON"], ["Verhuis - contactpersoon: Steiger, tel 0470 12 34 56", "Steiger 0470"],
  ["Verhuis, aanvrager: Kinders", "Kinders"], ["Container. Bewoner: Park", "Park"], ["Verhuis (klant: Perron)", "Perron"], ["Verhuis: Perron", "Perron"],
  ["Verhuis - Perron", "Perron"], ["Verhuis (Perron)", "Perron"], ["Verhuis. Perron", "Perron"], ["Verhuis: Gras", "Gras"], ["Verhuis - Loper", "Loper"],
  ["Container: Haven", "Haven"], ["Verhuis: Loods", "Loods"], ["Verhuis: Wandelaar", "Wandelaar"], ["Verhuis: Brederode", "Brederode"], ["Verhuis - Stuivenberg", "Stuivenberg"],
  ["Verhuis: Zandvliet", "Zandvliet"], ["Container - Lillo", "Lillo"], ["VERHUIS PARK", "PARK"], ["VERHUIS - PERRON", "PERRON"], ["Verhuis, PERRON", "PERRON"],
  ...["+32 (0)470 12 34 56", "+32(0)470123456", "0032 (0)470 12 34 56", "+32 (0)3 123 45 67", "(0470) 12 34 56", "0470 – 12 34 56", "0470 — 12 34 56", "0470_12_34_56",
    "0470,12,34,56", "tel 0470123456", "gsm: 0470 12 34 56", "0470 12 34 56"].map((tel) => [`Markt: Meir, ${tel}`, tel]),
];
// Een tekst is te lezen als een rij hele straatnamen uit de straatas en districten (zie tests/grondregel-privacyfilter.test.mjs).
const DISTRICT = new Set(["antwerpen", "berchem", "berendrecht zandvliet lillo", "borgerhout", "deurne", "ekeren", "hoboken", "merksem", "wilrijk"]);
function alleenPlekken(uit) {
  const w = sleutel(uit).split(" ").filter(Boolean);
  const kan = new Array(w.length + 1).fill(false);
  kan[0] = true;
  for (let i = 0; i < w.length; i += 1) if (kan[i]) for (let n = 1; n <= 8 && i + n <= w.length; n += 1) { const k = w.slice(i, i + n).join(" "); if (STRAATAS.has(k) || DISTRICT.has(k)) kan[i + n] = true; }
  return kan[w.length];
}

test("de invoer van de nakijkrondes e2969b3 en 801ed9f: er blijft alleen een hele straatnaam uit de straatas of een district over, geen naam, geen cijfer", () => {
  for (const [t, naam] of RONDES) {
    for (const o of [{}, { isStraat }, { straten: ["Kerkstraat"] }]) {
      for (const uit of uitvoer(t, o)) {
        const tekst = uit.replace(/^Inname: /, "");
        assert.ok(alleenPlekken(tekst), `${JSON.stringify(t)} gaf ${JSON.stringify(uit)}`);
        assert.doesNotMatch(tekst, /[\p{N}@]/u, `${JSON.stringify(t)} gaf ${JSON.stringify(uit)}`);
        // De naam blijft alleen als hij zelf een hele straatnaam of een district is ("Meir", "Lillo" in de straatas).
        for (const w of woorden(naam).filter((x) => !STRAATAS.has(x) && !DISTRICT.has(x))) assert.ok(!woorden(tekst).includes(w), `${JSON.stringify(t)} gaf ${JSON.stringify(uit)}: "${w}"`);
      }
    }
  }
  // Wat blijft, is de straat (of het district), niets anders: geen label, geen trefwoord.
  assert.equal(KU.veiligeTekst("Kerkstraat 12 - fam. Kerstproef - 0470 12 34 56", { straten: ["Kerkstraat"] }), "Kerkstraat");
  assert.equal(PN.plaatsnaamVan("Kerkstraat (bij Pjertest)", { isStraat: (n) => n === "Kerkstraat" }), "Kerkstraat");
  assert.equal(KU.veiligeTekst("Verhuis Kerkstraat 12 Perron", { isStraat }), "Kerkstraat");
  for (const t of ["Feest bij fam. Dam", "Verhuis (fam. Kerstproef)", "PARCOURS CRITERIUM", "NADARS", "Kerstmarkt", "Verhuis: Perron", "Fase 2 Opbouw", "PARCOURS VOLWASSENEN + JEUGD"]) {
    assert.equal(KU.veiligeTekst(t), "", t);
  }
  assert.equal(KU.veiligeTekst("Feest in Hoboken"), "Hoboken");
  // De vaste soort van A-Sign blijft vooraan staan; een andere soort wordt "Inname".
  assert.equal(KU.veiligeOmschrijving("Verkeersvrije Zone: Event verkeersvrij Kerkstraat", { isStraat }), "Verkeersvrije Zone: Kerkstraat");
  assert.equal(KU.veiligeOmschrijving("Parkeerverbod in Straat: parkeerverbod"), "");
  assert.equal(KU.veiligeOmschrijving("Testpersoon Tent: parkeerverbod Kerkstraat", { isStraat }), "Inname: Kerkstraat");
});

test("e2969b3: in de browser blijft de doop van een schip een doop van een schip, ook met een bewaarde uitleg", () => {
  const rij = { reference: "ET2099000777", dossierType: "ETL", phase: "Evenement", innameType: "Inname", description: "Doopfeest MTS Testboot", streets: [{ name: "Proefkaai" }], start: "2099-03-01", end: "2099-03-03" };
  assert.equal(KU.evenementFeiten([rij]).soort, "Doop van een schip");
  // Zonder uitleg, met de omschrijvingen zoals ze op de tak stonden ([]) en zoals een nieuwe filtering ze bewaart.
  for (const uitleg of [null, ...[[], ["Inname: Doopfeest"]].map((beschrijvingen) => ({ evenementen: { ET2099000777: { beschrijvingen, straten: ["Proefkaai"], soort: "Doop van een schip" } } }))]) {
    const kaart = PC.evenementEntry([rij], { vandaag: "2099-02-20", uitleg });
    assert.match(kaart.title, /doop van een schip/, JSON.stringify(uitleg));
    assert.doesNotMatch(kaart.title, /studentendoop/);
  }
  // Een echte studentendoop blijft een studentendoop.
  const doop = { ...rij, reference: "ET2099000778", description: "Doop studenten Testkring" };
  assert.match(PC.evenementEntry([doop], { vandaag: "2099-02-20", uitleg: { evenementen: { ET2099000778: { beschrijvingen: ["Inname: Doop studenten"] } } } }).title, /studentendoop/);
});

test("e2969b3: de bewaarde omschrijvingen in kaart-uitleg.json zijn al door de filter van nu gegaan", () => {
  const uitleg = lees("site/sources/kaart-uitleg.json");
  let n = 0;
  for (const [id, e] of Object.entries(uitleg.evenementen || {})) {
    for (const b of e.beschrijvingen || []) {
      n += 1;
      assert.equal(KU.veiligeOmschrijving(b, { straten: e.straten || [], isStraat }), b, `${id}: ${JSON.stringify(b)}`);
    }
  }
  assert.ok(n > 0, "er zijn omschrijvingen");
});

// ======== Nakijkronde van head 801ed9f: de scheepsdoop stond op de plekpagina in de bundel van de studentenactiviteiten ========

test("801ed9f: de doop van een schip staat bij de losse kaartjes, niet in de bundel van de studentenactiviteiten", () => {
  const rij = { id: "proef-801", kind: "iod", reference: "ET2099000779", dossierType: "ETL", phase: "Evenement", innameType: "Inname", description: "Doopfeest MTS Testboot",
    streets: [{ name: "Proefkaai" }], start: "2099-11-19", end: "2099-11-21" };
  // De identiteit zoals de herkenner ze automatisch schrijft (evenement-identiteit-auto.json), verzonnen voor dit dossier.
  const identiteit = PC.identiteitSamen({ dossiers: {} }, { dossiers: { ET2099000779: {
    zekerheid: "waarschijnlijk", naam: "", soort: "de doop van een schip", organisator: "", reden: "Het dossier spreekt van de doop van een schip, buiten de doopperiode van de studenten.",
    dagen: ["2099-11-20", "2099-11-21"], plek: "op de Proefkaai", soortZeker: false, geenEvenement: false, grond: "de omschrijving in het dossier", methode: "regels",
  } } });
  for (const id of [identiteit, null]) {
    const kaartjes = PC.publicSpaceEntries([rij], { vandaag: "2099-10-17", identiteit: id, wijkVan: () => "" });
    assert.equal(kaartjes.length, 1);
    assert.match(kaartjes[0].title, /doop van een schip/, String(Boolean(id)));
    const { losse, bundels } = PC.bundelLijst(kaartjes, { vandaag: "2099-10-17" });
    assert.deepEqual(losse.map((e) => e.title), [kaartjes[0].title], String(Boolean(id)));
    assert.equal(bundels.filter((b) => b.bundel?.soort === "studenten").length, 0, String(Boolean(id)));
  }
  // Een echte studentendoop blijft een vermoedelijke studentenactiviteit in de bundel van die dag.
  const doop = { ...rij, id: "proef-802", reference: "ET2099000780", description: "Doop studenten Testkring" };
  const kaartjes = PC.publicSpaceEntries([doop], { vandaag: "2099-10-17", wijkVan: () => "" });
  assert.equal(PC.bundelSoort(kaartjes[0], { vandaag: "2099-10-17" }), "studenten", kaartjes[0].title);
});
