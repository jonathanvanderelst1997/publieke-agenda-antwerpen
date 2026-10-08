// Handmatige items zijn een overbrugging: hun officiële bron wordt bij elke verversing automatisch
// nagekeken, en een gewijzigd of verdwenen item gaat van de site en wordt gemeld.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { datePhrase, judgePage, manualCheckTargets, nextEntry, validateManualCheck } from "../lib/manual-check.mjs";
import { loadExpandedAgendaItems, loadRefreshEngine } from "../scripts/agenda-source.mjs";
import { buildFeed, readSources } from "../scripts/build-sources.mjs";
import { run } from "../scripts/check-manual-sources.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("controlewoorden: de datum zoals op een pagina, plus de woorden van de bron", () => {
  assert.equal(datePhrase("2026-10-10"), "10 oktober");
  assert.equal(datePhrase("2026-03-01"), "1 maart");
  const sources = {
    a: { url: "https://www.antwerpen.be/info/x/y", check: { mustContain: ["buurtfeest"] } },
    b: { url: "https://www.antwerpen.be/publiekeruimte", check: false },
    c: { url: "http://onveilig.example/" },
  };
  const targets = manualCheckTargets([
    { id: "feest-2026-10-10", sourceId: "a", date: "2026-10-10" },
    { id: "bevraging-2026-10-05", sourceId: "b", date: "2026-10-05" },
    { id: "onveilig-2026-10-05", sourceId: "c", date: "2026-10-05" },
    { id: "feed-1", sourceId: "a", date: "2026-10-11", feed: true },
  ], sources);
  assert.deepEqual(targets.map((t) => [t.sourceId, t.phrases, t.items]), [
    ["a", ["10 oktober", "buurtfeest"], ["feest-2026-10-10"]],
    ["b", [], ["bevraging-2026-10-05"]],
  ]);
});

test("oordeel: ok, gewijzigd, weg, onbereikbaar, niet controleerbaar", () => {
  const html = "<h1>Gratis buurtfeest</h1><p>Op 10&nbsp;oktober 2026 om 14 uur.</p><script>var x='nee'</script>";
  assert.deepEqual(judgePage({ httpStatus: 200, html, phrases: ["10 oktober", "Buurtfeest"] }), { status: "ok", missing: [] });
  assert.deepEqual(judgePage({ httpStatus: 200, html, phrases: ["11 oktober", "buurtfeest"] }), { status: "gewijzigd", missing: ["11 oktober"] });
  assert.equal(judgePage({ httpStatus: 404, html: "", phrases: ["10 oktober"] }).status, "weg");
  assert.equal(judgePage({ httpStatus: 410, html: "", phrases: [] }).status, "weg");
  assert.equal(judgePage({ httpStatus: 503, html: "", phrases: ["10 oktober"] }).status, "onbereikbaar");
  assert.equal(judgePage({ httpStatus: null, html: "", phrases: ["10 oktober"] }).status, "onbereikbaar");
  assert.equal(judgePage({ httpStatus: 200, html, phrases: [] }).status, "niet_controleerbaar");
  assert.equal(judgePage({ httpStatus: 200, html, phrases: ["var x"] }).status, "gewijzigd", "scripts tellen niet");
});

test("sinds wanneer: blijft staan zolang de status gelijk blijft, ok wist het", () => {
  const target = { sourceId: "a", url: "https://www.antwerpen.be/info/x/y", items: ["feest-2026-10-10"] };
  const first = nextEntry(null, target, { status: "gewijzigd", missing: ["10 oktober"], httpStatus: 200 }, "2026-10-05T05:20:00Z");
  assert.equal(first.since, "2026-10-05T05:20:00Z");
  const second = nextEntry(first, target, { status: "gewijzigd", missing: ["10 oktober"], httpStatus: 200 }, "2026-10-06T05:20:00Z");
  assert.equal(second.since, "2026-10-05T05:20:00Z");
  assert.equal(nextEntry(second, target, { status: "ok", missing: [], httpStatus: 200 }, "2026-10-07T05:20:00Z").since, null);
  assert.deepEqual(validateManualCheck({ schemaVersion: 1, checkedAt: "2026-10-05T05:20:00Z", sources: [first, second] }), []);
  assert.ok(validateManualCheck({ schemaVersion: 1, checkedAt: "x", sources: [{ ...first, url: "https://a.be/?x=1", contact: "a@b.be" }] }).length >= 3);
});

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "manual-check-"));
  for (const dir of ["site", "scripts", "lib"]) fs.cpSync(path.join(rootDir, dir), path.join(root, dir), { recursive: true });
  return root;
}

test("het script kijkt elke zichtbare handmatige bron na, volgt een doorverwijzing en raakt nooit de rest", async () => {
  const root = tempRoot();
  const asked = [];
  const fetch = async (url) => {
    asked.push(String(url));
    if (String(url).includes("publiekeruimte")) return { status: 302, headers: { get: () => "https://www.antwerpen.be/nl/overzicht/district-antwerpen-1/openbare-werken" }, text: async () => "" };
    if (String(url).includes("citaatopstraat")) return { status: 503, headers: { get: () => null }, text: async () => "" };
    if (String(url).includes("gaston")) return { status: 200, headers: { get: () => null }, text: async () => "<p>Op 10 oktober 2026: officiële inhuldiging en gratis buurtfeest.</p>" };
    return { status: 200, headers: { get: () => null }, text: async () => "<p>Openbare werken</p>" };
  };
  const doc = await run({ rootDir: root, fetch, clock: () => new Date("2026-10-06T03:20:00Z"), log: () => {}, sleep: async () => {} });
  const byId = Object.fromEntries(doc.sources.map((entry) => [entry.sourceId, entry.status]));
  assert.deepEqual(byId, { "citaat-op-straat": "onbereikbaar", "city-gaston-buurtfeest": "ok", "publiekeruimte-schoolstraat-vanhoenacker": "niet_controleerbaar" });
  assert.ok(asked.some((url) => url.endsWith("/openbare-werken")), "doorverwijzing gevolgd");
  const written = JSON.parse(fs.readFileSync(path.join(root, "site", "sources", "manual-check.json"), "utf8"));
  assert.deepEqual(validateManualCheck(written), []);
});

test("gewijzigd of weg haalt het handmatige item van de site; onbereikbaar niet", () => {
  const items = loadExpandedAgendaItems(rootDir).filter((item) => !item.feed);
  const feest = items.find((item) => item.id === "buurtfeest-gaston-burssenslaan-hanegraefstraat-2026-10-10");
  assert.ok(feest);
  const engineWith = (status) => {
    const root = tempRoot();
    const file = path.join(root, "site", "sources", "manual-check.json");
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, checkedAt: "2026-10-06T03:20:00Z", sources: [
      { sourceId: "city-gaston-buurtfeest", url: "https://www.antwerpen.be/info/6149b6f0305f459e313c07cc/voorontwerp-heraanleg-gaston-burssenslaan", status, httpStatus: status === "weg" ? 404 : 200, missing: [], items: [feest.id], since: "2026-10-06T03:20:00Z" },
    ] }));
    const sources = readSources(root);
    const { feed } = buildFeed(sources, []);
    fs.writeFileSync(path.join(root, "site", "agenda-feed.js"), `window.PUBLIC_AGENDA_FEED = ${JSON.stringify(feed)};\n`);
    return loadRefreshEngine(root);
  };
  for (const [status, visible, reason] of [["ok", 1, null], ["onbereikbaar", 1, null], ["gewijzigd", 0, "manual_source_changed"], ["weg", 0, "manual_source_gone"]]) {
    const engine = engineWith(status);
    const result = engine.reconcileAgendaItems([feest], "2026-10-06");
    assert.equal(result.publicItems.length, visible, status);
    assert.equal(result.auditItems[0].reviewReason, reason, status);
    assert.equal(result.auditItems[0].manualCheckStatus, status);
    // Het script zelf kijkt zonder de vorige uitkomst, zodat een herstelde pagina het item terugbrengt.
    assert.equal(engine.reconcileAgendaItems([feest], "2026-10-06", { ignoreManualCheck: true }).publicItems.length, 1, status);
  }
});
