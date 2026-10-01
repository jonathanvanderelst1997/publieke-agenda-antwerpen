import assert from "node:assert/strict";
import test from "node:test";
import { backfillSourceCanImport, sourceHistoryRecord, validateHistoryBackfillManifest } from "../lib/history-backfill.mjs";

const full = {
  sourceId: "asign-parking",
  completeness: "full",
  coverageFrom: "2019-09-16",
  coverageTo: null,
  sourceUrl: "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/20",
  evidence: "De officiële laagbeschrijving zegt expliciet dat de laag de volledige historiek bevat.",
  dedupeKey: "Dossiernummer|Locatienummer",
  snapshotDigest: null,
};

test("full dekking vereist een bewezen begindatum", () => {
  assert.deepEqual(validateHistoryBackfillManifest({ schemaVersion: 1, sources: [full] }), []);
  assert.equal(backfillSourceCanImport(full), true);
  assert.ok(validateHistoryBackfillManifest({ schemaVersion: 1, sources: [{ ...full, coverageFrom: null }] }).some((e) => e.includes("full vereist")));
});

test("unknown claimt bewust geen historische periode en wordt niet geïmporteerd", () => {
  const unknown = {
    ...full, sourceId: "gipod-works", completeness: "unknown", coverageFrom: null,
    evidence: "De API heeft datumvelden, maar volledige retentie van beëindigde records is niet bewezen.",
    dedupeKey: "feature.id",
  };
  assert.deepEqual(validateHistoryBackfillManifest({ schemaVersion: 1, sources: [unknown] }), []);
  assert.equal(backfillSourceCanImport(unknown), false);
  assert.ok(validateHistoryBackfillManifest({ schemaVersion: 1, sources: [{ ...unknown, coverageFrom: "2019-01-01" }] }).some((e) => e.includes("unknown mag geen")));
});

test("bronhistoriek houdt geldigheid apart van observatie-events", () => {
  const record = sourceHistoryRecord({
    sourceId: "asign-parking", sourceRecordId: "D1|L1",
    validFrom: "2020-01-01", validTo: "2020-01-02",
    payload: { kind: "parking", title: "Tijdelijk parkeerverbod" },
  });
  assert.equal("observedAt" in record, false);
  assert.throws(() => sourceHistoryRecord({ ...record, validFrom: "2020-02-01", validTo: "2020-01-01" }), /omgekeerd/);
});
