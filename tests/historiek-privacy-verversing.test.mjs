// P4: de verversing van de historiek schrijft alleen district Antwerpen en geen huisnummers in vrije tekst. Een werk houdt
// zijn huisnummer (regel van de eigenaar van 26 oktober 2026: een werk staat er altijd met zijn exacte adres). Een
// parkeerverbod komt er sinds 3 november 2026 helemaal niet meer in (besluit van de eigenaar: "er moet geen historie zijn
// van parkeerverboden"); het lopende parkeerverbod staat wel in de stand voor de straatbestanden, met zijn plaats exact
// zoals publiekParkeerAdres ze schrijft, zonder bus, reden of het woord verhuis.
// Verzonnen gegevens; deze toets gebruikt alleen wat ook op main bestaat (de verversing zelf), zodat
// hij op main faalt en met lib/historiek-privacy.mjs slaagt.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { refreshLiveHistory } from "../scripts/refresh-live-history.mjs";
import { compactWorkItem, validateLiveHistory } from "../lib/live-history.mjs";
import {
  historyArchiveEventsDigest,
  validateHistoryArchiveBaseline,
  validateHistoryArchiveDay,
  validateHistoryArchiveIndex,
} from "../lib/live-history-archive.mjs";

const TA = "2026-10-09T03:00:00.000Z"; // eerste run (baseline)
const T0 = "2026-10-10T03:00:00.000Z"; // vorige dag
const T1 = "2026-10-11T01:00:00.000Z"; // eerdere run vandaag
const T2 = "2026-10-11T03:00:00.000Z"; // deze run
const START = Date.parse("2026-10-12T06:00:00Z");
const EINDE = Date.parse("2026-10-13T18:00:00Z");

// Verzonnen adressen. Drie in het district (2000), één erbuiten (2100).
const PARKEER = [
  { id: 1, adres: "Proefstraat 12 bus 3 2000 Antwerpen" },
  { id: 2, adres: "Proefstraat 14-16 2000 Antwerpen" },
  { id: 3, adres: "Proefweg 7 2100 Antwerpen" },
  { id: 4, adres: "Proefstraat 20 2000 Antwerpen" },
];
// Wat nooit in de historiek komt: een parkeerverbod (ook niet zijn id of titel), een bus, het nummer in de vorm van de bron
// ("14-16"), het verbod buiten het district, en de reden (de verzonnen reden "Verhuis", ook als oude titel).
const VERBODEN = ["parking", "Parkeerverbod", "PROEF-", "bus 3", "14-16", "Proefweg", "2100", "erhuis"];

const parkeerFeature = ({ id, adres }) => ({
  attributes: {
    OBJECTID: id, Dossiernummer: `PROEF-${id}`, Locatienummer: `L${id}`, Status: "Goedgekeurd", Adres: adres,
    Reden: "Verhuis", Startdatum: START, Einddatum: EINDE, EnkelWeekdagen: 0, GipodID: null, District: "ANTWERPEN",
  },
});
const DISTRICT = { type: "Polygon", coordinates: [[[4.38, 51.2], [4.43, 51.2], [4.43, 51.24], [4.38, 51.24], [4.38, 51.2]]] };
const STRAAT = {
  type: "Feature",
  properties: { LSTRNMID: "9001", LSTRNM: "Proefstraat", RSTRNMID: "9001", RSTRNM: "Proefstraat", postcode: "2000", DISTRICT: "ANTWERPEN" },
  geometry: { type: "LineString", coordinates: [[4.399, 51.219], [4.401, 51.221]] },
};
const WERK = {
  type: "Feature",
  geometry: { type: "Point", coordinates: [4.4, 51.22] },
  properties: { GipodId: 990001, Description: "2000 Antwerpen, Proefstraat 30", Owner: "Proefbedrijf", Status: "In uitvoering", Start: "2026-10-01T06:00:00Z", End: "2026-10-30T18:00:00Z" },
};

const nepFetch = maakNepFetch(WERK);

function maakNepFetch(werk) {
  return async (input) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/portal_publiek9/MapServer/905/")) return Response.json({ type: "FeatureCollection", features: [STRAAT] });
    if (url.pathname.includes("/portal_publiek2/MapServer/109/")) return Response.json({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: DISTRICT }] });
    if (url.pathname.endsWith("/collections/INNAME_PUNT/items")) return Response.json({ type: "FeatureCollection", features: [werk], links: [] });
    if (url.pathname.endsWith("/collections/HINDER_PUNT/items")) return Response.json({ type: "FeatureCollection", features: [], links: [] });
    const laag = url.pathname.match(/\/P_ASign\/ASign\/MapServer\/(\d+)\/query$/)?.[1];
    if (laag) {
      const rijen = laag === "20" ? PARKEER : [];
      if (url.searchParams.get("returnIdsOnly") === "true") return Response.json({ objectIds: rijen.map((rij) => rij.id) });
      const ids = (url.searchParams.get("objectIds") || "").split(",").map(Number);
      return Response.json({ features: rijen.filter((rij) => ids.includes(rij.id)).map(parkeerFeature) });
    }
    return new Response("", { status: 404 });
  };
}

// Een historiek zoals op main tot 3 november 2026: met parkeerverboden (met huisnummers, de reden als titel en een
// parkeerverbod buiten het district), en een werk met een wijziging op elke dag.
const oudParkeer = (id, adres) => ({
  id: `parking:PROEF-${id}|L${id}`, kind: "parking", kindLabel: "Parkeerverbod", title: "Verhuis", location: adres,
  start: new Date(START).toISOString(), end: new Date(EINDE).toISOString(), status: "Goedgekeurd", reference: `PROEF-${id}`, detail: "",
  streets: [], streetResolution: "unresolved", streetDistanceMeters: null,
});
const oudWerk = { gipodId: 990001, title: "2000 Antwerpen, Proefstraat 30", status: "In uitvoering", start: "2026-10-01T06:00:00Z", end: "2026-10-30T18:00:00Z", owner: "Proefbedrijf", ownerGroup: "Andere", boundaryConfidence: "point_inside_new", workTypes: [], occupancyTypes: [], hindrance: null };
const sha = (items) => crypto.createHash("sha256").update(JSON.stringify([...items].sort((a, b) => String(a.id).localeCompare(String(b.id), "nl")))).digest("hex");
const laag = (items, at) => ({ status: "ok", lastAttemptAt: at, lastSuccessAt: at, errorCode: null, count: items.length, digest: sha(items), items });

function oudeStand(root) {
  const werk = compactWorkItem(oudWerk);
  const verbod = (id) => oudParkeer(id, PARKEER[id - 1].adres);
  const toegevoegd = (at, id) => ({ observedAt: at, layer: "publicSpace", id: verbod(id).id, type: "added", fields: [], before: null, after: verbod(id) });
  const werkWijziging = (at, voor, na) => ({ observedAt: at, layer: "works", id: werk.id, type: "changed", fields: ["status"], before: { status: voor }, after: { status: na } });
  const gisterenEvents = [toegevoegd(T0, 3), toegevoegd(T0, 4), werkWijziging(T0, "Concreet gepland", "In uitvoering")];
  const vandaagEvents = [toegevoegd(T1, 2), werkWijziging(T1, "In uitvoering", "In uitvoering (verlengd)")];
  const h1 = {
    schemaVersion: 1, observedAt: T1, retentionDays: 90, baselineInitializedAt: TA,
    layers: { works: laag([{ ...werk, status: "In uitvoering (verlengd)" }], T1), publicSpace: laag([1, 2, 3, 4].map(verbod), T1) },
    changes: [...gisterenEvents, ...vandaagEvents],
  };
  const baseline = { schemaVersion: 1, layers: { works: { observedAt: TA, items: [werk] }, publicSpace: { observedAt: TA, items: [verbod(1)] } } };
  const gisteren = { schemaVersion: 1, date: "2026-10-10", events: gisterenEvents };
  const dag = { schemaVersion: 1, date: "2026-10-11", events: vandaagEvents };
  const index = {
    schemaVersion: 1, baselineInitializedAt: TA, lastObservedAt: T1,
    days: [gisteren, dag].map((d) => ({ date: d.date, file: `site/history/archive/${d.date}.json`, count: d.events.length, digest: historyArchiveEventsDigest(d.events) })),
  };
  const schrijf = (relative, value) => {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), `${JSON.stringify(value, null, 2)}\n`);
  };
  assert.deepEqual(validateLiveHistory(h1), [], "de oude stand is geldig");
  schrijf("site/history/live-layers.json", h1);
  schrijf("site/history/archive/baseline.json", baseline);
  schrijf(`site/history/archive/${gisteren.date}.json`, gisteren);
  schrijf(`site/history/archive/${dag.date}.json`, dag);
  schrijf("site/history/archive/index.json", index);
}

const historiekTekst = (root) => {
  const bestanden = [];
  const loop = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) loop(target);
      else bestanden.push(target);
    }
  };
  loop(path.join(root, "site", "history"));
  return bestanden.map((file) => [path.relative(root, file), fs.readFileSync(file, "utf8")]);
};

test("verversing: geen parkeerverbod in de historiek, ook niet uit een oude stand; het lopende staat wel in de stand voor de straten; een werk met zijn nummer", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "historiek-privacy-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  oudeStand(root);

  const history = await refreshLiveHistory({ rootDir: root, fetch: nepFetch, clock: () => new Date(T2), log: () => {} });

  // Geen enkel bestand onder site/history bevat nog een parkeerverbod, een bus, de reden of het adres buiten het district.
  for (const [file, inhoud] of historiekTekst(root)) {
    for (const verboden of VERBODEN) assert.equal(inhoud.includes(verboden), false, `${file} bevat nog "${verboden}"`);
  }
  assert.deepEqual(history.layers.publicSpace.items, []);
  assert.equal(history.layers.publicSpace.status, "ok");
  assert.equal(history.layers.works.items[0].title, "2000 Antwerpen, Proefstraat 30");
  // De overgang maakt geen wijzigingen: geen "removed" voor elk oud parkeerverbod, geen "added" voor de nieuwe.
  assert.deepEqual(history.changes.filter((change) => change.observedAt === T2).map((change) => change.id), ["work:990001"], "alleen het werk (terug naar zijn status)");
  assert.ok(history.changes.every((change) => change.layer === "works"));
  assert.deepEqual(validateLiveHistory(history), []);

  // Het archief (ook de oudere dag) en de index blijven geldig en kloppen met elkaar; alleen de wijzigingen van het werk
  // blijven over.
  const baseline = JSON.parse(fs.readFileSync(path.join(root, "site/history/archive/baseline.json"), "utf8"));
  assert.deepEqual(validateHistoryArchiveBaseline(baseline), []);
  assert.deepEqual(baseline.layers.publicSpace.items, []);
  const index = JSON.parse(fs.readFileSync(path.join(root, "site/history/archive/index.json"), "utf8"));
  assert.deepEqual(validateHistoryArchiveIndex(index), []);
  for (const datum of ["2026-10-10", "2026-10-11"]) {
    const dag = JSON.parse(fs.readFileSync(path.join(root, `site/history/archive/${datum}.json`), "utf8"));
    assert.deepEqual(validateHistoryArchiveDay(dag), []);
    assert.equal(index.days.find((day) => day.date === datum).digest, historyArchiveEventsDigest(dag.events));
    assert.ok(dag.events.length > 0 && dag.events.every((event) => event.id === "work:990001"), `${datum}: alleen het werk blijft`);
  }

  // De lopende parkeerverboden staan wel in de stand voor de straatbestanden (die de site toont), met hun plaats exact,
  // als "Parkeerverbod" en zonder reden; dat van buiten het district niet.
  const bronnen = JSON.parse(fs.readFileSync(path.join(root, ".cache/straat-bronnen.json"), "utf8"));
  const parkeer = bronnen.lagen.publiekeRuimte.items.filter((item) => item.kind === "parking");
  assert.deepEqual(Object.fromEntries(parkeer.map((item) => [item.id, item.location])), {
    "parking:PROEF-1|L1": "Proefstraat 12, 2000 Antwerpen",
    "parking:PROEF-2|L2": "Proefstraat 14–16, 2000 Antwerpen",
    "parking:PROEF-4|L4": "Proefstraat 20, 2000 Antwerpen",
  });
  assert.ok(parkeer.every((item) => item.title === "Parkeerverbod" && !("reason" in item)));
  assert.doesNotMatch(JSON.stringify(parkeer), /erhuis|bus 3|Proefweg/);
});

// Een titel met een lange lijst nummers (verzonnen): de opkuis vooraf en de nieuwe ophaling moeten
// hetzelfde vaste punt geven. Anders komt er een valse "changed:title" bij en houdt validate-data de hele
// verversing tegen. Een werk houdt zijn nummers (regel van de eigenaar van 26 oktober 2026).
test("verversing: een werk met een lange lijst nummers houdt ze, zonder valse wijziging, ook na drie verversingen", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "historiek-lijst-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Dynamisch: zo faalt de eerste toets van dit bestand op main om de juiste reden.
  const { historiekPrivacyBevindingen } = await import("../lib/historiek-privacy.mjs");
  const werk = { ...WERK, properties: { ...WERK.properties, Description: "2000 Antwerpen, Proefstraat 12 14 16 18 20 22 24" } };
  const runs = ["2026-10-11T03:00:00.000Z", "2026-10-12T03:00:00.000Z", "2026-10-13T03:00:00.000Z"];
  for (const [index, observedAt] of runs.entries()) {
    const history = await refreshLiveHistory({ rootDir: root, fetch: maakNepFetch(werk), clock: () => new Date(observedAt), log: () => {} });
    assert.equal(history.layers.works.items[0].title, "2000 Antwerpen, Proefstraat 12 14 16 18 20 22 24", `run ${index + 1}`);
    if (index > 0) assert.deepEqual(history.changes.filter((change) => change.observedAt === observedAt && change.layer === "works"), [], `run ${index + 1}: geen valse wijziging`);
    for (const [file, inhoud] of historiekTekst(root)) {
      assert.deepEqual(historiekPrivacyBevindingen(JSON.parse(inhoud)), [], `run ${index + 1}: ${file}`);
    }
  }
});

// Een kapot bestand onder site/history: de opkuis slaat het over, kuist de rest op, en de publieke
// log toont geen stuk van de inhoud (V8 zet het begin van de tekst in de foutmelding van JSON.parse).
test("verversing: een kapot archiefbestand komt niet in de log en houdt de opkuis niet tegen", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "historiek-kapot-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  oudeStand(root);
  fs.writeFileSync(path.join(root, "site/history/archive/2026-10-08.json"), "Proefstraat 12 bus 3 is geen JSON");
  const regels = [];
  await refreshLiveHistory({ rootDir: root, fetch: nepFetch, clock: () => new Date(T2), log: (regel) => regels.push(String(regel)) });
  const log = regels.join("\n");
  for (const verboden of ["Proefstraat 12", "bus 3", "geen JSON"]) assert.equal(log.includes(verboden), false, `de log bevat "${verboden}"`);
  const opkuis = regels.map((regel) => JSON.parse(regel)).find((regel) => regel.historiekOpkuis)?.historiekOpkuis;
  assert.equal(opkuis?.nietGeschreven, 1, "het kapotte bestand wordt gemeld als aantal");
  // De andere bestanden zijn wel opgekuist.
  for (const [file, inhoud] of historiekTekst(root).filter(([file]) => !file.endsWith("2026-10-08.json"))) {
    for (const verboden of VERBODEN) assert.equal(inhoud.includes(verboden), false, `${file} bevat nog "${verboden}"`);
  }
});
