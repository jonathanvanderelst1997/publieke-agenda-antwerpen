// De privacyfilter voor vrije tekst uit A-Sign (innameBeschrijving: wat de aanvrager zelf intikt, en elk gelijkaardig
// veld). docs/PUBLIC_SPACE_SOURCE_POLICY.md. GRONDREGEL (vast): uit de tekst blijft ALLEEN over
//   (a) een VOLLEDIGE officiële straatnaam uit de straatas van de repo, exact op de genormaliseerde vorm (zonder
//       hoofdletters, accenten en leestekens): de hele naam, nooit een stuk ervan en nooit één los woord van een
//       straatnaam van meer woorden. De straatas komt binnen als `isStraat(naam)` (site/geo/straten.json en
//       site/geo/straten-stad.json), of als lijst die uit diezelfde straatas komt: `straten` (de straten van de inname,
//       door de straatas bij haar vorm gezocht) en `rond` (de straten van de straatas binnen 150 m van de plek).
//       Die namen zijn al zonder homoniemtoevoeging: de straatas wordt bij het inlezen genormaliseerd (zie hieronder);
//   (b) een naam uit de vaste lijst van de 9 districten van Antwerpen (DISTRICTEN).
// NIETS anders: geen woordenlijst (kerk, school, markt ...), geen woord met een hoofdletter, geen cijfer of huisnummer,
// geen telefoon-, mail-, web- of rekeningvorm, geen naam. Een straatnaam met een cijfer erin telt niet. De filter
// probeert geen namen te herkennen: wat geen volledige straatnaam of district is, valt weg. Bij twijfel: niets.
// Tussen twee plekken die blijven, staat een vast leesteken (" - ", ", ", " / ", " → ") als er alleen een leesteken
// tussen stond, anders " … ". De SOORT van een evenement komt nooit uit deze tekst (kenmerkTekst in site/kaart-uitleg.js
// leest de ruwe tekst en geeft alleen vaste woorden).
// Puur: geen netwerk, geen klok. Draait in de verversing (Node) én in de browser.

// ---------- normaliseren ----------

// Onzichtbare tekens (opmaaktekens, zachte koppeltekens, variatiekiezers, lege Hangul-tekens) vallen eerst weg; elk teken
// dat als apostrof getypt wordt, wordt een gewone '. NFKC: een volle-breedte letter wordt een gewone letter.
const ONZICHTBAAR = /[\p{Cf}͏ᅟᅠㅤ⠀︀-️\u{E0100}-\u{E01EF}]/gu;
const APOSTROF = /[`´‘’‛′ʼʻ]/g;
const voorbereid = (v, max = 400) => String(v ?? "").normalize("NFKC")
  .replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&")
  .replace(ONZICHTBAAR, "").replace(APOSTROF, "'")
  .replace(/\s+/g, " ").trim().slice(0, max);
const zonderAccent = (w) => String(w ?? "").normalize("NFD").replace(/\p{M}/gu, "");
// De sleutel van een naam, zoals die van de straatas (nameKey in site/street-core.js): zonder accenten en
// hoofdletters, alles wat geen letter of cijfer is wordt één spatie.
export const sleutel = (v) => zonderAccent(voorbereid(v, 200)).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// ---------- (b) de districten ----------

export const DISTRICTEN = Object.freeze([
  "Antwerpen", "Berchem", "Berendrecht-Zandvliet-Lillo", "Borgerhout", "Deurne", "Ekeren", "Hoboken", "Merksem", "Wilrijk",
]);
const DISTRICT = new Set(DISTRICTEN.map(sleutel));
export const isDistrict = (naam) => DISTRICT.has(sleutel(naam));

// ---------- de homoniemtoevoeging van de straatas ----------

// De straatas zet achter een straatnaam die ook in een ander district bestaat een toevoeging van twee hoofdletters
// ("Proefstraat_AN" in 2018, naast de Proefstraat in een ander district). Zo heet geen straat. Gemeten op 17 oktober 2026:
// - de straatas (laag 905, alle districten): 7 namen, telkens 1 stuk straat, alle van de vorm "_XX" (AN, BE, BO, DE, EK, HO,
//   WI); in district Antwerpen alleen "_AN" (1 naam). In Deurne bestaat dezelfde naam ook zonder toevoeging: het onderscheid
//   tussen twee straten is altijd hun id, nooit hun naam;
// - GIPOD (INNAME_PUNT, Description): 34 van de 3.128 werken in het kader van de stad, met ook "_ME"; de hinder (HINDER_PUNT)
//   en de evenementen: 0;
// - A-Sign: 2 van de 788.376 adressen van een parkeerverbod (laag 20), 0 omschrijvingen van een inname (laag 22 en 23).
// DE REGEL: de toevoeging gaat weg op één plek, bij de ingang van elke bron, nooit pas bij het tonen:
// - de straatas: straatasNaam in site/street-core.js (refsOf, de live straatindex in de browser, de verversing en
//   scripts/build-straten.mjs) en in lib/street-resolver.mjs, lib/parcours-herkenning-refresh.mjs en
//   scripts/build-straten-stad.mjs;
// - de tekst van GIPOD: gipodTekst in site/works-core.js; het adres van A-Sign: adresZonderHuisnummer in site/adres-privacy.js;
//   een straatnaam uit een stadslaag: zoekStraat in lib/straatnamen.mjs;
// - wat de verversing bewaart (kaart-uitleg.json, de straatbestanden, de historiek): bij het schrijven nog eens
//   (zonderToevoegingInData, itemVoorHistoriek), zodat ook een vorige stand die meegaat zonder toevoeging is.
// Een andere code dan de gemeten (de vorm "_XX" met twee hoofdletters na een letter) gaat ook weg.
export const HOMONIEM_CODES = Object.freeze(["AN", "BE", "BO", "DE", "EK", "HO", "WI"]);
const HOMONIEM_CODE = new Set(HOMONIEM_CODES.map((c) => c.toLowerCase()));
const TOEVOEGING = /(\p{L})_[A-Z]{2}(?![\p{L}\p{N}_])/gu;
// In een tekst (een omschrijving uit GIPOD, een adres uit A-Sign, een lijst straten): elke toevoeging "_XX" na een letter weg.
export const zonderToevoegingInTekst = (tekst) => String(tekst ?? "").replace(TOEVOEGING, "$1");
// Eén straatnaam: "Proefstraat_AN" wordt "Proefstraat".
export const zonderToevoeging = (naam) => zonderToevoegingInTekst(String(naam ?? "").replace(/\s+/g, " ").trim());
// Een bewaard document van de verversing (kaart-uitleg.json, een straatbestand): elke tekst zonder toevoeging, behalve een
// link (die gaat ongewijzigd naar de bron). De sleutels van een object blijven gelijk.
export function zonderToevoegingInData(waarde) {
  if (typeof waarde === "string") return /^https?:\/\//i.test(waarde) ? waarde : zonderToevoegingInTekst(waarde);
  if (Array.isArray(waarde)) return waarde.map(zonderToevoegingInData);
  if (waarde && typeof waarde === "object") return Object.fromEntries(Object.entries(waarde).map(([k, v]) => [k, zonderToevoegingInData(v)]));
  return waarde;
}
// Een tekst met nog een toevoeging (voor de scans van de historiek en de toetsen).
export const heeftToevoeging = (tekst) => typeof tekst === "string" && !/^https?:\/\//i.test(tekst) && new RegExp(TOEVOEGING.source, "u").test(tekst);
// Voor de filter (vrije tekst van een aanvrager) ook "Proefstraat-AN" en "Proefstraat'AN" met een gemeten code: de
// toevoeging wordt nooit een woord.
const TOEVOEGING_IN_FILTER = new RegExp(`(\\p{L})(?:_[A-Z]{2}|[-'](?:${HOMONIEM_CODES.join("|")}))(?![\\p{L}\\p{N}_])`, "gu");

// ---------- de filter ----------

// Een mail- of webadres valt helemaal weg, ook de woorden erin ("kerkstraat@voorbeeld.test"): het wordt een grens.
const ADRES = /\S*[@＠]\S*|\b(?:https?:\/\/|www\.)\S*|\S+\.(?:be|com|nl|org|net|eu|info|fr|de|io|test)\b\S*/giu;
// De langste straatnaam van de straatas telt zeven woorden; een district hoogstens drie.
const MAX_WOORDEN = 8;
// Tussen de woorden van één naam: één spatie, één koppelteken of één apostrof ("Sint-Jansplein", "Onze-Lieve-Vrouwestraat").
const BINNEN_NAAM = /^[ '-]$/;
// Twee woorden zonder witruimte ertussen ("Groot-Berchem", "Proefstraat_Testpersoon", "D'Proefstraat", "Proefstraat-12") vormen
// één geheel: daaruit blijft alleen iets als het hele geheel uit volledige namen bestaat ("Van Stralenstraat-Gemeentestraat"),
// nooit een stuk ervan ("Berchem" uit "Groot-Berchem").
const VAST_AAN = (voor) => voor !== "" && !/\s/.test(voor);
// Een woord dat in een naam kan staan: na het weghalen van de accenten alleen de letters a tot z (geen cijfer, geen
// letter uit een ander schrift, geen kleine kapitaal).
const isLetterwoord = (w) => /^[A-Za-z]+$/.test(zonderAccent(w));

// Hoe het leesteken tussen twee plekken die blijven, in de uitvoer staat: alleen deze vaste tekens.
function tussenteken(s) {
  if (/^\s*$/.test(s)) return " ";
  if (s === "-") return "-";
  if (/->|→|>/.test(s)) return " → ";
  if (/\//.test(s)) return " / ";
  if (/[,;()[\]{}]/.test(s)) return ", ";
  if (/[–—]|-/.test(s)) return " - ";
  return " … ";
}

// De woorden (letters en cijfers) met het stuk tekst ervoor.
function woordenVan(t) {
  const uit = [];
  let vorig = 0;
  for (const m of t.matchAll(/[\p{L}\p{M}\p{N}]+/gu)) {
    uit.push({ w: m[0], voor: t.slice(vorig, m.index), letters: isLetterwoord(m[0]) });
    vorig = m.index + m[0].length;
  }
  return uit;
}

// De sleutels van een lijst straten (uit de straatas, dus al zonder homoniemtoevoeging).
const namenSet = (lijst) => new Set((Array.isArray(lijst) ? lijst : []).map((s) => sleutel(typeof s === "string" ? s : s?.name)).filter(Boolean));

// De tekst door de filter. Geeft { tekst, plekken }: de tekst met alleen de volledige straatnamen en districten ("" als
// er niets overblijft) en die plekken zelf, in de volgorde van de tekst, elk één keer.
export function witteLijst(tekst, { straten = [], isStraat = null, rond = [] } = {}) {
  const leeg = { tekst: "", plekken: [] };
  const t = voorbereid(tekst).replace(ADRES, " # ").replace(TOEVOEGING_IN_FILTER, "$1").replace(/\s+/g, " ").trim();
  if (!t) return leeg;
  const w = woordenVan(t);
  const eigen = namenSet(straten);
  let rondSet = null;
  const inRond = (k) => (rondSet ??= namenSet(typeof rond === "function" ? rond() : rond)).has(k);
  const inStraatas = (naam) => typeof isStraat === "function" && Boolean(isStraat(naam));
  const isPlek = (naam) => {
    const k = sleutel(naam);
    if (!k || /\d/.test(k)) return false;
    // Een reeks van meer woorden die op een homoniemcode eindigt ("Proefstraat AN"), is nooit een plek: zo heet geen straat,
    // en de twee letters kunnen initialen zijn. De straat ervoor blijft wel ("Proefstraat").
    const woorden = k.split(" ");
    if (woorden.length > 1 && HOMONIEM_CODE.has(woorden.at(-1))) return false;
    return DISTRICT.has(k) || eigen.has(k) || inRond(k) || inStraatas(naam);
  };
  // De langste reeks woorden eerst, van links naar rechts. Een reeks telt alleen als geheel.
  let plekken = [];
  for (let i = 0; i < w.length;) {
    let lengte = 0;
    for (let n = Math.min(MAX_WOORDEN, w.length - i); n >= 1 && !lengte; n -= 1) {
      const reeks = w.slice(i, i + n);
      if (!reeks.every((x) => x.letters) || reeks.slice(1).some((x) => !BINNEN_NAAM.test(x.voor))) continue;
      if (isPlek(reeks.map((x) => x.w).join(" "))) lengte = n;
    }
    if (lengte) { plekken.push({ van: i, tot: i + lengte }); i += lengte; } else i += 1;
  }
  // Een geheel van woorden zonder witruimte ertussen moet helemaal uit plekken bestaan; anders valt elke plek die het raakt
  // weg (en dan opnieuw nakijken: zo'n plek kan ook een ander geheel raken).
  const geheel = new Array(w.length).fill(0);
  for (let k = 1; k < w.length; k += 1) geheel[k] = VAST_AAN(w[k].voor) ? geheel[k - 1] : k;
  for (let veranderd = true; veranderd;) {
    veranderd = false;
    const gedekt = new Array(w.length).fill(false);
    for (const p of plekken) for (let k = p.van; k < p.tot; k += 1) gedekt[k] = true;
    const fout = new Set(geheel.filter((g, k) => !gedekt[k]));
    const over = plekken.filter((p) => !w.slice(p.van, p.tot).some((_, n) => fout.has(geheel[p.van + n])));
    if (over.length !== plekken.length) { plekken = over; veranderd = true; }
  }
  // De uitvoer: elke plek één keer, met het vaste leesteken ertussen (of " … " als er iets wegviel). Hoogstens 140 tekens.
  let uit = "";
  const namen = [], gezien = new Set();
  let vorigeTot = -1;
  for (const p of plekken) {
    // Zoals de tekst de naam schrijft; een los accent dat geen letter vormt (NFC), valt weg.
    const naam = w.slice(p.van, p.tot).map((x, n) => `${n ? (x.voor === "-" ? "-" : x.voor === "'" ? "'" : " ") : ""}${x.w}`).join("").normalize("NFC").replace(/\p{M}/gu, "");
    const k = sleutel(naam);
    if (gezien.has(k)) continue;
    const tussen = !uit ? "" : vorigeTot === p.van ? tussenteken(w[p.van].voor) : " … ";
    if (uit.length + tussen.length + naam.length > 140) break;
    uit += `${tussen}${naam}`;
    namen.push(naam);
    gezien.add(k);
    vorigeTot = p.tot;
  }
  return { tekst: uit, plekken: namen };
}

// De tekst zoals de site hem mag tonen: alleen volledige straatnamen en districten. "" als er geen overblijft.
export function witteTekst(tekst, opties = {}) {
  return witteLijst(tekst, opties).tekst;
}

// ---------- de naam van een fase (faseNaam, A-Sign laag 22 en 23) ----------

// faseNaam is in A-Sign een vrij in te vullen veld (String(50)). Gemeten op 17 oktober 2026: 73.420 rijen met 17
// verschillende waarden in 6 vaste vormen, geen enkele leeg: "Evenement", "Opbouw", "Afbraak", "Opname periode 3",
// "Opname periode 1-2" en "Opname periode 1----2". Op de site komt alleen zo'n vaste vorm; elke andere naam gaat door de
// grondregel (witteTekst: alleen een volledige straatnaam of een district), anders valt hij weg. Een nieuwe vaste
// waarde in A-Sign komt hier in de lijst, niet door de filter heen.
export const FASEWOORDEN = Object.freeze(["Evenement", "Opbouw", "Afbraak"]);
const FASEWOORD = new Map(FASEWOORDEN.map((w) => [w.toLowerCase(), w]));
// "Opname periode 3", "Opname periode 1-2", "Opname periode 1----2": vaste woorden met een volgnummer van hoogstens twee
// cijfers (en hoogstens vier streepjes ertussen). Die blijven zoals ze er staan (de sleutels en ids van de straatbestanden hangen eraan).
const OPNAME_PERIODE = /^opname periode \d{1,2}(?: ?-{1,4} ?\d{1,2})?$/i;
// "Fase 2": het vaste woord met een volgnummer (staat nu niet in A-Sign, wel de vorm die de site al toonde).
const FASE_NUMMER = /^fase \d{1,2}$/i;
// De langste naam van een fase die de site bewaart (fasen[].naam in lib/source-feed.mjs).
export const FASE_MAX = 40;
// De naam van een fase zoals de site hem mag tonen en vergelijken: een vaste vorm (met de hoofdletters van de lijst), het
// vaste woord "Opname" voor elke andere naam die met "Opname" begint (een film- of foto-opname: isOpnameFase in
// site/evenement-wat.js, zodat de soort dezelfde blijft), een volledige straatnaam of district, of "". Een voorvoegsel
// "Fase " (zo staat een fase in `detail`) blijft voor een vaste vorm staan. Hoogstens FASE_MAX tekens. Puur.
export function veiligeFase(naam, { straten = [], isStraat = null, rond = [] } = {}) {
  const t = voorbereid(naam, 120);
  if (!t) return "";
  if (FASE_NUMMER.test(t)) return `Fase ${t.slice(5)}`;
  const [, voor = "", rest = ""] = /^(fase )?(.*)$/i.exec(t);
  const fase = voor ? "Fase " : "";
  if (OPNAME_PERIODE.test(rest)) return `${fase}${rest}`;
  if (FASEWOORD.has(rest.toLowerCase())) return `${fase}${FASEWOORD.get(rest.toLowerCase())}`;
  if (/^opname\b/i.test(rest)) return `${fase}Opname`;
  const { tekst, plekken } = witteLijst(t, { straten, isStraat, rond });
  if (tekst.length <= FASE_MAX) return tekst;
  // Te lang: zoveel hele plekken als passen.
  let uit = "";
  for (const p of plekken) { const n = uit ? `${uit}, ${p}` : p; if (n.length > FASE_MAX) break; uit = n; }
  return uit;
}
// Of een bewaarde naam van een fase al door veiligeFase ging (voor de controle van een bronbestand). straten: de
// straten van het item, die de straatas al kende.
export const isVeiligeFase = (naam, { straten = [] } = {}) => typeof naam === "string" && Boolean(naam)
  && (veiligeFase(naam) === naam || (Array.isArray(straten) && straten.includes(naam) && veiligeFase(naam, { straten: [naam] }) === naam));
