// Leest de koopzondagen van stad Antwerpen van de publieke infopagina
// https://www.antwerpen.be/info/koopzondagen (open data van de stad, met bronvermelding).
//
// Waarom de HTML en niet de portaal-API (page-content-by-uuid, zoals de districtskalender)?
// Deze pagina hoort bij de nieuwe infopagina's van antwerpen.be: ze heeft geen portaal-id van 24
// hextekens, alleen rubriek-uuid's van een ander CMS. Een API-adres raden kost verzoeken en levert
// niets zekers op; de gerenderde HTML is wat de stad zelf publiceert, en de lijst staat erin als een
// gewone <ul>. Gelezen wordt dus alleen:
//
//   <p><strong>Koopzondagen in 2026:</strong></p>
//   <ul><li>4 januari 2026: wintersolden</li><li>1 februari 2026</li> …</ul>
//
// Heel conservatief, zoals de andere parsers: een regel telt alleen als hij volledig
// "<dag> <maand> <jaar>" is, optioneel met ": <korte context>" (Pasen, zomersolden …); het jaar moet
// dat van de kop zijn en de dag moet een zondag zijn. Alles anders wordt geteld als probleem en niet
// gepubliceerd. Scripts (de Next.js-payload herhaalt de lijst ge-escapet) worden eerst weggeknipt, en
// het contactblok onderaan de pagina (namen, telefoon, e-mail) wordt nooit gelezen: de parser kijkt
// alleen naar de <ul> direct na de kop "Koopzondagen in <jaar>".
//
// Puur: geen klok (vandaag wordt meegegeven), geen netwerk.
import { MONTH_NAMES_NL, cleanText, isValidIsoDate, stripEmails, stripTags, weekdayOfIso } from "./html-text.mjs";

export const KOOPZONDAGEN_URL = "https://www.antwerpen.be/info/koopzondagen";
export const ID_PREFIX = "koopzondag-";
export const TITLE = "Koopzondag";
// De pagina spreekt van "het toeristische stadscentrum van Antwerpen" (erkend als toeristisch
// centrum). Die zone ligt volledig binnen district Antwerpen (begrensd door de kaaien, de Leien,
// Kattendijkdok en Namenstraat): de kaaien, het centrum en het Eilandje vallen onder 2000, de
// Pelikaanstraat, Quellinstraat en Britselei onder 2018. Daarom postcodes 2000 en 2018 en
// inDistrict: true. Waarom niet gewoon geen postcodes? lib/merge-events.mjs voegt items met dezelfde
// titel en datum samen tenzij hun postcodes verschillen, en een lege lijst botst nooit. Zonder
// postcodes zou een "Koopzondag" van een ander district (Deurne, 2100) of een UiT-item in Wilrijk
// opgaan in deze koopzondag, of er als hoofditem van stad-districten zelfs inDistrict: true van
// krijgen. De prijs: een UiT-item "Koopzondag" met alleen 2000 wordt niet samengevoegd en staat er
// apart naast; een dubbel item is beter dan een verkeerd district. De groep blijft "stad": het is
// een stadsinitiatief.
export const LOCATION = "Toeristisch centrum Antwerpen";
export const POSTCODES = Object.freeze(["2000", "2018"]);
// Neutraal en voor elke datum waar: de lijst mengt de promotiezondagen (eerste zondag van de maand)
// met de decemberzondagen, en de pagina kondigt nieuwe regelgeving aan. Juridische uitleg over wie
// wanneer open mag, hoort op de officiële pagina en niet herhaald op elke eventpagina. De bron noemt
// geen uren (uur "Info"), dus zeggen we dat ook.
export const INFO =
  "Koopzondag in het toeristische stadscentrum volgens de lijst van stad Antwerpen. Openingsuren verschillen per winkel.";
// Een kop met een lijst per jaar; er kunnen er twee zijn (bijvoorbeeld 2026 en 2027 rond de jaarwissel).
// Tussen jaar en lijst verdraagt de kop spaties, een letterlijke of ge-escapete harde spatie (&nbsp;, zoals
// de Next.js-payload hem schrijft) en een dubbelpunt vóór of na </strong>: een kleine opmaakwijziging mag
// geen onnodige no_list-storing geven.
const HEADING_GAP = String.raw`(?:\s|&nbsp;|&#160;|&#xa0;)*`;
const HEADING_LIST = new RegExp(
  String.raw`Koopzondagen\s+in\s+(20\d{2})${HEADING_GAP}:?${HEADING_GAP}(?:<\/strong>${HEADING_GAP}:?${HEADING_GAP})?(?:<\/p>\s*)?<ul\b[^>]*>([\s\S]*?)<\/ul>`,
  "gi"
);
const ANY_HEADING = /Koopzondagen\s+in\s+20\d{2}/i;
const MONTHS = new Map(MONTH_NAMES_NL.map((name, index) => [name, index + 1]));
// Hele regel: dag, maandnaam, jaar, optioneel ": context". Context is kort en bevat alleen letters,
// spaties, koppeltekens en apostrofs; cijfers of een uur maken de regel dubbelzinnig.
const LINE = new RegExp(`^(\\d{1,2})\\s+(${MONTH_NAMES_NL.join("|")})\\s+(20\\d{2})(?:\\s*:\\s*([\\p{L}][\\p{L} '’-]{0,58}))?$`, "iu");

const pad = (value) => String(value).padStart(2, "0");

// Knipt scripts, styles en commentaar weg: de Next.js-payload in <script> bevat dezelfde lijst
// ge-escapet en mag nooit een tweede keer meetellen.
function visibleHtml(html) {
  return String(html ?? "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

function listLines(listHtml) {
  return [...String(listHtml).matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((match) => stripEmails(stripTags(match[1])));
}

// Eén regel naar { date, context } of { issue }.
export function parseKoopzondagLine(text, headingYear) {
  const line = cleanText(text).replace(/[.;]+$/, "");
  const match = LINE.exec(line);
  if (!match) return { issue: "unreadable_line" };
  const [, day, monthName, year, context] = match;
  const date = `${year}-${pad(MONTHS.get(monthName.toLowerCase()))}-${pad(day)}`;
  if (!isValidIsoDate(date)) return { issue: "invalid_date" };
  if (Number(year) !== headingYear) return { issue: "year_mismatch" };
  if (weekdayOfIso(date) !== 0) return { issue: "not_sunday" };
  return { date, context: context ? cleanText(context) : "" };
}

export function koopzondagTitle(context) {
  return context ? `${TITLE} (${context})` : TITLE;
}

// Geeft { items, lists, lines, issues, dropped } terug. `items` zijn alleen komende koopzondagen
// (datum ≥ today), zonder retrievedAt (dat zet de fetcher). `lists` = aantal gevonden jaarlijsten.
export function parseKoopzondagenHtml(html, { today }) {
  const visible = visibleHtml(html);
  const issues = [];
  const items = [];
  const seen = new Set();
  let lists = 0;
  let lines = 0;
  let dropped = 0;
  for (const [, yearText, listHtml] of visible.matchAll(HEADING_LIST)) {
    lists += 1;
    for (const text of listLines(listHtml)) {
      lines += 1;
      const parsed = parseKoopzondagLine(text, Number(yearText));
      if (parsed.issue) {
        issues.push({ code: parsed.issue });
        continue;
      }
      if (seen.has(parsed.date)) {
        issues.push({ code: "duplicate_date" });
        continue;
      }
      seen.add(parsed.date);
      if (parsed.date < today) {
        dropped += 1;
        continue;
      }
      items.push({
        id: `${ID_PREFIX}${parsed.date}`,
        externalId: `${ID_PREFIX}${parsed.date}`,
        title: koopzondagTitle(parsed.context),
        theme: "Activiteit",
        className: "activity",
        date: parsed.date,
        endDate: null,
        timeSlot: "Info",
        timeText: "",
        location: LOCATION,
        postcodes: [...POSTCODES],
        info: INFO,
        kind: "activity",
        sourceUrl: KOOPZONDAGEN_URL,
        reviewRequired: false,
        inDistrict: true,
      });
    }
  }
  // Een kop zonder lijst erna is een andere opmaak, geen lege lijst.
  if (!lists && ANY_HEADING.test(visible)) issues.push({ code: "heading_without_list" });
  return { items: items.sort((a, b) => a.date.localeCompare(b.date)), lists, lines, issues, dropped };
}
