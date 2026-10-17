// AWV-werfdata (open data "Werf" van het Agentschap Wegen en Verkeer) als aanvulling op de GIPOD-werkenlaag:
// geen agendapunten, alleen extra uitleg bij een werk dat al getoond wordt, op exact hetzelfde GIPOD-id.
// Alleen verzonnen gegevens: verzonnen werven, GIPOD-id's, uuid's en een verzonnen vierkant als district.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AWV_SOORTEN, AWV_WERF_SOURCE_ID, INNAME_VELDEN, MAX_INNAMES, OMLEIDING_BLOK, afdeling, bouwSupplement, fase, inBlokken, innametypes, innamesUrl,
  leesInnames, leesOmleidingen, maatregelen, omleidingenUrl, soortWerk, validateAwvSupplementItems, vanMercator, weggebruikers,
} from "../lib/awv-werf.mjs";
import { SOURCE_DEFINITIONS, privacyFindings, sourceDocument, validateRefreshStatus, validateSourceDocument } from "../lib/source-feed.mjs";
import { FETCHERS } from "../lib/source-registry.mjs";
import { readSources } from "../scripts/build-sources.mjs";
import { MIN_VORIGE_VOOR_NUL, run } from "../scripts/fetch-sources-awv-werf.mjs";
import { refreshAll } from "../scripts/refresh-fetch.mjs";
import { geometryIntersectsDistrict } from "../site/public-space-live-core.js";
import { attachAwvWorkSupplement, awvTekst } from "../site/works-awv-supplement.js";

const quiet = () => {};
const clock = () => new Date("2026-10-17T05:00:00Z");
const TODAY = "2026-10-17";
// Een verzonnen vierkant als district (WGS84).
const GRENS = { type: "Polygon", coordinates: [[[4.39, 51.21], [4.41, 51.21], [4.41, 51.23], [4.39, 51.23], [4.39, 51.21]]] };
const raaktDistrict = (lijn) => geometryIntersectsDistrict(lijn, GRENS);
// Referentiepunten: een verzonnen Lambert 72-punt, met pyproj omgezet naar EPSG:3857 en naar WGS84.
const REFERENTIE = [
  { mercator: [489514.379, 6659936.671], wgs84: [4.39738248, 51.21794543] },
  { mercator: [482340.25, 6669526.66], wgs84: [4.33293619, 51.27187366] },
  { mercator: [494128.868, 6653705.791], wgs84: [4.43883514, 51.18287288] },
];
const BINNEN = [[489514.379, 6659936.671, 0], [489600, 6660000, 0]];
const BUITEN = [[482340.25, 6669526.66, 0], [482400, 6669600, 0]];
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function inname(n, props = {}, lijn = BINNEN) {
  return {
    type: "Feature",
    id: `Werf_Innames.${uuid(n)}`,
    geometry: { type: "MultiLineString", coordinates: [lijn] },
    properties: {
      Werf_ID: 90001, GIPOD_ID: 99000000 + n, Afdeling: "Antwerpen", Type: "(Her)aanleg - Rijbaan incl. riolering, VRI", Status: "InUitvoering",
      Fase: "Fase 2", Inname_van_datum: "2026-10-01T07:00:00", Inname_tot_datum: "2026-11-30T18:00:00", Innametypes: "Rijstrook 2,1;Middenberm",
      Milderende_maatregelen: "Doorgang: 1 rijstroken versmald;Snelheidsbeperking", Op_UV_route: false, Gewijzigd_op: "2026-10-10T09:00:00",
      ...props,
    },
  };
}
const collectie = (features, extra = {}) => ({ type: "FeatureCollection", numberMatched: features.length, numberReturned: features.length, features, ...extra });
const omleiding = (n, type = "FIETSERS") => ({ type: "Feature", id: `Werf_Lokale_omleidingen.${uuid(500 + n)}`, geometry: null, properties: { Werf_ID: "90001", Inname_ID: uuid(n), Type_weggebruiker: type } });

function antwoord(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)), json: async () => body };
}
// Een nep-WFS: de innames en de omleidingen; elke URL wordt bewaard.
function nepWfs({ innames = [inname(1), inname(2)], omleidingen = [omleiding(1)], innameStatus = 200, extra = {} } = {}) {
  const urls = [];
  const fetch = async (url) => {
    urls.push(String(url));
    const u = new URL(url);
    assert.equal(u.origin + u.pathname, "https://opendata.apps.mow.vlaanderen.be/opendata-geoserver/awv/wfs");
    if (u.searchParams.get("typeNames") === "awv:Werf_Innames") return antwoord(collectie(innames, extra), innameStatus);
    if (u.searchParams.get("typeNames") === "awv:Werf_Lokale_omleidingen") return antwoord(collectie(omleidingen));
    return antwoord({}, 404);
  };
  return { fetch, urls };
}
function maakRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "awv-werf-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "site", "sources"), { recursive: true });
  return root;
}
const bestand = (root) => path.join(root, "site", "sources", `${AWV_WERF_SOURCE_ID}.json`);

test("de vraag naar AWV: alleen de vaste velden, nooit Omschrijving of URL; bevestigd, vanaf vandaag, in Lambert 72 en terug in 3857", () => {
  const u = new URL(innamesUrl(TODAY));
  const velden = u.searchParams.get("propertyName").split(",");
  assert.deepEqual(velden, [...INNAME_VELDEN]);
  for (const verboden of ["Omschrijving", "URL", "Buffer_publicatie"]) assert.ok(!velden.includes(verboden), verboden);
  assert.doesNotMatch(u.href, /Omschrijving|Buffer_publicatie|propertyName=\*/);
  assert.equal(u.searchParams.get("srsName"), "EPSG:3857", "nooit WGS84 vragen: dan rondt de server af op 3 decimalen");
  assert.equal(u.searchParams.get("count"), String(MAX_INNAMES));
  const filter = u.searchParams.get("CQL_FILTER");
  assert.match(filter, /^BBOX\(geometry,145255,207274,155282,222646,'EPSG:31370'\)/);
  assert.match(filter, /Inname_tot_datum >= '2026-10-17'/);
  assert.match(filter, /Status IN \('InUitvoering','ConcreetGepland','ConcreetVoorUitvoering'\)$/);
  assert.doesNotMatch(filter, /InOpmaak|NietConcreetGepland/);
  assert.throws(() => innamesUrl("2026-10-17' OR 1=1"), /ongeldige datum/);
});

test("omleidingen: hoogstens 100 uuid's per vraag, alleen geldige uuid's, alleen de koppelvelden", () => {
  const u = new URL(omleidingenUrl([uuid(1), "geen-uuid", uuid(2), uuid(1)]));
  assert.equal(u.searchParams.get("CQL_FILTER"), `Inname_ID IN ('${uuid(1)}','${uuid(2)}')`);
  assert.equal(u.searchParams.get("propertyName"), "Werf_ID,Inname_ID,Type_weggebruiker");
  const honderd = Array.from({ length: OMLEIDING_BLOK }, (_, i) => uuid(i + 1));
  assert.ok(omleidingenUrl(honderd).length < 6000, "een blok van 100 blijft onder de lengte die HTTP 414 gaf");
  assert.throws(() => omleidingenUrl([...honderd, uuid(101)]));
  assert.deepEqual(inBlokken(Array.from({ length: 230 }, (_, i) => i)).map((b) => b.length), [100, 100, 30]);
});

test("coördinaten: EPSG:3857 terug naar WGS84 klopt met de referentiepunten (op 1 cm)", () => {
  for (const { mercator, wgs84 } of REFERENTIE) {
    const [lon, lat] = vanMercator(mercator);
    assert.ok(Math.abs(lon - wgs84[0]) < 2e-7 && Math.abs(lat - wgs84[1]) < 2e-7, `${mercator} -> ${lon},${lat}`);
  }
  assert.equal(vanMercator(["x", 1]), null);
});

test("fase: alleen 'Fase' met een code die met een cijfer begint, of een maandnaam; codes en initialen vallen weg", () => {
  assert.equal(fase("Fase 2"), "Fase 2");
  assert.equal(fase("fase 1CB"), "Fase 1CB");
  assert.equal(fase("Fase17"), "Fase 17");
  assert.equal(fase("November"), "november");
  for (const weg of ["XQ Proefw", "Q. Verzon", "KB/00001", "2B+3D+FL D", "R001", "Nov", "Fase 2 AW", "Fase XY", "Proefweg", ""]) assert.equal(fase(weg), "", weg);
});

test("woordenlijst innametypes: rijstroken en vaste delen van de weg; de rest valt weg", () => {
  assert.deepEqual(innametypes("Rijstrook 3,2,1;Middenberm;;Iets anders;Rijstrook 3, 2"), ["Rijstrook 3,2,1", "Middenberm", "Rijstrook 3,2"]);
  assert.deepEqual(innametypes("Volledige rijbaan;Pechstrook;Mobiele werf;Fietspad"), ["Volledige rijbaan", "Pechstrook", "Mobiele werf", "Fietspad"]);
  assert.deepEqual(innametypes("Proefstraat 12"), []);
});

test("vaste lijst soort werk: alleen de gekende AWV-categorieën; de rest valt weg", () => {
  assert.equal(AWV_SOORTEN.length, 23);
  assert.deepEqual(soortWerk("(Her)aanleg - Rijbaan incl. riolering, VRI"), ["(Her)aanleg", "Rijbaan incl. riolering", "VRI"]);
  assert.deepEqual(soortWerk("Structureel onderhoud - Afschermende constructies, Bermen - Mobiel"), ["Structureel onderhoud", "Afschermende constructies", "Bermen", "Mobiel"]);
  assert.deepEqual(soortWerk("reiniging - straatkolken,Signalisatie"), ["Reiniging", "Straatkolken", "Signalisatie"]);
  assert.deepEqual(soortWerk("Andere, Lussen en vergelijkbaar in de rijbaan, Seinbruggen"), ["Andere", "Lussen en vergelijkbaar in de rijbaan", "Seinbruggen"]);
  // Een gekende categorie blijft, wat ernaast staat en niet in de lijst zit, valt weg.
  assert.deepEqual(soortWerk("Herstelling - Gevel Proefstraat, VRI"), ["Herstelling", "VRI"]);
  for (const weg of ["", "Proefstraat 12", "Verzonnen Aannemer", "Rijbaan incl riolering", "Fase 2"]) assert.deepEqual(soortWerk(weg), [], weg);
});

// Het oude patroon (alleen letters, haakjes, punten, spaties en streepjes) liet vrije tekst zonder cijfers door.
// Een verzonnen vrije tekst als Type mag nergens verschijnen: niet in de innames, niet in het bestand en niet op de
// werkkaart; een bestand dat hem toch bevat, is ongeldig, en de site toont hem dan nog altijd niet.
test("een verzonnen vrije tekst als Type verschijnt nergens: niet in het bestand, niet op de werkkaart", async (t) => {
  const VRIJ = "Herstelling gevel bij Verzonnen Bakkerij Proefstraat";
  const root = maakRoot(t);
  const wfs = nepWfs({ innames: [inname(1, { Type: VRIJ }), inname(2, { Type: `VRI, ${VRIJ}` })] });
  const [status] = await run({ rootDir: root, fetch: wfs.fetch, clock, env: {}, log: quiet, grens: GRENS });
  assert.equal(status.fetchStatus, "ok");
  const ruw = fs.readFileSync(bestand(root), "utf8");
  for (const deel of [VRIJ, "Verzonnen Bakkerij", "Proefstraat", "gevel"]) assert.ok(!ruw.includes(deel), deel);
  const document = JSON.parse(ruw);
  assert.deepEqual(document.items.map((i) => i.soort), [[], ["VRI"]]);
  const kaart = attachAwvWorkSupplement([{ gipodId: 99000001 }, { gipodId: 99000002 }], document.items, true, { vandaag: TODAY }).map((w) => awvTekst(w.awvSupplement)).join("\n");
  assert.doesNotMatch(kaart, /Verzonnen|Proefstraat|gevel/);
  assert.match(kaart, /soort werk: VRI\b/);
  // Een bestand met de vrije tekst toch in soort: ongeldig, en de werkkaart laat hem weg.
  const vervalst = { ...document.items[1], soort: ["VRI", "Verzonnen Bakkerij"] };
  assert.match(validateAwvSupplementItems([vervalst]).join("\n"), /ongeldige soort/);
  assert.doesNotMatch(awvTekst(vervalst), /Verzonnen/);
  assert.match(awvTekst(vervalst), /soort werk: VRI\b/);
});

test("woordenlijst maatregelen: doorgang, snelheid, doorsteek, bypass en omleidingen, ook met (2) en komma's", () => {
  assert.deepEqual(maatregelen("Doorgang: 2 rijstroken versmald;Snelheidsbeperking;Doorsteek"), { doorgang: ["2 rijstroken, versmald"], snelheidsbeperking: true, doorsteek: true, bypass: [], omleidingVoor: [] });
  assert.deepEqual(maatregelen("Doorgang: 1 rijstroken").doorgang, ["1 rijstrook"]);
  assert.deepEqual(maatregelen("Tijdelijke bypass: 1 rijstroken").bypass, ["1 rijstrook"]);
  assert.deepEqual(maatregelen("Omleidingen: fietsers (2)").omleidingVoor, ["fietsers"]);
  assert.deepEqual(maatregelen("Omleidingen: <3,5t (2), >3,5t (2), >7,5t (2)").omleidingVoor, ["voertuigen tot 3,5 ton", "voertuigen boven 3,5 ton", "voertuigen boven 7,5 ton"]);
  assert.deepEqual(maatregelen("Omleidingen: fietsers, voetgangers").omleidingVoor, ["fietsers", "voetgangers"]);
  assert.deepEqual(maatregelen("Omleidingen: alle").omleidingVoor, ["alle verkeer"]);
  // Wat niet in de woordenlijst past, valt weg (ook vrije tekst met een adres).
  assert.deepEqual(maatregelen(";Proefstraat 12 afgesloten;Omleidingen: buren;").omleidingVoor, []);
  assert.deepEqual(maatregelen(""), { doorgang: [], snelheidsbeperking: false, doorsteek: false, bypass: [], omleidingVoor: [] });
  assert.deepEqual(weggebruikers("GEMOTORISEERD_VERKEER_MEER_DAN_7500kg,FIETSERS,ONBEKEND"), ["voertuigen boven 7,5 ton", "fietsers"]);
  assert.deepEqual([afdeling("Antwerpen"), afdeling("Lantis"), afdeling("TO"), afdeling("NV Proeftunnel"), afdeling("")], ["Antwerpen", "Lantis", "TO", "AWV", "AWV"]);
});

test("innames lezen: status, GIPOD-id, datum (een lege einddatum valt bewust weg) en de grenstoets", () => {
  const { innames, tellers } = leesInnames(collectie([
    inname(1),
    inname(2, { Status: "InOpmaak" }),
    inname(3, { GIPOD_ID: null }),
    inname(4, { Inname_tot_datum: null }),
    inname(5, { Inname_tot_datum: "2026-10-16T18:00:00" }),
    inname(6, {}, BUITEN),
    inname(7, { Status: "ConcreetVoorUitvoering", Fase: "XQ Proefw", Afdeling: "NV Proeftunnel" }),
  ]), { vandaag: TODAY, raaktDistrict });
  assert.deepEqual(innames.map((i) => i.gipodId), [99000001, 99000007]);
  assert.deepEqual(tellers, { gelezen: 7, status: 1, geen_id: 0, geen_gipod: 1, geen_einddatum: 1, datum: 0, voorbij: 1, geometrie: 0, buiten_district: 1, bewaard: 2 });
  assert.deepEqual([innames[1].fase, innames[1].afdeling], ["", "AWV"]);
  assert.deepEqual([innames[0].van, innames[0].tot, innames[0].uuid], ["2026-10-01", "2026-11-30", uuid(1)]);
});

test("innames lezen faalt gesloten: geen FeatureCollection, meer gemeld dan gegeven, of de grens van 2000 bereikt", () => {
  assert.deepEqual(leesInnames({ features: [] }, { vandaag: TODAY, raaktDistrict }), { fout: "awv_ongeldig" });
  assert.deepEqual(leesInnames(collectie([inname(1)], { numberMatched: 5 }), { vandaag: TODAY, raaktDistrict }), { fout: "awv_afgekapt" });
  const vol = Array.from({ length: MAX_INNAMES }, (_, i) => inname(i + 1));
  assert.deepEqual(leesInnames(collectie(vol), { vandaag: TODAY, raaktDistrict }), { fout: "awv_afgekapt" });
});

test("bouwen: één item per GIPOD-id met omleidingen; het bestand is geldig en privacyveilig", () => {
  const { innames } = leesInnames(collectie([
    inname(1, { Milderende_maatregelen: "Omleidingen: >3,5t" }),
    inname(2, { GIPOD_ID: 99000001, Fase: "november", Inname_van_datum: "2026-09-20T07:00:00", Innametypes: "Pechstrook" }),
    inname(3, { Werf_ID: 90002, Afdeling: "Lantis" }),
  ]), { vandaag: TODAY, raaktDistrict });
  const { perInname } = leesOmleidingen([collectie([omleiding(1), omleiding(2, "ALLE_WEGGEBRUIKERS"), omleiding(99)])], innames.map((i) => i.uuid));
  const items = bouwSupplement(innames, perInname);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    gipodId: 99000001, werfId: 90001, afdeling: "Antwerpen", soort: ["(Her)aanleg", "Rijbaan incl. riolering", "VRI"], fasen: ["Fase 2", "november"],
    date: "2026-09-20", endDate: "2026-11-30", innametypes: ["Rijstrook 2,1", "Middenberm", "Pechstrook"], doorgang: ["1 rijstrook, versmald"],
    snelheidsbeperking: true, doorsteek: false, bypass: [], omleidingVoor: ["alle verkeer", "voertuigen boven 3,5 ton", "fietsers"], lokaleOmleidingen: 2,
    opUvRoute: false, gewijzigd: "2026-10-10", innames: 2,
  });
  const document = sourceDocument(AWV_WERF_SOURCE_ID, { retrievedAt: "2026-10-17T05:00:00.000Z", fetchStatus: "ok", items });
  assert.deepEqual(validateSourceDocument(document, { expectedSourceId: AWV_WERF_SOURCE_ID }), []);
  assert.deepEqual(privacyFindings(document), []);
  // Geen vrije tekst of extra veld: een sleutel buiten de vaste lijst of een fase buiten het patroon is ongeldig.
  assert.match(validateAwvSupplementItems([{ ...items[0], omschrijving: "Proefstraat 12" }]).join("\n"), /onbekende sleutel omschrijving/);
  assert.match(validateAwvSupplementItems([{ ...items[0], fasen: ["XQ Proefw"] }]).join("\n"), /ongeldige fasen/);
  assert.match(validateAwvSupplementItems([items[1], items[0]]).join("\n"), /niet gesorteerd/);
});

test("de bron staat in het register met een eigen budget van 60 s en is een aanvulling, geen agendabron", () => {
  const fetcher = FETCHERS.find((f) => f.sourceIds.includes(AWV_WERF_SOURCE_ID));
  assert.equal(fetcher.budgetMs, 60_000);
  assert.equal(FETCHERS.at(-1).name, "district-ebesluit-evenementen", "eBesluit-evenementen blijft als laatste");
  const definitie = SOURCE_DEFINITIONS[AWV_WERF_SOURCE_ID];
  assert.deepEqual([definitie.aanvulling, definitie.scope, definitie.bootstrapOptional, definitie.shrinkGuard], [true, "district", true, false]);
  assert.match(definitie.attribution.text, /^Bron: Agentschap Wegen en Verkeer \(AWV\)/);
});

test("fetcher: schrijft het bestand, vraagt alleen de vaste velden en de omleidingen van de eigen innames", async (t) => {
  const root = maakRoot(t);
  const wfs = nepWfs();
  const [status] = await run({ rootDir: root, fetch: wfs.fetch, clock, env: {}, log: quiet, grens: GRENS });
  assert.deepEqual([status.fetchStatus, status.itemCount, status.errorCode], ["ok", 2, null]);
  assert.equal(wfs.urls.length, 2);
  assert.doesNotMatch(wfs.urls.join("\n"), /Omschrijving|Buffer_publicatie/);
  assert.equal(new URL(wfs.urls[1]).searchParams.get("CQL_FILTER"), `Inname_ID IN ('${uuid(1)}','${uuid(2)}')`);
  const document = JSON.parse(fs.readFileSync(bestand(root), "utf8"));
  assert.deepEqual(validateSourceDocument(document, { expectedSourceId: AWV_WERF_SOURCE_ID }), []);
  assert.equal(document.contentVersion, "2026-10-10", "de jongste wijziging in de data, voor 'bijgewerkt op'");
  assert.deepEqual(document.items.map((i) => [i.gipodId, i.lokaleOmleidingen]), [[99000001, 1], [99000002, 0]]);
});

test("fetcher faalt gesloten: een fout of een afgekapt antwoord laat het vorige bestand byte voor byte staan", async (t) => {
  const root = maakRoot(t);
  await run({ rootDir: root, fetch: nepWfs().fetch, clock, env: {}, log: quiet, grens: GRENS });
  const voor = fs.readFileSync(bestand(root), "utf8");
  const [kapot] = await run({ rootDir: root, fetch: nepWfs({ innameStatus: 503 }).fetch, clock, env: {}, log: quiet, grens: GRENS });
  assert.deepEqual([kapot.fetchStatus, kapot.errorCode, kapot.itemCount], ["error", "http_503", 2]);
  const na = JSON.parse(fs.readFileSync(bestand(root), "utf8"));
  assert.deepEqual(na.items, JSON.parse(voor).items);
  assert.equal(na.retrievedAt, JSON.parse(voor).retrievedAt, "het ophaalmoment blijft dat van de laatste goede data");
  const [afgekapt] = await run({ rootDir: root, fetch: nepWfs({ extra: { numberMatched: 9 } }).fetch, clock, env: {}, log: quiet, grens: GRENS });
  assert.deepEqual([afgekapt.fetchStatus, afgekapt.errorCode], ["error", "awv_afgekapt"]);
  const [geenJson] = await run({ rootDir: root, fetch: async () => antwoord("<html>"), clock, env: {}, log: quiet, grens: GRENS });
  assert.deepEqual([geenJson.fetchStatus, geenJson.errorCode], ["error", "not_json"]);
  assert.deepEqual(JSON.parse(fs.readFileSync(bestand(root), "utf8")).items, JSON.parse(voor).items);
});

test("fetcher: 0 innames na een ronde met meer dan 20 is een krimp; met AGENDA_ALLOW_DROP mag het", async (t) => {
  const root = maakRoot(t);
  const veel = Array.from({ length: MIN_VORIGE_VOOR_NUL + 1 }, (_, i) => inname(i + 1));
  await run({ rootDir: root, fetch: nepWfs({ innames: veel, omleidingen: [] }).fetch, clock, env: {}, log: quiet, grens: GRENS });
  const [krimp] = await run({ rootDir: root, fetch: nepWfs({ innames: [], omleidingen: [] }).fetch, clock, env: {}, log: quiet, grens: GRENS });
  assert.deepEqual([krimp.fetchStatus, krimp.errorCode, krimp.itemCount], ["error", "suspicious_drop", MIN_VORIGE_VOOR_NUL + 1]);
  const [toegelaten] = await run({ rootDir: root, fetch: nepWfs({ innames: [], omleidingen: [] }).fetch, clock, env: { AGENDA_ALLOW_DROP: AWV_WERF_SOURCE_ID }, log: quiet, grens: GRENS });
  assert.deepEqual([toegelaten.fetchStatus, toegelaten.itemCount], ["ok", 0]);
});

test("refresh-status: de bron krijgt haar eigen regel, ook bij een fout, en de verversing breekt niet", async (t) => {
  const root = maakRoot(t);
  const fetcher = FETCHERS.find((f) => f.sourceIds.includes(AWV_WERF_SOURCE_ID));
  const goed = await refreshAll({ rootDir: root, fetchers: [fetcher], fetch: nepWfs().fetch, clock, log: quiet });
  assert.deepEqual(validateRefreshStatus(goed), []);
  const regel = goed.sources.find((e) => e.sourceId === AWV_WERF_SOURCE_ID);
  assert.deepEqual([regel.fetchStatus, regel.itemCount, regel.upcomingCount, regel.contentStatus], ["ok", 2, 2, "ok"]);
  const fout = await refreshAll({ rootDir: root, fetchers: [fetcher], fetch: async () => { throw new Error("netwerk weg"); }, clock, log: quiet });
  const foutRegel = fout.sources.find((e) => e.sourceId === AWV_WERF_SOURCE_ID);
  assert.deepEqual([foutRegel.fetchStatus, foutRegel.errorCode, foutRegel.itemCount], ["error", "network_error", 2]);
  assert.deepEqual(validateRefreshStatus(fout), []);
});

test("de aanvulling komt nooit in de agendafeed: build:sources slaat het bestand over", async (t) => {
  const root = maakRoot(t);
  await run({ rootDir: root, fetch: nepWfs().fetch, clock, env: {}, log: quiet, grens: GRENS });
  assert.ok(fs.existsSync(bestand(root)));
  const { documents } = readSources(root);
  assert.equal(documents.some((d) => d.sourceId === AWV_WERF_SOURCE_ID), false);
  const feed = fs.readFileSync(new URL("../site/agenda-feed.js", import.meta.url), "utf8");
  assert.doesNotMatch(feed, /awv-werf-supplement/);
});
