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
// eBesluit levert tot 500 rijen per pagina (getest oktober 2026); met 50 kostte alleen al het
// trefwoord "markt" (10.000+ treffers per jaar) honderden zoekpagina's.
export const EBESLUIT_PAGE_SIZE = 500;
export const EBESLUIT_MAX_PAGES = 20;

function decode(value = "") {
  return String(value)
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .trim();
}

// Een zoekresultaat draagt naast de ids ook de titel en het orgaan van het agendapunt. Daarmee
// kan de detailronde de duizenden rijen die zeker niet over District Antwerpen-markten, -foren of
// -speelstraten gaan overslaan (zie needsDetail); de detailpagina beslist daarna zoals voorheen.
export function rowsFromSearch(html = "") {
  return [...String(html).matchAll(/<a[^>]*class="[^"]*result-row[^"]*"[^>]*>([\s\S]*?)<\/a>|<a[^>]*class="[^"]*result-row[^"]*"[^>]*>/g)]
    .map((match) => {
      const tag = match[0].slice(0, match[0].indexOf(">") + 1);
      const attrs = Object.fromEntries(
        [...tag.matchAll(/data-([\w-]+)="([^"]*)"/g)].map((entry) => [entry[1], decode(entry[2])])
      );
      const body = match[1] ?? "";
      const title = body.match(/<p[^>]*class="[^"]*\btitle\b[^"]*"[^>]*>([\s\S]*?)<\/p>/)?.[1];
      const organ = body.match(/<span[^>]*class="[^"]*\borgan\b[^"]*"[^>]*>([\s\S]*?)<\/span>/)?.[1];
      return attrs.id && attrs["meeting-id"]
        ? {
            id: attrs.id,
            meetingId: attrs["meeting-id"],
            published: attrs["content-published"] === "true",
            title: title === undefined ? null : textFromHtml(title),
            organ: organ === undefined ? null : textFromHtml(organ),
          }
        : null;
    })
    .filter(Boolean);
}

// Het totaal dat eBesluit boven de resultaten zet ("10.721 resultaten gevonden"), of null.
export function resultCountFromSearch(html = "") {
  const match = String(html).match(/class="[^"]*result-count[^"]*"[^>]*>\s*([\d.]+)\s+resultat/);
  if (!match) return null;
  const count = Number(match[1].replace(/\./g, ""));
  return Number.isSafeInteger(count) ? count : null;
}

// Moet de detailpagina van deze zoekrij opgehaald worden? Alleen nee als de zoekrij zelf al zeker
// zegt dat de detailronde haar zou laten vallen:
//   - de titel valt in classifyCivicDecisionTitle onder "other" (dezelfde regel als op de detailpagina);
//   - of het orgaan is een districtsorgaan van een ander district en de titel noemt District Antwerpen niet.
// Zonder titel of orgaan in de zoekrij (andere opmaak) wordt de detailpagina altijd opgehaald.
const OTHER_DISTRICT_ORGAN = /^(districtscollege|districtsraad|raadscommissie)\s+(?!antwerpen$)\S/i;
export function needsDetail(row) {
  if (!row || typeof row.title !== "string" || !row.title.trim()) return true;
  const title = normalizeDecisionTitle(row.title);
  if (classifyCivicDecisionTitle(title).category === "other") return false;
  const organ = normalizeDecisionTitle(row.organ ?? "");
  if (organ && OTHER_DISTRICT_ORGAN.test(organ) && !title.toLowerCase().includes("district antwerpen")) return false;
  return true;
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

const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));

async function getHtml(fetchImpl, url, { retryDelayMs = 1_500, sleepImpl = sleep } = {}) {
  let response = await fetchWithTimeout(
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
  if (!response.ok && response.status === 503) {
    await sleepImpl(retryDelayMs);
    response = await fetchWithTimeout(
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
  }
  if (!response.ok) throw new FetchError(`http_${response.status}`);
  return response.text();
}

async function searchWindow(fetchImpl, keyword, start, end, retryOptions) {
  const all = new Map();
  let complete = false;
  let pages = 0;
  for (let page = 0; page < EBESLUIT_MAX_PAGES; page += 1) {
    const url = new URL("/zoeken", EBESLUIT_BASE);
    url.search = new URLSearchParams({query:keyword,meetingDateStart:start,meetingDateEnd:end,page:String(page),pageSize:String(EBESLUIT_PAGE_SIZE)});
    const html = await getHtml(fetchImpl, url.href, retryOptions);
    pages += 1;
    // Meldt eBesluit al op de eerste pagina meer treffers dan dit venster ooit kan doorlopen, dan
    // is het venster onvolledig: meteen opsplitsen in plaats van eerst alle pagina's op te halen.
    const total = page === 0 ? resultCountFromSearch(html) : null;
    if (total !== null && total > EBESLUIT_MAX_PAGES * EBESLUIT_PAGE_SIZE) break;
    const rows = rowsFromSearch(html);
    if (!rows.length) { complete = true; break; }
    const before = all.size;
    for (const row of rows) all.set(`${row.meetingId}|${row.id}`, row);
    if (rows.length < EBESLUIT_PAGE_SIZE || all.size === before) { complete = true; break; }
  }
  return { rows:[...all.values()], pages, complete };
}
const monthEnd=(year,month)=>new Date(Date.UTC(year,month,0)).getUTCDate();
const monthWindow=(year,month)=>[`${year}-${String(month).padStart(2,"0")}-01`,`${year}-${String(month).padStart(2,"0")}-${String(monthEnd(year,month)).padStart(2,"0")}`];
export async function searchKeyword(fetchImpl, keyword, year, retryOptions) {
  const full=await searchWindow(fetchImpl,keyword,`${year}-01-01`,`${year}-12-31`,retryOptions);
  if(full.complete)return{rows:full.rows,coverage:{keyword,pages:full.pages,resultCount:full.rows.length,complete:true}};
  const all=new Map(); let pages=full.pages,complete=true;
  for(let quarter=0;quarter<4;quarter+=1){
    const startMonth=quarter*3+1,[quarterStart]=monthWindow(year,startMonth),[,quarterEnd]=monthWindow(year,startMonth+2);
    const quarterly=await searchWindow(fetchImpl,keyword,quarterStart,quarterEnd,retryOptions);
    pages+=quarterly.pages;
    if(quarterly.complete){for(const row of quarterly.rows)all.set(`${row.meetingId}|${row.id}`,row);continue;}
    for(let month=startMonth;month<=startMonth+2;month+=1){
      const [start,end]=monthWindow(year,month),monthly=await searchWindow(fetchImpl,keyword,start,end,retryOptions);
      pages+=monthly.pages; complete=complete&&monthly.complete;
      for(const row of monthly.rows)all.set(`${row.meetingId}|${row.id}`,row);
    }
  }
  return{rows:[...all.values()],coverage:{keyword,pages,resultCount:all.size,complete}};
}

export async function discoverCivicDecisions({ fetch: fetchImpl = globalThis.fetch, year, retryDelayMs = 1_500, sleepImpl = sleep } = {}) {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new FetchError("invalid_year");

  const rows = new Map();
  const coverage = [];

  for (const keyword of EBESLUIT_KEYWORDS) {
    const result = await searchKeyword(fetchImpl, keyword, year, { retryDelayMs, sleepImpl });
    coverage.push(result.coverage);
    for (const row of result.rows) {
      if (row.published) rows.set(`${row.meetingId}|${row.id}`, row);
    }
  }

  const calendarItems = [];
  const exceptions = [];
  const playStreetAttachments = [];
  const decisions = [];

  let skipped = 0;
  for (const row of rows.values()) {
    if (!needsDetail(row)) { skipped += 1; continue; }
    const path = `/zittingen/${row.meetingId}/agendapunten/${row.id}`;
    const markup = await getHtml(fetchImpl, EBESLUIT_BASE + path, { retryDelayMs, sleepImpl });
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
    detailPages: rows.size - skipped,
    skippedByTitle: skipped,
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
