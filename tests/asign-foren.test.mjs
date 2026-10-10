// Foren en kermissen uit A-Sign MapServer/0: één item per periode, periodetekst boven datumvelden,
// jaargrens, alleen district Antwerpen, en de vorige data bij een fout. Verzonnen fixture.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { FOREN_FIELDS, FOREN_LAYER_URL, forenItems, forenPerioden, forenQueryUrl, forenRow } from "../lib/asign-foren.mjs";
import { privacyFindings, sourceDocument, validateSourceDocument } from "../lib/source-feed.mjs";
import { buildStraatIndex } from "../lib/straatnamen.mjs";
import { SOURCE_ID, run } from "../scripts/fetch-sources-foren.mjs";

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/p7/foren.json", import.meta.url), "utf8"));
const TODAY = "2026-10-10";
const NOW = new Date("2026-10-10T03:20:00Z");
const streets = buildStraatIndex({ streets: [["1", "Voorbeeldplein", "2060", [], []], ["2", "Sint-Jansplein", "2060", [], []], ["3", "Koningin Astridplein", "2018", [], []], ["4", "Frederik van Eedenplein", "2050", [], []]] });
const quiet = () => {};

test("één item per periode, alleen district Antwerpen, alleen wat nog loopt of komt", () => {
  const { items, counts } = forenItems(fixture.features, { today: TODAY, streets });
  assert.deepEqual(
    items.map((item) => [item.id, item.title, item.date, item.endDate, item.location]),
    [
      ["foor-fo901-2026-10-03", "Najaarsfoor Voorbeeldplein", "2026-10-03", "2026-10-18", "Voorbeeldplein, 2060 Antwerpen"],
      ["foor-fo902-2026-11-21", "Najaarsfoor Sint-Jansplein", "2026-11-21", "2026-12-13", "Sint-Jansplein, 2060 Antwerpen"],
      ["foor-fo903-2026-12-04", "Winterkermis Koningin Astridplein", "2026-12-04", "2027-01-03", "Koningin Astridplein, 2018 Antwerpen"],
      ["foor-fo906-2026-10-10", "Seizoensfoor Frederik van Eedenplein", "2026-10-10", "2026-10-25", "Frederik van Eedenplein, 2050 Antwerpen"],
      ["foor-fo908-2026-11-12", "Kleine foor Voorbeeldplein", "2026-11-12", "2026-11-21", "Voorbeeldplein, 2060 Antwerpen"],
    ]
  );
  // FO904 (zomer) is voorbij, FO905 ligt in Deurne, FO907 heeft geen leesbare periode.
  assert.equal(counts.district, 7);
  assert.equal(counts.past, 2);
  assert.equal(counts.issues.periode_onleesbaar, 1);
  for (const item of items) {
    assert.deepEqual([item.theme, item.className, item.kind, item.timeSlot, item.sourceUrl, item.inDistrict], ["Activiteit", "activity", "activity", "Info", FOREN_LAYER_URL, true]);
  }
});

test("de periodetekst gaat voor op een foute einddatum (Winterkermis: einddatum 3 januari van hetzelfde jaar)", () => {
  const row = forenRow(fixture.features.find((feature) => feature.attributes.id === "FO903"));
  const { periods, issues } = forenPerioden(row, { today: TODAY });
  assert.deepEqual(periods.map((period) => [period.start, period.end]), [["2026-12-04", "2027-01-03"]]);
  assert.ok(issues.some((issue) => issue.code === "datumvelden_wijken_af"));
  // Een tweede periode begint nooit vóór de eerste.
  const twee = forenPerioden(forenRow(fixture.features.find((feature) => feature.attributes.id === "FO906")), { today: TODAY }).periods;
  assert.deepEqual(twee.map((period) => [period.index, period.start, period.end]), [[1, "2026-03-07", "2026-03-29"], [2, "2026-10-10", "2026-10-25"]]);
});

test("de personeelsvelden en vrije tekst komen nooit in de uitvoer; alleen toegelaten velden worden opgevraagd", () => {
  const { items } = forenItems(fixture.features, { today: TODAY, streets });
  const text = JSON.stringify(items);
  for (const forbidden of ["Verzonnen", "dossierBeheerder", "innameBeschrijving", "creator", "assignee", "lockOwner", "0470"]) assert.ok(!text.includes(forbidden), forbidden);
  assert.deepEqual(privacyFindings(items), []);
  const url = new URL(forenQueryUrl());
  assert.deepEqual(url.searchParams.get("outFields").split(","), [...FOREN_FIELDS]);
  assert.ok(!FOREN_FIELDS.some((field) => /beheerder|beschrijving|creator|assignee|lockowner/i.test(field)));
});

// ---------- fetcher ----------

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "district-foren-"));
  fs.mkdirSync(path.join(root, "site", "sources"), { recursive: true });
  return root;
}
const read = (root) => JSON.parse(fs.readFileSync(path.join(root, "site", "sources", `${SOURCE_ID}.json`), "utf8"));
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test("fetcher: schrijft een geldig brondocument en meldt ok", async () => {
  const root = makeRoot();
  const requested = [];
  const status = await run({ rootDir: root, clock: () => NOW, log: quiet, fetch: async (url, options) => { requested.push([url, options.headers["user-agent"]]); return json(fixture); } });
  assert.equal(status[0].fetchStatus, "ok");
  assert.equal(requested.length, 1);
  assert.match(requested[0][1], /^publieke-agenda-antwerpen\//);
  const document = read(root);
  assert.deepEqual(validateSourceDocument(document, { expectedSourceId: SOURCE_ID }), []);
  assert.ok(document.items.length >= 4);
});

test("fetcher: faalt de bron, dan blijft het vorige antwoord en zegt refresh-status waarom", async () => {
  const root = makeRoot();
  await run({ rootDir: root, clock: () => NOW, log: quiet, fetch: async () => json(fixture) });
  const before = read(root);
  for (const [fetchImpl, code] of [
    [async () => json({}, 503), "http_503"],
    [async () => json({ error: { code: 400 } }), "arcgis_error"],
    [async () => json({ features: [] }), "no_rows"],
    [async () => { throw new Error("verbinding weg"); }, "network_error"],
  ]) {
    const status = await run({ rootDir: root, clock: () => NOW, log: quiet, fetch: fetchImpl });
    assert.deepEqual([status[0].fetchStatus, status[0].errorCode], ["error", code]);
    const after = read(root);
    assert.deepEqual(after.items, before.items);
    assert.equal(after.retrievedAt, before.retrievedAt);
  }
});

test("bronbeschrijving: alleen geodata.antwerpen.be, scope district", () => {
  const document = sourceDocument(SOURCE_ID, { fetchStatus: "ok", items: [] });
  assert.deepEqual([document.scope, document.allowedHosts, document.url], ["district", ["geodata.antwerpen.be"], FOREN_LAYER_URL]);
});
