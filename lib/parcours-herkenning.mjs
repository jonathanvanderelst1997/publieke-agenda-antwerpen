// Automatische herkenning van evenementendossiers van de stad (A-Sign, laag 22 en 23). Voor elk
// dossier zonder met de hand nagekeken identiteit (site/sources/evenement-identiteit.json) maakt de
// verversing een fiche in hetzelfde schema, in een eigen bestand (evenement-identiteit-auto.json),
// zodat handwerk nooit overschreven wordt. De site toont: hand > automatisch > live koppeling.
//
// Stappen, elk met een eerlijke zekerheid en de bron erbij (zie herkenDossier):
//   a. PATROON   zelfde route als een al herkend dossier (vorig jaar, of een tweeling) -> waarschijnlijk;
//   b. KALENDERS agendapunten die de verversing al ophaalt, plus evenementen van buurgemeenten in GIPOD;
//   c. FEEDS     publieke agenda's van organisaties (lib/organisator-feeds.json);
//   d. REGELS    woorden in het dossier, wat vroeger op dezelfde plek gebeurde, het studentencharter;
//   e. KAARTZIN  altijd: vorm, lengte, begin- en eindstraat, wijk of district, datum en stand van de aanvraag.
// "Zeker" alleen met een bron die dag én plek noemt, één kandidaat, en die kandidaat past bij precies
// dit ene dossier. Een foute naam is erger dan geen naam: bij twijfel altijd de lagere zekerheid.
//
// Puur: geen netwerk, geen klok (vandaag komt van buiten). De verversing staat in
// lib/parcours-herkenning-refresh.mjs. Vrije tekst uit A-Sign gaat nooit letterlijk in een fiche:
// alleen trefwoorden uit vaste lijsten (zie SOORTEN) en straatnamen uit de straatas.
import { dagVan, dagenTekst, dagenTussen, datumTekst } from "../site/kaart-uitleg.js";
import { HERKENNING_FILE, METHODES, PATRONEN_FILE } from "./evenement-herkenning-validatie.mjs";

export { HERKENNING_FILE, METHODES, PATRONEN_FILE };
export const ASIGN_BRON = "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/22";
// Goedgekeurd zoals de site het telt (site/public-space-core.js, PUBLIC_IOD_STATUSES).
export const GOEDGEKEURD = Object.freeze(["aanvraag_goedgekeurd", "toelating_gegenereerd", "toelating_geverifieerd"]);
// Wat nooit doorgaat: die dossiers krijgen geen fiche.
export const AFGEWEZEN = Object.freeze(["aanvraag_geweigerd", "weigering_gegenereerd", "afgelast", "afgelasting_gevraagd_aanvrager"]);

export const DREMPELS = Object.freeze({
  stapMeter: 15, // bemonstering van lijnen
  margeMeter: 25, // een punt "ligt op" een route binnen deze marge
  routeOverlap: 0.7, // patroon: deel van elke route dat op de andere ligt
  eindpuntMeter: 60, // patroon: begin en einde binnen deze afstand ...
  lengteMarge: 0.2, // ... en de lengte binnen 20 %
  patroonDagen: 35, // patroon: hoogstens zoveel dagen naast dezelfde dag van het jaar
  plekMeter: 250, // kalender: plek van het agendapunt tot de route of de innames
  zekerPuntMeter: 100, // kalender: een exact punt zonder soortbewijs telt pas zo dicht
  langeRouteMeter: 1500, // langer dan dit telt alleen de kern (start, einde, innames) als plek
  historiekOverlap: 0.6, // regels: oudere dossiers op dezelfde plek
  lusMeter: 100, // begin en einde dichter dan dit: een lus
  maxEvenementDagen: 3, // langere innames (een markt, een werf) koppelen we nooit aan een agendapunt
});

const clean = (v, max = 300) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const uniek = (rows) => [...new Set(rows.map((v) => clean(v)).filter(Boolean))];
export const plat = (t) => clean(t, 400).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const capital = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : "");
const joinNl = (list) => (list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} en ${list.at(-1)}`);
const isDag = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const plusDagen = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
// Een huisnummer na een straatnaam ("Beatrijslaan 32") kan een woning zijn: weg ermee, zoals in
// site/kaart-uitleg.js (zonderHuisnummer), maar zonder de tekst in te korten.
export const zonderNummers = (t, max = 400) => clean(t, max).replace(/(\p{L}*(?:straat|laan|lei|plein|baan|weg|kaai|vest|rui|markt|plaats|dreef|pad|hof|dijk|singel|brug))\s+\d+[a-z]?(?:\s*[-–]\s*\d+[a-z]?)?\b/giu, "$1");
// Alleen een gewone https-pagina: geen query of anker (zelfde regel als evenement-identiteit-validatie).
export const publiekeLink = (url) => (typeof url === "string" && /^https:\/\/[^\s?#@]+$/.test(url) ? url : "");

// ---------- geometrie (meter, lokaal plat rond Antwerpen) ----------

const K = Math.cos((51.2 * Math.PI) / 180);
const MX = 111_320 * K, MY = 110_540;
const geldig = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);
export const meterTussen = (a, b) => Math.hypot((b[0] - a[0]) * MX, (b[1] - a[1]) * MY);
const lijnLengte = (l) => { let m = 0; for (let i = 1; i < l.length; i++) m += meterTussen(l[i - 1], l[i]); return m; };

// Punten om de ~stap meter langs elke lijn (begin- en eindpunt inbegrepen).
export function bemonster(lijnen = [], stap = DREMPELS.stapMeter) {
  const uit = [];
  for (const l of lijnen) {
    if (!Array.isArray(l) || l.length < 2) continue;
    uit.push(l[0]);
    for (let i = 1; i < l.length; i++) {
      const [a, b] = [l[i - 1], l[i]];
      const n = Math.max(1, Math.round(meterTussen(a, b) / stap));
      for (let j = 1; j <= n; j++) uit.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
    }
  }
  return uit;
}

function puntSegment(p, a, b) {
  const [px, py] = [p[0] * MX, p[1] * MY], [ax, ay] = [a[0] * MX, a[1] * MY], [bx, by] = [b[0] * MX, b[1] * MY];
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function ringBevat(p, ring) {
  let binnen = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) binnen = !binnen;
  }
  return binnen;
}

// Ruimtelijke index: lijnen (en de randen van vlakken) in cellen van 60 m, plus de vlakken zelf.
const CEL = 60;
export function maakIndex({ lijnen = [], vlakken = [] } = {}) {
  const grid = new Map();
  const voeg = (a, b) => {
    const x0 = Math.floor((Math.min(a[0], b[0]) * MX) / CEL), x1 = Math.floor((Math.max(a[0], b[0]) * MX) / CEL);
    const y0 = Math.floor((Math.min(a[1], b[1]) * MY) / CEL), y1 = Math.floor((Math.max(a[1], b[1]) * MY) / CEL);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const k = `${x}:${y}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push([a, b]);
    }
  };
  const randen = [...lijnen, ...vlakken.flat()];
  for (const l of randen) for (let i = 1; i < (l?.length || 0); i++) if (geldig(l[i - 1]) && geldig(l[i])) voeg(l[i - 1], l[i]);
  const polys = vlakken.filter((v) => Array.isArray(v) && v.length).map((rings) => ({ rings, box: boxVan(rings.flat()) }));
  return { grid, polys, leeg: !grid.size };
}
export function afstandTot(index, p, max = DREMPELS.plekMeter) {
  if (!index || index.leeg || !geldig(p)) return Infinity;
  if (binnenVlak(index, p)) return 0;
  const r = Math.ceil(max / CEL), cx = Math.floor((p[0] * MX) / CEL), cy = Math.floor((p[1] * MY) / CEL);
  let best = Infinity;
  for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) {
    for (const [a, b] of index.grid.get(`${x}:${y}`) || []) best = Math.min(best, puntSegment(p, a, b));
  }
  return best <= max ? best : Infinity;
}
function binnenVlak(index, p) {
  for (const { rings, box } of index.polys) {
    if (!box || p[0] < box[0] || p[0] > box[2] || p[1] < box[1] || p[1] > box[3]) continue;
    let binnen = false;
    for (const ring of rings) if (ringBevat(p, ring)) binnen = !binnen;
    if (binnen) return true;
  }
  return false;
}
function boxVan(punten = []) {
  const ps = punten.filter(geldig);
  if (!ps.length) return null;
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, y] of ps) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
  return [a, b, c, d];
}
const oppervlakte = (rings = []) => rings.reduce((som, ring) => {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j][0] * MX) * (ring[i][1] * MY) - (ring[i][0] * MX) * (ring[j][1] * MY);
  return som + s / 2;
}, 0);

// Compacte vorm: isoperimetrisch quotiënt 4πA/P² (cirkel 1, vierkant 0,79, gang van 30 m op 1 km 0,09).
export function compact(ring = []) {
  const a = Math.abs(oppervlakte([ring])), p = lijnLengte(ring);
  return a > 0 && a <= 150_000 && p > 0 && (4 * Math.PI * a) / (p * p) >= 0.2;
}

// Lijnen vereenvoudigen (Douglas-Peucker in meter) voor het patroonbestand.
export function vereenvoudig(lijn = [], tolerantie = 6) {
  if (lijn.length <= 2) return lijn.map((p) => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]);
  const houd = new Array(lijn.length).fill(false);
  houd[0] = houd[lijn.length - 1] = true;
  const stapel = [[0, lijn.length - 1]];
  while (stapel.length) {
    const [i, j] = stapel.pop();
    let max = 0, k = -1;
    for (let m = i + 1; m < j; m++) { const d = puntSegment(lijn[m], lijn[i], lijn[j]); if (d > max) { max = d; k = m; } }
    if (k > 0 && max > tolerantie) { houd[k] = true; stapel.push([i, k], [k, j]); }
  }
  return lijn.filter((_, i) => houd[i]).map((p) => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]);
}

// ---------- dossiers uit A-Sign ----------

const msDag = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? dagVan(new Date(Number(v)).toISOString()) : dagVan(v));
// Alle innames per dossier. features: laag 22 (vlakken) en 23 (lijnen), elk { attributes, geometry }.
export function dossiersUitAsign(features = []) {
  const per = new Map();
  for (const f of features) {
    const a = f?.attributes || f?.properties || {};
    const dossier = clean(a.dossierNummer, 40);
    if (!/^ET\d{10}$/.test(dossier)) continue;
    const status = clean(a.dossierStatus, 60);
    if (AFGEWEZEN.includes(status)) continue;
    const d = per.get(dossier) || { dossier, status, bijgewerkt: "", fasen: new Map(), innames: [], beschrijvingen: [] };
    const bewerkt = msDag(a.last_edited_date);
    if (bewerkt && bewerkt > d.bijgewerkt) { d.bijgewerkt = bewerkt; d.status = status || d.status; }
    const fase = clean(a.faseNaam, 40), start = msDag(a.faseStartDatum), eind = msDag(a.faseEindDatum) || start;
    if (fase && start) {
      const p = d.fasen.get(fase) || { naam: fase, start, eind };
      if (start < p.start) p.start = start;
      if (eind > p.eind) p.eind = eind;
      d.fasen.set(fase, p);
    }
    const g = f?.geometry || null;
    const geometry = g?.paths ? { paths: g.paths } : g?.rings ? { rings: g.rings } : g?.type === "LineString" ? { paths: [g.coordinates] } : g?.type === "MultiLineString" ? { paths: g.coordinates } : g?.type === "Polygon" ? { rings: g.coordinates } : null;
    d.innames.push({ type: clean(a.innameTypeNaam, 60), beschrijving: clean(a.innameBeschrijving, 400), fase, start, eind, geometry });
    if (clean(a.innameBeschrijving)) d.beschrijvingen.push(clean(a.innameBeschrijving, 400));
    per.set(dossier, d);
  }
  const uit = new Map();
  for (const [dossier, d] of [...per].sort((x, y) => x[0].localeCompare(y[0]))) {
    const fasen = [...d.fasen.values()].sort((x, y) => x.start.localeCompare(y.start) || x.naam.localeCompare(y.naam, "nl"));
    const ev = d.fasen.get("Evenement");
    const dag = ev ? { start: ev.start, eind: ev.eind } : fasen.length ? { start: fasen[0].start, eind: fasen.map((p) => p.eind).sort().at(-1) } : null;
    if (!dag?.start) continue;
    // De echte dagen van het evenement (een doop op dinsdag 20 én dinsdag 27 is geen week lang).
    const metFase = d.innames.filter((i) => i.start && (!ev || i.fase === "Evenement"));
    const dagSet = new Set();
    for (const i of metFase) for (let x = i.start; x <= (i.eind || i.start) && dagSet.size <= 60; x = plusDagen(x, 1)) dagSet.add(x);
    const dagen = [...dagSet].sort();
    uit.set(dossier, { dossier, status: d.status, bijgewerkt: d.bijgewerkt, fasen, dag, dagen: dagen.length ? dagen : [dag.start], innames: d.innames, beschrijvingen: uniek(d.beschrijvingen) });
  }
  return uit;
}

// De vorm van een dossier: de parcourslijnen (laag 23), anders de parcoursvlakken, plus de andere innames.
export function vormVan(innames = []) {
  const sleutels = new Set();
  const nieuw = (x) => { const k = JSON.stringify(x); if (sleutels.has(k)) return false; sleutels.add(k); return true; };
  const pl = [], pv = [], al = [], av = [];
  for (const i of innames) {
    const parcours = /parcours/i.test(i.type || "");
    for (const l of i.geometry?.paths || []) if (Array.isArray(l) && l.length >= 2 && l.every(geldig) && nieuw(l)) (parcours ? pl : al).push(l);
    const rings = (i.geometry?.rings || []).filter((r) => Array.isArray(r) && r.length >= 4 && r.every(geldig));
    if (rings.length && nieuw(rings)) (parcours ? pv : av).push(rings);
  }
  const routeLijnen = pl.length ? pl : [];
  const routeVlakken = pl.length ? [] : pv.length ? pv : av;
  const hoofd = [...routeLijnen].sort((a, b) => lijnLengte(b) - lijnLengte(a))[0] || null;
  // Lengte zonder dubbel getekende stukken: punten om de 15 m; een punt telt niet als er al een
  // getelde punt binnen 10 m ligt (twee keer getekende lijnen tellen zo één keer).
  let lengte = 0;
  if (routeLijnen.length) {
    const cellen = new Map();
    const sleutel = (x, y) => `${x}:${y}`;
    for (const p of bemonster(routeLijnen)) {
      const cx = Math.floor((p[0] * MX) / 10), cy = Math.floor((p[1] * MY) / 10);
      let dubbel = false;
      for (let x = cx - 1; x <= cx + 1 && !dubbel; x++) for (let y = cy - 1; y <= cy + 1 && !dubbel; y++) for (const q of cellen.get(sleutel(x, y)) || []) if (meterTussen(p, q) <= 10) { dubbel = true; break; }
      if (dubbel) continue;
      if (!cellen.has(sleutel(cx, cy))) cellen.set(sleutel(cx, cy), []);
      cellen.get(sleutel(cx, cy)).push(p);
      lengte += DREMPELS.stapMeter;
    }
  }
  const start = hoofd?.[0] || null, eind = hoofd?.at(-1) || null;
  const centrum = (rings) => { const b = boxVan(rings.flat()); return b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : null; };
  const kern = [start, eind, ...av.map(centrum), ...al.map((l) => l[0])].filter(geldig);
  const alles = [...pl, ...al, ...pv.flat(), ...av.flat()];
  return {
    lijnen: routeLijnen, vlakken: routeVlakken, parcoursVlakken: pv, andereLijnen: al, andereVlakken: av,
    heeftParcours: Boolean(pl.length || pv.length), lengte: Math.round(lengte), start, eind,
    lus: Boolean(start && eind && meterTussen(start, eind) <= DREMPELS.lusMeter),
    oppervlakte: Math.round(Math.abs(routeVlakken.reduce((s, r) => s + oppervlakte(r), 0))),
    kern, bbox: boxVan(alles.flat ? alles.flat() : []),
    index: maakIndex({ lijnen: [...pl, ...al], vlakken: [...pv, ...av] }),
    routeIndex: maakIndex({ lijnen: routeLijnen, vlakken: routeVlakken }),
  };
}

// Deel van de route van a dat binnen de marge van de route (of in de vlakken) van b ligt.
// Bemonsterde route, één keer per vorm (de vorm wordt gedeeld tussen stappen en verversingen).
const routePunten = (v) => v._punten || (v._punten = v.lijnen.length ? bemonster(v.lijnen) : bemonster(v.vlakken.flat()));
export function dekking(a, b, marge = DREMPELS.margeMeter) {
  const ps = routePunten(a);
  if (!ps.length || b.routeIndex.leeg) return 0;
  return ps.filter((p) => afstandTot(b.routeIndex, p, marge) <= marge).length / ps.length;
}
// Zelfde route: genoeg overlap in beide richtingen, of begin en einde op dezelfde plek met dezelfde lengte.
const routeVergelijking = new WeakMap();
export function zelfdeRoute(a, b) {
  const per = routeVergelijking.get(a) || new WeakMap();
  routeVergelijking.set(a, per);
  if (!per.has(b)) per.set(b, vergelijkRoutes(a, b));
  return per.get(b);
}
function vergelijkRoutes(a, b) {
  const ab = dekking(a, b), ba = dekking(b, a), overlap = Math.min(ab, ba);
  let eindpunten = false;
  if (a.start && b.start && a.lengte && b.lengte) {
    const d = DREMPELS.eindpuntMeter;
    const recht = meterTussen(a.start, b.start) <= d && meterTussen(a.eind, b.eind) <= d;
    const omgekeerd = meterTussen(a.start, b.eind) <= d && meterTussen(a.eind, b.start) <= d;
    eindpunten = (recht || omgekeerd) && Math.abs(a.lengte - b.lengte) <= DREMPELS.lengteMarge * Math.max(a.lengte, b.lengte);
  }
  return { ok: overlap >= DREMPELS.routeOverlap || eindpunten, overlap: Math.round(overlap * 100) / 100, eindpunten };
}

// ---------- soorten (alleen trefwoorden uit deze lijst verlaten ooit een dossier) ----------

// Volgorde telt: het specifiekere eerst ("doopstoet" is een studentendoop, geen stoet).
export const SOORTEN = Object.freeze([
  { key: "student", re: /doop|dril|schacht|ontgroen|welkomstritueel|kroegentocht|cantus|studenten(?:club|vereniging|activiteit|tocht|stoet)/, zonder: "studentenactiviteit", met: "een studentenactiviteit", beweegt: true },
  { key: "school", re: /\bschool|\bscholen\b|leerlingen/, zonder: "schoolactiviteit", met: "een schoolactiviteit", beweegt: true },
  { key: "herdenking", re: /herdenk|wapenstilstand|\b11 november\b|last post|gesneuvelde/, zonder: "herdenking", met: "een herdenking", beweegt: true },
  { key: "sint", re: /sinterklaas|\bde sint\b|\bsint (?:en|op|komt|in)\b|\bkoets sint\b|\bsint koets\b|\bsintstoet/, zonder: "Sinterklaasstoet of -feest", met: "een Sinterklaasstoet of -feest", beweegt: true },
  { key: "halloween", re: /halloween|griezel/, zonder: "Halloween-activiteit", met: "een Halloween-activiteit", beweegt: true },
  { key: "winkel", re: /shop|winkelfestival|winkeldag|winkelevenement|koopavond/, zonder: "winkelevenement", met: "een winkelevenement", beweegt: false },
  { key: "wieler", re: /wieler|\bkoers|criterium|wielren|cyclocross|veldrit|\w*prijs\b/, zonder: "wielerwedstrijd", met: "een wielerwedstrijd", beweegt: true },
  { key: "fiets", re: /fietstocht|fietstoer|fietsrit|fietsersbond/, zonder: "fietstocht", met: "een fietstocht", beweegt: true },
  { key: "wandel", re: /wandel|\bwalk\b|wandeltocht/, zonder: "wandeling", met: "een wandeling", beweegt: true },
  { key: "loop", re: /\b\d+(?: \d+)? ?(?:k|km|kilometer)\b|loopwedstrijd|stratenloop|parkloop|veldloop|sponsorloop|marathon|jogging|trail(?!er)|\w*run\b|\bloop\b|\blopen\b/, zonder: "loopwedstrijd of loop", met: "een loopwedstrijd of loop", beweegt: true },
  { key: "stoet", re: /stoet|optocht|parade|processie|carnaval|defile/, zonder: "stoet", met: "een stoet", beweegt: true },
  { key: "tocht", re: /\w+tocht\b|\btocht\b/, zonder: "tocht", met: "een tocht", beweegt: true },
  { key: "haltes", re: /\w+stop\b|\bstop\b/, zonder: "tocht te voet langs haltes", met: "een tocht te voet langs haltes", beweegt: true },
  { key: "buurtfeest", re: /straatfeest|buurtfeest|wijkfeest|burenfeest|pleinfeest/, zonder: "buurtfeest", met: "een buurtfeest", beweegt: false },
  { key: "markt", re: /braderie|rommelmarkt|kerstmarkt|(?<!grote )\bmarkt\b/, zonder: "markt", met: "een markt", beweegt: false },
]);
const SOORT = Object.fromEntries(SOORTEN.map((s) => [s.key, s]));
// Soorten die bij elkaar passen (een loop met een wandeling, een Halloweentocht te voet ...).
const PAST = {
  loop: ["wandel", "tocht", "halloween"], wandel: ["loop", "tocht", "halloween", "haltes", "herdenking"], tocht: ["wandel", "loop", "fiets", "halloween", "haltes"],
  stoet: ["sint", "herdenking", "student", "halloween"], sint: ["stoet"], herdenking: ["stoet", "wandel"], halloween: ["wandel", "loop", "tocht", "stoet"],
  student: ["haltes", "stoet"], haltes: ["student", "wandel", "tocht"], wieler: [], fiets: ["tocht"], school: [], winkel: ["markt"], markt: ["winkel"], buurtfeest: [],
};
export function soortenIn(teksten = []) {
  const t = ` ${teksten.map(plat).join(" | ")} `;
  return SOORTEN.filter((s) => s.re.test(t)).map((s) => s.key);
}
export const eersteSoort = (teksten) => soortenIn(teksten)[0] || "";
export const soortPast = (a, b) => !a || !b || a === b || (PAST[a] || []).includes(b);

// Woorden die niets over één bepaald evenement zeggen (voor het naambewijs).
const GEWOON = new Set(("de het een en van voor met op in aan te ter tot naar bij door om uit over na tijdens langs ontdek pracht kom doe mee gratis " +
  "editie jaarlijkse jaarlijks nationale nationaal grote kleine nieuwe dag dagen avond middag ochtend weekend feest feesten evenement evenementen " +
  "district stad antwerpen parcours route start finish opbouw afbraak inname innames tent tenten toiletten nadars stand standen zone locatie " +
  "plein straat laan park kilometer meter kasteel kerk speeltuin sporthal schoolplein gemeentepark stadspark domein campus fort brug kaai " +
  "grasveld parking podium muziek optreden animatie kinderen jeugd senioren familie families wijk buurt buren school scholen verenigingen " +
  "vereniging sportpark centrum station dorp dorpsplein").split(" "));
// Een eigen naam uit de titel die ook in het dossier staat ("EkeRun" in "Ekerun 10 km"), of de
// beginletters van een naam uit hoofdletterwoorden ("JSP" voor "Jaak Schram Parkloop").
export function naamBewijs(titel, beschrijvingen = []) {
  const dossier = ` ${plat(beschrijvingen.join(" | "))} `;
  if (dossier.trim().length < 3) return "";
  const tokens = clean(titel, 300).split(/[^\p{L}\p{N}'’-]+/u).filter(Boolean);
  for (const [i, t] of tokens.entries()) {
    const w = plat(t);
    if (w.length < 5 || /\d/.test(w) || GEWOON.has(w)) continue;
    // Alleen een eigen naam: gemengde hoofdletters ("EkeRun", "AAAntwerp"), of een woord met een
    // hoofdletter midden in de titel dat geen soortwoord is ("Muisbroek", niet "Criterium").
    const gemengd = /\p{Ll}\p{Lu}|\p{Lu}{2}\p{Ll}/u.test(t);
    const eigen = i > 0 && /^\p{Lu}/u.test(t) && soortenIn([w]).length === 0;
    if ((gemengd || eigen) && dossier.includes(` ${w} `)) return w;
  }
  for (const reeks of clean(titel, 300).matchAll(/(?:\b\p{Lu}[\p{L}'’-]{2,}\s+){1,4}\p{Lu}[\p{L}'’-]{2,}/gu)) {
    const letters = reeks[0].split(/\s+/).map((w) => w[0].toLowerCase()).join("");
    if (letters.length >= 3 && dossier.includes(` ${letters} `)) return letters;
  }
  return "";
}

// ---------- gebied: district, postcode ----------

// districten: [{ naam, geometry }] (lib/districten-antwerpen.geojson). Geeft "Hoboken", "Antwerpen" ...
export function districtVan(p, districten = []) {
  if (!geldig(p)) return "";
  for (const d of districten) {
    const g = d.geometry;
    const polys = g?.type === "Polygon" ? [g.coordinates] : g?.type === "MultiPolygon" ? g.coordinates : [];
    for (const rings of polys) { let binnen = false; for (const r of rings) if (ringBevat(p, r)) binnen = !binnen; if (binnen) return d.naam; }
  }
  return "";
}
const DISTRICT_UIT_TEKST = /\bdistrict\s+([a-z][a-z -]+?)(?:,|\s+locatie|\s*$)/i;
const POSTCODE_DISTRICT = {
  2000: "Antwerpen", 2018: "Antwerpen", 2020: "Antwerpen", 2030: "Antwerpen", 2050: "Antwerpen", 2060: "Antwerpen",
  2040: "Berendrecht-Zandvliet-Lillo", 2100: "Deurne", 2140: "Borgerhout", 2150: "Borsbeek", 2170: "Merksem", 2180: "Ekeren",
  2600: "Berchem", 2610: "Wilrijk", 2660: "Hoboken",
};
export function gebiedUitTekst(locatie = "") {
  const t = clean(locatie, 300);
  const m = t.match(DISTRICT_UIT_TEKST);
  const postcodes = [...t.matchAll(/\b(2\d{3})\b/g)].map((x) => x[1]).filter((p) => POSTCODE_DISTRICT[p]);
  const district = m ? normaalDistrict(m[1]) : "";
  return { district, postcodes };
}
export function normaalDistrict(naam) {
  const n = plat(naam).replace(/\s+/g, " ");
  if (/berendrecht|zandvliet|lillo/.test(n)) return "Berendrecht-Zandvliet-Lillo";
  for (const d of ["Antwerpen", "Berchem", "Borgerhout", "Borsbeek", "Deurne", "Ekeren", "Hoboken", "Merksem", "Wilrijk"]) if (n.startsWith(plat(d))) return d;
  return "";
}

// ---------- kandidaten uit kalenders, GIPOD en organisatoren ----------

// Een kandidaat: { titel, dag, eind, tijd, locatie, link, bron ("kalender"|"gipod"|"organisator"),
// bronLabel, punt?, vlak? (GeoJSON of ArcGIS), district?, postcodes?, organisator?, soort? }.
const GEEN_EVENEMENT = /\b(?:markets|meetings|admin|works|info|calls)\b|\bmarkt\b|raad|commissie|zitdag|infosessie|lezing|tabletcafe|spreekuur/i;
// puntVan(locatie) -> { point, precision } uit de geocodecache (site/geo/locaties.json) of null.
export function kandidaatUitAgenda(item = {}, { bronLabel = "agenda van de stad", puntVan = () => null } = {}) {
  const titel = clean(item.title, 200), dag = dagVan(item.date), eind = dagVan(item.endDate) || dag;
  if (!titel || !dag) return null;
  if (GEEN_EVENEMENT.test(plat(`${item.category || ""} ${item.theme || ""} ${titel}`))) return null;
  if (dagenTussen(dag, eind) >= DREMPELS.maxEvenementDagen) return null;
  const locatie = clean(item.location, 300);
  const g = gebiedUitTekst(locatie);
  const entry = puntVan(locatie) || null;
  return {
    titel, dag, eind, tijd: clean(item.timeText, 120), locatie, link: publiekeLink(clean(item.infoUrl || item.sourceUrl, 500)),
    bron: "kalender", bronLabel, punt: geldig(entry?.point) ? entry.point : null, puntPrecisie: entry?.precision || "",
    district: g.district, postcodes: g.postcodes,
  };
}
function vlakIndex(geometry) {
  const g = geometry || {};
  if (g.type === "Polygon") return maakIndex({ vlakken: [g.coordinates] });
  if (g.type === "MultiPolygon") return maakIndex({ vlakken: g.coordinates });
  if (g.rings) return maakIndex({ vlakken: [g.rings] });
  if (g.type === "LineString") return maakIndex({ lijnen: [g.coordinates] });
  if (g.type === "MultiLineString" || g.paths) return maakIndex({ lijnen: g.coordinates || g.paths });
  return null;
}

// Hoe goed past een kandidaat bij een dossier? { niveau: "sterk"|"gebied"|"", hoe, meter?, overlap? }
const plekCache = new WeakMap();
function plekVan(k, d) {
  const per = plekCache.get(k) || new WeakMap();
  plekCache.set(k, per);
  if (!per.has(d.vorm)) per.set(d.vorm, plekBerekend(k, d));
  return per.get(d.vorm);
}
function plekBerekend(k, d) {
  const v = d.vorm;
  const kort = v.lengte <= DREMPELS.langeRouteMeter && (!v.oppervlakte || v.oppervlakte < 200_000);
  if (k.vlak) {
    const idx = k._idx || (k._idx = vlakIndex(k.vlak));
    if (idx && !idx.leeg) {
      const ps = routePunten(v);
      const deel = ps.length ? ps.filter((p) => afstandTot(idx, p, DREMPELS.margeMeter) <= DREMPELS.margeMeter).length / ps.length : 0;
      if (deel >= 0.15) return { niveau: "sterk", hoe: "vlak", overlap: Math.round(deel * 100) / 100 };
    }
    // Een kandidaat met een eigen vlak elders hoort niet bij dit dossier, ook niet bij een gelijkend woord.
    return { niveau: "", hoe: "" };
  }
  if (k.punt) {
    const kernIdx = v._kern || (v._kern = maakIndex({ lijnen: v.kern.map((p) => [p, p]) }));
    const totKern = afstandTot(kernIdx, k.punt), totRoute = afstandTot(v.index, k.punt);
    const m = kort ? Math.min(totKern, totRoute) : totKern;
    if (m <= DREMPELS.plekMeter) return { niveau: "sterk", hoe: "punt", meter: Math.round(m) };
    // Een exact adres elders: geen plek. Alleen een punt midden in een straat laat de straatnaam nog toe.
    if (k.puntPrecisie !== "straat") return { niveau: "", hoe: "" };
  }
  if (k.locatie && d.kernStraten?.length) {
    const loc = ` ${plat(`${k.locatie} ${k.titel}`)} `;
    const straten = kort ? d.straten : d.kernStraten;
    const hit = straten.find((s) => plat(s).length >= 5 && loc.includes(` ${plat(s)} `));
    if (hit) return { niveau: "sterk", hoe: "straat", straat: hit };
  }
  if (k.punt) return { niveau: "", hoe: "" };
  const naam = naamBewijs(k.titel, d.beschrijvingen);
  if (naam) return { niveau: "sterk", hoe: "naam", naam };
  if (k.district && d.district && k.district === d.district) return { niveau: "gebied", hoe: "district" };
  if (k.postcodes?.length && d.postcodes?.some((p) => k.postcodes.includes(p))) return { niveau: "gebied", hoe: "postcode" };
  return { niveau: "", hoe: "" };
}
const evenementDagen = (d) => (Array.isArray(d.dagen) && d.dagen.length ? d.dagen : [d.dag.start]);
const dagOverlapt = (k, d) => evenementDagen(d).some((x) => x >= k.dag && x <= (k.eind || k.dag));
// Een evenement van hoogstens twee dagen (een markt of een werf van weken koppelen we nooit).
export const kortEvenement = (d) => evenementDagen(d).length < DREMPELS.maxEvenementDagen;
// Kandidaat en dossier passen samen: dezelfde dag, een plek en een soort die niet botst.
function past(k, d, ctx) {
  if (!kortEvenement(d) || !dagOverlapt(k, d)) return null;
  const soortK = k.soort || eersteSoort([k.titel]);
  if (!soortPast(soortK, d.soort)) return null;
  const plek = plekVan(k, d);
  if (!plek.niveau) return null;
  const zelfdeSoort = Boolean(soortK && d.soort && soortK === d.soort);
  const naam = plek.hoe === "naam" ? plek.naam : naamBewijs(k.titel, d.beschrijvingen);
  const sterk = plek.niveau === "sterk" && (zelfdeSoort || Boolean(naam) || (plek.hoe === "vlak" && plek.overlap >= 0.5));
  return { k, d, plek, soortK, zelfdeSoort, naam, sterk };
}
// Dezelfde titel: gelijk, de ene bevat de andere, of een gemeenschappelijk stuk van minstens 8 letters
// zonder spaties ("Campustrail Multiversum" en "Campus Trailrun").
export function zelfdeTitel(a, b) {
  const x = plat(a), y = plat(b);
  if (!x || !y) return false;
  if (x === y || (x.length >= 8 && y.includes(x)) || (y.length >= 8 && x.includes(y))) return true;
  const p = x.replace(/ /g, ""), q = y.replace(/ /g, "");
  for (let i = 0; i + 8 <= p.length; i++) if (q.includes(p.slice(i, i + 8))) return true;
  return false;
}
function ontdubbel(paren) {
  const uit = [];
  for (const p of paren) {
    const dubbel = uit.find((q) => zelfdeTitel(q.k.titel, p.k.titel) && q.k.dag === p.k.dag);
    if (!dubbel) uit.push(p);
    else if ((p.sterk && !dubbel.sterk) || (p.k.punt && !dubbel.k.punt)) uit[uit.indexOf(dubbel)] = p;
  }
  return uit;
}

// Stap b en c samen: alle kandidaten tegen alle dossiers, zodat "één kandidaat" en "één dossier" in
// beide richtingen getoetst worden. Geeft per dossier een voorstel of null.
export function koppelKandidaten(dossiers = [], kandidaten = [], ctx = {}) {
  const perDossier = new Map(dossiers.map((d) => [d.dossier, []]));
  const perKandidaat = new Map();
  for (const k of kandidaten) {
    if (!k?.titel || !isDag(k.dag)) continue;
    for (const d of dossiers) {
      const m = past(k, d, ctx);
      if (!m) continue;
      perDossier.get(d.dossier).push(m);
      if (!perKandidaat.has(k)) perKandidaat.set(k, []);
      perKandidaat.get(k).push(m);
    }
  }
  const voorstellen = new Map();
  for (const d of dossiers) {
    const alle = ontdubbel(perDossier.get(d.dossier) || []);
    const sterk = alle.filter((m) => m.plek.niveau === "sterk");
    const gebied = alle.filter((m) => m.plek.niveau === "gebied");
    let v = null;
    if (sterk.length === 1) {
      const m = sterk[0];
      const anderen = (perKandidaat.get(m.k) || []).filter((x) => x.d.dossier !== d.dossier && x.plek.niveau === "sterk");
      const eenDossier = anderen.length === 0;
      // Een exact punt vlak bij het dossier, als enige dossier die dag daar: ook zonder soortbewijs.
      const dichtbij = m.plek.hoe === "punt" && m.plek.meter <= DREMPELS.zekerPuntMeter && m.k.puntPrecisie !== "straat";
      const andereSterk = anderen.filter((x) => x.sterk);
      if ((m.sterk && andereSterk.length === 0 && (eenDossier || m.sterk)) || (dichtbij && eenDossier)) v = { m, zekerheid: "zeker" };
      else if (eenDossier) v = { m, zekerheid: "waarschijnlijk", metNaam: true };
      // Meer dossiers die dag op die plek: de kandidaat hoort bij een ander dossier dat haar soort of
      // naam draagt, of het blijft bij de soort, en alleen als het dossier zelf al die soort noemt.
      else if (m.zelfdeSoort && !andereSterk.length) v = { m, zekerheid: "waarschijnlijk", metNaam: false, twijfel: `ook ${anderen.length} ander dossier die dag op die plek` };
    } else if (sterk.length > 1) {
      const soorten = uniek(sterk.map((m) => m.soortK));
      const eenSterk = sterk.filter((m) => m.sterk);
      if (eenSterk.length === 1 && eenSterk[0].naam) v = { m: eenSterk[0], zekerheid: "waarschijnlijk", metNaam: true, twijfel: `${sterk.length} agendapunten op die dag en plek` };
      else if (soorten.length === 1 && sterk.every((m) => m.soortK)) v = { m: sterk[0], zekerheid: "waarschijnlijk", metNaam: false, twijfel: `${sterk.length} agendapunten op die dag en plek` };
    } else if (gebied.length === 1 && d.vorm.heeftParcours) {
      // Alleen een district of postcode: hoogstens waarschijnlijk, en alleen als de kandidaat een
      // evenement op straat is (een loop, een stoet ...), de soort niet botst met wat het dossier zegt,
      // geen ander parcours die dag in dat gebied past en de kandidaat nergens anders sterk past.
      const m = gebied[0];
      const elders = (perKandidaat.get(m.k) || []).filter((x) => x.d.dossier !== d.dossier && (x.plek.niveau === "sterk" || x.d.vorm.heeftParcours));
      if (SOORT[m.soortK]?.beweegt && elders.length === 0 && (m.zelfdeSoort || !d.soort)) v = { m, zekerheid: "waarschijnlijk", metNaam: true };
    }
    if (v) voorstellen.set(d.dossier, v);
  }
  return voorstellen;
}

// ---------- stap a: patroon ----------

const dagVanJaar = (day) => { const t = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)); return Math.floor((t - Date.UTC(+day.slice(0, 4), 0, 1)) / 86_400_000); };
function dagenVanJaarTussen(a, b) { const x = Math.abs(dagVanJaar(a) - dagVanJaar(b)); return Math.min(x, 365 - x); }
// bibliotheek: [{ dossier, dag, naam, soort, organisator, zekerheid, link, vorm }] (evenement-patronen.json).
export function stapPatroon(d, bibliotheek = []) {
  let best = null;
  for (const e of bibliotheek) {
    if (!e?.vorm || e.dossier === d.dossier || !isDag(e.dag) || e.dag === d.dag.start) continue;
    if (Math.abs(dagenTussen(e.dag, d.dag.start)) > 4 * 366 || dagenVanJaarTussen(e.dag, d.dag.start) > DREMPELS.patroonDagen) continue;
    if (!e._vorm) e._vorm = vormUitPatroon(e.vorm);
    if (!e._vorm.bbox || !d.vorm.bbox || !boxenRaken(e._vorm.bbox, d.vorm.bbox)) continue;
    const r = zelfdeRoute(d.vorm, e._vorm);
    if (r.ok && (!best || r.overlap > best.r.overlap)) best = { e, r };
  }
  if (!best) return null;
  const { e, r } = best;
  const jaar = e.dag.slice(0, 4);
  const wanneer = `${dagTekst(e.dag)} ${jaar}`;
  const bewijs = r.overlap >= DREMPELS.routeOverlap ? `${Math.round(r.overlap * 100)} % van de route valt samen` : "begin, einde en lengte vallen samen";
  return {
    methode: "patroon", zekerheid: "waarschijnlijk",
    naam: e.zekerheid === "zeker" ? clean(e.naam, 120) : "",
    soort: metLidwoord(e.soort), organisator: e.zekerheid === "zeker" ? clean(e.organisator, 200) : "",
    reden: `Dezelfde route als ${e.zekerheid === "zeker" && e.naam ? `${e.naam} op ${wanneer}` : `het evenement van ${wanneer}`} (dossier ${e.dossier}): ${bewijs}. De stad noemt geen naam bij dit dossier.`,
    link: e.zekerheid === "zeker" ? publiekeLink(e.link) : "", linkLabel: e.zekerheid === "zeker" && publiekeLink(e.link) ? "Info over de vorige keer" : "",
    bron: [publiekeLink(e.link)].filter(Boolean),
    signalen: [`zelfde route als ${e.dossier}/${jaar} (${r.overlap >= DREMPELS.routeOverlap ? `overlap ${Math.round(r.overlap * 100)} %` : "zelfde begin, einde en lengte"})`],
    patroon: e,
  };
}
const boxenRaken = (a, b) => a[0] <= b[2] + 0.001 && a[2] >= b[0] - 0.001 && a[1] <= b[3] + 0.001 && a[3] >= b[1] - 0.001;
export function vormUitPatroon(p = {}) {
  return vormVan([
    ...(p.lijnen || []).map((l) => ({ type: "Parcours", geometry: { paths: [l] } })),
    ...(p.vlakken || []).map((r) => ({ type: "Parcours", geometry: { rings: r } })),
  ]);
}
export function metLidwoord(soort = "") {
  const s = clean(soort, 200);
  if (!s) return "";
  return /^(?:een|de|het|twee|drie)\b/i.test(s) ? s : `een ${s.charAt(0).toLowerCase()}${s.slice(1)}`;
}
const WEEKDAGEN = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
const dagTekst = (day) => (isDag(day) ? `${WEEKDAGEN[new Date(`${day}T12:00:00Z`).getUTCDay()]} ${datumTekst(day)}` : "");

// ---------- stap d: regels ----------

// Oudere ETL-dossiers op dezelfde plek (zelfde periode van het jaar, ruw: [{ dossier, dag,
// beschrijvingen, vorm }]) samengevat tot wat de regels nodig hebben: per dossier het jaar, de
// trefwoorden uit SOORTEN en de overlap. Zo kan de verversing dit bewaren zonder vrije tekst.
export function vatHistoriekSamen(d, ruw = []) {
  const uit = [];
  for (const h of ruw) {
    if (!h?.vorm || h.dossier === d.dossier || !isDag(h.dag) || h.dag >= d.dag.start) continue;
    const ov = Math.max(dekking(d.vorm, h.vorm), dekking(h.vorm, d.vorm));
    if (ov < DREMPELS.historiekOverlap) continue;
    uit.push({ dossier: h.dossier, jaar: h.dag.slice(0, 4), soorten: soortenIn(h.beschrijvingen || []), overlap: Math.round(ov * 100) / 100 });
  }
  return uit.sort((a, b) => a.dossier.localeCompare(b.dossier));
}

// historiek: samenvatting uit vatHistoriekSamen. charter: lib/studentencharter.json.
export function binnenDoopperiode(dag, charter) {
  const p = charter?.doopperiode;
  if (!p || !isDag(dag)) return false;
  const md = dag.slice(5);
  return md >= p.van && md <= p.tot;
}
// Plekken uit het studentencharter die het dossier raakt. Met { innames: true } telt alleen wat er
// echt staat (tenten, een verkeersvrije zone, een parcourszone op een plein), niet een route die
// er langs loopt: een loop door de stad passeert vanzelf een drilplaats.
export function charterPlekken(d, charter, { innames = false } = {}) {
  const v = d.vorm;
  const cache = v._charter || (v._charter = new Map());
  const sleutel = `${innames}|${charter?.academiejaar || ""}|${(charter?.plekken || []).length}`;
  if (!cache.has(sleutel)) cache.set(sleutel, charterPlekkenBerekend(v, charter, innames));
  return cache.get(sleutel);
}
function charterPlekkenBerekend(v, charter, innames) {
  // Een parcourszone telt alleen als ze compact is (een plein, een park), niet een gang langs een route.
  const zones = (v.parcoursVlakken || []).map((rings) => rings.filter(compact)).filter((rings) => rings.length);
  const idx = innames ? maakIndex({ lijnen: v.andereLijnen, vlakken: [...v.andereVlakken, ...zones] }) : v.index;
  const punten = innames ? [...v.andereVlakken, ...zones].flatMap((rings) => bemonster(rings)).concat(v.andereLijnen.flat()) : routePunten(v).concat(v.kern);
  const uit = [];
  for (const plek of charter?.plekken || []) {
    const r = plek.straal || 60;
    const hit = plek.vlak
      ? (() => { const pv = plek._idx || (plek._idx = maakIndex({ vlakken: [plek.vlak] })); return punten.some((p) => afstandTot(pv, p, r) <= r); })()
      : geldig(plek.punt) && afstandTot(idx, plek.punt, r) <= r;
    if (hit) uit.push(plek.naam);
  }
  return uniek(uit);
}
export function stapRegels(d, { historiek = [], charter = null } = {}) {
  const eigen = soortenIn(d.beschrijvingen);
  const signalen = [];
  if (eigen.length) signalen.push(`trefwoord in het dossier: ${eigen.map((k) => SOORT[k].zonder).join(", ")}`);
  // Oudere dossiers op dezelfde plek: per soort de jaren met een trefwoord.
  const perSoort = new Map();
  for (const h of historiek) {
    if (!h?.dossier || h.dossier === d.dossier || !(h.overlap >= DREMPELS.historiekOverlap)) continue;
    for (const k of (h.soorten || []).filter((s) => SOORT[s])) {
      const s = perSoort.get(k) || { jaren: new Set(), dossiers: [], overlap: 0 };
      s.jaren.add(String(h.jaar));
      s.dossiers.push(h.dossier);
      s.overlap = Math.max(s.overlap, h.overlap);
      perSoort.set(k, s);
    }
  }
  const vroeger = [...perSoort].sort((a, b) => b[1].jaren.size - a[1].jaren.size || SOORTEN.findIndex((s) => s.key === a[0]) - SOORTEN.findIndex((s) => s.key === b[0]));
  if (vroeger.length) signalen.push(`vroeger op dezelfde plek: ${vroeger.slice(0, 3).map(([k, s]) => `${SOORT[k].zonder} (${[...s.jaren].sort().join(", ")})`).join("; ")}`);
  const doop = binnenDoopperiode(d.dag.start, charter);
  // Wat vroeger op dezelfde plek gebeurde, zegt alleen iets over een evenement van een paar dagen.
  const kort = kortEvenement(d);
  const plekken = doop ? charterPlekken(d, charter) : [];
  const plekkenInname = doop ? charterPlekken(d, charter, { innames: true }) : [];
  if (doop && plekken.length) signalen.push(`doopperiode en een plek uit het studentencharter: ${plekken.slice(0, 3).join(", ")}`);
  // Studentenactiviteiten vallen meestal op een weekdag (maandag tot donderdag).
  const wd = new Date(`${d.dag.start}T12:00:00Z`).getUTCDay();
  const weekdag = wd >= 1 && wd <= 4;

  // Kies de soort: eerst wat het dossier zelf zegt, dan wat vroeger op dezelfde plek gebeurde.
  let soort = "", reden = "", basis = "";
  const studentVroeger = perSoort.get("student");
  if (eigen.includes("student")) {
    soort = /doop/.test(plat(d.beschrijvingen.join(" "))) ? "een studentendoop" : "een studentenactiviteit (doop of dril)";
    reden = "Het dossier zelf spreekt van een doop of dril.";
    basis = "eigen";
  } else if (eigen.includes("haltes") && doop && (plekken.length || studentVroeger)) {
    soort = "een studentenactiviteit: een tocht te voet langs haltes";
    reden = `Een tocht met haltes in de doopperiode${plekken.length ? `, langs ${joinNl(plekken.slice(0, 3))} (plekken uit het studentencharter)` : ""}${studentVroeger ? `; op dezelfde route lag in ${joinNl([...studentVroeger.jaren].sort())} ook een studentenactiviteit` : ""}.`;
    basis = "eigen+charter";
  } else if (eigen.length) {
    const k = eigen[0];
    soort = SOORT[k].met;
    reden = `De omschrijving in het dossier wijst op ${k === "haltes" ? "een tocht met haltes" : SOORT[k].met}.`;
    basis = "eigen";
  } else if (kort && doop && plekkenInname.length && (weekdag || studentVroeger)) {
    soort = "een studentenactiviteit in de doopperiode (zoals een doop of dril)";
    reden = `In de doopperiode, met een inname op ${joinNl(plekkenInname.slice(0, 3))}: ${plekkenInname.length > 1 ? "plekken" : "een plek"} die het studentencharter aanwijst voor drils of dopen${studentVroeger ? `; daar lag in ${joinNl([...studentVroeger.jaren].sort())} ook een studentenactiviteit` : ""}.`;
    basis = "charter";
  } else if (kort && studentVroeger && doop && (studentVroeger.jaren.size >= 2 || plekken.length)) {
    soort = "een studentenactiviteit in de doopperiode";
    reden = `In de doopperiode, op een plek waar in ${joinNl([...studentVroeger.jaren].sort())} ook een studentenactiviteit (doop of dril) een toelating kreeg${plekken.length ? `, bij ${joinNl(plekken.slice(0, 2))} uit het studentencharter` : ""}.`;
    basis = "historiek";
  } else if (kort && vroeger.length && vroeger[0][0] !== "student" && (vroeger.length === 1 || vroeger[0][1].jaren.size > vroeger[1][1].jaren.size)) {
    // Alleen wat vroeger gebeurde: twee jaren met hetzelfde trefwoord, of één jaar op dezelfde route
    // (een parcourslijn die voor 80 % samenvalt). Een plein waar van alles gebeurt, telt niet met één jaar.
    const [k, s] = vroeger[0];
    if (s.jaren.size >= 2 || (d.vorm.lijnen.length && s.overlap >= 0.8)) {
      soort = SOORT[k].met;
      reden = `Op dezelfde ${d.vorm.lijnen.length ? "route" : "plek"} lag in ${joinNl([...s.jaren].sort())} een dossier over ${SOORT[k].met}.`;
      basis = "historiek";
    }
  }
  if (!soort) return { methode: "regels", zekerheid: "onbekend", soortKey: "", signalen };
  return { methode: "regels", zekerheid: "waarschijnlijk", soort, soortKey: eigen[0] || vroeger[0]?.[0] || "", reden, basis, signalen };
}

// ---------- stap e: de kaartzin ----------

// "Lus van ongeveer 2,4 km in de Brederodewijk (district Antwerpen), begin en einde in de Belegstraat,
// op vrijdag 20 november." Getallen staan nooit na een straatnaam (geen huisnummers).
export function kmTekst(m) {
  if (!m) return "";
  if (m < 950) return `${Math.max(50, Math.round(m / 50) * 50)} m`;
  return `${(Math.round(m / 100) / 10).toLocaleString("nl-BE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
}
// "de Belegstraat", "het Theaterplein": het lidwoord bij een straatnaam.
export function metStraat(straat) {
  const s = clean(straat, 120);
  if (!s) return "";
  return /(?:plein|hof|park|eiland|steen|dok|veld|bos|plantsoen|domein|pad|kwartier|schoon)$/i.test(s) ? `het ${s}` : `de ${s}`;
}
export function routeZin(d, { vandaag = "" } = {}) {
  const v = d.vorm;
  const gebied = d.wijk ? ` in ${d.wijk} (district ${d.district || "Antwerpen"})` : d.district ? ` in district ${d.district}` : "";
  const delen = [];
  if (v.lijnen.length) {
    delen.push(`${v.lus ? "Lus" : "Route"} van ongeveer ${kmTekst(v.lengte)}${gebied}`);
    if (d.beginStraat && d.eindStraat) delen.push(d.beginStraat === d.eindStraat ? `begin en einde aan ${metStraat(d.beginStraat)}` : `van ${metStraat(d.beginStraat)} naar ${metStraat(d.eindStraat)}`);
    else if (d.beginStraat || d.eindStraat) delen.push(`${d.beginStraat ? "begin" : "einde"} aan ${metStraat(d.beginStraat || d.eindStraat)}`);
  } else if (v.heeftParcours && v.oppervlakte) {
    const opp = v.oppervlakte >= 10_000 ? `${(Math.round(v.oppervlakte / 1000) / 10).toLocaleString("nl-BE")} ha` : `${Math.max(100, Math.round(v.oppervlakte / 100) * 100).toLocaleString("nl-BE")} m²`;
    delen.push(`Parcours over een zone van ongeveer ${opp}${gebied}`);
    if (d.beginStraat) delen.push(`aan ${metStraat(d.beginStraat)}`);
  } else {
    delen.push(`Evenement zonder parcours${d.beginStraat ? `, aan ${metStraat(d.beginStraat)}` : ""}${gebied}`);
  }
  const dagen = dagenTekst(d.dag.start, d.dag.eind, vandaag);
  if (dagen) delen.push(dagen.startsWith("van ") ? dagen : `op ${dagen}`);
  return `${delen.join(", ")}.`;
}
export function kaartzin(d, { vandaag = "" } = {}) {
  const stand = GOEDGEKEURD.includes(d.status) ? "aanvraag goedgekeurd" : "aanvraag nog niet goedgekeurd";
  return `${routeZin(d, { vandaag })} Stand in A-Sign op ${datumTekst(vandaag, { jaar: true }) || vandaag}: ${stand}.`;
}

// ---------- alles samen ----------

const RANG = { zeker: 3, waarschijnlijk: 2, onbekend: 1 };
const leeg = () => ({ naam: "", soort: "", organisator: "", reden: "", uren: "", urenNoot: "", watMerkJe: "", link: "", linkLabel: "", linkUitleg: "", extraLinks: [] });
const KALENDER_PAGINA = /wat-beleef-je-in-district|kalender|agenda|activiteiten|overzicht/i;

function voorstelUitKoppeling(v, d) {
  const { m } = v;
  const k = m.k;
  const soortKey = m.soortK || d.soort;
  const methode = k.bron === "gipod" ? "gipod" : k.bron === "organisator" ? "organisator" : "kalender";
  const plek = m.plek.hoe === "vlak" ? `het evenementvlak in GIPOD overlapt ${Math.round(m.plek.overlap * 100)} % van de route`
    : m.plek.hoe === "punt" ? `de plek ligt op ${m.plek.meter} m van ${d.vorm.lijnen.length ? "het parcours" : "de innames"}`
      : m.plek.hoe === "straat" ? `de ${m.plek.straat} ligt op het parcours`
        : m.plek.hoe === "naam" ? `het dossier noemt zelf '${m.plek.naam}'`
          : m.plek.hoe === "district" ? `zelfde district (${k.district})` : "zelfde postcode";
  const signalen = [`${k.bronLabel}: '${clean(k.titel, 80)}' op ${datumTekst(k.dag)}; ${plek}`];
  if (m.zelfdeSoort) signalen.push(`soort in het dossier en in de bron: ${SOORT[soortKey]?.zonder || soortKey}`);
  if (v.twijfel) signalen.push(`twijfel: ${v.twijfel}`);
  const link = publiekeLink(k.link);
  const r = {
    methode, zekerheid: v.zekerheid, signalen,
    bron: [link].filter(Boolean),
    link, linkLabel: link && KALENDER_PAGINA.test(link) && methode === "kalender" ? `${capital(k.bronLabel)} (meerdere activiteiten)` : "",
    linkUitleg: link && /wat-beleef-je-in-district/i.test(link) ? `Op de districtskalender, bij ${datumTekst(k.dag)}.` : "",
    uren: v.zekerheid === "zeker" || v.metNaam ? clean(k.tijd, 300) : "",
    organisator: v.zekerheid === "zeker" ? clean(k.organisator, 200) : "",
  };
  // Bij een agenda van een organisatie hoort haar naam erbij ("D%p" zegt niets, "D%p (Fabiant)" wel).
  const kortOrg = clean(k.organisator, 120).split(" (")[0];
  const naam = clean(kortOrg && !plat(k.titel).includes(plat(kortOrg)) ? `${k.titel} (${kortOrg})` : k.titel, 120);
  if (v.zekerheid === "zeker") {
    r.naam = naam;
    r.soort = SOORT[soortKey]?.zonder || "evenement";
  } else {
    r.naam = v.metNaam ? naam : "";
    r.soort = SOORT[soortKey]?.met || (v.metNaam ? `het evenement '${clean(k.titel, 100)}'` : "");
    r.reden = v.metNaam
      ? `Op dezelfde dag staat '${clean(k.titel, 100)}' in de ${k.bronLabel}; ${plek}. Dat dit dossier erbij hoort, staat nergens letterlijk.`
      : `Op dezelfde dag en plek staat ${v.twijfel ? "meer dan één activiteit" : "een activiteit"} van deze soort in de ${k.bronLabel}; welke bij dit dossier hoort, is niet zeker.`;
    if (!r.soort) return null;
  }
  return r;
}

// Eén dossier: alle stappen, de hoogste eerlijke zekerheid, en altijd de kaartzin.
export function herkenDossier(d, { koppeling = null, bibliotheek = [], historiek = [], charter = null, vandaag = "" } = {}) {
  const voorstellen = [];
  const patroon = stapPatroon(d, bibliotheek);
  if (patroon) voorstellen.push(patroon);
  const kal = koppeling ? voorstelUitKoppeling(koppeling, d) : null;
  if (kal) voorstellen.push(kal);
  const regels = stapRegels(d, { historiek, charter });
  if (regels.zekerheid !== "onbekend") voorstellen.push(regels);

  // Tegenspraak verlaagt: een kalendernaam die niet past bij het patroon of bij de soort in het dossier.
  if (kal?.zekerheid === "zeker") {
    if (patroon?.naam && !zelfdeTitel(patroon.naam, kal.naam) && !naamBewijs(kal.naam, [patroon.naam])) { kal.zekerheid = "waarschijnlijk"; kal.signalen.push(`twijfel: het patroon wijst op ${patroon.naam}`); }
    if (regels.soortKey && koppeling.m.soortK && !soortPast(regels.soortKey, koppeling.m.soortK)) { kal.zekerheid = "waarschijnlijk"; kal.signalen.push("twijfel: de soort in het dossier past niet"); }
    if (kal.zekerheid === "waarschijnlijk") { kal.soort = metLidwoord(kal.soort); kal.reden = `Op dezelfde dag en plek staat '${kal.naam}' in de bron, maar niet alles klopt.`; }
  }
  const volgorde = { kalender: 0, gipod: 0, organisator: 1, patroon: 2, regels: 3 };
  voorstellen.sort((a, b) => RANG[b.zekerheid] - RANG[a.zekerheid] || Number(Boolean(b.naam)) - Number(Boolean(a.naam)) || volgorde[a.methode] - volgorde[b.methode]);
  const keuze = voorstellen[0] || null;
  const signalen = uniek([...(keuze?.signalen || []), ...voorstellen.filter((v) => v !== keuze).flatMap((v) => v.signalen || []), ...(keuze ? [] : regels.signalen)]).slice(0, 6).map((s) => clean(s, 200));

  const waar = routeZin(d, { vandaag });
  const record = {
    zekerheid: keuze?.zekerheid || "onbekend",
    ...leeg(),
    // De site gebruikt de eerste en de laatste dag; een lange inname krijgt alleen die twee.
    dagen: evenementDagen(d).length <= 14 ? evenementDagen(d) : [d.dag.start, d.dag.eind],
    waar,
    binnenDistrict: Boolean(d.binnenDistrict),
    bron: [],
    bijgewerkt: vandaag,
    methode: keuze?.methode || "kaart",
    signalen,
    kaartzin: kaartzin(d, { vandaag }),
    goedgekeurd: GOEDGEKEURD.includes(d.status),
  };
  if (keuze) {
    const max = { naam: 120, soort: 200, organisator: 200, reden: 400, uren: 300, link: 500, linkLabel: 80, linkUitleg: 160 };
    for (const k of Object.keys(max)) if (keuze[k]) record[k] = k === "link" ? keuze[k] : zonderNummers(keuze[k], max[k]);
    record.bron = keuze.bron || [];
  }
  if (record.zekerheid === "waarschijnlijk" && !record.soort) record.zekerheid = "onbekend";
  if (record.zekerheid !== "zeker" && record.zekerheid !== "waarschijnlijk") { record.naam = ""; record.soort = ""; record.reden = ""; record.organisator = ""; record.uren = ""; record.link = ""; record.linkLabel = ""; record.linkUitleg = ""; record.bron = []; }
  record.bron = uniek([...record.bron.map(publiekeLink), ASIGN_BRON]).filter(Boolean);
  // "Zeker" vraagt een naam en een eigen publieke bron naast A-Sign; anders een trap lager.
  if (record.zekerheid === "zeker" && (!record.naam || record.bron.length < 2)) {
    record.zekerheid = "waarschijnlijk";
    record.soort = metLidwoord(record.soort) || "een evenement";
    record.reden = record.reden || `Op dezelfde dag en plek staat '${record.naam}' in de bron, zonder pagina om naar te linken.`;
  }
  return record;
}

// Een veilige fiche met alleen de kaartzin, voor een dossier waarvan de fiche niet door de validatie raakt.
export function alleenKaartzin(record) {
  return {
    ...record, zekerheid: "onbekend", naam: "", soort: "", organisator: "", reden: "", uren: "", urenNoot: "", watMerkJe: "",
    link: "", linkLabel: "", linkUitleg: "", extraLinks: [], bron: [ASIGN_BRON], methode: "kaart",
  };
}

// Dossierfeiten verrijken met wat de stappen nodig hebben: vorm, soort, straten, gebied.
// straatBij(punt) -> straatnaam of ""; stratenLangs(lijnen) -> [straatnamen]; wijkVan(straat) -> wijk.
export function verrijk(d, { straatBij = () => "", postcodeBij = () => "", stratenLangs = () => [], wijkVan = () => "", districten = [], districtGrens = null } = {}) {
  const vorm = vormVan(d.innames);
  const midden = vorm.start || vorm.kern[0] || (vorm.bbox ? [(vorm.bbox[0] + vorm.bbox[2]) / 2, (vorm.bbox[1] + vorm.bbox[3]) / 2] : null);
  const district = districtVan(midden, districten) || "";
  // Zonder parcourslijn: de straat bij de eerste inname die er een heeft (hoogstens drie pogingen).
  const beginStraat = vorm.start ? straatBij(vorm.start) : [...vorm.kern, midden].filter(Boolean).slice(0, 3).map((p) => straatBij(p)).find(Boolean) || "";
  const eindStraat = vorm.eind ? straatBij(vorm.eind) : "";
  const straten = uniek(stratenLangs([...vorm.lijnen, ...vorm.vlakken.flat()]));
  const kernStraten = uniek([beginStraat, eindStraat, ...vorm.kern.map((p) => straatBij(p))]);
  const binnenDistrict = districtGrens ? [...routePunten(vorm), ...vorm.kern].some((p) => districtVan(p, [{ naam: "x", geometry: districtGrens }])) : district === "Antwerpen";
  return {
    ...d, vorm, district, wijk: district === "Antwerpen" ? clean(wijkVan(beginStraat), 80) : "", beginStraat, eindStraat,
    straten, kernStraten, postcodes: uniek([vorm.start, vorm.eind, ...vorm.kern].filter(Boolean).map((p) => postcodeBij(p))), binnenDistrict,
    soort: eersteSoort(d.beschrijvingen),
  };
}

// Het hele bestand. hand: evenement-identiteit.json; bibliotheek: patronen; kandidaten: zie hierboven.
export function bouwHerkenning({ dossiers = [], hand = null, bibliotheek = [], kandidaten = [], historiek = {}, charter = null, vandaag = "", generatedAt = "", bronFouten = [] } = {}) {
  const handDossiers = hand?.dossiers || {};
  const open = dossiers.filter((d) => !handDossiers[d.dossier]);
  // De soort uit de regels telt ook mee voor de koppeling (een dossier zonder omschrijving).
  for (const d of open) if (!d.soort) d.soort = stapRegels(d, { historiek: historiek[d.dossier] || [], charter }).soortKey || "";
  // Ook dossiers met een handfiche doen mee als "ander dossier op die plek" bij de koppeling.
  const koppelingen = koppelKandidaten(dossiers, kandidaten);
  const uit = {};
  for (const d of open) {
    uit[d.dossier] = herkenDossier(d, { koppeling: koppelingen.get(d.dossier) || null, bibliotheek, historiek: historiek[d.dossier] || [], charter, vandaag });
  }
  const rows = Object.values(uit);
  const tel = (z) => rows.filter((r) => r.zekerheid === z).length;
  const samenvatting = {
    dossiers: dossiers.length, metHandfiche: dossiers.length - open.length, automatisch: rows.length,
    zeker: tel("zeker"), waarschijnlijk: tel("waarschijnlijk"), alleenKaartzin: tel("onbekend"),
    perMethode: Object.fromEntries(METHODES.map((m) => [m, rows.filter((r) => r.methode === m).length])),
    bronFouten: uniek(bronFouten).slice(0, 20),
  };
  return {
    schemaVersion: 1,
    generatedAt,
    bijgewerkt: vandaag,
    uitleg: "Automatisch herkend bij elke verversing (lib/parcours-herkenning.mjs), alleen voor dossiers zonder handfiche in evenement-identiteit.json. Niet met de hand nagekeken. 'zeker' alleen met een bron die dag en plek noemt; methode en signalen zeggen waarop elke fiche steunt.",
    samenvatting,
    dossiers: Object.fromEntries(Object.entries(uit).sort((a, b) => a[0].localeCompare(b[0]))),
  };
}

// Patroonbibliotheek bijwerken: elk dossier met een handfiche (zeker of waarschijnlijk) of een
// automatische "zeker", met een vereenvoudigde route. Blijft vier jaar staan.
export function bijwerkenPatronen(vorige = null, { dossiers = [], hand = null, auto = null, vandaag = "" } = {}) {
  const patronen = { ...(vorige?.patronen || {}) };
  const grens = isDag(vandaag) ? plusDagen(vandaag, -4 * 366) : "";
  for (const d of dossiers) {
    const h = hand?.dossiers?.[d.dossier];
    const a = auto?.dossiers?.[d.dossier];
    const fiche = h && h.zekerheid !== "onbekend" ? { ...h, bronSoort: "hand" } : a?.zekerheid === "zeker" ? { ...a, bronSoort: "auto" } : null;
    if (!fiche || !d.vorm) continue;
    const lijnen = d.vorm.lijnen.map((l) => vereenvoudig(l)).filter((l) => l.length >= 2).slice(0, 12);
    const vlakken = lijnen.length ? [] : d.vorm.vlakken.map((rings) => rings.map((r) => vereenvoudig(r, 8)).filter((r) => r.length >= 4)).filter((r) => r.length).slice(0, 6);
    if (!lijnen.length && !vlakken.length) continue;
    patronen[d.dossier] = {
      dag: d.dag.start, zekerheid: fiche.zekerheid, naam: fiche.zekerheid === "zeker" ? clean(fiche.naam, 120) : "",
      soort: clean(fiche.soort, 200), organisator: fiche.zekerheid === "zeker" ? clean(fiche.organisator, 200) : "",
      link: publiekeLink(fiche.link), bron: fiche.bronSoort, vorm: { lijnen, vlakken },
    };
  }
  for (const [k, p] of Object.entries(patronen)) if (grens && p.dag < grens) delete patronen[k];
  return {
    schemaVersion: 1,
    bijgewerkt: vandaag,
    uitleg: "Routes van herkende evenementendossiers (met de hand of automatisch zeker), zodat hetzelfde evenement volgend jaar vanzelf herkend wordt (lib/parcours-herkenning.mjs, stap patroon).",
    patronen: Object.fromEntries(Object.entries(patronen).sort((a, b) => a[0].localeCompare(b[0]))),
  };
}
export const bibliotheekUit = (doc) => Object.entries(doc?.patronen || {}).map(([dossier, p]) => ({ dossier, ...p }));
