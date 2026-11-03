// Eenmalig: de parkeerverboden die de site sinds de start van haar historiek (1 oktober 2026) zelf zag, in het verleden
// van de agenda (site/verleden/parkeerverboden/, lib/agenda-verleden.mjs). Besluit van de eigenaar van 3 november 2026:
// parkeerverboden horen er wel in, als "Parkeerverbod" met de plaats en het exacte huisnummer, nooit de reden.
//
// Bron: alleen de eigen historiek in de repo, zoals ze vóór #232 stond en met #232 teruggedraaid weer staat: de baseline
// van het archief (site/history/archive/baseline.json), elke dag van het archief en de huidige laag
// (site/history/live-layers.json). Geen import uit A-Sign van vóór de start (#222 blijft dicht). Per parkeerverbod de
// laatste stand die de site zag; was het weg vóór zijn laatste dag (een "removed" van vóór het einde), dan `weg`.
// Een record dat de regels niet haalt (plaats niet in de publieke vorm, het woord verhuis), komt er niet in.
//
// Daarna houdt scripts/build-agenda.mjs de lijst bij, bij elke verversing.
//
// Gebruik: node scripts/herstel-parkeerverleden.mjs [--droog]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { officieleStraatnamen } from "../lib/parkeer-historiek.mjs";
import {
  PARKEER_VERLEDEN_DIR,
  isParkeerMaandBestand,
  parkeerBestanden,
  parkeerRecordProblemen,
  parkeerRecordVanItem,
  verledenMaandTekst,
} from "../lib/agenda-verleden.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const droog = process.argv.includes("--droog");
const lees = (relative) => JSON.parse(fs.readFileSync(path.join(rootDir, relative), "utf8"));
const straatnamen = officieleStraatnamen();
const brusselsDag = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const isParkeer = (id) => String(id ?? "").startsWith("parking:");

// Per id de laatste volledige stand die de site zag, en de dag dat het voor het laatst verdween.
const stand = new Map();
const weg = new Map();
const zie = (item) => {
  if (item && isParkeer(item.id)) stand.set(item.id, { ...(stand.get(item.id) ?? {}), ...item });
};
const gebeurtenis = (event) => {
  if (!event || !isParkeer(event.id)) return;
  if (event.type === "removed") {
    zie(event.before);
    weg.set(event.id, brusselsDag(event.observedAt));
  } else {
    zie(event.after);
    weg.delete(event.id);
  }
};

const baseline = lees("site/history/archive/baseline.json");
for (const item of baseline?.layers?.publicSpace?.items ?? []) zie(item);
const index = lees("site/history/archive/index.json");
for (const dag of index.days ?? []) {
  const shard = lees(dag.file);
  for (const event of [...(shard.events ?? [])].sort((a, b) => String(a.observedAt).localeCompare(String(b.observedAt)))) gebeurtenis(event);
}
const live = lees("site/history/live-layers.json");
for (const event of [...(live.changes ?? [])].sort((a, b) => String(a.observedAt).localeCompare(String(b.observedAt)))) gebeurtenis(event);
const huidig = new Set();
for (const item of live?.layers?.publicSpace?.items ?? []) {
  zie(item);
  if (isParkeer(item.id)) {
    huidig.add(item.id);
    weg.delete(item.id);
  }
}

const records = [];
let geweigerd = 0;
for (const [id, item] of stand) {
  const record = parkeerRecordVanItem(item, straatnamen);
  if (!record) {
    geweigerd += 1;
    continue;
  }
  const dag = weg.get(id);
  if (!huidig.has(id) && dag && record.end >= dag) record.weg = dag;
  if (parkeerRecordProblemen(record, straatnamen).length) {
    geweigerd += 1;
    continue;
  }
  records.push(record);
}

// Samenvoegen met wat er al staat: een bestaand record wint.
const dir = path.join(rootDir, PARKEER_VERLEDEN_DIR);
const bestaandeMaanden = fs.existsSync(dir) ? fs.readdirSync(dir).filter(isParkeerMaandBestand).sort() : [];
const perId = new Map(bestaandeMaanden.flatMap((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")).items ?? []).map((record) => [record.id, record]));
let toegevoegd = 0;
for (const record of records) {
  if (perId.has(record.id)) continue;
  perId.set(record.id, record);
  toegevoegd += 1;
}
const { bestanden, lijst } = parkeerBestanden([...perId.values()], bestaandeMaanden.map((name) => name.slice(0, 7)));
if (!droog) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, document] of bestanden) fs.writeFileSync(path.join(dir, name), verledenMaandTekst(document), "utf8");
}
console.log(JSON.stringify({
  droog,
  gezien: stand.size,
  nuInDeLaag: huidig.size,
  weg: records.filter((record) => record.weg).length,
  geweigerd,
  toegevoegd,
  totaal: perId.size,
  maanden: lijst.map((entry) => `${entry.maand}:${entry.aantal}`).join(" "),
}, null, 2));
if (!droog) console.log("Nu: node scripts/build-agenda.mjs (zet de parkeerverboden in site/verleden/maanden.json).");
