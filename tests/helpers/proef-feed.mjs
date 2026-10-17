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
const MARKTEN = "https://geo.api.vlaanderen.be/GIPOD/ogc/features/v1/collections/INNAME_PUNT/items";

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

// Alle bronnen van `feed` opgehaald op `stempel`, en met succes: een bron die in de echte feed faalde (fetchStatus
// "error", zoals eBesluit sinds 13 oktober 2026) zou anders de bronwaarschuwing bovenaan zetten (#191), en dan hing
// een toets van de opmaak af van de gezondheid van de bronnen op de dag van de data. Een bron zonder sleutel of
// uitgezet blijft zoals ze is. De items houden hun eigen stempel.
export function gezondeBronnen(feed, stempel = feed.generatedAt) {
  for (const bron of feed.sources) {
    bron.retrievedAt = stempel;
    if (bron.fetchStatus === "error") Object.assign(bron, { fetchStatus: "ok", errorCode: null });
  }
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
