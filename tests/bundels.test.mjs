// Bundelen wat leeg blijft (vaagheidsplan van 12 oktober 2026, stap 5): terrassen per straat, innames en werfzones
// zonder omschrijving, oude of lege aanvragen per straat in één ingeklapte regel, vermoedelijke studentenactiviteiten
// per dag; standaardzinnen één keer per sectie (onbekend-zinnen.js). Verzonnen proefdata.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { agendaEntry, bundelLijst, bundelSoort, groupForList, kaartSoort, lijstSleutel, lijstUniversum, periodRange, permitEntry, telPerSoort, terrasEntries, publicSpaceEntries } from "../site/place-core.js";
import { ONBEKEND_ZINNEN, onbekendZin } from "../site/onbekend-zinnen.js";
import { duidelijkeKaart } from "../site/permit-clarity.js";

const VANDAAG = "2099-03-01";
const straat = (name) => ({ id: name, name, postcode: "2000" });
const terras = (nr, type = "Terras binnen kern") => ({ id: `terrace:${nr}`, address: `Proefplein ${nr}`, terraceType: type, status: "Actief", streets: [straat("Proefplein")] });
const aanvraag = (id, extra = {}) => permitEntry({ id: `permit:${id}`, dossier: `2099${id}`, streets: [straat("Proefplein")], ...extra });
const inname = (dossier, dag, type = "Inname", extra = {}) => ({ id: `iod:${dossier}|1|1`, kind: "iod", kindLabel: "Inname openbaar domein", title: type, innameType: type, location: "", start: `${dag}T00:00:00.000Z`, end: `${dag}T00:00:00.000Z`, status: "aanvraag_goedgekeurd", reference: dossier, detail: "", phase: "Evenement", dossierType: "ETL", hindrance: "True", streets: [straat("Proefplein")], ...extra });
const werfzone = (dossier, van, tot) => ({ id: `sgw:${dossier}|1`, kind: "sgw", kindLabel: "Werfzone", title: "Werfzone", location: "", reference: dossier, detail: "Fase 1", status: "vergund", start: van, end: tot, streets: [straat("Proefplein")], werfzoneStreets: [straat("Proefplein")], omleidingStreets: [] });

test("terrassen: één regel per straat, de periodezin één keer, de adressen als getal gesorteerd", () => {
  const kaarten = terrasEntries([terras(10), terras(9), terras(2, "Uitstalling")]);
  const { losse, bundels } = bundelLijst(kaarten, { straat: "Proefplein", vandaag: VANDAAG });
  assert.equal(losse.length, 0);
  assert.equal(bundels.length, 1);
  const [b] = bundels;
  assert.equal(b.title, "2 terrassen en 1 uitstalling met vergunning");
  assert.equal(b.summary.match(/Een periode publiceert de stad niet/g).length, 1, "de periodezin één keer");
  assert.deepEqual(b.bundel.leden.map((l) => l.location), ["Proefplein 2", "Proefplein 9", "Proefplein 10"]);
  // De bundel telt als één kaart; de leden tellen als de bundel (kaart en legenda).
  assert.equal(kaartSoort(b), "vergunning");
  assert.ok(b.bundel.leden.every((l) => lijstSleutel(l) === b.uid));
  assert.equal(telPerSoort(lijstUniversum(kaarten, VANDAAG, { straat: "Proefplein" })).totaal, 1);
});

test("aanvragen zonder omschrijving of van twee jaar of ouder: één regel; niet tijdens een openbaar onderzoek", () => {
  const leeg = aanvraag("1");
  const oud = aanvraag("2", { project: "OMV_2096000001", inhoud: { titel: "Gevel aanpassen", leeg: false, wat: "Een gevel." } });
  const jong = aanvraag("3", { project: "OMV_2099000001", inhoud: { titel: "Gevel aanpassen", leeg: false, wat: "Een gevel." } });
  const vergund = aanvraag("4", { project: "OMV_2096000002", decision: "Vergund", inhoud: { titel: "Gevel aanpassen", leeg: false } });
  const onderzoek = aanvraag("5", { inzage: { toestand: "openbaar onderzoek", loopt: true } });
  assert.deepEqual([leeg, oud, jong, vergund, onderzoek].map((e) => bundelSoort(e, { vandaag: VANDAAG })), ["aanvragen", "aanvragen", "", "", ""]);
  const { losse, bundels } = bundelLijst([leeg, oud, jong, vergund, onderzoek], { straat: "Proefplein", vandaag: VANDAAG });
  assert.equal(losse.length, 3);
  assert.equal(bundels[0].title, "2 omgevingsaanvragen zonder omschrijving of van twee jaar of ouder");
  assert.match(bundels[0].summary, /geen omschrijving.*twee jaar of ouder zonder beslissing in de bron: of ze nog loopt, zegt de stadsbron niet\./);
});

test("innames zonder omschrijving en werfzones zonder doel: per straat één regel; een parcours of een inname met een soort niet", () => {
  const rows = [inname("ET2099000001", "2099-03-17"), inname("ET2099000002", "2099-03-18", "Parkeerverbod op Plein"), inname("ET2099000003", "2099-03-19", "Parcours"),
    inname("ET2099000004", "2099-03-20", "Inname", { description: "podium" })];
  const kaarten = publicSpaceEntries(rows, { vandaag: VANDAAG, straat: "Proefplein" });
  const soorten = Object.fromEntries(kaarten.map((k) => [k.id, bundelSoort(k)]));
  assert.equal(soorten.ET2099000001, "innames");
  assert.equal(soorten.ET2099000003, "", "een parcours door je straat blijft een eigen kaart");
  const zone = publicSpaceEntries([werfzone("GW2099-000001", "2099-03-02T06:00:00Z", "2099-03-30T16:00:00Z")], { vandaag: VANDAAG, straat: "Proefplein" });
  assert.equal(bundelSoort(zone[0]), "werfzones");
  const zone2 = publicSpaceEntries([werfzone("GW2099-000002", "2099-04-02T06:00:00Z", "2099-04-30T16:00:00Z")], { vandaag: VANDAAG, straat: "Proefplein" });
  const { losse, bundels } = bundelLijst([...kaarten, ...zone, ...zone2], { straat: "Proefplein", vandaag: VANDAAG });
  const innames = bundels.find((b) => b.bundel.soort === "innames");
  assert.match(innames.title, /^\d innames zonder omschrijving$/);
  assert.match(innames.summary, /zegt de stad niet\.$/);
  assert.equal(bundels.find((b) => b.bundel.soort === "werfzones").title, "2 werfzones of omleidingen zonder doel in de bron");
  // Eén lege kaart van een soort blijft een gewone kaart.
  const alleen = bundelLijst(zone, { straat: "Proefplein", vandaag: VANDAAG });
  assert.deepEqual([alleen.losse.length, alleen.bundels.length], [1, 0]);
  assert.ok(losse.some((k) => k.id === "ET2099000003"), "het parcours");
});

test("vermoedelijke studentenactiviteiten: één regel per dag; een zekere naam of soort niet", () => {
  const agendapunt = (id, dag, title) => ({ uid: `agenda:${id}`, id, source: "agenda", theme: "festival", group: "evenementen", title, start: dag, end: "", location: "Proefplein", item: { sourceId: "district-asign-evenementen", title } });
  const lijst = [
    agendapunt("a", "2099-03-10", "Vermoedelijk een studentenactiviteit op het Proefplein"),
    agendapunt("b", "2099-03-10", "Vermoedelijk een studentendoop in de Proefstraat"),
    agendapunt("c", "2099-03-11", "Vermoedelijk een studentenactiviteit op de Proefkaai"),
    agendapunt("d", "2099-03-10", "Studentenactiviteit op het Proefplein"),
    agendapunt("e", "2099-03-10", "Vermoedelijk een buurtfeest op het Proefplein"),
  ];
  const { losse, bundels } = bundelLijst(lijst, { vandaag: VANDAAG });
  // Ook één op een dag is de regel van die dag (één bundel per dag).
  assert.deepEqual(losse.map((e) => e.id).sort(), ["d", "e"]);
  assert.deepEqual(bundels.map((b) => [b.start, b.bundel.leden.length, b.title]), [["2099-03-10", 2, "2 vermoedelijke studentenactiviteiten"], ["2099-03-11", 1, "1 vermoedelijke studentenactiviteit"]]);
  assert.deepEqual(bundels[0].onbekend.map((o) => o.id), ["studenten-naam"]);
});

test("een meerdaagse vermoedelijke studentenactiviteit blijft tot haar laatste dag in de lijst, de tellers en op de kaart", () => {
  // Nakijkronde 12 oktober 2026: de bundel van de eerste dag had geen einde; vanaf dag 2 viel het lid weg.
  const punt = (id, dag, tot, title) => agendaEntry({ id, sourceId: "district-asign-evenementen", title, date: dag, endDate: tot, location: "Proefplein" }, "festival");
  const meer = punt("s-meer", "2099-03-12", "2099-03-14", "Vermoedelijk een studentenactiviteit op het Proefplein");
  const een = punt("s-een", "2099-03-12", null, "Vermoedelijk een studentendoop in de Proefstraat");
  // Een dossierkaart met opbouw de dag ervoor en afbraak de dag erna.
  const kaart = { uid: "publicSpace:dossier:ET2099000041", id: "ET2099000041", source: "publicSpace", theme: "publicSpace", group: "evenementen", title: "Vermoedelijk een studentendoop op de Proefkaai",
    start: "2099-03-12", end: "2099-03-14", innameStart: "2099-03-11", innameEind: "2099-03-15", location: "Proefkaai", losseDagen: [], item: { kind: "event", streets: [straat("Proefkaai")] }, uitleg: { watBron: "vermoeden", soortTekst: "studentendoop" } };
  const lijst = [meer, een, kaart];
  const { bundels } = bundelLijst(lijst, { vandaag: "2099-03-12" });
  // Eén regel voor de dag zelf, één voor wie van 12 tot 14 maart loopt.
  assert.deepEqual(bundels.map((b) => [b.start, b.end, b.bundel.leden.length]).sort(), [["2099-03-12", "", 1], ["2099-03-12", "2099-03-14", 2]]);
  const ledenOpDag = (vandaag) => {
    const universum = lijstUniversum(lijst, vandaag);
    const { losse, bundels: b } = bundelLijst(lijst, { vandaag });
    const { running } = groupForList([...losse, ...b.filter((x) => x.bundel.soort === "studenten")], { ...periodRange("alles", vandaag), today: vandaag });
    // Zoals meldKaartItems in place-view.js: een bundel tekent haar leden op de kaart.
    const leden = (l) => l.flatMap((e) => (e.bundel ? e.bundel.leden : [e])).map((e) => e.id).sort();
    return { universum: leden(universum), running: leden(running), tel: telPerSoort(universum).totaal };
  };
  // Op de tweede dag: het meerdaagse lid staat in de lijst (nu bezig), telt mee en staat op de kaart; het eendaagse niet meer.
  assert.deepEqual(ledenOpDag("2099-03-13"), { universum: ["ET2099000041", "s-meer"], running: ["ET2099000041", "s-meer"], tel: 1 });
  // Op de dag van de afbraak van het dossier: de bundel loopt nog (afbraak), tot de dag erna.
  assert.deepEqual(ledenOpDag("2099-03-15").running, ["ET2099000041", "s-meer"]);
  assert.deepEqual(ledenOpDag("2099-03-16").universum, []);
  // De dag van de opbouw: al bij "nu bezig".
  assert.deepEqual(ledenOpDag("2099-03-11").running, ["ET2099000041", "s-meer"]);
});

test("standaardzinnen één keer per sectie: een aanvraag draagt ze als veld, niet als regel", () => {
  const e = aanvraag("9", { project: "OMV_2099000009", inhoud: { titel: "Gevel aanpassen", leeg: false, wat: "Een gevel." } });
  assert.deepEqual(e.onbekend.map((o) => o.id), ["aanvragen-start", "aanvraag-ontvankelijk"]);
  const d = duidelijkeKaart(e, e.item, { vandaag: VANDAAG });
  assert.equal(d.regels.some(([k]) => k === "Start van de werken"), false);
  assert.doesNotMatch(d.samenvatting, /ontvankelijk/);
  // De plekpagina zet de sectiezin één keer boven de aanvragen en de evenementen (SECTIE_ZIN, place-view.js).
  const view = fs.readFileSync(new URL("../site/place-view.js", import.meta.url), "utf8");
  assert.match(view, /"evenement-uren": "evenementen-uren", "aanvragen-start": "aanvragen-start", "aanvraag-ontvankelijk": "aanvragen-ontvankelijk"/);
  for (const id of ["evenementen-uren", "aanvragen-start", "aanvragen-ontvankelijk"]) assert.equal(ONBEKEND_ZINNEN[id].waar, "sectie");
  assert.throws(() => onbekendZin("bestaat-niet"), /onbekende onbekend-zin/);
});
