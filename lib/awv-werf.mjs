// AWV-werfdata: de open data "Werf" van het Agentschap Wegen en Verkeer (AWV), als aanvulling op de
// GIPOD-werkenlaag. Geen agendabron: er komen geen eigen agendapunten uit, alleen extra uitleg bij een werk
// dat al in de lijst staat, gekoppeld op exact hetzelfde GIPOD-id (site/works-awv-supplement.js).
//
// Stand 17 oktober 2026 (docs/WORKS_LIVE_SOURCE_POLICY.md): 129 bevestigde AWV-innames raken district
// Antwerpen; 118 ervan dragen een GIPOD-id en die 118 staan al in de werkenlaag. AWV voegt toe wat GIPOD voor
// die werken mist: welke rijstroken ingenomen zijn, doorgang, snelheidsbeperking, lokale omleidingen, de werf
// waartoe een record hoort en de fase.
//
// Puur: geen netwerk, geen klok. scripts/fetch-sources-awv-werf.mjs haalt op en schrijft
// site/sources/awv-werf-supplement.json. Alleen een vaste lijst velden wordt gevraagd (nooit Omschrijving,
// URL of Buffer_publicatie), en elke tekst gaat door een woordenlijst: wat niet past, valt weg.
import { isValidIsoDate } from "./html-text.mjs";

export const AWV_WERF_SOURCE_ID = "awv-werf-supplement";
export const AWV_WERF_FILE = `${AWV_WERF_SOURCE_ID}.json`;
export const AWV_WFS_URL = "https://opendata.apps.mow.vlaanderen.be/opendata-geoserver/awv/wfs";
// De metadatafiche van "Werf - Werven" (Modellicentie gratis hergebruik v1.0, "Bron: AWV").
export const AWV_METADATA_URL = "https://metadata.vlaanderen.be/srv/api/records/cb01ab0d-c288-441f-8b38-ed3b49af5b03";
// Het kader van district Antwerpen in Lambert 72 (EPSG:31370); de exacte grens toetst de fetcher daarna.
export const AWV_KADER = Object.freeze([145255, 207274, 155282, 222646]);
// Alleen bevestigde werven. "InOpmaak" en "NietConcreetGepland" zijn vroege planning en komen nooit binnen.
export const BEVESTIGDE_STATUSSEN = Object.freeze(["InUitvoering", "ConcreetGepland", "ConcreetVoorUitvoering"]);
// De vaste lijst velden van een inname. Nooit Omschrijving (vrije tekst), URL of Buffer_publicatie.
export const INNAME_VELDEN = Object.freeze([
  "Werf_ID", "GIPOD_ID", "Afdeling", "Type", "Status", "Fase", "Inname_van_datum", "Inname_tot_datum",
  "Innametypes", "Milderende_maatregelen", "Op_UV_route", "Gewijzigd_op", "geometry",
]);
// Van een lokale omleiding alleen de koppeling en voor wie ze geldt; de lijn zelf is (nog) niet nodig.
export const OMLEIDING_VELDEN = Object.freeze(["Werf_ID", "Inname_ID", "Type_weggebruiker"]);
// Hoogstens zoveel innames per vraag. Komt de vraag aan die grens, dan is ze misschien afgekapt: dan faalt de bron.
export const MAX_INNAMES = 2000;
// Een blok van 200 uuid's gaf HTTP 414 (URL te lang); 120 werkte. Dus hoogstens 100 per vraag.
export const OMLEIDING_BLOK = 100;
export const MAX_ITEMS = 1500;

const clean = (value, max = 200) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const uniek = (lijst) => [...new Set(lijst)];
const DAG = /^\d{4}-\d{2}-\d{2}/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- vragen ----------

// De innames in het kader van het district die vandaag nog lopen of komen, met een bevestigde status. De
// server rekent in EPSG:3857 terug (srsName): in WGS84 rondt hij af op 3 decimalen (70 tot 110 m), in 3857 op
// de millimeter. De BBOX blijft in Lambert 72 (gemeten: 174 van 174 innames).
export function innamesUrl(vandaag) {
  if (!isValidIsoDate(vandaag)) throw new Error("ongeldige datum voor de AWV-vraag");
  const url = new URL(AWV_WFS_URL);
  url.search = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: "awv:Werf_Innames",
    outputFormat: "application/json",
    srsName: "EPSG:3857",
    count: String(MAX_INNAMES),
    propertyName: INNAME_VELDEN.join(","),
    CQL_FILTER: `BBOX(geometry,${AWV_KADER.join(",")},'EPSG:31370') AND Inname_tot_datum >= '${vandaag}' AND Status IN (${BEVESTIGDE_STATUSSEN.map((s) => `'${s}'`).join(",")})`,
  }).toString();
  return url.href;
}

// De lokale omleidingen van een blok innames (hoogstens OMLEIDING_BLOK uuid's).
export function omleidingenUrl(uuids) {
  const lijst = uniek((Array.isArray(uuids) ? uuids : []).filter((u) => UUID.test(String(u))));
  if (!lijst.length || lijst.length > OMLEIDING_BLOK) throw new Error("ongeldig blok innames voor de omleidingen");
  const url = new URL(AWV_WFS_URL);
  url.search = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: "awv:Werf_Lokale_omleidingen",
    outputFormat: "application/json",
    count: String(MAX_INNAMES),
    propertyName: OMLEIDING_VELDEN.join(","),
    CQL_FILTER: `Inname_ID IN (${lijst.map((u) => `'${u}'`).join(",")})`,
  }).toString();
  return url.href;
}

export function inBlokken(lijst, grootte = OMLEIDING_BLOK) {
  const blokken = [];
  for (let i = 0; i < lijst.length; i += grootte) blokken.push(lijst.slice(i, i + grootte));
  return blokken;
}

// ---------- coördinaten ----------

// Web Mercator (EPSG:3857) terug naar lengte- en breedtegraad (WGS84), met de exacte formule. Gemeten tegen
// pyproj 31370 -> 4326: verschil kleiner dan 1 cm. 7 decimalen is ongeveer 1 cm.
const STRAAL = 6378137;
const rond = (getal) => Math.round(getal * 1e7) / 1e7;
export function vanMercator(punt) {
  const [x, y] = Array.isArray(punt) ? punt : [];
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const lon = (x / STRAAL) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(y / STRAAL)) - Math.PI / 2) * (180 / Math.PI);
  return [rond(lon), rond(lat)];
}

// Een (Multi)LineString in EPSG:3857 als GeoJSON in WGS84; null bij een andere vorm of een ongeldig punt.
export function lijnNaarWgs84(geometry) {
  const lijnen = geometry?.type === "LineString" ? [geometry.coordinates] : geometry?.type === "MultiLineString" ? geometry.coordinates : null;
  if (!Array.isArray(lijnen) || !lijnen.length) return null;
  const uit = [];
  for (const lijn of lijnen) {
    if (!Array.isArray(lijn) || !lijn.length) return null;
    const punten = lijn.map(vanMercator);
    if (punten.some((p) => !p)) return null;
    uit.push(punten);
  }
  return { type: "MultiLineString", coordinates: uit };
}

// ---------- woordenlijsten ----------

// Fase: vrije tekst van hoogstens 10 tekens ("2B+3D+FL D", "KB/00592", soms initialen of een stuk straatnaam).
// Alleen "Fase" met een code die met een cijfer begint ("Fase 2", "Fase 1CB") of een maandnaam gaat mee.
const MAANDEN = Object.freeze(["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"]);
const FASE = /^[Ff]ase ?(\d[0-9A-Z+]{0,5})$/;
export function fase(value) {
  const tekst = clean(value, 20);
  const code = tekst.match(FASE);
  if (code) return `Fase ${code[1]}`;
  const maand = tekst.toLowerCase();
  return MAANDEN.includes(maand) ? maand : "";
}
export const geldigeFase = (value) => typeof value === "string" && (/^Fase \d[0-9A-Z+]{0,5}$/.test(value) || MAANDEN.includes(value));

// Innametypes: welke delen van de weg ingenomen zijn ("Rijstrook 3,2,1;Middenberm").
const RIJSTROOK = /^Rijstrook \d(?:,\d){0,5}$/;
const VASTE_INNAMETYPES = Object.freeze(["Volledige rijbaan", "Pechstrook", "Middenberm", "Tussenberm", "Zijberm", "Fietspad", "Parkeerstrook", "Mobiele werf"]);
export const geldigInnametype = (value) => typeof value === "string" && (RIJSTROOK.test(value) || VASTE_INNAMETYPES.includes(value));
export function innametypes(value) {
  const uit = [];
  for (const deel of String(value ?? "").split(";")) {
    const t = clean(deel, 40).replace(/\s*,\s*/g, ",");
    const vast = VASTE_INNAMETYPES.find((v) => v.toLowerCase() === t.toLowerCase());
    const rijstrook = t.match(/^rijstrook (\d(?:,\d){0,5})$/i);
    if (vast) uit.push(vast);
    else if (rijstrook) uit.push(`Rijstrook ${rijstrook[1]}`);
  }
  return uniek(uit);
}

// Voor wie een omleiding geldt, in gewone woorden, in een vaste volgorde.
export const OMLEIDING_VOOR = Object.freeze(["alle verkeer", "voertuigen tot 3,5 ton", "voertuigen boven 3,5 ton", "voertuigen boven 7,5 ton", "fietsers", "voetgangers"]);
const OMLEIDING_WOORD = Object.freeze({ alle: "alle verkeer", fietsers: "fietsers", voetgangers: "voetgangers", "<3,5t": "voertuigen tot 3,5 ton", ">3,5t": "voertuigen boven 3,5 ton", ">7,5t": "voertuigen boven 7,5 ton" });
const WEGGEBRUIKER = Object.freeze({
  ALLE_WEGGEBRUIKERS: "alle verkeer",
  FIETSERS: "fietsers",
  VOETGANGERS: "voetgangers",
  GEMOTORISEERD_VERKEER_MINDER_DAN_3500KG: "voertuigen tot 3,5 ton",
  GEMOTORISEERD_VERKEER_MEER_DAN_3500KG: "voertuigen boven 3,5 ton",
  GEMOTORISEERD_VERKEER_MEER_DAN_7500KG: "voertuigen boven 7,5 ton",
});
const inVolgorde = (lijst) => OMLEIDING_VOOR.filter((v) => lijst.includes(v));
// Type_weggebruiker van een lokale omleiding ("GEMOTORISEERD_VERKEER_MEER_DAN_3500kg,FIETSERS").
export function weggebruikers(value) {
  return inVolgorde(String(value ?? "").split(",").map((t) => WEGGEBRUIKER[clean(t, 60).toUpperCase()]).filter(Boolean));
}

const rijstroken = (n) => `${n} ${n === "1" ? "rijstrook" : "rijstroken"}`;
const DOORGANG = /^\d (?:rijstrook|rijstroken)(?:, versmald)?$/;
const BYPASS = /^\d (?:rijstrook|rijstroken)$/;
// Milderende_maatregelen: "Doorgang: 1 rijstroken versmald;Snelheidsbeperking;Omleidingen: fietsers (2)".
// Alleen wat in de woordenlijst past; de rest valt weg.
export function maatregelen(value) {
  const uit = { doorgang: [], snelheidsbeperking: false, doorsteek: false, bypass: [], omleidingVoor: [] };
  for (const deel of String(value ?? "").split(";")) {
    const t = clean(deel, 120);
    if (!t) continue;
    if (/^snelheidsbeperking$/i.test(t)) { uit.snelheidsbeperking = true; continue; }
    if (/^doorsteek$/i.test(t)) { uit.doorsteek = true; continue; }
    const doorgang = t.match(/^doorgang: (\d) rijstro(?:ok|ken)( versmald)?$/i);
    if (doorgang) { uit.doorgang.push(`${rijstroken(doorgang[1])}${doorgang[2] ? ", versmald" : ""}`); continue; }
    const bypass = t.match(/^tijdelijke bypass: (\d) rijstro(?:ok|ken)$/i);
    if (bypass) { uit.bypass.push(rijstroken(bypass[1])); continue; }
    const omleiding = t.match(/^omleidingen: (.+)$/i);
    if (omleiding) {
      // "<3,5t, >3,5t, >7,5t": de komma in 3,5 heeft geen spatie erachter, de komma tussen twee groepen wel.
      for (const groep of omleiding[1].split(/,\s+/)) {
        const woord = OMLEIDING_WOORD[clean(groep, 30).replace(/\s*\(\d+\)$/, "").toLowerCase()];
        if (woord) uit.omleidingVoor.push(woord);
      }
    }
  }
  return { ...uit, doorgang: uniek(uit.doorgang), bypass: uniek(uit.bypass), omleidingVoor: inVolgorde(uit.omleidingVoor) };
}

// Afdeling: Antwerpen, Lantis of TO (tunnelorganisatie). Een andere afdeling (zoals "NV Liefkenshoektunnel" of
// "Oost-Vlaanderen", in het kader maar niet in het district) wordt "AWV".
export const AFDELINGEN = Object.freeze(["Antwerpen", "Lantis", "TO", "AWV"]);
export function afdeling(value) {
  const t = clean(value, 60);
  return ["Antwerpen", "Lantis", "TO"].includes(t) ? t : "AWV";
}

// Type: een lijst vaste categorieën, gescheiden door ", " ("(Her)aanleg - Rijbaan incl. riolering, VRI").
// Alleen letters, haakjes, punten, spaties en streepjes: nooit een cijfer, dus nooit een huisnummer.
const SOORT = /^[A-Za-z(][A-Za-z() .-]{1,79}$/;
export const geldigeSoort = (value) => typeof value === "string" && SOORT.test(value);
export function soortWerk(value) {
  return uniek(String(value ?? "").split(/,\s+/).map((t) => clean(t, 80)).filter((t) => SOORT.test(t))).slice(0, 10);
}

// Een datum zonder tijdzone ("2026-09-06T07:00:00", lokale tijd): de kalenderdag.
export function dag(value) {
  const t = clean(value, 40);
  return DAG.test(t) && isValidIsoDate(t.slice(0, 10)) ? t.slice(0, 10) : "";
}

// ---------- lezen ----------

const uuidVan = (feature) => {
  const id = clean(feature?.id, 80);
  const match = id.match(/^Werf_Innames\.(.+)$/);
  return match && UUID.test(match[1]) ? match[1].toLowerCase() : "";
};

// Leest het antwoord op innamesUrl. Geeft { innames, tellers } of { fout } (een foutcode): de bron faalt dan
// gesloten. `raaktDistrict(geometrie)`: raakt de lijn (WGS84) de exacte districtsgrens?
//   - fout "awv_ongeldig": geen FeatureCollection;
//   - fout "awv_afgekapt": de server meldt meer innames dan hij gaf, of de vraag zat aan MAX_INNAMES.
// Een inname telt alleen met een bevestigde status, een GIPOD-id, een geldige van- en totdatum (tot vandaag of
// later) en een lijn die de grens raakt. Een lege totdatum valt bewust weg: zonder einde geen aanvulling.
export function leesInnames(collection, { vandaag, raaktDistrict = () => false } = {}) {
  if (!collection || collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) return { fout: "awv_ongeldig" };
  const features = collection.features;
  const gemeld = [collection.numberMatched, collection.totalFeatures].filter(Number.isInteger);
  if (features.length >= MAX_INNAMES || gemeld.some((n) => n > features.length)) return { fout: "awv_afgekapt" };
  const tellers = { gelezen: features.length, status: 0, geen_id: 0, geen_gipod: 0, geen_einddatum: 0, datum: 0, voorbij: 0, geometrie: 0, buiten_district: 0, bewaard: 0 };
  const innames = [];
  for (const feature of features) {
    const p = feature?.properties || {};
    if (!BEVESTIGDE_STATUSSEN.includes(clean(p.Status, 40))) { tellers.status += 1; continue; }
    const uuid = uuidVan(feature);
    if (!uuid) { tellers.geen_id += 1; continue; }
    const gipodId = Number(p.GIPOD_ID);
    if (!Number.isSafeInteger(gipodId) || gipodId <= 0) { tellers.geen_gipod += 1; continue; }
    const van = dag(p.Inname_van_datum), tot = dag(p.Inname_tot_datum);
    if (!tot) { tellers.geen_einddatum += 1; continue; }
    if (!van || tot < van) { tellers.datum += 1; continue; }
    if (isValidIsoDate(vandaag) && tot < vandaag) { tellers.voorbij += 1; continue; }
    const lijn = lijnNaarWgs84(feature?.geometry);
    if (!lijn) { tellers.geometrie += 1; continue; }
    if (!raaktDistrict(lijn)) { tellers.buiten_district += 1; continue; }
    const werfId = Number(p.Werf_ID);
    innames.push({
      uuid,
      gipodId,
      werfId: Number.isSafeInteger(werfId) && werfId > 0 ? werfId : 0,
      afdeling: afdeling(p.Afdeling),
      soort: soortWerk(p.Type),
      fase: fase(p.Fase),
      van,
      tot,
      innametypes: innametypes(p.Innametypes),
      maatregelen: maatregelen(p.Milderende_maatregelen),
      opUvRoute: p.Op_UV_route === true,
      gewijzigd: dag(p.Gewijzigd_op),
    });
    tellers.bewaard += 1;
  }
  return { innames, tellers };
}

// Leest de antwoorden op omleidingenUrl: per inname-uuid hoeveel omleidingen en voor wie. Alleen voor innames
// in `uuids`. Geeft { perInname } of { fout }.
export function leesOmleidingen(collections = [], uuids = []) {
  const welke = new Set(uuids);
  const perInname = new Map();
  for (const collection of collections) {
    if (!collection || collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) return { fout: "awv_ongeldig" };
    const gemeld = [collection.numberMatched, collection.totalFeatures].filter(Number.isInteger);
    if (collection.features.length >= MAX_INNAMES || gemeld.some((n) => n > collection.features.length)) return { fout: "awv_afgekapt" };
    for (const feature of collection.features) {
      const p = feature?.properties || {};
      const uuid = clean(p.Inname_ID, 60).toLowerCase();
      if (!welke.has(uuid)) continue;
      const huidig = perInname.get(uuid) || { aantal: 0, voor: [] };
      huidig.aantal += 1;
      huidig.voor = inVolgorde([...huidig.voor, ...weggebruikers(p.Type_weggebruiker)]);
      perInname.set(uuid, huidig);
    }
  }
  return { perInname };
}

// ---------- bouwen ----------

const vroegste = (a, b) => (!a ? b : !b ? a : a < b ? a : b);
const laatste = (a, b) => (!a ? b : !b ? a : a > b ? a : b);

// Eén item per GIPOD-id: de innames met dat id samen (een inname heeft in de praktijk één GIPOD-id, maar
// een GIPOD-id kan meer innames hebben). date/endDate: de vroegste van- en de laatste totdatum, zodat de
// eerlijke bronstatus (upcomingCount) telt wat nog loopt of komt.
export function bouwSupplement(innames = [], perInname = new Map()) {
  const perGipod = new Map();
  for (const inname of innames) {
    const omleiding = perInname.get(inname.uuid) || { aantal: 0, voor: [] };
    const huidig = perGipod.get(inname.gipodId) || {
      gipodId: inname.gipodId, werfId: inname.werfId, afdeling: inname.afdeling, soort: [], fasen: [], date: "", endDate: "",
      innametypes: [], doorgang: [], snelheidsbeperking: false, doorsteek: false, bypass: [], omleidingVoor: [], lokaleOmleidingen: 0,
      opUvRoute: false, gewijzigd: "", innames: 0,
    };
    if (!huidig.werfId || (inname.werfId && inname.werfId < huidig.werfId)) huidig.werfId = inname.werfId;
    huidig.soort = uniek([...huidig.soort, ...inname.soort]).slice(0, 10);
    if (inname.fase) huidig.fasen = uniek([...huidig.fasen, inname.fase]).slice(0, 4);
    huidig.date = vroegste(huidig.date, inname.van);
    huidig.endDate = laatste(huidig.endDate, inname.tot);
    huidig.innametypes = uniek([...huidig.innametypes, ...inname.innametypes]).slice(0, 12);
    huidig.doorgang = uniek([...huidig.doorgang, ...inname.maatregelen.doorgang]).slice(0, 6);
    huidig.snelheidsbeperking ||= inname.maatregelen.snelheidsbeperking;
    huidig.doorsteek ||= inname.maatregelen.doorsteek;
    huidig.bypass = uniek([...huidig.bypass, ...inname.maatregelen.bypass]).slice(0, 3);
    huidig.omleidingVoor = inVolgorde([...huidig.omleidingVoor, ...inname.maatregelen.omleidingVoor, ...omleiding.voor]);
    huidig.lokaleOmleidingen += omleiding.aantal;
    huidig.opUvRoute ||= inname.opUvRoute;
    huidig.gewijzigd = laatste(huidig.gewijzigd, inname.gewijzigd);
    huidig.innames += 1;
    perGipod.set(inname.gipodId, huidig);
  }
  return normalizeAwvSupplementItems([...perGipod.values()]);
}

// De jongste wijziging in de data ("bijgewerkt op", zoals het gebruiksrecht van AWV vraagt); null zonder.
export function jongsteWijziging(items = []) {
  return items.reduce((max, item) => laatste(max, isValidIsoDate(item?.gewijzigd) ? item.gewijzigd : ""), "") || null;
}

// ---------- vorm van het bestand ----------

export const ITEM_SLEUTELS = Object.freeze([
  "gipodId", "werfId", "afdeling", "soort", "fasen", "date", "endDate", "innametypes", "doorgang", "snelheidsbeperking",
  "doorsteek", "bypass", "omleidingVoor", "lokaleOmleidingen", "opUvRoute", "gewijzigd", "innames",
]);

// Vaste sleutelvolgorde, gesorteerd op GIPOD-id (sourceDocument in lib/source-feed.mjs gebruikt dit).
export function normalizeAwvSupplementItems(items = []) {
  return [...items]
    .map((item) => Object.fromEntries(ITEM_SLEUTELS.filter((key) => item?.[key] !== undefined).map((key) => [key, item[key]])))
    .sort((a, b) => (Number(a.gipodId) || 0) - (Number(b.gipodId) || 0));
}

const lijstVan = (value, max, geldig) => Array.isArray(value) && value.length <= max && new Set(value).size === value.length && value.every(geldig);

// Fouten in de items van site/sources/awv-werf-supplement.json; leeg is in orde. validateSourceDocument
// (lib/source-feed.mjs) roept dit op voor een aanvulling, in plaats van de regels voor agendapunten.
export function validateAwvSupplementItems(items) {
  const errors = [];
  if (!Array.isArray(items)) return ["items is geen array"];
  if (items.length > MAX_ITEMS) errors.push("te veel items");
  let vorige = 0;
  items.forEach((item, index) => {
    const at = `items[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) { errors.push(`${at}: geen object`); return; }
    for (const key of Object.keys(item)) if (!ITEM_SLEUTELS.includes(key)) errors.push(`${at}: onbekende sleutel ${key}`);
    for (const key of ITEM_SLEUTELS) if (!(key in item)) errors.push(`${at}: ${key} ontbreekt`);
    if (!Number.isSafeInteger(item.gipodId) || item.gipodId <= 0) errors.push(`${at}: ongeldig gipodId`);
    else if (item.gipodId <= vorige) errors.push(`${at}: niet gesorteerd op gipodId of dubbel`);
    else vorige = item.gipodId;
    if (!Number.isSafeInteger(item.werfId) || item.werfId < 0) errors.push(`${at}: ongeldig werfId`);
    if (!AFDELINGEN.includes(item.afdeling)) errors.push(`${at}: ongeldige afdeling`);
    if (!lijstVan(item.soort, 10, geldigeSoort)) errors.push(`${at}: ongeldige soort`);
    if (!lijstVan(item.fasen, 4, geldigeFase)) errors.push(`${at}: ongeldige fasen`);
    if (!isValidIsoDate(item.date)) errors.push(`${at}: ongeldige date`);
    if (!isValidIsoDate(item.endDate) || item.endDate < item.date) errors.push(`${at}: ongeldige endDate`);
    if (!lijstVan(item.innametypes, 12, geldigInnametype)) errors.push(`${at}: ongeldige innametypes`);
    if (!lijstVan(item.doorgang, 6, (v) => typeof v === "string" && DOORGANG.test(v))) errors.push(`${at}: ongeldige doorgang`);
    if (!lijstVan(item.bypass, 3, (v) => typeof v === "string" && BYPASS.test(v))) errors.push(`${at}: ongeldige bypass`);
    if (!lijstVan(item.omleidingVoor, OMLEIDING_VOOR.length, (v) => OMLEIDING_VOOR.includes(v))) errors.push(`${at}: ongeldige omleidingVoor`);
    for (const key of ["snelheidsbeperking", "doorsteek", "opUvRoute"]) if (typeof item[key] !== "boolean") errors.push(`${at}: ${key} moet boolean zijn`);
    if (!Number.isInteger(item.lokaleOmleidingen) || item.lokaleOmleidingen < 0 || item.lokaleOmleidingen > 200) errors.push(`${at}: ongeldige lokaleOmleidingen`);
    if (!(item.gewijzigd === "" || isValidIsoDate(item.gewijzigd))) errors.push(`${at}: ongeldige gewijzigd`);
    if (!Number.isInteger(item.innames) || item.innames < 1 || item.innames > 200) errors.push(`${at}: ongeldige innames`);
  });
  return errors;
}
