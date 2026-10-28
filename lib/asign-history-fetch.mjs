// Bounded transport for historical A-Sign data. Public projection happens afterwards.
export const ASIGN_HISTORY_BATCH_SIZE = 100;
export const ASIGN_HISTORY_MAX_RECORDS = 15_000;
const QUERY_URL = "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/20/query";
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
function fail(code) { const error = new Error(code); error.code = code; throw error; }
function validObjectId(value) { return Number.isSafeInteger(value) && value >= 0; }

async function getJson(params, fetchImpl) {
  const url = new URL(QUERY_URL);
  url.search = new URLSearchParams({ f: "json", ...params });
  const signal = AbortSignal.timeout(15_000);
  let text;
  try {
    const response = await fetchImpl(url, { headers: { Accept: "application/json" }, redirect: "error", signal });
    if (!response.ok) fail("asign_history_http_failed");
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) fail("asign_history_response_too_large");
    if (!response.body) fail("asign_history_invalid_response");
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          fail("asign_history_response_too_large");
        }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    text = Buffer.concat(chunks, bytes).toString("utf8");
  } catch (error) {
    if (String(error?.code || "").startsWith("asign_history_")) throw error;
    fail(signal.aborted ? "asign_history_timeout" : "asign_history_request_failed");
  }
  let data;
  try { data = JSON.parse(text); } catch { fail("asign_history_invalid_json"); }
  if (!data || typeof data !== "object" || Array.isArray(data)) fail("asign_history_invalid_response");
  if (data.error) fail("asign_history_provider_error");
  if (data.exceededTransferLimit === true) fail("asign_history_transfer_limit");
  return data;
}

export async function asignHistoryLayer(layer, { where, outFields } = {}, fetchImpl = globalThis.fetch) {
  if (layer !== 20) fail("asign_history_layer_not_allowed");
  if (typeof where !== "string" || !where.trim() || where.length > 2_000) fail("asign_history_where_invalid");
  if (typeof outFields !== "string") fail("asign_history_fields_invalid");
  const requestedFields = outFields.split(",").map((field) => field.trim());
  if (!requestedFields.length || requestedFields.some((field) => !FIELD_NAME.test(field))) fail("asign_history_fields_invalid");
  const idData = await getJson({ where, returnIdsOnly: "true" }, fetchImpl);
  if (!Array.isArray(idData.objectIds)) fail("asign_history_ids_missing");
  if (idData.objectIds.length > ASIGN_HISTORY_MAX_RECORDS) fail("asign_history_record_limit");
  if (idData.objectIds.some((id) => !validObjectId(id))) fail("asign_history_id_invalid");
  if (new Set(idData.objectIds).size !== idData.objectIds.length) fail("asign_history_ids_duplicate");
  const objectIdField = idData.objectIdFieldName ?? "OBJECTID";
  if (typeof objectIdField !== "string" || !FIELD_NAME.test(objectIdField)) fail("asign_history_id_field_invalid");
  const fields = [...new Set([...requestedFields, objectIdField])].join(",");
  const ids = [...idData.objectIds].sort((a, b) => a - b);
  const features = [];
  for (let offset = 0; offset < ids.length; offset += ASIGN_HISTORY_BATCH_SIZE) {
    const batch = ids.slice(offset, offset + ASIGN_HISTORY_BATCH_SIZE);
    const expected = new Set(batch);
    const data = await getJson({ where, objectIds: batch.join(","), outFields: fields, returnGeometry: "false" }, fetchImpl);
    if (!Array.isArray(data.features)) fail("asign_history_features_missing");
    if (data.features.length !== batch.length) fail("asign_history_batch_incomplete");
    const received = new Map();
    for (const feature of data.features) {
      const id = feature?.attributes?.[objectIdField];
      if (!validObjectId(id) || !expected.has(id)) fail("asign_history_unexpected_object");
      if (received.has(id)) fail("asign_history_object_duplicate");
      received.set(id, feature);
    }
    if (received.size !== expected.size) fail("asign_history_batch_incomplete");
    for (const id of batch) features.push(received.get(id));
  }
  return features;
}
