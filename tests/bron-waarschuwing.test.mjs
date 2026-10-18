// Besluit van de eigenaar (18-10-2026): "niemand moet weten als er iets faalt, de momentopname blijft wel goed".
// De bronwaarschuwing voor bezoekers (#191, #agenda-source-warning, "Sommige officiële bronnen zijn tijdelijk
// onbereikbaar ...") is weg van de publieke site, en de bronnenlijst zegt bij een falende bron niet meer "mislukt",
// "onbereikbaar" of "verouderd": de site toont de laatste goede stand. Intern blijft alles: de bronstatus in de feed
// (fetchStatus, errorCode), sourceFreshness in de browser en de job source-health met haar alarmen naar de eigenaar.
// Wat een bezoeker in de browser ziet, toetst tests/e2e/plek.e2e.mjs (met de eBesluit-bronnen falend).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { sourceHealthOf, statusEntry } from "../lib/fetch-util.mjs";
import { sourceDocument } from "../lib/source-feed.mjs";
import { noClockDate } from "../scripts/agenda-source.mjs";
import { buildFeed } from "../scripts/build-sources.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const site = (naam) => fs.readFileSync(path.join(rootDir, "site", naam), "utf8");
// Wat een bezoeker vroeger las als een bron faalde (bovenaan en in de bronnenlijst).
const WAARSCHUWINGEN = [
  "Sommige officiële bronnen zijn tijdelijk onbereikbaar",
  "Niet alle officiële bronnen zijn actueel",
  "De versheid van de officiële bronnen is nog niet bekend",
  "Bekijk de versheid per bron",
  "bron tijdelijk onbereikbaar",
  "laatste ophaalpoging mislukt",
  "verouderd sinds",
];

test("de voorpagina heeft geen bronwaarschuwing meer: geen blok, geen script, geen stijl", () => {
  const html = site("index.html");
  assert.doesNotMatch(html, /agenda-source-warning/);
  assert.doesNotMatch(html, /bron-waarschuwing\.js/);
  assert.equal(fs.existsSync(path.join(rootDir, "site", "bron-waarschuwing.js")), false);
  for (const naam of fs.readdirSync(path.join(rootDir, "site")).filter((n) => n.endsWith(".css")))
    assert.doesNotMatch(site(naam), /source-warning|source-stale/, naam);
  // De melding dat de hele agenda niet meer ververst wordt (meer dan 48 uur), blijft: dat is geen bronfout maar een
  // oude momentopname.
  assert.match(html, /id="agenda-stale-banner"/);
});

test("geen script van de site zegt een bezoeker dat een bron faalt", () => {
  const scripts = fs.readdirSync(path.join(rootDir, "site")).filter((n) => n.endsWith(".js") && n !== "agenda-feed.js");
  for (const naam of scripts) {
    const tekst = site(naam);
    for (const zin of WAARSCHUWINGEN) assert.ok(!tekst.includes(zin), `${naam} bevat "${zin}"`);
    assert.doesNotMatch(tekst, /renderBronWaarschuwing|PUBLIC_AGENDA_SOURCE_WARNING/, naam);
  }
  // De bronnenlijst: een falende bron toont het moment van haar laatste goede stand ("ververst op …").
  const agenda = site("agenda.js");
  assert.match(agenda, /function renderSourceStatus\(/);
  assert.doesNotMatch(agenda, /entry\.fetchStatus === "error"/);
  assert.match(agenda, /class="source-fresh">ververst op \$\{esc\(formatInstant\(entry\.retrievedAt\)\)\}/);
});

test("intern blijft de bronstatus: feed, sourceFreshness en source-health kennen de falende eBesluit-bron", () => {
  const generatedAt = "2026-10-18T03:18:00.000Z";
  const retrievedAt = "2026-10-12T03:21:00.000Z";
  const ok = "2026-10-18T03:17:00.000Z";
  const documents = [
    sourceDocument("district-ebesluit", { retrievedAt, fetchStatus: "error", items: [] }),
    sourceDocument("district-kalender", { retrievedAt: ok, fetchStatus: "ok", items: [] }),
  ];
  const fout = statusEntry("district-ebesluit", { fetchStatus: "error", retrievedAt, itemCount: 0, errorCode: "http_500" });
  const status = {
    schemaVersion: 1,
    generatedAt,
    classificationAsOf: "2026-10-18",
    sources: [fout, statusEntry("district-kalender", { fetchStatus: "ok", retrievedAt: ok, itemCount: 0 })],
  };
  const { feed } = buildFeed({ status, documents }, []);
  const bron = feed.sources.find((s) => s.sourceId === "district-ebesluit");
  assert.deepEqual([bron.fetchStatus, bron.errorCode, bron.retrievedAt], ["error", "http_500", retrievedAt]);

  const context = { Date: noClockDate(), URL, window: { PUBLIC_AGENDA_FEED: feed } };
  vm.createContext(context);
  vm.runInContext(site("agenda-refresh.js"), context);
  const freshness = context.window.PUBLIC_AGENDA_REFRESH_ENGINE.reconcileAgendaItems([], "2026-10-18", { now: "2026-10-18T06:00:00.000Z" }).sourceFreshness;
  const ebesluit = freshness.find((s) => s.sourceId === "district-ebesluit");
  assert.deepEqual([ebesluit.state, ebesluit.fetchStatus, ebesluit.errorCode], ["stale", "error", "http_500"]);
  assert.equal(freshness.find((s) => s.sourceId === "district-kalender").state, "fresh");

  // De job source-health (scripts/sources-health.mjs) blijft rood: na 48 uur is een tijdelijke fout een fout.
  assert.equal(sourceHealthOf(fout, Date.parse(generatedAt)), "error");
  // Binnen 48 uur is ze "stale": een waarschuwing in de run, nog altijd niet voor bezoekers.
  assert.equal(sourceHealthOf({ ...fout, retrievedAt: "2026-10-17T03:21:00.000Z" }, Date.parse(generatedAt)), "stale");
});
