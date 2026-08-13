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

function buildEventRedirectPage(item) {
  const destination = `/?event=${encodeURIComponent(item.id)}`;
  const canonical = `https://mijn-publieke-agenda-voor-district.onrender.com${destination}`;
  const title = escapeHtml(item.title);
  return `<!doctype html>
<html lang="nl-BE">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="index,follow" />
    <meta http-equiv="refresh" content="0; url=${destination}" />
    <link rel="canonical" href="${canonical}" />
    <title>${title} | Publieke agenda District Antwerpen</title>
  </head>
  <body>
    <p><a href="${destination}">Open ${title} in de publieke agenda</a></p>
    <script>window.location.replace(${JSON.stringify(destination)} + window.location.hash);</script>
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

console.log(JSON.stringify({ count: manifest.count, eventPageCount: manifest.eventPageCount, classifications: manifest.classifications, digest }, null, 2));
