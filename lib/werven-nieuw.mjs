// Nieuwe werven van de laatste zeven dagen (site/sources/werven-nieuw.json), elke verversing opnieuw.
//
// Waarom: in de raadscommissie van 17 november 2026 vroeg de eigenaar de stad om elke week een overzicht van alle
// nieuwe werven, zodat werven zichtbaar zijn. De werken staan al op de site (live uit GIPOD); wat ontbrak, is wat er
// deze week bij kwam.
//
// Wat "nieuw" is: een GIPOD-nummer dat de site deze week voor het eerst zag. Het archief van de historiek
// (site/history/archive) noteert elke dag wat erbij kwam, maar een werk dat even uit GIPOD verdwijnt en terugkomt, komt
// daar opnieuw als "added" (13 november 2026: 222 bij, 131 weg). Daarom telt hier alleen de eerste keer: de baseline
// (1 oktober 2026) en elke dag van het archief, de vroegste dag per nummer. Daarnaast: wat deze week begint en al eerder
// aangekondigd was. Alleen wat nu nog in GIPOD staat (de werkenlaag van live-layers.json).
//
// Wat erin staat, per werf: de titel zoals de lijst op de site hem toont (lijstTitel), de straten met het huisnummer
// (regel van de eigenaar: altijd het huisnummer), begin en einde, en de status. Nooit de opdrachtgever, nooit een
// contactgegeven en nooit een link naar een ruw GIPOD-record (site/gipod-bron.js): de bron is de datasetfiche.
import fs from "node:fs";
import path from "node:path";

import { GIPOD_BRON, GIPOD_METADATA_URL } from "../site/gipod-bron.js";
import { kortNummer, lijstTitel, werkHuisnummers } from "../site/werk-vorm.js";

export const WERVEN_NIEUW_FILE = "werven-nieuw.json";
export const WERVEN_NIEUW_SCHEMA = 1;
export const WERVEN_DAGEN = 7;
export const WERVEN_HOOGSTENS = 400;

const DAG = /^\d{4}-\d{2}-\d{2}$/;
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const clean = (value, max = 300) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// De dag in Brussel van een tijdstip ("2026-11-15").
export function brusselseDag(iso) {
  const tijd = new Date(iso);
  if (Number.isNaN(tijd.getTime())) return null;
  const delen = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(tijd).map((deel) => [deel.type, deel.value]));
  return `${delen.year}-${delen.month}-${delen.day}`;
}

// Een kalenderdag verschoven met n dagen (zonder tijdzone: de datum zelf).
export function dagPlus(dag, n) {
  const [j, m, d] = dag.split("-").map(Number);
  const t = new Date(Date.UTC(j, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

const gipodNummer = (item) => (Number.isInteger(item?.gipodId) ? item.gipodId : Number.parseInt(String(item?.id ?? "").replace(/^work:/, ""), 10));

// Per GIPOD-nummer de vroegste dag waarop de site het zag: de baseline en daarna elke dag van het archief.
export function eersteKeerGezien({ baseline = null, dagen = [] } = {}) {
  const eerste = new Map();
  const zie = (nummer, dag) => {
    if (!Number.isInteger(nummer) || !dag) return;
    const eerder = eerste.get(nummer);
    if (!eerder || dag < eerder) eerste.set(nummer, dag);
  };
  const basis = baseline?.layers?.works;
  const basisDag = basis?.observedAt ? brusselseDag(basis.observedAt) : null;
  for (const item of Array.isArray(basis?.items) ? basis.items : []) zie(gipodNummer(item), basisDag);
  for (const document of dagen) {
    for (const event of Array.isArray(document?.events) ? document.events : []) {
      if (event?.layer !== "works" || event.type !== "added") continue;
      zie(gipodNummer(event.after ?? { id: event.id }), (event.observedAt && brusselseDag(event.observedAt)) || document.date);
    }
  }
  return eerste;
}

// Eén werf zoals het bestand en de site hem tonen. Alleen deze velden, uit een witte lijst.
export function werfVoorOverzicht(item, eersteDag) {
  const nummer = kortNummer(werkHuisnummers(item));
  const straten = (Array.isArray(item?.streets) ? item.streets : [])
    .map((straat, k) => clean(straat?.name, 120) && (k === 0 && nummer ? `${clean(straat.name, 120)} ${nummer}` : clean(straat.name, 120)))
    .filter(Boolean);
  return {
    id: `work:${gipodNummer(item)}`,
    titel: clean(lijstTitel(item)),
    straten,
    begin: clean(item?.start, 40) || null,
    einde: clean(item?.end, 40) || null,
    status: clean(item?.status, 40) || null,
    eersteKeer: eersteDag ?? null,
  };
}

const opBegin = (a, b) => String(a.begin ?? "").localeCompare(String(b.begin ?? "")) || (a.straten[0] ?? "").localeCompare(b.straten[0] ?? "", "nl");

// Het overzicht: nieuw (deze zeven dagen voor het eerst gezien) en begint (begint deze zeven dagen, al eerder gezien).
export function berekenWervenNieuw({ huidige = [], eersteKeer = new Map(), observedAt, dagen = WERVEN_DAGEN } = {}) {
  const tot = brusselseDag(observedAt);
  if (!tot) throw new Error("observedAt ongeldig");
  const van = dagPlus(tot, -(dagen - 1));
  const inVenster = (dag) => Boolean(dag) && dag >= van && dag <= tot;
  const nieuw = [];
  const begint = [];
  const gezien = new Set();
  for (const item of Array.isArray(huidige) ? huidige : []) {
    const nummer = gipodNummer(item);
    if (!Number.isInteger(nummer) || gezien.has(nummer)) continue;
    gezien.add(nummer);
    const eersteDag = eersteKeer.get(nummer) ?? null;
    if (inVenster(eersteDag)) nieuw.push(werfVoorOverzicht(item, eersteDag));
    else if (inVenster(item?.start ? brusselseDag(item.start) : null)) begint.push(werfVoorOverzicht(item, eersteDag));
  }
  nieuw.sort(opBegin);
  begint.sort(opBegin);
  return {
    schemaVersion: WERVEN_NIEUW_SCHEMA,
    observedAt,
    van,
    tot,
    bron: { label: GIPOD_BRON, url: GIPOD_METADATA_URL },
    aantalNieuw: nieuw.length,
    aantalBegint: begint.length,
    nieuw: nieuw.slice(0, WERVEN_HOOGSTENS),
    begint: begint.slice(0, WERVEN_HOOGSTENS),
  };
}

const WERF_SLEUTELS = ["id", "titel", "straten", "begin", "einde", "status", "eersteKeer"];
const SLEUTELS = ["schemaVersion", "observedAt", "van", "tot", "bron", "aantalNieuw", "aantalBegint", "nieuw", "begint"];

export function validateWervenNieuw(document) {
  const fouten = [];
  if (!isObject(document)) return ["geen object"];
  for (const sleutel of Object.keys(document)) if (!SLEUTELS.includes(sleutel)) fouten.push(`onbekende sleutel ${sleutel}`);
  if (document.schemaVersion !== WERVEN_NIEUW_SCHEMA) fouten.push("schemaVersion ongeldig");
  if (Number.isNaN(Date.parse(document.observedAt))) fouten.push("observedAt ongeldig");
  if (!DAG.test(String(document.van)) || !DAG.test(String(document.tot)) || document.van > document.tot) fouten.push("van/tot ongeldig");
  if (document.bron?.url !== GIPOD_METADATA_URL) fouten.push("bron is niet de datasetfiche van GIPOD");
  const gezien = new Set();
  const verwachteTot = brusselseDag(document.observedAt);
  if (verwachteTot && (document.tot !== verwachteTot || document.van !== dagPlus(verwachteTot, -(WERVEN_DAGEN - 1)))) fouten.push("weekvenster komt niet overeen met observedAt in Brussel");
  for (const lijst of ["nieuw", "begint"]) {
    const werven = document[lijst];
    if (!Array.isArray(werven)) { fouten.push(`${lijst} is geen lijst`); continue; }
    if (werven.length > WERVEN_HOOGSTENS) fouten.push(`${lijst} te lang`);
    const aantal = document[lijst === "nieuw" ? "aantalNieuw" : "aantalBegint"];
    if (!Number.isInteger(aantal) || aantal < 0 || werven.length !== Math.min(aantal, WERVEN_HOOGSTENS)) fouten.push(`${lijst} telling komt niet overeen met lijst`);
    werven.forEach((werf, i) => {
      if (!isObject(werf)) { fouten.push(`${lijst}[${i}] geen object`); return; }
      for (const sleutel of Object.keys(werf)) if (!WERF_SLEUTELS.includes(sleutel)) fouten.push(`${lijst}[${i}] onbekende sleutel ${sleutel}`);
      if (!/^work:\d+$/.test(String(werf.id))) fouten.push(`${lijst}[${i}] id ongeldig`);
      if (gezien.has(werf.id)) fouten.push(`${lijst}[${i}] dubbel id`);
      gezien.add(werf.id);
      const inWeek = (dag) => typeof dag === "string" && DAG.test(dag) && dag >= document.van && dag <= document.tot;
      if (lijst === "nieuw" && !inWeek(werf.eersteKeer)) fouten.push(`${lijst}[${i}] eerste waarneming buiten week`);
      if (lijst === "begint") {
        if (!werf.begin || !inWeek(brusselseDag(werf.begin))) fouten.push(`${lijst}[${i}] begin buiten week`);
        if (werf.eersteKeer !== null && (!DAG.test(String(werf.eersteKeer)) || werf.eersteKeer >= document.van)) fouten.push(`${lijst}[${i}] eerste waarneming niet eerder`);
      }
      if (!Array.isArray(werf.straten)) fouten.push(`${lijst}[${i}] straten geen lijst`);
      // Nooit een link in een werf: geen ruw GIPOD-record, geen andere bron.
      if (/https?:\/\//i.test(JSON.stringify(werf))) fouten.push(`${lijst}[${i}] bevat een link`);
    });
  }
  if (document.aantalNieuw !== undefined && !Number.isInteger(document.aantalNieuw)) fouten.push("aantalNieuw ongeldig");
  if (document.aantalBegint !== undefined && !Number.isInteger(document.aantalBegint)) fouten.push("aantalBegint ongeldig");
  return fouten;
}

// Na het archief (scripts/refresh-live-history.mjs): leest de baseline en elke dag van het archief van schijf, en de
// werkenlaag van deze verversing. Laadde de werkenlaag niet, dan blijft het vorige bestand staan.
export function schrijfWervenNieuw({ rootDir, observedAt, worksLayer }) {
  if (worksLayer?.status !== "ok" || !Array.isArray(worksLayer.items)) return { geschreven: false, reden: "werkenlaag niet geladen" };
  const archief = path.join(rootDir, "site", "history", "archive");
  const lees = (bestand) => JSON.parse(fs.readFileSync(bestand, "utf8"));
  const baseline = fs.existsSync(path.join(archief, "baseline.json")) ? lees(path.join(archief, "baseline.json")) : null;
  const dagen = [];
  for (const naam of fs.existsSync(archief) ? fs.readdirSync(archief).sort() : []) {
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(naam)) continue;
    // Een kapotte dag houdt het overzicht niet tegen; die meldt de opkuis van de historiek al.
    try { dagen.push(lees(path.join(archief, naam))); } catch { /* overslaan */ }
  }
  const document = berekenWervenNieuw({ huidige: worksLayer.items, eersteKeer: eersteKeerGezien({ baseline, dagen }), observedAt });
  const fouten = validateWervenNieuw(document);
  if (fouten.length) throw new Error(`werven-nieuw ongeldig: ${fouten[0]}`);
  const bestand = path.join(rootDir, "site", "sources", WERVEN_NIEUW_FILE);
  fs.mkdirSync(path.dirname(bestand), { recursive: true });
  fs.writeFileSync(bestand, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return { geschreven: true, nieuw: document.aantalNieuw, begint: document.aantalBegint };
}
