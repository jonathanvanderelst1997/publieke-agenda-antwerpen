// Broncontract voor site/sources/<sourceId>.json en site/sources/refresh-status.json.
// De vaste eigenschappen (scope, hosts, attributie) staan hier in code en niet in de data:
// een dagelijkse data-refresh kan dus nooit een nieuwe host of een andere scope binnensmokkelen.
import { FOREN_LAYER_URL } from "./asign-foren.mjs";
import { DISTRICT_CALENDAR_URL } from "./district-parser.mjs";
import { PROJECTS_OVERVIEW_URL } from "./district-projecten.mjs";
import { isValidIsoDate, safeHttpsUrl } from "./html-text.mjs";
import { KOOPZONDAGEN_URL } from "./koopzondagen.mjs";
import { SCHOOLSTRATEN_LAYER_URL } from "./schoolstraten.mjs";

export const MAX_AGE_HOURS = 48;
// A-Sign, laag 22 (vlakken van de evenementendossiers); hier vast, zodat dit bestand geen lus met
// lib/parcours-herkenning.mjs krijgt (daar heet het ASIGN_BRON).
export const ASIGN_EVENEMENTEN_LAYER_URL = "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/22";
export const FETCH_STATUSES = Object.freeze(["ok", "skipped_no_key", "disabled", "test_only", "error"]);
export const MAIL_ALLOWED_HOSTS = Object.freeze(["www.antwerpen.be", "burgerbegroting.be", "www.burgerbegroting.be", "www.uitinvlaanderen.be"]);
// Hoogstens zoveel items per bronbestand. Alleen UiT mag meer: daar wordt op een daggrens afgekapt
// en staat de dekking in `coverage` (zie scripts/fetch-sources-uit.mjs).
export const DEFAULT_MAX_ITEMS = 600;

const DISTRICT_ATTRIBUTION = Object.freeze({
  text: "Bron: district Antwerpen – bron stad Antwerpen (Vlaamse gratis open data licentie)",
  url: DISTRICT_CALENDAR_URL,
});

export const SOURCE_DEFINITIONS = Object.freeze({
  "district-kalender": Object.freeze({
    sourceId: "district-kalender",
    label: "Districtskalender",
    scope: "district",
    publisher: "District Antwerpen",
    attribution: DISTRICT_ATTRIBUTION,
    url: DISTRICT_CALENDAR_URL,
    allowedHosts: Object.freeze(["www.antwerpen.be"]),
    method: "antwerpen.be page-content-by-uuid (publieke portaal-API)",
    idPrefix: "district-kal-",
  }),
  "district-nieuws": Object.freeze({
    sourceId: "district-nieuws",
    label: "Districtsnieuws",
    scope: "district",
    publisher: "District Antwerpen",
    attribution: DISTRICT_ATTRIBUTION,
    url: "https://www.antwerpen.be/nl/overzicht/district-antwerpen-1",
    allowedHosts: Object.freeze(["www.antwerpen.be"]),
    method: "antwerpen.be nieuwskanaal district Antwerpen (tabel, Wanneer:, Datum:, Praktisch)",
    idPrefix: "district-news-",
  }),
  "district-vergaderingen": Object.freeze({
    sourceId: "district-vergaderingen", label: "Districtsraad en raadscommissies", scope: "district", publisher: "District Antwerpen",
    attribution: Object.freeze({ text: "Bron: district Antwerpen – openbare zittingen en vergaderdata", url: "https://www.antwerpen.be/info/5c487af01ee32dff476bc9f3/districtsraad-antwerpen-zittingen-verslagen-en-besluiten" }),
    url: "https://www.antwerpen.be/info/5c487af01ee32dff476bc9f3/districtsraad-antwerpen-zittingen-verslagen-en-besluiten", allowedHosts: Object.freeze(["www.antwerpen.be","ebesluit.antwerpen.be"]),
    method: "antwerpen.be jaartabel met fail-closed fallback naar officiële eBesluit-maandkalender voor districtsraad/raadscommissies", idPrefix: "district-vergadering-", bootstrapOptional: true,
  }),
  "district-gipod-evenementen": Object.freeze({
    sourceId: "district-gipod-evenementen",
    // Eerlijk label: de bron toont alleen evenementen IN het district; lib/gipod-events.mjs gooit alles
    // daarbuiten weg (outside_district). Stad Antwerpen zet in GIPOD alleen markten en ambulante handel;
    // echte evenementen (feest/kermis, sport) in GIPOD zijn vooral van buurgemeenten, en die vallen dus
    // weg. De bron blijft meestal leeg; ze vangt evenementen op zodra de stad ze toch in GIPOD zet.
    label: "GIPOD-evenementen in het district (stad Antwerpen meldt hier geen evenementen; GIPOD bevat vooral buurgemeenten)",
    scope: "district",
    publisher: "GIPOD / Digitaal Vlaanderen",
    attribution: Object.freeze({
      text: "Bron: GIPOD, Digitaal Vlaanderen (Modellicentie Gratis Hergebruik v1.0)",
      url: "https://geo.api.vlaanderen.be/GIPOD/ogc/features",
    }),
    url: "https://geo.api.vlaanderen.be/GIPOD/ogc/features",
    allowedHosts: Object.freeze(["geo.api.vlaanderen.be"]),
    method: "GIPOD INNAME_PUNT: conservatieve echte-evenementselectie, exact punt binnen District Antwerpen",
    idPrefix: "gipod-event-",
    shrinkGuard: false,
    bootstrapOptional: true,
  }),
  // Evenementen met naam uit collegebesluiten (lib/ebesluit-evenementen.mjs). Geen krimpgrens: een
  // evenement dat voorbij is, valt gewoon weg. Het bestand ontstaat bij de eerste verversing.
  "district-ebesluit-evenementen": Object.freeze({
    sourceId: "district-ebesluit-evenementen", label: "Evenementen volgens besluiten van stad en district (eBesluit)", scope: "district",
    publisher: "Stad en district Antwerpen / eBesluit Antwerpen", attribution: Object.freeze({ text: "Bron: eBesluit Antwerpen", url: "https://ebesluit.antwerpen.be/" }),
    url: "https://ebesluit.antwerpen.be/", allowedHosts: Object.freeze(["ebesluit.antwerpen.be"]),
    method: "eBesluit Antwerpen: goedgekeurde besluiten over evenementen, muziekactiviteiten en het Districtsfonds met een plaats in district Antwerpen, gelezen met vaste zinpatronen", idPrefix: "ebesluit-ev-", shrinkGuard: false, bootstrapOptional: true,
  }),
  // Evenementendossiers van de stad (A-Sign) als agendapunten (lib/asign-evenementen-agenda.mjs). Geen
  // fetcher: de bron ontstaat in de verversing na de parcoursherkenning (`derivedAfter`), uit de dossiers
  // die die stap al ophaalt. Ze staat dus niet in refresh-status.json; sources:health leest het bestand zelf.
  "district-asign-evenementen": Object.freeze({
    sourceId: "district-asign-evenementen", label: "Evenementen op straat (dossiers van de stad in A-Sign)", scope: "district",
    publisher: "Stad Antwerpen (A-Sign, evenementendossiers)",
    attribution: Object.freeze({ text: "Bron: stad Antwerpen, evenementendossiers in A-Sign (Vlaamse gratis open data licentie)", url: ASIGN_EVENEMENTEN_LAYER_URL }),
    url: ASIGN_EVENEMENTEN_LAYER_URL, allowedHosts: Object.freeze(["geodata.antwerpen.be"]),
    method: "A-Sign laag 22 en 23: evenementendossiers in district Antwerpen, niet geweigerd of afgelast, één item per evenementdag; naam uit de handfiche, de automatische herkenning of een besluit, anders de soort of 'naam volgt'",
    idPrefix: "asign-ev-", bootstrapOptional: true, derivedAfter: "refresh:herkenning",
  }),
  "district-ebesluit": Object.freeze({
    sourceId: "district-ebesluit", label: "Districtsbesluiten: foren en marktafwijkingen", scope: "district",
    publisher: "District Antwerpen / eBesluit Antwerpen", attribution: Object.freeze({ text: "Bron: eBesluit Antwerpen", url: "https://ebesluit.antwerpen.be/" }),
    url: "https://ebesluit.antwerpen.be/", allowedHosts: Object.freeze(["ebesluit.antwerpen.be"]),
    method: "eBesluit Antwerpen: gepubliceerde districtsbesluiten voor foren en feestdagmarkten", idPrefix: "ebesluit-", shrinkGuard: false, bootstrapOptional: true,
  }),
  // Foren en kermissen in district Antwerpen: één item per periode (lib/asign-foren.mjs).
  "district-foren": Object.freeze({
    sourceId: "district-foren",
    label: "Foren en kermissen",
    scope: "district",
    publisher: "Stad Antwerpen (A-Sign, foorlocaties)",
    attribution: Object.freeze({ text: "Bron: stad Antwerpen, foorlocaties in A-Sign (Vlaamse gratis open data licentie)", url: FOREN_LAYER_URL }),
    url: FOREN_LAYER_URL,
    allowedHosts: Object.freeze(["geodata.antwerpen.be"]),
    method: "A-Sign MapServer/0 (foor): periodetekst per foor in district Antwerpen, één item per periode",
    idPrefix: "foor-",
    bootstrapOptional: true,
  }),
  // Schoolstraten met venstertijden: de straatfiche per schooljaar en de start van een proef (lib/schoolstraten.mjs).
  "district-schoolstraten": Object.freeze({
    sourceId: "district-schoolstraten",
    label: "Schoolstraten",
    scope: "district",
    publisher: "Stad Antwerpen (schoolstraten)",
    attribution: Object.freeze({ text: "Bron: stad Antwerpen, schoolstraten (Vlaamse gratis open data licentie)", url: SCHOOLSTRATEN_LAYER_URL }),
    url: SCHOOLSTRATEN_LAYER_URL,
    allowedHosts: Object.freeze(["geodata.antwerpen.be"]),
    method: "portal_publiek10/MapServer/986: schoolstraten van district Antwerpen met venstertijden, per schooljaar en bij de start van een proef",
    idPrefix: "schoolstraat-",
    bootstrapOptional: true,
  }),
  // Projectpagina's van het district: inspraakmomenten, bevragingen en fasen (lib/district-projecten.mjs).
  "district-projecten": Object.freeze({
    sourceId: "district-projecten",
    label: "Projecten van het district: inspraak en fasen",
    scope: "district",
    publisher: "District Antwerpen",
    attribution: DISTRICT_ATTRIBUTION,
    url: PROJECTS_OVERVIEW_URL,
    allowedHosts: Object.freeze(["www.antwerpen.be"]),
    method: "antwerpen.be projectpagina's van district Antwerpen (portaal-API, contentType 9): inspraakmomenten, bevragingen en fasen",
    idPrefix: "project-",
    bootstrapOptional: true,
  }),
  "stad-uit": Object.freeze({
    sourceId: "stad-uit",
    label: "UiTinVlaanderen (stad Antwerpen)",
    scope: "stad",
    publisher: "UiTinVlaanderen / publiq",
    attribution: Object.freeze({ text: "Bron: UiTinVlaanderen.be", url: "https://www.uitinvlaanderen.be" }),
    url: "https://www.uitinvlaanderen.be/",
    allowedHosts: Object.freeze(["www.uitinvlaanderen.be"]),
    method: "UiTdatabank Search API v3 (alleen met UITDATABANK_CLIENT_ID)",
    idPrefix: "uit-",
    maxItems: 1500,
  }),
  "stad-districten": Object.freeze({
    sourceId: "stad-districten",
    label: "Nieuws van de andere districten",
    scope: "stad",
    publisher: "Districten van stad Antwerpen",
    attribution: Object.freeze({
      text: "Bron: districten van stad Antwerpen – bron stad Antwerpen (Vlaamse gratis open data licentie)",
      url: "https://www.antwerpen.be/",
    }),
    url: "https://www.antwerpen.be/",
    allowedHosts: Object.freeze(["www.antwerpen.be"]),
    method: "antwerpen.be nieuwskanalen van 9 districten (tabel, Wanneer:, Datum:, Praktisch, activiteitentabel, één blok)",
    idPrefix: "stad-news-",
    // Gezond = elk kanaal antwoordde met minstens één artikel. Nul komende activiteiten is hier
    // normaal, dus geen krimpgrens op het aantal items (ook niet in sources:health).
    shrinkGuard: false,
  }),
  "stad-markten": Object.freeze({
    sourceId: "stad-markten",
    label: "Markten (GIPOD)",
    scope: "stad",
    publisher: "Stad Antwerpen via GIPOD (Digitaal Vlaanderen)",
    attribution: Object.freeze({
      text: "Bron: GIPOD, Digitaal Vlaanderen, en marktlijst stad Antwerpen (Modellicentie Gratis Hergebruik v1.0)",
      url: "https://geo.api.vlaanderen.be/GIPOD/ogc/features",
    }),
    url: "https://geo.api.vlaanderen.be/GIPOD/ogc/features",
    allowedHosts: Object.freeze(["www.antwerpen.be", "geo.api.vlaanderen.be"]),
    method: "GIPOD OGC API Features (INNAME_PUNT, markten van stad Antwerpen), eerstvolgende marktdag per markt",
    idPrefix: "markt-",
    maxItems: 1500,
  }),
  "stad-koopzondagen": Object.freeze({
    sourceId: "stad-koopzondagen",
    label: "Koopzondagen",
    scope: "stad",
    publisher: "Stad Antwerpen",
    attribution: Object.freeze({
      text: "Bron: stad Antwerpen, koopzondagen (Vlaamse gratis open data licentie)",
      url: KOOPZONDAGEN_URL,
    }),
    url: KOOPZONDAGEN_URL,
    allowedHosts: Object.freeze(["www.antwerpen.be"]),
    method: "antwerpen.be infopagina koopzondagen (HTML, lijst 'Koopzondagen in <jaar>'), alleen komende koopzondagen",
    idPrefix: "koopzondag-",
  }),
  "mail-district": Object.freeze({
    sourceId: "mail-district",
    label: "Publieke nieuwsbrieven (district)",
    scope: "district",
    publisher: "District Antwerpen (aangekondigd in een publieke nieuwsbrief)",
    attribution: Object.freeze({
      text: "Bron: officiële publieke pagina, opnieuw gecontroleerd na aankondiging in een publieke nieuwsbrief",
      url: "https://www.antwerpen.be/nl/overzicht/district-antwerpen-1",
    }),
    url: "https://www.antwerpen.be/nl/overzicht/district-antwerpen-1",
    allowedHosts: MAIL_ALLOWED_HOSTS,
    method: "Brain Gateway mail-signalen, elk item herverifieerd op de officiële pagina",
    idPrefix: "mail-",
  }),
  "mail-stad": Object.freeze({
    sourceId: "mail-stad",
    label: "Publieke nieuwsbrieven (stad)",
    scope: "stad",
    publisher: "Stad Antwerpen (aangekondigd in een publieke nieuwsbrief)",
    attribution: Object.freeze({
      text: "Bron: officiële publieke pagina, opnieuw gecontroleerd na aankondiging in een publieke nieuwsbrief",
      url: "https://www.antwerpen.be/",
    }),
    url: "https://www.antwerpen.be/",
    allowedHosts: MAIL_ALLOWED_HOSTS,
    method: "Brain Gateway mail-signalen, elk item herverifieerd op de officiële pagina",
    idPrefix: "mail-",
  }),
});

export const SOURCE_IDS = Object.freeze(Object.keys(SOURCE_DEFINITIONS).sort());

export function sourceFileName(sourceId) {
  return `sources/${sourceId}.json`;
}

// false voor een bron waar een lege uitkomst normaal is (stad-districten): geen suspicious_drop.
export function shrinkGuardFor(sourceId) {
  return SOURCE_DEFINITIONS[sourceId]?.shrinkGuard !== false;
}

export function maxItemsFor(sourceId) {
  return SOURCE_DEFINITIONS[sourceId]?.maxItems ?? DEFAULT_MAX_ITEMS;
}

// Leeg brondocument in de vaste sleutelvolgorde van het contract (C4). `coverage` staat er alleen in
// als een bron afkapt: { until, candidateCount, capped }.
export function sourceDocument(sourceId, { retrievedAt = null, fetchStatus, contentVersion = null, coverage = null, items = [], suppressions = [] }) {
  const definition = SOURCE_DEFINITIONS[sourceId];
  if (!definition) throw new Error(`Onbekende bron: ${sourceId}`);
  const document = {
    schemaVersion: 1,
    sourceId,
    scope: definition.scope,
    publisher: definition.publisher,
    attribution: { text: definition.attribution.text, url: definition.attribution.url },
    url: definition.url,
    allowedHosts: [...definition.allowedHosts],
    officialPublic: true,
    method: definition.method,
    retrievedAt,
    fetchStatus,
    maxAgeHours: MAX_AGE_HOURS,
    contentVersion,
  };
  if (coverage) document.coverage = { until: coverage.until ?? null, candidateCount: coverage.candidateCount, capped: coverage.capped === true };
  document.items = sortSourceItems(items.map(normalizeSourceItem));
  if (sourceId === "district-ebesluit" || suppressions.length) document.suppressions = [...suppressions].map(entry => ({ targetSourceId: String(entry.targetSourceId || ""), date: String(entry.date || ""), location: String(entry.location || "").replace(/\s+/g, " ").trim(), sourceUrl: String(entry.sourceUrl || ""), decisionCode: String(entry.decisionCode || "") })).sort((a,b)=>a.date.localeCompare(b.date)||a.location.localeCompare(b.location,"nl")||a.decisionCode.localeCompare(b.decisionCode));
  return document;
}

const ITEM_KEYS = [
  "id",
  "externalId",
  "title",
  "theme",
  "className",
  "date",
  "endDate",
  "timeSlot",
  "timeText",
  "location",
  "postcodes",
  "info",
  "infoUrl",
  "actionAttempted",
  "actionChecked",
  "actionKind",
  "actionCode",
  "kind",
  "sourceUrl",
  "retrievedAt",
  "reviewRequired",
  "inDistrict",
  "noEventPage",
  // Optioneel, voor een evenement op straat (district-asign-evenementen): de fasen van het dossier
  // (opbouw, evenement, afbraak), de straten, en de ids van agendapunten van een andere bron die over
  // hetzelfde gaan (lib/merge-events.mjs maakt er één item van; sameAs gaat niet mee naar de site).
  "fasen",
  "straten",
  "sameAs",
];
const OPTIONAL_ITEM_KEYS = ["infoUrl", "actionAttempted", "actionChecked", "actionKind", "actionCode", "inDistrict", "noEventPage", "fasen", "straten", "sameAs"];
const REQUIRED_ITEM_KEYS = ITEM_KEYS.filter((key) => !OPTIONAL_ITEM_KEYS.includes(key));
const LIST_ITEM_KEYS = ["fasen", "straten", "sameAs"];
export const MAX_ITEM_FASEN = 6;
export const MAX_ITEM_STRATEN = 80;
export const MAX_ITEM_SAME_AS = 10;

export function normalizeSourceItem(item) {
  const result = {};
  for (const key of ITEM_KEYS) {
    if (item[key] === undefined) continue;
    if ((key === "infoUrl" && !item[key]) || (key === "noEventPage" && item[key] !== true)) continue;
    // Een lege lijst zegt niets: weglaten houdt de feed klein.
    if (LIST_ITEM_KEYS.includes(key) && Array.isArray(item[key]) && !item[key].length) continue;
    result[key] = key === "postcodes" ? [...new Set(item[key])].sort() : item[key];
  }
  return result;
}

export function compareSourceItems(a, b) {
  return a.date.localeCompare(b.date) || String(a.timeSlot).localeCompare(String(b.timeSlot)) || a.id.localeCompare(b.id);
}

export function sortSourceItems(items) {
  return [...items].sort(compareSourceItems);
}

export function hostAllowed(url, allowedHosts) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && allowedHosts.includes(parsed.hostname) && !parsed.search && !parsed.hash && !parsed.username;
  } catch {
    return false;
  }
}

export function isIsoInstant(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

// ---------- privacyscan ----------

export const FORBIDDEN_KEYS = Object.freeze([
  "creator",
  "contributors",
  "contactPoint",
  "bookingInfo",
  "organizer",
  "images",
  "mediaObject",
  "assignee",
  "lockOwner",
]);
const FORBIDDEN_KEY_PATTERN = new RegExp(`^(?:${FORBIDDEN_KEYS.join("|")})$`, "i");
// Met grenzen, zodat een UUID of id met "0032" erin geen vals alarm geeft.
const PHONE_PATTERNS = [
  /(?<![0-9A-Za-z-])(?:\+32|0032)\s?\d/,
  /(?<![0-9A-Za-z-])0\d{2,3}[ ./]\d{2}[ ./]\d{2}[ ./]\d{2}(?![0-9])/,
  // Ook het Antwerpse vaste-lijnformaat "03 123 45 67".
  /(?<![0-9A-Za-z-])0\d[ ./]\d{3}[ ./]\d{2}[ ./]\d{2}(?![0-9])/,
];
const IBAN_PATTERN = /\bBE\d{2}\s?\d{4}/;
const TRACKING_PATTERN = /nieuwsbrief\.antwerpen\.be\/t\/|createsend|cmail|\/t\/j-/i;

// Geeft een lijst van privacyproblemen terug; leeg betekent in orde. Alleen paden, nooit de waarde.
export function privacyFindings(value, path = "$") {
  const findings = [];
  const visit = (node, at) => {
    if (typeof node === "string") {
      if (node.includes("@")) findings.push({ code: "at_sign", path: at });
      if (PHONE_PATTERNS.some((pattern) => pattern.test(node))) findings.push({ code: "phone_number", path: at });
      if (IBAN_PATTERN.test(node)) findings.push({ code: "iban", path: at });
      if (/^https?:\/\//i.test(node) && (node.includes("?") || node.includes("#"))) findings.push({ code: "url_query", path: at });
      if (TRACKING_PATTERN.test(node)) findings.push({ code: "tracking_link", path: at });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((child, index) => visit(child, `${at}[${index}]`));
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        if (FORBIDDEN_KEY_PATTERN.test(key)) findings.push({ code: "forbidden_key", path: `${at}.${key}` });
        visit(child, `${at}.${key}`);
      }
    }
  };
  visit(value, path);
  return findings;
}

// ---------- validatie ----------

const ITEM_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const THEMES = new Map([
  ["Activiteit", "activity"],
  ["Sport", "sport"],
  ["Oproep/deadline", "call"],
  // Werken en verkeersmaatregelen (fasen van een heraanleg, een schoolstraat), zoals de handmatige werken.
  ["Werken", "works"],
]);

function validateItem(item, index, definition, errors) {
  const at = `items[${index}]`;
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    errors.push(`${at}: geen object`);
    return;
  }
  for (const key of Object.keys(item)) if (!ITEM_KEYS.includes(key)) errors.push(`${at}: onbekende sleutel ${key}`);
  for (const key of REQUIRED_ITEM_KEYS) if (!(key in item)) errors.push(`${at}: ${key} ontbreekt`);
  if (typeof item.id !== "string" || !ITEM_ID.test(item.id) || item.id.length > 120 || !item.id.startsWith(definition.idPrefix)) {
    errors.push(`${at}: ongeldige id`);
  }
  if (typeof item.externalId !== "string" || !item.externalId || item.externalId.length > 80) errors.push(`${at}: ongeldige externalId`);
  if (typeof item.title !== "string" || !item.title.trim() || item.title.length > 200) errors.push(`${at}: ongeldige titel`);
  if (!THEMES.has(item.theme) || THEMES.get(item.theme) !== item.className) errors.push(`${at}: ongeldig thema of className`);
  if (!isValidIsoDate(item.date)) errors.push(`${at}: ongeldige datum`);
  if (item.endDate !== null && (!isValidIsoDate(item.endDate) || item.endDate < item.date)) errors.push(`${at}: ongeldige endDate`);
  if (typeof item.timeSlot !== "string" || !/^(?:(?:[01]\d|2[0-3]):[0-5]\d|Info)$/.test(item.timeSlot)) errors.push(`${at}: ongeldig timeSlot`);
  if (typeof item.timeText !== "string" || item.timeText.length > 200) errors.push(`${at}: ongeldige timeText`);
  if (typeof item.location !== "string" || !item.location.trim() || item.location.length > 300) errors.push(`${at}: ongeldige locatie`);
  if (!Array.isArray(item.postcodes) || !item.postcodes.every((postcode) => /^\d{4}$/.test(postcode))) errors.push(`${at}: ongeldige postcodes`);
  if (typeof item.info !== "string" || item.info.length > 600) errors.push(`${at}: ongeldige info`);
  if ("infoUrl" in item && safeHttpsUrl(item.infoUrl) !== item.infoUrl) errors.push(`${at}: ongeldige infoUrl`);
  if ("actionAttempted" in item && item.actionAttempted !== true) errors.push(`${at}: actionAttempted ongeldig`);
  if ("actionChecked" in item && item.actionChecked !== true) errors.push(`${at}: actionChecked ongeldig`);
  if ("actionKind" in item && (!["ticket","email_district","onsite","no_ticket"].includes(item.actionKind) || item.actionChecked !== true)) errors.push(`${at}: actionKind ongeldig`);
  if ("actionCode" in item && (item.actionKind !== "ticket" || item.actionCode !== "CID-STA-" + String(item.date).replaceAll("-", ""))) errors.push(`${at}: actionCode ongeldig`);
  if (item.actionKind==="ticket" && !item.actionCode) errors.push(`${at}: ticket zonder actionCode`);
  if (!["activity", "deadline"].includes(item.kind)) errors.push(`${at}: ongeldige kind`);
  if (!hostAllowed(item.sourceUrl, definition.allowedHosts)) errors.push(`${at}: sourceUrl niet https of niet op een toegelaten host`);
  if (!isIsoInstant(item.retrievedAt)) errors.push(`${at}: retrievedAt ontbreekt of is ongeldig`);
  if (item.reviewRequired !== false) errors.push(`${at}: alleen items zonder review mogen weggeschreven worden`);
  if ("inDistrict" in item && typeof item.inDistrict !== "boolean") errors.push(`${at}: inDistrict moet boolean zijn`);
  if ("noEventPage" in item && item.noEventPage !== true) errors.push(`${at}: noEventPage mag alleen true zijn`);
  if ("fasen" in item) {
    const fasen = item.fasen;
    if (!Array.isArray(fasen) || fasen.length > MAX_ITEM_FASEN || !fasen.every((fase) => fase && typeof fase === "object" && !Array.isArray(fase)
      && Object.keys(fase).every((key) => ["naam", "start", "eind"].includes(key))
      && typeof fase.naam === "string" && fase.naam.trim() && fase.naam.length <= 40
      && isValidIsoDate(fase.start) && isValidIsoDate(fase.eind) && fase.eind >= fase.start)) errors.push(`${at}: ongeldige fasen`);
  }
  if ("straten" in item && (!Array.isArray(item.straten) || item.straten.length > MAX_ITEM_STRATEN || !item.straten.every((straat) => typeof straat === "string" && straat.trim() && straat.length <= 120))) {
    errors.push(`${at}: ongeldige straten`);
  }
  if ("sameAs" in item && (!Array.isArray(item.sameAs) || item.sameAs.length > MAX_ITEM_SAME_AS || !item.sameAs.every((id) => typeof id === "string" && ITEM_ID.test(id) && id.length <= 120 && id !== item.id))) {
    errors.push(`${at}: ongeldige sameAs`);
  }
}

export function validateSourceDocument(document, { expectedSourceId = null } = {}) {
  const errors = [];
  if (!document || typeof document !== "object" || Array.isArray(document)) return ["document is geen object"];
  const definition = SOURCE_DEFINITIONS[document.sourceId];
  if (!definition) return [`onbekende sourceId ${String(document.sourceId)}`];
  if (expectedSourceId && document.sourceId !== expectedSourceId) errors.push("sourceId komt niet overeen met de bestandsnaam");
  const expectedKeys = ["schemaVersion", "sourceId", "scope", "publisher", "attribution", "url", "allowedHosts", "officialPublic", "method", "retrievedAt", "fetchStatus", "maxAgeHours", "contentVersion", "coverage", "items", "suppressions"];
  for (const key of Object.keys(document)) if (!expectedKeys.includes(key)) errors.push(`onbekende sleutel ${key}`);
  if (document.schemaVersion !== 1) errors.push("schemaVersion moet 1 zijn");
  if (document.scope !== definition.scope) errors.push("scope wijkt af van de brondefinitie");
  if (document.publisher !== definition.publisher) errors.push("publisher wijkt af van de brondefinitie");
  if (document.attribution?.text !== definition.attribution.text || document.attribution?.url !== definition.attribution.url) {
    errors.push("attributie wijkt af van de brondefinitie");
  }
  if (document.url !== definition.url || !hostAllowed(document.url, definition.allowedHosts)) errors.push("bron-URL wijkt af of is niet https");
  if (JSON.stringify(document.allowedHosts) !== JSON.stringify([...definition.allowedHosts])) errors.push("allowedHosts wijkt af van de brondefinitie");
  if (document.officialPublic !== true) errors.push("officialPublic moet true zijn");
  if (document.method !== definition.method) errors.push("method wijkt af van de brondefinitie");
  if (!FETCH_STATUSES.includes(document.fetchStatus) || document.fetchStatus === "test_only") errors.push("ongeldige fetchStatus");
  if (document.maxAgeHours !== MAX_AGE_HOURS) errors.push(`maxAgeHours moet ${MAX_AGE_HOURS} zijn`);
  if (document.contentVersion !== null && (typeof document.contentVersion !== "string" || document.contentVersion.length > 200)) {
    errors.push("ongeldige contentVersion");
  }
  if (!Array.isArray(document.items)) {
    errors.push("items is geen array");
    return errors;
  }
  if (document.items.length > maxItemsFor(document.sourceId)) errors.push("te veel items");
  if ("suppressions" in document) { if (document.sourceId !== "district-ebesluit") errors.push("suppressions alleen toegelaten voor district-ebesluit"); if (!Array.isArray(document.suppressions) || document.suppressions.length > 200) errors.push("ongeldige suppressions"); else { const seen = new Set(); document.suppressions.forEach((entry,index)=>{ const at = `suppressions[${index}]`; if (entry.targetSourceId !== "stad-markten") errors.push(`${at}: targetSourceId ongeldig`); if (!isValidIsoDate(entry.date)) errors.push(`${at}: datum ongeldig`); if (typeof entry.location !== "string" || !entry.location.trim()) errors.push(`${at}: locatie ongeldig`); if (!hostAllowed(entry.sourceUrl, definition.allowedHosts)) errors.push(`${at}: sourceUrl ongeldig`); if (typeof entry.decisionCode !== "string" || !/^20\d\d_[A-Z]{2,8}_\d+$/.test(entry.decisionCode)) errors.push(`${at}: decisionCode ongeldig`); const key=[entry.targetSourceId,entry.date,String(entry.location).toLowerCase()].join("|"); if(seen.has(key)) errors.push(`${at}: dubbele suppressie`); seen.add(key); }); } }
  if ("coverage" in document) {
    const coverage = document.coverage;
    const keys = coverage && typeof coverage === "object" && !Array.isArray(coverage) ? Object.keys(coverage) : null;
    if (!keys || keys.some((key) => !["until", "candidateCount", "capped"].includes(key))) errors.push("ongeldige coverage");
    else {
      if (coverage.until !== null && !isValidIsoDate(coverage.until)) errors.push("ongeldige coverage.until");
      if (typeof coverage.capped !== "boolean") errors.push("ongeldige coverage.capped");
      if (!Number.isInteger(coverage.candidateCount) || coverage.candidateCount < document.items.length) errors.push("ongeldige coverage.candidateCount");
      if (coverage.capped === false && coverage.candidateCount !== document.items.length) errors.push("coverage zegt niet afgekapt, maar telt meer kandidaten dan items");
      if (coverage.capped === true && coverage.candidateCount === document.items.length) errors.push("coverage zegt afgekapt, maar er ontbreekt niets");
      if (coverage.until !== null && document.items.some((item) => item?.date > coverage.until)) errors.push("item na coverage.until");
    }
  }
  if (document.retrievedAt === null) {
    if (document.items.length) errors.push("retrievedAt ontbreekt terwijl er items zijn");
  } else if (!isIsoInstant(document.retrievedAt)) {
    errors.push("ongeldige retrievedAt");
  }
  const ids = new Set();
  document.items.forEach((item, index) => {
    validateItem(item, index, definition, errors);
    if (ids.has(item?.id)) errors.push(`items[${index}]: dubbele id`);
    ids.add(item?.id);
    if (index > 0 && item?.date && document.items[index - 1]?.date && compareSourceItems(document.items[index - 1], item) > 0) {
      errors.push(`items[${index}]: niet gesorteerd op datum, uur en id`);
    }
  });
  for (const finding of privacyFindings(document)) errors.push(`privacy: ${finding.code} op ${finding.path}`);
  return errors;
}

// "leeg" in refresh-status.json (scripts/stale-policy.mjs): upcomingCount is wat vandaag nog loopt of
// komt, emptySince de eerste dag van de huidige reeks dagen zonder komend item. Optioneel, zodat een
// status van vóór deze velden geldig blijft.
export const CONTENT_STATUSES = Object.freeze(["ok", "leeg"]);

function contentStatusErrors(entry, asOf) {
  const errors = [];
  if ("upcomingCount" in entry && (!Number.isInteger(entry.upcomingCount) || entry.upcomingCount < 0)) errors.push("ongeldige upcomingCount");
  if ("emptySince" in entry && entry.emptySince !== null) {
    if (!isValidIsoDate(entry.emptySince)) errors.push("ongeldige emptySince");
    else if (isValidIsoDate(asOf) && entry.emptySince > asOf) errors.push("emptySince ligt na classificationAsOf");
    if (entry.upcomingCount > 0) errors.push("emptySince terwijl er komende items zijn");
  }
  if ("contentStatus" in entry) {
    if (!CONTENT_STATUSES.includes(entry.contentStatus)) errors.push("ongeldige contentStatus");
    else if (entry.contentStatus === "leeg" && !isValidIsoDate(entry.emptySince)) errors.push("contentStatus leeg zonder emptySince");
  }
  return errors;
}

export function validateRefreshStatus(status) {
  const errors = [];
  if (!status || typeof status !== "object") return ["refresh-status is geen object"];
  for (const key of Object.keys(status)) if (!["schemaVersion", "generatedAt", "classificationAsOf", "sources"].includes(key)) errors.push(`onbekende sleutel ${key}`);
  if (status.schemaVersion !== 1) errors.push("schemaVersion moet 1 zijn");
  if (!isIsoInstant(status.generatedAt)) errors.push("ongeldige generatedAt");
  if (!isValidIsoDate(status.classificationAsOf)) errors.push("ongeldige classificationAsOf");
  if (!Array.isArray(status.sources)) return [...errors, "sources is geen array"];
  const seen = [];
  status.sources.forEach((entry, index) => {
    const at = `sources[${index}]`;
    const definition = SOURCE_DEFINITIONS[entry?.sourceId];
    if (!definition) {
      errors.push(`${at}: onbekende sourceId`);
      return;
    }
    const keys = ["sourceId", "file", "scope", "fetchStatus", "retrievedAt", "maxAgeHours", "itemCount", "errorCode", "capped", "coverageUntil", "upcomingCount", "emptySince", "contentStatus"];
    for (const key of Object.keys(entry)) if (!keys.includes(key)) errors.push(`${at}: onbekende sleutel ${key}`);
    if (entry.file !== sourceFileName(entry.sourceId)) errors.push(`${at}: ongeldig file`);
    if (entry.scope !== definition.scope) errors.push(`${at}: ongeldige scope`);
    if (!FETCH_STATUSES.includes(entry.fetchStatus)) errors.push(`${at}: ongeldige fetchStatus`);
    if (entry.retrievedAt !== null && !isIsoInstant(entry.retrievedAt)) errors.push(`${at}: ongeldige retrievedAt`);
    if (entry.maxAgeHours !== MAX_AGE_HOURS) errors.push(`${at}: ongeldige maxAgeHours`);
    if (!Number.isInteger(entry.itemCount) || entry.itemCount < 0) errors.push(`${at}: ongeldige itemCount`);
    if (entry.errorCode !== null && (typeof entry.errorCode !== "string" || !/^[a-z0-9_]{1,60}$/.test(entry.errorCode))) {
      errors.push(`${at}: ongeldige errorCode`);
    }
    if ("capped" in entry && typeof entry.capped !== "boolean") errors.push(`${at}: ongeldige capped`);
    if ("coverageUntil" in entry && entry.coverageUntil !== null && !isValidIsoDate(entry.coverageUntil)) errors.push(`${at}: ongeldige coverageUntil`);
    for (const error of contentStatusErrors(entry, status.classificationAsOf)) errors.push(`${at}: ${error}`);
    seen.push(entry.sourceId);
  });
  if (JSON.stringify(seen) !== JSON.stringify([...seen].sort())) errors.push("sources niet gesorteerd op sourceId");
  if (new Set(seen).size !== seen.length) errors.push("dubbele sourceId in refresh-status");
  for (const finding of privacyFindings(status)) errors.push(`privacy: ${finding.code} op ${finding.path}`);
  return errors;
}
