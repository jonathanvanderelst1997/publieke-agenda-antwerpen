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
import { VASTE_ADRESSEN_FILE, heeftHuisnummer, itemMetVastAdres, metVastAdres, ontbrekendeHuisnummers, plaatsKennis, plaatsSoort, validateVasteAdressen } from "../lib/vaste-adressen.mjs";
import { huisnummerMeldingen } from "../scripts/sources-health.mjs";
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

// 4-11-2026: "always the exact house number", en een activiteit wordt daarvoor nooit tegengehouden.

const leesGeo = (naam) => JSON.parse(fs.readFileSync(path.join(rootDir, "site", "geo", naam), "utf8"));
const kennis = plaatsKennis({ straten: leesGeo("straten.json"), stratenStad: leesGeo("straten-stad.json"), wijken: leesGeo("wijken.geo.json") });

test("een lezing zonder huisnummer krijgt het nummer uit de lijst, zonder straat of gemeente dubbel", () => {
  const waterman = plek("De Groene Waterman");
  assert.ok(waterman, "De Groene Waterman staat in de lijst (inspraakmoment van 3-11-2026, lezing van 22-10)");
  const straat = waterman.adres.split(",")[0].replace(/\s+\d.*$/, "");
  const [, postcodeEnGemeente] = waterman.adres.split(", ");
  // Zoals district-projecten het op 22-10 las (vóór de huisnummerregel van #218): straat zonder nummer.
  const oud = `De Groene Waterman, ${straat}, ${postcodeEnGemeente}.`;
  assert.equal(heeftHuisnummer(oud), false);
  assert.equal(metVastAdres(oud, doc), `De Groene Waterman, ${waterman.adres}`);
  assert.equal(heeftHuisnummer(metVastAdres(oud, doc)), true);
  // Een opmerking of district na de naam valt weg; een eigen deel (een zaal) blijft.
  const permeke = plek("Bibliotheek Permeke").adres;
  assert.equal(metVastAdres("Bib Permeke (plaats volgens het bericht)", doc), `Bib Permeke (plaats volgens het bericht), ${permeke}`);
  assert.equal(metVastAdres("Bib Permeke, District Antwerpen", doc), `Bib Permeke, ${permeke}`);
  assert.equal(metVastAdres("Bibliotheek Permeke, zaal Proef", doc), `Bibliotheek Permeke, zaal Proef, ${permeke}`);
});

test("plaatsSoort: een gebouw zonder huisnummer, of openbare ruimte (straat, plein, markt, park, buurt)", () => {
  const soort = (location) => plaatsSoort(location, kennis);
  for (const gebouw of ["Sporthal Proef, District Merksem (plaats volgens het bericht)", "Zaal Proef", "Waagnatie, Rijnkaai", "Ontmoetingscentrum Proef, 2060 Antwerpen"]) {
    assert.equal(soort(gebouw), "gebouw", gebouw);
  }
  for (const openbaar of ["Grote Markt", "Sint-Jansplein, 2060 Antwerpen", "Park Gravenhof, District Hoboken (plaats volgens het bericht)", "Meir", "Bist, 2610 Wilrijk",
    "Toeristisch centrum Antwerpen", "Seefhoek, 2060 Antwerpen", "Eilandje", "Halenstraat (kant Stuivenbergplein), 2060 Antwerpen",
    "Tussen kruispunt met de Lange Van Ruusbroecstraat en Arendstraat, 2018 Antwerpen", "Van Maerlantstraat + Vondelstraat, 2060 Antwerpen",
    "Gildekamersstraat, Grote Markt en Ernest Van Dijckkaai", "Speelweefselplan Binnenstad, 2000 Antwerpen"]) {
    assert.equal(soort(openbaar), "openbare_ruimte", openbaar);
  }
  for (const onbekend of ["District Borgerhout, locatie via de officiële bron", "", "district Antwerpen, locatie via de officiële bron"]) {
    assert.equal(soort(onbekend), "onbekend", onbekend);
  }
  assert.equal(soort("Verzonnenstraat 999, 2000 Antwerpen"), "huisnummer");
  assert.equal(soort(`Provinciehuis Antwerpen, ${plek("Provinciehuis Antwerpen").adres}`), "huisnummer");
});

test("ontbrekendeHuisnummers: alleen komende activiteiten in een gebouw zonder nummer, na het aanvullen uit de lijst", () => {
  const items = [
    { id: "a", date: "2026-11-18", title: "Fun Games", location: "Sporthal Proef, District Merksem (plaats volgens het bericht)", sourceId: "stad-districten" },
    { id: "b", date: "2026-11-03", title: "Inspraak", location: "De Groene Waterman, Wolstraat, 2000 Antwerpen.", sourceId: "district-projecten" },
    { id: "c", date: "2026-11-20", title: "Lezing", location: "Bib Permeke", sourceId: "district-kalender" },
    { id: "d", date: "2026-11-01", endDate: "2026-11-30", title: "Expo", location: "Zaal Proef", sourceId: "district-kalender" },
    { id: "e", date: "2026-11-02", title: "Voorbij", location: "Zaal Proef", sourceId: "district-kalender" },
    { id: "f", date: "2026-11-19", title: "Markt", location: "Sint-Jansplein, 2060 Antwerpen", sourceId: "stad-markten" },
    { id: "a", date: "2026-11-18", title: "Fun Games", location: "Sporthal Proef", sourceId: "stad-districten" },
  ];
  const lijst = ontbrekendeHuisnummers(items, "2026-11-04", { vasteAdressen: doc, kennis });
  // De Groene Waterman en Permeke krijgen hun nummer uit de lijst; de markt is openbare ruimte; "e" is voorbij.
  assert.deepEqual(lijst.map((item) => item.id), ["d", "a"]);
  assert.equal(lijst[1].location, "Sporthal Proef, District Merksem (plaats volgens het bericht)");
});

test("sources:health: één regel per activiteit, zonder tijdstip, uit de gebouwde feed (geen fout)", () => {
  const regels = huisnummerMeldingen(rootDir, "2026-11-04");
  for (const regel of regels) assert.match(regel, /^Huisnummer ontbreekt: \d{2}-\d{2}-\d{4}, .+: .+ \(.+\)$/);
  assert.deepEqual(regels, huisnummerMeldingen(rootDir, "2026-11-04"), "dezelfde toestand, dezelfde regels");
  // Zonder gebouwde feed: geen regels, geen fout.
  assert.deepEqual(huisnummerMeldingen(path.join(rootDir, "bestaat-niet"), "2026-11-04"), []);
});
