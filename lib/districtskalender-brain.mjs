// De districtskalender zoals de eigenaar ze op zijn tik in zijn eigen browser liet lezen, via de Brain Gateway
// (contract C6, sinds 25-11-2026). Puur: geen klok, geen netwerk.
//
// Waarom. Sinds 23-10-2026 weigert www.antwerpen.be elke automatische lezer, ook de publieke portaal-API van de
// districtskalender (scripts/fetch-sources-district.mjs, bron_weigert_automatisch). Er wordt niets omzeild. Wat
// wel kan: de eigenaar opent de pagina zelf, met één tik in zijn eigen browser; Brain leest wat hij dan ziet, zoekt
// de plaats op de eigen sites van de ontmoetingscentra van het district of in de persberichten van het district,
// en zet alleen wat zeker is (een exact adres met huisnummer in het district, niet voorbij, niet volzet) in een
// klein JSON-bestand op de Gateway. Deze bron leest dat bestand alleen als de kalender zelf weigert.
//
// Wat erin staat (en niets meer): titel, begin, einde, de plaats met straat, huisnummer en postcode, waar die
// plaats vandaan kwam, de officiële pagina (alleen op een site van een ontmoetingscentrum van het district of de
// persruimte van het district), of er ingeschreven moet worden, en de dag van zijn tik. Geen beschrijving, geen
// persoon, geen mailadres. Een levering die hier niet door komt, wordt in haar geheel geweigerd.
//
// Hersteld nagekeken: elk item met een officiële pagina wordt op die pagina zelf opnieuw nagekeken (titel, dag en
// adres; scripts/fetch-sources-district.mjs). Een item zonder pagina kreeg zijn adres van de kalender zelf, zoals
// de eigenaar ze in zijn browser zag; die pagina kan deze verversing niet lezen.
import { normalized } from "./event-contract.mjs";
import { decodeEntities, isValidIsoDate } from "./html-text.mjs";

export const DEFAULT_DISTRICTSKALENDER_URL = "https://project-brain-gateway.onrender.com/v1/publiek/publieke-agenda/districtskalender.json";
export const DISTRICTSKALENDER_PAGINA_HOSTS = Object.freeze([
  "bloc2030.antwerpen.be",
  "oudebadhuis.antwerpen.be",
  "nova.antwerpen.be",
  "pers.districtantwerpen.be",
]);
export const DISTRICT_POSTCODES = Object.freeze(["2000", "2018", "2020", "2030", "2050", "2060"]);
export const MAX_KALENDER_ITEMS = 200;
export const MAX_KALENDER_BYTES = 64 * 1024;
const CALENDAR_URL = "https://www.antwerpen.be/info/5efb0477b118f7b19c627b69/wat-beleef-je-in-district-antwerpen";
const TOP_KEYS = ["schema_version", "generated_on", "items"];
const ITEM_KEYS = ["id", "title", "start", "end", "all_day", "place", "postcode", "place_from", "page", "calendar", "registration", "read_on"];
const DATE_OR_DATETIME = /^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d)?$/;
const PLACE_FROM = Object.freeze(["kalender", "ontmoetingscentrum", "persbericht"]);
const PHONE = [/(?:\+|\b00)\s?\d{2}[\s./-]?\(?\d{1,4}\)?(?:[\s./-]?\d{2,4}){2,4}\b/, /\b0\d{1,3}(?:[\s./-]\d{2,3}){2,3}\b/, /\b0\d{8,9}\b/];

// Een officiële pagina: https op een van de vaste hosts, zonder query, fragment, poort of gebruikersgegevens.
export function isKalenderPagina(value) {
  let url;
  try { url = new URL(String(value ?? "")); } catch { return false; }
  return url.protocol === "https:" && DISTRICTSKALENDER_PAGINA_HOSTS.includes(url.hostname) && !url.search && !url.hash
    && !String(value).includes("?") && !String(value).includes("#") && !url.username && !url.password && !url.port;
}

const validDateTime = (value) => typeof value === "string" && DATE_OR_DATETIME.test(value) && isValidIsoDate(value.slice(0, 10));

// Strikte validatie van één levering. Geeft { ok, errors } met korte foutcodes per item, nooit de waarde zelf.
export function validateDistrictskalenderFeed(payload, { byteLength = 0 } = {}) {
  const errors = [];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, errors: ["geen object"] };
  if (byteLength > MAX_KALENDER_BYTES) errors.push("groter dan 64 KB");
  for (const key of Object.keys(payload)) if (!TOP_KEYS.includes(key)) errors.push(`onbekende sleutel ${key}`);
  if (payload.schema_version !== 1) errors.push("schema_version");
  if (typeof payload.generated_on !== "string" || !isValidIsoDate(payload.generated_on)) errors.push("generated_on");
  if (!Array.isArray(payload.items) || payload.items.length > MAX_KALENDER_ITEMS) return { ok: false, errors: [...errors, "items"] };
  const ids = new Set();
  payload.items.forEach((item, index) => {
    const at = `items[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) { errors.push(`${at}: geen object`); return; }
    for (const key of Object.keys(item)) if (!ITEM_KEYS.includes(key)) errors.push(`${at}: onbekende sleutel`);
    for (const key of ITEM_KEYS) if (!(key in item)) errors.push(`${at}: ${key} ontbreekt`);
    if (typeof item.id !== "string" || !/^[a-f0-9]{64}$/.test(item.id) || ids.has(item.id)) errors.push(`${at}: id`);
    ids.add(item.id);
    if (typeof item.title !== "string" || !item.title.trim() || item.title.length > 160) errors.push(`${at}: title`);
    if (!validDateTime(item.start)) errors.push(`${at}: start`);
    if (item.end !== null && (!validDateTime(item.end) || String(item.end).slice(0, 10) < String(item.start).slice(0, 10))) errors.push(`${at}: end`);
    if (typeof item.all_day !== "boolean" || item.all_day !== (String(item.start).length === 10)) errors.push(`${at}: all_day`);
    if (!DISTRICT_POSTCODES.includes(item.postcode)) errors.push(`${at}: postcode`);
    if (typeof item.place !== "string" || item.place.length < 8 || item.place.length > 300
      || !new RegExp(`\\b${item.postcode}\\b`).test(item.place) || !/\p{L}{3,}\.?\s\d{1,4}/u.test(item.place)) errors.push(`${at}: place`);
    if (!PLACE_FROM.includes(item.place_from)) errors.push(`${at}: place_from`);
    if (item.page !== null && !isKalenderPagina(item.page)) errors.push(`${at}: page`);
    if (item.place_from !== "kalender" && item.page === null) errors.push(`${at}: page ontbreekt`);
    if (item.calendar !== CALENDAR_URL) errors.push(`${at}: calendar`);
    if (typeof item.registration !== "boolean") errors.push(`${at}: registration`);
    if (typeof item.read_on !== "string" || !isValidIsoDate(item.read_on)) errors.push(`${at}: read_on`);
    for (const text of [item.title, item.place]) {
      if (typeof text !== "string") continue;
      if (text.includes("@") || PHONE.some((pattern) => pattern.test(text))) errors.push(`${at}: persoonsgegeven`);
    }
  });
  return { ok: errors.length === 0, errors };
}

function hourLabel(time) {
  const [hours, minutes] = time.split(":");
  return minutes === "00" ? String(Number(hours)) : `${Number(hours)}.${minutes}`;
}

// Het item zoals de agenda het kent, voor de bron district-kalender.
export function itemFromKalender(item, { retrievedAt }) {
  const date = item.start.slice(0, 10);
  const startTime = item.start.length > 10 ? item.start.slice(11, 16) : null;
  const endDatePart = item.end ? item.end.slice(0, 10) : null;
  const endDate = endDatePart && endDatePart > date ? endDatePart : null;
  const endTime = startTime && item.end && item.end.length > 10 && !endDate && item.end.slice(11, 16) > startTime ? item.end.slice(11, 16) : null;
  const externalId = item.id.slice(0, 24);
  return {
    id: `district-kal-${externalId}-${date}`,
    externalId,
    title: item.title.trim(),
    theme: "Activiteit",
    className: "activity",
    date,
    endDate,
    timeSlot: startTime ?? "Info",
    timeText: startTime ? (endTime ? `${hourLabel(startTime)} tot ${hourLabel(endTime)} uur` : `${hourLabel(startTime)} uur`) : "",
    location: item.place.trim(),
    postcodes: [item.postcode],
    info: item.registration ? "Inschrijven of een ticket is nodig: zie de officiële pagina." : "",
    ...(item.page ? { infoUrl: item.page } : {}),
    kind: "activity",
    sourceUrl: CALENDAR_URL,
    retrievedAt,
    reviewRequired: false,
  };
}

function containsPhrase(text, needle) {
  if (!needle) return false;
  return new RegExp(`(?<![a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`).test(text);
}

// De titel staat als geheel op de pagina van de activiteit (die pagina gaat over één activiteit, dus ook een korte
// titel als "Wintermarkt" telt), en het adres ook: straat met huisnummer, en de postcode met de gemeente.
export function titelOpPagina(title, text) {
  return containsPhrase(text, normalized(decodeEntities(title ?? "")));
}

export function adresOpPagina(place, text) {
  const delen = normalized(decodeEntities(place ?? "")).split(",").map((deel) => deel.trim()).filter(Boolean);
  const straat = delen.find((deel) => /\s\d{1,4}[a-z]?(?:\s?[-/]\s?\d{1,4}[a-z]?)?$/.test(deel));
  const postcode = delen.find((deel) => /^\d{4}\s/.test(deel));
  return Boolean(straat && postcode && containsPhrase(text, straat) && containsPhrase(text, postcode));
}
