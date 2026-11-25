// De districtskalender via de Brain Gateway (contract C6), als www.antwerpen.be automatische lezers weigert.
// Alles hier is verzonnen of nagemaakt: de pagina's, de id's, de straten en de levering; niets wordt echt opgehaald.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DISTRICT_API_URL, SOURCE_ID, run } from "../scripts/fetch-sources-district.mjs";
import { DEFAULT_DISTRICTSKALENDER_URL, validateDistrictskalenderFeed } from "../lib/districtskalender-brain.mjs";

const NOW = new Date("2026-11-25T05:00:00Z");
const CALENDAR = "https://www.antwerpen.be/info/5efb0477b118f7b19c627b69/wat-beleef-je-in-district-antwerpen";
const ID_A = "a".repeat(64);
const ID_B = "b".repeat(64);
const ID_C = "c".repeat(64);
const ID_D = "d".repeat(64);

const item = (fields = {}) => ({
  id: ID_A, title: "Kopcert XL: Bando", start: "2026-12-04T20:00", end: null, all_day: false,
  place: "Het Oude Badhuis, Verzonnenplein 38, 2060 Antwerpen", postcode: "2060", place_from: "ontmoetingscentrum",
  page: "https://oudebadhuis.antwerpen.be/bando", calendar: CALENDAR, registration: true, read_on: "2026-11-25", ...fields,
});
const feed = (items) => ({ schema_version: 1, generated_on: "2026-11-25", items });

const ACCESS_DENIED = "<html><head><title>Access Denied</title></head><body>You don't have permission. Reference #18.1 https://errors.edgesuite.net/18.1</body></html>";
const PAGINA_BANDO = "<html><head><title>Kopcert XL: Bando | Het Oude Badhuis</title></head><body><h1>Kopcert XL: Bando</h1>"
  + "<div class=\"big-date\"><span class=\"weekday\">Op vrijdag</span><span class=\"day\">4</span> <span class=\"month\">december</span> <span class=\"year\">2026</span></div>"
  + "<p>20:00 uur</p><p>Het Oude Badhuis</p><a href=\"https://www.google.com/maps?q=1,2\">Verzonnenplein 38, 2060 Antwerpen</a></body></html>";
const PAGINA_ZONDER_TITEL = "<html><head><title>Iets anders | BLOC 2030</title></head><body><h1>Iets anders</h1><p>15 december 2026</p><p>Proeflaan 110, 2030 Antwerpen</p></body></html>";

const antwoord = (status, body, headers = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });

function makeRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "districtskalender-brain-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "site", "sources"), { recursive: true });
  return root;
}
const read = (root) => JSON.parse(fs.readFileSync(path.join(root, "site", "sources", `${SOURCE_ID}.json`), "utf8"));

const fetchVan = (routes, gevraagd = []) => async (url) => {
  gevraagd.push(String(url));
  const route = routes[String(url)];
  if (!route) throw new Error(`onverwacht verzoek naar ${url}`);
  return route();
};

test("het contract: alleen een exact adres in het district, alleen pagina's van de centra of de persruimte, geen persoonsgegevens", () => {
  assert.equal(validateDistrictskalenderFeed(feed([item()])).ok, true);
  const nee = [
    ["www.antwerpen.be als pagina", feed([item({ page: "https://www.antwerpen.be/info/x" })])],
    ["een vraag in de pagina", feed([item({ page: "https://oudebadhuis.antwerpen.be/bando?utm=1" })])],
    ["geen huisnummer", feed([item({ place: "Tampicopark, 2030 Antwerpen", postcode: "2030" })])],
    ["buiten het district", feed([item({ place: "Ergens, Fictiebaan 1, 2100 Antwerpen", postcode: "2100" })])],
    ["een extra sleutel", feed([item({ beschrijving: "x" })])],
    ["een mailadres", feed([item({ title: "Info via iemand@example.com" })])],
    ["een plaats van een pagina zonder pagina", feed([item({ page: null })])],
    ["twee keer dezelfde", feed([item(), item()])],
  ];
  for (const [naam, waarde] of nee) assert.equal(validateDistrictskalenderFeed(waarde).ok, false, naam);
});

test("weigert www.antwerpen.be: de levering van Brain, elk item met een pagina daar opnieuw nagekeken; voorbij en niet bevestigd valt weg", async (t) => {
  const root = makeRoot(t);
  const gevraagd = [];
  const levering = feed([
    item(),
    item({ id: ID_B, title: "Buurtfeest Kiel", start: "2026-12-12T15:00", place: "De Kern, Toetsstraat 2, 2020 Antwerpen", postcode: "2020", place_from: "kalender", page: null, registration: false }),
    item({ id: ID_C, title: "Wintermarkt", start: "2026-12-15T14:00", end: "2026-12-15T20:00", place: "BLOC 2030, Proeflaan 110, 2030 Antwerpen", postcode: "2030", page: "https://bloc2030.antwerpen.be/wintermarkt", registration: false }),
    item({ id: ID_D, title: "Al voorbij", start: "2026-11-20", all_day: true, place: "BLOC 2030, Proeflaan 110, 2030 Antwerpen", postcode: "2030", page: "https://bloc2030.antwerpen.be/voorbij", registration: false }),
  ]);
  const statuses = await run({
    rootDir: root, clock: () => NOW, env: {}, log: () => undefined,
    fetch: fetchVan({
      [DISTRICT_API_URL]: () => antwoord(403, ACCESS_DENIED),
      [DEFAULT_DISTRICTSKALENDER_URL]: () => antwoord(200, levering),
      "https://oudebadhuis.antwerpen.be/bando": () => antwoord(200, PAGINA_BANDO),
      "https://bloc2030.antwerpen.be/wintermarkt": () => antwoord(200, PAGINA_ZONDER_TITEL),
    }, gevraagd),
  });
  assert.equal(statuses[0].fetchStatus, "ok");
  const document = read(root);
  assert.equal(document.fetchStatus, "ok");
  assert.deepEqual(document.items.map((one) => [one.title, one.date, one.timeSlot, one.timeText, one.location, one.postcodes, one.infoUrl ?? null, one.sourceUrl]), [
    ["Kopcert XL: Bando", "2026-12-04", "20:00", "20 uur", "Het Oude Badhuis, Verzonnenplein 38, 2060 Antwerpen", ["2060"], "https://oudebadhuis.antwerpen.be/bando", CALENDAR],
    ["Buurtfeest Kiel", "2026-12-12", "15:00", "15 uur", "De Kern, Toetsstraat 2, 2020 Antwerpen", ["2020"], null, CALENDAR],
  ]);
  assert.match(document.items[0].id, /^district-kal-a{24}-2026-12-04$/);
  assert.ok(!gevraagd.some((url) => url.includes("/voorbij")), "wat voorbij is, wordt niet meer gevraagd");
  assert.equal(gevraagd.filter((url) => url.startsWith("https://www.antwerpen.be")).length, 1, "www.antwerpen.be één keer, de gewone poging; daarna niets meer");
});

test("weigert www.antwerpen.be en heeft de Gateway niets bruikbaars: de vorige stand blijft, met de weigering als reden", async (t) => {
  for (const gateway of [() => antwoord(503, { code: "districtskalender_unavailable" }), () => antwoord(200, feed([item({ page: "https://www.antwerpen.be/x" })]))]) {
    const root = makeRoot(t);
    await run({
      rootDir: root, clock: () => NOW, env: {}, log: () => undefined,
      fetch: fetchVan({ [DISTRICT_API_URL]: () => antwoord(403, ACCESS_DENIED), [DEFAULT_DISTRICTSKALENDER_URL]: gateway }),
    });
    const document = read(root);
    assert.equal(document.fetchStatus, "error");
    assert.equal(document.lastError.code, "bron_weigert_automatisch");
    assert.deepEqual(document.items, []);
  }
});

test("een andere fout dan een weigering (het net, een time-out): Brain wordt niet gevraagd", async (t) => {
  const root = makeRoot(t);
  const gevraagd = [];
  await run({
    rootDir: root, clock: () => NOW, env: {}, log: () => undefined,
    fetch: fetchVan({ [DISTRICT_API_URL]: () => { throw new Error("ECONNRESET"); } }, gevraagd),
  });
  assert.ok(!gevraagd.includes(DEFAULT_DISTRICTSKALENDER_URL));
  assert.equal(read(root).fetchStatus, "error");
});
