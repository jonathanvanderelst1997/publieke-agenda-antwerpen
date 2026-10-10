// Draait elke fetcher in vaste volgorde (lib/source-registry.mjs) en schrijft daarna
// site/sources/refresh-status.json (contract C3). Alleen dit script schrijft dat bestand.
// Een fetcher die crasht, krijgt fetchStatus "error"; zijn vorige data blijft staan.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SOURCE_TIMEOUT_CODE, deadlineFetch, errorCodeOf, isMainModule, readSourceDocument, serialize, statusEntry, upcomingCount } from "../lib/fetch-util.mjs";
import { brusselsDate } from "../lib/html-text.mjs";
import { FETCHERS } from "../lib/source-registry.mjs";
import { validateRefreshStatus } from "../lib/source-feed.mjs";
import { refreshLiveHistory } from "./refresh-live-history.mjs";
import { contentStatusOf, nextEmptySince } from "./stale-policy.mjs";

// Tijdsbudgetten. De job "refresh" in .github/workflows/refresh.yml stopt hard na 20 minuten en
// heeft na het ophalen nog ongeveer een minuut nodig (build, check, validatie, patch). Een bron die
// haar budget opgebruikt, krijgt fetchStatus "error" met errorCode "source_timeout" en houdt haar
// vorige data; de andere bronnen gaan gewoon door. Zo eindigt `npm run refresh` altijd ruim binnen
// de jobgrens, ook als een bron hangt.
export const SOURCE_BUDGET_MS = 3 * 60_000; // standaard per fetcher (de snelste bronnen doen er seconden over)
export const REFRESH_BUDGET_MS = 12 * 60_000; // alle fetchers samen
export const LIVE_HISTORY_BUDGET_MS = 3 * 60_000; // live historiek (werken en publieke ruimte) na de fetchers
// Na het budget krijgt een fetcher nog even om via zijn eigen foutpad af te ronden (zijn verzoeken
// falen dan meteen); daarna gaat de verversing zonder hem verder.
export const ABORT_GRACE_MS = 15_000;
export const REFRESH_BUDGET_CODE = "refresh_budget_exhausted";

function previousStatuses(rootDir, fetcher, code) {
  return fetcher.sourceIds.map((sourceId) => {
    const previous = readSourceDocument(rootDir, sourceId);
    return statusEntry(sourceId, { fetchStatus: "error", retrievedAt: previous?.retrievedAt ?? null, itemCount: previous?.items?.length ?? 0, errorCode: code });
  });
}

// Vorige bronstatus per sourceId (voor emptySince); leeg als er nog geen geldige is.
function previousStatusBySource(rootDir) {
  try {
    const status = JSON.parse(fs.readFileSync(path.join(rootDir, "site", "sources", "refresh-status.json"), "utf8"));
    return new Map((Array.isArray(status?.sources) ? status.sources : []).map((entry) => [entry?.sourceId, entry]));
  } catch {
    return new Map();
  }
}

function readDocumentSafely(rootDir, sourceId) {
  try {
    return readSourceDocument(rootDir, sourceId);
  } catch {
    return null;
  }
}

const INACTIVE_FETCH_STATUSES = ["skipped_no_key", "disabled", "test_only"];

// Eerlijke bronstatus (scripts/stale-policy.mjs): hoeveel items er vandaag nog lopen of komen, sinds
// wanneer dat er geen meer zijn, en "leeg" vanaf de derde dag op rij zonder. Een bron die uit staat,
// krijgt geen velden. Lukt het tellen niet, dan blijft de status zoals de fetcher hem gaf: dit mag
// de verversing nooit laten falen.
export function withContentStatus(entry, { document, previous, today }) {
  if (INACTIVE_FETCH_STATUSES.includes(entry.fetchStatus)) return entry;
  try {
    const upcoming = upcomingCount(Array.isArray(document?.items) ? document.items : [], today);
    const emptySince = nextEmptySince({ previousEmptySince: previous?.emptySince ?? null, upcoming, today });
    return { ...entry, upcomingCount: upcoming, emptySince, contentStatus: contentStatusOf({ emptySince, today }) };
  } catch {
    return entry;
  }
}

// Draait één fetcher binnen budgetMs. Geeft { result } of { error } terug, met timedOut als het budget op was.
async function runWithinBudget(fetcher, args, budgetMs, graceMs) {
  const controller = new AbortController();
  const timers = [];
  const wait = (ms) => new Promise((resolve) => timers.push(setTimeout(resolve, ms)));
  timers.push(setTimeout(() => controller.abort(), budgetMs));
  const run = (async () => {
    const module = await fetcher.load();
    return module.run({ ...args, fetch: deadlineFetch(args.fetch, controller.signal), signal: controller.signal });
  })().then((result) => ({ result }), (error) => ({ error }));
  try {
    const outcome = await Promise.race([run, wait(budgetMs + graceMs).then(() => ({ hung: true }))]);
    return { ...outcome, timedOut: controller.signal.aborted };
  } finally {
    controller.abort();
    for (const timer of timers) clearTimeout(timer);
  }
}

// `sleep` (optioneel) gaat naar fetchers die pauzeren tussen verzoeken; toetsen geven een lege pauze mee.
export async function refreshAll({
  fetch: fetchImpl = globalThis.fetch,
  clock = () => new Date(),
  rootDir,
  env = process.env,
  log = console.log,
  fetchers = FETCHERS,
  sleep,
  sourceBudgetMs = SOURCE_BUDGET_MS,
  refreshBudgetMs = REFRESH_BUDGET_MS,
  graceMs = ABORT_GRACE_MS,
  now = () => Date.now(),
} = {}) {
  const statuses = [];
  const startedAt = now();
  for (const fetcher of fetchers) {
    const remaining = refreshBudgetMs - (now() - startedAt);
    const budgetMs = Math.min(fetcher.budgetMs ?? sourceBudgetMs, remaining);
    if (budgetMs <= 0) {
      log(JSON.stringify({ fetcher: fetcher.name, fetchStatus: "error", errorCode: REFRESH_BUDGET_CODE }));
      statuses.push(...previousStatuses(rootDir, fetcher, REFRESH_BUDGET_CODE));
      continue;
    }
    const fetcherStartedAt = now();
    const outcome = await runWithinBudget(fetcher, { fetch: fetchImpl, clock, rootDir, env, log, ...(sleep ? { sleep } : {}) }, budgetMs, graceMs);
    const seconds = Math.round((now() - fetcherStartedAt) / 100) / 10;
    if (outcome.result && !outcome.timedOut) {
      log(JSON.stringify({ fetcher: fetcher.name, seconds }));
      statuses.push(...outcome.result);
    } else if (outcome.result) {
      // Te laat klaar via het eigen foutpad: wat de fetcher nog binnenhaalde blijft, elke fout heet source_timeout.
      log(JSON.stringify({ fetcher: fetcher.name, seconds, budgetSeconds: budgetMs / 1000, errorCode: SOURCE_TIMEOUT_CODE }));
      statuses.push(...outcome.result.map((entry) => (entry.fetchStatus === "error" ? { ...entry, errorCode: SOURCE_TIMEOUT_CODE } : entry)));
    } else {
      const code = outcome.timedOut ? SOURCE_TIMEOUT_CODE : errorCodeOf(outcome.error) === "unexpected_error" ? "fetcher_crashed" : errorCodeOf(outcome.error);
      log(JSON.stringify({ fetcher: fetcher.name, seconds, fetchStatus: "error", errorCode: code }));
      statuses.push(...previousStatuses(rootDir, fetcher, code));
    }
  }
  const generated = clock();
  const today = brusselsDate(generated);
  const previous = previousStatusBySource(rootDir);
  const counted = statuses.map((entry) =>
    withContentStatus(entry, { document: readDocumentSafely(rootDir, entry.sourceId), previous: previous.get(entry.sourceId), today })
  );
  const status = {
    schemaVersion: 1,
    generatedAt: generated.toISOString(),
    classificationAsOf: today,
    sources: counted.sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
  };
  const errors = validateRefreshStatus(status);
  if (errors.length) throw new Error(`refresh-status is ongeldig: ${errors.slice(0, 3).join("; ")}`);
  const file = path.join(rootDir, "site", "sources", "refresh-status.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, serialize(status), "utf8");
  return status;
}

if (isMainModule(import.meta.url)) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  refreshAll({ rootDir })
    .then(async (status) => {
      for (const entry of status.sources) {
        console.log(JSON.stringify({ sourceId: entry.sourceId, fetchStatus: entry.fetchStatus, itemCount: entry.itemCount, errorCode: entry.errorCode }));
      }
      // Ook de live historiek krijgt een harde grens: een laag die niet op tijd antwoordt, telt als mislukt
      // en houdt haar vorige stand (zie updateLiveHistory).
      await refreshLiveHistory({ rootDir, fetch: deadlineFetch(globalThis.fetch, AbortSignal.timeout(LIVE_HISTORY_BUDGET_MS)) });
    })
    .catch((error) => {
      console.error(error?.message ?? String(error));
      process.exitCode = 1;
    });
}
