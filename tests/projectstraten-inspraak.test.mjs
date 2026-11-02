// Issue #225 (30-10-2026): een inspraakmoment over een heraanleg hoort bij de straat waar het doorgaat én bij de
// projectstraten die de titel noemt, als één agendapunt met dezelfde id. Met de officiële stratenlijst van de site.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { agendaPerStraat, leesStraten, projectStraten } from "../scripts/build-straat-snapshots.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { byName } = leesStraten(ROOT);
const INSPRAAK = {
  id: "project-6accc80a332512dec219cdf5-inspraakmoment-2026-11-03",
  title: "Inspraakmoment: Heraanleg Jeruzalemstraat & Engelse Beurs",
  theme: "Activiteit", date: "2026-11-03", timeText: "19 tot 21 uur",
  location: "De Groene Waterman, Wolstraat, 2000 Antwerpen.", postcodes: ["2000"]
};
const namen = (refs) => [...new Set(refs.map((ref) => ref.name))].sort();

test("een inspraakmoment staat bij de plek én bij de projectstraten, als één agendapunt", () => {
  const [punt] = agendaPerStraat([INSPRAAK], { byName, vandaag: "2026-11-03" });
  assert.ok(punt, "het agendapunt bestaat");
  assert.deepEqual(namen(punt.__straten), ["Engelse Beurs", "Jeruzalemstraat", "Wolstraat"]);
  assert.equal(punt.id, INSPRAAK.id);
  assert.equal(punt.date, "2026-11-03");
  assert.equal(punt.timeText, "19 tot 21 uur");
});

test("alleen een districtsproject krijgt projectstraten, en alleen in zijn eigen postcodes", () => {
  assert.deepEqual(projectStraten({ ...INSPRAAK, id: "district-kalender-x" }, { byName }), []);
  assert.deepEqual(namen(projectStraten(INSPRAAK, { byName })), ["Engelse Beurs", "Jeruzalemstraat"]);
  assert.deepEqual(projectStraten({ ...INSPRAAK, postcodes: ["2660"] }, { byName }), [], "geen straat uit een andere postcode");
});

test("een voorbij inspraakmoment staat nergens meer", () => {
  assert.deepEqual(agendaPerStraat([INSPRAAK], { byName, vandaag: "2026-11-04" }), []);
});
