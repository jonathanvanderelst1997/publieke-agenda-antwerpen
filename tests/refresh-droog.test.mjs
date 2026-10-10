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
import { fileURLToPath } from "node:url";

import {
  DATATAKKEN,
  DROGE_JOBS,
  DROOG_GITCONFIG,
  GEHOST_LABEL,
  OPGERUIMD,
  databaantoets,
  droogEnv,
  leesWerkstroom,
  maakStubs,
  oordeel,
  platformWaarschuwing,
  runnerFouten,
  vasteControles,
  verzamelBreuken,
} from "../scripts/refresh-droog.mjs";

const lees = (pad) => fs.readFileSync(new URL(`../${pad}`, import.meta.url), "utf8");
const heeftBash = spawnSync("bash", ["-c", "true"]).status === 0;
const heeftSha256sum = heeftBash && spawnSync("bash", ["-c", "command -v sha256sum"]).status === 0;

/**
 * De echte git, ook als deze toets zelf in een droge verversing draait (dan staat de stub van
 * maakStubs vooraan op het PATH: npm run check in refresh.yml draait de hele suite).
 */
function echteGitPad() {
  for (const map of String(process.env.PATH ?? "").split(path.delimiter)) {
    const kandidaat = path.join(map, "git");
    try {
      if (!fs.statSync(kandidaat).isFile()) continue;
      if (fs.readFileSync(kandidaat).subarray(0, 4096).includes("# Droge verversing")) continue;
      return kandidaat;
    } catch {
      // niet op deze plek
    }
  }
  return "git";
}

/** Het blok van één job in een werkstroom (van de kop tot de volgende job). */
function jobBlok(tekst, naam) {
  const start = tekst.indexOf(`\n  ${naam}:\n`);
  assert.ok(start > 0, `job ${naam}`);
  const rest = tekst.slice(start + 1);
  const volgende = rest.slice(1).search(/\n {2}[a-z][a-z0-9-]*:\n/);
  return volgende < 0 ? rest : rest.slice(0, volgende + 1);
}

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
    maakStubs(map, echteGitPad());
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
    // Globale opties voor het subcommando: de stub kijkt erlangs, anders gaat de push naar de
    // echte remote.
    for (const opdracht of [
      "git -C . push origin HEAD:refs/heads/x",
      "git -c user.name=verzonnen push origin HEAD:refs/heads/x",
      "git --git-dir .git --work-tree . push origin HEAD:refs/heads/x",
      "git --git-dir=.git --no-pager push origin HEAD:refs/heads/x",
    ]) {
      const r = run(opdracht);
      assert.equal(r.status, 0, opdracht);
      assert.match(r.stderr, /^DROOG: git .*push/, opdracht);
    }
    const bestaatC = run("git -C . ls-remote --exit-code --heads origin refs/heads/x");
    assert.equal(bestaatC.status, 2, "ook git -C . ls-remote komt bij de stub");
    assert.match(run("git -C . fetch origin").stderr, /^DROOG: git fetch overgeslagen/);
    assert.equal(run("git -C . rev-parse --is-inside-work-tree").stdout.trim(), "true", "de rest gaat naar de echte git");
  } finally {
    fs.rmSync(map, { recursive: true, force: true });
  }
});

test("DROOG_GITCONFIG: een push die toch langs de stub gaat, raakt het netwerk niet", { skip: !heeftBash }, () => {
  const map = fs.mkdtempSync(path.join(os.tmpdir(), "droog-config-"));
  try {
    const config = path.join(map, "gitconfig");
    fs.writeFileSync(config, DROOG_GITCONFIG);
    const env = { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };
    const git = (...args) => spawnSync(echteGitPad(), args, { cwd: path.join(map, "repo"), env, encoding: "utf8" });
    fs.mkdirSync(path.join(map, "repo"));
    assert.equal(git("init", "-q").status, 0);
    assert.equal(git("-c", "user.name=Verzonnen", "-c", "user.email=verzonnen@voorbeeld.invalid", "commit", "-q", "--allow-empty", "-m", "x").status, 0);
    assert.equal(git("remote", "add", "origin", "https://voorbeeld.invalid/verzonnen.git").status, 0);
    assert.equal(git("remote", "get-url", "--push", "origin").stdout.trim(), "droog-geen-push://voorbeeld.invalid/verzonnen.git");
    const push = git("push", "origin", "HEAD:refs/heads/x");
    assert.notEqual(push.status, 0);
    assert.match(push.stderr, /droog-geen-push/);
    assert.equal(git("remote", "get-url", "origin").stdout.trim(), "https://voorbeeld.invalid/verzonnen.git", "lezen blijft gewoon");
  } finally {
    fs.rmSync(map, { recursive: true, force: true });
  }
});

test("de toetsen met git werken ook binnen een droge verversing (stub vooraan op het PATH)", { skip: !heeftBash }, () => {
  // npm run check in refresh.yml draait de hele suite, en dan met de git-stub op het PATH.
  const map = fs.mkdtempSync(path.join(os.tmpdir(), "droog-binnen-"));
  try {
    maakStubs(map, echteGitPad());
    const r = spawnSync(process.execPath, ["--test", "--test-name-pattern", "^(DROOG_GITCONFIG|de git-stub)", fileURLToPath(import.meta.url)], {
      // Zonder NODE_TEST_CONTEXT: anders meldt het kind zijn uitslag alleen aan deze toets.
      env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "NODE_TEST_CONTEXT")), PATH: `${map}${path.delimiter}${process.env.PATH}` },
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stdout.split("\n").filter((l) => /not ok|error:/.test(l)).join("\n"));
    assert.match(r.stdout, /^# pass 2$/m);
  } finally {
    fs.rmSync(map, { recursive: true, force: true });
  }
});

test("vaste uitkomsten: sha256sum -c - zoals de job gitleaks het gebruikt", { skip: !heeftSha256sum }, () => {
  const werkstroom = leesWerkstroom(lees(".github/workflows/refresh.yml"));
  const controle = vasteControles(werkstroom).find((c) => c.naam.startsWith("sha256sum -c -"));
  assert.ok(controle, "sha256sum staat in de vaste uitkomsten");
  const map = fs.mkdtempSync(path.join(os.tmpdir(), "droog-sha-"));
  try {
    const args = (controle.args ?? []).map((a) => (a === "$TMP" ? map : a));
    const r = spawnSync("bash", ["-c", controle.script, "_", ...args], { encoding: "utf8" });
    assert.equal(controle.verwacht({ code: r.status, uitvoer: r.stdout + r.stderr }), true, r.stdout + r.stderr);
    assert.notEqual(controle.verwacht({ code: 0, uitvoer: "x: FAILED\n" }), true, "een fout wordt gezien");
  } finally {
    fs.rmSync(map, { recursive: true, force: true });
  }
  assert.match(lees(".github/workflows/ci.yml"), /\| sha256sum -c -\n/, "de job gitleaks gebruikt dezelfde vorm");
});

test("platformWaarschuwing: op macOS zegt BREUK niets over Ubuntu", () => {
  assert.equal(platformWaarschuwing("linux"), null);
  assert.match(platformWaarschuwing("darwin"), /macOS.*BSD.*niets over Ubuntu/s);
  assert.match(platformWaarschuwing("win32"), /niet op Linux/);
  const doc = lees("docs/UBUNTU_2604.md");
  const lokaal = doc.slice(doc.indexOf("## Lokaal"));
  assert.match(lokaal, /macOS/);
  assert.match(lokaal, /npm run check/, "de doc zegt dat verversing ook de suite draait");
});

test("verzamelBreuken: de regels van de scripts plus stappen die faalden zonder iets te noteren", () => {
  const regels = "gereedschap: date -u -d op geen datum faalt\nverversing: refresh/Data vers\n\ngereedschap: date -u -d op geen datum faalt\n";
  const stappen = {
    gereedschap: { outcome: "failure", conclusion: "failure" },
    "npm-ci": { outcome: "success" },
    check: { outcome: "failure" },
    schoon: { outcome: "skipped" },
    verversing: { outcome: "failure" },
  };
  assert.deepEqual(verzamelBreuken(regels, stappen), ["gereedschap: date -u -d op geen datum faalt", "verversing: refresh/Data vers", "stap: check"]);
  assert.deepEqual(verzamelBreuken("", { verversing: { outcome: "failure" } }), ["stap: verversing"], "een script dat crashte");
  assert.deepEqual(verzamelBreuken(undefined, undefined), []);
});

test("oordeel: alleen wat op 26.04 breekt en op 24.04 niet, ligt aan 26.04", () => {
  const lijst = (...b) => JSON.stringify(b);
  assert.deepEqual(oordeel({ proef: lijst(), controle: "" }), { echt: [], ookOp2404: [], zonderControle: false, onbekend: false });
  // Live data die op beide faalt (bv. validate:data): geen breuk door 26.04.
  assert.deepEqual(oordeel({ proef: lijst("stap: check", "gereedschap: x"), controle: lijst("stap: check") }), {
    echt: ["gereedschap: x"], ookOp2404: ["stap: check"], zonderControle: false, onbekend: false,
  });
  assert.deepEqual(oordeel({ proef: lijst("stap: check"), controle: lijst("stap: check") }).echt, []);
  // Geen controle (die job gaf niets): alles telt, maar dat staat erbij.
  assert.deepEqual(oordeel({ proef: lijst("a"), controle: "" }), { echt: ["a"], ookOp2404: [], zonderControle: true, onbekend: false });
  // Geen uitkomst van de proef zelf: onbekend, en dus wel een alarm.
  assert.equal(oordeel({ proef: "", controle: "" }).onbekend, true);
  assert.equal(oordeel({ proef: "{kapot", controle: "" }).onbekend, true);
});

test("oordeel als stap: output echt en exitcode (zonder ::opdracht:: uit de breuknamen)", () => {
  const map = fs.mkdtempSync(path.join(os.tmpdir(), "droog-oordeel-"));
  try {
    const draai = (proef, controle) => {
      const output = path.join(map, `out-${Math.random()}`);
      const r = spawnSync(process.execPath, [new URL("../scripts/refresh-droog.mjs", import.meta.url).pathname, "oordeel"], {
        env: { ...process.env, PROEF: proef, CONTROLE: controle, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: "" },
        encoding: "utf8",
      });
      return { code: r.status, uit: r.stdout, output: fs.readFileSync(output, "utf8") };
    };
    const groen = draai("[]", "");
    assert.equal(groen.code, 0);
    assert.equal(groen.output, "echt=0\n");
    const ook = draai(JSON.stringify(["stap: check"]), JSON.stringify(["stap: check"]));
    assert.equal(ook.code, 0, "faalt ook op 24.04: geen breuk door 26.04");
    assert.equal(ook.output, "echt=0\n");
    const rood = draai(JSON.stringify(["gereedschap: ::error::nep"]), "[]");
    assert.equal(rood.code, 1);
    assert.equal(rood.output, "echt=1\n");
    for (const regel of rood.uit.split("\n").filter((r) => /^\s*::/.test(r))) assert.match(regel, /^::error title=Ubuntu-proef::/);
    const onbekend = draai("", "");
    assert.equal(onbekend.code, 1);
    assert.equal(onbekend.output, "echt=onbekend\n");
  } finally {
    fs.rmSync(map, { recursive: true, force: true });
  }
});

test("runnerFouten: elk GitHub-gehost label mag, self-hosted en eigen labels niet", () => {
  const wf = (runsOn, extra = "") => `name: x\non: push\njobs:\n  een:\n${extra}    runs-on: ${runsOn}\n    steps:\n      - run: echo\n`;
  for (const label of ["ubuntu-latest", "ubuntu-24.04", "ubuntu-26.04", "ubuntu-24.04-arm", "ubuntu-slim", "macos-latest", "macos-15", "macos-15-intel", "windows-2025", "windows-latest", "\"ubuntu-24.04\" # vastgezet"]) {
    assert.deepEqual(runnerFouten(wf(label)), [], label);
  }
  const matrix = (lijst) => `    strategy:\n      matrix:\n        os: ${lijst}\n`;
  assert.deepEqual(runnerFouten(wf("${{ matrix.os }}", matrix("[ubuntu-latest, macos-latest, windows-latest]"))), []);
  const include = "    strategy:\n      matrix:\n        include:\n          - runner: ubuntu-26.04\n          - runner: ubuntu-24.04\n";
  assert.deepEqual(runnerFouten(wf("${{ matrix.runner }}", include)), []);
  const blokLijst = "    strategy:\n      matrix:\n        os:\n          - ubuntu-latest\n          - macos-latest\n";
  assert.deepEqual(runnerFouten(wf("${{ matrix.os }}", blokLijst)), []);

  const fout = (tekst, re, wat) => {
    const f = runnerFouten(tekst);
    assert.ok(f.length > 0, `${wat}: verwacht een fout`);
    assert.match(f.join("\n"), re, wat);
    assert.match(f.join("\n"), /publiek|na te gaan/, `${wat}: de fout zegt waarom`);
  };
  fout(wf("self-hosted"), /self-hosted/, "self-hosted");
  fout(wf("[self-hosted, macOS, ARM64]"), /self-hosted/, "lijst met self-hosted");
  fout(wf("macOS"), /label "macOS" is geen GitHub-gehoste runner/, "label van een eigen Mac");
  fout(wf("mac-mini"), /label "mac-mini"/, "eigen label");
  fout(wf("", "") .replace("    runs-on: \n", "    runs-on:\n      group: eigen-groep\n"), /runnergroep/, "runnergroep");
  fout(wf("", "").replace("    runs-on: \n", "    runs-on:\n      labels: [mac-mini]\n"), /label "mac-mini"/, "labels in blokvorm");
  fout(wf("${{ matrix.os }}", matrix("[ubuntu-latest, mac-mini]")), /label "mac-mini"/, "eigen label in de matrix");
  fout(wf("${{ matrix.os }}"), /niet na te gaan/, "matrix zonder lijst");
  fout(wf("${{ inputs.runner }}"), /niet na te gaan/, "een andere expressie");
  assert.ok(!GEHOST_LABEL.test("ubuntu-latest\nself-hosted"));
});

test("ci.yml: de proefjob draait op ubuntu-26.04, mag falen en heeft alleen leesrechten", () => {
  const ci = lees(".github/workflows/ci.yml");
  const blok = jobBlok(ci, "ubuntu-2604-proef");
  assert.match(blok, /\n {4}runs-on: ubuntu-26\.04\n/);
  assert.match(blok, /\n {4}continue-on-error: true\n/);
  assert.match(blok, /\n {4}permissions:\n {6}contents: read\n/);
  assert.match(blok, /node scripts\/refresh-droog\.mjs gereedschap/);
  assert.match(blok, /node scripts\/refresh-droog\.mjs verversing/);
  assert.doesNotMatch(blok, /secrets\.|vars\./, "geen geheimen of variabelen in de proef");
  // Bij elke PR geen tweede keer alle bronnen ophalen; na een merge op main wel.
  assert.match(blok, /DROOG_ZONDER_OPHALEN: \$\{\{ github\.event_name == 'pull_request' && '1' \|\| '' \}\}/);
  assert.match(blok, /\n {4}outputs:\n {6}breuken: \$\{\{ steps\.breuken\.outputs\.lijst \}\}\n/);
  assert.match(blok, /id: breuken\n {8}if: \$\{\{ always\(\) \}\}\n {8}env:\n {10}STAPPEN: \$\{\{ toJSON\(steps\) \}\}\n {8}run: node scripts\/refresh-droog\.mjs breuken/);
});

test("ci.yml: controle op 24.04 alleen bij een breuk, oordeel, en een alarm-issue alleen na een push naar main", () => {
  const ci = lees(".github/workflows/ci.yml");
  const controle = jobBlok(ci, "ubuntu-2404-controle");
  assert.match(controle, /\n {4}runs-on: ubuntu-24\.04\n/);
  assert.match(controle, /\n {4}if: \$\{\{ !cancelled\(\) && needs\.ubuntu-2604-proef\.outputs\.breuken != '\[\]' \}\}\n/);
  assert.match(controle, /\n {4}continue-on-error: true\n/);
  assert.match(controle, /\n {4}permissions:\n {6}contents: read\n/);
  // Dezelfde stappen als de proef, zodat de vergelijking klopt.
  const stappen = (blok) => [...blok.matchAll(/^ {8}run: (node scripts\/refresh-droog\.mjs \w+|npm .+)$/gm)].map((m) => m[1]);
  assert.deepEqual(stappen(controle), stappen(jobBlok(ci, "ubuntu-2604-proef")));

  const oordeelJob = jobBlok(ci, "ubuntu-2604-oordeel");
  assert.match(oordeelJob, /\n {4}needs: \[ubuntu-2604-proef, ubuntu-2404-controle\]\n {4}if: \$\{\{ !cancelled\(\) \}\}\n/);
  assert.match(oordeelJob, /PROEF: \$\{\{ needs\.ubuntu-2604-proef\.outputs\.breuken \}\}/);
  assert.match(oordeelJob, /CONTROLE: \$\{\{ needs\.ubuntu-2404-controle\.outputs\.breuken \}\}/);
  assert.match(oordeelJob, /\n {4}continue-on-error: true\n/);
  assert.match(oordeelJob, /\n {4}permissions:\n {6}contents: read\n {4}outputs:/);

  const alarm = jobBlok(ci, "ubuntu-2604-alarm");
  assert.match(alarm, /\n {4}if: \$\{\{ !cancelled\(\) && github\.event_name == 'push' && github\.ref == 'refs\/heads\/main' && needs\.ubuntu-2604-oordeel\.outputs\.echt != '0' \}\}\n/);
  assert.match(alarm, /\n {4}continue-on-error: true\n/);
  assert.match(alarm, /\n {4}permissions:\n {6}issues: write\n {4}steps:/, "alleen issues, geen contents");
  assert.doesNotMatch(alarm, /actions\/checkout|node scripts|npm /, "geen code van de repo met een schrijftoken");
  assert.match(alarm, /ECHT: \$\{\{ needs\.ubuntu-2604-oordeel\.outputs\.echt \}\}/, "uitkomst via env, niet in het script geplakt");
  assert.doesNotMatch(alarm.slice(alarm.indexOf("run: |")), /\$\{\{/, "geen expressies in het run-blok");
  assert.match(alarm, /gh issue comment "\$num"/);
  assert.match(alarm, /gh issue create --title "\$title"/);
});
