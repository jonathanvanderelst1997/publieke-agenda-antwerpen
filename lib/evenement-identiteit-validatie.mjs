// Vorm van site/sources/evenement-identiteit.json: wie of wat achter een evenementendossier van de
// stad (A-Sign) zit, met de hand nagekeken en met publieke bron. De site toont het bovenaan de
// evenementkaart (site/kaart-uitleg.js). Zonder imports uit site/, net als kaart-uitleg-validatie.
export const EVENEMENT_IDENTITEIT_FILE = "evenement-identiteit.json";
export const ZEKERHEDEN = Object.freeze(["zeker", "waarschijnlijk", "onbekend"]);

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const isDay = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const kort = (v, max) => typeof v === "string" && v.length <= max;
// Alleen een gewone https-pagina: geen query of anker (die kunnen een persoon of sessie dragen).
export const isPubliekeLink = (v) => typeof v === "string" && /^https:\/\/[^\s?#@]+$/.test(v);
const TEKST = { naam: 120, soort: 200, organisator: 200, reden: 400, uren: 300, urenNoot: 300, waar: 400, watMerkJe: 600, linkLabel: 80, linkUitleg: 160 };
// Een huisnummer na een straatnaam ("Voorbeeldlaan 32") hoort hier niet: dat kan een woning zijn.
const HUISNUMMER = /(?:straat|laan|lei|plein|baan|weg|kaai|vest|rui|markt|plaats|dreef|steenweg)\s+\d+[a-z]?\b/i;
// De status van de aanvraag komt live uit A-Sign, en de site toont alleen goedgekeurde dossiers: een
// zin als "de aanvraag is nog niet toegestaan" zou pas verschijnen als ze al niet meer klopt.
// ("Fietsers zijn niet toegestaan op het parcours" mag wel: dat gaat niet over de aanvraag.)
export const STATUSZIN = /\b(?:de|het|deze|die)\s+(?:aanvraag|dossier|toelating)\b[^.]*?\b(?:toegestaan|goedgekeurd|geweigerd|weiger\w*|in behandeling|ingediend)\b|\bweiger(?:en|t|d|ing)\b|\bgeweigerd\b/i;
// Bij een onbekend dossier zeggen we wat er in het dossier staat, of één korte eerlijke zin; geen gissing.
export const GISSING = /\b(?:mogelijk|waarschijnlijk|vermoedelijk|misschien|wellicht|allicht)\b/i;

export function validateEvenementIdentiteit(doc) {
  const errors = [];
  if (!isObj(doc)) return ["geen object"];
  for (const key of Object.keys(doc)) if (!["schemaVersion", "bijgewerkt", "uitleg", "dossiers"].includes(key)) errors.push(`onverwachte sleutel ${key}`);
  if (doc.schemaVersion !== 1) errors.push("schemaVersion ongeldig");
  if (!isDay(doc.bijgewerkt)) errors.push("bijgewerkt ongeldig");
  if (!isObj(doc.dossiers)) return [...errors, "dossiers ontbreekt"];
  for (const [id, d] of Object.entries(doc.dossiers)) {
    const at = `dossiers.${id}`;
    if (!/^ET\d{10}$/.test(id) || !isObj(d)) { errors.push(`${at}: ongeldig`); continue; }
    if (!ZEKERHEDEN.includes(d.zekerheid)) errors.push(`${at}.zekerheid ongeldig`);
    for (const [k, max] of Object.entries(TEKST)) {
      if (!kort(d[k] ?? "", max)) errors.push(`${at}.${k} ongeldig`);
      else if (HUISNUMMER.test(d[k] ?? "")) errors.push(`${at}.${k} bevat een huisnummer`);
    }
    for (const k of ["reden", "watMerkJe", "urenNoot", "uren", "waar", "soort"]) if (STATUSZIN.test(d[k] ?? "")) errors.push(`${at}.${k} bevat de status van de aanvraag`);
    if (d.zekerheid === "onbekend") for (const k of ["watMerkJe", "waar", "reden"]) if (GISSING.test(d[k] ?? "")) errors.push(`${at}.${k} gist bij een onbekend dossier`);
    if (d.zekerheid === "zeker" && !d.naam) errors.push(`${at}: zeker zonder naam`);
    if (d.zekerheid === "waarschijnlijk" && (!d.soort || !d.reden)) errors.push(`${at}: waarschijnlijk zonder soort of reden`);
    if (d.zekerheid === "onbekend" && d.naam) errors.push(`${at}: onbekend met een naam`);
    if (!Array.isArray(d.dagen) || !d.dagen.length || !d.dagen.every(isDay)) errors.push(`${at}.dagen ongeldig`);
    if (d.link && !isPubliekeLink(d.link)) errors.push(`${at}.link ongeldig`);
    if (!Array.isArray(d.extraLinks) || d.extraLinks.some((l) => !isObj(l) || !kort(l.label, 100) || !l.label || !isPubliekeLink(l.url))) errors.push(`${at}.extraLinks ongeldig`);
    if (!Array.isArray(d.bron) || !d.bron.length || !d.bron.every(isPubliekeLink)) errors.push(`${at}.bron ongeldig`);
    if (typeof d.binnenDistrict !== "boolean") errors.push(`${at}.binnenDistrict ongeldig`);
    if (!isDay(d.bijgewerkt)) errors.push(`${at}.bijgewerkt ongeldig`);
  }
  return errors;
}
