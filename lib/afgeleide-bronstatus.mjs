// De regel van een afgeleide bron (lib/source-registry.mjs, AFGELEIDE_BRONNEN) in
// site/sources/refresh-status.json. scripts/refresh-fetch.mjs schrijft dat bestand voor de fetchers en
// neemt de vorige regel van een afgeleide bron over; de stap die de bron afleidt (refresh:herkenning)
// werkt die regel daarna bij: "ok", of "error" met een errorCode terwijl het vorige antwoord met zijn
// retrievedAt blijft staan. Zo zien de job source-health, sources:health en de site ook deze bron, net als
// een bron met een fetcher (een tijdelijke fout is "stale", een blijvende fout is een fout).
import fs from "node:fs";
import path from "node:path";

import { serialize, statusEntry, upcomingCount } from "./fetch-util.mjs";
import { validateRefreshStatus } from "./source-feed.mjs";
import { contentStatusOf, nextEmptySince } from "../scripts/stale-policy.mjs";

export const REFRESH_STATUS_FILE = "refresh-status.json";

// Eén regel zoals refresh-fetch.mjs ze schrijft, met de eerlijke inhoudsstatus (scripts/stale-policy.mjs).
export function afgeleideStatusRegel(sourceId, { fetchStatus, errorCode = null, document = null, vorigeRegel = null, today }) {
  const items = Array.isArray(document?.items) ? document.items : [];
  const regel = statusEntry(sourceId, { fetchStatus, retrievedAt: document?.retrievedAt ?? null, itemCount: items.length, errorCode });
  const upcoming = upcomingCount(items, today);
  const emptySince = nextEmptySince({ previousEmptySince: vorigeRegel?.emptySince ?? null, upcoming, today });
  return { ...regel, upcomingCount: upcoming, emptySince, contentStatus: contentStatusOf({ emptySince, today }) };
}

// Zet de regel van `sourceId` in refresh-status.json (een bestaande regel wordt vervangen). De dag is die
// van het bestand (classificationAsOf), zodat de regel er altijd bij past. Ontbreekt het bestand of is het
// ongeldig, dan verandert er niets: de verversing schrijft het eerst. Gooit nooit; true als het lukte.
export function werkBronstatusBij(rootDir, { sourceId, fetchStatus, errorCode = null, document = null, log = () => {} }) {
  try {
    const file = path.join(rootDir, "site", "sources", REFRESH_STATUS_FILE);
    if (!fs.existsSync(file)) return false;
    const status = JSON.parse(fs.readFileSync(file, "utf8"));
    if (validateRefreshStatus(status).length) return false;
    const vorigeRegel = status.sources.find((entry) => entry?.sourceId === sourceId) || null;
    const regel = afgeleideStatusRegel(sourceId, { fetchStatus, errorCode, document, vorigeRegel, today: status.classificationAsOf });
    const sources = [...status.sources.filter((entry) => entry?.sourceId !== sourceId), regel].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
    const nieuw = { ...status, sources };
    const fouten = validateRefreshStatus(nieuw);
    if (fouten.length) {
      log(JSON.stringify({ bronstatus: sourceId, bijgewerkt: false, fout: fouten[0].slice(0, 80) }));
      return false;
    }
    const tekst = serialize(nieuw);
    if (fs.readFileSync(file, "utf8") !== tekst) fs.writeFileSync(file, tekst, "utf8");
    return true;
  } catch {
    log(JSON.stringify({ bronstatus: sourceId, bijgewerkt: false }));
    return false;
  }
}
