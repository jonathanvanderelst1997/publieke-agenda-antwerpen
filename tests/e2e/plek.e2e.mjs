// End-to-end: zoeken op plek in een echte browser (Playwright + Chromium), tegen de gebouwde site/.
// Draai met `npm run test:e2e`. Alles buiten de lokale site wordt onderschept: de live bronnen (GIPOD,
// straatas, A-Sign, vergunningen) krijgen kleine vaste antwoorden en de kaarttegels/Leaflet worden
// geweigerd, zodat de test offline en deterministisch is. De klok staat op de dag van de data.
// Zonder Playwright of Chromium wordt de test overgeslagen (CI installeert geen browser).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { resolveAddressStreets } from "../../site/street-core.js";
import { buildPlaceIndex, foldText } from "../../site/place-core.js";
import { falendeBronnen, gezondeBronnen } from "../helpers/proef-feed.mjs";
import { locationKey } from "../../site/neighborhood-core.js";
import { GIPOD_BRON, GIPOD_METADATA_URL } from "../../site/gipod-bron.js";
import { adresZonderHuisnummer, publiekParkeerAdres } from "../../site/adres-privacy.js";
import { echteAdresStukken, laadStraatnamen } from "../../lib/echte-adressen.mjs";
import { echteFeed, feedScript, kalenderItem, marktItem, proefFeed } from "../helpers/proef-feed.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const site = path.join(root, "site");

async function loadPlaywright() {
  for (const spec of [process.env.PLAYWRIGHT_MODULE, "playwright"].filter(Boolean)) {
    try { return await import(spec); } catch { /* volgende */ }
  }
  try {
    const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
    return await import(path.join(globalRoot, "playwright", "index.mjs"));
  } catch { return null; }
}
const pw = await loadPlaywright();
let browser = null;
if (pw) {
  try { browser = await pw.chromium.launch(); } catch {
    try { browser = await pw.chromium.launch({ executablePath: path.join(process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers", "chromium") }); } catch { browser = null; }
  }
}
const skip = browser ? false : "Playwright/Chromium niet beschikbaar";

// ---- lokale server voor site/ ----
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".xml": "application/xml", ".txt": "text/plain" };
function serve() {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = path.normalize(path.join(site, pathname));
    if (!file.startsWith(site)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) file = path.join(site, "index.html"); // zoals de rewrite in render.yaml
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// ---- data en vaste antwoorden ----
const straten = JSON.parse(fs.readFileSync(path.join(site, "geo", "straten.json"), "utf8"));
// De officiële straatnamen: een echte straat krijgt in een fixture alleen huisnummer 999 (lib/echte-adressen.mjs).
const ECHTE_STRATEN = laadStraatnamen(path.join(site, "geo", "straten.json"));
const byName = new Map();
for (const [id, name, postcode] of straten.streets) byName.set(locationKey(name), [...(byName.get(locationKey(name)) || []), { id: String(id), name, postcode }]);
// De straatnamen van de andere districten (site/geo/straten-stad.json): een straat met een naamgenoot elders in de
// stad laat met Enter kiezen (bouwplan stap 3). De toetsen die gewoon een straat openen, nemen er een zonder.
const stadStraten = JSON.parse(fs.readFileSync(path.join(site, "geo", "straten-stad.json"), "utf8"));
const elders = new Set(stadStraten.straten.map((r) => locationKey(r[0])));
// Een straat die zo heet als een wijk of een andere naam van een wijk (de Meir: de wijk "Theaterbuurt & Meir") laat met
// Enter zonder huisnummer ook kiezen (enterKeuze, #196): "2 plekken heten …". Ook die nemen de toetsen die gewoon een
// straat openen niet ("geen horizontale scroll" typt de naam zonder nummer). Met een huisnummer opent Enter de straat:
// dat toetst "Enter op de Meir met een huisnummer" hieronder, met de Meir zelf.
const wijkDoc = JSON.parse(fs.readFileSync(path.join(site, "geo", "wijken.geo.json"), "utf8"));
const wijkIndex = buildPlaceIndex({ wijken: wijkDoc.features.filter((f) => String(f.properties?.code || "").startsWith("ANT")).map((f) => ({ code: f.properties.code, naam: f.properties.naam })) });
const wijkNamen = new Set(wijkIndex.places.filter((p) => p.type === "wijk").flatMap((p) => [p.compact, ...(p.aliases || [])]));
const heetAlsWijk = (naam) => wijkNamen.has(foldText(naam).replace(/ /g, ""));
const feedText = fs.readFileSync(path.join(site, "agenda-feed.js"), "utf8");
const generatedAt = JSON.parse(feedText.slice(feedText.indexOf("{"), feedText.lastIndexOf("}") + 1)).generatedAt;
const today = generatedAt.slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const district = fs.readFileSync(path.join(root, "lib", "district-antwerpen-grens.geojson"), "utf8");
const WORK_TITLE = "Proefwerk riolering (e2e)";
// De verzonnen reden van een parkeerverbod in A-Sign (laag 20), en wat haar zou verraden: die mag nergens op de pagina.
// Geen verhuizing: bij een verhuizing toont ook live alleen de straat (regel van de eigenaar van 26 oktober 2026,
// isVerhuisReden in site/adres-privacy.js), en deze toets kijkt naar de plaats met het huisnummer.
const REDEN_E2E = "Filmopname (e2e)";
const VERRAAD_E2E = /filmopname/i;
// De titel van een werk komt uit de kaartuitleg; de rij vinden we daarom op haar id.
const WORK_ROW = '.pv-row[data-uid="works:999999901"]';
// Een verzonnen omgevingsaanvraag met een naam en een telefoonnummer in het vrije onderwerp:
// de kaart moet zeggen wat er gebeurt, zonder iets van dat onderwerp te tonen.
const PERMIT_TITLE = "Sloop en nieuwbouw (6 woningen en een winkel)";
// Inzageloket (site/inzage-status.js): de eerlijke zin zonder nagekeken stand en een vaste stand per toets.
const GEEN_INZAGE = "Deze site kon niet nagaan of er nu een openbaar onderzoek loopt. Het Inzageloket toont een aanvraag alleen tijdens het openbaar onderzoek en tijdens de beroepstermijn na de beslissing.";
const LOKET_LINK = "https://omgevingsloketinzage.omgeving.vlaanderen.be/2099000001";
const BEZWAAR_LABEL = "Zo dien je een bezwaar in (uitleg van Vlaanderen)";
const inzageStand = (dossier) => ({ schema: "inzage-status/1", uitleg: "e2e", dossiers: [{ project: "OMV_2099000001", gevonden: true, toestand: "openbaar onderzoek", bron: "handmatig", ...dossier }] });
const MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const dagTekst = (iso) => `${Number(iso.slice(8))} ${MAANDEN[Number(iso.slice(5, 7)) - 1]}${iso.slice(0, 4) === today.slice(0, 4) ? "" : ` ${iso.slice(0, 4)}`}`;

// Een nagebootste A-Sign-server: veel ids zoals in het echt (laag 20 had op 9/10 5.781 ids), een
// 404 voor een URL boven 2.000 tekens zoals de stadsserver, en telling van gelijktijdige verzoeken.
// `fail` zijn laagnummers die niet antwoorden; `fixtures` zijn records per laag die terugkomen.
const reeks = (n, vanaf) => Array.from({ length: n }, (_, i) => vanaf + i);
function asignServer({ fail = [], fixtures = {} } = {}) {
  const stats = { urls: [], teLang: 0, bezig: 0, maxBezig: 0 };
  const ids = { 19: [], 20: reeks(5781, 700000), 22: reeks(581, 10000), 23: reeks(148, 1000), 47: reeks(1026, 20000), 48: reeks(1738, 30000), 49: reeks(2912, 1000) };
  for (const [laag, records] of Object.entries(fixtures)) for (const r of records) if (!ids[laag].includes(r.id)) ids[laag].push(r.id);
  const handle = async (route, url) => {
    const laag = Number((url.match(/MapServer\/(\d+)\/query/) || [])[1]);
    if (fail.includes(laag)) return route.abort();
    stats.urls.push(url.length);
    stats.bezig += 1; stats.maxBezig = Math.max(stats.maxBezig, stats.bezig);
    await new Promise((r) => setTimeout(r, 15));
    try {
      if (url.length > 2000) { stats.teLang += 1; await route.fulfill({ status: 404, contentType: "text/html", body: "Not Found" }); return; }
      const u = new URL(url);
      const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      if (u.searchParams.get("returnIdsOnly") === "true") { await json({ objectIds: ids[laag] || [] }); return; }
      const gevraagd = new Set(String(u.searchParams.get("objectIds") || "").split(",").map(Number));
      await json({ features: (fixtures[laag] || []).filter((r) => gevraagd.has(r.id)).map((r) => r.feature) });
    } finally { stats.bezig -= 1; }
  };
  return { stats, handle };
}

// `plat`: bronnen die niet antwoorden (zoals bij een storing): "alles" (alles buiten de lokale site), "gipod" (werken en
// hinder), "hinder" (alleen HINDER_PUNT), "asign" (alle A-Sign-lagen) en "awv" (het AWV-bestand van de verversing).
async function routeSources(page, street, { asign = null, work: withWork = true, werkStukken = 1, assen = [], vergunningen = [], evenement = null, aanvraag = true, plat = [] } = {}) {
  if (plat.includes("awv")) await page.route((url) => url.hostname === "127.0.0.1" && url.pathname === "/sources/awv-werf-supplement.json", (route) => route.abort());
  // Zonder straatbestanden (P5): deze toetsen gaan over de volledige live lagen, niet over de stand van
  // de ochtend (die toetst tests/e2e/snelheid.e2e.mjs), en hangen zo niet af van wat er in site/straat staat.
  await page.route((url) => url.hostname === "127.0.0.1" && url.pathname === "/straat-index.json", (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "" }));
  const row = straten.streets.find((r) => String(r[0]) === street.id && r[2] === street.postcode);
  const [x1, y1, x2, y2] = row[4];
  const mid = [(x1 + x2) / 2, (y1 + y2) / 2];
  const axis = { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: [[x1, y1], [x2, y2]] }, properties: { LSTRNMID: Number(street.id), LSTRNM: street.name, RSTRNMID: Number(street.id), RSTRNM: street.name, postcode: Number(street.postcode), DISTRICT: "Antwerpen" } }, ...assen] };
  // Desgewenst één werf in stukken (`werkStukken`): dezelfde omschrijving, beheerder, status en periode,
  // elk stuk met een eigen GIPOD-nummer en een eigen punt op de straat (zoals de werfzones van Ringpark Zuid).
  const stukPunt = (i) => [x1 + (x2 - x1) * (0.5 - 0.15 * i), y1 + (y2 - y1) * (0.5 - 0.15 * i)];
  const work = {
    type: "FeatureCollection", links: [],
    features: Array.from({ length: werkStukken }, (_, i) => ({ type: "Feature", geometry: { type: "Point", coordinates: i ? stukPunt(i) : mid }, properties: { GipodId: 999999901 + i, Description: WORK_TITLE, Owner: "water-link", Status: "Concreet gepland", Start: `${addDays(today, 9)}T06:00:00Z`, End: `${addDays(today, 30)}T16:00:00Z`, Uri: `https://gipod.api.vlaanderen.be/api/v1/mobility-hindrances/${999999901 + i}`,
      // Verzonnen contactgegevens, zoals een ruw GIPOD-record ze kan dragen: ze mogen nergens op de site komen.
      ContactOrganisations: JSON.stringify([{ ContactRole: "Dossierbeheerder", OrganisationName: "Voorbeeldorganisatie", ContactName: "Voorbeeld Persoon", Email: "voorbeeld@example.org" }]) } })),
  };
  const d = 0.0002;
  const permit = {
    attributes: { Dossiernummer: "20990001", DOSSIERTYPE: "OMV2019_AANVRAAG", AardAanvraag: "Aanvraag omgevingsproject", Onderwerp: "slopen van 2 panden en bouwen van een gemengd gebouw met een detailhandel en 6 woonentiteiten, aanvrager Jan Voorbeeld 0470 12 34 56", Volledig: "ja", Ontvankelijk: "ja", Ingetrokken: "nee", Stopgezet: "nee", ProjectnummerOmgevingsloket: "OMV_2099000001", behandelendeOverheid: "College van burgemeester en schepenen" },
    geometry: { rings: [[[mid[0] - d, mid[1] - d], [mid[0] + d, mid[1] - d], [mid[0] + d, mid[1] + d], [mid[0] - d, mid[1] + d], [mid[0] - d, mid[1] - d]]] },
  };
  const json = (body) => ({ status: 200, contentType: "application/json", body: typeof body === "string" ? body : JSON.stringify(body) });
  // Een verzonnen evenementendossier (A-Sign laag 23): een parcours over de gekozen straat.
  const fase = evenement && Date.parse(`${evenement.dag}T08:00:00Z`);
  // Desgewenst een ander type (een gewone inname), een omschrijving en een einde weken later (`tot`).
  const parcours = evenement && { attributes: { dossierNummer: evenement.dossier, faseId: "F1", innameId: "I1", dossierStatus: "aanvraag_goedgekeurd", faseNaam: "Evenement", type_dossier: "ETL", innameTypeNaam: evenement.type || "Parcours", innameBeschrijving: evenement.beschrijving || "", innameHinder: "True", faseStartDatum: fase, faseEindDatum: evenement.tot ? Date.parse(`${evenement.tot}T08:00:00Z`) : fase }, geometry: { paths: [[[x1, y1], [x2, y2]]] } };
  // Desgewenst een parkeerverbod tijdens de afbraak, na de dag van het evenement, in dezelfde straat.
  const afbraak = evenement?.afbraakTot && { attributes: { ...parcours.attributes, faseId: "F2", innameId: "I2", faseNaam: "Afbraak", innameTypeNaam: "Parkeerverbod in Straat", faseStartDatum: fase, faseEindDatum: Date.parse(`${evenement.afbraakTot}T08:00:00Z`) }, geometry: { paths: [[[x1, y1], [x2, y2]]] } };
  await page.route((url) => !/^http:\/\/127\.0\.0\.1/.test(url.href), (route) => {
    const url = route.request().url();
    if (plat.includes("alles") || (plat.includes("gipod") && url.includes("/GIPOD/")) || (plat.includes("hinder") && url.includes("/collections/HINDER_PUNT/")) || (plat.includes("asign") && url.includes("/P_ASign/"))) return route.abort();
    if (url.includes("/collections/INNAME_PUNT/")) return route.fulfill(json(withWork ? work : { type: "FeatureCollection", features: [], links: [] }));
    if (url.includes("/collections/HINDER_PUNT/")) return route.fulfill(json({ type: "FeatureCollection", features: [], links: [] }));
    if (url.includes("/MapServer/109/")) return route.fulfill(json(district));
    if (url.includes("/MapServer/905/")) return route.fulfill(json(axis));
    if (asign && url.includes("/P_ASign/")) return asign.handle(route, url);
    if (vergunningen.length && url.includes("/pip2_vergunningen/")) return route.fulfill(json(url.includes("returnIdsOnly") ? { objectIds: vergunningen.map((_, i) => i + 1) } : { features: vergunningen }));
    if (parcours && url.includes("/MapServer/23/query")) return route.fulfill(json(url.includes("returnIdsOnly") ? { objectIds: afbraak ? [1, 2] : [1] } : { features: afbraak ? [parcours, afbraak] : [parcours] }));
    // Standaard één verzonnen aanvraag in de gekozen straat; `aanvraag: false` voor een lege straat.
    if (url.includes("/pip2_vergunningen/MapServer/5/")) return route.fulfill(json(url.includes("returnIdsOnly") ? { objectIds: aanvraag ? [1] : [] } : { features: aanvraag ? [permit] : [] }));
    if (url.includes("geodata.antwerpen.be")) return route.fulfill(json(url.includes("returnIdsOnly") ? { objectIds: [] } : { features: [] }));
    return route.abort();
  });
}

// Een verzonnen agendapunt in de vorm van een echt feed-item (een kopie van een item uit de feed met
// een eigen id, titel, dag en plek), voor een toets die een agendapunt op een vaste dag in een straat nodig heeft.
const proefAgendapunt = (dag, straat) => ({
  id: `e2e-weekzin-${dag}`, externalId: "e2e-weekzin", title: "Proefconcert (e2e)", date: dag, endDate: "", timeSlot: "20:00", timeText: "",
  location: `${straat.name}, ${straat.postcode} Antwerpen`, postcodes: [straat.postcode], info: "Verzonnen agendapunt voor de toets.", infoUrl: "", dateLabel: dagTekst(dag),
});

// "Dit weekend" met nagebootste items (nakijkbevinding: de toets hing af van de weekdag van de data). Een feed
// van dag `dag`: alle bronnen die ochtend opgehaald, en alleen verzonnen items. De klok staat dan op `dag`.
const weekdagVan = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay(); // 0 = zondag
const volgendeWeekdag = (iso, wd) => addDays(iso, (wd - weekdagVan(iso) + 7) % 7);
// Dit weekend volgens de site: vrijdag t/m zondag van die week, op zaterdag en zondag vanaf vandaag.
const weekendDagen = (dag) => {
  const van = [6, 0].includes(weekdagVan(dag)) ? dag : volgendeWeekdag(dag, 5);
  return [van, addDays(van, 1), addDays(van, 2)].filter((d) => d <= volgendeWeekdag(dag, 0));
};
const LANGE_TITELS = [
  "Openluchtconcert met het jeugdorkest van de muziekacademie", "Voorleesnamiddag voor kinderen en hun grootouders in de bibliotheek",
  "Wandelzoektocht langs de verborgen binnentuinen van de wijk", "Theatervoorstelling over honderd jaar havenarbeid aan de kaaien",
  "Buurtfeest met springkasteel, muziek en een grote picknick", "Fietstocht langs de nieuwe groene parels van het district",
  "Rommelmarkt van de bewonersvereniging op het pleintje", "Filmavond in openlucht met een klassieker uit de jaren zestig",
  "Danslessen voor beginners in het buurthuis, met koffie en taart",
];
// De basisitems zijn vaste letterlijke objecten (tests/helpers/proef-feed.mjs), niet geleend uit de echte feed.
// Echte weekenditems hebben vaak een lange plaats ("Kloosterstraat, Arenbergstraat ... en 31 andere straten"):
// met `langePlaats` ook de helft van de uitstappen, zodat de toets meet wat zo'n plaats doet met het blok.
const LANGE_PLAATS = "Proefstraat, Proeflaan, Proefkaai, Proefplein, Proefvest, Proefdreef en 31 andere straten";
function weekendFeed(dag, { uitstappen = 0, markten = [], langePlaats = false } = {}) {
  const dagen = weekendDagen(dag);
  return proefFeed(dag, (stempel) => [
    ...Array.from({ length: uitstappen }, (_, i) => kalenderItem(stempel, {
      id: `e2e-weekend-${i + 1}`, externalId: `e2e-weekend-${i + 1}`, title: `${LANGE_TITELS[i % LANGE_TITELS.length]} (e2e ${i + 1})`,
      date: dagen[i % dagen.length], timeSlot: `${String(10 + (i % 9)).padStart(2, "0")}:00`, location: langePlaats && i % 2 === 0 ? LANGE_PLAATS : "Proefplein 1, 2000 Antwerpen", postcodes: ["2000"],
      dateLabel: dagTekst(dagen[i % dagen.length]),
    })),
    // Een wekelijkse markt (stad, in het district) op een dag van het weekend: `markten` = [[naam, plein, dagindex], ...].
    ...markten.map(([naam, plein, d], i) => marktItem(stempel, {
      id: `e2e-markt-${i + 1}`, externalId: `e2e-markt-${i + 1}`, title: naam, location: `${plein}, 2000 Antwerpen`,
      date: dagen[Math.min(d, dagen.length - 1)], dateLabel: dagTekst(dagen[Math.min(d, dagen.length - 1)]),
    })),
  ]);
}

async function openPage(baseUrl, { width = 390, height = 844, query = "", street = null, asign = null, work = true, werkStukken = 1, assen = [], vergunningen = [], kaartUitleg = null, evenement = null, aanvraag = true, inzage = null, agendaErbij = [], kaartLaat = false, dag = today, feed = null, plat = [] } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 500, hasTouch: width < 500, locale: "nl-BE", timezoneId: "Europe/Brussels" });
  const page = await context.newPage();
  if (kaartUitleg) await page.route("**/sources/kaart-uitleg.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(kaartUitleg) }));
  // De echte feed met verzonnen agendapunten erbij (`agendaErbij`, met een vaste letterlijke basis), of een volledig
  // nagebootste feed (`feed`: weekendFeed, proefFeed) met de klok op de dag van die feed. De echte items, maar de bronnen
  // gezond (gezondeBronnen), zodat de opmaak niet afhangt van de bronstatus op de dag van de data.
  if (agendaErbij.length && !feed) await page.route((url) => url.hostname === "127.0.0.1" && url.pathname === "/agenda-feed.js", (route) => {
    const echt = gezondeBronnen(echteFeed());
    echt.items.push(...agendaErbij.map((item) => kalenderItem(echt.generatedAt, item)));
    return route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: feedScript(echt) });
  });
  if (feed) await page.route((url) => url.hostname === "127.0.0.1" && url.pathname === "/agenda-feed.js", (route) => route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: feedScript(feed) }));
  await page.clock.setFixedTime(new Date(`${dag}T10:00:00+02:00`));
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const geodataFouten = [];
  page.on("requestfailed", (request) => { if (/geodata\.antwerpen\.be/.test(request.url())) geodataFouten.push(request.url()); });
  await routeSources(page, street || pickStreet.fallback, { asign, work, werkStukken, assen, vergunningen, evenement, aanvraag, plat });
  // Een trage kaart (`kaartLaat`): de module van de buurtkaart komt pas als het plekoverzicht zijn lijst al
  // toonde (en de kaart dus al gemeld had hoeveel erin staat).
  if (kaartLaat) await page.route((url) => url.hostname === "127.0.0.1" && url.pathname === "/neighborhood-map.js", async (route) => {
    await page.waitForFunction(() => /uit officiële bronnen/.test(document.querySelector(".pv-sub")?.textContent || ""), null, { timeout: 15000 }).catch(() => {});
    await route.continue();
  });
  // Een vaste nagekeken stand in het Inzageloket voor de verzonnen aanvraag (site/inzage-status.js).
  if (inzage) await page.route((url) => url.pathname === "/sources/inzage-status.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(inzage) }));
  await page.goto(`${baseUrl}/${query}`);
  await page.waitForSelector(".pv-chip");
  return { page, context, errors, geodataFouten };
}

// Een komend evenement waarvan de locatie aan precies één officiële straat hangt.
async function pickStreet(baseUrl) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(`${today}T10:00:00+02:00`));
  await page.route((url) => !/^http:\/\/127\.0\.0\.1/.test(url.href), (route) => route.abort());
  await page.goto(`${baseUrl}/`);
  await page.waitForSelector(".pv-chip");
  await page.click('[data-group="*"]');
  const items = await page.evaluate(() => (window.PUBLIC_AGENDA_VISIBLE_ITEMS || []).map((i) => ({ id: i.id, title: i.title, date: i.date, endDate: i.endDate || "", location: i.location || "", category: i.category })));
  await context.close();
  const horizon = addDays(today, 29);
  // Een vermoedelijke studentenactiviteit staat op de plekpagina in de ingeklapte regel van haar dag (bundelLijst,
  // vaagheidsplan van 12 oktober 2026, stap 5): die is de proef "student", niet het gewone evenement.
  const isStudent = (item) => /^Vermoedelijk\b/.test(item.title) && /\b(?:student\w*|doop\w*|dril\w*|welkomst\w*)/i.test(item.title);
  let gekozen = null, student = null;
  for (const item of items.sort((a, b) => a.date.localeCompare(b.date))) {
    if (item.date < today || item.date > horizon || item.endDate || ["markets", "meetings", "works"].includes(item.category)) continue;
    const streets = resolveAddressStreets(item.location, { byName }).streets;
    if (streets.length !== 1 || elders.has(locationKey(streets[0].name)) || heetAlsWijk(streets[0].name)) continue;
    gekozen ||= { event: item, street: streets[0] };
    if (isStudent(item)) student ||= { event: item, street: streets[0] };
  }
  return gekozen ? { ...gekozen, student, isStudent } : null;
}
pickStreet.fallback = { id: "1416", name: "Kammenstraat", postcode: "2000" };

test("zoeken op plek, end-to-end", { skip }, async (t) => {
  const server = await serve();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await browser.close(); });
  const pick = await pickStreet(baseUrl);
  assert.ok(pick, "de data heeft een komend evenement in een officiële straat");
  const { event, street } = pick;
  t.diagnostic(`plek: ${street.name} ${street.postcode} · evenement: ${event.title} (${event.date})`);

  await t.test("straat typen → suggestie → plekoverzicht met evenement én gepland werk", async () => {
    const { page, context, errors } = await openPage(baseUrl, { street });
    const input = page.locator("#agenda-street-jump");
    // Zoals een bewoner typt: kleine letters, afgekort, met huisnummer.
    const typed = `${street.name.toLowerCase().replace(/straat$/, "str.")} 12`;
    await input.fill(typed);
    const option = page.locator("#pv-suggestions [role=option]").first();
    await option.waitFor();
    assert.match(await option.innerText(), new RegExp(street.name));
    assert.equal(await input.getAttribute("aria-expanded"), "true");
    await input.press("Enter");
    await page.waitForFunction(() => new URL(location.href).searchParams.has("plek"));
    assert.equal(await page.locator(".pv-place-name").innerText(), street.name);
    // Een vermoedelijke studentenactiviteit staat in de ingeklapte regel van haar dag: eerst openklappen.
    if (pick.isStudent(event)) {
      const bundels = page.locator(".pv-results .pv-row.pv-bundel", { hasText: /vermoedelijke studentenactiviteit/ });
      await bundels.first().waitFor({ timeout: 30000 });
      for (let i = 0; i < await bundels.count(); i++) await bundels.nth(i).locator(".pv-row-btn").first().click();
    }
    await page.locator(".pv-results").getByText(event.title, { exact: false }).first().waitFor();
    const row = page.locator(`.pv-results ${WORK_ROW}`).first();
    await row.waitFor({ timeout: 15000 });
    assert.match(await row.innerText(), /Gepland/);
    // Details openen inline, zonder pop-up.
    await row.locator(".pv-row-btn").click();
    assert.equal(await row.locator(".pv-row-btn").getAttribute("aria-expanded"), "true");
    assert.match(await row.locator(".pv-detail").innerText(), /water-link/);
    // De voortgang zegt wat de tweede duur is: de lengte van het werk.
    assert.equal(await row.locator(".pv-progress-text").innerText(), "Start over 9 dagen · duurt 22 dagen");
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test("stap 5: vermoedelijke studentenactiviteiten van een dag in één ingeklapte regel; openklappen toont de kaart", async (st) => {
    if (!pick.student) { st.skip("geen komende vermoedelijke studentenactiviteit in één straat in de data"); return; }
    const { event: ev, street: str } = pick.student;
    const { page, context, errors } = await openPage(baseUrl, { street: str, query: `?plek=${encodeURIComponent(str.name)}${byName.get(locationKey(str.name)).length > 1 ? `%20${str.postcode}` : ""}` });
    const bundel = page.locator(".pv-results .pv-row.pv-bundel", { hasText: /vermoedelijke studentenactiviteit/ }).first();
    await bundel.waitFor({ timeout: 30000 });
    assert.match(await bundel.innerText(), /Ingeklapt/);
    assert.match(await bundel.innerText(), /publiceert de stad niet/, "de reden staat één keer in de regel");
    assert.equal(await bundel.locator(".pv-bundel-leden .pv-row").count(), 0, "dicht: de kaarten staan er nog niet");
    await bundel.locator(".pv-row-btn").first().click();
    await bundel.locator(".pv-bundel-leden").getByText(ev.title, { exact: false }).first().waitFor({ timeout: 10000 });
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test("deellink ?plek= opent dezelfde plek; kalender toont de werkperiode als balk", async () => {
    const { page, context, errors } = await openPage(baseUrl, { width: 1280, height: 900, street, query: `?plek=${encodeURIComponent(street.name)}${byName.get(locationKey(street.name)).length > 1 ? `%20${street.postcode}` : ""}&weergave=maand` });
    await page.locator(".pv-cal").waitFor();
    const start = addDays(today, 9), end = addDays(today, 30);
    // Naar de maand van de start van het werk.
    for (let i = 0; i < 3 && !(await page.locator(`[data-day="${start}"]:not(.out)`).count()); i += 1) await page.click(".pv-nav-next");
    const bar = page.locator(".pv-bar.multi.cat-works").first();
    await bar.waitFor({ timeout: 15000 });
    const spans = await page.locator(".pv-bar.multi.cat-works").evaluateAll((els) => els.map((el) => Number((el.style.gridColumn.match(/span (\d+)/) || [])[1] || 1)));
    // Elke week waarin het werk loopt krijgt een balk; samen dekken ze precies de dagen van het werk die in dit
    // maandrooster staan (ook de grijze dagen van de volgende maand). Vroeger ">= 7": dat hing af van de weekdag
    // waarop het werk start, en faalde als de rest van het rooster korter was dan een week.
    const zichtbaar = await page.locator("[data-day]").evaluateAll((els, [van, tot]) => els.filter((el) => el.dataset.day >= van && el.dataset.day <= tot).length, [start, end]);
    assert.ok(zichtbaar > 0, "het werk valt in dit rooster");
    assert.equal(spans.reduce((a, b) => a + b, 0), zichtbaar, `balken: ${spans}, dagen van het werk in het rooster: ${zichtbaar}`);
    assert.match(await bar.getAttribute("title"), new RegExp(`${Number(start.slice(8))} .* → ${Number(end.slice(8))} `));
    await page.click(`[data-day="${start}"]`);
    await page.locator(`.pv-cal-daypanel ${WORK_ROW}`).waitFor();
    // Tijdlijn van 14 dagen (vervangt de weekweergave): het werk start over 9 dagen. Tik op die dag en
    // het staat erin; tik op vandaag en het staat er niet; nog eens tikken toont weer alle 14 dagen.
    await page.click('[data-mode="tijdlijn"]');
    assert.equal(await page.locator(".pv-tl-dag").count(), 14);
    await page.locator(`.pv-results ${WORK_ROW}`).waitFor();
    assert.ok(await page.locator(`[data-tl-dag="${start}"] .pv-tl-stippen i.cat-works`).count(), "een stip voor het werk op zijn startdag");
    await page.click(`[data-tl-dag="${start}"]`);
    assert.equal(await page.locator(`[data-tl-dag="${start}"]`).getAttribute("aria-pressed"), "true");
    await page.locator(`.pv-results ${WORK_ROW}`).waitFor();
    await page.click(`[data-tl-dag="${today}"]`);
    assert.equal(await page.locator(`.pv-results ${WORK_ROW}`).count(), 0, "op vandaag loopt het werk nog niet");
    await page.click(`[data-tl-dag="${today}"]`);
    await page.locator(`.pv-results ${WORK_ROW}`).waitFor();
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test("werk: de algemene kaart van Hinder in Kaart en één bronvermelding met de datasetfiche, nooit een link naar het ruwe GIPOD-record", async () => {
    const plek = `${encodeURIComponent(street.name)}${byName.get(locationKey(street.name)).length > 1 ? `%20${street.postcode}` : ""}`;
    const { page, context, errors } = await openPage(baseUrl, { street, query: `?plek=${plek}` });
    const row = page.locator(`.pv-results ${WORK_ROW}`).first();
    await row.waitFor({ timeout: 15000 });
    await row.locator(".pv-row-btn").click();
    // Het werk in de proef heeft een Uri en (verzonnen) contactgegevens, zoals een ruw GIPOD-record (site/gipod-bron.js).
    const hrefs = await row.locator(".pv-detail a").evaluateAll((els) => els.map((a) => a.href));
    // Ook niet via Hinder in Kaart met gipodid: dat opent het detailpaneel van het record, met de contactgegevens.
    assert.equal(hrefs.some((h) => /gipod\.api\.vlaanderen\.be|geo\.api\.vlaanderen\.be\/GIPOD|gipodid=/i.test(h)), false, hrefs.join(" "));
    assert.ok(hrefs.includes("https://www.geopunt.be/?app=hinder-in-kaart"), hrefs.join(" "));
    assert.equal(hrefs.filter((h) => h === GIPOD_METADATA_URL).length, 1, hrefs.join(" "));
    assert.equal((await row.locator(`.pv-detail a[href="${GIPOD_METADATA_URL}"]`).innerText()).replace(/\s*↗$/, ""), GIPOD_BRON);
    // Geen "Technische details" meer bij een werk: daar stond de filterlink naar het ruwe record.
    assert.equal(await row.locator(".pv-tech").count(), 0, "geen technische details bij een werk");
    assert.doesNotMatch(await row.innerHTML(), /Voorbeeld Persoon|example\.org|INNAME_PUNT|GipodId/);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test("vergunning: de titel zegt wat er gebeurt, één statusregel, geen vrije tekst", async () => {
    const plek = `${encodeURIComponent(street.name)}${byName.get(locationKey(street.name)).length > 1 ? `%20${street.postcode}` : ""}`;
    const { page, context, errors } = await openPage(baseUrl, { street, query: `?plek=${plek}&soort=vergunningen` });
    const row = page.locator("section.pv-day", { hasText: "Omgevingsaanvragen en besluiten" }).locator(".pv-row").first();
    await row.waitFor({ timeout: 15000 });
    assert.equal(await row.locator(".pv-row-title").innerText(), PERMIT_TITLE);
    await row.locator(".pv-row-btn").click();
    const tekst = await row.innerText();
    assert.equal(tekst.match(/volledig en ontvankelijk verklaard/g)?.length, 1, tekst);
    // Op een gsm staan de labels in hoofdletters boven de waarde (#149): innerText geeft "WIE BESLIST".
    assert.match(tekst, /Wie beslist/i);
    assert.doesNotMatch(tekst, /Procedurestatus|doel niet|Voorbeeld|0470|20990001 · College/);
    const technisch = await row.locator("a.pv-bron-technisch").getAttribute("href");
    assert.equal(new URL(technisch).searchParams.get("where"), "Dossiernummer='20990001'");
    // Niet nagekeken in het Inzageloket: geen knop naar de startpagina, wel een eerlijke zin.
    assert.equal(await row.locator('a[href^="https://omgevingsloketinzage."]').count(), 0);
    assert.ok(tekst.includes(GEEN_INZAGE), tekst);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test("openbaar onderzoek: bovenaan de lijst, de termijn in de dichte kaart en een rechtstreekse link", async () => {
    const plek = `${encodeURIComponent(street.name)}${byName.get(locationKey(street.name)).length > 1 ? `%20${street.postcode}` : ""}`;
    const tot = addDays(today, 10);
    const inzage = inzageStand({ openbaarOnderzoek: { van: addDays(today, -19), totEnMet: tot }, nagekeken: addDays(today, -1) });
    const { page, context, errors } = await openPage(baseUrl, { street, inzage, query: `?plek=${plek}` });
    const sectie = page.locator("section.pv-day", { hasText: "Openbaar onderzoek: bezwaar indienen kan nu" });
    await sectie.waitFor({ timeout: 15000 });
    // De eerste sectie van de lijst, vóór "Nu bezig" en de dagen.
    assert.equal(await page.locator(".pv-results section.pv-day").first().getAttribute("aria-label"), "Openbaar onderzoek: bezwaar indienen kan nu");
    const row = sectie.locator(".pv-row").first();
    assert.equal(await row.locator(".pv-row-title").innerText(), PERMIT_TITLE);
    // Zichtbaar zonder openklappen.
    assert.equal(await row.locator(".pv-row-alert").innerText(), `Openbaar onderzoek loopt tot en met ${dagTekst(tot)}. Bezwaar indienen kan tot dan.`);
    assert.ok(await row.locator(".pv-row-alert").isVisible());
    assert.match(await row.locator(".pv-row-kind").innerText(), /Openbaar onderzoek/);
    await row.locator(".pv-row-btn").click();
    assert.equal(await row.locator(`a[href="${LOKET_LINK}"]`).count(), 1);
    assert.equal(await row.locator('a[href="https://omgevingsloketinzage.omgeving.vlaanderen.be/"]').count(), 0);
    assert.ok((await row.locator('a[href="https://www.vlaanderen.be/omgevingsvergunning/inzageloket"]').innerText()).startsWith(BEZWAAR_LABEL));
    assert.doesNotMatch(await row.innerText(), /kon niet nagaan/);
    // Niet dubbel: de aanvraag staat niet nog eens onderaan bij de gewone aanvragen.
    assert.equal(await page.locator(".pv-row", { hasText: PERMIT_TITLE }).count(), 1);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test("openbaar onderzoek dat niet vandaag loopt, of zonder einddatum: niet bovenaan, wel de melding in de dichte kaart", async () => {
    const plek = `${encodeURIComponent(street.name)}${byName.get(locationKey(street.name)).length > 1 ? `%20${street.postcode}` : ""}`;
    const van = addDays(today, 5), tot = addDays(today, 34);
    const gevallen = [
      // De termijn begint later (nagekeken moet binnen de termijn liggen).
      [inzageStand({ openbaarOnderzoek: { van, totEnMet: tot }, nagekeken: van }), `Openbaar onderzoek van ${dagTekst(van)} tot en met ${dagTekst(tot)}. Bezwaar indienen kan in die periode.`],
      // Gevonden in openbaar onderzoek, zonder afgelezen datums: alleen de dag waarop het liep.
      [inzageStand({ nagekeken: addDays(today, -1) }), `Op ${dagTekst(addDays(today, -1))} liep er een openbaar onderzoek, volgens het Inzageloket. Tot wanneer je bezwaar kunt indienen, staat in het loket bij "Toestand".`],
    ];
    for (const [inzage, melding] of gevallen) {
      const { page, context, errors } = await openPage(baseUrl, { street, inzage, query: `?plek=${plek}` });
      const sectie = page.locator("section.pv-day", { hasText: "Omgevingsaanvragen en besluiten" });
      await sectie.locator(".pv-row").first().waitFor({ timeout: 15000 });
      assert.equal(await page.locator('section.pv-day[aria-label="Openbaar onderzoek: bezwaar indienen kan nu"]').count(), 0, melding);
      const row = sectie.locator(".pv-row", { hasText: PERMIT_TITLE }).first();
      assert.equal(await row.locator(".pv-row-alert").innerText(), melding);
      assert.ok(await row.locator(".pv-row-alert").isVisible());
      assert.doesNotMatch(await row.locator(".pv-row-kind").innerText(), /Openbaar onderzoek/, "geen badge");
      await row.locator(".pv-row-btn").click();
      assert.equal(await row.locator(`a[href="${LOKET_LINK}"]`).count(), 1);
      assert.doesNotMatch(await row.innerText(), /kon niet nagaan/);
      assert.deepEqual(errors, []);
      await context.close();
    }
  });

  await t.test("lijst met alle omgevingsdossiers: melding, rechtstreekse link en eerlijke zin in een opengeklapte kaart", async () => {
    const tot = addDays(today, 10);
    for (const inzage of [inzageStand({ openbaarOnderzoek: { van: addDays(today, -19), totEnMet: tot }, nagekeken: addDays(today, -1) }), null]) {
      // De lijst toont alleen dossiers als de soort "vergunningen" aan staat.
      const { page, context, errors } = await openPage(baseUrl, { street, inzage, query: "?soort=vergunningen" });
      await page.click(".pv-more > summary");
      const kaart = page.locator("#permits-live .permit-card", { hasText: PERMIT_TITLE }).first();
      await kaart.waitFor({ timeout: 15000 });
      // Openklappen zoals een bewoner: één klik, tot de technische link onderaan de open kaart zichtbaar is.
      // Terwijl de andere lagen nog laden, kan de lijst opnieuw tekenen; de kaart moet dan open blijven.
      const onderaan = kaart.locator("details > summary", { hasText: "Technische stadsbron" });
      await kaart.locator("summary").first().click();
      await onderaan.waitFor({ state: "visible", timeout: 5000 });
      assert.ok(await onderaan.isVisible(), "de kaart klapt open");
      // Tekent de lijst opnieuw (zoals wanneer de wijk klaar is met laden), dan blijft de kaart open.
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("public-agenda:view-change")));
      assert.equal(await kaart.evaluate((el) => el.open), true, "de kaart blijft open als de lijst opnieuw tekent");
      assert.ok(await onderaan.isVisible());
      const tekst = await kaart.innerText();
      assert.equal(await kaart.locator('a[href="https://omgevingsloketinzage.omgeving.vlaanderen.be/"]').count(), 0, "nooit de startpagina van het loket");
      if (inzage) {
        // Eerst in de lijst, de termijn in de dichte kaart, de link naar het dossier zelf.
        assert.equal(await page.locator("#permits-live .permit-card").first().locator(".permit-alert").innerText(), `Openbaar onderzoek loopt tot en met ${dagTekst(tot)}. Bezwaar indienen kan tot dan.`);
        assert.equal(await kaart.locator(`a[href="${LOKET_LINK}"]`).innerText(), "Bekijk dit dossier en de plannen in het Inzageloket");
        assert.equal(await kaart.locator('a[href="https://www.vlaanderen.be/omgevingsvergunning/inzageloket"]').innerText(), BEZWAAR_LABEL);
        assert.doesNotMatch(tekst, /kon niet nagaan/);
      } else {
        assert.equal(await kaart.locator('a[href^="https://omgevingsloketinzage."]').count(), 0);
        assert.ok(tekst.includes(GEEN_INZAGE), tekst);
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
  });

  await t.test("wijk en postcode, lege staat met uitleg, toetsenbord", async () => {
    const { page, context } = await openPage(baseUrl, { street });
    const input = page.locator("#agenda-street-jump");
    await input.focus();
    await page.keyboard.type("zurenb");
    // De straten van heel de stad komen pas bij het typen binnen en zetten de Zurenborgbrug (Berchem, buiten deze agenda)
    // tussen de wijk en de Zurenborgstraat. Kwamen ze tussen de twee pijltjes, dan koos ArrowUp de brug (de lijst houdt de
    // gekozen suggestie vast, die schoof een plaats op). Een bewoner ziet de lijst; de toets wacht er dus op.
    await page.locator("#pv-suggestions .pv-sugg-buiten").first().waitFor();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowUp");
    assert.equal(await page.locator('#pv-suggestions [aria-selected="true"]').evaluate((el) => `${el.className}|${el.querySelector("strong").textContent}`), "pv-sugg pv-sugg-wijk|Zurenborg", "ArrowDown en ArrowUp: terug op de wijk");
    await page.keyboard.press("Enter");
    assert.equal(await page.locator(".pv-place-name").innerText(), "Zurenborg");
    assert.match(page.url(), /plek=Zurenborg/);
    await page.click(".pv-close");
    await input.fill("Berchem");
    await page.locator(".pv-sugg-note").getByText("ander district").waitFor();
    await input.fill("Schrijfstraat 105");
    await page.locator("#pv-suggestions").getByText("Bedoelde je").waitFor();
    await input.fill("2060");
    await input.press("Enter");
    assert.match(await page.locator(".pv-place-kind").innerText(), /postcode/i);
    // Alles uit → lege staat met concrete tips.
    await page.click('[data-group="*"]');
    await page.locator(".pv-empty").waitFor();
    assert.ok(await page.locator(".pv-empty-tips button").count() >= 1);
    await context.close();
  });

  // Bouwplan stap 3, zoeken in heel de stad: de 15 zoekopdrachten die in de stratentest van 12 oktober 2026 mislukten
  // ("Geen straat gevonden… probeer Zuid of Kiel", Enter opende de Walenstraat of de Gasstraat, de Statiestraat van
  // Berchem opende die van 2018). Nu: één straat opent de uitleg "ligt in district X, deze agenda volgt district
  // Antwerpen" met wat de site daar kent; naamgenoten zijn een keuze; Enter opent nooit een gok.
  const STRATENTEST = [
    ["De Villegasstraat", "Berchem", ["2600"]], ["Walemstraat", "Berchem", ["2600"]], ["Turnhoutsebaan", "Borgerhout", ["2100", "2140"]],
    ["Vosstraat", "Borgerhout", ["2100", "2140", "2600"]], ["Generaal De Wetstraat", "Borgerhout", ["2140"]], ["Herentalsebaan", "Deurne", ["2100", "2140", "2150"]],
    ["Arenaplein", "Deurne", ["2100"]], ["Bist", "Wilrijk", ["2180", "2610"]], ["Boomsesteenweg", "Wilrijk", ["2020", "2610"]],
    ["Kioskplaats", "Hoboken", ["2660"]], ["Sint-Bernardsesteenweg", "Hoboken", ["2020", "2660"]], ["Statiestraat", "Berchem", ["2018", "2180", "2600"]],
    ["Bredabaan", "Merksem", ["2170"]], ["Kristus-Koningplein", "Ekeren", ["2180"]], ["Botermarkt", "Berendrecht-Zandvliet-Lillo", ["2040"]],
  ];
  // Een verzonnen markt en een verzonnen activiteit uit het districtsnieuws van Hoboken (vaste basis, geen echte items).
  const HOBOKEN = (stempel) => [
    marktItem(stempel, { id: "e2e-markt-kiosk", externalId: "e2e-1", title: "Proefmarkt Kioskplaats", date: addDays(today, 3), location: "Kioskplaats, 2660 Hoboken", postcodes: ["2660"], inDistrict: false }),
    kalenderItem(stempel, { id: "stad-news-hoboken-e2e1-x", title: "VOLZET - Proeflezing in de bib", date: addDays(today, 4), timeSlot: "19:30", timeText: "19.30 uur", location: "District Hoboken, locatie via de officiële bron", postcodes: ["2660"], sourceId: "stad-districten", scope: "stad", inDistrict: false, link: "https://www.antwerpen.be/info/e2e1/proeflezing", sourceUrl: "https://www.antwerpen.be/info/e2e1/proeflezing", sources: [{ sourceId: "stad-districten", url: "https://www.antwerpen.be/info/e2e1/proeflezing", retrievedAt: stempel, scope: "stad" }] }),
  ];
  await t.test("zoeken in heel de stad: de 15 straten uit de stratentest, naamgenoten als keuze, Enter gokt nooit", async () => {
    const { page, context, errors } = await openPage(baseUrl, { feed: proefFeed(today, HOBOKEN) });
    const input = page.locator("#agenda-street-jump");
    const buiten = page.locator(".pv-buiten");
    for (const [naam, district, postcodes] of STRATENTEST) {
      const vorige = new URL(page.url()).searchParams.get("plek");
      await input.fill(naam);
      // Alle naamgenoten staan in de suggesties, met hun postcode (en hun district als het een ander is).
      await page.waitForFunction(([n, pcs]) => {
        const opties = [...document.querySelectorAll("#pv-suggestions [role=option]")].filter((o) => o.querySelector("strong")?.textContent === n);
        return pcs.every((pc) => opties.some((o) => o.textContent.includes(` ${pc}`)));
      }, [naam, postcodes], { timeout: 10000 }).catch(async () => assert.fail(`${naam}: ${await page.locator("#pv-suggestions").innerText()}`));
      await input.press("Enter");
      const pc = postcodes.length === 1 ? postcodes[0] : null;
      if (pc) {
        await buiten.waitFor({ state: "visible", timeout: 5000 });
      } else {
        // Naamgenoten: Enter opent niets en zegt waarom; dan kiest de bewoner zelf (hier: tikken op het district).
        await page.locator("#pv-suggestions .pv-sugg-note", { hasText: `${postcodes.length} plekken heten` }).waitFor({ timeout: 5000 });
        assert.equal(new URL(page.url()).searchParams.get("plek"), vorige, `${naam}: Enter opende toch iets`);
        await page.locator("#pv-suggestions [role=option]", { hasText: `district ${district}` }).filter({ has: page.locator("strong", { hasText: new RegExp(`^${naam}$`) }) }).first().click();
        await buiten.waitFor({ state: "visible", timeout: 5000 });
      }
      const tekst = await buiten.innerText();
      assert.match(tekst, new RegExp(`${naam} \\(\\d{4}\\) ligt in district ${district}, deze agenda volgt district Antwerpen\\.`), naam);
      assert.match(tekst, new RegExp(`Wat deze site wel kent in ${district}`));
      assert.match(tekst, /Straatnaam en district: Stad Antwerpen, wegenregister/);
      const plek = new URL(page.url()).searchParams.get("plek");
      assert.match(plek, new RegExp(`^${naam} \\d{4}$`), `${naam}: de link noemt de straat en haar postcode`);
      assert.equal(await page.locator(".pv-layout").isVisible(), false, `${naam}: de lijst van district Antwerpen staat er niet onder`);
      assert.doesNotMatch(tekst, /Walenstraat|Gasstraat/);
    }
    // Hoboken: de verzonnen markt in deze straat bovenaan, en de activiteit uit het districtsnieuws met "volzet".
    await input.fill("Kioskplaats");
    await page.locator("#pv-suggestions [role=option]").first().waitFor();
    await input.press("Enter");
    await page.locator(".pv-buiten", { hasText: "Proefmarkt Kioskplaats" }).waitFor({ timeout: 5000 });
    const markt = page.locator(".pv-buiten li", { hasText: "Proefmarkt Kioskplaats" });
    assert.match(await markt.innerText(), /in deze straat/);
    // De bron van een markt is de datasetfiche van GIPOD met de bronvermelding, nooit het ruwe record (site/gipod-bron.js).
    assert.equal(await markt.locator("a").getAttribute("href"), GIPOD_METADATA_URL);
    assert.match(await markt.locator("a").innerText(), /^Bron: GIPOD/);
    const lezing = page.locator(".pv-buiten li", { hasText: "Proeflezing in de bib" });
    assert.match(await lezing.innerText(), /volzet/);
    assert.match(await lezing.innerText(), /19\.30 uur/);
    assert.doesNotMatch(await lezing.innerText(), /VOLZET -|locatie via de officiële bron/);
    assert.equal(await lezing.locator("a").getAttribute("href"), "https://www.antwerpen.be/info/e2e1/proeflezing");
    assert.equal(await page.locator('.pv-buiten a[href="https://www.antwerpen.be/nl/overzicht/district-hoboken-1"]').count(), 1);
    // Een tikfout: "Bedoelde je…", en Enter opent niets (geen gok).
    await input.fill("Schrijfstraat 105");
    await page.locator("#pv-suggestions").getByText("Bedoelde je").waitFor();
    await input.press("Enter");
    await page.locator("#pv-suggestions .pv-sugg-note", { hasText: "Enter opent geen gok" }).waitFor({ timeout: 5000 });
    assert.match(await page.locator("#pv-search-help").innerText(), /Enter opent geen gok/);
    assert.equal(new URL(page.url()).searchParams.get("plek"), "Kioskplaats 2660", "de vorige plek bleef staan");
    // Met de pijltjes kiezen mag wel: dan is het de keuze van de bewoner.
    await input.press("ArrowDown");
    await input.press("ArrowUp");
    await input.press("Enter");
    await page.waitForFunction(() => new URL(location.href).searchParams.get("plek") === "Schijfstraat", null, { timeout: 5000 });
    assert.equal(await page.locator(".pv-place-name").innerText(), "Schijfstraat");
    // Statiestraat met het toetsenbord: Enter laat kiezen, ↓ en Enter opent de tweede (Ekeren); van daar naar de
    // Statiestraat van district Antwerpen, met dezelfde naam.
    await input.fill("Statiestraat");
    await page.locator("#pv-suggestions [role=option]").nth(2).waitFor();
    await input.press("Enter");
    await page.locator("#pv-suggestions .pv-sugg-note", { hasText: "3 plekken heten" }).waitFor({ timeout: 5000 });
    await input.press("ArrowDown");
    await input.press("Enter");
    await page.waitForFunction(() => new URL(location.href).searchParams.get("plek") === "Statiestraat 2180", null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => document.activeElement?.id), "pv-buiten-naam", "de focus springt naar de naam");
    await page.locator(".pv-buiten [data-place]", { hasText: "Statiestraat (2018" }).click();
    await page.waitForFunction(() => new URL(location.href).searchParams.get("plek") === "Statiestraat", null, { timeout: 5000 });
    assert.equal(await page.locator(".pv-place-name").innerText(), "Statiestraat");
    assert.equal(await buiten.isVisible(), false);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test("deellink buiten district Antwerpen: ?plek=Bist 2610 opent de uitleg, ?plek=Bist laat kiezen, 'Andere plek' sluit", async () => {
    const { page, context, errors } = await openPage(baseUrl, { query: `?plek=${encodeURIComponent("Bist 2610")}` });
    const buiten = page.locator(".pv-buiten");
    await buiten.waitFor({ state: "visible", timeout: 10000 });
    assert.equal(await page.locator("#pv-buiten-naam").innerText(), "Bist");
    assert.match(await buiten.innerText(), /Bist \(2610\) ligt in district Wilrijk, deze agenda volgt district Antwerpen\./);
    assert.match(await buiten.innerText(), /Ook in een ander district: Bist \(2180, district Ekeren\)/);
    await page.locator(".pv-buiten-sluit").click();
    assert.equal(await buiten.isVisible(), false);
    assert.equal(await page.locator(".pv-layout").isVisible(), true);
    assert.equal(new URL(page.url()).searchParams.get("plek"), null);
    assert.equal(await page.evaluate(() => document.activeElement?.id), "agenda-street-jump");
    await page.goto(`${baseUrl}/?plek=Bist`);
    await page.locator("#pv-suggestions .pv-sugg-note", { hasText: "2 plekken heten" }).waitFor({ timeout: 10000 });
    assert.equal(await buiten.isVisible(), false);
    await page.goto(`${baseUrl}/?plek=${encodeURIComponent("district:Berchem")}`);
    await buiten.waitFor({ state: "visible", timeout: 10000 });
    assert.match(await buiten.innerText(), /Berchem is een ander district, deze agenda volgt district Antwerpen\./);
    assert.deepEqual(errors, []);
    await context.close();
  });

  // Nakijkronde van 12 oktober 2026: (1) een tikfout die midden in een straat van een ander district zit, opende die
  // straat; (2) "Maria-Theresialei" opende die van Ekeren (straten.json noemt die van 2018 "Maria-Theresialei_AN");
  // (3) een straatnaam met een cijfer vond haar eigen deellink niet terug.
  await t.test("nakijkronde: tikfout geen gok, Maria-Theresialei een keuze, straatnaam met cijfer in de link", async () => {
    const { page, context, errors } = await openPage(baseUrl);
    const input = page.locator("#agenda-street-jump");
    const buiten = page.locator(".pv-buiten");
    const opties = () => page.locator("#pv-suggestions [role=option]").evaluateAll((os) => os.map((o) => `${o.querySelector("strong")?.textContent} · ${o.querySelector("small")?.textContent}`));
    // (1) "Stenplein": het Steenplein vooraan, het Kunstenplein (Berchem) erna; Enter opent geen van beide.
    await input.fill("Stenplein");
    await page.locator("#pv-suggestions [role=option]", { hasText: "Kunstenplein" }).waitFor({ timeout: 10000 });
    await page.locator("#pv-suggestions").getByText("Bedoelde je").waitFor();
    assert.match((await opties())[0], /^Steenplein · straat · 2000/, (await opties()).join(" | "));
    await input.press("Enter");
    await page.locator("#pv-suggestions .pv-sugg-note", { hasText: "Enter opent geen gok" }).waitFor({ timeout: 5000 });
    assert.equal(new URL(page.url()).searchParams.get("plek"), null, "Enter opende toch iets");
    assert.equal(await buiten.isVisible(), false);
    // (2) Maria-Theresialei: twee naamgenoten, die van district Antwerpen eerst, nergens "_AN".
    await input.fill("Maria-Theresialei");
    await page.locator("#pv-suggestions [role=option]", { hasText: "Ekeren" }).waitFor({ timeout: 10000 });
    await input.press("Enter");
    await page.locator("#pv-suggestions .pv-sugg-note", { hasText: "2 plekken heten" }).waitFor({ timeout: 5000 });
    const mt = await opties();
    assert.match(mt[0], /^Maria-Theresialei · straat · 2018 .*· district Antwerpen$/, mt.join(" | "));
    assert.ok(!mt.some((o) => /_AN/.test(o)), mt.join(" | "));
    await page.locator("#pv-suggestions [role=option]", { hasText: "district Ekeren" }).click();
    await buiten.waitFor({ state: "visible", timeout: 5000 });
    assert.match(await buiten.innerText(), /Maria-Theresialei \(2180\) ligt in district Ekeren/);
    assert.match(await buiten.innerText(), /Met dezelfde naam in district Antwerpen: Maria-Theresialei \(2018/);
    await page.locator(".pv-buiten [data-place]", { hasText: "Maria-Theresialei (2018" }).click();
    await page.waitForFunction(() => new URL(location.href).searchParams.get("plek") === "Maria-Theresialei", null, { timeout: 5000 });
    assert.equal(await page.locator(".pv-place-name").innerText(), "Maria-Theresialei");
    // (3) De deellink van een straat met een cijfer opent haar uitleg (buiten) of haar overzicht (district Antwerpen).
    await page.goto(`${baseUrl}/?plek=${encodeURIComponent("Fort 7-straat 2610")}`);
    await buiten.waitFor({ state: "visible", timeout: 10000 });
    assert.match(await buiten.innerText(), /Fort 7-straat \(2610\) ligt in district Wilrijk, deze agenda volgt district Antwerpen\./);
    assert.equal(new URL(page.url()).searchParams.get("plek"), "Fort 7-straat 2610");
    await page.goto(`${baseUrl}/?plek=${encodeURIComponent("De 7 schakenpad")}`);
    await page.locator(".pv-place-name", { hasText: "De 7 schakenpad" }).waitFor({ timeout: 10000 });
    assert.doesNotMatch(await page.locator("#pv-search-help").innerText(), /heet precies|geen straat/i);
    await page.click(".pv-close");
    await input.fill("Pad nr. 25");
    await page.locator("#pv-suggestions [role=option]", { hasText: "Borsbeek" }).waitFor({ timeout: 10000 });
    await input.press("Enter");
    await page.waitForFunction(() => new URL(location.href).searchParams.get("plek") === "Pad nr. 25 2150", null, { timeout: 5000 });
    assert.match(await buiten.innerText(), /Pad nr\. 25 \(2150\) ligt in district Borsbeek/);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test("evenement op straat: telt als evenement, alleen 'Evenementen' toont het, kaart begint met wat en wanneer", async () => {
    const plek = `${street.name}${byName.get(locationKey(street.name)).length > 1 ? ` ${street.postcode}` : ""}`;
    const { page, context, errors } = await openPage(baseUrl, { street, evenement: { dossier: "ET2099000077", dag: addDays(today, 5) }, query: `?plek=${encodeURIComponent(plek)}&soort=evenementen&periode=alles` });
    const row = page.locator(".pv-row", { hasText: "Evenement op straat" }).first();
    await row.waitFor({ timeout: 20000 });
    // Zonder naam of soort: wat er vaststaat (een parcours, door welke straat), nooit alleen "de stad
    // maakt niet bekend wat het is" (klacht 10-10-2026).
    assert.match(await row.innerText(), /Parcours door /);
    assert.doesNotMatch(await row.innerText(), /Evenement met toelating van de stad|maakt niet bekend wat het is/);
    // Chips en tegels tellen kaarten: het dossier is één evenement; de vijfde tegel is vergunningen.
    await page.waitForFunction(() => document.querySelector('[data-group="evenementen"] .pv-chip-n'));
    const chip = Number(await page.locator('[data-group="evenementen"] .pv-chip-n').innerText());
    assert.equal(chip, await page.locator(".pv-results .pv-row").count());
    assert.equal(await page.locator(".pv-stats .pv-stat").count(), 5);
    assert.match(await page.locator(".pv-stats").innerText(), /vergunning/);
    await row.locator(".pv-row-btn").click();
    const labels = await row.locator(".pv-kern dt").evaluateAll((els) => els.map((el) => el.textContent));
    assert.deepEqual(labels.slice(0, 3), ["Wat", "Wanneer", "Waar"]);
    assert.ok(labels.includes("Jouw straat") && labels.includes("Wat merk je"));
    assert.doesNotMatch(await row.locator(".pv-detail").innerText(), /ETL|IOD|Niet in de bron/);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test("een dossier van een maand: wat het is, geen 'Vandaag' en geen 'Dag N van M', in de groep Doorlopend", async () => {
    const plek = `${street.name}${byName.get(locationKey(street.name)).length > 1 ? ` ${street.postcode}` : ""}`;
    const { page, context, errors } = await openPage(baseUrl, { street, evenement: { dossier: "ET2099000079", dag: addDays(today, -9), tot: addDays(today, 19), type: "Inname", beschrijving: "Reuzenrad" }, query: `?plek=${encodeURIComponent(plek)}&soort=evenementen&periode=alles` });
    const row = page.locator(".pv-row", { hasText: "Reuzenrad" }).first();
    await row.waitFor({ timeout: 20000 });
    const kop = await row.locator(".pv-row-btn").innerText();
    assert.doesNotMatch(kop, /Vandaag|Evenement met toelating|maakt niet bekend wat het is|Vermoedelijk/);
    assert.match(kop, /Loopt tot /);
    assert.match(kop, /Zo staat het in het dossier/);
    const sectie = page.locator(".pv-day", { has: row });
    assert.match(await sectie.locator(".pv-day-title").innerText(), /Doorlopend/);
    await row.locator(".pv-row-btn").click();
    assert.doesNotMatch(await row.locator(".pv-detail").innerText(), /Dag \d+ van \d+/);
    assert.match(await row.locator(".pv-detail").innerText(), /Loopt sinds /);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test("evenement op straat tijdens de afbraak: de kaart blijft staan, met 'Afbraak bezig'", async () => {
    const plek = `${street.name}${byName.get(locationKey(street.name)).length > 1 ? ` ${street.postcode}` : ""}`;
    // Het evenement was gisteren; het parkeerverbod van de afbraak loopt tot morgen.
    const { page, context, errors } = await openPage(baseUrl, { street, evenement: { dossier: "ET2099000078", dag: addDays(today, -1), afbraakTot: addDays(today, 1) }, query: `?plek=${encodeURIComponent(plek)}&soort=evenementen` });
    const row = page.locator(".pv-row", { hasText: "Evenement op straat" }).first();
    await row.waitFor({ timeout: 20000 });
    assert.match(await row.locator(".pv-row-btn").innerText(), /Afbraak bezig/);
    // In de sectie "Nu bezig", met het einde van de afbraak.
    const sectie = page.locator(".pv-day", { has: row });
    assert.match(await sectie.locator(".pv-day-title").innerText(), /Nu bezig/);
    assert.match(await row.locator(".pv-row-when").innerText(), /^t\/m /);
    await row.locator(".pv-row-btn").click();
    assert.match(await row.locator(".pv-kern").innerText(), /Jouw straat krijgt een parkeerverbod van /);
    assert.deepEqual(errors, []);
    await context.close();
  });

  // Vaagheidsplan van 12 oktober 2026, stap 2: één kaart per dossiernummer, een aanvraag die nog niet goedgekeurd
  // is met een label en zonder .ics, en een agendapunt uit de dossiers in al zijn straten.
  await t.test("stap 2: één kaart per dossier, een aanvraag met label en zonder .ics, een agendapunt in al zijn straten", async () => {
    const plek = `${street.name}${byName.get(locationKey(street.name)).length > 1 ? ` ${street.postcode}` : ""}`;
    const ASIGN_URL = "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/22";
    const ander = straten.streets.map((r) => r[1]).filter((n) => n !== street.name && !n.includes(street.name) && !street.name.includes(n)).slice(0, 3);
    const uitDossier = (dossier, dag, eigen = {}) => ({
      id: `asign-ev-${dossier.toLowerCase()}-${dag}`, externalId: dossier, date: dag, dateLabel: dagTekst(dag), timeSlot: "Info", location: street.name,
      info: `Evenementendossier ${dossier} van de stad (A-Sign): aanvraag goedgekeurd.`, sourceId: "district-asign-evenementen", sourceUrl: ASIGN_URL, link: ASIGN_URL,
      sources: [{ sourceId: "district-asign-evenementen", url: ASIGN_URL, retrievedAt: `${today}T05:00:00.000Z`, scope: "district" }], ...eigen,
    });
    const dag = addDays(today, 5);
    const agendaErbij = [
      // Hetzelfde dossier als de kaart van de live laag: geen tweede kaart.
      uitDossier("ET2099000081", dag, { title: "Proefstoet van het dossier (e2e)" }),
      // Een aanvraag die nog niet goedgekeurd is.
      uitDossier("ET2099000082", addDays(today, 6), { title: "Proefoptocht in aanvraag (e2e)", nietGoedgekeurd: true, info: "Evenementendossier ET2099000082 van de stad (A-Sign): aanvraag nog niet goedgekeurd." }),
      // Een agendapunt waarvan de locatietekst de gekozen straat niet noemt, maar zijn volledige stratenlijst wel.
      uitDossier("ET2099000083", addDays(today, 7), { title: "Proefronde door vijf straten (e2e)", location: `${ander.join(", ")} en 1 andere straten`, straten: [...ander, street.name], stratenVolledig: true }),
      // Nakijkronde #170: een lijst uit een ouder bronbestand (zonder stratenVolledig) telt niet; het punt houdt
      // zich aan zijn locatie.
      uitDossier("ET2099000086", addDays(today, 8), { title: "Proefronde van een oud bestand (e2e)", location: `${ander.join(", ")} en 1 andere straten`, straten: [...ander, street.name] }),
      // Nakijkronde #170: één evenement uit twee dossiers, één goedgekeurd; deze straat raakt alleen het dossier in
      // aanvraag: label en geen .ics op deze straat.
      uitDossier("ET2099000084", addDays(today, 9), { title: "Proeftocht deels in aanvraag (e2e)", location: `${ander.join(", ")} en 1 andere straten`, straten: [...ander, street.name], stratenVolledig: true, ookDossiers: ["ET2099000085"], nietGoedgekeurdStraten: [street.name] }),
    ];
    const { page, context, errors } = await openPage(baseUrl, { street, evenement: { dossier: "ET2099000081", dag }, agendaErbij, query: `?plek=${encodeURIComponent(plek)}&soort=evenementen&periode=alles` });
    const kaart = page.locator(".pv-row", { hasText: "Evenement op straat" }).first();
    await kaart.waitFor({ timeout: 20000 });
    await page.locator(".pv-results .pv-row", { hasText: "Proefronde door vijf straten (e2e)" }).waitFor({ timeout: 15000 });
    // b. Eén kaart: het agendapunt van ET2099000081 staat er niet naast; de kaart deelt het agendapunt.
    assert.equal(await page.locator(".pv-results .pv-row", { hasText: "Proefstoet van het dossier (e2e)" }).count(), 0);
    await kaart.locator(".pv-row-btn").click();
    assert.equal(await kaart.locator('a[href^="/event/asign-ev-et2099000081-"]').count(), 1, "de kaart deelt het agendapunt");
    // c. De aanvraag: een label in de rij, geen .ics.
    const aanvraag = page.locator(".pv-results .pv-row", { hasText: "Proefoptocht in aanvraag (e2e)" }).first();
    assert.match(await aanvraag.locator(".pv-row-kind").innerText(), /Aanvraag, nog niet goedgekeurd/);
    await aanvraag.locator(".pv-row-btn").click();
    assert.equal(await aanvraag.locator(".pv-ics").count(), 0, "geen .ics voor een aanvraag");
    // f. Het agendapunt met de lange stratenlijst staat bij de gekozen straat, en heeft wel een .ics.
    const ronde = page.locator(".pv-results .pv-row", { hasText: "Proefronde door vijf straten (e2e)" }).first();
    await ronde.locator(".pv-row-btn").click();
    assert.equal(await ronde.locator(".pv-ics").count(), 1);
    // Nakijkronde #170: de lijst van een oud bestand telt niet, en het label per straat.
    assert.equal(await page.locator(".pv-results .pv-row", { hasText: "Proefronde van een oud bestand (e2e)" }).count(), 0);
    const deels = page.locator(".pv-results .pv-row", { hasText: "Proeftocht deels in aanvraag (e2e)" }).first();
    assert.match(await deels.locator(".pv-row-kind").innerText(), /Aanvraag, nog niet goedgekeurd/);
    await deels.locator(".pv-row-btn").click();
    assert.equal(await deels.locator(".pv-ics").count(), 0, "geen .ics op een straat van de aanvraag");
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test("stap 2: Enter opent geen gok ('Bedoelde je…'), wel na een keuze met de pijltjes", async () => {
    const { page, context, errors } = await openPage(baseUrl, { street });
    const input = page.locator("#agenda-street-jump");
    await input.fill("Kammenstrat");
    await page.locator("#pv-suggestions").getByText("Bedoelde je").waitFor();
    await input.press("Enter");
    // Enter wacht eerst op de straten van heel de stad (deel B) en zegt dan waarom het niets opent.
    await page.locator("#pv-suggestions .pv-sugg-note", { hasText: "Enter opent geen gok" }).waitFor({ timeout: 5000 });
    assert.doesNotMatch(page.url(), /plek=/, "Enter opent de gok niet");
    assert.match(await page.locator("#pv-search-help").innerText(), /Enter opent geen gok/);
    await input.press("ArrowDown");
    await input.press("Enter");
    await page.waitForFunction(() => new URL(location.href).searchParams.has("plek"));
    assert.equal(await page.locator(".pv-place-name").innerText(), "Kammenstraat");
    assert.deepEqual(errors, []);
    await context.close();
  });

  // Nakijkbevinding (17 oktober 2026): Enter op de Meir met een huisnummer zei "2 plekken heten …": de wijk Theaterbuurt &
  // Meir (andere naam "Meir") en de straat Meir. Een huisnummer hoort bij een straat, nooit bij een wijk (enterKeuze).
  // Het huisnummer is verzonnen.
  await t.test("Enter op de Meir met een huisnummer ('meir 999') opent de straat Meir, niet de keuze met de wijk Theaterbuurt & Meir", async () => {
    const meir = byName.get(locationKey("Meir"));
    assert.equal(meir?.length, 1, "één straat Meir in district Antwerpen");
    const { page, context, errors } = await openPage(baseUrl, { street: meir[0] });
    const input = page.locator("#agenda-street-jump");
    await input.fill("meir 999");
    // De wijk staat in de suggesties, en eerst: Enter kiest dus niet gewoon de eerste.
    await page.locator("#pv-suggestions .pv-sugg-wijk", { hasText: "Theaterbuurt & Meir" }).waitFor();
    assert.equal(await page.locator("#pv-suggestions [role=option]").first().evaluate((el) => el.classList.contains("pv-sugg-wijk")), true);
    await input.press("Enter");
    await page.waitForFunction(() => new URL(location.href).searchParams.has("plek"), null, { timeout: 5000 })
      .catch(async () => assert.fail(`Enter opende niets: ${await page.locator("#pv-search-help").innerText()}`));
    assert.equal(new URL(page.url()).searchParams.get("plek"), "Meir");
    assert.equal(await page.locator(".pv-place-name").innerText(), "Meir");
    assert.match(await page.locator(".pv-place-kind").innerText(), /straat/i);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test("gsm (390 px): geen horizontale scroll in zoeken, plek, lijst, tijdlijn en maand", async () => {
    const { page, context } = await openPage(baseUrl, { street });
    const noScroll = async (label) => {
      const [scroll, width] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      assert.ok(scroll <= width, `${label}: ${scroll} > ${width}`);
    };
    await noScroll("start");
    await page.locator("#agenda-street-jump").fill(street.name);
    await noScroll("suggesties");
    await page.locator("#agenda-street-jump").press("Enter");
    await page.locator(`.pv-results ${WORK_ROW}`).first().waitFor({ timeout: 15000 });
    await noScroll("plek");
    await page.click('[data-mode="tijdlijn"]');
    await noScroll("tijdlijn");
    await page.click('[data-mode="maand"]');
    await noScroll("maand");
    await page.click(".pv-more > summary");
    await noScroll("meer");
    await context.close();
  });

  // P8: de voorpagina op de gsm opent met "Dit weekend". Nakijkbevinding: de toets hing af van de data (die van een
  // zondag paste, die van een werkdag niet). Nu met negen verzonnen uitstappen met lange titels en de klok op een
  // woensdag, een zaterdag en een zondag na de dag van de data: zes kaarten en de knop "Alles" boven 600 px.
  // Nakijkbevinding 35: echte items hebben vaak een lange plaats, die over twee regels liep (30 px meer); de
  // verzonnen uitstappen hebben er nu ook een, en er wordt ook op 360 px gemeten.
  const weekendKop = (page) => page.locator("#dit-weekend .dw-kop").textContent().then((tekst) => Number((tekst.match(/^(\d+) dingen te doen$/) || [])[1]));
  await t.test("voorpagina (390×844 en 360×780): 'Dit weekend' met zes kaarten en 'Alles' boven 600 px, op een woensdag, zaterdag en zondag, ook met een lange plaats; tikken klapt het item open", async () => {
    const gevallen = [
      ["woensdag", volgendeWeekdag(today, 3), /^Dit weekend · vr \d+ (\S+ )?– zo \d+ \S+$/, 390],
      ["zaterdag", volgendeWeekdag(today, 6), /^Dit weekend · za \d+ (\S+ )?– zo \d+ \S+$/, 390],
      ["zondag", volgendeWeekdag(today, 0), /^Dit weekend · zo \d+ \S+$/, 390],
      ["woensdag op 360 px", volgendeWeekdag(today, 3), /^Dit weekend · vr \d+ (\S+ )?– zo \d+ \S+$/, 360],
    ];
    for (const [naam, dag, label, width] of gevallen) {
      const { page, context, errors } = await openPage(baseUrl, { dag, width, height: width === 390 ? 844 : 780, feed: weekendFeed(dag, { uitstappen: 9, langePlaats: true }) });
      const blok = page.locator("#dit-weekend");
      await blok.locator(".dw-titel").waitFor();
      assert.match(await blok.locator(".dw-wanneer").textContent(), label, naam);
      // Minstens de negen verzonnen uitstappen (een handmatig item in dat weekend mag erbij komen).
      const n = await weekendKop(page);
      assert.ok(n >= 9, `${naam}: ${n} dingen te doen`);
      assert.equal(await blok.locator(".hl-card").count(), 6, `${naam}: zes kaarten`);
      assert.equal((await blok.locator("[data-dw-meer]").innerText()).trim(), `Alles dit weekend (${n})`);
      // Een kaart met de lange plaats staat erbij, op één regel (met een beletselteken).
      const plaatsen = await blok.locator(".hl-where").evaluateAll((els) => els.map((el) => el.textContent));
      assert.ok(plaatsen.includes(LANGE_PLAATS), `${naam}: geen kaart met de lange plaats: ${JSON.stringify(plaatsen)}`);
      const hoogte = await blok.locator(".hl-where").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
      assert.ok(Math.max(...hoogte) <= Math.min(...hoogte) + 1, `${naam}: een plaats loopt over meer regels: ${hoogte}`);
      const onder = await page.evaluate(() => Math.round(document.querySelector("#dit-weekend").getBoundingClientRect().bottom + window.scrollY));
      t.diagnostic(`${naam} ${dag} (${width} px): Dit weekend eindigt op ${onder}px`);
      assert.ok(onder <= 600, `${naam}: 'Dit weekend' eindigt op ${onder}px, niet boven 600px`);
      if (naam === "woensdag") {
        const kaart = blok.locator(".hl-card").first();
        const id = await kaart.getAttribute("data-hl-id");
        await kaart.click();
        await page.locator(`.pv-results .pv-row.open[data-uid="agenda:${id}"]`).waitFor({ timeout: 10000 });
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
  });

  // Nakijkbevindingen: "Alles dit weekend (n)" opende Uitgelicht met dezelfde zes kaarten, en de focus viel weg.
  // Nu klapt het blok open met alle n kaarten; de knop staat boven de kaarten en houdt de focus.
  await t.test("voorpagina: 'Alles dit weekend (n)' toont alle n kaarten; met het toetsenbord blijft de focus op de knop", async () => {
    const dag = volgendeWeekdag(today, 3);
    const { page, context, errors } = await openPage(baseUrl, { dag, feed: weekendFeed(dag, { uitstappen: 9 }) });
    const blok = page.locator("#dit-weekend");
    const knop = blok.locator("[data-dw-meer]");
    await knop.waitFor();
    const n = await weekendKop(page);
    assert.equal(await knop.getAttribute("aria-expanded"), "false");
    await knop.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction((aantal) => document.querySelectorAll("#dit-weekend .hl-card").length === aantal, n, { timeout: 5000 })
      .catch(async () => assert.fail(`na 'Alles dit weekend (${n})' staan er ${await blok.locator(".hl-card").count()} kaarten`));
    const ids = await blok.locator(".hl-card").evaluateAll((els) => els.map((el) => el.dataset.hlId));
    for (let i = 1; i <= 9; i += 1) assert.ok(ids.includes(`e2e-weekend-${i}`), `uitstap ${i} staat erbij`);
    assert.equal(await knop.getAttribute("aria-expanded"), "true");
    assert.equal(await page.evaluate(() => document.activeElement?.matches("#dit-weekend [data-dw-meer]") ?? false), true, "de focus blijft op de knop");
    // De volgende tab gaat naar de eerste kaart van het blok, niet ergens anders op de pagina.
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest("#dit-weekend .hl-card"))), true, "Tab gaat naar de eerste kaart");
    // Dichtklappen: weer zes kaarten, de focus op de knop.
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Enter");
    assert.equal(await blok.locator(".hl-card").count(), 6);
    assert.equal(await knop.getAttribute("aria-expanded"), "false");
    assert.equal(await page.evaluate(() => document.activeElement?.matches("#dit-weekend [data-dw-meer]") ?? false), true);
    assert.deepEqual(errors, []);
    await context.close();
  });

  // Nakijkbevinding 11 (rest): het tabblad "Dit weekend" van Uitgelicht zei 6, het blok bovenaan "12 dingen te doen".
  await t.test("voorpagina: het tabblad 'Dit weekend' van Uitgelicht telt evenveel als het blok bovenaan, en zegt hoeveel het toont", async () => {
    const dag = volgendeWeekdag(today, 3);
    const { page, context, errors } = await openPage(baseUrl, { dag, feed: weekendFeed(dag, { uitstappen: 9 }) });
    await page.locator("#dit-weekend [data-dw-meer]").waitFor();
    const n = await weekendKop(page);
    const tab = page.locator("#hl-tab-weekend");
    assert.equal(Number(await tab.locator(".hl-tab-count").textContent()), n, "het tabblad telt alles van het weekend");
    await tab.click();
    const paneel = page.locator("#agenda-highlights .highlights-panel");
    assert.equal(await paneel.locator(".hl-card").count(), 6);
    assert.equal((await paneel.locator(".hl-meer").textContent()).trim(), `6 van de ${n} getoond. Alles staat in de lijst hierboven.`);
    assert.deepEqual(errors, []);
    await context.close();
  });

  // Nakijkbevindingen 12 en 29: met alleen markten (gewicht 0) zei het blok "Nog niets op de agenda", terwijl er dit
  // weekend markten zijn; daarna zei de kop zonder voorbehoud "Geen uitstappen of evenementen", terwijl de keuze de
  // evenementen uitsloot. Nu noemt de kop de keuze, zegt de zin eronder dat de evenementen uit staan en wat er wel
  // is (markten één keer per markt). Alles verzonnen: drie uitstappen en markten in hetzelfde weekend.
  await t.test("voorpagina: 'Dit weekend' noemt de keuze en zegt nooit zonder voorbehoud dat er niets of geen evenementen zijn; marktkaarten = markten", async () => {
    const dag = volgendeWeekdag(today, 3);
    const markten = [["Proefmarkt (e2e)", "Proefplein", 1], ["Proefmarkt (e2e)", "Proefplein", 2], ["Proefbiomarkt (e2e)", "Proefkaai", 2]];
    const uitZin = "Evenementen staan niet in je keuze; zet ze aan om te zien wat er te doen is.";
    let { page, context, errors } = await openPage(baseUrl, { dag, feed: weekendFeed(dag, { uitstappen: 3, markten }), query: "?soort=markten" });
    const blok = page.locator("#dit-weekend");
    await blok.locator(".dw-titel").waitFor();
    assert.equal(await blok.isVisible(), true);
    assert.equal((await blok.locator(".dw-kop").textContent()).trim(), "Geen uitstappen of evenementen binnen je keuze");
    const tekst = await blok.innerText();
    assert.doesNotMatch(tekst, /niets op de agenda/i, tekst);
    const leeg = (await blok.locator(".dw-leeg").textContent()).trim();
    assert.ok(leeg.startsWith(uitZin), leeg);
    assert.match(leeg, /wel andere dingen op de agenda: Wekelijkse markten \(2\)\./);
    assert.deepEqual(errors, []);
    await context.close();
    // Niets binnen de keuze in het weekend, wel drie uitstappen erbuiten: nooit "Nog niets op de agenda".
    ({ page, context, errors } = await openPage(baseUrl, { dag, feed: weekendFeed(dag, { uitstappen: 3 }), query: "?soort=markten" }));
    await page.locator("#dit-weekend .dw-titel").waitFor();
    assert.equal((await page.locator("#dit-weekend .dw-kop").textContent()).trim(), "Nog niets binnen je keuze");
    assert.equal((await page.locator("#dit-weekend .dw-leeg").textContent()).trim(), `${uitZin} Binnen je keuze staat er dit weekend niets op de agenda. Kies hieronder meer soorten of kijk verder in de lijst.`);
    assert.deepEqual(errors, []);
    await context.close();
    // Evenementen aan (standaard) en alleen markten in het weekend: de kop noemt de keuze, geen zin over evenementen die uit staan.
    ({ page, context, errors } = await openPage(baseUrl, { dag, feed: weekendFeed(dag, { markten }) }));
    await page.locator("#dit-weekend .dw-titel").waitFor();
    assert.equal((await page.locator("#dit-weekend .dw-kop").textContent()).trim(), "Nog niets binnen je keuze");
    assert.doesNotMatch(await page.locator("#dit-weekend .dw-leeg").textContent(), /staan niet in je keuze/);
    assert.deepEqual(errors, []);
    await context.close();
    // Markten: de teller telt markten en de lijst toont evenveel marktkaarten, elk met de volgende dag.
    ({ page, context, errors } = await openPage(baseUrl, { dag, feed: weekendFeed(dag, { markten }), query: "?soort=markten&periode=alles" }));
    await page.waitForFunction(() => document.querySelector('[data-group="markten"] .pv-chip-n') && document.querySelector(".pv-markets"));
    const chip = Number(await page.locator('[data-group="markten"] .pv-chip-n').innerText());
    assert.equal(chip, 2, "twee verzonnen markten");
    assert.equal(await page.locator(".pv-results .pv-markets > li").count(), chip);
    assert.equal(await page.locator(".pv-results .pv-row").count(), 0, "geen losse marktdagen in de lijst");
    assert.match(await page.locator(".pv-results .pv-markets > li").first().innerText(), /Volgende: /);
    assert.equal(await page.locator("#dit-weekend").isVisible(), true);
    assert.deepEqual(errors, []);
    await context.close();
  });

  // P6: wie op een gsm een straat opent, ziet zonder scrollen de straat, de zin van de komende 7 dagen en de tegels.
  // Een verzonnen agendapunt vandaag in de straat; het nagebootste werk begint pas over 9 dagen en GIPOD meldt
  // geen hinder: het licht is dus "Let op", met het evenement van vandaag in de zin.
  const WEEK_MET_FEEST = /^Let op\s+De komende 7 dagen in jouw straat: (.*, |.* en )?\d+ evenement(en)? \((eerste )?vandaag\)/;
  // Hoeveel er in de lijst staat: de aantallen naast de koppen van de secties (elke sectie toont al haar kaartjes),
  // niet wat "later gepland" is. Een lege lijst heeft geen secties: 0.
  const inSecties = (page) => page.locator(".pv-results .pv-day-n").evaluateAll((els) => els.reduce((n, el) => n + Number(el.textContent), 0));
  const plekQuery = `?plek=${encodeURIComponent(street.name)}${byName.get(locationKey(street.name)).length > 1 ? `%20${street.postcode}` : ""}`;
  await t.test("gsm (390×844): straat, 'De komende 7 dagen' met het verwachte licht en de tegels staan boven 600 px; chips tellen de kaarten", async () => {
    const { page, context, errors } = await openPage(baseUrl, { street, query: plekQuery, agendaErbij: [proefAgendapunt(today, street)] });
    await page.locator(`.pv-results ${WORK_ROW}`).first().waitFor({ timeout: 15000 });
    await page.waitForFunction(() => !/nog geladen/.test(document.querySelector(".pv-dezeweek")?.textContent || ""), null, { timeout: 15000 });
    const week = page.locator(".pv-dezeweek");
    assert.match(await week.innerText(), WEEK_MET_FEEST);
    assert.match(await week.getAttribute("class"), /\bpv-dezeweek-let-op\b/);
    // Het nagebootste werk begint pas over 9 dagen: het telt niet mee voor de komende 7 dagen.
    assert.doesNotMatch(await week.innerText(), /\d+ werk/);
    const onder = await page.evaluate(() => Object.fromEntries([".pv-place-name", ".pv-dezeweek", ".pv-stats"].map((sel) => {
      const r = document.querySelector(sel)?.getBoundingClientRect();
      return [sel, r ? Math.round(r.bottom + window.scrollY) : -1];
    })));
    t.diagnostic(`onderkant op de pagina: ${JSON.stringify(onder)}`);
    for (const [sel, y] of Object.entries(onder)) assert.ok(y > 0 && y <= 600, `${sel} eindigt op ${y}px, niet boven 600px`);
    // De kaart zegt hoeveel er in de lijst eronder staat en hoeveel er op de kaart.
    const inLijst = await inSecties(page);
    await page.waitForFunction((n) => new RegExp(`^${n} (?:in de lijst|regels? in de lijst \\(samen \\d+ items?\\)), \\d+ op de kaart in `).test(document.querySelector(".buurt-status")?.textContent || ""), inLijst, { timeout: 10000 });
    assert.deepEqual(errors, []);
    await context.close();
  });

  // Geen bronwaarschuwing meer (#191 is weg): besluit van de eigenaar (18-10-2026), "niemand moet weten als er iets
  // faalt, de momentopname blijft wel goed". In de echte feed falen de twee eBesluit-bronnen sinds 13 oktober 2026;
  // ook dan ziet een bezoeker daar niets van, niet bovenaan (op de voorpagina en bij een straat) en niet in de
  // bronnenlijst ("Bronnen en volledige vooruitblik"): die zegt wanneer de bron het laatst goed ververst is. De
  // bronstatus blijft wel in de feed (intern: de job source-health en de alarmen naar de eigenaar). De toetsen hierboven
  // nemen gezonde bronnen (gezondeBronnen); deze twee nemen de falende bronnen na (falendeBronnen): eerst dat er niets
  // over staat, dan dat de straat, de weekzin, de tegels (P6) en "Dit weekend" (P8) ook dan boven 600 px eindigen.
  const EBESLUIT = ["district-ebesluit", "district-ebesluit-evenementen"];
  const plekFeedMet = (bronnen) => {
    const feed = bronnen(gezondeBronnen(echteFeed()));
    feed.items.push(kalenderItem(feed.generatedAt, proefAgendapunt(today, street)));
    return feed;
  };
  const metFalendeBron = (feed) => falendeBronnen(feed, EBESLUIT);
  const bronnenNagekeken = (page) => page.waitForFunction(() => !/controleren/i.test(document.querySelector("#agenda-freshness")?.textContent || ""), null, { timeout: 10000 });
  // Wat een bezoeker vroeger las als een bron faalde (bovenaan, in de bronnenlijst en in de zin "Officiële broncontrole
  // …", die de punten van een falende bron telde als "verouderde bron").
  // ("versheid per bron" zelf staat wel nog in de uitleg van "Alle lijsten, bronnen en instellingen": dat is geen melding.)
  const BRONFOUT = /tijdelijk onbereikbaar|ophaalpoging mislukt|verouderd sinds|verouderde bron|officiële bronnen zijn|Bekijk de versheid/i;
  // Alle tekst die een bezoeker kan lezen, ook in een ingeklapt blok (body.innerText laat de inhoud van een dicht
  // <details> weg; nakijkbevinding: zo bleef "verouderde bron" in "Bronnen en volledige vooruitblik" onopgemerkt).
  const leesbareTekst = (page) => page.evaluate(() => [document.body.innerText, ...[...document.querySelectorAll("details")].map((el) => el.textContent)].join("\n"));
  await t.test("geen bronwaarschuwing (besluit 18-10-2026): met de eBesluit-bronnen falend staat er niets over, op de voorpagina en bij een straat", async () => {
    const dag = volgendeWeekdag(today, 3);
    const ebesluitLabels = echteFeed().sources.filter((bron) => EBESLUIT.includes(bron.sourceId)).map((bron) => bron.label);
    assert.equal(ebesluitLabels.length, 2);
    for (const [naam, opties] of [
      ["voorpagina, eBesluit faalt", { dag, feed: metFalendeBron(weekendFeed(dag, { uitstappen: 9 })) }],
      ["straat, eBesluit faalt", { street, query: plekQuery, feed: plekFeedMet(metFalendeBron) }],
      ["voorpagina, gezonde bronnen", { dag, feed: weekendFeed(dag, { uitstappen: 9 }) }],
      ["straat, gezonde bronnen", { street, query: plekQuery, feed: plekFeedMet((feed) => feed) }],
    ]) {
      const { page, context, errors } = await openPage(baseUrl, opties);
      await bronnenNagekeken(page);
      assert.equal(await page.locator("#agenda-source-warning").count(), 0, naam);
      // Ook niet in de ingeklapte bronnenlijst: daar staat bij eBesluit het moment van de laatste goede stand.
      await page.waitForFunction(() => document.querySelector("#agenda-source-status li"), null, { timeout: 10000 });
      const lijst = await page.locator("#agenda-source-status").evaluate((el) => [...el.querySelectorAll("li")].map((li) => li.textContent.replace(/\s+/g, " ").trim()));
      for (const label of ebesluitLabels) assert.ok(lijst.some((regel) => regel.startsWith(`${label}: ververst op `)), `${naam}: ${label} in ${JSON.stringify(lijst)}`);
      assert.doesNotMatch(await leesbareTekst(page), BRONFOUT, naam);
      // De zin over de broncontrole staat in dat ingeklapte blok en telt de punten van de falende bron niet mee.
      const notitie = await page.locator("#agenda-refresh-note").textContent();
      assert.match(notitie, /^Officiële broncontrole /, naam);
      assert.ok(await page.locator(".agenda-technical-details #agenda-refresh-note").count(), `${naam}: de zin staat in "Bronnen en volledige vooruitblik"`);
      assert.doesNotMatch(notitie, BRONFOUT, naam);
      assert.deepEqual(errors, [], naam);
      await context.close();
    }
  });

  // Vroeger een todo (vraag 2 aan de eigenaar): met de bronwaarschuwing eindigden de plek en "Dit weekend" op een gsm
  // onder 600 px (17-10-2026, eBesluit faalt: plek 543/679/833 px, "Dit weekend" 819 px op 390 en 850 px op 360).
  await t.test("gsm met falende eBesluit-bronnen: straat, weekzin en tegels (390×844) en 'Dit weekend' (390×844 en 360×780) eindigen boven 600 px", async () => {
    const dag = volgendeWeekdag(today, 3);
    const onder = {};
    for (const [width, height] of [[390, 844], [360, 780]]) {
      const { page, context } = await openPage(baseUrl, { dag, width, height, feed: metFalendeBron(weekendFeed(dag, { uitstappen: 9, langePlaats: true })) });
      await bronnenNagekeken(page);
      await page.locator("#dit-weekend .dw-titel").waitFor();
      onder[`Dit weekend ${width} px`] = await page.evaluate(() => Math.round(document.querySelector("#dit-weekend").getBoundingClientRect().bottom + window.scrollY));
      await context.close();
    }
    const { page, context } = await openPage(baseUrl, { street, query: plekQuery, feed: plekFeedMet(metFalendeBron) });
    await page.locator(`.pv-results ${WORK_ROW}`).first().waitFor({ timeout: 15000 });
    await page.waitForFunction(() => !/nog geladen/.test(document.querySelector(".pv-dezeweek")?.textContent || ""), null, { timeout: 15000 });
    await bronnenNagekeken(page);
    Object.assign(onder, await page.evaluate(() => Object.fromEntries([".pv-place-name", ".pv-dezeweek", ".pv-stats"].map((sel) => {
      const r = document.querySelector(sel)?.getBoundingClientRect();
      return [sel, r ? Math.round(r.bottom + window.scrollY) : -1];
    }))));
    await context.close();
    t.diagnostic(`met falende eBesluit-bronnen, onderkant op de pagina: ${JSON.stringify(onder)}`);
    for (const [wat, y] of Object.entries(onder)) assert.ok(y > 0 && y <= 600, `${wat} eindigt op ${y}px, niet boven 600px`);
  });

  // Nakijkronde 2 (18-10-2026): de melding dat de hele agenda meer dan 48 uur niet ververst is ("⏳ De agenda wordt even
  // niet ververst. … We werken eraan."), de oranje pil "Laatst bijgewerkt", de badge "Laatst bevestigd …" en "… omdat de
  // verversing achterloopt" in de bronnenlijst bleven staan: zo wist een bezoeker toch dat er iets faalt, tegen het
  // besluit in ("niemand moet weten als er iets faalt, de momentopname blijft wel goed"). Op een gsm eindigden "Dit
  // weekend" (791 px) en de plek (573/691/845 px) zo ook weer onder 600 px (P6, P8). Nu: de momentopname met haar
  // tijdstip, zonder melding. Intern blijft het alarm (de job freshness in refresh.yml).
  const DRIE_DAGEN = 3 * 86400000;
  const oudeFeed = (feed) => {
    const toen = new Date(Date.parse(feed.generatedAt) - DRIE_DAGEN).toISOString();
    const oud = JSON.parse(JSON.stringify(feed).replaceAll(feed.generatedAt, toen));
    return Object.assign(oud, { generatedAt: toen, classificationAsOf: toen.slice(0, 10) });
  };
  const ACHTERSTAND = /wordt even niet ververst|We werken eraan|Laatst bevestigd|achterloopt|check je best even|Laatst bijgewerkt/i;
  await t.test("de hele agenda is 3 dagen oud en de bronnen falen: geen melding, de momentopname blijft, en op de gsm alles boven 600 px", async () => {
    const dag = volgendeWeekdag(today, 3);
    const onder = {};
    for (const [width, height] of [[390, 844], [360, 780]]) {
      const { page, context, errors } = await openPage(baseUrl, { dag, width, height, feed: metFalendeBron(oudeFeed(weekendFeed(dag, { uitstappen: 9, langePlaats: true }))) });
      await bronnenNagekeken(page);
      await page.locator("#dit-weekend .dw-titel").waitFor();
      // De momentopname blijft: de kaarten van het weekend staan er (intern met graceStale), zonder badge.
      assert.equal(await page.locator("#dit-weekend .hl-card").count(), 6, `${width} px: de kaarten van het weekend staan er`);
      assert.ok(await page.evaluate(() => (window.PUBLIC_AGENDA_VISIBLE_ITEMS || []).some((i) => i.graceStale)), "intern: de punten blijven, met graceStale");
      assert.equal(await page.locator("#agenda-stale-banner, .stale-banner, .grace-badge").count(), 0, `${width} px`);
      assert.doesNotMatch(await page.locator("#agenda-freshness").getAttribute("class"), /is-stale/);
      assert.match(await page.locator("#agenda-freshness").textContent(), /^Bijgewerkt /, "het tijdstip van de momentopname");
      assert.doesNotMatch(await leesbareTekst(page), ACHTERSTAND, `${width} px`);
      assert.doesNotMatch(await page.locator("#agenda-refresh-note").textContent(), ACHTERSTAND);
      onder[`Dit weekend ${width} px`] = await page.evaluate(() => Math.round(document.querySelector("#dit-weekend").getBoundingClientRect().bottom + window.scrollY));
      assert.deepEqual(errors, [], `${width} px`);
      await context.close();
    }
    const plekDag = addDays(today, 3);
    const feed = gezondeBronnen(echteFeed());
    feed.items.push(kalenderItem(feed.generatedAt, proefAgendapunt(addDays(today, 4), street)));
    const { page, context, errors } = await openPage(baseUrl, { dag: plekDag, street, query: plekQuery, feed: metFalendeBron(feed) });
    await page.locator(`.pv-results ${WORK_ROW}`).first().waitFor({ timeout: 15000 });
    await page.waitForFunction(() => !/nog geladen/.test(document.querySelector(".pv-dezeweek")?.textContent || ""), null, { timeout: 15000 });
    await bronnenNagekeken(page);
    assert.equal(await page.locator("#agenda-stale-banner, .stale-banner, .grace-badge").count(), 0, "plek");
    assert.doesNotMatch(await leesbareTekst(page), ACHTERSTAND, "plek");
    Object.assign(onder, await page.evaluate(() => Object.fromEntries([".pv-place-name", ".pv-dezeweek", ".pv-stats"].map((sel) => {
      const r = document.querySelector(sel)?.getBoundingClientRect();
      return [sel, r ? Math.round(r.bottom + window.scrollY) : -1];
    }))));
    assert.deepEqual(errors, [], "plek");
    await context.close();
    t.diagnostic(`agenda 3 dagen oud, onderkant op de pagina: ${JSON.stringify(onder)}`);
    for (const [wat, y] of Object.entries(onder)) assert.ok(y > 0 && y <= 600, `${wat} eindigt op ${y}px, niet boven 600px`);
  });

  // Nakijkbevindingen (kaart-tellers): "X in de lijst, Y op de kaart" onder de kaart. X is wat de lijst echt
  // toont: met de periode, of de 14 dagen van de tijdlijn en de gekozen dag; de maand heeft geen lijst en
  // krijgt de gewone zin. Y telt wat de kaart tekent, op dezelfde manier: een werf in stukken één keer.
  // Nakijkbevinding (frisse ogen): deze toetsen gingen ervan uit dat er in de echte feed niets in de Peterseliestraat
  // staat. Nu krijgen ze een verzonnen feed (`LEGE_FEED`, of met een eigen reeks): de lijst toont het nagebootste werk,
  // de verzonnen aanvraag en wat de toets er zelf bij zet.
  const PETERSELIE = { id: "2289", name: "Peterseliestraat", postcode: "2000" };
  const LEGE_FEED = proefFeed(today, []);
  const wachtOpZin = (page, begin) => page.waitForFunction((b) => (document.querySelector(".buurt-status")?.textContent || "").startsWith(b), begin, { timeout: 10000 })
    .catch(async () => assert.fail(`de kaart zegt "${await page.locator(".buurt-status").textContent()}", verwacht: "${begin}…"`));
  const wachtOpLijst = (page, x) => page.waitForFunction((n) => new RegExp(`^${n} (?:in de lijst|regels? in de lijst \\(samen \\d+ items?\\)), \\d+ op de kaart in Peterseliestraat`).test(document.querySelector(".buurt-status")?.textContent || ""), x, { timeout: 10000 })
    .catch(async () => assert.fail(`de kaart zegt "${await page.locator(".buurt-status").textContent()}", verwacht: ${x} in de lijst`));
  await t.test("kaart-tellers: 'X in de lijst' is wat de lijst toont, in de tijdlijn, met een gekozen dag en met de periode", async () => {
    const { page, context, errors } = await openPage(baseUrl, { street: PETERSELIE, feed: LEGE_FEED, query: "?plek=Peterseliestraat&weergave=tijdlijn" });
    await page.locator(`.pv-results ${WORK_ROW}`).waitFor({ timeout: 15000 });
    await page.waitForFunction(() => Array.isArray((window.PUBLIC_AGENDA_LIVE_STREETS || {}).permits), null, { timeout: 15000 });
    // De tijdlijn toont het werk, niet de aanvraag; het overzicht boven de lijst telt beide.
    let x = await inSecties(page);
    assert.equal(x, 1);
    assert.ok(Number((await page.locator(".pv-sub").innerText()).match(/^(\d+) item/)?.[1]) > x, "de plek telt meer dan de tijdlijn toont");
    // Nakijkbevinding: de zin gaf alleen de 14 dagen als reden; ook de aanvraag staat er niet in, en dat zegt ze nu.
    const ZONDER = "zonder vergunningen en terrassen; kies “Lijst” voor alles.";
    assert.equal(await page.locator(".pv-sub").innerText(), `2 items uit officiële bronnen. De tijdlijn toont alleen de komende 14 dagen, ${ZONDER}`);
    await wachtOpLijst(page, x);
    // Een dag zonder iets: 0 in de lijst. De startdag van het werk: weer het werk.
    await page.click(`[data-tl-dag="${today}"]`);
    assert.equal(await inSecties(page), 0);
    assert.match(await page.locator(".pv-sub").innerText(), new RegExp(`^2 items uit officiële bronnen\\. De tijdlijn toont alleen \\S+ ${Number(today.slice(8))} \\S+, ${ZONDER}$`));
    await wachtOpLijst(page, 0);
    await page.click(`[data-tl-dag="${addDays(today, 9)}"]`);
    await page.locator(`.pv-results ${WORK_ROW}`).waitFor();
    await wachtOpLijst(page, await inSecties(page));
    // De maand heeft geen lijst: geen "in de lijst". De zin zegt waarom het dagpaneel minder toont dan het getal.
    await page.click('[data-mode="maand"]');
    await page.waitForFunction(() => /^\d+ agendapunten? op de kaart in Peterseliestraat/.test(document.querySelector(".buurt-status")?.textContent || ""), null, { timeout: 10000 });
    assert.doesNotMatch(await page.locator(".buurt-status").textContent(), /in de lijst/);
    assert.equal(await page.locator(".pv-sub").innerText(), `2 items uit officiële bronnen. De maand toont per dag wat er gebeurt, ${ZONDER}`);
    // Wat "Deel" meestuurt, zegt hetzelfde (de weergave staat in de link).
    await page.waitForFunction(() => !/nog geladen/.test(document.querySelector(".pv-dezeweek")?.textContent || ""), null, { timeout: 15000 });
    await page.evaluate(() => { navigator.share = (data) => { window.__gedeeld = data; return Promise.resolve(); }; });
    await page.locator(".pv-share").click();
    const gedeeld = await page.evaluate(() => window.__gedeeld);
    assert.match(gedeeld.text, new RegExp(`^Peterseliestraat: 2 items uit officiële bronnen op de publieke agenda\\. De maand toont per dag wat er gebeurt, ${ZONDER.replace(/[.()]/g, "\\$&")} `));
    assert.equal(new URL(gedeeld.url).searchParams.get("weergave"), "maand");
    // De lijst (standaard periode "alles" in een straat): het werk en de aanvraag. Over 7 dagen staat het werk bij
    // "later gepland".
    await page.click('[data-mode="lijst"]');
    x = await inSecties(page);
    assert.equal(x, 2);
    await wachtOpLijst(page, x);
    await page.click('[data-period="week"]');
    await page.locator(".pv-later").waitFor();
    assert.equal(await page.locator(`.pv-results ${WORK_ROW}`).count(), 0);
    x = await inSecties(page);
    assert.equal(x, 1);
    await wachtOpLijst(page, x);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test("kaart-tellers: een werf in twee stukken is één kaart in de lijst en telt één keer op de kaart", async () => {
    const { page, context, errors } = await openPage(baseUrl, { street: PETERSELIE, feed: LEGE_FEED, werkStukken: 2, query: "?plek=Peterseliestraat&weergave=maand" });
    // Beide stukken zijn binnen, elk met een eigen punt.
    await page.waitForFunction(() => (window.PUBLIC_AGENDA_LIVE_STREETS?.works || []).filter((w) => w.gipodId >= 999999901 && Array.isArray(w.point)).length === 2, null, { timeout: 15000 });
    // De maand: de gewone zin, met de werf één keer bij de werken (niet per stuk).
    await page.waitForFunction(() => /^\d+ agendapunten? op de kaart in Peterseliestraat · \d+ werken en hinder/.test(document.querySelector(".buurt-status")?.textContent || ""), null, { timeout: 10000 });
    const agendapunten = Number((await page.locator(".buurt-status").textContent()).match(/^(\d+) agendapunt/)[1]);
    await wachtOpZin(page, `${agendapunten} agendapunt${agendapunten === 1 ? "" : "en"} op de kaart in Peterseliestraat · 1 werken en hinder`);
    // De tijdlijn: één kaart voor de werf, en op de kaart de agendapunten plus die ene werf. Sinds P9 tekent de kaart
    // ook de verzonnen aanvraag (een vergunning, als plek bij benadering): die telt één keer mee.
    await page.click('[data-mode="tijdlijn"]');
    await page.locator(`.pv-results ${WORK_ROW}`).waitFor({ timeout: 15000 });
    assert.equal(await page.locator('.pv-results .pv-row[data-uid^="works:"]').count(), 1, "één kaart voor de werf");
    await wachtOpZin(page, `${await inSecties(page)} in de lijst, ${agendapunten + 2} op de kaart in Peterseliestraat`);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test("kaart-tellers: een kaart die later laadt dan de lijst, zegt toch hoeveel er in de lijst staat", async () => {
    // Een rustige straat: de live lagen voegen niets toe, dus de lijst meldt haar aantal maar één keer.
    const { page, context, errors } = await openPage(baseUrl, { street: PETERSELIE, feed: LEGE_FEED, work: false, aanvraag: false, kaartLaat: true, query: "?plek=Peterseliestraat" });
    await page.locator("#buurtkaart .buurt-status").waitFor({ timeout: 15000 });
    await page.waitForFunction(() => { const l = window.PUBLIC_AGENDA_LIVE_STREETS || {}; return Array.isArray(l.works) && Array.isArray(l.permits); }, null, { timeout: 15000 });
    await wachtOpLijst(page, await inSecties(page));
    assert.deepEqual(errors, []);
    await context.close();
  });

  // Nakijkbevindingen 14 (rest) en "inSecties telt kaarten": X telde per activiteit, de lijst toont een activiteit op
  // twee dagen als twee kaarten (en de aantallen naast de koppen ook). Nu telt X de kaarten die je ziet, in de tijdlijn
  // en in de lijst. Een verzonnen activiteit (dezelfde titel en plek) op morgen en overmorgen + 2.
  await t.test("kaart-tellers: een activiteit op twee dagen telt als twee kaarten, zoals de lijst ze toont (tijdlijn en lijst)", async () => {
    const reeks = proefFeed(today, (stempel) => [1, 3].map((n) => kalenderItem(stempel, {
      id: `e2e-reeks-${n}`, externalId: "e2e-reeks", title: "Proefatelier voor buren (e2e)", date: addDays(today, n), timeSlot: "14:00",
      location: `${PETERSELIE.name}, ${PETERSELIE.postcode} Antwerpen`, postcodes: [PETERSELIE.postcode], dateLabel: dagTekst(addDays(today, n)),
    })));
    const { page, context, errors } = await openPage(baseUrl, { street: PETERSELIE, feed: reeks, query: "?plek=Peterseliestraat&weergave=tijdlijn" });
    await page.locator(`.pv-results ${WORK_ROW}`).waitFor({ timeout: 15000 });
    await page.waitForFunction(() => Array.isArray((window.PUBLIC_AGENDA_LIVE_STREETS || {}).permits), null, { timeout: 15000 });
    // Wat er echt staat: de kaarten in de lijst (geen grens per sectie, niets wacht op "Toon de volgende N").
    const kaarten = () => page.locator(".pv-results .pv-row").count();
    assert.equal(await page.locator('.pv-results .pv-row[data-uid^="agenda:e2e-reeks-"]').count(), 2, "de activiteit staat er op twee dagen");
    assert.equal(await page.locator(".pv-laad-meer").count(), 0);
    // De tijdlijn: het werk en de activiteit op twee dagen.
    assert.equal(await kaarten(), 3);
    assert.equal(await inSecties(page), 3);
    await wachtOpLijst(page, 3);
    // De lijst (standaard alles): ook de aanvraag.
    await page.click('[data-mode="lijst"]');
    await page.locator(`.pv-results ${WORK_ROW}`).waitFor();
    assert.equal(await page.locator(".pv-laad-meer").count(), 0);
    assert.equal(await kaarten(), 4);
    assert.equal(await inSecties(page), 4);
    await wachtOpLijst(page, 4);
    assert.deepEqual(errors, []);
    await context.close();
  });

  // Wens van 12 oktober 2026 ("de publieke agenda, bij de straat zelf moet niet beperkt zijn, gewoon alle data die je
  // hebt"): wie een straat kiest, ziet standaard alles. Verzonnen feed in de Peterseliestraat: 20 activiteiten op één dag
  // (meer dan de oude grens van 12 per sectie) en één over 200 dagen (buiten de oude standaard van 30 dagen), plus het
  // nagebootste werk en de verzonnen aanvraag: 23 kaartjes.
  const OP_EEN_DAG = 20;
  const drukkeDag = addDays(today, 3), verWeg = addDays(today, 200);
  const inPeterselie = { location: `${PETERSELIE.name}, ${PETERSELIE.postcode} Antwerpen`, postcodes: [PETERSELIE.postcode] };
  const DRUKKE_FEED = proefFeed(today, (stempel) => [
    ...Array.from({ length: OP_EEN_DAG }, (_, i) => kalenderItem(stempel, {
      id: `e2e-druk-${i + 1}`, externalId: `e2e-druk-${i + 1}`, title: `Proefworkshop ${i + 1} voor buren (e2e)`, date: drukkeDag,
      timeSlot: `${String(8 + (i % 12)).padStart(2, "0")}:00`, dateLabel: dagTekst(drukkeDag), ...inPeterselie,
    })),
    kalenderItem(stempel, { id: "e2e-ver-weg", externalId: "e2e-ver-weg", title: "Proefbuurtfeest ver vooruit (e2e)", date: verWeg, timeSlot: "15:00", dateLabel: dagTekst(verWeg), ...inPeterselie }),
  ]);
  const DRUKKE_TOTAAL = OP_EEN_DAG + 1 + 2;
  const periodeInUrl = (page) => page.evaluate(() => new URL(location.href).searchParams.get("periode"));
  const wachtOpLagen = async (page) => {
    await page.locator(`.pv-results ${WORK_ROW}`).waitFor({ timeout: 15000 });
    await page.waitForFunction(() => Array.isArray((window.PUBLIC_AGENDA_LIVE_STREETS || {}).permits), null, { timeout: 15000 });
  };
  await t.test("alles standaard: alle soorten aan, periode Alles, >12 op één dag en wat over 200 dagen komt staan er allemaal", async () => {
    const { page, context, errors } = await openPage(baseUrl, { street: PETERSELIE, feed: DRUKKE_FEED, query: "?plek=Peterseliestraat" });
    await wachtOpLagen(page);
    // Alle soorten aan, ook raad, inspraak, markten, werken en vergunningen; de URL zegt niets over soort of periode.
    const chips = await page.locator('.pv-groups [data-group]:not([data-group="*"])').evaluateAll((els) => els.map((b) => [b.dataset.group, b.getAttribute("aria-pressed")]));
    assert.deepEqual(chips, ["evenementen", "werken", "inspraak", "markten", "raad", "vergunningen"].map((k) => [k, "true"]));
    assert.equal(await page.locator('[data-period="alles"]').getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator('.pv-periods [aria-pressed="true"]').count(), 1);
    assert.equal(await periodeInUrl(page), null);
    assert.equal(await page.evaluate(() => new URL(location.href).searchParams.has("soort")), false);
    // De drukke dag: alle 20, zonder "Toon alle 20"; het buurtfeest over 200 dagen staat in de lijst (niet "later gepland").
    const dag = page.locator(`.pv-results section[data-sectie="d:${drukkeDag}"]`);
    assert.equal(await dag.locator(".pv-day-n").innerText(), String(OP_EEN_DAG));
    assert.equal(await dag.locator(".pv-row").count(), OP_EEN_DAG);
    assert.equal(await page.locator('.pv-results .pv-row[data-uid="agenda:e2e-ver-weg"]').count(), 1);
    assert.equal(await page.locator(".pv-later, .pv-laad-meer, [data-expand]").count(), 0);
    assert.equal(await page.locator(".pv-results").getByText(/^Toon alle \d+$/).count(), 0);
    // Het getal boven de lijst, de lijst zelf en "X in de lijst" onder de kaart zijn hetzelfde: alles.
    assert.equal(await page.locator(".pv-sub").innerText(), `${DRUKKE_TOTAAL} items uit officiële bronnen.`);
    assert.equal(await page.locator(".pv-results .pv-row").count(), DRUKKE_TOTAAL);
    assert.equal(await inSecties(page), DRUKKE_TOTAAL);
    await wachtOpLijst(page, DRUKKE_TOTAAL);
    // De deeltekst zegt hoeveel er staat, met de link naar alles (geen periode).
    await page.waitForFunction(() => !/nog geladen/.test(document.querySelector(".pv-dezeweek")?.textContent || ""), null, { timeout: 15000 });
    assert.equal(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), true, "een gsm deelt met navigator.share");
    await page.evaluate(() => { navigator.share = (data) => { window.__gedeeld = data; return Promise.resolve(); }; });
    await page.locator(".pv-share").click();
    const gedeeld = await page.evaluate(() => window.__gedeeld);
    assert.match(gedeeld.text, new RegExp(`^Peterseliestraat: ${DRUKKE_TOTAAL} items uit officiële bronnen op de publieke agenda\\. De komende 7 dagen in jouw straat: `));
    assert.equal(new URL(gedeeld.url).searchParams.get("periode"), null);
    // Beperken blijft werken: 7 dagen toont het buurtfeest niet meer, het getal zegt waarom; "Alles" zet het terug.
    await page.click('[data-period="week"]');
    assert.equal(await periodeInUrl(page), "week");
    assert.equal(await page.locator('.pv-results .pv-row[data-uid="agenda:e2e-ver-weg"]').count(), 0);
    assert.match(await page.locator(".pv-sub").innerText(), new RegExp(`^${DRUKKE_TOTAAL} items uit officiële bronnen\\. De lijst toont alleen de komende 7 dagen; kies “Alles” voor de rest\\.$`));
    await page.click('[data-period="alles"]');
    assert.equal(await periodeInUrl(page), null);
    assert.equal(await page.locator(".pv-sub").innerText(), `${DRUKKE_TOTAAL} items uit officiële bronnen.`);
    // Een soort uit en weer aan: de knoppen blijven werken, "alles" is alleen de vertrekstand.
    await page.click('.pv-groups [data-group="werken"]');
    assert.equal(await page.evaluate(() => new URL(location.href).searchParams.get("soort")), "evenementen,inspraak,markten,raad,vergunningen");
    assert.equal(await page.locator(`.pv-results ${WORK_ROW}`).count(), 0);
    await page.click('.pv-groups [data-group="werken"]');
    assert.equal(await page.evaluate(() => new URL(location.href).searchParams.has("soort")), false);
    assert.equal(await page.locator(`.pv-results ${WORK_ROW}`).count(), 1);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test("een oude link met ?periode=maand werkt nog: 30 dagen, de rest bij 'later gepland', en blijft in de link", async () => {
    const { page, context, errors } = await openPage(baseUrl, { street: PETERSELIE, feed: DRUKKE_FEED, query: "?plek=Peterseliestraat&periode=maand" });
    await wachtOpLagen(page);
    assert.equal(await page.locator('[data-period="maand"]').getAttribute("aria-pressed"), "true");
    assert.equal(await periodeInUrl(page), "maand");
    // Binnen 30 dagen: alle 20 op de drukke dag (geen grens per sectie); het buurtfeest staat bij "later gepland".
    assert.equal(await page.locator(`.pv-results section[data-sectie="d:${drukkeDag}"] .pv-row`).count(), OP_EEN_DAG);
    assert.equal(await page.locator('.pv-results .pv-row[data-uid="agenda:e2e-ver-weg"]').count(), 0);
    assert.match(await page.locator(".pv-later").innerText(), /^1 item later gepland/);
    assert.equal(await page.locator(".pv-sub").innerText(), `${DRUKKE_TOTAAL} items uit officiële bronnen. De lijst toont alleen de komende 30 dagen; kies “Alles” voor de rest.`);
    await wachtOpLijst(page, DRUKKE_TOTAAL - 1);
    // "Later gepland" toont alles: de periode gaat naar "Alles" en uit de link.
    await page.locator(".pv-later").click();
    assert.equal(await page.locator('[data-period="alles"]').getAttribute("aria-pressed"), "true");
    assert.equal(await periodeInUrl(page), null);
    assert.equal(await page.locator('.pv-results .pv-row[data-uid="agenda:e2e-ver-weg"]').count(), 1);
    assert.deepEqual(errors, []);
    await context.close();
  });

  // Een heel lange lijst (een wijk of postcode met de lagen van het hele district: 2.435 items voor 2000 op de echte
  // feed van 12 oktober 2026) tekent per 150 kaartjes en laadt de volgende vanzelf bij het scrollen. Verzonnen: 200
  // activiteiten in de Peterseliestraat (5 per dag over 40 dagen), plus het werk en de aanvraag: 202 kaartjes.
  const LANG = 200;
  const LANGE_FEED = proefFeed(today, (stempel) => Array.from({ length: LANG }, (_, i) => kalenderItem(stempel, {
    id: `e2e-lang-${i + 1}`, externalId: `e2e-lang-${i + 1}`, title: `Proefatelier ${i + 1} (e2e)`, date: addDays(today, 1 + Math.floor(i / 5)),
    timeSlot: `${String(9 + (i % 5)).padStart(2, "0")}:00`, dateLabel: dagTekst(addDays(today, 1 + Math.floor(i / 5))), ...inPeterselie,
  })));
  await t.test("een lijst van meer dan 150: de eerste 150 meteen, de rest vanzelf bij het scrollen; het getal is altijd alles", async () => {
    const { page, context, errors } = await openPage(baseUrl, { street: PETERSELIE, feed: LANGE_FEED, query: "?plek=Peterseliestraat" });
    await wachtOpLagen(page);
    assert.equal(await page.locator(".pv-results .pv-row").count(), 150);
    assert.equal(await page.locator(".pv-laad-meer").innerText(), `Toon de volgende ${LANG + 2 - 150} (nog ${LANG + 2 - 150} in deze lijst)`);
    assert.equal(await page.locator(".pv-sub").innerText(), `${LANG + 2} items uit officiële bronnen.`);
    await wachtOpLijst(page, LANG + 2);
    // Naar beneden scrollen zoals een bewoner (een scherm per keer): de rest komt vanzelf, en de knop verdwijnt.
    const rijen = () => page.locator(".pv-results .pv-row").count();
    for (let i = 0; i < 80 && await rijen() < LANG + 2; i += 1) { await page.mouse.wheel(0, 700); await page.waitForTimeout(50); }
    await page.waitForFunction((n) => document.querySelectorAll(".pv-results .pv-row").length === n, LANG + 2, { timeout: 5000 });
    assert.equal(await page.locator(".pv-laad-meer").count(), 0);
    assert.equal(await inSecties(page), LANG + 2);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test("een lijst van meer dan 150 met het toetsenbord, en een kaartje verder in de lijst openen (van de kaart of een link)", async () => {
    const { page, context, errors } = await openPage(baseUrl, { street: PETERSELIE, feed: LANGE_FEED, width: 1280, height: 900, query: "?plek=Peterseliestraat" });
    await wachtOpLagen(page);
    assert.equal(await page.locator(".pv-results .pv-row").count(), 150);
    // De knop met het toetsenbord (zonder scrollen, anders laadt hij al vanzelf): de volgende stap, en de focus op het
    // eerste kaartje dat erbij kwam.
    await page.evaluate(() => document.querySelector(".pv-laad-meer").focus({ preventScroll: true }));
    await page.keyboard.press("Enter");
    assert.equal(await page.locator(".pv-results .pv-row").count(), LANG + 2);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll(".pv-results .pv-row")].indexOf(document.activeElement.closest(".pv-row"))), 150);
    // Opnieuw bovenaan (een andere periode en terug): weer 150.
    const bovenaan = async () => {
      await page.click('[data-period="kwartaal"]');
      await page.click('[data-period="alles"]');
      assert.equal(await page.locator(".pv-results .pv-row").count(), 150);
    };
    await bovenaan();
    // Met Tab naar de knop: ze komt in beeld en laadt vanzelf; de focus gaat mee naar het eerste kaartje dat erbij kwam.
    await page.locator(".pv-laad-meer").focus();
    await page.waitForFunction((n) => document.querySelectorAll(".pv-results .pv-row").length === n, LANG + 2, { timeout: 5000 });
    assert.equal(await page.evaluate(() => [...document.querySelectorAll(".pv-results .pv-row")].indexOf(document.activeElement.closest(".pv-row"))), 150);
    // Een kaartje verder openen (zoals de kaart doet): het staat er, open, ook al zat het voorbij de stap.
    await bovenaan();
    await page.evaluate(() => window.PUBLIC_AGENDA_OPEN("e2e-lang-199"));
    const rij = page.locator('.pv-results .pv-row[data-uid="agenda:e2e-lang-199"]');
    assert.equal(await rij.count(), 1);
    assert.equal(await rij.locator(".pv-row-btn").getAttribute("aria-expanded"), "true");
    // Alleen die ene keer: daarna begint de lijst weer met 150, ook al staat dat kaartje nog open.
    await bovenaan();
    assert.equal(await rij.count(), 0);
    assert.deepEqual(errors, []);
    await context.close();
  });

  // Nakijkbevinding: een kaartje dat ooit openging, bleef de hele sessie de lijst meetrekken (state.open). Een open
  // terras in een straat liet daarna in postcode 2000 meteen 2.090 kaartjes tekenen in plaats van 150. Alleen wat
  // de kaart of een link opent, staat er altijd (en alleen bij die tekenbeurt).
  await t.test("een kaartje dat een bewoner openklapte, trekt de lijst niet mee: dezelfde plek of een postcode begint weer met 150", async () => {
    const { page, context, errors } = await openPage(baseUrl, { street: PETERSELIE, feed: LANGE_FEED, width: 1280, height: 900, query: "?plek=Peterseliestraat" });
    await wachtOpLagen(page);
    const rijen = () => page.locator(".pv-results .pv-row").count();
    await page.evaluate(() => document.querySelector(".pv-laad-meer").click());
    assert.equal(await rijen(), LANG + 2);
    const ver = page.locator('.pv-results .pv-row[data-uid="agenda:e2e-lang-199"]');
    await ver.locator(".pv-row-btn").click();
    assert.equal(await ver.locator(".pv-row-btn").getAttribute("aria-expanded"), "true");
    // Dezelfde straat, een andere periode en terug: 150, en het open kaartje (plaats 200) staat er niet.
    await page.click('[data-period="kwartaal"]');
    await page.click('[data-period="alles"]');
    assert.equal(await rijen(), 150);
    assert.equal(await ver.count(), 0);
    // Weer tot daar en open laten staan; dan postcode 2000 kiezen, zoals een bewoner (typen en Enter).
    await page.evaluate(() => document.querySelector(".pv-laad-meer").click());
    assert.equal(await ver.locator(".pv-row-btn").getAttribute("aria-expanded"), "true");
    await page.locator("#agenda-street-jump").fill("2000");
    await page.locator("#pv-suggestions [role=option]").first().waitFor();
    await page.locator("#agenda-street-jump").press("Enter");
    await page.waitForFunction(() => new URL(location.href).searchParams.get("plek") === "2000", null, { timeout: 10000 });
    await page.locator(`.pv-results ${WORK_ROW}`).waitFor({ timeout: 15000 });
    await page.waitForFunction(() => Array.isArray((window.PUBLIC_AGENDA_LIVE_STREETS || {}).permits), null, { timeout: 15000 });
    await page.waitForTimeout(300);
    const telling = Number((await page.locator(".pv-sub").innerText()).match(/^(\d+) items/)?.[1]);
    assert.ok(telling > 150, `postcode 2000 heeft meer dan 150 kaartjes (${telling})`);
    assert.equal(await rijen(), 150);
    assert.equal(await ver.count(), 0);
    assert.match(await page.locator(".pv-laad-meer").innerText(), new RegExp(`^Toon de volgende \\d+ \\(nog ${telling - 150} in deze lijst\\)$`));
    // Wie verder scrolt, vindt het kaartje nog open terug.
    await page.evaluate(() => document.querySelector(".pv-laad-meer").click());
    assert.equal(await ver.locator(".pv-row-btn").getAttribute("aria-expanded"), "true");
    assert.deepEqual(errors, []);
    await context.close();
  });

  // Nakijkbevinding (gsm): "Toon op de kaart" scrolt naar de kaart onder de lijst. De knop "Toon de volgende" stond dan
  // net boven de kaart, de kijker tekende de volgende stap, en die schoof de kaart duizenden pixels uit beeld (in
  // postcode 2000: 28.500 px). En elke stap tekende de hele pagina opnieuw, met de kaart erbij.
  await t.test("gsm, een lijst van meer dan 150: 'Toon op de kaart' brengt de kaart in beeld; de volgende stap voegt alleen toe", async () => {
    const { page, context, errors } = await openPage(baseUrl, { street: PETERSELIE, feed: LANGE_FEED, query: "?plek=Peterseliestraat" });
    await wachtOpLagen(page);
    await wachtOpLijst(page, LANG + 2);
    const rijen = () => page.locator(".pv-results .pv-row").count();
    assert.equal(await rijen(), 150);
    const eerste = page.locator(".pv-results .pv-row").first();
    await eerste.locator(".pv-row-btn").click();
    await eerste.locator(".pv-op-kaart").click();
    const kaartStand = () => page.evaluate(() => {
      const r = document.querySelector("#buurtkaart .buurt-map").getBoundingClientRect();
      return { inBeeld: r.top < innerHeight && r.bottom > 0, top: Math.round(r.top), rijen: document.querySelectorAll(".pv-results .pv-row").length, focus: document.activeElement?.classList.contains("buurt-map") };
    });
    // Een paar keer kijken (de kijker meldt zich een frame later): de kaart blijft in beeld, met de focus, en de lijst
    // blijft 150; de knop staat er nog als gewone knop.
    for (let i = 0; i < 4; i += 1) {
      await page.waitForTimeout(400);
      const m = await kaartStand();
      assert.deepEqual({ inBeeld: m.inBeeld, rijen: m.rijen, focus: m.focus }, { inBeeld: true, rijen: 150, focus: true }, `na ${(i + 1) * 400} ms: ${JSON.stringify(m)}`);
    }
    assert.equal(await page.locator(".pv-laad-meer").count(), 1);
    // Wat niet verandert, gaat niet opnieuw naar de kaart: een andere periode toont dezelfde plek (de kaart toont
    // altijd alles), een soort uit wel.
    await page.evaluate(() => { window.__kaartItems = 0; window.addEventListener("public-agenda:kaart-items", () => { window.__kaartItems += 1; }); });
    // De volgende stap: alleen de nieuwe kaartjes erbij. Het eerste kaartje is hetzelfde element en staat nog open.
    await page.evaluate(() => { window.__eerste = document.querySelector(".pv-results .pv-row"); document.querySelector(".pv-laad-meer").click(); });
    assert.equal(await rijen(), LANG + 2);
    assert.equal(await page.locator(".pv-laad-meer").count(), 0);
    assert.equal(await page.evaluate(() => document.querySelector(".pv-results .pv-row") === window.__eerste), true, "het eerste kaartje is niet opnieuw getekend");
    assert.equal(await eerste.locator(".pv-row-btn").getAttribute("aria-expanded"), "true");
    assert.equal(await inSecties(page), LANG + 2);
    await wachtOpLijst(page, LANG + 2);
    await page.click('[data-period="kwartaal"]');
    await page.click('[data-period="alles"]');
    assert.equal(await rijen(), 150);
    assert.equal(await page.evaluate(() => window.__kaartItems), 0, "een andere periode stuurt de kaart niets nieuws");
    await page.click('.pv-groups [data-group="vergunningen"]');
    assert.ok(await page.evaluate(() => window.__kaartItems) > 0, "een soort uit: de kaart tekent opnieuw");
    assert.deepEqual(errors, []);
    await context.close();
  });

  // Nakijkbevinding: de zin volgde de gekozen soorten. Na een tik op de tegel "werken nu" (alleen werken
  // aan) zei hij "Rustig", terwijl er vandaag een evenement in de straat is.
  await t.test("de komende 7 dagen: na een tik op 'werken nu' blijft het evenement in de zin, met hetzelfde licht", async () => {
    const { page, context, errors } = await openPage(baseUrl, { street, query: plekQuery, agendaErbij: [proefAgendapunt(today, street)] });
    await page.locator(`.pv-results ${WORK_ROW}`).first().waitFor({ timeout: 15000 });
    await page.waitForFunction(() => !/nog geladen/.test(document.querySelector(".pv-dezeweek")?.textContent || ""), null, { timeout: 15000 });
    const week = page.locator(".pv-dezeweek");
    assert.match(await week.innerText(), WEEK_MET_FEEST);
    await page.locator('.pv-stats [data-only="werken"]').first().click();
    // Alleen werken staan nog aan: de tegel van de evenementen staat uit.
    await page.locator(".pv-stats .pv-stat-off.cat-festival").waitFor({ timeout: 5000 });
    assert.match(await week.innerText(), WEEK_MET_FEEST);
    assert.match(await week.getAttribute("class"), /\bpv-dezeweek-let-op\b/);
    assert.deepEqual(errors, []);
    await context.close();
  });

  // Nakijkbevinding: met ?soort=evenementen laden de werken niet. De zin mag dan nooit "Rustig" of "Geen werken"
  // zeggen, en zegt dat de werken niet geladen zijn.
  await t.test("de komende 7 dagen: met alleen evenementen zegt de zin dat de werken niet geladen zijn", async () => {
    const { page, context, errors } = await openPage(baseUrl, { street, query: `${plekQuery}&soort=evenementen`, agendaErbij: [proefAgendapunt(today, street)] });
    await page.waitForFunction(() => Array.isArray((window.PUBLIC_AGENDA_LIVE_STREETS || {}).publicSpace), null, { timeout: 20000 });
    await page.waitForFunction(() => !/nog geladen/.test(document.querySelector(".pv-dezeweek")?.textContent || ""), null, { timeout: 15000 });
    const week = page.locator(".pv-dezeweek");
    assert.equal(await page.evaluate(() => Array.isArray((window.PUBLIC_AGENDA_LIVE_STREETS || {}).works)), false, "de werken laden niet als ze uit staan");
    const tekst = await week.innerText();
    assert.match(tekst, WEEK_MET_FEEST);
    assert.match(tekst, /\. Werken zijn niet geladen\.$/);
    assert.doesNotMatch(tekst, /rustig|Geen werken/i);
    assert.deepEqual(errors, []);
    await context.close();
  });

  // Nakijkbevinding 9 (rest): zolang de evenementen op straat laden, zegt de zin dat (nooit "rustig"); en een
  // werkenlaag die deels mislukte terwijl werken uit staan, telde als volledig geladen. Sinds het besluit van 18-10-2026
  // ("niemand moet weten als er iets faalt") zegt de zin niet meer dat de werken maar deels laadden.
  await t.test("de komende 7 dagen: met alleen evenementen en een trage A-Sign 'nog geladen', en werken die deels mislukten verraden niets", async () => {
    let open;
    const poort = new Promise((klaar) => { open = klaar; });
    // A-Sign antwoordt pas als de toets de poort opent.
    const traag = { handle: async (route, url) => { await poort; return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(url.includes("returnIdsOnly") ? { objectIds: [] } : { features: [] }) }).catch(() => {}); } };
    const { page, context, errors } = await openPage(baseUrl, { street, asign: traag, query: `${plekQuery}&soort=evenementen`, agendaErbij: [proefAgendapunt(today, street)] });
    const week = page.locator(".pv-dezeweek");
    try {
      await page.waitForFunction(() => /evenementen op straat worden nog geladen/.test(document.querySelector(".pv-dezeweek")?.textContent || ""), null, { timeout: 15000 })
        .catch(async () => assert.fail(`terwijl A-Sign laadt, zegt de zin "${await week.innerText().catch(() => "")}"`));
      const wachtzin = await week.innerText();
      assert.match(wachtzin, /^Onbekend\s+De komende 7 dagen in jouw straat: evenementen op straat worden nog geladen…$/);
      assert.doesNotMatch(wachtzin, /rustig/i);
    } finally { open(); }
    await page.waitForFunction(() => Array.isArray((window.PUBLIC_AGENDA_LIVE_STREETS || {}).publicSpace), null, { timeout: 20000 });
    await page.waitForFunction(() => !/nog geladen/.test(document.querySelector(".pv-dezeweek")?.textContent || ""), null, { timeout: 15000 });
    assert.match(await week.innerText(), /\. Werken zijn niet geladen\.$/);
    // De werkenlaag laadt deels (zoals de lijst van het hele district die in beeld kwam en voor een deel mislukte),
    // terwijl werken uit staan: de zin noemt alleen wat gevonden is, zonder te zeggen dat iets niet laadde.
    await page.evaluate(() => {
      const live = window.PUBLIC_AGENDA_LIVE_STREETS;
      live.works = [];
      live.failed = { ...(live.failed || {}), works: ["werken"] };
      window.dispatchEvent(new CustomEvent("public-agenda:street-layer", { detail: { name: "works", items: [], failed: ["werken"] } }));
    });
    await page.waitForFunction(() => !/niet geladen/.test(document.querySelector(".pv-dezeweek")?.textContent || ""), null, { timeout: 5000 })
      .catch(async () => assert.fail(`na de deels mislukte werken zegt de zin "${await week.innerText()}"`));
    const tekst = await week.innerText();
    assert.match(tekst, WEEK_MET_FEEST);
    assert.doesNotMatch(tekst, /geladen|laadde|mislukt|lukte|onvolledig|rustig/i);
    assert.deepEqual(errors, []);
    await context.close();
  });

  // Herstelplan O1: de A-Sign-lagen faalden bij elke laadbeurt (URL's van 3.000 tot 4.800 tekens).
  // Het parkeerverbod: dat er een is, waar exact en wanneer, nooit waarom (besluit van de eigenaar van 18 oktober 2026,
  // site/adres-privacy.js; daarmee is vraag 1 beslist). Waar exact: live het huisnummer of het bereik zoals
  // publiekParkeerAdres het schrijft, nooit alleen de straat en de postcode. Wanneer: de dagen en de uren van A-Sign,
  // letterlijk. De verzonnen reden "Filmopname (e2e)" in A-Sign komt nergens op de pagina, ook niet op de buurtkaart.
  await t.test("A-Sign met duizenden ids: korte URL's, hoogstens 4 tegelijk, parkeerverbod met het huisnummerbereik, de dagen en de uren zonder reden, en terras in de straat", async () => {
    const [x1, y1, x2, y2] = straten.streets.find((r) => String(r[0]) === street.id && r[2] === street.postcode)[4];
    const [mx, my] = [(x1 + x2) / 2, (y1 + y2) / 2], d = 0.00004;
    const ms = (iso) => Date.parse(`${iso}T00:00:00Z`);
    // A-Sign bewaart een uur (Starttijd, Eindtijd) als een tijdstip op 30 december 1899.
    const uur = (hhmm) => Date.parse(`1899-12-30T${hhmm}:00Z`);
    const [van, tot] = [addDays(today, 2), addDays(today, 3)];
    // De straat is echt (de data kiest ze): daarom geen bestaand huisnummer naast de verzonnen reden, alleen 999 (met een
    // letter), zoals een echte straat in de toetsen (tests/historiek-privacy.test.mjs; nakijkronde van 18 oktober 2026: hier
    // stonden nog 990 tot 999). Hieronder nagekeken met dezelfde regel als de commitscan (lib/echte-adressen.mjs).
    const bronAdres = `${street.name} 999A-999C ${street.postcode} Antwerpen`;
    // Waar exact, letterlijk: het bereik "999A–999C" (met een en-dash) zoals publiekParkeerAdres het schrijft. Nooit de
    // terugval zonder huisnummer ("Straat, 2000 Antwerpen"), nooit een bus of de ruwe vorm van de bron.
    const PLAATS = `${street.name} 999A–999C, ${street.postcode} Antwerpen`;
    const ZONDER_NUMMER = `${street.name}, ${street.postcode} Antwerpen`;
    assert.equal(publiekParkeerAdres(bronAdres, adresZonderHuisnummer(bronAdres)), PLAATS, "de proef volgt de vorm van publiekParkeerAdres");
    // Wanneer, letterlijk: de eerste en de laatste dag en de uren van de fixture (8.00 tot 18.00 uur).
    const volleDag = (iso) => `${Number(iso.slice(8))} ${MAANDEN[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
    const WANNEER = `${volleDag(van)} – ${volleDag(tot)} · van 8.00 tot 18.00 uur`;
    // Eén parkeerverbod op vier plaatsen in de straat (één A-Sign-nummer, dezelfde dagen en uren; tweede nakijkronde van 18
    // oktober 2026: dat werd "Straat", zonder huisnummer). Dicht de eerste drie plaatsen exact, "Toon alle 4 plaatsen" alle.
    // Elk één huisnummer, zoals A-Sign het schrijft ("999B-999B"; publiekParkeerAdres maakt er "999B" van): 999 en 999
    // met een letter, vier verschillende plaatsen.
    const NUMMERS = ["999", "999B", "999D", "999F"];
    const VIER = NUMMERS.map((n) => `${street.name} ${n}, ${street.postcode} Antwerpen`);
    const vierVerboden = NUMMERS.map((n, i) => ({ id: 700200 + i, feature: { attributes: { Dossiernummer: "2026-999002", Locatienummer: String(i + 1), Status: "Goedgekeurd", Adres: `${street.name} ${n}-${n} ${street.postcode} Antwerpen`, Reden: REDEN_E2E, Startdatum: ms(van), Einddatum: ms(tot), Starttijd: uur("08:00"), Eindtijd: uur("18:00"), EnkelWeekdagen: 0, GipodID: null, District: "ANTWERPEN" }, geometry: { paths: [[[x1, y1], [x2, y2]]] } } }));
    // Met de lijn van het parkeerverbod langs de straat, zoals laag 20 die geeft: zo heeft het een plek op de buurtkaart.
    const laag20 = [{ id: 700123, feature: { attributes: { Dossiernummer: "2026-999001", Locatienummer: "1", Status: "Goedgekeurd", Adres: bronAdres, Reden: REDEN_E2E, Startdatum: ms(van), Einddatum: ms(tot), Starttijd: uur("08:00"), Eindtijd: uur("18:00"), EnkelWeekdagen: 0, GipodID: null, District: "ANTWERPEN" }, geometry: { paths: [[[x1, y1], [x2, y2]]] } } }, ...vierVerboden];
    // Elk adres in de fixture, en elke plaats die de toets verwacht: een echte straat met alleen 999-vormen.
    const echt = [...laag20.map((f) => f.feature.attributes.Adres), PLAATS, ...VIER].filter((a) => echteAdresStukken(a, ECHTE_STRATEN).length);
    assert.deepEqual(echt.length, 0, "een echte straat krijgt in deze toets alleen huisnummer 999 (met een letter)");
    const asign = asignServer({ fixtures: {
      20: laag20,
      49: [{ id: 1234, feature: { attributes: { OBJECTID: 1234, ROLnet_ID: "E2E-1", TypeTerrasZone: "Terraszone (e2e)", Status: "Actief", adres: street.name, postcode: Number(street.postcode) }, geometry: { rings: [[[mx - d, my - d], [mx + d, my - d], [mx + d, my + d], [mx - d, my + d], [mx - d, my - d]]] } } }],
    } });
    const query = `?plek=${encodeURIComponent(street.name)}${byName.get(locationKey(street.name)).length > 1 ? `%20${street.postcode}` : ""}`;
    const { page, context, errors, geodataFouten } = await openPage(baseUrl, { width: 1280, height: 900, street, asign, query });
    // Wachten tot beide lagen binnen zijn of tot de pagina stilvalt (op de oude code laadt het terras nooit).
    await page.waitForFunction(() => { const l = window.PUBLIC_AGENDA_LIVE_STREETS || {}; return Array.isArray(l.publicSpace) && (Array.isArray(l.terraces) || l.failed?.terraces?.length); }, null, { timeout: 20000 }).catch(() => {});
    assert.equal(asign.stats.teLang, 0, `geen URL boven 2.000 tekens (langste: ${Math.max(...asign.stats.urls)})`);
    assert.deepEqual(geodataFouten, [], "geen mislukte verzoeken naar geodata.antwerpen.be");
    assert.ok(Math.max(...asign.stats.urls) < 1800, `langste URL ${Math.max(...asign.stats.urls)}`);
    assert.ok(asign.stats.maxBezig <= 4, `${asign.stats.maxBezig} verzoeken tegelijk`);
    assert.ok(asign.stats.urls.length > 120, `${asign.stats.urls.length} verzoeken: alle blokken opgevraagd`);
    // De rij op haar A-Sign-nummer (de reden staat er niet in, dus daarop zoeken kan niet meer).
    const parkeer = page.locator('.pv-results .pv-row[data-uid^="publicSpace:parking:2026-999001"]').first();
    await parkeer.waitFor({ timeout: 15000 });
    const dichtTekst = await parkeer.innerText();
    // Wat: de titel is "Parkeerverbod", niets meer.
    assert.equal((await parkeer.locator(".pv-row-title").innerText()).trim(), "Parkeerverbod");
    // Al in de dichte rij: waar exact (met het bereik) en de uren.
    assert.equal((await parkeer.locator(".pv-row-where").innerText()).trim(), PLAATS, "de dichte rij toont het huisnummerbereik");
    assert.equal((await parkeer.locator(".pv-row-summary:not(.pv-bronnoot)").innerText()).trim(), "Niet parkeren van 8.00 tot 18.00 uur.");
    // Opengeklapt: "Wanneer" is letterlijk de dagen en de uren, "Waar" letterlijk de plaats met het bereik.
    await parkeer.locator(".pv-row-btn").click();
    await parkeer.locator(".pv-tech summary").waitFor();
    const regel = (naam) => parkeer.evaluate((el, n) => [...el.querySelectorAll(".pv-detail dt")].filter((dt) => dt.textContent.trim() === n).map((dt) => (dt.nextElementSibling?.textContent || "").trim()), naam);
    assert.deepEqual(await regel("Wanneer"), [WANNEER], "de dagen en de uren van het parkeerverbod");
    assert.deepEqual(await regel("Waar"), [PLAATS], "de plaats met het huisnummerbereik");
    // Elke regel met de straat, dicht en open, is die plaats: geen terugval zonder huisnummer, geen bus, geen bronvorm.
    const openTekst = await parkeer.innerText();
    for (const [stand, tekst, minstens] of [["dicht", dichtTekst, 1], ["open", openTekst, 2]]) {
      const adresRegels = tekst.split("\n").map((r) => r.trim()).filter((r) => r.includes(street.name));
      assert.ok(adresRegels.length >= minstens, `${stand}: ${adresRegels.length} regels met de straat: ${JSON.stringify(tekst)}`);
      for (const r of adresRegels) assert.equal(r, PLAATS, `${stand}: "${r}" is niet de plaats met het huisnummerbereik`);
      assert.equal(tekst.includes(ZONDER_NUMMER), false, `${stand}: de terugval zonder huisnummer ("${ZONDER_NUMMER}")`);
      assert.doesNotMatch(tekst, /\bbus\b|999A\s*-\s*999C/i, `${stand}: geen bus en nooit het adres zoals de bron het schrijft`);
      assert.doesNotMatch(tekst, /Parkeerverbod: /);
    }
    assert.equal(await parkeer.locator(".pv-tech").evaluate((el) => el.open), false, "technische details dicht");
    await parkeer.locator(".pv-tech summary").click();
    // Alles van de rij (ook wat ingeklapt is, textContent) en alles op de pagina: geen reden, geen "voor een ...". Ook elk
    // attribuut, met zijn naam, van de rij zelf (li.pv-row) en van elk element erin: title, aria-*, alt, href, data-* ...
    // (nakijkronde van 18 oktober 2026: een title met de reden op de rij zelf viel door de mand, en data-* werd niet gelezen).
    const rijAlles = await parkeer.evaluate((el) => `${el.textContent}\n${[el, ...el.querySelectorAll("*")].map((x) => [...x.attributes].map((a) => `${a.name}="${a.value}"`).join(" ")).join("\n")}`);
    assert.match(rijAlles, /data-uid="publicSpace:parking:2026-999001/, "de attributen van de rij zelf tellen mee");
    assert.doesNotMatch(rijAlles, VERRAAD_E2E, `de reden staat in de rij: ${JSON.stringify(rijAlles)}`);
    assert.doesNotMatch(rijAlles, /Parkeerverbod (?:voor|met)\b|Parkeerverbod,|[Rr]eden|waarvoor/, `een reden of een zin erover in de rij: ${JSON.stringify(rijAlles)}`);
    assert.doesNotMatch(await page.evaluate(() => document.body.textContent), VERRAAD_E2E, "de reden staat ergens op de pagina");
    const paginaAttributen = await page.evaluate(() => [...document.querySelectorAll("*")].map((x) => [...x.attributes].map((a) => `${a.name}="${a.value}"`).join(" ")).join("\n"));
    assert.doesNotMatch(paginaAttributen, VERRAAD_E2E, "de reden staat in een attribuut ergens op de pagina");
    // De buurtkaart (site/kaart-lagen.js): het parkeerverbod staat er bij benadering (een afgerond punt, privacy) en
    // nooit exact; de popup zegt dat ("Plek bij benadering"), met de plaats exact in de tekst. Geen tekst noemt de reden.
    await page.waitForFunction((uid) => (window.PUBLIC_AGENDA_KAART?.teken || []).some((e) => String(e?.uid || "").startsWith(uid)), "publicSpace:parking:2026-999001", { timeout: 10000 });
    const kaart = await page.evaluate(async ({ uid, vandaag }) => {
      const { kaartLagen, popupHtml } = await import("/kaart-lagen.js");
      const e = window.PUBLIC_AGENDA_KAART.teken.find((x) => String(x?.uid || "").startsWith(uid));
      const { fc, ongeveer } = kaartLagen([e]);
      const pop = document.createElement("div");
      pop.innerHTML = popupHtml([e], vandaag);
      return { exact: fc.features.filter((f) => !f.properties.ongeveer).length, ongeveer: ongeveer.filter((g) => g.uids.includes(e.uid)).length, tekst: pop.textContent };
    }, { uid: "publicSpace:parking:2026-999001", vandaag: today });
    assert.deepEqual([kaart.exact, kaart.ongeveer], [0, 1], "op de buurtkaart één plek bij benadering, nooit de lijn zelf");
    assert.match(kaart.tekst, /Plek bij benadering \(privacy\)/);
    assert.ok(kaart.tekst.includes(PLAATS), `de popup noemt de plaats exact: ${JSON.stringify(kaart.tekst)}`);
    // Wanneer, ook in de popup: de dagen met de uren zoals de kaart ze zegt (nakijkronde van 18 oktober 2026: de popup
    // zei bij meer dagen geen uren, bij één dag alleen "08.00").
    assert.match(kaart.tekst, / · van 8\.00 tot 18\.00 uur · /, `de popup noemt de uren: ${JSON.stringify(kaart.tekst)}`);
    assert.doesNotMatch(kaart.tekst, VERRAAD_E2E, `de reden staat in de popup: ${JSON.stringify(kaart.tekst)}`);
    assert.doesNotMatch(kaart.tekst, /Parkeerverbod (?:voor|met)\b|[Rr]eden|waarvoor/, `een reden of een zin erover in de popup: ${JSON.stringify(kaart.tekst)}`);
    // Het parkeerverbod op vier plaatsen: dicht en bij "Waar" de eerste drie plaatsen exact, en "Toon alle 4 plaatsen" elke
    // plaats exact, één per regel. Nooit alleen de straatnaam, nooit "andere straten", nooit de reden.
    const vier = page.locator('.pv-results .pv-row[data-uid^="publicSpace:parking:2026-999002"]').first();
    await vier.waitFor({ timeout: 15000 });
    const KORT = `${VIER[0]}; ${VIER[1]} en ${VIER[2]} + 1 andere plaats`;
    assert.equal((await vier.locator(".pv-row-where").innerText()).trim(), KORT, "de dichte rij noemt de plaatsen exact");
    await vier.locator(".pv-row-btn").click();
    const waarVier = await vier.evaluate((el) => {
      const dd = [...el.querySelectorAll(".pv-detail dt")].find((dt) => dt.textContent.trim() === "Waar")?.nextElementSibling;
      const details = dd?.querySelector("details.pv-streets");
      if (details) details.open = true;
      return { eerst: dd?.firstChild?.textContent?.trim() || "", summary: details?.querySelector("summary")?.textContent.trim() || "", lijst: details ? details.querySelector("p").innerText.split("\n").map((r) => r.trim()).filter(Boolean) : [] };
    });
    assert.equal(waarVier.eerst, KORT);
    assert.equal(waarVier.summary, "Toon alle 4 plaatsen");
    assert.deepEqual(waarVier.lijst, VIER, "elke plaats exact in de lijst");
    const vierAlles = await vier.evaluate((el) => el.textContent);
    assert.doesNotMatch(vierAlles, /andere straten|Toon alle \d+ straten/);
    assert.doesNotMatch(vierAlles, VERRAAD_E2E);
    await page.locator(".pv-results .pv-row", { hasText: "Terraszone (e2e)" }).first().waitFor({ timeout: 15000 });
    assert.equal(await page.locator(".pv-place-failed").count(), 0);
    assert.deepEqual(errors, []);
    await context.close();
  });

  // Nakijkronde van 13 oktober 2026 (vaag-eind), nagespeeld in de browser: een parkeerverbod voor een werf hing aan een
  // werfzone zonder doel en verdween in de ingeklapte regel "werfzones zonder doel"; de weekzin telde het niet en de kop
  // zei nergens "Niet parkeren". En een inname zonder omschrijving in de bundel zei niet dat de uren niet in het
  // evenementendossier staan. Verzonnen werfzones, parkeerverboden en dossiers in de Peterseliestraat.
  await t.test("nakijkronde: een werfzone met parkeerverboden staat los, met 'Niet parkeren' in de kop en de weekzin; een inname in een bundel zegt wat niet in het dossier staat", async () => {
    const peterselie = { id: "2289", name: "Peterseliestraat", postcode: "2000" };
    const [x1, y1, x2, y2] = straten.streets.find((r) => String(r[0]) === peterselie.id && r[2] === peterselie.postcode)[4];
    const d = 0.0002, [mx, my] = [(x1 + x2) / 2, (y1 + y2) / 2];
    const vlak = { rings: [[[x1 - d, y1 - d], [x2 + d, y1 - d], [x2 + d, y2 + d], [x1 - d, y2 + d], [x1 - d, y1 - d]]] };
    const ms = (iso) => Date.parse(`${iso}T00:00:00Z`);
    const UUR = (u) => Date.parse(`1970-01-01T${u}:00Z`);
    const [nu, eindFase1, beginFase2, eindFase2] = [addDays(today, -5), addDays(today, 20), addDays(today, 21), addDays(today, 60)];
    const zone = (id, dossier, fase, van, tot) => ({ id, feature: { attributes: { OBJECTID: id, reference_id: dossier, phase_id: fase, status: "vergund", StartDate: ms(van), EndDate: ms(tot) }, geometry: vlak } });
    const verbod = (id, dossier, van, tot) => ({ id, feature: { attributes: { OBJECTID: id, Dossiernummer: dossier, Locatienummer: "1", Status: "Goedgekeurd", Adres: `${peterselie.name}, ${peterselie.postcode} Antwerpen`, Postcode: peterselie.postcode, Reden: "Melding ikv werfsignalisaties", Startdatum: ms(van), Einddatum: ms(tot), Starttijd: UUR("07:00"), Eindtijd: UUR("17:00"), EnkelWeekdagen: 0, GipodID: null, District: "ANTWERPEN" }, geometry: { paths: [[[x1, y1], [x2, y2]]] } } });
    const inname = (id, dossier, dag) => ({ id, feature: { attributes: { dossierNummer: dossier, faseId: "F1", innameId: `I${id}`, dossierStatus: "aanvraag_goedgekeurd", faseNaam: "Evenement", type_dossier: "ETL", innameTypeNaam: "Inname", innameBeschrijving: "", innameHinder: "False", faseStartDatum: Date.parse(`${dag}T08:00:00Z`), faseEindDatum: Date.parse(`${dag}T08:00:00Z`) }, geometry: { rings: [[[mx - 0.00004, my - 0.00004], [mx + 0.00004, my - 0.00004], [mx + 0.00004, my + 0.00004], [mx - 0.00004, my + 0.00004], [mx - 0.00004, my - 0.00004]]] } } });
    const asign = asignServer({ fixtures: {
      48: [zone(990881, "GW2099-000881", "P1", nu, eindFase1), zone(990882, "GW2099-000881", "P2", beginFase2, eindFase2), zone(990883, "GW2099-000882", "P1", nu, addDays(today, 90)), zone(990884, "GW2099-000883", "P1", addDays(today, 1), addDays(today, 40))],
      20: [verbod(990881, "2099-000881", nu, eindFase1), verbod(990882, "2099-000882", beginFase2, eindFase2)],
      23: [inname(990891, "ET2099000891", addDays(today, 8)), inname(990892, "ET2099000892", addDays(today, 15))],
    } });
    const { page, context, errors } = await openPage(baseUrl, { street: peterselie, feed: proefFeed(today, []), asign, work: false, aanvraag: false, query: "?plek=Peterseliestraat" });
    const werfzone = page.locator('.pv-results .pv-row[data-uid^="publicSpace:sgw:GW2099-000881"]').first();
    await werfzone.waitFor({ timeout: 20000 });
    await page.locator('.pv-results .pv-row.pv-bundel', { hasText: /innames? zonder omschrijving/ }).first().waitFor({ timeout: 20000 });
    // (1) Los, niet in een bundel, met de uren en de laatste dag van het lopende parkeerverbod in de kop.
    assert.equal(await werfzone.evaluate((el) => Boolean(el.closest(".pv-bundel"))), false, "de werfzone met een parkeerverbod staat niet in een bundel");
    // De samenvatting zelf, niet de bronnoot eronder (die heeft dezelfde klasse, #173).
    const kop = await werfzone.locator(".pv-row-summary:not(.pv-bronnoot)").innerText();
    assert.match(kop, new RegExp(`Niet parkeren van 7\\.00 tot 17\\.00 uur, t/m ${Number(eindFase1.slice(8))} \\S+ \\(A-Sign, 2099-000881\\)`), kop);
    // De werfzones zonder parkeerverbod blijven samen ingeklapt.
    assert.equal(await page.locator(".pv-results .pv-row.pv-bundel", { hasText: "2 werfzones of omleidingen zonder doel in de bron" }).count(), 1);
    // (2) De weekzin telt het lopende parkeerverbod.
    await page.waitForFunction(() => /parkeerverbod/.test(document.querySelector(".pv-dezeweek")?.textContent || ""), null, { timeout: 10000 }).catch(() => {});
    assert.match(await page.locator(".pv-dezeweek").innerText(), /1 parkeerverbod \(loopt al\)/);
    // (3) Het parkeerverbod van de tweede fase staat op zijn eerste dag, met de werf erbij.
    const later = page.locator(`.pv-results section[data-sectie="d:${beginFase2}"] .pv-row[data-uid^="publicSpace:parking:2099-000882"]`);
    assert.equal(await later.count(), 1, "het begin van de tweede fase staat in zijn dagsectie");
    // De titel blijft "Parkeerverbod" (nooit waarvoor, besluit van 18 oktober 2026); de werf staat in de zin.
    assert.equal((await later.locator(".pv-row-title").innerText()).trim(), "Parkeerverbod");
    assert.match(await later.innerText(), /Zelfde straat en dagen als een fase van “Werfzone” \(dossier GW2099-000881\)/);
    // De reden van A-Sign ("Melding ikv werfsignalisaties") hangt het parkeerverbod aan de werfzone, maar staat nergens op
    // de kaarten, ook niet ingeklapt (textContent). (De uitleg van de werkenlaag noemt de A-Sign-laag "werfsignalisatie"
    // van de werken; die gaat niet over een parkeerverbod.)
    for (const rij of [later, werfzone]) assert.doesNotMatch(await rij.evaluate((el) => el.textContent), /werfsignal|\bikv\b|in het kader van|[Rr]eden|Parkeerverbod voor/);
    // (4) De inname in de bundel: de sectie zegt dat evenementendossiers geen uren hebben, de kaart wat niet in het dossier staat.
    const sectie = page.locator('.pv-results section[data-sectie="zonder-omschrijving"]');
    assert.match(await sectie.locator(".pv-sectie-onbekend").innerText(), /Evenementendossiers van de stad \(A-Sign\) hebben geen uren/);
    const bundel = sectie.locator(".pv-row.pv-bundel", { hasText: /innames? zonder omschrijving/ }).first();
    await bundel.locator(".pv-row-btn").first().click();
    const lid = bundel.locator('.pv-row[data-uid="publicSpace:dossier:ET2099000891"]');
    await lid.waitFor({ timeout: 10000 });
    await lid.locator(".pv-row-btn").click();
    assert.match(await lid.innerText(), /Niet in het evenementendossier ET2099000891 \(A-Sign\):\s*wat er gebeurt en de naam \(geen omschrijving die dat zegt\) · uren \(A-Sign geeft alleen de dag\) · organisator\./);
    assert.deepEqual(errors, []);
    await context.close();
  });

  // Besluit van de eigenaar (18-10-2026): "niemand moet weten als er iets faalt, de momentopname blijft wel goed".
  // Vroeger stond er bovenaan en in de lege staat "… konden nu niet geladen worden. Dit overzicht is onvolledig."
  await t.test("een A-Sign-laag laadt niet: geen melding bovenaan of in de lege staat, en geen 'niets op de agenda'", async () => {
    const peterselie = { id: "2289", name: "Peterseliestraat", postcode: "2000" };
    const asign = asignServer({ fail: [20, 47, 49] });
    // Een verzonnen feed zonder agendapunten: de toets verwacht een lege straat, los van de echte feed.
    const { page, context, errors } = await openPage(baseUrl, { street: peterselie, feed: proefFeed(today, []), asign, work: false, aanvraag: false, query: "?plek=Peterseliestraat" });
    // De plek tekent opnieuw bij het volgende beeld; wacht tot alle lagen er zijn (intern: welke onderdelen faalden).
    await page.waitForFunction(() => {
      const f = (window.PUBLIC_AGENDA_LIVE_STREETS || {}).failed || {};
      return (f.publicSpace || []).includes("parkeerverboden") && (f.publicSpace || []).includes("omleidingen") && (f.terraces || []).includes("terrassen");
    }, null, { timeout: 20000 });
    const leeg = page.locator(".pv-results .pv-empty");
    await leeg.waitFor();
    await page.waitForFunction(() => /Voor deze straat is niets gevonden\./.test(document.querySelector(".pv-results .pv-empty")?.innerText || ""), null, { timeout: 10000 })
      .catch(async () => assert.fail(`de lege staat zegt "${await leeg.innerText()}"`));
    const tekst = await leeg.innerText();
    assert.match(tekst, /Niets gevonden in Peterseliestraat/);
    // Een laag laadde niet: niet beweren dat er niets op de agenda staat, en ook niet zeggen dat iets niet laadde.
    assert.doesNotMatch(tekst, /Er staat niets op de agenda/);
    assert.doesNotMatch(tekst, /geladen|laadde|onvolledig|mislukt|lukte|⚠️/);
    assert.doesNotMatch(tekst, /gekozen soorten/);
    assert.equal(await page.locator(".pv-place-failed, .pv-empty-warn").count(), 0, "geen melding bovenaan of in de lege staat");
    const plek = await page.locator(".pv-place").innerText();
    assert.doesNotMatch(plek, /konden nu niet|onvolledig|niet geladen|lukte nu niet|kon nu niet/, plek);
    // De weekzin: nooit "rustig" als een laag niet laadde, en geen reden. Er is geen stand van de ochtend (geen
    // straatbestanden) en live faalde: geen betrouwbare stand, dus geen weekzin, ook geen "Onbekend … niets gevonden."
    // (nakijkronde 3, bevinding MIDDEL: dat label verraadde dat een laag faalde).
    assert.equal(await page.locator(".pv-dezeweek").count(), 0, await page.locator(".pv-place").innerText());
    assert.doesNotMatch(plek, /Onbekend|niets gevonden|rustig/i, plek);
    assert.deepEqual(errors, []);
    await context.close();
  });
  // Nakijkronde 2 (18-10-2026), Chromium op 1280 en 390 px: faalde een bron, dan toonden de lijsten van het district een
  // verzonnen 0 ("0 maatregelen", "0 parkeerverboden · 0 innames · 0 werfzones/omleidingen", "0 met gekoppelde hinder ·
  // 0 met A-Sign supplement · 0 met AWV-werfdata") en zei de A-Sign-lijst "A-Sign, geladen …". En een laag die niet laadde,
  // "laadde" eeuwig: "werken en hinder worden geladen…" onder de kaart, "Live werken en maatregelen worden nog
  // opgehaald." en "0 straten met actuele of geplande informatie" bij "Alles per straat".
  const lijstTekst = (page) => page.evaluate(() => {
    const t = (sel) => (document.querySelector(sel)?.textContent || "").trim();
    return {
      space: [t("#public-space-live [data-space-count]"), t("#public-space-live [data-space-meta]"), t("#public-space-live [data-space-note]")],
      works: [t("#works-live [data-works-count]"), t("#works-live [data-works-meta]"), t("#works-live [data-works-note]")],
      straat: [t("#street-overview [data-street-summary]"), t("#street-overview [data-street-note]")],
      radar: t("#street-overview .district-radar-stats"),
      straatVerborgen: Boolean(document.querySelector("#street-overview")?.hidden),
    };
  });
  const lijstenInBeeld = async (page) => {
    await page.click(".pv-more > summary");
    for (const sel of ["#street-overview", "#works-live", "#public-space-live"]) await page.locator(sel).scrollIntoViewIfNeeded().catch(() => {});
  };
  const wachtOpMislukt = (page, lagen) => page.waitForFunction((l) => l.every((naam) => ((window.PUBLIC_AGENDA_LIVE_STREETS || {}).failed?.[naam] || []).length), lagen, { timeout: 20000 });
  await t.test("een bron faalt: de lijsten van het district tonen geen verzonnen 0 en geen 'geladen', en niets 'laadt' eeuwig (1280 en 390 px)", async () => {
    const LAADT = /worden geladen…|worden nog opgehaald|wordt geladen/;
    for (const [width, height] of [[1280, 900], [390, 844]]) {
      for (const [naam, plat] of [["alles plat", ["alles"]], ["GIPOD en A-Sign plat, straatas en grens werken", ["gipod", "asign"]]]) {
        const wat = `${naam}, ${width} px`;
        const { page, context, errors } = await openPage(baseUrl, { width, height, plat, aanvraag: false, feed: proefFeed(today, []) });
        await lijstenInBeeld(page);
        await wachtOpMislukt(page, ["works", "publicSpace"]);
        if (!plat.includes("alles")) await page.waitForFunction(() => /^Gebundeld|^Straatas geladen/.test(document.querySelector("#street-overview [data-street-note]")?.textContent || ""), null, { timeout: 15000 });
        await page.waitForTimeout(300);
        const tekst = await lijstTekst(page);
        t.diagnostic(`${wat}: ${JSON.stringify(tekst)}`);
        // Geen enkele A-Sign-laag laadde en GIPOD niet: de lijsten zijn leeg, zonder 0, zonder "geladen" en zonder notitie.
        assert.deepEqual(tekst.space, ["", "", ""], `${wat}: publieke ruimte`);
        assert.deepEqual(tekst.works, ["", "", ""], `${wat}: werken`);
        if (plat.includes("alles")) assert.equal(tekst.straatVerborgen, true, `${wat}: zonder straatas valt "Alles per straat" weg`);
        else {
          // De straatas laadde: geen "worden nog opgehaald", geen "0 straten" en geen "0 straten met ernstige hinder".
          assert.equal(tekst.straat[0], "", `${wat}: ${tekst.straat[0]}`);
          assert.doesNotMatch(tekst.straat[1], LAADT, wat);
          assert.match(tekst.radar, /—straten met ernstige hinder/, wat);
        }
        assert.deepEqual(errors, [], wat);
        await context.close();
      }
      // Een postcode met alle soorten aan (ook werken): de zin onder de kaart blijft niet op "worden geladen…" staan.
      const { page, context, errors } = await openPage(baseUrl, { width, height, plat: ["alles"], query: "?plek=2000" });
      await page.locator(".buurt-status").waitFor({ timeout: 15000 });
      await wachtOpMislukt(page, ["works", "publicSpace"]);
      await page.waitForFunction(() => !/worden geladen/.test(document.querySelector(".buurt-status")?.textContent || ""), null, { timeout: 5000 })
        .catch(async () => assert.fail(`${width} px: de kaart zegt "${await page.locator(".buurt-status").textContent()}"`));
      const zin = await page.locator(".buurt-status").textContent();
      assert.match(zin, /in de lijst/, zin);
      assert.doesNotMatch(zin, /\b0 werken|geladen|laadt|faalt|mislukt/, zin);
      assert.deepEqual(errors, [], `?plek=2000, ${width} px`);
      await context.close();
    }
    // De werkenlijst met HINDER_PUNT, A-Sign en de AWV-werfdata plat (GIPOD zelf werkt): de aanvullingen tellen niet als 0.
    const { page, context, errors } = await openPage(baseUrl, { width: 1280, height: 900, plat: ["hinder", "asign", "awv"], aanvraag: false, feed: proefFeed(today, []), query: "?soort=werken" });
    await lijstenInBeeld(page);
    await page.waitForFunction(() => /^Live GIPOD/.test(document.querySelector("#works-live [data-works-note]")?.textContent || ""), null, { timeout: 20000 });
    const { works } = await lijstTekst(page);
    t.diagnostic(`werkenlijst, aanvullingen plat: ${JSON.stringify(works)}`);
    assert.equal(works[0], "1 werken");
    assert.match(works[1], /^0 in uitvoering · 1 gepland · /);
    assert.doesNotMatch(works[1], /met gekoppelde hinder|met A-Sign supplement|met AWV-werfdata/, works[1]);
    assert.doesNotMatch(works.join(" "), /geladen|faalt|mislukt|niet beschikbaar/, works.join(" "));
    assert.deepEqual(errors, []);
    await context.close();
  });

  // Nakijkronde 3 (18-10-2026), Chromium 390×844 op /?plek=Kammenstraat met alles buiten de site plat: de chip
  // "Werken & verkeer 0", de tegel "0 vergunningen" en in de ingeklapte "Volledige vooruitblik" "0 werken starten · 0
  // eindigen · 0 maatregelen starten · 0 werken met ernstige hinder". Met alle lagen gezond maar leeg stonden er precies
  // dezelfde getallen; de melding die vroeger ernaast stond, is weg (besluit van 18-10-2026). Nu: geen getal op de chip en
  // een streepje op de tegel en in de vooruitblik. Een echte 0 blijft.
  const tellers = (page) => page.evaluate(() => {
    const t = (el) => (el?.textContent || "").replace(/\s+/g, " ").trim();
    const chip = (g) => t(document.querySelector(`.pv-chip[data-group="${g}"] .pv-chip-n`));
    const tegels = (g) => [...document.querySelectorAll(`.pv-stat button[data-only="${g}"] strong`)].map(t);
    return {
      chips: { werken: chip("werken"), vergunningen: chip("vergunningen") },
      tegels: { werken: tegels("werken"), vergunningen: tegels("vergunningen") },
      vooruitblik: [...document.querySelectorAll("#week-pulse .week-pulse-stats a")].map((a) => [t(a.querySelector("strong")), t(a.querySelector("small"))]),
    };
  });
  await t.test("een bron faalt op de plekpagina: geen verzonnen 0 op de chip 'Werken & verkeer', de tegel vergunningen en in de vooruitblik; een echte 0 blijft (390 en 1280 px)", async () => {
    const LAGEN = ["works", "publicSpace", "permits", "terraces"];
    for (const [width, height] of [[390, 844], [1280, 900]]) {
      for (const [naam, plat] of [["alles plat", ["alles"]], ["alles gezond en leeg", []]]) {
        const wat = `${naam}, ${width} px`;
        const { page, context, errors } = await openPage(baseUrl, { width, height, plat, work: false, aanvraag: false, feed: proefFeed(today, []), query: "?plek=Kammenstraat" });
        if (plat.length) {
          await wachtOpMislukt(page, ["works", "publicSpace", "terraces"]);
          await page.waitForFunction(() => ((window.PUBLIC_AGENDA_LIVE_STREETS || {}).failed?.permits || []).length, null, { timeout: 15000 }).catch(() => {});
        } else {
          await page.waitForFunction((l) => l.every((n) => Array.isArray((window.PUBLIC_AGENDA_LIVE_STREETS || {})[n])), LAGEN, { timeout: 20000 });
        }
        await page.waitForTimeout(300);
        const uit = await tellers(page);
        t.diagnostic(`${wat}: ${JSON.stringify(uit)}`);
        if (plat.length) {
          assert.deepEqual(uit.chips, { werken: "", vergunningen: "" }, `${wat}: chips`);
          assert.deepEqual(uit.tegels, { werken: ["–", "–"], vergunningen: ["–"] }, `${wat}: tegels`);
          assert.deepEqual(uit.vooruitblik, [["0", ""], ["–", "– eindigen"], ["–", ""], ["–", ""]], `${wat}: vooruitblik`);
        } else {
          assert.deepEqual(uit.chips, { werken: "0", vergunningen: "0" }, `${wat}: chips`);
          assert.deepEqual(uit.tegels, { werken: ["0", "0"], vergunningen: ["0"] }, `${wat}: tegels`);
          assert.deepEqual(uit.vooruitblik, [["0", ""], ["0", "0 eindigen"], ["0", ""], ["0", ""]], `${wat}: vooruitblik`);
        }
        assert.doesNotMatch(await leesbareTekst(page), /konden nu niet geladen|tijdelijk niet geladen|Bron tijdelijk niet beschikbaar|onvolledig/, wat);
        assert.deepEqual(errors, [], wat);
        await context.close();
      }
    }
    // De voorpagina (zonder plek): de vooruitblik zodra de lijsten van het district laden en niet lukken.
    const { page, context, errors } = await openPage(baseUrl, { width: 1280, height: 900, plat: ["alles"], aanvraag: false, feed: proefFeed(today, []) });
    await lijstenInBeeld(page);
    await wachtOpMislukt(page, ["works", "publicSpace"]);
    await page.waitForTimeout(300);
    const { vooruitblik } = await tellers(page);
    t.diagnostic(`voorpagina, alles plat: ${JSON.stringify(vooruitblik)}`);
    assert.deepEqual(vooruitblik, [["0", ""], ["–", "– eindigen"], ["–", ""], ["–", ""]], "voorpagina: vooruitblik");
    assert.deepEqual(errors, [], "voorpagina");
    await context.close();
  });

  // Herstelplan O2: de knoppen +250 m tot +1 km toonden nooit een parcours of een vergunning (die hebben
  // geen eigen punt). Nu telt een item mee als zijn eigen vorm binnen de straal ligt. Nakijkbevinding 3:
  // niet zijn straat; een vergunning 900 m verder op een lange straat die tot 200 m komt, blijft weg.
  await t.test("straal zonder punt: parcours en vergunning in een straat 250 m verder", async () => {
    const peterselie = { id: "2289", name: "Peterseliestraat", postcode: "2000" };
    const huik = straten.streets.find((r) => r[1] === "Huikstraat" && r[2] === "2000");
    const [hx1, hy1, hx2, hy2] = huik[4];
    // Een verzonnen lange straat: begint 200 m ten oosten van de Peterseliestraat en loopt 1,5 km door.
    const [px1, py1, px2, py2] = straten.streets.find((r) => r[1] === "Peterseliestraat" && r[2] === "2000")[4];
    const oost = Math.max(px1, px2), pm = (py1 + py2) / 2, opM = (meter) => meter / 69760;
    const lang = [[oost + opM(200), pm], [oost + opM(1700), pm]];
    const assen = [
      { type: "Feature", geometry: { type: "LineString", coordinates: [[hx1, hy1], [hx2, hy2]] }, properties: { LSTRNMID: Number(huik[0]), LSTRNM: "Huikstraat", RSTRNMID: Number(huik[0]), RSTRNM: "Huikstraat", postcode: 2000, DISTRICT: "Antwerpen" } },
      { type: "Feature", geometry: { type: "LineString", coordinates: lang }, properties: { LSTRNMID: 99999001, LSTRNM: "Proeflaan", RSTRNMID: 99999001, RSTRNM: "Proeflaan", postcode: 2000, DISTRICT: "Antwerpen" } },
    ];
    // Een parcours van 12 m breed over de as van de Huikstraat, en een perceel ernaast (verzonnen).
    const lengte = Math.hypot((hx2 - hx1) * 69760, (hy2 - hy1) * 110540);
    const nx = (-(hy2 - hy1) * 110540 / lengte) * (6 / 69760), ny = ((hx2 - hx1) * 69760 / lengte) * (6 / 110540);
    const vlak = [[hx1 + nx, hy1 + ny], [hx2 + nx, hy2 + ny], [hx2 - nx, hy2 - ny], [hx1 - nx, hy1 - ny], [hx1 + nx, hy1 + ny]];
    const ms = (iso) => Date.parse(`${iso}T08:00:00Z`);
    const dag = addDays(today, 3);
    const asign = asignServer({ fixtures: { 22: [{ id: 990001, feature: { attributes: { dossierNummer: "ET2099000001", faseId: "F1", innameId: "I1", dossierStatus: "aanvraag_goedgekeurd", faseNaam: "Evenement", type_dossier: "ETL", innameTypeNaam: "Parcours", innameHinder: "True", faseStartDatum: ms(dag), faseEindDatum: ms(dag) }, geometry: { rings: [vlak] } } }] } });
    const [mx, my] = [(hx1 + hx2) / 2 + nx * 2.5, (hy1 + hy2) / 2 + ny * 2.5], d = 0.00004;
    const perceel = (x, y) => ({ rings: [[[x - d, y - d], [x + d, y - d], [x + d, y + d], [x - d, y + d], [x - d, y - d]]] });
    const maakVergunning = (nr, geometry) => ({ attributes: { DOSSIERTYPE: "Omgevingsvergunning", Dossiernummer: nr, AardAanvraag: "", Onderwerp: "", Beslissing: "", DatumBeslissing: null, Volledig: "", Ontvankelijk: "", Ingetrokken: "", Stopgezet: "", ProjectnummerOmgevingsloket: "", behandelendeOverheid: "", beslissingsoverheid: "" }, geometry });
    // De tweede vergunning ligt aan de Proeflaan, 900 m ten oosten van de Peterseliestraat.
    const vergunningen = [maakVergunning("OMV_2099000001", perceel(mx, my)), maakVergunning("OMV_2099000002", perceel(oost + opM(900), pm + 0.00008))];
    const { page, context, errors } = await openPage(baseUrl, { width: 1280, height: 900, street: peterselie, asign, work: false, assen, vergunningen, query: "?plek=Peterseliestraat" });
    await page.waitForFunction(() => { const l = window.PUBLIC_AGENDA_LIVE_STREETS || {}; return Array.isArray(l.publicSpace) && Array.isArray(l.permits); }, null, { timeout: 30000 });
    const parcours = page.locator(".pv-results .pv-row", { hasText: "Huikstraat" }).filter({ hasText: "Evenement op straat" });
    const vergunning = page.locator(".pv-results .pv-row", { hasText: "Vergunning" }).filter({ hasText: "Huikstraat" });
    await page.waitForTimeout(1500);
    assert.equal(await parcours.count(), 0, "alleen de straat zelf: het parcours ligt elders");
    assert.equal(await vergunning.count(), 0);
    await page.click('.pv-place [data-radius="500"]');
    await parcours.first().waitFor({ timeout: 15000 });
    assert.match(await parcours.first().innerText(), /Niet in je straat, wel binnen 500 m/);
    // Nakijkbevinding 6: de regel "jouw straat" is een eigen regel, nooit na twee regels afgekapt.
    assert.equal(await parcours.first().locator(".pv-row-jouw").evaluate((el) => el.classList.contains("pv-row-where") || getComputedStyle(el).webkitLineClamp !== "none"), false);
    await vergunning.first().waitFor({ timeout: 15000 });
    const ver = page.locator('.pv-results .pv-row[data-uid="permits:permit:OMV_2099000002"]');
    assert.equal(await ver.count(), 0, "een vergunning 900 m verder telt niet mee in +500 m, ook al komt haar straat tot 200 m");
    await page.click('.pv-place [data-radius="1000"]');
    await ver.first().waitFor({ timeout: 15000 });
    assert.match(await page.locator(".pv-sub").innerText(), /terrassen alleen in de straat zelf/);
    assert.deepEqual(errors, []);
    await context.close();
  });
  // Nakijkbevinding 4: per rij van een evenementendossier rekende de site alle straatnamen opnieuw uit.
  // Een dossier met 200 innames en 200 straten in kaart-uitleg.json legde zo een gsm seconden stil.
  await t.test("een groot evenementendossier: de filter rekent één lijst per dossier", async (st) => {
    const peterselie = { id: "2289", name: "Peterseliestraat", postcode: "2000" };
    const [px1, py1, px2, py2] = straten.streets.find((r) => r[1] === "Peterseliestraat" && r[2] === "2000")[4];
    const [mx, my] = [(px1 + px2) / 2, (py1 + py2) / 2], d = 0.00003;
    const ms = (iso) => Date.parse(`${iso}T08:00:00Z`);
    const dag = addDays(today, 5);
    const innames = Array.from({ length: 200 }, (_, i) => ({ id: 991000 + i, feature: { attributes: { dossierNummer: "ET2099000009", faseId: "F1", innameId: `I${i}`, dossierStatus: "aanvraag_goedgekeurd", faseNaam: "Evenement", type_dossier: "ETL", innameTypeNaam: "Parkeerverbod", innameHinder: "False", faseStartDatum: ms(dag), faseEindDatum: ms(dag) }, geometry: { rings: [[[mx - d, my - d], [mx + d, my - d], [mx + d, my + d], [mx - d, my + d], [mx - d, my - d]]] } } }));
    const namen = straten.streets.filter((r) => r[2] === "2000").slice(0, 200).map((r) => r[1]);
    const kaartUitleg = { schemaVersion: 1, generatedAt: `${today}T05:00:00Z`, vanaf: today, tot: addDays(today, 60), werken: {}, evenementen: { ET2099000009: { start: dag, eind: dag, soort: "", soortBron: "", beschrijvingen: [], straten: [...new Set([...namen, "Peterseliestraat"])], kruist: [], stratenTekst: "", gekoppeld: null, kaart: [] } } };
    const { page, context, errors } = await openPage(baseUrl, { width: 1280, height: 900, street: peterselie, asign: asignServer({ fixtures: { 22: innames } }), work: false, kaartUitleg, query: "?plek=Peterseliestraat" });
    await page.waitForFunction(() => Array.isArray((window.PUBLIC_AGENDA_LIVE_STREETS || {}).publicSpace), null, { timeout: 30000 });
    await page.locator(".pv-results .pv-row", { hasText: "Evenement op straat" }).first().waitFor({ timeout: 60000 });
    const duur = await page.evaluate(() => {
      const view = window.PUBLIC_AGENDA_VIEW, rijen = window.PUBLIC_AGENDA_LIVE_STREETS.publicSpace;
      view.resetRefs();
      const t0 = performance.now();
      const treffers = rijen.filter((r) => view.matchesStreet(r)).length;
      return { ms: performance.now() - t0, treffers, rijen: rijen.length };
    });
    assert.equal(duur.treffers, 200, "alle innames van het dossier horen bij de straat");
    st.diagnostic(`200 rijen filteren: ${Math.round(duur.ms)} ms`);
    assert.ok(duur.ms < 1000, `200 rijen filteren duurde ${Math.round(duur.ms)} ms`);
    assert.deepEqual(errors, []);
    await context.close();
  });
});
