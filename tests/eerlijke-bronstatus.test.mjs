// P10: eerlijke bronstatus en kleine fouten.
// - Een bron die 3 kalenderdagen op rij niets komends levert (0 items of alleen voorbije), heet
//   "leeg" (oranje) in refresh-status.json, in sources:health en op de site, in plaats van "ok".
// - De GIPOD-evenementenbron zegt eerlijk dat ze alleen het district toont, waar de stad geen
//   evenementen in GIPOD zet (GIPOD bevat vooral buurgemeenten, en die vallen weg).
// - "Bijgewerkt" toont altijd het uur; de dekkingsmatrix zet speelstraten en evenementen niet meer
//   ten onrechte op "gekoppeld"; er is een icoontje voor de browsertab.
// Alle testgegevens zijn verzonnen.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { readSourceDocument, statusEntry, writeSourceDocument } from "../lib/fetch-util.mjs";
import { classifyGipodEvent } from "../lib/gipod-events.mjs";
import { SOURCE_DEFINITIONS, sourceDocument, validateRefreshStatus } from "../lib/source-feed.mjs";
import { loadAgendaFeed, loadAgendaRuntime, loadHandAgendaItems, loadRefreshEngine, noClockDate } from "../scripts/agenda-source.mjs";
import { buildFeed } from "../scripts/build-sources.mjs";
import { refreshAll, withContentStatus } from "../scripts/refresh-fetch.mjs";
import { checkHealth } from "../scripts/sources-health.mjs";
import { EMPTY_SOURCE_DAYS, contentStatusOf, nextEmptySince } from "../scripts/stale-policy.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Een verzonnen activiteit op een gegeven dag, voor een bron met idPrefix `prefix`.
function item(prefix, id, date) {
  return {
    id: `${prefix}${id}-${date}`,
    externalId: id,
    title: `Verzonnen activiteit ${id}`,
    theme: "Activiteit",
    className: "activity",
    date,
    endDate: null,
    timeSlot: "14:00",
    timeText: "14 uur",
    location: "Verzonnenplein",
    postcodes: ["2000"],
    info: "",
    kind: "activity",
    sourceUrl: `https://www.antwerpen.be/info/${id}`,
    retrievedAt: "2026-10-10T04:00:00.000Z",
    reviewRequired: false,
  };
}

function writeDoc(root, sourceId, items, retrievedAt = "2026-10-10T04:00:00.000Z") {
  writeSourceDocument(root, sourceId, sourceDocument(sourceId, { retrievedAt, fetchStatus: "ok", items: items.map((entry) => ({ ...entry, retrievedAt })) }));
}

// Een fetcher die niets ophaalt en alleen meldt wat er al staat (zoals een bron die "ok" antwoordt).
const fetcher = (sourceId, before = () => {}) => ({
  name: sourceId,
  sourceIds: [sourceId],
  load: async () => ({
    run: async ({ rootDir: root, clock }) => {
      before(root, clock());
      const document = readSourceDocument(root, sourceId);
      return [statusEntry(sourceId, { fetchStatus: "ok", retrievedAt: clock().toISOString(), itemCount: document?.items?.length ?? 0 })];
    },
  }),
});
const zonderSleutel = {
  name: "stad-uit",
  sourceIds: ["stad-uit"],
  load: async () => ({ run: async () => [statusEntry("stad-uit", { fetchStatus: "skipped_no_key" })] }),
};

test("beleid: de derde dag op rij zonder komend item is 'leeg'; een komend item zet de teller terug", () => {
  assert.equal(EMPTY_SOURCE_DAYS, 3);
  assert.equal(nextEmptySince({ previousEmptySince: null, upcoming: 0, today: "2026-10-10" }), "2026-10-10");
  assert.equal(nextEmptySince({ previousEmptySince: "2026-10-10", upcoming: 0, today: "2026-10-12" }), "2026-10-10");
  assert.equal(nextEmptySince({ previousEmptySince: "2026-10-10", upcoming: 2, today: "2026-10-12" }), null);
  // Een ongeldige of toekomstige vorige dag telt niet: de reeks begint vandaag.
  assert.equal(nextEmptySince({ previousEmptySince: "2026-13-01", upcoming: 0, today: "2026-10-12" }), "2026-10-12");
  assert.equal(nextEmptySince({ previousEmptySince: "2026-10-20", upcoming: 0, today: "2026-10-12" }), "2026-10-12");
  assert.equal(contentStatusOf({ emptySince: "2026-10-10", today: "2026-10-10" }), "ok");
  assert.equal(contentStatusOf({ emptySince: "2026-10-10", today: "2026-10-11" }), "ok");
  assert.equal(contentStatusOf({ emptySince: "2026-10-10", today: "2026-10-12" }), "leeg");
  assert.equal(contentStatusOf({ emptySince: "2026-09-29", today: "2026-10-12" }), "leeg");
  // Over de maandgrens en de overgang naar wintertijd (25-10-2026).
  assert.equal(contentStatusOf({ emptySince: "2026-10-24", today: "2026-10-26" }), "leeg");
  assert.equal(contentStatusOf({ emptySince: null, today: "2026-10-12" }), "ok");
  // De teller telt kalenderdagen, geen verversingen: viel de ochtend van 11/10 uit, dan is de bron op
  // 12/10 al "leeg" na 2 echte verversingen. De documentatie zegt dat ook zo.
  assert.equal(nextEmptySince({ previousEmptySince: "2026-10-10", upcoming: 0, today: "2026-10-12" }), "2026-10-10");
  assert.equal(contentStatusOf({ emptySince: "2026-10-10", today: "2026-10-12" }), "leeg");
  const docs = fs.readFileSync(path.join(rootDir, "docs", "AGENDA_SOURCES.md"), "utf8");
  const leegDeel = docs.slice(docs.indexOf("## Leeg: antwoordt wel, levert niets"));
  assert.match(leegDeel, /3 kalenderdagen op rij/);
  assert.match(leegDeel, /na 2\s+echte verversingen/);
  assert.doesNotMatch(docs, /verversingsdagen/);
});

test("refresh: 3 dagen 0 items of alleen voorbije items geeft 'leeg' in refresh-status.json en in sources:health", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lege-bron-"));
  fs.mkdirSync(path.join(root, "site", "sources"), { recursive: true });
  writeDoc(root, "district-gipod-evenementen", []); // levert niets
  writeDoc(root, "district-kalender", [item("district-kal-", "aaaaaa", "2026-09-20")]); // alleen voorbij
  writeDoc(root, "district-nieuws", [item("district-news-", "bbbbbb", "2026-11-05")]); // komend
  const fetchers = [fetcher("district-gipod-evenementen"), fetcher("district-kalender"), fetcher("district-nieuws"), zonderSleutel];

  const days = ["2026-10-10", "2026-10-11", "2026-10-12"];
  let status;
  for (const day of days) {
    status = await refreshAll({ rootDir: root, clock: () => new Date(`${day}T04:00:00Z`), log: () => {}, fetchers });
    assert.deepEqual(validateRefreshStatus(status), [], day);
    const written = JSON.parse(fs.readFileSync(path.join(root, "site", "sources", "refresh-status.json"), "utf8"));
    assert.deepEqual(written, JSON.parse(JSON.stringify(status)), day);
  }
  const byId = Object.fromEntries(status.sources.map((entry) => [entry.sourceId, entry]));
  assert.deepEqual(
    [byId["district-gipod-evenementen"].upcomingCount, byId["district-gipod-evenementen"].emptySince, byId["district-gipod-evenementen"].contentStatus],
    [0, "2026-10-10", "leeg"]
  );
  assert.deepEqual(
    [byId["district-kalender"].itemCount, byId["district-kalender"].upcomingCount, byId["district-kalender"].emptySince, byId["district-kalender"].contentStatus],
    [1, 0, "2026-10-10", "leeg"]
  );
  assert.deepEqual([byId["district-nieuws"].upcomingCount, byId["district-nieuws"].emptySince, byId["district-nieuws"].contentStatus], [1, null, "ok"]);
  // De fetchStatus blijft "ok": leeg is geen fout, de datalaan en de job source-health blijven groen.
  assert.equal(byId["district-gipod-evenementen"].fetchStatus, "ok");
  // Een bron zonder sleutel krijgt geen velden.
  assert.ok(!("contentStatus" in byId["stad-uit"]));

  const health = checkHealth({ rootDir: root, at: Date.parse("2026-10-12T05:00:00Z"), baseline: null });
  assert.equal(health.exitCode, 0);
  const line = (sourceId) => health.lines.find((candidate) => candidate.startsWith(`${sourceId}\t`)).split("\t");
  assert.deepEqual(line("district-gipod-evenementen").slice(0, 6), ["district-gipod-evenementen", "leeg", "ok", "items=0", "upcoming=0", "emptySince=2026-10-10"]);
  assert.equal(line("district-kalender")[1], "leeg");
  assert.equal(line("district-nieuws")[1], "ok");
  assert.equal(line("stad-uit")[1], "inactive");
  assert.deepEqual(health.warnings, [
    "district-gipod-evenementen: sinds 2026-10-10 niets komends (0 items)",
    "district-kalender: sinds 2026-10-10 niets komends (1 items, allemaal voorbij)",
  ]);
  // Een dag eerder was het nog "ok": pas de derde dag is "leeg".
  const earlier = checkHealth({ rootDir: root, at: Date.parse("2026-10-11T05:00:00Z"), baseline: null });
  assert.equal(earlier.lines.find((candidate) => candidate.startsWith("district-gipod-evenementen\t")).split("\t")[1], "ok");

  // Dag 4: de kalender heeft weer iets komends; de teller valt weg. GIPOD blijft leeg.
  const day4 = await refreshAll({
    rootDir: root,
    clock: () => new Date("2026-10-13T04:00:00Z"),
    log: () => {},
    fetchers: [
      fetcher("district-gipod-evenementen"),
      fetcher("district-kalender", (dir) => writeDoc(dir, "district-kalender", [item("district-kal-", "cccccc", "2026-10-20")], "2026-10-13T04:00:00.000Z")),
      fetcher("district-nieuws"),
      zonderSleutel,
    ],
  });
  const after = Object.fromEntries(day4.sources.map((entry) => [entry.sourceId, entry]));
  assert.deepEqual([after["district-kalender"].upcomingCount, after["district-kalender"].emptySince, after["district-kalender"].contentStatus], [1, null, "ok"]);
  assert.deepEqual([after["district-gipod-evenementen"].emptySince, after["district-gipod-evenementen"].contentStatus], ["2026-10-10", "leeg"]);
});

test("refresh: het tellen laat de verversing nooit falen", () => {
  const entry = statusEntry("district-kalender", { fetchStatus: "ok", retrievedAt: "2026-10-10T04:00:00.000Z", itemCount: 3 });
  // Geen document (bv. onleesbaar): 0 komende items, de status blijft geldig.
  const counted = withContentStatus(entry, { document: null, previous: undefined, today: "2026-10-10" });
  assert.deepEqual([counted.upcomingCount, counted.emptySince, counted.contentStatus], [0, "2026-10-10", "ok"]);
  // Een onzinnige vorige status telt niet mee.
  const odd = withContentStatus(entry, { document: { items: "geen lijst" }, previous: { emptySince: 42 }, today: "2026-10-10" });
  assert.equal(odd.emptySince, "2026-10-10");
  // Een bron die uit staat, blijft onaangeroerd.
  const off = statusEntry("stad-uit", { fetchStatus: "skipped_no_key" });
  assert.equal(withContentStatus(off, { document: null, previous: null, today: "2026-10-10" }), off);
});

test("refresh-status: de nieuwe velden zijn optioneel en worden streng nagekeken", () => {
  const base = { schemaVersion: 1, generatedAt: "2026-10-12T04:00:00.000Z", classificationAsOf: "2026-10-12" };
  const entry = { ...statusEntry("district-kalender", { fetchStatus: "ok", retrievedAt: "2026-10-12T04:00:00.000Z", itemCount: 1 }) };
  const check = (fields) => validateRefreshStatus({ ...base, sources: [{ ...entry, ...fields }] });
  assert.deepEqual(check({}), [], "een status van vóór deze velden blijft geldig");
  assert.deepEqual(check({ upcomingCount: 0, emptySince: "2026-10-10", contentStatus: "leeg" }), []);
  assert.deepEqual(check({ upcomingCount: 1, emptySince: null, contentStatus: "ok" }), []);
  assert.ok(check({ upcomingCount: -1 }).some((error) => error.includes("upcomingCount")));
  assert.ok(check({ emptySince: "2026-10-13" }).some((error) => error.includes("na classificationAsOf")));
  assert.ok(check({ upcomingCount: 2, emptySince: "2026-10-10" }).some((error) => error.includes("komende items")));
  assert.ok(check({ contentStatus: "leeg", emptySince: null }).some((error) => error.includes("zonder emptySince")));
  assert.ok(check({ contentStatus: "bijna leeg" }).some((error) => error.includes("contentStatus")));
});

test("site: een lege bron toont 'leeg sinds …' in plaats van 'ververst op …'", () => {
  const retrievedAt = "2026-10-12T03:20:00.000Z";
  const documents = [sourceDocument("district-gipod-evenementen", { retrievedAt, fetchStatus: "ok", items: [] })];
  const status = {
    schemaVersion: 1,
    generatedAt: retrievedAt,
    classificationAsOf: "2026-10-12",
    sources: [{ ...statusEntry("district-gipod-evenementen", { fetchStatus: "ok", retrievedAt, itemCount: 0 }), upcomingCount: 0, emptySince: "2026-10-10", contentStatus: "leeg" }],
  };
  const { feed } = buildFeed({ status, documents }, []);
  assert.deepEqual([feed.sources[0].contentStatus, feed.sources[0].emptySince, feed.sources[0].upcomingCount], ["leeg", "2026-10-10", 0]);
  // Zonder de velden in de status (oude status) komen ze ook niet in de feed.
  const { feed: oud } = buildFeed({ status: { ...status, sources: [statusEntry("district-gipod-evenementen", { fetchStatus: "ok", retrievedAt, itemCount: 0 })] }, documents }, []);
  assert.ok(!("contentStatus" in oud.sources[0]));

  const context = { Date: noClockDate(), URL, window: { PUBLIC_AGENDA_FEED: feed } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(rootDir, "site", "agenda-refresh.js"), "utf8"), context);
  const engine = context.window.PUBLIC_AGENDA_REFRESH_ENGINE;
  const fresh = engine.reconcileAgendaItems([], "2026-10-12", { now: "2026-10-12T06:00:00.000Z" }).sourceFreshness[0];
  assert.deepEqual([fresh.state, fresh.emptySince], ["empty", "2026-10-10"]);
  // Verouderd gaat voor op leeg.
  const stale = engine.reconcileAgendaItems([], "2026-10-15", { now: "2026-10-15T06:00:00.000Z" }).sourceFreshness[0];
  assert.deepEqual([stale.state, stale.emptySince], ["stale", null]);

  const agendaSource = fs.readFileSync(path.join(rootDir, "site", "agenda.js"), "utf8");
  assert.match(agendaSource, /entry\.state === "empty"/);
  assert.match(agendaSource, /class="source-empty">leeg sinds \$\{esc\(formatSimpleDate\(entry\.emptySince\)\)\}/);
  assert.match(fs.readFileSync(path.join(rootDir, "site", "styles.css"), "utf8"), /\.source-empty \{/);
});

test("de GIPOD-evenementenbron heeft een eerlijk label: alleen het district, waar de stad geen evenementen meldt", () => {
  const label = SOURCE_DEFINITIONS["district-gipod-evenementen"].label;
  assert.equal(label, "GIPOD-evenementen in het district (stad Antwerpen meldt hier geen evenementen; GIPOD bevat vooral buurgemeenten)");
  assert.doesNotMatch(label, /^Evenementen op publiek domein/);
  // Het label mag niet beweren dat de bron buurgemeenten toont: een evenement buiten het district valt weg.
  assert.doesNotMatch(label, /\(vooral buurgemeenten/);
  const buurgemeente = {
    id: "INNAME_PUNT.900001-2610171200",
    type: "Feature",
    geometry: { type: "Point", coordinates: [4.5, 51.2] },
    properties: {
      GipodId: "900001",
      Description: "2100 Verzonnengem, Verzonnenstraat : Buurtfeest Verzonnenstraat",
      Reference: "EV9",
      Type: "Evenement",
      PublicDomainOccupancyTypes: "Feest/kermis",
      Status: "Concreet gepland",
      Start: "2026-10-17T12:00:00Z",
      End: "2026-10-17T18:00:00Z",
    },
  };
  assert.equal(classifyGipodEvent(buurgemeente, new Date("2026-10-10T04:00:00Z")).reason, "outside_district");
  // De gegenereerde feed (site/agenda-feed.js) draagt hetzelfde label.
  const feedSource = loadAgendaFeed(rootDir).sources.find((source) => source.sourceId === "district-gipod-evenementen");
  if (feedSource) assert.equal(feedSource.label, label);
});

test("'Bijgewerkt' toont altijd het uur, met vandaag of gisteren erbij", () => {
  const runtime = loadAgendaRuntime(rootDir);
  const at = (iso) => Date.parse(iso);
  const refreshed = "2026-10-10T03:22:17.338Z"; // 05.22 uur in Brussel
  assert.equal(runtime.freshnessWhen(refreshed, at("2026-10-10T12:00:00Z")), "vandaag om 05.22");
  assert.equal(runtime.freshnessWhen(refreshed, at("2026-10-11T08:00:00Z")), "gisteren om 05.22");
  assert.equal(runtime.freshnessWhen(refreshed, at("2026-10-13T08:00:00Z")), "op 10 oktober 2026 om 05.22");
  // Net na middernacht in Brussel is het al een nieuwe dag.
  assert.equal(runtime.freshnessWhen("2026-10-10T22:30:00Z", at("2026-10-11T06:00:00Z")), "vandaag om 00.30");
  // De nacht na de overgang naar zomertijd (29-03-2026) duurt 23 uur: om 00.30 op 30/3 is 29/3 gisteren.
  assert.equal(runtime.freshnessWhen("2026-03-29T03:21:00Z", at("2026-03-29T22:30:00Z")), "gisteren om 05.21");
  // En na de overgang naar wintertijd (25-10-2026): de hele 26/10 is 25/10 gisteren, op 27/10 niet meer.
  assert.equal(runtime.freshnessWhen("2026-10-25T04:21:00Z", at("2026-10-25T23:30:00Z")), "gisteren om 05.21");
  assert.equal(runtime.freshnessWhen("2026-10-25T04:21:00Z", at("2026-10-26T22:30:00Z")), "gisteren om 05.21");
  assert.equal(runtime.freshnessWhen("2026-10-25T04:21:00Z", at("2026-10-26T23:30:00Z")), "op 25 oktober 2026 om 05.21");
  assert.equal(runtime.freshnessWhen("geen datum", at("2026-10-10T12:00:00Z")), "");
  const agendaSource = fs.readFileSync(path.join(rootDir, "site", "agenda.js"), "utf8");
  assert.match(agendaSource, /"Bijgewerkt"\} \$\{moment\}/);
  assert.match(agendaSource, /Officiële broncontrole \$\{freshnessWhen\(/);
});

test("de dekkingsmatrix zet speelstraten en evenementen niet meer op 'gekoppeld'", () => {
  const matrix = fs.readFileSync(path.join(rootDir, "docs", "COVERAGE_MATRIX.md"), "utf8");
  const row = (number) => matrix.split("\n").find((line) => line.startsWith(`| ${number} |`)).split("|").map((cell) => cell.trim());
  assert.equal(row(10)[2], "Speelstraten");
  assert.doesNotMatch(row(10)[3], /^Gekoppeld/);
  assert.equal(row(11)[2], "Evenementen / straatinname");
  assert.doesNotMatch(row(11)[3], /^Gekoppeld/);
  assert.match(row(11)[4], /buurgemeenten/);
  // Rij 11 noemt het echte label, niet "vooral buurgemeenten" als wat de bron toont.
  assert.ok(row(11)[4].includes(`"${SOURCE_DEFINITIONS["district-gipod-evenementen"].label}"`));
  assert.doesNotMatch(row(11)[4], /heet daarom "vooral buurgemeenten"/);
});

test("de browsertab heeft een icoontje: /favicon.ico en /favicon.svg bestaan en de pagina's verwijzen ernaar", () => {
  const ico = fs.readFileSync(path.join(rootDir, "site", "favicon.ico"));
  // ICO-kop: gereserveerd 0, type 1 (icoon), minstens één beeld; het beeld is een PNG van 32x32.
  assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4) >= 1], [0, 1, true]);
  assert.deepEqual([ico[6], ico[7]], [32, 32]);
  const offset = ico.readUInt32LE(18);
  assert.deepEqual([...ico.subarray(offset, offset + 4)], [0x89, 0x50, 0x4e, 0x47]);
  const svg = fs.readFileSync(path.join(rootDir, "site", "favicon.svg"), "utf8");
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.doesNotMatch(svg, /<script|href=/i);
  for (const page of ["index.html", "404.html"]) {
    const html = fs.readFileSync(path.join(rootDir, "site", page), "utf8");
    assert.match(html, /<link rel="icon" href="\/favicon\.ico" sizes="32x32" \/>/, page);
    assert.match(html, /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml" \/>/, page);
  }
});

// De ochtendverversing draait `npm run check` (alle toetsen) na `refresh:manual`. Meldt die dagelijkse
// broncontrole een handmatige bron als "gewijzigd" of "weg", dan mag geen toets daardoor falen: anders
// wordt de job refresh rood en komt er geen datatak. Wat zo'n melding doet, toetst manual-check.test.mjs.
test("de toetsen over handmatige items blijven groen als de dagelijkse broncontrole 'gewijzigd' of 'weg' meldt", () => {
  const engine = loadRefreshEngine(rootDir);
  const manualSourceIds = [...new Set(engine.config.rules.map((rule) => rule.sourceId).filter(Boolean))].sort();
  assert.ok(manualSourceIds.length > 0);
  for (const status of ["gewijzigd", "weg"]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `broncontrole-${status}-`));
    for (const file of ["package.json", "scripts/agenda-source.mjs", "site/agenda.js", "site/agenda-refresh.js", "site/public-agenda-manifest.json", "tests/agenda-refresh.test.mjs"]) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.copyFileSync(path.join(rootDir, file), path.join(root, file));
    }
    const feed = loadAgendaFeed(rootDir);
    feed.manualCheck = {
      checkedAt: "2026-10-10T03:20:00.000Z",
      sources: Object.fromEntries(manualSourceIds.map((sourceId) => [sourceId, { status, since: "2026-10-10T03:20:00.000Z" }])),
    };
    fs.writeFileSync(path.join(root, "site", "agenda-feed.js"), `window.PUBLIC_AGENDA_FEED = ${JSON.stringify(feed)};\n`);
    // De nagebootste melding werkt echt: zonder ignoreManualCheck gaan handmatige items van de site.
    const hand = loadHandAgendaItems(root);
    const reasons = loadRefreshEngine(root).reconcileAgendaItems(hand, "2026-10-10").auditItems.map((entry) => entry.reviewReason);
    assert.ok(reasons.includes(status === "weg" ? "manual_source_gone" : "manual_source_changed"), status);

    // Het manifest bouwt de verversing na refresh:manual opnieuw (build:all); hier blijft het oud.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const run = spawnSync(process.execPath, ["--test", "--test-skip-pattern=^manifest bewaart", "tests/agenda-refresh.test.mjs"], {
      cwd: root,
      env,
      encoding: "utf8",
      timeout: 60_000,
    });
    const output = `${run.stdout}\n${run.stderr}`;
    assert.equal(run.status, 0, `${status}:\n${output.slice(-3000)}`);
    assert.match(output, /# fail 0/, status);
    assert.doesNotMatch(output, /# pass 0\b/, status);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
