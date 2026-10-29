import {
  civicCalendarFromDecision,
  classifyCivicDecisionTitle,
  extractPdfAttachments,
  isDistrictAntwerpenDecision,
  normalizeDecisionTitle,
} from "./civic-decision.mjs";
import { zoekViaKalender } from "./ebesluit-kalender.mjs";
import { FetchError, SOURCE_TIMEOUT_CODE, USER_AGENT, errorCodeOf, fetchWithTimeout } from "./fetch-util.mjs";
import { brusselsDate } from "./html-text.mjs";

export const EBESLUIT_BASE = "https://ebesluit.antwerpen.be";
export const EBESLUIT_KEYWORDS = Object.freeze(["speelstraat", "kermis", "foor", "markt"]);
// eBesluit levert tot 500 rijen per pagina (getest oktober 2026); met 50 kostte alleen al het
// trefwoord "markt" (10.000+ treffers per jaar) honderden zoekpagina's.
export const EBESLUIT_PAGE_SIZE = 500;
export const EBESLUIT_MAX_PAGES = 20;
// Terugval bij een serverfout: blijft een zoekpagina van 500 rijen na de herkansing in getHtml een 5xx geven
// (eBesluit geeft sinds 13 oktober 2026 elke nacht HTTP 500, #180, #186; bij district-ebesluit-evenementen kan dat
// alleen het zoeken zijn, want daar vangt de detailronde haar eigen fouten op), dan wordt hetzelfde venster opnieuw
// doorzocht met pagina's van 100 en daarna 50 rijen. Elke poging blijft binnen EBESLUIT_MAX_PAGES pagina's
// (met kleinere pagina's past er dus minder in één venster en splitst het bestaande kwartaal-/maandpad sneller) en
// binnen het tijdsbudget van de bron (deadlineFetch). Pas als ook de kleinste pagina faalt, is het venster
// onvolledig (met de foutcode erbij); een onvolledige zoekronde wordt nooit als volledig aanvaard (#186).
export const EBESLUIT_FALLBACK_PAGE_SIZES = Object.freeze([100, 50]);
const PAGE_SIZES = Object.freeze([EBESLUIT_PAGE_SIZE, ...EBESLUIT_FALLBACK_PAGE_SIZES]);
const isServerError = (error) => error instanceof FetchError && /^http_5\d\d$/.test(error.code);

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

// ---------- negeert /zoeken het venster? ----------
// Sinds 26-10-2026 antwoordt /zoeken weer met HTTP 200, maar zonder het venster op zittingsdatum: een vraag naar
// "markt" in oktober 2026 gaf op 29-10-2026 "227.724 resultaten gevonden", met rijen uit 2008 tot 2013 bovenaan,
// en het formulier in het antwoord liet meetingDateStart en meetingDateEnd leeg (ook met dd/mm/jjjj, zoals het
// formulier van de site zelf). Elk venster meldt dan meer treffers dan het ooit kan doorlopen, het kwartaal- en
// maandpad splitst tot het niet meer kan, en de bron eindigde met search_incomplete of source_timeout.
// Dat valt op de eerste pagina al te zien: de rijen dragen hun zittingsdatum (<span class="date">dd/mm/jjjj …).
// Ligt van de rijen met een datum de meerderheid buiten het gevraagde venster (en minstens
// VENSTER_GENEGEERD_MIN_RIJEN), dan heeft eBesluit het venster genegeerd: de zoekfunctie is dan onbruikbaar
// (foutcode window_ignored, met fase search_window_ignored) en de bron zoekt via de kalender (searchKeyword).
// Een rij heeft soms twee datums (een schriftelijke vraag); ze telt pas als buiten als al haar datums buiten
// vallen. Eén afwijkende rij bewijst niets: een werkend venster geeft geen enkele rij erbuiten.
export const ZOEKEN_NEGEERT_VENSTER = "window_ignored";
export const VENSTER_GENEGEERD_MIN_RIJEN = 3;
export function vensterGenegeerd(html = "", start, end) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(start)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(end))) return false;
  let gedateerd = 0;
  let buiten = 0;
  for (const rij of String(html).matchAll(/<a[^>]*class="[^"]*result-row[^"]*"[^>]*>([\s\S]*?)<\/a>/g)) {
    const datums = [...rij[1].matchAll(/<span[^>]*class="[^"]*\bdate\b[^"]*"[^>]*>\s*(\d{2})\/(\d{2})\/(\d{4})/g)]
      .map((m) => `${m[3]}-${m[2]}-${m[1]}`);
    if (!datums.length) continue;
    gedateerd += 1;
    if (datums.every((datum) => datum < start || datum > end)) buiten += 1;
  }
  return buiten >= VENSTER_GENEGEERD_MIN_RIJEN && buiten * 2 > gedateerd;
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

// De fase waarin eBesluit faalde, vast in de foutcode: "search" (een zoekpagina) of "detail" (de detailpagina van een
// agendapunt). Vroeger zei http_500 bij district-ebesluit niet of het zoeken of een detailpagina faalde; nu staat er
// search_http_500 of detail_http_500, in lastError van het bronbestand, in refresh-status.json en in de bronstatus van
// de run. Alleen een vaste fase en de vaste foutcode, nooit een URL of zoekterm. Al met een fase (search_incomplete),
// of een code van het tijdsbudget van de run (source_timeout, refresh_budget_exhausted): ongewijzigd. Een andere
// fout dan FetchError blijft wat ze is (errorCodeOf maakt er unexpected_error van). isTransientErrorCode
// (lib/fetch-util.mjs) en de job source-health kijken door de fase heen: search_http_500 blijft tijdelijk.
export const EBESLUIT_FASEN = Object.freeze(["search", "detail"]);
const ZONDER_FASE = new Set(["source_timeout", "refresh_budget_exhausted"]);
export function metFase(fase, error) {
  if (!EBESLUIT_FASEN.includes(fase) || !(error instanceof FetchError)) return error;
  const code = String(error.code ?? "");
  if (ZONDER_FASE.has(code) || EBESLUIT_FASEN.some((f) => code.startsWith(`${f}_`))) return error;
  return new FetchError(`${fase}_${code}`);
}

export async function getHtml(fetchImpl, url, { retryDelayMs = 1_500, sleepImpl = sleep } = {}) {
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
  // Alleen eenmalig herkansen bij tijdelijke serverfouten. Een blijvende 500 blijft een bronfout; vorige geverifieerde data blijft behouden.
  if (!response.ok && [500, 502, 503, 504].includes(response.status)) {
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

// Eén venster met één paginagrootte. Een serverfout (5xx, ook na de herkansing in getHtml) geeft
// { serverError } terug in plaats van te gooien: dan probeert searchWindow een kleinere pagina.
async function searchWindowPaged(fetchImpl, keyword, start, end, pageSize, retryOptions) {
  const all = new Map();
  let complete = false;
  let pages = 0;
  let reportedTotal = null;
  for (let page = 0; page < EBESLUIT_MAX_PAGES; page += 1) {
    const url = new URL("/zoeken", EBESLUIT_BASE);
    url.search = new URLSearchParams({query:keyword,meetingDateStart:start,meetingDateEnd:end,page:String(page),pageSize:String(pageSize)});
    let html;
    try {
      html = await getHtml(fetchImpl, url.href, retryOptions);
    } catch (error) {
      if (isServerError(error)) return { rows: [], pages, complete: false, serverError: error.code };
      throw error;
    }
    pages += 1;
    // Negeert eBesluit het venster (vensterGenegeerd hierboven), dan helpt opsplitsen niet: elk kleiner venster
    // geeft dezelfde rijen. De zoekfunctie is dan onbruikbaar; searchKeyword zoekt verder via de kalender.
    if (page === 0 && vensterGenegeerd(html, start, end)) throw new FetchError(ZOEKEN_NEGEERT_VENSTER);
    // Meldt eBesluit al op de eerste pagina meer treffers dan dit venster ooit kan doorlopen, dan
    // is het venster onvolledig: meteen opsplitsen in plaats van eerst alle pagina's op te halen.
    if (page === 0) reportedTotal = resultCountFromSearch(html);
    if (reportedTotal !== null && reportedTotal > EBESLUIT_MAX_PAGES * pageSize) break;
    // Een eigen rijlezer (retryOptions.parseRows) mag meer uit dezelfde rij halen, zoals de zittingsdatum
    // (lib/ebesluit-evenementen.mjs); standaard blijft het rowsFromSearch.
    const rows = (retryOptions?.parseRows ?? rowsFromSearch)(html);
    if (!rows.length) {
      complete = reportedTotal === null || all.size === reportedTotal;
      break;
    }
    const before = all.size;
    for (const row of rows) all.set(`${row.meetingId}|${row.id}`, row);
    // Een herhaalde pagina is geen bewijs dat alles opgehaald is. Laat het bestaande
    // kwartaal-/maandpad onvolledige zoekvensters opnieuw en begrensd controleren.
    if (all.size === before) break;
    if (reportedTotal !== null) {
      if (all.size === reportedTotal) { complete = true; break; }
      if (all.size > reportedTotal) break; // teller en unieke resultaten spreken elkaar tegen
      // Een kleinere serverpagina kan nog gevolgd worden door meer resultaten.
    } else if (rows.length < pageSize) {
      complete = true;
      break;
    }
  }
  return { rows:[...all.values()], pages, complete };
}

// De gekozen paginagrootte voor één run van één bron: { from } is de index in [500, 100, 50] waar het volgende
// venster begint. Weigert eBesluit 500 rijen, dan begint elk volgend venster van die run (elke zoekterm, elk jaar)
// meteen bij 100: de geweigerde pagina van 500 wordt in die run niet opnieuw gevraagd (vroeger per zoekterm en per
// jaar opnieuw: 8 keer bij district-ebesluit, 6 keer bij de evenementen, en zo ging het tijdsbudget op). De keuze
// gaat alleen naar kleinere pagina's, nooit terug, en leeft alleen in het geheugen van die run: geen bestand, de
// volgende run begint weer bij 500.
// Hetzelfde object draagt de rest van de stand van die run (searchKeyword): `zoekenStuk`, de fout waarmee /zoeken
// onbruikbaar bleek (null zolang het werkt), en `kalender`, de pagina's die de kalenderroute al haalde. Ook die
// gelden voor alle zoektermen en jaren van één run van één bron, en de volgende run probeert /zoeken opnieuw.
export function pageSizeChoice() {
  return { from: 0, zoekenStuk: null, kalender: new Map() };
}
const fromIndex = (sizes) => (Number.isInteger(sizes?.from) && sizes.from >= 0 && sizes.from < PAGE_SIZES.length ? sizes.from : 0);

// Eén venster, met de terugval naar kleinere pagina's (EBESLUIT_FALLBACK_PAGE_SIZES). `sizes` (pageSizeChoice) hoort
// bij de hele run van één bron. Faalt ook de kleinste pagina, dan is het venster onvolledig met errorCode (bv.
// "http_500"); de rijen van een mislukte poging tellen niet.
async function searchWindow(fetchImpl, keyword, start, end, retryOptions, sizes = pageSizeChoice()) {
  let pages = 0;
  let errorCode = null;
  for (let index = fromIndex(sizes); index < PAGE_SIZES.length; index += 1) {
    const result = await searchWindowPaged(fetchImpl, keyword, start, end, PAGE_SIZES[index], retryOptions);
    pages += result.pages;
    if (!result.serverError) return { rows: result.rows, pages, complete: result.complete };
    errorCode = result.serverError;
    sizes.from = Math.min(index + 1, PAGE_SIZES.length - 1);
  }
  return { rows: [], pages, complete: false, errorCode };
}

// Het kleinste venster (een kalendermaand) faalde met een serverfout, ook met de kleinste pagina: de zoekronde
// kan niet meer volledig worden (fail-closed), dus stoppen met de foutcode in plaats van eBesluit verder te
// bevragen. De fetcher bewaart dan de vorige items met lastError (lib/fetch-util.mjs, keepPreviousOnError).
function stopOnServerError(window) {
  if (window.errorCode) throw new FetchError(window.errorCode);
}
const monthEnd=(year,month)=>new Date(Date.UTC(year,month,0)).getUTCDate();
const monthWindow=(year,month)=>[`${year}-${String(month).padStart(2,"0")}-01`,`${year}-${String(month).padStart(2,"0")}-${String(monthEnd(year,month)).padStart(2,"0")}`];
// Kalendermaanden binnen een venster van ISO-dagen: [[start, einde], ...], de randen ingekort.
export function monthWindowsBetween(start, end) {
  const out = [];
  let [year, month] = start.slice(0, 7).split("-").map(Number);
  for (let guard = 0; guard < 36; guard += 1) {
    const [first, last] = monthWindow(year, month);
    if (first > end) break;
    out.push([first < start ? start : first, last > end ? end : last]);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return out;
}

// Een eigen venster op zittingsdatum ({ start, end } als ISO-dagen) in plaats van een jaar. Te veel
// treffers voor één venster: per kalendermaand opnieuw, zoals bij een jaar per kwartaal en maand.
async function searchRange(fetchImpl, keyword, { start, end }, retryOptions, sizes) {
  const full = await searchWindow(fetchImpl, keyword, start, end, retryOptions, sizes);
  if (full.complete) return { rows: full.rows, coverage: { keyword, pages: full.pages, resultCount: full.rows.length, complete: true } };
  const all = new Map();
  let pages = full.pages, complete = true;
  for (const [from, to] of monthWindowsBetween(start, end)) {
    const part = await searchWindow(fetchImpl, keyword, from, to, retryOptions, sizes);
    stopOnServerError(part);
    pages += part.pages;
    complete = complete && part.complete;
    for (const row of part.rows) all.set(`${row.meetingId}|${row.id}`, row);
  }
  return { rows: [...all.values()], coverage: { keyword, pages, resultCount: all.size, complete } };
}

// ---------- terugval als /zoeken onbruikbaar is: de kalender ----------
// /zoeken gaf vanaf 13-10-2026 bij elke vraag HTTP 500 (ook zonder parameters en in een gewone browser), en negeert
// sinds 26-10-2026 het venster op zittingsdatum (vensterGenegeerd). De maandlijst en de zittingspagina's werkten in
// beide gevallen. Is /zoeken onbruikbaar, dan zoekt de bron via de kalender (lib/ebesluit-kalender.mjs), met dezelfde
// rijen. Onbruikbaar betekent: na de kleinere pagina's van #201 nog altijd een 5xx (search_http_5xx), of het venster
// genegeerd (search_window_ignored). Elke andere fout (een 404, het tijdsbudget, een onvolledige zoekronde) gaat niet
// langs de kalender en blijft wat ze was.
// Eén keer per run: de eerste zoekterm die het merkt, zet sizes.zoekenStuk; elke volgende zoekterm en elk volgend jaar
// van die run gaat meteen naar de kalender, zonder /zoeken nog te vragen. De pagina's van de kalender zitten in
// sizes.kalender, dus elke maandlijst en elke zitting wordt per run hoogstens één keer gehaald.
// Faalt ook de kalender, dan faalt de zoekterm met de fout van /zoeken, zoals voordien (fail-closed: de vorige data
// blijft staan); het tijdsbudget van de bron (source_timeout) blijft source_timeout.
const ZOEKEN_ONBRUIKBAAR = new RegExp(`^search_(?:http_5\\d\\d|${ZOEKEN_NEGEERT_VENSTER})$`);
export const zoekfunctieStuk = (error) => ZOEKEN_ONBRUIKBAAR.test(errorCodeOf(error));

// `year` is een jaartal, of een venster { start, end } (lib/ebesluit-evenementen.mjs). `sizes`: de stand van de
// hele run van de bron (pageSizeChoice), gedeeld over alle zoektermen en jaren; zonder: alleen voor deze term.
// Een fout bij het zoeken heet search_<code> (metFase). retryOptions.vandaag (ISO-dag, standaard vandaag in
// Brussel) begrenst de kalenderterugval: zittingen na vandaag + 14 dagen hebben nog geen agenda.
export async function searchKeyword(fetchImpl, keyword, year, retryOptions, sizes = pageSizeChoice()) {
  if (!sizes.zoekenStuk) {
    try {
      return await searchKeywordIn(fetchImpl, keyword, year, retryOptions, sizes);
    } catch (error) {
      const fout = metFase("search", error);
      if (!zoekfunctieStuk(fout)) throw fout;
      sizes.zoekenStuk = fout;
    }
  }
  if (!(sizes.kalender instanceof Map)) sizes.kalender = new Map();
  const venster = year && typeof year === "object" ? year : { start: `${year}-01-01`, end: `${year}-12-31` };
  try {
    const result = await zoekViaKalender({
      haal: (url) => getHtml(fetchImpl, url, retryOptions),
      trefwoord: keyword,
      start: venster.start,
      end: venster.end,
      vandaag: retryOptions?.vandaag ?? brusselsDate(new Date()),
      cache: sizes.kalender,
      pauze: retryOptions?.sleepImpl ?? sleep,
    });
    return { rows: result.rows, coverage: { keyword, pages: result.pages, resultCount: result.rows.length, complete: result.complete, route: "kalender" } };
  } catch (error) {
    if (errorCodeOf(error) === SOURCE_TIMEOUT_CODE) throw error;
    throw sizes.zoekenStuk;
  }
}
async function searchKeywordIn(fetchImpl, keyword, year, retryOptions, sizes) {
  if (year && typeof year === "object") return searchRange(fetchImpl, keyword, year, retryOptions, sizes);
  const full=await searchWindow(fetchImpl,keyword,`${year}-01-01`,`${year}-12-31`,retryOptions,sizes);
  if(full.complete)return{rows:full.rows,coverage:{keyword,pages:full.pages,resultCount:full.rows.length,complete:true}};
  const all=new Map(); let pages=full.pages,complete=true;
  for(let quarter=0;quarter<4;quarter+=1){
    const startMonth=quarter*3+1,[quarterStart]=monthWindow(year,startMonth),[,quarterEnd]=monthWindow(year,startMonth+2);
    const quarterly=await searchWindow(fetchImpl,keyword,quarterStart,quarterEnd,retryOptions,sizes);
    pages+=quarterly.pages;
    if(quarterly.complete){for(const row of quarterly.rows)all.set(`${row.meetingId}|${row.id}`,row);continue;}
    for(let month=startMonth;month<=startMonth+2;month+=1){
      const [start,end]=monthWindow(year,month),monthly=await searchWindow(fetchImpl,keyword,start,end,retryOptions,sizes);
      stopOnServerError(monthly);
      pages+=monthly.pages; complete=complete&&monthly.complete;
      for(const row of monthly.rows)all.set(`${row.meetingId}|${row.id}`,row);
    }
  }
  return{rows:[...all.values()],coverage:{keyword,pages,resultCount:all.size,complete}};
}

// `pageSizes` (pageSizeChoice): de stand van de hele run van district-ebesluit, over beide jaren
// (scripts/fetch-sources-ebesluit.mjs): de paginagrootte, of /zoeken onbruikbaar is, en de pagina's van de kalender.
// `vandaag` (ISO-dag): de grens van de kalenderterugval (searchKeyword); standaard vandaag in Brussel.
export async function discoverCivicDecisions({ fetch: fetchImpl = globalThis.fetch, year, retryDelayMs = 1_500, sleepImpl = sleep, pageSizes = pageSizeChoice(), vandaag } = {}) {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new FetchError("invalid_year");

  const rows = new Map();
  const coverage = [];

  for (const keyword of EBESLUIT_KEYWORDS) {
    const result = await searchKeyword(fetchImpl, keyword, year, { retryDelayMs, sleepImpl, ...(vandaag ? { vandaag } : {}) }, pageSizes);
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
    // Een fout op een detailpagina heet detail_<code> (metFase): niet te verwarren met een fout bij het zoeken.
    let markup;
    try {
      markup = await getHtml(fetchImpl, EBESLUIT_BASE + path, { retryDelayMs, sleepImpl });
    } catch (error) {
      throw metFase("detail", error);
    }
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
    // "kalender" als minstens één zoekterm via de kalender gezocht werd, anders "zoeken".
    route: coverage.some((entry) => entry.route === "kalender") ? "kalender" : "zoeken",
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
