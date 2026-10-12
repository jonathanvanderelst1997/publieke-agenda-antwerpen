// Wens van 12 oktober 2026: "de publieke agenda, bij de straat zelf moet niet beperkt zijn, gewoon alle data die
// je hebt". Wie een straat, wijk of postcode kiest, ziet standaard alles: periode "alles" (zonder einde), alle
// soorten, geen grens per sectie, en een getal dat zegt waarom de lijst korter is als de knoppen haar beperken.
// De pure delen (site/place-core.js); de browser toetst tests/e2e/plek.e2e.mjs. Verzonnen gegevens.
import test from "node:test";
import assert from "node:assert/strict";

import {
  ALLES_TOT, KIND_GROUPS, PERIODS, agendaEntry, beperkingTekst, deelTekst, geldigePeriode, groupForList, lijstUniversum, periodRange,
  plekSubTekst, standaardPeriode, telPerSoort,
} from "../site/place-core.js";

const VANDAAG = "2026-10-12";
const punt = (id, date, extra = {}) => agendaEntry({ id, title: `Proefactiviteit ${id}`, date, location: "Proefstraat 1", category: "culture", ...extra }, extra.category || "culture");

test("vertrekstand: met een plek periode 'alles', zonder plek de komende 30 dagen", () => {
  assert.equal(standaardPeriode({ type: "straat", name: "Proefstraat" }), "alles");
  assert.equal(standaardPeriode({ type: "wijk", code: "ANT09" }), "alles");
  assert.equal(standaardPeriode({ type: "postcode", code: "2000" }), "alles");
  assert.equal(standaardPeriode(null), "maand");
  assert.equal(standaardPeriode(), "maand");
  // De knoppen blijven dezelfde vier; "alles" is alleen de vertrekstand.
  assert.deepEqual(PERIODS.map(([k, label]) => [k, label]), [["week", "7 dagen"], ["maand", "30 dagen"], ["kwartaal", "3 maanden"], ["alles", "Alles"]]);
});

test("een periode uit de URL: alleen de vier bekende, ook een oude link met periode=maand", () => {
  for (const k of ["week", "maand", "kwartaal", "alles"]) assert.equal(geldigePeriode(k), k);
  for (const k of ["", null, undefined, "jaar", "MAAND", "alles "]) assert.equal(geldigePeriode(k), "");
});

test("periode 'alles' heeft geen einde: niets staat bij 'later gepland', hoe ver ook", () => {
  assert.deepEqual(periodRange("alles", VANDAAG), { from: VANDAAG, to: ALLES_TOT });
  assert.equal(ALLES_TOT, "9999-12-31");
  // Vroeger 3.650 dagen: een punt over 12 jaar stond dan bij "later gepland".
  const entries = [punt("a", "2026-10-13"), punt("b", "2027-06-01"), punt("c", "2038-10-12"), punt("d", "2099-12-31")];
  const { days, later } = groupForList(entries, { ...periodRange("alles", VANDAAG), today: VANDAAG });
  assert.deepEqual(later, []);
  assert.deepEqual(days.map(([d]) => d), ["2026-10-13", "2027-06-01", "2038-10-12", "2099-12-31"]);
  // De andere periodes beperken nog zoals vroeger.
  assert.deepEqual(periodRange("maand", VANDAAG), { from: VANDAAG, to: "2026-11-10" });
  const maand = groupForList(entries, { ...periodRange("maand", VANDAAG), today: VANDAAG });
  assert.deepEqual(maand.later.map((e) => e.start), ["2027-06-01", "2038-10-12", "2099-12-31"]);
  // Het getal boven de lijst (lijstUniversum) is wat de lijst bij "alles" toont: alle vier.
  assert.equal(telPerSoort(lijstUniversum(entries, VANDAAG)).totaal, 4);
});

test("alle soorten: elke soortgroep staat in KIND_GROUPS, ook raad, inspraak, markten, werken en vergunningen", () => {
  assert.deepEqual(KIND_GROUPS.map((g) => g.key), ["evenementen", "werken", "inspraak", "markten", "raad", "vergunningen"]);
  for (const thema of ["meetings", "admin", "info", "calls", "works", "publicSpace", "markets", "permits"]) assert.ok(KIND_GROUPS.some((g) => g.themes.includes(thema)), thema);
});

test("beperkingTekst: alleen als de knoppen de lijst korter maken", () => {
  assert.equal(beperkingTekst({ mode: "lijst", periode: "alles", periodeLabel: "Alles" }), "");
  assert.equal(beperkingTekst({ mode: "lijst", periode: "maand", periodeLabel: "30 dagen" }), "De lijst toont alleen de komende 30 dagen; kies “Alles” voor de rest.");
  assert.equal(beperkingTekst({ mode: "lijst", periode: "week", periodeLabel: "7 dagen" }), "De lijst toont alleen de komende 7 dagen; kies “Alles” voor de rest.");
  assert.equal(beperkingTekst({ mode: "tijdlijn", periode: "alles" }), "De tijdlijn toont alleen de komende 14 dagen.");
  assert.equal(beperkingTekst({ mode: "tijdlijn", periode: "maand", periodeLabel: "30 dagen", dagLabel: "dinsdag 20 oktober" }), "De tijdlijn toont alleen dinsdag 20 oktober.");
  // De maand zegt zelf welke maand ze toont.
  assert.equal(beperkingTekst({ mode: "maand", periode: "week", periodeLabel: "7 dagen" }), "");
  assert.equal(beperkingTekst(), "");
});

test("plekSubTekst: het getal is alles op de plek, met de straal en de beperking erbij", () => {
  assert.equal(plekSubTekst({ totaal: 69, straat: true }), "69 items uit officiële bronnen.");
  assert.equal(plekSubTekst({ totaal: 1, straat: true }), "1 item uit officiële bronnen.");
  assert.equal(plekSubTekst({ totaal: 12, straat: true, straal: 250 }), "12 items uit officiële bronnen, ook 250 m rond de straat (terrassen alleen in de straat zelf).");
  assert.equal(plekSubTekst({ totaal: 12, straat: true, straal: 1000 }), "12 items uit officiële bronnen, ook 1 km rond de straat (terrassen alleen in de straat zelf).");
  // Een wijk of postcode heeft geen straal.
  assert.equal(plekSubTekst({ totaal: 2435, straat: false, straal: 250 }), "2435 items uit officiële bronnen.");
  assert.equal(plekSubTekst({ totaal: 40, straat: true, beperking: beperkingTekst({ mode: "lijst", periode: "maand", periodeLabel: "30 dagen" }) }),
    "40 items uit officiële bronnen. De lijst toont alleen de komende 30 dagen; kies “Alles” voor de rest.");
});

test("deelTekst: plek, getal, de beperking van de link en de zin van de komende 7 dagen", () => {
  const week = "De komende 7 dagen in jouw straat: 2 werken (lopen al).";
  assert.equal(deelTekst({ plek: "Proefstraat", totaal: 56, week }), `Proefstraat: 56 items uit officiële bronnen op de publieke agenda. ${week}`);
  assert.equal(deelTekst({ plek: "Proefstraat", totaal: 1 }), "Proefstraat: 1 item uit officiële bronnen op de publieke agenda.");
  assert.equal(deelTekst({ plek: "Proefstraat", totaal: 9, beperking: "De lijst toont alleen de komende 7 dagen; kies “Alles” voor de rest.", week }),
    `Proefstraat: 9 items uit officiële bronnen op de publieke agenda. De lijst toont alleen de komende 7 dagen; kies “Alles” voor de rest. ${week}`);
});
