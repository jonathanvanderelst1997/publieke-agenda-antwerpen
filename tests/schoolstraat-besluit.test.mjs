// Eén schoolstraat, twee tijden: de stadslaag 986 gaf op 23-10-2026 voor de Jan Vanhoenackerstraat
// (SCHOOLSTR107) op woensdag "12:20-15:45", het besluit 2026_DCAN_00022 van het districtscollege
// (12 januari 2026, onderbord bij het verkeersbord C3) "van 12.20 tot 12.45 uur". De agenda toont
// er nu één: die van het besluit, met het besluit als link en de afwijking van de kaart erbij.
// De rij hieronder is de echte rij uit de laag (alleen openbare velden, een school is een instelling).
import assert from "node:assert/strict";
import test from "node:test";

import { VENSTERTIJDEN_UIT_BESLUIT, schoolstraatItems, venstertijdenVolgensBesluit } from "../lib/schoolstraten.mjs";
import { privacyFindings } from "../lib/source-feed.mjs";
import { buildStraatIndex } from "../lib/straatnamen.mjs";

const TODAY = "2026-10-23";
const streets = buildStraatIndex({ streets: [["180779", "Jan Vanhoenackerstraat", "2000", [], []]] });
const BESLUIT_URL = "https://ebesluit.antwerpen.be/zittingen/25.0902.6683.3380/agendapunten/26.0106.8305.9997";
const RIJ = Object.freeze({
  OBJECTID: 85,
  SCHOOL: "GO! Muzische basisschool K’Do",
  STRAAT: "Jan Vanhoenackersstraat",
  DISTRICT: "Antwerpen",
  STATUS: "Proefopstelling",
  INREGELING: "MA-DI-WOE-DO-VRIJ",
  AFSLUITING: "1 Nadarhek",
  PROEFOPSTELLING_DATUM: 1771804800000,
  DEFINITIEF_DATUM: null,
  GISID: "SCHOOLSTR107",
  Venstertijden_maandag: "8:20-8:45 | 15:10-15:35",
  Venstertijden_dinsdag: "8:20-8:45 | 15:10-15:35",
  Venstertijden_woensdag: "8:20-8:45 | 12:20-15:45",
  Venstertijden_donderdag: "8:20-8:45 | 15:10-15:35",
  Venstertijden_vrijdag: "8:20-8:45 | 15:10-15:35",
});
const fiche = (rij) => schoolstraatItems([{ attributes: rij }], { today: TODAY, streets }).items.find((item) => item.id === "schoolstraat-schoolstr107-2026");

test("Jan Vanhoenackerstraat: één tijd, die van het besluit, met het besluit als link", () => {
  const { items, counts } = schoolstraatItems([{ attributes: RIJ }], { today: TODAY, streets });
  const item = items.find((entry) => entry.id === "schoolstraat-schoolstr107-2026");
  assert.ok(item, "de straatfiche blijft");
  assert.equal(item.timeText, "op schooldagen: ma, di, do, vr 8.20-8.45 en 15.10-15.35; wo 8.20-8.45 en 12.20-12.45");
  assert.doesNotMatch(item.timeText, /15\.45/, "de tijd van de kaartlaag staat niet meer als venstertijd");
  assert.match(item.info, /Venstertijden volgens besluit 2026_DCAN_00022 van het districtscollege \(12 januari 2026\): ma, di, do, vr 8\.20-8\.45 en 15\.10-15\.35; wo 8\.20-8\.45 en 12\.20-12\.45\./);
  assert.match(item.info, /De kaartlaag van de stad vermeldt op woensdag 8\.20-8\.45 en 12\.20-15\.45; het besluit gaat voor\./);
  assert.equal(item.infoUrl, BESLUIT_URL);
  assert.ok(item.info.length <= 600);
  assert.deepEqual(counts.issues, { venstertijden_volgens_besluit: 1 });
  assert.deepEqual(privacyFindings(items), []);
});

test("zegt de kaartlaag hetzelfde als het besluit, dan geen afwijking en geen extra zin", () => {
  const item = fiche({ ...RIJ, Venstertijden_woensdag: "8:20-8:45 | 12:20-12:45" });
  assert.equal(item.timeText, "op schooldagen: ma, di, do, vr 8.20-8.45 en 15.10-15.35; wo 8.20-8.45 en 12.20-12.45");
  assert.doesNotMatch(item.info, /kaartlaag/);
  assert.equal(item.infoUrl, BESLUIT_URL);
});

test("beschrijft de laag een andere proef of een definitieve schoolstraat, dan geldt het besluit niet meer vanzelf", () => {
  const anders = { ...RIJ, PROEFOPSTELLING_DATUM: Date.UTC(2026, 8, 1), Venstertijden_woensdag: "8:20-8:45 | 12:00-12:30" };
  assert.equal(venstertijdenVolgensBesluit(anders).geldt, false);
  const { items, counts } = schoolstraatItems([{ attributes: anders }], { today: TODAY, streets });
  const item = items.find((entry) => entry.id === "schoolstraat-schoolstr107-2026");
  assert.match(item.timeText, /wo 8\.20-8\.45 en 12\.00-12\.30$/, "dan gewoon de kaartlaag");
  assert.equal(item.infoUrl, "https://www.antwerpen.be/product/schoolstraten");
  assert.deepEqual(counts.issues, { besluit_niet_meer_van_toepassing: 1 });
  assert.equal(venstertijdenVolgensBesluit({ ...RIJ, STATUS: "Definitief" }).geldt, false);
  assert.equal(venstertijdenVolgensBesluit({ ...RIJ, GISID: "SCHOOLSTR999" }), null);
});

test("de besluiten zelf: openbaar adres zonder query, elke weekdag leesbaar", () => {
  for (const [gisId, besluit] of Object.entries(VENSTERTIJDEN_UIT_BESLUIT)) {
    assert.match(gisId, /^SCHOOLSTR\d+$/);
    const url = new URL(besluit.url);
    assert.deepEqual([url.protocol, url.hostname, url.search, url.hash], ["https:", "ebesluit.antwerpen.be", "", ""]);
    assert.match(besluit.besluit, /^20\d\d_[A-Z]+_\d{5}$/);
    for (const dag of ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag"]) assert.ok(typeof besluit.venstertijden[dag] === "string", `${gisId} ${dag}`);
  }
});
