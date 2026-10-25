// Een echte straat met een bestaand huisnummer in een toets, een diff of een commitboodschap (lib/echte-adressen.mjs,
// scripts/adressen-in-commits.mjs). De repo is publiek: hier alleen verzonnen straten (Proefstraat, Proeflaan), die
// de toets zelf als "echt" meegeeft. Nakijkronde 18 oktober 2026: een herstelcommit noemde twee echte straten met hun
// bestaande huisnummers tussen haakjes, los van de straatnaam, naast de verzonnen reden "verhuis"; de scan per
// huisnummerStukken zag dat niet.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as echte from "../lib/echte-adressen.mjs";
import { adressenInCommits, echteAdresStukken, geldigeUitzonderingen, laadDataPaden, laadStraatnamen, metUitzonderingen, straatnamenUit } from "../lib/echte-adressen.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const NAMEN = straatnamenUit(["Proefstraat", "Proeflaan", "Sint-Proefplein"]);

test("een echte straat met een bestaand huisnummer, ook los van de straat in dezelfde zin", () => {
  const gevonden = [
    "Proefstraat 3-5 2000 Antwerpen",
    'Adres: "Proefstraat 3-5 2000 Antwerpen", Reden: "Verhuis"',
    "Sint-Proefplein (12)",
    "de Proeflaan, huisnummers 12 en 14",
    // De vorm uit de commitboodschap: de nummers tussen haakjes, na beide straten.
    'zetten de Proefstraat en de Proeflaan met een bestaand huisnummer (3-5, 7-9) naast de verzonnen reden "verhuis".',
    "huisnummer 12 van de Proefstraat, naast een verhuis",
    "de Proefstraat met nummers 3 tot 7",
    "de Proefstraat, huisnummer (12)",
    "de Proefstraat en de Proeflaan (12-14)",
  ];
  for (const tekst of gevonden) assert.ok(echteAdresStukken(tekst, NAMEN).length > 0, tekst);

  const niet = [
    "Proefstraat 999-999 2000 Antwerpen",
    'de Proefstraat en de Proeflaan krijgen "999-999" (999)',
    'Nu "999-999", zoals A-Sign één nummer schrijft.',
    // Geen echte straat in de zin.
    "De plek-e2e kiest een echte straat uit de data en gaf die de nummers 12-14 en 10-12 tot 40-42.",
    "Xstraat 12 en Ylaan (3-5)",
    // Een jaartal, een aantal, een datum en een andere zin zijn geen huisnummer van die straat.
    "de Proefstraat (2026)",
    "de Proefstraat (9 kranen)",
    "de Proefstraat, besluit van 18-10-2026",
    "langs de Proefstraat. Een ander geval: huisnummer (12)",
    // Een los getal tussen haakjes zonder "huisnummer" ervoor is een aantal; "(10m)" is een maat.
    "de Proefstraat, de Proeflaan en de andere straten van de werf (14)",
    "2000, ANTWERPEN, PROEFSTRAAT: Aanleg van nutsleidingen voor gas (10m)",
    "Antwerpen - Proefstraat - 20990001 - Koppelput (1217 - 1218)",
  ];
  for (const tekst of niet) assert.deepEqual(echteAdresStukken(tekst, NAMEN), [], tekst);
});

// Nakijkronde van 18 oktober 2026: de woordsplitsing telde een apostrof aan het begin of het einde mee, zodat een echte
// straat tussen enkele aanhalingstekens ("'Xstraat 3'", "‘Xstraat 3’") geen straat meer was, in de toets "een echte
// straatnaam krijgt alleen huisnummer 999" en in de commitscan. Een apostrof in een naam ("D'Herbouvillekaai") blijft.
test("tussen enkele aanhalingstekens of backticks: de apostrof aan de rand hoort niet bij de straat", () => {
  const namen = straatnamenUit(["Proefstraat", "D'Proefkaai", "Maria Proef - Proeflaan"]);
  const gevonden = [
    "'Proefstraat 3-5'",
    "‘Proefstraat 3’",
    "’Proefstraat 3-5‘",
    "`Proefstraat 3-5`",
    "const PROEF = 'Proefstraat 3';",
    "assert.equal(x, 'Proefstraat 3-5 2000 Antwerpen');",
    "const lijst = ['Proefstraat 12', 'Proefstraat 14'];",
    "`${x} en Proefstraat 7`",
    "de ‘Proefstraat’ met huisnummer (12-14)",
    "'de Proefstraat, huisnummers 12 en 14'",
    // Een naam met een apostrof erin blijft heel, ook tussen aanhalingstekens.
    "D'Proefkaai 12",
    "'D'Proefkaai 12'",
    "‘D’Proefkaai 12’",
    "Maria Proef - Proeflaan 4",
    "'Maria Proef - Proeflaan 4'",
  ];
  for (const tekst of gevonden) assert.ok(echteAdresStukken(tekst, namen).length > 0, tekst);
  const niet = [
    "'Proefstraat 999'",
    "‘Proefstraat 999-999’",
    "`Proefstraat 999A`",
    "'D'Proefkaai 999'",
    // Zonder de D' is het een andere (hier geen) straat.
    "'Proefkaai 12'",
    "'Proeflaan 4'",
  ];
  for (const tekst of niet) assert.deepEqual(echteAdresStukken(tekst, namen), [], tekst);
});

// Nakijkronde van 18 oktober 2026 (na de vaagheidsronde): de vormen die A-Sign en GIPOD zelf schrijven, met iets tussen de
// straat en het nummer, vond de scan niet: de hoek vóór het nummer ("hoek-64", op de site "hoek–64"), de postcode tussen
// haakjes ("(2000) 12-14") en de homoniemtoevoeging van de straatas ("PROEFSTRAAT_AN 12", site/witte-lijst.js). Dezelfde
// scan draait in de toets "een echte straatnaam krijgt alleen huisnummer 999", in de fixturecontrole van
// tests/e2e/plek.e2e.mjs en in de CI-stap: een fixture in zo'n vorm kwam door alle drie.
test("de vormen van A-Sign en GIPOD: de hoek, de postcode tussen haakjes of de homoniemtoevoeging vóór het nummer", () => {
  const gevonden = [
    'Adres: "Proefstraat hoek-64 2060 Antwerpen"',
    '"Proefstraat hoek–64, 2060 Antwerpen"',
    "Proefstraat HOEK - 64",
    "de Proefstraat hoek 64",
    'Adres: "Proefstraat (2000) 12-14 2000 Antwerpen"',
    "Proeflaan (2610) 34-hoek 2610 Antwerpen",
    "Proeflaan (2610) hoek-64 2610 Antwerpen",
    'GIPOD(1, "2018 ANTWERPEN, PROEFSTRAAT_AN 12")',
    'Adres: "Proefstraat_AN 12-14 2018 Antwerpen"',
    "Nieuwe aansluiting Proefstraat_AN 12",
    "Proefstraat_EK (2180) hoek-7 2180 Antwerpen",
    "'Sint-Proefplein_AN 3'",
    // Die vonden we al.
    "Adres: 'Proefstraat 34-hoek 2060 Antwerpen'",
    "'Proefstraat 12-14'",
  ];
  for (const tekst of gevonden) assert.equal(echteAdresStukken(tekst, NAMEN).length, 1, tekst);
  const niet = [
    'Adres: "Proefstraat hoek-999 2060 Antwerpen"',
    '"Proefstraat hoek–999, 2060 Antwerpen"',
    "Proefstraat hoek–hoek 2060 Antwerpen",
    'Adres: "Proefstraat (2000) 999-999 2000 Antwerpen"',
    "Proefstraat (2000) Onbekend-Onbekend 2000 Antwerpen",
    'GIPOD(1, "2018 ANTWERPEN, PROEFSTRAAT_AN 999")',
    "Proefstraat_AN, 2018 Antwerpen",
    "Proefstraat_AN 2018 Antwerpen",
    "Proefstraat_EK (2180) hoek-999 2180 Antwerpen",
    "op de hoek van de Proefstraat en de Proeflaan",
    "de Proefstraat (2026)",
  ];
  for (const tekst of niet) assert.deepEqual(echteAdresStukken(tekst, NAMEN), [], tekst);
});

// Nakijkronde van 18 oktober 2026: een datum direct na een straat telde als huisnummer ("Xstraat | 5 jan", "Xstraat, 18
// okt"). docs/VRAGEN_AAN_DE_STAD.md (scripts/vragen-aan-de-stad.mjs, niet met de hand) heeft zo'n tabel, en staat niet in
// de padlijst van de databaan: een code-PR die het opnieuw maakte, werd rood op de job check, zonder uitweg. Een straat
// met een nummer na " | ", " - " of ": " blijft wel een adres (GIPOD schrijft "Xstraat - 135 - werken aan ...").
test("een datum of een uur na een straat is geen huisnummer, ook niet na | of : of een komma", () => {
  const niet = [
    "Proefstraat | 5 jan",
    "Proefstraat, 18 okt",
    "Proefstraat: 5 jan",
    "| Proefstraat | 14–29 okt |",
    "Proefstraat — 5 januari 2027",
    "Proefstraat, 3 aug – 18 dec 2026",
    "Proefstraat 12 sept.",
    "Proefstraat, 5 mei.",
    "| ET2099000001 | 9 | Proefstraat, Proeflaan | 19–23 okt | doel |",
    "| GW2099-000001 | Proeflaan | 30 sep – 13 nov | naam, doel |",
    "Proefstraat 18-10-2026",
    "Proefstraat 18/10/2026",
    "Proefstraat 18.10.2026",
    "Proefstraat 7:00-19:00",
    "Proefstraat, 7 uur",
  ];
  for (const tekst of niet) assert.deepEqual(echteAdresStukken(tekst, NAMEN), [], tekst);
  const gevonden = [
    "Proefstraat | 12 |",
    "Antwerpen - Proefstraat - 135 - werken aan de riolering",
    "Proefstraat: 12",
    "Proefstraat, 18",
    "Proefstraat 12 en 14 op 5 jan",
    "Proefstraat 12, 18 okt",
    "Proefstraat 12-14, van 3 tot 5 jan",
  ];
  for (const tekst of gevonden) assert.equal(echteAdresStukken(tekst, NAMEN).length, 1, tekst);
});

// Nakijkronde van 18 oktober 2026 (na de eindboom): een huisnummer dat zelf tussen aanhalingstekens staat, of een straat
// en een nummer als twee losse strings of argumenten, zag de scan niet. Zo schrijft een gewone fixture het wel.
test("een huisnummer tussen aanhalingstekens, of de straat en het nummer als losse strings of argumenten", () => {
  const gevonden = [
    "Proefstraat '12'",
    'Proefstraat "12"',
    "Proefstraat ‘12’",
    "Proefstraat “12-14”",
    "Proefstraat, '12-14'",
    'Proefstraat: "12"',
    "{ straat: 'Proefstraat', huisnummer: '12' }",
    '{ straat: "Proefstraat", nr: "12" }',
    "adres: 'Proefstraat', nummer: '12'",
    '{"straat":"Proefstraat","huisnummer":"12"}',
    '["Proefstraat", "12-14"]',
    "['Proeflaan', '12']",
    "[`Sint-Proefplein`, `3`]",
    'adres("Proefstraat", 12)',
    "adres('Proefstraat', '12b')",
    "de Proefstraat, huisnummer '12'",
    'de Proefstraat met huisnummer "12"',
    "de Proefstraat met huisnummers ‘12’ en ‘14’",
    "de Proefstraat met huisnummers '999' en '14'",
  ];
  for (const tekst of gevonden) assert.ok(echteAdresStukken(tekst, NAMEN).length > 0, tekst);
  const niet = [
    "Proefstraat '999'",
    '["Proefstraat", "999-999"]',
    "{ straat: 'Proefstraat', huisnummer: '999' }",
    'adres("Proefstraat", 999)',
    "de Proefstraat met huisnummers ‘999’ en ‘999A’",
    // De rij van site/geo/straten.json: het getal na de straat is een postcode.
    '["237789", "Proefstraat", "2000", ["ANT14"]]',
    // Een datum, een uur of een jaartal na de straat als losse string.
    '["Proefstraat", "18 okt"]',
    '["Proefstraat", "7:00-19:00"]',
    "adres('Proefstraat', 2026)",
    // Een telling na een functie van de straat, en de straat als sleutel met een getal (bekende grens: een telling).
    'assert.equal(telling("Proefstraat"), 3)',
    '{ "Proefstraat": 12 }',
    // Rijen van toetsen op main (nakijkronde: valse treffers): een datum met het jaar vooraan, een telling of een maat
    // zonder aanhalingstekens die niet het laatste argument is, een kommagetal.
    '["foor-1", "Najaarsfoor Sint-Proefplein", "2026-11-21", "2026-12-13", "Sint-Proefplein, 2060 Antwerpen"]',
    '["Proeflaan","2026-10-09","11:30","16:30"]',
    'market("Proefstraat","2026-10-11",{inDistrict:false})',
    '["Proefstraat", "2026-10-09T08:00"]',
    '[["Proefstraat", 2, "removed"], ["Proeflaan", 1, "changed"]]',
    '["Proefstraat", 25.01, 4.41477, 51.21816]',
    '["Proefstraat", "25.01"]',
    // Geen echte straat, of een andere zin (zonder veldnaam).
    '["Xstraat", "12-14"]',
    "langs de Proefstraat; nr 12 is de volgende vraag",
  ];
  for (const tekst of niet) assert.deepEqual(echteAdresStukken(tekst, NAMEN), [], tekst);
});

// Nakijkronde van 18 oktober 2026 (na de eindboom): een straat en een huisnummer in losse velden, met de veldnamen die de
// repo zelf gebruikt (de geocoder: Thoroughfarename/Housenumber, lib/geocode.mjs; CRAB: STRAATNM/HUISNR met de
// homoniemtoevoeging, lib/kaart-uitleg-refresh.mjs; een parkeerverbod als { straat, huisnummer, reden }), kwam door de
// scan, de 999-toets en de CI-stap. Binnen één regel en binnen één object over meer regels (echteAdresRegels).
test("straat en huisnummer in losse velden, op één regel of in één object over meer regels", () => {
  assert.equal(typeof echte.echteAdresRegels, "function", "lib/echte-adressen.mjs: echteAdresRegels");
  const gevonden = [
    '{ Thoroughfarename: "Proefstraat", Housenumber: "12" }',
    '{ "Thoroughfarename": "Proefstraat", "Housenumber": "12", "Zipcode": "2000" }',
    '{ STRAATNM: "PROEFSTRAAT_AN", HUISNR: "14" }',
    "{ STRAATNM: 'Proefstraat_AN', HUISNR: 14 }",
    '{ STRAATNM: "PROEFSTRAAT", HUISNR_AN: "14" }',
    '{ straat: "Proefstraat", huisnummer: "16", reden: "Verhuis" }',
    "{ straat: 'Proeflaan', nummer: '12-14' }",
    "{ straatnaam: 'Sint-Proefplein', house_number: '3' }",
    "?straat=Proefstraat&huisnummer=12",
  ];
  for (const tekst of gevonden) assert.ok(echteAdresStukken(tekst, NAMEN).length > 0, tekst);
  const niet = [
    '{ Thoroughfarename: "Proefstraat", Housenumber: null }',
    '{ Thoroughfarename: "Proefstraat", Housenumber: "999" }',
    '{ STRAATNM: "PROEFSTRAAT_AN", HUISNR: "999" }',
    '{ Thoroughfarename: "Xstraat", Housenumber: "12" }',
    '{ Dossiernummer: "12", straat: "Proefstraat" }',
    // Twee opdrachten op één regel: de puntkomma sluit de zin (bekende grens, lib/echte-adressen.mjs).
    "const straat = 'Proefstraat'; const nr = '12';",
  ];
  for (const tekst of niet) assert.deepEqual(echteAdresStukken(tekst, NAMEN), [], tekst);

  // Over meer regels: de regel met het nummer telt, als de straat in hetzelfde object staat.
  const fixture = [
    "const geocode = {",
    '  "Thoroughfarename": "Proefstraat",',
    '  "Housenumber": "12",',
    "};",
    "const crab = {",
    "  STRAATNM: 'PROEFSTRAAT_AN',",
    "  // een opmerking",
    "  HUISNR: '14',",
    "};",
    "const verbod = {",
    "  huisnummer: \"16\",",
    "  straat: \"Proeflaan\",",
    "  reden: \"Verhuis\",",
    "};",
    "- straat: Sint-Proefplein",
    "  nr: 3",
  ].join("\n");
  assert.deepEqual(echte.echteAdresRegels(fixture, NAMEN), [{ regel: 3, aantal: 1 }, { regel: 8, aantal: 1 }, { regel: 11, aantal: 1 }, { regel: 16, aantal: 1 }]);
  // Een regel met een adres telt zoals echteAdresStukken het ziet, met het aantal stukken.
  assert.deepEqual(echte.echteAdresRegels("x\nProefstraat 12 en Proeflaan '14'\ny", NAMEN), [{ regel: 2, aantal: 2 }]);
  const anders = [
    // Een ander object, een lege regel ertussen, 999, of geen nummerveld.
    ["[", '  { straat: "Proefstraat" },', '  { huisnummer: "12" },', "]"],
    ['{ "straat": "Proefstraat",', '  "huisnummer": "999",', '  "postcode": "2000" }'],
    ["{", '  "adres": { "straat": "Proefstraat" },', "}", "{", '  "huisnummer": "12"', "}"],
    ["de Proefstraat", "", "nr: 12"],
    ["{", '  straat: "Proefstraat",', "  aantal: 12,", "  dagen: '12-14',", "}"],
    ["{", '  "Thoroughfarename": "Proefstraat",', '  "Housenumber": null,', "}"],
    // Geen veldregel: een commentaar of een zin met "nummer:" na een regel met een straat.
    ['{ straat: "Proefstraat",', '  // de reeks na het nummer: "12-14", "12 tem 14"', "}"],
    ["Langs de Proefstraat:", "het nummer: 12"],
    // De straat in de naam van een veld, niet in de waarde.
    ["{", "  Proefstraat: true,", "  nr: 12,", "}"],
  ];
  for (const regels of anders) assert.deepEqual(echte.echteAdresRegels(regels.join("\n"), NAMEN), [], regels.join(" / "));
});

// Een eigen, lege git-repo in een nieuwe tijdelijke map, los van elke instelling van de machine.
function proefRepo(t) {
  const map = fs.mkdtempSync(path.join(os.tmpdir(), "adressen-in-commits-"));
  t.after(() => fs.rmSync(map, { recursive: true, force: true }));
  const env = {
    ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Proef", GIT_AUTHOR_EMAIL: "proef@example.invalid", GIT_COMMITTER_NAME: "Proef", GIT_COMMITTER_EMAIL: "proef@example.invalid",
    GIT_AUTHOR_DATE: "2099-03-10T04:00:00Z", GIT_COMMITTER_DATE: "2099-03-10T04:00:00Z",
  };
  const git = (...args) => execFileSync("git", args, { cwd: map, env, encoding: "utf8" }).trim();
  git("init", "-q");
  const schrijf = (relatief, inhoud) => {
    fs.mkdirSync(path.dirname(path.join(map, relatief)), { recursive: true });
    fs.writeFileSync(path.join(map, relatief), inhoud);
  };
  const commit = (boodschap) => {
    git("add", "--all");
    git("commit", "-q", "--no-verify", "--no-gpg-sign", "-m", boodschap);
    return git("rev-parse", "HEAD");
  };
  return { map, git, schrijf, commit };
}

test("commits: een echt adres in de diff of in de boodschap, met plaats en aantal maar zonder de waarde", (t) => {
  const { map, git, schrijf, commit } = proefRepo(t);
  schrijf("README.md", "begin\n");
  const basis = commit("Begin");
  schrijf("tests/a.test.mjs", 'const x = 1;\nconst verbod = { Adres: "Proefstraat 3-5 2000 Antwerpen", Reden: "Verhuis" };\n');
  const metAdres = commit("Toets voor een parkeerverbod");
  schrijf("tests/a.test.mjs", 'const x = 1;\nconst verbod = { Adres: "Proefstraat 999-999 2000 Antwerpen", Reden: "Verhuis" };\n');
  // Afgebroken zoals een commitboodschap: de tweede straat en de nummers staan op de volgende regel.
  const herstel = commit('Herstel: de toets zette de Proefstraat en de\nProeflaan met een bestaand huisnummer (3-5, 7-9) naast "verhuis".\n\nNu 999-999.');

  const { commits, bevindingen } = adressenInCommits({ basis, tot: herstel, cwd: map, namen: NAMEN });
  assert.equal(commits, 2);
  assert.deepEqual(bevindingen, [
    { commit: metAdres.slice(0, 8), sha: metAdres, waar: "tests/a.test.mjs", regels: [2], aantal: 1 },
    { commit: herstel.slice(0, 8), sha: herstel, waar: "boodschap", aantal: 1 },
  ]);
  assert.doesNotMatch(JSON.stringify(bevindingen), /3-5|7-9|Proefstraat|Proeflaan/);

  // Het herstel zonder rebase, amend of force: één nieuwe commit met de eindboom bovenop de basis. Dezelfde inhoud,
  // een fast-forward van de basis, en geen echt adres meer in de geschiedenis.
  const schoon = git("commit-tree", `${herstel}^{tree}`, "-p", basis, "-m", "Toets voor een parkeerverbod, met een verzonnen adres");
  assert.equal(git("diff", "--stat", herstel, schoon), "");
  assert.equal(spawnSync("git", ["merge-base", "--is-ancestor", basis, schoon], { cwd: map }).status, 0);
  assert.deepEqual(adressenInCommits({ basis, tot: schoon, cwd: map, namen: NAMEN }).bevindingen, []);

  // Het script: exitcode 1 met de plaatsen, 0 na het herstel; nooit de waarde.
  const straten = path.join(map, "straten.json");
  fs.writeFileSync(straten, JSON.stringify({ streets: [["1", "Proefstraat", "2000"], ["2", "Proeflaan", "2000"]] }));
  const script = path.join(repoRoot, "scripts", "adressen-in-commits.mjs");
  const vuil = spawnSync(process.execPath, [script, "--basis", basis, "--tot", herstel, "--straten", straten], { cwd: map, encoding: "utf8" });
  assert.equal(vuil.status, 1, vuil.stderr);
  assert.match(vuil.stdout, new RegExp(`${metAdres.slice(0, 8)} tests/a\\.test\\.mjs:2: 1×`));
  assert.match(vuil.stdout, new RegExp(`${herstel.slice(0, 8)} commitboodschap: 1×`));
  assert.doesNotMatch(vuil.stdout + vuil.stderr, /3-5|7-9|Proefstraat|Proeflaan/);
  const goed = spawnSync(process.execPath, [script, "--basis", basis, "--tot", schoon, "--straten", straten], { cwd: map, encoding: "utf8" });
  assert.equal(goed.status, 0, goed.stdout + goed.stderr);
  assert.match(goed.stdout, /1 commit\(s\) .* 0 plaats\(en\)/);
});

test("commits: ook tussen enkele aanhalingstekens, in de diff en in de boodschap", (t) => {
  const { map, schrijf, commit } = proefRepo(t);
  schrijf("README.md", "begin\n");
  const basis = commit("Begin");
  schrijf("tests/b.test.mjs", "const PROEF = 'Proefstraat 3';\nconst LIJST = [`Proeflaan 7-9`, ‘Proefstraat 5’];\n");
  const vuil = commit("Toets met ‘Proefstraat 3-5’ en 'Proeflaan 7'");
  const { bevindingen } = adressenInCommits({ basis, tot: vuil, cwd: map, namen: NAMEN });
  assert.deepEqual(bevindingen.map((b) => [b.waar, b.regels || null, b.aantal]), [["boodschap", null, 2], ["tests/b.test.mjs", [1, 2], 3]]);
});

// De proef van de nakijkronde: een toets en een JSON-fixture met een straat en een nummer in losse velden of tussen
// aanhalingstekens, één regel of een object over meer regels. Het script houdt de PR tegen, met de plaatsen.
test("commits: losse velden en een nummer tussen aanhalingstekens, ook in een object over meer regels", (t) => {
  const { map, schrijf, commit } = proefRepo(t);
  schrijf("README.md", "begin\n");
  const basis = commit("Begin");
  schrijf("tests/probe.test.mjs", [
    'const a = { Thoroughfarename: "Proefstraat", Housenumber: "12" };',
    'const b = { STRAATNM: "PROEFSTRAAT_AN", HUISNR: "14" };',
    'const c = { straat: "Proeflaan", huisnummer: "16", reden: "Verhuis" };',
    'const d = ["Proefstraat", "12-14"];',
    "const e = 1;",
    "",
  ].join("\n"));
  schrijf("tests/fixtures/probe.json", JSON.stringify({ geocode: { Thoroughfarename: "Proefstraat", Housenumber: "12", Zipcode: "2000" } }, null, 2) + "\n");
  const vuil = commit("Proef met losse velden");
  const { bevindingen } = adressenInCommits({ basis, tot: vuil, cwd: map, namen: NAMEN });
  assert.deepEqual(bevindingen.map((b) => [b.waar, b.regels, b.aantal]), [["tests/fixtures/probe.json", [4], 1], ["tests/probe.test.mjs", [1, 2, 3, 4], 4]]);
  assert.deepEqual(echte.adressenAanDeKop({ basis, tot: vuil, cwd: map, namen: NAMEN }).bevindingen.map((b) => [b.waar, b.regels]), [["tests/fixtures/probe.json", [4]], ["tests/probe.test.mjs", [1, 2, 3, 4]]]);

  const straten = path.join(map, "straten.json");
  fs.writeFileSync(straten, JSON.stringify({ streets: [["1", "Proefstraat", "2000"], ["2", "Proeflaan", "2000"]] }));
  const r = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "adressen-in-commits.mjs"), "--basis", basis, "--tot", vuil, "--straten", straten, "--zonder-data"], { cwd: map, encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "" } });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /tests\/probe\.test\.mjs:1,2,3,4: 4× echte straat/);
  assert.match(r.stdout, /tests\/fixtures\/probe\.json:4: 1× echte straat/);
  assert.doesNotMatch(r.stdout + r.stderr, /Proefstraat|Proeflaan|PROEFSTRAAT|12-14|"1[246]"/);
});

// Een code-PR die een gegenereerd document met een tabel van straten en data opnieuw maakt (zoals
// docs/VRAGEN_AAN_DE_STAD.md): geen bevinding. Een adres in de vorm van A-Sign of GIPOD in een toets wel.
test("commits: een tabel met een datum na de straat houdt de PR niet tegen, een adres van A-Sign in een toets wel", (t) => {
  const { map, schrijf, commit } = proefRepo(t);
  schrijf("README.md", "begin\n");
  const basis = commit("Begin");
  schrijf("docs/VRAGEN.md", [
    "| Dossier | Straten | Wanneer | Wat ontbreekt |",
    "| --- | --- | --- | --- |",
    "| ET2099000001 | Proefstraat | 25 okt | naam, doel |",
    "| GW2099-000001 | Proefstraat, Proeflaan | 19–23 okt | doel |",
    "| GW2099-000002 | Sint-Proefplein | 3 aug – 18 dec | doel |",
    "| GW2099-000003 | Proeflaan | 14 sep 2026 – 3 jan 2027 | doel |",
    "",
  ].join("\n"));
  const doc = commit("Vragen aan de stad opnieuw gemaakt");
  assert.deepEqual(adressenInCommits({ basis, tot: doc, cwd: map, namen: NAMEN }).bevindingen, []);
  schrijf("tests/c.test.mjs", 'const a = "Proefstraat hoek-64 2060 Antwerpen";\nconst b = "2018 ANTWERPEN, PROEFSTRAAT_AN 12";\nconst c = "Proeflaan (2610) 12-14 2610 Antwerpen";\n');
  const toets = commit("Toets met de vormen van A-Sign");
  assert.deepEqual(adressenInCommits({ basis: doc, tot: toets, cwd: map, namen: NAMEN }).bevindingen.map((b) => [b.waar, b.regels, b.aantal]), [["tests/c.test.mjs", [1, 2, 3], 3]]);
});

// De CI-stap (ci.yml, job check): bij elke PR alle commits van de PR, zonder de gegenereerde data uit publieke bronnen
// (de padlijst van de databaan) en met de uitzonderingen voor wat al gepusht is (lib/adressen-uitzonderingen.json).
test("CI: een al gepushte commit op precies zijn plaats uitgezonderd, de gegenereerde data telt niet, een nieuw adres houdt de PR tegen", (t) => {
  const { map, schrijf, commit } = proefRepo(t);
  schrijf("README.md", "begin\n");
  const basis = commit("Begin");
  schrijf("tests/a.test.mjs", "const x = 1;\nconst verbod = { Adres: 'Proefstraat 3-5 2000 Antwerpen' };\n");
  const gepusht = commit("Toets voor een parkeerverbod");
  // De verversing schrijft een publieke zaal met haar adres in de uitleg en de feed: dat is data, geen toets.
  schrijf("site/sources/kaart-uitleg.json", '{"zaal": "Proeflaan 12 2000 Antwerpen"}\n');
  schrijf("site/agenda-feed.js", 'window.X = ["Proeflaan 12"];\n');
  const data = commit("Dataverversing");
  schrijf("tests/b.test.mjs", "const nieuw = 'Proeflaan 7';\n");
  const nieuw = commit("Nog een toets");

  const overslaan = laadDataPaden(path.join(repoRoot, "lib", "data-lane-paths.json"));
  assert.ok(overslaan.some((re) => re.test("site/sources/kaart-uitleg.json")) && !overslaan.some((re) => re.test("tests/a.test.mjs")));
  const metData = adressenInCommits({ basis, tot: nieuw, cwd: map, namen: NAMEN });
  assert.deepEqual(metData.bevindingen.map((b) => `${b.sha === data ? "data" : b.sha === nieuw ? "nieuw" : "gepusht"}:${b.waar}`),
    ["gepusht:tests/a.test.mjs", "data:site/agenda-feed.js", "data:site/sources/kaart-uitleg.json", "nieuw:tests/b.test.mjs"]);
  const { bevindingen } = adressenInCommits({ basis, tot: nieuw, cwd: map, namen: NAMEN, overslaan });
  assert.deepEqual(bevindingen.map((b) => b.waar), ["tests/a.test.mjs", "tests/b.test.mjs"]);

  const reden = "Al gepusht in een PR, vóór de scan bestond; wegnemen kan alleen met force, en dat mag niet.";
  const uitzondering = { commit: gepusht, waar: "tests/a.test.mjs", regels: [2], aantal: 1, reden };
  assert.deepEqual(geldigeUitzonderingen({ schemaVersion: 1, uitzonderingen: [uitzondering] }).fouten, []);
  const { over, uitgezonderd } = metUitzonderingen(bevindingen, [uitzondering]);
  assert.deepEqual([over.map((b) => b.sha), uitgezonderd.map((b) => b.sha)], [[nieuw], [gepusht]]);
  // Precies die plaats: een andere commit, een andere regel, een ander bestand of meer dan het aantal telt gewoon.
  for (const anders of [{ commit: nieuw }, { regels: [1] }, { waar: "tests/b.test.mjs" }, { aantal: 0 }]) {
    assert.equal(metUitzonderingen(bevindingen, [{ ...uitzondering, ...anders }]).over.length, 2, JSON.stringify(anders));
  }
  // Een uitzondering zonder volledige commit, regels of reden is ongeldig.
  for (const fout of [{ commit: gepusht.slice(0, 8) }, { regels: [] }, { reden: "al gepusht" }, { aantal: 0 }]) {
    assert.ok(geldigeUitzonderingen({ schemaVersion: 1, uitzonderingen: [{ ...uitzondering, ...fout }] }).fouten.length, JSON.stringify(fout));
  }

  // Het script zoals de CI-stap het draait.
  const straten = path.join(map, "straten.json");
  fs.writeFileSync(straten, JSON.stringify({ streets: [["1", "Proefstraat", "2000"], ["2", "Proeflaan", "2000"]] }));
  const uitz = path.join(map, "uitzonderingen.json");
  fs.writeFileSync(uitz, JSON.stringify({ schemaVersion: 1, uitzonderingen: [uitzondering] }));
  const script = path.join(repoRoot, "scripts", "adressen-in-commits.mjs");
  const draai = (tot, extra = []) => spawnSync(process.execPath, [script, "--basis", basis, "--tot", tot, "--straten", straten, "--zonder-data", ...extra], { cwd: map, encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "" } });
  const tegen = draai(nieuw, ["--uitzonderingen", uitz]);
  assert.equal(tegen.status, 1, tegen.stdout + tegen.stderr);
  assert.match(tegen.stdout, new RegExp(`${nieuw.slice(0, 8)} tests/b\\.test\\.mjs:1: 1× echte straat`));
  assert.match(tegen.stdout, new RegExp(`${gepusht.slice(0, 8)} tests/a\\.test\\.mjs:2: 1× uitgezonderd`));
  assert.match(tegen.stdout, /3 commit\(s\) .*zonder de gegenereerde data.*1 plaats\(en\) met een echt adres, 1 uitgezonderd\./);
  assert.doesNotMatch(tegen.stdout + tegen.stderr, /3-5|Proeflaan 7|Proefstraat|Proeflaan|kaart-uitleg|agenda-feed/);
  // De gepushte commit is uitgezonderd, maar het adres staat er aan de kop nog: de netto diff houdt de PR dan tegen,
  // zonder uitzondering (de toets hierna; groen pas als een nieuwe commit het adres wegneemt).
  const totData = draai(data, ["--uitzonderingen", uitz]);
  assert.equal(totData.status, 1, totData.stdout + totData.stderr);
  assert.match(totData.stdout, /2 commit\(s\) .*0 plaats\(en\) met een echt adres, 1 uitgezonderd\./);
  assert.match(totData.stdout, /^aan de kop tests\/a\.test\.mjs:2: 1× echte straat/m);
  assert.equal(draai(data).status, 1, "zonder uitzonderingen telt de gepushte commit");
  // Een reden met een echt adres, of een kapot bestand: een fout (exitcode 2), nooit stil groen.
  fs.writeFileSync(uitz, JSON.stringify({ schemaVersion: 1, uitzonderingen: [{ ...uitzondering, reden: `${reden} Zie Proefstraat 3-5.` }] }));
  const metAdres = draai(data, ["--uitzonderingen", uitz]);
  assert.equal(metAdres.status, 2, metAdres.stdout + metAdres.stderr);
  assert.match(metAdres.stderr, /de reden noemt een echt adres/);
  fs.writeFileSync(uitz, "{");
  assert.equal(draai(data, ["--uitzonderingen", uitz]).status, 2);
});

// Nakijkronde van 18 oktober 2026: een uitzondering gold per commit en per regel, maar niets keek of het adres er aan de
// kop van de PR nog stond. Een latere commit die de regel alleen verschuift (geen "+"-regel meer) liet de PR groen landen
// met een echte straat en een bestaand huisnummer in de eindboom. Nu kijkt de scan ook naar de netto diff basis...kop,
// zonder uitzonderingen: wat de PR aan het eind toevoegt, telt altijd. Een regel die al op de basis stond, telt daar niet.
test("CI: een uitzondering geldt per commit, niet aan de kop; een adres dat er aan het eind nog staat, houdt de PR tegen", (t) => {
  const { map, schrijf, commit } = proefRepo(t);
  // Op de basis staat al een regel met een adres (zoals op main): die is niet van deze PR en telt aan de kop niet.
  schrijf("site/x.js", "// Zoals de beheerder schrijft: 'Proeflaan 12-14'.\nconst a = 1;\n");
  const basis = commit("Begin");
  schrijf("tests/c.test.mjs", "const x = 1;\nconst werk = { Adres: 'Proefstraat 3-5 2000 Antwerpen' };\n");
  const gepusht = commit("Toets voor een werk");
  // De volgende commit verschuift de regel alleen: geen "+"-regel met het adres, dus de scan per commit ziet niets.
  schrijf("tests/c.test.mjs", "// Kop.\nconst y = 2;\nconst z = 3;\nconst x = 1;\nconst werk = { Adres: 'Proefstraat 3-5 2000 Antwerpen' };\n");
  schrijf("site/x.js", "// Kop.\n// Zoals de beheerder schrijft: 'Proeflaan 12-14'.\nconst a = 1;\n");
  // De verversing schrijft een publieke zaal met haar adres: dat is data, ook aan de kop.
  schrijf("site/sources/kaart-uitleg.json", '{"zaal": "Proeflaan 12 2000 Antwerpen"}\n');
  const verschoven = commit("Toets opgeschoven, data ververst");

  const reden = "Al gepusht in een PR, vóór de scan bestond; wegnemen kan alleen met force, en dat mag niet.";
  const uitzondering = { commit: gepusht, waar: "tests/c.test.mjs", regels: [2], aantal: 1, reden };
  const straten = path.join(map, "straten.json");
  fs.writeFileSync(straten, JSON.stringify({ streets: [["1", "Proefstraat", "2000"], ["2", "Proeflaan", "2000"]] }));
  const uitz = path.join(map, "uitzonderingen.json");
  fs.writeFileSync(uitz, JSON.stringify({ schemaVersion: 1, uitzonderingen: [uitzondering] }));
  const script = path.join(repoRoot, "scripts", "adressen-in-commits.mjs");
  const draai = (tot) => spawnSync(process.execPath, [script, "--basis", basis, "--tot", tot, "--straten", straten, "--zonder-data", "--uitzonderingen", uitz], { cwd: map, encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "" } });

  // Per commit: alleen de gepushte commit, uitgezonderd. Aan de kop staat het adres er nog, op regel 5.
  const overslaan = laadDataPaden(path.join(repoRoot, "lib", "data-lane-paths.json"));
  assert.deepEqual(metUitzonderingen(adressenInCommits({ basis, tot: verschoven, cwd: map, namen: NAMEN, overslaan }).bevindingen, [uitzondering]).over, []);
  assert.equal(typeof echte.adressenAanDeKop, "function", "lib/echte-adressen.mjs: adressenAanDeKop");
  assert.deepEqual(echte.adressenAanDeKop({ basis, tot: verschoven, cwd: map, namen: NAMEN, overslaan }).bevindingen, [{ waar: "tests/c.test.mjs", regels: [5], aantal: 1 }]);
  // Zonder overslaan telt ook de data aan de kop; de regel die al op de basis stond nooit.
  assert.deepEqual(echte.adressenAanDeKop({ basis, tot: verschoven, cwd: map, namen: NAMEN }).bevindingen.map((b) => b.waar), ["site/sources/kaart-uitleg.json", "tests/c.test.mjs"]);

  const vuil = draai(verschoven);
  assert.equal(vuil.status, 1, vuil.stdout + vuil.stderr);
  assert.match(vuil.stdout, new RegExp(`${gepusht.slice(0, 8)} tests/c\\.test\\.mjs:2: 1× uitgezonderd`));
  assert.match(vuil.stdout, /^aan de kop tests\/c\.test\.mjs:5: 1× echte straat met een bestaand huisnummer/m);
  assert.match(vuil.stdout, /2 commit\(s\) .*0 plaats\(en\) met een echt adres, 1 uitgezonderd\./);
  assert.match(vuil.stdout, /Aan de kop \(netto diff [0-9a-f]+\.\.\.[0-9a-f]+, zonder de gegenereerde data\): 1 plaats\(en\) met een echt adres; een uitzondering geldt hier niet\./);
  assert.doesNotMatch(vuil.stdout + vuil.stderr, /3-5|12-14|Proefstraat|Proeflaan|site\/x\.js|kaart-uitleg/);

  // Het herstel: een nieuwe commit geeft de straat huisnummer 999. De gepushte commit blijft uitgezonderd, de kop is schoon.
  schrijf("tests/c.test.mjs", "// Kop.\nconst y = 2;\nconst z = 3;\nconst x = 1;\nconst werk = { Adres: 'Proefstraat 999 2000 Antwerpen' };\n");
  const herstel = commit("Toets: huisnummer 999");
  const goed = draai(herstel);
  assert.equal(goed.status, 0, goed.stdout + goed.stderr);
  assert.match(goed.stdout, /3 commit\(s\) .*0 plaats\(en\) met een echt adres, 1 uitgezonderd\./);
  assert.match(goed.stdout, /Aan de kop .*: 0 plaats\(en\) met een echt adres/);
});

// Nakijkronde van 18 oktober 2026: commits van andere open PR's die al gepusht (dus publiek) waren en waarin de scan iets
// vindt. Zodra deze PR gemerged is, leest CI de uitzonderingen alleen uit de basiscommit: zonder een uitzondering hier werd
// de job check van die PR's rood, en een PR kan zichzelf niet vrijmaken. Elke plaats staat er, met de volledige commit.
const AL_GEPUSHT_IN_ANDERE_PRS = [
  { pr: 203, commit: "697e0ec40d840ba56d956c5ae2d1fdefd06dc2c6", waar: "site/kaart-uitleg.js" },
  { pr: 203, commit: "697e0ec40d840ba56d956c5ae2d1fdefd06dc2c6", waar: "tests/werken-nakijk2.test.mjs" },
  { pr: 192, commit: "42ef9f097f6477e9212480660cfb1990b9bb4653", waar: "audit/STRAAT_BRONNEN_QA_20261015.md" },
];
const commitHier = (sha) => spawnSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: repoRoot }).status === 0 && spawnSync("git", ["cat-file", "-e", `${sha}^^{commit}`], { cwd: repoRoot }).status === 0;

// De uitzonderingen in de repo: geldig, alleen commits die al gepusht zijn (de reden zegt het), en de stap in ci.yml.
test("lib/adressen-uitzonderingen.json en de stap in ci.yml", () => {
  const doc = JSON.parse(fs.readFileSync(path.join(repoRoot, "lib", "adressen-uitzonderingen.json"), "utf8"));
  assert.deepEqual(geldigeUitzonderingen(doc).fouten, []);
  for (const u of doc.uitzonderingen) assert.match(u.reden, /\bgepusht\b/, u.commit);
  for (const g of AL_GEPUSHT_IN_ANDERE_PRS) {
    const u = doc.uitzonderingen.find((x) => x.commit === g.commit && x.waar === g.waar);
    assert.ok(u, `#${g.pr} ${g.commit.slice(0, 8)} ${g.waar}: geen uitzondering`);
    assert.match(u.reden, new RegExp(`#${g.pr}\\b`), "de reden noemt de PR");
  }
  const ci = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");
  const job = ci.slice(ci.indexOf("\n  check:"), ci.indexOf("\n  data-only:"));
  const stap = job.slice(job.indexOf("- name: Geen echt adres in de commits"));
  assert.ok(job.includes("- name: Geen echt adres in de commits"), "de stap staat in de job check (die de Gateway eist)");
  assert.match(stap, /if: github\.event_name == 'pull_request'/);
  assert.match(stap, /node scripts\/adressen-in-commits\.mjs --basis "\$BASE_SHA" --tot "\$HEAD_SHA" --zonder-data --uitzonderingen "\$uitz"/);
  assert.match(stap, /git show "\$\{BASE_SHA\}:lib\/adressen-uitzonderingen\.json"/, "de uitzonderingen uit de basiscommit, als die ze al heeft");
  assert.doesNotMatch(stap.split("\n      - ")[0], /continue-on-error/);
});

// Elke uitzondering past precies op wat de scan (met de echte stratenlijst en zonder de gegenereerde data, zoals de
// CI-stap) in die commit vindt: niets in die commit blijft over, en geen uitzondering is ruimer dan nodig. Alleen als de
// commit hier lokaal staat (een ondiepe checkout in CI heeft ze niet).
test("lib/adressen-uitzonderingen.json: elke uitzondering past precies op wat de scan in die commit vindt", (t) => {
  const doc = JSON.parse(fs.readFileSync(path.join(repoRoot, "lib", "adressen-uitzonderingen.json"), "utf8"));
  const commits = [...new Set(doc.uitzonderingen.map((u) => u.commit))].filter(commitHier);
  if (!commits.length) return t.skip("geen van de uitgezonderde commits staat lokaal");
  const namen = laadStraatnamen(path.join(repoRoot, "site", "geo", "straten.json"));
  const overslaan = laadDataPaden(path.join(repoRoot, "lib", "data-lane-paths.json"));
  for (const sha of commits) {
    const { bevindingen } = adressenInCommits({ basis: `${sha}^`, tot: sha, cwd: repoRoot, namen, overslaan });
    const eigen = doc.uitzonderingen.filter((u) => u.commit === sha);
    assert.deepEqual(metUitzonderingen(bevindingen, eigen).over.map((b) => b.waar), [], `${sha.slice(0, 8)}: een plaats zonder uitzondering`);
    for (const u of eigen) {
      const b = bevindingen.find((x) => x.waar === u.waar);
      assert.ok(b, `${sha.slice(0, 8)} ${u.waar}: de scan vindt daar niets (meer)`);
      assert.deepEqual([b.aantal, b.waar === "boodschap" ? null : b.regels], [u.aantal, u.waar === "boodschap" ? null : u.regels], `${sha.slice(0, 8)} ${u.waar}`);
    }
  }
});
