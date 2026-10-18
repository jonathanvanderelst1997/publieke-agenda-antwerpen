// Een leeg adres uit een oudere verversing (lib/kaart-uitleg-refresh.mjs, ADRES_REGEL): tot het besluit van 18 oktober 2026
// bewaarde de verversing alleen een reeks huisnummers uit het adressenregister, en "" als het register één nummer gaf. Zo'n
// leeg adres zonder versiemerk wordt één keer opnieuw gevraagd, binnen het budget en na de werken die nooit gevraagd werden;
// daarna draagt het het merk. Nakijkronde van head 1ed84e65. Een nep-fetch: geen netwerk, alles verzonnen.
import test from "node:test";
import assert from "node:assert/strict";

import { ADRES_REGEL, bouwKaartUitleg } from "../lib/kaart-uitleg-refresh.mjs";
import { werkFouten } from "../lib/kaart-uitleg-validatie.mjs";

const GIPOD_INNAME = "https://geo.api.vlaanderen.be/GIPOD/ogc/features/v1/collections/INNAME/items";
const CRAB = "https://geodata.antwerpen.be/arcgissql/rest/services/P_Publiek/CRAB_Adresposities_wgs84/MapServer/0/query";
const ZONE = { type: "Polygon", coordinates: [[[4.3999, 51.2199], [4.4001, 51.2199], [4.4001, 51.2201], [4.3999, 51.2201], [4.3999, 51.2199]]] };
// Het adressenregister geeft één nummer; de vragen worden geteld (welk werk, welke dienst).
function nepRegister(huisnr = "12") {
  const vragen = [];
  const fetch = async (input) => {
    const url = String(input);
    if (url.startsWith(GIPOD_INNAME)) { vragen.push(["werfzone", new URL(url).searchParams.get("filter")]); return Response.json({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: ZONE }] }); }
    if (url.startsWith(CRAB)) { vragen.push(["register"]); return Response.json({ features: [{ attributes: { STRAATNM: "Proefstraat", HUISNR: huisnr } }] }); }
    return new Response("", { status: 404 });
  };
  return { fetch, vragen };
}
const clock = () => new Date("2099-03-10T03:00:00Z");
const werk = (gipodId, lastModified = "2099-02-01T00:00:00Z") => ({
  gipodId, title: "2018 ANTWERPEN, AANSLUITING", status: "In uitvoering", start: "2099-03-01T06:00:00Z", end: "2099-03-30T16:00:00Z", lastModified,
  owner: "Fluvius System Operator", ownerGroup: "Fluvius", streets: [{ name: "Proefstraat" }], occupancyTypes: ["Elektriciteit"], workTypes: ["klantaansluiting"], hindrance: null,
}); // verzonnen
// De stand van vóór het besluit: het register gaf één nummer, de verversing bewaarde "" (alleen een reeks bleef).
const OUD = { bijgewerkt: "2099-02-01T00:00:00Z", adres: "", soort: "Nieuwe aansluiting op het elektriciteitsnet", soortBron: "soort inname en soort grondwerk in GIPOD", omschrijving: "", opdrachtgever: "Fluvius System Operator", straten: ["Proefstraat"], huisnummers: "", huisnummerBron: "", gevolgen: [], fasen: [] };

test("een leeg adres zonder merk telt één keer als niet klaar: opnieuw gevraagd, met het ene nummer en het merk", async () => {
  const works = [werk(990904), werk(990905)];
  const reg = nepRegister("12");
  const { document, stats } = await bouwKaartUitleg({ works, vorige: { werken: { 990904: OUD, 990905: OUD } }, fetch: reg.fetch, clock });
  assert.equal(reg.vragen.filter(([dienst]) => dienst === "register").length, 2);
  assert.equal(stats.adresOpgezocht, 2);
  for (const id of ["990904", "990905"]) {
    assert.equal(document.werken[id].adres, "nr. 12", id);
    assert.equal(document.werken[id].adresRegel, ADRES_REGEL, id);
    assert.equal(document.werken[id].huisnummers, "nr. 12", id);
    assert.equal(document.werken[id].huisnummerBron, "afgeleid uit de werfzone en het adressenregister", id);
    assert.deepEqual(werkFouten(id, document.werken[id]), [], id);
  }
  // Daarna is het klaar: een volgende verversing vraagt niets meer, en het merk blijft.
  const nog = nepRegister();
  const daarna = await bouwKaartUitleg({ works, vorige: document, fetch: nog.fetch, clock });
  assert.deepEqual(nog.vragen, []);
  assert.equal(daarna.document.werken["990904"].adresRegel, ADRES_REGEL);
  assert.equal(daarna.document.werken["990904"].adres, "nr. 12");
});

test("het budget spreidt het opnieuw vragen over de verversingen; een overgeslagen leeg adres blijft zonder merk", async () => {
  const works = [werk(990904), werk(990905)];
  // Geen tijd: niets gevraagd, de lege adressen blijven (zonder merk) en tellen als overgeslagen.
  const leeg = nepRegister();
  const eerst = await bouwKaartUitleg({ works, vorige: { werken: { 990904: OUD, 990905: OUD } }, fetch: leeg.fetch, clock, budgetMs: 0 });
  assert.deepEqual(leeg.vragen, []);
  assert.equal(eerst.stats.adresOvergeslagen, 2);
  assert.equal(eerst.document.werken["990904"].adres, "");
  assert.equal("adresRegel" in eerst.document.werken["990904"], false);
  // Tijd voor één werk (de klok loopt bij elke vraag): dat werk krijgt zijn nummer, het andere komt de volgende keer.
  let t = 0;
  const een = nepRegister("14");
  const tweede = await bouwKaartUitleg({ works, vorige: eerst.document, fetch: een.fetch, clock, budgetMs: 2, now: () => t++ });
  const gedaan = ["990904", "990905"].filter((id) => tweede.document.werken[id].adresRegel === ADRES_REGEL);
  assert.equal(gedaan.length, 1);
  assert.equal(tweede.stats.adresOvergeslagen, 1);
  const rest = await bouwKaartUitleg({ works, vorige: tweede.document, fetch: nepRegister("14").fetch, clock });
  for (const id of ["990904", "990905"]) assert.equal(rest.document.werken[id].adres, "nr. 14", id);
  // Een werk dat nog nooit gevraagd werd, gaat voor op een leeg adres dat opnieuw moet.
  const volgorde = nepRegister();
  let k = 0;
  await bouwKaartUitleg({ works: [werk(990904), werk(990999)], vorige: { werken: { 990904: OUD } }, fetch: volgorde.fetch, clock, budgetMs: 2, now: () => k++ });
  assert.deepEqual(volgorde.vragen[0], ["werfzone", "GipodId=990999"]);
});

test("klaar zonder opnieuw te vragen: een leeg adres met het merk, een bewaarde reeks, een werk zonder straat", async () => {
  const works = [werk(990904), werk(990905), { ...werk(990906), streets: [] }];
  const vorige = { werken: { 990904: { ...OUD, adresRegel: ADRES_REGEL }, 990905: { ...OUD, adres: "nr. 12–14" }, 990906: { ...OUD, straten: [] } } };
  const reg = nepRegister();
  const { document } = await bouwKaartUitleg({ works, vorige, fetch: reg.fetch, clock });
  assert.deepEqual(reg.vragen, []);
  assert.equal(document.werken["990904"].adresRegel, ADRES_REGEL, "het merk blijft");
  assert.equal("adresRegel" in document.werken["990905"], false, "een oude reeks is klaar zonder merk");
  // Wijzigt GIPOD het werk, dan wordt het opnieuw gevraagd, zoals altijd.
  const gewijzigd = nepRegister();
  await bouwKaartUitleg({ works: [werk(990904, "2099-03-01T00:00:00Z")], vorige, fetch: gewijzigd.fetch, clock });
  assert.equal(gewijzigd.vragen.filter(([dienst]) => dienst === "register").length, 1);
  // De validatie kent het merk.
  assert.deepEqual(werkFouten("990904", { ...OUD, adresRegel: "2" }), ["werken.990904.adresRegel ongeldig"]);
});
