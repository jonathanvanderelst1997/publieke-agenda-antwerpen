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
// Officiële bezoekerspagina van Stad Antwerpen, met een overzicht van schoolstraten en venstertijden.
export const SCHOOLSTRATEN_INFO_URL = "https://www.antwerpen.be/product/schoolstraten";
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

// Venstertijden die een besluit anders vastlegt dan de stadslaag. Het besluit wint: het keurt het
// verkeersbord goed (C3 met het onderbord "schoolstraat"), en dat bord bepaalt wanneer de straat dicht is.
// De stadslaag blijft de bron voor al de rest (school, status, afsluiting, startdag).
//
// Gemeten op 23-10-2026: de laag geeft voor de Jan Vanhoenackerstraat (SCHOOLSTR107) op woensdag
// "8:20-8:45 | 12:20-15:45", het besluit 2026_DCAN_00022 "van 8.20 tot 8.45 uur en van 12.20 tot
// 12.45 uur". De agenda toonde zo twee tijden voor één schoolstraat (15.45 op woensdag, 15.35 op de
// andere dagen) en de officiële stond er niet bij.
//
// Een besluit geldt hier alleen zolang de laag nog dezelfde proef beschrijft (status en startdag).
// Wordt de schoolstraat definitief of start er een nieuwe proef, dan komt er een nieuw besluit, en
// dan valt deze regel vanzelf weg (counts.issues.besluit_niet_meer_van_toepassing) tot iemand dat
// nieuwe besluit leest en hier zet.
export const VENSTERTIJDEN_UIT_BESLUIT = Object.freeze({
  SCHOOLSTR107: Object.freeze({
    besluit: "2026_DCAN_00022",
    orgaan: "het districtscollege",
    besluitDatum: "2026-01-12",
    url: "https://ebesluit.antwerpen.be/zittingen/25.0902.6683.3380/agendapunten/26.0106.8305.9997",
    status: "proefopstelling",
    proefVanaf: "2026-02-23",
    venstertijden: Object.freeze({
      maandag: "8:20-8:45 | 15:10-15:35",
      dinsdag: "8:20-8:45 | 15:10-15:35",
      woensdag: "8:20-8:45 | 12:20-12:45",
      donderdag: "8:20-8:45 | 15:10-15:35",
      vrijdag: "8:20-8:45 | 15:10-15:35",
    }),
  }),
});

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

// Het besluit voor deze rij, of null als er geen is. { geldt: false } als de laag intussen een andere
// proef of een definitieve schoolstraat beschrijft. Anders { geldt: true, besluit, rij, afwijkend }:
// `rij` draagt de venstertijden van het besluit, `afwijkend` de weekdagen waar de laag iets anders zegt.
export function venstertijdenVolgensBesluit(row, besluiten = VENSTERTIJDEN_UIT_BESLUIT) {
  const besluit = besluiten[clean(row?.GISID)];
  if (!besluit) return null;
  if (clean(row.STATUS).toLowerCase() !== besluit.status || utcDate(row.PROEFOPSTELLING_DATUM) !== besluit.proefVanaf) return { geldt: false, besluit };
  const afwijkend = WEEKDAGEN.map(([dag]) => dag).filter((dag) =>
    JSON.stringify(parseVenstertijden(row[`Venstertijden_${dag}`])) !== JSON.stringify(parseVenstertijden(besluit.venstertijden[dag])));
  const rij = { ...row, ...Object.fromEntries(WEEKDAGEN.map(([dag]) => [`Venstertijden_${dag}`, besluit.venstertijden[dag]])) };
  return { geldt: true, besluit, rij, afwijkend };
}

// "8:20-8:45 | 12:20-15:45" -> "8.20-8.45 en 12.20-15.45"; onleesbaar blijft de ruwe tekst.
function dagTekst(value) {
  const windows = parseVenstertijden(value);
  if (!windows) return clean(value).slice(0, 60);
  const parts = windows.map((window) => window.join("-"));
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} en ${parts.at(-1)}` : parts[0] ?? "geen";
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
    infoUrl: SCHOOLSTRATEN_INFO_URL,
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
    const volgensBesluit = venstertijdenVolgensBesluit(row);
    if (volgensBesluit && !volgensBesluit.geldt) note("besluit_niet_meer_van_toepassing");
    const besluit = volgensBesluit?.geldt ? volgensBesluit : null;
    if (besluit?.afwijkend.length) note("venstertijden_volgens_besluit");
    const vensters = venstertijdenTekst(besluit ? besluit.rij : row);
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
      // Met een besluit: de tijden van het besluit, met zijn nummer en datum, en als de laag iets anders
      // zegt, die afwijking in één zin. Zo staat er één tijd, en is te zien waar die vandaan komt.
      const tijden = besluit
        ? `Venstertijden volgens besluit ${besluit.besluit.besluit} van ${besluit.besluit.orgaan} (${formatDutchDate(besluit.besluit.besluitDatum)}): ${vensters.text}.`
        : vensters.text ? `Venstertijden: ${vensters.text}.` : "Venstertijden via de bron.";
      const afwijking = besluit?.afwijkend.length
        ? `De kaartlaag van de stad vermeldt op ${besluit.afwijkend.map((dag) => `${dag} ${dagTekst(row[`Venstertijden_${dag}`])}`).join(", ")}; het besluit gaat voor.`
        : "";
      const info = [
        `Schoolstraat${school ? ` aan ${school}` : ""}: op schooldagen is de straat tijdens de venstertijden dicht voor gemotoriseerd verkeer${afsluiting ? ` (afsluiting met ${afsluiting})` : ""}.`,
        tijden,
        afwijking,
        sinds,
      ].filter(Boolean).join(" ");
      items.push(baseItem(row, plek, {
        ...(besluit ? { infoUrl: besluit.besluit.url } : {}),
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
