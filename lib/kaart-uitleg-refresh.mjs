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
import { EVENEMENT_IDENTITEIT_FILE } from "./evenement-identiteit-validatie.mjs";
import { buildStreetIndex as buildSiteStreetIndex, resolvePointStreet, segmentenInKader } from "../site/street-core.js";
import { isTunnel, parcoursGeometrie, stratenVanParcours } from "../site/parcours-straten.js";
import { pointSegmentMeters } from "../site/neighborhood-core.js";
import { collectPublicSpace, geometryIntersectsDistrict } from "../site/public-space-live-core.js";
import {
  bundelInnames, dagVan, evenementFeiten, huisnummerBereik, huisnummerReeks, isEenAdres, isEvenementDossier,
  koppelEvenement, routeSchets, stratenSamenvatting, werkFeiten, zonderHuisnummers, zonderNamen,
} from "../site/kaart-uitleg.js";

export const VOORUIT_DAGEN = 60;
export const ADRES_BUDGET_MS = 60_000;
export const ADRES_GELIJKTIJDIG = 6;
export const ADRES_AFSTAND_METER = 8;
// Een straat hoort bij een werk als een stuk van de werfzone dichter bij haar as ligt dan bij elke
// andere as (hoogstens 10 m ver), samen minstens 10 m rand van de zone.
export const WERFZONE_STRAAT_METER = 10;
export const WERFZONE_MIN_METER = 10;
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

// Agenda-items uit de andere bronnen (alleen de velden die de koppeling nodig heeft). Niet de
// evenementen op straat (district-asign-evenementen.json): die komen uit de dossiers zelf, en een
// dossier mag niet aan zijn eigen agendapunt (of dat van een buur) gekoppeld worden alsof dat een
// tweede bron was.
export const GEEN_KOPPELBRON = Object.freeze(["refresh-status.json", "manual-check.json", KAART_UITLEG_FILE, EVENEMENT_IDENTITEIT_FILE, "inzage-status.json", "evenement-identiteit-auto.json", "evenement-patronen.json", "district-asign-evenementen.json"]);
export function agendaItemsUitBronnen(rootDir) {
  const dir = path.join(rootDir, "site", "sources");
  const items = [];
  if (!fs.existsSync(dir)) return items;
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".json") || GEEN_KOPPELBRON.includes(name)) continue;
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      for (const it of doc.items || []) items.push({ id: it.id, title: it.title, date: it.date, endDate: it.endDate, timeText: it.timeText, location: it.location, theme: it.theme, sourceUrl: it.sourceUrl });
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
  // De parcoursherkenning (lib/parcours-herkenning-refresh.mjs) gebruikt deze telling nog voor haar
  // eigen stratenlijst (koppelen aan een agendapunt); de minDeel-variant van #140 is weg.
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
// De straten van een werfzone, de straat waar ze het langst langs loopt eerst. Alleen officiële
// straatnamen. Elk stukje rand van de zone (om de meter) hoort bij de dichtste straatas binnen
// WERFZONE_STRAAT_METER; een straatas binnen de zone telt met haar eigen lengte. Een straat telt vanaf
// WERFZONE_MIN_METER: een zijstraat die op een kruispunt alleen de hoek van de zone raakt, haalt dat
// niet (vroeger telde elke straat tot 10 m van de zone: tot 38 straten per werk). Een tunnel nooit.
const meterTussen = (a, b) => Math.hypot((b[0] - a[0]) * 111320 * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180), (b[1] - a[1]) * 110540);
function inRingen(p, rings) {
  let binnen = false;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) binnen = !binnen;
  }
  return binnen;
}
export function stratenVanWerfzone(rings = [], index) {
  if (!rings.length || !index?.segments?.length) return [];
  const tel = new Map();
  const geef = (refs, meter) => { for (const naam of new Set((refs || []).map((r) => r?.name).filter((n) => n && n.trim() && !isTunnel(n)))) tel.set(naam, (tel.get(naam) || 0) + meter); };
  const pad = WERFZONE_STRAAT_METER / 50000;
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1], b = ring[i], lengte = meterTussen(a, b), n = Math.max(1, Math.ceil(lengte));
      if (!lengte) continue;
      const kandidaten = segmentenInKader(index, [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])], pad);
      for (let j = 0; j < n; j++) {
        const t = (j + 0.5) / n, p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        let beste = null, afstand = WERFZONE_STRAAT_METER;
        for (const s of kandidaten) { const d = pointSegmentMeters(p, s.a, s.b); if (d <= afstand) { afstand = d; beste = s; } }
        if (beste) geef(beste.refs, lengte / n);
      }
    }
  }
  // Straatassen binnen de zone (een werfzone over een heel plein raakt die as niet met haar rand).
  let kader = null;
  for (const r of rings) for (const p of r) kader = kader ? [Math.min(kader[0], p[0]), Math.min(kader[1], p[1]), Math.max(kader[2], p[0]), Math.max(kader[3], p[1])] : [p[0], p[1], p[0], p[1]];
  for (const s of kader ? segmentenInKader(index, kader, 0) : []) {
    if (inRingen([(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2], rings)) geef(s.refs, meterTussen(s.a, s.b));
  }
  return [...tel].filter(([, meter]) => meter >= WERFZONE_MIN_METER).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0], "nl")).map(([naam]) => naam);
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

// Feiten uit een vorige verversing die blijven staan (de werkenlaag faalde): dezelfde regels als
// werkFeiten. Geen naam na een dossiercode, en bij één adres geen huisnummer en geen adres.
export function schoonWerk(w = {}) {
  // Alleen een reeks huisnummers blijft (huisnummerReeks in site/kaart-uitleg.js), ook uit een oudere verversing.
  const uit = { ...w, omschrijving: zonderNamen(w.omschrijving), huisnummers: huisnummerReeks(w.huisnummers) };
  if (!uit.huisnummers) uit.huisnummerBron = "";
  if ("adres" in w) uit.adres = huisnummerReeks(w.adres);
  if (!isEenAdres(w.soort)) return uit;
  delete uit.adres;
  return {
    ...uit, omschrijving: zonderHuisnummers(uit.omschrijving), huisnummers: "", huisnummerBron: "",
    fasen: (w.fasen || []).map((f) => ({ ...f, naam: zonderHuisnummers(f.naam, 160) })).filter((f) => f.naam),
  };
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
  // Eén adres (een aansluiting, een verhuis, een container), meestal van een privépersoon: dan zoeken
  // we het huisnummer niet op en bewaren we geen adres, ook niet uit een vorige verversing.
  const eenAdres = new Set(werken.filter((w) => isEenAdres(werkFeiten(w).soort)).map((w) => Number(w.gipodId)));
  const taken = [];
  for (const w of werken) {
    const prev = oud[w.gipodId];
    const straat = (w.streets || [])[0]?.name;
    const zelfde = prev && prev.bijgewerkt === clean(w.lastModified, 40);
    // Bij één adres geen huisnummer opzoeken (#141); de straten van de werfzone wel (#146).
    const adresKlaar = eenAdres.has(Number(w.gipodId)) || !straat || (zelfde && "adres" in prev);
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
    const gevonden = eenAdres.has(Number(w.gipodId)) ? undefined
      : adres.uitkomst.has(Number(w.gipodId)) ? adres.uitkomst.get(Number(w.gipodId)) : zelfde ? prev.adres : undefined;
    const vlakStraten = adres.straten.has(Number(w.gipodId)) ? adres.straten.get(Number(w.gipodId)) : zelfde && Array.isArray(prev.vlakStraten) ? prev.vlakStraten : undefined;
    const f = werkFeiten(w, { huisnummers: gevonden || "", huisnummerBron: gevonden ? "afgeleid uit de werfzone en het adressenregister" : "" });
    const entry = { ...f, bijgewerkt: clean(w.lastModified, 40) };
    // Het register geeft soms één huisnummer: dat bewaren we niet (de repo is publiek), alleen een reeks.
    if (gevonden !== undefined) entry.adres = huisnummerReeks(gevonden) || "";
    if (vlakStraten !== undefined) entry.vlakStraten = vlakStraten;
    delete entry.gipodId;
    werkEntries.push([String(w.gipodId), entry]);
  }

  // Evenementendossiers: innames met straten (straatas van de site) en de vorm van het parcours.
  const rows = district ? collectPublicSpace({ iodFeatures, districtGeometry: district, streetIndex: siteIndex }) : [];
  // A-Sign geeft een parcours als lijn (laag 23) én als vlak eromheen (laag 22). De schets volgt de
  // lijn: de rand van het vlak is een dubbele omtrek met duizenden punten, die vereenvoudigd rechte
  // streepjes dwars over de kaart trekt. Dus: de lijnen, en alleen zonder lijn de randen. De straten
  // komen uit alle vormen samen (site/parcours-straten.js; daar is het vlak exacter dan de lijn).
  const lijnen = new Map(), vormen = new Map();
  for (const f of iodFeatures) {
    const a = f?.attributes || f?.properties || {};
    if (clean(a.innameTypeNaam) !== "Parcours" || !district || !geometryIntersectsDistrict(f.geometry, district)) continue;
    const dossier = clean(a.dossierNummer, 80);
    const l = lijnen.get(dossier) || { paths: [], rings: [] };
    if (f.geometry?.paths) l.paths.push(...f.geometry.paths);
    else if (f.geometry?.rings) l.rings.push(...f.geometry.rings);
    lijnen.set(dossier, l);
    vormen.set(dossier, [...(vormen.get(dossier) || []), f]);
  }
  const evenementEntries = [];
  for (const [dossier, groep] of bundelInnames(rows)) {
    if (!isEvenementDossier(groep[0])) continue;
    // Straten: waar het parcours door loopt plus die van de andere innames; apart de straten die het
    // parcours alleen kruist. Dezelfde berekening als in de browser (site/parcours-straten.js), zodat
    // de getoonde lijst en de filter op de straatpagina altijd dezelfde zijn.
    const l = lijnen.get(dossier);
    const lijn = l?.paths.length ? l.paths : l?.rings || [];
    const parcours = siteIndex && vormen.has(dossier) ? stratenVanParcours(parcoursGeometrie(vormen.get(dossier)), siteIndex) : null;
    const f = evenementFeiten(parcours ? groep.map((r) => (clean(r.innameType || r.title) === "Parcours" ? { ...r, streets: [] } : r)) : groep);
    if (parcours) f.straten = [...new Set([...f.straten, ...parcours.langs])].sort((a, b) => a.localeCompare(b, "nl"));
    // Ook een straat met een andere inname (een parkeerverbod) die het parcours kruist, staat in
    // `kruist`: de site haalt de straten uit `straten` er zelf af (evenementStraten in place-core.js).
    const kruist = parcours ? parcours.kruist : [];
    if (!inVenster(f.start, f.eind, vandaag)) continue;
    const gekoppeld = koppelEvenement(f, agendaItems);
    // Het hele parcours in de schets (vereenvoudigd, niet afgekapt); kaartDeel zegt of er toch lijnen wegvielen.
    const schets = routeSchets(lijn);
    const entry = {
      start: f.start, eind: f.eind, soort: f.soort, soortBron: f.soortBron, beschrijvingen: f.beschrijvingen,
      straten: f.straten, kruist, stratenTekst: stratenSamenvatting(f.straten, wijkVan), gekoppeld, kaart: schets.lijnen, kaartDeel: schets.deel,
    };
    // langs: alleen de straten waar het parcours zelf door loopt (site/parcours-straten.js), zodat de
    // site "jouw straat ligt op het parcours" kan onderscheiden van een straat die het alleen kruist.
    // Onbekend (geen straatas of geen vorm): geen sleutel, en de site zegt voorzichtig "op of naast".
    if (parcours) entry.langs = parcours.langs;
    evenementEntries.push([dossier, entry]);
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
    if (!works?.ok && vorige?.werken) document.werken = Object.fromEntries(Object.entries(vorige.werken).map(([id, w]) => [id, schoonWerk(w)]));
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
