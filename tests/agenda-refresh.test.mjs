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

function addDays(value, days) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function find(title, date) {
  return result.auditItems.find((item) => item.title === title && item.date === date);
}

test("classificeert verlopen, lopende en toekomstige punten deterministisch", () => {
  const asOf = engine.config.classificationAsOf;
  assert.match(asOf, /^\d{4}-\d{2}-\d{2}$/);
  // Een regel met een vaste classificatie wint, los van de datum.
  assert.equal(find("Kammenstraat autovrij tijdens soldenperiode", "2026-06-29").classification, "expired");
  assert.equal(find("Kammenstraat autovrij tijdens soldenperiode", "2026-06-29").classificationBasis, "rule");

  // Een lopende werf blijft lopend zolang zijn bron vers is; daarna verouderd en niet publiek.
  const works = find("Fasewissel heraanleg Balansstraat en Lange Elzenstraat", "2026-06-29");
  const worksSource = engine.config.sources[works.sourceId];
  const worksDue = addDays(worksSource.retrievedAt, 2);
  if (asOf <= worksDue) assert.equal(works.classification, "current");
  else assert.deepEqual([works.classification, works.reviewReason], ["review_required", "stale_source"]);

  // Elk item dat op datum geclassificeerd is, klopt met classificationAsOf en zijn date/endDate.
  for (const item of result.auditItems.filter((candidate) => candidate.classificationBasis === "date")) {
    const last = item.endDate && item.endDate > item.date ? item.endDate : item.date;
    const byDate = last < asOf ? "expired" : item.date <= asOf ? "current" : "future";
    if (item.classification === "review_required") {
      assert.ok(["stale_source", "unverified_source", "unverified_feed_item", "works_without_rule",
        "manual_source_changed", "manual_source_gone"].includes(item.reviewReason), item.id);
      if (item.reviewReason === "manual_source_changed" || item.reviewReason === "manual_source_gone") {
        assert.ok(!result.publicItems.some((candidate) => candidate.id === item.id), item.id);
      }
      if (item.reviewReason !== "works_without_rule") {
        assert.notEqual(byDate, "expired", `${item.id}: een verlopen item hoort expired te zijn, niet review_required`);
      }
    } else {
      assert.equal(item.classification, byDate, item.id);
    }
  }
  const total = result.counts.expired + result.counts.current + result.counts.future + result.counts.review_required;
  assert.equal(total, result.auditItems.length);
  assert.ok(result.counts.expired > 0);
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

test("verwijdert de afgelopen 3x3-reeks in Kielpark uit de publieke agenda", () => {
  for (const date of ["2026-08-12", "2026-08-19", "2026-08-26"]) {
    const item = find("3x3 basket", date);
    assert.equal(item.classification, "expired");
    assert.equal(item.verificationState, "verified");
    assert.equal(item.timeText, "15 tot 18 uur");
    assert.equal(item.location, "Kielpark, 2020 Antwerpen");
    assert.ok(!result.publicItems.some((candidate) => candidate.id === item.id));
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
    if (item.feed) assert.ok(source.allowedHosts.includes(new URL(item.link).hostname), item.id);
  }
});

test("elke bron heeft een scope; district en stad blijven gescheiden", () => {
  for (const [sourceId, source] of Object.entries(engine.config.sources)) {
    assert.ok(["district", "stad"].includes(source.scope), sourceId);
  }
  for (const item of result.auditItems) assert.ok(["district", "stad"].includes(item.scope), item.id);
  assert.equal(engine.config.sources["city-works-permit"].scope, "stad");
  assert.equal(engine.config.sources["city-district-calendar"].scope, "district");
});

test("geen getraceerde nieuwsbrieflinks meer in de handmatige data of bronnen", () => {
  for (const item of items) assert.doesNotMatch(String(item.link ?? ""), /nieuwsbrief\.antwerpen\.be\/t\/|\/t\/j-/, item.id);
  for (const source of Object.values(engine.config.sources)) assert.doesNotMatch(source.url, /nieuwsbrief\.antwerpen\.be\/t\//);
});

test("manifest bewaart bronmoment, classificaties en rollbackbasis", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, "site", "public-agenda-manifest.json"), "utf8"));
  assert.equal(manifest.state, "published-release");
  assert.equal(manifest.classificationAsOf, engine.config.classificationAsOf);
  assert.equal(manifest.count, result.publicItems.length);
  assert.deepEqual(manifest.classifications, JSON.parse(JSON.stringify(result.counts)));
  assert.equal(manifest.rollback.baseCommit, "36ea97332e1742d0ed1650a1226c2276733a34f3");
});

test("handmatig item: zichtbaar tot en met de einddatum, weg vanaf de dag erna, zonder herbevestiging", () => {
  const item = items.find((candidate) => candidate.id === "bevraging-proefperiode-schoolstraat-jan-vanhoenackerstraat-2026-10-05-2026-11-01");
  assert.ok(item, "schoolstraatbevraging ontbreekt");
  // Bron bevestigd op 5 oktober; vroeger na 2 dagen ("lopend") verouderd, nu tot en met 1 november.
  for (const [asOf, expected] of [
    ["2026-10-05", "current"],
    ["2026-10-20", "current"],
    ["2026-11-01", "current"],
    ["2026-11-02", "expired"],
  ]) {
    const result = engine.reconcileAgendaItems([item], asOf, { now: `${asOf}T21:59:00Z` });
    const [audit] = result.auditItems;
    assert.equal(audit.classification, expected, asOf);
    assert.equal(audit.reviewReason, null, asOf);
    assert.equal(result.publicItems.length, expected === "expired" ? 0 : 1, asOf);
    if (expected !== "expired") {
      assert.equal(audit.visibleThrough, "2026-11-01");
      assert.equal(audit.slaMaxAgeDays, null);
    }
  }
});

test("handmatig item zonder einddatum loopt tot en met zijn dag; een lopende werf uit een regel volgt nog de SLA", () => {
  const single = items.find((candidate) => candidate.title === "Buurtfeest Gaston Burssenslaan en Hanegraefstraat");
  assert.ok(single);
  assert.equal(engine.reconcileAgendaItems([single], "2026-10-10").publicItems.length, 1);
  assert.equal(engine.reconcileAgendaItems([single], "2026-10-11").auditItems[0].classification, "expired");

  const works = find("Fasewissel heraanleg Balansstraat en Lange Elzenstraat", "2026-06-29");
  const due = addDays(engine.config.sources[works.sourceId].retrievedAt, 2);
  const later = engine.reconcileAgendaItems([items.find((candidate) => candidate.id === works.id)], addDays(due, 1));
  assert.deepEqual([later.auditItems[0].classification, later.auditItems[0].reviewReason], ["review_required", "stale_source"]);
});
