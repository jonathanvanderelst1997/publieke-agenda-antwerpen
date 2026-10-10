// De proefjob ubuntu-26.04-proef (ci.yml) draait scripts/refresh-droog.mjs: de run-stappen van
// refresh.yml, letterlijk uit het bestand, zonder iets naar het netwerk te schrijven. Deze toets
// bewaakt dat het script refresh.yml juist leest en dat de stub elke push opvangt. De versies van
// date, jq en bash zelf toetst de proefjob op de image; die horen niet in de gewone suite.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DATATAKKEN, DROGE_JOBS, OPGERUIMD, databaantoets, droogEnv, leesWerkstroom, maakStubs } from "../scripts/refresh-droog.mjs";

const lees = (pad) => fs.readFileSync(new URL(`../${pad}`, import.meta.url), "utf8");
const heeftBash = spawnSync("bash", ["-c", "true"]).status === 0;

test("leesWerkstroom: jobs, stappen, run-blokken, env en with", () => {
  const tekst = [
    "name: x",
    "jobs:",
    "  een:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@abc # v6",
    "        with:",
    "          persist-credentials: false",
    "      # commentaar tussen stappen",
    "      - name: Blok",
    "        env:",
    "          A: letterlijk",
    "          B: ${{ github.token }}",
    "        run: |",
    "          set -euo pipefail",
    "          # bash-commentaar blijft",
    "",
    "          echo \"klaar\"",
    "      - name: \"Eén regel\"",
    "        continue-on-error: true",
    "        run: npm run check",
    "  twee:",
    "    steps:",
    "      - run: echo twee",
    "",
  ].join("\n");
  const jobs = leesWerkstroom(tekst);
  assert.deepEqual([...jobs.keys()], ["een", "twee"]);
  const [checkout, blok, regel] = jobs.get("een").steps;
  assert.equal(checkout.uses, "actions/checkout@abc");
  assert.deepEqual(checkout.with, { "persist-credentials": "false" });
  assert.equal(blok.name, "Blok");
  assert.deepEqual(blok.env, { A: "letterlijk", B: "${{ github.token }}" });
  assert.equal(blok.run, "set -euo pipefail\n# bash-commentaar blijft\n\necho \"klaar\"\n");
  assert.equal(regel.name, "Eén regel");
  assert.equal(regel.continueOnError, true);
  assert.equal(regel.run, "npm run check\n");
  assert.equal(jobs.get("twee").steps[0].run, "echo twee\n");
});

test("refresh.yml: elke job van de droge run staat erin, de push staat in een run-blok", () => {
  const jobs = leesWerkstroom(lees(".github/workflows/refresh.yml"));
  for (const job of DROGE_JOBS) assert.ok(jobs.has(job), job);
  assert.ok(jobs.has("alarm"), "alarm bestaat, maar draait nooit droog");
  assert.ok(!DROGE_JOBS.includes("alarm"));
  const commit = jobs.get("publish-branch").steps.find((s) => s.name === "Eén datacommit op een eigen tak");
  assert.ok(commit, "stap Eén datacommit op een eigen tak");
  assert.match(commit.run, /git push --quiet --no-verify origin "HEAD:refs\/heads\/\$\{branch\}"/);
  assert.match(commit.run, /git ls-remote --exit-code --heads origin/);
  assert.equal(commit.env.GH_TOKEN, "${{ github.token }}");
});

test("de databaantoets is in refresh.yml en ci.yml letterlijk dezelfde", () => {
  const refresh = leesWerkstroom(lees(".github/workflows/refresh.yml"));
  const ci = leesWerkstroom(lees(".github/workflows/ci.yml"));
  const a = databaantoets(refresh.get("publish-branch").steps.find((s) => s.name === "Patch toepassen en de datalijst opnieuw toetsen").run);
  const b = databaantoets(ci.get("data-only").steps.find((s) => s.name === "Alleen data, alleen van de bot").run);
  assert.match(a, /^# >>> databaantoets/);
  assert.match(a, /lane_check\(\) \{/);
  assert.equal(a, b);
});

test("droogEnv: nooit een echt token of geheim, letterlijke waarden blijven", () => {
  const context = { runId: "123", baseSha: "a".repeat(40) };
  assert.equal(droogEnv("GH_TOKEN", "${{ github.token }}", context), "droog-geen-token");
  assert.equal(droogEnv("RUN_ID", "${{ github.run_id }}", context), "123");
  assert.equal(droogEnv("BASE_SHA", "${{ github.sha }}", context), "a".repeat(40));
  assert.equal(droogEnv("UITDATABANK_API_KEY", "${{ secrets.UITDATABANK_API_KEY }}", context), "");
  assert.equal(droogEnv("STATUS_URL", "https://voorbeeld.invalid/x.json", context), "https://voorbeeld.invalid/x.json");
});

test("de verzonnen takkenlijst toetst numeriek sorteren op de grens van vijf", () => {
  const vorm = /^data\/refresh-([0-9]{8})-([0-9]+)$/;
  const geldig = DATATAKKEN.filter((t) => vorm.test(t));
  const gesorteerd = [...geldig].sort((x, y) => {
    const [, dx, rx] = x.match(vorm);
    const [, dy, ry] = y.match(vorm);
    return Number(dy) - Number(dx) || Number(ry) - Number(rx);
  });
  assert.deepEqual(gesorteerd.slice(5), OPGERUIMD);
  assert.ok(DATATAKKEN.includes("data/refresh-oud"), "een tak buiten de vorm telt niet mee");
});

test("de git-stub vangt push en ls-remote op, de rest gaat naar de echte git", { skip: !heeftBash }, () => {
  const map = fs.mkdtempSync(path.join(os.tmpdir(), "droog-stub-"));
  try {
    const echteGit = spawnSync("bash", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
    maakStubs(map, echteGit);
    const env = { ...process.env, PATH: `${map}${path.delimiter}${process.env.PATH}` };
    const run = (script) => spawnSync("bash", ["-c", script], { env, encoding: "utf8", cwd: new URL("..", import.meta.url) });
    const push = run("git push --quiet origin HEAD:refs/heads/data/refresh-20261010-1");
    assert.equal(push.status, 0);
    assert.match(push.stderr, /^DROOG: git push /);
    const bestaat = run("git ls-remote --exit-code --heads origin refs/heads/data/refresh-20261010-1");
    assert.equal(bestaat.status, 2, "een nieuwe tak bestaat nog niet");
    const lijst = run("git ls-remote --heads origin 'refs/heads/data/refresh-*'");
    assert.equal(lijst.status, 0);
    assert.deepEqual(lijst.stdout.trim().split("\n").map((r) => r.split("\t")[1]), DATATAKKEN.map((t) => `refs/heads/${t}`));
    const gh = run("gh issue create --title x");
    assert.equal(gh.status, 0);
    assert.match(gh.stderr, /^DROOG: gh /);
    const echt = run("git rev-parse --is-inside-work-tree");
    assert.equal(echt.stdout.trim(), "true");
  } finally {
    fs.rmSync(map, { recursive: true, force: true });
  }
});

test("ci.yml: de proefjob draait op ubuntu-26.04, mag falen en heeft alleen leesrechten", () => {
  const ci = lees(".github/workflows/ci.yml");
  const start = ci.indexOf("\n  ubuntu-2604-proef:\n");
  assert.ok(start > 0, "job ubuntu-2604-proef");
  const rest = ci.slice(start + 1);
  const blok = rest.slice(0, rest.slice(1).search(/\n  [a-z][a-z0-9-]*:\n/) + 1);
  assert.match(blok, /\n    runs-on: ubuntu-26\.04\n/);
  assert.match(blok, /\n    continue-on-error: true\n/);
  assert.match(blok, /\n    permissions:\n      contents: read\n/);
  assert.match(blok, /node scripts\/refresh-droog\.mjs gereedschap/);
  assert.match(blok, /node scripts\/refresh-droog\.mjs verversing/);
  assert.doesNotMatch(blok, /secrets\.|vars\./, "geen geheimen of variabelen in de proef");
});
