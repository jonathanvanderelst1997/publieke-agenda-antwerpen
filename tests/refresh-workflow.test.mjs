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
