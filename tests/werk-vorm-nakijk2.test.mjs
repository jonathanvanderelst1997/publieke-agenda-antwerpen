// Nakijkronde van head fd8946ae (werken: adreskaart of gewone kaart, site/werk-vorm.js), bijgewerkt naar de regel van de
// eigenaar van 26 oktober 2026: het huisnummer staat er altijd; geen nummer alleen uit een maat, een telling, een duur of een
// datum, of na een gemeente buiten de stad. Alle straten, plaatsen, nummers en
// dossiers zijn verzonnen (Proefstraat, Testlaan, Proefdorp); geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";

import * as V from "../site/werk-vorm.js";
import * as KU from "../site/kaart-uitleg.js";
import { publicSpaceEntries, samenWerven, werfDoel, werkEntries, workEntry } from "../site/place-core.js";
import { bouwKaartUitleg, kaartUitlegVoorPubliek } from "../lib/kaart-uitleg-refresh.mjs";

const VANDAAG = "2099-03-10";
const PROEF = { id: "9101", name: "Proefstraat", postcode: "2000" };
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
const TWIJFEL = `Proefstraat (${KU.NUMMER_WEG.twijfel})`;

// ---------- HOOG 1: nog een getal, een maat of een andere plaats naast het nummer ----------
// Regel van de eigenaar (26 oktober 2026): het huisnummer staat er altijd. Een getal na de straat is het nummer; alleen een
// maat, een telling, een duur of een datum ervan is het niet, en een nummer na een gemeente buiten de stad hoort bij een
// andere straat.

test("HOOG 1a: een reeks of opsomming met een maat, een telling of een datum erna: dat deel is geen nummer, de rest wel", () => {
  for (const t of [
    "2000 Antwerpen, Proefstraat 2 - 3 uren", "Proefstraat 1 - 31 december", "Proefstraat 10 - 20 lm", "Proefstraat 2 - 3 kalenderdagen",
    "Proefstraat 12, 14, 16 en 18 oktober", "Proefstraat 3 - 4 - 5 oktober", "Proefstraat 12 - 14 bomen", "Proefstraat 3 - 15 okt",
    "Proefstraat 2 - 3 weekends", "Proefstraat 2 - 3 verdiepingen", "Proefstraat 12 - 14 woningen",
  ]) {
    const a = poort(aansluiting({ title: t }));
    assert.equal(a.huisnummers, "", t);
    assert.equal(a.huisnummerWeg, "twijfel", t);
  }
  for (const [t, n] of [
    ["2000 Antwerpen, Proefstraat 12", "nr. 12"], ["2000 | Antwerpen | Proefstraat | 12", "nr. 12"], ["2018 Antwerpen, Proefstraat 12A", "nr. 12A"],
    ["Proefstraat 12 - klantaansluiting", "nr. 12"], ["Proefstraat 12 bus 3", "nr. 12"], ["Proefstraat 12 tem 14", "nr. 12–14"],
    ["Proefstraat 12, 14 en 16", "nr. 12–16"], ["Proefstraat 12 - hoek Testlaan", "nr. 12"],
    // Een maat of een datum naast het nummer: het nummer blijft.
    ["Proefstraat 12, 14 dagen", "nr. 12"], ["Proefstraat 12, 20 m verder", "nr. 12"], ["Proefstraat 12. 3 containers", "nr. 12"],
    ["Proefstraat 12A - 14 dagen", "nr. 12A"], ["Proefstraat 12 - 14/10", "nr. 12"], ["Proefstraat 12 - 12/03", "nr. 12"], ["Proefstraat 12, 14 bomen", "nr. 12"],
    // Een reeks die niet oploopt: het eerste nummer; een ketting die oploopt: de reeks.
    ["Proefstraat 12-1", "nr. 12"], ["Proefstraat 99 - 1", "nr. 99"], ["Proefstraat 7 - 7B", "nr. 7"], ["Proefstraat 14 → 12", "nr. 14"], ["Proefstraat 3 - 4 - 5", "nr. 3–5"],
    // Nog een getal ergens anders: het nummer na de straat blijft.
    ["Proefstraat 12 - thv 14", "nr. 12"], ["Proefstraat 12 · huisnummer 14", "nr. 12"], ["Proefstraat 12 - tegenover nr 14", "nr. 12"], ["Proefstraat 12 bus 3 - 14", "nr. 12"],
  ]) assert.equal(nr(t), n, t);
  assert.equal(nr("2000 Antwerpen, Proefstraat | 12", { hindrance: hinder([fase("Fase 2"), fase("Proefstraat", "13")]) }), "nr. 12");
});

test("HOOG 1a, alle combinaties: een maat of datum na een reeks valt weg, het nummer ervoor nooit", () => {
  const voor = ["", "2000 Antwerpen, ", "Fase 1 "];
  const scheiding = [" ", " | ", ", "];
  const nummers = ["3", "12A", "105"];
  const reeksen = ["", " - 314", ", 314", " en 314", " tot 314", " tem 314", ", 314, 316", " → 314"];
  const staartMaat = [" bomen", " dagen", " uren", " lm", " woningen", " kalenderdagen", " weekends", " - 3 dagen", ", 20 m"];
  const staartGoed = ["", " - klantaansluiting", " · Fase 2", ". Fase 2", " (Proefmans)", " DN01"]; // verzonnen
  let gezien = 0, reeksenGelezen = 0;
  for (const v of voor) for (const s of scheiding) for (const n of nummers) for (const r of reeksen) for (const st of [...staartMaat, ...staartGoed]) {
    const t = `${v}Proefstraat${s}${n}${r}${st}`;
    const uit = nr(t);
    if (staartMaat.includes(st)) {
      // Een maat erna: het getal van de maat is nooit een nummer; wat ervoor staat, mag (of niets, als de maat de reeks is).
      assert.ok(uit === "" || new RegExp(`^nr\\. (?:${n}|${Number.parseInt(n, 10)}–31[46])$`).test(uit), `${t} -> ${uit}`);
      if (!r && !/^ - |^, /.test(st) && /^\d+$/.test(n)) assert.equal(uit, "", `${t}: het getal zelf is de maat`);
    } else {
      // Geen maat: altijd het nummer, en een reeks heel.
      // Een reeks toont de getallen ("nr. 12–314"), zoals huisnummerBereik.
      assert.match(uit, new RegExp(r ? `^nr\\. ${Number.parseInt(n, 10)}–31[46]$` : `^nr\\. ${n}$`), `${t} -> ${uit}`);
      if (r) reeksenGelezen += 1;
    }
    gezien += 1;
  }
  assert.ok(gezien > 1000, `${gezien} schrijfwijzen`);
  assert.ok(reeksenGelezen > 50, `${reeksenGelezen} reeksen gelezen`);
});

test("HOOG 1b: een tweede huisnummer zonder straatnaam in een fase: het nummer na de straat blijft", () => {
  for (const d of ["aansluiting thv nr 14", "nr 14", "huisnummer 14", "thv 14", "t.h.v. nr. 14", "aansluiting nr 14 en 16", "Aansluiting 14"]) {
    const a = poort(aansluiting({ title: "2000 Antwerpen, Proefstraat | 12", hindrance: hinder([fase(d)]) }));
    assert.equal(a.huisnummers, "nr. 12", d);
    assert.equal(regels(KU.werkKaartje(a, { vandaag: VANDAAG })).Waar, `Proefstraat, nr. 12 (${KU.ADRES_GIPOD})`, d);
  }
});

test("HOOG 1c: een postcode buiten de stad vlak voor de straat: geen nummer (de gelijknamige straat van een andere gemeente)", () => {
  for (const [t, fasen] of [
    ["Werk in openbaar domein", [fase("2070 Proefdorp, Proefstraat 12")]],
    ["2640 Proefdorp, Proefstraat 12", []],
  ]) {
    const a = poort(aansluiting({ title: t, hindrance: fasen.length ? hinder(fasen) : null }));
    assert.equal(a.huisnummers, "", `${t} ${fasen.map((f) => f.description)}`);
    assert.doesNotMatch(`${a.title} ${regels(KU.werkKaartje(a, { vandaag: VANDAAG })).Waar}`, /\b12\b/);
  }
  // Een postcode elders in de tekst, of een ander district van de stad (een straat op de grens): het nummer blijft.
  for (const [t, fasen] of [
    ["2000 Antwerpen, Proefstraat 12", [fase("2070 | Proefdorp")]],
    ["2000 Antwerpen, Proefstraat 12", [fase("2070 Proefdorp - Testlaan")]],
    ["2140 | Proefdistrict | Proefstraat | 12", []],
  ]) assert.equal(poort(aansluiting({ title: t, hindrance: fasen.length ? hinder(fasen) : null })).huisnummers, "nr. 12", t);
});

test("HOOG 1, de hele keten: de verversing bewaart en toont het nummer, en bij een maat of een datum eerlijk geen", async () => {
  const gevallen = [
    aansluiting({ gipodId: 990011, title: "2000 Antwerpen, Proefstraat 2 - 3 uren" }),
    aansluiting({ gipodId: 990012, title: "2000 Antwerpen, Proefstraat 1 - 31 december" }),
    aansluiting({ gipodId: 990013, title: "2000 Antwerpen, Proefstraat | 12", hindrance: hinder([fase("aansluiting thv nr 14")]) }),
    aansluiting({ gipodId: 990014, title: "2000 Antwerpen, Proefstraat 12, 14, 16 en 18 oktober" }),
    aansluiting({ gipodId: 990015, title: "Werk in openbaar domein", hindrance: hinder([fase("2070 Proefdorp, Proefstraat 12")]) }),
  ];
  const items = V.werkenVoorDeSite(gevallen, null, { magBeslissen: true });
  const { document } = await bouwKaartUitleg({ works: items, fetch: null, clock: () => new Date(`${VANDAAG}T05:00:00Z`) });
  const uitleg = kaartUitlegVoorPubliek(document);
  for (const it of items) {
    assert.equal(it.adresKaart, true);
    const e = workEntry(it, { vandaag: VANDAAG, uitleg });
    const alles = [V.lijstTitel(it), e.title, regels(e.uitleg).Waar, regels(e.uitleg).Wat, uitleg.werken[String(it.gipodId)].huisnummers].join(" · ");
    if (it.gipodId === 990013) {
      assert.equal(regels(e.uitleg).Waar, `Proefstraat, nr. 12 (${KU.ADRES_GIPOD})`);
      assert.equal(V.lijstTitel(it), "Nieuwe aansluiting op het elektriciteitsnet – Proefstraat 12");
      assert.equal(uitleg.werken["990013"].huisnummers, "nr. 12");
      continue;
    }
    assert.doesNotMatch(alles, /nr\.\s*\d|Proefstraat,? \d/, String(it.gipodId));
    assert.equal(regels(e.uitleg).Waar, TWIJFEL, String(it.gipodId));
  }
});

// ---------- HOOG 2: een bewaard nummer en een gewijzigd werk ----------

test("HOOG 2: een bewaard nummer geldt niet meer als GIPOD het werk wijzigde; live toont wat het nu leest", async () => {
  // De verversing van gisteren las "Proefstraat 12" en bewaarde het nummer.
  const gisteren = poort(aansluiting({ title: "2000 Antwerpen, Proefstraat 12", dossier: "GW2099-000901" }), A(), { magBeslissen: true });
  const { document } = await bouwKaartUitleg({ works: [gisteren], fetch: null, clock: () => new Date(`${VANDAAG}T05:00:00Z`) });
  const uitleg = kaartUitlegVoorPubliek(document);
  assert.equal(uitleg.werken["990001"].huisnummers, "nr. 12");
  const toont = (live) => {
    const los = workEntry(live, { vandaag: VANDAAG, uitleg });
    const werf = samenWerven(werkEntries([live], { vandaag: VANDAAG, uitleg }), { vandaag: VANDAAG, uitleg }).find((e) => e.source === "works");
    assert.equal(werf.werf?.dossier, "GW2099-000901");
    return [los, werf].map((e) => `${e.title} | ${regels(e.uitleg).Waar} | ${regels(e.uitleg).Wat}`);
  };
  const NU = "2099-03-05T00:00:00Z";
  // GIPOD wijzigde het adres sinds de verversing (een nieuwe lastModified): live geeft een getal van een andere straat of geen
  // getal. "Waar" zegt waarom zoals live het ziet, nooit het bewaarde nummer.
  for (const [titel, waar] of [
    ["2000 Antwerpen, Korte Proefstraat 21", TWIJFEL], ["2000 Antwerpen, Testlaan | 5", TWIJFEL], ["2000 Antwerpen, Proefstraat", "Proefstraat"],
  ]) {
    const live = poort(aansluiting({ title: titel, dossier: "GW2099-000901", lastModified: NU }), A());
    assert.equal(live.huisnummers, "", titel);
    for (const tekst of toont(live)) {
      assert.doesNotMatch(tekst, /\b12\b/, `${titel}: ${tekst}`);
      assert.doesNotMatch(tekst, /exact adres/, titel);
      assert.equal(tekst.split(" | ")[1], waar, titel);
    }
  }
  // Live leest nu een ander nummer, in een andere of in dezelfde versie: dat nummer, nooit het bewaarde.
  for (const versie of [NU, gisteren.lastModified]) {
    const live = poort(aansluiting({ title: "2000 Antwerpen, Proefstraat | 21 A", dossier: "GW2099-000901", lastModified: versie }), A());
    assert.equal(live.huisnummers, "nr. 21A");
    for (const tekst of toont(live)) { assert.doesNotMatch(tekst, /\b12\b/); assert.match(tekst, new RegExp(`Proefstraat, nr\\. 21A \\(${KU.ADRES_GIPOD}\\)`)); }
  }
  // De browser kent het werk niet in de vaste vorm, en het is een andere versie: hij toont het nummer dat hij nu leest, nooit
  // het bewaarde (regel van de eigenaar van 26 oktober 2026: ook de browser leest het nummer).
  const nieuw = poort(aansluiting({ title: "2000 Antwerpen, Proefstraat 14", dossier: "GW2099-000901", lastModified: NU }), B([]));
  assert.equal(nieuw.huisnummers, "nr. 14");
  for (const tekst of toont(nieuw)) { assert.doesNotMatch(tekst, /\b12\b/); assert.match(tekst, new RegExp(`Proefstraat, nr\\. 14 \\(${KU.ADRES_GIPOD}\\)`)); }
  // Dezelfde versie, en live leest hetzelfde nummer: dat nummer.
  const zelfde = poort(aansluiting({ title: "2000 Antwerpen, Proefstraat 12", dossier: "GW2099-000901" }), B([]));
  assert.equal(zelfde.huisnummers, "nr. 12");
  for (const tekst of toont(zelfde)) assert.match(tekst, new RegExp(`Proefstraat, nr\\. 12 \\(${KU.ADRES_GIPOD}\\)`));
  // Een reeks uit het adressenregister hangt niet aan de tekst: die blijft zoals op main.
  const register = { ...uitleg.werken["990001"], huisnummers: "nr. 10–20", huisnummerBron: "afgeleid uit de werfzone en het adressenregister", bijgewerkt: "" };
  const gewoon = poort(werk({ title: "2000 Antwerpen, Proefstraat", lastModified: NU }));
  assert.equal(gewoon.adresKaart, true);
  const r = workEntry(gewoon, { vandaag: VANDAAG, uitleg: { werken: { 990001: { ...register, soort: "", soortBron: "" } } } });
  assert.equal(regels(r.uitleg).Waar, "Proefstraat, nr. 10–20 (afgeleid uit de werfzone en het adressenregister)");
});

// ---------- MIDDEL: een werf op een adreskaart ----------

test("MIDDEL 3: een adreskaart van een werf zonder soort noemt het dossiernummer van de werfzone, en 'Werf' is niet van GIPOD", () => {
  const a = poort(werk({ title: "2000 Antwerpen, Proefstraat", owner: "Stad Antwerpen - Stadsontwikkeling", ownerGroup: "Stad Antwerpen", occupancyTypes: ["Andere"], dossier: "GW2099-000901" }), B([]), { magBeslissen: true });
  assert.equal(a.adresKaart, true);
  assert.equal(a.soort, "");
  const k = samenWerven(werkEntries([a], { vandaag: VANDAAG }), { vandaag: VANDAAG }).find((e) => e.source === "works");
  assert.equal(k.werf?.dossier, "GW2099-000901");
  const wat = regels(k.uitleg).Wat;
  assert.match(wat, /^Een werf: dit werk staat in GIPOD met het dossiernummer van werfzone GW2099-000901 in A-Sign\. /);
  assert.doesNotMatch(wat, /Werf \(volgens GIPOD\)/);
  assert.ok(wat.endsWith(KU.ADRESKAART_WAT_STRAAT));
});

test("MIDDEL 4: de werfkaart houdt de soort van een adreskaart, ook een soort uit de echte namen van de fasen", () => {
  for (const [naam, soort] of [["plaatsen container", "Container"], ["klantaansluiting gas", "Werken aan de gasleiding"]]) {
    const a = poort(werk({ title: "2000 Antwerpen, Proefstraat 12", occupancyTypes: ["Andere"], dossier: "GW2099-000901", hindrance: hinder([fase(naam)]) }));
    assert.equal(a.soort, soort);
    assert.equal(a.soortBron, "fasen van de hinder in GIPOD");
    assert.deepEqual(a.hindrance.phases.map((p) => p.description), ["Fase 1"]);
    const los = workEntry(a, { vandaag: VANDAAG });
    const k = samenWerven(werkEntries([a], { vandaag: VANDAAG }), { vandaag: VANDAAG }).find((e) => e.source === "works");
    assert.equal(k.werf?.dossier, "GW2099-000901");
    assert.ok(k.title.startsWith(`${soort} in de Proefstraat nr. 12`), k.title);
    assert.equal(k.title, los.title);
    assert.ok(regels(k.uitleg).Wat.startsWith(`${soort} (volgens GIPOD).`));
    assert.equal(k.onbekend, undefined, "geen 'werf zonder doel'");
  }
  // Wat de verversing bewaarde (een werfzone zonder werkkaart op de plek): het waarvoor blijft de soort.
  const bewaard = { adresKaart: true, soort: "Container", soortBron: "fasen van de hinder in GIPOD", omschrijving: "", opdrachtgever: "Fluvius", fasen: [{ naam: "Fase 1", start: "2099-03-12", eind: "2099-03-12", gevolgen: [] }], straten: ["Proefstraat"], huisnummers: "", dossier: "GW2099-000901" };
  assert.deepEqual(werfDoel(bewaard)?.lijst, ["Container"]);
  const sgw = { id: "sgw:GW2099-000901|1", kind: "sgw", kindLabel: "Werfzone", title: "Werfzone", location: "", reference: "GW2099-000901", detail: "Fase 1", status: "vergund", start: "2099-03-12T06:00:00Z", end: "2099-03-12T16:00:00Z", streets: [PROEF], werfzoneStreets: [PROEF], omleidingStreets: [] };
  const uitleg = { werken: { 990001: bewaard } };
  const zone = samenWerven(publicSpaceEntries([sgw], { vandaag: VANDAAG, alle: [sgw], straat: PROEF.name }), { uitleg, straat: PROEF.name, vandaag: VANDAAG, alle: [sgw] })
    .find((e) => e.item?.kind === "sgw");
  assert.match(regels(zone)["Werf volgens GIPOD"] || "", /^Container \(afgeleid uit/);
});
