// gitleaks in meldstand (job gitleaks in ci.yml, scripts/gitleaks-meld.mjs, .gitleaks.toml).
// De meeste toetsen hebben gitleaks niet nodig: een nep-gitleaks schrijft een rapport, en de
// toets kijkt dat het script alleen aantallen en bestandsnamen toont, nooit de inhoud.
// Met GITLEAKS_BIN (zoals in de job gitleaks) draaien ook de eigen regels op de verzonnen
// voorbeelden in tests/fixtures/gitleaks/voorbeelden.txt.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { RAPPORT_SJABLOON, main, meldTekst, telVondsten } from "../scripts/gitleaks-meld.mjs";
import { runnerFouten } from "../scripts/refresh-droog.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lees = (pad) => fs.readFileSync(path.join(rootDir, pad), "utf8");
const GEHEIM = "VERZONNEN-GEHEIM-Verzonnenstraat-12";

const nepRapport = [
  { RuleID: "huisnummer-bij-straat", File: "site/history/a.json", Secret: GEHEIM, Match: ` ${GEHEIM}"`, Line: `"location": "${GEHEIM}"`, Author: "Iemand Verzonnen", Email: "iemand@voorbeeld.invalid", Message: GEHEIM, StartLine: 3 },
  { RuleID: "huisnummer-bij-straat", File: "site/history/a.json", Secret: GEHEIM, Match: GEHEIM, StartLine: 9 },
  { RuleID: "e-mailadres", File: "site/b.js", Secret: GEHEIM, Match: GEHEIM, StartLine: 1 },
  { RuleID: "gsm-be", File: "docs/x\n::error::nep.md", Secret: GEHEIM, Match: GEHEIM, StartLine: 1 },
  { RuleID: "gsm-be", File: "::error::nep.md", Secret: GEHEIM, Match: GEHEIM, StartLine: 1 },
  { RuleID: "e-mailadres", File: "tests/fixtures/pagina.html", Secret: GEHEIM, Match: GEHEIM, StartLine: 2 },
  { RuleID: "huisnummer-als-plek", File: "site/agenda-feed.js", Secret: GEHEIM, Match: GEHEIM, StartLine: 1 },
];

/** Een nep-gitleaks: antwoordt op "version" en schrijft het rapport naar --report-path. */
function nepGitleaks(map, rapport, { code = 0, fout = "fout in de configuratie" } = {}) {
  const bin = path.join(map, "gitleaks");
  const rapportBestand = path.join(map, "rapport-bron.json");
  fs.writeFileSync(rapportBestand, JSON.stringify(rapport));
  fs.writeFileSync(path.join(map, "args.txt"), "");
  fs.writeFileSync(bin, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "version") { console.log("8.30.1"); process.exit(0); }
fs.writeFileSync(${JSON.stringify(path.join(map, "args.txt"))}, JSON.stringify({ args, cwd: process.cwd() }));
const i = args.indexOf("--report-path");
fs.copyFileSync(${JSON.stringify(rapportBestand)}, args[i + 1]);
if (${code}) { console.error(${JSON.stringify(fout)}); process.exit(${code}); }
`, { mode: 0o755 });
  return bin;
}

function draai(argv, env) {
  const regels = [];
  const origineel = console.log;
  console.log = (...delen) => regels.push(delen.join(" "));
  try {
    const code = main(argv, env);
    return { code, uit: regels.join("\n") };
  } finally {
    console.log = origineel;
  }
}

// De runner van Actions haalt witruimte vooraan weg voor hij een ::opdracht:: herkent.
const geenOpdracht = (tekst, wat) => {
  for (const regel of tekst.split("\n")) assert.doesNotMatch(regel, /^\s*::/, `${wat}: ${regel}`);
};

test("telVondsten en meldTekst: aantallen per regel en per bestand, geen inhoud", () => {
  const telling = telVondsten(nepRapport);
  assert.equal(telling.totaal, 6, "een plek is geen vondst");
  assert.equal(telling.plek, 1, "maar wordt wel geteld");
  assert.equal(telling.inToetsen, 1, "vondsten onder tests/ tellen mee en apart");
  assert.deepEqual(telling.regels, [["e-mailadres", 2], ["gsm-be", 2], ["huisnummer-bij-straat", 2]]);
  assert.equal(telling.bestanden[0].bestand, "site/history/a.json");
  assert.equal(telling.bestanden.at(-1).bestand, "tests/fixtures/pagina.html", "tests/ achteraan");
  const tekst = meldTekst(telling, "kop");
  assert.doesNotMatch(tekst, /GEHEIM|Iemand|voorbeeld\.invalid/);
  assert.match(tekst, /^kop: 6 vondst\(en\), waarvan 1 onder tests\/ /);
  assert.match(tekst, /\nToegelaten als plek \("Naam, adres" in een locatie, geen vondst\): 1\.\n/);
  assert.match(tekst, /\n {2}\| site\/history\/a\.json {2}huisnummer-bij-straat 2\n/);
  assert.match(tekst, /\n {2}\| tests\/fixtures\/pagina\.html {2}e-mailadres 1$/);
  for (const regel of tekst.split("\n").slice(1)) assert.match(regel, /^(Per |Toegelaten | {2}\| )/, "elke regel begint met een kop of met '  | '");
  geenOpdracht(tekst, "een bestandsnaam begint nooit een ::opdracht::");
  assert.equal(meldTekst(telVondsten([]), "kop"), "kop: 0 vondst(en).");
  assert.equal(meldTekst(telVondsten([nepRapport.at(-1)]), "kop"), 'kop: 0 vondst(en).\nToegelaten als plek ("Naam, adres" in een locatie, geen vondst): 1.');
});

test("main met een nep-gitleaks: meldstand, juiste opties, rapport gewist, samenvatting zonder inhoud", { skip: process.platform === "win32" }, () => {
  const map = fs.mkdtempSync(path.join(os.tmpdir(), "gitleaks-nep-"));
  try {
    const bin = nepGitleaks(map, nepRapport);
    const samenvatting = path.join(map, "summary.md");
    const { code, uit } = draai(["boom"], { GITLEAKS_BIN: bin, GITHUB_ACTIONS: "true", GITHUB_STEP_SUMMARY: samenvatting });
    assert.equal(code, 0, "vondsten laten de stap niet falen");
    assert.doesNotMatch(uit, /GEHEIM|Iemand|voorbeeld\.invalid/);
    assert.match(uit, /werkboom: 6 vondst\(en\)/);
    assert.match(uit, /^::warning title=gitleaks \(meldt\)::Werkboom: 6 vondst\(en\) \(waarvan 1 onder tests\/\): e-mailadres 2, gsm-be 2, huisnummer-bij-straat 2\./m);
    assert.equal(uit.split("\n").filter((r) => /^\s*::/.test(r)).length, 1, "alleen onze eigen melding");
    const md = fs.readFileSync(samenvatting, "utf8");
    assert.doesNotMatch(md, /GEHEIM|Iemand|voorbeeld\.invalid/);
    assert.match(md, /\| huisnummer-bij-straat \| 2 \|/);
    assert.match(md, /Toegelaten als plek .*: 1\./);
    const { args, cwd } = JSON.parse(fs.readFileSync(path.join(map, "args.txt"), "utf8"));
    assert.equal(fs.realpathSync(cwd), fs.realpathSync(rootDir), "vanuit de wortel: relatieve bestandsnamen");
    assert.deepEqual(args.slice(0, 2), ["dir", "."]);
    for (const optie of ["--redact", "--no-banner"]) assert.ok(args.includes(optie), optie);
    assert.equal(args[args.indexOf("--exit-code") + 1], "0");
    assert.equal(args[args.indexOf("--config") + 1], path.join(rootDir, ".gitleaks.toml"));
    // Een eigen sjabloon: het rapport bevat alleen regel en bestand, ook in de tijdelijke map.
    assert.equal(args[args.indexOf("--report-format") + 1], "template");
    const sjabloon = args[args.indexOf("--report-template") + 1];
    assert.ok(sjabloon && !fs.existsSync(sjabloon), "het sjabloon is gewist");
    assert.doesNotMatch(RAPPORT_SJABLOON, /Secret|Match|Line|Author|Email|Message|Commit/);
    assert.deepEqual([...RAPPORT_SJABLOON.matchAll(/\$f\.([A-Za-z]+)/g)].map((m) => m[1]), ["RuleID", "File"]);
    const rapportPad = args[args.indexOf("--report-path") + 1];
    assert.ok(!fs.existsSync(rapportPad), "het rapport is gewist");

    const commits = draai(["commits", `${"a".repeat(40)}..${"b".repeat(40)}`], { GITLEAKS_BIN: bin });
    assert.equal(commits.code, 0);
    assert.doesNotMatch(commits.uit, /^::/m, "buiten Actions geen ::opdrachten::");
    geenOpdracht(commits.uit, "buiten Actions geen ::opdrachten::");
    const tweede = JSON.parse(fs.readFileSync(path.join(map, "args.txt"), "utf8")).args;
    assert.deepEqual(tweede.slice(0, 4), ["git", ".", "--log-opts", `${"a".repeat(40)}..${"b".repeat(40)}`]);
  } finally {
    fs.rmSync(map, { recursive: true, force: true });
  }
});

test("main: gitleaks ontbreekt is geen fout, gitleaks die faalt wel, verkeerd gebruik is 2", { skip: process.platform === "win32" }, () => {
  const ontbreekt = draai(["boom"], { GITLEAKS_BIN: path.join(os.tmpdir(), "bestaat-niet", "gitleaks") });
  assert.equal(ontbreekt.code, 0);
  assert.match(ontbreekt.uit, /gitleaks ontbreekt/);
  const map = fs.mkdtempSync(path.join(os.tmpdir(), "gitleaks-nep-"));
  try {
    const faalt = draai(["boom"], { GITLEAKS_BIN: nepGitleaks(map, [], { code: 1, fout: "fout in de configuratie\n::error::nep" }) });
    assert.equal(faalt.code, 1);
    assert.match(faalt.uit, /gitleaks faalde/);
    assert.match(faalt.uit, /^ {2}\| fout in de configuratie$/m);
    geenOpdracht(faalt.uit, "ook een foutmelding begint nooit een ::opdracht::");
  } finally {
    fs.rmSync(map, { recursive: true, force: true });
  }
  assert.equal(draai([], {}).code, 2);
  assert.equal(draai(["commits"], {}).code, 2);
  assert.equal(draai(["commits", "--output=/tmp/x..y"], {}).code, 2, "geen optie voor git log");
  assert.equal(draai(["commits", "main"], {}).code, 2, "een bereik, geen losse ref");
});

/** De regex van een regel in .gitleaks.toml. */
const regelRegex = (toml, id) => toml.match(new RegExp(`^id = "${id}"\\n[^\\n]*\\nregex = '''(.*)'''$`, "m"))?.[1];

test(".gitleaks.toml: standaardregels plus de eigen regels; tests/ niet blind toegelaten; plek per vondst", () => {
  const toml = lees(".gitleaks.toml");
  assert.match(toml, /\[extend\]\nuseDefault = true\n/);
  const ids = [...toml.matchAll(/^id = "([^"]+)"$/gm)].map((m) => m[1]);
  assert.deepEqual(ids, ["iban-be", "e-mailadres", "gsm-be", "huisnummer-bij-straat", "huisnummer-als-plek"]);
  assert.equal([...toml.matchAll(/^secretGroup = 1$/gm)].length, 5);
  assert.doesNotMatch(toml, /\(\?<[=!]|\(\?[=!]/, "Go-regex kent geen lookbehind of lookahead");
  // Niet heel tests/ zonder voorwaarde: alleen de voorbeelden van gitleaks, en elders een regel
  // met een merkteken (condition = AND).
  const paden = [...toml.matchAll(/(condition = "AND"\n)?paths = \[([^\]]*)\]/g)];
  for (const [, en, lijst] of paden) {
    if (/'''\^tests\/'''/.test(lijst)) assert.ok(en, "tests/ alleen samen met een merkteken");
  }
  assert.match(toml, /'''\^tests\/fixtures\/gitleaks\/'''/);
  assert.match(toml, /condition = "AND"\npaths = \['''\^tests\/'''\]\nregexTarget = "line"/);
  // De plek wordt per vondst beoordeeld, niet per tekstregel.
  assert.doesNotMatch(toml, /targetRules = \["huisnummer-bij-straat"\]\nregexTarget = "line"/);
  assert.match(toml, /targetRules = \["huisnummer-bij-straat"\]\nregexTarget = "match"/);
  const straat = regelRegex(toml, "huisnummer-bij-straat");
  const plek = regelRegex(toml, "huisnummer-als-plek");
  const adres = (r) => r.slice(r.indexOf("((?:\\p{Lu}"));
  assert.ok(straat && plek);
  assert.equal(adres(straat), adres(plek), "zelfde adres in beide regels");
  const voorvoegsel = plek.slice("(?m)".length, plek.indexOf("((?:\\p{Lu}"));
  assert.ok(straat.startsWith(`(?m)(?:${voorvoegsel}|^|`), "zelfde plek-voorvoegsel in beide regels");
});

/** De eisen aan de job gitleaks; [] als alles klopt. */
function gitleaksJobFouten(ci) {
  const start = ci.indexOf("\n  gitleaks:\n");
  if (start < 0) return ["job gitleaks ontbreekt"];
  const rest = ci.slice(start + 1);
  const volgende = rest.slice(1).search(/\n {2}[a-z][a-z0-9-]*:\n/);
  const blok = volgende < 0 ? rest : rest.slice(0, volgende + 1);
  const fouten = [];
  const eis = (re, wat) => { if (!re.test(blok)) fouten.push(wat); };
  eis(/\n {4}runs-on: \S+\n/, "runs-on");
  eis(/\n {4}continue-on-error: true\n/, "continue-on-error");
  eis(/\n {4}permissions:\n {6}contents: read\n/, "alleen leesrechten");
  eis(/GITLEAKS_SHA256: [0-9a-f]{64}\n/, "sha256");
  eis(/sha256sum -c -/, "sha256sum -c -");
  eis(/node scripts\/gitleaks-meld\.mjs boom/, "scan van de werkboom");
  if (/upload-artifact|gitleaks-action|secrets\./.test(blok)) fouten.push("artefact, gitleaks-action of geheim");
  return fouten;
}

const WERKSTROMEN = [".github/workflows/ci.yml", ".github/workflows/refresh.yml"];

test("ci.yml: gitleaks meldt alleen, vaste versie met sha256, geen artefact, nergens self-hosted", () => {
  assert.deepEqual(gitleaksJobFouten(lees(".github/workflows/ci.yml")), []);
  for (const pad of WERKSTROMEN) assert.deepEqual(runnerFouten(lees(pad)), [], `${pad}: publieke repo, nooit de Mac`);
});

test("het noodplan uit docs/UBUNTU_2604.md (ubuntu-24.04 vastzetten) houdt de toetsen in check groen", () => {
  const doc = lees("docs/UBUNTU_2604.md");
  const label = doc.match(/zet `(ubuntu-[0-9.]+)` vast in plaats van\s+`ubuntu-latest`/)?.[1];
  assert.equal(label, "ubuntu-24.04", "het noodplan noemt het label");
  // Ook als het al vastgezet is (dan verandert de vervanging niets): de toets moet dan groen blijven.
  for (const pad of WERKSTROMEN) {
    const vast = lees(pad).replace(/^( {4}runs-on: )ubuntu-latest$/gm, `$1${label}`);
    assert.doesNotMatch(vast, /^ {4}runs-on: ubuntu-latest$/m);
    assert.deepEqual(runnerFouten(vast), [], `${pad} met ${label}`);
    if (pad.endsWith("ci.yml")) assert.deepEqual(gitleaksJobFouten(vast), [], `job gitleaks met ${label}`);
  }
});

const gitleaks = process.env.GITLEAKS_BIN;
const echt = Boolean(gitleaks) && spawnSync(gitleaks, ["version"]).status === 0;
const gitleaksArgs = (rapport) => ["--config", path.join(rootDir, ".gitleaks.toml"), "--no-banner", "--exit-code", "0", "--log-level", "error", "--report-format", "json", "--report-path", rapport];

test("de eigen regels op verzonnen voorbeelden (echte gitleaks)", { skip: echt ? false : "GITLEAKS_BIN niet gezet; de job gitleaks in ci.yml draait dit" }, () => {
  const fixture = lees("tests/fixtures/gitleaks/voorbeelden.txt");
  const map = fs.mkdtempSync(path.join(os.tmpdir(), "gitleaks-echt-"));
  try {
    const rapport = path.join(map, "r.json");
    // stdin: geen pad, dus de allowlists op paden spelen niet; de andere wel.
    const scan = spawnSync(gitleaks, ["stdin", ...gitleaksArgs(rapport)], { input: fixture, encoding: "utf8" });
    assert.equal(scan.status, 0, scan.stderr);
    const gevonden = new Map();
    for (const v of JSON.parse(fs.readFileSync(rapport, "utf8"))) gevonden.set(v.StartLine, [...(gevonden.get(v.StartLine) ?? []), v.RuleID]);
    fixture.split("\n").forEach((regel, i) => {
      const m = regel.match(/^([a-z,-]+) \| /);
      if (!m) return;
      const verwacht = m[1] === "-" ? [] : m[1].split(",").sort();
      assert.deepEqual((gevonden.get(i + 1) ?? []).sort(), verwacht, `regel ${i + 1}: ${regel}`);
    });
  } finally {
    fs.rmSync(map, { recursive: true, force: true });
  }
});

test("allowlists op paden en het eigen rapport (echte gitleaks)", { skip: echt ? false : "GITLEAKS_BIN niet gezet; de job gitleaks in ci.yml draait dit" }, () => {
  const map = fs.mkdtempSync(path.join(os.tmpdir(), "gitleaks-paden-"));
  try {
    // Opgebouwd uit stukken, zodat deze toets zelf geen vondst is.
    const gsm = ["0499", "12 34 56"].join(" ");
    const tekst = `Verzonnen: bel ${gsm}\nBel ${gsm} na 18 uur.\n`;
    for (const pad of ["tests/fixtures/gitleaks/a.txt", "tests/fixtures/pagina/a.txt", "site/a.txt"]) {
      fs.mkdirSync(path.join(map, "boom", path.dirname(pad)), { recursive: true });
      fs.writeFileSync(path.join(map, "boom", pad), tekst);
    }
    const rapport = path.join(map, "r.json");
    const scan = spawnSync(gitleaks, ["dir", ".", ...gitleaksArgs(rapport)], { cwd: path.join(map, "boom"), encoding: "utf8" });
    assert.equal(scan.status, 0, scan.stderr);
    const vondsten = JSON.parse(fs.readFileSync(rapport, "utf8")).map((v) => `${v.File}:${v.StartLine}:${v.RuleID}`).sort();
    assert.deepEqual(vondsten, [
      "site/a.txt:1:gsm-be",
      "site/a.txt:2:gsm-be",
      "tests/fixtures/pagina/a.txt:2:gsm-be", // een fixture zonder merkteken blijft een vondst
    ]);

    // Het sjabloon van gitleaks-meld: alleen RuleID en File, geldige JSON.
    const sjabloon = path.join(map, "r.tmpl");
    fs.writeFileSync(sjabloon, RAPPORT_SJABLOON);
    const args = gitleaksArgs(rapport).map((a) => (a === "json" ? "template" : a));
    const metSjabloon = spawnSync(gitleaks, ["dir", ".", ...args, "--report-template", sjabloon], { cwd: path.join(map, "boom"), encoding: "utf8" });
    assert.equal(metSjabloon.status, 0, metSjabloon.stderr);
    const kaal = JSON.parse(fs.readFileSync(rapport, "utf8"));
    assert.equal(kaal.length, 3);
    for (const v of kaal) assert.deepEqual(Object.keys(v), ["RuleID", "File"]);
    assert.doesNotMatch(fs.readFileSync(rapport, "utf8"), /0499/);
  } finally {
    fs.rmSync(map, { recursive: true, force: true });
  }
});
