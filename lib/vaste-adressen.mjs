// Altijd het exacte adres, met huisnummer (regel van de eigenaar van 26-10-2026, herhaald op 4-11-2026: "always the
// exact house number"). Een activiteit wordt daarvoor NOOIT tegengehouden:
//
// 1. Noemt een bron een vaste plek alleen bij naam ("Provinciehuis Antwerpen", "Districtshuis Antwerpen - zaal Benoit")
//    of zonder huisnummer ("De Groene Waterman, Wolstraat, 2000 Antwerpen", een lezing van vóór #218), dan komt het
//    officiële adres uit site/sources/vaste-adressen.json erbij (metVastAdres). De adressen staan in dat databestand,
//    met per plek de officiële pagina die het adres noemt, niet in de code: een echt adres hoort niet in code, toetsen
//    of commitboodschappen (lib/echte-adressen.mjs).
// 2. Is er dan nog geen huisnummer en is de plek een gebouw (geen straat, plein, markt, park of buurt; plaatsSoort),
//    dan staat de activiteit gewoon op de site, en komt ze op de lijst "huisnummer ontbreekt" in de ene melding van de
//    bronstatus (ontbrekendeHuisnummers; scripts/sources-health.mjs, het alarm-issue: één keer per activiteit).
//
// Puur, zonder netwerk; scripts/build-sources.mjs past metVastAdres toe op elk bronitem vóór het samenvoegen.
export const VASTE_ADRESSEN_FILE = "vaste-adressen.json";

const plat = (value) => String(value ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// Een huisnummer: een getal van 1 tot 3 cijfers (eventueel met een letter) dat geen postcode van vier cijfers is.
export const heeftHuisnummer = (value) => /\b\d{1,3}[a-z]?\b/i.test(String(value ?? "").replace(/\b\d{4}\b/g, " "));
const ADRES = /^[^,\d]+ \d{1,4}[a-z]?(?:-\d{1,4}[a-z]?)?, \d{4} [^,\d]+$/i;

export function validateVasteAdressen(document) {
  const errors = [];
  if (!document || typeof document !== "object" || Array.isArray(document)) return ["document is geen object"];
  if (document.schemaVersion !== 1) errors.push("schemaVersion moet 1 zijn");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(document.bijgewerkt ?? ""))) errors.push("ongeldige bijgewerkt");
  if (!Array.isArray(document.plekken) || !document.plekken.length) return [...errors, "plekken ontbreekt"];
  const gezien = new Set();
  document.plekken.forEach((plek, index) => {
    const at = `plekken[${index}]`;
    const keys = plek && typeof plek === "object" ? Object.keys(plek) : [];
    for (const key of keys) if (!["naam", "herken", "adres", "bron"].includes(key)) errors.push(`${at}: onbekende sleutel ${key}`);
    if (typeof plek?.naam !== "string" || !plek.naam.trim()) errors.push(`${at}: naam ontbreekt`);
    if (!Array.isArray(plek?.herken) || !plek.herken.length || !plek.herken.every((h) => typeof h === "string" && plat(h).length >= 6 && !heeftHuisnummer(h))) {
      errors.push(`${at}: herken moet een lijst namen zonder huisnummer zijn`);
    }
    for (const h of Array.isArray(plek?.herken) ? plek.herken : []) {
      if (gezien.has(plat(h))) errors.push(`${at}: dubbele herkenning ${h}`);
      gezien.add(plat(h));
    }
    if (typeof plek?.adres !== "string" || !ADRES.test(plek.adres)) errors.push(`${at}: adres moet "straat nummer, postcode gemeente" zijn`);
    try {
      const url = new URL(String(plek?.bron ?? ""));
      if (url.protocol !== "https:" || url.search || url.hash) errors.push(`${at}: bron moet een https-pagina zonder query zijn`);
    } catch {
      errors.push(`${at}: ongeldige bron`);
    }
  });
  return errors;
}

// Het deel na de plek dat het adres al zegt: de straat van het adres (zonder nummer), postcode en gemeente, een
// district of een opmerking tussen haakjes ("(plaats volgens het bericht)"). Dat valt weg, zodat er geen straat of
// gemeente dubbel staat.
function overbodig(deel, adres) {
  const d = plat(deel.replace(/\([^)]*\)/g, " "));
  if (!d) return true;
  const a = plat(adres);
  const straat = plat(adres.split(",")[0].replace(/\s+\d.*$/, ""));
  return d === straat || a.includes(d) || /^\d{4}( [a-z -]+)?$/.test(d) || /^(district|stad) [a-z -]+$/.test(d) || /^antwerpen$/.test(d);
}

// De locatie met het officiële adres, of de locatie zoals ze was. De naam zoals de bron ze schrijft blijft vooraan
// ("Districtshuis Antwerpen - zaal Benoit, <adres>"); wat het adres al zegt, valt weg ("De Groene Waterman, Wolstraat,
// 2000 Antwerpen." wordt "De Groene Waterman, <straat> <nummer>, 2000 Antwerpen").
export function metVastAdres(location, document) {
  const tekst = String(location ?? "").replace(/\s+/g, " ").trim();
  if (!tekst || heeftHuisnummer(tekst) || !Array.isArray(document?.plekken)) return location;
  const delen = tekst.split(/\s*,\s*/).map((deel) => deel.replace(/[\s.;]+$/, "")).filter(Boolean);
  const kop = plat(delen[0]);
  for (const plek of document.plekken) {
    for (const naam of plek.herken ?? []) {
      const h = plat(naam);
      if (kop !== h && !kop.startsWith(`${h} `)) continue;
      const rest = delen.slice(1).filter((deel) => !overbodig(deel, plek.adres));
      return [delen[0], ...rest, plek.adres].join(", ");
    }
  }
  return location;
}

// Hetzelfde voor een agendapunt: alleen `location` verandert.
export function itemMetVastAdres(item, document) {
  const location = metVastAdres(item?.location, document);
  return location === item?.location ? item : { ...item, location };
}

// ---------- gebouw of openbare ruimte ----------
// Een plek in de openbare ruimte (straat, plein, markt, park, kaai, buurt …) heeft geen huisnummer; een gebouw wel.
// Een woord dat op zo'n soort eindigt, telt als openbare ruimte ("Wolstraat", "Sint-Jansplein", "Park Gravenhof").
const OPENBAAR_WOORD = /(straat|steenweg|laan|lei|plein|plaats|markt|park|kaai|vest|dreef|weg|singel|dijk|brug|tunnel|strand|dok|dokken|wijk|vliet|veld|reitje|polder|haven|zone|parcours|route)$/;
// Hele woorden die een gebied zijn, geen gebouw ("Toeristisch centrum Antwerpen", "Speelweefselplan Binnenstad").
const GEBIED_WOORD = new Set(["centrum", "binnenstad", "district", "stad", "buurt", "wijk", "omgeving", "parcours", "route", "tussen", "kruispunt", "hoek", "seefhoek", "linkeroever", "kiel"]);
// Geen plek: de bron noemt geen plaats.
const VAAG = /locatie via de officiele bron|plaats volgens het bericht|exacte ligging volgens gipod|^online$|^digitaal|^verschillende locaties|^diverse locaties/;

function soortVanDeel(deel, { straatnamen, gebieden }) {
  const d = plat(deel.replace(/\([^)]*\)/g, " "));
  if (!d || VAAG.test(d)) return "leeg";
  if (/^\d{4}( [a-z -]+)?$/.test(d) || /^(antwerpen|district [a-z -]+|stad antwerpen)$/.test(d)) return "gebied";
  if (straatnamen.has(d) || gebieden.has(d)) return "openbaar";
  const woorden = d.split(" ");
  if (woorden.some((woord) => OPENBAAR_WOORD.test(woord) || GEBIED_WOORD.has(woord))) return "openbaar";
  if (woorden.some((woord) => straatnamen.has(woord))) return "openbaar";
  return "gebouw";
}

// "huisnummer" (er staat al een nummer), "gebouw" (een benoemde plek zonder nummer), "openbare_ruimte" (straten,
// pleinen, parken, buurten, postcodes) of "onbekend" (de bron noemt geen plaats).
export function plaatsSoort(location, { straatnamen = new Set(), gebieden = new Set() } = {}) {
  const tekst = String(location ?? "").replace(/\s+/g, " ").trim();
  if (!tekst) return "onbekend";
  if (heeftHuisnummer(tekst)) return "huisnummer";
  const delen = tekst.replace(/\([^)]*\)/g, (m) => (/plaats volgens|locatie via/i.test(m) ? ", locatie via de officiele bron" : " "))
    .split(/\s*(?:,|;|\s\+\s|\s-\s|\sen\s)\s*/).map((deel) => deel.trim()).filter(Boolean);
  const soorten = delen.map((deel) => soortVanDeel(deel, { straatnamen, gebieden }));
  if (soorten.includes("gebouw")) return "gebouw";
  // Alleen een district, postcode of gemeente, en verder niets of "locatie via de officiële bron": geen plaats.
  if (!soorten.includes("openbaar") && (soorten.includes("leeg") || !soorten.length)) return "onbekend";
  return "openbare_ruimte";
}

// De straatnamen en buurten die plaatsSoort kent, uit de geodata van de site (site/geo/straten.json,
// site/geo/straten-stad.json, site/geo/wijken.geo.json).
export function plaatsKennis({ straten = null, stratenStad = null, wijken = null } = {}) {
  const straatnamen = new Set();
  for (const rij of straten?.streets ?? []) if (rij?.[1]) straatnamen.add(plat(rij[1]));
  for (const rij of stratenStad?.straten ?? []) if (rij?.[0]) straatnamen.add(plat(rij[0]));
  const gebieden = new Set();
  for (const feature of wijken?.features ?? []) if (feature?.properties?.naam) gebieden.add(plat(feature.properties.naam));
  for (const district of stratenStad?.districten ?? []) if (district?.label) gebieden.add(plat(district.label));
  return { straatnamen, gebieden };
}

// De komende activiteiten (laatste dag vandaag of later) waarvan de plek een gebouw is zonder huisnummer, ook na het
// aanvullen uit de lijst. Ze staan gewoon op de site; deze lijst is voor de eigenaar, zodat het adres aangevuld wordt.
export function ontbrekendeHuisnummers(items, today, { vasteAdressen = null, kennis = {} } = {}) {
  const gezien = new Set();
  const uit = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item?.id || gezien.has(item.id)) continue;
    if (String(item.endDate || item.date || "") < today) continue;
    const location = metVastAdres(item.location, vasteAdressen);
    if (plaatsSoort(location, kennis) !== "gebouw") continue;
    gezien.add(item.id);
    uit.push({ id: item.id, date: item.date, title: String(item.title ?? "").trim(), location: String(location ?? "").trim(), sourceId: item.sourceId ?? null });
  }
  return uit.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
