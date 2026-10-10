// De drie bronnen van pakket P7 samen: register, sources:health, het broncontract voor werken uit een
// feed, en de handmatige heraanleg-items die de projectbron vervangt.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { mergeEvents } from "../lib/merge-events.mjs";
import { SOURCE_DEFINITIONS, sourceDocument, validateSourceDocument } from "../lib/source-feed.mjs";
import { FETCHERS } from "../lib/source-registry.mjs";
import { loadHandAgendaItems, loadRefreshEngine } from "../scripts/agenda-source.mjs";
import { buildFeed, renderFeedScript } from "../scripts/build-sources.mjs";
import { checkHealth } from "../scripts/sources-health.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NIEUW = ["district-foren", "district-schoolstraten", "district-projecten"];
const RETRIEVED = "2026-10-10T03:21:00.000Z";

function statusFile(root, sources) {
  fs.mkdirSync(path.join(root, "site", "sources"), { recursive: true });
  const status = { schemaVersion: 1, generatedAt: RETRIEVED, classificationAsOf: "2026-10-10", sources };
  fs.writeFileSync(path.join(root, "site", "sources", "refresh-status.json"), `${JSON.stringify(status, null, 2)}\n`);
}
const entry = (sourceId, fetchStatus = "ok", errorCode = null) => ({ sourceId, file: `sources/${sourceId}.json`, scope: SOURCE_DEFINITIONS[sourceId].scope, fetchStatus, retrievedAt: RETRIEVED, maxAgeHours: 48, itemCount: 3, errorCode });

const schoolstraat = {
  id: "schoolstraat-schoolstr901-2026",
  externalId: "SCHOOLSTR901",
  title: "Schoolstraat Voorbeeldstraat",
  theme: "Werken",
  className: "works",
  date: "2026-09-01",
  endDate: "2027-06-30",
  timeSlot: "Info",
  timeText: "op schooldagen: ma, di, do, vr 8.00-8.15 en 15.10-15.25",
  location: "Voorbeeldstraat, 2018 Antwerpen",
  postcodes: ["2018"],
  info: "Schoolstraat aan een verzonnen school.",
  kind: "activity",
  sourceUrl: "https://geodata.antwerpen.be/arcgissql/rest/services/P_Portal/portal_publiek10/MapServer/986",
  retrievedAt: RETRIEVED,
  reviewRequired: false,
  inDistrict: true,
};

test("register en broncontract kennen de drie bronnen, elk met een eigen fetcher en vaste hosts", () => {
  for (const sourceId of NIEUW) {
    const fetcher = FETCHERS.find((candidate) => candidate.sourceIds.includes(sourceId));
    assert.ok(fetcher, sourceId);
    assert.equal(typeof fetcher.load, "function");
    assert.equal(SOURCE_DEFINITIONS[sourceId].scope, "district");
    assert.equal(SOURCE_DEFINITIONS[sourceId].bootstrapOptional, true);
  }
  assert.deepEqual(SOURCE_DEFINITIONS["district-foren"].allowedHosts, ["geodata.antwerpen.be"]);
  assert.deepEqual(SOURCE_DEFINITIONS["district-schoolstraten"].allowedHosts, ["geodata.antwerpen.be"]);
  assert.deepEqual(SOURCE_DEFINITIONS["district-projecten"].allowedHosts, ["www.antwerpen.be"]);
});

test("sources:health kent de drie bronnen: nog niet opgehaald is een melding, een fout telt zoals elke bron", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p7-health-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  statusFile(root, [entry("district-kalender")]);
  const before = checkHealth({ rootDir: root, at: Date.parse("2026-10-10T06:00:00Z"), env: {} });
  for (const sourceId of NIEUW) assert.match(before.lines.join("\n"), new RegExp(`^${sourceId}\\tnog niet opgehaald`, "m"));
  assert.equal(before.exitCode, 0);

  statusFile(root, [entry("district-foren", "error", "http_503"), entry("district-kalender"), entry("district-projecten", "error", "no_projects"), entry("district-schoolstraten")]);
  const after = checkHealth({ rootDir: root, at: Date.parse("2026-10-10T06:00:00Z"), env: {} });
  const text = after.lines.join("\n");
  assert.match(text, /^district-foren\tstale\terror\t.*errorCode=http_503/m);
  assert.match(text, /^district-projecten\terror\terror\t.*errorCode=no_projects/m);
  assert.match(text, /^district-schoolstraten\tok\tok/m);
  for (const sourceId of NIEUW) assert.doesNotMatch(text, new RegExp(`^${sourceId}\\tnog niet opgehaald`, "m"));
  assert.equal(after.exitCode, 1);
});

test("een feed-item met thema Werken is geldig en staat als lopend in de agenda", (t) => {
  const document = sourceDocument("district-schoolstraten", { retrievedAt: RETRIEVED, fetchStatus: "ok", items: [schoolstraat] });
  assert.deepEqual(validateSourceDocument(document, { expectedSourceId: "district-schoolstraten" }), []);
  const { feed } = buildFeed({ status: null, documents: [document] }, []);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p7-feed-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "site"), { recursive: true });
  fs.copyFileSync(path.join(rootDir, "site", "agenda-refresh.js"), path.join(root, "site", "agenda-refresh.js"));
  fs.writeFileSync(path.join(root, "site", "agenda-feed.js"), renderFeedScript({ ...feed, generatedAt: RETRIEVED, classificationAsOf: "2026-10-10" }));
  const engine = loadRefreshEngine(root);
  const result = engine.reconcileAgendaItems(feed.items.map((item) => ({ ...item, feed: true })), "2026-10-10", { now: "2026-10-10T06:00:00Z" });
  assert.equal(result.publicItems.length, 1);
  assert.deepEqual([result.publicItems[0].classification, result.publicItems[0].theme], ["current", "Werken"]);
});

test("de handmatige heraanleg-items zijn vervangen door de projectbron; geen dode werkregels", () => {
  const hand = loadHandAgendaItems(rootDir);
  for (const title of [
    "Fasewissel heraanleg Balansstraat en Lange Elzenstraat",
    "Nieuwe fase heraanleg Gaston Burssenslaan en Hanegraefstraat",
    "Werken Halenstraat en Schijnpoortweg",
    "Heraanleg Van Maerlantstraat en Vondelstraat - fase 2",
  ]) {
    assert.ok(!hand.some((item) => item.title === title), title);
  }
  assert.ok(!hand.some((item) => item.theme === "Werken" && /heraanleg|\bfase\b/i.test(item.title)));
  const engine = loadRefreshEngine(rootDir);
  for (const rule of engine.config.rules.filter((candidate) => candidate.match.theme === "Werken" || /heraanleg/i.test(candidate.match.title ?? ""))) {
    assert.ok(hand.some((item) => item.title === rule.match.title), `regel zonder item: ${rule.match.title}`);
  }
});

test("twee fasen van één projectpagina die op dezelfde dag beginnen, blijven twee agendapunten", () => {
  const page = "https://www.antwerpen.be/info/6a00000000000000000000a1/heraanleg-voorbeeldstraat-en-proefstraat";
  const fase = (label, id) => ({ ...schoolstraat, id, title: `Heraanleg Voorbeeldstraat: ${label}`, date: "2026-08-10", endDate: "2026-10-31", sourceUrl: page, location: "Voorbeeldstraat, 2018 Antwerpen" });
  const merged = mergeEvents({ "district-projecten": { scope: "district", items: [fase("fase 6a", "project-6a00000000000000000000a1-fase-6a-2026-08-10"), fase("fase 6b", "project-6a00000000000000000000a1-fase-6b-2026-08-10")] } });
  assert.deepEqual(merged.items.map((item) => item.title), ["Heraanleg Voorbeeldstraat: fase 6a", "Heraanleg Voorbeeldstraat: fase 6b"]);
  // Over bronnen heen voegt dezelfde detailpagina nog altijd samen (kalender en project).
  const kalender = { ...fase("fase 6a", "district-kal-voorbeeld-2026-08-10"), title: "Start fase 6a in de Voorbeeldstraat" };
  const across = mergeEvents({ "district-kalender": { scope: "district", items: [kalender] }, "district-projecten": { scope: "district", items: [fase("fase 6a", "project-6a00000000000000000000a1-fase-6a-2026-08-10")] } });
  assert.equal(across.items.length, 1);
  assert.deepEqual(across.items[0].sources.map((source) => source.sourceId), ["district-kalender", "district-projecten"]);
});
