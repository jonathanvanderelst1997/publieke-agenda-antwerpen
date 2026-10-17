// Haalt de AWV-werfdata op (open data "Werf" van het Agentschap Wegen en Verkeer) en schrijft
// site/sources/awv-werf-supplement.json: per GIPOD-id van een bevestigde AWV-inname die district Antwerpen
// raakt, welke rijstroken ingenomen zijn, doorgang, snelheidsbeperking, omleidingen, fase en werf. Geen
// agendapunten: de werkenlaag koppelt het alleen op exact hetzelfde GIPOD-id (site/works-awv-supplement.js).
// Open data (Modellicentie Gratis Hergebruik v1.0, "Bron: AWV"); geen sleutel, geen AI.
//
// Twee soorten vragen aan de WFS van AWV (lib/awv-werf.mjs): één voor de innames, daarna de lokale
// omleidingen van die innames in blokken van hoogstens 100, met hoogstens 2 vragen tegelijk. Eigen
// tijdsbudget van 60 s (lib/source-registry.mjs). Faalt een vraag, is een antwoord afgekapt of ongeldig, of
// komen er 0 innames terwijl de vorige ronde er meer dan 20 had: de bron faalt gesloten, het vorige bestand
// blijft staan en refresh-status.json meldt de fout.
//
//   node scripts/fetch-sources-awv-werf.mjs [--dry-run]
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AWV_WERF_SOURCE_ID, bouwSupplement, inBlokken, innamesUrl, jongsteWijziging, leesInnames, leesOmleidingen, omleidingenUrl } from "../lib/awv-werf.mjs";
import { FetchError, USER_AGENT, dropAllowed, errorCodeOf, fetchWithTimeout, isMainModule, keepPreviousOnError, readSourceDocument, statusEntry, upcomingCount, writeSourceDocument } from "../lib/fetch-util.mjs";
import { brusselsDate } from "../lib/html-text.mjs";
import { districtBoundary } from "../lib/postcodes.mjs";
import { sourceDocument } from "../lib/source-feed.mjs";
import { geometryIntersectsDistrict } from "../site/public-space-live-core.js";

export const SOURCE_ID = AWV_WERF_SOURCE_ID;
// Een val naar 0 innames na een ronde met meer dan zoveel: eerder een andere laag of veldnaam dan een lege weg.
export const MIN_VORIGE_VOOR_NUL = 20;
export const PARALLEL = 2;
// Gemeten: 366 KB voor 174 innames. Ruim daarboven is geen gewoon antwoord meer.
export const MAX_BYTES = 8 * 1024 * 1024;

export async function haalWfs(fetchImpl, url) {
  const response = await fetchWithTimeout(fetchImpl, url, { headers: { "user-agent": USER_AGENT, accept: "application/json" }, redirect: "error" });
  if (!response.ok) throw new FetchError(`http_${response.status}`);
  let text;
  try {
    text = await response.text();
  } catch (error) {
    if (error instanceof FetchError) throw error;
    throw new FetchError("body_read_failed");
  }
  if (text.length > MAX_BYTES) throw new FetchError("too_large");
  try {
    return JSON.parse(text);
  } catch {
    throw new FetchError("not_json");
  }
}

// Hoogstens `parallel` taken tegelijk; de eerste fout breekt alles af.
async function metGrens(taken, parallel) {
  const uit = new Array(taken.length);
  let volgende = 0;
  const werker = async () => {
    while (volgende < taken.length) {
      const i = volgende++;
      uit[i] = await taken[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, taken.length) }, werker));
  return uit;
}

export async function run({ fetch: fetchImpl = globalThis.fetch, clock = () => new Date(), rootDir, env = process.env, dryRun = false, log = console.log, grens = null } = {}) {
  const previous = readSourceDocument(rootDir, SOURCE_ID);
  const now = clock();
  const retrievedAt = now.toISOString();
  const today = brusselsDate(now);
  const fout = (code, extra = {}) => {
    log(JSON.stringify({ source: SOURCE_ID, ...extra, fetchStatus: "error", errorCode: code }));
    return [keepPreviousOnError(rootDir, SOURCE_ID, previous, code, { dryRun })];
  };
  let gelezen;
  let perInname;
  try {
    const district = grens || districtBoundary();
    gelezen = leesInnames(await haalWfs(fetchImpl, innamesUrl(today)), { vandaag: today, raaktDistrict: (lijn) => geometryIntersectsDistrict(lijn, district) });
    if (gelezen.fout) return fout(gelezen.fout);
    const uuids = gelezen.innames.map((inname) => inname.uuid);
    const antwoorden = await metGrens(inBlokken(uuids).map((blok) => () => haalWfs(fetchImpl, omleidingenUrl(blok))), PARALLEL);
    const omleidingen = leesOmleidingen(antwoorden, uuids);
    if (omleidingen.fout) return fout(omleidingen.fout, gelezen.tellers);
    perInname = omleidingen.perInname;
  } catch (error) {
    return fout(errorCodeOf(error));
  }
  const items = bouwSupplement(gelezen.innames, perInname);
  const counts = { source: SOURCE_ID, ...gelezen.tellers, items: items.length, upcoming: upcomingCount(items, today), omleidingen: items.reduce((n, item) => n + item.lokaleOmleidingen, 0) };
  const vorige = previous ? upcomingCount(previous.items, today) : 0;
  if (!items.length && vorige > MIN_VORIGE_VOOR_NUL && !dropAllowed(env, SOURCE_ID)) {
    log(JSON.stringify({ ...counts, upcomingBefore: vorige, fetchStatus: "error", errorCode: "suspicious_drop" }));
    return [keepPreviousOnError(rootDir, SOURCE_ID, previous, "suspicious_drop", { dryRun })];
  }
  if (dryRun) {
    log(JSON.stringify({ dryRun: true, ...counts }));
    return [statusEntry(SOURCE_ID, { fetchStatus: "ok", retrievedAt, itemCount: items.length })];
  }
  let document;
  try {
    document = writeSourceDocument(rootDir, SOURCE_ID, sourceDocument(SOURCE_ID, { retrievedAt, fetchStatus: "ok", contentVersion: jongsteWijziging(items), items }));
  } catch (error) {
    return fout(errorCodeOf(error), counts);
  }
  log(JSON.stringify({ ...counts, written: document.items.length }));
  return [statusEntry(SOURCE_ID, { fetchStatus: "ok", retrievedAt, itemCount: document.items.length })];
}

if (isMainModule(import.meta.url)) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  run({ rootDir, dryRun: process.argv.includes("--dry-run") }).catch((error) => {
    console.error(JSON.stringify({ source: SOURCE_ID, fatal: errorCodeOf(error) }));
    process.exitCode = 1;
  });
}
