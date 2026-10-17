// AWV-werfdata in de browser (site/works-awv-supplement.js): alleen op exact hetzelfde GIPOD-id aan een werk dat
// al getoond wordt; een ontbrekend, ander of verouderd bestand toont niets. Alleen verzonnen gegevens.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { AWV_WERF_SOURCE_ID } from "../lib/awv-werf.mjs";
import { AWV_VEROUDERD_NA_UUR, attachAwvWorkSupplement, awvBron, awvTekst, leesAwvSupplement } from "../site/works-awv-supplement.js";

const TODAY = "2026-10-17";
const DOC = { sourceId: AWV_WERF_SOURCE_ID, retrievedAt: "2026-10-17T05:00:00.000Z", contentVersion: "2026-10-10", items: [] };
const supplement = (gipodId, extra = {}) => ({
  gipodId, werfId: 90001, afdeling: "Antwerpen", soort: [], fasen: ["Fase 2"], date: "2026-10-01", endDate: "2026-11-30", innametypes: ["Rijstrook 1"],
  doorgang: ["1 rijstrook, versmald"], snelheidsbeperking: true, doorsteek: false, bypass: [], omleidingVoor: ["fietsers"], lokaleOmleidingen: 1,
  opUvRoute: false, gewijzigd: "2026-10-10", innames: 1, ...extra,
});

test("browser: koppelen alleen op exact hetzelfde GIPOD-id; de status blijft die van GIPOD; voorbij telt niet", () => {
  const werken = [{ gipodId: 99000001, status: "Concreet gepland" }, { gipodId: 99000002, status: "In uitvoering" }, { gipodId: 99000009 }];
  const rijen = [supplement(99000001), supplement(99000002, { endDate: "2026-10-16" }), supplement(99000003)];
  const [een, twee, geen] = attachAwvWorkSupplement(werken, rijen, true, { vandaag: TODAY });
  assert.equal(een.status, "Concreet gepland");
  assert.deepEqual([een.awvSupplement.gipodId, een.awvSupplement.werfRecords], [99000001, 2], "werf 90001 telt 2 GIPOD-records die nog lopen");
  assert.equal(twee.awvSupplement, null, "een AWV-inname die voorbij is, vult niets meer aan");
  assert.equal(geen.awvSupplement, null);
  assert.ok(attachAwvWorkSupplement(werken, rijen, false).every((w) => w.awvSupplement === null && w.awvSupplementSourceLoaded === false));
});

test("browser: een ontbrekend, ander of te oud bestand toont niets", () => {
  const nu = Date.parse("2026-10-17T12:00:00Z");
  assert.deepEqual(leesAwvSupplement({ ...DOC, items: [supplement(1)] }, nu).ok, true);
  assert.equal(leesAwvSupplement({ ...DOC, items: [supplement(1)] }, nu).bijgewerkt, "2026-10-10");
  assert.equal(leesAwvSupplement(null, nu).ok, false);
  assert.equal(leesAwvSupplement({ ...DOC, sourceId: "district-kalender" }, nu).ok, false);
  const oud = leesAwvSupplement({ ...DOC, retrievedAt: new Date(nu - (AWV_VEROUDERD_NA_UUR + 1) * 3_600_000).toISOString() }, nu);
  assert.deepEqual([oud.ok, oud.reden, oud.items], [false, "verouderd", []]);
});

test("browser: de zin zegt wat AWV meldt, met bronvermelding en datum, zonder goedkeuring te suggereren", () => {
  const tekst = awvTekst({ ...supplement(99000001), werfRecords: 40 });
  assert.equal(tekst, "Volgens AWV-werfdata: ingenomen: Rijstrook 1; doorgang: 1 rijstrook, versmald; snelheidsbeperking; omleiding voor fietsers (1 lokale omleiding); fase: Fase 2; deel van AWV-werf nr. 90001 (40 GIPOD-records), AWV, afdeling Antwerpen.");
  assert.doesNotMatch(tekst, /goedgekeurd|in uitvoering|gepland/i);
  assert.equal(awvBron("2026-10-10"), "Bron: Agentschap Wegen en Verkeer (AWV), open data Werf, bijgewerkt op 10 oktober 2026");
  assert.match(awvTekst({ ...supplement(1), afdeling: "TO", innametypes: [], doorgang: [], snelheidsbeperking: false, omleidingVoor: [], lokaleOmleidingen: 0, fasen: [] }), /Tunnelorganisatie/);
});

test("de werkenlaag koppelt de aanvulling op beide plaatsen: de lijst van het district en het kader van één straat", () => {
  const bron = fs.readFileSync(new URL("../site/works-live.js", import.meta.url), "utf8");
  assert.equal((bron.match(/attachAwvWorkSupplement\(/g) || []).length, 2);
  assert.match(bron, /awvBron\(state\.awvBijgewerkt\)/);
  assert.match(bron, /AWV_METADATA_URL/);
});
