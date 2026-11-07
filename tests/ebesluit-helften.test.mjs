import test from "node:test";
import assert from "node:assert/strict";
import { EBESLUIT_PAGE_SIZE, halveerVenster, searchKeyword } from "../lib/ebesluit-discovery.mjs";

// 7-11-2026: "markt" in oktober 2026 gaf 1.220 treffers over drie pagina's van 500. De laatste rij van pagina 2 stond op
// pagina 3 nog eens, dus bleef er een rij ongezien, en district-ebesluit eindigde sinds 4-11 elke nacht met
// search_incomplete. Een nagebootst eBesluit met dezelfde fout: wie bladert, ziet een rij dubbel en mist er een; wie
// een venster vraagt dat in één pagina past, krijgt alles.
const PER_DAG = 40; // 31 dagen x 40 = 1.240 treffers in oktober, net als de echte maand
const dagen = (start, end) => {
  const out = [];
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};
const rij = (id) => `<a class="result-row" data-id="${id}" data-meeting-id="m-${id}" data-content-published="true"><p class="title">Markt ${id}</p></a>`;
function nepEbesluit(vragen) {
  return async (url) => {
    const u = new URL(String(url));
    const start = u.searchParams.get("meetingDateStart"), end = u.searchParams.get("meetingDateEnd");
    const page = Number(u.searchParams.get("page")), size = Number(u.searchParams.get("pageSize"));
    vragen.push(`${start}|${end}|${page}`);
    const alle = dagen(start, end).flatMap((dag) => Array.from({ length: PER_DAG }, (_, i) => `${dag}-${i}`));
    // Vanaf pagina 2 schuift de volgorde één rij op: de laatste rij van de vorige pagina komt terug, de laatste valt weg.
    const begin = page === 0 ? 0 : page * size - 1;
    const ids = alle.slice(begin, Math.min(begin + size, alle.length - (page > 0 && alle.length > size ? 1 : 0)));
    return new Response(`<span class="result-count">${alle.length} resultaten gevonden</span>${ids.map(rij).join("")}`, { status: 200 });
  };
}

test("halveerVenster: twee helften van hele dagen, null voor één dag", () => {
  assert.deepEqual(halveerVenster("2026-10-01", "2026-10-31"), [["2026-10-01", "2026-10-16"], ["2026-10-17", "2026-10-31"]]);
  assert.deepEqual(halveerVenster("2026-10-30", "2026-10-31"), [["2026-10-30", "2026-10-30"], ["2026-10-31", "2026-10-31"]]);
  assert.deepEqual(halveerVenster("2026-12-31", "2027-01-01"), [["2026-12-31", "2026-12-31"], ["2027-01-01", "2027-01-01"]]);
  assert.equal(halveerVenster("2026-10-31", "2026-10-31"), null);
  assert.equal(halveerVenster("2026-10-31", "2026-10-01"), null);
});

test("een maand die niet in één pagina past en verschuift bij het bladeren: in helften, en dan volledig", async () => {
  const vragen = [];
  const r = await searchKeyword(nepEbesluit(vragen), "markt", { start: "2026-10-01", end: "2026-10-31" }, { retryDelayMs: 0, sleepImpl: async () => {} });
  assert.equal(r.coverage.complete, true);
  assert.equal(r.rows.length, 31 * PER_DAG);
  assert.equal(new Set(r.rows.map((x) => x.id)).size, 31 * PER_DAG, "geen rij dubbel");
  // Elk deel dat uiteindelijk telt, past in één pagina van 500 en kost één vraag.
  const helften = vragen.filter((v) => /^2026-10-(01|17)\|2026-10-(16|31)\|0$/.test(v));
  assert.equal(helften.length, 2);
  assert.ok(vragen.length <= 20, `begrensd aantal vragen (${vragen.length})`);
});

test("een jaar: kwartaal, maand en dan helften; alle maanden volledig", async () => {
  const vragen = [];
  const r = await searchKeyword(nepEbesluit(vragen), "markt", 2026, { retryDelayMs: 0, sleepImpl: async () => {} });
  assert.equal(r.coverage.complete, true);
  assert.equal(r.rows.length, 365 * PER_DAG);
  assert.ok(vragen.every((v) => Number(v.split("|")[2]) < 20), "nooit voorbij de grens van 20 pagina's");
});

test("past het venster in één pagina en blijft het toch onvolledig, dan splitst het niet (fail-closed)", async () => {
  const vragen = [];
  const r = await searchKeyword(async (url) => {
    vragen.push(String(url));
    return new Response(`<span class="result-count">3 resultaten gevonden</span>${[1, 2].map((n) => rij(`r-${n}`)).join("")}`, { status: 200 });
  }, "markt", { start: "2026-10-01", end: "2026-10-31" }, { retryDelayMs: 0, sleepImpl: async () => {} });
  assert.equal(r.coverage.complete, false);
  assert.ok(vragen.length <= 4, "geen helften als het venster al in één pagina paste");
  assert.ok(3 <= EBESLUIT_PAGE_SIZE);
});
