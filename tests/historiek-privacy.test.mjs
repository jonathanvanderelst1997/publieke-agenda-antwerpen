// P4: privacy van de historiek (lib/historiek-privacy.mjs). Verzonnen adressen, behalve in de scan
// over de echte bestanden onder site/history; die toont nooit een gevonden waarde, alleen aantallen
// en bestandsnamen (de CI-logs zijn publiek).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  adresAlleenStraat,
  archiefDagVoorPubliek,
  historiekPrivacyBevindingen,
  historiekVoorPubliek,
  resultaatVoorHistoriek,
  tekstZonderHuisnummers,
} from "../lib/historiek-privacy.mjs";
import { updateLiveHistory, validateLiveHistory } from "../lib/live-history.mjs";
import { opkuisHistoriekPrivacy } from "../scripts/opkuis-historiek-privacy.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

test('"Xstraat 12" wordt "Xstraat": adressen houden alleen straat en postcode', () => {
  assert.equal(adresAlleenStraat("Xstraat 12 2000 Antwerpen"), "Xstraat, 2000 Antwerpen");
  assert.equal(adresAlleenStraat("Xstraat 12-14 2000 Antwerpen"), "Xstraat, 2000 Antwerpen");
  assert.equal(adresAlleenStraat("Xstraat 12 bus 3 2000 Antwerpen"), "Xstraat, 2000 Antwerpen");
  assert.equal(adresAlleenStraat("Xstraat 12A-14 2018 Antwerpen"), "Xstraat, 2018 Antwerpen");
  assert.equal(adresAlleenStraat("Xlaan (2610) 34-hoek 2610 Antwerpen"), "Xlaan, 2610 Antwerpen");
  assert.equal(adresAlleenStraat("Xstraat hoek-64 2060 Antwerpen"), "Xstraat, 2060 Antwerpen");
  assert.equal(adresAlleenStraat("Xstraat Onbekend-Onbekend 2000 Antwerpen"), "Xstraat, 2000 Antwerpen");
  assert.equal(adresAlleenStraat("Xstraat 1, 2000 Antwerpen"), "Xstraat, 2000 Antwerpen");
  // Al opgekuist blijft gelijk; officiële straatnamen met een cijfer blijven heel.
  assert.equal(adresAlleenStraat("Xstraat, 2000 Antwerpen"), "Xstraat, 2000 Antwerpen");
  assert.equal(adresAlleenStraat("4 septemberpad 3 2020 Antwerpen"), "4 septemberpad, 2020 Antwerpen");
  assert.equal(adresAlleenStraat("Kanaaldok B1-Oostkaai 2030 Antwerpen"), "Kanaaldok B1-Oostkaai, 2030 Antwerpen");
});

test("vrije tekst: nummers achter een straat weg, ook reeksen en busnummers; jaartallen en maten blijven", () => {
  const gevallen = [
    ["Xstraat 12", "Xstraat"],
    ["2000 | Antwerpen | Xstraat | 12", "2000 | Antwerpen | Xstraat"],
    ["2000 ANTWERPEN, XSTRAAT 3B_BIS", "2000 ANTWERPEN, XSTRAAT"],
    ["2000 Antwerpen - (Antwerpen) - Xstraat - 12 - werken aan nutsleiding - 150m.", "2000 Antwerpen - (Antwerpen) - Xstraat - werken aan nutsleiding - 150m."],
    ["Xstraat 12 tem 14A en Ylaan 3 bus 2 - werken", "Xstraat en Ylaan - werken"],
    ["Xstraat 12 en 134 - twee koppelputten", "Xstraat - twee koppelputten"],
    ["Xplein 12/3 (aansluiting)", "Xplein (aansluiting)"],
    ["Meir 12", "Meir"], // officiële straatnaam zonder straatuitgang
    ["R1 - Xtunnel - Regulier onderhoud 2026 - Antwerpen", "R1 - Xtunnel - Regulier onderhoud 2026 - Antwerpen"],
    ["Xtunnel 2026 - Antwerpen", "Xtunnel 2026 - Antwerpen"],
    ["Xstraat - 30 m", "Xstraat - 30 m"],
    ["Fase 12345", "Fase 12345"],
    ["N1234567 - Renovatie Xwegen N123", "N1234567 - Renovatie Xwegen N123"],
  ];
  for (const [voor, na] of gevallen) assert.equal(tekstZonderHuisnummers(voor), na, voor);
});

const parkeer = (id, location, extra = {}) => ({
  id: `parking:D${id}|L${id}`, kind: "parking", kindLabel: "Parkeerverbod", title: "Verhuis", location,
  start: "2026-10-12T06:00:00.000Z", end: "2026-10-13T18:00:00.000Z", status: "Goedgekeurd", reference: `D${id}`, detail: "",
  streets: [], streetResolution: "unresolved", streetDistanceMeters: null, ...extra,
});

test("een punt buiten het district valt weg", () => {
  const result = resultaatVoorHistoriek({ ok: true, items: [parkeer(1, "Xstraat 2 2000 Antwerpen"), parkeer(2, "Ystraat 5 2100 Antwerpen"), parkeer(3, "Zstraat 9 2600 Antwerpen")] });
  assert.deepEqual(result.items.map((item) => item.id), ["parking:D1|L1"]);
  assert.equal(result.buitenDistrict, 2);
  // Zonder postcode beslist de officiële straat van het district.
  const zonder = resultaatVoorHistoriek({ ok: true, items: [parkeer(4, "Xstraat 2", { streets: [{ id: "1", name: "Xstraat", postcode: "2000" }] }), parkeer(5, "Ystraat 5")] });
  assert.deepEqual(zonder.items.map((item) => item.id), ["parking:D4|L4"]);
});

test("de scan vindt een huisnummer, een postcode buiten het district en een punt buiten de grens", () => {
  const codes = (value) => historiekPrivacyBevindingen(value).map((finding) => finding.code).sort();
  assert.deepEqual(codes({ items: [parkeer(1, "Xstraat 2 2000 Antwerpen")] }), ["huisnummer"]);
  assert.deepEqual(codes({ items: [parkeer(1, "Xstraat, 2100 Antwerpen")] }), ["buiten_district"]);
  assert.deepEqual(codes({ title: "2000 Antwerpen, Xstraat 12" }), ["huisnummer"]);
  assert.deepEqual(codes({ streets: [{ id: "1", name: "Xstraat", postcode: "2100" }] }), ["buiten_district"]);
  assert.deepEqual(codes({ point: [4.4, 51.15] }), ["punt_buiten_district"]); // Hoboken
  assert.deepEqual(codes({ point: [4.4025, 51.2194] }), []); // Groenplaats
  assert.deepEqual(codes({ items: [parkeer(1, "Xstraat, 2000 Antwerpen")], title: "R1 - Xtunnel 2026", detail: "Fase 12345" }), []);
  // De melding noemt een pad, nooit de waarde.
  assert.ok(historiekPrivacyBevindingen({ title: "Xstraat 12" }).every((finding) => !JSON.stringify(finding).includes("12")));
});

test("historiek: oude wijzigingen zonder adres volgen hun parkeerverbod; een wijziging van alleen het huisnummer valt weg", () => {
  const T1 = "2026-10-09T03:00:00.000Z", T2 = "2026-10-10T03:00:00.000Z";
  const h1 = updateLiveHistory(null, { observedAt: T1, worksResult: { ok: true, items: [] }, publicSpaceResult: { ok: true, items: [parkeer(1, "Xstraat 2 2000 Antwerpen"), parkeer(2, "Ystraat 5 2100 Antwerpen")] } });
  const h2 = updateLiveHistory(h1, { observedAt: T2, worksResult: { ok: true, items: [] }, publicSpaceResult: { ok: true, items: [parkeer(1, "Xstraat 4 2000 Antwerpen"), parkeer(2, "Ystraat 5 2100 Antwerpen", { end: "2026-10-14T18:00:00.000Z" })] } });
  assert.equal(h2.changes.length, 2, "op main: een huisnummerwijziging en een wijziging buiten het district");
  const schoon = historiekVoorPubliek(h2, { onbekend: false });
  assert.deepEqual(schoon.changes, []);
  assert.deepEqual(schoon.layers.publicSpace.items.map((item) => item.location), ["Xstraat, 2000 Antwerpen"]);
  assert.deepEqual(validateLiveHistory(schoon), []);
  assert.deepEqual(historiekPrivacyBevindingen(schoon), []);
  // Dagarchief: dezelfde regels.
  const dag = archiefDagVoorPubliek({ schemaVersion: 1, date: "2026-10-10", events: h2.changes }, { onbekend: false, opzoeking: null });
  assert.deepEqual(dag.events, []);
});

test("eenmalige opkuis: schrijft schone, geldige bestanden en is daarna een no-op", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "historiek-opkuis-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const T1 = "2026-10-09T03:00:00.000Z", T2 = "2026-10-10T03:00:00.000Z";
  const werk = { gipodId: 7, title: "2000 Antwerpen, Xstraat 12", status: "In uitvoering", start: T1, end: T2, owner: "Proef", ownerGroup: "Andere", boundaryConfidence: "point_inside_new", workTypes: [], occupancyTypes: [], hindrance: null };
  const h1 = updateLiveHistory(null, { observedAt: T1, worksResult: { ok: true, items: [werk] }, publicSpaceResult: { ok: true, items: [parkeer(1, "Xstraat 2 2000 Antwerpen")] } });
  const h2 = updateLiveHistory(h1, { observedAt: T2, worksResult: { ok: true, items: [werk] }, publicSpaceResult: { ok: true, items: [parkeer(1, "Xstraat 2 2000 Antwerpen"), parkeer(2, "Ystraat 5 2100 Antwerpen")] } });
  const dag = { schemaVersion: 1, date: "2026-10-10", events: h2.changes };
  const schrijf = (relative, value) => {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), `${JSON.stringify(value, null, 2)}\n`);
  };
  schrijf("site/history/live-layers.json", h2);
  schrijf("site/history/archive/baseline.json", { schemaVersion: 1, layers: { works: { observedAt: T1, items: h1.layers.works.items }, publicSpace: { observedAt: T1, items: h1.layers.publicSpace.items } } });
  schrijf("site/history/archive/2026-10-10.json", dag);
  schrijf("site/history/archive/index.json", { schemaVersion: 1, baselineInitializedAt: T1, lastObservedAt: T2, days: [{ date: "2026-10-10", file: "site/history/archive/2026-10-10.json", count: 1, digest: "0".repeat(64) }] });

  // De verversing mag geen bestand wissen (datatak): een dag die leeg zou worden, stopt de opkuis
  // dan zonder iets te schrijven, met de weg vooruit in de melding.
  const vooraf = fs.readFileSync(path.join(root, "site/history/live-layers.json"), "utf8");
  assert.throws(() => opkuisHistoriekPrivacy({ rootDir: root, write: true, verwijderLeeg: false }), /een dag wordt leeg .*opkuis-historiek-privacy\.mjs --write/);
  assert.equal(fs.readFileSync(path.join(root, "site/history/live-layers.json"), "utf8"), vooraf);

  const eerste = opkuisHistoriekPrivacy({ rootDir: root, write: true });
  assert.deepEqual(eerste.leegGeworden, ["site/history/archive/2026-10-10.json"], "de enige wijziging lag buiten het district");
  const tekst = fs.readdirSync(path.join(root, "site/history/archive")).map((name) => fs.readFileSync(path.join(root, "site/history/archive", name), "utf8")).join("\n")
    + fs.readFileSync(path.join(root, "site/history/live-layers.json"), "utf8");
  for (const verboden of ["Xstraat 2", "Xstraat 12", "Ystraat", "2100"]) assert.equal(tekst.includes(verboden), false, verboden);
  const index = JSON.parse(fs.readFileSync(path.join(root, "site/history/archive/index.json"), "utf8"));
  assert.deepEqual(index.days, []);

  const voor = fs.readFileSync(path.join(root, "site/history/live-layers.json"), "utf8");
  const tweede = opkuisHistoriekPrivacy({ rootDir: root, write: true });
  assert.deepEqual(tweede.gewijzigd, [], "tweede keer verandert niets");
  assert.equal(fs.readFileSync(path.join(root, "site/history/live-layers.json"), "utf8"), voor);
});

test("validate-data meldt een huisnummer in de historiek met het pad, zonder de waarde", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "historiek-validatie-"));
  try {
    fs.cpSync(path.join(repoRoot, "lib"), path.join(root, "lib"), { recursive: true });
    fs.mkdirSync(path.join(root, "scripts"));
    fs.copyFileSync(path.join(repoRoot, "scripts", "validate-data.mjs"), path.join(root, "scripts", "validate-data.mjs"));
    fs.mkdirSync(path.join(root, "site", "history"), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, "site", "works-core.js"), path.join(root, "site", "works-core.js"));
    const history = updateLiveHistory(null, { observedAt: "2026-10-10T03:00:00.000Z", worksResult: { ok: true, items: [] }, publicSpaceResult: { ok: true, items: [parkeer(1, "Xstraat 27 2000 Antwerpen")] } });
    fs.writeFileSync(path.join(root, "site/history/live-layers.json"), JSON.stringify(history));
    const run = spawnSync(process.execPath, [path.join(root, "scripts", "validate-data.mjs")], { encoding: "utf8" });
    const regels = run.stderr.split("\n").filter((line) => line.startsWith("site/history/") && line.includes("privacy"));
    assert.deepEqual(regels, ["site/history/live-layers.json: privacy huisnummer op $.layers.publicSpace.items[0].location"]);
    assert.ok(run.stderr.includes("oplossing: node scripts/opkuis-historiek-privacy.mjs --write"), "de melding toont de weg vooruit");
    assert.equal(run.stderr.includes("27"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// De scan over ALLE bestanden onder site/history. Faalt zodra er een huisnummer of iets buiten het
// district in staat. De melding geeft alleen bestandsnamen en aantallen.
test("scan: geen huisnummer en niets buiten het district in site/history", () => {
  const dir = path.join(repoRoot, "site", "history");
  const bestanden = [];
  const loop = (target) => {
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      const volledig = path.join(target, entry.name);
      if (entry.isDirectory()) loop(volledig);
      else if (entry.name.endsWith(".json")) bestanden.push(volledig);
    }
  };
  if (fs.existsSync(dir)) loop(dir);
  assert.ok(bestanden.length > 0, "site/history bevat geen bestanden");
  const fouten = [];
  for (const file of bestanden.sort()) {
    const telling = {};
    for (const finding of historiekPrivacyBevindingen(JSON.parse(fs.readFileSync(file, "utf8")))) telling[finding.code] = (telling[finding.code] || 0) + 1;
    if (Object.keys(telling).length) fouten.push(`${path.relative(repoRoot, file)}: ${Object.entries(telling).map(([code, aantal]) => `${aantal}× ${code}`).join(", ")}`);
  }
  assert.deepEqual(fouten, [], `privacy in de historiek (draai node scripts/opkuis-historiek-privacy.mjs --write):\n${fouten.join("\n")}`);
});
