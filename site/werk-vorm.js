// Werken: adreskaart of gewone kaart. Besluit van de eigenaar (18 oktober 2026): "liefst exacte adres, ... maar moet wel
// nuttig zijn en weten waar", en nooit een spoor van een verhuizing.
//
// Elk GIPOD-werk heeft op elke uitgang (de kaart, de lijst en het zoeken, street-overview en week-pulse, de historiek, de
// straatbestanden en kaart-uitleg.json) precies één vorm:
// - ADRESKAART (A): alleen vaste gegevens van GIPOD: de soort uit de vaste lijst, de officiële straten, één huisnummer of
//   een reeks, de data en de gevolgen, de fasen met een vaste naam ("Fase 2" uit de bron, anders "Fase n" of "Fase"), het
//   dossiernummer van een werfzone en de groep van de opdrachtgever. Nooit vrije tekst: het item
//   wordt opgebouwd uit een witte lijst (adreskaartItem), niet geknipt. Wat niet op de lijst staat, bestaat niet.
// - GEWOON (B): de kaart van main, die nooit één los huisnummer toont.
// Zo staan een exact nummer en vrije tekst per constructie nooit samen: een leesfout kost hoogstens een nummer.
//
// De vorm hangt aan het werk-id en verandert nooit (site/sources/werk-vorm.json; één schrijver:
// scripts/refresh-live-history.mjs; de overgang: scripts/maak-werk-vorm.mjs). Docs: docs/PUBLIC_SPACE_SOURCE_POLICY.md,
// "Werken: adreskaart of gewone kaart".
import {
  CONTACT, LEGE_FASE, adreskaartFaseNamen, beheerderTekst, faseBuitenDistrict, geldigeHuisnummers, huisnummerBereik, isDistrictPostcode,
  isSoortLabel, isWerfDossier, naamNaCodeWeg, nummerWegCode, werkFeiten, zonderLosseHuisnummers, zonderNamen,
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

// Grondregel: liever geen nummer dan een fout huis; bij elke twijfel geen nummer (nakijkronde van head a4d9ba99).
//
// Een getal met een maat, duur, uur of telwoord erachter wordt eerst "#", ook een reeks ervan ("12 m", "2 rijstroken",
// "7:30", "3 dagen", "12 - 14 dagen"): zo staat het nooit als nummer na de straat. Eerst dit, dan pas de scheidingstekens
// na een straatnaam: anders werd "7:30" "7 30".
const MAAT = /(?<![\d#])\d{1,3}(?:\s*(?:-|–|—|tot|à)\s*\d{1,3})?(?=\s*(?:[:.,]\d|(?:m|m²|m2|meter|km|cm|mm|kv|u|uur|h|min|dag|dagen|werkdag|werkdagen|nacht|nachten|week|weken|maand|maanden|jaar|rijstro\p{L}*|stuk|stuks|x|keer|plaats|plaatsen|parkeerplaats\p{L}*|container\p{L}*)(?![\p{L}\d])))/giu;
// "Proefstraat | 12", "Proefstraat: 12", "Proefstraat, 12": na een straatnaam (een letter), niet tussen twee cijfers
// ("12, 14 en 16" blijft een reeks).
const SCHEIDING = /(?<=[\p{L}.)\]])\s*[|;:,]\s*(?=\d)/gu;
const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Eén huisnummer: 1 tot 999, zonder 0 vooraan, met hoogstens één letter eraan ("12A"), maar geen letter die een eenheid
// kan zijn ("7h", "7u", "12m", "2x"). Een reeks of een opsomming op dezelfde straat zoals de lezer van main
// (huisnummersUitTekst): "12-14", "12 tem 14", "12, 14 en 16".
const NR = String.raw`[1-9]\d{0,2}[a-gi-ln-tv-wyz]?(?![\d\p{L}_])`;
const REEKS = String.raw`\s*(?:-|–|—|→|tot en met|t\.\s?e\.\s?m\.?|tem|t\/m|tot)\s*`;
const OPSOMMING = String.raw`\s*(?:,|en)\s*`;
const NA_OPSOMMING = String.raw`(?=\s*(?:$|[.;:,)/|]|[-–→]|(?:en|tem|tot|t\/m)(?!\p{L})))`;
// Het nummer staat direct na de straat (na een spatie) en wordt gevolgd door het einde, een scheiding ("," ";" "|" "·"
// ")" "]", een streep met spaties, een punt met een spatie) of een busaanduiding ("bus 3"). Al de rest is twijfel: een
// woord ("12 containers", "15 oktober", "12 A", "12 Proefmans"), een schuine streep ("15/10", "31/2"), een traject ("12
// tot Testlaan", "12 → Testlaan"), een code ("1DN02", "9B_BIS").
const NA_STRAAT = new RegExp(String.raw`^\s+(${NR}(?:${REEKS}${NR}|${OPSOMMING}${NR}${NA_OPSOMMING})*)(?:\s*bus\s*[a-z0-9]{1,4}(?![\p{L}\d]))?(?=\s*$|\s*[,;|·)\]]|\s+[-–—](?:\s|$)|\.(?:\s|$))`, "iu");
// Een cijfer kort na de naam (hoogstens drie tekens zonder letter ertussen): "Proefstraat 12", "Proefstraat (12)",
// "Proefstraat - 12".
const CIJFER_NA = /^[^\p{L}\d]{0,3}\d/u;
// Voor de straatnaam staat het begin van de tekst, een scheiding ("|", ",", ";", ":", "·", "(", "[", "/", een losse streep)
// of een getal ("Fase 1 Proefstraat 8", "2000 Proefstraat 8"). Een woord ervoor ("Korte Proefstraat", "in de Proefstraat")
// of een teken eraan vast ("Anna-Proeflei", "O.L.V.-Proefstraat") kan een andere straat zijn.
function schoonVoor(voor) {
  if (!voor) return true;
  if (!/\s$/u.test(voor)) return /[|,;:·(\[/]$/u.test(voor);
  const t = voor.trimEnd();
  if (!t) return true;
  if (/(?:^|\s)[-–—]$/u.test(t) || /[|,;:·(\[/]$/u.test(t)) return true;
  return !/[\p{L}'’]/u.test(t.match(/\S+$/u)[0]);
}
// Na de straatnaam: geen letter, cijfer, koppelteken, apostrof of liggend streepje eraan vast ("Proefstraatje", "Proefstraat-Noord").
const schoonNa = (na) => !/^[\p{L}\p{N}'’_-]/u.test(na);
// Een ander adres in dezelfde tekst: een woord met een straatuitgang en een nummer erna ("Testlaan 5", "Anna-Proeflei 5",
// "Testlaan nr. 5"). Het cijfer moet precies het cijfer van ons nummer zijn, anders twijfel.
const ADRES_ELDERS = /[\p{L}][\p{L}'’-]*?(?:straat|str|laan|lei|weg|plein|plaats|dreef|kaai|kade|vest|markt|rui|vliet|dijk|dok|hof|pad|park|singel|brug|berg|baan|gang|poort|wal|steeg|boulevard|square)\.?\s*(?:(?:nrs?|no|n°|hnr|huisnummers?)\.?\s*)?(?=\d)/giu;
const NUMMER_VOORVOEGSEL = String.raw`\.?\s*(?:(?:nrs?|no|n°|hnr|huisnummers?)\.?\s*)?(?=\d)`;
const adresTekst = (item) => [item?.title, ...(item?.hindrance?.phases || []).map((p) => p?.description || "")].filter(Boolean).join(" · ").replace(MAAT, "#").replace(SCHEIDING, " ");
// Een volgnummer van een fase ("Fase 2", "deel 3") is geen huisnummer; elk ander getal van één tot drie cijfers kan er een zijn.
const VOLGNUMMER = /(?<![\p{L}])(?:fase|deel)\s*-?\s*\d{1,3}[a-z]?(?![\p{L}\d])/giu;
const KORT_GETAL = /(?<!\d)\d{1,3}(?!\d)/u;
// Een postcode: vier cijfers voor een plaatsnaam ("2070 Proefdorp", "2100 | Proefdorp").
const POSTCODE = /(?<![\p{L}\d])([1-9]\d{3})(?!\d)(?=[\s|,;:·–—-]*\p{L})/gu;
// Nog een getal naast het gelezen nummer (nogEenGetalOfMaat: elk ander getal van één tot drie cijfers buiten de volgnummers
// van de fasen, ook een maat die MAAT al "#" maakte, "Proefstraat 12, 14 dagen": een reeks of een duur?) of een postcode
// buiten het district (plaatsElders): dan kan het nummer van een ander huis zijn ("Proefstraat 2 - 3 uren", "Proefstraat |
// 12" met een fase "thv nr 14", een fase "2070 Proefdorp, Proefstraat 12" bij de gelijknamige straat van een andere
// gemeente). Twijfel, dus geen nummer (nakijkronde van head fd8946ae). In de opname van GIPOD van 18 oktober 2026 staat
// geen enkel gelezen nummer naast een ander getal: dit kost daar geen nummer.
const nogEenGetal = (rest) => KORT_GETAL.test(rest.replace(VOLGNUMMER, " "));
const nogEenGetalOfMaat = (rest) => nogEenGetal(rest) || rest.includes("#");
const plaatsElders = (t) => [...t.matchAll(POSTCODE)].some((m) => !isDistrictPostcode(m[1]));
// Een reeks of opsomming loopt op ("12 - 14", "12, 14 en 16") en heeft hoogstens één streep of "tot": "12 - 1", "14 → 12",
// "7 - 7B" of "3 - 4 - 5" kan een bus, een datum of iets anders zijn.
const KETTING = new RegExp(`${REEKS}${NR}${REEKS}`, "iu");
function heldereReeks(tekst) {
  const getallen = (tekst.match(/\d{1,3}/g) || []).map(Number);
  return getallen.every((x, i) => i === 0 || x > getallen[i - 1]) && !KETTING.test(tekst);
}
// Regels 20 tot 22: het nummer uit de titel en de fasen, alleen op streets[0], alleen direct na de volledige straatnaam.
// Geen nummer bij twijfel: de naam als deel van een andere straat met een cijfer erna, een cijfer na de naam dat niet als
// nummer gelezen kan worden, een reeks die niet oploopt, twee verschillende nummers op de straat, nog een getal of een maat
// in de titel of de fasen, een postcode buiten het district, een ander adres of een andere straat van het werk met een
// nummer. Nooit uit het adressenregister.
export function huisnummerVoorAdreskaart(item = {}) {
  const straat = clean(item?.streets?.[0]?.name);
  if (!straat) return "";
  const t = clean(adresTekst(item));
  if (plaatsElders(t)) return "";
  const nummers = new Set(), plaatsen = new Set(), stukken = [];
  for (const m of t.matchAll(new RegExp(esc(straat), "giu"))) {
    const voor = t.slice(0, m.index), na = t.slice(m.index + m[0].length);
    if (!schoonVoor(voor) || !schoonNa(na)) {
      // Een deel van een andere naam ("Korte Proefstraat", "Proefstraatje"): met een cijfer erna is het twijfel.
      if (CIJFER_NA.test(na.replace(/^[\p{L}'’_-]*/u, ""))) return "";
      continue;
    }
    if (!CIJFER_NA.test(na)) continue;
    const g = /^\s+\d/u.test(na) ? na.match(NA_STRAAT) : null;
    const n = g && heldereReeks(g[1]) ? geldigeHuisnummers(huisnummerBereik(g[1].match(/\d{1,3}[a-z]?/gi))) : "";
    if (!n) return "";
    nummers.add(n);
    plaatsen.add(m.index + m[0].length + na.search(/\d/u));
    stukken.push([m.index, m.index + m[0].length + g[0].length]);
  }
  if (nummers.size !== 1) return "";
  // De tekst zonder de straat met haar nummer (of reeks, met de bus): daarin geen enkel ander getal.
  const rest = stukken.reduceRight((tekst, [van, tot]) => `${tekst.slice(0, van)} ${tekst.slice(tot)}`, t);
  if (nogEenGetalOfMaat(rest)) return "";
  for (const m of t.matchAll(ADRES_ELDERS)) if (!plaatsen.has(m.index + m[0].length)) return "";
  for (const s of (item.streets || []).slice(1)) {
    const naam = clean(s?.name);
    if (!naam || naam === straat) continue;
    for (const m of t.matchAll(new RegExp(`${esc(naam)}${NUMMER_VOORVOEGSEL}`, "giu"))) if (!plaatsen.has(m.index + m[0].length)) return "";
  }
  return [...nummers][0];
}
// Waarom een adreskaart zonder nummer is (huisnummerWeg in site/kaart-uitleg.js): "weggelaten" als de lezer een nummer vond
// dat hier niet getoond wordt, "twijfel" als de titel of een fase een getal van één tot drie cijfers heeft (geen maat, geen
// postcode, geen "Fase 2"), anders niets: dan gaf GIPOD geen huisnummer.
function nummerWeg(item, gelezen) {
  if (gelezen) return "weggelaten";
  return nogEenGetal(adresTekst(item)) ? "twijfel" : "";
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
  const groep = GROEPEN.includes(bron.ownerGroup) ? bron.ownerGroup : "";
  const label = isSoortLabel(soort) ? clean(soort) : "";
  Object.assign(uit, { soort: label, soortBron: label ? clean(soortBron) : "", ...(innameSoort && isSoortLabel(innameSoort) ? { innameSoort: clean(innameSoort) } : {}), owner: groep, ownerGroup: groep || "Andere" });
  const nr = geldigeHuisnummers(huisnummers);
  const zonder = nr ? "" : nummerWegCode(weg);
  return { ...uit, huisnummers: nr, ...(zonder ? { huisnummerWeg: zonder } : {}), adresKaart: true, title: titelAdreskaart(label, uit.streets?.[0]?.name, nr) };
}
// Regel 18: een adreskaart uit een item (na regel 9). `nummer`: het nummer lezen (regel 20).
export function adreskaartItem(item, { nummer = false } = {}) {
  const f = werkFeiten({ ...item, adresKaart: false });
  const gelezen = huisnummerVoorAdreskaart(item);
  const huisnummers = nummer ? gelezen : "";
  return projectie(item, { soort: f.soort, soortBron: f.soortBron, innameSoort: f.innameSoort, huisnummers, weg: huisnummers ? "" : nummerWeg(item, gelezen), fase: (p) => faseBuitenDistrict(p?.description) });
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

// Een vaste code met cijfers is geen telefoonnummer: een omgevingsvergunning ("OMV_2026012345"), een dossier van A-Sign
// ("GW2026-001601", "ET2026-000123") en een dossiercode vóór een liggend streepje ("DNW12345678_"). Zonder die codes kijkt
// CONTACT de titel opnieuw na; al de rest blijft zoals CONTACT het ziet (een getal van negen cijfers kan een gsm-nummer zijn).
const CODES = /(?<![\p{L}\d])(?:OMV_\d{8,12}|(?:GW|ET)\d{4}-?\d{6}|(?!TEL|GSM|FAX)[A-Z]{2,6}\d{4,}(?=_))(?!\d)/gu;
const metContact = (t) => CONTACT.test(t.replace(CODES, " "));
// Regel 28: de titel in de lijst van de werken, het zoeken, street-overview en week-pulse. Een adreskaart: haar titel (nooit
// vrije tekst naast het exacte adres). Een gewone kaart: de titel van GIPOD zoals main hem toonde, heel (ook langer dan 300
// tekens), zonder naam na een dossiercode, zonder contactgegevens en zonder los huisnummer (nakijkronde van head a4d9ba99).
export function lijstTitel(item = {}) {
  if (item?.adresKaart === true) return clean(item.title) || GEEN_TITEL;
  const t = naamNaCodeWeg(clean(item?.title));
  if (!t || metContact(t)) return GEEN_TITEL;
  return zonderLosseHuisnummers(t, (item?.streets || []).map((s) => s?.name).filter(Boolean), { max: Infinity }) || GEEN_TITEL;
}
