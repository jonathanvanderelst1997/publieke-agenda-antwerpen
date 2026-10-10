// Vergunningen: de kaart zegt in gewone taal wat er gebeurt (herstelplan O4). Vaste labels met
// woordgrenzen, aantallen uit de bron, publieke projecten alleen bij de Vlaamse Regering of de
// Deputatie, de stand uit Volledig/Ontvankelijk, één statusregel, "Wie beslist", een ingeklapte
// "Waar" vanaf 3 straten en een technische link per dossier. Nooit vrije onderwerptekst.
// De toetsen na "de stand uit Volledig en Ontvankelijk" en de extra privacyregels komen uit de twee
// nakijkverslagen van PR #142.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { duidelijkeKaart } from "../site/permit-clarity.js";
import { normalizePermit, collectPermits } from "../site/permits-live-core.js";
import { permitEntry } from "../site/place-core.js";
import { buildStreetIndex } from "../site/street-core.js";

const fixture = async (naam) => JSON.parse(await readFile(new URL(`./fixtures/${naam}`, import.meta.url), "utf8"));
const rij = (onderwerp, extra = {}) => ({ Dossiernummer: "20990001", ProjectnummerOmgevingsloket: "OMV_2099000001", DOSSIERTYPE: "OMV2019_AANVRAAG", AardAanvraag: "Aanvraag omgevingsproject", Onderwerp: onderwerp, Volledig: "ja", Ontvankelijk: "ja", behandelendeOverheid: "College van burgemeester en schepenen", ...extra });
const kaart = (onderwerp, extra = {}) => duidelijkeKaart({ source: "permits" }, normalizePermit(rij(onderwerp, extra)));

test("de 15 onderwerpen uit de straattest krijgen een titel die zegt wat er gebeurt", async () => {
  const { aanvragen } = await fixture("vergunning-onderwerpen.json");
  assert.equal(aanvragen.length, 15);
  for (const a of aanvragen) {
    const titel = kaart(a.onderwerp, { behandelendeOverheid: a.overheid }).titel;
    assert.equal(titel, a.titel, a.onderwerp);
    assert.doesNotMatch(titel, /doel niet|niet herkend/);
  }
});

test("woordgrenzen: verbouwen is geen nieuwbouw, en 'vellen van één boom' is een boom vellen", () => {
  assert.equal(kaart("verbouwen van een eengezinswoning").titel, "Verbouwing of uitbreiding");
  assert.equal(kaart("verbouwen van een meergezinswoning naar een eengezinswoning").titel, "Minder woningen · verbouwing of uitbreiding");
  assert.equal(kaart("vellen van één boom").titel, "Boom vellen");
  assert.equal(kaart("vellen van 4 populieren").titel, "4 bomen vellen");
  // "zonder functiewijziging" is geen functiewijziging.
  assert.equal(kaart("verbouwen en/of uitbreiden zonder functiewijziging").titel, "Verbouwing of uitbreiding");
  // Een restaurant is geen restauratie, een recafunctie geen renovatie.
  assert.doesNotMatch(kaart("uitbreiden van een restaurant").titel, /Restauratie/);
});

test("meerdere vaste labels per aanvraag; de rest staat bij 'Wat'", () => {
  const x = kaart("wijzigen van de voorgevel, supprimeren van de reca-unit en het uitvoeren van interne wijzigingen ten opzichte van omgevingsvergunning OMV_2000000002 (SH) en het exploiteren van 1 warmtepomp (IIOA)");
  assert.equal(x.titel, "Wijziging van een eerdere vergunning: horeca verdwijnt · gevel aanpassen");
  const wat = x.regels.find(([k]) => k === "Wat")[1];
  assert.match(wat, /verbouwing of uitbreiding · warmtepomp, airco of verwarming\./);
  assert.match(wat, /Er bestaat al een vergunning; deze aanvraag wil ze aanpassen\./);
  // Een warmtepomp alleen maakt er geen bedrijf met milieuvergunning van.
  assert.doesNotMatch(wat, /milieuvergunning/);
});

test("'Wat' herhaalt de titel niet: alleen wat er niet meer in past, en uitleg bij jargon", () => {
  const x = kaart("wijzigen van de voorgevel, supprimeren van de reca-unit en het uitvoeren van interne wijzigingen ten opzichte van omgevingsvergunning OMV_2000000002 (SH) en het exploiteren van 1 warmtepomp (IIOA)");
  const wat = x.regels.find(([k]) => k === "Wat")[1];
  assert.equal(wat, "Ook in deze aanvraag: verbouwing of uitbreiding · warmtepomp, airco of verwarming. Er bestaat al een vergunning; deze aanvraag wil ze aanpassen.");
  for (const uitTitel of ["horeca verdwijnt", "gevel aanpassen", "Wijziging van een eerdere vergunning ·"]) assert.equal(wat.includes(uitTitel), false, uitTitel);
  // Draagt de titel alles en is er geen jargon, dan is er geen "Wat".
  assert.equal(kaart("plaatsen van een luifel, wijzigen van het buitenschrijnwerk en aanbrengen van zaakgebonden publiciteit").regels.some(([k]) => k === "Wat"), false);
  // Een project als kop: de extra soort werk staat bij "Wat", de soorten uit de titel niet.
  const p = kaart("wijziging van de basisvergunning Oosterweelverbinding en een wijziging van de IIOA-werffase; exploiteren van een opslag", { behandelendeOverheid: "Vlaamse Regering" });
  assert.equal(p.titel, "Oosterweelverbinding: wijziging van een eerdere vergunning · tijdelijke constructie of werfzone");
  assert.match(p.regels.find(([k]) => k === "Wat")[1], /^Ook in deze aanvraag: milieuvergunning \(exploitatie\)\. /);
});

test("aantallen uit de bron, maar nooit uit telefoon- of huisnummers", () => {
  assert.equal(kaart("bouwen van 6 appartementen met reca op het gelijkvloers").titel, "Nieuwbouw (6 appartementen en horeca)");
  assert.equal(kaart("oprichten van 2 meergezinswoningen met 2 en 3 wooneenheden na sloop").titel, "Sloop en nieuwbouw (2 meergezinswoningen)");
  assert.equal(kaart("bouwen van een meergezinswoning, info 0470 12 34 56 appartementen").titel, "Nieuwbouw (woningen)");
});

test("publieke projecten alleen als de Vlaamse Regering of de Deputatie de aanvraag behandelt", () => {
  const onderwerp = "Actualisatie en hernieuwing van het project 'Renovatie Royerssluis'.";
  assert.match(kaart(onderwerp, { behandelendeOverheid: "Vlaamse Regering" }).titel, /^Royerssluis: /);
  assert.match(kaart("aanleggen en verhogen van de Blokkersdijk", { behandelendeOverheid: "Vlaamse Regering" }).titel, /^Blokkersdijk/);
  for (const overheid of ["College van burgemeester en schepenen", ""]) assert.doesNotMatch(kaart(onderwerp, { behandelendeOverheid: overheid }).titel, /Royerssluis/);
});

test("de stand uit Volledig en Ontvankelijk staat in één statusregel", () => {
  assert.equal(kaart("vellen van een boom").samenvatting, "In behandeling: volledig en ontvankelijk verklaard. Nog geen beslissing gepubliceerd.");
  assert.match(kaart("vellen van een boom", { Volledig: "", Ontvankelijk: "nee" }).samenvatting, /niet ontvankelijk/);
  assert.match(kaart("vellen van een boom", { Beslissing: "Vergund" }).samenvatting, /verleend volgens/);
  const x = kaart("vellen van een boom");
  // De status staat niet nog eens in de details, en er is geen losse regel "nummer · overheid".
  assert.equal(x.regels.some(([k]) => /status/i.test(k)), false);
  assert.deepEqual(x.regels.find(([k]) => k === "Wie beslist"), ["Wie beslist", "College van burgemeester en schepenen"]);
  assert.deepEqual(kaart("vellen van een boom", { Beslissing: "Vergund", beslissingsoverheid: "Deputatie" }).regels.find(([k]) => k === "Beslist door"), ["Beslist door", "Deputatie"]);
  const entry = permitEntry(normalizePermit(rij("vellen van een boom")));
  assert.equal(entry.title, "Boom vellen");
  assert.equal(entry.info, "");
  assert.equal(entry.status, x.samenvatting);
});

test("lege velden Volledig en Ontvankelijk zijn 'onbekend', niet 'nog niet'", () => {
  // Een dossier uit 2019 met twee lege velden: de bron zegt niets over de stand.
  const oud = kaart("vellen van een boom", { Volledig: "", Ontvankelijk: "", ProjectnummerOmgevingsloket: "OMV_2019000001" }).samenvatting;
  assert.equal(oud, "Ingediend (dossier uit 2019). De stadsbron zegt niet of de aanvraag volledig en ontvankelijk is. Nog geen beslissing gepubliceerd.");
  // Zonder bruikbaar projectnummer geen jaartal.
  assert.equal(kaart("vellen van een boom", { Volledig: null, Ontvankelijk: null, ProjectnummerOmgevingsloket: "" }).samenvatting, "Ingediend. De stadsbron zegt niet of de aanvraag volledig en ontvankelijk is. Nog geen beslissing gepubliceerd.");
  // Bij een leeg veld nergens "nog niet" of "al": dat zou de bron zeggen, en ze zegt het niet.
  for (const leeg of ["", " ", null, undefined]) {
    const x = kaart("vellen van een boom", { Volledig: leeg, Ontvankelijk: leeg });
    assert.doesNotMatch(x.samenvatting, /nog niet|\bal\b/, x.samenvatting);
    assert.doesNotMatch(permitEntry(normalizePermit(rij("vellen van een boom", { Volledig: leeg, Ontvankelijk: leeg }))).status, /nog niet/);
  }
  // Alleen Ontvankelijk = ja: dat zeggen we, en niets over Volledig.
  assert.equal(kaart("vellen van een boom", { Volledig: "", Ontvankelijk: "ja" }).samenvatting, "In behandeling: ontvankelijk verklaard. Nog geen beslissing gepubliceerd.");
});

test("een klein bouwwerk telt alleen als het meteen volgt; een eigennaam 'De Bouw' is geen nieuwbouw", async () => {
  const { randgevallen } = await fixture("vergunning-onderwerpen.json");
  assert.ok(randgevallen.length >= 9);
  for (const a of randgevallen) {
    assert.equal(kaart(a.onderwerp, { behandelendeOverheid: a.overheid }).titel, a.titel, a.onderwerp);
  }
  // Een nieuwe woning met een zwembad of bijgebouw is nieuwbouw (op de vorige versie "niet herkend").
  assert.equal(kaart("bouwen van een eengezinswoning met zwembad").titel, "Nieuwbouw");
  assert.match(kaart("bouwen van een eengezinswoning met bijgebouw en zwembad; het aanleggen van terras verharding en een oprit").titel, /^Nieuwbouw/);
  // Nog altijd geen nieuwbouw: een overkapping of een zwembad alleen.
  assert.equal(kaart("bouwen van een overkapping").titel, "Overkapping");
  assert.doesNotMatch(kaart("bouwen van een zwembad").titel, /Nieuwbouw/);
  assert.doesNotMatch(kaart("bouwen van 2 zwembaden").titel, /Nieuwbouw/);
  // "Bouw" met een hoofdletter na een streepje is geen naam.
  assert.match(kaart("Kavel 2 - Bouw van een eengezinswoning").titel, /^Nieuwbouw/);
  assert.equal(kaart("plaatsen van zonnepanelen bij Bouw NV").titel, "Zonnepanelen");
});

test("samengestelde warmtepompen zijn een warmtepomp, geen bedrijf met milieuvergunning", () => {
  for (const onderwerp of [
    "verbouwen van een schoolgebouw naar een woonproject met 23 wooneenheden en het exploiteren van 23 individuele lucht-waterwarmtepompen",
    "verbouwen van een meergezinswoning en een beperkte volume-uitbreiding; het plaatsen en exploiteren van 3 lucht-waterwarmtepompen op het dak",
    "plaatsen van een bodemwarmtepomp",
  ]) {
    const { inhoud } = normalizePermit(rij(onderwerp));
    assert.ok(inhoud.labels.includes("Warmtepomp, airco of verwarming"), onderwerp);
    assert.equal(inhoud.labels.some((l) => /milieuvergunning|bedrijf/i.test(l)), false, onderwerp);
  }
});

test("labels zeggen niet het omgekeerde: weg is niet erbij, een uitbouw is geen dakterras", () => {
  // Wat weggaat, krijgt geen label alsof het erbij komt.
  assert.equal(kaart("supprimeren van inpandige terrassen op de 3e verdieping, wijzigen van de voorgevel en doorvoeren van interne constructieve werken").titel, "Gevel aanpassen · verbouwing of uitbreiding");
  assert.doesNotMatch(kaart("verwijderen van de bestaande dakterrassen").titel, /terras/i);
  // Een terrasuitbouw op de eerste verdieping is geen dakterras.
  assert.equal(kaart("plaatsen van een terrasuitbouw op de eerste verdieping").titel, "Terras of balkon");
  assert.equal(kaart("inrichten van een dakterras").titel, "Dakterras");
  // Een handelswoning opsplitsen in een woning en een winkel geeft niet meer woningen.
  const splits = kaart("verbouwen en opsplitsen van een handelswoning in een woning en een winkel");
  assert.equal(splits.titel, "Verbouwing of uitbreiding · ruimtes samenvoegen of opsplitsen");
  assert.equal(kaart("opsplitsen van een eengezinswoning in 3 appartementen").titel, "Meer woningen (wordt 3 appartementen)");
  assert.equal(kaart("opsplitsen van een woning in een duplex en een studio").titel, "Meer woningen");
  // Een synagoge, school of tandartsenpraktijk is geen "bedrijf": het label is neutraal, met één zin uitleg.
  for (const onderwerp of ["functiewijziging van bedrijvigheid naar gemeenschapsdienst en exploiteren van een synagoge", "exploiteren van een tandartsenpraktijk", "verdere exploitatie van een school"]) {
    const x = kaart(onderwerp);
    assert.match(x.titel, /milieuvergunning \(exploitatie\)/i, onderwerp);
    assert.doesNotMatch(x.titel, /bedrijf/i, onderwerp);
    assert.match(x.regels.find(([k]) => k === "Wat")[1], /milieuvergunning nodig om ze te mogen uitbaten/);
  }
});

test("een project niet herkennen op een straatnaam of bedrijfsnaam alleen", () => {
  const vr = { behandelendeOverheid: "Vlaamse Regering" }, dep = { behandelendeOverheid: "Deputatie" };
  assert.match(kaart("Transformatie N12 Turnhoutsebaan: heraanleggen van rij- en trambaan en voetpaden", vr).titel, /^Heraanleg Turnhoutsebaan \(N12\)/);
  assert.doesNotMatch(kaart("uitbreiden van een tankstation aan de Turnhoutsebaan", dep).titel, /Heraanleg|N12/);
  assert.doesNotMatch(kaart("verdere exploitatie van een opslagplaats van Oosterweel Logistics", dep).titel, /Oosterweelverbinding/);
  assert.match(kaart("inrichten van een werfterrein voor de aanleg van de Oosterweelknoop", vr).titel, /^Oosterweelverbinding/);
});

test("bomen planten staat naast bomen vellen, elk met zijn eigen aantal", () => {
  const x = kaart("het rooien van 95 bomen en de aanplant van 201 nieuwe bomen");
  assert.equal(x.titel, "95 bomen vellen · 201 bomen planten");
  assert.equal(kaart("aanplant van 6 bomen na het vellen van 3 bomen").titel, "6 bomen planten · 3 bomen vellen");
  assert.equal(kaart("planten van 1 boom").titel, "Boom planten");
  // "planten" als zelfstandig naamwoord of een haag is geen boom.
  assert.equal(kaart("vellen van bomen en planten").titel, "Bomen vellen");
  assert.doesNotMatch(kaart("aanplanten van een haag").titel, /planten/);
});

test("een aanvraag met 'INGETROKKEN' en een datum in het onderwerp wordt niet getoond", () => {
  assert.equal(normalizePermit(rij("opslag van afvalstoffen: hernieuwing - INGETROKKEN dd 13/10/2017", { Ingetrokken: "nee" })), null);
  assert.equal(normalizePermit(rij("verbouwen van een woning (ingetrokken)")), null);
  assert.equal(normalizePermit(rij("verbouwen van een woning, stopgezet op 3/2/2020")), null);
  // Een nieuwe aanvraag die naar een ingetrokken aanvraag verwijst, blijft staan.
  assert.notEqual(normalizePermit(rij("verbouwen van een woning, na de eerder ingetrokken aanvraag")), null);
  assert.notEqual(normalizePermit(rij("VERBOUWEN VAN EEN WONING NA INGETROKKEN AANVRAAG")), null);
});

test("'Waar' staat vanaf 3 straten niet dubbel: in het detail alleen de ingeklapte lijst", async () => {
  // place-view.js draait in de browser; we lezen de sjabloonfunctie uit de bron en voeren ze uit.
  const bron = await readFile(new URL("../site/place-view.js", import.meta.url), "utf8");
  const begin = bron.indexOf("function waarTemplate(");
  assert.ok(begin >= 0, "waarTemplate ontbreekt in place-view.js");
  const code = bron.slice(begin, bron.indexOf("\n  }\n", begin) + 4);
  const esc = (v = "") => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
  const waarTemplate = new Function("esc", `${code}; return waarTemplate;`)(esc);
  const item = { ...normalizePermit(rij("vellen van een boom")), streets: ["Astraat", "Bstraat", "Cstraat", "Dstraat"].map((name, i) => ({ id: String(i), name, postcode: "2000" })) };
  const { waar } = duidelijkeKaart({ source: "permits" }, item, { straat: "Cstraat" });
  const html = waarTemplate(waar);
  assert.match(html, /<summary>Toon alle 4 straten<\/summary>/);
  assert.match(html, /Cstraat, Astraat, Bstraat, Dstraat/);
  assert.equal(html.includes(waar.kort), false, html);
  assert.equal(waarTemplate({ ...waar, ingeklapt: false, straten: ["Astraat", "Bstraat"], kort: "Astraat en Bstraat" }), "");
});

test("een aanvraag zonder omschrijving zegt dat eerlijk in één zin", () => {
  const x = kaart("Dossier aangemaakt via het digitaal loket, gelieve een onderwerp in te vullen...");
  assert.equal(x.titel, "Omgevingsaanvraag zonder omschrijving");
  // Het veld bevat alleen de vaste tekst van het loket: we schrijven niets toe aan de aanvrager.
  assert.deepEqual(x.regels.find(([k]) => k === "Wat"), ["Wat", "De stadsbron geeft geen omschrijving. Wat er gebeurt, staat alleen in het dossier zelf."]);
  assert.doesNotMatch(JSON.stringify(x), /aanvrager/);
  // In alle weergaven dezelfde naam voor een onbekende aanvraag.
  assert.equal(kaart("plaatsen van een automaat").titel, "Omgevingsaanvraag (soort werk niet herkend)");
});

test("'Waar': de gekozen straat eerst, vanaf 3 straten ingeklapt", () => {
  const item = { ...normalizePermit(rij("vellen van een boom")), streets: ["Astraat", "Bstraat", "Cstraat", "Dstraat"].map((name, i) => ({ id: String(i), name, postcode: "2000" })) };
  const x = duidelijkeKaart({ source: "permits" }, item, { straat: "Cstraat" });
  assert.equal(x.waar.kort, "Cstraat en 3 andere straten");
  assert.equal(x.waar.ingeklapt, true);
  assert.deepEqual(x.waar.straten, ["Cstraat", "Astraat", "Bstraat", "Dstraat"]);
  const twee = duidelijkeKaart({ source: "permits" }, { ...item, streets: item.streets.slice(0, 2) });
  assert.equal(twee.waar.kort, "Astraat en Bstraat");
  assert.equal(twee.waar.ingeklapt, false);
  assert.equal(permitEntry(item).location, "Astraat en 3 andere straten");
});

test("de technische link toont alleen dit dossier, zonder onderwerp of naam", () => {
  const district = { type: "Polygon", coordinates: [[[4.39, 51.19], [4.41, 51.19], [4.41, 51.21], [4.39, 51.21], [4.39, 51.19]]] };
  const streets = buildStreetIndex([{ type: "Feature", properties: { DISTRICT: "ANTWERPEN", LSTRNMID: 1, LSTRNM: "Teststraat", RSTRNMID: 1, RSTRNM: "Teststraat", postcode: 2000 }, geometry: { type: "LineString", coordinates: [[4.4, 51.195], [4.4, 51.205]] } }]);
  const [item] = collectPermits({ features: [{ attributes: rij("vellen van een boom"), geometry: { rings: [[[4.3998, 51.199], [4.4002, 51.199], [4.4002, 51.201], [4.3998, 51.201], [4.3998, 51.199]]] } }], districtGeometry: district, streetIndex: streets });
  const url = new URL(item.sourceUrl);
  assert.equal(url.searchParams.get("where"), "Dossiernummer='20990001'");
  assert.equal(url.searchParams.get("f"), "html");
  assert.doesNotMatch(url.searchParams.get("outFields"), /Onderwerp|MaatschappelijkeNaam/);
});

test("namen, telefoonnummers, adressen en rekeningnummers komen nergens door", async () => {
  const { aanvragen } = await fixture("vergunning-privacy.json");
  for (const a of aanvragen) {
    const item = normalizePermit(rij(a.onderwerp, { MaatschappelijkeNaam: a.naam, behandelendeOverheid: a.overheid ?? "College van burgemeester en schepenen" }));
    const uit = JSON.stringify([item, duidelijkeKaart({ source: "permits" }, item), permitEntry(item)]);
    for (const stuk of a.verboden) assert.equal(uit.includes(stuk), false, `"${stuk}" lekt uit: ${a.onderwerp}`);
  }
});

test("elk label komt uit de vaste lijst, ook bij onderwerpen met persoonsgegevens", async () => {
  // Dynamisch geladen, zodat de andere toetsen op een oudere versie apart blijven slagen of falen.
  const { aanvraagInhoud, LABELTEKSTEN } = await import("../site/permit-clarity.js");
  const onderwerpen = await fixture("vergunning-onderwerpen.json");
  const alle = [...onderwerpen.aanvragen, ...onderwerpen.randgevallen, ...(await fixture("vergunning-privacy.json")).aanvragen];
  for (const a of alle) {
    const inhoud = aanvraagInhoud("Aanvraag omgevingsproject", a.onderwerp, a.overheid ?? "");
    for (const label of inhoud.labels) assert.ok(LABELTEKSTEN.includes(label), label);
  }
});
