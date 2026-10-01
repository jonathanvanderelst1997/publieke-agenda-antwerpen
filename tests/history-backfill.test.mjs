import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  historyBackfillDigest,
  mergeAppendOnlyBackfillShard,
  validateHistoryBackfillIndex,
  validateHistoryBackfillShard,
} from "../lib/history-backfill.mjs";
import { ASIGN_BACKFILL_BATCH_SIZE, backfillAsignParking } from "../scripts/backfill-asign-parking.mjs";

const BASELINE = "2026-10-01T11:42:02.040Z";
const streetIndex = {
  segments: [{ a: [4.4, 51.2], b: [4.41, 51.21], refs: [{ id: "1", name: "Teststraat", postcode: "2000" }] }],
  byName: new Map([["teststraat", [{ id: "1", name: "Teststraat", postcode: "2000" }]]]),
};

const row = (id, end, extra = {}) => ({
  Dossiernummer: `D${id}`,
  Locatienummer: `L${id}`,
  Status: "Afgelopen",
  Adres: "Teststraat 1, 2000 Antwerpen",
  Reden: "Werken",
  Startdatum: Date.parse("2020-01-01T08:00:00Z"),
  Einddatum: Date.parse(end),
  EnkelWeekdagen: "",
  GipodID: null,
  District: "ANTWERPEN",
  ...extra,
});

test("append-only shard aanvaardt identieke replay en weigert stille herschrijving", () => {
  const record = {
    id: "parking:D1|L1", kind: "parking", title: "Werken", location: "Teststraat",
    start: "2020-01-01T08:00:00.000Z", end: "2020-01-02T08:00:00.000Z", status: "Afgelopen",
    reference: "D1", detail: "", gipodId: null, streets: [], streetResolution: "unresolved",
    streetDistanceMeters: null, sourceLabel: "A-Sign parkeerverboden — historische bron", sourceUrl: "https://voorbeeld.invalid"
  };
  const first = mergeAppendOnlyBackfillShard(null, { sourceId: "asign-parking", year: "2020", records: [record] });
  const replay = mergeAppendOnlyBackfillShard(first, { sourceId: "asign-parking", year: "2020", records: [record] });
  assert.deepEqual(replay, first);
  assert.throws(
    () => mergeAppendOnlyBackfillShard(first, {
      sourceId: "asign-parking", year: "2020", records: [{ ...record, status: "Gewijzigd" }]
    }),
    /history_backfill_conflict/
  );
  assert.deepEqual(validateHistoryBackfillShard(first), []);
});

test("A-Sign backfill eist providerclaim, leest IDs in batches van 100 en stopt aan baseline", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "agenda-history-backfill-"));
  try {
    const baselineFile = path.join(rootDir, "site", "history", "archive", "baseline.json");
    fs.mkdirSync(path.dirname(baselineFile), { recursive: true });
    fs.writeFileSync(baselineFile, JSON.stringify({
      schemaVersion: 1,
      layers: { works: null, publicSpace: { observedAt: BASELINE, items: [] } }
    }));

    const ids = Array.from({ length: 205 }, (_, index) => index + 1);
    const batches = [];
    const fetchImpl = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/MapServer/20")) {
        return Response.json({
          description: "Deze laag bevat de volledige historiek van alle tijdelijke parkeerverboden.",
          timeInfo: {
            startTimeField: "Startdatum",
            endTimeField: "Einddatum",
            timeExtent: [Date.parse("2019-09-16T00:00:00Z"), Date.parse("3000-01-01T00:00:00Z")],
          },
        });
      }
      if (url.searchParams.get("returnIdsOnly") === "true") return Response.json({ objectIds: ids });
      const batch = String(url.searchParams.get("objectIds") || "").split(",").filter(Boolean).map(Number);
      batches.push(batch);
      return Response.json({
        features: batch.map((id) => ({
          attributes: id === 205
            ? row(id, "2026-10-02T08:00:00Z")
            : row(id, id % 2 ? "2020-05-01T08:00:00Z" : "2021-06-01T08:00:00Z")
        })),
      });
    };

    const result = await backfillAsignParking({
      fetch: fetchImpl,
      rootDir,
      streetIndex,
      clock: () => new Date("2026-10-01T12:00:00Z"),
    });

    assert.equal(ASIGN_BACKFILL_BATCH_SIZE, 100);
    assert.deepEqual(batches.map((batch) => batch.length), [100, 100, 5]);
    assert.equal(result.records, 204, "record na baseline hoort niet in backfill");
    assert.equal(result.shards, 2);
    const index = JSON.parse(fs.readFileSync(path.join(rootDir, "site/history/backfill/index.json"), "utf8"));
    assert.deepEqual(validateHistoryBackfillIndex(index), []);
    assert.equal(index.sources[0].coverageFrom, "2019-09-16T00:00:00.000Z");
    assert.equal(index.sources[0].coverageTo, BASELINE);
    assert.equal(index.sources[0].completeness, "provider_declared_complete");
    for (const shard of index.sources[0].shards) {
      const document = JSON.parse(fs.readFileSync(path.join(rootDir, shard.file), "utf8"));
      assert.deepEqual(validateHistoryBackfillShard(document), []);
      assert.equal(shard.digest, historyBackfillDigest(document.records));
    }
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("provider zonder expliciete volledigheidsclaim wordt niet geïmporteerd", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "agenda-history-backfill-contract-"));
  try {
    const baselineFile = path.join(rootDir, "site", "history", "archive", "baseline.json");
    fs.mkdirSync(path.dirname(baselineFile), { recursive: true });
    fs.writeFileSync(baselineFile, JSON.stringify({
      schemaVersion: 1,
      layers: { works: null, publicSpace: { observedAt: BASELINE, items: [] } }
    }));
    const fetchImpl = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/MapServer/20")) {
        return Response.json({
          description: "Tijdelijke parkeerverboden.",
          timeInfo: { startTimeField: "Startdatum", endTimeField: "Einddatum", timeExtent: [1, 2] },
        });
      }
      throw new Error("query had niet mogen starten");
    };
    await assert.rejects(
      backfillAsignParking({ fetch: fetchImpl, rootDir, streetIndex }),
      /history_backfill_completeness_not_proven/
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
