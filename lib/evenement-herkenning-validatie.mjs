// Vorm van de twee bestanden die de automatische parcoursherkenner schrijft (lib/parcours-herkenning.mjs):
// site/sources/evenement-identiteit-auto.json (fiches in hetzelfde schema als de handfiches, plus
// methode, signalen, kaartzin en goedgekeurd) en site/sources/evenement-patronen.json (routes van
// herkende dossiers, voor de stap patroon). Zonder imports uit site/, net als de andere validaties.
import { validateEvenementIdentiteit } from "./evenement-identiteit-validatie.mjs";

export const HERKENNING_FILE = "evenement-identiteit-auto.json";
export const PATRONEN_FILE = "evenement-patronen.json";
export const METHODES = Object.freeze(["kalender", "gipod", "organisator", "patroon", "regels", "kaart"]);
// "zeker" mag alleen uit een bron die dag én plek noemt.
export const ZEKERE_METHODES = Object.freeze(["kalender", "gipod", "organisator"]);
const SAMENVATTING = ["dossiers", "metHandfiche", "automatisch", "zeker", "waarschijnlijk", "alleenKaartzin"];

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const isDay = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isInt = (v) => Number.isInteger(v) && v >= 0;
const punt = (p) => Array.isArray(p) && p.length === 2 && p[0] > 4 && p[0] < 5 && p[1] > 51 && p[1] < 52;

export function validateHerkenning(doc) {
  if (!isObj(doc)) return ["geen object"];
  const errors = [];
  for (const key of Object.keys(doc)) if (!["schemaVersion", "generatedAt", "bijgewerkt", "uitleg", "samenvatting", "dossiers"].includes(key)) errors.push(`onverwachte sleutel ${key}`);
  if (typeof doc.generatedAt !== "string" || !Number.isFinite(Date.parse(doc.generatedAt))) errors.push("generatedAt ongeldig");
  if (!isObj(doc.samenvatting) || SAMENVATTING.some((k) => !isInt(doc.samenvatting[k]))) errors.push("samenvatting ongeldig");
  // Dezelfde regels als voor de handfiches (schema, huisnummers, status, gissing, links).
  errors.push(...validateEvenementIdentiteit({ schemaVersion: doc.schemaVersion, bijgewerkt: doc.bijgewerkt, uitleg: doc.uitleg, dossiers: doc.dossiers }));
  for (const [id, d] of Object.entries(isObj(doc.dossiers) ? doc.dossiers : {})) {
    const at = `dossiers.${id}`;
    if (!isObj(d)) continue;
    if (!METHODES.includes(d.methode)) errors.push(`${at}.methode ongeldig`);
    if (d.zekerheid === "zeker" && !ZEKERE_METHODES.includes(d.methode)) errors.push(`${at}: zeker zonder bron die dag en plek noemt`);
    if (d.zekerheid === "zeker" && (!Array.isArray(d.bron) || d.bron.length < 2)) errors.push(`${at}: zeker zonder eigen bron`);
    if (!Array.isArray(d.signalen) || d.signalen.length > 8 || d.signalen.some((s) => typeof s !== "string" || !s || s.length > 200)) errors.push(`${at}.signalen ongeldig`);
    if (typeof d.kaartzin !== "string" || !d.kaartzin || d.kaartzin.length > 500) errors.push(`${at}.kaartzin ongeldig`);
    if (typeof d.goedgekeurd !== "boolean") errors.push(`${at}.goedgekeurd ongeldig`);
    for (const k of Object.keys(d)) if (!KEYS.includes(k)) errors.push(`${at}: onverwachte sleutel ${k}`);
  }
  return errors;
}
const KEYS = ["zekerheid", "naam", "soort", "organisator", "reden", "dagen", "uren", "urenNoot", "waar", "watMerkJe", "link", "linkLabel", "linkUitleg", "extraLinks", "binnenDistrict", "bron", "bijgewerkt", "methode", "signalen", "kaartzin", "goedgekeurd"];

export function validatePatronen(doc) {
  if (!isObj(doc)) return ["geen object"];
  const errors = [];
  for (const key of Object.keys(doc)) if (!["schemaVersion", "bijgewerkt", "uitleg", "patronen", "cache"].includes(key)) errors.push(`onverwachte sleutel ${key}`);
  if (doc.schemaVersion !== 1) errors.push("schemaVersion ongeldig");
  if (!isDay(doc.bijgewerkt)) errors.push("bijgewerkt ongeldig");
  if (!isObj(doc.patronen)) return [...errors, "patronen ontbreekt"];
  for (const [id, p] of Object.entries(doc.patronen)) {
    const at = `patronen.${id}`;
    if (!/^ET\d{10}$/.test(id) || !isObj(p)) { errors.push(`${at}: ongeldig`); continue; }
    if (!isDay(p.dag)) errors.push(`${at}.dag ongeldig`);
    if (!["zeker", "waarschijnlijk"].includes(p.zekerheid)) errors.push(`${at}.zekerheid ongeldig`);
    if (p.zekerheid === "zeker" && !p.naam) errors.push(`${at}: zeker zonder naam`);
    for (const [k, max] of [["naam", 120], ["soort", 200], ["organisator", 200], ["link", 300]]) if (typeof p[k] !== "string" || p[k].length > max) errors.push(`${at}.${k} ongeldig`);
    if (p.link && !/^https:\/\/[^\s?#@]+$/.test(p.link)) errors.push(`${at}.link ongeldig`);
    if (!["hand", "auto"].includes(p.bron)) errors.push(`${at}.bron ongeldig`);
    const lijnen = p.vorm?.lijnen, vlakken = p.vorm?.vlakken;
    const okLijn = (l) => Array.isArray(l) && l.length >= 2 && l.length <= 2000 && l.every(punt);
    if (!Array.isArray(lijnen) || !Array.isArray(vlakken) || !lijnen.every(okLijn) || !vlakken.every((rings) => Array.isArray(rings) && rings.every(okLijn)) || (!lijnen.length && !vlakken.length)) errors.push(`${at}.vorm ongeldig`);
  }
  if (doc.cache !== undefined) {
    if (!isObj(doc.cache) || !isObj(doc.cache.historiek ?? {}) || !isObj(doc.cache.straten ?? {})) errors.push("cache ongeldig");
    for (const [id, h] of Object.entries(doc.cache?.historiek || {})) {
      if (!/^ET\d{10}$/.test(id) || !isObj(h) || typeof h.sleutel !== "string" || !Array.isArray(h.items)) { errors.push(`cache.historiek.${id} ongeldig`); continue; }
      if (h.items.some((x) => !isObj(x) || !/^ET\d{10}$/.test(x.dossier) || !/^\d{4}$/.test(x.jaar) || !Array.isArray(x.soorten) || x.soorten.some((s) => !/^[a-z]{3,12}$/.test(s)) || typeof x.overlap !== "number")) errors.push(`cache.historiek.${id} ongeldig`);
    }
    for (const [k, v] of Object.entries(doc.cache?.straten || {})) if (!/^\d\.\d{4},\d{2}\.\d{4}$/.test(k) || typeof v !== "string" || v.length > 120) errors.push(`cache.straten.${k} ongeldig`);
  }
  return errors;
}
