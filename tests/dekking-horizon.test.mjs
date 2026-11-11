import test from "node:test";
import assert from "node:assert/strict";
import { meetVooruitblikPerMaand } from "../lib/dekking-horizon.mjs";
import { controleerAgendaInhoud } from "../scripts/audit-inhoud-kwaliteit.mjs";

const item = (overrides = {}) => ({
  id: "a", sourceId: "district-kalender", date: "2026-11-20",
  endDate: "2027-01-03", title: "Publiek festival", location: "Antwerpen",
  sourceUrl: "https://www.antwerpen.be/info/activiteit", scope: "district", ...overrides,
});

test("meerdaagse activiteit loopt door tot januari; markten verbergen geen gaten", () => {
  const items = [
    item(),
    item({ id: "b", date: "2027-01-05", endDate: null, scope: "stad", sourceId: "stad-ebesluit-evenementen" }),
    item({ id: "c", date: "2026-12-04", endDate: null, scope: "stad", sourceId: "stad-markten" }),
    item({ id: "oud", date: "2026-10-01", endDate: null }),
  ];
  const r = meetVooruitblikPerMaand(items, "2026-11-11");
  assert.equal(r.maanden.length, 12);
  assert.deepEqual(r.maanden.slice(0, 4), [
    { maand: "2026-11", totaal: 1, zonderMarkten: 1, district: 1, stad: 0, bronnen: 1 },
    { maand: "2026-12", totaal: 2, zonderMarkten: 1, district: 1, stad: 1, bronnen: 2 },
    { maand: "2027-01", totaal: 2, zonderMarkten: 2, district: 1, stad: 1, bronnen: 2 },
    { maand: "2027-02", totaal: 0, zonderMarkten: 0, district: 0, stad: 0, bronnen: 0 },
  ]);
  assert.equal(r.maanden.at(-1).maand, "2027-10");
});

test("ongeldige data en gebeurtenissen zonder geldige einddatum beïnvloeden het rapport niet", () => {
  const r = meetVooruitblikPerMaand([
    item({date:"2026-02-31"}),
    item({endDate:"2026-11-19"}),
    null,
  ], "2026-11-11", 2);
  assert.equal(r.maanden[0].totaal, 0);
  assert.deepEqual(meetVooruitblikPerMaand([], "2026-13-01").maanden, []);
  assert.deepEqual(meetVooruitblikPerMaand([], "2026-11-11", 25).maanden, []);
});

test("de bestaande dagelijkse inhoudsaudit rapporteert vooruitblik zonder lege maanden als fout te behandelen", () => {
  const r = controleerAgendaInhoud({
    feed: { classificationAsOf: "2026-11-11", items: [item()] },
    werken: { werken: {} },
    status: { sources: [{ sourceId:"district-kalender", fetchStatus:"ok" }] },
  });
  assert.equal(r.ok, true);
  assert.equal(r.vooruitblik.maanden[2].totaal, 1);
  assert.equal(r.vooruitblik.maanden[3].totaal, 0);
});
