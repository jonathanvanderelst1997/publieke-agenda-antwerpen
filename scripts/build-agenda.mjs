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
const manifest = {
  schemaVersion: 2,
  state: "published-release",
  candidateGeneratedAt: engine.config.retrievedAt,
  classificationAsOf: engine.config.classificationAsOf,
  sourceCount: items.length,
  count: result.publicItems.length,
  classifications: result.counts,
  digest,
  publicUrl: "https://mijn-publieke-agenda-voor-district.onrender.com/",
  rollback: engine.config.rollback,
  titles: result.publicItems.map((item) => item.title),
};

fs.writeFileSync(
  path.join(rootDir, "site", "public-agenda-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8"
);

console.log(JSON.stringify({ count: manifest.count, classifications: manifest.classifications, digest }, null, 2));
