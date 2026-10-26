// De buurtkaart in lagen (P9 "Een kaart die vertelt"): wat de kaart tekent, als GeoJSON, los van de kaart-
// bibliotheek. Puur: geen DOM, ook in Node te importeren (tests/kaart-lagen.test.mjs). Leaflet en MapLibre
// tekenen allebei uit wat hier staat (site/neighborhood-map.js).
//
// - De kaartjes komen uit de lijst (window.PUBLIC_AGENDA_KAART.teken, site/place-view.js); elk object op de
//   kaart is een kaartje van de lijst, met dezelfde soort, kleur en telsleutel (lijstSleutel).
// - Privacy: parkeerverboden, losse innames (ook die van een evenement: opbouw, afbraak, de parkeerverboden erbij) en
//   vergunningen staan op de kaart als één punt, het midden van hun kader afgerond op ONGEVEER_DECIMALEN (ongeveer
//   100 m), met "plek bij benadering". Werken, werfzones en omleidingen, en van een evenement ook het parcours en de
//   verkeersvrije zones (EVENEMENT_EXACT), staan exact op de kaart. Wie de rest toch exact wil tonen: één regel in
//   vormVoor().
// - Een plek bij benadering tekent de kaart als een vorm van ONGEVEER_STRAAL meter rond dat punt, met een eigen
//   vorm per soort (ONGEVEER_VORM): kleur is nooit de enige drager. Kaartjes op hetzelfde afgeronde punt horen bij
//   elkaar (`ongeveer` in kaartLagen): een tik op een van hun vormen noemt ze allemaal.
// - Een terras heeft geen vorm (terraces-live-core.js laat ze vallen): het staat in `zonder`.
import { groupByPoint, isPoint, itemPoint } from "./neighborhood-core.js";
import { KAART_SOORTEN, kaartSoort, kortBereik, kortDatum, lijstSleutel } from "./place-core.js";

export const ONGEVEER_DECIMALEN = 3;
// Een plek bij benadering op de kaart: een vorm van zoveel meter rond het afgeronde punt (geen punt: dat zou een
// plek beloven), per soort een eigen vorm. Een vergunning een ring, verkeer (parkeerverbod, losse inname) een
// vierkant, de innames van een evenement een ruit.
export const ONGEVEER_STRAAL = 60;
export const ONGEVEER_VORM = Object.freeze({ evenement: "ruit", verkeer: "vierkant", vergunning: "ring" });
// Van een evenement staan naast het parcours ook deze rijen exact op de kaart (innameType, A-Sign laag 22 en 23):
// verkeersmaatregelen van het evenement op de openbare weg, geen inname van een plek door iemand. Al de rest
// (parkeerverboden, "Inname", "Blokken op shot", een soort die de kaart niet kent) staat er bij benadering.
const EVENEMENT_EXACT = Object.freeze(["omleiding", "verkeersvrije zone"]);
const exactBijEvenement = (r) => EVENEMENT_EXACT.includes(String(r?.innameType || "").trim().toLowerCase());
// Zoveel kaartjes per soort tekent de kaart hoogstens zonder gekozen plek (het hele district, met werken aan: een
// district vol werken blijft vlot). Met een plek geen grens (neighborhood-map.js): de kaart toont alles van die plek,
// zoals de lijst. Meting op de echte feed van 12 oktober 2026: de drukste straat heeft hoogstens 45 kaartjes van één
// soort, postcode 2000 met de lagen van het hele district 1.232 vergunningen en 703 keer verkeer (meer dan 600).
export const MAX_PER_SOORT = 600;
export const kaartMax = (metPlek = false) => (metPlek ? Infinity : MAX_PER_SOORT);
const POPUP_MAX = 6;

const esc = (v = "") => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
const CAT = Object.freeze(Object.fromEntries(KAART_SOORTEN.map((s) => [s.key, s.cat])));
const rond = (x) => Number(x.toFixed(ONGEVEER_DECIMALEN));

// Een plek bij benadering: een parkeerverbod, een losse inname (geen evenement, geen werfzone) en een
// vergunning. Hangt alleen af van de soort, niet van de geometrie: de popup zegt het ook zonder vorm. (Van een
// evenement zijn de innames naast het parcours bij benadering: dat zegt vormVoor, zie popupHtml.)
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
// Het afgeronde midden van het kader van een vorm (een plek bij benadering), of null zonder vorm.
function middenBijBenadering(vorm) {
  const kader = kaderVanPunten(puntenVan(vorm));
  return kader ? [rond((kader[0] + kader[2]) / 2), rond((kader[1] + kader[3]) / 2)] : null;
}

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
    // Een werfkaart (samenWerven in place-core.js): ook de werfzone en de omleiding (exact, zoals een werfzone), en de
    // parkeerverboden bij benadering (een afgerond punt, zoals een los parkeerverbod).
    const vlakken = [], lijnen = [], ongeveer = new Map();
    for (const r of Array.isArray(entry.werfRijen) ? entry.werfRijen : []) {
      if (r?.kind === "sgw") { vlakken.push(...(r?.vorm?.vlakken || [])); lijnen.push(...(r?.vorm?.lijnen || [])); continue; }
      const p = middenBijBenadering(r?.vorm);
      if (p) ongeveer.set(`${p[0]},${p[1]}`, p);
    }
    const delen = [
      ...(punten.length ? [{ geometry: punten.length === 1 ? { type: "Point", coordinates: punten[0] } : { type: "MultiPoint", coordinates: punten }, ...exact }] : []),
      ...vlakDeel(vlakken, exact), ...lijnDeel(lijnen, exact),
      ...(ongeveer.size ? [{ geometry: ongeveer.size === 1 ? { type: "Point", coordinates: [...ongeveer.values()][0] } : { type: "MultiPoint", coordinates: [...ongeveer.values()] }, parcours: false, ongeveer: true }] : []),
    ];
    return delen.length ? delen : null;
  }
  if (soort === "evenement") {
    // Het hele dossier, ook buiten de gekozen plek. Exact: het parcours (parcours=true; zonder live vorm de schets
    // van de verversing), en de omleidingen en verkeersvrije zones (EVENEMENT_EXACT). De andere innames (opbouw,
    // afbraak, de parkeerverboden van het evenement) zijn zoals elk parkeerverbod en elke losse inname: één punt per
    // inname, het midden van haar kader afgerond, bij benadering (privacy). Innames op hetzelfde afgeronde punt zijn
    // één punt.
    const parcours = { lijnen: [], vlakken: [] }, verkeer = { lijnen: [], vlakken: [] }, punten = new Map();
    for (const r of rijenVan(entry)) {
      if (r?.parcours) {
        parcours.lijnen.push(...(r.parcours.lijnen || []));
        parcours.vlakken.push(...(r.parcours.vlakken || []));
        continue;
      }
      if (exactBijEvenement(r)) {
        verkeer.lijnen.push(...(r?.vorm?.lijnen || []));
        verkeer.vlakken.push(...(r?.vorm?.vlakken || []));
        continue;
      }
      const p = middenBijBenadering(r?.vorm);
      if (p) punten.set(`${p[0]},${p[1]}`, p);
    }
    const lijn = { ...exact, parcours: true };
    let delen = [...vlakDeel(parcours.vlakken, lijn), ...lijnDeel(parcours.lijnen, lijn)];
    if (!delen.length) delen = lijnDeel(Array.isArray(entry.kaart) ? entry.kaart : [], lijn);
    delen.push(...vlakDeel(verkeer.vlakken, exact), ...lijnDeel(verkeer.lijnen, exact));
    const ongeveer = [...punten.values()];
    if (ongeveer.length) delen.push({ geometry: ongeveer.length === 1 ? { type: "Point", coordinates: ongeveer[0] } : { type: "MultiPoint", coordinates: ongeveer }, parcours: false, ongeveer: true });
    return delen.length ? delen : null;
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
    const p = middenBijBenadering(entry.item?.vorm || rijenVan(entry).find((r) => r?.vorm)?.vorm);
    return p ? [{ geometry: { type: "Point", coordinates: p }, parcours: false, ongeveer: true }] : null;
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

// De vorm van een plek bij benadering: ONGEVEER_STRAAL meter rond het afgeronde punt, per soort een eigen vorm
// (ONGEVEER_VORM). Alleen uit het afgeronde punt berekend: geen enkele oorspronkelijke coördinaat.
export function ongeveerPolygoon([x, y], soort, meter = ONGEVEER_STRAAL) {
  const dy = meter / 111320, dx = meter / (111320 * Math.cos((y * Math.PI) / 180));
  const vorm = ONGEVEER_VORM[soort] || "ring";
  let hoeken;
  if (vorm === "vierkant") hoeken = [[x - dx, y - dy], [x + dx, y - dy], [x + dx, y + dy], [x - dx, y + dy]];
  // Een ruit: een vierkant op zijn punt, iets groter, zodat ze even zwaar weegt als het vierkant.
  else if (vorm === "ruit") hoeken = [[x, y - dy * 1.3], [x + dx * 1.3, y], [x, y + dy * 1.3], [x - dx * 1.3, y]];
  else hoeken = Array.from({ length: 32 }, (_, i) => [x + dx * Math.cos((i * Math.PI) / 16), y + dy * Math.sin((i * Math.PI) / 16)]);
  return { type: "Polygon", coordinates: [[...hoeken, hoeken[0]]] };
}

// De plekken bij benadering, per afgerond punt en per soort: één vorm, met de kaartjes van die soort (`uids`) en
// alle kaartjes op dat punt, van elke soort (`samen`). Een tik op een vorm noemt ze allemaal, ook als een andere
// vorm erover ligt (Leaflet tekent paden op elkaar; alleen het bovenste vangt de tik).
function ongeveerGroepen(features) {
  const perPunt = new Map();
  const erbij = (lijst, uid) => { if (!lijst.includes(uid)) lijst.push(uid); };
  for (const f of features) {
    if (!f.properties.ongeveer) continue;
    const g = f.geometry;
    for (const p of g.type === "Point" ? [g.coordinates] : g.type === "MultiPoint" ? g.coordinates : []) {
      const sleutel = `${p[0]},${p[1]}`;
      if (!perPunt.has(sleutel)) perPunt.set(sleutel, { point: [p[0], p[1]], perSoort: new Map(), samen: [] });
      const plek = perPunt.get(sleutel);
      if (!plek.perSoort.has(f.properties.soort)) plek.perSoort.set(f.properties.soort, []);
      erbij(plek.perSoort.get(f.properties.soort), f.properties.uid);
      erbij(plek.samen, f.properties.uid);
    }
  }
  return [...perPunt.values()].flatMap((plek) => [...plek.perSoort].map(([soort, uids]) => ({
    point: plek.point, soort, cat: CAT[soort], vorm: ONGEVEER_VORM[soort] || "ring", uids, samen: plek.samen, geometry: ongeveerPolygoon(plek.point, soort),
  })));
}

// Alles wat de kaart tekent. `teken`: de kaartjes (PUBLIC_AGENDA_KAART.teken); `soortVan`: telsleutel → soort
// uit de telling van de lijst (telPerSoort), zodat kaart en legenda dezelfde soort geven; `verborgen`: de
// soorten die de legenda uitzette (alleen de kaart, de lijst blijft volledig). Geeft:
// - fc: een FeatureCollection; elke feature heeft precies { uid, tel, soort, cat, parcours, ongeveer };
// - pins: de agendapunten per plek ({ point, entries, uids }), met hun eigen categorie (entry.theme);
// - zonder: de kaartjes zonder plek op de kaart (één per telsleutel);
// - opKaart en perSoort: hoeveel kaartjes (telsleutels) getekend zijn, in totaal en per soort;
// - kaderVan (uid → [w, z, o, n]) en kader: voor inzoomen en markeren;
// - ongeveer: de plekken bij benadering per afgerond punt en soort ({ point, soort, cat, vorm, uids, samen,
//   geometry }), de vormen die de kaart tekent in plaats van die punten.
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
  return { fc: { type: "FeatureCollection", features }, pins, zonder, opKaart, perSoort, kaderVan, kader, ongeveer: ongeveerGroepen(features) };
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
  // Wanneer: de dagen, en de uren zoals de kaart ze zegt (timeText: "van 8.00 tot 18.00 uur, alleen op weekdagen"); alleen
  // zonder die tekst het beginuur. Nakijkronde van 18 oktober 2026: een parkeerverbod zei hier "12 mrt · 08.00" (zonder
  // einduur) of bij meer dagen geen uren, terwijl de kaart "van 8.00 tot 18.00 uur" zegt.
  const wanneer = (e) => {
    const datum = e.end && e.end > e.start ? kortBereik(e.start, e.end, today) : e.start ? kortDatum(e.start, today) : "";
    const uren = e.item?.kind === "parking" && e.timeText ? e.timeText : e.time ? e.time.replace(":", ".") : "";
    return [datum, uren].filter(Boolean).join(" · ");
  };
  // Bij benadering: een parkeerverbod, een losse inname of een vergunning; van een evenement de innames naast het
  // parcours, de omleidingen en de verkeersvrije zones (kijk naar de delen van de vorm, niet alleen naar de soort).
  const benadering = (e) => {
    const delen = vormVoor(e) || [];
    if (!isOngeveer(e) && !delen.some((d) => d.ongeveer)) return "";
    return delen.some((d) => !d.ongeveer) ? "Parcours, omleidingen en verkeersvrije zones exact; parkeerverboden en andere innames bij benadering (privacy)" : "Plek bij benadering (privacy)";
  };
  const rijen = uniek.slice(0, POPUP_MAX).map((e) => {
    const regel = [wanneer(e), e.location].filter(Boolean).map(esc).join(" · ");
    const tekst = benadering(e);
    const ongeveer = tekst ? `<br><small class="buurt-pop-ongeveer">${tekst}</small>` : "";
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

// Mag de vectorkaart? Niet met ?kaart=leaflet (`kaart`), niet met databesparing, niet op een trage verbinding (de
// browser schat ze lager dan "4g": stijl, MapLibre van 1 MB, tilejson, tegels en letters halen de wachttijd daar
// niet, en dan downloadt de bewoner beide kaarten) en niet zonder WebGL. `verbinding`: navigator.connection (bestaat
// niet in elke browser; dan telt alleen WebGL). `webgl()` maakt een proefcanvas: pas als de rest het toelaat.
export function magVectorKaart({ kaart = "", verbinding = null, webgl = () => false } = {}) {
  if (kaart === "leaflet") return false;
  if (verbinding?.saveData) return false;
  if (verbinding?.effectiveType && verbinding.effectiveType !== "4g") return false;
  return Boolean(webgl());
}

// Welke kaart: eerst de vectorkaart (als dat mag), met een wachttijd; lukt die niet of duurt ze te lang, dan de
// basiskaart (Leaflet). `vector(signal, { voortgang, bijnaKlaar })` en `basis()` geven een belofte van een kaart.
// Komt de vectorkaart na de wachttijd toch nog, dan ruimen we ze op (verwijder) en blijft de basiskaart. Faalt ook de
// basis, dan faalt dit.
// - `voortgang()`: een stap is binnen (de stijl, MapLibre). Zolang de vectorkaart zo aantoonbaar vordert, krijgt de
//   volgende stap opnieuw `wachttijd` ms, tot hoogstens `maxWacht` ms in totaal: een trage maar werkende verbinding
//   (ook in Safari en Firefox, die de browser niet laten schatten: magVectorKaart) downloadt dan niet beide kaarten.
// - `bijnaKlaar()`: de eerste tegel is binnen. Een kaart die zo ver is, gooien we niet op de klok weg terwijl ze haar
//   letters en de rest van de tegels haalt: ze krijgt één keer nog `nawacht` ms, ook voorbij `maxWacht`.
export async function kiesKaart({ magVector = false, vector = null, basis, wachttijd = 8000, nawacht = wachttijd, maxWacht = 2 * wachttijd } = {}) {
  if (magVector && typeof vector === "function") {
    const ctrl = new AbortController();
    let klok = null, grens = null, weiger = null, verlengd = false;
    const teLaat = new Promise((_, nee) => { weiger = nee; });
    const stop = () => weiger(new Error("vectorkaart niet op tijd klaar"));
    const zetKlok = (ms) => { clearTimeout(klok); klok = setTimeout(stop, ms); };
    const voortgang = () => { if (!verlengd && !ctrl.signal.aborted) zetKlok(wachttijd); };
    const bijnaKlaar = () => { if (!verlengd && !ctrl.signal.aborted) { verlengd = true; clearTimeout(grens); zetKlok(nawacht); } };
    zetKlok(wachttijd);
    grens = setTimeout(stop, Math.max(maxWacht, wachttijd));
    const poging = Promise.resolve().then(() => vector(ctrl.signal, { voortgang, bijnaKlaar }));
    try {
      return await Promise.race([poging, teLaat]);
    } catch {
      ctrl.abort();
      poging.then((kaart) => kaart?.verwijder?.(), () => {});
    } finally {
      clearTimeout(klok);
      clearTimeout(grens);
    }
  }
  return basis();
}
