// Werken: adreskaart of gewone kaart (site/werk-vorm.js, besluit van de eigenaar van 18 oktober 2026). Alle straten, nummers,
// namen en bedrijven zijn verzonnen (Proefstraat, Testlaan); geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as V from "../site/werk-vorm.js";
import * as KU from "../site/kaart-uitleg.js";
import { workEntry } from "../site/place-core.js";
import { werkZoektekst, werkenInKader } from "../site/works-live.js";
import { itemVoorHistoriek } from "../lib/historiek-privacy.mjs";
import { compactWorkItem } from "../lib/live-history.mjs";
import { bouwKaartUitleg, kaartUitlegVoorPubliek, schoonWerk } from "../lib/kaart-uitleg-refresh.mjs";
import { kaartUitlegWerkFouten, werkVormProblemen } from "../lib/werk-vorm-validatie.mjs";
import { itemVoorStraat } from "../scripts/build-straat-snapshots.mjs";
import { opkuisVerhuis, werkZonderVerhuis } from "../scripts/opkuis-verhuis.mjs";
import { refreshLiveHistory } from "../scripts/refresh-live-history.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VANDAAG = "2099-03-10";
const PROEF = { id: "9101", name: "Proefstraat", postcode: "2000" };
const TEST = { id: "9102", name: "Testlaan", postcode: "2000" };
const fase = (description, dag = "12") => ({ description, start: `2099-03-${dag}T06:00:00Z`, end: `2099-03-${dag}T16:00:00Z`, consequences: ["Parkeerverbod"] });
const hinder = (fasen) => ({ severe: false, consequences: ["Parkeerverbod"], start: "2099-03-12T06:00:00Z", end: "2099-03-20T16:00:00Z", phases: fasen });
// Een werk zoals collectWorks, attachHindrance en de straatkoppeling het geven (verzonnen).
const werk = (extra = {}) => ({
  gipodId: 990001, title: "Werk in openbaar domein", owner: "Fluvius System Operator", ownerGroup: "Fluvius", status: "In uitvoering",
  start: "2099-03-01T06:00:00Z", end: "2099-03-30T16:00:00Z", workTypes: [], occupancyTypes: [], lastModified: "2099-02-01T00:00:00Z",
  point: [4.4, 51.22], recordCount: 1, boundaryConfidence: "point_inside_new", hindrance: null, hindranceSourceLoaded: true,
  streets: [PROEF], streetResolution: "nearest_official_axis", streetDistanceMeters: 3, ...extra,
});
const aansluiting = (extra = {}) => werk({ occupancyTypes: ["Elektriciteit"], workTypes: ["klantaansluiting"], ...extra });
const A = (ids = []) => ({ schema: 1, adreskaart: ids, gewoon: [] });
const B = (ids = []) => ({ schema: 1, adreskaart: [], gewoon: ids });
const poort = (item, vorm = null, opties = {}) => V.werkenVoorDeSite([item], vorm, opties)[0];
const kaart = (item) => KU.werkKaartje(item, { vandaag: VANDAAG });
const kaartTekst = (k) => [k.titel, k.samenvatting, k.bronTekst || "", ...k.regels.flat()].join(" · ");
const teksten = (waarde, uit = []) => {
  if (typeof waarde === "string") uit.push(waarde);
  else if (Array.isArray(waarde)) for (const v of waarde) teksten(v, uit);
  else if (waarde && typeof waarde === "object") for (const v of Object.values(waarde)) teksten(v, uit);
  return uit;
};

// ---------- regel 14 ----------

test("regel 14: een aansluiting of container wordt een adreskaart, een lift of levering nooit", () => {
  assert.equal(V.isAdreskaart(aansluiting({ title: "2000 Antwerpen, Proefstraat 12 - klantaansluiting bij Proefmans" })), true); // verzonnen
  assert.equal(V.isAdreskaart(werk({ occupancyTypes: ["Container"], owner: "Proefmans", ownerGroup: "Andere" })), true); // verzonnen
  const lift = V.zonderVerhuisSpoor(werk({ occupancyTypes: ["(Verhuis)lift/levering"], title: "2000 Antwerpen, Proefstraat 12" }));
  assert.deepEqual(lift.occupancyTypes, ["Lift/levering"]);
  assert.equal(V.isAdreskaart(lift), false);
  assert.equal(V.isAdreskaart(V.zonderVerhuisSpoor(werk({ occupancyTypes: ["Container;(Ver­huis)lift/levering"] }))), false);
});

test("regel 14 (b): een groep, geen tekst die iets zegt en alleen fasen zonder naam", () => {
  const b = (extra) => V.isAdreskaart(werk({ title: "2000 Antwerpen, Proefstraat 12", ...extra }));
  assert.equal(b({}), true);
  assert.equal(b({ hindrance: hinder([fase("Fase 1"), fase("deel 2", "13"), fase("werken", "14"), fase("", "15")]) }), true);
  assert.equal(b({ owner: "Proefbedrijf", ownerGroup: "Andere" }), false, "geen groep");
  assert.equal(b({ owner: "", ownerGroup: "Onbekend" }), false, "geen opdrachtgever");
  assert.equal(b({ title: "2000 Antwerpen, Proefstraat 12 - herstelling voetpad" }), false, "tekst van de beheerder");
  assert.equal(b({ hindrance: hinder([fase("Plaatsen kraan")]) }), false, "een fase met een naam");
});

// ---------- de vaste vorm ----------

test("de vaste vorm: een id komt erbij en verandert nooit van lijst", () => {
  const items = V.werkenVoorDeSite([aansluiting({ gipodId: 990002 }), werk({ gipodId: 990003, title: "Proefstraat 12 - herstelling voetpad" })], A([990001]), { magBeslissen: true });
  assert.deepEqual(V.vormNaVerversing(A([990001]), items), { schema: 1, adreskaart: [990001, 990002], gewoon: [990003] });
  // Een id dat al in een lijst staat, blijft daar, ook als het werk er nu anders uitziet.
  assert.deepEqual(V.vormNaVerversing(B([990002]), [{ gipodId: 990002, adresKaart: true }]), { schema: 1, adreskaart: [], gewoon: [990002] });
  assert.deepEqual(V.werkVormFouten({ schema: 1, adreskaart: [2, 1], gewoon: [] }), ["adreskaart: niet gesorteerd of niet uniek"]);
  assert.deepEqual(V.werkVormFouten({ schema: 1, adreskaart: [1], gewoon: [1] }), ["een id staat in beide lijsten"]);
  assert.deepEqual(V.werkVormFouten({ schema: 1, adreskaart: [1.5], gewoon: [] }), ["adreskaart: geen geheel getal"]);
  assert.deepEqual(V.werkVormFouten({ schema: 2, adreskaart: [], gewoon: [], extra: 1 }), ["onverwachte sleutel extra", "schema ongeldig"]);
});

test("de vaste vorm: een adreskaart blijft een adreskaart met nieuwe tekst, een gewone kaart blijft gewoon als de tekst wegvalt", () => {
  const metTekst = poort(werk({ title: "Proefstraat 12 - herstelling voetpad bij fam. Proefmans" }), A([990001])); // verzonnen
  assert.equal(metTekst.adresKaart, true);
  assert.equal(metTekst.title, `${metTekst.soort} – Proefstraat 12`);
  assert.equal(KU.isSoortLabel(metTekst.soort), true);
  assert.doesNotMatch(JSON.stringify(metTekst), /Proefmans|herstelling/);
  const zonder = poort(werk({ title: "2000 Antwerpen, Proefstraat 12" }), B([990001]));
  assert.equal(zonder.adresKaart, undefined);
  assert.equal(V.lijstTitel(zonder), "2000 Antwerpen, Proefstraat");
  // Een id uit de vorige historiek (regel 13): gewoon, ook als regel 14 een adreskaart zou geven.
  assert.equal(poort(aansluiting({ title: "Proefstraat 12" }), null, { magBeslissen: true, bekend: new Set([990001]) }).adresKaart, undefined);
});

test("een onbekend werk dat een adreskaart wordt, toont in de browser geen nummer tot de verversing het vastlegt", () => {
  const w = aansluiting({ title: "2000 Antwerpen, Proefstraat 12" });
  const browser = poort(w, B([]));
  assert.equal(browser.adresKaart, true);
  assert.equal(browser.huisnummers, "");
  assert.equal(browser.title, "Nieuwe aansluiting op het elektriciteitsnet – Proefstraat");
  assert.doesNotMatch(kaartTekst(kaart(browser)), /\b12\b/);
  assert.equal(poort(w, B([]), { magBeslissen: true }).huisnummers, "nr. 12");
  assert.equal(poort(w, A([990001])).huisnummers, "nr. 12");
});

test("de browser laadt de vaste vorm samen met GIPOD; lukt dat niet, dan faalt de werkenlaag", async (t) => {
  const vorig = globalThis.fetch;
  t.after(() => { globalThis.fetch = vorig; });
  const gipod = { type: "Feature", geometry: { type: "Point", coordinates: [4.4, 51.22] }, properties: { GipodId: 990001, Description: "2000 Antwerpen, Proefstraat 12", Owner: "Fluvius System Operator", Status: "In uitvoering", Start: "2099-03-01T06:00:00Z", End: "2099-03-30T16:00:00Z", GroundworkSpecification: "klantaansluiting", PublicDomainOccupancyTypes: "Elektriciteit" } }; // verzonnen
  const district = { type: "Polygon", coordinates: [[[4.38, 51.2], [4.43, 51.2], [4.43, 51.24], [4.38, 51.24], [4.38, 51.2]]] };
  const straten = { segments: [{ a: [4.399, 51.219], b: [4.401, 51.221], refs: [PROEF] }], byName: new Map([["proefstraat", [PROEF]]]) };
  let vorm = A([990001]);
  const vragen = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    vragen.push(url.replace(/\?.*$/, ""));
    if (url.startsWith("/sources/werk-vorm.json")) return vorm ? Response.json(vorm) : new Response("", { status: 404 });
    if (url.includes("/collections/INNAME_PUNT/")) return Response.json({ type: "FeatureCollection", features: [gipod], links: [] });
    if (url.includes("/collections/HINDER_PUNT/")) return Response.json({ type: "FeatureCollection", features: [], links: [] });
    if (url.includes("/MapServer/19/query")) return Response.json({ objectIds: [] });
    return new Response("", { status: 404 });
  };
  const { items } = await werkenInKader([4.39, 51.21, 4.41, 51.23], { district, streetIndex: straten });
  assert.ok(vragen.includes("/sources/werk-vorm.json"));
  assert.equal(items[0].adresKaart, true);
  assert.equal(items[0].title, "Nieuwe aansluiting op het elektriciteitsnet – Proefstraat 12");
  assert.equal("aSignSupplement" in items[0], false, "geen aanvulling van A-Sign op een adreskaart");
  // Een nieuwe pagina (een verse module) zonder vaste vorm: de werkenlaag faalt.
  vorm = null;
  const vers = await import("../site/works-live.js?zonder-vorm");
  await assert.rejects(vers.werkenInKader([4.39, 51.21, 4.41, 51.23], { district, streetIndex: straten }));
});

// ---------- het nummer ----------

test("regels 20 tot 22: geen nummer uit een maat, een uur, een andere straat, een lijst of een traject", () => {
  const nr = (title, extra = {}) => poort(aansluiting({ title, ...extra }), A([990001])).huisnummers;
  assert.equal(nr("2000 Antwerpen, Proefstraat 12"), "nr. 12");
  assert.equal(nr("Proefstraat | 12"), "nr. 12");
  assert.equal(nr("Proefstraat: 12 - klantaansluiting"), "nr. 12");
  assert.equal(nr("Proefstraat 12 tem 14"), "nr. 12–14");
  assert.equal(nr("Proefstraat 12, 14 en 16"), "nr. 12–16", "een lijst op dezelfde straat blijft een reeks");
  assert.equal(nr("Proefstraat 31/2"), "nr. 31");
  assert.equal(nr("Proefstraat 12-12"), "nr. 12");
  for (const t of ["Proefstraat 2 rijstroken", "Proefstraat 7:30", "Proefstraat 12 m", "Proefstraat 3 dagen", "Proefstraat 1DN02", "Proefstraat nr 12", "Proefstraat thv 12", "Proefstr. 12"]) assert.equal(nr(t), "", t);
  assert.equal(nr("Testlaan 5"), "", "een nummer op een andere straat");
  assert.equal(nr("Proefstraat 12 - Testlaan 5"), "", "een lijst van adressen");
  assert.equal(nr("Proefstraat 12 - Testlaan 5", { streets: [PROEF, TEST] }), "", "een andere straat van het werk");
  assert.equal(nr("Proefstraat 12 en Proefstraat 30"), "", "twee nummers op dezelfde straat");
  assert.equal(nr("Proefstraat 12 tot Testlaan"), "", "een traject");
  assert.equal(nr("Proefstraat 12 richting Testlaan"), "", "een traject");
  assert.equal(nr("Proefstraat 12", { streets: [TEST] }), "", "nooit op een andere straat dan streets[0]");
  assert.equal(nr("Proefstraat 12", { streets: [] }), "");
  // Het nummer in een fase telt ook; een maat in de fase niet.
  assert.equal(nr("Werk in openbaar domein", { hindrance: hinder([fase("Fase 1 Proefstraat 8")]) }), "nr. 8");
});

test("een lift of levering krijgt nooit een nummer", () => {
  const lift = werk({ occupancyTypes: ["(Verhuis)lift/levering"], title: "2000 Antwerpen, Proefstraat 12" });
  for (const vorm of [null, A([990001]), B([990001])]) {
    const uit = poort(lift, vorm, { magBeslissen: true });
    assert.equal(uit.huisnummers || "", "");
    assert.doesNotMatch(kaartTekst(kaart(uit)), /\b12\b/);
    assert.doesNotMatch(V.lijstTitel(uit), /\b12\b/);
  }
  assert.equal(kaart(poort(lift, null, { magBeslissen: true })).titel.startsWith("Inname voor een lift of levering in de Proefstraat"), true);
});

test("lijstTitel van een gewone kaart verbergt een los huisnummer, en zoeken op dat nummer vindt het werk niet", () => {
  const b = poort(werk({ title: "2000 Antwerpen, Proefstraat 12 - herstelling voetpad" }), B([990001]));
  assert.equal(V.lijstTitel(b), "2000 Antwerpen, Proefstraat - herstelling voetpad");
  assert.equal(werkZoektekst(b).includes("12"), false);
  assert.equal(werkZoektekst(b).includes("herstelling"), true);
  assert.equal(V.lijstTitel(werk({ title: "Info: proef@voorbeeld.test" })), V.GEEN_TITEL); // verzonnen
  assert.equal(V.lijstTitel(werk({ title: "Proefstraat 31/2 - stelling" })), "Proefstraat - stelling");
});

// ---------- de kaart en de andere uitgangen ----------

test("een adreskaart: alleen de vaste gegevens van GIPOD, op elke uitgang", async () => {
  const w = aansluiting({ title: "2000 Antwerpen, Proefstraat 12 - klantaansluiting bij Proefmans", owner: "Fluvius - Proefmans", hindrance: hinder([fase("Fase 1 bij fam. Proefmans"), fase("2070 Proefdorp", "14")]), dossier: "GW2099-000001", aSignSupplement: { companies: ["Proefmans"] } }); // verzonnen
  const a = poort(w, A([990001]));
  assert.deepEqual(Object.keys(a).sort(), ["adresKaart", "boundaryConfidence", "end", "gipodId", "hindrance", "hindranceSourceLoaded", "huisnummers", "lastModified", "occupancyTypes", "owner", "ownerGroup", "point", "recordCount", "soort", "soortBron", "start", "status", "streetDistanceMeters", "streetResolution", "streets", "title", "workTypes"]);
  assert.deepEqual(a.hindrance.phases.map((p) => [p.description, p.buiten === true]), [["Fase 1", false], ["Fase 2", true]]);
  const k = kaart(a);
  assert.equal(Object.fromEntries(k.regels).Wat, `Nieuwe aansluiting op het elektriciteitsnet (volgens GIPOD). ${KU.ADRESKAART_WAT}`);
  assert.equal(Object.fromEntries(k.regels).Waar, "Proefstraat, nr. 12");
  assert.match(k.titel, /^Nieuwe aansluiting op het elektriciteitsnet in de Proefstraat nr\. 12[: ]/);
  assert.equal(k.bronTekst, "");
  const { document } = await bouwKaartUitleg({ works: [a], fetch: null, clock: () => new Date(`${VANDAAG}T05:00:00Z`) });
  const entry = kaartUitlegVoorPubliek(document).werken["990001"];
  assert.equal(entry.adresKaart, true);
  assert.equal(entry.huisnummers, "nr. 12");
  assert.deepEqual(kaartUitlegWerkFouten(entry, true), []);
  for (const uit of [k, V.lijstTitel(a), itemVoorHistoriek(a), compactWorkItem(itemVoorHistoriek(a)), itemVoorStraat(a, { laag: "werken" }), entry]) {
    assert.doesNotMatch(teksten(uit).join(" · "), /Proefmans|Proefdorp|GW2099/, JSON.stringify(uit).slice(0, 200));
  }
  assert.equal(compactWorkItem(itemVoorHistoriek(a)).title, "Nieuwe aansluiting op het elektriciteitsnet – Proefstraat");
  assert.equal("huisnummers" in itemVoorStraat(a, { laag: "werken" }), false);
  // Samen met wat de verversing bewaarde: een adreskaart, en nooit fasen of een omschrijving uit een bewaard werk zonder adreskaart.
  const gewoonBewaard = { omschrijving: "Proefstraat 12 - fam. Proefmans", fasen: [{ naam: "bij Proefmans", start: "2099-03-12", eind: "2099-03-12", gevolgen: [] }], huisnummers: "", straten: ["Proefstraat"], soort: "", soortBron: "" }; // verzonnen
  const e = workEntry({ ...a, hindrance: null }, { vandaag: VANDAAG, uitleg: { werken: { 990001: gewoonBewaard } } });
  assert.doesNotMatch(`${e.title} ${e.summary} ${e.uitleg.regels.flat().join(" ")}`, /Proefmans/);
});

test("alsAdreskaart, werkenVoorDeSite en schoonWerk veranderen niets bij een tweede keer", () => {
  const items = [aansluiting({ title: "Proefstraat 12 - Proefmans", hindrance: hinder([fase("2070 Proefdorp"), fase("Fase 1", "11")]) }), werk({ gipodId: 990002, title: "Proefstraat 12 - Vеrhuis" })]; // verzonnen
  for (const vorm of [A([990001]), B([990001, 990002]), null]) {
    const een = V.werkenVoorDeSite(items, vorm, { magBeslissen: true });
    assert.deepEqual(V.werkenVoorDeSite(een, vorm, { magBeslissen: true }), een);
    assert.deepEqual(V.werkenVoorDeSite(een, vorm), een);
  }
  const f = KU.werkFeiten(poort(items[0], A([990001])));
  assert.deepEqual(KU.alsAdreskaart(f), f);
  assert.deepEqual(KU.alsAdreskaart(KU.alsAdreskaart({ ...f, dossier: "GW2099-000001", omschrijving: "x", opdrachtgever: "Proefmans" })), KU.alsAdreskaart({ ...f, dossier: "GW2099-000001", omschrijving: "x", opdrachtgever: "Proefmans" }));
  const bewaard = { soort: "", soortBron: "", omschrijving: "Proefstraat 12 - herstelling", opdrachtgever: "", straten: ["Proefstraat"], huisnummers: "nr. 12", huisnummerBron: "", gevolgen: [], fasen: [{ naam: "Fase 1 Proefstraat 31/2", start: "", eind: "" }] };
  assert.deepEqual(schoonWerk(schoonWerk(bewaard)), schoonWerk(bewaard));
  assert.deepEqual(kaartUitlegWerkFouten(schoonWerk(bewaard), false), []);
  assert.deepEqual(kaartUitlegWerkFouten(bewaard, false), ["los huisnummer", "los huisnummer in tekst"]);
});

// ---------- verhuis ----------

test("het spoor in elke schrijfwijze, en geen officiële straat van het district past erop", () => {
  for (const t of ["Verhuis", "Vеrhuis", "Ver­huis", "ver huis", "VERHUIZING", "uithuizing", "inhuizing", "ladderlift", "Ver​huislift", "Verhúis", "ｖｅｒｈｕｉｓ", "VЕRHUIS", "ver-huis", "Ver.huis"]) assert.equal(V.VERHUIS_SPOOR.test(t), true, JSON.stringify(t));
  for (const t of ["Levering van een container", "Lift/levering", "Proefstraat 12", "huis", "verhuur", "Inname voor een lift of levering"]) assert.equal(V.VERHUIS_SPOOR.test(t), false, t);
  const straten = JSON.parse(fs.readFileSync(path.join(root, "site", "geo", "straten.json"), "utf8")).streets.map((r) => r[1]);
  assert.ok(straten.length > 1000);
  assert.deepEqual(straten.filter((n) => V.VERHUIS_SPOOR.test(n)), []);
  assert.equal(V.innameZonderVerhuis("(Ver­huis)lift/levering"), "Lift/levering");
  assert.equal(V.innameZonderVerhuis("Container;(Vеrhuis)lift/levering"), "Container;Lift/levering");
  assert.equal(V.innameZonderVerhuis("Verhuiswagen"), "Andere");
  assert.equal(KU.soortVanWerk({ omschrijving: "Verhuis Proefstraat 12" }).soort, "");
  assert.equal(KU.soortVanWerk({ occupancyTypes: ["Lift/levering"] }).soort, "Inname voor een lift of levering");
  assert.deepEqual(KU.innameLeesbaar(["Lift/levering", "Container"]), ["lift of levering", "container"]);
});

test("regel 9: elk werk, ook een gewone kaart, zonder spoor; een fase houdt haar data", () => {
  const w = V.zonderVerhuisSpoor(werk({ title: "Ver huis Proefstraat 12", owner: "Ladderlift Proefmans", occupancyTypes: ["(Verhuis)lift/levering"], hindrance: hinder([fase("Verhuislift"), fase("Fase 2", "13")]), aSignSupplement: { companies: ["Proefverhuizingen", "Proefbouw"], workTypes: ["Verhuis"], phases: [{ company: "Proefverhuizingen" }] }, awvSupplement: { werfNaam: "Uithuizing" } })); // verzonnen
  assert.equal(w.title, V.GEEN_TITEL);
  assert.equal(w.owner, "");
  assert.equal(w.ownerGroup, "Andere");
  assert.deepEqual(w.hindrance.phases.map((p) => [p.description, p.start]), [["", "2099-03-12T06:00:00Z"], ["Fase 2", "2099-03-13T06:00:00Z"]]);
  assert.deepEqual(w.aSignSupplement, { companies: ["Proefbouw"], workTypes: [], phases: [{ company: "" }] });
  assert.deepEqual(w.awvSupplement, { werfNaam: "" });
  assert.deepEqual(teksten(w).filter((t) => V.VERHUIS_SPOOR.test(t)), []);
});

test("opkuis-verhuis: de bewaarde bestanden zonder spoor, en een tweede run verandert niets", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opkuis-verhuis-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const schrijf = (rel, doc) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), typeof doc === "string" ? doc : `${JSON.stringify(doc, null, 2)}\n`); };
  const fasen = [{ naam: "Verhuislift", start: "2099-03-12", eind: "2099-03-12", gevolgen: [] }, { naam: "Fase 2", start: "2099-03-13", eind: "2099-03-13", gevolgen: [] }];
  const uitleg = { schemaVersion: 1, generatedAt: "2099-03-10T05:00:00.000Z", vanaf: "2099-03-10", tot: "2099-05-09", werken: {
    990001: { soort: "Verhuis", soortBron: "fasen van de hinder in GIPOD", innameSoort: "Verhuislift of levering", inname: ["verhuislift of levering", "container"], omschrijving: "Verhuis fam. Proefmans", opdrachtgever: "", straten: ["Proefstraat"], huisnummers: "", huisnummerBron: "", gevolgen: [], fasen, bijgewerkt: "" },
    990002: { soort: "Gevelwerken", soortBron: "omschrijving van de beheerder", omschrijving: "Gevelwerken Proefstraat 12", opdrachtgever: "", straten: ["Proefstraat"], huisnummers: "", huisnummerBron: "", gevolgen: [], fasen: [], bijgewerkt: "" },
  }, evenementen: {} }; // verzonnen
  schrijf("site/sources/kaart-uitleg.json", uitleg);
  const opnieuw = () => opkuisVerhuis({ rootDir: dir, write: true });
  assert.ok(opnieuw().gewijzigd.includes("site/sources/kaart-uitleg.json"));
  const na = JSON.parse(fs.readFileSync(path.join(dir, "site", "sources", "kaart-uitleg.json"), "utf8")).werken;
  assert.equal(na["990001"].soort, "Inname voor een lift of levering");
  assert.equal(na["990001"].omschrijving, "");
  assert.deepEqual(na["990001"].inname, ["lift of levering", "container"]);
  assert.deepEqual(na["990001"].fasen.map((f) => f.naam), ["Fase 2"]);
  assert.equal(na["990002"].omschrijving, "Gevelwerken Proefstraat", "kaart-uitleg.json: een gewone kaart zonder los huisnummer (regel 31)");
  assert.deepEqual(opnieuw().gewijzigd, []);
  assert.deepEqual(werkZonderVerhuis(werkZonderVerhuis({ title: "Verhuis", owner: "Ladderlift", ownerGroup: "Andere" })), { title: V.GEEN_TITEL, owner: "", ownerGroup: "Andere" });
});

// ---------- de verversing ----------

const DISTRICT = { type: "Polygon", coordinates: [[[4.38, 51.2], [4.43, 51.2], [4.43, 51.24], [4.38, 51.24], [4.38, 51.2]]] };
const STRAAT = { type: "Feature", properties: { LSTRNMID: "9101", LSTRNM: "Proefstraat", RSTRNMID: "9101", RSTRNM: "Proefstraat", postcode: "2000", DISTRICT: "ANTWERPEN" }, geometry: { type: "LineString", coordinates: [[4.399, 51.219], [4.401, 51.221]] } };
const gipodWerk = (Description, extra = {}) => ({ type: "Feature", geometry: { type: "Point", coordinates: [4.4, 51.22] }, properties: { GipodId: 990001, Description, Owner: "Fluvius System Operator", Status: "In uitvoering", Start: "2099-03-01T06:00:00Z", End: "2099-03-30T16:00:00Z", GroundworkSpecification: "klantaansluiting", PublicDomainOccupancyTypes: "Elektriciteit", ...extra } }); // verzonnen
const nepFetch = (werkFeature) => async (input) => {
  const url = new URL(String(input));
  if (url.pathname.includes("/portal_publiek9/MapServer/905/")) return Response.json({ type: "FeatureCollection", features: [STRAAT] });
  if (url.pathname.includes("/portal_publiek2/MapServer/109/")) return Response.json({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: DISTRICT }] });
  if (url.pathname.endsWith("/collections/INNAME_PUNT/items")) return Response.json({ type: "FeatureCollection", features: [werkFeature], links: [] });
  if (url.pathname.endsWith("/collections/HINDER_PUNT/items")) return Response.json({ type: "FeatureCollection", features: [], links: [] });
  if (/\/P_ASign\/ASign\/MapServer\/\d+\/query$/.test(url.pathname)) return url.searchParams.get("returnIdsOnly") === "true" ? Response.json({ objectIds: [] }) : Response.json({ features: [] });
  return new Response("", { status: 404 });
};
const nieuweMap = (t) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "werk-vorm-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const leesMap = (dir, rel) => JSON.parse(fs.readFileSync(path.join(dir, rel), "utf8"));

test("de verversing: een nieuw werk krijgt zijn vaste vorm vóór de rest, en blijft een adreskaart met nieuwe tekst", async (t) => {
  const dir = nieuweMap(t);
  await refreshLiveHistory({ rootDir: dir, fetch: nepFetch(gipodWerk("2000 Antwerpen, Proefstraat 12")), clock: () => new Date("2099-03-10T03:00:00Z"), log: () => {} });
  assert.deepEqual(leesMap(dir, "site/sources/werk-vorm.json"), { schema: 1, adreskaart: [990001], gewoon: [] });
  const entry = leesMap(dir, "site/sources/kaart-uitleg.json").werken["990001"];
  assert.equal(entry.adresKaart, true);
  assert.equal(entry.huisnummers, "nr. 12");
  assert.equal(leesMap(dir, "site/history/live-layers.json").layers.works.items[0].title, "Nieuwe aansluiting op het elektriciteitsnet – Proefstraat");
  await refreshLiveHistory({ rootDir: dir, fetch: nepFetch(gipodWerk("2000 Antwerpen, Proefstraat 12 - bij fam. Proefmans", { Owner: "Proefmans" })), clock: () => new Date("2099-03-11T03:00:00Z"), log: () => {} }); // verzonnen
  assert.deepEqual(leesMap(dir, "site/sources/werk-vorm.json"), { schema: 1, adreskaart: [990001], gewoon: [] });
  for (const rel of ["site/sources/kaart-uitleg.json", "site/history/live-layers.json"]) assert.doesNotMatch(fs.readFileSync(path.join(dir, rel), "utf8"), /Proefmans/, rel);
  assert.deepEqual(werkVormProblemen(dir), []);
});

test("de verversing: een werk dat al gepubliceerd was, blijft gewoon; een ongeldig bestand houdt alles tegen", async (t) => {
  const dir = nieuweMap(t);
  fs.mkdirSync(path.join(dir, "site", "sources"), { recursive: true });
  fs.writeFileSync(path.join(dir, "site", "sources", "kaart-uitleg.json"), JSON.stringify({ schemaVersion: 1, generatedAt: "2099-03-09T05:00:00.000Z", vanaf: "2099-03-09", tot: "2099-05-08", werken: { 990001: { soort: "Nieuwe aansluiting op het elektriciteitsnet", soortBron: "", omschrijving: "", opdrachtgever: "", straten: ["Proefstraat"], huisnummers: "", huisnummerBron: "", gevolgen: [], fasen: [], bijgewerkt: "" } }, evenementen: {} }));
  await refreshLiveHistory({ rootDir: dir, fetch: nepFetch(gipodWerk("2000 Antwerpen, Proefstraat 12")), clock: () => new Date("2099-03-10T03:00:00Z"), log: () => {} });
  assert.deepEqual(leesMap(dir, "site/sources/werk-vorm.json"), { schema: 1, adreskaart: [], gewoon: [990001] });
  assert.equal(leesMap(dir, "site/sources/kaart-uitleg.json").werken["990001"].adresKaart, undefined);

  const kapot = nieuweMap(t);
  fs.mkdirSync(path.join(kapot, "site", "sources"), { recursive: true });
  fs.writeFileSync(path.join(kapot, "site", "sources", "werk-vorm.json"), JSON.stringify({ schema: 1, adreskaart: [5], gewoon: [5] }));
  let gevraagd = 0;
  await assert.rejects(refreshLiveHistory({ rootDir: kapot, fetch: async () => { gevraagd += 1; throw new Error("geen netwerk"); }, clock: () => new Date("2099-03-10T03:00:00Z"), log: () => {} }), /werk-vorm\.json ongeldig/);
  assert.equal(gevraagd, 0);
  assert.deepEqual(fs.readdirSync(path.join(kapot, "site", "sources")), ["werk-vorm.json"]);
  assert.equal(fs.existsSync(path.join(kapot, "site", "history")), false);
});

test("de vaste vorm van de repo is geldig en kent elk gepubliceerd werk; nergens een spoor", () => {
  assert.deepEqual(werkVormProblemen(root), []);
});
