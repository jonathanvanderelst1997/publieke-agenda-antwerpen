// Nakijkronde van 13 oktober 2026 (samenvoeging van A, B en C): geen kaart mag minder concrete feiten tonen dan vroeger,
// en een kaart die alles uit één evenementendossier haalt, zegt precies welke bron wat niet geeft. Verzonnen proefdata.
import test from "node:test";
import assert from "node:assert/strict";

import { evenementFeiten, evenementKaartje, soortVanWerk, werkFeiten } from "../site/kaart-uitleg.js";
import { eenKaartPerDossier, publicSpaceEntries, samenWerven, stratenVanAgendapunt, werkEntries } from "../site/place-core.js";
import { oudeTekstBijwerken } from "../lib/asign-evenementen-agenda.mjs";
import { nietGoedgekeurd, stratenUitFiche } from "../scripts/build-sources.mjs";
import { validateKaartUitleg } from "../lib/kaart-uitleg-validatie.mjs";

const VANDAAG = "2099-03-01";
const straat = (name) => ({ id: name, name, postcode: "2060" });
const PROEF = straat("Proefstraat"), ANDER = straat("Anderestraat");
const werk = (gipodId, dossier, extra = {}) => ({
  gipodId, ...(dossier ? { dossier } : {}), title: "Werk in openbaar domein", owner: "Stad Antwerpen - Stadsontwikkeling", ownerGroup: "Stad Antwerpen",
  status: "In uitvoering", start: "2099-02-01T06:00:00Z", end: "2099-06-30T16:00:00Z", workTypes: [], occupancyTypes: ["Wegeniswerken"], sourceUrls: [],
  point: [4.43, 51.23], streets: [PROEF], ...extra,
});
const fase = (dossier, nr, van, tot, { werfzone = [PROEF], omleiding = [], kind = "Werfzone" } = {}) => ({
  id: `sgw:${dossier}|${nr}`, kind: "sgw", kindLabel: kind, title: kind, location: "", reference: dossier, detail: `Fase ${nr}`, status: "vergund",
  start: van, end: tot, streets: [...werfzone, ...omleiding], werfzoneStreets: werfzone, omleidingStreets: omleiding,
});
const verbod = (ref, van, tot, { status = "Goedgekeurd", plek = PROEF } = {}) => ({
  id: `parking:${ref}|1`, kind: "parking", kindLabel: "Parkeerverbod", title: "Melding ikv werfsignalisaties", reason: "Melding ikv werfsignalisaties",
  location: `${plek.name}, 2060 Antwerpen`, start: van, end: tot, status, reference: ref, detail: "", startTime: "07:00", endTime: "17:00", weekdaysOnly: false, streets: [plek],
});
const leegWerk = (dossier, fasen, extra = {}) => ({ dossier, soort: "Wegenwerken", soortBron: "soort inname in GIPOD", omschrijving: "", opdrachtgever: "Stad Antwerpen - Stadsontwikkeling", straten: ["Proefstraat"], gevolgen: [], huisnummers: "", huisnummerBron: "", bijgewerkt: "", fasen, ...extra });
const bouw = ({ works = [], rows = [], uitleg = null, straatNaam = PROEF.name, alle = rows }) => samenWerven(
  [...werkEntries(works, { vandaag: VANDAAG, uitleg }), ...publicSpaceEntries(rows, { vandaag: VANDAAG, alle, uitleg, straat: straatNaam })],
  { uitleg, straat: straatNaam, vandaag: VANDAAG, alle },
);

test("werfkaart: de soort inname van GIPOD blijft (Wegenwerken), en een soort uit de fasen noemt ze erbij", () => {
  // Alleen een genummerde fase: de werfkaart heet zoals de losse werkkaart vroeger ("Wegenwerken"), niet "Werf".
  const uitleg = { werken: { 801: leegWerk("GW2099-000801", [{ naam: "Fase 1", start: "2099-02-01", eind: "2099-06-30" }]) } };
  const [k] = bouw({ works: [werk(801, "GW2099-000801")], rows: [fase("GW2099-000801", 1, "2099-02-01T06:00:00Z", "2099-06-30T16:00:00Z")], uitleg }).filter((e) => e.source === "works");
  assert.match(k.title, /^Wegenwerken in de Proefstraat/);
  assert.match(Object.fromEntries(k.uitleg.regels).Wat, /^Wegenwerken, afgeleid uit de soort inname in GIPOD\./);
  assert.equal(k.onbekend, undefined, "de soort inname zegt wat de werf is: geen werf zonder doel");
  // Een soort uit de fasen ("stockagezone") gaat voor; de soort inname staat er nog bij.
  assert.deepEqual(soortVanWerk({ fasen: ["Fase 1 - stockagezone"], occupancyTypes: ["Wegeniswerken"] }), { soort: "Opslagzone (stockage)", bron: "fasen van de hinder in GIPOD", innameSoort: "Wegenwerken" });
  const f = werkFeiten(werk(802, "", { hindrance: { phases: [{ description: "Fase 1 - stockagezone", start: "2099-02-01", end: "2099-06-30", consequences: [] }] } }));
  assert.equal(f.innameSoort, "Wegenwerken");
  const uitleg2 = { werken: { 802: { ...leegWerk("GW2099-000802", [{ naam: "Fase 1 - stockagezone", start: "2099-02-01", eind: "2099-06-30" }]), innameSoort: "Wegenwerken" } } };
  const [k2] = bouw({ works: [werk(802, "GW2099-000802", { hindrance: { phases: [{ description: "Fase 1 - stockagezone", start: "2099-02-01", end: "2099-06-30", consequences: [] }] } })], rows: [fase("GW2099-000802", 1, "2099-02-01T06:00:00Z", "2099-06-30T16:00:00Z")], uitleg: uitleg2 }).filter((e) => e.source === "works");
  assert.match(k2.title, /^Opslagzone \(stockage\) in de Proefstraat/);
  assert.match(Object.fromEntries(k2.uitleg.regels).Wat, /De soort inname in GIPOD: wegenwerken\./);
  // De verversing mag het veld bewaren; de validatie kent het.
  const doc = (w) => ({ schemaVersion: 1, generatedAt: "2099-01-01T00:00:00Z", vanaf: "2099-01-01", tot: "2099-03-01", evenementen: {}, werken: { 1: w } });
  assert.deepEqual(validateKaartUitleg(doc({ ...leegWerk("GW2099-000001", []), innameSoort: "Wegenwerken" })), []);
  assert.deepEqual(validateKaartUitleg(doc({ ...leegWerk("GW2099-000001", []), innameSoort: 12 })), ["werken.1.innameSoort ongeldig"]);
});

test("werfkaart: wat de losse werfzone en parkeerverboden zeiden, blijft (status, straten), nooit de reden", () => {
  const uitleg = { werken: { 811: leegWerk("GW2099-000811", [{ naam: "Onderbouw", start: "2099-02-01", eind: "2099-06-30" }], { soort: "", soortBron: "" }) } };
  const rows = [
    fase("GW2099-000811", 1, "2099-02-01T06:00:00Z", "2099-06-30T16:00:00Z", { omleiding: [ANDER, straat("Derdestraat"), straat("Vierdestraat")], kind: "Omleiding + Werfzone" }),
    verbod("2099-000811", "2099-02-01T00:00:00.000Z", "2099-06-30T00:00:00.000Z", { status: "In effect" }),
  ];
  const [k] = bouw({ works: [werk(811, "GW2099-000811", { occupancyTypes: ["Andere"] })], rows, uitleg }).filter((e) => e.source === "works");
  const regels = Object.fromEntries(k.uitleg.regels);
  assert.match(regels.Werfzone, /^De werfzone ligt in je straat; het verkeer wordt omgeleid · .* · status in A-Sign: vergund door de stad · A-Sign, dossier GW2099-000811$/);
  assert.match(regels.Parkeerverbod, /\(2099-000811, van kracht\)\. Zelfde straat en dezelfde dagen als een fase van de werfzone/);
  // Nooit de reden (besluit van 18 oktober 2026): de reden telt alleen intern, om het parkeerverbod bij de werf te hangen.
  // (De ruwe rijen in `item` en `werfParkeer` zijn intern; wat de kaart toont, staat in titel, samenvatting en uitleg.)
  assert.doesNotMatch(JSON.stringify([k.title, k.summary, k.info, k.uitleg, k.regels]), /[Rr]eden|werfsignalisatie|in het kader van/);
  // Alle straten van de losse kaarten (werk, werfzone, omleiding), ingeklapt zoals bij de losse werfzone.
  assert.deepEqual(k.straten, ["Anderestraat", "Derdestraat", "Proefstraat", "Vierdestraat"]);
  assert.match(k.uitleg.stratenNoot, /werfzone en de omleiding/);
});

test("werfzone: de fasen die de straat niet raken, blijven genoemd", () => {
  // De straat ligt in de fasen 1 en 3; fase 2 (een dag betonstort) raakt ze niet. Begin en einde zijn gelijk.
  const rows = [
    fase("GW2099-000821", 1, "2099-02-01T06:00:00Z", "2099-03-31T16:00:00Z"),
    fase("GW2099-000821", 2, "2099-02-16T06:00:00Z", "2099-02-16T16:00:00Z", { werfzone: [ANDER] }),
    fase("GW2099-000821", 3, "2099-04-01T06:00:00Z", "2099-06-30T16:00:00Z"),
  ];
  const [k] = publicSpaceEntries(rows.filter((r) => r.werfzoneStreets.some((s) => s.name === PROEF.name)), { vandaag: VANDAAG, alle: rows, straat: PROEF.name });
  const regels = Object.fromEntries(k.regels);
  assert.equal(regels["Andere fasen van de werfzone"], "16 feb (niet in je straat)");
});

test("bewaarde omschrijvingen: een plek met twee straatnamen blijft met de straatas (isStraat)", () => {
  const rij = { id: "iod:ET2099000901|EVENT|1", kind: "iod", title: "Inname", innameType: "Inname", reference: "ET2099000901", status: "aanvraag_goedgekeurd", start: "2099-01-01T00:00:00.000Z", end: "2099-12-31T00:00:00.000Z", phase: "Evenement", dossierType: "ETL", streets: [PROEF] };
  const uitleg = { werken: {}, evenementen: { ET2099000901: { start: "2099-01-01", eind: "2099-12-31", soort: "", soortBron: "", beschrijvingen: ["Inname: Lodewijk Proeflei - Van Voorbeeldlei"], straten: ["Proefstraat"] } } };
  const zonder = publicSpaceEntries([rij], { vandaag: VANDAAG, uitleg, straat: PROEF.name })[0];
  const met = publicSpaceEntries([rij], { vandaag: VANDAAG, uitleg, straat: PROEF.name, isStraat: (n) => ["Lodewijk Proeflei", "Van Voorbeeldlei"].includes(n) })[0];
  assert.deepEqual(zonder.uitleg.beschrijvingen, [], "zonder straatas: weg (de filter kan geen persoonsnaam uitsluiten)");
  assert.deepEqual(met.uitleg.beschrijvingen, ["Inname: Lodewijk Proeflei - Van Voorbeeldlei"]);
  // Met de straatas uit het live straatbestand (index.byName) ook.
  const index = { byName: new Map([["lodewijk proeflei", []], ["van voorbeeldlei", []]]) };
  assert.deepEqual(publicSpaceEntries([rij], { vandaag: VANDAAG, uitleg, straat: PROEF.name, index })[0].uitleg.beschrijvingen, ["Inname: Lodewijk Proeflei - Van Voorbeeldlei"]);
});

test("één kaart per dossier: alle agendapunten gaan mee, en de stand uit het agendapunt blijft op de kaart", () => {
  const punt = (dag) => ({ uid: `agenda:asign-ev-et2099000911-${dag}`, source: "agenda", item: { id: `asign-ev-et2099000911-${dag}`, externalId: "ET2099000911", sourceId: "district-asign-evenementen", date: dag, info: "Evenementendossier ET2099000911 van de stad (A-Sign), laatst gewijzigd op 3 februari 2099: aanvraag goedgekeurd." } });
  const kaart = { uid: "publicSpace:dossier:ET2099000911", id: "ET2099000911", source: "publicSpace", uitleg: { regels: [["Referentie", "Dossier ET2099000911"]] } };
  const { agenda, live } = eenKaartPerDossier([punt("2099-03-27"), punt("2099-03-20")], [kaart]);
  assert.equal(agenda.length, 0);
  assert.deepEqual(live[0].agendaPunten.map((p) => p.date), ["2099-03-20", "2099-03-27"]);
  assert.equal(live[0].agendaPunt.date, "2099-03-20");
  assert.deepEqual(live[0].uitleg.regels.at(-1), ["Dossier in A-Sign", "laatst gewijzigd op 3 februari 2099: aanvraag goedgekeurd"]);
  // De organisatie uit het agendapunt (een besluit of een fiche) blijft, als de kaart ze niet al zo noemt.
  const metOrg = { ...punt("2099-03-20"), item: { ...punt("2099-03-20").item, info: `Organisatie: Proefbedrijf nv. ${punt("2099-03-20").item.info}` } };
  const kaartMetOrg = { ...kaart, uitleg: { regels: [], kern: [["Wat", "Een loop. Organisator: Proefbedrijf."]] } };
  assert.deepEqual(eenKaartPerDossier([metOrg], [kaartMetOrg]).live[0].uitleg.regels.at(-1), ["Organisatie volgens het agendapunt", "Proefbedrijf nv"]);
  const kaartAl = { ...kaart, uitleg: { regels: [], kern: [["Wat", "Een loop. Organisator: Proefbedrijf nv."]] } };
  assert.ok(!eenKaartPerDossier([metOrg], [kaartAl]).live[0].uitleg.regels.some(([k]) => k === "Organisatie volgens het agendapunt"));
});

test("een ouder agendapunt krijgt de naam uit de handfiche; een aangekondigd evenement krijgt geen label", () => {
  const hand = { dossiers: { ET2099000921: { zekerheid: "zeker", naam: "Proefwinter", link: "https://www.voorbeeld.test/proefwinter" } } };
  const item = { externalId: "ET2099000921", sourceId: "district-asign-evenementen", title: "Evenement op het Proefplein", info: "Evenement van 4 december tot 3 januari. De stad publiceert bij dit dossier geen naam. Evenementendossier ET2099000921 van de stad (A-Sign): aanvraag nog niet goedgekeurd.", nietGoedgekeurd: true };
  const nu = oudeTekstBijwerken(item, { hand });
  assert.equal(nu.title, "Proefwinter");
  assert.match(nu.info, /Naam met de hand nagekeken bij een publieke bron\./);
  assert.doesNotMatch(nu.info, /geen naam/);
  assert.match(nu.info, /aanvraag nog niet goedgekeurd\.$/, "de stand van de inname blijft in de info");
  assert.equal(oudeTekstBijwerken(item).title, "Evenement op het Proefplein", "zonder fiche: zoals vroeger");
  assert.equal(nietGoedgekeurd(item), true);
  assert.equal(nietGoedgekeurd(item, hand), false, "aangekondigd met een publieke link: geen label, wel .ics en Dit weekend");
  assert.equal(nietGoedgekeurd(item, { dossiers: { ET2099000921: { zekerheid: "waarschijnlijk", naam: "Proefwinter", link: "https://www.voorbeeld.test/x" } } }), true);
  // Een nieuwer bronbestand (met feiten) zegt het met het veld: de slotzin van het hoofddossier zet het label niet
  // als samenVoegen het veld weghaalde (een dossier van de groep is goedgekeurd).
  const samen = { ...item, nietGoedgekeurd: undefined, feiten: { dossier: "ET2099000921" }, info: "Evenementendossier ET2099000921 van de stad (A-Sign), laatst gewijzigd op 1 oktober 2099: aanvraag nog niet goedgekeurd. Ook dossier ET2099000922." };
  assert.equal(nietGoedgekeurd(samen), false);
  assert.equal(nietGoedgekeurd({ ...samen, feiten: undefined }), true, "een ouder bestand: de slotzin telt nog");
});

test("een evenementendossier zonder meer: één regel die zegt welke bron wat niet geeft; de plek in je straat bij meer plekken", () => {
  const rijen = [{ id: "iod:ET2099000931|EVENT|1", kind: "iod", title: "Inname", innameType: "Inname", reference: "ET2099000931", status: "aanvraag_goedgekeurd", start: "2099-03-20T00:00:00.000Z", end: "2099-03-20T00:00:00.000Z", phase: "Evenement", dossierType: "ETL", streets: [PROEF] }];
  const k = evenementKaartje(evenementFeiten(rijen), { vandaag: VANDAAG, straat: PROEF.name });
  assert.equal(k.ontbreektKop, "Niet in het evenementendossier ET2099000931 (A-Sign)");
  assert.deepEqual(k.ontbreekt, ["wat er gebeurt en de naam (geen omschrijving die dat zegt)", "uren (A-Sign geeft alleen de dag)", "organisator"]);
  assert.equal(k.voetnoot, "De stad gaf toelating voor deze inname (dossier ET2099000931). Bron: A-Sign, de databank van de stad.");
  // Meer plekken met een naam (de fiche van de herkenning): de plek in deze straat staat erbij.
  const id = { zekerheid: "onbekend", naam: "", soort: "", methode: "kaart", plekNamen: ["Voorbeeldplein", "Proefstraat", "Testkaai"], dagen: ["2099-01-01", "2099-12-31"] };
  const m = evenementKaartje(evenementFeiten(rijen), { vandaag: VANDAAG, straat: PROEF.name, identiteit: id });
  assert.match(Object.fromEntries(m.regels).Plekken, /^3 plekken met een naam in het dossier: Voorbeeldplein, Proefstraat, Testkaai\. In deze straat: “Proefstraat”\.$/);
});

test("een ouder agendapunt hangt ook aan de straten die de handfiche of het uur zelf noemt", () => {
  const hand = { dossiers: { ET2099000941: { zekerheid: "zeker", naam: "Proefwinter", waar: "Op het Proefplein en de Testkaai, met kramen tot aan de Voorbeeldstraat.", uren: "", watMerkJe: "", soort: "kerstmarkt" } } };
  const item = { externalId: "ET2099000941", sourceId: "district-asign-evenementen", title: "Proefwinter", location: "Proefplein, Anderestraat, Derdestraat en 3 andere straten",
    straten: ["Proefplein", "Anderestraat", "Derdestraat", "Testkaai", "Voorbeeldstraat", "Groteplaats"] };
  // Alleen wat de fiche noemt; een straat die alleen het oudere bestand noemt (Groteplaats), niet.
  assert.deepEqual(stratenUitFiche(item, hand), ["Proefplein", "Testkaai", "Voorbeeldstraat"]);
  assert.deepEqual(stratenUitFiche({ ...item, stratenVolledig: true }, hand), [], "een nieuwer bestand: de volledige lijst geldt al");
  assert.deepEqual(stratenUitFiche({ ...item, externalId: "ET2099000942", timeText: "kratstapelen op de Groenplaats van 12 tot 17 uur", straten: ["Kloosterstraat", "Groenplaats"] }, hand), ["Groenplaats"]);
  assert.deepEqual(stratenUitFiche({ ...item, externalId: "ET2099000943" }, hand), [], "geen fiche en geen uur: niets");
  // De plekpagina: de straten uit de locatie plus wat de fiche noemt; nooit de rest van de oudere lijst.
  const feed = { ...item, stratenBevestigd: stratenUitFiche(item, hand) };
  assert.deepEqual(stratenVanAgendapunt(feed).sort(), ["Anderestraat", "Derdestraat", "Proefplein", "Testkaai", "Voorbeeldstraat"]);
  assert.deepEqual(stratenVanAgendapunt(item), [], "zonder bevestigde straten: zoals vroeger, alleen de locatie");
  assert.deepEqual(stratenVanAgendapunt({ ...item, stratenVolledig: true }).length, 6);
});
