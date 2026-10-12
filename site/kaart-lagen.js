// De buurtkaart in lagen (P9 "Een kaart die vertelt"): wat de kaart tekent, als GeoJSON, los van de kaart-
// bibliotheek. Puur: geen DOM, ook in Node te importeren (tests/kaart-lagen.test.mjs). Leaflet en MapLibre
// tekenen allebei uit wat hier staat (site/neighborhood-map.js).
//
// - De kaartjes komen uit de lijst (window.PUBLIC_AGENDA_KAART.teken, site/place-view.js); elk object op de
//   kaart is een kaartje van de lijst, met dezelfde soort, kleur en telsleutel (lijstSleutel).
// - Privacy: parkeerverboden, losse innames en vergunningen staan op de kaart als één punt, het midden van
//   hun kader afgerond op ONGEVEER_DECIMALEN (ongeveer 100 m), met "plek bij benadering". Werken, parcours,
//   werfzones en omleidingen staan exact op de kaart. Wie ze toch exact wil tonen: één regel in vormVoor().
// - Een terras heeft geen vorm (terraces-live-core.js laat ze vallen): het staat in `zonder`.
import { groupByPoint, isPoint, itemPoint } from "./neighborhood-core.js";
import { KAART_SOORTEN, kaartSoort, kortBereik, kortDatum, lijstSleutel } from "./place-core.js";

export const ONGEVEER_DECIMALEN = 3;
// Zoveel kaartjes per soort tekent de kaart hoogstens (een district vol werken blijft vlot).
export const MAX_PER_SOORT = 600;
const POPUP_MAX = 6;

const esc = (v = "") => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
const CAT = Object.freeze(Object.fromEntries(KAART_SOORTEN.map((s) => [s.key, s.cat])));
const rond = (x) => Number(x.toFixed(ONGEVEER_DECIMALEN));

// Een plek bij benadering: een parkeerverbod, een losse inname (geen evenement, geen werfzone) en een
// vergunning. Hangt alleen af van de soort, niet van de geometrie: de popup zegt het ook zonder vorm.
function isOngeveer(entry, soort = kaartSoort(entry)) {
  if (soort === "vergunning") return true;
  return soort === "verkeer" && entry.item?.kind !== "sgw";
}

// Alle coördinaten van een vorm ({vlakken: [[ring…]…], lijnen: [[punt…]…]}, parcours-straten.js).
const geldigeLijn = (l) => Array.isArray(l) && l.filter(isPoint).length >= 2;
const geldigVlak = (v) => Array.isArray(v) && v.some((r) => Array.isArray(r) && r.filter(isPoint).length >= 3);
function puntenVan(vorm) {
  const uit = [];
  for (const v of vorm?.vlakken || []) for (const r of v || []) for (const p of r || []) if (isPoint(p)) uit.push(p);
  for (const l of vorm?.lijnen || []) for (const p of l || []) if (isPoint(p)) uit.push(p);
  return uit;
}
function kaderVanPunten(punten) {
  let k = null;
  for (const [x, y] of punten) k = k ? [Math.min(k[0], x), Math.min(k[1], y), Math.max(k[2], x), Math.max(k[3], y)] : [x, y, x, y];
  return k;
}
const schoon = (l) => l.filter(isPoint).map((p) => [p[0], p[1]]);
function lijnDeel(lijnen, eigen) {
  const ok = lijnen.filter(geldigeLijn).map(schoon);
  return ok.length ? [{ geometry: ok.length === 1 ? { type: "LineString", coordinates: ok[0] } : { type: "MultiLineString", coordinates: ok }, ...eigen }] : [];
}
function vlakDeel(vlakken, eigen) {
  const ok = vlakken.filter(geldigVlak).map((v) => v.filter((r) => Array.isArray(r) && r.filter(isPoint).length >= 3).map(schoon));
  return ok.length ? [{ geometry: ok.length === 1 ? { type: "Polygon", coordinates: ok[0] } : { type: "MultiPolygon", coordinates: ok }, ...eigen }] : [];
}
const rijenVan = (entry) => (Array.isArray(entry.rijen) && entry.rijen.length ? entry.rijen : entry.item ? [entry.item] : []);

// De vorm van een kaartje: een lijst delen { geometry, parcours, ongeveer }, of null (geen plek op de kaart).
export function vormVoor(entry = {}, { geo = null } = {}) {
  const soort = kaartSoort(entry);
  const exact = { parcours: false, ongeveer: false };
  if (soort === "agenda") {
    const p = itemPoint(entry.item, geo);
    return p ? [{ geometry: { type: "Point", coordinates: [p[0], p[1]] }, ...exact }] : null;
  }
  if (soort === "werken") {
    // Een werf in stukken: een punt per stuk (werkEntries in place-core.js).
    const punten = rijenVan(entry).map((w) => w?.point).filter(isPoint).map((p) => [p[0], p[1]]);
    if (!punten.length) return null;
    return [{ geometry: punten.length === 1 ? { type: "Point", coordinates: punten[0] } : { type: "MultiPoint", coordinates: punten }, ...exact }];
  }
  if (soort === "evenement") {
    // Het hele dossier, ook buiten de gekozen plek: het parcours apart (parcours=true), de andere innames
    // (opbouw, parkeerverboden van het evenement) eromheen. Zonder live vorm: de schets van de verversing.
    const parcours = { lijnen: [], vlakken: [] }, ander = { lijnen: [], vlakken: [] };
    for (const r of rijenVan(entry)) {
      const vorm = r?.parcours || r?.vorm;
      const doel = r?.parcours ? parcours : ander;
      doel.lijnen.push(...(vorm?.lijnen || []));
      doel.vlakken.push(...(vorm?.vlakken || []));
    }
    const delen = [
      ...vlakDeel(ander.vlakken, exact), ...lijnDeel(ander.lijnen, exact),
      ...vlakDeel(parcours.vlakken, { ...exact, parcours: true }), ...lijnDeel(parcours.lijnen, { ...exact, parcours: true }),
    ];
    if (delen.length) return delen;
    const schets = lijnDeel(Array.isArray(entry.kaart) ? entry.kaart : [], { ...exact, parcours: true });
    return schets.length ? schets : null;
  }
  if (soort === "verkeer" && entry.item?.kind === "sgw") {
    // Werfzone (vlakken) en omleiding (lijnen), van alle fasen van het dossier.
    const vlakken = [], lijnen = [];
    for (const r of rijenVan(entry)) { vlakken.push(...(r?.vorm?.vlakken || [])); lijnen.push(...(r?.vorm?.lijnen || [])); }
    const delen = [...vlakDeel(vlakken, exact), ...lijnDeel(lijnen, exact)];
    return delen.length ? delen : null;
  }
  if (soort === "verkeer" || soort === "vergunning") {
    // Bij benadering: het midden van het kader van de eigen vorm (de rij op de gekozen plek; een parkeerverbod
    // op drie plaatsen is één punt bij jouw plek, niet ergens ertussen), afgerond. Een terras heeft geen vorm.
    // Exact tonen zou zijn: return [...vlakDeel(vorm.vlakken, exact), ...lijnDeel(vorm.lijnen, exact)].
    const vorm = entry.item?.vorm || rijenVan(entry).find((r) => r?.vorm)?.vorm;
    const kader = kaderVanPunten(puntenVan(vorm));
    if (!kader) return null;
    return [{ geometry: { type: "Point", coordinates: [rond((kader[0] + kader[2]) / 2), rond((kader[1] + kader[3]) / 2)] }, parcours: false, ongeveer: true }];
  }
  return null;
}

function kaderVanGeometrie(g) {
  const c = g?.coordinates;
  if (!c) return null;
  const punten = g.type === "Point" ? [c] : g.type === "MultiPoint" || g.type === "LineString" ? c
    : g.type === "MultiLineString" || g.type === "Polygon" ? c.flat() : g.type === "MultiPolygon" ? c.flat(2) : [];
  return kaderVanPunten(punten.filter(isPoint));
}
const samen = (a, b) => (!a ? b : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);

// Alles wat de kaart tekent. `teken`: de kaartjes (PUBLIC_AGENDA_KAART.teken); `soortVan`: telsleutel → soort
// uit de telling van de lijst (telPerSoort), zodat kaart en legenda dezelfde soort geven; `verborgen`: de
// soorten die de legenda uitzette (alleen de kaart, de lijst blijft volledig). Geeft:
// - fc: een FeatureCollection; elke feature heeft precies { uid, tel, soort, cat, parcours, ongeveer };
// - pins: de agendapunten per plek ({ point, entries, uids }), met hun eigen categorie (entry.theme);
// - zonder: de kaartjes zonder plek op de kaart (één per telsleutel);
// - opKaart en perSoort: hoeveel kaartjes (telsleutels) getekend zijn, in totaal en per soort;
// - kaderVan (uid → [w, z, o, n]) en kader: voor inzoomen en markeren.
export function kaartLagen(teken = [], { geo = null, verborgen = new Set(), soortVan = null, max = MAX_PER_SOORT } = {}) {
  const uit = new Set(verborgen || []);
  const features = [], metPunt = [], zonder = [], zonderGezien = new Set();
  const perSoortEntries = Object.fromEntries(KAART_SOORTEN.map((s) => [s.key, 0]));
  const getekend = Object.fromEntries(KAART_SOORTEN.map((s) => [s.key, new Set()]));
  const kaderVan = new Map();
  let kader = null;
  const bewaarKader = (uid, k) => { if (!k) return; kaderVan.set(uid, samen(kaderVan.get(uid), k)); kader = samen(kader, k); };
  for (const entry of teken || []) {
    if (!entry || typeof entry !== "object") continue;
    const tel = lijstSleutel(entry);
    const soort = soortVan?.get?.(tel) || kaartSoort(entry);
    if (uit.has(soort)) continue;
    const delen = vormVoor(entry, { geo });
    if (!delen) {
      if (!zonderGezien.has(tel)) { zonderGezien.add(tel); zonder.push(entry); }
      continue;
    }
    if (perSoortEntries[soort] >= max) continue;
    perSoortEntries[soort] += 1;
    getekend[soort].add(tel);
    if (soort === "agenda") {
      const [x, y] = delen[0].geometry.coordinates;
      metPunt.push({ item: entry, point: [x, y] });
      bewaarKader(entry.uid, [x, y, x, y]);
      continue;
    }
    for (const deel of delen) {
      features.push({ type: "Feature", geometry: deel.geometry, properties: { uid: entry.uid, tel, soort, cat: CAT[soort], parcours: Boolean(deel.parcours), ongeveer: Boolean(deel.ongeveer) } });
      bewaarKader(entry.uid, kaderVanGeometrie(deel.geometry));
    }
  }
  const pins = groupByPoint(metPunt).map((g) => ({ point: g.point, entries: g.items, uids: [...new Set(g.items.map((e) => e.uid))] }));
  const perSoort = Object.fromEntries(Object.entries(getekend).map(([s, set]) => [s, set.size]));
  const opKaart = new Set(Object.values(getekend).flatMap((set) => [...set])).size;
  return { fc: { type: "FeatureCollection", features }, pins, zonder, opKaart, perSoort, kaderVan, kader };
}

// De popup van een object of een pin: hoogstens POPUP_MAX kaartjes (één per telsleutel, de eerste datum), alle
// tekst geëscaped, met een knop naar het kaartje in de lijst (public-agenda:open, site/place-view.js).
export function popupHtml(entries = [], today = "") {
  const perSleutel = new Map();
  for (const e of entries || []) {
    if (!e) continue;
    const k = lijstSleutel(e), eerder = perSleutel.get(k);
    if (!eerder || String(e.start || "9999") < String(eerder.start || "9999")) perSleutel.set(k, e);
  }
  const uniek = [...perSleutel.values()].sort((a, b) => String(a.start || "9999").localeCompare(String(b.start || "9999")) || String(a.title).localeCompare(String(b.title), "nl"));
  const wanneer = (e) => {
    const datum = e.end && e.end > e.start ? kortBereik(e.start, e.end, today) : e.start ? kortDatum(e.start, today) : "";
    return [datum, e.time ? e.time.replace(":", ".") : ""].filter(Boolean).join(" · ");
  };
  const rijen = uniek.slice(0, POPUP_MAX).map((e) => {
    const regel = [wanneer(e), e.location].filter(Boolean).map(esc).join(" · ");
    const ongeveer = isOngeveer(e) ? `<br><small class="buurt-pop-ongeveer">Plek bij benadering (privacy)</small>` : "";
    return `<li><strong>${esc(e.title)}</strong>${regel ? `<br><small>${regel}</small>` : ""}${ongeveer}<br><button type="button" class="buurt-open" data-open-uid="${esc(e.uid)}">Toon in de lijst</button></li>`;
  });
  const meer = uniek.length > POPUP_MAX ? `<li><small>en nog ${uniek.length - POPUP_MAX} …</small></li>` : "";
  return `<div class="buurt-pop"><ul>${rijen.join("")}${meer}</ul></div>`;
}

// Een fout van MapLibre die betekent dat de vectortegels niet laden: alleen van de bron "openmaptiles" of met
// een URL van OpenFreeMap. Andere fouten ("Source layer … does not exist" zonder bron, een ontbrekend
// pictogram) laten de vectorkaart staan.
export function isTegelFout(e = {}) {
  if (e?.sourceId === "openmaptiles") return true;
  const url = String(e?.error?.url || e?.url || "");
  if (/^https?:\/\/[^/]*openfreemap\.org\//i.test(url)) return true;
  return /https?:\/\/[^\s/]*openfreemap\.org\//i.test(String(e?.error?.message || ""));
}

// Welke kaart: eerst de vectorkaart (als dat mag), met een wachttijd; lukt die niet of duurt ze te lang, dan de
// basiskaart (Leaflet). `vector(signal)` en `basis()` geven een belofte van een kaart. Komt de vectorkaart na de
// wachttijd toch nog, dan ruimen we ze op (verwijder) en blijft de basiskaart. Faalt ook de basis, dan faalt dit.
export async function kiesKaart({ magVector = false, vector = null, basis, wachttijd = 8000 } = {}) {
  if (magVector && typeof vector === "function") {
    const ctrl = new AbortController();
    let klok = null;
    const poging = Promise.resolve().then(() => vector(ctrl.signal));
    const teLaat = new Promise((_, weiger) => { klok = setTimeout(() => weiger(new Error(`vectorkaart niet klaar na ${wachttijd} ms`)), wachttijd); });
    try {
      return await Promise.race([poging, teLaat]);
    } catch {
      ctrl.abort();
      poging.then((kaart) => kaart?.verwijder?.(), () => {});
    } finally {
      clearTimeout(klok);
    }
  }
  return basis();
}
