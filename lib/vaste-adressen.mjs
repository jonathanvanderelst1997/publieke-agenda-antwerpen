// Vaste plekken met hun officiële adres (regel van de eigenaar van 26-10-2026: bij een activiteit altijd het exacte
// adres, met huisnummer). Sommige bronnen noemen alleen de zaal: eBesluit schrijft "Provinciehuis Antwerpen" of
// "Districtshuis Antwerpen - zaal Benoit", zonder straat. De adressen zelf staan in de data
// (site/sources/vaste-adressen.json, met per plek de officiële pagina die het adres noemt), niet in de code: een echt
// adres hoort niet in code, toetsen of commitboodschappen (lib/echte-adressen.mjs).
//
// Een locatie die met de naam van een vaste plek begint en nog geen huisnummer heeft, krijgt het adres erachter:
// "<locatie zoals de bron ze schrijft>, <straat> <nummer>, <postcode> <gemeente>". Een locatie met een huisnummer,
// of een plek die er niet in staat, blijft zoals ze is. Puur, zonder netwerk; scripts/build-sources.mjs past het toe
// op elk bronitem vóór het samenvoegen.
export const VASTE_ADRESSEN_FILE = "vaste-adressen.json";

const plat = (value) => String(value ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// Een huisnummer: een getal dat geen postcode van vier cijfers is.
const heeftHuisnummer = (value) => /\b\d{1,3}[a-z]?\b/i.test(String(value ?? "").replace(/\b\d{4}\b/g, " "));
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

// De locatie met het officiële adres erachter, of de locatie zoals ze was.
export function metVastAdres(location, document) {
  const tekst = String(location ?? "").replace(/\s+/g, " ").trim();
  if (!tekst || heeftHuisnummer(tekst) || !Array.isArray(document?.plekken)) return location;
  const sleutel = plat(tekst);
  for (const plek of document.plekken) {
    for (const naam of plek.herken ?? []) {
      const h = plat(naam);
      if (sleutel === h || sleutel.startsWith(`${h} `)) return `${tekst.replace(/[\s,.;]+$/, "")}, ${plek.adres}`;
    }
  }
  return location;
}

// Hetzelfde voor een agendapunt: alleen `location` verandert.
export function itemMetVastAdres(item, document) {
  const location = metVastAdres(item?.location, document);
  return location === item?.location ? item : { ...item, location };
}
