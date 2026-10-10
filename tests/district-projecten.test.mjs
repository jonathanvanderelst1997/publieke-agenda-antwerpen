// Projectpagina's van district Antwerpen (portaal-API, contentType 9): inspraakmomenten, bevragingen
// en fasen als agendapunten, en een strikte privacygrens. Verzonnen fixture.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { isProjectPage, momentFromBlock, parseTijdstip, projectChannelUrl, projectItems, projectPage, surveyFromBlock, zonderHuisnummers } from "../lib/district-projecten.mjs";
import { privacyFindings, validateSourceDocument } from "../lib/source-feed.mjs";
import { PROJECT_MAX_PAGES, PROJECT_PAGE_SIZE, SOURCE_ID, run } from "../scripts/fetch-sources-projecten.mjs";

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/p7/projecten.json", import.meta.url), "utf8"));
const TODAY = "2026-10-10";
const quiet = () => {};
const noPause = async () => {};

test("inspraak- en infomomenten: datum, uur en plaats uit de gelabelde regels", () => {
  const moment = momentFromBlock(["Infomoment 20 oktober 2026", "Kom langs.", "datum: dinsdag 20 oktober 2026", "tijdstip: doorlopend tussen 18u en 20u30, kom langs wanneer het jou past", "locatie: Zaal De Proef - Proefstraat 18, 2060 Antwerpen"]);
  assert.deepEqual(moment, { kind: "Infomoment", date: "2026-10-20", timeSlot: "18:00", timeText: "18 tot 20.30 uur", place: "Zaal De Proef - Proefstraat, 2060 Antwerpen" });
  assert.deepEqual(parseTijdstip("doorlopend van 17.00 uur tot 21.00 uur"), { timeSlot: "17:00", timeText: "17 tot 21 uur" });
  assert.deepEqual(parseTijdstip("start om 19 uur en einde voorzien om 20 uur"), { timeSlot: "19:00", timeText: "19 uur" });
  assert.deepEqual(parseTijdstip("Spring binnen tussen 17 en 20 uur."), { timeSlot: "17:00", timeText: "17 tot 20 uur" });
  // Zonder jaar of zonder datumregel: geen moment.
  assert.equal(momentFromBlock(["Inspraakmoment", "Op 18 juni organiseerde district antwerpen een inspraakmoment."]), null);
  assert.equal(momentFromBlock(["Over het project", "datum: dinsdag 20 oktober 2026"]), null);
});

test("bevraging: een deadline, nooit uit een zin in de verleden tijd", () => {
  assert.deepEqual(surveyFromBlock(["Online bevraging", "De bevraging loopt van 1 oktober 2026 tot en met 15 november 2026."]), { start: "2026-10-01", deadline: "2026-11-15" });
  assert.deepEqual(surveyFromBlock(["Digitale Bevraging", "Vul nu de bevraging in.", "Deelnemen kan tot en met 15 november 2026."]), { start: null, deadline: "2026-11-15" });
  assert.equal(surveyFromBlock(["Bevraging proefopstelling", "Je kon je mening geven tot en met 10 maart 2024."]), null);
});

test("fixture: momenten, bevraging en fasen; alleen projecten, alleen wat nog komt of loopt", () => {
  const { items, counts } = projectItems(fixture.data, { today: TODAY });
  assert.deepEqual(
    items.map((item) => [item.id, item.theme, item.date, item.endDate, item.title]),
    [
      ["project-6a00000000000000000000a1-infomoment-2026-10-20", "Activiteit", "2026-10-20", null, "Infomoment: Heraanleg Voorbeeldstraat en Proefstraat"],
      ["project-6a00000000000000000000a1-werfbezoek-2026-11-07", "Activiteit", "2026-11-07", null, "Werfbezoek: Heraanleg Voorbeeldstraat en Proefstraat"],
      ["project-6a00000000000000000000a1-bevraging-2026-11-15", "Oproep/deadline", "2026-10-01", "2026-11-15", "Bevraging: Heraanleg Voorbeeldstraat en Proefstraat"],
      // "augustus 2026" uit de tabel wordt de exacte startdag uit het blok "Fase 2: … Start: 3 augustus 2026".
      ["project-6a00000000000000000000a1-fase-2-2026-08-03", "Werken", "2026-08-03", "2027-03-31", "Heraanleg Voorbeeldstraat en Proefstraat: fase 2 (Proefstraat + Voorbeeldstraat)"],
      ["project-6a00000000000000000000a1-fase-3-2027-01-01", "Werken", "2027-01-01", "2027-09-22", "Heraanleg Voorbeeldstraat en Proefstraat: fase 3 (Proefplein)"],
      ["project-6a00000000000000000000a1-fase-4-2027-04-20", "Werken", "2027-04-20", "2027-05-31", "Heraanleg Voorbeeldstraat en Proefstraat: fase 4, deel 1 (Voorbeeldstraat)"],
      ["project-6a00000000000000000000a1-fase-4-2028-03-01", "Werken", "2028-03-01", "2028-03-31", "Heraanleg Voorbeeldstraat en Proefstraat: fase 4, deel 2 (Voorbeeldstraat)"],
      ["project-6a00000000000000000000e5-fase-1a-2026-10-05", "Werken", "2026-10-05", "2026-10-12", "Vergroening Blokstraat: fase 1A (Blokstraat)"],
    ]
  );
  assert.deepEqual([counts.projects, counts.past, counts.unreadablePeriods], [3, 2, 2]);
  const fase2 = items.find((item) => item.id.endsWith("fase-2-2026-08-03"));
  assert.equal(fase2.timeText, "augustus 2026 - begin 2027 (data bij benadering)");
  assert.equal(fase2.sourceUrl, "https://www.antwerpen.be/info/6a00000000000000000000a1/heraanleg-voorbeeldstraat-en-proefstraat");
  assert.deepEqual(fase2.postcodes, ["2060"]);
});

test("privacy: geen personeelsvelden, namen, telefoon, e-mail, IBAN, huisnummers of het blok Samenstelling", () => {
  const { items } = projectItems(fixture.data, { today: TODAY });
  const text = JSON.stringify(items);
  for (const forbidden of ["Verzonnen", "creator", "assignee", "lockOwner", "0470", "@", "BE71", "Samenstelling", "huisnummer", "Proefstraat 18", "Proefstraat 60", "Partij X", "example.invalid"]) {
    assert.ok(!text.includes(forbidden), forbidden);
  }
  assert.deepEqual(privacyFindings(items), []);
  // projectPage() houdt alleen titel, tags, publishUntil en tekstblokken over.
  const page = projectPage(fixture.data[0]);
  assert.deepEqual(Object.keys(page).sort(), ["blocks", "id", "publishUntil", "slug", "tags", "title"]);
  assert.ok(!JSON.stringify(page).includes("Verzonnen"));
  // De samenstelling van de districtsraad en infofiches buiten de publieke ruimte zijn geen projecten.
  assert.equal(isProjectPage(projectPage(fixture.data[1])), false);
  assert.equal(isProjectPage(projectPage(fixture.data[2])), false);
  assert.equal(zonderHuisnummers("Xstraat 12"), "Xstraat");
  assert.equal(zonderHuisnummers("Spaarstraat van huisnummer 16 tot en met 38"), "Spaarstraat");
  assert.equal(zonderHuisnummers("Werfkeet, bel 0470 11 22 33 of mail werf@example.invalid"), "Werfkeet");
});

// ---------- fetcher ----------

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "district-projecten-"));
  fs.mkdirSync(path.join(root, "site", "sources"), { recursive: true });
  return root;
}
const read = (root) => JSON.parse(fs.readFileSync(path.join(root, "site", "sources", `${SOURCE_ID}.json`), "utf8"));
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const clock = () => new Date("2026-10-10T03:22:00Z");

test("fetcher: bladert met pauzes, hoogstens PROJECT_MAX_PAGES pagina's, en schrijft een geldig brondocument", async () => {
  const root = makeRoot();
  const requested = [];
  let pauses = 0;
  const full = { data: Array.from({ length: PROJECT_PAGE_SIZE }, (_, index) => ({ ...fixture.data[4], id: `6a0000000000000000000${String(100 + index)}` })), meta: { more: true } };
  const status = await run({
    rootDir: root,
    clock,
    log: quiet,
    sleep: async () => { pauses += 1; },
    fetch: async (url) => {
      requested.push(url);
      return json(requested.length === 1 ? fixture : full);
    },
  });
  // De fixture-pagina is korter dan PROJECT_PAGE_SIZE: na één verzoek klaar.
  assert.equal(status[0].fetchStatus, "ok");
  assert.deepEqual([requested.length, pauses], [1, 0]);
  assert.equal(requested[0], projectChannelUrl({ start: 0, limit: PROJECT_PAGE_SIZE }));
  const document = read(root);
  assert.deepEqual(validateSourceDocument(document, { expectedSourceId: SOURCE_ID }), []);
  assert.equal(document.items.length, 8);

  const many = [];
  await run({ rootDir: makeRoot(), clock, log: quiet, sleep: noPause, fetch: async (url) => { many.push(url); return json(full); } });
  assert.equal(many.length, PROJECT_MAX_PAGES);
});

test("fetcher: faalt de bron, dan blijft het vorige antwoord en zegt refresh-status waarom", async () => {
  const root = makeRoot();
  await run({ rootDir: root, clock, log: quiet, sleep: noPause, fetch: async () => json(fixture) });
  const before = read(root);
  for (const [fetchImpl, code] of [
    [async () => json({}, 502), "http_502"],
    [async () => json({ data: [] }), "no_pages"],
    [async () => ({ ok: true, status: 200, json: async () => { throw new Error("geen json"); } }), "invalid_json"],
    [async () => json({ data: [fixture.data[1], fixture.data[2]] }), "no_projects"],
  ]) {
    const status = await run({ rootDir: root, clock, log: quiet, sleep: noPause, fetch: fetchImpl });
    assert.deepEqual([status[0].fetchStatus, status[0].errorCode], ["error", code]);
    assert.deepEqual(read(root).items, before.items);
  }
});
