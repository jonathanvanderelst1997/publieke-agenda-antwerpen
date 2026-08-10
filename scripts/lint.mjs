import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { loadExpandedAgendaItems, loadRefreshEngine } from "./agenda-source.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const javascriptFiles = [
  "site/agenda-refresh.js",
  "site/agenda.js",
  "scripts/agenda-source.mjs",
  "scripts/build-agenda.mjs",
  "scripts/lint.mjs",
  "tests/agenda-refresh.test.mjs",
];

for (const file of javascriptFiles) {
  const check = spawnSync(process.execPath, ["--check", path.join(rootDir, file)], { encoding: "utf8" });
  if (check.status !== 0) throw new Error(check.stderr || `${file} is geen geldige JavaScript.`);
}

const engine = loadRefreshEngine(rootDir);
const items = loadExpandedAgendaItems(rootDir);
const result = engine.reconcileAgendaItems(items, engine.config.classificationAsOf);
const indexHtml = fs.readFileSync(path.join(rootDir, "site", "index.html"), "utf8");
const refreshIndex = indexHtml.indexOf("agenda-refresh.js");
const agendaIndex = indexHtml.indexOf("agenda.js");

if (refreshIndex < 0 || agendaIndex < 0 || refreshIndex >= agendaIndex) {
  throw new Error("agenda-refresh.js moet vóór agenda.js geladen worden.");
}
if (!/^[0-9a-f]{40}$/.test(engine.config.rollback.baseCommit)) {
  throw new Error("Rollbackcommit ontbreekt of is ongeldig.");
}
for (const [sourceId, source] of Object.entries(engine.config.sources)) {
  if (!source.officialPublic || !source.url.startsWith("https://") || !source.retrievedAt) {
    throw new Error(`Bron ${sourceId} mist officiële URL- of retrievalmetadata.`);
  }
}
for (const item of result.publicItems) {
  if (item.verificationState !== "verified" || !item.sourceId || !item.sourceRetrievedAt) {
    throw new Error(`Publiek item ${item.id} is niet volledig brongeverifieerd.`);
  }
}

console.log(`Lint passed: ${items.length} bronitems, ${result.publicItems.length} publiek verifieerbaar.`);
