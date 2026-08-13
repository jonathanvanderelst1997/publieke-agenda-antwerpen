import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadExpandedAgendaItems, loadRefreshEngine } from "./agenda-source.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const items = loadExpandedAgendaItems(rootDir);
const engine = loadRefreshEngine(rootDir);
const result = engine.reconcileAgendaItems(items, engine.config.classificationAsOf);
const digestInput = result.publicItems.map((item) => ({
  id: item.id,
  title: item.title,
  theme: item.theme,
  date: item.date,
  timeText: item.timeText,
  location: item.location,
  sourceId: item.sourceId,
  link: item.link,
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
          ${item.link ? `<a href="${escapeHtml(item.link)}" target="_blank" rel="noreferrer">Officiële bron</a>` : ""}
        </div>
      </article>
    </main>
  </body>
</html>
`;
}

fs.rmSync(eventPagesDir, { recursive: true, force: true });
for (const item of result.publicItems) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id)) {
    throw new Error(`Onveilige event-ID voor statische route: ${item.id}`);
  }
  const itemDir = path.join(eventPagesDir, item.id);
  fs.mkdirSync(itemDir, { recursive: true });
  fs.writeFileSync(path.join(itemDir, "index.html"), buildEventRedirectPage(item), "utf8");
}

const manifest = {
  schemaVersion: 2,
  state: "published-release",
  candidateGeneratedAt: engine.config.retrievedAt,
  classificationAsOf: engine.config.classificationAsOf,
  sourceCount: items.length,
  count: result.publicItems.length,
  eventPageCount: result.publicItems.length,
  classifications: result.counts,
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
  ...result.publicItems.map((item) =>
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
