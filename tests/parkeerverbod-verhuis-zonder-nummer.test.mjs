// Regel van de eigenaar (26 oktober 2026): het huisnummer staat er altijd, "dat de mensen weten waar is een parkeerverbod",
// behalve bij iets persoonlijks: "enkel met verhuizen moet je dat wegdoen". Een parkeerverbod voor een verhuizing toont live
// alleen de straat en de postcode, zoals de ochtendstand; elk ander parkeerverbod de plaats exact. De reden staat nergens.
// Verzonnen straten, nummers, dossiers en redenen; geen netwerk.
import assert from "node:assert/strict";
import test from "node:test";

import { collectPublicSpace } from "../site/public-space-live-core.js";
import { isVerhuisReden, publiekParkeerAdres, adresZonderHuisnummer } from "../site/adres-privacy.js";
import { publicSpaceEntries } from "../site/place-core.js";
import { buildStreetGroups } from "../site/street-overview.js";
import { buildWeekPulse } from "../site/week-pulse.js";

const DAG = Date.UTC(2099, 2, 12);
const uur = (h) => Date.UTC(1899, 11, 30, h);
const feature = (reden, nr = "1", adres = "Proefstraat 12-14 2000 Antwerpen") => ({ attributes: {
  Dossiernummer: `2099-0001${nr}`, Locatienummer: nr, Status: "Goedgekeurd", Adres: adres, Postcode: "2000", Reden: reden,
  Startdatum: DAG, Einddatum: DAG, Starttijd: uur(7), Eindtijd: uur(17), EnkelWeekdagen: "0", GipodID: null, District: "ANTWERPEN",
} });
const PROEF = { id: "Proefstraat", name: "Proefstraat", postcode: "2000" };
const live = (reden, adres) => ({ ...collectPublicSpace({ parkingFeatures: [feature(reden, "1", adres)], alleenLive: true })[0], streets: [PROEF] });
const lijsten = (item) => [JSON.stringify(buildStreetGroups({ publicSpace: [item] })), JSON.stringify(buildWeekPulse({ publicSpace: [item], fromDay: "2099-03-09", toDay: "2099-03-15" }))];
const zichtbaar = (e) => JSON.stringify([e.title, e.summary, e.location, e.uitleg?.regels, e.plaatsen]);

test("isVerhuisReden: elke schrijfwijze van een verhuizing, en niets anders", () => {
  for (const r of ["Verhuis", "Aanvraag tot een verhuis met of zonder ladderlift, verhuiswagen", "VERHUIZING", "Ver-huis", "Ver­huis", "Verhuíslift", "Inhuizing", "Uithuizing Proefnaam"]) assert.equal(isVerhuisReden(r), true, r);
  for (const r of ["", "Container", "Aanvraag tot het plaatsen van een container", "Aanvraag tot het plaatsen van een beweegbaar toestel (voorbeeld: ladderlift, schaarlift, hoogtewerker)", "Melding ikv werfsignalisaties", "Filmopname", "Huis", null]) assert.equal(isVerhuisReden(r), false, String(r));
});

test("live: een verhuizing toont de straat en de postcode, elk ander parkeerverbod de plaats exact", () => {
  assert.equal(live("Aanvraag tot het plaatsen van een container").location, "Proefstraat 12–14, 2000 Antwerpen");
  // De lijst per straat en de vooruitblik tonen het nummer (de toets hieronder kijkt dus echt naar die uitgangen).
  for (const lijst of lijsten(live("Aanvraag tot het plaatsen van een container"))) assert.match(lijst, /Proefstraat 12–14/);
  assert.equal(live("Melding ikv werfsignalisaties").location, "Proefstraat 12–14, 2000 Antwerpen");
  for (const reden of ["Verhuis", "Aanvraag tot een verhuis met of zonder ladderlift, verhuiswagen", "VERHUIZING"]) {
    const item = live(reden);
    assert.equal(item.location, "Proefstraat, 2000 Antwerpen", reden);
    assert.equal(item.title, "Parkeerverbod");
    // Op de kaart, in de lijst per straat en in de vooruitblik: nergens het nummer, nergens de reden.
    const kaart = publicSpaceEntries([item], { vandaag: "2099-03-01", straat: "Proefstraat" })[0];
    assert.doesNotMatch(zichtbaar(kaart), /Proefstraat 1[24]|verhui/i, reden);
    for (const lijst of lijsten(item)) {
      assert.match(lijst, /Proefstraat/, reden);
      assert.doesNotMatch(lijst, /Proefstraat 1[24]|verhui/i, reden);
    }
  }
});

test("de opslag verandert niet: zonder alleenLive blijft elk parkeerverbod de straat en de postcode", () => {
  for (const reden of ["Verhuis", "Container"]) {
    const item = collectPublicSpace({ parkingFeatures: [feature(reden)] })[0];
    assert.equal(item.location, "Proefstraat, 2000 Antwerpen", reden);
  }
});

test("A-Sign schrijft een ontbrekend tweede nummer als 0: \"12-0\" wordt nr. 12, \"0-0\" en \"0-12\" blijven zonder nummer", () => {
  const exact = (adres) => publiekParkeerAdres(adres, adresZonderHuisnummer(adres));
  assert.equal(exact("Proefstraat 12-0 2000 Antwerpen"), "Proefstraat 12, 2000 Antwerpen");
  assert.equal(exact("Proefstraat 0-12 2000 Antwerpen"), "", "een 0 vooraan is geen plaats");
  assert.equal(exact("Proefstraat 0-0 2000 Antwerpen"), "");
  assert.equal(live("Container", "Proefstraat 12-0 2000 Antwerpen").location, "Proefstraat 12, 2000 Antwerpen");
  assert.equal(live("Verhuis", "Proefstraat 12-0 2000 Antwerpen").location, "Proefstraat, 2000 Antwerpen");
});
