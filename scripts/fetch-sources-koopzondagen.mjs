// Haalt de koopzondagen van stad Antwerpen op van de publieke infopagina
// https://www.antwerpen.be/info/koopzondagen en schrijft site/sources/stad-koopzondagen.json.
// Open data van de stad, met bronvermelding. Alleen komende koopzondagen worden weggeschreven.
//
// Eén GET per ronde, zonder herhaling: de lijst verandert een paar keer per jaar, een gemiste ronde
// kost niets (de vorige items blijven 48 uur geldig). De ruwe HTML wordt nergens bewaard; het
// contactblok onderaan de pagina wordt nooit gelezen (zie lib/koopzondagen.mjs).
//
// Fouten:
//   - geen antwoord, geen 200 of geen HTML: vorige items blijven, fetchStatus "error";
//   - geen lijst "Koopzondagen in <jaar>" meer op de pagina (andere opmaak): errorCode "no_list",
//     vorige items blijven;
//   - een lijst die ineens (bijna) niets meer oplevert: de gewone krimpgrens (suspicious_drop).
//     Voorbije koopzondagen tellen daarbij nooit mee, dus de jaarwissel is geen krimp.
//
//   node scripts/fetch-sources-koopzondagen.mjs [--dry-run]
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FetchError, USER_AGENT, errorCodeOf, fetchWithTimeout, guardShrink, isMainModule, keepPreviousOnError, readSourceDocument, screenItems, statusEntry, suspiciousDrop, upcomingCount, writeSourceDocument } from "../lib/fetch-util.mjs";
import { brusselsDate } from "../lib/html-text.mjs";
import { KOOPZONDAGEN_URL, parseKoopzondagenHtml } from "../lib/koopzondagen.mjs";
import { sourceDocument } from "../lib/source-feed.mjs";

export const SOURCE_ID = "stad-koopzondagen";
// De pagina weegt ongeveer 125 kB; alles boven 2 MB is geen infopagina meer.
export const MAX_HTML_BYTES = 2_000_000;

async function getPage(fetchImpl) {
  const response = await fetchWithTimeout(fetchImpl, KOOPZONDAGEN_URL, {
    headers: { "user-agent": USER_AGENT, accept: "text/html" },
    redirect: "error",
  });
  if (!response.ok) throw new FetchError(`http_${response.status}`);
  const type = String(response.headers?.get?.("content-type") ?? "");
  if (type && !/text\/html/i.test(type)) throw new FetchError("not_html");
  const html = await response.text();
  if (html.length > MAX_HTML_BYTES) throw new FetchError("too_large");
  return html;
}

export async function run({ fetch: fetchImpl = globalThis.fetch, clock = () => new Date(), rootDir, env = process.env, dryRun = false, log = console.log } = {}) {
  const previous = readSourceDocument(rootDir, SOURCE_ID);
  const now = clock();
  const retrievedAt = now.toISOString();
  const today = brusselsDate(now);
  let html;
  try {
    html = await getPage(fetchImpl);
  } catch (error) {
    const code = errorCodeOf(error);
    log(JSON.stringify({ source: SOURCE_ID, fetchStatus: "error", errorCode: code }));
    return [keepPreviousOnError(rootDir, SOURCE_ID, previous, code, { dryRun })];
  }

  const parsed = parseKoopzondagenHtml(html, { today });
  html = null; // de ruwe HTML wordt nergens bewaard
  const screened = screenItems(parsed.items.map((item) => ({ ...item, retrievedAt })));
  const counts = {
    source: SOURCE_ID,
    lists: parsed.lists,
    lines: parsed.lines,
    items: screened.items.length,
    upcoming: upcomingCount(screened.items, today),
    droppedPast: parsed.dropped,
    issues: parsed.issues.map((issue) => issue.code),
    screenedOut: screened.rejected.privacy + screened.rejected.contract + screened.rejected.duplicate,
  };
  if (!parsed.lists) {
    // Geen lijst is een andere opmaak, geen jaar zonder koopzondagen: nooit bestaande data wissen.
    log(JSON.stringify({ ...counts, fetchStatus: "error", errorCode: "no_list" }));
    return [keepPreviousOnError(rootDir, SOURCE_ID, previous, "no_list", { dryRun })];
  }
  if (dryRun) {
    const drop = previous ? suspiciousDrop(previous.items, screened.items, today) : null;
    log(JSON.stringify({ dryRun: true, ...counts, suspiciousDrop: drop }));
    return [statusEntry(SOURCE_ID, { fetchStatus: drop ? "error" : "ok", retrievedAt, itemCount: screened.items.length, errorCode: drop ? "suspicious_drop" : null })];
  }
  const shrink = guardShrink({ rootDir, sourceId: SOURCE_ID, previous, items: screened.items, today, env, log, counts });
  if (shrink) return [shrink];
  const document = writeSourceDocument(rootDir, SOURCE_ID, sourceDocument(SOURCE_ID, { retrievedAt, fetchStatus: "ok", contentVersion: null, items: screened.items }));
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
