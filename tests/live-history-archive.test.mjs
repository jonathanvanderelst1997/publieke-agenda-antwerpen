import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  historyArchiveDay,
  historyArchiveDayFile,
  historyArchiveEventsForRun,
  historyArchiveEventsDigest,
  isHistoryArchiveDayFileName,
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

test("dagshardnaam: alleen JJJJ-MM-DD.json is een dagshard", () => {
  assert.equal(isHistoryArchiveDayFileName("2026-10-01.json"), true);
  assert.equal(isHistoryArchiveDayFileName(historyArchiveDayFile("2026-10-01").split("/").pop()), true);
  for (const name of ["index.json", "baseline.json", "2026-10-01\\.json", "2026-10-01xjson", "2026-10-01.json.bak", "26-10-01.json"]) {
    assert.equal(isHistoryArchiveDayFileName(name), false, name);
  }
});

// Regressie 1-10-2026: validate-data las geen enkele dagshard (de reguliere expressie zocht een
// letterlijke backslash), dus elke verversing met minstens één historiekwijziging faalde op
// "shard <dag> ontbreekt" en leverde geen datatak meer op.
test("validate-data leest een geschreven dagshard en mist alleen een echt ontbrekende", () => {
  const repoRoot = fileURLToPath(new URL("..", import.meta.url));
  const archiveProblems = (writeShard) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "archief-validatie-"));
    try {
      fs.cpSync(path.join(repoRoot, "lib"), path.join(root, "lib"), { recursive: true });
      fs.mkdirSync(path.join(root, "scripts"));
      fs.copyFileSync(path.join(repoRoot, "scripts", "validate-data.mjs"), path.join(root, "scripts", "validate-data.mjs"));
      fs.mkdirSync(path.join(root, "site", "history", "archive"), { recursive: true });
      fs.copyFileSync(path.join(repoRoot, "site", "works-core.js"), path.join(root, "site", "works-core.js"));
      fs.copyFileSync(path.join(repoRoot, "site", "inzage-status.js"), path.join(root, "site", "inzage-status.js"));

      const baseline = { schemaVersion: 1, layers: { works: { observedAt: T1, items: [{ id: "work:1" }] }, publicSpace: null } };
      const day = updateHistoryArchiveDay(null, T2, [event(T2, "work:2")]);
      const index = updateHistoryArchiveIndex(null, { observedAt: T2, baseline, dayDocument: day });
      const write = (relative, value) => fs.writeFileSync(path.join(root, relative), `${JSON.stringify(value, null, 2)}\n`);
      write("site/history/archive/baseline.json", baseline);
      write("site/history/archive/index.json", index);
      if (writeShard) write(historyArchiveDayFile(day.date), day);

      const run = spawnSync(process.execPath, [path.join(root, "scripts", "validate-data.mjs")], { encoding: "utf8" });
      return run.stderr.split("\n").filter((line) => line.startsWith("site/history/archive/"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };

  assert.deepEqual(archiveProblems(true), []);
  assert.deepEqual(archiveProblems(false), ["site/history/archive/index.json: shard 2026-09-30 ontbreekt"]);
});
