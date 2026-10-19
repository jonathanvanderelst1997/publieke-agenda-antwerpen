// Werken: adreskaart of gewone kaart. Besluit van de eigenaar (18 oktober 2026): "liefst exacte adres, ... maar moet wel
// nuttig zijn en weten waar", en nooit een spoor van een verhuizing.
//
// Elk GIPOD-werk heeft op elke uitgang (de kaart, de lijst en het zoeken, street-overview en week-pulse, de historiek, de
// straatbestanden en kaart-uitleg.json) precies één vorm:
// - ADRESKAART (A): alleen vaste gegevens van GIPOD: de soort uit de vaste lijst, de officiële straten, één huisnummer of
//   een reeks, de data en de gevolgen, de fasen als "Fase n" en de groep van de opdrachtgever. Nooit vrije tekst: het item
//   wordt opgebouwd uit een witte lijst (adreskaartItem), niet geknipt. Wat niet op de lijst staat, bestaat niet.
// - GEWOON (B): de kaart van main, die nooit één los huisnummer toont.
// Zo staan een exact nummer en vrije tekst per constructie nooit samen: een leesfout kost hoogstens een nummer.
//
// De vorm hangt aan het werk-id en verandert nooit (site/sources/werk-vorm.json; één schrijver:
// scripts/refresh-live-history.mjs; de overgang: scripts/maak-werk-vorm.mjs). Docs: docs/PUBLIC_SPACE_SOURCE_POLICY.md,
// "Werken: adreskaart of gewone kaart".
import {
  CONTACT, LEGE_FASE, beheerderTekst, faseBuitenDistrict, geldigeHuisnummers, huisnummersUitTekst, isSoortLabel, werkFeiten,
  zonderLosseHuisnummers, zonderNamen,
} from "./kaart-uitleg.js";
import { GROEPEN } from "./works-core.js";

export const WERK_VORM_FILE = "werk-vorm.json";
export const WERK_VORM_SCHEMA = 1;
export const GEEN_TITEL = "Werk in openbaar domein";
const isObject = (v) => v && typeof v === "object" && !Array.isArray(v);
const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

// ---------- verhuis ----------

// Het woord, ook met een verborgen teken of een accent: NFKD, zonder opmaaktekens (\p{Cf}: een zachte afbreking, een
// zero-width teken) en zonder combinerende accenten (\p{M}).
export const verhuisVorm = (value = "") => String(value ?? "").normalize("NFKD").replace(/[\p{Cf}\p{M}]/gu, "");
// Cyrillische en Griekse letters die op een Latijnse lijken ("Vеrhuis" met een Cyrillische е). Na de kleine letters, zodat
// ook een hoofdletter (Е) meetelt.
const LIJKT_OP = Object.freeze({ а: "a", е: "e", һ: "h", і: "i", ј: "j", о: "o", р: "p", ѕ: "s", с: "c", у: "y", х: "x", ԁ: "d", ν: "v", υ: "u", ι: "i", ο: "o", τ: "t", κ: "k", ʋ: "v" });
const LIJKT = new RegExp(`[${Object.keys(LIJKT_OP).join("")}]`, "gu");
// De vorm waarop het spoor gezocht wordt: ook "ver huis", "ver-huis" en "ver.huis" (zonder spaties en leestekens ertussen).
export const spoorVorm = (value = "") => verhuisVorm(value).toLowerCase().replace(LIJKT, (c) => LIJKT_OP[c]).replace(/[\s._·'’/-]/gu, "");
const SPOOR = /verhui[sz]|(?:in|uit)huiz|ladderlift/;
// Gecontroleerd: geen enkele officiële straat van het district past hierop (tests/werk-vorm.test.mjs).
export const VERHUIS_SPOOR = Object.freeze({ test: (value) => SPOOR.test(spoorVorm(value)) });
// "(Verhuis)lift/levering", in elke schrijfwijze, wordt "Lift/levering", ook in een lijst ("Container;(Verhuis)lift/levering").
// Een andere soort met het spoor wordt "Andere" (zoals GIPOD een soort zonder naam noemt).
export const innameZonderVerhuis = (value = "") => String(value ?? "").split(";").map((t) => {
  if (!VERHUIS_SPOOR.test(t)) return t;
  return /^\(?verhui[sz]\p{L}*\)?liftlevering$/u.test(spoorVorm(t)) ? "Lift/levering" : "Andere";
}).join(";");
// Elke waarde met het spoor valt weg (een lijst) of wordt leeg (een veld), ook dieper.
const zonderSpoorWaarden = (w) => (typeof w === "string" ? (VERHUIS_SPOOR.test(w) ? "" : w)
  : Array.isArray(w) ? w.filter((x) => !(typeof x === "string" && VERHUIS_SPOOR.test(x))).map(zonderSpoorWaarden)
  : isObject(w) ? Object.fromEntries(Object.entries(w).map(([k, x]) => [k, zonderSpoorWaarden(x)])) : w);
// Regel 9: per veld, voor elk werk (ook een gewone kaart). De soort inname wordt "Lift/levering"; een titel met het spoor
// wordt "Werk in openbaar domein"; een opdrachtgever met het spoor valt weg (groep "Andere"); een fase houdt haar data en
// gevolgen, zonder naam; in de aanvullingen van A-Sign en AWV valt elke waarde met het spoor weg.
export function zonderVerhuisSpoor(item) {
  if (!isObject(item)) return item;
  const uit = { ...item };
  for (const veld of ["occupancyTypes", "workTypes"]) if (Array.isArray(item[veld])) uit[veld] = [...new Set(item[veld].map(innameZonderVerhuis))];
  if (VERHUIS_SPOOR.test(item.title)) uit.title = GEEN_TITEL;
  if (VERHUIS_SPOOR.test(item.owner)) { uit.owner = ""; uit.ownerGroup = "Andere"; }
  if (Array.isArray(item.hindrance?.phases)) uit.hindrance = { ...item.hindrance, phases: item.hindrance.phases.map((p) => (VERHUIS_SPOOR.test(p?.description) ? { ...p, description: "" } : p)) };
  for (const veld of ["aSignSupplement", "awvSupplement"]) if (isObject(item[veld])) uit[veld] = zonderSpoorWaarden(item[veld]);
  return uit;
}

// ---------- welke vorm ----------

const FASE_VAST = /^(?:fase|deel)\s*-?\s*\d{1,3}[a-z]?$/i;
const isLift = (item) => (item?.occupancyTypes || []).some((t) => String(t).split(";").some((x) => clean(x).toLowerCase() === "lift/levering"));
// Regel 14, een pure functie op het item na regel 9. Een adreskaart als het geen lift of levering is, en (a) de soort van main
// een aansluiting of een container is (besluit van de eigenaar), of (b) main toch geen tekst van de beheerder toont: een
// opdrachtgever met een groep, geen omschrijving die iets zegt, en alleen fasen zonder naam ("Fase 2", "werken").
export function isAdreskaart(item = {}) {
  if (!isObject(item) || isLift(item)) return false;
  const f = werkFeiten(item);
  if (/^(?:Nieuwe aansluiting|Container)/.test(f.soort)) return true;
  if (!GROEPEN.includes(item.ownerGroup)) return false;
  if (beheerderTekst(f.omschrijving, { losseNummers: true, straten: f.straten })) return false;
  return (item.hindrance?.phases || []).every((p) => {
    const naam = zonderNamen(p?.description || "");
    return !naam || LEGE_FASE.test(naam) || FASE_VAST.test(naam);
  });
}

// ---------- het nummer op een adreskaart ----------

// Een getal van 1 tot 3 cijfers met een maat, duur, uur of telwoord erachter is geen huisnummer ("12 m", "2 rijstroken",
// "7:30", "3 dagen"). Eerst dit, dan pas de scheidingstekens na een straatnaam: anders werd "7:30" "7 30".
const MAAT = /(?<!\d)\d{1,3}(?=\s*(?:[:.,]\d|(?:m|m²|m2|meter|km|cm|mm|kv|u|uur|min|dag|dagen|week|weken|maand|maanden|rijstro\p{L}*|stuk|stuks|x)(?![\p{L}\d])))/giu;
// "Proefstraat | 12", "Proefstraat: 12", "Proefstraat, 12": na een straatnaam (een letter), niet tussen twee cijfers
// ("12, 14 en 16" blijft een reeks).
const SCHEIDING = /(?<=[\p{L}.)\]])\s*[|;:,]\s*(?=\d)/gu;
const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TRAJECT = String.raw`\s*(?:(?:tot(?!\s+en\s+met)|tem|naar|richting)(?!\p{L})|t\/m|t\.e\.m\.?|→|->)\s*\p{L}`;
// Een ander adres in dezelfde tekst ("Proefstraat 12 - Testlaan 5"): een woord met een straatuitgang en een nummer erna.
const STRAAT_NR = /([\p{L}][\p{L}'’-]*?(?:straat|str|laan|lei|weg|plein|plaats|dreef|kaai|kade|vest|markt|rui|vliet|dijk|dok|hof|pad|park|singel|brug|berg|baan|gang|poort|wal|steeg|boulevard|square))\.?\s+\d{1,3}(?![\d\p{L}])/giu;
const laatsteWoord = (naam) => clean(naam).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[\s-]+/).at(-1) || "";
const adresTekst = (item) => [item?.title, ...(item?.hindrance?.phases || []).map((p) => p?.description || "")].filter(Boolean).join(" · ").replace(MAAT, "#").replace(SCHEIDING, " ");
// Regels 20 tot 22: het nummer uit de titel en de fasen, met de lezer van main (huisnummersUitTekst), alleen op streets[0].
// Geen nummer bij een lijst van adressen, een andere straat met een nummer, twee nummers op dezelfde straat of een traject.
// Nooit uit het adressenregister.
export function huisnummerVoorAdreskaart(item = {}) {
  const straat = clean(item?.streets?.[0]?.name);
  if (!straat) return "";
  const t = adresTekst(item);
  const n = geldigeHuisnummers(huisnummersUitTekst(t, straat));
  if (!n) return "";
  if ((item.streets || []).slice(1).some((s) => clean(s?.name) && clean(s.name) !== straat && huisnummersUitTekst(t, s.name))) return "";
  const eigen = laatsteWoord(straat);
  for (const m of t.matchAll(STRAAT_NR)) if (laatsteWoord(m[1]) !== eigen) return "";
  const s = esc(straat);
  if (new Set([...t.matchAll(new RegExp(`${s}\\s+(\\d{1,3})(?!\\d)`, "giu"))].map((m) => m[1])).size > 1) return "";
  if (new RegExp(`${s}\\s+\\d{1,3}[a-z]?${TRAJECT}`, "iu").test(t)) return "";
  return n;
}

// ---------- de adreskaart ----------

// "Nieuwe aansluiting op het elektriciteitsnet – Proefstraat 12".
export function titelAdreskaart(soort, straat, nr) {
  const s = clean(straat), n = clean(nr).replace(/^nr\.\s*/i, "");
  return `${clean(soort) || GEEN_TITEL}${s ? ` – ${s}` : ""}${s && n ? ` ${n}` : ""}`;
}
// Velden die een adreskaart van het item overneemt; al de rest valt weg (ook wat later bijkomt).
const A_VELDEN = Object.freeze(["gipodId", "status", "start", "end", "lastModified", "point", "recordCount", "boundaryConfidence", "streetResolution", "streetsMeet", "streetDistanceMeters", "hindranceSourceLoaded"]);
const tekstLijst = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
function hinderVan(h, fase) {
  if (!isObject(h)) return h === undefined ? undefined : null;
  const fasen = (Array.isArray(h.phases) ? h.phases : []).map((p, i) => [p, i])
    .sort(([a, i], [b, j]) => String(a?.start || "").localeCompare(String(b?.start || "")) || String(a?.end || "").localeCompare(String(b?.end || "")) || i - j)
    .map(([p], i) => ({ start: p?.start || "", end: p?.end || "", consequences: tekstLijst(p?.consequences), ...(fase(p) ? { buiten: true } : {}), description: `Fase ${i + 1}` }));
  return { start: h.start || "", end: h.end || "", severe: h.severe === true, consequences: tekstLijst(h.consequences), phases: fasen };
}
function projectie(bron, { soort, soortBron, innameSoort, huisnummers, fase }) {
  const uit = {};
  for (const k of A_VELDEN) if (bron[k] !== undefined) uit[k] = bron[k];
  for (const k of ["workTypes", "occupancyTypes"]) if (bron[k] !== undefined) uit[k] = tekstLijst(bron[k]);
  if (Array.isArray(bron.streets)) uit.streets = bron.streets.filter((s) => s?.name).map((s) => ({ id: String(s.id ?? ""), name: clean(s.name), postcode: String(s.postcode ?? "") }));
  if (Array.isArray(bron.streetNearby)) uit.streetNearby = bron.streetNearby.filter((s) => s?.name).map((s) => ({ name: clean(s.name), distanceMeters: s.distanceMeters }));
  const hinder = hinderVan(bron.hindrance, fase);
  if (hinder !== undefined) uit.hindrance = hinder;
  const groep = GROEPEN.includes(bron.ownerGroup) ? bron.ownerGroup : "";
  const label = isSoortLabel(soort) ? clean(soort) : "";
  Object.assign(uit, { soort: label, soortBron: label ? clean(soortBron) : "", ...(innameSoort && isSoortLabel(innameSoort) ? { innameSoort: clean(innameSoort) } : {}), owner: groep, ownerGroup: groep || "Andere" });
  const nr = geldigeHuisnummers(huisnummers);
  return { ...uit, huisnummers: nr, adresKaart: true, title: titelAdreskaart(label, uit.streets?.[0]?.name, nr) };
}
// Regel 18: een adreskaart uit een item (na regel 9). `nummer`: het nummer lezen (regel 20).
export function adreskaartItem(item, { nummer = false } = {}) {
  const f = werkFeiten({ ...item, adresKaart: false });
  return projectie(item, { soort: f.soort, soortBron: f.soortBron, innameSoort: f.innameSoort, huisnummers: nummer ? huisnummerVoorAdreskaart(item) : "", fase: (p) => faseBuitenDistrict(p?.description) });
}
// Een item dat al een adreskaart is: dezelfde witte lijst. Het nummer blijft alleen als de titel nog klopt met de straat (een
// andere straatkoppeling, zoals in de straatbestanden: dan geen nummer, want het hoorde bij een andere straat).
function opnieuwAdreskaart(item) {
  const straat = item.streets?.[0]?.name || "";
  const nr = geldigeHuisnummers(item.huisnummers);
  const klopt = nr && item.title === titelAdreskaart(item.soort, straat, nr);
  return projectie(item, { soort: item.soort, soortBron: item.soortBron, innameSoort: item.innameSoort, huisnummers: klopt ? nr : "", fase: (p) => p?.buiten === true });
}

// ---------- de vaste vorm per werk-id ----------

const ids = (lijst) => new Set((Array.isArray(lijst) || lijst instanceof Set ? [...lijst] : []).map(Number).filter((n) => Number.isInteger(n) && n > 0));
// { adreskaart, gewoon } als verzamelingen, uit het document van site/sources/werk-vorm.json (of al als verzamelingen).
export function vormSets(vorm) {
  return { adreskaart: ids(vorm?.adreskaart), gewoon: ids(vorm?.gewoon) };
}
// Fouten in site/sources/werk-vorm.json (regel 11): { schema: 1, adreskaart: [...], gewoon: [...] }, gesorteerde unieke
// gehele getallen, en de twee lijsten delen geen id.
export function werkVormFouten(doc) {
  if (!isObject(doc)) return ["geen object"];
  const fouten = [];
  for (const k of Object.keys(doc)) if (!["schema", "adreskaart", "gewoon"].includes(k)) fouten.push(`onverwachte sleutel ${k}`);
  if (doc.schema !== WERK_VORM_SCHEMA) fouten.push("schema ongeldig");
  for (const k of ["adreskaart", "gewoon"]) {
    const lijst = doc[k];
    if (!Array.isArray(lijst)) { fouten.push(`${k} ontbreekt`); continue; }
    if (lijst.some((n) => !Number.isInteger(n) || n <= 0)) fouten.push(`${k}: geen geheel getal`);
    else if (lijst.some((n, i) => i > 0 && n <= lijst[i - 1])) fouten.push(`${k}: niet gesorteerd of niet uniek`);
  }
  if (Array.isArray(doc.adreskaart) && Array.isArray(doc.gewoon)) {
    const a = new Set(doc.adreskaart);
    if (doc.gewoon.some((n) => a.has(n))) fouten.push("een id staat in beide lijsten");
  }
  return fouten;
}
export const werkVormDocument = ({ adreskaart = [], gewoon = [] } = {}) => ({
  schema: WERK_VORM_SCHEMA, adreskaart: [...ids(adreskaart)].sort((a, b) => a - b), gewoon: [...ids(gewoon)].sort((a, b) => a - b),
});
// Na een verversing: elk werk van `items` (na werkenVoorDeSite) in zijn lijst. Een id dat er al stond, blijft waar het stond.
export function vormNaVerversing(vorm, items = []) {
  const { adreskaart, gewoon } = vormSets(vorm);
  for (const item of items) {
    const id = Number(item?.gipodId);
    if (!Number.isInteger(id) || id <= 0 || adreskaart.has(id) || gewoon.has(id)) continue;
    (item.adresKaart === true ? adreskaart : gewoon).add(id);
  }
  return werkVormDocument({ adreskaart, gewoon });
}

// ---------- de poort ----------

// Regel 16: de enige weg van collectWorks naar een uitgang, direct na applyWorkStreetResolution. `vorm`: site/sources/
// werk-vorm.json. `bekend`: werk-ids die al gepubliceerd waren (de vorige historiek en kaart-uitleg.json): een gewone kaart.
// `magBeslissen`: alleen de verversing leest het nummer van een werk dat nog niet in de vaste vorm staat; in de browser
// toont zo'n werk geen nummer tot de verversing het vastlegt. Een tweede aanroep verandert niets.
export function werkenVoorDeSite(items = [], vorm = null, { magBeslissen = false, bekend = null } = {}) {
  const { adreskaart, gewoon } = vormSets(vorm);
  return (Array.isArray(items) ? items : []).map((item) => {
    if (!isObject(item)) return item;
    if (item.adresKaart === true) return opnieuwAdreskaart(item);
    const schoon = zonderVerhuisSpoor(item);
    const id = Number(item.gipodId);
    // Een lift of levering krijgt nooit een nummer, ook niet als haar id (later) in "adreskaart" staat.
    if (adreskaart.has(id)) return adreskaartItem(schoon, { nummer: !isLift(schoon) });
    if (gewoon.has(id) || bekend?.has?.(id)) return schoon;
    return isAdreskaart(schoon) ? adreskaartItem(schoon, { nummer: magBeslissen }) : schoon;
  });
}

// ---------- de titel in een lijst ----------

// Regel 28: de titel in de lijst van de werken, het zoeken, street-overview en week-pulse. Een adreskaart: haar titel. Een
// gewone kaart: zonder naam na een dossiercode, zonder contactgegevens en zonder los huisnummer.
export function lijstTitel(item = {}) {
  if (item?.adresKaart === true) return clean(item.title) || GEEN_TITEL;
  const t = zonderNamen(item?.title);
  if (!t || CONTACT.test(t)) return GEEN_TITEL;
  return zonderLosseHuisnummers(t, (item?.streets || []).map((s) => s?.name).filter(Boolean)) || GEEN_TITEL;
}
