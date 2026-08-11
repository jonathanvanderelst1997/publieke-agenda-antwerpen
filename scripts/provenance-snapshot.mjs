import crypto from "node:crypto";

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function snapshotRow(item, engine) {
  const source = engine.config.sources[item.sourceId] ?? null;
  const canonicalSourceUrl = source?.url ?? item.link ?? "";
  return {
    id: item.id,
    title: item.title,
    eventDate: item.date,
    classification: item.classification,
    classificationAsOf: item.classificationAsOf,
    sourceId: item.sourceId,
    sourcePublisher: item.sourcePublisher,
    canonicalSourceUrl,
    sourceHost: canonicalSourceUrl ? new URL(canonicalSourceUrl).hostname : null,
    sourceRetrievedAt: source?.retrievedAt ?? null,
    verificationState: item.verificationState,
  };
}

function matrixRow(item) {
  return {
    id: item.id,
    title: item.title,
    eventDate: item.eventDate,
    classification: item.classification,
    classificationAsOf: item.classificationAsOf,
    sourceId: item.sourceId,
    sourcePublisher: item.sourcePublisher,
    canonicalSourceUrl: item.canonicalSourceUrl,
    sourceHost: item.sourceHost,
    sourceRetrievedAt: item.sourceRetrievedAt,
    verificationState: item.verificationState,
  };
}

export function buildProvenanceSnapshot(items, engine, matrix) {
  const reconciled = engine.reconcileAgendaItems(items, engine.config.classificationAsOf);
  const sourceItems = reconciled.auditItems.map((item) => snapshotRow(item, engine)).sort((a, b) => a.id.localeCompare(b.id));
  const matrixItems = matrix.items.map(matrixRow).sort((a, b) => a.id.localeCompare(b.id));
  const snapshot = {
    schemaVersion: 1,
    state: "local-provenance-snapshot-not-published",
    classificationAsOf: engine.config.classificationAsOf,
    sourceItemCount: sourceItems.length,
    sourceDigest: digest(sourceItems),
    items: sourceItems,
  };

  const sourceById = new Map(sourceItems.map((item) => [item.id, item]));
  const matrixById = new Map(matrixItems.map((item) => [item.id, item]));
  const ids = [...new Set([...sourceById.keys(), ...matrixById.keys()])].sort();
  const actions = ids.map((id) => {
    const sourceItem = sourceById.get(id) ?? null;
    const matrixItem = matrixById.get(id) ?? null;
    let action = "unchanged";
    if (!sourceItem) action = "add";
    else if (!matrixItem) action = "remove";
    else if (digest(sourceItem) !== digest(matrixItem)) action = "change";
    return {
      id,
      action,
      sourceDigest: sourceItem ? digest(sourceItem) : null,
      matrixDigest: matrixItem ? digest(matrixItem) : null,
    };
  });
  const counts = Object.fromEntries(["add", "change", "remove", "unchanged"].map((action) => [
    action,
    actions.filter((item) => item.action === action).length,
  ]));
  const diff = {
    schemaVersion: 1,
    state: "local-source-to-provenance-diff-not-published",
    from: "expanded-agenda-source",
    to: "provenance-sla-matrix",
    classificationAsOf: engine.config.classificationAsOf,
    sourceDigest: snapshot.sourceDigest,
    matrixDigest: digest(matrixItems),
    counts,
    actions,
  };
  return { snapshot, diff };
}
