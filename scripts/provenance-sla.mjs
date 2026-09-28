import { evaluateStalePolicy } from "./stale-policy.mjs";

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

function sourceKind(sourceId, publisher, feed = false) {
  if (sourceId === "historical-stored-source") return "historical_link_only";
  if (feed) return "official_feed";
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
    // Een feed-item houdt zijn eigen bron-URL; die wordt nooit door de algemene bron-URL vervangen.
    const canonicalSourceUrl = item.feed ? item.link ?? "" : configuredSource?.url ?? item.link ?? "";
    // Het ophaalmoment per item gaat voor op dat van de bron.
    const sourceRetrievedAt = configuredSource ? item.retrievedAt ?? configuredSource.retrievedAt ?? null : null;
    // De engine past dezelfde vensters toe; neem zijn waarden over zodat kandidaat en SLA per constructie gelijk zijn.
    const ttlDays = item.slaMaxAgeDays ?? (item.slaMaxAgeHours != null ? item.slaMaxAgeHours / 24 : maxAgeDays(item));
    const dueOn = item.recheckDueOn ?? (sourceRetrievedAt && ttlDays != null ? addDays(sourceRetrievedAt, ttlDays) : null);
    let policy = evaluateStalePolicy({
      classification: item.classification,
      classificationAsOf: engine.config.classificationAsOf,
      verificationState: item.verificationState,
      officialPublic: configuredSource?.officialPublic,
      canonicalSourceUrl,
      sourceRetrievedAt,
      recheckDueOn: dueOn,
    });
    if (item.reviewReason === "stale_source") policy = { status: "stale_blocked", publishEligible: false, failClosed: true };
    const slaStatus = policy.status;
    const eligible = policy.publishEligible;
    return {
      id: item.id,
      title: item.title,
      theme: item.theme,
      eventDate: item.date,
      classification: item.classification,
      classificationAsOf: item.classificationAsOf,
      sourceId: item.sourceId,
      sourcePublisher: item.sourcePublisher,
      sourceKind: sourceKind(item.sourceId, item.sourcePublisher, item.feed === true),
      scope: item.scope ?? null,
      canonicalSourceUrl,
      sourceHost: canonicalSourceUrl ? new URL(canonicalSourceUrl).hostname : null,
      sourceRetrievedAt,
      verificationState: item.verificationState,
      reviewReason: item.reviewReason ?? null,
      maxAgeDays: ttlDays,
      recheckDueOn: dueOn,
      slaStatus,
      publishEligible: eligible,
      includedInLocalCandidate: localCandidateIds.has(item.id),
      failClosed: policy.failClosed,
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
