// Dataverversing voor duidelijke kaartjes: per werk en per evenementendossier de feiten die de
// site nodig heeft voor een titel en uitleg in gewone taal (site/kaart-uitleg.js). Draait na de
// live historiek (scripts/refresh-live-history.mjs) en schrijft site/sources/kaart-uitleg.json.
//
// Wat hier bijkomt ten opzichte van de live lagen in de browser:
// - huisnummers: de werfzone uit GIPOD (INNAME) tegen het adressenregister (CRAB) van de stad,
//   alleen op de straat van het werk; per werk bewaard tot GIPOD het werk wijzigt;
// - een koppeling van een parcours aan een bekend evenement uit de andere bronnen (zelfde dag en
//   een straat van het parcours in de locatie);
// - een vereenvoudigde lijn van het parcours voor een kaartschets;
// - per parcours de straten waar het door loopt en de straten die het alleen kruist
//   (site/parcours-straten.js), en per werk de straten die de werfzone raakt.
// Faalt een deel, dan ontbreekt alleen dat deel; de verversing zelf gaat door.
import fs from "node:fs";
import path from "node:path";

import { KAART_UITLEG_FILE, validateKaartUitleg } from "./kaart-uitleg-validatie.mjs";
import { buildStreetIndex as buildSiteStreetIndex, resolveGeometryStreets, resolvePointStreet } from "../site/street-core.js";
import { parcoursGeometrie, stratenVanParcours } from "../site/parcours-straten.js";
import { collectPublicSpace, geometryIntersectsDistrict } from "../site/public-space-live-core.js";
import {
  bundelInnames, dagVan, evenementFeiten, huisnummerBereik, isEvenementDossier,
  koppelEvenement, stratenSamenvatting, vereenvoudigLijnen, werkFeiten,
} from "../site/kaart-uitleg.js";

export const VOORUIT_DAGEN = 60;
export const ADRES_BUDGET_MS = 60_000;
export const ADRES_GELIJKTIJDIG = 6;
export const ADRES_AFSTAND_METER = 8;
// Een straat hoort bij een werk als de werfzone tot op 10 m van haar as komt.
export const WERFZONE_STRAAT_METER = 10;
const GIPOD_INNAME = "https://geo.api.vlaanderen.be/GIPOD/ogc/features/v1/collections/INNAME/items";
const CRAB = "https://geodata.antwerpen.be/arcgissql/rest/services/P_Publiek/CRAB_Adresposities_wgs84/MapServer/0/query";

export { KAART_UITLEG_FILE, validateKaartUitleg };

const clean = (v, max = 300) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const plusDagen = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const sortedObject = (entries) => Object.fromEntries([...entries].sort((a, b) => String(a[0]).localeCompare(String(b[0]), "nl")));

// Binnen het venster: nog niet voorbij en ten laatste over VOORUIT_DAGEN gestart.
export function inVenster(start, eind, vandaag, dagen = VOORUIT_DAGEN) {
  const s = dagVan(start), e = dagVan(eind) || s;
  if (e && e < vandaag) return false;
  return !s || s <= plusDagen(vandaag, dagen);
}

// Wijknaam per straatnaam uit de gepubliceerde site/geo-bestanden.
export function wijkVanUitGeo(rootDir) {
  try {
    const straten = JSON.parse(fs.readFileSync(path.join(rootDir, "site", "geo", "straten.json"), "utf8")).streets || [];
    const wijken = JSON.parse(fs.readFileSync(path.join(rootDir, "site", "geo", "wijken.geo.json"), "utf8")).features || [];
    const naam = new Map(wijken.map((f) => [f.properties?.code, f.properties?.naam]));
    const perStraat = new Map();
    for (const [, straat, , codes = []] of straten) if (!perStraat.has(straat) && naam.get(codes[0])) perStraat.set(straat, naam.get(codes[0]));
    return (straat) => perStraat.get(straat) || "";
  } catch {
    return () => "";
  }
}

// Agenda-items uit de andere bronnen (alleen de velden die de koppeling nodig heeft).
export function agendaItemsUitBronnen(rootDir) {
  const dir = path.join(rootDir, "site", "sources");
  const items = [];
  if (!fs.existsSync(dir)) return items;
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".json") || ["refresh-status.json", "manual-check.json", KAART_UITLEG_FILE].includes(name)) continue;
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      for (const it of doc.items || []) items.push({ title: it.title, date: it.date, endDate: it.endDate, timeText: it.timeText, location: it.location, theme: it.theme, sourceUrl: it.sourceUrl });
    } catch { /* een kapotte bron telt hier niet mee */ }
  }
  return items;
}

async function json(fetchImpl, url, init) {
  const response = await fetchImpl(url, { ...init, headers: { Accept: "application/json", ...(init?.headers || {}) } });
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { code: `http_${response.status}` });
  const data = await response.json();
  if (data?.error) throw Object.assign(new Error("bronfout"), { code: "provider_error" });
  return data;
}

// Oude manier (punten om de ~15 m op de lijn, elk aan de dichtste straatas): nam ook kruisende
// straten mee. De verversing gebruikt nu stratenVanParcours() uit site/parcours-straten.js, net als
// de browser; deze functie blijft alleen voor wie ze nog importeert.
export function stratenLangsLijn(lijnen = [], index, { stapMeter = 15, minPunten = 2 } = {}) {
  if (!index?.segments?.length) return [];
  const tel = new Map();
  for (const lijn of lijnen) {
    for (let i = 1; i < lijn.length; i++) {
      const [a, b] = [lijn[i - 1], lijn[i]];
      const k = Math.cos((a[1] * Math.PI) / 180);
      const meter = Math.hypot((b[0] - a[0]) * 111_320 * k, (b[1] - a[1]) * 110_540);
      const stappen = Math.max(1, Math.round(meter / stapMeter));
      for (let j = 0; j < stappen; j++) {
        const t = j / stappen;
        const r = resolvePointStreet([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], index, { maxDistanceMeters: 12, ambiguityMeters: 4 });
        const naam = r.streets[0]?.name;
        if (naam) tel.set(naam, (tel.get(naam) || 0) + 1);
      }
    }
  }
  return [...tel].filter(([, n]) => n >= minPunten).map(([naam]) => naam).sort((a, b) => a.localeCompare(b, "nl"));
}

// De werfzone van één werk: de ringen van het GIPOD INNAME-vlak.
async function werfzone(gipodId, fetchImpl) {
  const url = new URL(GIPOD_INNAME);
  url.search = new URLSearchParams({ f: "json", limit: "20", "filter-lang": "cql2-text", filter: `GipodId=${Number(gipodId)}` });
  const data = await json(fetchImpl, url);
  const rings = [];
  for (const f of data.features || []) {
    const g = f?.geometry;
    if (g?.type === "Polygon") rings.push(...g.coordinates);
    if (g?.type === "MultiPolygon") for (const poly of g.coordinates) rings.push(...poly);
  }
  return rings;
}
// De straten die de werfzone raakt, de dichtste eerst. Alleen officiële straatnamen.
export function stratenVanWerfzone(rings = [], index) {
  if (!rings.length || !index?.segments?.length) return [];
  const r = resolveGeometryStreets({ rings }, index, { maxDistanceMeters: WERFZONE_STRAAT_METER });
  return [...new Set((r.metAfstand || []).map((x) => x.ref.name))];
}

// Huisnummers van één werk: de werfzone (GIPOD INNAME) met ADRES_AFSTAND_METER marge tegen het
// adressenregister, alleen adressen op de straat van het werk.
export async function huisnummersVoorWerk({ gipodId, straat, rings: gegeven = null }, fetchImpl) {
  const rings = gegeven || await werfzone(gipodId, fetchImpl);
  if (!rings.length) return "";
  const body = new URLSearchParams({
    geometry: JSON.stringify({ rings, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryPolygon", inSR: "4326", spatialRel: "esriSpatialRelIntersects",
    distance: String(ADRES_AFSTAND_METER), units: "esriSRUnit_Meter",
    where: `STRAATNM='${String(straat).replace(/'/g, "''")}'`,
    outFields: "STRAATNM,HUISNR", returnGeometry: "false", f: "json",
  });
  const crab = await json(fetchImpl, CRAB, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  return huisnummerBereik((crab.features || []).map((f) => f?.attributes?.HUISNR));
}

// Loopt de opzoekingen af binnen een tijdsbudget; wat niet lukt, komt bij de volgende verversing.
// Per werk: eerst de werfzone (en daaruit de straten), dan de huisnummers op de straat van het punt.
// Faalt het adressenregister, dan blijven de straten van de werfzone toch bewaard.
async function zoekHuisnummers(taken, fetchImpl, { budgetMs, now, gelijktijdig = ADRES_GELIJKTIJDIG, index = null }) {
  const uitkomst = new Map(), straten = new Map();
  const einde = now() + budgetMs;
  let i = 0, fouten = 0;
  async function werker() {
    while (i < taken.length && now() < einde) {
      const taak = taken[i++];
      try {
        const rings = await werfzone(taak.gipodId, fetchImpl);
        if (index) straten.set(taak.gipodId, stratenVanWerfzone(rings, index));
        if (taak.straat) uitkomst.set(taak.gipodId, await huisnummersVoorWerk({ ...taak, rings }, fetchImpl));
      } catch { fouten += 1; }
    }
  }
  await Promise.all(Array.from({ length: gelijktijdig }, werker));
  return { uitkomst, straten, fouten, overgeslagen: Math.max(0, taken.length - i) };
}

// Bouwt het hele document. Puur op de invoer plus de adresopzoekingen (fetch is in te spuiten).
export async function bouwKaartUitleg({
  works = [], iodFeatures = [], district = null, streetFeatures = [], agendaItems = [], wijkVan = () => "",
  vorige = null, fetch: fetchImpl = globalThis.fetch, clock = () => new Date(), budgetMs = ADRES_BUDGET_MS, now = () => Date.now(),
} = {}) {
  const generatedAt = clock().toISOString();
  const vandaag = dagVan(generatedAt);

  // Werken: feiten, en huisnummers en straten van de werfzone uit de vorige run zolang GIPOD het werk
  // niet wijzigde. Een werk zonder straat aan zijn punt krijgt zo toch straten (uit de werfzone).
  const siteIndex = streetFeatures.length ? buildSiteStreetIndex(streetFeatures) : null;
  const oud = vorige?.werken || {};
  const werken = works.filter((w) => Number.isFinite(Number(w.gipodId)) && inVenster(w.start, w.end, vandaag));
  const taken = [];
  for (const w of werken) {
    const prev = oud[w.gipodId];
    const straat = (w.streets || [])[0]?.name;
    const zelfde = prev && prev.bijgewerkt === clean(w.lastModified, 40);
    const adresKlaar = !straat || (zelfde && "adres" in prev);
    const stratenKlaar = !siteIndex || (zelfde && Array.isArray(prev.vlakStraten));
    if (adresKlaar && stratenKlaar) continue;
    taken.push({ gipodId: Number(w.gipodId), ...(straat && !adresKlaar ? { straat } : {}) });
  }
  taken.sort((a, b) => a.gipodId - b.gipodId);
  const adres = taken.length && fetchImpl ? await zoekHuisnummers(taken, fetchImpl, { budgetMs, now, index: siteIndex }) : { uitkomst: new Map(), straten: new Map(), fouten: 0, overgeslagen: taken.length };
  const werkEntries = [];
  for (const w of werken) {
    const prev = oud[w.gipodId];
    const zelfde = prev && prev.bijgewerkt === clean(w.lastModified, 40);
    const gevonden = adres.uitkomst.has(Number(w.gipodId)) ? adres.uitkomst.get(Number(w.gipodId)) : zelfde ? prev.adres : undefined;
    const vlakStraten = adres.straten.has(Number(w.gipodId)) ? adres.straten.get(Number(w.gipodId)) : zelfde && Array.isArray(prev.vlakStraten) ? prev.vlakStraten : undefined;
    const f = werkFeiten(w, { huisnummers: gevonden || "", huisnummerBron: gevonden ? "afgeleid uit de werfzone en het adressenregister" : "" });
    const entry = { ...f, bijgewerkt: clean(w.lastModified, 40) };
    if (gevonden !== undefined) entry.adres = gevonden || "";
    if (vlakStraten !== undefined) entry.vlakStraten = vlakStraten;
    delete entry.gipodId;
    werkEntries.push([String(w.gipodId), entry]);
  }

  // Evenementendossiers: innames met straten (straatas van de site) en de vorm van het parcours.
  const rows = district ? collectPublicSpace({ iodFeatures, districtGeometry: district, streetIndex: siteIndex }) : [];
  const lijnen = new Map(), vormen = new Map();
  for (const f of iodFeatures) {
    const a = f?.attributes || f?.properties || {};
    if (clean(a.innameTypeNaam) !== "Parcours" || !district || !geometryIntersectsDistrict(f.geometry, district)) continue;
    const paths = f.geometry?.paths || (f.geometry?.rings ? f.geometry.rings : []);
    const list = lijnen.get(clean(a.dossierNummer, 80)) || [];
    list.push(...paths);
    lijnen.set(clean(a.dossierNummer, 80), list);
    vormen.set(clean(a.dossierNummer, 80), [...(vormen.get(clean(a.dossierNummer, 80)) || []), f]);
  }
  const evenementEntries = [];
  for (const [dossier, groep] of bundelInnames(rows)) {
    if (!isEvenementDossier(groep[0])) continue;
    // Straten: waar het parcours door loopt plus die van de andere innames; apart de straten die het
    // parcours alleen kruist. Dezelfde berekening als in de browser (site/parcours-straten.js), zodat
    // de getoonde lijst en de filter op de straatpagina altijd dezelfde zijn.
    const lijn = lijnen.get(dossier) || [];
    const parcours = siteIndex && vormen.has(dossier) ? stratenVanParcours(parcoursGeometrie(vormen.get(dossier)), siteIndex) : null;
    const f = evenementFeiten(parcours ? groep.map((r) => (clean(r.innameType || r.title) === "Parcours" ? { ...r, streets: [] } : r)) : groep);
    if (parcours) f.straten = [...new Set([...f.straten, ...parcours.langs])].sort((a, b) => a.localeCompare(b, "nl"));
    const kruist = parcours ? parcours.kruist.filter((n) => !f.straten.includes(n)) : [];
    if (!inVenster(f.start, f.eind, vandaag)) continue;
    const gekoppeld = koppelEvenement(f, agendaItems);
    const kaart = vereenvoudigLijnen(lijn, 25).slice(0, 12);
    evenementEntries.push([dossier, {
      start: f.start, eind: f.eind, soort: f.soort, soortBron: f.soortBron, beschrijvingen: f.beschrijvingen,
      straten: f.straten, kruist, stratenTekst: stratenSamenvatting(f.straten, wijkVan), gekoppeld, kaart,
    }]);
  }

  return {
    document: {
      schemaVersion: 1,
      generatedAt,
      vanaf: vandaag,
      tot: plusDagen(vandaag, VOORUIT_DAGEN),
      werken: sortedObject(werkEntries),
      evenementen: sortedObject(evenementEntries),
    },
    stats: { werken: werkEntries.length, evenementen: evenementEntries.length, adresOpgezocht: adres.uitkomst.size, adresFouten: adres.fouten, adresOvergeslagen: adres.overgeslagen },
  };
}

// Eén regel per werk of dossier: klein om te laden en een leesbare diff per verversing.
export function serialiseer(doc) {
  const blok = (obj) => {
    const rows = Object.entries(obj).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
    return rows.length ? `{\n${rows.join(",\n")}\n }` : "{}";
  };
  const kop = ["schemaVersion", "generatedAt", "vanaf", "tot"].map((k) => ` ${JSON.stringify(k)}: ${JSON.stringify(doc[k])}`);
  return `{\n${kop.join(",\n")},\n "werken": ${blok(doc.werken)},\n "evenementen": ${blok(doc.evenementen)}\n}\n`;
}

// Inhaakpunt voor de verversing: bouwt en schrijft, of laat bij een fout het vorige bestand staan.
export async function schrijfKaartUitleg({ rootDir, works, publicSpace, streetFeatures, fetch: fetchImpl, clock, log = console.log, budgetMs }) {
  const file = path.join(rootDir, "site", "sources", KAART_UITLEG_FILE);
  try {
    const vorige = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
    const { document, stats } = await bouwKaartUitleg({
      works: works?.ok ? works.items : [],
      iodFeatures: publicSpace?.ok ? publicSpace.iodFeatures || [] : [],
      district: publicSpace?.ok ? publicSpace.district || null : null,
      streetFeatures: streetFeatures || [],
      agendaItems: agendaItemsUitBronnen(rootDir),
      wijkVan: wijkVanUitGeo(rootDir),
      vorige, fetch: fetchImpl, clock, ...(budgetMs ? { budgetMs } : {}),
    });
    // Een mislukte laag houdt haar vorige feiten, zodat een haperende bron geen kaartjes leegmaakt.
    if (!works?.ok && vorige?.werken) document.werken = vorige.werken;
    if (!publicSpace?.ok && vorige?.evenementen) document.evenementen = vorige.evenementen;
    const errors = validateKaartUitleg(document);
    if (errors.length) throw new Error(`kaart-uitleg ongeldig: ${errors[0]}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, serialiseer(document), "utf8");
    log(JSON.stringify({ kaartUitleg: stats }));
    return document;
  } catch (error) {
    log(JSON.stringify({ kaartUitleg: "niet bijgewerkt", errorCode: clean(error?.code || error?.message, 80) }));
    return null;
  }
}
