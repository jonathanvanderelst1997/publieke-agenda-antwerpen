// Nakijkronde van head 29588b0c (regel van de eigenaar van 26 oktober 2026: altijd het huisnummer, nooit de reden van een
// inname, nooit het woord verhuis). Alle straten, nummers, namen en firma's zijn verzonnen; geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";

import * as V from "../site/werk-vorm.js";
import { werkStraten, werkZoektekst } from "../site/works-live.js";
import { itemVoorHistoriek } from "../lib/historiek-privacy.mjs";
import { alleenHuisnummerErbij, compactWorkItem, updateLiveHistory } from "../lib/live-history.mjs";
import { werkZonderVerhuis } from "../scripts/opkuis-verhuis.mjs";

const PROEF = { id: "9101", name: "Proefstraat", postcode: "2000" };
const werk = (extra = {}) => ({
  gipodId: 990001, title: "Werk in openbaar domein", owner: "Stad Antwerpen - Proefdienst", ownerGroup: "Stad Antwerpen", status: "In uitvoering",
  start: "2099-03-01T06:00:00Z", end: "2099-03-30T16:00:00Z", workTypes: [], occupancyTypes: [], lastModified: "2099-02-01T00:00:00Z",
  recordCount: 1, boundaryConfidence: "point_inside_new", hindrance: null, hindranceSourceLoaded: true,
  streets: [PROEF], streetResolution: "nearest_official_axis", streetDistanceMeters: 3, ...extra,
});
const fase = (description) => ({ description, start: "2099-03-12T06:00:00Z", end: "2099-03-12T16:00:00Z", consequences: [] });
const B = (ids = []) => ({ schema: 1, adreskaart: [], gewoon: ids });
const poort = (item, vorm = B([990001])) => V.werkenVoorDeSite([item], vorm)[0];

test("de soort inname heet nooit Lift/levering: de werkenlijst toont \"Inname\"", () => {
  for (const t of ["(Verhuis)lift/levering", "(VERHUIS)LIFT/LEVERING", "Lift/levering", "lift / levering"]) assert.equal(V.innameZonderVerhuis(t), "Inname", t);
  const w = poort(werk({ occupancyTypes: ["Container;(Verhuis)lift/levering"] }));
  assert.deepEqual(w.occupancyTypes, ["Container;Inname"]);
  assert.doesNotMatch(werkZoektekst(w), /lift|levering/i);
});

test("een inname voor een lift of levering die al een gewone kaart was: geen reden en geen firma, wel het huisnummer", () => {
  const w = poort(werk({
    title: "Levering archiefcontainer Proefstraat 14", owner: "Proeffirma Jansens BV", ownerGroup: "Andere", occupancyTypes: ["(Verhuis)lift/levering"],
    hindrance: { severe: false, consequences: [], start: "2099-03-12T06:00:00Z", end: "2099-03-12T16:00:00Z", phases: [fase("Levering door Proeffirma Jansens BV"), fase("Fase 2")] },
    aSignSupplement: { companies: ["Proeffirma Jansens BV"], workTypes: [], phaseStatuses: [], trafficImpacts: [], phases: [{ company: "Proeffirma Jansens BV" }] },
  })); // verzonnen
  assert.equal(w.adresKaart, undefined, "de vaste vorm (gewoon) blijft");
  assert.equal(w.title, "Inname – Proefstraat 14");
  assert.equal(V.lijstTitel(w), "Inname – Proefstraat 14");
  assert.deepEqual(w.hindrance.phases.map((p) => p.description), ["Inname – Proefstraat", "Fase 2"]);
  assert.equal(w.owner, "");
  assert.doesNotMatch(JSON.stringify(w), /Jansens|archiefcontainer|Levering/);
  assert.deepEqual(V.werkenVoorDeSite([w], B([990001]))[0], w, "een tweede keer verandert niets");
});

test("lijstTitel: het nummer uit een fase of het adressenregister staat erachter als de titel het niet noemt", () => {
  const uitFase = werk({ title: "Werk in openbaar domein", hindrance: { severe: false, consequences: [], phases: [fase("fase 2 Proefstraat 1")] } });
  assert.equal(V.lijstTitel(uitFase), "Werk in openbaar domein – Proefstraat 1");
  const uitleg = { werken: { 990002: { straten: ["Proefstraat"], huisnummers: "nr. 33" }, 990003: { straten: ["Testlaan"], huisnummers: "nr. 8" } } };
  const [hoofdletters, andereStraat] = V.metRegisterNummers([werk({ gipodId: 990002, title: "2000 ANTWERPEN, PROEFSTRAAT" }), werk({ gipodId: 990003, title: "2000 ANTWERPEN, PROEFSTRAAT" })], uitleg);
  assert.equal(V.lijstTitel(hoofdletters), "2000 ANTWERPEN, PROEFSTRAAT 33");
  assert.equal(werkStraten(hoofdletters), "Proefstraat 33");
  assert.equal(V.lijstTitel(andereStraat), "2000 ANTWERPEN, PROEFSTRAAT", "een nummer van een andere straat komt er niet bij");
  // Staat het nummer al in de titel, dan niets erbij; een tweede keer ook niet.
  const al = V.metRegisterNummers([werk({ gipodId: 990002, title: "2000 Antwerpen, Proefstraat 12 - herstelling" })], uitleg)[0];
  assert.equal(V.lijstTitel(al), "2000 Antwerpen, Proefstraat 12 - herstelling");
  assert.equal(V.lijstTitel({ ...hoofdletters, title: V.lijstTitel(hoofdletters) }), "2000 ANTWERPEN, PROEFSTRAAT 33");
  // Een adreskaart zonder nummer uit GIPOD krijgt dat van het register.
  const adres = V.metRegisterNummers([{ ...V.adreskaartItem(werk({ gipodId: 990002, occupancyTypes: ["Container"] })), gipodId: 990002 }], uitleg)[0];
  assert.equal(V.lijstTitel(adres), "Container – Proefstraat 33");
});

test("de historiek bewaart het nummer in de titel, ook als het uit een fase komt", () => {
  const item = itemVoorHistoriek({ id: "work:990001", ...werk({ title: "Werk in openbaar domein", hindrance: { severe: false, consequences: [], phases: [fase("fase 2 Proefstraat 1")] } }) });
  assert.equal(compactWorkItem(item).title, "Werk in openbaar domein – Proefstraat 1");
});

test("een titel die alleen een huisnummer bijkreeg, is geen wijziging; een ander of weggevallen nummer wel", () => {
  for (const [oud, nieuw] of [["2018 ANTWERPEN, PROEFLEI", "2018 ANTWERPEN, PROEFLEI 33"], ["Proefstraat - werken aan nutsleiding - 224m.", "Proefstraat - 135 - werken aan nutsleiding - 224m."], ["Werk in openbaar domein", "Werk in openbaar domein – Proefstraat 1"], ["Inname – Proefstraat", "Inname – Proefstraat 21"], ["2050 ANTWERPEN, PROEFLAAN", "2050 ANTWERPEN, PROEFLAAN 14 A"], ["2018 ANTWERPEN, PROEFLEI", "2018 ANTWERPEN, PROEFLEI 36IV"]]) assert.equal(alleenHuisnummerErbij(oud, nieuw), true, nieuw);
  for (const [oud, nieuw] of [["Proefstraat 12", "Proefstraat 14"], ["Proefstraat 12", "Proefstraat"], ["Werk", "Ander werk 12"], ["Proefstraat", "Proefstraat"]]) assert.equal(alleenHuisnummerErbij(oud, nieuw), false, `${oud} -> ${nieuw}`);
  const laag = (title, status = "In uitvoering") => ({ ok: true, items: [werk({ title, status })] });
  const eerst = updateLiveHistory(null, { observedAt: "2099-03-10T05:00:00.000Z", worksResult: laag("2018 ANTWERPEN, PROEFLEI"), publicSpaceResult: { ok: true, items: [] } });
  const daarna = updateLiveHistory(eerst, { observedAt: "2099-03-11T05:00:00.000Z", worksResult: laag("2018 ANTWERPEN, PROEFLEI 33", "Concreet gepland"), publicSpaceResult: { ok: true, items: [] } });
  assert.deepEqual(daarna.changes.map((c) => c.fields), [["status"]]);
  assert.equal(daarna.layers.works.items[0].title, "2018 ANTWERPEN, PROEFLEI 33");
});

test("opkuis-verhuis: een bewaarde inname voor een lift of levering zonder reden en met \"Inname\"", () => {
  const item = werkZonderVerhuis({ id: "work:990001", title: "Werk in openbaar domein", owner: "Proeffirma Jansens BV", ownerGroup: "Andere", occupancyTypes: ["Lift/levering"], streets: [PROEF] }, { sorteer: true }); // verzonnen
  assert.deepEqual([item.title, item.owner, item.occupancyTypes], ["Inname – Proefstraat", "", ["Inname"]]);
  const uitleg = werkZonderVerhuis({ soort: "Inname", soortBron: "soort inname in GIPOD", omschrijving: "", opdrachtgever: "Proeffirma Jansens BV", straten: ["Proefstraat"], fasen: [{ naam: "Levering door Proeffirma Jansens BV" }, { naam: "Fase 2" }] }); // verzonnen
  assert.deepEqual(uitleg.fasen.map((f) => f.naam), ["Inname – Proefstraat", "Fase 2"]);
  assert.equal(uitleg.opdrachtgever, "");
  assert.deepEqual(werkZonderVerhuis(uitleg), uitleg, "een tweede keer verandert niets");
});
