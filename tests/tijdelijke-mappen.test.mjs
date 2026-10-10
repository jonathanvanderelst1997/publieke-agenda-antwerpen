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

// Een toetsbestand dat een van deze woorden bevat, kan een tijdelijke map maken.
const TEMP_MARKER = /mkdtemp|tmpdir|TMPDIR/;
// Mappen die Node zelf in TMPDIR maakt en hergebruikt; geen lek van een toets.
const NODE_OWN = new Set(["node-compile-cache"]);

function tempUsingTestFiles() {
  return fs.readdirSync(testsDir)
    .filter((name) => name.endsWith(".test.mjs") && name !== self)
    .filter((name) => TEMP_MARKER.test(fs.readFileSync(path.join(testsDir, name), "utf8")))
    .sort();
}

// mkdtemp plakt zes tekens achter het voorvoegsel; zoek het bestand dat dat voorvoegsel gebruikt.
function owner(entry, files) {
  const prefix = entry.slice(0, -6);
  const found = files.filter((name) => fs.readFileSync(path.join(testsDir, name), "utf8").includes(`"${prefix}"`));
  return found.length ? `${entry} (tests/${found.join(", tests/")})` : entry;
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
  const files = tempUsingTestFiles();
  assert.ok(files.includes("manual-check.test.mjs"), "de toets moet minstens manual-check nakijken");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tijdelijke-mappen-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  // Zonder NODE_TEST_CONTEXT, anders denkt de geneste testloper dat hij zelf een kindproces is.
  const env = { ...process.env, TMPDIR: tmp, TMP: tmp, TEMP: tmp };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, ["--test", ...files.map((name) => path.join(testsDir, name))], { cwd: rootDir, env, encoding: "utf8" });
  assert.equal(run.status, 0, `De toetsen zelf faalden; los dat eerst op.\n${failures(run.stdout)}\n${run.stderr.slice(-2000)}`);
  const left = fs.readdirSync(tmp).filter((entry) => !NODE_OWN.has(entry)).sort();
  assert.deepEqual(left.map((entry) => owner(entry, files)), [],
    "Achtergebleven tijdelijke mappen. Ruim elke map op direct na mkdtempSync, met " +
    "t.after(() => fs.rmSync(root, { recursive: true, force: true })) of met try/finally " +
    "(zie tests/manual-check.test.mjs of tests/live-history-archive.test.mjs).");
});
