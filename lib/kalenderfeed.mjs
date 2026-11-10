// De publieke agenda als kalender om te volgen (bouwrij lijst 23, punt 10: "Publieke agenda als kalenderfeed voor
// bewoners"). Tot nu had de site alleen een .ics per activiteit (site/agenda-ics.js): een momentopname die daarna nooit
// meer verandert. Een feed volg je: de agenda van de bewoner haalt hem zelf opnieuw op, en een gewijzigd uur, een andere
// plaats of een activiteit die wegvalt, komt vanzelf mee. Dat kan omdat elk punt een vaste UID heeft: dezelfde als in
// zijn losse .ics (uidForItem), afgeleid van de stabiele id van het punt.
//
// De feeds (site/kalender/<slug>.ics, te volgen als https:// of webcal://; uitleg voor bewoners op /kalender/):
// - agenda: alles wat de agenda toont in district Antwerpen (de site met "District Antwerpen" aan, alle soorten), behalve
//   de wekelijkse markten. Die toont de site ook niet als losse activiteiten maar gebundeld, en honderden marktdagen
//   maken een agenda onleesbaar; ze hebben hun eigen feed.
// - uitgaan: de standaardweergave van de site, "Uitgaan & evenementen" (de soorten die standaard aan staan).
// - één feed per soort: de soortknoppen van de site (site/agenda-uitgaan.js), in district Antwerpen.
// - stad: wat de site erbij toont met "Stad Antwerpen" aan (de andere districten), zonder de weekmarkten.
// Een wijk heeft (nog) geen eigen feed: of een punt in een wijk ligt, beslist de site pas in de browser, met de kaart.
// Elke feed houdt ook de punten van de laatste VERLEDEN_DAGEN dagen uit het verleden (site/verleden/): wat voorbij is,
// verdwijnt dan niet de dag erna uit iemands agenda. De site toont het ook nog, als "Voorbij".
//
// De vaste regels van de publieke agenda gelden ook in de feed (kalenderProblemen):
// - de plaats staat er precies zoals de site ze toont, met het exacte huisnummer; de feed haalt nooit een nummer weg;
// - nooit een reden of het woord verhuis, geen e-mail, telefoon, rekening of querystring, geen link naar een ruw
//   GIPOD-record en geen parkeerverbod: dezelfde poort als het verleden en de eventpagina's (verledenRecordProblemen);
//   en nooit een naam na een dossiercode (naamNaCodeWeg, dezelfde regel als de kaartjes);
// - niets van N-VA en geen andere politiek (vaste regel van 8 november 2026): een partijnaam of een link naar een
//   partij houdt het punt uit elke feed. Dezelfde partijnamen en -domeinen als de Gateway
//   (src/publieke-agenda/afzenders.ts); "groen" en "vooruit" zijn daar bewust geen partijnaam, het zijn gewone woorden;
// - een activiteit van de provincie alleen met de link en met wat er over inschrijven gezegd is, en nooit als ze volzet
//   is (vaste regel voor de publieke agenda);
// - een aanvraag die de stad nog niet goedkeurde (nietGoedgekeurd), staat er als voorlopig in: STATUS:TENTATIVE en
//   "aanvraag" in de titel. Wordt ze goedgekeurd, dan past de agenda zich aan; valt ze weg, dan verdwijnt ze;
// - UiTdatabank niet: die sleutel geldt voor één website (isUitItem in site/agenda.js).
// Een punt dat niet door de poort komt, staat in geen enkele feed; de build meldt het met codes, nooit met de tekst.
//
// Puur: geen bestanden, geen klok, geen netwerk. Dezelfde invoer geeft byte voor byte dezelfde feeds; DTSTAMP is het
// moment van de verversing (generatedAt van site/agenda-feed.js), zoals de rest van de build.
import "../site/agenda-ics.js";
import "../site/event-types.js";
import "../site/agenda-uitgaan.js";
import { bezoekersHint, bezoekersLinks } from "../site/bezoekers-bronnen.js";
import { naamNaCodeWeg } from "../site/kaart-uitleg.js";
import { laatsteDag, verledenRecordProblemen } from "./agenda-verleden.mjs";
import { PUBLIEKE_ORIGIN, eventpaginaUrl } from "./eventpagina.mjs";

const { escapeText, foldLine, uidForItem } = globalThis.AgendaIcs;
const uitgaan = globalThis.PublicAgendaUitgaan;
const soorten = globalThis.PublicAgendaEventTypes;

export const KALENDER_DIR = "site/kalender";
export const KALENDER_PAGINA = `${PUBLIEKE_ORIGIN}/kalender/`;
export const VERLEDEN_DAGEN = 31;
// Hoe vaak een agenda de feed opnieuw mag ophalen (REFRESH-INTERVAL, X-PUBLISHED-TTL). De data verandert één keer per
// dag; zes uur houdt de bandbreedte van Render klein (render.yaml) en een wijziging toch dezelfde dag zichtbaar.
export const VERVERS_INTERVAL = "PT6H";

export const feedUrl = (slug) => `${PUBLIEKE_ORIGIN}/kalender/${slug}.ics`;
export const webcalUrl = (slug) => feedUrl(slug).replace(/^https:\/\//, "webcal://");

// Vaste adressen per soort: een adres dat bewoners volgen, mag niet veranderen als een knop een andere naam krijgt.
export const SOORT_SLUGS = Object.freeze({
  festival: "feest-en-festival",
  neighborhood: "buurt-en-straat",
  culture: "cultuur",
  family: "familie-en-kinderen",
  parade: "stoet-en-processie",
  sport: "sport",
  flea: "rommelmarkt-en-braderie",
  shopping: "koopzondag",
  meetings: "raad-en-commissies",
  info: "infomomenten-en-vorming",
  admin: "inspraak-en-bevraging",
  calls: "oproepen-en-deadlines",
  works: "werken-en-hinder",
  markets: "wekelijkse-markten",
  other: "overig",
});

const NAAM = "Mijn publieke agenda District Antwerpen";

export const KALENDER_FEEDS = Object.freeze([
  Object.freeze({
    slug: "agenda",
    naam: NAAM,
    uitleg: "Alles wat de publieke agenda toont in district Antwerpen, met de officiële bron. De wekelijkse markten hebben een eigen agenda.",
    hoort: (punt) => punt.district && punt.soort !== "markets",
  }),
  Object.freeze({
    slug: "uitgaan",
    naam: `${NAAM} – Uitgaan & evenementen`,
    uitleg: "Wat de site standaard toont: feesten, buurt en straat, cultuur, familie, stoeten, sport, rommelmarkten en koopzondagen in district Antwerpen.",
    hoort: (punt) => punt.district && uitgaan.defaultOn.includes(punt.soort),
  }),
  ...uitgaan.categories.map((categorie) => Object.freeze({
    slug: SOORT_SLUGS[categorie.key],
    soort: categorie.key,
    naam: `${NAAM} – ${categorie.label}`,
    uitleg: `${categorie.label} in district Antwerpen, uit de publieke agenda, met de officiële bron.`,
    hoort: (punt) => punt.district && punt.soort === categorie.key,
  })),
  Object.freeze({
    slug: "stad",
    naam: `${NAAM} – Stad Antwerpen`,
    uitleg: "Wat de stad publiceert voor de andere districten (de knop Stad Antwerpen op de site), zonder de wekelijkse markten.",
    hoort: (punt) => !punt.district && punt.soort !== "markets",
  }),
]);

// ---------- de poort ----------

// Dezelfde partijnamen en -domeinen als de Gateway (src/publieke-agenda/afzenders.ts, PARTIJ_NAAM en PARTIJ_ADRES).
const PARTIJ_NAAM = /\b(n-?va|vlaams belang|cd&v|open ?vld|pvda|ptb|les engag[eé]s)\b/i;
const PARTIJ_DOMEIN = /(^|\.)(n-?va\.be|vlaamsbelang\.org|vooruit\.org|cdenv\.be|groen\.be|openvld\.be|pvda\.be|ptb\.be|mr\.be|ps\.be|lesengages\.be|ecolo\.be|defi\.eu|voltbelgie\.org|volteuropa\.org)$/i;
// Woorden die alleen over partijpolitiek gaan. Een openbare zitting van de districtsraad is geen partijpolitiek: die
// toont de site als "Raad & commissies".
const POLITIEK_WOORD = /\b(partijcongres|partijbureau|partijavond|partijfeest|verkiezingsdebat|verkiezingsmeeting|verkiezingscampagne|kiescampagne|lijsttrekker\w*|politiek café|politieke partij\w*)\b/i;
const PROVINCIE_BRON = /provincie/i;
const PROVINCIE_HOST = /(^|\.)provincieantwerpen\.be$/i;
const VOLZET = /\b(volzet|volgeboekt|uitverkocht|wachtlijst)\b/i;
const INSCHRIJVEN = /\b(inschrijv\w*|aanmeld\w*|reserv\w*|tickets?|vrije toegang|vrij toegankelijk|gratis toegankelijk)\b/i;

function hostVan(url) {
  try {
    return new URL(String(url ?? "")).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

const tekstVan = (punt) => [punt.record.title, punt.record.info, punt.record.location, punt.record.timeText, punt.record.sourcePublisher, punt.record.attributie, punt.hint].join(" \n ");
const linksVan = (punt) => [...punt.record.bronnen.map((bron) => bron.url), ...punt.acties.map((actie) => actie.url).filter(Boolean)];

export function isProvincie(punt) {
  return PROVINCIE_BRON.test(`${punt.record.sourceId} ${punt.record.sourcePublisher}`) || linksVan(punt).some((url) => PROVINCIE_HOST.test(hostVan(url)));
}

// Waarom een punt in geen enkele feed mag: codes, nooit de tekst (de logs van de build zijn publiek). Leeg = in orde.
export function kalenderProblemen(punt) {
  const problemen = verledenRecordProblemen({ ...punt.record, sinds: punt.record.sinds ?? punt.asOf }, "punt");
  if (punt.record.sourceId === "stad-uit") problemen.push("punt: UiTdatabank alleen op de eigen site");
  const tekst = tekstVan(punt);
  if (PARTIJ_NAAM.test(tekst) || POLITIEK_WOORD.test(tekst) || linksVan(punt).some((url) => PARTIJ_DOMEIN.test(hostVan(url)))) {
    problemen.push("punt: politiek");
  }
  if (isProvincie(punt)) {
    if (VOLZET.test(tekst)) problemen.push("punt: provincie volzet");
    if (!punt.record.bronnen.length) problemen.push("punt: provincie zonder link");
    if (!INSCHRIJVEN.test(tekst)) problemen.push("punt: provincie zegt niet of inschrijven nodig is");
  }
  return problemen;
}

// ---------- van agendapunt naar punt ----------

const TEKSTVELDEN = Object.freeze(["title", "info", "dateLabel", "timeText", "location"]);

// Een naam na een dossiercode valt weg, zoals op de kaartjes; de rest (ook elk huisnummer) blijft letterlijk staan.
function zonderNamen(record) {
  const schoon = { ...record };
  for (const veld of TEKSTVELDEN) if (typeof schoon[veld] === "string") schoon[veld] = naamNaCodeWeg(schoon[veld]);
  return schoon;
}

const metSoort = (item) => ({ ...item, eventType: item.eventType || soorten.classifyEventType(item) || "other" });

// Zoals passesScope in site/agenda.js met alleen "District Antwerpen" aan: wat van het district is, en de koopzondagen
// en weekmarkten van de stad die in het district liggen.
function inDistrictsweergave(record, soort) {
  if (record.scope !== "stad") return true;
  return record.inDistrict === true && (soort === "shopping" || soort === "markets");
}

// Een https-link uit de knoppen voor bezoekers (tickets, inschrijven, de marktpagina), behalve wat al een bron is.
// Inschrijven per e-mail wordt een zin: het adres staat op de officiële pagina, niet in de feed.
function actiesVan(item, record) {
  const bronnen = new Set(record.bronnen.map((bron) => bron.url));
  const acties = [];
  for (const link of bezoekersLinks({ source: "agenda", item, url: item.link })) {
    if (link.type !== "main") continue;
    if (/^mailto:/i.test(link.url)) acties.push({ label: link.label, url: "" });
    else if (/^https:\/\//i.test(link.url) && !bronnen.has(link.url) && link.url !== item.link) acties.push({ label: link.label, url: link.url });
  }
  return acties;
}

function puntenVanActueel(actueel, asOf) {
  const items = uitgaan.markeerWekelijkseReeksen(actueel.map(({ item }) => metSoort(item)));
  return actueel.map(({ record, pagina }, index) => {
    const item = items[index];
    const soort = uitgaan.categoryOf(item);
    const schoon = zonderNamen(record);
    return {
      asOf,
      record: schoon,
      soort,
      district: inDistrictsweergave(schoon, soort),
      pagina: pagina === true,
      voorbij: false,
      aanvraag: item.nietGoedgekeurd === true,
      acties: actiesVan(item, schoon),
      hint: bezoekersHint({ source: "agenda", item }),
    };
  });
}

function puntenVanVerleden(records, asOf) {
  const vanaf = dagPlus(asOf, -VERLEDEN_DAGEN);
  return records
    .filter((record) => !record.weg && !record.opgegaanIn && laatsteDag(record) < asOf && laatsteDag(record) >= vanaf)
    .map((record) => {
      const schoon = zonderNamen(record);
      const soort = uitgaan.categoryOf(metSoort(schoon));
      return { asOf, record: schoon, soort, district: inDistrictsweergave(schoon, soort), pagina: true, voorbij: true, aanvraag: false, acties: [], hint: "" };
    });
}

// ---------- iCalendar ----------

const DAG = /^\d{4}-\d{2}-\d{2}$/;
const UUR = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const pad = (n) => String(n).padStart(2, "0");
const compact = (dag) => dag.replace(/-/g, "");

function dagPlus(dag, dagen) {
  const [jaar, maand, d] = dag.split("-").map(Number);
  const uit = new Date(Date.UTC(jaar, maand - 1, d + dagen));
  return `${uit.getUTCFullYear()}-${pad(uit.getUTCMonth() + 1)}-${pad(uit.getUTCDate())}`;
}

function stempel(generatedAt, asOf) {
  const tijd = Date.parse(String(generatedAt ?? ""));
  if (Number.isFinite(tijd)) return new Date(tijd).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${compact(asOf)}T000000Z`;
}

// Het einduur uit de tijdtekst van de bron, alleen als die met hetzelfde beginuur begint ("8 tot 13 uur" bij 08:00,
// "van 19 tot 2 uur" loopt tot de volgende dag). Anders de standaardduur van de losse .ics: één uur.
const UREN = /^(?:van\s+|vanaf\s+)?(\d{1,2})(?:[.:u](\d{2}))?\s*(?:uur|u)?\s*(?:tot|-|–)\s*(\d{1,2})(?:[.:u](\d{2}))?\s*(?:uur|u)\b/i;
export function eindeVan(timeSlot, timeText, dag) {
  const m = UREN.exec(String(timeText ?? "").trim());
  if (!m || !UUR.test(String(timeSlot ?? ""))) return "";
  const beginUur = Number(m[1]);
  const beginMin = Number(m[2] ?? 0);
  if (`${pad(beginUur)}:${pad(beginMin)}` !== timeSlot) return "";
  let uur = Number(m[3]);
  const min = Number(m[4] ?? 0);
  if (uur > 24 || min > 59 || (uur === 24 && min > 0)) return "";
  let einddag = dag;
  if (uur === 24) {
    uur = 0;
    einddag = dagPlus(dag, 1);
  } else if (uur * 60 + min <= beginUur * 60 + beginMin) {
    einddag = dagPlus(dag, 1);
  }
  return `${compact(einddag)}T${pad(uur)}${pad(min)}00`;
}

// Een punt met een uur op één dag krijgt dat uur; een punt over meer dagen of zonder vast uur staat er de hele dag (de
// einddag is inbegrepen, DTEND is exclusief: RFC 5545). Het uur staat dan in de beschrijving.
const metUur = (record) => UUR.test(String(record.timeSlot ?? "")) && laatsteDag(record) === record.date;

function tijdRegels(record) {
  if (metUur(record)) {
    const einde = eindeVan(record.timeSlot, record.timeText, record.date);
    return [
      `DTSTART;TZID=Europe/Brussels:${compact(record.date)}T${record.timeSlot.replace(":", "")}00`,
      einde ? `DTEND;TZID=Europe/Brussels:${einde}` : "DURATION:PT1H",
    ];
  }
  return [`DTSTART;VALUE=DATE:${compact(record.date)}`, `DTEND;VALUE=DATE:${compact(dagPlus(laatsteDag(record), 1))}`];
}

const AANVRAAG = "aanvraag, nog niet goedgekeurd";

function beschrijving(punt) {
  const record = punt.record;
  const regels = [];
  // Dag en plaats staan al in het event zelf (DTSTART, LOCATION); de tijdtekst van de bron zegt soms meer ("data bij
  // benadering", "samenkomst om 10.30 uur").
  if (record.info) regels.push(record.info);
  if (record.timeText) regels.push(`Wanneer: ${record.timeText}`);
  if (punt.aanvraag) regels.push("Let op: dit is een aanvraag die de stad nog niet goedkeurde. Wordt ze geweigerd of afgelast, dan verdwijnt ze uit je agenda.");
  if (punt.hint) regels.push(punt.hint);
  for (const actie of punt.acties) regels.push(actie.url ? `${actie.label}: ${actie.url}` : `${actie.label}.`);
  if (isProvincie(punt)) regels.push("Een activiteit van de provincie: of je moet inschrijven en of er nog plaats is, staat op de officiële pagina.");
  if (punt.pagina) regels.push(`Op de publieke agenda: ${eventpaginaUrl(record.id)}`);
  for (const bron of record.bronnen) regels.push(`${bron.label}: ${bron.url}`);
  if (record.attributie) regels.push(record.attributie);
  return regels.join("\n");
}

function eventRegels(punt, dtstamp) {
  const record = punt.record;
  const label = uitgaan.categoryFor(punt.soort).label;
  const url = punt.pagina ? eventpaginaUrl(record.id) : record.bronnen[0]?.url || KALENDER_PAGINA;
  return [
    "BEGIN:VEVENT",
    `UID:${uidForItem(record)}`,
    `DTSTAMP:${dtstamp}`,
    ...tijdRegels(record),
    `SUMMARY:${escapeText(punt.aanvraag ? `${record.title} (${AANVRAAG})` : record.title)}`,
    ...(record.location ? [`LOCATION:${escapeText(record.location)}`] : []),
    `DESCRIPTION:${escapeText(beschrijving(punt))}`,
    `URL:${url}`,
    `CATEGORIES:${escapeText(label)}`,
    `STATUS:${punt.aanvraag ? "TENTATIVE" : "CONFIRMED"}`,
    // Een publieke activiteit maakt niemand bezet.
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
  ];
}

// Dezelfde tijdzone als de losse .ics (site/agenda-ics.js).
const VTIMEZONE = Object.freeze([
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Brussels",
  "X-LIC-LOCATION:Europe/Brussels",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
]);

export function kalenderTekst(feed, punten, dtstamp) {
  const regels = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Mijn Publieke Agenda District Antwerpen//Kalenderfeed//NL",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `NAME:${escapeText(feed.naam)}`,
    `X-WR-CALNAME:${escapeText(feed.naam)}`,
    `DESCRIPTION:${escapeText(feed.uitleg)}`,
    `X-WR-CALDESC:${escapeText(feed.uitleg)}`,
    "X-WR-TIMEZONE:Europe/Brussels",
    `URL:${KALENDER_PAGINA}`,
    `SOURCE;VALUE=URI:${feedUrl(feed.slug)}`,
    `REFRESH-INTERVAL;VALUE=DURATION:${VERVERS_INTERVAL}`,
    `X-PUBLISHED-TTL:${VERVERS_INTERVAL}`,
  ];
  if (punten.some((punt) => metUur(punt.record))) regels.push(...VTIMEZONE);
  for (const punt of punten) regels.push(...eventRegels(punt, dtstamp));
  regels.push("END:VCALENDAR");
  return `${regels.map(foldLine).join("\r\n")}\r\n`;
}

const volgorde = (a, b) => a.record.date.localeCompare(b.record.date)
  || (metUur(a.record) ? a.record.timeSlot : "").localeCompare(metUur(b.record) ? b.record.timeSlot : "")
  || a.record.id.localeCompare(b.record.id);

// actueel: [{ item, record, pagina }] voor elk publiek agendapunt; record is wat zijn eventpagina toont (recordVanItem in
// scripts/build-agenda.mjs), pagina zegt of die pagina er is. verleden: de records van site/verleden die niet actueel zijn.
// asOf: de classificatiedatum; generatedAt: het moment van de verversing.
export function bouwKalenderfeeds({ actueel = [], verleden = [], asOf, generatedAt = null } = {}) {
  if (!DAG.test(String(asOf ?? ""))) throw new Error("bouwKalenderfeeds: ongeldige asOf");
  const actueleIds = new Set(actueel.map(({ record }) => record.id));
  const kandidaten = [
    ...puntenVanActueel(actueel, asOf),
    ...puntenVanVerleden(verleden.filter((record) => !actueleIds.has(record.id)), asOf),
  ];
  const punten = [];
  const geweigerd = [];
  for (const punt of kandidaten) {
    const problemen = kalenderProblemen(punt);
    if (problemen.length) geweigerd.push({ id: String(punt.record.id ?? ""), problemen });
    else punten.push(punt);
  }
  punten.sort(volgorde);
  const dtstamp = stempel(generatedAt, asOf);
  const feeds = KALENDER_FEEDS.map((feed) => {
    const inFeed = punten.filter(feed.hoort);
    return { slug: feed.slug, naam: feed.naam, bestand: `${feed.slug}.ics`, aantal: inFeed.length, tekst: kalenderTekst(feed, inFeed, dtstamp) };
  });
  return { feeds, geweigerd, aantalPunten: punten.length };
}

// ---------- controle ----------

const encoder = new TextEncoder();

// Of een feed een geldige, volgbare kalender is: CRLF, gevouwen op 75 octetten, één kalender, en elk event met een unieke
// UID, DTSTAMP, DTSTART, SUMMARY en een https-URL.
export function validateKalenderfeed(tekst) {
  const fouten = [];
  const inhoud = String(tekst ?? "");
  if (!inhoud.endsWith("\r\n")) fouten.push("geen CRLF op het einde");
  if (/(^|[^\r])\n/.test(inhoud)) fouten.push("regeleinde zonder CR");
  if (inhoud.split("\r\n").some((regel) => encoder.encode(regel).length > 75)) fouten.push("regel langer dan 75 octetten");
  const regels = inhoud.replace(/\r\n[ \t]/g, "").split("\r\n").filter(Boolean);
  if (regels[0] !== "BEGIN:VCALENDAR" || regels.at(-1) !== "END:VCALENDAR") fouten.push("geen VCALENDAR");
  if (regels.filter((regel) => regel === "BEGIN:VCALENDAR").length !== 1) fouten.push("niet precies één VCALENDAR");
  const uids = new Set();
  let event = null;
  let aantal = 0;
  for (const regel of regels) {
    if (regel === "BEGIN:VEVENT") {
      if (event) fouten.push("VEVENT in VEVENT");
      event = [];
      continue;
    }
    if (regel === "END:VEVENT") {
      if (!event) {
        fouten.push("END:VEVENT zonder begin");
        continue;
      }
      aantal += 1;
      const uid = event.find((r) => r.startsWith("UID:"));
      if (!uid) fouten.push(`event ${aantal}: geen UID`);
      else if (uids.has(uid)) fouten.push(`event ${aantal}: dubbele UID`);
      else uids.add(uid);
      if (!event.some((r) => /^DTSTAMP:\d{8}T\d{6}Z$/.test(r))) fouten.push(`event ${aantal}: geen DTSTAMP`);
      if (!event.some((r) => /^DTSTART(?:;[^:]*)?:\d{8}(?:T\d{6})?$/.test(r))) fouten.push(`event ${aantal}: geen DTSTART`);
      if (!event.some((r) => /^SUMMARY:.+/.test(r))) fouten.push(`event ${aantal}: geen SUMMARY`);
      if (!event.some((r) => /^URL:https:\/\/\S+$/.test(r))) fouten.push(`event ${aantal}: geen https-URL`);
      event = null;
      continue;
    }
    if (event) event.push(regel);
  }
  if (event) fouten.push("VEVENT zonder einde");
  return { valid: fouten.length === 0, fouten, aantal };
}
