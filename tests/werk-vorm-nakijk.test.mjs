// Nakijkronde van head a4d9ba99 (werken: adreskaart of gewone kaart, site/werk-vorm.js). Grondregel: liever geen nummer dan
// een fout huis; bij elke twijfel geen nummer. Elke toets hieronder faalt op a4d9ba99. Alle straten, nummers, namen en
// dossiers zijn verzonnen (Proefstraat, Testlaan, Proeflei); geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";

import * as V from "../site/werk-vorm.js";
import * as KU from "../site/kaart-uitleg.js";
import { publicSpaceEntries, samenWerven, werkEntries, workEntry } from "../site/place-core.js";
import { werkZoektekst } from "../site/works-live.js";
import { buildStreetGroups } from "../site/street-overview.js";
import { buildWeekPulse } from "../site/week-pulse.js";
import { kaartUitlegWerkFouten } from "../lib/werk-vorm-validatie.mjs";
import { itemVoorStraat } from "../scripts/build-straat-snapshots.mjs";
import { onbekendZin } from "../site/onbekend-zinnen.js";

const VANDAAG = "2099-03-10";
const PROEF = { id: "9101", name: "Proefstraat", postcode: "2000" };
const TEST = { id: "9102", name: "Testlaan", postcode: "2000" };
const LEI = { id: "9103", name: "Proeflei", postcode: "2000" };
const fase = (description, dag = "12") => ({ description, start: `2099-03-${dag}T06:00:00Z`, end: `2099-03-${dag}T16:00:00Z`, consequences: ["Parkeerverbod"] });
const hinder = (fasen) => ({ severe: false, consequences: ["Parkeerverbod"], start: "2099-03-11T06:00:00Z", end: "2099-03-20T16:00:00Z", phases: fasen });
const werk = (extra = {}) => ({
  gipodId: 990001, title: "Werk in openbaar domein", owner: "Fluvius System Operator", ownerGroup: "Fluvius", status: "In uitvoering",
  start: "2099-03-01T06:00:00Z", end: "2099-03-30T16:00:00Z", workTypes: [], occupancyTypes: [], lastModified: "2099-02-01T00:00:00Z",
  point: [4.4, 51.22], recordCount: 1, boundaryConfidence: "point_inside_new", hindrance: null, hindranceSourceLoaded: true,
  streets: [PROEF], streetResolution: "nearest_official_axis", streetDistanceMeters: 3, ...extra,
});
const aansluiting = (extra = {}) => werk({ occupancyTypes: ["Elektriciteit"], workTypes: ["klantaansluiting"], ...extra });
const A = (ids = [990001]) => ({ schema: 1, adreskaart: ids, gewoon: [] });
const B = (ids = [990001]) => ({ schema: 1, adreskaart: [], gewoon: ids });
const poort = (item, vorm = A(), opties = {}) => V.werkenVoorDeSite([item], vorm, opties)[0];
const nr = (title, extra = {}) => poort(aansluiting({ title, ...extra })).huisnummers;
const regels = (k) => Object.fromEntries(k.regels);
const kaartTekst = (k) => [k.titel, k.samenvatting, k.bronTekst || "", ...k.regels.flat()].join(" · ");

// ---------- HOOG 1: de volledige straatnaam, met een woordgrens, zonder ander straatwoord ervoor ----------

test("HOOG 1: geen nummer als de straat van het punt een deel is van een andere straatnaam", () => {
  assert.equal(nr("2000 Antwerpen, Korte Proefstraat 12"), "", "een ander straatwoord ervoor");
  assert.equal(nr("2000 Antwerpen, KORTE PROEFSTRAAT 12"), "", "in hoofdletters");
  assert.equal(nr("2000 Antwerpen, Anna-Proeflei 12", { streets: [LEI] }), "", "een koppelteken ervoor");
  assert.equal(nr("Werken in de Proefstraat 12"), "", "een woord ervoor: twijfel");
  assert.equal(nr("2000 Antwerpen, Proefstraatje 12"), "", "een langere naam");
  assert.equal(nr("Proefstraat-Noord 12 · Proefstraat 5"), "", "een langere naam met een cijfer, en de straat zelf met een ander");
  assert.equal(nr("Korte Proefstraat 12 · Proefstraat 5"), "", "een deel van een andere naam met een cijfer: twijfel, ook met een eigen nummer");
  assert.equal(nr("Proefstraat 5 · Anna-Proeflei 12"), "", "een ander adres met een koppelteken");
  // Wel: de volledige naam na het begin, een scheiding of een getal, met een woordgrens erna.
  assert.equal(nr("2000 Antwerpen, Proefstraat 12"), "nr. 12");
  assert.equal(nr("2000 | Antwerpen | Proefstraat | 12"), "nr. 12");
  assert.equal(nr("2000 Antwerpen - Proefstraat 12"), "nr. 12");
  assert.equal(nr("Werk in openbaar domein", { hindrance: hinder([fase("Fase 1 Proefstraat 8")]) }), "nr. 8");
  assert.equal(nr("Werken Korte Proefstraat · Proefstraat 5"), "nr. 5", "een deel van een andere naam zonder cijfer telt niet");
  assert.equal(nr("2000 Antwerpen, Anna-Proeflei 12", { streets: [{ ...LEI, name: "Anna-Proeflei" }] }), "nr. 12", "de volledige naam");
});

// ---------- HOOG 2: alleen een nummer direct na de straat, gevolgd door het einde, een scheiding of een bus ----------

test("HOOG 2: een telling, een eenheid, een datum, een code of een woord na het getal: geen nummer", () => {
  for (const t of [
    "Proefstraat 12 containers", "Proefstraat 2 werkdagen", "Proefstraat 3 parkeerplaatsen", "Proefstraat 12 Proefmans", // verzonnen
    "Proefstraat 15 oktober", "Proefstraat 15/10", "Proefstraat 31/2", "Proefstraat 15-10-2099", "Proefstraat 15.10", "Proefstraat 7h",
    "Proefstraat 7u30", "Proefstraat 12 - 14 dagen", "Proefstraat 12-14 dagen", "Proefstraat 12 A", "Proefstraat 9B_BIS", "Proefstraat 12 DN32",
    "Proefstraat 012", "Proefstraat 1200", "Proefstraat 12 (Proefmans)", "Proefstraat (12)", "Proefstraat - 12", "Proefstraat 12 → Testlaan",
    "Proefstraat 12 -> Testlaan", "Proefstraat 12 tot Testlaan", "Proefstraat 12 richting Testlaan", "Proefstraat 2 x 3 m",
    // Nog een getal of een maat naast het nummer: twijfel (nakijkronde van head fd8946ae, tests/werk-vorm-nakijk2.test.mjs).
    "Proefstraat 12, 3 dagen",
  ]) assert.equal(nr(t), "", t);
  for (const [t, n] of [
    ["Proefstraat 12", "nr. 12"], ["Proefstraat 12A", "nr. 12A"], ["Proefstraat 12 bus 3", "nr. 12"], ["Proefstraat 12, 2000 Antwerpen", "nr. 12"],
    ["Proefstraat 12 - klantaansluiting", "nr. 12"], ["Proefstraat 12. Fase 1", "nr. 12"], ["Proefstraat 12; fase 1", "nr. 12"],
    ["(Proefstraat 12)", "nr. 12"], ["Proefstraat 12 tem 14", "nr. 12–14"], ["Proefstraat 12, 14 en 16", "nr. 12–16"],
  ]) assert.equal(nr(t), n, t);
});

test("HOOG 1 en 2, alle combinaties: een twijfel ervoor of erna geeft nooit een nummer", () => {
  const voorTwijfel = ["Korte ", "KORTE ", "Anna-", "Sint-", "in de ", "thv ", "Oude-"];
  const voorGoed = ["", "2000 Antwerpen, ", "2000 | Antwerpen | ", "Fase 1 ", "(", "Testlaan / "];
  const naTwijfel = [" containers", " oktober", "/10", " A", "_BIS", " Proefmans", " stuks", " u", "h", " DN32", "-10-2099", " tot Testlaan", " → Testlaan", " Proefmans 5"]; // verzonnen
  const naGoed = ["", " · Fase 1", " - klantaansluiting", ", 2000 Antwerpen", " bus 3", ")", ". Fase 2", "; fase 1"];
  let goed = 0;
  for (const nummer of ["12", "7", "105"]) {
    for (const voor of [...voorTwijfel, ...voorGoed]) {
      for (const na of [...naTwijfel, ...naGoed]) {
        const t = `${voor}Proefstraat ${nummer}${na}`;
        const twijfel = voorTwijfel.includes(voor) || naTwijfel.includes(na);
        if (voor === "(" && na !== ")" && !twijfel) continue;
        assert.equal(nr(t), twijfel ? "" : `nr. ${nummer}`, t);
        if (!twijfel) goed += 1;
      }
    }
  }
  assert.ok(goed > 100, `${goed} goede schrijfwijzen`);
});

// ---------- HOOG 3: een bewaard nummer alleen bij precies dezelfde eerste straat ----------

test("HOOG 3: een bewaard nummer hoort bij zijn eigen eerste straat, nooit bij een andere", () => {
  // Live geeft GIPOD geen nummer (de browser leest het nummer zelf, regel van de eigenaar van 26 oktober 2026): dan kan alleen
  // het bewaarde nummer uit het adressenregister er staan, en alleen bij zijn eigen eerste straat.
  const live = poort(aansluiting({ title: "2000 Antwerpen, Proefstraat" }), B([]));
  assert.equal(live.adresKaart, true);
  assert.equal(live.huisnummers, "");
  const REGISTER = "afgeleid uit de werfzone en het adressenregister";
  const bewaard = (extra) => ({ adresKaart: true, soort: "Nieuwe aansluiting op het elektriciteitsnet", soortBron: "soort grondwerk in GIPOD", omschrijving: "", opdrachtgever: "Fluvius", straten: ["Proefstraat"], huisnummers: "nr. 12", huisnummerBron: REGISTER, gevolgen: [], fasen: [], bijgewerkt: live.lastModified, ...extra });
  const kaart = (item, b) => workEntry(item, { vandaag: VANDAAG, uitleg: { werken: { 990001: b } } });
  // Een andere eerste straat in de verversing: het nummer hoorde bij die straat.
  const ander = kaart(live, bewaard({ straten: ["Testlaan"] }));
  assert.doesNotMatch(`${ander.title} ${regels(ander.uitleg).Waar}`, /\b12\b/);
  // Geen straat van het punt: de straat komt uit de werfzone (vlakStraten), het nummer hoorde bij een andere.
  const zonderStraat = kaart({ ...live, streets: [], title: "Nieuwe aansluiting op het elektriciteitsnet" }, bewaard({ vlakStraten: ["Testlaan"] }));
  assert.match(regels(zonderStraat.uitleg).Waar, /^Testlaan/);
  assert.doesNotMatch(`${zonderStraat.title} ${regels(zonderStraat.uitleg).Waar}`, /\b12\b/);
  // Dezelfde eerste straat: het bewaarde nummer blijft.
  const zelfde = kaart(live, bewaard({}));
  assert.equal(regels(zelfde.uitleg).Waar, `Proefstraat, nr. 12 (${REGISTER})`);
});

// ---------- MIDDEL: wat main toonde, zonder privacyverlies ----------

test("MIDDEL: de lijst, het zoeken, street-overview en week-pulse tonen de titel van een gewone kaart heel", () => {
  const lang = `2000 Antwerpen, Testlaan - ${"vernieuwen van de rijweg en de voetpaden ".repeat(10)}- einde`;
  assert.ok(lang.length > 400);
  const b = poort(werk({ title: lang, streets: [TEST] }), B());
  assert.equal(V.lijstTitel(b), lang, "niet afgekapt na 300 tekens");
  assert.ok(werkZoektekst(b).includes("- einde"));
  // Een vergunningsnummer is geen telefoonnummer.
  const omv = poort(werk({ title: "Heraanleg Testlaan cfr. vergunning OMV_2099012345", streets: [TEST] }), B());
  assert.equal(V.lijstTitel(omv), "Heraanleg Testlaan cfr. vergunning OMV_2099012345");
  // Een echt telefoonnummer blijft weg (verzonnen nummer).
  assert.equal(V.lijstTitel(poort(werk({ title: "Testlaan, info 0470 12 34 56", streets: [TEST] }), B())), V.GEEN_TITEL);
  const groepen = buildStreetGroups({ works: [omv] });
  assert.equal(groepen[0].works[0].title, "Heraanleg Testlaan cfr. vergunning OMV_2099012345");
  const puls = buildWeekPulse({ works: [{ ...omv, start: "2099-03-11T06:00:00Z" }], fromDay: "2099-03-10", toDay: "2099-03-16" });
  assert.equal(puls.upcoming[0].title, "Heraanleg Testlaan cfr. vergunning OMV_2099012345");
  // Het dossiernummer van de werfzone en de postcode: zoekbaar, ook op een adreskaart.
  const a = poort(aansluiting({ title: "2000 Antwerpen, Proefstraat 12", dossier: "GW2099-000901" }));
  assert.ok(werkZoektekst(a).includes("gw2099-000901"));
  assert.ok(werkZoektekst(a).includes("2000"));
});

test("MIDDEL: een adreskaart houdt haar dossier, en zo de koppeling met haar werfzone", () => {
  const a = poort(aansluiting({ title: "2000 Antwerpen, Proefstraat 12", dossier: "GW2099-000901" }));
  assert.equal(a.dossier, "GW2099-000901");
  assert.equal(KU.werkFeiten(a).dossier, "GW2099-000901");
  assert.deepEqual(kaartUitlegWerkFouten(KU.werkFeiten(a), true), []);
  assert.deepEqual(kaartUitlegWerkFouten({ ...KU.werkFeiten(a), dossier: "Proefmans" }, true), ["dossier"]); // verzonnen
  assert.equal(poort(aansluiting({ title: "2000 Antwerpen, Proefstraat 12", dossier: "Proefmans" })).dossier, undefined, "alleen een dossiernummer van een werfzone");
  const sgw = { id: "sgw:GW2099-000901|1", kind: "sgw", kindLabel: "Werfzone", title: "Werfzone", location: "", reference: "GW2099-000901", detail: "Fase 1", status: "vergund", start: "2099-03-12T06:00:00Z", end: "2099-03-12T16:00:00Z", streets: [PROEF], werfzoneStreets: [PROEF], omleidingStreets: [] };
  const verbod = { id: "parking:2099-000901|1", kind: "parking", kindLabel: "Parkeerverbod", title: "Melding ikv werfsignalisaties", reason: "Melding ikv werfsignalisaties", location: "Proefstraat, 2000 Antwerpen", start: "2099-03-12T00:00:00.000Z", end: "2099-03-12T00:00:00.000Z", status: "Goedgekeurd", reference: "2099-000901", detail: "", startTime: "07:00", endTime: "17:00", weekdaysOnly: false, streets: [PROEF] };
  const rows = [sgw, verbod];
  const kaarten = samenWerven([...werkEntries([a], { vandaag: VANDAAG }), ...publicSpaceEntries(rows, { vandaag: VANDAAG, alle: rows, straat: PROEF.name })], { straat: PROEF.name, vandaag: VANDAAG, alle: rows });
  const werkKaart = kaarten.find((e) => e.source === "works");
  assert.equal(werkKaart.werf?.dossier, "GW2099-000901", "één kaart met de werfzone");
  assert.equal(kaarten.some((e) => e.item?.kind === "sgw"), false, "de werfzone staat niet meer apart");
  assert.match(werkKaart.title, /Proefstraat nr\. 12/);
  assert.match(regels(werkKaart.uitleg).Werfzone, /A-Sign, dossier GW2099-000901$/);
  // Het parkeerverbod blijft een eigen kaart: zijn reden staat nooit naast het exacte adres.
  assert.ok(kaarten.some((e) => e.item?.kind === "parking"));
  assert.doesNotMatch(kaartTekst(werkKaart.uitleg), /werfsignalisatie|Reden|Parkeerverbod \(/i);
  assert.equal(werkKaart.werfParkeer, undefined);
});

test("MIDDEL: 'Waar' noemt de bron van een reeks uit het register, en 'Wat' zegt dan geen 'exact adres'", () => {
  const a = poort(werk({ title: "2000 Antwerpen, Proefstraat" }));
  assert.equal(a.adresKaart, true);
  const register = KU.werkKaartje(a, { vandaag: VANDAAG, feiten: KU.werkFeiten(a, { huisnummers: "nr. 10–20", huisnummerBron: "afgeleid uit de werfzone en het adressenregister" }) });
  assert.equal(regels(register).Waar, "Proefstraat, nr. 10–20 (afgeleid uit de werfzone en het adressenregister)");
  assert.doesNotMatch(regels(register).Wat, /exact adres/);
  assert.match(regels(register).Wat, new RegExp(`${KU.ADRESKAART_WAT_STRAAT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
  const zonder = KU.werkKaartje(a, { vandaag: VANDAAG });
  assert.doesNotMatch(regels(zonder).Wat, /exact adres/);
  const exact = KU.werkKaartje(poort(aansluiting({ title: "2000 Antwerpen, Proefstraat 12" })), { vandaag: VANDAAG });
  assert.equal(regels(exact).Waar, `Proefstraat, nr. 12 (${KU.ADRES_GIPOD})`);
  assert.match(regels(exact).Wat, /exact adres/);
});

test("MIDDEL: een vaste fasenaam van de bron blijft, nooit hernummerd", () => {
  const namen = (fasen) => poort(aansluiting({ title: "2000 Antwerpen, Proefstraat 12", hindrance: hinder(fasen) })).hindrance.phases.map((p) => p.description);
  assert.deepEqual(namen([fase("Fase 2")]), ["Fase 2"], "'Fase 2' wordt geen 'Fase 1'");
  assert.deepEqual(namen([fase("fase 3", "14"), fase("Fase 2", "13")]), ["Fase 2", "Fase 3"]);
  assert.deepEqual(namen([fase("Voorbereiding bij fam. Proefmans", "11"), fase("deel 3", "13")]), ["Fase", "Deel 3"], "een vrije naam naast een vaste: zonder nummer"); // verzonnen
  assert.deepEqual(namen([fase("Plaatsen kraan", "11"), fase("", "13")]), ["Fase 1", "Fase 2"], "zonder vaste naam: op volgorde");
  const a = poort(aansluiting({ title: "2000 Antwerpen, Proefstraat 12", hindrance: hinder([fase("Voorbereiding", "11"), fase("Fase 2", "13")]) }));
  const f = KU.werkFeiten(a);
  assert.deepEqual(f.fasen.map((x) => x.naam), ["Fase", "Fase 2"]);
  assert.deepEqual(KU.alsAdreskaart(f), f);
  assert.deepEqual(V.werkenVoorDeSite([a], A()), [a]);
  assert.match(regels(KU.werkKaartje(a, { vandaag: VANDAAG })).Fasen, /^Fase \(11 maart\): parkeerverbod · Fase 2 \(13 maart\)/);
  assert.deepEqual(kaartUitlegWerkFouten(f, true), []);
});

// ---------- geen onware bewering: "huisnummers niet gepubliceerd" alleen als GIPOD er geen gaf ----------

test("een adreskaart zonder nummer zegt waarom, en nooit 'niet gepubliceerd' als GIPOD een nummer gaf", () => {
  const NIET = onbekendZin("werk-huisnummers");
  const zegt = (item) => { const k = KU.werkKaartje(item, { vandaag: VANDAAG }); return { waar: regels(k).Waar, niet: k.ontbreekt.includes(NIET) }; };
  // Twijfel: een getal in de titel, maar niet zeker het huisnummer van deze straat.
  for (const t of ["2000 Antwerpen, Proefstraat nr 12", "2000 Antwerpen, Proefstraat 12 DN32", "2000 Antwerpen, Proefstr. 12", "2000 Antwerpen, Korte Proefstraat 12"]) {
    const uit = zegt(poort(aansluiting({ title: t })));
    assert.equal(uit.niet, false, t);
    assert.equal(uit.waar, `Proefstraat (${KU.NUMMER_WEG.twijfel})`, t);
  }
  // De browser leest het nummer ook als de vaste vorm het werk nog niet kent (regel van de eigenaar van 26 oktober 2026).
  const browser = poort(aansluiting({ title: "2000 Antwerpen, Proefstraat 12" }), B([]));
  assert.deepEqual(zegt(browser), { waar: `Proefstraat, nr. 12 (${KU.ADRES_GIPOD})`, niet: false });
  // Gelezen maar hier niet getoond: een straatbestand (zonder nummer).
  const straatItem = itemVoorStraat(poort(aansluiting({ title: "2000 Antwerpen, Proefstraat 12" })), { laag: "werken" });
  assert.equal("huisnummers" in straatItem, false);
  assert.deepEqual(zegt(V.werkenVoorDeSite([straatItem], A())[0]), { waar: `Proefstraat (${KU.NUMMER_WEG.weggelaten})`, niet: false });
  // Een bewaard nummer bij een andere straat: het nummer van live blijft.
  const bewaard = { adresKaart: true, soort: "Nieuwe aansluiting op het elektriciteitsnet", soortBron: "soort grondwerk in GIPOD", omschrijving: "", opdrachtgever: "Fluvius", straten: ["Testlaan"], huisnummers: "nr. 14", huisnummerBron: KU.ADRES_GIPOD, gevolgen: [], fasen: [], bijgewerkt: "" };
  const e = workEntry(browser, { vandaag: VANDAAG, uitleg: { werken: { 990001: bewaard } } });
  assert.equal(regels(e.uitleg).Waar, `Proefstraat, nr. 12 (${KU.ADRES_GIPOD})`);
  // Een lift of levering: gelezen maar nooit getoond.
  const lift = poort(werk({ title: "2000 Antwerpen, Proefstraat 12", occupancyTypes: ["(Verhuis)lift/levering"] }), B([]));
  assert.equal(regels(KU.werkKaartje(lift, { vandaag: VANDAAG })).Waar, "Proefstraat (huisnummer weggelaten: het gaat om één adres)");
  // Geen enkel getal in de titel of de fasen ("Fase 2" telt niet): dan wel "niet gepubliceerd", want dat is zo.
  const leeg = poort(aansluiting({ title: "2000 Antwerpen, Proefstraat", hindrance: hinder([fase("Fase 2")]) }));
  assert.equal(leeg.huisnummerWeg, undefined);
  assert.deepEqual(zegt(leeg), { waar: "Proefstraat", niet: true });
  // De code is vast: de controle kent alleen "twijfel" en "weggelaten", en nooit naast een nummer.
  assert.deepEqual(kaartUitlegWerkFouten({ ...KU.werkFeiten(browser), huisnummerWeg: "Proefmans" }, true), ["huisnummerWeg"]); // verzonnen
  assert.deepEqual(kaartUitlegWerkFouten(KU.werkFeiten(browser), true), []);
});
