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
  "site/history/live-layers.json",
  "site/history/radar.json",
  "site/straat/1416.json",
  "site/straat-index.json",
  "site/geo/locaties.json",
  "site/history/archive/baseline.json",
  "site/history/archive/index.json",
  "site/history/archive/2026-10-01.json",
  "site/history/backfill/index.json",
  "site/agenda-feed.js",
  "site/event/a-b/index.html",
  "site/verleden/maanden.json",
  "site/verleden/2026-11.json",
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
  "site/geo/wijken.geo.json",
  "site/geo/other.json",
  "site/sources/x.json.js",
  "site/history/other.json",
  "site/straat/kammenstraat.json",
  "site/straat/1416.js",
  "site/straat/1416/index.json",
  "site/straat/radar.json",
  "site/straat/index.json",
  "site/straat-index.js",
  "site/history/archive/20261001.json",
  "site/history/archive/oud.json",
  "site/history/backfill/gipod/2020.json",
  "site/history/backfill/asign-parking/20x0.json",
  // Geen historiek van parkeerverboden (besluit van de eigenaar van 3 november 2026): de verversing schrijft nooit een
  // backfill van de A-Sign-parkeerverboden.
  "site/history/backfill/asign-parking/2019.json",
  "site/history/backfill/asign-parking/index.json",
  "lib/data-lane-paths.json",
  "package.json",
  ".github/workflows/ci.yml",
  "render.yaml",
  "site/sources/../agenda.js",
  "site/event/A-B/index.html",
  "site/verleden/index.html",
  "site/verleden/2026-13.json",
  "site/verleden/2026-11-03.json",
  "site/verleden/parkeerverboden.json",
  "site/agenda-verleden.js",
  "audit/provenance-source-snapshot-20260928.json",
];

test("de lijst met toegelaten paden parseert en heeft de afgesproken vorm", () => {
  assert.equal(spec.schemaVersion, 1);
  assert.equal(spec.allowed.length, 17);
  assert.ok(spec.allowed.every((pattern) => !/park/i.test(pattern)), "geen pad voor een parkeerhistoriek");
  // Geen eventpagina wissen (besluit van de eigenaar van 3 november 2026): wat ooit in de agenda stond, blijft staan.
  assert.deepEqual(spec.deletableUnder, ["site/straat/"]);
  for (const pattern of spec.allowed) {
    assert.ok(pattern.startsWith("^") && pattern.endsWith("$"), pattern);
    // POSIX-ERE: geen \d, \w, \s, lookarounds of luie kwantoren.
    assert.doesNotMatch(pattern, /\\[dwsbDWSB]|\(\?|\*\?|\+\?/, pattern);
  }
});

test("data-paden zijn toegelaten", () => {
  for (const file of POSITIVES) assert.ok(allowed([`M\t${file}`]), file);
  assert.ok(allowed(["A\tsite/sources/district-kalender.json", "A\tsite/event/nieuw-item-2026-12-01/index.html", "M\tsite/event/oud-item-2026-09-01/index.html", "M\tsite/agenda-feed.js"]));
  assert.ok(allowed(["M\tsite/verleden/maanden.json", "M\tsite/verleden/2026-11.json", "A\tsite/verleden/2027-06.json"]));
  // Een straat zonder items verliest haar bestand (scripts/build-straat-snapshots.mjs).
  assert.ok(allowed(["A\tsite/straat/2289.json", "D\tsite/straat/1416.json", "M\tsite/straat-index.json", "M\tsite/history/radar.json"]));
});

test("code, configuratie en werkflows zijn niet toegelaten", () => {
  for (const file of NEGATIVES) assert.ok(!allowed([`M\t${file}`]), file);
  const violations = checkDataLane(["M\tsite/agenda.js", "M\tsite/sources/x.json"], spec);
  assert.deepEqual(violations, [{ code: "path_not_allowed", status: "M", path: "site/agenda.js" }]);
});

test("verwijderen mag alleen onder site/straat/; een lege wijziging faalt", () => {
  assert.deepEqual(checkDataLane(["D\tsite/sources/x.json"], spec), [{ code: "delete_not_allowed", status: "D", path: "site/sources/x.json" }]);
  assert.ok(!allowed(["R100\tsite/sources/a.json\tsite/sources/b.json"]), "een hernoeming verwijdert buiten site/straat/");
  // Het verleden van de agenda (lib/agenda-verleden.mjs): een eventpagina of een maand van het verleden wist de
  // verversing nooit, ook niet als hernoeming (git diff -M0 toont een gewiste en een nieuwe pagina als R).
  assert.deepEqual(checkDataLane(["D\tsite/event/oud-item-2026-09-01/index.html"], spec), [{ code: "delete_not_allowed", status: "D", path: "site/event/oud-item-2026-09-01/index.html" }]);
  assert.ok(!allowed(["R067\tsite/event/markt-ma7-2026-11-02/index.html\tsite/event/markt-ma7-2027-05-03/index.html"]));
  assert.ok(!allowed(["D\tsite/verleden/2026-11.json"]));
  assert.deepEqual(checkDataLane(["D\tsite/history/radar.json"], spec), [{ code: "delete_not_allowed", status: "D", path: "site/history/radar.json" }]);
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
