import assert from "node:assert/strict";
import test from "node:test";

import { replaySourceDiff } from "../scripts/source-diff-replay.mjs";

const previous = [
  { id: "unchanged", title: "Synthetic unchanged", source: "official-a", expiresOn: "2026-08-20" },
  { id: "changed", title: "Synthetic old title", source: "official-b", expiresOn: "2026-08-20" },
  { id: "expired", title: "Synthetic expiring", source: "official-c", expiresOn: "2026-08-12" },
  { id: "removed", title: "Synthetic removed", source: "official-d", expiresOn: "2026-08-20" },
];
const next = [
  { id: "added", title: "Synthetic added", source: "official-e", expiresOn: "2026-08-20" },
  { id: "changed", title: "Synthetic corrected title", source: "official-b", expiresOn: "2026-08-20" },
  { id: "expired", title: "Synthetic expiring", source: "official-c", expiresOn: "2026-08-10" },
  { id: "unchanged", title: "Synthetic unchanged", source: "official-a", expiresOn: "2026-08-20" },
];

test("replays add, change, expire and remove exactly once", () => {
  const replay = replaySourceDiff(previous, next, "2026-08-11");
  assert.deepEqual(replay.counts, { add: 1, change: 1, expire: 1, remove: 1, unchanged: 1 });
  assert.deepEqual(replay.actions.map(({ id, action }) => ({ id, action })), [
    { id: "added", action: "add" },
    { id: "changed", action: "change" },
    { id: "expired", action: "expire" },
    { id: "removed", action: "remove" },
    { id: "unchanged", action: "unchanged" },
  ]);
  assert.equal(replay.actions.find((item) => item.id === "expired").publishEligibleAfter, false);
  assert.equal(replay.actions.find((item) => item.id === "removed").publishEligibleAfter, false);
});

test("input order does not change actions or snapshot digests", () => {
  assert.deepEqual(
    replaySourceDiff(previous, next, "2026-08-11"),
    replaySourceDiff([...previous].reverse(), [...next].reverse(), "2026-08-11"),
  );
});

test("replay does not mutate source snapshots and rejects duplicate identities", () => {
  const before = structuredClone({ previous, next });
  replaySourceDiff(previous, next, "2026-08-11");
  assert.deepEqual({ previous, next }, before);
  assert.throws(() => replaySourceDiff(previous, [...next, next[0]], "2026-08-11"), /Duplicate source item id/);
});
