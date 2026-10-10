// Inzageloket (herstelplan O5): geen knop meer naar de startpagina die het dossier meestal niet vindt,
// een rechtstreekse link alleen voor een dossier dat in het loket opende, en bij een openbaar onderzoek
// bovenaan "loopt tot en met <datum>. Bezwaar indienen kan tot dan." Nooit gissen: zonder nagekeken
// datums, of na de laatste dag, zegt de kaart niets over een openbaar onderzoek.
// De nieuwe module wordt per toets geladen, zodat elke toets apart faalt op de oude code.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { bezoekersLinks, bezoekersHint } from "../site/bezoekers-bronnen.js";
import { duidelijkeKaart } from "../site/permit-clarity.js";

const inzage = () => import("../site/inzage-status.js");
const json = async (rel) => JSON.parse(await readFile(new URL(rel, import.meta.url), "utf8"));
const LOKET = "https://omgevingsloketinzage.omgeving.vlaanderen.be/";
const BRON = "https://geodata.antwerpen.be/arcgissql/rest/services/P_PiP/pip2_vergunningen/MapServer/5";
const aanvraag = (extra = {}) => ({ dossier: "20990001", project: "OMV_2099000001", dossierType: "OMV2019_AANVRAAG", complete: "ja", admissible: "ja", authority: "College van burgemeester en schepenen", streets: [{ name: "Teststraat" }], ...extra });

test("geen doodlopende knop: zonder nagekeken dossier geen link naar het Inzageloket, wel een eerlijke zin", () => {
  const e = { source: "permits", item: aanvraag(), sourceUrl: BRON };
  const links = bezoekersLinks(e);
  assert.equal(links.some((l) => l.url.startsWith(LOKET)), false, JSON.stringify(links));
  assert.equal(links.some((l) => /zoek/i.test(l.label)), false, "geen zoekknop of zoekhulp");
  assert.match(links.at(-1).label, /Technische/);
  assert.equal(bezoekersHint(e), "Geen lopend openbaar onderzoek bekend voor dit dossier. Het Inzageloket toont alleen dossiers in openbaar onderzoek of met een beslissing.");
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
  for (const [naam, fout] of Object.entries({ zonderEinde, metNaam, nietGevonden, omgekeerd, geenDatum })) {
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

test("site/sources/inzage-status.json: geldig, zonder persoonsgegevens, Riemstraat tot en met 20 oktober", async () => {
  const { inzageVoor, valideerInzageStatus } = await inzage();
  const { privacyFindings } = await import("../lib/source-feed.mjs");
  const doc = await json("../site/sources/inzage-status.json");
  assert.deepEqual(valideerInzageStatus(doc), []);
  assert.deepEqual(privacyFindings(doc), []);
  // Het dossier aan de Riemstraat (projectnummer uit de stadsbron), nagekeken in het loket op 9 oktober.
  const riem = inzageVoor(doc, "OMV_2026062371", "2026-10-10");
  assert.equal(riem.link, `${LOKET}2026062371`);
  assert.deepEqual(riem.onderzoek, { van: "2026-09-21", totEnMet: "2026-10-20" });
  assert.equal(inzageVoor(doc, "OMV_2026062371", "2026-10-21"), null);
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
