// De tijdlijn over 14 dagen (site/place-view.js, renderTijdlijn): de regels uit site/place-core.js.
// Nakijkbevindingen bij PR #166: een teken alleen op dagen waarop er echt iets gebeurt (losse dagen, een
// evenement van twee weken of langer), het aantal in enkelvoud of meervoud, en een lege dag die eerlijk
// zegt wat we weten. Verzonnen dossiers en straten, vaste datums (geen klok).
import test from "node:test";
import assert from "node:assert/strict";

import { addDays, evenementEntry, groupForList, legeDagLabel, legeTijdlijnTekst, opDag, overlaps, periodRange, soortAantal } from "../site/place-core.js";

const VANDAAG = "2026-10-11";
const veertien = Array.from({ length: 14 }, (_, i) => addDays(VANDAAG, i));
let n = 0;
const rij = (dossier, phase, start, end, straten) => ({
  id: `iod:${dossier}|${phase}|${(n += 1)}`, kind: "iod", title: "Inname", innameType: "Inname", reference: dossier, dossierType: "ETL",
  phase, hindrance: "True", description: "", start, end: end || start, status: "aanvraag_goedgekeurd",
  streets: straten.map((name, i) => ({ id: `${n}${i}`, name, postcode: "2000" })), sourceUrl: "https://geodata.antwerpen.be/x",
});
const kaart = (rows) => evenementEntry(rows, { vandaag: VANDAAG, wijkVan: () => "Universiteitsbuurt" });

test("opDag: elke woensdag alleen op de woensdagen, niet de hele periode ertussen", () => {
  const woensdagen = ["2026-10-07", "2026-10-14", "2026-10-21", "2026-10-28"];
  const e = kaart(woensdagen.map((d) => rij("ET2099300001", "Evenement", d, d, ["Testplein"])));
  assert.deepEqual(e.losseDagen, woensdagen);
  // De oude regel (de periode) gaf elke dag van de 14.
  assert.equal(veertien.filter((d) => overlaps(e, d, d)).length, 14);
  assert.deepEqual(veertien.filter((d) => opDag(e, d)), ["2026-10-14", "2026-10-21"]);
  // Zoals de lijst: de eerstvolgende losse dag.
  const g = groupForList([e], { ...periodRange("alles", VANDAAG), today: VANDAAG });
  assert.deepEqual(g.days.map(([d]) => d), ["2026-10-14"]);
});

test("opDag: twee weken of langer niet per dag (de lijst zet het bij 'Doorlopend'); een korte periode wel elke dag", () => {
  const jaar = kaart([rij("ET2099300002", "Evenement", "2026-01-01", "2026-12-31", ["Voorbeeldplein"])]);
  assert.equal(veertien.filter((d) => opDag(jaar, d)).length, 0);
  assert.equal(groupForList([jaar], { ...periodRange("alles", VANDAAG), today: VANDAAG }).doorlopend.length, 1);
  const weekend = kaart([rij("ET2099300003", "Evenement", "2026-10-17", "2026-10-18", ["Proefstraat"])]);
  assert.deepEqual(veertien.filter((d) => opDag(weekend, d)), ["2026-10-17", "2026-10-18"]);
  // Een werk van drie weken: elke dag (geen evenement, geen "Doorlopend").
  const werk = { group: "werken", start: "2026-10-05", end: "2026-10-26" };
  assert.equal(veertien.filter((d) => opDag(werk, d)).length, 14);
});

test("opDag: opbouw en afbraak (een parkeerverbod) tellen wel, ook bij losse dagen", () => {
  const rows = [
    rij("ET2099300004", "Opbouw", "2026-10-12", "2026-10-13", ["Proefstraat"]),
    rij("ET2099300004", "Evenement", "2026-10-14", "2026-10-14", ["Proefstraat"]),
    rij("ET2099300004", "Evenement", "2026-10-16", "2026-10-16", ["Proefstraat"]),
    rij("ET2099300004", "Afbraak", "2026-10-17", "2026-10-17", ["Proefstraat"]),
  ];
  const e = kaart(rows);
  assert.deepEqual(e.losseDagen, ["2026-10-14", "2026-10-16"]);
  assert.deepEqual(veertien.filter((d) => opDag(e, d)), ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-16", "2026-10-17"]);
});

test("soortAantal: enkelvoud bij 1, meervoud anders, met telbare woorden", () => {
  assert.equal(soortAantal("evenementen", 1), "1 evenement");
  assert.equal(soortAantal("evenementen", 2), "2 evenementen");
  assert.equal(soortAantal("markten", 1), "1 markt");
  assert.equal(soortAantal("markten", 3), "3 markten");
  assert.equal(soortAantal("werken", 1), "1 werk of verkeersmaatregel");
  assert.equal(soortAantal("werken", 2), "2 werken of verkeersmaatregelen");
  assert.equal(soortAantal("inspraak", 1), "1 item over inspraak of info");
  assert.equal(soortAantal("raad", 1), "1 vergadering van raad of commissie");
  for (const key of ["evenementen", "werken", "inspraak", "markten", "raad"]) assert.doesNotMatch(soortAantal(key, 1), /^1 \S+en\b/, key);
});

test("legeDagLabel: nooit 'niets gepland' zolang een laag laadt of als ze niet laadde", () => {
  assert.equal(legeDagLabel({ bezig: ["werken"] }), "nog niets gevonden, werken wordt nog geladen");
  assert.equal(legeDagLabel({ bezig: ["werken", "verkeersmaatregelen"] }), "nog niets gevonden, werken en verkeersmaatregelen worden nog geladen");
  assert.equal(legeDagLabel({ onvolledig: true }), "niets gevonden in wat geladen is, niet alles laadde");
  assert.equal(legeDagLabel(), "niets gepland binnen je keuze");
});

test("legeTijdlijnTekst: over die dag of de 14 dagen, niet over de hele straat", () => {
  assert.equal(legeTijdlijnTekst({ dag: true, andereDagen: 3 }), "Binnen je keuze staat op die dag niets gepland. Op 3 andere dagen van de komende 14 dagen staat wel iets: kies een dag met een teken.");
  assert.equal(legeTijdlijnTekst({ dag: true, andereDagen: 1 }), "Binnen je keuze staat op die dag niets gepland. Op 1 andere dag van de komende 14 dagen staat wel iets: kies een dag met een teken.");
  assert.equal(legeTijdlijnTekst({ dag: true }), "Binnen je keuze staat op die dag niets gepland.");
  assert.equal(legeTijdlijnTekst({}), "Binnen je keuze staat de komende 14 dagen niets gepland.");
  assert.equal(legeTijdlijnTekst({ dag: true, bezig: ["werken"] }), "In wat al geladen is, staat op die dag niets; werken wordt nog geladen.");
  assert.equal(legeTijdlijnTekst({ onvolledig: true }), "In wat wel geladen is, staat de komende 14 dagen niets.");
  assert.equal(legeTijdlijnTekst({ dag: true, doorlopend: 1 }), "Binnen je keuze staat op die dag niets gepland behalve wat hieronder doorloopt.");
  assert.equal(legeTijdlijnTekst({ aantalSoorten: 0 }), "Je hebt alle soorten uitgezet.");
  for (const opties of [{}, { dag: true }, { bezig: ["werken"] }, { onvolledig: true }]) assert.doesNotMatch(legeTijdlijnTekst(opties), /deze straat|op de agenda/);
});
