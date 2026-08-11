import assert from "node:assert/strict";
import test from "node:test";

import { evaluateStalePolicy } from "../scripts/stale-policy.mjs";

const valid = {
  classification: "future",
  classificationAsOf: "2026-08-11",
  verificationState: "verified",
  officialPublic: true,
  canonicalSourceUrl: "https://example.invalid/public-event",
  sourceRetrievedAt: "2026-08-09T09:00:00Z",
  recheckDueOn: "2026-08-11",
};

test("de vervaldag zelf blijft geldig, de eerstvolgende dag blokkeert", () => {
  assert.deepEqual(evaluateStalePolicy(valid), { status: "fresh_verified", publishEligible: true, failClosed: false });
  assert.deepEqual(evaluateStalePolicy({ ...valid, classificationAsOf: "2026-08-12" }), {
    status: "stale_blocked",
    publishEligible: false,
    failClosed: true,
  });
});

test("ontbrekende of ongeldige provenance blokkeert fail-closed", () => {
  const variants = [
    [{ verificationState: "review_required" }, "blocked_unverified_source"],
    [{ officialPublic: false }, "blocked_unverified_source"],
    [{ canonicalSourceUrl: "http://example.invalid/event" }, "blocked_invalid_source_url"],
    [{ canonicalSourceUrl: "" }, "blocked_invalid_source_url"],
    [{ sourceRetrievedAt: null }, "blocked_missing_or_invalid_retrieval"],
    [{ sourceRetrievedAt: "2026-02-30" }, "blocked_missing_or_invalid_retrieval"],
    [{ recheckDueOn: null }, "blocked_missing_or_invalid_recheck_due"],
    [{ recheckDueOn: "2026-02-30" }, "blocked_missing_or_invalid_recheck_due"],
    [{ classificationAsOf: "2026-02-30" }, "blocked_invalid_as_of"],
    [{ classification: "unknown" }, "blocked_unknown_classification"],
  ];
  for (const [overrides, status] of variants) {
    assert.deepEqual(evaluateStalePolicy({ ...valid, ...overrides }), { status, publishEligible: false, failClosed: true });
  }
});

test("verlopen en review-required classificaties blokkeren onafhankelijk van een SLA-datum", () => {
  assert.equal(evaluateStalePolicy({ ...valid, classification: "expired", recheckDueOn: null }).status, "expired_not_public");
  assert.equal(evaluateStalePolicy({ ...valid, classification: "review_required", recheckDueOn: null }).status, "blocked_review_required");
});
