// Controle van de vaste vorm per werk (site/werk-vorm.js) in wat de repo bewaart, voor scripts/validate-data.mjs:
// - regel 35: site/sources/werk-vorm.json is geldig en kent elk werk-id van de historiek, het archief, kaart-uitleg.json en
//   de straatbestanden;
// - regel 36: kaart-uitleg.json: een werk is een adreskaart precies als zijn id in "adreskaart" staat; een adreskaart heeft
//   geen vrije tekst, een gewone kaart alleen een geldig huisnummer;
// - regel 37: de historiek en de straatbestanden: een adreskaart staat er als "<soort> – <straat> <nummer>" (met een geldig
//   nummer of zonder), met een groep of niets als opdrachtgever en fasen met een vaste naam ("Fase 2", "Deel 3", "Fase");
//   nergens in de werkenlaag een spoor van een verhuizing (regel van de eigenaar van 26 oktober 2026: het huisnummer staat
//   er altijd, het woord verhuis nooit).
// De meldingen noemen alleen een pad en een code, nooit een waarde (de logs zijn publiek).
import fs from "node:fs";
import path from "node:path";

import { GEEN_TITEL, VERHUIS_SPOOR, werkVormDocument, werkVormFouten } from "../site/werk-vorm.js";
import { ADRESKAART_FASE, geldigeHuisnummers, isSoortLabel, isWerfDossier, nummerWegCode } from "../site/kaart-uitleg.js";
import { GROEPEN } from "../site/works-core.js";
import { WERK_VORM_PAD, gepubliceerdeWerkIds } from "./werk-vorm-bestand.mjs";
import { LIVE_HISTORY_FILE } from "./live-history.mjs";
import { LIVE_HISTORY_ARCHIVE_DIR } from "./live-history-archive.mjs";
import { KAART_UITLEG_FILE } from "./kaart-uitleg-validatie.mjs";

const isObject = (v) => v && typeof v === "object" && !Array.isArray(v);
const leesJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
const isWerk = (x) => isObject(x) && /^work:\d+$/.test(String(x.id || ""));
const werkId = (x) => Number(String(x?.id || "").slice(5));

// Elke tekst (ook dieper) met het spoor: de paden.
function sporen(waarde, at, uit = []) {
  if (typeof waarde === "string") { if (VERHUIS_SPOOR.test(waarde)) uit.push(at); }
  else if (Array.isArray(waarde)) waarde.forEach((v, i) => sporen(v, `${at}[${i}]`, uit));
  else if (isObject(waarde)) for (const [k, v] of Object.entries(waarde)) sporen(v, `${at}.${k}`, uit);
  return uit;
}

// Een titel van een adreskaart: "<soort> – <straat> <nummer>", "<soort> – <straat>" of "<soort>" (titelAdreskaart). Het
// nummer is een geldig huisnummer of een reeks ("12", "12A", "12–14"). `straten`: de straten van het item, als het ze heeft
// (een gewijzigd veld in de historiek heeft ze niet).
export function isAdreskaartTitel(titel, straten = null) {
  if (typeof titel !== "string") return false;
  const [soort, adres, ...rest] = titel.split(" – ");
  if (rest.length || !(soort === GEEN_TITEL || (soort && isSoortLabel(soort)))) return false;
  if (adres === undefined) return true;
  const m = adres.match(/^(.*?)(?: (\d{1,3}[a-z]?(?:–\d{1,3}[a-z]?)?))?$/i);
  const straat = m?.[1] || "";
  if (!straat || /\d/.test(straat) || (m[2] && !geldigeHuisnummers(`nr. ${m[2]}`))) return false;
  return !Array.isArray(straten) || straten.includes(straat);
}
// Eén item (of een gewijzigd veld) van een adreskaart in de historiek of een straatbestand.
export function adreskaartItemFouten(item, { straten = null } = {}) {
  const fouten = [];
  if (!isObject(item)) return fouten;
  if ("title" in item && !isAdreskaartTitel(item.title, straten)) fouten.push("titel");
  if ("owner" in item && item.owner !== "" && !GROEPEN.includes(item.owner)) fouten.push("opdrachtgever");
  if ("huisnummers" in item && item.huisnummers !== "" && !geldigeHuisnummers(item.huisnummers)) fouten.push("huisnummers");
  if ("huisnummerWeg" in item && !nummerWegCode(item.huisnummerWeg)) fouten.push("huisnummerWeg");
  for (const fase of Array.isArray(item.hindrance?.phases) ? item.hindrance.phases : []) {
    if (fase?.description && !ADRESKAART_FASE.test(fase.description)) { fouten.push("fase"); break; }
  }
  return fouten;
}
// Eén werk van kaart-uitleg.json (regel 36). `adres`: het id staat in "adreskaart".
export function kaartUitlegWerkFouten(w, adres) {
  if (!isObject(w)) return [];
  const fouten = [];
  if ((w.adresKaart === true) !== adres) fouten.push(adres ? "geen adreskaart" : "adreskaart buiten de lijst");
  if (w.adresKaart === true) {
    if (w.omschrijving) fouten.push("omschrijving");
    if ((w.fasen || []).some((f) => !ADRESKAART_FASE.test(String(f?.naam || "")))) fouten.push("fase");
    if (w.opdrachtgever && !GROEPEN.includes(w.opdrachtgever)) fouten.push("opdrachtgever");
    if ("dossier" in w && !isWerfDossier(w.dossier)) fouten.push("dossier");
    if (w.huisnummers && !geldigeHuisnummers(w.huisnummers)) fouten.push("huisnummers");
    if ("huisnummerWeg" in w && (!nummerWegCode(w.huisnummerWeg) || w.huisnummers)) fouten.push("huisnummerWeg");
    if (!isSoortLabel(w.soort) || ("innameSoort" in w && !isSoortLabel(w.innameSoort))) fouten.push("soort");
  } else {
    // Een gewone kaart toont het huisnummer (regel van de eigenaar van 26 oktober 2026), maar alleen een geldig nummer of
    // een reeks. De oude vlag `eenAdres` zou zeggen dat het een verhuis was.
    if ("huisnummerWeg" in w) fouten.push("huisnummerWeg");
    if (w.huisnummers && !geldigeHuisnummers(w.huisnummers)) fouten.push("huisnummers");
    if ("eenAdres" in w) fouten.push("eenAdres");
  }
  return fouten;
}

export function werkVormProblemen(rootDir) {
  const problemen = [];
  const vormFile = path.join(rootDir, WERK_VORM_PAD);
  // Geen bestand: een lege vaste vorm (zoals de verversing het leest); een gepubliceerd werk ontbreekt dan hieronder.
  const vorm = fs.existsSync(vormFile) ? leesJson(vormFile) : werkVormDocument();
  if (!vorm) return [`${WERK_VORM_PAD}: geen geldige JSON`];
  const fouten = werkVormFouten(vorm);
  if (fouten.length) return fouten.map((f) => `${WERK_VORM_PAD}: ${f}`);
  const adreskaart = new Set(vorm.adreskaart), gewoon = new Set(vorm.gewoon);
  // Regel 35.
  const ontbreekt = [...gepubliceerdeWerkIds(rootDir, { straten: true })].filter((id) => !adreskaart.has(id) && !gewoon.has(id));
  if (ontbreekt.length) problemen.push(`${WERK_VORM_PAD}: ${ontbreekt.length} gepubliceerde werk-ids ontbreken (oplossing: node scripts/maak-werk-vorm.mjs --overgang)`);

  // Regel 36.
  const uitlegPad = `site/sources/${KAART_UITLEG_FILE}`;
  const uitleg = leesJson(path.join(rootDir, uitlegPad));
  for (const [id, w] of Object.entries(uitleg?.werken || {})) {
    for (const f of kaartUitlegWerkFouten(w, adreskaart.has(Number(id)))) problemen.push(`${uitlegPad}: werken.${id}: ${f}`);
    for (const p of sporen(w, `werken.${id}`)) problemen.push(`${uitlegPad}: spoor op ${p}`);
  }

  // Regel 37: de historiek, het archief en de straatbestanden.
  const nakijken = (relatief, item, at, straten) => {
    if (!isWerk(item)) return;
    if (adreskaart.has(werkId(item))) for (const f of adreskaartItemFouten(item, { straten })) problemen.push(`${relatief}: adreskaart ${f} op ${at}`);
    for (const p of sporen(item, at)) problemen.push(`${relatief}: spoor op ${p}`);
  };
  const namen = (item) => (Array.isArray(item?.streets) ? item.streets.map((s) => s?.name).filter(Boolean) : null);
  const wijziging = (relatief, entry, at) => {
    if (!isWerk(entry)) return;
    for (const kant of ["before", "after"]) {
      const v = entry[kant];
      if (!isObject(v)) continue;
      nakijken(relatief, { ...v, id: entry.id }, `${at}.${kant}`, namen(v));
    }
  };
  const live = leesJson(path.join(rootDir, LIVE_HISTORY_FILE));
  (live?.layers?.works?.items || []).forEach((item, i) => nakijken(LIVE_HISTORY_FILE, item, `$.layers.works.items[${i}]`, namen(item)));
  (live?.changes || []).forEach((entry, i) => wijziging(LIVE_HISTORY_FILE, entry, `$.changes[${i}]`));
  const archief = path.join(rootDir, LIVE_HISTORY_ARCHIVE_DIR);
  for (const naam of fs.existsSync(archief) ? fs.readdirSync(archief).filter((n) => n.endsWith(".json")).sort() : []) {
    const relatief = `${LIVE_HISTORY_ARCHIVE_DIR}/${naam}`;
    const doc = leesJson(path.join(archief, naam));
    (doc?.layers?.works?.items || []).forEach((item, i) => nakijken(relatief, item, `$.layers.works.items[${i}]`, namen(item)));
    (doc?.events || []).forEach((entry, i) => wijziging(relatief, entry, `$.events[${i}]`));
  }
  const straatMap = path.join(rootDir, "site", "straat");
  for (const naam of fs.existsSync(straatMap) ? fs.readdirSync(straatMap).filter((n) => /^\d+\.json$/.test(n)).sort() : []) {
    const relatief = `site/straat/${naam}`;
    const doc = leesJson(path.join(straatMap, naam));
    const tabel = Array.isArray(doc?.straten) ? doc.straten : [];
    (doc?.werken || []).forEach((item, i) => nakijken(relatief, item, `$.werken[${i}]`, Array.isArray(item?.streets) ? item.streets.map((k) => tabel[k]?.[1]).filter(Boolean) : null));
  }
  return problemen;
}
