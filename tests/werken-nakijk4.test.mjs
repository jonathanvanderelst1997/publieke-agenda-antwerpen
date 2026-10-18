// Werken van GIPOD, nakijkronde van head bc86a6ee (besluit van de eigenaar van 18 oktober 2026: "liefst exacte adres, mss geen
// verhuislift, ik weet niet privacy wil ik oké zijn, maar moet wel nuttig zijn en weten waar"). Per bevinding:
// 1. het adres van een werk voor één huis is alleen een officiële straat (de straatas of de straat van de kaart) met haar
//    nummer, de postcode en de gemeente: nooit een woord dat op een straat lijkt (hoofdletters vóór de straat, een familienaam
//    op -berg, "Levering");
// 2. een opdrachtgever met "verhuis" valt weg zoals een werk zonder opdrachtgever in GIPOD: geen eigen groep;
// 3. een werk van vóór de overgang zonder bewaard nummer zegt niet "huisnummers niet gepubliceerd";
// 4. het adres dat de beheerder op een andere straat noemt, is gepubliceerd: dan niet "huisnummers niet gepubliceerd";
// 5. het register geeft bij een werk van vóór de overgang alleen een reeks, ook bij een werk zonder vrije tekst;
// 6. de grens van de overgangsregel: de bewaarde bestanden; de live laag toont wat GIPOD nu publiceert, nooit een nummer dat
//    alleen het register gaf.
// Alle straten, nummers, namen en codes zijn verzonnen; geen netwerk. Namespace-imports: op de oude code faalt elke toets op
// haar eigen bewering, niet op een import.
import test from "node:test";
import assert from "node:assert/strict";

import * as KU from "../site/kaart-uitleg.js";
import * as WC from "../site/works-core.js";
import * as PC from "../site/place-core.js";
import * as HP from "../lib/historiek-privacy.mjs";
import * as KR from "../lib/kaart-uitleg-refresh.mjs";
import { straatItemPrivacy } from "../lib/straat-bestanden.mjs";
import { itemVoorStraat } from "../scripts/build-straat-snapshots.mjs";

const VANDAAG = "2099-03-10";
const clock = () => new Date("2099-03-10T03:00:00Z");
const PROEFSTRAAT = { id: "9101", name: "Proefstraat", postcode: "2018" };
const VOORBEELDLAAN = { id: "9102", name: "Voorbeeldlaan", postcode: "2018" };
// De straatas (verzonnen): welke hele namen officiële straten zijn.
const STRATEN = ["Proefstraat", "Proeflei", "Voorbeeldlaan", "Testlei", "Lange Proefstraat"];
const isStraat = (naam) => STRATEN.some((s) => s.toLowerCase() === String(naam).toLowerCase().trim());
// Een GIPOD-record zoals de bron het geeft (verzonnen).
const gipod = (id, Description, properties = {}) => ({ type: "Feature", geometry: { type: "Point", coordinates: [4.4, 51.22] }, properties: { GipodId: id, Status: "In uitvoering", Start: "2099-03-01T06:00:00Z", End: "2099-03-30T16:00:00Z", LastModifiedOn: "2099-02-01T00:00:00Z", Description, Owner: "Stad Antwerpen - Proefdienst", PublicDomainOccupancyTypes: "Container", ...properties } });
// Bij de ingang (collectWorks), met de straatas, en daarna aan de straat van het punt gekoppeld (zoals site/street-core.js).
const binnen = (f, { straten = [PROEFSTRAAT], opties = { isStraat } } = {}) => {
  const [w] = WC.collectWorks([f], new Set([f.properties.GipodId]), null, opties);
  return { ...w, streets: straten, streetResolution: straten.length ? "nearest_official_axis" : "unresolved", streetDistanceMeters: 2 };
};
const kaart = (w, opties = {}) => KU.werkKaartje(w, { vandaag: VANDAAG, isStraat, ...opties });
const regels = (k) => Object.fromEntries(k.regels);
const getoond = (k) => [k.titel, k.samenvatting, k.plek, k.bronTekst, ...k.regels.flat(), ...k.ontbreekt].join(" ¶ ");
const teksten = (waarde, uit = []) => {
  if (typeof waarde === "string") uit.push(waarde);
  else if (Array.isArray(waarde)) for (const v of waarde) teksten(v, uit);
  else if (waarde && typeof waarde === "object") for (const v of Object.values(waarde)) teksten(v, uit);
  return uit;
};
const nergens = (waarde, re, wat) => { for (const t of teksten(waarde)) assert.doesNotMatch(t, re, `${wat}: ${JSON.stringify(t)}`); };
// Alle uitgangen van één werk: de kaart, de historiek, het straatbestand, kaart-uitleg.json en de lijsten van de site.
function uitgangen(w) {
  const k = kaart(w);
  const historiek = HP.itemVoorHistoriek({ ...w, id: `work:${w.gipodId}` });
  const straat = itemVoorStraat(w, { laag: "werken" });
  const uitleg = KR.kaartUitlegVoorPubliek({ werken: { [w.gipodId]: KU.werkFeiten(w) }, evenementen: {} }).werken[w.gipodId];
  return { k, historiek, straat, uitleg, lijst: KU.lijstTitel(w, { isStraat }), lijstZonderStraatas: KU.lijstTitel(w), basis: PC.workEntry(w).title };
}

// ---------- 1. het adres van één huis: alleen een officiële straat, nooit een naam ----------

test("1. een naam in hoofdletters vóór de straat (zoals GIPOD een adres schrijft) staat op geen enkele uitgang", () => {
  const gevallen = [
    [gipod(990970, "CONTAINER PROEFMANS PROEFSTRAAT 12"), "PROEFSTRAAT 12"], // verzonnen
    [gipod(990971, "2018 ANTWERPEN, FAM PROEFMANS PROEFSTRAAT 12", { PublicDomainOccupancyTypes: "Andere" }), "2018 ANTWERPEN, PROEFSTRAAT 12"], // verzonnen
    [gipod(990972, "2018 ANTWERPEN, VOOR PROEFMANS PROEFSTRAAT 12"), "2018 ANTWERPEN, PROEFSTRAAT 12"], // verzonnen
  ];
  for (const [f, adres] of gevallen) {
    const w = binnen(f);
    assert.equal(KU.isEenHuis(KU.werkFeiten(w)), true, adres);
    const u = uitgangen(w);
    for (const [wat, waarde] of Object.entries({ kaart: getoond(u.k), historiek: u.historiek, straat: u.straat, uitleg: u.uitleg, lijst: u.lijst, lijstZonderStraatas: u.lijstZonderStraatas, basis: u.basis })) nergens(waarde, /PROEFMANS|FAM\b/, `${f.properties.Description} → ${wat}`);
    // Het exacte adres blijft, op elke uitgang.
    assert.equal(u.historiek.title, adres);
    assert.equal(u.straat?.title, adres);
    assert.equal(u.lijst, adres);
    assert.equal(u.uitleg.omschrijving, adres);
    assert.equal(regels(u.k).Waar, "Proefstraat, nr. 12 (omschrijving van de beheerder)");
  }
});

test("1. een los woord met een straatuitgang (een familienaam op -berg, 'Levering') is geen straat", () => {
  const gevallen = [
    [gipod(990973, "2000 ANTWERPEN, PROEFSTRAAT 12, FAM. VANDENPROEFBERG"), "2000 ANTWERPEN, PROEFSTRAAT 12"], // verzonnen
    [gipod(990974, "Container - Vandenproefberg - Proefstraat 12"), "Proefstraat 12"], // verzonnen
    [gipod(990975, "Levering, Testberg, Proefstraat 12", { PublicDomainOccupancyTypes: "(Verhuis)lift/levering" }), "Proefstraat 12"], // verzonnen
    [gipod(990976, "Proefstraat 12, J. Proefmans"), "Proefstraat 12"], // verzonnen: een initiaal is geen huisnummer
  ];
  for (const [f, adres] of gevallen) {
    const u = uitgangen(binnen(f));
    for (const [wat, waarde] of Object.entries({ kaart: getoond(u.k), historiek: u.historiek, straat: u.straat, uitleg: u.uitleg, lijst: u.lijst, basis: u.basis })) nergens(waarde, /Vandenproefberg|VANDENPROEFBERG|Testberg|Levering\b|Proefmans|\bJ\b/, `${f.properties.Description} → ${wat}`);
    assert.equal(u.historiek.title, adres, f.properties.Description);
    assert.equal(u.straat?.title, adres, f.properties.Description);
    assert.equal(u.lijst, adres, f.properties.Description);
    assert.doesNotMatch(regels(u.k).Waar, /de beheerder noemt/, f.properties.Description);
  }
});

test("1. 'verhuis' met een naam: bij de ingang alleen het adres, zonder straatas geen naam", () => {
  const lift = gipod(990977, "VERHUISLIFT PROEFMANS PROEFSTRAAT 12", { PublicDomainOccupancyTypes: "(Verhuis)lift/levering" }); // verzonnen
  const w = binnen(lift);
  assert.equal(w.title, "PROEFSTRAAT 12");
  assert.equal(regels(kaart(w)).Waar, "Proefstraat, nr. 12 (omschrijving van de beheerder)");
  // Zonder straatas en zonder straat van de kaart weet de ingang niet wat een straat is: dan niets dan de postcode.
  const [kaal] = WC.collectWorks([lift], new Set([990977]));
  assert.doesNotMatch(kaal.title, /PROEFMANS/);
  // Wat al bewaard was, krijgt dezelfde regel (met de straat van het werk).
  assert.equal(WC.werkZonderVerhuis({ title: "VERHUIS PROEFMANS PROEFSTRAAT 12", streets: [PROEFSTRAAT] }).title, "PROEFSTRAAT 12"); // verzonnen
  assert.equal(HP.itemVoorHistoriek({ id: "work:990977", gipodId: 990977, title: "VERHUIS PROEFMANS PROEFSTRAAT 12", occupancyTypes: ["Lift/levering"], streets: [PROEFSTRAAT] }).title, "PROEFSTRAAT 12"); // verzonnen
});

test("1. een fasenaam met een naam vóór de straat is geen vaste naam", () => {
  const w = { ...binnen(gipod(990978, "2018 ANTWERPEN, PROEFSTRAAT 12")), hindrance: { severe: false, consequences: ["Parkeerverbod"], start: "2099-03-12T06:00:00Z", end: "2099-03-12T16:00:00Z", phases: [{ description: "Werken - PROEFMANS PROEFSTRAAT 12", start: "2099-03-12T06:00:00Z", end: "2099-03-12T16:00:00Z", consequences: ["Parkeerverbod"] }] } }; // verzonnen
  const u = uitgangen(w);
  for (const [wat, waarde] of Object.entries({ kaart: getoond(u.k), historiek: u.historiek, straat: u.straat, uitleg: u.uitleg })) nergens(waarde, /PROEFMANS/, wat);
  // Een vaste naam met het adres blijft ("Fase 1 Proefstraat 8").
  const vast = { ...w, hindrance: { ...w.hindrance, phases: [{ ...w.hindrance.phases[0], description: "Fase 1 Proefstraat 8" }] } };
  assert.match(regels(kaart(vast)).Fasen, /Fase 1 Proefstraat 8/);
});

test("1. de scans zien een naam naast het adres van één huis (historiek, straatbestanden, kaart-uitleg.json)", () => {
  const oud = { id: "work:990970", gipodId: 990970, title: "CONTAINER PROEFMANS PROEFSTRAAT 12", occupancyTypes: ["Container"], streets: [PROEFSTRAAT] }; // verzonnen
  assert.ok(HP.historiekPrivacyBevindingen(oud).some((v) => v.code === "vrije_tekst"));
  assert.ok(straatItemPrivacy({ werken: [oud] }).some((v) => v.code === "vrije_tekst"));
  const feiten = { soort: "Container", soortBron: "soort inname in GIPOD", omschrijving: "2000 ANTWERPEN, PROEFSTRAAT 12. VANDENPROEFBERG", opdrachtgever: "", straten: ["Proefstraat"], huisnummers: "nr. 12", huisnummerBron: "omschrijving van de beheerder", gevolgen: [], fasen: [] }; // verzonnen
  assert.deepEqual(KR.vrijeTekstBijEenHuis({ werken: { 990973: feiten } }), ["werken.990973: vrije tekst bij een werk voor één huis"]);
});

test("1. een officiële straat blijft heel: ook met meer woorden, in hoofdletters, en de straat die de beheerder elders noemt", () => {
  // "LANGE PROEFSTRAAT" is een officiële straat (de straatas), geen naam vóór de Proefstraat.
  assert.equal(KU.adresDeel("2018 ANTWERPEN, LANGE PROEFSTRAAT 12 - container", { straten: ["Proefstraat"], isStraat }), "2018 ANTWERPEN, LANGE PROEFSTRAAT 12"); // verzonnen
  assert.equal(KU.adresDeel("Container voor Proefmans Lange Proefstraat 12", { straten: ["Proefstraat"], isStraat }), "Lange Proefstraat 12"); // verzonnen
  assert.equal(KU.adresDeel("Jan Proefmans Proefstraat 12", { straten: ["Proefstraat"] }), "Proefstraat 12"); // verzonnen
  assert.equal(KU.adresDeel("2000 | Antwerpen | PROEFSTRAAT | 12", { straten: ["Proefstraat"] }), "2000 | Antwerpen | PROEFSTRAAT | 12");
  // Het adres van de beheerder op een andere officiële straat staat bij "Waar"; een naam op -lei die geen straat is niet.
  const k = kaart(binnen(gipod(990979, "2018 ANTWERPEN, PROEFLEI 1DN02 - aansluiting", { Owner: "Fluvius System Operator", PublicDomainOccupancyTypes: "Elektriciteit", GroundworkSpecification: "Klantaansluiting" }), { straten: [VOORBEELDLAAN] })); // verzonnen
  assert.match(regels(k).Waar, /de beheerder noemt PROEFLEI 1DN02$/);
  const naam = kaart(binnen(gipod(990980, "Container - Vandenproeflei", {}), { straten: [VOORBEELDLAAN] })); // verzonnen
  assert.doesNotMatch(getoond(naam), /Vandenproeflei/);
});

test("1. een persoon na 'voor' of 'bij' met een straatuitgang is geen straat: de vrije tekst valt weg", () => {
  const w = binnen(gipod(990981, "Werken bij Vandenproefberg", { PublicDomainOccupancyTypes: "Andere" })); // verzonnen
  assert.equal(KU.persoonInTekst("Werken bij Vandenproefberg", ["Proefstraat"]), true);
  assert.doesNotMatch(getoond(kaart(w)), /Vandenproefberg/);
  // Een straat van de kaart na "bij" is geen persoon.
  assert.equal(KU.persoonInTekst("Wegenwerken bij Proefstraat", ["Proefstraat"]), false);
});

// ---------- 2. een opdrachtgever met "verhuis": zoals een werk zonder opdrachtgever ----------

test("2. een opdrachtgever met 'verhuis' laat geen eigen groep na: precies een werk zonder opdrachtgever in GIPOD", () => {
  const met = binnen(gipod(990986, "2018 Antwerpen, Proefstraat 12", { Owner: "Verhuizingen Proefmans BV", PublicDomainOccupancyTypes: "(Verhuis)lift/levering" })); // verzonnen
  const zonder = binnen(gipod(990986, "2018 Antwerpen, Proefstraat 12", { Owner: undefined, PublicDomainOccupancyTypes: "(Verhuis)lift/levering" }));
  assert.equal(met.owner, "");
  assert.equal(met.ownerGroup, zonder.ownerGroup);
  assert.deepEqual(met, zonder);
  // Wat al bewaard was: dezelfde uitkomst, in de historiek en de straatbestanden.
  const bewaard = { id: "work:990986", gipodId: 990986, title: "2018 Antwerpen, Proefstraat 12", owner: "Verhuizingen Proefmans BV", ownerGroup: "Andere", occupancyTypes: ["Lift/levering"], streets: [PROEFSTRAAT] }; // verzonnen
  assert.equal(HP.itemVoorHistoriek(bewaard).ownerGroup, WC.ownerGroup(""));
  assert.equal(itemVoorStraat(bewaard, { laag: "werken" }).ownerGroup, WC.ownerGroup(""));
  assert.equal(WC.werkZonderVerhuis(bewaard).ownerGroup, WC.ownerGroup(""));
  // Een andere opdrachtgever houdt zijn naam en groep.
  assert.equal(binnen(gipod(990987, "Proefstraat 12", { Owner: "Proefbouw BV" })).ownerGroup, "Andere"); // verzonnen
});

// ---------- 3. een werk van vóór de overgang zonder bewaard nummer ----------

// De stand van main (vóór het besluit): een lift zonder huisnummer, zonder versiemerk (adresRegel).
const OUD_LIFT = { bijgewerkt: "2099-02-01T00:00:00Z", soort: WC.INNAME_LIFT, soortBron: "soort inname in GIPOD", omschrijving: "2000 ANTWERPEN, PROEFSTRAAT", opdrachtgever: "Stad Antwerpen - Proefdienst", straten: ["Proefstraat"], huisnummers: "", huisnummerBron: "", gevolgen: [], fasen: [] };
const liftWerk = (title, extra = {}) => ({ gipodId: 990990, title, status: "In uitvoering", start: "2099-03-01T06:00:00Z", end: "2099-03-30T16:00:00Z", lastModified: "2099-02-01T00:00:00Z", owner: "Stad Antwerpen - Proefdienst", ownerGroup: "Stad Antwerpen", streets: [PROEFSTRAAT], streetResolution: "nearest_official_axis", streetDistanceMeters: 2, occupancyTypes: ["Lift/levering"], workTypes: [], hindrance: null, ...extra });

test("3. de kaart van een werk van vóór de overgang zegt dat het huisnummer weggelaten is, niet dat de bron het niet geeft", async () => {
  // GIPOD geeft het nummer; de verversing bewaart het niet (de overgangsregel).
  const { document } = await KR.bouwKaartUitleg({ works: [liftWerk("2000 ANTWERPEN, PROEFSTRAAT 12")], vorige: { werken: { 990990: OUD_LIFT } }, fetch: null, clock });
  const bewaard = KR.kaartUitlegVoorPubliek(document).werken["990990"];
  assert.equal(bewaard.huisnummers, "");
  assert.equal(bewaard.huisnummerWeggelaten, true);
  assert.deepEqual(KR.validateKaartUitleg({ ...document, werken: { 990990: bewaard } }), []);
  // De kaart uit het straatbestand (de titel zoals de historiek hem kende) en de bewaarde feiten.
  const e = PC.workEntry(liftWerk("2000 ANTWERPEN, PROEFSTRAAT"), { vandaag: VANDAAG, uitleg: { werken: { 990990: bewaard } } });
  assert.doesNotMatch(e.uitleg.ontbreekt.join(" · "), /huisnummers niet gepubliceerd/);
  assert.match(regels(e.uitleg).Waar, /^Proefstraat \(huisnummer weggelaten: het werk stond al zonder huisnummer op deze site\)$/);
  // Ook de opkuis van een bewaard bestand (scripts/opkuis-straatnamen.mjs: kaartUitlegVoorPubliek) zet het.
  assert.equal(KR.kaartUitlegVoorPubliek({ werken: { 990990: OUD_LIFT }, evenementen: {} }).werken["990990"].huisnummerWeggelaten, true);
  // Een nieuw werk (met het merk) waarvoor geen nummer bekend is: dat zegt de kaart wel.
  const nieuw = { ...OUD_LIFT, adresRegel: KR.ADRES_REGEL };
  assert.equal("huisnummerWeggelaten" in KR.kaartUitlegVoorPubliek({ werken: { 990991: nieuw }, evenementen: {} }).werken["990991"], false);
  const e2 = PC.workEntry({ ...liftWerk("2000 ANTWERPEN, PROEFSTRAAT"), gipodId: 990991 }, { vandaag: VANDAAG, uitleg: { werken: { 990991: nieuw } } });
  assert.match(e2.uitleg.ontbreekt.join(" · "), /huisnummers niet gepubliceerd/);
});

// ---------- 4. het adres van de beheerder op een andere straat ----------

test("4. noemt de beheerder het adres met nummer op een andere straat, dan zegt de kaart niet dat het nummer ontbreekt", () => {
  const titels = ["2018 ANTWERPEN, PROEFLEI 1DN02", "2018 ANTWERPEN, PROEFLEI 12", "2018 | Antwerpen | Proeflei | 12"]; // verzonnen
  for (const title of titels) {
    for (const straten of [[VOORBEELDLAAN], []]) {
      const w = binnen(gipod(990992, title, { Owner: "Fluvius System Operator", PublicDomainOccupancyTypes: "Elektriciteit", GroundworkSpecification: "Klantaansluiting" }), { straten });
      const k = kaart(w);
      assert.match(regels(k).Waar, /de beheerder noemt (?:PROEFLEI \d|Proeflei \| 12)/, `${title} (${straten.length})`);
      assert.doesNotMatch(k.ontbreekt.join(" · "), /huisnummers niet gepubliceerd/, `${title} (${straten.length})`);
      // Ook bij een werk van vóór de overgang (huisnummerWeggelaten): het adres van de beheerder staat er, zonder "weggelaten".
      const oud = kaart(w, { feiten: { ...KU.werkFeiten(w), huisnummerWeggelaten: true } });
      assert.doesNotMatch(getoond(oud), /weggelaten|huisnummers niet gepubliceerd/, `${title} (${straten.length}): oud`);
    }
  }
});

// ---------- 5. het register bij een werk van vóór de overgang: alleen een reeks ----------

const GIPOD_INNAME = "https://geo.api.vlaanderen.be/GIPOD/ogc/features/v1/collections/INNAME/items";
const CRAB = "https://geodata.antwerpen.be/arcgissql/rest/services/P_Publiek/CRAB_Adresposities_wgs84/MapServer/0/query";
const ZONE = { type: "Polygon", coordinates: [[[4.3999, 51.2199], [4.4001, 51.2199], [4.4001, 51.2201], [4.3999, 51.2201], [4.3999, 51.2199]]] };
function nepRegister(...huisnrs) {
  let vragen = 0;
  const fetch = async (input) => {
    const url = String(input);
    if (url.startsWith(GIPOD_INNAME)) return Response.json({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: ZONE }] });
    if (url.startsWith(CRAB)) { vragen += 1; return Response.json({ features: huisnrs.map((HUISNR) => ({ attributes: { STRAATNM: "Proefstraat", HUISNR } })) }); }
    return new Response("", { status: 404 });
  };
  return { fetch, vragen: () => vragen };
}

test("5. een werk van vóór de overgang zonder vrije tekst en zonder één-adressoort krijgt geen los nummer uit het register", async () => {
  // Main bewaarde het werk met een leeg adres (het register gaf één nummer; alleen een reeks bleef). GIPOD wijzigt het werk.
  const oud = { bijgewerkt: "2099-02-01T00:00:00Z", soort: "", soortBron: "", omschrijving: "", opdrachtgever: "Stad Antwerpen - Proefdienst", straten: ["Proefstraat"], huisnummers: "", huisnummerBron: "", adres: "", gevolgen: [], fasen: [] };
  const gewoon = { ...liftWerk(WC.GEEN_OMSCHRIJVING), gipodId: 990993, occupancyTypes: ["Andere"], lastModified: "2099-03-05T00:00:00Z" };
  const persoon = { ...gewoon, gipodId: 990994, title: "Werken voor fam. Proefmans" }; // verzonnen
  for (const w of [gewoon, persoon]) {
    const reg = nepRegister("12");
    const eerst = await KR.bouwKaartUitleg({ works: [w], vorige: { werken: { [w.gipodId]: oud } }, fetch: reg.fetch, clock });
    assert.equal(reg.vragen(), 1, `${w.gipodId}: gevraagd (GIPOD wijzigde het werk)`);
    const e = eerst.document.werken[w.gipodId];
    assert.equal(e.huisnummers, "", `${w.gipodId}: huisnummers`);
    assert.equal(e.adres, "", `${w.gipodId}: adres`);
    // Een volgende verversing (ongewijzigd in GIPOD) houdt het zo.
    const daarna = await KR.bouwKaartUitleg({ works: [w], vorige: eerst.document, fetch: nepRegister("12").fetch, clock });
    assert.equal(daarna.document.werken[w.gipodId].huisnummers, "", `${w.gipodId}: tweede verversing`);
    nergens(KR.kaartUitlegVoorPubliek(daarna.document).werken[w.gipodId], /\b12\b/, `${w.gipodId}`);
  }
  // Een reeks uit het register blijft (die toonde de oude regel ook).
  const reeks = await KR.bouwKaartUitleg({ works: [gewoon], vorige: { werken: { 990993: oud } }, fetch: nepRegister("12", "14").fetch, clock });
  assert.equal(reeks.document.werken["990993"].huisnummers, "nr. 12–14");
});

// ---------- 6. de grens: de bewaarde bestanden, en de live laag toont alleen wat GIPOD nu publiceert ----------

test("6. een werk van vóór de overgang: de live laag toont het nummer dat GIPOD nu geeft, nooit een nummer dat alleen het register gaf", async () => {
  const { document } = await KR.bouwKaartUitleg({ works: [liftWerk("2000 ANTWERPEN, PROEFSTRAAT")], vorige: { werken: { 990990: OUD_LIFT } }, fetch: nepRegister("12").fetch, clock });
  const uitleg = KR.kaartUitlegVoorPubliek(document);
  nergens(uitleg.werken["990990"], /\b12\b/, "kaart-uitleg.json");
  // GIPOD zelf geeft geen nummer: de live kaart en de lijst ook niet (het register vraagt de verversing niet, de site nooit).
  const live = PC.werkEntries([liftWerk("2000 ANTWERPEN, PROEFSTRAAT")], { vandaag: VANDAAG, uitleg, isStraat });
  nergens(live.map((x) => [x.title, x.uitleg]), /\b12\b/, "live kaart");
  assert.equal(KU.lijstTitel(liftWerk("2000 ANTWERPEN, PROEFSTRAAT"), { isStraat }), "2000 ANTWERPEN, PROEFSTRAAT");
  // GIPOD geeft het nummer nu zelf in de titel: de live laag toont het zoals GIPOD (ook de lijst van main toonde de titel van
  // GIPOD), zonder "verhuis" en zonder vrije tekst; de bewaarde bestanden niet.
  const metNummer = liftWerk("2000 ANTWERPEN, PROEFSTRAAT 12 - VERHUIS PROEFMANS"); // verzonnen
  const [w] = WC.collectWorks([gipod(990990, metNummer.title, { PublicDomainOccupancyTypes: "(Verhuis)lift/levering" })], new Set([990990]), null, { isStraat });
  const [kaartLive] = PC.werkEntries([{ ...metNummer, title: w.title }], { vandaag: VANDAAG, uitleg, isStraat });
  assert.match(regels(kaartLive.uitleg).Waar, /^Proefstraat, nr\. 12/);
  nergens([kaartLive.title, kaartLive.uitleg], /verhui|PROEFMANS/i, "live kaart");
});
