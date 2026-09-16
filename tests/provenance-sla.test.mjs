import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadExpandedAgendaItems, loadRefreshEngine } from "../scripts/agenda-source.mjs";
import { buildProvenanceSlaMatrix } from "../scripts/provenance-sla.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engine = loadRefreshEngine(rootDir);
const matrix = buildProvenanceSlaMatrix(loadExpandedAgendaItems(rootDir), engine);

test("de SLA-matrix bevat elk van de 133 bronitems exact één keer", () => {
  assert.equal(matrix.sourceItemCount, 133);
  assert.equal(matrix.items.length, 133);
  assert.equal(new Set(matrix.items.map((item) => item.id)).size, 133);
});

test("publiceerbaarheid blijft fail-closed bij verlopen of onbewezen bronnen", () => {
  for (const item of matrix.items) {
    assert.equal(item.includedInLocalCandidate, item.publishEligible);
    if (item.publishEligible) {
      assert.ok(["current", "future"].includes(item.classification));
      assert.equal(item.verificationState, "verified");
      assert.equal(item.slaStatus, "fresh_verified");
      assert.equal(item.failClosed, false);
    } else {
      assert.equal(item.failClosed, true);
    }
  }
});

test("elke bewezen bron heeft een geldige HTTPS-provenance en expliciete vervaldatum", () => {
  for (const item of matrix.items.filter((candidate) => candidate.verificationState === "verified")) {
    assert.match(item.canonicalSourceUrl, /^https:\/\//);
    assert.ok(item.sourceRetrievedAt);
    if (["current", "future"].includes(item.classification)) {
      assert.ok(item.maxAgeDays > 0);
      assert.match(item.recheckDueOn, /^2026-\d{2}-\d{2}$/);
    }
  }
});

test("onzekere sportreeksen blijven geblokkeerd, ook nadat hun datum verstreken is", () => {
  for (const title of ["Sportinitiaties met Jespo", "Gratis initiaties boogschieten"]) {
    const rows = matrix.items.filter((item) => item.title === title);
    const uncertainRows = rows.filter((item) => item.verificationState === "review_required");
    assert.ok(rows.length > 0);
    assert.ok(rows.every((item) => !item.publishEligible));
    assert.ok(uncertainRows.length > 0);
    assert.ok(uncertainRows.every((item) => item.slaStatus === "blocked_review_required"));
  }
});

test("de actuele wegenwerkfase is publiceerbaar met verse provenance", () => {
  const row = matrix.items.find(
    (item) => item.title === "Heraanleg Van Maerlantstraat en Vondelstraat - fase 2"
  );
  assert.equal(row.classification, "current");
  assert.equal(row.slaStatus, "fresh_verified");
  assert.equal(row.publishEligible, true);
  assert.equal(row.sourceId, "city-osystraat-works");
});
