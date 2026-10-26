// Regel van de eigenaar (26 oktober 2026): het huisnummer staat er altijd, "dat de mensen weten waar ... het doel is toch
// altijd dat de mensen echt exact kunnen zien waar die dingen en problemen zijn". Alleen bij iets persoonlijks, "gelijk een
// verhuis", alleen de straat. Voor de werken van GIPOD: een gewone kaart en een adreskaart, een aansluiting en een
// container tonen het nummer; een inname voor een lift of levering en het spoor van een verhuizing niet.
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
  assert.equal(KU.isEenAdres("Nieuwe aansluiting op het elektriciteitsnet"), false);
  assert.equal(KU.isEenAdres("Container"), false);
});

test("een inname voor een lift of levering en het spoor van een verhuizing: alleen de straat, nergens het nummer", () => {
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
      assert.doesNotMatch(alles(k), /\b12\b/, `${item.title}: ${alles(k)}`);
      assert.match(waar(k), /^Proefstraat \(huisnummer weggelaten/, item.title);
      assert.doesNotMatch(V.lijstTitel(p), /\b12\b/, item.title);
      assert.doesNotMatch(alles(k), /verhui/i, item.title);
    }
  }
  // Het vangnet in werkFeiten: ook een werk dat de poort niet zag.
  assert.equal(KU.werkFeiten(werk({ title: "Verhuis Proefstraat 12" })).huisnummers, "");
  assert.equal(KU.werkFeiten(werk({ title: "Proefstraat 12", occupancyTypes: ["(Verhuis)lift/levering"] })).eenAdres, true);
});

test("geen nummer: de kaart zegt waarom alleen als er een getal na de straat staat, anders 'niet gepubliceerd'", () => {
  const NIET = onbekendZin("werk-huisnummers");
  // Een getal na de straat dat de lezer niet zeker leest (een woord erna): "geen zeker huisnummer", de tekst toont het.
  const twijfel = kaart(poort(werk({ title: "Proefstraat 12 kabels vervangen" })));
  assert.equal(waar(twijfel), `Proefstraat (${KU.NUMMER_WEG.twijfel})`);
  assert.equal(twijfel.ontbreekt.includes(NIET), false);
  assert.match(alles(twijfel), /De beheerder schrijft: “Proefstraat 12 kabels vervangen”/);
  // Een getal elders ("R1", een fase "6A+6B") of een maat is geen huisnummer: dan "niet gepubliceerd".
  for (const item of [werk({ title: "R1 - Proefpark Zuid - Antwerpen" }), werk({ title: "Proefstraat - Testlaan", hindrance: hinder([fase("Fase 6A+6B")]) }), werk({ title: "Proefstraat 30 m - kabel" })]) {
    const k = kaart(poort(item));
    assert.equal(waar(k), "Proefstraat", item.title);
    assert.equal(k.ontbreekt.includes(NIET), true, item.title);
  }
});

test("een los nummer uit het adressenregister staat op de kaart; bij een lift nooit", () => {
  const bewaard = (extra = {}) => ({ werken: { 990301: { soort: "", soortBron: "", omschrijving: "", opdrachtgever: "", straten: ["Proefstraat"], huisnummers: "nr. 14", huisnummerBron: "afgeleid uit de werfzone en het adressenregister", gevolgen: [], fasen: [], bijgewerkt: "", ...extra } } });
  const e = workEntry(poort(werk()), { vandaag: VANDAAG, uitleg: bewaard() });
  assert.equal(Object.fromEntries(e.uitleg.regels).Waar, "Proefstraat, nr. 14 (afgeleid uit de werfzone en het adressenregister)");
  assert.equal(KU.werkFeiten(werk(), { huisnummers: "nr. 14", huisnummerBron: "register" }).huisnummers, "nr. 14");
  const lift = workEntry(poort(werk({ occupancyTypes: ["(Verhuis)lift/levering"] })), { vandaag: VANDAAG, uitleg: bewaard({ soort: "Inname voor een lift of levering" }) });
  assert.doesNotMatch(`${lift.title} ${lift.uitleg.regels.flat().join(" ")}`, /\b14\b/);
});
