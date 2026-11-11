// Eenmalig herstel van het verleden van de agenda uit de git-geschiedenis (besluit van de eigenaar van 3 november 2026:
// "alles wat ooit in agenda staat, publiek blijft staan, maar verdwijnt dan naar verleden").
//
// Tot 3 november 2026 wiste scripts/build-agenda.mjs de pagina van elk item dat niet meer publiek was. Dit script
// haalt die pagina's terug, maar alleen uit wat de site zelf publiceerde: de laatste versie van elke eventpagina
// (site/event/<id>/index.html) in de geschiedenis van deze branch. Geen reconstructie: wat nooit een pagina had, komt
// er niet in. De eerste pagina's dateren van 13 augustus 2026 (VERLEDEN_SINDS).
//
// Per verdwenen pagina een record in site/verleden/ (lib/agenda-verleden.mjs) met wat de pagina toonde; de soort, de
// bron en het district komen uit de feed van diezelfde commit (site/agenda-feed.js), anders uit de handmatige items.
// `sinds` is de eerste dag dat de pagina bestond; `weg` de dag dat ze verdween, als dat vóór de laatste dag van het
// item was. Een record dat de huidige regels niet haalt (privacy, het woord verhuis, een ruwe GIPOD-link, iets dat op
// een parkeerverbod lijkt) komt er niet in; het script zegt hoeveel en waarom, zonder de waarde.
//
// Daarna bouwt `node scripts/build-agenda.mjs` de pagina's opnieuw (met hun stand: voorbij, weg of opgegaan).
//
// Gebruik: node scripts/herstel-verleden.mjs [--droog]
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { loadHandAgendaItems, loadRefreshEngine } from "./agenda-source.mjs";
import { leesEventpagina } from "../lib/eventpagina.mjs";
import {
  VERLEDEN_DIR,
  VERLEDEN_INDEX_FILE,
  isVerledenMaandBestand,
  laatsteDag,
  verledenBestanden,
  verledenMaandTekst,
  verledenRecordProblemen,
} from "../lib/agenda-verleden.mjs";
import { GIPOD_BRON, GIPOD_METADATA_URL, gipodLink } from "../site/gipod-bron.js";
import { privacyFindings } from "../lib/source-feed.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const droog = process.argv.includes("--droog");
const git = (...args) => execFileSync("git", args, { cwd: rootDir, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
const gitOfLeeg = (...args) => {
  try {
    return git(...args);
  } catch {
    return "";
  }
};

const PAD = /^site\/event\/([a-z0-9]+(?:-[a-z0-9]+)*)\/index\.html$/;
const brusselsDag = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

// De geschiedenis van site/event, oudste eerst: per commit de toegevoegde en gewiste pagina's.
const log = git("log", "--reverse", "--format=C%x09%H%x09%cI", "--name-status", "--no-renames", "HEAD", "--", "site/event");
const eerste = new Map(); // id -> commit waarin de pagina het eerst verscheen
const laatsteWis = new Map(); // id -> commit die ze het laatst wiste
let commit = null;
for (const regel of log.split("\n")) {
  if (regel.startsWith("C\t")) {
    const [, hash, wanneer] = regel.split("\t");
    commit = { hash, wanneer };
    continue;
  }
  const [status, pad] = regel.split("\t");
  const id = PAD.exec(pad ?? "")?.[1];
  if (!id || !commit) continue;
  if (status === "A" && !eerste.has(id)) eerste.set(id, commit);
  if (status === "D") laatsteWis.set(id, commit);
}

// De classificatiedatum van de site op een commit (het manifest), anders de dag van de commit in Brussel.
const asOfCache = new Map();
function asOfOp(c) {
  if (!asOfCache.has(c.hash)) {
    let asOf = null;
    try {
      asOf = JSON.parse(gitOfLeeg("show", `${c.hash}:site/public-agenda-manifest.json`) || "null")?.classificationAsOf ?? null;
    } catch {
      asOf = null;
    }
    asOfCache.set(c.hash, /^\d{4}-\d{2}-\d{2}$/.test(String(asOf)) ? asOf : brusselsDag(c.wanneer));
  }
  return asOfCache.get(c.hash);
}

// De feed-items van een commit (site/agenda-feed.js), per id.
const feedCache = new Map();
function feedItemsOp(hash) {
  if (!feedCache.has(hash)) {
    const bron = gitOfLeeg("show", `${hash}:site/agenda-feed.js`);
    const items = new Map();
    if (bron) {
      const context = { window: {} };
      vm.createContext(context);
      try {
        vm.runInContext(bron, context, { timeout: 5_000 });
        for (const item of context.window.PUBLIC_AGENDA_FEED?.items ?? []) items.set(item.id, item);
      } catch {
        // een onleesbare feed: dan de handmatige items of het voorvoegsel
      }
    }
    feedCache.set(hash, items);
  }
  return feedCache.get(hash);
}

// De handmatige items (site/agenda.js) staan er nog, met hun bronregel (site/agenda-refresh.js); hun id kan sinds
// augustus veranderd zijn, dus ook op titel en dag.
const engine = loadRefreshEngine(rootDir);
const vouw = (tekst) => String(tekst ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const handLijst = loadHandAgendaItems(rootDir).map((item) => engine.classifyAgendaItem(item, item.date, { ignoreManualCheck: true }));
const handItems = new Map(handLijst.map((item) => [item.id, item]));
const handOpTitel = new Map(handLijst.map((item) => [`${vouw(item.title)}|${item.date}`, item]));
const VOORVOEGSELS = [
  ["markt-", "stad-markten"], ["foor-", "district-foren"], ["asign-ev-", "district-asign-evenementen"], ["district-kal-", "district-kalender"],
  ["district-news-", "district-nieuws"], ["district-vergadering-", "district-vergaderingen"], ["stad-news-", "stad-districten"],
  ["koopzondag-", "stad-koopzondagen"], ["project-", "district-projecten"], ["schoolstraat-", "district-schoolstraten"],
  ["ebesluit-ev-", "district-ebesluit-evenementen"], ["stad-ebesluit-ev-", "stad-ebesluit-evenementen"], ["ebesluit-", "district-ebesluit"],
];

const huidig = new Set(fs.existsSync(path.join(rootDir, "site", "event"))
  ? fs.readdirSync(path.join(rootDir, "site", "event"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  : []);

const hersteld = [];
const geweigerd = new Map();
for (const [id, wis] of laatsteWis) {
  if (huidig.has(id)) continue;
  const html = gitOfLeeg("show", `${wis.hash}^:site/event/${id}/index.html`);
  const pagina = html ? leesEventpagina(html) : null;
  if (!pagina || !/^\d{4}-\d{2}-\d{2}$/.test(pagina.date)) {
    geweigerd.set("onleesbare pagina", (geweigerd.get("onleesbare pagina") ?? 0) + 1);
    continue;
  }
  const item = feedItemsOp(`${wis.hash}^`).get(id) ?? handItems.get(id) ?? handOpTitel.get(`${vouw(pagina.title)}|${pagina.date}`) ?? null;
  const sourceId = item?.sourceId ?? VOORVOEGSELS.find(([voor]) => id.startsWith(voor))?.[1] ?? "historical-stored-source";
  // Zonder item: district, tenzij de naamsvermelding van de pagina een andere bron van de stad noemt (de handmatige
  // agenda was de agenda van district Antwerpen).
  const scope = item?.scope === "stad" ? "stad" : item?.scope === "district" ? "district" : /^Bron: (?:stad|districten)\b/.test(pagina.attributie) ? "stad" : "district";
  // De bronlinks zoals de pagina ze toonde, met de regel van vandaag voor GIPOD (nooit een ruw record).
  const gezien = new Set();
  const bronnen = [];
  for (const bron of pagina.bronnen) {
    // Een link die de regels van vandaag niet haalt (een trackinglink uit een nieuwsbrief, een querystring), valt weg;
    // de rest van het punt blijft.
    if (privacyFindings(bron).length) continue;
    const gipod = gipodLink(bron.url);
    const url = gipod ? GIPOD_METADATA_URL : bron.url;
    if (gezien.has(url)) continue;
    gezien.add(url);
    bronnen.push({ url, label: gipod ? GIPOD_BRON : bron.label });
  }
  const record = {
    id,
    title: pagina.title,
    info: pagina.info,
    date: pagina.date,
    endDate: pagina.endDate && pagina.endDate >= pagina.date ? pagina.endDate : null,
    dateLabel: pagina.dateLabel,
    timeText: pagina.timeText,
    timeSlot: String(item?.timeSlot ?? ""),
    location: pagina.location,
    theme: String(item?.theme ?? ""),
    scope,
    ...(typeof item?.inDistrict === "boolean" ? { inDistrict: item.inDistrict } : {}),
    sourceId,
    sourcePublisher: pagina.sourcePublisher,
    bronnen,
    attributie: pagina.attributie,
    sinds: asOfOp(eerste.get(id) ?? wis),
  };
  const asOfWis = asOfOp(wis);
  if (laatsteDag(record) >= asOfWis) record.weg = asOfWis;
  if (record.sinds > (record.weg ?? asOfWis)) record.sinds = record.weg ?? asOfWis;
  const problemen = verledenRecordProblemen(record);
  if (problemen.length) {
    for (const probleem of new Set(problemen.map((p) => p.replace(/^[^:]*: /, "")))) geweigerd.set(probleem, (geweigerd.get(probleem) ?? 0) + 1);
    continue;
  }
  hersteld.push(record);
}

// Samenvoegen met wat er al is (de huidige records van scripts/build-agenda.mjs); een bestaand record wint, maar krijgt
// de vroegste `sinds` uit de geschiedenis.
const verledenDir = path.join(rootDir, VERLEDEN_DIR);
const bestaandeMaanden = fs.existsSync(verledenDir) ? fs.readdirSync(verledenDir).filter(isVerledenMaandBestand).sort() : [];
const bestaand = bestaandeMaanden.flatMap((name) => JSON.parse(fs.readFileSync(path.join(verledenDir, name), "utf8")).items ?? []);
const perId = new Map(bestaand.map((record) => [record.id, { ...record }]));
let sindsBijgewerkt = 0;
for (const record of perId.values()) {
  const c = eerste.get(record.id);
  if (!c) continue;
  const sinds = asOfOp(c);
  if (sinds < record.sinds) {
    record.sinds = sinds;
    sindsBijgewerkt += 1;
  }
}
let toegevoegd = 0;
for (const record of hersteld) {
  if (perId.has(record.id)) continue;
  perId.set(record.id, record);
  toegevoegd += 1;
}

const indexNu = fs.existsSync(path.join(rootDir, VERLEDEN_INDEX_FILE)) ? JSON.parse(fs.readFileSync(path.join(rootDir, VERLEDEN_INDEX_FILE), "utf8")) : null;
const asOf = indexNu?.bijgewerkt ?? brusselsDag(new Date().toISOString());
const { index, bestanden } = verledenBestanden([...perId.values()], asOf, bestaandeMaanden.map((name) => name.slice(0, 7)));
if (!droog) {
  fs.mkdirSync(verledenDir, { recursive: true });
  for (const [name, document] of bestanden) fs.writeFileSync(path.join(verledenDir, name), verledenMaandTekst(document), "utf8");
  fs.writeFileSync(path.join(rootDir, VERLEDEN_INDEX_FILE), `${JSON.stringify(index, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify({
  droog,
  paginasInGeschiedenis: eerste.size,
  verdwenen: [...laatsteWis.keys()].filter((id) => !huidig.has(id)).length,
  hersteld: hersteld.length,
  toegevoegd,
  sindsBijgewerkt,
  geweigerd: Object.fromEntries(geweigerd),
  verleden: index.aantal,
  maanden: index.maanden.length,
}, null, 2));
if (!droog) console.log("Nu: node scripts/build-agenda.mjs (bouwt de pagina's met hun stand).");
