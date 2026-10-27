// Vorm van site/sources/kaart-uitleg.json (lib/kaart-uitleg-refresh.mjs). Zonder imports uit site/,
// zodat validate-data en build-sources ook in een kale kopie van lib/ en scripts/ draaien.
export const KAART_UITLEG_FILE = "kaart-uitleg.json";

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const isDay = (v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v);
const shortStr = (v, max) => typeof v === "string" && v.length <= max;
// Een lijst straatnamen (vlakStraten bij een werk, kruist en langs bij een parcours): optioneel.
const namenLijst = (v) => Array.isArray(v) && v.length <= 2000 && v.every((n) => shortStr(n, 120) && n.length > 0);
// Vangnet voor de omschrijvingen (docs/PUBLIC_SPACE_SOURCE_POLICY.md: nooit een huisnummer): een nummer na een
// aanwijzer ("tegenover nr 12", "t.o.v. 34", "thv 5", "huisnummer 1") of direct na een straatwoord ("Voorbeeldlaan
// 12"). De filter zelf is bruikbareBeschrijving in site/kaart-uitleg.js; dit vangt een oud of fout bestand.
export const HUISNUMMER_IN_OMSCHRIJVING = /(?:\bt\.?\s?o\.?\s?v\b\.?|\btov\b|\btegenover\b|\bthv\b|\bt\.?\s?h\.?\s?v\b\.?|\bter hoogte van\b|\bhuisnummers?\b|\bhuisnr\b\.?|\bnrs?\b\.?)\s*(?:nr\.?\s*)?\d|\p{L}(?:straat|laan|lei|plein|baan|weg|kaai|vest|rui|markt|plaats|dreef|pad|hof|dijk|singel|brug)\s+\d{1,4}\b(?!\s*(?:km|k|m|meter|u|uur|h|min)\b|[:.\/]\d)/iu;
// De langste toegelaten kenmerk (`kenmerken` van een evenement): vaste woorden, geen tekst. Hoger dan het langste kenmerk dat
// kenmerkTekst kan geven (alle vaste woorden samen, KENMERK_LANGST in site/kaart-uitleg.js: tests/kaart-uitleg-kenmerk.test.mjs
// rekent het uit). Het kenmerk wordt nooit ingekort: dan kon een woord van de soort wegvallen.
export const KENMERK_MAX = 400;

// De fouten van één werk (werken[id]) of één evenement (evenementen[id]); [] als het geldig is.
export function werkFouten(id, w) {
  const errors = [];
  const at = `werken.${id}`;
  if (!/^\d{1,12}$/.test(id) || !isObj(w)) return [`${at}: ongeldig`];
  for (const k of ["soort", "soortBron", "omschrijving", "opdrachtgever", "huisnummers", "huisnummerBron", "bijgewerkt"]) if (!shortStr(w[k] ?? "", 300)) errors.push(`${at}.${k} ongeldig`);
  if (!Array.isArray(w.straten) || !Array.isArray(w.gevolgen) || !Array.isArray(w.fasen)) errors.push(`${at}: lijsten ongeldig`);
  if (w.vlakStraten !== undefined && !namenLijst(w.vlakStraten)) errors.push(`${at}.vlakStraten ongeldig`);
  // Het adres uit het adressenregister en zijn versiemerk (ADRES_REGEL in lib/kaart-uitleg-refresh.mjs: alleen 2).
  if (w.adres !== undefined && !shortStr(w.adres, 40)) errors.push(`${at}.adres ongeldig`);
  if (w.adresRegel !== undefined && w.adresRegel !== 2) errors.push(`${at}.adresRegel ongeldig`);
  // Het dossiernummer van de werfzone in A-Sign (GIPOD Reference, site/works-core.js werfDossier): alleen dat patroon.
  if (w.dossier !== undefined && !/^GW\d{4}-\d{6}$/.test(String(w.dossier))) errors.push(`${at}.dossier ongeldig`);
  // De vaste soort inname van GIPOD naast een soort uit de tekst of de fasen (werkFeiten): een kort woord.
  if (w.innameSoort !== undefined && !shortStr(w.innameSoort, 120)) errors.push(`${at}.innameSoort ongeldig`);
  if ((Array.isArray(w.fasen) ? w.fasen : []).some((f) => !isObj(f) || !shortStr(f.naam, 160) || !isDay(f.start) || !isDay(f.eind))) errors.push(`${at}.fasen ongeldig`);
  return errors;
}
export function evenementFouten(id, e) {
  const errors = [];
  const at = `evenementen.${id}`;
  if (!/^[A-Z0-9-]{4,40}$/.test(id) || !isObj(e)) return [`${at}: ongeldig`];
  if (!isDay(e.start) || !isDay(e.eind)) errors.push(`${at}: datum ongeldig`);
  if (!Array.isArray(e.straten) || !Array.isArray(e.beschrijvingen) || e.beschrijvingen.some((b) => !shortStr(b, 200))) errors.push(`${at}: lijsten ongeldig`);
  else if (e.beschrijvingen.some((b) => HUISNUMMER_IN_OMSCHRIJVING.test(b))) errors.push(`${at}.beschrijvingen: huisnummer in een omschrijving`);
  // De kenmerken (kenmerkTekst in site/kaart-uitleg.js): alleen vaste woorden in kleine letters, of "-". Nooit een
  // stuk tekst, nooit een cijfer of leesteken. Optioneel (een bestand van een oudere verversing heeft ze niet).
  if (e.kenmerken !== undefined && !(Array.isArray(e.kenmerken) && e.kenmerken.length <= 400 && e.kenmerken.every((k) => shortStr(k, KENMERK_MAX) && /^(?:-|[a-z]+(?: [a-z]+)*)$/.test(k)))) errors.push(`${at}.kenmerken ongeldig`);
  if (e.kruist !== undefined && !namenLijst(e.kruist)) errors.push(`${at}.kruist ongeldig`);
  if (e.langs !== undefined && !namenLijst(e.langs)) errors.push(`${at}.langs ongeldig`);
  if (e.kaartDeel !== undefined && typeof e.kaartDeel !== "boolean") errors.push(`${at}.kaartDeel ongeldig`);
  if (!Array.isArray(e.kaart) || e.kaart.some((l) => !Array.isArray(l) || l.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)))) errors.push(`${at}.kaart ongeldig`);
  if (e.gekoppeld !== null && !(isObj(e.gekoppeld) && shortStr(e.gekoppeld.titel, 160) && (!e.gekoppeld.bronUrl || /^https:\/\/[^?#\s]+$/.test(e.gekoppeld.bronUrl)) && (!e.gekoppeld.agendaId || /^[a-z0-9][a-z0-9-]{2,200}$/.test(e.gekoppeld.agendaId)))) errors.push(`${at}.gekoppeld ongeldig`);
  return errors;
}
// De fouten per niveau: van het document zelf (`document`: schemaVersion, generatedAt, venster, werken of evenementen
// ontbreekt) en per werk en per evenement (`werken[id]`, `evenementen[id]`, alleen de ongeldige). Zo houdt één slecht item
// het bestand niet tegen (schrijfKaartUitleg in lib/kaart-uitleg-refresh.mjs).
export function kaartUitlegFouten(doc) {
  const document = [], werken = {}, evenementen = {};
  if (!isObj(doc)) return { document: ["geen object"], werken, evenementen };
  for (const key of Object.keys(doc)) if (!["schemaVersion", "generatedAt", "vanaf", "tot", "werken", "evenementen"].includes(key)) document.push(`onverwachte sleutel ${key}`);
  if (doc.schemaVersion !== 1) document.push("schemaVersion ongeldig");
  if (!Number.isFinite(Date.parse(doc.generatedAt ?? ""))) document.push("generatedAt ongeldig");
  if (!isDay(doc.vanaf ?? "x") || !isDay(doc.tot ?? "x")) document.push("venster ongeldig");
  if (!isObj(doc.werken) || !isObj(doc.evenementen)) return { document: [...document, "werken of evenementen ontbreekt"], werken, evenementen };
  for (const [id, w] of Object.entries(doc.werken)) { const f = werkFouten(id, w); if (f.length) werken[id] = f; }
  for (const [id, e] of Object.entries(doc.evenementen)) { const f = evenementFouten(id, e); if (f.length) evenementen[id] = f; }
  return { document, werken, evenementen };
}
export function validateKaartUitleg(doc) {
  const f = kaartUitlegFouten(doc);
  return [...f.document, ...Object.values(f.werken).flat(), ...Object.values(f.evenementen).flat()];
}

