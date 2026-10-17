// De homoniemtoevoeging van de straatas ("Proefstraat_AN": een straatnaam die ook in een ander district bestaat) is geen
// deel van de naam. De privacyfilter (site/witte-lijst.js) laat de twee letters nooit door (het kunnen initialen zijn, als
// "Proefstraat AN" in een omschrijving) en herkent de straat onder haar naam ("Proefstraat"), ook als de straatas haar
// alleen met toevoeging kent. Wat de bewoner leest (de kruist-regel, de live kaartjes) is zonder toevoeging; de sleutels
// en de koppeling houden haar. De toetsen falen op head fe8eb62 (de filter liet "Proefstraat AN" door en vond "Proefstraat"
// niet, de kruist-regel toonde "_AN") en slagen nu. De laatste twee toetsen falen op 3a770c4 (titel, plaats en info van een
// agendapunt en de titel en "Waar" van een evenementkaartje noemden "Proefstraat_AN") en slagen nu. De laatste twee
// toetsen (de plekpagina; live terrassen, live vergunningen en de vooruitblik) falen op 0117aac en slagen nu. Alleen
// verzonnen straten en namen; geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import * as W from "../site/witte-lijst.js";
import * as KU from "../site/kaart-uitleg.js";
import { bundelLijst, evenementEntry, permitEntry, publicSpaceEntries, publicSpaceEntry, workEntry, zonderHomoniem } from "../site/place-core.js";
import { duidelijkeKaart, waarTekst } from "../site/permit-clarity.js";
import { buildWeekPulse } from "../site/week-pulse.js";
import { asignAgendapunten, locatieVan, tekstUitFeiten, titelVan } from "../lib/asign-evenementen-agenda.mjs";
await import("../site/agenda-ics.js");
const { buildIndividualIcs } = globalThis.AgendaIcs;
import { schoneNaam } from "../scripts/build-straten-stad.mjs";
import { plaatsnaamVan, straatasPredicaat } from "../lib/plaatsnaam.mjs";

const lees = (rel) => JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), "utf8"));
const bron = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");
const CODES = ["AN", "BE", "BO", "DE", "EK", "HO", "WI"];
// Zoals index.byName van de straatas: de sleutel van de naam met toevoeging ("proefstraat an").
const metToevoeging = new Set(["Proefstraat_AN", "Lange Testlei_DE"].map(W.sleutel));
const isStraat = (n) => metToevoeging.has(W.sleutel(n));
const vormen = (s, c) => [`${s} ${c}`, `${s}-${c}`, `${s}_${c}`, `${s}'${c}`, `${s.toUpperCase()} ${c}`];

test("homoniem: de toevoeging komt nooit door de filter, de straat blijft onder haar naam", () => {
  assert.deepEqual([...(W.HOMONIEM_CODES || [])], CODES);
  for (const t of vormen("Proefstraat", "AN")) {
    for (const opties of [{ straten: [{ name: "Proefstraat_AN" }] }, { rond: ["Proefstraat_AN"] }, { rond: () => ["Proefstraat_AN"] }, { isStraat }]) {
      const r = W.witteLijst(t, opties);
      assert.equal(W.sleutel(r.tekst), "proefstraat", `${t} ${JSON.stringify(opties.straten || opties.rond || "isStraat")} → ${r.tekst}`);
      assert.deepEqual(r.plekken.map(W.sleutel), ["proefstraat"]);
    }
  }
  // De gewone naam, ook als de straatas alleen de naam met toevoeging kent.
  assert.equal(W.witteTekst("Proefstraat", { rond: ["Proefstraat_AN"] }), "Proefstraat");
  assert.equal(W.witteTekst("Proefstraat", { straten: [{ name: "Proefstraat_AN" }] }), "Proefstraat");
  assert.equal(W.witteTekst("Proefstraat", { isStraat }), "Proefstraat");
  assert.equal(W.witteTekst("Opbouw in de Lange Testlei DE bij Testpersoon", { isStraat }), "Lange Testlei");
  assert.equal(plaatsnaamVan("Proefstraat AN", { isStraat }), "Proefstraat");
  // Zoals de verversing de straatas meegeeft (index.byName met de sleutel van de naam met toevoeging).
  const verversing = straatasPredicaat({ index: { byName: new Map([["proefstraat an", []]]) } });
  assert.equal(W.witteTekst("Inname Proefstraat AN 12", { isStraat: verversing }), "Proefstraat");
  assert.equal(W.witteTekst("Inname Proefstraat", { isStraat: verversing }), "Proefstraat");
  // Een naam vast aan een straat blijft één woord, en dat is geen straat.
  assert.equal(W.witteTekst("Proefstraat_Testpersoon", { isStraat }), "");
});

test("homoniem: eigenschap: met elke code, scheiding en naam ernaast blijft geen toevoeging of losse code in de uitvoer", () => {
  let zaad = 20261017;
  const r = () => { zaad = (zaad * 1103515245 + 12345) % 2147483648; return zaad / 2147483648; };
  const kies = (lijst) => lijst[Math.floor(r() * lijst.length)];
  const NAMEN = ["Testpersoon", "Van Proefmans", "T. Voorbeeld", "fam. Testers", "Zorvex Quilxan"];
  let metPlek = 0;
  for (let i = 0; i < 3000; i += 1) {
    const code = kies(CODES), straat = kies(["Proefstraat", "Lange Testlei"]);
    const t = kies([
      () => `${kies(vormen(straat, code))}`, () => `${kies(NAMEN)} ${kies(vormen(straat, code))} ${1 + Math.floor(r() * 99)}`,
      () => `${kies(vormen(straat, code))} ${kies(NAMEN)}`, () => `${straat} ${code} ${kies(NAMEN)}`, () => `Opbouw ${straat}_${code}, ${kies(NAMEN)}`,
    ])();
    const straten = [{ name: `${straat}_${code}` }];
    const isStraatHier = (n) => W.sleutel(n) === W.sleutel(`${straat}_${code}`);
    for (const opties of [{ straten }, { rond: straten.map((s) => s.name) }, { isStraat: isStraatHier }, { isStraat }]) {
      const uit = W.witteLijst(t, opties);
      assert.doesNotMatch(uit.tekst, /_|\d/, `${t} → ${uit.tekst}`);
      for (const p of uit.plekken) {
        const woorden = W.sleutel(p).split(" ");
        assert.ok(!(woorden.length > 1 && CODES.includes(woorden.at(-1).toUpperCase())), `${t} → plek ${p} eindigt op een code`);
        assert.ok(["proefstraat", "lange testlei"].includes(W.sleutel(p)), `${t} → ${p}`);
      }
      if (uit.plekken.length) metPlek += 1;
    }
  }
  assert.ok(metPlek > 5000, `${metPlek} uitkomsten met een plek`);
});

test("homoniem: één definitie; de straatas van de repo heeft alleen de gemeten codes en geen naam die op een code eindigt", () => {
  for (const f of [W.zonderToevoeging, zonderHomoniem, schoneNaam]) assert.equal(f("Proefstraat_AN"), "Proefstraat");
  assert.equal(zonderHomoniem, W.zonderToevoeging);
  assert.equal(KU.zonderStraatasToevoeging("Kruist Proefstraat_AN en Lange Testlei_DE"), "Kruist Proefstraat en Lange Testlei");
  const namen = [...lees("../site/geo/straten.json").streets.map((s) => s[1]), ...(lees("../site/geo/straten-stad.json").straten || []).map((s) => (Array.isArray(s) ? s[0] : s?.name ?? s))];
  assert.ok(namen.length > 3000, `${namen.length} namen`);
  const codes = new Set(namen.map((n) => /_([A-Z]{2})$/.exec(String(n))?.[1]).filter(Boolean));
  for (const c of codes) assert.ok(CODES.includes(c), `onbekende code ${c}`);
  const eindigtOpCode = namen.filter((n) => { const w = W.sleutel(W.zonderToevoeging(n)).split(" "); return w.length > 1 && CODES.includes(w.at(-1).toUpperCase()); });
  assert.deepEqual(eindigtOpCode, [], "een straatnaam die op een losse code eindigt, zou wegvallen");
});

test("homoniem: wat de bewoner leest, is zonder toevoeging (kruist-regel, live kaartjes)", () => {
  // De kruist-regel van de plekpagina, zoals place-view.js haar maakt.
  const view = bron("../site/place-view.js");
  const regel = view.split("\n").find((r) => r.includes("const kruistRij ="));
  assert.ok(regel, "de kruist-regel staat in site/place-view.js");
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const maak = new Function("kruist", "esc", "zonderHomoniem", `${regel}\nreturn kruistRij;`);
  for (const kruist of [["Proefstraat_AN"], ["Proefstraat_AN", "Lange Testlei_DE", "Testkaai", "Testvest"]]) {
    const html = maak(kruist, esc, zonderHomoniem);
    assert.match(html, /Proefstraat/);
    assert.doesNotMatch(html, /_[A-Z]{2}\b/, html);
  }
  // De live kaartjes: de straat zonder toevoeging.
  assert.match(bron("../site/public-space-live.js"), /<dt>Straat<\/dt><dd>\$\{esc\(i\.streets\.map\(s=>zonderHomoniem\(s\.name\)\)/);
  const works = bron("../site/works-live.js");
  assert.match(works, /<dt>Straat<\/dt><dd>\$\{esc\(i\.streets\.map\(s=>zonderToevoeging\(s\.name\)\)/);
  assert.match(works, /const waarLos=i=>i\.streets\?\.length\?i\.streets\.map\(s=>zonderToevoeging\(s\.name\)\)/);
});

// Een toevoeging van de straatas in tekst die de bewoner leest.
const TOEVOEGING = /_[A-Z]{2}\b/;

test("homoniem: agenda, eventpagina en .ics noemen de straat zonder toevoeging; de straten voor de koppeling houden haar", () => {
  // Een dossier zoals dossierFeiten() het geeft: de straten komen rechtstreeks uit de straatas, met toevoeging.
  const feit = (dossier, velden = {}) => ({
    dossier, status: "aanvraag_goedgekeurd", binnenDistrict: true, fasen: [{ naam: "Evenement", start: "2026-10-18", eind: "2026-10-18" }], dagen: ["2026-10-18"],
    langs: [], zone: [], kernStraten: ["Proefstraat_AN"], beginStraat: "Proefstraat_AN", wijk: "", postcodes: ["2000"], speelstraat: false, vorm: null, ...velden,
  });
  const fiche = (velden = {}) => ({ zekerheid: "onbekend", naam: "", soort: "", organisator: "", uren: "", link: "", methode: "kaart", dagen: [], binnenDistrict: true, ...velden });
  const feiten = [
    feit("ET2099000101", { langs: ["Proefstraat_AN", "Voorbeeldlaan"] }),
    feit("ET2099000102", { langs: ["Proefstraat_AN"] }),
    feit("ET2099000103", { zone: ["Proefstraat_AN", "Lange Testlei_DE"], kernStraten: ["Lange Testlei_DE"], beginStraat: "" }),
  ];
  const auto = { dossiers: {
    ET2099000102: fiche({ zekerheid: "zeker", naam: "Proefloop Noord", methode: "kalender" }),
    ET2099000103: fiche({ zekerheid: "waarschijnlijk", soort: "een studentenactiviteit", methode: "regels" }),
  } };
  const { items } = asignAgendapunten({ feiten, auto, vandaag: "2026-10-10", retrievedAt: "2026-10-10T05:20:00.000Z" });
  const per = Object.fromEntries(items.map((i) => [i.externalId, i]));
  assert.deepEqual(Object.keys(per).sort(), ["ET2099000101", "ET2099000102", "ET2099000103"]);
  assert.equal(per.ET2099000101.title, "Evenement in de Proefstraat: parcours door 2 straten");
  assert.equal(per.ET2099000101.location, "Proefstraat en Voorbeeldlaan");
  assert.match(per.ET2099000101.info, /^Parcours door 2 straten: Proefstraat en Voorbeeldlaan\./);
  assert.equal(per.ET2099000102.location, "Proefstraat");
  assert.match(per.ET2099000102.info, /^Parcours in de Proefstraat\./);
  assert.equal(per.ET2099000103.title, "Vermoedelijk een studentenactiviteit in de Proefstraat");
  assert.equal(per.ET2099000103.location, "Proefstraat en Lange Testlei");
  assert.match(per.ET2099000103.info, /^Verkeersvrije zone in 2 straten: Proefstraat en Lange Testlei\./);
  for (const i of items) {
    // De eventpagina (scripts/build-agenda.mjs) en de .ics tonen title, location en info; de build maakt titel en info
    // opnieuw uit de bewaarde feiten (tekstUitFeiten).
    // De .ics zoals de knop op de site hem maakt (site/agenda-ics.js), met de gevouwen regels weer aan elkaar.
    const ics = buildIndividualIcs({ ...i, link: i.sourceUrl }, { now: "2026-10-10T05:20:00.000Z" }).replace(/\r\n[ \t]/g, "");
    const getoond = { title: i.title, location: i.location, info: i.info, ...Object.fromEntries(Object.entries(tekstUitFeiten(i, { auto })).map(([k, v]) => [`build ${k}`, v])), ics };
    for (const [veld, tekst] of Object.entries(getoond)) assert.doesNotMatch(tekst, TOEVOEGING, `${i.externalId} ${veld}: ${tekst}`);
    assert.match(ics, /Proefstraat/);
    // De straten voor de koppeling met de plekpagina en de straatbestanden: de naam zoals de straatas hem kent.
    assert.ok(i.straten.includes("Proefstraat_AN"), i.straten.join(", "));
  }
  // Rechtstreeks: één straat, en de plaats van een dossier met straten uit de straatas.
  assert.equal(titelVan(feit("ET2099000104", { langs: ["Proefstraat_AN"] })).titel, "Evenement in de Proefstraat: parcours");
  assert.equal(locatieVan(feit("ET2099000105", { langs: ["Proefstraat_AN", "Lange Testlei_DE"] })), "Proefstraat en Lange Testlei");
  assert.equal(KU.opStraat("Proefstraat_AN"), "in de Proefstraat");
  assert.equal(KU.opStraat("Lange Testlei_DE"), "in de Lange Testlei");
});

test("homoniem: het evenementkaartje van de plekpagina noemt de straat zonder toevoeging; de koppeling blijft", () => {
  let n = 0;
  const rij = (straten) => ({
    id: `iod:ET2099000201|Evenement|${(n += 1)}`, kind: "iod", title: "Inname", innameType: "Inname", reference: "ET2099000201", dossierType: "ETL",
    phase: "Evenement", hindrance: "True", description: "", start: "2026-10-18", end: "2026-10-18", status: "aanvraag_goedgekeurd",
    streets: straten.map((name, i) => ({ id: `${n}${i}`, name, postcode: "2000" })), sourceUrl: "https://geodata.antwerpen.be/x",
  });
  for (const [straten, titel, waar] of [
    [["Proefstraat_AN"], "Inname in de Proefstraat", /^In de Proefstraat \(Proefstraat, /],
    [["Proefstraat_AN", "Voorbeeldlaan"], "Inname in de Proefstraat en omgeving", /^In de Proefstraat en omgeving \(Proefstraat, Voorbeeldlaan, /],
  ]) {
    const e = evenementEntry([rij(straten)], { vandaag: "2026-10-10", wijkVan: () => "", straat: "Proefstraat_AN" });
    assert.equal(e.title, titel);
    const kern = Object.fromEntries(e.uitleg.kern);
    assert.match(kern.Waar, waar);
    const getoond = { title: e.title, summary: e.summary, location: e.location, jouwStraat: e.jouwStraat, kern: JSON.stringify(e.uitleg.kern), regels: JSON.stringify(e.uitleg.regels), voetnoot: e.uitleg.voetnoot };
    for (const [veld, tekst] of Object.entries(getoond)) assert.doesNotMatch(tekst, TOEVOEGING, `${veld}: ${tekst}`);
    // De sleutels en de straten voor de koppeling houden de naam van de straatas.
    assert.ok(e.straten.includes("Proefstraat_AN"), e.straten.join(", "));
  }
  // Een agendapunt op dezelfde dag in de Proefstraat (zonder toevoeging, zoals de agenda haar nu noemt) koppelt nog.
  const agenda = [{ id: "proef-agendapunt-1", title: "Proefbuurtfeest", date: "2026-10-18", location: "Proefstraat", sourceId: "district-kalender", theme: "Activiteit" }];
  const e = evenementEntry([rij(["Proefstraat_AN"])], { vandaag: "2026-10-10", wijkVan: () => "", agendaItems: agenda });
  assert.equal(e.title, "Vermoedelijk: Proefbuurtfeest");
});

// ---------- de plekpagina: "Waar" en de lijstregel (nakijkronde van head 0117aac) ----------
// Een GIPOD-werk, een gewone inname, een terras zonder adres en een bundel op de straatpagina noemden de straat met
// toevoeging: workEntry gaf "Werken in de Proefstraat" als titel, maar "Proefstraat_AN" als plaats, plek en "Waar"
// (werkKaartje), publicSpaceEntry en permitEntry gaven "Proefstraat_AN" als plaats (streetNames), en de bundel kreeg de
// naam van de gekozen straat zoals de straatas haar kent (bundelKaart). place-view.js toont location ongefilterd bij
// "Waar" en in de lijstregel (pv-row-where). Deze toets faalt op 0117aac.
const getoondVan = (e) => ({ title: e.title, summary: e.summary, location: e.location, info: e.info, plek: e.uitleg?.plek, regels: JSON.stringify(e.uitleg?.regels || []) });
const zonderToevoegingGetoond = (e, wat) => {
  for (const [veld, tekst] of Object.entries(getoondVan(e))) assert.doesNotMatch(String(tekst ?? ""), TOEVOEGING, `${wat} ${veld}: ${tekst}`);
};

test("homoniem: de plekpagina noemt de straat zonder toevoeging bij \"Waar\" en in de lijstregel (werk, inname, terras, bundel)", () => {
  const vandaag = "2026-10-17";
  const werk = (extra) => ({ gipodId: 2099001, title: "Werk", status: "In uitvoering", start: "2026-10-17", end: "2026-10-20", ...extra });
  // Een werk in één straat en in twee straten.
  const een = workEntry(werk({ streets: [{ name: "Proefstraat_AN" }] }), { vandaag });
  assert.match(een.title, /^Werken in de Proefstraat /);
  assert.equal(een.location, "Proefstraat");
  assert.equal(een.uitleg.plek, "Proefstraat");
  assert.equal(Object.fromEntries(een.uitleg.regels).Waar, "Proefstraat");
  const twee = workEntry(werk({ streets: [{ name: "Proefstraat_AN" }, { name: "Lange Testlei_DE" }] }), { vandaag });
  assert.equal(Object.fromEntries(twee.uitleg.regels).Waar, "Proefstraat, Lange Testlei");
  // Met een reeks huisnummers (van de verversing).
  const metNummers = werk({ streets: [{ name: "Proefstraat_AN" }] });
  const k = KU.werkKaartje(metNummers, { vandaag, feiten: KU.werkFeiten(metNummers, { huisnummers: "nr. 12–40", huisnummerBron: "afgeleid uit de werfzone en het adressenregister" }) });
  assert.equal(k.plek, "Proefstraat nr. 12–40");
  assert.match(Object.fromEntries(k.regels).Waar, /^Proefstraat, nr\. 12–40 /);
  // Geen straat op het punt: de dichtste straat, het kruispunt, of tussen twee straten.
  const nabij = (extra) => workEntry(werk({ streets: [], ...extra }), { vandaag });
  const dichtste = nabij({ streetNearby: [{ name: "Proefstraat_AN", distanceMeters: 20 }] });
  assert.equal(dichtste.location, "Proefstraat");
  assert.match(Object.fromEntries(dichtste.uitleg.regels).Waar, /^Nabij Proefstraat \(ongeveer 20 m/);
  const buren = [{ name: "Proefstraat_AN", distanceMeters: 20 }, { name: "Lange Testlei_DE", distanceMeters: 30 }];
  const kruispunt = nabij({ streetNearby: buren, streetResolution: "ambiguous", streetsMeet: true });
  assert.equal(kruispunt.location, "Proefstraat en Lange Testlei");
  assert.match(kruispunt.title, /bij het kruispunt van Proefstraat en Lange Testlei/);
  const tussen = nabij({ streetNearby: buren, streetResolution: "ambiguous", streetsMeet: false });
  assert.match(Object.fromEntries(tussen.uitleg.regels).Waar, /^Tussen Proefstraat \(ongeveer 20 m\) en Lange Testlei \(ongeveer 30 m\)/);
  const ver = nabij({ streetNearby: [{ name: "Proefstraat_AN", distanceMeters: 80 }] });
  assert.match(Object.fromEntries(ver.uitleg.regels).Waar, /de dichtste straat is Proefstraat \(ongeveer 80 m\)/);
  for (const [wat, e] of Object.entries({ een, twee, dichtste, kruispunt, tussen, ver })) zonderToevoegingGetoond(e, `werk ${wat}`);
  zonderToevoegingGetoond({ uitleg: k, title: k.titel, summary: k.samenvatting }, "werk met nummers");
  // Een gewone inname en een parkeerverbod zonder plaats in de bron: de straten.
  const inname = { id: "iod:IOD2099|Opbouw|1", kind: "iod", title: "Container", dossierType: "", reference: "IOD2099", phase: "Opbouw", streets: [{ name: "Proefstraat_AN" }, { name: "Proefstraat" }], start: "2026-10-17", end: "2026-10-18", status: "toelating_gegenereerd" };
  assert.equal(publicSpaceEntry(inname).location, "Proefstraat");
  for (const e of publicSpaceEntries([inname], { vandaag })) zonderToevoegingGetoond(e, "inname");
  zonderToevoegingGetoond(publicSpaceEntry({ id: "parking:1", kind: "parking", title: "Parkeerverbod", streets: [{ name: "Lange Testlei_DE" }], start: "2026-10-17", end: "2026-10-17" }), "parkeerverbod");
  // Een terras zonder adres, een aanvraag in een straat met toevoeging.
  const terras = (i, straat = "Proefstraat_AN") => permitEntry({ id: `terrace:${i}`, terraceType: "Terras binnen kern", status: "Vergund", streets: [{ name: straat }], address: "" }, "terraces");
  assert.equal(terras(1).location, "Proefstraat");
  const aanvraag = (i) => permitEntry({ id: `permit:${i}`, streets: [{ name: "Proefstraat_AN" }, { name: "Voorbeeldlaan" }] });
  assert.equal(aanvraag(1).location, "Proefstraat · ook dicht bij Voorbeeldlaan");
  // De bundels: op de straatpagina van de straat (de naam zoals de straatas haar kent), en in een wijk (de eerste straat
  // van de kaart). De sleutel blijft die van de straatas.
  for (const straat of ["Proefstraat_AN", ""]) {
    const { bundels } = bundelLijst([terras(1), terras(2), terras(3), aanvraag(4), aanvraag(5)], { straat, vandaag });
    assert.deepEqual(bundels.map((b) => b.bundel.soort).sort(), ["aanvragen", "terrassen"]);
    for (const b of bundels) {
      assert.equal(b.location, "Proefstraat", `${straat || "wijk"} ${b.bundel.soort}`);
      assert.match(b.uid, /:proefstraat-an$/);
      zonderToevoegingGetoond(b, `bundel ${b.bundel.soort}`);
      for (const lid of b.bundel.leden) zonderToevoegingGetoond(lid, `lid van ${b.bundel.soort}`);
    }
  }
  // De straten van een item blijven die van de straatas (de koppeling met de straatbestanden).
  assert.equal(een.item.streets[0].name, "Proefstraat_AN");
});

// ---------- live terrassen, live vergunningen en de vooruitblik (nakijkronde van head 0117aac) ----------
// Het terraskaartje (terraces-live.js) toonde "Straat: Proefstraat_AN", de vergunningkaart (permits-live.js, via
// duidelijkeKaart en waarTekst in permit-clarity.js) "Proefstraat_AN · ook dicht bij ..." en de vooruitblik op de
// voorpagina (week-pulse.js) "Proefstraat_AN". Deze toets faalt op 0117aac.
test("homoniem: live terrassen, live vergunningen en de vooruitblik noemen de straat zonder toevoeging", () => {
  // Het terraskaartje, zoals terraces-live.js het maakt.
  const regel = bron("../site/terraces-live.js").split("\n").find((r) => /^\s*function card\(item\)/.test(r));
  assert.ok(regel, "het terraskaartje staat in site/terraces-live.js");
  const esc = (t = "") => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const card = new Function("esc", "terrasTitel", "zonderHomoniem", `${regel}\nreturn card;`)(esc, () => "Terras met vergunning", zonderHomoniem);
  const html = card({ terraceType: "Terras binnen kern", status: "Vergund", address: "", streets: [{ name: "Proefstraat_AN" }, { name: "Lange Testlei_DE" }], recordId: "terrace:1", sourceUrl: "https://geodata.antwerpen.be/x" });
  assert.match(html, /<dt>Straat<\/dt><dd>Proefstraat · Lange Testlei<\/dd>/);
  assert.doesNotMatch(html, TOEVOEGING, html);

  // De vergunningkaart (live en op de plekpagina): de korte regel en de volledige lijst; de gekozen straat (zoals de
  // straatas haar kent) staat nog altijd vooraan bij "ook dicht bij".
  const vier = { streets: [{ name: "Proefstraat_AN" }, { name: "Voorbeeldlaan" }, { name: "Testkaai" }, { name: "Testvest" }] };
  const d = duidelijkeKaart({ source: "permits" }, vier, { vandaag: "2026-10-17" });
  assert.equal(d.waar.kort, "Proefstraat · ook dicht bij Voorbeeldlaan, Testkaai en Testvest");
  assert.deepEqual(d.waar.straten, ["Proefstraat", "Voorbeeldlaan", "Testkaai", "Testvest"]);
  const gekozen = duidelijkeKaart({ source: "permits" }, { streets: [{ name: "Voorbeeldlaan" }, { name: "Testkaai" }, { name: "Lange Testlei_DE" }, { name: "Testvest" }] }, { straat: "Lange Testlei_DE", vandaag: "2026-10-17" });
  assert.equal(gekozen.waar.kort, "Voorbeeldlaan · ook dicht bij Lange Testlei, Testkaai en Testvest");
  assert.deepEqual(waarTekst(["Proefstraat_AN", "Proefstraat"]), { kort: "Proefstraat", straten: ["Proefstraat"], ingeklapt: false });
  for (const [veld, tekst] of Object.entries({ kort: d.waar.kort, straten: d.waar.straten.join(", "), gekozen: gekozen.waar.kort })) assert.doesNotMatch(tekst, TOEVOEGING, `${veld}: ${tekst}`);

  // De vooruitblik op de voorpagina: een werk en een maatregel die starten.
  const pulse = buildWeekPulse({
    agendaItems: [], fromDay: "2026-10-17", toDay: "2026-10-23",
    works: [{ gipodId: 2099002, title: "Werk", start: "2026-10-18", end: "2026-10-19", streets: [{ name: "Proefstraat_AN" }, { name: "Voorbeeldlaan" }] }],
    publicSpace: [{ id: "iod:IOD2099|Opbouw|2", kind: "iod", title: "Inname", start: "2026-10-18", end: "2026-10-18", streets: [{ name: "Lange Testlei_DE" }] }],
  });
  assert.deepEqual(pulse.upcoming.map((u) => u.location).sort(), ["Lange Testlei", "Proefstraat · Voorbeeldlaan"]);
});
