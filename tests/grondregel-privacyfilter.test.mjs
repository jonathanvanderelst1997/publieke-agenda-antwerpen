// GRONDREGEL van de privacyfilter (site/witte-lijst.js, ook lib/plaatsnaam.mjs en de omschrijvingen van site/kaart-uitleg.js):
// uit vrije tekst (innameBeschrijving en gelijkaardige velden) blijft ALLEEN
//   (a) een VOLLEDIGE officiële straatnaam uit de straatas, exact op de genormaliseerde vorm (de hele naam, nooit een stuk,
//       nooit één los woord van een straatnaam), of
//   (b) een naam uit de vaste lijst van de 9 districten van Antwerpen.
// Niets anders: geen woordenlijst (kerk, school, markt ...), geen hoofdletterwoord, geen cijfer of huisnummer, geen telefoon-,
// mail- of rekeningvorm. Deze toetsen kijken na dat de uitvoer woord voor woord alleen uit zulke plekken bestaat. Ze falen op
// head 3334360 (de witte lijst met trefwoorden, vaste plekken en naamsloten) en slagen nu. Alleen verzonnen straten en
// namen; geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";

import * as W from "../site/witte-lijst.js";
import * as KU from "../site/kaart-uitleg.js";
import * as PN from "../lib/plaatsnaam.mjs";

// Een verzonnen straatas: straatnamen van één tot vijf woorden, met De/Van, koppeltekens en accenten.
const STRATEN = ["Proefstraat", "Lange Proefstraat", "Van Testlei", "De Proefplein", "Testplaats", "Sint-Proefplein", "Onze-Lieve-Testvrouwstraat",
  "Jan Van Testmansstraat", "Testdries", "Proefoever", "Burgemeester Jan Van Testerenstraat", "Testkaai", "Proefdok", "Testrui", "Proefmarkt", "Testvest", "Prôefsingel"];
const STRAATAS = new Set(STRATEN.map(W.sleutel));
const isStraat = (n) => STRAATAS.has(W.sleutel(n));
// De vaste lijst van de 9 districten (GRONDREGEL (b)).
const NEGEN = ["Antwerpen", "Berchem", "Berendrecht-Zandvliet-Lillo", "Borgerhout", "Deurne", "Ekeren", "Hoboken", "Merksem", "Wilrijk"];
const DISTRICTEN = new Set(NEGEN.map(W.sleutel));
const TOEGESTAAN = new Set([...STRAATAS, ...DISTRICTEN]);

// De woorden van een tekst zoals de straatas ze vergelijkt.
const woorden = (t) => W.sleutel(t).split(" ").filter(Boolean);
// Alle uitvoeren van de filter voor één tekst, met de straatas op elke manier waarop de code ze meegeeft.
function uitvoeren(t) {
  const lijst = [
    W.witteLijst(t, { isStraat }), W.witteLijst(t, { straten: STRATEN }), W.witteLijst(t, { rond: () => STRATEN }), W.witteLijst(t, {}),
  ];
  const teksten = [
    KU.bruikbareBeschrijving(t, { isStraat }), KU.veiligeOmschrijving(`Inname: ${t}`, { isStraat }).replace(/^Inname: /, ""),
    PN.plaatsnaamVan(t, { isStraat }), PN.plaatsnaamVan(t, { rond: STRATEN }), KU.bruikbareBeschrijving(t, { straten: STRATEN.map((name) => ({ name })) }),
  ];
  return { lijst, teksten };
}
// Wat er overblijft, is woord voor woord een rij volledige straatnamen en districten; geen cijfer, geen @.
function alleenPlekken(t) {
  const { lijst, teksten } = uitvoeren(t);
  for (const r of lijst) {
    for (const p of r.plekken) assert.ok(TOEGESTAAN.has(W.sleutel(p)), `${JSON.stringify(t)} → plek ${JSON.stringify(p)} is geen volledige straatnaam of district`);
    assert.deepEqual(woorden(r.tekst), r.plekken.flatMap(woorden), `${JSON.stringify(t)} → ${JSON.stringify(r.tekst)}: er blijft iets anders over dan ${JSON.stringify(r.plekken)}`);
    assert.doesNotMatch(r.tekst, /[\p{N}@＠]/u, `${JSON.stringify(t)} → ${JSON.stringify(r.tekst)}`);
  }
  for (const uit of teksten) {
    assert.doesNotMatch(uit, /[\p{N}@＠]/u, `${JSON.stringify(t)} → ${JSON.stringify(uit)}`);
    // Elke uitvoer is te lezen als een rij hele plekken: de woorden vallen in stukken die elk een volledige straatnaam of district zijn.
    const w = woorden(uit);
    const kan = new Array(w.length + 1).fill(false);
    kan[0] = true;
    for (let i = 0; i < w.length; i += 1) if (kan[i]) for (let n = 1; n <= 8 && i + n <= w.length; n += 1) if (TOEGESTAAN.has(w.slice(i, i + n).join(" "))) kan[i + n] = true;
    assert.ok(kan[w.length], `${JSON.stringify(t)} → ${JSON.stringify(uit)}: niet alleen volledige straatnamen en districten`);
  }
  return lijst[0];
}

test("grondregel: de vaste lijst telt precies de 9 districten van Antwerpen", () => {
  assert.deepEqual([...(NEGEN || [])], NEGEN);
  for (const d of NEGEN) assert.equal(W.witteTekst(`Feest in ${d}`), d);
  assert.equal(W.witteTekst("berendrecht zandvliet lillo"), "berendrecht zandvliet lillo");
  // Een stuk van een district of een wijk is geen district.
  for (const t of ["Zandvliet", "Lillo", "Berendrecht", "Zurenborg", "Kiel", "Linkeroever", "Borsbeek", "Groot-Berchem"]) assert.equal(W.witteTekst(t), "", t);
});

test("grondregel: geen woordenlijst meer: kerk, school, markt, feest, stoet, vaste plekken en hoofdletterwoorden vallen allemaal weg", () => {
  for (const t of ["kerk", "school", "markt", "Markt", "MARKT", "plein", "park", "station", "Metrostation", "feest", "Stoet", "NADARS", "Doopfeest", "Startlocatie doop",
    "Parkeerverbod", "Verkeersvrije zone", "Opbouw podium", "Kraampjes", "Meir", "Dam", "MAS", "Kathedraal", "Park Spoor Noord", "Stadspark", "Groenplaats", "Eilandje",
    "Wandeling naar de kaai", "Reuzenrad op het plein", "Tweede halte", "Sint-Andrieskerk", "Testpersoon", "TESTPERSOON", "Van Testpersoon", "fam. Proefmans"]) {
    for (const uit of [...uitvoeren(t).teksten, ...uitvoeren(t).lijst.map((r) => r.tekst)]) assert.equal(uit, "", `${t} → ${uit}`);
  }
  // Wat blijft, is alleen de straat of het district.
  assert.equal(KU.bruikbareBeschrijving("Stoet van de Proefmarkt naar de Lange Proefstraat (tent nr. 12)", { isStraat }), "Proefmarkt … Lange Proefstraat");
  assert.equal(KU.bruikbareBeschrijving("Markt in Berchem", { isStraat }), "Berchem");
  assert.equal(KU.veiligeOmschrijving("Parkeerverbod in Straat: parkeerverbod Proefstraat 12-14", { isStraat }), "Parkeerverbod in Straat: Proefstraat");
  assert.equal(KU.veiligeOmschrijving("Testpersoon Voorbeeld: Proefstraat", { isStraat }), "Inname: Proefstraat");
});

test("grondregel: alleen de hele straatnaam, exact op de genormaliseerde vorm; nooit een stuk of één los woord", () => {
  for (const t of ["LANGE PROEFSTRAAT", "lange-proefstraat", "Lânge  Proefstraat", "Onze Lieve Testvrouwstraat", "onze-lieve-testvrouwstraat", "Prøefsingel".replace("ø", "ô"), "Sint Proefplein"]) {
    assert.notEqual(W.witteTekst(t, { isStraat }), "", t);
    alleenPlekken(t);
  }
  // Een stuk van een straatnaam, of één woord ervan, is geen straat.
  for (const t of ["Lange", "Testmans", "Jan Van", "Jan Van Testmans", "Van Testmansstraat", "Testerenstraat", "Burgemeester Jan", "Testvrouwstraat", "Onze-Lieve", "Proef",
    "Proefplein", "Testlei", "Sint", "Testmansstraat", "Burgemeester Van Testerenstraat", "Proefstraten", "Proefstraatje", "Testdriesen"]) {
    assert.equal(W.witteTekst(t, { isStraat }), "", t);
    assert.equal(PN.plaatsnaamVan(t, { rond: STRATEN }), "", t);
  }
  // Een straatnaam met een cijfer of uit een ander schrift telt nooit.
  assert.equal(W.witteTekst("Proefplein 2099", { isStraat: (n) => W.sleutel(n) === "proefplein 2099" }), "");
  assert.equal(W.witteTekst("Прoefstraat", { isStraat }), "");
  // Een naam vast aan een straat is één woord, en dat is geen straat.
  for (const t of ["ProefstraatTestpersoon", "TestpersoonProefstraat", "Proefstraat12", "Proefstraat_Testpersoon"]) assert.equal(W.witteTekst(t, { isStraat }), "", t);
});

test("grondregel: van een mail- of webadres blijft niets, ook niet een straatnaam erin", () => {
  for (const t of ["proefstraat@voorbeeld.test", "info.lange.proefstraat@voorbeeld.test", "Testpersoon (proefstraat＠voorbeeld.test)", "www.proefstraat.test", "https://voorbeeld.test/Proefstraat", "proefstraat.be"]) {
    assert.equal(W.witteTekst(t, { isStraat }), "", t);
  }
});

// ======== eigenschap: duizenden verzonnen naam-, nummer-, telefoon- en mailvormen, naast en binnen straatnamen ========

// Een vaste toevalsgenerator (mulberry32), zodat elke run dezelfde vormen nakijkt.
const toeval = (zaad) => () => { zaad |= 0; zaad = (zaad + 0x6D2B79F5) | 0; let t = Math.imul(zaad ^ (zaad >>> 15), 1 | zaad); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const LETTERGREPEN = ["zor", "vex", "quil", "xan", "dux", "kyl", "wix", "fax", "jor", "nix", "plo", "gav", "yur", "tev", "hox", "mur", "zil", "vor", "qua", "bix", "ryx", "sym"];
// Woorden die een aanvrager typt en die vroeger op de lijst stonden: ze mogen nooit blijven.
const LIJSTWOORDEN = ["feest", "Feest", "stoet", "STOET", "kraam", "parkeerverbod", "Doopfeest", "tent", "NADARS", "podium", "markt", "Startlocatie", "kerk", "school",
  "Meir", "Zurenborg", "Park Spoor Noord", "Kathedraal", "plein", "Metrostation", "Bar", "Zaal", "Kerk", "Dam", "Kiel"];
const KLEIN = ["aan", "op", "de", "het", "naar", "bij", "van", "langs", "en", "in", "Van", "De", "tot"];

function naamVorm(r) {
  const kies = (lijst) => lijst[Math.floor(r() * lijst.length)];
  const deel = () => { let w = ""; for (let i = 0, n = 2 + Math.floor(r() * 2); i < n; i += 1) w += kies(LETTERGREPEN); return w; };
  const groot = (w) => w[0].toUpperCase() + w.slice(1);
  const voor = deel(), achter = deel();
  // Een woord uit een straatnaam als naam ("Testmans", "Jan", "Lange"), of een hele straatnaam van één woord met een voornaam.
  const straatWoord = () => kies(STRATEN.flatMap((s) => s.split(/[\s-]+/)).filter((w) => !STRAATAS.has(W.sleutel(w))));
  return kies([
    () => `${groot(voor)} ${groot(achter)}`, () => groot(achter), () => achter, () => achter.toUpperCase(), () => `${voor.toUpperCase()} ${achter.toUpperCase()}`,
    () => `Van ${groot(achter)}`, () => `van ${achter}`, () => `De ${achter}`, () => `Van den ${groot(achter)}`, () => `${groot(voor)} Van der ${groot(achter)}`,
    () => `D'${groot(achter)}`, () => `D´${achter}`, () => `O'${groot(achter)}`, () => `Mc${groot(achter)}`, () => `${voor[0].toUpperCase()}. ${groot(achter)}`,
    () => `${groot(voor)}-${groot(achter)}`, () => `${groot(achter)}_${groot(voor)}`, () => `familie ${groot(achter)}`, () => `fam. ${achter}`, () => `dhr. ${groot(achter)}`,
    () => `${groot(achter).slice(0, 1)}​${achter.slice(1)}`, () => `${groot(achter).slice(0, 1)}­${achter.slice(1)}`, () => `${groot(achter)}`.normalize("NFD"),
    () => `${groot(achter)}̈`, () => `“${groot(achter)}”`, () => `#${groot(achter)}`, () => `${groot(achter)}2099`, () => `ᴛᴇsᴛ${achter}`, () => `${groot(voor)} Тест`,
    () => straatWoord(), () => `${straatWoord()} ${groot(achter)}`, () => `${groot(voor)} ${straatWoord()}`, () => kies(LIJSTWOORDEN), () => `${kies(LIJSTWOORDEN)} ${groot(achter)}`,
  ])();
}
function nummerVorm(r) {
  const n = () => 1 + Math.floor(r() * 150);
  const kies = (lijst) => lijst[Math.floor(r() * lijst.length)];
  return kies([
    () => `${n()}`, () => `${n()}-${n()}`, () => `${n()}/${n()}`, () => `${n()}a`, () => `nr ${n()}`, () => `nr. ${n()} bus ${n()}`, () => `${n()} tot ${n()}`, () => `${n()}e`,
    () => `03-${n()}-45-67`, () => `+32 471 ${n()} 34 56`, () => `0471/${n()}.34.56`, () => `(0470) ${n()} 34 56`, () => `0032 3 ${n()} 45 67`, () => `${n()}${n()}${n()}${n()}`,
    () => `٠٤٧٢ ${n()}`, () => `BE${n()} ${n()}${n()} ${n()}${n()} ${n()}`, () => `IBAN BE68 5390 0754 ${n()}`, () => `BIC GEBABEBB`, () => `${n()} km`, () => `${n()}u${n()}`,
  ])();
}
function mailVorm(r, naam) {
  const kies = (lijst) => lijst[Math.floor(r() * lijst.length)];
  const plat = W.sleutel(naam).replace(/ /g, ".") || "testpersoon";
  const straat = W.sleutel(kies(STRATEN)).replace(/ /g, "");
  return kies([
    () => `${plat}@voorbeeld.test`, () => `${straat}@voorbeeld.test`, () => `${plat}.${straat}@voorbeeld.test`, () => `${plat}(at)voorbeeld.test`, () => `${plat}＠voorbeeld.test`,
    () => `www.${straat}.test`, () => `https://voorbeeld.test/${straat}`, () => `${plat} at voorbeeld punt test`, () => `info@${straat}.be`,
  ])();
}
// Een straat of district met een naam ernaast of erin: tussen de woorden van een straatnaam, eraan vast, ervoor en erna.
function straatMetNaam(r, naam) {
  const kies = (lijst) => lijst[Math.floor(r() * lijst.length)];
  const s = kies([...STRATEN, ...NEGEN]);
  const delen = s.split(" ");
  const tussen = delen.length > 1 ? (() => { const i = 1 + Math.floor(r() * (delen.length - 1)); return [...delen.slice(0, i), naam, ...delen.slice(i)].join(" "); })() : `${naam} ${s}`;
  return kies([() => `${naam} ${s}`, () => `${s} ${naam}`, () => tussen, () => `${s}${naam.replace(/\s+/g, "")}`, () => `${naam.replace(/\s+/g, "")}${s}`, () => `${s}-${naam}`,
    () => `${s} ${nummerVorm(r)} ${naam}`, () => `${naam}, ${s} ${nummerVorm(r)}`, () => `${s.toUpperCase()} ${naam.toUpperCase()}`, () => `${s.toLowerCase()} ${naam}`])();
}
const SJABLONEN = [
  (x) => `${x.kw} ${x.naam}`, (x) => `${x.naam} ${x.kw}`, (x) => `${x.kw} bij ${x.naam} op de ${x.straat}`, (x) => `${x.kw} ${x.naam} ${x.nummer}`,
  (x) => `${x.straat} ${x.nummer} ${x.naam}`, (x) => `${x.kw} van ${x.naam} naar ${x.straat}`, (x) => `${x.kw}: ${x.naam} (${x.nummer})`, (x) => `${x.kw} ${x.mail}`,
  (x) => `${x.naam}, ${x.kw} aan het ${x.straat}`, (x) => `${x.kw} ${x.naam} en ${x.naam2}`, (x) => x.binnen, (x) => `${x.kw} ${x.binnen} ${x.nummer}`,
  (x) => `${x.naam} - ${x.nummer} - ${x.straat}`, (x) => `tel ${x.nummer}, ${x.naam}, ${x.mail}`, (x) => `${x.klein} ${x.naam} ${x.klein} ${x.straat} ${x.klein} ${x.naam2}`,
  (x) => `${x.straat} → ${x.binnen} / ${x.naam}`, (x) => `${x.kw.toUpperCase()} ${x.naam.toUpperCase()} ${x.nummer}`,
];

test("eigenschap: voor duizenden verzonnen naam-, nummer-, telefoon- en mailvormen, ook naast en binnen straatnamen, blijft alleen een volledige straatnaam of district over", () => {
  const r = toeval(20261017);
  const kies = (lijst) => lijst[Math.floor(r() * lijst.length)];
  let teksten = 0, metPlek = 0, metNaamNaastStraat = 0;
  for (let i = 0; i < 5000; i += 1) {
    const naam = naamVorm(r);
    const x = { kw: kies(LIJSTWOORDEN), naam, naam2: naamVorm(r), nummer: nummerVorm(r), straat: kies([...STRATEN, ...NEGEN]), mail: mailVorm(r, naam), klein: kies(KLEIN), binnen: straatMetNaam(r, naam) };
    const sjabloon = kies(SJABLONEN);
    const t = sjabloon(x);
    const r0 = alleenPlekken(t);
    teksten += 1;
    if (r0.plekken.length) metPlek += 1;
    if (String(sjabloon).includes("x.binnen")) metNaamNaastStraat += 1;
  }
  // Ook de vormen apart: een nummer, een telefoonnummer, een mailadres en een naam zonder straat laten niets over.
  for (let i = 0; i < 3000; i += 1) {
    const naam = naamVorm(r);
    for (const t of [nummerVorm(r), mailVorm(r, naam), `${naam} ${nummerVorm(r)}`, `${naam} ${mailVorm(r, naam)}`]) {
      const uit = alleenPlekken(t);
      teksten += 1;
      // Zonder straat of district in de tekst blijft er niets over (een lijstwoord of een stuk van een straat is geen straat).
      if (!STRATEN.some((s) => woorden(t).join(" ").includes(W.sleutel(s))) && !NEGEN.some((d) => woorden(t).join(" ").includes(W.sleutel(d)))) assert.equal(uit.tekst, "", `${JSON.stringify(t)} → ${JSON.stringify(uit.tekst)}`);
    }
  }
  assert.ok(teksten >= 17000, `${teksten} teksten`);
  // De toets zegt alleen iets als er ook plekken blijven: de straten en districten in de sjablonen.
  assert.ok(metPlek > 2000, `${metPlek} teksten met een plek`);
  assert.ok(metNaamNaastStraat > 800, `${metNaamNaastStraat} teksten met een naam naast of in een straatnaam`);
});
