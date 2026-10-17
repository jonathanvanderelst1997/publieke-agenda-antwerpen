// Geen link naar een ruw GIPOD-record (site/gipod-bron.js). Een werk, grondwerk, inname, markt of hinder in
// GIPOD draagt ContactOrganisations of HindranceContactOrganisations (contactnaam, e-mail, telefoon); de
// filterlink op geo.api.vlaanderen.be toonde die met één klik, en Hinder in Kaart met gipodid opent het
// detailpaneel van dat record met dezelfde gegevens. Per item linkt de site hoogstens naar de algemene kaart van
// Hinder in Kaart (zonder gipodid), verder één keer naar de datasetfiche: "Bron: GIPOD (Digitaal Vlaanderen)".
// Alle gegevens zijn verzonnen (Voorbeeld Persoon, voorbeeld@example.org, Proefplein).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { GIPOD_BRON, GIPOD_METADATA_URL, gipodLink, ruwGipodRecord, ruweGipodLinksIn, zonderRuweGipodLinks } from "../site/gipod-bron.js";
import { GIPOD_BRON as HINDER_BRON, GIPOD_METADATA_URL as HINDER_METADATA_URL, collectHindrance } from "../site/works-hindrance.js";
import { collectWorks } from "../site/works-core.js";
import { werkEntries, workEntry, agendaEntry } from "../site/place-core.js";
import { GEOPUNT, bezoekersLinks, hinderkaart, splitsLinks } from "../site/bezoekers-bronnen.js";
import { buildStreetIndex } from "../site/street-core.js";
import { buildStreetGroups } from "../site/street-overview.js";
import { buildWeekPulse } from "../site/week-pulse.js";
import { GIPOD_METADATA_URL as MARKT_METADATA_URL, marketsFromGipod } from "../lib/gipod-markets.mjs";
import { eventsFromGipod } from "../lib/gipod-events.mjs";
import { GIPOD_OUDE_BRON_URL, SOURCE_DEFINITIONS, sourceDocument, validateSourceDocument, zonderRuweGipodBron } from "../lib/source-feed.mjs";
import { readSourceDocument } from "../lib/fetch-util.mjs";
import { run as runMarkten } from "../scripts/fetch-sources-markten.mjs";
import { run as runGipodEvenementen } from "../scripts/fetch-sources-gipod-events.mjs";
import { kandidatenUitGipod } from "../lib/parcours-herkenning-refresh.mjs";
import { ASIGN_BRON, bouwHerkenning, marktDagenUitBron, publiekeLink } from "../lib/parcours-herkenning.mjs";
import { validateHerkenning } from "../lib/evenement-herkenning-validatie.mjs";
import { VANDAAG as VANDAAG_HERKENNING, laadFixtures } from "./helpers/parcours-herkenning-evaluatie.mjs";
import { itemVoorStraat } from "../scripts/build-straat-snapshots.mjs";
import { STRAAT_INDEX } from "../lib/straat-bestanden.mjs";
import { KAM, bouw as bouwStraten, maakWerkmap, schoneBronnen } from "./helpers/straat-fixture.mjs";
import { buildFeed, readSources } from "../scripts/build-sources.mjs";
import { loadAgendaRuntime } from "../scripts/agenda-source.mjs";
import { controleerAgendaInhoud } from "../scripts/audit-inhoud-kwaliteit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUW = Object.freeze({
  filter: "https://geo.api.vlaanderen.be/GIPOD/ogc/features/v1/collections/INNAME_PUNT/items?f=html&filter-lang=cql2-text&filter=GipodId%3D990001",
  rij: "https://geo.api.vlaanderen.be/GIPOD/ogc/features/v1/collections/INNAME_PUNT/items/INNAME_PUNT.990001-2610190600",
  inname: "https://geo.api.vlaanderen.be/GIPOD/ogc/features/v1/collections/INNAME/items/INNAME.990001-1",
  hinder: "https://geo.api.vlaanderen.be/GIPOD/ogc/features/v1/collections/HINDER_PUNT/items?bbox=4.3,51.1,4.5,51.3",
  werk: "https://gipod.api.vlaanderen.be/api/v1/works/990001",
  grondwerk: "https://gipod.api.vlaanderen.be/api/v1/groundworks/990002",
  hinderUri: "https://gipod.api.vlaanderen.be/api/v1/mobility-hindrances/990003",
  gecodeerd: "https://geo.api.vlaanderen.be/GIPOD%2Fogc/features/v1/collections/INNAME_PUNT/items/1",
  hoofdletters: "HTTPS://GEO.API.VLAANDEREN.BE/gipod/ogc/features/v1/collections/INNAME_PUNT/ITEMS/1",
  http: "http://gipod.api.vlaanderen.be/api/v1/works/990001",
  // Hinder in Kaart op één record: de viewer opent het detailpaneel met ContactName, Email en Telephone.
  hinderInKaart: "https://www.geopunt.be/?app=hinder-in-kaart&gipodid=990001",
  hinderInKaartHoofdletters: "https://geopunt.be/?app=hinder-in-kaart&GipodId=990001",
  hinderInKaartHtml: "https://www.geopunt.be/?app=hinder-in-kaart&amp;gipodid=990001",
  hinderInKaartGecodeerd: "https://www.geopunt.be/?app=hinder-in-kaart&gipod%69d=990001",
});
const GEEN_RECORD = Object.freeze([
  GIPOD_METADATA_URL,
  "https://geo.api.vlaanderen.be/GIPOD/ogc/features",
  "https://geo.api.vlaanderen.be/GIPOD/ogc/features/v1/collections/INNAME_PUNT",
  "https://geo.api.vlaanderen.be/geolocation/v4/Location",
  "https://www.geopunt.be/?app=hinder-in-kaart",
  "https://www.geopunt.be/",
  "https://www.antwerpen.be/?gipodid=990001",
  "https://www.antwerpen.be/info/5c065842a67793326b260661/markten-in-district-antwerpen",
  "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/22",
  "/event/markt-proef-2099-01-01/",
  "",
  "geen url",
]);
const CONTACT = JSON.stringify([{ ContactRole: "Dossierbeheerder", OrganisationName: "Voorbeeldorganisatie", ContactName: "Voorbeeld Persoon", Email: "voorbeeld@example.org" }]);
const geenRuweLink = (waarde, wat) => {
  const tekst = typeof waarde === "string" ? waarde : JSON.stringify(waarde);
  assert.deepEqual(ruweGipodLinksIn(tekst), [], `${wat}: link naar een ruw GIPOD-record`);
  assert.doesNotMatch(tekst, /gipod\.api\.vlaanderen\.be|Voorbeeld Persoon|voorbeeld@example\.org/, wat);
};

test("ruwGipodRecord: elke record-, filter- of itemvraag op GIPOD, nooit de datasetfiche of een gewone pagina", () => {
  for (const [naam, url] of Object.entries(RUW)) assert.equal(ruwGipodRecord(url), true, naam);
  for (const url of GEEN_RECORD) assert.equal(ruwGipodRecord(url), false, url);
  assert.equal(gipodLink(GIPOD_METADATA_URL), true);
  assert.equal(gipodLink(RUW.rij), true);
  assert.equal(gipodLink("https://www.antwerpen.be/info/x"), false);
  assert.deepEqual(ruweGipodLinksIn(`<a href="${RUW.filter}">x</a> "sourceUrl":"${RUW.rij}" ${GIPOD_METADATA_URL}`), [RUW.filter, RUW.rij]);
  assert.deepEqual(zonderRuweGipodLinks({ sourceUrl: RUW.werk, sourceUrls: [RUW.grondwerk, "https://geodata.antwerpen.be/x"], hindrance: { sourceUrls: [RUW.hinderUri] }, title: "Werk" }),
    { sourceUrl: "", sourceUrls: ["https://geodata.antwerpen.be/x"], hindrance: { sourceUrls: [] }, title: "Werk" });
});

test("één constante: de datasetfiche en de bronzin zijn overal dezelfde, ook in de kopieën van agenda.js en agenda-ics.js", () => {
  assert.equal(GIPOD_METADATA_URL, "https://metadata.vlaanderen.be/srv/api/records/2b4b3bb7-cadc-41a0-b5ae-796a84a20b52");
  assert.equal(GIPOD_BRON, "Bron: GIPOD (Digitaal Vlaanderen)");
  assert.equal(HINDER_METADATA_URL, GIPOD_METADATA_URL);
  assert.equal(HINDER_BRON, GIPOD_BRON);
  assert.equal(MARKT_METADATA_URL, GIPOD_METADATA_URL);
  const agenda = loadAgendaRuntime(root);
  assert.equal(vm.runInContext("AGENDA_GIPOD_METADATA_URL", agenda), GIPOD_METADATA_URL);
  assert.equal(vm.runInContext("AGENDA_GIPOD_BRON", agenda), GIPOD_BRON);
  const sandbox = { URL, TextEncoder, Date, console };
  vm.runInNewContext(fs.readFileSync(path.join(root, "site", "agenda-ics.js"), "utf8"), sandbox);
  for (const url of [...Object.values(RUW), ...GEEN_RECORD]) {
    assert.equal(agenda.agendaRuwGipodRecord(url), ruwGipodRecord(url), `agenda.js: ${url}`);
    assert.equal(sandbox.AgendaIcs.isRawGipodRecord(url), ruwGipodRecord(url), `agenda-ics.js: ${url}`);
  }
});

// ---------- werken ----------

const werkFeature = (gipodId, extra = {}) => ({
  type: "Feature", geometry: { type: "Point", coordinates: [4.4, 51.2] },
  properties: {
    GipodId: gipodId, Description: "Proefwerk riolering", Owner: "Voorbeeldorganisatie", Status: "Concreet gepland", Type: "Grondwerk",
    Start: "2099-03-01T06:00:00Z", End: "2099-04-01T16:00:00Z", Uri: `https://gipod.api.vlaanderen.be/api/v1/groundworks/${gipodId}`, ContactOrganisations: CONTACT, ...extra,
  },
});
const hinderFeature = (gipodId) => ({
  type: "Feature", geometry: { type: "Point", coordinates: [4.4, 51.2] },
  properties: {
    HindranceStatus: "Gevalideerd", HindranceGipodId: gipodId + 5, HindranceConsequenceOf: `https://gipod.api.vlaanderen.be/api/v1/groundworks/${gipodId};`,
    HindranceURI: `https://gipod.api.vlaanderen.be/api/v1/mobility-hindrances/${gipodId + 5}`, HindranceContactOrganisations: CONTACT,
    Consequences: "Geen doorgang voor voetgangers", HindranceStart: "2099-03-01T06:00:00Z", HindranceEnd: "2099-03-20T16:00:00Z",
  },
});
const district = { type: "Polygon", coordinates: [[[4, 51], [5, 51], [5, 52], [4, 52], [4, 51]]] };

test("collectWorks en collectHindrance nemen de Uri, HindranceURI en de contactgegevens niet over", () => {
  const werken = collectWorks([werkFeature(990001), werkFeature(990001, { Status: "In uitvoering" })], new Set(), district);
  assert.equal(werken.length, 1);
  assert.equal("sourceUrls" in werken[0], false);
  geenRuweLink(werken, "collectWorks");
  const hinder = collectHindrance([hinderFeature(990001)]).get(990001);
  assert.deepEqual(hinder.hindranceIds, [990006]);
  assert.equal("sourceUrls" in hinder, false);
  geenRuweLink(hinder, "collectHindrance");
});

test("plekpagina: een werk linkt naar de algemene kaart van Hinder in Kaart en één keer naar de datasetfiche, nooit naar het record", () => {
  const [werk] = collectWorks([werkFeature(990001)], new Set(), district).map((w) => ({ ...w, streets: [{ id: "9", name: "Proefplein", postcode: "2000" }] }));
  // Ook een werk uit een straatbestand van vóór 17 oktober 2026, met nog een ruwe bronlink.
  const oud = { ...werk, gipodId: 990002, sourceUrls: [RUW.grondwerk], hindrance: { severe: false, consequences: [], sourceUrls: [RUW.hinderUri] } };
  for (const entry of [workEntry(werk), workEntry(werk, { vandaag: "2099-03-10" }), workEntry(oud, { vandaag: "2099-03-10" }), ...werkEntries([werk, oud], { vandaag: "2099-03-10" })]) {
    assert.equal(entry.sourceUrl, GIPOD_METADATA_URL);
    const links = bezoekersLinks(entry);
    geenRuweLink(links, "bezoekersLinks");
    // Nooit Hinder in Kaart met gipodid: dat opent het detailpaneel van het record, met de contactgegevens.
    assert.equal(links[0].url, "https://www.geopunt.be/?app=hinder-in-kaart");
    assert.doesNotMatch(JSON.stringify(links), /gipodid/i);
    assert.deepEqual(links.filter((l) => l.url === GIPOD_METADATA_URL).map((l) => l.label), [GIPOD_BRON]);
    assert.deepEqual(splitsLinks(links).technisch, [], "geen technische details met een GIPOD-link");
  }
});

test("plekpagina: een agendapunt met een ruwe GIPOD-link (oudere feed) krijgt de datasetfiche als bronvermelding", () => {
  for (const item of [
    { id: "markt-proef-2099-01-01", sourceId: "stad-markten", title: "Proefmarkt", date: "2099-01-01", sourceUrl: RUW.rij, link: RUW.rij, infoUrl: "https://www.antwerpen.be/shoppen-en-markten" },
    { id: "gipod-event-990001-2099-01-01", sourceId: "district-gipod-evenementen", title: "Proeffeest", date: "2099-01-01", sourceUrl: RUW.rij, link: RUW.rij },
    { id: "gipod-event-990002-2099-01-01", sourceId: "district-gipod-evenementen", title: "Proeffeest", date: "2099-01-01", sourceUrl: GIPOD_METADATA_URL, link: GIPOD_METADATA_URL },
  ]) {
    const links = bezoekersLinks(agendaEntry(item));
    geenRuweLink(links, item.id);
    assert.deepEqual(links.filter((l) => l.url === GIPOD_METADATA_URL).map((l) => l.label), [GIPOD_BRON], item.id);
  }
  // Een evenementkaart neemt een GIPOD-link nooit over als "officiële info".
  const kaart = bezoekersLinks({ source: "publicSpace", item: { kind: "event" }, evenementLinks: [{ url: RUW.inname, label: "Officiële info" }, { url: GIPOD_METADATA_URL, label: "Officiële info" }, { url: RUW.hinderInKaart, label: "Officiële info" }] });
  assert.deepEqual(kaart.filter((l) => l.type === "main"), []);
  // Een hinder op de plekpagina: ook de algemene kaart, nooit met gipodid.
  const hinder = bezoekersLinks({ source: "publicSpace", item: { kind: "parking", gipodId: 990001 } });
  assert.equal(hinder[0].url, GEOPUNT);
  geenRuweLink(hinder, "hinder op de plekpagina");
  // Een oude link naar Hinder in Kaart met gipodid (uit eender welke data) wordt de bronvermelding.
  const oud = bezoekersLinks(agendaEntry({ id: "gipod-event-990003-2099-01-01", sourceId: "district-gipod-evenementen", title: "Proeffeest", date: "2099-01-01", sourceUrl: RUW.hinderInKaart, link: RUW.hinderInKaart }));
  geenRuweLink(oud, "agendapunt met Hinder in Kaart op één record");
  assert.deepEqual(oud.filter((l) => l.url === GIPOD_METADATA_URL).map((l) => l.label), [GIPOD_BRON]);
});

test("werkenlijst: geen link per werk, onder de lijst de algemene kaart van Hinder in Kaart en één bronvermelding", () => {
  const code = fs.readFileSync(path.join(root, "site", "works-live.js"), "utf8");
  assert.doesNotMatch(code, /Technische GIPOD-bron|sourceUrls/);
  const kaart = code.slice(code.indexOf("function card(i)"), code.indexOf("\n", code.indexOf("function card(i)")));
  assert.equal((kaart.match(/<a href=/g) || []).length, 1, "alleen (met AWV-data) de AWV-fiche");
  assert.doesNotMatch(kaart, /hinderkaart|Hinder in Kaart|gipodid=/i, "geen link per werk naar Hinder in Kaart: met gipodid opent die het record");
  const bron = code.slice(code.indexOf("function renderBron(n)"), code.indexOf("function render()"));
  assert.ok(bron.includes('<a href="${esc(hinderkaart())}" target="_blank" rel="noreferrer">Officiële kaart: Hinder in Kaart</a>'), bron);
  assert.ok(bron.includes('<a href="${esc(GIPOD_METADATA_URL)}" target="_blank" rel="noreferrer">${esc(GIPOD_BRON)}</a>'), bron);
  assert.equal(hinderkaart(), GEOPUNT);
  assert.equal(hinderkaart(990001), GEOPUNT, "ook met een GIPOD-nummer de algemene kaart");
  const html = fs.readFileSync(path.join(root, "site", "index.html"), "utf8");
  assert.match(html, /<div class="works-live-list" data-works-list><\/div>[^\n]*\n\s*<p class="works-live-bron" data-works-bron hidden><\/p>/);
});

test("overzicht per straat en vooruitblik: per werk de algemene kaart van Hinder in Kaart, nooit een record", () => {
  const straat = { id: "1", name: "Teststraat", postcode: "2000" };
  const index = buildStreetIndex([{ type: "Feature", properties: { DISTRICT: "ANTWERPEN", LSTRNMID: 1, LSTRNM: "Teststraat", RSTRNMID: 1, RSTRNM: "Teststraat", postcode: 2000 }, geometry: { type: "LineString", coordinates: [[4.4, 51.2], [4.401, 51.2]] } }]);
  const works = [{ gipodId: 990001, title: "Proefwerk", status: "Concreet gepland", start: "2099-01-02", end: "2099-02-01", streets: [straat], sourceUrls: [RUW.werk] }];
  const agendaItems = [{ id: "markt-proef-2099-01-03", title: "Proefmarkt", date: "2099-01-03", location: "Teststraat 1, 2000 Antwerpen", sourceId: "stad-markten", sourceUrl: RUW.rij, link: RUW.rij }];
  const groepen = buildStreetGroups({ works, agendaItems, streetIndex: index, asOf: "2098-12-31" });
  geenRuweLink(groepen, "buildStreetGroups");
  // Op origin/main een dode Uri (HTTP 401); met gipodid zou Hinder in Kaart het record met contactgegevens openen.
  assert.deepEqual([groepen[0].works[0].sourceUrl, groepen[0].works[0].sourceLabel], ["https://www.geopunt.be/?app=hinder-in-kaart", "Hinder in Kaart"]);
  assert.equal(groepen[0].markets[0].sourceUrl, GIPOD_METADATA_URL);
  const puls = buildWeekPulse({ agendaItems, works, fromDay: "2099-01-01", toDay: "2099-01-07" });
  geenRuweLink(puls, "buildWeekPulse");
  assert.deepEqual(puls.upcoming.map((i) => i.url), ["https://www.geopunt.be/?app=hinder-in-kaart", GIPOD_METADATA_URL]);
  assert.doesNotMatch(JSON.stringify([groepen, puls]), /gipodid/i);
});

test("straatbestanden: itemVoorStraat laat elke link naar gipod.api en GIPOD-items op geo.api vallen", () => {
  const werk = { gipodId: 990001, title: "Proefwerk", status: "Concreet gepland", start: "2099-01-02", end: "2099-02-01", streets: [{ id: "1", name: "Teststraat", postcode: "2000" }],
    sourceUrls: [RUW.grondwerk, RUW.rij], sourceUrl: RUW.filter, hindrance: { severe: true, consequences: [], sourceUrls: [RUW.hinderUri] } };
  const uit = itemVoorStraat(werk, { laag: "werken" });
  assert.ok(uit);
  geenRuweLink(uit, "itemVoorStraat");
  assert.deepEqual([uit.sourceUrls, uit.sourceUrl, uit.hindrance.sourceUrls], [[], "", []]);
  const parkeer = itemVoorStraat({ id: "parking:1", kind: "parking", title: "Verhuis", start: "2099-01-02", end: "2099-01-02", sourceUrl: "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/20" }, { laag: "publiekeRuimte" });
  assert.equal(parkeer.sourceUrl, "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/20");
});

// schrijfStraatSnapshots (scripts/build-straat-snapshots.mjs): een laag die niet laadt, houdt de vorige stand per
// straat (houdVorige). Die vorige stand komt uit een straatbestand dat nog van vóór 17 oktober 2026 kan zijn.
test("straatbestanden: de vorige stand van een laag die niet laadde, verliest haar ruwe GIPOD-links", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gipod-straat-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  maakWerkmap(dir);
  await bouwStraten(dir);
  const bestand = path.join(dir, "site", "straat", `${KAM.id}.json`);
  // Het werk zoals een straatbestand van vóór die dag het nog kon dragen: bronlinks naar het ruwe record en de hinder.
  const oud = JSON.parse(fs.readFileSync(bestand, "utf8"));
  assert.equal(oud.werken.length, 1);
  oud.werken[0] = { ...oud.werken[0], sourceUrl: RUW.filter, sourceUrls: [RUW.grondwerk, "https://geodata.antwerpen.be/arcgissql/rest/services/x"], hindrance: { severe: true, consequences: ["Parkeerverbod"], sourceUrls: [RUW.hinderUri, RUW.hinderInKaart] } };
  fs.writeFileSync(bestand, `${JSON.stringify(oud)}\n`);
  assert.equal(ruweGipodLinksIn(fs.readFileSync(bestand, "utf8")).length, 4, "het oude bestand draagt de vier ruwe links");
  // De werken laden niet: de vorige stand blijft, zonder ruwe link.
  const zonderWerken = await schoneBronnen();
  zonderWerken.ververst = "2099-03-11T04:22:00.000Z";
  zonderWerken.lagen.werken = { ok: false, items: [], errorCode: "http_500" };
  await bouwStraten(dir, { bronnenDoc: zonderWerken, nu: new Date("2099-03-11T09:00:00Z") });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, STRAAT_INDEX), "utf8")).lagen.werken.status, "stale");
  const tekst = fs.readFileSync(bestand, "utf8");
  geenRuweLink(tekst, "vorige stand in het straatbestand");
  const [werk] = JSON.parse(tekst).werken;
  assert.equal(werk.id, oud.werken[0].id, "het werk blijft staan");
  assert.deepEqual([werk.sourceUrl, werk.sourceUrls, werk.hindrance], ["", ["https://geodata.antwerpen.be/arcgissql/rest/services/x"], { severe: true, consequences: ["Parkeerverbod"], sourceUrls: [] }]);
});

// ---------- markten en evenementen ----------

test("markten en GIPOD-evenementen: de bronlink is de datasetfiche, nooit de INNAME_PUNT-rij; id en GipodId blijven", () => {
  const now = new Date("2099-01-01T00:00:00Z");
  const markt = { type: "Feature", id: "INNAME_PUNT.990001-2901020700", geometry: { type: "Point", coordinates: [4.4, 51.21] },
    properties: { GipodId: 990001, Reference: "MA99", Description: "Proefplein: Gemengde markt Proefplein", Type: "Evenement", Owner: "Stad Antwerpen - Markten", Status: "Concreet gepland",
      PublicDomainOccupancyTypes: "Markt", Start: "2099-01-02T07:00:00Z", End: "2099-01-02T12:00:00Z", ContactOrganisations: CONTACT } };
  const { items: markten } = marketsFromGipod({ features: [markt, { ...markt, id: "geen-geldige-id" }] }, { now });
  assert.equal(markten.length, 1, "de controle op feature.id blijft");
  assert.equal(markten[0].sourceUrl, GIPOD_METADATA_URL);
  assert.equal(markten[0].externalId, "990001");
  geenRuweLink(markten, "marketsFromGipod");
  assert.doesNotMatch(JSON.stringify(markten), /INNAME_PUNT\./);
  const document = sourceDocument("stad-markten", { retrievedAt: "2099-01-01T00:00:00Z", fetchStatus: "ok", items: markten.map((item) => ({ ...item, retrievedAt: "2099-01-01T00:00:00Z" })) });
  assert.deepEqual(validateSourceDocument(document, { expectedSourceId: "stad-markten" }), []);
  const evenement = { ...markt, id: "INNAME_PUNT.990002-2901021200", properties: { ...markt.properties, GipodId: 990002, Description: "2000 Antwerpen, Proefplein : Buurtfeest Proefplein", PublicDomainOccupancyTypes: "Feest/kermis" } };
  const { items: feesten } = eventsFromGipod({ features: [evenement] }, { now });
  assert.equal(feesten.length, 1);
  assert.equal(feesten[0].sourceUrl, GIPOD_METADATA_URL);
  assert.equal(feesten[0].externalId, "990002");
  geenRuweLink(feesten, "eventsFromGipod");
});

test("brondefinities: GIPOD-bronnen hebben de datasetfiche als bron en geo.api.vlaanderen.be niet als toegelaten host", () => {
  for (const id of ["stad-markten", "district-gipod-evenementen"]) {
    const d = SOURCE_DEFINITIONS[id];
    assert.deepEqual([d.url, d.attribution.url], [GIPOD_METADATA_URL, GIPOD_METADATA_URL], id);
    assert.equal(d.allowedHosts.includes("geo.api.vlaanderen.be"), false, id);
    assert.equal(d.allowedHosts.includes("metadata.vlaanderen.be"), true, id);
  }
  for (const [id, d] of Object.entries(SOURCE_DEFINITIONS)) {
    assert.equal(d.allowedHosts.some((host) => /^(?:geo|gipod)\.api\.vlaanderen\.be$/.test(host)), false, id);
  }
});

// Een bronbestand van vóór 17 oktober 2026: ruwe rij als bronlink, de OGC-landingspagina als bron.
const oudeMarkt = () => ({
  ...sourceDocument("stad-markten", { retrievedAt: "2099-01-01T00:00:00Z", fetchStatus: "ok", items: [{
    id: "markt-ma99-2099-01-02", externalId: "990001", title: "Gemengde markt Proefplein", theme: "Activiteit", className: "activity", date: "2099-01-02", endDate: null,
    timeSlot: "08:00", timeText: "8 tot 13 uur", location: "Proefplein, Antwerpen", postcodes: [], info: "Openbare markt van stad Antwerpen. Marktdag volgens GIPOD.", kind: "activity",
    sourceUrl: GIPOD_METADATA_URL, infoUrl: "https://www.antwerpen.be/info/5c065842a67793326b260661/markten-in-district-antwerpen", retrievedAt: "2099-01-01T00:00:00Z", reviewRequired: false, inDistrict: true,
  }] }),
  url: "https://geo.api.vlaanderen.be/GIPOD/ogc/features",
  attribution: { text: SOURCE_DEFINITIONS["stad-markten"].attribution.text, url: "https://geo.api.vlaanderen.be/GIPOD/ogc/features" },
  allowedHosts: ["www.antwerpen.be", "geo.api.vlaanderen.be"],
});

test("overgang: een oud bronbestand wordt in de nieuwe vorm gelezen, zonder iets te verzinnen", () => {
  const oud = oudeMarkt();
  oud.items[0].sourceUrl = RUW.rij;
  assert.ok(validateSourceDocument(oud).length, "in de oude vorm is het bestand niet meer geldig");
  const { document, gemigreerd } = zonderRuweGipodBron(oud);
  assert.equal(gemigreerd, true);
  assert.deepEqual(validateSourceDocument(document, { expectedSourceId: "stad-markten" }), []);
  assert.equal(document.items[0].sourceUrl, GIPOD_METADATA_URL);
  assert.deepEqual({ ...document.items[0], sourceUrl: RUW.rij }, oud.items[0], "de rest van het item blijft");
  assert.equal(oud.items[0].sourceUrl, RUW.rij, "het origineel verandert niet");
  const nieuw = sourceDocument("stad-markten", { retrievedAt: null, fetchStatus: "ok", items: [] });
  assert.deepEqual(zonderRuweGipodBron(nieuw), { document: nieuw, gemigreerd: false });
  // Een ruwe GIPOD-link als infoUrl, in eender welke bron, valt weg.
  const metInfo = zonderRuweGipodBron({ ...nieuw, items: [{ ...document.items[0], infoUrl: RUW.inname }] }).document;
  assert.equal("infoUrl" in metInfo.items[0], false);
});

// lib/fetch-util.mjs: readSourceDocument zet een oud bestand om. Zonder die omzetting is een GIPOD-bron van vóór
// 17 oktober 2026 ongeldig, geeft readSourceDocument null, en schrijft keepPreviousOnError bij de eerste
// mislukte verversing een leeg document: alle markten weg, en de krimpcontrole heeft geen vorige stand meer.
test("overgang bij een mislukte verversing: readSourceDocument leest een oud GIPOD-bronbestand, en run() houdt de items", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gipod-overgang-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bronnen = path.join(dir, "site", "sources");
  fs.mkdirSync(bronnen, { recursive: true });
  const markt = oudeMarkt();
  markt.items[0].sourceUrl = RUW.rij;
  // Een GIPOD-evenement in de vorm van vóór 17 oktober 2026: ruwe rij, OGC-landingspagina, geo.api.vlaanderen.be als host.
  const feest = { type: "Feature", id: "INNAME_PUNT.990004-2901021200", geometry: { type: "Point", coordinates: [4.41, 51.22] },
    properties: { GipodId: 990004, Description: "2000 Antwerpen, Proefplein : Buurtfeest Proefplein", Reference: "EV1", Type: "Evenement", PublicDomainOccupancyTypes: "Feest/kermis",
      Status: "Concreet gepland", Start: "2099-01-02T12:00:00Z", End: "2099-01-02T18:00:00Z", ContactOrganisations: CONTACT } };
  const { items: feesten } = eventsFromGipod({ features: [feest] }, { now: new Date("2099-01-01T00:00:00Z") });
  assert.equal(feesten.length, 1);
  const evenementen = {
    ...sourceDocument("district-gipod-evenementen", { retrievedAt: "2099-01-01T00:00:00Z", fetchStatus: "ok", items: feesten.map((item) => ({ ...item, sourceUrl: RUW.rij, retrievedAt: "2099-01-01T00:00:00Z" })) }),
    url: GIPOD_OUDE_BRON_URL,
    attribution: { text: SOURCE_DEFINITIONS["district-gipod-evenementen"].attribution.text, url: GIPOD_OUDE_BRON_URL },
    allowedHosts: ["geo.api.vlaanderen.be"],
  };
  const oud = [["stad-markten", markt], ["district-gipod-evenementen", evenementen]];
  for (const [id, document] of oud) {
    assert.ok(validateSourceDocument(document, { expectedSourceId: id }).length, `${id}: in de oude vorm is het bestand ongeldig`);
    fs.writeFileSync(path.join(bronnen, `${id}.json`), JSON.stringify(document));
    const gelezen = readSourceDocument(dir, id);
    assert.ok(gelezen, `${id}: readSourceDocument leest het oude bestand in de nieuwe vorm`);
    assert.equal(gelezen.items.length, document.items.length, id);
    assert.deepEqual([gelezen.url, gelezen.attribution.url, gelezen.items[0].sourceUrl], [GIPOD_METADATA_URL, GIPOD_METADATA_URL, GIPOD_METADATA_URL], id);
    geenRuweLink(gelezen, `readSourceDocument ${id}`);
  }
  // De eerste verversing na de wijziging faalt (netwerkfout bij GIPOD): de vorige items blijven staan, zonder ruwe rij.
  const netwerkfout = async () => { throw new TypeError("fetch failed"); };
  const clock = () => new Date("2099-01-01T06:00:00Z");
  const [markten] = await runMarkten({ rootDir: dir, clock, env: {}, log: () => {}, sleep: async () => {}, fetch: netwerkfout });
  const [gipodEvenementen] = await runGipodEvenementen({ rootDir: dir, clock, log: () => {}, fetch: netwerkfout });
  for (const [[id, document], status] of [[oud[0], markten], [oud[1], gipodEvenementen]]) {
    assert.deepEqual([status.fetchStatus, status.errorCode, status.itemCount], ["error", "network_error", document.items.length], id);
    const geschreven = JSON.parse(fs.readFileSync(path.join(bronnen, `${id}.json`), "utf8"));
    assert.deepEqual(validateSourceDocument(geschreven, { expectedSourceId: id }), [], id);
    assert.deepEqual([geschreven.items.length, geschreven.retrievedAt, geschreven.fetchStatus], [document.items.length, "2099-01-01T00:00:00Z", "error"], id);
    geenRuweLink(geschreven, `keepPreviousOnError ${id}`);
  }
});

test("build:sources: een oud bronbestand geeft een feed zonder ruwe GIPOD-link, en de inhoudscontrole keurt een ruwe link af", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gipod-links-"));
  try {
    fs.mkdirSync(path.join(dir, "site", "sources"), { recursive: true });
    const oud = oudeMarkt();
    oud.items[0].sourceUrl = RUW.rij;
    fs.writeFileSync(path.join(dir, "site", "sources", "stad-markten.json"), JSON.stringify(oud));
    const { feed } = buildFeed(readSources(dir), []);
    geenRuweLink(feed, "feed");
    assert.equal(feed.items[0].link, GIPOD_METADATA_URL);
    assert.deepEqual(feed.items[0].sources.map((s) => s.url), [GIPOD_METADATA_URL]);
    const data = (item) => ({ feed: { classificationAsOf: "2099-01-01", items: [item] }, werken: { werken: {} }, status: { sources: [{ fetchStatus: "ok" }] } });
    assert.equal(controleerAgendaInhoud(data(feed.items[0])).ok, true);
    const ruw = controleerAgendaInhoud(data({ ...feed.items[0], sources: [{ sourceId: "stad-markten", url: RUW.rij }] }));
    assert.equal(ruw.ok, false);
    assert.deepEqual([ruw.metrieken.ruweGipodLinks, ruw.fouten], [1, ["1 agendapunten met een link naar een ruw GIPOD-record"]]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// scripts/validate-data.mjs in een eigen werkmap (lib/, de gedeelde modules uit site/ en het script zelf).
// Een oud GIPOD-bronbestand wordt getoetst zoals build:sources het leest (zonderRuweGipodBron), met een signaal.
// Een ruwe link in de feed of een eventpagina is een fout (die bouwt npm run check altijd opnieuw); in de
// bronbestanden en de straatbestanden (alleen de verversing schrijft ze) een signaal.
test("validate-data: oud GIPOD-bronbestand omgezet met een signaal; ruwe link in feed of eventpagina een fout, in bron- en straatbestanden een signaal", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gipod-validatie-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(path.join(root, "lib"), path.join(dir, "lib"), { recursive: true });
  fs.mkdirSync(path.join(dir, "scripts"));
  fs.copyFileSync(path.join(root, "scripts", "validate-data.mjs"), path.join(dir, "scripts", "validate-data.mjs"));
  fs.mkdirSync(path.join(dir, "site"));
  for (const name of fs.readdirSync(path.join(root, "site")).filter((n) => n.endsWith(".js") && n !== "agenda-feed.js")) fs.copyFileSync(path.join(root, "site", name), path.join(dir, "site", name));
  const schrijf = (rel, tekst) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), tekst); };
  const oud = oudeMarkt();
  oud.items[0].sourceUrl = RUW.rij;
  assert.ok(validateSourceDocument(oud, { expectedSourceId: "stad-markten" }).length, "zonder omzetting is het oude bestand ongeldig");
  schrijf("site/sources/stad-markten.json", JSON.stringify(oud));
  schrijf("site/straat/9001.json", JSON.stringify({ werken: [{ id: "work:990001", sourceUrls: [RUW.grondwerk], hindrance: { sourceUrls: [RUW.hinderUri] } }] }));
  const pagina = (url) => `<!doctype html><a href="${url}" target="_blank" rel="noreferrer">${GIPOD_BRON}</a>`;
  const feed = (url) => `window.PUBLIC_AGENDA_FEED = ${JSON.stringify({ items: [{ id: "markt-ma99-2099-01-02", link: url, sources: [{ sourceId: "stad-markten", url }] }] })};\n`;
  const run = () => {
    const uit = spawnSync(process.execPath, [path.join(dir, "scripts", "validate-data.mjs")], { encoding: "utf8" });
    return { fouten: uit.stderr.split("\n").filter(Boolean), signalen: uit.stdout.split("\n").filter((l) => l.startsWith("::warning")).map((l) => l.replace("::warning title=Data::", "")) };
  };

  // Ruwe links in de feed en in één eventpagina, de datasetfiche in een andere.
  schrijf("site/agenda-feed.js", feed(RUW.filter));
  schrijf("site/event/markt-ma99-2099-01-02/index.html", pagina(RUW.rij));
  schrijf("site/event/markt-ma99-2099-01-09/index.html", pagina(GIPOD_METADATA_URL));
  const ruw = run();
  assert.deepEqual(ruw.fouten.filter((l) => /GIPOD/.test(l)), [
    "site/agenda-feed.js: link naar een ruw GIPOD-record",
    "site/event/markt-ma99-2099-01-02/index.html: link naar een ruw GIPOD-record",
  ]);
  // Het oude bronbestand: geen fout (het wordt in de nieuwe vorm getoetst), wel een signaal.
  assert.deepEqual(ruw.fouten.filter((l) => l.startsWith("stad-markten.json")), []);
  assert.ok(ruw.signalen.includes("stad-markten.json: nog in de oude GIPOD-vorm (OGC API of ruwe rij als bronlink); de volgende verversing schrijft het opnieuw"), ruw.signalen.join("\n"));
  // De ruwe links in het bronbestand en het straatbestand: een signaal met de bestanden, geen fout.
  assert.ok(ruw.signalen.includes("2 bestanden van de verversing met een link naar een ruw GIPOD-record (onder meer site/sources/stad-markten.json, site/straat/9001.json); de volgende verversing schrijft ze zonder"), ruw.signalen.join("\n"));
  assert.deepEqual(ruw.fouten.filter((l) => /site\/(?:sources|straat)\//.test(l)), []);
  assert.equal(ruw.fouten.join("\n").includes("Voorbeeld"), false);

  // Alleen de datasetfiche in de feed en de eventpagina's: geen fout meer.
  schrijf("site/agenda-feed.js", feed(GIPOD_METADATA_URL));
  schrijf("site/event/markt-ma99-2099-01-02/index.html", pagina(GIPOD_METADATA_URL));
  assert.deepEqual(run().fouten.filter((l) => /GIPOD/.test(l)), []);
});

test("agenda en .ics: een ruwe GIPOD-link wordt de datasetfiche, bij een markt gaat de marktpagina voor", () => {
  const runtime = loadAgendaRuntime(root);
  const markt = { id: "markt-proef-2099-01-02", title: "Proefmarkt", date: "2099-01-02", timeSlot: "08:00", timeText: "8 tot 13 uur", location: "Proefplein", theme: "Activiteit",
    sourceId: "stad-markten", link: RUW.rij, sources: [{ sourceId: "stad-markten", url: RUW.rij }], infoUrl: "https://www.antwerpen.be/info/5c065842a67793326b260661/markten-in-district-antwerpen" };
  const html = runtime.sourceLinksTemplate(markt);
  geenRuweLink(html, "sourceLinksTemplate");
  assert.ok(html.includes(`<a href="${GIPOD_METADATA_URL}" target="_blank" rel="noreferrer">${GIPOD_BRON}</a>`), html);
  assert.equal(runtime.safeHref(RUW.filter), GIPOD_METADATA_URL);
  const sandbox = { URL, TextEncoder, Date, console };
  vm.runInNewContext(fs.readFileSync(path.join(root, "site", "agenda-ics.js"), "utf8"), sandbox);
  const ics = (item) => sandbox.AgendaIcs.buildIndividualIcs(item, { now: "2099-01-01T00:00:00Z" }).replace(/\r\n[ \t]/g, "");
  const metInfo = ics(markt);
  geenRuweLink(metInfo, ".ics markt");
  assert.match(metInfo, /\r\nURL:https:\/\/www\.antwerpen\.be\/info\/5c065842a67793326b260661\/markten-in-district-antwerpen\r\n/);
  const zonderInfo = ics({ ...markt, infoUrl: "", link: GIPOD_METADATA_URL });
  assert.ok(zonderInfo.includes(`\r\nURL:${GIPOD_METADATA_URL}\r\n`));
  assert.equal(sandbox.AgendaIcs.validateIndividualIcs(sandbox.AgendaIcs.buildIndividualIcs(markt, { now: "2099-01-01T00:00:00Z" })).valid, true);
});

test("parcoursherkenning: geen link naar een GIPOD-rij, wel de datasetfiche als bron", () => {
  const k = kandidatenUitGipod({ features: [{ id: "INNAME.990001-1", geometry: null, properties: { Type: "Evenement", Status: "Concreet gepland", Owner: "Gemeente Voorbeeld", PublicDomainOccupancyTypes: "Andere",
    Description: "2999 Voorbeeld, Proefstraat : Proefloop", Start: "2099-01-02T08:00:00Z", End: "2099-01-02T16:00:00Z", ContactOrganisations: CONTACT } }] });
  assert.equal(k.length, 1);
  assert.equal(k[0].link, "");
  geenRuweLink(k, "kandidatenUitGipod");
  assert.equal(publiekeLink(RUW.rij), "");
  assert.equal(publiekeLink(GIPOD_METADATA_URL), GIPOD_METADATA_URL);
  assert.deepEqual(marktDagenUitBron({ items: [{ title: "Gemengde markt Proefplein", date: "2099-01-02", location: "Proefplein, Antwerpen", sourceUrl: RUW.rij }] })[0].link, GIPOD_METADATA_URL);
});

// voorstelUitKoppeling (lib/parcours-herkenning.mjs): bij een koppeling via GIPOD geen link, en de datasetfiche als
// bron. "Zeker" vraagt een eigen publieke bron naast A-Sign; zonder de fiche zakt de fiche naar een vermoeden.
// De Linkeroever Criterium uit de 38 nagekeken dossiers (tests/fixtures/parcours-herkenning), zonder handfiche.
test("parcoursherkenning: een koppeling via GIPOD blijft 'zeker', zonder link en met de datasetfiche naast A-Sign", () => {
  const F = laadFixtures(root);
  const hand = { ...F.hand, dossiers: Object.fromEntries(Object.entries(F.hand.dossiers).filter(([k]) => k !== "ET2026003440")) };
  const crit = F.kandidaten.find((k) => k.titel === "Linkeroever Criterium");
  const bouw = (k) => bouwHerkenning({ dossiers: F.dossiers.map((d) => ({ ...d })), hand, kandidaten: [...F.kandidaten.filter((x) => x !== crit), k], historiek: F.historiek, charter: F.charter, vandaag: VANDAAG_HERKENNING, generatedAt: `${VANDAAG_HERKENNING}T08:00:00.000Z` });
  const fiche = (doc) => doc.dossiers.ET2026003440;
  // Op de districtskalender (een gewone pagina): de link en "zeker", zoals voorheen.
  const kalender = fiche(bouw(crit));
  assert.deepEqual([kalender.zekerheid, kalender.methode, kalender.link], ["zeker", "kalender", crit.link]);
  // Een evenement in GIPOD, zoals kandidatenUitGipod het maakt (geen link naar de INNAME-rij).
  const gipodDoc = bouw({ ...crit, bron: "gipod", bronLabel: "GIPOD (gemeente Voorbeeld)", link: "" });
  const viaGipod = fiche(gipodDoc);
  assert.deepEqual([viaGipod.zekerheid, viaGipod.methode, viaGipod.naam, viaGipod.link, viaGipod.linkLabel], ["zeker", "gipod", "Linkeroever Criterium", "", ""]);
  assert.deepEqual(viaGipod.bron, [GIPOD_METADATA_URL, ASIGN_BRON]);
  assert.deepEqual(validateHerkenning(gipodDoc), []);
  // Een agendapunt uit GIPOD (district-gipod-evenementen) met de datasetfiche, of uit een ouder bestand met de
  // ruwe rij, als link: geen link op de fiche, wel de datasetfiche als bron.
  for (const link of [GIPOD_METADATA_URL, RUW.rij, RUW.hinderInKaart]) {
    const doc = bouw({ ...crit, link });
    const r = fiche(doc);
    assert.deepEqual([r.zekerheid, r.methode, r.link, r.linkLabel, r.linkUitleg], ["zeker", "kalender", "", "", ""], link);
    assert.deepEqual(r.bron, [GIPOD_METADATA_URL, ASIGN_BRON], link);
    assert.deepEqual(validateHerkenning(doc), [], link);
    geenRuweLink(r, `fiche met ${link}`);
  }
});

// ---------- de code zelf en wat de build publiceert ----------

const bestanden = (dir, ext) => fs.readdirSync(path.join(root, dir)).filter((n) => ext.some((e) => n.endsWith(e)) && n !== "agenda-feed.js").map((n) => `${dir}/${n}`).sort();
const zonderCommentaar = (tekst) => tekst.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/(^|[\s;{}(,])\/\/.*$/gm, "$1");
// Ophaal-URL's van de code zelf (met kader of filter, f=json): geen link voor bezoekers. Elk gebruik is een vraag.
const OPHAAL = Object.freeze({
  "lib/gipod-events.mjs": "GIPOD_EVENT_ITEMS_URL",
  "lib/kaart-uitleg-refresh.mjs": "GIPOD_INNAME",
  "lib/parcours-herkenning-refresh.mjs": "GIPOD_INNAME",
});

test("statische scan: geen code bouwt een link naar een GIPOD-record of een GipodId-filter", () => {
  const code = [...bestanden("site", [".js", ".html"]), ...bestanden("lib", [".mjs"]), ...bestanden("scripts", [".mjs"])];
  assert.ok(code.length > 100);
  const verboden = [
    [/\/items\/\$\{/, "een recordpad /items/${…}"],
    // ${GIPOD_…}/${id} is een record; ${GIPOD_COLLECTIES}/${laag}/items (met een kader) is een vraag.
    [/\$\{GIPOD_\w+\}\/\$\{[^}]+\}(?!\/items)/, "een recordpad ${GIPOD_…}/${…}"],
    [/items\?f=html/i, "een HTML-pagina met GIPOD-items"],
    [/GipodId%3D/i, "een GipodId-filter in een link"],
    [/\.(?:Uri|HindranceURI)\b/, "de Uri of HindranceURI van een record"],
    [/Technische GIPOD-bron/, "de technische GIPOD-link op de werkkaart"],
    [/[?&]gipodid=/i, "Hinder in Kaart op één GIPOD-record (gipodid opent het detailpaneel met de contactgegevens)"],
    [/Bekijk werk op Hinder in Kaart/, "een link per werk naar Hinder in Kaart"],
  ];
  const fouten = [];
  for (const file of code) {
    const tekst = zonderCommentaar(fs.readFileSync(path.join(root, file), "utf8"));
    for (const [patroon, wat] of verboden) if (patroon.test(tekst)) fouten.push(`${file}: ${wat}`);
    for (const url of ruweGipodLinksIn(tekst)) {
      const naam = OPHAAL[file];
      const regel = tekst.split("\n").find((r) => r.includes(url)) || "";
      if (!naam || !new RegExp(`\\b${naam}\\s*=\\s*"${url.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}"`).test(regel)) fouten.push(`${file}: letterlijke link naar GIPOD-items (${url})`);
    }
    const naam = OPHAAL[file];
    if (naam) {
      for (const gebruik of tekst.match(new RegExp(`[^\\n]{0,20}\\b${naam}\\b[^\\n]{0,3}`, "g")) || []) {
        if (!/(?:const|export const)\s+\w+\s*=\s*"|new URL\(\w+\)|\$\{\w+\}\?|^\s*\w+\s*=\s*"/.test(gebruik) && !new RegExp(`(?:const|export const) ${naam}\\s*=`).test(gebruik)) fouten.push(`${file}: ${naam} anders gebruikt dan als vraag: ${gebruik.trim()}`);
      }
    }
  }
  assert.deepEqual(fouten, []);
});

test("gegenereerde uitvoer van de build: feed, eventpagina's, manifest en sitemap bevatten geen link naar een ruw GIPOD-record", () => {
  const event = path.join(root, "site", "event");
  const paginas = fs.readdirSync(event).map((d) => path.join(event, d, "index.html")).filter((f) => fs.existsSync(f));
  assert.ok(paginas.length > 100);
  const fouten = [];
  for (const file of [path.join(root, "site", "agenda-feed.js"), path.join(root, "site", "public-agenda-manifest.json"), path.join(root, "site", "sitemap.xml"), ...paginas]) {
    if (ruweGipodLinksIn(fs.readFileSync(file, "utf8")).length) fouten.push(path.relative(root, file));
  }
  assert.deepEqual(fouten, []);
  // Een eventpagina van een markt noemt GIPOD één keer, met de datasetfiche.
  const markt = paginas.find((f) => path.basename(path.dirname(f)).startsWith("markt-"));
  if (markt) {
    const html = fs.readFileSync(markt, "utf8");
    assert.equal(html.split(`<a href="${GIPOD_METADATA_URL}" target="_blank" rel="noreferrer">${GIPOD_BRON}</a>`).length - 1, 1, markt);
  }
});
