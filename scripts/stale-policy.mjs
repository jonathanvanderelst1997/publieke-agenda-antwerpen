function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return false;
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

export function evaluateStalePolicy({
  classification,
  classificationAsOf,
  verificationState,
  officialPublic,
  canonicalSourceUrl,
  sourceRetrievedAt,
  recheckDueOn,
}) {
  if (!validDate(classificationAsOf)) return { status: "blocked_invalid_as_of", publishEligible: false, failClosed: true };
  if (classification === "expired") return { status: "expired_not_public", publishEligible: false, failClosed: true };
  if (classification === "review_required") return { status: "blocked_review_required", publishEligible: false, failClosed: true };
  if (!["current", "future"].includes(classification)) return { status: "blocked_unknown_classification", publishEligible: false, failClosed: true };
  if (verificationState !== "verified" || officialPublic !== true) {
    return { status: "blocked_unverified_source", publishEligible: false, failClosed: true };
  }
  if (!/^https:\/\//i.test(canonicalSourceUrl ?? "")) {
    return { status: "blocked_invalid_source_url", publishEligible: false, failClosed: true };
  }
  if (!validDate(String(sourceRetrievedAt ?? "").slice(0, 10))) {
    return { status: "blocked_missing_or_invalid_retrieval", publishEligible: false, failClosed: true };
  }
  if (!validDate(recheckDueOn)) {
    return { status: "blocked_missing_or_invalid_recheck_due", publishEligible: false, failClosed: true };
  }
  if (classificationAsOf > recheckDueOn) return { status: "stale_blocked", publishEligible: false, failClosed: true };
  return { status: "fresh_verified", publishEligible: true, failClosed: false };
}
