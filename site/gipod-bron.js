// GIPOD als bron: één bronvermelding met de officiële datasetfiche, nooit een link naar een ruw record.
//
// Een ruw GIPOD-record (een werk, grondwerk, inname, markt of hinder) draagt ContactOrganisations of
// HindranceContactOrganisations: contactnaam, e-mail en telefoon. Meting 17 oktober 2026: bij 10 van de
// 1.193 werken in het district is dat veld gevuld, bij 7 met een persoon. De filterlink op
// geo.api.vlaanderen.be (…/collections/INNAME_PUNT/items?f=html&filter=GipodId=…) toonde die gegevens met
// één klik; de Uri op gipod.api.vlaanderen.be gaf HTTP 401. Daarom linkt de site per item hoogstens naar
// Hinder in Kaart (de officiële viewer, site/bezoekers-bronnen.js) en verder één keer naar de datasetfiche
// (innames en mobiliteitshinder, uitgever Athumi). docs/WORKS_LIVE_SOURCE_POLICY.md legt de regel uit.
//
// Ophalen blijft wel via de OGC API (site/works-live.js, lib/gipod-markets.mjs): dat zijn vragen van de
// code zelf, geen links voor bezoekers. site/agenda.js en site/agenda-ics.js zijn geen modules en hebben
// een eigen kopie van ruwGipodRecord; tests/gipod-geen-ruwe-links.test.mjs houdt ze gelijk.
export const GIPOD_METADATA_URL = "https://metadata.vlaanderen.be/srv/api/records/2b4b3bb7-cadc-41a0-b5ae-796a84a20b52";
export const GIPOD_BRON = "Bron: GIPOD (Digitaal Vlaanderen)";

// Een link naar een ruw GIPOD-record: alles op gipod.api.vlaanderen.be (de API, ook /api/v1/works/<id> en
// /api/v1/mobility-hindrances/<id>), en op geo.api.vlaanderen.be elke vraag naar de items van een
// GIPOD-collectie (/GIPOD/ogc/features/…/collections/<laag>/items, met een id, een filter of een kader).
// De landingspagina van de API (/GIPOD/ogc/features) en de datasetfiche zijn geen record.
export function ruwGipodRecord(value) {
  let url;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    return false;
  }
  if (!/^https?:$/.test(url.protocol)) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "gipod.api.vlaanderen.be" || host.endsWith(".gipod.api.vlaanderen.be")) return true;
  if (host !== "geo.api.vlaanderen.be") return false;
  let pad = url.pathname;
  try {
    pad = decodeURIComponent(pad);
  } catch {
    // een kapotte codering: dan het pad zoals het is
  }
  return /^\/+gipod\//i.test(pad) && /\/items(?:[/.]|$)/i.test(pad);
}

// Een GIPOD-bronlink in eender welke vorm: een ruw record of de datasetfiche zelf.
export const gipodLink = (value) => ruwGipodRecord(value) || String(value ?? "").trim() === GIPOD_METADATA_URL;

// Een bronlink zonder ruw GIPOD-record: zo'n record wordt de datasetfiche, al de rest blijft.
export const zonderRuwGipodRecord = (value) => (ruwGipodRecord(value) ? GIPOD_METADATA_URL : value);

// Een object of lijst (een item van een straatbestand, een fiche) zonder ruwe GIPOD-records: een tekst die
// zo'n link is, valt weg uit een lijst en wordt leeg in een object. De rest blijft zoals het was.
export function zonderRuweGipodLinks(value) {
  if (typeof value === "string") return ruwGipodRecord(value) ? "" : value;
  if (Array.isArray(value)) return value.filter((x) => !(typeof x === "string" && ruwGipodRecord(x))).map(zonderRuweGipodLinks);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, zonderRuweGipodLinks(v)]));
  return value;
}

// Alle links naar een ruw GIPOD-record in een tekst (HTML, JSON of JavaScript), voor de controles op de
// gegenereerde bestanden (scripts/validate-data.mjs, tests/gipod-geen-ruwe-links.test.mjs).
export function ruweGipodLinksIn(tekst) {
  return (String(tekst ?? "").match(/https?:\/\/[^\s"'<>`\\]+/gi) || []).filter(ruwGipodRecord);
}
