// Buurtkaart: kies een wijk (officiële wijkgrenzen van stad Antwerpen) of tik op de kaart, en zie de
// agenda, werken en hinder in jouw buurt. Alleen presentatie: de items, bronnen en publicatieregels
// komen ongewijzigd uit agenda.js en de live lagen.
//
// - Wijken: site/geo/wijken.geo.json (vereenvoudigd, met bron en licentie in "metadata").
// - Punten: werken hebben hun GIPOD-punt; agendapunten krijgen het hunne bij het verversen
//   (site/geo/locaties.json, scripts/geocode-locations.mjs). De browser geocodeert nooit zelf.
// - Items zonder punt staan in een lijst onder de kaart, nooit als gegokte marker.
// - Leaflet en de kaarttegels (OpenStreetMap) worden pas geladen als de kaart in beeld komt.
import {
  RADIUS_OPTIONS,
  bboxOf,
  isPoint,
  itemPoint,
  nearSegments,
  streetSegments,
  streetWijkMap,
  streetsInWijk,
  wijkFeatures,
  groupByPoint,
} from "./neighborhood-core.js";
import { pointInGeometry } from "./works-core.js";

const LEAFLET = Object.freeze({
  css: { href: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css", integrity: "sha512-Zcn6bjR/8RZbLEpLIeOwNtzREBAJnUKESxces60Mpoj+2okopSAcSUIUOseddDm0cxnGQzxIR7vJgsLZbdLE3w==" },
  js: { src: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js", integrity: "sha512-BwHfrr4c9kmRkLw6iXFdzcdWV/PGkVgiIyIWLLlTSXzWQzxuSg4DiQUCpauz/EWjgk5TYQqX/kvn9pG1NpYfqg==" },
});
const TILES = Object.freeze({
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>-bijdragers',
});
const DISTRICT_PREFIX = "ANT";
const MAX_WORK_MARKERS = 600;

const esc = (v = "") => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
const radiusLabel = (r) => (r >= 1000 ? `${r / 1000} km` : `${r} m`);

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
export function createAreaMatcher({ wijken, geo, streetIndex = null }) {
  const byCode = new Map(wijken.map((f) => [f.properties.code, f]));
  const streetMap = streetIndex ? streetWijkMap(streetIndex, wijken) : null;
  const segmentCache = new Map();
  return {
    labelFor: (code) => byCode.get(code)?.properties.naam || code,
    inWijk(item, code, refs = []) {
      const feature = byCode.get(code);
      if (!feature) return true;
      const point = itemPoint(item, geo);
      if (point) return pointInGeometry(point, feature.geometry);
      return streetsInWijk(refs, code, streetMap);
    },
    nearStreet(item, street, radius) {
      if (!streetIndex) return false;
      const point = itemPoint(item, geo);
      if (!point) return false;
      const key = `${street.id}|${street.name}|${street.postcode}`;
      if (!segmentCache.has(key)) segmentCache.set(key, streetSegments(streetIndex, street));
      return nearSegments(point, segmentCache.get(key), radius);
    },
    segmentsFor(street) {
      if (!streetIndex || !street) return [];
      const key = `${street.id}|${street.name}|${street.postcode}`;
      if (!segmentCache.has(key)) segmentCache.set(key, streetSegments(streetIndex, street));
      return segmentCache.get(key);
    },
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
    <div class="buurt-map-wrap">
      <div class="buurt-map" role="region" aria-label="Kaart van district Antwerpen met de agenda in je buurt"></div>
      <div class="buurt-map-veil"><button type="button" class="buurt-map-load">🗺️ Toon de kaart</button></div>
    </div>
    <p class="buurt-status" aria-live="polite">Wijken laden…</p>
    <details class="buurt-nogeo" hidden><summary></summary><ul></ul></details>
    <p class="buurt-attrib">Wijkgrenzen: <a href="https://geodata.antwerpen.be/arcgissql/rest/services/P_Portal/portal_publiek2/MapServer/97" target="_blank" rel="noreferrer">stad Antwerpen, open data</a> ·
      locaties: <a href="https://geo.api.vlaanderen.be/geolocation/v4/Location" target="_blank" rel="noreferrer">Basisregisters Vlaanderen</a> · werken: GIPOD ·
      kaart: © OpenStreetMap-bijdragers. De kaart laadt bij OpenStreetMap en cdnjs.</p>`;
  anchor.after(section);
  const $ = (s) => section.querySelector(s);
  const select = $("#buurt-wijk"), radiusGroup = $(".buurt-radius"), status = $(".buurt-status");
  const mapEl = $(".buurt-map"), veil = $(".buurt-map-veil"), noGeo = $(".buurt-nogeo");

  let wijken = [], geo = { entries: {} }, matcher = null, streetIndex = null;
  let L = null, map = null, wijkLayer = null, markerLayer = null, workLayer = null, streetLayer = null, districtBounds = null;

  // ---- gegevens ----
  try {
    const [wijkDoc, geoDoc] = await Promise.all([getJson("/geo/wijken.geo.json"), getJson("/geo/locaties.json").catch(() => ({ entries: {} }))]);
    wijken = wijkFeatures(wijkDoc).filter((f) => f.properties.code.startsWith(DISTRICT_PREFIX));
    geo = geoDoc && typeof geoDoc.entries === "object" ? geoDoc : { entries: {} };
  } catch {
    status.textContent = "De wijkgrenzen konden nu niet geladen worden. De agenda en de straatfilter werken gewoon.";
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
    matcher = createAreaMatcher({ wijken, geo, streetIndex });
    view.setAreaMatcher(matcher);
    window.dispatchEvent(new CustomEvent("public-agenda:area-ready"));
  }
  installMatcher();
  import("./street-source.js")
    .then(({ loadStreetIndex }) => loadStreetIndex())
    .then((index) => { streetIndex = index; installMatcher(); })
    .catch(() => { /* Zonder straatas: wijk volgt alleen echte punten; de straal is dan niet beschikbaar. */ });

  select.addEventListener("change", () => {
    window.dispatchEvent(new CustomEvent("public-agenda:area-change", { detail: { wijk: select.value } }));
  });

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
  async function startMap() {
    if (map || startMap.busy) return;
    startMap.busy = true;
    veil.querySelector("button").textContent = "Kaart laden…";
    try {
      L = await loadLeaflet();
    } catch {
      veil.querySelector("button").textContent = "Kaart niet beschikbaar · opnieuw proberen";
      startMap.busy = false;
      return;
    }
    veil.hidden = true;
    map = L.map(mapEl, { scrollWheelZoom: false, preferCanvas: true, zoomSnap: 0.5, attributionControl: true });
    map.attributionControl.setPrefix(false);
    L.tileLayer(TILES.url, { maxZoom: 19, attribution: TILES.attribution, referrerPolicy: "strict-origin-when-cross-origin" }).addTo(map);
    // Kader zonder de haven (ANT08), anders zoomt de kaart te ver uit voor de woonwijken.
    const boxes = wijken.filter((f) => f.properties.code !== "ANT08").map((f) => bboxOf(f.geometry)).filter(Boolean);
    districtBounds = L.latLngBounds(boxes.flatMap((b) => [[b[1], b[0]], [b[3], b[2]]]));
    map.fitBounds(districtBounds, { padding: [8, 8] });
    wijkLayer = L.geoJSON({ type: "FeatureCollection", features: wijken }, {
      style: (f) => wijkStyle(f.properties.code),
      onEachFeature: (f, layer) => {
        layer.bindTooltip(esc(f.properties.naam), { sticky: true, direction: "top", className: "buurt-tip" });
        layer.on("click", () => {
          const code = view.area.wijk === f.properties.code ? "" : f.properties.code;
          select.value = code;
          window.dispatchEvent(new CustomEvent("public-agenda:area-change", { detail: { wijk: code } }));
        });
      },
    }).addTo(map);
    streetLayer = L.layerGroup().addTo(map);
    workLayer = L.layerGroup().addTo(map);
    markerLayer = L.layerGroup().addTo(map);
    mapEl.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-open-id]");
      if (!button) return;
      event.preventDefault();
      openItem(button.dataset.openId);
    });
    lastFocus = "";
    drawAll();
  }
  veil.querySelector("button").addEventListener("click", startMap);
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { observer.disconnect(); startMap(); }
    }, { rootMargin: "200px" });
    observer.observe(mapEl);
  }

  function wijkStyle(code) {
    const active = view.area.wijk === code, dim = view.area.wijk && !active;
    return { color: active ? "#b4361b" : "#5b6470", weight: active ? 3 : 1, opacity: dim ? 0.35 : 0.8, fillColor: "#b4361b", fillOpacity: active ? 0.08 : 0.02, dashArray: active ? null : "3 4" };
  }

  function focusArea(animate = true) {
    if (!map) return;
    const options = { padding: [16, 16], animate };
    const segments = view.selected && matcher?.segmentsFor ? matcher.segmentsFor(view.selected) : [];
    if (segments.length) {
      const pad = (view.area.radius || 120) / 111000;
      const xs = segments.flatMap((s) => [s.a[0], s.b[0]]), ys = segments.flatMap((s) => [s.a[1], s.b[1]]);
      map.fitBounds([[Math.min(...ys) - pad, Math.min(...xs) - pad * 1.6], [Math.max(...ys) + pad, Math.max(...xs) + pad * 1.6]], options);
      return;
    }
    const feature = wijken.find((f) => f.properties.code === view.area.wijk);
    // De gekozen plek uit de zoekbalk (straat zonder live straatas, of een postcode) brengt haar eigen kader mee.
    const box = feature ? bboxOf(feature.geometry) : view.place?.box;
    if (Array.isArray(box) && box.length === 4 && box.every(Number.isFinite)) {
      const pad = feature ? 0 : 0.0015;
      map.fitBounds([[box[1] - pad, box[0] - pad * 1.6], [box[3] + pad, box[2] + pad * 1.6]], options);
    } else {
      // Hele district: inzoomen op wat er te zien is, anders het district zonder de haven.
      const markers = markerLayer ? markerLayer.getLayers() : [];
      if (markers.length >= 2) map.fitBounds(L.featureGroup(markers).getBounds().pad(0.2), { ...options, maxZoom: 14 });
      else if (districtBounds) map.fitBounds(districtBounds, options);
    }
  }

  // ---- markers ----
  function categoryOf(item) {
    const cat = window.PublicAgendaUitgaan?.categoryFor?.(item.category) || { key: "other", emoji: "📍", label: "Agenda" };
    return cat;
  }
  function popupFor(items) {
    const seen = new Map();
    for (const item of items) {
      const key = item.title;
      if (!seen.has(key) || String(item.date) < String(seen.get(key).date)) seen.set(key, item);
    }
    const unique = [...seen.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const rows = unique.slice(0, 6).map((item) => {
      const cat = categoryOf(item);
      return `<li><span aria-hidden="true">${esc(cat.emoji)}</span> <strong>${esc(item.title)}</strong><br><small>${esc(item.dateLabel || item.date)}${item.timeText ? ` · ${esc(item.timeText)}` : ""}</small><br><button type="button" class="buurt-open" data-open-id="${esc(item.id)}">Toon in het overzicht</button></li>`;
    });
    const more = unique.length > 6 ? `<li><small>en nog ${unique.length - 6} …</small></li>` : "";
    const place = items[0]?.location ? `<p class="buurt-pop-place">📍 ${esc(items[0].location)}</p>` : "";
    return `<div class="buurt-pop">${place}<ul>${rows.join("")}${more}</ul></div>`;
  }
  function drawAgenda() {
    const items = Array.isArray(window.PUBLIC_AGENDA_VISIBLE_ITEMS) ? window.PUBLIC_AGENDA_VISIBLE_ITEMS : [];
    const withPoint = [], without = [];
    for (const item of items) {
      const point = itemPoint(item, geo);
      if (point) withPoint.push({ item, point });
      else without.push(item);
    }
    if (markerLayer) {
      markerLayer.clearLayers();
      for (const group of groupByPoint(withPoint)) {
        const first = group.items[0], cat = categoryOf(first), count = new Set(group.items.map((i) => i.title)).size;
        const icon = L.divIcon({
          className: "buurt-pin-wrap",
          html: `<span class="buurt-pin cat-${esc(cat.key)}"><span aria-hidden="true">${esc(cat.emoji)}</span>${count > 1 ? `<b>${count}</b>` : ""}</span>`,
          iconSize: [38, 38],
          iconAnchor: [19, 36],
          popupAnchor: [0, -32],
        });
        L.marker([group.point[1], group.point[0]], { icon, title: first.title, riseOnHover: true, keyboard: true })
          .bindPopup(popupFor(group.items), { maxWidth: 280, autoPanPadding: [16, 16] })
          .addTo(markerLayer);
      }
    }
    // Lijst onder de kaart: wat binnen je keuze valt maar geen vaste plek heeft.
    const listed = without.filter((item) => item.category !== "markets").slice(0, 40);
    noGeo.hidden = !without.length;
    noGeo.querySelector("summary").textContent = `Zonder vaste plek op de kaart (${new Set(without.map((item) => item.title)).size})`;
    noGeo.querySelector("ul").innerHTML = listed
      .map((item) => `<li><button type="button" class="buurt-open" data-open-id="${esc(item.id)}"><span aria-hidden="true">${esc(categoryOf(item).emoji)}</span> ${esc(item.title)}</button> <small>${esc(item.dateLabel || item.date)} · ${esc(item.location || "locatie via de bron")}</small></li>`)
      .join("") + (without.length > listed.length ? `<li><small>en nog ${without.length - listed.length} in de agenda hieronder</small></li>` : "");
    // Tellen per activiteit, niet per marktdag: een weekmarkt met acht marktdagen is één punt.
    const uniq = (list) => new Set(list.map((item) => `${item.title}|${item.location || ""}`)).size;
    return { mapped: uniq(withPoint.map((x) => x.item)), without: uniq(without) };
  }
  noGeo.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-open-id]");
    if (button) openItem(button.dataset.openId);
  });
  function drawWorks() {
    if (!workLayer) return 0;
    workLayer.clearLayers();
    if (!view.enabled("works")) return 0;
    const works = (window.PUBLIC_AGENDA_LIVE_STREETS?.works || []).filter((w) => isPoint(w.point) && view.matches(w, "works"));
    for (const w of works.slice(0, MAX_WORK_MARKERS)) {
      const running = w.status === "In uitvoering";
      L.circleMarker([w.point[1], w.point[0]], { radius: running ? 6 : 5, color: "#ffffff", weight: 1.5, fillColor: running ? "#d97706" : "#64748b", fillOpacity: 0.9 })
        .bindPopup(`<div class="buurt-pop"><p><strong>🚧 ${esc(w.title)}</strong></p><p><small>${esc(w.ownerGroup || w.owner || "")} · ${esc(w.status)}</small></p>${w.hindrance ? `<p><small>Hinder: ${esc((w.hindrance.consequences || []).join(" · ") || "gevalideerd")}</small></p>` : ""}</div>`, { maxWidth: 280 })
        .addTo(workLayer);
    }
    return works.length;
  }
  function drawStreet() {
    if (!streetLayer) return;
    streetLayer.clearLayers();
    const segments = view.selected && matcher?.segmentsFor ? matcher.segmentsFor(view.selected) : [];
    for (const s of segments) L.polyline([[s.a[1], s.a[0]], [s.b[1], s.b[0]]], { color: "#b4361b", weight: 6, opacity: 0.75, interactive: false }).addTo(streetLayer);
  }
  let lastFocus = null;
  function drawAll() {
    radiusGroup.hidden = !view.selected;
    for (const button of radiusGroup.querySelectorAll("button")) button.setAttribute("aria-pressed", String(Number(button.dataset.radius) === view.area.radius));
    if (select.value !== view.area.wijk) select.value = view.area.wijk;
    if (wijkLayer) wijkLayer.setStyle((f) => wijkStyle(f.properties.code));
    const counts = drawAgenda();
    const works = drawWorks();
    drawStreet();
    const focusKey = `${view.selected ? `${view.selected.id}|${view.selected.name}` : ""}|${view.area.wijk}|${view.area.postcode || ""}|${view.place?.key || ""}|${view.area.radius}|${Boolean(matcher?.segmentsFor && view.selected && matcher.segmentsFor(view.selected).length)}`;
    if (map && focusKey !== lastFocus) { focusArea(lastFocus !== ""); lastFocus = focusKey; }
    const where = view.selected ? `${view.selected.name}${view.area.radius ? ` + ${radiusLabel(view.area.radius)}` : ""}` : view.area.wijk ? `wijk ${matcher?.labelFor(view.area.wijk) || ""}` : view.area.postcode ? `postcode ${view.area.postcode}` : "district Antwerpen";
    const parts = [`${counts.mapped} agendapunt${counts.mapped === 1 ? "" : "en"} op de kaart in ${where}`];
    if (view.enabled("works")) parts.push(window.PUBLIC_AGENDA_LIVE_STREETS?.works ? `${works} werken en hinder` : "werken en hinder worden geladen…");
    if (counts.without) parts.push(`${counts.without} zonder vaste plek`);
    status.textContent = `${parts.join(" · ")}.`;
  }
  let pending = 0;
  const schedule = () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(drawAll); };
  window.addEventListener("public-agenda:agenda-view", schedule);
  window.addEventListener("public-agenda:street-layer", schedule);
  window.addEventListener("public-agenda:view-change", () => { schedule(); });
  drawAll();
}
