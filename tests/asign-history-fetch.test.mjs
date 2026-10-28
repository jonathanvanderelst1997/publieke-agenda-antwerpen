import assert from "node:assert/strict";
import test from "node:test";
import { ASIGN_HISTORY_BATCH_SIZE, ASIGN_HISTORY_MAX_RECORDS, asignHistoryLayer } from "../lib/asign-history-fetch.mjs";
const params = { where: "District='ANTWERPEN' AND Startdatum >= DATE '2019-09-16'", outFields: "Dossiernummer,Locatienummer,District" };
const feature = (OBJECTID) => ({ attributes: { OBJECTID } });
function provider({ ids = [1, 2], idDocument, detailDocument, detailFeatures } = {}) {
  return async (input) => {
    const url = new URL(String(input));
    assert.equal(url.origin + url.pathname, "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/20/query");
    if (url.searchParams.get("returnIdsOnly") === "true") return Response.json(idDocument ?? { objectIdFieldName: "OBJECTID", objectIds: ids });
    const batch = url.searchParams.get("objectIds").split(",").map(Number);
    return Response.json(detailDocument ?? { features: detailFeatures ? detailFeatures(batch) : batch.map(feature) });
  };
}
test("historical transport reads all IDs in stable bounded batches", async () => {
  const ids = Array.from({ length: 251 }, (_, i) => i + 1), batches = [];
  const fetch = async (input, options) => {
    const url = new URL(String(input));
    assert.equal(options.redirect, "error"); assert.ok(options.signal);
    assert.equal(url.searchParams.get("where"), params.where);
    if (url.searchParams.get("returnIdsOnly") === "true") return Response.json({ objectIds: [...ids].reverse(), objectIdFieldName: "OBJECTID" });
    const batch = url.searchParams.get("objectIds").split(",").map(Number); batches.push(batch);
    assert.ok(url.searchParams.get("outFields").split(",").includes("OBJECTID"));
    assert.equal(url.searchParams.get("returnGeometry"), "false");
    return Response.json({ features: [...batch].reverse().map(feature) });
  };
  const rows = await asignHistoryLayer(20, params, fetch);
  assert.equal(ASIGN_HISTORY_BATCH_SIZE, 100);
  assert.deepEqual(batches.map((b) => b.length), [100, 100, 51]);
  assert.deepEqual(rows.map((r) => r.attributes.OBJECTID), ids);
});
test("an explicit empty ID list differs from missing or invalid IDs", async () => {
  assert.deepEqual(await asignHistoryLayer(20, params, provider({ ids: [] })), []);
  await assert.rejects(asignHistoryLayer(20, params, provider({ idDocument: {} })), /asign_history_ids_missing/);
  for (const ids of [[1, 1], [1, "2"], [-1], [Number.MAX_SAFE_INTEGER + 1]]) {
    await assert.rejects(asignHistoryLayer(20, params, provider({ ids })), /asign_history_id(?:s_duplicate|_invalid)/);
  }
  await assert.rejects(asignHistoryLayer(20, params, provider({ ids: Array.from({ length: ASIGN_HISTORY_MAX_RECORDS + 1 }, (_, i) => i) })), /asign_history_record_limit/);
});
test("transfer limits and incomplete or duplicate batches stop the import", async () => {
  const cases = [
    [{ idDocument: { objectIds: [1], exceededTransferLimit: true } }, /asign_history_transfer_limit/],
    [{ detailDocument: { features: [feature(1), feature(2)], exceededTransferLimit: true } }, /asign_history_transfer_limit/],
    [{ detailFeatures: () => [feature(1)] }, /asign_history_batch_incomplete/],
    [{ detailFeatures: () => [feature(1), feature(1)] }, /asign_history_object_duplicate/],
    [{ detailFeatures: () => [feature(1), feature(99)] }, /asign_history_unexpected_object/],
    [{ detailDocument: {} }, /asign_history_features_missing/],
    [{ detailDocument: { error: { code: 500 } } }, /asign_history_provider_error/]
  ];
  for (const [input, error] of cases) await assert.rejects(asignHistoryLayer(20, params, provider(input)), error);
});
test("only the fixed layer and validated fields are accepted", async () => {
  await assert.rejects(asignHistoryLayer(21, params, provider()), /asign_history_layer_not_allowed/);
  await assert.rejects(asignHistoryLayer(20, { ...params, outFields: "*" }, provider()), /asign_history_fields_invalid/);
  await assert.rejects(asignHistoryLayer(20, params, provider({ idDocument: { objectIds: [1], objectIdFieldName: "OBJECTID,*" } })), /asign_history_id_field_invalid/);
});
test("HTTP errors, invalid JSON and oversized bodies cannot count as success", async () => {
  await assert.rejects(asignHistoryLayer(20, params, async () => new Response("", { status: 503 })), /asign_history_http_failed/);
  await assert.rejects(asignHistoryLayer(20, params, async () => new Response("{")), /asign_history_invalid_json/);
  await assert.rejects(asignHistoryLayer(20, params, async () => new Response("x".repeat(4 * 1024 * 1024 + 1))), /asign_history_response_too_large/);
});
