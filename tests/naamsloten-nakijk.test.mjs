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

// ======== Nakijkronde van head 801ed9f ========
// 1. Een huisnummer tussen straat en naam schakelde de naamsloten uit ("Verhuis Kerkstraat 12 Perron").
// 2. Een naam op de lijst die alleen in zijn zinsdeel staat ("Verhuis: Perron", "Verhuis - Dam"), en telefoonnummers met
//    haakjes, een lang streepje, een liggend streepje, komma's of een label ("tel") na een komma.
// 3. In HOOFDLETTERS stond de paarregel uit ("VERHUIS PARK", "VERHUIS DAM").
// 4. De scheepsdoop stond op de plekpagina in de bundel van de studentenactiviteiten.
// Elke toets hieronder faalt op 801ed9f en slaagt nu. Alleen verzonnen adressen, namen en nummers.

test("801ed9f: na een huisnummer valt een naam van de lijst weg, de straat blijft", () => {
  const opties = { straten: ["Kerkstraat"] };
  for (const [t, naam] of [
    ["Verhuis Kerkstraat 12 Perron", "Perron"], ["Verhuis Kerkstraat 12, Perron", "Perron"], ["Verhuis Kerkstraat 12 bus 3 Kinders", "Kinders"],
    ["Verhuis Kerkstraat 12 - Steiger", "Steiger"], ["Verhuis Kerkstraat 12 Dam", "Dam"], ["Verhuis Kerkstraat 12 Meir", "Meir"],
    ["VERHUIS KERKSTRAAT 12 PERRON", "PERRON"],
  ]) {
    geenNaam(t, naam, opties);
    for (const o of [opties, { ...opties, isStraat }]) {
      assert.match(KU.veiligeTekst(t, o), /^Verhuis Kerkstraat$/i, t);
      assert.match(PN.plaatsnaamVan(t, { isStraat: o.isStraat || (() => false), rond: o.straten }), /^Kerkstraat$/i, t);
    }
  }
  // Een huisnummer na een plek blijft een huisnummer van die plek; "Fase 2 Opbouw" is geen naam.
  assert.equal(KU.veiligeTekst("Markt op de Meir 12"), "Markt op de Meir");
  assert.equal(KU.veiligeTekst("Fase 2 Opbouw"), "Fase … Opbouw");
});

test("801ed9f: een naam van de lijst alleen in zijn zinsdeel (na ':', ' - ', '(', ',' of '. ') valt weg", () => {
  for (const [t, naam] of [
    ["Verhuis - contactpersoon: Steiger, tel 0470 12 34 56", "Steiger"], ["Verhuis, aanvrager: Kinders", "Kinders"], ["Container. Bewoner: Park", "Park"],
    ["Verhuis (klant: Perron)", "Perron"], ["Verhuis: Perron", "Perron"], ["Verhuis - Perron", "Perron"], ["Verhuis (Perron)", "Perron"], ["Verhuis. Perron", "Perron"],
    ["Verhuis: Gras", "Gras"], ["Verhuis - Loper", "Loper"], ["Container: Haven", "Haven"], ["Verhuis: Loods", "Loods"], ["Verhuis: Wandelaar", "Wandelaar"],
    ["Verhuis: Dam", "Dam"], ["Verhuis - Kiel", "Kiel"], ["Verhuis (Meir)", "Meir"], ["Verhuis: Bourla", "Bourla"], ["Verhuis: Brederode", "Brederode"],
    ["Verhuis - Stuivenberg", "Stuivenberg"], ["Verhuis: Zandvliet", "Zandvliet"], ["Verhuis: Hoboken", "Hoboken"], ["Container - Lillo", "Lillo"],
  ]) geenNaam(t, naam);
  // Wat geen naam is, blijft: het label zelf, een soort plek of een vaste soort voor de plek, een plek na een zekere plek,
  // een bekende plaatsnaam, en "+" of "…" tussen twee stukken.
  assert.equal(KU.veiligeTekst("Verhuis: Perron"), "Verhuis");
  for (const t of ["Markt: Meir", "Parcours: Meir - Groenplaats", "Locatie: Kiel", "Kerkstraat, Meir", "Eerste Stop, Stadswaag", "PARCOURS VOLWASSENEN + JEUGD",
    "Parkeerverbod … bladslag", "Stoet: van de Groenplaats naar de Meir"]) assert.equal(KU.veiligeTekst(t, { isStraat }), t, t);
});

test("801ed9f: het vangnet van het telefoonnummer kent haakjes, streepjes, komma's en een label na een komma", () => {
  // "Markt: Meir" blijft zonder nummer; met een nummer erachter is "Meir" een naam.
  assert.equal(KU.veiligeTekst("Markt: Meir"), "Markt: Meir");
  for (const tel of ["+32 (0)470 12 34 56", "+32(0)470123456", "0032 (0)470 12 34 56", "+32 (0)3 123 45 67", "(0470) 12 34 56", "0470 – 12 34 56",
    "0470 — 12 34 56", "0470_12_34_56", "0470,12,34,56", "tel 0470123456", "gsm: 0470 12 34 56", "0470 12 34 56"]) {
    const t = `Markt: Meir, ${tel}`;
    geenNaam(t, `Meir ${tel}`);
    assert.equal(KU.veiligeTekst(t), "Markt", t);
  }
  // Huisnummers in een rij zijn geen telefoonnummer.
  assert.equal(KU.veiligeTekst("Markt op de Meir 10, 12, 14, 16, 18"), "Markt op de Meir");
});

test("801ed9f: in HOOFDLETTERS valt een paar van twee stammen weg, net als in gewone schrijfwijze", () => {
  for (const [t, naam] of [["VERHUIS PARK", "PARK"], ["VERHUIS DAM", "DAM"], ["VERHUIS - PERRON", "PERRON"], ["Verhuis, PERRON", "PERRON"], ["Verhuis Dam", "Dam"], ["Feest Kiel", "Kiel"]]) {
    geenNaam(t, naam);
  }
  // Een tekst in hoofdletters zonder naam blijft; een soort plek met een district ook.
  for (const t of ["PARCOURS CRITERIUM", "PARCOURS JEUGD", "HET STEEN", "PARCOURS VOLWASSENEN + JEUGD", "NADARS", "Bibliotheek Merksem", "Markt Meir"]) {
    assert.equal(KU.veiligeTekst(t, { isStraat }), t, t);
  }
});

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
