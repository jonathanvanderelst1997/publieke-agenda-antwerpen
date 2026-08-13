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

function normalizeSnapshot(entries) {
  const byId = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry.id !== "string" || !entry.id.trim()) throw new Error("Every source item needs an id.");
    if (byId.has(entry.id)) throw new Error(`Duplicate source item id: ${entry.id}`);
    byId.set(entry.id, structuredClone(entry));
  }
  return byId;
}

function isExpired(entry, asOf) {
  return typeof entry?.expiresOn === "string" && entry.expiresOn < asOf;
}

export function replaySourceDiff(previousEntries, nextEntries, asOf) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error("asOf must be YYYY-MM-DD.");
  const previous = normalizeSnapshot(previousEntries);
  const next = normalizeSnapshot(nextEntries);
  const ids = [...new Set([...previous.keys(), ...next.keys()])].sort();

  const actions = ids.map((id) => {
    const before = previous.get(id) ?? null;
    const after = next.get(id) ?? null;
    let action = "unchanged";
    if (!before) action = "add";
    else if (!after) action = "remove";
    else if (!isExpired(before, asOf) && isExpired(after, asOf)) action = "expire";
    else if (digest(before) !== digest(after)) action = "change";

    return {
      id,
      action,
      beforeDigest: before ? digest(before) : null,
      afterDigest: after ? digest(after) : null,
      expiresOn: after?.expiresOn ?? before?.expiresOn ?? null,
      publishEligibleAfter: Boolean(after) && !isExpired(after, asOf),
    };
  });

  const count = (action) => actions.filter((item) => item.action === action).length;
  return {
    schemaVersion: 1,
    state: "local-deterministic-replay-not-published",
    asOf,
    previousDigest: digest([...previous.values()].sort((a, b) => a.id.localeCompare(b.id))),
    nextDigest: digest([...next.values()].sort((a, b) => a.id.localeCompare(b.id))),
    counts: Object.fromEntries(["add", "change", "expire", "remove", "unchanged"].map((action) => [action, count(action)])),
    actions,
  };
}
