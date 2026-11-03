// Regel van de eigenaar (26-10-2026): bij een activiteit altijd het exacte adres, met huisnummer. eBesluit noemt de zaal
// van de districtsraad alleen bij naam ("Provinciehuis Antwerpen"); lib/vaste-adressen.mjs zet het officiële adres uit
// site/sources/vaste-adressen.json erachter. De adressen staan alleen in dat databestand: deze toets leest ze daar en
// schrijft er zelf geen (een echte straat krijgt in een toets alleen huisnummer 999, lib/echte-adressen.mjs).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { sourceDocument } from "../lib/source-feed.mjs";
import { VASTE_ADRESSEN_FILE, itemMetVastAdres, metVastAdres, validateVasteAdressen } from "../lib/vaste-adressen.mjs";
import { buildFeed } from "../scripts/build-sources.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const doc = JSON.parse(fs.readFileSync(path.join(rootDir, "site", "sources", VASTE_ADRESSEN_FILE), "utf8"));
const plek = (naam) => doc.plekken.find((p) => p.naam === naam);

test("het databestand is geldig: elke plek een adres met huisnummer en postcode, en de officiële bronpagina", () => {
  assert.deepEqual(validateVasteAdressen(doc), []);
  for (const p of doc.plekken) assert.match(p.adres, /^[^,\d]+ \d+[a-z]?, \d{4} /i, p.naam);
  assert.ok(plek("Provinciehuis Antwerpen"), "de zaal van de districtsraad");
  assert.ok(plek("Districtshuis Antwerpen-Harmonie"), "de zaal van de raadscommissies");
  // De validatie weigert een adres zonder huisnummer, een bron met query en een onbekende sleutel.
  const fout = { ...doc, plekken: [{ naam: "X", herken: ["Verzonnen zaal"], adres: "Verzonnenstraat, 2000 Antwerpen", bron: "https://www.voorbeeld.be/?a=1", extra: 1 }] };
  assert.equal(validateVasteAdressen(fout).length, 3);
});

test("de locatie zoals eBesluit ze schrijft, krijgt het officiële adres erachter", () => {
  const provinciehuis = plek("Provinciehuis Antwerpen").adres;
  const districtshuis = plek("Districtshuis Antwerpen-Harmonie").adres;
  assert.equal(metVastAdres("Provinciehuis Antwerpen", doc), `Provinciehuis Antwerpen, ${provinciehuis}`);
  assert.equal(metVastAdres("Districtshuis Antwerpen - Zaal Benoit", doc), `Districtshuis Antwerpen - Zaal Benoit, ${districtshuis}`);
  assert.equal(metVastAdres("Districtshuis Antwerpen - zaal Benoit", doc), `Districtshuis Antwerpen - zaal Benoit, ${districtshuis}`);
  assert.equal(metVastAdres("provinciehuis antwerpen ", doc), `provinciehuis antwerpen, ${provinciehuis}`, "hoofdletters en witruimte maken niet uit");
  // Al een huisnummer, een andere plek, een plek die alleen zo begint of leeg: ongewijzigd.
  assert.equal(metVastAdres("Districtshuis Antwerpen, Verzonnenstraat 999", doc), "Districtshuis Antwerpen, Verzonnenstraat 999");
  assert.equal(metVastAdres("Grote Markt", doc), "Grote Markt");
  assert.equal(metVastAdres("Districtshuis Berchem", doc), "Districtshuis Berchem", "een ander districtshuis");
  assert.equal(metVastAdres("Provinciehuisstraat", doc), "Provinciehuisstraat");
  assert.equal(metVastAdres("", doc), "");
  assert.equal(metVastAdres("Provinciehuis Antwerpen", null), "Provinciehuis Antwerpen", "zonder bestand: ongewijzigd");
  const item = { id: "x", location: "Grote Markt" };
  assert.equal(itemMetVastAdres(item, doc), item, "ongewijzigd item: hetzelfde object");
});

test("build:sources: een raadszitting uit eBesluit staat in de feed met het adres van de zaal", () => {
  const zitting = {
    id: "district-vergadering-ebesluit-proef",
    title: "Districtsraad Antwerpen",
    theme: "Vergadering",
    className: "meeting",
    date: "2026-11-16",
    endDate: null,
    timeSlot: "20:00",
    timeText: "20 uur",
    location: "Provinciehuis Antwerpen",
    postcodes: ["2018"],
    info: "",
    kind: "meeting",
    sourceUrl: "https://ebesluit.antwerpen.be/zittingen/proef",
    retrievedAt: "2026-11-03T04:19:43.965Z",
  };
  const documents = [sourceDocument("district-vergaderingen", { retrievedAt: zitting.retrievedAt, fetchStatus: "ok", items: [zitting] })];
  const status = { schemaVersion: 1, generatedAt: "2026-11-03T04:24:42.087Z", classificationAsOf: "2026-11-03", sources: [] };
  const zonder = buildFeed({ status, documents }, []).feed.items[0];
  assert.equal(zonder.location, "Provinciehuis Antwerpen", "zonder het databestand: zoals de bron");
  const met = buildFeed({ status, documents, vasteAdressen: doc }, []).feed.items[0];
  assert.equal(met.location, `Provinciehuis Antwerpen, ${plek("Provinciehuis Antwerpen").adres}`);
});

test("de gebouwde feed noemt geen vaste plek meer zonder huisnummer", () => {
  const tekst = fs.readFileSync(path.join(rootDir, "site", "agenda-feed.js"), "utf8");
  const feed = JSON.parse(tekst.slice(tekst.indexOf("=") + 1).trim().replace(/;$/, ""));
  for (const item of feed.items) {
    if (!item.location) continue;
    assert.equal(metVastAdres(item.location, doc), item.location, `${item.id}: ${item.location}`);
  }
});
