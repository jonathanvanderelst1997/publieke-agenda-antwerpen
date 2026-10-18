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

// ---- Vervolg (nakijkronde 18-10-2026): ook buiten de agendabronnen niets over falen ----
// Ook buiten de agendabronnen zag een bezoeker dat een bron, een laag of een live aanvraag faalde of oud was: de
// buurtinfo (de radar), de district-radar op de voorpagina, de zin onder een straat, de lijsten van werken,
// innames, vergunningen en terrassen, de plekpagina (tegels, weekzin, lege toestand), de wijkkaart en de
// historiek van een werk. Het besluit geldt ook daar: de site toont de laatste goede stand, zonder te zeggen dat
// iets faalt. Een echte lege toestand blijft leeg (geen verzonnen 0, geen "rustig").
const LIVE_WAARSCHUWINGEN = [
  // site/buurt-info.js
  "Niet alle bronlagen zijn actueel",
  "Getallen worden niet als volledig voorgesteld",
  "De radar is ouder dan 26 uur",
  "Getallen worden niet als actueel voorgesteld",
  "Het wijzigingsoverzicht kon niet worden geladen",
  "bron tijdelijk niet bereikbaar",
  // site/street-overview.js
  "history verouderd",
  "na gezonde history-refresh",
  "Beschikbaar na een gezonde history-refresh",
  "Straatfiche tijdelijk niet beschikbaar",
  // site/straat-snapshot.js (de zin onder een straat)
  "Live nakijken lukte nu niet",
  "Rond de straat kon nu niet live geladen worden",
  "De straal rond de straat kon nu niet geladen worden",
  // site/works-live.js (en site/onbekend-zinnen.js)
  "De AWV-werfdata is ouder dan 3 dagen",
  "De AWV-werfdata kon nu niet geladen worden",
  "Hinderbron tijdelijk niet geladen",
  "De officiële grens kon nu niet worden geladen",
  "Het aanvullende A-Sign-werfsignalisatiesignaal kon nu niet worden geladen",
  "Hinder zonder gepubliceerd werk kon nu niet bepaald worden",
  "Werken tijdelijk niet geladen",
  "De live werkenbron kon niet worden gelezen",
  "De GIPOD-hinderbron kon nu niet worden geladen",
  // site/live-lagen.js, site/public-space-live.js, site/terraces-live.js, site/permits-live.js
  "konden nu niet geladen worden",
  "Dit overzicht is onvolledig",
  "zijn verborgen omdat de officiële districtsgrens niet kon worden geladen",
  "Terrassen niet geladen",
  "Omgevingsdossiers tijdelijk niet geladen",
  "Bron tijdelijk niet beschikbaar",
  // site/place-core.js en site/place-view.js (weekzin, lege toestand, tegels)
  "niet alles laadde",
  "Niet alles laadde",
  "zijn niet volledig geladen",
  "In wat wel geladen is",
  "De straatnamen konden nu niet geladen worden",
  "Het archief is nu niet beschikbaar",
  // site/werk-historiek.js
  "De archiefbron bevat onvoldoende betrouwbare gegevens",
  // site/kaart-uitleg.js
  "nu niet opgehaald",
  "de straat kon nu niet bepaald worden",
  // site/neighborhood-map.js
  "De wijkgrenzen konden nu niet geladen worden",
  "Kaart niet beschikbaar",
  // site/agenda.js
  "De gezamenlijke straatfilter is tijdelijk niet beschikbaar",
];

test("geen script van de site zegt dat een live laag, de radar, de historiek of de kaart faalt of oud is", () => {
  const scripts = fs.readdirSync(path.join(rootDir, "site")).filter((n) => n.endsWith(".js") && n !== "agenda-feed.js");
  const gevonden = [];
  for (const naam of scripts) {
    const tekst = site(naam);
    for (const zin of LIVE_WAARSCHUWINGEN) if (tekst.includes(zin)) gevonden.push(`${naam}: "${zin}"`);
  }
  assert.deepEqual(gevonden, []);
  for (const naam of fs.readdirSync(path.join(rootDir, "site")).filter((n) => n.endsWith(".html")))
    for (const zin of LIVE_WAARSCHUWINGEN) assert.ok(!site(naam).includes(zin), `${naam} bevat "${zin}"`);
  // Geen melding "onvolledig" meer boven de tegels of in de lege toestand, en geen "?" als tegel.
  for (const naam of [...scripts, ...fs.readdirSync(path.join(rootDir, "site")).filter((n) => n.endsWith(".css"))])
    assert.doesNotMatch(site(naam), /pv-place-failed|pv-empty-warn/, naam);
  assert.doesNotMatch(site("live-lagen.js"), /onvolledigMelding/);
  assert.doesNotMatch(site("place-view.js"), /state\.werkenOnvolledig \? "\?"/);
  // Intern blijft de boekhouding: welke lagen niet laadden (live.failed), voor "nooit rustig" en "nooit een valse 0".
  assert.match(site("live-lagen.js"), /live\.failed = /);
  assert.match(site("place-view.js"), /state\.werkenOnvolledig \? "–"/);
});

test("de zin onder een straat: lukt live nakijken (deels) niet, dan gewoon de stand van de verversing", async () => {
  const { standZin } = await import("../site/straat-snapshot.js");
  const ververst = "2099-03-11T04:22:00.000Z", nu = new Date("2099-03-11T09:00:00Z");
  assert.equal(standZin({ ververst, mislukt: true, nu }), "Stand van de verversing van 05:22.");
  assert.equal(standZin({ ververst, mislukt: true, straal: 500, nu }), "Stand van de verversing van 05:22.");
  assert.equal(standZin({ ververst, nieuw: 1, mislukteDelen: ["vergunningen", "terrassen"], nu }), "Live nagekeken: 1 nieuw sinds 05:22.");
  assert.equal(standZin({ ververst, mislukteDelen: ["vergunningen"], straal: 250, nu }), "Live nagekeken: niets nieuw sinds 05:22.");
  assert.equal(standZin({ ververst, nieuw: 1, straal: 250, straalStand: "mislukt", nu }), "Live nagekeken: 1 nieuw sinds 05:22.");
  // Wat er gewoon nog loopt, blijft.
  assert.equal(standZin({ ververst, bezig: true, nu }), "Stand van de verversing van 05:22. Live nakijken…");
  assert.equal(standZin({ ververst, straal: 500, straalStand: "laadt", nu }), "Live nagekeken: niets nieuw sinds 05:22. De straal rond de straat laadt nog…");
  assert.equal(standZin({ mislukt: true, nu }), "");
});

test("weekzin en lege toestand: een laag die (deels) niet laadde, verraadt niets en maakt de week nooit 'rustig'", async () => {
  const pc = await import("../site/place-core.js");
  const vandaag = "2026-10-12";
  const feest = pc.agendaEntry({ id: "f", title: "Buurtfeest", date: "2026-10-16", location: "Voorbeeldplein" }, "culture");
  const zinnen = [];
  const met = pc.dezeWeek([feest], vandaag, { onvolledig: true });
  assert.equal(met.zin, "De komende 7 dagen in jouw straat: 1 evenement (vr 16 okt).");
  const leeg = pc.dezeWeek([], vandaag, { onvolledig: true });
  assert.deepEqual(leeg, { licht: "onbekend", zin: "De komende 7 dagen in jouw straat: niets gevonden." });
  const deels = [{ wat: "werken", uit: true, geladen: false, deels: true }];
  assert.equal(pc.dezeWeek([feest], vandaag, { onbekend: deels }).zin, "De komende 7 dagen in jouw straat: 1 evenement (vr 16 okt).");
  assert.deepEqual(pc.dezeWeek([], vandaag, { onbekend: deels }), { licht: "onbekend", zin: "De komende 7 dagen in jouw straat: niets gevonden." });
  // Wat met de keuze van de bezoeker te maken heeft (een soort staat uit), blijft gewoon.
  const uit = [{ wat: "werken", uit: true, geladen: false }];
  assert.equal(pc.dezeWeek([], vandaag, { onbekend: uit, onvolledig: true }).zin, "De komende 7 dagen in jouw straat: niets gevonden, maar werken staan uit. Of het rustig is, weten we dus niet.");
  assert.equal(pc.dezeWeek([feest], vandaag, { onbekend: uit }).zin, "De komende 7 dagen in jouw straat: 1 evenement (vr 16 okt). Werken zijn niet geladen.");
  assert.equal(pc.dezeWeek([], vandaag).licht, "rustig");
  zinnen.push(met.zin, leeg.zin);

  const straat = { type: "straat", label: "Proefstraat" };
  for (const opties of [{ place: straat, aantalSoorten: 6 }, { place: straat, aantalSoorten: 6, gekozen: true }, { aantalSoorten: 6 }]) {
    const zin = pc.legeStaatTekst({ ...opties, onvolledig: true });
    assert.doesNotMatch(zin, /niets gepland|op de agenda/, "geen bewering die niet nagekeken is");
    zinnen.push(zin);
  }
  assert.equal(pc.legeStaatTekst({ place: straat, aantalSoorten: 6, onvolledig: true }), "Voor deze straat is niets gevonden.");
  assert.equal(pc.legeDagLabel({ onvolledig: true }), "niets gevonden");
  assert.equal(pc.legeDagLabel({ onvolledig: true, doorlopend: 1 }), "niets apart gevonden; 1 toelating van twee weken of langer loopt door");
  assert.equal(pc.legeTijdlijnTekst({ onvolledig: true }), "De komende 14 dagen is hier niets gevonden.");
  assert.equal(pc.legeTijdlijnTekst({ dag: true, onvolledig: true, doorlopend: 1 }), "Op die dag is hier niets gevonden behalve wat hieronder doorloopt.");
  zinnen.push(pc.legeDagLabel({ onvolledig: true }), pc.legeTijdlijnTekst({ onvolledig: true }), pc.legeTijdlijnTekst({ dag: true, onvolledig: true }));
  for (const zin of zinnen) assert.doesNotMatch(zin, /laad|geladen|faalt|mislukt|lukte|onvolledig|onbereikbaar|verouderd/i, zin);
});

test("buurtinfo en district-radar: de laatste goede stand, ook als een laag niet actueel is", async () => {
  const { radarVoorStraat, radarToestand } = await import("../site/buurt-info-core.js");
  const straat = { id: "101", name: "Proefstraat", postcode: "2000" };
  const nu = Date.parse("2026-10-13T12:00:00Z");
  const radar = { ververst: "2026-10-13T09:00:00Z", runs: ["2026-10-13T09:00:00Z"], lagen: { works: { status: "ok" }, publicSpace: { status: "ok" } }, straten: { "101|Proefstraat|2000": [[0, 2, 1, 0]] } };
  const gewoon = radarToestand(radarVoorStraat(radar, straat, { nu }));
  assert.deepEqual(gewoon, { zin: "Dit zijn waargenomen wijzigingen, niet de werkelijke start- of einddatum van de maatregelen.", cijfers: true });
  // Een laag niet actueel, of de radar ouder dan 26 uur: dezelfde zin en dezelfde getallen.
  const gedeeltelijk = radarVoorStraat({ ...radar, lagen: { works: { status: "stale" }, publicSpace: { status: "ok" } } }, straat, { nu });
  const oud = radarVoorStraat({ ...radar, ververst: "2026-10-10T09:00:00Z" }, straat, { nu });
  assert.deepEqual([gedeeltelijk.status, oud.status], ["gedeeltelijk", "verouderd"], "intern weet de radar het wel");
  assert.deepEqual(radarToestand(gedeeltelijk), gewoon);
  assert.deepEqual(radarToestand(oud), gewoon);
  // Geen radar: leeg, geen zin.
  assert.deepEqual(radarToestand(radarVoorStraat(null, straat, { nu })), { zin: "", cijfers: false });
  assert.doesNotMatch(site("buurt-info.js"), /info\.status !== "ok"|info\.status === "verouderd"/);

  const { buildDistrictRadar, radarRegels } = await import("../site/street-overview.js");
  const groep = { street: { id: "1", name: "Astraat", postcode: "2000" }, works: [], parking: [], iod: [], sgw: [], markets: [], agenda: [], changes: [{ type: "added", observedAt: "2026-10-13T05:17:00Z" }], total: 1 };
  const periode = { dagen: 7, ingekort: false };
  const goed = buildDistrictRadar([groep], { observedAt: "2026-10-13T05:17:00Z", layers: { works: { status: "ok" }, publicSpace: { status: "ok" } } });
  for (const lagen of [{ works: { status: "stale" }, publicSpace: { status: "ok" } }, { works: { status: "error" }, publicSpace: { status: "ok" } }]) {
    const r = buildDistrictRadar([groep], { observedAt: "2026-10-13T05:17:00Z", layers: lagen });
    assert.equal(r.recentlyChangedStreets, 1, JSON.stringify(lagen));
    assert.deepEqual(r.latestChangeCounts, goed.latestChangeCounts);
    assert.deepEqual(radarRegels(r, periode), radarRegels(goed, periode));
  }
  assert.deepEqual(radarRegels(goed, periode), { aantal: "1", noot: "laatste 7 dagen", delta: "1 nieuw · 0 gewijzigd · 0 afgelopen · 1 straten" });
  // Niets nieuw sinds de vorige verversing: "Geen operationele wijzigingen" alleen als alle lagen nagekeken zijn; kon een
  // laag niet ververst worden, dan geen regel (geen bewering die niet nagekeken is, en geen melding).
  const rustig = { ...groep, changes: [{ type: "added", observedAt: "2026-10-12T05:17:00Z" }] };
  assert.equal(radarRegels(buildDistrictRadar([rustig], { observedAt: "2026-10-13T05:17:00Z", layers: { works: { status: "ok" }, publicSpace: { status: "ok" } } }), periode).delta, "Geen operationele wijzigingen sinds de vorige verversing.");
  assert.deepEqual(radarRegels(buildDistrictRadar([rustig], { observedAt: "2026-10-13T05:17:00Z", layers: { works: { status: "stale" }, publicSpace: { status: "ok" } } }), periode), { aantal: "1", noot: "laatste 7 dagen", delta: "" });
  // Zonder straatas valt "Alles per straat" met de radar weg, zonder "0 straten" en zonder melding.
  assert.match(site("street-overview.js"), /if\(state\.mislukt\)\{root\.hidden=true;/);
  // Geen bruikbare historiek (geen radar, of geen enkele laag ooit gelukt): leeg, zonder uitleg waarom.
  for (const history of [null, { layers: { works: { status: "error" }, publicSpace: { status: "error" } } }]) {
    const r = buildDistrictRadar([groep], history);
    assert.equal(r.recentlyChangedStreets, null);
    assert.deepEqual(radarRegels(r, null), { aantal: "—", noot: "", delta: "" });
  }
});
