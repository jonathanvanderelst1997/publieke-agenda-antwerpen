import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadExpandedAgendaItems, loadRefreshEngine } from "../scripts/agenda-source.mjs";
import { buildProvenanceSlaMatrix } from "../scripts/provenance-sla.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engine = loadRefreshEngine(rootDir);
const items = loadExpandedAgendaItems(rootDir);
const matrix = buildProvenanceSlaMatrix(items, engine);

function addDays(value, days) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test("de SLA-matrix bevat elk geladen bronitem exact één keer", () => {
  assert.ok(items.length >= 100);
  assert.equal(matrix.sourceItemCount, items.length);
  assert.equal(matrix.items.length, items.length);
  assert.equal(new Set(matrix.items.map((item) => item.id)).size, items.length);
});

test("publiceerbaarheid blijft fail-closed bij verlopen of onbewezen bronnen", () => {
  for (const item of matrix.items) {
    assert.equal(item.includedInLocalCandidate, item.publishEligible);
    if (item.publishEligible) {
      assert.ok(["current", "future"].includes(item.classification));
      assert.equal(item.verificationState, "verified");
      assert.equal(item.slaStatus, "fresh_verified");
      assert.equal(item.failClosed, false);
    } else {
      assert.equal(item.failClosed, true);
    }
  }
});

test("elke bewezen bron heeft een geldige HTTPS-provenance en expliciete vervaldatum", () => {
  for (const item of matrix.items.filter((candidate) => candidate.verificationState === "verified")) {
    assert.match(item.canonicalSourceUrl, /^https:\/\//);
    assert.ok(item.sourceRetrievedAt);
    if (["current", "future"].includes(item.classification) && item.visibleThrough) {
      // Handmatig item op datum: geen herbevestiging, zichtbaar tot en met de laatste dag.
      assert.equal(item.maxAgeDays, null);
      assert.equal(item.recheckDueOn, item.visibleThrough);
      assert.ok(item.visibleThrough >= item.classificationAsOf, item.id);
    } else if (["current", "future"].includes(item.classification)) {
      assert.ok(item.maxAgeDays > 0);
      assert.match(item.recheckDueOn, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(new Date(`${item.recheckDueOn}T00:00:00Z`).toISOString().slice(0, 10), item.recheckDueOn);
      assert.ok(item.recheckDueOn >= item.sourceRetrievedAt.slice(0, 10));
    }
  }
});

test("onzekere sportreeksen zijn opgeruimd: wat overblijft is voorbij en niet publiceerbaar", () => {
  // P10: de onbevestigde reeksdata (vanaf 10 augustus) staan niet meer in site/agenda.js. De oudere
  // data van dezelfde reeksen zijn gewoon voorbij en blijven als geschiedenis staan.
  for (const title of ["Sportinitiaties met Jespo", "Gratis initiaties boogschieten"]) {
    const rows = matrix.items.filter((item) => item.title === title);
    assert.ok(rows.every((item) => !item.publishEligible), title);
    assert.ok(rows.every((item) => item.eventDate < "2026-08-10"), title);
    assert.ok(rows.every((item) => item.slaStatus !== "blocked_review_required"), title);
  }
});

test("een lopende werf uit een regel is publiceerbaar zolang haar bron vers is, en daarna geblokkeerd", () => {
  // Verzonnen werf en bron: er is geen echte handmatige werf meer, maar de regel moet blijven werken.
  const werf = {
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
  const asOf = engine.config.classificationAsOf;
  for (const [ageDays, expected] of [[0, "fresh_verified"], [5, "stale_blocked"]]) {
    const proef = loadRefreshEngine(rootDir);
    proef.config.sources["proef-bron"] = {
      publisher: "District Antwerpen",
      url: "https://www.antwerpen.be/",
      retrievedAt: `${addDays(asOf, -ageDays)}T07:00:00Z`,
      state: "verified",
      note: "Verzonnen bron voor de toets.",
      officialPublic: true,
      scope: "district",
    };
    proef.config.rules.unshift({ match: { title: werf.title, theme: "Werken" }, sourceId: "proef-bron", classification: "current" });
    const [row] = buildProvenanceSlaMatrix([werf], proef).items;
    assert.equal(row.sourceId, "proef-bron");
    assert.equal(row.slaStatus, expected, `${ageDays} dagen oud`);
    assert.equal(row.publishEligible, expected === "fresh_verified");
    if (expected === "stale_blocked") assert.deepEqual([row.classification, row.reviewReason], ["review_required", "stale_source"]);
  }
});

test("feed-items houden hun eigen bron-URL en ophaalmoment in de matrix", () => {
  for (const row of matrix.items.filter((item) => item.sourceKind === "official_feed")) {
    const item = items.find((candidate) => candidate.id === row.id);
    assert.equal(row.canonicalSourceUrl, item.link);
    assert.equal(row.sourceRetrievedAt, item.retrievedAt);
  }
});
