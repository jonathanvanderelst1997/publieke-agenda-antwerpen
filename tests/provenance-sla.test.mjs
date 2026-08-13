import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadExpandedAgendaItems, loadRefreshEngine } from "../scripts/agenda-source.mjs";
import { buildProvenanceSlaMatrix } from "../scripts/provenance-sla.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engine = loadRefreshEngine(rootDir);
const matrix = buildProvenanceSlaMatrix(loadExpandedAgendaItems(rootDir), engine);

test("de SLA-matrix bevat elk van de 132 bronitems exact één keer", () => {
  assert.equal(matrix.sourceItemCount, 132);
  assert.equal(matrix.items.length, 132);
  assert.equal(new Set(matrix.items.map((item) => item.id)).size, 132);
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

test("onzekere toekomstige sportreeksen blijven geblokkeerd", () => {
  for (const title of ["Sportinitiaties met Jespo", "Gratis initiaties boogschieten"]) {
    const futureRows = matrix.items.filter((item) => item.title === title && item.eventDate >= matrix.classificationAsOf);
    assert.ok(futureRows.length > 0);
    assert.ok(futureRows.every((item) => item.slaStatus === "blocked_review_required"));
    assert.ok(futureRows.every((item) => !item.publishEligible));
  }
});

test("de officieel bevestigde 3x3-reeks is publiceerbaar met verse provenance", () => {
  const futureRows = matrix.items.filter((item) => item.title === "3x3 basket" && item.eventDate > matrix.classificationAsOf);
  assert.equal(futureRows.length, 2);
  assert.ok(futureRows.every((item) => item.slaStatus === "fresh_verified"));
  assert.ok(futureRows.every((item) => item.publishEligible));
  assert.ok(futureRows.every((item) => item.sourceId === "city-3x3-summer-2026"));
});
