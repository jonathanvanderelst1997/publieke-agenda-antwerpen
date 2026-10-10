// Welke straten volgt een parcours, en welke kruist het alleen? Eén berekening voor de verversing
// (lib/kaart-uitleg-refresh.mjs schrijft ze in site/sources/kaart-uitleg.json) en voor de browser
// (place-core.js, als de verversing een dossier nog niet kent). Pure functies, zonder netwerk.
//
// Werkwijze: de straatas van elke straat in de buurt van het parcours wordt om de STAP meter
// bemonsterd. Een monster ligt "op het parcours" als het in het vlak van het parcours ligt (A-Sign
// laag 22), of binnen MARGE_LIJN meter van de lijn (laag 23, als er geen vlak is). Aaneengesloten
// monsters vormen een stuk. Is dat stuk eigen straatas minstens 40 m lang, en langer dan het parcours
// daar breed is, dan loopt het parcours door de straat (looptLangs). Een stuk dwars over een breed
// parcours (de Leien), een hoek waar het parcours afslaat, of een tunnel eronder: de straat kruist
// het parcours, of komt erop uit.
import { segmentenInKader } from "./street-core.js";

export const STAP = 5; // meter tussen twee monsters op de straatas
export const MARGE_VLAK = 5; // een as die tot 5 m naast het vlak loopt, telt nog mee
export const MARGE_LIJN = 10; // een lijn heeft geen breedte: 10 m aan elke kant
const MAX_BREED = 150; // verder dan dit meten we de breedte van het parcours niet
const CEL = 25; // meter per cel van het rooster met randen

const isPunt = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);

// De geometrie van een parcours uit A-Sign-features (ArcGIS-JSON of GeoJSON). Vlakken houden hun
// ringen per feature samen (even-oneven binnen één feature, met gaten).
export function parcoursGeometrie(features = []) {
  const vlakken = [], lijnen = [];
  for (const f of features) {
    const g = f?.geometry || f;
    if (!g) continue;
    if (Array.isArray(g.rings)) vlakken.push(g.rings);
    else if (Array.isArray(g.paths)) lijnen.push(...g.paths);
    else if (g.type === "Polygon") vlakken.push(g.coordinates || []);
    else if (g.type === "MultiPolygon") for (const p of g.coordinates || []) vlakken.push(p);
    else if (g.type === "LineString") lijnen.push(g.coordinates || []);
    else if (g.type === "MultiLineString") lijnen.push(...(g.coordinates || []));
  }
  return { vlakken: vlakken.map((v) => v.filter((r) => Array.isArray(r) && r.length >= 3)).filter((v) => v.length), lijnen: lijnen.filter((l) => Array.isArray(l) && l.length >= 2) };
}

// Voorbereiden: alles in meter rond één oorsprong, randen in een rooster, en per vlak de randen per
// horizontale band (voor de straal-test "binnen het vlak").
function vorm({ vlakken = [], lijnen = [] } = {}) {
  // Een vlak is exacter dan de lijn: laag 23 is vaak een ruwe schets met een paar punten.
  const gebruikVlakken = vlakken.length > 0;
  const bron = gebruikVlakken ? vlakken.flat() : lijnen;
  const punten = bron.flat().filter(isPunt);
  if (!punten.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of punten) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const lat0 = (minY + maxY) / 2, kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
  const m = (p) => [(p[0] - minX) * kx, (p[1] - minY) * ky];
  const marge = gebruikVlakken ? MARGE_VLAK : MARGE_LIJN;
  const randen = new Map(); // cel → [[a, b], …] in meter
  const banden = []; // per vlak: Map(band → [[a, b], …])
  const zet = (map, k, v) => { const l = map.get(k); if (l) l.push(v); else map.set(k, [v]); };
  const voegRandToe = (a, b, band) => {
    for (let cx = Math.floor((Math.min(a[0], b[0]) - marge) / CEL); cx <= Math.floor((Math.max(a[0], b[0]) + marge) / CEL); cx++) {
      for (let cy = Math.floor((Math.min(a[1], b[1]) - marge) / CEL); cy <= Math.floor((Math.max(a[1], b[1]) + marge) / CEL); cy++) zet(randen, celSleutel(cx, cy), [a, b]);
    }
    if (band) for (let by = Math.floor(Math.min(a[1], b[1]) / CEL); by <= Math.floor(Math.max(a[1], b[1]) / CEL); by++) zet(band, by, [a, b]);
  };
  if (gebruikVlakken) {
    for (const vlak of vlakken) {
      const band = new Map();
      for (const ring of vlak) {
        const r = ring.filter(isPunt).map(m);
        for (let i = 0; i < r.length; i++) voegRandToe(r[i], r[(i + 1) % r.length], band);
      }
      banden.push(band);
    }
  } else {
    for (const lijn of lijnen) {
      const l = lijn.filter(isPunt).map(m);
      for (let i = 1; i < l.length; i++) voegRandToe(l[i - 1], l[i], null);
    }
  }
  return { m, kx, ky, minX, minY, marge, randen, banden, cellen: new Map(), kader: [minX, minY, maxX, maxY] };
}
// Een getal als sleutel is veel sneller dan een tekst (honderdduizenden opzoekingen per parcours).
const celSleutel = (cx, cy) => (cx + 50000) * 100000 + (cy + 50000);

function puntRand(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = dx || dy ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
}
function binnenVlak(v, p) {
  const by = Math.floor(p[1] / CEL);
  for (const band of v.banden) {
    let binnen = false;
    for (const [a, b] of band.get(by) || []) {
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) binnen = !binnen;
    }
    if (binnen) return true;
  }
  return false;
}
// Ligt punt p (in meter) op het parcours: in een vlak, of binnen de marge van een rand? Een cel
// zonder rand ligt helemaal binnen of helemaal buiten elk vlak: die toestand één keer per cel.
function opParcours(v, p) {
  const cx = Math.floor(p[0] / CEL), cy = Math.floor(p[1] / CEL), k = celSleutel(cx, cy);
  const randen = v.randen.get(k);
  if (!randen) {
    if (!v.banden.length) return false;
    let toestand = v.cellen.get(k);
    if (toestand === undefined) { toestand = binnenVlak(v, [(cx + 0.5) * CEL, (cy + 0.5) * CEL]); v.cellen.set(k, toestand); }
    return toestand;
  }
  for (const [a, b] of randen) if (puntRand(p, a, b) <= v.marge) return true;
  return binnenVlak(v, p);
}

// Hoe ver reikt het parcours vanaf punt p langs een richting (hoek), aan beide kanten samen? Een
// kleine onderbreking (een middenberm, een gat in het vlak) tot 15 m telt niet als einde.
function reikwijdte(v, p, hoek) {
  const d = [Math.cos(hoek), Math.sin(hoek)];
  let totaal = STAP;
  for (const kant of [1, -1]) {
    let laatste = 0, mis = 0;
    for (let s = STAP; s <= MAX_BREED; s += STAP) {
      if (opParcours(v, [p[0] + kant * d[0] * s, p[1] + kant * d[1] * s])) { laatste = s; mis = 0; } else if (++mis > 3) break;
    }
    totaal += laatste;
  }
  return totaal;
}

// Stukken: monsters die elkaar raken (hoogstens anderhalve stap uit elkaar) horen samen.
function stukken(monsters) {
  const groep = monsters.map((_, i) => i);
  const wortel = (i) => { while (groep[i] !== i) { groep[i] = groep[groep[i]]; i = groep[i]; } return i; };
  const max = STAP * 1.5;
  const rooster = new Map();
  monsters.forEach((s, i) => { const k = celSleutel(Math.floor(s.p[0] / max), Math.floor(s.p[1] / max)); const l = rooster.get(k); if (l) l.push(i); else rooster.set(k, [i]); });
  monsters.forEach((s, i) => {
    const cx = Math.floor(s.p[0] / max), cy = Math.floor(s.p[1] / max);
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) {
      for (const j of rooster.get(celSleutel(x, y)) || []) if (j > i && Math.hypot(monsters[j].p[0] - s.p[0], monsters[j].p[1] - s.p[1]) <= max) groep[wortel(j)] = wortel(i);
    }
  });
  const uit = new Map();
  monsters.forEach((s, i) => { const k = wortel(i); const l = uit.get(k); if (l) l.push(s); else uit.set(k, [s]); });
  return [...uit.values()];
}

// Loopt het parcours langs dit stuk straat? Beslist op de eigen straatas, niet op de vorm van het
// parcours rond één middelpunt (dat mislukte bij een straat met een knik, en telde bij een hoek het
// parcours in het verlengde van de straat mee):
// - de lengte van de eigen straatas in het parcours: minstens MIN_LANGS meter (een kortere straat:
//   bijna haar hele lengte). Een hoek waar het parcours afslaat, of een kruispunt, is korter.
// - die lengte tegen de breedte van het parcours daar: per monster dwars op zijn eigen segment
//   gemeten (een bocht of knik telt zo goed mee), en daarvan de mediaan. Dwars over de Leien is het
//   stuk straat in het parcours korter dan het parcours er breed is (het loopt langs de Leien
//   verder): dat is een kruising. Langs de straat is het stuk langer dan het parcours breed is.
export const MIN_LANGS = 40;
// De lengte van een stuk: van het ene eind tot het andere (twee keer het verste monster zoeken), niet
// de som van de monsters. Drie rijbanen naast elkaar (de Leien) telden zo drie keer.
export function stukLengte(stuk) {
  const verste = (van) => { let best = stuk[0], d = -1; for (const x of stuk) { const e = Math.hypot(x.p[0] - van[0], x.p[1] - van[1]); if (e > d) { d = e; best = x; } } return [best, d]; };
  const [a] = verste(stuk[0].p);
  return Math.min(verste(a.p)[1] + STAP, stuk.reduce((s, x) => s + x.gewicht, 0));
}
function looptLangs(v, stuk, straatLengte = Infinity) {
  const lang = stukLengte(stuk);
  if (lang < Math.max(3 * STAP, Math.min(MIN_LANGS, 0.8 * straatLengte))) return false;
  // Elk monster telt mee (geen steekproef): zo hangt de uitkomst niet af van de volgorde van de
  // straatsegmenten, en is ze in de verversing en in de browser dezelfde.
  const breedtes = stuk.map((x) => reikwijdte(v, x.p, Math.atan2(x.d[1], x.d[0]) + Math.PI / 2)).sort((a, b) => a - b);
  // De reikwijdte telt in stappen van STAP meter: het parcours is daar tussen breed en breed + 2 × STAP
  // breed. Vergelijk met het midden, zodat een afronding van een paar meter de uitkomst niet omgooit.
  return lang > breedtes[Math.floor(breedtes.length / 2)] + STAP;
}
// Een tunnel ligt onder het parcours: het parcours loopt er nooit "door".
export const isTunnel = (naam) => /tunnel$/i.test(String(naam || "").trim());
// Loopt het parcours door deze straat? Een stuk dat langs de straat loopt (looptLangs), of de straat
// ligt grotendeels in het parcours: een plein in de zone van een evenement (Grote Markt, Mediaplein)
// is geen kruising, en een korte straat of brug die helemaal op het parcours ligt, evenmin. Een korte
// zijstraat die op de Leien uitkomt, ligt er maar voor een deel in.
function straatInParcours(v, monsters, naam, index) {
  if (isTunnel(naam)) return false;
  let lengte;
  const straatLengte = () => (lengte ??= straatLengteVan(index, naam));
  const binnen = monsters.reduce((s, x) => s + x.gewicht, 0);
  if (binnen >= 2 * MIN_LANGS && binnen >= 0.6 * straatLengte()) return true;
  if (binnen >= 3 * STAP && binnen >= 0.9 * straatLengte()) return true;
  return stukken(monsters).some((stuk) => looptLangs(v, stuk, stukLengte(stuk) < MIN_LANGS ? straatLengte() : Infinity));
}

// Per straatas: de segmenten per straatnaam, één keer per index (voor `alleen`).
const PER_NAAM = new WeakMap();
function segmentenVanNamen(index, namen) {
  let perNaam = PER_NAAM.get(index);
  if (!perNaam) {
    perNaam = new Map();
    for (const seg of index.segments) for (const n of new Set((seg.refs || []).map((r) => r?.name).filter(Boolean))) { const l = perNaam.get(n); if (l) l.push(seg); else perNaam.set(n, [seg]); }
    PER_NAAM.set(index, perNaam);
  }
  return [...new Set([...namen].flatMap((n) => perNaam.get(n) || []))];
}
// De hele lengte van een straatas in meter (alle stukken met die naam), voor een korte straat.
function straatLengteVan(index, naam) {
  let som = 0;
  for (const s of segmentenVanNamen(index, [naam])) {
    const kx = 111320 * Math.cos((((s.a[1] + s.b[1]) / 2) * Math.PI) / 180);
    som += Math.hypot((s.b[0] - s.a[0]) * kx, (s.b[1] - s.a[1]) * 110540);
  }
  return som;
}

// { langs, kruist }: straatnamen, alfabetisch. `langs`: het parcours loopt door de straat.
// `kruist`: de straat kruist het parcours of komt erop uit, maar het parcours loopt er niet door.
// Met `alleen` (een Set van namen) worden alleen die straten bekeken: veel sneller, voor de browser.
export function stratenVanParcours(geometrie, index, { alleen = null } = {}) {
  const v = index?.segments?.length ? vorm(geometrie || {}) : null;
  if (!v) return { langs: [], kruist: [] };
  const pad = (v.marge + STAP) / 50000;
  const kandidaten = alleen
    ? segmentenVanNamen(index, alleen).filter((s) => !(Math.max(s.a[0], s.b[0]) < v.kader[0] - pad || Math.min(s.a[0], s.b[0]) > v.kader[2] + pad || Math.max(s.a[1], s.b[1]) < v.kader[1] - pad || Math.min(s.a[1], s.b[1]) > v.kader[3] + pad))
    : segmentenInKader(index, v.kader, pad);
  const perStraat = new Map();
  for (const seg of kandidaten) {
    const namen = [...new Set((seg.refs || []).map((r) => r?.name).filter((n) => n && (!alleen || alleen.has(n))))];
    if (!namen.length) continue;
    const a = v.m(seg.a), b = v.m(seg.b);
    const lengte = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!lengte) continue;
    const d = [(b[0] - a[0]) / lengte, (b[1] - a[1]) / lengte];
    const n = Math.max(1, Math.ceil(lengte / STAP));
    for (let j = 0; j < n; j++) {
      const t = (j + 0.5) / n, p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      if (!opParcours(v, p)) continue;
      const monster = { p, d, gewicht: lengte / n };
      for (const naam of namen) { const l = perStraat.get(naam); if (l) l.push(monster); else perStraat.set(naam, [monster]); }
    }
  }
  const langs = [], kruist = [];
  for (const [naam, monsters] of perStraat) (straatInParcours(v, monsters, naam, index) ? langs : kruist).push(naam);
  const sorteer = (l) => l.sort((a, b) => a.localeCompare(b, "nl"));
  return { langs: sorteer(langs), kruist: sorteer(kruist) };
}
