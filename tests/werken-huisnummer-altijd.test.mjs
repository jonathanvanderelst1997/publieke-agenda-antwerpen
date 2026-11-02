// Regel van de eigenaar (26 oktober 2026, definitief, "al vijf keer gezegd"): het huisnummer staat er altijd, "gewoon dat ze
// weten waar het is". Ook bij een verhuis: dan verdwijnt alleen het woord ("Inname" of "Parkeerverbod" mét huisnummer).
// Voor de werken van GIPOD: een gewone kaart en een adreskaart, een aansluiting, een container, een inname voor een lift of
// levering en een werk met het spoor van een verhuizing tonen het nummer; nergens het woord verhuis.
// Alle straten, nummers en namen zijn verzonnen (Proefstraat, Testlaan); geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";

import * as V from "../site/werk-vorm.js";
import * as KU from "../site/kaart-uitleg.js";
import { workEntry } from "../site/place-core.js";
import { werkZoektekst } from "../site/works-live.js";
import { onbekendZin } from "../site/onbekend-zinnen.js";

const VANDAAG = "2099-03-10";
const PROEF = { id: "9101", name: "Proefstraat", postcode: "2018" };
const werk = (extra = {}) => ({
  gipodId: 990301, title: "Werk in openbaar domein", owner: "Proefnet", ownerGroup: "Andere", status: "In uitvoering",
  start: "2099-03-01T06:00:00Z", end: "2099-03-30T16:00:00Z", workTypes: [], occupancyTypes: [], lastModified: "2099-02-01T00:00:00Z",
  point: [4.4, 51.22], recordCount: 1, boundaryConfidence: "point_inside_new", hindrance: null, hindranceSourceLoaded: true,
  streets: [PROEF], streetResolution: "nearest_official_axis", streetDistanceMeters: 3, ...extra,
});
const fase = (description) => ({ description, start: "2099-03-12T06:00:00Z", end: "2099-03-12T16:00:00Z", consequences: [] });
const hinder = (fasen) => ({ severe: false, consequences: [], start: "2099-03-11T06:00:00Z", end: "2099-03-20T16:00:00Z", phases: fasen });
const GEWOON = { schema: 1, adreskaart: [], gewoon: [990301] };
const NIEUW = { schema: 1, adreskaart: [], gewoon: [] };
const poort = (item, vorm = GEWOON) => V.werkenVoorDeSite([item], vorm)[0];
const kaart = (item) => KU.werkKaartje(item, { vandaag: VANDAAG });
const waar = (k) => Object.fromEntries(k.regels).Waar;
const alles = (k) => [k.titel, k.samenvatting, k.bronTekst || "", ...k.regels.flat()].join(" · ");

test("een gewone kaart toont één los nummer, ook in de vaste vorm van een beheerder van waterleidingen", () => {
  for (const [titel, nummer] of [
    ["2018 Antwerpen Proefstraat 12 werken distributieleiding)", "nr. 12"],
    ["2018 ANTWERPEN, PROEFSTRAAT 7", "nr. 7"],
    ["Proefstraat 12 - herstelling voetpad", "nr. 12"],
    ["Proefstraat 12 tem 18 - herstelling voetpad", "nr. 12–18"],
  ]) {
    const k = kaart(poort(werk({ title: titel })));
    assert.equal(waar(k), `Proefstraat, ${nummer} (omschrijving van de beheerder)`, titel);
    assert.match(k.titel, new RegExp(`in de Proefstraat ${nummer.replace(".", "\\.")} `), titel);
  }
  // De titel in de lijst en het zoeken: met het nummer.
  const b = poort(werk({ title: "Proefstraat 12 - herstelling voetpad" }));
  assert.equal(V.lijstTitel(b), "Proefstraat 12 - herstelling voetpad");
  assert.ok(werkZoektekst(b).includes("proefstraat 12"));
});

test("een aansluiting en een container tonen het nummer, als gewone kaart en als adreskaart", () => {
  const aansluiting = werk({ title: "2018 ANTWERPEN, PROEFSTRAAT 12", owner: "Fluvius System Operator", ownerGroup: "Fluvius", occupancyTypes: ["Elektriciteit"], workTypes: ["klantaansluiting"] });
  const container = werk({ title: "Proefstraat 12 - container", occupancyTypes: ["Container"] });
  for (const item of [aansluiting, container]) {
    const gewoon = poort(item, GEWOON);
    assert.equal(gewoon.adresKaart, undefined);
    assert.match(waar(kaart(gewoon)), /^Proefstraat, nr\. 12 /, item.title);
    // Een nieuw werk (de vaste vorm kent het nog niet): een adreskaart, ook in de browser meteen met het nummer.
    const nieuw = poort(item, NIEUW);
    assert.equal(nieuw.adresKaart, true, item.title);
    assert.equal(nieuw.huisnummers, "nr. 12", item.title);
    assert.match(waar(kaart(nieuw)), /^Proefstraat, nr\. 12 /, item.title);
  }
});

test("een inname voor een lift of levering en het spoor van een verhuizing: het nummer, nergens het woord", () => {
  const gevallen = [
    werk({ title: "Proefstraat 12 - levering", occupancyTypes: ["(Verhuis)lift/levering"] }),
    werk({ title: "Proefstraat 12 - verhuis" }),
    werk({ title: "Proefstraat 12", hindrance: hinder([fase("Verhuislift Proefstraat 12")]) }),
    werk({ title: "Proefstraat 12", owner: "Proefverhuizingen" }),
  ];
  for (const vorm of [GEWOON, NIEUW]) {
    for (const item of gevallen) {
      const p = poort(item, vorm);
      const k = kaart(p);
      assert.match(waar(k), /^Proefstraat, nr\. 12 /, `${item.title}: ${alles(k)}`);
      assert.match(V.lijstTitel(p), /Proefstraat 12\b/, item.title);
      assert.doesNotMatch(`${alles(k)} ${V.lijstTitel(p)} ${werkZoektekst(p)}`, /verhui/i, item.title);
      assert.equal("eenAdres" in p, false, item.title);
    }
  }
  // Het vangnet in werkFeiten: ook een werk dat de poort niet zag. Het nummer blijft, de tekst met het woord niet.
  const vangnet = KU.werkFeiten(werk({ title: "Verhuis Proefstraat 12" }));
  assert.equal(vangnet.huisnummers, "nr. 12");
  assert.doesNotMatch(JSON.stringify(vangnet), /verhui/i);
  const lift = KU.werkFeiten(werk({ title: "Proefstraat 12", occupancyTypes: ["(Verhuis)lift/levering"] }));
  assert.equal(lift.soort, "Inname");
  assert.equal(lift.huisnummers, "nr. 12");
  assert.equal("eenAdres" in lift, false);
});

test("geen nummer: de kaart zegt waarom alleen als er een getal na de straat staat, anders 'niet gepubliceerd'", () => {
  const NIET = onbekendZin("werk-huisnummers");
  // Een woord na het nummer: het nummer (regel van de eigenaar van 26 oktober 2026).
  assert.equal(waar(kaart(poort(werk({ title: "Proefstraat 12 kabels vervangen" })))), "Proefstraat, nr. 12 (omschrijving van de beheerder)");
  // Een getal na een langere straat met dezelfde naam erin: niet het huisnummer van deze straat, "geen zeker huisnummer", de
  // tekst toont het.
  const twijfel = kaart(poort(werk({ title: "Korte Proefstraat 12 kabels vervangen" })));
  assert.equal(waar(twijfel), `Proefstraat (${KU.NUMMER_WEG.twijfel})`);
  assert.equal(twijfel.ontbreekt.includes(NIET), false);
  assert.match(alles(twijfel), /De beheerder schrijft: “Korte Proefstraat 12 kabels vervangen”/);
  // Een getal elders ("R1", een fase "6A+6B") of een maat is geen huisnummer: dan "niet gepubliceerd".
  for (const item of [werk({ title: "R1 - Proefpark Zuid - Antwerpen" }), werk({ title: "Proefstraat - Testlaan", hindrance: hinder([fase("Fase 6A+6B")]) }), werk({ title: "Proefstraat 30 m - kabel" })]) {
    const k = kaart(poort(item));
    assert.equal(waar(k), "Proefstraat", item.title);
    assert.equal(k.ontbreekt.includes(NIET), true, item.title);
  }
});

test("een los nummer uit het adressenregister staat op de kaart, ook bij een lift of levering", () => {
  const bewaard = (extra = {}) => ({ werken: { 990301: { soort: "", soortBron: "", omschrijving: "", opdrachtgever: "", straten: ["Proefstraat"], huisnummers: "nr. 14", huisnummerBron: "afgeleid uit de werfzone en het adressenregister", gevolgen: [], fasen: [], bijgewerkt: "", ...extra } } });
  const e = workEntry(poort(werk()), { vandaag: VANDAAG, uitleg: bewaard() });
  assert.equal(Object.fromEntries(e.uitleg.regels).Waar, "Proefstraat, nr. 14 (afgeleid uit de werfzone en het adressenregister)");
  assert.equal(KU.werkFeiten(werk(), { huisnummers: "nr. 14", huisnummerBron: "register" }).huisnummers, "nr. 14");
  const lift = workEntry(poort(werk({ occupancyTypes: ["(Verhuis)lift/levering"] })), { vandaag: VANDAAG, uitleg: bewaard({ soort: "Inname" }) });
  assert.equal(Object.fromEntries(lift.uitleg.regels).Waar, "Proefstraat, nr. 14 (afgeleid uit de werfzone en het adressenregister)");
  assert.match(lift.title, /^Inname in de Proefstraat nr\. 14 /);
});

// ---------- het adres dat de beheerder schreef wint van de dichtste straatas ----------

// Verzonnen straatassen: de Proefstraat ligt op het punt, de Testlaan ongeveer 110 m verder, de Lange Testlaan ernaast.
const as = (naam, coords, id) => ({ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: { LSTRNMID: id, LSTRNM: naam, RSTRNMID: id, RSTRNM: naam, postcode: "2030", DISTRICT: "Antwerpen" } });
const ASSEN = [
  as("Proefstraat", [[4.400, 51.2000], [4.410, 51.2000]], 9201),
  as("Testlaan", [[4.400, 51.2010], [4.410, 51.2010]], 9202),
  as("Lange Testlaan", [[4.400, 51.2030], [4.410, 51.2030]], 9203),
];

test("de straat uit het adres van de beheerder (straat met huisnummer, binnen 1 km) wint van de dichtste as, in de browser en in de verversing", async () => {
  const SC = await import("../site/street-core.js");
  const LR = await import("../lib/street-resolver.mjs");
  const punt = [4.405, 51.2000];
  for (const [naam, index, koppel] of [["browser", SC.buildStreetIndex(ASSEN), SC.applyWorkStreetResolution], ["verversing", LR.buildStreetIndex(ASSEN), LR.applyWorkStreetResolution]]) {
    const straat = (title, phases = []) => koppel([{ point: punt, title, hindrance: phases.length ? { phases: phases.map((description) => ({ description })) } : null }], index)[0];
    for (const t of ["2030 | Antwerpen | Testlaan | 6", "2030 ANTWERPEN, TESTLAAN 6 DN01", "2030 Antwerpen - (Antwerpen) - Testlaan - 6 - werken aan nutsleiding - 57m.", "Testlaan 6A"]) {
      const w = straat(t);
      assert.deepEqual(w.streets.map((s) => s.name), ["Testlaan"], `${naam}: ${t}`);
      assert.equal(w.streetResolution, "official_address_match", `${naam}: ${t}`);
      assert.ok(w.streetDistanceMeters > 100 && w.streetDistanceMeters < 120, `${naam}: ${w.streetDistanceMeters}`);
    }
    // Ook uit een fase; de langste naam op dezelfde plek.
    assert.deepEqual(straat("Werk in openbaar domein", ["Verbouwing woonhuis Testlaan 6"]).streets.map((s) => s.name), ["Testlaan"], naam);
    assert.deepEqual(straat("Lange Testlaan 6").streets.map((s) => s.name), ["Lange Testlaan"], naam);
    // Geen huisnummer na de straat (een maat, een duur, geen getal): de dichtste as.
    for (const t of ["Testlaan 30 m", "Testlaan 3 dagen", "Testlaan - werken", "Testlaan 2030"]) assert.deepEqual(straat(t).streets.map((s) => s.name), ["Proefstraat"], `${naam}: ${t}`);
  }
  // De hele kaart: de straat en het nummer van de beheerder, met hoe ver het punt ervan ligt.
  const [w] = SC.applyWorkStreetResolution([{ ...werk({ streets: undefined, streetResolution: undefined, streetDistanceMeters: undefined }), point: punt, title: "2030 | Antwerpen | Testlaan | 6", occupancyTypes: ["Telecom"], workTypes: ["klantaansluiting"] }], SC.buildStreetIndex(ASSEN));
  const k = kaart(poort(w, NIEUW));
  assert.match(waar(k), /^Testlaan, nr\. 6 \(.*het punt in GIPOD ligt er ongeveer 11\d m van\)$/);
  assert.match(k.titel, /in de Testlaan nr\. 6 /);
});

test("de schrijfwijzen van de nuts- en telecombeheerders: het nummer met een code, een letter, een tweede getal of tussen streepjes", () => {
  for (const [titel, nummer] of [
    ["2000 ANTWERPEN, PROEFSTRAAT 6 DN01", "nr. 6"], ["2000 ANTWERPEN, PROEFSTRAAT 98RO", "nr. 98"], ["2000 ANTWERPEN, PROEFSTRAAT 2DN01", "nr. 2"],
    ["2050 ANTWERPEN, PROEFSTRAAT 14 A", "nr. 14A"], ["2000 ANTWERPEN, PROEFSTRAAT 17 4", "nr. 17"], ["2018 ANTWERPEN, PROEFSTRAAT 237CA", "nr. 237"],
    ["2000 ANTWERPEN, PROEFSTRAAT 128werf", "nr. 128"], ["2030 | Antwerpen | Proefstraat | 6", "nr. 6"],
    ["2060 Antwerpen - (Antwerpen) - Proefstraat - 5 - werken aan nutsleiding - 195m.", "nr. 5"],
    ["2060 Antwerpen - (Antwerpen) - Proefstraat [Antwerpen] - 102 - werken aan nutsleiding - 283m.", "nr. 102"],
    ["2060 - Antwerpen - Proefstraat 2 - koppelput 1 - elektriciteit. - 24m² (Graafwerken: 02/11)", "nr. 2"],
  ]) {
    const nieuw = poort(werk({ title: titel, owner: "Fluvius System Operator", ownerGroup: "Fluvius", occupancyTypes: ["Elektriciteit"], workTypes: ["klantaansluiting"] }), NIEUW);
    assert.match(waar(kaart(nieuw)), new RegExp(`^Proefstraat, ${nummer.replace(".", "\\.")} `), titel);
    // Een aansluiting zonder andere tekst: een adreskaart, met het nummer in haar titel.
    if (nieuw.adresKaart) assert.equal(V.lijstTitel(nieuw), `Nieuwe aansluiting op het elektriciteitsnet – Proefstraat ${nummer.slice(4)}`, titel);
    const gewoon = poort(werk({ title: titel }), GEWOON);
    assert.match(waar(kaart(gewoon)), new RegExp(`^Proefstraat, ${nummer.replace(".", "\\.")} `), titel);
    assert.equal(V.lijstTitel(gewoon), titel, "de lijst toont de titel van GIPOD, met het nummer");
  }
});
