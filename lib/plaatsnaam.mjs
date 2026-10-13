// Een omschrijving uit A-Sign (innameBeschrijving: vrije tekst van de aanvrager) als plaatsnaam. Zie
// docs/PUBLIC_SPACE_SOURCE_POLICY.md: de site toont die tekst alleen als plaatsnaam of als letterlijk
// trefwoord, en altijd pas na een privacyfilter. Hier de plaatsnaam: een tekst die niets anders noemt dan een
// plek ("Teniersplaats", "Metrostation Handel", "Scheldekaaien (buurt Steenplein)"). Weg ermee als er een
// cijfer (een huisnummer, een telefoonnummer), een e-mailadres, een link of een woord in staat dat geen plek
// is ("verkoop", "catering", "Sticker"), of een naam die niet in de straatas staat.
//
// De regel: elk woord met een hoofdletter dat geen soort plek ("Metrostation", "Pleintje", "Hoek") en geen
// klein woord ("Van", "De", "Sint") is, moet bewezen zijn door de straatas:
//   - een straatnaam van de stad (`isStraat`, de hele naam: "Quinten Matsijslei", "Theodoor Van Rijswijckplaats");
//   - of een straat binnen 150 m van de plek (`rond`) die dat woord in haar naam draagt ("Gummarus" bij de
//     Sint-Gummarusstraat, "Handel" bij de Handelstraat, "Montigny" bij de Montignystraat);
//   - of één samengesteld woord op een uitgang die alleen een plek is (ZEKER_EINDE: "Teniersplaats",
//     "Middelheimpark", "Willemsdok"). Een uitgang die ook een achternaam kan zijn (-dijk, -berg, -veld, -hof,
//     -weg, -laan ...: "Van Proefdijk", "Voorbeeldberg") telt niet vanzelf: zo'n woord moet in de straatas staan.
// Dat geldt ook voor één naam vóór een plaatswoord ("Testpersoon Groenplaats") en voor de naam na een soort plek
// ("Parking Testpersoon", "Hoek Testpersoon"). Een woord zonder hoofdletter moet zelf een soort plek of een klein woord zijn
// ("catering", "voetpad" en "verkoop" zijn geen plaatsnaam). Zonder straatas: alleen wat ZEKER_EINDE draagt.
// Puur: geen netwerk, geen klok.

const clean = (v, max = 200) => String(v ?? "").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim().slice(0, max);
const plat = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// Zoals de sleutel van de straatas (nameKey in site/street-core.js): zonder accenten en hoofdletters, alles wat
// geen letter of cijfer is wordt één spatie. Voor `isStraat` in de verversing (index.byName).
export const straatSleutel = (v) => plat(clean(v, 200)).replace(/[^a-z0-9]+/g, " ").trim();

// Een samengesteld woord op zo'n uitgang is altijd een plek (geen gewone achternaam). "st?traat": ook de tikfout
// "Schrijnwerksttraat" in A-Sign.
const ZEKER_EINDE = /(?:st?traat|plein|pleintje|plaats|markt|kaai|kaaien|dok|dokken|park|station|terminus|tunnel)$/i;
// Woorden die zelf een soort plek noemen (ook los, ook met een kleine letter). De naam die erop volgt
// ("Metrostation Handel", "Parking Testpersoon") is daarmee niet bewezen: die moet in de straatas staan.
const PLAATS_WOORD = /^(?:pleintje|plein|park|metrostation|premetrostation|station|halte|tramhalte|bushalte|terminus|kaai|kaaien|dok|buurt|hoek|kruispunt|parking)$/i;
// Kleine woorden in een plaatsnaam ("Van", "De", "Sint") tellen niet als woord van een naam.
const PARTIKEL = /^(?:van|de|der|den|het|ten|ter|op|aan|bij|en|in|sint|st)$/i;
// Wat nooit in een plaatsnaam staat: een cijfer, een e-mailadres, een link, contactwoorden.
const NOOIT = /\d|@|https?:|www\.|\b(?:tel|gsm|contact|mail|e-mail)\b/i;
// Alleen letters, spaties en de leestekens van een plaatsnaam.
const TEKENS = /^[\p{L}\s'’.,()/–—-]+$/u;

const isHoofdletter = (w) => /^\p{Lu}/u.test(w);
// Een samengesteld woord (langer dan de uitgang zelf: "Dok" alleen is geen naam van een dok) op een zekere uitgang.
const isZekerSamengesteld = (w) => {
  const m = String(w).match(ZEKER_EINDE);
  return Boolean(m) && w.length >= m[0].length + 3;
};

// Staan deze woorden aan het begin van een deel van de naam van een straat in de buurt? Zonder accenten en
// hoofdletters ("gummarus" in "sint-gummarusstraat"), niet als los stukje in het midden van een woord ("lis" in
// "elisabeth" telt niet). Minstens 4 letters ("Jan" bewijst niets). `heel`: alleen hele woorden ("Jan Blom" is
// geen stuk van de Jan Blomstraat; twee namen na elkaar kunnen een persoon zijn).
function inStraatRond(woorden, rond, { heel = false } = {}) {
  const doel = straatSleutel(woorden);
  if (doel.replace(/ /g, "").length < 4) return false;
  return rond.some((s) => (heel ? ` ${straatSleutel(s)} `.includes(` ${doel} `) : ` ${straatSleutel(s)}`.includes(` ${doel}`)));
}
// Een tikfout in de laatste naam van een straat in de buurt ("Jos Smoldersstraat" bij de Jos Smolderenstraat):
// evenveel woorden, alle woorden gelijk behalve het laatste, en dat begint met dezelfde 5 letters en eindigt op
// dezelfde zekere uitgang.
function bijnaStraatRond(woorden, rond) {
  const doel = straatSleutel(woorden).split(" ");
  const laatste = doel.at(-1) || "";
  const uitgang = laatste.match(ZEKER_EINDE)?.[0];
  if (doel.length < 2 || !uitgang || laatste.length < 8) return false;
  return rond.some((s) => {
    const n = straatSleutel(s).split(" ");
    return n.length === doel.length && n.slice(0, -1).join(" ") === doel.slice(0, -1).join(" ")
      && n.at(-1).slice(0, 5) === laatste.slice(0, 5) && n.at(-1).endsWith(uitgang);
  });
}

// De plaatsnaam, of "" als de tekst geen (veilige) plaatsnaam is. `rond`: straatnamen binnen 150 m, of een
// functie die ze geeft (pas gevraagd als het nodig is). `isStraat(naam)`: staat die hele naam in de straatas?
export function plaatsnaamVan(tekst, { rond = [], isStraat = () => false } = {}) {
  const t = clean(tekst, 120);
  if (t.length < 3 || t.length > 80 || NOOIT.test(t) || !TEKENS.test(t)) return "";
  // Stukken: gescheiden door komma's, haakjes, schuine strepen en losse streepjes ("A - B", "A – B"). Een naam
  // loopt nooit over zo'n grens.
  const stukken = t.split(/[,()/]+|\s[–—-]\s?|[–—]|-\s/).map((x) => x.trim()).filter(Boolean);
  if (!stukken.length || !isHoofdletter(stukken[0])) return "";
  let straten = null;
  const rondNu = () => (straten ??= (typeof rond === "function" ? rond() : rond) || []);
  // Staat deze reeks woorden in de straatas? Met twee of meer namen die nog bewezen moeten worden ("Jan Blom",
  // "Jos Smoldersstraat") alleen als hele straatnaam of als hele woorden ervan.
  const bekend = (woorden, namen) => {
    const naam = woorden.join(" ");
    if (isStraat(naam)) return true;
    return namen >= 2 ? inStraatRond(naam, rondNu(), { heel: true }) || bijnaStraatRond(naam, rondNu()) : inStraatRond(naam, rondNu()) || bijnaStraatRond(naam, rondNu());
  };
  let bewijs = false;
  for (const stuk of stukken) {
    // Een stuk dat als geheel een straatnaam is (ook met een andere hoofdletter: "Van craesbeeckstraat").
    if (isStraat(stuk)) { bewijs = true; continue; }
    // Woorden: op spaties; een woord met een koppelteken wordt in delen gesplitst ("Sint-Jansplein" = Sint +
    // Jansplein), een deel zonder hoofdletter erft die van het woord ("Montigny-ieperstraat").
    const woorden = [];
    for (const w of stuk.split(/\s+/).map((x) => x.replace(/^['’.-]+|['’.-]+$/g, "")).filter(Boolean)) {
      const delen = w.split(/-+/).filter(Boolean);
      delen.forEach((d, k) => woorden.push({ w: d, groot: isHoofdletter(d) || (k > 0 && isHoofdletter(w)) }));
    }
    // Elk woord: een soort plek, een klein woord, of met een hoofdletter (een naam die bewezen moet worden).
    const open = [];
    for (const [k, x] of woorden.entries()) {
      if (PLAATS_WOORD.test(x.w)) { bewijs = true; continue; }
      if (PARTIKEL.test(x.w)) continue;
      if (!x.groot) return "";
      if (isZekerSamengesteld(x.w)) { bewijs = true; continue; }
      open.push(k);
    }
    // De open woorden moeten gedekt zijn door een reeks woorden (met de kleine woorden en plaatswoorden ertussen)
    // die in de straatas staat. Eerst de langste reeks, zodat "Theodoor Van Rijswijckplaats" als geheel telt.
    const gedekt = new Set();
    for (let lengte = Math.min(woorden.length, 5); lengte >= 1 && gedekt.size < open.length; lengte -= 1) {
      for (let i = 0; i + lengte <= woorden.length; i += 1) {
        const reeks = woorden.slice(i, i + lengte);
        const nieuw = open.filter((k) => k >= i && k < i + lengte && !gedekt.has(k));
        if (!nieuw.length) continue;
        if (bekend(reeks.map((x) => x.w), open.filter((k) => k >= i && k < i + lengte).length)) for (const k of nieuw) gedekt.add(k);
      }
    }
    if (open.some((k) => !gedekt.has(k))) return "";
    if (open.length) bewijs = true;
  }
  return bewijs ? t : "";
}
