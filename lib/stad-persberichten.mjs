// De persberichten van stad Antwerpen (pers.antwerpen.be) als bron voor de publieke agenda (`stad-persberichten`).
//
// Waarom: sinds 23-10-2026 weigert www.antwerpen.be elke automatische lezer; de districtskalender en het nieuws komen
// sindsdien niet meer binnen. De persruimte van de stad laat automatisch lezen wel toe (robots.txt verbiedt alleen in-
// en uitschrijven) en heeft een RSS-feed met de tien laatste persberichten. Een persbericht noemt vaak zelf de
// activiteiten die het aankondigt: per district een kop, een datum, een uur en een plaats met huisnummer (het
// persbericht over Sinterklaas van 16-11-2026).
//
// Wat hier staat, is puur (geen klok, geen netwerk, geen bestanden): de feed lezen, de blokken van een persbericht, de
// activiteiten die het zelf aankondigt, en de dubbels met een andere bron. Het ophalen staat in
// scripts/fetch-sources-stad-persberichten.mjs.
//
// Bij twijfel niets. Een stuk (de blokken onder één kop; zonder kop het hele persbericht) geeft hoogstens één
// activiteit, en alleen als:
// - er precies één korte regel met een datum in staat, en die regel één dag of één aaneengesloten periode noemt (twee
//   opeenvolgende dagen zijn één periode; twee losse dagen, een tijdlijn van werken of een inschrijvingsdatum ernaast
//   zijn twijfel);
// - die datum niet vóór de dag van het persbericht ligt (een verslag van iets wat al gebeurde) en niet verder dan een
//   jaar erna;
// - er een plaats staat: een regel met een straat en een huisnummer, of een regel "Waar:"/"Locatie:"/"Plaats:"/"Adres:",
//   of "<plek>, <district>". Zonder huisnummer zoekt de verversing het nummer daarna zelf in de open data van de stad
//   (lib/huisnummer-uit-bron.mjs, `npm run refresh:huisnummers`), zoals bij elke andere bron;
// - het district vaststaat (uit de kop, de plaats of de straat) en niets het tegenspreekt;
// - het een activiteit voor het publiek is: een uur, of een woord als feest, voorstelling, markt of wandeling.
//
// Wat er nooit op komt (regels van de eigenaar voor de publieke agenda):
// - politiek: een persbericht over een zitting van raad of college, over een beleidsbeslissing, of dat een partij noemt
//   (lib/politiek.mjs). Alleen activiteiten voor het publiek;
// - persoonsgegevens: een blok met een perscontact, een verantwoordelijke, een mailadres of een telefoonnummer wordt
//   overgeslagen vóór er iets uit gelezen wordt; een titel of plaats met een mandaat (schepen, burgemeester ...) geeft
//   geen activiteit. De inleiding en de auteur van het persbericht worden nooit overgenomen;
// - het woord verhuis (noemtVerhuis in site/adres-privacy.js);
// - een activiteit van de provincie zonder link, zonder te zeggen of je moet inschrijven, of die volzet is.
// Een andere activiteit die volzet is, komt er wel op, met "Volzet volgens het persbericht" in de info.
import { createHash } from "node:crypto";

import { noemtVerhuis } from "../site/adres-privacy.js";
import { DISTRICT_CHANNELS } from "./district-channels.mjs";
import { classNameForTheme, parseDatePart, parseTimePart, splitDateTime, themeFor } from "./district-parser.mjs";
import { addDaysIso, brusselsDate, cleanText, decodeEntities, safeHttpsUrl } from "./html-text.mjs";
import { PARTIJ_DOMEIN, PARTIJ_NAAM, POLITIEK_WOORD } from "./politiek.mjs";
import { DISTRICT_POSTCODES, postcodesInText } from "./postcodes.mjs";
import { plat } from "./vaste-adressen.mjs";

export const SOURCE_ID = "stad-persberichten";
export const ID_PREFIX = "stad-pers-";
export const PERS_HOST = "pers.antwerpen.be";
export const PERS_BASIS = `https://${PERS_HOST}`;
export const PERS_FEED = `${PERS_BASIS}/feed`;
export const PERS_ROBOTS = `${PERS_BASIS}/robots.txt`;
// De vaste, eerlijke naam waarmee deze bron leest (dezelfde als de bronnenlezer van de Gateway). Nooit een andere.
export const LEZER_UA = "ProjectBrain-bronnenlezer/1.0 (persoonlijke lezer voor een gebruiker)";
// De naam zoals robots.txt hem in een regel "User-agent:" zou noemen.
export const LEZER_AGENT = "ProjectBrain-bronnenlezer";
// Minstens zoveel tussen twee verzoeken; een grotere Crawl-delay in robots.txt gaat voor.
export const PAUZE_MS = 5_000;
// De feed toont de tien laatste persberichten; meer worden er nooit gevraagd.
export const MAX_BERICHTEN = 10;
// Hoogstens zoveel omleidingen, en alleen binnen de persruimte.
export const MAX_OMLEIDINGEN = 3;
export const MAX_LIJF = 2 * 1024 * 1024;
// Een datum-, uur- of plaatsregel is kort; een lange alinea is verhaal.
const KORT = 160;

const isRecord = (x) => typeof x === "object" && x !== null && !Array.isArray(x);

// ---------- alleen de persruimte ----------
// Elk verzoek van deze bron gaat naar de persruimte, over https. Een link of omleiding naar elders (www.antwerpen.be)
// wordt nooit gevraagd.
export function magOpPers(url) {
  try {
    const parsed = new URL(String(url));
    return parsed.protocol === "https:" && parsed.hostname.toLowerCase() === PERS_HOST && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

// De Crawl-delay voor onze naam (anders voor "*") in milliseconden, of 0.
export function crawlDelayMs(tekst, agent = LEZER_AGENT) {
  const groepen = [];
  let huidig = null;
  for (const lijn of String(tekst ?? "").split(/\r?\n/)) {
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(lijn.replace(/#.*$/, "").trim());
    if (!m) continue;
    const [veld, waarde] = [m[1].toLowerCase(), m[2].trim()];
    if (veld === "user-agent") {
      if (!huidig || huidig.regels) {
        huidig = { agents: [], regels: false, delay: null };
        groepen.push(huidig);
      }
      huidig.agents.push(waarde.toLowerCase());
    } else if (huidig) {
      huidig.regels = true;
      if (veld === "crawl-delay" && Number.isFinite(Number(waarde))) huidig.delay = Number(waarde);
    }
  }
  const eigen = groepen.find((g) => g.agents.some((a) => a !== "*" && agent.toLowerCase().startsWith(a)));
  const groep = eigen ?? groepen.find((g) => g.agents.includes("*"));
  const seconden = groep?.delay ?? 0;
  return seconden > 0 ? Math.min(seconden, 120) * 1000 : 0;
}

// ---------- de feed ----------

const SLUG = /^[a-z0-9][a-z0-9-]{0,200}$/;
const cdata = (x) => cleanText(String(x ?? "").replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1"));

// De persberichten in de RSS-feed, nieuwste eerst zoals de feed ze geeft; alleen links op de persruimte zelf.
export function leesFeed(xml) {
  const uit = [];
  for (const [, item] of String(xml ?? "").matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const veld = (naam) => {
      const m = new RegExp(`<${naam}\\b[^>]*>([\\s\\S]*?)</${naam}>`, "i").exec(item);
      return m ? cdata(m[1]) : null;
    };
    let url;
    try {
      url = new URL(veld("link") ?? "");
    } catch {
      continue;
    }
    const slug = url.pathname.replace(/^\/+|\/+$/g, "");
    if (!magOpPers(url.href) || !SLUG.test(slug) || url.search || url.hash) continue;
    const titel = veld("title");
    const moment = Date.parse(veld("pubDate") ?? "");
    if (!titel || !Number.isFinite(moment) || uit.some((x) => x.slug === slug)) continue;
    uit.push({ slug, url: `${PERS_BASIS}/${slug}`, titel: titel.slice(0, 300), gepubliceerd: new Date(moment).toISOString() });
    if (uit.length >= MAX_BERICHTEN) break;
  }
  return uit;
}

// Het pad van een persbericht ("hij-komt-..."), uit de bronlink van een item; anders "".
export function slugVan(url) {
  try {
    const parsed = new URL(String(url));
    return magOpPers(parsed.href) ? parsed.pathname.replace(/^\/+|\/+$/g, "") : "";
  } catch {
    return "";
  }
}

// ---------- persoonsgegevens: nooit lezen ----------

const PERSOONLIJK = new RegExp([
  String.raw`pers\s*contact`, "persverantwoordelijke", "woordvoerder", "contactpersoon", String.raw`verantwoordelijken?\s*:`,
  "@", "mailto:", String.raw`\btel\b`, String.raw`\bgsm\b`, String.raw`\+32`,
  // 03 338 29 07, 0499 549 814, 0479/26.49.02, en zonder de nul: 498 22 98 94
  String.raw`\b0\d{1,3}(?:[\s./-]?\d{2,3}){2,3}\b`, String.raw`\b4\d{2}(?:\s\d{2}){3}\b`,
].join("|"), "i");

// Draagt deze tekst een persoonsgegeven (een perscontact, een verantwoordelijke, een mailadres, een telefoonnummer)?
export const isPersoonlijk = (tekst) => PERSOONLIJK.test(String(tekst ?? ""));

// Een mandaat in een titel, kop of plaats: dan staat er meestal een naam bij. Geen activiteit.
const MANDAAT = /\b(?:districts)?(?:schepen|burgemeester)\w*|\bgedeputeerde\w*|\bgouverneur\b|\bminister\w*|\bmandataris\w*|\braadslid\w*|\bvoorzitter\w*|\bparlementslid\w*|\bvolksvertegenwoordiger\w*/i;

// ---------- een persbericht ----------

const alsRegel = (html) => cleanText(String(html ?? "").replace(/<br\s*\/?>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " "));
const hrefs = (html) => [...String(html ?? "").matchAll(/\bhref\s*=\s*"([^"]*)"/gi)].map((m) => decodeEntities(m[1]).trim()).filter(Boolean);

// De blokken van het lijf, in volgorde: koppen, alinea's en opsommingspunten. Alleen de secties van het persbericht
// (Prezly: `prezly-slate-document`), zonder de titel (`<h1>`). Een blok met een persoonsgegeven of een maillink valt
// weg vóór er iets uit gelezen wordt.
const lijfVan = (html) => [...String(html ?? "").matchAll(/<section\b[^>]*class="[^"]*\bprezly-slate-document\b[^"]*"[^>]*>([\s\S]*?)<\/section>/gi)]
  .map((m) => m[1] ?? "")
  .filter((sectie) => !/<h1\b/i.test(sectie))
  .join("\n");

export function blokkenUit(html) {
  const lijf = lijfVan(html);
  const uit = [];
  for (const [, tag, binnen] of lijf.matchAll(/<(h[2-6]|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const tekst = alsRegel(binnen);
    const links = hrefs(binnen);
    if (!tekst || isPersoonlijk(tekst) || links.some((h) => /^mailto:|@/i.test(h))) continue;
    uit.push({ soort: /^h/i.test(tag) ? "kop" : tag.toLowerCase() === "li" ? "punt" : "alinea", tekst, links });
  }
  return uit;
}

// De namen die het persbericht zelf als perscontact of verantwoordelijke noemt (de mandatarissen): elk woord met een
// hoofdletter van minstens vier letters uit die blokken, plat. Ze worden nooit bewaard; een titel, kop of plaats die
// er een noemt, geeft geen activiteit.
const GEEN_NAAM = /^(?:perscontact|verantwoordelijke|verantwoordelijken|districtsschepen|districtsburgemeester|schepen|burgemeester|stad|district|antwerpen|voor|tel|gsm)$/i;
export function namenUit(html) {
  const namen = new Set();
  for (const [, binnen] of lijfVan(html).matchAll(/<(?:p|li)\b[^>]*>([\s\S]*?)<\/(?:p|li)>/gi)) {
    const tekst = alsRegel(binnen);
    if (!/pers\s*contact|verantwoordelijken?\s*:/i.test(tekst)) continue;
    for (const [woord] of tekst.replace(/\S+@\S+/g, " ").matchAll(/\p{Lu}[\p{L}'’-]{3,}/gu)) {
      if (!GEEN_NAAM.test(woord) && !ANDERE_DISTRICTEN.some((d) => d.woord.test(woord))) namen.add(plat(woord));
    }
  }
  return namen;
}
const noemtNaam = (tekst, namen) => namen.size > 0 && plat(tekst).split(" ").some((w) => namen.has(w));

// De titel en het moment van publicatie uit de JSON-LD van het persbericht (`NewsArticle`); nooit de auteur of de
// inleiding.
export function artikelUit(html) {
  for (const [, json] of String(html ?? "").matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try {
      data = JSON.parse(json);
    } catch {
      continue;
    }
    for (const ding of Array.isArray(data) ? data : [data]) {
      if (!isRecord(ding) || ding["@type"] !== "NewsArticle") continue;
      const moment = Date.parse(typeof ding.datePublished === "string" ? ding.datePublished : "");
      return {
        titel: typeof ding.headline === "string" ? cleanText(ding.headline) || null : null,
        gepubliceerd: Number.isFinite(moment) ? new Date(moment).toISOString() : null,
      };
    }
  }
  return { titel: null, gepubliceerd: null };
}

// ---------- datum en uur ----------

const MAAND = "(?:januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december|jan|feb|febr|mrt|apr|jun|jul|aug|sep|sept|okt|nov|dec)\\.?";
const NOEMT_DATUM = new RegExp(`\\b\\d{1,2}\\s+${MAAND}(?![\\p{L}])|\\b\\d{1,2}\\/\\d{1,2}\\b`, "iu");
export const noemtDatum = (tekst) => NOEMT_DATUM.test(String(tekst ?? ""));
const DATUM_LABEL = /^(?:wanneer|datum|op)\s*:?\s+/i;
const MAANDNUMMER = { jan: 1, feb: 2, febr: 2, mrt: 3, maa: 3, apr: 4, mei: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, okt: 10, nov: 11, dec: 12 };
const DAG_EN_MAAND = new RegExp(`\\b(\\d{1,2})\\s+(${MAAND})(?![\\p{L}])`, "giu");

// De dagen die een regel noemt (dag en maand), als ISO-datum met het jaar zoals een datumregel het krijgt.
function genoemdeDagen(tekst, vanafDag) {
  // Een datum in cijfers ("5/12") wordt niet uitgerekend: die telt als een andere dag.
  const uit = /\b\d{1,2}\/\d{1,2}\b/.test(String(tekst ?? "")) ? ["?"] : [];
  for (const m of String(tekst ?? "").matchAll(DAG_EN_MAAND)) {
    const sleutel = m[2].toLowerCase().replace(/\.$/, "");
    const maand = MAANDNUMMER[sleutel] ?? MAANDNUMMER[sleutel.slice(0, 4)] ?? MAANDNUMMER[sleutel.slice(0, 3)];
    if (!maand) continue;
    const [jaar, refMaand] = vanafDag.split("-").map(Number);
    const j = maand < refMaand - 3 ? jaar + 1 : maand > refMaand + 8 ? jaar - 1 : jaar;
    uit.push(`${j}-${String(maand).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`);
  }
  return uit;
}

// Opeenvolgende losse dagen worden één periode ("zaterdag 5 en zondag 6 december").
function aaneen(ranges) {
  const uit = [];
  for (const range of [...ranges].sort((a, b) => a.date.localeCompare(b.date))) {
    const vorige = uit.at(-1);
    if (vorige && !range.endDate && addDaysIso(vorige.endDate ?? vorige.date, 1) === range.date) vorige.endDate = range.date;
    else uit.push({ date: range.date, endDate: range.endDate ?? null });
  }
  return uit;
}

const TIJD_MEER = /(?:\bom\s+)?\d{1,2}(?:[.:]\d{2})?(?:\s*(?:uur)?\s*(?:,|\ben\b|&)\s*(?:om\s+)?\d{1,2}(?:[.:]\d{2})?)+\s*uur\b/i;
const TIJD_EEN = /(?:\b(?:van|om|vanaf)\s+)?\d{1,2}(?:[.:]\d{2})?\s*(?:uur\s*)?(?:(?:tot|-|–)\s*\d{1,2}(?:[.:]\d{2})?\s*)?uur\b/i;

// Het uur in een regel ("Aankomst en ontmoeting met de Sint: van 15 tot 16.30 uur"): { timeSlot, timeText } of null.
export function tijdUit(tekst) {
  const regel = cleanText(tekst).replace(/\btussen\s+(\d{1,2}(?:[.:]\d{2})?)\s*(?:uur\s*)?en\s+(\d{1,2}(?:[.:]\d{2})?)\s*uur\b/gi, "van $1 tot $2 uur");
  for (const patroon of [TIJD_MEER, TIJD_EEN]) {
    const m = patroon.exec(regel);
    if (!m) continue;
    const tijd = parseTimePart(m[0].trim());
    if (tijd.timeSlot !== "Info") return { timeSlot: tijd.timeSlot, timeText: tijd.timeText };
  }
  return null;
}

// Eén datumregel: { date, endDate, tijd } of { reden }. `vanafDag`: de dag van het persbericht (Brussel).
export function leesDatumregel(tekst, vanafDag) {
  const regel = cleanText(tekst).replace(DATUM_LABEL, "").replace(/^van\s+(?=(?:\p{L}+\s+)?\d{1,2}\s)/iu, "");
  const [datumDeel, tijdDeel] = splitDateTime(regel);
  const gelezen = parseDatePart(datumDeel, vanafDag);
  if (gelezen.issues.length || !gelezen.ranges.length || ["deadline", "open_start"].includes(gelezen.kind)) return { reden: "datum_onleesbaar" };
  const ranges = aaneen(gelezen.ranges);
  if (ranges.length !== 1) return { reden: "meer_dan_een_datum" };
  const [{ date, endDate }] = ranges;
  if (date < vanafDag) return { reden: "datum_voorbij" };
  if (date > addDaysIso(vanafDag, 366)) return { reden: "datum_te_ver" };
  return { date, endDate: endDate && endDate > date ? endDate : null, tijd: tijdDeel ? tijdUit(tijdDeel) : null };
}

// ---------- plaats en district ----------

// De districten van de stad: naam, de woorden die ze noemen, en hun postcodes. District Antwerpen apart.
const DISTRICT_WOORDEN = Object.freeze({
  "Berendrecht-Zandvliet-Lillo": /\b(?:berendrecht|zandvliet|lillo)\b/i,
});
export const ANDERE_DISTRICTEN = Object.freeze(DISTRICT_CHANNELS.map((c) => Object.freeze({
  naam: c.label,
  woord: DISTRICT_WOORDEN[c.label] ?? new RegExp(`\\b${c.label.toLowerCase()}\\b`, "i"),
  postcodes: c.postcodes,
})));
const ANTWERPEN = "Antwerpen";
const postcodesVanDistrict = (naam) => (naam === ANTWERPEN ? [...DISTRICT_POSTCODES] : [...(ANDERE_DISTRICTEN.find((d) => d.naam === naam)?.postcodes ?? [])]);
const districtVanPostcode = (postcode) => (DISTRICT_POSTCODES.includes(postcode) ? ANTWERPEN : ANDERE_DISTRICTEN.find((d) => d.postcodes.includes(postcode))?.naam ?? null);

// Het district dat een tekst (een kop of een plaatsregel) noemt: de naam, "district Antwerpen" of een postcode van de
// stad. null als er geen in staat; "?" als er meer dan één in staat.
export function districtVanTekst(tekst) {
  const t = cleanText(tekst);
  if (!t) return null;
  const gevonden = new Set();
  if (/\bdistrict\s+antwerpen\b/i.test(t) || /^(?:district\s+)?antwerpen$/i.test(t)) gevonden.add(ANTWERPEN);
  for (const d of ANDERE_DISTRICTEN) if (d.woord.test(t)) gevonden.add(d.naam);
  for (const postcode of postcodesInText(t)) gevonden.add(districtVanPostcode(postcode));
  gevonden.delete(null);
  if (!gevonden.size) return null;
  return gevonden.size === 1 ? [...gevonden][0] : "?";
}

// Woorden waarop een straat of plein eindigt: zonder bekende straatnaam (de toetsen, een straat die de straatas niet
// kent) telt een nummer alleen als huisnummer na zo'n woord.
const STRAAT_EINDE = /(?:straat|steenweg|baan|laan|lei|plein|plaats|markt|kaai|kade|vest|dreef|weg|singel|dijk|hof|hoeve|dok|park|berg|veld|vliet|reitje|wal|pad|gang|ring|brug|poort|dam|vaart|kouter|heide|hoek)$/;
const NUMMER_ERNA_GEEN_HUISNUMMER = /^\s*(?:tot\b|-|–|en\s+\d|jaar\b|euro\b|uur\b|u\b|km\b|meter\b|keer\b|plaatsen\b|personen\b|kinderen\b|deelnemers\b|x\b|%)/i;
const ADRES = /(?:^|[\s(,;])([\p{L}][\p{L}'’.-]*(?:[ -][\p{L}'’.-]+){0,4}) (\d{1,4}[a-z]?)(?=$|[\s),.;])/gu;

// Het adres in een regel: { straat, nummer, postcodes } met de postcodes die de straatas voor die straat kent (leeg als
// de straat er niet in staat), of null. `straten`: plat(straatnaam) → postcodes (lib/vaste-adressen.mjs, plat).
export function adresIn(tekst, { straten = new Map() } = {}) {
  for (const m of String(tekst ?? "").matchAll(ADRES)) {
    const na = String(tekst).slice(m.index + m[0].length);
    if (NUMMER_ERNA_GEEN_HUISNUMMER.test(na)) continue;
    const woorden = m[1].split(/\s+/);
    for (let n = Math.min(woorden.length, 5); n >= 1; n -= 1) {
      const naam = woorden.slice(-n).join(" ");
      const postcodes = straten.get(plat(naam));
      if (postcodes) return { straat: naam, nummer: m[2], postcodes: [...postcodes].sort() };
    }
    const laatste = plat(woorden.at(-1));
    if (STRAAT_EINDE.test(laatste)) return { straat: woorden.at(-1), nummer: m[2], postcodes: [] };
  }
  return null;
}

// Geen plaatsregel: prijzen, inschrijven, links en uren.
const GEEN_PLAATS = /€|\beuro\b|gratis|tarief|kassa|\bvvk\b|inschrijv|reserv|https?:|www\.|\buur\b|\d[.:]\d{2}\b|\bjaar\b/i;
const PLAATS_LABEL = /^(?:waar|locatie|plaats|adres)\s*:\s*/i;

// De plaatsregel van een stuk: de eerste korte regel met een straat en huisnummer, anders een regel "Waar: ...", anders
// "<plek>, <district>". { tekst, adres } of null.
export function plaatsUit(regels, kennis = {}) {
  const kandidaten = regels.map((tekst) => cleanText(tekst)).filter((tekst) => tekst && tekst.length <= 120 && !GEEN_PLAATS.test(tekst) && !isPersoonlijk(tekst));
  for (const tekst of kandidaten) {
    const adres = adresIn(tekst.replace(PLAATS_LABEL, ""), kennis);
    if (adres) return { tekst: tekst.replace(PLAATS_LABEL, ""), adres };
  }
  const gelabeld = kandidaten.find((tekst) => PLAATS_LABEL.test(tekst) && tekst.replace(PLAATS_LABEL, "").length >= 3);
  if (gelabeld) return { tekst: gelabeld.replace(PLAATS_LABEL, ""), adres: null };
  const metDistrict = kandidaten.find((tekst) => {
    const delen = tekst.split(/\s*,\s*/);
    return delen.length >= 2 && delen[0].length >= 3 && ![null, "?"].includes(districtVanTekst(delen.at(-1)));
  });
  return metDistrict ? { tekst: metDistrict, adres: null } : null;
}

// Het district van een activiteit uit de kop, de plaats en de straat; null als het niet vaststaat of iets het
// tegenspreekt.
export function districtVan(kop, plaats, adres) {
  const uitKop = kop ? districtVanTekst(kop) : null;
  const uitPlaats = plaats ? districtVanTekst(plaats) : null;
  if (uitKop === "?" || uitPlaats === "?") return null;
  if (uitKop && uitPlaats && uitKop !== uitPlaats) return null;
  const uitStraat = new Set((adres?.postcodes ?? []).map(districtVanPostcode).filter(Boolean));
  const district = uitKop ?? uitPlaats;
  if (district) return !uitStraat.size || uitStraat.has(district) ? district : null;
  return uitStraat.size === 1 ? [...uitStraat][0] : null;
}

// ---------- soort persbericht ----------

// Een zitting van raad of college: eBesluit en de vergaderingen hebben die al, en het is geen activiteit.
const BESTUUR = /\b(?:dagorde|ontwerpbesluit\w*|agenda'?s? (?:van de )?(?:raadscommissies?|gemeenteraad|districtsraad))\b|\bcollege van (?:burgemeester|maandag|dinsdag|woensdag|donderdag|vrijdag)/i;
// Een beleidsbeslissing, een investering, een maatregel of een controle: geen activiteit voor het publiek.
const BELEID = /\b(?:beslist|beslissing\w*|besluit|keurt|goedgekeurd|goedkeuring|investeer\w*|investering\w*|begroting\w*|budget\w*|subsidie\w*|reglement\w*|verordening\w*|maatregel\w*|verbod|verboden|belasting\w*|tarie(?:f|ven)|akkoord|beleid\w*|hervorming\w*|aanbesteding\w*|overeenkomst\w*|verkiezing\w*|college|gemeenteraad|districtsraad|raadscommissie\w*|inbreuk\w*|boete\w*|gesloten|sluiting\w*|controle\w*)\b/i;
// Een activiteit voor het publiek, ook zonder uur.
const ACTIVITEIT = /\b(?:feest\w*|viering\w*|optreden\w*|voorstelling\w*|show\w*|concert\w*|festival\w*|markt\w*|wandeling\w*|rondleiding\w*|workshop\w*|tentoonstelling\w*|expo\w*|film\w*|lezing\w*|opening\w*|opendeur\w*|stoet\w*|parade\w*|sinterklaas\w*|sint|kerst\w*|activiteit\w*|evenement\w*|beurs\w*|vertelling\w*|voorlees\w*|muziek\w*|theater\w*|zoektocht\w*|kermis\w*|braderie\w*|rommelmarkt\w*|fuif\w*|quiz\w*|sportdag\w*|speeldag\w*|speelnamiddag\w*|kinderboerderij\w*|ontmoeting\w*|bezoek\w*)\b/i;

// ---------- inschrijven, volzet, provincie ----------

const GEEN_INSCHRIJVING = /zonder\s+(?:voorafgaande\s+)?inschrijving|geen\s+inschrijving|inschrijv\w*\s+(?:is\s+)?niet\s+(?:nodig|verplicht)|niet\s+(?:nodig|verplicht)\s+(?:om\s+)?in\s+te\s+schrijven|vrije\s+toegang|vrij\s+toegankelijk|gratis\s+toegankelijk/i;
const INSCHRIJVEN = /inschrijv|in te schrijven|schrijf (?:je|u) in|reserveer|reservatie|reserveren|\btickets?\b|\bvvk\b|aanmelden|aanmelding/i;
const VOLZET = /\b(?:uitverkocht|volzet|volgeboekt|wachtlijst)\b|geen plaatsen meer/i;
const PROVINCIE = /\bprovincie\b|\bprovincia(?:al|le)\b|\bprovinciehuis\b|\bgedeputeerde\b/i;
const PROVINCIE_HOST = /(^|\.)provincieantwerpen\.be$/i;

const hostVan = (url) => {
  try {
    return new URL(String(url)).hostname.toLowerCase();
  } catch {
    return "";
  }
};

// De link voor meer informatie: de eerste https-link die niet naar de persruimte gaat, zonder vraag of anker. Nooit een
// partijsite.
export function meerInfoUit(links) {
  for (const link of links) {
    let url;
    try {
      url = new URL(link);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || url.hostname === PERS_HOST || url.username || url.password || PARTIJ_DOMEIN.test(url.hostname)) continue;
    const schoon = safeHttpsUrl(`https://${url.hostname}${url.pathname}`);
    if (schoon) return schoon.slice(0, 300);
  }
  return null;
}

const datumNl = (iso) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const kopSleutel = (kop) => plat(kop).replace(/\s+/g, "-").slice(0, 40).replace(/-+$/, "") || "bericht";
const hashVan = (tekst) => createHash("sha256").update(String(tekst)).digest("hex").slice(0, 10);

// ---------- de activiteiten van één persbericht ----------

// Leest één persbericht. `bericht`: { slug, url, titel, gepubliceerd } uit de feed. Geeft { kandidaten, redenen }:
// per activiteit { item, tekst } (tekst: de woorden van het stuk, alleen om dubbels te herkennen; ze worden nooit
// weggeschreven) en per reden waarom een stuk geen activiteit gaf, hoe vaak.
export function persberichtLezen(html, bericht, { retrievedAt = null, kennis = {} } = {}) {
  const redenen = {};
  const tel = (reden) => {
    redenen[reden] = (redenen[reden] ?? 0) + 1;
  };
  const artikel = artikelUit(html);
  const titel = cleanText(bericht.titel || artikel.titel || "");
  const gepubliceerd = artikel.gepubliceerd ?? bericht.gepubliceerd;
  const vanafDag = brusselsDate(new Date(gepubliceerd));
  const blokken = blokkenUit(html);
  const namen = namenUit(html);
  const geen = (reden) => {
    tel(reden);
    return { kandidaten: [], redenen };
  };
  if (!titel || !vanafDag) return geen("onleesbaar");
  if (BESTUUR.test(titel)) return geen("bestuur");
  const alleTekst = [titel, ...blokken.map((b) => b.tekst)].join("\n");
  const alleLinks = blokken.flatMap((b) => b.links);
  if (PARTIJ_NAAM.test(alleTekst) || POLITIEK_WOORD.test(alleTekst) || alleLinks.some((link) => PARTIJ_DOMEIN.test(hostVan(link)))) return geen("politiek");
  if (BELEID.test(titel)) return geen("beleid");
  if (MANDAAT.test(titel) || isPersoonlijk(titel) || noemtNaam(titel, namen)) return geen("persoonsgegeven");
  if (noemtVerhuis(titel)) return geen("verhuis");

  const stukken = [{ kop: null, blokken: [] }];
  for (const blok of blokken) {
    if (blok.soort === "kop") stukken.push({ kop: blok.tekst.replace(/[:.]\s*$/, "").trim(), blokken: [] });
    else stukken.at(-1).blokken.push(blok);
  }

  const gevonden = [];
  for (const stuk of stukken) {
    const kort = stuk.blokken.filter((b) => b.tekst.length <= KORT);
    const metDatum = kort.filter((b) => noemtDatum(b.tekst));
    if (!metDatum.length) continue; // geen datum: geen aankondiging (een inleiding, een uitleg)
    // De datumregel: een korte regel die met een datum begint ("Zaterdag 28 november van 14 tot 16.30 uur"). Precies één.
    const regels = new Map();
    for (const b of metDatum) {
      const gelezen = leesDatumregel(b.tekst, vanafDag);
      if (gelezen.reden !== "datum_onleesbaar") regels.set(plat(b.tekst), { b, gelezen });
    }
    if (!regels.size) continue; // alleen een datum in een zin ("Afgelopen zaterdag 14 november ..."): geen aankondiging
    if (regels.size > 1) {
      tel("meer_dan_een_datum");
      continue;
    }
    const [{ b: datumBlok, gelezen: datum }] = regels.values();
    if (datum.reden) {
      tel(datum.reden);
      continue;
    }
    // Een andere korte regel mag dezelfde dag herhalen ("De Sint komt op zondag 6 december."), maar geen andere dag
    // noemen (een inschrijvingsdatum, een tweede moment): dan is het twijfel.
    const binnen = (dag) => dag >= datum.date && dag <= (datum.endDate ?? datum.date);
    if (metDatum.some((b) => b !== datumBlok && plat(b.tekst) !== plat(datumBlok.tekst) && !genoemdeDagen(b.tekst, vanafDag).every(binnen))) {
      tel("meer_dan_een_datum");
      continue;
    }
    const andere = kort.filter((b) => !noemtDatum(b.tekst));
    const uren = [...new Map(andere.map((b) => tijdUit(b.tekst)).filter(Boolean).map((t) => [`${t.timeSlot}|${t.timeText}`, t])).values()];
    const tijd = datum.tijd ?? (uren.length === 1 ? uren[0] : null);
    const plaats = plaatsUit(andere.map((b) => b.tekst), kennis);
    if (!plaats) {
      tel("geen_plaats");
      continue;
    }
    const kop = stuk.kop && !/^praktisch|^praktische info/i.test(stuk.kop) ? stuk.kop : null;
    const district = districtVan(kop, plaats.tekst, plaats.adres);
    if (!district) {
      tel("district_onzeker");
      continue;
    }
    const tekst = [titel, kop, ...stuk.blokken.map((b) => b.tekst)].filter(Boolean).join("\n");
    if (!tijd && !ACTIVITEIT.test(tekst)) {
      tel("geen_activiteit");
      continue;
    }
    if ([kop, plaats.tekst].some((t) => t && (MANDAAT.test(t) || isPersoonlijk(t) || noemtNaam(t, namen)))) {
      tel("persoonsgegeven");
      continue;
    }
    if ([kop, plaats.tekst].some((t) => t && noemtVerhuis(t))) {
      tel("verhuis");
      continue;
    }
    const links = stuk.blokken.flatMap((b) => b.links);
    const infoUrl = meerInfoUit(links);
    const geenInschrijving = GEEN_INSCHRIJVING.test(tekst);
    const inschrijven = !geenInschrijving && INSCHRIJVEN.test(tekst);
    const volzet = VOLZET.test(tekst);
    const provincie = PROVINCIE.test(tekst) || links.some((link) => PROVINCIE_HOST.test(hostVan(link)));
    if (provincie && volzet) {
      tel("provincie_volzet");
      continue;
    }
    if (provincie && !infoUrl) {
      tel("provincie_zonder_link");
      continue;
    }
    if (provincie && !inschrijven && !geenInschrijving) {
      tel("provincie_zonder_inschrijving");
      continue;
    }
    gevonden.push({ stuk, kop, datum, tijd, plaats, district, tekst, infoUrl, inschrijven, geenInschrijving, volzet, provincie });
  }

  const ids = new Set();
  const kandidaten = gevonden.map((g) => {
    const metKop = g.kop && (gevonden.length > 1 || ![null, "?"].includes(districtVanTekst(g.kop)));
    const title = (metKop ? `${titel} (${g.kop})` : titel).slice(0, 200);
    let location = g.plaats.tekst.replace(/[\s.;]+$/, "");
    const inTekst = postcodesInText(location);
    // De postcode van de straat volgens de straatas, als die er precies één in dat district kent.
    const uitStraat = (g.plaats.adres?.postcodes ?? []).filter((p) => postcodesVanDistrict(g.district).includes(p));
    const zeker = uitStraat.length === 1 ? uitStraat[0] : null;
    const postcodes = inTekst.length ? inTekst : zeker ? [zeker] : g.district !== ANTWERPEN ? postcodesVanDistrict(g.district) : [];
    // Noemt de plaats geen district of postcode, dan komt het district erbij (met de postcode als de straat ze zeker zegt).
    if (!districtVanTekst(location)) location = zeker ? `${location}, ${zeker} ${g.district}` : `${location}, ${g.district}`;
    // Het thema uit de titel en de kop alleen: een woord als "lopen" in het verhaal maakt van een Sintfeest geen sport.
    const theme = themeFor(title, g.kop ?? "");
    const info = [
      `Aangekondigd in een persbericht van stad Antwerpen van ${datumNl(vanafDag)}.`,
      g.provincie ? "Een activiteit van de provincie Antwerpen." : null,
      g.geenInschrijving ? "Inschrijven is niet nodig." : g.inschrijven ? "Inschrijven nodig." : null,
      g.volzet ? "Volzet volgens het persbericht." : null,
      g.infoUrl ? "Meer informatie via de link." : null,
    ].filter(Boolean).join(" ");
    let id = `${ID_PREFIX}${hashVan(bericht.slug)}-${kopSleutel(g.kop ?? "")}-${g.datum.date}`;
    for (let n = 2; ids.has(id); n += 1) id = `${ID_PREFIX}${hashVan(bericht.slug)}-${kopSleutel(g.kop ?? "")}-${g.datum.date}-${n}`;
    ids.add(id);
    const item = {
      id,
      externalId: bericht.slug.slice(0, 80),
      title,
      theme,
      className: classNameForTheme(theme),
      date: g.datum.date,
      endDate: g.datum.endDate,
      timeSlot: g.tijd?.timeSlot ?? "Info",
      timeText: g.tijd?.timeText ?? "",
      location: location.slice(0, 300),
      postcodes,
      info,
      ...(g.infoUrl ? { infoUrl: g.infoUrl } : {}),
      kind: "activity",
      sourceUrl: `${PERS_BASIS}/${bericht.slug}`,
      retrievedAt,
      reviewRequired: false,
      inDistrict: g.district === ANTWERPEN,
    };
    return { item, tekst: g.tekst };
  });
  return { kandidaten, redenen };
}

// ---------- dubbels met een andere bron ----------

const STOPWOORDEN = new Set([
  "januari", "februari", "maart", "april", "juni", "juli", "augustus", "september", "oktober", "november", "december",
  "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag",
  "antwerpen", "antwerpse", "district", "districten", "stad", "berchem", "berendrecht", "zandvliet", "lillo", "borgerhout",
  "borsbeek", "deurne", "ekeren", "hoboken", "merksem", "wilrijk",
  "voor", "naar", "door", "over", "zijn", "deze", "komt", "komen", "wordt", "worden", "kunnen", "gratis", "meer", "info",
  "locatie", "officiele", "bron", "plaats", "volgens", "bericht", "persbericht", "nieuw", "nieuwe", "jaar", "alle",
  "heel", "veel", "vanaf", "tussen", "tijdens", "samen", "elke", "hier", "daar", "waar", "wanneer", "praktisch", "activiteit",
  "evenement", "kinderen", "iedereen", "welkom", "uur",
]);
const woorden = (tekst) => new Set(plat(tekst).split(" ").filter((w) => w.length >= 4 && !/^\d+$/.test(w) && !STOPWOORDEN.has(w)));
const gedeeld = (a, b) => [...a].some((w) => b.has(w));
const tijdVan = (item) => (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(item?.timeSlot ?? "")) ? item.timeSlot : null);
const overlapt = (a, b) => a.date <= (b.endDate || b.date) && b.date <= (a.endDate || a.date);
const adresSleutels = (location) => new Set([...String(location ?? "").matchAll(ADRES)]
  .filter((m) => !NUMMER_ERNA_GEEN_HUISNUMMER.test(String(location).slice(m.index + m[0].length)))
  .map((m) => `${plat(m[1].split(/\s+/).at(-1))} ${m[2].toLowerCase()}`));
const straatWoorden = (location) => new Set(plat(location).split(" ").filter((w) => w.length >= 5 && STRAAT_EINDE.test(w)));

function districtVanItem(item, scope, standaard = null) {
  if (scope === "district" || item?.inDistrict === true) return ANTWERPEN;
  const uitPostcodes = new Set((Array.isArray(item?.postcodes) ? item.postcodes : []).map(districtVanPostcode).filter(Boolean));
  if (uitPostcodes.size === 1) return [...uitPostcodes][0];
  const uitTekst = districtVanTekst(item?.location);
  if (uitTekst && uitTekst !== "?") return uitTekst;
  return standaard;
}

// Gaan twee agendapunten over dezelfde activiteit? Alleen bij overlappende dagen, en dan:
// - hetzelfde adres (straat en huisnummer), en geen verschillend concreet uur; of
// - in hetzelfde district, met hetzelfde concrete uur of in dezelfde straat (zonder verschillend uur), en minstens één
//   gedeeld inhoudswoord (feest, sint, centrum ...; geen maand, district of bijwoord).
export function zelfdeActiviteit(a, b) {
  if (!a?.item || !b?.item || !a.item.date || !b.item.date || !overlapt(a.item, b.item)) return false;
  const [tijdA, tijdB] = [tijdVan(a.item), tijdVan(b.item)];
  const tijdenPassen = !tijdA || !tijdB || tijdA === tijdB;
  if (!tijdenPassen) return false;
  if (gedeeld(adresSleutels(a.item.location), adresSleutels(b.item.location))) return true;
  const [districtA, districtB] = [districtVanItem(a.item, a.scope, a.standaardDistrict), districtVanItem(b.item, b.scope, b.standaardDistrict)];
  if (!districtA || districtA !== districtB) return false;
  const inhoud = gedeeld(woorden(`${a.item.title} ${a.tekst ?? ""}`), woorden(`${b.item.title} ${b.tekst ?? ""}`));
  if (!inhoud) return false;
  return Boolean(tijdA && tijdA === tijdB) || gedeeld(straatWoorden(a.item.location), straatWoorden(b.item.location));
}

// De dubbels: `kandidaten` ({ item, tekst }, nieuwste persbericht eerst), `andere` ({ sourceId, scope, item } uit de
// andere bronnen) en `hand` (de handmatige items van site/agenda.js).
// - Gaat een activiteit over een handmatig item, dan valt ze weg: dat item staat al op de site.
// - Staat dezelfde activiteit al in een ander persbericht (nieuwer), dan valt ze weg.
// - Staat ze in een andere bron, dan krijgt ze `sameAs` met de ids daarvan: lib/merge-events.mjs maakt er één punt van
//   (met beide bronnen), zodat ze geen tweede keer op de site staat. Een vorige koppeling blijft zolang dat item er is.
// Geeft { kandidaten, tel: { dubbel, dubbelHand, dubbelIntern } }.
export function dubbelsZoeken(kandidaten, andere = [], { hand = [] } = {}) {
  const tel = { dubbel: 0, dubbelHand: 0, dubbelIntern: 0 };
  const bekend = new Set(andere.map((a) => a.item?.id).filter(Boolean));
  const uit = [];
  for (const kandidaat of kandidaten) {
    const eigen = { item: kandidaat.item, tekst: kandidaat.tekst, scope: "stad" };
    if (hand.some((h) => zelfdeActiviteit(eigen, { item: h, scope: null, standaardDistrict: ANTWERPEN }))) {
      tel.dubbelHand += 1;
      continue;
    }
    if (uit.some((u) => zelfdeActiviteit(eigen, { item: u.item, tekst: u.tekst, scope: "stad" }))) {
      tel.dubbelIntern += 1;
      continue;
    }
    const { sameAs: vorige, ...item } = kandidaat.item;
    const ids = new Set((Array.isArray(vorige) ? vorige : []).filter((id) => bekend.has(id)));
    for (const ander of andere) if (ander.item?.id && zelfdeActiviteit(eigen, ander)) ids.add(ander.item.id);
    if (ids.size) tel.dubbel += 1;
    uit.push({ item: ids.size ? { ...item, sameAs: [...ids].sort().slice(0, 10) } : item, tekst: kandidaat.tekst });
  }
  return { kandidaten: uit, tel };
}
