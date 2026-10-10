// Evenementen uit eBesluit (pakket P3, zoek- en leesdeel): zoekt besluiten over evenementen,
// muziekactiviteiten en het Districtsfonds rond vandaag (zittingsdatum -60/+120 dagen), leest alleen
// nieuwe ids en schrijft:
//   - site/sources/evenement-besluiten.json: de gelezen besluiten (cache en invoer voor de koppelstap);
//   - site/sources/district-ebesluit-evenementen.json: agendapunten met een plaats in het district.
// Gratis en zonder AI (lib/ebesluit-evenementen.mjs). Hoogstens 1 verzoek per seconde naar eBesluit.
// Een fout bij het zoeken houdt beide bestanden zoals ze waren (fetchStatus "error").
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EBESLUIT_EVENEMENTEN_SOURCE_ID,
  EVENEMENT_BESLUITEN_FILE,
  LEESVERSIE,
  agendapuntenUitBesluiten,
  besluitenDocument,
  ontdekEvenementBesluiten,
  validateEvenementBesluiten,
} from "../lib/ebesluit-evenementen.mjs";
import { FetchError, errorCodeOf, isMainModule, keepPreviousOnError, readSourceDocument, screenItems, serialize, statusEntry, writeSourceDocument } from "../lib/fetch-util.mjs";
import { brusselsDate } from "../lib/html-text.mjs";
import { sourceDocument } from "../lib/source-feed.mjs";

export const SOURCE_ID = EBESLUIT_EVENEMENTEN_SOURCE_ID;

const besluitenPad = (rootDir) => path.join(rootDir, "site", "sources", EVENEMENT_BESLUITEN_FILE);

// Het vorige bestand als cache, alleen als het geldig is en met dezelfde leesversie.
export function leesBesluiten(rootDir) {
  try {
    const doc = JSON.parse(fs.readFileSync(besluitenPad(rootDir), "utf8"));
    return validateEvenementBesluiten(doc).length ? null : doc;
  } catch {
    return null;
  }
}

function leesStraten(rootDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(rootDir, "site", "geo", "straten.json"), "utf8")).streets ?? [];
  } catch {
    return [];
  }
}

export async function run({ fetch: fetchImpl = globalThis.fetch, clock = () => new Date(), rootDir, dryRun = false, log = console.log, sleep } = {}) {
  const previous = readSourceDocument(rootDir, SOURCE_ID);
  const vorig = leesBesluiten(rootDir);
  const now = clock(), retrievedAt = now.toISOString(), today = brusselsDate(now);
  let result;
  try {
    result = await ontdekEvenementBesluiten({
      fetch: fetchImpl,
      today,
      cache: vorig?.leesversie === LEESVERSIE ? vorig.besluiten : [],
      straten: leesStraten(rootDir),
      log,
      ...(sleep ? { sleep } : {}),
    });
    if (!result.complete) throw new FetchError("search_incomplete");
    if (!result.besluiten.length) throw new FetchError("no_decisions");
  } catch (error) {
    const code = errorCodeOf(error);
    log(JSON.stringify({ source: SOURCE_ID, fetchStatus: "error", errorCode: code }));
    return [keepPreviousOnError(rootDir, SOURCE_ID, previous, code, { dryRun })];
  }

  const besluiten = besluitenDocument({ generatedAt: retrievedAt, venster: result.venster, besluiten: result.besluiten });
  const fouten = validateEvenementBesluiten(besluiten);
  if (fouten.length) {
    // Liever de vorige stand dan een bestand dat de privacy- of vormcontrole niet haalt.
    log(JSON.stringify({ source: SOURCE_ID, fetchStatus: "error", errorCode: "invalid_output", fouten: fouten.slice(0, 3) }));
    return [keepPreviousOnError(rootDir, SOURCE_ID, previous, "invalid_output", { dryRun })];
  }
  const screened = screenItems(agendapuntenUitBesluiten(besluiten.besluiten, { today, retrievedAt }));
  const counts = { besluiten: besluiten.besluiten.length, gelezen: result.gelezen, teLezen: result.teLezen, detailFouten: result.detailFouten, items: screened.items.length, rejected: screened.rejected };
  if (dryRun) {
    log(JSON.stringify({ source: SOURCE_ID, dryRun: true, ...counts }));
    return [statusEntry(SOURCE_ID, { fetchStatus: "ok", retrievedAt, itemCount: screened.items.length })];
  }
  const document = writeSourceDocument(rootDir, SOURCE_ID, sourceDocument(SOURCE_ID, {
    retrievedAt,
    fetchStatus: "ok",
    contentVersion: `ebesluit-evenementen-v${LEESVERSIE}|${result.venster.start}|${besluiten.samenvatting.gelezen}|${screened.items.length}`,
    items: screened.items,
  }));
  const file = besluitenPad(rootDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, serialize(besluiten), "utf8");
  log(JSON.stringify({ source: SOURCE_ID, ...counts, items: document.items.length }));
  return [statusEntry(SOURCE_ID, { fetchStatus: "ok", retrievedAt, itemCount: document.items.length })];
}

if (isMainModule(import.meta.url)) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  run({ rootDir, dryRun: process.argv.includes("--dry-run") }).catch((error) => {
    console.error(JSON.stringify({ source: SOURCE_ID, fatal: errorCodeOf(error) }));
    process.exitCode = 1;
  });
}
