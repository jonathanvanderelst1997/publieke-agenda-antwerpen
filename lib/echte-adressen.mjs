// Een echte straat met een bestaand huisnummer hoort nergens in de publieke repo: niet in een toets, niet in een diff
// en niet in een commitboodschap. Live toont een parkeerverbod exact waar en wanneer (besluit van de eigenaar van
// 18 oktober 2026), maar de repo houdt geen privéadres bij, en zeker geen adres naast een (verzonnen) reden. Een echte
// straat (site/geo/straten.json) krijgt in een toets alleen huisnummer 999, dat daar niet bestaat.
//
// Drie vormen tellen:
// - het nummer staat achter de straat ("Xstraat 12-14", "Xstraat, 12", "Xstraat thv 12"), zoals huisnummerStukken
//   (lib/historiek-privacy.mjs) het ziet, ook met wat A-Sign en GIPOD ertussen schrijven ("Xstraat hoek-64",
//   "Xlaan (2610) 34-hoek", "XSTRAAT_AN 12") en met aanhalingstekens rond het nummer of rond de straat ("Xstraat '12'",
//   '["Xstraat", "12-14"]', 'adres("Xstraat", 12)'); een datum of een uur na de straat ("Xstraat | 5 jan") is geen
//   nummer;
// - in lopende tekst of op één regel code staat het los van de straat, in dezelfde zin: tussen haakjes ("de Xstraat en
//   de Ystraat met een bestaand huisnummer (12-14, 16-18)") of na "huisnummer", "nummer", "nr", "bereik" of een veldnaam
//   voor een huisnummer ("de Xstraat, huisnummers 12 en 14", "{ straat: 'Xstraat', huisnummer: '12' }",
//   '{ Thoroughfarename: "Xstraat", Housenumber: "12" }', '{ STRAATNM: "XSTRAAT_AN", HUISNR: "14" }'). Die vorm zag de
//   eerste scan niet (nakijkronde 18 oktober 2026): ze stond in een commitboodschap;
// - in losse velden van één object over meer regels, zoals een fixture of een JSON-bestand het schrijft (echteAdresRegels;
//   de commitscan en de toets "een echte straatnaam krijgt alleen huisnummer 999" lezen zo een hunk of een bestand).
//
// Bekende grenzen: de scan is een hulpmiddel bovenop de reviews, geen bewijs dat een tekst schoon is. Deze vormen vangt
// hij bewust niet (een vangst zou op main en in de verversingen vooral vals alarm geven), of nog niet:
// - een straat die niet in site/geo/straten.json staat: een tikfout, een afkorting ("Xstr. 12"), een naam van meer dan
//   zes woorden of een straat buiten de stad;
// - een nummer in woorden ("nummer twaalf"), van vier cijfers vanaf 1900 (dat lijkt een jaartal of een postcode), direct
//   na de straat als kommagetal ("25.01") of als deel van een datum met het jaar vooraan ("2026-10-12"), of samengesteld
//   in code ("Xstr" + "aat 12", `${straat} ${nr}`, een variabele), of gecodeerd (URL: "Xstraat%2012", "Xstraat+12";
//   een unicode-escape van de cijfers);
// - een getal zonder aanhalingstekens na de straat als string, dat niet het laatste argument of element is
//   ('["Xstraat", 12, "x"]': in een rij van een toets meestal een telling of een maat), en een straat als sleutel met
//   een getal als waarde ('{ "Xstraat": 12 }');
// - een rij met een puntkomma of een ander scheidingsteken dan een spatie, een komma, "(", " - ", " | " of ": "
//   ("Xstraat;12;2000", een CSV-bestand), en twee opdrachten op één regel ("straat = 'Xstraat'; nr = '12'": de
//   puntkomma sluit de zin);
// - straat en nummer in verschillende zinnen, alinea's of objecten, op regels zonder veldnaam vooraan ("Xstraat" en op
//   de volgende regel "12"), of verder dan 12 regels uit elkaar in één object;
// - in de commitscan alleen de toegevoegde regels (`--unified=0`): staat de straat in een regel die er al was en het
//   nummer in een nieuwe regel van hetzelfde object, dan ziet de scan het verband niet; een regel die al op de basis
//   stond, telt nooit;
// - de gegenereerde data met --zonder-data (de padlijst van de databaan): die heeft haar eigen privacyregels
//   (lib/historiek-privacy.mjs, itemVoorStraat).
//
// De bevindingen noemen alleen een plaats (commit, bestand, regel) en een aantal, nooit de gevonden waarde: wat het
// script toont, kan in een publieke log belanden.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { cijferstraatStukken, huisnummerStukken } from "./historiek-privacy.mjs";

// Woorden zoals een straatnaam ze heeft: letters, cijfers, apostrof en koppelteken ("D'Herbouvillekaai",
// "Sint-Jansplein"). De tekst en de namen worden op dezelfde manier in woorden gesplitst. Een apostrof telt alleen
// tussen twee letters of cijfers: aan het begin of het einde van een woord is het een aanhalingsteken ("'Xstraat 3'",
// "‘Xstraat 3’"; nakijkronde van 18 oktober 2026: zo'n straat viel weg). Een los koppelteken blijft een woord
// ("Maria Van Genechten - Hauquierstraat").
const WOORD = /[\p{L}\p{N}](?:[\p{L}\p{N}-]|['’](?=[\p{L}\p{N}]))*|-+/gu;
const woordenMetPlek = (tekst) => Array.from(String(tekst).matchAll(WOORD), (m) => ({ woord: m[0].toLowerCase().replace(/’/g, "'"), begin: m.index, einde: m.index + m[0].length }));
const sleutel = (naam) => woordenMetPlek(naam).map((w) => w.woord).join(" ");

// De officiële straatnamen als verzameling sleutels (een toets kan er zelf één meegeven, met verzonnen namen).
export function straatnamenUit(namen) {
  const set = new Set();
  for (const naam of namen) {
    const s = sleutel(naam);
    if (s) set.add(s);
  }
  return set;
}
export function laadStraatnamen(bestand) {
  const rijen = JSON.parse(fs.readFileSync(bestand, "utf8")).streets || [];
  return straatnamenUit(rijen.map((rij) => String(Array.isArray(rij) ? rij[1] : rij?.name ?? "")));
}

const MAX_WOORDEN = 6;
// [begin, einde) van elke echte straatnaam in de tekst, de langste eerst bij overlap.
function straatPlekken(tekst, namen) {
  const woorden = woordenMetPlek(tekst);
  const plekken = [];
  for (let i = 0; i < woorden.length; i += 1) {
    for (let k = Math.min(MAX_WOORDEN, woorden.length - i); k >= 1; k -= 1) {
      const deel = woorden.slice(i, i + k);
      if (namen.has(deel.map((w) => w.woord).join(" "))) {
        plekken.push([deel[0].begin, deel.at(-1).einde]);
        break;
      }
    }
  }
  return plekken;
}

// Een huisnummer los van de straat, in lopende tekst: na "huisnummer", "nummer", "nr" of "bereik" (met of zonder
// haakjes), of tussen haakjes als reeks ("(12-14)", "(12, 14)"). Eén los getal tussen haakjes is meestal een aantal
// ("de drie straten (14)") en telt alleen na zo'n woord. Een maat ("(10m)") is geen huisnummer, en een getal van vier
// cijfers ook niet: een jaartal, of het nummer van een koppelput in een GIPOD-titel ("Koppelput (1217 - 1218)").
const NUMMER = String.raw`(?<!\d)\d{1,3}(?:bis|[a-ln-z])?(?![\p{L}\d])`;
const TOT = String.raw`\s*(?:-|–|\/|tot en met|t\.?e\.?m\.?|tem|tm|tot)\s*`;
const EN = String.raw`\s*(?:,|en|&)\s*`;
const BEREIK = String.raw`${NUMMER}(?:${TOT}${NUMMER})?`;
const LIJST = String.raw`${BEREIK}(?:${EN}${BEREIK})*`;
const REEKS = String.raw`${NUMMER}(?:${TOT}|${EN})${LIJST}`;
// Aanhalingstekens rond een string in code of tekst: enkel, dubbel, gekruld of een backtick (nakijkronde van 18 oktober
// 2026, na de eindboom: een nummer tussen aanhalingstekens zag de scan niet).
const OPEN = String.raw`["'‘“\x60]`;
const DICHT = String.raw`["'’”\x60]`;
// De woorden en de veldnamen voor een huisnummer, zoals de repo ze schrijft: "huisnummer", "nummer", "nr", de geocoder
// "Housenumber" (lib/geocode.mjs) en CRAB "HUISNR" (lib/kaart-uitleg-refresh.mjs), met of zonder homoniemtoevoeging
// ("HUISNR_AN"). Een veldnaam mag tussen aanhalingstekens staan, met ":" of "=" en een aanhalingsteken vóór het nummer
// ('"huisnummer": "12"', "huisnummer=12"); elk nummer van de lijst mag tussen aanhalingstekens staan ("‘12’ en ‘14’").
const NUMMERWOORD = String.raw`(?:huisnummers?|huisnrs?|hnr|house_?numbers?|nummers?|nrs?\.?|n°)(?:_[a-z]{2})?`;
const NA_WOORD = String.raw`\s*${DICHT}?\s*[:=]?\s*`;
const Q_BEREIK = String.raw`${OPEN}?${BEREIK}${DICHT}?`;
const Q_LIJST = String.raw`${Q_BEREIK}(?:${EN}${Q_BEREIK})*`;
const LOS_NUMMER = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${NUMMERWOORD}|bereik)${NA_WOORD}(?:\(\s*(?<woordHaakjes>${Q_LIJST})\s*\)|(?<woord>${Q_LIJST}))|\(\s*(?<reeks>${REEKS})\s*\)`, "giu");
// Een zin: tot een punt, uitroepteken of vraagteken met daarna een spatie en een hoofdletter of een aanhalingsteken,
// tot een puntkomma of tot een lege regel. "bv. een" of "str. 12" sluit dus geen zin af.
const ZINSGRENS = /[.!?](?=\s+["'“(]?[\p{Lu}])|;|\n\s*\n/gu;

const bestaandNummer = (stuk) => (stuk.match(/\d+/g) || []).some((n) => n !== "999" && !(n.length === 4 && Number(n) >= 1900));

// Wat A-Sign en GIPOD tussen de straat en het nummer schrijven (nakijkronde van 18 oktober 2026: de scan zag die vormen
// niet): de homoniemtoevoeging van de straatas direct na de naam ("PROEFSTRAAT_AN 12", site/witte-lijst.js), de postcode
// tussen haakjes ("Xlaan (2610) 34-hoek") en de hoek vóór het nummer ("Ystraat hoek-64", op de site "hoek–64",
// publiekParkeerAdres in site/adres-privacy.js). Die vulling wordt spaties, zodat de plaatsen gelijk blijven en
// huisnummerStukken het nummer erachter ziet. De postcode en de hoek alleen met een nummer (of de hoek) erna: "de
// Xstraat (2026)" blijft een jaartal.
// Ook de aanhalingstekens rond de straat en rond het nummer (nakijkronde van 18 oktober 2026, na de eindboom): het
// aanhalingsteken dat de straat sluit, met erna het nummer als losse string ('["Xstraat", "12-14"]') of als laatste
// argument zonder aanhalingstekens ('adres("Xstraat", 12)'), en het aanhalingsteken dat het nummer opent ("Xstraat
// '12'", "Xstraat, '12-14'", 'Xstraat: "12"'). Een getal zonder aanhalingstekens dat niet het laatste is, telt niet:
// in een rij van een toets is dat een telling of een maat ('["Xstraat", 2, "removed"]', '["Xplein", 25.01, 4.41]').
// Een straat als sleutel met een getal als waarde ('"Xstraat": 12') telt ook niet: meestal een telling.
const TOEVOEGING_NA_STRAAT = /^_[A-Za-z]{2}(?![\p{L}\p{N}_])/u;
const VULLING = new RegExp(String.raw`^(?:\s*\(\s*\d{4}\s*\)(?=\s*(?:hoek|\d))|[\s,]*hoek\s*[-–—]?(?=\s*\d)|${DICHT}(?=\s*,?\s*(?:${OPEN}\d|\d{1,3}[a-z]?\s*[)\]}]))|[\s,:]*${OPEN}(?=\d))`, "iu");
function zonderVulling(deel, vanaf) {
  const leeg = (tekst, i, n) => tekst.slice(0, i) + " ".repeat(n) + tekst.slice(i + n);
  let uit = deel;
  let i = vanaf;
  const toevoeging = TOEVOEGING_NA_STRAAT.exec(uit.slice(i));
  if (toevoeging) {
    uit = leeg(uit, i, toevoeging[0].length);
    i += toevoeging[0].length;
  }
  for (let m = VULLING.exec(uit.slice(i)); m; m = VULLING.exec(uit.slice(i))) {
    uit = leeg(uit, i, m[0].length);
    i += m[0].length;
  }
  return uit;
}

// Een datum of een uur direct na de straat is geen huisnummer (nakijkronde van 18 oktober 2026: "Xstraat | 5 jan" en
// "Xstraat, 18 okt" in een gegenereerde tabel hielden een PR tegen). Volgt er een maand, dan is het laatste getal (of
// "14–29") van het stuk de dag; volgt er "-2026" of ".10.2026", dan is "18-10" of "18" de dag en de maand; volgt er
// ":00" of "uur", dan is het laatste getal het uur. Wat ervoor in het stuk staat, telt gewoon ("Xstraat 12, 18 okt").
const MAAND = String.raw`(?:jan(?:uari)?|feb(?:ruari)?|maart|mrt|apr(?:il)?|mei|juni?|juli?|aug(?:ustus)?|sept?(?:ember)?|o[ck]t(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?`;
const NA_DAG = new RegExp(String.raw`^\s*,?\s*${MAAND}(?![\p{L}\d])`, "iu");
const DAG_OP_EINDE = /(?:^|[^\p{L}\d]+|\s+(?:en|tot)\s+)\d{1,2}(?:\s*[-–—]\s*\d{1,2})?$/u;
const NA_DAG_EN_MAAND = /^[-/.](?:\d{1,2}[-/.])?(?:19|20)\d\d(?!\d)/;
const DAG_EN_MAAND_OP_EINDE = /\d{1,2}(?:[-/.]\d{1,2})?$/;
const NA_UUR = /^(?::\d\d(?!\d)|\s*(?:uur|u)(?![\p{L}\d]))/iu;
const UUR_OP_EINDE = /\d{1,2}$/;
// Een datum met het jaar vooraan ("2026-10-12", "2026-10-09T08:00", zoals een rij van een toets ze naast een straat
// zet) en een kommagetal ("25.01", een oppervlakte of een coördinaat) zijn geen huisnummer.
const JAAR_VOORAAN = /^[\s,(|:–—-]*(?:19|20)\d\d[-/.]\d{1,2}(?!\d)/u;
const KOMMAGETAL_ERNA = /^[.,]\d/;
function zonderDatum(stuk, na) {
  if (NA_DAG.test(na)) return stuk.replace(DAG_OP_EINDE, "");
  if (NA_DAG_EN_MAAND.test(na)) return stuk.replace(DAG_EN_MAAND_OP_EINDE, "");
  if (NA_UUR.test(na)) return stuk.replace(UUR_OP_EINDE, "");
  return stuk;
}

// Vorm 3 (echteAdresRegels): een straat en een huisnummer in losse velden van één object over meer regels (nakijkronde
// van 18 oktober 2026, na de eindboom), zoals een fixture of een JSON-bestand het schrijft, met de veldnamen die de repo
// gebruikt: { straat, huisnummer, reden }, Thoroughfarename en Housenumber (de geocoder), STRAATNM en HUISNR (CRAB, ook
// "PROEFSTRAAT_AN"). Op één regel ziet vorm 2 dat al. Over de regels heen telt alleen een veldregel: de veldnaam vooraan
// op de regel (na witruimte, "{", "[", "," of "- "), met ":" of "=". De regel met het nummer heeft een veldnaam voor een
// huisnummer (NUMMERWOORD); de straat staat in de waarde van een andere veldregel van hetzelfde object: binnen dezelfde
// "{" of "[" (niet in een object erin of ernaast), hoogstens OBJECT_REGELS regels ervan en zonder lege regel ertussen.
// Zonder accolade eromheen (YAML, een stuk van een diff) is dat de alinea. Een commentaar of een zin met "nummer: 12"
// is geen veldregel, en een veld zonder veldnaam voor een huisnummer ("aantal: 12", "dagen: '12-14'") telt niet.
const OBJECT_REGELS = 12;
const VELD_BEGIN = String.raw`^[\t ]*(?:[-{[,][\t ]*)*`;
const VELDREGEL_NUMMER = new RegExp(String.raw`${VELD_BEGIN}${OPEN}?${NUMMERWOORD}${DICHT}?[\t ]*[:=][\t ]*(?<waarde>${Q_LIJST})`, "iu");
const VELDREGEL = new RegExp(String.raw`${VELD_BEGIN}${OPEN}?[\p{L}_][\p{L}\p{N}_]*${DICHT}?[\t ]*[:=]`, "u");
// [begin, einde) van elk nummerveld in `waarde` (regels met hun begin in `begins`) met een echte straat (namen) in een
// ander veld van hetzelfde object.
function veldStukken(waarde, regels, begins, namen) {
  const velden = [];
  regels.forEach((tekst, r) => {
    const m = VELDREGEL_NUMMER.exec(tekst);
    if (m && bestaandNummer(m.groups.waarde)) velden.push({ r, begin: begins[r] + m[0].length - m.groups.waarde.length, einde: begins[r] + m[0].length, sleutel: begins[r] + m[0].search(/[^\t \-{[,]/) });
  });
  if (!velden.length) return [];
  // De straten in de waarde van een veldregel, met hun regel.
  const straten = [];
  for (const [a] of straatPlekken(waarde, namen)) {
    let r = begins.length - 1;
    while (begins[r] > a) r -= 1;
    const veld = VELDREGEL.exec(regels[r]);
    if (veld && a >= begins[r] + veld[0].length) straten.push({ r, a });
  }
  if (!straten.length) return [];
  // Per teken het object eromheen: de plaats van zijn "{" of "["; buiten elk object een negatief getal, dat verandert na
  // een "}" zonder begin, zoals in een stuk van een diff.
  const eigenaar = new Int32Array(waarde.length);
  const stapel = [];
  let buiten = -1;
  for (let i = 0; i < waarde.length; i += 1) {
    const c = waarde[i];
    if (c === "}" || c === "]") {
      if (stapel.length) stapel.pop();
      else buiten -= 1;
    }
    eigenaar[i] = stapel.length ? stapel.at(-1) : buiten;
    if (c === "{" || c === "[") stapel.push(i);
  }
  const leeg = regels.map((tekst) => !tekst.trim());
  const samen = (straat, veld) => {
    if (straat.r === veld.r || Math.abs(straat.r - veld.r) > OBJECT_REGELS || eigenaar[straat.a] !== eigenaar[veld.sleutel]) return false;
    for (let k = Math.min(straat.r, veld.r) + 1; k < Math.max(straat.r, veld.r); k += 1) if (leeg[k]) return false;
    return true;
  };
  return velden.filter((veld) => straten.some((straat) => samen(straat, veld))).map((veld) => [veld.begin, veld.einde]);
}

// [begin, einde) van elk stuk met een echte straat en een ander huisnummer dan 999.
export function echteAdresStukken(tekst, namen) {
  const waarde = String(tekst ?? "");
  if (!/\d/.test(waarde) || !namen?.size) return [];
  const plekken = straatPlekken(waarde, namen);
  if (!plekken.length) return [];
  const stukken = [];
  // Vorm 1: het nummer direct achter de straat. Per straat een stuk tekst dat met de straatnaam begint: in een regel code
  // staat er vaak een aanhalingsteken of een haakje voor, en dan herkent huisnummerStukken een straat zonder straatuitgang
  // (zoals de Meir) niet. Het stuk eindigt na een heel woord. Tussen de straat en het nummer staat de scheiding die
  // huisnummerStukken zelf in het stuk opneemt: een spatie, een komma, "(", " - ", " | " of ": " (GIPOD schrijft
  // "Xstraat - 135 - werken aan ..."; een tabel "| Xstraat | 12 |"). Daarbuiten mag er alleen de vulling van A-Sign en
  // GIPOD staan (zonderVulling). Wat een datum of een uur is, telt niet (zonderDatum).
  for (const [a, b] of plekken) {
    let tot = Math.min(waarde.length, b + 400);
    while (tot < waarde.length && /[\p{L}\d]/u.test(waarde[tot])) tot += 1;
    const deel = zonderVulling(waarde.slice(a, tot), b - a);
    for (const [begin, einde] of huisnummerStukken(deel)) {
      if (begin < b - a || !/^[\s,(]*$/.test(deel.slice(b - a, begin))) continue;
      if (JAAR_VOORAAN.test(deel.slice(begin)) || KOMMAGETAL_ERNA.test(deel.slice(einde))) continue;
      if (!bestaandNummer(zonderDatum(deel.slice(begin, einde), deel.slice(einde)))) continue;
      if (!stukken.some(([x]) => x === a + begin)) stukken.push([a + begin, a + einde]);
    }
  }
  // Vorm 2: in dezelfde zin als de straat, maar los ervan. Een cijfer in een officiële straatnaam ("Buurtweg nr 11")
  // telt niet.
  const beschermd = [...cijferstraatStukken(waarde), ...plekken];
  const grenzen = [0, ...Array.from(waarde.matchAll(ZINSGRENS), (m) => m.index + 1), waarde.length];
  for (const m of waarde.matchAll(LOS_NUMMER)) {
    const begin = m.index;
    const einde = begin + m[0].length;
    if (stukken.some(([a, b]) => begin < b && einde > a)) continue;
    if (beschermd.some(([a, b]) => begin < b && einde > a)) continue;
    if (!bestaandNummer(m.groups.woordHaakjes ?? m.groups.woord ?? m.groups.reeks)) continue;
    const zinBegin = Math.max(...grenzen.filter((g) => g <= begin));
    const zinEinde = Math.min(...grenzen.filter((g) => g >= einde));
    if (plekken.some(([a, b]) => a >= zinBegin && b <= zinEinde)) stukken.push([begin, einde]);
  }
  return stukken.sort((a, b) => a[0] - b[0]);
}

// Per regel van een tekst met meer regels (een bestand, of de toegevoegde regels van een diff na elkaar): het aantal
// stukken met een echt adres, [{ regel (vanaf 1), aantal }], alleen de regels met een stuk. Elke regel apart zoals
// echteAdresStukken hem ziet (vorm 1 en 2, dus nooit over een regel heen), en daarbij vorm 3 over de regels heen: losse
// velden van een object over meer regels (veldStukken). Dat stuk telt op de regel van het nummer.
export function echteAdresRegels(tekst, namen) {
  const waarde = String(tekst ?? "");
  if (!/\d/.test(waarde) || !namen?.size) return [];
  const regels = waarde.split("\n");
  const begins = [];
  const stukken = [];
  let begin = 0;
  for (const regel of regels) {
    begins.push(begin);
    for (const [a, b] of echteAdresStukken(regel, namen)) stukken.push([begin + a, begin + b]);
    begin += regel.length + 1;
  }
  if (regels.length > 1) {
    for (const [a, b] of veldStukken(waarde, regels, begins, namen)) {
      if (!stukken.some(([x, y]) => a < y && b > x)) stukken.push([a, b]);
    }
  }
  const perRegel = new Map();
  for (const [a] of stukken) {
    let k = begins.length - 1;
    while (begins[k] > a) k -= 1;
    perRegel.set(k + 1, (perRegel.get(k + 1) || 0) + 1);
  }
  return [...perRegel].sort((x, y) => x[0] - y[0]).map(([regel, aantal]) => ({ regel, aantal }));
}

// Een commitboodschap is afgebroken op een vaste breedte: een straat en haar nummer kunnen op twee regels staan.
const alsLopendeTekst = (tekst) => String(tekst).replace(/\r/g, "").replace(/([^\n])\n(?=[^\n])/g, "$1 ");

const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });

// De gegenereerde data uit publieke bronnen: de padlijst van de databaan (lib/data-lane-paths.json, `allowed`), elk
// patroon over het hele pad, zoals de databaantoets in ci.yml ze leest. Die bestanden (kaart-uitleg.json, de feed, de
// straatbestanden, de historiek) schrijft de verversing; ze hebben hun eigen privacyregels (lib/historiek-privacy.mjs,
// itemVoorStraat), en een publieke zaal of winkel met haar adres hoort er gewoon in. De scan met --zonder-data kijkt
// dus naar wat een mens schrijft: code, toetsen, documentatie en de commitboodschap.
export function laadDataPaden(bestand) {
  const lijst = JSON.parse(fs.readFileSync(bestand, "utf8")).allowed;
  if (!Array.isArray(lijst) || !lijst.length || !lijst.every((p) => typeof p === "string" && p)) throw new Error(`geen padlijst in ${path.basename(bestand)}`);
  return lijst.map((p) => new RegExp(`^(?:${p})$`));
}

// De toegevoegde regels van een diff (`--unified=0`), per bestand de regels (in de nieuwe versie) en het aantal stukken.
// De toegevoegde regels na elkaar (een hunk) gaan samen door echteAdresRegels: zo telt ook een object over meer regels.
// `overslaan`: paden (RegExp) die niet tellen.
function adressenInDiff(diff, namen, overslaan) {
  let bestand = null;
  let regel = 0;
  let blok = null;
  const perBestand = new Map();
  const sluit = () => {
    if (!blok) return;
    for (const { regel: k, aantal } of echteAdresRegels(blok.regels.join("\n"), namen)) {
      const rij = perBestand.get(blok.bestand) || { waar: blok.bestand, regels: [], aantal: 0 };
      rij.regels.push(blok.begin + k - 1);
      rij.aantal += aantal;
      perBestand.set(blok.bestand, rij);
    }
    blok = null;
  };
  for (const lijn of diff.split("\n")) {
    if (lijn.startsWith("+++ ")) {
      sluit();
      bestand = lijn === "+++ /dev/null" ? null : lijn.replace(/^\+\+\+ (?:b\/)?/, "");
      continue;
    }
    const kop = lijn.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (kop) {
      sluit();
      regel = Number(kop[1]);
      continue;
    }
    if (!bestand || !lijn.startsWith("+")) {
      sluit();
      continue;
    }
    if (!overslaan.some((re) => re.test(bestand))) {
      blok ||= { bestand, begin: regel, regels: [] };
      blok.regels.push(lijn.slice(1));
    }
    regel += 1;
  }
  sluit();
  return [...perBestand.values()];
}

// Elke commit in basis..tot: de boodschap en de toegevoegde regels van de diff (zonder samenvoegcommits, die alleen
// brengen wat al elders staat). Per plaats een aantal, nooit de waarde. `overslaan`: paden (RegExp) die niet tellen.
export function adressenInCommits({ basis, tot = "HEAD", cwd = process.cwd(), namen, overslaan = [] }) {
  const commits = git(["rev-list", "--reverse", `${basis}..${tot}`], cwd).split("\n").filter(Boolean);
  const bevindingen = [];
  for (const commit of commits) {
    const kort = commit.slice(0, 8);
    const boodschap = echteAdresStukken(alsLopendeTekst(git(["log", "-1", "--format=%B", commit], cwd)), namen).length;
    if (boodschap) bevindingen.push({ commit: kort, sha: commit, waar: "boodschap", aantal: boodschap });
    const diff = git(["diff-tree", "-p", "-r", "--no-commit-id", "--no-color", "--no-ext-diff", "--unified=0", commit], cwd);
    bevindingen.push(...adressenInDiff(diff, namen, overslaan).map((rij) => ({ commit: kort, sha: commit, ...rij })));
  }
  return { commits: commits.length, bevindingen };
}

// De eindboom: de netto diff basis...tot (van de samenvoegbasis tot de kop), zoals de PR landt. Een uitzondering geldt per
// commit en per regel (metUitzonderingen); hier geldt ze nooit (nakijkronde van 18 oktober 2026). Zo houdt de scan een PR
// tegen die een uitgezonderd adres aan het eind nog in de boom heeft, ook als een latere commit de regel alleen verschuift
// (dan staat ze in geen enkele commit nog als "+"-regel). Een regel die al op de basis stond, is niet van de PR en telt
// hier niet. Zonder hernoemingen: een verplaatst bestand telt helemaal, zoals in de scan per commit.
export function adressenAanDeKop({ basis, tot = "HEAD", cwd = process.cwd(), namen, overslaan = [] }) {
  const samenvoegbasis = git(["merge-base", basis, tot], cwd).trim();
  const diff = git(["diff-tree", "-p", "-r", "--no-renames", "--no-color", "--no-ext-diff", "--unified=0", samenvoegbasis, tot], cwd);
  return { samenvoegbasis, bevindingen: adressenInDiff(diff, namen, overslaan) };
}

// Een commit die al gepusht is, staat publiek en kan zonder force niet meer weg: dan houdt de scan een PR niet tegen op
// precies die plaats in die commit, met een reden (lib/adressen-uitzonderingen.json). Aan de kop (adressenAanDeKop) geldt
// geen uitzondering: daar moet het adres eruit. Elke uitzondering noemt de volledige commit, het bestand (of
// "boodschap"), de regels en het aantal; een plaats met meer, een andere regel of een andere commit telt gewoon. De
// reden zelf noemt geen echt adres (scripts/adressen-in-commits.mjs kijkt dat na).
export const UITZONDERING_REDEN_MIN = 40;
export function geldigeUitzonderingen(doc) {
  const fouten = [];
  if (doc?.schemaVersion !== 1 || !Array.isArray(doc?.uitzonderingen)) return { lijst: [], fouten: ["verwacht {schemaVersion: 1, uitzonderingen: [...]}"] };
  doc.uitzonderingen.forEach((u, i) => {
    const naam = `uitzondering ${i + 1}`;
    if (!/^[0-9a-f]{40}$/.test(String(u?.commit))) fouten.push(`${naam}: de volledige commit (40 tekens) ontbreekt`);
    if (typeof u?.waar !== "string" || !u.waar) fouten.push(`${naam}: geen bestand of "boodschap"`);
    if (!Number.isInteger(u?.aantal) || u.aantal < 1) fouten.push(`${naam}: geen aantal`);
    if (u?.waar !== "boodschap" && !(Array.isArray(u?.regels) && u.regels.length && u.regels.every((r) => Number.isInteger(r) && r > 0))) fouten.push(`${naam}: geen regels`);
    if (typeof u?.reden !== "string" || u.reden.trim().length < UITZONDERING_REDEN_MIN) fouten.push(`${naam}: geen reden (minstens ${UITZONDERING_REDEN_MIN} tekens)`);
  });
  return { lijst: fouten.length ? [] : doc.uitzonderingen, fouten };
}
export function metUitzonderingen(bevindingen, uitzonderingen = []) {
  const past = (b, u) => u.commit === b.sha && u.waar === b.waar && b.aantal <= u.aantal && (b.waar === "boodschap" || b.regels.every((r) => u.regels.includes(r)));
  const over = [], uitgezonderd = [];
  for (const b of bevindingen) (uitzonderingen.some((u) => past(b, u)) ? uitgezonderd : over).push(b);
  return { over, uitgezonderd };
}

export const standaardStratenBestand = (rootDir) => path.join(rootDir, "site", "geo", "straten.json");
