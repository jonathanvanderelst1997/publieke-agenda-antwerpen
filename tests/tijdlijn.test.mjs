// De tijdlijn over 14 dagen (site/place-view.js, renderTijdlijn): de regels uit site/place-core.js.
// Nakijkbevindingen bij PR #166: een teken alleen op dagen waarop er echt iets gebeurt (losse dagen, een
// evenement van twee weken of langer), het aantal in enkelvoud of meervoud, en een lege dag die eerlijk
// zegt wat we weten. Verzonnen dossiers en straten, vaste datums (geen klok).
import test from "node:test";
import assert from "node:assert/strict";

import * as kern from "../site/place-core.js";

const { addDays, agendaEntry, evenementEntry, groupForList, legeDagLabel, legeTijdlijnTekst, opDag, overlaps, periodRange, publicSpaceEntries, publicSpaceEntry, soortAantal } = kern;

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
  // Elke laag heet in het meervoud: "werken worden", niet "werken wordt" (nakijkbevinding, frisse ogen).
  assert.equal(legeDagLabel({ bezig: ["werken"] }), "nog niets gevonden, werken worden nog geladen");
  assert.equal(legeDagLabel({ bezig: ["evenementen op straat"] }), "nog niets gevonden, evenementen op straat worden nog geladen");
  assert.equal(legeDagLabel({ bezig: ["werken", "verkeersmaatregelen"] }), "nog niets gevonden, werken en verkeersmaatregelen worden nog geladen");
  // Laadde een laag niet: "niets gevonden", zonder te zeggen dat iets niet laadde (besluit van 18-10-2026).
  assert.equal(legeDagLabel({ onvolledig: true }), "niets gevonden");
  assert.equal(legeDagLabel(), "niets gepland binnen je keuze");
});

test("legeTijdlijnTekst: over die dag of de 14 dagen, niet over de hele straat", () => {
  assert.equal(legeTijdlijnTekst({ dag: true, andereDagen: 3 }), "Binnen je keuze staat op die dag niets gepland. Op 3 andere dagen van de komende 14 dagen staat wel iets: kies een dag met een teken.");
  assert.equal(legeTijdlijnTekst({ dag: true, andereDagen: 1 }), "Binnen je keuze staat op die dag niets gepland. Op 1 andere dag van de komende 14 dagen staat wel iets: kies een dag met een teken.");
  assert.equal(legeTijdlijnTekst({ dag: true }), "Binnen je keuze staat op die dag niets gepland.");
  assert.equal(legeTijdlijnTekst({}), "Binnen je keuze staat de komende 14 dagen niets gepland.");
  assert.equal(legeTijdlijnTekst({ dag: true, bezig: ["werken"] }), "In wat al geladen is, staat op die dag niets; werken worden nog geladen.");
  assert.equal(legeTijdlijnTekst({ onvolledig: true }), "De komende 14 dagen is hier niets gevonden.");
  assert.equal(legeTijdlijnTekst({ dag: true, onvolledig: true }), "Op die dag is hier niets gevonden.");
  assert.equal(legeTijdlijnTekst({ dag: true, doorlopend: 1 }), "Binnen je keuze staat op die dag niets gepland behalve wat hieronder doorloopt.");
  assert.equal(legeTijdlijnTekst({ aantalSoorten: 0 }), "Je hebt alle soorten uitgezet.");
  for (const opties of [{}, { dag: true }, { bezig: ["werken"] }, { onvolledig: true }]) assert.doesNotMatch(legeTijdlijnTekst(opties), /deze straat|op de agenda/);
});

// ---- nakijkbevindingen na de herstelronde ----

// Bevinding 5 (rest): een werfzone met fasen en een gat ertussen. werfzoneEntry nam de vroegste start en het
// laatste einde; elke dag van het gat kreeg zo een teken. Verzonnen dossier, twee sgw-rijen.
const sgw = (id, start, end) => ({ id: `sgw:${id}`, kind: "sgw", kindLabel: "Werfzone", title: "Werfzone", reference: "SGW_2099_0001", start: `${start}T00:00:00.000Z`, end: `${end}T00:00:00.000Z`, status: "vergund", streets: [{ name: "Proefstraat", postcode: "2000" }] });
test("opDag: een werfzone met fasen en een gat ertussen alleen op de dagen van een fase", () => {
  const [werf] = publicSpaceEntries([sgw(1, "2026-10-05", "2026-10-12"), sgw(2, "2026-10-20", "2026-10-23")], { vandaag: VANDAAG, straat: "Proefstraat" });
  assert.equal(werf.group, "werken");
  // De oude regel (de hele periode) gaf elke dag tot 23 okt, ook het gat van 13 tot 19 okt.
  assert.equal(veertien.filter((d) => overlaps(werf, d, d)).length, 13);
  assert.deepEqual(veertien.filter((d) => opDag(werf, d)), ["2026-10-11", "2026-10-12", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]);
  for (const d of ["2026-10-13", "2026-10-16", "2026-10-19"]) assert.equal(opDag(werf, d), false, d);
  // Eén fase: gewoon de periode.
  const [een] = publicSpaceEntries([sgw(3, "2026-10-05", "2026-10-30")], { vandaag: VANDAAG, straat: "Proefstraat" });
  assert.equal(veertien.filter((d) => opDag(een, d)).length, 14);
});

// Ter zijde bij bevinding 5: een parkeerverbod "alleen op weekdagen" kreeg ook een teken op zaterdag en zondag.
test("opDag: een parkeerverbod alleen op weekdagen niet op zaterdag en zondag", () => {
  const verbod = publicSpaceEntry({ id: "parking:PROEF-W1|L1", kind: "parking", title: "Werken", reason: "Werken", reference: "PROEF-W1", start: "2026-10-12", end: "2026-10-23", weekdaysOnly: true, streets: [{ name: "Proefstraat" }] });
  const dagen = veertien.filter((d) => opDag(verbod, d));
  assert.deepEqual(dagen, ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]);
  const elkeDag = publicSpaceEntry({ id: "parking:PROEF-W2|L1", kind: "parking", title: "Werken", reason: "Werken", reference: "PROEF-W2", start: "2026-10-12", end: "2026-10-18", streets: [{ name: "Proefstraat" }] });
  assert.equal(veertien.filter((d) => opDag(elkeDag, d)).length, 7);
});

// Nakijkbevindingen (tijdlijn en frisse ogen): een foor of expo uit de agenda kreeg geen teken, en elke dag
// heette "niets gepland". Een toelating van twee weken of langer die binnen de 14 dagen begint, kreeg ook op
// haar eerste dag geen teken.
test("opDag: een agendapunt van weken elke dag; een lange toelating op haar eerste dag", () => {
  const foor = agendaEntry({ id: "proef-foor", title: "Najaarsfoor (proef)", date: "2026-10-03", endDate: "2026-10-18", location: "Proefplein" }, "neighborhood");
  assert.equal(kern.langEvenement(foor), true);
  assert.deepEqual(veertien.filter((d) => opDag(foor, d)), veertien.filter((d) => d <= "2026-10-18"));
  const toelating = kaart([rij("ET2099300005", "Evenement", addDays(VANDAAG, 5), addDays(VANDAAG, 30), ["Proefstraat"])]);
  assert.equal(kern.langEvenement(toelating), true);
  assert.deepEqual(veertien.filter((d) => opDag(toelating, d)), [addDays(VANDAAG, 5)]);
  // Een toelating die al loopt: geen teken (ze staat bij "Doorlopend").
  const lopend = kaart([rij("ET2099300006", "Evenement", addDays(VANDAAG, -30), addDays(VANDAAG, 60), ["Proefstraat"])]);
  assert.equal(veertien.filter((d) => opDag(lopend, d)).length, 0);
});

test("legeDagLabel: loopt er die dag iets door, dan nooit 'niets gepland'", () => {
  assert.equal(legeDagLabel({ doorlopend: 1 }), "niets apart gepland binnen je keuze; 1 toelating van twee weken of langer loopt door");
  assert.equal(legeDagLabel({ doorlopend: 2 }), "niets apart gepland binnen je keuze; 2 toelatingen van twee weken of langer lopen door");
  assert.equal(legeDagLabel({ doorlopend: 1, bezig: ["werken"] }), "nog niets apart gevonden, werken worden nog geladen; 1 toelating van twee weken of langer loopt door");
  assert.equal(legeDagLabel({ doorlopend: 1, onvolledig: true }), "niets apart gevonden; 1 toelating van twee weken of langer loopt door");
  for (const opties of [{ doorlopend: 1 }, { doorlopend: 3, bezig: ["werken"] }]) assert.doesNotMatch(legeDagLabel(opties), /^niets gepland/);
});

// Nakijkbevinding (tijdlijn): de noot bij "Doorlopend" noemde ook een agendapunt van de districtskalender een
// toelating van de stad.
test("doorlopendNoot: alleen toelatingen heten toelatingen van de stad", () => {
  const expo = agendaEntry({ id: "proef-expo", title: "Fototentoonstelling (proef)", date: "2026-10-01", endDate: "2026-10-22", location: "Proefzaal" }, "culture");
  const toelating = kaart([rij("ET2099300007", "Evenement", addDays(VANDAAG, -30), addDays(VANDAAG, 60), ["Proefstraat"])]);
  assert.doesNotMatch(kern.doorlopendNoot([expo]), /Toelatingen van de stad/);
  assert.match(kern.doorlopendNoot([expo]), /^Evenementen en activiteiten die weken of maanden lopen\./);
  assert.match(kern.doorlopendNoot([toelating]), /^Toelatingen van de stad die weken of maanden lopen\./);
  assert.match(kern.doorlopendNoot([expo, toelating]), /^Evenementen en toelatingen van de stad /);
  assert.match(kern.doorlopendNoot([toelating], { tijdlijn: true }), /geen teken per dag, wel op de dag waarop ze beginnen\.$/);
  // In de lijst geen "wat er vandaag echt gebeurt": een foor gebeurt vandaag ook echt.
  assert.doesNotMatch(kern.doorlopendNoot([expo]), /vandaag echt/);
});

// Nakijkbevinding (frisse ogen): de tijdlijn noemde een dag met alleen opbouw "1 evenement"; de weekzin zegt
// "opbouw voor 1 evenement".
test("dagInhoud: een dag met alleen opbouw of afbraak heet zoals in de weekzin", () => {
  const groep = (key) => ({ key });
  const e = kaart([
    rij("ET2099300008", "Opbouw", "2026-10-12", "2026-10-13", ["Proefstraat"]),
    rij("ET2099300008", "Evenement", "2026-10-14", "2026-10-14", ["Proefstraat"]),
    rij("ET2099300008", "Afbraak", "2026-10-15", "2026-10-15", ["Proefstraat"]),
  ]);
  assert.equal(kern.dagInhoud([[groep("evenementen"), [e]]], "2026-10-12"), "opbouw voor 1 evenement");
  assert.equal(kern.dagInhoud([[groep("evenementen"), [e]]], "2026-10-14"), "1 evenement");
  assert.equal(kern.dagInhoud([[groep("evenementen"), [e]]], "2026-10-15"), "afbraak na 1 evenement");
  const ander = agendaEntry({ id: "proef-concert", title: "Concert (proef)", date: "2026-10-12", location: "Proefplein" }, "culture");
  assert.equal(kern.dagInhoud([[groep("evenementen"), [e, ander]], [groep("werken"), [{}, {}]]], "2026-10-12"), "1 evenement, opbouw voor 1 evenement, 2 werken of verkeersmaatregelen");
});
