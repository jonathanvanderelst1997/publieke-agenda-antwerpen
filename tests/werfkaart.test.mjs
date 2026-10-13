// Eén werfkaart via het dossiernummer (vaagheidsplan van 12 oktober 2026, stap 4): de werfzone in A-Sign, het werk in
// GIPOD met hetzelfde dossiernummer (Reference) en de parkeerverboden met dezelfde fasen worden één kaart. Nooit op datum
// alleen; op een omleidingsstraat alleen de dagen dat die straat op de omleiding ligt. Verzonnen proefdata.
import test from "node:test";
import assert from "node:assert/strict";

import { collectWorks, werfDossier } from "../site/works-core.js";
import { faseDoelen, soortVanWerk, werkKaartje, werkFeiten } from "../site/kaart-uitleg.js";
import { bundelSoort, publicSpaceEntries, samenWerven, werkEntries, parkeerverbodVoorWerf, werfzoneIndex } from "../site/place-core.js";
import { validateKaartUitleg } from "../lib/kaart-uitleg-validatie.mjs";
import { vormVoor } from "../site/kaart-lagen.js";

const VANDAAG = "2099-03-01";
const straat = (name) => ({ id: name, name, postcode: "2060" });
const PROEF = straat("Proefstraat"), ANDER = straat("Anderestraat"), OMWEG = straat("Omwegstraat");

// Een GIPOD-werk zoals collectWorks het maakt (zonder omschrijving: "Werk in openbaar domein").
const werk = (gipodId, dossier, extra = {}) => ({
  gipodId, ...(dossier ? { dossier } : {}), title: "Werk in openbaar domein", owner: "Stad Antwerpen - Stadsontwikkeling", ownerGroup: "Stad Antwerpen",
  status: "In uitvoering", start: "2099-02-01T06:00:00Z", end: "2099-06-30T16:00:00Z", workTypes: [], occupancyTypes: ["Andere"], sourceUrls: [],
  point: [4.43, 51.23], streets: [PROEF], ...extra,
});
const fase = (dossier, nr, van, tot, { werfzone = [PROEF], omleiding = [], kind = "Werfzone" } = {}) => ({
  id: `sgw:${dossier}|${nr}`, kind: "sgw", kindLabel: kind, title: kind, location: "", reference: dossier, detail: `Fase ${nr}`, status: "vergund",
  start: van, end: tot, streets: [...werfzone, ...omleiding], werfzoneStreets: werfzone, omleidingStreets: omleiding,
});
const verbod = (ref, van, tot, { reden = "Melding ikv werfsignalisaties", plek = PROEF, nr = 1 } = {}) => ({
  id: `parking:${ref}|${nr}`, kind: "parking", kindLabel: "Parkeerverbod", title: reden, reason: reden, location: `${plek.name}, 2060 Antwerpen`,
  start: van, end: tot, status: "Goedgekeurd", reference: ref, detail: "", startTime: "07:00", endTime: "17:00", weekdaysOnly: false, streets: [plek],
});
const uitlegMet = (werken) => ({ werken });
const bouw = ({ works = [], rows = [], uitleg = null, straatNaam = PROEF.name, alle = rows }) => samenWerven(
  [...werkEntries(works, { vandaag: VANDAAG, uitleg }), ...publicSpaceEntries(rows, { vandaag: VANDAAG, alle, uitleg, straat: straatNaam })],
  { uitleg, straat: straatNaam, vandaag: VANDAAG, alle },
);

test("GIPOD Reference: alleen het dossiernummer van een werfzone, nooit vrije tekst", () => {
  assert.equal(werfDossier("GW2026-001601"), "GW2026-001601");
  for (const v of ["304633167_koppelput Gas (Proef Persoon)", "Proefstraat 12 Burcht", "AWV:Werf=WerfId(1)", "GW2026-1601", "", null]) assert.equal(werfDossier(v), "");
  const punt = (id, ref) => ({ type: "Feature", geometry: { type: "Point", coordinates: [4.4, 51.2] }, properties: { GipodId: id, Reference: ref, Description: null, Owner: "Proefbeheerder", Status: "In uitvoering", Start: "2099-01-01T06:00:00Z", End: "2099-01-02T16:00:00Z" } });
  const [a, b] = collectWorks([punt(1, "GW2099-000001"), punt(2, "lucienne proefstraat 10 Beveren")], new Set([1, 2]));
  assert.equal(a.dossier, "GW2099-000001");
  assert.ok(!("dossier" in b) && !JSON.stringify(b).includes("lucienne"), "vrije tekst gaat nooit mee");
  // De verversing bewaart het nummer (werkFeiten), en validateKaartUitleg weigert een ander patroon.
  assert.equal(werkFeiten({ gipodId: 1, dossier: "GW2099-000001" }).dossier, "GW2099-000001");
  assert.equal(werkFeiten({ gipodId: 1, dossier: "Proefstraat 3" }).dossier, undefined);
  const doc = (dossier) => ({ schemaVersion: 1, generatedAt: "2099-01-01T00:00:00Z", vanaf: "2099-01-01", tot: "2099-03-01", evenementen: {},
    werken: { 1: { dossier, soort: "", soortBron: "", omschrijving: "", opdrachtgever: "", huisnummers: "", huisnummerBron: "", bijgewerkt: "", straten: [], gevolgen: [], fasen: [] } } });
  assert.deepEqual(validateKaartUitleg(doc("GW2099-000001")), []);
  assert.deepEqual(validateKaartUitleg(doc("Proefstraat 3 Burcht")), ["werken.1.dossier ongeldig"]);
});

test("de fasen die iets zeggen: geen nummer, plancode, datum of 'Fictieve fase'; een reeks nachten één keer", () => {
  assert.deepEqual(faseDoelen(["Fase 1", "Fictieve fase", "Fase 1 - plan 26-00889-01", "P26-02644-06/07/08", "Fase 2 : Werken zelf", "Fase 1 : vervolg GW2099-000001", "Fase 6 - 12/10-22u tem 13/10-6u"]), []);
  assert.deepEqual(faseDoelen(["Onderbouw deel 2", "bovenbouw", "Fase 2 - periode tijdens stelling - plan 26-03086-02", "Fase 1 : Maaien"]), ["Onderbouw deel 2", "bovenbouw", "stelling", "Maaien"]);
  assert.deepEqual(faseDoelen(["Onderhoudssluiting Proeftunnel nacht 1", "Onderhoudssluiting Proeftunnel nacht 2"]), ["Onderhoudssluiting Proeftunnel"]);
});

test("werfzone, GIPOD-werk en parkeerverboden met dezelfde fasen: één werfkaart met het waarvoor uit de fasen", () => {
  const uitleg = uitlegMet({ 501: { dossier: "GW2099-000501", soort: "", soortBron: "", omschrijving: "", opdrachtgever: "Stad Antwerpen - Stadsontwikkeling", straten: ["Proefstraat"], gevolgen: [], huisnummers: "", huisnummerBron: "", bijgewerkt: "", fasen: [{ naam: "Onderbouw deel 2", start: "2099-02-01", eind: "2099-04-10" }, { naam: "bovenbouw", start: "2099-04-11", eind: "2099-06-30" }] } });
  const rows = [
    fase("GW2099-000501", 1, "2099-02-01T06:00:00Z", "2099-04-10T16:00:00Z", { omleiding: [ANDER], kind: "Omleiding + Werfzone" }),
    fase("GW2099-000501", 2, "2099-04-11T06:00:00Z", "2099-06-30T16:00:00Z"),
    verbod("2099-000001", "2099-02-01T00:00:00.000Z", "2099-04-10T00:00:00.000Z"),
    verbod("2099-000002", "2099-04-11T00:00:00.000Z", "2099-06-30T00:00:00.000Z"),
    // Een parkeerverbod voor een verhuis op dezelfde dagen hoort er niet bij.
    verbod("2099-000003", "2099-02-01T00:00:00.000Z", "2099-04-10T00:00:00.000Z", { reden: "Aanvraag tot een verhuis" }),
  ];
  const works = [werk(501, "", { start: "2099-02-01T06:00:00Z" })];
  const kaarten = bouw({ works, rows, uitleg });
  assert.equal(kaarten.length, 2, "één werfkaart en het parkeerverbod voor een verhuis");
  // Een volgende tekenbeurt (nieuwe kaarten uit dezelfde rijen): dezelfde werfkaart, niet opnieuw gemaakt. Een ander
  // parkeerverbod: een nieuwe.
  assert.equal(bouw({ works, rows, uitleg }).find((e) => e.source === "works"), kaarten.find((e) => e.source === "works"));
  const minder = bouw({ works, rows: rows.filter((r) => r.reference !== "2099-000002"), uitleg }).find((e) => e.source === "works");
  assert.notEqual(minder, kaarten.find((e) => e.source === "works"));
  assert.deepEqual(minder.werf.parkeerverboden, ["2099-000001"]);
  const k = kaarten.find((e) => e.source === "works");
  assert.equal(k.uid, "works:501", "de uid van het werk blijft (deellink, open kaartje)");
  assert.match(k.title, /^Bouwwerf in de Proefstraat/, "onderbouw en bovenbouw: een bouwwerf, afgeleid uit de fasen");
  assert.doesNotMatch(JSON.stringify(k), /Werken van Stad Antwerpen|Opdrachtgever/);
  const regels = Object.fromEntries(k.uitleg.regels);
  // Wat de losse kaarten zeiden, blijft (nakijkronde 13 oktober 2026): hoe de werfzone de straat raakt, haar status, en
  // bij de parkeerverboden hun status en de reden van de stad.
  assert.match(regels.Werfzone, /^De werfzone ligt in je straat; het verkeer wordt omgeleid · Werfzone in Proefstraat · Omleiding via Anderestraat · 2 fasen: .* · status in A-Sign: vergund door de stad · A-Sign, dossier GW2099-000501$/);
  assert.match(regels.Parkeerverbod, /\(2099-000001, [^)]+\) · .*\(2099-000002, [^)]+\)\. Reden volgens de stad: [^.]*werfsignalisaties\. Zelfde straat en dezelfde dagen als een fase van de werfzone/);
  assert.equal(regels["Beheerder in GIPOD"], "Stad Antwerpen - Stadsontwikkeling");
  assert.deepEqual(k.werf, { dossier: "GW2099-000501", werfzone: "publicSpace:sgw:GW2099-000501|1", parkeerverboden: ["2099-000001", "2099-000002"] });
  assert.equal(k.onbekend, undefined, "het waarvoor staat in de fasen");
  // De buurtkaart tekent ook de werfzone en de parkeerverboden (werfRijen).
  assert.equal(k.werfRijen.length, 4);
  assert.ok(vormVoor({ ...k, werfRijen: [{ kind: "sgw", vorm: { vlakken: [[[[4.4, 51.2], [4.41, 51.2], [4.41, 51.21], [4.4, 51.2]]]], lijnen: [] } }] }).length >= 2);
});

test("nooit op datum alleen: twee werfzones met dezelfde data hebben elk hun eigen werk; een parkeerverbod met twee kandidaten blijft los", () => {
  const leeg = (dossier) => ({ dossier, soort: "", soortBron: "", omschrijving: "", opdrachtgever: "Stad Antwerpen - Stadsontwikkeling", straten: ["Proefstraat"], gevolgen: [], huisnummers: "", huisnummerBron: "", bijgewerkt: "", fasen: [{ naam: "Fase 3", start: "2099-02-01", eind: "2099-06-30" }] });
  const uitleg = uitlegMet({ 611: leeg("GW2099-000611"), 612: leeg("GW2099-000612") });
  const rows = [
    fase("GW2099-000612", 1, "2099-02-01T06:00:00Z", "2099-06-30T16:00:00Z"),
    fase("GW2099-000611", 1, "2099-02-01T06:00:00Z", "2099-06-30T16:00:00Z"),
    verbod("2099-000010", "2099-02-01T00:00:00.000Z", "2099-06-30T00:00:00.000Z"),
  ];
  assert.deepEqual(parkeerverbodVoorWerf(publicSpaceEntries([rows[2]], { vandaag: VANDAAG })[0], rows).sort(), ["GW2099-000611", "GW2099-000612"]);
  // Met de index (één keer per samenWerven) hetzelfde; een fase die er dubbel in staat, telt één keer.
  const index = werfzoneIndex([...rows, ...rows]);
  assert.deepEqual([...index.values()].map((l) => l.length), [2]);
  assert.deepEqual(parkeerverbodVoorWerf(publicSpaceEntries([rows[2]], { vandaag: VANDAAG })[0], index).sort(), ["GW2099-000611", "GW2099-000612"]);
  // Twee werken met een andere einddatum (anders zijn ze één werf in stukken, zie hieronder).
  const kaarten = bouw({ works: [werk(612, "GW2099-000612"), werk(611, "GW2099-000611", { end: "2099-06-29T16:00:00Z" })], rows, uitleg });
  const werven = kaarten.filter((e) => e.source === "works");
  assert.equal(werven.length, 2);
  for (const w of werven) assert.equal(w.werf.dossier, `GW2099-000${w.item.gipodId}`, "elk werk bij zijn eigen werfzone, op het nummer");
  assert.ok(kaarten.some((e) => e.item?.kind === "parking"), "twee werfzones met dezelfde dagen: het parkeerverbod blijft een eigen kaart");
  // Zonder fase die iets zegt: de kaart heet "Werf", en de meter telt ze als vaag (onbekend).
  assert.match(werven[0].title, /^Werf in de Proefstraat/);
  assert.deepEqual(werven[0].onbekend, [{ meter: "werf-zonder-doel", kern: true }]);
  // Twee GIPOD-stukken met dezelfde titel en periode zijn één werf in stukken (werkEntries): dan beide werfzones erin.
  const [samen] = bouw({ works: [werk(612, "GW2099-000612"), werk(611, "GW2099-000611")], rows: rows.slice(0, 2), uitleg }).filter((e) => e.source === "works");
  assert.deepEqual(samen.werf.dossiers, ["GW2099-000612", "GW2099-000611"]);
  assert.equal(samen.uitleg.regels.filter(([dt]) => dt === "Werfzone").length, 2);
});

test("een werfzone zonder werk op de plek: het waarvoor uit GIPOD (zelfde dossiernummer); op de omleiding alleen die dagen", () => {
  const uitleg = uitlegMet({ 701: { dossier: "GW2099-000701", soort: "Betonstort", soortBron: "fasen van de hinder in GIPOD", omschrijving: "", opdrachtgever: "Stad Antwerpen - Stadsontwikkeling", straten: ["Anderestraat"], gevolgen: [], huisnummers: "", huisnummerBron: "", bijgewerkt: "", fasen: [{ naam: "betonstort", start: "2099-03-12", eind: "2099-03-12" }] } });
  // De werf ligt in de Anderestraat; de Omwegstraat ligt alleen op 12 en 22 maart op de omleiding.
  const alle = [
    fase("GW2099-000701", 1, "2099-02-17T06:00:00Z", "2099-04-02T16:00:00Z", { werfzone: [ANDER] }),
    fase("GW2099-000701", 2, "2099-03-12T05:00:00Z", "2099-03-12T15:00:00Z", { werfzone: [ANDER], omleiding: [OMWEG], kind: "Omleiding + Werfzone" }),
    fase("GW2099-000701", 3, "2099-03-22T05:00:00Z", "2099-03-22T15:00:00Z", { werfzone: [ANDER], omleiding: [OMWEG], kind: "Omleiding + Werfzone" }),
  ];
  const hier = alle.filter((r) => r.omleidingStreets.length);
  const [k] = bouw({ rows: hier, alle, uitleg, straatNaam: OMWEG.name });
  assert.equal(k.title, "Omleiding voor werken in de Anderestraat");
  // Een soort die de site uit de namen van de fasen afleidt, is geen uitspraak van GIPOD: "afgeleid uit".
  assert.match(k.summary, /Waarvoor, afgeleid uit de namen van de fasen in GIPOD \(zelfde dossiernummer\): betonstort\.$/);
  assert.doesNotMatch(k.summary, /publiceert niet waarvoor/);
  assert.deepEqual([k.start, k.end], ["2099-03-12", "2099-03-22"], "alleen de dagen op de omleiding, niet 17 feb tot 2 apr");
  assert.deepEqual(k.fasen, [["2099-03-12", "2099-03-12"], ["2099-03-22", "2099-03-22"]]);
  assert.match(Object.fromEntries(k.regels)["Hele werfzone"], /^17 feb – 2 apr \(in je straat alleen op de dagen van deze kaart\)$/);
  assert.match(Object.fromEntries(k.regels)["Werf volgens GIPOD"], /^Betonstort \(afgeleid uit de namen van de fasen in GIPOD\) · werk in de Anderestraat · beheerder in GIPOD: Stad Antwerpen - Stadsontwikkeling · GIPOD 701, zelfde dossiernummer$/);
  // GIPOD met alleen een genummerde fase: de eerlijke zin blijft, geen verzonnen doel.
  const zonder = uitlegMet({ 701: { ...uitleg.werken[701], soort: "Wegenwerken", soortBron: "soort inname in GIPOD", fasen: [{ naam: "Fase 1", start: "2099-03-12", eind: "2099-03-22" }] } });
  const [z] = bouw({ rows: hier, alle, uitleg: zonder, straatNaam: OMWEG.name });
  assert.match(z.summary, /De stad publiceert niet waarvoor deze werfzone dient\./);
  assert.doesNotMatch(z.title, /voor werken/);
});

test("een fasenaam die niet zegt waarvoor, en 'Afbraak werf', geven geen doel: de werfzone blijft zonder doel", () => {
  // Nakijkronde 12 oktober 2026: deze namen stonden als "Waarvoor, volgens GIPOD".
  assert.deepEqual(faseDoelen(["extra dag", "project", "opbouw", "werf", "Perimeter afzetting", "Inkrimping van de werfzone", "Werf in- en uitrit", "Eind afwerking", "Koordekenshoef Fase 1",
    "aangepaste recurrente fase Proefstraat", "Globaal", "Werkzaamheden", "silo", "Project Proefnaam - De Proef"]), []);
  // Een naam die een werk noemt wel, zonder wie het doet.
  assert.deepEqual(faseDoelen(["Demontage bouwkraan", "Levering van een container door Proeffirma BV", "kelderwerken", "terugplaatsen hekwerk"]), ["Demontage bouwkraan", "Levering van een container", "kelderwerken", "terugplaatsen hekwerk"]);
  // "Afbraak werf" of "F3 Afbraak" na "F2 werf" is het afbreken van de werf, geen sloop; een kale "afbraak" ook niet.
  for (const fasen of [["Fase 2 : Werken zelf", "Fase 3 : Afbraak werf"], ["F2 werf", "F3 Afbraak"], ["Fase na afbraak TK1"], ["afbraak"]]) assert.equal(soortVanWerk({ fasen }).soort, "", fasen.join(" / "));
  for (const fasen of [["Sloopwerkzaamheden"], ["afbraakwerken, kelderdichting, ruwbouwwerken"], ["Afbraak van de woning"]]) assert.equal(soortVanWerk({ fasen }).soort, "Sloopwerken", fasen.join(" / "));
  // Een bewaarde soort "Sloopwerken" uit zulke fasen (de verversing van vóór deze regel): opnieuw afgeleid, dus geen doel.
  const oud = { dossier: "GW2099-000901", soort: "Sloopwerken", soortBron: "fasen van de hinder in GIPOD", omschrijving: "", opdrachtgever: "Stad Antwerpen - Stadsontwikkeling", straten: ["Anderestraat"], gevolgen: [], huisnummers: "", huisnummerBron: "", bijgewerkt: "",
    fasen: [{ naam: "F2 werf", start: "2099-02-01", eind: "2099-03-30" }, { naam: "F3 Afbraak", start: "2099-03-31", eind: "2099-04-02" }] };
  const rows = [fase("GW2099-000901", 1, "2099-02-01T06:00:00Z", "2099-04-02T16:00:00Z")];
  const [z] = bouw({ rows, uitleg: uitlegMet({ 901: oud }) });
  assert.match(z.summary, /De stad publiceert niet waarvoor deze werfzone dient\./);
  assert.doesNotMatch(z.summary, /Waarvoor,|[Ss]loop/);
  assert.equal(bundelSoort(z), "werfzones", "blijft in de bundel zonder doel (en telt in de meter als vaag)");
  // Een fase die een werk noemt: letterlijk, als naam van de fase.
  const [w] = bouw({ rows, uitleg: uitlegMet({ 901: { ...oud, soort: "", soortBron: "", fasen: [{ naam: "Demontage bouwkraan", start: "2099-02-01", eind: "2099-04-02" }] } }) });
  assert.match(w.summary, /Waarvoor, volgens de namen van de fasen in GIPOD \(zelfde dossiernummer\): “Demontage bouwkraan”\.$/);
  assert.equal(bundelSoort(w), "");
});

test("werkKaartje met een werf: 'Werf' in plaats van 'Werken van Stad Antwerpen', de beheerder in GIPOD", () => {
  const w = werk(801, "GW2099-000801");
  const k = werkKaartje(w, { vandaag: VANDAAG, feiten: { ...werkFeiten(w), soort: "", soortBron: "", fasen: [{ naam: "Gevelstelling", start: "2099-02-01", eind: "2099-06-30" }] }, werf: { dossier: "GW2099-000801" } });
  assert.match(k.titel, /^Werf in de Proefstraat/);
  assert.equal(Object.fromEntries(k.regels)["Beheerder in GIPOD"], "Stad Antwerpen - Stadsontwikkeling");
  assert.match(Object.fromEntries(k.regels).Wat, /werfzone GW2099-000801 in A-Sign\. De fasen in GIPOD zeggen wat er gebeurt: “Gevelstelling”\./);
  assert.match(k.samenvatting, /^Volgens de fasen in GIPOD: Gevelstelling\. Beheerder in GIPOD: /);
  // Zonder werf blijft het zoals vroeger.
  assert.match(werkKaartje(w, { vandaag: VANDAAG }).titel, /^Werken van Stad Antwerpen/);
});
