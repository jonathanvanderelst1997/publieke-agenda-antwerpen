const DAY_MS = 24 * 60 * 60 * 1000;

function dateAtUtc(value) {
  return new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
}

function addDays(value, days) {
  const date = dateAtUtc(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayDelta(from, to) {
  return Math.round((dateAtUtc(to).getTime() - dateAtUtc(from).getTime()) / DAY_MS);
}

function sourceKind(sourceId, publisher) {
  if (sourceId === "historical-stored-source") return "historical_link_only";
  if (/stad antwerpen|district antwerpen|slim naar antwerpen/i.test(publisher)) return "public_authority";
  return "official_organizer";
}

function maxAgeDays(item) {
  if (item.classification === "expired") return null;
  if (item.classification === "review_required") return 0;
  if (item.classification === "current" || item.theme === "Werken") return 2;
  const daysUntilEvent = dayDelta(item.classificationAsOf, item.date);
  return daysUntilEvent <= 14 ? 3 : 7;
}

export function buildProvenanceSlaMatrix(items, engine) {
  const result = engine.reconcileAgendaItems(items, engine.config.classificationAsOf);
  const localCandidateIds = new Set(result.publicItems.map((item) => item.id));
  const rows = result.auditItems.map((item) => {
    const configuredSource = engine.config.sources[item.sourceId] ?? null;
    const canonicalSourceUrl = configuredSource?.url ?? item.link ?? "";
    const sourceRetrievedAt = configuredSource?.retrievedAt ?? null;
    const ttlDays = maxAgeDays(item);
    const dueOn = sourceRetrievedAt && ttlDays != null ? addDays(sourceRetrievedAt, ttlDays) : null;
    const verified = item.verificationState === "verified" && configuredSource?.officialPublic === true;
    let slaStatus;
    if (item.classification === "expired") slaStatus = "expired_not_public";
    else if (item.classification === "review_required") slaStatus = "blocked_review_required";
    else if (!verified || !sourceRetrievedAt) slaStatus = "blocked_unverified_source";
    else if (engine.config.classificationAsOf > dueOn) slaStatus = "stale_blocked";
    else slaStatus = "fresh_verified";

    const eligible = slaStatus === "fresh_verified" && ["current", "future"].includes(item.classification);
    return {
      id: item.id,
      title: item.title,
      theme: item.theme,
      eventDate: item.date,
      classification: item.classification,
      classificationAsOf: item.classificationAsOf,
      sourceId: item.sourceId,
      sourcePublisher: item.sourcePublisher,
      sourceKind: sourceKind(item.sourceId, item.sourcePublisher),
      canonicalSourceUrl,
      sourceHost: canonicalSourceUrl ? new URL(canonicalSourceUrl).hostname : null,
      sourceRetrievedAt,
      verificationState: item.verificationState,
      maxAgeDays: ttlDays,
      recheckDueOn: dueOn,
      slaStatus,
      publishEligible: eligible,
      includedInLocalCandidate: localCandidateIds.has(item.id),
      failClosed: !eligible,
    };
  });

  const countBy = (field) => Object.fromEntries(
    [...new Set(rows.map((row) => row[field]))].sort().map((value) => [value, rows.filter((row) => row[field] === value).length]),
  );

  return {
    schemaVersion: 1,
    state: "local-audit-not-published",
    classificationAsOf: engine.config.classificationAsOf,
    verifiedSourceSnapshotAt: engine.config.retrievedAt,
    rollbackBaseCommit: engine.config.rollback.baseCommit,
    sourceItemCount: items.length,
    localCandidateCount: result.publicItems.length,
    classifications: countBy("classification"),
    slaStatuses: countBy("slaStatus"),
    sourceKinds: countBy("sourceKind"),
    items: rows,
  };
}
