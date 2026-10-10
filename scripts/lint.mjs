import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { loadExpandedAgendaItems, loadRefreshEngine } from "./agenda-source.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const javascriptFiles = [
  "site/agenda-feed.js",
  "site/agenda-refresh.js",
  "site/agenda.js",
  "site/agenda-uitgaan.js",
  "site/neighborhood-core.js",
  "site/neighborhood-map.js",
  "lib/geocode.mjs",
  "scripts/geocode-locations.mjs",
  "scripts/build-wijken.mjs",
  "lib/data-lane.mjs",
  "lib/evenement-herkenning-validatie.mjs",
  "lib/parcours-herkenning.mjs",
  "lib/parcours-herkenning-refresh.mjs",
  "scripts/herken-parcours.mjs",
  "lib/district-channels.mjs",
  "lib/district-news-parser.mjs",
  "lib/district-parser.mjs",
  "lib/ebesluit-evenementen.mjs",
  "lib/event-contract.mjs",
  "lib/fetch-util.mjs",
  "lib/gipod-markets.mjs",
  "lib/html-text.mjs",
  "lib/koopzondagen.mjs",
  "lib/mail-signals.mjs",
  "lib/asign-foren.mjs",
  "lib/schoolstraten.mjs",
  "lib/district-projecten.mjs",
  "lib/periode-tekst.mjs",
  "lib/straatnamen.mjs",
  "lib/merge-events.mjs",
  "lib/postcodes.mjs",
  "lib/source-feed.mjs",
  "lib/source-registry.mjs",
  "scripts/agenda-source.mjs",
  "scripts/build-agenda.mjs",
  "scripts/build-provenance-sla.mjs",
  "scripts/build-provenance-snapshot.mjs",
  "scripts/build-sources.mjs",
  "scripts/check-data-lane.mjs",
  "scripts/fetch-sources-district-news.mjs",
  "scripts/fetch-sources-district.mjs",
  "scripts/fetch-sources-ebesluit-evenementen.mjs",
  "scripts/fetch-sources-koopzondagen.mjs",
  "scripts/fetch-sources-mail.mjs",
  "scripts/fetch-sources-markten.mjs",
  "scripts/fetch-sources-stad-districten.mjs",
  "scripts/fetch-sources-uit.mjs",
  "scripts/fetch-sources-foren.mjs",
  "scripts/fetch-sources-schoolstraten.mjs",
  "scripts/fetch-sources-projecten.mjs",
  "scripts/load-agenda-source.mjs",
  "scripts/provenance-snapshot.mjs",
  "scripts/provenance-sla.mjs",
  "scripts/refresh-fetch.mjs",
  "scripts/sources-health.mjs",
  "scripts/stale-policy.mjs",
  "scripts/validate-data.mjs",
  "scripts/lint.mjs",
  "tests/agenda-refresh.test.mjs",
  "tests/data-lane.test.mjs",
  "tests/district-parser.test.mjs",
  "tests/ebesluit-evenementen.test.mjs",
  "tests/escape.test.mjs",
  "tests/mail-feed.test.mjs",
  "tests/merge-events.test.mjs",
  "tests/parcours-herkenning.test.mjs",
  "tests/helpers/parcours-herkenning-evaluatie.mjs",
  "tests/provenance-sla.test.mjs",
  "tests/provenance-snapshot.test.mjs",
  "tests/source-feed.test.mjs",
  "tests/stad-koopzondagen.test.mjs",
  "tests/stad-sources.test.mjs",
  "tests/stale-policy.test.mjs",
  "tests/uit-fetcher.test.mjs",
  "tests/periode-tekst.test.mjs",
  "tests/asign-foren.test.mjs",
  "tests/schoolstraten.test.mjs",
  "tests/district-projecten.test.mjs",
  "tests/foren-schoolstraten-projecten.test.mjs",
];

for (const file of javascriptFiles) {
  const check = spawnSync(process.execPath, ["--check", path.join(rootDir, file)], { encoding: "utf8" });
  if (check.status !== 0) throw new Error(check.stderr || `${file} is geen geldige JavaScript.`);
}

const engine = loadRefreshEngine(rootDir);
const items = loadExpandedAgendaItems(rootDir);
const result = engine.reconcileAgendaItems(items, engine.config.classificationAsOf);
const indexHtml = fs.readFileSync(path.join(rootDir, "site", "index.html"), "utf8");
const feedIndex = indexHtml.indexOf('src="/agenda-feed.js"');
const refreshIndex = indexHtml.indexOf("agenda-refresh.js");
const agendaIndex = indexHtml.indexOf('src="/agenda.js"');

if (refreshIndex < 0 || agendaIndex < 0 || refreshIndex >= agendaIndex) {
  throw new Error("agenda-refresh.js moet vóór agenda.js geladen worden.");
}
if (feedIndex < 0 || feedIndex >= refreshIndex) {
  throw new Error("agenda-feed.js moet vóór agenda-refresh.js geladen worden.");
}
if (/\\n/.test(indexHtml)) {
  throw new Error("site/index.html bevat een letterlijke \\n-tekst.");
}

// Getraceerde nieuwsbrieflinks (Campaign Monitor) dragen het abonnee-ID van de eigenaar.
// Geen enkel bestand onder site/ mag er nog één bevatten.
const trackingMarkers = ["nieuwsbrief.antwerpen.be/t/", "createsend", "cmail", "/t/j-"];
function* filesUnder(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* filesUnder(full);
    else yield full;
  }
}
for (const file of filesUnder(path.join(rootDir, "site"))) {
  const text = fs.readFileSync(file, "latin1");
  const marker = trackingMarkers.find((candidate) => text.includes(candidate));
  if (marker) throw new Error(`${path.relative(rootDir, file)} bevat een getraceerde nieuwsbrieflink (${marker}).`);
}
if (!/^[0-9a-f]{40}$/.test(engine.config.rollback.baseCommit)) {
  throw new Error("Rollbackcommit ontbreekt of is ongeldig.");
}
for (const [sourceId, source] of Object.entries(engine.config.sources)) {
  // Een feed-bron zonder items (bv. UiT zonder sleutel) heeft nog geen ophaalmoment.
  const inactiveFeed = source.feed && !source.retrievedAt && !(source.itemCount > 0);
  if (!source.officialPublic || !source.url.startsWith("https://") || (!source.retrievedAt && !inactiveFeed)) {
    throw new Error(`Bron ${sourceId} mist officiële URL- of retrievalmetadata.`);
  }
  if (source.feed && (!Array.isArray(source.allowedHosts) || !source.allowedHosts.includes(new URL(source.url).hostname))) {
    throw new Error(`Feed-bron ${sourceId} staat niet op zijn eigen toegelaten host.`);
  }
}
for (const item of result.publicItems) {
  if (item.verificationState !== "verified" || !item.sourceId || !item.sourceRetrievedAt) {
    throw new Error(`Publiek item ${item.id} is niet volledig brongeverifieerd.`);
  }
  if (item.feed) {
    const source = engine.config.sources[item.sourceId];
    const url = new URL(item.link);
    if (url.protocol !== "https:" || !source?.allowedHosts?.includes(url.hostname) || !item.retrievedAt) {
      throw new Error(`Publiek feed-item ${item.id} heeft geen https-bron op een toegelaten host of geen retrievedAt.`);
    }
  }
}

const provenanceMatrix = JSON.parse(fs.readFileSync(path.join(rootDir, "audit", "provenance-expiry-sla.json"), "utf8"));
if (provenanceMatrix.sourceItemCount !== items.length || provenanceMatrix.items.length !== items.length) {
  throw new Error("De provenance-/vervalmatrix moet elk bronitem exact één keer bevatten.");
}

console.log(`Lint passed: ${items.length} bronitems, ${result.publicItems.length} publiek verifieerbaar.`);
