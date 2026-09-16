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

test("de bron- en provenanceprojecties bevatten dezelfde 133 deterministische rijen", () => {
  assert.equal(actual.snapshot.sourceItemCount, 133);
  assert.deepEqual(actual.diff.counts, { add: 0, change: 0, remove: 0, unchanged: 133 });
  assert.equal(actual.diff.sourceDigest, actual.diff.matrixDigest);
});

test("de gegenereerde snapshot en diff zijn exact actueel", () => {
  const snapshotDate = engine.config.classificationAsOf.replaceAll("-", "");
  const snapshot = JSON.parse(fs.readFileSync(path.join(rootDir, "audit", `provenance-source-snapshot-${snapshotDate}.json`), "utf8"));
  const diff = JSON.parse(fs.readFileSync(path.join(rootDir, "audit", `provenance-source-diff-${snapshotDate}.json`), "utf8"));
  assert.deepEqual(snapshot, actual.snapshot);
  assert.deepEqual(diff, actual.diff);
});
