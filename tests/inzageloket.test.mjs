// Inzageloket (herstelplan O5): geen knop meer naar de startpagina die het dossier meestal niet vindt,
// een rechtstreekse link alleen voor een dossier dat in het loket opende, en bij een openbaar onderzoek
// bovenaan "loopt tot en met <datum>. Bezwaar indienen kan tot dan." Nooit gissen: zonder nagekeken
// datums, of na de laatste dag, zegt de kaart niets over een termijn. Zag iemand het dossier in openbaar
// onderzoek zonder de datums af te lezen, dan alleen de link en de dag waarop het liep.
// De nieuwe module wordt per toets geladen, zodat elke toets apart faalt op de oude code.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { bezoekersLinks, bezoekersHint } from "../site/bezoekers-bronnen.js";
import { duidelijkeKaart } from "../site/permit-clarity.js";
import { buildStreetGroups } from "../site/street-overview.js";

const inzage = () => import("../site/inzage-status.js");
const json = async (rel) => JSON.parse(await readFile(new URL(rel, import.meta.url), "utf8"));
const LOKET = "https://omgevingsloketinzage.omgeving.vlaanderen.be/";
const BRON = "https://geodata.antwerpen.be/arcgissql/rest/services/P_PiP/pip2_vergunningen/MapServer/5";
const aanvraag = (extra = {}) => ({ dossier: "20990001", project: "OMV_2099000001", dossierType: "OMV2019_AANVRAAG", complete: "ja", admissible: "ja", authority: "College van burgemeester en schepenen", streets: [{ name: "Teststraat" }], ...extra });

const GEEN_ZIN = "Deze site kon niet nagaan of er nu een openbaar onderzoek loopt. Het Inzageloket toont een aanvraag alleen tijdens het openbaar onderzoek en tijdens de beroepstermijn na de beslissing.";
const BEZWAAR = { url: "https://www.vlaanderen.be/omgevingsvergunning/inzageloket", label: "Zo dien je een bezwaar in (uitleg van Vlaanderen)", type: "help" };

test("geen doodlopende knop: zonder nagekeken dossier geen link naar het Inzageloket, wel een eerlijke zin", () => {
  const e = { source: "permits", item: aanvraag(), sourceUrl: BRON };
  const links = bezoekersLinks(e);
  assert.equal(links.some((l) => l.url.startsWith(LOKET)), false, JSON.stringify(links));
  assert.equal(links.some((l) => /zoek/i.test(l.label)), false, "geen zoekknop of zoekhulp");
  assert.match(links.at(-1).label, /Technische/);
  // De site weet niet of er een openbaar onderzoek loopt, en zegt dat ook zo (niet "geen onderzoek").
  assert.equal(bezoekersHint(e), GEEN_ZIN);
  assert.doesNotMatch(bezoekersHint(e), /Geen lopend|of met een beslissing/);
});

test("rechtstreekse link: het projectnummer zonder OMV_, alleen voor een geldig nummer", async () => {
  const { inzageLink, inzageNummer } = await inzage();
  assert.equal(inzageLink("OMV_2026062371"), `${LOKET}2026062371`);
  assert.equal(inzageNummer("omv_2026062371"), "2026062371");
  for (const fout of ["", "2026062371", "OMV_20260623", "OMV_2026062371x", "OMV_2026062371/../x", null]) assert.equal(inzageLink(fout), "", String(fout));
});

test("openbaar onderzoek bovenaan, met link, uit de fixture van inzage-status.json", async () => {
  const { metInzage } = await inzage();
  const doc = await json("./fixtures/inzage-status.json");
  const [item, ander] = metInzage([aanvraag(), aanvraag({ dossier: "20990009", project: "OMV_2099000009" })], doc, "2026-10-10");
  const kaart = duidelijkeKaart({ source: "permits" }, item, { vandaag: "2026-10-10" });
  assert.equal(kaart.melding, "Openbaar onderzoek loopt tot en met 20 oktober. Bezwaar indienen kan tot dan.");
  assert.equal(kaart.badge, "Openbaar onderzoek");
  assert.deepEqual(kaart.regels[0], ["Openbaar onderzoek", "Van 21 september tot en met 20 oktober (nagekeken in het Inzageloket op 9 oktober)"]);
  // De stand van de aanvraag blijft de ene statusregel.
  assert.match(kaart.samenvatting, /volledig en ontvankelijk verklaard/);
  const links = bezoekersLinks({ source: "permits", item, sourceUrl: BRON });
  assert.deepEqual(links[0], { url: `${LOKET}2099000001`, label: "Bekijk dit dossier en de plannen in het Inzageloket", type: "main" });
  // De uitleglink zegt waarvoor ze dient: hoe je bezwaar indient.
  assert.deepEqual(links[1], BEZWAAR);
  assert.equal(bezoekersHint({ source: "permits", item }), "");
  // Een dossier dat niet in het bestand staat, krijgt niets.
  assert.equal(ander.inzage, undefined);
  assert.equal(duidelijkeKaart({ source: "permits" }, ander, { vandaag: "2026-10-10" }).melding, "");
});

test("nooit gissen: na de laatste dag, zonder datums of met een onbekend veld zegt de kaart niets", async () => {
  const { inzageVoor, valideerInzageStatus } = await inzage();
  const doc = await json("./fixtures/inzage-status.json");
  assert.ok(inzageVoor(doc, "OMV_2099000001", "2026-10-20"), "de laatste dag telt nog mee");
  assert.equal(inzageVoor(doc, "OMV_2099000001", "2026-10-21"), null, "na de termijn: geen link en geen termijn meer");
  assert.equal(inzageVoor(doc, "OMV_2099000001", ""), null);
  const kopie = () => JSON.parse(JSON.stringify(doc));
  const zonderEinde = kopie(); delete zonderEinde.dossiers[0].openbaarOnderzoek.totEnMet;
  const metNaam = kopie(); metNaam.dossiers[0].aanvrager = "Jan Voorbeeld";
  const nietGevonden = kopie(); nietGevonden.dossiers[0].gevonden = false;
  const omgekeerd = kopie(); omgekeerd.dossiers[0].openbaarOnderzoek = { van: "2026-10-20", totEnMet: "2026-09-21" };
  const geenDatum = kopie(); geenDatum.dossiers[0].openbaarOnderzoek.totEnMet = "20/10/2026";
  const zonderToestand = kopie(); delete zonderToestand.dossiers[2].toestand;
  const andereToestand = kopie(); andereToestand.dossiers[2].toestand = "beslissing";
  const leegOnderzoek = kopie(); leegOnderzoek.dossiers[2].openbaarOnderzoek = null;
  const vrijeTekst = kopie(); vrijeTekst.dossiers[2].opmerking = "Teststraat 12";
  for (const [naam, fout] of Object.entries({ zonderEinde, metNaam, nietGevonden, omgekeerd, geenDatum, zonderToestand, andereToestand, leegOnderzoek, vrijeTekst })) {
    assert.ok(valideerInzageStatus(fout).length > 0, naam);
    // Eén fout maakt het hele bestand ongeldig: ook het andere dossier zegt dan niets.
    assert.equal(inzageVoor(fout, "OMV_2099000002", "2026-12-25"), null, naam);
  }
  assert.equal(inzageVoor(null, "OMV_2099000001", "2026-10-10"), null);
});

test("jaartal erbij als de datum in een ander jaar valt", async () => {
  const { metInzage } = await inzage();
  const doc = await json("./fixtures/inzage-status.json");
  const [item] = metInzage([aanvraag({ project: "OMV_2099000002" })], doc, "2026-12-30");
  assert.equal(duidelijkeKaart({ source: "permits" }, item, { vandaag: "2026-12-30" }).melding, "Openbaar onderzoek loopt tot en met 18 januari 2027. Bezwaar indienen kan tot dan.");
});

test("gevonden zonder termijn: link en de dag waarop het onderzoek liep, geen einddatum, na 30 dagen niets", async () => {
  const { metInzage, inzageVoor } = await inzage();
  const doc = await json("./fixtures/inzage-status.json");
  const [item] = metInzage([aanvraag({ project: "OMV_2099000003" })], doc, "2026-10-10");
  assert.deepEqual(item.inzage, { link: `${LOKET}2099000003`, toestand: "openbaar onderzoek", nagekeken: "2026-10-09", onderzoek: null, loopt: false });
  const kaart = duidelijkeKaart({ source: "permits" }, item, { vandaag: "2026-10-10" });
  assert.equal(kaart.melding, 'Op 9 oktober liep er een openbaar onderzoek, volgens het Inzageloket. Tot wanneer je bezwaar kunt indienen, staat in het loket bij "Toestand".');
  assert.doesNotMatch(kaart.melding, /tot en met|loopt tot/, "geen verzonnen einddatum");
  assert.equal(kaart.badge, "", "geen badge: de site weet niet of het onderzoek vandaag nog loopt");
  assert.deepEqual(kaart.regels[0], ["Openbaar onderzoek", "Liep op 9 oktober (nagekeken in het Inzageloket). De einddatum kent deze site niet."]);
  const links = bezoekersLinks({ source: "permits", item, sourceUrl: BRON });
  assert.deepEqual(links.slice(0, 2), [{ url: `${LOKET}2099000003`, label: "Bekijk dit dossier en de plannen in het Inzageloket", type: "main" }, BEZWAAR]);
  assert.equal(bezoekersHint({ source: "permits", item }), "", "niet de zin dat de site het niet kon nagaan");
  // Een openbaar onderzoek duurt 30 dagen: hoogstens tot 29 dagen na het nakijken.
  assert.ok(inzageVoor(doc, "OMV_2099000003", "2026-11-07"));
  assert.equal(inzageVoor(doc, "OMV_2099000003", "2026-11-08"), null);
});

test("de termijn begint later: geen badge en niet in de sectie 'bezwaar indienen kan nu'", async () => {
  const { metInzage } = await inzage();
  const doc = await json("./fixtures/inzage-status.json");
  const [item] = metInzage([aanvraag({ project: "OMV_2099000004" })], doc, "2026-10-10");
  assert.equal(item.inzage.loopt, false);
  const kaart = duidelijkeKaart({ source: "permits" }, item, { vandaag: "2026-10-10" });
  assert.equal(kaart.melding, "Openbaar onderzoek van 15 oktober tot en met 13 november. Bezwaar indienen kan in die periode.");
  // Geen badge: de plekpagina zet alleen een lopende termijn bovenaan (e2e: tests/e2e/plek.e2e.mjs).
  assert.equal(kaart.badge, "");
});

test("plekpagina: alleen een lopende termijn in de sectie bovenaan; een andere melding eerst bij de aanvragen", async () => {
  const { metInzage, splitsOpOnderzoek } = await inzage();
  const doc = await json("./fixtures/inzage-status.json");
  const items = metInzage([aanvraag({ project: "OMV_2099000009" }), aanvraag({ project: "OMV_2099000003" }), aanvraag(), aanvraag({ project: "OMV_2099000004" })], doc, "2026-10-10");
  const entries = items.map((item) => ({ group: "vergunningen", item }));
  const { inspraak, overige } = splitsOpOnderzoek(entries);
  assert.deepEqual(inspraak.map((e) => e.item.project), ["OMV_2099000001"]);
  assert.deepEqual(overige.map((e) => e.item.project), ["OMV_2099000003", "OMV_2099000004", "OMV_2099000009"]);
});

test("overzicht per straat: de termijn of de dag van het onderzoek staat vóór de stand van de aanvraag", async () => {
  const { metInzage } = await inzage();
  const doc = await json("./fixtures/inzage-status.json");
  const street = { id: "1", name: "Teststraat", postcode: "2000" };
  const items = metInzage([aanvraag({ id: "p1", streets: [street] }), aanvraag({ id: "p3", project: "OMV_2099000003", streets: [street] }), aanvraag({ id: "p9", project: "OMV_2099000009", streets: [street] })], doc, "2026-10-10");
  const [groep] = buildStreetGroups({ permits: items, asOf: "2026-10-10" });
  const stand = Object.fromEntries(groep.permits.map((p) => [p.id, p.status]));
  assert.match(stand.p1, /^Openbaar onderzoek loopt tot en met 20 oktober\. Bezwaar indienen kan tot dan\. In behandeling/);
  assert.match(stand.p3, /^Op 9 oktober liep er een openbaar onderzoek/);
  assert.doesNotMatch(stand.p9, /openbaar onderzoek/i);
});

test("site/sources/inzage-status.json: geldig, zonder persoonsgegevens, elke link rechtstreeks naar een dossier", async () => {
  // Alleen wat altijd moet gelden: wie een verlopen regel opruimt of datums toevoegt, breekt deze toets niet.
  const { valideerInzageStatus, inzageLink } = await inzage();
  const { privacyFindings } = await import("../lib/source-feed.mjs");
  const doc = await json("../site/sources/inzage-status.json");
  assert.deepEqual(valideerInzageStatus(doc), []);
  assert.deepEqual(privacyFindings(doc), []);
  for (const d of doc.dossiers) assert.match(inzageLink(d.project), /^https:\/\/omgevingsloketinzage\.omgeving\.vlaanderen\.be\/\d{10}$/);
});

test("de bronbouw leest inzage-status.json niet als agendabron", async () => {
  const { readSources } = await import("../scripts/build-sources.mjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "inzage-"));
  fs.mkdirSync(path.join(root, "site", "sources"), { recursive: true });
  fs.copyFileSync(new URL("./fixtures/inzage-status.json", import.meta.url), path.join(root, "site", "sources", "inzage-status.json"));
  assert.deepEqual(readSources(root).documents, []);
});

test("de lijst met alle omgevingsdossiers heeft geen knop naar de startpagina van het loket meer", async () => {
  const bron = await readFile(new URL("../site/permits-live.js", import.meta.url), "utf8");
  assert.doesNotMatch(bron, /href="https:\/\/omgevingsloketinzage\.omgeving\.vlaanderen\.be\/"/);
  assert.match(bron, /inzage-status\.json/);
});
