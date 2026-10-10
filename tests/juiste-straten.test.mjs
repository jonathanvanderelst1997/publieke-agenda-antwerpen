// Herstelplan O2: parcours, vergunningen en werken aan de juiste straten, en een straal die ook werkt
// voor items zonder punt. Vaste straatassen en een vast parcours (verzonnen), zonder live datums.
//
//            Langsstraat (x=600, noord)
//                 |
//   Verrestraat (y=80, x 0–500)          het parcours: een vlak van 24 m breed langs de Leiweg
//   ----------------                     (y=0, x 0–600) en dan noordwaarts door de Langsstraat.
//   ===Leiweg=====|=====|====+           Kruisstraat (x=300) kruist het; Zijstraat (x=450) komt
//            Kruisstraat  Zijstraat      erop uit; Verrestraat ligt 80 m verder en raakt het niet.
import test from "node:test";
import assert from "node:assert/strict";

import { buildStreetIndex, resolveGeometryStreets } from "../site/street-core.js";
import { parcoursGeometrie, stratenVanParcours } from "../site/parcours-straten.js";
import { evenementEntry, evenementStraten, permitEntry, straatRelatie, verfijnVoorStraat, vergunningWaar, workEntry } from "../site/place-core.js";
import { collectPermits } from "../site/permits-live-core.js";
import { createAgendaView } from "../site/agenda-view.js";
import { createAreaMatcher } from "../site/neighborhood-map.js";
import { bouwKaartUitleg, stratenVanWerfzone, validateKaartUitleg } from "../lib/kaart-uitleg-refresh.mjs";

// Meter rond een vaste oorsprong naar lengte- en breedtegraad.
const m = (x, y) => [4.4 + x / 69760, 51.2 + y / 110540];
const as = (id, naam, punten, postcode = 2000) => ({ type: "Feature", properties: { DISTRICT: "ANTWERPEN", LSTRNMID: id, LSTRNM: naam, RSTRNMID: id, RSTRNM: naam, postcode }, geometry: { type: "LineString", coordinates: punten.map(([x, y]) => m(x, y)) } });
const ASSEN = [
  as(1, "Leiweg", [[0, 0], [300, 0], [450, 0], [600, 0]]),
  as(2, "Langsstraat", [[600, 0], [600, 300]]),
  as(3, "Kruisstraat", [[300, -200], [300, 0], [300, 200]]),
  as(4, "Zijstraat", [[450, 0], [450, 200]]),
  as(5, "Verrestraat", [[0, 80], [500, 80]]),
  as(6, "Naaststraat", [[100, -30], [200, -30]]), // 30 m naast het parcours: binnen 18 m van niets
];
const INDEX = buildStreetIndex(ASSEN);
// Het vlak van het parcours (A-Sign laag 22): een L van 24 m breed.
const VLAK = { rings: [[[-20, -12], [612, -12], [612, 300], [588, 300], [588, 12], [-20, 12], [-20, -12]].map(([x, y]) => m(x, y))] };
// Een ruwe schets van het parcours (laag 23): dwars door de huizenblokken, ook over de Verrestraat.
const SCHETS = { paths: [[[0, 0], [250, 120], [600, 300]].map(([x, y]) => m(x, y))] };

test("parcours: straten waar het door loopt apart van straten die het alleen kruist", () => {
  const p = stratenVanParcours(parcoursGeometrie([{ geometry: VLAK }]), INDEX);
  assert.deepEqual(p.langs, ["Langsstraat", "Leiweg"]);
  assert.deepEqual(p.kruist, ["Kruisstraat", "Zijstraat"]);
  // Met een vlak telt de ruwe schets niet: de Verrestraat blijft buiten.
  assert.deepEqual(stratenVanParcours(parcoursGeometrie([{ geometry: VLAK }, { geometry: SCHETS }]), INDEX), p);
  // Alleen een lijn: dezelfde indeling, met een marge rond de lijn.
  const lijn = { paths: [[[0, 0], [600, 0], [600, 300]].map(([x, y]) => m(x, y))] };
  assert.deepEqual(stratenVanParcours(parcoursGeometrie([{ geometry: lijn }]), INDEX), p);
  // Voor één straat (snel in de browser): hetzelfde antwoord.
  assert.deepEqual(stratenVanParcours(parcoursGeometrie([{ geometry: VLAK }]), INDEX, { alleen: new Set(["Kruisstraat"]) }), { langs: [], kruist: ["Kruisstraat"] });
  // De oude manier (18 m rond het vlak) nam ook de kruisende straten als "betrokken" straat.
  assert.ok(resolveGeometryStreets(VLAK, INDEX).streets.some((s) => s.name === "Kruisstraat"));
});

// Rijen zoals de live laag ze geeft: de straten op 18 m (ook kruisende) en de vorm van het parcours.
const rij = (extra = {}) => ({
  id: "iod:ET2099000001|F1|I1", kind: "iod", reference: "ET2099000001", dossierType: "ETL", innameType: "Parcours", title: "Parcours",
  phase: "Evenement", status: "aanvraag_goedgekeurd", start: "2026-10-13T06:00:00Z", end: "2026-10-13T16:00:00Z",
  streets: ["Kruisstraat", "Langsstraat", "Leiweg", "Zijstraat"].map((name, i) => ({ id: String(i + 1), name, postcode: "2000" })),
  parcours: parcoursGeometrie([{ geometry: VLAK }]), ...extra,
});

test("één stratenlijst: verversing, anders de browser, en 'jouw straat' op het kaartje", () => {
  const rows = [rij()];
  assert.deepEqual(evenementStraten(rows, { index: INDEX }), { langs: ["Langsstraat", "Leiweg"], kruist: ["Kruisstraat", "Zijstraat"], bron: "browser" });
  const bewaard = { straten: ["Langsstraat", "Leiweg"], kruist: ["Kruisstraat", "Zijstraat"] };
  assert.equal(evenementStraten(rows, { bewaard }).bron, "verversing");
  // Een bestand van vóór de berekening: alles in "langs", de gekozen straat wordt nagekeken.
  const oud = evenementStraten(rows, { bewaard: { straten: ["Kruisstraat", "Langsstraat", "Leiweg"] } });
  assert.deepEqual(oud.langs, ["Kruisstraat", "Langsstraat", "Leiweg"]);
  const verfijnd = verfijnVoorStraat(oud, "Kruisstraat", rows, INDEX);
  assert.equal(straatRelatie("Kruisstraat", verfijnd), "kruist");
  assert.equal(straatRelatie("Leiweg", verfijnVoorStraat(oud, "Leiweg", rows, INDEX)), "langs");

  const opties = { vandaag: "2026-10-06", index: INDEX, wijkVan: () => "" };
  const kruist = evenementEntry(rows, { ...opties, straat: "Kruisstraat" });
  assert.equal(kruist.jouwStraat, "Je straat kruist het parcours");
  // Na de samenvoeging met de evenementkaart (#140) staat "Jouw straat" bovenaan in de kaart (kern).
  assert.equal(Object.fromEntries(kruist.uitleg.kern)["Jouw straat"], "Jouw straat kruist het parcours of komt erop uit.");
  assert.deepEqual(kruist.straten, ["Langsstraat", "Leiweg"], "een kruisende straat telt niet als betrokken straat");
  assert.deepEqual(kruist.kruist, ["Kruisstraat", "Zijstraat"]);
  assert.match(Object.fromEntries(kruist.uitleg.kern).Waar, /^Parcours door Langsstraat, Leiweg \(/);
  assert.equal(evenementEntry(rows, { ...opties, straat: "Leiweg" }).jouwStraat, "Het parcours loopt door je straat");
  assert.equal(evenementEntry(rows, { ...opties, straat: "Verrestraat", straal: 500 }).jouwStraat, "Niet in je straat, wel binnen 500 m");
  assert.equal(evenementEntry(rows, opties).jouwStraat, "", "zonder gekozen straat geen regel");
});

test("de filter gebruikt dezelfde lijst als het kaartje", () => {
  const rows = [rij({ streets: [...rij().streets, { id: "6", name: "Naaststraat", postcode: "2000" }] })];
  const lijst = evenementStraten(rows, { index: INDEX });
  const view = createAgendaView();
  view.setStreetLists((item) => (item?.kind === "iod" ? [...lijst.langs, ...lijst.kruist].map((name) => ({ name })) : null));
  const op = (naam) => { view.setStreet(naam, { name: naam, postcode: "2000" }); return view.matchesStreet(rows[0]); };
  assert.ok(op("Leiweg"));
  assert.ok(op("Kruisstraat"), "een kruisende straat ziet het parcours, met de uitleg dat het haar kruist");
  assert.ok(!op("Naaststraat"), "een straat die niet op het kaartje staat, krijgt het ook niet in de lijst");
  // Een straat uit de lijst van de verversing die de live rij niet kent (Oudesteenweg, Van Ertbornstraat).
  const view2 = createAgendaView();
  view2.setStreetLists(() => [{ name: "Oudesteenweg" }]);
  view2.setStreet("Oudesteenweg", { id: "9", name: "Oudesteenweg", postcode: "2060" });
  assert.ok(view2.matchesStreet(rij({ streets: [{ id: "1", name: "Leiweg", postcode: "2000" }] })));
});

test("straal zonder punt: telt mee als zijn eigen vorm binnen de straal ligt", () => {
  const view = createAgendaView();
  view.setAreaMatcher(createAreaMatcher({ wijken: [], geo: { entries: {} }, streetIndex: INDEX }));
  view.setStreet("Verrestraat", { id: "5", name: "Verrestraat", postcode: "2000" });
  // Het parcours (vlak VLAK) ligt 68 m van de Verrestraat; een perceel 6 m naast de Zijstraat.
  const parcours = { kind: "iod", streets: [{ id: "2", name: "Langsstraat", postcode: "2000" }], vorm: parcoursGeometrie([{ geometry: VLAK }]) };
  const perceel = { rings: [[[456, 13], [470, 13], [470, 40], [456, 40], [456, 13]].map(([x, y]) => m(x, y))] };
  const vergunning = { id: "permit:1", streets: [{ name: "Zijstraat" }], vorm: parcoursGeometrie([{ geometry: perceel }]) };
  assert.ok(!view.matchesStreet(parcours), "alleen de straat zelf");
  view.setArea({ radius: 250 });
  assert.ok(view.matchesStreet(parcours));
  assert.ok(view.matchesStreet(vergunning));
  const ver = { kind: "iod", streets: [{ id: "x", name: "Verweg", postcode: "2000" }] };
  assert.ok(!view.matchesStreet(ver), "zonder vorm en zonder punt: alleen in de straat zelf");
  // Met een eigen punt beslist het punt (een werk van GIPOD).
  assert.ok(!view.matchesStreet({ point: m(3000, 3000), streets: [{ name: "Langsstraat", postcode: "2000" }] }));
});

test("vergunning: de dichtste straat eerst, de andere als 'ook dicht bij'", () => {
  // Een perceel 6 m naast de Zijstraat en 13 m van de Leiweg (beide binnen 24 m).
  const perceel = { rings: [[[456, 13], [470, 13], [470, 40], [456, 40], [456, 13]].map(([x, y]) => m(x, y))] };
  const [permit] = collectPermits({ features: [{ attributes: { Dossiernummer: "OMV_2099000001", DOSSIERTYPE: "Omgevingsvergunning" }, geometry: perceel }], streetIndex: INDEX });
  assert.deepEqual(permit.streets.map((s) => s.name), ["Zijstraat", "Leiweg"]);
  assert.equal(permitEntry(permit).location, "Zijstraat · ook dicht bij Leiweg");
  assert.equal(vergunningWaar([{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }, { name: "E" }]), "A · ook dicht bij B, C en 2 andere straten");
  assert.equal(vergunningWaar([{ name: "A" }]), "A");
});

test("verversing: parcours met 'kruist' apart, werk met de straten van zijn werfzone", async () => {
  const ms = (iso) => Date.parse(iso);
  const iod = (geometry, innameId) => ({ attributes: { dossierNummer: "ET2099000001", faseId: "F1", innameId, dossierStatus: "aanvraag_goedgekeurd", faseNaam: "Evenement", type_dossier: "ETL", innameTypeNaam: "Parcours", faseStartDatum: ms("2026-10-13T06:00:00Z"), faseEindDatum: ms("2026-10-13T16:00:00Z") }, geometry });
  const district = { type: "Polygon", coordinates: [[m(-1000, -1000), m(2000, -1000), m(2000, 2000), m(-1000, 2000), m(-1000, -1000)]] };
  // Een werk met zijn GIPOD-punt in de Leiweg; de werfzone loopt tot 4 m van de as van de Kruisstraat.
  const werk = { gipodId: 90000009, title: "Werk in openbaar domein", status: "Concreet gepland", start: "2026-10-20T06:00:00Z", end: "2026-11-20T16:00:00Z", owner: "Stad Antwerpen - Voorbeelddienst", streets: [{ id: "1", name: "Leiweg", postcode: "2000" }], lastModified: "2026-10-01T00:00:00Z" };
  const zone = { type: "Polygon", coordinates: [[[250, -8], [296, -8], [296, 8], [250, 8], [250, -8]].map(([x, y]) => m(x, y))] };
  const fetch = async (url) => ({ ok: true, json: async () => (String(url).includes("GIPOD") ? { features: [{ geometry: zone }] } : { features: [] }) });
  const { document } = await bouwKaartUitleg({ works: [werk], iodFeatures: [iod(VLAK, "I1"), iod(SCHETS, "I2")], district, streetFeatures: ASSEN, fetch, clock: () => new Date("2026-10-06T05:00:00Z") });
  const e = document.evenementen.ET2099000001;
  assert.deepEqual(e.straten, ["Langsstraat", "Leiweg"]);
  assert.deepEqual(e.kruist, ["Kruisstraat", "Zijstraat"]);
  assert.deepEqual(document.werken["90000009"].vlakStraten, ["Leiweg", "Kruisstraat"]);
  // Een straatas zonder naam (komt voor in de stadslaag) geeft geen lege straat.
  const metLeeg = buildStreetIndex([...ASSEN, as(7, " ", [[260, -5], [280, -5]])]);
  assert.deepEqual(stratenVanWerfzone(zone.coordinates, metLeeg), ["Leiweg", "Kruisstraat"]);
  assert.deepEqual(validateKaartUitleg(document), []);
  assert.ok(validateKaartUitleg({ ...document, evenementen: { ET2099000001: { ...e, kruist: [12] } } }).some((x) => /kruist ongeldig/.test(x)));
  // De site neemt die straten over: bij "Waar" én in de filter.
  const w = workEntry(werk, { vandaag: "2026-10-06", uitleg: document });
  assert.match(Object.fromEntries(w.uitleg.regels).Waar, /^Leiweg, Kruisstraat/);
  const kaart = evenementEntry([rij()], { vandaag: "2026-10-06", uitleg: document, straat: "Zijstraat" });
  assert.equal(kaart.jouwStraat, "Je straat kruist het parcours");
});
