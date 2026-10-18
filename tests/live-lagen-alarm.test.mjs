// Nakijkronde 3 (18-10-2026): sinds het besluit van de eigenaar ("niemand moet weten als er iets faalt, de momentopname
// blijft wel goed") zegt de site niet meer dat een live laag faalt of oud is. Die zin was het enige signaal: een laag van
// de nachtelijke historiek (GIPOD-werken en publieke ruimte, ook de bron van de radar) of van de straatbestanden
// (werken, publiekeRuimte, vergunningen, terrassen, evenementen) kon dagen op "stale" of "error" staan zonder rode job,
// zonder alarm-issue en zonder ::warning: scripts/sources-health.mjs zette de straatbestanden alleen in `warnings`, las
// de historiek niet, en de job source-health in refresh.yml keek alleen naar refresh-status.json en manual-check.json.
// Nu volgen beide de regel van een agendabron: niet ververst met een goede stand van hoogstens 48 uur is een
// waarschuwing (::warning), geen goede stand of een oudere is rood (en dan vult de job alarm het alarm-issue aan).
// Alleen verzonnen data; er wordt niets opgehaald.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { statusEntry } from "../lib/fetch-util.mjs";
import { LIVE_HISTORY_FILE, liveLaagGezondheid } from "../lib/live-history.mjs";
import { STRAAT_INDEX, straatIndexStand } from "../lib/straat-bestanden.mjs";
import { leesWerkstroom } from "../scripts/refresh-droog.mjs";
import { checkHealth } from "../scripts/sources-health.mjs";

const workflow = fs.readFileSync(new URL("../.github/workflows/refresh.yml", import.meta.url), "utf8");
const stappen = leesWerkstroom(workflow);
const heeftJq = spawnSync("bash", ["-c", "command -v jq"]).status === 0;

const NU = Date.parse("2026-10-18T05:00:00Z");
const geleden = (uur, nu = NU) => new Date(nu - uur * 3_600_000).toISOString();

// Een verzonnen historiek en straatindex: per laag [status, uren sinds de laatste goede stand (null: geen), errorCode].
function historiek(lagen, nu = NU) {
  return {
    schemaVersion: 1,
    observedAt: new Date(nu).toISOString(),
    layers: Object.fromEntries(Object.entries(lagen).map(([naam, [status, uur, errorCode = null]]) => [naam, {
      status, lastAttemptAt: new Date(nu).toISOString(), lastSuccessAt: uur === null ? null : geleden(uur, nu), errorCode, count: 0, digest: null, items: [{ id: "x", title: "Proefwerk" }],
    }])),
    changes: [],
  };
}
function straatIndex(lagen, nu = NU) {
  return {
    schema: 1,
    ververst: new Date(nu).toISOString(),
    lagen: Object.fromEntries(Object.entries(lagen).map(([naam, [status, uur, errorCode]]) => [naam, { status, ...(uur === null ? {} : { sinds: geleden(uur, nu) }), ...(errorCode ? { errorCode } : {}) }])),
    straten: { 1416: { naam: "Proefstraat" } },
  };
}
const GEZOND_HISTORIEK = { works: ["ok", 0], publicSpace: ["ok", 0] };
const GEZOND_STRAAT = { werken: ["ok", 0], publiekeRuimte: ["ok", 0], vergunningen: ["ok", 0], terrassen: ["ok", 0], evenementen: ["ok", 0] };

test("liveLaagGezondheid: de regel van een agendabron (48 uur), ook voor een live laag", () => {
  const at = NU;
  assert.equal(liveLaagGezondheid({ status: "ok", sinds: geleden(1) }, { at }), "ok");
  assert.equal(liveLaagGezondheid({ status: "stale", sinds: geleden(10) }, { at }), "stale", "niet ververst, vorige stand jonger dan 48 uur: een waarschuwing");
  assert.equal(liveLaagGezondheid({ status: "stale", sinds: geleden(48) }, { at }), "stale");
  assert.equal(liveLaagGezondheid({ status: "stale", sinds: geleden(49) }, { at }), "error", "dagen niet ververst: rood");
  assert.equal(liveLaagGezondheid({ status: "error", sinds: null }, { at }), "error", "nooit een goede stand: rood");
  assert.equal(liveLaagGezondheid({ status: "error", sinds: geleden(5) }, { at }), "stale", "een goede (lege) stand van 5 uur geleden blijft staan");
  assert.equal(liveLaagGezondheid({ status: "ok", sinds: geleden(60) }, { at }), "error", "ook een 'ok' van 60 uur geleden is oud");
  assert.equal(liveLaagGezondheid({ status: "ok" }, { at }), "error", "zonder leesbaar tijdstip");
  assert.equal(liveLaagGezondheid({ status: "raar", sinds: geleden(1) }, { at }), "error", "onbekende status");
});

test("sources:health kent de live lagen: historiek en straatbestanden, een waarschuwing (::warning) en na 48 uur rood", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "live-lagen-alarm-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "site", "sources"), { recursive: true });
  fs.mkdirSync(path.join(root, "site", "history"), { recursive: true });
  const status = { schemaVersion: 1, generatedAt: geleden(0), classificationAsOf: "2026-10-18", sources: [statusEntry("district-kalender", { fetchStatus: "ok", retrievedAt: geleden(1), itemCount: 0 })] };
  fs.writeFileSync(path.join(root, "site", "sources", "refresh-status.json"), JSON.stringify(status));
  const met = ({ h = GEZOND_HISTORIEK, s = GEZOND_STRAAT } = {}) => {
    fs.writeFileSync(path.join(root, LIVE_HISTORY_FILE), JSON.stringify(historiek(h)));
    fs.writeFileSync(path.join(root, STRAAT_INDEX), JSON.stringify(straatIndex(s)));
    return checkHealth({ rootDir: root, at: NU, baseline: null });
  };
  const titels = (uit) => (uit.meldingen || []).map((m) => m.titel);

  const gezond = met();
  assert.equal(gezond.exitCode, 0, gezond.lines.join("\n"));
  assert.ok(gezond.lines.includes(`live-historiek:works\tok\tstatus=ok\tlastSuccessAt=${geleden(0)}`), gezond.lines.join("\n"));
  assert.deepEqual(titels(gezond).filter((x) => /Live laag|Straatbestanden/.test(x)), []);

  // De historiek: GIPOD gaf een 503, de vorige stand van 10 uur geleden blijft staan. Een waarschuwing, groen.
  const stale = met({ h: { works: ["stale", 10, "http_503"], publicSpace: ["ok", 0] } });
  assert.equal(stale.exitCode, 0, stale.lines.join("\n"));
  assert.ok(stale.meldingen.some((m) => m.titel === "Live laag stale" && /^live-historiek works: stale \(http_503\); de stand van .+ blijft staan tot ze 48 uur oud is$/.test(m.tekst)), JSON.stringify(stale.meldingen));
  // Na 48 uur, of zonder enige goede stand: rood (en dan het alarm-issue).
  for (const h of [{ works: ["stale", 60, "http_503"], publicSpace: ["ok", 0] }, { works: ["ok", 0], publicSpace: ["error", null, "street_axis_missing"] }]) {
    const rood = met({ h });
    assert.equal(rood.exitCode, 1, JSON.stringify(h));
    assert.ok(rood.lines.some((l) => /^live-historiek:(works|publicSpace)\terror\tstatus=(stale|error)\t/.test(l)), rood.lines.join("\n"));
  }

  // De straatbestanden: vroeger alleen in `warnings` (geen ::warning, nooit rood).
  const straatStale = met({ s: { ...GEZOND_STRAAT, werken: ["stale", 10, "http_500"] } });
  assert.equal(straatStale.exitCode, 0);
  assert.ok(straatStale.meldingen.some((m) => m.titel === "Straatbestanden" && /laag werken op "stale".*http_500/.test(m.tekst)), JSON.stringify(straatStale.meldingen));
  for (const s of [{ ...GEZOND_STRAAT, vergunningen: ["stale", 60, "permits_fetch_failed"] }, { ...GEZOND_STRAAT, evenementen: ["error", null, "agenda_niet_gelezen"] }, { ...GEZOND_STRAAT, terrassen: ["error", null, "niet_geladen"] }]) {
    const rood = met({ s });
    assert.equal(rood.exitCode, 1, JSON.stringify(s));
    assert.ok(rood.lines.some((l) => /^straatbestanden:(vergunningen|evenementen|terrassen)\terror\t/.test(l)), rood.lines.join("\n"));
  }
  const fouten = straatIndexStand(straatIndex({ ...GEZOND_STRAAT, evenementen: ["error", null, "agenda_niet_gelezen"] }), { at: NU }).fouten;
  assert.deepEqual(fouten, [`straatbestanden:evenementen\terror\tstatus=error\tsinds=-\terrorCode=agenda_niet_gelezen`]);

  // Op een GitHub-runner komt er per melding een ::warning bij (zoals bij een lege bron).
  const script = fs.readFileSync(new URL("../scripts/sources-health.mjs", import.meta.url), "utf8");
  assert.match(script, /for \(const \{ titel, tekst \} of result\.meldingen \?\? \[\]\) console\.log\(`::warning title=\$\{titel\}::\$\{tekst\}`\)/);
});

test("refresh: de stand van de live lagen (zonder items) gaat mee in het artefact voor source-health", { skip: heeftJq ? false : "bash of jq ontbreekt" }, (t) => {
  const refresh = stappen.get("refresh").steps;
  const i = refresh.findIndex((s) => s.name === "Stand van de live lagen (voor source-health)");
  assert.ok(i >= 0, "stap Stand van de live lagen");
  assert.ok(i < refresh.findIndex((s) => /upload-artifact/.test(s.uses || "")), "vóór het opladen van het artefact");
  assert.ok(i > refresh.findIndex((s) => s.run === "npm run refresh\n"), "na de verversing");
  assert.notEqual(refresh[i].continueOnError, true, "een fout hier maakt de verversing rood");
  const werk = fs.mkdtempSync(path.join(os.tmpdir(), "live-lagen-stap-"));
  t.after(() => fs.rmSync(werk, { recursive: true, force: true }));
  const draai = () => {
    const runner = fs.mkdtempSync(path.join(werk, "runner-"));
    const uit = spawnSync("bash", ["-c", refresh[i].run], { cwd: werk, env: { ...process.env, RUNNER_TEMP: runner }, encoding: "utf8" });
    assert.equal(uit.status, 0, uit.stderr);
    return JSON.parse(fs.readFileSync(path.join(runner, "data-patch", "live-lagen.json"), "utf8"));
  };
  // Zonder historiek en straatbestanden: een lege lijst.
  assert.deepEqual(draai(), { lagen: [] });
  fs.mkdirSync(path.join(werk, "site", "history"), { recursive: true });
  fs.writeFileSync(path.join(werk, LIVE_HISTORY_FILE), JSON.stringify(historiek({ works: ["stale", 10, "http_503"], publicSpace: ["error", null, "street_axis_missing"] })));
  fs.writeFileSync(path.join(werk, STRAAT_INDEX), JSON.stringify(straatIndex({ werken: ["ok", 0], evenementen: ["error", null, "agenda_niet_gelezen"] })));
  const stand = draai();
  assert.deepEqual(stand, { lagen: [
    { bron: "live-historiek", laag: "works", status: "stale", sinds: geleden(10), errorCode: "http_503" },
    { bron: "live-historiek", laag: "publicSpace", status: "error", sinds: null, errorCode: "street_axis_missing" },
    { bron: "straatbestanden", laag: "werken", status: "ok", sinds: geleden(0), errorCode: null },
    { bron: "straatbestanden", laag: "evenementen", status: "error", sinds: null, errorCode: "agenda_niet_gelezen" },
  ] });
  assert.doesNotMatch(JSON.stringify(stand), /Proefwerk|items|Proefstraat/, "geen items, geen straten");
});

test("source-health: een live laag die niet ververst raakte, geeft een ::warning; na 48 uur of zonder stand is de job rood", { skip: heeftJq ? false : "bash of jq ontbreekt" }, () => {
  const stap = stappen.get("source-health").steps.find((s) => s.name === "Elke bron gezond");
  assert.ok(stap?.run, "stap Elke bron gezond");
  const nu = Date.now();
  const draai = (lagen) => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "source-health-live-"));
    try {
      fs.mkdirSync(path.join(temp, "in"));
      fs.writeFileSync(path.join(temp, "in", "refresh-status.json"), JSON.stringify({ sources: [{ sourceId: "district-kalender", fetchStatus: "ok", retrievedAt: geleden(1, nu), errorCode: null, maxAgeHours: 48 }] }));
      if (lagen) fs.writeFileSync(path.join(temp, "in", "live-lagen.json"), JSON.stringify({ lagen }));
      const uit = spawnSync("bash", ["-c", stap.run], { env: { ...process.env, RUNNER_TEMP: temp }, encoding: "utf8" });
      return { code: uit.status, tekst: uit.stdout };
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  };
  const laag = (bron, naam, status, uur, errorCode = null) => ({ bron, laag: naam, status, sinds: uur === null ? null : geleden(uur, nu), errorCode });
  const gezond = [laag("live-historiek", "works", "ok", 0), laag("live-historiek", "publicSpace", "ok", 0), laag("straatbestanden", "werken", "ok", 0)];

  const groen = draai(gezond);
  assert.equal(groen.code, 0, groen.tekst);
  assert.match(groen.tekst, /Laag live-historiek works: ok/);
  assert.doesNotMatch(groen.tekst, /::warning title=Live laag/);

  const stale = draai([laag("live-historiek", "works", "stale", 10, "http_503"), laag("straatbestanden", "terrassen", "error", 5, "terraces_fetch_failed")]);
  assert.equal(stale.code, 0, stale.tekst);
  assert.match(stale.tekst, /::warning title=Live laag stale::live-historiek works: stale \(http_503\); de vorige stand van .+ blijft staan tot ze 48 uur oud is\./);
  assert.match(stale.tekst, /::warning title=Live laag stale::straatbestanden terrassen: error \(terraces_fetch_failed\)/);

  for (const [wat, lagen, regel] of [
    ["dagen stale", [...gezond, laag("live-historiek", "publicSpace", "stale", 60, "http_503")], /BRON live-historiek publicSpace: stale \(http_503\), laatste goede stand .+ uur oud \(ouder dan 48 uur\)/],
    ["nooit gelukt", [...gezond, laag("live-historiek", "works", "error", null, "street_axis_missing")], /BRON live-historiek works: error \(street_axis_missing\), geen goede stand/],
    ["straatbestand zonder stand", [...gezond, laag("straatbestanden", "evenementen", "error", null, "agenda_niet_gelezen")], /BRON straatbestanden evenementen: error \(agenda_niet_gelezen\), geen goede stand/],
    ["onbekende status", [laag("straatbestanden", "werken", "raar", 1)], /BRON straatbestanden werken: onbekende status raar/],
  ]) {
    const { code, tekst } = draai(lagen);
    assert.equal(code, 1, `${wat}: ${tekst}`);
    assert.match(tekst, regel, `${wat}: ${tekst}`);
    assert.match(tekst, /::error title=Bronstatus::.*live laag/, wat);
  }
  // Ontbreekt de stand (een kapotte stap in refresh), dan faalt de controle dicht.
  const zonder = draai(null);
  assert.equal(zonder.code, 1, zonder.tekst);
  assert.match(zonder.tekst, /BRON live lagen: live-lagen\.json ontbreekt of is ongeldig/);
});

test("de documentatie belooft alleen wat de alarmen doen", () => {
  const docs = fs.readFileSync(new URL("../docs/AGENDA_SOURCES.md", import.meta.url), "utf8");
  assert.match(docs, /`liveLaagGezondheid`/);
  assert.match(docs, /live-lagen\.json/);
  const code = fs.readFileSync(new URL("../lib/straat-bestanden.mjs", import.meta.url), "utf8") + fs.readFileSync(new URL("../scripts/sources-health.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(code, /de plekpagina zegt het zelf ook|is anders alleen op de plekpagina te zien/);
});
