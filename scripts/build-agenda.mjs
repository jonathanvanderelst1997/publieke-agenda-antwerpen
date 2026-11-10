import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadExpandedAgendaItems, loadRefreshEngine } from "./agenda-source.mjs";
import { GIPOD_BRON, GIPOD_METADATA_URL, gipodLink } from "../site/gipod-bron.js";
import { bouwEventpagina } from "../lib/eventpagina.mjs";
import { KALENDER_DIR, bouwKalenderfeeds, validateKalenderfeed } from "../lib/kalenderfeed.mjs";
import { officieleStraatnamen } from "../lib/parkeer-historiek.mjs";
import {
  PARKEER_VERLEDEN_DIR,
  isParkeerMaandBestand,
  parkeerBestanden,
  parkeerRecordVanItem,
  werkParkeerverledenBij,
  VERLEDEN_DIR,
  verledenMaandTekst,
  VERLEDEN_INDEX_FILE,
  isVerledenMaandBestand,
  maandVan,
  paginaStand,
  verledenBestanden,
  werkVerledenBij,
} from "../lib/agenda-verleden.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const items = loadExpandedAgendaItems(rootDir);
const engine = loadRefreshEngine(rootDir);
const result = engine.reconcileAgendaItems(items, engine.config.classificationAsOf);
const pageItems = result.publicItems.filter((item) => !item.noEventPage);
const digestInput = result.publicItems.map((item) => ({
  id: item.id,
  title: item.title,
  theme: item.theme,
  date: item.date,
  endDate: item.endDate ?? null,
  timeText: item.timeText,
  location: item.location,
  sourceId: item.sourceId,
  link: item.link,
  scope: item.scope,
  sources: Array.isArray(item.sources) ? item.sources.map((source) => `${source.sourceId}|${source.url}`) : [`${item.sourceId}|${item.link}`],
}));
const digest = crypto.createHash("sha256").update(JSON.stringify(digestInput)).digest("hex");
const siteDir = path.join(rootDir, "site");
const eventPagesDir = path.join(siteDir, "event");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const DISTRICT_ATTRIBUTION = "Bron: district Antwerpen – bron stad Antwerpen (Vlaamse gratis open data licentie)";

function safeHttps(value) {
  return /^https:\/\/[^\s"'<>]+$/i.test(String(value ?? "")) ? String(value) : "";
}

// Een GIPOD-link (een ruw record of de datasetfiche) wordt één bronvermelding met de datasetfiche: nooit een
// link naar het ruwe record, dat contactgegevens draagt (site/gipod-bron.js).
function sourceLinks(item) {
  const links = [];
  const seen = new Set();
  const add = (url, label) => {
    const gipod = gipodLink(url);
    const href = gipod ? GIPOD_METADATA_URL : safeHttps(url);
    if (!href || seen.has(href)) return;
    seen.add(href);
    links.push({ url: href, label: gipod ? GIPOD_BRON : label });
  };
  if (Array.isArray(item.sources) && item.sources.length) {
    for (const source of item.sources) {
      add(source.url, source.sourceId === "stad-uit" ? "Bron: uitinvlaanderen.be" : engine.config.sources[source.sourceId]?.label ?? "Officiële bron");
    }
  } else {
    add(item.link, "Officiële bron");
  }
  add(item.infoUrl, "Meer info bij de organisator");
  return links;
}

function attributionFor(item) {
  const primary = engine.config.sources[item.sourceId];
  if (item.scope === "district") return DISTRICT_ATTRIBUTION;
  return primary?.attribution?.text ?? `Bron: ${primary?.publisher ?? "officiële publieke bron"}`;
}

// Wat de eventpagina van een publiek item toont, als record voor het verleden (lib/agenda-verleden.mjs). De pagina
// (lib/eventpagina.mjs, stand "actueel") is dezelfde als vóór het verleden bestond.
function recordVanItem(item) {
  return {
    id: item.id,
    title: String(item.title ?? ""),
    info: String(item.info ?? ""),
    date: item.date,
    endDate: item.endDate || null,
    dateLabel: String(item.dateLabel ?? ""),
    timeText: String(item.timeText ?? ""),
    timeSlot: String(item.timeSlot ?? ""),
    location: String(item.location ?? ""),
    theme: String(item.theme ?? ""),
    scope: item.scope === "stad" ? "stad" : "district",
    ...(typeof item.inDistrict === "boolean" ? { inDistrict: item.inDistrict } : {}),
    sourceId: String(item.sourceId ?? ""),
    sourcePublisher: String(item.sourcePublisher ?? ""),
    bronnen: sourceLinks(item),
    attributie: attributionFor(item),
  };
}

for (const item of pageItems) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id)) {
    throw new Error(`Onveilige event-ID voor statische route: ${item.id}`);
  }
}

// Het verleden van de agenda (besluit van de eigenaar van 3 november 2026): elk item met een eigen pagina dat ooit
// publiek was, houdt een record in site/verleden/<JJJJ-MM>.json en zijn pagina op dezelfde URL. Geen enkele
// eventpagina wordt nog gewist; de databaan mag het ook niet (lib/data-lane-paths.json).
const asOf = engine.config.classificationAsOf;
const verledenDir = path.join(rootDir, VERLEDEN_DIR);
const bestaandeMaanden = fs.existsSync(verledenDir) ? fs.readdirSync(verledenDir).filter(isVerledenMaandBestand).sort() : [];
const vorigVerleden = bestaandeMaanden.flatMap((name) => {
  const document = JSON.parse(fs.readFileSync(path.join(verledenDir, name), "utf8"));
  return Array.isArray(document.items) ? document.items : [];
});
const verleden = werkVerledenBij(vorigVerleden, pageItems.map(recordVanItem), asOf);
for (const { id, problemen } of verleden.geweigerd) {
  console.error(`verleden: ${id} niet bewaard en zonder eigen pagina (${problemen.slice(0, 3).join("; ")})`);
}
const { index: verledenIndex, bestanden: verledenMaanden } = verledenBestanden(
  verleden.records,
  asOf,
  bestaandeMaanden.map((name) => name.slice(0, 7))
);

// De parkeerverboden in het verleden (besluit van de eigenaar van 3 november 2026: "die moeten er wel in komen. Maar
// gewoon als parkeerverbod, niet per se de reden. En het huisnummer mocht dan wel."): uit de publieke-ruimtelaag van
// de historiek (site/history/live-layers.json), elk als "Parkeerverbod" met zijn plaats en periode, nooit een reden.
const parkeerDir = path.join(rootDir, PARKEER_VERLEDEN_DIR);
const parkeerMaanden = fs.existsSync(parkeerDir) ? fs.readdirSync(parkeerDir).filter(isParkeerMaandBestand).sort() : [];
const vorigeParkeerverboden = parkeerMaanden.flatMap((name) => JSON.parse(fs.readFileSync(path.join(parkeerDir, name), "utf8")).items ?? []);
const historiekBestand = path.join(siteDir, "history", "live-layers.json");
const publiekeRuimte = fs.existsSync(historiekBestand) ? JSON.parse(fs.readFileSync(historiekBestand, "utf8"))?.layers?.publicSpace ?? null : null;
const straatnamen = officieleStraatnamen();
const parkeerverleden = werkParkeerverledenBij(
  vorigeParkeerverboden,
  (Array.isArray(publiekeRuimte?.items) ? publiekeRuimte.items : []).map((item) => parkeerRecordVanItem(item, straatnamen)).filter(Boolean),
  asOf,
  { volledig: publiekeRuimte?.status === "ok", straatnamen }
);
if (parkeerverleden.geweigerd) console.error(`verleden: ${parkeerverleden.geweigerd} parkeerverboden niet in de publieke vorm, niet bewaard`);
const { bestanden: parkeerBestandenPerMaand, lijst: parkeerLijst } = parkeerBestanden(parkeerverleden.records, parkeerMaanden.map((name) => name.slice(0, 7)));
verledenIndex.parkeerAantal = parkeerverleden.records.length;
verledenIndex.parkeerverboden = parkeerLijst;
fs.mkdirSync(parkeerDir, { recursive: true });
fs.mkdirSync(verledenDir, { recursive: true });
const schrijfAlsAnders = (file, inhoud) => {
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== inhoud) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, inhoud, "utf8");
  }
};
for (const [name, document] of verledenMaanden) schrijfAlsAnders(path.join(verledenDir, name), verledenMaandTekst(document));
for (const [name, document] of parkeerBestandenPerMaand) schrijfAlsAnders(path.join(parkeerDir, name), verledenMaandTekst(document));
schrijfAlsAnders(path.join(rootDir, VERLEDEN_INDEX_FILE), `${JSON.stringify(verledenIndex, null, 2)}\n`);

// Eén statische pagina per record: een publiek item ("actueel") zoals altijd, een ander met zijn stand (voorbij,
// weg, opgegaan). Een map zonder record blijft staan: niets wordt gewist (scripts/test-deep-links.mjs meldt ze).
const recordsPerId = new Map(verleden.records.map((record) => [record.id, record]));
fs.mkdirSync(eventPagesDir, { recursive: true });
for (const record of [...verleden.records].sort((a, b) => a.id.localeCompare(b.id))) {
  const stand = paginaStand(record, { actueel: verleden.actueleIds.has(record.id), asOf });
  const page = bouwEventpagina(record, {
    stand,
    maand: maandVan(record),
    opgegaanInTitel: record.opgegaanIn ? recordsPerId.get(record.opgegaanIn)?.title ?? "" : "",
  });
  schrijfAlsAnders(path.join(eventPagesDir, record.id, "index.html"), page);
}
const actuelePaginas = pageItems.filter((item) => verleden.actueleIds.has(item.id));
const archiefPaginas = verleden.records.filter((record) => !verleden.actueleIds.has(record.id)).map((record) => record.id).sort();
const wezen = fs.readdirSync(eventPagesDir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !recordsPerId.has(entry.name));
if (wezen.length) console.error(`verleden: ${wezen.length} eventpagina's zonder record (blijven staan): ${wezen.slice(0, 5).map((entry) => entry.name).join(", ")}`);

// De agenda om te volgen (lib/kalenderfeed.mjs, uitleg op /kalender/): elk publiek punt zoals zijn eventpagina het toont,
// plus wat de laatste maand voorbij ging. Een vaste set bestanden; de databaan mag ze bijwerken (lib/data-lane-paths.json).
const kalender = bouwKalenderfeeds({
  actueel: result.publicItems.map((item) => ({ item, record: recordVanItem(item), pagina: verleden.actueleIds.has(item.id) })),
  verleden: verleden.records.filter((record) => !verleden.actueleIds.has(record.id)),
  asOf,
  generatedAt: engine.config.generatedAt,
});
for (const { id, problemen } of kalender.geweigerd) {
  console.error(`kalender: ${id} in geen enkele feed (${problemen.slice(0, 3).join("; ")})`);
}
for (const feed of kalender.feeds) {
  const controle = validateKalenderfeed(feed.tekst);
  if (!controle.valid) throw new Error(`Kalenderfeed ${feed.bestand} is ongeldig: ${controle.fouten.slice(0, 3).join("; ")}`);
  schrijfAlsAnders(path.join(rootDir, KALENDER_DIR, feed.bestand), feed.tekst);
}

const manifest = {
  schemaVersion: 2,
  state: "published-release",
  candidateGeneratedAt: engine.config.retrievedAt,
  classificationAsOf: engine.config.classificationAsOf,
  sourceCount: items.length,
  count: result.publicItems.length,
  eventPageCount: actuelePaginas.length,
  // Pagina's van items die niet meer in de agenda staan (voorbij, weggevallen of opgegaan in een ander item): ze
  // blijven op dezelfde URL (site/verleden/, lib/agenda-verleden.mjs).
  archivedEventPageCount: archiefPaginas.length,
  classifications: result.counts,
  scopeCounts: {
    district: result.publicItems.filter((item) => item.scope !== "stad").length,
    stad: result.publicItems.filter((item) => item.scope === "stad").length,
  },
  feedGeneratedAt: engine.config.generatedAt,
  feedSources: (result.sourceFreshness ?? []).map((source) => ({
    sourceId: source.sourceId,
    scope: source.scope,
    fetchStatus: source.fetchStatus,
    retrievedAt: source.retrievedAt,
    state: source.state,
    ...(source.coverage ? { coverage: source.coverage } : {}),
  })),
  digest,
  publicUrl: "https://mijn-publieke-agenda-voor-district.onrender.com/",
  rollback: engine.config.rollback,
  titles: result.publicItems.map((item) => item.title),
};

fs.writeFileSync(
  path.join(siteDir, "public-agenda-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8"
);

const sitemapUrls = [
  "https://mijn-publieke-agenda-voor-district.onrender.com/",
  "https://mijn-publieke-agenda-voor-district.onrender.com/verleden/",
  "https://mijn-publieke-agenda-voor-district.onrender.com/kalender/",
  ...[...actuelePaginas.map((item) => item.id), ...archiefPaginas].map((id) =>
    `https://mijn-publieke-agenda-voor-district.onrender.com/event/${encodeURIComponent(id)}/`
  ),
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map((url) => `  <url><loc>${escapeHtml(url)}</loc></url>`).join("\n")}
</urlset>
`;
fs.writeFileSync(path.join(siteDir, "sitemap.xml"), sitemap, "utf8");

console.log(JSON.stringify({ count: manifest.count, eventPageCount: manifest.eventPageCount, archivedEventPageCount: manifest.archivedEventPageCount, verleden: verledenIndex.aantal, kalender: Object.fromEntries(kalender.feeds.map((feed) => [feed.slug, feed.aantal])), classifications: manifest.classifications, digest }, null, 2));
