// Werken van GIPOD, nakijkronde van head c4bb2927 (besluit van de eigenaar van 18 oktober 2026: "liefst exacte adres, mss geen
// verhuislift, ik weet niet privacy wil ik oké zijn, maar moet wel nuttig zijn en weten waar"). Per bevinding:
// 1. een werk dat de site al publiceerde, krijgt geen huisnummer dat de oude regel niet toonde (geen spoor tussen main en de tak);
// 2. een huisnummer dat de strikte regel niet leest ("Proefstr. 12", "Proefstraat, 12 voor", "huisnr. 12") laat geen naam staan;
// 3. de regel "één huis: geen vrije tekst" geldt ook in wat bewaard wordt (historiek, straatbestanden, kaart-uitleg.json) en in
//    de lijsten van de site;
// 4. een traject of een lijst adressen is geen huis;
// 5. één nummer uit het adressenregister maakt van een groot werk geen huis;
// 6. een tekst met "verhuis" houdt zijn adres, zonder spoor;
// 7. bij één huis staat het adres dat de beheerder noemt bij "Waar", ook op een andere straat dan de kaart;
// 8. een publiek project met één huisnummer houdt zijn tekst en "Bus en tram".
// Alle straten, nummers, namen en codes zijn verzonnen; geen netwerk. Namespace-imports: op de oude code faalt elke toets op
// haar eigen bewering, niet op een import.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as KU from "../site/kaart-uitleg.js";
import * as WC from "../site/works-core.js";
import * as SC from "../site/street-core.js";
import * as HP from "../lib/historiek-privacy.mjs";
import * as KR from "../lib/kaart-uitleg-refresh.mjs";
import { attachHindrance } from "../site/works-hindrance.js";
import { updateLiveHistory } from "../lib/live-history.mjs";
import { straatItemPrivacy } from "../lib/straat-bestanden.mjs";
import { itemVoorStraat, schrijfStraatSnapshots } from "../scripts/build-straat-snapshots.mjs";
import { buildStreetGroups } from "../site/street-overview.js";
import { buildWeekPulse } from "../site/week-pulse.js";
import { refreshLiveHistory } from "../scripts/refresh-live-history.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VANDAAG = "2099-03-10";
const PROEFSTRAAT = { id: "9101", name: "Proefstraat", postcode: "2018" };
// Een werk zoals de site het krijgt (verzonnen).
const werk = (extra = {}) => ({
  gipodId: 990960, title: "Werk in openbaar domein", status: "In uitvoering", start: "2099-03-01T06:00:00Z", end: "2099-03-30T16:00:00Z", lastModified: "2099-02-01T00:00:00Z",
  owner: "Stad Antwerpen - Proefdienst", ownerGroup: "Stad Antwerpen", streets: [PROEFSTRAAT], streetResolution: "nearest_official_axis", streetDistanceMeters: 2,
  occupancyTypes: ["Andere"], workTypes: [], hindrance: null, ...extra,
});
const fase = (description, consequences = ["Parkeerverbod"]) => ({ description, start: "2099-03-12T06:00:00Z", end: "2099-03-12T16:00:00Z", consequences });
const metFasen = (...fasen) => ({ severe: false, consequences: [...new Set(fasen.flatMap((f) => f.consequences))], start: "2099-03-12T06:00:00Z", end: "2099-03-12T16:00:00Z", phases: fasen });
// De straatas (verzonnen), zoals de site ze de kaart en de ingang geeft: alleen een straat die we kennen is een straat.
const isStraat = (naam) => ["proefstraat", "testlaan", "testlei", "voorbeeldlaan"].includes(String(naam).toLowerCase());
const kaart = (w, opties = {}) => KU.werkKaartje(w, { vandaag: VANDAAG, isStraat, ...opties });
const regels = (k) => Object.fromEntries(k.regels);
const getoond = (k) => [k.titel, k.samenvatting, k.plek, k.bronTekst, ...k.regels.flat(), ...k.ontbreekt].join(" ¶ ");
const REGISTER = "afgeleid uit de werfzone en het adressenregister";
const metRegister = (w, nr) => ({ ...KU.werkFeiten(w), huisnummers: nr, huisnummerBron: REGISTER });
const teksten = (waarde, uit = []) => {
  if (typeof waarde === "string") uit.push(waarde);
  else if (Array.isArray(waarde)) for (const v of waarde) teksten(v, uit);
  else if (waarde && typeof waarde === "object") for (const v of Object.values(waarde)) teksten(v, uit);
  return uit;
};
const nergens = (waarde, re, wat) => { for (const t of teksten(waarde)) assert.doesNotMatch(t, re, `${wat}: ${JSON.stringify(t)}`); };

// Een nep-adressenregister: één nummer voor elk werk; de vragen worden geteld (verzonnen).
const GIPOD_INNAME = "https://geo.api.vlaanderen.be/GIPOD/ogc/features/v1/collections/INNAME/items";
const CRAB = "https://geodata.antwerpen.be/arcgissql/rest/services/P_Publiek/CRAB_Adresposities_wgs84/MapServer/0/query";
const ZONE = { type: "Polygon", coordinates: [[[4.3999, 51.2199], [4.4001, 51.2199], [4.4001, 51.2201], [4.3999, 51.2201], [4.3999, 51.2199]]] };
function nepRegister(huisnr = "12") {
  const vragen = [];
  const fetch = async (input) => {
    const url = String(input);
    if (url.startsWith(GIPOD_INNAME)) { vragen.push(["werfzone", new URL(url).searchParams.get("filter")]); return Response.json({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: ZONE }] }); }
    if (url.startsWith(CRAB)) { vragen.push(["register"]); return Response.json({ features: [{ attributes: { STRAATNM: "Proefstraat", HUISNR: huisnr } }] }); }
    return new Response("", { status: 404 });
  };
  return { fetch, register: () => vragen.filter(([d]) => d === "register").length };
}
const clock = () => new Date("2099-03-10T03:00:00Z");

// ---------- 1. een werk van vóór de overgang wordt niet onthullender ----------

// De stand van main (vóór het besluit): een lift zonder adres (main zocht het niet op bij één adres), en een bouwwerf met een
// leeg adres (het register gaf één nummer; main bewaarde alleen een reeks). Geen versiemerk (adresRegel).
const OUD_LIFT = { bijgewerkt: "2099-02-01T00:00:00Z", soort: WC.INNAME_LIFT, soortBron: "soort inname in GIPOD", omschrijving: "", opdrachtgever: "Stad Antwerpen - Proefdienst", straten: ["Proefstraat"], huisnummers: "", huisnummerBron: "", gevolgen: [], fasen: [] };
const OUD_BOUW = { ...OUD_LIFT, soort: "Bouwwerf", soortBron: "fasen van de hinder in GIPOD", adres: "", fasen: [{ naam: "vernieuwingswerken in appartement", start: "2099-03-12", eind: "2099-03-12", gevolgen: ["parkeerverbod"] }] };
const liftWerk = (extra = {}) => werk({ gipodId: 990961, occupancyTypes: ["Lift/levering"], ...extra });
const bouwWerk = (extra = {}) => werk({ gipodId: 990962, hindrance: metFasen(fase("vernieuwingswerken in appartement")), ...extra });

test("1. een werk van vóór de overgang krijgt geen huisnummer uit het register dat de oude regel niet gaf, ook niet na een wijziging in GIPOD", async () => {
  const vorige = { werken: { 990961: OUD_LIFT, 990962: OUD_BOUW } };
  const reg = nepRegister("12");
  const { document } = await KR.bouwKaartUitleg({ works: [liftWerk(), bouwWerk()], vorige, fetch: reg.fetch, clock });
  assert.equal(reg.register(), 0, "niets opnieuw gevraagd: de lift werd nooit gevraagd, het lege adres is klaar");
  for (const id of ["990961", "990962"]) {
    assert.equal(document.werken[id].huisnummers, "", id);
    assert.equal("adresRegel" in document.werken[id], false, `${id}: blijft een werk van vóór de overgang`);
  }
  // GIPOD wijzigt beide werken: de lift wordt nog altijd niet gevraagd (zoals de oude regel bij één adres), de bouwwerf wel,
  // maar één nummer van het register blijft dan weg (alleen een reeks, zoals toen).
  const gewijzigd = nepRegister("12");
  const daarna = await KR.bouwKaartUitleg({ works: [liftWerk({ lastModified: "2099-03-05T00:00:00Z" }), bouwWerk({ lastModified: "2099-03-05T00:00:00Z" })], vorige, fetch: gewijzigd.fetch, clock });
  assert.equal(gewijzigd.register(), 1);
  for (const id of ["990961", "990962"]) {
    assert.equal(daarna.document.werken[id].huisnummers, "", id);
    assert.ok(!daarna.document.werken[id].adres, id);
    assert.equal("adresRegel" in daarna.document.werken[id], false, id);
  }
  // Een reeks uit het register blijft wel (die toonde de oude regel ook).
  const reeks = await KR.bouwKaartUitleg({ works: [bouwWerk({ lastModified: "2099-03-05T00:00:00Z" })], vorige, fetch: nepRegister("12").fetch, clock });
  assert.equal(reeks.document.werken["990962"].huisnummers, "");
  // Een nieuw werk (niet in de vorige stand) krijgt het exacte adres, met het merk.
  const nieuw = nepRegister("12");
  const { document: d2 } = await KR.bouwKaartUitleg({ works: [liftWerk({ gipodId: 990963 })], vorige, fetch: nieuw.fetch, clock });
  assert.equal(nieuw.register(), 1);
  assert.equal(d2.werken["990963"].huisnummers, "nr. 12");
  assert.equal(d2.werken["990963"].adresRegel, KR.ADRES_REGEL);
});

test("1. een werk voor één huis van vóór de overgang krijgt ook uit zijn tekst geen nummer bij, in kaart-uitleg.json en in de historiek", async () => {
  // Main bewaarde de lift zonder huisnummer; GIPOD geeft de titel met het nummer.
  const { document } = await KR.bouwKaartUitleg({ works: [liftWerk({ title: "2000 ANTWERPEN, PROEFSTRAAT 12" })], vorige: { werken: { 990961: OUD_LIFT } }, fetch: null, clock });
  assert.equal(document.werken["990961"].huisnummers, "");
  nergens(document.werken["990961"], /\b12\b/, "kaart-uitleg.json");
  // De historiek kende de titel zonder nummer (de regel van main): die blijft, ook in de straatbestanden.
  const T1 = "2099-03-09T03:00:00.000Z", T2 = "2099-03-10T03:00:00.000Z";
  const vroeger = updateLiveHistory(null, { observedAt: T1, worksResult: HP.resultaatVoorHistoriek({ ok: true, items: [liftWerk({ title: "2000 ANTWERPEN, PROEFSTRAAT" })] }), publicSpaceResult: { ok: true, items: [] } });
  const nu = HP.werkenZoalsBekend?.([liftWerk({ title: "2000 ANTWERPEN, PROEFSTRAAT 12" })], vroeger.layers.works) || [liftWerk({ title: "2000 ANTWERPEN, PROEFSTRAAT 12" })];
  const daarna = updateLiveHistory(vroeger, { observedAt: T2, worksResult: HP.resultaatVoorHistoriek({ ok: true, items: nu }), publicSpaceResult: { ok: true, items: [] } });
  assert.equal(daarna.layers.works.items[0].title, "2000 ANTWERPEN, PROEFSTRAAT");
  assert.deepEqual(daarna.changes.filter((c) => c.observedAt === T2), []);
  assert.equal(itemVoorStraat(nu[0], { laag: "werken" }).title, "2000 ANTWERPEN, PROEFSTRAAT");
  // Een werk dat niet voor één huis is, krijgt zijn nummer wel terug (de oude regel toonde het in kaart-uitleg.json).
  const riool = werk({ gipodId: 990964, title: "Proefstraat 12 - vervanging riolering", occupancyTypes: ["Riolering"] }); // verzonnen
  const [terug] = HP.werkenZoalsBekend?.([riool], { items: [{ id: "work:990964", gipodId: 990964, title: "Proefstraat - vervanging riolering" }] }) || [null];
  assert.equal(terug?.title, "Proefstraat 12 - vervanging riolering");
});

test("1. de verversing: historiek, kaart-uitleg.json en straatbestanden houden een werk van vóór de overgang zonder nieuw nummer", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "werken-nakijk3-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const DISTRICT = { type: "Polygon", coordinates: [[[4.38, 51.2], [4.43, 51.2], [4.43, 51.24], [4.38, 51.24], [4.38, 51.2]]] };
  const as = { type: "Feature", properties: { LSTRNMID: "9101", LSTRNM: "Proefstraat", RSTRNMID: "9101", RSTRNM: "Proefstraat", postcode: "2018", DISTRICT: "ANTWERPEN" }, geometry: { type: "LineString", coordinates: [[4.399, 51.219], [4.401, 51.221]] } };
  const lift = (Description) => ({ type: "Feature", geometry: { type: "Point", coordinates: [4.4, 51.22] }, properties: { GipodId: 990965, Status: "In uitvoering", Start: "2099-03-01T06:00:00Z", End: "2099-03-30T16:00:00Z", LastModifiedOn: "2099-02-01T00:00:00Z", Description, Owner: "Stad Antwerpen - Proefdienst", PublicDomainOccupancyTypes: "(Verhuis)lift/levering" } });
  const nepFetch = (Description) => async (input) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/portal_publiek9/MapServer/905/")) return Response.json({ type: "FeatureCollection", features: [as] });
    if (url.pathname.includes("/portal_publiek2/MapServer/109/")) return Response.json({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: DISTRICT }] });
    if (url.pathname.endsWith("/collections/INNAME_PUNT/items")) return Response.json({ type: "FeatureCollection", features: [lift(Description)], links: [] });
    if (url.pathname.endsWith("/collections/HINDER_PUNT/items")) return Response.json({ type: "FeatureCollection", features: [], links: [] });
    if (String(input).startsWith(GIPOD_INNAME)) return Response.json({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: ZONE }] });
    if (String(input).startsWith(CRAB)) return Response.json({ features: [{ attributes: { STRAATNM: "Proefstraat", HUISNR: "12" } }] });
    if (/\/P_ASign\/ASign\/MapServer\/\d+\/query$/.test(url.pathname)) return Response.json(url.searchParams.get("returnIdsOnly") === "true" ? { objectIds: [] } : { features: [] });
    return new Response("", { status: 404 });
  };
  fs.mkdirSync(path.join(dir, "site", "geo"), { recursive: true });
  fs.writeFileSync(path.join(dir, "site", "geo", "straten.json"), JSON.stringify({ schemaVersion: 1, streets: [["9101", "Proefstraat", "2018", ["2018-01"], [4.399, 51.219, 4.401, 51.221]]] }));
  // De stand van main: de titel zonder huisnummer, een kaart-uitleg.json zonder versiemerk.
  await refreshLiveHistory({ rootDir: dir, fetch: nepFetch("2000 ANTWERPEN, PROEFSTRAAT"), clock: () => new Date("2099-03-09T03:00:00Z"), log: () => {} });
  const uitlegFile = path.join(dir, "site", "sources", "kaart-uitleg.json");
  const oud = JSON.parse(fs.readFileSync(uitlegFile, "utf8"));
  for (const w of Object.values(oud.werken)) { delete w.adresRegel; delete w.adres; w.huisnummers = ""; w.huisnummerBron = ""; }
  fs.writeFileSync(uitlegFile, KR.serialiseer(oud));
  // Na de overgang geeft GIPOD de titel met het nummer, en het register één nummer.
  const history = await refreshLiveHistory({ rootDir: dir, fetch: nepFetch("2000 ANTWERPEN, PROEFSTRAAT 12"), clock: () => new Date("2099-03-10T03:00:00Z"), log: () => {} });
  assert.equal(history.layers.works.items[0].title, "2000 ANTWERPEN, PROEFSTRAAT");
  const uitleg = JSON.parse(fs.readFileSync(uitlegFile, "utf8"));
  assert.equal(uitleg.werken["990965"].huisnummers, "");
  nergens(uitleg.werken["990965"], /\b12\b/, "kaart-uitleg.json");
  schrijfStraatSnapshots({ rootDir: dir, agendaItems: [], clock: () => new Date("2099-03-10T05:00:00Z") });
  const straat = JSON.parse(fs.readFileSync(path.join(dir, "site", "straat", "9101.json"), "utf8"));
  assert.deepEqual(straat.werken.map((w) => w.title), ["2000 ANTWERPEN, PROEFSTRAAT"]);
});

// ---------- 2. een nummer dat de strikte regel niet leest, laat geen naam staan ----------

test("2. 'Proefstr. 12', 'Proefstraat, 12 voor', 'huisnr. 12', 'nummer 12' of een andere straat: de naam staat nergens", () => {
  const gevallen = [
    "Stelling Proefstr. 12 voor fam. Proefmans", "Stelling bij fam. Proefmans, Voorbeeldlaan 7", "Stelling Proefstraat, 12 voor fam. Proefmans", // verzonnen
    "Stelling Proefstraat huisnr. 12 Proefmans", "Stelling Proefstraat nummer 12 Proefmans", "Stelling Proefstr. 12 Proefmans", "Stelling Voorbeeldlaan 7 Proefmans", // verzonnen
  ];
  for (const title of gevallen) {
    const w = werk({ title, occupancyTypes: ["Stelling"] });
    const k = kaart(w);
    assert.doesNotMatch(getoond(k), /Proefmans/, title);
    assert.equal(k.bronTekst, "", title);
    assert.equal(KU.isEenHuis(KU.werkFeiten(w)), true, title);
    // Ook wat bewaard wordt.
    assert.doesNotMatch(JSON.stringify(HP.itemVoorHistoriek({ ...w, id: "work:990960" })), /Proefmans/, title);
    assert.doesNotMatch(JSON.stringify(itemVoorStraat(w, { laag: "werken" })), /Proefmans/, title);
  }
  // De strikte regel leest nu ook de afkorting, "huisnr." en "nummer": het exacte adres bij "Waar".
  assert.equal(KU.huisnummersUitTekst("Stelling Proefstr. 12 voor fam. Proefmans", "Proefstraat"), "nr. 12"); // verzonnen
  assert.equal(KU.huisnummersUitTekst("Stelling Proefstraat huisnr. 12", "Proefstraat"), "nr. 12");
  assert.equal(KU.huisnummersUitTekst("Stelling Proefstraat nummer 12", "Proefstraat"), "nr. 12");
  assert.equal(regels(kaart(werk({ title: "Stelling Proefstr. 12 voor fam. Proefmans", occupancyTypes: ["Stelling"] }))).Waar, "Proefstraat, nr. 12 (omschrijving van de beheerder)"); // verzonnen
  // Een naam zonder huisnummer, met "fam.", "dhr." of "voor <Naam>": ook geen vrije tekst.
  for (const title of ["Werken voor fam. Proefmans", "Afvoer dhr. Proefmans", "Kabelwerken voor Proefmans"]) { // verzonnen
    assert.doesNotMatch(getoond(kaart(werk({ title, occupancyTypes: ["Telecom"] }))), /Proefmans/, title);
  }
  // "voor De Lijn", "bij Fluvius" of een straat na "bij" is geen naam: die tekst blijft.
  assert.match(getoond(kaart(werk({ title: "Herstelling halte voor De Lijn", occupancyTypes: ["Spoorwerken"] }))), /Herstelling halte voor De Lijn/);
  assert.match(getoond(kaart(werk({ title: "Wegenwerken bij Proefstraat en Testlaan", occupancyTypes: ["Wegeniswerken"] }))), /bij Proefstraat en Testlaan/);
});

// ---------- 3. wat bewaard wordt en de lijsten: dezelfde regel als de kaart ----------

test("3. een container voor één huis: geen naam in de historiek, de straatbestanden, kaart-uitleg.json en de lijsten; wel het adres", async () => {
  const w = werk({ title: "Container voor Proefmans, Proefstraat 12", occupancyTypes: ["Container"], hindrance: metFasen(fase("Container Proefmans")) }); // verzonnen
  const T = "2099-03-10T03:00:00.000Z";
  const h = updateLiveHistory(null, { observedAt: T, worksResult: HP.resultaatVoorHistoriek({ ok: true, items: [w] }), publicSpaceResult: { ok: true, items: [] } });
  assert.equal(h.layers.works.items[0].title, "Proefstraat 12");
  const s = itemVoorStraat(w, { laag: "werken" });
  assert.equal(s.title, "Proefstraat 12");
  nergens(s, /Proefmans/, "straatbestand");
  const { document } = await KR.bouwKaartUitleg({ works: [w], fetch: null, clock });
  const publiek = KR.kaartUitlegVoorPubliek(document);
  nergens(publiek.werken, /Proefmans/, "kaart-uitleg.json");
  assert.equal(publiek.werken["990960"].huisnummers, "nr. 12");
  assert.equal(publiek.werken["990960"].soort, "Container");
  // De kaart uit de bewaarde feiten zegt niet dat de beheerder niets schreef.
  const uitBewaard = kaart({ ...w, title: "Werk in openbaar domein", hindrance: null }, { feiten: publiek.werken["990960"] });
  assert.doesNotMatch(uitBewaard.ontbreekt.join(" · "), /omschrijving niet gepubliceerd/);
  // De lijsten van de site (zoeken en de koppen): zonder de vrije tekst.
  const groepen = buildStreetGroups({ works: [w] });
  nergens(groepen, /Proefmans/, "straatoverzicht");
  const pulse = buildWeekPulse({ works: [{ ...w, start: "2099-03-10T06:00:00Z" }], fromDay: "2099-03-09", toDay: "2099-03-15" });
  nergens(pulse, /Proefmans/, "weekpuls");
  assert.equal(KU.werkVoorPubliek?.(w)?.title, "Proefstraat 12");
  // Het adres houdt een officiële straat zonder gekende uitgang (de stratenlijst van het district, lib/historiek-privacy.mjs:
  // isOfficieleStraat), ook in hoofdletters en zonder nummer; de rest van de tekst niet.
  const isStraat = (naam) => ["proefbroek", "oude proefbeurs"].includes(naam.toLowerCase()); // verzonnen
  const aansluiting = werk({ title: "2020 ANTWERPEN, PROEFBROEK", owner: "Fluvius System Operator", ownerGroup: "Fluvius", occupancyTypes: ["Elektriciteit"], workTypes: ["klantaansluiting"], streets: [] }); // verzonnen
  assert.equal(KU.werkVoorPubliek(aansluiting, { isStraat }), aansluiting, "alleen een adres: hetzelfde werk");
  assert.equal(KU.werkVoorPubliek({ ...aansluiting, title: "2000 | Antwerpen | Oude Proefbeurs | kabel voor Proefmans" }, { isStraat }).title, "2000 | Antwerpen | Oude Proefbeurs"); // verzonnen
  assert.equal(KU.adresDeel("2000 Antwerpen - Proefbroek klantaansluiting fam. Proefmans - Proefbroek", { isStraat }), "2000 Antwerpen - Proefbroek"); // verzonnen
  const live = fs.readFileSync(path.join(root, "site", "works-live.js"), "utf8");
  assert.doesNotMatch(live, /<h3>\$\{esc\(i\.title\)\}<\/h3>/, "de kop van een werk in de lijst is niet de ruwe titel");
  assert.doesNotMatch(live, /\[i\.gipodId,i\.title,/, "zoeken loopt niet over de ruwe titel");
});

test("3. ook een titel met een naam na het adres, en de scans melden vrije tekst bij één huis", () => {
  const w = werk({ title: "2018 Antwerpen, Proefstraat 12 - gevelwerken woning Jan Proefmans", occupancyTypes: ["Stelling"] }); // verzonnen
  const T = "2099-03-10T03:00:00.000Z";
  const h = updateLiveHistory(null, { observedAt: T, worksResult: HP.resultaatVoorHistoriek({ ok: true, items: [w] }), publicSpaceResult: { ok: true, items: [] } });
  assert.equal(h.layers.works.items[0].title, "2018 Antwerpen, Proefstraat 12");
  assert.equal(itemVoorStraat(w, { laag: "werken" }).title, "2018 Antwerpen, Proefstraat 12");
  // Een oud bestand met de vrije tekst bij één huis: een vondst (zonder de waarde), en de opkuis haalt hem weg.
  const oud = { id: "work:990960", gipodId: 990960, title: "Container voor Proefmans, Proefstraat 12", occupancyTypes: ["Container"], streets: [PROEFSTRAAT] }; // verzonnen
  assert.ok(HP.historiekPrivacyBevindingen(oud).some((v) => v.code === "vrije_tekst"));
  assert.ok(straatItemPrivacy({ werken: [oud] }).some((v) => v.code === "vrije_tekst"));
  assert.ok(HP.historiekPrivacyBevindingen(oud).every((v) => !/Proefmans/.test(v.path)));
  assert.deepEqual(HP.historiekPrivacyBevindingen(HP.historiekVoorPubliek({ layers: { works: { items: [oud] } } })), []);
  // kaart-uitleg.json: een werk voor één huis met vrije tekst is een fout van validate-data.
  const feiten = { soort: "Container", soortBron: "soort inname in GIPOD", omschrijving: "Container voor Proefmans, Proefstraat 12", opdrachtgever: "", straten: ["Proefstraat"], huisnummers: "nr. 12", huisnummerBron: "omschrijving van de beheerder", gevolgen: [], fasen: [] }; // verzonnen
  assert.deepEqual(KR.vrijeTekstBijEenHuis?.({ werken: { 990960: feiten } }), ["werken.990960: vrije tekst bij een werk voor één huis"]);
  assert.deepEqual(KR.vrijeTekstBijEenHuis?.({ werken: { 990960: KR.schoonWerk(feiten) } }), []);
});

// ---------- 4. een traject of een lijst adressen is geen huis ----------

test("4. een traject van adres tot adres geeft geen los huisnummer en is geen huis; een lijst van adressen ook niet", () => {
  const traject = "Trambaan vanaf Proefstraat 5 – Testlei 32 herstellingswerken en spoorvernieuwing aan de trambaan en haltes"; // verzonnen
  assert.equal(KU.huisnummersUitTekst(traject, "Proefstraat"), "");
  assert.equal(KU.huisnummersUitTekst("Werken van Proefstraat 5 tot Testlei 32", "Proefstraat"), ""); // verzonnen
  const tram = werk({ title: traject, occupancyTypes: ["Spoorwerken"], hindrance: { severe: true, consequences: ["Geen doorgang voor gemotoriseerd verkeer"], start: "2099-03-01T06:00:00Z", end: "2099-03-30T16:00:00Z", phases: [fase("Spoorvernieuwing deel 1", ["Geen doorgang voor gemotoriseerd verkeer"])] } });
  const k = kaart(tram, { feiten: metRegister(tram, "nr. 23–51") });
  assert.equal(regels(k).Waar, `Proefstraat, nr. 23–51 (${REGISTER})`);
  assert.match(regels(k).Wat, /Volgens de beheerder: “/);
  assert.ok(regels(k)["Bus en tram"], "Bus en tram blijft");
  assert.match(regels(k).Fasen, /Spoorvernieuwing deel 1/);
  assert.equal(KU.isEenHuis(KU.werkFeiten(tram)), false);
  // Ook wat een oudere verversing uit zo'n traject las (kaart-uitleg.json): het bereik van het register, zoals toen.
  const oud = { soort: "Spoorwerken", soortBron: "soort inname in GIPOD", omschrijving: traject, opdrachtgever: "", straten: ["Proefstraat"], huisnummers: "nr. 5", huisnummerBron: "omschrijving van de beheerder", adres: "nr. 23–51", gevolgen: [], fasen: [] };
  assert.equal(KR.schoonWerk(oud).huisnummers, "nr. 23–51");
  // Een lijst van adressen (negen koppelputten in zes straten): geen huis, de tekst blijft; "31/33" is een reeks.
  const lijst = "5201: Proefstraat 82; 5204: Testlei 2A; 5205: Voorbeeldlaan 31/33 (9 koppelputten gas in 1 wijk)"; // verzonnen
  const gas = werk({ title: lijst, owner: "Fluvius System Operator", ownerGroup: "Fluvius", occupancyTypes: ["Olie, gas, chemicaliën"] });
  assert.equal(KU.isEenHuis(KU.werkFeiten(gas)), false);
  assert.match(getoond(kaart(gas)), /9 koppelputten gas in 1 wijk/);
  assert.equal(KU.huisnummersUitTekst("Voorbeeldlaan 31/33", "Voorbeeldlaan"), "nr. 31–33"); // verzonnen
  assert.equal(KU.huisnummersUitTekst("Voorbeeldlaan 31/2", "Voorbeeldlaan"), "nr. 31", "een bus is geen reeks"); // verzonnen
});

// ---------- 5. één nummer uit het register maakt van een groot werk geen huis ----------

test("5. een groot werk met één nummer uit het adressenregister houdt zijn tekst, zonder de zin over één adres", () => {
  const gevallen = [
    werk({ title: "Heraanleg Proefstraat en omgeving - project Proefring", occupancyTypes: ["Wegeniswerken;Riolering"] }), // verzonnen
    werk({ title: "Nieuwe riolering aanleggen en oude kasseibaan vervangen naar asfalt", occupancyTypes: ["Riolering"] }),
    werk({ title: "Spoorvernieuwing", occupancyTypes: ["Spoorwerken"] }),
  ];
  for (const w of gevallen) {
    const f = metRegister(w, "nr. 7");
    assert.equal(KU.isEenHuis(f), false, w.title);
    const k = kaart(w, { feiten: f });
    assert.doesNotMatch(getoond(k), /één adres|één huis/, w.title);
    assert.match(getoond(k), /Volgens de beheerder|De beheerder schrijft/, w.title);
    assert.equal(regels(k).Waar, `Proefstraat, nr. 7 (${REGISTER})`, w.title);
  }
  // Geen publiek project en wel vrije tekst: het ene nummer van het register staat er niet naast (zo wijst de tekst geen huis
  // aan); de tekst blijft.
  const ander = werk({ title: "Plaatsen bouwhekken rond de werf", occupancyTypes: ["Andere"] }); // verzonnen
  const k = kaart(ander, { feiten: metRegister(ander, "nr. 7") });
  assert.doesNotMatch(getoond(k), /nr\. 7/);
  assert.match(getoond(k), /Plaatsen bouwhekken rond de werf/);
});

test("5. de verversing bewaart het ene nummer van het register niet naast vrije tekst van een werk dat geen huis en geen project is", async () => {
  const ander = werk({ gipodId: 990966, title: "Plaatsen bouwhekken rond de werf" }); // verzonnen
  const riool = werk({ gipodId: 990967, title: "Nieuwe riolering aanleggen", occupancyTypes: ["Riolering"] });
  const { document } = await KR.bouwKaartUitleg({ works: [ander, riool], fetch: nepRegister("7").fetch, clock });
  assert.equal(document.werken["990966"].huisnummers, "");
  assert.ok(!document.werken["990966"].adres);
  assert.equal(document.werken["990967"].huisnummers, "nr. 7");
});

// ---------- 6. "verhuis" in de titel: het adres blijft, zonder spoor ----------

test("6. een titel met 'verhuis' houdt zijn adres: precies een werk waarvoor GIPOD alleen het adres gaf", () => {
  const gipod = (id, Description) => ({ type: "Feature", geometry: { type: "Point", coordinates: [4.4, 51.22] }, properties: { GipodId: id, Status: "In uitvoering", Start: "2099-03-01T06:00:00Z", End: "2099-03-30T16:00:00Z", Description, Owner: "Stad Antwerpen - Proefdienst", PublicDomainOccupancyTypes: "Andere" } });
  const [met] = WC.collectWorks([gipod(990968, "2060 Antwerpen, Proefstraat 12 - verhuislift")], new Set([990968]), null, { isStraat }); // verzonnen
  const [zonder] = WC.collectWorks([gipod(990968, "2060 Antwerpen, Proefstraat 12")], new Set([990968]), null, { isStraat }); // verzonnen
  assert.deepEqual(met, zonder);
  const k = kaart({ ...met, streets: [PROEFSTRAAT] });
  assert.equal(regels(k).Waar, "Proefstraat, nr. 12 (omschrijving van de beheerder)");
  assert.doesNotMatch(k.ontbreekt.join(" · "), /huisnummers niet gepubliceerd/);
  // Ook in één stuk en met een naam: alleen het adres blijft.
  assert.equal(WC.collectWorks([gipod(990969, "Verhuis fam. Proefmans, Testlaan 14")], new Set([990969]), null, { isStraat })[0].title, "Testlaan 14"); // verzonnen
  assert.equal(WC.collectWorks([gipod(990969, "Proefstraat 12 verhuislift")], new Set([990969]), null, { isStraat })[0].title, "Proefstraat 12"); // verzonnen
  assert.equal(WC.collectWorks([gipod(990969, "Verhuislift voor Proefmans")], new Set([990969]), null, { isStraat })[0].title, WC.GEEN_OMSCHRIJVING); // verzonnen
  // Wat bewaard was, met dezelfde regel (de straat van het werk).
  assert.equal(WC.werkZonderVerhuis({ title: "Verhuis Proefstraat 12", streets: [PROEFSTRAAT] }).title, "Proefstraat 12"); // verzonnen
  // Het adres van de beheerder op een andere straat (binnen 150 m) wint, zoals bij elke titel met een adres.
  const as = (id, naam, coords) => ({ type: "Feature", properties: { LSTRNMID: id, LSTRNM: naam, RSTRNMID: id, RSTRNM: naam, postcode: "2060", DISTRICT: "ANTWERPEN" }, geometry: { type: "LineString", coordinates: coords } });
  const index = SC.buildStreetIndex([as("9201", "Proefstraat", [[4.4, 51.22], [4.402, 51.22]]), as("9202", "Testlei", [[4.4, 51.219], [4.4, 51.223]])]);
  const [hoek] = WC.collectWorks([{ ...gipod(990970, "2060 | Antwerpen | Testlei | 12 | verhuis"), geometry: { type: "Point", coordinates: [4.40101, 51.22003] } }], new Set([990970]), null, { isStraat }); // verzonnen
  const [opgelost] = SC.applyWorkStreetResolution([hoek], index);
  assert.deepEqual(opgelost.streets.map((s) => s.name), ["Testlei"]);
  assert.match(regels(kaart(opgelost)).Waar, /^Testlei, nr\. 12 /);
});

// ---------- 7. bij één huis: het adres dat de beheerder noemt, staat bij "Waar" ----------

test("7. bij één huis staat het adres dat de beheerder noemt bij 'Waar', ook op een andere straat dan de kaart of zonder straat", () => {
  const fluvius = { owner: "Fluvius System Operator", ownerGroup: "Fluvius", occupancyTypes: ["Elektriciteit"], workTypes: ["klantaansluiting"] };
  const ander = kaart(werk({ ...fluvius, title: "2018 ANTWERPEN, VOORBEELDLAAN 12" })); // verzonnen
  assert.match(regels(ander).Waar, /^Proefstraat\b.*VOORBEELDLAAN 12/);
  assert.equal(ander.bronTekst, "");
  const zonderStraat = kaart(werk({ ...fluvius, title: "2018 ANTWERPEN, VOORBEELDLAAN 12, kabel naar de achterbouw", streets: [], streetNearby: [] })); // verzonnen
  assert.match(regels(zonderStraat).Waar, /VOORBEELDLAAN 12/);
  assert.doesNotMatch(getoond(zonderStraat), /achterbouw/);
  // Alleen straat en nummer: geen naam die voor het adres staat.
  const naam = kaart(werk({ ...fluvius, title: "Nieuwe aansluiting fam. Proefmans, Voorbeeldlaan 14" })); // verzonnen
  assert.match(regels(naam).Waar, /Voorbeeldlaan 14/);
  assert.doesNotMatch(getoond(naam), /Proefmans/);
});

// ---------- 8. een publiek project met één huisnummer houdt zijn tekst ----------

test("8. een tram-, riolerings- of gaswerk met één huisnummer houdt zijn tekst, zijn fasen en 'Bus en tram'", () => {
  const tram = kaart(werk({ title: "Proefstraat 21 - herstelling tramspoor", occupancyTypes: ["Spoorwerken"], hindrance: metFasen(fase("Tramsporen vernieuwen")) })); // verzonnen
  assert.equal(regels(tram)["Bus en tram"], "Tramsporen vernieuwen · Proefstraat 21 - herstelling tramspoor");
  assert.match(regels(tram).Wat, /Volgens de beheerder: “herstelling tramspoor”/);
  assert.match(regels(tram).Fasen, /^Tramsporen vernieuwen /);
  assert.equal(regels(tram).Waar, "Proefstraat, nr. 21 (omschrijving van de beheerder)");
  assert.doesNotMatch(getoond(tram), /één adres|één huis/);
  for (const [title, extra] of [
    ["Proefstraat 12 - vervanging riolering en kolken", { occupancyTypes: ["Riolering"] }], // verzonnen
    ["Proefstraat 58 - koppelput gas, losse bestrating in de stoep", { owner: "Fluvius System Operator", ownerGroup: "Fluvius", occupancyTypes: ["Olie, gas, chemicaliën"] }], // verzonnen
  ]) {
    const k = kaart(werk({ title, ...extra }));
    assert.match(getoond(k), /Volgens de beheerder|De beheerder schrijft/, title);
    assert.doesNotMatch(getoond(k), /één adres|één huis/, title);
  }
  // Een aansluiting in de tekst van een net blijft een werk voor één huis.
  assert.equal(KU.isEenHuis(KU.werkFeiten(werk({ title: "Huisaansluiting riolering Proefstraat 12", occupancyTypes: ["Riolering"] }))), true); // verzonnen
});
