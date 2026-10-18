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
const VOOR_NUMMER = String.raw`(?:(?:thv|t\.\s?h\.\s?v\.?|ter\s+hoogte\s+van)\s*)?(?:(?:nrs?|no|n°|hnr|huisnummers?)\.?\s*)?`;
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
    if (m) return m;
  }
  return null;
}
export function huisnummersUitTekst(tekst, straat) {
  const t = zonderAccenten(clean(tekst, 400)), s = zonderAccenten(clean(straat, 120)).toLowerCase();
  if (!t || !s) return "";
  const laag = t.toLowerCase();
  // Verandert een letter van lengte in kleine letters, dan klopt de plek niet meer: dan niets (liever geen nummer dan een fout).
  if (laag.length !== t.length) return "";
  const zoek = (lijst) => { for (const re of lijst) { const m = naDeStraat(t, laag, s, re); if (m) return m; } return null; };
  const m = zoek(NA_STRAAT);
  // Een maat of een uur ("8u tot 17u", "30m", "30 m", "3 dagen") is geen huisnummer, ook niet in een reeks; een getal op -e
  // met een woord erna is een rangtelwoord ("2e fase").
  const delen = m ? m[1].match(/\d{1,3}[a-z]?/gi) : [];
  if (m) {
    const erna = t.slice(m.index + m[0].length);
    if (delen.some((d) => GEEN_HUISNUMMER.test(d)) || EENHEID_ERNA.test(erna) || (RANGTELWOORD.test(m[1]) && /^\s+\p{L}/u.test(erna))) return "";
    return geldigeHuisnummers(huisnummerBereik(delen));
  }
  const code = zoek(CODE_NA_STRAAT);
  return code ? geldigeHuisnummers(`nr. ${code[1]}`) : "";
}
