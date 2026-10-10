// Bouwt site/agenda-feed.js uit site/sources/*.json. Deterministisch en offline: geen klok, geen netwerk.
// Valideert elk bronbestand (schema, https, toegelaten hosts, retrievedAt, privacy), voegt samen en
// ontdubbelt met de handmatige items, en schrijft het resultaat als window.PUBLIC_AGENDA_FEED.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalized, parseEventTimes } from "../lib/event-contract.mjs";
import { dutchDateLabel } from "../lib/html-text.mjs";
import { mergeEvents } from "../lib/merge-events.mjs";
import { MANUAL_CHECK_FILE, manualCheckForFeed, validateManualCheck } from "../lib/manual-check.mjs";
import { SOURCE_DEFINITIONS, validateRefreshStatus, validateSourceDocument } from "../lib/source-feed.mjs";
import { KAART_UITLEG_FILE } from "../lib/kaart-uitleg-validatie.mjs";
import { EVENEMENT_IDENTITEIT_FILE } from "../lib/evenement-identiteit-validatie.mjs";
import { HERKENNING_FILE, PATRONEN_FILE } from "../lib/evenement-herkenning-validatie.mjs";
import { loadHandAgendaItems } from "./agenda-source.mjs";

export const FEED_HEADER = "// Gegenereerd door scripts/build-sources.mjs; niet met de hand wijzigen.";

export function readSources(rootDir) {
  const sourcesDir = path.join(rootDir, "site", "sources");
  if (!fs.existsSync(sourcesDir)) return { status: null, documents: [], manualCheck: null };
  // kaart-uitleg.json, evenement-identiteit.json en de automatische herkenning (evenement-identiteit-auto.json,
  // evenement-patronen.json) zijn geen agendabronnen maar uitleg bij de live lagen.
  const geenBron = [KAART_UITLEG_FILE, EVENEMENT_IDENTITEIT_FILE, HERKENNING_FILE, PATRONEN_FILE];
  const names = fs.readdirSync(sourcesDir).filter((name) => name.endsWith(".json") && !geenBron.includes(name)).sort();
  let status = null;
  let manualCheck = null;
  const documents = [];
  const problems = [];
  for (const name of names) {
    const file = path.join(sourcesDir, name);
    let json;
    try {
      json = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      problems.push(`${name}: geen geldige JSON`);
      continue;
    }
    if (name === "refresh-status.json") {
      for (const error of validateRefreshStatus(json)) problems.push(`${name}: ${error}`);
      status = json;
      continue;
    }
    if (name === MANUAL_CHECK_FILE) {
      for (const error of validateManualCheck(json)) problems.push(`${name}: ${error}`);
      manualCheck = json;
      continue;
    }
    const expectedSourceId = name.replace(/\.json$/, "");
    for (const error of validateSourceDocument(json, { expectedSourceId })) problems.push(`${name}: ${error}`);
    documents.push(json);
  }
  if (problems.length) throw new Error(`Ongeldige brondata:\n${problems.slice(0, 20).join("\n")}`);
  return { status, documents, manualCheck };
}

function contractSignature(item) {
  return [normalized(item.title), item.date, parseEventTimes(item.timeSlot, item.timeText).startTime || "unknown", normalized(item.location)].join("|");
}

export function buildFeed({ status, documents, manualCheck = null }, handItems) {
  const itemsBySource = Object.fromEntries(documents.map((document) => [document.sourceId, { scope: document.scope, items: document.items }]));
  const suppressions = documents.flatMap((document) => Array.isArray(document.suppressions) ? document.suppressions : []);
  const merged = mergeEvents(itemsBySource, handItems, suppressions);
  // Vangnet: twee feed-items die voor het eventcontract hetzelfde punt zijn, worden er één
  // (de bron met voorrang wint). Zo kan een dagelijkse refresh de build niet breken.
  const signatures = new Set();
  const items = [];
  let droppedDuplicates = 0;
  for (const item of merged.items) {
    const signature = contractSignature(item);
    if (signatures.has(signature)) {
      droppedDuplicates += 1;
      continue;
    }
    signatures.add(signature);
    items.push({ ...item, dateLabel: dutchDateLabel(item.date, item.endDate), feed: true });
  }
  const statusBySource = new Map((status?.sources ?? []).map((entry) => [entry.sourceId, entry]));
  const sources = documents
    .map((document) => {
      const entry = statusBySource.get(document.sourceId);
      const { items: sourceItems, ...meta } = document;
      delete meta.suppressions;
      return {
        ...meta,
        label: SOURCE_DEFINITIONS[document.sourceId].label,
        fetchStatus: entry?.fetchStatus ?? document.fetchStatus,
        errorCode: entry?.errorCode ?? null,
        itemCount: sourceItems.length,
      };
    })
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  return {
    feed: {
      schemaVersion: 1,
      generatedAt: status?.generatedAt ?? null,
      classificationAsOf: status?.classificationAsOf ?? null,
      sources,
      items,
      supersedes: merged.supersedes,
      ...(manualCheck ? { manualCheck: manualCheckForFeed(manualCheck) } : {}),
    },
    droppedDuplicates,
    suppressed: merged.suppressed,
  };
}

export function renderFeedScript(feed) {
  return `${FEED_HEADER}\nwindow.PUBLIC_AGENDA_FEED = ${JSON.stringify(feed)};\n`;
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const sources = readSources(rootDir);
  const { feed, droppedDuplicates, suppressed } = buildFeed(sources, loadHandAgendaItems(rootDir));
  const file = path.join(rootDir, "site", "agenda-feed.js");
  const text = renderFeedScript(feed);
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text) fs.writeFileSync(file, text, "utf8");
  console.log(
    JSON.stringify({
      sources: feed.sources.length,
      items: feed.items.length,
      supersedes: feed.supersedes.length,
      droppedDuplicates,
      suppressed: suppressed.length,
      classificationAsOf: feed.classificationAsOf,
    })
  );
}
