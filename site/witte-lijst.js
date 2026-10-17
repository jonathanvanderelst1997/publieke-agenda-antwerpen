// De privacyfilter voor vrije tekst uit A-Sign (innameBeschrijving: wat de aanvrager zelf intikt) als WITTE LIJST.
// docs/PUBLIC_SPACE_SOURCE_POLICY.md: die tekst mag alleen als plaatsnaam of als letterlijk trefwoord op de site.
//
// Na twee nakijkrondes met steeds nieuwe naamvormen (D'-namen, namen in hoofdletters, De/Van in kleine letters,
// onzichtbare tekens, straatnamen van één woord die ook een voornaam zijn ...) proberen we geen namen meer te
// herkennen. Uit de tekst blijft ALLEEN over wat aantoonbaar een plek of een trefwoord is:
//   (a) een volledige officiële straatnaam: de hele naam, exact (op de genormaliseerde vorm: zonder hoofdletters,
//       accenten en leestekens), uit de straatas (`isStraat`), de straten van de inname (`straten`) of de straten in
//       de buurt (`rond`); nooit een stuk van een straatnaam. Een huisnummer erna valt weg (zoals elk cijfer).
//   (b) een woord uit de vaste, korte lijst van soorten plekken (kerk, school, plein, park, markt, station, zaal ...)
//       en van gebeurtenissen (feest, stoet, markt, terras, werken, podium, parkeerverbod ...), of een samenstelling
//       van alleen zulke stammen ("Doopfeest", "Startlocatie", "Parkeerverbod");
//   (c) een district, een wijk of een bekende plek uit de vaste lijst hieronder (en BEKENDE_PLAATSNAMEN).
// Kleine woorden ("aan", "de", "naar") blijven alleen tussen twee woorden die blijven. Al de rest valt weg: elk
// woord met of zonder hoofdletter dat niet op de lijst staat, elk cijfer, elke telefoon-, mail- of huisnummervorm,
// letters buiten het Latijnse schrift. Waar iets wegviel, staat " … ". Liever een omschrijving te weinig dan een naam
// te veel.
//
// Twee extra sloten, omdat een plek ook een naam kan zijn:
//   - Een straatnaam van één woord zonder zekere plaatsuitgang (de straatas kent er zo een vijftigtal, waaronder
//     voornamen en familienamen), of van meer woorden zonder een woord dat een plek is, telt nooit: dat kan een
//     voornaam of een achternaam zijn ("Testdries", "Proefoever").
//   - Een plek uit de vaste lijst zonder zekere uitgang ("Meir", "Kiel", "Berchem", "Dam") telt alleen met een plek,
//     een trefwoord, een voorzetsel of een leesteken ernaast, nooit naast een woord dat wegvalt ("Testpersoon Meir") en nooit
//     na "Van", "De" of een los "van" ("Van Berchem", "feest van Dam").
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
// Een woord zonder accenten. Alleen een woord dat dan nog uitsluitend uit a-z en 0-9 bestaat, kan op de lijst staan:
// kleine hoofdletters (ᴛᴏᴍ), letters uit een ander schrift en een apostrof in het woord ("D'hondt") nooit.
const zonderAccent = (w) => String(w ?? "").normalize("NFD").replace(/\p{M}/gu, "");
const isZuiver = (w) => /^[A-Za-z0-9]+$/.test(zonderAccent(w));
// De sleutel van een naam, zoals die van de straatas (nameKey in site/street-core.js): zonder accenten en
// hoofdletters, alles wat geen letter of cijfer is wordt één spatie.
export const sleutel = (v) => zonderAccent(voorbereid(v, 200)).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// ---------- (b) de vaste woorden ----------

// Stammen van gebeurtenissen en van soorten plekken. Een woord telt als het één stam is met een uitgang ("Feesten",
// "Nadars", "Kraampjes"), of een samenstelling van stammen met een tussenstuk ("Doop-feest", "Verkeer-s-vrij-e",
// "Spel-letjes-locatie"). Een stam die vaak een achternaam is (groot, klein, boer, punt, rad, hof, berg, veld, bos,
// dijk, kant, hoek, werf, bus, poort, wijk, koers, enkel, vrij ...) staat er bewust niet in: die woorden vallen weg
// ("Vrijdag" is geen vrij + dag).
const GEBEURTENIS_STAMMEN = `start stop aankomst finish vertrek verzamel verzamelpunt eind einde parcours wandel wandeling
  wandelaar loop loper jogging marathon run fiets fietser wieler wielerkoers criterium wedstrijd tocht stoet optocht parade
  processie carnaval praalwagen markt braderie braderij rommelmarkt vlooienmarkt jaarmarkt kerstmarkt boekenmarkt
  boerenmarkt kerst feest wijkfeest kermis foor podium tent pagode nadar dranghek hekken parkeer verkeer verkeersvrij
  verkeersvrije autovrij
  omleiding verbod doop student studenten schacht drill dril spel spelletjes speel animatie jeugd volwassen kind kinder
  ronde stand bar toog reuzenrad kraam kramen servicepunt generator locatie inname opbouw afbraak afbouw zone route
  event evenement team teambuilding strook wagen werk werken werfzone bouwwerf terras verkoop opname film foto concert
  optreden tribune opening sticker vlag vlaggen versiering bladslag levering verhuis oldtimer foodtruck toilet
  springkasteel container deelnemer voetganger muziek dans sport inschrijving eerste tweede derde vierde vijfde zesde
  zevende achtste negende tiende fase dag nacht avond ochtend middag tijdelijk tijdelijke volledig volledige
  correct`.split(/\s+/).filter(Boolean);
const PLAATS_STAMMEN = `kerk kapel kathedraal school college instituut campus plein pleintje park markt station metro premetro
  metrostation premetrostation halte tram zaal centrum dok kaai kaaien kade straat straten laan lei leien steenweg
  brug tunnel parking kruispunt rotonde voetpad fietspad rijweg rijbaan stoep trottoir berm gras grasveld speelplein
  speelplaats speeltuin sporthal sportveld terrein tuin binnenplein voorplein ingang uitgang buurt district stad zijde
  gebouw museum bibliotheek jeugdhuis stadhuis districtshuis schouwburg loods hangar pier steiger jaagpad stadion
  velodroom zwembad ponton haven perron trap trappen plaats`.split(/\s+/).filter(Boolean);
const GEBEURTENIS = new Set(GEBEURTENIS_STAMMEN);
const PLAATS = new Set(PLAATS_STAMMEN);
const STAMMEN = new Set([...GEBEURTENIS, ...PLAATS]);
const TUSSEN = ["", "s", "en", "e", "letjes", "etjes", "tjes", "jes"];
// Geen losse "-e" of "-n": "Rune" (run + e) is een voornaam (nakijkronde van head ba03ff4). Een bijvoeglijk naamwoord op -e
// staat er zelf in ("verkeersvrije", "tijdelijke").
const UITGANG = new Set(["", "s", "en", "je", "jes", "tje", "tjes", "pje", "pjes", "etje", "etjes"]);
// De stammen van een woord (de ontleding met de meeste stammen), of null als het woord niet helemaal uit stammen bestaat.
function ontleed(w, diepte = 0) {
  if (!w || diepte > 4) return null;
  let best = null;
  for (let i = Math.min(w.length, 20); i >= 2; i -= 1) {
    const stam = w.slice(0, i);
    if (!STAMMEN.has(stam)) continue;
    const rest = w.slice(i);
    if (UITGANG.has(rest) && (!best || best.length < 1)) best = [stam];
    for (const t of TUSSEN) {
      if (!rest.startsWith(t) || rest.length <= t.length) continue;
      const verder = ontleed(rest.slice(t.length), diepte + 1);
      if (verder && (!best || best.length < verder.length + 1)) best = [stam, ...verder];
    }
  }
  return best;
}
// Kleine woorden die alleen blijven tussen twee woorden die blijven ("Stoet van de Groenplaats naar de Meir"). Met een
// hoofdletter alleen de woorden die geen voorvoegsel van een achternaam kunnen zijn: "Van", "De", "Op", "In", "Ten",
// "Het" vallen met een hoofdletter altijd weg ("Feest Van Testpersoon").
const VOEGWOORDEN = new Set(`van naar tot aan op in bij langs over door via rond richting tussen en de het t een voor achter
  naast tegenover ter hoogte met zonder alleen enkel ook tijdens of vanaf even oneven heen terug kant`.split(/\s+/).filter(Boolean));
const VOEGWOORD_MET_HOOFDLETTER = new Set(`naar tot aan bij langs over door via rond richting tussen en een voor achter naast
  tegenover met zonder alleen ook tijdens of vanaf heen terug`.split(/\s+/).filter(Boolean));
// Voorzetsels: daarna mag een plek uit de vaste lijst zonder zekere uitgang staan ("op de Meir", "in Berchem"). Niet "van":
// "Van Berchem" en "feest van Dam" kunnen een achternaam zijn; "van de" en "van het" wel.
const VOORZETSELS = new Set(`naar tot aan op in bij langs over door via rond richting tussen voor achter naast tegenover
  vanaf en of nabij`.split(/\s+/).filter(Boolean));
const LIDWOORDEN = new Set(["de", "het", "t"]);
// Wat vóór een achternaam staat: een voorvoegsel met een hoofdletter ("De Bus", "Van Kerk") of een persoonswoord
// ("familie Bus", "dhr. Tent").
const VOORVOEGSEL = new Set("van de den der ter ten te le la du des vande vander vanden het t d o mc op in".split(" "));
const PERSOON = new Set("familie fam gezin dhr mevr mevrouw meneer mijnheer mr mw mej mejuffrouw juffrouw heer".split(" "));

// ---------- (c) de vaste plekken ----------

// De districten van stad Antwerpen, de wijken (site/geo/wijken.geo.json, zonder de wijken met een gewoon woord als naam:
// "Groen", "Heide", "Hoogte", "Noord", "Oost", "West", "Donk", "Polder", "Haven") en bekende plekken zonder straatnaam.
export const VASTE_PLEKKEN = Object.freeze([
  "Antwerpen", "Berchem", "Borgerhout", "Borsbeek", "Deurne", "Ekeren", "Hoboken", "Merksem", "Wilrijk", "Berendrecht",
  "Zandvliet", "Lillo", "Berendrecht-Zandvliet-Lillo",
  "Brederode", "Centraal Station", "Dam", "Eilandje", "Haringrode", "Harmonie", "Historisch Centrum", "Kiel", "Linkeroever",
  "Luchtbal", "Mariaburg", "Markgrave", "Middelheim", "Nieuw Zuid", "Oud-Berchem", "Oud-Merksem", "Rivierenhof", "Rozemaai",
  "Schelde", "Schipperskwartier", "Seefhoek", "Sint-Andries", "Stuivenberg", "Tentoonstellingswijk", "Theaterbuurt",
  "Tuinwijk", "Universiteitsbuurt", "Valaar", "Zuid", "Zurenborg", "Groen Kwartier",
  "Meir", "Wapper", "Oudaan", "Leien", "Het Steen", "MAS", "Kathedraal", "Onze-Lieve-Vrouwekathedraal", "Sint-Pauluskerk",
  "Sint-Jacobskerk", "Sint-Andrieskerk", "Sint-Joriskerk", "Sint-Carolus Borromeuskerk", "Stadsfeestzaal", "Bourla",
  "Scheldekaaien", "Droogdokkenpark", "Spoor Noord", "Middelheimpark", "Astridplein",
]);
// Bekende plaatsnamen zonder straatnaam: de vaste plekken (lib/vaste-plekken.json) en de plekken van het studentencharter
// (lib/studentencharter.json). Hier als lijst, want de filter draait ook in de browser; tests/vaag-eind-slot.test.mjs
// houdt ze gelijk.
export const BEKENDE_PLAATSNAMEN = Object.freeze([
  "Parking Spoor Oost", "Olympisch Stadion", "park Den Brandt", "park Konijnenwei", "Belvédère",
  "Scheldekaai", "Sint-Michielskaai", "Voorplein Belvedère", "Officiersplein Fort VI", "Konijnenwei", "Luifel Schengenplein",
  "Falconplein", "Frans Halsplein", "Veemarkt", "Ossenmarkt", "Sint-Jansplein", "Plein aan de Mutsaardstraat", "Park Spoor Noord",
  "Spoor Oost", "Stadspark", "Theaterplein", "Sint-Jansvliet", "Sportterrein aan de Kielsevest", "Grasveld Van der Sweepstraat",
  "Stadswaag",
]);
const VAST = new Set([...VASTE_PLEKKEN, ...BEKENDE_PLAATSNAMEN].map(sleutel));
export const isBekendePlaatsnaam = (naam) => VAST.has(sleutel(naam));

// Een uitgang die alleen een plek is: een straatnaam of plek van één woord telt pas met zo'n uitgang zonder meer.
const ZEKER_EINDE = /(?:st?traat|straatje|plein|pleintje|plaats|markt|kaai|kaaien|dok|dokken|park|parkje|station|tunnel|lei|laan|vest|steenweg|singel|dreef|rui|brug|bruggen|kade|velodroom|kerk|kathedraal)$/;
// Een naam van twee of meer woorden is een zekere plek als één woord op een plaatsuitgang eindigt of een soort plek is.
const PLAATS_EINDE = /(?:straat|straatje|laan|lei|plein|pleintje|plaats|markt|kaai|kaaien|dok|dokken|park|parkje|station|tunnel|vest|steenweg|singel|dreef|rui|brug|bruggen|kade|weg|baan|hof|berg|dijk|veld|velden|pad|gang|hoek|bos|tuin|dal|laar|akker|vliet|poort|steeg|ring|wal|reep|heide|hoeve|dorp|erf|eiland|kwartier|strand|oord|waag|kerk|kathedraal|sluis|gracht|polder|stadion|beurs|schans|fort|velodroom|veer|weel|haven|wijk)$/;
const zekerEenWoord = (k) => { const m = k.match(ZEKER_EINDE); return Boolean(m) && k.length >= m[0].length + 3; };

// ---------- de filter ----------

const GRENS = /[,;:()[\]{}|/.!?–—<>&+…]|\s-|-\s/;
// Hoe een leesteken tussen twee woorden die blijven, in de uitvoer staat: alleen deze vaste tekens.
function tussenteken(s) {
  if (/^\s*$/.test(s)) return " ";
  if (/…/.test(s)) return " … ";
  if (s === "-") return "-";
  if (/->|→|>/.test(s)) return " → ";
  if (/[,;()[\]{}]/.test(s)) return ", ";
  if (/:/.test(s)) return ": ";
  if (/\//.test(s)) return " / ";
  if (/[–—]|\s-\s|\s-|-\s/.test(s)) return " - ";
  if (/[&+]/.test(s)) return " + ";
  if (/[.!?]/.test(s)) return ". ";
  return " ";
}

// Woorden (letters en cijfers, met een apostrof erin) met het stuk tekst ervoor.
function woordenVan(t) {
  const uit = [];
  let vorig = 0;
  for (const m of t.matchAll(/[\p{L}\p{M}\p{N}]+(?:'[\p{L}\p{M}]+)*/gu)) {
    uit.push({ w: m[0], voor: t.slice(vorig, m.index), zuiver: isZuiver(m[0]), k: zonderAccent(m[0]).toLowerCase() });
    vorig = m.index + m[0].length;
  }
  return uit;
}

// De tekst door de witte lijst. Geeft { tekst, plekken, gebeurtenis, soortPlek }: de tekst met alleen wat op de lijst
// staat ("" als er niets overblijft), de plekken (straatnamen en vaste plekken) die erin staan, en of er een
// gebeurteniswoord of een soort plek in staat. `straten`: de straten van de inname (namen of { name }); `isStraat(naam)`:
// staat die hele naam in de straatas? `rond`: straatnamen in de buurt (of een functie die ze geeft). `modus: "plaats"`:
// alleen plekken, soorten plekken en kleine woorden (voor een plaatsnaam); gebeurteniswoorden vallen dan ook weg.
export function witteLijst(tekst, { straten = [], isStraat = null, rond = [], modus = "" } = {}) {
  const t = voorbereid(tekst);
  const leeg = { tekst: "", plekken: [], gebeurtenis: false, soortPlek: false };
  if (!t) return leeg;
  const w = woordenVan(t);
  const eigen = new Set((Array.isArray(straten) ? straten : []).map((s) => sleutel(typeof s === "string" ? s : s?.name)).filter(Boolean));
  let rondSet = null;
  const rondHeeft = (k) => {
    rondSet ??= new Set(((typeof rond === "function" ? rond() : rond) || []).map((s) => sleutel(typeof s === "string" ? s : s?.name)).filter(Boolean));
    return rondSet.has(k);
  };
  // Welke soort plek is deze reeks woorden: "vast" (vaste lijst), "straat" (straatas, inname, buurt) of "".
  const plekSoort = (naam) => {
    const k = sleutel(naam);
    if (!k) return "";
    if (VAST.has(k)) return "vast";
    if (eigen.has(k) || (typeof isStraat === "function" && isStraat(naam)) || rondHeeft(k)) return "straat";
    return "";
  };
  const soort = new Array(w.length).fill("weg"); // plek | woord | voeg | weg | getal
  const plekVan = new Array(w.length).fill(null);
  // (a) en (c): de langste reeks woorden eerst, van links naar rechts, alleen met een spatie, koppelteken of apostrof
  // ertussen. Een reeks telt alleen als geheel: "Testdries Proefrosier" is geen straat, ook als elk woord apart het is.
  for (let i = 0; i < w.length;) {
    let gevonden = 0;
    for (let lengte = Math.min(7, w.length - i); lengte >= 1 && !gevonden; lengte -= 1) {
      const reeks = w.slice(i, i + lengte);
      if (!reeks.every((x) => x.zuiver)) continue;
      if (reeks.slice(1).some((x) => !/^[ '-]$/.test(x.voor))) continue;
      const naam = reeks.map((x) => x.w).join(" ");
      const bron = plekSoort(naam);
      if (!bron) continue;
      const sleutels = reeks.map((x) => x.k);
      const zeker = lengte === 1 ? zekerEenWoord(sleutels[0]) : sleutels.some((k) => PLAATS_EINDE.test(k) || PLAATS.has(k));
      // Een straatnaam zonder zekere uitgang ("Testdries", "Proefoever", of twee woorden zonder plaatswoord): nooit. Alleen de
      // vaste lijst kent zulke plekken ("Meir", "Kiel"), en die tellen alleen met een goede buur (hieronder).
      if (!zeker && bron === "straat") continue;
      gevonden = lengte;
      const p = { van: i, tot: i + lengte, naam: reeks.map((x) => x.w), zeker };
      for (let k = i; k < i + lengte; k += 1) { soort[k] = "plek"; plekVan[k] = p; }
    }
    i += gevonden || 1;
  }
  // (b) de vaste woorden en de kleine woorden.
  for (const [k, x] of w.entries()) {
    if (soort[k] === "plek") continue;
    if (/\d/.test(x.w)) { soort[k] = "getal"; continue; }
    if (!x.zuiver) continue;
    const delen = ontleed(x.k);
    if (delen) {
      const plaats = PLAATS.has(delen.at(-1));
      if (modus === "plaats" && !plaats) continue;
      soort[k] = "woord";
      x.plaats = plaats;
      x.gebeurtenis = delen.some((d) => GEBEURTENIS.has(d));
      continue;
    }
    const kleineLetters = x.w === x.w.toLowerCase();
    const hoofdletter = /^[A-Z][a-z]*$/.test(zonderAccent(x.w)) || /^[A-Z]+$/.test(zonderAccent(x.w));
    if (VOEGWOORDEN.has(x.k) && (kleineLetters || (hoofdletter && VOEGWOORD_MET_HOOFDLETTER.has(x.k)))) soort[k] = "voeg";
  }
  // Een woord van de lijst met één hoofdletter en één stam ("Bus", "Kerk", "Feest") naast een voorvoegsel met hoofdletter
  // ("De Bus"), een persoonswoord ("familie Bus"), een woord met een hoofdletter dat wegvalt ("Testpersoon Bus", "Bus Testpersoon") of
  // een woord dat niet zuiver is ("D'hondt Kerk"): weg, het kan een achternaam zijn. Een samenstelling ("Doopfeest") en
  // een woord in hoofdletters ("NADARS") blijven.
  const naamBuur = (j, grens) => {
    if (j < 0 || j >= w.length || GRENS.test(grens)) return false;
    const y = w[j], groot = /^[A-Z]/.test(zonderAccent(y.w));
    return PERSOON.has(y.k) || !y.zuiver || (groot && VOORVOEGSEL.has(y.k)) || (groot && soort[j] === "weg");
  };
  // Na een voorvoegsel met een hoofdletter ("Van Standbar", "De Werfkant", "Van de Stoet", "VAN FEEST") of na een
  // persoonswoord ("familie Feest") valt elk woord van de lijst weg, behalve één stam in kleine letters ("De stoet vertrekt").
  const naVoorvoegsel = (k) => {
    for (let j = k - 1; j >= 0 && !GRENS.test(w[j + 1].voor); j -= 1) {
      const y = w[j];
      if (PERSOON.has(y.k)) return true;
      if (!VOORVOEGSEL.has(y.k)) return false;
      if (/^[A-Z]/.test(zonderAccent(y.w))) return true;
    }
    return false;
  };
  for (const [k, x] of w.entries()) {
    if (soort[k] !== "woord") continue;
    const enkel = ontleed(x.k).length === 1;
    if (naVoorvoegsel(k) && (!enkel || x.w !== x.w.toLowerCase() || PERSOON.has(w[k - 1]?.k))) { soort[k] = "weg"; continue; }
    if (!enkel || !/^[A-Z][a-z]+$/.test(zonderAccent(x.w))) continue;
    if (naamBuur(k - 1, x.voor) || naamBuur(k + 1, w[k + 1]?.voor ?? "")) soort[k] = "weg";
  }
  // Een plek uit de vaste lijst zonder zekere uitgang (en een straatnaam van meer woorden zonder plaatswoord): alleen met
  // een plek, een trefwoord, een voorzetsel, een getal of een leesteken ernaast.
  const grensVoor = (k) => k === 0 || GRENS.test(w[k].voor);
  const goedeBuur = (k) => k >= 0 && k < w.length && (soort[k] === "woord" || soort[k] === "getal" || (soort[k] === "plek" && plekVan[k].zeker));
  for (const p of new Set(plekVan.filter(Boolean))) {
    if (p.zeker) continue;
    let links = !grensVoor(p.van) ? p.van - 1 : -1;
    let ok = links < 0;
    if (!ok) {
      // Over "de", "het", "'t" heen (kleine letters), naar het voorzetsel ervoor: "op de Meir", "van de Stadswaag".
      let j = links;
      const lidwoord = soort[j] === "voeg" && LIDWOORDEN.has(w[j].k) && w[j].w === w[j].k;
      if (lidwoord) {
        if (grensVoor(j)) ok = true;
        else {
          j -= 1;
          ok = goedeBuur(j) || (soort[j] === "voeg" && w[j].w === w[j].k && (VOORZETSELS.has(w[j].k) || w[j].k === "van"));
        }
      } else ok = goedeBuur(j) || (soort[j] === "voeg" && w[j].w === w[j].k && VOORZETSELS.has(w[j].k));
    }
    const rechts = p.tot;
    if (ok && rechts < w.length && !GRENS.test(w[rechts].voor)) ok = goedeBuur(rechts) || (soort[rechts] === "voeg" && w[rechts].w === w[rechts].k);
    if (!ok) for (let k = p.van; k < p.tot; k += 1) { soort[k] = "weg"; plekVan[k] = null; }
  }
  // De stukken: woorden die blijven, met de kleine woorden ertussen. Een woord of getal dat wegvalt, sluit een stuk af;
  // kleine woorden aan de rand van een stuk vallen weg. Hoogstens 140 tekens, alleen hele woorden.
  const stukken = [];
  let stuk = [];
  const sluit = () => {
    while (stuk.length && soort[stuk[0]] === "voeg") stuk.shift();
    while (stuk.length && soort[stuk.at(-1)] === "voeg") stuk.pop();
    if (stuk.length) stukken.push(stuk);
    stuk = [];
  };
  for (let k = 0; k < w.length; k += 1) {
    if (soort[k] === "weg" || soort[k] === "getal") sluit();
    else stuk.push(k);
  }
  sluit();
  let uit = "";
  const gebruikt = [];
  vol: for (const s of stukken) {
    let deel = "";
    const hier = [];
    for (const [n, k] of s.entries()) {
      const stukje = `${n ? tussenteken(w[k].voor) : ""}${w[k].w.normalize("NFC")}`;
      if ((uit ? uit.length + 3 : 0) + deel.length + stukje.length > 140) {
        while (hier.length && soort[hier.at(-1)] === "voeg") { hier.pop(); deel = deel.slice(0, deel.lastIndexOf(" ")); }
        if (hier.length) { uit += `${uit ? " … " : ""}${deel}`; gebruikt.push(...hier); }
        break vol;
      }
      deel += stukje;
      hier.push(k);
    }
    uit += `${uit ? " … " : ""}${deel}`;
    gebruikt.push(...hier);
  }
  let gebeurtenis = false, soortPlek = false;
  const plekken = [];
  for (const k of gebruikt) {
    if (soort[k] === "woord") { if (w[k].plaats) soortPlek = true; if (w[k].gebeurtenis) gebeurtenis = true; }
    if (soort[k] === "plek" && plekVan[k].van === k) plekken.push(plekVan[k].naam.join(" "));
  }
  return { tekst: uit, plekken, gebeurtenis, soortPlek };
}

// De tekst zoals de site hem mag tonen: alleen wat op de witte lijst staat, en alleen als er een plek of een
// gebeurteniswoord in staat (een losse "straat" of "kant" zegt niets). "" als er niets bruikbaars overblijft.
export function witteTekst(tekst, opties = {}) {
  const r = witteLijst(tekst, opties);
  return r.plekken.length || r.gebeurtenis ? r.tekst : "";
}
