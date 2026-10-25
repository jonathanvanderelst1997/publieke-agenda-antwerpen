// Een verzonnen agendafeed voor de e2e-toetsen (tests/e2e/plek.e2e.mjs en gsm-opmaak.e2e.mjs): de bronnen
// (metadata) van de echte feed, opgehaald op de dag van de toets, en alleen verzonnen items. De basis van een
// item is een vast letterlijk object, niet geleend uit de echte items: zo hangt een toets niet af van wat er
// toevallig in site/agenda-feed.js staat (nakijkbevindingen: "data-bom bij een verversing").
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../site");
const feedText = fs.readFileSync(path.join(site, "agenda-feed.js"), "utf8");
export const echteFeed = () => JSON.parse(feedText.slice(feedText.indexOf("{"), feedText.lastIndexOf("}") + 1));

const KALENDER = "https://www.antwerpen.be/info/5efb0477b118f7b19c627b69/wat-beleef-je-in-district-antwerpen";
// De bronlink van een markt is de datasetfiche van GIPOD, nooit een INNAME_PUNT-rij (site/gipod-bron.js).
const MARKTEN = "https://metadata.vlaanderen.be/srv/api/records/2b4b3bb7-cadc-41a0-b5ae-796a84a20b52";

// Een agendapunt van de districtskalender, opgehaald op `stempel`; `eigen`: id, titel, dag, plek ...
export function kalenderItem(stempel, eigen = {}) {
  return {
    theme: "Activiteit", className: "activity", kind: "activity", endDate: "", timeSlot: "", timeText: "", info: "Verzonnen item voor de toets.", infoUrl: "",
    sourceId: "district-kalender", scope: "district", inDistrict: true, sourceUrl: KALENDER, link: KALENDER, retrievedAt: stempel,
    sources: [{ sourceId: "district-kalender", url: KALENDER, retrievedAt: stempel, scope: "district" }], feed: true, ...eigen,
  };
}

// Een marktdag van de stad, in het district.
export function marktItem(stempel, eigen = {}) {
  return {
    theme: "Activiteit", className: "activity", kind: "activity", endDate: null, timeSlot: "08:00", timeText: "8 tot 13 uur", info: "Openbare markt van stad Antwerpen. Marktdag volgens GIPOD.",
    postcodes: ["2000"], sourceId: "stad-markten", scope: "stad", inDistrict: true, sourceUrl: MARKTEN, link: MARKTEN, retrievedAt: stempel,
    sources: [{ sourceId: "stad-markten", url: MARKTEN, retrievedAt: stempel, scope: "stad" }], feed: true, ...eigen,
  };
}

// Alle bronnen van `feed` opgehaald op `stempel`, en met succes: zo hangt een toets niet af van de gezondheid van de
// bronnen op de dag van de data (in de echte feed faalt eBesluit sinds 13 oktober 2026, fetchStatus "error"; tot het
// besluit van 18-10-2026 zette dat de bronwaarschuwing van #191 bovenaan, nu toont de site er niets van). Een bron
// zonder sleutel of uitgezet blijft zoals ze is. De items houden hun eigen stempel.
export function gezondeBronnen(feed, stempel = feed.generatedAt) {
  for (const bron of feed.sources) {
    bron.retrievedAt = stempel;
    if (bron.fetchStatus === "error") Object.assign(bron, { fetchStatus: "ok", errorCode: null });
  }
  return feed;
}

// Het omgekeerde, zoals de echte feed sinds 13 oktober 2026: de bronnen `ids` faalden bij de laatste verversingen
// (fetchStatus "error") en zijn laatst opgehaald `dagen` dagen voor de feed. Voor de toetsen die nagaan dat een bezoeker
// daar niets van ziet, ook niet op een gsm (tests/e2e/plek.e2e.mjs; besluit van de eigenaar van 18-10-2026).
export function falendeBronnen(feed, ids, dagen = 5) {
  const toen = new Date(Date.parse(feed.generatedAt) - dagen * 86400000).toISOString();
  const bronnen = feed.sources.filter((bron) => ids.includes(bron.sourceId));
  if (bronnen.length !== ids.length) throw new Error(`falendeBronnen: niet alle bronnen staan in de feed: ${ids.join(", ")}`);
  for (const bron of bronnen) Object.assign(bron, { fetchStatus: "error", errorCode: "http_500", retrievedAt: toen });
  return feed;
}

// De feed van dag `dag` (05:00 UTC): alle bronnen die ochtend opgehaald (gezondeBronnen), met alleen de verzonnen
// `items` (of een functie die ze maakt met de stempel van die ochtend).
export function proefFeed(dag, items = []) {
  const feed = echteFeed();
  const stempel = `${dag}T05:00:00.000Z`;
  feed.generatedAt = stempel;
  feed.classificationAsOf = dag;
  gezondeBronnen(feed, stempel);
  feed.items = typeof items === "function" ? items(stempel) : items;
  return feed;
}

export const feedScript = (feed) => `window.PUBLIC_AGENDA_FEED = ${JSON.stringify(feed)};`;
