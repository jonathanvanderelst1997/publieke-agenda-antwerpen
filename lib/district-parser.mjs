// Leest de publieke kalender "Wat beleef je in district Antwerpen?" (page-content-by-uuid JSON)
// en geeft agenda-items terug. Puur: geen klok, geen netwerk, geen bestanden.
//
// Grammatica van één blok (zoals de redactie het schrijft):
//   <p><strong>Titel<br>Datumregel</strong><br><br>Beschrijving<br><br><em>Plaatsregel</em></p>
// Varianten die ook gelezen worden: plaatsregel in een eigen <p>, beschrijving over meerdere <p>,
// <br> zonder slash, class "rich-text o-article" (HTML), en "|" in plaats van "•"/"&bull;".
import { cleanText, decodeEntities, stripEmails, stripTags, safeHttpsUrl, brusselsDate, isValidIsoDate, weekdayOfIso } from "./html-text.mjs";

export const DISTRICT_PAGE_UUID = "5efb0477b118f7b19c627b69";
export const DISTRICT_CALENDAR_URL =
  "https://www.antwerpen.be/info/5efb0477b118f7b19c627b69/wat-beleef-je-in-district-antwerpen";

// JavaScript-weekdagnummers: 0 = zondag.
const WEEKDAYS = {
  ma: 1,
  maandag: 1,
  di: 2,
  dinsdag: 2,
  wo: 3,
  woe: 3,
  woensdag: 3,
  do: 4,
  donderdag: 4,
  vr: 5,
  vrijdag: 5,
  za: 6,
  zaterdag: 6,
  zo: 0,
  zondag: 0,
};

const MONTHS = {
  jan: 1,
  januari: 1,
  feb: 2,
  febr: 2,
  februari: 2,
  mrt: 3,
  maart: 3,
  apr: 4,
  april: 4,
  mei: 5,
  jun: 6,
  juni: 6,
  jul: 7,
  juli: 7,
  aug: 8,
  augustus: 8,
  sep: 9,
  sept: 9,
  september: 9,
  okt: 10,
  oktober: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const WEEKDAY_PATTERN = "(?:(maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|woe|ma|di|wo|do|vr|za|zo)\\.?\\s+)?";
const MONTH_PATTERN = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join("|");
// Groepen: 1 weekdag, 2 dag, 3 maandnummer, 4 maandnaam, 5 jaar.
const TOKEN_PATTERN = `${WEEKDAY_PATTERN}(\\d{1,2})(?:\\s*\\/\\s*(\\d{1,2})|\\s+(${MONTH_PATTERN})\\.?)?(?:\\s*\\/?\\s*(20\\d{2}))?`;
const TOKEN = new RegExp(`^${TOKEN_PATTERN}$`, "i");
const RANGE = new RegExp(
  `^${TOKEN_PATTERN}(?:\\s+(?:t\\.e\\.m\\.?|tot\\s+en\\s+met|tot)\\s+|\\s*[-–]\\s*)${TOKEN_PATTERN}$`,
  "i"
);

const SPORT_PATTERN =
  /\b(sport\w*|stratenloop|loop|loopt|lopen|lopers|jogging|\w*run|criterium|wielren\w*|wielercriterium|koers|fietstocht|zwem\w*|basket\w*|3x3|voetbal\w*|yoga|pilates|zumba\w*|petanque|padel|tennis|hockey|atletiek|marathon|turnen|beweeg\w*|fitness|skate\w*|klimmen|boogschiet\w*|sup)\b/i;

export function themeFor(title, text = "") {
  return SPORT_PATTERN.test(`${title} ${text}`) ? "Sport" : "Activiteit";
}

export function classNameForTheme(theme) {
  if (theme === "Sport") return "sport";
  if (theme === "Oproep/deadline") return "call";
  if (theme === "Werken") return "works";
  return "activity";
}

export function yearFor(month, refDate) {
  const [refYear, refMonth] = refDate.split("-").map(Number);
  if (month < refMonth - 3) return refYear + 1;
  if (month > refMonth + 8) return refYear - 1;
  return refYear;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function tokenParts(match, offset = 0) {
  return {
    weekday: match[offset + 1] ? match[offset + 1].toLowerCase() : null,
    day: Number(match[offset + 2]),
    month: match[offset + 3] ? Number(match[offset + 3]) : match[offset + 4] ? MONTHS[match[offset + 4].toLowerCase()] : null,
    year: match[offset + 5] ? Number(match[offset + 5]) : null,
  };
}

function makeDate(token, month, year, refDate, issues) {
  const resolvedYear = token.year ?? year ?? yearFor(month, refDate);
  const iso = `${resolvedYear}-${pad(month)}-${pad(token.day)}`;
  if (!isValidIsoDate(iso)) {
    issues.push({ code: "invalid_date" });
    return null;
  }
  if (token.weekday && WEEKDAYS[token.weekday] !== weekdayOfIso(iso)) {
    issues.push({ code: "weekday_mismatch", review: true });
  }
  return iso;
}

// Splitst een datumregel in datumdeel en tijddeel.
export function splitDateTime(line) {
  const text = cleanText(line);
  const pipe = text.indexOf("|");
  if (pipe >= 0) return [text.slice(0, pipe).trim(), text.slice(pipe + 1).trim()];
  const match = /\s(van|om|vanaf)\s+\d{1,2}(?:[.:]\d{2})?\s*(?:uur|tot|-|–)/i.exec(text);
  if (match) return [text.slice(0, match.index).trim(), text.slice(match.index).trim()];
  return [text, ""];
}

const DEADLINE_PREFIX = /^(?:inschrijven\s+kan\s+tot|inschrijven\s+tot|aanvragen\s+kan\s+tot|aanvragen\s+tot|aanvraag\s+tot|deadline\s+aanvraag|deadline)\s*:?\s+/i;

// Leest het datumdeel. Geeft { kind, ranges: [{date, endDate}], issues } terug.
export function parseDatePart(datePart, refDate, { publishUntil = null } = {}) {
  const issues = [];
  let text = cleanText(datePart).replace(/[.,;:]+$/, "");
  let kind = null;
  if (DEADLINE_PREFIX.test(text)) {
    kind = "deadline";
    text = text.replace(DEADLINE_PREFIX, "");
  }
  let openStart = false;
  if (/^vanaf\s+/i.test(text)) {
    openStart = true;
    text = text.replace(/^vanaf\s+/i, "");
  }
  const ranges = [];
  const range = RANGE.exec(text);
  if (range) {
    const first = tokenParts(range, 0);
    const second = tokenParts(range, 5);
    if (!second.month) {
      issues.push({ code: "missing_month" });
    } else {
      const secondDate = makeDate(second, second.month, second.year, refDate, issues);
      const firstMonth = first.month ?? second.month;
      let firstYear = first.year ?? (secondDate && !first.month ? Number(secondDate.slice(0, 4)) : null);
      if (first.month && !first.year && secondDate) {
        firstYear = first.month > second.month ? Number(secondDate.slice(0, 4)) - 1 : Number(secondDate.slice(0, 4));
      }
      const firstDate = makeDate(first, firstMonth, firstYear, refDate, issues);
      if (firstDate && secondDate) {
        if (firstDate > secondDate) issues.push({ code: "range_reversed" });
        else ranges.push({ date: firstDate, endDate: secondDate });
      }
    }
    return { kind: kind ?? "range", ranges, issues };
  }

  const parts = text.split(/\s*(?:,|&|\ben\b)\s*/i).filter(Boolean);
  const tokens = [];
  for (const part of parts) {
    const match = TOKEN.exec(part.trim());
    if (!match) {
      issues.push({ code: "unreadable_date" });
      continue;
    }
    tokens.push(tokenParts(match, 0));
  }
  if (!tokens.length && !issues.length) issues.push({ code: "missing_date" });
  // Maand en jaar erven van rechts: "Vr 25/9, 23/10 & 27/11", "Di 17 en vr 20/2".
  let inheritedMonth = null;
  let inheritedYear = null;
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    if (tokens[index].month) {
      inheritedMonth = tokens[index].month;
      inheritedYear = tokens[index].year;
    } else {
      tokens[index].month = inheritedMonth;
      tokens[index].year = tokens[index].year ?? inheritedYear;
    }
  }
  for (const token of tokens) {
    if (!token.month) {
      issues.push({ code: "missing_month" });
      continue;
    }
    const iso = makeDate(token, token.month, token.year, refDate, issues);
    if (iso) ranges.push({ date: iso, endDate: null });
  }
  if (openStart) {
    if (ranges.length !== 1) issues.push({ code: "open_start_not_single" });
    else ranges[0].endDate = publishUntil && publishUntil > ranges[0].date ? publishUntil : null;
    return { kind: kind ?? "open_start", ranges, issues };
  }
  return { kind: kind ?? (ranges.length === 1 ? "single" : "multiple"), ranges, issues };
}

function clock(hours, minutes) {
  const h = Number(hours);
  const m = Number(minutes ?? 0);
  if (!Number.isInteger(h) || h < 0 || h > 23 || !Number.isInteger(m) || m < 0 || m > 59) return null;
  return `${pad(h)}:${pad(m)}`;
}

// Tijdgrammatica: "H[.MM] uur", "om H uur", "vanaf H uur", "H[.MM] (tot|-) H[.MM] uur",
// "van H tot H uur", "om H en H uur". Al de rest wordt timeText met timeSlot "Info".
export function parseTimePart(timePart) {
  const timeText = cleanText(timePart);
  if (!timeText) return { timeSlot: "Info", timeText: "", starts: [], endTime: null };
  const core = timeText
    .replace(/\s*\([^)]*\)\s*$/, "")
    .toLowerCase()
    .replace(/^start\s+/, "")
    .trim();
  const single = /^(?:van\s+|om\s+|vanaf\s+)?(\d{1,2})(?:[.:](\d{2}))?\s*(?:uur\s*)?(?:(?:tot|-|–)\s*(\d{1,2})(?:[.:](\d{2}))?\s*)?uur$/.exec(core);
  if (single) {
    const start = clock(single[1], single[2]);
    const end = single[3] ? clock(single[3], single[4]) : null;
    if (start && (!single[3] || end)) return { timeSlot: start, timeText, starts: [start], endTime: end };
  }
  const multiple = /^(?:om\s+)?(\d{1,2}(?:[.:]\d{2})?(?:\s*(?:uur)?\s*(?:,|en|&)\s*(?:om\s+)?\d{1,2}(?:[.:]\d{2})?)+)\s*uur$/.exec(core);
  if (multiple) {
    const starts = [...multiple[1].matchAll(/(\d{1,2})(?:[.:](\d{2}))?/g)].map((match) => clock(match[1], match[2]));
    if (starts.length && starts.every(Boolean)) return { timeSlot: starts[0], timeText, starts, endTime: null };
  }
  return { timeSlot: "Info", timeText, starts: [], endTime: null };
}

const POSTCODE_LIST = /^((?:\d{4}\s*(?:,|en|&)\s*)*\d{4})\s+Antwerpen$/i;
const ANCHOR = /<a\s[^>]*?href\s*=\s*("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/i;

// Leest de plaatsregel. Segmenten zijn gescheiden door •, &bull; of |.
export function parsePlaceLine(html) {
  const result = { postcodes: [], location: "", prices: [], infoUrl: "", droppedLinks: 0 };
  const locationParts = [];
  for (const segment of String(html ?? "").split(/&bull;|&#8226;|•|\|/)) {
    const anchor = ANCHOR.exec(segment);
    const text = stripTags(segment);
    if (!text && !anchor) continue;
    if (anchor) {
      const href = decodeEntities(anchor[2] ?? anchor[3] ?? "").trim();
      const safe = /^mailto:/i.test(href) ? "" : safeHttpsUrl(href);
      if (safe) {
        if (!result.infoUrl) result.infoUrl = safe;
      } else {
        result.droppedLinks += 1;
      }
      continue;
    }
    const postcodes = POSTCODE_LIST.exec(text);
    if (postcodes) {
      result.postcodes = [...new Set(postcodes[1].match(/\d{4}/g))].sort();
      continue;
    }
    if (/gratis|€/i.test(text)) {
      result.prices.push(text);
      continue;
    }
    if (/^meer info/i.test(text)) continue;
    const cleaned = stripEmails(text).replace(/[\s,;:]+$/, "");
    if (!cleaned) continue;
    const inner = /\b(20[0-6]0|2018)\s+Antwerpen\b/.exec(cleaned);
    if (inner && !result.postcodes.length) result.postcodes = [inner[1]];
    locationParts.push(cleaned);
  }
  result.location = locationParts.join(", ");
  return result;
}

function truncate(text, max = 300) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max).replace(/[\s,;:.]+$/, "")}…`;
}

const BREAK = "<br\\s*\\/?>";
const DOUBLE_BREAK = new RegExp(`${BREAK}(?:\\s|&nbsp;|<\\/?span[^>]*>)*${BREAK}`, "i");

// Splitst rich-text in blokken die elk met <p><strong> beginnen.
export function splitBlocks(richText) {
  const html = String(richText ?? "");
  const starts = [...html.matchAll(/<p[^>]*>\s*(?:<span[^>]*>\s*)*<strong/gi)].map((match) => match.index);
  return starts.map((start, index) => html.slice(start, starts[index + 1] ?? html.length));
}

// Titel, datumregel, beschrijving en plaatsregel van één blok.
export function readBlock(blockHtml) {
  const html = String(blockHtml);
  const firstParagraphEnd = html.search(/<\/p>/i);
  const doubleBreak = DOUBLE_BREAK.exec(html);
  let headEnd = firstParagraphEnd >= 0 ? firstParagraphEnd : html.length;
  if (doubleBreak && doubleBreak.index < headEnd) headEnd = doubleBreak.index;
  const head = html.slice(0, headEnd);
  let rest = html.slice(headEnd);
  const headLines = head
    .split(new RegExp(BREAK, "i"))
    .map((line) => stripEmails(stripTags(line)))
    .filter(Boolean);
  let title = headLines[0] ?? "";
  let dateLine = headLines[1] ?? "";
  // Alles na de datumregel in hetzelfde kopblok is al beschrijving (één <br> in plaats van twee).
  const headDescription = headLines.slice(2).join(" ");
  if (!dateLine) {
    // Datumregel buiten <strong>: de eerste niet-lege regel na de titel.
    const chunk = new RegExp(`([\\s\\S]*?)(${BREAK}|<\\/p>|$)`, "gi");
    let match;
    while ((match = chunk.exec(rest)) && match[0].length) {
      const line = stripTags(match[1]);
      if (line) {
        dateLine = line;
        rest = rest.slice(match.index + match[0].length);
        break;
      }
    }
  }

  const emphasised = [...rest.matchAll(/<em[^>]*>([\s\S]*?)<\/em>/gi)];
  let placeHtml = "";
  let descriptionHtml = rest;
  if (emphasised.length) {
    const last = emphasised[emphasised.length - 1];
    placeHtml = last[1];
    descriptionHtml = rest.slice(0, last.index) + rest.slice(last.index + last[0].length);
  } else {
    const paragraphs = [...rest.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
    const last = paragraphs[paragraphs.length - 1];
    if (last && /&bull;|&#8226;|•|\|/.test(last[1])) {
      placeHtml = last[1];
      descriptionHtml = rest.slice(0, last.index) + rest.slice(last.index + last[0].length);
    }
  }
  descriptionHtml = descriptionHtml.replace(/<a\s[^>]*href\s*=\s*["']mailto:[^"']*["'][^>]*>[\s\S]*?<\/a>/gi, " ");
  const description = stripEmails([headDescription, stripTags(descriptionHtml)].filter(Boolean).join(" "));
  title = cleanText(title);
  return { title, dateLine: cleanText(dateLine), description, placeHtml };
}

function isoFromTimestamp(value) {
  if (!value) return null;
  return brusselsDate(value);
}

// Zet één blok om in items. Een blok met een probleem krijgt reviewRequired en wordt niet gepubliceerd.
export function parseBlock(blockHtml, { snippetId, blockIndex = 0, refDate, publishUntil = null, sourceUrl = DISTRICT_CALENDAR_URL }) {
  const block = readBlock(blockHtml);
  const issues = [];
  if (!block.title) issues.push({ code: "missing_title" });
  if (!block.dateLine) issues.push({ code: "missing_date_line" });
  const [datePart, timePart] = splitDateTime(block.dateLine);
  const parsedDate = block.dateLine ? parseDatePart(datePart, refDate, { publishUntil }) : { kind: null, ranges: [], issues: [] };
  issues.push(...parsedDate.issues);
  const deadline = parsedDate.kind === "deadline" || /deadline/i.test(block.dateLine);
  const time = parseTimePart(deadline && /deadline/i.test(timePart) ? "" : timePart);
  const place = parsePlaceLine(block.placeHtml);
  const theme = deadline ? "Oproep/deadline" : themeFor(block.title, block.description);
  const location = place.location || (place.postcodes.length ? `${place.postcodes.join(", ")} Antwerpen` : "verschillende locaties");
  const info = truncate([block.description, place.prices.length ? `Prijs: ${place.prices.join(" / ")}` : ""].filter(Boolean).join(" "));
  const reviewRequired = issues.length > 0 || parsedDate.ranges.length === 0;
  const idBase = `district-kal-${String(snippetId).toLowerCase()}${blockIndex > 0 ? `-b${blockIndex}` : ""}`;
  const items = parsedDate.ranges.map((range) => ({
    id: `${idBase}-${range.date}`,
    externalId: String(snippetId),
    title: block.title,
    theme,
    className: classNameForTheme(theme),
    date: range.date,
    endDate: range.endDate ?? null,
    timeSlot: time.timeSlot,
    timeText: time.timeText,
    location,
    postcodes: place.postcodes,
    info,
    ...(place.infoUrl ? { infoUrl: place.infoUrl } : {}),
    kind: deadline ? "deadline" : "activity",
    sourceUrl,
    retrievedAt: null,
    reviewRequired,
  }));
  return { items, issues, droppedLinks: place.droppedLinks, reviewRequired };
}

// Hoofdingang: page-content-by-uuid JSON van de districtskalender.
export function parseDistrictPage(pageJson) {
  const refDate = isoFromTimestamp(pageJson?.date ?? pageJson?.publishedAt ?? pageJson?.updatedAt);
  const publishUntil = isoFromTimestamp(pageJson?.publishUntil);
  const result = { blocks: 0, items: [], reviewItems: [], issues: [], droppedLinks: 0, refDate, publishUntil };
  if (!refDate) {
    result.issues.push({ code: "missing_article_date", snippetId: null });
    return result;
  }
  const snippets = Array.isArray(pageJson?.snippets) ? pageJson.snippets : [];
  for (const snippet of snippets) {
    if (snippet?.type !== "wysiwyg" || snippet.intro === true) continue;
    const text = snippet?.body?.text ?? "";
    const snippetId = String(snippet.id ?? "").toLowerCase();
    if (!/^[a-z0-9]{6,40}$/.test(snippetId)) {
      result.issues.push({ code: "invalid_snippet_id", snippetId: null });
      continue;
    }
    splitBlocks(text).forEach((blockHtml, blockIndex) => {
      result.blocks += 1;
      const parsed = parseBlock(blockHtml, { snippetId, blockIndex, refDate, publishUntil });
      result.droppedLinks += parsed.droppedLinks;
      for (const issue of parsed.issues) result.issues.push({ ...issue, snippetId, blockIndex });
      for (const item of parsed.items) (item.reviewRequired ? result.reviewItems : result.items).push(item);
    });
  }
  return result;
}

// HTML-variant (bv. het o-article-blok of een archiefkopie): <div class="rich-text ...">.
export function parseDistrictHtml(html, { refDate, publishUntil = null }) {
  const result = { blocks: 0, items: [], reviewItems: [], issues: [], droppedLinks: 0, refDate, publishUntil };
  const richTexts = [...String(html ?? "").matchAll(/<div class="rich-text[^"]*">([\s\S]*?)<\/div>/gi)].map((match) => match[1]);
  richTexts.forEach((richText, index) => {
    splitBlocks(richText).forEach((blockHtml, blockIndex) => {
      result.blocks += 1;
      const parsed = parseBlock(blockHtml, { snippetId: `html${index}`, blockIndex, refDate, publishUntil });
      result.droppedLinks += parsed.droppedLinks;
      for (const issue of parsed.issues) result.issues.push({ ...issue, snippetId: `html${index}`, blockIndex });
      for (const item of parsed.items) (item.reviewRequired ? result.reviewItems : result.items).push(item);
    });
  });
  return result;
}
