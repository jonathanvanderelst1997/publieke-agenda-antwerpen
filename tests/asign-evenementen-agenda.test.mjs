// Evenementdossiers als agendapunten (pakket P2, lib/asign-evenementen-agenda.mjs). Alle gegevens zijn
// verzonnen: geen echte dossiers, straten, organisatoren of personen.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ASIGN_EVENEMENTEN_SOURCE_ID, DUBBEL_METER, MAX_DAGEN_APART, asignAgendapunten, asignEvenementenDocument, dossierFeiten, isDubbel,
  koppelBesluiten, perioden, schrijfAsignEvenementen, titelVan, urenVan,
} from "../lib/asign-evenementen-agenda.mjs";
import { naamMetHuisnummer } from "../lib/ebesluit-evenementen.mjs";
import { mergeEvents } from "../lib/merge-events.mjs";
import { privacyFindings, validateSourceDocument } from "../lib/source-feed.mjs";
import { validateEventContract } from "../lib/event-contract.mjs";
import { buildStreetIndex } from "../site/street-core.js";

const VANDAAG = "2026-10-10";
const RETRIEVED = "2026-10-10T05:20:00.000Z";
const GOED = "aanvraag_goedgekeurd";

// Een dossier zoals dossierFeiten() het geeft (de verversing berekent langs en zone met de straatas).
const feit = (dossier, velden = {}) => ({
  dossier, status: GOED, binnenDistrict: true, fasen: [{ naam: "Evenement", start: "2026-10-18", eind: "2026-10-18" }], dagen: ["2026-10-18"],
  langs: [], zone: [], kernStraten: ["Proefstraat"], beginStraat: "Proefstraat", wijk: "Proefwijk", postcodes: ["2000"], speelstraat: false, vorm: null,
  ...velden,
});
const fiche = (velden = {}) => ({ zekerheid: "onbekend", naam: "", soort: "", organisator: "", uren: "", link: "", methode: "kaart", dagen: [], binnenDistrict: true, ...velden });
const bouw = (opties) => asignAgendapunten({ vandaag: VANDAAG, retrievedAt: RETRIEVED, ...opties });
const titels = (items) => items.map((i) => i.title);

test("fixture: zeker, waarschijnlijk, onbekend-groot, onbekend-klein en geweigerd geven elk het juiste item of geen", () => {
  const feiten = [
    feit("ET2099000001", { langs: ["Proefstraat", "Voorbeeldlaan"] }),
    feit("ET2099000002", { beginStraat: "Testplein", kernStraten: ["Testplein"], langs: ["Testplein", "Dummykaai"] }),
    feit("ET2099000003", { beginStraat: "Ruwe Laan", kernStraten: ["Ruwe Laan"], langs: ["Ruwe Laan", "Schetsstraat", "Kladstraat"] }),
    feit("ET2099000004", { beginStraat: "Kleine Proefgang", kernStraten: ["Kleine Proefgang"] }),
    feit("ET2099000005", { status: "aanvraag_geweigerd", langs: ["Proefstraat", "Voorbeeldlaan"] }),
    feit("ET2099000006", { status: "afgelast", langs: ["Proefstraat", "Voorbeeldlaan"] }),
    feit("ET2099000007", { beginStraat: "Feeststraat", kernStraten: ["Feeststraat"] }),
  ];
  const auto = { dossiers: {
    ET2099000001: fiche({ zekerheid: "zeker", naam: "Proefloop Zuid", soort: "loopwedstrijd of loop", methode: "kalender", link: "https://www.antwerpen.be/info/proef/proefloop-zuid" }),
    ET2099000002: fiche({ zekerheid: "waarschijnlijk", naam: "Lichtjesstoet Noord", soort: "een stoet", methode: "organisator" }),
    ET2099000003: fiche(),
    ET2099000004: fiche(),
    ET2099000005: fiche({ zekerheid: "zeker", naam: "Geweigerde Proefloop" }),
    ET2099000006: fiche({ zekerheid: "zeker", naam: "Afgelaste Proefloop" }),
    ET2099000007: fiche({ zekerheid: "waarschijnlijk", soort: "een studentenactiviteit", methode: "regels" }),
  } };
  const { items, tellers } = bouw({ feiten, auto });
  const per = Object.fromEntries(items.map((i) => [i.externalId, i]));
  assert.equal(per.ET2099000001.title, "Proefloop Zuid");
  assert.equal(per.ET2099000001.theme, "Sport");
  assert.equal(per.ET2099000002.title, "Vermoedelijk Lichtjesstoet Noord");
  assert.match(per.ET2099000002.info, /niet bevestigd/);
  assert.equal(per.ET2099000003.title, "Evenement in de Ruwe Laan — naam volgt");
  assert.equal(per.ET2099000004, undefined, "onbekend en klein (één straat, geen naam of soort): niet in de districtslijst");
  assert.equal(per.ET2099000005, undefined, "geweigerd: geen agendapunt");
  assert.equal(per.ET2099000006, undefined, "afgelast: geen agendapunt");
  // Een soort uit de regels van de herkenning is een vermoeden, geen feit (nakijkronde P2, M2).
  assert.equal(per.ET2099000007.title, "Vermoedelijk een studentenactiviteit in de Feeststraat");
  assert.match(per.ET2099000007.info, /Soort vermoed via de omschrijving in het dossier, wat vroeger op dezelfde plek gebeurde en het studentencharter; niet bevestigd\./);
  assert.doesNotMatch(per.ET2099000007.info, /De soort staat in het dossier/);
  assert.deepEqual({ inLijst: tellers.inLijst, nietInLijst: tellers.nietInLijst, afgewezen: tellers.afgewezen, metNaam: tellers.metNaam, metSoort: tellers.metSoort, naamVolgt: tellers.naamVolgt }, { inLijst: 4, nietInLijst: 1, afgewezen: 2, metNaam: 2, metSoort: 1, naamVolgt: 1 });
  for (const item of items) {
    assert.equal(item.sourceUrl, "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/22");
    assert.match(item.id, /^asign-ev-et2099\d{6}-2026-10-18$/);
    assert.equal(item.inDistrict, true);
  }
});

test("titel: handfiche, dan automatisch, dan het besluit, dan de soort, dan 'naam volgt'", () => {
  const f = feit("ET2099000010", { langs: ["Proefstraat", "Voorbeeldlaan"] });
  const hand = fiche({ zekerheid: "zeker", naam: "Handnaam Proeffeest" });
  const auto = fiche({ zekerheid: "zeker", naam: "Autonaam Proeffeest" });
  const besluit = { naam: "Besluitnaam Proeffeest" };
  assert.equal(titelVan(f, { hand, auto, besluit }).titel, "Handnaam Proeffeest");
  assert.equal(titelVan(f, { auto, besluit }).titel, "Autonaam Proeffeest");
  assert.equal(titelVan(f, { auto: fiche({ zekerheid: "waarschijnlijk", naam: "Autonaam Proeffeest" }), besluit }).titel, "Vermoedelijk Autonaam Proeffeest");
  assert.equal(titelVan(f, { besluit }).titel, "Besluitnaam Proeffeest");
  assert.equal(titelVan(f, { auto: fiche({ zekerheid: "waarschijnlijk", soort: "een wielerwedstrijd" }) }).titel, "Vermoedelijk een wielerwedstrijd in de Proefstraat");
  assert.equal(titelVan(f, { hand: fiche({ zekerheid: "zeker", soort: "een wielerwedstrijd" }) }).titel, "Wielerwedstrijd in de Proefstraat", "met de hand nagekeken: geen voorbehoud");
  assert.equal(titelVan(f, { auto: fiche({ zekerheid: "waarschijnlijk", soort: "een halloween-activiteit" }) }).titel, "Vermoedelijk een Halloween-activiteit in de Proefstraat");
  assert.equal(titelVan(f, {}).titel, "Evenement in de Proefstraat — naam volgt");
  assert.equal(titelVan(feit("ET2099000011", { beginStraat: "Testplein" }), {}).titel, "Evenement op het Testplein — naam volgt");
  // Een speelstraat via het trefwoord in het dossier, ook zonder fiche.
  assert.equal(titelVan(feit("ET2099000012", { speelstraat: true }), {}).titel, "Speelstraat in de Proefstraat");
});

test("één agendapunt per evenementdag; opbouw en afbraak als fasen, niet als items; een lang dossier per reeks", () => {
  const f = feit("ET2099000020", {
    langs: ["Proefstraat", "Voorbeeldlaan"],
    dagen: ["2026-10-17", "2026-10-18"],
    fasen: [{ naam: "Afbraak", start: "2026-10-18", eind: "2026-10-19" }, { naam: "Opbouw", start: "2026-10-15", eind: "2026-10-17" }, { naam: "Evenement", start: "2026-10-17", eind: "2026-10-18" }],
  });
  const { items } = bouw({ feiten: [f] });
  assert.deepEqual(items.map((i) => [i.date, i.endDate]), [["2026-10-17", null], ["2026-10-18", null]]);
  assert.deepEqual(items[0].fasen.map((x) => x.naam), ["Opbouw", "Evenement", "Afbraak"]);
  assert.match(items[0].info, /Opbouw vanaf donderdag 15 oktober, afbraak tot maandag 19 oktober\./);
  assert.match(items[0].info, /Parcours door 2 straten: Proefstraat en Voorbeeldlaan\./);
  // Meer dan MAX_DAGEN_APART dagen: één item per doorlopende reeks, ook als ze al loopt.
  const lang = Array.from({ length: 12 }, (_, i) => `2026-10-${String(5 + i).padStart(2, "0")}`);
  assert.ok(lang.length > MAX_DAGEN_APART);
  assert.deepEqual(perioden(lang), [["2026-10-05", "2026-10-16"]]);
  const { items: reeks } = bouw({ feiten: [feit("ET2099000021", { langs: ["Proefstraat", "Voorbeeldlaan"], dagen: lang })] });
  assert.deepEqual(reeks.map((i) => [i.date, i.endDate]), [["2026-10-05", "2026-10-16"]]);
  // Van vandaag tot 60 dagen vooruit: voorbij of later valt weg.
  const { items: venster, tellers } = bouw({ feiten: [feit("ET2099000022", { langs: ["Proefstraat", "Voorbeeldlaan"], dagen: ["2026-10-09", "2026-12-10"] })] });
  assert.deepEqual(venster, []);
  assert.equal(tellers.buitenVenster, 1);
  // Buiten de districtsgrens: geen agendapunt.
  assert.deepEqual(bouw({ feiten: [feit("ET2099000023", { binnenDistrict: false, langs: ["Proefstraat", "Voorbeeldlaan"] })] }).items, []);
});

test("uren: een eenduidige reeks uit de handfiche geeft een beginuur; anders blijft de tekst zonder uur", () => {
  const hand = { dossiers: {
    ET2099000030: fiche({ zekerheid: "zeker", naam: "Proefkoers", uren: "11 tot 18.30 uur" }),
    ET2099000031: fiche({ zekerheid: "zeker", naam: "Proefmarathon", uren: "start om 9 uur, finish sluit om 18 uur" }),
  } };
  const { items } = bouw({ feiten: [feit("ET2099000030"), feit("ET2099000031", { beginStraat: "Voorbeeldlaan" })], hand });
  const per = Object.fromEntries(items.map((i) => [i.externalId, i]));
  assert.equal(per.ET2099000030.timeSlot, "11:00");
  assert.equal(per.ET2099000030.timeText, "11 tot 18.30 uur");
  assert.equal(per.ET2099000031.timeSlot, "Info");
  assert.equal(per.ET2099000031.timeText, "start om 9 uur, finish sluit om 18 uur");
  assert.deepEqual(validateEventContract(items).errors, []);
});

test("besluit van eBesluit (P3a): naam bij dezelfde dag en straat; zonder plaats alleen bij één dossier met dezelfde opbouw en afbouw", () => {
  const besluit = (velden) => ({ id: "1.2.3.4.5", code: "2099_CBS_00001", soort: "evenement", status: "goedkeuring", orgaan: "College van burgemeester en schepenen", zitting: "2026-09-20", gepubliceerd: true, gelezen: true, naam: "Proeffeest aan de Kaai", organisator: null, dagen: ["2026-10-18"], uren: { start: "14:00", einde: "17:00" }, plaats: "Proefstraat", straten: ["Proefstraat"], postcodes: ["2000"], inDistrict: true, opbouw: null, afbouw: null, wijziging: null, vervangt: [], bron: "https://ebesluit.antwerpen.be/zittingen/1.2/agendapunten/1.2.3.4.5", ...velden });
  const f = feit("ET2099000040", { langs: ["Proefstraat", "Voorbeeldlaan"] });
  const ander = feit("ET2099000041", { beginStraat: "Elders", kernStraten: ["Elders"], langs: ["Elders", "Verderop"] });
  const k = koppelBesluiten([f, ander], [besluit()]);
  assert.equal(k.get("ET2099000040")?.naam, "Proeffeest aan de Kaai");
  assert.equal(k.has("ET2099000041"), false, "geen straat van het besluit: geen naam");
  const { items } = bouw({
    feiten: [f], besluiten: [besluit()],
    besluitItems: [{ id: "ebesluit-ev-2099-cbs-00001-2026-10-18", externalId: "2099_CBS_00001", date: "2026-10-18", endDate: null }],
  });
  assert.equal(items[0].title, "Proeffeest aan de Kaai");
  assert.equal(items[0].timeSlot, "14:00");
  assert.equal(items[0].timeText, "14 tot 17 uur");
  assert.deepEqual(items[0].sameAs, ["ebesluit-ev-2099-cbs-00001-2026-10-18"]);
  // Zonder plaats: dezelfde opbouw- en afbouwdag (op 1 dag na) bij precies één dossier.
  const fasen = [{ naam: "Opbouw", start: "2026-10-15", eind: "2026-10-17" }, { naam: "Evenement", start: "2026-10-18", eind: "2026-10-18" }, { naam: "Afbraak", start: "2026-10-18", eind: "2026-10-20" }];
  const zonder = besluit({ straten: [], plaats: "district Antwerpen", opbouw: "2026-10-16", afbouw: "2026-10-20" });
  const een = feit("ET2099000042", { beginStraat: "Elders", kernStraten: ["Elders"], fasen });
  assert.equal(koppelBesluiten([een], [zonder]).get("ET2099000042")?.naam, "Proeffeest aan de Kaai");
  const twee = feit("ET2099000043", { beginStraat: "Verderop", kernStraten: ["Verderop"], fasen });
  assert.equal(koppelBesluiten([een, twee], [zonder]).size, 0, "twee dossiers met dezelfde fasen en geen plaats: geen naam");
  // Eén dag zonder plaats en zonder opbouw/afbouw: nooit een naam.
  assert.equal(koppelBesluiten([een], [besluit({ straten: [], plaats: "district Antwerpen" })]).size, 0);
  // Een geweigerd of vervangen besluit telt niet.
  assert.equal(koppelBesluiten([f], [besluit({ status: "weigering" })]).size, 0);
});

test("ontdubbelen met de districtskalender en het districtsnieuws: zelfde dag en zelfde straat of hoogstens 250 m", () => {
  // Een route van ~430 m langs de Proefstraat (verzonnen coördinaten).
  const route = [[4.4, 51.2], [4.406, 51.2]];
  const f = feit("ET2099000050", { langs: ["Proefstraat", "Voorbeeldlaan"], vorm: { lijnen: [route], vlakken: [], kern: [route[0], route[1]] } });
  const titel = titelVan(f, {});
  const k = (velden) => ({ id: "district-kal-proef-2026-10-18", titel: "Proefcriterium", dag: "2026-10-18", eind: "2026-10-18", locatie: "Proefcafé, Voorbeeldlaan", punt: null, puntPrecisie: "", ...velden });
  assert.equal(isDubbel(f, titel, k(), "2026-10-18"), true, "zelfde dag en een straat van het dossier");
  assert.equal(isDubbel(f, titel, k(), "2026-10-19"), false, "andere dag");
  assert.equal(isDubbel(f, titel, k({ locatie: "Ergens Anders", punt: [4.403, 51.2018], puntPrecisie: "adres" }), "2026-10-18"), true, "op ~200 m van de route");
  assert.equal(isDubbel(f, titel, k({ locatie: "Ergens Anders", punt: [4.403, 51.2036], puntPrecisie: "adres" }), "2026-10-18"), false, "op ~400 m");
  assert.ok(DUBBEL_METER === 250);
  // Een dossier met een eigen naam wordt nooit samengevoegd met een andere naam op dezelfde plek.
  const genoemd = titelVan(f, { hand: fiche({ zekerheid: "zeker", naam: "Doop van de Proefclub" }) });
  assert.equal(isDubbel(f, genoemd, k(), "2026-10-18"), false);
  // Wel met dezelfde naam, ook zonder plaats ("Parade Proeflicht" en "Proeflicht").
  const parade = titelVan(f, { hand: fiche({ zekerheid: "zeker", naam: "Parade Proeflicht" }) });
  assert.equal(isDubbel(f, parade, k({ titel: "Proeflicht", locatie: "2060 Antwerpen" }), "2026-10-18"), true);
  // Twee soorten die botsen (een studentenactiviteit naast een wielerwedstrijd) nooit.
  const student = titelVan(f, { auto: fiche({ zekerheid: "waarschijnlijk", soort: "een studentenactiviteit" }) });
  assert.equal(isDubbel(f, student, k({ titel: "Wielerkoers Proefprijs" }), "2026-10-18"), false);

  // Samen met de kalender: één item met twee bronnen (lib/merge-events.mjs), de kalender vooraan.
  const kalender = [{ id: "district-kal-proef-2026-10-18", externalId: "proef", title: "Proefcriterium", theme: "Sport", className: "sport", date: "2026-10-18", endDate: null, timeSlot: "11:00", timeText: "11 tot 18 uur", location: "Proefcafé, Voorbeeldlaan", postcodes: ["2050"], info: "", kind: "activity", sourceUrl: "https://www.antwerpen.be/info/proef/kalender", retrievedAt: RETRIEVED, reviewRequired: false }];
  const { items } = bouw({ feiten: [f], kalender });
  assert.deepEqual(items[0].sameAs, ["district-kal-proef-2026-10-18"]);
  const merged = mergeEvents({ "district-asign-evenementen": { scope: "district", items }, "district-kalender": { scope: "district", items: kalender } }).items;
  assert.equal(merged.length, 1, "één item, ook met een andere postcodelijst");
  assert.equal(merged[0].title, "Proefcriterium");
  assert.deepEqual(merged[0].sources.map((s) => s.sourceId), ["district-kalender", "district-asign-evenementen"]);
  assert.deepEqual(merged[0].straten, ["Proefstraat", "Voorbeeldlaan"], "de straten van het dossier gaan mee");
  assert.equal("sameAs" in merged[0], false, "sameAs gaat niet naar de site");
});

test("privacyscan op de uitvoer: geen omschrijving, beheerder, aanvrager, huisnummer of organisator zonder rechtsvorm", () => {
  // Een dossier zoals de verversing het verrijkt, met verzonnen vrije tekst vol privégegevens.
  const index = buildStreetIndex([
    { properties: { DISTRICT: "ANTWERPEN", LSTRNMID: 1, LSTRNM: "Proefstraat", RSTRNMID: 1, RSTRNM: "Proefstraat", postcode: 2000 }, geometry: { type: "LineString", coordinates: [[4.4, 51.2], [4.406, 51.2]] } },
    { properties: { DISTRICT: "ANTWERPEN", LSTRNMID: 2, LSTRNM: "Voorbeeldlaan", RSTRNMID: 2, RSTRNM: "Voorbeeldlaan", postcode: 2000 }, geometry: { type: "LineString", coordinates: [[4.406, 51.2], [4.406, 51.204]] } },
    { properties: { DISTRICT: "ANTWERPEN", LSTRNMID: 3, LSTRNM: "Proeftunnel", RSTRNMID: 3, RSTRNM: "Proeftunnel", postcode: 2000 }, geometry: { type: "LineString", coordinates: [[4.4, 51.1995], [4.406, 51.1995]] } },
  ]);
  const dossier = {
    dossier: "ET2099000060", status: GOED, binnenDistrict: true, dossierBeheerder: "Piet Proefpersoon", aanvrager: "Jan Voorbeeld",
    fasen: [{ naam: "Evenement", start: "2026-10-18", eind: "2026-10-18" }], dagen: ["2026-10-18"],
    innames: [{ type: "Parcours", beschrijving: "Doop bij Jan Voorbeeld, Proefstraat 12, bel 0470 12 34 56", fase: "Evenement", start: "2026-10-18", eind: "2026-10-18", geometry: { paths: [[[4.4, 51.2], [4.406, 51.2], [4.406, 51.204]]] } }],
    beschrijvingen: ["Doop bij Jan Voorbeeld, Proefstraat 12, bel 0470 12 34 56"],
    beginStraat: "Proeftunnel", eindStraat: "Voorbeeldlaan", kernStraten: ["Proeftunnel", "Voorbeeldlaan"], wijk: "Proefwijk", postcodes: ["2000", "2100"],
    vorm: { index: null, kern: [] },
  };
  const f = dossierFeiten(dossier, { index });
  assert.deepEqual(f.langs, ["Proefstraat", "Voorbeeldlaan"], "de straten uit stratenVanParcours()");
  assert.equal(f.beginStraat, "", "een tunnel is nooit de straat van een evenement");
  assert.deepEqual(f.postcodes, ["2000"], "alleen postcodes van het district");
  const hand = { dossiers: { ET2099000060: fiche({ zekerheid: "waarschijnlijk", soort: "een studentendoop bij Proefstraat 12", organisator: "Jan Voorbeeld" }) } };
  const { document } = asignEvenementenDocument({ feiten: [f], hand, vandaag: VANDAAG, retrievedAt: RETRIEVED });
  assert.deepEqual(validateSourceDocument(document, { expectedSourceId: ASIGN_EVENEMENTEN_SOURCE_ID }), []);
  assert.equal(document.items.length, 1);
  const tekst = JSON.stringify(document);
  for (const verboden of ["Jan Voorbeeld", "Piet Proefpersoon", "0470", "Doop bij", "Proefstraat 12", "dossierBeheerder", "aanvrager", "Proeftunnel"]) assert.equal(tekst.includes(verboden), false, `${verboden} lekt`);
  assert.deepEqual(privacyFindings(document), []);
  for (const item of document.items) for (const veld of [item.title, item.location, item.info, item.timeText]) assert.equal(naamMetHuisnummer(veld), false, `huisnummer in ${veld}`);
  // Een organisator met een rechtsvorm mag wel.
  const metVzw = asignEvenementenDocument({ feiten: [f], hand: { dossiers: { ET2099000060: fiche({ zekerheid: "zeker", naam: "Proefdoop", organisator: "Proefclub vzw" }) } }, vandaag: VANDAAG, retrievedAt: RETRIEVED }).document;
  assert.match(metVzw.items[0].info, /Organisatie: Proefclub vzw\./);
});

test("schrijfAsignEvenementen schrijft een geldig brondocument en laat bij een fout het vorige staan", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "asign-ev-"));
  try {
    const dir = path.join(root, "site", "sources");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "district-kalender.json"), JSON.stringify({ items: [{ id: "district-kal-proef-2026-10-18", title: "Proefcriterium", date: "2026-10-18", endDate: null, location: "Voorbeeldlaan", theme: "Sport" }] }));
    const dossiers = [{
      dossier: "ET2099000070", status: GOED, binnenDistrict: true, fasen: [{ naam: "Evenement", start: "2026-10-18", eind: "2026-10-18" }], dagen: ["2026-10-18"],
      innames: [], beschrijvingen: [], beginStraat: "Voorbeeldlaan", eindStraat: "", kernStraten: ["Voorbeeldlaan"], wijk: "", postcodes: [], vorm: null,
    }];
    const log = [];
    const auto = { dossiers: { ET2099000070: fiche({ zekerheid: "waarschijnlijk", soort: "een wielerwedstrijd", methode: "regels" }) } };
    const index = buildStreetIndex([{ properties: { DISTRICT: "ANTWERPEN", LSTRNMID: 2, LSTRNM: "Voorbeeldlaan", RSTRNMID: 2, RSTRNM: "Voorbeeldlaan", postcode: 2000 }, geometry: { type: "LineString", coordinates: [[4.406, 51.2], [4.406, 51.204]] } }]);
    const doc = schrijfAsignEvenementen({ rootDir: root, dossiers, index, auto, vandaag: VANDAAG, generatedAt: RETRIEVED, log: (r) => log.push(r) });
    assert.ok(doc);
    const file = path.join(dir, "district-asign-evenementen.json");
    const geschreven = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepEqual(validateSourceDocument(geschreven, { expectedSourceId: ASIGN_EVENEMENTEN_SOURCE_ID }), []);
    assert.deepEqual(titels(geschreven.items), ["Vermoedelijk een wielerwedstrijd in de Voorbeeldlaan"]);
    assert.deepEqual(geschreven.items[0].sameAs, ["district-kal-proef-2026-10-18"]);
    // Een fout (geen geldige dag): het vorige bestand blijft, de log zegt het.
    const voor = fs.readFileSync(file, "utf8");
    assert.equal(schrijfAsignEvenementen({ rootDir: root, dossiers, index, auto, vandaag: "geen dag", generatedAt: RETRIEVED, log: (r) => log.push(r) }), null);
    assert.equal(fs.readFileSync(file, "utf8"), voor);
    assert.match(log.at(-1), /niet bijgewerkt/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("twee dossiers bij hetzelfde evenement worden één agendapunt met de beste titel; zonder evenementfase of met een fase van maanden geen agendapunt", () => {
  const besluit = { id: "1.2.3.4.6", code: "2099_CBS_00002", soort: "evenement", status: "goedkeuring", orgaan: "College van burgemeester en schepenen", zitting: "2026-09-20", gepubliceerd: true, gelezen: true, naam: "Proefmarathon 2026", organisator: null, dagen: ["2026-10-18"], uren: null, plaats: "Proefkaai", straten: ["Proefkaai"], postcodes: ["2000"], inDistrict: true, opbouw: "2026-10-12", afbouw: "2026-10-21", wijziging: null, vervangt: [], bron: "https://ebesluit.antwerpen.be/zittingen/1.2/agendapunten/1.2.3.4.6" };
  const fasen = [{ naam: "Opbouw", start: "2026-10-12", eind: "2026-10-18" }, { naam: "Evenement", start: "2026-10-18", eind: "2026-10-18" }, { naam: "Afbraak", start: "2026-10-18", eind: "2026-10-20" }];
  // Het parcours (met handfiche) loopt over de Proefkaai; een tweede dossier die dag heeft dezelfde opbouw
  // en afbouw maar ligt elders: het besluit past op zijn plaats al bij het parcours, dus niet bij dat tweede.
  const parcours = feit("ET2099000080", { beginStraat: "Proefkaai", kernStraten: ["Proefkaai"], langs: ["Proefkaai", "Voorbeeldlaan"], fasen });
  const zone = feit("ET2099000081", { beginStraat: "Testplein", kernStraten: ["Testplein"], langs: ["Testplein", "Dummykaai"], fasen });
  const k = koppelBesluiten([parcours, zone], [besluit]);
  assert.deepEqual([...k.keys()], ["ET2099000080"]);
  // Een derde dossier met hetzelfde besluit op zijn plaats: samen met het parcours één agendapunt, met
  // de naam uit de handfiche (die wint van het besluit).
  const derde = feit("ET2099000082", { beginStraat: "Proefkaai", kernStraten: ["Proefkaai"], langs: ["Proefkaai", "Schetsstraat"], fasen });
  const hand = { dossiers: { ET2099000082: fiche({ zekerheid: "zeker", naam: "Proefmarathon van de Stad" }) } };
  const { items, tellers } = bouw({ feiten: [parcours, derde], hand, besluiten: [besluit] });
  assert.deepEqual(titels(items), ["Proefmarathon van de Stad"]);
  assert.equal(items[0].externalId, "ET2099000082");
  assert.match(items[0].info, /Ook dossier ET2099000080\./);
  assert.deepEqual(items[0].straten, ["Proefkaai", "Schetsstraat", "Voorbeeldlaan"]);
  assert.equal(tellers.samengevoegd, 1);
  // Alleen een opbouwfase (een plaatshouder): geen evenementdagen, geen agendapunt; ook geen naam uit een besluit.
  const alleenOpbouw = feit("ET2099000083", { langs: ["Proefstraat", "Voorbeeldlaan"], fasen: [{ naam: "Opbouw", start: "2026-09-11", eind: "2027-09-11" }], dagen: ["2026-09-11", "2026-10-18"] });
  const lang = feit("ET2099000084", { langs: ["Proefstraat", "Voorbeeldlaan"], fasen: [{ naam: "Evenement", start: "2026-09-01", eind: "2027-08-31" }], dagen: ["2026-10-18"] });
  const geen = bouw({ feiten: [alleenOpbouw, lang], besluiten: [{ ...besluit, straten: ["Proefstraat"], plaats: "Proefstraat" }] });
  assert.deepEqual(geen.items, []);
  assert.equal(geen.tellers.geenEvenementfase, 2);
  assert.equal(koppelBesluiten([alleenOpbouw, lang], [{ ...besluit, straten: ["Proefstraat"], plaats: "Proefstraat" }]).size, 0);
});

test("uren: de handfiche gaat voor op het besluit; zonder handfiche het besluit; anders de automatische fiche", () => {
  const besluit = { uren: { start: "09:00", einde: "17:00" }, dagen: ["2026-10-18"] };
  const hand = fiche({ zekerheid: "zeker", naam: "Proefmarathon", uren: "start om 9 uur, finish sluit om 18 uur" });
  // Geen eenduidige reeks in de handfiche: het beginuur uit het besluit, omdat de fiche dat uur zelf noemt
  // (nakijkronde P2, L4); de tekst blijft die van de fiche.
  assert.deepEqual(urenVan({ hand, besluit, dag: "2026-10-18" }), { timeSlot: "09:00", timeText: "start om 9 uur, finish sluit om 18 uur" });
  const anderUur = fiche({ zekerheid: "zeker", naam: "Proefmarathon", uren: "start om 10 uur, finish sluit om 18 uur" });
  assert.deepEqual(urenVan({ hand: anderUur, besluit, dag: "2026-10-18" }), { timeSlot: "Info", timeText: "start om 10 uur, finish sluit om 18 uur" }, "noemt de fiche een ander uur: geen beginuur");
  const negentien = fiche({ zekerheid: "zeker", naam: "Proefmarathon", uren: "afsluiter om 19 uur" });
  assert.equal(urenVan({ hand: negentien, besluit, dag: "2026-10-18" }).timeSlot, "Info", "19 uur is geen 9 uur");
  assert.deepEqual(urenVan({ besluit, dag: "2026-10-18" }), { timeSlot: "09:00", timeText: "9 tot 17 uur" });
  assert.deepEqual(urenVan({ besluit, dag: "2026-10-19" }), { timeSlot: "Info", timeText: "" }, "niet op een dag buiten het besluit");
  assert.deepEqual(urenVan({ auto: fiche({ zekerheid: "zeker", uren: "14 tot 16 uur" }), dag: "2026-10-18" }), { timeSlot: "14:00", timeText: "14 tot 16 uur" });
  assert.deepEqual(urenVan({ auto: fiche({ zekerheid: "onbekend", uren: "14 tot 16 uur" }), dag: "2026-10-18" }), { timeSlot: "Info", timeText: "" });
});
