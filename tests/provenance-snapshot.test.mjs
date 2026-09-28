import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadExpandedAgendaItems, loadRefreshEngine } from "../scripts/agenda-source.mjs";
import { buildProvenanceSlaMatrix } from "../scripts/provenance-sla.mjs";
import { buildProvenanceSnapshot } from "../scripts/provenance-snapshot.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const items = loadExpandedAgendaItems(rootDir);
const engine = loadRefreshEngine(rootDir);
const matrix = buildProvenanceSlaMatrix(items, engine);
const actual = buildProvenanceSnapshot(items, engine, matrix);

test("de bron- en provenanceprojecties bevatten dezelfde deterministische rijen als er items geladen zijn", () => {
  assert.equal(actual.snapshot.sourceItemCount, items.length);
  assert.deepEqual(actual.diff.counts, { add: 0, change: 0, remove: 0, unchanged: items.length });
  assert.equal(actual.diff.sourceDigest, actual.diff.matrixDigest);
});

test("de gegenereerde snapshot en diff (vaste -latest-bestanden) zijn exact actueel", () => {
  const snapshot = JSON.parse(fs.readFileSync(path.join(rootDir, "audit", "provenance-source-snapshot-latest.json"), "utf8"));
  const diff = JSON.parse(fs.readFileSync(path.join(rootDir, "audit", "provenance-source-diff-latest.json"), "utf8"));
  assert.deepEqual(snapshot, JSON.parse(JSON.stringify(actual.snapshot)));
  assert.deepEqual(diff, JSON.parse(JSON.stringify(actual.diff)));
  assert.equal(snapshot.classificationAsOf, engine.config.classificationAsOf);
});

test("oudere snapshots met een datum blijven als historiek staan", () => {
  for (const date of ["20260811", "20260813", "20260916"]) {
    assert.ok(fs.existsSync(path.join(rootDir, "audit", `provenance-source-snapshot-${date}.json`)), date);
  }
});
