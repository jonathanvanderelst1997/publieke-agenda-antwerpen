import test from "node:test";
import assert from "node:assert/strict";
import { EBESLUIT_PAGE_SIZE, searchKeyword } from "../lib/ebesluit-discovery.mjs";

// Synthetische openbare zoekrijen: geen netwerk of persoonsgegevens nodig.
const row = (id) => `<a class="result-row" data-id="r-${id}" data-meeting-id="meeting-test" data-content-published="true"><p class="title">Markt ${id}</p></a>`;
const html = (total, ids) => `${total === null ? "" : `<span class="result-count">${total} resultaten gevonden</span>`}${ids.map(row).join("")}`;
async function search(pages, options = {}) {
  const seen = [];
  const fetchImpl = async (url) => {
    const page = Number(new URL(String(url)).searchParams.get("page"));
    seen.push(page);
    return { ok: true, status: 200, text: async () => pages(page) };
  };
  const result = await searchKeyword(fetchImpl, "markt", { start: "2026-10-01", end: "2026-10-31" }, {
    retryDelayMs: 0, sleepImpl: async () => {}, ...options,
  });
  return { ...result, seen };
}

test("korte serverpagina met positief resterend totaal wordt verder opgehaald", async () => {
  const r = await search((page) => page === 0 ? html(3, [1, 2]) : html(3, [3]));
  assert.equal(r.coverage.complete, true);
  assert.equal(r.rows.length, 3);
  assert.deepEqual(r.seen, [0, 1]);
});

test("lege vervolgpagina met ontbrekende treffers is geen volledige zoekronde", async () => {
  const r = await search((page) => page === 0 ? html(3, [1, 2]) : html(3, []));
  assert.equal(r.coverage.complete, false);
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.seen, [0, 1, 0, 1], "bestaand maandpad controleert eenmalig hetzelfde venster");
});

test("positief totaal zonder leesbare resultaten blijft onvolledig", async () => {
  const r = await search(() => html(3, []));
  assert.equal(r.coverage.complete, false);
  assert.equal(r.rows.length, 0);
});

test("expliciet nul resultaten en een lege pagina zijn wel volledig", async () => {
  const r = await search(() => html(0, []));
  assert.equal(r.coverage.complete, true);
  assert.equal(r.rows.length, 0);
  assert.deepEqual(r.seen, [0]);
});

test("herhaalde volle pagina zonder teller eindigt begrensd en onvolledig", async () => {
  const ids = Array.from({ length: EBESLUIT_PAGE_SIZE }, (_, i) => i + 1);
  const r = await search(() => html(null, ids));
  assert.equal(r.coverage.complete, false);
  assert.equal(r.rows.length, EBESLUIT_PAGE_SIZE);
  assert.deepEqual(r.seen, [0, 1, 0, 1]);
});

test("gewone korte eindpagina zonder teller blijft geldig", async () => {
  const r = await search(() => html(null, [1, 2]));
  assert.equal(r.coverage.complete, true);
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.seen, [0]);
});

test("deeltelijk overlappende paginas tellen unieke besluiten en halen resterende op", async () => {
  const r = await search((page) => page === 0 ? html(3, [1, 2]) : html(3, [2, 3]));
  assert.equal(r.coverage.complete, true);
  assert.equal(r.rows.length, 3);
  assert.deepEqual(r.rows.map((item) => item.id), ["r-1", "r-2", "r-3"]);
});

test("minder gemelde treffers dan unieke gelezen rijen is een bronconflict", async () => {
  const r = await search(() => html(1, [1, 2]));
  assert.equal(r.coverage.complete, false);
  assert.equal(r.rows.length, 2);
});
