import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildAsignParkingBackfill } from "../scripts/backfill-asign-parking-history.mjs";
import { validateHistoryBackfillIndex, validateHistoryBackfillShard } from "../lib/history-backfill.mjs";
import { historiekPrivacyBevindingen } from "../lib/historiek-privacy.mjs";

const streetIndex = {
  segments: [{ a: [4.4, 51.2], b: [4.41, 51.21], refs: [{ id: "1", name: "Teststraat", postcode: "2000" }] }],
  byName: new Map([["teststraat", [{ id: "1", name: "Teststraat", postcode: "2000" }]]]),
};

const feature = (id, start, end, status = "Goedgekeurd") => ({
  attributes: {
    OBJECTID: id,
    Dossiernummer: `D${id}`,
    Locatienummer: `L${id}`,
    Status: status,
    Adres: "Teststraat 1, 2000 Antwerpen",
    Reden: "Werken",
    Startdatum: Date.parse(start),
    Einddatum: Date.parse(end),
    EnkelWeekdagen: "nee",
    GipodID: null,
    District: "ANTWERPEN",
  },
});

function fetcher({ unknownStatus = false, beforeCoverage = false } = {}) {
  const rows = [
    feature(1, "2019-10-01T08:00:00Z", "2019-10-02T18:00:00Z", unknownStatus ? "Onbekend" : "Goedgekeurd"),
    feature(2, "2020-05-01T08:00:00Z", "2020-05-02T18:00:00Z"),
  ];
  return async (input) => {
    const url = new URL(String(input));
    if (!url.pathname.endsWith("/20/query")) throw new Error("unexpected_url");
    const where = url.searchParams.get("where") || "";
    if (url.searchParams.get("returnCountOnly") === "true") return Response.json({ count: beforeCoverage ? 199697 : 0 });
    if (url.searchParams.get("returnIdsOnly") === "true") {
      const lower = where.match(/Startdatum >= DATE '(\d{4}-\d{2}-\d{2})'/)?.[1];
      const upper = where.match(/Startdatum < DATE '(\d{4}-\d{2}-\d{2})'/)?.[1];
      if (!lower || !upper) throw new Error("unbounded_fixture_query");
      return Response.json({
        objectIdFieldName: "OBJECTID",
        objectIds: rows.filter(({ attributes: row }) => row.Startdatum >= Date.parse(lower + "T00:00:00Z")
          && row.Startdatum < Date.parse(upper + "T00:00:00Z")).map(({ attributes: row }) => row.OBJECTID),
      });
    }
    const ids = (url.searchParams.get("objectIds") || "").split(",").filter(Boolean).map(Number);
    return Response.json({ features: ids.map((id) => {
      const row = rows.find((item) => item.attributes.OBJECTID === id);
      if (!row) throw new Error("unexpected_fixture_id");
      return row;
    }) });
  };
}

function fakeRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agenda-backfill-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "site/history/archive"), { recursive: true });
  fs.writeFileSync(path.join(root, "site/history/archive/index.json"), JSON.stringify({
    schemaVersion: 1,
    baselineInitializedAt: "2026-10-01T11:42:02.040Z",
    lastObservedAt: "2026-10-01T11:42:02.040Z",
    days: [],
  }));
  return root;
}

test("A-Sign parking backfill bouwt alleen pre-baseline shards en schrijft standaard niets", async (t) => {
  const rootDir = fakeRoot(t);
  const result = await buildAsignParkingBackfill({
    rootDir,
    fetch: fetcher(),
    streetIndex,
    clock: () => new Date("2026-10-01T19:00:00Z"),
  });
  assert.equal(result.write, false);
  assert.equal(result.records, 2);
  assert.equal(result.coverageFrom, "2019-09-16");
  assert.equal(result.coverageTo, "2026-09-30");
  assert.deepEqual(result.shards.map((s) => [s.year, s.count]), [[2019, 1], [2020, 1]]);
  assert.equal(fs.existsSync(path.join(rootDir, "site/history/backfill")), false);
});

test("onbekende historische status faalt vóór materialisatie", async (t) => {
  const rootDir = fakeRoot(t);
  await assert.rejects(
    buildAsignParkingBackfill({ rootDir, fetch: fetcher({ unknownStatus: true }), streetIndex }),
    /historical_status_unclassified/
  );
  assert.equal(fs.existsSync(path.join(rootDir, "site/history/backfill")), false);
});

test("oudere brondata wordt alleen geteld; oudere importdata blijft verboden", async (t) => {
  const rootDir = fakeRoot(t), calls = [], base = fetcher({ beforeCoverage: true });
  const result = await buildAsignParkingBackfill({
    rootDir, streetIndex, fetch: async (input, init) => { calls.push(new URL(String(input))); return base(input, init); },
  });
  assert.equal(result.beforeCoverageCount, 199697); assert.equal(result.records, 2);
  assert.equal(result.coverageFrom, "2019-09-16");
  const older = calls.filter((url) => (url.searchParams.get("where") || "").includes("Startdatum < DATE '2019-09-16'"));
  assert.equal(older.length, 1); assert.equal(older[0].searchParams.get("returnCountOnly"), "true");
  assert.equal(older[0].searchParams.has("returnIdsOnly"), false);
  await assert.rejects(buildAsignParkingBackfill({
    rootDir, streetIndex, month: "2019-10", fetch: async (input, init) => {
      const data = await (await base(input, init)).json();
      if (Array.isArray(data.features)) data.features = data.features.map((row) => ({
        ...row, attributes: { ...row.attributes, Startdatum: Date.parse("2019-01-01T08:00:00Z") },
      }));
      return Response.json(data);
    },
  }), /historical_record_before_proven_coverage/);
  assert.equal(fs.existsSync(path.join(rootDir, "site/history/backfill")), false);
});

test("de jaarophaling bestaat uit aansluitende begrensde maandvensters", async (t) => {
  const rootDir = fakeRoot(t), intervals = [], base = fetcher();
  const result = await buildAsignParkingBackfill({
    rootDir, streetIndex, fetch: async (input, init) => {
      const url = new URL(String(input)), where = url.searchParams.get("where") || "";
      if (url.searchParams.get("returnIdsOnly") === "true") intervals.push({
        lower: where.match(/Startdatum >= DATE '(\d{4}-\d{2}-\d{2})'/)?.[1],
        upper: where.match(/Startdatum < DATE '(\d{4}-\d{2}-\d{2})'/)?.[1],
      });
      return base(input, init);
    },
  });
  assert.equal(result.records, 2);
  assert.equal(intervals[0].lower, "2019-09-16");
  assert.equal(intervals.at(-1).upper, "2026-10-01");
  for (let i = 0; i < intervals.length; i += 1) {
    const days = (Date.parse(intervals[i].upper) - Date.parse(intervals[i].lower)) / 86400000;
    assert.ok(days > 0 && days <= 31);
    if (i > 0) assert.equal(intervals[i].lower, intervals[i - 1].upper);
  }
  assert.deepEqual(result.shards.map((shard) => [shard.year, shard.count]), [[2019, 1], [2020, 1]]);
});

test("een maandproef blijft beperkt en kan geen jaarschijf of index schrijven", async (t) => {
  const rootDir = fakeRoot(t), calls = [], base = fetcher({ beforeCoverage: true });
  const fetch = async (input, init) => { calls.push(new URL(String(input))); return base(input, init); };
  const result = await buildAsignParkingBackfill({ rootDir, streetIndex, fetch, month: "2020-05" });
  assert.equal(result.mode, "month-dry-run"); assert.equal(result.completeness, "partial");
  assert.equal(result.selectedFrom, "2020-05-01"); assert.equal(result.selectedUntilExclusive, "2020-06-01");
  assert.equal(result.records, 1); assert.equal(result.beforeCoverageCount, 199697);
  assert.equal(result.write, false); assert.equal(result.written, 0);
  for (const key of ["coverageFrom", "snapshotDigest", "shards"]) assert.equal(key in result, false);
  assert.equal(calls.filter((u) => u.searchParams.get("returnCountOnly") === "true").length, 1);
  assert.equal(calls.filter((u) => u.searchParams.get("returnIdsOnly") === "true").length, 1);
  assert.equal(calls.filter((u) => u.searchParams.has("objectIds")).length, 1);
  assert.equal(calls.length, 3);
  await assert.rejects(buildAsignParkingBackfill({ rootDir, streetIndex, fetch, month: "2020-05", write: true }), /historical_month_write_forbidden/);
  assert.equal(calls.length, 3);
  assert.equal(fs.existsSync(path.join(rootDir, "site/history/backfill")), false);
});

test("write maakt immutable shards en een valide index", async (t) => {
  const rootDir = fakeRoot(t);
  const result = await buildAsignParkingBackfill({
    rootDir,
    fetch: fetcher(),
    streetIndex,
    clock: () => new Date("2026-10-01T19:00:00Z"),
    write: true,
  });
  assert.equal(result.written, 2);
  const index = JSON.parse(fs.readFileSync(path.join(rootDir, "site/history/backfill/index.json"), "utf8"));
  assert.deepEqual(validateHistoryBackfillIndex(index), []);
  for (const ref of index.sources[0].shards) {
    const shard = JSON.parse(fs.readFileSync(path.join(rootDir, ref.file), "utf8"));
    assert.deepEqual(validateHistoryBackfillShard(shard), []);
    assert.ok(shard.records.every((record) => !("observedAt" in record)));
  }
});

test("shard en index weigeren gemanipuleerde data", () => {
  const shard = {
    schemaVersion: 1,
    sourceId: "asign-parking",
    year: 2020,
    records: [{
      sourceId: "asign-parking",
      sourceRecordId: "D1|L1",
      validFrom: "2020-01-01",
      validTo: "2020-01-02",
      payload: { id: "parking:D1|L1" },
    }],
  };
  assert.deepEqual(validateHistoryBackfillShard(shard), []);
  assert.ok(validateHistoryBackfillShard({ ...shard, year: 2021 }).some((e) => e.includes("buiten shardjaar")));
});

// P4 (lib/historiek-privacy.mjs): de backfill volgt dezelfde regels als de live historiek. Verzonnen
// adressen: een verbod in het district houdt alleen de straat, een verbod in 2100 valt weg.
test("backfill: buiten het district valt weg; een onbevestigd synthetisch huisnummer wordt niet verzonnen", async (t) => {
  const rootDir = fakeRoot(t);
  const metAdres = (id, adres) => {
    const rij = feature(id, "2019-10-01T08:00:00Z", "2019-10-02T18:00:00Z");
    return { attributes: { ...rij.attributes, Adres: adres } };
  };
  const fetch = async (input) => {
    const url = new URL(String(input));
    const where = url.searchParams.get("where") || "";
    if (url.searchParams.get("returnCountOnly") === "true") return Response.json({ count: 0 });
    if (url.searchParams.get("returnIdsOnly") === "true") {
      return Response.json({ objectIds: where.includes("Startdatum >= DATE '2019-10-01'") && where.includes("Startdatum < DATE '2019-11-01'") ? [1, 3] : [] });
    }
    const ids = (url.searchParams.get("objectIds") || "").split(",").filter(Boolean).map(Number);
    return Response.json({ features: ids.map((id) => (id === 1 ? metAdres(1, "Teststraat 1, 2000 Antwerpen") : metAdres(3, "Teststraat 5, 2100 Antwerpen"))) });
  };
  const result = await buildAsignParkingBackfill({ rootDir, fetch, streetIndex, clock: () => new Date("2026-10-01T19:00:00Z"), write: true });
  assert.equal(result.records, 1, "het verbod in 2100 valt weg");
  const index = JSON.parse(fs.readFileSync(path.join(rootDir, "site/history/backfill/index.json"), "utf8"));
  const shard = JSON.parse(fs.readFileSync(path.join(rootDir, index.sources[0].shards[0].file), "utf8"));
  assert.deepEqual(shard.records.map((record) => [record.sourceRecordId, record.payload.location]), [["D1|L1", "Teststraat, 2000 Antwerpen"]]);
  assert.deepEqual(historiekPrivacyBevindingen(shard), []);
});

function mappedFetcher(mapFeature) {
  const base = fetcher();
  return async (input) => {
    const response = await base(input), data = await response.json();
    if (Array.isArray(data.features)) data.features = data.features.map(mapFeature);
    return Response.json(data);
  };
}
test("backfill rechecks district, dates and unresolved locations before writing", async (t) => {
  for (const [change, error] of [
    [{ District: "DEURNE" }, /historical_district_mismatch/],
    [{ Startdatum: null }, /historical_parking_dates_invalid/],
    [{ Adres: "", Postcode: "2000" }, /historical_district_unresolved/]
  ]) {
    const rootDir = fakeRoot(t);
    await assert.rejects(buildAsignParkingBackfill({
      rootDir, streetIndex, write: true,
      fetch: mappedFetcher((row) => ({ attributes: { ...row.attributes, ...change } }))
    }), error);
    assert.equal(fs.existsSync(path.join(rootDir, "site/history/backfill")), false);
  }
});
test("a source identity cannot conflict between year shards", async (t) => {
  const rootDir = fakeRoot(t);
  await assert.rejects(buildAsignParkingBackfill({
    rootDir, streetIndex, write: true,
    fetch: mappedFetcher((row) => ({ attributes: { ...row.attributes, Dossiernummer: "D1", Locatienummer: "L1" } }))
  }), /historical_duplicate_conflict/);
  assert.equal(fs.existsSync(path.join(rootDir, "site/history/backfill")), false);
});
test("backfill retains a verified house number and excludes extra source text", async (t) => {
  const rootDir = fakeRoot(t);
  const meirIndex = {
    segments: [{ a: [4.4, 51.2], b: [4.41, 51.21], refs: [{ id: "1", name: "Meir", postcode: "2000" }] }],
    byName: new Map([["meir", [{ id: "1", name: "Meir", postcode: "2000" }]]])
  };
  const result = await buildAsignParkingBackfill({
    rootDir, streetIndex: meirIndex, write: true, clock: () => new Date("2026-10-01T19:00:00Z"),
    fetch: mappedFetcher((row) => ({ attributes: { ...row.attributes, Adres: "Meir 999 2000 Antwerpen", Postcode: "2000", Reden: "UNPUBLISHED_TEXT", ExtraTekst: "UNPUBLISHED_TEXT" } }))
  });
  assert.equal(result.records, 2);
  const index = JSON.parse(fs.readFileSync(path.join(rootDir, "site/history/backfill/index.json"), "utf8"));
  for (const ref of index.sources[0].shards) {
    const shard = JSON.parse(fs.readFileSync(path.join(rootDir, ref.file), "utf8"));
    for (const record of shard.records) assert.equal(record.payload.location, "Meir 999, 2000 Antwerpen");
    assert.equal(JSON.stringify(shard).includes("UNPUBLISHED_TEXT"), false);
    assert.deepEqual(historiekPrivacyBevindingen(shard), []);
  }
});
test("repeating a materialization does not rewrite immutable shards", async (t) => {
  const rootDir = fakeRoot(t);
  const options = { rootDir, fetch: fetcher(), streetIndex, write: true, clock: () => new Date("2026-10-01T19:00:00Z") };
  const first = await buildAsignParkingBackfill(options);
  const second = await buildAsignParkingBackfill({ ...options, clock: () => new Date("2026-10-02T19:00:00Z") });
  assert.equal(first.written, 2); assert.equal(second.written, 0);
  assert.equal(first.snapshotDigest, second.snapshotDigest);
});
