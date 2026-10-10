import assert from "node:assert/strict";
import test from "node:test";

import {
  compactPublicSpaceItem,
  compactWorkItem,
  updateLiveHistory,
  validateLiveHistory,
} from "../lib/live-history.mjs";

const T1 = "2026-09-28T06:00:00.000Z";
const T2 = "2026-09-29T06:00:00.000Z";

const work = (overrides = {}) => ({
  gipodId: 123,
  title: "Testwerk",
  status: "Concreet gepland",
  start: "2026-10-01T06:00:00Z",
  end: "2026-10-02T18:00:00Z",
  owner: "Stad Antwerpen",
  ownerGroup: "Stad Antwerpen",
  boundaryConfidence: "exact_snapshot",
  workTypes: ["Nutswerk"],
  occupancyTypes: ["Werkzone"],
  hindrance: null,
  ...overrides,
});

const space = (overrides = {}) => ({
  id: "parking:D1|L1",
  kind: "parking",
  kindLabel: "Parkeerverbod",
  title: "Werfsignalisatie",
  location: "Teststraat 1",
  start: "2026-10-01T06:00:00Z",
  end: "2026-10-02T18:00:00Z",
  status: "Goedgekeurd",
  reference: "D1",
  detail: "",
  ...overrides,
});

test("eerste run is alleen baseline, niet duizenden added-events", () => {
  const history = updateLiveHistory(null, {
    observedAt: T1,
    worksResult: { ok: true, items: [work()] },
    publicSpaceResult: { ok: true, items: [space()] },
  });
  assert.equal(history.layers.works.count, 1);
  assert.equal(history.layers.publicSpace.count, 1);
  assert.deepEqual(history.changes, []);
  assert.deepEqual(validateLiveHistory(history), []);
});

test("eerste geslaagde laag na eerdere fout is baseline, geen added-ruis", () => {
  const failed = updateLiveHistory(null, {
    observedAt: T1,
    worksResult: { ok: false, errorCode: "street_axis_invalid" },
    publicSpaceResult: { ok: false, errorCode: "http_404" },
  });
  const recovered = updateLiveHistory(failed, {
    observedAt: T2,
    worksResult: { ok: true, items: [work()] },
    publicSpaceResult: { ok: true, items: [space()] },
  });
  assert.equal(recovered.layers.works.lastSuccessAt, T2);
  assert.equal(recovered.layers.publicSpace.lastSuccessAt, T2);
  assert.equal(recovered.changes.filter((entry) => entry.observedAt === T2).length, 0);
  assert.deepEqual(validateLiveHistory(recovered), []);
});

test("volgende run bewaart added, removed en changed", () => {
  const baseline = updateLiveHistory(null, {
    observedAt: T1,
    worksResult: { ok: true, items: [work(), work({ gipodId: 999, title: "Verdwijnt" })] },
    publicSpaceResult: { ok: true, items: [space()] },
  });
  const next = updateLiveHistory(baseline, {
    observedAt: T2,
    worksResult: {
      ok: true,
      items: [
        work({ status: "In uitvoering", hindrance: { severe: true, consequences: ["Parkeerverbod"], start: T2, end: "2026-10-02T18:00:00Z" } }),
        work({ gipodId: 456, title: "Nieuw werk" }),
      ],
    },
    publicSpaceResult: { ok: true, items: [space(), space({ id: "sgw:R1|F1", kind: "sgw", kindLabel: "Werfzone", reference: "R1" })] },
  });
  const today = next.changes.filter((entry) => entry.observedAt === T2);
  assert.ok(today.some((entry) => entry.layer === "works" && entry.id === "work:123" && entry.type === "changed" && entry.fields.includes("status")));
  assert.ok(today.some((entry) => entry.layer === "works" && entry.id === "work:999" && entry.type === "removed"));
  assert.ok(today.some((entry) => entry.layer === "works" && entry.id === "work:456" && entry.type === "added"));
  assert.ok(today.some((entry) => entry.layer === "publicSpace" && entry.id === "sgw:R1|F1" && entry.type === "added"));
  assert.deepEqual(validateLiveHistory(next), []);
});

test("bronfout maakt vorige laag stale en veroorzaakt geen verwijderingen", () => {
  const baseline = updateLiveHistory(null, {
    observedAt: T1,
    worksResult: { ok: true, items: [work()] },
    publicSpaceResult: { ok: true, items: [space()] },
  });
  const next = updateLiveHistory(baseline, {
    observedAt: T2,
    worksResult: { ok: false, errorCode: "http_503" },
    publicSpaceResult: { ok: true, items: [space()] },
  });
  assert.equal(next.layers.works.status, "stale");
  assert.equal(next.layers.works.count, 1);
  assert.equal(next.layers.works.errorCode, "http_503");
  assert.equal(next.changes.filter((entry) => entry.observedAt === T2 && entry.layer === "works").length, 0);
  assert.deepEqual(validateLiveHistory(next), []);
});

test("compacte records nemen geen broncontacten of geometrie over", () => {
  const w = compactWorkItem(work({ secret: "niet meenemen", point: [4.4, 51.2] }));
  const p = compactPublicSpaceItem(space({ applicant: "niet meenemen", geometry: { x: 1, y: 2 } }));
  assert.equal("secret" in w, false);
  assert.equal("point" in w, false);
  assert.equal("applicant" in p, false);
  assert.equal("geometry" in p, false);
});

test("validator weigert dubbele ids en foutieve digest", () => {
  const history = updateLiveHistory(null, {
    observedAt: T1,
    worksResult: { ok: true, items: [work()] },
    publicSpaceResult: { ok: true, items: [space()] },
  });
  history.layers.works.items.push(history.layers.works.items[0]);
  history.layers.works.count = 2;
  history.layers.works.digest = "0".repeat(64);
  const errors = validateLiveHistory(history);
  assert.ok(errors.some((error) => error.includes("dubbele id")));
  assert.ok(errors.some((error) => error.includes("digest wijkt af")));
});

test("straatmetadata veroorzaakt geen operationeel change-event",()=>{const a=updateLiveHistory(null,{observedAt:T1,worksResult:{ok:true,items:[work({streets:[],streetResolution:"unresolved"})]},publicSpaceResult:{ok:true,items:[space()]}});const b=updateLiveHistory(a,{observedAt:T2,worksResult:{ok:true,items:[work({streets:[{id:"10",name:"Teststraat",postcode:"2000"}],streetResolution:"nearest_official_axis",streetDistanceMeters:4})]},publicSpaceResult:{ok:true,items:[space()]}});assert.equal(b.changes.filter(x=>x.observedAt===T2&&x.layer==="works").length,0);assert.equal(b.layers.works.items[0].streets[0].name,"Teststraat")});

// Herstelplan O1/4: geen huisnummers bij parkeerverboden, ook niet in de historiek.
test("historiek: geen huisnummers meer, en de overgang maakt geen duizenden wijzigingen", () => {
  const T1 = "2026-10-08T03:00:00.000Z", T2 = "2026-10-09T03:00:00.000Z", T3 = "2026-10-10T03:00:00.000Z";
  const parkeer = (id, adres) => ({ id: `parking:${id}`, kind: "parking", kindLabel: "Parkeerverbod", title: "Verhuis", location: adres, start: "2026-10-13T00:00:00.000Z", end: "2026-10-14T00:00:00.000Z", status: "Goedgekeurd", reference: id, detail: "", streets: [], streetResolution: "unresolved", streetDistanceMeters: null });
  assert.equal(compactPublicSpaceItem(parkeer("P1", "Teststraat 26-26 2000 Antwerpen")).location, "Teststraat, 2000 Antwerpen");
  // Een oude historiek zoals op main: adressen met huisnummer, in de items én in de wijzigingen.
  const oudItem = (id) => ({ ...parkeer(id, "Teststraat 26-26 2000 Antwerpen") });
  const vorige = {
    schemaVersion: 1, observedAt: T2, retentionDays: 90, baselineInitializedAt: T1,
    layers: {
      works: { status: "ok", lastAttemptAt: T2, lastSuccessAt: T2, errorCode: null, count: 0, digest: null, items: [] },
      publicSpace: { status: "ok", lastAttemptAt: T2, lastSuccessAt: T2, errorCode: null, count: 2, digest: null, items: [oudItem("P1"), oudItem("P2")] },
    },
    changes: [{ observedAt: T2, layer: "publicSpace", id: "parking:P2", type: "added", fields: [], before: null, after: oudItem("P2") }],
  };
  const nieuw = updateLiveHistory(vorige, {
    observedAt: T3,
    worksResult: { ok: true, items: [] },
    publicSpaceResult: { ok: true, items: [parkeer("P1", "Teststraat 26-26 2000 Antwerpen"), parkeer("P2", "Teststraat 26-26 2000 Antwerpen")] },
  });
  assert.deepEqual(nieuw.changes.filter((c) => c.observedAt === T3), [], "geen 'changed' alleen omdat het huisnummer wegviel");
  assert.deepEqual(validateLiveHistory(nieuw), []);
  assert.doesNotMatch(JSON.stringify(nieuw), /26-26/);
});
