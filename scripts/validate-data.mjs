// Controleert alle agenda-data onder site/sources: schema's, https, toegelaten hosts, limieten en
// een privacyscan over elke tekst (geen @, telefoonnummer, IBAN, querystring of verboden sleutel).
// Leest de klok niet en gebruikt geen netwerk. Exitcode 1 bij elke fout.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateEventContract } from "../lib/event-contract.mjs";
import { SOURCE_DEFINITIONS, SOURCE_IDS, privacyFindings, validateRefreshStatus, validateSourceDocument } from "../lib/source-feed.mjs";
import { LIVE_HISTORY_FILE, validateLiveHistory } from "../lib/live-history.mjs";
import {
  LIVE_HISTORY_ARCHIVE_BASELINE_FILE,
  LIVE_HISTORY_ARCHIVE_DIR,
  LIVE_HISTORY_ARCHIVE_INDEX_FILE,
  historyArchiveEventsDigest,
  validateHistoryArchiveBaseline,
  validateHistoryArchiveDay,
  validateHistoryArchiveIndex,
} from "../lib/live-history-archive.mjs";
import {
  HISTORY_BACKFILL_DIR,
  HISTORY_BACKFILL_INDEX_FILE,
  historyBackfillDigest,
  validateHistoryBackfillIndex,
  validateHistoryBackfillShard,
} from "../lib/history-backfill.mjs";

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

const archiveDir = path.join(rootDir, LIVE_HISTORY_ARCHIVE_DIR);
if (fs.existsSync(archiveDir)) {
  const baselinePath = path.join(rootDir, LIVE_HISTORY_ARCHIVE_BASELINE_FILE);
  const indexPath = path.join(rootDir, LIVE_HISTORY_ARCHIVE_INDEX_FILE);
  let archiveIndex = null;
  try {
    const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
    for (const error of validateHistoryArchiveBaseline(baseline)) problems.push(`${LIVE_HISTORY_ARCHIVE_BASELINE_FILE}: ${error}`);
    for (const finding of privacyFindings(baseline)) problems.push(`${LIVE_HISTORY_ARCHIVE_BASELINE_FILE}: privacy ${finding.code} op ${finding.path}`);
  } catch {
    problems.push(`${LIVE_HISTORY_ARCHIVE_BASELINE_FILE}: ontbreekt of is geen geldige JSON`);
  }
  try {
    archiveIndex = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    for (const error of validateHistoryArchiveIndex(archiveIndex)) problems.push(`${LIVE_HISTORY_ARCHIVE_INDEX_FILE}: ${error}`);
  } catch {
    problems.push(`${LIVE_HISTORY_ARCHIVE_INDEX_FILE}: ontbreekt of is geen geldige JSON`);
  }

  const shardNames = fs.readdirSync(archiveDir).filter((name) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}\\.json$/.test(name)).sort();
  const shards = new Map();
  for (const name of shardNames) {
    const relative = `${LIVE_HISTORY_ARCHIVE_DIR}/${name}`;
    try {
      const shard = JSON.parse(fs.readFileSync(path.join(archiveDir, name), "utf8"));
      for (const error of validateHistoryArchiveDay(shard)) problems.push(`${relative}: ${error}`);
      for (const finding of privacyFindings(shard)) problems.push(`${relative}: privacy ${finding.code} op ${finding.path}`);
      shards.set(name.slice(0, 10), shard);
    } catch {
      problems.push(`${relative}: geen geldige JSON`);
    }
  }
  if (archiveIndex?.days) {
    for (const day of archiveIndex.days) {
      const shard = shards.get(day.date);
      if (!shard) {
        problems.push(`${LIVE_HISTORY_ARCHIVE_INDEX_FILE}: shard ${day.date} ontbreekt`);
        continue;
      }
      if (day.count !== shard.events.length) problems.push(`${LIVE_HISTORY_ARCHIVE_INDEX_FILE}: count ${day.date} wijkt af`);
      if (day.digest !== historyArchiveEventsDigest(shard.events)) problems.push(`${LIVE_HISTORY_ARCHIVE_INDEX_FILE}: digest ${day.date} wijkt af`);
    }
    for (const date of shards.keys()) {
      if (!archiveIndex.days.some((day) => day.date === date)) problems.push(`${LIVE_HISTORY_ARCHIVE_INDEX_FILE}: shard ${date} niet geïndexeerd`);
    }
  }
}

const backfillDir = path.join(rootDir, HISTORY_BACKFILL_DIR);
if (fs.existsSync(backfillDir)) {
  const indexPath = path.join(rootDir, HISTORY_BACKFILL_INDEX_FILE);
  let index = null;
  try {
    index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    for (const error of validateHistoryBackfillIndex(index)) problems.push(`${HISTORY_BACKFILL_INDEX_FILE}: ${error}`);
    for (const finding of privacyFindings(index)) problems.push(`${HISTORY_BACKFILL_INDEX_FILE}: privacy ${finding.code} op ${finding.path}`);
  } catch {
    problems.push(`${HISTORY_BACKFILL_INDEX_FILE}: ontbreekt of is geen geldige JSON`);
  }

  const expected = new Map();
  for (const source of index?.sources ?? []) {
    for (const shard of source.shards ?? []) expected.set(shard.file, shard);
  }
  const actual = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const absolute = path.join(dir, name);
      if (fs.statSync(absolute).isDirectory()) walk(absolute);
      else actual.push(path.relative(rootDir, absolute).split(path.sep).join("/"));
    }
  };
  walk(backfillDir);
  for (const file of actual.sort()) {
    if (file === HISTORY_BACKFILL_INDEX_FILE) continue;
    const entry = expected.get(file);
    if (!entry) {
      problems.push(`${file}: backfill shard niet geïndexeerd`);
      continue;
    }
    try {
      const shard = JSON.parse(fs.readFileSync(path.join(rootDir, file), "utf8"));
      for (const error of validateHistoryBackfillShard(shard)) problems.push(`${file}: ${error}`);
      for (const finding of privacyFindings(shard)) problems.push(`${file}: privacy ${finding.code} op ${finding.path}`);
      if (entry.count !== shard.records.length) problems.push(`${file}: count wijkt af`);
      if (entry.digest !== historyBackfillDigest(shard.records)) problems.push(`${file}: digest wijkt af`);
    } catch {
      problems.push(`${file}: geen geldige JSON`);
    }
  }
  for (const file of expected.keys()) {
    if (!actual.includes(file)) problems.push(`${file}: backfill shard ontbreekt`);
  }
}

for (const problem of problems) console.error(problem);
console.log(JSON.stringify({ result: problems.length ? "FAIL" : "PASS", problems: problems.length, sources: summary }));
if (problems.length) process.exitCode = 1;
