import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadExpandedAgendaItems, loadRefreshEngine } from "../scripts/agenda-source.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const items = loadExpandedAgendaItems(rootDir);
const engine = loadRefreshEngine(rootDir);
const result = engine.reconcileAgendaItems(items, engine.config.classificationAsOf);

function find(title, date) {
  return result.auditItems.find((item) => item.title === title && item.date === date);
}

test("classificeert verlopen, lopende en toekomstige punten deterministisch", () => {
  assert.equal(find("Kammenstraat autovrij tijdens soldenperiode", "2026-06-29").classification, "expired");
  assert.equal(
    find("Fasewissel heraanleg Balansstraat en Lange Elzenstraat", "2026-06-29").classification,
    "current"
  );
  assert.equal(find("Strip- en boekenplein", "2026-08-16").classification, "future");
  assert.ok(result.counts.expired > 0);
  assert.ok(result.counts.current > 0);
  assert.ok(result.counts.future > 0);
});

test("sluit bronconflicten uit de publieke kandidaat", () => {
  for (const [title, date] of [
    ["Sportinitiaties met Jespo", "2026-08-11"],
    ["Gratis initiaties boogschieten", "2026-08-16"],
  ]) {
    const item = find(title, date);
    assert.equal(item.classification, "review_required");
    assert.ok(!result.publicItems.some((candidate) => candidate.id === item.id));
  }
});

test("neemt de officieel bevestigde 3x3-reeks in Kielpark fail-open op", () => {
  const elapsed = find("3x3 basket", "2026-08-12");
  assert.equal(elapsed.classification, "expired");
  assert.ok(!result.publicItems.some((candidate) => candidate.id === elapsed.id));

  for (const date of ["2026-08-19", "2026-08-26"]) {
    const item = find("3x3 basket", date);
    assert.equal(item.classification, "future");
    assert.equal(item.verificationState, "verified");
    assert.equal(item.timeText, "15 tot 18 uur");
    assert.equal(item.location, "Kielpark, 2020 Antwerpen");
    assert.ok(result.publicItems.some((candidate) => candidate.id === item.id));
  }
});

test("past officiële correcties voor locatie, tijd en bron toe", () => {
  const poem = find("Poëtische Rimpelingen", "2026-09-19");
  assert.match(poem.location, /Gloriantlaan 53/);
  assert.equal(poem.timeText, "14 tot 16.30 uur");
  assert.equal(poem.link, "https://www.citaatopstraat.be/");

  const moveDay = find("Beweegdag 55+", "2026-09-19");
  assert.match(moveDay.location, /Zuiderpershuis/);
  assert.doesNotMatch(moveDay.info, /op Linkeroever/);
  assert.equal(moveDay.timeSlot, "09:00");
});

test("publiceert alleen geverifieerde huidige of toekomstige items met officiële HTTPS-bron", () => {
  assert.ok(result.publicItems.length > 0);
  for (const item of result.publicItems) {
    assert.ok(["current", "future"].includes(item.classification));
    assert.equal(item.verificationState, "verified");
    const source = engine.config.sources[item.sourceId];
    assert.equal(source.officialPublic, true);
    assert.equal(new URL(item.link).protocol, "https:");
  }
});

test("manifest bewaart bronmoment, classificaties en rollbackbasis", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, "site", "public-agenda-manifest.json"), "utf8"));
  assert.equal(manifest.state, "published-release");
  assert.equal(manifest.classificationAsOf, engine.config.classificationAsOf);
  assert.equal(manifest.count, result.publicItems.length);
  assert.deepEqual(manifest.classifications, JSON.parse(JSON.stringify(result.counts)));
  assert.equal(manifest.rollback.baseCommit, "f9ce9badc00b2300d083996b9e93b5d5cb7c15f3");
});
