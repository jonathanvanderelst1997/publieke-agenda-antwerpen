import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

await import("../site/event-types.js");
await import("../site/agenda-uitgaan.js");
const U = globalThis.PublicAgendaUitgaan;
const T = globalThis.PublicAgendaEventTypes;
const item = (title, fields = {}) => ({ title, theme: "Activiteit", sourceId: "district-kalender", info: "", location: "Teststraat 1, 2000 Antwerpen", timeSlot: "14:00", date: "2026-10-10", ...fields });

test("standaardweergave uitgaan & evenementen: leuke soorten aan, de rest met één klik", () => {
  for (const key of ["festival", "neighborhood", "culture", "family", "parade", "sport", "flea", "shopping"]) assert.ok(U.defaultOn.includes(key), key);
  for (const key of ["meetings", "admin", "calls", "works", "markets", "other", "info"]) assert.ok(!U.defaultOn.includes(key), key);
});

test("soorten: buurtfeesten, stoeten, rommelmarkten, koopzondagen en feesten", () => {
  assert.equal(U.categoryOf(item("Buurtfeest Teststraat")), "neighborhood");
  assert.equal(U.categoryOf(item("Speelstraat Testlaan")), "neighborhood");
  assert.equal(U.categoryOf(item("Carnavalstoet")), "parade");
  assert.equal(U.categoryOf(item("Rommelmarkt op het plein")), "flea");
  assert.equal(U.categoryOf(item("Koopzondag", { sourceId: "stad-koopzondagen" })), "shopping");
  assert.equal(U.categoryOf(item("Zomerfestival in het park")), "festival");
  assert.equal(U.categoryOf(item("Kerstmarkt op de Grote Markt")), "festival");
  assert.equal(U.categoryOf(item("Openluchtconcert")), "culture");
  assert.equal(U.categoryOf(item("Familiedag in de bib")), "family");
  assert.equal(U.categoryOf(item("Stratenloop", { theme: "Sport" })), "sport");
});

test("raad, oproepen en werken staan standaard uit", () => {
  assert.equal(U.categoryOf(item("Districtsraad", { sourceId: "district-vergaderingen" })), "meetings");
  assert.equal(U.categoryOf(item("Bijzondere raadscommissie cultuur")), "meetings");
  assert.equal(U.categoryOf(item("Dien je project in", { theme: "Oproep/deadline" })), "calls");
  assert.equal(U.categoryOf(item("Heraanleg Testlaan", { theme: "Werken" })), "works");
});

test("bevraging, enquête en meldingen zijn administratief, niet een evenement", () => {
  assert.equal(T.classifyEventType(item("Bevraging schoolstraat Testlaan")), "administrative");
  assert.equal(T.classifyEventType(item("Vul de enquête in over je buurt")), "administrative");
  assert.equal(U.categoryOf(item("Bevraging schoolstraat Testlaan")), "admin");
  assert.equal(U.categoryOf(item("Meldingen openbaar domein")), "admin");
  assert.equal(U.categoryOf(item("Geef je mening", { theme: "Oproep/deadline" })), "admin");
  // Inspraak zonder concreet uur en plaats is administratief; met uur en plaats een infomoment.
  assert.equal(U.categoryOf(item("Inspraak burgerbegroting", { timeSlot: "Uur volgt", location: "" })), "admin");
  assert.equal(U.categoryOf(item("Infoavond burgerbegroting")), "info");
  // Een buurtfeest dat een bevraging vermeldt, blijft een buurtfeest.
  assert.equal(U.categoryOf(item("Buurtfeest", { info: "Vul ook de bevraging in." })), "neighborhood");
});

test("weekmarkten worden gebundeld: één kaart per markt met dagen", () => {
  const market = (date) => item("Gemengde markt Testplein", { sourceId: "stad-markten", date, timeText: "8 tot 13 uur", location: "Testplein", inDistrict: true });
  const items = ["2026-10-04", "2026-10-07", "2026-10-11", "2026-10-14", "2026-10-18"].map(market);
  assert.equal(U.categoryOf(items[0]), "markets");
  const bundle = U.bundleWeeklyMarkets([...items, item("Biomarkt Andereplein", { sourceId: "stad-markten", date: "2026-10-10", location: "Andereplein" })], "2026-10-05");
  assert.equal(bundle.length, 2);
  const first = bundle[0];
  assert.equal(first.title, "Gemengde markt Testplein");
  assert.deepEqual(first.weekdays, ["wo", "zo"]);
  assert.equal(first.nextDate, "2026-10-07");
  assert.equal(first.count, 5);
});

test("periodes: vandaag, dit weekend (vr-zo), deze week en volgende week", () => {
  const monday = U.rangesFor("2026-10-05");
  assert.deepEqual(monday.today, { from: "2026-10-05", to: "2026-10-05" });
  assert.deepEqual(monday.weekend, { from: "2026-10-09", to: "2026-10-11" });
  assert.deepEqual(monday.week, { from: "2026-10-05", to: "2026-10-11" });
  assert.deepEqual(monday.next, { from: "2026-10-12", to: "2026-10-18" });
  assert.deepEqual(U.weekendRange("2026-10-10"), { from: "2026-10-10", to: "2026-10-11" });
  assert.deepEqual(U.weekendRange("2026-10-11"), { from: "2026-10-11", to: "2026-10-11" });
});

test("uitgelicht: leuke items in het district eerst, markten nooit, chronologisch getoond", () => {
  const range = { from: "2026-10-09", to: "2026-10-11" };
  const items = [
    { ...item("Koopzondag", { sourceId: "stad-koopzondagen", date: "2026-10-11", scope: "stad", inDistrict: true }), category: "shopping" },
    { ...item("Buurtfeest Teststraat", { date: "2026-10-10" }), category: "neighborhood" },
    { ...item("Gemengde markt", { sourceId: "stad-markten", date: "2026-10-10" }), category: "markets" },
    { ...item("Raadscommissie", { date: "2026-10-09" }), category: "meetings" },
    { ...item("Theater op het plein", { date: "2026-10-09" }), category: "culture" },
    { ...item("Ander district", { date: "2026-10-10", scope: "stad", inDistrict: false, location: "District Deurne, locatie via de officiële bron" }), category: "culture" },
    { ...item("Volgende maand", { date: "2026-11-10" }), category: "festival" },
  ];
  const picked = U.pickHighlights(items, range, 3).map((x) => x.title);
  assert.deepEqual(picked, ["Theater op het plein", "Buurtfeest Teststraat", "Koopzondag"]);
  assert.ok(!U.pickHighlights(items, range, 10).some((x) => x.category === "markets" || x.category === "meetings"));
});

test("versheid: ouder dan 48 uur is verouderd", () => {
  const now = Date.parse("2026-10-05T10:00:00Z");
  assert.equal(U.freshness("2026-10-04T10:00:00Z", now).stale, false);
  const stale = U.freshness("2026-10-02T08:55:00Z", now);
  assert.equal(stale.stale, true);
  assert.equal(stale.ageDays, 3);
  assert.equal(U.freshness(null, now).known, false);
});

test("bij verouderde data blijven alleen bevestigde, niet-verlopen items zichtbaar binnen de marge", () => {
  const now = Date.parse("2026-10-05T10:00:00Z");
  const base = { feed: true, reviewReason: "stale_source", verificationState: "verified", sourceRetrievedAt: "2026-10-02T08:55:00Z" };
  assert.equal(U.inStaleGrace(base, now), true);
  assert.equal(U.inStaleGrace(base, now, 14, { backlog: true }), true);
  // Geen achterstand: geen "Laatst bevestigd", ook niet voor een bronitem (zoals de README zegt).
  assert.equal(U.inStaleGrace(base, now, 14, { backlog: false }), false);
  // Handmatige items krijgen nooit de 14-dagengratie: ze lopen tot en met hun laatste dag.
  assert.equal(U.inStaleGrace({ ...base, feed: undefined }, now), false);
  assert.equal(U.inStaleGrace({ ...base, reviewReason: "rule" }, now), false);
  assert.equal(U.inStaleGrace({ ...base, reviewReason: null }, now), false);
  assert.equal(U.inStaleGrace({ ...base, verificationState: "review_required" }, now), false);
  assert.equal(U.inStaleGrace({ ...base, sourceRetrievedAt: "2026-09-10T08:00:00Z" }, now), false);
});

test("de site laadt de module vóór agenda.js en houdt de straatfilter bovenaan", () => {
  const index = fs.readFileSync(new URL("../site/index.html", import.meta.url), "utf8");
  assert.ok(index.indexOf('src="/agenda-uitgaan.js"') > 0 && index.indexOf('src="/agenda-uitgaan.js"') < index.indexOf('src="/agenda.js"'));
  assert.ok(index.indexOf('id="agenda-street-jump"') < index.indexOf('id="agenda-highlights"'));
  assert.match(index, /id="agenda-stale-banner"/);
  assert.match(index, /id="agenda-freshness"/);
  assert.match(index, /name="color-scheme" content="light dark"/);
  const agenda = fs.readFileSync(new URL("../site/agenda.js", import.meta.url), "utf8");
  assert.match(agenda, /auditItems[\s\S]*inStaleGrace/);
  assert.match(agenda, /inStaleGrace\(.*backlog: agendaFreshness\.stale/);
  assert.match(agenda, /FRESH_LIMIT_HOURS = 48/);
  const css = fs.readFileSync(new URL("../site/agenda-uitgaan.css", import.meta.url), "utf8");
  assert.match(css, /prefers-color-scheme: dark/);
  assert.match(css, /:root\[data-theme="dark"\]/);
});

test("bevraging schoolstraat staat onder de optie inspraak (standaard uit, één klik aan)", async () => {
  assert.equal(U.categoryFor("admin").label, "Inspraak & bevraging");
  assert.ok(!U.defaultOn.includes("admin"));
  const { loadExpandedAgendaItems, loadRefreshEngine } = await import("../scripts/agenda-source.mjs");
  const root = new URL("..", import.meta.url).pathname;
  const engine = loadRefreshEngine(root);
  const result = engine.reconcileAgendaItems(loadExpandedAgendaItems(root), "2026-10-05", { now: "2026-10-05T12:00:00Z" });
  const school = result.publicItems.find((i) => i.title === "Bevraging proefperiode schoolstraat Jan Vanhoenackerstraat");
  assert.ok(school, "gepubliceerd");
  assert.equal(school.classification, "current");
  assert.equal(U.categoryOf(school), "admin");
  assert.doesNotMatch(JSON.stringify(school), /@/);
});

test("Herfstklaar (handmatig) valt onder buurt & straat en staat dus standaard aan", async () => {
  const { loadExpandedAgendaItems } = await import("../scripts/agenda-source.mjs");
  const root = new URL("..", import.meta.url).pathname;
  const herfst = loadExpandedAgendaItems(root).find((x) => x.id === "herfstklaar-district-antwerpen-2026-10-23-2026-10-25");
  assert.ok(herfst);
  assert.equal(U.categoryOf(herfst), "neighborhood");
  assert.ok(U.defaultOn.includes("neighborhood"));
});
