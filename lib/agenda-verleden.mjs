// Het verleden van de agenda. Besluit van de eigenaar van 3 november 2026: "vanaf dat we begonnen zijn wel bijhouden in de
// geschiedenis: alles wat ooit in agenda staat, publiek blijft staan, maar verdwijnt dan naar verleden."
//
// Elk agendapunt met een eigen pagina dat de site publiceerde, krijgt een record in site/verleden/<JJJJ-MM>.json (de
// maand van zijn laatste dag) met precies wat de pagina toont. Zo:
// - blijft zijn pagina (site/event/<id>/index.html) bestaan op dezelfde URL, ook als het voorbij is of uit de bron
//   verdwijnt: scripts/build-agenda.mjs wist geen enkele eventpagina meer, en de databaan mag het niet
//   (lib/data-lane-paths.json, deletableUnder zonder site/event/);
// - toont de pagina /verleden/ (site/agenda-verleden.js) alles waarvan de laatste dag voorbij is, het nieuwste eerst.
//
// Parkeerverboden staan er ook in (besluit van de eigenaar van 3 november 2026, later die dag: "die moeten er wel in
// komen. Maar gewoon als parkeerverbod, niet per se de reden. En het huisnummer mocht dan wel."), maar niet als
// agendapunt: een eigen lijst per maand van hun laatste dag, site/verleden/parkeerverboden/<JJJJ-MM>.json, uit de
// publieke-ruimtelaag van de historiek (site/history/live-layers.json). Een record is alleen { id, location, start, end }
// (+ weg): altijd "Parkeerverbod", de plaats zoals de historiek ze bewaart (publiekParkeerAdres: officiële straat met
// het exacte huisnummer, anders de straat met de postcode), nooit een reden, nooit het woord verhuis, nooit een naam
// (parkeerRecordProblemen). Geen import van vóór de start (#222): alleen wat de site zelf zag, sinds de historiek
// begon (1 oktober 2026).
//
// Dezelfde privacyregels als de rest van de site voor de agendapunten: geen e-mail, telefoon, rekening of querystring
// (privacyFindings), nooit het woord verhuis (noemtVerhuis), geen link naar een ruw GIPOD-record. De plaats blijft
// zoals de agenda ze publiceerde, met het exacte huisnummer.
//
// Puur: geen bestanden, geen klok. asOf is de classificatiedatum van de feed (zoals scripts/build-agenda.mjs).
import crypto from "node:crypto";

import { privacyFindings } from "./source-feed.mjs";
import { isParkeerId, isParkeerItem } from "./parkeer-historiek.mjs";
import { isPubliekParkeerAdres, noemtVerhuis, parkeerAdresVoorOpslag } from "../site/adres-privacy.js";
import { ruweGipodLinksIn } from "../site/gipod-bron.js";

export const VERLEDEN_DIR = "site/verleden";
export const VERLEDEN_INDEX_FILE = "site/verleden/maanden.json";
export const VERLEDEN_SCHEMA = 1;
// De eerste publieke release met een eigen pagina per agendapunt (13 augustus 2026). Wat vóór die dag voorbij was,
// staat niet in het verleden: daarvan bewaarde de site geen pagina.
export const VERLEDEN_SINDS = "2026-08-13";

export const isVerledenMaandBestand = (name) => /^\d{4}-(?:0[1-9]|1[0-2])\.json$/.test(String(name));

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DAG = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const SLEUTELS = Object.freeze([
  "id", "title", "info", "date", "endDate", "dateLabel", "timeText", "timeSlot", "location", "theme", "scope", "inDistrict",
  "sourceId", "sourcePublisher", "bronnen", "attributie", "sinds", "weg", "opgegaanIn",
]);
const LENGTES = Object.freeze({ title: 300, info: 1000, dateLabel: 200, timeText: 300, timeSlot: 10, location: 400, theme: 40, sourcePublisher: 200, attributie: 300 });
const TEKSTVELDEN = Object.freeze(["title", "info", "dateLabel", "timeText", "location", "sourcePublisher", "attributie"]);

export const laatsteDag = (record) => (record.endDate && record.endDate > record.date ? record.endDate : record.date);
export const maandVan = (record) => laatsteDag(record).slice(0, 7);

function veiligeHttps(url) {
  try {
    const parsed = new URL(String(url ?? ""));
    return parsed.protocol === "https:" && !parsed.search && !parsed.hash && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

// Wat er aan een record van een agendapunt niet klopt: vorm of privacy. Codes en paden, nooit de waarde (de logs zijn
// publiek). Een parkeerverbod is geen agendapunt: dat heeft zijn eigen lijst (parkeerRecordProblemen).
export function verledenRecordProblemen(record, at = "record") {
  const fouten = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) return [`${at}: geen object`];
  for (const key of Object.keys(record)) if (!SLEUTELS.includes(key)) fouten.push(`${at}: onbekende sleutel ${key}`);
  if (typeof record.id !== "string" || !ID.test(record.id) || record.id.length > 160) fouten.push(`${at}: ongeldige id`);
  if (typeof record.title !== "string" || !record.title.trim()) fouten.push(`${at}: titel ontbreekt`);
  for (const [veld, max] of Object.entries(LENGTES)) {
    if (typeof record[veld] !== "string" || record[veld].length > max) fouten.push(`${at}: ongeldig ${veld}`);
  }
  if (!DAG.test(String(record.date ?? ""))) fouten.push(`${at}: ongeldige datum`);
  if (record.endDate !== null && (!DAG.test(String(record.endDate ?? "")) || record.endDate < record.date)) fouten.push(`${at}: ongeldige endDate`);
  if (!["district", "stad"].includes(record.scope)) fouten.push(`${at}: ongeldige scope`);
  if ("inDistrict" in record && typeof record.inDistrict !== "boolean") fouten.push(`${at}: ongeldige inDistrict`);
  if (typeof record.sourceId !== "string" || !/^[a-z0-9-]{1,80}$/.test(record.sourceId)) fouten.push(`${at}: ongeldige sourceId`);
  if (!Array.isArray(record.bronnen) || record.bronnen.length > 12
    || !record.bronnen.every((bron) => bron && typeof bron === "object" && Object.keys(bron).every((k) => k === "url" || k === "label")
      && veiligeHttps(bron.url) && typeof bron.label === "string" && bron.label.trim() && bron.label.length <= 200)) {
    fouten.push(`${at}: ongeldige bronnen`);
  }
  if (!DAG.test(String(record.sinds ?? ""))) fouten.push(`${at}: ongeldige sinds`);
  if ("weg" in record && !DAG.test(String(record.weg ?? ""))) fouten.push(`${at}: ongeldige weg`);
  if ("opgegaanIn" in record && (typeof record.opgegaanIn !== "string" || !ID.test(record.opgegaanIn) || record.opgegaanIn === record.id)) fouten.push(`${at}: ongeldige opgegaanIn`);
  // Privacy en de regels van de eigenaar.
  if (isParkeerItem(record)) fouten.push(`${at}: een parkeerverbod hoort in de lijst van de parkeerverboden`);
  for (const finding of privacyFindings(record, at)) fouten.push(`${finding.path}: privacy ${finding.code}`);
  if (TEKSTVELDEN.some((veld) => noemtVerhuis(record[veld]))) fouten.push(`${at}: privacy verhuis`);
  if (ruweGipodLinksIn(JSON.stringify(record)).length) fouten.push(`${at}: link naar een ruw GIPOD-record`);
  return fouten;
}

const vouw = (tekst) => String(tekst ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const sleutel = (record) => `${record.sourceId}|${vouw(record.title)}|${record.date}`;
const reeks = (record) => `${record.sourceId}|${vouw(record.title)}`;

function vergelijk(a, b) {
  return laatsteDag(a).localeCompare(laatsteDag(b)) || a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
}

// Hetzelfde punt onder twee ids (een bron die zijn ids hernummert, of een samengevoegd punt dat een andere hoofdbron
// krijgt): het oude record "gaat op in" het nieuwe. Het blijft bestaan (zijn pagina wijst naar het nieuwe) maar staat
// niet dubbel in het verleden.
function ontdubbel(records, actueleIds) {
  const perId = new Map(records.map((record) => [record.id, record]));
  const perSleutel = new Map();
  for (const record of records) {
    const k = sleutel(record);
    if (!perSleutel.has(k)) perSleutel.set(k, []);
    perSleutel.get(k).push(record);
  }
  // Een hoofdlink is specifiek als alle records die ze als eerste bron hebben, hetzelfde punt (bron en titel) zijn:
  // een algemene kalenderpagina of de GIPOD-datasetfiche is dat niet.
  const reeksenPerLink = new Map();
  for (const record of records) {
    const url = record.bronnen?.[0]?.url;
    if (!url) continue;
    if (!reeksenPerLink.has(url)) reeksenPerLink.set(url, new Set());
    reeksenPerLink.get(url).add(reeks(record));
  }
  const winnaarRang = (record) => [actueleIds.has(record.id) ? 1 : 0, record.weg ? 0 : 1, record.weg ?? "", record.sinds ?? "", record.id];
  const beter = (a, b) => {
    const ra = winnaarRang(a), rb = winnaarRang(b);
    for (let i = 0; i < ra.length; i += 1) if (ra[i] !== rb[i]) return ra[i] > rb[i];
    return false;
  };
  for (const record of records) {
    if (actueleIds.has(record.id)) {
      delete record.opgegaanIn;
      continue;
    }
    if (record.opgegaanIn && perId.has(record.opgegaanIn) && record.opgegaanIn !== record.id) continue;
    delete record.opgegaanIn;
    // Een evenementendossier van de stad (A-Sign) is zijn eigen punt: twee dossiers met dezelfde gemaakte titel op
    // dezelfde dag ("Vermoedelijk een buurtfeest in de Xstraat") zijn niet vanzelf hetzelfde evenement.
    const groep = record.sourceId === "district-asign-evenementen" ? [record] : perSleutel.get(sleutel(record));
    const winnaar = groep.reduce((best, kandidaat) => (beter(kandidaat, best) ? kandidaat : best), groep[0]);
    if (winnaar.id !== record.id) {
      record.opgegaanIn = winnaar.id;
      continue;
    }
    // Over bronnen heen: alleen een punt dat vóór zijn einde uit de agenda viel, met een specifieke hoofdlink die nu
    // bij precies één actueel punt van dezelfde dag als bron staat.
    const url = record.weg ? record.bronnen?.[0]?.url : null;
    if (!url || reeksenPerLink.get(url)?.size !== 1) continue;
    const kandidaten = records.filter((ander) => actueleIds.has(ander.id) && ander.date === record.date && ander.bronnen.some((bron) => bron.url === url));
    if (kandidaten.length === 1) record.opgegaanIn = kandidaten[0].id;
  }
  // Geen ketens: wijst het doel zelf door, dan naar het eindpunt (hoogstens een paar stappen).
  for (const record of records) {
    const gezien = new Set([record.id]);
    while (record.opgegaanIn && perId.get(record.opgegaanIn)?.opgegaanIn && !gezien.has(record.opgegaanIn)) {
      gezien.add(record.opgegaanIn);
      record.opgegaanIn = perId.get(record.opgegaanIn).opgegaanIn;
    }
    if (record.opgegaanIn === record.id) delete record.opgegaanIn;
  }
}

// De nieuwe stand van het verleden. `vorige`: de records van de vorige stand; `actueel`: een record per agendapunt
// met een eigen pagina dat nu publiek is (zonder sinds/weg/opgegaanIn); asOf: de classificatiedatum.
// - een actueel punt: zijn record wordt bijgewerkt met wat de pagina nu toont; `sinds` blijft de eerste dag;
// - een punt dat niet meer actueel is: het record blijft zoals het laatst was. Viel het weg vóór zijn laatste dag,
//   dan krijgt het `weg` (de eerste dag dat het er niet meer stond); komt het terug, dan valt `weg` weer weg.
// Een record met een probleem (verledenRecordProblemen) komt er niet in. Deterministisch en idempotent.
export function werkVerledenBij(vorige, actueel, asOf) {
  if (!DAG.test(String(asOf ?? ""))) throw new Error("werkVerledenBij: ongeldige asOf");
  const oud = new Map((Array.isArray(vorige) ? vorige : []).map((record) => [record.id, record]));
  const uit = new Map();
  const actueleIds = new Set();
  const geweigerd = [];
  for (const item of Array.isArray(actueel) ? actueel : []) {
    if (!item || uit.has(item.id)) continue;
    const { weg, opgegaanIn, sinds, ...schoon } = item;
    const vorig = oud.get(item.id);
    const record = { ...schoon, sinds: vorig?.sinds && vorig.sinds <= asOf ? vorig.sinds : asOf };
    const problemen = verledenRecordProblemen(record);
    if (problemen.length) {
      geweigerd.push({ id: String(item.id ?? ""), problemen });
      continue;
    }
    uit.set(record.id, record);
    actueleIds.add(record.id);
  }
  for (const [id, vorig] of oud) {
    if (uit.has(id)) continue;
    const record = { ...vorig };
    if (!record.weg && laatsteDag(record) >= asOf) record.weg = asOf;
    if (verledenRecordProblemen(record).length) {
      geweigerd.push({ id, problemen: verledenRecordProblemen(record) });
      continue;
    }
    uit.set(id, record);
  }
  const records = [...uit.values()];
  ontdubbel(records, actueleIds);
  return { records: records.sort(vergelijk), actueleIds, geweigerd };
}

// Welke stand een eventpagina heeft (lib/eventpagina.mjs).
export function paginaStand(record, { actueel, asOf }) {
  if (actueel) return "actueel";
  if (record.opgegaanIn) return "opgegaan";
  if (laatsteDag(record) < asOf) return "voorbij";
  return "weg";
}

export function verledenDigest(items) {
  return crypto.createHash("sha256").update(JSON.stringify(items)).digest("hex");
}

// De bestanden: één per maand (de maand van de laatste dag) en een index. `bestaandeMaanden`: de maanden die al een
// bestand hebben; die blijven (desnoods leeg), want de databaan wist niets onder site/verleden/.
export function verledenBestanden(records, asOf, bestaandeMaanden = []) {
  const perMaand = new Map(bestaandeMaanden.map((maand) => [maand, []]));
  for (const record of [...records].sort(vergelijk)) {
    const maand = maandVan(record);
    if (!perMaand.has(maand)) perMaand.set(maand, []);
    perMaand.get(maand).push(record);
  }
  const maanden = [...perMaand.keys()].sort();
  const bestanden = new Map();
  for (const maand of maanden) bestanden.set(`${maand}.json`, { schemaVersion: VERLEDEN_SCHEMA, maand, items: perMaand.get(maand) });
  const index = {
    schemaVersion: VERLEDEN_SCHEMA,
    sinds: VERLEDEN_SINDS,
    bijgewerkt: asOf,
    aantal: records.length,
    maanden: maanden.map((maand) => ({ maand, aantal: perMaand.get(maand).length, digest: verledenDigest(perMaand.get(maand)) })),
  };
  return { index, bestanden };
}

// Een maandbestand met één record per regel: een verversing die één punt wijzigt, wijzigt één regel.
export function verledenMaandTekst(document) {
  const kop = `{"schemaVersion":${JSON.stringify(document.schemaVersion)},"maand":${JSON.stringify(document.maand)},"items":[`;
  if (!document.items.length) return `${kop}]}\n`;
  return `${kop}\n${document.items.map((record) => JSON.stringify(record)).join(",\n")}\n]}\n`;
}

export function validateVerledenIndex(index) {
  const fouten = [];
  if (!index || typeof index !== "object" || Array.isArray(index)) return ["geen object"];
  if (index.schemaVersion !== VERLEDEN_SCHEMA) fouten.push("schemaVersion");
  if (index.sinds !== VERLEDEN_SINDS) fouten.push("sinds");
  if (!DAG.test(String(index.bijgewerkt ?? ""))) fouten.push("bijgewerkt");
  if (!Array.isArray(index.maanden)) return [...fouten, "maanden"];
  const lijstFouten = (lijst, naam) => {
    let vorige = "";
    let totaal = 0;
    lijst.forEach((entry, i) => {
      if (!entry || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(String(entry.maand ?? "")) || entry.maand <= vorige) fouten.push(`${naam}[${i}]: maand`);
      if (!Number.isInteger(entry?.aantal) || entry.aantal < 0) fouten.push(`${naam}[${i}]: aantal`);
      if (!/^[0-9a-f]{64}$/.test(String(entry?.digest ?? ""))) fouten.push(`${naam}[${i}]: digest`);
      vorige = String(entry?.maand ?? vorige);
      totaal += Number.isInteger(entry?.aantal) ? entry.aantal : 0;
    });
    return totaal;
  };
  // De parkeerverboden (site/verleden/parkeerverboden/): een eigen lijst met hun eigen totaal.
  if ("parkeerverboden" in index || "parkeerAantal" in index) {
    if (!Array.isArray(index.parkeerverboden)) fouten.push("parkeerverboden");
    else if (lijstFouten(index.parkeerverboden, "parkeerverboden") !== index.parkeerAantal) fouten.push("parkeerAantal");
  }
  let vorige = "";
  let totaal = 0;
  index.maanden.forEach((entry, i) => {
    if (!entry || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(String(entry.maand ?? "")) || entry.maand <= vorige) fouten.push(`maanden[${i}]: maand`);
    // Een maand kan leeg worden (een punt verschuift naar een andere maand); het bestand blijft dan, want de databaan
    // wist niets onder site/verleden/.
    if (!Number.isInteger(entry?.aantal) || entry.aantal < 0) fouten.push(`maanden[${i}]: aantal`);
    if (!/^[0-9a-f]{64}$/.test(String(entry?.digest ?? ""))) fouten.push(`maanden[${i}]: digest`);
    vorige = String(entry?.maand ?? vorige);
    totaal += Number.isInteger(entry?.aantal) ? entry.aantal : 0;
  });
  if (index.aantal !== totaal) fouten.push("aantal");
  return fouten;
}

export function validateVerledenMaand(document, maand) {
  const fouten = [];
  if (!document || typeof document !== "object" || Array.isArray(document)) return ["geen object"];
  if (document.schemaVersion !== VERLEDEN_SCHEMA) fouten.push("schemaVersion");
  if (document.maand !== maand) fouten.push("maand");
  if (!Array.isArray(document.items)) return [...fouten, "items"];
  const ids = new Set();
  document.items.forEach((record, i) => {
    fouten.push(...verledenRecordProblemen(record, `items[${i}]`));
    if (ids.has(record?.id)) fouten.push(`items[${i}]: dubbele id`);
    ids.add(record?.id);
    if (record?.date && maandVan(record) !== maand) fouten.push(`items[${i}]: hoort in een andere maand`);
  });
  return fouten;
}

// ---------- parkeerverboden ----------

export const PARKEER_VERLEDEN_DIR = "site/verleden/parkeerverboden";
export const isParkeerMaandBestand = isVerledenMaandBestand;
const PARKEER_ID = /^parking:[A-Za-z0-9-]{1,40}\|[A-Za-z0-9-]{1,40}$/;
const PARKEER_SLEUTELS = Object.freeze(["id", "location", "start", "end", "weg"]);

const brusselsDag = (iso) => {
  const ms = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(ms)) return "";
  const delen = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(ms)).map((deel) => [deel.type, deel.value]));
  return `${delen.year}-${delen.month}-${delen.day}`;
};

// Een parkeerverbod uit de historiek (site/history/live-layers.json, al opgekuist door lib/parkeer-historiek.mjs) als
// record, of null. De plaats nog eens door parkeerAdresVoorOpslag: alleen de vorm van publiekParkeerAdres of de straat
// met de postcode blijft over.
export function parkeerRecordVanItem(item, straatnamen = null) {
  if (!isParkeerItem(item) || !PARKEER_ID.test(String(item.id))) return null;
  const straat = Array.isArray(item.streets) && typeof item.streets[0]?.name === "string" ? item.streets[0].name : "";
  const location = parkeerAdresVoorOpslag(item.location, straatnamen, { straat });
  const start = brusselsDag(item.start);
  const end = brusselsDag(item.end) || start;
  if (!location || !DAG.test(start) || !DAG.test(end) || end < start) return null;
  return { id: item.id, location, start, end };
}

export function parkeerRecordProblemen(record, straatnamen = null, at = "record") {
  const fouten = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) return [`${at}: geen object`];
  for (const key of Object.keys(record)) if (!PARKEER_SLEUTELS.includes(key)) fouten.push(`${at}: onbekende sleutel ${key}`);
  if (!PARKEER_ID.test(String(record.id ?? "")) || !isParkeerId(record.id)) fouten.push(`${at}: ongeldige id`);
  if (!DAG.test(String(record.start ?? "")) || !DAG.test(String(record.end ?? "")) || record.end < record.start) fouten.push(`${at}: ongeldige periode`);
  if ("weg" in record && !DAG.test(String(record.weg ?? ""))) fouten.push(`${at}: ongeldige weg`);
  // De plaats: de vorm van publiekParkeerAdres (straat + exact huisnummer) of de straat met de postcode, niets anders.
  const plaats = String(record.location ?? "");
  if (!plaats || plaats.length > 220 || (!isPubliekParkeerAdres(plaats, straatnamen) && parkeerAdresVoorOpslag(plaats, straatnamen) !== plaats)) fouten.push(`${at}: plaats niet in de publieke vorm`);
  if (noemtVerhuis(plaats)) fouten.push(`${at}: privacy verhuis`);
  for (const finding of privacyFindings(record, at)) fouten.push(`${finding.path}: privacy ${finding.code}`);
  return fouten;
}

const parkeerVolgorde = (a, b) => a.end.localeCompare(b.end) || a.location.localeCompare(b.location) || a.id.localeCompare(b.id);

// De nieuwe stand van de parkeerverboden. `actueel`: de parkeerverboden van de publieke-ruimtelaag van deze verversing;
// `volledig`: die laag laadde (status ok). Een parkeerverbod dat er niet meer is: het record blijft; viel het weg vóór
// zijn laatste dag (en laadde de laag), dan krijgt het `weg`. Deterministisch en idempotent.
export function werkParkeerverledenBij(vorige, actueel, asOf, { volledig = true, straatnamen = null } = {}) {
  if (!DAG.test(String(asOf ?? ""))) throw new Error("werkParkeerverledenBij: ongeldige asOf");
  const uit = new Map();
  let geweigerd = 0;
  for (const record of Array.isArray(actueel) ? actueel : []) {
    if (!record || uit.has(record.id)) continue;
    const { weg, ...schoon } = record;
    if (parkeerRecordProblemen(schoon, straatnamen).length) {
      geweigerd += 1;
      continue;
    }
    uit.set(schoon.id, schoon);
  }
  for (const vorig of Array.isArray(vorige) ? vorige : []) {
    if (!vorig || uit.has(vorig.id)) continue;
    const record = { ...vorig };
    if (volledig && !record.weg && record.end >= asOf) record.weg = asOf;
    if (parkeerRecordProblemen(record, straatnamen).length) {
      geweigerd += 1;
      continue;
    }
    uit.set(record.id, record);
  }
  return { records: [...uit.values()].sort(parkeerVolgorde), geweigerd };
}

export function parkeerBestanden(records, bestaandeMaanden = []) {
  const perMaand = new Map(bestaandeMaanden.map((maand) => [maand, []]));
  for (const record of [...records].sort(parkeerVolgorde)) {
    const maand = record.end.slice(0, 7);
    if (!perMaand.has(maand)) perMaand.set(maand, []);
    perMaand.get(maand).push(record);
  }
  const maanden = [...perMaand.keys()].sort();
  const bestanden = new Map(maanden.map((maand) => [`${maand}.json`, { schemaVersion: VERLEDEN_SCHEMA, maand, items: perMaand.get(maand) }]));
  const lijst = maanden.map((maand) => ({ maand, aantal: perMaand.get(maand).length, digest: verledenDigest(perMaand.get(maand)) }));
  return { bestanden, lijst };
}

export function validateParkeerMaand(document, maand, straatnamen = null) {
  const fouten = [];
  if (!document || typeof document !== "object" || Array.isArray(document)) return ["geen object"];
  if (document.schemaVersion !== VERLEDEN_SCHEMA) fouten.push("schemaVersion");
  if (document.maand !== maand) fouten.push("maand");
  if (!Array.isArray(document.items)) return [...fouten, "items"];
  const ids = new Set();
  document.items.forEach((record, i) => {
    fouten.push(...parkeerRecordProblemen(record, straatnamen, `items[${i}]`));
    if (ids.has(record?.id)) fouten.push(`items[${i}]: dubbele id`);
    ids.add(record?.id);
    if (String(record?.end ?? "").slice(0, 7) !== maand) fouten.push(`items[${i}]: hoort in een andere maand`);
  });
  return fouten;
}
