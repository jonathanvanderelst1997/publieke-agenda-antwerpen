// Schoolstraten (portal_publiek10/MapServer/986): de straatfiche per schooljaar met venstertijden,
// een agendapunt bij de start van een proef, alleen district Antwerpen. Verzonnen fixture.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SCHOOLSTRATEN_FIELDS, SCHOOLSTRATEN_LAYER_URL, parseVenstertijden, schooljaar, schoolstraatItems, schoolstratenQueryUrl, venstertijdenTekst } from "../lib/schoolstraten.mjs";
import { privacyFindings, validateSourceDocument } from "../lib/source-feed.mjs";
import { buildStraatIndex } from "../lib/straatnamen.mjs";
import { ARCGIS_PAUSE_MS, SOURCE_ID, run } from "../scripts/fetch-sources-schoolstraten.mjs";

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/p7/schoolstraten.json", import.meta.url), "utf8"));
const TODAY = "2026-10-10";
const streets = buildStraatIndex({ streets: [["1", "Voorbeeldstraat", "2018", [], []], ["2", "Bladstraat", "2060", [], []], ["3", "Middenstraat", "2000", [], []]] });
const quiet = () => {};
const noPause = async () => {};

test("venstertijden: per weekdag gelezen, gelijke dagen samen", () => {
  assert.deepEqual(parseVenstertijden("8:00u-8:15u | 8:50u-9:05u"), [["8.00", "8.15"], ["8.50", "9.05"]]);
  assert.deepEqual(parseVenstertijden("8:30-8:45| 12:20-12:35 "), [["8.30", "8.45"], ["12.20", "12.35"]]);
  assert.deepEqual(parseVenstertijden(""), []);
  assert.equal(parseVenstertijden("onbekend"), null);
  assert.equal(parseVenstertijden("9:00-8:00"), null);
  const row = fixture.features[0].attributes;
  assert.deepEqual(venstertijdenTekst(row), { text: "ma, di, do, vr 8.00-8.15 en 15.10-15.25; wo 8.00-8.15 en 11.50-12.05", unreadable: false });
});

test("schooljaar: 1 september tot 30 juni; in juli en augustus het volgende", () => {
  assert.deepEqual(schooljaar("2026-10-10"), { start: "2026-09-01", end: "2027-06-30", label: 2026 });
  assert.deepEqual(schooljaar("2027-03-01"), { start: "2026-09-01", end: "2027-06-30", label: 2026 });
  assert.deepEqual(schooljaar("2027-07-15"), { start: "2027-09-01", end: "2028-06-30", label: 2027 });
});

test("de straatfiche, de start van een proef en de dag dat ze definitief wordt; alleen district Antwerpen", () => {
  const { items, counts } = schoolstraatItems(fixture.features, { today: TODAY, streets });
  assert.deepEqual(
    items.map((item) => [item.id, item.title, item.date, item.endDate, item.location]),
    [
      ["schoolstraat-schoolstr901-2026", "Schoolstraat Voorbeeldstraat", "2026-09-01", "2027-06-30", "Voorbeeldstraat, 2018 Antwerpen"],
      ["schoolstraat-schoolstr902-2026", "Schoolstraat Bladstraat", "2026-11-03", "2027-06-30", "Bladstraat, 2060 Antwerpen"],
      ["schoolstraat-start-schoolstr902-2026-11-03", "Start proef schoolstraat Bladstraat", "2026-11-03", null, "Bladstraat, 2060 Antwerpen"],
      ["schoolstraat-schoolstr905-2026", "Schoolstraat Middenstraat", "2027-01-04", "2027-06-30", "Middenstraat, 2000 Antwerpen"],
      ["schoolstraat-definitief-schoolstr905-2027-01-04", "Schoolstraat Middenstraat wordt definitief", "2027-01-04", null, "Middenstraat, 2000 Antwerpen"],
    ]
  );
  // Berchem valt weg, een stopgezette schoolstraat ook, en een onleesbare dag wordt gemeld.
  assert.equal(counts.district, 4);
  assert.deepEqual(counts.issues, { andere_status: 1, venstertijden_onleesbaar: 1 });
  const fiche = items[0];
  assert.deepEqual([fiche.theme, fiche.className, fiche.timeSlot, fiche.sourceUrl], ["Werken", "works", "Info", SCHOOLSTRATEN_LAYER_URL]);
  assert.equal(fiche.timeText, "op schooldagen: ma, di, do, vr 8.00-8.15 en 15.10-15.25; wo 8.00-8.15 en 11.50-12.05");
  assert.match(fiche.info, /^Schoolstraat aan Voorbeeldschool De Boom: op schooldagen is de straat tijdens de venstertijden dicht/);
  assert.match(fiche.info, /Definitief sinds 15 januari 2021\.$/);
});

test("een datumveld buiten het bereik van Date laat de lijst niet crashen; de schoolstraat blijft", () => {
  const base = fixture.features.find((feature) => feature.attributes.GISID === "SCHOOLSTR902").attributes;
  const features = [{ attributes: { ...base, PROEFOPSTELLING_DATUM: 1e20, DEFINITIEF_DATUM: -1e20 } }];
  const { items } = schoolstraatItems(features, { today: TODAY, streets });
  // Zonder bruikbare startdag: alleen de straatfiche voor het schooljaar, geen agendapunt voor de start.
  assert.deepEqual(items.map((item) => [item.id, item.date, item.endDate]), [["schoolstraat-schoolstr902-2026", "2026-09-01", "2027-06-30"]]);
  assert.match(items[0].info, /Proefopstelling\.$/);
});

test("de personeelsvelden komen nooit in de uitvoer; alleen toegelaten velden worden opgevraagd", () => {
  const { items } = schoolstraatItems(fixture.features, { today: TODAY, streets });
  const text = JSON.stringify(items);
  for (const forbidden of ["Verzonnen", "dossierBeheerder", "innameBeschrijving", "creator", "assignee", "lockOwner", "0470"]) assert.ok(!text.includes(forbidden), forbidden);
  assert.deepEqual(privacyFindings(items), []);
  assert.deepEqual(new URL(schoolstratenQueryUrl()).searchParams.get("outFields").split(","), [...SCHOOLSTRATEN_FIELDS]);
});

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "district-schoolstraten-"));
  fs.mkdirSync(path.join(root, "site", "sources"), { recursive: true });
  return root;
}
const read = (root) => JSON.parse(fs.readFileSync(path.join(root, "site", "sources", `${SOURCE_ID}.json`), "utf8"));
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const clock = () => new Date("2026-10-10T03:21:00Z");

test("fetcher: geldig brondocument; bij een fout blijft het vorige antwoord met de foutcode", async () => {
  const root = makeRoot();
  const ok = await run({ rootDir: root, clock, log: quiet, sleep: noPause, fetch: async () => json(fixture) });
  assert.equal(ok[0].fetchStatus, "ok");
  const before = read(root);
  assert.deepEqual(validateSourceDocument(before, { expectedSourceId: SOURCE_ID }), []);
  for (const [fetchImpl, code] of [
    [async () => json({}, 500), "http_500"],
    [async () => json({ features: [{ attributes: { DISTRICT: "BERCHEM" } }] }), "no_district_rows"],
    [async () => json({ features: fixture.features, exceededTransferLimit: true }), "too_many_rows"],
  ]) {
    const status = await run({ rootDir: root, clock, log: quiet, sleep: noPause, fetch: fetchImpl });
    assert.deepEqual([status[0].fetchStatus, status[0].errorCode], ["error", code]);
    assert.deepEqual(read(root).items, before.items);
  }
});

test("fetcher: eerst een pauze, want de foren vroegen net aan dezelfde host (hoogstens 1 verzoek per seconde)", async () => {
  const events = [];
  const status = await run({
    rootDir: makeRoot(),
    clock,
    log: quiet,
    sleep: async (ms) => { events.push(["pauze", ms]); },
    fetch: async (url) => { events.push(["verzoek", new URL(url).host]); return json(fixture); },
  });
  assert.equal(status[0].fetchStatus, "ok");
  assert.deepEqual(events, [["pauze", 1000], ["verzoek", "geodata.antwerpen.be"]]);
  assert.ok(ARCGIS_PAUSE_MS >= 1000);
});
