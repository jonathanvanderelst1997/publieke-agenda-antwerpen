// Gedeelde hulp voor de fetchers. Alleen de fetchers en scripts/refresh-fetch.mjs gebruiken dit;
// niets hiervan draait in `npm run check`.
import fs from "node:fs";
import path from "node:path";

import { normalized, validateEventContract } from "./event-contract.mjs";
import { decodeEntities } from "./html-text.mjs";
import { ERROR_CODE_PATTERN, MAX_AGE_HOURS, SOURCE_DEFINITIONS, normalizeSourceItem, privacyFindings, sourceDocument, sourceFileName, validateSourceDocument, zonderRuweGipodBron } from "./source-feed.mjs";

export const USER_AGENT = "publieke-agenda-antwerpen/1.0 (+https://mijn-publieke-agenda-voor-district.onrender.com)";
export const REQUEST_TIMEOUT_MS = 20_000;

export class FetchError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}

// ---------- weigering aan de rand van de site ----------
// Sinds de nacht van 22 op 23-10-2026 weigert de rand van www.antwerpen.be (Akamai) elke klant die geen
// browser is: een 403 met de pagina "Access Denied" en een referentie op errors.edgesuite.net, ook voor
// robots.txt (op 29-10-2026 nog altijd zo). Een gewone browser komt er wel door. Dat is een keuze van de
// site, geen storing aan onze kant, en niets hier probeert er omheen te gaan: geen andere user-agent, geen
// omweg, geen herhaling. Wat wel: een eigen foutcode in plaats van http_403, zodat refresh-status.json zegt
// wat er gebeurt. De vorige data blijft staan zoals bij elke fout; sources:health meldt de bron als
// "geweigerd": een waarschuwing met uitleg, zolang die vorige data binnen maxAgeHours valt. Daarna is het
// wel een fout: dan verbergt de site haar items (sourceHealthOf hieronder). Toegang terug vraagt iets van
// de stad (de agenda toelaten, of de gegevens als open data), niet van deze code.
export const BRON_WEIGERT_CODE = "bron_weigert_automatisch";

export function isRandWeigering(status, body) {
  if (status !== 403) return false;
  const tekst = decodeEntities(String(body ?? "").slice(0, 4_000));
  return /<title>\s*Access Denied\s*<\/title>/i.test(tekst) && /errors\.edgesuite\.net|Reference\s*#\d/i.test(tekst);
}

// Ook met het voorvoegsel van een kanaal (stad-districten) of een fase van eBesluit (metFase).
export const isWeigeringCode = (errorCode) => String(errorCode ?? "").replace(/^(channel|search|detail)_/, "") === BRON_WEIGERT_CODE;

export async function fetchWithTimeout(fetchImpl, url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    // Alleen bij een 403 wordt het (kleine) antwoord gelezen, op een kopie: de aanroeper leest zelf verder.
    if (response?.status === 403 && typeof response.clone === "function") {
      let body = "";
      try {
        body = await response.clone().text();
      } catch {
        body = "";
      }
      if (isRandWeigering(403, body)) throw new FetchError(BRON_WEIGERT_CODE);
    }
    return response;
  } catch (error) {
    if (error instanceof FetchError) throw error;
    throw new FetchError(controller.signal.aborted ? "timeout" : "network_error", error?.message ?? String(error));
  } finally {
    clearTimeout(timer);
  }
}

// ---------- tijdsbudget per bron ----------
// Eén trage of hangende bron mag de hele verversing niet meer laten afbreken (de job heeft een harde
// grens van 20 minuten; dan gaat er niets door, ook niet de gezonde bronnen). Daarom krijgt elke
// fetcher een fetch die na zijn budget niets meer ophaalt: lopende verzoeken en bodies worden
// afgebroken met FetchError("source_timeout"), nieuwe verzoeken falen meteen. De fetcher valt dan in
// zijn gewone foutpad (vorige data blijft staan, fetchStatus "error"); geen enkele versheids- of
// validatieregel verandert.
export const SOURCE_TIMEOUT_CODE = "source_timeout";

function sourceTimeoutError() {
  return new FetchError(SOURCE_TIMEOUT_CODE, "bron overschreed haar tijdsbudget");
}

export function deadlineFetch(fetchImpl, signal) {
  const expired = new Promise((_, reject) => {
    if (signal.aborted) reject(sourceTimeoutError());
    else signal.addEventListener("abort", () => reject(sourceTimeoutError()), { once: true });
  });
  expired.catch(() => {});
  // Ook een fetch of body die het signaal negeert (testvervalsing, kapotte stream) houdt niets op.
  const guard = (promise) => Promise.race([promise, expired]).catch((error) => {
    if (signal.aborted) throw sourceTimeoutError();
    throw error;
  });
  const wrapBody = (response) => {
    if (!response || typeof response !== "object") return response;
    for (const method of ["text", "json", "arrayBuffer"]) {
      const original = response[method];
      if (typeof original !== "function") continue;
      try {
        response[method] = (...args) => guard(Promise.resolve().then(() => original.apply(response, args)));
      } catch {
        // Bevroren testantwoord: dan geldt alleen de grens op het verzoek zelf.
      }
    }
    return response;
  };
  return async (url, options = {}) => {
    if (signal.aborted) throw sourceTimeoutError();
    const combined = options?.signal ? AbortSignal.any([options.signal, signal]) : signal;
    const response = await guard(Promise.resolve().then(() => fetchImpl(url, { ...options, signal: combined })));
    return wrapBody(response);
  };
}

export function errorCodeOf(error) {
  const code = error instanceof FetchError ? error.code : "unexpected_error";
  return /^[a-z0-9_]{1,60}$/.test(code) ? code : "unexpected_error";
}

export function sourcePath(rootDir, sourceId) {
  return path.join(rootDir, "site", sourceFileName(sourceId));
}

export function readSourceDocument(rootDir, sourceId) {
  const file = sourcePath(rootDir, sourceId);
  if (!fs.existsSync(file)) return null;
  try {
    // Een GIPOD-bron van vóór 17 oktober 2026 (ruwe rij als bronlink) in de nieuwe vorm: zo blijven haar items
    // staan als de bron vandaag niet antwoordt, en schrijft keepPreviousOnError ze zonder ruwe rij weg.
    const { document } = zonderRuweGipodBron(JSON.parse(fs.readFileSync(file, "utf8")));
    return validateSourceDocument(document, { expectedSourceId: sourceId }).length ? null : document;
  } catch {
    return null;
  }
}

export function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

// Schrijft een brondocument alleen als het volledig geldig is. Geeft de geschreven items terug.
export function writeSourceDocument(rootDir, sourceId, document) {
  const errors = validateSourceDocument(document, { expectedSourceId: sourceId });
  if (errors.length) throw new FetchError("invalid_output", `brondocument ${sourceId} is ongeldig: ${errors.slice(0, 3).join("; ")}`);
  const file = sourcePath(rootDir, sourceId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = serialize(document);
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text) fs.writeFileSync(file, text, "utf8");
  return document;
}

// Houdt alleen items over die de privacyscan en het eventcontract doorstaan.
// Items die afvallen worden geteld, nooit weggeschreven.
// Het contract wordt per item gecontroleerd; de dubbelcontrole (duplicate_event) gebeurt met dezelfde
// handtekening als in lib/event-contract.mjs, zodat dit ook voor 1.500 UiT-items lineair blijft.
export function screenItems(items) {
  const passed = [];
  const rejected = { privacy: 0, contract: 0, duplicate: 0 };
  const seen = new Set();
  const signatures = new Set();
  for (const raw of items) {
    const item = normalizeSourceItem(raw);
    if (seen.has(item.id)) {
      rejected.duplicate += 1;
      continue;
    }
    if (privacyFindings(item).length) {
      rejected.privacy += 1;
      continue;
    }
    const contract = validateEventContract([item]);
    const event = contract.events[0];
    const signature = event ? [normalized(event.title), event.date, event.startTime || "unknown", normalized(event.location)].join("|") : null;
    if (!contract.ok || !signature || signatures.has(signature)) {
      rejected.contract += 1;
      continue;
    }
    seen.add(item.id);
    signatures.add(signature);
    passed.push(item);
  }
  return { items: passed, rejected };
}

export function statusEntry(sourceId, { fetchStatus, retrievedAt = null, itemCount = 0, errorCode = null, capped, coverageUntil }) {
  const definition = SOURCE_DEFINITIONS[sourceId];
  const entry = {
    sourceId,
    file: sourceFileName(sourceId),
    scope: definition.scope,
    fetchStatus,
    retrievedAt,
    maxAgeHours: MAX_AGE_HOURS,
    itemCount,
    errorCode,
  };
  // Alleen bij een bron die afkapt (UiT): zichtbaar in refresh-status.json.
  if (capped !== undefined) {
    entry.capped = capped === true;
    entry.coverageUntil = coverageUntil ?? null;
  }
  return entry;
}

// Een tijdelijke fout aan de kant van de bron of het netwerk: 5xx, 429, time-out, netwerkfout of
// het tijdsbudget. Dan is de bron niet stuk, alleen even onbereikbaar; de vorige data blijft staan.
// (Een kanaalfout van stad-districten heet channel_<code>; een fout van eBesluit draagt haar fase, search_<code> of
// detail_<code>, metFase in lib/ebesluit-discovery.mjs. Het voorvoegsel telt hier niet: search_http_500 is
// tijdelijk, search_incomplete niet.)
export function isTransientErrorCode(errorCode) {
  const code = String(errorCode ?? "").replace(/^(channel|search|detail)_/, "");
  return /^http_(5\d\d|429)$/.test(code)
    || ["timeout", "network_error", "source_timeout", "refresh_budget_exhausted", "body_read_failed"].includes(code);
}

// De gezondheid van één bron in refresh-status.json, op moment `at`:
// - "ok": vers opgehaald;
// - "stale": de laatste poging faalde TIJDELIJK (bv. een 503 van de districtsraad), de vorige data
//   blijft staan en valt nog binnen maxAgeHours. Een waarschuwing, geen fout: de verversing van de
//   andere bronnen gaat gewoon door en de run wordt er niet rood van;
// - "error": een blijvende fout (krimp, andere opmaak, ongeldige data), of een tijdelijke fout waarbij
//   de vorige data al ouder is dan maxAgeHours (dan zijn haar items ook van de site);
// - "expired": status ok maar ouder dan maxAgeHours;
// - "geweigerd": de site weigert automatische toegang (BRON_WEIGERT_CODE hierboven) en de vorige data valt
//   nog binnen maxAgeHours. Een waarschuwing, geen fout: geen verversing kan dit oplossen. Is de vorige data
//   te oud, dan is het "error", zoals bij een tijdelijke fout: de site verbergt dan de items van de bron, en
//   dat moet iemand zien. sources:health zegt in beide gevallen in één regel waarom, met de ouderdom erbij;
// - "inactive": uit, zonder sleutel of alleen test.
export function sourceHealthOf(entry, at = Date.now()) {
  if (["skipped_no_key", "disabled", "test_only"].includes(entry?.fetchStatus)) return "inactive";
  const retrievedMs = Date.parse(entry?.retrievedAt ?? "");
  const maxAgeHours = Number.isFinite(entry?.maxAgeHours) ? entry.maxAgeHours : 48;
  const withinAge = Number.isFinite(retrievedMs) && at <= retrievedMs + maxAgeHours * 3_600_000;
  if (entry?.fetchStatus === "error" && isWeigeringCode(entry.errorCode)) return withinAge ? "geweigerd" : "error";
  if (entry?.fetchStatus === "error") return isTransientErrorCode(entry.errorCode) && withinAge ? "stale" : "error";
  return withinAge ? "ok" : "expired";
}

// Bij een fout: vorige items en retrievedAt blijven, fetchStatus wordt "error". Het bronbestand zegt ook waarom en
// sinds wanneer: lastError { code, at } (de foutcode van deze poging en haar moment `at`, standaard nu) en
// lastSuccessAt (de laatste geslaagde verversing, gelijk aan de bewaarde retrievedAt). Zo staat de reden in de repo,
// ook als de logs van de verversing niet te lezen zijn. Alleen een vaste foutcode (errorCodeOf), nooit een URL of
// zoekterm. Intern: de feed draagt deze velden niet (scripts/build-sources.mjs) en de site toont ze nergens.
export function keepPreviousOnError(rootDir, sourceId, previous, errorCode, { dryRun = false, at = null } = {}) {
  const retrievedAt = previous?.retrievedAt ?? null;
  // De metadata van de fout mag het bewaren van de vorige items nooit doen mislukken.
  const moment = Number.isFinite(Date.parse(at ?? "")) ? new Date(Date.parse(at)).toISOString() : new Date().toISOString();
  const document = sourceDocument(sourceId, {
    retrievedAt,
    fetchStatus: "error",
    contentVersion: previous?.contentVersion ?? null,
    coverage: previous?.coverage ?? null,
    items: previous?.items ?? [],
    suppressions: previous?.suppressions ?? [],
    lastError: { code: ERROR_CODE_PATTERN.test(String(errorCode ?? "")) ? errorCode : "unexpected_error", at: moment },
    lastSuccessAt: retrievedAt,
  });
  if (!dryRun) writeSourceDocument(rootDir, sourceId, document);
  const coverage = document.coverage ? { capped: document.coverage.capped, coverageUntil: document.coverage.until } : {};
  return statusEntry(sourceId, { fetchStatus: "error", retrievedAt: document.retrievedAt, itemCount: document.items.length, errorCode, ...coverage });
}

export function isMainModule(importMetaUrl) {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(new URL(importMetaUrl).pathname) === fs.realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

export function upcomingCount(items, today) {
  return items.filter((item) => (item.endDate ?? item.date) >= today).length;
}

// ---------- krimpgrens ----------
// Een bron die wel antwoordt maar veel minder oplevert dan de vorige keer, is eerder stuk (andere
// opmaak, leeg kanaal) dan leeg. Vergeleken worden alleen items die vandaag nog lopen of komen, zodat
// items die gewoon voorbij zijn nooit als krimp tellen.
export const SHRINK_MIN_PREVIOUS = 4;
export const SHRINK_MAX_LOSS = 0.5;
export const ALLOW_DROP_ENV = "AGENDA_ALLOW_DROP";

// Geeft { before, after } terug als de daling verdacht is, anders null.
//   - 0 komende items terwijl de vorige versie er meer dan 0 had;
//   - of meer dan de helft minder komende items, als de vorige versie er minstens 4 had.
export function suspiciousDrop(previousItems, nextItems, today) {
  const before = upcomingCount(Array.isArray(previousItems) ? previousItems : [], today);
  if (before === 0) return null;
  const after = upcomingCount(Array.isArray(nextItems) ? nextItems : [], today);
  if (after === 0) return { before, after };
  if (before >= SHRINK_MIN_PREVIOUS && after < before * (1 - SHRINK_MAX_LOSS)) return { before, after };
  return null;
}

// Een bewuste, grote daling laat de eigenaar toe met AGENDA_ALLOW_DROP=<sourceId>[,<sourceId>…].
// De dagelijkse automatische ronde zet dit nooit.
export function dropAllowed(env, sourceId) {
  return String(env?.[ALLOW_DROP_ENV] ?? "")
    .split(",")
    .map((value) => value.trim())
    .includes(sourceId);
}

// Voor de fetchers: null als het nieuwe resultaat weggeschreven mag worden, anders een statusregel
// "error"/"suspicious_drop" waarbij de vorige data blijft staan.
export function guardShrink({ rootDir, sourceId, previous, items, today, env, log, counts = {} }) {
  const drop = previous ? suspiciousDrop(previous.items, items, today) : null;
  if (!drop) return null;
  if (dropAllowed(env, sourceId)) {
    log(JSON.stringify({ source: sourceId, dropAllowed: true, upcomingBefore: drop.before, upcomingAfter: drop.after }));
    return null;
  }
  log(JSON.stringify({ ...counts, source: sourceId, fetchStatus: "error", errorCode: "suspicious_drop", upcomingBefore: drop.before, upcomingAfter: drop.after }));
  return keepPreviousOnError(rootDir, sourceId, previous, "suspicious_drop");
}
