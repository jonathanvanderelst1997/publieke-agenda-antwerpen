// Evenementdossiers van de stad (A-Sign, laag 22 en 23) als echte agendapunten (pakket P2).
//
// Welke dossiers: in district Antwerpen (lib/district-antwerpen-grens.geojson), niet geweigerd of
// afgelast, met een evenementdag van vandaag tot VOORUIT_DAGEN dagen vooruit. Een dossier dat nog niet
// goedgekeurd is, telt mee: de zin in `info` zegt dan eerlijk "aanvraag nog niet goedgekeurd". Een dossier
// dat het district alleen aan de rand raakt (minder dan MIN_AANDEEL_DISTRICT van de route binnen de grens,
// of een handfiche die zegt dat het buiten het district ligt), hoort bij een ander district: niet in de lijst.
//
// Eén agendapunt per evenementdag. Opbouw en afbraak zijn geen eigen agendapunten: ze staan als fasen
// in het item (`fasen`) en in één zin in `info`. Een dossier met meer dan MAX_DAGEN_APART
// evenementdagen (een installatie van weken) krijgt één agendapunt per doorlopende reeks dagen.
//
// Titel, in deze volgorde:
//   1. de naam uit de handfiche (site/sources/evenement-identiteit.json);
//   2. de automatische naam (evenement-identiteit-auto.json): bij "zeker" de naam, bij "waarschijnlijk"
//      "Vermoedelijk <naam>";
//   3. de naam uit een besluit van eBesluit (evenement-besluiten.json, P3a) als dat besluit bij het
//      dossier hoort (koppelBesluiten): een gemeenschappelijke dag én de straat van het besluit als eigen
//      plek van het dossier (of, bij een evenementbesluit, als enige route door die straat), of dezelfde
//      opbouw- en afbouwdag (op 1 dag na) bij precies één dossier;
//   4. de soort: "Studentenactiviteit in de Kerkstraat"; een vermoede soort (uit de regels van de
//      herkenning) eerlijk als "Vermoedelijk een studentenactiviteit in de Kerkstraat";
//   5. anders "Evenement in de Kerkstraat — naam volgt".
// De straten komen uit stratenVanParcours() (site/parcours-straten.js), net als op de kaart. De straat in
// de titel ligt op de route.
//
// In de districtslijst komt alleen een dossier met een naam, met een soort én een straat, of met een
// parcours of een verkeersvrije zone over minstens MIN_STRATEN straten. De plekpagina blijft alle
// dossiers tonen (live uit A-Sign). Een speelstraat herkennen we aan het trefwoord in het dossier zelf.
//
// Ontdubbelen met de districtskalender en het districtsnieuws: zelfde dag, en een straat van het
// dossier in de plaats of de titel van dat agendapunt, of een punt hoogstens DUBBEL_METER van het
// dossier. Het agendapunt krijgt dan `sameAs` met de id van het andere; lib/merge-events.mjs maakt er
// één item met twee bronnen van. Twee eigen namen die niet op elkaar lijken, of twee soorten die botsen,
// worden nooit samengevoegd. Een agendapunt van eBesluit (P3a) over hetzelfde besluit ook niet apart.
// Wordt een agendapunt samen met een ander punt dat meer dagen beslaat (een festival van drie dagen in een
// besluit), dan houdt het samengevoegde item de ruimste periode.
//
// Draait na de parcoursherkenning (lib/parcours-herkenning-refresh.mjs): die haalt de dossiers al op
// en verrijkt ze met vorm, straten en gebied. Puur, op schrijfAsignEvenementen() na: geen netwerk en
// geen klok (vandaag komt van buiten). Zonder straatas, bij een fout of bij een plotse krimp blijft het
// vorige bestand byte voor byte staan en staat de fout in refresh-status.json (lib/afgeleide-bronstatus.mjs).
//
// Privacy (de repo is publiek): de omschrijving van een inname (innameBeschrijving) gaat nooit letterlijk
// mee, alleen trefwoorden; de beheerder en de aanvrager worden niet eens opgehaald; geen huisnummers
// (alleen straatnamen van de straatas, en elke tekst gaat door zonderNummers()); een organisator alleen
// met een rechtsvorm of als publieke instelling.
import fs from "node:fs";
import path from "node:path";

import { werkBronstatusBij } from "./afgeleide-bronstatus.mjs";
import { organisatorToegelaten, naamMetHuisnummer, vervangenBesluiten, wordtAgendapunt, EVENEMENT_BESLUITEN_FILE } from "./ebesluit-evenementen.mjs";
import { parseEventTimes } from "./event-contract.mjs";
import { dropAllowed, errorCodeOf, isTransientErrorCode, readSourceDocument, screenItems, suspiciousDrop, writeSourceDocument } from "./fetch-util.mjs";
import {
  AFGEWEZEN, ASIGN_BRON, GOEDGEKEURD, aandeelBinnen, afstandTot, eersteSoort, kandidaatUitAgenda, maakIndex, plat, publiekeLink, soortPast,
  zelfdeTitel, zelfdeTitelStreng, zonderNummers,
} from "./parcours-herkenning.mjs";
import { DISTRICT_POSTCODES } from "./postcodes.mjs";
import { MAX_ITEM_SAME_AS as MAX_SAME_AS, sourceDocument } from "./source-feed.mjs";
import { AUTO_HERKOMST, dagTekst, dagenTekst, datumTekst, opStraat } from "../site/kaart-uitleg.js";
import { isTunnel, parcoursGeometrie, stratenVanParcours } from "../site/parcours-straten.js";
import { nearbyStreets } from "../site/street-core.js";

export const ASIGN_EVENEMENTEN_SOURCE_ID = "district-asign-evenementen";
export const ASIGN_EVENEMENTEN_FILE = `${ASIGN_EVENEMENTEN_SOURCE_ID}.json`;
export const ID_PREFIX = "asign-ev-";
export const VOORUIT_DAGEN = 60;
// Langer dan dit aantal evenementdagen: één agendapunt per reeks, niet per dag (anders een lijst vol
// van één installatie, zoals vroeger met de marktdagen).
export const MAX_DAGEN_APART = 7;
// Een evenementfase van meer dan zoveel dagen is geen evenement maar een inname (een constructie of een
// plaatshouder van een jaar): geen agendapunt. Een kerstmarkt van een maand blijft eronder.
export const MAX_EVENEMENT_DAGEN = 62;
// Een parcours of verkeersvrije zone over minstens zoveel straten haalt de districtslijst ook zonder
// naam of soort.
export const MIN_STRATEN = 2;
// Ontdubbelen: een agendapunt hoogstens zo ver van het dossier (de route of een inname) is hetzelfde.
export const DUBBEL_METER = 250;
// Zoveel straten gaan hoogstens mee in het item (de Marathon loopt door een paar honderd).
export const MAX_STRATEN = 60;
// Een dossier waarvan minder dan dit deel van de route binnen de districtsgrens ligt, raakt het district
// alleen aan de rand (een loop in Ekeren die even over de grens gaat): niet in de districtslijst, wel op de
// plekpagina. Een handfiche beslist zelf (binnenDistrict is met de hand nagekeken).
export const MIN_AANDEEL_DISTRICT = 0.2;
// Een plotse krimp (meer dan de helft minder komende agendapunten, suspiciousDrop) overschrijft het vorige
// bestand niet. Duurt ze langer dan zoveel dagen, dan is ze echt en wordt toch geschreven (net als de
// herkenning zelf, KRIMP_DAGEN in lib/parcours-herkenning-refresh.mjs). AGENDA_ALLOW_DROP laat ze meteen door.
export const KRIMP_DAGEN = 3;
// Besluiten over één vaste plek (een buurtfeest van het Districtsfonds, een muziekactiviteit op een adres)
// horen bij hoogstens één dossier, en alleen als die straat de eigen plek van het dossier is.
export const PLAATSGEBONDEN_BESLUITEN = Object.freeze(["districtsfonds", "muziek"]);
// Ontdubbelen alleen met deze bronnen (plan P2); eBesluit (P3a) via de koppeling van het besluit.
export const ONTDUBBEL_BRONNEN = Object.freeze(["district-kalender", "district-nieuws"]);
export const BESLUIT_ITEMS_BRON = "district-ebesluit-evenementen";
// Een speelstraat: alleen het trefwoord in het dossier zelf, zodat ze vanzelf verschijnen zodra de stad
// ze in A-Sign zet.
export const SPEELSTRAAT = /\bspeelstra(?:at|ten)\b/i;

// Korte soort voor een titel, per sleutel uit SOORTEN in lib/parcours-herkenning.mjs.
export const SOORT_LABELS = Object.freeze({
  student: "Studentenactiviteit", school: "Schoolactiviteit", herdenking: "Herdenking", sint: "Sinterklaasstoet of -feest",
  halloween: "Halloween-activiteit", winkel: "Winkelevenement", wieler: "Wielerwedstrijd", fiets: "Fietstocht", wandel: "Wandeling",
  loop: "Loopwedstrijd of loop", stoet: "Stoet", tocht: "Tocht", haltes: "Tocht te voet langs haltes", buurtfeest: "Buurtfeest",
  markt: "Markt", speelstraat: "Speelstraat",
});
const SPORT_SOORTEN = new Set(["wieler", "fiets", "loop"]);
const SPORT = /marathon|\bhalve?\b|\w*run\b|\bloop\b|race\b|trail|wedstrijd|criterium|wieler|koers|fiets|triatlon|zwem|walk\b|3x3|basket|voetbal|hockey|tennis|(?<!tran)sport|kampioenschap/i;

const clean = (v, max = 300) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const uniek = (rows) => [...new Set(rows.map((v) => clean(v, 120)).filter(Boolean))];
const isDag = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const plusDagen = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dagenTussen = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
const capital = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : "");
const joinNl = (list) => (list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} en ${list.at(-1)}`);
// Fasen in de volgorde waarin ze gebeuren (zoals site/kaart-uitleg.js): opbouw, het evenement, afbraak.
const FASE_RANG = Object.freeze({ opbouw: 0, evenement: 1, afbraak: 2 });
const faseRang = (naam) => FASE_RANG[String(naam ?? "").toLowerCase()] ?? 3;
const sorteerFasen = (fasen = []) => [...fasen].sort((a, b) => faseRang(a.naam) - faseRang(b.naam) || a.start.localeCompare(b.start) || a.naam.localeCompare(b.naam, "nl"));
const geenTunnel = (naam) => Boolean(naam) && !isTunnel(naam);
const leesJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
const zin = (t) => { const s = clean(t, 600); return s ? `${capital(s)}${/[.!?]$/.test(s) ? "" : "."}` : ""; };

// ---------- feiten per dossier ----------

// De feiten die een agendapunt nodig heeft, uit een dossier zoals de parcoursherkenning het verrijkt
// (dossiersUitAsign + verrijk in lib/parcours-herkenning.mjs). index: de straatas van de site
// (site/street-core.js); zonder index geen straten, en dan haalt alleen een naam of soort de lijst.
// Vrije tekst uit A-Sign gaat niet mee: alleen of het trefwoord "speelstraat" erin staat.
// grens: de districtsgrens (GeoJSON-geometrie) voor het deel van de route binnen het district.
export function dossierFeiten(d = {}, { index = null, grens = null } = {}) {
  const innames = Array.isArray(d.innames) ? d.innames : [];
  const vanSoort = (re) => innames.filter((i) => re.test(clean(i?.type, 80)) && i?.geometry);
  const straten = (lijst) => (index?.segments?.length && lijst.length ? stratenVanParcours(parcoursGeometrie(lijst), index).langs : []);
  const langs = straten(vanSoort(/parcours/i)), zone = straten(vanSoort(/verkeersvrij/i));
  const begin = geenTunnel(clean(d.beginStraat, 120)) ? clean(d.beginStraat, 120) : "";
  return {
    dossier: clean(d.dossier, 40),
    status: clean(d.status, 60),
    // De dag van de laatste wijziging in A-Sign (niet de dag van de verversing: dan zou elk item elke
    // ochtend veranderen).
    bijgewerkt: isDag(d.bijgewerkt) ? d.bijgewerkt : "",
    binnenDistrict: d.binnenDistrict === true,
    aandeelInDistrict: grens ? aandeelBinnen(d.vorm, grens) : 1,
    fasen: sorteerFasen((Array.isArray(d.fasen) ? d.fasen : []).filter((f) => f?.naam && isDag(f.start))
      .map((f) => ({ naam: clean(f.naam, 40), start: f.start, eind: isDag(f.eind) && f.eind >= f.start ? f.eind : f.start }))),
    dagen: uniek(Array.isArray(d.dagen) ? d.dagen : []).filter(isDag).sort(),
    langs,
    zone,
    // Een tunnel is nooit "de straat" van een evenement (de Jos Brabantstunnel onder een stoet).
    // De eigen plekken van het dossier (begin, einde, innames), ook voor de koppeling met een besluit.
    kernStraten: uniek([d.beginStraat, d.eindStraat, ...(Array.isArray(d.kernStraten) ? d.kernStraten : [])]).filter(geenTunnel),
    beginStraat: titelStraat(begin, [...langs, ...zone], d.vorm, index),
    wijk: clean(d.wijk, 80),
    postcodes: uniek(Array.isArray(d.postcodes) ? d.postcodes : []).filter((p) => DISTRICT_POSTCODES.includes(p)).sort(),
    speelstraat: (Array.isArray(d.beschrijvingen) ? d.beschrijvingen : []).some((t) => SPEELSTRAAT.test(String(t ?? ""))),
    // Alleen voor het ontdubbelen (afstand tot een agendapunt); gaat nooit mee in een item.
    vorm: d.vorm ? { index: d.vorm.index || null, kern: Array.isArray(d.vorm.kern) ? d.vorm.kern : [] } : null,
  };
}

// De straat van het beginpunt is alleen de titelstraat als de route er ook door loopt. Begint een parcours
// aan een kruispunt (het beginpunt ligt het dichtst bij de dwarsstraat), dan de straat van de route die het
// dichtst bij het beginpunt ligt. Zonder route of zonder straatas: de straat van het beginpunt.
function titelStraat(begin, route, vorm, index) {
  if (!begin || !route.length || route.includes(begin)) return begin;
  const punt = vorm?.start || vorm?.kern?.[0];
  return nearbyStreets(punt, index, { maxDistanceMeters: 300, count: Infinity }).find((s) => route.includes(s.name) && geenTunnel(s.name))?.name || "";
}

// Alle straten van een dossier, de hoofdstraat eerst: waar het begint, dan het parcours, de zone en de
// andere innames. voorkeur: straten die eerst moeten (de plaats uit een gekoppeld besluit), als het dossier
// ze heeft.
export function stratenVan(f = {}, voorkeur = []) {
  const alle = uniek([...(f.langs || []), ...(f.zone || []), ...(f.kernStraten || [])]);
  const eerst = uniek(Array.isArray(voorkeur) ? voorkeur : []).map((v) => alle.find((s) => plat(s) === plat(v))).filter(Boolean);
  const kop = uniek([...eerst, hoofdstraat(f)]);
  return [...kop, ...alle.filter((s) => !kop.includes(s))];
}
export function hoofdstraat(f = {}) {
  return [clean(f.beginStraat, 120), ...(f.langs || []), ...(f.zone || []), ...(f.kernStraten || [])].find(geenTunnel) || "";
}
// "op de Meir", "in de Kerkstraat", anders de wijk of het district.
function plekTekst(f) {
  const straat = hoofdstraat(f);
  if (straat) return opStraat(straat);
  return f.wijk ? `in ${f.wijk}` : "in district Antwerpen";
}

// ---------- besluiten van eBesluit (P3a) ----------

const binnenEenDag = (a, b) => isDag(a) && isDag(b) && Math.abs(dagenTussen(a, b)) <= 1;
function fase(f, naam) { return (f.fasen || []).find((x) => plat(x.naam) === plat(naam)) || null; }

// Hoe raakt een dossier de straten van een besluit? "anker": een eigen plek van het dossier (het begin,
// het einde of een inname) ligt in een straat van het besluit; "route": het parcours of de zone loopt er
// alleen door (een stoet die de straat van een buurtfeest kruist); anders "".
function plaatsVan(f, besluitStraten) {
  if (!besluitStraten.size) return "";
  if ((f.kernStraten || []).some((s) => besluitStraten.has(plat(s)))) return "anker";
  if ([...(f.langs || []), ...(f.zone || [])].some((s) => besluitStraten.has(plat(s)))) return "route";
  return "";
}

// Welk besluit hoort bij welk dossier? { dossier → besluit }. Alleen goedgekeurde, gelezen besluiten met
// een naam, dagen en een plaats in het district (wordtAgendapunt), niet vervangen of ingetrokken.
//   - plaats, en dan een gemeenschappelijke evenementdag:
//       * een besluit over één vaste plek (PLAATSGEBONDEN_BESLUITEN: Districtsfonds, muziekactiviteit):
//         alleen het ene dossier dat daar zijn eigen plek heeft ("anker"). Twee zulke dossiers, of alleen
//         een stoet die er doorloopt: geen naam;
//       * een evenementbesluit (College): de dossiers met hun eigen plek in die straat (een groot
//         evenement heeft er soms meer: startzone en parcours; ze worden één agendapunt), anders het enige
//         dossier waarvan de route door die straat loopt (de Marathon begint aan de kaai uit het besluit);
//   - zonder plaats: dezelfde opbouw- en afbouwdag (op 1 dag na), alleen als het besluit bij geen enkel
//     dossier op zijn plaats past, en dan alleen bij precies één dossier. Een evenement van één dag
//     zonder plaats krijgt zo nooit een naam.
// Alleen dossiers met een echte evenementfase (geldigeEvenementFase) doen mee.
// Twee besluiten met een andere naam bij één dossier: geen naam (twijfel).
export function koppelBesluiten(feiten = [], besluiten = []) {
  const lijst = Array.isArray(besluiten) ? besluiten.filter((b) => b && typeof b === "object") : [];
  const vervangen = vervangenBesluiten(lijst);
  const bruikbaar = lijst.filter((b) => !vervangen.has(b) && wordtAgendapunt(b));
  const perDossier = new Map();
  const zonderPlaats = new Map();
  const metPlaats = new Set();
  for (const b of bruikbaar) {
    const besluitStraten = new Set((b.straten || []).map(plat).filter((s) => s.length >= 4));
    const anker = [], route = [];
    for (const f of feiten) {
      if (!f?.binnenDistrict || AFGEWEZEN.includes(f.status)) continue;
      const dagen = new Set(f.dagen || []);
      if (!geldigeEvenementFase(f) || !b.dagen.some((x) => dagen.has(x))) continue;
      const plaats = plaatsVan(f, besluitStraten);
      const op = fase(f, "Opbouw"), af = fase(f, "Afbraak");
      const fasen = Boolean(b.opbouw && b.afbouw && op && af && binnenEenDag(b.opbouw, op.start) && binnenEenDag(b.afbouw, af.eind));
      if (plaats === "anker") anker.push(f.dossier);
      else if (plaats === "route") route.push(f.dossier);
      else if (fasen) zonderPlaats.set(b, [...(zonderPlaats.get(b) || []), f.dossier]);
    }
    if (anker.length || route.length) metPlaats.add(b);
    const gekozen = PLAATSGEBONDEN_BESLUITEN.includes(b.soort)
      ? (anker.length === 1 ? anker : [])
      : (anker.length ? anker : route.length === 1 ? route : []);
    for (const dossier of gekozen) perDossier.set(dossier, [...(perDossier.get(dossier) || []), b]);
  }
  // Zonder plaats alleen als het besluit nergens op zijn plaats past en precies één dossier dezelfde
  // opbouw en afbouw heeft (een tweede dossier op die dagen kan iets anders zijn).
  for (const [b, dossiers] of zonderPlaats) {
    if (metPlaats.has(b) || dossiers.length !== 1) continue;
    perDossier.set(dossiers[0], [...(perDossier.get(dossiers[0]) || []), b]);
  }
  const uit = new Map();
  for (const [dossier, kandidaten] of perDossier) {
    const namen = new Set(kandidaten.map((b) => plat(b.naam)));
    if (namen.size !== 1) continue;
    // Bij gelijke naam: een evenementbesluit eerst, dan het jongste.
    const rang = { evenement: 0, districtsfonds: 1, muziek: 2 };
    const [b] = [...kandidaten].sort((x, y) => (rang[x.soort] ?? 3) - (rang[y.soort] ?? 3) || String(y.zitting ?? "").localeCompare(String(x.zitting ?? "")));
    uit.set(dossier, b);
  }
  return uit;
}

// ---------- titel ----------

// Soort voor de titel: speelstraat (trefwoord in het dossier zelf), anders uit de fiche (hand of
// automatisch, met een soort uit de vaste lijst). Een soort die niet in de lijst staat: het eerste stuk van
// de handfiche. { sleutel, label, zeker, bron: dossier | hand | auto, methode }: een soort met zekerheid
// "waarschijnlijk" (de automatische herkenning leidt ze af uit de plek, de periode en vroegere dossiers)
// is een vermoeden, geen feit.
function soortVan(f, hand, auto) {
  if (f.speelstraat) return { sleutel: "speelstraat", label: SOORT_LABELS.speelstraat, zeker: true, bron: "dossier", methode: "" };
  for (const fiche of [hand, auto]) {
    if (!fiche || !clean(fiche.soort) || !["zeker", "waarschijnlijk"].includes(fiche.zekerheid)) continue;
    const kenmerken = { zeker: fiche.zekerheid === "zeker", bron: fiche === hand ? "hand" : "auto", methode: clean(fiche.methode, 20) };
    const sleutel = eersteSoort([fiche.soort]);
    if (sleutel && SOORT_LABELS[sleutel]) return { sleutel, label: SOORT_LABELS[sleutel], ...kenmerken };
    if (fiche === hand) {
      const kort = clean(zonderNummers(fiche.soort, 200).split(/[:;,(]/)[0].replace(/^(?:een|de|het)\s+/i, ""), 60);
      if (kort.length >= 4) return { sleutel: "", label: capital(kort), ...kenmerken };
    }
  }
  return null;
}
// "een studentenactiviteit", "een Halloween-activiteit" (een eigennaam blijft met een hoofdletter).
const eenSoort = (label) => `een ${/^Halloween/.test(label) ? label : `${label.charAt(0).toLowerCase()}${label.slice(1)}`}`;

// { titel, herkomst, naam, soort, sleutel }. herkomst: handfiche | automatisch | besluit | soort | naam-volgt.
export function titelVan(f, { hand = null, auto = null, besluit = null } = {}) {
  const naam = (t) => clean(zonderNummers(t, 160), 160);
  const soort = soortVan(f, hand, auto);
  const sleutel = soort?.sleutel || "";
  if (hand && naam(hand.naam) && hand.zekerheid !== "onbekend") {
    const n = naam(hand.naam);
    return { titel: hand.zekerheid === "waarschijnlijk" ? `Vermoedelijk ${n}` : n, eigenNaam: n, herkomst: "handfiche", naam: true, sleutel };
  }
  if (auto && naam(auto.naam) && ["zeker", "waarschijnlijk"].includes(auto.zekerheid)) {
    const n = naam(auto.naam);
    return { titel: auto.zekerheid === "zeker" ? n : `Vermoedelijk ${n}`, eigenNaam: n, herkomst: "automatisch", naam: true, sleutel, zeker: auto.zekerheid === "zeker" };
  }
  if (besluit && naam(besluit.naam)) {
    const n = naam(besluit.naam);
    return { titel: n, eigenNaam: n, herkomst: "besluit", naam: true, sleutel };
  }
  if (soort) {
    const titel = soort.zeker ? `${soort.label} ${plekTekst(f)}` : `Vermoedelijk ${eenSoort(soort.label)} ${plekTekst(f)}`;
    return { titel, eigenNaam: "", herkomst: "soort", soort: true, sleutel, soortZeker: soort.zeker, soortBron: soort.bron, soortMethode: soort.methode };
  }
  return { titel: `Evenement ${plekTekst(f)} — naam volgt`, eigenNaam: "", herkomst: "naam-volgt", sleutel: "" };
}

// Haalt het dossier de districtslijst? Een naam, een parcours of zone over MIN_STRATEN straten, of een
// soort met een straat of een wijk. Een soort zonder plek ("Studentenactiviteit in district Antwerpen")
// zegt niets over een straat: die blijft op de plekpagina.
export function inDeLijst(f, titel) {
  if (titel?.naam || (f.langs || []).length >= MIN_STRATEN || (f.zone || []).length >= MIN_STRATEN) return true;
  return Boolean(titel?.soort && (hoofdstraat(f) || f.wijk));
}

// ---------- dagen, uren, tekst ----------

// De evenementdagen: die van de handfiche (met de hand nagekeken) gaan voor op die uit A-Sign. Een
// dossier met fasen maar zonder fase "Evenement" (alleen opbouw), of met een evenementfase van meer dan
// MAX_EVENEMENT_DAGEN dagen, heeft geen evenementdagen.
export function evenementDagen(f, hand = null) {
  const handDagen = Array.isArray(hand?.dagen) ? hand.dagen.filter(isDag) : [];
  if (handDagen.length) return uniek(handDagen).sort();
  if (!geldigeEvenementFase(f)) return [];
  return uniek(f.dagen || []).filter(isDag).sort();
}
export function geldigeEvenementFase(f = {}) {
  const fasen = Array.isArray(f.fasen) ? f.fasen : [];
  if (!fasen.length) return true;
  const ev = fase(f, "Evenement");
  return Boolean(ev) && dagenTussen(ev.start, ev.eind) < MAX_EVENEMENT_DAGEN;
}
// Per dag een agendapunt; meer dan MAX_DAGEN_APART dagen: per doorlopende reeks.
export function perioden(dagen = []) {
  if (dagen.length <= MAX_DAGEN_APART) return dagen.map((d) => [d, null]);
  const reeksen = [];
  for (const dag of dagen) {
    const laatste = reeksen.at(-1);
    if (laatste && plusDagen(laatste[1] || laatste[0], 1) === dag) laatste[1] = dag;
    else reeksen.push([dag, null]);
  }
  return reeksen;
}

const UUR_REEKS = /^(\d{1,2})(?:[.:u](\d{2}))?\s*(?:uur\s*)?(?:tot|-|–)\s*(\d{1,2})(?:[.:u](\d{2}))?\s*uur$/i;
const hhmm = (u, m) => `${String(Number(u)).padStart(2, "0")}:${m || "00"}`;
const tijdPunt = (u) => `${Number(u.slice(0, 2))}${u.slice(3) === "00" ? "" : `.${u.slice(3)}`}`;
// Uren, in de volgorde van de titel: de handfiche (met de hand nagekeken, vaak uitgebreider), dan een
// gekoppeld besluit (alleen op een dag van dat besluit), dan de automatische fiche. Een begin-uur
// ("timeSlot") alleen bij een eenduidige reeks ("11 tot 18.30 uur") die na het begin eindigt, of uit het
// besluit; anders "Info" met de tekst. Geeft de handfiche geen eenduidige reeks ("start om 9 uur, finish
// om 18 uur"), dan komt het beginuur uit het besluit, als de tekst van de fiche dat uur zelf noemt en geen
// andere reeks geeft; de tekst blijft die van de fiche.
const ficheUren = (fiche) => {
  const tekst = clean(zonderNummers(fiche.uren, 200), 200);
  const m = tekst.match(UUR_REEKS);
  if (m) {
    const start = hhmm(m[1], m[2]), einde = hhmm(m[3], m[4]);
    if (Number(m[1]) < 24 && Number(m[3]) < 24 && einde > start) return { timeSlot: start, timeText: tekst };
  }
  return { timeSlot: "Info", timeText: tekst };
};
// Noemt de tekst dit uur ("om 9 uur", "9u", "9.30 uur" bij 09:30)? Niet als deel van een ander getal ("19 uur").
function noemtUur(tekst, hhmm) {
  const [uur, minuten] = String(hhmm).split(":");
  const na = minuten === "00" ? "(?:[.:u]00)?" : `[.:u]${minuten}`;
  return new RegExp(`(?<![\\d.:])0?${Number(uur)}${na}\\s*(?:uur|u)\\b`, "i").test(tekst);
}
export function urenVan({ hand = null, auto = null, besluit = null, dag = "" } = {}) {
  const vanBesluit = besluit?.uren?.start && (besluit.dagen || []).includes(dag) ? besluit.uren : null;
  if (hand && clean(hand.uren)) {
    const uren = ficheUren(hand);
    if (uren.timeSlot === "Info" && vanBesluit && noemtUur(uren.timeText, vanBesluit.start)
      && parseEventTimes(vanBesluit.start, uren.timeText).status !== "range_confirmed") return { timeSlot: vanBesluit.start, timeText: uren.timeText };
    return uren;
  }
  if (vanBesluit) {
    const { start, einde } = besluit.uren;
    if (einde && einde > start) return { timeSlot: start, timeText: `${tijdPunt(start)} tot ${tijdPunt(einde)} uur` };
    return { timeSlot: start, timeText: `vanaf ${tijdPunt(start)} uur` };
  }
  if (auto && clean(auto.uren) && ["zeker", "waarschijnlijk"].includes(auto.zekerheid)) return ficheUren(auto);
  return { timeSlot: "Info", timeText: "" };
}

// "Meir, Groenplaats en Schoenmarkt" of "Meir, Groenplaats, Schoenmarkt en 35 andere straten". voorkeur:
// zie stratenVan() (de plaats uit een gekoppeld besluit vooraan, zoals de kaai waar de Marathon start).
export function locatieVan(f, voorkeur = []) {
  const straten = stratenVan(f, voorkeur);
  if (!straten.length) return f.wijk ? `${f.wijk}, district Antwerpen` : "district Antwerpen";
  if (straten.length <= 3) return clean(joinNl(straten), 300);
  return clean(`${straten.slice(0, 3).join(", ")} en ${straten.length - 3} andere straten`, 300);
}

const opsomming = (lijst, max = 6) => (lijst.length <= max ? joinNl(lijst) : `onder meer ${lijst.slice(0, 4).join(", ")}`);
// "Parcours in de Kerkstraat.", "Parcours door 12 straten: onder meer ..." of "Verkeersvrije zone in 3 straten: ...".
const stratenZin = (wat, lijst, voorzetsel) => (lijst.length === 1 ? `${wat} ${opStraat(lijst[0])}.` : `${wat} ${voorzetsel} ${lijst.length} straten: ${opsomming(lijst)}.`);
function infoVan(f, { titel, hand, auto, besluit, dagen, vandaag, organisator }) {
  const delen = [];
  // Wat er op straat gebeurt: de straten van het parcours en de zone (nooit de tekst van de inname).
  if (f.langs?.length) delen.push(stratenZin("Parcours", f.langs, "door"));
  if (f.zone?.length) delen.push(stratenZin("Verkeersvrije zone", f.zone, "in"));
  if (dagen.length > 1) {
    const reeks = dagenTussen(dagen[0], dagen.at(-1)) === dagen.length - 1;
    delen.push(`Evenement ${reeks ? (dagen.length === 2 ? `op ${dagenTekst(dagen[0], dagen[1], vandaag)}` : dagenTekst(dagen[0], dagen.at(-1), vandaag)) : `op ${joinNl(dagen.map((d) => datumTekst(d)))}`}.`);
  }
  // Opbouw en afbraak alleen als ze buiten de evenementdagen vallen (anders zeggen ze niets nieuws).
  const op = fase(f, "Opbouw"), af = fase(f, "Afbraak");
  const opbouw = op && dagen.length && op.start < dagen[0] ? `opbouw vanaf ${dagTekst(op.start, vandaag)}` : "";
  const afbraak = af && dagen.length && af.eind > dagen.at(-1) ? `afbraak tot ${dagTekst(af.eind, vandaag)}` : "";
  if (opbouw || afbraak) delen.push(zin([opbouw, afbraak].filter(Boolean).join(", ")));
  if (organisator) delen.push(`Organisatie: ${organisator}.`);
  if (titel.herkomst === "handfiche") delen.push("Naam met de hand nagekeken bij een publieke bron.");
  else if (titel.herkomst === "automatisch") {
    const via = AUTO_HERKOMST[clean(auto?.methode, 20)] || "een publieke bron";
    delen.push(titel.zeker ? `Naam automatisch herkend via ${via}.` : `Naam vermoed via ${via}; niet bevestigd.`);
  } else if (titel.herkomst === "besluit") delen.push("Naam uit een goedgekeurd besluit in eBesluit (zelfde dag en plaats).");
  else if (titel.herkomst === "soort") delen.push(soortZin(titel));
  else delen.push("De stad publiceert bij dit dossier geen naam; die volgt zodra een besluit, een kalender of de organisator hem noemt.");
  // De stand van de aanvraag, met de dag van de laatste wijziging in A-Sign (niet de dag van de
  // verversing: die staat al in retrievedAt, en dan zou elk item elke ochtend veranderen).
  const stand = GOEDGEKEURD.includes(f.status) ? "aanvraag goedgekeurd" : "aanvraag nog niet goedgekeurd";
  const gewijzigd = f.bijgewerkt ? `, laatst gewijzigd op ${datumTekst(f.bijgewerkt, { jaar: true })}` : "";
  delen.push(`Evenementendossier ${f.dossier} van de stad (A-Sign)${gewijzigd}: ${stand}.`);
  // Wat niet past, valt weg (de stand en het dossier blijven altijd staan).
  const vast = delen.pop();
  let tekst = "";
  for (const deel of delen) if (`${tekst} ${deel} ${vast}`.trim().length <= 600) tekst = `${tekst} ${deel}`.trim();
  return clean(zonderNummers(`${tekst} ${vast}`, 600), 600);
}

// Waar de soort vandaan komt: het trefwoord in het dossier zelf, een fiche die ze zeker weet, of een
// vermoeden (de regels van de herkenning: plek, periode, vroegere dossiers) dat niet bevestigd is.
function soortZin(titel) {
  const naamVolgt = "de naam volgt zodra een besluit, een kalender of de organisator hem noemt.";
  if (titel.soortBron === "dossier") return `De soort staat in het dossier; ${naamVolgt}`;
  if (titel.soortBron === "hand") {
    return titel.soortZeker ? `Soort met de hand nagekeken bij een publieke bron; ${naamVolgt}` : `Soort vermoed bij het nakijken met de hand; niet bevestigd. ${capital(naamVolgt)}`;
  }
  const via = AUTO_HERKOMST[titel.soortMethode] || "een publieke bron";
  return titel.soortZeker ? `Soort automatisch herkend via ${via}; ${naamVolgt}` : `Soort vermoed via ${via}; niet bevestigd. ${capital(naamVolgt)}`;
}

function organisatorVan(hand, auto, besluit) {
  for (const naam of [hand?.organisator, auto?.zekerheid === "zeker" ? auto?.organisator : "", besluit?.organisator]) {
    const kort = clean(naam, 160).replace(/[,;:\s]+$/, "");
    if (kort && organisatorToegelaten(kort) && !naamMetHuisnummer(kort)) return kort.slice(0, 120);
  }
  return "";
}

// ---------- ontdubbelen met de kalender en het nieuws ----------

// Agendapunten van de kalender en het nieuws als kandidaten (lib/parcours-herkenning.mjs filtert al
// vergaderingen, markten en reeksen van weken weg). puntVan: de geocodecache (site/geo/locaties.json).
export function dubbelKandidaten(items = [], { puntVan = () => null } = {}) {
  const uit = [];
  for (const item of items) {
    const k = kandidaatUitAgenda(item, { puntVan });
    if (k && typeof item?.id === "string") uit.push({ ...k, id: item.id });
  }
  return uit;
}
const indexCache = new WeakMap();
function vormIndex(f) {
  if (!f.vorm) return null;
  if (indexCache.has(f.vorm)) return indexCache.get(f.vorm);
  const index = f.vorm.index || maakIndex({ lijnen: f.vorm.lijnen || [], vlakken: f.vorm.vlakken || [] });
  const kern = maakIndex({ lijnen: (f.vorm.kern || []).map((p) => [p, p]) });
  const uit = { index, kern };
  indexCache.set(f.vorm, uit);
  return uit;
}
// Is kandidaat k op dag `dag` hetzelfde als dit dossier? Zelfde dag, en een straat van het dossier in de
// plaats of titel, of een punt hoogstens DUBBEL_METER van de route of een inname, of dezelfde eigen naam.
// Nooit bij twee eigen namen die niet op elkaar lijken, of twee soorten die botsen.
export function isDubbel(f, titel, k, dag) {
  if (!isDag(dag) || dag < k.dag || dag > (k.eind || k.dag)) return false;
  if (titel?.eigenNaam && !zelfdeTitel(titel.eigenNaam, k.titel)) return false;
  // Dezelfde eigen naam op dezelfde dag ("Parade Noorderlicht" en "Noorderlicht"): hetzelfde, ook als
  // de kalender alleen een postcode als plaats geeft.
  if (titel?.eigenNaam && zelfdeTitelStreng(titel.eigenNaam, k.titel)) return true;
  const soortK = eersteSoort([k.titel]);
  if (titel?.sleutel && titel.sleutel !== "speelstraat" && soortK && !soortPast(titel.sleutel, soortK)) return false;
  const tekst = ` ${plat(`${k.locatie} ${k.titel}`)} `;
  if (stratenVan(f).some((s) => plat(s).length >= 5 && tekst.includes(` ${plat(s)} `))) return true;
  if (!k.punt) return false;
  const v = vormIndex(f);
  if (!v) return false;
  return Math.min(afstandTot(v.index, k.punt, DUBBEL_METER), afstandTot(v.kern, k.punt, DUBBEL_METER)) <= DUBBEL_METER;
}

// ---------- alles samen ----------

const sportOf = (titel) => SPORT_SOORTEN.has(titel.sleutel) || (titel.naam && SPORT.test(titel.eigenNaam));

// Agendapunten (bronitems) uit de feiten. hand/auto: de documenten evenement-identiteit(-auto).json;
// besluiten: de besluiten uit evenement-besluiten.json; besluitItems: de items van
// district-ebesluit-evenementen.json; kalender: de items van de districtskalender en het districtsnieuws.
// Geeft { items, tellers }.
export function asignAgendapunten({
  feiten = [], hand = null, auto = null, besluiten = [], besluitItems = [], kalender = [], vandaag, retrievedAt, puntVan = () => null,
} = {}) {
  if (!isDag(vandaag)) throw new Error("vandaag ontbreekt");
  const tot = plusDagen(vandaag, VOORUIT_DAGEN);
  const handD = hand?.dossiers || {}, autoD = auto?.dossiers || {};
  // Raakt het dossier het district alleen aan de rand? Een handfiche beslist (binnenDistrict, met de hand
  // nagekeken); anders het deel van de route binnen de grens.
  const aanDeRand = (f) => {
    const h = handD[f.dossier];
    return typeof h?.binnenDistrict === "boolean" ? !h.binnenDistrict : (f.aandeelInDistrict ?? 1) < MIN_AANDEEL_DISTRICT;
  };
  const koppeling = koppelBesluiten(feiten.filter((f) => f?.dossier && !aanDeRand(f)), besluiten);
  const kandidaten = dubbelKandidaten(kalender, { puntVan });
  const tellers = { dossiers: feiten.length, buitenDistrict: 0, aanDeRand: 0, afgewezen: 0, geenEvenementfase: 0, buitenVenster: 0, nietInLijst: 0, inLijst: 0, metNaam: 0, metSoort: 0, naamVolgt: 0, nietGoedgekeurd: 0, ontdubbeld: 0, samengevoegd: 0 };
  const kandidaatItems = [];
  for (const f of [...feiten].sort((a, b) => String(a.dossier).localeCompare(String(b.dossier)))) {
    if (!f?.dossier || !f.binnenDistrict) { tellers.buitenDistrict += 1; continue; }
    if (AFGEWEZEN.includes(f.status)) { tellers.afgewezen += 1; continue; }
    if (aanDeRand(f)) { tellers.aanDeRand += 1; continue; }
    const h = handD[f.dossier] || null, a = autoD[f.dossier] || null, b = koppeling.get(f.dossier) || null;
    if (!(Array.isArray(h?.dagen) && h.dagen.some(isDag)) && !geldigeEvenementFase(f)) { tellers.geenEvenementfase += 1; continue; }
    const alleDagen = evenementDagen(f, h);
    // Per dag, of per reeks bij een lang dossier (beslist op alle dagen, niet alleen die in het venster).
    const reeksen = perioden(alleDagen).filter(([start, eind]) => (eind || start) >= vandaag && start <= tot);
    if (!reeksen.length) { tellers.buitenVenster += 1; continue; }
    const titel = titelVan(f, { hand: h, auto: a, besluit: b });
    if (!inDeLijst(f, titel)) { tellers.nietInLijst += 1; continue; }
    tellers.inLijst += 1;
    if (titel.naam) tellers.metNaam += 1; else if (titel.soort) tellers.metSoort += 1; else tellers.naamVolgt += 1;
    if (!GOEDGEKEURD.includes(f.status)) tellers.nietGoedgekeurd += 1;
    const organisator = organisatorVan(h, a, b);
    const info = infoVan(f, { titel, hand: h, auto: a, besluit: b, dagen: alleDagen, vandaag, organisator });
    const sport = sportOf(titel);
    const infoUrl = publiekeLink(h?.link || "") || publiekeLink(a?.link || "") || publiekeLink(b?.bron || "");
    // De plaats uit een gekoppeld besluit vooraan (waar het evenement volgens de stad plaatsvindt).
    const voorkeur = Array.isArray(b?.straten) ? b.straten : [];
    const straten = stratenVan(f, voorkeur).slice(0, MAX_STRATEN);
    const location = locatieVan(f, voorkeur);
    // Samenvoegen op titel alleen als die titel iets eigens zegt: een eigen naam of een straat. Twee
    // dossiers "Studentenactiviteit in district Antwerpen" op één dag zijn niet hetzelfde.
    const opTitel = Boolean(titel.eigenNaam || hoofdstraat(f));
    for (const [date, endDate] of reeksen) {
      const sameAs = new Set();
      for (const k of kandidaten) if (isDubbel(f, titel, k, date)) sameAs.add(k.id);
      if (b) for (const item of besluitItems) {
        if (item?.externalId === (b.code || b.id) && date >= item.date && date <= (item.endDate || item.date)) sameAs.add(item.id);
      }
      if (sameAs.size) tellers.ontdubbeld += 1;
      const item = {
        id: `${ID_PREFIX}${f.dossier.toLowerCase()}-${date}`,
        externalId: f.dossier,
        title: clean(titel.titel, 200),
        theme: sport ? "Sport" : "Activiteit",
        className: sport ? "sport" : "activity",
        date,
        endDate,
        ...urenVan({ hand: h, auto: a, besluit: b, dag: date }),
        location,
        postcodes: f.postcodes || [],
        info,
        ...(infoUrl ? { infoUrl } : {}),
        kind: "activity",
        sourceUrl: ASIGN_BRON,
        retrievedAt,
        reviewRequired: false,
        inDistrict: true,
        fasen: sorteerFasen(f.fasen || []).slice(0, 6),
        straten,
        ...(sameAs.size ? { sameAs: [...sameAs].sort().slice(0, MAX_SAME_AS) } : {}),
      };
      const sleutels = [...(opTitel ? [`titel|${plat(item.title)}|${date}`] : []), ...(b ? [`besluit|${b.code || b.id}|${date}`] : []), ...(item.sameAs || []).map((id) => `zelfde|${id}`)];
      kandidaatItems.push({ item, rang: titelRang(titel), sleutels });
    }
  }
  const items = samenVoegen(kandidaatItems, tellers).sort((x, y) => x.date.localeCompare(y.date) || x.id.localeCompare(y.id));
  return { items, tellers };
}

// Welke titel wint als twee dossiers samen één agendapunt worden: hand, zeker, besluit, vermoeden, soort,
// vermoede soort, naam volgt.
function titelRang(titel) {
  if (titel.herkomst === "handfiche") return titel.titel.startsWith("Vermoedelijk ") ? 3 : 0;
  if (titel.herkomst === "automatisch") return titel.zeker ? 1 : 3;
  if (titel.herkomst === "besluit") return 2;
  if (titel.herkomst === "soort") return titel.soortZeker ? 4 : 5;
  return 6;
}

// Twee dossiers op dezelfde dag met dezelfde titel, hetzelfde besluit of hetzelfde agendapunt van de
// kalender (een parcours en een zone van één evenement, twee zusterdossiers): één agendapunt. De beste
// titel wint; de straten en de koppelingen komen samen, en de tekst noemt het andere dossier. Via hetzelfde
// agendapunt van een andere bron kunnen ook dagen samenkomen (de drie dagen van een festival uit een
// besluit): dan beslaat het agendapunt de ruimste periode, van de eerste tot de laatste dag.
function samenVoegen(kandidaten, tellers) {
  const ouder = kandidaten.map((_, i) => i);
  const wortel = (i) => (ouder[i] === i ? i : (ouder[i] = wortel(ouder[i])));
  const eerste = new Map();
  kandidaten.forEach((k, i) => {
    for (const sleutel of k.sleutels) {
      if (!eerste.has(sleutel)) eerste.set(sleutel, i);
      else ouder[wortel(i)] = wortel(eerste.get(sleutel));
    }
  });
  const groepen = new Map();
  kandidaten.forEach((k, i) => groepen.set(wortel(i), [...(groepen.get(wortel(i)) || []), k]));
  const uit = [];
  for (const groep of groepen.values()) {
    const [hoofd, ...rest] = [...groep].sort((x, y) => x.rang - y.rang || x.item.id.localeCompare(y.item.id));
    const item = { ...hoofd.item };
    for (const ander of rest) {
      tellers.samengevoegd += 1;
      item.straten = uniek([...item.straten, ...ander.item.straten]).slice(0, MAX_STRATEN);
      if (ander.item.sameAs) item.sameAs = uniek([...(item.sameAs || []), ...ander.item.sameAs]).sort().slice(0, MAX_SAME_AS);
      const extra = ` Ook dossier ${ander.item.externalId}.`;
      if (item.info.length + extra.length <= 600 && !item.info.includes(ander.item.externalId)) item.info += extra;
    }
    const begin = groep.map((k) => k.item.date).sort()[0];
    const eind = groep.map((k) => k.item.endDate || k.item.date).sort().at(-1);
    item.date = begin;
    item.endDate = eind > begin ? eind : null;
    uit.push(item);
  }
  return uit;
}

// Het hele brondocument (lib/source-feed.mjs), na de privacyscan en het eventcontract (screenItems).
export function asignEvenementenDocument(opties = {}) {
  const { items, tellers } = asignAgendapunten(opties);
  const screened = screenItems(items);
  const document = sourceDocument(ASIGN_EVENEMENTEN_SOURCE_ID, { retrievedAt: opties.retrievedAt ?? null, fetchStatus: "ok", contentVersion: null, items: screened.items });
  return { document, tellers: { ...tellers, items: screened.items.length, afgekeurd: screened.rejected.privacy + screened.rejected.contract + screened.rejected.duplicate } };
}

// De errorCode bij een straatas die niet antwoordde (site/street-source.js): een tijdelijke fout (5xx,
// 429, time-out, netwerk) heet zoals bij een fetcher (isTransientErrorCode in lib/fetch-util.mjs), zodat
// één ochtend zonder straatas een waarschuwing is en geen fout; anders "straatas_ontbreekt".
export function straatasFoutCode(error) {
  const code = String(error?.code ?? "");
  if (isTransientErrorCode(code)) return code;
  const http = code.match(/http_(\d{3})$/);
  if (http) return `http_${http[1]}`;
  if (/timeout|abort/i.test(`${code} ${error?.name ?? ""}`)) return "timeout";
  if (error?.name === "TypeError") return "network_error";
  return "straatas_ontbreekt";
}

const ASIGN_ID = ASIGN_EVENEMENTEN_SOURCE_ID;
// Het vorige bestand blijft byte voor byte staan; de fout komt in refresh-status.json (met de vorige
// items en hun retrievedAt), zodat sources:health, de job source-health en de site ze zien.
function nietBijgewerkt({ rootDir, vorige, errorCode, log, extra = {} }) {
  log(JSON.stringify({ asignEvenementen: "niet bijgewerkt", errorCode, ...extra }));
  if (vorige) werkBronstatusBij(rootDir, { sourceId: ASIGN_ID, fetchStatus: "error", errorCode, document: vorige, log });
  return null;
}

// De herkenning zelf faalde (A-Sign onbereikbaar of gekrompen): de bron blijft zoals ze was, met de fout
// in refresh-status.json. Zonder vorig bestand is er niets te bewaren of te melden. Gooit nooit.
export function asignEvenementenNietBijgewerkt({ rootDir, errorCode = "unexpected_error", log = console.log } = {}) {
  try {
    const vorige = readSourceDocument(rootDir, ASIGN_ID);
    return vorige ? nietBijgewerkt({ rootDir, vorige, errorCode, log, extra: { stap: "herkenning" } }) : null;
  } catch {
    return null;
  }
}

// Inhaakpunt voor de verversing (na de parcoursherkenning): bouwt en schrijft
// site/sources/district-asign-evenementen.json en de regel van de bron in refresh-status.json. Blijft het
// vorige bestand staan (en meldt de regel "error"):
//   - zonder straatas (index leeg): geen straten, dus titels "in district Antwerpen" en dossiers die ten
//     onrechte samenvallen. straatasFout: de errorCode van de straatas (straatasFoutCode);
//   - bij een plotse krimp (suspiciousDrop: meer dan de helft minder komende items, of nul), tenzij het
//     vorige bestand al ouder is dan KRIMP_DAGEN dagen (dan is de krimp echt) of AGENDA_ALLOW_DROP ze toelaat;
//   - bij elke andere fout.
// De verversing zelf gaat altijd door.
export function schrijfAsignEvenementen({
  rootDir, dossiers = [], index = null, straatasFout = "", grens = null, hand = null, auto = null, vandaag, generatedAt, puntVan = () => null,
  env = process.env, log = console.log,
} = {}) {
  let vorige = null;
  try {
    vorige = readSourceDocument(rootDir, ASIGN_ID);
    if (!index?.segments?.length) return nietBijgewerkt({ rootDir, vorige, errorCode: straatasFout || "straatas_ontbreekt", log });
    const dir = path.join(rootDir, "site", "sources");
    const items = (bron) => { const doc = leesJson(path.join(dir, `${bron}.json`)); return Array.isArray(doc?.items) ? doc.items : []; };
    const besluitenDoc = leesJson(path.join(dir, EVENEMENT_BESLUITEN_FILE));
    const feiten = dossiers.filter((d) => d?.binnenDistrict === true).map((d) => dossierFeiten(d, { index, grens }));
    const { document, tellers } = asignEvenementenDocument({
      feiten, hand, auto, vandaag, retrievedAt: generatedAt, puntVan,
      besluiten: Array.isArray(besluitenDoc?.besluiten) ? besluitenDoc.besluiten : [],
      besluitItems: items(BESLUIT_ITEMS_BRON),
      kalender: ONTDUBBEL_BRONNEN.flatMap(items),
    });
    const krimp = vorige ? suspiciousDrop(vorige.items, document.items, vandaag) : null;
    if (krimp) {
      const telling = { upcomingBefore: krimp.before, upcomingAfter: krimp.after };
      const vorigeDag = String(vorige.retrievedAt ?? "").slice(0, 10);
      if (dropAllowed(env, ASIGN_ID)) log(JSON.stringify({ asignEvenementen: "krimp toegelaten", ...telling }));
      else if (isDag(vorigeDag) && dagenTussen(vorigeDag, vandaag) <= KRIMP_DAGEN) {
        return nietBijgewerkt({ rootDir, vorige, errorCode: "suspicious_drop", log, extra: telling });
      } else log(JSON.stringify({ asignEvenementen: "krimp aanvaard", ...telling, vorigeVersie: vorigeDag }));
    }
    writeSourceDocument(rootDir, ASIGN_ID, document);
    werkBronstatusBij(rootDir, { sourceId: ASIGN_ID, fetchStatus: "ok", document, log });
    log(JSON.stringify({ asignEvenementen: tellers }));
    return document;
  } catch (error) {
    return nietBijgewerkt({ rootDir, vorige, errorCode: errorCodeOf(error), log });
  }
}
