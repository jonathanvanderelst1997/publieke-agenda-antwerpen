// De koopzondagen van stad Antwerpen (https://www.antwerpen.be/info/koopzondagen) als gratis
// stadsbron. Alles offline, met een opgeschoonde fixture: alleen het artikelblok, zonder scripts,
// zonder het contactblok en zonder de kaartlink met querystring.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { weekdayOfIso } from "../lib/html-text.mjs";
import { INFO, KOOPZONDAGEN_URL, LOCATION, POSTCODES, koopzondagTitle, parseKoopzondagLine, parseKoopzondagenHtml } from "../lib/koopzondagen.mjs";
import { SOURCE_PRECEDENCE, mergeEvents } from "../lib/merge-events.mjs";
import { FORBIDDEN_KEYS, shrinkGuardFor, sourceDocument, validateSourceDocument } from "../lib/source-feed.mjs";
import { FETCHERS } from "../lib/source-registry.mjs";
import { MAX_HTML_BYTES, SOURCE_ID, run } from "../scripts/fetch-sources-koopzondagen.mjs";

const page = fs.readFileSync(new URL("./fixtures/koopzondagen-2026-09-28.article.html", import.meta.url), "utf8");
const TODAY = "2026-09-28";
const NOW = new Date("2026-09-28T06:00:00Z");
const clock = () => NOW;
const quiet = () => {};

function makeRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stad-koopzondagen-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "site", "sources"), { recursive: true });
  return root;
}
const read = (root) => JSON.parse(fs.readFileSync(path.join(root, "site", "sources", `${SOURCE_ID}.json`), "utf8"));

function html(body, status = 200, type = "text/html; charset=utf-8") {
  return { ok: status >= 200 && status < 300, status, headers: { get: (name) => (name.toLowerCase() === "content-type" ? type : null) }, text: async () => body };
}

// Het contactblok zoals het onder de echte pagina staat, met verzonnen gegevens: het mag nooit gelezen worden.
const CONTACT_BLOCK =
  '<div class="wdg-o-organisationbig"><h3>Neem contact op</h3><p>Loket Ondernemen</p><p>03 123 45 67</p><p><a href="mailto:loket@example.invalid">loket@example.invalid</a></p><p>Koopzondagen in 2027: zie later</p></div>';
// De Next.js-payload herhaalt de lijst ge-escapet in een script; die telt nooit mee.
const RSC_SCRIPT =
  '<script>self.__next_f.push([1,"\\u003cp\\u003e\\u003cstrong\\u003eKoopzondagen in 2026:\\u0026nbsp;\\u003c/strong\\u003e\\u003c/p\\u003e\\u003cul\\u003e\\u003cli\\u003e4 oktober 2026\\u003c/li\\u003e"])</script>';

// ---------- parser ----------

test("fixture: alleen komende koopzondagen, titel met context, vaste plaats in het toeristisch centrum", () => {
  const result = parseKoopzondagenHtml(page, { today: TODAY });
  assert.deepEqual([result.lists, result.lines, result.dropped, result.issues], [1, 15, 9, []]);
  assert.deepEqual(
    result.items.map((item) => [item.id, item.date, item.title]),
    [
      ["koopzondag-2026-10-04", "2026-10-04", "Koopzondag"],
      ["koopzondag-2026-11-01", "2026-11-01", "Koopzondag (Allerheiligen)"],
      ["koopzondag-2026-12-06", "2026-12-06", "Koopzondag"],
      ["koopzondag-2026-12-13", "2026-12-13", "Koopzondag"],
      ["koopzondag-2026-12-20", "2026-12-20", "Koopzondag"],
      ["koopzondag-2026-12-27", "2026-12-27", "Koopzondag"],
    ]
  );
  for (const item of result.items) {
    assert.equal(weekdayOfIso(item.date), 0, `${item.date} is een zondag`);
    assert.deepEqual(
      [item.location, item.postcodes, item.inDistrict, item.timeSlot, item.timeText, item.sourceUrl, item.info, item.kind, item.theme],
      [LOCATION, ["2000", "2018"], true, "Info", "", KOOPZONDAGEN_URL, INFO, "activity", "Activiteit"]
    );
  }
  // Vroeger in het jaar komt de context van de lijst mee.
  const january = parseKoopzondagenHtml(page, { today: "2026-01-01" });
  assert.deepEqual(january.items.slice(0, 1).map((item) => item.title), ["Koopzondag (wintersolden)"]);
  assert.equal(january.items.find((item) => item.date === "2026-07-05").title, "Koopzondag (zomersolden)");
  assert.equal(january.items.length, 15);
});

test("regel: alleen '<dag> <maand> <jaar>' met een korte context; elke twijfel wordt niet gepubliceerd", () => {
  assert.deepEqual(parseKoopzondagLine("4 oktober 2026", 2026), { date: "2026-10-04", context: "" });
  assert.deepEqual(parseKoopzondagLine("5 april 2026: Pasen", 2026), { date: "2026-04-05", context: "Pasen" });
  assert.deepEqual(parseKoopzondagLine("1 november 2026&nbsp;: Allerheiligen.", 2026), { date: "2026-11-01", context: "Allerheiligen" });
  assert.equal(parseKoopzondagLine("3 oktober 2026", 2026).issue, "not_sunday");
  assert.equal(parseKoopzondagLine("3 januari 2027", 2026).issue, "year_mismatch");
  assert.equal(parseKoopzondagLine("31 november 2026", 2026).issue, "invalid_date");
  for (const text of ["4 oktober 2026 van 13 tot 18 uur", "4 oktober 2026: open van 13 tot 18 uur", "zondag 4 oktober", "Tot 30 september", "4/10/2026", ""]) {
    assert.equal(parseKoopzondagLine(text, 2026).issue, "unreadable_line", text);
  }
  assert.equal(koopzondagTitle(""), "Koopzondag");
  assert.equal(koopzondagTitle("zomersolden"), "Koopzondag (zomersolden)");
});

test("scripts en het contactblok worden nooit gelezen; een kop zonder lijst is een probleem", () => {
  const withNoise = page.replace("</body>", `${RSC_SCRIPT}${CONTACT_BLOCK}</body>`);
  const noisy = parseKoopzondagenHtml(withNoise, { today: TODAY });
  assert.deepEqual(noisy.items, parseKoopzondagenHtml(page, { today: TODAY }).items);
  assert.equal(noisy.lists, 1, "de ge-escapete lijst in het script telt niet");
  assert.doesNotMatch(JSON.stringify(noisy), /example\.invalid|03 123|Loket/);

  const onlyScript = parseKoopzondagenHtml(`<html><body>${RSC_SCRIPT}</body></html>`, { today: TODAY });
  assert.deepEqual([onlyScript.lists, onlyScript.items.length, onlyScript.issues], [0, 0, []]);
  // Een ge-escapete harde spatie of een dubbelpunt na </strong> is dezelfde kop, geen andere opmaak.
  for (const heading of ["<p><strong>Koopzondagen in 2026&nbsp;:</strong></p>", "<p><strong>Koopzondagen in 2026</strong>:&nbsp;</p>", "<p><strong>Koopzondagen in 2026:&nbsp;</strong></p>\n"]) {
    const variant = parseKoopzondagenHtml(`${heading}<ul><li>4 oktober 2026</li></ul>`, { today: TODAY });
    assert.deepEqual([variant.lists, variant.items.map((item) => item.date), variant.issues], [1, ["2026-10-04"], []], heading);
  }
  const changed = parseKoopzondagenHtml("<p><strong>Koopzondagen in 2026:</strong></p><p>4 oktober 2026, 1 november 2026</p>", { today: TODAY });
  assert.deepEqual([changed.lists, changed.issues.map((issue) => issue.code)], [0, ["heading_without_list"]]);
});

test("twee jaarlijsten rond de jaarwissel; een datum die twee keer staat, telt één keer", () => {
  const two =
    "<p><strong>Koopzondagen in 2026:</strong></p><ul><li>27 december 2026</li><li>27 december 2026</li></ul>" +
    "<p><strong>Koopzondagen in 2027:</strong></p><ul><li>3 januari 2027: wintersolden</li><li>7 februari 2027</li></ul>";
  const result = parseKoopzondagenHtml(two, { today: "2026-12-20" });
  assert.deepEqual(result.items.map((item) => [item.date, item.title]), [
    ["2026-12-27", "Koopzondag"],
    ["2027-01-03", "Koopzondag (wintersolden)"],
    ["2027-02-07", "Koopzondag"],
  ]);
  assert.deepEqual([result.lists, result.issues.map((issue) => issue.code)], [2, ["duplicate_date"]]);
});

// ---------- fetcher ----------

test("fetcher: één GET naar de infopagina, geldig brondocument zonder contactgegevens", async (t) => {
  const root = makeRoot(t);
  const requested = [];
  const status = await run({
    rootDir: root,
    clock,
    env: {},
    log: quiet,
    fetch: async (url, options) => {
      requested.push([String(url), options.headers.accept, options.redirect]);
      return html(page.replace("</body>", `${RSC_SCRIPT}${CONTACT_BLOCK}</body>`));
    },
  });
  assert.deepEqual(requested, [["https://www.antwerpen.be/info/koopzondagen", "text/html", "error"]]);
  assert.deepEqual([status[0].sourceId, status[0].fetchStatus, status[0].itemCount, status[0].errorCode], [SOURCE_ID, "ok", 6, null]);
  const document = read(root);
  assert.deepEqual(validateSourceDocument(document, { expectedSourceId: SOURCE_ID }), []);
  assert.deepEqual([document.scope, document.publisher, document.allowedHosts], ["stad", "Stad Antwerpen", ["www.antwerpen.be"]]);
  assert.deepEqual(document.attribution, { text: "Bron: stad Antwerpen, koopzondagen (Vlaamse gratis open data licentie)", url: KOOPZONDAGEN_URL });
  const text = JSON.stringify(document);
  assert.doesNotMatch(text, /example\.invalid|03 123|Loket|arcgis|@/);
  for (const key of FORBIDDEN_KEYS) assert.ok(!text.includes(`"${key}"`), key);
  assert.ok(document.items.every((item) => item.date >= TODAY && item.retrievedAt === NOW.toISOString()));
});

test("fetcher: storing, geen HTML of een andere opmaak wist niets", async (t) => {
  const root = makeRoot(t);
  await run({ rootDir: root, clock, env: {}, log: quiet, fetch: async () => html(page) });
  const before = read(root);
  for (const [response, code] of [
    [html("", 503), "http_503"],
    [html("{}", 200, "application/json"), "not_html"],
    [html("<html><body><h1>Koopzondagen</h1><p>Deze pagina is verhuisd.</p></body></html>"), "no_list"],
    [{ ...html(""), text: async () => { throw new TypeError("terminated"); } }, "body_read_failed"],
    [html(`${page}${" ".repeat(MAX_HTML_BYTES)}`), "too_large"],
  ]) {
    const status = await run({ rootDir: root, clock, env: {}, log: quiet, fetch: async () => response });
    assert.deepEqual([status[0].fetchStatus, status[0].errorCode, status[0].itemCount], ["error", code, 6], code);
    assert.deepEqual(read(root).items, before.items, code);
  }
  const offline = await run({ rootDir: root, clock, env: {}, log: quiet, fetch: async () => { throw new Error("offline"); } });
  assert.deepEqual([offline[0].fetchStatus, offline[0].errorCode], ["error", "network_error"]);
});

test("fetcher: een afgebroken body krijgt precies één herkansing", async (t) => {
  const kapot = { ...html(""), text: async () => { throw new TypeError("terminated"); } };
  const root = makeRoot(t);
  let calls = 0;
  const status = await run({ rootDir: root, clock, env: {}, log: quiet, fetch: async () => (++calls === 1 ? kapot : html(page)) });
  assert.equal(calls, 2);
  assert.equal(status[0].fetchStatus, "ok");
  assert.equal(read(root).items.length, 6);

  let tweeKeer = 0;
  const opnieuw = await run({ rootDir: root, clock, env: {}, log: quiet, fetch: async () => { tweeKeer += 1; return kapot; } });
  assert.equal(tweeKeer, 2);
  assert.deepEqual([opnieuw[0].fetchStatus, opnieuw[0].errorCode], ["error", "body_read_failed"]);

  let eenKeer = 0;
  await run({ rootDir: root, clock, env: {}, log: quiet, fetch: async () => { eenKeer += 1; return html("", 503); } });
  assert.equal(eenKeer, 1, "andere fouten krijgen geen herkansing");
});

test("fetcher: een lijst die ineens leeg is, is suspicious_drop; voorbije koopzondagen tellen nooit als krimp", async (t) => {
  const root = makeRoot(t);
  await run({ rootDir: root, clock, env: {}, log: quiet, fetch: async () => html(page) });
  const before = read(root);
  const unreadable = "<p><strong>Koopzondagen in 2026:</strong></p><ul><li>eerste zondag van de maand</li></ul>";
  const status = await run({ rootDir: root, clock, env: {}, log: quiet, fetch: async () => html(unreadable) });
  assert.deepEqual([status[0].fetchStatus, status[0].errorCode], ["error", "suspicious_drop"]);
  assert.deepEqual(read(root).items, before.items);
  assert.equal(shrinkGuardFor(SOURCE_ID), true, "ook sources:health vergelijkt met HEAD");

  // Na de laatste koopzondag van het jaar staat de lijst van 2026 er nog: 0 komende is dan gezond.
  const later = await run({ rootDir: root, clock: () => new Date("2027-01-15T06:00:00Z"), env: {}, log: quiet, fetch: async () => html(page) });
  assert.deepEqual([later[0].fetchStatus, later[0].itemCount], ["ok", 0]);
});

test("--dry-run schrijft niets", async (t) => {
  const root = makeRoot(t);
  const logs = [];
  const status = await run({ rootDir: root, clock, env: {}, dryRun: true, log: (line) => logs.push(JSON.parse(line)), fetch: async () => html(page) });
  assert.deepEqual([status[0].fetchStatus, status[0].itemCount], ["ok", 6]);
  assert.equal(fs.existsSync(path.join(root, "site", "sources", `${SOURCE_ID}.json`)), false);
  assert.deepEqual([logs[0].dryRun, logs[0].lists, logs[0].lines, logs[0].upcoming], [true, 1, 15, 6]);
});

// ---------- register, contract en voorrang ----------

test("register en contract: eigen fetcher, groep stad, alleen www.antwerpen.be", () => {
  const fetcher = FETCHERS.find((entry) => entry.name === SOURCE_ID);
  assert.deepEqual(fetcher?.sourceIds, [SOURCE_ID]);
  const document = sourceDocument(SOURCE_ID, { fetchStatus: "ok" });
  assert.deepEqual([document.scope, document.url, document.allowedHosts], ["stad", KOOPZONDAGEN_URL, ["www.antwerpen.be"]]);
  const item = { ...parseKoopzondagenHtml(page, { today: TODAY }).items[0], retrievedAt: NOW.toISOString() };
  const wrongHost = sourceDocument(SOURCE_ID, { retrievedAt: NOW.toISOString(), fetchStatus: "ok", items: [{ ...item, sourceUrl: "https://www.visitantwerpen.be/koopzondag" }] });
  assert.ok(validateSourceDocument(wrongHost).some((error) => /sourceUrl/.test(error)));
  const wrongPrefix = sourceDocument(SOURCE_ID, { retrievedAt: NOW.toISOString(), fetchStatus: "ok", items: [{ ...item, id: "markt-2026-10-04" }] });
  assert.ok(validateSourceDocument(wrongPrefix).some((error) => /ongeldige id/.test(error)));
});

test("voorrang: stad-markten > stad-koopzondagen > stad-uit; de koopzondag telt in district Antwerpen", () => {
  const order = SOURCE_PRECEDENCE;
  assert.ok(order.indexOf("stad-markten") < order.indexOf(SOURCE_ID) && order.indexOf(SOURCE_ID) < order.indexOf("stad-uit"));
  const koopzondag = { ...parseKoopzondagenHtml(page, { today: TODAY }).items[0], retrievedAt: NOW.toISOString() };
  const uit = { ...koopzondag, id: "uit-1", externalId: "uit-1", inDistrict: undefined, sourceUrl: "https://www.uitinvlaanderen.be/agenda/e/koopzondag/1" };
  const { items } = mergeEvents({ "stad-uit": { scope: "stad", items: [uit] }, [SOURCE_ID]: { scope: "stad", items: [koopzondag] } });
  assert.equal(items.length, 1);
  assert.deepEqual([items[0].sourceId, items[0].scope, items[0].inDistrict], [SOURCE_ID, "stad", true]);
  assert.deepEqual(items[0].sources.map((source) => source.sourceId), [SOURCE_ID, "stad-uit"]);
});

test("een koopzondag van een ander district of buiten district Antwerpen gaat nooit op in die van de stad", () => {
  assert.deepEqual(POSTCODES, ["2000", "2018"]);
  const koopzondag = { ...parseKoopzondagenHtml(page, { today: TODAY }).items[0], retrievedAt: NOW.toISOString() };
  // Verzonnen items met dezelfde titel en datum en geen uur: zonder postcodes bij de stad zouden ze
  // op dezelfde samenvoegsleutel vallen.
  const deurne = { ...koopzondag, id: "deurne-koopzondag", externalId: "deurne-koopzondag", location: "Deurne", postcodes: ["2100"], inDistrict: false, sourceUrl: "https://www.antwerpen.be/nl/overzicht/deurne-koopzondag-oktober" };
  const wilrijk = { ...koopzondag, id: "uit-wilrijk", externalId: "uit-wilrijk", location: "Wilrijk", postcodes: ["2610"], inDistrict: false, sourceUrl: "https://www.uitinvlaanderen.be/agenda/e/koopzondag-wilrijk/2" };
  const { items } = mergeEvents({
    "stad-districten": { scope: "stad", items: [deurne] },
    [SOURCE_ID]: { scope: "stad", items: [koopzondag] },
    "stad-uit": { scope: "stad", items: [wilrijk] },
  });
  const byId = new Map(items.map((item) => [item.id, item]));
  assert.equal(items.length, 3);
  assert.deepEqual([byId.get("deurne-koopzondag").inDistrict, byId.get("deurne-koopzondag").sources.length], [false, 1]);
  assert.deepEqual([byId.get("uit-wilrijk").inDistrict, byId.get("uit-wilrijk").sources.length], [false, 1]);
  assert.deepEqual([byId.get(koopzondag.id).inDistrict, byId.get(koopzondag.id).sources.map((source) => source.sourceId)], [true, [SOURCE_ID]]);
});
