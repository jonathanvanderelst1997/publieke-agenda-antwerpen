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

import { main, meldTekst, telVondsten } from "../scripts/gitleaks-meld.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lees = (pad) => fs.readFileSync(path.join(rootDir, pad), "utf8");
const GEHEIM = "VERZONNEN-GEHEIM-Verzonnenstraat-12";

const nepRapport = [
  { RuleID: "huisnummer-bij-straat", File: "site/history/a.json", Secret: GEHEIM, Match: ` ${GEHEIM}"`, Line: `"location": "${GEHEIM}"`, Author: "Iemand Verzonnen", Email: "iemand@voorbeeld.invalid", Message: GEHEIM, StartLine: 3 },
  { RuleID: "huisnummer-bij-straat", File: "site/history/a.json", Secret: GEHEIM, Match: GEHEIM, StartLine: 9 },
  { RuleID: "e-mailadres", File: "site/b.js", Secret: GEHEIM, Match: GEHEIM, StartLine: 1 },
  { RuleID: "gsm-be", File: "docs/x\n::error::nep.md", Secret: GEHEIM, Match: GEHEIM, StartLine: 1 },
];

/** Een nep-gitleaks: antwoordt op "version" en schrijft het rapport naar --report-path. */
function nepGitleaks(map, rapport, { code = 0 } = {}) {
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
if (${code}) { console.error("fout in de configuratie"); process.exit(${code}); }
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

test("telVondsten en meldTekst: aantallen per regel en per bestand, geen inhoud", () => {
  const telling = telVondsten(nepRapport);
  assert.equal(telling.totaal, 4);
  assert.deepEqual(telling.regels, [["huisnummer-bij-straat", 2], ["e-mailadres", 1], ["gsm-be", 1]]);
  assert.equal(telling.bestanden[0].bestand, "site/history/a.json");
  const tekst = meldTekst(telling, "kop");
  assert.doesNotMatch(tekst, /GEHEIM|Iemand|voorbeeld\.invalid/);
  assert.match(tekst, /^kop: 4 vondst\(en\)\./);
  assert.match(tekst, /\n {2}site\/history\/a\.json {2}huisnummer-bij-straat 2\n/);
  for (const regel of tekst.split("\n").slice(1)) assert.match(regel, /^(Per |  )/, "elke regel begint met een kop of met spaties");
  assert.doesNotMatch(tekst, /\n::/, "een bestandsnaam begint nooit een ::opdracht::");
  assert.equal(meldTekst(telVondsten([]), "kop"), "kop: 0 vondst(en).");
});

test("main met een nep-gitleaks: meldstand, juiste opties, rapport gewist, samenvatting zonder inhoud", { skip: process.platform === "win32" }, () => {
  const map = fs.mkdtempSync(path.join(os.tmpdir(), "gitleaks-nep-"));
  try {
    const bin = nepGitleaks(map, nepRapport);
    const samenvatting = path.join(map, "summary.md");
    const { code, uit } = draai(["boom"], { GITLEAKS_BIN: bin, GITHUB_ACTIONS: "true", GITHUB_STEP_SUMMARY: samenvatting });
    assert.equal(code, 0, "vondsten laten de stap niet falen");
    assert.doesNotMatch(uit, /GEHEIM|Iemand|voorbeeld\.invalid/);
    assert.match(uit, /werkboom: 4 vondst\(en\)/);
    assert.match(uit, /^::warning title=gitleaks \(meldt\)::Werkboom: 4 vondst\(en\): huisnummer-bij-straat 2, e-mailadres 1, gsm-be 1\./m);
    assert.equal(uit.split("\n").filter((r) => r.startsWith("::")).length, 1, "alleen onze eigen melding");
    const md = fs.readFileSync(samenvatting, "utf8");
    assert.doesNotMatch(md, /GEHEIM|Iemand|voorbeeld\.invalid/);
    assert.match(md, /\| huisnummer-bij-straat \| 2 \|/);
    const { args, cwd } = JSON.parse(fs.readFileSync(path.join(map, "args.txt"), "utf8"));
    assert.equal(fs.realpathSync(cwd), fs.realpathSync(rootDir), "vanuit de wortel: relatieve bestandsnamen");
    assert.deepEqual(args.slice(0, 2), ["dir", "."]);
    for (const optie of ["--redact", "--no-banner"]) assert.ok(args.includes(optie), optie);
    assert.equal(args[args.indexOf("--exit-code") + 1], "0");
    assert.equal(args[args.indexOf("--config") + 1], path.join(rootDir, ".gitleaks.toml"));
    const rapportPad = args[args.indexOf("--report-path") + 1];
    assert.ok(!fs.existsSync(rapportPad), "het rapport is gewist");

    const commits = draai(["commits", `${"a".repeat(40)}..${"b".repeat(40)}`], { GITLEAKS_BIN: bin });
    assert.equal(commits.code, 0);
    assert.doesNotMatch(commits.uit, /^::/m, "buiten Actions geen ::opdrachten::");
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
    const faalt = draai(["boom"], { GITLEAKS_BIN: nepGitleaks(map, [], { code: 1 }) });
    assert.equal(faalt.code, 1);
    assert.match(faalt.uit, /gitleaks faalde/);
  } finally {
    fs.rmSync(map, { recursive: true, force: true });
  }
  assert.equal(draai([], {}).code, 2);
  assert.equal(draai(["commits"], {}).code, 2);
  assert.equal(draai(["commits", "--output=/tmp/x..y"], {}).code, 2, "geen optie voor git log");
  assert.equal(draai(["commits", "main"], {}).code, 2, "een bereik, geen losse ref");
});

test(".gitleaks.toml: standaardregels plus vier eigen regels, toetsen en fixtures toegelaten", () => {
  const toml = lees(".gitleaks.toml");
  assert.match(toml, /\[extend\]\nuseDefault = true\n/);
  const ids = [...toml.matchAll(/^id = "([^"]+)"$/gm)].map((m) => m[1]);
  assert.deepEqual(ids, ["iban-be", "e-mailadres", "gsm-be", "huisnummer-bij-straat"]);
  assert.equal([...toml.matchAll(/^secretGroup = 1$/gm)].length, 4);
  assert.match(toml, /'''\^tests\/'''/);
  assert.doesNotMatch(toml, /\(\?<[=!]|\(\?[=!]/, "Go-regex kent geen lookbehind of lookahead");
});

test("ci.yml: gitleaks meldt alleen, vaste versie met sha256, geen artefact, nergens self-hosted", () => {
  const ci = lees(".github/workflows/ci.yml");
  const start = ci.indexOf("\n  gitleaks:\n");
  assert.ok(start > 0, "job gitleaks");
  const blok = ci.slice(start);
  assert.match(blok, /\n    runs-on: ubuntu-latest\n/);
  assert.match(blok, /\n    continue-on-error: true\n/);
  assert.match(blok, /\n    permissions:\n      contents: read\n/);
  assert.match(blok, /GITLEAKS_SHA256: [0-9a-f]{64}\n/);
  assert.match(blok, /sha256sum -c -/);
  assert.match(blok, /node scripts\/gitleaks-meld\.mjs boom/);
  assert.doesNotMatch(blok, /upload-artifact|gitleaks-action|secrets\./);
  for (const pad of [".github/workflows/ci.yml", ".github/workflows/refresh.yml"]) {
    const werkstroom = lees(pad);
    assert.doesNotMatch(werkstroom, /runs-on:.*self-hosted/, `${pad}: publieke repo, nooit de Mac`);
    for (const m of werkstroom.matchAll(/^\s+runs-on: (.+)$/gm)) assert.match(m[1], /^ubuntu-[0-9a-z.]+$/, `${pad}: ${m[1]}`);
  }
});

const gitleaks = process.env.GITLEAKS_BIN;
const echt = Boolean(gitleaks) && spawnSync(gitleaks, ["version"]).status === 0;

test("de eigen regels op verzonnen voorbeelden (echte gitleaks)", { skip: echt ? false : "GITLEAKS_BIN niet gezet; de job gitleaks in ci.yml draait dit" }, () => {
  const fixture = lees("tests/fixtures/gitleaks/voorbeelden.txt");
  const map = fs.mkdtempSync(path.join(os.tmpdir(), "gitleaks-echt-"));
  try {
    const rapport = path.join(map, "r.json");
    // stdin: geen pad, dus de allowlist voor tests/ speelt niet; de andere allowlists wel.
    const scan = spawnSync(gitleaks, ["stdin", "--config", path.join(rootDir, ".gitleaks.toml"), "--no-banner", "--exit-code", "0", "--log-level", "error", "--report-format", "json", "--report-path", rapport], { input: fixture, encoding: "utf8" });
    assert.equal(scan.status, 0, scan.stderr);
    const gevonden = new Map();
    for (const v of JSON.parse(fs.readFileSync(rapport, "utf8"))) gevonden.set(v.StartLine, [...(gevonden.get(v.StartLine) ?? []), v.RuleID]);
    fixture.split("\n").forEach((regel, i) => {
      const m = regel.match(/^([a-z-]+|-) \| /);
      if (!m) return;
      const verwacht = m[1] === "-" ? [] : [m[1]];
      assert.deepEqual(gevonden.get(i + 1) ?? [], verwacht, `regel ${i + 1}: ${regel}`);
    });

    // Als bestand onder tests/ laat de allowlist alles door.
    const dir = spawnSync(gitleaks, ["dir", "tests/fixtures/gitleaks", "--config", path.join(rootDir, ".gitleaks.toml"), "--no-banner", "--exit-code", "0", "--log-level", "error", "--report-format", "json", "--report-path", rapport], { cwd: rootDir, encoding: "utf8" });
    assert.equal(dir.status, 0, dir.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(rapport, "utf8")), []);
  } finally {
    fs.rmSync(map, { recursive: true, force: true });
  }
});
