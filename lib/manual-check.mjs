// Handmatige items zijn alleen een overbrugging. Elk zichtbaar handmatig item heeft een officiële
// bron-URL, en die wordt bij elke verversing automatisch nagekeken: is de pagina nog bereikbaar, en
// staan de datum en de kernwoorden er nog op? Zo hoeft niemand een handmatig item met de hand te
// herbevestigen, en blijft een gewijzigd of verdwenen item niet stil op de site staan.
//
// Uitkomst per bron (site/sources/manual-check.json):
//   ok                  pagina 200 en alle controlewoorden staan erop;
//   gewijzigd           pagina 200, maar een controlewoord (datum of titel) ontbreekt;
//   weg                 404 of 410;
//   onbereikbaar        5xx, 429, time-out, netwerk of een andere status (tijdelijk; item blijft);
//   niet_controleerbaar de bron noemt geen controlewoorden en het item heeft geen datum om te zoeken.
// "gewijzigd" en "weg" halen het item van de site (review_required) en worden gemeld: in de job
// source-health van refresh.yml en in brain_status van de Gateway. De controlewoorden zijn publieke
// woorden van de officiële pagina; mailinhoud of persoonsgegevens horen hier nooit.

export const MANUAL_CHECK_FILE = "manual-check.json";
export const MANUAL_CHECK_STATUSES = Object.freeze(["ok", "gewijzigd", "weg", "onbereikbaar", "niet_controleerbaar"]);
export const MANUAL_CHECK_HIDES = Object.freeze(["gewijzigd", "weg"]);
const MONTHS = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];

export function normalizeText(value) {
  return String(value ?? "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&#8211;|&ndash;/gi, "-")
    .replace(/&euml;/gi, "ë")
    .replace(/&eacute;/gi, "é")
    .replace(/&amp;/gi, "&")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function pageText(html) {
  return normalizeText(
    String(html ?? "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

// "2026-10-10" -> "10 oktober": zo staat een datum op bijna elke Nederlandstalige pagina.
export function datePhrase(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate ?? ""));
  if (!match) return null;
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]}`;
}

// Welke bronnen nagekeken worden: die van elk zichtbaar (current/future, verified) handmatig item.
// Controlewoorden: de begindatum van elk item ("10 oktober"), plus `check.mustContain` van de bron
// (bv. een titelwoord als "buurtfeest"). `check: false` zegt uitdrukkelijk: deze pagina bevestigt het
// item niet woordelijk; dan is de uitkomst "niet_controleerbaar" en wordt dat gemeld.
export function manualCheckTargets(publicItems, sources) {
  const targets = new Map();
  for (const item of publicItems) {
    if (item.feed) continue;
    const source = sources[item.sourceId];
    if (!source || !/^https:\/\//.test(source.url ?? "")) continue;
    const target = targets.get(item.sourceId) ?? { sourceId: item.sourceId, url: source.url, phrases: new Set(), items: [] };
    target.items.push(item.id);
    if (source.check !== false) {
      const phrase = datePhrase(item.date);
      if (phrase) target.phrases.add(phrase);
      for (const extra of Array.isArray(source.check?.mustContain) ? source.check.mustContain : []) target.phrases.add(String(extra));
    }
    targets.set(item.sourceId, target);
  }
  return [...targets.values()]
    .map((target) => ({ ...target, phrases: [...target.phrases].sort(), items: target.items.sort() }))
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId));
}

// Beoordeelt één antwoord. `httpStatus` null = geen antwoord (time-out, netwerk).
export function judgePage({ httpStatus, html, phrases }) {
  if (httpStatus === 404 || httpStatus === 410) return { status: "weg", missing: [] };
  if (httpStatus !== 200) return { status: "onbereikbaar", missing: [] };
  if (!phrases.length) return { status: "niet_controleerbaar", missing: [] };
  const text = pageText(html);
  const missing = phrases.filter((phrase) => !text.includes(normalizeText(phrase)));
  return { status: missing.length ? "gewijzigd" : "ok", missing };
}

// `since`: sinds wanneer de bron in deze (niet-ok) toestand staat; blijft over rondes heen staan.
export function nextEntry(previous, target, judged, checkedAt) {
  const same = previous && previous.status === judged.status;
  return {
    sourceId: target.sourceId,
    url: target.url,
    status: judged.status,
    httpStatus: judged.httpStatus ?? null,
    missing: judged.missing,
    items: target.items,
    since: judged.status === "ok" ? null : same && previous.since ? previous.since : checkedAt,
  };
}

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function validateManualCheck(json) {
  const errors = [];
  if (!json || typeof json !== "object" || Array.isArray(json)) return ["geen object"];
  if (json.schemaVersion !== 1) errors.push("schemaVersion moet 1 zijn");
  if (!Number.isFinite(Date.parse(json.checkedAt ?? ""))) errors.push("checkedAt ongeldig");
  if (!Array.isArray(json.sources) || json.sources.length > 200) return [...errors, "sources ongeldig"];
  const keys = ["sourceId", "url", "status", "httpStatus", "missing", "items", "since"];
  json.sources.forEach((entry, index) => {
    const at = `sources[${index}]`;
    if (!entry || typeof entry !== "object") return errors.push(`${at}: geen object`);
    for (const key of Object.keys(entry)) if (!keys.includes(key)) errors.push(`${at}: onverwachte sleutel ${key}`);
    if (!ID.test(entry.sourceId ?? "")) errors.push(`${at}: sourceId ongeldig`);
    try {
      const url = new URL(entry.url);
      if (url.protocol !== "https:" || url.search || url.hash) errors.push(`${at}: url moet https zijn zonder query`);
    } catch {
      errors.push(`${at}: url ongeldig`);
    }
    if (!MANUAL_CHECK_STATUSES.includes(entry.status)) errors.push(`${at}: status ongeldig`);
    if (entry.httpStatus !== null && !Number.isInteger(entry.httpStatus)) errors.push(`${at}: httpStatus ongeldig`);
    if (!Array.isArray(entry.missing) || entry.missing.some((phrase) => typeof phrase !== "string" || phrase.length > 120 || phrase.includes("@"))) {
      errors.push(`${at}: missing ongeldig`);
    }
    if (!Array.isArray(entry.items) || entry.items.some((id) => !ID.test(String(id)))) errors.push(`${at}: items ongeldig`);
    if (entry.since !== null && !Number.isFinite(Date.parse(entry.since))) errors.push(`${at}: since ongeldig`);
  });
  return errors;
}

// Wat de site nodig heeft: per bron de status en sinds wanneer.
export function manualCheckForFeed(json) {
  if (!json) return null;
  return {
    checkedAt: json.checkedAt,
    sources: Object.fromEntries(json.sources.map((entry) => [entry.sourceId, { status: entry.status, since: entry.since }])),
  };
}
