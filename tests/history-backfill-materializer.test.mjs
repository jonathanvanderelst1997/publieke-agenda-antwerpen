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
  return async (input) => {
    const url = new URL(String(input));
    if (!url.pathname.endsWith("/20/query")) throw new Error(`unexpected_url:${url}`);
    const where = url.searchParams.get("where") || "";
    if (url.searchParams.get("returnIdsOnly") === "true") {
      if (where.includes("Startdatum < DATE '2019-09-16'")) return Response.json({ objectIds: beforeCoverage ? [9] : [] });
      if (where.includes("2019-09-16") && where.includes("2020-01-01")) return Response.json({ objectIds: [1] });
      if (where.includes("2020-01-01") && where.includes("2021-01-01")) return Response.json({ objectIds: [2] });
      return Response.json({ objectIds: [] });
    }
    const ids = (url.searchParams.get("objectIds") || "").split(",").filter(Boolean).map(Number);
    return Response.json({
      features: ids.map((id) => id === 1
        ? feature(1, "2019-10-01T08:00:00Z", "2019-10-02T18:00:00Z", unknownStatus ? "Onbekend" : "Goedgekeurd")
        : id === 2
          ? feature(2, "2020-05-01T08:00:00Z", "2020-05-02T18:00:00Z")
          : feature(9, "2019-01-01T08:00:00Z", "2019-01-02T18:00:00Z")),
    });
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
    /historical_status_unclassified:Onbekend/
  );
  assert.equal(fs.existsSync(path.join(rootDir, "site/history/backfill")), false);
});

test("een record vóór de bewezen brondekking faalt dicht", async (t) => {
  const rootDir = fakeRoot(t);
  await assert.rejects(
    buildAsignParkingBackfill({ rootDir, fetch: fetcher({ beforeCoverage: true }), streetIndex }),
    /historical_record_before_proven_coverage/
  );
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
test("backfill: alleen het district en geen huisnummer", async (t) => {
  const rootDir = fakeRoot(t);
  const metAdres = (id, adres) => {
    const rij = feature(id, "2019-10-01T08:00:00Z", "2019-10-02T18:00:00Z");
    return { attributes: { ...rij.attributes, Adres: adres } };
  };
  const fetch = async (input) => {
    const url = new URL(String(input));
    const where = url.searchParams.get("where") || "";
    if (url.searchParams.get("returnIdsOnly") === "true") {
      return Response.json({ objectIds: where.includes("2019-09-16") && where.includes("2020-01-01") ? [1, 3] : [] });
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
