import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { deriveStableEventId, parseEventTimes, validateEventContract } from "../lib/event-contract.mjs";
import { loadAgendaItemsFromSource } from "../scripts/load-agenda-source.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const event = { id: "synthetic-event-2026-09-01", title: "Synthetische vergadering", date: "2026-09-01", dateLabel: "1 september 2026", timeSlot: "18:30", timeText: "18.30 tot 20 uur", location: "Publieke testlocatie" };

test("normalizes start, end, timezone and accessible title", () => {
  const result = validateEventContract([event]);
  assert.equal(result.ok, true);
  assert.equal(result.events[0].startTime, "18:30");
  assert.equal(result.events[0].endTime, "20:00");
  assert.equal(result.events[0].timeZone, "Europe/Brussels");
  assert.match(result.events[0].accessibleTitle, /Synthetische vergadering, 1 september 2026, 18.30 tot 20 uur, Publieke testlocatie/);
});

test("derived ids are stable across whitespace and input ordering", () => {
  const same = { ...event, title: "  Synthetische   vergadering  ", location: "Publieke  testlocatie" };
  assert.equal(deriveStableEventId(event), deriveStableEventId(same));
  const other = { ...event, id: "ander-event-2026-09-02", title: "Ander event", date: "2026-09-02" };
  assert.deepEqual([event, other].map(deriveStableEventId).sort(), [other, event].map(deriveStableEventId).sort());
});

test("duplicates and impossible ranges fail closed", () => {
  const duplicate = { ...event, id: "synthetic-duplicate-2026-09-01" };
  const invalidRange = { ...event, id: "synthetic-range-2026-09-03", date: "2026-09-03", timeText: "18.30 tot 17 uur" };
  const result = validateEventContract([event, duplicate, invalidRange]);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.code === "duplicate_event"));
  assert.ok(result.errors.some((item) => item.code === "end_not_after_start"));
});

test("unknown time is explicit and a foreign timezone is rejected", () => {
  assert.deepEqual(parseEventTimes("Uur volgt", ""), { startTime: null, endTime: null, status: "unconfirmed" });
  const result = validateEventContract([{ ...event, timeSlot: "Uur volgt", timeText: "" }], { timeZone: "UTC" });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.code === "invalid_timezone"));
  assert.ok(result.warnings.some((item) => item.code === "unconfirmed_start"));
});

test("current public source satisfies critical event contract", async () => {
  const items = await loadAgendaItemsFromSource(path.join(root, "site", "agenda.js"));
  const result = validateEventContract(items);
  assert.equal(result.errors.length, 0, JSON.stringify(result.errors.slice(0, 5)));
  assert.equal(result.events.length, items.length);
});
