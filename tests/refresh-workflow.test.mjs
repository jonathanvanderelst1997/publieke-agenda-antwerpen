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
