import assert from "node:assert/strict";
import test from "node:test";

import { ASIGN_DETAIL_BATCH_SIZE, asignLayer } from "../scripts/refresh-live-history.mjs";

test("A-Sign detailquery splitst objectIds in URL-veilige batches van maximaal 100", async () => {
  const ids = Array.from({ length: 251 }, (_, index) => index + 1);
  const batches = [];
  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    if (url.searchParams.get("returnIdsOnly") === "true") {
      return Response.json({ objectIds: ids });
    }
    const batch = String(url.searchParams.get("objectIds") || "")
      .split(",")
      .filter(Boolean)
      .map(Number);
    batches.push(batch);
    return Response.json({
      features: batch.map((OBJECTID) => ({ attributes: { OBJECTID } })),
    });
  };

  const features = await asignLayer(
    20,
    { where: "1=1", outFields: "OBJECTID" },
    fetchImpl
  );

  assert.equal(ASIGN_DETAIL_BATCH_SIZE, 100);
  assert.deepEqual(batches.map((batch) => batch.length), [100, 100, 51]);
  assert.ok(batches.every((batch) => batch.length <= 100));
  assert.equal(features.length, 251);
});
