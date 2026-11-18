// Nieuwe werven deze week (lib/werven-nieuw.mjs, site/werven-nieuw.js): gevraagd in de raadscommissie van 17 november
// 2026, elke week een overzicht van alle nieuwe werven. Verzonnen werken, geen echte GIPOD-gegevens.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ruwGipodRecord, GIPOD_METADATA_URL } from "../site/gipod-bron.js";
import { WERVEN_NIEUW_FILE, berekenWervenNieuw, eersteKeerGezien, schrijfWervenNieuw, validateWervenNieuw } from "../lib/werven-nieuw.mjs";
import { periodeTekst, wervenNieuwHtml } from "../site/werven-nieuw.js";

const werk = (gipodId, { start = "2026-12-01T07:00:00Z", end = "2026-12-05T16:00:00Z", straat = "Proefstraat", titel } = {}) => ({
  id: `work:${gipodId}`, gipodId, title: titel ?? `2000 Antwerpen ${straat} 12 werken distributieleiding`, status: "Concreet gepland",
  start, end, owner: "Voorbeeld nv", ownerGroup: "Andere", streets: [{ id: "1", name: straat, postcode: "2000" }],
});
const dag = (date, events) => ({ schemaVersion: 1, date, events });
const bij = (date, item) => ({ observedAt: `${date}T04:20:00.000Z`, layer: "works", id: item.id, type: "added", fields: [], before: null, after: item });
const weg = (date, item) => ({ observedAt: `${date}T04:20:00.000Z`, layer: "works", id: item.id, type: "removed", fields: [], before: item, after: null });

const OUD = werk(100, { straat: "Oudestraat" });
const TERUG = werk(200, { straat: "Terugkeerstraat" });
const NIEUW = werk(300, { straat: "Nieuwstraat", start: "2026-11-20T07:00:00Z" });
const BEGINT = werk(400, { straat: "Startlaan", start: "2026-11-16T06:00:00Z" });
const VOORBIJ = werk(500, { straat: "Wegstraat" });
const baseline = { schemaVersion: 1, layers: { works: { observedAt: "2026-10-01T11:42:02.040Z", items: [OUD, TERUG] } } };
const dagen = [
  dag("2026-11-02", [bij("2026-11-02", BEGINT)]),
  dag("2026-11-10", [weg("2026-11-10", TERUG)]),
  dag("2026-11-13", [bij("2026-11-13", TERUG), bij("2026-11-13", NIEUW), bij("2026-11-13", VOORBIJ)]),
];
const NU = "2026-11-17T04:23:10.614Z";

test("eersteKeerGezien: de vroegste dag per GIPOD-nummer; terugkomen telt niet", () => {
  const eerste = eersteKeerGezien({ baseline, dagen });
  assert.equal(eerste.get(100), "2026-10-01");
  assert.equal(eerste.get(200), "2026-10-01", "verdween op 10-11 en kwam terug op 13-11: niet nieuw");
  assert.equal(eerste.get(300), "2026-11-13");
  assert.equal(eerste.get(400), "2026-11-02");
});

test("het overzicht: nieuw deze zeven dagen, en wat deze week begint en al eerder aangekondigd was", () => {
  const doc = berekenWervenNieuw({ huidige: [OUD, TERUG, NIEUW, BEGINT], eersteKeer: eersteKeerGezien({ baseline, dagen }), observedAt: NU });
  assert.equal(doc.van, "2026-11-11");
  assert.equal(doc.tot, "2026-11-17");
  assert.deepEqual(doc.nieuw.map((w) => w.id), ["work:300"], "VOORBIJ staat niet meer in GIPOD; TERUG is niet nieuw");
  assert.deepEqual(doc.begint.map((w) => w.id), ["work:400"]);
  assert.equal(doc.aantalNieuw, 1);
  assert.equal(doc.aantalBegint, 1);
  assert.deepEqual(doc.nieuw[0].straten, ["Nieuwstraat 12"], "de straat met het huisnummer");
  assert.equal(doc.nieuw[0].eersteKeer, "2026-11-13");
  assert.equal(doc.bron.url, GIPOD_METADATA_URL);
  assert.deepEqual(validateWervenNieuw(doc), []);
  const tekst = JSON.stringify(doc);
  assert.doesNotMatch(tekst, /Voorbeeld nv|"owner"|ownerGroup/, "nooit de opdrachtgever");
});

test("validateWervenNieuw: geen link in een werf, geen onbekende velden", () => {
  const doc = berekenWervenNieuw({ huidige: [NIEUW], eersteKeer: new Map([[300, "2026-11-13"]]), observedAt: NU });
  assert.deepEqual(validateWervenNieuw({ ...doc, nieuw: [{ ...doc.nieuw[0], titel: "zie https://gipod.api.vlaanderen.be/api/v1/works/300" }] }), ["nieuw[0] bevat een link"]);
  assert.deepEqual(validateWervenNieuw({ ...doc, nieuw: [{ ...doc.nieuw[0], owner: "x" }] }), ["nieuw[0] onbekende sleutel owner"]);
  assert.deepEqual(validateWervenNieuw({ ...doc, extra: 1 }), ["onbekende sleutel extra"]);
});

test("het blok op de site: ontsnapt, met de datasetfiche als enige link en nooit een ruw record", () => {
  const vals = werk(300, { straat: "Nieuwstraat", start: "2026-11-20T07:00:00Z", titel: "<img src=x onerror=alert(1)>" });
  const doc = berekenWervenNieuw({ huidige: [vals, BEGINT], eersteKeer: new Map([[300, "2026-11-13"], [400, "2026-11-02"]]), observedAt: NU });
  const html = wervenNieuwHtml(doc);
  assert.match(html, /Nieuwe werven deze week/);
  assert.match(html, /Nieuw aangekondigd <span class="werven-nieuw-aantal">1<\/span>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img/);
  const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(links, [GIPOD_METADATA_URL]);
  assert.ok(links.every((link) => !ruwGipodRecord(link)));
  assert.equal(wervenNieuwHtml(null), "");
});

test("periodeTekst: begin en einde in Brussel, het jaar alleen als het einde in een ander jaar valt", () => {
  assert.equal(periodeTekst("2026-11-16T06:00:00Z", "2026-11-20T16:00:00Z"), "van ma 16 nov tot vr 20 nov");
  assert.equal(periodeTekst("2026-11-09T23:00:00Z", "2027-01-31T22:59:00Z"), "van di 10 nov tot 31 jan 2027");
  assert.equal(periodeTekst("", ""), "periode niet gepubliceerd");
});

test("schrijfWervenNieuw: uit het archief op schijf; zonder werkenlaag blijft het vorige bestand staan", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "werven-nieuw-"));
  const archief = path.join(root, "site", "history", "archive");
  fs.mkdirSync(archief, { recursive: true });
  fs.writeFileSync(path.join(archief, "baseline.json"), JSON.stringify(baseline));
  for (const d of dagen) fs.writeFileSync(path.join(archief, `${d.date}.json`), JSON.stringify(d));
  fs.writeFileSync(path.join(archief, "index.json"), JSON.stringify({ schemaVersion: 1 }));
  const uit = schrijfWervenNieuw({ rootDir: root, observedAt: NU, worksLayer: { status: "ok", items: [OUD, TERUG, NIEUW, BEGINT] } });
  assert.deepEqual(uit, { geschreven: true, nieuw: 1, begint: 1 });
  const bestand = path.join(root, "site", "sources", WERVEN_NIEUW_FILE);
  const doc = JSON.parse(fs.readFileSync(bestand, "utf8"));
  assert.deepEqual(validateWervenNieuw(doc), []);
  assert.deepEqual(schrijfWervenNieuw({ rootDir: root, observedAt: NU, worksLayer: { status: "error", items: [] } }), { geschreven: false, reden: "werkenlaag niet geladen" });
  assert.equal(JSON.parse(fs.readFileSync(bestand, "utf8")).observedAt, NU, "het vorige bestand blijft");
});
