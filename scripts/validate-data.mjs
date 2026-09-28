// Controleert alle agenda-data onder site/sources: schema's, https, toegelaten hosts, limieten en
// een privacyscan over elke tekst (geen @, telefoonnummer, IBAN, querystring of verboden sleutel).
// Leest de klok niet en gebruikt geen netwerk. Exitcode 1 bij elke fout.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateEventContract } from "../lib/event-contract.mjs";
import { SOURCE_DEFINITIONS, SOURCE_IDS, privacyFindings, validateRefreshStatus, validateSourceDocument } from "../lib/source-feed.mjs";
import { LIVE_HISTORY_FILE, validateLiveHistory } from "../lib/live-history.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcesDir = path.join(rootDir, "site", "sources");
const problems = [];
const summary = {};

if (!fs.existsSync(sourcesDir)) {
  problems.push("site/sources ontbreekt");
} else {
  const names = fs.readdirSync(sourcesDir).sort();
  for (const name of names) {
    const file = path.join(sourcesDir, name);
    if (!/^[a-z0-9-]+\.json$/.test(name)) {
      problems.push(`${name}: onverwacht bestand`);
      continue;
    }
    let json;
    try {
      json = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      problems.push(`${name}: geen geldige JSON`);
      continue;
    }
    for (const finding of privacyFindings(json)) problems.push(`${name}: privacy ${finding.code} op ${finding.path}`);
    if (name === "refresh-status.json") {
      for (const error of validateRefreshStatus(json)) problems.push(`${name}: ${error}`);
      const listed = (json.sources ?? []).map((entry) => entry.sourceId);
      for (const sourceId of SOURCE_IDS) {
        if (!listed.includes(sourceId) && SOURCE_DEFINITIONS[sourceId]?.bootstrapOptional !== true) {
          problems.push(`${name}: ${sourceId} ontbreekt`);
        }
      }
      continue;
    }
    const sourceId = name.replace(/\.json$/, "");
    if (!SOURCE_IDS.includes(sourceId)) {
      problems.push(`${name}: onbekende bron`);
      continue;
    }
    for (const error of validateSourceDocument(json, { expectedSourceId: sourceId })) {
      if (!error.startsWith("privacy:")) problems.push(`${name}: ${error}`);
    }
    const contract = validateEventContract(Array.isArray(json.items) ? json.items : []);
    for (const error of contract.errors) problems.push(`${name}: eventcontract ${error.code} (${error.id ?? error.index})`);
    summary[sourceId] = { fetchStatus: json.fetchStatus, items: Array.isArray(json.items) ? json.items.length : 0 };
  }
  for (const sourceId of SOURCE_IDS) {
    if (!summary[sourceId] && SOURCE_DEFINITIONS[sourceId]?.bootstrapOptional !== true) {
      problems.push(`${sourceId}.json ontbreekt`);
    }
  }
}

const historyFile = path.join(rootDir, LIVE_HISTORY_FILE);
if (fs.existsSync(historyFile)) {
  try {
    const history = JSON.parse(fs.readFileSync(historyFile, "utf8"));
    for (const error of validateLiveHistory(history)) problems.push(`${LIVE_HISTORY_FILE}: ${error}`);
    for (const finding of privacyFindings(history)) problems.push(`${LIVE_HISTORY_FILE}: privacy ${finding.code} op ${finding.path}`);
  } catch {
    problems.push(`${LIVE_HISTORY_FILE}: geen geldige JSON`);
  }
}

for (const problem of problems) console.error(problem);
console.log(JSON.stringify({ result: problems.length ? "FAIL" : "PASS", problems: problems.length, sources: summary }));
if (problems.length) process.exitCode = 1;
