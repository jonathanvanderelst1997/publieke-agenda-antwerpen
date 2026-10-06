import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadExpandedAgendaItems, loadRefreshEngine } from "../scripts/agenda-source.mjs";
import { buildProvenanceSlaMatrix } from "../scripts/provenance-sla.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engine = loadRefreshEngine(rootDir);
const items = loadExpandedAgendaItems(rootDir);
const matrix = buildProvenanceSlaMatrix(items, engine);

function addDays(value, days) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test("de SLA-matrix bevat elk geladen bronitem exact één keer", () => {
  assert.ok(items.length >= 100);
  assert.equal(matrix.sourceItemCount, items.length);
  assert.equal(matrix.items.length, items.length);
  assert.equal(new Set(matrix.items.map((item) => item.id)).size, items.length);
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
    if (["current", "future"].includes(item.classification) && item.visibleThrough) {
      // Handmatig item op datum: geen herbevestiging, zichtbaar tot en met de laatste dag.
      assert.equal(item.maxAgeDays, null);
      assert.equal(item.recheckDueOn, item.visibleThrough);
      assert.ok(item.visibleThrough >= item.classificationAsOf, item.id);
    } else if (["current", "future"].includes(item.classification)) {
      assert.ok(item.maxAgeDays > 0);
      assert.match(item.recheckDueOn, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(new Date(`${item.recheckDueOn}T00:00:00Z`).toISOString().slice(0, 10), item.recheckDueOn);
      assert.ok(item.recheckDueOn >= item.sourceRetrievedAt.slice(0, 10));
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

test("de actuele wegenwerkfase is publiceerbaar zolang haar bron vers is, en daarna geblokkeerd", () => {
  const row = matrix.items.find(
    (item) => item.title === "Heraanleg Van Maerlantstraat en Vondelstraat - fase 2"
  );
  assert.equal(row.sourceId, "city-osystraat-works");
  const source = engine.config.sources[row.sourceId];
  assert.equal(row.sourceRetrievedAt, source.retrievedAt);
  const fresh = matrix.classificationAsOf <= addDays(source.retrievedAt, 2);
  if (fresh) {
    assert.equal(row.classification, "current");
    assert.equal(row.slaStatus, "fresh_verified");
    assert.equal(row.publishEligible, true);
  } else {
    assert.equal(row.classification, "review_required");
    assert.equal(row.reviewReason, "stale_source");
    assert.equal(row.slaStatus, "stale_blocked");
    assert.equal(row.publishEligible, false);
  }
});

test("feed-items houden hun eigen bron-URL en ophaalmoment in de matrix", () => {
  for (const row of matrix.items.filter((item) => item.sourceKind === "official_feed")) {
    const item = items.find((candidate) => candidate.id === row.id);
    assert.equal(row.canonicalSourceUrl, item.link);
    assert.equal(row.sourceRetrievedAt, item.retrievedAt);
  }
});
