// Vergunningen: de kaart zegt in gewone taal wat er gebeurt (herstelplan O4). Vaste labels met
// woordgrenzen, aantallen uit de bron, publieke projecten alleen bij de Vlaamse Regering of de
// Deputatie, de stand uit Volledig/Ontvankelijk, één statusregel, "Wie beslist", een ingeklapte
// "Waar" vanaf 3 straten en een technische link per dossier. Nooit vrije onderwerptekst.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { aanvraagInhoud, duidelijkeKaart, LABELTEKSTEN } from "../site/permit-clarity.js";
import { normalizePermit, collectPermits } from "../site/permits-live-core.js";
import { permitEntry } from "../site/place-core.js";
import { buildStreetIndex } from "../site/street-core.js";

const fixture = async (naam) => JSON.parse(await readFile(new URL(`./fixtures/${naam}`, import.meta.url), "utf8"));
const rij = (onderwerp, extra = {}) => ({ Dossiernummer: "20990001", ProjectnummerOmgevingsloket: "OMV_2099000001", DOSSIERTYPE: "OMV2019_AANVRAAG", AardAanvraag: "Aanvraag omgevingsproject", Onderwerp: onderwerp, Volledig: "ja", Ontvankelijk: "ja", behandelendeOverheid: "College van burgemeester en schepenen", ...extra });
const kaart = (onderwerp, extra = {}) => duidelijkeKaart({ source: "permits" }, normalizePermit(rij(onderwerp, extra)));

test("de 15 onderwerpen uit de straattest krijgen een titel die zegt wat er gebeurt", async () => {
  const { aanvragen } = await fixture("vergunning-onderwerpen.json");
  assert.equal(aanvragen.length, 15);
  for (const a of aanvragen) {
    const titel = kaart(a.onderwerp, { behandelendeOverheid: a.overheid }).titel;
    assert.equal(titel, a.titel, a.onderwerp);
    assert.doesNotMatch(titel, /doel niet|niet herkend/);
  }
});

test("woordgrenzen: verbouwen is geen nieuwbouw, en 'vellen van één boom' is een boom vellen", () => {
  assert.equal(kaart("verbouwen van een eengezinswoning").titel, "Verbouwing of uitbreiding");
  assert.equal(kaart("verbouwen van een meergezinswoning naar een eengezinswoning").titel, "Minder woningen · verbouwing of uitbreiding");
  assert.equal(kaart("vellen van één boom").titel, "Boom vellen");
  assert.equal(kaart("vellen van 4 populieren").titel, "4 bomen vellen");
  // "zonder functiewijziging" is geen functiewijziging.
  assert.equal(kaart("verbouwen en/of uitbreiden zonder functiewijziging").titel, "Verbouwing of uitbreiding");
  // Een restaurant is geen restauratie, een recafunctie geen renovatie.
  assert.doesNotMatch(kaart("uitbreiden van een restaurant").titel, /Restauratie/);
});

test("meerdere vaste labels per aanvraag; de rest staat bij 'Wat'", () => {
  const x = kaart("wijzigen van de voorgevel, supprimeren van de reca-unit en het uitvoeren van interne wijzigingen ten opzichte van omgevingsvergunning OMV_2000000002 (SH) en het exploiteren van 1 warmtepomp (IIOA)");
  assert.equal(x.titel, "Wijziging van een eerdere vergunning: horeca verdwijnt · gevel aanpassen");
  const wat = x.regels.find(([k]) => k === "Wat")[1];
  assert.match(wat, /verbouwing of uitbreiding · warmtepomp, airco of verwarming\./);
  assert.match(wat, /Er bestaat al een vergunning; deze aanvraag wil ze aanpassen\./);
  // Een warmtepomp alleen maakt er geen bedrijf met milieuvergunning van.
  assert.doesNotMatch(wat, /milieuvergunning/);
});

test("aantallen uit de bron, maar nooit uit telefoon- of huisnummers", () => {
  assert.equal(kaart("bouwen van 6 appartementen met reca op het gelijkvloers").titel, "Nieuwbouw (6 appartementen en horeca)");
  assert.equal(kaart("oprichten van 2 meergezinswoningen met 2 en 3 wooneenheden na sloop").titel, "Sloop en nieuwbouw (2 meergezinswoningen)");
  assert.equal(kaart("bouwen van een meergezinswoning, info 0470 12 34 56 appartementen").titel, "Nieuwbouw (woningen)");
});

test("publieke projecten alleen als de Vlaamse Regering of de Deputatie de aanvraag behandelt", () => {
  const onderwerp = "Actualisatie en hernieuwing van het project 'Renovatie Royerssluis'.";
  assert.match(kaart(onderwerp, { behandelendeOverheid: "Vlaamse Regering" }).titel, /^Royerssluis: /);
  assert.match(kaart("aanleggen en verhogen van de Blokkersdijk", { behandelendeOverheid: "Vlaamse Regering" }).titel, /^Blokkersdijk/);
  for (const overheid of ["College van burgemeester en schepenen", ""]) assert.doesNotMatch(kaart(onderwerp, { behandelendeOverheid: overheid }).titel, /Royerssluis/);
});

test("de stand uit Volledig en Ontvankelijk staat in één statusregel", () => {
  assert.equal(kaart("vellen van een boom").samenvatting, "In behandeling: volledig en ontvankelijk verklaard. Nog geen beslissing gepubliceerd.");
  assert.equal(kaart("vellen van een boom", { Volledig: "", Ontvankelijk: "" }).samenvatting, "Ingediend: nog niet volledig en ontvankelijk verklaard. Nog geen beslissing gepubliceerd.");
  assert.match(kaart("vellen van een boom", { Volledig: "", Ontvankelijk: "nee" }).samenvatting, /niet ontvankelijk/);
  assert.match(kaart("vellen van een boom", { Beslissing: "Vergund" }).samenvatting, /verleend volgens/);
  const x = kaart("vellen van een boom");
  // De status staat niet nog eens in de details, en er is geen losse regel "nummer · overheid".
  assert.equal(x.regels.some(([k]) => /status/i.test(k)), false);
  assert.deepEqual(x.regels.find(([k]) => k === "Wie beslist"), ["Wie beslist", "College van burgemeester en schepenen"]);
  assert.deepEqual(kaart("vellen van een boom", { Beslissing: "Vergund", beslissingsoverheid: "Deputatie" }).regels.find(([k]) => k === "Beslist door"), ["Beslist door", "Deputatie"]);
  const entry = permitEntry(normalizePermit(rij("vellen van een boom")));
  assert.equal(entry.title, "Boom vellen");
  assert.equal(entry.info, "");
  assert.equal(entry.status, x.samenvatting);
});

test("een aanvraag zonder omschrijving zegt dat eerlijk in één zin", () => {
  const x = kaart("Dossier aangemaakt via het digitaal loket, gelieve een onderwerp in te vullen...");
  assert.equal(x.titel, "Omgevingsaanvraag zonder omschrijving");
  assert.deepEqual(x.regels.find(([k]) => k === "Wat"), ["Wat", "De aanvrager vulde geen omschrijving in. Wat er gebeurt, staat alleen in het dossier zelf."]);
  // In alle weergaven dezelfde naam voor een onbekende aanvraag.
  assert.equal(kaart("plaatsen van een automaat").titel, "Omgevingsaanvraag (soort werk niet herkend)");
});

test("'Waar': de gekozen straat eerst, vanaf 3 straten ingeklapt", () => {
  const item = { ...normalizePermit(rij("vellen van een boom")), streets: ["Astraat", "Bstraat", "Cstraat", "Dstraat"].map((name, i) => ({ id: String(i), name, postcode: "2000" })) };
  const x = duidelijkeKaart({ source: "permits" }, item, { straat: "Cstraat" });
  assert.equal(x.waar.kort, "Cstraat en 3 andere straten");
  assert.equal(x.waar.ingeklapt, true);
  assert.deepEqual(x.waar.straten, ["Cstraat", "Astraat", "Bstraat", "Dstraat"]);
  const twee = duidelijkeKaart({ source: "permits" }, { ...item, streets: item.streets.slice(0, 2) });
  assert.equal(twee.waar.kort, "Astraat en Bstraat");
  assert.equal(twee.waar.ingeklapt, false);
  assert.equal(permitEntry(item).location, "Astraat en 3 andere straten");
});

test("de technische link toont alleen dit dossier, zonder onderwerp of naam", () => {
  const district = { type: "Polygon", coordinates: [[[4.39, 51.19], [4.41, 51.19], [4.41, 51.21], [4.39, 51.21], [4.39, 51.19]]] };
  const streets = buildStreetIndex([{ type: "Feature", properties: { DISTRICT: "ANTWERPEN", LSTRNMID: 1, LSTRNM: "Teststraat", RSTRNMID: 1, RSTRNM: "Teststraat", postcode: 2000 }, geometry: { type: "LineString", coordinates: [[4.4, 51.195], [4.4, 51.205]] } }]);
  const [item] = collectPermits({ features: [{ attributes: rij("vellen van een boom"), geometry: { rings: [[[4.3998, 51.199], [4.4002, 51.199], [4.4002, 51.201], [4.3998, 51.201], [4.3998, 51.199]]] } }], districtGeometry: district, streetIndex: streets });
  const url = new URL(item.sourceUrl);
  assert.equal(url.searchParams.get("where"), "Dossiernummer='20990001'");
  assert.equal(url.searchParams.get("f"), "html");
  assert.doesNotMatch(url.searchParams.get("outFields"), /Onderwerp|MaatschappelijkeNaam/);
});

test("namen, telefoonnummers, adressen en rekeningnummers komen nergens door", async () => {
  const { aanvragen } = await fixture("vergunning-privacy.json");
  for (const a of aanvragen) {
    const item = normalizePermit(rij(a.onderwerp, { MaatschappelijkeNaam: a.naam, behandelendeOverheid: a.overheid ?? "College van burgemeester en schepenen" }));
    const uit = JSON.stringify([item, duidelijkeKaart({ source: "permits" }, item), permitEntry(item)]);
    for (const stuk of a.verboden) assert.equal(uit.includes(stuk), false, `"${stuk}" lekt uit: ${a.onderwerp}`);
  }
});

test("elk label komt uit de vaste lijst, ook bij onderwerpen met persoonsgegevens", async () => {
  const alle = [...(await fixture("vergunning-onderwerpen.json")).aanvragen, ...(await fixture("vergunning-privacy.json")).aanvragen];
  for (const a of alle) {
    const inhoud = aanvraagInhoud("Aanvraag omgevingsproject", a.onderwerp, a.overheid ?? "");
    for (const label of inhoud.labels) assert.ok(LABELTEKSTEN.includes(label), label);
  }
});
