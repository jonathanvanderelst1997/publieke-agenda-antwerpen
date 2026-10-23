// Nakijkronde van head 0dfb9cd8 (werken: adreskaart of gewone kaart, site/werk-vorm.js). Grondregel: liever geen nummer dan
// een fout huis; bij elke twijfel geen nummer. Elke toets hieronder faalt op 0dfb9cd8. Alle straten, namen, bedrijven en
// nummers zijn verzonnen (Proefstraat, Proefmans, Proefbedrijf); geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as V from "../site/werk-vorm.js";
import * as KU from "../site/kaart-uitleg.js";
import { ownerGroup } from "../site/works-core.js";
import { workEntry } from "../site/place-core.js";
import { werkOpdrachtgever } from "../site/works-live.js";
import { bouwKaartUitleg, kaartUitlegVoorPubliek, schoonWerk } from "../lib/kaart-uitleg-refresh.mjs";
import { werkVormProblemen } from "../lib/werk-vorm-validatie.mjs";
import { refreshLiveHistory } from "../scripts/refresh-live-history.mjs";

const VANDAAG = "2099-03-10";
const PROEF = { id: "9101", name: "Proefstraat", postcode: "2000" };
const fase = (description, dag = "12") => ({ description, start: `2099-03-${dag}T06:00:00Z`, end: `2099-03-${dag}T16:00:00Z`, consequences: ["Parkeerverbod"] });
const hinder = (fasen) => ({ severe: false, consequences: ["Parkeerverbod"], start: "2099-03-11T06:00:00Z", end: "2099-03-20T16:00:00Z", phases: fasen });
// Een werk zoals collectWorks, attachHindrance en de straatkoppeling het geven (verzonnen).
const werk = (extra = {}) => {
  const owner = extra.owner ?? "Proefmans";
  return {
    gipodId: 990001, title: "Werk in openbaar domein", owner, ownerGroup: ownerGroup(owner), status: "In uitvoering",
    start: "2099-03-01T06:00:00Z", end: "2099-03-30T16:00:00Z", workTypes: [], occupancyTypes: ["Andere"], lastModified: "2099-02-01T00:00:00Z",
    point: [4.40005, 51.22005], recordCount: 1, boundaryConfidence: "point_inside_new", hindrance: null, hindranceSourceLoaded: true,
    streets: [PROEF], streetResolution: "nearest_official_axis", streetDistanceMeters: 3, ...extra,
  };
};
const A = (ids = [990001]) => ({ schema: 1, adreskaart: ids, gewoon: [] });
const poort = (item, vorm = null, opties = { magBeslissen: true }) => V.werkenVoorDeSite([item], vorm, opties)[0];
const regels = (k) => Object.fromEntries(k.regels);
const kaartTekst = (k) => [k.titel, k.samenvatting, k.bronTekst || "", ...k.regels.flat()].join(" · ");

// De werfzone (INNAME-vlak) en het adressenregister zonder netwerk: elke vraag wordt geteld; het register geeft twee
// huizen in de Proefstraat.
function nepRegister() {
  const vragen = [];
  const fetch = async (url, opts = {}) => {
    const u = String(url);
    vragen.push(u);
    const body = /INNAME|inname/i.test(u) && !opts.method
      ? { features: [{ geometry: { type: "Polygon", coordinates: [[[4.4, 51.22], [4.4001, 51.22], [4.4001, 51.2201], [4.4, 51.2201], [4.4, 51.22]]] } }] }
      : { features: [{ attributes: { STRAATNM: "Proefstraat", HUISNR: "10" } }, { attributes: { STRAATNM: "Proefstraat", HUISNR: "12" } }] };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return { vragen, fetch };
}
async function verversing(items) {
  const nep = nepRegister();
  const { document } = await bouwKaartUitleg({ works: items, fetch: nep.fetch, clock: () => new Date(`${VANDAAG}T05:00:00Z`), now: () => 0, budgetMs: 1e9 });
  return { vragen: nep.vragen, uitleg: kaartUitlegVoorPubliek(document) };
}

// ---------- MIDDEL 1: een verhuis die alleen aan de titel, een fase of de opdrachtgever te herkennen is ----------

test("MIDDEL 1: een werk met het spoor in de titel, een fase of de opdrachtgever blijft één adres: geen register, geen reeks", async () => {
  const gevallen = [
    ["titel", werk({ title: "Verhuis" })],
    ["fase", werk({ hindrance: hinder([fase("verhuis")]) })],
    ["fase met een ander woord", werk({ title: "Inname openbaar domein", hindrance: hinder([fase("Verhuizing")]) })],
    ["opdrachtgever", werk({ owner: "Verhuisfirma Proef" })],
    ["soort grondwerk", werk({ workTypes: ["Verhuis"] })],
  ];
  for (const [wat, ruw] of gevallen) {
    const w = poort(ruw);
    assert.equal(w.eenAdres, true, wat);
    assert.equal(w.adresKaart, undefined, wat);
    assert.equal(KU.isEenAdresWerk(KU.werkFeiten(w)), true, wat);
    const { vragen, uitleg } = await verversing([w]);
    assert.equal(vragen.length, 0, `${wat}: geen vraag aan het adressenregister (#141)`);
    const e = uitleg.werken["990001"];
    assert.equal(e.huisnummers, "", wat);
    assert.equal("adres" in e, false, wat);
    const k = workEntry(w, { vandaag: VANDAAG, uitleg }).uitleg;
    assert.equal(regels(k).Waar, "Proefstraat (huisnummer weggelaten: het gaat om één adres)", wat);
    assert.doesNotMatch(kaartTekst(k), /\bnr\.|10–12|Proefstraat,? 1[02]\b/, wat);
    assert.doesNotMatch(JSON.stringify([w, e, k]), /verhui/i, wat);
  }
});

test("MIDDEL 1: een werk met het spoor wordt nooit een adreskaart en krijgt nooit een nummer, ook niet uit de lijst adreskaart", () => {
  // Een container met het spoor in de titel en een nummer in een fase: zonder spoor een adreskaart met nummer.
  const container = werk({ title: "Verhuis Proefstraat 999", occupancyTypes: ["Container"], hindrance: hinder([fase("Proefstraat 12")]) });
  assert.equal(poort({ ...container, title: "Container" }).huisnummers, "nr. 12", "zonder spoor: een adreskaart met nummer");
  const w = poort(container);
  assert.equal(w.adresKaart, undefined);
  assert.equal(V.isAdreskaart(w), false);
  // Al in "adreskaart" (GIPOD voegde het spoor later toe): een adreskaart zonder nummer, en ook geen reeks uit het register.
  const a = poort(container, A(), {});
  assert.equal(a.adresKaart, true);
  assert.equal(a.huisnummers, "");
  assert.equal(a.eenAdres, true);
  const f = KU.werkFeiten(a, { huisnummers: "nr. 10–12", huisnummerBron: "afgeleid uit de werfzone en het adressenregister" });
  assert.equal(f.huisnummers, "");
  assert.doesNotMatch(kaartTekst(KU.werkKaartje(a, { vandaag: VANDAAG })), /\bnr\.|10–12|Proefstraat,? (?:1[02]|999)\b/);
  // Een reeks uit het register die een oudere verversing bewaarde: ook niet op de plekpagina.
  const bewaard = { ...f, huisnummers: "nr. 10–12", huisnummerBron: "afgeleid uit de werfzone en het adressenregister", bijgewerkt: a.lastModified };
  assert.doesNotMatch(kaartTekst(workEntry(a, { vandaag: VANDAAG, uitleg: { werken: { 990001: bewaard } } }).uitleg), /\bnr\.|10–12/);
});

test("MIDDEL 1: de feiten van zo'n werk hebben geen huisnummer, ook niet uit een fase of als adreskaart", () => {
  const w = poort(werk({ title: "Verhuis", hindrance: hinder([fase("Proefstraat 10-12"), fase("Fase 2", "13")]) }));
  const f = KU.werkFeiten(w);
  assert.equal(f.huisnummers, "");
  assert.deepEqual(f.fasen.map((x) => x.naam).filter((n) => /\d/.test(n.replace(/^Fase \d$/, ""))), []);
  // Een adreskaart met de vlag en toch een nummer (een oudere of kapotte stand): geen nummer.
  const a = { ...poort(werk({ title: "Verhuis", occupancyTypes: ["Container"] }), A(), {}), huisnummers: "nr. 12" };
  assert.equal(a.eenAdres, true);
  assert.equal(KU.werkFeiten(a).huisnummers, "");
  assert.doesNotMatch(kaartTekst(KU.werkKaartje(a, { vandaag: VANDAAG })), /\bnr\.|Proefstraat,? 12\b/);
});

test("MIDDEL 1: een reeks uit het register die een oudere verversing bij zo'n werk bewaarde, valt weg uit kaart-uitleg.json", () => {
  const oud = { soort: "", soortBron: "", eenAdres: true, omschrijving: "", opdrachtgever: "Proefmans", straten: ["Proefstraat"], huisnummers: "nr. 10–12", huisnummerBron: "afgeleid uit de werfzone en het adressenregister", adres: "nr. 10–12", gevolgen: [], fasen: [], bijgewerkt: "" }; // verzonnen
  const schoon = schoonWerk(oud);
  assert.equal(schoon.huisnummers, "");
  assert.equal(schoon.huisnummerBron, "");
  assert.equal("adres" in schoon, false);
  assert.equal(schoon.eenAdres, true);
});

test("MIDDEL 1: de verversing kende het spoor; live (een straatbestand, een oudere stand) niet: nog altijd één adres", () => {
  const bewaard = { soort: "", soortBron: "", eenAdres: true, omschrijving: "", opdrachtgever: "", straten: ["Proefstraat"], huisnummers: "", huisnummerBron: "", gevolgen: [], fasen: [], bijgewerkt: "2099-02-01T00:00:00Z" };
  const live = werk({ title: "Werk in openbaar domein" });
  const k = workEntry(live, { vandaag: VANDAAG, uitleg: { werken: { 990001: bewaard } } }).uitleg;
  assert.equal(regels(k).Waar, "Proefstraat (huisnummer weggelaten: het gaat om één adres)");
  assert.equal(k.ontbreekt.includes("huisnummers niet gepubliceerd"), false);
});

test("MIDDEL 1: een lift of levering of een aanvulling van A-Sign zet geen vlag; een andere soort zegt niet 'het gaat om één adres'", () => {
  const lift = poort(werk({ occupancyTypes: ["(Verhuis)lift/levering"] }));
  assert.equal(lift.eenAdres, undefined, "de soort zegt al één adres");
  assert.equal(KU.isEenAdresWerk(KU.werkFeiten(lift)), true);
  const asign = poort(werk({ title: "Rioleringswerken", aSignSupplement: { companies: ["Proefverhuizingen", "Proefbouw"], workTypes: [], phaseStatuses: [], trafficImpacts: [], dossierHindrances: [] } }));
  assert.equal(asign.eenAdres, undefined);
  assert.deepEqual(asign.aSignSupplement.companies, ["Proefbouw"]);
  // Het spoor in een fase van een werk met een eigen soort: één adres, maar "het gaat om één adres" is dan niet zeker.
  const riool = poort(werk({ title: "Rioleringswerken", hindrance: hinder([fase("verhuis werfkeet")]) }));
  assert.equal(riool.eenAdres, true);
  assert.equal(regels(KU.werkKaartje(riool, { vandaag: VANDAAG })).Waar, "Proefstraat (huisnummer weggelaten)");
});

// ---------- MIDDEL 2: regel 35 herstelt zichzelf ----------

test("MIDDEL 2: vormNaVerversing zet elk gepubliceerd werk-id dat nog in geen lijst staat bij gewoon", () => {
  const vorm = { schema: 1, adreskaart: [990003], gewoon: [990001] };
  assert.deepEqual(V.vormNaVerversing(vorm, [], { bekend: new Set([990001, 990002, 990003]) }), { schema: 1, adreskaart: [990003], gewoon: [990001, 990002] });
  assert.deepEqual(V.vormNaVerversing(vorm, [{ gipodId: 990004, adresKaart: true }], { bekend: [990005] }), { schema: 1, adreskaart: [990003, 990004], gewoon: [990001, 990005] });
});

const DISTRICT = { type: "Polygon", coordinates: [[[4.38, 51.2], [4.43, 51.2], [4.43, 51.24], [4.38, 51.24], [4.38, 51.2]]] };
const STRAAT = { type: "Feature", properties: { LSTRNMID: "9101", LSTRNM: "Proefstraat", RSTRNMID: "9101", RSTRNM: "Proefstraat", postcode: "2000", DISTRICT: "ANTWERPEN" }, geometry: { type: "LineString", coordinates: [[4.399, 51.219], [4.401, 51.221]] } };
const gipodWerk = (GipodId, Description) => ({ type: "Feature", geometry: { type: "Point", coordinates: [4.4, 51.22] }, properties: { GipodId, Description, Owner: "Fluvius System Operator", Status: "In uitvoering", Start: "2099-03-01T06:00:00Z", End: "2099-03-30T16:00:00Z", GroundworkSpecification: "riolering", PublicDomainOccupancyTypes: "Riolering" } }); // verzonnen
const nepGipod = (werken, { werkenFaalt = false } = {}) => async (input) => {
  const url = new URL(String(input));
  if (url.pathname.includes("/portal_publiek9/MapServer/905/")) return Response.json({ type: "FeatureCollection", features: [STRAAT] });
  if (url.pathname.includes("/portal_publiek2/MapServer/109/")) return Response.json({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: DISTRICT }] });
  if (url.pathname.endsWith("/collections/INNAME_PUNT/items")) return werkenFaalt ? new Response("", { status: 503 }) : Response.json({ type: "FeatureCollection", features: werken, links: [] });
  if (url.pathname.endsWith("/collections/HINDER_PUNT/items")) return Response.json({ type: "FeatureCollection", features: [], links: [] });
  if (/\/P_ASign\/ASign\/MapServer\/\d+\/query$/.test(url.pathname)) return url.searchParams.get("returnIdsOnly") === "true" ? Response.json({ objectIds: [] }) : Response.json({ features: [] });
  return new Response("", { status: 404 });
};
const VORM = "site/sources/werk-vorm.json";

test("MIDDEL 2: een gepubliceerd werk dat al afgelopen is en in werk-vorm.json ontbreekt: de volgende verversing herstelt regel 35", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "werk-vorm-35-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const lees = () => JSON.parse(fs.readFileSync(path.join(dir, VORM), "utf8"));
  const zonder = (id) => { const v = lees(); fs.writeFileSync(path.join(dir, VORM), `${JSON.stringify({ ...v, gewoon: v.gewoon.filter((x) => x !== id), adreskaart: v.adreskaart.filter((x) => x !== id) })}\n`); };
  const twee = [gipodWerk(990001, "Rioleringswerken Proefstraat"), gipodWerk(990005, "Rioleringswerken Proefstraat")];
  await refreshLiveHistory({ rootDir: dir, fetch: nepGipod(twee), clock: () => new Date("2099-03-10T03:00:00Z"), log: () => {} });
  assert.deepEqual(werkVormProblemen(dir), []);
  // Zoals een verversing van main na de laatste overgang: 990005 is gepubliceerd, maar staat niet in de vaste vorm.
  zonder(990005);
  assert.match(werkVormProblemen(dir).join("\n"), /1 gepubliceerde werk-ids ontbreken/);
  // De volgende dag is 990005 afgelopen (niet meer in de respons van GIPOD); 990007 staat alleen in een straatbestand.
  fs.mkdirSync(path.join(dir, "site", "straat"), { recursive: true });
  fs.writeFileSync(path.join(dir, "site", "straat", "9101.json"), `${JSON.stringify({ werken: [{ id: "work:990007" }] })}\n`);
  assert.match(werkVormProblemen(dir).join("\n"), /2 gepubliceerde werk-ids ontbreken/);
  await refreshLiveHistory({ rootDir: dir, fetch: nepGipod([twee[0]]), clock: () => new Date("2099-03-11T03:00:00Z"), log: () => {} });
  assert.ok(lees().gewoon.includes(990005));
  assert.ok(lees().gewoon.includes(990007));
  assert.deepEqual(werkVormProblemen(dir), []);
  // Ook als de werkenlaag faalt.
  zonder(990005);
  await refreshLiveHistory({ rootDir: dir, fetch: nepGipod([], { werkenFaalt: true }), clock: () => new Date("2099-03-12T03:00:00Z"), log: () => {} });
  assert.ok(lees().gewoon.includes(990005));
  assert.deepEqual(werkVormProblemen(dir), []);
});

// ---------- MIDDEL 3: "niet gepubliceerd" bij een opdrachtgever die GIPOD wel noemt ----------

test("MIDDEL 3: een adreskaart met een opdrachtgever buiten de groepen zegt 'weggelaten', niet 'niet gepubliceerd'", async () => {
  const ruw = werk({ owner: "Proefbedrijf Containers BV", title: "2000 | Antwerpen | Proefstraat | 999", occupancyTypes: ["Container"] }); // verzonnen
  assert.equal(ruw.ownerGroup, "Andere");
  const a = poort(ruw);
  assert.equal(a.adresKaart, true);
  assert.equal(a.huisnummers, "nr. 999");
  assert.equal(a.owner, "");
  assert.equal(regels(KU.werkKaartje(a, { vandaag: VANDAAG })).Opdrachtgever, KU.OPDRACHTGEVER_WEG);
  assert.equal(werkOpdrachtgever(a), "Weggelaten (GIPOD noemt er een)");
  // Ook met de feiten van de verversing (kaart-uitleg.json), en na een tweede poort (een straatbestand).
  const { uitleg } = await verversing([a]);
  assert.equal(regels(workEntry(V.werkenVoorDeSite([a], A())[0], { vandaag: VANDAAG, uitleg }).uitleg).Opdrachtgever, KU.OPDRACHTGEVER_WEG);
  assert.doesNotMatch(JSON.stringify([a, uitleg]), /Proefbedrijf/);
});

test("MIDDEL 3: een opdrachtgever met het spoor van een verhuizing zegt 'weggelaten', ook op een gewone kaart", () => {
  const g = poort(werk({ owner: "Verhuisfirma Proef", title: "Wegenwerken Proefstraat" }), { schema: 1, adreskaart: [], gewoon: [990001] }, {}); // verzonnen
  assert.equal(g.adresKaart, undefined);
  assert.equal(regels(KU.werkKaartje(g, { vandaag: VANDAAG })).Opdrachtgever, KU.OPDRACHTGEVER_WEG);
  assert.equal(werkOpdrachtgever(g), "Weggelaten (GIPOD noemt er een)");
});

test("MIDDEL 3: zonder opdrachtgever in GIPOD blijft het 'niet gepubliceerd' en 'Niet ingevuld'; een naam of groep blijft staan", () => {
  for (const owner of ["", "   "]) {
    const ruw = werk({ owner, title: "2000 | Antwerpen | Proefstraat | 999", occupancyTypes: ["Container"] });
    assert.equal(ruw.ownerGroup, "Onbekend", JSON.stringify(owner));
    const a = poort(ruw);
    assert.equal(a.adresKaart, true);
    assert.equal(a.ownerGroup, "Onbekend");
    assert.equal(regels(KU.werkKaartje(a, { vandaag: VANDAAG })).Opdrachtgever, "niet gepubliceerd");
    assert.equal(werkOpdrachtgever(a), "Niet ingevuld");
  }
  const fluvius = poort(werk({ owner: "Fluvius System Operator", title: "2000 | Antwerpen | Proefstraat | 999", occupancyTypes: ["Container"] }));
  assert.equal(regels(KU.werkKaartje(fluvius, { vandaag: VANDAAG })).Opdrachtgever, "Fluvius");
  assert.equal(werkOpdrachtgever(fluvius), "Fluvius");
  const gewoon = poort(werk({ owner: "Proefbedrijf", title: "Wegenwerken Proefstraat" }), { schema: 1, adreskaart: [], gewoon: [990001] }, {}); // verzonnen
  assert.equal(regels(KU.werkKaartje(gewoon, { vandaag: VANDAAG })).Opdrachtgever, "Proefbedrijf");
  assert.equal(werkOpdrachtgever(gewoon), "Proefbedrijf");
});

// ---------- MIDDEL 4: twee verschillende nummers op de straat ----------

test("MIDDEL 4: twee verschillende nummers op de straat, gescheiden door een komma, '·' of '|': geen nummer", () => {
  const aansluiting = (title) => werk({ title, owner: "Fluvius System Operator", occupancyTypes: ["Elektriciteit"], workTypes: ["klantaansluiting"] });
  for (const t of ["Proefstraat 12, Proefstraat 14", "Proefstraat 12 · Proefstraat 14", "Proefstraat 12 | Proefstraat 14", "2000 Antwerpen, Proefstraat 12, Proefstraat 14"]) {
    assert.equal(V.huisnummerVoorAdreskaart(aansluiting(t)), "", t);
    assert.equal(poort(aansluiting(t)).huisnummers, "", t);
  }
  // Hetzelfde nummer twee keer: één huis.
  assert.equal(V.huisnummerVoorAdreskaart(aansluiting("Proefstraat 12, Proefstraat 12")), "nr. 12");
});
