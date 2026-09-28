import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadExpandedAgendaItems, loadRefreshEngine } from "./agenda-source.mjs";

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

function jsonForHtml(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

const DISTRICT_ATTRIBUTION = "Bron: district Antwerpen – bron stad Antwerpen (Vlaamse gratis open data licentie)";

function safeHttps(value) {
  return /^https:\/\/[^\s"'<>]+$/i.test(String(value ?? "")) ? String(value) : "";
}

function sourceLinks(item) {
  const links = [];
  const seen = new Set();
  const add = (url, label) => {
    const href = safeHttps(url);
    if (!href || seen.has(href)) return;
    seen.add(href);
    links.push(`<li><a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a></li>`);
  };
  if (Array.isArray(item.sources) && item.sources.length) {
    for (const source of item.sources) {
      add(source.url, source.sourceId === "stad-uit" ? "Bron: uitinvlaanderen.be" : engine.config.sources[source.sourceId]?.label ?? "Officiële bron");
    }
  } else {
    add(item.link, "Officiële bron");
  }
  add(item.infoUrl, "Meer info bij de organisator");
  return links.join("\n            ");
}

function attributionFor(item) {
  const primary = engine.config.sources[item.sourceId];
  if (item.scope === "district") return DISTRICT_ATTRIBUTION;
  return primary?.attribution?.text ?? `Bron: ${primary?.publisher ?? "officiële publieke bron"}`;
}

function buildEventRedirectPage(item) {
  const destination = `/?event=${encodeURIComponent(item.id)}`;
  const canonical = `https://mijn-publieke-agenda-voor-district.onrender.com/event/${encodeURIComponent(item.id)}/`;
  const title = escapeHtml(item.title);
  const description = escapeHtml(item.info || `${item.title} in District Antwerpen.`);
  const dateText = escapeHtml(item.dateLabel || item.date);
  const timeText = escapeHtml(item.timeText || "Uur via de officiële bron");
  const location = escapeHtml(item.location || "Locatie via de officiële bron");
  const sourcePublisher = escapeHtml(item.sourcePublisher || "Publieke organisator");
  const eventJson = jsonForHtml({
    "@context": "https://schema.org",
    "@type": "Event",
    name: item.title,
    startDate: item.date,
    description: item.info || undefined,
    endDate: item.endDate || undefined,
    location: item.location ? { "@type": "Place", name: item.location } : undefined,
    url: canonical,
    inLanguage: "nl-BE",
  });
  return `<!doctype html>
<html lang="nl-BE">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="index,follow" />
    <meta name="description" content="${description}" />
    <meta name="referrer" content="strict-origin-when-cross-origin" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="nl_BE" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${canonical}" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <link rel="canonical" href="${canonical}" />
    <link rel="stylesheet" href="/styles.css" />
    <script type="application/ld+json">${eventJson}</script>
    <title>${title} | Publieke agenda District Antwerpen</title>
  </head>
  <body>
    <main class="event-page">
      <a href="/">← Terug naar de publieke agenda</a>
      <article class="event-summary">
        <h1>${title}</h1>
        <p>${description}</p>
        <dl>
          <div><dt>Wanneer</dt><dd>${dateText}</dd></div>
          <div><dt>Uur</dt><dd>${timeText}</dd></div>
          <div><dt>Waar</dt><dd>${location}</dd></div>
          <div><dt>Bron</dt><dd>${sourcePublisher}</dd></div>
        </dl>
        <div class="event-actions">
          <a href="${destination}">Bekijk in de volledige agenda</a>
        </div>
        <ul class="event-sources" aria-label="Bronnen">
            ${sourceLinks(item)}
        </ul>
        <p class="event-attribution">${escapeHtml(attributionFor(item))}</p>
      </article>
    </main>
  </body>
</html>
`;
}

// Eén statische pagina per publiek item met eigen eventpagina; mappen van items die niet meer
// publiek zijn (verlopen, verouderd of vervangen) worden in vaste volgorde verwijderd.
const pageIds = new Set();
for (const item of pageItems) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id)) {
    throw new Error(`Onveilige event-ID voor statische route: ${item.id}`);
  }
  pageIds.add(item.id);
}
fs.mkdirSync(eventPagesDir, { recursive: true });
for (const entry of fs.readdirSync(eventPagesDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!entry.isDirectory() || !pageIds.has(entry.name)) fs.rmSync(path.join(eventPagesDir, entry.name), { recursive: true, force: true });
}
for (const item of [...pageItems].sort((a, b) => a.id.localeCompare(b.id))) {
  const itemDir = path.join(eventPagesDir, item.id);
  fs.mkdirSync(itemDir, { recursive: true });
  const file = path.join(itemDir, "index.html");
  const page = buildEventRedirectPage(item);
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== page) fs.writeFileSync(file, page, "utf8");
}

const manifest = {
  schemaVersion: 2,
  state: "published-release",
  candidateGeneratedAt: engine.config.retrievedAt,
  classificationAsOf: engine.config.classificationAsOf,
  sourceCount: items.length,
  count: result.publicItems.length,
  eventPageCount: pageItems.length,
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
  ...pageItems.map((item) =>
    `https://mijn-publieke-agenda-voor-district.onrender.com/event/${encodeURIComponent(item.id)}/`
  ),
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map((url) => `  <url><loc>${escapeHtml(url)}</loc></url>`).join("\n")}
</urlset>
`;
fs.writeFileSync(path.join(siteDir, "sitemap.xml"), sitemap, "utf8");

console.log(JSON.stringify({ count: manifest.count, eventPageCount: manifest.eventPageCount, classifications: manifest.classifications, digest }, null, 2));
