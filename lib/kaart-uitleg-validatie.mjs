// Vorm van site/sources/kaart-uitleg.json (lib/kaart-uitleg-refresh.mjs). Zonder imports uit site/,
// zodat validate-data en build-sources ook in een kale kopie van lib/ en scripts/ draaien.
export const KAART_UITLEG_FILE = "kaart-uitleg.json";

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const isDay = (v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v);
const shortStr = (v, max) => typeof v === "string" && v.length <= max;
export function validateKaartUitleg(doc) {
  const errors = [];
  if (!isObj(doc)) return ["geen object"];
  for (const key of Object.keys(doc)) if (!["schemaVersion", "generatedAt", "vanaf", "tot", "werken", "evenementen"].includes(key)) errors.push(`onverwachte sleutel ${key}`);
  if (doc.schemaVersion !== 1) errors.push("schemaVersion ongeldig");
  if (!Number.isFinite(Date.parse(doc.generatedAt ?? ""))) errors.push("generatedAt ongeldig");
  if (!isDay(doc.vanaf ?? "x") || !isDay(doc.tot ?? "x")) errors.push("venster ongeldig");
  if (!isObj(doc.werken) || !isObj(doc.evenementen)) return [...errors, "werken of evenementen ontbreekt"];
  for (const [id, w] of Object.entries(doc.werken)) {
    const at = `werken.${id}`;
    if (!/^\d{1,12}$/.test(id) || !isObj(w)) { errors.push(`${at}: ongeldig`); continue; }
    for (const k of ["soort", "soortBron", "omschrijving", "opdrachtgever", "huisnummers", "huisnummerBron", "bijgewerkt"]) if (!shortStr(w[k] ?? "", 300)) errors.push(`${at}.${k} ongeldig`);
    if (!Array.isArray(w.straten) || !Array.isArray(w.gevolgen) || !Array.isArray(w.fasen)) errors.push(`${at}: lijsten ongeldig`);
    if ((w.fasen || []).some((f) => !isObj(f) || !shortStr(f.naam, 160) || !isDay(f.start) || !isDay(f.eind))) errors.push(`${at}.fasen ongeldig`);
  }
  for (const [id, e] of Object.entries(doc.evenementen)) {
    const at = `evenementen.${id}`;
    if (!/^[A-Z0-9-]{4,40}$/.test(id) || !isObj(e)) { errors.push(`${at}: ongeldig`); continue; }
    if (!isDay(e.start) || !isDay(e.eind)) errors.push(`${at}: datum ongeldig`);
    if (!Array.isArray(e.straten) || !Array.isArray(e.beschrijvingen) || e.beschrijvingen.some((b) => !shortStr(b, 200))) errors.push(`${at}: lijsten ongeldig`);
    if (e.langs !== undefined && (!Array.isArray(e.langs) || e.langs.some((s) => !shortStr(s, 120)))) errors.push(`${at}.langs ongeldig`);
    if (!Array.isArray(e.kaart) || e.kaart.some((l) => !Array.isArray(l) || l.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)))) errors.push(`${at}.kaart ongeldig`);
    if (e.gekoppeld !== null && !(isObj(e.gekoppeld) && shortStr(e.gekoppeld.titel, 160) && (!e.gekoppeld.bronUrl || /^https:\/\/[^?#\s]+$/.test(e.gekoppeld.bronUrl)) && (!e.gekoppeld.agendaId || /^[a-z0-9][a-z0-9-]{2,200}$/.test(e.gekoppeld.agendaId)))) errors.push(`${at}.gekoppeld ongeldig`);
  }
  return errors;
}

