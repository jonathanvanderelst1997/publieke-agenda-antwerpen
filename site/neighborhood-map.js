// Buurtkaart: kies een wijk (officiële wijkgrenzen van stad Antwerpen) of tik op de kaart, en zie de
// agenda, werken en hinder in jouw buurt. Alleen presentatie: de items, bronnen en publicatieregels
// komen ongewijzigd uit agenda.js en de live lagen.
//
// - Wat de kaart tekent, komt uit de lijst van het plekoverzicht (window.PUBLIC_AGENDA_KAART, place-view.js):
//   elk object op de kaart is een kaartje van de lijst, in de kleur van zijn rij. De pure laag (vormen,
//   privacy, popup) staat in kaart-lagen.js.
// - Twee kaarten met dezelfde adapter: als het kan een vectorkaart (MapLibre + OpenFreeMap, kaart-vector.js,
//   alleen dynamisch geladen), anders Leaflet met rastertegels van OpenStreetMap (maakLeafletKaart hieronder).
//   kiesKaart (kaart-lagen.js) kiest; ?kaart=leaflet in de link dwingt Leaflet af.
// - Wijken: site/geo/wijken.geo.json (vereenvoudigd, met bron en licentie in "metadata").
// - Punten: werken hebben hun GIPOD-punt; agendapunten krijgen het hunne bij het verversen
//   (site/geo/locaties.json, scripts/geocode-locations.mjs). De browser geocodeert nooit zelf.
// - Items zonder plek staan in een lijst onder de kaart, nooit als gegokte marker.
// - De legenda (vijf soorten, KAART_SOORTEN in place-core.js) toont of verbergt een soort op de kaart; de lijst
//   blijft altijd volledig. Ze staat er ook als de kaart niet laadt. Haar getallen tellen wat er op deze plek is
//   (zoals het getal boven de lijst); "in de lijst" zegt alleen de zin eronder, met wat de lijst nu echt toont.
// - Straat en markering in de inkt van de onderkaart die je echt ziet (--kaart-inkt, data-onderkaart), niet in die
//   van het thema: de tegels van OpenStreetMap blijven licht, ook in donkere modus.
// - De kaartbibliotheek en de tegels worden pas geladen als de kaart in beeld komt en de browser even niets te
//   doen heeft; met databesparing alleen op vraag (de knop, of "Toon op de kaart"), en dan altijd Leaflet.
import {
  RADIUS_OPTIONS,
  bboxOf,
  itemPoint,
  nearSegments,
  streetSegments,
  streetWijkMap,
  vormBinnenStraal,
  streetsInWijk,
  wijkFeatures,
} from "./neighborhood-core.js";
import { pointInGeometry } from "./works-core.js";
import { KAART_SOORTEN, kaartSoort, kortBereik, kortDatum, lijstSleutel } from "./place-core.js";
import { ONGEVEER_VORM, kaartLagen, kaartMax, kiesKaart, magVectorKaart, popupHtml } from "./kaart-lagen.js";

// Ook voor de toetsen: de e2e serveren Leaflet byte-exact uit tests/fixtures/kaart/ (tests/helpers/kaart-fixture.mjs).
export const LEAFLET = Object.freeze({
  css: { href: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css", integrity: "sha512-Zcn6bjR/8RZbLEpLIeOwNtzREBAJnUKESxces60Mpoj+2okopSAcSUIUOseddDm0cxnGQzxIR7vJgsLZbdLE3w==" },
  js: { src: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js", integrity: "sha512-BwHfrr4c9kmRkLw6iXFdzcdWV/PGkVgiIyIWLLlTSXzWQzxuSg4DiQUCpauz/EWjgk5TYQqX/kvn9pG1NpYfqg==" },
});
const TILES = Object.freeze({
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>-bijdragers',
});
const DISTRICT_PREFIX = "ANT";
// Zo ver zoomt de kaart hoogstens in op één kaartje (Leaflet; de vectorkaart één stap minder).
const MARKEER_ZOOM = 17;
const ZONDER_MAX = 40;
const GEEN_PLEK = "Dit kaartje heeft (nog) geen plek op de kaart.";
// Als er geen wijkgrenzen zijn: ruwweg de binnenstad, zodat de kaart toch een beeld heeft.
const ANTWERPEN = Object.freeze([4.38, 51.19, 4.44, 51.24]);
// Een pictogram per soort voor de lijst "zonder vaste plek" (agendapunten: dat van hun categorie).
const SOORT_EMOJI = Object.freeze({ evenement: "🎉", werken: "🚧", verkeer: "🚦", vergunning: "📄", agenda: "📌" });

const esc = (v = "") => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
const radiusLabel = (r) => (r >= 1000 ? `${r / 1000} km` : `${r} m`);
const geldigKader = (k) => Array.isArray(k) && k.length === 4 && k.every(Number.isFinite);

function brusselsToday() {
  const now = typeof window.PUBLIC_AGENDA_CLOCK === "function" ? window.PUBLIC_AGENDA_CLOCK() : new Date();
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// Een agendapunt openen: in het plekoverzicht als dat er is, anders in de klassieke agendalijst.
function openItem(id) {
  if (typeof window.PUBLIC_AGENDA_OPEN === "function") window.PUBLIC_AGENDA_OPEN(id);
  else if (typeof window.openAgendaItem === "function") window.openAgendaItem(id);
}

async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function loadLeaflet() {
  if (window.L?.map) return Promise.resolve(window.L);
  if (loadLeaflet.promise) return loadLeaflet.promise;
  loadLeaflet.promise = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    Object.assign(css, { rel: "stylesheet", href: LEAFLET.css.href, integrity: LEAFLET.css.integrity, crossOrigin: "anonymous", referrerPolicy: "no-referrer" });
    const script = document.createElement("script");
    Object.assign(script, { src: LEAFLET.js.src, integrity: LEAFLET.js.integrity, crossOrigin: "anonymous", referrerPolicy: "no-referrer", async: true });
    script.onload = () => (window.L?.map ? resolve(window.L) : reject(new Error("Leaflet ontbreekt")));
    script.onerror = () => { loadLeaflet.promise = null; reject(new Error("Leaflet kon niet laden")); };
    document.head.append(css, script);
  });
  return loadLeaflet.promise;
}

// De matcher die agenda-view.js gebruikt voor "in deze wijk" en "binnen de straal van je straat".
// `straal`: of de straatassen voor de straal er zijn ("klaar"), nog komen ("laadt") of niet laadden
// ("mislukt"); de plekpagina zegt het dan (site/straat-snapshot.js, standZin).
export function createAreaMatcher({ wijken, geo, streetIndex = null, straatasMislukt = false }) {
  const byCode = new Map(wijken.map((f) => [f.properties.code, f]));
  const streetMap = streetIndex ? streetWijkMap(streetIndex, wijken) : null;
  const segmentCache = new Map();
  const straalCache = new WeakMap(); // item → Map("straat|straal" → ja/nee)
  return {
    straal: streetIndex ? "klaar" : straatasMislukt ? "mislukt" : "laadt",
    labelFor: (code) => byCode.get(code)?.properties.naam || code,
    inWijk(item, code, refs = []) {
      const feature = byCode.get(code);
      if (!feature) return true;
      const point = itemPoint(item, geo);
      if (point) return pointInGeometry(point, feature.geometry);
      return streetsInWijk(refs, code, streetMap);
    },
    // Met een punt (GIPOD, geocodering): ligt het punt binnen de straal. Zonder punt: ligt de eigen vorm
    // van het item (perceel, parkeerverbod, inname, parcours, werfzone) binnen de straal. Zonder punt en
    // zonder vorm (een terras, een item uit de historiek): alleen in de straat zelf.
    nearStreet(item, street, radius) {
      if (!streetIndex || !item || typeof item !== "object") return false;
      const key = `${street.id}|${street.name}|${street.postcode}`;
      if (!segmentCache.has(key)) segmentCache.set(key, streetSegments(streetIndex, street));
      const point = itemPoint(item, geo);
      if (point) return nearSegments(point, segmentCache.get(key), radius);
      if (!item.vorm) return false;
      let perItem = straalCache.get(item);
      if (!perItem) { perItem = new Map(); straalCache.set(item, perItem); }
      const straalKey = `${key}|${radius}`;
      if (!perItem.has(straalKey)) perItem.set(straalKey, vormBinnenStraal(item.vorm, segmentCache.get(key), radius));
      return perItem.get(straalKey);
    },
    segmentsFor(street) {
      if (!streetIndex || !street) return [];
      const key = `${street.id}|${street.name}|${street.postcode}`;
      if (!segmentCache.has(key)) segmentCache.set(key, streetSegments(streetIndex, street));
      return segmentCache.get(key);
    },
  };
}

// Hoeveel kaarten van de lijst de getekende werken zijn: een werf in stukken heeft een punt per stuk, maar
// is één kaart (werkEntries en werfPerStuk in place-core.js). Zonder die indeling telt elk werk apart.
export function werkKaarten(werken = [], werfPerStuk = null) {
  return new Set(werken.map((w) => String(werfPerStuk?.[w?.gipodId] ?? w?.gipodId))).size;
}

// De zin onder de kaart. Met een gekozen plek en een lijst (de maand heeft er geen): "X in de lijst, Y op
// de kaart", zodat een kortere kaart niet als een fout leest. Allebei op dezelfde manier geteld: een
// agendapunt per activiteit, een werk per kaart van de lijst. X is wat de lijst echt toont (place-view.js),
// Y wat de kaart tekent.
// De buurtkaart (P9) geeft wat ze tekende per soort mee (kaartLagen in kaart-lagen.js): `opKaart` (alle
// getekende kaartjes), `werkenGetekend` (werken en verkeershinder) en `ander` (evenementen op straat en
// vergunningen). Zonder die getallen telt de zin de werken zelf (`werken`, `werfPerStuk`).
// `lijstItems`: hoeveel items die regels samen zijn (een ingeklapte regel "4 terrassen" is 4 items, lijstTelling in
// place-core.js). Verschilt dat van het aantal regels, dan zegt de zin beide, in de eenheid van het getal boven de lijst
// ("N items uit officiële bronnen"): anders stonden er twee getallen voor dezelfde lijst (nakijkronde 13 oktober 2026:
// "49 items uit officiële bronnen" boven de lijst en "21 in de lijst" onder de kaart).
// `werkenMislukt`: de werken laadden niet (live.failed). Dan geen "werken en hinder worden geladen…" (dat bleef anders
// eeuwig staan) en geen verzonnen "0 werken en hinder", zonder te zeggen dat iets faalt (besluit van 18-10-2026).
export function kaartStatusZin({ where = "", mapped = 0, without = 0, werken = [], werfPerStuk = null, werkenGetekend = null, ander = 0, opKaart = null, werkenAan = false, werkenGeladen = false, werkenMislukt = false, metPlek = false, lijstAantal = null, lijstItems = null } = {}) {
  const metWerken = werkenAan && werkenGeladen;
  const works = Number.isInteger(werkenGetekend) ? werkenGetekend : werkKaarten(werken, werfPerStuk);
  const totaal = Number.isInteger(opKaart) ? opKaart : mapped + (metWerken ? works : 0) + ander;
  const inLijst = Number.isInteger(lijstItems) && lijstItems !== lijstAantal
    ? `${lijstAantal} ${lijstAantal === 1 ? "regel" : "regels"} in de lijst (samen ${lijstItems} ${lijstItems === 1 ? "item" : "items"})`
    : `${lijstAantal} in de lijst`;
  const parts = Number.isInteger(lijstAantal) && metPlek
    ? [`${inLijst}, ${totaal} op de kaart in ${where}`]
    : [
      `${mapped} agendapunt${mapped === 1 ? "" : "en"} op de kaart in ${where}`,
      ...(metWerken || (Number.isInteger(werkenGetekend) && works > 0) ? [`${works} werken en hinder`] : []),
      ...(ander > 0 ? [ander === 1 ? "1 evenement of vergunning" : `${ander} evenementen en vergunningen`] : []),
    ];
  if (werkenAan && !werkenGeladen && !werkenMislukt) parts.push("werken en hinder worden geladen…");
  // Wat zonder vaste plek is, telt (zoals "op de kaart" en de legenda) wat er hier is, niet wat de lijst nu toont:
  // "hier", zodat het niet leest als een deel van "X in de lijst".
  if (without) parts.push(`${without} hier zonder vaste plek`);
  return `${parts.join(" · ")}.`;
}

// ---- tekenen, voor beide kaarten (Leaflet hier, MapLibre in kaart-vector.js) ----

// Wijkgrenzen: de gekozen wijk in de accentkleur, de andere gestippeld en gedimd.
export function wijkStijl(code, actief = "") {
  const aan = actief === code, dim = Boolean(actief) && !aan;
  return { color: aan ? "#b4361b" : "#5b6470", weight: aan ? 3 : 1, opacity: dim ? 0.35 : 0.8, fillColor: "#b4361b", fillOpacity: aan ? 0.08 : 0.02, dashArray: aan ? null : "3 4" };
}

// Het kader van het district zonder de haven (ANT08): anders zoomt de kaart te ver uit voor de woonwijken.
function districtKader(wijken = []) {
  let k = null;
  for (const f of wijken) {
    if (f.properties.code === "ANT08") continue;
    const b = bboxOf(f.geometry);
    if (geldigKader(b)) k = k ? [Math.min(k[0], b[0]), Math.min(k[1], b[1]), Math.max(k[2], b[2]), Math.max(k[3], b[3])] : b;
  }
  return k;
}

// Kleuren uit de CSS, geen eigen hex-waarden: --cat van een verborgen <i class="cat-…"> per soort (dezelfde
// kleur als de rij in de lijst); de gekozen straat en de markering in --kaart-inkt met --kaart-inkt-rand eronder,
// gelezen op de kaart zelf (`kaartEl`): die volgen de onderkaart (data-onderkaart), niet het thema van de site.
export function kleurenUitCss(root, kaartEl = root) {
  const lees = (el, naam) => (el ? getComputedStyle(el).getPropertyValue(naam).trim() : "");
  const kleuren = { rand: "white", straat: lees(kaartEl, "--kaart-inkt") || "currentColor", straatRand: lees(kaartEl, "--kaart-inkt-rand") || "white" };
  for (const s of KAART_SOORTEN) kleuren[s.key] = lees(root.querySelector(`.buurt-kleuren .cat-${s.cat}`), "--cat") || "gray";
  return kleuren;
}

// De categorie van een agendapin (kleur en emoji uit agenda-uitgaan.js).
function categorie(entry = {}) {
  return window.PublicAgendaUitgaan?.categoryFor?.(entry.theme || entry.item?.category) || { key: "other", emoji: "📍", label: "Agenda" };
}
export function pinHtml(entries = []) {
  const cat = categorie(entries[0]), n = new Set(entries.map(lijstSleutel)).size;
  return `<span class="buurt-pin cat-${esc(cat.key)}"><span aria-hidden="true">${esc(cat.emoji)}</span>${n > 1 ? `<b>${n}</b>` : ""}</span>`;
}
// De naam van een pin voor een schermlezer: de eerste titel, en hoeveel er nog zijn.
export function pinNaam(entries = []) {
  const titels = [...new Set(entries.map((e) => e.title).filter(Boolean))];
  return titels.length > 1 ? `${titels[0]} en nog ${titels.length - 1}` : titels[0] || "Agendapunt";
}

// De stijl van een object op de Leaflet-kaart: de kleur van de soort, en een eigen vorm per soort (kleur is
// nooit de enige drager): evenement een volle lijn, werken een stip, verkeer een streeplijn of gestreept vlak.
// Een plek bij benadering (ONGEVEER_VORM): een vergunning een gestippelde ring, verkeer een gestreept vierkant, de
// innames van een evenement een ruit met een volle rand. De klassen laten toetsen en CSS de objecten vinden.
const ONGEVEER_RAND = Object.freeze({ ring: "1 6", vierkant: "8 6", ruit: null });
function objStijl(p = {}, kleuren = {}) {
  const kleur = kleuren[p.soort] || "gray";
  const vorm = p.ongeveer ? ONGEVEER_VORM[p.soort] || "ring" : "";
  const className = ["kaart-obj", `kaart-${p.soort}`, p.parcours ? "kaart-parcours" : "", p.ongeveer ? `kaart-ongeveer kaart-${vorm}` : ""].filter(Boolean).join(" ");
  if (p.ongeveer) return { className, color: kleur, weight: vorm === "ring" ? 3 : 2.5, opacity: 1, dashArray: ONGEVEER_RAND[vorm], lineCap: "round", lineJoin: "round", fillColor: kleur, fillOpacity: 0.12 };
  if (p.soort === "werken") return { className, radius: 7, color: kleuren.rand || "white", weight: 2, opacity: 1, fillColor: kleur, fillOpacity: 0.95 };
  return { className, color: kleur, weight: p.parcours ? 5 : 4, opacity: 0.95, fillColor: kleur, fillOpacity: 0.16, dashArray: p.soort === "verkeer" ? "8 6" : null, lineCap: "round", lineJoin: "round" };
}

// De basiskaart: Leaflet met rastertegels van OpenStreetMap, in een eigen vlak binnen `el`. Geeft de adapter
// die drawAll gebruikt (dezelfde vorm als de vectorkaart in kaart-vector.js):
// { soort, onderkaart, wijken(actief), straat(segmenten, kleur, rand), items({lagen, entryVan, kleuren, today}),
//   markeer(uid) → gevonden, kader([w, z, o, n], {animate, maxZoom}), inBeeld([w, z, o, n]), verwijder() }.
// `onderkaart`: de tegels van OpenStreetMap zijn licht (in donkere modus alleen gedimd).
export function maakLeafletKaart(L, el, { wijken = [], onWijk = () => {} } = {}) {
  const vlak = document.createElement("div");
  vlak.className = "buurt-kaartvlak";
  el.append(vlak);
  const naarBounds = (k) => L.latLngBounds([[k[1], k[0]], [k[3], k[2]]]);
  const map = L.map(vlak, { scrollWheelZoom: false, preferCanvas: true, zoomSnap: 0.5, attributionControl: true });
  map.attributionControl.setPrefix(false);
  // Nog geen beeld: het eerste kader (drawAll, focusArea) zet het. Zo vraagt de kaart alleen de tegels van wat
  // je ziet, niet eerst ook die van het hele district.
  L.tileLayer(TILES.url, { maxZoom: 19, attribution: TILES.attribution, referrerPolicy: "strict-origin-when-cross-origin" }).addTo(map);
  // Wijken en de straat op het canvas (snel); de objecten van de lijst als SVG-paden met een klasse per soort.
  const svg = L.svg({ padding: 0.5 });
  const wijkLaag = L.geoJSON({ type: "FeatureCollection", features: wijken }, {
    style: (f) => wijkStijl(f.properties.code),
    onEachFeature: (f, layer) => {
      layer.bindTooltip(esc(f.properties.naam), { sticky: true, direction: "top", className: "buurt-tip" });
      layer.on("click", () => onWijk(f.properties.code));
    },
  }).addTo(map);
  const straatLaag = L.layerGroup().addTo(map);
  const randLaag = L.layerGroup().addTo(map);
  const objLaag = L.layerGroup().addTo(map);
  const pinLaag = L.layerGroup().addTo(map);
  // Elk getekend object met de kaartjes die het toont (een plek bij benadering kan er meer hebben).
  let objecten = [], pinnen = [];
  const elementen = (layer) => (layer.getLayers ? layer.getLayers() : [layer]).map((l) => l.getElement?.()).filter(Boolean);
  const popupOpties = { maxWidth: 280, autoPanPadding: [16, 16] };
  const naarLatLng = (ring) => ring.slice(0, -1).map(([x, y]) => [y, x]);
  return {
    soort: "leaflet",
    onderkaart: "licht",
    wijken(actief = "") { wijkLaag.setStyle((f) => wijkStijl(f.properties.code, actief)); },
    // De gekozen straat: een pad met een klasse (zoals de objecten), met een rand eronder die bij de onderkaart past.
    straat(segmenten = [], kleur = "currentColor", rand = "white") {
      straatLaag.clearLayers();
      for (const [className, color, weight] of [["kaart-straat-rand", rand, 10], ["kaart-straat", kleur, 6]]) {
        for (const s of segmenten) L.polyline([[s.a[1], s.a[0]], [s.b[1], s.b[0]]], { renderer: svg, className, color, weight, opacity: 0.9, lineCap: "round", interactive: false }).addTo(straatLaag);
      }
    },
    items({ lagen, entryVan = new Map(), kleuren = {}, today = "" }) {
      randLaag.clearLayers(); objLaag.clearLayers(); pinLaag.clearLayers();
      objecten = []; pinnen = [];
      const exact = lagen.fc.features.filter((f) => !f.properties.ongeveer);
      // Een witte rand onder de lijnen, zodat ze op elke tegel leesbaar blijven.
      const lijnen = exact.filter((f) => /LineString$/.test(f.geometry.type));
      L.geoJSON({ type: "FeatureCollection", features: lijnen }, {
        renderer: svg, interactive: false,
        style: (f) => ({ className: "kaart-rand", color: kleuren.rand || "white", weight: objStijl(f.properties).weight + 4, opacity: 0.9, lineCap: "round", lineJoin: "round" }),
      }).addTo(randLaag);
      const stijl = (f) => objStijl(f.properties, kleuren);
      const geoLaag = (features) => L.geoJSON({ type: "FeatureCollection", features }, {
        renderer: svg,
        style: stijl,
        pointToLayer: (f, latlng) => L.circleMarker(latlng, { renderer: svg, ...stijl(f) }),
        onEachFeature: (f, layer) => {
          objecten.push({ layer, uids: new Set([f.properties.uid]) });
          layer.bindPopup(() => popupHtml([entryVan.get(f.properties.uid)].filter(Boolean), today), popupOpties);
        },
      }).addTo(objLaag);
      // Vlakken onderaan, dan lijnen, dan de plekken bij benadering, en de werken bovenaan: een stip blijft aantikbaar.
      geoLaag(exact.filter((f) => /Polygon$/.test(f.geometry.type)));
      geoLaag(lijnen);
      // Een plek bij benadering: één vorm per afgerond punt en soort (ring, vierkant of ruit; de ring bovenaan, het
      // vierkant eronder steekt er in de hoeken uit). Een tik noemt alle kaartjes op dat punt (`samen`).
      const orde = { vierkant: 0, ruit: 1, ring: 2 };
      for (const g of [...(lagen.ongeveer || [])].sort((a, b) => orde[a.vorm] - orde[b.vorm])) {
        const layer = L.polygon(naarLatLng(g.geometry.coordinates[0]), { renderer: svg, ...objStijl({ soort: g.soort, ongeveer: true }, kleuren) })
          .bindPopup(() => popupHtml(g.samen.map((u) => entryVan.get(u)).filter(Boolean), today), popupOpties)
          .addTo(objLaag);
        objecten.push({ layer, uids: new Set(g.uids) });
      }
      geoLaag(exact.filter((f) => /Point$/.test(f.geometry.type)));
      for (const pin of lagen.pins) {
        const icon = L.divIcon({ className: "buurt-pin-wrap", html: pinHtml(pin.entries), iconSize: [38, 38], iconAnchor: [19, 36], popupAnchor: [0, -32] });
        const marker = L.marker([pin.point[1], pin.point[0]], { icon, title: pinNaam(pin.entries), riseOnHover: true, keyboard: true })
          .bindPopup(() => popupHtml(pin.entries, today), popupOpties)
          .addTo(pinLaag);
        pinnen.push({ marker, uids: new Set(pin.uids) });
      }
    },
    markeer(uid = "") {
      let gevonden = false;
      for (const { layer, uids } of objecten) {
        const aan = Boolean(uid) && uids.has(uid);
        for (const node of elementen(layer)) node.classList.toggle("is-gemarkeerd", aan);
        if (aan) { gevonden = true; layer.bringToFront?.(); }
      }
      for (const { marker, uids } of pinnen) {
        const aan = Boolean(uid) && uids.has(uid);
        marker.getElement()?.classList.toggle("is-gemarkeerd", aan);
        marker.setZIndexOffset(aan ? 1000 : 0);
        if (aan) gevonden = true;
      }
      return gevonden;
    },
    kader(k, { animate = true, maxZoom } = {}) {
      if (!geldigKader(k)) return;
      map.fitBounds(naarBounds(k), { padding: [16, 16], animate, ...(maxZoom ? { maxZoom } : {}) });
    },
    inBeeld(k) { return geldigKader(k) && map.getBounds().intersects(naarBounds(k)); },
    verwijder() { map.remove(); vlak.remove(); },
  };
}

export async function mountNeighborhoodMap(view) {
  if (typeof document === "undefined" || document.getElementById("buurtkaart") || !view) return;
  const anchor = document.getElementById("agenda-highlights") || document.querySelector(".agenda-controls");
  if (!anchor) return;
  const section = document.createElement("section");
  section.id = "buurtkaart";
  section.className = "buurt";
  section.setAttribute("aria-labelledby", "buurt-title");
  section.innerHTML = `
    <div class="buurt-head">
      <div class="buurt-intro">
        <span class="buurt-kicker"><span aria-hidden="true">🗺️</span> In jouw buurt</span>
        <h2 id="buurt-title">Wat gebeurt er rond jou?</h2>
        <p>Kies je wijk of tik op de kaart. Met een straat erbij zie je ook wat er net om de hoek gebeurt.</p>
      </div>
      <div class="buurt-controls">
        <label class="buurt-label" for="buurt-wijk">Wijk</label>
        <select id="buurt-wijk" class="buurt-select" disabled><option value="">Hele district Antwerpen</option></select>
        <div class="buurt-radius" role="group" aria-label="Straal rond je straat" hidden></div>
      </div>
    </div>
    <p class="buurt-melding" aria-hidden="true" hidden></p>
    <div class="buurt-map-wrap">
      <div class="buurt-map" role="region" aria-label="Kaart van district Antwerpen met de agenda in je buurt" tabindex="-1" data-kaart="geen" data-op-kaart="0" data-gemarkeerd=""></div>
      <div class="buurt-map-veil"><button type="button" class="buurt-map-load">🗺️ Toon de kaart</button></div>
    </div>
    <div class="buurt-legenda" role="group" aria-label="Soorten op de kaart tonen of verbergen" hidden>
      <div class="buurt-leg-knoppen"></div>
      <p class="buurt-leg-hint">Tik op een soort om ze op de kaart te tonen of te verbergen. De lijst blijft volledig.</p>
    </div>
    <p class="buurt-status" aria-live="polite">Wijken laden…</p>
    <details class="buurt-nogeo" hidden><summary></summary><ul></ul></details>
    <p class="buurt-attrib">Wijkgrenzen: <a href="https://geodata.antwerpen.be/arcgissql/rest/services/P_Portal/portal_publiek2/MapServer/97" target="_blank" rel="noreferrer">stad Antwerpen, open data</a> ·
      locaties: <a href="https://geo.api.vlaanderen.be/geolocation/v4/Location" target="_blank" rel="noreferrer">Basisregisters Vlaanderen</a> · werken: GIPOD ·
      kaart: <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a>, © <a href="https://openmaptiles.org" target="_blank" rel="noreferrer">OpenMapTiles</a>, © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>-bijdragers.
      De kaart laadt bij OpenFreeMap (of, als dat niet lukt, bij OpenStreetMap) en cdnjs. Werken, werfzones en omleidingen, en van een evenement ook het parcours en de verkeersvrije zones, staan er exact; parkeerverboden, losse innames (ook die van een evenement) en vergunningen bij benadering (privacy).</p>
    <span class="buurt-kleuren" hidden>${KAART_SOORTEN.map((s) => `<i class="cat-${s.cat}"></i>`).join("")}</span>`;
  anchor.after(section);
  const $ = (s) => section.querySelector(s);
  const select = $("#buurt-wijk"), radiusGroup = $(".buurt-radius"), status = $(".buurt-status");
  const mapEl = $(".buurt-map"), veil = $(".buurt-map-veil"), laadKnop = $(".buurt-map-load"), noGeo = $(".buurt-nogeo");
  const legenda = $(".buurt-legenda"), meldingEl = $(".buurt-melding");
  // Voor de statusregel (zetStatus). Het plekoverzicht meldt wat de lijst toont via public-agenda:place-list,
  // alleen als dat verandert, en bewaart de laatste stand op window. Daarom eerst die stand lezen en luisteren
  // vóór het eerste await: anders mist een kaart die later laadt dan de lijst haar aantal voorgoed. Hetzelfde
  // voor wat de kaart tekent (public-agenda:kaart-items, window.PUBLIC_AGENDA_KAART).
  let laatste = null, lijstStand = window.PUBLIC_AGENDA_PLACE_LIST || null;
  window.addEventListener("public-agenda:place-list", (event) => { lijstStand = event.detail || null; zetStatus(); });

  let wijken = [], geo = { entries: {} }, matcher = null, streetIndex = null, straatasMislukt = false;
  // De kaart (een adapter, zie maakLeafletKaart), wat ze tekent (kaartLagen) en wat de bewoner koos.
  // `melding`: wat de laatste actie zei, achter de zin onder de kaart (aria-live). `balk`: "geen plek" na "Toon op
  // de kaart", zichtbaar boven de kaart (zie zetStatus).
  let kaart = null, lagen = null, entryVan = new Map(), gemarkeerd = "", melding = "", balk = "";
  const verborgen = new Set();

  // ---- legenda: vijf soorten, elk met tekentje, aantal op deze plek en (verborgen tekst) op de kaart ----
  const legKnoppen = new Map();
  for (const s of KAART_SOORTEN) {
    const knop = document.createElement("button");
    knop.type = "button";
    knop.className = `pv-chip buurt-leg cat-${s.cat}`;
    knop.dataset.kaartsoort = s.key;
    knop.setAttribute("aria-pressed", "true");
    knop.hidden = true;
    // Het tekentje: de vorm op de kaart, en voor een soort met plekken bij benadering ook die vorm (vierkant, ruit).
    const extra = ONGEVEER_VORM[s.key] && ONGEVEER_VORM[s.key] !== s.vorm ? `<span class="buurt-teken buurt-teken-${ONGEVEER_VORM[s.key]}" aria-hidden="true"></span>` : "";
    knop.innerHTML = `<span class="buurt-tekens"><span class="buurt-teken buurt-teken-${s.vorm}" aria-hidden="true"></span>${extra}</span><span class="buurt-leg-label">${esc(s.label)}</span> <span class="pv-chip-n">0</span><span class="buurt-vh"> op deze plek, 0 op de kaart</span>`;
    // Een tik op de legenda verandert niets boven de knoppen: de balk "geen plek" boven de kaart blijft staan. Ruimde
    // de tik ze op, dan schoven kaart en legenda omhoog terwijl de vinger nog op de knop lag, en zette een tweede tik
    // op dezelfde plek (de soort terugzetten) een andere soort uit.
    knop.addEventListener("click", () => {
      if (verborgen.has(s.key)) verborgen.delete(s.key); else verborgen.add(s.key);
      melding = "";
      drawAll();
    });
    legKnoppen.set(s.key, knop);
    $(".buurt-leg-knoppen").append(knop);
  }
  // De knoppen blijven staan (alleen hun tekst en toestand veranderen), zodat de focus na het tekenen op
  // dezelfde knop blijft. Een soort zonder kaartjes op deze plek verdwijnt, tenzij ze verborgen is. Het getal is
  // wat er op deze plek is (de lijst bij periode "alles", zoals "N items" boven de lijst), niet wat de lijst in
  // de gekozen periode, weergave of dag toont: dat zegt de zin eronder ("X in de lijst").
  function tekenLegenda(tel) {
    let zichtbaar = 0;
    for (const s of KAART_SOORTEN) {
      const knop = legKnoppen.get(s.key);
      const n = Number(tel?.per?.[s.key]) || 0, m = lagen?.perSoort?.[s.key] || 0, uit = verborgen.has(s.key);
      knop.hidden = !n && !uit;
      if (!knop.hidden) zichtbaar += 1;
      knop.setAttribute("aria-pressed", String(!uit));
      knop.classList.toggle("pv-chip-zero", !n);
      knop.querySelector(".pv-chip-n").textContent = String(n);
      knop.querySelector(".buurt-vh").textContent = uit ? " op deze plek, verborgen op de kaart" : ` op deze plek, ${m} op de kaart`;
    }
    legenda.hidden = !zichtbaar;
  }

  // ---- kaartjes zonder plek op de kaart: een lijst met knoppen naar het kaartje in de lijst ----
  const wanneer = (e, today) => (e.end && e.end > e.start ? kortBereik(e.start, e.end, today) : e.start ? kortDatum(e.start, today) : "");
  function tekenZonder(zonder, today, soortVan) {
    // Een marktdag heeft geen eigen rij (de lijst bundelt de markt); hij telt wel mee. De kop en de rest ("en nog N")
    // tellen, zoals de legenda, wat er op deze plek is (de lijst bij "alles"), niet wat de lijst nu toont: dat zegt
    // alleen de zin onder de kaart ("X in de lijst").
    const lijst = zonder.filter((e) => e.theme !== "markets");
    const getoond = lijst.slice(0, ZONDER_MAX);
    noGeo.hidden = !zonder.length;
    noGeo.querySelector("summary").textContent = `Zonder vaste plek op de kaart (${zonder.length})`;
    noGeo.querySelector("ul").innerHTML = getoond.map((e) => {
      const emoji = e.source === "agenda" ? categorie(e).emoji : SOORT_EMOJI[soortVan?.get?.(lijstSleutel(e)) || kaartSoort(e)];
      const regel = [wanneer(e, today), e.location || "locatie via de bron"].filter(Boolean).map(esc).join(" · ");
      return `<li><button type="button" class="buurt-open" data-open-uid="${esc(e.uid)}"><span aria-hidden="true">${esc(emoji)}</span> ${esc(e.title)}</button> <small>${regel}</small></li>`;
    }).join("") + (lijst.length > getoond.length ? `<li><small>en nog ${lijst.length - getoond.length} op deze plek</small></li>` : "");
  }

  // Klikken in de kaart, een popup of de lijst eronder: een kaartje openen in de lijst (place-view.js).
  section.addEventListener("click", (event) => {
    const naarLijst = event.target.closest?.("[data-open-uid]");
    if (naarLijst) {
      event.preventDefault();
      window.dispatchEvent(new CustomEvent("public-agenda:open", { detail: { uid: naarLijst.dataset.openUid } }));
      return;
    }
    const agendapunt = event.target.closest?.("[data-open-id]");
    if (agendapunt) { event.preventDefault(); openItem(agendapunt.dataset.openId); }
  });

  // ---- gegevens ----
  try {
    const [wijkDoc, geoDoc] = await Promise.all([getJson("/geo/wijken.geo.json"), getJson("/geo/locaties.json").catch(() => ({ entries: {} }))]);
    wijken = wijkFeatures(wijkDoc).filter((f) => f.properties.code.startsWith(DISTRICT_PREFIX));
    geo = geoDoc && typeof geoDoc.entries === "object" ? geoDoc : { entries: {} };
  } catch {
    // Geen wijkgrenzen: geen wijkkeuze, zonder melding dat iets faalt (besluit van 18-10-2026).
    status.textContent = "";
    view.straalNietBeschikbaar?.();
    window.dispatchEvent(new CustomEvent("public-agenda:area-ready"));
    return;
  }
  for (const f of [...wijken].sort((a, b) => a.properties.naam.localeCompare(b.properties.naam, "nl"))) {
    const option = document.createElement("option");
    option.value = f.properties.code;
    option.textContent = f.properties.naam;
    select.append(option);
  }
  select.disabled = false;
  select.value = view.area.wijk || "";
  function installMatcher() {
    matcher = createAreaMatcher({ wijken, geo, streetIndex, straatasMislukt });
    view.setAreaMatcher(matcher);
    window.dispatchEvent(new CustomEvent("public-agenda:area-ready"));
  }
  installMatcher();
  import("./street-source.js")
    .then(({ loadStreetIndex }) => loadStreetIndex())
    .then((index) => { streetIndex = index; installMatcher(); })
    // Zonder straatas: wijk volgt alleen echte punten; de straal is dan niet beschikbaar (en dat zegt de plek).
    .catch(() => { straatasMislukt = true; installMatcher(); });

  select.addEventListener("change", () => {
    window.dispatchEvent(new CustomEvent("public-agenda:area-change", { detail: { wijk: select.value } }));
  });
  // Tikken op een wijk kiest die wijk; nog eens tikken zet ze weer uit.
  function kiesWijk(code) {
    const nieuw = view.area.wijk === code ? "" : code;
    select.value = nieuw;
    window.dispatchEvent(new CustomEvent("public-agenda:area-change", { detail: { wijk: nieuw } }));
  }

  // ---- straal rond de gekozen straat ----
  for (const r of RADIUS_OPTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.radius = String(r);
    button.textContent = r ? `+ ${radiusLabel(r)}` : "Alleen deze straat";
    button.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("public-agenda:area-change", { detail: { radius: r } }));
    });
    radiusGroup.append(button);
  }

  // ---- kaart (lui) ----
  // De vectorkaart mag niet met ?kaart=leaflet in de link, met databesparing, op een trage verbinding (lager dan
  // 4g, saveData: magVectorKaart in kaart-lagen.js) of zonder WebGL (een proefcanvas, meteen weer vrijgegeven).
  // Het thema (licht of donker) kiezen we bij het starten.
  function heeftWebgl() {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      if (!gl) return false;
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      return true;
    } catch {
      return false;
    }
  }
  function magVector() {
    try {
      return magVectorKaart({ kaart: new URL(window.location.href).searchParams.get("kaart") || "", verbinding: navigator.connection || null, webgl: heeftWebgl });
    } catch {
      return false;
    }
  }
  function themaNu() {
    const gekozen = document.documentElement.dataset.theme;
    if (gekozen === "dark" || gekozen === "light") return gekozen === "dark" ? "donker" : "licht";
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "donker" : "licht";
  }
  let starten = null;
  function startMap() {
    if (kaart) return Promise.resolve(kaart);
    if (starten) return starten;
    laadKnop.textContent = "Kaart laden…";
    mapEl.dataset.kaart = "laadt";
    const [eersteKader, { maxZoom }] = focusKader();
    const thema = themaNu();
    starten = kiesKaart({
      magVector: magVector(),
      // 8 s per stap; zolang de stappen binnenkomen (de stijl, MapLibre: voortgang) hoogstens 16 s tot de eerste tegel,
      // daarna nog één keer 8 s (bijnaKlaar).
      wachttijd: 8000,
      maxWacht: 16000,
      // Eerst de stijl (klein); pas als die er is, MapLibre (1 MB). Met de eerste tegel binnen is ze bijna klaar.
      vector: (signal, { voortgang, bijnaKlaar } = {}) => import("./kaart-vector.js").then((m) => m.haalStijl(thema, signal)
        .then((stijl) => {
          voortgang?.();
          return m.laadMapLibre().then((maplibregl) => {
            voortgang?.();
            return m.maakVectorKaart(maplibregl, mapEl, { stijl, thema, kader: eersteKader, maxZoom, wijken, wijkStijl, onWijk: kiesWijk, pinHtml, pinNaam, signal, bijnaKlaar });
          });
        })),
      basis: () => loadLeaflet().then((L) => maakLeafletKaart(L, mapEl, { wijken, onWijk: kiesWijk })),
    })
      .then((nieuw) => {
        kaart = nieuw;
        veil.hidden = true;
        mapEl.dataset.kaart = kaart.soort;
        mapEl.dataset.onderkaart = kaart.onderkaart || "licht";
        lastFocus = "";
        drawAll();
        return kaart;
      })
      .catch(() => {
        // Geen melding dat de kaart faalt (besluit van 18-10-2026): de knop blijft, om het opnieuw te proberen.
        laadKnop.textContent = "🗺️ Toon de kaart";
        mapEl.dataset.kaart = "geen";
        return null;
      })
      .finally(() => { starten = null; });
    return starten;
  }
  laadKnop.addEventListener("click", () => { startMap(); });
  // Het snelheidsbudget (P5): de kaart start pas als ze bijna in beeld komt (200 px), en dan nog pas als de
  // browser even niets te doen heeft (hoogstens 1,5 s later), zodat ze de lijst en de tegels niet vertraagt.
  // Met databesparing start ze alleen met de knop.
  const zuinig = Boolean(navigator.connection?.saveData);
  const alsHetRustigIs = (fn) => ("requestIdleCallback" in window ? window.requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 1200));
  if (zuinig) laadKnop.textContent = "🗺️ Toon de kaart (databesparing staat aan)";
  else if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { observer.disconnect(); alsHetRustigIs(() => startMap()); }
    }, { rootMargin: "200px" });
    observer.observe(mapEl);
  }

  // Waar de kaart heen kijkt: [kader, {maxZoom}]. De straat met haar straal, anders de wijk of het kader van de
  // gekozen plek, anders (hele district) de agendapunten als er minstens twee zijn, anders het district.
  function focusKader() {
    const segments = view.selected && matcher?.segmentsFor ? matcher.segmentsFor(view.selected) : [];
    if (segments.length) {
      const pad = (view.area.radius || 120) / 111000;
      const xs = segments.flatMap((s) => [s.a[0], s.b[0]]), ys = segments.flatMap((s) => [s.a[1], s.b[1]]);
      return [[Math.min(...xs) - pad * 1.6, Math.min(...ys) - pad, Math.max(...xs) + pad * 1.6, Math.max(...ys) + pad], {}];
    }
    const feature = wijken.find((f) => f.properties.code === view.area.wijk);
    // De gekozen plek uit de zoekbalk (straat zonder live straatas, of een postcode) brengt haar eigen kader mee.
    const box = feature ? bboxOf(feature.geometry) : view.place?.box;
    if (geldigKader(box)) {
      const pad = feature ? 0 : 0.0015;
      return [[box[0] - pad * 1.6, box[1] - pad, box[2] + pad * 1.6, box[3] + pad], {}];
    }
    const pins = lagen?.pins || [];
    if (pins.length >= 2) {
      const xs = pins.map((p) => p.point[0]), ys = pins.map((p) => p.point[1]);
      const k = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      const dx = (k[2] - k[0]) * 0.2, dy = (k[3] - k[1]) * 0.2;
      return [[k[0] - dx, k[1] - dy, k[2] + dx, k[3] + dy], { maxZoom: 14 }];
    }
    return [districtKader(wijken) || ANTWERPEN, {}];
  }
  function focusArea(animate = true) {
    if (!kaart) return;
    const [k, opties] = focusKader();
    kaart.kader(k, { ...opties, animate });
  }

  // ---- markeren: van de lijst naar de kaart ----
  // Het gemarkeerde kaartje blijft gemarkeerd als de kaart opnieuw tekent (een render van de lijst). `zoom`:
  // "altijd" (Toon op de kaart), "buiten-beeld" (een rij gaat open) of niet (opnieuw tekenen: wie de kaart zelf
  // verschoof, wordt niet teruggezet).
  function markeer(zoom = "") {
    const gevonden = Boolean(kaart && gemarkeerd && kaart.markeer(gemarkeerd));
    if (kaart && !gemarkeerd) kaart.markeer("");
    mapEl.dataset.gemarkeerd = gevonden ? gemarkeerd : "";
    const k = gevonden ? lagen?.kaderVan?.get(gemarkeerd) : null;
    if (k && (zoom === "altijd" || (zoom === "buiten-beeld" && !kaart.inBeeld(k)))) kaart.kader(k, { maxZoom: MARKEER_ZOOM });
    return gevonden;
  }
  // Een rij gaat open (of dicht) in de lijst: de kaart markeert ze, en zoomt erheen als ze niet in beeld is.
  window.addEventListener("public-agenda:rij-open", (event) => {
    const { uid = "", open = false } = event.detail || {};
    if (open) gemarkeerd = String(uid);
    else if (gemarkeerd === uid) gemarkeerd = "";
    else return;
    melding = "";
    balk = "";
    markeer("buiten-beeld");
    zetStatus();
  });
  // "Toon op de kaart" (vooral op gsm, waar de kaart onder de lijst staat): de kaart in beeld, starten als dat
  // nog niet gebeurde, en het kaartje markeren. Een soort die de legenda verborg, komt terug. Zonder plek op de
  // kaart zegt de kaart dat eerlijk, in een balk vlak boven de kaart (de zin onder de legenda valt op een kleine gsm
  // of met grote tekst buiten beeld). Die balk ligt nooit over de kaart: niet over een popup, niet over de knop in
  // de sluier. Lukt het markeren, dan zegt alleen de zin onder de kaart het (aria-live): de markering is zichtbaar.
  // De focus gaat mee naar de kaart: anders bleef ze op de knop boven het venster, en sprong de volgende Tab terug
  // naar de lijst.
  window.addEventListener("public-agenda:kaart-toon", async (event) => {
    const uid = String(event.detail?.uid || "");
    if (!uid) return;
    gemarkeerd = uid;
    const entry = entryVan.get(uid);
    const soort = entry ? window.PUBLIC_AGENDA_KAART?.tel?.soortVan?.get?.(lijstSleutel(entry)) || kaartSoort(entry) : "";
    if (verborgen.delete(soort)) drawAll();
    melding = lagen?.kaderVan?.has(uid) ? `Gemarkeerd op de kaart: ${entry?.title || "dit kaartje"}.` : GEEN_PLEK;
    balk = melding === GEEN_PLEK ? GEEN_PLEK : "";
    zetStatus();
    $(".buurt-map-wrap").scrollIntoView({ block: "center" });
    if (!meldingEl.hidden) meldingEl.scrollIntoView({ block: "nearest" });
    mapEl.focus({ preventScroll: true });
    if (await startMap()) markeer("altijd");
  });

  let lastFocus = null;
  function drawAll() {
    radiusGroup.hidden = !view.selected;
    for (const button of radiusGroup.querySelectorAll("button")) button.setAttribute("aria-pressed", String(Number(button.dataset.radius) === view.area.radius));
    if (select.value !== view.area.wijk) select.value = view.area.wijk;
    const today = brusselsToday();
    // Wat de lijst toont (place-view.js), per soort geteld; de legenda zet soorten alleen op de kaart uit.
    const stand = window.PUBLIC_AGENDA_KAART || { teken: [], tel: null };
    const teken = Array.isArray(stand.teken) ? stand.teken : [];
    // Met een gekozen plek tekent de kaart alles van die plek (zoals de lijst); alleen het hele district zonder plek
    // houdt een grens per soort (MAX_PER_SOORT en kaartMax in kaart-lagen.js).
    lagen = kaartLagen(teken, { geo, verborgen, soortVan: stand.tel?.soortVan, max: kaartMax(Boolean(view.place)) });
    entryVan = new Map();
    for (const e of teken) if (e?.uid && !entryVan.has(e.uid)) entryVan.set(e.uid, e);
    tekenLegenda(stand.tel);
    tekenZonder(lagen.zonder, today, stand.tel?.soortVan);
    if (kaart) {
      const kleuren = kleurenUitCss(section, mapEl);
      kaart.wijken(view.area.wijk);
      kaart.straat(view.selected && matcher?.segmentsFor ? matcher.segmentsFor(view.selected) : [], kleuren.straat, kleuren.straatRand);
      kaart.items({ lagen, entryVan, kleuren, today });
    }
    const focusKey = `${view.selected ? `${view.selected.id}|${view.selected.name}` : ""}|${view.area.wijk}|${view.area.postcode || ""}|${view.place?.key || ""}|${view.area.radius}|${Boolean(matcher?.segmentsFor && view.selected && matcher.segmentsFor(view.selected).length)}`;
    if (kaart && focusKey !== lastFocus) { focusArea(lastFocus !== ""); lastFocus = focusKey; }
    markeer();
    mapEl.dataset.opKaart = String(lagen.opKaart);
    const where = view.selected ? `${view.selected.name}${view.area.radius ? ` + ${radiusLabel(view.area.radius)}` : ""}` : view.area.wijk ? `wijk ${matcher?.labelFor(view.area.wijk) || ""}` : view.area.postcode ? `postcode ${view.area.postcode}` : "district Antwerpen";
    const p = lagen.perSoort;
    const live = window.PUBLIC_AGENDA_LIVE_STREETS || {};
    laatste = { where, mapped: p.agenda, werkenGetekend: p.werken + p.verkeer, ander: p.evenement + p.vergunning, opKaart: lagen.opKaart, without: lagen.zonder.length, werkenGeladen: Boolean(live.works), werkenMislukt: !Array.isArray(live.works) && Boolean(live.failed?.works?.length) };
    zetStatus();
  }
  // De zin onder de kaart (voor schermlezers ook de melding: aria-live). "Geen plek" staat daarnaast zichtbaar in
  // een balk vlak boven de kaart (.buurt-melding, verborgen voor schermlezers: ze horen ze al in de zin), zodat wie
  // op "Toon op de kaart" tikte, ze ziet ook als de zin buiten beeld valt. De balk staat in de flow: alleen een actie
  // in de lijst ruimt ze op (een rij open- of dichtklappen, een nieuwe "Toon op de kaart"; op gsm staan die knoppen
  // boven de kaart), nooit een tik onder de balk (de legenda, de kaart): dan schoof alles onder de vinger omhoog.
  function zetStatus() {
    meldingEl.textContent = balk;
    meldingEl.hidden = !balk;
    if (!laatste) return;
    const zin = kaartStatusZin({ ...laatste, werkenAan: view.enabled("works"), metPlek: Boolean(view.place), lijstAantal: lijstStand?.aantal, lijstItems: lijstStand?.items });
    status.textContent = melding ? `${zin} ${melding}` : zin;
  }
  let pending = 0;
  const schedule = () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(drawAll); };
  window.addEventListener("public-agenda:agenda-view", schedule);
  window.addEventListener("public-agenda:street-layer", schedule);
  window.addEventListener("public-agenda:view-change", schedule);
  window.addEventListener("public-agenda:kaart-items", schedule);
  drawAll();
}
