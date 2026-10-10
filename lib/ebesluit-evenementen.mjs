// eBesluit als naamgever en als bron voor evenementen (pakket P3, zoek- en leesdeel).
//
// Collegebesluiten noemen een evenement bij naam, met dag, uren, plaats, opbouw en afbouw:
//   - "Evenementen - <naam>. Organisatie - Goedkeuring" (college van burgemeester en schepenen, of een
//     districtscollege: "District Ekeren - Evenementen - Intrede Sinterklaas - Goedkeuring");
//   - "Toelating muziekactiviteit - <organisator>, voor <evenement>, <adres>, <postcode> <gemeente>";
//   - "Districtsfonds: beleef je buurt! - <aanvrager>. Toekenning en uitbetaling - Goedkeuring"
//     (district Antwerpen; activiteit, datum en plaats staan in een vaste tabel).
// Dit bestand zoekt die besluiten (eigen zoektermen, zodat de raadskalender van
// lib/ebesluit-discovery.mjs niet verandert), leest ze met vaste zinpatronen en maakt er agendapunten van
// voor besluiten met een plaats in district Antwerpen. Geen AI: alleen reguliere uitdrukkingen.
//
// Privacy (de repo is publiek):
//   - het blok "Samenstelling" (namen van aanwezigen) wordt uit de detailpagina geknipt vóór er iets
//     gelezen wordt; vrije tekst gaat nooit letterlijk mee, alleen velden uit vaste zinnen;
//   - een organisator of aanvrager alleen met een rechtsvorm (vzw, bv, nv, ...) of als publieke
//     instelling (stad, district, provincie, autonoom gemeentebedrijf, ...), nooit een
//     ondernemingsnummer, IBAN, adres van de aanvrager of de betaaltabel (Artikel 2);
//   - een plaats of naam nooit met huisnummer ("Noordersingel 28-30" wordt "Noordersingel"; "Feest,
//     Proefstraat 12. District Antwerpen" wordt naam "Feest" en plaats "Proefstraat, District Antwerpen");
//   - de volledige titel van een besluit wordt niet bewaard (een aanvrager zonder rechtsvorm staat erin).
//
// Een besluit dat een ouder besluit aanpast, rechtzet of intrekt ("Aanpassing data", "Intrekking -
// Bekrachtiging"), noemt dat oudere in het veld `vervangt`. Een intrekking of een nieuwe datum maakt het
// oude geen agendapunt meer; een rechtzetting van iets anders (bv. het geluidsniveau) laat de oude dagen staan
// (veld `wijziging`: "data", "andere" of null).
//
// Uitvoer (scripts/fetch-sources-ebesluit-evenementen.mjs):
//   - site/sources/evenement-besluiten.json: alle gelezen besluiten, ook die buiten het district. Dit
//     is tegelijk de cache per eBesluit-id (alleen nieuwe ids worden opgehaald) en de invoer voor de
//     koppelstap "besluit" in de parcoursherkenning (na de integratie van #144);
//   - site/sources/district-ebesluit-evenementen.json: agendapunten, alleen met een plaats in het district.
import { normalizeDecisionTitle } from "./civic-decision.mjs";
import { EBESLUIT_BASE, getHtml, rowsFromSearch, searchKeyword, textFromHtml } from "./ebesluit-discovery.mjs";
import { FetchError } from "./fetch-util.mjs";
import { addDaysIso, decodeEntities, isValidIsoDate } from "./html-text.mjs";
import { DISTRICT_POSTCODES } from "./postcodes.mjs";
import { privacyFindings } from "./source-feed.mjs";

export const EVENEMENT_BESLUITEN_FILE = "evenement-besluiten.json";
export const EBESLUIT_EVENEMENTEN_SOURCE_ID = "district-ebesluit-evenementen";
// Eigen zoektermen: de raadskalender (lib/ebesluit-discovery.mjs) zoekt alleen speelstraat, kermis, foor en markt.
export const EVENEMENT_ZOEKTERMEN = Object.freeze(["Evenementen", "muziekactiviteit", "Districtsfonds", "Intrede", "Halloween", "feestelijkheden"]);
// Venster op zittingsdatum: een besluit komt 2 tot 6 weken vooraf, een Districtsfonds soms maanden.
export const ZOEK_DAGEN_TERUG = 60;
export const ZOEK_DAGEN_VOORUIT = 120;
// Hoogstens zoveel detailpagina's per verversing (en niet langer dan DETAIL_TIJD_MS): de rest volgt de
// volgende ochtend, uit de cache verdwijnt niets.
export const MAX_DETAILS_PER_RUN = 100;
export const DETAIL_TIJD_MS = 150_000;
// Hoogstens 1 verzoek per seconde naar eBesluit.
export const MIN_INTERVAL_MS = 1_000;
// Een nieuwe versie van de zinpatronen leest alle besluiten opnieuw (binnen MAX_DETAILS_PER_RUN per keer).
// 2: naam zonder adres, "zal doorgaan", intrekkingen en aanpassingen (velden `wijziging` en `vervangt`).
export const LEESVERSIE = 2;
export const SOORTEN = Object.freeze(["evenement", "muziek", "districtsfonds"]);
export const STATUSSEN = Object.freeze(["goedkeuring", "weigering", "ingetrokken"]);
// Wat een aanpassing of rechtzetting wijzigt: de dagen ("Aanpassing data") of iets anders.
export const WIJZIGINGEN = Object.freeze(["data", "andere"]);

const MAANDEN = Object.freeze({ januari: 1, februari: 2, maart: 3, april: 4, mei: 5, juni: 6, juli: 7, augustus: 8, september: 9, oktober: 10, november: 11, december: 12 });
const MAAND = Object.keys(MAANDEN).join("|");
const WEEKDAG = "maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag";
// "18 oktober 2026", "zaterdag 3 en zondag 4 oktober 2026", "van 3 tot en met 5 oktober 2026",
// "31 oktober en 1 november 2026": één doorlopende reeks dagen.
const DAG_DEEL = String.raw`(?:(?:${WEEKDAG})\s+)?\d{1,2}(?:\s+(?:${MAAND}))?(?:\s+20\d{2})?`;
const DATUMREEKS = String.raw`(?:(?:van|vanaf)\s+)?${DAG_DEEL}(?:\s*(?:,|en|tot\s+en\s+met|t\.e\.m\.|tot|-|–)\s*${DAG_DEEL})*`;
const UUR = String.raw`(\d{1,2})(?:[.:u]\s?(\d{2}))?`;
// Een organisator telt alleen met een rechtsvorm op het einde, of als publieke instelling (geen privépersoon):
// "Stad Antwerpen", "District Borsbeek", "AG Culturele Instellingen Antwerpen/Kunsten", "FOMU".
const RECHTSVORM = /\b(?:vzw|v\.z\.w\.|ivzw|bv|bvba|nv|cv|cvba|commv|comm\.\s?v\.?|vof|asbl|aisbl|sa|srl)\.?$/i;
const PUBLIEKE_INSTELLING = /^(?:(?:[Ss]tad|[Dd]istrict|[Gg]emeente|[Pp]rovincie|OCMW|[Pp]olitiezone)\s+\p{Lu}|(?:AGB?|[Aa]utonoom [Gg]emeentebedrijf)\s+\S|(?:FOMU|MAS|M HKA|Zorgbedrijf Antwerpen)\b)/u;
// Een straatwoord met een huisnummer erachter ("Proefstraat 12", "Salesianenlaan 1", "Kaai 5-7"), niet
// met een jaartal of een dag ("Stadspark 2026", "Theaterplein 1 april").
const STRAATWOORD = String.raw`(?<!\p{L})\p{L}*(?:straat|laan|lei|plein|plaats|kaai|kade|dreef|weg|singel|markt|vest|dijk|baan|hof|park|pad|brug|rui|vliet|veld|berg|dok|boulevard|square|wei|plantsoen|poort|vaart|gracht|tunnel)`;
const HUISNUMMER_NA = String.raw`\s+(?:nr\.?\s*)?\d{1,3}[a-z]?(?:\s*(?:[-–/]|bus)\s*\d{1,3}[a-z]?)*(?![\p{L}\d])(?!\s*(?:${MAAND})\b)`;
const STRAAT_MET_NUMMER = new RegExp(String.raw`(${STRAATWOORD})${HUISNUMMER_NA}`, "iu");
const ADRES_NA_KOMMA = new RegExp(String.raw`^(.+?),\s*[^,]*?(?:${STRAATWOORD}${HUISNUMMER_NA}|\bzonder\s+(?:huis)?nummer\b|\(\s*zn\s*\))`, "iu");
// Gebieden in district Antwerpen en namen van andere districten (of gemeenten) in een plaats.
const GEBIED_NAMEN = Object.freeze({ linkeroever: "Linkeroever", binnenstad: "binnenstad", eilandje: "Eilandje", kiel: "Kiel", luchtbal: "Luchtbal", seefhoek: "Seefhoek", stuivenberg: "Stuivenberg", "spoor noord": "Spoor Noord", "het zuid": "het Zuid", "t zuid": "'t Zuid", "district antwerpen": "district Antwerpen" });
const DISTRICT_GEBIEDEN = Object.freeze(Object.keys(GEBIED_NAMEN));
const ANDERE_GEBIEDEN = Object.freeze(["berchem", "borgerhout", "deurne", "merksem", "ekeren", "wilrijk", "hoboken", "berendrecht", "zandvliet", "lillo", "borsbeek", "spoor oost", "mortsel", "edegem", "schoten", "zwijndrecht"]);

const clean = (value, max = 300) => normalizeDecisionTitle(decodeEntities(String(value ?? "")).replace(/ /g, " ")).slice(0, max);
const plat = (value) => clean(value, 4000).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const pad2 = (n) => String(n).padStart(2, "0");
const isoDag = (jaar, maand, dag) => {
  const value = `${jaar}-${pad2(maand)}-${pad2(dag)}`;
  return isValidIsoDate(value) ? value : null;
};

// ---------- zoeken ----------

// Het zoekvenster op zittingsdatum rond vandaag (ISO-dag).
export function zoekVenster(today) {
  return { start: addDaysIso(today, -ZOEK_DAGEN_TERUG), end: addDaysIso(today, ZOEK_DAGEN_VOORUIT) };
}

// Zoekrijen zoals rowsFromSearch, plus de zittingsdatum ("14/09/2026 09:00" -> "2026-09-14").
export function zoekRijen(html = "") {
  const rijen = [];
  for (const blok of String(html).matchAll(/<a[^>]*class="[^"]*result-row[^"]*"[^>]*>[\s\S]*?<\/a>/g)) {
    const [rij] = rowsFromSearch(blok[0]);
    if (!rij) continue;
    const datum = blok[0].match(/<span[^>]*class="[^"]*\bdate\b[^"]*"[^>]*>\s*(\d{2})\/(\d{2})\/(20\d{2})/);
    rijen.push({ ...rij, zitting: datum ? isoDag(Number(datum[3]), Number(datum[2]), Number(datum[1])) : null });
  }
  return rijen;
}

// Hoogstens 1 verzoek per intervalMs naar dezelfde host (alle verzoeken van deze bron gaan naar eBesluit).
export function gespreideFetch(fetchImpl, { intervalMs = MIN_INTERVAL_MS, sleep = wacht, nu = Date.now } = {}) {
  let volgende = 0;
  return async (url, options) => {
    const wachten = volgende - nu();
    if (wachten > 0) await sleep(wachten);
    volgende = nu() + intervalMs;
    return fetchImpl(url, options);
  };
}
const wacht = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- titels ----------

export function heeftRechtsvorm(naam) {
  return RECHTSVORM.test(clean(naam, 160));
}
// Rechtsvorm of publieke instelling: nooit een privépersoon.
export function organisatorToegelaten(naam) {
  const kort = clean(naam, 160);
  return heeftRechtsvorm(kort) || PUBLIEKE_INSTELLING.test(kort);
}
const metRechtsvorm = (naam) => {
  const kort = clean(zonderApenstaart(naam), 160).replace(/[,;:\s]+$/, "");
  return kort && organisatorToegelaten(kort) ? kort.slice(0, 120) : null;
};

// Een e-mailadres valt weg. Een "@" in een naam ("Cirque@Taque 2026") wordt "at": de privacycontrole
// weigert elk "@", en één naam mag de hele bron niet tegenhouden.
export function zonderApenstaart(value = "") {
  return String(value ?? "")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, " ")
    .replace(/(?<=\p{L})@(?=\p{L})/gu, "at")
    .replace(/@/g, " ");
}

// Een naam zonder adres: "<naam>, <straat> 12. District X" wordt "<naam>", een los "Proefstraat 12"
// wordt "Proefstraat", "zonder nummer" en "(zn)" vallen weg. Jaartallen en dagen blijven ("Stadspark
// 2026", "Theaterplein 1 april").
export function naamZonderAdres(naam) {
  let uit = clean(zonderApenstaart(naam), 300);
  const adres = uit.match(ADRES_NA_KOMMA);
  if (adres) uit = adres[1];
  uit = uit
    .replace(new RegExp(STRAAT_MET_NUMMER.source, "giu"), "$1")
    .replace(/\s*\(\s*zn\s*\)|\s+zonder\s+(?:huis)?nummer\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:\s-]+$/, "")
    .trim();
  return uit.length >= 3 ? uit.slice(0, 150) : null;
}
export const naamMetHuisnummer = (naam) => STRAAT_MET_NUMMER.test(clean(naam, 400));

// "Intrekking" eerst: "... Intrekking - Goedkeuring" en "... Intrekking - Bekrachtiging" trekken een
// ouder besluit in. Een bekrachtiging (door de raad) is verder een goedkeuring.
function statusUitTitel(titel) {
  if (/\bintrekking\b/i.test(titel)) return /-\s*(?:goedkeuring|bekrachtiging)\s*$/i.test(titel) ? "ingetrokken" : null;
  if (/-\s*weigering\s*$/i.test(titel)) return "weigering";
  if (/-\s*(?:goedkeuring|bekrachtiging)\s*$/i.test(titel)) return "goedkeuring";
  return null;
}
const SLOT = String.raw`(?:Goedkeuring|Weigering|Bekrachtiging)`;

const isAnderDistrict = (orgaan) => /^(?:districtscollege|districtsraad|raadscommissie)\s+(?!antwerpen$)\S/i.test(clean(orgaan));
const isDistrictAntwerpen = (orgaan) => /^(?:districtscollege|districtsraad)\s+antwerpen$/i.test(clean(orgaan));

// Naam van een evenement uit een titel opkuisen: geen ". Organisatie", geen datum op het einde, en bij
// een lijst ("Samenlevingsversterkende ... - Lijst district Deurne - Deurne Griezelt") het laatste deel.
function naamOpgekuist(ruw = "", { lijst = false } = {}) {
  let naam = clean(ruw, 300)
    .replace(/^organisatie\s+en\s+logistieke\s+ondersteuning\.\s*/i, "")
    .replace(/\.\s*intrekking$/i, "")
    .replace(/\.\s*organisatie$/i, "");
  naam = naam.replace(new RegExp(`\\.\\s*(?:(?:${WEEKDAG})\\s+)?\\d{1,2}\\s+(?:${MAAND})(?:\\s+20\\d{2})?$`, "i"), "");
  if (lijst && naam.includes(" - ")) naam = naam.split(" - ").at(-1);
  return naamZonderAdres(naam.replace(/[.\s]+$/, "").trim());
}

// Iets dat op een adres lijkt: een cijfer, "zonder nummer", "(zn)", "District X" of ", Antwerpen" op het einde.
const LIJKT_ADRES = /\d|\bzonder\s+(?:huis)?nummer\b|\(\s*zn\s*\)|\bzn\b|\bdistrict\s+\p{L}|^antwerpen$|,\s*antwerpen$/iu;

// Het deel na "voor" in een muziektitel: naam, adres en (soms) postcode en gemeente.
//   "Nachtelijke Testklanken", Voorbeeldplein zonder nummer, 2000 Antwerpen
//   Stressfactor, Salesianenlaan 1. District Hoboken    (geen postcode: het district na een punt)
//   Feesten in het Stadspark 2026, Rubenslei zonder nummer (zn), Antwerpen
function muziekNaamEnPlaats(rest) {
  const metPostcode = rest.match(/^["“„](.+?)["”],?\s*(.+?),\s*(\d{4})\s+(.+)$/) || rest.match(/^(.+?),\s*(.+?),\s*(\d{4})\s+(.+)$/);
  if (metPostcode) return { naam: metPostcode[1], plaats: plaatsZonderNummers(`${metPostcode[2]}, ${metPostcode[3]} ${metPostcode[4]}`) };
  const zonderPostcode = rest.match(/^["“„](.+?)["”],?\s*(.+)$/) || rest.match(/^(.+?),\s*(.+)$/);
  if (zonderPostcode && LIJKT_ADRES.test(zonderPostcode[2])) {
    return { naam: zonderPostcode[1], plaats: plaatsZonderNummers(zonderPostcode[2].replace(/\.\s*(?=district\s)/i, ", ")) };
  }
  return { naam: rest, plaats: null };
}

// Welk soort besluit is dit, met wat de titel zelf al zegt? null = geen evenementbesluit.
// { soort, status, naam, organisator, plaats, wijziging } (plaats alleen bij een muziekactiviteit;
// wijziging: "data" voor een nieuwe datum, "andere" voor een andere aanpassing, rechtzetting of intrekking).
export function soortVanTitel(ruweTitel = "", orgaan = "") {
  const titel = clean(ruweTitel, 600).replace(/^20\d\d_[A-Z]{2,8}_\d+\s*-\s*/, "");
  const status = statusUitTitel(titel);
  if (!status) return null;
  const wijziging = /\b(?:aanpassing|wijziging|rechtzetting)\s+(?:van\s+(?:de\s+)?)?(?:data|datum|dagen)\b/i.test(titel) ? "data"
    : status === "ingetrokken" || /\b(?:aanpassing|rechtzetting|wijziging)\b/i.test(titel) ? "andere" : null;

  const fonds = titel.match(new RegExp(String.raw`Districtsfonds:\s*beleef je buurt!\s*-\s*(.+?)(?:\.\s*(?:Toekenning en uitbetaling|Uitzondering op het reglement)[^-]*)?\s*-\s*${SLOT}$`, "i"));
  if (fonds) {
    if (!isDistrictAntwerpen(orgaan)) return null;
    return { soort: "districtsfonds", status, naam: null, organisator: metRechtsvorm(fonds[1]), plaats: null, wijziging };
  }

  const muziek = titel.match(/^(?:Rechtzetting\s+)?Toelating muziekactiviteit\s*-\s*(?:(?:Aanpassing data|Rechtzetting materi[eë]le vergissing|Wijziging[^-]*)\s*-\s*)*(.+?),\s*voor\s+(.+)$/i);
  if (muziek) {
    const rest = muziek[2].replace(/\.\s*Dossiernummer\b.*$/i, "").replace(new RegExp(String.raw`\s*-\s*${SLOT}$`, "i"), "");
    const { naam, plaats } = muziekNaamEnPlaats(rest);
    return { soort: "muziek", status, naam: naamOpgekuist(naam.replace(/["“”„]/g, "")), organisator: metRechtsvorm(muziek[1]), plaats, wijziging };
  }

  // "Evenementen - <naam>[. Organisatie] - Goedkeuring", ook met "District X - " ervoor.
  const evenement = titel.match(new RegExp(String.raw`^(?:District\s+[^-]+?\s*-\s*)?Evenementen\s*-\s*(.+?)\s*-\s*${SLOT}$`, "i"));
  // Geen goedkeuring van een evenement zelf: een overeenkomst, krediet, bestek of concessie erover.
  const geenOrganisatie = /^(?:ondersteuning|logistieke|nominatieve)\b|\b(?:overeenkomst|ondertekening|bestek|vastlegging|krediet|concessie|sponsor\w*|afsprakennota|retributie\w*|reglement|uitleenprincipes)\b/i;
  if (evenement && !geenOrganisatie.test(evenement[1])) {
    const naam = naamOpgekuist(evenement[1], { lijst: true });
    return naam ? { soort: "evenement", status, naam, organisator: null, plaats: null, wijziging } : null;
  }
  // Een programma van een districtscollege: "Halloween Survival Run 2026 - Programma - Goedkeuring".
  const programma = titel.match(/^([^-]*\b(?:intrede|halloween|sinterklaas|sint|kerst\w*|nieuwjaar\w*|feest\w*)\b[^-]*?)\s*-\s*(?:Programma|Organisatie)\b[^-]*-\s*Goedkeuring$/i);
  if (programma && /^districtscollege\b/i.test(clean(orgaan))) {
    const naam = naamOpgekuist(programma[1]);
    return naam ? { soort: "evenement", status, naam, organisator: null, plaats: null, wijziging } : null;
  }
  return null;
}

// ---------- plaats ----------

// Huisnummers en "zonder nummer" weg; postcodes ("2000 Antwerpen") blijven.
export function plaatsZonderNummers(value = "") {
  const tekst = clean(value, 400)
    .replace(/\(\s*zn\s*\)/gi, " ")
    .replace(/\bzonder\s+(?:huis)?nummer\b/gi, " ")
    .replace(/\b(?:zn|z\/n)\b/gi, " ")
    // "28-30", "5/7", "12a", "12 bus 3": een huisnummer, nooit een postcode (die heeft vier cijfers)
    .replace(/\b\d{1,3}[a-z]?(?:\s*(?:[-–/]|bus)\s*\d{1,3}[a-z]?)*\b/gi, " ")
    .replace(/\s+,/g, ",")
    .replace(/,(?:\s*,)+/g, ",")
    .replace(/\s+/g, " ")
    .replace(/^[,\s]+|[,\s]+$/g, "")
    .trim();
  return tekst.slice(0, 160) || null;
}

// De straatnamen van district Antwerpen (site/geo/straten.json) als zoekindex.
export function straatIndex(straten = []) {
  const perNaam = new Map();
  for (const rij of Array.isArray(straten) ? straten : []) {
    const naam = clean(Array.isArray(rij) ? rij[1] : rij?.naam, 120);
    const postcode = String(Array.isArray(rij) ? rij[2] : rij?.postcode ?? "");
    const sleutel = plat(naam);
    if (!sleutel) continue;
    const bestaand = perNaam.get(sleutel) || { naam, postcodes: new Set() };
    if (/^\d{4}$/.test(postcode)) bestaand.postcodes.add(postcode);
    perNaam.set(sleutel, bestaand);
  }
  return perNaam;
}

// Ligt deze plaats in district Antwerpen? { inDistrict: true|false|null, straten, postcodes }.
//   - een postcode van het district, of een gebied (Linkeroever, binnenstad, ...): ja;
//   - anders een postcode of naam van een ander district: nee;
//   - anders een straatnaam van het district (de langste die in de tekst staat): ja;
//   - anders onbekend (bv. alleen "Antwerpen").
export function plaatsInDistrict(plaats, index = new Map()) {
  const tekst = ` ${plat(plaats)} `;
  const postcodes = [...new Set([...String(plaats ?? "").matchAll(/\b(2\d{3})\b/g)].map((m) => m[1]))];
  const straten = [];
  if (tekst.trim()) {
    const raak = [...index.entries()].filter(([sleutel]) => tekst.includes(` ${sleutel} `)).sort((a, b) => b[0].length - a[0].length);
    // Een kortere naam die in een langere zit ("Meir" in "Meirbrug"), telt niet apart.
    for (const [sleutel, straat] of raak) if (!straten.some((s) => ` ${plat(s.naam)} `.includes(` ${sleutel} `))) straten.push(straat);
  }
  // Zonder postcode in de tekst: die van de straat, maar alleen als ze eenduidig is.
  const straatPostcodes = [...new Set(straten.flatMap((s) => [...s.postcodes]))];
  const result = (inDistrict) => ({
    inDistrict,
    straten: straten.map((s) => s.naam).sort((a, b) => a.localeCompare(b, "nl")),
    postcodes: (postcodes.length ? postcodes : straatPostcodes.length === 1 ? straatPostcodes : []).sort(),
  });
  if (!tekst.trim()) return result(null);
  if (postcodes.some((p) => DISTRICT_POSTCODES.includes(p)) || DISTRICT_GEBIEDEN.some((g) => tekst.includes(` ${g} `))) return result(true);
  if (postcodes.length || ANDERE_GEBIEDEN.some((g) => tekst.includes(` ${g} `))) return result(false);
  if (straten.length) return result(true);
  return result(null);
}

// Alleen straat, postcode en gebied uit een vrije plaatstekst (de tabel van het Districtsfonds): die cel
// noemt soms ontwerpers of bewoners met hun adres. Geen enkel ander woord gaat mee. Zonder straat,
// postcode of gebied: `standaard`.
export function plaatsUitStraten(tekst, index = new Map(), { standaard = null } = {}) {
  const ligging = plaatsInDistrict(tekst, index);
  const platTekst = ` ${plat(tekst)} `;
  const gebieden = DISTRICT_GEBIEDEN.filter((g) => platTekst.includes(` ${g} `)).map((g) => GEBIED_NAMEN[g]);
  const straten = ligging.straten.slice(0, 6);
  const meer = ligging.straten.length > straten.length ? " en andere straten" : "";
  const postcodes = [...new Set([...String(tekst ?? "").matchAll(/\b(2\d{3})\b/g)].map((m) => m[1]))].sort();
  const postcodeTekst = postcodes.length ? `${postcodes.join(" en ")} Antwerpen` : "";
  const delen = straten.length ? [`${straten.join(", ")}${meer}`, postcodeTekst] : [gebieden[0] ?? "", postcodeTekst];
  const uit = delen.filter(Boolean).join(", ");
  return uit ? uit.slice(0, 160) : standaard;
}

// ---------- datums en uren ----------

// Alle dagen in een datumuitdrukking. `jaar`: als er geen jaartal staat; `na`: een dag zonder jaartal
// valt nooit vóór deze dag (anders een jaar later).
export function dagenUitTekst(tekst = "", { jaar = null, na = null } = {}) {
  const schoon = String(tekst).toLowerCase()
    .replace(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/g, (_, d, m, j) => `${d} ${Object.keys(MAANDEN)[Number(m) - 1] ?? ""} ${j}`)
    .replace(new RegExp(String.raw`\b\d{1,2}(?:[.:u]\s?\d{2})?\s*(?:uur|u)\b`, "g"), " ")
    .replace(/\b\d{1,2}[.:]\d{2}\b/g, " ");
  const tokens = [];
  const re = new RegExp(String.raw`\b(\d{1,2})(?:\s+(${MAAND}))?(?:\s+(20\d{2}))?\b|(tot\s+en\s+met|t\.e\.m\.|tot|[-–])`, "g");
  for (const m of schoon.matchAll(re)) {
    if (m[1]) tokens.push({ dag: Number(m[1]), maand: m[2] ? MAANDEN[m[2]] : null, jaar: m[3] ? Number(m[3]) : null });
    else tokens.push({ tot: true });
  }
  // Maand en jaar van rechts naar links aanvullen: "3 en 4 oktober 2026".
  let maand = null, j = null;
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const t = tokens[i];
    if (t.tot) continue;
    if (t.maand) { maand = t.maand; if (t.jaar) j = t.jaar; else t.jaar = j; }
    else { t.maand = maand; t.jaar = j; }
  }
  const datum = (t) => {
    if (!t?.maand) return null;
    let value = isoDag(t.jaar ?? jaar, t.maand, t.dag);
    if (value && !t.jaar && na && value < na) value = isoDag((t.jaar ?? jaar) + 1, t.maand, t.dag);
    return value;
  };
  const dagen = new Set();
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.tot) continue;
    const begin = datum(t);
    if (!begin) continue;
    dagen.add(begin);
    if (tokens[i + 1]?.tot && tokens[i + 2] && !tokens[i + 2].tot) {
      const einde = datum(tokens[i + 2]);
      // Een reeks van hoogstens 62 dagen ("van 3 tot en met 18 oktober").
      for (let d = begin, n = 0; einde && d < einde && n < 62; n += 1) { d = addDaysIso(d, 1); dagen.add(d); }
    }
  }
  return [...dagen].sort();
}

const uurTekst = (h, m) => {
  const uur = Number(h), minuut = Number(m ?? 0);
  return uur <= 23 && minuut <= 59 ? `${pad2(uur)}:${pad2(minuut)}` : null;
};
// Opbouw en afbouw hebben hun eigen uren; die zinnen tellen hier niet.
const isOpbouwZin = (zin) => /\b(?:opbouw|afbouw|afbraak|opbraak)\b/i.test(zin);

const RANGE_UREN = [
  new RegExp(String.raw`\b(?:van|vanaf)\s+${UUR}\s*(?:uur|u)?\s*(?:tot(?:\s+en\s+met)?|-|–)\s*${UUR}\s*(?:uur|u)\b`, "i"),
  new RegExp(String.raw`\btussen\s+${UUR}\s*(?:uur|u)?\s+en\s+${UUR}\s*(?:uur|u)\b`, "i"),
  // Een programmaregel "12.00 - 22.00 uur" (minuten verplicht, zodat "1 - 4 november" nooit meetelt).
  /\b(\d{1,2})[.:](\d{2})\s*(?:uur\s*)?[-–]\s*(\d{1,2})[.:](\d{2})\s*(?:uur|u)\b/i,
];
const heeftDatum = (zin) => new RegExp(String.raw`\b\d{1,2}\s+(?:${MAAND})\b`, "i").test(zin);

// { start, einde } (HH:MM, einde mag null zijn) uit vaste zinnen, of null. Volgorde:
//   1. "van 13.30 uur tot 23.00 uur" of "tussen 10.00 uur en 13.00 uur" in een zin met een dag;
//   2. begin en einde apart: "De deuren openen ... om 14.00 uur", "het einde is voorzien om 23.30 uur",
//      of een tabel "9.00 uur start ... 17.00 uur geschatte aankomst laatste loper";
//   3. een reeks uren in een zin zonder dag. ("de meeste bezoekers tussen 19 en 20 uur" telt zo pas als
//      er niets beters is.)
export function urenUitTekst(tekst = "") {
  const zinnen = String(tekst).split(/(?<=[.;])\s+|\n+/).filter((zin) => !isOpbouwZin(zin));
  const reeks = (kandidaten) => {
    for (const re of RANGE_UREN) {
      for (const zin of kandidaten) {
        const m = zin.match(re);
        const start = m && uurTekst(m[1], m[2]);
        if (start) return { start, einde: uurTekst(m[3], m[4]) };
      }
    }
    return null;
  };
  const metDag = reeks(zinnen.filter(heeftDatum));
  if (metDag) return metDag;
  let start = null, einde = null;
  for (const zin of zinnen) {
    if (!start) {
      const m = zin.match(new RegExp(String.raw`\b(?:vertrek\w*|start\w*|begin\w*|aanvang|deuren\s+open\w*|opent|openen|opening)\b[^.]{0,120}?\bom\s+${UUR}\s*(?:uur|u)\b`, "i"))
        || zin.match(new RegExp(String.raw`(?:^|\s)${UUR}\s*(?:uur|u)\s+start\b`, "i"));
      if (m) start = uurTekst(m[1], m[2]);
    }
    if (!einde) {
      const m = zin.match(new RegExp(String.raw`\b(?:einde|eindigt|afgelopen|sluit\w*)\b[^.]{0,120}?\bom\s+${UUR}\s*(?:uur|u)\b`, "i"))
        || zin.match(new RegExp(String.raw`(?:^|\s)${UUR}\s*(?:uur|u)\s+(?:geschatte\s+)?aankomst\s+laatste\b`, "i"));
      if (m) einde = uurTekst(m[1], m[2]);
    }
  }
  if (start) return { start, einde };
  return reeks(zinnen);
}

// "De opbouw start op 12 oktober 2026 en de afbouw eindigt op 21 oktober 2026."
// "De opbouw begint op 17 september 2026 om 08.00 uur en de afbraak is voorzien op 21 september ..."
export function opbouwAfbouw(tekst = "", { eersteDag = null, laatsteDag = null } = {}) {
  const jaar = Number((eersteDag || laatsteDag || "").slice(0, 4)) || null;
  const datumNa = (zin, woord) => {
    const m = zin.match(new RegExp(String.raw`\b${woord}\w*\b[^.]{0,80}?\b(?:op|vanaf|tot(?:\s+en\s+met)?)\s+((?:(?:${WEEKDAG})\s+)?\d{1,2}\s+(?:${MAAND})(?:\s+20\d{2})?)`, "i"));
    return m ? m[1] : null;
  };
  let opbouw = null, afbouw = null;
  for (const zin of String(tekst).split(/(?<=[.;])\s+|\n+/)) {
    if (!opbouw) {
      const t = datumNa(zin, "opbouw");
      if (t) {
        const [dag] = dagenUitTekst(t, { jaar });
        // Een opbouw zonder jaartal na de eerste dag hoort bij het jaar ervoor (een evenement op 2 januari).
        opbouw = dag && eersteDag && dag > eersteDag && !/20\d{2}/.test(t) ? dagenUitTekst(t, { jaar: jaar - 1 })[0] : dag;
      }
    }
    if (!afbouw) {
      const t = datumNa(zin, "(?:afbouw|afbraak)");
      if (t) [afbouw] = dagenUitTekst(t, { jaar, na: laatsteDag });
    }
  }
  if (opbouw && eersteDag && opbouw > eersteDag) opbouw = null;
  if (afbouw && laatsteDag && afbouw < laatsteDag) afbouw = null;
  return { opbouw: opbouw || null, afbouw: afbouw || null };
}

// ---------- detailpagina ----------

// Knipt de detailpagina in delen en laat het blok "Samenstelling" altijd weg. Alleen tekst uit
// "Aanleiding en context", "Argumentatie" en het besluit (Artikel 1) wordt daarna gelezen.
export function detailDelen(html = "") {
  let markup = String(html);
  const samenstelling = markup.search(/<h2[^>]*>\s*Samenstelling\s*<\/h2>/i);
  if (samenstelling >= 0) {
    const motivering = markup.search(/<h2[^>]*>\s*Motivering\s*<\/h2>/i);
    // Zonder kop "Motivering" erna valt alles vanaf "Samenstelling" weg: liever niets dan namen.
    markup = markup.slice(0, samenstelling) + (motivering > samenstelling ? markup.slice(motivering) : "");
  }
  const koppen = [...markup.matchAll(/<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => ({ naam: textFromHtml(m[2]), start: m.index, einde: m.index + m[0].length }));
  const sectie = (naam) => {
    const i = koppen.findIndex((k) => k.naam.toLowerCase() === naam.toLowerCase());
    if (i < 0) return "";
    return markup.slice(koppen[i].einde, koppen[i + 1]?.start ?? markup.length).replace(/©[\s\S]*$/, "");
  };
  const aanleiding = sectie("Aanleiding en context"), argumentatie = sectie("Argumentatie"), artikel1 = sectie("Artikel 1");
  return {
    aanleidingHtml: aanleiding,
    argumentatieHtml: argumentatie,
    aanleiding: regelTekst(aanleiding),
    argumentatie: regelTekst(argumentatie),
    artikel1: regelTekst(artikel1),
  };
}

// Tekst met een regeleinde per blok (alinea, tabelrij, lijn; de cellen van één rij blijven samen), zodat een tabelrij zonder punt
// ("17.00 uur aankomst laatste loper") niet aan de volgende zin plakt.
function regelTekst(html = "") {
  return decodeEntities(String(html)
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(?:br\s*\/?|\/p|\/li|\/tr|\/div|\/h\d|\/table)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t\r\f\v\u00a0]+/g, " ")
    .replace(/ *\n[\n ]*/g, "\n")
    .trim();
}

// De vaste tabel van het Districtsfonds: "Aanvrager, activiteit/evenement en bedrag" | "Datum en locatie".
export function districtsfondsTabel(html = "") {
  for (const tabel of String(html).matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const rijen = [...tabel[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((r) => [...r[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]));
    if (!rijen.length || !/datum\s+en\s+locatie/i.test(textFromHtml(rijen[0].join(" ")))) continue;
    const regels = (cel) => String(cel ?? "").split(/<br\s*\/?>|<\/p>|<\/div>/i).map((r) => textFromHtml(r)).filter(Boolean);
    for (const rij of rijen.slice(1)) {
      if (rij.length < 2) continue;
      const links = regels(rij[0]).filter((r) => !/^(?:datum aanvraag|aangevraagde ondersteuning)\b/i.test(r) && !/\bEUR\b/.test(r));
      const rechts = regels(rij[1]);
      const datumRegels = rechts.filter((r) => new RegExp(`\\b(?:${MAAND})\\b|\\d{1,2}/\\d{1,2}/20\\d{2}`, "i").test(r));
      const plaatsRegels = rechts.filter((r) => !datumRegels.includes(r));
      return { aanvrager: links[0] ?? null, activiteit: links[1] ?? null, datum: datumRegels.join(" "), plaats: plaatsRegels.join(", ") };
    }
  }
  return null;
}

const ALGEMENE_PLAATS = /^(?:(?:de\s+)?stad\s+)?antwerpen$|^verschillende\s+locaties$/i;
// Eerste stuk van een plaatszin, zonder lidwoord en zonder uitleg erachter.
const kortePlaats = (value) => clean(value, 300)
  .replace(/^(?:de|het|'t)\s+/i, "")
  .split(/\s+(?:ter hoogte van|met een|met start|tussen|via|richting|tot aan)\s+/i)[0]
  .replace(/[.,;:\s]+$/, "");

// Plaatszinnen buiten Artikel 1, in vaste vorm. Elk resultaat is een kandidaat; de eerste die in het
// district (of erbuiten) te plaatsen is, wint.
function plaatsKandidaten(tekst) {
  const out = [];
  const patronen = [
    /\bmet\s+start\s+en\s+(?:finish|aankomst)\s+(?:op|aan|in)\s+(?:de\s+|het\s+)?([^.;,\n]+)/i,
    /\bstartzone\b[^.]{0,60}?\bbevindt\s+zich\b[^.]{0,20}?\s(?:op|aan|in)\s+(?:de\s+|het\s+)?([^.;,(\n]+)/i,
    /\bgaat\s+door\s+(?:op|in|aan)\s+(?:de\s+|het\s+)?([A-Z][^.;,\n]+)/,
    /\bvindt\s+plaats\s+(?:op|in|aan)\s+(?:de\s+|het\s+)?([A-Z][^.;,\n]+)/,
  ];
  for (const re of patronen) {
    const m = String(tekst).match(re);
    if (m) out.push(kortePlaats(m[1]));
  }
  return out.filter(Boolean);
}

const isDatumTekst = (value) => new RegExp(`^(?:(?:${WEEKDAG})\\s+)?\\d{1,2}\\s+(?:${MAAND})`, "i").test(clean(value));

// Tot het einde van de zin; een punt tussen cijfers ("16.00 uur") hoort er nog bij.
const TOT_ZINEINDE = String.raw`(?:[^.]|\.(?=\d))*\.`;
// Zinnen met de dag(en) van een muziekactiviteit, in volgorde van voorkeur. Een "Aanpassing data" zegt
// "Het evenement zal doorgaan van ... tot en met ..."; dat zijn de nieuwe dagen.
const MUZIEK_ZINNEN = [
  new RegExp(String.raw`\b(?:zal|zullen)\s+(?:\S+\s+){0,3}?doorgaan\b${TOT_ZINEINDE}`, "i"),
  new RegExp(String.raw`\bgaat\s+(?:\S+\s+){0,2}?door\b${TOT_ZINEINDE}`, "i"),
  new RegExp(String.raw`\b(?:vindt|vinden)\s+plaats\b${TOT_ZINEINDE}`, "i"),
];
// De eerste datumreeks met echte dagen na "op" of "van": "van 20.00 uur" telt niet.
function dagenUitZin(zin, datumOpties) {
  for (const m of zin.matchAll(new RegExp(String.raw`(?:\bop\s+|(?=\b(?:van|vanaf)\s))(${DATUMREEKS})`, "gi"))) {
    const dagen = dagenUitTekst(m[1], datumOpties);
    if (dagen.length) return dagen;
  }
  return [];
}

// Welke oudere besluiten past dit besluit aan of trekt het in? Alleen voor een wijziging (titel) en
// alleen uit vaste vormen: een code in Artikel 1, "met kenmerk <code>" en "het besluit van <dag>
// (jaarnummer N)" in Artikel 1 (code: jaar van die dag, orgaan van dit besluit).
export function vervangtUitTekst({ artikel1 = "", kern = "", code = null } = {}) {
  const codes = new Set();
  for (const m of artikel1.matchAll(/\b(20\d\d_[A-Z]{2,8}_\d{3,6})\b/g)) codes.add(m[1]);
  for (const m of kern.matchAll(/\bkenmerk\s+(20\d\d_[A-Z]{2,8}_\d{3,6})\b/gi)) codes.add(m[1]);
  const orgaanCode = (String(code ?? "").match(/^20\d\d_([A-Z]{2,8})_\d+$/) || [])[1];
  if (orgaanCode) {
    const re = new RegExp(String.raw`\bbesluit\s+van\s+(?:(?:${WEEKDAG})\s+)?\d{1,2}\s+(?:${MAAND})\s+(20\d{2})\s*\(\s*jaarnummer\s+(\d{1,5})\s*\)`, "gi");
    for (const m of artikel1.matchAll(re)) codes.add(`${m[1]}_${orgaanCode}_${m[2].padStart(5, "0")}`);
  }
  codes.delete(code);
  return [...codes].sort().slice(0, 10);
}

// Leest een gepubliceerde detailpagina. Geeft alleen velden uit vaste zinnen terug.
export function leesDetail(html, { soort, zitting = null, titelPlaats = null, index = new Map(), code = null, wijziging = false } = {}) {
  const delen = detailDelen(html);
  const jaar = Number(String(zitting || "").slice(0, 4)) || null;
  const datumOpties = { jaar, na: zitting };
  const kern = [delen.aanleiding, delen.argumentatie].join(" ");
  let dagen = [], uren = null, plaats = null, organisator = null, naam = null, plaatsKandidatenLijst = [], straten = [];

  if (soort === "districtsfonds") {
    const tabel = districtsfondsTabel(`${delen.aanleidingHtml} ${delen.argumentatieHtml}`);
    if (tabel) {
      naam = tabel.activiteit ? clean(tabel.activiteit, 150) : null;
      organisator = metRechtsvorm(tabel.aanvrager);
      dagen = dagenUitTekst(tabel.datum, datumOpties);
      uren = urenUitTekst(tabel.datum);
      // Alleen straat, postcode of gebied: de cel noemt soms personen met hun adres.
      plaats = plaatsUitStraten(tabel.plaats, index, { standaard: tabel.plaats ? "district Antwerpen" : null });
      straten = plaatsInDistrict(tabel.plaats, index).straten;
    }
    if (!naam) {
      // Zonder tabel (een intrekking): "voor (de organisatie van) het initiatief 'X'".
      const naamRe = /voor\s+(?:de\s+organisatie\s+van\s+)?(?:het\s+initiatief|de\s+activiteit|het\s+evenement)\s+['‘’"“](.+?)['‘’"”]/i;
      const m = delen.artikel1.match(naamRe) || kern.match(naamRe);
      if (m) naam = clean(m[1], 150);
    }
  } else if (soort === "muziek") {
    // De eerste zin met echte dagen; zonder dagen nog de eerste zin voor uren en plaats.
    const zinnen = [delen.artikel1, kern].flatMap((tekst) => MUZIEK_ZINNEN.map((re) => tekst.match(re)?.[0]).filter(Boolean));
    const zin = zinnen.find((z) => dagenUitZin(z, datumOpties).length) ?? zinnen[0] ?? "";
    dagen = dagenUitZin(zin, datumOpties);
    uren = urenUitTekst(zin);
    const waar = zin.match(/\b(?:te|in|op)\s+([^.]+?)\s+(?:in|te)\s+(\d{4})\s+([A-Z][\w-]+)/);
    plaats = waar ? plaatsZonderNummers(`${waar[1]}, ${waar[2]} ${waar[3]}`) : titelPlaats;
  } else {
    // Artikel 1: "Het college keurt de organisatie door <organisator> van het evenement <naam> op
    // <dag(en)> (in|op|aan) <plaats> goed." of "... keurt de organisatie van de <naam> in <plaats> op <dag> goed."
    const segment = (delen.artikel1.match(/keurt\s+de\s+organisatie\s+([\s\S]+?)\s+goed\b/i) || [])[1] || "";
    const door = segment.match(/^door\s+(.+?)\s+van\s+(?:het\s+evenement|de|het)\b/i);
    if (door) organisator = metRechtsvorm(door[1]);
    // "op 18 oktober 2026" of "van 11 tot 13 september 2026".
    const datum = segment.match(new RegExp(`(?:\\bop\\s+|\\b(?=van\\s+\\d))(${DATUMREEKS})`, "i"));
    let voorPlaats = "";
    if (datum) {
      dagen = dagenUitTekst(datum[1], datumOpties);
      const na = segment.slice(datum.index + datum[0].length).trim().match(/^(?:in|op|aan|te)\s+(.+)$/i);
      const artikelPlaats = kortePlaats(na?.[1] || "");
      if (artikelPlaats && !isDatumTekst(artikelPlaats)) plaatsKandidatenLijst.push(artikelPlaats);
      // "... van het evenement X in Merksem op 9 september 2026": de plaats staat vóór de dag. Pas als
      // laatste kandidaat, want een naam kan zelf "in" bevatten ("Kerst in de Stad").
      voorPlaats = kortePlaats(segment.slice(0, datum.index).match(/^.*\s(?:in|op|aan|te)\s+([^,]+?)\s*$/i)?.[1] || "");
    }
    if (!dagen.length) {
      const zin = kern.match(new RegExp(`\\b(?:vindt|vinden)\\s+plaats\\s+op\\s+(${DATUMREEKS})|\\bgaat\\s+door\\s+op\\s+(${DATUMREEKS})|\\bOp\\s+(${DATUMREEKS})\\s+gaat\\b|\\bis\\s+gepland\\s+op\\s+(${DATUMREEKS})`, "i"));
      if (zin) dagen = dagenUitTekst(zin.slice(1).find(Boolean), datumOpties);
    }
    // Uren: eerst de zin met de dag, anders de argumentatie (zonder adviezen, die hebben eigen uren).
    uren = urenUitTekst(delen.artikel1) || urenUitTekst(delen.argumentatie) || urenUitTekst(delen.aanleiding);
    plaatsKandidatenLijst.push(...plaatsKandidaten(kern));
    if (voorPlaats && !isDatumTekst(voorPlaats)) plaatsKandidatenLijst.push(voorPlaats);
    plaats = plaatsKandidatenLijst[0] ? plaatsZonderNummers(plaatsKandidatenLijst[0]) : null;
  }
  const opAf = opbouwAfbouw(kern, { eersteDag: dagen[0] ?? null, laatsteDag: dagen.at(-1) ?? null });
  return {
    naam,
    organisator,
    dagen,
    uren: uren && dagen.length ? uren : null,
    plaats,
    plaatsKandidaten: plaatsKandidatenLijst.map((p) => plaatsZonderNummers(p)).filter(Boolean),
    // Alle straten uit de tabel van het Districtsfonds (de plaats zelf noemt er hoogstens zes).
    straten,
    opbouw: opAf.opbouw,
    afbouw: opAf.afbouw,
    vervangt: wijziging ? vervangtUitTekst({ artikel1: delen.artikel1, kern, code }) : [],
  };
}

// ---------- besluiten ----------

export const BESLUIT_SLEUTELS = Object.freeze([
  "id", "code", "soort", "status", "orgaan", "zitting", "gepubliceerd", "gelezen",
  "naam", "organisator", "dagen", "uren", "plaats", "straten", "postcodes", "inDistrict", "opbouw", "afbouw", "wijziging", "vervangt", "bron",
]);

const bronUrl = (rij) => `${EBESLUIT_BASE}/zittingen/${rij.meetingId}/agendapunten/${rij.id}`;
const codeUitTitel = (titel) => (clean(titel).match(/^(20\d\d_[A-Z]{2,8}_\d+)\b/) || [])[1] || null;

// Een besluit uit een zoekrij (en, als ze gelezen is, de detailpagina). Plaats: de eerste kandidaat die
// in of buiten het district te plaatsen is; een ander district als orgaan zegt altijd "niet in het district".
export function besluitRecord(rij, titelInfo, detail = null, index = new Map()) {
  const kandidaten = [...(detail?.plaatsKandidaten ?? []), detail?.plaats, titelInfo.plaats].filter(Boolean);
  let plaats = null, ligging = plaatsInDistrict(null, index);
  for (const kandidaat of kandidaten) {
    const l = plaatsInDistrict(kandidaat, index);
    if (!plaats) { plaats = kandidaat; ligging = l; }
    if (l.inDistrict !== null && !ALGEMENE_PLAATS.test(kandidaat)) { plaats = kandidaat; ligging = l; break; }
  }
  let inDistrict = ligging.inDistrict;
  if (isAnderDistrict(rij.organ)) inDistrict = false;
  // Een Districtsfonds van district Antwerpen gaat over een activiteit in het district.
  else if (titelInfo.soort === "districtsfonds" && plaats && inDistrict === null) inDistrict = true;
  return {
    id: rij.id,
    code: codeUitTitel(rij.title),
    soort: titelInfo.soort,
    status: titelInfo.status,
    orgaan: clean(rij.organ, 80) || null,
    zitting: rij.zitting ?? null,
    gepubliceerd: rij.published === true,
    gelezen: Boolean(detail),
    // Ook een naam uit de tabel van het Districtsfonds: nooit een huisnummer of "@".
    naam: naamZonderAdres(detail?.naam || titelInfo.naam || ""),
    organisator: detail?.organisator || titelInfo.organisator || null,
    dagen: detail?.dagen ?? [],
    uren: detail?.uren ?? null,
    plaats: plaats ? clean(plaats, 160) : null,
    straten: detail?.straten?.length ? detail.straten : ligging.straten,
    postcodes: ligging.postcodes,
    inDistrict,
    opbouw: detail?.opbouw ?? null,
    afbouw: detail?.afbouw ?? null,
    wijziging: titelInfo.wijziging ?? null,
    vervangt: detail?.vervangt ?? [],
    bron: bronUrl(rij),
  };
}

// Een detailpagina ophalen loont alleen voor een gepubliceerde goedkeuring of intrekking die (nog) in het
// district kan liggen: een besluit van een ander district of met een postcode erbuiten in de titel, niet.
// Een intrekking zegt in Artikel 1 welk besluit ze intrekt.
const moetGelezen = (record) => record.gepubliceerd && ["goedkeuring", "ingetrokken"].includes(record.status) && !record.gelezen && record.inDistrict !== false;
const laatsteDag = (record) => [record.afbouw, ...(record.dagen ?? [])].filter(Boolean).sort().at(-1) ?? null;

// Zoekt, leest alleen nieuwe ids en geeft { besluiten, coverage, complete, gelezen, teLezen, detailFouten }.
// cache: de besluiten uit het vorige evenement-besluiten.json (met dezelfde leesversie).
export async function ontdekEvenementBesluiten({
  fetch: fetchImpl = globalThis.fetch,
  today,
  cache = [],
  straten = [],
  sleep = wacht,
  nu = Date.now,
  intervalMs = MIN_INTERVAL_MS,
  maxDetails = MAX_DETAILS_PER_RUN,
  detailTijdMs = DETAIL_TIJD_MS,
  log = () => {},
} = {}) {
  if (!isValidIsoDate(today)) throw new FetchError("invalid_date");
  const begonnen = nu();
  const gespreid = gespreideFetch(fetchImpl, { intervalMs, sleep, nu });
  const opties = { retryDelayMs: 1_500, sleepImpl: sleep, parseRows: zoekRijen };
  const venster = zoekVenster(today);
  const index = straatIndex(straten);

  const rijen = new Map();
  const coverage = [];
  for (const term of EVENEMENT_ZOEKTERMEN) {
    const result = await searchKeyword(gespreid, term, venster, opties);
    coverage.push(result.coverage);
    for (const rij of result.rows) rijen.set(rij.id, rij);
  }

  const vorige = new Map((Array.isArray(cache) ? cache : []).filter((r) => r?.id).map((r) => [r.id, r]));
  const besluiten = new Map();
  const nieuw = [];
  for (const rij of rijen.values()) {
    const titelInfo = soortVanTitel(rij.title, rij.organ);
    if (!titelInfo) continue;
    const oud = vorige.get(rij.id);
    // Al gelezen: uit de cache, geen nieuw verzoek. Al de rest komt opnieuw uit de zoekrij (goedkoop);
    // wat gepubliceerd en goedgekeurd is maar nog niet gelezen, wordt hieronder gelezen.
    if (oud?.gelezen === true) {
      besluiten.set(rij.id, { ...oud, status: titelInfo.status, gepubliceerd: rij.published === true });
      continue;
    }
    const record = besluitRecord(rij, titelInfo, null, index);
    besluiten.set(rij.id, record);
    if (moetGelezen(record)) nieuw.push({ rij, titelInfo, record });
  }
  // Wat niet meer in het venster valt maar nog moet komen, blijft (een Districtsfonds van maanden geleden).
  for (const [id, oud] of vorige) {
    if (!besluiten.has(id) && oud.gelezen === true && (laatsteDag(oud) ?? "") >= today) besluiten.set(id, oud);
  }

  let gelezen = 0, detailFouten = 0;
  for (const { rij, titelInfo, record } of nieuw) {
    if (gelezen >= maxDetails || nu() - begonnen > detailTijdMs) break;
    try {
      const html = await getHtml(gespreid, record.bron, opties);
      const detail = leesDetail(html, { soort: titelInfo.soort, zitting: rij.zitting, titelPlaats: titelInfo.plaats, index, code: record.code, wijziging: titelInfo.wijziging });
      besluiten.set(rij.id, besluitRecord(rij, titelInfo, detail, index));
      gelezen += 1;
    } catch (error) {
      // Het tijdsbudget van de verversing is op: stoppen, wat al gelezen is blijft.
      if (error?.code === "source_timeout") break;
      // Eén kapotte detailpagina houdt de rest niet tegen; de volgende verversing probeert opnieuw.
      detailFouten += 1;
      log(JSON.stringify({ source: EBESLUIT_EVENEMENTEN_SOURCE_ID, detail: record.code, errorCode: error?.code ?? "unexpected_error" }));
    }
  }
  const lijst = [...besluiten.values()].sort((a, b) => (a.zitting ?? "").localeCompare(b.zitting ?? "") || String(a.code).localeCompare(String(b.code)) || a.id.localeCompare(b.id));
  return {
    venster,
    coverage,
    complete: coverage.every((c) => c.complete),
    besluiten: lijst,
    gelezen,
    teLezen: lijst.filter(moetGelezen).length,
    detailFouten,
  };
}

// ---------- agendapunten ----------

// Ook in samenstellingen ("Scheldekaaienloop", "Kinderrun", "Sportdag").
const SPORT = /marathon|\bhalf\b|run\b|loop\b|race\b|trail|wedstrijd|criterium|wieler|fiets|triatlon|zwem|walk\b|3x3|basket|voetbal|hockey|tennis|(?<!tran)sport|kampioenschap/i;
const slug = (value) => String(value).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "item";
const tijdPunt = (uur) => uur.replace(":", ".");
const ORGAAN_TEKST = (orgaan) => (/^college van burgemeester/i.test(orgaan ?? "") ? "het college van burgemeester en schepenen" : /^districtscollege antwerpen$/i.test(orgaan ?? "") ? "het districtscollege van district Antwerpen" : /^districtsraad antwerpen$/i.test(orgaan ?? "") ? "de districtsraad van district Antwerpen" : "eBesluit");
const korteDatum = (dag) => {
  const [, m, d] = dag.split("-").map(Number);
  return `${d} ${Object.keys(MAANDEN)[m - 1]}`;
};

// Doorlopende reeksen dagen: [["2026-10-03","2026-10-04"], ["2026-10-10"]].
function reeksen(dagen) {
  const out = [];
  for (const dag of [...new Set(dagen)].sort()) {
    const laatste = out.at(-1);
    if (laatste && addDaysIso(laatste.at(-1), 1) === dag) laatste.push(dag);
    else out.push([dag]);
  }
  return out;
}

// Wanneer wordt een besluit een agendapunt? Goedgekeurd, gelezen, met dag(en) en een plaats in het
// district. Een muziekactiviteit alleen met een organisator met rechtsvorm of een publieke instelling
// (stad, district, ...): een feest van een privépersoon hoort niet in een publieke agenda.
export function wordtAgendapunt(besluit) {
  return besluit?.status === "goedkeuring" && besluit.gelezen === true && besluit.inDistrict === true
    && Array.isArray(besluit.dagen) && besluit.dagen.length > 0 && Boolean(besluit.naam) && Boolean(besluit.plaats)
    && (besluit.soort !== "muziek" || Boolean(besluit.organisator));
}

// Twee besluiten over hetzelfde evenement: dezelfde naam, en dezelfde eerste dag (een uitzondering en
// de toekenning van het Districtsfonds) of dezelfde plaats (een muziektoelating en haar "Aanpassing data").
const RANG = Object.freeze({ evenement: 0, districtsfonds: 1, muziek: 2 });
const zelfdeEvenement = (a, b) => plat(a.naam) === plat(b.naam) && (a.dagen[0] === b.dagen[0] || plat(a.plaats) === plat(b.plaats));
const isJonger = (c, b) => (c.zitting ?? "") > (b.zitting ?? "") || ((c.zitting ?? "") === (b.zitting ?? "") && String(c.code ?? "") > String(b.code ?? ""));

// Vervangt besluit c een ouder besluit? Een intrekking altijd. Een goedkeuring als ze gelezen is en zelf
// dagen geeft, of als ze de datum aanpast ("Aanpassing data") ook zonder leesbare dagen: liever geen
// agendapunt dan de oude dagen van een verzet evenement. Een rechtzetting van iets anders (het
// geluidsniveau) zonder dagen laat de oude dagen staan. Een weigering vervangt niets.
const vervangtIets = (c) => c.status === "ingetrokken"
  || (c.status === "goedkeuring" && c.gelezen === true && ((c.dagen?.length ?? 0) > 0 || c.wijziging === "data"));

// Besluiten die door een ander besluit vervangen zijn (geen agendapunt meer):
//   - een besluit dat vervangtIets en ze in `vervangt` noemt (aanpassing, rechtzetting, intrekking);
//   - een jongere intrekking van dezelfde soort met dezelfde naam;
//   - een jonger besluit dat vervangtIets, van dezelfde soort met dezelfde naam en plaats.
export function vervangenBesluiten(besluiten = []) {
  const sleutel = new Map(besluiten.map((b) => [b, { naam: b.naam ? plat(b.naam) : "", plaats: b.plaats ? plat(b.plaats) : "" }]));
  const vervangers = besluiten.filter(vervangtIets);
  const genoemd = new Set(vervangers.flatMap((c) => c.vervangt ?? []));
  const vervangen = new Set();
  for (const b of besluiten) {
    if (b.code && genoemd.has(b.code)) { vervangen.add(b); continue; }
    const kb = sleutel.get(b);
    if (!kb.naam) continue;
    const door = vervangers.some((c) => {
      const kc = sleutel.get(c);
      if (c === b || c.soort !== b.soort || kc.naam !== kb.naam || !isJonger(c, b)) return false;
      return c.status === "ingetrokken" || (Boolean(kb.plaats) && kc.plaats === kb.plaats);
    });
    if (door) vervangen.add(b);
  }
  return vervangen;
}

// Agendapunten (bronitems) uit de besluiten: alleen wat vandaag nog loopt of komt, en niet vervangen of
// ingetrokken. Zijn er meer besluiten over hetzelfde evenement, dan telt er één: eerst een evenementbesluit,
// dan het Districtsfonds, dan een muziektoelating; bij gelijke soort het jongste besluit.
export function agendapuntenUitBesluiten(besluiten = [], { today, retrievedAt }) {
  const gekozen = [];
  const vervangen = vervangenBesluiten(besluiten);
  const volgorde = besluiten.filter((b) => !vervangen.has(b) && wordtAgendapunt(b)).sort((x, y) => RANG[x.soort] - RANG[y.soort] || (y.zitting ?? "").localeCompare(x.zitting ?? "") || String(y.code).localeCompare(String(x.code)));
  for (const b of volgorde) if (!gekozen.some((g) => zelfdeEvenement(g, b))) gekozen.push(b);
  const items = [];
  for (const b of gekozen) {
    for (const reeks of reeksen(b.dagen)) {
      const date = reeks[0], endDate = reeks.length > 1 ? reeks.at(-1) : null;
      if ((endDate ?? date) < today) continue;
      const nacht = b.uren?.einde && b.uren.einde <= b.uren.start;
      const timeText = !b.uren ? "" : b.uren.einde && !nacht ? `${tijdPunt(b.uren.start)} tot ${tijdPunt(b.uren.einde)} uur` : `vanaf ${tijdPunt(b.uren.start)} uur`;
      const postcodeTekst = b.postcodes.length === 1 && !b.plaats.includes(b.postcodes[0]) ? `, ${b.postcodes[0]} Antwerpen` : "";
      const info = [
        b.soort === "districtsfonds"
          ? `Gesteund door het Districtsfonds: beleef je buurt! (besluit van ${ORGAAN_TEKST(b.orgaan)}${b.zitting ? ` van ${korteDatum(b.zitting)}` : ""}).`
          : b.soort === "muziek"
            ? `Toelating voor een muziekactiviteit door ${ORGAAN_TEKST(b.orgaan)}${b.zitting ? ` (zitting van ${korteDatum(b.zitting)})` : ""}.`
            : `Goedgekeurd door ${ORGAAN_TEKST(b.orgaan)}${b.zitting ? ` (zitting van ${korteDatum(b.zitting)})` : ""}.`,
        b.organisator ? `Organisatie: ${b.organisator}.` : "",
        b.opbouw || b.afbouw ? `${b.opbouw ? `Opbouw vanaf ${korteDatum(b.opbouw)}` : ""}${b.opbouw && b.afbouw ? ", " : ""}${b.afbouw ? `${b.opbouw ? "afbouw" : "Afbouw"} tot ${korteDatum(b.afbouw)}` : ""}.` : "",
        nacht ? `Einde om ${tijdPunt(b.uren.einde)} uur 's nachts.` : "",
      ].filter(Boolean).join(" ");
      const sport = SPORT.test(b.naam);
      items.push({
        id: `ebesluit-ev-${slug(b.code || b.id)}-${date}`,
        externalId: b.code || b.id,
        title: clean(b.naam, 200),
        theme: sport ? "Sport" : "Activiteit",
        className: sport ? "sport" : "activity",
        date,
        endDate,
        timeSlot: b.uren?.start ?? "Info",
        timeText,
        location: clean(`${b.plaats}${postcodeTekst}`, 300),
        postcodes: b.postcodes.filter((p) => /^\d{4}$/.test(p)),
        info: info.slice(0, 600),
        kind: "activity",
        sourceUrl: b.bron,
        retrievedAt,
        reviewRequired: false,
        inDistrict: true,
      });
    }
  }
  return items;
}

// ---------- bestand evenement-besluiten.json ----------

export function besluitenDocument({ generatedAt, venster, besluiten }) {
  const lijst = besluiten.map((b) => Object.fromEntries(BESLUIT_SLEUTELS.map((k) => [k, b[k] ?? (["dagen", "straten", "postcodes", "vervangt"].includes(k) ? [] : k === "gelezen" || k === "gepubliceerd" ? false : null)])));
  const vervangen = vervangenBesluiten(lijst);
  return {
    schemaVersion: 1,
    bron: `${EBESLUIT_BASE}/`,
    methode: "eBesluit Antwerpen: besluiten over evenementen, muziekactiviteiten en het Districtsfonds, gelezen met vaste zinpatronen (lib/ebesluit-evenementen.mjs)",
    leesversie: LEESVERSIE,
    generatedAt,
    venster: { van: venster.start, tot: venster.end },
    zoektermen: [...EVENEMENT_ZOEKTERMEN],
    samenvatting: {
      besluiten: lijst.length,
      gelezen: lijst.filter((b) => b.gelezen).length,
      teLezen: lijst.filter(moetGelezen).length,
      metDag: lijst.filter((b) => b.dagen.length).length,
      inDistrict: lijst.filter((b) => b.inDistrict === true).length,
      agendapunten: lijst.filter((b) => !vervangen.has(b) && wordtAgendapunt(b)).length,
    },
    besluiten: lijst,
  };
}

const HUISNUMMER = /\b\d{1,3}[a-z]?\b/i;
const EBESLUIT_DETAIL = /^https:\/\/ebesluit\.antwerpen\.be\/zittingen\/[0-9.]+\/agendapunten\/[0-9.]+$/;
const BESLUIT_CODE = /^20\d\d_[A-Z]{2,8}_\d+$/;
const regexTekst = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Een straat van het district met een cijfer in de naam ("4 septemberpad", "De 7 schakenpad") is geen
// huisnummer: de eigen straten van het besluit gaan eerst uit de plaats.
const zonderEigenStraten = (plaats, straten) => (Array.isArray(straten) ? straten : [])
  .filter((s) => typeof s === "string" && /\d/.test(s))
  .reduce((tekst, s) => tekst.replace(new RegExp(regexTekst(s), "gi"), " "), plaats);

// Vorm en privacy van één besluit. Leeg = in orde. `at`: het pad in het bestand.
export function besluitFouten(b, at = "$") {
  if (!b || typeof b !== "object" || Array.isArray(b)) return ["geen object"];
  const errors = [];
  for (const k of Object.keys(b)) if (!BESLUIT_SLEUTELS.includes(k)) errors.push(`onbekende sleutel ${k}`);
  if (typeof b.id !== "string" || !/^[0-9.]{5,40}$/.test(b.id)) errors.push("ongeldige id");
  if (b.code !== null && !BESLUIT_CODE.test(b.code ?? "")) errors.push("ongeldige code");
  if (!SOORTEN.includes(b.soort)) errors.push("ongeldige soort");
  if (!STATUSSEN.includes(b.status)) errors.push("ongeldige status");
  if (b.zitting !== null && !isValidIsoDate(b.zitting)) errors.push("ongeldige zitting");
  if (typeof b.gepubliceerd !== "boolean" || typeof b.gelezen !== "boolean") errors.push("gepubliceerd/gelezen moet boolean zijn");
  for (const k of ["naam", "plaats", "orgaan"]) if (b[k] !== null && (typeof b[k] !== "string" || !b[k].trim() || b[k].length > 160)) errors.push(`ongeldige ${k}`);
  if (b.organisator !== null && (typeof b.organisator !== "string" || !organisatorToegelaten(b.organisator))) errors.push("organisator zonder rechtsvorm");
  if (typeof b.plaats === "string" && HUISNUMMER.test(zonderEigenStraten(b.plaats, b.straten))) errors.push("plaats met huisnummer");
  if (typeof b.naam === "string" && naamMetHuisnummer(b.naam)) errors.push("naam met huisnummer");
  if (!Array.isArray(b.dagen) || !b.dagen.every(isValidIsoDate)) errors.push("ongeldige dagen");
  if (b.uren !== null && (typeof b.uren !== "object" || !/^\d{2}:\d{2}$/.test(b.uren?.start ?? "") || (b.uren?.einde !== null && !/^\d{2}:\d{2}$/.test(b.uren?.einde ?? "")))) errors.push("ongeldige uren");
  if (!Array.isArray(b.straten) || !b.straten.every((s) => typeof s === "string" && s.length <= 120)) errors.push("ongeldige straten");
  if (!Array.isArray(b.postcodes) || !b.postcodes.every((p) => /^\d{4}$/.test(p))) errors.push("ongeldige postcodes");
  if (![true, false, null].includes(b.inDistrict)) errors.push("ongeldige inDistrict");
  for (const k of ["opbouw", "afbouw"]) if (b[k] !== null && !isValidIsoDate(b[k])) errors.push(`ongeldige ${k}`);
  if (b.wijziging !== null && !WIJZIGINGEN.includes(b.wijziging)) errors.push("ongeldige wijziging");
  if (!Array.isArray(b.vervangt) || b.vervangt.length > 10 || !b.vervangt.every((c) => BESLUIT_CODE.test(c ?? ""))) errors.push("ongeldige vervangt");
  if (!EBESLUIT_DETAIL.test(b.bron ?? "")) errors.push("ongeldige bron");
  for (const finding of privacyFindings(b, at)) errors.push(`privacy: ${finding.code} op ${finding.path}`);
  return errors;
}

// Vorm en privacy van evenement-besluiten.json. Leeg = in orde.
export function validateEvenementBesluiten(doc) {
  const errors = [];
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return ["geen object"];
  const sleutels = ["schemaVersion", "bron", "methode", "leesversie", "generatedAt", "venster", "zoektermen", "samenvatting", "besluiten"];
  for (const k of Object.keys(doc)) if (!sleutels.includes(k)) errors.push(`onbekende sleutel ${k}`);
  if (doc.schemaVersion !== 1) errors.push("schemaVersion moet 1 zijn");
  if (doc.bron !== `${EBESLUIT_BASE}/`) errors.push("ongeldige bron");
  if (!Number.isInteger(doc.leesversie)) errors.push("ongeldige leesversie");
  if (doc.generatedAt !== null && Number.isNaN(Date.parse(doc.generatedAt ?? ""))) errors.push("ongeldige generatedAt");
  if (!isValidIsoDate(doc.venster?.van) || !isValidIsoDate(doc.venster?.tot)) errors.push("ongeldig venster");
  if (!Array.isArray(doc.besluiten)) return [...errors, "besluiten is geen lijst"];
  if (doc.besluiten.length > 2000) errors.push("te veel besluiten");
  const ids = new Set();
  doc.besluiten.forEach((b, i) => {
    const at = `besluiten[${i}]`;
    for (const fout of besluitFouten(b, `$.${at}`)) errors.push(fout.startsWith("privacy:") ? fout : `${at}: ${fout}`);
    if (ids.has(b?.id)) errors.push(`${at}: dubbele id`);
    ids.add(b?.id);
  });
  for (const finding of privacyFindings({ ...doc, besluiten: [] })) errors.push(`privacy: ${finding.code} op ${finding.path}`);
  return errors;
}

// Eén ongeldig besluit legt de bron niet stil. Een besluit dat de vorm- of privacycontrole niet haalt,
// wordt eerst opgekuist (naam, organisator, plaats en orgaan weg: zo blijft het in de cache en wordt het
// geen agendapunt); lukt dat niet, dan valt het weg. Een dubbele id valt ook weg.
// { besluiten, opgekuist, weggelaten }
export function bruikbareBesluiten(besluiten = []) {
  const uit = [], ids = new Set();
  let opgekuist = 0, weggelaten = 0;
  for (const b of Array.isArray(besluiten) ? besluiten : []) {
    if (!b || typeof b !== "object" || ids.has(b.id)) { weggelaten += 1; continue; }
    const record = { ...b, wijziging: b.wijziging ?? null, vervangt: b.vervangt ?? [] };
    if (!besluitFouten(record).length) { uit.push(record); ids.add(b.id); continue; }
    const kaal = { ...record, naam: null, organisator: null, plaats: null, orgaan: null };
    if (!besluitFouten(kaal).length) { uit.push(kaal); ids.add(b.id); opgekuist += 1; continue; }
    weggelaten += 1;
  }
  return { besluiten: uit, opgekuist, weggelaten };
}
