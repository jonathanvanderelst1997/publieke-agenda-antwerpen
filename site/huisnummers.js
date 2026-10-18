// Huisnummers van een werk: het nummer of het bereik zoals de beheerder het in zijn tekst schreef, of zoals het
// adressenregister het geeft. De plaats mag exact (besluit van de eigenaar van 18 oktober 2026, site/works-core.js;
// docs/PUBLIC_SPACE_SOURCE_POLICY.md): ook één nummer en een nummer met een code eraan ("PROEFSTRAAT 1DN02").
// Een eigen bestand zonder andere imports, zodat ook de straatkoppeling (site/street-core.js: het adres van de beheerder)
// dezelfde regel gebruikt als de kaart (site/kaart-uitleg.js), zonder heel de kaart te laden.

const clean = (v, max = 300) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const uniek = (rows) => [...new Set(rows.map((v) => clean(v)).filter(Boolean))];
const zonderAccenten = (v) => v.normalize("NFD").replace(/[̀-ͯ]/g, "");

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
// site/works-core.js). Nooit een maat ("30m", "10kV"), een duur of een uur ("8u", "3dagen") of een rangtelwoord ("2de
// fase"), ook niet als gewoon huisnummer.
const NUMMER_MET_CODE = String.raw`\d{1,3}[\p{L}_][\p{L}\d_]{0,11}(?![\p{L}\d_])`;
// Een maat of een duur na een getal, met of zonder spatie ("30 m", "160 meter", "3 dagen", "8 u", "10 kV").
const EENHEID = String.raw`(?:m|m2|m²|km|cm|mm|kv|meters?|u|uur|uren|h|min|minuten|dagen|dag|weken|week|maanden|maand|jaar|jaren|nachten|nacht|ton|kg)`;
const GEEN_HUISNUMMER = new RegExp(String.raw`^\d+(?:${EENHEID}|de|ste)$`, "iu");
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
// Huisnummers die de beheerder zelf in een tekst zette: "Proefstraat 18 - 24", "Testlaan 1-25", "Proefstraat 12".
// Een reeks in elke schrijfwijze telt als reeks: "13 tem 15", "13 t.e.m. 15", "13 tot en met 15", "13 t/m 15",
// "13 tot 15", "13 → 15", "13 en 15" en "13, 15 en 17" geven allemaal "nr. 13–15" (of 13–17), nooit "nr. 13".
// Hoogstens drie cijfers: "Proefstraat 13, 2000 Antwerpen" is geen reeks tot 2000. Na een komma of "en"
// telt een getal alleen als er geen woord op volgt ("Proefstraat 12, 3 dagen" is geen reeks). Een nummer met een code
// eraan ("PROEFSTRAAT 1DN02") blijft heel: "nr. 1DN02".
// Ook met een scheiding tussen de straat en het nummer, zoals GIPOD een adres vaak schrijft ("2000 | Antwerpen |
// PROEFSTRAAT | 12", "- PROEFSTRAAT - 12 -", "Proefstraat, 12", "Proefstraat (12)"), of met "thv", "ter hoogte van" of
// "nr." ervoor. Na een scheiding telt het getal alleen als er niets meer op volgt dan een scheiding of "bus": "Proefstraat,
// 3 dagen", "Proefstraat - 30 m" en "Proefstraat: 2 rijstroken" zijn geen huisnummer. Hoofdletters en accenten tellen
// niet: "DESIRE PROEFSTRAAT 12" hoort bij de "Désiré Proefstraat".
// Geen letter, cijfer of underscore erna: "3B_BIS" is een nummer met een code (NUMMER_MET_CODE), niet "3B".
const NUMMER = String.raw`\d{1,3}[a-z]?(?![\d\p{L}_])`;
const REEKS = String.raw`\s*(?:-|–|—|→|tot en met|t\.\s?e\.\s?m\.?|tem|t\/m|tot)\s*`;
const OPSOMMING = String.raw`\s*(?:,|en)\s*`;
const NA_OPSOMMING = String.raw`(?=\s*(?:$|[.;:,)/|]|[-–→]|(?:en|tem|tot|t\/m)(?!\p{L})))`;
const NUMMERS = String.raw`${NUMMER}(?:${REEKS}${NUMMER}|${OPSOMMING}${NUMMER}${NA_OPSOMMING})*`;
// Ook "huisnr. 12" en "nummer 12" (nakijkronde van head c4bb2927: zulke nummers las de regel niet, en dan stond de vrije
// tekst met een naam naast het adres).
const VOOR_NUMMER = String.raw`(?:(?:thv|t\.\s?h\.\s?v\.?|ter\s+hoogte\s+van)\s*)?(?:(?:nrs?|no|n°|hnr|huisnr|huisnummers?|nummers?)\.?\s*)?`;
const SCHEIDING = String.raw`\s*[|,:(–—-]\s*`;
const NA_SCHEIDING = String.raw`(?=\s*(?:$|[|,;:)/·.–—-]|bus(?![\p{L}])))`;
// Wat meteen na de straat staat: met een spatie, of met een scheiding en niets erna. Eén keer gebouwd ("y": vanaf de plek
// na de straat); de straat zelf zoekt indexOf. Een regex per straat bouwen kostte enkele ms per werk (de lijst van het
// hele district koppelt elk werk aan zijn straat: site/street-core.js).
const NA_STRAAT = [
  new RegExp(String.raw`\s+${VOOR_NUMMER}(${NUMMERS})`, "iuy"),
  new RegExp(`${SCHEIDING}${VOOR_NUMMER}(${NUMMERS})${NA_SCHEIDING}`, "iuy"),
];
const CODE_NA_STRAAT = [
  new RegExp(String.raw`\s+${VOOR_NUMMER}(${NUMMER_MET_CODE})`, "iuy"),
  new RegExp(`${SCHEIDING}${VOOR_NUMMER}(${NUMMER_MET_CODE})${NA_SCHEIDING}`, "iuy"),
];
// Wat na de nummers staat en zegt dat het een maat, een duur of een rangtelwoord is: een eenheid na een spatie ("Proefstraat
// 30 m kabel", "Proefstraat 3 dagen", ook na een reeks: "Proefstraat 8 tot 17 u", "Proefstraat 12 - 30 m"), of een woord na
// een getal op -e ("Proefstraat 2e fase", "3E DEEL"; "Proefstraat 12e" aan het einde blijft een huisnummer). Liever geen
// nummer dan een fout.
const EENHEID_ERNA = new RegExp(String.raw`^\s*(?:${REEKS}\d{1,3}\s*)?${EENHEID}(?![\p{L}\d])`, "iu");
const RANGTELWOORD = /\d{1,3}e$/i;
// De eerste plek in de tekst waar de straat staat met erna wat `re` zoekt (in hoofd- of kleine letters).
function naDeStraat(t, laag, s, re) {
  for (let i = laag.indexOf(s); i >= 0; i = laag.indexOf(s, i + 1)) {
    re.lastIndex = i + s.length;
    const m = re.exec(t);
    if (m) return { m, begin: i };
  }
  return null;
}
// De straat zoals de beheerder ze schrijft: voluit, of afgekort ("Proefstr. 12" voor de Proefstraat; nakijkronde van head
// c4bb2927).
const straatVormen = (s) => (/straat$/.test(s) ? [s, `${s.slice(0, -6)}str.`, `${s.slice(0, -6)}str`] : [s]);
export function huisnummersUitTekst(tekst, straat) {
  const t = zonderAccenten(clean(tekst, 400)), s = zonderAccenten(clean(straat, 120)).toLowerCase();
  if (!t || !s) return "";
  const laag = t.toLowerCase();
  // Verandert een letter van lengte in kleine letters, dan klopt de plek niet meer: dan niets (liever geen nummer dan een fout).
  if (laag.length !== t.length) return "";
  const zoek = (lijst) => {
    for (const vorm of straatVormen(s)) for (const re of lijst) { const r = naDeStraat(t, laag, vorm, re); if (r) return r; }
    return null;
  };
  // Een traject van adres tot adres ("vanaf Proefstraat 5 – Testlei 32") noemt geen huis: het nummer is waar een stuk begint
  // of eindigt (nakijkronde van head c4bb2927). Dan geen nummer uit de tekst; het adressenregister geeft het bereik.
  const inTraject = (begin, einde) => adresVermeldingen(t, [s]).some((v) => v.traject && v.begin < einde && v.einde > begin);
  const r = zoek(NA_STRAAT);
  // Een maat of een uur ("8u tot 17u", "30m", "30 m", "3 dagen") is geen huisnummer, ook niet in een reeks; een getal op -e
  // met een woord erna is een rangtelwoord ("2e fase").
  if (r) {
    const { m } = r;
    const delen = m[1].match(/\d{1,3}[a-z]?/gi);
    const erna = t.slice(m.index + m[0].length);
    if (delen.some((d) => GEEN_HUISNUMMER.test(d)) || EENHEID_ERNA.test(erna) || (RANGTELWOORD.test(m[1]) && /^\s+\p{L}/u.test(erna))) return "";
    if (inTraject(r.begin, m.index + m[0].length)) return "";
    // "31/33" is een reeks; "31/2" is een bus (een kleiner getal na de schuine streep): dan nr. 31.
    const schuin = delen.length === 1 && erna.match(/^\s*\/\s*(\d{1,3})(?![\d\p{L}_])/u);
    if (schuin && Number(schuin[1]) > nr(delen[0])[0]) delen.push(schuin[1]);
    return geldigeHuisnummers(huisnummerBereik(delen));
  }
  const code = zoek(CODE_NA_STRAAT);
  if (code && inTraject(code.begin, code.m.index + code.m[0].length)) return "";
  return code ? geldigeHuisnummers(`nr. ${code.m[1]}`) : "";
}

// ---------- wijst een tekst een huis aan? ----------
// De strikte regel hierboven leest het nummer dat bij "Waar" komt (liever geen nummer dan een fout). Voor de privacy
// (site/kaart-uitleg.js, isEenHuis: bij één huis geen vrije tekst van de beheerder) telt de ruimere vraag: staat er in de tekst
// een los huisnummer, waar of hoe ook geschreven? Na een straatnaam (ook afgekort of in hoofdletters, ook een andere straat
// dan die van de kaart), na een scheiding ("Proefstraat, 12 voor ..."), of met "thv", "nr.", "huisnr." of "nummer" ervoor.
// Nakijkronde van head c4bb2927: "Stelling Proefstr. 12 voor fam. Proefmans" las de strikte regel niet, en dan stond de naam
// naast het exacte adres. Hier is een vals nummer goedkoper dan een gemist: het verbergt hoogstens wat vrije tekst.
// Geen huis: een reeks ("12-14", "12 en 14", "31/33"), een traject van adres tot adres ("vanaf Proefstraat 5 – Testlei 32",
// "van Proefstraat 5 tot Testlei 32"), een maat, een duur, een uur, een rangtelwoord, een volgnummer ("fase 2", "koppelput 1",
// "bus 3", "lijn 4"), een postcode of een dossiernummer (vier cijfers of meer).
const UITGANG = "steenweg|straatje|straat|laan|lei|weg|dreef|baan|kaai|kade|vest|singel|gang|steeg|poort|boulevard|dijk|plaats|markt|brug|rui|vliet|waag|berg|ring|tunnel|plein|pad|park|hof|eiland|dok|velden|veld|erf|bos|kwartier|strand|wal|oord|square|hoek|tuin|gracht";
const STRAATWOORD = new RegExp(String.raw`^\p{L}[\p{L}'’.\-]*(?:${UITGANG}|str\.?)$`, "iu");
const VOLGWOORD = /(?:fase|deel|zone|nacht|week|dag|dagen|stap|put|lijn|bus|tram|perceel|blok|kavel|lot|plan|nr|nrs|punt|paal|mast|kast)$/iu;
const HOOFDLETTERWOORD = /^\p{Lu}[\p{Lu}'’.\-]{3,}$/u;
const GEEN_STRAAT_HOOFDLETTERS = /^(?:KABEL|LEIDING|CABINE|PALEN|FASE|DEEL|ZONE|NACHT|WEEK|NUMMER|HUISNUMMER|KAST|MAST|PUT|BLOK|LOT|PLAN|LIJN|TRAM|BUS|BIS|GIPOD|DOSSIER|PROJECT|WERF|WERKEN)$/u;
const KANDIDAAT = /(?<![\p{L}\d_])\d{1,3}(?:[\p{L}_][\p{L}\d_]{0,11})?(?![\p{L}\d_])/gu;
const PREFIX_EIND = /(?:(?:\bthv|\bt\.\s?h\.\s?v\.?|\bter\s+hoogte\s+van)\s*)?(?:(?:\bnrs?|\bno|n°|\bhnr|\bhuisnr|\bhuisnummers?|\bnummers?)\.?\s*)?$/iu;
const SCHEIDING_EIND = /(?:\s*[|,:(–—-]\s*|\s+)$/u;
// Een reeks of een lijst na het nummer: "12-14", "12 tem 14", "12, 14 en 16", "12 14 16" (een lijst zonder komma's), "31/33".
const REEKS_ERNA = new RegExp(String.raw`^(?:${REEKS}${VOOR_NUMMER}\d{1,3}[a-z]?(?![\d\p{L}_])|${OPSOMMING}\d{1,3}[a-z]?(?![\d\p{L}_])${NA_OPSOMMING}|(?:\s+\d{1,3}[a-z]?(?![\d\p{L}_]))+(?=\s*(?:$|[.;:,)/|–—-]))|\s*\/\s*\d{1,3}(?![\d\p{L}_]))`, "iu");
const TRAJECT_TUSSEN = /^\s*(?:-|–|—|→|tot(?:\s+en\s+met|\s+aan)?|tem|t\.\s?e\.\s?m\.?|t\/m)\s*$/iu;
const sleutelStraat = (s) => zonderAccenten(clean(s, 120)).toLowerCase().replace(/str\.?$/, "straat");
// Elke vermelding van een huisnummer in de tekst: { begin, einde, straat, nummer, reeks, traject }. `straten`: de straten
// van de kaart (ook een naam zonder herkenbare uitgang telt dan).
export function adresVermeldingen(tekst, straten = []) {
  const t = zonderAccenten(clean(tekst, 400));
  if (!/\d/.test(t)) return [];
  const kaart = straten.map((s) => zonderAccenten(clean(s?.name ?? s, 120)).toLowerCase()).filter(Boolean).flatMap(straatVormen);
  const uit = [];
  for (const m of t.matchAll(KANDIDAAT)) {
    const tok = m[0], i = m.index;
    if (uit.length && i < uit.at(-1).einde) continue;
    if (!echtNummer(tok) || GEEN_HUISNUMMER.test(tok)) continue;
    const erna = t.slice(i + tok.length);
    if (EENHEID_ERNA.test(erna) || (RANGTELWOORD.test(tok) && /^\s+\p{L}/u.test(erna))) continue;
    const voor = t.slice(0, i);
    const pre = voor.match(PREFIX_EIND)[0];
    const zonderPre = voor.slice(0, voor.length - pre.length);
    const sep = pre ? "" : zonderPre.match(SCHEIDING_EIND)?.[0] || "";
    const kern = zonderPre.slice(0, zonderPre.length - sep.length).replace(/\s+$/u, "");
    if (!pre && !sep) continue;
    const woord = kern.match(/\p{L}[\p{L}'’.\-]*$/u)?.[0] || "";
    const laag = kern.toLowerCase();
    const opKaart = kaart.find((s) => laag.endsWith(s) && !/[\p{L}\d]/u.test(laag.charAt(laag.length - s.length - 1) || " "));
    const straat = opKaart || (woord && !VOLGWOORD.test(woord) && (STRAATWOORD.test(woord) || (HOOFDLETTERWOORD.test(woord) && !GEEN_STRAAT_HOOFDLETTERS.test(woord))) ? woord : "");
    if (!straat && (!pre || VOLGWOORD.test(woord))) continue;
    const reeks = erna.match(REEKS_ERNA);
    const einde = i + tok.length + (reeks ? reeks[0].length : 0);
    const begin = straat ? kern.length - straat.length : zonderPre.length;
    uit.push({ begin, einde, straat: straat ? sleutelStraat(straat) : "", nummer: tok.toLowerCase(), reeks: Boolean(reeks), traject: false, opKaart: Boolean(opKaart) });
  }
  for (let k = 1; k < uit.length; k += 1) {
    const a = uit[k - 1], b = uit[k];
    if (b.straat && TRAJECT_TUSSEN.test(t.slice(a.einde, b.begin))) a.traject = b.traject = true;
  }
  return uit;
}
// Wat de teksten van een werk aanwijzen: hoeveel losse huizen (verschillende straat en nummer), hoeveel reeksen, en of er
// een traject in staat.
export function huisAanwijzing(teksten = [], straten = []) {
  const alle = teksten.flatMap((t) => adresVermeldingen(t, straten));
  const losse = alle.filter((v) => !v.reeks && !v.traject);
  return { huizen: new Set(losse.map((v) => `${v.straat}|${v.nummer}`)).size, reeksen: alle.filter((v) => v.reeks).length, traject: alle.some((v) => v.traject) };
}

// ---------- alleen het adres uit een tekst ----------
// Het adres zoals de beheerder het schreef, zonder de rest van zijn tekst: de stukken (tussen " - ", "|", ",", ";") die
// alleen een postcode, de gemeente, een straat (met haar huisnummer of code) of een nummer na zo'n straat zijn. Voor een werk
// waar de vrije tekst niet getoond wordt (één huis: site/kaart-uitleg.js werkVoorPubliek; een tekst met "verhuis":
// site/works-core.js), zodat de plaats exact blijft ("Container voor Proefmans, Proefstraat 12" geeft "Proefstraat 12").
// DE REGEL, zoals de grondregel van de privacyfilter (site/witte-lijst.js): een straat is alleen een straat die we KENNEN, een
// straat van de kaart (`straten`: de straten van het werk, uit de straatas) of een volledige officiële straat (`isStraat`: de
// straatas van het district, site/geo/straten.json in de verversing, de straatlaag in de browser). Een woord dat op een straat
// lijkt, is geen bewijs (nakijkronde van head bc86a6ee): een familienaam op -berg, -hof of -veld ("Fam. Vandenproefberg"),
// het woord "Levering", of een naam in dezelfde hoofdletters als de straat erachter, zoals GIPOD een adres schrijft
// ("CONTAINER PROEFMANS PROEFSTRAAT 12" geeft "PROEFSTRAAT 12"). Binnen een langer stuk blijft alleen de bekende straat met
// haar nummer, de langste bekende naam eerst ("Container voor Proefmans Lange Proefstraat 12" geeft "Lange Proefstraat 12"
// als de straatas die straat kent, anders "Proefstraat 12" als de kaart de Proefstraat kent). Een losse letter na een straat
// die al een nummer heeft, is een initiaal ("Proefstraat 12, J. Proefmans" geeft "Proefstraat 12"); na een straat zonder
// nummer is ze een blok ("PROEFLAAN | A"). Zonder straatas en zonder straat van de kaart blijft hoogstens de postcode: liever
// geen adres dan een naam. `weg`: woorden die eerst wegvallen (site/works-core.js: "verhuis").
const GEMEENTE = "(?:antwerpen|antwerp|anterwerpen|berchem|borgerhout|deurne|hoboken|merksem|wilrijk|ekeren|zurenborg)";
const POSTCODE_STUK = new RegExp(String.raw`^(?:\d{4}(?:\s+\(?${GEMEENTE}\)?)?|\(?${GEMEENTE}\)?)$`, "iu");
// Het nummer zoals GIPOD het schrijft, ook met een code erachter ("12 DN40") of een lijst ("12 14 16").
// Ook een losse letter (een blok of een gebouw: "PROEFLAAN A").
const NUMMERDEEL = String.raw`${VOOR_NUMMER}(?:\d{1,4}[\p{L}\d_]{0,12}|[A-Za-z]{1,3}\d{1,4}[A-Za-z]{0,4}|[A-Z](?![\p{L}\d_]))(?:${REEKS}\d{1,4}[a-z]?|\s*\/\s*\d{1,3}|(?:\s+\d{1,3}[a-z]?(?![\d\p{L}_]))+)?(?:\s*bus\s*[\p{L}\d]{1,6})?(?:\s+[A-Z]{1,3}\d{1,4}(?![\p{L}\d_]))?`;
const NUMMER_STUK = new RegExp(String.raw`^\(?\s*${NUMMERDEEL}\s*\)?\.?$`, "iu");
const NUMMER_ACHTER = new RegExp(String.raw`(?:\s+|\s*\(\s*)${NUMMERDEEL}\s*\)?\.?$`, "iu");
const NUMMER_VOORAAN = new RegExp(String.raw`^(?:\s+|\s*[|,:(–—-]\s*)${NUMMERDEEL}(?![\p{L}\d_])\s*\)?`, "iu");
const DEEL_SPLIT = /(\s+[-–—|:]\s+|\s*[|;]\s*|,\s*|\.\s+(?=\p{Lu}))/u;
const POST_VOORAAN = new RegExp(String.raw`^(?:\d{4}\s+)?(?:${GEMEENTE}\s+)?`, "iu");
// Is `naam` een straat? Een straat van de kaart (`kaart`: zonder accenten, in kleine letters), of een officiële straat
// (`isStraat`: de stratenlijst van het district, site/geo/straten.json, zoals de grondregel van de privacyfilter).
const isBekendeStraat = (naam, kaart, isStraat) => Boolean(naam) && (kaart.includes(zonderAccenten(naam).toLowerCase()) || Boolean(isStraat?.(naam)));
function soortStuk(stuk, naStraat, kaart, isStraat) {
  if (!stuk) return "";
  if (POSTCODE_STUK.test(stuk)) return "post";
  if (naStraat && NUMMER_STUK.test(stuk)) return "nummer";
  const nummer = stuk.match(NUMMER_ACHTER);
  const naam = (nummer ? stuk.slice(0, nummer.index) : stuk).replace(POST_VOORAAN, "").trim();
  return isBekendeStraat(naam, kaart, isStraat) ? "straat" : "";
}
// Een bekende straat binnen een langer stuk (een straat van de kaart of een officiële straat, de langste naam eerst), met haar
// nummer als dat erachter staat: alleen dat ("Herstelling voetpad Proefstraat 12" geeft "Proefstraat 12").
function straatIn(stuk, kaart, isStraat) {
  const plat = zonderAccenten(stuk), laag = plat.toLowerCase();
  if (laag.length !== stuk.length) return "";
  const kandidaten = [];
  for (const s of kaart) {
    for (let i = laag.indexOf(s); i >= 0; i = laag.indexOf(s, i + 1)) {
      if (/[\p{L}\d]/u.test(laag.charAt(i - 1) || " ") || /\p{L}/u.test(laag.charAt(i + s.length) || " ")) continue;
      kandidaten.push({ begin: i, lengte: s.length });
    }
  }
  if (isStraat) {
    // Elke reeks van hoogstens vijf woorden die een officiële straat is.
    const woorden = [...stuk.matchAll(/[^\s]+/gu)];
    for (let lengte = Math.min(5, woorden.length); lengte >= 1; lengte -= 1) {
      for (let i = 0; i + lengte <= woorden.length; i += 1) {
        const begin = woorden[i].index, einde = woorden[i + lengte - 1].index + woorden[i + lengte - 1][0].length;
        const naam = stuk.slice(begin, einde).replace(/[,.;:]+$/u, "");
        if (/\p{L}{2}/u.test(naam) && isStraat(naam)) kandidaten.push({ begin, lengte: naam.length });
      }
    }
  }
  // Een straat binnen een langere bekende straat telt niet ("Proefstraat" in "Lange Proefstraat"); dan de eerste in de tekst.
  const binnen = (a, b) => b.lengte > a.lengte && b.begin <= a.begin && b.begin + b.lengte >= a.begin + a.lengte;
  const [k] = kandidaten.filter((a) => !kandidaten.some((b) => binnen(a, b))).sort((a, b) => a.begin - b.begin);
  if (!k) return "";
  const na = plat.slice(k.begin + k.lengte);
  const m = NUMMER_VOORAAN.exec(na);
  const metNummer = m && !EENHEID_ERNA.test(na.slice(m[0].length));
  return stuk.slice(k.begin, k.begin + k.lengte + (metNummer ? m[0].length : 0)).trim();
}
// De stukken van het adres: { tekst, soort: "post" of "straat", voor: de scheiding ervoor }. Een nummer in een eigen stuk na
// zijn straat ("Voorbeeldsteeg | 13") hoort bij die straat. `isStraat`: is dit een officiële straat (hele naam)?
export function adresStukken(tekst, { straten = [], weg = null, isStraat = null } = {}) {
  const t = clean(tekst, 400);
  if (!t) return [];
  const kaart = straten.map((s) => clean(s?.name ?? s, 120).toLowerCase()).filter(Boolean).flatMap(straatVormen).map(zonderAccenten);
  const delen = t.split(DEEL_SPLIT);
  const uit = [];
  let naStraat = false;
  for (let i = 0; i < delen.length; i += 2) {
    let stuk = delen[i].replace(/^[\s\-–—]+|[\s\-–—]+$/gu, "");
    if (weg) stuk = stuk.split(/\s+/).filter((w) => !weg(w)).join(" ");
    const soort = soortStuk(stuk, naStraat, kaart, isStraat);
    const behoud = soort ? stuk : straatIn(stuk, kaart, isStraat);
    if (!behoud) { naStraat = false; continue; }
    if (soort === "nummer" && uit.length) {
      // Een losse letter na een straat met een huisnummer is een initiaal, geen blok.
      if (/\d/.test(uit.at(-1).tekst) && !/\d/.test(behoud)) { naStraat = false; continue; }
      uit.at(-1).tekst += `${delen[i - 1]}${behoud}`; naStraat = false; continue;
    }
    // Twee keer dezelfde straat ("Proeflei ... - Proeflei ..."): één keer.
    if (uit.some((g) => zonderAccenten(g.tekst).toLowerCase() === zonderAccenten(behoud).toLowerCase())) { naStraat = soort !== "post"; continue; }
    uit.push({ tekst: behoud, soort: soort === "post" ? "post" : "straat", voor: uit.length ? delen[i - 1] : "" });
    naStraat = soort !== "post";
  }
  return uit;
}
export const adresDeel = (tekst, opties = {}) => adresStukken(tekst, opties).map((g) => `${g.voor}${g.tekst}`).join("").replace(/[\s|,;:–—-]+$/u, "").trim();
