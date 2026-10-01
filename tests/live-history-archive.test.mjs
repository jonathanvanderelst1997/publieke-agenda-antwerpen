import assert from "node:assert/strict";
import test from "node:test";

import {
  historyArchiveDay,
  historyArchiveEventsForRun,
  historyArchiveEventsDigest,
  updateHistoryArchiveBaseline,
  updateHistoryArchiveDay,
  updateHistoryArchiveIndex,
  validateHistoryArchiveBaseline,
  validateHistoryArchiveDay,
  validateHistoryArchiveIndex,
} from "../lib/live-history-archive.mjs";

const T1 = "2026-09-29T06:00:00.000Z";
const T2 = "2026-09-30T06:00:00.000Z";
const layer = (id) => ({ status: "ok", lastSuccessAt: T1, items: [{ id }] });
const event = (observedAt, id = "work:1") => ({
  observedAt, layer: "works", id, type: "changed", fields: ["status"],
  before: { status: "Concreet gepland" }, after: { status: "In uitvoering" },
});

test("baseline wordt per laag één keer gezet en daarna nooit herschreven", () => {
  const first = updateHistoryArchiveBaseline(null, {
    observedAt: T1,
    layers: { works: layer("work:1"), publicSpace: { status: "error", items: [] } },
  });
  assert.equal(first.layers.works.observedAt, T1);
  assert.equal(first.layers.publicSpace, null);

  const second = updateHistoryArchiveBaseline(first, {
    observedAt: T2,
    layers: {
      works: { ...layer("work:2"), lastSuccessAt: T2 },
      publicSpace: { ...layer("parking:1"), lastSuccessAt: T2 },
    },
  });
  assert.equal(second.layers.works.observedAt, T1);
  assert.equal(second.layers.works.items[0].id, "work:1");
  assert.equal(second.layers.publicSpace.observedAt, T2);
  assert.deepEqual(validateHistoryArchiveBaseline(second), []);
});

test("events van de eerste succesvolle laag zijn baseline en worden niet dubbel gearchiveerd", () => {
  const history = {
    observedAt: T1,
    layers: { works: layer("work:1"), publicSpace: { status: "error", items: [] } },
    changes: [event(T1)],
  };
  const baseline = updateHistoryArchiveBaseline(null, history);
  assert.deepEqual(historyArchiveEventsForRun(history, baseline), []);
});

test("dagarchief bewaart eerdere runs en dedupliceert een herhaalde run", () => {
  const first = updateHistoryArchiveDay(null, T1, [event(T1)]);
  const second = updateHistoryArchiveDay(first, "2026-09-29T15:00:00.000Z", [
    event(T1),
    event("2026-09-29T15:00:00.000Z", "work:2"),
  ]);
  assert.equal(second.events.length, 2);
  assert.equal(historyArchiveDay(T1), "2026-09-29");
  assert.deepEqual(validateHistoryArchiveDay(second), []);
});

test("index behoudt oude dagen en wijst met digest naar de actuele dagshard", () => {
  const baseline = {
    schemaVersion: 1,
    layers: {
      works: { observedAt: T1, items: [{ id: "work:1" }] },
      publicSpace: null,
    },
  };
  const d1 = updateHistoryArchiveDay(null, T1, [event(T1)]);
  const i1 = updateHistoryArchiveIndex(null, { observedAt: T1, baseline, dayDocument: d1 });
  const d2 = updateHistoryArchiveDay(null, T2, [event(T2, "work:2")]);
  const i2 = updateHistoryArchiveIndex(i1, { observedAt: T2, baseline, dayDocument: d2 });
  assert.deepEqual(i2.days.map((day) => day.date), ["2026-09-29", "2026-09-30"]);
  assert.equal(i2.days[1].digest, historyArchiveEventsDigest(d2.events));
  assert.deepEqual(validateHistoryArchiveIndex(i2), []);
});

test("validators weigeren verkeerde datum, bestand en digest", () => {
  const day = updateHistoryArchiveDay(null, T1, [event(T1)]);
  day.events[0].observedAt = T2;
  assert.ok(validateHistoryArchiveDay(day).some((error) => error.includes("datum ongeldig")));
  const index = {
    schemaVersion: 1,
    baselineInitializedAt: T1,
    lastObservedAt: T2,
    days: [{ date: "2026-09-29", file: "site/history/fout.json", count: 1, digest: "x" }],
  };
  const errors = validateHistoryArchiveIndex(index);
  assert.ok(errors.some((error) => error.includes("bestand ongeldig")));
  assert.ok(errors.some((error) => error.includes("digest ongeldig")));
});
