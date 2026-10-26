// Werken: adreskaart of gewone kaart. Besluit van de eigenaar (18 oktober 2026): "liefst exacte adres, ... maar moet wel
// nuttig zijn en weten waar", en nooit een spoor van een verhuizing.
//
// Elk GIPOD-werk heeft op elke uitgang (de kaart, de lijst en het zoeken, street-overview en week-pulse, de historiek, de
// straatbestanden en kaart-uitleg.json) precies één vorm:
// - ADRESKAART (A): alleen vaste gegevens van GIPOD: de soort uit de vaste lijst, de officiële straten, één huisnummer of
//   een reeks, de data en de gevolgen, de fasen met een vaste naam ("Fase 2" uit de bron, anders "Fase n" of "Fase"), het
//   dossiernummer van een werfzone en de groep van de opdrachtgever. Nooit vrije tekst: het item
//   wordt opgebouwd uit een witte lijst (adreskaartItem), niet geknipt. Wat niet op de lijst staat, bestaat niet.
// - GEWOON (B): de kaart van main, met de tekst van de beheerder (zonder naam na een dossiercode en zonder
//   contactgegevens) en met het huisnummer: een reeks, of één los nummer dat dezelfde lezer als een adreskaart zeker leest
//   (huisnummerUitGipod in site/kaart-uitleg.js), of het nummer uit het adressenregister.
// Regel van de eigenaar (26 oktober 2026): "het doel is dat de mensen echt exact kunnen zien waar die dingen en problemen
// zijn". Het huisnummer staat er dus altijd, op beide vormen; alleen bij iets persoonlijks, een verhuizing (het spoor
// hieronder) of een inname voor een lift of levering, staat alleen de straat.
//
// De vorm hangt aan het werk-id en verandert nooit (site/sources/werk-vorm.json; één schrijver:
// scripts/refresh-live-history.mjs; de overgang: scripts/maak-werk-vorm.mjs). Docs: docs/PUBLIC_SPACE_SOURCE_POLICY.md,
// "Werken: adreskaart of gewone kaart".
import {
  CONTACT, LEGE_FASE, adreskaartFaseNamen, beheerderTekst, faseBuitenDistrict, geldigeHuisnummers, heeftKortGetal, huisnummerUitGipod,
  isSoortLabel, isWerfDossier, naamNaCodeWeg, nummerWegCode, werkFeiten, zonderHuisnummers, zonderNamen,
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
// Een soort inname met het spoor die niet "Lift/levering" wordt (die soort is zelf al één adres: isEenAdres in
// site/kaart-uitleg.js).
const andereSoortMetSpoor = (lijst) => (Array.isArray(lijst) ? lijst : []).some((t) => String(t ?? "").split(";").some((x) => VERHUIS_SPOOR.test(x) && innameZonderVerhuis(x) !== "Lift/levering"));
// Regel 9: per veld, voor elk werk (ook een gewone kaart). De soort inname wordt "Lift/levering"; een titel met het spoor
// wordt "Werk in openbaar domein"; een opdrachtgever met het spoor valt weg (groep "Andere"); een fase houdt haar data en
// gevolgen, zonder naam; in de aanvullingen van A-Sign en AWV valt elke waarde met het spoor weg.
// Een werk met het spoor in de titel, een fase, de opdrachtgever of een andere soort inname dan "Lift/levering" blijft één
// adres, zoals main een verhuis toonde (#141): `eenAdres` (isEenAdresWerk in site/kaart-uitleg.js). Dan geen huisnummer,
// geen opzoeking in het adressenregister en nooit een adreskaart (nakijkronde van head 0dfb9cd8: zonder de soort "Verhuis"
// werd zo'n werk een gewone kaart met een reeks uit het register naast de opdrachtgever). De vlag zegt alleen "één adres",
// zoals bij een aansluiting, een container of een lift. Niet voor een aanvulling van A-Sign of AWV: een verhuisfirma
// tussen de bedrijven van een grote werf maakt die werf geen adres.
export function zonderVerhuisSpoor(item) {
  if (!isObject(item)) return item;
  const uit = { ...item };
  const phases = Array.isArray(item.hindrance?.phases) ? item.hindrance.phases : [];
  const spoor = VERHUIS_SPOOR.test(item.title) || VERHUIS_SPOOR.test(item.owner) || phases.some((p) => VERHUIS_SPOOR.test(p?.description))
    || andereSoortMetSpoor(item.occupancyTypes) || andereSoortMetSpoor(item.workTypes);
  for (const veld of ["occupancyTypes", "workTypes"]) if (Array.isArray(item[veld])) uit[veld] = [...new Set(item[veld].map(innameZonderVerhuis))];
  if (VERHUIS_SPOOR.test(item.title)) uit.title = GEEN_TITEL;
  if (VERHUIS_SPOOR.test(item.owner)) { uit.owner = ""; uit.ownerGroup = "Andere"; }
  if (Array.isArray(item.hindrance?.phases)) uit.hindrance = { ...item.hindrance, phases: item.hindrance.phases.map((p) => (VERHUIS_SPOOR.test(p?.description) ? { ...p, description: "" } : p)) };
  for (const veld of ["aSignSupplement", "awvSupplement"]) if (isObject(item[veld])) uit[veld] = zonderSpoorWaarden(item[veld]);
  if (spoor) uit.eenAdres = true;
  return uit;
}

// ---------- welke vorm ----------

const FASE_VAST = /^(?:fase|deel)\s*-?\s*\d{1,3}[a-z]?$/i;
const isLift = (item) => (item?.occupancyTypes || []).some((t) => String(t).split(";").some((x) => clean(x).toLowerCase() === "lift/levering"));
// Regel 14, een pure functie op het item na regel 9. Een adreskaart als het geen lift of levering is en geen werk met het
// spoor van een verhuizing (`eenAdres`, regel 9), en (a) de soort van main
// een aansluiting of een container is (besluit van de eigenaar), of (b) main toch geen tekst van de beheerder toont: een
// opdrachtgever met een groep, geen omschrijving die iets zegt, en alleen fasen zonder naam ("Fase 2", "werken").
export function isAdreskaart(item = {}) {
  if (!isObject(item) || isLift(item) || item.eenAdres === true) return false;
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

// De lezer staat in site/kaart-uitleg.js (huisnummerUitGipod): een gewone kaart leest met dezelfde lezer één los nummer.
export const huisnummerVoorAdreskaart = huisnummerUitGipod;
// De titel en de fasen zoals ze in het item staan, zonder dat MAAT een getal "#" maakte.
const ruweTekst = (item) => [item?.title, ...(item?.hindrance?.phases || []).map((p) => p?.description || "")].filter(Boolean).join(" · ");
// Waarom een adreskaart zonder nummer is (huisnummerWeg in site/kaart-uitleg.js): "weggelaten" als de lezer een nummer vond
// dat hier niet getoond wordt, ook in het item van GIPOD vóór regel 9 (`ruw`: regel 9 vervangt een titel met het spoor van een
// verhuizing), "twijfel" als de titel of een fase van het item of van `ruw` een getal van één tot drie cijfers heeft (geen
// postcode, geen "Fase 2"), ook een getal dat MAAT wegnam ("Proefstraat 12 - 3 dagen"), anders niets: dan gaf GIPOD geen
// huisnummer. Zo zegt een adreskaart alleen "huisnummers niet gepubliceerd" als de titel en de fasen geen enkel getal hebben
// (nakijkronde van head d7e4238a).
function nummerWeg(item, gelezen, ruw = item) {
  if (gelezen || (ruw !== item && huisnummerVoorAdreskaart(ruw))) return "weggelaten";
  return [item, ruw].some((x) => heeftKortGetal(ruweTekst(x))) ? "twijfel" : "";
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
// De fasen met hun data en gevolgen, op volgorde van hun begin, met een vaste naam (adreskaartFaseNamen: "Fase 2" uit de bron
// blijft "Fase 2").
function hinderVan(h, fase) {
  if (!isObject(h)) return h === undefined ? undefined : null;
  const gesorteerd = (Array.isArray(h.phases) ? h.phases : []).map((p, i) => [p, i])
    .sort(([a, i], [b, j]) => String(a?.start || "").localeCompare(String(b?.start || "")) || String(a?.end || "").localeCompare(String(b?.end || "")) || i - j)
    .map(([p]) => p);
  const namen = adreskaartFaseNamen(gesorteerd.map((p) => p?.description));
  const fasen = gesorteerd.map((p, i) => ({ start: p?.start || "", end: p?.end || "", consequences: tekstLijst(p?.consequences), ...(fase(p) ? { buiten: true } : {}), description: namen[i] }));
  return { start: h.start || "", end: h.end || "", severe: h.severe === true, consequences: tekstLijst(h.consequences), phases: fasen };
}
function projectie(bron, { soort, soortBron, innameSoort, huisnummers, weg = "", fase }) {
  const uit = {};
  for (const k of A_VELDEN) if (bron[k] !== undefined) uit[k] = bron[k];
  for (const k of ["workTypes", "occupancyTypes"]) if (bron[k] !== undefined) uit[k] = tekstLijst(bron[k]);
  // Het dossiernummer van de werfzone in A-Sign: een vaste code, geen persoonsgegeven; zo blijft de koppeling met de
  // werfzone (samenWerven in site/place-core.js).
  if (isWerfDossier(bron.dossier)) uit.dossier = clean(bron.dossier);
  if (Array.isArray(bron.streets)) uit.streets = bron.streets.filter((s) => s?.name).map((s) => ({ id: String(s.id ?? ""), name: clean(s.name), postcode: String(s.postcode ?? "") }));
  if (Array.isArray(bron.streetNearby)) uit.streetNearby = bron.streetNearby.filter((s) => s?.name).map((s) => ({ name: clean(s.name), distanceMeters: s.distanceMeters }));
  const hinder = hinderVan(bron.hindrance, fase);
  if (hinder !== undefined) uit.hindrance = hinder;
  // Eén adres (een werk met het spoor van een verhuizing, regel 9): ook als adreskaart nooit een nummer of een reeks.
  if (bron.eenAdres === true) uit.eenAdres = true;
  // Een opdrachtgever buiten de groepen valt weg, met de groep "Andere": zo zegt de kaart "weggelaten" en niet "niet
  // gepubliceerd" (opdrachtgeverWeggelaten in site/kaart-uitleg.js). Zonder opdrachtgever in GIPOD blijft het "Onbekend".
  const groep = GROEPEN.includes(bron.ownerGroup) ? bron.ownerGroup : "";
  const label = isSoortLabel(soort) ? clean(soort) : "";
  Object.assign(uit, { soort: label, soortBron: label ? clean(soortBron) : "", ...(innameSoort && isSoortLabel(innameSoort) ? { innameSoort: clean(innameSoort) } : {}), owner: groep, ownerGroup: groep || (clean(bron.owner) || bron.ownerGroup === "Andere" ? "Andere" : "Onbekend") });
  const nr = geldigeHuisnummers(huisnummers);
  const zonder = nr ? "" : nummerWegCode(weg);
  return { ...uit, huisnummers: nr, ...(zonder ? { huisnummerWeg: zonder } : {}), adresKaart: true, title: titelAdreskaart(label, uit.streets?.[0]?.name, nr) };
}
// Regel 18: een adreskaart uit een item (na regel 9). `nummer`: het nummer lezen (regel 20). `ruw`: het item van GIPOD vóór
// regel 9; alleen voor huisnummerWeg (een vaste code), nooit voor wat de kaart toont.
export function adreskaartItem(item, { nummer = false, ruw = item } = {}) {
  const f = werkFeiten({ ...item, adresKaart: false });
  const gelezen = huisnummerVoorAdreskaart(item);
  const huisnummers = nummer ? gelezen : "";
  return projectie(item, { soort: f.soort, soortBron: f.soortBron, innameSoort: f.innameSoort, huisnummers, weg: huisnummers ? "" : nummerWeg(item, gelezen, ruw), fase: (p) => faseBuitenDistrict(p?.description) });
}
// Een item dat al een adreskaart is: dezelfde witte lijst. Het nummer blijft alleen als de titel nog klopt met de straat (een
// andere straatkoppeling, zoals in de straatbestanden: dan geen nummer, want het hoorde bij een andere straat).
function opnieuwAdreskaart(item) {
  const straat = item.streets?.[0]?.name || "";
  const nr = geldigeHuisnummers(item.huisnummers);
  const klopt = nr && item.title === titelAdreskaart(item.soort, straat, nr);
  return projectie(item, { soort: item.soort, soortBron: item.soortBron, innameSoort: item.innameSoort, huisnummers: klopt ? nr : "", weg: nr && !klopt ? "weggelaten" : item.huisnummerWeg, fase: (p) => p?.buiten === true });
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
// `bekend`: de werk-ids die al gepubliceerd waren (gepubliceerdeWerkIds in lib/werk-vorm-bestand.mjs); elk daarvan dat nog in
// geen enkele lijst staat, wordt gewoon, zoals de poort het toont (regel 13). Zo kent de vaste vorm na elke verversing elk
// gepubliceerd werk (regel 35), ook een werk dat main publiceerde na de laatste overgang en dat nu al afgelopen is: de
// dagelijkse verversing herstelt dat zelf, zonder volledige kloon (nakijkronde van head 0dfb9cd8).
export function vormNaVerversing(vorm, items = [], { bekend = null } = {}) {
  const { adreskaart, gewoon } = vormSets(vorm);
  for (const item of items) {
    const id = Number(item?.gipodId);
    if (!Number.isInteger(id) || id <= 0 || adreskaart.has(id) || gewoon.has(id)) continue;
    (item.adresKaart === true ? adreskaart : gewoon).add(id);
  }
  for (const id of ids(bekend)) if (!adreskaart.has(id)) gewoon.add(id);
  return werkVormDocument({ adreskaart, gewoon });
}

// ---------- de poort ----------

// Regel 16: de enige weg van collectWorks naar een uitgang, direct na applyWorkStreetResolution. `vorm`: site/sources/
// werk-vorm.json. `bekend`: werk-ids die al gepubliceerd waren (de vorige historiek en kaart-uitleg.json): een gewone kaart.
// Een adreskaart leest altijd haar nummer, ook in de browser voor de verversing het werk vastlegt: een gewone kaart toont
// het nummer ook (regel van de eigenaar van 26 oktober 2026: het huisnummer staat er altijd, behalve bij een verhuizing).
// Een tweede aanroep verandert niets.
export function werkenVoorDeSite(items = [], vorm = null, { bekend = null } = {}) {
  const { adreskaart, gewoon } = vormSets(vorm);
  return (Array.isArray(items) ? items : []).map((item) => {
    if (!isObject(item)) return item;
    if (item.adresKaart === true) return opnieuwAdreskaart(item);
    const schoon = zonderVerhuisSpoor(item);
    const id = Number(item.gipodId);
    // Een lift of levering, of een werk met het spoor van een verhuizing (eenAdres), krijgt nooit een nummer, ook niet als
    // zijn id (later) in "adreskaart" staat.
    const nummer = !isLift(schoon) && schoon.eenAdres !== true;
    if (adreskaart.has(id)) return adreskaartItem(schoon, { nummer, ruw: item });
    if (gewoon.has(id) || bekend?.has?.(id)) return schoon;
    return isAdreskaart(schoon) ? adreskaartItem(schoon, { nummer, ruw: item }) : schoon;
  });
}

// ---------- de titel in een lijst ----------

// Een vaste code met cijfers is geen telefoonnummer: een omgevingsvergunning ("OMV_2026012345"), een dossier van A-Sign
// ("GW2026-001601", "ET2026-000123") en een dossiercode vóór een liggend streepje ("DNW12345678_"). Zonder die codes kijkt
// CONTACT de titel opnieuw na; al de rest blijft zoals CONTACT het ziet (een getal van negen cijfers kan een gsm-nummer zijn).
const CODES = /(?<![\p{L}\d])(?:OMV_\d{8,12}|(?:GW|ET)\d{4}-?\d{6}|(?!TEL|GSM|FAX)[A-Z]{2,6}\d{4,}(?=_))(?!\d)/gu;
const metContact = (t) => CONTACT.test(t.replace(CODES, " "));
// Regel 28: de titel in de lijst van de werken, het zoeken, street-overview en week-pulse. Een adreskaart: haar titel (nooit
// vrije tekst naast het exacte adres). Een gewone kaart: de titel van GIPOD zoals main hem toonde, heel (ook langer dan 300
// tekens), zonder naam na een dossiercode en zonder contactgegevens, met het huisnummer (regel van de eigenaar van 26 oktober
// 2026: zo ziet iedereen waar het werk is). Alleen een lift of levering of een werk met het spoor van een verhuizing
// (eenAdres, regel 9) staat er zonder huisnummer.
export function lijstTitel(item = {}) {
  if (item?.adresKaart === true) return clean(item.title) || GEEN_TITEL;
  const t = naamNaCodeWeg(clean(item?.title));
  if (!t || metContact(t)) return GEEN_TITEL;
  return (item?.eenAdres === true || isLift(item) ? zonderHuisnummers(t, Infinity) : t) || GEEN_TITEL;
}
