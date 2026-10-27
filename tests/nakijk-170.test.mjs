// Nakijkronde van tak #170 ("een straat toont alles"), met verzonnen dossiers en straten (ET2099..., Proef...),
// behalve waar een bevinding naar een echt dossier verwijst: dan dezelfde vorm, niet de inhoud.
//  1. Samenvoegen alleen op een vaste eigen naam (niet op "Vermoedelijk ..." of een soort); de straten en het
//     label per dossier; één kaart per evenement, ook voor het partnerdossier.
//  2. Het middelpunt van een reuzenvlak is geen straat van het evenement (ET2025007162, Groenplaats).
//  3. Bij het afkappen eerst de eigen plekken en de zone, dan het parcours (ET2026000445, Vlaamsekaai).
//  7. Geen huisnummer in een omschrijving: na een aanwijzer, na "tot", na een straatwoord; vangnet in de validatie.
// 10. De vaagheidsratel: een stijging op dezelfde data wordt nooit stil de nieuwe basislijn.
// Geen netwerk, geen klok.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MAX_STRATEN, asignAgendapunten, dossierFeiten, opTitelSamen, stratenVoorFeed } from "../lib/asign-evenementen-agenda.mjs";
import { DREMPELS, dossiersUitAsign, reuzenVlak, verrijk, vormVan } from "../lib/parcours-herkenning.mjs";
import { sourceDocument, validateSourceDocument } from "../lib/source-feed.mjs";
import { buildFeed } from "../scripts/build-sources.mjs";
import { HUISNUMMER_IN_OMSCHRIJVING, validateKaartUitleg } from "../lib/kaart-uitleg-validatie.mjs";
import { isAanvaard, nietAanvaardeStijgingen, validateVaagheid, vatSamen } from "../lib/vaagheid.mjs";
import { stijgingenTegenBasis } from "../scripts/vaagheid-tegen-basis.mjs";
import { aanvaardAlles, vergelijkMet } from "../scripts/meet-vaagheid.mjs";
import * as pc from "../site/place-core.js";
import { bruikbareBeschrijving, veiligeOmschrijving } from "../site/kaart-uitleg.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VANDAAG = "2026-10-12";
const RETRIEVED = "2026-10-12T05:20:00.000Z";
const GOED = "aanvraag_goedgekeurd", AANVRAAG = "technisch_advies_wordt_gevraagd";
const feit = (dossier, velden = {}) => ({
  dossier, status: GOED, binnenDistrict: true, fasen: [{ naam: "Evenement", start: "2026-10-20", eind: "2026-10-20" }], dagen: ["2026-10-20"],
  langs: [], zone: [], kernStraten: ["Proefplein"], beginStraat: "Proefplein", wijk: "Proefwijk", postcodes: ["2000"], speelstraat: false, vorm: null,
  ...velden,
});
const fiche = (velden = {}) => ({ zekerheid: "onbekend", naam: "", soort: "", organisator: "", uren: "", link: "", methode: "kaart", dagen: [], binnenDistrict: true, ...velden });
const bouw = (opties) => asignAgendapunten({ vandaag: VANDAAG, retrievedAt: RETRIEVED, ...opties });

// ---------- 1. samenvoegen ----------

test("1. twee dossiers met dezelfde gegokte titel op dezelfde dag (twee verschillende tochten) blijven twee agendapunten", () => {
  // Zoals ET2026004449 en ET2026005502 op 20/10: allebei "Vermoedelijk een studentenactiviteit op het Proefplein",
  // maar een andere route. Vroeger één punt, met de straten van beide en zonder label.
  const a = feit("ET2099170001", { langs: ["Proefplein", "Parkstraat", "Kaaistraat"] });
  const b = feit("ET2099170002", { status: AANVRAAG, langs: ["Proefplein", "Haltestraat", "Eindplein"] });
  const auto = { dossiers: Object.fromEntries(["ET2099170001", "ET2099170002"].map((d) => [d, fiche({ zekerheid: "waarschijnlijk", soort: "een studentenactiviteit", methode: "regels" })])) };
  const { items, tellers } = bouw({ feiten: [a, b], auto });
  assert.equal(tellers.samengevoegd, 0);
  assert.deepEqual(items.map((i) => [i.externalId, i.title, i.straten, Boolean(i.nietGoedgekeurd)]), [
    ["ET2099170001", "Vermoedelijk een studentenactiviteit op het Proefplein", ["Proefplein", "Parkstraat", "Kaaistraat"], false],
    ["ET2099170002", "Vermoedelijk een studentenactiviteit op het Proefplein", ["Proefplein", "Haltestraat", "Eindplein"], true],
  ]);
  assert.ok(items.every((i) => !i.ookDossiers && !/Ook dossier/.test(i.info)));
  // De regel zelf: alleen een vaste eigen naam (handfiche, zekere herkenning, besluit).
  assert.equal(opTitelSamen({ titel: "Vermoedelijk een studentenactiviteit op het Proefplein", herkomst: "soort", eigenNaam: "" }), false);
  assert.equal(opTitelSamen({ titel: "Vermoedelijk Proefloop", herkomst: "automatisch", eigenNaam: "Proefloop" }), false);
  assert.equal(opTitelSamen({ titel: "Evenement op het Proefplein: lus van 2 km", herkomst: "zonder-naam", eigenNaam: "" }), false);
  assert.equal(opTitelSamen({ titel: "Proefloop", herkomst: "handfiche", eigenNaam: "Proefloop" }), true);
});

test("1. hetzelfde evenement (vaste naam): één punt met de straten van beide, ookDossiers, en het label alleen op de straten van de aanvraag", () => {
  // Zoals ET2026004212 (goedgekeurd) en ET2026005657 (een lus in aanvraag): als het echt één evenement is.
  const goed = feit("ET2099170011", { beginStraat: "Proefwaag", kernStraten: ["Proefwaag"], langs: ["Proefwaag", "Proefplein"] });
  const lus = feit("ET2099170012", { status: AANVRAAG, beginStraat: "Proefwaag", kernStraten: ["Proefwaag"], langs: ["Proefwaag", "Kroegstraat", "Beurssteeg"] });
  const hand = { dossiers: Object.fromEntries(["ET2099170011", "ET2099170012"].map((d) => [d, fiche({ zekerheid: "zeker", naam: "Proeftocht van de Kring" })])) };
  const { items, tellers } = bouw({ feiten: [goed, lus], hand });
  assert.equal(tellers.samengevoegd, 1);
  assert.equal(items.length, 1);
  const [p] = items;
  assert.equal(p.externalId, "ET2099170011");
  assert.deepEqual(p.ookDossiers, ["ET2099170012"]);
  assert.equal(p.nietGoedgekeurd, undefined, "één goedgekeurd dossier: het evenement gaat door");
  assert.deepEqual(p.nietGoedgekeurdStraten, ["Kroegstraat", "Beurssteeg"], "alleen de straten die alleen de aanvraag raakt");
  assert.equal(p.stratenVolledig, true);
  const doc = sourceDocument("district-asign-evenementen", { retrievedAt: RETRIEVED, fetchStatus: "ok", contentVersion: null, items });
  assert.deepEqual(validateSourceDocument(doc, { expectedSourceId: "district-asign-evenementen" }), []);
  // De feed draagt beide velden; de straatpagina toont het label per straat.
  const { feed } = buildFeed({ status: { generatedAt: RETRIEVED, classificationAsOf: VANDAAG, sources: [] }, documents: [doc] }, []);
  const f = feed.items[0];
  assert.deepEqual([f.ookDossiers, f.nietGoedgekeurdStraten, f.nietGoedgekeurd], [["ET2099170012"], ["Kroegstraat", "Beurssteeg"], undefined]);
  assert.equal(pc.nietGoedgekeurdOp(f, "Kroegstraat"), true);
  assert.equal(pc.nietGoedgekeurdOp(f, "Proefplein"), false);
  assert.equal(pc.nietGoedgekeurdOp(f, ""), false, "zonder straat (een wijk): zoals de lijst");
  // Een ongeldige lijst (een straat die niet in straten staat) haalt de validatie niet.
  const fout = sourceDocument("district-asign-evenementen", { retrievedAt: RETRIEVED, fetchStatus: "ok", contentVersion: null, items: [{ ...items[0], nietGoedgekeurdStraten: ["Verzonnenstraat"] }] });
  assert.ok(validateSourceDocument(fout, { expectedSourceId: "district-asign-evenementen" }).some((x) => /nietGoedgekeurdStraten/.test(x)));
});

test("1. de plekpagina: alleen een volledige lijst (stratenVolledig) telt; één kaart per evenement, ook voor het partnerdossier", () => {
  const nieuw = { sourceId: "district-asign-evenementen", externalId: "ET2099170011", info: "Ook dossier ET2099170012.", ookDossiers: ["ET2099170012"], straten: ["Proefplein", "Kroegstraat"], stratenVolledig: true, date: "2026-10-20", id: "asign-ev-et2099170011-2026-10-20" };
  assert.deepEqual(pc.stratenVanAgendapunt(nieuw), ["Proefplein", "Kroegstraat"]);
  assert.deepEqual(pc.dossiersVanAgendapunt(nieuw), ["ET2099170011", "ET2099170012"]);
  // Een bronbestand van oudere code (samengevoegd op een gegokte titel, zonder stratenVolledig): geen lijst.
  const oud = { ...nieuw, ookDossiers: undefined, stratenVolledig: undefined };
  assert.deepEqual(pc.stratenVanAgendapunt(oud), []);
  assert.deepEqual(pc.dossiersVanAgendapunt(oud), ["ET2099170011", "ET2099170012"], "uit de zin 'Ook dossier ...'");
  // De kaart van het partnerdossier staat al in de straat: het agendapunt valt weg en gaat mee met die kaart.
  const agenda = [{ source: "agenda", uid: `agenda:${nieuw.id}`, item: nieuw }];
  const live = [{ uid: "publicSpace:dossier:ET2099170012", id: "ET2099170012", source: "publicSpace" }];
  const een = pc.eenKaartPerDossier(agenda, live);
  assert.deepEqual(een.agenda, []);
  assert.equal(een.live[0].agendaPunt, nieuw);
});

// ---------- 2. reuzenvlak ----------

const vierkant = ([x, y], d) => [[[x - d, y - d], [x + d, y - d], [x + d, y + d], [x - d, y + d], [x - d, y - d]]];
const MIDDEN = [4.4019, 51.2201];
// Een "Evenement Inname" van 13,3 km² over bijna heel het centrum (zoals ET2025007162, bbox 4,356-4,448 /
// 51,191-51,249), met het middelpunt aan het Proefplein, en een verkeersvrije zone in de Proefdokstraat.
const reus = { attributes: { dossierNummer: "ET2099170021", dossierStatus: "aanvraag_toegewezen", faseNaam: "Evenement", faseStartDatum: Date.UTC(2026, 9, 18), faseEindDatum: Date.UTC(2026, 9, 18), innameTypeNaam: "Inname", innameBeschrijving: "", Shape_Area: 13_284_944 },
  geometry: { rings: [[[4.356, 51.191], [4.448, 51.191], [4.448, 51.249], [4.356, 51.249], [4.356, 51.191]]] } };
const zone = { attributes: { ...reus.attributes, innameTypeNaam: "Verkeersvrije Zone", Shape_Area: 900 }, geometry: { rings: vierkant([4.405, 51.235], 0.0002) } };
const straatBij = (p) => (Math.abs(p[0] - MIDDEN[0]) < 0.001 && Math.abs(p[1] - MIDDEN[1]) < 0.001 ? "Proefplein" : Math.abs(p[0] - 4.405) < 0.001 && Math.abs(p[1] - 51.235) < 0.001 ? "Proefdokstraat" : "");

test("2. het middelpunt van een reuzenvlak (13,3 km²) is geen straat van het evenement; een plein van 2 ha wel", () => {
  assert.equal(reuzenVlak(reus.geometry.rings, 13_284_944), true);
  assert.equal(reuzenVlak(vierkant(MIDDEN, 0.0006), 20_000), false, "2 ha: het middelpunt is de plek (een plein, een deel van de Meir)");
  assert.ok(DREMPELS.middelpuntVlakM2 >= 100_000);
  const d = verrijk(dossiersUitAsign([reus, zone]).get("ET2099170021"), { straatBij });
  assert.ok(!d.kernStraten.includes("Proefplein"), d.kernStraten.join(", "));
  assert.deepEqual(d.kernStraten, ["Proefdokstraat"]);
  assert.equal(d.vorm.reuzenvlakken, 1);
  // Alleen het reuzenvlak: geen straat en geen wijk uit zijn middelpunt.
  const alleen = verrijk(dossiersUitAsign([reus]).get("ET2099170021"), { straatBij, wijkBijPunt: () => "Proefwijk", districten: [] });
  assert.equal(alleen.beginStraat, "");
  assert.deepEqual(alleen.kernStraten, []);
  // Een plein van 2 ha: het middelpunt blijft een plek.
  const plein = { attributes: { ...reus.attributes, Shape_Area: 20_000 }, geometry: { rings: vierkant(MIDDEN, 0.0006) } };
  assert.deepEqual(verrijk(dossiersUitAsign([plein]).get("ET2099170021"), { straatBij }).kernStraten, ["Proefplein"]);
  assert.deepEqual(vormVan([{ type: "Inname", geometry: reus.geometry, m2: 13_284_944 }]).kern, []);
});

// ---------- 3. afkappen ----------

test("3. bij het afkappen eerst de eigen plekken en de zone, dan het parcours (de Vlaamsekaai bij een loop van 400 straten)", () => {
  // Zoals ET2026000445: een parcours door veel straten en een verkeersvrije zone in vier, waaronder twee die het
  // parcours niet raakt. Vroeger viel de zone weg achter de 60 straten van het parcours.
  const langs = Array.from({ length: 400 }, (_, i) => `Parcoursstraat ${i + 1}`);
  const f = feit("ET2099170031", { beginStraat: "Timmerproefstraat", kernStraten: ["Timmerproefstraat", "Kaaiproef Noord"], langs: ["Timmerproefstraat", ...langs], zone: ["Gillisproefplaats", "Timmerproefstraat", "Kaaiproef Noord", "Kaaiproef Zuid"] });
  const straten = stratenVoorFeed(f);
  assert.equal(straten.length, MAX_STRATEN);
  for (const s of ["Timmerproefstraat", "Kaaiproef Noord", "Kaaiproef Zuid", "Gillisproefplaats"]) assert.ok(straten.slice(0, 4).includes(s), s);
  // Het agendapunt draagt zo de zone mee; de locatie (de eerste drie) blijft die van stratenVan.
  const [item] = bouw({ feiten: [{ ...f, langs: f.langs.slice(0, 120) }] }).items;
  assert.ok(item.straten.includes("Kaaiproef Zuid") && item.straten.includes("Gillisproefplaats"));
  assert.equal(item.straten.length, 123, "alle straten (de feed wordt gezipt)");
});

// ---------- 7. huisnummers ----------

test("7. geen huisnummer in een omschrijving: de privacyfilter (site/witte-lijst.js) laat alleen hele straatnamen en districten over, nooit een getal", () => {
  // Zonder straatas blijft er niets over: geen woord, geen getal, geen afstand of uur.
  for (const t of ["parkeerverbod tegenover nr 12", "parkeerverbod t.o.v. 34", "Parkeerverbod langs de parkeerstrook thv 5", "parkeerverbod Proefstraat 12-14",
    "wandelen 5 km · stop 2 stadspark", "parcours 10K", "12 fietsennadars"]) assert.equal(bruikbareBeschrijving(t), "", t);
  // Met de straatas blijft de straat, het nummer niet.
  const isStraat = (n) => ["Proefstraat", "Proefhelmstraat"].includes(n);
  for (const t of ["parkeerverbod Proefstraat van huisnummer 1 - 26", "parkeerverbod Proefstraat 12-14", "parkeerverbod Proefstraat van 4 tot"]) assert.equal(bruikbareBeschrijving(t, { isStraat }), "Proefstraat", t);
  assert.equal(bruikbareBeschrijving("parkeerverbod Proefhelmstraat tot 40", { isStraat }), "Proefhelmstraat");
  // Een bewaarde omschrijving (kaart-uitleg.json van een oudere verversing) gaat opnieuw door de filter.
  assert.equal(veiligeOmschrijving("Parkeerverbod in Straat: parkeerverbod t.o.v. 123"), "");
  assert.equal(veiligeOmschrijving("Parkeerverbod in Straat: parkeerverbod Proefstraat t.o.v. 123", { isStraat }), "Parkeerverbod in Straat: Proefstraat");
  // Het vangnet in de validatie keurt een bestand met ongefilterde tekst af (een nummer na een aanwijzer), en het bestand van nu
  // heeft er geen. Een straat met haar huisnummer mag (regel van de eigenaar van 26 oktober 2026).
  assert.ok(HUISNUMMER_IN_OMSCHRIJVING.test("Parkeerverbod in Straat: parkeerverbod t.o.v. 123"));
  assert.ok(!HUISNUMMER_IN_OMSCHRIJVING.test("Inname: Proefstraat 12"));
  assert.ok(!HUISNUMMER_IN_OMSCHRIJVING.test("Parcours: Wandelen 5 km · stop 2 stadspark"));
  const doc = JSON.parse(fs.readFileSync(path.join(root, "site", "sources", "kaart-uitleg.json"), "utf8"));
  assert.deepEqual(validateKaartUitleg(doc), []);
  const metNummer = { ...doc, evenementen: { ...doc.evenementen, ET2099170041: { start: "2026-10-20", eind: "2026-10-20", soort: "", soortBron: "", beschrijvingen: ["Parkeerverbod in Straat: parkeerverbod tegenover nr 7"], straten: [], kruist: [], stratenTekst: "", gekoppeld: null, kaart: [], kaartDeel: false } } };
  assert.ok(validateKaartUitleg(metNummer).some((f) => /ongefilterde tekst/.test(f)));
});

// ---------- 10. de vaagheidsratel ----------

const meting = (vaag, perPatroon = {}, meerDanEen = 0) => vatSamen([
  ...Array.from({ length: vaag }, (_, i) => ({ soort: "x", kern: true, patronen: Object.keys(perPatroon).filter((k) => i < perPatroon[k]), detail: { ontbreekt: i < meerDanEen ? 2 : 0, patronen: [] }, verboden: [] })),
  ...Array.from({ length: 20 - vaag }, () => ({ soort: "x", kern: false, patronen: [], detail: { ontbreekt: 0, patronen: [] }, verboden: [] })),
], (r) => r.soort);
const doc = (nu, vorige, extra = {}) => {
  const uit = { schema: "vaagheid/1", vandaag: VANDAAG, invoer: "aaaaaaaaaaaaaaaa", code: "cccccccccccccccc", agenda: nu, eventpaginas: nu, straten: nu };
  return { ...uit, vergelijking: vergelijkMet(uit, { ...vorige }), ...extra };
};

test("10. een stijging op dezelfde data (dus van de code) maakt vaagheid.json ongeldig, tenzij ze met een reden aanvaard is", () => {
  const oud = meting(5, { "uur-onbekend": 5 }), nu = meting(9, { "uur-onbekend": 9 });
  const vorige = { invoer: "aaaaaaaaaaaaaaaa", code: "bbbbbbbbbbbbbbbb", agenda: oud, eventpaginas: oud, straten: oud };
  const zelfde = doc(nu, vorige);
  assert.equal(zelfde.vergelijking.straten.ok, false);
  assert.deepEqual(zelfde.vergelijking.vorige, { invoer: "aaaaaaaaaaaaaaaa", code: "bbbbbbbbbbbbbbbb" });
  const fouten = validateVaagheid(zelfde);
  assert.ok(fouten.some((f) => /straten: uur-onbekend 5->9 gestegen op dezelfde data/.test(f)), fouten.join("\n"));
  // Met een reden aanvaard: geldig. Zonder (of te korte) reden: niet.
  const reden = "Agendapunten staan nu in al hun straten: meer kaarten, niet vagere";
  assert.deepEqual(validateVaagheid({ ...zelfde, aanvaard: aanvaardAlles(zelfde.vergelijking, reden) }), []);
  assert.ok(validateVaagheid({ ...zelfde, aanvaard: aanvaardAlles(zelfde.vergelijking, "kort") }).length);
  // Andere data (een verversing): een melding, geen fout.
  assert.deepEqual(validateVaagheid(doc(nu, { ...vorige, invoer: "dddddddddddddddd" })), []);
  // Wat de meter met --schrijf zou schrijven, wordt geweigerd (nietAanvaardeStijgingen): opnieuw meten maakt de
  // terugval dus geen nieuwe basislijn.
  assert.ok(nietAanvaardeStijgingen(zelfde).length);
  assert.equal(isAanvaard([{ waar: "straten", id: "uur-onbekend", van: 5, naar: 9, reden }], "straten", { id: "uur-onbekend", van: 5, naar: 10 }), false, "meer dan aanvaard: niet aanvaard");
});

test("10. twee metingen op dezelfde data (code van de basis, code van de tak): elke stijging telt, ook als de tak data wijzigt", () => {
  const basis = { agenda: meting(5), eventpaginas: meting(5), straten: meting(5, { "generieke-titel": 3 }, 2) };
  const tak = { agenda: meting(5), eventpaginas: meting(5), straten: meting(6, { "generieke-titel": 6 }, 4) };
  const s = stijgingenTegenBasis(tak, basis);
  assert.deepEqual(s.map((g) => `${g.waar}:${g.id}:${g.van}->${g.naar}:${g.aanvaard}`), ["straten:generieke-titel:3->6:false", "straten:detail:meer-dan-een-ontbreekt:2->4:false"]);
  const aanvaard = [{ waar: "straten", id: "generieke-titel", van: 3, naar: 6, reden: "Bewust: een eerlijkere titel die zegt wat er vaststaat" }];
  assert.deepEqual(stijgingenTegenBasis(tak, basis, aanvaard).map((g) => g.aanvaard), [true, false]);
  assert.deepEqual(stijgingenTegenBasis(basis, basis), []);
});

test("10. het opgeslagen vaagheid.json is geldig en noemt de code en de vorige meting", () => {
  const opgeslagen = JSON.parse(fs.readFileSync(path.join(root, "site", "sources", "vaagheid.json"), "utf8"));
  assert.deepEqual(validateVaagheid(opgeslagen), []);
  assert.match(String(opgeslagen.code), /^[0-9a-f]{16}$/);
  assert.ok(opgeslagen.vergelijking?.vorige && "invoer" in opgeslagen.vergelijking.vorige, "de vergelijking noemt de invoer van de vorige meting");
  // De CI-stap bestaat en draait op een GitHub-runner, nooit op de self-hosted Mac.
  const ci = fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
  assert.match(ci, /scripts\/vaagheid-tegen-basis\.mjs --basis/);
  assert.doesNotMatch(ci, /runs-on:[^\n]*self-hosted/);
});
