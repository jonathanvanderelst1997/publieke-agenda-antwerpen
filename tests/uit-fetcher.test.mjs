import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ITEM_CAP, cutAtDayBoundary, run, searchUrl, uitQuery } from "../scripts/fetch-sources-uit.mjs";
import { FORBIDDEN_KEYS, privacyFindings, sourceDocument, validateSourceDocument } from "../lib/source-feed.mjs";

// Synthetische UiTdatabank-respons (geen echte data). Bevat bewust verboden velden om te bewijzen
// dat ze nooit in het bronbestand terechtkomen.
const NOW = new Date("2026-09-28T08:00:00Z");
const clock = () => NOW;
const AT = String.fromCharCode(64);

function event(uuid, overrides = {}) {
  return {
    [`${AT}id`]: `https://io.uitdatabank.be/events/${uuid}`,
    [`${AT}type`]: "Event",
    mainLanguage: "nl",
    name: { nl: `Synthetisch event ${uuid.slice(0, 8)}` },
    calendarType: "single",
    startDate: "2026-10-03T12:00:00+00:00",
    endDate: "2026-10-03T14:00:00+00:00",
    status: { type: "Available" },
    location: {
      name: { nl: "Synthetische zaal" },
      address: { nl: { addressCountry: "BE", addressLocality: "Antwerpen", postalCode: "2000", streetAddress: "Groenplaats 1" } },
      geo: { latitude: 51.2192, longitude: 4.4011 },
      contactPoint: { email: [`zaal${AT}example.invalid`] },
    },
    terms: [
      { id: "0.50.4.0.0", label: "Concert", domain: "eventtype" },
      { id: "x", label: "Geheim", domain: "facility" },
    ],
    priceInfo: [{ category: "base", price: 0, priceCurrency: "EUR", name: { nl: "Basistarief" } }],
    sameAs: [`http://www.uitinvlaanderen.be/agenda/e/synthetisch/${uuid}`],
    creator: `auth0|synthetic-${uuid}`,
    contributors: [`iemand${AT}example.invalid`],
    contactPoint: { phone: ["03 123 45 67"], email: [`info${AT}example.invalid`] },
    bookingInfo: { url: "https://tickets.example.invalid/?ref=1" },
    organizer: { name: { nl: "Synthetische organisator" } },
    image: "https://io.uitdatabank.be/images/synthetic.png",
    mediaObject: [{ contentUrl: "https://io.uitdatabank.be/images/synthetic.png", copyrightHolder: "Iemand" }],
    ...overrides,
  };
}

const uuid = (n) => `0000000${n}-aaaa-4bbb-8ccc-${String(n).padStart(12, "0")}`.slice(-36);

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "uit-fetcher-"));
  fs.mkdirSync(path.join(root, "site", "sources"), { recursive: true });
  return root;
}

function fakeFetch(pages) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), headers: options?.headers ?? {} });
    const start = Number(new URL(url).searchParams.get("start"));
    const body = pages(start);
    return { ok: true, status: 200, json: async () => body };
  };
  return { fetchImpl, calls };
}

const collection = (members, totalItems = members.length) => ({ "@context": "http://www.w3.org/ns/hydra/context.jsonld", itemsPerPage: 250, totalItems, member: members });

test("zonder sleutel: 'UiT uit: geen sleutel', exit zonder fout, bestand byte-identiek, status skipped_no_key", async () => {
  const root = makeRoot();
  const logs = [];
  const neverFetch = async () => {
    throw new Error("zonder sleutel mag er geen verzoek vertrekken");
  };
  const [first] = await run({ rootDir: root, env: {}, fetch: neverFetch, clock, log: (line) => logs.push(line) });
  assert.equal(first.fetchStatus, "skipped_no_key");
  assert.deepEqual(logs, ["UiT uit: geen sleutel"]);
  const file = path.join(root, "site", "sources", "stad-uit.json");
  const created = fs.readFileSync(file, "utf8");
  assert.equal(JSON.parse(created).fetchStatus, "skipped_no_key");
  assert.deepEqual(JSON.parse(created).items, []);

  // Bestaande data wordt nooit door een lege lijst overschreven.
  const existing = JSON.parse(created);
  existing.fetchStatus = "ok";
  existing.retrievedAt = "2026-09-27T08:00:00.000Z";
  fs.writeFileSync(file, `${JSON.stringify(existing, null, 2)}\n`);
  const before = fs.readFileSync(file, "utf8");
  const [second] = await run({ rootDir: root, env: {}, fetch: neverFetch, clock, log: () => {} });
  assert.equal(second.fetchStatus, "skipped_no_key");
  assert.equal(second.retrievedAt, "2026-09-27T08:00:00.000Z");
  assert.equal(fs.readFileSync(file, "utf8"), before);
});

test("testomgeving (search-test): er wordt geteld maar niets naar site/ geschreven", async () => {
  const root = makeRoot();
  const { fetchImpl, calls } = fakeFetch(() => collection([event(uuid(1))]));
  const logs = [];
  const [status] = await run({
    rootDir: root,
    env: { UITDATABANK_CLIENT_ID: "synthetic-client", UITDATABANK_SEARCH_BASE: "https://search-test.uitdatabank.be" },
    fetch: fetchImpl,
    clock,
    log: (line) => logs.push(line),
  });
  assert.equal(status.fetchStatus, "test_only");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers["x-client-id"], "synthetic-client");
  assert.deepEqual(fs.readdirSync(path.join(root, "site", "sources")), []);
  assert.doesNotMatch(logs.join("\n"), /synthetic-client/, "de sleutel komt nooit in de uitvoer");
});

test("alleen de whitelist wordt bewaard; subEvents krijgen elk een eigen id; noEventPage", async () => {
  const root = makeRoot();
  const multiple = event(uuid(2), {
    calendarType: "multiple",
    subEvent: [
      { startDate: "2026-10-05T17:00:00+00:00", endDate: "2026-10-05T19:30:00+00:00", status: { type: "Available" } },
      { startDate: "2026-10-12T17:00:00+00:00", endDate: "2026-10-12T19:30:00+00:00", status: { type: "Available" } },
      { startDate: "2026-10-19T17:00:00+00:00", endDate: "2026-10-19T19:30:00+00:00", status: { type: "Unavailable" } },
    ],
  });
  const cancelled = event(uuid(3), { status: { type: "Unavailable" } });
  const postponed = event(uuid(4), { status: { type: "TemporarilyUnavailable" } });
  const deurne = event(uuid(5), {
    location: {
      name: { nl: "Zaal in Deurne" },
      address: { nl: { addressLocality: "Deurne", postalCode: "2100", streetAddress: "Straat 1" } },
      geo: { latitude: 51.2166, longitude: 4.464 },
    },
  });
  const { fetchImpl, calls } = fakeFetch(() => collection([event(uuid(1)), multiple, cancelled, postponed, deurne]));
  const [status] = await run({ rootDir: root, env: { UITDATABANK_API_KEY: "synthetic-key" }, fetch: fetchImpl, clock, log: () => {} });
  assert.equal(status.fetchStatus, "ok");
  assert.equal(calls[0].headers["x-api-key"], "synthetic-key");

  const text = fs.readFileSync(path.join(root, "site", "sources", "stad-uit.json"), "utf8");
  const document = JSON.parse(text);
  assert.deepEqual(validateSourceDocument(document, { expectedSourceId: "stad-uit" }), []);
  assert.deepEqual(privacyFindings(document), []);
  for (const key of FORBIDDEN_KEYS) assert.ok(!text.includes(`"${key}"`), `verboden sleutel ${key} staat in het bestand`);
  assert.doesNotMatch(text, /example\.invalid|auth0|Geheim|Synthetische organisator|synthetic\.png|123 45 67/);

  const ids = document.items.map((item) => item.id);
  assert.deepEqual(ids, [
    `uit-${uuid(1)}-2026-10-03-1400`,
    `uit-${uuid(2)}-2026-10-05-1900`,
    `uit-${uuid(5)}-2026-10-03-1400`,
    `uit-${uuid(2)}-2026-10-12-1900`,
  ].sort((a, b) => {
    const date = (id) => id.match(/(\d{4}-\d{2}-\d{2})/)[1];
    return date(a).localeCompare(date(b)) || a.localeCompare(b);
  }));
  const first = document.items.find((item) => item.externalId === uuid(1));
  assert.equal(first.timeSlot, "14:00");
  assert.equal(first.timeText, "14 tot 16 uur");
  assert.equal(first.sourceUrl, `https://www.uitinvlaanderen.be/agenda/e/synthetisch/${uuid(1)}`);
  assert.equal(first.info, "Concert · Gratis");
  assert.equal(first.inDistrict, true);
  assert.equal(document.items.find((item) => item.externalId === uuid(5)).inDistrict, false);
  assert.ok(document.items.every((item) => item.noEventPage === true));
  assert.equal(document.scope, "stad");
});

test("postcode en coördinaten die elkaar tegenspreken: niet weggeschreven", async () => {
  const root = makeRoot();
  const conflict = event(uuid(6), {
    location: {
      name: { nl: "Verkeerde zaal" },
      address: { nl: { addressLocality: "Antwerpen", postalCode: "2000", streetAddress: "Straat 2" } },
      geo: { latitude: 51.2166, longitude: 4.464 },
    },
  });
  const { fetchImpl } = fakeFetch(() => collection([conflict, event(uuid(1))]));
  const logs = [];
  await run({ rootDir: root, env: { UITDATABANK_CLIENT_ID: "c" }, fetch: fetchImpl, clock, log: (line) => logs.push(line) });
  const document = JSON.parse(fs.readFileSync(path.join(root, "site", "sources", "stad-uit.json"), "utf8"));
  assert.deepEqual(document.items.map((item) => item.externalId), [uuid(1)]);
  assert.match(logs.join("\n"), /"postcode_geo_conflict":1/);
});

function spreadMembers(count) {
  // 600 events over 28 dagen: 1-12 oktober elk 22, 13-28 oktober elk 21.
  return Array.from({ length: count }, (_, index) => {
    const day = String(1 + (index % 28)).padStart(2, "0");
    return event(`${String(index).padStart(8, "0")}-aaaa-4bbb-8ccc-000000000000`, {
      startDate: `2026-10-${day}T08:00:00+00:00`,
      endDate: `2026-10-${day}T09:00:00+00:00`,
    });
  });
}

test(`binnen de limiet (${ITEM_CAP}): alles, gesorteerd op begin, paginering tot totalItems, coverage niet afgekapt`, async () => {
  const root = makeRoot();
  const members = spreadMembers(600);
  const { fetchImpl, calls } = fakeFetch((start) => collection(members.slice(start, start + 250), members.length));
  const logs = [];
  const [status] = await run({ rootDir: root, env: { UITDATABANK_CLIENT_ID: "c" }, fetch: fetchImpl, clock, log: (line) => logs.push(line) });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((call) => new URL(call.url).searchParams.get("start")), ["0", "250", "500"]);
  const document = JSON.parse(fs.readFileSync(path.join(root, "site", "sources", "stad-uit.json"), "utf8"));
  assert.deepEqual(validateSourceDocument(document, { expectedSourceId: "stad-uit" }), []);
  assert.equal(document.items.length, 600);
  const dates = document.items.map((item) => item.date);
  assert.deepEqual(dates, [...dates].sort());
  assert.deepEqual(document.coverage, { until: "2026-10-28", candidateCount: 600, capped: false });
  assert.deepEqual([status.capped, status.coverageUntil], [false, "2026-10-28"]);
  assert.match(logs.join("\n"), /"candidates":600/);
});

test("boven de limiet: afgekapt op een daggrens, nooit midden in een dag; dekking in bestand en status", async () => {
  const root = makeRoot();
  const members = spreadMembers(600);
  const { fetchImpl } = fakeFetch((start) => collection(members.slice(start, start + 250), members.length));
  const [status] = await run({ rootDir: root, env: { UITDATABANK_CLIENT_ID: "c" }, fetch: fetchImpl, clock, log: () => {}, itemCap: 100 });
  const document = JSON.parse(fs.readFileSync(path.join(root, "site", "sources", "stad-uit.json"), "utf8"));
  assert.deepEqual(validateSourceDocument(document, { expectedSourceId: "stad-uit" }), []);
  // 1-4 oktober = 4 × 22 = 88 items; 5 oktober zou er 110 maken en valt dus volledig weg.
  assert.equal(document.items.length, 88);
  assert.ok(document.items.every((item) => item.date <= "2026-10-04"));
  assert.deepEqual(document.coverage, { until: "2026-10-04", candidateCount: 600, capped: true });
  assert.deepEqual([status.fetchStatus, status.itemCount, status.capped, status.coverageUntil], ["ok", 88, true, "2026-10-04"]);
});

test("cutAtDayBoundary: lopende items en vandaag passen samen niet → geen volledige dag", () => {
  const item = (date, n) => ({ id: `uit-x-${date}-${n}`, date });
  const items = [item("2026-09-20", 1), item("2026-09-21", 2), item("2026-09-28", 3), item("2026-09-28", 4), item("2026-09-29", 5)];
  assert.deepEqual(cutAtDayBoundary(items, 3, { today: "2026-09-28", until: "2026-10-28" }), {
    items: items.slice(0, 2),
    coverageUntil: null,
    capped: true,
  });
  assert.deepEqual(cutAtDayBoundary(items, 4, { today: "2026-09-28", until: "2026-10-28" }).coverageUntil, "2026-09-28");
  assert.deepEqual(cutAtDayBoundary(items, 5, { today: "2026-09-28", until: "2026-10-28" }).capped, false);
});

test("krimpgrens: 0 treffers terwijl er komende items waren → error suspicious_drop, vorige data blijft", async () => {
  const root = makeRoot();
  const members = spreadMembers(40);
  const first = fakeFetch((start) => collection(members.slice(start, start + 250), members.length));
  await run({ rootDir: root, env: { UITDATABANK_CLIENT_ID: "c" }, fetch: first.fetchImpl, clock, log: () => {} });
  const file = path.join(root, "site", "sources", "stad-uit.json");
  const before = fs.readFileSync(file, "utf8");
  assert.equal(JSON.parse(before).items.length, 40);

  const empty = fakeFetch(() => collection([], 0));
  const logs = [];
  const [status] = await run({ rootDir: root, env: { UITDATABANK_CLIENT_ID: "c" }, fetch: empty.fetchImpl, clock, log: (line) => logs.push(line) });
  assert.deepEqual([status.fetchStatus, status.errorCode, status.itemCount], ["error", "suspicious_drop", 40]);
  const after = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(after.fetchStatus, "error");
  assert.deepEqual(after.items, JSON.parse(before).items, "de vorige items blijven staan");
  assert.deepEqual(after.coverage, JSON.parse(before).coverage);
  assert.match(logs.join("\n"), /"upcomingBefore":40,"upcomingAfter":0/);

  // Met AGENDA_ALLOW_DROP=stad-uit mag de eigenaar een bewuste daling doorlaten.
  const [allowed] = await run({ rootDir: root, env: { UITDATABANK_CLIENT_ID: "c", AGENDA_ALLOW_DROP: "stad-uit" }, fetch: empty.fetchImpl, clock, log: () => {} });
  assert.deepEqual([allowed.fetchStatus, allowed.itemCount], ["ok", 0]);
});

test("sourceDocument/validate: coverage moet kloppen met de items", () => {
  const base = { retrievedAt: NOW.toISOString(), fetchStatus: "ok", items: [] };
  assert.deepEqual(validateSourceDocument(sourceDocument("stad-uit", { ...base, coverage: { until: "2026-10-28", candidateCount: 0, capped: false } })), []);
  assert.ok(validateSourceDocument(sourceDocument("stad-uit", { ...base, coverage: { until: "2026-10-28", candidateCount: 5, capped: false } })).length);
  assert.ok(validateSourceDocument(sourceDocument("stad-uit", { ...base, coverage: { until: "28-10", candidateCount: 0, capped: false } })).length);
});

test("zoek-URL: postcodefilter, venster en '+' als %2B", () => {
  const url = searchUrl("https://search.uitdatabank.be", { start: 0, dateFrom: "2026-09-28T00:00:00+02:00", dateTo: "2026-10-28T23:59:59+01:00" });
  assert.match(url, /^https:\/\/search\.uitdatabank\.be\/events\/\?embed=true&limit=250&start=0&/);
  assert.match(url, /dateFrom=2026-09-28T00%3A00%3A00%2B02%3A00/);
  assert.doesNotMatch(url, /\+/);
  assert.match(url, /sort%5Bcreated%5D=asc/);
  assert.equal(new URL(url).searchParams.get("q"), uitQuery());
  assert.match(uitQuery(), /^address\.\\\*\.postalCode:\(2000 OR 2018 OR 2020 OR 2030 OR 2050 OR 2060 OR 2040 OR 2100/);
  assert.match(uitQuery(), /AND NOT calendarType:permanent AND NOT attendanceMode:online$/);
});
