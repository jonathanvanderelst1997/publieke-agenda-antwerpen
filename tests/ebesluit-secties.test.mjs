// eBesluit /zoeken altijd met sections=OTHER. Sinds 26-10-2026 negeert eBesluit zonder die parameter het venster op
// zittingsdatum en het orgaan (proef van 3 november 2026: "evenement" in oktober en november gaf zonder 28.415
// resultaten, met sections=OTHER 81). Elke zoekvraag van de verversing (lib/ebesluit-discovery.mjs, en zo ook
// lib/ebesluit-evenementen.mjs) en van scripts/refresh-civic-decisions.mjs draagt de parameter. Geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { EBESLUIT_PAGE_SIZE, EBESLUIT_SECTIES, ebesluitZoekUrl, pageSizeChoice, searchKeyword } from "../lib/ebesluit-discovery.mjs";

const resp = (text, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => text });

test("de zoekvraag: sections=OTHER, het venster, de pagina en pagina's van 500", () => {
  const url = new URL(ebesluitZoekUrl({ query: "markt", start: "2026-10-01", end: "2026-11-30", page: 2 }));
  assert.equal(url.origin + url.pathname, "https://ebesluit.antwerpen.be/zoeken");
  assert.equal(url.searchParams.get("sections"), "OTHER");
  assert.equal(EBESLUIT_SECTIES, "OTHER");
  assert.equal(url.searchParams.get("query"), "markt");
  assert.equal(url.searchParams.get("meetingDateStart"), "2026-10-01");
  assert.equal(url.searchParams.get("meetingDateEnd"), "2026-11-30");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("pageSize"), String(EBESLUIT_PAGE_SIZE));
  assert.equal(EBESLUIT_PAGE_SIZE, 500);
});

test("de verversing vraagt /zoeken nooit zonder sections=OTHER", async () => {
  const vragen = [];
  const rij = (id, datum) => `<a class="result-row" data-id="${id}" data-meeting-id="m${id}" data-content-published="true"><p class="title">Markt Proefplein</p><span class="organ">Districtscollege Antwerpen</span><span class="date">${datum}</span></a>`;
  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/zoeken") {
      vragen.push(url);
      return resp(`<p class="result-count">2 resultaten gevonden</p>${rij("1", "05/10/2026")}${rij("2", "12/10/2026")}`);
    }
    return resp("", 404);
  };
  const resultaat = await searchKeyword(fetchImpl, "markt", { start: "2026-10-01", end: "2026-10-31" }, { attempts: 1 }, pageSizeChoice());
  assert.ok(vragen.length >= 1);
  assert.ok(vragen.every((url) => url.searchParams.get("sections") === "OTHER"), vragen.map(String).join("\n"));
  assert.equal(resultaat.rows.length, 2);
});

test("scripts/refresh-civic-decisions.mjs bouwt zijn zoekvraag met ebesluitZoekUrl (sections=OTHER, pagina's van 500)", () => {
  const bron = fs.readFileSync(new URL("../scripts/refresh-civic-decisions.mjs", import.meta.url), "utf8");
  assert.match(bron, /ebesluitZoekUrl\(/);
  assert.match(bron, /PAGE_SIZE=EBESLUIT_PAGE_SIZE/);
  assert.doesNotMatch(bron, /new URLSearchParams\(\{query/);
  // Nergens anders een eigen zoekvraag naar /zoeken: alleen ebesluitZoekUrl bouwt ze.
  const discovery = fs.readFileSync(new URL("../lib/ebesluit-discovery.mjs", import.meta.url), "utf8");
  assert.equal((discovery.match(/new URL\("\/zoeken"/g) ?? []).length, 1);
  assert.equal((discovery.match(/new URLSearchParams\(/g) ?? []).length, 1);
  const evenementen = fs.readFileSync(new URL("../lib/ebesluit-evenementen.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(evenementen, /\/zoeken["'?]/);
});
