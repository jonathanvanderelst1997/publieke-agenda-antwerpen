// Evenementen uit eBesluit (pakket P3, zoek- en leesdeel): zoekt besluiten over evenementen,
// muziekactiviteiten en het Districtsfonds rond vandaag (zittingsdatum -60/+120 dagen), leest alleen
// nieuwe ids en schrijft:
//   - site/sources/evenement-besluiten.json: de gelezen besluiten (cache en invoer voor de koppelstap);
//   - site/sources/district-ebesluit-evenementen.json: agendapunten met een plaats in het district;
//   - site/sources/stad-ebesluit-evenementen.json: agendapunten uit collegebesluiten met een plaats in een ander
//     district van de stad (groep "stad"). Dezelfde zoekronde, geen extra zoekvragen; alleen die collegebesluiten
//     worden nu ook gelezen (hoogstens een handvol per week, binnen dezelfde grenzen van 100 pagina's en 150 s).
// Gratis en zonder AI (lib/ebesluit-evenementen.mjs). Hoogstens 1 verzoek per seconde naar eBesluit.
// Een fout bij het zoeken houdt beide bestanden zoals ze waren (fetchStatus "error"). Eén besluit dat de
// vorm- of privacycontrole niet haalt, wordt opgekuist of valt weg; de rest wordt gewoon geschreven.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EBESLUIT_EVENEMENTEN_SOURCE_ID,
  EVENEMENT_BESLUITEN_FILE,
  STAD_EBESLUIT_EVENEMENTEN_SOURCE_ID,
  LEESVERSIE,
  agendapuntenUitBesluiten,
  besluitenDocument,
  bruikbareBesluiten,
  ontdekEvenementBesluiten,
  validateEvenementBesluiten,
} from "../lib/ebesluit-evenementen.mjs";
import { FetchError, errorCodeOf, isMainModule, keepPreviousOnError, readSourceDocument, screenItems, serialize, statusEntry, writeSourceDocument } from "../lib/fetch-util.mjs";
import { brusselsDate } from "../lib/html-text.mjs";
import { sourceDocument } from "../lib/source-feed.mjs";

export const SOURCE_ID = EBESLUIT_EVENEMENTEN_SOURCE_ID;
export const STAD_SOURCE_ID = STAD_EBESLUIT_EVENEMENTEN_SOURCE_ID;
// Per bron de groep van haar agendapunten (agendapuntenUitBesluiten).
const BRONNEN = Object.freeze([[SOURCE_ID, "district"], [STAD_SOURCE_ID, "stad"]]);

const besluitenPad = (rootDir) => path.join(rootDir, "site", "sources", EVENEMENT_BESLUITEN_FILE);

// Het vorige bestand als cache, alleen als het geldig is (een ongeldig besluit valt eruit, de rest blijft).
export function leesBesluiten(rootDir) {
  try {
    const doc = JSON.parse(fs.readFileSync(besluitenPad(rootDir), "utf8"));
    const kopie = { ...doc, besluiten: bruikbareBesluiten(doc?.besluiten).besluiten };
    return validateEvenementBesluiten(kopie).length ? null : kopie;
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
  const vorigeDocumenten = new Map(BRONNEN.map(([sourceId]) => [sourceId, readSourceDocument(rootDir, sourceId)]));
  // Een fout houdt beide bronbestanden zoals ze waren (en het besluitenbestand ook).
  const houdVorige = (code, at) => BRONNEN.map(([sourceId]) => keepPreviousOnError(rootDir, sourceId, vorigeDocumenten.get(sourceId), code, { dryRun, at }));
  const vorig = leesBesluiten(rootDir);
  const now = clock(), retrievedAt = now.toISOString(), today = brusselsDate(now);
  let result;
  try {
    result = await ontdekEvenementBesluiten({
      fetch: fetchImpl,
      today,
      // Ook een bestand van een oudere leesversie (vanaf 2: dezelfde velden): die besluiten blijven staan tot ze opnieuw
      // gelezen zijn (cacheLeesversie), zodat geen agendapunt verdwijnt, ook geen Districtsfonds van buiten het zoekvenster.
      cache: Number(vorig?.leesversie) >= 2 && Array.isArray(vorig?.besluiten) ? vorig.besluiten : [],
      cacheLeesversie: Number(vorig?.leesversie) >= 2 ? vorig.leesversie : LEESVERSIE,
      straten: leesStraten(rootDir),
      log,
      ...(sleep ? { sleep } : {}),
    });
    if (!result.complete) throw new FetchError("search_incomplete");
    if (!result.besluiten.length) throw new FetchError("no_decisions");
  } catch (error) {
    const code = errorCodeOf(error);
    log(JSON.stringify({ source: SOURCE_ID, fetchStatus: "error", errorCode: code }));
    return houdVorige(code, retrievedAt);
  }

  // Eén besluit met een "@", een huisnummer of een vreemde vorm legt de bron niet weken stil: het wordt
  // opgekuist (geen naam of plaats meer, dus geen agendapunt) of valt weg; de rest wordt geschreven.
  const bruikbaar = bruikbareBesluiten(result.besluiten);
  // De nieuwe leesversie pas als alles opnieuw gelezen is; anders leest de volgende verversing de rest.
  const leesversie = Number(vorig?.leesversie) >= 2 && vorig.leesversie !== LEESVERSIE && result.herleesRest > 0 ? vorig.leesversie : LEESVERSIE;
  const besluiten = besluitenDocument({ generatedAt: retrievedAt, venster: result.venster, besluiten: bruikbaar.besluiten, leesversie });
  const fouten = validateEvenementBesluiten(besluiten);
  if (fouten.length) {
    // Alleen een fout in het bestand zelf (niet in één besluit): liever de vorige stand.
    log(JSON.stringify({ source: SOURCE_ID, fetchStatus: "error", errorCode: "invalid_output", fouten: fouten.slice(0, 3) }));
    return houdVorige("invalid_output", retrievedAt);
  }
  const perBron = BRONNEN.map(([sourceId, groep]) => [sourceId, screenItems(agendapuntenUitBesluiten(besluiten.besluiten, { today, retrievedAt, groep }))]);
  const [, screened] = perBron[0], [, stad] = perBron[1];
  const counts = { besluiten: besluiten.besluiten.length, gelezen: result.gelezen, teLezen: result.teLezen, herleesRest: result.herleesRest, detailFouten: result.detailFouten, opgekuist: bruikbaar.opgekuist, weggelaten: bruikbaar.weggelaten, items: screened.items.length, stadItems: stad.items.length, rejected: screened.rejected, stadRejected: stad.rejected };
  if (dryRun) {
    log(JSON.stringify({ source: SOURCE_ID, dryRun: true, ...counts }));
    return perBron.map(([sourceId, gezeefd]) => statusEntry(sourceId, { fetchStatus: "ok", retrievedAt, itemCount: gezeefd.items.length }));
  }
  const documenten = perBron.map(([sourceId, gezeefd]) => writeSourceDocument(rootDir, sourceId, sourceDocument(sourceId, {
    retrievedAt,
    fetchStatus: "ok",
    contentVersion: `ebesluit-evenementen-v${LEESVERSIE}|${result.venster.start}|${besluiten.samenvatting.gelezen}|${gezeefd.items.length}`,
    items: gezeefd.items,
  })));
  const file = besluitenPad(rootDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, serialize(besluiten), "utf8");
  log(JSON.stringify({ source: SOURCE_ID, ...counts, items: documenten[0].items.length, stadItems: documenten[1].items.length }));
  return documenten.map((document) => statusEntry(document.sourceId, { fetchStatus: "ok", retrievedAt, itemCount: document.items.length }));
}

if (isMainModule(import.meta.url)) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  run({ rootDir, dryRun: process.argv.includes("--dry-run") }).catch((error) => {
    console.error(JSON.stringify({ source: SOURCE_ID, fatal: errorCodeOf(error) }));
    process.exitCode = 1;
  });
}
