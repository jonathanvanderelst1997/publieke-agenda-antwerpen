// De link naar A-Sign bij een evenement ("Technische gegevens van de stad", iodBronUrl in site/place-core.js) vraagt alleen
// velden uit een gesloten lijst: nooit innameBeschrijving (vrije tekst van de aanvrager), dossierBeheerder of outFields=*.
// Een vraag naar A-Sign uit de browser (site/asign-query.js) noemt haar velden altijd met naam. Geen enkel gegenereerd
// bestand in site/ bevat een link met een veldenlijst. De eerste twee toetsen falen op head fe8eb62 (de link vroeg
// innameBeschrijving, en een vraag zonder velden vroeg outFields=*) en slagen nu. Verzonnen dossiernummer; geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as PC from "../site/place-core.js";
import { asignDetailUrls, asignLayer, maakBegrenzer } from "../site/asign-query.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOEGELATEN = ["dossierNummer", "dossierStatus", "faseNaam", "faseStartDatum", "faseEindDatum", "innameTypeNaam", "innameHinder", "type_dossier"];

test("bronlink A-Sign: alleen velden van een gesloten lijst, nooit innameBeschrijving, dossierBeheerder of *", () => {
  const url = new URL(PC.iodBronUrl("ET2099000001"));
  assert.equal(url.hostname, "geodata.antwerpen.be");
  assert.match(url.pathname, /\/P_ASign\/ASign\/MapServer\/22\/query$/);
  const velden = url.searchParams.get("outFields").split(",");
  assert.ok(velden.length > 0);
  for (const veld of velden) assert.ok(TOEGELATEN.includes(veld), `${veld} staat niet in de toegelaten lijst`);
  assert.deepEqual([...(PC.IOD_BRON_VELDEN || [])], TOEGELATEN);
  assert.doesNotMatch(url.href, /innameBeschrijving|dossierBeheerder|outFields=\*|\*/i);
  assert.equal(url.searchParams.get("returnGeometry"), "false");
  // Een dossiernummer met iets anders dan letters, cijfers en een streepje geeft geen link.
  assert.equal(PC.iodBronUrl("ET2099' OR 1=1"), "");
});

test("vraag naar A-Sign: zonder velden, met * of met dossierBeheerder wordt geweigerd; met naam gaat ze door", async () => {
  assert.throws(() => asignDetailUrls(22, [1, 2, 3]), /outFields/);
  assert.throws(() => asignDetailUrls(22, [1], { outFields: "*" }), /outFields/);
  assert.throws(() => asignDetailUrls(22, [1], { outFields: "dossierNummer, *" }), /outFields/);
  assert.throws(() => asignDetailUrls(22, [1], { outFields: "dossierNummer,dossierBeheerder" }), /dossierBeheerder/);
  assert.throws(() => asignDetailUrls(22, [1], { outFields: "DOSSIERBEHEERDER" }), /DOSSIERBEHEERDER/);
  assert.throws(() => asignDetailUrls(22, [1], { outFields: "dossierNummer,Beheerder" }), /Beheerder/);
  const [href] = asignDetailUrls(22, [1, 2], { outFields: "dossierNummer,faseNaam" });
  assert.equal(new URL(href).searchParams.get("outFields"), "dossierNummer,faseNaam");
  // asignLayer weigert al vóór het eerste verzoek.
  let verzoeken = 0;
  const fetch = async () => { verzoeken += 1; return { ok: true, json: async () => ({ objectIds: [] }) }; };
  await assert.rejects(asignLayer(22, {}, { fetch, begrenzer: maakBegrenzer(1) }), /outFields/);
  assert.equal(verzoeken, 0);
});

// Alle bestanden die de verversing maakt (de bronbestanden, de feed, de eventpagina's en hun .ics, de straatbestanden, de
// historiek): geen enkele link met een veldenlijst of met een van de vrije of persoonlijke velden.
function* bestanden(dir) {
  for (const naam of fs.readdirSync(dir, { withFileTypes: true })) {
    const vol = path.join(dir, naam.name);
    if (naam.isDirectory()) yield* bestanden(vol);
    else if (/\.(?:json|html|ics|xml|txt|geojson)$/i.test(naam.name) || vol === path.join(repoRoot, "site", "agenda-feed.js")) yield vol;
  }
}
test("gegenereerde bestanden: geen link met outFields, innameBeschrijving, dossierBeheerder of faseNaam", () => {
  const LINK = /https?:\/\/[^\s"'<>\\]+/g;
  const VERBODEN = /outFields|innameBeschrijving|dossierBeheerder|faseNaam/i;
  let gelezen = 0, links = 0;
  const treffers = [];
  for (const bestand of bestanden(path.join(repoRoot, "site"))) {
    gelezen += 1;
    const tekst = fs.readFileSync(bestand, "utf8");
    for (const [link] of tekst.matchAll(LINK)) {
      links += 1;
      let ontleed = link;
      try { ontleed = decodeURIComponent(link); } catch { /* zoals hij staat */ }
      if (VERBODEN.test(ontleed)) treffers.push(`${path.relative(repoRoot, bestand)}: ${link.slice(0, 160)}`);
    }
  }
  assert.ok(gelezen > 100, `${gelezen} bestanden`);
  assert.ok(links > 100, `${links} links`);
  assert.deepEqual(treffers, []);
  // De feed: geen sourceUrl, link of infoUrl met een veldenlijst.
  const feed = fs.readFileSync(path.join(repoRoot, "site", "agenda-feed.js"), "utf8");
  for (const [, sleutel, waarde] of feed.matchAll(/"(sourceUrl|link|infoUrl|url)"\s*:\s*"([^"]*)"/g)) assert.doesNotMatch(waarde, VERBODEN, `${sleutel}: ${waarde}`);
});
