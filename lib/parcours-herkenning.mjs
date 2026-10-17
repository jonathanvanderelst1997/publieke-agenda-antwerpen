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
// "Zeker" alleen met een bron die dag én plek noemt (een punt binnen 100 m, een vlak, een straat of een
// eigen naam), één kandidaat, een soort- of naambewijs uit het dossier zelf (niet uit vorige jaren of het
// charter), en geen ander dossier met een parcours of een eigen soort op die plek die dag. Een foute naam
// is erger dan geen naam: bij twijfel altijd de lagere zekerheid.
//
// Puur: geen netwerk, geen klok (vandaag komt van buiten). De verversing staat in
// lib/parcours-herkenning-refresh.mjs. Vrije tekst uit A-Sign gaat nooit letterlijk in een fiche:
// alleen trefwoorden uit vaste lijsten (zie SOORTEN) en straatnamen uit de straatas.
import { dagVan, dagenTekst, dagenTussen, datumTekst, opStraat } from "../site/kaart-uitleg.js";
import {
  DINGEN, GROOT_TERREIN_M2, KLEIN_M2, LANG_DAGEN, OPNAME, alleenStraat, dingKeuze, dingVan, duurDagen, inWijk, isOpnameFase, oppervlakteTekst, patroonTekst, patroonVan,
  versieringTekst, voorwerpenIn, weekdagenTussen, wijkNaam, zonderOntkenning,
} from "../site/evenement-wat.js";
import { HERKENNING_FILE, METHODES, PATRONEN_FILE } from "./evenement-herkenning-validatie.mjs";
import { plaatsnaamVan } from "./plaatsnaam.mjs";
import { onbekendZin } from "../site/onbekend-zinnen.js";
import { veiligeFase } from "../site/witte-lijst.js";

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
  zekerPuntMeter: 100, // kalender: 'zeker' alleen met een punt zo dicht (verder: hoogstens een vermoeden)
  langeRouteMeter: 1500, // langer dan dit telt alleen de kern (start, einde, innames) als plek
  historiekOverlap: 0.6, // regels: oudere dossiers op dezelfde plek
  lusMeter: 100, // begin en einde dichter dan dit: een lus
  maxEvenementDagen: 3, // langere innames (een markt, een werf) koppelen we nooit aan een agendapunt
  grootVlakMeter: 1500, // een zone met een diagonaal boven dit (een verkeersvrije zone over de halve stad) zegt niets over één plek
  // Het middelpunt van een vlak groter dan dit (of met een diagonaal boven grootVlakMeter) is geen plek van het
  // evenement: ET2025007162 tekent een "Evenement Inname" van 13,3 km² over bijna heel het centrum, met zijn
  // middelpunt aan de Groenplaats. Niet 1 ha: in A-Sign zijn pleinen en straten van 2 tot 60 ha getekend
  // waarvan het middelpunt wél de plek uit de omschrijving is ("MAS - verkoop" 2,2 ha aan de
  // Hanzestedenplaats, "de meir, verkoop" 4,9 ha op de Meir, "paardenmarkt" 5,1 ha; telling van 12-10-2026).
  middelpuntVlakM2: 1_000_000,
  historiekMin: 0.4, // regels: oudere dossiers tellen alleen met ook zoveel overlap in de andere richting
});

const clean = (v, max = 300) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const uniek = (rows) => [...new Set(rows.map((v) => clean(v)).filter(Boolean))];
export const plat = (t) => clean(t, 400).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const capital = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : "");
const joinNl = (list) => (list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} en ${list.at(-1)}`);
const isDag = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const plusDagen = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
// Een huisnummer na een straatnaam ("Voorbeeldlaan 32") kan een woning zijn: weg ermee, zoals in
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
    // De naam van de fase alleen als vaste vorm of district (veiligeFase in site/witte-lijst.js): faseNaam is vrij in te
    // vullen, en de fasen komen in district-asign-evenementen.json.
    const fase = veiligeFase(a.faseNaam), start = msDag(a.faseStartDatum), eind = msDag(a.faseEindDatum) || start;
    if (fase && start) {
      const p = d.fasen.get(fase) || { naam: fase, start, eind };
      if (start < p.start) p.start = start;
      if (eind > p.eind) p.eind = eind;
      d.fasen.set(fase, p);
    }
    const g = f?.geometry || null;
    const geometry = g?.paths ? { paths: g.paths } : g?.rings ? { rings: g.rings } : g?.type === "LineString" ? { paths: [g.coordinates] } : g?.type === "MultiLineString" ? { paths: g.coordinates } : g?.type === "Polygon" ? { rings: g.coordinates } : null;
    // De oppervlakte van A-Sign zelf (Shape_Area, laag 22): op de volle vorm, niet op de vereenvoudigde.
    const m2 = Number(a.Shape_Area);
    d.innames.push({ type: clean(a.innameTypeNaam, 60), beschrijving: clean(a.innameBeschrijving, 400), fase, start, eind, geometry, ...(Number.isFinite(m2) && m2 > 0 ? { m2 } : {}) });
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
  // Per vlak: is het een reuzenvlak (reuzenVlak)? Dan telt zijn middelpunt niet als plek (kern).
  const reus = new Set();
  for (const i of innames) {
    const parcours = /parcours/i.test(i.type || "");
    for (const l of i.geometry?.paths || []) if (Array.isArray(l) && l.length >= 2 && l.every(geldig) && nieuw(l)) (parcours ? pl : al).push(l);
    const rings = (i.geometry?.rings || []).filter((r) => Array.isArray(r) && r.length >= 4 && r.every(geldig));
    if (rings.length && nieuw(rings)) {
      (parcours ? pv : av).push(rings);
      if (reuzenVlak(rings, i.m2)) reus.add(rings);
    }
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
  // Vormen de lijnen één keten (het einde van elke lijn bij het begin van de volgende, in de volgorde van
  // de bron)? Alleen dan is het begin van de eerste lijn een vertrekpunt. Losse stukken of een lus: niet.
  const keten = routeLijnen.length >= 1 && routeLijnen.every((l, i) => !i || meterTussen(routeLijnen[i - 1].at(-1), l[0]) <= KETEN_METER);
  const ketenStart = keten ? routeLijnen[0][0] : null, ketenEind = keten ? routeLijnen.at(-1).at(-1) : null;
  // Of: alle lijnen beginnen op dezelfde plek (twee stoeten op twee dagen vanaf hetzelfde plein).
  const zelfdeBegin = routeLijnen.length > 1 && routeLijnen.every((l) => meterTussen(l[0], routeLijnen[0][0]) <= KETEN_METER);
  const centrum = (rings) => { const b = boxVan(rings.flat()); return b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : null; };
  // De kern: begin en einde van de route, het middelpunt van elk ander vlak (niet van een reuzenvlak) en het
  // begin van elke andere lijn.
  const kern = [start, eind, ...av.filter((r) => !reus.has(r)).map(centrum), ...al.map((l) => l[0])].filter(geldig);
  const alles = [...pl, ...al, ...pv.flat(), ...av.flat()];
  return {
    lijnen: routeLijnen, vlakken: routeVlakken, parcoursVlakken: pv, andereLijnen: al, andereVlakken: av,
    heeftParcours: Boolean(pl.length || pv.length), lengte: Math.round(lengte), start, eind,
    lus: Boolean(start && eind && meterTussen(start, eind) <= DREMPELS.lusMeter),
    keten, ketenStart, ketenEind, ketenLus: Boolean(keten && meterTussen(ketenStart, ketenEind) <= DREMPELS.lusMeter),
    // Een echt vertrekpunt uit de vorm: het begin van een keten (geen lus), of het gedeelde begin van alle lijnen.
    vertrek: keten && meterTussen(ketenStart, ketenEind) > DREMPELS.lusMeter ? ketenStart : zelfdeBegin ? routeLijnen[0][0] : null,
    oppervlakte: Math.round(Math.abs(routeVlakken.reduce((s, r) => s + oppervlakte(r), 0))),
    kern, bbox: boxVan(alles.flat ? alles.flat() : []),
    // Zoveel vlakken zijn te groot om hun middelpunt als plek te nemen (ook niet als terugval in verrijk).
    reuzenvlakken: reus.size,
    index: maakIndex({ lijnen: [...pl, ...al], vlakken: [...pv, ...av] }),
    routeIndex: maakIndex({ lijnen: routeLijnen, vlakken: routeVlakken }),
  };
}

// Twee parcourslijnen sluiten aan als het einde van de ene zo dicht bij het begin van de volgende ligt.
const KETEN_METER = 30;
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
// De dingen uit site/evenement-wat.js (de doop van een schip, een kermis, een reuzenrad, stickers ...)
// staan vooraan: "doopfeest" met een scheepsnaam is geen studentendoop. Of een ding het hele dossier is,
// beslist dingKeuze (site/evenement-wat.js), niet de volgorde alleen.
// `zwak`: een woord dat ook iets anders kan zijn ("lopen", "Grote Prijs", "11 november"). Dat telt alleen
// bij een dossier met een eigen parcours (stapRegels), en nooit zonder "vermoedelijk".
// Woordgrenzen (nagekeken op 11 oktober 2026): "winkelwandelgebied" is geen wandeling, "workshop" geen
// winkelevenement, "reuzendoop" geen studentendoop, een foor bij een stoet (in één woord) geen stoet maar een foor, en
// "Markt" met een huisnummer erachter is een adres in een straat die Markt heet, geen markt.
const DING_SOORTEN = DINGEN.map((d) => ({ key: d.key, re: d.re, zonder: d.zonder, met: d.met, beweegt: false, ding: true }));
export const SOORTEN = Object.freeze([
  ...DING_SOORTEN,
  // Uit de fasenaam van het dossier ("Opname periode 1"), nooit uit een omschrijving: zie stapRegels.
  { key: OPNAME.key, re: /(?!)/, zonder: OPNAME.zonder, met: OPNAME.met, beweegt: false, ding: true },
  { key: "student", re: /\bdoop|studentendoop|schachtendoop|\bdrill?\w*|schacht|ontgroen|welkomstritueel|kroegentocht|cantus|studenten(?:club|vereniging|activiteit|tocht|stoet)/, zonder: "studentenactiviteit", met: "een studentenactiviteit", beweegt: true },
  { key: "school", re: /\bschool|\bscholen\b|leerlingen/, zonder: "schoolactiviteit", met: "een schoolactiviteit", beweegt: true },
  { key: "herdenking", re: /herdenk|wapenstilstand|last post|gesneuvelde/, zwak: /\b11 november\b/, zonder: "herdenking", met: "een herdenking", beweegt: true },
  { key: "sint", re: /sinterklaas|\bde sint\b|\bsint (?:en|op|komt|in)\b|\bkoets sint\b|\bsint koets\b|\bsintstoet/, zonder: "Sinterklaasstoet of -feest", met: "een Sinterklaasstoet of -feest", beweegt: true },
  { key: "halloween", re: /halloween|griezel/, zonder: "Halloween-activiteit", met: "een Halloween-activiteit", beweegt: true },
  { key: "winkel", re: /\bshop|winkelfestival|winkeldag|winkelevenement|koopavond/, zonder: "winkelevenement", met: "een winkelevenement", beweegt: false },
  { key: "wieler", re: /wieler|\w*koers(?:en)?\b|criterium|wielren|cyclocross|veldrit/, zwak: /\w*prijs\b/, zonder: "wielerwedstrijd", met: "een wielerwedstrijd", beweegt: true },
  { key: "fiets", re: /fietstocht|fietstoer|fietsrit|fietsersbond/, zonder: "fietstocht", met: "een fietstocht", beweegt: true },
  { key: "wandel", re: /(?<!winkel)wandel|\bwalk\b/, zonder: "wandeling", met: "een wandeling", beweegt: true },
  { key: "loop", re: /\b\d+(?: \d+)? ?(?:k|km|kilometer)\b|loopwedstrijd|stratenloop|parkloop|veldloop|sponsorloop|marathon|jogging|trail(?!er)|\w*run\b/, zwak: /\bloop\b|\blopen\b/, zonder: "loopwedstrijd of loop", met: "een loopwedstrijd of loop", beweegt: true },
  { key: "stoet", re: /stoet(?:en)?\b|optocht(?:en)?\b|parades?\b|processies?\b|carnaval|defile\b|\bpraalwagen(?:s)?\b/, zonder: "stoet", met: "een stoet", beweegt: true },
  { key: "tocht", re: /\w+tocht\b|\btocht\b/, zonder: "tocht", met: "een tocht", beweegt: true },
  { key: "haltes", re: /\w+stop\b|\bstop\b/, zonder: "tocht te voet langs haltes", met: "een tocht te voet langs haltes", beweegt: true },
  { key: "buurtfeest", re: /straatfeest|buurtfeest|wijkfeest|burenfeest|pleinfeest/, zonder: "buurtfeest", met: "een buurtfeest", beweegt: false },
  // Ook samenstellingen ("Boekenmarkt", "jaarmarkt"), maar geen straatnamen zoals Vismarkt of Vrijdagmarkt,
  // en geen adres (het woord markt met een huisnummer erachter).
  { key: "markt", re: /braderie|braderij|(?<!grote )\bmarkt(?:en)?\b(?! \d)|boekenplein|\b(?:boeken|jaar|vlooien|antiek|boeren|ambachten|kunst|platen|bloemen|avond|nacht|winter|zomer|paas|design|streek|tweedehands|week|wereld|food|hobby|kinder|ruil|planten|brocante|vinyl|strip|retro|vintage|kerst|rommel)markt(?:en)?\b/, zonder: "markt", met: "een markt", beweegt: false },
]);
const SOORT = Object.fromEntries(SOORTEN.map((s) => [s.key, s]));
// Soorten die bij elkaar passen (een loop met een wandeling, een Halloweentocht te voet ...).
const PAST = {
  loop: ["wandel", "tocht", "halloween"], wandel: ["loop", "tocht", "halloween", "haltes", "herdenking"], tocht: ["wandel", "loop", "fiets", "halloween", "haltes"],
  stoet: ["sint", "herdenking", "student", "halloween"], sint: ["stoet"], herdenking: ["stoet", "wandel"], halloween: ["wandel", "loop", "tocht", "stoet"],
  student: ["haltes", "stoet"], haltes: ["student", "wandel", "tocht"], wieler: [], fiets: ["tocht"], school: [], winkel: ["markt"], markt: ["winkel"], buurtfeest: [],
  kermis: ["markt"], oldtimer: [], schip: [], reuzenrad: [], versiering: ["winkel"], sticker: [], bladslag: [], mammobiel: [], bord: [], opname: [],
};
// De tekst waarop de woorden getoetst worden: plat, zonder ontkenningen ("geen kermis").
const woordTekst = (teksten = []) => ` ${teksten.map((x) => plat(zonderOntkenning(x))).join(" | ")} `;
// Welke soorten staan in de omschrijvingen: [{ key, sterk }], eerst de sterke woorden (in de volgorde van
// SOORTEN), dan de zwakke.
export function soortenMet(teksten = []) {
  const t = woordTekst(teksten);
  const sterk = SOORTEN.filter((s) => s.re.test(t)).map((s) => ({ key: s.key, sterk: true }));
  const zwak = SOORTEN.filter((s) => s.zwak && !s.re.test(t) && s.zwak.test(t)).map((s) => ({ key: s.key, sterk: false }));
  return [...sterk, ...zwak];
}
export function soortenIn(teksten = []) {
  return soortenMet(teksten).map((s) => s.key);
}
export const eersteSoort = (teksten) => soortenIn(teksten)[0] || "";
export const soortPast = (a, b) => !a || !b || a === b || (PAST[a] || []).includes(b);

// Woorden die niets over één bepaald evenement zeggen (voor het naambewijs).
const GEWOON = new Set(("de het een en van voor met op in aan te ter tot naar bij door om uit over na tijdens langs ontdek pracht kom doe mee gratis " +
  "editie jaarlijkse jaarlijks nationale nationaal grote kleine nieuwe dag dagen avond middag ochtend weekend feest feesten evenement evenementen " +
  "district stad antwerpen parcours route start finish opbouw afbraak inname innames tent tenten toiletten nadars stand standen zone locatie " +
  "plein straat laan park kilometer meter kasteel kerk speeltuin sporthal schoolplein gemeentepark stadspark domein campus fort brug kaai " +
  "grasveld parking podium muziek optreden animatie kinderen jeugd senioren familie families wijk buurt buren school scholen verenigingen " +
  "vereniging sportpark centrum station dorp dorpsplein event events").split(" "));
// Plaatsnamen zijn geen eigen naam van een evenement ("Familiedag in Merksem" naast een dossier dat
// "Merksem" noemt): districten, deelgemeenten en buurgemeenten. Wijken komen van de verversing.
const GEBIED = new Set(("antwerpen berchem borgerhout borsbeek deurne ekeren hoboken merksem wilrijk berendrecht zandvliet lillo linkeroever " +
  "mortsel edegem schoten kapellen stabroek brasschaat wijnegem zwijndrecht burcht boechout hove aartselaar schelle hemiksem kontich ranst wommelgem schilde").split(" "));
// Een straat, plein of park is een plek, geen naam ("Boekvoorstelling in de Meirstraat").
const PLAATSWOORD = /(?:straat|laan|lei|plein|baan|weg|kaai|vest|rui|markt|plaats|dreef|pad|hof|dijk|singel|brug|park|plantsoen|dok|kade)$/;
// Een woord dat niets over één bepaald evenement zegt (ook voor de toetsen tegen de handfiches).
export const gewoonWoord = (w) => GEWOON.has(w) || GEBIED.has(w) || PLAATSWOORD.test(w);
// Afkortingen die in A-Sign gewoon zijn (verkeersvrije zone, parkeerverbod ...) of in elke tekst staan.
const AFKORTING = new Set("vze vvz pvb lez ehbo ivm iov ism mbt nvt tbc evt etc aub".split(" "));
// Een eigen naam uit de titel die ook in het dossier staat ("EkeRun" in "Ekerun 10 km"), of de
// beginletters van een naam uit hoofdletterwoorden ("JSP" voor "Jaak Schram Parkloop").
// gewoon: extra plaatsnamen (wijken); straten: de straten van het dossier.
export function naamBewijs(titel, beschrijvingen = [], { gewoon = null, straten = [] } = {}) {
  const dossier = ` ${plat(beschrijvingen.join(" | "))} `;
  if (dossier.trim().length < 3) return "";
  const eigenStraten = new Set(straten.flatMap((s) => plat(s).split(" ")).filter(Boolean));
  const isPlek = (w) => w.split(" ").some((x) => GEWOON.has(x) || GEBIED.has(x) || PLAATSWOORD.test(x) || eigenStraten.has(x) || Boolean(gewoon?.has(x)));
  const tokens = clean(titel, 300).split(/[^\p{L}\p{N}'’-]+/u).filter(Boolean);
  for (const [i, t] of tokens.entries()) {
    const w = plat(t);
    if (w.length < 5 || /\d/.test(w) || isPlek(w)) continue;
    // Alleen een eigen naam: gemengde hoofdletters ("EkeRun", "AAAntwerp"), of een woord met een
    // hoofdletter midden in de titel dat geen soortwoord is ("Muisbroek", niet "Criterium").
    const gemengd = /\p{Ll}\p{Lu}|\p{Lu}{2}\p{Ll}/u.test(t);
    const eigen = i > 0 && /^\p{Lu}/u.test(t) && soortenIn([w]).length === 0;
    if ((gemengd || eigen) && dossier.includes(` ${w} `)) return w;
  }
  for (const reeks of clean(titel, 300).matchAll(/(?:\b\p{Lu}[\p{L}'’-]{2,}\s+){1,4}\p{Lu}[\p{L}'’-]{2,}/gu)) {
    const letters = reeks[0].split(/\s+/).map((w) => w[0].toLowerCase()).join("");
    if (letters.length >= 3 && !AFKORTING.has(letters) && dossier.includes(` ${letters} `)) return letters;
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
// Besluiten van de stad en het district (site/sources/evenement-besluiten.json, lib/ebesluit-evenementen.mjs):
// alleen een goedgekeurd en gelezen besluit met dag(en) en straat. Zonder straat geen naam (een evenement
// van één dag zonder plaats past op tientallen dossiers). Een organisator alleen met een rechtsvorm.
const RECHTSVORM = /\b(?:vzw|v\.z\.w\.|bv|nv|cv|bvba|cvba|vof|comm\.?\s?v)\b/i;
// De uren van een besluit ({ start, einde } in HH:MM, einde mag null zijn) als tekst voor de fiche en de
// kaart: "7 tot 9 uur", "vanaf 19.30 uur". Een einde vóór het begin valt na middernacht: dan alleen het
// begin. Dezelfde tekst als het agendapunt (urenVan in lib/asign-evenementen-agenda.mjs). Iets anders dan
// zo'n paar geeft "" (nooit "[object Object]" op de kaart).
const HHMM = /^\d{2}:\d{2}$/;
const uurKort = (u) => `${Number(u.slice(0, 2))}${u.slice(3) === "00" ? "" : `.${u.slice(3)}`}`;
export function besluitUrenTekst(uren) {
  const start = uren?.start, einde = uren?.einde;
  if (typeof start !== "string" || !HHMM.test(start)) return "";
  return typeof einde === "string" && HHMM.test(einde) && einde > start ? `${uurKort(start)} tot ${uurKort(einde)} uur` : `vanaf ${uurKort(start)} uur`;
}
export function kandidatenUitBesluiten(doc = {}) {
  const uit = [];
  for (const b of Array.isArray(doc?.besluiten) ? doc.besluiten : []) {
    if (b?.status !== "goedkeuring" || b.gelezen !== true || b.inDistrict === false) continue;
    const dagen = (Array.isArray(b.dagen) ? b.dagen : []).filter(isDag).sort();
    const titel = clean(b.naam, 160), straten = (Array.isArray(b.straten) ? b.straten : []).map((x) => clean(x, 80)).filter(Boolean);
    if (!titel || !dagen.length || !straten.length || dagenTussen(dagen[0], dagen.at(-1)) >= DREMPELS.maxEvenementDagen) continue;
    uit.push({
      titel, dag: dagen[0], eind: dagen.at(-1), tijd: besluitUrenTekst(b.uren), locatie: straten.join(", "), link: publiekeLink(clean(b.bron, 300)),
      bron: "besluit", bronLabel: "besluiten van stad en district", organisator: RECHTSVORM.test(clean(b.organisator, 200)) ? clean(b.organisator, 200) : "",
      punt: null, puntPrecisie: "", district: "", postcodes: Array.isArray(b.postcodes) ? b.postcodes.map((x) => clean(x, 4)) : [],
    });
  }
  return uit;
}
// De foorlijst van de stad (site/sources/district-foren.json, uit A-Sign laag 0): naam, periode en plein.
export function forenUitBron(doc = {}) {
  return (Array.isArray(doc?.items) ? doc.items : []).map((it) => ({
    titel: clean(it?.title, 160), dag: dagVan(it?.date), eind: dagVan(it?.endDate) || dagVan(it?.date),
    plein: clean(String(it?.location ?? "").split(",")[0], 80), link: publiekeLink(clean(it?.sourceUrl, 300)),
  })).filter((f) => f.titel && isDag(f.dag) && f.plein);
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
// Per lijst van plaatsnamen (ctx.gewoon), per kandidaat, per vorm.
const plekCache = new WeakMap();
const GEEN_NAMEN = new Set();
function plekVan(k, d, ctx = {}) {
  const namen = ctx.gewoon || GEEN_NAMEN;
  const perNamen = plekCache.get(namen) || new WeakMap();
  plekCache.set(namen, perNamen);
  const per = perNamen.get(k) || new WeakMap();
  perNamen.set(k, per);
  if (!per.has(d.vorm)) per.set(d.vorm, plekBerekend(k, d, ctx));
  return per.get(d.vorm);
}
function plekBerekend(k, d, ctx = {}) {
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
  const naam = naamBewijs(k.titel, d.beschrijvingen, { gewoon: ctx.gewoon, straten: d.straten });
  if (naam) return { niveau: "sterk", hoe: "naam", naam };
  if (k.district && d.district && k.district === d.district) return { niveau: "gebied", hoe: "district" };
  if (k.postcodes?.length && d.postcodes?.some((p) => k.postcodes.includes(p))) return { niveau: "gebied", hoe: "postcode" };
  return { niveau: "", hoe: "" };
}
const evenementDagen = (d) => (Array.isArray(d.dagen) && d.dagen.length ? d.dagen : [d.dag.start]);
const dagOverlapt = (k, d) => evenementDagen(d).some((x) => x >= k.dag && x <= (k.eind || k.dag));
// Een evenement van hoogstens twee dagen (een markt of een werf van weken koppelen we nooit).
export const kortEvenement = (d) => evenementDagen(d).length < DREMPELS.maxEvenementDagen;
// De soort uit de eigen omschrijving van het dossier (niet uit vorige jaren of het charter).
const eigenSoortVan = (d) => d.eigenSoort ?? eersteSoort(d.beschrijvingen || []);
// Kandidaat en dossier passen samen: dezelfde dag, een plek en een soort die niet botst.
function past(k, d, ctx = {}) {
  if (!kortEvenement(d) || !dagOverlapt(k, d)) return null;
  const soortK = k.soort || eersteSoort([k.titel]);
  if (!soortPast(soortK, d.soort)) return null;
  const plek = plekVan(k, d, ctx);
  if (!plek.niveau) return null;
  const eigen = eigenSoortVan(d);
  // Soortbewijs telt alleen uit wat het dossier zelf zegt: een soort uit vorige jaren of het
  // studentencharter is een vermoeden, geen bewijs dat dit agendapunt bij dit dossier hoort.
  const zelfdeSoort = Boolean(soortK && eigen && soortK === eigen);
  const naam = plek.hoe === "naam" ? plek.naam : naamBewijs(k.titel, d.beschrijvingen, { gewoon: ctx.gewoon, straten: d.straten });
  const vlakSterk = plek.hoe === "vlak" && plek.overlap >= 0.5;
  // Het dossier noemt zelf een soort en het agendapunt geen enkele (een concert naast een
  // schoolwandeling): dat agendapunt geeft dit dossier nooit een naam. Vlakbij telt het wel als
  // twijfel (een "Ronde van ..." zonder trefwoord kan toch een tweede wielerwedstrijd zijn).
  const vreemd = Boolean(eigen && !soortK && !naam && !vlakSterk);
  // Een besluit van de stad of het district noemt zelf de dag en de straat: dat is bewijs genoeg (zoals
  // een eigen naam), als de straat een straat van het dossier is.
  const besluitStraat = k.bron === "besluit" && plek.hoe === "straat";
  const sterk = !vreemd && plek.niveau === "sterk" && (zelfdeSoort || Boolean(naam) || vlakSterk || besluitStraat);
  // Dicht genoeg voor 'zeker': een exact punt binnen 100 m, of een vlak, straat of naam uit de bron.
  const dichtbij = plek.niveau === "sterk" && (plek.hoe !== "punt" || (plek.meter <= DREMPELS.zekerPuntMeter && k.puntPrecisie !== "straat"));
  return { k, d, plek, soortK, zelfdeSoort, naam, sterk, dichtbij, vreemd };
}
// Dezelfde titel, streng: gelijk, of de ene bevat de andere (minstens 8 tekens). Voor de tegenspraak
// tussen een kalendernaam en een patroonnaam.
export function zelfdeTitelStreng(a, b) {
  const x = plat(a), y = plat(b);
  return Boolean(x && y) && (x === y || (x.length >= 8 && y.includes(x)) || (y.length >= 8 && x.includes(y)));
}
// Ruimer, voor de vergelijking met de handfiches in de toetsen: ook een gemeenschappelijk stuk van
// minstens 8 letters zonder spaties ("Campustrail Multiversum" en "Campus Trailrun").
export function zelfdeTitel(a, b) {
  const x = plat(a), y = plat(b);
  if (!x || !y) return false;
  if (zelfdeTitelStreng(a, b)) return true;
  const p = x.replace(/ /g, ""), q = y.replace(/ /g, "");
  for (let i = 0; i + 8 <= p.length; i++) if (q.includes(p.slice(i, i + 8))) return true;
  return false;
}
// Dezelfde activiteit uit twee bronnen: dezelfde titel, op getallen (een jaartal) en gewone woorden na.
// "Halloween" en "Halloweentocht voor gezinnen" zijn twee activiteiten, en blijven dus twee kandidaten.
// Dezelfde link telt niet: een nieuwsbericht kan meer activiteiten noemen.
const kernTitel = (t) => plat(t).split(" ").filter((w) => w && !/^\d+$/.test(w) && !GEWOON.has(w)).join(" ");
export function zelfdeActiviteit(a, b) {
  const x = plat(a), y = plat(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const kx = kernTitel(a), ky = kernTitel(b);
  return Boolean(kx) && kx === ky;
}
// Twee agendapunten uit twee bronnen met dezelfde dag, dezelfde uren, dezelfde straat en een woord gemeen
// zijn hetzelfde evenement ("Halloween" in de kalender en "Griezelfeest bij ... op Halloween" in het
// nieuws). Uit dezelfde bron blijven het twee activiteiten (twijfel), net als zonder gemeen woord.
const urenSleutel = (t) => (clean(t, 120).match(/\d{1,2}(?:[.:h]\d{2})?/g) || []).join("-");
const straatSleutel = (l) => [...new Set(plat(l).match(/\b[a-z]+(?:straat|steenweg|laan|lei|plein|plaats|weg|kaai|vest|dreef|markt|rui|baan|park)\b/g) || [])].sort().join("|");
const woordenVan = (t) => new Set(plat(t).split(" ").filter((w) => w.length >= 5));
const zelfdePlekEnUur = (a, b) => a.dag === b.dag && clean(a.bronLabel) !== clean(b.bronLabel) && Boolean(urenSleutel(a.tijd)) && urenSleutel(a.tijd) === urenSleutel(b.tijd)
  && Boolean(straatSleutel(a.locatie)) && straatSleutel(a.locatie) === straatSleutel(b.locatie) && [...woordenVan(a.titel)].some((w) => woordenVan(b.titel).has(w));
function ontdubbel(paren) {
  const uit = [];
  for (const p of paren) {
    const dubbel = uit.find((q) => (zelfdeActiviteit(q.k.titel, p.k.titel) && q.k.dag === p.k.dag) || zelfdePlekEnUur(q.k, p.k));
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
      // Een dossier dat zelf een andere soort noemt, dingt niet mee naar dit agendapunt.
      if (m.vreemd) continue;
      if (!perKandidaat.has(k)) perKandidaat.set(k, []);
      perKandidaat.get(k).push(m);
    }
  }
  const voorstellen = new Map();
  for (const d of dossiers) {
    // Een vreemd agendapunt (zonder soort, bij een dossier met een eigen soort) telt alleen vlakbij, als twijfel.
    const alle = ontdubbel(perDossier.get(d.dossier) || []).filter((m) => !m.vreemd || m.dichtbij);
    const sterk = alle.filter((m) => m.plek.niveau === "sterk");
    const gebied = alle.filter((m) => m.plek.niveau === "gebied");
    let v = null;
    if (sterk.length === 1 && !sterk[0].vreemd) {
      const m = sterk[0];
      const anderen = (perKandidaat.get(m.k) || []).filter((x) => x.d.dossier !== d.dossier && x.plek.niveau === "sterk");
      // Eenduidig: geen ander dossier die dag op die plek, of alleen dossiers zonder parcours en zonder
      // eigen soort (een verkeersvrije zone of parkeerverbod rond hetzelfde evenement).
      const eenduidig = anderen.every((x) => !x.d.vorm.heeftParcours && !eigenSoortVan(x.d));
      const andereSterk = anderen.filter((x) => x.sterk);
      // 'Zeker' vraagt alles: soort of naam uit het dossier zelf, dicht bij, en eenduidig.
      if (m.sterk && m.dichtbij && eenduidig) v = { m, zekerheid: "zeker" };
      // Niet alles (een punt vlakbij zonder soortbewijs, de soort op 100 tot 250 m, een plein als plek):
      // een vermoeden met naam, zolang het eenduidig is.
      else if (eenduidig) v = { m, zekerheid: "waarschijnlijk", metNaam: true };
      // Meer dossiers die dag op die plek: de kandidaat hoort bij een ander dossier dat haar soort of
      // naam draagt, of het blijft bij de soort, en alleen als het dossier zelf al die soort noemt.
      else if (m.zelfdeSoort && !eenduidig && !andereSterk.length) v = { m, zekerheid: "waarschijnlijk", metNaam: false, twijfel: `ook ${anderen.length} ander dossier die dag op die plek` };
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
  const eigen = eigenSoortVan(d);
  for (const e of bibliotheek) {
    if (!e?.vorm || e.dossier === d.dossier || !isDag(e.dag) || e.dag === d.dag.start) continue;
    if (Math.abs(dagenTussen(e.dag, d.dag.start)) > 4 * 366 || dagenVanJaarTussen(e.dag, d.dag.start) > DREMPELS.patroonDagen) continue;
    // Een soort die botst (een wielerwedstrijd op de route van de marathon): ander evenement.
    if (eigen && !soortPast(eigen, eersteSoort([e.soort, e.naam]))) continue;
    if (!e._vorm) e._vorm = vormUitPatroon(e.vorm);
    if (!e._vorm.bbox || !d.vorm.bbox || !boxenRaken(e._vorm.bbox, d.vorm.bbox)) continue;
    const r = zelfdeRoute(d.vorm, e._vorm);
    if (r.ok && (!best || r.overlap > best.r.overlap)) best = { e, r };
  }
  if (!best) return null;
  const { e, r } = best;
  const jaar = e.dag.slice(0, 4);
  const wanneer = `${dagTekst(e.dag)} ${jaar}`;
  const echteOverlap = r.overlap >= DREMPELS.routeOverlap;
  const bewijs = echteOverlap ? `${Math.round(r.overlap * 100)} % van de route valt samen` : "begin, einde en lengte vallen samen";
  // De naam van de vorige keer alleen bij een ander jaar (zelfde jaar: een ander evenement op dezelfde
  // route) en een route die echt samenvalt (niet alleen begin, einde en lengte). Anders alleen de soort,
  // in gewone woorden: de beschrijving van dat ene evenement past niet zomaar bij een ander.
  const metNaam = e.zekerheid === "zeker" && Boolean(clean(e.naam)) && jaar !== d.dag.start.slice(0, 4) && echteOverlap;
  const soort = metNaam ? metLidwoord(e.soort) : SOORT[eersteSoort([e.soort, e.naam])]?.met || "";
  if (!soort && !metNaam) return null;
  return {
    methode: "patroon", zekerheid: "waarschijnlijk",
    naam: metNaam ? clean(e.naam, 120) : "",
    soort, organisator: metNaam ? clean(e.organisator, 200) : "",
    reden: `Dezelfde route als ${metNaam ? `${e.naam} op ${wanneer}` : `een evenement op ${wanneer}`} (dossier ${e.dossier}): ${bewijs}. ${onbekendZin("naam-dossier-route")}`,
    grond: "dezelfde route als een vorige keer",
    link: metNaam ? publiekeLink(e.link) : "", linkLabel: metNaam && publiekeLink(e.link) ? "Info over de vorige keer" : "",
    bron: metNaam ? [publiekeLink(e.link)].filter(Boolean) : [],
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

// ---------- stap b2: de foorlijst ----------

// Een kermis staat weken: de gewone koppeling (hoogstens drie dagen) ziet ze niet. Een foor uit de
// foorlijst van de stad hoort bij een dossier als de periode samenvalt (begin en einde van de fase
// Evenement hoogstens één dag ernaast) en het plein van de foor een straat van het dossier is. Eén foor,
// anders niets. Een dossier dat zelf een andere soort noemt, krijgt de naam niet.
export function stapFoor(d, foren = []) {
  if (!d?.dag?.start || !foren.length) return null;
  const eigen = eigenSoortVan(d);
  if (eigen && eigen !== "kermis") return null;
  const straten = new Set([...(d.kernStraten || []), ...(d.plekken?.straten || []), ...(d.straten || [])].map(plat).filter((x) => x.length >= 5));
  const hits = foren.filter((f) => Math.abs(dagenTussen(f.dag, d.dag.start)) <= 1 && Math.abs(dagenTussen(f.eind, d.dag.eind || d.dag.start)) <= 1 && straten.has(plat(f.plein)));
  if (hits.length !== 1) return null;
  const f = hits[0];
  // De foorlijst (A-Sign laag 0) is een eigen lijst van de stad, los van de evenementendossiers (laag 22):
  // die telt als eigen bron die dag en plek noemt (methode "foorlijst").
  return {
    methode: "foorlijst", zekerheid: "zeker", naam: clean(f.titel, 120), soort: "kermis", soortZeker: true,
    grond: "de foorlijst van de stad (zelfde periode en plein)", bron: [f.link].filter(Boolean),
    signalen: [`foorlijst van de stad: '${clean(f.titel, 80)}' van ${datumTekst(f.dag)} tot ${datumTekst(f.eind)}; zelfde plein en periode`],
  };
}

// ---------- stap b3: de marktlijst ----------

// De openbare markten van de stad (A-Sign laag 1): plek (een vlak), marktdag(en) en uren. Een
// evenementendossier van weken of een jaar dat op het vlak van een markt ligt (hoogstens MARKT_METER
// ernaast), is die markt: dan zegt de kaart "elke vrijdag" en de uren, niet "loopt van april tot april".
const WEEKDAG_NR = { zondag: 0, maandag: 1, dinsdag: 2, woensdag: 3, donderdag: 4, vrijdag: 5, zaterdag: 6 };
const KLEIN_WOORD = new Set(["van", "de", "der", "den", "het", "ten", "ter", "op", "en"]);
const naamHoofdletters = (t) => clean(t, 80).toLowerCase().split(" ").map((w, i) => (i && KLEIN_WOORD.has(w) ? w : w.replace(/(^|[-'])(\p{L})/gu, (_, a, b) => a + b.toUpperCase()))).join(" ");
const uurTekst = (u) => clean(u, 10).replace(/[.:]00$/, "").replace(":", ".");
export const MARKT_METER = 25;
const aaneen = (dagen) => { const ds = [...new Set(dagen)].sort(); return dagenTussen(ds[0], ds.at(-1)) + 1 === ds.length; };
export function marktenUitAsign(features = []) {
  const uit = [];
  for (const f of features) {
    const a = f?.attributes || f?.properties || {};
    const rings = (f?.geometry?.rings || (f?.geometry?.type === "Polygon" ? f.geometry.coordinates : [])).filter((r) => Array.isArray(r) && r.length >= 4 && r.every(geldig));
    const dagen = [a.marktdag1, a.marktdag2].map((x) => WEEKDAG_NR[clean(x, 20).toLowerCase()]).filter((x) => x !== undefined);
    const plek = naamHoofdletters(a.locatie);
    if (!rings.length || !dagen.length || !plek) continue;
    const van = uurTekst(a.van), tot = uurTekst(a.tot);
    uit.push({
      id: clean(a.id, 20), naam: clean(`${clean(a.soort, 60) || "Markt"} ${plek}`, 120), plek, weekdagen: [...new Set(dagen)].sort(),
      uren: van && tot ? `${van} tot ${tot} uur` : "", vorm: { vlakken: [rings], lijnen: [], andereVlakken: [], andereLijnen: [], index: maakIndex({ vlakken: [rings] }) },
    });
  }
  return uit;
}
// De marktdagen uit site/sources/stad-markten.json (GIPOD): een eigen publieke bron die de marktdag en de
// straat noemt. [{ titel, dag, plek, link }].
export function marktDagenUitBron(doc = {}) {
  return (Array.isArray(doc?.items) ? doc.items : []).map((it) => ({
    titel: clean(it?.title, 160), dag: dagVan(it?.date), plek: clean(String(it?.location ?? "").split(",")[0], 80), link: publiekeLink(clean(it?.sourceUrl, 300)),
  })).filter((m) => m.titel && isDag(m.dag) && m.plek);
}
export function stapMarkt(d, markten = [], marktDagen = []) {
  if (!d?.dag?.start || !markten.length || duurDagen(d.dag.start, d.dag.eind) < LANG_DAGEN || d.vorm?.lijnen?.length) return null;
  // Het dossier noemt zelf een markt ("verplaatsbare markt"), loopt aan één stuk (geen losse dagen) en raakt
  // het vlak van precies één markt. Een dossier van een jaar met kleine plekken over de hele stad, of losse
  // dagen met een parkeerverbod naast een marktplein, is geen markt (nagekeken op 11 oktober 2026). Een
  // verplaatste markt ligt maar voor een deel op haar gewone vlak: raken is genoeg.
  if (eigenSoortVan(d) !== "markt" || (Array.isArray(d.dagen) && d.dagen.length > 1 && !aaneen(d.dagen))) return null;
  const hits = markten.filter((m) => raakt(d.vorm, m.vorm, MARKT_METER));
  if (hits.length !== 1) return null;
  const m = hits[0];
  const dagen = uniek(m.weekdagen.flatMap((wd) => weekdagenTussen(d.dag.start, d.dag.eind || d.dag.start, wd))).sort();
  if (!dagen.length) return null;
  // Dezelfde markt in de marktdagen van GIPOD (zelfde straat, een marktdag in de periode): dan zeker.
  const gipod = marktDagen.find((x) => plat(x.plek) === plat(m.plek) && dagen.includes(x.dag) && x.link);
  const wd = m.weekdagen.map((x) => WEEKDAGEN[x]);
  return {
    methode: "markt", soortKey: "markt", zekerheid: gipod ? "zeker" : "waarschijnlijk", naam: clean(gipod?.titel || m.naam, 120), soort: gipod ? "openbare markt van de stad" : "een openbare markt van de stad", soortZeker: true,
    uren: m.uren, dagenMarkt: dagen, grond: "de marktlijst van de stad (zelfde plek en marktdag)", bron: [gipod?.link].filter(Boolean),
    reden: gipod ? "" : `Het dossier ligt op de plek van de openbare markt ${m.plek}, op ${joinNl(wd)}.`,
    signalen: [`marktlijst van de stad: ${clean(m.naam, 80)} op ${joinNl(wd)}${m.uren ? `, ${m.uren}` : ""}; het dossier ligt op het vlak van die markt`],
  };
}

// ---------- stap d: regels ----------

// Oudere ETL-dossiers op dezelfde plek (zelfde periode van het jaar, ruw: [{ dossier, dag, eind,
// beschrijvingen, vorm, innames }]) samengevat tot wat de regels nodig hebben: per dossier het jaar, de
// trefwoorden uit SOORTEN en de overlap. Zo kan de verversing dit bewaren zonder vrije tekst.
// buurtacties: lib/buurtacties.json. Een klein dossier in een vorige editie van een buurtactie dat deze
// plek raakt (hoogstens 5 m), krijgt het trefwoord "buurtactie", ook zonder overlap: een straat die
// vorig jaar al Herfstklaar deed, met een iets ander stukje stoep.
export function vatHistoriekSamen(d, ruw = [], { buurtacties = [] } = {}) {
  const uit = [];
  for (const h of ruw) {
    if (!h?.vorm || h.dossier === d.dossier || !isDag(h.dag) || h.dag >= d.dag.start) continue;
    // In beide richtingen genoeg overlap: een kleine inname binnen een zone van kilometers (of
    // omgekeerd) is niet "dezelfde plek".
    const heen = dekking(d.vorm, h.vorm), terug = dekking(h.vorm, d.vorm), ov = Math.max(heen, terug);
    const buurt = Boolean(buurtacties.length && editieVan(h.dag, buurtacties) && buurtProfiel(h) && raakt(d.vorm, h.vorm, BUURT_RAAKT_METER));
    if (!buurt && (ov < DREMPELS.historiekOverlap || Math.min(heen, terug) < DREMPELS.historiekMin)) continue;
    const soorten = soortenIn(h.beschrijvingen || []);
    if (buurt) soorten.push("buurtactie");
    // De dag zelf ook (een publieke datum van een oud dossier): "drie jaar op rij in dezelfde week" (stapRegels).
    uit.push({ dossier: h.dossier, jaar: h.dag.slice(0, 4), dag: h.dag, soorten: uniek(soorten), overlap: Math.round(ov * 100) / 100 });
  }
  return uit.sort((a, b) => a.dossier.localeCompare(b.dossier));
}

// ---------- buurtacties (Herfstklaar, Lenteklaar) ----------

// Het profiel van een dossier van een buurtactie (identificatie van 10-10-2026, 21 dossiers): alleen
// innames of een verkeersvrije zone, hoogstens drie plekken, samen hoogstens 8.000 m², hoogstens drie
// dagen, geen parcours, en een omschrijving die leeg is, alleen een straat noemt of een straatfeest.
// Een podium, een promotruck of een markt valt erbuiten.
export const BUURT = Object.freeze({ plekken: 3, m2: 8000, dagen: 3 });
const BUURT_RAAKT_METER = 5;
const BUURT_TYPE = /^(?:inname|verkeersvrije zone)$/i;
const BUURT_WOORD = /straatfeest|herfstklaar|lenteklaar|autoluw|verkeersvrij|buurtactie/i;
// alleenStraat: site/evenement-wat.js (ook voor dingKeuze).
export function buurtProfiel(h = {}) {
  const innames = Array.isArray(h.innames) ? h.innames : [];
  if (!innames.length || !innames.every((i) => BUURT_TYPE.test(clean(i?.type, 60)))) return false;
  const pf = plekFeiten(innames);
  if (!pf.aantal || pf.aantal > BUURT.plekken || pf.m2 > BUURT.m2) return false;
  const start = isDag(h.dag) ? h.dag : h.dag?.start, eind = isDag(h.eind) ? h.eind : h.dag?.eind || start;
  if (!isDag(start) || dagenTussen(start, eind || start) >= BUURT.dagen) return false;
  return (h.beschrijvingen || []).every((b) => !clean(b) || BUURT_WOORD.test(b) || alleenStraat(b));
}
// In welke vorige editie valt een dag? (lib/buurtacties.json)
export function editieVan(dag, buurtacties = []) {
  for (const a of buurtacties) for (const e of a?.edities || []) if (isDag(dag) && dag >= e.van && dag <= e.tot) return { naam: clean(a.naam, 40), jaar: dag.slice(0, 4) };
  return null;
}
// Raakt vorm b vorm a (hoogstens `m` meter ertussen)? Op de randen van de vlakken en de lijnen.
function raakt(a, b, m) {
  const punten = (v) => bemonster([...(v.andereVlakken || []).flat(), ...(v.vlakken || []).flat(), ...(v.andereLijnen || []), ...(v.lijnen || [])], 3);
  return punten(b).some((p) => afstandTot(a.index, p, m) <= m) || punten(a).some((p) => afstandTot(b.index, p, m) <= m);
}
// Het weekend van een buurtactie dit jaar, uit de agendabronnen (het districtsnieuws: "Maak je straat
// Herfstklaar op 23, 24 of 25 oktober"). kandidaten: zie kandidaatUitAgenda.
// Een dossier van dit jaar in het weekend van een buurtactie, met het profiel en een vorige editie op
// dezelfde plek (historiek met het trefwoord "buurtactie"). Niet voor een dossier in een reeks op hetzelfde
// vlak (d.inReeks, zie bouwHerkenning): een inname elke zondag is geen buurtactie.
// Kan dit dossier een buurtactie zijn (weekend en profiel, zonder de historiek)? Dan het venster, anders
// null. Ook voor de verversing: alleen zulke dossiers vragen hun historiek opnieuw (de sleutel "b2|").
export function buurtVenster(d, vensters = []) {
  if (!vensters.length || d?.inReeks || d?.vorm?.heeftParcours || !d?.dag?.start) return null;
  const dagen = Array.isArray(d.dagen) && d.dagen.length ? d.dagen : [d.dag.start];
  const venster = vensters.find((v) => dagen.every((x) => x >= v.van && x <= v.tot));
  if (!venster || !buurtProfiel({ innames: d.innames, dag: d.dag.start, eind: d.dag.eind, beschrijvingen: d.beschrijvingen })) return null;
  return venster;
}
export function buurtSignaal(d, historiek = [], vensters = []) {
  const venster = buurtVenster(d, vensters);
  if (!venster) return null;
  const vroeger = historiek.filter((h) => (h?.soorten || []).includes("buurtactie"));
  if (!vroeger.length) return null;
  return { venster, jaren: uniek(vroeger.map((h) => String(h.jaar))).sort(), namen: [venster.naam] };
}
export function buurtVensters(kandidaten = [], buurtacties = []) {
  const uit = [];
  for (const a of buurtacties) {
    // Het woord als gewoon woord vergeleken, niet als regex: één fout teken in lib/buurtacties.json
    // ("lente(") mag de hele herkenning niet laten struikelen.
    const woord = plat(a.woord).slice(0, 30);
    if (!woord) continue;
    for (const k of kandidaten) if (` ${plat(k?.titel)} `.includes(` ${woord} `) && isDag(k.dag)) uit.push({ naam: clean(a.naam, 40), wat: clean(a.wat, 160), van: k.dag, tot: k.eind || k.dag, link: publiekeLink(k.link) || publiekeLink(a.bron) });
  }
  return uit;
}

// Ligt een dossier in een reeks: twee of meer andere dossiers met (bijna) hetzelfde vlak op een andere
// dag binnen 60 dagen? (Een inname elke zondag op hetzelfde plein, identificatie van 10-10-2026.)
function inReeks(d, dossiers = []) {
  if (!d?.vorm?.vlakken?.length || d.vorm.heeftParcours) return false;
  let n = 0;
  for (const e of dossiers) {
    if (e === d || e.dossier === d.dossier || !e?.vorm?.vlakken?.length || e.vorm.heeftParcours || e.dag.start === d.dag.start) continue;
    if (Math.abs(dagenTussen(e.dag.start, d.dag.start)) > 60 || !d.vorm.bbox || !e.vorm.bbox || !boxenRaken(d.vorm.bbox, e.vorm.bbox)) continue;
    if (Math.min(dekking(d.vorm, e.vorm), dekking(e.vorm, d.vorm)) >= 0.8) n += 1;
    if (n >= 2) return true;
  }
  return false;
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
  // Een zone van kilometers (een verkeersvrije zone) raakt vanzelf elke plek uit het charter, en een
  // terrein van hectaren (een hele parking, zoals Parking Spoor Oost op showdagen) ook: geen drilplaats.
  const andere = (v.andereVlakken || []).filter((rings) => !grootVlak(rings) && Math.abs(oppervlakte(rings)) <= GROOT_TERREIN_M2);
  const idx = innames ? maakIndex({ lijnen: v.andereLijnen, vlakken: [...andere, ...zones] }) : v.index;
  const punten = innames ? [...andere, ...zones].flatMap((rings) => bemonster(rings)).concat(v.andereLijnen.flat()) : routePunten(v).concat(v.kern);
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
const diagonaal = (b) => (b ? meterTussen([b[0], b[1]], [b[2], b[3]]) : 0);
export const grootVlak = (rings = []) => diagonaal(boxVan(rings.flat())) > DREMPELS.grootVlakMeter;
// Een vlak waarvan het middelpunt geen plek is: groter dan DREMPELS.middelpuntVlakM2 (de oppervlakte van A-Sign
// zelf, Shape_Area, anders uit de vorm), of met een diagonaal boven DREMPELS.grootVlakMeter.
export function reuzenVlak(rings = [], m2 = null) {
  const opp = Number.isFinite(Number(m2)) && Number(m2) > 0 ? Number(m2) : Math.abs(oppervlakte(rings));
  return opp > DREMPELS.middelpuntVlakM2 || grootVlak(rings);
}
// Een doop die geen studentendoop is: van een kind, een reus, een klok, een tunnelboormachine, een tram.
// Alleen zonder studentenwoord (een "schachtendoop" met een tram erbij blijft een studentendoop).
const DOOP_ANDERS = /\b(?:\w*kind\w*|baby\w*|doopsel\w*|\w*dochter\w*|\w*zoon\w*|tunnelboor\w*|boormachine\w*|tbm|\w*klok\w*|reuze?n?\w*|\w*tram\w*|\w*trein\w*|kerk\w*|parochie\w*)\b/;
// Een woord dat een schip noemt; een boot alleen buiten de doopperiode ("met de boot naar de overkant" na
// een studentendoop is geen scheepsdoop).
const SCHIP_WOORD = /\b(?:m ?t ?s|\w*schip|schepen|vaartuig\w*|tanker\w*)\b/;
const BOOT_DOOP = /\bdoop\w*\b[^|]*\b\w*boot\b|\b\w*boot\b[^|]*\bdoop/;
const BOOT = /\b\w*boot\b/;
// Woorden die alleen studenten gebruiken (zonder dril: een dril vraagt een plek uit het charter).
const STUDENT_WOORD = /\b(?:schacht\w*|ontgroen\w*|student\w*|cantus|kroegentocht|welkomstritueel)\b/;
// Een uiteinde van een parcourslijn aan een doopplaats uit het charter (binnen haar straal): de naam.
function doopplaatsAanEinde(d, charter) {
  const einden = (d.vorm?.lijnen || []).flatMap((l) => [l[0], l.at(-1)]).filter(geldig);
  for (const plek of charter?.plekken || []) {
    if (plek.soort !== "doopplaats") continue;
    const r = plek.straal || 60;
    const raak = plek.vlak
      ? (() => { const pv = plek._idx || (plek._idx = maakIndex({ vlakken: [plek.vlak] })); return einden.some((p) => afstandTot(pv, p, r) <= r); })()
      : geldig(plek.punt) && einden.some((p) => meterTussen(p, plek.punt) <= r);
    if (raak) return clean(plek.naam, 80);
  }
  return "";
}
// Wat vroeger op dezelfde plek gebeurde, telt ook voor een kleine plek zonder route, maar alleen als daar
// drie jaar op rij in dezelfde week hetzelfde lag en nooit iets anders (een buurtfeest, een markt op 11
// november), met een plek die bijna samenvalt. Op de Meir of de Groenplaats lag van alles: daar telt het
// niet. Alleen oude dossiers met hun dag in de cache (sinds 11 oktober 2026; oudere samenvattingen kennen
// alleen het jaar en tellen hier niet).
const HISTORIEK_KLEIN = Object.freeze({ jaren: 3, overlap: 0.8, m2: 5000, dagen: 7 });
// De jaren waarin op (bijna) dezelfde plek in dezelfde week (hoogstens HISTORIEK_KLEIN.dagen ernaast) een
// dossier met soort k lag; alleen samenvattingen met de dag erbij.
function zelfdeWeekJaren(historiek, k, dag) {
  return uniek(historiek.filter((h) => isDag(h?.dag) && h.overlap >= HISTORIEK_KLEIN.overlap && (h.soorten || []).includes(k) && dagenVanJaarTussen(h.dag, dag) <= HISTORIEK_KLEIN.dagen).map((h) => String(h.jaar))).sort();
}
export function stapRegels(d, { historiek = [], charter = null, vensters = [], zuster = null } = {}) {
  const tekst = woordTekst(d.beschrijvingen || []);
  const doop = binnenDoopperiode(d.dag.start, charter);
  // Een zwak woord ("lopen", "Grote Prijs", "11 november") telt alleen bij een dossier met een parcours.
  const met = soortenMet(d.beschrijvingen || []);
  const zwak = new Set(met.filter((x) => !x.sterk).map((x) => x.key));
  // Het tweede signaal: een parcours in het dossier (een inname van die soort, of het woord) of een afstand.
  const tweede = d.vorm.heeftParcours || /\bparcours\b|\b\d+ ?(?:k|km)\b/.test(tekst);
  const eigen = met.filter((x) => x.sterk || tweede).map((x) => x.key);
  // Een doop met een boot, buiten de doopperiode: de doop van een schip.
  const bootSchip = !doop && BOOT_DOOP.test(tekst) && !SCHIP_WOORD.test(tekst);
  if (bootSchip && !eigen.includes("schip")) eigen.unshift("schip");
  // Een film- of foto-opname: de fase heet "Opname" (A-Sign), wat de omschrijving ook zegt.
  const opname = (d.fasen || []).some((f) => isOpnameFase(f?.naam));
  const signalen = [];
  if (opname) signalen.push("fase 'Opname' in het dossier");
  if (eigen.length) signalen.push(`trefwoord in het dossier: ${eigen.map((k) => SOORT[k].zonder).join(", ")}`);
  // Zonder parcourslijn en met een zone van kilometers: wat vroeger "op dezelfde plek" gebeurde of een
  // plek uit het charter zegt dan niets (de verkeersvrije zone van marathonzondag is geen doop).
  const zoneZonderRoute = !d.vorm.lijnen.length && d.vorm.vlakken.some(grootVlak);
  // Oudere dossiers op dezelfde plek: per soort de jaren met een trefwoord.
  const perSoort = new Map();
  for (const h of zoneZonderRoute ? [] : historiek) {
    if (!h?.dossier || h.dossier === d.dossier || !(h.overlap >= DREMPELS.historiekOverlap)) continue;
    for (const k of (h.soorten || []).filter((x) => SOORT[x])) {
      const x = perSoort.get(k) || { jaren: new Set(), dossiers: [], overlap: 0 };
      x.jaren.add(String(h.jaar));
      x.dossiers.push(h.dossier);
      x.overlap = Math.max(x.overlap, h.overlap);
      perSoort.set(k, x);
    }
  }
  const vroeger = [...perSoort].sort((a, b) => b[1].jaren.size - a[1].jaren.size || SOORTEN.findIndex((x) => x.key === a[0]) - SOORTEN.findIndex((x) => x.key === b[0]));
  if (vroeger.length) signalen.push(`vroeger op dezelfde plek: ${vroeger.slice(0, 3).map(([k, x]) => `${SOORT[k].zonder} (${[...x.jaren].sort().join(", ")})`).join("; ")}`);
  // Wat vroeger op dezelfde plek gebeurde, zegt alleen iets over een evenement van een paar dagen.
  const kort = kortEvenement(d);
  // Een vaste plek met een eigen functie (Parking Spoor Oost, lib/vaste-plekken.json): het charter zegt daar niets.
  const geenCharter = Boolean(d.plekken?.geenCharter);
  const plekken = doop && !zoneZonderRoute ? charterPlekken(d, charter) : [];
  // Een vaste plek die zelf een plek uit het charter is (park Konijnenwei: de doopplaats ligt in het park,
  // de straal van het charter dekt het hele park niet).
  const vastCharter = doop && d.plekken?.vast?.charter && (charter?.plekken || []).some((x) => x.naam === d.plekken.vast.charter) ? [d.plekken.vast.charter] : [];
  const plekkenInname = doop && !zoneZonderRoute ? uniek([...charterPlekken(d, charter, { innames: true }), ...vastCharter]) : [];
  if (doop && plekken.length) signalen.push(`doopperiode en een plek uit het studentencharter: ${plekken.slice(0, 3).join(", ")}`);
  // Studentenactiviteiten vallen meestal op een weekdag (maandag tot donderdag).
  const wd = new Date(`${d.dag.start}T12:00:00Z`).getUTCDay();
  const weekdag = wd >= 1 && wd <= 4;
  const buurt = buurtSignaal(d, historiek, vensters);
  if (buurt) signalen.push(`${buurt.venster.naam}-weekend en een vorige editie op dezelfde plek (${buurt.jaren.join(", ")})`);

  // Kies de soort: eerst de fase (een opname), dan wat het dossier zelf zegt, dan een plek uit het
  // studentencharter in de doopperiode, dan wat vroeger op dezelfde route gebeurde. Wat vroeger op dezelfde
  // plek gebeurde, telt alleen voor een dossier met een eigen route (of drie jaar op rij op een kleine plek):
  // op de Meir, de Groenplaats of het Operaplein passeerde vroeger van alles (een stoet, een loop), en dat
  // gaf vier foute labels op een losse inname (nagekeken op 10 oktober 2026).
  const eigenRoute = d.vorm.lijnen.length > 0;
  let soort = "", reden = "", basis = "", soortKey = "", soortZeker = false, geenEvenement = false;
  const studentVroeger = perSoort.get("student");
  const studentWoord = STUDENT_WOORD.test(tekst);
  const doopWoord = /\bdoop|studentendoop|schachtendoop/.test(tekst), drilWoord = /\bdrill?\w*/.test(tekst);
  // "Doop" alleen (zonder studentenwoord of dril) is geen andere soort naast een ding: dat zegt de doop van een schip zelf.
  const soorten = eigen.filter((k) => !SOORT[k]?.ding);
  const andereSoort = soorten.some((k) => k !== "student" || studentWoord || drilWoord);
  // Een ding (stickers, een reuzenrad, een bord ...): alleen als het dossier erover gaat (site/evenement-wat.js).
  let ding = opname ? null : dingKeuze(d.beschrijvingen || [], { andereSoort });
  if (ding?.key === "schip" && doop && !SCHIP_WOORD.test(tekst)) ding = null;
  if (!ding && !opname && bootSchip) ding = { key: "schip", over: false, zeker: false };
  // Een studentendoop vraagt meer dan het woord "doop": de doopperiode, een plek uit het charter of een
  // woord dat alleen studenten gebruiken, en geen doop van iets anders (een kind, een reus, een
  // tunnelboormachine, of een boot zonder plek uit het charter).
  const doopAnders = !studentWoord && !drilWoord && (DOOP_ANDERS.test(tekst) || (BOOT.test(tekst) && !plekken.length));
  const echtStudent = soorten.includes("student") && !doopAnders && (doop || plekken.length > 0 || studentWoord || drilWoord);
  if (opname) {
    soort = OPNAME.met;
    reden = "In het dossier heet de periode 'Opname': opnames voor een film, een serie of foto's.";
    basis = "fase"; soortKey = OPNAME.key; soortZeker = true; geenEvenement = true;
  } else if (ding) {
    const dg = dingVan(ding.key);
    soort = ding.key === "versiering" ? versieringTekst(d.beschrijvingen) : dg.met;
    // Op hoeveel plekken het dossier het ding noemt, als dat niet overal is (stickers op 6 van de 9 plekken).
    const dp = d.dingPlekken?.[ding.key], alle = d.plekken?.aantal || 0;
    const deel = dp?.aantal && alle > dp.aantal ? `, op ${dp.aantal} van de ${alle} plekken` : "";
    reden = ding.key === "schip"
      ? `Het dossier spreekt van de doop van ${SCHIP_WOORD.test(tekst) ? "een schip" : "een boot"}${doop ? "" : ", buiten de doopperiode van de studenten"}.`
      : `Het dossier zelf noemt ${ding.key === "versiering" ? soort.replace(/^straatversiering: /, "") : dg.met}${deel}.`;
    basis = "eigen"; soortKey = ding.key; soortZeker = Boolean(ding.zeker); geenEvenement = !dg.evenement;
  } else if (echtStudent) {
    soort = doopWoord ? "een studentendoop" : drilWoord ? "een studentenactiviteit met een dril" : "een studentenactiviteit";
    reden = doopWoord || drilWoord
      ? `Het dossier zelf spreekt van een ${doopWoord ? "doop" : "dril"}${doop ? ", in de doopperiode van de studenten" : ""}${plekken.length ? `, op ${joinNl(plekken.slice(0, 2))} uit het studentencharter` : ""}.`
      : "Het dossier zelf noemt studenten.";
    basis = "eigen"; soortKey = "student";
    // Zonder "vermoedelijk": het woord, de doopperiode én een plek uit het charter of een studentenwoord.
    soortZeker = (doopWoord || drilWoord) && doop && (plekken.length > 0 || studentWoord);
  } else if (soorten.includes("haltes") && doop && (plekken.length || studentVroeger)) {
    // Een tocht met haltes die aan een doopplaats uit het charter eindigt: vermoedelijk een studentendoop.
    const doopplaats = doopplaatsAanEinde(d, charter);
    soort = doopplaats ? "een studentendoop: een tocht te voet langs haltes naar de doopplaats" : "een studentenactiviteit: een tocht te voet langs haltes";
    reden = `Een tocht met haltes in de doopperiode${doopplaats ? `, met een uiteinde aan ${doopplaats} (een doopplaats uit het studentencharter)` : ""}${plekken.length ? `, langs ${joinNl(plekken.slice(0, 3))} (plekken uit het studentencharter)` : ""}${studentVroeger ? `; op dezelfde route lag in ${joinNl([...studentVroeger.jaren].sort())} ook een studentenactiviteit` : ""}.`;
    basis = "eigen+charter"; soortKey = doopplaats ? "student" : "haltes";
  } else if (soorten.filter((k) => k !== "student").length) {
    const k = soorten.find((x) => x !== "student");
    soort = SOORT[k].met;
    reden = `De omschrijving in het dossier wijst op ${k === "haltes" ? "een tocht met haltes" : SOORT[k].met}.`;
    basis = "eigen"; soortKey = k;
    // Een woord dat het evenement zelf noemt (een criterium, een braderie, een wandeling): zonder
    // "vermoedelijk", maar alleen met een sterk woord en zonder een andere soort die er niet bij past.
    // Een losse "tocht" of "stop" zegt te weinig.
    const tegen = soorten.filter((x) => x !== k && !soortPast(k, x));
    soortZeker = EIGEN_ZEKER.has(k) && !zwak.has(k) && !tegen.length;
  } else if (buurt) {
    // Een buurtactie (Herfstklaar): het weekend van de actie, het profiel van zo'n dossier, en op dezelfde
    // plek lag in een vorige editie ook zo'n dossier. Een reeks op hetzelfde vlak (elke zondag) telt niet.
    soort = `${buurt.venster.naam} (buurtactie van het district)`;
    const v = buurt.venster, zelfdeMaand = v.van.slice(0, 7) === v.tot.slice(0, 7);
    reden = `Valt in het ${v.naam}-weekend van het district (${zelfdeMaand ? `${Number(v.van.slice(8, 10))}` : datumTekst(v.van)} tot ${datumTekst(v.tot)}): ${v.wat}. Op dezelfde plek lag in ${joinNl(buurt.jaren)} ook een kleine inname tijdens ${joinNl(buurt.namen)}.`;
    // Een actie van de bewoners van die straat, geen evenement voor het grote publiek.
    basis = "buurtactie"; soortKey = ""; geenEvenement = true;
  } else if (kort && doop && plekkenInname.length && !geenCharter && !doopAnders && (weekdag || studentVroeger?.jaren.size >= 2)) {
    // Een weekend telt alleen als er al in minstens twee jaren een studentenactiviteit lag. Op een
    // doopplaats (Konijnenwei, de Belvédère, de Sint-Michielskaai ...) is het vermoedelijk een doop; op een
    // drilplaats zeggen we niet welke activiteit.
    const doopplaats = (charter?.plekken || []).some((x) => x.soort === "doopplaats" && plekkenInname.includes(x.naam));
    soort = doopplaats ? "een studentendoop" : "een studentenactiviteit in de doopperiode";
    reden = `In de doopperiode, met een inname op ${joinNl(plekkenInname.slice(0, 3))}: ${plekkenInname.length > 1 ? "plekken" : "een plek"} die het studentencharter aanwijst voor ${doopplaats ? "dopen" : "drils of dopen"}${studentVroeger ? `; daar lag in ${joinNl([...studentVroeger.jaren].sort())} ook een studentenactiviteit` : ""}.`;
    basis = "charter"; soortKey = "student";
  } else if (kort && eigenRoute && studentVroeger && doop && !doopAnders && (studentVroeger.jaren.size >= 2 || plekken.length)) {
    soort = "een studentenactiviteit in de doopperiode";
    reden = `In de doopperiode, op een route waar in ${joinNl([...studentVroeger.jaren].sort())} ook een studentenactiviteit (doop of dril) een toelating kreeg${plekken.length ? `, langs ${joinNl(plekken.slice(0, 2))} uit het studentencharter` : ""}.`;
    basis = "historiek"; soortKey = "student";
  } else if (kort && eigenRoute && vroeger.length && vroeger[0][0] !== "student" && (vroeger.length === 1 || vroeger[0][1].jaren.size > vroeger[1][1].jaren.size)) {
    // Alleen wat vroeger gebeurde: twee jaren met hetzelfde trefwoord, of één jaar op dezelfde route
    // (een parcourslijn die voor 80 % samenvalt).
    const [k, x] = vroeger[0];
    if (x.jaren.size >= 2 || x.overlap >= 0.8) {
      soort = SOORT[k].met;
      reden = `Op dezelfde route lag in ${joinNl([...x.jaren].sort())} een dossier over ${SOORT[k].met}.`;
      basis = "historiek"; soortKey = k;
    }
  } else if (kort && !eigenRoute && !d.vorm.heeftParcours && vroeger.length === 1 && vroeger[0][0] !== "student" && !SOORT[vroeger[0][0]]?.ding
    && (d.plekken?.m2 || 0) <= HISTORIEK_KLEIN.m2 && zelfdeWeekJaren(historiek, vroeger[0][0], d.dag.start).length >= HISTORIEK_KLEIN.jaren) {
    const k = vroeger[0][0], jaren = zelfdeWeekJaren(historiek, k, d.dag.start);
    soort = SOORT[k].met;
    reden = `Op dezelfde plek lag in ${joinNl(jaren)} telkens in dezelfde week een dossier over ${SOORT[k].met}, en nooit iets anders.`;
    basis = "historiek-plek"; soortKey = k;
  } else if (zuster && !soorten.length && !ding) {
    // Een ander dossier op dezelfde dag en plek (hoogstens ZUSTER_METER ernaast) noemt een winkelevenement,
    // een markt of een buurtfeest: deze inname hoort er vermoedelijk bij (een opstelling tijdens een shopevent).
    soort = SOORT[zuster.soort].met;
    reden = `Op dezelfde dag ligt op hoogstens ${ZUSTER_METER} m een ander dossier dat ${SOORT[zuster.soort].met} noemt.`;
    basis = "zuster"; soortKey = zuster.soort;
  }
  if (!soort) return { methode: "regels", zekerheid: "onbekend", soortKey: "", signalen };
  const grond = basis === "charter" ? "de plek en de doopperiode uit het studentencharter" : basis === "eigen+charter" ? "de omschrijving in het dossier, de plek en de doopperiode"
    : basis === "historiek" ? "dezelfde route in vorige jaren"
      : basis === "historiek-plek" ? "dezelfde plek in de drie vorige jaren"
        : basis === "fase" ? "de fasen van het dossier"
          : basis === "zuster" ? "een ander dossier op dezelfde dag en plek"
          : basis === "buurtactie" ? `het ${buurt.venster.naam}-weekend van het district en een vorige editie op dezelfde plek` : "de omschrijving in het dossier";
  const link = basis === "buurtactie" ? buurt.venster.link : "";
  return { methode: "regels", zekerheid: "waarschijnlijk", soort, soortKey, reden, basis, grond, soortZeker, geenEvenement, signalen, link, linkLabel: link ? `${buurt.venster.naam} bij het district` : "", bron: link ? [link] : [] };
}
// Een zusterdossier: een ander dossier met een soort die een plek inneemt (geen route), op dezelfde dag(en)
// en hoogstens zoveel meter ernaast. Een loop of een koers niet: die passeert vanzelf naast van alles (het
// buurtfeest naast het Linkeroever Criterium is geen wielerwedstrijd).
export const ZUSTER_METER = 25;
const ZUSTER_SOORTEN = new Set(["winkel", "markt", "buurtfeest"]);
export function zusterVan(d, dossiers = []) {
  if (!d?.vorm?.bbox || d.vorm.heeftParcours) return null;
  const dagen = Array.isArray(d.dagen) && d.dagen.length ? d.dagen : [d.dag.start];
  for (const e of dossiers) {
    if (e === d || e.dossier === d.dossier || !e?.vorm?.bbox || !boxenRaken(d.vorm.bbox, e.vorm.bbox)) continue;
    const k = soortenMet(e.beschrijvingen || []).filter((x) => x.sterk).map((x) => x.key).find((x) => !SOORT[x]?.ding);
    if (!ZUSTER_SOORTEN.has(k)) continue;
    const andere = new Set(Array.isArray(e.dagen) && e.dagen.length ? e.dagen : [e.dag.start]);
    if (!dagen.every((x) => andere.has(x)) || !raakt(d.vorm, e.vorm, ZUSTER_METER)) continue;
    return { soort: k, dossier: e.dossier };
  }
  return null;
}
// Woorden die het evenement zelf noemen: die zegt de kaart zonder "vermoedelijk" (zie hierboven).
const EIGEN_ZEKER = new Set(["wieler", "loop", "wandel", "markt", "buurtfeest", "stoet", "fiets", "halloween", "sint", "herdenking"]);

// ---------- de plek in gewone taal ----------

// Waar een dossier zonder parcours ligt: hoeveel plekken, hoe groot, in welke straat of wijk, of op een
// vaste plek (lib/vaste-plekken.json). Telt alleen wat er staat (innames en verkeersvrije zones), niet de
// parkeerverboden en omleidingen errond. Twee innames binnen CLUSTER_METER (een per fase, of een vlak dat
// een dag later iets groter is) zijn één plek. straatBij(punt) en wijkVan(straat) komen van de verversing;
// wijkBijPunt(punt) zoekt de wijk zonder straat (een park, een parking).
const CLUSTER_METER = 20;
const centrumVan = (rings) => { const b = boxVan(rings.flat()); return b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : null; };
const STAAT = /^inname$|verkeersvrij/i, GEVOLG = /parkeerverbod|omleiding/i;
// stratenRond(punt): de straatnamen binnen 150 m; isStraat(naam): staat die hele naam in de straatas? Samen
// bewijzen ze elke naam in een plaatsnaam (lib/plaatsnaam.mjs).
export function plekFeiten(innames = [], { straatBij = () => "", wijkVan = () => "", wijkBijPunt = null, vastePlekken = [], rand = true, stratenRond = () => [], isStraat = () => false } = {}) {
  const wijkBij = typeof wijkBijPunt === "function" ? wijkBijPunt : () => "";
  const geen = { aantal: 0, m2: 0, grootste: 0, spreiding: 0, straat: "", straten: [], wijken: [], namen: [], vast: null, geenCharter: false };
  const zonderParcours = innames.filter((i) => !/parcours/i.test(i?.type || ""));
  const staat = zonderParcours.filter((i) => STAAT.test(clean(i?.type, 60)));
  const lijst = staat.length ? staat : zonderParcours.filter((i) => !GEVOLG.test(i?.type || "")).length ? zonderParcours.filter((i) => !GEVOLG.test(i?.type || "")) : zonderParcours;
  const stukken = [];
  for (const i of lijst) {
    const rings = (i.geometry?.rings || []).filter((r) => Array.isArray(r) && r.length >= 4 && r.every(geldig));
    // De oppervlakte uit A-Sign (Shape_Area) als die er is; anders gerekend op de (vereenvoudigde) vorm.
    // De naam van de plek: de omschrijving, alleen als ze een plaatsnaam is (privacyfilter in lib/plaatsnaam.mjs).
    const naamVan = (c) => plaatsnaamVan(i?.beschrijving, { rond: () => (geldig(c) ? stratenRond(c) : []), isStraat });
    if (rings.length) { const c = centrumVan(rings); stukken.push({ c, m2: Number.isFinite(i.m2) && i.m2 > 0 ? i.m2 : Math.abs(oppervlakte(rings)), rand: rings[0].filter((_, k) => k % Math.max(1, Math.floor(rings[0].length / 8)) === 0), naam: naamVan(c) }); }
    for (const l of i.geometry?.paths || []) if (Array.isArray(l) && l.length >= 2 && l.every(geldig)) stukken.push({ c: l[Math.floor(l.length / 2)], m2: 0, rand: [l[0], l.at(-1)], naam: naamVan(l[Math.floor(l.length / 2)]) });
  }
  const plekken = [];
  for (const x of stukken.filter((y) => geldig(y.c)).sort((a, b) => b.m2 - a.m2)) {
    const p = plekken.find((q) => meterTussen(q.c, x.c) <= CLUSTER_METER);
    if (p) { p.m2 = Math.max(p.m2, x.m2); p.naam ||= x.naam; } else plekken.push({ ...x });
  }
  if (!plekken.length) return geen;
  let spreiding = 0;
  for (let a = 0; a < Math.min(plekken.length, 80); a++) for (let b = a + 1; b < Math.min(plekken.length, 80); b++) spreiding = Math.max(spreiding, meterTussen(plekken[a].c, plekken[b].c));
  // De straat bij het midden; ligt dat midden ver van elke straat (een plein, een parking), dan de rand.
  // De rand alleen voor een dossier in district Antwerpen (daar ligt de straatas van de site): daarbuiten
  // zou elk randpunt een vraag aan de straatas worden.
  const straten = plekken.map((p) => clean(straatBij(p.c) || (rand ? p.rand.reduce((v, q) => v || straatBij(q), "") : "") || "", 120));
  const tel = new Map();
  plekken.forEach((p, k) => { const w = clean(wijkVan(straten[k]) || wijkBij(p.c), 80); if (w) tel.set(w, (tel.get(w) || 0) + 1); });
  const m2 = plekken.reduce((n, p) => n + p.m2, 0);
  // Een vaste plek: elke plek ligt er helemaal binnen (ook de rand), en samen groot genoeg. Alleen voor wat
  // er echt staat (een inname of een zone), niet voor een parkeerverbod langs de rand van een park.
  const vast = staat.length && vastePlekken.find((v) => geldig(v?.punt) && plekken.every((p) => [p.c, ...p.rand].every((q) => meterTussen(q, v.punt) <= (v.straal || 0))) && m2 >= (v.minM2 || 0)) || null;
  return {
    aantal: plekken.length, m2: Math.round(m2), grootste: Math.round(Math.max(...plekken.map((p) => p.m2))), spreiding: Math.round(spreiding),
    straat: straten.find(Boolean) || "", straten: uniek(straten),
    wijken: [...tel].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "nl")).map(([w]) => w),
    // De namen van de plekken, zoals de aanvrager ze in het dossier zette (alleen plaatsnamen), in de volgorde
    // van A-Sign. De oppervlakte telt hierboven de grootste eerst; de namen volgen het dossier.
    namen: uniek(stukken.map((x) => plekken.find((q) => meterTussen(q.c, x.c) <= CLUSTER_METER)?.naam || "").filter(Boolean)),
    buiten: typeof wijkBijPunt === "function" && plekken.some((p) => !wijkBijPunt(p.c)),
    vast: vast ? { naam: clean(vast.naam, 80), zin: clean(vast.zin, 120), feit: clean(vast.feit, 200), charter: clean(vast.charter, 80) } : null,
    geenCharter: Boolean(vast?.geenCharter),
  };
}
// De wijk bij een punt, uit site/geo/wijken.geo.json (alleen de wijken van district Antwerpen).
export function wijkBijPuntUit(features = []) {
  const wijken = features.filter((f) => /^antwerpen$/i.test(clean(f?.properties?.district, 40)) && f?.geometry && clean(f?.properties?.naam, 80))
    .map((f) => ({ naam: clean(f.properties.naam, 80), polys: f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [] }));
  return (p) => {
    if (!geldig(p)) return "";
    for (const w of wijken) for (const rings of w.polys) { let binnen = false; for (const r of rings) if (ringBevat(p, r)) binnen = !binnen; if (binnen) return w.naam; }
    return "";
  };
}
// "Teniersplaats, De Coninckplein, Elisabeth en 23 andere": de eerste `n` namen uit het dossier, en hoeveel
// plekken er nog zijn (ook die zonder plaatsnaam). Alle namen staan in de fiche (plekNamen).
function namenKort(pf, n) {
  const namen = pf.namen.slice(0, n);
  const rest = Math.max(0, pf.aantal - namen.length);
  return rest ? `${namen.join(", ")} en ${rest} andere` : joinNl(namen);
}
// "Verspreid over de stad": zoveel plekken over meer dan zoveel meter (anders de wijken).
const VERSPREID = { plekken: 10, meter: 3000 };
const verspreid = (pf) => pf.aantal >= VERSPREID.plekken && pf.spreiding > VERSPREID.meter;
const dichtBij = (pf) => pf.aantal === 1 || pf.spreiding <= 150;
// "op de Ruckersplaats en de Bullinckplaats", "in de Kloosterstraat".
function inStraten(straten = []) {
  const s = straten.filter(Boolean);
  if (!s.length) return "";
  if (s.length === 1) return opStraat(s[0]);
  const tweede = opStraat(s[1]).replace(/^(?:in|op) /, "");
  return `${opStraat(s[0])} en ${s.length > 2 ? "omgeving" : tweede}`;
}
// De wijken van verschillende plekken: "in de Universiteitsbuurt" of "in de wijken Kiel en Zuid", met
// "en daarbuiten" als een plek buiten district Antwerpen ligt.
function inDeWijken(pf) {
  const w = pf.wijken;
  if (!w.length) return "";
  const kern = w.length === 1 ? inWijk(w[0]) : `in de wijken ${joinNl(w.slice(0, 2).map(wijkNaam))}${w.length > 2 ? " en omgeving" : ""}`;
  return `${kern}${pf.buiten ? " en daarbuiten" : ""}`;
}
// Waar, kort, voor de titel van de kaart: "op Parking Spoor Oost", "op de Meir", "op 9 plekken in de
// Universiteitsbuurt", "vanaf de Kleine Kauwenberg" (een parcours).
export function plekKort(d) {
  const pf = d.plekken;
  // "vanaf" alleen met een echt vertrekpunt: een inname die zelf "start" of "begin" zegt, of lijnen die één
  // keten vormen (geen lus). Het begin van de langste lijn is vaak een tweede halte (nagekeken op 11
  // oktober 2026: "vanaf het Falconplein" bij een lus vanaf een andere straat).
  if (d.vorm?.heeftParcours) {
    const vanaf = d.vertrekStraat || d.vormVertrekStraat || "";
    return vanaf ? `vanaf ${metStraat(vanaf)}` : d.wijk ? inWijk(d.wijk) : "";
  }
  if (!pf?.aantal) return d.wijk ? inWijk(d.wijk) : "";
  if (pf.vast) return pf.vast.zin;
  // Plekken met een naam in het dossier: de eerste namen, niet "verspreid over de stad".
  if (verspreid(pf) && pf.namen?.length) return `op ${pf.aantal} plekken: ${namenKort(pf, 3)}`;
  if (verspreid(pf)) return `op ${pf.aantal} plekken verspreid over de stad`;
  if (dichtBij(pf)) return inStraten(pf.straten) || (pf.wijken[0] ? inWijk(pf.wijken[0]) : d.wijk ? inWijk(d.wijk) : "");
  return `op ${pf.aantal} plekken${pf.wijken.length ? ` ${inDeWijken(pf)}` : ""}`;
}
// Hoe groot, kort, voor de eerste regel van een kaart zonder soort: "ongeveer 80 m²", "9 kleine plekken,
// samen ongeveer 140 m²", "route van ongeveer 2,4 km", "3 parcourslijnen, samen ongeveer 5,0 km".
export function omvangTekst(d) {
  const pf = d.plekken;
  if (d.vorm?.lijnen?.length) {
    const route = eenRoute(d.vorm);
    return route ? `route van ongeveer ${kmTekst(route.meter)}` : parcoursenTekst(d.vorm);
  }
  if (!pf?.aantal) return "";
  const opp = oppervlakteTekst(pf.m2);
  if (pf.vast) return [opp, pf.vast.feit].filter(Boolean).join("; ");
  const klein = pf.grootste && pf.grootste <= KLEIN_M2 ? "kleine " : "";
  // Wat er staat, als het dossier het noemt (een tent, een wand, een generator): vaste woorden, geen tekst.
  const vw = voorwerpenIn(d.beschrijvingen || []).slice(0, 3);
  return `${pf.aantal === 1 ? opp : `${pf.aantal} ${klein}plekken${opp ? `, samen ${opp}` : ""}`}${vw.length ? `, met ${joinNl(vw)}` : ""}`;
}
// De zin bij "Waar" voor een dossier zonder parcours: wat er vaststaat, zonder te zeggen wat het níet is.
function plekZin(d) {
  const pf = d.plekken;
  const gebied = d.district ? ` (${d.wijk ? `${wijkNaam(d.wijk)}, ` : ""}district ${d.district})` : "";
  if (!pf?.aantal) return `Inname${d.beginStraat ? ` ${opStraat(d.beginStraat)}` : ""}${gebied}`;
  const opp = oppervlakteTekst(pf.m2);
  // Een vaste plek die zelf al tussen haakjes zegt waar ("in park Konijnenwei (Nieuw Zuid)"): niet nog eens.
  if (pf.vast) {
    const zin = /\)$/.test(pf.vast.zin) ? (d.district ? pf.vast.zin.replace(/\)$/, `, district ${d.district})`) : pf.vast.zin) : `${pf.vast.zin}${gebied}`;
    return `Inname van ${opp || "het terrein"} ${zin}${pf.vast.feit ? `; ${pf.vast.feit}` : ""}`;
  }
  const klein = pf.grootste && pf.grootste <= KLEIN_M2 ? "kleine " : "";
  if (verspreid(pf) && pf.namen?.length) return `${pf.aantal} ${klein}plekken${opp ? `, samen ${opp}` : ""}: ${namenKort(pf, 6)}`;
  if (verspreid(pf)) return `${pf.aantal} ${klein}plekken verspreid over de stad${opp ? `, samen ${opp}` : ""}`;
  const waar = inStraten(pf.straten);
  if (pf.aantal === 1) return `Inname van ${opp || "een stuk openbaar domein"}${waar ? ` ${waar}` : ""}${gebied}`;
  if (dichtBij(pf)) return `${pf.aantal} innames van samen ${opp || "een stuk openbaar domein"}${waar ? ` ${waar}` : ""}${gebied}`;
  return `${pf.aantal} ${klein}plekken van samen ${opp || "een stuk openbaar domein"}${pf.wijken.length ? ` ${inDeWijken(pf)}` : gebied}`;
}

// ---------- stap e: de kaartzin ----------

// "Lus van ongeveer 2,4 km in de Brederodewijk (district Antwerpen), begin en einde in de Belegstraat,
// op vrijdag 20 november." Getallen staan nooit na een straatnaam (geen huisnummers).
export function kmTekst(m) {
  if (!m) return "";
  if (m < 950) return `${Math.max(50, Math.round(m / 50) * 50)} m`;
  return `${(Math.round(m / 100) / 10).toLocaleString("nl-BE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
}
// Eén route of lus, zoals A-Sign ze tekent: één parcourslijn, of lijnen die een keten vormen (het einde
// van elke lijn bij het begin van de volgende) zonder dat een ervan zelf een lus is. Dan { meter, lus } met
// de getekende lengte: een stuk heen en terug telt twee keer (vorm.lengte, zonder dubbel getekende stukken,
// telt het één keer). Anders null: losse lijnen, of lussen vanaf één punt (een lus van 1 km, een van 1,5 km
// en een van 3 km), zijn geen route van hun som. (Een korte lijn is geen lus omdat begin en einde dicht bij
// elkaar liggen: dat moet ook ruim onder een tiende van haar lengte zijn.)
export function eenRoute(v) {
  const lijnen = (Array.isArray(v?.lijnen) ? v.lijnen : []).filter((l) => Array.isArray(l) && l.length >= 2 && l.every(geldig));
  if (!lijnen.length) return null;
  const eigenLus = (l) => meterTussen(l[0], l.at(-1)) <= Math.min(DREMPELS.lusMeter, lijnLengte(l) / 10);
  if (lijnen.length > 1 && (v.keten !== true || lijnen.some(eigenLus))) return null;
  const meter = Math.round(lijnen.reduce((som, l) => som + lijnLengte(l), 0));
  return meter > 0 ? { meter, lus: Boolean(v.keten ? v.ketenLus : v.lus) } : null;
}
// "6 parcourslijnen, samen ongeveer 26,8 km": een dossier met losse lijnen (zie eenRoute). Zoveel lijnen
// tekent A-Sign; of het losse parcoursen zijn of stukken van één, zegt het niet. Samen: zonder dubbel
// getekende stukken (vorm.lengte).
const parcoursenTekst = (v) => (v.lijnen.length === 1 ? "parcours" : `${v.lijnen.length} parcourslijnen${v.lengte ? `, samen ongeveer ${kmTekst(v.lengte)}` : ""}`);

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
  const route = eenRoute(v);
  if (v.lijnen.length && !route) {
    // Losse parcoursen: geen lengte van één route, en geen begin of einde van één lijn (dat zegt niets over
    // de andere); wel een vertrekpunt dat het dossier zelf noemt, of een begin dat alle lijnen delen.
    delen.push(`${capital(parcoursenTekst(v))}${gebied && v.lijnen.length > 1 && v.lengte ? `,${gebied}` : gebied}`);
    const zelfdeBegin = v.lijnen.length > 1 && v.lijnen.every((l) => meterTussen(l[0], v.lijnen[0][0]) <= KETEN_METER);
    const begin = d.vertrekStraat || (zelfdeBegin ? d.vormVertrekStraat || d.beginStraat : "");
    if (begin) delen.push(`begin aan ${metStraat(begin)}`);
  } else if (v.lijnen.length) {
    const lus = route.lus;
    delen.push(`${lus ? "Lus" : "Route"} van ongeveer ${kmTekst(route.meter)}${gebied}`);
    // "van ... naar ..." alleen met een echt vertrekpunt (zie plekKort). Anders zeggen we niet wat het begin
    // is: "begin en einde aan" (dezelfde straat), "begin en einde bij" (een lus) of "tussen ... en ...".
    const begin = d.vertrekStraat || (v.keten ? d.ketenBeginStraat : d.vormVertrekStraat || ""), einde = v.keten ? d.ketenEindStraat : "";
    const b = d.beginStraat, e = d.eindStraat;
    if (begin && lus) delen.push(`begin en einde aan ${metStraat(begin)}`);
    else if (begin && einde && begin !== einde) delen.push(`van ${metStraat(begin)} naar ${metStraat(einde)}`);
    else if (begin) delen.push(`begin aan ${metStraat(begin)}`);
    else if (b && e && b === e) delen.push(`begin en einde aan ${metStraat(b)}`);
    else if (b && e) delen.push(lus ? `begin en einde bij ${metStraat(b)} en ${metStraat(e)}` : `tussen ${metStraat(b)} en ${metStraat(e)}`);
    else if (b || e) delen.push(`langs ${metStraat(b || e)}`);
  } else if (v.heeftParcours && v.oppervlakte) {
    const opp = v.oppervlakte >= 10_000 ? `${(Math.round(v.oppervlakte / 1000) / 10).toLocaleString("nl-BE")} ha` : `${Math.max(100, Math.round(v.oppervlakte / 100) * 100).toLocaleString("nl-BE")} m²`;
    delen.push(`Parcours over een zone van ongeveer ${opp}${gebied}`);
    if (d.beginStraat) delen.push(`aan ${metStraat(d.beginStraat)}`);
  } else {
    // Geen "evenement zonder parcours": dat zegt wat het níet is. Wel hoeveel plekken, hoe groot en waar.
    delen.push(plekZin(d));
  }
  // De echte dagen (losse dagen of een ritme), anders de eerste en de laatste dag.
  const echt = Array.isArray(d.dagen) && d.dagen.length > 1 && d.dagen.length < 60 ? patroonVan(d.dagen, vandaag) : null;
  const dagen = echt && !echt.aaneen ? patroonTekst(echt, vandaag) : dagenTekst(d.dag.start, d.dag.eind, vandaag);
  if (dagen) delen.push(/^(?:van|op|elke|één|heel|de hele) /.test(dagen) ? dagen : `op ${dagen}`);
  return `${delen.join(", ")}.`;
}
export function kaartzin(d, { vandaag = "" } = {}) {
  const stand = GOEDGEKEURD.includes(d.status) ? "aanvraag goedgekeurd" : "aanvraag nog niet goedgekeurd";
  return `${routeZin(d, { vandaag })} Stand in A-Sign op ${datumTekst(vandaag, { jaar: true }) || vandaag}: ${stand}.`;
}

// ---------- alles samen ----------

const RANG = { zeker: 3, waarschijnlijk: 2, onbekend: 1 };
const leeg = () => ({ naam: "", soort: "", organisator: "", reden: "", uren: "", urenNoot: "", watMerkJe: "", link: "", linkLabel: "", linkUitleg: "", extraLinks: [] });
// Een pagina met meerdere activiteiten (de districtskalender), niet een nieuwsbericht over één evenement.
const KALENDER_PAGINA = /wat-beleef-je-in-district|kalender|\/agenda\b/i;

function voorstelUitKoppeling(v, d) {
  const { m } = v;
  const k = m.k;
  const soortKey = m.soortK || d.soort;
  const methode = k.bron === "gipod" ? "gipod" : k.bron === "organisator" ? "organisator" : k.bron === "besluit" ? "besluit" : "kalender";
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
    grond: k.bron === "besluit" ? "een besluit met dezelfde dag en straat" : "een agendapunt op dezelfde dag en plek",
    bron: [link].filter(Boolean),
    link, linkLabel: link && methode === "gipod" ? clean(`Gegevens in ${k.bronLabel}`, 80) : link && KALENDER_PAGINA.test(link) && methode === "kalender" ? clean(`${capital(k.bronLabel)} (meerdere activiteiten)`, 80) : "",
    linkUitleg: link && /wat-beleef-je-in-district/i.test(link) ? `Op de districtskalender, bij ${datumTekst(k.dag)}.` : "",
    uren: v.zekerheid === "zeker" || v.metNaam ? clean(k.tijd, 300) : "",
    organisator: v.zekerheid === "zeker" ? clean(k.organisator, 200) : "",
  };
  // Bij een agenda van een organisatie hoort haar naam erbij ("D%p" zegt niets, "D%p (Fabiant)" wel).
  const kortOrg = k.bron === "organisator" ? clean(k.organisator, 120).split(" (")[0] : "";
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

// Zoveel plaatsnamen bewaart een fiche hoogstens (het jaardossier ET2025006923 heeft er 26).
export const MAX_PLEK_NAMEN = 60;
// Eén dossier: alle stappen, de hoogste eerlijke zekerheid, en altijd de kaartzin.
export function herkenDossier(d, { koppeling = null, bibliotheek = [], historiek = [], charter = null, vandaag = "", foren = [], vensters = [], markten = [], marktDagen = [], zuster = null } = {}) {
  const voorstellen = [];
  const foor = stapFoor(d, foren);
  if (foor) voorstellen.push(foor);
  const markt = stapMarkt(d, markten, marktDagen);
  if (markt) voorstellen.push(markt);
  const patroon = stapPatroon(d, bibliotheek);
  if (patroon) voorstellen.push(patroon);
  const kal = koppeling ? voorstelUitKoppeling(koppeling, d) : null;
  if (kal) voorstellen.push(kal);
  const regels = stapRegels(d, { historiek, charter, vensters, zuster });
  if (regels.zekerheid !== "onbekend") voorstellen.push(regels);

  // Tegenspraak verlaagt: een kalendernaam die niet past bij het patroon of bij de soort in het dossier.
  if (kal?.zekerheid === "zeker") {
    if (patroon?.naam && !zelfdeTitelStreng(patroon.naam, kal.naam) && !naamBewijs(kal.naam, [patroon.naam])) { kal.zekerheid = "waarschijnlijk"; kal.signalen.push(`twijfel: het patroon wijst op ${patroon.naam}`); }
    if (regels.soortKey && koppeling.m.soortK && !soortPast(regels.soortKey, koppeling.m.soortK)) { kal.zekerheid = "waarschijnlijk"; kal.signalen.push("twijfel: de soort in het dossier past niet"); }
    if (kal.zekerheid === "waarschijnlijk") { kal.soort = metLidwoord(kal.soort); kal.reden = `Op dezelfde dag en plek staat '${kal.naam}' in de bron, maar niet alles klopt.`; }
  }
  const volgorde = { kalender: 0, gipod: 0, besluit: 0, foorlijst: 0, markt: 0, organisator: 1, patroon: 2, regels: 3 };
  voorstellen.sort((a, b) => RANG[b.zekerheid] - RANG[a.zekerheid] || Number(Boolean(b.naam)) - Number(Boolean(a.naam)) || volgorde[a.methode] - volgorde[b.methode]);
  const keuze = voorstellen[0] || null;
  const signalen = uniek([...(keuze?.signalen || []), ...voorstellen.filter((v) => v !== keuze).flatMap((v) => v.signalen || []), ...(keuze ? [] : regels.signalen)]).slice(0, 6).map((s) => clean(s, 200));

  const waar = routeZin(d, { vandaag });
  const record = {
    zekerheid: keuze?.zekerheid || "onbekend",
    ...leeg(),
    // De site gebruikt de eerste en de laatste dag; een lange inname krijgt alleen die twee. Een markt
    // krijgt haar marktdagen (elke vrijdag), zodat de kaart "Vandaag" alleen op een marktdag zegt.
    dagen: keuze?.dagenMarkt?.length ? keuze.dagenMarkt : evenementDagen(d).length <= 14 ? evenementDagen(d) : [d.dag.start, d.dag.eind],
    waar,
    binnenDistrict: Boolean(d.binnenDistrict),
    bron: [],
    bijgewerkt: vandaag,
    methode: keuze?.methode || "kaart",
    signalen,
    kaartzin: kaartzin(d, { vandaag }),
    goedgekeurd: GOEDGEKEURD.includes(d.status),
    // Voor de titel en de eerste regel van de kaart (site/kaart-uitleg.js): waar, kort; of de soort in het
    // dossier zelf staat (dan zonder "vermoedelijk"); of het geen evenement met publiek is; en waarop een
    // vermoeden steunt, in een paar woorden.
    plek: clean(plekKort(d), 120),
    omvang: clean(omvangTekst(d), 160),
    // De namen van de plekken (plaatsnamen uit het dossier, na de privacyfilter), bij een dossier met meer
    // plekken: de kaart toont ze allemaal (site/kaart-uitleg.js). Alleen als er namen zijn.
    ...((d.plekken?.aantal || 0) >= 2 && d.plekken?.namen?.length >= 2 ? { plekNamen: d.plekken.namen.slice(0, MAX_PLEK_NAMEN).map((n) => clean(n, 80)) } : {}),
    soortZeker: false,
    geenEvenement: false,
    grond: "",
  };
  if (keuze) {
    const max = { naam: 120, soort: 200, organisator: 200, reden: 400, uren: 300, link: 500, linkLabel: 80, linkUitleg: 160 };
    for (const k of Object.keys(max)) if (keuze[k]) record[k] = k === "link" ? keuze[k] : zonderNummers(keuze[k], max[k]);
    record.bron = keuze.bron || [];
    record.soortZeker = Boolean(keuze.soortZeker);
    record.geenEvenement = Boolean(keuze.geenEvenement);
    record.grond = clean(keuze.grond, 160);
    // Een ding dat het dossier maar op een deel van de plekken noemt: de plek van die innames (stickers op 6
    // plekken, niet op alle 9). Zegt dat niets (geen straat of wijk), dan de plek van het hele dossier.
    const dp = d.dingPlekken?.[keuze.soortKey];
    const dingPlek = dp?.aantal && dp.aantal < (d.plekken?.aantal || 0) ? clean(plekKort({ ...d, plekken: dp }), 120) : "";
    if (dingPlek) record.plek = dingPlek;
  }
  if (record.zekerheid === "waarschijnlijk" && !record.soort) record.zekerheid = "onbekend";
  if (record.zekerheid !== "zeker" && record.zekerheid !== "waarschijnlijk") { record.naam = ""; record.soort = ""; record.reden = ""; record.organisator = ""; record.uren = ""; record.link = ""; record.linkLabel = ""; record.linkUitleg = ""; record.bron = []; record.soortZeker = false; record.geenEvenement = false; record.grond = ""; }
  record.bron = uniek([...record.bron.map(publiekeLink), ASIGN_BRON]).filter(Boolean);
  // "Zeker" vraagt een naam en een eigen publieke bron naast de evenementendossiers van A-Sign (laag 22 en
  // 23): een agenda, een besluit, GIPOD, of een eigen lijst van de stad (de foorlijst, A-Sign laag 0, of de
  // marktdagen in GIPOD). Anders een trap lager.
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
    link: "", linkLabel: "", linkUitleg: "", extraLinks: [], bron: [ASIGN_BRON], methode: "kaart", signalen: [],
    soortZeker: false, geenEvenement: false, grond: "",
  };
}

// Een omschrijving die het vertrekpunt noemt ("Startzone", "begin locatie", "vertrekpunt").
const VERTREK = /\b(?:start\w*|begin\w*|vertrek\w*)\b/;
// Dossierfeiten verrijken met wat de stappen nodig hebben: vorm, soort, straten, gebied.
// straatBij(punt) -> straatnaam of ""; stratenLangs(lijnen) -> [straatnamen]; wijkVan(straat) -> wijk.
export function verrijk(d, { straatBij = () => "", postcodeBij = () => "", stratenLangs = () => [], wijkVan = () => "", districten = [], districtGrens = null, wijkBijPunt = null, vastePlekken = [], stratenRond = () => [], isStraat = () => false } = {}) {
  const vorm = vormVan(d.innames);
  const midden = vorm.start || vorm.kern[0] || (vorm.bbox ? [(vorm.bbox[0] + vorm.bbox[2]) / 2, (vorm.bbox[1] + vorm.bbox[3]) / 2] : null);
  const district = districtVan(midden, districten) || "";
  // Het midden van het kader als plek (straat, wijk) alleen zonder reuzenvlak: anders is het het middelpunt
  // van zo'n vlak (de Groenplaats bij een vlak over heel het centrum, ET2025007162).
  const middenPlek = vorm.start || vorm.kern[0] || (vorm.reuzenvlakken ? null : midden);
  // Zonder parcourslijn: de straat bij de eerste inname die er een heeft (hoogstens drie pogingen).
  const beginStraat = vorm.start ? straatBij(vorm.start) : [...vorm.kern, middenPlek].filter(Boolean).slice(0, 3).map((p) => straatBij(p)).find(Boolean) || "";
  const eindStraat = vorm.eind ? straatBij(vorm.eind) : "";
  const straten = uniek(stratenLangs([...vorm.lijnen, ...vorm.vlakken.flat()]));
  const kernStraten = uniek([beginStraat, eindStraat, ...vorm.kern.map((p) => straatBij(p))]);
  const binnenDistrict = districtGrens ? [...routePunten(vorm), ...vorm.kern].some((p) => districtVan(p, [{ naam: "x", geometry: districtGrens }])) : district === "Antwerpen";
  // Het vertrekpunt: een inname die zelf "start", "begin" of "vertrek" zegt (de straat komt uit de straatas,
  // niet uit de tekst); anders het begin van een keten van lijnen (vormVan).
  const vertrek = (d.innames || []).find((i) => VERTREK.test(plat(i?.beschrijving)) && (i.geometry?.rings?.length || i.geometry?.paths?.length));
  const vertrekPunt = vertrek ? (vertrek.geometry.rings ? centrumVan(vertrek.geometry.rings.filter((r) => Array.isArray(r) && r.every(geldig))) : vertrek.geometry.paths[0]?.[0]) : null;
  const vertrekStraat = geldig(vertrekPunt) ? straatBij(vertrekPunt) : "";
  const opties = { straatBij, wijkVan, wijkBijPunt, vastePlekken, rand: binnenDistrict, stratenRond, isStraat };
  // Per ding (stickers, een bord ...) de plekken van de innames die het noemen: "stickers op 6 plekken", niet
  // op alle 9 plekken van het dossier.
  const dingPlekken = {};
  for (const dg of DINGEN) {
    const eigenInnames = (d.innames || []).filter((i) => dg.re.test(zonderOntkenning(i?.beschrijving)));
    if (eigenInnames.length) dingPlekken[dg.key] = plekFeiten(eigenInnames, opties);
  }
  return {
    ...d, vorm, district, wijk: district === "Antwerpen" ? clean(wijkVan(beginStraat) || (typeof wijkBijPunt === "function" && middenPlek ? wijkBijPunt(middenPlek) : ""), 80) : "", beginStraat, eindStraat,
    vertrekStraat, ketenBeginStraat: vorm.ketenStart ? straatBij(vorm.ketenStart) : "", ketenEindStraat: vorm.ketenEind ? straatBij(vorm.ketenEind) : "",
    vormVertrekStraat: vorm.vertrek ? straatBij(vorm.vertrek) : "",
    plekken: plekFeiten(d.innames || [], opties), dingPlekken,
    straten, kernStraten, postcodes: uniek([vorm.start, vorm.eind, ...vorm.kern].filter(Boolean).map((p) => postcodeBij(p))), binnenDistrict,
    soort: eersteSoort(d.beschrijvingen), eigenSoort: eersteSoort(d.beschrijvingen),
  };
}

// Welk deel van een dossier ligt binnen de grens (een GeoJSON-geometrie, zoals
// lib/district-antwerpen-grens.geojson)? 0 tot 1, gemeten op de bemonsterde route (om de ~15 m), zonder
// route op de vlakken, anders op de kernpunten. Hoogstens `max` punten, gelijk verdeeld (een marathon telt
// er duizenden). Zonder grens of zonder punten: 1 (niets bekend, dus niets wegfilteren).
export function aandeelBinnen(vorm, grens, { max = 400 } = {}) {
  if (!grens || !vorm) return 1;
  const route = Array.isArray(vorm.lijnen) && Array.isArray(vorm.vlakken) ? routePunten(vorm) : [];
  const punten = (route.length ? route : Array.isArray(vorm.kern) ? vorm.kern : []).filter(geldig);
  if (!punten.length) return 1;
  const stap = Math.max(1, Math.ceil(punten.length / max));
  const monster = punten.filter((_, i) => i % stap === 0);
  const zone = [{ naam: "binnen", geometry: grens }];
  return monster.filter((p) => districtVan(p, zone)).length / monster.length;
}

// Het hele bestand. hand: evenement-identiteit.json; bibliotheek: patronen; kandidaten: zie hierboven.
// gebiedNamen: wijknamen (site/geo/wijken.geo.json), die net als districten geen eigen naam zijn.
export function bouwHerkenning({ dossiers = [], hand = null, bibliotheek = [], kandidaten = [], historiek = {}, charter = null, vandaag = "", generatedAt = "", bronFouten = [], gebiedNamen = [], foren = [], buurtacties = [], markten = [], marktDagen = [] } = {}) {
  const handDossiers = hand?.dossiers || {};
  for (const d of dossiers) if (d.eigenSoort === undefined) d.eigenSoort = eersteSoort(d.beschrijvingen || []);
  const open = dossiers.filter((d) => !handDossiers[d.dossier]);
  // Het weekend van een buurtactie (Herfstklaar) uit de agendabronnen, en welke dossiers in een reeks op
  // hetzelfde vlak liggen (twee of meer andere dagen binnen 60 dagen: een inname elke zondag).
  const vensters = buurtVensters(kandidaten, buurtacties);
  if (vensters.length) for (const d of open) d.inReeks = inReeks(d, dossiers);
  // De soort uit de regels telt ook mee voor de koppeling (een dossier zonder omschrijving).
  // Een zusterdossier op dezelfde dag en plek (een opstelling tijdens een shopevent): alleen voor een
  // dossier dat zelf niets noemt.
  for (const d of open) d.zuster = soortenIn(d.beschrijvingen || []).length ? null : zusterVan(d, dossiers);
  for (const d of open) if (!d.soort) d.soort = stapRegels(d, { historiek: historiek[d.dossier] || [], charter, vensters, zuster: d.zuster }).soortKey || "";
  // Ook dossiers met een handfiche doen mee als "ander dossier op die plek" bij de koppeling.
  const gewoon = new Set(gebiedNamen.flatMap((n) => plat(n).split(" ")).filter((w) => w.length >= 4));
  const koppelingen = koppelKandidaten(dossiers, kandidaten, { gewoon });
  const uit = {};
  for (const d of open) {
    uit[d.dossier] = herkenDossier(d, { koppeling: koppelingen.get(d.dossier) || null, bibliotheek, historiek: historiek[d.dossier] || [], charter, vandaag, foren, vensters, markten, marktDagen, zuster: d.zuster || null });
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
