// Projectpagina's van district Antwerpen (heraanleg, vergroening, schoolstraten …) uit de publieke
// portaal-API: kanaal van district Antwerpen, contentType 9 ("Infofiche"). Puur: geen klok (vandaag
// wordt meegegeven), geen netwerk.
//
// Wat eruit komt:
//   - inspraak- en infomomenten: een blok met als kop "Inspraakmoment", "Infomoment" … en een regel
//     "datum:" (of "wanneer:"), met "tijdstip:" en "locatie:" als ze er staan;
//   - bevragingen: een blok "Bevraging", "Online bevraging" … met "tot (en met) <dag>": een deadline;
//   - fasen: een tabel met een kolom fase/zone en een kolom periode/timing (of start en einde). Een
//     blok "Fase 2: …" met "Start: 3 augustus 2026" maakt een vage start ("augustus 2026") exact.
// Elke twijfel betekent: niet publiceren. De kanaalrespons bevat personeelsvelden (creator,
// assignee, lockOwner …) en namen en telefoonnummers van aannemers: projectPage() houdt alleen titel,
// tags, publishUntil en de tekst van tekst- en tabelblokken over; de items bevatten nooit vrije tekst
// van de pagina buiten datum, uur, plaats, fase en zone, en nooit huisnummers.
import { articleUrl, htmlLines } from "./district-news-parser.mjs";
import { cleanText, formatDutchDate, stripEmails, stripTags } from "./html-text.mjs";
import { normalizePeriodText, parsePeriodText } from "./periode-tekst.mjs";
import { DISTRICT_POSTCODES, postcodesInText } from "./postcodes.mjs";

export const DISTRICT_PROJECT_CHANNEL_ID = "535a196ae8f17c8415000008";
export const PROJECT_CONTENT_TYPE = "9";
export const PROJECTS_OVERVIEW_URL = "https://www.antwerpen.be/nl/overzicht/district-antwerpen-1";
export const PROJECT_FALLBACK_LOCATION = "District Antwerpen, locatie via de officiële bron";

export function projectChannelUrl({ start = 0, limit = 25 } = {}) {
  const params = new URLSearchParams({ contentType: PROJECT_CONTENT_TYPE, start: String(start), limit: String(limit) });
  return `https://www.antwerpen.be/api/portaal/channel/${DISTRICT_PROJECT_CHANNEL_ID}?${params}`;
}

// ---------- van kanaalrespons naar een kleine, veilige vorm ----------

const SKIP_BLOCK = /samenstelling|contact|meer info|werfleiding|aannemer/i;

// Alleen wat we nodig hebben; de rest van het CMS-object (ook creator, assignee, lockOwner) wordt
// nooit gelezen.
export function projectPage(raw) {
  const id = String(raw?.id ?? "").toLowerCase();
  const slug = String(raw?.slug ?? "");
  const title = stripEmails(stripTags(typeof raw?.title === "string" ? raw.title : raw?.title?.text ?? ""));
  const tags = (Array.isArray(raw?.tags) ? raw.tags : []).filter((tag) => typeof tag === "string").map(cleanText);
  const publishUntil = typeof raw?.publishUntil === "string" ? raw.publishUntil : null;
  const blocks = [];
  for (const snippet of Array.isArray(raw?.snippets) ? raw.snippets : []) {
    if (snippet?.type === "wysiwyg") {
      const lines = htmlLines(snippet?.body?.text ?? "").map((line) => line.text);
      if (lines.length && !SKIP_BLOCK.test(lines[0])) blocks.push({ type: "text", lines });
    } else if (snippet?.type === "table") {
      const data = snippet?.body?.data;
      const tableTitle = stripEmails(stripTags(snippet?.body?.title ?? ""));
      if (SKIP_BLOCK.test(tableTitle)) continue;
      blocks.push({
        type: "table",
        title: tableTitle,
        head: (data?.head?.cols ?? []).map((col) => stripEmails(stripTags(col?.content ?? "")).toLowerCase()),
        rows: (data?.rows ?? []).map((row) => (row?.cols ?? []).map((col) => stripEmails(stripTags(col?.content ?? "")))),
      });
    }
  }
  return { id, slug, title, tags, publishUntil, blocks };
}

const EXCLUDE_TITLE = /districtsraad|samenstelling|subsidie|ondersteuning|tarieven|reglement|gids|trouwen|openingsuren|sporthal|sportcentrum|uitleendienst/i;
const PROJECT_TITLE = /\b(heraanleg|herinricht\w*|vergroen\w*|ontharden|onderhoud\w*|werken|schoolstraat|schoolomgeving|speelterrein|speeltuin|speelweefselplan|conceptstudie|herontwikkeling|knip|fietsstra\w*|verbred\w*|aanpassing\w*|aanleg|verkeersplateau|rijrichting|hondenloopzone|grasvernieuwing|bomen)\b/i;

export function isProjectPage(page) {
  if (!/^[a-f0-9]{24}$/.test(page?.id ?? "") || !page.title || EXCLUDE_TITLE.test(page.title)) return false;
  return PROJECT_TITLE.test(page.title) || page.tags.some((tag) => /^(wegenwerken|mobiliteitsprojecten)$/i.test(tag));
}

// ---------- privacy: geen huisnummers, telefoonnummers of e-mailadressen ----------

const STREET_WORD = "\\p{L}[\\p{L}'’-]*(?:straat|laan|lei|plein|plaats|vest|kaai|weg|dreef|markt|rui|brug|vliet|hof|dok|wal|berg|steenweg|singel|park|pad|dries)";
// Een huisnummer: 1 tot 3 cijfers, eventueel met een losse letter ("2A", "2 a"), maar nooit het begin
// van een woord ("16 tot").
const NUMBER = "\\d{1,3}(?:\\s?[a-z](?![\\p{L}]))?";
const RANGE_TAIL = `(?:\\s*(?:-|–|\\/|tot\\s+en\\s+met|tot|t\\/m|en)\\s*${NUMBER})?`;

export function zonderHuisnummers(value) {
  return cleanText(
    stripEmails(value)
      .replace(/(?:\+32|0032)\s?\d[\d ./]{7,12}\d|\b0\d{1,3}[ ./]\d{2,3}[ ./]\d{2}[ ./]\d{2}\b/g, " ")
      // Wat na het weghalen van een nummer of adres overblijft ("bel of mail") mag ook weg.
      .replace(/,?\s*\b(?:bel|mail|tel\.?|telefoon|gsm|e-?mail|contact)\b[^,]*/gi, " ")
      .replace(new RegExp(`\\b(?:(?:tussen|van|vanaf|tot(?:\\s+en\\s+met)?)\\s+)?(?:de\\s+)?(?:huisnummers?|huisnr\\.?|nummers?|nrs?\\.?)\\s*${NUMBER}${RANGE_TAIL}`, "giu"), " ")
      .replace(new RegExp(`(${STREET_WORD})\\s+${NUMBER}${RANGE_TAIL}(?![\\d])`, "giu"), "$1")
      // Een los nummer na een naam en vóór een komma of het einde ("Dries 11 , 2000 Antwerpen").
      .replace(/(\p{Lu}[\p{L}'’-]+)\s+\d{1,3}(?:\s?[a-z](?!\p{L}))?(?=\s*(?:,|$|\(|\s-\s))/gu, "$1")
      .replace(/\s+([,.;:)])/g, "$1")
      .replace(/\(\s*\)/g, " ")
  ).replace(/[\s,;:-]+$/, "");
}

// ---------- uur ----------

const pad = (value) => String(value).padStart(2, "0");
const clock = (h, m = 0) => (h >= 0 && h <= 23 && m >= 0 && m <= 59 ? `${pad(h)}:${pad(m)}` : null);
const spoken = (time) => (time.endsWith(":00") ? String(Number(time.slice(0, 2))) : `${Number(time.slice(0, 2))}.${time.slice(3)}`);
const TIME = "(\\d{1,2})(?:[.:](\\d{2})|u(\\d{2})?)?\\s*(?:uur|u)?";

// "doorlopend tussen 18u en 20u30" -> { timeSlot: "18:00", timeText: "18 tot 20.30 uur" }.
export function parseTijdstip(value) {
  const text = cleanText(value).toLowerCase();
  const range = new RegExp(`(?:^|\\s)${TIME}\\s*(?:tot|-|–|en)\\s*${TIME}`).exec(text);
  if (range) {
    const start = clock(Number(range[1]), Number(range[2] ?? range[3] ?? 0));
    const end = clock(Number(range[4]), Number(range[5] ?? range[6] ?? 0));
    if (start && end && end > start) return { timeSlot: start, timeText: `${spoken(start)} tot ${spoken(end)} uur` };
  }
  const single = new RegExp(`(?:^|\\s)(?:om|vanaf|start om)\\s+${TIME}`).exec(text);
  if (single) {
    const start = clock(Number(single[1]), Number(single[2] ?? single[3] ?? 0));
    if (start) return { timeSlot: start, timeText: `${spoken(start)} uur` };
  }
  return { timeSlot: "Info", timeText: "" };
}

// ---------- inspraak- en infomomenten, bevragingen ----------

const MOMENT_HEADING = /^(?:digitale\s+|online\s+|fysiek\s+)?(inspraakmoment|inspraaksessie|inspraak|infomoment|infoavond|infomarkt|infosessie|bewonersvergadering|participatiemoment|werfbezoek|buurtwandeling)\b/i;
const SURVEY_HEADING = /^(?:digitale\s+|online\s+)?(?:start|na)?(bevraging|enqu[eê]te|vragenlijst)\b/i;
const MONTH_WORD = "(?:januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)";
const DATE_WITH_YEAR = `(?:(?:maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)\\s+)?\\d{1,2}\\s+${MONTH_WORD}\\s+20\\d{2}`;
const PAST_TENSE = /\b(liep|kon|konden|was|waren|vond|vonden|ging|gingen|werd|werden|afgelopen|organiseerde|organiseerden)\b/i;

const KIND_LABEL = {
  inspraakmoment: "Inspraakmoment", inspraaksessie: "Inspraakmoment", inspraak: "Inspraakmoment", infomoment: "Infomoment",
  infoavond: "Infoavond", infomarkt: "Infomarkt", infosessie: "Infosessie", bewonersvergadering: "Bewonersvergadering",
  participatiemoment: "Participatiemoment", werfbezoek: "Werfbezoek", buurtwandeling: "Buurtwandeling",
};

function singleDate(text) {
  const match = new RegExp(DATE_WITH_YEAR, "i").exec(text);
  if (!match) return null;
  const period = parsePeriodText(match[0]);
  return period?.exact && period.start === period.end ? period.start : null;
}

function labelled(lines, pattern) {
  for (const line of lines) {
    const match = pattern.exec(line);
    if (match) return cleanText(match[1]);
  }
  return "";
}

// Eén moment uit een tekstblok, of null.
export function momentFromBlock(lines) {
  const heading = lines[0] ?? "";
  const kind = heading.length <= 80 ? MOMENT_HEADING.exec(heading) : null;
  if (!kind) return null;
  const body = lines.slice(1);
  const dateText = labelled(body, /^(?:datum|wanneer)\s*:?\s*(.+)$/i) || body.find((line) => new RegExp(`^${DATE_WITH_YEAR}\\.?$`, "i").test(line)) || "";
  const date = singleDate(dateText);
  if (!date) return null;
  const timeLine = labelled(body, /^(?:tijdstip|tijd|uur)\s*:?\s*(.+)$/i) || body.find((line) => /^(?:doorlopend|tussen|spring binnen|van\s+\d|om\s+\d|\d{1,2}(?:[.:u]\d{2})?\s*(?:uur\s*)?(?:tot|-))/i.test(line)) || "";
  const time = parseTijdstip(timeLine);
  const place = zonderHuisnummers(labelled(body, /^(?:locatie|waar|adres|plaats)\s*:?\s*(.+)$/i)).slice(0, 200);
  return { kind: KIND_LABEL[kind[1].toLowerCase()] ?? "Infomoment", date, ...time, place };
}

// Een bevraging met een deadline ("Deelnemen kan tot en met 15 november 2026."), of null.
export function surveyFromBlock(lines) {
  const heading = lines[0] ?? "";
  if (heading.length > 80 || !SURVEY_HEADING.test(heading)) return null;
  for (const line of lines.slice(1)) {
    if (PAST_TENSE.test(line)) continue;
    const match = new RegExp(`(?:(?:van|vanaf)\\s+(${DATE_WITH_YEAR}|\\d{1,2}\\s+${MONTH_WORD})\\s+)?(?:tot\\s+en\\s+met|t\\/m|tot)\\s+(${DATE_WITH_YEAR})`, "i").exec(line);
    if (!match) continue;
    const deadline = singleDate(match[2]);
    if (!deadline) continue;
    const range = match[1] ? parsePeriodText(`${match[1]} tot en met ${match[2]}`) : null;
    return { start: range?.exact ? range.start : null, deadline };
  }
  return null;
}

// ---------- fasen ----------

function tableColumns(head, rows) {
  const find = (pattern) => head.findIndex((name) => pattern.test(name.trim()));
  let phase = find(/^(?:fase|fasering|fases)$/);
  // Een naamloze eerste kolom met "fase 1", "1" of "1A" is ook de fasekolom.
  if (phase < 0 && !head[0]?.trim() && rows.length && rows.every((row) => /^(?:fase\s*)?\d+[a-z]?\b/i.test(row[0] ?? ""))) phase = 0;
  if (phase < 0 && rows.some((row) => /^fase\b/i.test(row[0] ?? ""))) phase = 0;
  return {
    phase,
    period: find(/^(?:periode|timing|datums?|data|planning|wanneer\??|uitvoering)$/),
    zone: find(/^(?:zone|locatie|afbakening|werfzone|waar\??|wat\??|wat gebeurt er\??)$/),
    start: find(/^(?:start|startdatum|begin)$/),
    end: find(/^(?:einde|eind|einddatum)$/),
  };
}

function phaseLabel(value) {
  const text = cleanText(value);
  if (!text) return "";
  if (/^\d+[a-z]?$/i.test(text)) return `fase ${text}`;
  return text.replace(/^fase\b/i, "fase");
}

// "Fase 2: …" met "Start: 3 augustus 2026": de exacte startdag per fasenummer.
function exactStarts(blocks) {
  const starts = new Map();
  for (const block of blocks) {
    if (block.type !== "text") continue;
    const phase = /^fase\s+(\d+[a-z]?)\b/i.exec(block.lines[0] ?? "");
    if (!phase) continue;
    for (const line of block.lines) {
      const match = new RegExp(`\\bstart\\s*:?\\s*(${DATE_WITH_YEAR})`, "i").exec(line);
      const date = match ? singleDate(match[1]) : null;
      if (date) {
        starts.set(`fase ${phase[1].toLowerCase()}`, date);
        break;
      }
    }
  }
  return starts;
}

export function phasesFromPage(page) {
  const phases = [];
  const starts = exactStarts(page.blocks);
  let unreadable = 0;
  for (const block of page.blocks) {
    if (block.type !== "table") continue;
    const columns = tableColumns(block.head, block.rows);
    const hasPeriod = columns.period >= 0 || (columns.start >= 0 && columns.end >= 0);
    if (!hasPeriod || (columns.phase < 0 && columns.zone < 0)) continue;
    for (const row of block.rows) {
      const periodText = columns.period >= 0 ? row[columns.period] ?? "" : `${row[columns.start] ?? ""} - ${row[columns.end] ?? ""}`;
      const label = columns.phase >= 0 ? phaseLabel(row[columns.phase]) : "";
      const zone = zonderHuisnummers(columns.zone >= 0 ? row[columns.zone] ?? "" : label.includes(":") ? label.split(":").slice(1).join(":") : "").slice(0, 160);
      const segments = normalizePeriodText(periodText).split(/\s*\+\s*/).filter(Boolean);
      segments.forEach((segment, index) => {
        const period = parsePeriodText(segment);
        if (!period) {
          unreadable += 1;
          return;
        }
        const key = label.split(":")[0].trim().toLowerCase();
        const exact = starts.get(key);
        let start = period.start;
        if (exact && !period.exact && exact.slice(0, 7) === start.slice(0, 7) && exact <= period.end) start = exact;
        phases.push({ label: label.split(":")[0].trim(), zone, start, end: period.end, exact: period.exact, text: segment, part: segments.length > 1 ? index + 1 : 0 });
      });
    }
  }
  return { phases, unreadable };
}

// ---------- items ----------

const slug = (value) => cleanText(value).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const capitalize = (value) => value.charAt(0).toUpperCase() + value.slice(1);

// De straten van een project uit zijn titel: "Heraanleg Kommekensstraat" -> "Kommekensstraat".
export function projectPlace(title) {
  return cleanText(
    title
      .replace(/^(?:heraanleg|herinrichting|werken|onderhoud(?:swerken)?|vergroening(?:sprojecten)?(?:\s+burgerbegroting)?(?:\s+in)?|vergroenen en ontharden in|aanpassing(?:en)?|aanleg|verbreden voetpaden|schoolstraat|schoolomgeving|verkeersveilige schoolomgeving|conceptstudie|herontwikkeling|knip)\s+/i, "")
      .replace(/\s+(?:is bijna klaar|wordt heraangelegd|breekt uit)$/i, "")
  ) || title;
}

function projectPostcodes(page) {
  const found = new Set();
  for (const tag of page.tags) for (const postcode of postcodesInText(tag)) if (DISTRICT_POSTCODES.includes(postcode)) found.add(postcode);
  return [...found].sort();
}

function withPostcode(place, postcodes) {
  if (/\b\d{4}\s+Antwerpen\b/.test(place)) return place;
  return postcodes.length === 1 ? `${place}, ${postcodes[0]} Antwerpen` : `${place}, Antwerpen`;
}

function shortTitle(value, max = 200) {
  const text = cleanText(value);
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max * 0.6)).replace(/[\s,;:.(-]+$/, "")}…`;
}

// Geeft { items, counts }. `pages` zijn ruwe kanaalitems of al projectPage()-objecten.
export function projectItems(pages, { today }) {
  const counts = { pages: 0, projects: 0, moments: 0, surveys: 0, phases: 0, past: 0, unreadablePeriods: 0, items: 0 };
  const items = [];
  for (const raw of Array.isArray(pages) ? pages : []) {
    counts.pages += 1;
    const page = raw?.blocks ? raw : projectPage(raw);
    if (!isProjectPage(page)) continue;
    const sourceUrl = articleUrl({ id: page.id, slug: page.slug });
    if (!sourceUrl) continue;
    counts.projects += 1;
    const postcodes = projectPostcodes(page);
    const place = withPostcode(projectPlace(page.title), postcodes);
    const base = { externalId: page.id, kind: "activity", sourceUrl, retrievedAt: null, reviewRequired: false, inDistrict: true };

    for (const block of page.blocks) {
      if (block.type !== "text") continue;
      const moment = momentFromBlock(block.lines);
      if (moment) {
        if (moment.date < today) {
          counts.past += 1;
        } else {
          counts.moments += 1;
          const location = moment.place ? withPostcode(moment.place, postcodesInText(moment.place).length ? [] : postcodes) : PROJECT_FALLBACK_LOCATION;
          items.push({
            ...base,
            id: `project-${page.id}-${slug(moment.kind)}-${moment.date}`,
            title: shortTitle(`${moment.kind}: ${page.title}`),
            theme: "Activiteit",
            className: "activity",
            date: moment.date,
            endDate: null,
            timeSlot: moment.timeSlot,
            timeText: moment.timeText,
            location,
            postcodes: postcodesInText(location),
            info: `${moment.kind} over het project "${shortTitle(page.title, 140)}" van district Antwerpen. Alle info, plannen en het verslag staan op de projectpagina.`,
          });
        }
        continue;
      }
      const survey = surveyFromBlock(block.lines);
      if (survey) {
        if (survey.deadline < today) {
          counts.past += 1;
          continue;
        }
        counts.surveys += 1;
        items.push({
          ...base,
          id: `project-${page.id}-bevraging-${survey.deadline}`,
          title: shortTitle(`Bevraging: ${page.title}`),
          theme: "Oproep/deadline",
          className: "call",
          kind: "deadline",
          date: survey.start && survey.start < survey.deadline ? survey.start : survey.deadline,
          endDate: survey.start && survey.start < survey.deadline ? survey.deadline : null,
          timeSlot: "Info",
          timeText: `invullen tot en met ${formatDutchDate(survey.deadline)}`,
          location: place,
          postcodes,
          info: `District Antwerpen vraagt je mening over het project "${shortTitle(page.title, 140)}". Invullen kan tot en met ${formatDutchDate(survey.deadline)}; de link staat op de projectpagina.`,
        });
      }
    }

    const { phases, unreadable } = phasesFromPage(page);
    counts.unreadablePeriods += unreadable;
    for (const phase of phases) {
      if (phase.end < today) {
        counts.past += 1;
        continue;
      }
      counts.phases += 1;
      const what = phase.label || phase.zone || "werken";
      const suffix = phase.part ? `, deel ${phase.part}` : "";
      const title = phase.label
        ? `${page.title}: ${phase.label}${suffix}${phase.zone ? ` (${phase.zone})` : ""}`
        : `${page.title}: ${phase.zone}${suffix}`;
      const periodText = cleanText(phase.text).slice(0, 120);
      const approx = phase.exact ? "" : " (data bij benadering)";
      items.push({
        ...base,
        id: `project-${page.id}-${slug(what).slice(0, 30).replace(/-$/, "")}-${phase.start}`,
        title: shortTitle(title),
        theme: "Werken",
        className: "works",
        date: phase.start,
        endDate: phase.end > phase.start ? phase.end : null,
        timeSlot: "Info",
        timeText: `${periodText}${approx}`.slice(0, 200),
        location: phase.zone ? withPostcode(phase.zone, postcodes) : place,
        postcodes,
        info: `${capitalize(phase.label || "werken")}${suffix} van het project "${shortTitle(page.title, 140)}"${phase.zone ? `: ${phase.zone}` : ""}. Periode volgens de projectpagina: ${periodText}${approx}.`.slice(0, 600),
      });
    }
  }
  counts.items = items.length;
  return { items, counts };
}
