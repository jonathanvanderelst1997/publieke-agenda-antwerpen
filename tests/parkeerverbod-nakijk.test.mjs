// Nakijkronde van 18 oktober 2026 op "parkeerverbod zonder reden" (besluit van de eigenaar: DAT er een parkeerverbod is,
// WAAR exact en WANNEER, nooit waarom; intern mag de reden nog meetellen, bv. om bij een werfzone te bundelen).
// 1. De ochtendstand (de straatbestanden) bewaart de reden niet meer, en hing daardoor geen parkeerverbod meer aan zijn
//    werfzone: op origin/main 437 koppelingen in 231 straatbestanden, op de tak 0. Nu legt de verversing het verband zelf
//    (met de reden die alleen zij kent) en bewaart ze alleen het dossiernummer van de werfzone (`werfzoneDossier`): dat
//    verband toont de werfkaart ook. Ook een straatbestand van vóór 18 oktober (de reden als titel) houdt het verband.
// 2. De werfkaart zei niet WAAR het parkeerverbod ligt: de regel "Parkeerverbod" had de periode, de uren, het nummer en de
//    status, maar niet het adres (het huisnummer of bereik van publiekParkeerAdres, live).
// 3. Het nieuwe veld `werfzoneDossier` is publiek (een straatbestand): alleen een dossiernummer van een werfzone, alleen bij
//    een parkeerverbod. De bouwer laat al het andere weg, en validate-data meldt het zonder de waarde te noemen.
// Verzonnen straten, nummers en dossiers; echte straat-id's alleen uit site/geo/straten.json (Kammenstraat).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { collectPublicSpace } from "../site/public-space-live-core.js";
import { bundelLijst, parkeerverbodVoorWerf, publicSpaceEntries, samenWerven, werkEntries } from "../site/place-core.js";
import { duidelijkeKaart } from "../site/permit-clarity.js";
import { lagenUitStand } from "../site/straat-snapshot.js";
import { itemVoorStraat, schrijfStraatSnapshots, verzamelStraatBronnen } from "../scripts/build-straat-snapshots.mjs";
import { fetchPublicSpaceHistory } from "../scripts/refresh-live-history.mjs";
import { straatBestandenProblemen } from "../lib/straat-bestanden.mjs";
import { KAM, maakWerkmap } from "./helpers/straat-fixture.mjs";

const VANDAAG = "2099-03-01";
const PROEF = { id: "Proefstraat", name: "Proefstraat", postcode: "2000" };
const WERF = "Melding ikv werfsignalisaties";
const VERRAAD = /werfsignal|\bikv\b|in het kader van|verhuis|[Rr]eden|Parkeerverbod (?:voor|met)\b/;
const uur = (h) => Date.UTC(1899, 11, 30, h); // A-Sign bewaart een uur als een tijdstip op 30 december 1899
const ms = (iso) => Date.parse(`${iso}T00:00:00Z`);

// Een werfzonefase van 20 februari tot 20 maart 2099 in de Proefstraat, en een parkeerverbod op precies die dagen.
const fase = (dossier, nr, van, tot, straat = PROEF) => ({ id: `sgw:${dossier}|${nr}`, kind: "sgw", kindLabel: "Werfzone", title: "Werfzone", location: "", reference: dossier, detail: `Fase ${nr}`, status: "vergund", start: van, end: tot, streets: [straat], werfzoneStreets: [straat], omleidingStreets: [] });
const asignVerbod = (attrs = {}) => ({ attributes: { Dossiernummer: "2099-000901", Locatienummer: "1", Status: "Goedgekeurd", Adres: "Proefstraat 12-14 2000 Antwerpen", Postcode: "2000", Reden: WERF, Startdatum: ms("2099-02-20"), Einddatum: ms("2099-03-20"), Starttijd: uur(7), Eindtijd: uur(17), EnkelWeekdagen: "0", GipodID: null, District: "ANTWERPEN", ...attrs } });
// Zoals de browser het live maakt (alleenLive: het huisnummer of bereik van publiekParkeerAdres).
const liveVerbod = (attrs = {}) => ({ ...collectPublicSpace({ parkingFeatures: [asignVerbod(attrs)], alleenLive: true })[0], streets: [PROEF] });
const zichtbaar = (e) => JSON.stringify([e.title, e.summary, e.info, e.location, e.regels, e.uitleg, duidelijkeKaart(e, e.item || {}, { straat: PROEF.name, vandaag: VANDAAG })]);

test("werfkaart: het parkeerverbod staat er met zijn plaats, exact (huisnummer of bereik), ook na een tekenbeurt met de ochtendstand", () => {
  const live = liveVerbod();
  assert.equal(live.location, "Proefstraat 12–14, 2000 Antwerpen");
  // Een werfzone zonder werk in GIPOD (werfzoneMetWerf).
  const zone = fase("GW2099-000901", 1, "2099-02-20T06:00:00Z", "2099-03-20T16:00:00Z");
  const rows = [zone, live];
  const [werfzone] = samenWerven(publicSpaceEntries(rows, { vandaag: VANDAAG, alle: rows, straat: PROEF.name }), { straat: PROEF.name, vandaag: VANDAAG, alle: rows });
  assert.deepEqual(werfzone.werf?.parkeerverboden, ["2099-000901"]);
  const regel = (werfzone.regels || []).find(([k]) => k === "Parkeerverbod")?.[1] || "";
  assert.match(regel, /^Proefstraat 12–14, 2000 Antwerpen: 20 feb – 20 mrt, van 7\.00 tot 17\.00 uur \(2099-000901, /, regel);
  assert.doesNotMatch(zichtbaar(werfzone), VERRAAD);

  // Een werfkaart met een werk in GIPOD (werfKaart, bewaard per werk): eerst de ochtendstand (straat en postcode), dan live
  // met het bereik. Zelfde parkeerverbod, zelfde dagen: de bewaarde kaart mag niet de plaats van de ochtend houden.
  const uitleg = { werken: { 901: { dossier: "GW2099-000901", soort: "", soortBron: "", omschrijving: "", opdrachtgever: "Proefbeheerder", straten: ["Proefstraat"], gevolgen: [], huisnummers: "", huisnummerBron: "", bijgewerkt: "", fasen: [] } } };
  const werk = { gipodId: 901, title: "Werk in openbaar domein", owner: "Proefbeheerder", ownerGroup: "Proefbeheerder", status: "In uitvoering", start: "2099-02-20T06:00:00Z", end: "2099-03-20T16:00:00Z", workTypes: [], occupancyTypes: ["Andere"], point: [4.43, 51.23], streets: [PROEF] };
  const bouw = (verbod) => samenWerven([...werkEntries([werk], { vandaag: VANDAAG, uitleg }), ...publicSpaceEntries([zone, verbod], { vandaag: VANDAAG, alle: [zone, verbod], uitleg, straat: PROEF.name })], { uitleg, straat: PROEF.name, vandaag: VANDAAG, alle: [zone, verbod] }).find((e) => e.source === "works");
  const ochtend = bouw({ ...live, location: "Proefstraat, 2000 Antwerpen" });
  assert.match(JSON.stringify(ochtend.uitleg.regels), /"Parkeerverbod","Proefstraat, 2000 Antwerpen: 20 feb – 20 mrt/);
  const nu = bouw(live);
  assert.deepEqual(nu.werf.parkeerverboden, ["2099-000901"]);
  const tekst = zichtbaar(nu);
  assert.ok(tekst.includes("Proefstraat 12–14, 2000 Antwerpen: 20 feb – 20 mrt"), tekst);
  assert.doesNotMatch(tekst, VERRAAD);
});

test("parkeerverbodVoorWerf: het bewaarde dossier van de werfzone telt zonder reden; zonder reden en zonder dossier niet", () => {
  const zone = fase("GW2099-000901", 1, "2099-02-20T06:00:00Z", "2099-03-20T16:00:00Z");
  const ochtend = { id: "parking:2099-000901|1", kind: "parking", title: "Parkeerverbod", reference: "2099-000901", start: "2099-02-20T00:00:00.000Z", end: "2099-03-20T00:00:00.000Z", startTime: "07:00", endTime: "17:00", streets: [PROEF], werfzoneDossier: "GW2099-000901" };
  assert.deepEqual(parkeerverbodVoorWerf({ item: ochtend }, [zone]), ["GW2099-000901"]);
  // Ook als de werfzone zelf niet in het kader ligt: de verversing zag alle werfzones van de stad.
  assert.deepEqual(parkeerverbodVoorWerf({ item: ochtend }, []), ["GW2099-000901"]);
  // Geen reden en geen bewaard dossier (een parkeerverbod voor iets anders): nooit bij een werfzone, ook niet op dezelfde dagen.
  const { werfzoneDossier, ...ander } = ochtend;
  assert.equal(werfzoneDossier, "GW2099-000901");
  assert.deepEqual(parkeerverbodVoorWerf({ item: ander }, [zone]), []);
  // Geen vrije tekst als dossier.
  assert.deepEqual(parkeerverbodVoorWerf({ item: { ...ochtend, werfzoneDossier: "Proefstraat 12" } }, [zone]), []);
  // Live (met de reden) en een bundelrij van de ochtend (de andere straat, met het dossier) samen: één werfzone.
  const live = { ...liveVerbod(), id: "parking:2099-000901|1" };
  const bundel = { ...ochtend, id: "parking:2099-000901|2|bundel", streets: [{ id: "Tweedestraat", name: "Tweedestraat", postcode: "2000" }], bundel: true };
  assert.deepEqual(parkeerverbodVoorWerf({ item: live, rijen: [live, bundel] }, [zone]), ["GW2099-000901"]);
  // Een andere reden live maakt het geen werfparkeerverbod, ook niet met een bundelrij van de ochtend.
  const verhuis = { ...live, reason: "Verhuis" };
  assert.deepEqual(parkeerverbodVoorWerf({ item: verhuis, rijen: [verhuis, bundel] }, [zone]), []);
});

// Een nagebootste A-Sign die alleen de gevraagde velden teruggeeft (outFields): de verversing moet de reden zelf vragen
// om het verband te leggen, maar bewaart ze nergens.
function nepAsign({ verboden, zones }) {
  const district = { type: "Polygon", coordinates: [[[4.38, 51.2], [4.43, 51.2], [4.43, 51.24], [4.38, 51.24], [4.38, 51.2]]] };
  return async (input) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/MapServer/109/")) return Response.json({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: district }] });
    const laag = url.pathname.match(/\/P_ASign\/ASign\/MapServer\/(\d+)\/query$/)?.[1];
    if (!laag) return new Response("", { status: 404 });
    const rijen = laag === "20" ? verboden : laag === "48" ? zones : [];
    if (url.searchParams.get("returnIdsOnly") === "true") return Response.json({ objectIds: rijen.map((r) => r.attributes.OBJECTID) });
    const velden = (url.searchParams.get("outFields") || "").split(",");
    return Response.json({ features: rijen.map((r) => ({ attributes: Object.fromEntries(velden.filter((v) => v in r.attributes).map((v) => [v, r.attributes[v]])), geometry: r.geometry })) });
  };
}
const werkmap = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "parkeerverbod-nakijk-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  maakWerkmap(root, { uitleg: { schemaVersion: 1, werken: {}, evenementen: {} } });
  return root;
};
// Wat de plekpagina van de Kammenstraat toont uit alleen het straatbestand (live A-Sign laadt niet).
function ochtendKaarten(root, vandaag) {
  const doc = JSON.parse(fs.readFileSync(path.join(root, "site", "straat", `${KAM.id}.json`), "utf8"));
  const rijen = lagenUitStand({ doc }, { vandaag }).publicSpace;
  const hier = rijen.filter((r) => (r.streets || []).some((s) => s.id === KAM.id));
  const kaarten = samenWerven(publicSpaceEntries(hier, { vandaag, alle: rijen, straat: KAM.name }), { straat: KAM.name, vandaag, alle: rijen });
  return { doc, kaarten, lijst: bundelLijst(kaarten, { straat: KAM.name, vandaag }) };
}

test("ochtendstand na een verversing: het parkeerverbod voor een werf hangt aan zijn werfzone, zonder reden in het bestand", async (t) => {
  const [x1, y1, x2, y2] = [4.40025, 51.21571, 4.40208, 51.21878]; // langs de Kammenstraat
  const lijn = { paths: [[[x1, y1], [x2, y2]]] };
  const vlak = { rings: [[[x1 - 0.0002, y1 - 0.0002], [x2 + 0.0002, y1 - 0.0002], [x2 + 0.0002, y2 + 0.0002], [x1 - 0.0002, y2 + 0.0002], [x1 - 0.0002, y1 - 0.0002]]] };
  const verbod = (oid, dossier, reden) => ({ attributes: { ...asignVerbod({ Dossiernummer: dossier, Adres: "Kammenstraat 3-5 2000 Antwerpen", Reden: reden, Startdatum: ms("2099-03-08"), Einddatum: ms("2099-03-20") }).attributes, OBJECTID: oid }, geometry: lijn });
  const zones = [{ attributes: { OBJECTID: 11, reference_id: "GW2099-000881", phase_id: "P1", status: "vergund", StartDate: ms("2099-03-08"), EndDate: ms("2099-03-20") }, geometry: vlak }];
  const verboden = [verbod(1, "2099-000881", WERF), verbod(2, "2099-000882", "Aanvraag tot een verhuis met of zonder ladderlift, verhuiswagen")];
  const nep = nepAsign({ verboden, zones });
  const resultaat = await fetchPublicSpaceHistory({ fetch: nep, clock: () => new Date("2099-03-10T04:00:00Z"), streets: null });
  assert.equal(resultaat.ok, true, JSON.stringify(resultaat));
  const root = werkmap(t);
  const straatAs = { type: "Feature", properties: { LSTRNMID: Number(KAM.id), LSTRNM: KAM.name, RSTRNMID: Number(KAM.id), RSTRNM: KAM.name, postcode: 2000, DISTRICT: "Antwerpen" }, geometry: { type: "LineString", coordinates: [[x1, y1], [x2, y2]] } };
  const bronnen = await verzamelStraatBronnen({ rootDir: root, observedAt: "2099-03-10T04:22:00.000Z", worksResult: { ok: true, items: [] }, publicSpaceResult: resultaat, streetFeatures: [straatAs] });
  // Het tussenbestand (.cache, nooit publiek) draagt de reden evenmin.
  assert.doesNotMatch(fs.readFileSync(path.join(root, ".cache", "straat-bronnen.json"), "utf8"), /"reason"|werfsignal|verhuis/i);
  schrijfStraatSnapshots({ rootDir: root, bronnen, agendaItems: [], history: null, clock: () => new Date("2099-03-10T09:00:00.000Z") });
  const { doc, kaarten, lijst } = ochtendKaarten(root, "2099-03-10");
  const tekst = JSON.stringify(doc);
  assert.doesNotMatch(tekst, /"reason"|werfsignal|\bikv\b|verhuis/i, "de reden staat nergens in het straatbestand");
  assert.deepEqual(doc.publiekeRuimte.filter((i) => i.kind === "parking").map((i) => [i.reference, i.title, i.werfzoneDossier ?? null]).sort(),
    [["2099-000881", "Parkeerverbod", "GW2099-000881"], ["2099-000882", "Parkeerverbod", null]]);
  assert.deepEqual(straatBestandenProblemen(root), []);
  // De plekpagina uit het straatbestand: één werfkaart met het parkeerverbod voor de werf; dat voor de verhuis blijft los.
  const werf = kaarten.find((e) => e.item?.kind === "sgw");
  assert.deepEqual(werf?.werf?.parkeerverboden, ["2099-000881"]);
  assert.deepEqual(kaarten.filter((e) => e.item?.kind === "parking").map((e) => e.item.reference), ["2099-000882"]);
  // En de werfzone valt dus niet weg in de ingeklapte regel "werfzones zonder doel".
  assert.ok(lijst.losse.includes(werf));
  assert.equal(lijst.bundels.length, 0);
  assert.doesNotMatch(zichtbaar(werf), VERRAAD);
});

test("ochtendstand uit een straatbestand van vóór 18 oktober (de reden als titel): herschreven zonder reden, met het verband", (t) => {
  const root = werkmap(t);
  fs.mkdirSync(path.join(root, "site", "straat"), { recursive: true });
  const TWEEDE = { id: "2289", name: "Peterseliestraat", postcode: "2000" };
  const oudVerbod = (ref, nr, reden, straten, extra = {}) => ({ id: `parking:${ref}|${nr}`, kind: "parking", kindLabel: "Parkeerverbod", title: reden, location: "Kammenstraat, 2000 Antwerpen", start: "2099-03-08T00:00:00.000Z", end: "2099-03-20T00:00:00.000Z", status: "Goedgekeurd", reference: ref, detail: "", reason: reden, postcode: "2000", startTime: "07:00", endTime: "17:00", weekdaysOnly: false, streets: straten, ...extra });
  const oud = {
    schemaVersion: 1, ververst: "2099-03-10T04:22:00.000Z", inhoud: "abc123abc123",
    straat: { id: KAM.id, namen: [{ name: KAM.name, postcode: KAM.postcode }] }, kader: [4.4, 51.215, 4.403, 51.219],
    straten: [[KAM.id, KAM.name, KAM.postcode], [TWEEDE.id, TWEEDE.name, TWEEDE.postcode]],
    werken: [], vergunningen: [], terrassen: [], evenementen: [],
    publiekeRuimte: [
      { id: "sgw:GW2099-000881|P1", kind: "sgw", kindLabel: "Werfzone", title: "Werfzone", location: "", start: "2099-03-08T06:00:00.000Z", end: "2099-03-20T16:00:00.000Z", status: "vergund", reference: "GW2099-000881", detail: "Fase P1", streets: [0, 1], werfzoneStreets: [0, 1], omleidingStreets: [] },
      oudVerbod("2099-000881", 1, WERF, [0]),
      // De andere plaats van hetzelfde parkeerverbod (een bundelrij), toen nog met de reden.
      { id: "parking:2099-000881|2|bundel", kind: "parking", reference: "2099-000881", start: "2099-03-08T00:00:00.000Z", end: "2099-03-20T00:00:00.000Z", startTime: "07:00", endTime: "17:00", weekdaysOnly: false, reason: WERF, title: WERF, streets: [1], bundel: true },
      oudVerbod("2099-000882", 1, "Aanvraag tot een verhuis met of zonder ladderlift, verhuiswagen", [0]),
    ],
  };
  fs.writeFileSync(path.join(root, "site", "straat", `${KAM.id}.json`), JSON.stringify(oud));
  fs.writeFileSync(path.join(root, "site", "straat-index.json"), JSON.stringify({ schemaVersion: 1, ververst: oud.ververst, lagen: {}, straten: { [KAM.id]: oud.inhoud } }));
  schrijfStraatSnapshots({ rootDir: root, herschrijf: true, agendaItems: [], history: null, clock: () => new Date("2099-03-10T09:00:00.000Z") });
  const { doc, kaarten } = ochtendKaarten(root, "2099-03-10");
  assert.doesNotMatch(JSON.stringify(doc), /"reason"|werfsignal|\bikv\b|verhuis/i);
  assert.deepEqual(doc.publiekeRuimte.filter((i) => i.kind === "parking").map((i) => [i.id, i.title, i.werfzoneDossier ?? null]),
    [["parking:2099-000881|1", "Parkeerverbod", "GW2099-000881"], ["parking:2099-000881|2|bundel", "Parkeerverbod", "GW2099-000881"], ["parking:2099-000882|1", "Parkeerverbod", null]]);
  assert.deepEqual(straatBestandenProblemen(root), []);
  assert.deepEqual(kaarten.find((e) => e.item?.kind === "sgw")?.werf?.parkeerverboden, ["2099-000881"]);
  assert.deepEqual(kaarten.filter((e) => e.item?.kind === "parking").map((e) => e.item.reference), ["2099-000882"]);
  // Nog eens herschrijven verandert niets meer (het verband blijft, zonder reden).
  const tekst = fs.readFileSync(path.join(root, "site", "straat", `${KAM.id}.json`), "utf8");
  schrijfStraatSnapshots({ rootDir: root, herschrijf: true, agendaItems: [], history: null, clock: () => new Date("2099-03-10T09:00:00.000Z") });
  assert.equal(fs.readFileSync(path.join(root, "site", "straat", `${KAM.id}.json`), "utf8"), tekst);
});

test("werfzoneDossier: alleen het dossiernummer van een werfzone, alleen bij een parkeerverbod; nooit vrije tekst in een straatbestand", (t) => {
  const ochtend = { id: "parking:2099-000901|1", kind: "parking", kindLabel: "Parkeerverbod", title: "Parkeerverbod", location: "Kammenstraat, 2000 Antwerpen", reference: "2099-000901", status: "Goedgekeurd", start: "2099-03-08T00:00:00.000Z", end: "2099-03-20T00:00:00.000Z", startTime: "07:00", endTime: "17:00", weekdaysOnly: false, postcode: "2000", streets: [{ id: KAM.id, name: KAM.name, postcode: KAM.postcode }] };
  // De bouwer neemt een geldig nummer over en laat al het andere weg.
  assert.equal(itemVoorStraat({ ...ochtend, werfzoneDossier: "GW2099-000901" })?.werfzoneDossier, "GW2099-000901");
  for (const fout of ["Werf aan Kammenstraat", "werfsignalisatie", "GW2099-000901 verhuis", ""]) {
    const schoon = itemVoorStraat({ ...ochtend, werfzoneDossier: fout });
    assert.ok(schoon, fout);
    assert.equal("werfzoneDossier" in schoon, false, fout);
  }
  assert.equal("werfzoneDossier" in (itemVoorStraat({ id: "sgw:GW2099-000901|1", kind: "sgw", title: "Werfzone", reference: "GW2099-000901", start: "2099-03-08T06:00:00.000Z", end: "2099-03-20T16:00:00.000Z", streets: [], werfzoneDossier: "GW2099-000901" }) || {}), false);
  // De nakijk (validate-data) meldt een bestand met iets anders in dat veld, zonder de waarde te noemen.
  const root = werkmap(t);
  fs.mkdirSync(path.join(root, "site", "straat"), { recursive: true });
  const doc = {
    schemaVersion: 1, ververst: "2099-03-10T04:22:00.000Z", inhoud: "abc123abc123",
    straat: { id: KAM.id, namen: [{ name: KAM.name, postcode: KAM.postcode }] }, straten: [[KAM.id, KAM.name, KAM.postcode]],
    werken: [], vergunningen: [], terrassen: [], evenementen: [],
    publiekeRuimte: [
      { ...ochtend, streets: [0], werfzoneDossier: "GW2099-000901" },
      { ...ochtend, id: "parking:2099-000902|1", reference: "2099-000902", streets: [0], werfzoneDossier: "Werf aan de overkant" },
      { id: "sgw:GW2099-000901|1", kind: "sgw", kindLabel: "Werfzone", title: "Werfzone", location: "", reference: "GW2099-000901", detail: "Fase 1", status: "vergund", start: "2099-03-08T06:00:00.000Z", end: "2099-03-20T16:00:00.000Z", streets: [0], werfzoneStreets: [0], omleidingStreets: [], werfzoneDossier: "GW2099-000901" },
    ],
  };
  fs.writeFileSync(path.join(root, "site", "straat", `${KAM.id}.json`), JSON.stringify(doc));
  fs.writeFileSync(path.join(root, "site", "straat-index.json"), JSON.stringify({ schemaVersion: 1, ververst: doc.ververst, lagen: {}, straten: { [KAM.id]: doc.inhoud } }));
  const problemen = straatBestandenProblemen(root);
  assert.deepEqual(problemen.filter((p) => /werfzoneDossier/.test(p)), [
    `site/straat/${KAM.id}.json: werfzoneDossier geen dossiernummer van een werfzone bij een parkeerverbod op $.publiekeRuimte[1]`,
    `site/straat/${KAM.id}.json: werfzoneDossier geen dossiernummer van een werfzone bij een parkeerverbod op $.publiekeRuimte[2]`,
  ], problemen.join("\n"));
  assert.ok(problemen.every((p) => !/overkant/.test(p)), "de melding noemt nooit de waarde");
});
