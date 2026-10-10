// Foren en kermissen uit A-Sign, laag 0 ("foor"): één agendapunt per periode, niet per dag.
// Puur: geen klok (vandaag wordt meegegeven), geen netwerk.
//
// Velden: id, niveau, locatie, district, periode1-3, naam, begindatum, einddatum. Alleen die velden
// worden gelezen (ook als de laag ooit meer teruggeeft). De periodetekst gaat voor op de datumvelden:
// de stad houdt de tekst bij, de datumvelden lopen soms achter of zijn fout (de Winterkermis 2026 had
// einddatum 2026-01-03 voor "4 december – 3 januari"). Het jaar komt van begindatum en rolt door over
// de jaargrens (lib/periode-tekst.mjs).
import { addDaysIso, formatDutchDate } from "./html-text.mjs";
import { parsePeriodText } from "./periode-tekst.mjs";
import { locatieMetPostcode, zoekStraat } from "./straatnamen.mjs";

export const FOREN_LAYER_URL = "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/0";
export const FOREN_FIELDS = Object.freeze(["id", "niveau", "locatie", "district", "periode1", "periode2", "periode3", "naam", "begindatum", "einddatum"]);
export const FOREN_DISTRICT = "ANTWERPEN";
// Alleen foren die nog lopen of binnen dit aantal dagen beginnen.
export const FOREN_HORIZON_DAYS = 400;

export function forenQueryUrl() {
  const params = new URLSearchParams({ where: "1=1", outFields: FOREN_FIELDS.join(","), returnGeometry: "false", f: "json" });
  return `${FOREN_LAYER_URL}/query?${params}`;
}

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
// Een epoch in ms als dag. Buiten het bereik van Date (|ms| > 8.64e15) gooit toISOString() een
// RangeError; zo'n waarde, of een jaar buiten 0000-9999, geeft hier null.
const utcDate = (ms) => {
  if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) return null;
  const iso = new Date(ms).toISOString();
  return /^\d{4}-/.test(iso) ? iso.slice(0, 10) : null;
};
const slug = (value) => clean(value).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Alleen de toegelaten velden; al de rest (ook personeelsvelden) valt hier al weg.
export function forenRow(feature) {
  const attributes = feature?.attributes ?? {};
  return Object.fromEntries(FOREN_FIELDS.map((field) => [field, attributes[field] ?? null]));
}

// Kiest het jaar zodat de periode het dichtst bij `anchor` (begindatum) ligt.
function periodNear(text, anchor, fallbackYear) {
  if (!anchor) return parsePeriodText(text, { refYear: fallbackYear });
  const year = Number(anchor.slice(0, 4));
  let best = null;
  for (const refYear of [year - 1, year, year + 1]) {
    const period = parsePeriodText(text, { refYear });
    if (!period) continue;
    const distance = Math.abs(Date.parse(period.start) - Date.parse(anchor));
    if (!best || distance < best.distance) best = { ...period, distance };
  }
  if (!best) return null;
  const { distance, ...period } = best;
  return period;
}

// Alle perioden van één foor. Een latere periode begint nooit vóór de vorige.
export function forenPerioden(row, { today }) {
  const anchor = utcDate(row.begindatum);
  const fallbackYear = Number((anchor ?? today).slice(0, 4));
  const texts = [row.periode1, row.periode2, row.periode3].map(clean);
  const periods = [];
  const issues = [];
  texts.forEach((text, index) => {
    if (!text || /^none$/i.test(text)) return;
    const previous = periods.at(-1);
    let period = null;
    if (previous) {
      // De eerste lezing die niet vóór de vorige periode begint.
      const year = Number(previous.start.slice(0, 4));
      period = [year, year + 1].map((refYear) => parsePeriodText(text, { refYear })).find((candidate) => candidate && candidate.start >= previous.start) ?? null;
    } else {
      period = periodNear(text, anchor, fallbackYear);
    }
    if (!period) {
      issues.push({ code: "periode_onleesbaar", periode: index + 1 });
      return;
    }
    periods.push({ ...period, index: index + 1, text });
  });
  if (!periods.length && !issues.length) {
    // Geen periodetekst: dan de datumvelden, als ze kloppen.
    const end = utcDate(row.einddatum);
    if (anchor && end && end >= anchor) periods.push({ start: anchor, end, exact: true, index: 1, text: "" });
    else issues.push({ code: "geen_periode" });
  }
  // Wijkt de tekst af van de datumvelden, dan tellen we dat (alleen ter info; de tekst wint).
  const fieldEnd = utcDate(row.einddatum);
  if (periods[0] && anchor && (periods[0].start !== anchor || (fieldEnd && periods[0].end !== fieldEnd))) {
    issues.push({ code: "datumvelden_wijken_af", periode: 1 });
  }
  return { periods, issues };
}

function niveauTekst(niveau) {
  return /bovenlokaal/i.test(clean(niveau)) ? "Grote foor (bovenlokaal)" : "Lokale foor";
}

// Geeft { items, counts } terug. `streets` is een index uit lib/straatnamen.mjs (mag leeg zijn).
export function forenItems(features, { today, streets = new Map() }) {
  const counts = { rows: 0, district: 0, periods: 0, items: 0, past: 0, beyondHorizon: 0, issues: {} };
  const items = [];
  const horizon = addDaysIso(today, FOREN_HORIZON_DAYS);
  for (const feature of Array.isArray(features) ? features : []) {
    counts.rows += 1;
    const row = forenRow(feature);
    if (clean(row.district).toUpperCase() !== FOREN_DISTRICT) continue;
    counts.district += 1;
    const naam = clean(row.naam);
    const externalId = clean(row.id);
    if (!naam || !/^[A-Za-z0-9-]{1,40}$/.test(externalId)) {
      counts.issues.ongeldige_rij = (counts.issues.ongeldige_rij ?? 0) + 1;
      continue;
    }
    const plek = zoekStraat(row.locatie, streets);
    const { periods, issues } = forenPerioden(row, { today });
    for (const issue of issues) counts.issues[issue.code] = (counts.issues[issue.code] ?? 0) + 1;
    for (const period of periods) {
      counts.periods += 1;
      if (period.end < today) {
        counts.past += 1;
        continue;
      }
      if (period.start > horizon) {
        counts.beyondHorizon += 1;
        continue;
      }
      const titel = `${naam} ${plek.naam}`.slice(0, 200);
      items.push({
        id: `foor-${slug(externalId)}-${period.start}`,
        externalId: period.index > 1 ? `${externalId}-p${period.index}` : externalId,
        title: titel,
        theme: "Activiteit",
        className: "activity",
        date: period.start,
        endDate: period.end > period.start ? period.end : null,
        timeSlot: "Info",
        timeText: "",
        location: locatieMetPostcode(plek.naam, plek.postcodes),
        postcodes: plek.postcodes,
        info: `${niveauTekst(row.niveau)} op ${plek.naam}, van ${formatDutchDate(period.start)} tot en met ${formatDutchDate(period.end)}. Periode volgens de foorlijst van stad Antwerpen (A-Sign).`,
        kind: "activity",
        sourceUrl: FOREN_LAYER_URL,
        retrievedAt: null,
        reviewRequired: false,
        inDistrict: true,
      });
    }
  }
  counts.items = items.length;
  return { items, counts };
}
