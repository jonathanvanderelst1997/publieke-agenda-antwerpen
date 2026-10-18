// Het versiemerk van een werk in kaart-uitleg.json (lib/kaart-uitleg-refresh.mjs, ADRES_REGEL). Een werk dat de verversing nu
// voor het eerst bewaart, krijgt het merk, ook zonder opzoeking, en zijn exacte adres uit het adressenregister. Een bewaard
// werk zonder merk is van vóór de overgang (main publiceerde het al): het wordt niet onthullender. Een leeg adres wordt niet
// opnieuw gevraagd, het register geeft er alleen een reeks, en bij één adres (een aansluiting, een container, een lift) wordt
// het niet opgezocht (nakijkronde van head c4bb2927: zo kreeg een werk dat main als verhuis toonde, na de overgang zijn
// huisnummer onder hetzelfde id). Een nep-fetch: geen netwerk, alles verzonnen.
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

test("een werk van vóór de overgang (zonder merk) wordt niet opnieuw gevraagd: het lege adres blijft, zonder merk", async () => {
  const works = [werk(990904), werk(990905)];
  const reg = nepRegister("12");
  const { document, stats } = await bouwKaartUitleg({ works, vorige: { werken: { 990904: OUD, 990905: { ...OUD, soort: "Bouwwerf", soortBron: "omschrijving van de beheerder" } } }, fetch: reg.fetch, clock });
  assert.deepEqual(reg.vragen.filter(([dienst]) => dienst === "register"), []);
  assert.equal(stats.adresOpgezocht, 0);
  for (const id of ["990904", "990905"]) {
    assert.equal(document.werken[id].adres, "", id);
    assert.equal(document.werken[id].huisnummers, "", id);
    assert.equal("adresRegel" in document.werken[id], false, id);
    assert.deepEqual(werkFouten(id, document.werken[id]), [], id);
  }
  // Wijzigt GIPOD het werk: een aansluiting wordt niet opgezocht (zoals toen), een ander werk wel, maar één nummer blijft weg
  // (alleen een reeks, zoals toen); het merk komt er nooit bij.
  const gewijzigd = nepRegister("12");
  const daarna = await bouwKaartUitleg({ works: [werk(990904, "2099-03-05T00:00:00Z"), { ...werk(990905, "2099-03-05T00:00:00Z"), occupancyTypes: [], workTypes: [], title: "Bouwwerf Proefhof" }], vorige: document, fetch: gewijzigd.fetch, clock }); // verzonnen
  assert.deepEqual(gewijzigd.vragen.filter(([dienst]) => dienst === "register"), [["register"]]);
  assert.equal(daarna.document.werken["990904"].huisnummers, "");
  assert.equal(daarna.document.werken["990905"].huisnummers, "");
  assert.equal(daarna.document.werken["990905"].adres, "");
  for (const id of ["990904", "990905"]) assert.equal("adresRegel" in daarna.document.werken[id], false, id);
});

test("een nieuw werk krijgt het merk, ook zonder opzoeking; het budget spreidt de opzoekingen over de verversingen", async () => {
  const works = [werk(990904), werk(990905)];
  // Geen tijd: niets gevraagd, de werken krijgen het merk en tellen als overgeslagen.
  const leeg = nepRegister();
  const eerst = await bouwKaartUitleg({ works, fetch: leeg.fetch, clock, budgetMs: 0 });
  assert.deepEqual(leeg.vragen, []);
  assert.equal(eerst.stats.adresOvergeslagen, 2);
  assert.equal("adres" in eerst.document.werken["990904"], false);
  assert.equal(eerst.document.werken["990904"].adresRegel, ADRES_REGEL);
  // Tijd voor één werk (de klok loopt bij elke vraag): dat werk krijgt zijn nummer, het andere komt de volgende keer.
  let t = 0;
  const een = nepRegister("14");
  const tweede = await bouwKaartUitleg({ works, vorige: eerst.document, fetch: een.fetch, clock, budgetMs: 2, now: () => t++ });
  const gedaan = ["990904", "990905"].filter((id) => tweede.document.werken[id].adres === "nr. 14");
  assert.equal(gedaan.length, 1);
  assert.equal(tweede.stats.adresOvergeslagen, 1);
  const rest = await bouwKaartUitleg({ works, vorige: tweede.document, fetch: nepRegister("14").fetch, clock });
  for (const id of ["990904", "990905"]) {
    assert.equal(rest.document.werken[id].adres, "nr. 14", id);
    assert.equal(rest.document.werken[id].huisnummers, "nr. 14", id);
    assert.equal(rest.document.werken[id].adresRegel, ADRES_REGEL, id);
  }
});

test("klaar zonder opnieuw te vragen: een adres met het merk, een bewaarde reeks, een werk zonder straat", async () => {
  const works = [werk(990904), werk(990905), { ...werk(990906), streets: [] }];
  const vorige = { werken: { 990904: { ...OUD, adres: "nr. 12", adresRegel: ADRES_REGEL }, 990905: { ...OUD, soort: "Bouwwerf", adres: "nr. 12–14" }, 990906: { ...OUD, straten: [] } } };
  const reg = nepRegister();
  const { document } = await bouwKaartUitleg({ works, vorige, fetch: reg.fetch, clock });
  assert.deepEqual(reg.vragen, []);
  assert.equal(document.werken["990904"].adresRegel, ADRES_REGEL, "het merk blijft");
  assert.equal(document.werken["990904"].huisnummers, "nr. 12");
  assert.equal("adresRegel" in document.werken["990905"], false, "een oude reeks is klaar zonder merk");
  // Wijzigt GIPOD een werk met het merk, dan wordt het opnieuw gevraagd, zoals altijd.
  const gewijzigd = nepRegister();
  await bouwKaartUitleg({ works: [werk(990904, "2099-03-01T00:00:00Z")], vorige, fetch: gewijzigd.fetch, clock });
  assert.equal(gewijzigd.vragen.filter(([dienst]) => dienst === "register").length, 1);
  // De validatie kent het merk.
  assert.deepEqual(werkFouten("990904", { ...OUD, adresRegel: "2" }), ["werken.990904.adresRegel ongeldig"]);
});
