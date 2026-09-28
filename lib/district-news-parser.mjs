// Haalt data uit nieuwsartikels van district Antwerpen. Heel conservatief: een datum telt alleen
// uit een tabel (kolommen datum/uur/locatie) of uit een regel die begint met "Wanneer:",
// "Datum:" of een blok "Praktisch". Elke dubbelzinnigheid betekent: niet publiceren.
// Puur: geen klok (vandaag wordt meegegeven), geen netwerk. Personeelsvelden uit het CMS
// (creator, assignee, lockOwner …) worden nooit gelezen.
//
// Voor de nieuwskanalen van de andere districten (scripts/fetch-sources-stad-districten.mjs) zijn er
// opties, allemaal standaard uit, zodat district Antwerpen precies hetzelfde gelezen wordt:
//   idPrefix          voorvoegsel van de item-id (standaard "district-news-");
//   fallbackLocation  { location, postcodes } als het artikel zelf geen plaats noemt;
//   activityTables    een tabel met een datumkolom én een kolom "activiteit"/"wat": elke rij is een
//                     eigen activiteit met de titel uit die cel (of de linktekst);
//   singleBlock       als niets anders een datum geeft: precies één blok "<p><strong>Titel</strong>
//                     <br>datum …" (zoals "Meer info" onderaan), gelezen met readBlock/parseBlock;
//   skipWorks         artikels over werken, omleidingen en heraanleg overslaan.
import { cleanText, decodeEntities, stripEmails, stripTags, brusselsDate, safeHttpsUrl } from "./html-text.mjs";
import { classNameForTheme, parseBlock, parseDatePart, parsePlaceLine, parseTimePart, readBlock, splitBlocks, splitDateTime, themeFor } from "./district-parser.mjs";
import { postcodesInText } from "./postcodes.mjs";

export const DISTRICT_NEWS_CHANNEL_ID = "535a196ae8f17c8415000008";

const ARTICLE_ID = /^[a-f0-9]{24}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function articleUrl(article) {
  const id = String(article?.id ?? article?.uuid ?? "").toLowerCase();
  const slug = String(article?.slug ?? "");
  if (!ARTICLE_ID.test(id) || !SLUG.test(slug)) return "";
  return `https://www.antwerpen.be/info/${id}/${slug}`;
}

function articleTitle(article) {
  const title = typeof article?.title === "string" ? article.title : article?.title?.text;
  return stripEmails(stripTags(title ?? ""));
}

// HTML naar regels: <br>, </p>, </li> en koppen worden regeleinden.
export function htmlLines(html) {
  const marked = String(html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|li|h[1-6]|div|tr)>/gi, "\n")
    .replace(/<(?:h[1-6])[^>]*>/gi, "\n##HEADING## ");
  return marked
    .split("\n")
    .map((line) => {
      const heading = line.includes("##HEADING##");
      return { text: stripEmails(stripTags(line.replace("##HEADING##", ""))), heading };
    })
    .filter((line) => line.text);
}

function tableRows(snippet) {
  const data = snippet?.body?.data;
  const head = (data?.head?.cols ?? []).map((col) => cleanText(stripTags(col?.content ?? "")).toLowerCase());
  const dateIndex = head.findIndex((name) => name === "datum" || name.startsWith("datum"));
  if (dateIndex < 0) return [];
  const timeIndex = head.findIndex((name) => ["uur", "tijd", "tijdstip", "uren"].includes(name));
  const placeIndex = head.findIndex((name) => ["locatie", "plaats", "waar", "adres"].includes(name));
  return (data?.rows ?? []).map((row) => {
    const cells = (row?.cols ?? []).map((col) => stripEmails(stripTags(col?.content ?? "")));
    return {
      dateText: cells[dateIndex] ?? "",
      timeText: timeIndex >= 0 ? cells[timeIndex] ?? "" : "",
      location: placeIndex >= 0 ? cells[placeIndex] ?? "" : "",
    };
  });
}

function parseDateLine(line, refDate) {
  const [datePart, timePart] = splitDateTime(line);
  const parsed = parseDatePart(datePart, refDate);
  const blocking = parsed.issues.filter((issue) => issue.code !== "weekday_mismatch");
  if (!parsed.ranges.length || blocking.length) return null;
  return {
    ranges: parsed.ranges,
    time: parseTimePart(timePart),
    review: parsed.issues.some((issue) => issue.code === "weekday_mismatch"),
    deadline: parsed.kind === "deadline",
  };
}

const LOCATION_PREFIX = /^(?:start\s+aan|vertrek\s+aan|waar\s*:|locatie\s*:|adres\s*:|plaats\s*:)\s*/i;

function looksLikeLocation(text) {
  return LOCATION_PREFIX.test(text) || /\b\d{4}\s+Antwerpen\b/.test(text);
}

// Verzamelt kandidaten uit tabellen en tekstregels van één artikel.
// Met skipActivityTables slaat hij tabellen met een activiteitenkolom over (die leest activityTableItems).
export function collectCandidates(article, refDate, { skipActivityTables = false } = {}) {
  const candidates = [];
  for (const snippet of article?.snippets ?? []) {
    if (snippet?.type === "table") {
      if (skipActivityTables && activityColumns(snippet)) continue;
      for (const row of tableRows(snippet)) {
        const parsed = parseDateLine(row.dateText, refDate);
        if (!parsed) {
          candidates.push({ origin: "table", unreadable: true });
          continue;
        }
        const time = row.timeText ? parseTimePart(row.timeText) : parsed.time;
        candidates.push({ origin: "table", ...parsed, time, location: row.location });
      }
      continue;
    }
    if (snippet?.type !== "wysiwyg") continue;
    const lines = htmlLines(snippet?.body?.text ?? "");
    for (let index = 0; index < lines.length; index += 1) {
      const text = lines[index].text;
      const labelled = /^(?:wanneer|datum)\s*:\s*(.+)$/i.exec(text);
      if (labelled) {
        const parsed = parseDateLine(labelled[1], refDate);
        if (!parsed) {
          candidates.push({ origin: "wanneer", unreadable: true });
          continue;
        }
        const nearby = lines.slice(index + 1, index + 4).find((line) => /^(?:waar|locatie|adres|plaats)\s*:/i.test(line.text));
        candidates.push({ origin: "wanneer", ...parsed, location: nearby ? nearby.text.replace(LOCATION_PREFIX, "") : "" });
        continue;
      }
      if (/^praktisch\b\s*:?\s*$/i.test(text) || /^praktisch\s*:/i.test(text)) {
        const section = [];
        for (let next = index + 1; next < lines.length; next += 1) {
          if (lines[next].heading || /^praktisch\b/i.test(lines[next].text)) break;
          section.push(lines[next].text);
        }
        const dateLines = section.map((line) => ({ line, parsed: parseDateLine(line, refDate) })).filter((entry) => entry.parsed);
        if (!dateLines.length) continue;
        if (dateLines.length > 1) {
          candidates.push({ origin: "praktisch", ambiguous: true });
          continue;
        }
        const { line: dateLine, parsed } = dateLines[0];
        let time = parsed.time;
        if (time.timeSlot === "Info") {
          const timeLine = section.find((line) => line !== dateLine && /^(?:van\s+|om\s+|vanaf\s+)?\d{1,2}(?:[.:]\d{2})?\s*(?:uur|tot|-|–)/i.test(line));
          if (timeLine) time = parseTimePart(timeLine);
        }
        const locationLine = section.find((line) => line !== dateLine && looksLikeLocation(line));
        candidates.push({ origin: "praktisch", ...parsed, time, location: locationLine ? locationLine.replace(LOCATION_PREFIX, "") : "" });
      }
    }
  }
  return candidates;
}

function leadText(article) {
  const first = (article?.snippets ?? []).find((snippet) => snippet?.type === "wysiwyg");
  const paragraph = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(first?.body?.text ?? "");
  const text = stripEmails(stripTags(paragraph ? paragraph[1] : first?.body?.text ?? ""));
  if (text.length <= 300) return text;
  const cut = text.slice(0, 300);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 180)).replace(/[\s,;:.]+$/, "")}…`;
}

function articleId(article) {
  return String(article.id ?? article.uuid).toLowerCase();
}

function fallbackFor(location, fallbackLocation) {
  if (location || !fallbackLocation?.location) return null;
  return { location: fallbackLocation.location, postcodes: [...(fallbackLocation.postcodes ?? [])] };
}

// Van kandidaten naar items: alleen datums tussen de artikeldatum en publishUntil, en één datum
// met twee verschillende uren of plaatsen is dubbelzinnig.
function itemsFromCandidates(candidates, context) {
  const { article, title, refDate, publishUntil, sourceUrl, idPrefix, fallbackLocation } = context;
  const empty = (reason, dropped = 0) => ({ items: [], reviewItems: [], reason, dropped });
  if (!candidates.length) return empty("no_date_line");
  if (candidates.some((candidate) => candidate.ambiguous || candidate.unreadable)) return empty("ambiguous");

  const occurrences = [];
  let dropped = 0;
  for (const candidate of candidates) {
    for (const range of candidate.ranges) {
      if (range.date < refDate || range.date > publishUntil) {
        dropped += 1;
        continue;
      }
      occurrences.push({ ...range, time: candidate.time, location: cleanText(candidate.location), review: candidate.review, deadline: candidate.deadline });
    }
  }
  const byDate = new Map();
  for (const occurrence of occurrences) {
    const previous = byDate.get(occurrence.date);
    if (!previous) {
      byDate.set(occurrence.date, occurrence);
      continue;
    }
    const same =
      previous.endDate === occurrence.endDate &&
      previous.time.timeSlot === occurrence.time.timeSlot &&
      previous.location === occurrence.location;
    if (!same) return empty("ambiguous");
  }
  if (!byDate.size) return empty("outside_publication_window", dropped);

  const lead = leadText(article);
  const items = [];
  const reviewItems = [];
  for (const occurrence of [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))) {
    const theme = occurrence.deadline ? "Oproep/deadline" : themeFor(title, lead);
    const fallback = fallbackFor(occurrence.location, fallbackLocation);
    const location = fallback ? fallback.location : occurrence.location;
    const item = {
      id: `${idPrefix}${articleId(article)}-${occurrence.date}`,
      externalId: articleId(article),
      title,
      theme,
      className: classNameForTheme(theme),
      date: occurrence.date,
      endDate: occurrence.endDate ?? null,
      timeSlot: occurrence.time.timeSlot,
      timeText: occurrence.time.timeText,
      location,
      postcodes: fallback ? fallback.postcodes : postcodesInText(occurrence.location),
      info: lead,
      kind: occurrence.deadline ? "deadline" : "activity",
      sourceUrl,
      retrievedAt: null,
      reviewRequired: Boolean(occurrence.review) || !location,
    };
    (item.reviewRequired ? reviewItems : items).push(item);
  }
  return { items, reviewItems, reason: items.length ? null : "review_required", dropped };
}

// ---------- tabel met één activiteit per rij ----------

function headName(col) {
  return cleanText(stripTags(col?.content ?? ""))
    .toLowerCase()
    .replace(/[?:]+$/, "")
    .trim();
}

// Kolomnummers als de tabel een datumkolom én een activiteitenkolom heeft, anders null.
function activityColumns(snippet) {
  const head = (snippet?.body?.data?.head?.cols ?? []).map(headName);
  const date = head.findIndex((name) => name.startsWith("datum") || name === "wanneer");
  const title = head.findIndex((name) => /^(?:activiteit|wat)\b/.test(name));
  if (date < 0 || title < 0 || date === title) return null;
  return {
    date,
    title,
    time: head.findIndex((name) => ["uur", "tijd", "tijdstip", "uren"].includes(name)),
    place: head.findIndex((name) => ["locatie", "plaats", "waar", "adres"].includes(name)),
  };
}

// Het CMS schrijft een link in een tabelcel als ["url" "linktekst" "titel"].
const CELL_LINK = /\[\s*"([^"]*)"\s+"([^"]*)"\s+"([^"]*)"\s*\]/g;

function cellText(content) {
  return stripEmails(stripTags(String(content ?? "").replace(CELL_LINK, (whole, url, text) => ` ${text} `)));
}

function cellLink(content) {
  const source = String(content ?? "");
  const match = new RegExp(CELL_LINK.source).exec(source) ?? /<a\s[^>]*href\s*=\s*"([^"]*)"/i.exec(source);
  const safe = match ? safeHttpsUrl(decodeEntities(match[1]).trim()) : "";
  if (!safe) return "";
  const url = new URL(safe);
  return url.hostname === "www.antwerpen.be" && !url.search && !url.hash ? safe : "";
}

// "ma 24/8 - 10 uur": datum en uur in één cel, gescheiden door een streepje.
function splitDateCell(text) {
  const dashed = /^(.*?\d)\s+[-–]\s+(\d{1,2}(?:[.:]\d{2})?\s*(?:uur|u)\b.*)$/i.exec(cleanText(text));
  return dashed ? [dashed[1], dashed[2]] : splitDateTime(text);
}

const GENERIC_TITLE = /^(?:praktisch(?:e\s+info(?:rmatie)?)?|info|meer\s+info(?:rmatie)?|programma|wanneer|waar|datum)\s*:?$/i;

function truncateInfo(text, max = 300) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 180)).replace(/[\s,;:.]+$/, "")}…`;
}

// Elke rij met een leesbare datum binnen het publicatievenster wordt een eigen item. Een rij zonder
// leesbare datum ("Tot oktober") valt weg; de andere rijen staan op zichzelf.
export function activityTableItems(article, context) {
  const { refDate, publishUntil, sourceUrl, idPrefix, fallbackLocation } = context;
  const result = { items: [], reviewItems: [], dropped: 0, unreadable: 0, rows: 0 };
  let tableIndex = -1;
  for (const snippet of article?.snippets ?? []) {
    if (snippet?.type !== "table") continue;
    tableIndex += 1;
    const columns = activityColumns(snippet);
    if (!columns) continue;
    (snippet.body.data.rows ?? []).forEach((row, rowIndex) => {
      result.rows += 1;
      const cells = (row?.cols ?? []).map((col) => col?.content ?? "");
      const title = cleanText(cellText(cells[columns.title]));
      if (!title || GENERIC_TITLE.test(title) || title.length > 200) {
        result.unreadable += 1;
        return;
      }
      const [datePart, timeFromDate] = splitDateCell(cellText(cells[columns.date]));
      const parsed = parseDatePart(datePart, refDate, { publishUntil });
      const blocking = parsed.issues.filter((issue) => issue.code !== "weekday_mismatch");
      if (!parsed.ranges.length || blocking.length) {
        result.unreadable += 1;
        return;
      }
      const time = parseTimePart(columns.time >= 0 ? cellText(cells[columns.time]) : timeFromDate);
      const place = columns.place >= 0 ? cleanText(cellText(cells[columns.place])) : "";
      const fallback = fallbackFor(place, fallbackLocation);
      const location = fallback ? fallback.location : place;
      const used = new Set([columns.date, columns.title, columns.time, columns.place]);
      const info = truncateInfo(cleanText(cells.filter((cell, index) => !used.has(index)).map(cellText).join(" ")));
      const infoUrl = cellLink(cells[columns.title]);
      const deadline = parsed.kind === "deadline";
      const theme = deadline ? "Oproep/deadline" : themeFor(title, info);
      for (const range of parsed.ranges) {
        if (range.date < refDate || range.date > publishUntil) {
          result.dropped += 1;
          continue;
        }
        const item = {
          id: `${idPrefix}${articleId(article)}-t${tableIndex}r${rowIndex}-${range.date}`,
          externalId: articleId(article),
          title,
          theme,
          className: classNameForTheme(theme),
          date: range.date,
          endDate: range.endDate ?? null,
          timeSlot: time.timeSlot,
          timeText: time.timeText,
          location,
          postcodes: fallback ? fallback.postcodes : postcodesInText(place),
          info,
          ...(infoUrl ? { infoUrl } : {}),
          kind: deadline ? "deadline" : "activity",
          sourceUrl,
          retrievedAt: null,
          reviewRequired: parsed.issues.some((issue) => issue.code === "weekday_mismatch") || !location,
        };
        (item.reviewRequired ? result.reviewItems : result.items).push(item);
      }
    });
  }
  return result;
}

// ---------- één blok "Titel + datum" ----------

// Een lijst meteen na een vetgedrukte titel ("<p><strong>X</strong></p><ul><li>datum</li>…") wordt
// één blok met <br>-regels, zoals readBlock het verwacht.
function listsAsLines(html) {
  return String(html ?? "")
    .replace(/<\/p>\s*<ul[^>]*>\s*<li[^>]*>/gi, "<br>")
    .replace(/<\/li>\s*<li[^>]*>/gi, "<br>")
    .replace(/<\/li>\s*<\/ul>/gi, "</p>")
    .replace(/<\/?(?:ul|li)[^>]*>/gi, "");
}

// Precies één blok met een leesbare datum in het hele artikel. Blokken zonder datum (een
// contactblok, een vetgedrukte waarschuwing) tellen niet mee. Geeft null, of een kandidaat, of
// { ambiguous } / { unreadable } / { generic }.
export function singleBlockCandidate(article, { refDate, publishUntil, sourceUrl }) {
  const dated = [];
  for (const snippet of article?.snippets ?? []) {
    if (snippet?.type !== "wysiwyg") continue;
    for (const blockHtml of splitBlocks(listsAsLines(snippet?.body?.text ?? ""))) {
      const block = readBlock(blockHtml);
      if (!block.title || !block.dateLine) continue;
      const [datePart] = splitDateTime(block.dateLine);
      if (!parseDatePart(datePart, refDate, { publishUntil }).ranges.length) continue;
      dated.push({ blockHtml, block });
    }
  }
  if (!dated.length) return null;
  if (dated.length > 1) return { ambiguous: true };
  const [{ blockHtml, block }] = dated;
  if (GENERIC_TITLE.test(block.title)) return { generic: true };
  const parsed = parseBlock(blockHtml, { snippetId: articleId(article), refDate, publishUntil, sourceUrl });
  const blocking = parsed.issues.filter((issue) => issue.code !== "weekday_mismatch");
  if (!parsed.items.length || blocking.length) return { unreadable: true };
  const [first] = parsed.items;
  return {
    origin: "block",
    ranges: parsed.items.map((item) => ({ date: item.date, endDate: item.endDate })),
    time: { timeSlot: first.timeSlot, timeText: first.timeText },
    location: parsePlaceLine(block.placeHtml).location,
    review: parsed.issues.some((issue) => issue.code === "weekday_mismatch"),
    deadline: first.kind === "deadline",
  };
}

const WORKS_TITLE = /(?<!samen)werken\b|\bheraanleg|\bvernieuwing|\bproefopstelling|\bomleiding|\bonderbroken\b|\btramsporen\b|\briolering/i;

// Resultaat: { items, reviewItems, reason } — reason is null als er iets gepubliceerd kan worden.
export function parseDistrictNewsArticle(
  article,
  { today, idPrefix = "district-news-", fallbackLocation = null, activityTables = false, singleBlock = false, skipWorks = false }
) {
  const refDate = brusselsDate(article?.publishedAt ?? article?.date ?? "");
  const publishUntil = brusselsDate(article?.publishUntil ?? "");
  const sourceUrl = articleUrl(article);
  const title = articleTitle(article);
  const empty = (reason) => ({ items: [], reviewItems: [], reason, dropped: 0 });
  if (!sourceUrl) return empty("invalid_article_url");
  if (!refDate) return empty("missing_article_date");
  if (!publishUntil) return empty("missing_publish_until");
  if (publishUntil < today) return empty("unpublished");
  if (!title) return empty("missing_title");
  if (skipWorks && WORKS_TITLE.test(title)) return empty("works");

  const context = { article, title, refDate, publishUntil, sourceUrl, idPrefix, fallbackLocation };
  const fromTables = activityTables ? activityTableItems(article, context) : null;
  const candidates = collectCandidates(article, refDate, { skipActivityTables: activityTables });
  // Het ene blok is een laatste redmiddel: alleen als tabel noch tekstregel iets geeft.
  if (!candidates.length && singleBlock && !fromTables?.rows) {
    const block = singleBlockCandidate(article, context);
    if (block?.generic) return empty("generic_block_title");
    if (block?.ambiguous || block?.unreadable) candidates.push({ origin: "block", ambiguous: true });
    else if (block) candidates.push(block);
  }
  const fromArticle = itemsFromCandidates(candidates, context);
  if (!fromTables) return fromArticle;

  const items = [...fromArticle.items, ...fromTables.items];
  const reviewItems = [...fromArticle.reviewItems, ...fromTables.reviewItems];
  let reason = items.length ? null : fromArticle.reason;
  if (!items.length && fromArticle.reason === "no_date_line" && fromTables.rows) {
    if (fromTables.reviewItems.length) reason = "review_required";
    else if (fromTables.dropped) reason = "outside_publication_window";
    else reason = "unreadable_table";
  }
  return { items, reviewItems, reason, dropped: fromArticle.dropped + fromTables.dropped };
}

// Zet het o-article-blok van een artikelpagina om naar dezelfde vorm als de kanaal-JSON.
// Alleen gebruikt door toetsen met een vastgelegde, opgeschoonde fixture.
export function articleFromHtml(html, { id, slug, publishUntil }) {
  const source = String(html ?? "");
  const title = stripTags(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(source)?.[1] ?? "");
  const publishedAt = /<time[^>]*dateTime="([^"]+)"/i.exec(source)?.[1] ?? null;
  const snippets = [];
  const snippetPattern = /<div class="snippet snippet-(wysiwyg|table)">([\s\S]*?)(?=<div class="snippet |<\/div><\/section>|$)/gi;
  for (const match of source.matchAll(snippetPattern)) {
    if (match[1] === "wysiwyg") {
      snippets.push({ type: "wysiwyg", body: { text: match[2] } });
      continue;
    }
    const header = [...match[2].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((cell) => ({ content: decodeEntities(cell[1]) }));
    const body = /<tbody[^>]*>([\s\S]*?)<\/tbody>/i.exec(match[2])?.[1] ?? "";
    const rows = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) => ({
      cols: [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => ({ content: decodeEntities(cell[1]) })),
    }));
    snippets.push({ type: "table", body: { data: { head: { cols: header }, rows } } });
  }
  return { id, slug, title, publishedAt, publishUntil, snippets };
}
