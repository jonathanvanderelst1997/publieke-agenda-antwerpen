// Precisie van de automatische parcoursherkenning (lib/parcours-herkenning.mjs): realistische
// agendapunten en dossiers die vroeger een verkeerde naam als 'zeker' gaven (nakijkronde op #144).
// Verzonnen kandidaten en dossiers, geen privépersonen. Elke toets stelt wat VEILIG is: geen verkeerde
// naam als 'zeker', en geen naam die botst. Geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as L from "../lib/parcours-herkenning.mjs";
import * as H from "./helpers/parcours-herkenning-evaluatie.mjs";

const WT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const F = H.laadFixtures(WT);
const VANDAAG = H.VANDAAG;

const ms = (dag) => Date.UTC(+dag.slice(0, 4), +dag.slice(5, 7) - 1, +dag.slice(8, 10), 10); // overdag, altijd dezelfde dag in Brussel
// Een verzonnen dossier: lijnen (laag 23, Parcours) en/of vlakken (laag 22), één dag of meer.
function nepDossier(nr, { dag, eind = dag, lijnen = [], vlakken = [], beschrijving = "", status = "aanvraag_goedgekeurd", type = "Parcours" }) {
  const attrs = (extra) => ({ dossierNummer: nr, dossierStatus: status, faseNaam: "Evenement", faseStartDatum: ms(dag), faseEindDatum: ms(eind), innameTypeNaam: type, innameBeschrijving: beschrijving, last_edited_date: Date.UTC(2026, 8, 1), ...extra });
  const feats = [
    ...lijnen.map((l) => ({ attributes: attrs(), geometry: { paths: [l] } })),
    ...vlakken.map((r) => ({ attributes: attrs({ innameTypeNaam: "Inname" }), geometry: { rings: [r] } })),
  ];
  const d = L.dossiersUitAsign(feats).get(nr);
  return d ? L.verrijk(d, { districten: F.districten }) : null;
}
// Kopie van de geometrie van een bestaand dossier, met een ander nummer, een andere dag en omschrijving.
function kloon(bron, nr, { dag, beschrijving = "", status }) {
  const fs = F.asign.features.filter((f) => f.attributes.dossierNummer === bron);
  const verschuif = dag ? ms(dag) - Math.min(...fs.filter((f) => f.attributes.faseNaam === "Evenement").map((f) => f.attributes.faseStartDatum)) : 0;
  const nep = fs.map((f) => ({ ...f, attributes: { ...f.attributes, dossierNummer: nr, dossierStatus: status || f.attributes.dossierStatus, faseStartDatum: f.attributes.faseStartDatum + verschuif, faseEindDatum: f.attributes.faseEindDatum + verschuif, innameBeschrijving: beschrijving } }));
  return L.verrijk(L.dossiersUitAsign(nep).get(nr), { districten: F.districten });
}
function bouw({ verberg = [], extraDossiers = [], kandidaten = F.kandidaten, zonder = () => false, bibliotheek = [] } = {}) {
  const hand = { ...F.hand, dossiers: Object.fromEntries(Object.entries(F.hand.dossiers).filter(([k]) => !verberg.includes(k))) };
  const dossiers = [...F.dossiers.map((d) => ({ ...d })), ...extraDossiers];
  return L.bouwHerkenning({ dossiers, hand, bibliotheek, kandidaten: kandidaten.filter((k) => !zonder(k)), historiek: F.historiek, charter: F.charter, vandaag: VANDAAG }).dossiers;
}
const org = (titel, dag, punt, extra = {}) => ({ titel, dag, eind: dag, tijd: "om 20 uur", locatie: "Voorbeeldcafé", link: "https://voorbeeldkring.example/agenda", bron: "organisator", bronLabel: "agenda van Voorbeeldkring (studentenvereniging)", organisator: "Voorbeeldkring (studentenvereniging)", punt, puntPrecisie: "adres", district: "", postcodes: [], ...extra });
const kal = (titel, dag, punt, extra = {}) => ({ titel, dag, eind: dag, tijd: "om 19 uur", locatie: "Voorbeeldzaal", link: "https://www.antwerpen.be/nl/overzicht/voorbeeld-activiteit", bron: "kalender", bronLabel: "districtskalender van district Antwerpen", punt, puntPrecisie: punt ? "adres" : "", district: "", postcodes: [], ...extra });
// Een punt op `meter` ten oosten van p.
const oost = (p, meter) => [p[0] + meter / (111_320 * Math.cos((51.2 * Math.PI) / 180)), p[1]];
const noord = (p, meter) => [p[0], p[1] + meter / 110_540];
const dossier = (id) => F.dossiers.find((d) => d.dossier === id);
const toon = (r) => `${r?.zekerheid} | ${r?.naam} | ${r?.soort} | ${r?.methode} | ${(r?.signalen || []).slice(0, 2).join(" // ")}`;

// ---------- 1. dezelfde dag en plek, twee activiteiten ----------

test("A1 Stadswaag 9/10: een cantus van een andere club in een café aan de Stadswaag maakt de dril niet 'zeker' Cantus", () => {
  const stadswaag = [4.40726, 51.22389];
  const r = bouw({ verberg: ["ET2026005653"], kandidaten: [...F.kandidaten, org("Cantus", "2026-10-09", oost(stadswaag, 30))] }).ET2026005653;
  assert.notEqual(r.zekerheid, "zeker", toon(r));
});

test("A2 Stadswaag 9/10 met twee aanvragen (verzonnen tweede dossier, zelfde plek): de cantus gaat naar geen van beide als 'zeker'", () => {
  const stadswaag = [4.40726, 51.22389];
  const tweede = kloon("ET2026005653", "ET2026999001", { dag: "2026-10-09", beschrijving: "" });
  const uit = bouw({ verberg: ["ET2026005653"], extraDossiers: [tweede], kandidaten: [...F.kandidaten, org("Cantus", "2026-10-09", oost(stadswaag, 30))] });
  assert.notEqual(uit.ET2026005653.zekerheid, "zeker");
  assert.notEqual(uit.ET2026999001.zekerheid, "zeker");
});

test("A3 Fort VI 27/10: een cantus aan het Officiersplein maakt de studentenstoet naar Fort VI niet 'zeker' Cantus", () => {
  const d = dossier("ET2026004329");
  const eind = d.vorm.eind || d.vorm.kern[0];
  const r = bouw({ verberg: ["ET2026004329"], kandidaten: [...F.kandidaten, org("Cantus", "2026-10-27", oost(eind, 40))] }).ET2026004329;
  assert.notEqual(r.zekerheid, "zeker", toon(r));
});

test("A4 een concert in een zaal naast een korte schoollus (zelfde dag) maakt de schoollus niet 'zeker' Jazzavond", () => {
  const d = dossier("ET2026004615");
  const p = noord(d.vorm.lijnen[0][Math.floor(d.vorm.lijnen[0].length / 2)], 50);
  const r = bouw({ verberg: ["ET2026004615"], kandidaten: [...F.kandidaten, kal("Jazzavond", "2026-11-20", p)] }).ET2026004615;
  assert.notEqual(r.zekerheid, "zeker", toon(r));
  assert.notEqual(r.naam, "Jazzavond", toon(r));
});

test("A5 een markt ('Boekenmarkt', via kandidaatUitAgenda) bij de start van een parkloop maakt de loop niet 'zeker' Boekenmarkt", () => {
  const d = dossier("ET2026005793");
  const p = oost(d.vorm.start || d.vorm.kern[0], 60);
  const k = L.kandidaatUitAgenda({ title: "Boekenmarkt", date: "2026-11-21", location: "Voorbeeldplein", infoUrl: "https://www.antwerpen.be/nl/overzicht/voorbeeld-boekenmarkt" }, { puntVan: () => ({ point: p, precision: "adres" }) });
  assert.ok(k, "de agenda laat een boekenmarkt door als kandidaat");
  const r = bouw({ verberg: ["ET2026005793"], kandidaten: [...F.kandidaten, k] }).ET2026005793;
  assert.notEqual(r.zekerheid, "zeker", toon(r));
});

test("A6 twee Halloween-activiteiten op dezelfde plek en dag tellen niet als één kandidaat", () => {
  const conova = [4.37308, 51.19068];
  const vlak = [[oost(noord(conova, -40), -40), oost(noord(conova, -40), 40), oost(noord(conova, 40), 40), oost(noord(conova, 40), -40), oost(noord(conova, -40), -40)]];
  const nep = nepDossier("ET2026999002", { dag: "2026-10-31", vlakken: vlak, beschrijving: "", type: "Inname" });
  const ks = [kal("Halloween", "2026-10-31", conova), kal("Halloweentocht voor gezinnen", "2026-10-31", oost(conova, 20))];
  const r = bouw({ extraDossiers: [nep], kandidaten: [...F.kandidaten.filter((k) => k.dag !== "2026-10-31"), ...ks] }).ET2026999002;
  assert.notEqual(r.zekerheid, "zeker", toon(r));
});

// ---------- 2. andere dag, andere activiteit op een vaste route ----------

test("B1 een kalenderitem op dezelfde plek maar de dag erna geeft geen naam", () => {
  const crit = F.kandidaten.find((k) => k.titel === "Linkeroever Criterium");
  const r = bouw({ verberg: ["ET2026003440"], kandidaten: [...F.kandidaten.filter((k) => k !== crit), { ...crit, dag: "2026-10-11", eind: "2026-10-11" }] }).ET2026003440;
  assert.notEqual(r.naam, "Linkeroever Criterium");
});

test("B2 patroon: volgend jaar een wielerwedstrijd op de marathonroute heet geen 'TREK Antwerp Marathon'", () => {
  const bibliotheek = L.bibliotheekUit(L.bijwerkenPatronen(null, { dossiers: F.dossiers, hand: F.hand, vandaag: VANDAAG }));
  const d = kloon("ET2026001217", "ET2027999003", { dag: "2027-10-17", beschrijving: "Parcours wielerwedstrijd" });
  const r = L.herkenDossier(d, { bibliotheek, charter: F.charter, vandaag: "2027-10-01" });
  assert.notEqual(r.naam, "TREK Antwerp Marathon", toon(r));
});

test("B3 patroon in hetzelfde jaar: een andere club op de route van de doop van Fabiant, een week later, heet geen 'Doop van Fabiant'", () => {
  const bibliotheek = L.bibliotheekUit(L.bijwerkenPatronen(null, { dossiers: F.dossiers, hand: F.hand, vandaag: VANDAAG }));
  const d = kloon("ET2026004447", "ET2026999004", { dag: "2026-10-27", beschrijving: "" });
  const r = L.herkenDossier(d, { bibliotheek, charter: F.charter, vandaag: VANDAAG });
  assert.ok(!/Fabiant/.test(r.naam), toon(r));
});

test("B4 patroon: een andere lus met hetzelfde begin en dezelfde lengte (andere straten) is niet 'dezelfde route'", () => {
  const bibliotheek = L.bibliotheekUit(L.bijwerkenPatronen(null, { dossiers: F.dossiers, hand: F.hand, vandaag: VANDAAG }));
  const crit = dossier("ET2026003440");
  const s = crit.vorm.start, len = crit.vorm.lengte;
  // Een vierkante lus naar het zuidwesten (de andere kant op), zelfde begin en einde, zelfde lengte.
  const z = len / 4;
  const lus = [s, oost(s, -z), noord(oost(s, -z), -z), noord(s, -z), s];
  const d = nepDossier("ET2027999005", { dag: "2027-10-09", lijnen: [lus], beschrijving: "jogging" });
  const r = L.herkenDossier(d, { bibliotheek, charter: F.charter, vandaag: "2027-10-01" });
  const ov = L.dekking(d.vorm, L.vormUitPatroon(bibliotheek.find((e) => e.dossier === "ET2026003440").vorm));
  assert.notEqual(r.naam, "Linkeroever Criterium", toon(r));
});

// ---------- 3. afstandsgrens, naam via een gewoon woord ----------

test("C1 net binnen de grens: een sponsorloop van een school op 240 m van de start maakt de parkloop niet 'zeker' Sponsorloop", () => {
  const d = dossier("ET2026005793");
  const p = oost(d.vorm.start, 240);
  const afst = L.afstandTot(d.vorm.index, p, 1000);
  const r = bouw({ verberg: ["ET2026005793"], kandidaten: [...F.kandidaten, kal("Sponsorloop Voorbeeldschool", "2026-11-21", p)] }).ET2026005793;
  assert.notEqual(r.zekerheid, "zeker", toon(r));
});

test("C2 naambewijs uit een districtsnaam: 'Familiedag in Merksem' is geen naam voor een jogging met 'Merksem' in het dossier", () => {
  const s = [4.4459, 51.2485]; // ergens in Merksem
  const lijn = [s, oost(s, 400), noord(oost(s, 400), 300), noord(s, 300)];
  const nep = nepDossier("ET2026999006", { dag: "2026-11-15", lijnen: [lijn], beschrijving: "Parcours jogging Merksem" });
  const k = kal("Familiedag in Merksem", "2026-11-15", null, { bronLabel: "nieuws van het district", locatie: "District Merksem, locatie via de officiële bron", district: "Merksem", link: "https://www.antwerpen.be/info/voorbeeld/familiedag" });
  const r = bouw({ extraDossiers: [nep], kandidaten: [...F.kandidaten, k] }).ET2026999006;
  assert.notEqual(r.zekerheid, "zeker", toon(r));
});

test("C3 naambewijs uit een straatnaam: 'Boekvoorstelling in de Meirstraat' is geen naam voor dossier ET2025005965 (Meirstraat, Theaterplein)", () => {
  const d = dossier("ET2025005965");
  const k = kal("Boekvoorstelling in de Meirstraat", d.dag.start, null, { locatie: "Antwerpen", bronLabel: "nieuws van district Antwerpen" });
  const r = bouw({ kandidaten: [...F.kandidaten, k] }).ET2025005965;
  assert.notEqual(r.zekerheid, "zeker", toon(r));
});

// ---------- 4. geweigerd, andere route dit jaar ----------

test("D1 geweigerde aanvraag: de cantus van het geweigerde dossier gaat niet als 'zeker' naar het andere dossier op die plek", () => {
  const stadswaag = [4.40726, 51.22389];
  const geweigerd = L.dossiersUitAsign(F.asign.features.filter((f) => f.attributes.dossierNummer === "ET2026005653").map((f) => ({ ...f, attributes: { ...f.attributes, dossierNummer: "ET2026999007", dossierStatus: "aanvraag_geweigerd", innameBeschrijving: "cantus" } })));
  assert.equal(geweigerd.size, 0, "een geweigerd dossier valt weg");
  const r = bouw({ verberg: ["ET2026005653"], kandidaten: [...F.kandidaten, org("Cantus", "2026-10-09", oost(stadswaag, 30))] }).ET2026005653;
  assert.notEqual(r.zekerheid, "zeker", toon(r));
});

test("D2 een evenement met dit jaar een andere route (verschoven, 50 % overlap) krijgt de naam van vorig jaar niet", () => {
  const bibliotheek = L.bibliotheekUit(L.bijwerkenPatronen(null, { dossiers: F.dossiers, hand: F.hand, vandaag: VANDAAG }));
  const crit = dossier("ET2026003440");
  const lijnen = crit.vorm.lijnen.map((l) => l.map((p) => oost(p, 300)));
  const d = nepDossier("ET2027999008", { dag: "2027-10-09", lijnen, beschrijving: "" });
  const r = L.herkenDossier(d, { bibliotheek, charter: F.charter, vandaag: "2027-10-01" });
  assert.notEqual(r.naam, "Linkeroever Criterium");
});

test("E1 twee kandidaten van dezelfde soort op dezelfde dag en plek: geen 'zeker'", () => {
  const crit = F.kandidaten.find((k) => k.titel === "Linkeroever Criterium");
  const r = bouw({ verberg: ["ET2026003440"], kandidaten: [...F.kandidaten, { ...crit, titel: "Kermiskoers voor nieuwelingen", punt: oost(crit.punt, 30) }] }).ET2026003440;
  assert.notEqual(r.zekerheid, "zeker");
});

// ---------- tweede ronde ----------

test("A3b Fort VI 27/10: een 'Doopstoet' aan het Officiersplein gaat niet als 'zeker' naar het cantusdossier (ET2026004570) terwijl de stoet ET2026004329 is", () => {
  const d = dossier("ET2026004329");
  const uit = bouw({ verberg: ["ET2026004329"], kandidaten: [...F.kandidaten, org("Doopstoet", "2026-10-27", oost(d.vorm.eind, 40))] });
  assert.notEqual(uit.ET2026004570.zekerheid, "zeker", toon(uit.ET2026004570));
});

test("B4b patroon: een andere route met hetzelfde begin, hetzelfde einde en dezelfde lengte is niet 'dezelfde route'", () => {
  const bibliotheek = L.bibliotheekUit(L.bijwerkenPatronen(null, { dossiers: F.dossiers, hand: F.hand, vandaag: VANDAAG }));
  const crit = dossier("ET2026003440");
  const s = crit.vorm.start, e = crit.vorm.eind, len = crit.vorm.lengte;
  const w = (len - L.meterTussen(s, e)) / 2;
  const lijn = [s, oost(s, -w), oost(e, -w), e];
  const d = nepDossier("ET2027999009", { dag: "2027-10-09", lijnen: [lijn], beschrijving: "jogging" });
  const pv = L.vormUitPatroon(bibliotheek.find((x) => x.dossier === "ET2026003440").vorm);
  const r = L.herkenDossier(d, { bibliotheek, charter: F.charter, vandaag: "2027-10-01" });
  assert.notEqual(r.naam, "Linkeroever Criterium", toon(r));
});

test("B5 patroon: een kerstmarkt een maand later op de plek van de shoppingdag heet geen 'AAAntwerp: shoppingdag Allure'", () => {
  const bibliotheek = L.bibliotheekUit(L.bijwerkenPatronen(null, { dossiers: F.dossiers, hand: F.hand, vandaag: VANDAAG }));
  const d = kloon("ET2026004648", "ET2026999010", { dag: "2026-11-14", beschrijving: "kerstmarkt" });
  const r = L.herkenDossier(d, { bibliotheek, charter: F.charter, vandaag: VANDAAG });
  assert.ok(!/AAAntwerp|Allure/.test(r.naam), toon(r));
});

test("C1b net binnen de grens (240 m van de schoollus, niet erop): een sponsortocht van een andere school wordt geen 'zeker'", () => {
  const d = dossier("ET2026004615");
  let p = null;
  const c = d.vorm.lijnen[0][Math.floor(d.vorm.lijnen[0].length / 2)];
  for (let r = 150; r < 800 && !p; r += 10) for (let hoek = 0; hoek < 360 && !p; hoek += 5) {
    const q = noord(oost(c, r * Math.cos((hoek * Math.PI) / 180)), r * Math.sin((hoek * Math.PI) / 180));
    const a = L.afstandTot(d.vorm.index, q, 1000);
    if (a >= 235 && a <= 245) p = q;
  }
  assert.ok(p, "geen punt gevonden");
  const r = bouw({ verberg: ["ET2026004615"], kandidaten: [...F.kandidaten, kal("Sponsortocht van de school De Voorbeeldboom", "2026-11-20", p)] }).ET2026004615;
  assert.notEqual(r.zekerheid, "zeker", toon(r));
});

test("F1 echte data: de verkeersvrije zone van marathonzondag (ET2025007162, 6 km breed) is geen studentenactiviteit", () => {
  const r = bouw({}).ET2025007162;
  const d = dossier("ET2025007162");
  assert.ok(!/student/.test(r.soort), toon(r));
});

test("C4 beginletters: 'Vintage Zomer Event' (VZE) is geen naam voor een dossier met 'vze' (verkeersvrije zone) in de omschrijving", () => {
  const k = kal("Vintage Zomer Event", "2026-10-18", null, { bronLabel: "nieuws van het district", locatie: "District Antwerpen, locatie via de officiële bron", district: "Antwerpen", link: "https://www.antwerpen.be/info/voorbeeld/vintage" });
  const r = bouw({ kandidaten: [...F.kandidaten, k] }).ET2025007162;
  assert.notEqual(r.zekerheid, "zeker", toon(r));
});

// ---------- losse regels ----------

test("soorten: een markt in een samenstelling (Boekenmarkt, jaarmarkt), maar niet een straat als de Vismarkt", () => {
  assert.equal(L.eersteSoort(["Boekenmarkt"]), "markt");
  assert.equal(L.eersteSoort(["jaarmarkt op het plein"]), "markt");
  assert.equal(L.eersteSoort(["Concert op de Vismarkt"]), "");
  assert.equal(L.eersteSoort(["Kermiskoers voor nieuwelingen"]), "wieler");
});

test("naambewijs: geen district, straat of A-Sign-afkorting; wel een eigen naam", () => {
  assert.equal(L.naamBewijs("Familiedag in Merksem", ["Parcours jogging Merksem"]), "");
  assert.equal(L.naamBewijs("Boekvoorstelling in de Meirstraat", ["Meirstraat Theaterplein"]), "");
  assert.equal(L.naamBewijs("Vintage Zomer Event", ["vze"]), "");
  assert.equal(L.naamBewijs("Feest in Brederode", ["opbouw brederode"], { gewoon: new Set(["brederode"]) }), "");
  assert.equal(L.naamBewijs("Ontdek de pracht van Muisbroek tijdens de EkeRun!", ["Ekerun 10 km"]), "ekerun");
  assert.equal(L.naamBewijs("De Jaak Schram Parkloop", ["opbouw JSP"]), "jsp");
});

test("één kandidaat uit twee bronnen alleen bij dezelfde titel (op een jaartal na), niet bij een gedeeld woord", () => {
  assert.ok(L.zelfdeActiviteit("Linkeroever Criterium", "Linkeroever Criterium 2026"));
  assert.ok(L.zelfdeActiviteit("Feest voor de Sint", "feest voor de sint"));
  assert.ok(!L.zelfdeActiviteit("Halloween", "Halloweentocht voor gezinnen"));
  assert.ok(!L.zelfdeActiviteit("Linkeroever Criterium", "Criterium voor nieuwelingen"));
});

test("evaluatie tegen de handfiches: een gedeeld soortwoord is niet dezelfde naam", () => {
  assert.ok(!H.zelfdeNaam("Cantus (Voorbeeldkring)", { naam: "Schachtenkoning cantus", soort: "" }));
  assert.ok(!H.zelfdeNaam("Halloween", { naam: "Halloweentocht voor gezinnen", soort: "" }));
  assert.ok(!H.zelfdeNaam("Familiedag in Merksem", { naam: "Griezeltocht (Halloween in Merksem)", soort: "" }));
  assert.ok(H.zelfdeNaam("D%p (Fabiant)", { naam: "Doop van Fabiant", soort: "" }));
  assert.ok(H.zelfdeNaam("Campustrail Multiversum", { naam: "Campus Trailrun en Kidsrun", soort: "" }));
  assert.ok(H.zelfdeNaam("Nationale Sluitingsprijs komt door Berendrecht", { naam: "Nationale Sluitingsprijs Putte-Kapellen", soort: "" }));
});

test("regels: een grote zone zonder parcours neemt geen soort over uit vorige jaren of het charter", () => {
  const d = dossier("ET2025007162");
  assert.ok(d.vorm.vlakken.some(L.grootVlak));
  const r = L.stapRegels(d, { historiek: F.historiek.ET2025007162 || [], charter: F.charter });
  assert.equal(r.zekerheid, "onbekend", JSON.stringify(r));
});
