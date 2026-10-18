// Huisnummers uit de tekst van de beheerder (site/huisnummers.js), nakijkronde van head 1ed84e65: een maat of een duur met
// een spatie ervoor ("Proefstraat 30 m kabel", "Proefstraat 3 dagen"), een rangtelwoord op -e ("Proefstraat 2e fase") en
// een code met een underscore ("PROEFSTRAAT 3B_BIS": het hele nummer, niet "nr. 3B"). Liever geen nummer dan een fout.
// Alle straten en nummers zijn verzonnen; geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";

import * as KU from "../site/kaart-uitleg.js";

const uit = (t) => KU.huisnummersUitTekst(t, "Proefstraat");

test("een maat of een duur na een spatie is geen huisnummer, ook niet na een reeks", () => {
  for (const t of [
    "Proefstraat 30 m kabel", "Proefstraat 160 meter", "Proefstraat 12 meter", "Proefstraat 3 dagen", "Proefstraat 2 weken", "Proefstraat 8 u",
    "Proefstraat 8 uur", "Proefstraat 10 kV kabel", "Proefstraat 12 - 30 m", "Proefstraat 8 tot 17 u", "Proefstraat 3dagen", "Proefstraat 2 nachten",
  ]) assert.equal(uit(t), "", t); // verzonnen
});

test("een rangtelwoord op -e met een woord erna is geen huisnummer", () => {
  for (const t of ["Proefstraat 2e fase", "PROEFSTRAAT 3E DEEL", "Proefstraat 1e verdieping", "Proefstraat 2de fase", "Proefstraat 1ste deel"]) assert.equal(uit(t), "", t); // verzonnen
  // Aan het einde is het een huisnummer met een letter, zoals "12a".
  assert.equal(uit("Proefstraat 12e"), "nr. 12e");
});

test("een code met een underscore blijft heel: 'nr. 3B_BIS', ook op de kaart, en is geen werk bij 'Wat'", () => {
  for (const [t, nr] of [["Proefstraat 3B_BIS", "nr. 3B_BIS"], ["2018 ANTWERPEN, PROEFSTRAAT 4B_BIS", "nr. 4B_BIS"], ["Proefstraat | 3B_BIS", "nr. 3B_BIS"], ["Proefstraat 3B_BIS - kabelwerken", "nr. 3B_BIS"]]) {
    assert.equal(uit(t), nr, t); // verzonnen
  }
  assert.equal(KU.geldigeHuisnummers("nr. 3B_BIS"), "nr. 3B_BIS");
  const werk = { gipodId: 990960, title: "2018 ANTWERPEN, PROEFSTRAAT 3B_BIS", status: "In uitvoering", start: "2099-03-01T06:00:00Z", end: "2099-03-30T16:00:00Z", owner: "Fluvius System Operator", ownerGroup: "Fluvius", streets: [{ name: "Proefstraat" }], occupancyTypes: ["Elektriciteit"], workTypes: ["klantaansluiting"], hindrance: null }; // verzonnen
  const k = KU.werkKaartje(werk, { vandaag: "2099-03-10" });
  const regels = Object.fromEntries(k.regels);
  assert.equal(regels.Waar, "Proefstraat, nr. 3B_BIS (omschrijving van de beheerder)");
  assert.match(k.titel, /in de Proefstraat nr\. 3B_BIS /);
  assert.doesNotMatch(regels.Wat, /BIS/);
  // Wat de beheerder over het werk zegt, zonder een stuk van het nummer ("BIS").
  assert.equal(KU.projectTekst("PROEFSTRAAT 3B_BIS", { straten: ["Proefstraat"] }), "");
  assert.equal(KU.projectTekst("2020 ANTWERPEN, PROEFBROEK 4B_BIS - herstelling", { straten: ["Proefstraat"] }), "herstelling"); // verzonnen
  // Een dossiercode met underscores blijft gesplitst zoals voorheen.
  assert.equal(KU.projectTekst("2018_Antwerpen: Proefmarkt herstel", { straten: ["Proefstraat"] }), "Proefmarkt herstel"); // verzonnen
});

test("gewone huisnummers blijven: met een woord erna, met een letter, met een duur na een komma, met 'bus'", () => {
  for (const [t, nr] of [
    ["Proefstraat 12 kabelwerken", "nr. 12"], ["Proefstraat 12a", "nr. 12a"], ["Proefstraat 12, 3 dagen", "nr. 12"], ["Proefstraat 12 bus 3", "nr. 12"],
    ["Proefstraat 12-14 dakwerken", "nr. 12–14"], ["Proefstraat 12 maart", "nr. 12"], ["2018 ANTWERPEN, PROEFSTRAAT 1DN02", "nr. 1DN02"],
  ]) assert.equal(uit(t), nr, t); // verzonnen
});
