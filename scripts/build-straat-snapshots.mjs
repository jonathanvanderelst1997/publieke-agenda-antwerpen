// Snelheid (P5): per straat een klein bestand met wat de ochtendverversing er vond, en een kleine radar.
//
// - site/straat/<id>.json: de werken, de A-Sign-items (parkeerverboden, innames, werfzones, evenementen
//   op straat, terrassen), de vergunningen en de agendapunten van één officiële straat (id uit
//   site/geo/straten.json), plus het tijdstip van de verversing die deze inhoud schreef. De plekpagina
//   toont dat meteen en vraagt daarna live alleen het kader van die straat na (site/straat-snapshot.js).
// - site/straat-index.json: welke straten een bestand hebben, met een korte hash van de inhoud (de
//   browser vraagt "/straat/<id>.json?v=<hash>" en mag dat lang bewaren: render.yaml), de stand per laag
//   en het tijdstip van de laatste verversing. Het staat bewust niet in site/straat/: dat krijgt een lange
//   cache, de index een korte.
// - site/history/radar.json: de wijzigingen per straat van de laatste dagen (enkele kB) voor de
//   district-radar. De voorpagina vraagt live-layers.json (8 MB) daardoor niet meer op.
//
// Twee stappen. Tijdens de verversing van de live lagen (scripts/refresh-live-history.mjs) maakt
// verzamelStraatBronnen() de items zoals de browser ze maakt (zelfde code uit site/), haalt de
// vergunningen en de terrassen op en bewaart alles privacyveilig in .cache/straat-bronnen.json (staat in
// .gitignore, gaat nooit mee in een commit). Op het einde van `npm run refresh`, na de agenda, verdeelt
// dit script alles over de straten.
//
// Privacy, met dezelfde regels als de historiek (lib/historiek-privacy.mjs): alleen district Antwerpen,
// geen huisnummers (ook niet in titels) behalve bij een werk (dat staat er met zijn exacte adres, regel van de eigenaar van
// 26 oktober 2026), nooit de reden van een parkeerverbod (de titel is "Parkeerverbod", geen veld
// `reason`; site/adres-privacy.js; wel het dossier van zijn werfzone, `werfzoneDossier`, dat de werfkaart ook toont),
// geen vrije beschrijving van een inname (innameBeschrijving),
// geen aanvrager of onderwerp van een vergunning, geen adres van een terras, geen punt of vorm (een
// precieze plek kan naar één woning wijzen), en nooit de velden creator, assignee of lockOwner.
//
// Een laag die vandaag niet laadde of verdacht krimpt, houdt de vorige stand (uit de bestaande
// straatbestanden) en staat zo in de index. Een straat zonder items krijgt geen bestand. Een bestand
// wordt alleen herschreven als de inhoud verandert: zo groeit de repo niet elke dag met honderden
// bestanden die alleen een ander tijdstip hebben.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { USER_AGENT, isMainModule } from "../lib/fetch-util.mjs";
import { brusselsDate } from "../lib/html-text.mjs";
import { itemVoorHistoriek, parkeerverbodInDistrict } from "../lib/historiek-privacy.mjs";
import {
  BRONNEN_BESTAND, KRIMP_MAX_VERLIES, KRIMP_MINIMUM, MAX_RADAR_BYTES, MAX_STRAAT_BYTES, NOOIT, RADAR_BESTAND, RADAR_DAGEN, STRAAT_INDEX,
  PARKEERVERBOD_VERBAND, STRAAT_LAGEN, STRAAT_MAP, STRAAT_SCHEMA, aantalItems, itemZonderPandnummers, straatBestandenProblemen, straatItemPrivacy,
} from "../lib/straat-bestanden.mjs";
import { loadExpandedAgendaItems } from "./agenda-source.mjs";
import { locationKey } from "../site/neighborhood-core.js";
import { collectPermits } from "../site/permits-live-core.js";
import { dayOf, maatregelSleutel, parkeerverbodenAanEvenement, parkeerverbodenAanWerfzone } from "../site/place-core.js";
import { DISTRICT_POSTCODES } from "../site/public-space-core.js";
import { collectPublicSpace } from "../site/public-space-live-core.js";
import { applyWorkStreetResolution, buildStreetIndex, resolveAddressStreets, straatasNaam } from "../site/street-core.js";
import { collectTerraces } from "../site/terraces-live-core.js";
import { innameSoort, isEvenementDossier } from "../site/kaart-uitleg.js";
import { STRAATVELDEN, WEGGELATEN, straatItems, veiligeInname } from "../site/straat-snapshot.js";
import { parkeerverbodZonderReden } from "../site/adres-privacy.js";
import { heeftToevoeging, zonderToevoegingInData } from "../site/witte-lijst.js";
import { zonderRuweGipodLinks } from "../site/gipod-bron.js";
import { werkenVoorDeSite } from "../site/werk-vorm.js";
// De soort en de categorie van een agendapunt zoals de site ze geeft (site/agenda.js): voor het evenement van een
// parkeerverbod (agendaZoalsDeSite). Deze twee bestanden zetten hun functies op globalThis.
import "../site/event-types.js";
import "../site/agenda-uitgaan.js";

export {
  BRONNEN_BESTAND, MAX_RADAR_BYTES, MAX_STRAAT_BYTES, RADAR_BESTAND, RADAR_DAGEN, STRAAT_INDEX, STRAAT_LAGEN, STRAAT_MAP, STRAAT_SCHEMA,
  aantalItems, straatBestandenProblemen, straatItemPrivacy,
};

const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const kort = (tekst) => crypto.createHash("sha256").update(tekst).digest("hex").slice(0, 12);
// Draagt een item (ook dieper) nog een homoniemtoevoeging van de straatas in een tekst ("Proefstraat_AN")?
const metToevoeging = (waarde) => (typeof waarde === "string" ? heeftToevoeging(waarde)
  : Array.isArray(waarde) ? waarde.some(metToevoeging) : isObject(waarde) ? Object.values(waarde).some(metToevoeging) : false);
// Een parkeerverbod uit een vorig straatbestand: titel "Parkeerverbod", geen `reason` (site/adres-privacy.js).
const zonderParkeerReden = (item) => (item?.kind === "parking" || String(item?.id || "").startsWith("parking:") ? parkeerverbodZonderReden(item) : item);

// ---------- privacy per item ----------

// Bronlinks: alleen https naar de bronnen zelf. Ze gaan niet door de huisnummeropkuis (een URL is geen adres).
// Geen GIPOD-host: een link naar een ruw GIPOD-record (een werk, grondwerk of hinder) draagt contactgegevens
// (site/gipod-bron.js), en de plekpagina linkt per werk naar de algemene kaart van Hinder in Kaart.
const BRONHOSTS = new Set(["geodata.antwerpen.be"]);
const bronUrl = (value) => {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && BRONHOSTS.has(url.hostname) && !url.username ? url.href : "";
  } catch {
    return "";
  }
};

// Eén item zoals de browser het maakt, zonder wat niet publiek mag. Geeft null als er na de opkuis nog
// iets privé in staat (dan liever een item minder dan een huisnummer of een naam in de repo).
export function itemVoorStraat(item, { laag = "" } = {}) {
  if (!isObject(item)) return null;
  // Een werk heeft in de browser geen id, alleen een GIPOD-nummer: dezelfde id als de historiek.
  const id = clean(item.id) || (item.gipodId != null && !item.kind && Number.isFinite(Number(item.gipodId)) ? `work:${Number(item.gipodId)}` : "");
  if (!id) return null;
  const zonder = { id };
  for (const [sleutel, waarde] of Object.entries(item)) {
    if (NOOIT.has(sleutel) || waarde === undefined || sleutel === "id") continue;
    zonder[sleutel] = waarde;
  }
  // Het verband van een parkeerverbod (PARKEERVERBOD_VERBAND): het dossier van zijn werfzone alleen als dossiernummer
  // (geldigWerfzoneDossier), de sleutel van zijn evenement alleen als sleutel (geldigEvenementSleutel); anders weg.
  for (const [veld, { geldig }] of Object.entries(PARKEERVERBOD_VERBAND)) if (veld in zonder && !geldig(zonder)) delete zonder[veld];
  // Een parkeerverbod buiten het district (A-Sign "District='ANTWERPEN'" is de hele stad) valt weg.
  if ((zonder.kind === "parking" || String(zonder.id).startsWith("parking:")) && parkeerverbodInDistrict(zonder) === false) return null;
  // Eerst de regels van de historiek (huisnummer na een straatnaam, naam na een dossiercode), dan een
  // nummer na "gevel", "pand" of "nummer" in vrije tekst (de omschrijving van een GIPOD-hinderfase). Een werk houdt zijn
  // huisnummer (lib/historiek-privacy.mjs).
  // De naam van de fase van een inname (faseNaam, vrij in te vullen) alleen als vaste vorm, district of straat van de inname
  // (veiligeFase in site/witte-lijst.js), ook in `detail`; zo leest straatItems hetzelfde terug.
  const schoon = itemZonderPandnummers(itemVoorHistoriek(veiligeInname(zonder)));
  for (const sleutel of ["sourceUrl", "sourceUrls"]) {
    if (!(sleutel in zonder)) continue;
    schoon[sleutel] = Array.isArray(zonder[sleutel]) ? zonder[sleutel].map(bronUrl).filter(Boolean) : bronUrl(zonder[sleutel]);
  }
  if (laag === "terrassen" && !schoon.address) schoon.address = "";
  // Ook dieper (de hinder van een werk, uit een oudere live laag): nooit een link naar een ruw GIPOD-record.
  const zonderGipod = zonderRuweGipodLinks(schoon);
  return straatItemPrivacy(zonderGipod).length ? null : zonderGipod;
}

// Het kader [minX, minY, maxX, maxY] van wat we van een item weten: zijn punt (werk), zijn vorm (parkeer-
// verbod, inname, werfzone, vergunning) of de geometrie van zijn feature (terras). Het komt nooit zelf in
// een bestand: per straat staat alleen het samengevoegde kader van al haar items, afgerond op 0,001°
// (ongeveer 100 m), zodat de plekpagina live het juiste kader navraagt (ook een terras met een adres in
// de straat dat 150 m verder ligt).
export function kaderVanItem(item, geometrie = null) {
  const punten = [];
  const lijnen = (g) => {
    if (!g) return;
    if (Number.isFinite(g.x) && Number.isFinite(g.y)) punten.push([g.x, g.y]);
    for (const ring of [...(g.rings || []), ...(g.paths || [])]) punten.push(...ring);
  };
  if (Array.isArray(item?.point)) punten.push(item.point);
  for (const v of [item?.vorm, item?.parcours]) {
    if (!v) continue;
    for (const vlak of v.vlakken || []) for (const ring of vlak) punten.push(...ring);
    for (const lijn of v.lijnen || []) punten.push(...lijn);
  }
  lijnen(geometrie);
  const ok = punten.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (!ok.length) return null;
  return [Math.min(...ok.map((p) => p[0])), Math.min(...ok.map((p) => p[1])), Math.max(...ok.map((p) => p[0])), Math.max(...ok.map((p) => p[1]))];
}
const voegKaderToe = (schoon, kader) => (schoon && kader ? { ...schoon, __kader: kader } : schoon);

// Een terras: geen adres (vaak met huisnummer), wel een groep per adres binnen de straat, zodat de
// plekpagina twee zones op hetzelfde adres nog altijd als één terras toont (terrasEntries in place-core.js).
export function terrassenVoorStraat(items = []) {
  const groepen = new Map();
  const uit = [];
  for (const item of items) {
    const adres = locationKey(item?.address || "");
    const groep = adres ? (groepen.get(adres) || `g${groepen.size + 1}`) : "";
    if (adres) groepen.set(adres, groep);
    const schoon = voegKaderToe(itemVoorStraat({ ...item, address: undefined }, { laag: "terrassen" }), item?.__kader || null);
    if (schoon) uit.push(groep ? { ...schoon, adresGroep: groep } : schoon);
  }
  return uit;
}

// Een agendapunt in een straat: alleen wat de agenda zelf al publiek toont, zonder de locatietekst.
export function agendapuntVoorStraat(item) {
  const uit = {
    id: clean(item?.id),
    title: clean(item?.title),
    date: clean(item?.date),
    ...(clean(item?.endDate) ? { endDate: clean(item.endDate) } : {}),
    ...(clean(item?.timeText) ? { timeText: clean(item.timeText) } : {}),
    ...(clean(item?.theme) ? { theme: clean(item.theme) } : {}),
  };
  if (!uit.id || !uit.title || !uit.date) return null;
  const schoon = itemZonderPandnummers(itemVoorHistoriek(uit));
  return straatItemPrivacy(schoon).length ? null : schoon;
}

// ---------- ophalen tijdens de verversing ----------

const VERGUNNINGEN = "https://geodata.antwerpen.be/arcgissql/rest/services/P_PiP/pip2_vergunningen/MapServer/5";
const TERRASSEN = "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/49";
const KADER = "4.300791,51.175458,4.444331,51.313629";
const wacht = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fout(code, bericht) {
  const error = new Error(bericht);
  error.code = code;
  return error;
}

// Alle features van een ArcGIS-laag in het kader van het district, per pagina (de lagen ondersteunen
// resultOffset). Hoogstens één verzoek per seconde naar dezelfde host.
export async function arcgisInKader(laag, { outFields, pageSize = 1000, maxPages = 20, fetch: fetchImpl = globalThis.fetch, sleep = wacht } = {}) {
  const features = [];
  for (let pagina = 0; pagina < maxPages; pagina += 1) {
    if (pagina) await sleep(1000);
    const url = new URL(`${laag}/query`);
    url.search = new URLSearchParams({
      where: "1=1", geometry: KADER, geometryType: "esriGeometryEnvelope", inSR: "4326", spatialRel: "esriSpatialRelIntersects",
      outFields, returnGeometry: "true", outSR: "4326", orderByFields: "OBJECTID ASC",
      resultOffset: String(pagina * pageSize), resultRecordCount: String(pageSize), f: "json",
    });
    const response = await fetchImpl(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } });
    if (!response.ok) throw fout(`http_${response.status}`, `HTTP ${response.status}`);
    const data = await response.json();
    if (data?.error) throw fout("provider_error", "bronfout");
    if (!Array.isArray(data?.features)) throw fout("invalid_features", "features ontbreken");
    features.push(...data.features);
    if (data.features.length < pageSize && !data.exceededTransferLimit) return features;
  }
  throw fout("pagination_limit", "paginering veiligheidslimiet");
}

const foutCode = (error, standaard) => (/^[a-z0-9_:-]{2,80}$/.test(String(error?.code || "")) ? String(error.code) : standaard);

// Vergunningen en terrassen zoals de browser ze maakt (site/permits-live-core.js, site/terraces-live-core.js).
export async function haalVergunningen({ fetch: fetchImpl, sleep, districtGeometry, streetIndex }) {
  try {
    const features = await arcgisInKader(VERGUNNINGEN, { outFields: "OBJECTID,DOSSIERTYPE,Dossiernummer,AardAanvraag,Onderwerp,Beslissing,DatumBeslissing,Volledig,Ontvankelijk,Ingetrokken,Stopgezet,ProjectnummerOmgevingsloket,behandelendeOverheid,beslissingsoverheid", pageSize: 1000, fetch: fetchImpl, sleep });
    return { ok: true, items: collectPermits({ features, districtGeometry, streetIndex }) };
  } catch (error) {
    return { ok: false, items: [], errorCode: foutCode(error, "permits_fetch_failed") };
  }
}

export async function haalTerrassen({ fetch: fetchImpl, sleep, districtGeometry, streetIndex }) {
  try {
    const features = await arcgisInKader(TERRASSEN, { outFields: "OBJECTID,ROLnet_ID,TypeTerrasZone,Status,adres,postcode", pageSize: 1000, fetch: fetchImpl, sleep });
    // Het kader per terras (zelfde id als normalizeTerrace), voor het kader van de straat.
    const kaders = new Map(features.map((f) => [`terrace:${String(f?.attributes?.ROLnet_ID || f?.attributes?.OBJECTID || "").replace(/\s+/g, " ").trim().slice(0, 120)}`, kaderVanItem(null, f?.geometry)]));
    return { ok: true, items: collectTerraces(features, districtGeometry, streetIndex).map((item) => ({ ...item, __kader: kaders.get(item.id) || null })) };
  } catch (error) {
    return { ok: false, items: [], errorCode: foutCode(error, "terraces_fetch_failed") };
  }
}

// De agenda zoals de site ze aan de plekpagina geeft (window.PUBLIC_AGENDA_PUBLIC_ITEMS in site/agenda.js): wat vandaag of
// later nog loopt, met de soort (classifyEventType), de wekelijkse reeksen en de categorie. Daarmee beslist de verversing
// bij welk evenement een parkeerverbod hoort (parkeerverbodenAanEvenement), zoals de plekpagina dat doet. `items`: de
// uitgevouwen agenda (loadExpandedAgendaItems).
export function agendaZoalsDeSite(items = [], vandaag = "") {
  const U = globalThis.PublicAgendaUitgaan, E = globalThis.PublicAgendaEventTypes;
  const lopend = (Array.isArray(items) ? items : []).filter((item) => isObject(item) && (!vandaag || String(item.endDate || item.date || "").slice(0, 10) >= vandaag));
  const metSoort = lopend.map((item) => ({ ...item, eventType: E?.classifyEventType?.(item) || "other" }));
  return (typeof U?.markeerWekelijkseReeksen === "function" ? U.markeerWekelijkseReeksen(metSoort) : metSoort).map((item) => ({ ...item, category: U ? U.categoryOf(item) : "other" }));
}

// Uit de repo (site/agenda.js en site/agenda-feed.js). Lukt dat niet, dan geen agenda: dan hangt de verversing geen
// parkeerverbod aan een evenement (nooit gokken), en de rest gaat gewoon door.
function agendaVanDeSite(rootDir, vandaag) {
  try { return agendaZoalsDeSite(loadExpandedAgendaItems(rootDir), vandaag); } catch { return []; }
}

// Tijdens scripts/refresh-live-history.mjs: de items van alle lagen zoals de browser ze maakt, met de
// straten zoals de browser ze vindt (site/street-core.js), privacyveilig in .cache/straat-bronnen.json.
// Faalt hier iets, dan gaat de verversing gewoon door: de straatbestanden houden dan hun vorige stand.
// `fetch` null: geen vergunningen en terrassen ophalen (die lagen houden dan hun vorige stand).
// `werkVorm`: de vaste vorm per werk na deze verversing (site/sources/werk-vorm.json): de werken krijgen hier opnieuw hun
// straat zoals de browser ze vindt, en daarna meteen de poort (werkenVoorDeSite, site/werk-vorm.js).
// `siteAgenda`: de agenda zoals de site ze toont (agendaZoalsDeSite); zonder: uit site/agenda.js en site/agenda-feed.js.
export async function verzamelStraatBronnen({ rootDir, observedAt, worksResult, publicSpaceResult, streetFeatures, fetch: fetchImpl = null, sleep = wacht, log = () => {}, werkVorm = null, siteAgenda = undefined }) {
  const bestand = path.join(rootDir, BRONNEN_BESTAND);
  const laag = (result, items) => (result?.ok ? { ok: true, items } : { ok: false, items: [], errorCode: result?.errorCode || "niet_geladen" });
  try {
    const index = Array.isArray(streetFeatures) && streetFeatures.length ? buildStreetIndex(streetFeatures) : null;
    const district = publicSpaceResult?.district || null;
    const works = worksResult?.ok && index ? werkenVoorDeSite(applyWorkStreetResolution(worksResult.items, index), werkVorm) : [];
    const raw = publicSpaceResult?.ok ? publicSpaceResult.features : null;
    // Een parkeerverbod voor een werf krijgt hier het dossiernummer van zijn werfzone (werfzoneDossier), en een parkeerverbod
    // voor een evenement de sleutel van dat evenement (evenementSleutel), met de reden van A-Sign die de verversing alleen
    // intern kent: schoon() (itemVoorStraat) haalt de reden daarna weg, en zo hangt de ochtendstand een parkeerverbod nog
    // altijd aan zijn werfzone of evenement (site/place-core.js, parkeerverbodVoorWerf en evenementVanParkeerverboden).
    const publicSpace = raw && index && district
      ? parkeerverbodenAanEvenement(parkeerverbodenAanWerfzone(collectPublicSpace({ parkingFeatures: raw.parking || [], iodFeatures: raw.iod || [], sgwFeatures: raw.sgw || [], districtGeometry: district, streetIndex: index, postcodes: DISTRICT_POSTCODES })),
        { agendaItems: siteAgenda === undefined ? agendaVanDeSite(rootDir, brusselsDate(new Date(observedAt))) : siteAgenda, uitleg: leesJson(path.join(rootDir, "site", "sources", "kaart-uitleg.json")) })
      : [];
    const ophalen = Boolean(index && district && typeof fetchImpl === "function");
    const zonder = { ok: false, items: [], errorCode: typeof fetchImpl !== "function" ? "niet_opgehaald" : index ? "district_boundary_missing" : "street_axis_missing" };
    const permits = ophalen ? await haalVergunningen({ fetch: fetchImpl, sleep, districtGeometry: district, streetIndex: index }) : zonder;
    if (ophalen) await sleep(1000);
    const terraces = ophalen ? await haalTerrassen({ fetch: fetchImpl, sleep, districtGeometry: district, streetIndex: index }) : zonder;
    const schoon = (items, soort) => items.map((item) => voegKaderToe(itemVoorStraat(item, { laag: soort }), kaderVanItem(item))).filter(Boolean);
    const bronnen = {
      schemaVersion: STRAAT_SCHEMA,
      ververst: observedAt,
      lagen: {
        werken: laag(index ? worksResult : { ok: false, errorCode: "street_axis_missing" }, schoon(works, "werken")),
        publiekeRuimte: laag(raw && index && district ? publicSpaceResult : { ok: false, errorCode: publicSpaceResult?.errorCode || "street_axis_missing" }, schoon(publicSpace, "publiekeRuimte")),
        vergunningen: laag(permits, schoon(permits.items, "vergunningen")),
        terrassen: { ...laag(terraces, terrassenVoorStraat(terraces.items)) },
      },
    };
    fs.mkdirSync(path.dirname(bestand), { recursive: true });
    fs.writeFileSync(bestand, `${JSON.stringify(bronnen)}\n`, "utf8");
    log(JSON.stringify({ straatBronnen: Object.fromEntries(Object.entries(bronnen.lagen).map(([naam, l]) => [naam, l.ok ? l.items.length : l.errorCode])) }));
    return bronnen;
  } catch (error) {
    // Nooit de inhoud in de log (publiek): alleen het soort fout.
    log(JSON.stringify({ straatBronnen: "niet gelukt", soort: error?.name || "Error" }));
    try { fs.rmSync(bestand, { force: true }); } catch { /* niets */ }
    return null;
  }
}

// ---------- verdelen over de straten ----------

// De officiële straten (site/geo/straten.json): id → namen per postcode, en naam → refs.
export function leesStraten(rootDir) {
  const doc = JSON.parse(fs.readFileSync(path.join(rootDir, "site", "geo", "straten.json"), "utf8"));
  const perId = new Map();
  const byName = new Map();
  for (const [id, naam, postcode, , box] of Array.isArray(doc?.streets) ? doc.streets : []) {
    const ref = { id: String(id), name: clean(naam), postcode: String(postcode || ""), ...(Array.isArray(box) && box.length === 4 ? { box } : {}) };
    if (!ref.id || !ref.name) continue;
    perId.set(ref.id, [...(perId.get(ref.id) || []), ref]);
    const sleutel = locationKey(ref.name);
    byName.set(sleutel, [...(byName.get(sleutel) || []), ref]);
  }
  return { perId, byName };
}

// Extra straten van een werk, zoals de plekpagina ze ook gebruikt: de straten van zijn werfzone
// (kaart-uitleg.json werken[gipodId].vlakStraten).
export function extraStratenVan(item, { uitleg = null, byName = new Map() } = {}) {
  if (item?.gipodId == null || item.kind) return [];
  return (uitleg?.werken?.[item.gipodId]?.vlakStraten || []).flatMap((naam) => byName.get(locationKey(naam)) || []);
}

// De straten van een evenementendossier volgens de verversing (kaart-uitleg.json evenementen[dossier]):
// waar het parcours door loopt en wat het kruist. De plekpagina toont het dossier in al die straten.
export function dossierStraten(dossier, { uitleg = null, byName = new Map() } = {}) {
  const ev = uitleg?.evenementen?.[dossier];
  if (!ev) return null;
  return [...(ev.straten || []), ...(ev.kruist || [])].flatMap((naam) => byName.get(locationKey(naam)) || []);
}

const straatSleutel = (ref) => String(ref?.id || "");
const isEvenementRij = (item) => item?.kind === "iod" && isEvenementDossier(item);
const isEvenementFase = (item) => /^evenement$/i.test(clean(item?.phase)) || /Fase Evenement/i.test(clean(item?.detail));

// Opbouw en afbraak van een evenement liggen vaak elders dan de straat (de start- en aankomstzone van een
// loop), en een straatbestand bevat alleen de rijen van de straat zelf. De kaart rekent "opbouw vanaf …
// en afbraak tot …", "Parcours door …" en de hele innameperiode uit alle rijen van het dossier
// (evenementFeiten in site/kaart-uitleg.js). Daarom per evenementendossier één samenvattende rij per fase
// en soort inname (parcours, parkeerverbod, verkeersvrij, omleiding, andere): het vroegste begin en het
// laatste einde van die rijen, zonder vorm of omschrijving (`faseSamenvatting`). Ze komt in elke straat
// waar het dossier staat; de plekpagina houdt ze ook als het live nakijken mislukt (aanvullenMetOchtend in
// site/straat-snapshot.js).
// Straten: alleen bij een parkeerverbod, een verkeersvrije zone of een omleiding, de soorten die "Wat merk
// je" noemt ("Parkeerverbod in Hanegraefstraat, Krimsonpad. … De stad verwacht hinder voor het verkeer.").
// Zonder die straten zei de kaart ten onrechte "Welke straten dicht gaan en wanneer, maakt de stad niet
// bekend." De straat van het bestand zelf valt weg (verdeelOverStraten): die heeft haar eigen rijen, dus
// "jouw straat" verandert niet. De straten van een parcours of een gewone inname blijven bewust weg: bij
// een groot parcours zijn dat er honderden, in elk bestand van dat parcours (gemeten: 7 MB extra over
// alle straten; met alleen de drie soorten hierboven 0,03 MB op de data van 11 oktober 2026). Het parcours
// staat in kaart-uitleg.json.
const tijd = (waarde) => Date.parse(waarde || "");
const MET_STRATEN = new Set(["parkeerverbod", "verkeersvrij", "omleiding"]);
const naamVolgorde = (a, b) => clean(a.name).localeCompare(clean(b.name), "nl") || String(a.postcode || "").localeCompare(String(b.postcode || "")) || String(a.id || "").localeCompare(String(b.id || ""));
const samenStraten = (...lijsten) => uniekeRefs(lijsten.flatMap((lijst) => (Array.isArray(lijst) ? lijst : []))).sort(naamVolgorde);
export function faseSamenvattingen(rijen = []) {
  const perDossier = new Map();
  for (const rij of rijen) {
    if (!isEvenementRij(rij) || rij.faseSamenvatting || !clean(rij.reference)) continue;
    const ref = clean(rij.reference), fase = clean(rij.phase), type = clean(rij.innameType || rij.title), soort = innameSoort(type);
    const fasen = perDossier.get(ref) || new Map();
    perDossier.set(ref, fasen);
    const start = rij.start || "", end = rij.end || rij.start || "";
    const sleutel = `${fase}|${soort}`;
    const huidig = fasen.get(sleutel);
    if (!huidig) {
      fasen.set(sleutel, {
        id: `iod:${ref}|fase|${fase || "zonder"}|${soort}`, kind: "iod", kindLabel: rij.kindLabel || "Inname openbaar domein", title: "", location: "",
        start, end, status: rij.status || "", reference: ref, detail: fase ? `Fase ${fase}` : "", phase: fase,
        dossierType: rij.dossierType || "", innameType: type, hindrance: clean(rij.hindrance), streets: MET_STRATEN.has(soort) ? samenStraten(rij.streets) : [], faseSamenvatting: true,
      });
      continue;
    }
    if (MET_STRATEN.has(soort)) huidig.streets = samenStraten(huidig.streets, rij.streets);
    // "Parcours" telt als parcours (evenementFeiten): die naam wint binnen de soort.
    if (type === "Parcours") huidig.innameType = type;
    if (Number.isFinite(tijd(start)) && !(tijd(huidig.start) <= tijd(start))) huidig.start = start;
    if (Number.isFinite(tijd(end)) && !(tijd(huidig.end) >= tijd(end))) huidig.end = end;
    // Zoals evenementFeiten: "True" bij één rij met hinder.
    if (clean(rij.hindrance).toLowerCase() === "true") huidig.hindrance = "True";
    else if (!huidig.hindrance && rij.hindrance) huidig.hindrance = clean(rij.hindrance);
  }
  return new Map([...perDossier].map(([ref, fasen]) => [ref, [...fasen.values()]]));
}
// Een samenvatting die de rijen van de straat zelf al geven (zelfde fase en soort, zelfde begin en einde,
// "Parcours" en hinder al aanwezig), is overbodig: dan komt ze niet in het bestand.
const soortVan = (rij) => innameSoort(clean(rij?.innameType || rij?.title));
const isWaar = (waarde) => clean(waarde).toLowerCase() === "true";
export function alGedekt(samenvatting, eigenRijen = []) {
  const groep = eigenRijen.filter((r) => !r.faseSamenvatting && clean(r.phase) === samenvatting.phase && soortVan(r) === soortVan(samenvatting));
  if (!groep.length) return false;
  const eigenStraten = new Set(groep.flatMap((r) => (r.streets || []).map(refSleutel)));
  if ((samenvatting.streets || []).some((ref) => !eigenStraten.has(refSleutel(ref)))) return false;
  const begin = Math.min(...groep.map((r) => tijd(r.start)));
  const einde = Math.max(...groep.map((r) => tijd(r.end || r.start)));
  if (begin !== tijd(samenvatting.start) || einde !== tijd(samenvatting.end)) return false;
  if (samenvatting.innameType === "Parcours" && !groep.some((r) => clean(r.innameType || r.title) === "Parcours")) return false;
  return !isWaar(samenvatting.hindrance) || eigenRijen.some((r) => isWaar(r.hindrance));
}
// Velden van een samenvatting die altijd gelijk of leeg zijn: weg uit het bestand, vulAan zet ze terug.
export const SAMENVATTING_WEG = Object.freeze(["kindLabel", "title", "location", "detail", "status"]);

// Werfzones en parkeerverboden: de plekpagina maakt één kaart van alle rijen van hetzelfde dossier (een
// werfzone met al haar fasen en haar omleiding; een parkeerverbod met al zijn plaatsen op dezelfde dag en
// uren: bundelMaatregelen in site/place-core.js) en toont dan "Werfzone met omleiding", de hele periode, de
// fasen en "+ 4 andere straten". Een straatbestand bevat alleen de rijen van de straat zelf. Daarom komen de
// andere rijen van zo'n bundel er kort bij (`bundel`: zonder vorm, adres of omschrijving): een fase van een
// werfzone per rij, een parkeerverbod als één rij met de andere straten, met zijn verband (PARKEERVERBOD_VERBAND: het
// dossier van zijn werfzone en de sleutel van zijn evenement, als het er een heeft): de kaart is één parkeerverbod, en elke
// rij ervan hoort erbij. parkeerverbodVoorWerf (site/place-core.js) eist het dossier van de werfzone op elke rij.
export const BUNDEL_VELDEN = Object.freeze({
  sgw: Object.freeze(["id", "kind", "kindLabel", "title", "reference", "start", "end", "streets", "werfzoneStreets", "omleidingStreets"]),
  parking: Object.freeze(["id", "kind", "reference", "start", "end", "startTime", "endTime", "weekdaysOnly", "title", "streets", ...Object.keys(PARKEERVERBOD_VERBAND)]),
});
const refSleutel = (ref) => [ref?.id || "", clean(ref?.name), ref?.postcode || ""].join("|");
const uniekeRefs = (refs) => [...new Map(refs.filter((ref) => ref?.name).map((ref) => [refSleutel(ref), ref])).values()];
export function bundelRijen(rijen = []) {
  const perSleutel = new Map();
  for (const rij of rijen) {
    if ((rij?.kind !== "sgw" && rij?.kind !== "parking") || rij.bundel) continue;
    const sleutel = maatregelSleutel(rij);
    if (sleutel.startsWith("los|")) continue;
    perSleutel.set(sleutel, [...(perSleutel.get(sleutel) || []), rij]);
  }
  return perSleutel;
}
const kortVoorBundel = (rij) => ({ ...Object.fromEntries(BUNDEL_VELDEN[rij.kind].filter((veld) => rij[veld] !== undefined).map((veld) => [veld, rij[veld]])), bundel: true });
export function bundelAanvulling(eigenRijen = [], bundels = new Map()) {
  const eigen = eigenRijen.filter((rij) => (rij?.kind === "sgw" || rij?.kind === "parking") && !rij.bundel);
  const ids = new Set(eigen.map((rij) => rij.id));
  const uit = [];
  for (const sleutel of new Set(eigen.map(maatregelSleutel))) {
    const anderen = (bundels.get(sleutel) || []).filter((rij) => !ids.has(rij.id));
    if (!anderen.length) continue;
    if (sleutel.startsWith("sgw|")) uit.push(...anderen.map(kortVoorBundel));
    else uit.push({ ...kortVoorBundel(anderen[0]), id: `${anderen[0].id}|bundel`, streets: uniekeRefs(anderen.flatMap((rij) => rij.streets || [])) });
  }
  return uit;
}

// Alle items per straat-id: elk item in de straten waaraan het hangt (en een werk ook in de straten van
// zijn werfzone). Een evenementendossier dat de verversing kent, komt ook in de andere straten van zijn
// parcours, met één rij (bij voorkeur van de dag zelf): genoeg voor een kaart, die haar straten en
// uitleg uit kaart-uitleg.json haalt. Alle rijen van een groot parcours in elke straat zou een straatbestand
// van honderden kB maken. Elke straat met een evenementendossier krijgt er de samenvatting van zijn fasen bij.
export function verdeelOverStraten(lagen, { extra = () => [], dossier = () => null } = {}) {
  const perStraat = new Map();
  const plaats = (id) => {
    if (!perStraat.has(id)) perStraat.set(id, Object.fromEntries([...STRAAT_LAGEN.map(([naam]) => [naam, new Map()]), ["evenementen", new Map()]]));
    return perStraat.get(id);
  };
  const voorbeeld = new Map();
  for (const [naam] of [...STRAAT_LAGEN, ["evenementen"]]) {
    for (const item of lagen[naam] || []) {
      const refs = [...(Array.isArray(item.streets) ? item.streets : []), ...(item.__straten || []), ...extra(item)];
      for (const id of new Set(refs.map(straatSleutel).filter(Boolean))) plaats(id)[naam].set(item.id, item);
      if (naam === "publiekeRuimte" && isEvenementRij(item)) {
        const huidig = voorbeeld.get(item.reference);
        const beter = !huidig || (isEvenementFase(item) && !isEvenementFase(huidig)) || (isEvenementFase(item) === isEvenementFase(huidig) && String(item.start) < String(huidig.start));
        if (beter) voorbeeld.set(item.reference, item);
      }
    }
  }
  for (const [ref, rij] of voorbeeld) {
    for (const id of new Set((dossier(ref) || []).map(straatSleutel).filter(Boolean))) {
      const deel = plaats(id).publiekeRuimte;
      if (![...deel.values()].some((item) => item.reference === ref)) deel.set(rij.id, rij);
    }
  }
  // Na de rijen van de straat (de eerste rij van een dossier blijft een echte rij).
  const fasen = faseSamenvattingen(lagen.publiekeRuimte || []);
  for (const [id, delen] of perStraat) {
    const eigen = [...delen.publiekeRuimte.values()].filter(isEvenementRij);
    for (const ref of new Set(eigen.map((item) => clean(item.reference)))) {
      const rijen = eigen.filter((item) => clean(item.reference) === ref);
      for (const rij of fasen.get(ref) || []) {
        const kopie = { ...rij, streets: rij.streets.filter((straat) => straatSleutel(straat) !== id) };
        if (!alGedekt(kopie, rijen)) delen.publiekeRuimte.set(kopie.id, kopie);
      }
    }
  }
  const bundels = bundelRijen(lagen.publiekeRuimte || []);
  for (const delen of perStraat.values()) {
    for (const rij of bundelAanvulling([...delen.publiekeRuimte.values()], bundels)) if (!delen.publiekeRuimte.has(rij.id)) delen.publiekeRuimte.set(rij.id, rij);
  }
  return perStraat;
}

// De inhoud van één straat, met een korte hash van precies die inhoud. De items staan in de volgorde van
// de bron (zoals de live lagen ze sorteren): dan bundelt de plekpagina een parkeerverbod of terras met
// dezelfde eerste rij als live, en blijft een opengeklapte kaart open als de live stand binnenkomt.
// Straten staan één keer in "straten" ([id, naam, postcode]); een item verwijst ernaar met hun plaats in
// die lijst (straatItems in site/straat-snapshot.js zet ze terug). Bij een evenementendossier dat de
// verversing kent, houdt een rij alleen deze straat: de andere straten staan in kaart-uitleg.json.
// Geen homoniemtoevoeging van de straatas in een straatbestand (site/witte-lijst.js): de straten en teksten van nieuwe items
// zijn al zonder (straatasNaam, gipodTekst, itemVoorHistoriek), en wat uit een vorig bestand meegaat (een laag die niet
// laadde) wordt hier nog eens genormaliseerd. Een straat blijft één rij in de tabel: dezelfde id, naam en postcode.
export function straatDocument(id, delen, { namen = [], ververst = "", bewaard = () => false, extraKaders = [] } = {}) {
  const tabel = [];
  const plekVan = new Map();
  const plek = (ref) => {
    const naam = straatasNaam(ref?.name);
    const sleutel = [ref?.id || "", naam, ref?.postcode || ""].join("|");
    if (!plekVan.has(sleutel)) {
      plekVan.set(sleutel, tabel.length);
      tabel.push([String(ref?.id || ""), naam, String(ref?.postcode || "")]);
    }
    return plekVan.get(sleutel);
  };
  const lagen = {};
  // Het kader: de straat zelf en alles wat aan haar hangt (behalve evenementendossiers: hun parcours kan
  // het halve district beslaan, en hun kaart komt uit kaart-uitleg.json), naar buiten afgerond op 0,001°.
  const kaders = [...namen.map((ref) => ref.box), ...extraKaders].filter(Array.isArray);
  for (const naam of [...STRAAT_LAGEN.map(([n]) => n), "evenementen"]) {
    lagen[naam] = [...(delen[naam]?.values?.() || delen[naam] || [])].map((item) => {
      const { __straten, __kader, ...metToevoeging } = item;
      const rest = zonderToevoegingInData(metToevoeging);
      // Alleen kleine vormen: een grote (een omleiding, een groot perceel) hangt aan de straat omdat ze tot
      // 18 à 24 m van haar as komt, en valt dus al in het kader van de straat. Wat via een adres of een
      // genoemde straat aan de straat hangt (parkeerverbod, terras, werk), is klein en kan verder liggen.
      if (Array.isArray(__kader) && !isEvenementRij(rest) && __kader[2] - __kader[0] < 0.005 && __kader[3] - __kader[1] < 0.005) kaders.push(__kader);
      // Wat voor elk item van die soort gelijk is, zet site/straat-snapshot.js (vulAan) terug.
      for (const veld of WEGGELATEN[naam] || []) delete rest[veld];
      if (isEvenementRij(rest) && bewaard(rest.reference) && !rest.faseSamenvatting) rest.streets = (rest.streets || []).filter((ref) => straatSleutel(ref) === String(id));
      if (rest.faseSamenvatting) for (const veld of [...SAMENVATTING_WEG, ...(rest.streets?.length ? [] : ["streets"])]) delete rest[veld];
      return rest;
    });
  }
  // Eerst de straat zelf in de tabel, dan in vaste volgorde de rest.
  for (const ref of namen) plek(ref);
  for (const naam of Object.keys(lagen)) {
    lagen[naam] = lagen[naam].map((item) => {
      const uit = { ...item };
      for (const veld of STRAATVELDEN) if (Array.isArray(uit[veld])) uit[veld] = uit[veld].filter((ref) => ref?.name).map(plek);
      return uit;
    });
  }
  const kader = kaders.length ? [
    Math.floor(Math.min(...kaders.map((k) => k[0])) * 1000) / 1000, Math.floor(Math.min(...kaders.map((k) => k[1])) * 1000) / 1000,
    Math.ceil(Math.max(...kaders.map((k) => k[2])) * 1000) / 1000, Math.ceil(Math.max(...kaders.map((k) => k[3])) * 1000) / 1000,
  ] : null;
  const inhoud = { straat: { id: String(id), namen: namen.map(({ name, postcode }) => ({ name: straatasNaam(name), postcode })) }, ...(kader ? { kader } : {}), straten: tabel, ...lagen };
  const hash = kort(JSON.stringify(inhoud));
  return { schemaVersion: STRAAT_SCHEMA, ververst, inhoud: hash, ...inhoud };
}

// ---------- radar ----------

const TYPE = Object.freeze({ added: 1, changed: 2, removed: 3 });
// De radar uit de live historiek: per straat (id|naam|postcode, zoals street-overview.js) en per
// verversing het aantal nieuwe, gewijzigde en afgelopen items. Met dezelfde koppeling van een wijziging
// aan een straat als street-overview.js vroeger in de browser deed (het huidige item, anders after/before).
export function bouwRadar(history, { dagen = RADAR_DAGEN } = {}) {
  const observedAt = typeof history?.observedAt === "string" ? history.observedAt : "";
  const lagen = {};
  for (const [naam, laag] of Object.entries(isObject(history?.layers) ? history.layers : {})) if (laag?.status) lagen[naam] = { status: laag.status, ...(laag.lastSuccessAt ? { sinds: laag.lastSuccessAt } : {}) };
  const huidig = new Map();
  for (const laag of Object.values(isObject(history?.layers) ? history.layers : {})) for (const item of laag?.items || []) huidig.set(item.id, item);
  const grens = Date.parse(observedAt) - dagen * 86_400_000;
  const perStraat = new Map();
  const runs = new Set();
  for (const change of Array.isArray(history?.changes) ? history.changes : []) {
    const wanneer = Date.parse(change?.observedAt || "");
    const type = TYPE[change?.type];
    if (!Number.isFinite(wanneer) || !(wanneer >= grens) || !type) continue;
    const item = huidig.get(change.id) || change.after || change.before;
    for (const s of item?.streets || []) {
      if (!s?.name) continue;
      const sleutel = [s.id || "", s.name, s.postcode || ""].join("|");
      const perRun = perStraat.get(sleutel) || new Map();
      const tel = perRun.get(change.observedAt) || [0, 0, 0];
      tel[type - 1] += 1;
      perRun.set(change.observedAt, tel);
      perStraat.set(sleutel, perRun);
      runs.add(change.observedAt);
    }
  }
  const runLijst = [...runs].sort();
  const runIndex = new Map(runLijst.map((run, i) => [run, i]));
  const straten = {};
  for (const sleutel of [...perStraat.keys()].sort((a, b) => a.localeCompare(b, "nl"))) {
    straten[sleutel] = [...perStraat.get(sleutel)].sort(([a], [b]) => a.localeCompare(b)).map(([run, tel]) => [runIndex.get(run), ...tel]);
  }
  return { schemaVersion: STRAAT_SCHEMA, ververst: observedAt, lagen, runs: runLijst, straten };
}

// De radar die altijd in het budget past (50 kB, lib/straat-bestanden.mjs). validate-data en de toetsen
// in `npm run check` kijken dat budget elke ochtend na: een radar die op een drukke dag groter wordt,
// mag de verversing nooit rood maken. Daarom, in deze volgorde, tot hij past (`ingekort`):
// 1. de oudste dagen vallen weg (een week met twee verversingen per dag);
// 2. alleen de laatste verversing blijft (een verversing die bijna elke straat raakt);
// 3. de straten met de minste wijzigingen vallen weg (`weggelaten`: hoeveel).
export function radarBinnenBudget(history, { max = MAX_RADAR_BYTES, dagen = RADAR_DAGEN } = {}) {
  const past = (radar) => Buffer.byteLength(`${JSON.stringify(radar)}\n`) <= max;
  let radar = bouwRadar(history, { dagen });
  for (let d = dagen - 1; !past(radar) && d >= 1; d -= 1) radar = { ...bouwRadar(history, { dagen: d }), ingekort: true };
  if (past(radar)) return radar;
  const laatste = radar.runs.at(-1);
  const straten = Object.entries(radar.straten)
    .map(([sleutel, rijen]) => [sleutel, rijen.filter(([run]) => radar.runs[run] === laatste).map(([, ...tel]) => [0, ...tel])])
    .filter(([, rijen]) => rijen.length);
  radar = { ...radar, runs: laatste ? [laatste] : [], straten: Object.fromEntries(straten), ingekort: true };
  if (past(radar)) return radar;
  const totaal = ([, rijen]) => rijen.reduce((som, [, a, c, r]) => som + a + c + r, 0);
  const volgorde = [...straten].sort((a, b) => totaal(b) - totaal(a) || a[0].localeCompare(b[0], "nl"));
  const met = (n) => { const houd = new Set(volgorde.slice(0, n).map(([sleutel]) => sleutel)); return { ...radar, straten: Object.fromEntries(straten.filter(([sleutel]) => houd.has(sleutel))), weggelaten: volgorde.length - n }; };
  let n = volgorde.length;
  while (n > 0 && !past(met(n))) n = Math.min(n - 1, Math.floor(n * 0.9));
  return met(n);
}

// Schrijft site/history/radar.json uit de live historiek; geeft het aantal bytes (0 zonder historiek).
export function schrijfRadar(rootDir, history) {
  if (!history) return 0;
  const tekst = `${JSON.stringify(radarBinnenBudget(history))}\n`;
  fs.mkdirSync(path.dirname(path.join(rootDir, RADAR_BESTAND)), { recursive: true });
  fs.writeFileSync(path.join(rootDir, RADAR_BESTAND), tekst, "utf8");
  return Buffer.byteLength(tekst);
}

// ---------- schrijven ----------

function leesJson(bestand) {
  try {
    return JSON.parse(fs.readFileSync(bestand, "utf8"));
  } catch {
    return null;
  }
}

// De vorige straatbestanden (id → document), voor een laag die vandaag niet laadde.
export function vorigeDocumenten(map) {
  const docs = new Map();
  for (const naam of fs.existsSync(map) ? fs.readdirSync(map) : []) {
    if (!/^\d+\.json$/.test(naam)) continue;
    const doc = leesJson(path.join(map, naam));
    if (doc?.schemaVersion === STRAAT_SCHEMA) docs.set(naam.slice(0, -5), doc);
  }
  return docs;
}
// Hoeveel verschillende items een laag in alle vorige bestanden samen had (voor de krimpregel).
export function vorigAantal(docs, laag) {
  const ids = new Set();
  for (const doc of docs.values()) for (const item of Array.isArray(doc?.[laag]) ? doc[laag] : []) if (item?.id) ids.add(item.id);
  return ids.size;
}

// Welke agendapunten in welke straat: de locatie op een officiële straatnaam (zoals de plekpagina, met
// site/geo/locaties.json voor een geocodeerde locatie), alleen wat vandaag nog loopt of komt.
export function agendaPerStraat(items, { byName, locaties = {}, vandaag }) {
  const index = { byName };
  const uit = [];
  for (const item of items || []) {
    const einde = clean(item?.endDate || item?.date);
    if (!einde || einde < vandaag) continue;
    let refs = resolveAddressStreets(item.location || "", index).streets;
    if (!refs.length) {
      const entry = locaties?.[locationKey(item.location || "")];
      if (entry?.street) refs = (byName.get(locationKey(entry.street)) || []).filter((ref) => !entry.postcode || ref.postcode === String(entry.postcode));
    }
    if (!refs.length) continue;
    const punt = agendapuntVoorStraat(item);
    if (punt) uit.push({ ...punt, __straten: refs });
  }
  return uit;
}

// Schrijft site/straat/<id>.json, site/straat-index.json en site/history/radar.json.
// `herschrijf`: niets nieuws ophalen of lezen, alleen de bestaande straatbestanden opnieuw schrijven met de regels van nu
// (na een wijziging van de privacyregels, zoals scripts/opkuis-straatnamen.mjs); elke laag houdt haar vorige stand, en de
// index houdt het tijdstip en de stand van de laatste verversing.
// `siteAgenda`: de agenda zoals de site ze toont (agendaZoalsDeSite), alleen voor het evenement van een parkeerverbod uit een
// vorig straatbestand met de reden; zonder: uit `agendaItems`.
export function schrijfStraatSnapshots({ rootDir, bronnen = undefined, agendaItems = undefined, siteAgenda = undefined, history = undefined, clock = () => new Date(), log = () => {}, herschrijf = false } = {}) {
  const map = path.join(rootDir, STRAAT_MAP);
  const indexBestand = path.join(rootDir, STRAAT_INDEX);
  const vorigeIndex = leesJson(indexBestand);
  const nu = clock();
  const vandaag = brusselsDate(nu);
  const bron = herschrijf ? null : bronnen === undefined ? leesJson(path.join(rootDir, BRONNEN_BESTAND)) : bronnen;
  const ververst = typeof bron?.ververst === "string" && bron.ververst ? bron.ververst
    : herschrijf && typeof vorigeIndex?.ververst === "string" && vorigeIndex.ververst ? vorigeIndex.ververst : nu.toISOString();
  const vorigeDocs = vorigeDocumenten(map);

  // Per laag: de nieuwe items, of de vorige stand als de laag niet laadde of verdacht kromp. Die vorige
  // stand blijft per straat precies zoals ze was (houdVorige): uit elk vorig straatbestand die laag.
  const lagen = {};
  const stand = {};
  const houdVorige = new Set();
  for (const [naam] of STRAAT_LAGEN) {
    const nieuw = bron?.lagen?.[naam];
    const vorig = vorigAantal(vorigeDocs, naam);
    const vorigeStand = vorigeIndex?.lagen?.[naam] || null;
    const krimp = nieuw?.ok && vorig >= KRIMP_MINIMUM && nieuw.items.length < vorig * (1 - KRIMP_MAX_VERLIES);
    if (nieuw?.ok && Array.isArray(nieuw.items) && !krimp) {
      lagen[naam] = nieuw.items;
      stand[naam] = { status: "ok", sinds: ververst };
    } else {
      lagen[naam] = [];
      houdVorige.add(naam);
      stand[naam] = herschrijf && vorigeStand ? vorigeStand
        : { status: vorig ? "stale" : "error", ...(vorigeStand?.sinds ? { sinds: vorigeStand.sinds } : {}), errorCode: krimp ? "suspicious_drop" : nieuw?.errorCode || "niet_geladen" };
    }
  }
  // Wat vandaag niet meer loopt (de einddag in Brussel ligt voor vandaag), laten we weg, ook uit een
  // vorige stand. Vergunningen en terrassen hebben geen einddatum.
  const loopt = (item) => !item?.end || !dayOf(item.end) || dayOf(item.end) >= vandaag;
  for (const naam of ["werken", "publiekeRuimte"]) lagen[naam] = lagen[naam].filter(loopt);

  const straten = leesStraten(rootDir);
  const locaties = leesJson(path.join(rootDir, "site", "geo", "locaties.json"))?.entries || {};
  const uitleg = leesJson(path.join(rootDir, "site", "sources", "kaart-uitleg.json"));
  let agenda = [], uitgevouwen = [];
  try {
    uitgevouwen = agendaItems === undefined ? loadExpandedAgendaItems(rootDir) : agendaItems;
    agenda = agendaPerStraat(uitgevouwen, { byName: straten.byName, locaties, vandaag });
    stand.evenementen = { status: "ok", sinds: ververst };
  } catch {
    stand.evenementen = { status: "error", errorCode: "agenda_niet_gelezen" };
  }
  // Voor een parkeerverbod uit een vorig straatbestand dat nog de reden draagt (van vóór 18 oktober 2026): de agenda zoals
  // de site ze toont, één keer, en alleen als er zo een is.
  let koppelAgenda = null;
  const agendaVoorKoppeling = () => (koppelAgenda ??= siteAgenda === undefined ? agendaZoalsDeSite(uitgevouwen, vandaag) : siteAgenda);
  const metReden = (item) => item?.kind === "parking" && (typeof item.reason === "string" || (typeof item.title === "string" && !/^(?:Parkeerverbod|Tijdelijk parkeerverbod)$/.test(item.title)));
  lagen.evenementen = agenda;
  const perStraat = verdeelOverStraten(lagen, { extra: (item) => extraStratenVan(item, { uitleg, byName: straten.byName }), dossier: (ref) => dossierStraten(ref, { uitleg, byName: straten.byName }) });
  const bewaard = (ref) => Boolean(uitleg?.evenementen?.[ref]);

  fs.mkdirSync(map, { recursive: true });
  const index = {};
  const alleenLive = [];
  let geschreven = 0, ongewijzigd = 0, totaal = 0, grootste = 0, teGroot = 0;
  const blijft = new Set();
  const ids = new Set([...perStraat.keys(), ...(houdVorige.size ? vorigeDocs.keys() : [])]);
  for (const id of [...ids].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))) {
    if (!/^\d+$/.test(id) || !straten.perId.has(id)) continue;
    const delen = { ...(perStraat.get(id) || {}) };
    const vorigDoc = vorigeDocs.get(id);
    // De vorige stand zonder links naar een ruw GIPOD-record (uit een straatbestand van vóór 17 oktober 2026) en zonder
    // de reden van een parkeerverbod (uit een straatbestand van vóór 18 oktober 2026: titel "Parkeerverbod", geen
    // `reason`). Wat die reden intern deed, blijft: een parkeerverbod voor een werf krijgt eerst het dossier van zijn
    // werfzone (parkeerverbodenAanWerfzone, met de rijen van dat bestand, zoals de plekpagina ze toen bundelde), een
    // parkeerverbod voor een evenement de sleutel van zijn evenement (parkeerverbodenAanEvenement). Een item
    // uit een ouder bestand dat nog een homoniemtoevoeging draagt, gaat opnieuw door itemVoorStraat: in "PROEFSTRAAT_AN 1"
    // is die 1 na het weghalen van de toevoeging een huisnummer, en dat valt dan weg (of het item, als er nog iets privé in
    // staat), zoals bij een nieuw item.
    for (const naam of houdVorige) {
      const vorige = straatItems(vorigDoc, naam);
      const metVerband = naam !== "publiekeRuimte" ? vorige
        : parkeerverbodenAanEvenement(parkeerverbodenAanWerfzone(vorige), { agendaItems: vorige.some(metReden) ? agendaVoorKoppeling() : [], uitleg });
      const items = metVerband.filter((item) => naam === "vergunningen" || naam === "terrassen" || loopt(item)).map(zonderParkeerReden);
      delen[naam] = new Map(items.map((item) => (metToevoeging(item) ? itemVoorStraat(item, { laag: naam }) : zonderRuweGipodLinks(item))).filter(Boolean).map((item) => [item.id, item]));
    }
    const doc = straatDocument(id, delen, { namen: straten.perId.get(id), ververst, bewaard, extraKaders: houdVorige.size && Array.isArray(vorigDoc?.kader) ? [vorigDoc.kader] : [] });
    if (!aantalItems(doc)) continue;
    const bestand = path.join(map, `${id}.json`);
    const vorig = leesJson(bestand);
    let tekst = `${JSON.stringify(vorig?.inhoud === doc.inhoud ? vorig : doc)}\n`;
    if (Buffer.byteLength(tekst) > MAX_STRAAT_BYTES) {
      // Te groot: geen bestand. De straat staat dan in de index onder "alleenLive", en de plekpagina
      // haalt ze zoals vroeger live op. Met de data van oktober 2026 gebeurt dat niet (grootste: zie de log).
      teGroot += 1;
      alleenLive.push(id);
      continue;
    }
    const inhoud = JSON.parse(tekst).inhoud;
    if (vorig?.inhoud === inhoud) ongewijzigd += 1;
    else {
      fs.writeFileSync(bestand, tekst, "utf8");
      geschreven += 1;
    }
    blijft.add(`${id}.json`);
    index[id] = inhoud;
    totaal += Buffer.byteLength(tekst);
    grootste = Math.max(grootste, Buffer.byteLength(tekst));
  }
  // Straten zonder items: hun bestand verdwijnt (alleen bestanden van de vorm <id>.json).
  let weg = 0;
  for (const naam of fs.readdirSync(map)) {
    if (/^\d+\.json$/.test(naam) && !blijft.has(naam)) {
      fs.rmSync(path.join(map, naam));
      weg += 1;
    }
  }
  const indexDoc = { schemaVersion: STRAAT_SCHEMA, ververst, lagen: stand, straten: index, ...(alleenLive.length ? { alleenLive } : {}) };
  fs.writeFileSync(indexBestand, `${JSON.stringify(indexDoc)}\n`, "utf8");

  // De radar uit de live historiek (site/history/live-layers.json).
  const geschiedenis = history === undefined ? leesJson(path.join(rootDir, "site", "history", "live-layers.json")) : history;
  const radarBytes = schrijfRadar(rootDir, geschiedenis);
  const uitslag = { straten: Object.keys(index).length, geschreven, ongewijzigd, weg, teGroot, totaalBytes: totaal, grootsteBytes: grootste, radarBytes, lagen: Object.fromEntries(Object.entries(stand).map(([naam, s]) => [naam, s.status])) };
  log(JSON.stringify({ straatSnapshots: uitslag }));
  return uitslag;
}

if (isMainModule(import.meta.url)) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  try {
    // --alleen-radar: alleen site/history/radar.json opnieuw uit live-layers.json (bv. na een merge van
    // main met een nieuwere historiek); de straatbestanden blijven zoals ze zijn.
    if (process.argv.includes("--alleen-radar")) {
      console.log(JSON.stringify({ radarBytes: schrijfRadar(rootDir, leesJson(path.join(rootDir, "site", "history", "live-layers.json"))) }));
    } else {
      schrijfStraatSnapshots({ rootDir, log: console.log });
      // Het tussenbestand is gebruikt; de volgende verversing maakt een nieuw.
      fs.rmSync(path.join(rootDir, BRONNEN_BESTAND), { force: true });
    }
  } catch (error) {
    // Een fout hier maakt de verversing niet rood: de straatbestanden van gisteren blijven staan.
    console.log(JSON.stringify({ straatSnapshots: "niet gelukt", soort: error?.name || "Error" }));
  }
}
