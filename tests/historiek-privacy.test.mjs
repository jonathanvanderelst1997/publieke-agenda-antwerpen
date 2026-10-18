// P4: privacy van de historiek (lib/historiek-privacy.mjs). Verzonnen adressen, behalve in de scan
// over de echte bestanden onder site/history; die toont nooit een gevonden waarde, alleen aantallen
// en bestandsnamen (de CI-logs zijn publiek). Een echte straatnaam (om de officiële stratenlijst te
// toetsen) krijgt altijd huisnummer 999, dat daar niet bestaat.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  adresAlleenStraat,
  archiefDagVoorPubliek,
  huisnummerStukken,
  itemVoorHistoriek,
  historiekPrivacyBevindingen,
  historiekVoorPubliek,
  resultaatVoorHistoriek,
  tekstZonderHuisnummers,
} from "../lib/historiek-privacy.mjs";
import { updateLiveHistory, validateLiveHistory } from "../lib/live-history.mjs";
import { opkuisHistoriekPrivacy } from "../scripts/opkuis-historiek-privacy.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

test('"Xstraat 12" wordt "Xstraat": adressen houden alleen straat en postcode', () => {
  assert.equal(adresAlleenStraat("Xstraat 12 2000 Antwerpen"), "Xstraat, 2000 Antwerpen");
  assert.equal(adresAlleenStraat("Xstraat 12-14 2000 Antwerpen"), "Xstraat, 2000 Antwerpen");
  assert.equal(adresAlleenStraat("Xstraat 12 bus 3 2000 Antwerpen"), "Xstraat, 2000 Antwerpen");
  assert.equal(adresAlleenStraat("Xstraat 12A-14 2018 Antwerpen"), "Xstraat, 2018 Antwerpen");
  assert.equal(adresAlleenStraat("Xlaan (2610) 34-hoek 2610 Antwerpen"), "Xlaan, 2610 Antwerpen");
  assert.equal(adresAlleenStraat("Xstraat hoek-64 2060 Antwerpen"), "Xstraat, 2060 Antwerpen");
  assert.equal(adresAlleenStraat("Xstraat Onbekend-Onbekend 2000 Antwerpen"), "Xstraat, 2000 Antwerpen");
  assert.equal(adresAlleenStraat("Xstraat 1, 2000 Antwerpen"), "Xstraat, 2000 Antwerpen");
  // Al opgekuist blijft gelijk; officiële straatnamen met een cijfer blijven heel.
  assert.equal(adresAlleenStraat("Xstraat, 2000 Antwerpen"), "Xstraat, 2000 Antwerpen");
  assert.equal(adresAlleenStraat("4 septemberpad 999 2020 Antwerpen"), "4 septemberpad, 2020 Antwerpen");
  assert.equal(adresAlleenStraat("Kanaaldok B1-Oostkaai 2030 Antwerpen"), "Kanaaldok B1-Oostkaai, 2030 Antwerpen");
});

test("vrije tekst: nummers achter een straat weg, ook reeksen en busnummers; jaartallen en maten blijven", () => {
  const gevallen = [
    ["Xstraat 12", "Xstraat"],
    ["2000 | Antwerpen | Xstraat | 12", "2000 | Antwerpen | Xstraat"],
    ["2000 ANTWERPEN, XSTRAAT 3B_BIS", "2000 ANTWERPEN, XSTRAAT"],
    ["2000 Antwerpen - (Antwerpen) - Xstraat - 12 - werken aan nutsleiding - 150m.", "2000 Antwerpen - (Antwerpen) - Xstraat - werken aan nutsleiding - 150m."],
    ["Xstraat 12 tem 14A en Ylaan 3 bus 2 - werken", "Xstraat en Ylaan - werken"],
    ["Xstraat 12 en 134 - twee koppelputten", "Xstraat - twee koppelputten"],
    ["Xplein 12/3 (aansluiting)", "Xplein (aansluiting)"],
    ["Meir 999", "Meir"], // officiële straatnaam zonder straatuitgang
    ["R1 - Xtunnel - Regulier onderhoud 2026 - Antwerpen", "R1 - Xtunnel - Regulier onderhoud 2026 - Antwerpen"],
    ["Xtunnel 2026 - Antwerpen", "Xtunnel 2026 - Antwerpen"],
    ["Xstraat - 30 m", "Xstraat - 30 m"],
    ["Fase 12345", "Fase 12345"],
    ["N1234567 - Renovatie Xwegen N123", "N1234567 - Renovatie Xwegen N123"],
  ];
  for (const [voor, na] of gevallen) assert.equal(tekstZonderHuisnummers(voor), na, voor);
});

// Vormen die de eerste versie miste (scan en opkuis), en reeksen die ze maar half opkuiste.
test("vrije tekst: ook komma, haakjes, thv, huisnummer, nrs, str., 12bus3 en hele reeksen", () => {
  const gevallen = [
    ["Proefstraat, 12", "Proefstraat"],
    ["Proefstraat (12)", "Proefstraat"],
    ["Proefstraat thv 12 - werken", "Proefstraat - werken"],
    ["Proefstraat t.h.v. nr 12", "Proefstraat"],
    ["Proefstraat ter hoogte van nr 12", "Proefstraat"],
    ["Proefstraat huisnummer 12", "Proefstraat"],
    ["Proefstraat nrs 12-14", "Proefstraat"],
    ["Proefstr. 12", "Proefstr."],
    ["Proefstraat 12bus3", "Proefstraat"],
    ["Proefstraat 12 t.e.m. 20 - werken", "Proefstraat - werken"],
    ["Proefstraat 12, 14 en 16", "Proefstraat"],
    ["Proefstraat 12 tm 20", "Proefstraat"],
    ["Proefstraat 12 tot en met 20", "Proefstraat"],
    ["Proefstraat 12 → 20", "Proefstraat"],
    ["Proefstraat ter hoogte van nr 12, ter hoogte van nr 14-16 en ter hoogte van nr 18-20. - werken", "Proefstraat. - werken"],
    ["Proefstraat 12 t.e.m. 20 en Proeflaan 3 t.e.m. 7 in het voetpad", "Proefstraat en Proeflaan in het voetpad"],
    // Wat de eerste versie half liet staan, raakt nu ook weg.
    ["Proefstraat t.e.m. 20", "Proefstraat"],
    ["Proefstraat, 14 en 16", "Proefstraat"],
    // Geen huisnummer: blijft.
    ["Proefstraat (9 aansluitingen)", "Proefstraat (9 aansluitingen)"],
    ["Ystraat (Proefstraat 12)", "Ystraat (Proefstraat)"],
    ["Proefstraat 12, 2000 Antwerpen", "Proefstraat, 2000 Antwerpen"],
    ["Proefstraat, 1000 Brussel", "Proefstraat, 1000 Brussel"],
    ["Proefstraat 12 30 m", "Proefstraat 30 m"],
  ];
  for (const [voor, na] of gevallen) {
    assert.equal(tekstZonderHuisnummers(voor), na, voor);
    // De scan ziet dezelfde vormen: "0 bevindingen" betekent "geen huisnummer".
    assert.equal(huisnummerStukken(voor).length > 0, voor !== na, `scan: ${voor}`);
  }
});

test("opkuis is een vast punt: een lange lijst valt helemaal weg en opnieuw opkuisen verandert niets", () => {
  const lijst = "2000 Antwerpen, Proefstraat 12 14 16 18 20 22 24";
  assert.equal(tekstZonderHuisnummers(lijst), "2000 Antwerpen, Proefstraat");
  const lastig = [
    lijst,
    "Proefstraat 1 3 5 7 9 11 13 15 17 19 21 23 - werken",
    "Proefstraat 12-14-16-18 bus 3 en Proeflaan 1, 3, 5, 7, 9 en 11 en Proefplein 2 tem 8",
    "Proefstraat 12 t.e.m. 20, Proefstraat 30 tot en met 40 → Proeflaan 5",
    "Proefstraat thv 12 thv 14 thv 16 thv 18 thv 20 thv 22",
  ];
  for (const tekst of lastig) {
    const een = tekstZonderHuisnummers(tekst);
    assert.equal(tekstZonderHuisnummers(een), een, `t(t(x)) = t(x): ${tekst}`);
    // Wat de opkuis teruggeeft, keurt de scan nooit af (anders houdt validate-data elke verversing tegen).
    for (const item of [{ title: tekst }, { location: `${tekst} 2000 Antwerpen` }]) {
      const schoon = itemVoorHistoriek(item);
      assert.deepEqual(historiekPrivacyBevindingen(schoon), [], JSON.stringify(item));
      assert.deepEqual(itemVoorHistoriek(schoon), schoon, `vast punt: ${JSON.stringify(item)}`);
    }
  }
});

// Een echte straat met een bestaand huisnummer hoort niet in een toets (de repo is publiek).
test("toetsen: een echte straatnaam krijgt alleen huisnummer 999", () => {
  const namen = new Set(JSON.parse(fs.readFileSync(path.join(repoRoot, "site/geo/straten.json"), "utf8")).streets.map((rij) => String(rij[1]).toLowerCase()));
  const fouten = [];
  for (const naam of ["historiek-privacy.test.mjs", "historiek-privacy-verversing.test.mjs"]) {
    const regels = fs.readFileSync(path.join(repoRoot, "tests", naam), "utf8").split("\n");
    regels.forEach((regel, index) => {
      for (const [, tekst] of regel.matchAll(/"([^"\\]*)"/g)) {
        for (const [begin, einde] of huisnummerStukken(tekst)) {
          const woorden = tekst.slice(0, begin).toLowerCase().split(/[\s,(]+/).filter(Boolean);
          const echt = [1, 2, 3, 4].some((k) => namen.has(woorden.slice(-k).join(" ")));
          if (echt && tekst.slice(begin, einde).match(/\d+/g).some((nummer) => nummer !== "999")) fouten.push(`${naam}:${index + 1}`);
        }
      }
    });
  }
  assert.deepEqual(fouten, []);
});

const parkeer = (id, location, extra = {}) => ({
  id: `parking:D${id}|L${id}`, kind: "parking", kindLabel: "Parkeerverbod", title: "Verhuis", location,
  start: "2026-10-12T06:00:00.000Z", end: "2026-10-13T18:00:00.000Z", status: "Goedgekeurd", reference: `D${id}`, detail: "",
  streets: [], streetResolution: "unresolved", streetDistanceMeters: null, ...extra,
});

// Een historiek zoals main ze schreef (met huisnummers), los van lib/live-history.mjs: die kan zelf al
// opkuisen (#139), en deze toetsen moeten de oude vorm blijven nabootsen.
const sha = (items) => crypto.createHash("sha256").update(JSON.stringify([...items].sort((a, b) => String(a.id).localeCompare(String(b.id), "nl")))).digest("hex");
const laag = (items, at) => ({ status: "ok", lastAttemptAt: at, lastSuccessAt: at, errorCode: null, count: items.length, digest: sha(items), items });
const oudeHistoriek = ({ observedAt, works = [], publicSpace = [], changes = [] }) => ({
  schemaVersion: 1, observedAt, retentionDays: 90, baselineInitializedAt: observedAt,
  layers: { works: laag(works, observedAt), publicSpace: laag(publicSpace, observedAt) }, changes,
});

test("een punt buiten het district valt weg", () => {
  const result = resultaatVoorHistoriek({ ok: true, items: [parkeer(1, "Xstraat 2 2000 Antwerpen"), parkeer(2, "Ystraat 5 2100 Antwerpen"), parkeer(3, "Zstraat 9 2600 Antwerpen")] });
  assert.deepEqual(result.items.map((item) => item.id), ["parking:D1|L1"]);
  assert.equal(result.buitenDistrict, 2);
  // Zonder postcode beslist de officiële straat van het district.
  const zonder = resultaatVoorHistoriek({ ok: true, items: [parkeer(4, "Xstraat 2", { streets: [{ id: "1", name: "Xstraat", postcode: "2000" }] }), parkeer(5, "Ystraat 5")] });
  assert.deepEqual(zonder.items.map((item) => item.id), ["parking:D4|L4"]);
});

test("de scan vindt een huisnummer, een postcode buiten het district en een punt buiten de grens", () => {
  const codes = (value) => historiekPrivacyBevindingen(value).map((finding) => finding.code).sort();
  assert.deepEqual(codes({ items: [parkeer(1, "Xstraat 2 2000 Antwerpen")] }), ["huisnummer"]);
  assert.deepEqual(codes({ items: [parkeer(1, "Xstraat, 2100 Antwerpen")] }), ["buiten_district"]);
  assert.deepEqual(codes({ title: "2000 Antwerpen, Xstraat 12" }), ["huisnummer"]);
  assert.deepEqual(codes({ streets: [{ id: "1", name: "Xstraat", postcode: "2100" }] }), ["buiten_district"]);
  assert.deepEqual(codes({ point: [4.4, 51.15] }), ["punt_buiten_district"]); // Hoboken
  assert.deepEqual(codes({ point: [4.4025, 51.2194] }), []); // Groenplaats
  assert.deepEqual(codes({ items: [parkeer(1, "Xstraat, 2000 Antwerpen")], title: "R1 - Xtunnel 2026", detail: "Fase 12345" }), []);
  // De melding noemt een pad, nooit de waarde.
  assert.ok(historiekPrivacyBevindingen({ title: "Xstraat 12" }).every((finding) => !JSON.stringify(finding).includes("12")));
});

// Nakijken van de samenvoeging: een GIPOD-titel met een naam na een dossiercode (een persoon, bv. een
// werkleider) stond in live-layers.json en archive/baseline.json; de opkuis haalde hem niet weg en de scan
// vond hem niet. Dezelfde regel als de kaartjes (naamNaCodeWeg in site/kaart-uitleg.js). Verzonnen naam.
test("een naam na een dossiercode valt weg uit de historiek, en de scan vindt hem zonder hem te tonen", () => {
  const codes = (value) => historiekPrivacyBevindingen(value).map((finding) => finding.code).sort();
  const titel = "2020_ANTWERPEN-Voorbeeldwijk_Voorbeeldlaan / Kabelwerken DNW12345678_Jan Voorbeeldman LS_voetpadkast vervangen";
  assert.deepEqual(codes({ title: titel }), ["naam"]);
  assert.ok(historiekPrivacyBevindingen({ title: titel }).every((finding) => !/Jan|Voorbeeldman/.test(JSON.stringify(finding))));
  const schoon = itemVoorHistoriek({ id: "work:1", gipodId: 1, title: titel });
  assert.equal(schoon.title, "2020_ANTWERPEN-Voorbeeldwijk_Voorbeeldlaan / Kabelwerken DNW12345678_ LS_voetpadkast vervangen");
  assert.deepEqual(historiekPrivacyBevindingen(schoon), []);
  assert.deepEqual(itemVoorHistoriek(schoon), schoon, "opnieuw opkuisen verandert niets");
  // Een code met cijfers of een kleine letter erna is geen naam ("PG0971_N1_…"), net als in de kaartjes.
  assert.deepEqual(codes({ title: "Spoorwerken PG0971_N1_Intra_Muros" }), []);
  assert.deepEqual(codes({ title: "Xstraat, 2000 Antwerpen - DNW12345678_ LS_kast" }), []);
  // Ook in een laag en in een wijziging; de digest volgt de opgekuiste items.
  const T = "2026-10-10T03:00:00.000Z";
  const werk = { id: "work:1", gipodId: 1, title: titel, start: "2026-10-01T06:00:00.000Z", end: "2026-10-30T16:00:00.000Z", status: "In uitvoering" };
  const h = oudeHistoriek({ observedAt: T, works: [werk], changes: [{ observedAt: T, layer: "works", id: "work:1", type: "added", fields: [], before: null, after: werk }] });
  assert.deepEqual(codes(h), ["naam", "naam"]);
  const publiek = historiekVoorPubliek(h, { onbekend: false });
  assert.deepEqual(historiekPrivacyBevindingen(publiek), []);
  assert.equal(publiek.layers.works.digest, sha(publiek.layers.works.items));
  assert.doesNotMatch(JSON.stringify(publiek), /Voorbeeldman/);
  assert.deepEqual(validateLiveHistory(publiek), []);
});

test("historiek: oude wijzigingen zonder adres volgen hun parkeerverbod; een wijziging van alleen het huisnummer valt weg", () => {
  const T2 = "2026-10-10T03:00:00.000Z";
  const h2 = oudeHistoriek({
    observedAt: T2,
    publicSpace: [parkeer(1, "Xstraat 4 2000 Antwerpen"), parkeer(2, "Ystraat 5 2100 Antwerpen", { end: "2026-10-14T18:00:00.000Z" })],
    changes: [
      { observedAt: T2, layer: "publicSpace", id: "parking:D1|L1", type: "changed", fields: ["location"], before: { location: "Xstraat 2 2000 Antwerpen" }, after: { location: "Xstraat 4 2000 Antwerpen" } },
      { observedAt: T2, layer: "publicSpace", id: "parking:D2|L2", type: "changed", fields: ["end"], before: { end: "2026-10-13T18:00:00.000Z" }, after: { end: "2026-10-14T18:00:00.000Z" } },
    ],
  });
  assert.deepEqual(validateLiveHistory(h2), []);
  const schoon = historiekVoorPubliek(h2, { onbekend: false });
  assert.deepEqual(schoon.changes, []);
  assert.deepEqual(schoon.layers.publicSpace.items.map((item) => item.location), ["Xstraat, 2000 Antwerpen"]);
  assert.deepEqual(validateLiveHistory(schoon), []);
  assert.deepEqual(historiekPrivacyBevindingen(schoon), []);
  // Dagarchief: dezelfde regels; een wijziging waarvan het adres niet te vinden is, valt weg.
  const dag = archiefDagVoorPubliek({ schemaVersion: 1, date: "2026-10-10", events: h2.changes }, { onbekend: false });
  assert.deepEqual(dag.events, []);
});

test("eenmalige opkuis: schrijft schone, geldige bestanden en is daarna een no-op", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "historiek-opkuis-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const T1 = "2026-10-09T03:00:00.000Z", T2 = "2026-10-10T03:00:00.000Z";
  const werk = { gipodId: 7, title: "2000 Antwerpen, Xstraat 12", status: "In uitvoering", start: T1, end: T2, owner: "Proef", ownerGroup: "Andere", boundaryConfidence: "point_inside_new", workTypes: [], occupancyTypes: [], hindrance: null };
  const h1 = updateLiveHistory(null, { observedAt: T1, worksResult: { ok: true, items: [werk] }, publicSpaceResult: { ok: true, items: [parkeer(1, "Xstraat 2 2000 Antwerpen")] } });
  const h2 = updateLiveHistory(h1, { observedAt: T2, worksResult: { ok: true, items: [werk] }, publicSpaceResult: { ok: true, items: [parkeer(1, "Xstraat 2 2000 Antwerpen"), parkeer(2, "Ystraat 5 2100 Antwerpen")] } });
  const dag = { schemaVersion: 1, date: "2026-10-10", events: h2.changes };
  const schrijf = (relative, value) => {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), `${JSON.stringify(value, null, 2)}\n`);
  };
  schrijf("site/history/live-layers.json", h2);
  schrijf("site/history/archive/baseline.json", { schemaVersion: 1, layers: { works: { observedAt: T1, items: h1.layers.works.items }, publicSpace: { observedAt: T1, items: h1.layers.publicSpace.items } } });
  schrijf("site/history/archive/2026-10-10.json", dag);
  schrijf("site/history/archive/index.json", { schemaVersion: 1, baselineInitializedAt: T1, lastObservedAt: T2, days: [{ date: "2026-10-10", file: "site/history/archive/2026-10-10.json", count: 1, digest: "0".repeat(64) }] });

  // De verversing mag geen bestand wissen (datatak): een dag die leeg zou worden, blijft dan staan
  // (met zijn indexregel en de weg vooruit in de melding), maar de andere bestanden worden wel schoon.
  const dagVooraf = fs.readFileSync(path.join(root, "site/history/archive/2026-10-10.json"), "utf8");
  const indexVooraf = fs.readFileSync(path.join(root, "site/history/archive/index.json"), "utf8");
  const verversing = opkuisHistoriekPrivacy({ rootDir: root, write: true, verwijderLeeg: false });
  assert.match(verversing.nietGeschreven["site/history/archive/2026-10-10.json"], /leeg.*opkuis-historiek-privacy\.mjs --write/);
  assert.equal(fs.readFileSync(path.join(root, "site/history/archive/2026-10-10.json"), "utf8"), dagVooraf);
  assert.equal(fs.readFileSync(path.join(root, "site/history/archive/index.json"), "utf8"), indexVooraf);
  for (const relative of ["site/history/live-layers.json", "site/history/archive/baseline.json"]) {
    const inhoud = fs.readFileSync(path.join(root, relative), "utf8");
    assert.equal(inhoud.includes("Xstraat 2") || inhoud.includes("Xstraat 12") || inhoud.includes("2100"), false, relative);
  }

  const eerste = opkuisHistoriekPrivacy({ rootDir: root, write: true });
  assert.deepEqual(eerste.leegGeworden, ["site/history/archive/2026-10-10.json"], "de enige wijziging lag buiten het district");
  const tekst = fs.readdirSync(path.join(root, "site/history/archive")).map((name) => fs.readFileSync(path.join(root, "site/history/archive", name), "utf8")).join("\n")
    + fs.readFileSync(path.join(root, "site/history/live-layers.json"), "utf8");
  for (const verboden of ["Xstraat 2", "Xstraat 12", "Ystraat", "2100"]) assert.equal(tekst.includes(verboden), false, verboden);
  const index = JSON.parse(fs.readFileSync(path.join(root, "site/history/archive/index.json"), "utf8"));
  assert.deepEqual(index.days, []);

  const voor = fs.readFileSync(path.join(root, "site/history/live-layers.json"), "utf8");
  const tweede = opkuisHistoriekPrivacy({ rootDir: root, write: true });
  assert.deepEqual(tweede.gewijzigd, [], "tweede keer verandert niets");
  assert.equal(fs.readFileSync(path.join(root, "site/history/live-layers.json"), "utf8"), voor);
});

test("opkuis: wat niet lukt, houdt de rest niet tegen en wordt gemeld", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "historiek-opkuis-rest-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const T = "2026-10-10T03:00:00.000Z";
  // Een werk met een straat buiten het district: dat haalt de opkuis niet weg (de scan meldt het wel).
  const werk = { id: "work:8", gipodId: 8, title: "Proefstraat 12", streets: [{ id: "1", name: "Proefstraat", postcode: "2100" }], status: "In uitvoering", start: T, end: T };
  const schrijf = (relative, inhoud) => {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), inhoud);
  };
  schrijf("site/history/live-layers.json", `${JSON.stringify(oudeHistoriek({ observedAt: T, works: [werk], publicSpace: [parkeer(1, "Proefstraat 12 2000 Antwerpen")] }), null, 2)}\n`);
  schrijf("site/history/archive/2026-10-09.json", "Proefstraat 12 bus 3 is geen JSON");

  const rapport = opkuisHistoriekPrivacy({ rootDir: root, write: true });
  const live = fs.readFileSync(path.join(root, "site/history/live-layers.json"), "utf8");
  assert.equal(live.includes("Proefstraat 12"), false, "het huisnummer is toch weg");
  assert.deepEqual(rapport.nogBevindingen, { "site/history/live-layers.json": 1 });
  assert.deepEqual(rapport.nietGeschreven, { "site/history/archive/2026-10-09.json": "geen geldige JSON" });
  assert.equal(JSON.stringify(rapport).includes("Proefstraat 12"), false, "het rapport toont geen inhoud");
});

test("validate-data meldt een huisnummer in de historiek met het pad, zonder de waarde", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "historiek-validatie-"));
  try {
    fs.cpSync(path.join(repoRoot, "lib"), path.join(root, "lib"), { recursive: true });
    fs.mkdirSync(path.join(root, "scripts"));
    fs.copyFileSync(path.join(repoRoot, "scripts", "validate-data.mjs"), path.join(root, "scripts", "validate-data.mjs"));
    fs.mkdirSync(path.join(root, "site", "history"), { recursive: true });
    // Alle gedeelde modules uit site/ (lib/ gebruikt er enkele; andere PR's kunnen er bij zetten).
    for (const name of fs.readdirSync(path.join(repoRoot, "site")).filter((entry) => entry.endsWith(".js"))) {
      fs.copyFileSync(path.join(repoRoot, "site", name), path.join(root, "site", name));
    }
    const history = oudeHistoriek({ observedAt: "2026-10-10T03:00:00.000Z", publicSpace: [parkeer(1, "Xstraat 27 2000 Antwerpen")] });
    fs.writeFileSync(path.join(root, "site/history/live-layers.json"), JSON.stringify(history));
    const run = spawnSync(process.execPath, [path.join(root, "scripts", "validate-data.mjs")], { encoding: "utf8" });
    const regels = run.stderr.split("\n").filter((line) => line.startsWith("site/history/") && line.includes("privacy"));
    assert.deepEqual(regels, ["site/history/live-layers.json: privacy huisnummer op $.layers.publicSpace.items[0].location"]);
    assert.ok(run.stderr.includes("oplossing: node scripts/opkuis-historiek-privacy.mjs --write"), "de melding toont de weg vooruit");
    assert.equal(run.stderr.includes("27"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// De scan over ALLE bestanden onder site/history. Faalt zodra er een huisnummer of iets buiten het
// district in staat. De melding geeft alleen bestandsnamen en aantallen.
test("scan: geen huisnummer en niets buiten het district in site/history", () => {
  const dir = path.join(repoRoot, "site", "history");
  const bestanden = [];
  const loop = (target) => {
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      const volledig = path.join(target, entry.name);
      if (entry.isDirectory()) loop(volledig);
      else if (entry.name.endsWith(".json")) bestanden.push(volledig);
    }
  };
  if (fs.existsSync(dir)) loop(dir);
  assert.ok(bestanden.length > 0, "site/history bevat geen bestanden");
  const fouten = [];
  for (const file of bestanden.sort()) {
    const telling = {};
    for (const finding of historiekPrivacyBevindingen(JSON.parse(fs.readFileSync(file, "utf8")))) telling[finding.code] = (telling[finding.code] || 0) + 1;
    if (Object.keys(telling).length) fouten.push(`${path.relative(repoRoot, file)}: ${Object.entries(telling).map(([code, aantal]) => `${aantal}× ${code}`).join(", ")}`);
  }
  assert.deepEqual(fouten, [], `privacy in de historiek (draai node scripts/opkuis-historiek-privacy.mjs --write):\n${fouten.join("\n")}`);
});
