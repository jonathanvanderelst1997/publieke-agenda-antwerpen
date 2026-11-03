// Besluit van de eigenaar van 3 november 2026: "er moet geen historie zijn van parkeerverboden".
// Een lopend of komend parkeerverbod staat op de site (live en in de straatbestanden van de ochtend); is het voorbij, dan
// bewaart de site er niets van. Deze toetsen houden dat vast:
// - de bestanden onder site/history in de repo (live-layers.json, archive/, radar.json, een eventuele backfill) bevatten
//   geen parkeerverbod;
// - de verversing (updateLiveHistory, het archief, de privacyopkuis, de radar) neemt er nooit een op, ook niet uit een
//   oudere stand, en maakt bij de overgang geen "removed" per parkeerverbod;
// - scripts/opkuis-historiek-privacy.mjs haalt ze uit oude bestanden, en validate-data houdt een bestand met een
//   parkeerverbod tegen (zonder de waarde te noemen);
// - de backfill van de A-Sign-parkeerhistoriek is weg en kan niet terugkomen: geen materializer, geen pad in de databaan,
//   en lib/history-backfill.mjs weigert elke parkeerbron en elk parkeerrecord;
// - de verversing vraagt aan A-Sign alleen parkeerverboden die nog niet voorbij zijn.
// Verzonnen straten, dossiers en adressen; geen netwerk.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { isParkeerItem, isParkeerWijziging, parkeerverbodenInHistoriek } from "../lib/parkeer-historiek.mjs";
import { compactPublicSpaceItem, updateLiveHistory, validateLiveHistory } from "../lib/live-history.mjs";
import {
  historyArchiveEventsDigest,
  historyArchiveEventsForRun,
  scrubHistoryArchiveDay,
  updateHistoryArchiveBaseline,
  updateHistoryArchiveDay,
  validateHistoryArchiveDay,
} from "../lib/live-history-archive.mjs";
import { archiefBaselineVoorPubliek, archiefDagVoorPubliek, historiekVoorPubliek, resultaatVoorHistoriek } from "../lib/historiek-privacy.mjs";
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
import { bouwRadar, radarBinnenBudget } from "../scripts/build-straat-snapshots.mjs";
import { fetchPublicSpaceHistory } from "../scripts/refresh-live-history.mjs";
import { opkuisHistoriekPrivacy } from "../scripts/opkuis-historiek-privacy.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const T1 = "2099-03-10T03:00:00.000Z";
const T2 = "2099-03-11T03:00:00.000Z";
const T3 = "2099-03-12T03:00:00.000Z";
const PROEF = { id: "990001", name: "Proefstraat", postcode: "2000" };

const verbod = (n, extra = {}) => ({
  id: `parking:2099-0001${n}|${n}`, kind: "parking", kindLabel: "Parkeerverbod", title: "Parkeerverbod", location: `Proefstraat ${n}, 2000 Antwerpen`,
  start: "2099-03-12T00:00:00.000Z", end: "2099-03-13T00:00:00.000Z", status: "Goedgekeurd", reference: `2099-0001${n}`, detail: "",
  streets: [PROEF], streetResolution: "nearest_official_axis", streetDistanceMeters: 3, ...extra,
});
const inname = (n, extra = {}) => ({
  id: `iod:ET2099-000${n}|F${n}|I${n}`, kind: "iod", kindLabel: "Inname openbaar domein", title: "Inname", location: "Proefstraat",
  start: "2099-03-12T00:00:00.000Z", end: "2099-03-13T00:00:00.000Z", status: "aanvraag_goedgekeurd", reference: `ET2099-000${n}`, detail: "",
  streets: [PROEF], streetResolution: "nearest_official_axis", streetDistanceMeters: 3, ...extra,
});
const werk = { gipodId: 990001, title: "2000 Antwerpen, Proefstraat", status: "In uitvoering", start: "2099-03-01T06:00:00Z", end: "2099-03-30T18:00:00Z", owner: "Proefbedrijf", ownerGroup: "Andere", boundaryConfidence: "point_inside_new", workTypes: [], occupancyTypes: [], hindrance: null };
const ps = (...items) => ({ ok: true, items });
const ws = { ok: true, items: [werk] };
const wijziging = (observedAt, item, type = "added") => ({ observedAt, layer: "publicSpace", id: item.id, type, fields: [], before: type === "added" ? null : item, after: type === "added" ? item : null });

// ---------- de bestanden in de repo ----------

const bestandenOnder = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const target = path.join(dir, entry.name);
  return entry.isDirectory() ? bestandenOnder(target) : entry.name.endsWith(".json") ? [target] : [];
}) : []).sort();

test("repo: geen enkel parkeerverbod onder site/history (historiek, archief, radar, backfill)", () => {
  const bestanden = bestandenOnder(path.join(repoRoot, "site", "history"));
  assert.ok(bestanden.some((file) => file.endsWith("live-layers.json")), "site/history/live-layers.json ontbreekt");
  const fouten = [];
  for (const file of bestanden) {
    const aantal = parkeerverbodenInHistoriek(JSON.parse(fs.readFileSync(file, "utf8"))).length;
    if (aantal) fouten.push(`${path.relative(repoRoot, file)}: ${aantal}`);
  }
  assert.deepEqual(fouten, [], `parkeerverboden in de historiek (draai node scripts/opkuis-historiek-privacy.mjs --write en node scripts/build-straat-snapshots.mjs --alleen-radar):\n${fouten.join("\n")}`);
  // Zonder backfill van de parkeerverboden.
  assert.equal(fs.existsSync(path.join(repoRoot, "site", "history", "backfill", "asign-parking")), false);
});

test("repo: de radar telt alleen wat de historiek zonder parkeerverboden telt", () => {
  const live = JSON.parse(fs.readFileSync(path.join(repoRoot, "site", "history", "live-layers.json"), "utf8"));
  const radar = JSON.parse(fs.readFileSync(path.join(repoRoot, "site", "history", "radar.json"), "utf8"));
  // Zelfde verversing: dan is de radar precies die van deze historiek (zonder parkeerverboden). Na een merge met een
  // nieuwere historiek kan de radar een verversing achterlopen; dan toetsen we alleen de straten van die verversing niet.
  if (radar.ververst === live.observedAt) assert.deepEqual(radar, radarBinnenBudget(live));
});

// ---------- de verversing ----------

test("updateLiveHistory: geen parkeerverbod in de laag of in de wijzigingen, ook niet uit een oudere stand", () => {
  assert.equal(compactPublicSpaceItem(verbod(1)), null);
  const eerst = updateLiveHistory(null, { observedAt: T1, worksResult: ws, publicSpaceResult: ps(verbod(1), inname(1)) });
  const daarna = updateLiveHistory(eerst, { observedAt: T2, worksResult: ws, publicSpaceResult: ps(verbod(2), inname(1), inname(2)) });
  for (const doc of [eerst, daarna]) {
    assert.deepEqual(parkeerverbodenInHistoriek(doc), []);
    assert.deepEqual(validateLiveHistory(doc), []);
  }
  assert.deepEqual(daarna.changes.map((c) => [c.type, c.id]), [["added", inname(2).id]], "alleen de nieuwe inname");

  // Een oudere stand zoals main ze tot 3 november 2026 schreef: parkeerverboden in de laag en in de wijzigingen.
  const oud = {
    ...daarna,
    layers: { ...daarna.layers, publicSpace: { ...daarna.layers.publicSpace, items: [...daarna.layers.publicSpace.items, verbod(3), verbod(4)], count: daarna.layers.publicSpace.count + 2, digest: null } },
    changes: [...daarna.changes, wijziging(T2, verbod(3)), wijziging(T2, verbod(5), "removed"), { observedAt: T2, layer: "publicSpace", id: verbod(4).id, type: "changed", fields: ["end"], before: { end: "x" }, after: { end: "y" } }],
  };
  assert.ok(parkeerverbodenInHistoriek(oud).length >= 5);
  const nieuw = updateLiveHistory(oud, { observedAt: T3, worksResult: ws, publicSpaceResult: ps(verbod(3), inname(1), inname(2)) });
  assert.deepEqual(parkeerverbodenInHistoriek(nieuw), []);
  assert.deepEqual(nieuw.changes.filter((c) => c.observedAt === T3), [], "geen 'removed' voor elk oud parkeerverbod");
  assert.deepEqual(nieuw.layers.publicSpace.items.map((i) => i.id), [inname(1).id, inname(2).id]);
  assert.deepEqual(validateLiveHistory(nieuw), []);
});

test("archief: geen parkeerverbod in de baseline of in een dag, ook niet uit een oudere stand", () => {
  const history = updateLiveHistory(null, { observedAt: T1, worksResult: ws, publicSpaceResult: ps(verbod(1), inname(1)) });
  // Ook als een laag van de historiek er toch een zou hebben: de baseline neemt het niet over.
  const metVerbod = { ...history, layers: { ...history.layers, publicSpace: { ...history.layers.publicSpace, items: [...history.layers.publicSpace.items, verbod(2)] } } };
  const baseline = updateHistoryArchiveBaseline(null, metVerbod);
  assert.deepEqual(baseline.layers.publicSpace.items.map((i) => i.id), [inname(1).id]);
  // Een oude baseline verliest haar parkeerverboden, maar blijft de baseline van haar dag.
  const oudeBaseline = { schemaVersion: 1, layers: { works: null, publicSpace: { observedAt: T1, items: [verbod(1), inname(1)] } } };
  const opnieuw = updateHistoryArchiveBaseline(oudeBaseline, metVerbod);
  assert.deepEqual(opnieuw.layers.publicSpace, { observedAt: T1, items: [inname(1)] });
  assert.deepEqual(archiefBaselineVoorPubliek(oudeBaseline).layers.publicSpace.items.map((i) => i.id), [inname(1).id]);

  // De events van een verversing en een dag: zonder parkeerverboden, en een oude dag verliest ze.
  const run = { observedAt: T2, layers: history.layers, changes: [wijziging(T2, verbod(2)), wijziging(T2, inname(2)), wijziging(T2, verbod(1), "removed")] };
  assert.deepEqual(historyArchiveEventsForRun(run, baseline).map((e) => e.id), [inname(2).id]);
  const oudeDag = { schemaVersion: 1, date: "2099-03-11", events: [wijziging(T2, verbod(1), "removed"), wijziging(T2, inname(2))] };
  const dag = updateHistoryArchiveDay(oudeDag, T2, [wijziging(T2, verbod(3))]);
  assert.deepEqual(dag.events.map((e) => e.id), [inname(2).id]);
  assert.deepEqual(validateHistoryArchiveDay(dag), []);
  assert.deepEqual(scrubHistoryArchiveDay(oudeDag).events.map((e) => e.id), [inname(2).id]);
  assert.deepEqual(archiefDagVoorPubliek(oudeDag).events.map((e) => e.id), [inname(2).id]);
  assert.equal(scrubHistoryArchiveDay(dag), dag, "een schone dag blijft hetzelfde object");
});

test("privacyopkuis van de verversing: het resultaat en de vorige stand gaan zonder parkeerverboden naar de historiek", () => {
  const resultaat = resultaatVoorHistoriek(ps(verbod(1), verbod(2), inname(1)));
  assert.deepEqual(resultaat.items.map((i) => i.id), [inname(1).id]);
  assert.equal(resultaat.parkeerverboden, 2);
  const oud = updateLiveHistory(null, { observedAt: T1, worksResult: ws, publicSpaceResult: ps(inname(1)) });
  oud.layers.publicSpace.items.push(verbod(1));
  oud.changes.push(wijziging(T1, verbod(1)));
  const publiek = historiekVoorPubliek(oud);
  assert.deepEqual(parkeerverbodenInHistoriek(publiek), []);
  assert.equal(publiek.layers.publicSpace.count, 1);
  assert.deepEqual(validateLiveHistory(publiek), []);
});

test("radar: een wijziging van een parkeerverbod telt nooit mee", () => {
  const nu = Date.now(), dag = 86_400_000, iso = (t) => new Date(t).toISOString();
  const observedAt = iso(nu - dag / 2);
  const zonder = { observedAt, layers: { works: { status: "ok", items: [] }, publicSpace: { status: "ok", items: [inname(1)] } }, changes: [wijziging(observedAt, inname(1))] };
  const met = {
    ...zonder,
    layers: { ...zonder.layers, publicSpace: { status: "ok", items: [inname(1), verbod(1)] } },
    changes: [...zonder.changes, wijziging(observedAt, verbod(1)), wijziging(observedAt, verbod(2), "removed"), { ...wijziging(observedAt, verbod(3), "removed"), id: "zonder-soort" }],
  };
  assert.deepEqual(bouwRadar(met), bouwRadar(zonder));
  assert.deepEqual(Object.values(bouwRadar(met).straten), [[[0, 1, 0, 0]]], "alleen de inname");
});

test("eenmalige opkuis: haalt elk parkeerverbod uit oude bestanden, houdt de index geldig, en is daarna een no-op", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "geen-parkeerhistoriek-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const schoon = updateLiveHistory(null, { observedAt: T1, worksResult: ws, publicSpaceResult: ps(inname(1)) });
  const live = {
    ...schoon, observedAt: T2,
    // De digest van de laag zoals toen (met het parkeerverbod): de opkuis rekent hem opnieuw.
    layers: { ...schoon.layers, publicSpace: { ...schoon.layers.publicSpace, items: [...schoon.layers.publicSpace.items, verbod(1)], count: 2, digest: "0".repeat(64) } },
    changes: [wijziging(T2, verbod(1)), wijziging(T2, inname(2))],
  };
  const dag1 = { schemaVersion: 1, date: "2099-03-10", events: [wijziging(T1, verbod(2), "removed")] };
  const dag2 = { schemaVersion: 1, date: "2099-03-11", events: live.changes };
  const index = { schemaVersion: 1, baselineInitializedAt: T1, lastObservedAt: T2, days: [dag1, dag2].map((d) => ({ date: d.date, file: `site/history/archive/${d.date}.json`, count: d.events.length, digest: historyArchiveEventsDigest(d.events) })) };
  const schrijf = (relative, value) => {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), `${JSON.stringify(value, null, 2)}\n`);
  };
  schrijf("site/history/live-layers.json", live);
  schrijf("site/history/archive/baseline.json", { schemaVersion: 1, layers: { works: null, publicSpace: { observedAt: T1, items: [verbod(3), inname(1)] } } });
  schrijf("site/history/archive/2099-03-10.json", dag1);
  schrijf("site/history/archive/2099-03-11.json", dag2);
  schrijf("site/history/archive/index.json", index);

  const rapport = opkuisHistoriekPrivacy({ rootDir: root, write: true });
  assert.equal(rapport.files["site/history/live-layers.json"].bevindingenVoor.parkeerverbod, 2);
  assert.deepEqual(rapport.files["site/history/live-layers.json"].bevindingenNa, {});
  assert.deepEqual(rapport.leegGeworden, ["site/history/archive/2099-03-10.json"], "een dag met alleen een parkeerverbod verdwijnt");
  assert.deepEqual(rapport.nogBevindingen, {});
  assert.deepEqual(rapport.nietGeschreven, {});
  for (const file of bestandenOnder(path.join(root, "site", "history"))) {
    assert.deepEqual(parkeerverbodenInHistoriek(JSON.parse(fs.readFileSync(file, "utf8"))), [], path.relative(root, file));
  }
  const indexNa = JSON.parse(fs.readFileSync(path.join(root, "site/history/archive/index.json"), "utf8"));
  const dagNa = JSON.parse(fs.readFileSync(path.join(root, "site/history/archive/2099-03-11.json"), "utf8"));
  assert.deepEqual(indexNa.days.map((d) => [d.date, d.count, d.digest]), [["2099-03-11", 1, historyArchiveEventsDigest(dagNa.events)]]);
  assert.deepEqual(validateLiveHistory(JSON.parse(fs.readFileSync(path.join(root, "site/history/live-layers.json"), "utf8"))), []);
  assert.deepEqual(opkuisHistoriekPrivacy({ rootDir: root, write: true }).gewijzigd, [], "tweede keer verandert niets");
});

test("validate-data houdt een parkeerverbod onder site/history tegen, met het pad en zonder de waarde", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "geen-parkeerhistoriek-validatie-"));
  try {
    fs.cpSync(path.join(repoRoot, "lib"), path.join(root, "lib"), { recursive: true });
    fs.mkdirSync(path.join(root, "scripts"));
    fs.copyFileSync(path.join(repoRoot, "scripts", "validate-data.mjs"), path.join(root, "scripts", "validate-data.mjs"));
    fs.mkdirSync(path.join(root, "site", "history"), { recursive: true });
    for (const name of fs.readdirSync(path.join(repoRoot, "site")).filter((entry) => entry.endsWith(".js"))) {
      fs.copyFileSync(path.join(repoRoot, "site", name), path.join(root, "site", name));
    }
    const history = updateLiveHistory(null, { observedAt: T1, worksResult: ws, publicSpaceResult: ps(inname(1)) });
    history.changes.push(wijziging(T1, verbod(7)));
    fs.writeFileSync(path.join(root, "site/history/live-layers.json"), JSON.stringify(history));
    const run = spawnSync(process.execPath, [path.join(root, "scripts", "validate-data.mjs")], { encoding: "utf8" });
    const regels = run.stderr.split("\n").filter((line) => line.includes("parkeerverbod"));
    assert.deepEqual(regels, [
      "site/history/live-layers.json: parkeerverbod op $.changes[0]",
      "site/history: 1 parkeerverboden; er hoort geen historiek van parkeerverboden te zijn; oplossing: node scripts/opkuis-historiek-privacy.mjs --write",
    ]);
    assert.notEqual(run.status, 0);
    assert.equal(run.stderr.includes("Proefstraat 7"), false, "de melding toont geen adres");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("herkenning: wat een parkeerverbod is, en wat niet", () => {
  assert.equal(isParkeerItem(verbod(1)), true);
  assert.equal(isParkeerItem({ id: "x", kind: "parking" }), true);
  assert.equal(isParkeerItem(inname(1)), false);
  assert.equal(isParkeerItem({ id: "work:1" }), false);
  assert.equal(isParkeerWijziging({ id: "parking:a" }), true);
  assert.equal(isParkeerWijziging({ id: "x", before: { kind: "parking" }, after: null }), true);
  assert.equal(isParkeerWijziging(wijziging(T1, inname(1))), false);
  // De scan noemt het pad, nooit de waarde.
  const vondsten = parkeerverbodenInHistoriek({ layers: { publicSpace: { items: [inname(1), verbod(1)] } } });
  assert.deepEqual(vondsten, [{ code: "parkeerverbod", path: "$.layers.publicSpace.items[1]" }]);
});

// ---------- de backfill ----------

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

test("backfill: de databaan kan geen parkeerhistoriek schrijven", () => {
  const spec = JSON.parse(fs.readFileSync(path.join(repoRoot, "lib", "data-lane-paths.json"), "utf8"));
  for (const file of ["site/history/backfill/asign-parking/2019.json", "site/history/backfill/asign-parking/2026.json", "site/history/backfill/asign-parking/index.json"]) {
    assert.ok(checkDataLane([`A\t${file}`], spec).some((v) => v.code === "path_not_allowed"), file);
  }
  assert.ok(spec.allowed.every((pattern) => !/park/i.test(pattern)));
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
