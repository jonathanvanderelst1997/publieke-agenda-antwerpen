// Kaartjes in gewone taal. Maakt van een werk (GIPOD) of een evenementendossier (A-Sign IOD)
// een duidelijke titel, een korte uitleg en een eerlijke lijst van wat de bron níet zegt.
// Gedeeld door de dataverversing (lib/kaart-uitleg-refresh.mjs schrijft de feiten naar
// site/sources/kaart-uitleg.json) en de site (place-view.js), zodat elk nieuw item dezelfde
// uitleg krijgt. Verzint niets: een soort werk of evenement komt alleen uit woorden die in de
// bron staan, en de bron van die afleiding gaat mee. Geen klok: "vandaag" komt altijd van buiten.
// De plaats van een werk mag exact zijn (straat en huisnummer of bereik zoals de bron ze geeft, ook bij één adres), maar
// niets dat over een persoon of zijn huishouden vertelt: geen naam, geen contactgegevens en nooit "verhuis" (besluit van
// de eigenaar van 18 oktober 2026, site/works-core.js; docs/PUBLIC_SPACE_SOURCE_POLICY.md).

import {
  DINGEN, KENMERK_WAARDEN, KENMERK_WOORDEN, LANG_DAGEN, OPNAME, alleenStraat, dingKeuze, dingVan, duurDagen, echteDagen, inWijk, isOpnameFase, kenmerkWoorden, patroonTekst, patroonVan,
  versieringTekst, voorwerpenIn, zonderOntkenning,
} from "./evenement-wat.js";
import { gipodLink } from "./gipod-bron.js";
import { onbekendVeld, onbekendZin } from "./onbekend-zinnen.js";
import { sleutel as straatSleutel, witteTekst } from "./witte-lijst.js";
import { INNAME_LIFT, INNAME_WEG, VERHUIS, innameZonderVerhuis, werkZonderVerhuis, zonderVerhuis } from "./works-core.js";

export const KAART_UITLEG_SCHEMA = 1;
export const NIET_GEPUBLICEERD = onbekendZin("werk-omschrijving");

const clean = (v, max = 300) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const uniek = (rows) => [...new Set(rows.map((v) => clean(v)).filter(Boolean))];
const MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const BRUSSEL = typeof Intl !== "undefined" ? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" }) : null;

// ---------- datums ----------

// Kalenderdag in Brussel (JJJJ-MM-DD) van een ISO-tijdstip of een dag.
export function dagVan(value) {
  const text = clean(value, 40);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) return "";
  return BRUSSEL ? BRUSSEL.format(new Date(ms)) : new Date(ms).toISOString().slice(0, 10);
}
export function dagenTussen(a, b) {
  const t = (d) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((t(b) - t(a)) / 86_400_000);
}
export function datumTekst(day, { jaar = false } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "")) return "";
  return `${Number(day.slice(8, 10))} ${MAANDEN[Number(day.slice(5, 7)) - 1]}${jaar ? ` ${day.slice(0, 4)}` : ""}`;
}
// Een datum met jaartal als ze niet in het jaar van vandaag valt: "6 juli 2027", maar "30 november".
// Zonder vandaag altijd met jaartal: dan weten we niet welk jaar de lezer vanzelf invult.
export function datumBijVandaag(day, vandaag) {
  const d = dagVan(day), v = dagVan(vandaag);
  return datumTekst(d, { jaar: !v || d.slice(0, 4) !== v.slice(0, 4) });
}
// Een periode krijgt op beide data een jaartal als één datum niet in dit jaar valt of als ze langer
// dan 300 dagen duurt: "8 december 2025 – 1 januari 2034", niet "8 december – 1 januari".
export function periodeTekst(start, eind, vandaag) {
  const s = dagVan(start), e = dagVan(eind), v = dagVan(vandaag);
  const jaar = [s, e].filter(Boolean).some((d) => !v || d.slice(0, 4) !== v.slice(0, 4)) || (s && e && dagenTussen(s, e) > 300);
  const d = (x) => datumTekst(x, { jaar: Boolean(jaar) });
  return s && e ? (s === e ? d(s) : `${d(s)} – ${d(e)}`) : s ? `vanaf ${d(s)}` : e ? `tot ${d(e)}` : "";
}
const meervoud = (n, een, veel) => `${n} ${n === 1 ? een : veel}`;
// Volle kalendermaanden van dag a tot dag b (JJJJ-MM-DD).
function maandenTussen(a, b) {
  const m = (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
  return Number(b.slice(8, 10)) < Number(a.slice(8, 10)) ? m - 1 : m;
}
// Lange termijnen in maanden of jaren: "nog 2641 dagen" zegt een bewoner niets, en "ruim een jaar" voor
// 21 maanden is te weinig. Van 1 tot 2 jaar in maanden ("ruim 20 maanden"), daarna in jaren.
const termijn = (n, van, tot) => {
  if (n >= 730) return `ruim ${Math.floor(n / 365)} jaar`;
  if (n >= 365) { const m = maandenTussen(van, tot); return `${van.slice(8) === tot.slice(8) ? "" : "ruim "}${m} maanden`; }
  return meervoud(n, "dag", "dagen");
};

// Hoe lang nog: "nog 38 dagen", "start over 6 dagen", of eerlijk "einddatum niet gepubliceerd".
export function resterendeDuur({ start, eind, vandaag }) {
  const s = dagVan(start), e = dagVan(eind), v = dagVan(vandaag);
  if (!v) return { toestand: "onbekend", dagen: null, tekst: "" };
  if (s && s > v) {
    const n = dagenTussen(v, s);
    return { toestand: "gepland", dagen: n, tekst: n === 1 ? "start morgen" : `start over ${termijn(n, v, s)}` };
  }
  if (!e) return { toestand: "onbekend", dagen: null, tekst: onbekendZin("werk-einde") };
  if (e < v) return { toestand: "voorbij", dagen: 0, tekst: "afgelopen" };
  const n = dagenTussen(v, e);
  return { toestand: "bezig", dagen: n, tekst: n === 0 ? "laatste dag vandaag" : `nog ${termijn(n, v, e)}` };
}

// ---------- soort werk ----------

// Volgorde telt: het specifiekere woord eerst ("afbouw stelling" is een stelling, geen sloop).
// Korte woorden staan tussen woordgrenzen, zodat een straatnaam niet meetelt: "Boomgaardstraat" is
// geen groenwerk. "distributienet" zegt niet welk net (elektriciteit, gas, water of warmte), dus
// dat woord alleen maakt nooit een elektriciteitswerk.
const AANSLUITING = "Nieuwe aansluiting op het net";
const NUTSWERK = "Werken aan nutsleidingen";
const HOOGTEWERKER = "Werk met een hoogtewerker";
const WEGENWERKEN = "Wegenwerken";
const SOORTEN_WERK = [
  // Een cabine van het net ("HS cabine", stratentoets van 12 oktober 2026): vóór de andere, want specifieker
  // dan "hoogspanning".
  [/\b(?:hs|ms|hoogspannings|middenspannings)[- ]?cabine\b|\bcabine\b/i, "Werken aan een elektriciteitscabine"],
  [/riolering|\briool|afvoerleiding/i, "Rioleringswerken"],
  [/bemaling/i, "Bemaling (grondwater wegpompen)"],
  [/warmtenet|warmteleiding|stadsverwarming/i, "Werken aan het warmtenet"],
  [/gasleiding|\bgas\b|aardgas/i, "Werken aan de gasleiding"],
  [/drinkwater|waterleiding|\bwater\b/i, "Werken aan de waterleiding"],
  [/openbare verlichting|lichtmast|straatverlichting/i, "Werken aan de straatverlichting"],
  [/verkeerslicht/i, "Werken aan de verkeerslichten"],
  [/klantaansluiting|huisaansluiting/i, AANSLUITING],
  [/elektriciteit|laagspanning|middenspanning|hoogspanning|\b\d+\s?kv\b/i, "Werken aan het elektriciteitsnet"],
  [/glasvezel|telecom|kabelnet/i, "Telecomwerken (kabels of glasvezel)"],
  [/nutsleiding|nutswerk|nutsvoorziening/i, NUTSWERK],
  [/sondering|peilbui[sz]|bodemonderzoek|grondonderzoek|infiltratieproef/i, "Bodemonderzoek"],
  [/\bboringen?\b/i, "Boringen in de grond"],
  // "voetpadkast" is een kast op het voetpad, geen wegenwerk: de paden tussen woordgrenzen.
  [/heraanleg|herinrichting|wegenis|asfalt|bestrating|\b(?:fiets|voet)pad(?:en)?\b|\brijweg(?:en)?\b|kasseien/i, WEGENWERKEN],
  [/tijdelijke halte|tramhalte|bushalte|tramsporen|tramlijn|\bde lijn\b/i, "Werken aan tram of bus"],
  [/hoogtewerker/i, HOOGTEWERKER],
  // "doorloopstelling", "gevelstelling" en "torenstelling" zijn een stelling; een "herstelling" niet.
  [/(?:\b|door|loop|gevel|toren)stelling|steiger/i, "Stelling (steiger)"],
  [/\bgevel/i, "Gevelwerken"],
  [/dakwerk|\bdak\b|\bdaken\b/i, "Dakwerken"],
  [/torenkraan|snelmontagekraan|mobiele kraan|\bkraan\b/i, "Bouwkraan"],
  // Afbraak van een gebouw of iets anders, niet van de werf zelf: "Afbraak werf", "F3 Afbraak" na "F2 werf", "Fase na
  // afbraak TK1" (de torenkraan) of een kale "afbraak" zeggen niet dat er iets gesloopt wordt (nakijkronde 12 oktober
  // 2026: zo kregen werfzones "sloopwerken" als doel).
  [/\bsloop|\bslopen\b|afbraakwerk|\b(?:afbraak|afbreken)\s+(?:van\s+)?(?:de\s+|het\s+|een\s+)?(?!(?:werf\w*|signalisatie|stelling|steiger|tk\d*|(?:toren|bouw)?kraan|en|na|tot)\b)\p{L}{3,}/iu, "Sloopwerken"],
  // "Renovatie" alleen bij een gebouw: "Renovatie Havenwegen" is een weg, geen bouwwerf.
  // "Onderbouw deel 2" en "bovenbouw" zijn de fasen van een gebouw in opbouw (stratentoets van 12 oktober 2026).
  [/ruwbouw|\b(?:onder|boven)bouw\b|nieuwbouw|appartement|verbouwing|(?:gevel|dak|woning|gebouw)renovatie|renovatie (?:van )?(?:de |het |een )?(?:woning|gebouw|pand|huis|school|kerk|gevel)|bouwwerf|bouwproject/i, "Bouwwerf"],
  // Een verhuis is privé (besluit van 18 oktober 2026, site/works-core.js): het werk heet neutraal "Inname van de openbare
  // weg". GIPOD-tekst met "verhuis" is bij de ingang al die vaste tekst (zonderVerhuis); het woord zelf staat hier nog voor
  // een tekst uit een oudere verversing.
  [/\bverhui[sz]|^inname van de openbare weg$/i, INNAME_WEG],
  [/\bcontainers?\b/i, "Container"],
  [/\bsnoei|\bboom\b|\bbomen\b|groenaanleg|beplanting/i, "Groenwerken"],
  // Woorden die beheerders vaak alleen in de fasenaam zetten (stratentoets van 12 oktober 2026): "Bijkomende
  // betonstort plan 16B", "Fase 1 : Maaien", "Afsluiten tunnel", "Onderhoudssluiting ... tunnel nacht 1",
  // vegen en kolken, zwerfvuil, "stockagezone". Achteraan: een ander, specifieker woord gaat voor.
  [/betonstort/i, "Betonstort"],
  [/\bmaai(?:en|werk(?:en)?|beurt(?:en)?)\b/i, "Maaien (groenonderhoud)"],
  [/(?:afsluit\w*|sluiting)\b[^.;|]*tunnel|tunnel\w*\b[^.;|]*\b(?:afsluit\w*|sluiting|dicht)\b/i, "Tunnelafsluiting"],
  [/tunnel/i, "Tunnelwerken"],
  [/\bvegen\b|\bveeg\w*|\bkolken\b|kolkenreiniging|zwerfvuil|straatreiniging/i, "Straatreiniging (vegen, kolken of zwerfvuil)"],
  [/stockage/i, "Opslagzone (stockage)"],
];
// Eén soort uit vrije tekst: de eerste bron met een herkend woord wint. `zonder`: soorten die niet tellen.
export function soortWerk(bronnen = [], { zonder = [] } = {}) {
  for (const { tekst, bron } of bronnen) {
    const t = clean(tekst, 500);
    if (!t) continue;
    for (const [re, soort] of SOORTEN_WERK) if (!zonder.includes(soort) && re.test(t)) return { soort, bron };
  }
  return { soort: "", bron: "" };
}

// De soort inname van GIPOD (PublicDomainOccupancyTypes) is een vaste lijst. Een net heeft een korte
// naam (voor "Werken aan elektriciteit en gas"), een eigen soort en een naam voor een aansluiting.
const NETTEN = Object.freeze({
  warmte: { kort: "warmtenet", soort: "Werken aan het warmtenet", aansluiting: "het warmtenet" },
  gas: { kort: "gas", soort: "Werken aan de gasleiding", aansluiting: "het gasnet" },
  leiding: { kort: "leidingen voor gas, olie of chemicaliën", soort: "Werken aan een leiding voor gas, olie of chemicaliën", aansluiting: "een leiding voor gas, olie of chemicaliën" },
  elektriciteit: { kort: "elektriciteit", soort: "Werken aan het elektriciteitsnet", aansluiting: "het elektriciteitsnet" },
  telecom: { kort: "telecom", soort: "Telecomwerken (kabels of glasvezel)", aansluiting: "het telecomnet" },
  water: { kort: "water", soort: "Werken aan de waterleiding", aansluiting: "de waterleiding" },
  riolering: { kort: "riolering", soort: "Rioleringswerken", aansluiting: "de riolering" },
  verlichting: { kort: "straatverlichting", soort: "Werken aan de straatverlichting", aansluiting: "de straatverlichting" },
});
const INNAME_NET = Object.freeze({
  thermisch: "warmte", "olie, gas, chemicaliën": "gas", elektriciteit: "elektriciteit", telecom: "telecom",
  water: "water", riolering: "riolering", "openbare verlichting": "verlichting",
});
// Andere soorten inname, het specifiekste eerst.
const INNAME_SOORT = [
  ["hoogtewerker", HOOGTEWERKER],
  ["stelling", "Stelling (steiger)"],
  ["(werf)kraan", "Bouwkraan"],
  // GIPOD zegt "(Verhuis)lift/levering"; bij de ingang heet die soort "Lift/levering" (innameZonderVerhuis in site/works-core.js).
  ["lift/levering", INNAME_LIFT],
  ["container", "Container"],
  ["werfkeet", "Werfkeet"],
  ["spoorwerken", "Spoorwerken"],
  ["kunstwerk", "Werken aan een brug, tunnel of viaduct"],
  ["wegeniswerken", "Wegenwerken"],
  ["nutswerken", NUTSWERK],
];
// Woorden voor een net in vrije tekst ("Klantaansluiting elektriciteit"), als GIPOD geen soort inname geeft.
const NET_WOORDEN = [
  ["warmte", /warmtenet|warmteleiding/i],
  ["gas", /\bgas\b|aardgas/i],
  ["elektriciteit", /elektriciteit|laagspanning|middenspanning|hoogspanning/i],
  ["telecom", /glasvezel|telecom/i],
  ["water", /drinkwater|waterleiding/i],
  ["verlichting", /openbare verlichting|straatverlichting/i],
];
const NET_VOLGORDE = Object.keys(NETTEN);
// Ook een soort uit een oudere verversing of historiek: "(Verhuis)lift/levering" is "lift/levering".
const splitsTypes = (lijst = []) => uniek(lijst.flatMap((t) => innameZonderVerhuis(String(t ?? "")).split(";"))).map((t) => t.toLowerCase());
const joinNl = (list) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} en ${list.at(-1)}` : list[0] || "");
// Leesbare namen van de soort inname, zoals GIPOD ze noemt (zonder "Andere").
const INNAME_LEESBAAR = Object.freeze({
  thermisch: "warmtenet", "olie, gas, chemicaliën": "gas, olie of chemicaliën", "openbare verlichting": "straatverlichting",
  wegeniswerken: "wegenwerken", kunstwerk: "brug, tunnel of viaduct", nutswerken: "nutsleidingen", "(werf)kraan": "werfkraan",
  "lift/levering": "lift of levering",
});
export function innameLeesbaar(occupancyTypes = []) {
  return splitsTypes(occupancyTypes).filter((t) => t !== "andere").map((t) => INNAME_LEESBAAR[t] || t);
}
// Welke netten de soort inname noemt. Een leiding voor "olie, gas, chemicaliën" van Fluvius is de
// gasleiding; bij een andere beheerder zeggen we niet meer dan GIPOD zelf.
function nettenUitInname(occupancyTypes, eigenaar) {
  const keys = new Set();
  for (const t of splitsTypes(occupancyTypes)) {
    const k = INNAME_NET[t];
    if (k) keys.add(k === "gas" && !/fluvius/i.test(eigenaar) ? "leiding" : k);
  }
  return NET_VOLGORDE.filter((k) => keys.has(k));
}
function nettenUitTekst(teksten) {
  const t = teksten.map((x) => clean(x, 500)).join(" · ");
  return NET_WOORDEN.filter(([, re]) => re.test(t)).map(([k]) => k);
}
const netSoort = (netten) => (netten.length === 1 ? NETTEN[netten[0]].soort : `Werken aan ${joinNl(netten.map((k) => NETTEN[k].kort))}`);
const aansluitingSoort = (netten) => `Nieuwe aansluiting op ${joinNl(netten.map((k) => NETTEN[k].aansluiting))}`;
// Beheerders van een net (elektriciteit, gas, warmte, water, riolering, telecom).
const NETBEHEERDER = /fluvius|proximus|water-?link|\bwyre\b|aquafin|\belia\b|eurofiber|telenet|pidpa|farys|watergroep|fiberklaar|unifiber/i;
// Een wegenwerk als deel van het project ("E, G, OV, Wegeniswerken"), niet alleen de bovenlaag van een werkput.
const WEGEN_PROJECT = /wegeniswerk|heraanleg|herinrichting/i;

// De soort van één werk, met de bron erbij. Eerst wat de beheerder schreef (omschrijving, fasen),
// dan de vaste soort inname van GIPOD, en pas als laatste de soort grondwerk ("distributienet",
// "klantaansluiting"): die zegt hoe er gegraven wordt, niet aan welk net.
export function soortVanWerk({ omschrijving = "", fasen = [], occupancyTypes = [], workTypes = [], eigenaar = "" } = {}) {
  const bronnen = [
    { tekst: omschrijving, bron: "omschrijving van de beheerder" },
    ...fasen.map((naam) => ({ tekst: naam, bron: "fasen van de hinder in GIPOD" })),
  ];
  let tekst = soortWerk(bronnen);
  // Een hoogtewerker is een middel, geen soort werk ("Lossen hoogtewerkers" bij een tunnelsluiting): een
  // ander woord in de tekst of de soort inname gaat voor. Pas als er niets anders is, blijft hij staan.
  let hoogtewerker = null;
  if (tekst.soort === HOOGTEWERKER) {
    const ander = soortWerk(bronnen, { zonder: [HOOGTEWERKER] });
    if (ander.soort) tekst = ander; else { hoogtewerker = tekst; tekst = { soort: "", bron: "" }; }
  }
  // "Inname van de openbare weg" (de vaste tekst voor een tekst met "verhuis", site/works-core.js) zegt alleen dat de weg
  // ingenomen wordt: een ander woord in de tekst of de soort inname van GIPOD ("Lift/levering": "Inname voor een lift of
  // levering") gaat voor. Pas als er niets anders is, blijft ze staan.
  let innameWeg = null;
  if (tekst.soort === INNAME_WEG) {
    const ander = soortWerk(bronnen, { zonder: [INNAME_WEG, HOOGTEWERKER] });
    if (ander.soort) tekst = ander; else { innameWeg = tekst; tekst = { soort: "", bron: "" }; }
  }
  const inname = nettenUitInname(occupancyTypes, eigenaar);
  const netten = inname.length ? inname : nettenUitTekst([omschrijving, ...fasen]);
  const metInname = (bron) => (inname.length ? `${bron} en de soort inname in GIPOD` : bron);
  // Een netbeheerder met een net in de soort inname: dat net is het werk. Een wegwoord in de tekst is
  // dan de bovenlaag van een werkput ("Werkput (openb): Bestrating") of een deel van het project
  // ("E, G, OV, Wegeniswerken"); dat laatste zeggen we erbij.
  if (tekst.soort === WEGENWERKEN && inname.length && NETBEHEERDER.test(eigenaar)) {
    if (WEGEN_PROJECT.test([omschrijving, ...fasen].join(" · "))) return { soort: `${netSoort(inname)}, samen met wegenwerken`, bron: metInname(tekst.bron) };
    tekst = { soort: "", bron: "" };
  }
  const types = splitsTypes(occupancyTypes);
  const grondwerk = splitsTypes(workTypes);
  // "distributienet", "transportnet" of "verkaveling" als soort grondwerk: werk aan het net zelf (vaak
  // honderden meters), ook als de beheerder er "klantaansluiting" bij schrijft. Dus geen aansluiting van één adres.
  const netwerk = grondwerk.some((t) => /distributienet|transportnet|verkaveling/.test(t));
  if (tekst.soort === AANSLUITING && netwerk) {
    if (!inname.length) return netten.length ? { soort: netSoort(netten), bron: `${tekst.bron} en de soort grondwerk in GIPOD` } : { soort: NUTSWERK, bron: "soort grondwerk in GIPOD" };
    tekst = { soort: "", bron: "" };
  }
  if (tekst.soort === AANSLUITING && netten.length) return { soort: aansluitingSoort(netten), bron: metInname(tekst.bron) };
  if (tekst.soort === NUTSWERK && inname.length) return { soort: netSoort(inname), bron: metInname(tekst.bron) };
  // Een soort uit de tekst of de fasen gaat voor, maar wat de vaste soort inname van GIPOD zegt ("Wegeniswerken"),
  // blijft erbij (`innameSoort`): zonder viel dat feit weg bij een nieuwe soort uit de fasen ("Opslagzone"),
  // nakijkronde 13 oktober 2026.
  if (tekst.soort) {
    const viaInname = types.includes("hoogtewerker") && types.includes("nutswerken") ? "Nutswerken met een hoogtewerker" : (INNAME_SOORT.find(([type]) => types.includes(type)) || [])[1] || "";
    return viaInname && viaInname !== tekst.soort ? { ...tekst, innameSoort: viaInname } : tekst;
  }
  if (inname.length) {
    if (grondwerk.includes("klantaansluiting") && !netwerk) return { soort: aansluitingSoort(inname), bron: "soort inname en soort grondwerk in GIPOD" };
    // Wegen of een kunstwerk samen met leidingen: een grote werf, geen gewoon nutswerk.
    if (types.some((t) => t === "wegeniswerken" || t === "kunstwerk")) return { soort: "Wegen- en nutswerken", bron: "soort inname in GIPOD" };
    return { soort: netSoort(inname), bron: `soort inname${netwerk ? " en soort grondwerk" : ""} in GIPOD` };
  }
  // GIPOD zegt "Hoogtewerker;Nutswerken": allebei woorden uit de vaste lijst, dus "Nutswerken met een hoogtewerker".
  if (types.includes("hoogtewerker") && types.includes("nutswerken")) return { soort: "Nutswerken met een hoogtewerker", bron: "soort inname in GIPOD" };
  for (const [type, soort] of INNAME_SOORT) if (types.includes(type)) return { soort, bron: "soort inname in GIPOD" };
  if (grondwerk.includes("klantaansluiting") && !netwerk && netten.length) return { soort: aansluitingSoort(netten), bron: "soort grondwerk in GIPOD" };
  if (hoogtewerker) return hoogtewerker;
  const uitGrondwerk = soortWerk(grondwerk.map((t) => ({ tekst: t, bron: "soort grondwerk in GIPOD" })), { zonder: netwerk ? [AANSLUITING] : [] });
  return uitGrondwerk.soort || !innameWeg ? uitGrondwerk : innameWeg;
}

// ---------- gevolgen ----------

const GEVOLGEN = [
  [/^geen doorgang voor gemotoriseerd verkeer/i, "afgesloten voor auto's", 1],
  [/^geen doorgang voor voetgangers/i, "geen doorgang voor voetgangers", 2],
  [/^geen doorgang voor fietsers/i, "geen doorgang voor fietsers", 3],
  [/^afgesloten in 1 rijrichting/i, "afgesloten in één rijrichting", 4],
  [/^rijrichting omgekeerd/i, "rijrichting omgekeerd", 4],
  [/^beperkte doorgang voor voetgangers/i, "voetgangers beperkt", 5],
  [/^beperkte doorgang voor fietsers/i, "fietsers beperkt", 6],
  [/^wisselend verkeer/i, "om beurten rijden", 7],
  [/^versmalde rijstro/i, "versmalde rijstrook", 8],
  [/^vermindering van rijstro/i, "minder rijstroken", 8],
  [/^handelaars moeilijk bereikbaar/i, "handelaars moeilijk bereikbaar", 9],
  [/^snelheidsbeperking/i, "lagere snelheid", 9],
  [/^parkeerverbod/i, "parkeerverbod", 10],
];
export function gevolgKort(gevolg) {
  const g = clean(gevolg, 160);
  for (const [re, kort] of GEVOLGEN) if (re.test(g)) return kort;
  return g ? g.charAt(0).toLowerCase() + g.slice(1) : "";
}
function rang(gevolg) {
  const g = clean(gevolg, 160);
  for (const [re, , r] of GEVOLGEN) if (re.test(g)) return r;
  return 99;
}
// Het zwaarste gevolg zoals GIPOD het schrijft ("Geen doorgang voor gemotoriseerd verkeer").
function hoofdgevolgBron(gevolgen = []) {
  return uniek(gevolgen).sort((a, b) => rang(a) - rang(b) || a.localeCompare(b, "nl"))[0] || "";
}
export function hoofdgevolg(gevolgen = []) {
  return gevolgKort(hoofdgevolgBron(gevolgen));
}
// Bus en tram: alleen als de bron het zelf noemt. Anders zeggen we niets over openbaar vervoer.
const OV = /openbaar vervoer|de lijn|\btram|\bbus|halte/i;
export function openbaarVervoer(teksten = []) {
  return uniek(teksten).filter((t) => OV.test(t));
}

// ---------- huisnummers ----------

const nr = (v) => { const m = String(v).match(/^(\d+)([a-z]?)/i); return m ? [Number(m[1]), m[2].toLowerCase()] : [Infinity, ""]; };
// "47–60" of "nr. 12" uit een lijst huisnummers (uit het adressenregister of de bron).
export function huisnummerBereik(nummers = []) {
  const list = uniek(nummers).filter((v) => /^\d+[a-z]?$/i.test(v)).sort((a, b) => nr(a)[0] - nr(b)[0] || nr(a)[1].localeCompare(nr(b)[1]));
  if (!list.length) return "";
  const lo = nr(list[0])[0], hi = nr(list.at(-1))[0];
  return lo === hi ? `nr. ${list[0]}` : `nr. ${lo}–${hi}`;
}
// Een huisnummer bestaat niet als het 0 is, en "2001" na een straatnaam is een postcode of een
// dossiercode, geen huisnummer: zulke nummers tonen we nooit (ook niet uit een oudere verversing).
const echtNummer = (v) => { const n = Number(String(v).match(/^\d+/)?.[0]); return Number.isInteger(n) && n > 0 && n < 1000; };
// Een huisnummer met een code eraan, zoals GIPOD een aansluiting schrijft ("PROEFSTRAAT 1DN02", "8werf", "12RO", "3B_BIS"):
// hoogstens drie cijfers en meteen daarna een letter. Of het een huisnummer met een code is of een code die met cijfers
// begint, is niet te zien: het blijft heel staan, zoals de bron het geeft (besluit van de eigenaar van 18 oktober 2026,
// site/works-core.js). Nooit een maat ("30m", "10kV"), een uur ("8u") of een rangtelwoord ("2de fase"), ook niet als
// gewoon huisnummer.
const NUMMER_MET_CODE = String.raw`\d{1,3}[\p{L}_][\p{L}\d_]{0,11}(?![\p{L}\d_])`;
const GEEN_HUISNUMMER = /^\d+(?:m|m2|m²|km|cm|mm|kv|u|uur|h|meter|de|ste)$/iu;
export function geldigeHuisnummers(tekst) {
  const t = clean(tekst, 40);
  const m = t.match(/^nr\. (\d+[a-z]?)(?:–(\d+[a-z]?))?$/i);
  if (!m) {
    const code = t.match(new RegExp(`^nr\\. (${NUMMER_MET_CODE})$`, "u"));
    return code && echtNummer(code[1]) && !GEEN_HUISNUMMER.test(code[1]) ? t : "";
  }
  if (!echtNummer(m[1]) || GEEN_HUISNUMMER.test(m[1]) || (m[2] && (!echtNummer(m[2]) || nr(m[2])[0] < nr(m[1])[0]))) return "";
  return t;
}
// Huisnummers die de beheerder zelf in een tekst zette: "Kammenstraat 18 - 24", "Schilderstraat 1-25", "Proefstraat 12".
// Een reeks in elke schrijfwijze telt als reeks: "13 tem 15", "13 t.e.m. 15", "13 tot en met 15", "13 t/m 15",
// "13 tot 15", "13 → 15", "13 en 15" en "13, 15 en 17" geven allemaal "nr. 13–15" (of 13–17), nooit "nr. 13".
// Hoogstens drie cijfers: "Proefstraat 13, 2000 Antwerpen" is geen reeks tot 2000. Na een komma of "en"
// telt een getal alleen als er geen woord op volgt ("Proefstraat 12, 3 dagen" is geen reeks). Een nummer met een code
// eraan ("PROEFSTRAAT 1DN02") blijft heel: "nr. 1DN02".
const NUMMER = String.raw`\d{1,3}[a-z]?(?![\d\p{L}])`;
const REEKS = String.raw`\s*(?:-|–|—|→|tot en met|t\.\s?e\.\s?m\.?|tem|t\/m|tot)\s*`;
const OPSOMMING = String.raw`\s*(?:,|en)\s*`;
const NA_OPSOMMING = String.raw`(?=\s*(?:$|[.;:,)/|]|[-–→]|(?:en|tem|tot|t\/m)(?!\p{L})))`;
export function huisnummersUitTekst(tekst, straat) {
  const t = clean(tekst, 400), s = clean(straat, 120);
  if (!t || !s) return "";
  const esc = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = t.match(new RegExp(`${esc}\\s+(${NUMMER}(?:${REEKS}${NUMMER}|${OPSOMMING}${NUMMER}${NA_OPSOMMING})*)`, "iu"));
  // Een maat of een uur ("8u tot 17u", "30m") is geen huisnummer, ook niet in een reeks.
  const delen = m ? m[1].match(/\d{1,3}[a-z]?/gi) : [];
  if (m) return delen.some((d) => GEEN_HUISNUMMER.test(d)) ? "" : geldigeHuisnummers(huisnummerBereik(delen));
  const code = t.match(new RegExp(`${esc}\\s+(${NUMMER_MET_CODE})`, "iu"));
  return code ? geldigeHuisnummers(`nr. ${code[1]}`) : "";
}

// Geen contactgegevens doorgeven, ook niet als een beheerder ze in een vrij tekstveld zette. Ook een mailadres zonder
// gewone @ (nakijkronde van head 0b264665): "naam(at)voorbeeld.test", "naam[at]...", een volle-breedte ＠ (na NFKC een
// @), "naam at voorbeeld punt test", en een losse domeinnaam ("inschrijven via voorbeeld.test"): een woord, een punt en
// een uitgang in kleine letters, zonder spatie ertussen. Een zin die na een punt zonder spatie verdergaat
// ("verzamelen.daarna"), valt daardoor ook weg: liever een omschrijving te weinig.
const CONTACT_RE = /@|https?:|www\.|\b(?:tel|gsm|contact|e-?mail|mailto)\b|\d{4}\s?\d{2}\s?\d{2}|[(\[{<]\s*(?:at|dot|punt)\s*[)\]}>]|\sat\s[^;]{0,60}?\b(?:dot|punt)\b/i;
const DOMEIN = /[\p{L}\d-]{2,}\.\p{Ll}{2,24}(?![\p{L}\d])/u;
// Een Belgisch telefoonnummer in elke schrijfwijze (nakijkronde van head c7f1a651): met 0, +32 of 0032 vooraan, 9 of 10
// cijfers samen, gescheiden door spaties, punten, schuine strepen, haakjes of koppeltekens ("03-123-45-67", "+32-3-123-45-67",
// "04/71/12/34/56", "0471 12-34-56"). Een datum ("01/10/2026", 8 cijfers) valt erbuiten.
const TELEFOON = /(?<![\p{L}\d])(?:\+32|0032|0)[\s./()-]*\d(?:[\s./()-]*\d){7,8}(?![\s./-]*\d)/u;
export const CONTACT = Object.freeze({ test: (t) => { const n = String(t ?? "").normalize("NFKC"); return CONTACT_RE.test(n) || DOMEIN.test(n) || TELEFOON.test(n); } });

// ---------- werken ----------

const FALLBACK_TITEL = /^werk in openbaar domein$/i;
// Een omschrijving die alleen een adres of een dossiercode is, zegt niets over wát er gebeurt.
function bruikbareOmschrijving(title) {
  const t = clean(title, 300);
  if (!t || FALLBACK_TITEL.test(t)) return "";
  return t;
}

// "in de Bermstraat", "in het Rozemiekepad", "op het Sint-Jansplein", "op de Vrijdagmarkt". Een naam
// zonder herkenbaar einde krijgt geen lidwoord ("in Kipdorp"): liever kaal dan een fout lidwoord.
const HET_NAAM = /(?:plein|pad|park|hof|eiland|dok|veld|erf|bos|kwartier|strand)$/i;
const DE_NAAM = /(?:straat|laan|lei|weg|dreef|baan|kaai|vest|singel|gang|steeg|poort|boulevard|dijk|plaats|markt|brug|rui|vliet|waag|berg|ring|tunnel)$/i;
// Een "vliet" (Sint-Jansvliet), een "waag" (Oude Waag) en de Singel zijn een plein of een ring: "op de".
const OP_NAAM = /(?:plein|plaats|markt|brug|kaai|dijk|vliet|waag|singel)$/i;
// Namen zonder herkenbaar einde die iedereen in Antwerpen met een lidwoord zegt.
const VASTE_NAAM = new Map([["meir", "op de"], ["wapper", "op de"], ["oudaan", "op de"]]);
export function opStraat(naam) {
  const n = clean(naam, 120);
  if (!n) return "";
  const vast = VASTE_NAAM.get(n.toLowerCase());
  if (vast) return `${vast} ${n}`;
  const lidwoord = HET_NAAM.test(n) ? "het" : DE_NAAM.test(n) ? "de" : "";
  return lidwoord ? `${OP_NAAM.test(n) ? "op" : "in"} ${lidwoord} ${n}` : `in ${n}`;
}

// Een naam na een dossiercode ("DNW12345678_Voornaam Achternaam LS_…") is een persoon, bv. een
// werkleider: die bewaren en tonen we niet. Een code met cijfers erna ("PG0971_N1_…") blijft.
// Een achternaam met een hoofdletter of in hoofdletters (minstens drie: "LS" is laagspanning).
const NAAM_NA_CODE = /(\b[A-Z]{2,6}\d{4,}_)\p{Lu}\p{Ll}+(?:[ -](?:(?:van|de|der|den|du|le|la|el|ten|ter)\s)*\p{Lu}(?:\p{Ll}[\p{L}'’]*|\p{Lu}{2,}[\p{Lu}'’]*)){1,3}/gu;
export function zonderNamen(tekst, max = 300) {
  return naamNaCodeWeg(clean(tekst, max));
}
// Hetzelfde zonder in te korten of witruimte te wijzigen (voor de historiek: lib/historiek-privacy.mjs).
export function naamNaCodeWeg(tekst) {
  return String(tekst ?? "").replace(NAAM_NA_CODE, "$1");
}
// Een los dossiernummer van zeven cijfers of meer ("Beatrijslaan - 20330374 - Koppelput") zegt een
// bewoner niets en lijkt voor de filter op contactgegevens een telefoonnummer: weg ermee, de fase blijft.
const zonderDossiernummers = (t) => t.replace(/(?<![\p{L}\d])\d{7,}(?![\p{L}\d])/gu, " ").replace(/(?:\s*[-–|]\s*){2,}/g, " - ").replace(/\s+/g, " ").trim();
const sleutel = (v) => clean(v, 300).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
// De tekst van de beheerder zoals GIPOD hem geeft, voor wie hem wil nalezen, met de huisnummers zoals hij ze schreef (de
// plaats mag exact: besluit van de eigenaar van 18 oktober 2026, site/works-core.js). Zonder naam na een dossiercode;
// leeg als er niets meer staat dan het adres op de kaart, als er contactgegevens in staan, of als het de vaste tekst is
// die een tekst met "verhuis" vervangt (INNAME_WEG: dat zijn niet de woorden van de beheerder). Noemt de beheerder een
// andere straat dan de kaart, dan blijft de tekst staan.
export function beheerderTekst(tekst, { straten = [] } = {}) {
  const t = zonderNamen(zonderVerhuis(tekst));
  if (!t || t === INNAME_WEG || CONTACT.test(t)) return "";
  return heeftInhoud(t, straten) ? t : "";
}
// Staat er meer dan het adres (postcode, gemeente, de straten van de kaart, nummers)?
function heeftInhoud(t, straten = []) {
  let rest = ` ${sleutel(t)} `;
  for (const s of straten) if (sleutel(s)) rest = rest.split(sleutel(s)).join(" ");
  rest = rest.replace(/\b\d{4}\b/g, " ").replace(/\b(?:antwerpen|anterwerpen|antwerp|andere)\b/g, " ").replace(/\d+[\p{L}_]*/gu, " ");
  return rest.split(/[^\p{L}]+/u).some((w) => w.length > 2);
}

// Wat de beheerder over het werk of het project zegt: "R1 - Ringpark Zuid", "Verkaveling",
// "Regio – Energietransitie". Per stuk tekst (tussen " - ", "|", "," …) valt weg wat alleen een adres,
// een gemeente, een nummer, een maat, een netcode (E, G, OV) of een soortwoord is; lopende zinnen
// blijven heel. Leeg als er niets anders overblijft.
const NET_CODES = /(?<![\p{L}\d])(?:E|G|OV|W|T|LS|MS|HS)(?![\p{L}\d])/gu;
const SOORT_WOORDEN = /(?<!\p{L})(?:klantaansluiting(?:en)?|wegeniswerk(?:en)?|nutswerk(?:en)?|grondwerk(?:en)?)(?!\p{L})/giu;
const STRAAT_EINDE = "(?:steenweg|straat|laan|lei|weg|dreef|baan|kaai|vest|singel|gang|poort|boulevard|dijk|plaats|markt|brug|rui|vliet|berg|ring|tunnel|plein|pad|park|hof|eiland|dok|veld|erf|bos|kwartier|strand)";
// Een reeks in elke schrijfwijze, zoals in huisnummersUitTekst: "12-14", "12 tem 14", "12 t.e.m. 14", "12 tot en met 14".
const HUISNR = "(?:[Nn][Rr]\\.?\\s*)?\\d{1,4}(?:\\s?[a-zA-Z](?!\\p{L}|\\.\\p{L}))?(?:\\s*(?:-|–|/|→|en|tot en met|t\\.\\s?e\\.\\s?m\\.?|tem|t\\/m|tot)\\s*\\d{1,4}[a-zA-Z]?)?";
// Alleen een straatnaam (woorden met een hoofdletter, "van", "de" …) met eventueel een huisnummer:
// "Xstraat | 39", "YSTRAAT", "Pieter van Voorbeeldstraat 6". Niet "Betonherstel op trambaan".
const STRAAT_WOORD = "(?:\\p{Lu}[\\p{L}'.-]*|van|de|der|den|het|ten|ter|la|le|du|des)";
const ALLEEN_ADRES = new RegExp(`^(?:\\d{4}\\s+)?(?:${STRAAT_WOORD}[\\s-]+){0,4}\\p{Lu}[\\p{L}'.-]*(?:${STRAAT_EINDE}|${STRAAT_EINDE.toUpperCase()})(?:\\s*\\[[^\\]]*\\])?(?:\\s+${HUISNR})?\\.?$`, "u");
const LEEG_STUK = [
  /^(?:nr\.?\s*)?\d{1,4}(?:\s?[a-z])?\.?$/i, // een nummer of een postcode
  // Alleen een huisnummer, zoals de beheerder het schreef: "thv 31", "nr. 12 bus 3", "1DN02". Het staat bij "Waar" of in
  // de tekst van de beheerder, en zegt niet wat het werk is.
  /^(?:(?:thv|t\.\s?h\.\s?v\.?|ter\s+hoogte\s+van)\s*)?(?:(?:nrs?|no|n°|hnr|huisnummers?)\.?\s*)?\d{1,3}[\p{L}\d_]*(?:\s*bus\s*[\p{L}\d]{1,6})?\.?$/iu,
  /^(?:\d{4}\s+)?\(?(?:antwerpen|antwerp|anterwerpen)\)?$/i, // de gemeente
  /^\([\p{L}\s-]+\)$/u, // een gemeente tussen haakjes: "(Hoboken)"
  /^\d{4}\s+[\p{L}-]+$/u, // postcode en gemeente: "2610 WILRIJK"
  /^\p{Lu}[\p{Lu}'.-]+(?:\s+\p{Lu}[\p{Lu}'.-]+){0,3}\s+\d{1,4}[a-zA-Z]?$/u, // een straat in hoofdletters met nummer: "PROEFBROEK 5"
  /^\(?\s*(?:lengte:?\s*)?\d+(?:[.,]\d+)?\s?(?:m|km|m²|m2)\.?\s*\)?$/i, // een maat
  /^(?:andere|werk in openbaar domein|rioleringswerk(?:en)?)$/i,
];
// "werken distributieleiding)" en "werken aan nutsleiding" herhalen alleen de soort; wat er dan nog van
// één woord overblijft ("tussen", een afgekapte straatnaam), is geen uitleg.
const LEIDING_ZIN = /(?<!\p{L})werken (?:aan )?(?:de )?(?:distributie|nuts|drinkwater|water)leiding(?:en)?\)?/giu;
// zonderAccenten: zoals plat() bij koppelEvenement, maar met hoofdletters en leestekens.
const zonderAccenten = (v) => v.normalize("NFD").replace(/[̀-ͯ]/g, "");
const escRe = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function projectTekst(tekst, { straten = [], max = 140 } = {}) {
  let t = clean(tekst, 300);
  // De Lijn: "Locatie: … Aard van de werken: …".
  const aard = t.match(/aard van de werken:\s*(.+)$/i);
  if (aard) t = aard[1];
  const kaartStraat = straten.map((s) => clean(s, 120)).filter(Boolean)
    .map((s) => new RegExp(`^${escRe(zonderAccenten(s))}(?:\\s*\\[[^\\]]*\\])?(?:\\s+${HUISNR}(?![\\p{L}\\d]))?\\.?\\s*`, "iu"));
  // Ook per zin ("Xstraat 13 tem 15. Ystraat 2."), en tussen twee adressen die een reeks vormen
  // ("Xplein 70 tem Ystraat 2"): elk stuk dat alleen een adres is, valt dan weg.
  const delen = t.split(/(\s+[-–|:]\s+|\s*[|;]\s*|,\s*|_|\.\s+(?=\p{Lu})|\s+(?:tem|t\.\s?e\.\s?m\.?|tot en met|t\/m)\s+(?=\p{Lu}))/u);
  const blijft = [];
  for (let i = 0; i < delen.length; i += 2) {
    // Vooraan: "2018 Antwerpen" of een volgnummer van de beheerder ("5204: Voorbeeldstraat 2A").
    let stuk = delen[i].replace(/^(?:\d{4}\s+)?\(?(?:antwerpen|antwerp)\)?(?!\p{L})\s*:?\s*(?=\S)/iu, (m) => (/^\d|:/.test(m) ? "" : m)).replace(/^\d{3,5}\s*:\s*/, "").trim();
    const voorLeiding = stuk;
    stuk = stuk.replace(LEIDING_ZIN, " ");
    const leiding = stuk !== voorLeiding;
    for (const re of kaartStraat) if (re.test(zonderAccenten(stuk))) stuk = zonderAccenten(stuk).replace(re, "");
    stuk = stuk.replace(/\(\s*lengte:?\s*\d+\s?m\s*\)/gi, " ").replace(NET_CODES, " ").replace(SOORT_WOORDEN, " ").replace(/\s+/g, " ").replace(/^[\s,;:.-]+|[\s,;:-]+$/g, "").replace(/^(?:en|of|tem|t\/m|tot(?: en met)?|t\.\s?e\.\s?m\.?)\s+/i, "").trim();
    if (!stuk || (leiding && !/\s/.test(stuk)) || ALLEEN_ADRES.test(stuk) || LEEG_STUK.some((re) => re.test(stuk))) continue;
    blijft.push(`${blijft.length ? delen[i - 1] : ""}${stuk}`);
  }
  const uit = blijft.join("").trim();
  if (!uit || !heeftInhoud(uit, straten)) return "";
  return uit.length > max ? `${uit.slice(0, max).replace(/\s+\S*$/, "")} …` : uit;
}

// De postcodes van district Antwerpen. Een fase die met een andere postcode begint ("2070 Beveren-…"),
// ligt buiten het district: haar gevolgen horen niet in de titel.
const DISTRICT_POSTCODES = new Set(["2000", "2018", "2020", "2030", "2050", "2060"]);
export function faseBuitenDistrict(naam) {
  const m = clean(naam, 160).match(/^(\d{4})\s+\p{L}/u);
  return Boolean(m && !DISTRICT_POSTCODES.has(m[1]));
}

// Feiten over één werk, zonder klok. De verversing bewaart ze; de site vult aan met vandaag.
// De plaats mag exact (besluit van de eigenaar van 18 oktober 2026, site/works-core.js): het huisnummer of het bereik
// zoals de beheerder het schreef (ook één nummer, en een nummer met een code eraan: "PROEFSTRAAT 1DN02" geeft "nr. 1DN02"),
// anders dat van het adressenregister; bij een aansluiting, een container of een lift net zo goed als bij een ander werk.
// Niets dat over een persoon of zijn huishouden vertelt: geen naam na een dossiercode, geen contactgegevens, en nooit
// "verhuis" (een tekst met dat woord is de vaste tekst INNAME_WEG, zonderVerhuis).
export function werkFeiten(werk = {}, { huisnummers = "", huisnummerBron = "" } = {}) {
  const omschrijving = zonderNamen(bruikbareOmschrijving(zonderVerhuis(werk.title)));
  const fasen = (werk.hindrance?.phases || [])
    .map((f) => ({ naam: zonderDossiernummers(zonderNamen(zonderVerhuis(f.description), 160)), start: dagVan(f.start), eind: dagVan(f.end), gevolgen: uniek((f.consequences || []).map(gevolgKort)), ...(faseBuitenDistrict(f.description) ? { buiten: true } : {}) }))
    .filter((f) => f.naam && !CONTACT.test(f.naam))
    .sort((a, b) => a.start.localeCompare(b.start) || a.naam.localeCompare(b.naam, "nl"));
  const soort = soortVanWerk({
    omschrijving, fasen: fasen.map((f) => f.naam),
    occupancyTypes: werk.occupancyTypes || [], workTypes: werk.workTypes || [], eigenaar: clean(werk.owner || werk.ownerGroup, 160),
  });
  const straten = uniek((werk.streets || []).map((s) => s?.name));
  const eigenNummers = straten.length ? huisnummersUitTekst([omschrijving, ...fasen.map((f) => f.naam)].join(" · "), straten[0]) : "";
  const registerNummers = geldigeHuisnummers(huisnummers);
  const gevolgen = uniek(werk.hindrance?.consequences || []);
  // Fasen buiten het district tellen niet voor de titel: dan alleen de gevolgen van de fasen erbinnen.
  const alleFasen = werk.hindrance?.phases || [];
  const binnen = alleFasen.filter((p) => !faseBuitenDistrict(p.description));
  const titelGevolgen = binnen.length === alleFasen.length ? gevolgen : uniek(binnen.flatMap((p) => p.consequences || []));
  // De periode van het zwaarste gevolg: de fasen die het noemen, anders de hele hinder.
  const hoofd = hoofdgevolgBron(titelGevolgen);
  const metHoofd = binnen.filter((p) => (p.consequences || []).some((c) => clean(c, 160) === hoofd));
  const gevolgStart = metHoofd.map((p) => dagVan(p.start)).filter(Boolean).sort()[0] || dagVan(werk.hindrance?.start);
  const gevolgEind = metHoofd.map((p) => dagVan(p.end)).filter(Boolean).sort().at(-1) || dagVan(werk.hindrance?.end);
  // Geen straat op minder dan 35 m: de dichtste straatassen (site/street-core.js), als die er zijn. Twijfel
  // tussen twee straten is alleen een kruispunt als hun assen elkaar raken; anders ligt het werk ertussen.
  const buren = (werk.streetNearby || []).map((s) => ({ naam: clean(s?.name, 120), afstand: Math.round(Number(s?.distanceMeters)) })).filter((s) => s.naam && Number.isFinite(s.afstand));
  const nabij = straten.length || !buren.length ? null
    : werk.streetResolution === "ambiguous" && buren.length >= 2
      ? { kruispunt: werk.streetsMeet === true, tussen: werk.streetsMeet !== true, straten: buren.slice(0, 2).map((s) => s.naam), afstanden: buren.slice(0, 2).map((s) => s.afstand) }
    : { kruispunt: false, straten: [buren[0].naam], afstand: buren[0].afstand };
  // De straat komt uit de omschrijving van de beheerder (het punt lag niet eenduidig langs een straat).
  const straatUitTekst = straten.length && werk.streetResolution === "official_address_match";
  return {
    gipodId: Number(werk.gipodId) || null,
    // Het dossiernummer van de werfzone in A-Sign (GIPOD Reference: "GW2026-001601"), zie werfDossier in site/works-core.js.
    ...(/^GW\d{4}-\d{6}$/.test(clean(werk.dossier, 40)) ? { dossier: clean(werk.dossier, 40) } : {}),
    soort: soort.soort,
    soortBron: soort.bron,
    ...(soort.innameSoort ? { innameSoort: soort.innameSoort } : {}),
    omschrijving,
    fasen: uniekeFasen(fasen),
    // Alleen bewaren wat iets zegt: het bestand van de verversing laadt in elke browser.
    ...(innameLeesbaar(werk.occupancyTypes || []).length > 1 ? { inname: innameLeesbaar(werk.occupancyTypes) } : {}),
    opdrachtgever: clean(werkZonderVerhuis(werk.owner, "owner"), 160),
    straten,
    ...(nabij ? { nabij } : {}),
    ...(straatUitTekst ? { straatBron: "omschrijving van de beheerder", straatAfstand: Math.round(Number(werk.streetDistanceMeters)) || 0 } : {}),
    // Gezocht en geen straat met naam binnen 150 m, of niet kunnen zoeken (geen straatassen geladen).
    ...(!straten.length && !nabij ? { straatGezocht: Array.isArray(werk.streetNearby) } : {}),
    huisnummers: eigenNummers || registerNummers,
    huisnummerBron: eigenNummers ? "omschrijving van de beheerder" : registerNummers ? clean(huisnummerBron, 120) : "",
    gevolgen,
    ...(titelGevolgen !== gevolgen ? { titelGevolgen } : {}),
    // Alleen als het zwaarste gevolg een kortere periode heeft dan de hele hinder.
    ...(gevolgStart !== dagVan(werk.hindrance?.start) || gevolgEind !== dagVan(werk.hindrance?.end) ? { gevolgStart, gevolgEind } : {}),
    ernstig: werk.hindrance?.severe === true,
    hinderStart: dagVan(werk.hindrance?.start),
    hinderEind: dagVan(werk.hindrance?.end),
    hinderBekend: werk.hindrance ? true : werk.hindranceSourceLoaded === false ? null : false,
  };
}
// Feiten van een werk zonder "verhuis", ook uit een oudere verversing (kaart-uitleg.json had "Verhuis" en "Verhuislift of
// levering" als soort en "verhuis" als naam van een fase): dezelfde regel als bij de ingang (werkZonderVerhuis in
// site/works-core.js). Zoals soortVanWerk nu: de soort inname van GIPOD gaat voor op "Inname van de openbare weg" uit de
// tekst. Zonder dat woord blijft het hetzelfde object.
export function feitenZonderVerhuis(f) {
  if (!f || typeof f !== "object" || !VERHUIS.test(JSON.stringify(f))) return f;
  const uit = werkZonderVerhuis(f);
  if (uit.soort !== INNAME_WEG || !uit.innameSoort) return uit;
  const { innameSoort, ...rest } = uit;
  return { ...rest, soort: innameSoort, soortBron: "soort inname in GIPOD" };
}
function uniekeFasen(fasen) {
  const seen = new Set();
  return fasen.filter((f) => { const k = `${f.naam}|${f.start}|${f.eind}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

const periode = (s, e) => (s && e ? (s === e ? datumTekst(s) : `${datumTekst(s)} – ${datumTekst(e)}`) : s ? `vanaf ${datumTekst(s)}` : e ? `tot ${datumTekst(e)}` : "");

// Een eigen periode in gewone taal: "op 12 oktober", "van 2 tot 6 november", "van 30 november 2026 tot
// 2 oktober 2027". Jaartallen zoals periodeTekst.
export function vanTot(start, eind, vandaag) {
  const s = dagVan(start), e = dagVan(eind), v = dagVan(vandaag);
  if (!s || !e) return s ? `vanaf ${datumBijVandaag(s, v)}` : e ? `tot ${datumBijVandaag(e, v)}` : "";
  if (s === e) return `op ${datumBijVandaag(s, v)}`;
  const jaar = [s, e].some((d) => !v || d.slice(0, 4) !== v.slice(0, 4)) || dagenTussen(s, e) > 300;
  return `van ${s.slice(0, 7) === e.slice(0, 7) ? Number(s.slice(8, 10)) : datumTekst(s, { jaar })} tot ${datumTekst(e, { jaar })}`;
}
// Een eigen periode staat pas apart in de titel als ze minstens een week korter is dan het werk.
const WEEK = 7;
// Het zwaarste gevolg in de titel, met zijn eigen periode als die niet samenvalt met het werk:
// "afgesloten voor auto's tot 30 november" bij een werk tot 6 juli 2027. Een gevolg dat al voorbij
// is, staat niet meer in de titel. Geeft { tekst, vorm } terug:
// - "samen": het gevolg loopt zo lang als het werk ("afgesloten voor auto's tot 20 november (nog 42 dagen)");
// - "eigen": met een eigen periode, daarna "; werken tot …";
// - "kort": stopt minder dan een week voor het werk; de titel noemt alleen de einddatum van het gevolg;
// - "laatste": alleen op de laatste dag van het werk ("op 4 januari 2027, de laatste dag van de werken");
// - "na": GIPOD meldt het gevolg pas na het einde van het werk (of vanaf de laatste dag tot erna); dan
//   geen "werken tot" (wel "werken vanaf" als het werk nog moet beginnen).
function gevolgInTitel(gevolg, { gs, ge, start, eind, vandaag, gepland }) {
  if (!gevolg || !vandaag) return { tekst: gevolg, vorm: "samen" };
  const dt = (d) => datumBijVandaag(d, vandaag);
  if (ge && ge < vandaag) return { tekst: "", vorm: "samen" };
  if (gs && eind && (gs > eind || (gs === eind && ge > eind))) return { tekst: `${gevolg} ${vanTot(gs, ge, vandaag)}`, vorm: "na" };
  const korter = Boolean(ge && eind && ge < eind);
  const veelKorter = korter && dagenTussen(ge, eind) >= WEEK;
  // Een gevolg dat nog moet beginnen, krijgt altijd zijn begindatum: anders lijkt het nu al te gelden.
  if (gs && gs > vandaag) {
    // Begint samen met een gepland werk en loopt (bijna) even lang: "… vanaf 9 november (start over 30 dagen)".
    if (gepland && gs === start && !veelKorter) return { tekst: gevolg, vorm: "samen" };
    if (gs === eind && (!ge || ge === eind) && !(gepland && gs <= start)) return { tekst: `${gevolg} op ${dt(gs)}, de laatste dag van de werken`, vorm: "laatste" };
    // Hinder vóór een gepland werk ("op 30 oktober; werken vanaf 9 november") of die vóór het einde van
    // het werk stopt ("van 15 tot 16 oktober; werken vanaf 14 oktober"): met haar einddatum.
    const eigenEinde = korter || (gepland && gs < start);
    return { tekst: `${gevolg} ${eigenEinde ? vanTot(gs, ge, vandaag) : `vanaf ${dt(gs)}`}`, vorm: "eigen" };
  }
  if (veelKorter) return { tekst: `${gevolg} tot ${dt(ge)}`, vorm: "eigen" };
  if (korter && !gepland) return { tekst: `${gevolg} tot ${dt(ge)}`, vorm: "kort" };
  return { tekst: gevolg, vorm: "samen" };
}

// De fasen van een werf in GIPOD zeggen vaak waarvoor ze dient ("Onderbouw deel 2", "Laad en loszone + Gevelstelling",
// "Montage/Demontage Torenkraan"), ook als de beheerder zelf geen omschrijving publiceert. Een nummer ("Fase 3"), een
// plancode ("plan 26-00889-09", "P26-02644-06/07/08"), "Fictieve fase" of alleen "Werken zelf" zegt niets. Geeft de
// namen die iets zeggen, zonder nummering of plancode, in de volgorde van de fasen.
const FASE_NUMMER = /^\s*(?:fase|deel|f)\s*-?\s*0*\d+[a-z]?\b\s*(?:[:.)\]–—-]+\s*)?/i;
// Plancodes en dossiercodes: "plan 26-00889-09", "(plan 3)", "P26-02644-06/07/08", "pP25-02024-04", "F21-8000-646A",
// "DE240707", "GW2025-106942", "2026-001010".
const PLAN_CODE = /\(\s*plan\s*[\w-]*\s*\)|\bplan\s*[\w-]*\d[\w-]*|\b[a-z]{0,3}\d{2,}(?:[-/.][\w]+)*\b\.?/gi;
const DOSSIER_CODE = /\b(?:GW|ET)\d{4}-?\d{6}\b/g;
// Een fase die alleen de stand van de vergunning zegt, geen werk: "Fictieve fase", "Werken zelf", "bouwverlof",
// "verlenging", "inname", "parkeerverbod", "nieuwe situatie" ...
// Ook "extra dag", "project", "opbouw", "werf", "perimeter afzetting", "inkrimping van de werfzone", "werf in- en
// uitrit" en "globaal" (nakijkronde 12 oktober 2026), met of zonder "aangepaste", "bijkomende" of "extra" ervoor.
const LEGE_FASE = /^(?:na\s+|tijdens\s+|vervolg\s+)?(?:(?:aangepaste|algemene|bijkomende|extra|nieuwe|eerste|tweede|derde|laatste|kleinere|grotere)\s+)*(?:fictieve fase|werken zelf|werken|werkzaamheden|uitvoering(?: (?:der |van de )?werken)?|uitvoeringsfase|periode|fase|werfzone|werf|signalisatie|algemeen|globaal|project|voorbereiding|vervolg|rest|bouwverlof|verlenging|nieuwe situatie|enkelrichting|inkrimping(?: van de werfzone)?|instandhouding(?: inname)?|inname|parkeerverbod|werfinrichting|inrichting|werfinrit|(?:werf\s*)?in- en uitrit|basiswerf|reguliere fase|recurrente fase|opbouw|afbouw|afbraak(?: werf)?|opbouw werf|perimeter(?: afzetting)?|afzetting|dag|dagen|week|nacht)$/i;
// Alleen een straat of plein ("Molenstraat", "Frederik Van Eedenplein", "Koordekenshoef") zegt waar, niet waarvoor.
const FASE_STRAAT_EINDE = "(?:straat|straatje|laan|lei|plein|weg|kaai|kade|vest|dijk|plaats|markt|brug|park|singel|steenweg|hoef|hof|dok|tuin|dreef|pad|rui|vliet|gracht|poort|berg|baan|velden|hoek)";
const ALLEEN_STRAAT = new RegExp(`^(?:\\p{Lu}[\\p{L}'’.-]*\\s+){0,3}\\p{Lu}?[\\p{L}'’.-]*${FASE_STRAAT_EINDE}$`, "u");
// Een straat achteraan ("aangepaste recurrente fase Zwartzustersstraat") zegt waar, niet waarvoor.
const STRAAT_ACHTERAAN = new RegExp(`\\s+\\p{Lu}[\\p{L}'’.-]*${FASE_STRAAT_EINDE}$`, "u");
// Een fasenaam zegt waarvoor de werf dient als soortWerk er een soort werk in herkent, of als hij een werk noemt dat
// gebeurt (monteren, plaatsen, leveren, storten, slopen, maaien, een "kelderwerk"...). Anders is het een naam die
// niets zegt over het doel ("silo", "Project ...", een plaats): die tonen we niet als doel (nakijkronde 12 oktober
// 2026: "extra dag", "Koordekenshoef" en "Perimeter afzetting" stonden als "Waarvoor, volgens GIPOD").
const WERK_IN_FASE = /\b(?:de)?monta\w*|\binstall\w*|\b(?:terug)?plaats(?:en|ing)\b|\blever(?:en|ing\w*)\b|\blossen\b|\blaad-? en los\w*|\blaadzone|\bloszone|\bstort\w*|\w+stort\b|\brenov\w*|\bherstel\w*|\bvervang\w*|\b(?:her)?aanleg\w*|\bsloop\w*|\bslopen\b|\bgraaf\w*|\w*sluiting\b|\bafsluit\w*|\bmaai\w*|\bledig\w*|\breinig\w*|\bschilder\w*|\bmarkering\w*|\bbeschoei\w*|\bopslag\w*|\bstockage\w*|\bbemaling|\bzuivering|\bisolat\w*|\b(?:onder|boven|kelder|ruw|nieuw|ver|her)bouw\w*|\bbouwwerk\w*|\b\w+werk(?:en)?\b/iu;
const GEEN_WERK_IN_FASE = /\b(?:werf|uitvoerings?)werk/i;
const zegtWaarvoor = (naam) => Boolean(soortWerk([{ tekst: naam }]).soort) || (WERK_IN_FASE.test(naam) && !GEEN_WERK_IN_FASE.test(naam.match(WERK_IN_FASE)?.[0] || ""));
export function faseDoelen(fasen = []) {
  const uit = [];
  for (const fase of fasen) {
    let naam = clean(typeof fase === "string" ? fase : fase?.naam, 160).replace(DOSSIER_CODE, "")
      // Wie het doet ("Levering van ... door <firma>") hoort niet bij het doel.
      .replace(/\s+door\s+\S.*$/i, "")
      // Een nummer na "pand", "nummer" of "nr" is een adres: dat stuk valt weg.
      .replace(/\b(?:(?:pand|woning|gevel)\s+)?(?:huis)?(?:nummers?|nrs?\.?|n°)\s*\d+\w*/gi, " ");
    // "vervolg fase 2: opbouw", "Fase 6: Fase 4: ...": de nummering (ook herhaald) en een fase achteraan weg.
    for (let i = 0; i < 3; i++) naam = naam.replace(/^\s*vervolg\s+(?=fase\b)/i, "").replace(FASE_NUMMER, "");
    naam = naam.replace(PLAN_CODE, " ").replace(/\s+fase\s*\d+\w*\s*$/i, "")
      .replace(/^\s*fase\b\s*[-:]?\s*/i, "").replace(/\(\s*\)/g, "").replace(/\s{2,}/g, " ")
      .replace(/^(?:periode\s+)?tijdens\s+(?:de\s+)?/i, "").replace(/^[\s:;,.|()=–—-]+|[\s:;,.|(=–—-]+$/g, "").trim();
    // Een haakje dat niet sluit (de rest viel weg), en een lange zin tot aan het eerste haakje.
    if ((naam.match(/\(/g) || []).length > (naam.match(/\)/g) || []).length) naam = naam.replace(/\s*\([^()]*$/, "").trim();
    if ((naam.match(/\)/g) || []).length > (naam.match(/\(/g) || []).length) naam = naam.replace(/\)\s*$/, "").trim();
    if (naam.length > 70 && naam.includes("(")) naam = naam.slice(0, naam.indexOf("(")).trim();
    // Alleen een datum of een uur ("12/10-22u tem 13/10-6u") zegt niet waarvoor.
    const woorden = naam.replace(/\d+(?:[/:.u-]\d*)*u?/gi, " ").replace(/\b(?:tem|t\/m|tot|van|vanaf|en)\b/gi, " ");
    const zonderStraat = naam.replace(STRAAT_ACHTERAAN, "").trim();
    if (!naam || LEGE_FASE.test(naam) || LEGE_FASE.test(zonderStraat) || /^zonder\b/i.test(naam) || (ALLEEN_STRAAT.test(naam) && !soortWerk([{ tekst: naam }]).soort) || !/\p{L}{4}/u.test(woorden) || CONTACT.test(naam) || !zegtWaarvoor(naam)) continue;
    // Een reeks ("Onderhoudssluiting ... nacht 1", "... nacht 2"): één keer, zonder het volgnummer.
    const kern = naam.replace(/\s*\b(?:nacht|dag|week)\s*\d+[a-z]?$/i, "").trim() || naam;
    if (!uit.some((x) => x.toLowerCase() === kern.toLowerCase())) uit.push(kern);
  }
  return uit;
}

// Titel, korte uitleg en details voor één werk. `werf`: { dossier } als het werk in GIPOD hetzelfde
// dossiernummer heeft als een werfzone in A-Sign (samenWerven in place-core.js). Zo'n werk is de werfzone zelf, door
// de dienst die de vergunning geeft in GIPOD gezet: geen "Werken van Stad Antwerpen", wel "Werf", met de fasen van
// GIPOD als wat, en "Beheerder in GIPOD" in plaats van "Opdrachtgever".
export function werkKaartje(werk = {}, { vandaag, feiten = null, werf = null } = {}) {
  // Ook feiten uit een oudere verversing (samenWerk in site/place-core.js): nooit "verhuis" (feitenZonderVerhuis).
  const f = feitenZonderVerhuis(feiten || werkFeiten(werk));
  const start = dagVan(werk.start), eind = dagVan(werk.end), v = dagVan(vandaag);
  const dt = (d) => datumBijVandaag(d, v);
  const straat = f.straten[0] || "";
  // Het huisnummer of het bereik, ook één nummer en een nummer met een code ("nr. 1DN02"): de plaats mag exact (besluit
  // van 18 oktober 2026). Een ongeldig nummer ("nr. 0", "nr. 2001", een maat) uit een oudere verversing niet.
  const nummers = geldigeHuisnummers(f.huisnummers);
  const nabij = !straat && f.nabij?.straten?.length ? f.nabij : null;
  const soort = f.soort || (werf ? "Werf" : werk.ownerGroup && !/^(Andere|Onbekend)$/.test(werk.ownerGroup) ? `Werken van ${werk.ownerGroup}` : "Werken");
  // Bij een werf zonder soort: de fasen die iets zeggen (faseDoelen), zonder naam (zoals de regel "Fasen").
  const doelen = werf && !f.soort ? faseDoelen((f.fasen || []).map((x) => x.naam)) : [];
  const beheerderLabel = werf ? "Beheerder in GIPOD" : "Opdrachtgever";
  // Waar, altijd met een voorzetsel: "in de Bermstraat nr. 2–10", of zonder straat het kruispunt of
  // de dichtste straat. Zonder enige straat in de buurt blijft de titel zonder plek.
  const waar = straat ? [opStraat(straat), nummers].filter(Boolean).join(" ")
    : nabij?.kruispunt ? `bij het kruispunt van ${joinNl(nabij.straten)}`
    : nabij?.tussen ? `tussen ${joinNl(nabij.straten)}`
    : nabij ? `nabij ${opStraat(nabij.straten[0]).replace(/^(?:in|op) /, "")}` : "";
  const plek = straat ? [straat, nummers].filter(Boolean).join(" ") : nabij ? joinNl(nabij.straten) : "";
  // De hinder kan vroeger stoppen dan het werk; voor "tot wanneer" telt het werk zelf.
  const duur = resterendeDuur({ start, eind, vandaag });
  let wanneer = "";
  // Een werk van één dag: "op 26 oktober" of "vandaag", niet "vanaf" of "tot" (alsof het dagen duurt).
  if (start && eind && start === eind) wanneer = duur.toestand === "gepland" ? `op ${dt(start)} (${duur.tekst})` : duur.toestand === "bezig" ? "vandaag" : "";
  else if (duur.toestand === "bezig") wanneer = `tot ${dt(eind)} (${duur.tekst})`;
  else if (duur.toestand === "gepland") wanneer = `vanaf ${dt(start)} (${duur.tekst})`;
  // Gevolgen in een fase buiten het district (bv. postcode 2070) horen niet in de titel of de samenvatting.
  const titelGevolgen = f.titelGevolgen || f.gevolgen;
  const gevolg = gevolgInTitel(hoofdgevolg(titelGevolgen), {
    gs: f.gevolgStart || f.hinderStart || "", ge: f.gevolgEind || f.hinderEind || "", start, eind, vandaag: v, gepland: duur.toestand === "gepland",
  });
  const kop = [soort, waar].filter(Boolean).join(" ");
  const tussenHaakjes = (t) => (t ? ` (${t})` : "");
  const titel = !gevolg.tekst ? [kop, wanneer].filter(Boolean).join(" ")
    : gevolg.vorm === "na" ? `${kop}: ${gevolg.tekst}${duur.toestand === "gepland" ? `; werken ${wanneer}` : ""}`
    : gevolg.vorm === "kort" ? `${kop}: ${gevolg.tekst}${tussenHaakjes(resterendeDuur({ start, eind: f.gevolgEind || f.hinderEind, vandaag }).tekst)}`
    : gevolg.vorm === "laatste" ? `${kop}: ${gevolg.tekst}${duur.toestand === "gepland" ? `; werken ${wanneer}` : tussenHaakjes(duur.tekst)}`
    : gevolg.vorm === "eigen" ? `${kop}: ${gevolg.tekst}${wanneer ? `; werken ${wanneer}` : ""}`
    : `${kop}: ${gevolg.tekst}${wanneer ? ` ${wanneer}` : ""}`;

  const ontbreekt = [];
  if (!f.omschrijving) ontbreekt.push(NIET_GEPUBLICEERD);
  if (!nummers) ontbreekt.push(onbekendZin("werk-huisnummers"));
  if (f.hinderBekend === false || (f.hinderBekend && !f.gevolgen.length)) ontbreekt.push(onbekendZin("werk-gevolgen"));
  if (f.hinderBekend === null) ontbreekt.push("gevolgen voor het verkeer nu niet opgehaald");
  if (!eind) ontbreekt.push(onbekendZin("werk-einde"));

  // Eerst één zin in gewone taal; de tekst van de beheerder staat apart (bronTekst, ingeklapt), met de huisnummers
  // zoals hij ze schreef.
  const bronTekst = beheerderTekst(f.omschrijving, { straten: f.straten });
  // Het werk of project in de woorden van de beheerder ("R1 - Ringpark Zuid") staat zichtbaar bij "Wat",
  // tenzij het alleen de soort herhaalt ("Riolering" bij "Rioleringswerken"). projectTekst laat een stuk weg
  // dat alleen een adres is ("PROEFBROEK 5", "Xstraat thv 31"): de plaats staat bij "Waar".
  const projectRuw = f.soort && bronTekst ? projectTekst(bronTekst, { straten: f.straten }).replace(/^[\s,;:|–-]+|[\s,;:|–-]+$/gu, "") : "";
  const project = projectRuw && heeftInhoud(projectRuw, f.straten) && !sleutel(f.soort).includes(sleutel(projectRuw)) ? projectRuw : "";
  const inname = (f.inname || []).length > 1 ? ` Volgens GIPOD: ${f.inname.join(" · ")}.` : "";
  const regels = [];
  regels.push(["Wat", f.soort
    ? `${f.soort}, afgeleid uit de ${f.soortBron}.${project ? ` Volgens de beheerder: “${project}”.` : ""}${inname}${f.innameSoort && !inname ? ` De soort inname in GIPOD: ${f.innameSoort.charAt(0).toLowerCase()}${f.innameSoort.slice(1)}.` : ""}${f.omschrijving ? "" : ` ${onbekendZin("beheerder-geen-omschrijving")}`}`
    : werf ? `Een werf: dit werk staat in GIPOD met het dossiernummer van werfzone ${werf.dossier} in A-Sign.${doelen.length ? ` De fasen in GIPOD zeggen wat er gebeurt: ${doelen.map((x) => `“${x}”`).join(", ")}.` : ""}${bronTekst ? ` De beheerder schrijft: “${bronTekst}”` : ""}`
    : bronTekst ? `De beheerder schrijft: “${bronTekst}”`
    : onbekendZin(f.omschrijving ? "werk-alleen-adres" : "werk-wat")]);
  // De fasen zoals GIPOD ze noemt, met hun huisnummers (de plaats mag exact); zonder naam en nooit met "verhuis".
  const fasen = f.fasen.filter((x) => x.naam);
  if (fasen.length) regels.push(["Fasen", fasen.map((x) => `${x.naam}${x.buiten || faseBuitenDistrict(x.naam) ? " (buiten district Antwerpen)" : ""}${x.start || x.eind ? ` (${periodeTekst(x.start, x.eind, v)})` : ""}${x.gevolgen?.length ? `: ${x.gevolgen.join(", ")}` : ""}`).join(" · ")]);
  regels.push([beheerderLabel, f.opdrachtgever || onbekendZin("niet-gepubliceerd")]);
  // Een straat uit de omschrijving van de beheerder: zeg dat, en hoe ver het punt in GIPOD ervan ligt.
  const uitTekst = straat && f.straatBron ? [
    nummers && f.huisnummerBron === f.straatBron ? `straat en ${/–/.test(nummers) ? "huisnummers" : "huisnummer"} uit de ${f.straatBron}` : `straat uit de ${f.straatBron}`,
    (f.straatAfstand || 0) <= 10 ? "het punt in GIPOD ligt er vlakbij" : `het punt in GIPOD ligt er ongeveer ${f.straatAfstand} m van`,
  ] : [];
  const nummerBron = nummers && f.huisnummerBron && !(f.straatBron && f.huisnummerBron === f.straatBron) ? [f.huisnummerBron] : [];
  const haakjes = (lijst) => (lijst.length ? ` (${lijst.join("; ")})` : "");
  regels.push(["Waar", straat
    ? nummers ? `${straat}, ${nummers}${haakjes([...nummerBron, ...uitTekst])}`
      : `${f.straten.join(", ")}${haakjes(uitTekst)}`
    : nabij?.kruispunt ? `Bij het kruispunt van ${joinNl(nabij.straten)} (berekend uit het punt in GIPOD)`
    : nabij?.tussen ? `Tussen ${nabij.straten.map((n, i) => `${n} (ongeveer ${nabij.afstanden?.[i] ?? "?"} m)`).join(" en ")}; berekend uit het punt in GIPOD, de twee straten raken elkaar daar niet`
    : nabij ? nabij.afstand <= 35 ? `Nabij ${nabij.straten[0]} (ongeveer ${nabij.afstand} m; berekend uit het punt in GIPOD)` : `Niet langs een straat met naam; de dichtste straat is ${nabij.straten[0]} (ongeveer ${nabij.afstand} m)`
    : f.straatGezocht ? "Alleen als punt op de kaart van GIPOD; geen straat met naam binnen 150 m van dat punt"
    : "Alleen als punt op de kaart van GIPOD; de straat kon nu niet bepaald worden"]);
  // De omschrijving met dezelfde regels als de tekst van de beheerder: geen naam, en niets als er contactgegevens in staan.
  const ovOmschrijving = zonderNamen(f.omschrijving);
  const ov = openbaarVervoer([...f.gevolgen, ...fasen.map((x) => x.naam), CONTACT.test(ovOmschrijving) ? "" : ovOmschrijving]);
  const deelsBuiten = f.titelGevolgen ? " · deels in een fase buiten district Antwerpen (zie Fasen)" : "";
  if (f.gevolgen.length) regels.push(["Gevolgen", `${uniek(f.gevolgen).join(" · ")}${f.hinderStart || f.hinderEind ? ` (${periodeTekst(f.hinderStart, f.hinderEind, v)})` : ""}${f.ernstig ? " · ernstige hinder volgens GIPOD" : ""}${deelsBuiten}`]);
  // Geen gevolgen in GIPOD: dat staat één keer in "Niet in de bron" (ontbreekt), niet nog eens als eigen regel.
  else if (f.hinderBekend === null) regels.push(["Gevolgen", "nu niet opgehaald"]);
  if (ov.length) regels.push(["Bus en tram", ov.join(" · ")]);
  // GIPOD meldt hinder na de einddatum van het werk: zeg het, want de titel noemt dan geen "werken tot".
  const hinderNa = eind && f.hinderEind && f.hinderEind > eind ? ` · GIPOD meldt nog hinder tot ${dt(f.hinderEind)}` : "";
  // En hinder vóór de start van het werk (die nog niet voorbij is): de titel zet dan "werken vanaf" erachter.
  const hinderVoor = start && f.hinderStart && f.hinderStart < start && (!f.hinderEind || f.hinderEind >= v)
    ? f.hinderEind && f.hinderEind < start ? ` · GIPOD meldt de hinder vóór de werkperiode (${vanTot(f.hinderStart, f.hinderEind, v)})` : ` · GIPOD meldt al hinder vanaf ${dt(f.hinderStart)}, vóór de start van het werk`
    : "";
  regels.push(["Duur", `${periodeTekst(start, eind, v) || onbekendZin("niet-gepubliceerd")}${duur.tekst ? ` · ${duur.tekst}` : ""}${hinderVoor}${hinderNa}`]);
  // De datums zeggen "bezig", GIPOD zegt nog "concreet gepland": zeg allebei, niet alleen "nu bezig".
  const status = clean(werk.status, 60);
  if (duur.toestand === "bezig" && status && !/^in uitvoering$/i.test(status)) {
    regels.push(["Stand", `De geplande periode loopt${start ? ` sinds ${dt(start)}` : ""}, maar GIPOD meldt het werk nog als “${status.toLowerCase()}”, niet als “in uitvoering”.`]);
  }

  const samenvatting = [
    f.omschrijving ? "" : f.soort ? `${f.soort} (afgeleid uit GIPOD).` : werf ? (doelen.length ? `Volgens de fasen in GIPOD: ${doelen.join(" · ")}.` : "") : onbekendZin("werk-omschrijving-zin"),
    project && project.length <= 80 ? `Volgens de beheerder: ${project}.` : "",
    f.opdrachtgever ? `${beheerderLabel}: ${f.opdrachtgever}.` : "",
    titelGevolgen.length ? `${capital(uniek(titelGevolgen).map(gevolgKort).join(", "))}.` : "",
  ].filter(Boolean).join(" ");
  // De volledige tekst van de beheerder blijft ingeklapt na te lezen, tenzij "Wat" hem al helemaal toont.
  return { titel, samenvatting, regels, ontbreekt, duur, plek, bronTekst: f.soort && bronTekst !== project ? bronTekst : "" };
}
const capital = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : "");

// ---------- evenementen (A-Sign IOD, evenementendossiers van de stad) ----------

// Vertaling van de codes die de bron meegeeft. Ze blijven in de details staan.
export const CODES = Object.freeze({
  ETL: "evenementendossier van de stad",
  IOD: "inname van het openbaar domein",
  Evenement: "dag van het evenement",
  Opbouw: "opbouw",
  Afbraak: "afbraak",
  aanvraag_goedgekeurd: "aanvraag goedgekeurd door de stad",
  toelating_gegenereerd: "toelating verleend door de stad",
  toelating_geverifieerd: "toelating verleend en nagekeken door de stad",
});
export const statusTekst = (status) => CODES[clean(status, 60)] || clean(status, 60).replace(/_/g, " ");
export function hinderTekst(value) {
  const v = clean(value, 20).toLowerCase();
  if (v === "true") return "met hinder voor het verkeer";
  if (v === "false") return "zonder hinder voor het verkeer";
  return "";
}
export function isEvenementDossier(row = {}) {
  return /^ET/i.test(clean(row.reference || row.dossier, 40)) || /^ETL$/i.test(clean(row.dossierType, 20));
}

// De privacyfilter van de vrije tekst uit A-Sign (innameBeschrijving): site/witte-lijst.js. GRONDREGEL: uit de tekst
// blijft alleen een volledige officiële straatnaam uit de straatas (`isStraat`, of een straat van de inname uit diezelfde
// straatas, `straten`) of een district van Antwerpen over; al de rest valt weg, ook elk ander woord, elk cijfer en elke
// telefoon-, mail- of huisnummervorm. Geeft "" als er geen straatnaam en geen district overblijft. De soort van een
// evenement komt nooit uit deze tekst (kenmerkTekst hieronder).
export function veiligeTekst(tekst, { straten = [], isStraat = null } = {}) {
  return witteTekst(tekst, { straten, isStraat });
}
// Een omschrijving die de kaart toont: dezelfde filter.
export const bruikbareBeschrijving = (tekst, opties = {}) => veiligeTekst(tekst, opties);

// Een bewaarde omschrijving ("Parkeerverbod in Straat: Proefstraat" in kaart-uitleg.json, ook van een verversing met
// oudere code) opnieuw door de filter. De soort vooraan is een vaste soort van A-Sign (innameTypeNaam: "Inname",
// "Parcours", "Verkeersvrije Zone", "Parkeerverbod in Straat" ...), anders "Inname": geen vrije tekst. "" als er geen
// straatnaam en geen district overblijft.
const VASTE_INNAME_SOORTEN = new Set(["Inname", "Parcours", "Parkeerverbod in Straat", "Parkeerverbod op Plein", "Verkeersvrije Zone", "Omleiding", "Blokken op shot"]);
export function veiligeOmschrijving(regel, opties = {}) {
  const m = clean(regel, 400).match(/^([^:]{2,60}): (.+)$/);
  if (!m) return veiligeTekst(regel, opties);
  const b = veiligeTekst(m[2], opties);
  if (!b) return "";
  const soort = clean(m[1], 60);
  return `${VASTE_INNAME_SOORTEN.has(soort) ? soort : "Inname"}: ${b}`;
}

// "Grote Markt" is een plein, geen markt: alleen woorden die echt een markt noemen tellen.
// "Doop" eerst: een doopstoet of doopwandeling is in de eerste plaats een studentendoop (met woordgrens:
// een "reuzendoop" is geen studentendoop). Een "winkelwandelgebied" is geen wandeling.
// De dingen uit site/evenement-wat.js (de doop van een schip, kermis, reuzenrad, stickers, vlaggen ...)
// kiest dingKeuze, met dezelfde regel als de herkenner (lib/parcours-herkenning.mjs): een ding alleen als
// het dossier erover gaat, en eerst, vóór de andere soorten (zelfde volgorde als de herkenner).
const DING_LABEL = (key) => capital((key === OPNAME.key ? OPNAME : dingVan(key)).zonder);
const SOORTEN_EVENEMENT = [
  [/\bdoop|studentendoop|schachtendoop/i, "Studentendoop"],
  [/\b\d+\s?(?:k|km)\b|loopwedstrijd|stratenloop|marathon|jogging|\brun\b|\bloop\b/i, "Loopwedstrijd"],
  [/wieler|koers|criterium|wielren/i, "Wielerwedstrijd"],
  [/fietstocht|fietstoer|fietsrit/i, "Fietstocht"],
  [/stoet(?:en)?\b|optocht|parade|processie|carnaval|\bpraalwagen(?:s)?\b/i, "Stoet"],
  [/(?<!winkel)wandel/i, "Wandeling"],
  // Niet het losse woord "markt": dat is ook een plein (Grote Markt, Veemarkt, Vrijdagmarkt).
  [/braderie|braderij|rommelmarkt|vlooienmarkt|kerstmarkt|jaarmarkt|boekenmarkt|boekenplein|stripmarkt|ambachtenmarkt|boerenmarkt|tweedehandsmarkt|verplaatsbare markt|wekelijkse markt|marktkra(?:am|men)/i, "Markt"],
  [/straatfeest|buurtfeest|wijkfeest/i, "Buurtfeest"],
  [/\bstop\b|\w+stop\b/i, "Tocht met haltes"],
];
// Soorten die het dossier zelf met naam noemt (een reuzenrad, stickers): die kán de kaart zonder
// "vermoedelijk" zeggen (soortEvenementMet beslist per dossier). De andere (een loop, een stoet) blijven
// een vermoeden uit één woord.
const ZEKERE_SOORT = new Set([...DINGEN.filter((d) => d.zeker).map((d) => DING_LABEL(d.key)), DING_LABEL(OPNAME.key)]);
export const soortIsZeker = (soort) => ZEKERE_SOORT.has(clean(soort, 200));
// Een ding dat geen evenement met publiek is (stickers, een bord, de bladslag, een opname).
const GEEN_EVENEMENT_SOORT = new Set([...DINGEN.filter((d) => !d.evenement).map((d) => DING_LABEL(d.key)), DING_LABEL(OPNAME.key)]);
export const soortIsGeenEvenement = (soort) => GEEN_EVENEMENT_SOORT.has(clean(soort, 200));
// De soort van een dossier uit zijn omschrijvingen ("Inname: ..." of de ruwe tekst): { soort, zeker }.
// `zeker` alleen voor een ding waar het hele dossier over gaat (dingKeuze); een ontkenning ("geen
// kermis") telt niet.
export function soortEvenementMet(teksten = []) {
  const lijst = teksten.map((t) => clean(t, 200).replace(/^[^:]{2,40}: /, "")).filter(Boolean);
  const vrij = lijst.map((t) => zonderOntkenning(t));
  const ander = SOORTEN_EVENEMENT.find(([re]) => vrij.some((t) => re.test(t)));
  // "Doop" alleen is geen andere soort naast een ding (de doop van een schip zegt het zelf).
  const andereSoort = Boolean(ander && (ander[1] !== "Studentendoop" || vrij.some((t) => /student|schacht|\bdril/i.test(t))));
  const ding = dingKeuze(lijst, { andereSoort });
  if (ding) return { soort: DING_LABEL(ding.key), zeker: ding.zeker };
  return { soort: ander?.[1] || "", zeker: false };
}
export function soortEvenement(teksten = []) {
  return soortEvenementMet(teksten).soort;
}

// De kenmerken van één ruwe omschrijving, als vaste woorden: de soort, de dingen en de voorwerpen (kenmerkWoorden in
// site/evenement-wat.js), en "straat" als de tekst alleen een plek noemt. Nooit de tekst zelf: de verversing en de live laag
// (normalizeIod in site/public-space-core.js) geven dit altijd mee naast de gefilterde omschrijving (ook leeg), en de
// soort van een evenement komt alleen hieruit, nooit uit de tekst die de privacyfilter (site/witte-lijst.js) overlaat.
//
// Welke omschrijvingen tellen, is precies wat origin/main voor de soort las: de vroegere woordenfilter van de kaart
// (bruikbareBeschrijving van voor de privacyfilter) liet een omschrijving alleen door met een woord over het evenement
// (SOORT_TELT) en zonder contactgegevens (SOORT_CONTACT), en alleen de eerste 140 tekens; de soort kwam uit wat zo
// overbleef. Die lijst toont hier niets: ze beslist alleen welke ruwe tekst een kenmerk krijgt, zodat de soort van elk
// evenement gelijk blijft aan die op main (een "Kermisattractie" zonder ander woord gaf daar geen kermis, en geeft hier
// ook geen). "overig": de tekst telt maar noemt niets uit de lijsten; "-": de tekst telt maar houdt na een ontkenning
// geen letter ("geen stoet"); "": de tekst telt niet (dan ook niet voor alleOmschreven, zoals op main).
const SOORT_TELT = /\b(?:van|naar|stop|start|aankomst|finish|verzamel\w*|parcours|wandel\w*|loop|run|jogging|marathon|fiets\w*|wieler\w*|koers|stoet|optocht|parade|processie|markt|braderie|feest|kermis|podium|tent|nadars?|dranghekken|parkeer\w*|verkeersvrij\w*|omleiding|doop\w*|spel\w*|drill\w*|halte|jeugd|volwassenen|ronde|stand|bar|toog|reuzenrad|kraam|kramen|servicepunt|generator)\b|\d+\s?(?:k|km)\b/i;
const SOORT_CONTACT = /[@]|https?:|www\.|\b(?:tel|gsm|contact)\b|\d{4}\s?\d{2}\s?\d{2}/i;
const SOORT_KENMERK = Object.freeze({
  Studentendoop: "doop", Loopwedstrijd: "loopwedstrijd", Wielerwedstrijd: "wielerwedstrijd", Fietstocht: "fietstocht", Stoet: "stoet",
  Wandeling: "wandeling", Markt: "braderie", Buurtfeest: "buurtfeest", "Tocht met haltes": "stop",
});
// De ruwe tekst zoals ze voor de soort telt (de eerste 140 tekens), of "" als ze niet telt.
export function telVoorSoort(tekst) {
  const t = clean(String(tekst ?? "").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&"), 140);
  return t && !SOORT_CONTACT.test(t) && SOORT_TELT.test(t) ? t : "";
}
// zonderHuisnummer zoals origin/main het had (zonder de uitzondering voor een afstand of een duur, zie zonderHuisnummer
// hieronder): main las de omschrijving van een inname voor de soort na deze functie ("Proefstraat 5 km" werd "Proefstraat km").
const zonderHuisnummerVanMain = (t) => clean(t, 200).replace(/(\p{L}*(?:straat|laan|lei|plein|baan|weg|kaai|vest|rui|markt|plaats|dreef|pad|hof|dijk|singel|brug))\s+\d+[a-z]?(?:\s*[-–]\s*\d+[a-z]?)?\b/giu, "$1");
// Een voorvoegsel vooraan een tekst ("Inname: ", of in de omschrijving zelf "Stoet: "): soortEvenementMet haalt er precies
// één weg, zoals op origin/main.
const VOORVOEGSEL = /^[^:]{2,40}: /;
// De vaste woorden van één tekst die voor de soort telt: "-" als er na een ontkenning geen letter overblijft, "overig" als ze
// niets uit de lijsten noemt.
function kenmerkWoordenVan(tekst) {
  const t = clean(zonderOntkenning(tekst), 200);
  if (!/\p{L}/u.test(t)) return "-";
  const woorden = [
    ...SOORTEN_EVENEMENT.filter(([re]) => re.test(t)).map(([, soort]) => SOORT_KENMERK[soort]),
    ...(/student|schacht|\bdril/i.test(t) ? ["student"] : []),
    ...kenmerkWoorden(t),
  ];
  const uit = [...new Set(woorden.filter(Boolean))];
  if (alleenStraat(t)) uit.push("straat");
  return uit.length ? uit.join(" ") : "overig";
}
// De kenmerken van één ruwe omschrijving, gelezen zoals origin/main ze voor de soort las, of null als de tekst niet telt
// (telVoorSoort). Main gaf soortEvenementMet per inname TWEE teksten: de omschrijving ("Inname: " + de eerste 140 tekens na
// zijn zonderHuisnummer; soortEvenementMet haalt alleen "Inname: " weg, een eigen voorvoegsel als "Stoet: " of "Doopfeest
// schip: " blijft staan) en de ruwe tekst (waar soortEvenementMet dat eigen voorvoegsel wel weghaalt). Dus ook hier twee
// aparte kenmerken, nooit samengevoegd: dingKeuze en gaatOver kijken per tekst, en `zeker` hangt daarvan af ("Kermis:
// reuzenrad en kramen" is vermoedelijk een kermis, geen zeker reuzenrad).
// - vol: de volle tekst, zoals main de omschrijving las (ook de plekpagina van main las alleen die, naast de bewaarde);
// - kort: de tekst zonder voorvoegsel, zoals main de ruwe tekst las;
// - bewaard: de volle tekst zoals de plekpagina van main hem uit kaart-uitleg.json las: main bewaarde de omschrijving na
//   zijn zonderHuisnummer en paste dat daar nog eens toe ("Proefstraat 12a 10 km" werd zo "Proefstraat km").
export function kenmerkenTekst(tekst) {
  const ruw = telVoorSoort(tekst);
  if (!ruw) return null;
  const vol = zonderHuisnummerVanMain(ruw);
  return { vol: kenmerkWoordenVan(vol), kort: kenmerkWoordenVan(ruw.replace(VOORVOEGSEL, "")), bewaard: kenmerkWoordenVan(zonderHuisnummerVanMain(vol)) };
}
// Zoals de live laag (normalizeIod in site/public-space-core.js) ze op een rij meegeeft (`kenmerk`): "vol|kort|bewaard" (een
// kenmerk zelf is alleen kleine letters en spaties, of "-"), achteraan zonder wat gelijk is aan vol ("straat" als ze alle drie
// gelijk zijn), en "" als de tekst niet telt.
export function kenmerkTekst(tekst) {
  const k = kenmerkenTekst(tekst);
  if (!k) return "";
  const delen = [k.vol, k.kort, k.bewaard];
  while (delen.length > 1 && delen.at(-1) === k.vol) delen.pop();
  return delen.join("|");
}
// De kenmerken van een rij: wat de live laag of de verversing meegaf, anders (een oudere vastlegging, een toets) uit haar
// ruwe omschrijving. Een rij uit de live laag heeft altijd een kenmerk, ook een leeg: haar gefilterde omschrijving telt dus
// nooit voor de soort.
function kenmerkDelen(r = {}) {
  const k = typeof r?.kenmerk === "string" ? r.kenmerk : kenmerkTekst(r?.description);
  if (!k) return null;
  const [vol, kort = vol, bewaard = vol] = k.split("|");
  return { vol, kort, bewaard };
}
// Voor de soort in de verversing (evenementFeiten): per inname het kenmerk van de volle tekst en dat van de tekst zonder
// voorvoegsel, elk apart (zoals main per inname de beschrijving en de ruwe tekst las); [] als de tekst niet telt.
export const kenmerkenVan = (r = {}) => { const k = kenmerkDelen(r); return k ? [k.vol, k.kort] : []; };
// Alleen het kenmerk van de volle tekst: zo las de plekpagina van origin/main de live omschrijvingen naast een bewaarde
// uitleg (alleen de beschrijvingen, niet de ruwe tekst).
export const volKenmerkVan = (r = {}) => kenmerkDelen(r)?.vol || "";
// Wat de verversing per inname bewaart (`kenmerken` in kaart-uitleg.json): het kenmerk zoals de plekpagina van main de
// bewaarde omschrijving las.
export const bewaardKenmerkVan = (r = {}) => kenmerkDelen(r)?.bewaard || "";
// De kenmerken van een bewaard evenement (kaart-uitleg.json), zoals de plekpagina van origin/main ze las: wat de verversing
// als `kenmerken` bewaarde (bewaardKenmerkVan, voor elke inname). Een bestand van een verversing zonder kenmerken
// (zoals origin/main het schrijft) bewaarde de omschrijvingen zelf ("Inname: Stoet: verzamelen ..."): main las die na zijn
// zonderHuisnummer (nog eens) en haalde er één voorvoegsel af ("Inname: "), niet twee; dan dus het kenmerk van wat zo
// overblijft.
export function bewaardeKenmerken(e = {}) {
  if (Array.isArray(e?.kenmerken)) return e.kenmerken.filter((k) => typeof k === "string" && k);
  return (Array.isArray(e?.beschrijvingen) ? e.beschrijvingen : []).map((b) => zonderHuisnummerVanMain(b).replace(VOORVOEGSEL, "")).filter(Boolean).map(kenmerkWoordenVan);
}
// Alle waarden die in één kenmerk kunnen staan (kenmerkWoordenVan: de soorten, "student", de dingen en voorwerpen,
// "straat"), en hoe lang een kenmerk hoogstens wordt als ze er allemaal in staan. De validatie van kaart-uitleg.json
// (KENMERK_MAX in lib/kaart-uitleg-validatie.mjs) laat minstens zoveel toe: een kenmerk wordt nooit ingekort.
export const KENMERK_DELEN = Object.freeze([...new Set([...Object.values(SOORT_KENMERK), "student", ...KENMERK_WAARDEN, "straat"])]);
export const KENMERK_LANGST = KENMERK_DELEN.join(" ").length;
// Is dit een kenmerk (alleen vaste woorden)? Voor de validatie van kaart-uitleg.json.
const KENMERK_WOORD = new Set([...Object.values(SOORT_KENMERK), ...KENMERK_WOORDEN, "student", "straat", "overig"].flatMap((w) => w.split(" ")));
export const isKenmerk = (k) => typeof k === "string" && (k === "-" || (/^[a-z]+(?: [a-z]+)*$/.test(k) && k.split(" ").every((w) => KENMERK_WOORD.has(w))));

// Alle innames van één dossier worden één kaartje.
export function bundelInnames(rows = []) {
  const groepen = new Map();
  for (const row of rows) {
    if (row?.kind !== "iod") continue;
    const key = clean(row.reference, 80) || clean(row.id, 200);
    const list = groepen.get(key) || [];
    list.push(row);
    groepen.set(key, list);
  }
  return groepen;
}

// Fasen in de volgorde waarin ze gebeuren: opbouw, de dag zelf, afbraak.
const FASE_VOLGORDE = Object.freeze({ Opbouw: 0, Evenement: 1, Afbraak: 2 });
const faseRang = (naam) => FASE_VOLGORDE[naam] ?? 3;
// Soort inname, voor "wat merk je" en "jouw straat".
export function innameSoort(type) {
  const t = clean(type, 80);
  if (/parcours/i.test(t)) return "parcours";
  if (/parkeerverbod/i.test(t)) return "parkeerverbod";
  if (/verkeersvrij/i.test(t)) return "verkeersvrij";
  if (/omleiding/i.test(t)) return "omleiding";
  return "inname";
}
// Een huisnummer na een straatnaam ("voorbeeldlaan 34") kan een woning zijn: dat tonen we niet.
// Een afstand of een duur na de straat ("Proefstraat 5 km") is geen huisnummer.
export const zonderHuisnummer = (t) => clean(t, 200).replace(/(\p{L}*(?:straat|laan|lei|plein|baan|weg|kaai|vest|rui|markt|plaats|dreef|pad|hof|dijk|singel|brug))\s+\d+[a-z]?(?:\s*[-–]\s*\d+[a-z]?)?\b(?!\s*(?:km|k|m|meter|u|uur|h|min)\b)/giu, "$1");

// Feiten over één evenementendossier (alle innames samen), zonder klok. `isStraat(naam)`: staat die hele naam in de
// straatas? De omschrijvingen gaan door de privacyfilter met de straten van elke inname én de straatas: een plek met De of
// Van ("De Coninckplein", "Van Eycklei") of een straat die niet bij de inname staat (een parcours krijgt in de verversing
// geen straten per inname) is anders een mogelijke naam (nakijkronde van head c7f1a651).
export function evenementFeiten(rows = [], { isStraat = null } = {}) {
  const first = rows[0] || {};
  const onderdelen = [], fasen = new Map(), types = new Set();
  const perSoort = { parcours: new Set(), parkeerverbod: new Set(), verkeersvrij: new Set(), omleiding: new Set(), inname: new Set() };
  // Per soort en per straat de dagen (alle fasen samen): "jouw straat krijgt een parkeerverbod van
  // vrijdag 9 tot zondag 11 oktober". A-Sign publiceert alleen dagen, geen uren.
  const perSoortDagen = { parcours: {}, parkeerverbod: {}, verkeersvrij: {}, omleiding: {}, inname: {} };
  let hinder = "";
  for (const r of rows) {
    const type = clean(r.innameType || r.title, 80);
    if (type) types.add(type);
    const fase = clean(r.phase, 40);
    if (fase) {
      const s = dagVan(r.start), e = dagVan(r.end) || s, p = fasen.get(fase) || { naam: fase, start: "", eind: "" };
      if (s && (!p.start || s < p.start)) p.start = s;
      if (e && (!p.eind || e > p.eind)) p.eind = e;
      fasen.set(fase, p);
    }
    if (clean(r.hindrance, 10).toLowerCase() === "true") hinder = "True";
    else if (!hinder && r.hindrance) hinder = clean(r.hindrance, 10);
    const soortInname = innameSoort(type), rs = dagVan(r.start), re = dagVan(r.end) || rs;
    for (const s of r.streets || []) {
      if (!s?.name) continue;
      const naam = clean(s.name, 120);
      perSoort[soortInname].add(naam);
      if (!rs) continue;
      const p = perSoortDagen[soortInname][naam] || { start: rs, eind: re };
      if (rs < p.start) p.start = rs;
      if (re > p.eind) p.eind = re;
      perSoortDagen[soortInname][naam] = p;
    }
    const b = bruikbareBeschrijving(r.description, { straten: r.streets || [], isStraat });
    if (b) onderdelen.push(`${type === "Parcours" ? "Parcours" : type || "Inname"}: ${b}`);
  }
  const starts = rows.map((r) => dagVan(r.start)).filter(Boolean).sort();
  const ends = rows.map((r) => dagVan(r.end)).filter(Boolean).sort();
  const straten = uniek(rows.flatMap((r) => (r.streets || []).map((s) => s?.name))).sort((a, b) => a.localeCompare(b, "nl"));
  const beschrijvingen = uniek(onderdelen);
  // De soort en de voorwerpen komen uit de kenmerken van de ruwe omschrijvingen (kenmerkenTekst: vaste woorden, nooit de
  // tekst zelf, en nooit de gefilterde omschrijving): per inname dat van de volle tekst en dat van de tekst zonder
  // voorvoegsel, elk apart, zoals main per inname de beschrijving en de ruwe tekst las. De live laag en de verversing geven
  // ze mee (`kenmerk`, uit normalizeIod); een rij zonder `kenmerk` (een oudere vastlegging, een toets) krijgt ze uit haar
  // omschrijving.
  const ruw = rows.flatMap(kenmerkenVan);
  // Een fase "Opname" (A-Sign): een film- of foto-opname, wat de omschrijving ook zegt.
  const opname = rows.some((r) => isOpnameFase(r.phase));
  const sm = opname ? { soort: DING_LABEL(OPNAME.key), zeker: true } : soortEvenementMet(ruw);
  const soort = sm.soort || "";
  // Zonder "vermoedelijk" alleen als elke inname een omschrijving heeft die voor de soort telt (een kenmerk, zie
  // kenmerkenTekst; zo telde origin/main de omschrijvingen die zijn woordenfilter toonde). Niet de gefilterde
  // omschrijving: die zegt sinds de privacyfilter alleen nog een straatnaam of een district.
  const alleOmschreven = rows.length > 0 && rows.every((r) => kenmerkenVan(r).length > 0);
  // Hoeveel innames er op de dag(en) zelf staan, en op welke dagen echt (een maandag per maand is geen
  // periode van maanden). Zie site/evenement-wat.js.
  const opDag = rows.filter((r) => clean(r.phase, 40) === "Evenement");
  const fasePeriodes = [...fasen.values()].sort((a, b) => faseRang(a.naam) - faseRang(b.naam) || a.start.localeCompare(b.start) || a.naam.localeCompare(b.naam, "nl"));
  const dag = fasen.get("Evenement");
  return {
    dossier: clean(first.reference, 80),
    dossierType: clean(first.dossierType, 20) || (isEvenementDossier(first) ? "ETL" : ""),
    start: starts[0] || "",
    eind: ends.at(-1) || "",
    fasen: fasePeriodes.map((p) => p.naam),
    fasePeriodes,
    evenementDag: dag?.start ? { start: dag.start, eind: dag.eind || dag.start } : null,
    soorten: [...types].sort((a, b) => a.localeCompare(b, "nl")),
    perSoort: Object.fromEntries(Object.entries(perSoort).map(([k, v]) => [k, [...v].sort((a, b) => a.localeCompare(b, "nl"))])),
    perSoortDagen,
    parcours: rows.filter((r) => clean(r.innameType || r.title, 80) === "Parcours").length,
    beschrijvingen,
    // De kenmerken (vaste woorden) van de volle omschrijvingen (bewaardKenmerkVan): de verversing bewaart ze in
    // kaart-uitleg.json, zodat de plekpagina de soort ook zonder live rijen kent (evenementSoort in site/place-core.js),
    // zoals de plekpagina van origin/main ze uit de bewaarde beschrijvingen las.
    kenmerken: [...new Set(rows.map(bewaardKenmerkVan).filter((k) => k && isKenmerk(k)))],
    soort,
    soortZeker: Boolean(sm.zeker && (opname || alleOmschreven)),
    alleOmschreven, opname,
    soortBron: soort ? (opname ? "de fasen van het dossier" : "omschrijvingen in het dossier") : "",
    hinder,
    straten,
    dagen: echteDagen(rows),
    innames: (opDag.length ? opDag : rows).length,
    voorwerpen: voorwerpenIn(ruw),
    versiering: soort === capital(dingVan("versiering").zonder) ? versieringTekst(ruw) : "",
  };
}

// Een parcours koppelen aan een gewoon evenement uit de agenda: dezelfde dag als het evenement zelf
// (niet de opbouw) en een straat van het dossier in de locatie. Geen gok op alleen de datum, en geen
// koppeling voor een inname van weken (een werf of een markt die maanden staat). Ook het agendapunt zelf
// duurt hoogstens zo lang: een project van september tot januari (wegenwerken, een heraanleg, een
// schoolstraat met het thema "Werken") ligt elke dag in elke straat van zijn buurt, en gaf zo veertien
// dossiers aan de Noordersingel de naam van de werken aan de Schijnpoortweg.
const GEEN_EVENEMENT = /\b(?:markets|meetings|admin|works|info|calls)\b|markt|raad|commissie|zitdag/i;
// Het thema zoals de nieuwe bronnen (district-projecten, district-schoolstraten) het in het Nederlands zetten.
const GEEN_EVENEMENT_THEMA = /^(?:werken|oproep\/deadline|inspraak)$/i;
export const MAX_KOPPEL_DAGEN = 3;
// Met { naam } (een nagekeken naam uit evenement-identiteit.json): alleen een agendapunt met die
// naam op dezelfde dag, zodat de kaart naar het juiste agendapunt linkt en niet naar een buurman.
const plat = (t) => clean(t, 200).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function koppelEvenement(feiten, agendaItems = [], { naam = "" } = {}) {
  const dag = feiten?.evenementDag?.start ? feiten.evenementDag : { start: feiten?.start, eind: feiten?.eind || feiten?.start };
  if (!dag.start || dagenTussen(dag.start, dag.eind || dag.start) >= MAX_KOPPEL_DAGEN) return null;
  const n = plat(naam);
  if (!n && !feiten.straten?.length) return null;
  // Waar het evenement zelf staat (start, tenten, parkeerverbod) weegt zwaarder dan een straat die
  // het parcours alleen passeert; zonder zulke innames telt elke straat van het dossier.
  const ps = feiten.perSoort || {};
  // Alleen bij een groot dossier: daar loopt een parcours ook langs pleinen waar iets anders gebeurt.
  const plek = uniek([...(ps.inname || []), ...(ps.parkeerverbod || []), ...(ps.verkeersvrij || [])]);
  const straten = (plek.length && (feiten.straten || []).length > 10 ? plek : feiten.straten || []).map((s) => s.toLowerCase()).filter((s) => s.length >= 5);
  let best = null;
  for (const item of agendaItems) {
    const d = dagVan(item?.date), e = dagVan(item?.endDate) || d;
    if (!d || d > (dag.eind || dag.start) || e < dag.start || dagenTussen(d, e) >= MAX_KOPPEL_DAGEN) continue;
    if (GEEN_EVENEMENT.test(`${item.category || ""} ${item.theme || ""} ${item.title || ""}`) || GEEN_EVENEMENT_THEMA.test(clean(item.theme, 40))) continue;
    const t = plat(item.title);
    if (n && !(t.length >= 6 && (t.includes(n) || n.includes(t)))) continue;
    const loc = ` ${clean(`${item.location || ""} ${item.title || ""}`, 400).toLowerCase()} `;
    const score = n ? 1 : straten.filter((s) => loc.includes(s)).length;
    if (score && (!best || score > best.score)) best = { score, item };
  }
  if (!best) return null;
  const it = best.item;
  const url = String(it.infoUrl || it.sourceUrl || it.link || "");
  return {
    titel: clean(it.title, 160),
    tijd: clean(it.timeText, 80),
    locatie: zonderHuisnummer(clean(it.location, 200)),
    // Een GIPOD-link (ruw record of datasetfiche) is geen infopagina over het evenement (site/gipod-bron.js).
    bronUrl: /^https:\/\/[^?#\s]+$/.test(url) && !gipodLink(url) ? url : "",
    agendaId: /^[a-z0-9][a-z0-9-]{2,200}$/.test(String(it.id || "")) && it.noEventPage !== true ? String(it.id) : "",
  };
}

// "38 straten in Historisch Centrum en Seefhoek". wijkVan(straatnaam) geeft een wijknaam of "".
// De straten komen uit de straatas, al zonder homoniemtoevoeging (straatasNaam in site/street-core.js).
export function stratenSamenvatting(straten = [], wijkVan = () => "") {
  const list = uniek(straten);
  if (!list.length) return "";
  if (list.length <= 3) return list.join(", ");
  const tel = new Map();
  for (const s of list) { const w = clean(wijkVan(s), 80); if (w) tel.set(w, (tel.get(w) || 0) + 1); }
  const wijken = [...tel].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "nl")).slice(0, 2).map(([w]) => w);
  return `${list.length} straten${wijken.length ? ` in ${wijken.join(" en ")}${tel.size > 2 ? " en omgeving" : ""}` : ""}`;
}

// ---------- de evenementkaart ----------

const WEEKDAGEN = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
const weekdag = (day) => WEEKDAGEN[new Date(`${day}T12:00:00Z`).getUTCDay()];
// "zondag 18 oktober" (met jaartal als het niet dit jaar is).
export function dagTekst(day, vandaag = "") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "")) return "";
  return `${weekdag(day)} ${datumTekst(day, { jaar: Boolean(vandaag) && day.slice(0, 4) !== String(vandaag).slice(0, 4) })}`;
}
// "zondag 18 oktober", "woensdag 21 en donderdag 22 oktober" of "van maandag 12 tot dinsdag 20 oktober".
// Over de jaarwissel krijgen beide dagen hun jaar ("van vrijdag 17 april 2026 tot vrijdag 30 april 2027").
export function dagenTekst(start, eind, vandaag = "") {
  if (!start) return "";
  if (!eind || eind === start) return dagTekst(start, vandaag);
  const dt = start.slice(0, 4) !== eind.slice(0, 4) ? (d) => `${weekdag(d)} ${datumTekst(d, { jaar: true })}` : (d) => dagTekst(d, vandaag);
  if (dagenTussen(start, eind) === 1) return `${dt(start).replace(/ \S+( \d{4})?$/, start.slice(5, 7) === eind.slice(5, 7) ? "" : "$&")} en ${dt(eind)}`;
  return `van ${dt(start)} tot ${dt(eind)}`;
}
// joinNl staat bovenaan (ook voor de werken).
const zin = (t) => { const s = clean(t, 800); return s ? `${capital(s)}${/[.!?]$/.test(s) ? "" : "."}` : ""; };
const hostVan = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
const KALENDER = /wat-beleef-je-in-district-antwerpen/i;
export const ZEKERHEDEN = Object.freeze(["zeker", "waarschijnlijk", "onbekend"]);
// Waarop een automatische fiche steunt (lib/parcours-herkenning.mjs, veld `methode`).
export const AUTO_HERKOMST = Object.freeze({
  kalender: "een agenda met dezelfde dag en plek",
  gipod: "GIPOD (zelfde dag, het evenementvlak overlapt het parcours)",
  organisator: "de agenda van de organisator (zelfde dag en plek)",
  besluit: "een besluit van de stad of het district (zelfde dag en straat)",
  foorlijst: "de foorlijst van de stad (zelfde plein en periode)",
  markt: "de marktlijst van de stad (zelfde plek en marktdag)",
  patroon: "dezelfde route als een vorige keer",
  // Algemeen voor elke fiche van de regels (ook een vorige editie op dezelfde plek, of dezelfde route in
  // vorige jaren); de kaart noemt per fiche de echte grond (veld `grond`). #158 toetst deze zin.
  regels: "de omschrijving in het dossier, wat vroeger op dezelfde plek gebeurde en het studentencharter",
});

// Wat jouw straat met dit evenement te maken heeft, met de dagen van een parkeerverbod of een
// verkeersvrije zone in jouw straat (ook tijdens opbouw en afbraak). f.parcoursRelatie: "op",
// "kruist", "naast", "kruist-of-naast" of null (zie parcoursRelatieVoorStraat in place-core.js).
// f.langs: straten waar het parcours echt langs loopt (berekend in de verversing), of null als dat
// niet bekend is. Waarvoor een gewone inname dient, zegt de stad niet: dan zeggen we dat ook, zonder
// te gokken. Met { geenEvenement }: "deze inname" in plaats van "dit evenement" (stickers, een bord);
// met { soortBekend }: geen "waarvoor precies, zegt de stad niet" als de kaart al zegt wat het is.
export function jouwStraat(f, straat, vandaag = "", { geenEvenement = false, soortBekend = false } = {}) {
  const naam = clean(straat, 120).toLowerCase();
  if (!naam) return "";
  const heeft = (list) => (list || []).some((s) => clean(s, 120).toLowerCase() === naam);
  const wanneer = (soort) => {
    const d = Object.entries(f.perSoortDagen?.[soort] || {}).find(([s]) => clean(s, 120).toLowerCase() === naam)?.[1];
    const t = d?.start ? dagenTekst(d.start, d.eind, vandaag) : "";
    return !t ? "" : t.startsWith("van ") ? ` ${t}` : ` op ${t}`;
  };
  const ps = f.perSoort || {};
  const delen = [];
  if (heeft(ps.verkeersvrij)) delen.push(`wordt verkeersvrij${wanneer("verkeersvrij")}`);
  if (heeft(ps.parkeerverbod)) delen.push(`krijgt een parkeerverbod${wanneer("parkeerverbod")}`);
  // f.parcoursRelatie (place-core.js, uit site/parcours-straten.js) zegt het precies voor de gekozen
  // straat; zonder die waarde beslist f.langs.
  const rel = f.parcoursRelatie ?? (Array.isArray(f.langs) ? (heeft(f.langs) ? "op" : "kruist-of-naast") : null);
  if (rel === "op") delen.push("ligt op het parcours");
  else if (rel === "kruist") delen.push("kruist het parcours of komt erop uit");
  else if (heeft(ps.parcours)) delen.push(rel === "naast" ? "ligt vlak naast het parcours" : rel === "kruist-of-naast" ? "kruist het parcours of ligt er vlak naast" : "ligt op of naast het parcours");
  if (heeft(ps.omleiding)) delen.push("ligt op de omleiding");
  const dit = geenEvenement ? "deze inname" : "dit evenement";
  // Waarvoor, zegt de kaart al bij "Wat" (één keer per kaart, niet nog eens hier).
  if (!delen.length && heeft(ps.inname)) delen.push(`wordt gebruikt voor ${dit}${wanneer("inname")}`);
  if (!delen.length && heeft(f.straten)) delen.push(`staat in het dossier van ${dit}`);
  return delen.length ? `Jouw straat ${joinNl(delen)}.` : "";
}

// Welke dagen tellen als "het evenement": de nagekeken dagen als ze binnen de inname vallen,
// anders de fase Evenement uit A-Sign, anders de hele periode van de inname.
export function evenementDagen(f, identiteit = null) {
  const dagen = (identiteit?.dagen || []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const binnen = dagen.length && (!f.start || dagen[0] >= f.start) && (!f.eind || dagen.at(-1) <= f.eind);
  if (binnen) return { start: dagen[0], eind: dagen.at(-1), bron: "identiteit" };
  if (f.evenementDag?.start) return { ...f.evenementDag, bron: "fase" };
  return { start: f.start, eind: f.eind || f.start, bron: "inname" };
}

// Het eerste uur uit een gepubliceerde urentekst: "11 tot 18.30 uur" → "11:00", "om 9.30 uur" → "09:30".
export function eersteUur(tekst) {
  const m = clean(tekst, 300).match(/\b(\d{1,2})(?:[.:](\d{2}))?(?=\s*(?:uur\b|u\b|tot\s+\d))/i);
  if (!m || Number(m[1]) > 23 || Number(m[2] || 0) > 59) return "";
  return `${m[1].padStart(2, "0")}:${m[2] || "00"}`;
}

// Waar het dossier ligt, kort, voor de titel: de plek uit de automatische fiche (lib/parcours-herkenning.mjs,
// plekKort), anders uit de straten van de innames: één straat ("op de Meir"), anders de wijk.
function plekVoorTitel(f, id, wijkVan) {
  const plek = clean(id?.plek, 120);
  if (plek) return plek;
  // Een handfiche met een soort zegt de plek al in haar eigen woorden ("tussen Middelheim en Fort VI").
  if (id && id.zekerheid !== "onbekend") return "";
  // Een parcours zonder fiche: door welke straten ("door 38 straten in Historisch centrum").
  if (f.parcours) { const s = stratenSamenvatting(f.straten, wijkVan); return s ? `door ${s}` : ""; }
  const ps = f.perSoort || {};
  const eigen = uniek([...(ps.inname || []), ...(ps.verkeersvrij || [])]);
  if (eigen.length === 1) return opStraat(eigen[0]);
  const tel = new Map();
  if (typeof wijkVan === "function") for (const s of eigen.length ? eigen : f.straten || []) { const w = clean(wijkVan(s), 80); if (w) tel.set(w, (tel.get(w) || 0) + 1); }
  const top = [...tel].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "nl"))[0]?.[0];
  if (top) return inWijk(top);
  // Buiten de wijken van district Antwerpen (of zonder wijk): de straat zelf, met "en omgeving" bij meer.
  const lijst = eigen.length ? eigen : uniek(f.straten || []);
  return lijst.length ? `${opStraat(lijst[0])}${lijst.length > 1 ? " en omgeving" : ""}` : "";
}
// Wat er staat, als de stad niet zegt wat het is: "een inname van de straat", "een parkeerverbod" ...
function innameWat(f) {
  const ps = f.perSoort || {};
  if (f.parcours) return { titel: "Parcours", zin: "een parcours" };
  if (ps.verkeersvrij?.length && !ps.inname?.length) return { titel: "Verkeersvrije zone", zin: "een verkeersvrije zone" };
  if (ps.parkeerverbod?.length && !ps.inname?.length && !ps.verkeersvrij?.length) return { titel: "Parkeerverbod", zin: "een parkeerverbod" };
  return { titel: "Inname", zin: "een inname van de openbare ruimte" };
}
const zonderLidwoord = (t) => clean(t, 200).replace(/^(?:een|de|het)\s+/i, "");
const metPlek = (t, plek) => clean(`${t}${plek ? ` ${plek}` : ""}`, 160);

// Een agendapunt over werken, een heraanleg of een schoolstraat is nooit het evenement van een dossier,
// ook niet uit een kaart-uitleg.json van vóór de strengere koppeling (koppelEvenement): weg ermee.
const WERK_TITEL = /^(?:werken|heraanleg|schoolstraat|wegenwerken|rioleringswerken)\b/i;

// De kaart van één evenementendossier. Titel en eerste regel zeggen meteen wát (een naam, een soort, of
// wat er vaststaat), wáár en wannéér, en hoe zeker dat is: "vermoedelijk" alleen met een echt signaal,
// en zonder signaal nooit alleen "de stad maakt niet bekend wat het is". Daaronder in gewone taal: wat,
// wanneer, waar, jouw straat en wat je merkt; dan de details en één korte bronregel. identiteit komt uit
// site/sources/evenement-identiteit.json (met de hand) of evenement-identiteit-auto.json (de herkenner),
// gekoppeld uit de agenda (koppelEvenement).
export function evenementKaartje(feiten, { vandaag, gekoppeld: gekoppeldIn = null, identiteit = null, straat = "", wijkVan } = {}) {
  const f = feiten;
  const gekoppeld = gekoppeldIn?.titel && WERK_TITEL.test(clean(gekoppeldIn.titel, 160)) ? null : gekoppeldIn;
  const id = identiteit && ZEKERHEDEN.includes(identiteit.zekerheid) ? identiteit : null;
  const bekend = id && id.zekerheid !== "onbekend" ? id : null;
  const koppeling = !bekend && gekoppeld?.titel ? gekoppeld : null;
  // Een automatische fiche zegt "onbekend" nadat ze de omschrijving al las: dan geen eigen woord-gok meer.
  const fSoort = id?.methode && id.zekerheid === "onbekend" ? "" : clean(f.soort, 200);
  const dagen = evenementDagen(f, bekend);
  const datum = dagenTekst(dagen.start, dagen.eind, vandaag) || onbekendZin("datum");
  const straten = stratenSamenvatting(f.straten, wijkVan);
  const duur = resterendeDuur({ start: dagen.start, eind: dagen.eind, vandaag });
  // De echte dagen: losse dagen (een maandag per maand) of een lange periode (een maand, een jaar).
  // Uit de innames zelf (de fiche bewaart bij een lange periode alleen de eerste en de laatste dag), of uit
  // de fiche als die minstens drie losse dagen noemt (de marktdagen van een markt: elke vrijdag).
  const idDagen = [...new Set((bekend?.dagen || []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
  const idLos = idDagen.length >= 3 && patroonVan(idDagen)?.losse && dagen.bron === "identiteit";
  const echt = patroonVan((idLos ? idDagen : f.dagen?.length ? f.dagen : []).filter((d) => d >= dagen.start && d <= (dagen.eind || dagen.start)), vandaag);
  const losse = Boolean(echt && echt.losse && echt.aantal > 1);
  const lang = !losse && duurDagen(dagen.start, dagen.eind) >= LANG_DAGEN;
  const wanneerKort = losse ? patroonTekst(echt, vandaag)
    : lang ? (() => { const t = patroonTekst(patroonVan(alleDagen(dagen.start, dagen.eind), vandaag), vandaag); return /^van /.test(t) ? `loopt ${t}` : t; })()
      : datum;
  const plek = plekVoorTitel(f, id, wijkVan);
  const geenEvenement = Boolean(bekend?.geenEvenement) || (!bekend && !koppeling && soortIsGeenEvenement(fSoort));

  // WAT, met de titel: wat + waar.
  let titel, wat, zeker = "";
  // Waar het "wat" vandaan komt, voor de lijst (bundelLijst in site/place-core.js): een naam, een soort uit het
  // dossier, een vermoeden, een koppeling met de agenda, een woord uit de omschrijving, of niets ("leeg").
  let watBron = "leeg";
  const inname = innameWat(f);
  if (bekend?.zekerheid === "zeker") {
    watBron = "naam";
    titel = clean(bekend.naam, 120);
    // Een soort zonder inhoud ("evenement", uit een besluit) zegt niets: dan waar de naam vandaan komt.
    const soortZin = /^(?:een )?evenement$/i.test(clean(bekend.soort, 200)) ? (bekend.grond ? `${titel}: die naam staat in ${clean(bekend.grond, 160)}.` : "") : zin(bekend.soort);
    wat = [soortZin, bekend.organisator ? `Organisator: ${clean(bekend.organisator, 200)}.` : ""].filter(Boolean).join(" ");
  } else if (bekend?.soortZeker) {
    watBron = "soort";
    // De soort staat in het dossier zelf (een reuzenrad, stickers, een studentendoop in de doopperiode).
    titel = metPlek(capital(zonderLidwoord(bekend.soort)), plek);
    wat = [`${capital(zonderLidwoord(bekend.soort))}: zo staat het in het dossier van de stad.`, zin(bekend.reden)].filter(Boolean).join(" ");
    zeker = `Zo staat het in het dossier; ${geenEvenement ? "het is geen evenement met publiek" : onbekendZin("naam-stad")}.`;
  } else if (bekend) {
    watBron = "vermoeden";
    titel = metPlek(`Vermoedelijk ${clean(bekend.soort, 200)}`, plek);
    wat = [`Vermoedelijk ${clean(bekend.soort, 200)}.`, zin(bekend.reden)].filter(Boolean).join(" ");
    zeker = `Vermoedelijk${bekend.grond ? `, afgeleid uit ${clean(bekend.grond, 160)}` : !bekend.methode ? ", met de hand nagekeken" : ""}; ${onbekendZin("naam-stad-vermoeden")}.`;
  } else if (koppeling) {
    watBron = "koppeling";
    // Een koppeling op dag en straat blijft een vermoeden: zo staat het ook in de titel.
    titel = `Vermoedelijk: ${koppeling.titel}`;
    wat = `${titel}${koppeling.locatie ? ` (${koppeling.locatie})` : ""}. Gekoppeld aan agendapunt: dezelfde dag en dezelfde straat.`;
  } else if (fSoort) {
    // Zonder "vermoedelijk" alleen als het hele dossier over dat ding gaat (soortEvenementMet, f.soortZeker).
    const z = Boolean(f.soortZeker);
    watBron = z ? "soort" : "woord";
    titel = metPlek(z ? fSoort : `Vermoedelijk een ${fSoort.toLowerCase()}`, plek);
    wat = z ? `${fSoort}: zo staat het in het dossier van de stad.` : `Vermoedelijk een ${fSoort.toLowerCase()}: dat staat in de omschrijving van het dossier. ${onbekendZin("naam-stad-zin")}`;
    zeker = z ? `Zo staat het in het dossier; ${geenEvenement ? "het is geen evenement met publiek" : onbekendZin("naam-stad")}.` : "Vermoedelijk: een woord in de omschrijving van het dossier.";
  } else {
    // Niets over wát: dan wat er wél vaststaat (soort inname, plek, periode, omvang, voorwerpen).
    titel = metPlek(/^op \d+ (?:kleine )?plekken/.test(plek) && inname.titel === "Inname" ? "Innames" : inname.titel, plek);
    const voorwerpen = (f.voorwerpen || []).slice(0, 3);
    wat = `De stad gaf toelating voor ${inname.zin}${voorwerpen.length ? `, met ${joinNl(voorwerpen)}` : ""}. ${onbekendZin("inname-wat")}`;
    zeker = `${voorwerpen.length ? `Met ${joinNl(voorwerpen)}. ` : ""}${onbekendZin("inname-wat-kort")}`;
  }
  if (f.versiering && /^straatversiering$/i.test(zonderLidwoord(titel.replace(/ (?:op|in|aan|bij) .*$/, "")))) titel = metPlek(capital(f.versiering), plek);
  // Een lange titel (een soort met plekken in twee wijken) wordt op een gsm vier of vijf regels: dan staat
  // de plek in de eerste regel, niet in de titel.
  let plekInRegel = "";
  if (plek && titel.length > TITEL_MAX && titel.endsWith(` ${plek}`)) { titel = titel.slice(0, -plek.length - 1); plekInRegel = plek; }

  // WANNEER: de dag(en) van het evenement, apart van opbouw en afbraak.
  const uren = clean(bekend?.uren || koppeling?.tijd || "", 300);
  const fasenBuiten = (f.fasePeriodes || []).filter((p) => p.naam !== "Evenement" && p.start);
  const opbouw = fasenBuiten.find((p) => p.naam === "Opbouw"), afbraak = fasenBuiten.find((p) => p.naam === "Afbraak");
  const rand = [opbouw && opbouw.start < dagen.start ? `opbouw vanaf ${dagTekst(opbouw.start, vandaag)}` : "", afbraak && afbraak.eind > dagen.eind ? `afbraak tot ${dagTekst(afbraak.eind, vandaag)}` : ""].filter(Boolean);
  const wanneer = [
    // Zonder uren: de zin staat één keer boven de sectie (onbekend-zinnen.js, evenementen-uren), niet op elke kaart.
    `${capital(losse || lang ? wanneerKort : datum)}${uren ? `, ${uren}` : ""}.`,
    zin(bekend?.urenNoot),
    rand.length ? zin(joinNl(rand)) : "",
    lang && !bekend ? onbekendZin("elke-dag") : !lang && dagen.bron === "inname" && f.eind && f.eind !== f.start ? "Dit is de periode waarin de stad de straat in gebruik geeft." : "",
  ].filter(Boolean).join(" ");

  // WAAR en JOUW STRAAT
  // Een fiche van vóór deze versie zei "Evenement zonder parcours, aan ...": wat het níet is. Die zin
  // niet meer tonen; de volgende verversing schrijft de nieuwe (lib/parcours-herkenning.mjs, plekZin).
  // Een automatische fiche zet de dagen ook in haar zin bij "Waar" (uit het venster van de herkenner); de
  // kaart zegt ze al bij "Wanneer", uit de innames zelf. Dus hier zonder dagen: anders spreken ze elkaar tegen.
  const idWaar = /^Evenement zonder parcours/i.test(clean(id?.waar, 400)) ? "" : id?.methode ? waarZonderDagen(id?.waar) : clean(id?.waar, 400);
  const waar = idWaar || (f.parcours ? `Parcours door ${straten || "de straten op de kaart"} (berekend uit de kaart van de stad).` : plek ? `${capital(plek)}${straten && !/^\d/.test(plek) ? ` (${straten}, berekend uit de kaart van de stad)` : ""}.` : straten ? `${straten} (berekend uit de kaart van de stad).` : onbekendZin("plek"));
  const jouw = jouwStraat(f, straat, vandaag, { geenEvenement, soortBekend: Boolean(bekend || koppeling || fSoort) });

  // WAT MERK JE
  const ps = f.perSoort || {};
  const afgeleid = [
    ps.parkeerverbod?.length ? `parkeerverbod in ${stratenSamenvatting(ps.parkeerverbod, wijkVan)}` : "",
    ps.verkeersvrij?.length ? `verkeersvrij: ${stratenSamenvatting(ps.verkeersvrij, wijkVan)}` : "",
    ps.omleiding?.length ? `omleiding via ${stratenSamenvatting(ps.omleiding, wijkVan)}` : "",
  ].filter(Boolean);
  // A-Sign geeft voor een parkeerverbod alleen dagen: de uren van het evenement gelden er niet voor.
  const merk = clean(id?.watMerkJe, 600) || (afgeleid.length
    ? `${zin(joinNl(afgeleid))}${ps.parkeerverbod?.length ? ` ${onbekendZin("parkeerverbod-uren")}` : ""}${f.hinder === "True" ? " De stad verwacht hinder voor het verkeer." : ""}`
    : f.parcours ? onbekendZin("parcours-straten")
      : "In het dossier staat geen afgesloten straat, parkeerverbod of omleiding: alleen de inname zelf.");

  const kern = [["Wat", wat], ["Wanneer", wanneer], ["Waar", waar]];
  if (jouw) kern.push(["Jouw straat", jouw]);
  kern.push(["Wat merk je", merk]);

  // Links naar een gewone pagina, nooit een databron, en nooit een GIPOD-link (een ruw record draagt
  // contactgegevens, site/gipod-bron.js; ook niet uit een oudere automatische fiche).
  const links = [];
  const voegToe = (url, label, uitleg = "") => { if (url && !gipodLink(url) && !links.some((l) => l.url === url)) links.push({ url, label, uitleg }); };
  if (id?.link) voegToe(id.link, clean(id.linkLabel, 80) || "Officiële info over dit evenement", clean(id.linkUitleg, 160));
  for (const l of id?.extraLinks || []) voegToe(l.url, clean(l.label, 100));
  // Bij een koppeling: de officiële pagina van het agendapunt én het agendapunt zelf.
  if (koppeling?.bronUrl) voegToe(koppeling.bronUrl, KALENDER.test(koppeling.bronUrl) ? "Districtskalender (meerdere activiteiten)" : "Officiële info over dit evenement");
  if (gekoppeld?.agendaId) voegToe(`/event/${gekoppeld.agendaId}/`, `Agendapunt: ${clean(gekoppeld.titel, 100)}`);

  // Details onder de kern. Opbouw en afbraak staan al bij "Wanneer", het aantal straten bij "Waar"
  // (de knop "Toon alle N straten"): niet nog eens herhalen. De uitleg bij die stratenlijst: bij een
  // parcours de straten langs het parcours; zonder parcours de straten rond de plekken, geen parcours.
  const regels = [];
  // Een dossier met meer plekken: hun namen, zoals de aanvrager ze in het dossier zette (alleen plaatsnamen,
  // na de privacyfilter van lib/plaatsnaam.mjs; zie docs/PUBLIC_SPACE_SOURCE_POLICY.md).
  const plekNamen = (Array.isArray(id?.plekNamen) ? id.plekNamen : []).map((n) => clean(n, 80)).filter((n) => n && !/[\d@]/.test(n));
  // Welke van die plekken in de gekozen straat ligt: een naam die de straat noemt ("Groenplaats" op de Groenplaats).
  const straatSl = straatSleutel(straat);
  const hier = straatSl ? plekNamen.filter((n) => ` ${straatSleutel(n)} `.includes(` ${straatSl} `)) : [];
  if (plekNamen.length >= 2) regels.push(["Plekken", `${plekNamen.length} plekken met een naam in het dossier: ${plekNamen.join(", ")}.${hier.length ? ` In deze straat: ${joinNl(hier.map((n) => `“${n}”`))}.` : ""}`]);
  const stratenNoot = f.straten.length > 3 ? (f.parcours ? "Straten langs het parcours, berekend uit de kaart van de stad. Ze zijn niet allemaal tegelijk dicht." : "Straten tot 18 m van de plekken in het dossier, berekend uit de kaart van de stad. Het is geen parcours: deze straten gaan niet dicht volgens het dossier.") : "";

  // Eén korte bronregel in gewone taal, zonder codes.
  const dossier = f.dossier ? ` (dossier ${f.dossier})` : "";
  const bronnen = uniek((id?.bron || []).map(hostVan).filter((h) => h && !/geodata\.antwerpen\.be/.test(h)));
  const nagekeken = `${bronnen.length ? ` op ${joinNl(bronnen)}` : ""}${id?.bijgewerkt ? ` (${datumTekst(id.bijgewerkt, { jaar: true })})` : ""}`;
  // Een automatische fiche (site/sources/evenement-identiteit-auto.json, met `methode`) zegt eerlijk
  // dat niemand ze met de hand nakeek, en waarop ze steunt.
  const herkomst = AUTO_HERKOMST[clean(id?.methode, 20)] || "";
  const toelating = geenEvenement ? "deze inname" : "dit evenement";
  const voetnoot = bekend?.zekerheid === "zeker" && herkomst
    ? `De stad gaf toelating voor ${toelating}${dossier}. De naam is automatisch gevonden in ${herkomst}${bronnen.length ? ` (${joinNl(bronnen)})` : ""}; niet met de hand nagekeken.`
    : bekend?.soortZeker && herkomst
      ? `De stad gaf toelating voor ${toelating}${dossier}, zonder naam. Wat het is, staat in het dossier zelf; automatisch gelezen, niet met de hand nagekeken.`
    : bekend && herkomst
      ? `De stad gaf toelating voor ${toelating}${dossier}, zonder naam. Het vermoeden is automatisch afgeleid uit ${clean(bekend.grond, 160) || herkomst}; niet met de hand nagekeken.`
    : bekend?.zekerheid === "zeker"
    ? `De stad gaf toelating voor ${toelating}${dossier}. Wat het is, hebben we nagekeken${nagekeken}.`
    : bekend
      ? `De stad gaf toelating voor ${toelating}${dossier}, zonder naam. Het vermoeden steunt op het dossier en op wat we nagekeken hebben${nagekeken}.`
    : koppeling
      ? `De stad gaf toelating voor ${toelating}${dossier}. De naam komt van het agendapunt op dezelfde dag in dezelfde straat.`
      : f.dossier ? `De stad gaf toelating voor ${fSoort ? toelating : "deze inname"}${dossier}. Bron: A-Sign, de databank van de stad.`
      : fSoort ? `De stad gaf toelating voor ${toelating}${dossier}, ${onbekendZin("voetnoot-soort")}.`
        : `De stad gaf toelating${dossier}, ${onbekendZin("voetnoot-leeg")}.`;

  // Wat ontbreekt. Komt alles uit het evenementendossier (geen fiche, geen koppeling): één regel die die bron noemt
  // en zegt wat ze niet geeft ("Niet in het evenementendossier ET... (A-Sign): wat er gebeurt en de naam ... · uren
  // (A-Sign geeft alleen de dag) · organisator"); de voetnoot herhaalt het niet.
  const alleenDossier = !bekend && !koppeling && Boolean(f.dossier);
  const eenDag = !dagen.eind || dagen.eind === dagen.start;
  const ontbreekt = [];
  if (alleenDossier) {
    ontbreekt.push(onbekendZin(fSoort ? "dossier-naam-ontbreekt" : "dossier-wat-ontbreekt"));
    if (!uren) ontbreekt.push(onbekendZin("dossier-uren-ontbreekt", { dagen: eenDag ? "de dag" : "de dagen" }));
    ontbreekt.push(onbekendZin("dossier-organisator-ontbreekt"));
  } else {
    if (!bekend && !koppeling) ontbreekt.push(onbekendZin(fSoort ? "evenement-naam-ontbreekt" : "evenement-wat-ontbreekt"));
    if (!uren) ontbreekt.push(onbekendZin("uren-ontbreekt"));
    if (!bekend?.organisator) ontbreekt.push(onbekendZin("organisator-ontbreekt"));
  }
  const ontbreektKop = alleenDossier ? onbekendZin("niet-in-dossier-kop", { dossier: f.dossier }) : "";

  // De eerste regel: wanneer (met de uren), hoe groot of hoe zeker, en jouw straat.
  const omvang = !bekend && !koppeling && !fSoort ? clean(id?.omvang, 160) : "";
  const samenvatting = [
    `${capital(wanneerKort)}${uren ? `, ${uren}` : ""}${plekInRegel ? `, ${plekInRegel}` : ""}${omvang ? ` · ${omvang}` : ""}.`,
    zeker,
    jouw,
  ].filter(Boolean).join(" ");
  return {
    titel, samenvatting, kern, regels, links, voetnoot, ontbreekt, ...(ontbreektKop ? { ontbreektKop } : {}), duur, plek: straten, technisch: "", stratenNoot,
    beschrijvingen: f.beschrijvingen || [], tijd: eersteUur(uren),
    zekerheid: bekend?.zekerheid || (koppeling ? "gekoppeld" : "onbekend"), dagen: { start: dagen.start, eind: dagen.eind },
    // Wat er vaststaat over het "wat" (watBron), de soort inname zonder omschrijving ("Inname", "Parkeerverbod",
    // "Parcours", "Verkeersvrije zone") en de soort van een vermoeden ("een studentenactiviteit"): voor de bundels.
    watBron, innameSoort: inname.titel, soortTekst: clean(bekend?.soort || fSoort || koppeling?.titel || "", 200),
    // Wat de kaart niet zelf zegt maar één keer per sectie (de uren): voor de sectie en de vaagheidsmeter.
    onbekend: uren ? [] : [onbekendVeld("evenement-uren")],
    // Voor de lijst (site/place-core.js): de losse dagen (een maandag per maand is geen periode van maanden),
    // een lange periode (geen "Vandaag" en een eigen groep) en of het geen evenement met publiek is.
    losseDagen: losse ? echt.alle : [], lang, geenEvenement,
  };
}
// Zo lang mag een titel met de plek erbij zijn (op een gsm van 390 px ongeveer drie regels; daarboven vier of vijf).
const TITEL_MAX = 100;
// De zin bij "Waar" van de herkenner (lib/parcours-herkenning.mjs, routeZin) zonder de dagen achteraan:
// "..., op maandag 9 november." of "..., van 1 tot 29 oktober." wordt "...".
const WEEKDAG_WOORD = "(?:maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)";
const DAGEN_ACHTERAAN = new RegExp(`,\\s(?:op ${WEEKDAG_WOORD}|op \\d+ losse dagen|van ${WEEKDAG_WOORD}|van \\d|elke ${WEEKDAG_WOORD}|één ${WEEKDAG_WOORD}|heel \\d{4}|de hele maand|${WEEKDAG_WOORD} \\d)[^]*$`);
export function waarZonderDagen(waar) {
  const t = clean(waar, 400);
  const zonder = t.replace(DAGEN_ACHTERAAN, "");
  return zonder && zonder !== t ? `${zonder.replace(/[.,;\s]+$/, "")}.` : t;
}
// Alle dagen van a tot b (hoogstens 800).
function alleDagen(a, b) {
  const uit = [];
  for (let d = a; d && d <= (b || a) && uit.length < 800; d = new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) uit.push(d);
  return uit;
}


// ---------- kaart ----------

// Lijnen inkorten voor een kleine kaartschets: hoogstens maxPunten per lijn, 5 decimalen.
export function vereenvoudigLijnen(lijnen = [], maxPunten = 40) {
  const out = [];
  for (const line of lijnen) {
    if (!Array.isArray(line) || line.length < 2) continue;
    const step = Math.max(1, Math.ceil(line.length / maxPunten));
    const kept = line.filter((_, i) => i % step === 0 || i === line.length - 1)
      .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
      .map((p) => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]);
    if (kept.length >= 2) out.push(kept);
  }
  return out;
}
// De schets van een heel parcours: alle lijnen, sterker vereenvoudigd in plaats van afgekapt, zodat
// "jouw straat ligt op het parcours" en de schets elkaar niet tegenspreken. Elke lijn krijgt punten
// naar haar lengte, binnen maxPunten samen. Alleen als er meer lijnen zijn dan het budget toelaat,
// vallen de kortste weg en zegt `deel` dat de schets maar een deel toont.
export const SCHETS_MAX_PUNTEN = 300;
const lijnLengte = (l) => l.reduce((m, p, i) => (i ? m + Math.hypot(p[0] - l[i - 1][0], p[1] - l[i - 1][1]) : 0), 0);
export function routeSchets(lijnen = [], { maxPunten = SCHETS_MAX_PUNTEN } = {}) {
  const gezien = new Set(), alle = [];
  for (const l of lijnen) {
    if (!Array.isArray(l) || l.length < 2 || !l.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))) continue;
    const k = JSON.stringify(l);
    if (!gezien.has(k)) { gezien.add(k); alle.push(l); }
  }
  const maxLijnen = Math.max(1, Math.floor(maxPunten / 2));
  const houd = alle.length > maxLijnen ? new Set([...alle].sort((a, b) => lijnLengte(b) - lijnLengte(a)).slice(0, maxLijnen)) : new Set(alle);
  const gekozen = alle.filter((l) => houd.has(l));
  const totaal = gekozen.reduce((n, l) => n + l.length, 0) || 1;
  const uit = gekozen.flatMap((l) => vereenvoudigLijnen([l], Math.max(2, Math.floor((l.length / totaal) * maxPunten))));
  return { lijnen: uit, deel: gekozen.length < alle.length };
}

const VERRUIM = 0.006; // ongeveer 400 tot 650 m rond het parcours
// Een eenvoudige SVG-schets: het parcours over de straatassen in de buurt, en de gekozen straat
// (segmenten [[x,y],[x,y]]) in een eigen kleur. Geen tegels, geen netwerk.
export function kaartSvg(lijnen = [], achtergrond = [], { breedte = 560, hoogte = 320, gekozen = [] } = {}) {
  const pts = lijnen.flat();
  if (!pts.length) return "";
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  // Jouw straat mee in beeld, als ze dicht bij het parcours ligt (een omleiding, een zijstraat).
  const dichtbij = gekozen.filter((seg) => seg.some(([x, y]) => x >= minX - VERRUIM && x <= maxX + VERRUIM && y >= minY - VERRUIM && y <= maxY + VERRUIM));
  for (const [x, y] of dichtbij.flat()) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const k = Math.cos(((minY + maxY) / 2) * Math.PI / 180);
  const padX = (maxX - minX) * 0.08 + 0.0008, padY = (maxY - minY) * 0.08 + 0.0005;
  minX -= padX; maxX += padX; minY -= padY; maxY += padY;
  const sx = (maxX - minX) * k, sy = maxY - minY, s = Math.min(breedte / sx, hoogte / sy);
  const w = Math.round(sx * s), h = Math.round(sy * s);
  const p = ([x, y]) => `${((x - minX) * k * s).toFixed(1)},${((maxY - y) * s).toFixed(1)}`;
  const binnen = (seg) => seg.some(([x, y]) => x >= minX && x <= maxX && y >= minY && y <= maxY);
  const bg = achtergrond.filter(binnen).slice(0, 4000).map((seg) => `<polyline points="${seg.map(p).join(" ")}"/>`).join("");
  const fg = lijnen.map((l) => `<polyline points="${l.map(p).join(" ")}"/>`).join("");
  const jouw = gekozen.filter(binnen).slice(0, 400).map((seg) => `<polyline points="${seg.map(p).join(" ")}"/>`).join("");
  const label = jouw ? "Schets van het parcours en jouw straat" : "Schets van het parcours";
  return `<svg class="ku-kaart" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${label}"><g class="ku-straten">${bg}</g><g class="ku-route">${fg}</g>${jouw ? `<g class="ku-jouw">${jouw}</g>` : ""}</svg>`;
}
