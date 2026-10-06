// Kijkt de officiële bron van elk zichtbaar handmatig item na (zie lib/manual-check.mjs) en schrijft
// site/sources/manual-check.json. Draait in `npm run refresh`, na het ophalen van de bronnen.
// Faalt nooit de hele verversing: een fout per pagina wordt een status, en lukt het script zelf niet,
// dan blijft het vorige bestand staan.
//
//   node scripts/check-manual-sources.mjs [--dry-run]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { USER_AGENT, errorCodeOf, fetchWithTimeout, isMainModule } from "../lib/fetch-util.mjs";
import { brusselsDate } from "../lib/html-text.mjs";
import { MANUAL_CHECK_FILE, judgePage, manualCheckTargets, nextEntry, validateManualCheck } from "../lib/manual-check.mjs";
import { loadExpandedAgendaItems, loadRefreshEngine } from "./agenda-source.mjs";

const MAX_REDIRECTS = 3;
const MAX_BYTES = 3_000_000;
const GAP_MS = 1_000;
const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getPage(fetchImpl, url) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response;
    try {
      response = await fetchWithTimeout(fetchImpl, current, {
        // identity: sommige pagina's van antwerpen.be geven via een proxy een kapotte gzip.
        headers: { "user-agent": USER_AGENT, accept: "text/html", "accept-encoding": "identity" },
        redirect: "manual",
      });
    } catch (error) {
      return { httpStatus: null, html: "", error: errorCodeOf(error) };
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers?.get?.("location");
      let next;
      try {
        next = new URL(location, current);
      } catch {
        return { httpStatus: response.status, html: "" };
      }
      if (next.protocol !== "https:") return { httpStatus: response.status, html: "" };
      current = next.toString();
      continue;
    }
    if (response.status !== 200) return { httpStatus: response.status, html: "" };
    let html = "";
    try {
      html = (await response.text()).slice(0, MAX_BYTES);
    } catch (error) {
      return { httpStatus: null, html: "", error: errorCodeOf(error) };
    }
    return { httpStatus: 200, html };
  }
  return { httpStatus: 310, html: "" };
}

function readPrevious(file) {
  try {
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    return validateManualCheck(json).length ? null : json;
  } catch {
    return null;
  }
}

export async function run({ fetch: fetchImpl = globalThis.fetch, clock = () => new Date(), rootDir, dryRun = false, log = console.log, sleep = realSleep } = {}) {
  const file = path.join(rootDir, "site", "sources", MANUAL_CHECK_FILE);
  const now = clock();
  const checkedAt = now.toISOString();
  const asOf = brusselsDate(now);
  const engine = loadRefreshEngine(rootDir);
  const manualItems = loadExpandedAgendaItems(rootDir).filter((item) => !item.feed);
  // Zonder de vorige uitkomst: een item dat eerder als "gewijzigd" verborgen werd, moet opnieuw
  // nagekeken worden, anders blijft het voor altijd weg ook als de pagina hersteld is.
  const { publicItems } = engine.reconcileAgendaItems(manualItems, asOf, { now: checkedAt, ignoreManualCheck: true });
  const targets = manualCheckTargets(publicItems, engine.config.sources);
  const previous = readPrevious(file);
  const previousById = new Map((previous?.sources ?? []).map((entry) => [entry.sourceId, entry]));

  const entries = [];
  for (const [index, target] of targets.entries()) {
    if (index > 0) await sleep(GAP_MS);
    const page = await getPage(fetchImpl, target.url);
    const judged = { ...judgePage({ httpStatus: page.httpStatus, html: page.html, phrases: target.phrases }), httpStatus: page.httpStatus };
    entries.push(nextEntry(previousById.get(target.sourceId), target, judged, checkedAt));
  }
  const document = { schemaVersion: 1, checkedAt, sources: entries };
  const errors = validateManualCheck(document);
  if (errors.length) throw new Error(`manual-check ongeldig: ${errors.join("; ")}`);
  const counts = Object.fromEntries(["ok", "gewijzigd", "weg", "onbereikbaar", "niet_controleerbaar"].map((status) => [status, entries.filter((entry) => entry.status === status).length]));
  if (!dryRun) fs.writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  log(JSON.stringify({ manualCheck: true, sources: entries.length, ...counts, problems: entries.filter((entry) => entry.status !== "ok").map((entry) => `${entry.sourceId}:${entry.status}`) }));
  return document;
}

if (isMainModule(import.meta.url)) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  run({ rootDir, dryRun: process.argv.includes("--dry-run") }).catch((error) => {
    // Nooit de hele verversing laten vallen: het vorige bestand blijft staan.
    console.error(JSON.stringify({ manualCheck: true, fatal: errorCodeOf(error) }));
  });
}
