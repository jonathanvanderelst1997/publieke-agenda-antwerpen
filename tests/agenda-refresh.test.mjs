import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadExpandedAgendaItems, loadHandAgendaItems, loadRefreshEngine } from "../scripts/agenda-source.mjs";

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

// Een verzonnen werf met een eigen regel en bron, op een verse engine: zo blijven de regels voor
// lopende werven en bronconflicten getoetst, ook nu er geen echte handmatige werf meer is.
const PROEF_WERF = {
  id: "proefwerf-verzonnenstraat-2026-09-01",
  title: "Proefwerf Verzonnenstraat",
  theme: "Werken",
  className: "works",
  date: "2026-09-01",
  dateLabel: "1 september 2026 tot voorjaar 2027",
  timeSlot: "Info",
  timeText: "",
  location: "Verzonnenstraat",
  info: "Verzonnen werf voor de toets.",
  link: "https://www.antwerpen.be/",
};

function engineWithRule({ classification, retrievedAt = "2026-10-08T07:00:00Z", title = PROEF_WERF.title, theme = "Werken" }) {
  const proef = loadRefreshEngine(rootDir);
  proef.config.sources["proef-bron"] = {
    publisher: "District Antwerpen",
    url: "https://www.antwerpen.be/",
    retrievedAt,
    state: classification === "review_required" ? "review_required" : "verified",
    note: "Verzonnen bron voor de toets.",
    officialPublic: true,
    scope: "district",
  };
  proef.config.rules.unshift({ match: { title, theme }, sourceId: "proef-bron", classification });
  return proef;
}

test("classificeert verlopen, lopende en toekomstige punten deterministisch", () => {
  const asOf = engine.config.classificationAsOf;
  assert.match(asOf, /^\d{4}-\d{2}-\d{2}$/);
  // Een regel met een vaste classificatie wint, los van de datum.
  assert.equal(find("Kammenstraat autovrij tijdens soldenperiode", "2026-06-29").classification, "expired");
  assert.equal(find("Kammenstraat autovrij tijdens soldenperiode", "2026-06-29").classificationBasis, "rule");

  // Een lopende werf blijft lopend zolang zijn bron vers is; daarna verouderd en niet publiek.
  const proef = engineWithRule({ classification: "current" });
  assert.equal(proef.reconcileAgendaItems([PROEF_WERF], "2026-10-10").auditItems[0].classification, "current");
  const later = proef.reconcileAgendaItems([PROEF_WERF], "2026-10-11").auditItems[0];
  assert.deepEqual([later.classification, later.reviewReason], ["review_required", "stale_source"]);

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
  const sport = { ...PROEF_WERF, id: "proefsport-2026-10-20", title: "Proefsport Verzonnenplein", theme: "Sport", className: "sport", date: "2026-10-20" };
  const proef = engineWithRule({ classification: "review_required", title: sport.title, theme: "Sport" });
  const outcome = proef.reconcileAgendaItems([sport], "2026-10-10");
  assert.deepEqual([outcome.auditItems[0].classification, outcome.auditItems[0].reviewReason], ["review_required", "rule"]);
  assert.equal(outcome.publicItems.length, 0);
});

// P10: de 19 oude handmatige items die alleen nog als "na te kijken" (review_required) in de lijst
// stonden, zijn opgeruimd, samen met hun regels en bronnen. Op 10 oktober 2026 staat geen enkel
// handmatig item nog op "na te kijken".
const OPGERUIMD = [
  "fasewissel-heraanleg-balansstraat-en-lange-elzenstraat-2026-06-29",
  "nieuwe-fase-heraanleg-gaston-burssenslaan-en-hanegraefstraat-2026-06-29",
  "werken-halenstraat-en-schijnpoortweg-2026-06-29",
  "heraanleg-van-maerlantstraat-vondelstraat-fase-2-2026-08-03",
  "sportinitiaties-met-jespo-2026-07-01-2026-08-11-4289dab3",
  "sportinitiaties-met-jespo-2026-07-01-2026-08-12-a2c30a8",
  "sportinitiaties-met-jespo-2026-07-01-2026-08-13-5fe05c08",
  "gratis-initiaties-boogschieten-2026-07-05-2026-08-16-d104f9ef",
  "sportinitiaties-met-jespo-2026-07-01-2026-08-18-4289dacb",
  "sportinitiaties-met-jespo-2026-07-01-2026-08-19-a2c30c0",
  "sportinitiaties-met-jespo-2026-07-01-2026-08-20-5fe05c20",
  "gratis-initiaties-boogschieten-2026-07-05-2026-08-23-d104f9f0",
  "sportinitiaties-met-jespo-2026-07-01-2026-08-25-4289dace",
  "sportinitiaties-met-jespo-2026-07-01-2026-08-26-a2c30c3",
  "sportinitiaties-met-jespo-2026-07-01-2026-08-27-5fe05c23",
  "gratis-initiaties-boogschieten-2026-07-05-2026-08-30-d104f9f1",
  "gratis-initiaties-boogschieten-2026-07-05-2026-09-06-d104f9f2",
  "gratis-initiaties-boogschieten-2026-07-05-2026-09-13-4f9a4386",
  "gratis-initiaties-boogschieten-2026-07-05-2026-09-20-4f9a4387",
];

test("de 19 oude handmatige items zijn weg en geen handmatig item staat nog als na te kijken", () => {
  assert.equal(OPGERUIMD.length, 19);
  const hand = loadHandAgendaItems(rootDir);
  const ids = new Set(hand.map((item) => item.id));
  assert.deepEqual(OPGERUIMD.filter((id) => ids.has(id)), []);
  const handResult = engine.reconcileAgendaItems(hand, "2026-10-10");
  assert.deepEqual(
    handResult.auditItems.filter((item) => item.classification === "review_required").map((item) => item.id),
    []
  );
  // Geen regel of bron die nergens meer bij hoort.
  for (const sourceId of ["city-works-permit", "city-osystraat-works", "city-gaston-works", "city-old-sport-newsletter", "archery-organizer-social"]) {
    assert.equal(engine.config.sources[sourceId], undefined, sourceId);
    assert.ok(!engine.config.rules.some((rule) => rule.sourceId === sourceId), sourceId);
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

  const regatta = find("Poëtische Rimpelingen", "2026-10-10");
  assert.equal(regatta.sourceId, "poetische-rimpelingen-regatta");
  assert.equal(regatta.timeSlot, "14:00");
  assert.equal(regatta.link, "https://maandvandevoetganger.be/actie/wandelen-met-woorden-poetische-rimpelingen/");
  assert.match(regatta.info, /5 euro/);

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
  assert.equal(engine.config.sources["city-yogalates"].scope, "stad");
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

  const proef = engineWithRule({ classification: "current" });
  const due = addDays(proef.config.sources["proef-bron"].retrievedAt, 2);
  const later = proef.reconcileAgendaItems([PROEF_WERF], addDays(due, 1));
  assert.deepEqual([later.auditItems[0].classification, later.auditItems[0].reviewReason], ["review_required", "stale_source"]);
});
