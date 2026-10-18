// De workflow zelf draait alleen op GitHub; deze toets bewaakt de twee afspraken uit #35:
// de late cron ververst niet opnieuw als de live agenda al vers is, en één bron met een
// tijdelijke fout (503) maakt de bronstatus niet rood zolang haar vorige data binnen maxAgeHours valt.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { isTransientErrorCode } from "../lib/fetch-util.mjs";
import { leesWerkstroom } from "../scripts/refresh-droog.mjs";

const workflow = fs.readFileSync(new URL("../.github/workflows/refresh.yml", import.meta.url), "utf8");

test("de geplande run slaat de verversing over als de live agenda jonger is dan 20 uur", () => {
  assert.match(workflow, /\n  al-vers:\n/);
  assert.match(workflow, /-lt \$\(\(20 \* 3600\)\)/);
  assert.match(workflow, /needs\.al-vers\.outputs\.fresh != 'true'/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch' \|\|/, "een dispatch van de Gateway ververst altijd");
});

test("source-health: dezelfde tijdelijke foutcodes als sourceHealthOf, als waarschuwing", () => {
  assert.match(workflow, /title=Bron stale::/);
  const codes = ["http_503", "http_500", "http_429", "timeout", "network_error", "source_timeout", "refresh_budget_exhausted", "body_read_failed"];
  for (const code of codes) assert.equal(isTransientErrorCode(code), true, code);
  assert.match(workflow, /\^http_\(5\[0-9\]\[0-9\]\|429\)\$/);
  assert.match(workflow, /\^\(timeout\|network_error\|source_timeout\|refresh_budget_exhausted\|body_read_failed\)\$/);
});

// Run 37449498793 (6-10-2026): een workflow_dispatch van de Gateway ververste wel, maar
// publish-branch en source-health werden overgeslagen. al-vers draait alleen bij de cron en
// is bij een dispatch "skipped"; zonder statusfunctie in de if neemt GitHub dat over voor elke
// job verderop in de keten. Dan komt er nooit een datatak en blijft een verouderde PR liggen.
function jobBlock(name) {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `job ${name} ontbreekt`);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n  [a-z][a-z-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}
const needsOf = (block) => {
  const line = block.match(/\n    needs: (.+)\n/)?.[1] ?? "";
  return line.replace(/[[\]]/g, "").split(",").map((v) => v.trim()).filter(Boolean);
};
const ifOf = (block) => {
  const match = block.match(/\n    if: (?:>-\n((?:      .*\n)+)|(.+)\n)/);
  return match ? (match[1] ?? match[2]).replace(/\s+/g, " ").trim() : "";
};

test("elke job achter al-vers heeft een statusfunctie, zodat een dispatch een datatak maakt", () => {
  const jobs = [...workflow.matchAll(/\n  ([a-z][a-z-]*):\n    /g)].map((m) => m[1]);
  const achterAlVers = new Set(["al-vers"]);
  let groeit = true;
  while (groeit) {
    groeit = false;
    for (const job of jobs) {
      if (achterAlVers.has(job)) continue;
      if (needsOf(jobBlock(job)).some((n) => achterAlVers.has(n))) { achterAlVers.add(job); groeit = true; }
    }
  }
  achterAlVers.delete("al-vers");
  assert.ok(achterAlVers.has("publish-branch") && achterAlVers.has("source-health"));
  for (const job of achterAlVers) {
    assert.match(ifOf(jobBlock(job)), /!cancelled\(\)|always\(\)/, `${job} mist !cancelled() of always()`);
  }
  assert.match(ifOf(jobBlock("publish-branch")), /needs\.refresh\.result == 'success'/);
  assert.match(ifOf(jobBlock("publish-branch")), /needs\.refresh\.outputs\.changed == 'true'/);
});

// Besluit van de eigenaar (18-10-2026): de site zegt bezoekers niet meer dat een bron faalt. Dan is een rode
// source-health het enige signaal voor de eigenaar, en die alleen opende of vulde geen alarm-issue. Nu loopt de job
// alarm ook als alleen source-health faalt, op dezelfde manier: één bestaand alarm-issue aanvullen, geen nieuw per nacht.
// De voorwaarde van de job, uitgerekend voor verzonnen uitkomsten van de jobs ervoor.
// `ref`: de tak waarvan de run start (github.ref); een geplande run start altijd van de standaardtak.
function alarmLoopt(uitkomst, event = "schedule", reason = "", ref = "refs/heads/main") {
  const expressie = ifOf(jobBlock("alarm"))
    .replace(/always\(\)/g, "true")
    .replace(/github\.event_name/g, JSON.stringify(event))
    .replace(/github\.ref/g, JSON.stringify(ref))
    .replace(/inputs\.reason/g, JSON.stringify(event === "workflow_dispatch" ? reason : ""))
    .replace(/needs\.([a-z-]+)\.result/g, (_, job) => JSON.stringify(uitkomst[job] ?? "success"))
    .replace(/([!=])=/g, "$1==")
    .replace(/'/g, '"');
  // Alleen nog letterlijke waarden en operatoren: niets anders wordt uitgevoerd.
  assert.match(expressie, /^[\s"a-z0-9_()=!&|/-]+$/, expressie);
  return Function(`"use strict"; return (${expressie});`)();
}

test("alarm: loopt ook als alleen source-health faalt, bij een geplande run", () => {
  assert.deepEqual(needsOf(jobBlock("alarm")).sort(), ["freshness", "publish-branch", "refresh", "source-health"]);
  assert.equal(alarmLoopt({}), false, "alles groen: geen alarm");
  assert.equal(alarmLoopt({ "source-health": "failure" }), true, "alleen source-health rood: wel alarm");
  for (const job of ["refresh", "publish-branch", "freshness"]) assert.equal(alarmLoopt({ [job]: "failure" }), true, job);
  // Overgeslagen of geannuleerd is geen rode bronstatus.
  assert.equal(alarmLoopt({ "source-health": "skipped" }), false);
  assert.equal(alarmLoopt({ "source-health": "cancelled" }), false);
});

// Nakijkbevinding (18-10-2026): de echte verversing start de Gateway elke ochtend om 05:17 met workflow_dispatch; de
// cron komt 5 tot 8 uur later, ziet een live agenda jonger dan 20 uur (al-vers) en slaat refresh en dus ook
// source-health over. Liep alarm alleen bij een geplande run, dan kwam er bij een rode bronstatus nooit een issue: zo
// bleef het 15 tot 18 oktober (eBesluit rood), met deze uitkomsten van de echte runs.
test("alarm: een rode bronstatus in de ochtendverversing van de Gateway (workflow_dispatch) geeft een alarm-issue", () => {
  const dispatch = { refresh: "success", "publish-branch": "success", "source-health": "failure", freshness: "success" }; // run 39093073261
  const lateCron = { refresh: "skipped", "publish-branch": "skipped", "source-health": "skipped", freshness: "success" }; // run 39109714672
  assert.equal(alarmLoopt(lateCron, "schedule"), false, "de late cron ziet de bronstatus niet");
  for (const reason of ["handmatig", "brain"]) assert.equal(alarmLoopt(dispatch, "workflow_dispatch", reason), true, reason);
  // Dezelfde voorwaarden als bij de cron: elke rode schakel, nooit groen, overgeslagen of geannuleerd.
  for (const job of ["refresh", "publish-branch", "freshness"]) assert.equal(alarmLoopt({ [job]: "failure" }, "workflow_dispatch", "handmatig"), true, job);
  assert.equal(alarmLoopt({}, "workflow_dispatch", "handmatig"), false, "alles groen: geen alarm");
  assert.equal(alarmLoopt({ "source-health": "skipped" }, "workflow_dispatch", "handmatig"), false);
  // Een proefrun (aanleiding "test") opent geen alarm.
  assert.equal(alarmLoopt(dispatch, "workflow_dispatch", "test"), false);
  assert.equal(alarmLoopt(dispatch, "push"), false, "alleen de cron en een dispatch");
  // Het issue zegt welke run het was, niet altijd "Geplande run"; de aanleiding komt via env.
  const blok = jobBlock("alarm"), run = blok.slice(blok.indexOf("run: |"));
  assert.match(blok, /EVENT: \$\{\{ github\.event_name \}\}/);
  assert.match(blok, /REASON: \$\{\{ inputs\.reason \}\}/);
  assert.doesNotMatch(run, /Geplande run van/);
  assert.match(run, /\$\{EVENT\}/);
});

// Nakijkronde 3 (18-10-2026), bevinding LAAG: sinds het alarm ook bij een dispatch loopt, keek het niet naar de tak. Een
// handmatige run vanaf een andere tak (aanleiding handmatig of brain) laat refresh bewust falen (stap "Alleen vanaf main"),
// en opende of vulde zo toch het alarm-issue. Het alarm loopt alleen vanaf de standaardtak (refs/heads/main).
test("alarm: alleen vanaf de standaardtak (refs/heads/main), ook bij een dispatch", () => {
  assert.match(ifOf(jobBlock("alarm")), /github\.ref == 'refs\/heads\/main'/);
  const rood = { refresh: "failure", "publish-branch": "skipped", "source-health": "skipped", freshness: "success" };
  for (const ref of ["refs/heads/claude/proef", "refs/heads/data/refresh-20990310-1", "refs/tags/v1", "refs/pull/1/merge"]) {
    for (const reason of ["handmatig", "brain"]) assert.equal(alarmLoopt(rood, "workflow_dispatch", reason, ref), false, `${reason} vanaf ${ref}`);
    assert.equal(alarmLoopt({ "source-health": "failure" }, "workflow_dispatch", "handmatig", ref), false, ref);
  }
  // Vanaf main blijft alles zoals het was.
  assert.equal(alarmLoopt(rood, "workflow_dispatch", "handmatig", "refs/heads/main"), true);
  assert.equal(alarmLoopt({ "source-health": "failure" }, "schedule", "", "refs/heads/main"), true);
  // De stap "Alleen vanaf main" in refresh kijkt naar dezelfde tak.
  assert.match(jobBlock("refresh"), /if \[ "\$GITHUB_REF" != "refs\/heads\/main" \]; then/);
});

test("alarm: één alarm-issue met een vaste titel, aangevuld met een reactie; alleen een nieuw issue als er geen open is", () => {
  const blok = jobBlock("alarm");
  assert.match(blok, /\n    runs-on: ubuntu-latest\n/, "nooit op een self-hosted runner");
  assert.doesNotMatch(workflow, /self-hosted/);
  assert.match(blok, /\n    permissions:\n      issues: write\n    steps:/, "alleen issues");
  assert.doesNotMatch(blok, /actions\/checkout|node scripts|npm /, "geen code van de repo met een schrijftoken");
  const run = blok.slice(blok.indexOf("run: |"));
  assert.doesNotMatch(run, /\$\{\{/, "uitkomsten via env, niet in het script geplakt");
  // Dezelfde titel als voorheen: een open alarm-issue van vroeger wordt aangevuld, er komt er geen tweede bij.
  assert.match(run, /title="Alarm: agendaverversing of live versheid faalt"/);
  assert.match(run, /gh issue list --state open --search "\\"\$\{title\}\\" in:title"/);
  assert.match(run, /select\(\.title == \\"\$\{title\}\\"\)/);
  const comment = run.indexOf('gh issue comment "$num"'), create = run.indexOf('gh issue create --title "$title"'), anders = run.indexOf("else");
  assert.ok(comment > 0 && create > anders && anders > comment, "eerst aanvullen; alleen anders een nieuw issue");
  // De uitkomst van source-health staat in het issue.
  assert.match(blok, /R_HEALTH: \$\{\{ needs\.source-health\.result \}\}/);
  assert.match(run, /"- bronstatus: \$\{R_HEALTH\}"/);
  // Het issue zegt niet meer dat bezoekers een melding zien (besluit van 18-10-2026).
  assert.doesNotMatch(run, /vriendelijke melding/);
});

// Een fout van eBesluit draagt haar fase in de foutcode (search_<code> of detail_<code>, metFase in
// lib/ebesluit-discovery.mjs). De stap "Elke bron gezond" van source-health draait hier echt (bash en jq, met een
// verzonnen refresh-status.json): een tijdelijke fout met fase blijft een waarschuwing binnen maxAgeHours, zoals
// isTransientErrorCode zegt, en de melding noemt de hele code, zodat de run zegt waar eBesluit faalt.
test("source-health: de fase van een eBesluit-fout telt niet voor de vergelijking, en staat wel in de melding", { skip: spawnSync("bash", ["-c", "command -v jq"]).status === 0 ? false : "bash of jq ontbreekt" }, () => {
  const stap = leesWerkstroom(workflow).get("source-health").steps.find((s) => s.name === "Elke bron gezond");
  assert.ok(stap?.run, "stap Elke bron gezond");
  const draai = (bronnen) => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "source-health-"));
    try {
      fs.mkdirSync(path.join(temp, "in"));
      fs.writeFileSync(path.join(temp, "in", "refresh-status.json"), JSON.stringify({ sources: bronnen }));
      // De stand van de live lagen (tests/live-lagen-alarm.test.mjs): hier geen, zodat alleen de bronnen tellen.
      fs.writeFileSync(path.join(temp, "in", "live-lagen.json"), JSON.stringify({ lagen: [] }));
      const uit = spawnSync("bash", ["-c", stap.run], { env: { ...process.env, RUNNER_TEMP: temp }, encoding: "utf8" });
      return { code: uit.status, tekst: uit.stdout };
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  };
  const recent = new Date(Date.now() - 2 * 3_600_000).toISOString();
  const oud = new Date(Date.now() - 60 * 3_600_000).toISOString();
  const fout = (sourceId, errorCode, retrievedAt = recent) => ({ sourceId, fetchStatus: "error", retrievedAt, errorCode, maxAgeHours: 48 });
  for (const errorCode of ["search_http_500", "detail_http_500", "http_500", "channel_http_503"]) {
    const { code, tekst } = draai([fout("district-ebesluit", errorCode)]);
    assert.equal(code, 0, `${errorCode}: ${tekst}`);
    assert.equal(isTransientErrorCode(errorCode), true, errorCode);
    assert.match(tekst, new RegExp(`stale \\(${errorCode}\\)`), tekst);
  }
  // Blijvend, of te oud: rood, met de hele code in de regel.
  for (const [errorCode, retrievedAt] of [["detail_http_404", recent], ["search_incomplete", recent], ["search_http_500", oud]]) {
    const { code, tekst } = draai([fout("district-ebesluit", errorCode, retrievedAt)]);
    assert.equal(code, 1, `${errorCode}: ${tekst}`);
    assert.match(tekst, new RegExp(`BRON district-ebesluit: fetchStatus error \\(${errorCode}\\)`), tekst);
  }
});
