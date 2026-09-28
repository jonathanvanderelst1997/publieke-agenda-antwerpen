import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";

import { checkDataLane } from "../lib/data-lane.mjs";

const specText = fs.readFileSync(new URL("../lib/data-lane-paths.json", import.meta.url), "utf8");
const spec = JSON.parse(specText);
const allowed = (lines) => checkDataLane(lines, spec).length === 0;

const POSITIVES = [
  "site/sources/x.json",
  "site/agenda-feed.js",
  "site/event/a-b/index.html",
  "audit/provenance-source-diff-latest.json",
  "audit/provenance-source-snapshot-latest.json",
  "audit/provenance-expiry-sla.json",
  "audit/provenance-expiry-sla.md",
  "site/public-agenda-manifest.json",
  "site/sitemap.xml",
  "EVENT_CONTRACT_REPORT.json",
];
const NEGATIVES = [
  "site/agenda.js",
  "site/agenda-refresh.js",
  "site/works-snapshot.js",
  "site/sources/x.json.js",
  "lib/data-lane-paths.json",
  "package.json",
  ".github/workflows/ci.yml",
  "render.yaml",
  "site/sources/../agenda.js",
  "site/event/A-B/index.html",
  "audit/provenance-source-snapshot-20260928.json",
];

test("de lijst met toegelaten paden parseert en heeft de afgesproken vorm", () => {
  assert.equal(spec.schemaVersion, 1);
  assert.equal(spec.allowed.length, 8);
  assert.deepEqual(spec.deletableUnder, ["site/event/"]);
  for (const pattern of spec.allowed) {
    assert.ok(pattern.startsWith("^") && pattern.endsWith("$"), pattern);
    // POSIX-ERE: geen \d, \w, \s, lookarounds of luie kwantoren.
    assert.doesNotMatch(pattern, /\\[dwsbDWSB]|\(\?|\*\?|\+\?/, pattern);
  }
});

test("data-paden zijn toegelaten", () => {
  for (const file of POSITIVES) assert.ok(allowed([`M\t${file}`]), file);
  assert.ok(allowed(["A\tsite/sources/district-kalender.json", "D\tsite/event/oud-item-2026-09-01/index.html", "M\tsite/agenda-feed.js"]));
});

test("code, configuratie en werkflows zijn niet toegelaten", () => {
  for (const file of NEGATIVES) assert.ok(!allowed([`M\t${file}`]), file);
  const violations = checkDataLane(["M\tsite/agenda.js", "M\tsite/sources/x.json"], spec);
  assert.deepEqual(violations, [{ code: "path_not_allowed", status: "M", path: "site/agenda.js" }]);
});

test("verwijderen mag alleen onder site/event/; een lege wijziging faalt", () => {
  assert.deepEqual(checkDataLane(["D\tsite/sources/x.json"], spec), [{ code: "delete_not_allowed", status: "D", path: "site/sources/x.json" }]);
  assert.ok(!allowed(["R100\tsite/sources/a.json\tsite/sources/b.json"]), "een hernoeming verwijdert buiten site/event/");
  assert.deepEqual(checkDataLane([], spec), [{ code: "empty_change", status: "", path: "" }]);
  assert.deepEqual(checkDataLane(["", "   "], spec), [{ code: "empty_change", status: "", path: "" }]);
  assert.ok(!allowed(["X\tsite/sources/x.json"]));
});

test("de reguliere expressies gedragen zich in bash [[ =~ ]] net zo", { skip: spawnSync("bash", ["-c", "true"]).status !== 0 }, () => {
  for (const [file, expected] of [...POSITIVES.map((file) => [file, true]), ...NEGATIVES.filter((file) => !file.includes("..")).map((file) => [file, false])]) {
    const script = 'm=1; for re in "${@:2}"; do if [[ "$1" =~ $re ]]; then m=0; fi; done; exit $m';
    const result = spawnSync("bash", ["-c", script, "_", file, ...spec.allowed]);
    assert.equal(result.status === 0, expected, file);
  }
});

test("de CLI geeft één regel per schending en exitcode 1", () => {
  const ok = spawnSync(process.execPath, ["scripts/check-data-lane.mjs"], { input: "M\tsite/sources/x.json\n", encoding: "utf8", cwd: new URL("..", import.meta.url) });
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout, "");
  const bad = spawnSync(process.execPath, ["scripts/check-data-lane.mjs"], { input: "M\tsite/agenda.js\nD\tsite/sources/x.json\n", encoding: "utf8", cwd: new URL("..", import.meta.url) });
  assert.equal(bad.status, 1);
  assert.deepEqual(bad.stdout.trim().split("\n"), ["path_not_allowed\tM\tsite/agenda.js", "delete_not_allowed\tD\tsite/sources/x.json"]);
  const empty = spawnSync(process.execPath, ["scripts/check-data-lane.mjs"], { input: "", encoding: "utf8", cwd: new URL("..", import.meta.url) });
  assert.equal(empty.status, 1);
  assert.match(empty.stdout, /^empty_change/);
});
