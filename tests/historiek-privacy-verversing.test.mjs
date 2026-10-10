// P4: de verversing van de historiek schrijft alleen district Antwerpen en geen huisnummers.
// Verzonnen gegevens; deze toets gebruikt alleen wat ook op main bestaat (de verversing zelf), zodat
// hij op main faalt en met lib/historiek-privacy.mjs slaagt.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { refreshLiveHistory } from "../scripts/refresh-live-history.mjs";
import { updateLiveHistory, validateLiveHistory } from "../lib/live-history.mjs";
import {
  historyArchiveEventsDigest,
  updateHistoryArchiveBaseline,
  updateHistoryArchiveDay,
  updateHistoryArchiveIndex,
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
const VERBODEN = ["Proefstraat 12", "bus 3", "14-16", "Proefstraat 20", "Proefweg", "2100"];

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
  properties: { GipodId: 990001, Description: "2000 Antwerpen, Proefstraat 12", Owner: "Proefbedrijf", Status: "In uitvoering", Start: "2026-10-01T06:00:00Z", End: "2026-10-30T18:00:00Z" },
};

async function nepFetch(input) {
  const url = new URL(String(input));
  if (url.pathname.includes("/portal_publiek9/MapServer/905/")) return Response.json({ type: "FeatureCollection", features: [STRAAT] });
  if (url.pathname.includes("/portal_publiek2/MapServer/109/")) return Response.json({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: DISTRICT }] });
  if (url.pathname.endsWith("/collections/INNAME_PUNT/items")) return Response.json({ type: "FeatureCollection", features: [WERK], links: [] });
  if (url.pathname.endsWith("/collections/HINDER_PUNT/items")) return Response.json({ type: "FeatureCollection", features: [], links: [] });
  const laag = url.pathname.match(/\/P_ASign\/ASign\/MapServer\/(\d+)\/query$/)?.[1];
  if (laag) {
    const rijen = laag === "20" ? PARKEER : [];
    if (url.searchParams.get("returnIdsOnly") === "true") return Response.json({ objectIds: rijen.map((rij) => rij.id) });
    const ids = (url.searchParams.get("objectIds") || "").split(",").map(Number);
    return Response.json({ features: rijen.filter((rij) => ids.includes(rij.id)).map(parkeerFeature) });
  }
  return new Response("", { status: 404 });
}

// Een historiek zoals op main: met huisnummers en met een parkeerverbod buiten het district.
const oudParkeer = (id, adres) => ({
  id: `parking:PROEF-${id}|L${id}`, kind: "parking", kindLabel: "Parkeerverbod", title: "Verhuis", location: adres,
  start: new Date(START).toISOString(), end: new Date(EINDE).toISOString(), status: "Goedgekeurd", reference: `PROEF-${id}`, detail: "",
  streets: [], streetResolution: "unresolved", streetDistanceMeters: null,
});
const oudWerk = { gipodId: 990001, title: "2000 Antwerpen, Proefstraat 12", status: "In uitvoering", start: "2026-10-01T06:00:00Z", end: "2026-10-30T18:00:00Z", owner: "Proefbedrijf", ownerGroup: "Andere", boundaryConfidence: "point_inside_new", workTypes: [], occupancyTypes: [], hindrance: null };

function oudeStand(root) {
  const oud = (...ids) => ({ ok: true, items: ids.map((id) => oudParkeer(id, PARKEER[id - 1].adres)) });
  const hA = updateLiveHistory(null, { observedAt: TA, worksResult: { ok: true, items: [oudWerk] }, publicSpaceResult: oud(1) });
  const h0 = updateLiveHistory(hA, { observedAt: T0, worksResult: { ok: true, items: [oudWerk] }, publicSpaceResult: oud(1, 3, 4) });
  const h1 = updateLiveHistory(h0, { observedAt: T1, worksResult: { ok: true, items: [oudWerk] }, publicSpaceResult: oud(1, 2, 3, 4) });
  const baseline = updateHistoryArchiveBaseline(null, hA);
  // Een oudere dag (gisteren) en de dag van vandaag, allebei zoals op main.
  const gisteren = updateHistoryArchiveDay(null, T0, h0.changes.filter((change) => change.observedAt === T0));
  const dag = updateHistoryArchiveDay(null, T1, h1.changes.filter((change) => change.observedAt === T1));
  const index = updateHistoryArchiveIndex(
    updateHistoryArchiveIndex(null, { observedAt: T0, baseline, dayDocument: gisteren }),
    { observedAt: T1, baseline, dayDocument: dag }
  );
  const schrijf = (relative, value) => {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), `${JSON.stringify(value, null, 2)}\n`);
  };
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

test("verversing: historiek zonder huisnummers en alleen het district, ook na een oude stand", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "historiek-privacy-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  oudeStand(root);

  const history = await refreshLiveHistory({ rootDir: root, fetch: nepFetch, clock: () => new Date(T2), log: () => {} });

  // Geen enkel bestand onder site/history bevat nog een verzonnen huisnummer of het adres buiten het district.
  for (const [file, inhoud] of historiekTekst(root)) {
    for (const verboden of VERBODEN) assert.equal(inhoud.includes(verboden), false, `${file} bevat nog "${verboden}"`);
  }

  const parkeer = history.layers.publicSpace.items.filter((item) => item.kind === "parking");
  assert.deepEqual(parkeer.map((item) => item.id).sort(), ["parking:PROEF-1|L1", "parking:PROEF-2|L2", "parking:PROEF-4|L4"]);
  assert.ok(parkeer.every((item) => item.location === "Proefstraat, 2000 Antwerpen"));
  assert.ok(parkeer.every((item) => item.streets.length === 1 && item.streets[0].postcode === "2000"), "de straat blijft gekend");
  assert.equal(history.layers.works.items[0].title, "2000 Antwerpen, Proefstraat");

  // De overgang maakt geen massa wijzigingen: wegvallende huisnummers zijn geen "changed", het verbod
  // buiten het district is geen "removed".
  assert.deepEqual(history.changes.filter((change) => change.observedAt === T2), []);
  assert.deepEqual(validateLiveHistory(history), []);

  // Het archief (ook de oudere dag) en de index blijven geldig en kloppen met elkaar.
  const index = JSON.parse(fs.readFileSync(path.join(root, "site/history/archive/index.json"), "utf8"));
  assert.deepEqual(validateHistoryArchiveIndex(index), []);
  const verwacht = { "2026-10-10": ["parking:PROEF-4|L4"], "2026-10-11": ["parking:PROEF-2|L2"] };
  for (const [datum, ids] of Object.entries(verwacht)) {
    const dag = JSON.parse(fs.readFileSync(path.join(root, `site/history/archive/${datum}.json`), "utf8"));
    assert.deepEqual(validateHistoryArchiveDay(dag), []);
    assert.equal(index.days.find((day) => day.date === datum).digest, historyArchiveEventsDigest(dag.events));
    assert.deepEqual(dag.events.map((event) => event.id), ids, `${datum}: alleen de toevoeging in het district blijft`);
  }
});
