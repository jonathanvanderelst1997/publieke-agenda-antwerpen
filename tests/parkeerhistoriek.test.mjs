// Parkeerverboden in de historiek en in het verleden (besluit van de eigenaar van 3 november 2026, ±14:15, na #232):
// "Parkeerverboden komen er nooit in — hoe bedoel je, die moeten er wel in komen. Maar gewoon als parkeerverbod, niet per
// se de reden. En het huisnummer mocht dan wel." En: "vanaf nu moet dat wel allemaal bijgehouden worden." Het "geen
// historie" van eerder ging alleen over de import van vóór de start (#222, dicht).
// Deze toetsen houden vast:
// - de bestanden onder site/history (live-layers.json, het archief) bevatten weer parkeerverboden, elk als
//   "Parkeerverbod", zonder reden, zonder het woord verhuis, met de plaats in de publieke vorm (exact huisnummer);
// - het verleden van de agenda (site/verleden/parkeerverboden/) houdt ze bij;
// - een backfill van vóór de start blijft weg: geen materializer, geen pad in de databaan, en lib/history-backfill.mjs
//   weigert elke parkeerbron en elk parkeerrecord; de verversing vraagt A-Sign alleen wat nog niet voorbij is.
// Verzonnen straten, dossiers en adressen; geen netwerk.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { isParkeerItem, officieleStraatnamen } from "../lib/parkeer-historiek.mjs";
import { historiekPrivacyBevindingen } from "../lib/historiek-privacy.mjs";
import { isPubliekParkeerAdres, noemtVerhuis, parkeerAdresVoorOpslag } from "../site/adres-privacy.js";
import {
  backfillSourceCanImport,
  historyBackfillShardFile,
  isParkeerBackfillBron,
  sourceHistoryRecord,
  validateHistoryBackfillIndex,
  validateHistoryBackfillManifest,
  validateHistoryBackfillShard,
} from "../lib/history-backfill.mjs";
import { checkDataLane } from "../lib/data-lane.mjs";
import { fetchPublicSpaceHistory } from "../scripts/refresh-live-history.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const T1 = "2099-03-10T03:00:00.000Z";
const PROEF = { id: "990001", name: "Proefstraat", postcode: "2000" };
const verbod = (n, extra = {}) => ({
  id: `parking:2099-0001${n}|${n}`, kind: "parking", kindLabel: "Parkeerverbod", title: "Parkeerverbod", location: `Proefstraat ${n}, 2000 Antwerpen`,
  start: "2099-03-12T00:00:00.000Z", end: "2099-03-13T00:00:00.000Z", status: "Goedgekeurd", reference: `2099-0001${n}`, detail: "",
  streets: [PROEF], streetResolution: "nearest_official_axis", streetDistanceMeters: 3, ...extra,
});
const inname = (n) => ({ id: `iod:ET2099-000${n}|F${n}|I${n}`, kind: "iod", title: "Inname", location: "Proefstraat" });

// Elk parkeerverbod in een document: als "Parkeerverbod", zonder reden, zonder verhuis, de plaats in de publieke vorm.
function parkeerProblemen(document, straatnamen) {
  const fouten = [];
  let aantal = 0;
  const visit = (node, at) => {
    if (Array.isArray(node)) return node.forEach((child, i) => visit(child, `${at}[${i}]`));
    if (!node || typeof node !== "object") return;
    if (isParkeerItem(node) && typeof node.location === "string") {
      aantal += 1;
      if ("reason" in node) fouten.push(`${at}: reden`);
      if ("title" in node && node.title !== "Parkeerverbod") fouten.push(`${at}: titel`);
      if (noemtVerhuis(node.location) || noemtVerhuis(node.title)) fouten.push(`${at}: verhuis`);
      if (!isPubliekParkeerAdres(node.location, straatnamen) && parkeerAdresVoorOpslag(node.location, straatnamen) !== node.location) fouten.push(`${at}: plaats`);
      return;
    }
    for (const [key, child] of Object.entries(node)) visit(child, `${at}.${key}`);
  };
  visit(document, "$");
  return { fouten, aantal };
}

test("repo: de historiek bevat weer parkeerverboden, elk als Parkeerverbod met plaats en huisnummer, zonder reden", () => {
  const straatnamen = officieleStraatnamen();
  const live = JSON.parse(fs.readFileSync(path.join(repoRoot, "site", "history", "live-layers.json"), "utf8"));
  const baseline = JSON.parse(fs.readFileSync(path.join(repoRoot, "site", "history", "archive", "baseline.json"), "utf8"));
  const inLive = parkeerProblemen(live, straatnamen);
  const inBaseline = parkeerProblemen(baseline, straatnamen);
  assert.ok(inLive.aantal > 0, "parkeerverboden in live-layers.json");
  assert.ok(inBaseline.aantal > 0, "parkeerverboden in de baseline van het archief");
  assert.deepEqual(inLive.fouten.slice(0, 5), []);
  assert.deepEqual(inBaseline.fouten.slice(0, 5), []);
  // Ook een huisnummer, waar de bron er een geeft (regel van 26 oktober 2026).
  assert.ok(live.layers.publicSpace.items.filter(isParkeerItem).some((item) => isPubliekParkeerAdres(item.location, straatnamen)));
  // En de privacyscan van de historiek vindt niets.
  assert.deepEqual(historiekPrivacyBevindingen(live).slice(0, 5), []);
});

test("herkenning: wat een parkeerverbod is, en wat niet", () => {
  assert.equal(isParkeerItem(verbod(1)), true);
  assert.equal(isParkeerItem({ id: "x", kind: "parking" }), true);
  assert.equal(isParkeerItem(inname(1)), false);
  assert.equal(isParkeerItem({ id: "work:1" }), false);
});

// ---------- geen backfill van vóór de start (#222) ----------

test("backfill: de materializer van de A-Sign-parkeerhistoriek is weg, en niets roept hem nog aan", () => {
  assert.equal(fs.existsSync(path.join(repoRoot, "scripts", "backfill-asign-parking-history.mjs")), false);
  const pkg = fs.readFileSync(path.join(repoRoot, "package.json"), "utf8");
  assert.doesNotMatch(pkg, /backfill/i);
  const plekken = ["lib", "scripts", ".github/workflows"].flatMap((dir) => fs.readdirSync(path.join(repoRoot, dir)).map((name) => path.join(dir, name)))
    .filter((file) => fs.statSync(path.join(repoRoot, file)).isFile());
  const treffers = plekken.filter((file) => /backfill-asign-parking|buildAsignParkingBackfill|ASIGN_PARKING_BACKFILL/.test(fs.readFileSync(path.join(repoRoot, file), "utf8"))
    && file !== "lib/history-backfill.mjs");
  assert.deepEqual(treffers, []);
});

test("backfill: de databaan kan geen backfill van parkeerverboden schrijven", () => {
  const spec = JSON.parse(fs.readFileSync(path.join(repoRoot, "lib", "data-lane-paths.json"), "utf8"));
  for (const file of ["site/history/backfill/asign-parking/2019.json", "site/history/backfill/asign-parking/2026.json", "site/history/backfill/asign-parking/index.json"]) {
    assert.ok(checkDataLane([`A\t${file}`], spec).some((v) => v.code === "path_not_allowed"), file);
  }
  assert.ok(spec.allowed.every((pattern) => !/backfill/.test(pattern) || !/park/i.test(pattern)));
  // Wat de site zelf zag, mag wel: de historiek en het verleden.
  assert.deepEqual(checkDataLane(["M\tsite/history/live-layers.json", "M\tsite/verleden/parkeerverboden/2099-03.json"], spec), []);
});

test("backfill: het contract weigert elke bron en elk record van een parkeerverbod", () => {
  const bron = {
    sourceId: "asign-parking", completeness: "full", coverageFrom: "2019-09-16", coverageTo: null,
    sourceUrl: "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/20",
    evidence: "De officiële laagbeschrijving zegt expliciet dat de laag de volledige historiek bevat.",
    dedupeKey: "Dossiernummer|Locatienummer", snapshotDigest: null,
  };
  for (const variant of [bron, { ...bron, sourceId: "a-sign-laag" }, { ...bron, sourceId: "parkeerverboden", sourceUrl: "https://voorbeeld.test/x" },
    { ...bron, sourceId: "asign-oud", sourceUrl: "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/21" }]) {
    assert.equal(isParkeerBackfillBron(variant), true, JSON.stringify(variant));
    assert.equal(backfillSourceCanImport(variant), false, JSON.stringify(variant));
    assert.ok(validateHistoryBackfillManifest({ schemaVersion: 1, sources: [variant] }).some((e) => e.includes("geen backfill van parkeerverboden")));
  }
  // Andere A-Sign-lagen (innames 22/23, werfzones 47/48) zijn geen parkeerbron.
  assert.equal(isParkeerBackfillBron({ ...bron, sourceId: "asign-iod", sourceUrl: "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/22" }), false);
  assert.equal(isParkeerBackfillBron({ ...bron, sourceId: "asign-sgw", sourceUrl: "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/200" }), false);

  assert.throws(() => sourceHistoryRecord({ sourceId: "asign-parking", sourceRecordId: "D|L", validFrom: "2020-01-01", validTo: "2020-01-02", payload: { id: "x" } }), /geen backfill van parkeerverboden/);
  assert.throws(() => sourceHistoryRecord({ sourceId: "voorbeeld-bron", sourceRecordId: "D|L", validFrom: "2020-01-01", validTo: "2020-01-02", payload: verbod(1) }), /geen backfill van parkeerverboden/);
  assert.throws(() => historyBackfillShardFile("asign-parking", 2020), /geen backfill van parkeerverboden/);

  const shard = { schemaVersion: 1, sourceId: "voorbeeld-bron", year: 2020, records: [{ sourceId: "voorbeeld-bron", sourceRecordId: "D|L", validFrom: "2020-01-01", validTo: "2020-01-02", payload: verbod(1) }] };
  assert.ok(validateHistoryBackfillShard(shard).some((e) => e.includes("geen backfill van parkeerverboden")));
  assert.ok(validateHistoryBackfillShard({ ...shard, sourceId: "asign-parking", records: [] }).some((e) => e.includes("geen backfill van parkeerverboden")));
  const index = { schemaVersion: 1, generatedAt: T1, sources: [{ ...bron, shards: [] }] };
  assert.ok(validateHistoryBackfillIndex(index).some((e) => e.includes("geen backfill van parkeerverboden")));
});

test("de verversing vraagt aan A-Sign alleen parkeerverboden die nog niet voorbij zijn", async () => {
  const vragen = [];
  const nep = async (input) => {
    const url = new URL(String(input));
    const laag = url.pathname.match(/\/P_ASign\/ASign\/MapServer\/(\d+)\/query$/)?.[1];
    if (laag) {
      vragen.push([laag, url.searchParams.get("where")]);
      return Response.json(url.searchParams.get("returnIdsOnly") === "true" ? { objectIds: [] } : { features: [] });
    }
    if (url.pathname.includes("/portal_publiek2/MapServer/109/")) return Response.json({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[4.38, 51.2], [4.43, 51.2], [4.43, 51.24], [4.38, 51.24], [4.38, 51.2]]] } }] });
    return new Response("", { status: 404 });
  };
  const resultaat = await fetchPublicSpaceHistory({ fetch: nep, clock: () => new Date("2099-03-10T04:00:00Z"), streets: null });
  assert.equal(resultaat.ok, true);
  const parkeer = vragen.filter(([laag]) => laag === "20" || laag === "21");
  assert.ok(parkeer.length > 0);
  assert.ok(parkeer.every(([laag, where]) => laag === "20" && /Einddatum >= DATE '2099-03-10'/.test(where)), JSON.stringify(parkeer));
});
