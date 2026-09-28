// De gratis bronnen voor de groep "Stad": de nieuwskanalen van de andere districten en de markten uit
// GIPOD. Alles offline, met opgeschoonde fixtures (geen personeelsvelden, geen namen of contactgegevens).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DISTRICT_CHANNELS, channelApiUrl, fallbackLocationFor } from "../lib/district-channels.mjs";
import { parseDistrictNewsArticle } from "../lib/district-news-parser.mjs";
import { gipodQueryUrl, marketTitle, marketsFromGipod, parseMarketList, placeName } from "../lib/gipod-markets.mjs";
import { mergeEvents } from "../lib/merge-events.mjs";
import { CITY_POSTCODES, DISTRICT_POSTCODES } from "../lib/postcodes.mjs";
import { FORBIDDEN_KEYS, sourceDocument, validateSourceDocument } from "../lib/source-feed.mjs";
import { FETCHERS } from "../lib/source-registry.mjs";
import { run as runMarkets } from "../scripts/fetch-sources-markten.mjs";
import { CHANNEL_GAP_MS, run as runDistricts } from "../scripts/fetch-sources-stad-districten.mjs";
import { checkHealth } from "../scripts/sources-health.mjs";

const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const channels = fixture("stad-districten-kanalen-2026-09-28.json").channels;
const gipod = fixture("gipod-markten-2026-09-28.json");
const marketListJson = fixture("markten-stad-antwerpen-2026-09-28.json");
const TODAY = "2026-09-28";
const NOW = new Date("2026-09-28T06:00:00Z");
const clock = () => NOW;
const quiet = () => {};
const noSleep = async () => {};
const channelOf = (key) => DISTRICT_CHANNELS.find((entry) => entry.key === key);
const articleOf = (key, id) => channels[key].find((article) => article.id === id);
const stadOptions = (key) => ({
  today: TODAY,
  idPrefix: `stad-news-${key}-`,
  fallbackLocation: fallbackLocationFor(channelOf(key)),
  activityTables: true,
  singleBlock: true,
  skipWorks: true,
});

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stad-sources-"));
  fs.mkdirSync(path.join(root, "site", "sources"), { recursive: true });
  return root;
}
const read = (root, sourceId) => JSON.parse(fs.readFileSync(path.join(root, "site", "sources", `${sourceId}.json`), "utf8"));

function json(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body };
}

// Het kanaal zoals de API het geeft: met personeelsvelden en een afbeelding, die nooit mogen doorlekken.
function channelResponse(key) {
  const articles = channels[key] ?? [
    {
      id: "0123456789abcdef01234567",
      slug: "nieuws-zonder-datum",
      title: "Nieuws zonder datum",
      publishedAt: "2026-09-20T08:00:00+00:00",
      publishUntil: "2026-12-01T22:00:00+00:00",
      snippets: [{ type: "wysiwyg", body: { text: "<p>Gewoon nieuws.</p>" } }],
    },
  ];
  return {
    data: articles.map((article) => ({
      ...article,
      creator: { name: "PERSONEEL-X" },
      assignee: { name: "PERSONEEL-Y" },
      lockOwner: "PERSONEEL-Z",
      snippets: [{ type: "media", body: { file: [{ src: "https://assets.antwerpen.be/srv/assets/api/image/x/foto.png" }] } }, ...article.snippets],
    })),
  };
}

function districtRoutes({ failing = [] } = {}) {
  return async (url) => {
    const entry = DISTRICT_CHANNELS.find((candidate) => String(url) === channelApiUrl(candidate.channelId));
    if (!entry) return json({ error: "not found" }, 404);
    if (failing.includes(entry.key)) return json({ error: "storing" }, 503);
    return json(channelResponse(entry.key));
  };
}

// ---------- tabel van de kanalen ----------

test("9 districtskanalen: vast, uniek, met postcodes van de stad buiten district Antwerpen", () => {
  assert.equal(DISTRICT_CHANNELS.length, 9);
  assert.ok(Object.isFrozen(DISTRICT_CHANNELS) && DISTRICT_CHANNELS.every(Object.isFrozen));
  assert.equal(new Set(DISTRICT_CHANNELS.map((entry) => entry.channelId)).size, 9);
  assert.equal(new Set(DISTRICT_CHANNELS.map((entry) => entry.key)).size, 9);
  const postcodes = DISTRICT_CHANNELS.flatMap((entry) => entry.postcodes).sort();
  assert.deepEqual(postcodes, CITY_POSTCODES.filter((postcode) => !DISTRICT_POSTCODES.includes(postcode)).sort());
  for (const entry of DISTRICT_CHANNELS) {
    assert.match(entry.channelId, /^[a-f0-9]{24}$/);
    assert.equal(entry.url, `https://www.antwerpen.be/nl/overzicht/${entry.slug}`);
  }
  assert.equal(channelOf("borsbeek").postcodes[0], "2150");
});

// ---------- parser ----------

test("standaard blijft het districtsnieuws ongewijzigd; met opties komt de terugvallocatie", () => {
  const article = articleOf("merksem", "6a97c90144947476b56a9e02");
  const plain = parseDistrictNewsArticle(article, { today: TODAY });
  assert.equal(plain.reason, "review_required", "zonder plaats: niet publiceren");
  assert.equal(plain.reviewItems[0].id, "district-news-6a97c90144947476b56a9e02-2026-11-18");

  const result = parseDistrictNewsArticle(article, stadOptions("merksem"));
  assert.equal(result.reason, null);
  assert.deepEqual(
    result.items.map((item) => [item.id, item.date, item.timeSlot, item.location, item.postcodes]),
    [["stad-news-merksem-6a97c90144947476b56a9e02-2026-11-18", "2026-11-18", "13:00", "District Merksem, locatie via de officiële bron", ["2170"]]]
  );
});

test("activiteitentabel: één item per rij, titel uit de cel of de linktekst, nooit een link met querystring", () => {
  const result = parseDistrictNewsArticle(articleOf("wilrijk", "648d2efc50afea0013656346"), stadOptions("wilrijk"));
  assert.equal(result.reason, null);
  assert.deepEqual(
    result.items.map((item) => [item.date, item.timeSlot, item.title]),
    [
      ["2026-10-01", "19:30", "VOLZET - Workshop | Omgaan met piekeren - interactieve lees- en reflectiesessie"],
      ["2026-10-05", "19:00", "VOLZET - Infosessie | Puberbabbel - begrijp je puber beter"],
      ["2026-10-06", "19:00", "VOLZET - Infosessie | Verbindende communicatie - mijn gezin in interactie"],
      ["2026-10-15", "19:30", "VOLZET - Lezing | Hoe het lichaam onthoudt wat je zelf vergeten bent"],
      ["2026-10-22", "20:00", "De eenzaamheid van de priemgetallen – Paolo Giordano"],
      ["2026-11-19", "20:00", "Zwarte september – Sandro Veronesi"],
      ["2026-12-10", "20:00", "Het leugenachtige leven van volwassenen – Elena Ferrante"],
    ]
  );
  for (const item of result.items) {
    assert.equal(item.location, "District Wilrijk, locatie via de officiële bron");
    assert.deepEqual(item.postcodes, ["2610"]);
    assert.equal(item.infoUrl, undefined, "ticketlink met querystring valt weg");
    assert.match(item.id, /^stad-news-wilrijk-648d2efc50afea0013656346-t\d+r\d+-\d{4}-\d{2}-\d{2}$/);
  }
});

test("activiteitentabel: rijen zonder leesbare datum vallen weg, de andere staan op zichzelf", () => {
  const result = parseDistrictNewsArticle(articleOf("borgerhout", "66d6eef576ce660545139265"), stadOptions("borgerhout"));
  const titles = result.items.map((item) => item.title);
  assert.ok(!titles.includes("Borgersound"), "'September tot november' is geen datum");
  assert.ok(!titles.includes("Talk of the Town"), "'Tot 30 september' is geen datum");
  assert.ok(!titles.includes("Jingle Jogging"), "20 december ligt na publishUntil");
  assert.deepEqual(
    result.items.filter((item) => item.title === "Stanneke").map((item) => item.date),
    ["2026-11-06", "2026-11-07", "2026-11-08", "2026-11-13"]
  );
  const groeidag = result.items.find((item) => item.title === "Groeidag");
  assert.match(groeidag.infoUrl, /^https:\/\/www\.antwerpen\.be\/nl\/overzicht\/district-borgerhout\//);
  assert.equal(result.items.find((item) => item.title === "Reuzenstoet").infoUrl, undefined, "alleen links naar www.antwerpen.be");
  assert.equal(result.items.find((item) => item.title === "Praatcafé Dementie").info, "Aan de hand van De Verlieskoffer komen we tot een gesprek met elkaar.");
});

test("één blok: 'Meer info' onderaan telt, een contactblok zonder datum telt niet mee", () => {
  const deurne = parseDistrictNewsArticle(articleOf("deurne", "6a4f695bf4182bb5535706d9"), stadOptions("deurne"));
  assert.deepEqual(
    deurne.items.map((item) => [item.date, item.title, item.location]),
    [["2026-09-30", "Seniorenklap: wandelen, ontmoeten en genieten in het Boekenbergpark", "District Deurne, locatie via de officiële bron"]]
  );
  const hoboken = parseDistrictNewsArticle(articleOf("hoboken", "5daeb0c3f8412527a4787a4c"), stadOptions("hoboken"));
  assert.deepEqual(hoboken.items.map((item) => [item.date, item.timeSlot]), [["2026-10-09", "19:00"]]);
  const bzl = parseDistrictNewsArticle(articleOf("berendrecht-zandvliet-lillo", "63357141fca03f428619a8cc"), stadOptions("berendrecht-zandvliet-lillo"));
  assert.deepEqual(bzl.items.map((item) => [item.date, item.postcodes]), [["2026-10-13", ["2040"]]]);
  // Zonder de optie blijft het districtsnieuws zoals het was.
  assert.equal(parseDistrictNewsArticle(articleOf("hoboken", "5daeb0c3f8412527a4787a4c"), { today: TODAY }).reason, "no_date_line");
});

test("één blok: 'Praktische info', 'Info' of 'Meer info' als titel, twee blokken of een datum buiten het venster worden geweigerd", () => {
  const article = (text) => ({
    id: "aaaaaaaaaaaaaaaaaaaaaaaa",
    slug: "iets-in-hoboken",
    title: "Iets in Hoboken",
    publishedAt: "2026-09-20T08:00:00+00:00",
    publishUntil: "2026-10-20T22:00:00+00:00",
    snippets: [{ type: "wysiwyg", body: { text } }],
  });
  const options = stadOptions("hoboken");
  // (Een regel "Praktisch" gevolgd door een datum leest de bestaande Praktisch-regel al.)
  for (const title of ["Praktische info", "Info", "Meer info"]) {
    assert.equal(parseDistrictNewsArticle(article(`<p><strong>${title}</strong><br />zaterdag 3 oktober</p>`), options).reason, "generic_block_title", title);
  }
  assert.equal(
    parseDistrictNewsArticle(article("<p><strong>Eerste</strong><br />zaterdag 3 oktober</p><p><strong>Tweede</strong><br />zondag 4 oktober</p>"), options).reason,
    "ambiguous"
  );
  assert.equal(parseDistrictNewsArticle(article("<p><strong>Buurtfeest</strong><br />zaterdag 7 november</p>"), options).reason, "outside_publication_window");
  const ok = parseDistrictNewsArticle(article("<p><strong>Buurtfeest</strong><br />zaterdag 3 oktober van 14 tot 18 uur</p>"), options);
  assert.deepEqual(ok.items.map((item) => [item.date, item.timeSlot, item.timeText]), [["2026-10-03", "14:00", "van 14 tot 18 uur"]]);
});

test("werken, omleidingen en heraanleg worden overgeslagen", () => {
  const result = parseDistrictNewsArticle(articleOf("berendrecht-zandvliet-lillo", "678e44c941c6b4d3f152fc10"), stadOptions("berendrecht-zandvliet-lillo"));
  assert.equal(result.reason, "works");
  assert.equal(result.items.length + result.reviewItems.length, 0);
});

// ---------- fetcher districtskanalen ----------

test("fetcher: 9 GET's met 3 s ertussen, geen personeelsvelden of afbeeldingen in de uitvoer", async () => {
  const root = makeRoot();
  const requested = [];
  const pauses = [];
  const routes = districtRoutes();
  const status = await runDistricts({ rootDir: root, clock, log: quiet, sleep: async (ms) => pauses.push(ms), fetch: async (url, options) => (requested.push(String(url)), routes(url, options)) });
  assert.deepEqual(requested, DISTRICT_CHANNELS.map((entry) => channelApiUrl(entry.channelId)));
  assert.deepEqual(pauses, Array(8).fill(CHANNEL_GAP_MS));
  assert.equal(CHANNEL_GAP_MS, 3000);
  assert.deepEqual([status[0].fetchStatus, status[0].errorCode], ["ok", null]);

  const document = read(root, "stad-districten");
  assert.deepEqual(validateSourceDocument(document, { expectedSourceId: "stad-districten" }), []);
  const text = JSON.stringify(document);
  assert.doesNotMatch(text, /PERSONEEL|assets\.antwerpen\.be|creator|assignee|lockOwner|@/);
  for (const key of FORBIDDEN_KEYS) assert.ok(!text.includes(`"${key}"`), key);
  assert.ok(document.items.every((item) => item.date >= TODAY), "voorbije items blijven niet staan");
  assert.ok(document.items.every((item) => item.id.startsWith("stad-news-")));
  // Een artikel in twee kanalen (Aziatische hoornaars) telt één keer; hier zonder datum, dus geen item.
  assert.ok(document.items.some((item) => item.id.startsWith("stad-news-deurne-6a4f695bf4182bb5535706d9-")));
  assert.ok(document.items.every((item) => item.inDistrict === false));
});

test("fetcher: faalt één kanaal, dan blijven alleen diens vorige items en is de bron 'error'", async () => {
  const root = makeRoot();
  await runDistricts({ rootDir: root, clock, log: quiet, sleep: noSleep, fetch: districtRoutes() });
  const before = read(root, "stad-districten");
  const wilrijkBefore = before.items.filter((item) => item.id.startsWith("stad-news-wilrijk-"));
  assert.ok(wilrijkBefore.length >= 5);

  const later = () => new Date("2026-09-29T06:00:00Z");
  const status = await runDistricts({ rootDir: root, clock: later, log: quiet, sleep: noSleep, fetch: districtRoutes({ failing: ["wilrijk"] }) });
  assert.deepEqual([status[0].fetchStatus, status[0].errorCode], ["error", "channel_http_503"]);
  const after = read(root, "stad-districten");
  assert.deepEqual(validateSourceDocument(after, { expectedSourceId: "stad-districten" }), []);
  assert.deepEqual(after.items.filter((item) => item.id.startsWith("stad-news-wilrijk-")), wilrijkBefore.filter((item) => item.date >= "2026-09-29"));
  assert.ok(after.items.filter((item) => !item.id.startsWith("stad-news-wilrijk-")).every((item) => item.retrievedAt === "2026-09-29T06:00:00.000Z"));

  // Alle kanalen stuk: niets wordt gewist.
  const allDown = await runDistricts({ rootDir: root, clock: later, log: quiet, sleep: noSleep, fetch: async () => json({}, 500) });
  assert.deepEqual([allDown[0].fetchStatus, allDown[0].errorCode], ["error", "channel_http_500"]);
  assert.deepEqual(read(root, "stad-districten").items, after.items);
});

test("geen krimpgrens voor stad-districten: nul komende items is gezond als elk kanaal antwoordde", async () => {
  const root = makeRoot();
  await runDistricts({ rootDir: root, clock, log: quiet, sleep: noSleep, fetch: districtRoutes() });
  const committed = read(root, "stad-districten");
  assert.ok(committed.items.length > 0);
  const empty = async (url) => (DISTRICT_CHANNELS.some((entry) => String(url) === channelApiUrl(entry.channelId)) ? json(channelResponse("geen")) : json({}, 404));
  const status = await runDistricts({ rootDir: root, clock, log: quiet, sleep: noSleep, fetch: empty });
  assert.deepEqual([status[0].fetchStatus, status[0].itemCount], ["ok", 0]);
  fs.writeFileSync(
    path.join(root, "site", "sources", "refresh-status.json"),
    `${JSON.stringify({ schemaVersion: 1, generatedAt: NOW.toISOString(), classificationAsOf: TODAY, sources: status }, null, 2)}\n`
  );
  const health = checkHealth({ rootDir: root, at: NOW.getTime() + 3_600_000, env: {}, baseline: (sourceId) => (sourceId === "stad-districten" ? committed : null) });
  assert.equal(health.exitCode, 0, health.lines.join("\n"));
});

// ---------- markten ----------

test("markttitels en plaatsnamen", () => {
  assert.deepEqual(marketTitle("Gemengde markt\nKioskplaats"), { title: "Gemengde markt Kioskplaats", place: "Kioskplaats" });
  assert.deepEqual(marketTitle("BOTERMARKT\nGemengde markt"), { title: "Gemengde markt Botermarkt", place: "Botermarkt" });
  assert.equal(marketTitle("voeding, bloemen en planten\nKIOSKPLAATS").title, "Markt voor voeding, bloemen en planten Kioskplaats");
  assert.equal(marketTitle("Woensdagmarkt Vosstraat").title, "Woensdagmarkt Vosstraat");
  assert.equal(placeName("FREDERIK VAN EEDENPLEIN"), "Frederik van Eedenplein");
  assert.equal(placeName("OUDEVAARTPLAATS - BLAUWTORENPLEIN"), "Oudevaartplaats - Blauwtorenplein");
  assert.equal(placeName("Laar (Borgerhout)"), "Laar (Borgerhout)");
});

test("GIPOD: één verzoek met filter, venster en bbox van de stad", () => {
  const url = new URL(gipodQueryUrl(NOW));
  assert.equal(url.origin + url.pathname, "https://geo.api.vlaanderen.be/GIPOD/ogc/features/v1/collections/INNAME_PUNT/items");
  assert.equal(url.searchParams.get("filter"), "Type='Evenement' AND PublicDomainOccupancyTypes LIKE 'Markt%' AND Owner LIKE 'Stad Antwerpen%'");
  assert.equal(url.searchParams.get("datetime"), "2026-09-28T06:00:00Z/2026-10-12T06:00:00Z");
  assert.equal(url.searchParams.get("bbox"), "4.2,51.14,4.53,51.39");
});

test("GIPOD: per markt de eerstvolgende marktdag, in Brusselse tijd, zonder parkeerrijen", () => {
  const { items, counts } = marketsFromGipod(gipod, { now: NOW, marketList: parseMarketList(marketListJson) });
  assert.equal(counts.rejected.parking > 0, true);
  assert.deepEqual(
    items.map((item) => [item.id, item.title, item.date, item.timeSlot, item.timeText, item.location, item.inDistrict]),
    [
      ["markt-ma1-2026-09-28", "Gemengde markt Kioskplaats", "2026-09-28", "08:00", "8 tot 13 uur", "Kioskplaats, 2660 Hoboken", false],
      ["markt-ma10-2026-10-04", "Markt voor klein antiek Sint-Jansvliet", "2026-10-04", "09:00", "9 tot 17 uur", "Sint-Jansvliet, 2000 Antwerpen", true],
      ["markt-ma13-2026-09-30", "Gemengde markt Sint-Jansplein", "2026-09-30", "08:00", "8 tot 13 uur", "Sint-Jansplein, 2060 Antwerpen", true],
      ["markt-ma18-2026-10-02", "Gemengde markt Botermarkt", "2026-10-02", "08:00", "8 tot 13 uur", "Botermarkt, 2040 Berendrecht-Zandvliet-Lillo", false],
      ["markt-ma2-2026-10-02", "Gemengde markt Michel Willemsplein", "2026-10-02", "06:00", "6 tot 15 uur", "Michel Willemsplein, Antwerpen", false],
      ["markt-ma20-2026-10-03", "Gemengde markt en exotische markt Oudevaartplaats", "2026-10-03", "08:00", "8 tot 16 uur", "Oudevaartplaats, 2000 Antwerpen", true],
      ["markt-ma27-2026-10-03", "Markt voor voeding, bloemen en planten Kioskplaats", "2026-10-03", "08:00", "8 tot 13 uur", "Kioskplaats, 2660 Hoboken", false],
      ["markt-ma6-2026-09-30", "Woensdagmarkt Vosstraat", "2026-09-30", "08:00", "8 tot 13 uur", "Vosstraat, 2140 Borgerhout", false],
    ]
  );
  assert.ok(items.every((item) => item.sourceUrl.startsWith("https://geo.api.vlaanderen.be/GIPOD/ogc/features/v1/collections/INNAME_PUNT/items/INNAME_PUNT.")));
  assert.deepEqual(items.find((item) => item.id.startsWith("markt-ma2-")).postcodes, [], "niet in de marktlijst: geen postcode");
  const document = sourceDocument("stad-markten", { retrievedAt: NOW.toISOString(), fetchStatus: "ok", items: items.map((item) => ({ ...item, retrievedAt: NOW.toISOString() })) });
  assert.deepEqual(validateSourceDocument(document, { expectedSourceId: "stad-markten" }), []);
});

test("GIPOD: ambulante handel, geannuleerd en een tegenstrijdige marktlijst vallen weg", () => {
  const base = gipod.features.find((feature) => feature.properties.Reference === "MA1");
  const variant = (id, properties) => ({ ...base, id, properties: { ...base.properties, ...properties } });
  const geojson = {
    features: [
      variant("INNAME_PUNT.1-1", { Reference: "MA90", PublicDomainOccupancyTypes: "Markt;Ambulante handel" }),
      variant("INNAME_PUNT.2-2", { Reference: "MA91", Status: "Geannuleerd" }),
      variant("INNAME_PUNT.3-3", { Reference: "MA92", Owner: "Iemand anders" }),
      variant("INNAME_PUNT.4-4", { Reference: "MA1" }),
    ],
  };
  const wrongList = new Map([["MA1", { postcode: "2000", district: "ANTWERPEN", districtLabel: "Antwerpen", inDistrict: true }]]);
  const { items, counts } = marketsFromGipod(geojson, { now: NOW, marketList: wrongList });
  assert.equal(items.length, 0);
  assert.deepEqual(counts.rejected, { not_a_market: 1, cancelled: 1, not_a_city_market: 1 });
  assert.equal(counts.conflicts, 1);
  // Een marktdag die vandaag al voorbij is, telt niet meer: dan de volgende week.
  const afternoon = marketsFromGipod(gipod, { now: new Date("2026-09-28T12:00:00Z") });
  assert.equal(afternoon.items.find((item) => item.id.startsWith("markt-ma1-")).date, "2026-10-05");
});

test("marktenfetcher: GIPOD plus marktlijst; zonder marktlijst toch door; GIPOD stuk wist niets", async () => {
  const root = makeRoot();
  const requested = [];
  const routes = (listOk) => async (url) => {
    requested.push(new URL(String(url)).hostname);
    if (String(url).startsWith("https://geo.api.vlaanderen.be/")) return json(gipod);
    if (String(url).startsWith("https://geodata.antwerpen.be/")) return listOk ? json(marketListJson) : json({}, 503);
    return json({}, 404);
  };
  const status = await runMarkets({ rootDir: root, clock, env: {}, log: quiet, sleep: noSleep, fetch: routes(true) });
  assert.deepEqual(requested, ["geo.api.vlaanderen.be", "geodata.antwerpen.be"]);
  assert.deepEqual([status[0].fetchStatus, status[0].itemCount], ["ok", 8]);
  const document = read(root, "stad-markten");
  assert.deepEqual(validateSourceDocument(document, { expectedSourceId: "stad-markten" }), []);
  assert.equal(document.attribution.text, "Bron: GIPOD, Digitaal Vlaanderen, en marktlijst stad Antwerpen (Modellicentie Gratis Hergebruik v1.0)");

  const withoutList = await runMarkets({ rootDir: root, clock, env: {}, log: quiet, sleep: noSleep, fetch: routes(false) });
  assert.equal(withoutList[0].fetchStatus, "ok");
  assert.ok(read(root, "stad-markten").items.every((item) => item.postcodes.length === 0 && typeof item.inDistrict === "boolean"));

  const broken = await runMarkets({ rootDir: root, clock, env: {}, log: quiet, sleep: noSleep, fetch: async () => json({}, 500) });
  assert.deepEqual([broken[0].fetchStatus, broken[0].errorCode, broken[0].itemCount], ["error", "http_500", 8]);
});

// ---------- contract, register en voorrang ----------

test("bronnen in het register en het contract: groep stad, vaste hosts en attributie", () => {
  assert.deepEqual(
    FETCHERS.map((fetcher) => fetcher.name),
    ["district-kalender", "district-nieuws", "district-ebesluit", "stad-districten", "stad-markten", "stad-koopzondagen", "stad-uit", "mail"]
  );
  const districten = sourceDocument("stad-districten", { fetchStatus: "ok" });
  assert.deepEqual([districten.scope, districten.allowedHosts], ["stad", ["www.antwerpen.be"]]);
  const markten = sourceDocument("stad-markten", { fetchStatus: "ok" });
  assert.deepEqual([markten.scope, markten.allowedHosts], ["stad", ["www.antwerpen.be", "geo.api.vlaanderen.be"]]);
  const item = {
    id: "markt-ma1-2026-10-05",
    externalId: "12350257",
    title: "Gemengde markt Kioskplaats",
    theme: "Activiteit",
    className: "activity",
    date: "2026-10-05",
    endDate: null,
    timeSlot: "08:00",
    timeText: "8 tot 13 uur",
    location: "Kioskplaats, 2660 Hoboken",
    postcodes: ["2660"],
    info: "",
    kind: "activity",
    sourceUrl: "https://gipod.api.vlaanderen.be/api/v1/events/12350257",
    retrievedAt: NOW.toISOString(),
    reviewRequired: false,
    inDistrict: false,
  };
  const wrongHost = sourceDocument("stad-markten", { retrievedAt: NOW.toISOString(), fetchStatus: "ok", items: [item] });
  assert.ok(validateSourceDocument(wrongHost).some((error) => /sourceUrl/.test(error)));
  const wrongPrefix = sourceDocument("stad-districten", { retrievedAt: NOW.toISOString(), fetchStatus: "ok", items: [{ ...item, sourceUrl: "https://www.antwerpen.be/info/x" }] });
  assert.ok(validateSourceDocument(wrongPrefix).some((error) => /ongeldige id/.test(error)));
});

test("voorrang: district-nieuws > stad-districten > stad-markten > stad-uit", () => {
  const item = (id, sourceUrl) => ({
    id,
    externalId: id,
    title: "Gemengde markt Kioskplaats",
    theme: "Activiteit",
    className: "activity",
    date: "2026-10-05",
    endDate: null,
    timeSlot: "08:00",
    timeText: "8 tot 13 uur",
    location: "Kioskplaats",
    postcodes: [],
    info: "",
    kind: "activity",
    sourceUrl,
    retrievedAt: NOW.toISOString(),
  });
  const { items } = mergeEvents({
    "stad-uit": { scope: "stad", items: [item("uit-1", "https://www.uitinvlaanderen.be/agenda/e/x/1")] },
    "stad-markten": { scope: "stad", items: [{ ...item("markt-ma1-2026-10-05", "https://geo.api.vlaanderen.be/GIPOD/ogc/features/v1/collections/INNAME_PUNT/items/INNAME_PUNT.1-1"), inDistrict: false }] },
    "stad-districten": { scope: "stad", items: [{ ...item("stad-news-hoboken-a-2026-10-05", "https://www.antwerpen.be/info/a"), inDistrict: false }] },
  });
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].sources.map((source) => source.sourceId), ["stad-districten", "stad-markten", "stad-uit"]);
  assert.deepEqual([items[0].scope, items[0].inDistrict], ["stad", false]);

  const withDistrict = mergeEvents({
    "stad-districten": { scope: "stad", items: [item("stad-news-hoboken-a-2026-10-05", "https://www.antwerpen.be/info/a")] },
    "district-nieuws": { scope: "district", items: [item("district-news-b-2026-10-05", "https://www.antwerpen.be/info/b")] },
  });
  assert.deepEqual([withDistrict.items[0].sourceId, withDistrict.items[0].scope], ["district-nieuws", "district"]);
});
