// Controleert alle agenda-data onder site/sources: schema's, https, toegelaten hosts, limieten en
// een privacyscan over elke tekst (geen @, telefoonnummer, IBAN, querystring of verboden sleutel).
// Leest de klok niet en gebruikt geen netwerk. Exitcode 1 bij elke fout.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateEventContract } from "../lib/event-contract.mjs";
import { MANUAL_CHECK_FILE, validateManualCheck } from "../lib/manual-check.mjs";
import { KAART_UITLEG_FILE, validateKaartUitleg } from "../lib/kaart-uitleg-validatie.mjs";
import { EVENEMENT_IDENTITEIT_FILE, validateEvenementIdentiteit } from "../lib/evenement-identiteit-validatie.mjs";
import { HERKENNING_FILE, PATRONEN_FILE, validateHerkenning, validatePatronen } from "../lib/evenement-herkenning-validatie.mjs";
import { SOURCE_DEFINITIONS, SOURCE_IDS, privacyFindings, validateRefreshStatus, validateSourceDocument } from "../lib/source-feed.mjs";
import { LIVE_HISTORY_FILE, validateLiveHistory } from "../lib/live-history.mjs";
import {
  HISTORY_BACKFILL_DIR,
  HISTORY_BACKFILL_INDEX_FILE,
  historyBackfillRecordsDigest,
  validateHistoryBackfillIndex,
  validateHistoryBackfillShard,
} from "../lib/history-backfill.mjs";
import {
  LIVE_HISTORY_ARCHIVE_BASELINE_FILE,
  LIVE_HISTORY_ARCHIVE_DIR,
  LIVE_HISTORY_ARCHIVE_INDEX_FILE,
  historyArchiveEventsDigest,
  isHistoryArchiveDayFileName,
  validateHistoryArchiveBaseline,
  validateHistoryArchiveDay,
  validateHistoryArchiveIndex,
} from "../lib/live-history-archive.mjs";

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
    if (name === MANUAL_CHECK_FILE) {
      for (const error of validateManualCheck(json)) problems.push(`${name}: ${error}`);
      continue;
    }
    if (name === KAART_UITLEG_FILE) {
      for (const error of validateKaartUitleg(json)) problems.push(`${name}: ${error}`);
      continue;
    }
    if (name === EVENEMENT_IDENTITEIT_FILE) {
      for (const error of validateEvenementIdentiteit(json)) problems.push(`${name}: ${error}`);
      continue;
    }
    // De automatische parcoursherkenning (lib/parcours-herkenning-refresh.mjs).
    if (name === HERKENNING_FILE) {
      for (const error of validateHerkenning(json)) problems.push(`${name}: ${error}`);
      continue;
    }
    if (name === PATRONEN_FILE) {
      for (const error of validatePatronen(json)) problems.push(`${name}: ${error}`);
      continue;
    }
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

// Buurtkaart: punten van agendalocaties (scripts/geocode-locations.mjs).
const geoFile = path.join(rootDir, "site", "geo", "locaties.json");
if (fs.existsSync(geoFile)) {
  // Pas laden als het bestand er is: lib/geocode.mjs gebruikt de gedeelde normalisatie uit site/.
  const { validateGeoCache } = await import("../lib/geocode.mjs");
  try {
    const geo = JSON.parse(fs.readFileSync(geoFile, "utf8"));
    for (const error of validateGeoCache(geo)) problems.push(`site/geo/locaties.json: ${error}`);
    for (const finding of privacyFindings(geo)) problems.push(`site/geo/locaties.json: privacy ${finding.code} op ${finding.path}`);
  } catch {
    problems.push("site/geo/locaties.json: geen geldige JSON");
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

  const shardNames = fs.readdirSync(archiveDir).filter(isHistoryArchiveDayFileName).sort();
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
  const backfillIndexPath = path.join(rootDir, HISTORY_BACKFILL_INDEX_FILE);
  let backfillIndex = null;
  try {
    backfillIndex = JSON.parse(fs.readFileSync(backfillIndexPath, "utf8"));
    for (const error of validateHistoryBackfillIndex(backfillIndex)) problems.push(`${HISTORY_BACKFILL_INDEX_FILE}: ${error}`);
    for (const finding of privacyFindings(backfillIndex)) problems.push(`${HISTORY_BACKFILL_INDEX_FILE}: privacy ${finding.code} op ${finding.path}`);
  } catch {
    problems.push(`${HISTORY_BACKFILL_INDEX_FILE}: ontbreekt of is geen geldige JSON`);
  }

  const referenced = new Set();
  for (const source of backfillIndex?.sources ?? []) {
    for (const shardRef of source.shards ?? []) {
      referenced.add(shardRef.file);
      const target = path.join(rootDir, shardRef.file);
      try {
        const shard = JSON.parse(fs.readFileSync(target, "utf8"));
        for (const error of validateHistoryBackfillShard(shard)) problems.push(`${shardRef.file}: ${error}`);
        for (const finding of privacyFindings(shard)) problems.push(`${shardRef.file}: privacy ${finding.code} op ${finding.path}`);
        if (shard.records.length !== shardRef.count) problems.push(`${shardRef.file}: count wijkt af`);
        if (historyBackfillRecordsDigest(shard.records) !== shardRef.digest) problems.push(`${shardRef.file}: digest wijkt af`);
      } catch {
        problems.push(`${shardRef.file}: ontbreekt of is geen geldige JSON`);
      }
    }
  }

  const sourceDirs = fs.readdirSync(backfillDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  for (const sourceId of sourceDirs) {
    const dir = path.join(backfillDir, sourceId);
    for (const name of fs.readdirSync(dir)) {
      const relative = `${HISTORY_BACKFILL_DIR}/${sourceId}/${name}`;
      if (!referenced.has(relative)) problems.push(`${relative}: shard niet geïndexeerd`);
    }
  }
}

for (const problem of problems) console.error(problem);
console.log(JSON.stringify({ result: problems.length ? "FAIL" : "PASS", problems: problems.length, sources: summary }));
if (problems.length) process.exitCode = 1;
