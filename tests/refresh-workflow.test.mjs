// De workflow zelf draait alleen op GitHub; deze toets bewaakt de twee afspraken uit #35:
// de late cron ververst niet opnieuw als de live agenda al vers is, en één bron met een
// tijdelijke fout (503) maakt de bronstatus niet rood zolang haar vorige data binnen maxAgeHours valt.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { isTransientErrorCode } from "../lib/fetch-util.mjs";

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
function alarmLoopt(uitkomst, event = "schedule") {
  const expressie = ifOf(jobBlock("alarm"))
    .replace(/always\(\)/g, "true")
    .replace(/github\.event_name/g, JSON.stringify(event))
    .replace(/needs\.([a-z-]+)\.result/g, (_, job) => JSON.stringify(uitkomst[job] ?? "success"))
    .replace(/([!=])=/g, "$1==")
    .replace(/'/g, '"');
  // Alleen nog letterlijke waarden en operatoren: niets anders wordt uitgevoerd.
  assert.match(expressie, /^[\s"a-z_()=!&|]+$/, expressie);
  return Function(`"use strict"; return (${expressie});`)();
}

test("alarm: loopt ook als alleen source-health faalt, bij een geplande run", () => {
  assert.deepEqual(needsOf(jobBlock("alarm")).sort(), ["freshness", "publish-branch", "refresh", "source-health"]);
  assert.equal(alarmLoopt({}), false, "alles groen: geen alarm");
  assert.equal(alarmLoopt({ "source-health": "failure" }), true, "alleen source-health rood: wel alarm");
  for (const job of ["refresh", "publish-branch", "freshness"]) assert.equal(alarmLoopt({ [job]: "failure" }), true, job);
  // Overgeslagen of geannuleerd is geen rode bronstatus; een dispatch van de Gateway opent nooit een alarm.
  assert.equal(alarmLoopt({ "source-health": "skipped" }), false);
  assert.equal(alarmLoopt({ "source-health": "cancelled" }), false);
  assert.equal(alarmLoopt({ "source-health": "failure" }, "workflow_dispatch"), false);
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
