// Toetsen ruimen hun tijdelijke mappen op. Regressie 10-10-2026: tests/manual-check.test.mjs liet per toets
// een kopie van site/, scripts/ en lib/ (ongeveer 32 MB) achter in /tmp. Na een dag toetsen stonden er meer
// dan 500 zulke mappen (ongeveer 16 GB), de schijf liep vol en andere toetsen faalden met ENOSPC.
// Deze toets draait elk toetsbestand dat een tijdelijke map kan maken opnieuw, met een eigen lege TMPDIR,
// en eist dat die map nadien leeg is.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(testsDir, "..");
const self = path.basename(fileURLToPath(import.meta.url));

// Een bestand dat een van deze woorden bevat, kan een tijdelijke map maken.
const TEMP_MARKER = /mkdtemp|tmpdir|TMPDIR/;
// Hulpcode die toetsen importeren of als kindproces starten: code in deze mappen buiten tests/*.test.mjs.
const HELPER_DIRS = ["tests", "lib", "scripts"];
const CODE_FILE = /\.(?:mjs|cjs|js)$/;
// Mappen die Node zelf in TMPDIR maakt en hergebruikt; geen lek van een toets.
const NODE_OWN = new Set(["node-compile-cache"]);

function helperFiles(root) {
  return HELPER_DIRS.flatMap((dir) => {
    if (!fs.existsSync(path.join(root, dir))) return [];
    return fs.readdirSync(path.join(root, dir), { recursive: true })
      .map((name) => path.join(dir, name))
      .filter((rel) => CODE_FILE.test(rel) && !rel.split(path.sep).includes("node_modules"))
      .filter((rel) => !(path.dirname(rel) === "tests" && rel.endsWith(".test.mjs")))
      .filter((rel) => fs.statSync(path.join(root, rel)).isFile());
  }).sort();
}

// Verwijst de tekst naar het bestand, met zijn volledige naam (import "./x.mjs", kindproces "scripts/x.mjs")?
function mentions(text, rel) {
  const name = path.basename(rel).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\w.-])${name}(?![\\w.-])`).test(text);
}

// De toetsbestanden om na te kijken: die zelf een tijdelijke map kunnen maken, en die naar hulpcode verwijzen
// die dat kan (ook via andere hulpcode). Hulpcode met een tijdelijke map waar niets naar verwijst (bv. via een
// samengesteld pad of `npm run`), kunnen we aan geen toets koppelen; dan draaien we alle toetsbestanden.
function filesToCheck(root) {
  const cache = new Map();
  const read = (rel) => {
    if (!cache.has(rel)) cache.set(rel, fs.readFileSync(path.join(root, rel), "utf8"));
    return cache.get(rel);
  };
  const tests = fs.readdirSync(path.join(root, "tests"))
    .filter((name) => name.endsWith(".test.mjs") && name !== self)
    .sort()
    .map((name) => path.join("tests", name));
  const code = helperFiles(root);
  const helpers = new Set(code.filter((rel) => TEMP_MARKER.test(read(rel))));
  for (let grown = true; grown;) {
    grown = false;
    for (const rel of code) {
      if (!helpers.has(rel) && [...helpers].some((helper) => mentions(read(rel), helper))) {
        helpers.add(rel);
        grown = true;
      }
    }
  }
  const unreferenced = [...helpers]
    .filter((helper) => ![...tests, ...helpers].some((rel) => rel !== helper && mentions(read(rel), helper)))
    .sort();
  const picked = unreferenced.length ? tests : tests.filter((rel) =>
    TEMP_MARKER.test(read(rel)) || [...helpers].some((helper) => mentions(read(rel), helper)));
  return { files: picked.map((rel) => path.basename(rel)), helpers: [...helpers].sort(), unreferenced };
}

// mkdtemp plakt zes tekens achter het voorvoegsel; zoek het bestand dat dat voorvoegsel gebruikt.
function owner(entry, sources) {
  const prefix = entry.slice(0, -6);
  const found = sources.filter((rel) => fs.readFileSync(path.join(rootDir, rel), "utf8").includes(`"${prefix}"`));
  return found.length ? `${entry} (${found.join(", ")})` : entry;
}

// Alleen de gefaalde toetsen uit de TAP-uitvoer, met hun foutmelding.
function failures(stdout) {
  const lines = stdout.split("\n");
  const out = [];
  lines.forEach((line, index) => {
    if (/^\s*not ok /.test(line)) out.push(...lines.slice(index, index + 12));
  });
  return out.join("\n").slice(0, 6000);
}

test("toetsen die een tijdelijke map maken, laten er na afloop geen achter", (t) => {
  const { files, helpers, unreferenced } = filesToCheck(rootDir);
  assert.ok(files.includes("manual-check.test.mjs"), "de toets moet minstens manual-check nakijken");
  if (helpers.length) t.diagnostic(`Hulpcode met tijdelijke mappen: ${helpers.join(", ")}.`);
  if (unreferenced.length) t.diagnostic(`Niets verwijst naar ${unreferenced.join(", ")}: alle toetsbestanden worden nagekeken.`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tijdelijke-mappen-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  // Zonder NODE_TEST_CONTEXT, anders denkt de geneste testloper dat hij zelf een kindproces is.
  const env = { ...process.env, TMPDIR: tmp, TMP: tmp, TEMP: tmp };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, ["--test", ...files.map((name) => path.join(testsDir, name))], { cwd: rootDir, env, encoding: "utf8" });
  assert.equal(run.status, 0, `De toetsen zelf faalden; los dat eerst op.\n${failures(run.stdout)}\n${run.stderr.slice(-2000)}`);
  const left = fs.readdirSync(tmp).filter((entry) => !NODE_OWN.has(entry)).sort();
  const sources = [...files.map((name) => path.join("tests", name)), ...helpers];
  assert.deepEqual(left.map((entry) => owner(entry, sources)), [],
    "Achtergebleven tijdelijke mappen. Ruim elke map op direct na mkdtempSync, met " +
    "t.after(() => fs.rmSync(root, { recursive: true, force: true })) of met try/finally " +
    "(zie tests/manual-check.test.mjs of tests/live-history-archive.test.mjs).");
});

// Regressie review PR #154: een map die een hulpmodule in tests/fixtures/ of een script in een kindproces
// maakte, bleef achter zonder dat deze toets het zag, omdat het toetsbestand zelf geen van de woorden bevatte.
test("hulpcode die een tijdelijke map maakt, laat de toetsbestanden die haar gebruiken nakijken", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tijdelijke-mappen-keuze-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  write("tests/eigen.test.mjs", 'fs.mkdtempSync(path.join(os.tmpdir(), "eigen-"));\n');
  write("tests/via-hulp.test.mjs", 'import { maakMap } from "./fixtures/hulp.mjs";\nmaakMap();\n');
  write("tests/via-kind.test.mjs", 'spawnSync(process.execPath, [path.join(root, "scripts", "kind.mjs")]);\n');
  write("tests/via-tussen.test.mjs", 'import { tussen } from "../lib/tussen.mjs";\ntussen();\n');
  write("tests/gelijkend.test.mjs", 'spawnSync(process.execPath, ["scripts/ander-kind.mjs"]);\n');
  write("tests/fixtures/data.json", '{ "uitleg": "mkdtemp in een databestand telt niet" }\n');
  write("tests/fixtures/hulp.mjs", "export const maakMap = () => null;\n");
  write("lib/tussen.mjs", 'import { diep } from "./diep.mjs";\nexport const tussen = () => diep();\n');
  write("lib/diep.mjs", "export const diep = () => null;\n");
  write("scripts/kind.mjs", "console.log(1);\n");
  write("scripts/ander-kind.mjs", "console.log(2);\n");
  assert.deepEqual(filesToCheck(root), { files: ["eigen.test.mjs"], helpers: [], unreferenced: [] });

  const cases = [
    ["tests/fixtures/hulp.mjs", 'export const maakMap = () => fs.mkdtempSync(path.join(os.tmpdir(), "via-hulp-"));\n',
      { files: ["eigen.test.mjs", "via-hulp.test.mjs"], helpers: ["tests/fixtures/hulp.mjs"], unreferenced: [] }],
    ["scripts/kind.mjs", "const plek = process.env.TMPDIR;\n",
      { files: ["eigen.test.mjs", "via-kind.test.mjs"], helpers: ["scripts/kind.mjs"], unreferenced: [] }],
    ["lib/diep.mjs", "export const diep = () => os.tmpdir();\n",
      { files: ["eigen.test.mjs", "via-tussen.test.mjs"], helpers: ["lib/diep.mjs", "lib/tussen.mjs"], unreferenced: [] }],
    // Niets verwijst ernaar (bv. een samengesteld pad): dan alle toetsbestanden.
    ["tests/e2e/los.cjs", "fs.mkdtempSync('x');\n",
      { files: ["eigen.test.mjs", "gelijkend.test.mjs", "via-hulp.test.mjs", "via-kind.test.mjs", "via-tussen.test.mjs"],
        helpers: ["tests/e2e/los.cjs"], unreferenced: ["tests/e2e/los.cjs"] }],
  ];
  for (const [rel, text, expected] of cases) {
    const before = fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), "utf8") : null;
    write(rel, text);
    assert.deepEqual(filesToCheck(root), expected, rel);
    if (before === null) fs.rmSync(path.join(root, rel));
    else write(rel, before);
  }
});
