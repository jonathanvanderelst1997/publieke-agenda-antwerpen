// Nakijkronde van head e2969b3 (17 oktober 2026): de witte lijst (site/witte-lijst.js) liet nog namen door die zelf op de
// lijst staan of die na een afkorting met een punt staan.
//   1. De naamsloten werkten niet na "fam.", "dhr.", "mevr." (de punt telde als grens) en niet in HOOFDLETTERS.
//   2. Gangbare namen stonden zelf op de lijst ("Pier", "Kersten" = kerst + en, "Dağ" = dag zonder breve) of kwamen door
//      na een voorzetsel ("voor Meir", "bij Mas") of na een woord in kleine letters ("Feest van Pier").
//   3. In de browser gaf evenementEntry met een bewaarde uitleg de doop van een schip als studentendoop: de soort kwam uit
//      de gefilterde tekst ("Doopfeest"), niet uit de kenmerken van de ruwe omschrijving.
// Elke toets hier faalt op e2969b3 en slaagt nu. Alleen verzonnen proefdata (Testboot, Proefkaai, dossiers 2099); de
// straatas is de publieke van de repo (site/geo). Geen netwerk.
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
  ...[].concat(lees("site/geo/straten-stad.json")).flatMap((s) => (Array.isArray(s) ? [s[0]] : Array.isArray(s?.streets) ? s.streets.map((x) => (Array.isArray(x) ? x[0] : x?.name)) : [])).map(sleutel),
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

test("e2969b3: na fam., dhr. en mevr. (met een punt) valt de naam weg, ook als hij op de lijst staat", () => {
  for (const [t, naam] of [
    ["Verhuis fam. Kersten", "Kersten"], ["Feest mevr. Bar", "Bar"], ["Verhuis Fam. Dağ", "Dağ"], ["Feest bij fam. Dam", "Dam"], ["Verhuis dhr. Meir", "Meir"],
    ["Verhuis fam. Kiel", "Kiel"], ["Verhuis (fam. Kersten)", "Kersten"], ["Tent dhr. Tent", "dhr"], ["Kraam mevr. Kraam", "mevr"],
  ]) geenNaam(t, naam);
  // Een straat met een familienaam wijst een gezin aan: de straat blijft, de naam en het telefoonnummer niet.
  geenNaam("Kerkstraat 12 - fam. Kersten - 0470 12 34 56", "Kersten 0470 12 34 56", { straten: ["Kerkstraat"] });
  assert.equal(KU.veiligeTekst("Kerkstraat 12 - fam. Kersten - 0470 12 34 56", { straten: ["Kerkstraat"] }), "Kerkstraat");
  // Wat geen naam is, blijft: het trefwoord voor de naam.
  assert.equal(KU.veiligeTekst("Feest bij fam. Dam"), "Feest");
  assert.equal(KU.veiligeTekst("Verhuis (fam. Kersten)"), "Verhuis");
});

test("e2969b3: in HOOFDLETTERS valt een woord van de lijst naast een naam die wegvalt ook weg", () => {
  for (const [t, naam] of [
    ["FEEST PIER JANSSENS", "PIER JANSSENS"], ["TESTPERSOON TENT", "TENT"], ["DOOP DAĞ YILMAZ", "DAĞ YILMAZ"], ["VERHUIS FAM. KERSTEN", "KERSTEN"],
    ["KRAAM TESTPERSOON", "KRAAM"], ["PARKEERVERBOD DHR. TENT", "TENT"],
  ]) geenNaam(t, naam);
  // Een tekst in hoofdletters zonder naam blijft.
  for (const t of ["PARCOURS CRITERIUM", "NADARS", "PARCOURS VOLWASSENEN + JEUGD", "PARKEERVERBOD"]) assert.equal(KU.veiligeTekst(t), t, t);
});

test("e2969b3: Pier, Kersten en Dağ staan niet meer op de lijst; een eigennaam na kleine letters of een voorzetsel valt weg", () => {
  for (const [t, naam] of [
    ["Feest van Pier", "Pier"], ["Tent voor feest Pier", "Pier"], ["Feest 50 jaar Pier en Marie", "Pier Marie"], ["Kraam Pier Kersten", "Pier Kersten"],
    ["Feest Pier van der Zaal", "Pier Zaal"], ["Verhuis van der Steiger", "Steiger"], ["Doop Dağ", "Dağ"], ["Tent voor Meir", "Meir"],
    ["Verhuislift voor Bourla", "Bourla"], ["Info: pier.kersten@voorbeeld.test", "pier kersten voorbeeld test"], ["Kraam bij Mas", "Mas"], ["Feest bij MAS", "MAS"],
    ["Feest voor Lillo", "Lillo"], ["Tent Kraam Bar", "Tent Kraam Bar"], ["Feest van der Tent", "Tent"], ["Feest Kersten", "Kersten"], ["Pier", "Pier"],
    ["Feest Doğan", "Doğan"], ["Feest Łukasz", "Łukasz"], ["Feest Søren", "Søren"], ["Feest Ayşe", "Ayşe"], ["Feest Muñoz", "Muñoz"],
  ]) geenNaam(t, naam);
  // In de stand "plaats" ook: de straat blijft, de naam niet.
  assert.equal(PN.plaatsnaamVan("Kerkstraat (bij Pier)", { isStraat: (n) => n === "Kerkstraat" }), "Kerkstraat");
  // "kerst" telt alleen in een samenstelling.
  for (const t of ["Kerstmarkt", "Kerstfeest", "kerstmarkt op de Groenplaats"]) assert.equal(KU.veiligeTekst(t, { isStraat }), t, t);
  assert.equal(KU.veiligeTekst("Kersten"), "");
});

test("e2969b3: een plek uit de vaste lijst blijft met een lidwoord, na 'in' of 'op', en met een plek of trefwoord ernaast", () => {
  for (const t of ["Markt op de Meir", "Feest aan de Dam", "Stoet naar het MAS", "Feest in Berchem", "Stoet van de Groenplaats naar de Meir", "Animatie op Meir", "voetpaden rond het MAS",
    "Tweede Stop, Falconplein", "Opbouw Standen", "Startlocatie Doop", "Verkeersvrije zone", "Kerstmarkt op de Meir"]) {
    assert.equal(KU.veiligeTekst(t, { isStraat }), t, t);
  }
  // De vaste soort van A-Sign blijft vooraan staan.
  assert.equal(KU.veiligeOmschrijving("Verkeersvrije Zone: Event verkeersvrij"), "Verkeersvrije Zone: Event verkeersvrij");
  assert.equal(KU.veiligeOmschrijving("Parkeerverbod in Straat: parkeerverbod"), "Parkeerverbod in Straat: parkeerverbod");
  assert.equal(KU.veiligeOmschrijving("Testpersoon Tent: parkeerverbod"), "Inname: parkeerverbod");
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
