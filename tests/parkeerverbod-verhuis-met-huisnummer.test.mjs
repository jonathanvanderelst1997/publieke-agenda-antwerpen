// Regel van de eigenaar van 26 oktober 2026 ("al vijf keer gezegd"): bij een parkeerverbod staat altijd de plaats met het
// huisnummer, ook als het voor een verhuis is. Een verhuis is dan gewoon een "Parkeerverbod" met zijn huisnummer: nooit de
// reden, nergens het woord verhuis (ook niet verhuislift, meubellift of verhuizing). Zo live, in de lijst per straat, in de
// vooruitblik, en in wat de verversing bewaart (de historiek, de straatbestanden: de publieke git-geschiedenis is aanvaard).
// Verzonnen straten, nummers, dossiers en redenen; geen netwerk.
import assert from "node:assert/strict";
import test from "node:test";

import { collectPublicSpace } from "../site/public-space-live-core.js";
import { adresZonderHuisnummer, isPubliekParkeerAdres, noemtVerhuis, parkeerAdresVoorOpslag, publiekParkeerAdres } from "../site/adres-privacy.js";
import { allePlaatsenVan, parkeerverbodInLijst, publicSpaceEntries } from "../site/place-core.js";
import { buildStreetGroups } from "../site/street-overview.js";
import { buildWeekPulse } from "../site/week-pulse.js";
import { compactPublicSpaceItem, updateLiveHistory } from "../lib/live-history.mjs";
import { historiekPrivacyBevindingen, itemVoorHistoriek } from "../lib/historiek-privacy.mjs";
import { bundelAanvulling, bundelRijen, itemVoorStraat } from "../scripts/build-straat-snapshots.mjs";
import { straatItemPrivacy } from "../lib/straat-bestanden.mjs";

const DAG = Date.UTC(2099, 2, 12);
const uur = (h) => Date.UTC(1899, 11, 30, h); // A-Sign bewaart een uur als een tijdstip op 30 december 1899
const feature = (reden, nr = "1", adres = "Proefstraat 12-14 2000 Antwerpen") => ({ attributes: {
  Dossiernummer: "2099-000101", Locatienummer: nr, Status: "Goedgekeurd", Adres: adres, Postcode: "2000", Reden: reden,
  Startdatum: DAG, Einddatum: DAG, Starttijd: uur(7), Eindtijd: uur(17), EnkelWeekdagen: "0", GipodID: null, District: "ANTWERPEN",
} });
const PROEF = { id: "Proefstraat", name: "Proefstraat", postcode: "2000" };
const TWEEDE = { id: "Tweedeproefstraat", name: "Tweedeproefstraat", postcode: "2000" };
const item = (reden, nr, adres) => ({ ...collectPublicSpace({ parkingFeatures: [feature(reden, nr, adres)] })[0], streets: [PROEF] });
const lijsten = (rij) => [JSON.stringify(buildStreetGroups({ publicSpace: [rij] })), JSON.stringify(buildWeekPulse({ publicSpace: [rij], fromDay: "2099-03-09", toDay: "2099-03-15" }))];
const zichtbaar = (e) => JSON.stringify([e.title, e.summary, e.info, e.location, e.timeText, e.uitleg, e.regels, e.plaatsen]);
// Elke schrijfwijze van een verhuis die A-Sign in het veld Reden kan zetten.
const VERHUIS = ["Verhuis", "Aanvraag tot een verhuis met of zonder ladderlift, verhuiswagen", "VERHUIZING", "Ver-huis", "Verhuislift", "Meubellift", "Inhuizing", "Uithuizing fam. Proefnaam"];
const VERRAAD = /verhui|meubellift|ladderlift|inhuiz|uithuiz|proefnaam/i;

test("een verhuis: overal het huisnummer, de titel 'Parkeerverbod', en nergens het woord verhuis", () => {
  const container = item("Aanvraag tot het plaatsen van een container");
  const kaartContainer = zichtbaar(publicSpaceEntries([container], { vandaag: "2099-03-01", straat: "Proefstraat" })[0]);
  for (const reden of VERHUIS) {
    const rij = item(reden);
    assert.equal(rij.location, "Proefstraat 12–14, 2000 Antwerpen", reden);
    assert.equal(rij.title, "Parkeerverbod");
    const kaart = zichtbaar(publicSpaceEntries([rij], { vandaag: "2099-03-01", straat: "Proefstraat" })[0]);
    assert.match(kaart, /Proefstraat 12–14, 2000 Antwerpen/, reden);
    assert.doesNotMatch(kaart, VERRAAD, reden);
    // Letter voor letter dezelfde kaart als een parkeerverbod voor een container: de reden verandert niets.
    assert.equal(kaart, kaartContainer, reden);
    for (const lijst of lijsten(rij)) {
      assert.match(lijst, /Proefstraat 12–14/, reden);
      assert.doesNotMatch(lijst, VERRAAD, reden);
    }
    // Wat de verversing bewaart: de historiek en het straatbestand houden de plaats exact, zonder reden.
    for (const opgeslagen of [compactPublicSpaceItem(rij), itemVoorStraat(rij, { laag: "publiekeRuimte" })]) {
      assert.ok(opgeslagen, reden);
      assert.equal(opgeslagen.location, "Proefstraat 12–14, 2000 Antwerpen", reden);
      assert.equal(opgeslagen.title, "Parkeerverbod");
      assert.equal("reason" in opgeslagen, false);
      assert.doesNotMatch(JSON.stringify(opgeslagen), VERRAAD, reden);
      assert.deepEqual(historiekPrivacyBevindingen(opgeslagen), [], reden);
    }
  }
});

test("A-Sign schrijft een ontbrekend tweede nummer als 0: \"12-0\" wordt nr. 12, \"0-0\" en \"0-12\" blijven zonder nummer", () => {
  const exact = (adres) => publiekParkeerAdres(adres, adresZonderHuisnummer(adres));
  assert.equal(exact("Proefstraat 12-0 2000 Antwerpen"), "Proefstraat 12, 2000 Antwerpen");
  assert.equal(exact("Proefstraat 0-12 2000 Antwerpen"), "", "een 0 vooraan is geen plaats");
  assert.equal(exact("Proefstraat 0-0 2000 Antwerpen"), "");
  assert.equal(item("Container", "1", "Proefstraat 12-0 2000 Antwerpen").location, "Proefstraat 12, 2000 Antwerpen");
  assert.equal(item("Verhuis", "1", "Proefstraat 12-0 2000 Antwerpen").location, "Proefstraat 12, 2000 Antwerpen");
  assert.equal(item("Verhuis", "1", "Proefstraat 0-0 2000 Antwerpen").location, "Proefstraat, 2000 Antwerpen");
});

test("bewaren: alleen de vorm van publiekParkeerAdres blijft exact; een naam, een bus of het woord verhuis nooit", () => {
  for (const plaats of ["Proefstraat 12, 2000 Antwerpen", "Proefstraat 12–14, 2000 Antwerpen", "Proefstraat 12b, 2018 Antwerpen", "Proefstraat hoek–64, 2060 Antwerpen", "Proefstraat 34–hoek, 2060 Antwerpen", "Proefstraat 12 en 14, 2000 Antwerpen", "Proefstraat 12, 14 en 16, 2000 Antwerpen"]) {
    assert.equal(isPubliekParkeerAdres(plaats), true, plaats);
    assert.equal(parkeerAdresVoorOpslag(plaats), plaats, plaats);
    const opgeslagen = itemVoorHistoriek({ id: "parking:2099-000101|1", kind: "parking", title: "Parkeerverbod", location: plaats });
    assert.equal(opgeslagen.location, plaats, plaats);
    assert.deepEqual(historiekPrivacyBevindingen(opgeslagen), [], plaats);
  }
  // Iets anders dan een nummer tussen de straat en de postcode: weg, en de scan meldt het als het er toch staat.
  for (const [plaats, schoon] of [
    ["Proefstraat 12 Jan Voorbeeld, 2000 Antwerpen", "Proefstraat, 2000 Antwerpen"],
    ["Proefstraat 12 bus 3, 2000 Antwerpen", "Proefstraat, 2000 Antwerpen"],
    ["Proefstraat 12 (verhuis), 2000 Antwerpen", "Proefstraat, 2000 Antwerpen"],
    ["Proefstraat 12-14 2000 Antwerpen", "Proefstraat, 2000 Antwerpen"],
  ]) {
    assert.equal(isPubliekParkeerAdres(plaats), false, plaats);
    const rij = { id: "parking:2099-000101|1", kind: "parking", title: "Parkeerverbod", location: plaats };
    assert.ok(historiekPrivacyBevindingen(rij).length, plaats);
    assert.equal(itemVoorHistoriek(rij).location, schoon, plaats);
    assert.deepEqual(historiekPrivacyBevindingen(itemVoorHistoriek(rij)), [], plaats);
  }
  // Het woord verhuis in eender welke tekst van een bewaard parkeerverbod: de scan meldt het als reden (validate-data
  // houdt zo'n bestand tegen), ook in de velden van een wijziging, en nooit met de waarde in de melding.
  assert.equal(noemtVerhuis("Ver­huís-lift"), true);
  assert.equal(noemtVerhuis("Proefstraat 12, 2000 Antwerpen"), false);
  const bevindingen = historiekPrivacyBevindingen({ layers: { publicSpace: { items: [{ id: "parking:2099-000101|1", kind: "parking", title: "Parkeerverbod", kindLabel: "Verhuislift", location: "Proefstraat 12, 2000 Antwerpen" }] } },
    changes: [{ id: "parking:2099-000101|1", layer: "publicSpace", type: "changed", fields: ["detail"], before: { detail: "" }, after: { detail: "meubellift" } }] });
  assert.deepEqual(bevindingen, [{ code: "reden", path: "$.layers.publicSpace.items[0].kindLabel" }, { code: "reden", path: "$.changes[0].after.detail" }]);
});

test("historiek: het huisnummer dat erbij komt is geen wijziging, een ander huisnummer wel", () => {
  const T1 = "2099-03-10T03:00:00.000Z", T2 = "2099-03-11T03:00:00.000Z", T3 = "2099-03-12T03:00:00.000Z";
  const laag = (rij) => ({ ok: true, items: [rij] });
  const exact = item("Verhuis");
  // Een historiek van vóór 26 oktober 2026: alleen de straat met de postcode.
  const oud = updateLiveHistory(null, { observedAt: T1, worksResult: { ok: true, items: [] }, publicSpaceResult: laag({ ...exact, location: "Proefstraat, 2000 Antwerpen" }) });
  assert.equal(oud.layers.publicSpace.items[0].location, "Proefstraat, 2000 Antwerpen");
  const nu = updateLiveHistory(oud, { observedAt: T2, worksResult: { ok: true, items: [] }, publicSpaceResult: laag(exact) });
  assert.equal(nu.layers.publicSpace.items[0].location, "Proefstraat 12–14, 2000 Antwerpen");
  assert.deepEqual(nu.changes, [], "de overgang maakt geen massa wijzigingen");
  const verschoven = updateLiveHistory(nu, { observedAt: T3, worksResult: { ok: true, items: [] }, publicSpaceResult: laag(item("Verhuis", "1", "Proefstraat 16-18 2000 Antwerpen")) });
  assert.deepEqual(verschoven.changes.map((c) => [c.type, c.fields, c.before, c.after]), [["changed", ["location"], { location: "Proefstraat 12–14, 2000 Antwerpen" }, { location: "Proefstraat 16–18, 2000 Antwerpen" }]]);
  for (const doc of [nu, verschoven]) {
    assert.doesNotMatch(JSON.stringify(doc), VERRAAD);
    assert.deepEqual(historiekPrivacyBevindingen(doc), []);
  }
});

test("straatbestand: de bundelrij met de andere plaatsen van hetzelfde parkeerverbod draagt ze exact, en de ochtendstand toont ze", () => {
  const hier = itemVoorStraat(item("Verhuis", "1"), { laag: "publiekeRuimte" });
  const daar = itemVoorStraat({ ...collectPublicSpace({ parkingFeatures: [feature("Verhuis", "2", "Tweedeproefstraat 3-3 2000 Antwerpen")] })[0], streets: [TWEEDE] }, { laag: "publiekeRuimte" });
  const [bundel] = bundelAanvulling([hier], bundelRijen([hier, daar]));
  assert.deepEqual(bundel.plaatsen, ["Tweedeproefstraat 3, 2000 Antwerpen"]);
  assert.equal(bundel.title, "Parkeerverbod");
  assert.equal("reason" in bundel, false);
  assert.deepEqual(straatItemPrivacy(bundel), []);
  // Een bundelrij met iets anders dan een plaats in de vorm van publiekParkeerAdres: de scan meldt het.
  assert.ok(straatItemPrivacy({ ...bundel, plaatsen: ["Tweedeproefstraat 3 bus 2, 2000 Antwerpen"] }).some((v) => v.code === "huisnummer"));
  // De ochtendstand (de rij van de straat en de bundelrij): de kaart noemt elke plaats met haar huisnummer.
  const [kaart] = publicSpaceEntries([hier, bundel], { vandaag: "2099-03-01", straat: "Proefstraat" });
  assert.deepEqual(kaart.plaatsen, ["Proefstraat 12–14, 2000 Antwerpen", "Tweedeproefstraat 3, 2000 Antwerpen"]);
  assert.equal(kaart.location, "Proefstraat 12–14, 2000 Antwerpen en Tweedeproefstraat 3, 2000 Antwerpen");
  assert.deepEqual(allePlaatsenVan(kaart), []);
  assert.doesNotMatch(zichtbaar(kaart), VERRAAD);
  // De lijst per straat: in de andere straat de plaats van de bundelrij, met het huisnummer.
  assert.equal(parkeerverbodInLijst(bundel, { straat: TWEEDE }).waar, "Tweedeproefstraat 3, 2000 Antwerpen");
});
