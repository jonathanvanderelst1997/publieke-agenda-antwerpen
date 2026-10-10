// Eenmalige opkuis van site/history (live-layers.json en archive/): alleen district Antwerpen en geen
// huisnummers (lib/historiek-privacy.mjs). Daarna houdt de verversing (scripts/refresh-live-history.mjs)
// het zo. Veilig om opnieuw te draaien: een schoon bestand blijft gelijk.
//
//   node scripts/opkuis-historiek-privacy.mjs          toont alleen de tellingen
//   node scripts/opkuis-historiek-privacy.mjs --write  schrijft de bestanden
//
// Dit verandert alleen de huidige bestanden. Oudere versies blijven in de git-geschiedenis staan.
// De uitvoer toont nooit een adres, alleen aantallen en bestandsnamen.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  archiefBaselineVoorPubliek,
  archiefDagVoorPubliek,
  historiekPrivacyBevindingen,
  historiekVoorPubliek,
  parkeerDistrictOpzoeking,
} from "../lib/historiek-privacy.mjs";
import { LIVE_HISTORY_FILE, validateLiveHistory } from "../lib/live-history.mjs";
import {
  LIVE_HISTORY_ARCHIVE_BASELINE_FILE,
  LIVE_HISTORY_ARCHIVE_DIR,
  LIVE_HISTORY_ARCHIVE_INDEX_FILE,
  historyArchiveEventsDigest,
  isHistoryArchiveDayFileName,
  validateHistoryArchiveBaseline,
  validateHistoryArchiveDay,
  validateHistoryArchiveIndex,
} from "../lib/live-history-archive.mjs";

const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null);
const tekst = (value) => `${JSON.stringify(value, null, 2)}\n`;
const telling = (document) => {
  const counts = {};
  for (const finding of historiekPrivacyBevindingen(document)) counts[finding.code] = (counts[finding.code] || 0) + 1;
  return counts;
};

export function opkuisHistoriekPrivacy({ rootDir, write = false } = {}) {
  if (!rootDir) throw new Error("rootDir ontbreekt");
  const liveFile = path.join(rootDir, LIVE_HISTORY_FILE);
  const baselineFile = path.join(rootDir, LIVE_HISTORY_ARCHIVE_BASELINE_FILE);
  const indexFile = path.join(rootDir, LIVE_HISTORY_ARCHIVE_INDEX_FILE);
  const archiveDir = path.join(rootDir, LIVE_HISTORY_ARCHIVE_DIR);
  const dayNames = fs.existsSync(archiveDir) ? fs.readdirSync(archiveDir).filter(isHistoryArchiveDayFileName).sort() : [];

  const live = readJson(liveFile);
  const baseline = readJson(baselineFile);
  const index = readJson(indexFile);
  const days = new Map(dayNames.map((name) => [name, readJson(path.join(archiveDir, name))]));

  // Eén opzoeking over alle bestanden: een "changed" zonder adres vindt zo het adres van hetzelfde
  // parkeerverbod in een ander bestand. Blijft het onbekend, dan valt de wijziging weg (de opkuis kan
  // niet bewijzen dat ze in het district ligt).
  const opzoeking = parkeerDistrictOpzoeking([live, baseline, ...days.values()].filter(Boolean));
  const opties = { onbekend: false, opzoeking };

  const rapport = { write, files: {} };
  const uit = new Map();
  const noteer = (relative, before, after, aantal) => {
    rapport.files[relative] = {
      voor: aantal(before),
      na: aantal(after),
      bevindingenVoor: telling(before),
      bevindingenNa: telling(after),
      bytesVoor: Buffer.byteLength(tekst(before)),
      bytesNa: after ? Buffer.byteLength(tekst(after)) : 0,
    };
  };

  if (live) {
    const schoon = historiekVoorPubliek(live, opties);
    const errors = validateLiveHistory(schoon);
    if (errors.length) throw new Error(`${LIVE_HISTORY_FILE}: ${errors[0]}`);
    noteer(LIVE_HISTORY_FILE, live, schoon, (doc) => ({
      works: doc.layers?.works?.items?.length ?? 0,
      publicSpace: doc.layers?.publicSpace?.items?.length ?? 0,
      changes: doc.changes?.length ?? 0,
    }));
    uit.set(liveFile, schoon);
  }
  if (baseline) {
    const schoon = archiefBaselineVoorPubliek(baseline);
    const errors = validateHistoryArchiveBaseline(schoon);
    if (errors.length) throw new Error(`${LIVE_HISTORY_ARCHIVE_BASELINE_FILE}: ${errors[0]}`);
    noteer(LIVE_HISTORY_ARCHIVE_BASELINE_FILE, baseline, schoon, (doc) => ({
      works: doc.layers?.works?.items?.length ?? 0,
      publicSpace: doc.layers?.publicSpace?.items?.length ?? 0,
    }));
    uit.set(baselineFile, schoon);
  }
  const leeg = [];
  const schoneDagen = new Map();
  for (const [name, day] of days) {
    const relative = `${LIVE_HISTORY_ARCHIVE_DIR}/${name}`;
    const schoon = archiefDagVoorPubliek(day, opties);
    const errors = validateHistoryArchiveDay(schoon);
    if (errors.length) throw new Error(`${relative}: ${errors[0]}`);
    noteer(relative, day, schoon, (doc) => ({ events: doc.events?.length ?? 0 }));
    schoneDagen.set(schoon.date, schoon);
    if (schoon.events.length) uit.set(path.join(archiveDir, name), schoon);
    else leeg.push(path.join(archiveDir, name));
  }
  if (index) {
    // Telling en digest per dag opnieuw; een dag zonder wijzigingen telt niet meer mee.
    const daysOut = (index.days || [])
      .map((entry) => {
        const day = schoneDagen.get(entry?.date);
        if (!day) return entry;
        return day.events.length ? { ...entry, count: day.events.length, digest: historyArchiveEventsDigest(day.events) } : null;
      })
      .filter(Boolean);
    const schoon = { ...index, days: daysOut };
    const errors = validateHistoryArchiveIndex(schoon);
    if (errors.length) throw new Error(`${LIVE_HISTORY_ARCHIVE_INDEX_FILE}: ${errors[0]}`);
    rapport.files[LIVE_HISTORY_ARCHIVE_INDEX_FILE] = { voor: { days: index.days?.length ?? 0 }, na: { days: daysOut.length } };
    uit.set(indexFile, schoon);
  }

  const over = [...uit.values()].reduce((sum, doc) => sum + historiekPrivacyBevindingen(doc).length, 0);
  if (over) throw new Error(`na de opkuis blijven ${over} bevindingen over; er is niets geschreven`);
  rapport.leegGeworden = leeg.map((file) => path.relative(rootDir, file));

  if (write) {
    for (const [file, document] of uit) fs.writeFileSync(file, tekst(document), "utf8");
    for (const file of leeg) fs.rmSync(file);
  }
  return rapport;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  try {
    console.log(JSON.stringify(opkuisHistoriekPrivacy({ rootDir, write: process.argv.includes("--write") }), null, 2));
  } catch (error) {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  }
}
