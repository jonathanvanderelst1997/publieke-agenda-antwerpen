// Waarom de agenda "0 mailsignalen" toonde (controle na de wens van de eigenaar van 28-09-2026), per oorzaak aan
// deze kant een toets. Gemeten op 12-10-2026: de Gateway antwoordt 200 met generated_on van vandaag en een
// lege lijst, dus de nul komt van de Mac (zie de overdracht); hier lag één oorzaak die een signaal van de
// Mac alsnog liet vallen: de datumtoets op de officiële pagina was strenger dan de paginapoort van de Mac
// (src/publieke-agenda/datums.ts). Alles hier is verzonnen: pagina's, titels, id's.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { run } from "../scripts/fetch-sources-mail.mjs";
import { dateOnPage, pageText, sha256Hex } from "../lib/mail-signals.mjs";

const NOW = new Date("2026-09-28T06:00:00Z");
const ENDPOINT = "https://gateway.example.invalid/v1/publiek/publieke-agenda/mail-signalen.json";
const URL_A = "https://www.antwerpen.be/info/bbbbbbbbbbbbbbbbbbbbbbbb/proefweek-in-het-park";

const signal = (url, fields = {}) => ({
  id: sha256Hex(url), title: "Proefweek in het Park", start: "2026-10-03", end: "2026-10-25", all_day: true, place: null, url,
  group: "district", source: "mail-nieuwsbrief", sender_class: "district_nieuwsbrief", first_seen: "2026-09-27", page_checked_on: "2026-09-27", ...fields,
});
const payload = (items) => ({ schema_version: 1, generated_on: "2026-09-27", items });
const response = (status, body = "") => {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => text, json: async () => JSON.parse(text) };
};
const fetchVan = (routes) => async (url) => {
  const route = routes[String(url)];
  if (!route) throw new Error(`onverwacht verzoek naar ${url}`);
  return route();
};
function makeRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mail-oorzaken-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "site", "sources"), { recursive: true });
  return root;
}
const read = (root, id) => JSON.parse(fs.readFileSync(path.join(root, "site", "sources", `${id}.json`), "utf8"));

test("de datumtoets leest de vormen die de paginapoort van de Mac als datum leest", () => {
  const t = (html) => pageText(`<p>${html}</p>`);
  // Een reeks: de begindag staat er zonder maand, de maand staat achter het einde.
  assert.equal(dateOnPage("2026-10-03", t("Wanneer: van 3 tot 25 oktober")), true);
  assert.equal(dateOnPage("2026-10-03", t("Wanneer: 3 t.e.m. 25 okt.")), true);
  assert.equal(dateOnPage("2026-09-03", t("Wanneer: do 3 t.e.m. vr 25/9")), true);
  assert.equal(dateOnPage("2026-10-03", t("Wanneer: 3 - 25 oktober")), true);
  // Een afgekorte maand en een datum met punten of streepjes en het jaar.
  assert.equal(dateOnPage("2026-10-17", t("Praktisch: za 17 okt. om 14 uur")), true);
  assert.equal(dateOnPage("2026-09-05", t("Datum: 5 sept 2026")), true);
  assert.equal(dateOnPage("2026-10-17", t("Datum: 17.10.2026")), true);
  assert.equal(dateOnPage("2026-10-17", t("Datum: 17-10-2026")), true);
  // De vormen van voordien blijven gelden.
  assert.equal(dateOnPage("2026-10-17", t("Zaterdag 17 oktober")), true);
  assert.equal(dateOnPage("2026-10-17", t("zaterdag 17/10")), true);
  // En wat geen bewijs is, blijft het niet.
  assert.equal(dateOnPage("2026-10-03", t("Wanneer: 13 oktober")), false, "13 is geen 3");
  assert.equal(dateOnPage("2026-10-03", t("Wanneer: 3 tot 25 november")), false, "een andere maand");
  assert.equal(dateOnPage("2026-10-03", t("van 3 tot 5 uur op 20 oktober")), false, "een uur is geen dag");
  assert.equal(dateOnPage("2026-10-17", t("Datum: 17.10.2025")), false, "een ander jaar");
  assert.equal(dateOnPage("2026-10-17", t("Datum: 17.10")), false, "zonder jaar is 17.10 ook een uur");
  assert.equal(dateOnPage("2026-10-01", t("Prijs: 1 - 15 euro, 20 oktober")), false);
});

test("een signaal met een reeks die de Mac doorliet, komt nu op de agenda met begin en einde", async (t) => {
  const root = makeRoot(t);
  const page = "<html><body><h1>Proefweek in het Park</h1><p>Wanneer: van 3 tot 25 oktober</p><p>Waar: Proefpark</p></body></html>";
  const fetch = fetchVan({ [ENDPOINT]: () => response(200, payload([signal(URL_A)])), [URL_A]: () => response(200, page) });
  const logs = [];
  await run({ rootDir: root, env: { MAIL_SIGNALEN_URL: ENDPOINT }, fetch, clock: () => NOW, log: (regel) => logs.push(JSON.parse(regel)) });
  const items = read(root, "mail-district").items;
  assert.equal(items.length, 1, JSON.stringify(logs));
  assert.deepEqual([items[0].title, items[0].date, items[0].endDate, items[0].timeSlot], ["Proefweek in het Park", "2026-10-03", "2026-10-25", "Info"]);
  assert.equal(items[0].location, "locatie via de officiële bron", "de plaats stond niet in het signaal");
});

test("een lege lijst van de Gateway is 'ok' met 0 signalen: de nul komt van de Mac, niet van een filter hier", async (t) => {
  const root = makeRoot(t);
  const fetch = fetchVan({ [ENDPOINT]: () => response(200, { schema_version: 1, generated_on: "2026-09-28", items: [] }) });
  const logs = [];
  const status = await run({ rootDir: root, env: { MAIL_SIGNALEN_URL: ENDPOINT }, fetch, clock: () => NOW, log: (regel) => logs.push(JSON.parse(regel)) });
  assert.deepEqual(logs.at(-1), { source: "mail", fetchStatus: "ok", signals: 0, district: 0, stad: 0, reasons: {} });
  assert.deepEqual(status.map((s) => [s.sourceId, s.fetchStatus, s.itemCount]), [["mail-district", "ok", 0], ["mail-stad", "ok", 0]]);
});
