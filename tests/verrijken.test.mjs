// Verrijken met wat al binnen is (vaagheidsplan van 12 oktober 2026, stap 7): plek en uur uit de tekst van een
// artikel, het evenement van een parkeerverbod voor een evenement (alleen bij precies één kandidaat), "ook gepland
// hier die dag" als context met bron, en de werklijst "vragen aan de stad". Verzonnen proefdata: dossiers ET2099...,
// straten als Proefplein, geen personen. Geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";

import { plekEnUurUitTekst, plekkenUitTekst, urenUitTekst } from "../lib/plek-uit-tekst.mjs";
import { vragenAanDeStad, vragenMarkdown } from "../lib/vragen-aan-de-stad.mjs";
import { agendaEntry, publicSpaceEntries, publicSpaceEntry, verrijkMetContext } from "../site/place-core.js";
import { vaagheidVanKaart } from "../lib/vaagheid.mjs";

const VANDAAG = "2099-03-01";
const straat = (name) => ({ id: name, name, postcode: "2000" });
const inname = (dossier, van, tot = van, extra = {}) => ({ id: `iod:${dossier}|1|1`, kind: "iod", kindLabel: "Inname openbaar domein", title: "Inname", innameType: "Inname", location: "", start: `${van}T00:00:00.000Z`, end: `${tot}T00:00:00.000Z`, status: "aanvraag_goedgekeurd", reference: dossier, detail: "", phase: "Evenement", dossierType: "ETL", hindrance: "True", streets: [straat("Proefplein")], ...extra });
const parkeer = (nr, dag, tot = dag, reden = "Aanvraag voor evenementen gesteund door de stad") => publicSpaceEntry({ id: `parking:2099-0000${nr}|1`, kind: "parking", kindLabel: "Parkeerverbod", title: reden, reason: reden, location: "Proefplein, 2000 Antwerpen", start: `${dag}T00:00:00.000Z`, end: `${tot}T00:00:00.000Z`, status: "Goedgekeurd", reference: `2099-0000${nr}`, startTime: "00:00", endTime: "23:59", streets: [straat("Proefplein")] });
const fiche = (naam) => ({ zekerheid: "zeker", naam, soort: "", organisator: "", uren: "", link: "", dagen: [], binnenDistrict: true });
const evenementen = (rows, identiteit = null) => publicSpaceEntries(rows, { vandaag: VANDAAG, straat: "Proefplein", identiteit });
const regel = (e, naam) => [...(e.regels || []), ...(e.uitleg?.regels || [])].find(([k]) => k === naam)?.[1] || "";

test("plek en uur uit de tekst van een artikel: alleen wat er letterlijk staat, na een voorzetsel van plaats", () => {
  assert.deepEqual(plekkenUitTekst("Een namiddag vol sportplezier in sporthal De Rode Loop."), ["Sporthal De Rode Loop"]);
  assert.deepEqual(plekkenUitTekst("Het binnenfort van Fort 8 wordt een doolhof."), ["Fort 8"]);
  assert.deepEqual(plekkenUitTekst("Wacht hem op en trek mee naar park Gravenhof voor de show."), ["Park Gravenhof"]);
  // Geen voorzetsel van plaats, geen naam, of een nummer van twee cijfers (een adres): niets.
  assert.deepEqual(plekkenUitTekst("Maak kennis met Academie Ekeren."), []);
  assert.deepEqual(plekkenUitTekst("Op zaterdag wordt het fort van Merksem omgetoverd."), []);
  assert.deepEqual(plekkenUitTekst("Kom naar de bibliotheek."), []);
  assert.deepEqual(plekkenUitTekst("Afspraak in zaal Proef 12."), []);
  assert.deepEqual(urenUitTekst("Open van 13 tot 16.30 uur."), { begin: "13:00", einde: "16:30", tekst: "van 13 tot 16.30 uur" });
  assert.equal(urenUitTekst("van 9 tot 12 uur en van 14 tot 17 uur"), null, "twee keer: niet kiezen");
  const item = { title: "Fun Games", info: "Speelplezier in sporthal De Rode Loop, van 13 tot 16 uur.", location: "District Merksem, locatie via de officiële bron", timeSlot: "Info", timeText: "" };
  const nu = plekEnUurUitTekst(item, "stad-districten");
  assert.equal(nu.location, "Sporthal De Rode Loop, District Merksem (plaats volgens het bericht)");
  assert.deepEqual([nu.timeSlot, nu.timeText], ["13:00", "van 13 tot 16 uur (volgens het bericht)"]);
  // Een item met een eigen plek, of uit UiT: ongemoeid.
  assert.equal(plekEnUurUitTekst({ ...item, location: "Proefplein 1" }, "stad-districten").location, "Proefplein 1");
  assert.equal(plekEnUurUitTekst(item, "stad-uit"), item);
});

// Een agendapunt uit de evenementendossiers zoals de feed het heeft (lib/asign-evenementen-agenda.mjs): de naam en waar
// die vandaan komt staan in de info. Zo kent elke pagina hetzelfde evenement (agendaItems: de hele agenda).
const dossierPunt = (dossier, dag, title, { tot = null, straten = ["Proefplein"], info = "Naam met de hand nagekeken bij een publieke bron.", category = "sport" } = {}) => ({
  id: `asign-ev-${dossier.toLowerCase()}-${dag}`, externalId: dossier, sourceId: "district-asign-evenementen", title, date: dag, endDate: tot, location: straten.join(", "),
  straten, stratenVolledig: true, info: `${info} Evenementendossier ${dossier} van de stad (A-Sign).`, category,
});
const markt = (dag, plein = "Proefplein") => ({ id: `markt-proef-${dag}`, sourceId: "stad-markten", title: `Gemengde markt ${plein}`, date: dag, timeSlot: "08:00", location: `${plein}, 2060 Antwerpen`, category: "markets" });

// Besluit van de eigenaar (18 oktober 2026): de titel van een parkeerverbod is altijd "Parkeerverbod", nooit waarvoor
// (vroeger "Parkeerverbod voor een evenement" of "Parkeerverbod, vermoedelijk voor ..."). De reden van A-Sign telt alleen
// intern: is er precies één evenement, dan zegt de regel "Evenement" welk, met de bron, en noemt de evenementkaart het
// parkeerverbod. "Ook gepland hier die dag" staat niet bij een parkeerverbod: die regel stond alleen bij de reden
// "evenement" en zou zo de reden verraden. De beslissing zelf (één kandidaat, geen markt, elke dag) blijft dezelfde.
test("parkeerverbod met de reden evenement: precies één evenement in de straat op die dag staat in de regel; twee niet; de titel blijft 'Parkeerverbod'", () => {
  const ev = evenementen([inname("ET2099000001", "2099-03-14")], { dossiers: { ET2099000001: fiche("Proefloop") } });
  const agendaItems = [dossierPunt("ET2099000001", "2099-03-14", "Proefloop")];
  const p = parkeer(1, "2099-03-14");
  assert.equal(p.title, "Parkeerverbod");
  const [pn, en] = verrijkMetContext([p, ...ev], { straat: "Proefplein", vandaag: VANDAAG, agendaItems });
  assert.equal(pn.title, "Parkeerverbod");
  assert.match(regel(pn, "Evenement"), /^Proefloop \(A-Sign, dossier ET2099000001\): het enige evenement in deze straat op die dag\. A-Sign zet bij een parkeerverbod geen dossiernummer\.$/);
  // Geen vage kaart: "Parkeerverbod" met waar en wanneer is de hele kaart.
  assert.deepEqual(vaagheidVanKaart({ titel: pn.title }).patronen, []);
  assert.equal(vaagheidVanKaart({ titel: pn.title }).kern, false);
  // De evenementkaart: het parkeerverbod onder "Wat merk je", waar en wanneer: de dagen en de uren, zoals de werfkaart
  // (nakijkronde van 18 oktober 2026: hier stonden alleen de dagen).
  assert.match(en.uitleg.kern.find(([k]) => k === "Wat merk je")[1], /Ook een parkeerverbod in de laag parkeerverboden van A-Sign: Proefplein, 2000 Antwerpen: 14 mrt, hele dag \(2099-00001\)\./);
  const metUren = { ...p, item: { ...p.item, startTime: "08:00", endTime: "18:00", weekdaysOnly: true } };
  const [, eu] = verrijkMetContext([metUren, ...ev], { straat: "Proefplein", vandaag: VANDAAG, agendaItems });
  assert.match(eu.uitleg.kern.find(([k]) => k === "Wat merk je")[1], /A-Sign: Proefplein, 2000 Antwerpen: 14 mrt, van 8\.00 tot 18\.00 uur, alleen op weekdagen \(2099-00001\)\./);
  // Twee evenementen die dag (het tweede alleen als kaart van de plek): geen regel, en geen context bij het parkeerverbod.
  const twee = [...ev, ...evenementen([inname("ET2099000002", "2099-03-14")])];
  const [pt] = verrijkMetContext([p, ...twee], { straat: "Proefplein", vandaag: VANDAAG, agendaItems });
  assert.equal(pt.title, "Parkeerverbod");
  assert.equal(regel(pt, "Evenement"), "");
  assert.equal(regel(pt, "Ook gepland hier die dag"), "");
  assert.deepEqual(pt, p, "zonder kandidaat blijft het parkeerverbod zoals het was");
  // Alleen een kaart van de plek (niet in de agenda): die houdt een regel tegen, maar geeft er nooit een.
  const [pp] = verrijkMetContext([p, ...ev], { straat: "Proefplein", vandaag: VANDAAG, agendaItems: [] });
  assert.equal(pp.title, "Parkeerverbod");
  assert.equal(regel(pp, "Evenement"), "");
});

test("een markt die dag, in de straat of in de straten van het evenement: geen regel 'Evenement'", () => {
  // De foor loopt drie weken op het Proefplein en in de Tweedestraat; de markt staat op woensdag op het Proefplein.
  const foor = dossierPunt("ET2099000020", "2099-03-07", "Najaarsfoor Proefplein", { tot: "2099-03-28", straten: ["Proefplein", "Tweedestraat"], info: "Naam automatisch herkend via de foorlijst van de stad (zelfde plein en periode).", category: "festival" });
  const agendaItems = [foor, markt("2099-03-11"), markt("2099-03-18")];
  // Op het plein zelf, op een marktdag: twee items, geen regel.
  const opPlein = parkeer(21, "2099-03-11");
  const [a] = verrijkMetContext([opPlein, agendaEntry(markt("2099-03-11"), "markets"), agendaEntry(foor, "festival")], { straat: "Proefplein", vandaag: VANDAAG, agendaItems });
  assert.equal(a.title, "Parkeerverbod");
  assert.equal(regel(a, "Evenement"), "");
  assert.equal(regel(a, "Ook gepland hier die dag"), "");
  // In de Tweedestraat, op een marktdag: de markt staat niet in die straat, wel in een straat van de foor. Ook geen regel.
  const naast = publicSpaceEntry({ id: "parking:2099-000022|1", kind: "parking", kindLabel: "Parkeerverbod", title: "Aanvraag voor evenementen gesteund door de stad", reason: "Aanvraag voor evenementen gesteund door de stad", location: "Tweedestraat, 2000 Antwerpen", start: "2099-03-18T00:00:00.000Z", end: "2099-03-18T00:00:00.000Z", status: "Goedgekeurd", reference: "2099-000022", startTime: "00:00", endTime: "23:59", streets: [straat("Tweedestraat")] });
  const [b] = verrijkMetContext([naast], { straat: "Tweedestraat", vandaag: VANDAAG, agendaItems });
  assert.equal(b.title, "Parkeerverbod");
  assert.equal(regel(b, "Evenement"), "");
  // Op een dag zonder markt: de foor is het enige item, dan wel de regel.
  const dinsdag = publicSpaceEntry({ ...naast.item, id: "parking:2099-000023|1", reference: "2099-000023", start: "2099-03-17T00:00:00.000Z", end: "2099-03-17T00:00:00.000Z" });
  const [c] = verrijkMetContext([dinsdag], { straat: "Tweedestraat", vandaag: VANDAAG, agendaItems });
  assert.equal(c.title, "Parkeerverbod");
  assert.match(regel(c, "Evenement"), /^Najaarsfoor Proefplein \(A-Sign, dossier ET2099000020\): het enige evenement in deze straat op die dag/);
  // Een ouder bronbestand zonder `stratenVolledig`: de straten van de foor tellen dan nog om de markt ernaast te zien.
  const oud = [{ ...foor, stratenVolledig: undefined }, markt("2099-03-11"), markt("2099-03-18")];
  assert.equal(regel(verrijkMetContext([naast], { straat: "Tweedestraat", vandaag: VANDAAG, agendaItems: oud })[0], "Evenement"), "");
  assert.match(regel(verrijkMetContext([dinsdag], { straat: "Tweedestraat", vandaag: VANDAAG, agendaItems: oud })[0], "Evenement"), /^Najaarsfoor Proefplein /);
});

test("één beslissing per parkeerverbod: op elke straatpagina dezelfde regel, over al zijn straten", () => {
  // Eén parkeerverbod in twee straten. In de Proefstraat loopt een stoet, in de Tweedestraat ligt die dag ook een
  // verkeersvrije zone (een dossier van de verversing zonder agendapunt).
  const rijen = [
    { id: "parking:2099-000030|1", kind: "parking", kindLabel: "Parkeerverbod", title: "Aanvraag voor evenementen gesteund door de stad", reason: "Aanvraag voor evenementen gesteund door de stad", location: "Proefplein, 2000 Antwerpen", start: "2099-03-15T00:00:00.000Z", end: "2099-03-15T00:00:00.000Z", status: "Goedgekeurd", reference: "2099-000030", startTime: "00:00", endTime: "23:59", streets: [straat("Proefplein")] },
    { id: "parking:2099-000030|2", kind: "parking", kindLabel: "Parkeerverbod", title: "Aanvraag voor evenementen gesteund door de stad", reason: "Aanvraag voor evenementen gesteund door de stad", location: "Tweedestraat, 2000 Antwerpen", start: "2099-03-15T00:00:00.000Z", end: "2099-03-15T00:00:00.000Z", status: "Goedgekeurd", reference: "2099-000030", startTime: "00:00", endTime: "23:59", streets: [straat("Tweedestraat")] },
  ];
  const agendaItems = [dossierPunt("ET2099000031", "2099-03-15", "Proefstoet", { straten: ["Proefplein"], category: "parade" })];
  const zone = { ET2099000032: { start: "2099-03-15", eind: "2099-03-15", soort: "", soortBron: "", beschrijvingen: [], straten: ["Tweedestraat"], kruist: [], stratenTekst: "", gekoppeld: null, kaart: [], kaartDeel: false } };
  const pagina = (naam, uitleg) => {
    const kaarten = publicSpaceEntries(rijen.filter((r) => r.streets[0].name === naam), { vandaag: VANDAAG, alle: rijen, straat: naam });
    const p = kaarten.find((e) => e.item?.kind === "parking");
    assert.deepEqual(p.straten, ["Proefplein", "Tweedestraat"], "alle straten van het A-Sign-nummer, ook buiten de plek");
    return verrijkMetContext(kaarten, { straat: naam, vandaag: VANDAAG, agendaItems, uitleg }).find((e) => e.item?.kind === "parking");
  };
  // Met de zone: op beide pagina's geen regel (op de Proefplein-pagina staat de zone niet, maar ze telt mee).
  const met = { evenementen: zone, werken: {} };
  const [a, b] = [pagina("Proefplein", met), pagina("Tweedestraat", met)];
  assert.deepEqual([a.title, b.title], ["Parkeerverbod", "Parkeerverbod"]);
  assert.deepEqual([regel(a, "Evenement"), regel(b, "Evenement")], ["", ""]);
  // Zonder de zone: op beide pagina's de regel, en "deze straten". De titel blijft "Parkeerverbod".
  const zonder = { evenementen: {}, werken: {} };
  const [x, y] = [pagina("Proefplein", zonder), pagina("Tweedestraat", zonder)];
  assert.deepEqual([x.title, y.title], ["Parkeerverbod", "Parkeerverbod"]);
  assert.equal(regel(x, "Evenement"), regel(y, "Evenement"));
  assert.match(regel(y, "Evenement"), /^Proefstoet \(A-Sign, dossier ET2099000031\): het enige evenement in deze straten op die dag/);
});

test("geen kandidaat: een lang dossier, een evenement dat niet elke dag loopt, of een agendapunt uit UiT", () => {
  const p = parkeer(2, "2099-03-14", "2099-03-15");
  const lang = evenementen([inname("ET2099000003", "2099-01-01", "2099-12-31")], { dossiers: { ET2099000003: fiche("Proefjaar") } });
  const half = evenementen([inname("ET2099000004", "2099-03-15")], { dossiers: { ET2099000004: fiche("Proefdag") } });
  const uit = agendaEntry({ id: "uit-1", sourceId: "stad-uit", title: "Proefconcert", date: "2099-03-14", endDate: "2099-03-15", location: "Proefplein", theme: "culture" }, "culture");
  const [pn] = verrijkMetContext([p, ...lang, ...half, uit], { straat: "Proefplein", vandaag: VANDAAG });
  assert.equal(pn.title, "Parkeerverbod");
  assert.equal(regel(pn, "Evenement"), "");
  // Geen context bij een parkeerverbod (die zou alleen bij de reden "evenement" staan), ook niet zonder gekozen straat.
  assert.equal(regel(pn, "Ook gepland hier op die dagen"), "");
  const [zonder] = verrijkMetContext([p, ...half], { straat: "", vandaag: VANDAAG });
  assert.equal(regel(zonder, "Ook gepland hier op die dagen"), "");
});

// Nakijkronde van 18 oktober 2026: een evenementkaart uit de ochtendstand noemde het parkeerverbod onder "Wat merk je" met
// alleen de straat en de postcode, zonder de zin dat het huisnummer alleen live in A-Sign staat (die zeggen de werfkaart,
// parkeerRegel, en de kaart van het parkeerverbod wel). De ochtendstand bewaart bewust geen huisnummer (besluit van de
// eigenaar van 18 oktober 2026); live, met het huisnummer, staat de zin er niet. De vaagheidsmeter telt ze.
test("evenementkaart uit de ochtendstand: het parkeerverbod onder 'Wat merk je' zegt dat het huisnummer alleen live in A-Sign staat, en de meter telt het", () => {
  const ev = evenementen([inname("ET2099000001", "2099-03-14")], { dossiers: { ET2099000001: fiche("Proefloop") } });
  const agendaItems = [dossierPunt("ET2099000001", "2099-03-14", "Proefloop")];
  // Zoals een straatbestand het bewaart: geen reden, wel het evenement (evenementSleutel) en plaatsVanDeOchtend.
  const ochtendRij = { id: "parking:2099-00001|1", kind: "parking", kindLabel: "Parkeerverbod", title: "Parkeerverbod", location: "Proefplein, 2000 Antwerpen", start: "2099-03-14T00:00:00.000Z", end: "2099-03-14T00:00:00.000Z", status: "Goedgekeurd", reference: "2099-00001", startTime: "08:00", endTime: "18:00", weekdaysOnly: false, streets: [straat("Proefplein")], evenementSleutel: "ET2099000001", plaatsVanDeOchtend: true };
  const [po, eo] = verrijkMetContext([publicSpaceEntry(ochtendRij), ...ev], { straat: "Proefplein", vandaag: VANDAAG, agendaItems });
  assert.match(po.summary, /Het huisnummer staat alleen in de live gegevens van A-Sign/);
  const watMerkJe = eo.uitleg.kern.find(([k]) => k === "Wat merk je")[1];
  assert.match(watMerkJe, /Ook een parkeerverbod in de laag parkeerverboden van A-Sign: Proefplein, 2000 Antwerpen: 14 mrt, van 8\.00 tot 18\.00 uur \(2099-00001\)\. Het huisnummer staat alleen in de live gegevens van A-Sign; die zijn \(nog\) niet geladen\. Zelfde straat en dagen/);
  const meting = vaagheidVanKaart({ titel: eo.title, regels: eo.uitleg.kern.map(([k, v]) => `${k}: ${v}`) });
  assert.ok(meting.patronen.includes("huisnummer-alleen-live"), JSON.stringify(meting.patronen));
  assert.equal(meting.kern, true, "de plaats van het parkeerverbod is niet exact: de meter telt de kaart als vaag");
  assert.ok(meting.detail.ontbreekt >= 1);
  // Live, met het huisnummer (publiekParkeerAdres): exact, zonder die zin, en de meter ziet niets.
  const p = parkeer(1, "2099-03-14");
  const [, el] = verrijkMetContext([p, ...ev], { straat: "Proefplein", vandaag: VANDAAG, agendaItems });
  const live = el.uitleg.kern.find(([k]) => k === "Wat merk je")[1];
  assert.doesNotMatch(live, /huisnummer staat alleen in de live gegevens/);
  assert.equal(vaagheidVanKaart({ titel: el.title, regels: el.uitleg.kern.map(([k, v]) => `${k}: ${v}`) }).patronen.includes("huisnummer-alleen-live"), false);
});

test("een agendapunt uit een andere bron als enige kandidaat, en een vermoede naam: in de regel, nooit in de titel", () => {
  const p = parkeer(3, "2099-03-20");
  const kalender = { id: "kal-1", sourceId: "district-kalender", title: "Proefbraderie", date: "2099-03-20", location: "Proefplein", category: "shopping" };
  const [pn] = verrijkMetContext([p, agendaEntry(kalender, "shopping")], { straat: "Proefplein", vandaag: VANDAAG, agendaItems: [kalender] });
  assert.equal(pn.title, "Parkeerverbod");
  assert.match(regel(pn, "Evenement"), /^Proefbraderie \(districtskalender\)/);
  const vermoed = dossierPunt("ET2099000005", "2099-03-20", "Vermoedelijk Proefstoet", { info: "Naam vermoed via de kalender van vorig jaar; niet bevestigd.", category: "parade" });
  const [pv] = verrijkMetContext([p, agendaEntry(vermoed, "parade")], { straat: "Proefplein", vandaag: VANDAAG, agendaItems: [vermoed] });
  assert.equal(pv.title, "Parkeerverbod");
  assert.match(regel(pv, "Evenement"), /^Proefstoet \(A-Sign, dossier ET2099000005\)/);
  // Een dossier zonder naam dat zelf zegt wat het is (de soort uit het dossier): die titel in de regel.
  // De evenementkaart van de plek krijgt het parkeerverbod onder "Wat merk je".
  const soort = dossierPunt("ET2099000009", "2099-03-20", "Buurtfeest op het Proefplein", { info: "", category: "neighborhood" });
  const kaart = { uid: "publicSpace:dossier:ET2099000009", id: "ET2099000009", source: "publicSpace", group: "evenementen", title: "Buurtfeest op het Proefplein", start: "2099-03-20", end: "",
    straten: ["Proefplein"], item: { kind: "event", streets: [straat("Proefplein")] }, uitleg: { watBron: "soort", kern: [["Wat merk je", "Kramen."]], regels: [] } };
  const [pm, em] = verrijkMetContext([p, kaart], { straat: "Proefplein", vandaag: VANDAAG, agendaItems: [soort] });
  assert.equal(pm.title, "Parkeerverbod");
  assert.match(regel(pm, "Evenement"), /^Buurtfeest op het Proefplein \(A-Sign, dossier ET2099000009\)/);
  assert.match(em.uitleg.kern[0][1], /^Kramen\. Ook een parkeerverbod in de laag parkeerverboden van A-Sign: Proefplein, 2000 Antwerpen: 20 mrt, hele dag \(2099-00003\)\./);
  // Een evenementendossier dat (vermoedelijk) een markt is, als enige: geen regel, en geen context bij het parkeerverbod.
  const marktDossier = dossierPunt("ET2099000011", "2099-03-20", "Vermoedelijk een markt op het Proefplein", { info: "", category: "shopping" });
  const [pk] = verrijkMetContext([p, agendaEntry(marktDossier, "shopping")], { straat: "Proefplein", vandaag: VANDAAG, agendaItems: [marktDossier] });
  assert.equal(pk.title, "Parkeerverbod");
  assert.equal(regel(pk, "Evenement"), "");
  assert.equal(regel(pk, "Ook gepland hier die dag"), "");
  // "Vermoedelijk ..." of "Evenement in ..." zonder naam: de regel met de titel van het dossier.
  const leeg = dossierPunt("ET2099000010", "2099-03-20", "Evenement op het Proefplein", { info: "" });
  const [pl] = verrijkMetContext([p], { straat: "Proefplein", vandaag: VANDAAG, agendaItems: [leeg] });
  assert.equal(pl.title, "Parkeerverbod");
  assert.match(regel(pl, "Evenement"), /^Evenement op het Proefplein \(A-Sign, dossier ET2099000010\): het enige evenement/);
});

test("vragen aan de stad: zonder naam of zonder doel, de meeste straten eerst; geen huisnummers", () => {
  const evenementen = {
    ET2099000010: { start: "2099-03-10", eind: "2099-03-10", soort: "", straten: ["Proefplein", "Tweedestraat"], gekoppeld: null },
    ET2099000011: { start: "2099-03-11", eind: "2099-03-11", soort: "Stoet", straten: ["Proefplein", "Tweedestraat", "Derdestraat"], gekoppeld: null },
    ET2099000012: { start: "2099-03-12", eind: "2099-03-12", soort: "", straten: ["Proefplein"], gekoppeld: null },
    ET2099000013: { start: "2099-03-13", eind: "2099-03-13", soort: "", straten: ["Proefplein"], gekoppeld: { titel: "Proeffeest" } },
    ET2099000014: { start: "2099-01-01", eind: "2099-01-02", soort: "", straten: ["Proefplein"], gekoppeld: null },
  };
  const hand = { dossiers: { ET2099000012: fiche("Proefloop") } };
  const rijen = [
    { reference: "GW2099-000001", start: "2099-03-01T06:00:00Z", end: "2099-04-01T16:00:00Z", werfzoneStreets: [{ name: "Proefplein" }], omleidingStreets: [{ name: "Tweedestraat" }, { name: "Derdestraat" }, { name: "Vierdestraat" }] },
    { reference: "GW2099-000002", start: "2099-03-01T06:00:00Z", end: "2099-04-01T16:00:00Z", werfzoneStreets: [{ name: "Proefplein" }], omleidingStreets: [] },
  ];
  const werken = { 1: { dossier: "GW2099-000002", soort: "Rioleringswerken", soortBron: "omschrijving", fasen: [] } };
  const vragen = vragenAanDeStad({ evenementen, hand, auto: null, rijen, werken, vandaag: VANDAAG });
  assert.deepEqual(vragen.map((v) => [v.dossier, v.straten.length]), [["GW2099-000001", 4], ["ET2099000011", 3], ["ET2099000010", 2]]);
  assert.deepEqual(vragen[1].ontbreekt, ["naam", "uren", "organisator"]);
  const md = vragenMarkdown(vragen, { vandaag: VANDAAG });
  assert.match(md, /\| 1 \| werfzone \| GW2099-000001 \| 4 \|/);
  assert.match(md, /Wat is evenementendossier ET2099000011 \(stoet\)\? Naam, uren, organisator\?/);
  assert.doesNotMatch(md, /Proefplein \d/);
});
