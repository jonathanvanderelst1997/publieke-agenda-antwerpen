import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { loadAgendaRuntime, noClockDate } from "../scripts/agenda-source.mjs";
import { buildFeed } from "../scripts/build-sources.mjs";
import { sourceDocument, validateSourceDocument } from "../lib/source-feed.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engineSource = fs.readFileSync(path.join(rootDir, "site", "agenda-refresh.js"), "utf8");

function engineWith(feed) {
  const context = { Date: noClockDate(), URL, window: { PUBLIC_AGENDA_FEED: feed } };
  vm.createContext(context);
  vm.runInContext(engineSource, context);
  return context.window.PUBLIC_AGENDA_REFRESH_ENGINE;
}

const RETRIEVED = "2026-09-28T05:00:00.000Z";

function feedItem(id, fields = {}) {
  return {
    id,
    externalId: id,
    title: `Titel ${id}`,
    theme: "Activiteit",
    className: "activity",
    date: "2026-10-10",
    endDate: null,
    timeSlot: "14:00",
    timeText: "14 uur",
    location: "Groenplaats",
    postcodes: ["2000"],
    info: "",
    kind: "activity",
    sourceUrl: `https://www.antwerpen.be/info/${id}`,
    retrievedAt: RETRIEVED,
    ...fields,
  };
}

function feedWith(items, { retrievedAt = RETRIEVED, generatedAt = "2026-09-28T05:01:00.000Z", classificationAsOf = "2026-09-28" } = {}) {
  const documents = [
    sourceDocument("district-kalender", { retrievedAt, fetchStatus: "ok", items: items.filter((item) => item.id.startsWith("district-kal-")) }),
    sourceDocument("stad-uit", { retrievedAt, fetchStatus: "ok", items: items.filter((item) => item.id.startsWith("uit-")) }),
  ];
  const status = { schemaVersion: 1, generatedAt, classificationAsOf, sources: [] };
  return buildFeed({ status, documents }, []).feed;
}

test("automatische verificatie vraagt https én een toegelaten host", () => {
  const feed = feedWith([feedItem("district-kal-aaaaaa-2026-10-10")]);
  const good = feed.items[0];
  const engine = engineWith(feed);
  const ok = engine.reconcileAgendaItems([good], "2026-09-28");
  assert.equal(ok.publicItems.length, 1);
  assert.equal(ok.auditItems[0].verificationState, "verified");
  assert.equal(ok.auditItems[0].link, good.sourceUrl, "een feed-item houdt zijn eigen bron-URL");

  for (const sourceUrl of ["http://www.antwerpen.be/info/x", "https://example.com/info/x", "https://www.antwerpen.be/info/x?utm=1"]) {
    const result = engine.reconcileAgendaItems([{ ...good, sourceUrl }], "2026-09-28");
    assert.equal(result.publicItems.length, 0, sourceUrl);
    assert.equal(result.auditItems[0].classification, "review_required");
    assert.equal(result.auditItems[0].reviewReason, "unverified_feed_item");
  }

  // Een bronbestand met zo'n URL wordt al bij de validatie geweigerd.
  const document = sourceDocument("district-kalender", { retrievedAt: RETRIEVED, fetchStatus: "ok", items: [feedItem("district-kal-bbbbbb-2026-10-10", { reviewRequired: false })] });
  assert.deepEqual(validateSourceDocument(document), []);
  for (const [field, value, pattern] of [
    ["sourceUrl", "http://www.antwerpen.be/info/x", /sourceUrl/],
    ["sourceUrl", "https://evil.example/info/x", /sourceUrl/],
    ["retrievedAt", null, /retrievedAt/],
    ["reviewRequired", true, /review/],
    ["info", "mail ons op x" + String.fromCharCode(64) + "y.be", /privacy: at_sign/],
    ["info", "bel 03 123 45 67", /privacy: phone_number/],
    ["info", "BE12 3456 7890 1234", /privacy: iban/],
  ]) {
    const broken = structuredClone(document);
    broken.items[0][field] = value;
    assert.ok(validateSourceDocument(broken).some((error) => pattern.test(error)), `${field}=${value}`);
  }
  const withKey = structuredClone(document);
  withKey.items[0].organizer = "x";
  assert.ok(validateSourceDocument(withKey).some((error) => /forbidden_key|onbekende sleutel/.test(error)));
  const widened = structuredClone(document);
  widened.allowedHosts.push("example.com");
  assert.ok(validateSourceDocument(widened).some((error) => /allowedHosts/.test(error)), "hosts komen uit de code, niet uit de data");
});

test("retrievedAt per item gaat voor op dat van de bron; scope en inDistrict gaan mee", () => {
  const feed = feedWith([
    feedItem("district-kal-aaaaaa-2026-10-10", { retrievedAt: "2026-09-28T04:00:00.000Z" }),
    feedItem("uit-00000001-aaaa-4bbb-8ccc-000000000001-2026-10-11-1400", {
      date: "2026-10-11",
      title: "Stadsactiviteit",
      postcodes: ["2100"],
      location: "Deurne",
      sourceUrl: "https://www.uitinvlaanderen.be/agenda/e/x/00000001-aaaa-4bbb-8ccc-000000000001",
      inDistrict: false,
      noEventPage: true,
    }),
  ]);
  const engine = engineWith(feed);
  const result = engine.reconcileAgendaItems(feed.items, "2026-09-28");
  const district = result.auditItems.find((item) => item.sourceId === "district-kalender");
  const city = result.auditItems.find((item) => item.sourceId === "stad-uit");
  assert.equal(district.sourceRetrievedAt, "2026-09-28T04:00:00.000Z");
  assert.equal(district.scope, "district");
  assert.equal(district.inDistrict, true);
  assert.equal(city.scope, "stad");
  assert.equal(city.inDistrict, false);
  assert.equal(city.noEventPage, true);
  assert.equal(result.publicItems.length, 2);
  assert.equal(engine.config.classificationAsOf, "2026-09-28");
});

test("een bron die langer dan 48 uur niet ververst is, wordt verborgen en als verouderd gemeld", () => {
  const feed = feedWith([feedItem("district-kal-aaaaaa-2026-10-10")]);
  const engine = engineWith(feed);
  const fresh = engine.reconcileAgendaItems(feed.items, "2026-09-30", { now: "2026-09-30T04:59:00.000Z" });
  assert.equal(fresh.publicItems.length, 1);
  assert.equal(fresh.sourceFreshness.find((entry) => entry.sourceId === "district-kalender").state, "fresh");

  const stale = engine.reconcileAgendaItems(feed.items, "2026-09-30", { now: "2026-09-30T05:01:00.000Z" });
  assert.equal(stale.publicItems.length, 0);
  assert.equal(stale.auditItems[0].classification, "review_required");
  assert.equal(stale.auditItems[0].reviewReason, "stale_source");
  const freshness = stale.sourceFreshness.find((entry) => entry.sourceId === "district-kalender");
  assert.equal(freshness.state, "stale");
  assert.equal(freshness.staleSince, "2026-09-30T05:00:00.000Z");
  assert.equal(freshness.maxAgeHours, 48);
});

test("een handmatige bron volgt dezelfde SLA-vensters als de provenance-matrix", () => {
  const engine = engineWith(null);
  const hand = { id: "beweegdag-55-2026-09-19", title: "Beweegdag 55+", theme: "Sport", className: "sport", date: "2026-09-19", timeSlot: "09:00", timeText: "", location: "Zuidpark", info: "", link: "" };
  // Bron opgehaald 2026-09-16; toekomstig binnen 14 dagen: 3 dagen geldig, tot en met 2026-09-19.
  assert.equal(engine.classifyAgendaItem(hand, "2026-09-18").classification, "future");
  assert.equal(engine.classifyAgendaItem(hand, "2026-09-18").recheckDueOn, "2026-09-19");
  // Op de dag zelf is het item lopend: 2 dagen geldig vanaf 2026-09-16, dus verouderd.
  const sameDay = engine.classifyAgendaItem(hand, "2026-09-19");
  assert.equal(sameDay.classification, "review_required");
  assert.equal(sameDay.reviewReason, "stale_source");
  assert.equal(sameDay.slaMaxAgeDays, 2);
  assert.equal(sameDay.recheckDueOn, "2026-09-18");
});

test("classificatie met endDate: lopend tussen begin en einde, verlopen na het einde", () => {
  const feed = feedWith([feedItem("district-kal-aaaaaa-2026-09-09", { date: "2026-09-09", endDate: "2026-10-22", timeSlot: "Info", timeText: "" })]);
  const engine = engineWith(feed);
  // "now" blijft binnen de 48 uur, zodat alleen de datumlogica getoetst wordt.
  const classify = (asOf) => engine.classifyAgendaItem(feed.items[0], asOf, { now: RETRIEVED }).classification;
  assert.equal(classify("2026-09-08"), "future");
  assert.equal(classify("2026-09-09"), "current");
  assert.equal(classify("2026-09-28"), "current");
  assert.equal(classify("2026-10-22"), "current");
  assert.equal(classify("2026-10-23"), "expired");
});

test("feed-items worden niet als herhalende reeks uitgevouwen", () => {
  const runtime = loadAgendaRuntime(rootDir);
  const recurring = {
    ...feedItem("district-kal-cccccc-2026-10-01"),
    date: "2026-10-01",
    dateLabel: "1 oktober 2026 tot 29 oktober 2026",
    timeText: "elke woensdag en donderdag van 14 tot 16 uur",
    feed: true,
  };
  const expanded = runtime.expandAgendaItems([recurring]);
  assert.equal(expanded.length, 1);
  assert.equal(expanded[0].id, recurring.id);
  const hand = { ...recurring, id: "handmatige-reeks-2026-10-01", feed: undefined };
  assert.ok(runtime.expandAgendaItems([hand]).length > 1, "een handmatige reeks wordt wel uitgevouwen");
});
