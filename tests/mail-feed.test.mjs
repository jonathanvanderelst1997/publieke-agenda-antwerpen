import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { run } from "../scripts/fetch-sources-mail.mjs";
import { dateOnPage, pageText, placeOnPage, sha256Hex, timeOnPage, titleOnPage, validateMailSignals } from "../lib/mail-signals.mjs";
import { privacyFindings, sourceDocument, validateSourceDocument } from "../lib/source-feed.mjs";

const NOW = new Date("2026-09-28T06:00:00Z");
const clock = () => NOW;
const ENDPOINT = "https://gateway.example.invalid/v1/publiek/publieke-agenda/mail-signalen.json";

function signal(url, fields = {}) {
  return {
    id: sha256Hex(url),
    title: "Infomarkt Burgerbegroting",
    start: "2026-10-14T19:00",
    end: "2026-10-14T21:00",
    all_day: false,
    place: "Districtshuis Harmonie, 2018 Antwerpen",
    url,
    group: "district",
    source: "mail-nieuwsbrief",
    sender_class: "burgerbegroting",
    first_seen: "2026-09-27",
    page_checked_on: "2026-09-27",
    ...fields,
  };
}

const payload = (items, fields = {}) => ({ schema_version: 1, generated_on: "2026-09-27", items, ...fields });
const DISTRICT_URL = "https://www.antwerpen.be/info/aaaaaaaaaaaaaaaaaaaaaaaa/infomarkt-burgerbegroting";
const CITY_URL = "https://www.uitinvlaanderen.be/agenda/e/stadsfeest/00000000-aaaa-4bbb-8ccc-000000000001";
const PAGE_OK = "<html><body><h1>Infomarkt Burgerbegroting</h1><p>Op woensdag 14 oktober van 19 tot 21 uur in Districtshuis Harmonie, 2018 Antwerpen.</p></body></html>";

function response(status, body = "", headers = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, headers: { get: (name) => headers[name.toLowerCase()] ?? null }, text: async () => text, json: async () => JSON.parse(text) };
}

function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), redirect: options?.redirect });
    const route = routes[String(url)];
    if (!route) throw new Error(`onverwacht verzoek naar ${url}`);
    return typeof route === "function" ? route() : route;
  };
  return { fetchImpl, calls };
}

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mail-feed-"));
  fs.mkdirSync(path.join(root, "site", "sources"), { recursive: true });
  return root;
}

const read = (root, sourceId) => JSON.parse(fs.readFileSync(path.join(root, "site", "sources", `${sourceId}.json`), "utf8"));

test("strikt schema: geldige payload wordt aanvaard", () => {
  const body = payload([signal(DISTRICT_URL), signal(CITY_URL, { group: "stad", sender_class: "participatie", start: "2026-10-20", end: null, all_day: true, place: null })]);
  assert.deepEqual(validateMailSignals(body, { byteLength: JSON.stringify(body).length }), { ok: true, errors: [] });
});

test("strikt schema: @, querystring, onbekende host, trackinghost, te veel items, verkeerde id", () => {
  const cases = [
    ["at_sign", payload([signal(DISTRICT_URL, { place: "zaal, info" + String.fromCharCode(64) + "voorbeeld.be" })])],
    ["query", payload([signal(`${DISTRICT_URL}?utm_source=nieuwsbrief`)])],
    ["fragment", payload([signal(`${DISTRICT_URL}#programma`)])],
    ["host", payload([signal("https://www.example.com/event")])],
    ["http", payload([signal("http://www.antwerpen.be/info/aaaaaaaaaaaaaaaaaaaaaaaa/x")])],
    ["tracking", payload([signal("https://nieuwsbrief.antwerpen.be/t/j-l-abc-def-g/")])],
    ["createsend", payload([signal("https://antwerpen.createsend1.com/t/x")])],
    ["confirmsubscription", payload([signal("https://www.confirmsubscription.com/h/x")])],
    ["too_many", payload(Array.from({ length: 201 }, (_, index) => signal(`${DISTRICT_URL}-${index}`)))],
    ["id", payload([{ ...signal(DISTRICT_URL), id: "0".repeat(64) }])],
    ["unknown_key", payload([{ ...signal(DISTRICT_URL), body: "mailtekst" }])],
    ["top_key", payload([signal(DISTRICT_URL)], { raw_mail: "x" })],
    ["title", payload([signal(DISTRICT_URL, { title: "x".repeat(161) })])],
    ["schema", payload([signal(DISTRICT_URL)], { schema_version: 2 })],
  ];
  for (const [name, body] of cases) {
    const result = validateMailSignals(body, { byteLength: JSON.stringify(body).length });
    assert.equal(result.ok, false, name);
  }
  const big = payload([signal(DISTRICT_URL)]);
  assert.equal(validateMailSignals(big, { byteLength: 64 * 1024 + 1 }).ok, false, "meer dan 64 KB");
});

test("200: elk item wordt op de officiële pagina herverifieerd en per groep weggeschreven", async () => {
  const root = makeRoot();
  const failing = "https://www.antwerpen.be/info/bbbbbbbbbbbbbbbbbbbbbbbb/andere-titel";
  const redirected = "https://burgerbegroting.be/finale";
  const body = payload([
    signal(DISTRICT_URL),
    signal(failing, { title: "Titel die niet op de pagina staat" }),
    signal(CITY_URL, { group: "stad", sender_class: "participatie", title: "Stadsfeest op de Groenplaats", start: "2026-10-20", end: null, all_day: true, place: null }),
    signal(redirected, { title: "Finale Burgerbegroting", start: "2026-10-25T10:00", end: null }),
  ]);
  const { fetchImpl, calls } = fakeFetch({
    [ENDPOINT]: response(200, body),
    [DISTRICT_URL]: response(200, PAGE_OK),
    [failing]: response(200, PAGE_OK),
    [CITY_URL]: response(200, "<h1>Stadsfeest op de Groenplaats</h1><p>Datum: 20/10</p>"),
    [redirected]: response(301, "", { location: "https://www.burgerbegroting.be/finale-2026" }),
    "https://www.burgerbegroting.be/finale-2026": response(200, "<h1>Finale Burgerbegroting</h1><time>2026-10-25</time>"),
  });
  const statuses = await run({ rootDir: root, env: { MAIL_SIGNALEN_URL: ENDPOINT }, fetch: fetchImpl, clock, log: () => {} });
  assert.deepEqual(statuses.map((entry) => [entry.sourceId, entry.fetchStatus, entry.itemCount]), [
    ["mail-district", "ok", 2],
    ["mail-stad", "ok", 1],
  ]);
  assert.ok(calls.filter((call) => call.url !== ENDPOINT).every((call) => call.redirect === "manual"));

  const district = read(root, "mail-district");
  assert.deepEqual(validateSourceDocument(district, { expectedSourceId: "mail-district" }), []);
  assert.deepEqual(privacyFindings(district), []);
  const [first, second] = district.items;
  assert.equal(first.id, `mail-${sha256Hex(DISTRICT_URL).slice(0, 16)}-2026-10-14`);
  assert.equal(first.timeSlot, "19:00");
  assert.equal(first.timeText, "19 tot 21 uur");
  assert.deepEqual(first.postcodes, ["2018"]);
  assert.equal(first.theme, "Activiteit");
  assert.equal(first.kind, "activity");
  assert.equal(second.sourceUrl, "https://www.burgerbegroting.be/finale-2026", "de eindbestemming na de redirect wordt de bron");
  assert.ok(!district.items.some((item) => item.title.startsWith("Titel die niet")), "herverificatie mislukt: niet weggeschreven");

  const city = read(root, "mail-stad");
  assert.equal(city.items[0].timeSlot, "Info");
  assert.equal(city.items[0].location, "locatie via de officiële bron");
});

test("een redirect naar een niet-toegelaten host of zonder 200 wordt niet weggeschreven", async () => {
  const root = makeRoot();
  const body = payload([signal(DISTRICT_URL)]);
  const { fetchImpl } = fakeFetch({
    [ENDPOINT]: response(200, body),
    [DISTRICT_URL]: response(302, "", { location: "https://tracker.example.invalid/x" }),
  });
  const logs = [];
  await run({ rootDir: root, env: { MAIL_SIGNALEN_URL: ENDPOINT }, fetch: fetchImpl, clock, log: (line) => logs.push(line) });
  assert.equal(read(root, "mail-district").items.length, 0);
  assert.match(logs.join("\n"), /redirect_not_allowed/);

  const gone = makeRoot();
  const second = fakeFetch({ [ENDPOINT]: response(200, body), [DISTRICT_URL]: response(404, "weg") });
  await run({ rootDir: gone, env: { MAIL_SIGNALEN_URL: ENDPOINT }, fetch: second.fetchImpl, clock, log: () => {} });
  assert.equal(read(gone, "mail-district").items.length, 0);
});

test("404: bron uitgeschakeld, eerdere items blijven staan", async () => {
  const root = makeRoot();
  const previous = sourceDocument("mail-district", {
    retrievedAt: "2026-09-27T06:00:00.000Z",
    fetchStatus: "ok",
    items: [
      {
        id: `mail-${sha256Hex(DISTRICT_URL).slice(0, 16)}-2026-10-14`,
        externalId: sha256Hex(DISTRICT_URL).slice(0, 16),
        title: "Infomarkt Burgerbegroting",
        theme: "Activiteit",
        className: "activity",
        date: "2026-10-14",
        endDate: null,
        timeSlot: "19:00",
        timeText: "19 tot 21 uur",
        location: "Districtshuis Harmonie, 2018 Antwerpen",
        postcodes: ["2018"],
        info: "",
        kind: "activity",
        sourceUrl: DISTRICT_URL,
        retrievedAt: "2026-09-27T06:00:00.000Z",
        reviewRequired: false,
      },
    ],
  });
  fs.writeFileSync(path.join(root, "site", "sources", "mail-district.json"), `${JSON.stringify(previous, null, 2)}\n`);
  const { fetchImpl } = fakeFetch({ [ENDPOINT]: response(404, "not found") });
  const statuses = await run({ rootDir: root, env: { MAIL_SIGNALEN_URL: ENDPOINT }, fetch: fetchImpl, clock, log: () => {} });
  assert.deepEqual(statuses.map((entry) => entry.fetchStatus), ["disabled", "disabled"]);
  const district = read(root, "mail-district");
  assert.equal(district.fetchStatus, "disabled");
  assert.equal(district.items.length, 1);
  assert.equal(district.retrievedAt, "2026-09-27T06:00:00.000Z");
  assert.deepEqual(read(root, "mail-stad").items, []);
});

test("503 (nog geen snapshot): eerdere items blijven zolang hun datum niet voorbij is en de pagina ze bevestigt", async () => {
  const root = makeRoot();
  const keep = {
    id: `mail-${sha256Hex(DISTRICT_URL).slice(0, 16)}-2026-10-14`,
    externalId: sha256Hex(DISTRICT_URL).slice(0, 16),
    title: "Infomarkt Burgerbegroting",
    theme: "Activiteit",
    className: "activity",
    date: "2026-10-14",
    endDate: null,
    timeSlot: "19:00",
    timeText: "19 tot 21 uur",
    location: "Districtshuis Harmonie, 2018 Antwerpen",
    postcodes: ["2018"],
    info: "",
    kind: "activity",
    sourceUrl: DISTRICT_URL,
    retrievedAt: "2026-09-26T06:00:00.000Z",
    reviewRequired: false,
  };
  const passed = { ...keep, id: `mail-${"1".repeat(16)}-2026-09-20`, externalId: "1".repeat(16), date: "2026-09-20", title: "Voorbij" };
  fs.writeFileSync(
    path.join(root, "site", "sources", "mail-district.json"),
    `${JSON.stringify(sourceDocument("mail-district", { retrievedAt: "2026-09-26T06:00:00.000Z", fetchStatus: "ok", items: [passed, keep] }), null, 2)}\n`
  );
  const { fetchImpl } = fakeFetch({
    [ENDPOINT]: response(503, { code: "mail_signalen_unavailable" }),
    [DISTRICT_URL]: response(200, PAGE_OK),
  });
  const statuses = await run({ rootDir: root, env: { MAIL_SIGNALEN_URL: ENDPOINT }, fetch: fetchImpl, clock, log: () => {} });
  assert.deepEqual(statuses.map((entry) => [entry.fetchStatus, entry.errorCode]), [
    ["ok", "upstream_stale"],
    ["ok", "upstream_stale"],
  ]);
  const district = read(root, "mail-district");
  assert.deepEqual(district.items.map((item) => item.id), [keep.id]);
  assert.equal(district.items[0].retrievedAt, NOW.toISOString(), "opnieuw bevestigd, dus vers");

  // Ook een snapshot ouder dan 3 dagen geldt als verouderd.
  const old = fakeFetch({ [ENDPOINT]: response(200, payload([], { generated_on: "2026-09-20" })), [DISTRICT_URL]: response(200, PAGE_OK) });
  const oldStatuses = await run({ rootDir: root, env: { MAIL_SIGNALEN_URL: ENDPOINT }, fetch: old.fetchImpl, clock, log: () => {} });
  assert.equal(oldStatuses[0].errorCode, "upstream_stale");
  assert.equal(read(root, "mail-district").items.length, 1);
});

test("netwerkfout of andere 5xx: fetchStatus error, eerdere items blijven", async () => {
  const root = makeRoot();
  const failing = async () => {
    throw new TypeError("fetch failed");
  };
  const statuses = await run({ rootDir: root, env: { MAIL_SIGNALEN_URL: ENDPOINT }, fetch: failing, clock, log: () => {} });
  assert.deepEqual(statuses.map((entry) => [entry.fetchStatus, entry.errorCode]), [
    ["error", "network_error"],
    ["error", "network_error"],
  ]);
  const { fetchImpl } = fakeFetch({ [ENDPOINT]: response(502, "bad gateway") });
  const second = await run({ rootDir: root, env: { MAIL_SIGNALEN_URL: ENDPOINT }, fetch: fetchImpl, clock, log: () => {} });
  assert.equal(second[0].errorCode, "http_502");
  const invalid = fakeFetch({ [ENDPOINT]: response(200, payload([signal(`${DISTRICT_URL}?x=1`)])) });
  const third = await run({ rootDir: root, env: { MAIL_SIGNALEN_URL: ENDPOINT }, fetch: invalid.fetchImpl, clock, log: () => {} });
  assert.deepEqual([third[0].fetchStatus, third[0].errorCode], ["error", "invalid_payload"]);
  // Andere bronnen worden nooit aangeraakt.
  assert.deepEqual(fs.readdirSync(path.join(root, "site", "sources")).sort(), ["mail-district.json", "mail-stad.json"]);
});

test("herverificatie: een algemene titel of een titel midden in een woord bewijst niets", () => {
  const text = pageText("<p>Opening van het nieuwe districtshuis op 4 oktober. Welkom! Supermarkt op het pleintje.</p>");
  assert.equal(dateOnPage("2026-10-04", text), true);
  assert.equal(titleOnPage("Opening", text), false, "te kort: 1 woord, 7 tekens");
  assert.equal(titleOnPage("Receptie", pageText("<p>Receptie op 4 oktober</p>")), false);
  assert.equal(titleOnPage("Markt op het plein", text), false, "staat alleen als stuk van 'Supermarkt … pleintje'");
  assert.equal(titleOnPage("Opening van het nieuwe districtshuis", text), true);
});

test("herverificatie: uur en plaats alleen als ze op de pagina staan", () => {
  const text = pageText("<p>Zaterdag 10 oktober van 14.30 tot 17 uur in Districtshuis Harmonie, Kiel. Deuren om 19u.</p>");
  assert.equal(timeOnPage("14:30", text), true);
  assert.equal(timeOnPage("17:00", text), true);
  assert.equal(timeOnPage("19:00", text), true);
  assert.equal(timeOnPage("20:00", text), false);
  assert.equal(timeOnPage("10:00", text), false, "'10 oktober' is geen uur");
  assert.equal(timeOnPage("04:30", text), false, "'14.30' is geen 4.30");
  assert.equal(placeOnPage("Districtshuis Harmonie, Kiel", text), true);
  assert.equal(placeOnPage("Kerkstraat 12, 2018 Antwerpen", text), false);
  assert.equal(placeOnPage("Districtshuis Harmonie, Kerkstraat 12", text), false, "elk deel moet op de pagina staan");
});

test("een privé-plaats en -uur uit het signaal komen nooit op de site; privémarkering en algemene titel worden niet opgehaald", async () => {
  const root = makeRoot();
  const expoUrl = "https://www.antwerpen.be/info/cccccccccccccccccccccccc/opening-expo-verbeeld-verleden";
  const privateUrl = "https://www.antwerpen.be/info/dddddddddddddddddddddddd/uitnodiging";
  const shortUrl = "https://www.antwerpen.be/info/eeeeeeeeeeeeeeeeeeeeeeee/receptie";
  const body = payload([
    // Titel en datum staan op de officiële pagina; plaats en uur komen alleen uit het signaal.
    signal(expoUrl, { title: "Opening expo Verbeeld Verleden", start: "2026-10-10T20:00", end: "2026-10-10T23:00", place: "Kerkstraat 12, 2018 Antwerpen" }),
    signal(privateUrl, { title: "[PERSOONLIJKE UITNODIGING – NOG BESLISSEN] Opening expo Verbeeld Verleden", start: "2026-10-10T20:00", end: null }),
    signal(shortUrl, { title: "Receptie", start: "2026-10-10T20:00", end: null }),
  ]);
  const { fetchImpl, calls } = fakeFetch({
    [ENDPOINT]: response(200, body),
    [expoUrl]: response(200, "<h1>Opening expo Verbeeld Verleden</h1><p>Zaterdag 10 oktober in het museum. Gratis.</p>"),
  });
  const logs = [];
  await run({ rootDir: root, env: { MAIL_SIGNALEN_URL: ENDPOINT }, fetch: fetchImpl, clock, log: (line) => logs.push(line) });
  assert.deepEqual(calls.map((call) => call.url), [ENDPOINT, expoUrl], "privémarkering en algemene titel: geen verzoek");
  const district = read(root, "mail-district");
  assert.equal(district.items.length, 1);
  const [item] = district.items;
  assert.equal(item.title, "Opening expo Verbeeld Verleden");
  assert.equal(item.date, "2026-10-10");
  assert.equal(item.location, "locatie via de officiële bron");
  assert.deepEqual(item.postcodes, []);
  assert.equal(item.timeSlot, "Info");
  assert.equal(item.timeText, "");
  const text = JSON.stringify(district);
  assert.doesNotMatch(text, /Kerkstraat|20:00|PERSOONLIJKE|Receptie/);
  assert.match(logs.join("\n"), /"private_marker":1/);
  assert.match(logs.join("\n"), /"title_too_generic":1/);
});
