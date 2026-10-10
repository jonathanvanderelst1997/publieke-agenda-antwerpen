// A-Sign-lagen echt laden en eerlijk melden wat ontbreekt (herstelplan O1, O10). Alle data is verzonnen.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  ASIGN_BLOK, ASIGN_GELIJKTIJDIG, ASIGN_MAX_URL, asignDetailUrls, asignIdsUrl, asignLayer, maakBegrenzer,
} from "../site/asign-query.js";
import { mislukteOnderdelenPublicSpace, ontbrekendeOnderdelen, onvolledigMelding } from "../site/live-lagen.js";
import { adresZonderHuisnummer } from "../site/adres-privacy.js";

const IOD_VELDEN = "dossierNummer,faseId,innameId,dossierStatus,faseNaam,type_dossier,innameTypeNaam,innameBeschrijving,innameHinder,faseStartDatum,faseEindDatum";
const idsVan = (url) => String(new URL(url).searchParams.get("objectIds") || "").split(",").filter(Boolean).map(Number);

test("elke A-Sign-URL is korter dan 1.800 tekens bij 15.000 ids, in blokken van hoogstens 100", () => {
  const ids = Array.from({ length: 15000 }, (_, i) => 700000 + i * 7);
  const urls = asignDetailUrls(22, ids, { outFields: IOD_VELDEN, geometry: true });
  assert.equal(ASIGN_BLOK, 100);
  assert.equal(ASIGN_MAX_URL, 1800);
  assert.equal(urls.length, 150);
  for (const url of urls) {
    assert.ok(url.length < 1800, `${url.length} tekens`);
    assert.ok(idsVan(url).length <= 100);
  }
  assert.deepEqual(urls.flatMap(idsVan), ids, "elke id precies één keer, in volgorde");
  assert.ok(asignIdsUrl(20, { where: "Einddatum >= DATE '2026-10-09'" }).length < 1800);
});

test("een blok dat toch te lang is, wordt verder gesplitst tot het past", () => {
  const ids = Array.from({ length: 100 }, (_, i) => 1e15 + i);
  const urls = asignDetailUrls(49, ids, { outFields: IOD_VELDEN });
  assert.ok(urls.length > 1);
  assert.ok(urls.every((url) => url.length < 1800));
  assert.deepEqual(urls.flatMap(idsVan), ids);
});

// Een nagebootste stadsserver: 404 boven 2.000 tekens, met telling van gelijktijdige verzoeken.
function nepServer({ ids = {}, faal = () => false, wacht = 3 } = {}) {
  const stats = { verzoeken: 0, bezig: 0, maxBezig: 0, teLang: 0 };
  const fetch = async (url) => {
    stats.verzoeken += 1; stats.bezig += 1; stats.maxBezig = Math.max(stats.maxBezig, stats.bezig);
    try {
      await new Promise((r) => setTimeout(r, wacht));
      if (url.length > 2000) { stats.teLang += 1; return new Response("Not Found", { status: 404 }); }
      if (faal(url)) return new Response("fout", { status: 500 });
      const u = new URL(url), laag = Number(u.pathname.match(/\/(\d+)\/query$/)[1]);
      if (u.searchParams.get("returnIdsOnly") === "true") return Response.json({ objectIds: ids[laag] || [] });
      return Response.json({ features: idsVan(url).map((OBJECTID) => ({ attributes: { OBJECTID } })) });
    } finally { stats.bezig -= 1; }
  };
  return { stats, fetch };
}

test("asignLayer: alle records, nooit een te lange URL, hoogstens 4 verzoeken tegelijk over alle lagen samen", async () => {
  const ids = { 20: Array.from({ length: 5781 }, (_, i) => 700000 + i), 49: Array.from({ length: 2912 }, (_, i) => 1000 + i) };
  const server = nepServer({ ids });
  const begrenzer = maakBegrenzer(ASIGN_GELIJKTIJDIG);
  const [parkeren, terrassen] = await Promise.all([
    asignLayer(20, { outFields: "Dossiernummer,Locatienummer,Status,Adres,Reden,Startdatum,Einddatum" }, { fetch: server.fetch, begrenzer }),
    asignLayer(49, { outFields: "OBJECTID,ROLnet_ID,TypeTerrasZone,Status,adres,postcode", geometry: true, spatial: true }, { fetch: server.fetch, begrenzer }),
  ]);
  assert.equal(parkeren.length, 5781);
  assert.equal(terrassen.length, 2912);
  assert.equal(server.stats.teLang, 0);
  assert.ok(server.stats.maxBezig <= 4, `${server.stats.maxBezig} tegelijk`);
  assert.equal(server.stats.maxBezig, 4, "de begrenzer laat wel 4 tegelijk toe");
});

test("asignLayer: één mislukt blok laat de laag falen, en de wachtende blokken worden overgeslagen", async () => {
  const ids = { 20: Array.from({ length: 2000 }, (_, i) => 700000 + i) };
  const server = nepServer({ ids, faal: (url) => idsVan(url)[0] === 700100 });
  await assert.rejects(asignLayer(20, { outFields: "Adres" }, { fetch: server.fetch, begrenzer: maakBegrenzer(4) }), /HTTP 500/);
  assert.ok(server.stats.verzoeken < 21, `${server.stats.verzoeken} verzoeken na de fout`);
});

test("public-space-live, terraces-live en works-live halen A-Sign alleen via de gedeelde ophaler", () => {
  for (const file of ["public-space-live.js", "terraces-live.js", "works-live.js"]) {
    const bron = fs.readFileSync(new URL(`../site/${file}`, import.meta.url), "utf8");
    assert.match(bron, /from "\.\/asign-query\.js"/, file);
    assert.doesNotMatch(bron, /P_ASign/, `${file} bouwt zelf geen A-Sign-URL`);
    assert.doesNotMatch(bron, /i\+=500/, `${file} vraagt geen blokken van 500`);
    assert.match(bron, /meldLiveLaag\(/, `${file} meldt een mislukte laag`);
  }
});

test("melding: in gewone woorden welke lagen ontbreken, en dat het overzicht onvolledig is", () => {
  assert.equal(
    onvolledigMelding(ontbrekendeOnderdelen({ publicSpace: mislukteOnderdelenPublicSpace(["parking", "sgw47"]), terraces: ["terrassen"], works: [] })),
    "Parkeerverboden, omleidingen en terrassen konden nu niet geladen worden. Dit overzicht is onvolledig."
  );
  assert.equal(onvolledigMelding(["terrassen"]), "Terrassen konden nu niet geladen worden. Dit overzicht is onvolledig.");
  assert.equal(onvolledigMelding([]), "");
  // Zonder districtsgrens vallen innames, omleidingen en werfzones weg; zonder stratenlijst alles.
  assert.deepEqual(mislukteOnderdelenPublicSpace(["district"]), ["innames en parcours", "omleidingen", "werfzones"]);
  assert.deepEqual(mislukteOnderdelenPublicSpace(["streets", "iod23"]), ["parkeerverboden", "innames en parcours", "omleidingen", "werfzones"]);
  // Alleen voor soorten die aanstaan.
  const enabled = (laag) => laag !== "terraces";
  assert.deepEqual(ontbrekendeOnderdelen({ terraces: ["terrassen"], works: ["werken"] }, enabled), ["werken"]);
});

test("adres van een parkeerverbod: straat en postcode, nooit een huisnummer", () => {
  const voorbeelden = {
    "Teststraat 26-26 2000 Antwerpen": "Teststraat, 2000 Antwerpen",
    "proefstraat 34-36 2060 Antwerpen": "Proefstraat, 2060 Antwerpen",
    "Korte Proeflaan 17-hoek 2018 Antwerpen": "Korte Proeflaan, 2018 Antwerpen",
    "Proeflaan (2610) 34-hoek 2610 Antwerpen": "Proeflaan, 2610 Antwerpen",
    "Proefstraat hoek-64 2060 Antwerpen": "Proefstraat, 2060 Antwerpen",
    "Proeflei Onbekend-Onbekend 2150 Antwerpen": "Proeflei, 2150 Antwerpen",
    "Proeflaan hnr nvt-hnr nvt 2610 Wilrijk": "Proeflaan, 2610 Wilrijk",
    "Sint-Proefplein 12b-14 2060 Antwerpen": "Sint-Proefplein, 2060 Antwerpen",
    "Lange Proefstraat 12 bus 3-12 bus 3 2018 Antwerpen": "Lange Proefstraat, 2018 Antwerpen",
    "Hof van Sint-Proef 2000 Antwerpen": "Hof van Sint-Proef, 2000 Antwerpen",
    "12-14 2000 Antwerpen": "2000 Antwerpen",
    "Teststraat 1": "Teststraat",
  };
  for (const [in_, uit] of Object.entries(voorbeelden)) {
    assert.equal(adresZonderHuisnummer(in_), uit, in_);
    assert.equal(adresZonderHuisnummer(uit), uit, `tweede keer blijft gelijk: ${uit}`);
  }
});
