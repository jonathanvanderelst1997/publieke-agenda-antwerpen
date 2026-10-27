// site/sources/werk-vorm.json lezen en schrijven (de vaste vorm per werk-id: site/werk-vorm.js), en de werk-ids die al
// gepubliceerd zijn. Eén schrijver: scripts/refresh-live-history.mjs (en de overgang: scripts/maak-werk-vorm.mjs).
import fs from "node:fs";
import path from "node:path";

import { WERK_VORM_FILE, werkVormDocument, werkVormFouten } from "../site/werk-vorm.js";
import { LIVE_HISTORY_FILE } from "./live-history.mjs";
import { LIVE_HISTORY_ARCHIVE_DIR } from "./live-history-archive.mjs";
import { KAART_UITLEG_FILE } from "./kaart-uitleg-validatie.mjs";

export const WERK_VORM_PAD = `site/sources/${WERK_VORM_FILE}`;
export const werkVormTekst = (doc) => `${JSON.stringify(werkVormDocument(doc))}\n`;

// Het document, of een leeg document als het bestand er (nog) niet is. Onleesbaar of ongeldig: een fout, zonder ooit een
// stuk van de inhoud in de melding (de logs zijn publiek).
export function leesWerkVorm(rootDir) {
  const file = path.join(rootDir, WERK_VORM_PAD);
  if (!fs.existsSync(file)) return werkVormDocument();
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw Object.assign(new Error(`${WERK_VORM_PAD} is geen geldige JSON`), { code: "werk_vorm_onleesbaar" });
  }
  const fouten = werkVormFouten(doc);
  if (fouten.length) throw Object.assign(new Error(`${WERK_VORM_PAD} ongeldig: ${fouten[0]}`), { code: "werk_vorm_ongeldig" });
  return doc;
}
export function schrijfWerkVorm(rootDir, doc) {
  const fouten = werkVormFouten(werkVormDocument(doc));
  if (fouten.length) throw new Error(`${WERK_VORM_PAD} ongeldig: ${fouten[0]}`);
  const file = path.join(rootDir, WERK_VORM_PAD);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, werkVormTekst(doc), "utf8");
}

// Werk-ids in een tekst van de historiek of een straatbestand ("work:20540898").
export function werkIdsInTekst(tekst, ids = new Set()) {
  for (const m of String(tekst ?? "").matchAll(/"work:(\d{1,12})"/g)) ids.add(Number(m[1]));
  return ids;
}
// De werk-ids van kaart-uitleg.json (de sleutels van `werken`).
export function werkIdsInKaartUitleg(tekst, ids = new Set()) {
  try {
    for (const id of Object.keys(JSON.parse(tekst)?.werken || {})) if (/^\d{1,12}$/.test(id)) ids.add(Number(id));
  } catch { /* een kapot bestand telt hier niet mee: validate-data meldt het */ }
  return ids;
}
const lees = (file) => { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } };
const jsonOnder = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith(".json")).sort().map((n) => path.join(dir, n)) : []);
// Regel 13: de werken die al gepubliceerd zijn (de vorige live-layers.json, het archief en kaart-uitleg.json). Zo'n werk
// blijft een gewone kaart. `straten`: ook site/straat/*.json (de controle van validate-data, regel 35).
export function gepubliceerdeWerkIds(rootDir, { straten = false } = {}) {
  const ids = new Set();
  werkIdsInTekst(lees(path.join(rootDir, LIVE_HISTORY_FILE)), ids);
  for (const file of jsonOnder(path.join(rootDir, LIVE_HISTORY_ARCHIVE_DIR))) werkIdsInTekst(lees(file), ids);
  werkIdsInKaartUitleg(lees(path.join(rootDir, "site", "sources", KAART_UITLEG_FILE)), ids);
  if (straten) for (const file of jsonOnder(path.join(rootDir, "site", "straat"))) werkIdsInTekst(lees(file), ids);
  return ids;
}
