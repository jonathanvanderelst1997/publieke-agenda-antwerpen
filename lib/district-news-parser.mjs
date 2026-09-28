// Haalt data uit nieuwsartikels van district Antwerpen. Heel conservatief: een datum telt alleen
// uit een tabel (kolommen datum/uur/locatie) of uit een regel die begint met "Wanneer:",
// "Datum:" of een blok "Praktisch". Elke dubbelzinnigheid betekent: niet publiceren.
// Puur: geen klok (vandaag wordt meegegeven), geen netwerk. Personeelsvelden uit het CMS
// (creator, assignee, lockOwner …) worden nooit gelezen.
import { cleanText, decodeEntities, stripEmails, stripTags, brusselsDate } from "./html-text.mjs";
import { classNameForTheme, parseDatePart, parseTimePart, splitDateTime, themeFor } from "./district-parser.mjs";
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
export function collectCandidates(article, refDate) {
  const candidates = [];
  for (const snippet of article?.snippets ?? []) {
    if (snippet?.type === "table") {
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

// Resultaat: { items, reviewItems, reason } — reason is null als er iets gepubliceerd kan worden.
export function parseDistrictNewsArticle(article, { today }) {
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

  const candidates = collectCandidates(article, refDate);
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
  if (!byDate.size) return { ...empty("outside_publication_window"), dropped };

  const lead = leadText(article);
  const items = [];
  const reviewItems = [];
  for (const occurrence of [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))) {
    const theme = occurrence.deadline ? "Oproep/deadline" : themeFor(title, lead);
    const item = {
      id: `district-news-${String(article.id ?? article.uuid).toLowerCase()}-${occurrence.date}`,
      externalId: String(article.id ?? article.uuid).toLowerCase(),
      title,
      theme,
      className: classNameForTheme(theme),
      date: occurrence.date,
      endDate: occurrence.endDate ?? null,
      timeSlot: occurrence.time.timeSlot,
      timeText: occurrence.time.timeText,
      location: occurrence.location,
      postcodes: postcodesInText(occurrence.location),
      info: lead,
      kind: occurrence.deadline ? "deadline" : "activity",
      sourceUrl,
      retrievedAt: null,
      reviewRequired: Boolean(occurrence.review) || !occurrence.location,
    };
    (item.reviewRequired ? reviewItems : items).push(item);
  }
  return { items, reviewItems, reason: items.length ? null : "review_required", dropped };
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
