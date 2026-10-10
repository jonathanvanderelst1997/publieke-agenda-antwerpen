// Eenmalige opkuis van site/history (live-layers.json en archive/): alleen district Antwerpen en geen
// huisnummers (lib/historiek-privacy.mjs). Daarna houdt de verversing (scripts/refresh-live-history.mjs)
// het zo; ze draait deze opkuis ook zelf vooraf, zodat een oud bestand dat toch terugkomt (bv. uit een
// oudere datatak) bij de volgende verversing schoon wordt. Veilig om opnieuw te draaien: een schoon
// bestand blijft gelijk en wordt niet herschreven.
//
// Wat niet lukt, houdt de rest niet tegen: elk bestand dat na de opkuis geldig is, wordt geschreven.
// Een bestand dat ongeldig zou worden, of een dag die leeg zou worden terwijl wissen niet mag, blijft
// zoals het was en staat in `nietGeschreven`; wat de scan daarna nog vindt, staat in `nogBevindingen`.
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

const tekst = (value) => `${JSON.stringify(value, null, 2)}\n`;
const telling = (document) => {
  const counts = {};
  for (const finding of historiekPrivacyBevindingen(document)) counts[finding.code] = (counts[finding.code] || 0) + 1;
  return counts;
};

// `verwijderLeeg: false` (de verversing): een dag die leeg zou worden, blijft staan (de datatak mag
// geen bestand wissen) en staat in `nietGeschreven`; de andere bestanden worden wel opgekuist.
export function opkuisHistoriekPrivacy({ rootDir, write = false, verwijderLeeg = true } = {}) {
  if (!rootDir) throw new Error("rootDir ontbreekt");
  const liveFile = path.join(rootDir, LIVE_HISTORY_FILE);
  const baselineFile = path.join(rootDir, LIVE_HISTORY_ARCHIVE_BASELINE_FILE);
  const indexFile = path.join(rootDir, LIVE_HISTORY_ARCHIVE_INDEX_FILE);
  const archiveDir = path.join(rootDir, LIVE_HISTORY_ARCHIVE_DIR);
  const dayNames = fs.existsSync(archiveDir) ? fs.readdirSync(archiveDir).filter(isHistoryArchiveDayFileName).sort() : [];

  const rapport = { write, files: {}, nietGeschreven: {}, nogBevindingen: {} };
  // Een kapot bestand blijft staan en houdt de andere niet tegen. De melding noemt alleen het
  // bestand, nooit een stuk van de inhoud (publieke logs).
  const readJson = (file) => {
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      rapport.nietGeschreven[path.relative(rootDir, file)] = "geen geldige JSON";
      return null;
    }
  };
  const live = readJson(liveFile);
  const baseline = readJson(baselineFile);
  const index = readJson(indexFile);
  const days = new Map(dayNames.map((name) => [name, readJson(path.join(archiveDir, name))]).filter(([, day]) => day));

  // Eén opzoeking over alle bestanden: een "changed" zonder adres vindt zo het adres van hetzelfde
  // parkeerverbod in een ander bestand. Blijft het onbekend, dan valt de wijziging weg (de opkuis kan
  // niet bewijzen dat ze in het district ligt).
  const opzoeking = parkeerDistrictOpzoeking([live, baseline, ...days.values()].filter(Boolean));
  const opties = { onbekend: false, opzoeking };

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
  // Een opgekuist bestand dat ongeldig zou worden, blijft zoals het was.
  const geldig = (relative, errors) => {
    if (!errors.length) return true;
    rapport.nietGeschreven[relative] = `ongeldig na de opkuis: ${errors[0]}`;
    return false;
  };

  if (live) {
    const schoon = historiekVoorPubliek(live, opties);
    noteer(LIVE_HISTORY_FILE, live, schoon, (doc) => ({
      works: doc.layers?.works?.items?.length ?? 0,
      publicSpace: doc.layers?.publicSpace?.items?.length ?? 0,
      changes: doc.changes?.length ?? 0,
    }));
    if (geldig(LIVE_HISTORY_FILE, validateLiveHistory(schoon))) uit.set(liveFile, schoon);
  }
  if (baseline) {
    const schoon = archiefBaselineVoorPubliek(baseline);
    noteer(LIVE_HISTORY_ARCHIVE_BASELINE_FILE, baseline, schoon, (doc) => ({
      works: doc.layers?.works?.items?.length ?? 0,
      publicSpace: doc.layers?.publicSpace?.items?.length ?? 0,
    }));
    if (geldig(LIVE_HISTORY_ARCHIVE_BASELINE_FILE, validateHistoryArchiveBaseline(schoon))) uit.set(baselineFile, schoon);
  }
  const leeg = [];
  const gewisteDagen = new Set();
  const schoneDagen = new Map();
  for (const [name, day] of days) {
    const relative = `${LIVE_HISTORY_ARCHIVE_DIR}/${name}`;
    const schoon = archiefDagVoorPubliek(day, opties);
    noteer(relative, day, schoon, (doc) => ({ events: doc.events?.length ?? 0 }));
    if (!geldig(relative, validateHistoryArchiveDay(schoon))) continue;
    if (schoon.events.length) {
      uit.set(path.join(archiveDir, name), schoon);
      schoneDagen.set(schoon.date, schoon);
    } else if (verwijderLeeg) {
      leeg.push(path.join(archiveDir, name));
      gewisteDagen.add(schoon.date);
    } else {
      // De index aanvaardt geen dag met 0 wijzigingen, en de datatak mag niet wissen: deze dag blijft
      // staan (met zijn indexregel), de rest gaat door.
      leeg.push(path.join(archiveDir, name));
      rapport.nietGeschreven[relative] = "zou leeg worden; draai node scripts/opkuis-historiek-privacy.mjs --write in een gewone PR";
    }
  }
  if (index) {
    // Telling en digest opnieuw voor elke dag die geschreven wordt; een gewiste dag valt weg. Een dag
    // die blijft zoals hij was, houdt zijn regel.
    const daysOut = (index.days || [])
      .filter((entry) => !gewisteDagen.has(entry?.date))
      .map((entry) => {
        const day = schoneDagen.get(entry?.date);
        return day ? { ...entry, count: day.events.length, digest: historyArchiveEventsDigest(day.events) } : entry;
      });
    const schoon = { ...index, days: daysOut };
    rapport.files[LIVE_HISTORY_ARCHIVE_INDEX_FILE] = { voor: { days: index.days?.length ?? 0 }, na: { days: daysOut.length } };
    if (geldig(LIVE_HISTORY_ARCHIVE_INDEX_FILE, validateHistoryArchiveIndex(schoon))) uit.set(indexFile, schoon);
  }

  rapport.leegGeworden = leeg.map((file) => path.relative(rootDir, file));
  // Wat de scan na de opkuis nog vindt (normaal niets): het bestand wordt toch geschreven, want het
  // is schoner dan ervoor, en de melding zegt waar het zit.
  for (const [file, document] of uit) {
    const over = historiekPrivacyBevindingen(document).length;
    if (over) rapport.nogBevindingen[path.relative(rootDir, file)] = over;
  }

  const gewijzigd = [...uit].filter(([file, document]) => !fs.existsSync(file) || fs.readFileSync(file, "utf8") !== tekst(document));
  const teWissen = verwijderLeeg ? leeg : [];
  rapport.gewijzigd = [...gewijzigd.map(([file]) => file), ...teWissen].map((file) => path.relative(rootDir, file));
  if (write) {
    for (const [file, document] of gewijzigd) fs.writeFileSync(file, tekst(document), "utf8");
    for (const file of teWissen) fs.rmSync(file);
  }
  return rapport;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  try {
    const rapport = opkuisHistoriekPrivacy({ rootDir, write: process.argv.includes("--write") });
    console.log(JSON.stringify(rapport, null, 2));
    const niet = Object.keys(rapport.nietGeschreven).length;
    const over = Object.values(rapport.nogBevindingen).reduce((sum, aantal) => sum + aantal, 0);
    if (niet || over) {
      console.error(`opkuis gedeeltelijk: ${niet} bestand(en) niet geschreven, ${over} bevinding(en) over (zie nietGeschreven en nogBevindingen)`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  }
}
