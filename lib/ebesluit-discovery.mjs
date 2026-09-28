import {
  civicCalendarFromDecision,
  classifyCivicDecisionTitle,
  extractPdfAttachments,
  isDistrictAntwerpenDecision,
  normalizeDecisionTitle,
} from "./civic-decision.mjs";
import { FetchError, USER_AGENT, fetchWithTimeout } from "./fetch-util.mjs";

export const EBESLUIT_BASE = "https://ebesluit.antwerpen.be";
export const EBESLUIT_KEYWORDS = Object.freeze(["speelstraat", "kermis", "foor", "markt"]);
export const EBESLUIT_PAGE_SIZE = 50;
export const EBESLUIT_MAX_PAGES = 20;

function decode(value = "") {
  return String(value)
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .trim();
}

export function rowsFromSearch(html = "") {
  return [...String(html).matchAll(/<a[^>]*class="[^"]*result-row[^"]*"[^>]*>/g)]
    .map((match) => {
      const attrs = Object.fromEntries(
        [...match[0].matchAll(/data-([\w-]+)="([^"]*)"/g)].map((entry) => [entry[1], decode(entry[2])])
      );
      return attrs.id && attrs["meeting-id"]
        ? {
            id: attrs.id,
            meetingId: attrs["meeting-id"],
            published: attrs["content-published"] === "true",
          }
        : null;
    })
    .filter(Boolean);
}

export function textFromHtml(html = "") {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function decisionFromText(text = "") {
  const match = String(text).match(
    /Besluit (20\d\d_[A-Z]{2,8}_\d+) - ([\s\S]*?) (?:college van burgemeester en schepenen|gemeenteraad|districtscollege|districtsraad)/i
  );
  if (!match) return null;
  const code = match[1];
  const title = normalizeDecisionTitle(match[2]);
  return { code, title, ...classifyCivicDecisionTitle(title) };
}

async function getHtml(fetchImpl, url) {
  const response = await fetchWithTimeout(
    fetchImpl,
    url,
    {
      redirect: "error",
      headers: {
        "user-agent": USER_AGENT,
        Referer: `${EBESLUIT_BASE}/`,
        Accept: "text/html",
      },
    },
    30_000
  );
  if (!response.ok) throw new FetchError(`http_${response.status}`);
  return response.text();
}

async function searchKeyword(fetchImpl, keyword, year) {
  const all = new Map();
  let complete = false;
  let pages = 0;

  for (let page = 0; page < EBESLUIT_MAX_PAGES; page += 1) {
    const url = new URL("/zoeken", EBESLUIT_BASE);
    url.search = new URLSearchParams({
      query: keyword,
      meetingDateStart: `${year}-01-01`,
      meetingDateEnd: `${year}-12-31`,
      page: String(page),
      pageSize: String(EBESLUIT_PAGE_SIZE),
    });

    const rows = rowsFromSearch(await getHtml(fetchImpl, url.href));
    pages += 1;
    if (!rows.length) {
      complete = true;
      break;
    }

    const before = all.size;
    for (const row of rows) all.set(`${row.meetingId}|${row.id}`, row);
    if (rows.length < EBESLUIT_PAGE_SIZE || all.size === before) {
      complete = true;
      break;
    }
  }

  return {
    rows: [...all.values()],
    coverage: { keyword, pages, resultCount: all.size, complete },
  };
}

export async function discoverCivicDecisions({ fetch: fetchImpl = globalThis.fetch, year } = {}) {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new FetchError("invalid_year");

  const rows = new Map();
  const coverage = [];

  for (const keyword of EBESLUIT_KEYWORDS) {
    const result = await searchKeyword(fetchImpl, keyword, year);
    coverage.push(result.coverage);
    for (const row of result.rows) {
      if (row.published) rows.set(`${row.meetingId}|${row.id}`, row);
    }
  }

  const calendarItems = [];
  const exceptions = [];
  const playStreetAttachments = [];
  const decisions = [];

  for (const row of rows.values()) {
    const path = `/zittingen/${row.meetingId}/agendapunten/${row.id}`;
    const markup = await getHtml(fetchImpl, EBESLUIT_BASE + path);
    const text = textFromHtml(markup);
    const detail = decisionFromText(text);
    if (!detail || !isDistrictAntwerpenDecision(text, detail.title)) continue;

    const sourceUrl = EBESLUIT_BASE + path;
    const attachments = extractPdfAttachments(markup, EBESLUIT_BASE);
    const calendar = civicCalendarFromDecision({ ...detail, text, url: sourceUrl });

    calendarItems.push(...calendar.calendarItems);
    exceptions.push(...calendar.exceptions);

    if (detail.category === "play_street_approval" && attachments.length) {
      playStreetAttachments.push({ decisionCode: detail.code, sourceUrl, attachments });
    }

    if (detail.category !== "other") {
      decisions.push({
        code: detail.code,
        category: detail.category,
        publishCandidate: detail.publishCandidate,
        sourceUrl,
      });
    }
  }

  const dedupe = (items, key) => [...new Map(items.map((item) => [key(item), item])).values()];

  return {
    year,
    coverage,
    complete: coverage.every((entry) => entry.complete),
    decisions: dedupe(decisions, (item) => item.code).sort((a, b) => a.code.localeCompare(b.code)),
    calendarItems: dedupe(
      calendarItems,
      (item) => [item.category, item.location, item.start, item.end, item.decisionCode].join("|")
    ).sort((a, b) => a.start.localeCompare(b.start) || a.location.localeCompare(b.location, "nl")),
    exceptions: dedupe(
      exceptions,
      (item) => [item.category, item.location, item.date, item.decisionCode].join("|")
    ).sort((a, b) => a.date.localeCompare(b.date) || a.location.localeCompare(b.location, "nl")),
    playStreetAttachments: dedupe(playStreetAttachments, (item) => item.decisionCode).sort((a, b) =>
      a.decisionCode.localeCompare(b.decisionCode)
    ),
  };
}
