// De overgang van de bewaarde bestanden naar "geen spoor van een verhuizing bij een werk" (besluit van de eigenaar van
// 18 oktober 2026; site/werk-vorm.js, VERHUIS_SPOOR). Voor elk werk (een item of een wijziging) in
// site/sources/kaart-uitleg.json, site/history/live-layers.json, site/history/archive/*.json (ook baseline en index) en
// site/straat/*.json (met site/straat-index.json):
// - een titel met het spoor wordt "Werk in openbaar domein";
// - de soort "Verhuis" wordt "Inname voor een lift of levering" als de soort inname of de inname een lift noemt, anders
//   geen soort; "Verhuislift of levering" wordt "Inname voor een lift of levering", "verhuislift of levering" wordt
//   "lift of levering", en een soort inname van GIPOD in elke schrijfwijze "Lift/levering" (innameZonderVerhuis);
// - een bewaarde fase met het spoor valt uit de bewaarde fasenlijst;
// - een opdrachtgever met het spoor valt weg (groep "Andere"), en elke andere tekst met het spoor wordt leeg (in een lijst:
//   valt weg);
// - een wijziging die daarna niets meer wijzigt, valt weg (ze zou alleen zeggen dat er zo'n tekst stond).
// Verder verandert het niets: kaart-uitleg.json wordt geschreven zoals elke schrijver het schrijft (kaartUitlegVoorPubliek in
// lib/kaart-uitleg-refresh.mjs: met het huisnummer, behalve bij één adres, regel van de eigenaar van 26 oktober 2026). Een
// tweede run verandert niets. Geen netwerk. De uitvoer noemt alleen bestanden en aantallen.
//
//   node scripts/opkuis-verhuis.mjs          toont alleen wat er zou veranderen
//   node scripts/opkuis-verhuis.mjs --write  schrijft de bestanden
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GEEN_TITEL, VERHUIS_SPOOR, innameZonderVerhuis } from "../site/werk-vorm.js";
import { LIVE_HISTORY_FILE, validateLiveHistory } from "../lib/live-history.mjs";
import {
  LIVE_HISTORY_ARCHIVE_BASELINE_FILE, LIVE_HISTORY_ARCHIVE_DIR, LIVE_HISTORY_ARCHIVE_INDEX_FILE, isHistoryArchiveDayFileName,
  updateHistoryArchiveIndexDay, validateHistoryArchiveBaseline, validateHistoryArchiveDay, validateHistoryArchiveIndex,
} from "../lib/live-history-archive.mjs";
import { KAART_UITLEG_FILE, validateKaartUitleg } from "../lib/kaart-uitleg-validatie.mjs";
import { kaartUitlegVoorPubliek, serialiseer } from "../lib/kaart-uitleg-refresh.mjs";
import { STRAAT_INDEX, STRAAT_MAP } from "../lib/straat-bestanden.mjs";

const isObject = (v) => v && typeof v === "object" && !Array.isArray(v);
const spoor = (v) => typeof v === "string" && VERHUIS_SPOOR.test(v);
const LIFT_SOORT = "Inname voor een lift of levering";
const isWerkId = (id) => /^work:\d+$/.test(String(id || ""));

// Eén werk (diep). `sorteer`: de lijsten van de soort inname gesorteerd, zoals de historiek ze bewaart (compactWorkItem).
export function werkZonderVerhuis(w, { sorteer = false } = {}) {
  if (!isObject(w)) return w;
  const uit = { ...w };
  for (const k of ["soort", "innameSoort"]) if (/^verhuislift of levering$/i.test(String(uit[k] ?? ""))) uit[k] = LIFT_SOORT;
  if (Array.isArray(uit.inname)) uit.inname = uit.inname.map((x) => (/^verhuislift of levering$/i.test(String(x)) ? "lift of levering" : x));
  if (/^verhuis$/i.test(String(uit.soort ?? ""))) {
    const lift = /lift/i.test(String(uit.innameSoort ?? "")) || (Array.isArray(uit.inname) && uit.inname.some((x) => /lift/i.test(String(x))));
    uit.soort = lift ? LIFT_SOORT : "";
    if ("soortBron" in uit) uit.soortBron = lift ? "soort inname in GIPOD" : "";
    if (uit.innameSoort === uit.soort) delete uit.innameSoort;
  }
  for (const k of ["occupancyTypes", "workTypes"]) {
    if (!Array.isArray(uit[k]) || !uit[k].some(spoor)) continue;
    const lijst = [...new Set(uit[k].map((x) => (typeof x === "string" ? innameZonderVerhuis(x) : x)))];
    uit[k] = sorteer ? lijst.sort((a, b) => String(a).localeCompare(String(b), "nl")) : lijst;
  }
  if (spoor(uit.title)) uit.title = GEEN_TITEL;
  if (spoor(uit.owner)) { uit.owner = ""; if ("ownerGroup" in uit) uit.ownerGroup = "Andere"; }
  if (Array.isArray(uit.fasen)) uit.fasen = uit.fasen.filter((f) => !spoor(f?.naam));
  if (isObject(uit.hindrance) && Array.isArray(uit.hindrance.phases)) uit.hindrance = { ...uit.hindrance, phases: uit.hindrance.phases.filter((p) => !spoor(p?.description)) };
  return leeg(uit);
}
// Elke andere tekst met het spoor: leeg (in een lijst: weg).
function leeg(waarde) {
  if (typeof waarde === "string") return spoor(waarde) ? "" : waarde;
  if (Array.isArray(waarde)) return waarde.filter((x) => !spoor(x)).map(leeg);
  if (isObject(waarde)) return Object.fromEntries(Object.entries(waarde).map(([k, v]) => [k, leeg(v)]));
  return waarde;
}
// Een wijziging van een werk: before en after opgekuist; een "changed" die niets meer wijzigt, valt weg (null).
function wijzigingZonderVerhuis(entry, opties) {
  if (!isObject(entry) || !isWerkId(entry.id)) return entry;
  const before = isObject(entry.before) ? werkZonderVerhuis(entry.before, opties) : entry.before;
  const after = isObject(entry.after) ? werkZonderVerhuis(entry.after, opties) : entry.after;
  if (entry.type !== "changed" || !isObject(before) || !isObject(after)) return { ...entry, before, after };
  const fields = (Array.isArray(entry.fields) ? entry.fields : []).filter((f) => JSON.stringify(before[f] ?? null) !== JSON.stringify(after[f] ?? null));
  if (!fields.length) return null;
  if (fields.length === (entry.fields || []).length) return { ...entry, before, after };
  const pick = (v) => Object.fromEntries(fields.map((f) => [f, v[f] ?? null]));
  return { ...entry, fields, before: pick(before), after: pick(after) };
}
const wijzigingen = (lijst, opties) => lijst.map((e) => wijzigingZonderVerhuis(e, opties)).filter(Boolean);
// Zelfde digest als lib/live-history.mjs (gesorteerd op id, sha256 van de JSON).
const laagDigest = (items) => crypto.createHash("sha256").update(JSON.stringify([...items].sort((a, b) => String(a.id).localeCompare(String(b.id), "nl")))).digest("hex");
const werkItems = (items, opties) => items.map((item) => (isObject(item) && isWerkId(item.id) ? werkZonderVerhuis(item, opties) : item));
// Zelfde hash als straatDocument (scripts/build-straat-snapshots.mjs): alles behalve schemaVersion, ververst en inhoud.
const straatHash = ({ schemaVersion: _s, ververst: _v, inhoud: _i, ...rest }) => crypto.createHash("sha256").update(JSON.stringify(rest)).digest("hex").slice(0, 12);

const leesJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const tekst = (doc) => `${JSON.stringify(doc, null, 2)}\n`;

export function opkuisVerhuis({ rootDir, write = false } = {}) {
  if (!rootDir) throw new Error("rootDir ontbreekt");
  const uit = new Map();
  const rapport = { write, gewijzigd: [] };
  const zet = (file, nieuw, oud) => { if (nieuw !== oud) { uit.set(file, nieuw); rapport.gewijzigd.push(path.relative(rootDir, file).split(path.sep).join("/")); } };
  const fout = (rel, errors) => { if (errors.length) throw new Error(`${rel} ongeldig na de opkuis: ${errors[0]}`); };
  const historiek = { sorteer: true };

  const uitlegFile = path.join(rootDir, "site", "sources", KAART_UITLEG_FILE);
  if (fs.existsSync(uitlegFile)) {
    const voor = fs.readFileSync(uitlegFile, "utf8");
    const doc = JSON.parse(voor);
    const na = kaartUitlegVoorPubliek({ ...doc, werken: Object.fromEntries(Object.entries(doc.werken || {}).map(([id, w]) => [id, werkZonderVerhuis(w)])) });
    fout(KAART_UITLEG_FILE, validateKaartUitleg(na));
    zet(uitlegFile, JSON.stringify(na) === JSON.stringify(doc) ? voor : serialiseer(na), voor);
  }

  const liveFile = path.join(rootDir, LIVE_HISTORY_FILE);
  if (fs.existsSync(liveFile)) {
    const voor = fs.readFileSync(liveFile, "utf8");
    const doc = JSON.parse(voor);
    const works = doc.layers?.works;
    const items = Array.isArray(works?.items) ? werkItems(works.items, historiek) : null;
    const na = {
      ...doc,
      layers: { ...doc.layers, ...(items ? { works: { ...works, items, ...(typeof works.digest === "string" ? { digest: laagDigest(items) } : {}) } } : {}) },
      changes: Array.isArray(doc.changes) ? wijzigingen(doc.changes, historiek) : doc.changes,
    };
    fout(LIVE_HISTORY_FILE, validateLiveHistory(na));
    zet(liveFile, JSON.stringify(na) === JSON.stringify(doc) ? voor : tekst(na), voor);
  }

  const archief = path.join(rootDir, LIVE_HISTORY_ARCHIVE_DIR);
  const baselineFile = path.join(rootDir, LIVE_HISTORY_ARCHIVE_BASELINE_FILE);
  if (fs.existsSync(baselineFile)) {
    const voor = fs.readFileSync(baselineFile, "utf8");
    const doc = JSON.parse(voor);
    const works = doc.layers?.works;
    const na = Array.isArray(works?.items) ? { ...doc, layers: { ...doc.layers, works: { ...works, items: werkItems(works.items, historiek) } } } : doc;
    fout(LIVE_HISTORY_ARCHIVE_BASELINE_FILE, validateHistoryArchiveBaseline(na));
    zet(baselineFile, JSON.stringify(na) === JSON.stringify(doc) ? voor : tekst(na), voor);
  }
  const indexFile = path.join(rootDir, LIVE_HISTORY_ARCHIVE_INDEX_FILE);
  let index = fs.existsSync(indexFile) ? leesJson(indexFile) : null;
  const indexVoor = index ? fs.readFileSync(indexFile, "utf8") : "";
  for (const naam of fs.existsSync(archief) ? fs.readdirSync(archief).filter(isHistoryArchiveDayFileName).sort() : []) {
    const file = path.join(archief, naam);
    const voor = fs.readFileSync(file, "utf8");
    const doc = JSON.parse(voor);
    const na = Array.isArray(doc.events) ? { ...doc, events: wijzigingen(doc.events, historiek) } : doc;
    if (JSON.stringify(na) === JSON.stringify(doc)) continue;
    fout(`${LIVE_HISTORY_ARCHIVE_DIR}/${naam}`, validateHistoryArchiveDay(na));
    zet(file, tekst(na), voor);
    if (index) index = updateHistoryArchiveIndexDay(index, na);
  }
  if (index) {
    fout(LIVE_HISTORY_ARCHIVE_INDEX_FILE, validateHistoryArchiveIndex(index));
    zet(indexFile, JSON.stringify(index) === JSON.stringify(JSON.parse(indexVoor)) ? indexVoor : tekst(index), indexVoor);
  }

  const map = path.join(rootDir, STRAAT_MAP);
  const straatIndexFile = path.join(rootDir, STRAAT_INDEX);
  const straatIndexVoor = fs.existsSync(straatIndexFile) ? fs.readFileSync(straatIndexFile, "utf8") : "";
  const straatIndex = straatIndexVoor ? JSON.parse(straatIndexVoor) : null;
  let hashes = 0;
  for (const naam of fs.existsSync(map) ? fs.readdirSync(map).filter((n) => /^\d+\.json$/.test(n)).sort() : []) {
    const file = path.join(map, naam);
    const voor = fs.readFileSync(file, "utf8");
    const doc = JSON.parse(voor);
    if (!Array.isArray(doc.werken)) continue;
    const werken = werkItems(doc.werken, {});
    if (JSON.stringify(werken) === JSON.stringify(doc.werken)) continue;
    const na = { ...doc, werken };
    na.inhoud = straatHash(na);
    zet(file, `${JSON.stringify(na)}\n`, voor);
    const id = naam.slice(0, -5);
    if (straatIndex?.straten && id in straatIndex.straten) { straatIndex.straten[id] = na.inhoud; hashes += 1; }
  }
  if (hashes) zet(straatIndexFile, `${JSON.stringify(straatIndex)}\n`, straatIndexVoor);

  if (write) for (const [file, inhoud] of uit) fs.writeFileSync(file, inhoud, "utf8");
  return rapport;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  try {
    const rapport = opkuisVerhuis({ rootDir, write: process.argv.includes("--write") });
    console.log(JSON.stringify({ write: rapport.write, bestanden: rapport.gewijzigd.length, gewijzigd: rapport.gewijzigd }, null, 2));
  } catch (error) {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  }
}
