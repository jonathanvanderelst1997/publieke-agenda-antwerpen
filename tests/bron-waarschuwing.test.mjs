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
import { loadAgendaRuntime, noClockDate } from "../scripts/agenda-source.mjs";
import { buildFeed } from "../scripts/build-sources.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const site = (naam) => fs.readFileSync(path.join(rootDir, "site", naam), "utf8");
// Wat een bezoeker vroeger las als een bron faalde (bovenaan, in de bronnenlijst en in de zin "Officiële broncontrole
// …" in hetzelfde ingeklapte blok, die de punten van een falende bron telde als "verouderde bron").
const WAARSCHUWINGEN = [
  "Sommige officiële bronnen zijn tijdelijk onbereikbaar",
  "Niet alle officiële bronnen zijn actueel",
  "De versheid van de officiële bronnen is nog niet bekend",
  "Bekijk de versheid per bron",
  "bron tijdelijk onbereikbaar",
  "laatste ophaalpoging mislukt",
  "verouderd sinds",
  "verouderde bron",
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

// Nakijkbevinding: de zin "Officiële broncontrole …" (#agenda-refresh-note, in het ingeklapte blok "Bronnen en volledige
// vooruitblik") telde "punten met bronconflict of verouderde bron". Met eBesluit falend waren dat precies de punten
// van eBesluit (reviewReason "stale_source"): zo zag een bezoeker toch dat er iets faalt. Nu telt de zin alleen
// verlopen punten en echte bronconflicten, en is ze dezelfde of een bron nu faalt of niet.
test("de zin 'Officiële broncontrole …' verraadt geen falende bron: punten die alleen door een niet-ververste bron wegvallen, tellen niet", () => {
  const runtime = loadAgendaRuntime(rootDir);
  assert.equal(typeof runtime.refreshNoteText, "function");
  const controle = "2026-10-18T03:18:00.000Z";
  const nu = Date.parse("2026-10-18T08:00:00.000Z");
  const punt = (classification, reviewReason = null) => ({ classification, reviewReason });
  const stand = (auditItems) => ({
    auditItems,
    counts: auditItems.reduce((n, item) => ({ ...n, [item.classification]: n[item.classification] + 1 }), { expired: 0, current: 0, future: 0, review_required: 0 }),
  });
  const gewoon = [punt("expired"), punt("expired"), punt("expired"), punt("future"), punt("current")];
  // Dezelfde stand, maar de bron van de twee komende punten faalt: ze vallen weg als "stale_source".
  const bronFaalt = [punt("expired"), punt("expired"), punt("expired"), punt("review_required", "stale_source"), punt("review_required", "stale_source")];
  const zin = runtime.refreshNoteText(controle, nu, stand(gewoon), 0);
  assert.equal(zin, "Officiële broncontrole vandaag om 05.18: 3 verlopen punten worden niet als actueel getoond.");
  assert.equal(runtime.refreshNoteText(controle, nu, stand(bronFaalt), 0), zin, "een falende bron verandert de zin niet");
  assert.doesNotMatch(zin, /verouderd|faalt|mislukt|onbereikbaar/);

  // Een echt bronconflict (een punt dat de bron niet bevestigt) telt wel, een falende bron ernaast nog altijd niet.
  const metConflict = [...bronFaalt, punt("review_required", "unverified_feed_item"), punt("review_required", "manual_source_changed")];
  assert.equal(
    runtime.refreshNoteText(controle, nu, stand(metConflict), 0),
    "Officiële broncontrole vandaag om 05.18: 3 verlopen punten en 2 punten met een bronconflict worden niet als actueel getoond."
  );
  // Achterstand van de hele agenda (meer dan 48 uur, de melding bovenaan blijft): de punten met "Laatst bevestigd".
  assert.equal(
    runtime.refreshNoteText(controle, nu, stand(bronFaalt), 2),
    "Officiële broncontrole vandaag om 05.18: 3 verlopen punten worden niet als actueel getoond; 2 punten blijven zichtbaar met “Laatst bevestigd” omdat de verversing achterloopt."
  );
  assert.equal(runtime.refreshNoteText("", nu, stand([]), 0), "Officiële broncontrole op een onbekend moment: 0 verlopen punten worden niet als actueel getoond.");
  // renderCounts gebruikt deze zin.
  assert.match(site("agenda.js"), /getElementById\("agenda-refresh-note"\)\.textContent = refreshNoteText\(/);
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
