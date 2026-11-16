// Leest de persberichten van stad Antwerpen (pers.antwerpen.be) en schrijft de activiteiten die ze zelf aankondigen naar
// site/sources/stad-persberichten.json. De regels voor wat een activiteit is, staan in lib/stad-persberichten.mjs.
//
// Beleefd en eerlijk, in deze volgorde:
// 1. robots.txt van de persruimte, elke ronde opnieuw. Verbiedt het de feed (of alles), dan wordt er niets gelezen en
//    blijft de vorige stand staan. Geen robots.txt (404) is toegelaten; een andere fout is "nee".
// 2. de feed met de tien laatste persberichten;
// 3. elk persbericht uit de feed dat robots.txt toelaat.
// Altijd met dezelfde eerlijke naam (LEZER_UA), minstens 5 s tussen twee verzoeken (of de Crawl-delay als die groter
// is), en alleen naar de persruimte: een omleiding of link naar elders (www.antwerpen.be) wordt nooit gevolgd. Weigert
// de persruimte ons, dan stopt het lezen meteen; er wordt niets omzeild.
//
// De feed toont alleen de tien laatste persberichten. Een activiteit uit een ouder persbericht blijft daarom staan tot
// haar laatste dag voorbij is; een persbericht dat nog in de feed staat, wordt elke ronde opnieuw gelezen (zo komt een
// wijziging, zoals "volzet", mee). Lukt één persbericht niet, dan blijven alleen zijn vorige activiteiten staan.
//
// Dubbels: een activiteit die al uit een andere bron komt, krijgt `sameAs` met het id daarvan (lib/merge-events.mjs maakt
// er één punt van); een activiteit die al als handmatig item op de site staat, valt weg (dubbelsZoeken).
//
//   node scripts/fetch-sources-stad-persberichten.mjs [--dry-run]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BRON_WEIGERT_CODE, FetchError, SOURCE_TIMEOUT_CODE, errorCodeOf, fetchWithTimeout, isMainModule, keepPreviousOnError, readSourceDocument, screenItems, statusEntry, upcomingCount, writeSourceDocument } from "../lib/fetch-util.mjs";
import { brusselsDate } from "../lib/html-text.mjs";
import { robotsLaatToe, robotsVerbodenPaden } from "../lib/huisnummer-uit-bron.mjs";
import { SOURCE_DEFINITIONS, SOURCE_IDS, sourceDocument } from "../lib/source-feed.mjs";
import {
  LEZER_AGENT, LEZER_UA, MAX_LIJF, MAX_OMLEIDINGEN, PAUZE_MS, PERS_FEED, PERS_ROBOTS, SOURCE_ID, crawlDelayMs, dubbelsZoeken, leesFeed,
  magOpPers, persberichtLezen, slugVan,
} from "../lib/stad-persberichten.mjs";
import { plat } from "../lib/vaste-adressen.mjs";
import { loadHandAgendaItems } from "./agenda-source.mjs";

export { SOURCE_ID };

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Eén lezer voor de hele ronde: elk verzoek na het eerste wacht eerst `pauzeMs` (minstens PAUZE_MS). Een omleiding wordt
// alleen gevolgd binnen de persruimte, over https, hoogstens MAX_OMLEIDINGEN keer; een omleiding naar elders geeft
// { status, elders } terug zonder dat die host ooit gevraagd wordt.
export function beleefdeLezer(fetchImpl, sleep = realSleep) {
  let verzoeken = 0;
  let pauzeMs = PAUZE_MS;
  async function haal(url, accept = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5") {
    let doel = url;
    for (let sprong = 0; sprong <= MAX_OMLEIDINGEN; sprong += 1) {
      if (!magOpPers(doel)) throw new FetchError("niet_op_de_persruimte");
      if (verzoeken > 0) await sleep(pauzeMs);
      verzoeken += 1;
      const response = await fetchWithTimeout(fetchImpl, doel, {
        headers: { "user-agent": LEZER_UA, accept, "accept-language": "nl-BE,nl;q=0.9" },
        redirect: "manual",
        credentials: "omit",
      });
      const status = Number(response?.status ?? 0);
      // Een lijf dat niet gelezen wordt, wordt vrijgegeven.
      const laatLijfLos = () => Promise.resolve().then(() => response?.body?.cancel?.()).catch(() => {});
      if (status >= 300 && status < 400) {
        await laatLijfLos();
        let volgende = null;
        try {
          volgende = new URL(String(response.headers?.get?.("location") ?? ""), doel);
        } catch {
          volgende = null;
        }
        if (!volgende || !magOpPers(volgende.href)) return { status, elders: volgende?.hostname ?? "onbekend", tekst: "" };
        doel = volgende.href;
        continue;
      }
      if (status !== 200) {
        await laatLijfLos();
        return { status, tekst: "" };
      }
      let tekst;
      try {
        tekst = String(await response.text());
      } catch (error) {
        throw error instanceof FetchError ? error : new FetchError("body_read_failed");
      }
      return { status, tekst: tekst.slice(0, MAX_LIJF), url: doel };
    }
    return { status: 310, elders: "te_veel_omleidingen", tekst: "" };
  }
  return {
    haal,
    zetPauze(ms) {
      pauzeMs = Math.max(PAUZE_MS, Number(ms) || 0);
    },
    get verzoeken() {
      return verzoeken;
    },
  };
}

// Welke straat bij welke postcodes hoort, uit de straatas van de site (site/geo); leeg als de bestanden er niet zijn.
export function stratenKennis(rootDir) {
  const straten = new Map();
  const voegToe = (naam, postcode) => {
    const sleutel = plat(naam);
    if (!sleutel || !/^\d{4}$/.test(String(postcode))) return;
    if (!straten.has(sleutel)) straten.set(sleutel, new Set());
    straten.get(sleutel).add(String(postcode));
  };
  const lees = (naam) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(rootDir, "site", "geo", naam), "utf8"));
    } catch {
      return null;
    }
  };
  for (const rij of lees("straten-stad.json")?.straten ?? []) if (Array.isArray(rij)) voegToe(rij[0], rij[2]);
  for (const rij of lees("straten.json")?.streets ?? []) if (Array.isArray(rij)) voegToe(rij[1], rij[2]);
  return { straten };
}

// De items van de andere agendabronnen, zoals ze nu in site/sources staan (alleen geldige bestanden).
export function andereBronItems(rootDir) {
  const uit = [];
  for (const sourceId of SOURCE_IDS) {
    if (sourceId === SOURCE_ID || SOURCE_DEFINITIONS[sourceId]?.aanvulling) continue;
    const document = readSourceDocument(rootDir, sourceId);
    for (const item of document?.items ?? []) uit.push({ sourceId, scope: document.scope, item });
  }
  return uit;
}

function handItems(rootDir) {
  try {
    return loadHandAgendaItems(rootDir);
  } catch {
    return [];
  }
}

const optellen = (doel, bron) => {
  for (const [reden, aantal] of Object.entries(bron)) doel[reden] = (doel[reden] ?? 0) + aantal;
};

export async function run({ fetch: fetchImpl = globalThis.fetch, clock = () => new Date(), rootDir, dryRun = false, log = console.log, sleep = realSleep } = {}) {
  const previous = readSourceDocument(rootDir, SOURCE_ID);
  const now = clock();
  const retrievedAt = now.toISOString();
  const today = brusselsDate(now);
  const lezer = beleefdeLezer(fetchImpl, sleep);
  const fout = (code, extra = {}) => {
    log(JSON.stringify({ source: SOURCE_ID, fetchStatus: "error", errorCode: code, verzoeken: lezer.verzoeken, ...extra }));
    return [keepPreviousOnError(rootDir, SOURCE_ID, previous, code, { dryRun, at: retrievedAt })];
  };
  // Een weigering aan de rand en het tijdsbudget houden hun eigen code (sources:health zegt dan "geweigerd").
  const metFase = (fase, error) => {
    const code = errorCodeOf(error);
    return [BRON_WEIGERT_CODE, SOURCE_TIMEOUT_CODE].includes(code) ? code : `${fase}_${code}`.slice(0, 60);
  };

  // 1. robots.txt
  let robots;
  try {
    robots = await lezer.haal(PERS_ROBOTS, "text/plain");
  } catch (error) {
    return fout(metFase("robots", error));
  }
  let verboden = [];
  if (robots.status === 200) {
    verboden = robotsVerbodenPaden(robots.tekst, LEZER_AGENT);
    lezer.zetPauze(crawlDelayMs(robots.tekst, LEZER_AGENT));
  } else if (robots.status !== 404 && robots.status !== 410) {
    return fout(robots.elders ? "robots_omleiding" : `robots_http_${robots.status}`);
  }
  if (!robotsLaatToe(verboden, PERS_FEED)) return fout("robots_verbiedt");

  // 2. de feed
  let feed;
  try {
    feed = await lezer.haal(PERS_FEED, "application/rss+xml,application/xml;q=0.9,*/*;q=0.5");
  } catch (error) {
    return fout(metFase("feed", error));
  }
  if (feed.status !== 200) return fout(feed.elders ? "feed_omleiding" : `feed_http_${feed.status}`);
  const berichten = leesFeed(feed.tekst);
  if (!berichten.length) return fout("feed_leeg");

  // 3. de persberichten, nieuwste eerst
  const kennis = stratenKennis(rootDir);
  const gelezen = new Map();
  const mislukt = [];
  const redenen = {};
  let robotsOvergeslagen = 0;
  for (const bericht of berichten) {
    if (!robotsLaatToe(verboden, bericht.url)) {
      robotsOvergeslagen += 1;
      continue;
    }
    let antwoord;
    try {
      antwoord = await lezer.haal(bericht.url);
    } catch (error) {
      const code = metFase("bericht", error);
      mislukt.push(code);
      // Geweigerd of geen tijd meer: niet verder vragen. De rest houdt zijn vorige stand.
      if (code === BRON_WEIGERT_CODE || code === SOURCE_TIMEOUT_CODE) break;
      continue;
    }
    if (antwoord.status !== 200) {
      mislukt.push(antwoord.elders ? "bericht_omleiding" : `bericht_http_${antwoord.status}`);
      continue;
    }
    const uitkomst = persberichtLezen(antwoord.tekst, bericht, { retrievedAt, kennis });
    optellen(redenen, uitkomst.redenen);
    gelezen.set(bericht.slug, uitkomst.kandidaten);
  }

  // 4. de nieuwe activiteiten, en de vorige van elk persbericht dat deze ronde niet gelezen werd
  const vers = [...gelezen.values()].flat();
  const bewaard = (previous?.items ?? []).filter((item) => !gelezen.has(slugVan(item.sourceUrl))).map((item) => ({ item, tekst: "" }));
  const komend = [...vers, ...bewaard].filter(({ item }) => (item.endDate ?? item.date) >= today);
  const voorbij = vers.length + bewaard.length - komend.length;

  // 5. dubbels met de andere bronnen en de handmatige items
  const { kandidaten, tel } = dubbelsZoeken(komend, andereBronItems(rootDir), { hand: handItems(rootDir) });
  const screened = screenItems(kandidaten.map(({ item }) => item));
  const fetchStatus = mislukt.length ? "error" : "ok";
  const errorCode = mislukt.length ? (mislukt.find((code) => code === BRON_WEIGERT_CODE) ?? mislukt[0]) : null;
  const counts = {
    source: SOURCE_ID,
    verzoeken: lezer.verzoeken,
    berichten: berichten.length,
    gelezen: gelezen.size,
    mislukt: mislukt.length,
    robotsOvergeslagen,
    nieuw: vers.length,
    bewaard: bewaard.length,
    voorbij,
    ...tel,
    items: screened.items.length,
    upcoming: upcomingCount(screened.items, today),
    geweigerd: screened.rejected.privacy + screened.rejected.contract + screened.rejected.duplicate,
    redenen,
  };
  if (dryRun) {
    log(JSON.stringify({ dryRun: true, ...counts, fetchStatus, errorCode }));
    // Voor wie de droge proef draait: per activiteit dag, uur, district en titel (geen adres, geen info).
    for (const item of screened.items) {
      log(JSON.stringify({ dag: item.date, tot: item.endDate, uur: item.timeSlot, district: item.inDistrict ? "Antwerpen" : item.postcodes.join(","), titel: item.title, samenMet: item.sameAs ?? [] }));
    }
    return [statusEntry(SOURCE_ID, { fetchStatus, retrievedAt, itemCount: screened.items.length, errorCode })];
  }
  const document = writeSourceDocument(rootDir, SOURCE_ID, sourceDocument(SOURCE_ID, { retrievedAt, fetchStatus, contentVersion: null, items: screened.items }));
  log(JSON.stringify({ ...counts, fetchStatus, errorCode, written: document.items.length }));
  return [statusEntry(SOURCE_ID, { fetchStatus, retrievedAt, itemCount: document.items.length, errorCode })];
}

if (isMainModule(import.meta.url)) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  run({ rootDir, dryRun: process.argv.includes("--dry-run") }).catch((error) => {
    console.error(JSON.stringify({ source: SOURCE_ID, fatal: errorCodeOf(error) }));
    process.exitCode = 1;
  });
}
