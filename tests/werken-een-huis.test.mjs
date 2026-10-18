// Een werk voor één huis (besluit van de eigenaar van 18 oktober 2026: de plaats exact, maar niets dat over een persoon
// vertelt; nakijkronde van head 1ed84e65, herzien in die van head c4bb2927): bij een nieuwe aansluiting, een container, een
// lift of levering, een tekst met een persoon, of een tekst die een los huisnummer noemt (behalve bij een publiek project)
// staat geen vrije tekst van de beheerder naast het adres. Een naam is in vrije tekst niet betrouwbaar te herkennen
// ("Container voor Proefmans, Proefstraat 12"), dus de kaart toont de soort en het adres (isEenHuis en werkKaartje in
// site/kaart-uitleg.js). Een reeks huisnummers is geen huis: daar blijven de woorden van de beheerder.
// Alle straten, nummers, namen en codes zijn verzonnen; geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";

import * as KU from "../site/kaart-uitleg.js";
import { INNAME_LIFT } from "../site/works-core.js";
import { workEntry } from "../site/place-core.js";

const VANDAAG = "2099-03-10";
const kaart = (w, opties = {}) => KU.werkKaartje(w, { vandaag: VANDAAG, ...opties });
const regels = (k) => Object.fromEntries(k.regels);
const getoond = (k) => [k.titel, k.samenvatting, k.plek, k.bronTekst, ...k.regels.flat(), ...k.ontbreekt].join(" ¶ ");
// Een werk zoals de site het krijgt (verzonnen).
const werk = (extra = {}) => ({ gipodId: 990950, title: "Werk in openbaar domein", status: "In uitvoering", start: "2099-03-01T06:00:00Z", end: "2099-03-30T16:00:00Z", owner: "Stad Antwerpen - Proefdienst", ownerGroup: "Stad Antwerpen", streets: [{ name: "Proefstraat" }], occupancyTypes: ["Andere"], workTypes: [], hindrance: null, ...extra });
const fase = (description, consequences = ["Parkeerverbod"]) => ({ description, start: "2099-03-12T06:00:00Z", end: "2099-03-12T16:00:00Z", consequences });
const metFasen = (...fasen) => ({ severe: false, consequences: ["Parkeerverbod"], start: "2099-03-12T06:00:00Z", end: "2099-03-12T16:00:00Z", phases: fasen });
const NOOT = "De vrije tekst van de beheerder staat niet op de site: hij kan over één huis of een persoon gaan.";

test("een container voor één huis: de soort en het exacte adres, nergens de naam uit de tekst van de beheerder", () => {
  const w = werk({ title: "Container voor Proefmans, Proefstraat 12", hindrance: metFasen(fase("Container Proefmans"), fase("Bushalte verplaatst voor Proefmans", ["Beperkte doorgang voor voetgangers"])) }); // verzonnen
  const k = kaart(w);
  assert.match(k.titel, /^Container in de Proefstraat nr\. 12\b/);
  assert.equal(regels(k).Waar, "Proefstraat, nr. 12 (omschrijving van de beheerder)");
  assert.equal(regels(k).Wat, `Container, afgeleid uit de omschrijving van de beheerder. ${NOOT}`);
  assert.equal(k.bronTekst, "");
  assert.doesNotMatch(getoond(k), /Proefmans|Volgens de beheerder|De beheerder schrijft|Bushalte/);
  // De fasen met hun dag en gevolgen, zonder naam; geen "Bus en tram" uit vrije tekst.
  assert.match(regels(k).Fasen, /^12 maart: (?:parkeerverbod|voetgangers beperkt) · 12 maart: (?:parkeerverbod|voetgangers beperkt)$/);
  assert.equal(regels(k)["Bus en tram"], undefined);
  // Ook op de plekpagina, met de feiten van de verversing erbij.
  const e = workEntry(w, { vandaag: VANDAAG, uitleg: { werken: { 990950: KU.werkFeiten(w) } } });
  assert.doesNotMatch([e.title, e.summary, e.location, getoond(e.uitleg)].join(" "), /Proefmans/);
  // Een vaste naam van een fase ("Fase 2", "Werken") mag wel: die zegt niets over een persoon.
  const vast = kaart(werk({ title: "2018 ANTWERPEN, PROEFSTRAAT 12", occupancyTypes: ["Container"], hindrance: metFasen(fase("Fase 2"), fase("Werken")) })); // verzonnen
  assert.match(regels(vast).Fasen, /^(?:Fase 2|Werken) \(12 maart\): parkeerverbod · (?:Fase 2|Werken) \(12 maart\): parkeerverbod$/);
  assert.equal(regels(vast).Wat, "Container, afgeleid uit de soort inname in GIPOD.", "geen noot als er niets wegvalt");
});

test("ook een aansluiting, een lift of levering, een werk met één huisnummer en een werf; een reeks houdt de tekst", () => {
  const gevallen = [
    [werk({ title: "Nieuwe aansluiting fam. Proefmans, Proefstraat 14", owner: "Fluvius System Operator", ownerGroup: "Fluvius", occupancyTypes: ["Elektriciteit"], workTypes: ["klantaansluiting"] }), null], // verzonnen
    [werk({ title: "Levering keuken Proefmans, Proefstraat 16", occupancyTypes: ["Lift/levering"] }), null], // verzonnen
    [werk({ title: "Gevelwerken woning Proefmans, Proefstraat 18", occupancyTypes: ["Stelling"] }), null], // verzonnen
    // Het nummer uit het adressenregister (één nummer), niet uit de tekst.
    [werk({ title: "Kabelwerken voor Proefmans", owner: "Proefnet", ownerGroup: "Andere", occupancyTypes: ["Telecom"] }), { huisnummers: "nr. 20", huisnummerBron: "afgeleid uit de werfzone en het adressenregister" }], // verzonnen
  ];
  for (const [w, extra] of gevallen) {
    const k = kaart(w, { feiten: extra ? { ...KU.werkFeiten(w), ...extra } : null });
    assert.match(k.titel, /Proefstraat nr\. \d+\b/, w.title);
    assert.doesNotMatch(getoond(k), /Proefmans|keuken|woning|Kabelwerken voor/, w.title);
    assert.ok(regels(k).Wat.endsWith(NOOT), w.title);
  }
  // Een werf met één huisnummer: geen fasen als doel, geen tekst van de beheerder.
  const werf = kaart(werk({ dossier: "GW2099-000951", title: "2018 ANTWERPEN, PROEFSTRAAT 22", hindrance: metFasen(fase("Levering keuken fam. Proefmans")) }), { werf: { dossier: "GW2099-000951" } }); // verzonnen
  assert.doesNotMatch(getoond(werf), /Proefmans|keuken/);
  assert.match(werf.titel, /^Werf in de Proefstraat nr\. 22\b/);
  assert.equal(regels(werf).Wat, `Een werf: dit werk staat in GIPOD met het dossiernummer van werfzone GW2099-000951 in A-Sign. ${NOOT}`);
  // Zonder soort en zonder werf: "Wat" zegt waarom er geen tekst staat.
  const zonder = kaart(werk({ title: "Voor Proefmans, Proefstraat 24" })); // verzonnen
  assert.equal(regels(zonder).Wat, NOOT);
  assert.doesNotMatch(getoond(zonder), /Proefmans/);
  // Een reeks huisnummers is geen huis: de woorden van de beheerder over het project blijven.
  const reeks = kaart(werk({ title: "Rioleringswerken Proefstraat 12-40 - project Proefring", owner: "Proefwater", ownerGroup: "Andere", occupancyTypes: ["Riolering"] })); // verzonnen
  assert.match(regels(reeks).Wat, /Volgens de beheerder: “project Proefring”/);
  assert.equal(regels(reeks).Waar, "Proefstraat, nr. 12–40 (omschrijving van de beheerder)");
  assert.doesNotMatch(regels(reeks).Wat, new RegExp(NOOT));
});

test("isEenHuis: een aansluiting, een container, een lift of levering, een persoon, of een los huisnummer in de tekst", () => {
  assert.equal(KU.isEenHuis({ soort: "Nieuwe aansluiting op het gasnet" }), true);
  assert.equal(KU.isEenHuis({ soort: "Container" }), true);
  assert.equal(KU.isEenHuis({ soort: INNAME_LIFT }), true);
  assert.equal(KU.isEenHuis({ soort: "Gevelwerken", innameSoort: INNAME_LIFT }), true);
  // Een los huisnummer in de tekst van de beheerder (ook met een code), bij een werk dat geen publiek project is.
  assert.equal(KU.isEenHuis({ soort: "Stelling (steiger)", omschrijving: "Proefstraat 12", straten: ["Proefstraat"] }), true); // verzonnen
  assert.equal(KU.isEenHuis({ soort: "", omschrijving: "2018 ANTWERPEN, PROEFSTRAAT 1DN02", straten: ["Proefstraat"] }), true); // verzonnen
  // Een persoon, bij elk werk.
  assert.equal(KU.isEenHuis({ soort: "Rioleringswerken", omschrijving: "Herstelling riolering bij fam. Proefmans" }), true); // verzonnen
  // Geen huis: een reeks, een publiek project met één huisnummer, één nummer uit het adressenregister (nakijkronde van head
  // c4bb2927: dat maakte van wegenwerken "een werk aan één adres"), of een ongeldig nummer.
  assert.equal(KU.isEenHuis({ soort: "Stelling (steiger)", omschrijving: "Proefstraat 12-40", straten: ["Proefstraat"] }), false); // verzonnen
  assert.equal(KU.isEenHuis({ soort: "Rioleringswerken", omschrijving: "Proefstraat 12 - vervanging riolering", straten: ["Proefstraat"] }), false); // verzonnen
  assert.equal(KU.isEenHuis({ soort: "Rioleringswerken", huisnummers: "nr. 12", huisnummerBron: "afgeleid uit de werfzone en het adressenregister" }), false);
  assert.equal(KU.isEenHuis({ soort: "Rioleringswerken", huisnummers: "" }), false);
  assert.equal(KU.isEenHuis({ soort: "", omschrijving: "Proefstraat 2001", straten: ["Proefstraat"] }), false); // verzonnen
});
