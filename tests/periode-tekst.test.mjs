// Periodes zoals de stad ze schrijft (foorlijst, projectpagina's): juiste data, ook over de jaargrens.
import assert from "node:assert/strict";
import test from "node:test";

import { parseDateBound, parsePeriodText } from "../lib/periode-tekst.mjs";

test("foorlijst: periodetekst met het jaar van begindatum, en over de jaargrens", () => {
  assert.deepEqual(parsePeriodText("21 november - 13 december", { refYear: 2026 }), { start: "2026-11-21", end: "2026-12-13", exact: true });
  assert.deepEqual(parsePeriodText("4 december – 3 januari", { refYear: 2026 }), { start: "2026-12-04", end: "2027-01-03", exact: true });
  assert.deepEqual(parsePeriodText("4 december  – 3 januari ", { refYear: 2026 }), { start: "2026-12-04", end: "2027-01-03", exact: true });
  assert.deepEqual(parsePeriodText("12 – 21 juli", { refYear: 2026 }), { start: "2026-07-12", end: "2026-07-21", exact: true });
  assert.deepEqual(parsePeriodText("26-sep", { refYear: 2026 }), { start: "2026-09-26", end: "2026-09-26", exact: true });
  assert.deepEqual(parsePeriodText("6 april", { refYear: 2025 }), { start: "2025-04-06", end: "2025-04-06", exact: true });
  // Zonder jaar en zonder refYear: niet raden.
  assert.equal(parsePeriodText("21 november - 13 december"), null);
});

test("projectpagina's: vage grenzen worden de ruimste dag, en dat is gemarkeerd", () => {
  assert.deepEqual(parsePeriodText("9 maart - juli 2026"), { start: "2026-03-09", end: "2026-07-31", exact: false });
  assert.deepEqual(parsePeriodText("augustus 2026 - begin 2027"), { start: "2026-08-01", end: "2027-03-31", exact: false });
  assert.deepEqual(parsePeriodText("begin 2027 - zomer 2027"), { start: "2027-01-01", end: "2027-09-22", exact: false });
  assert.deepEqual(parsePeriodText("midden augustus tot eind oktober 2026"), { start: "2026-08-10", end: "2026-10-31", exact: false });
  assert.deepEqual(parsePeriodText("december 2025 tot 13 mei 2026"), { start: "2025-12-01", end: "2026-05-13", exact: false });
  assert.deepEqual(parsePeriodText("in het voorjaar van 2027"), { start: "2027-03-21", end: "2027-06-20", exact: false });
  assert.deepEqual(parsePeriodText("18 mei t/m 9 juni 2026"), { start: "2026-05-18", end: "2026-06-09", exact: true });
  assert.deepEqual(parsePeriodText("5 tot en met 12 oktober 2026"), { start: "2026-10-05", end: "2026-10-12", exact: true });
  assert.deepEqual(parsePeriodText("22.10.2025 - 5.11.2025"), { start: "2025-10-22", end: "2025-11-05", exact: true });
  assert.deepEqual(parsePeriodText("13.11.2025 - 19.11-2025"), { start: "2025-11-13", end: "2025-11-19", exact: true });
  assert.deepEqual(parseDateBound("28 augustus 2026", "end"), { date: "2026-08-28", exact: true });
});

test("elke twijfel geeft null", () => {
  for (const text of ["4 september t/m 21 september + uitharding tot 5 oktober", "19/1 tot eind maart", "Eind mei begin juni", "vanaf 10 oktober 2022", "31 februari 2026", "winter 2026", "na de werken", ""]) {
    assert.equal(parsePeriodText(text), null, text);
  }
  // Einde vóór begin met elk een eigen jaar: geen periode.
  assert.equal(parsePeriodText("10 mei 2027 - 1 mei 2026"), null);
});
