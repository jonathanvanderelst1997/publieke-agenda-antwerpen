// Wens van de eigenaar (bouwrij rij 46, 16-11-2026): "ontbrekende huisnummers vanzelf aanvullen uit officiële bronnen";
// issue #262. lib/huisnummer-uit-bron.mjs zoekt de naam van een plek zonder huisnummer in de open data van de stad
// (geodata.antwerpen.be) en vult het adres alleen in als die bron precies één adres geeft.
//
// Geen netwerk: elke toets geeft een eigen fetch mee. De straten hier zijn verzonnen ("Proefstraat",
// "Verzonnenstraat"); een echte straat met een bestaand huisnummer hoort niet in een toets (lib/echte-adressen.mjs).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { sourceDocument } from "../lib/source-feed.mjs";
import {
  ADRES_LAGEN,
  GEWEIGERDE_HOSTS,
  HUISNUMMERS_AUTO_FILE,
  OPEN_DATA_HOST,
  leesOpenData,
  magLezen,
  maakAutoDocument,
  robotsVerbodenPaden,
  samenAdressen,
  validateHuisnummersAuto,
  zoekAdres,
  adresIndex,
} from "../lib/huisnummer-uit-bron.mjs";
import { metVastAdres, plaatsKennis, plaatsSoort } from "../lib/vaste-adressen.mjs";
import { buildFeed, renderFeedScript } from "../scripts/build-sources.mjs";
import { huisnummerMeldingen } from "../scripts/sources-health.mjs";
import { vulHuisnummers } from "../scripts/vul-huisnummers.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------- een kleine stad om in te zoeken ----------
const STRATEN_STAD = {
  schemaVersion: 1,
  districten: [{ key: "merksem", label: "Merksem", postcodes: ["2170"] }, { key: "deurne", label: "Deurne", postcodes: ["2100"] }],
  straten: [["Proefstraat", 1, "2170"], ["Verzonnenstraat", 1, "2170"], ["Proefstraat", 1, "2100"]],
};
const SPORTHAL = ADRES_LAGEN.find((laag) => laag.id === "sporthal");
const ZAALZOEKER = ADRES_LAGEN.find((laag) => laag.id === "zaalzoeker");
const sporthalRij = (naam, straat, huisnummer, postcode) => ({ naam, straat, huisnummer, postcode });
const zaalRij = (pandnaam, straat, huisnr, postcode) => ({ pandnaam, straat, huisnr, postcode });

// Een fetch die de open data nabootst: robots.txt bestaat niet (zoals op geodata.antwerpen.be), elke laag geeft haar
// rijen. Elke gevraagde url komt in `calls`.
function nepOpenData(rijenPerLaag = {}, { robots = null, weigerOp = null } = {}) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(String(url));
    const u = new URL(String(url));
    if (weigerOp && u.pathname.includes(weigerOp)) {
      return new Response("<html><head><title>Access Denied</title></head><body>Reference #18.1</body></html>", { status: 403 });
    }
    if (u.pathname === "/robots.txt") return robots === null ? new Response("niet gevonden", { status: 404 }) : new Response(robots, { status: 200 });
    const laag = ADRES_LAGEN.find((l) => u.href.startsWith(`${l.url}/query`));
    return Response.json({ features: (rijenPerLaag[laag?.id] ?? []).map((attributes) => ({ attributes })) });
  };
  return { fetch, calls };
}

const plekken = (...rijen) => new Map(rijen.map(([naam, postcodes = []]) => [naam.toLowerCase(), { namen: [naam], postcodes: [postcodes] }]));
const leesMet = async (rijenPerLaag) => leesOpenData({ fetch: nepOpenData(rijenPerLaag).fetch, sleep: async () => {}, pauzeMs: 0 });

// ---------- een tijdelijke repo met één activiteit zonder huisnummer ----------
function tijdelijkeRepo(location = "Sporthal Proef, District Merksem (plaats volgens het bericht)") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "huisnummer-uit-bron-"));
  fs.mkdirSync(path.join(root, "site", "sources"), { recursive: true });
  fs.mkdirSync(path.join(root, "site", "geo"), { recursive: true });
  const item = {
    id: "stad-news-merksem-proef-2026-11-18",
    externalId: "proef",
    title: "Fun Games",
    theme: "Sport",
    className: "sport",
    date: "2026-11-18",
    endDate: null,
    timeSlot: "13:00",
    timeText: "van 13 tot 16 uur",
    location,
    postcodes: ["2170"],
    info: "Een namiddag vol sport.",
    kind: "activity",
    sourceUrl: "https://www.antwerpen.be/info/proef/fun-games",
    retrievedAt: "2026-11-16T04:00:00.000Z",
    reviewRequired: false,
    inDistrict: false,
  };
  const doc = sourceDocument("stad-districten", { retrievedAt: item.retrievedAt, fetchStatus: "ok", items: [item] });
  fs.writeFileSync(path.join(root, "site", "sources", "stad-districten.json"), `${JSON.stringify(doc, null, 2)}\n`);
  fs.writeFileSync(path.join(root, "site", "geo", "straten-stad.json"), JSON.stringify(STRATEN_STAD));
  fs.writeFileSync(path.join(root, "site", "geo", "straten.json"), JSON.stringify({ schemaVersion: 1, streets: [] }));
  fs.writeFileSync(path.join(root, "site", "geo", "wijken.geo.json"), JSON.stringify({ type: "FeatureCollection", features: [] }));
  return { root, doc };
}
const klok = () => new Date("2026-11-16T05:00:00Z");
const autoBestand = (root) => path.join(root, "site", "sources", HUISNUMMERS_AUTO_FILE);
// De feed bouwen zoals build:sources, zodat sources:health de meldingen kan lezen.
function bouwFeed(root, doc) {
  const auto = fs.existsSync(autoBestand(root)) ? JSON.parse(fs.readFileSync(autoBestand(root), "utf8")) : null;
  const status = { schemaVersion: 1, generatedAt: "2026-11-16T05:00:00.000Z", classificationAsOf: "2026-11-16", sources: [] };
  const { feed } = buildFeed({ status, documents: [doc], huisnummersAuto: auto }, []);
  fs.writeFileSync(path.join(root, "site", "agenda-feed.js"), renderFeedScript(feed));
  return feed;
}

// ---------- 1. een activiteit zonder huisnummer krijgt het uit de bron ----------

test("een activiteit zonder huisnummer krijgt het uit de open data van de stad, en de melding valt weg", async () => {
  const { root, doc } = tijdelijkeRepo();
  try {
    bouwFeed(root, doc);
    const voor = huisnummerMeldingen(root, "2026-11-16");
    assert.equal(voor.length, 1, "zonder aanvulling: één melding");
    assert.match(voor[0], /^Huisnummer ontbreekt: 18-11-2026, Fun Games: Sporthal Proef, District Merksem/);

    // Een andere sporthal met een naam die alleen zo begint ("Sporthal Proef 2") telt niet.
    const { fetch, calls } = nepOpenData({
      sporthal: [sporthalRij("Sporthal Proef", "Proefstraat", "12", "2170"), sporthalRij("Sporthal Proef 2", "Verzonnenstraat", "40", "2170")],
    });
    const uitkomst = await vulHuisnummers({ rootDir: root, fetch, clock: klok, log: () => {}, sleep: async () => {}, pauzeMs: 0 });
    assert.equal(uitkomst.errorCode, null);
    assert.ok(calls.length > 1 && calls.every((url) => new URL(url).hostname === OPEN_DATA_HOST), "alleen de open data van de stad");
    const auto = JSON.parse(fs.readFileSync(autoBestand(root), "utf8"));
    assert.deepEqual(validateHuisnummersAuto(auto), []);
    assert.deepEqual(auto.plekken, [{ naam: "Sporthal Proef", herken: ["Sporthal Proef"], adres: "Proefstraat 12, 2170 Merksem", bron: SPORTHAL.url }]);
    assert.deepEqual(auto.nagekeken, []);

    // build:sources zet het adres achter de plek; wat het adres al zegt (district, opmerking) valt weg.
    const feed = bouwFeed(root, doc);
    assert.equal(feed.items[0].location, "Sporthal Proef, Proefstraat 12, 2170 Merksem");
    assert.deepEqual(huisnummerMeldingen(root, "2026-11-16"), [], "met het adres: geen melding meer");

    // Een tweede verversing met dezelfde uitkomst schrijft niets opnieuw; zonder activiteit zonder nummer vertrekt er
    // geen enkel verzoek.
    const opnieuw = await vulHuisnummers({ rootDir: root, fetch, clock: () => new Date("2026-11-17T05:00:00Z"), log: () => {}, sleep: async () => {}, pauzeMs: 0 });
    assert.equal(opnieuw.written, false, "dezelfde uitkomst: het bestand blijft (ook de datum)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("de vaste lijst gaat voor op een adres uit de open data", () => {
  const vast = { schemaVersion: 1, bijgewerkt: "2026-11-04", plekken: [{ naam: "Sporthal Proef", herken: ["Sporthal Proef"], adres: "Verzonnenstraat 999, 2170 Merksem", bron: "https://www.voorbeeld.be/sporthal" }] };
  const auto = { schemaVersion: 1, bijgewerkt: "2026-11-16", plekken: [
    { naam: "Sporthal Proef", herken: ["Sporthal Proef"], adres: "Proefstraat 12, 2170 Merksem", bron: SPORTHAL.url },
    { naam: "Zaal Proef", herken: ["Zaal Proef"], adres: "Proefstraat 14, 2170 Merksem", bron: ZAALZOEKER.url },
  ], nagekeken: [] };
  const samen = samenAdressen(vast, auto);
  assert.equal(metVastAdres("Sporthal Proef", samen), "Sporthal Proef, Verzonnenstraat 999, 2170 Merksem");
  assert.equal(metVastAdres("Zaal Proef, District Merksem", samen), "Zaal Proef, Proefstraat 14, 2170 Merksem");
  assert.equal(samenAdressen(vast, null), vast, "zonder automatisch bestand: de vaste lijst zoals ze was");
});

// ---------- 2. een dubbelzinnige bron vult niets in ----------

test("een dubbelzinnige bron vult niets in, en de melding zegt wat er ontbreekt", async () => {
  // Twee adressen voor dezelfde naam (in twee lagen).
  const gelezen = await leesMet({
    sporthal: [sporthalRij("Zaal Proef", "Proefstraat", "12", "2170")],
    zaalzoeker: [zaalRij("Zaal Proef", "Verzonnenstraat", "14", "2170")],
  });
  const doc = maakAutoDocument({ plekken: plekken(["Zaal Proef", ["2170"]]), ...gelezen, vandaag: "2026-11-16", stratenStad: STRATEN_STAD });
  assert.deepEqual(doc.plekken, []);
  assert.deepEqual(doc.nagekeken, [{ herken: "Zaal Proef", uitkomst: "dubbelzinnig" }]);

  // Hetzelfde adres in twee lagen is wel eenduidig.
  const zelfde = await leesMet({ sporthal: [sporthalRij("Zaal Proef", "Proefstraat", "12", "2170")], zaalzoeker: [zaalRij("zaal proef ", "PROEFSTRAAT", "12", "2170")] });
  assert.equal(zoekAdres("Zaal Proef", adresIndex(zelfde.adressen, { stratenStad: STRATEN_STAD })).adres, "Proefstraat 12, 2170 Merksem");

  // Elke andere twijfel: niets.
  const index = adresIndex((await leesMet({
    sporthal: [
      sporthalRij("Sporthal Zonder Nummer", "Proefstraat", " ", "2170"),
      sporthalRij("Sporthal Onbekende Straat", "Nergensstraat", "3", "2170"),
      sporthalRij("Sporthal Buiten De Stad", "Proefstraat", "3", "9999"),
      sporthalRij("Sporthal Andere Postcode", "Proefstraat", "5", "2100"),
    ],
  })).adressen, { stratenStad: STRATEN_STAD });
  assert.equal(zoekAdres("Sporthal Zonder Nummer", index).uitkomst, "zonder_huisnummer");
  assert.equal(zoekAdres("Sporthal Onbekende Straat", index).uitkomst, "adres_onvolledig");
  assert.equal(zoekAdres("Sporthal Buiten De Stad", index).uitkomst, "adres_onvolledig");
  assert.equal(zoekAdres("Sporthal Andere Postcode", index, { postcodes: [["2170"]] }).uitkomst, "andere_postcode", "de activiteit zegt Merksem");
  assert.equal(zoekAdres("Sporthal Andere Postcode", index).adres, "Proefstraat 5, 2100 Deurne", "zonder postcode bij de activiteit: wel");
  assert.equal(zoekAdres("Sporthal Nergens", index).uitkomst, "niet_gevonden");
  assert.equal(zoekAdres("Sporthal", index).uitkomst, "niet_gevonden", "een stuk van een naam telt niet");

  // In de repo: geen adres, en de melding blijft staan met wat er ontbreekt.
  const { root, doc: bron } = tijdelijkeRepo("Zaal Proef, District Merksem");
  try {
    const { fetch } = nepOpenData({ sporthal: [sporthalRij("Zaal Proef", "Proefstraat", "12", "2170")], zaalzoeker: [zaalRij("Zaal Proef", "Verzonnenstraat", "14", "2170")] });
    await vulHuisnummers({ rootDir: root, fetch, clock: klok, log: () => {}, sleep: async () => {}, pauzeMs: 0 });
    const auto = JSON.parse(fs.readFileSync(autoBestand(root), "utf8"));
    assert.deepEqual(auto.plekken, []);
    const feed = bouwFeed(root, bron);
    assert.equal(feed.items[0].location, "Zaal Proef, District Merksem", "geen gok");
    assert.deepEqual(huisnummerMeldingen(root, "2026-11-16"), [
      "Huisnummer ontbreekt: 18-11-2026, Fun Games: Zaal Proef, District Merksem (stad-districten; de open data van de stad geeft meer dan één adres)",
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------- 3. niets wordt gelezen van een geweigerde site ----------

test("niets wordt gelezen van een site die automatisch lezen weigert", async () => {
  for (const host of GEWEIGERDE_HOSTS) assert.equal(magLezen(`https://${host}/arcgissql/rest/services/x/MapServer/1/query`), false, host);
  assert.equal(magLezen("http://geodata.antwerpen.be/arcgissql/rest/services"), false, "alleen https");
  assert.equal(magLezen("https://geodata.antwerpen.be.voorbeeld.be/x"), false, "geen andere host met dezelfde naam erin");
  assert.equal(magLezen("https://geodata.antwerpen.be/arcgissql/rest/services/P_Portal/portal_publiek6/MapServer/643"), true);
  for (const laag of ADRES_LAGEN) assert.equal(new URL(laag.url).hostname, OPEN_DATA_HOST, laag.id);

  // Een laag die naar een geweigerde site wijst: geen enkel verzoek, ook niet naar robots.txt of de andere lagen.
  for (const host of ["www.antwerpen.be", "api.basisregisters.vlaanderen.be"]) {
    const { fetch, calls } = nepOpenData();
    const lagen = [...ADRES_LAGEN, { ...SPORTHAL, id: "geweigerd", url: `https://${host}/arcgissql/rest/services/x/MapServer/1` }];
    await assert.rejects(leesOpenData({ fetch, adresLagen: lagen, sleep: async () => {}, pauzeMs: 0 }), { code: "host_niet_toegelaten" });
    assert.deepEqual(calls, [], host);
  }

  // In de verversing: het vorige bestand blijft staan en er vertrekt niets.
  const { root } = tijdelijkeRepo();
  try {
    const vorige = `${JSON.stringify({ schemaVersion: 1, bijgewerkt: "2026-11-15", plekken: [], nagekeken: [{ herken: "Sporthal Proef", uitkomst: "niet_gevonden" }] })}\n`;
    fs.writeFileSync(autoBestand(root), vorige);
    const { fetch, calls } = nepOpenData();
    const lagen = [{ ...SPORTHAL, url: "https://www.antwerpen.be/arcgissql/rest/services/x/MapServer/1" }];
    const uitkomst = await vulHuisnummers({ rootDir: root, fetch, clock: klok, log: () => {}, sleep: async () => {}, pauzeMs: 0, adresLagen: lagen });
    assert.equal(uitkomst.errorCode, "host_niet_toegelaten");
    assert.deepEqual(calls, []);
    assert.equal(fs.readFileSync(autoBestand(root), "utf8"), vorige, "het vorige bestand blijft");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  // Een weigering (403 "Access Denied") stopt het lezen meteen; robots.txt die het verbiedt, ook.
  const geweigerd = nepOpenData({}, { weigerOp: "/MapServer/643" });
  await assert.rejects(leesOpenData({ fetch: geweigerd.fetch, sleep: async () => {}, pauzeMs: 0 }), { code: "bron_weigert_automatisch" });
  assert.equal(geweigerd.calls.filter((url) => url.includes("/query")).length, 1, "na de weigering geen verzoek meer");
  const verboden = nepOpenData({}, { robots: "User-agent: *\nDisallow: /arcgissql/\n" });
  await assert.rejects(leesOpenData({ fetch: verboden.fetch, sleep: async () => {}, pauzeMs: 0 }), { code: "robots_verbiedt" });
  assert.deepEqual(verboden.calls.map((url) => new URL(url).pathname), ["/robots.txt"]);
  assert.deepEqual(robotsVerbodenPaden("User-agent: publieke-agenda-antwerpen\nDisallow: /x\n\nUser-agent: *\nDisallow:\n"), ["/x"], "de eigen groep gaat voor");

  // Een bron op een andere site komt nooit in het bestand.
  const fout = { schemaVersion: 1, bijgewerkt: "2026-11-16", plekken: [{ naam: "Zaal Proef", herken: ["Zaal Proef"], adres: "Proefstraat 12, 2170 Merksem", bron: "https://www.antwerpen.be/zaal-proef" }], nagekeken: [] };
  assert.ok(validateHuisnummersAuto(fout).some((e) => e.includes(OPEN_DATA_HOST)));
});

test("zonder activiteit zonder huisnummer vertrekt er geen enkel verzoek", async () => {
  const { root } = tijdelijkeRepo("Verzonnenstraat 999, 2170 Merksem");
  try {
    const { fetch, calls } = nepOpenData();
    const uitkomst = await vulHuisnummers({ rootDir: root, fetch, clock: klok, log: () => {}, sleep: async () => {}, pauzeMs: 0 });
    assert.deepEqual(calls, []);
    assert.deepEqual(uitkomst.document.plekken, []);
    assert.deepEqual(uitkomst.document.nagekeken, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------- issue #262: openbare ruimte stond op de lijst ----------

const leesGeo = (naam) => JSON.parse(fs.readFileSync(path.join(rootDir, "site", "geo", naam), "utf8"));
const kennis = plaatsKennis({ straten: leesGeo("straten.json"), stratenStad: leesGeo("straten-stad.json"), wijken: leesGeo("wijken.geo.json") });

test("issue #262: een route, een kaai en een wijk zijn openbare ruimte, geen gebouw", () => {
  // Een officiële straatnaam met "en" erin blijft één straat ("Plantin" telde los als gebouw).
  assert.equal(plaatsSoort("Plantin en Moretuslei, Provinciestraat en Rolwagenstraat", kennis), "openbare_ruimte");
  // Kaaien in het meervoud.
  assert.equal(plaatsSoort("Scheldekaaien Zuid, 2000 Antwerpen", kennis), "openbare_ruimte");
  // "<plek> in <district>": de wijk Rivierenhof in Deurne (wijkindeling van de stad).
  assert.equal(plaatsSoort("Rivierenhof in Deurne", kennis), "openbare_ruimte");
  // Een gebouw blijft een gebouw, ook met "en" of "in" in de naam.
  assert.equal(plaatsSoort("Sporthal Proef, District Merksem (plaats volgens het bericht)", kennis), "gebouw");
  assert.equal(plaatsSoort("Zaal Plantin en Moretus", kennis), "gebouw");
  assert.equal(plaatsSoort("Zaal Proef in Nergenshuizen", kennis), "gebouw", "alleen een gekend district of een wijk");
});

test("issue #262: de gebouwde feed heeft geen route, kaai of wijk meer op de lijst Huisnummer ontbreekt", () => {
  for (const regel of huisnummerMeldingen(rootDir, "2026-11-16")) {
    assert.doesNotMatch(regel, /Plantin en Moretuslei|Scheldekaaien|Rivierenhof in Deurne/, regel);
  }
});
