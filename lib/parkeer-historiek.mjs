// Parkeerverboden in de historiek (site/history/live-layers.json en site/history/archive/):
// - nooit een huisnummer: een parkeerverbod is vaak een verhuis of een container bij één woning;
// - geen weekdagregel ("detail"): die werd tot oktober 2026 fout berekend (A-Sign geeft "0" of
//   "1" als tekst, en ook "0" werd "Alleen op weekdagen"). De live laag in de browser toont ze wel.
// Dezelfde opkuis geldt voor nieuwe items, voor oudere items en voor de oude wijzigingen, zodat de
// overgang geen massa "changed"-regels maakt.
import fs from "node:fs";

import { adresZonderHuisnummer } from "../site/adres-privacy.js";

// De officiële straatnamen (site/geo/straten.json), zodat een straatnaam met een cijfer ("Buurtweg nr
// 11", "De 7 schakenpad") bij elke opkuis heel blijft. Ontbreekt het bestand, dan geldt de strenge regel.
let straatnamen;
export function officieleStraatnamen() {
  if (straatnamen !== undefined) return straatnamen;
  try {
    const doc = JSON.parse(fs.readFileSync(new URL("../site/geo/straten.json", import.meta.url), "utf8"));
    straatnamen = Array.isArray(doc?.streets) ? doc.streets.map((row) => String(row?.[1] ?? "")).filter(Boolean) : null;
  } catch {
    straatnamen = null;
  }
  return straatnamen;
}

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);

export const isParkeerId = (id) => String(id || "").startsWith("parking:");

// Eén momentopname (een volledig item, of alleen de gewijzigde velden van een "changed"-regel).
export function parkeerZonderPrivé(value) {
  if (!isObject(value)) return value;
  const out = { ...value };
  if (typeof out.location === "string") out.location = clean(adresZonderHuisnummer(out.location, officieleStraatnamen()));
  if ("detail" in out) out.detail = "";
  return out;
}

export function parkeerItemVoorHistoriek(item) {
  return isObject(item) && (item.kind === "parking" || isParkeerId(item.id)) ? parkeerZonderPrivé(item) : item;
}

// Een wijziging van een parkeerverbod: opgekuist, en weg als er daarna niets meer verschilt (bv.
// alleen een ander huisnummer). Geeft null terug voor een lege wijziging.
export function parkeerWijzigingVoorHistoriek(entry) {
  if (!isObject(entry) || entry.layer !== "publicSpace" || !isParkeerId(entry.id)) return entry;
  const before = parkeerZonderPrivé(entry.before);
  const after = parkeerZonderPrivé(entry.after);
  if (entry.type !== "changed" || !isObject(before) || !isObject(after)) return { ...entry, before, after };
  const fields = (Array.isArray(entry.fields) ? entry.fields : []).filter((field) => JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null));
  if (!fields.length) return null;
  const pick = (value) => Object.fromEntries(fields.map((field) => [field, value[field] ?? null]));
  return { ...entry, fields, before: pick(before), after: pick(after) };
}

export function parkeerWijzigingenVoorHistoriek(entries) {
  return Array.isArray(entries) ? entries.map(parkeerWijzigingVoorHistoriek).filter(Boolean) : entries;
}
