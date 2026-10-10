// Schoolstraten van district Antwerpen uit de stadslaag portal_publiek10/MapServer/986.
// Puur: geen klok (vandaag wordt meegegeven), geen netwerk.
//
// Per schoolstraat komen er agendapunten (thema Werken, zodat ze bij "Werken & verkeer" staan en de
// straatfiche ze bij die straat toont):
//   - "Schoolstraat <straat>": loopt het lopende schooljaar (1 september tot 30 juni; in juli en
//     augustus het volgende), met de venstertijden per weekdag. Zo staat de schoolstraat in de
//     straatfiche zolang ze geldt;
//   - "Start proef schoolstraat <straat>": op de dag dat een proefopstelling begint;
//   - "Schoolstraat <straat> wordt definitief": op de dag dat ze definitief wordt.
// Alleen de velden hieronder worden gelezen; de schoolnaam is een instelling, geen persoon.
import { formatDutchDate } from "./html-text.mjs";
import { locatieMetPostcode, zoekStraat } from "./straatnamen.mjs";

export const SCHOOLSTRATEN_LAYER_URL = "https://geodata.antwerpen.be/arcgissql/rest/services/P_Portal/portal_publiek10/MapServer/986";
export const WEEKDAGEN = Object.freeze([
  ["maandag", "ma"],
  ["dinsdag", "di"],
  ["woensdag", "wo"],
  ["donderdag", "do"],
  ["vrijdag", "vr"],
]);
export const SCHOOLSTRATEN_FIELDS = Object.freeze([
  "OBJECTID", "SCHOOL", "STRAAT", "DISTRICT", "STATUS", "INREGELING", "AFSLUITING", "PROEFOPSTELLING_DATUM", "DEFINITIEF_DATUM", "GISID",
  ...WEEKDAGEN.map(([dag]) => `Venstertijden_${dag}`),
]);
export const SCHOOLSTRATEN_DISTRICT = "ANTWERPEN";

export function schoolstratenQueryUrl() {
  const params = new URLSearchParams({ where: "1=1", outFields: SCHOOLSTRATEN_FIELDS.join(","), returnGeometry: "false", f: "json" });
  return `${SCHOOLSTRATEN_LAYER_URL}/query?${params}`;
}

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
// Een epoch in ms als dag. Buiten het bereik van Date (|ms| > 8.64e15) gooit toISOString() een
// RangeError; zo'n waarde, of een jaar buiten 0000-9999, geeft hier null.
const utcDate = (ms) => {
  if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) return null;
  const iso = new Date(ms).toISOString();
  return /^\d{4}-/.test(iso) ? iso.slice(0, 10) : null;
};
const slug = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function schoolstraatRow(feature) {
  const attributes = feature?.attributes ?? {};
  return Object.fromEntries(SCHOOLSTRATEN_FIELDS.map((field) => [field, attributes[field] ?? null]));
}

// "8:00u-8:15u | 8:50u-9:05u" -> [["8.00","8.15"],["8.50","9.05"]]. Onleesbaar geeft null.
export function parseVenstertijden(value) {
  const text = clean(value);
  if (!text) return [];
  const windows = [];
  for (const part of text.split(/\s*(?:\||;|\/|,|\ben\b)\s*/i).filter(Boolean)) {
    const match = /^(\d{1,2})[:.h](\d{2})\s*u?\s*(?:-|–|tot)\s*(\d{1,2})[:.h](\d{2})\s*u?(?:ur)?$/i.exec(part.trim());
    if (!match) return null;
    const [, h1, m1, h2, m2] = match.map(Number);
    if ([h1, h2].some((h) => h > 23) || [m1, m2].some((m) => m > 59) || h2 * 60 + m2 <= h1 * 60 + m1) return null;
    windows.push([`${h1}.${String(m1).padStart(2, "0")}`, `${h2}.${String(m2).padStart(2, "0")}`]);
  }
  return windows;
}

// Weekdagen met dezelfde vensters samen: "ma, di, do, vr 8.00-8.15 en 15.10-15.25; wo 8.00-8.15 en 11.50-12.05".
export function venstertijdenTekst(row) {
  const groups = [];
  let unreadable = false;
  for (const [dag, kort] of WEEKDAGEN) {
    const windows = parseVenstertijden(row[`Venstertijden_${dag}`]);
    if (windows === null) {
      unreadable = true;
      continue;
    }
    if (!windows.length) continue;
    const parts = windows.map((window) => window.join("-"));
    const key = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} en ${parts.at(-1)}` : parts[0];
    const group = groups.find((entry) => entry.key === key);
    if (group) group.days.push(kort);
    else groups.push({ key, days: [kort] });
  }
  return { text: groups.map((group) => `${group.days.join(", ")} ${group.key}`).join("; "), unreadable };
}

// Het schooljaar waarin `today` valt; in juli en augustus het volgende.
export function schooljaar(today) {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const first = month >= 7 ? year : year - 1;
  return { start: `${first}-09-01`, end: `${first + 1}-06-30`, label: first };
}

function baseItem(row, plek, overrides) {
  return {
    theme: "Werken",
    className: "works",
    endDate: null,
    timeSlot: "Info",
    location: locatieMetPostcode(plek.naam, plek.postcodes),
    postcodes: plek.postcodes,
    kind: "activity",
    sourceUrl: SCHOOLSTRATEN_LAYER_URL,
    retrievedAt: null,
    reviewRequired: false,
    inDistrict: true,
    ...overrides,
  };
}

// Geeft { items, counts }. `streets` is een index uit lib/straatnamen.mjs (mag leeg zijn).
export function schoolstraatItems(features, { today, streets = new Map() }) {
  const counts = { rows: 0, district: 0, items: 0, proefStart: 0, definitief: 0, issues: {} };
  const note = (code) => { counts.issues[code] = (counts.issues[code] ?? 0) + 1; };
  const items = [];
  const jaar = schooljaar(today);
  for (const feature of Array.isArray(features) ? features : []) {
    counts.rows += 1;
    const row = schoolstraatRow(feature);
    if (clean(row.DISTRICT).toUpperCase() !== SCHOOLSTRATEN_DISTRICT) continue;
    counts.district += 1;
    const gisId = clean(row.GISID);
    const status = clean(row.STATUS).toLowerCase();
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(gisId) || !clean(row.STRAAT)) {
      note("ongeldige_rij");
      continue;
    }
    if (!["definitief", "proefopstelling"].includes(status)) {
      note("andere_status");
      continue;
    }
    const plek = zoekStraat(row.STRAAT, streets);
    if (!plek.gevonden) note("straat_niet_in_index");
    const school = clean(row.SCHOOL).slice(0, 120);
    const afsluiting = clean(row.AFSLUITING).toLowerCase().slice(0, 60);
    const vensters = venstertijdenTekst(row);
    if (vensters.unreadable) note("venstertijden_onleesbaar");
    const proef = utcDate(row.PROEFOPSTELLING_DATUM);
    const definitief = utcDate(row.DEFINITIEF_DATUM);
    const sinds = status === "definitief"
      ? (definitief ? `Definitief sinds ${formatDutchDate(definitief)}.` : "Definitief.")
      : (proef ? `Proefopstelling sinds ${formatDutchDate(proef)}.` : "Proefopstelling.");
    const begin = [proef, definitief].filter(Boolean).sort()[0] ?? null;
    const id = slug(gisId);

    // 1. De straatfiche: de schoolstraat geldt het hele schooljaar.
    const date = begin && begin > jaar.start ? begin : jaar.start;
    if (date <= jaar.end) {
      const info = [
        `Schoolstraat${school ? ` aan ${school}` : ""}: op schooldagen is de straat tijdens de venstertijden dicht voor gemotoriseerd verkeer${afsluiting ? ` (afsluiting met ${afsluiting})` : ""}.`,
        vensters.text ? `Venstertijden: ${vensters.text}.` : "Venstertijden via de bron.",
        sinds,
      ].join(" ");
      items.push(baseItem(row, plek, {
        id: `schoolstraat-${id}-${jaar.label}`,
        externalId: gisId,
        title: `Schoolstraat ${plek.naam}`.slice(0, 200),
        date,
        endDate: jaar.end,
        timeText: (vensters.text ? `op schooldagen: ${vensters.text}` : "op schooldagen, venstertijden via de bron").slice(0, 200),
        info: info.slice(0, 600),
      }));
    }
    // 2. De start van een proef en 3. de dag dat ze definitief wordt, als agendapunt.
    if (status === "proefopstelling" && proef && proef >= today) {
      counts.proefStart += 1;
      items.push(baseItem(row, plek, {
        id: `schoolstraat-start-${id}-${proef}`,
        externalId: `${gisId}-proef`,
        title: `Start proef schoolstraat ${plek.naam}`.slice(0, 200),
        date: proef,
        timeText: "",
        info: `De proefopstelling van de schoolstraat${school ? ` aan ${school}` : ""} begint. ${vensters.text ? `Venstertijden: ${vensters.text}.` : ""}`.trim().slice(0, 600),
      }));
    }
    if (definitief && definitief >= today) {
      counts.definitief += 1;
      items.push(baseItem(row, plek, {
        id: `schoolstraat-definitief-${id}-${definitief}`,
        externalId: `${gisId}-definitief`,
        title: `Schoolstraat ${plek.naam} wordt definitief`.slice(0, 200),
        date: definitief,
        timeText: "",
        info: `De schoolstraat${school ? ` aan ${school}` : ""} wordt definitief.`,
      }));
    }
  }
  counts.items = items.length;
  return { items, counts };
}
