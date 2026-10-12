// De vectorkaart van de buurtkaart (P9): MapLibre 5.24.0 van cdnjs met de vectortegels van OpenFreeMap (geen
// sleutel nodig). Alleen als het kan: neighborhood-map.js kiest met kiesKaart (kaart-lagen.js) eerst deze
// kaart en valt terug op Leaflet als de stijl, MapLibre of de eerste tegel niet op tijd komt, zonder WebGL,
// met databesparing of met ?kaart=leaflet.
//
// - Volgorde: eerst de stijl (haalStijl, klein); pas als die er is, MapLibre (1 MB). Faalt de stijl, dan wordt
//   MapLibre niet eens gedownload.
// - Klaar is de kaart pas als de eerste tegel van de bron "openmaptiles" geladen is en de kaart stil staat
//   (idle). Een tegelfout vóór die eerste tegel (isTegelFout), een abort of geen WebGL: de kaart ruimt zichzelf
//   op en de belofte faalt.
// - Tekenen: dezelfde adapter als de Leaflet-kaart (maakLeafletKaart in neighborhood-map.js), uit dezelfde pure
//   laag (kaartLagen, popupHtml): elk object in de kleur van zijn rij en met een eigen vorm per soort.
// - Het thema (licht of donker) wordt bij het starten gekozen: positron of dark.
// Op het hoogste niveau raakt deze module geen DOM aan (ook in Node te importeren, tests/kaart-lagen.test.mjs).
import { isTegelFout, popupHtml } from "./kaart-lagen.js";

export const MAPLIBRE = Object.freeze({
  versie: "5.24.0",
  css: Object.freeze({ href: "https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.24.0/maplibre-gl.css", integrity: "sha512-KIMsMWIdnoG9OwZa+oaIafmbDonqck1UCmq+/zcUi2aaZ97N9QE6TqpTM+n36EO40HGh64hU/375zxtjx7WTyQ==" }),
  js: Object.freeze({ src: "https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.24.0/maplibre-gl.js", integrity: "sha512-rOFgoUgWaVi69JW1dzBu6PWF9xKW9rxYfY5u2SexFABHhWk0qUWkJoWNz4UuZRMvSXsNZG66+tU5B+HlwWF5kA==" }),
  crossOrigin: "anonymous",
  referrerPolicy: "no-referrer",
});
export const STIJL = Object.freeze({
  licht: "https://tiles.openfreemap.org/styles/positron",
  donker: "https://tiles.openfreemap.org/styles/dark",
});
const TEGELBRON = "openmaptiles";
const STIJL_WACHTTIJD = 4000;
// De vectorkaart zoomt in stappen van 512 px: één stap minder geeft dezelfde schaal als Leaflet (256 px).
const ZOOM_VERSCHIL = 1;
const MAX_ZOOM = 19 - ZOOM_VERSCHIL;
const ONGEVEER_STRAAL = 60; // meter, zoals de ring op de Leaflet-kaart
// Nederlandse teksten van MapLibre. "Kaartbeeld" is de naam van het canvas: uniek naast de regio's "Kaart"
// (de zijkolom) en "Kaart van district …" (de buurtkaart).
const NL = Object.freeze({
  "Map.Title": "Kaartbeeld",
  "Marker.Title": "Plek op de kaart",
  "NavigationControl.ZoomIn": "Inzoomen",
  "NavigationControl.ZoomOut": "Uitzoomen",
  "NavigationControl.ResetBearing": "Terug naar het noorden",
  "AttributionControl.ToggleAttribution": "Bronvermelding tonen of verbergen",
  "AttributionControl.MapFeedback": "Een fout in de kaart melden",
  "Popup.Close": "Sluiten",
});

// De stijl van OpenFreeMap, met een eigen wachttijd en het signaal van kiesKaart.
export async function haalStijl(thema = "licht", signal = null) {
  const ctrl = new AbortController();
  const stop = () => ctrl.abort();
  const klok = setTimeout(stop, STIJL_WACHTTIJD);
  if (signal?.aborted) stop();
  signal?.addEventListener?.("abort", stop, { once: true });
  try {
    const antwoord = await fetch(STIJL[thema] || STIJL.licht, { signal: ctrl.signal, credentials: "omit", headers: { Accept: "application/json" } });
    if (!antwoord.ok) throw new Error(`stijl: HTTP ${antwoord.status}`);
    const stijl = await antwoord.json();
    if (!stijl?.sources?.[TEGELBRON]) throw new Error("stijl zonder de bron openmaptiles");
    return stijl;
  } finally {
    clearTimeout(klok);
    signal?.removeEventListener?.("abort", stop);
  }
}

// MapLibre (CSS en JS) met SRI. Faalt het, dan wordt de bewaarde belofte gewist: opnieuw proberen kan.
export function laadMapLibre() {
  if (globalThis.maplibregl?.Map) return Promise.resolve(globalThis.maplibregl);
  if (laadMapLibre.belofte) return laadMapLibre.belofte;
  laadMapLibre.belofte = new Promise((resolve, reject) => {
    const { crossOrigin, referrerPolicy } = MAPLIBRE;
    const css = document.createElement("link");
    Object.assign(css, { rel: "stylesheet", href: MAPLIBRE.css.href, integrity: MAPLIBRE.css.integrity, crossOrigin, referrerPolicy });
    const script = document.createElement("script");
    Object.assign(script, { src: MAPLIBRE.js.src, integrity: MAPLIBRE.js.integrity, crossOrigin, referrerPolicy, async: true });
    const faal = (tekst) => { laadMapLibre.belofte = null; script.remove(); reject(new Error(tekst)); };
    script.onload = () => (globalThis.maplibregl?.Map ? resolve(globalThis.maplibregl) : faal("MapLibre ontbreekt"));
    script.onerror = () => faal("MapLibre kon niet laden");
    document.head.append(css, script);
  });
  return laadMapLibre.belofte;
}

// ---- tekenen ----
const LIJN = ["in", ["geometry-type"], ["literal", ["LineString", "MultiLineString"]]];
const VLAK = ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]];
const PUNT = ["in", ["geometry-type"], ["literal", ["Point", "MultiPoint"]]];
const ITEM_LAGEN = ["pa-vlak", "pa-lijn", "pa-lijn-verkeer", "pa-punt", "pa-ongeveer"];
// De kleur per soort, als expressie (kleuren uit de CSS, kleurenUitCss in neighborhood-map.js).
const kleurVan = (kleuren = {}) => ["match", ["get", "soort"], ...["evenement", "werken", "verkeer", "vergunning", "agenda"].flatMap((s) => [s, kleuren[s] || "gray"]), "gray"];
// Een ring van ONGEVEER_STRAAL meter: echte schaal vanaf zoom 15, daaronder klein maar zichtbaar.
const ringStraal = (meter) => ["interpolate", ["exponential", 2], ["zoom"], 12, 5, 15, meter / 3, 20, (meter / 3) * 32];
const leeg = () => ({ type: "FeatureCollection", features: [] });
const kaderNaarBounds = (k) => [[k[0], k[1]], [k[2], k[3]]];
const geldig = (k) => Array.isArray(k) && k.length === 4 && k.every(Number.isFinite);

// Een vectorkaart in een eigen vlak binnen `el`. `kader`: [w, z, o, n] van het eerste beeld (met `maxZoom` in
// Leaflet-zoom). Geeft een belofte van de adapter { soort: "vector", wijken, straat, items, markeer, kader,
// inBeeld, verwijder } — dezelfde vorm als de Leaflet-kaart.
export function maakVectorKaart(maplibregl, el, { stijl, kader = null, maxZoom = null, wijken = [], wijkStijl = () => ({}), onWijk = () => {}, pinHtml = () => "", pinNaam = () => "", signal = null } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("vectorkaart afgebroken")); return; }
    const vlak = document.createElement("div");
    vlak.className = "buurt-kaartvlak buurt-vector";
    el.append(vlak);
    let map = null, klaar = false, eersteTegel = false;
    const opruimen = () => { try { map?.remove(); } catch { /* al weg */ } vlak.remove(); };
    const faal = (fout) => {
      if (klaar) return;
      klaar = true;
      signal?.removeEventListener?.("abort", afbreken);
      opruimen();
      reject(fout instanceof Error ? fout : new Error(String(fout?.message || fout || "vectorkaart mislukt")));
    };
    const afbreken = () => faal(new Error("vectorkaart afgebroken"));
    signal?.addEventListener?.("abort", afbreken, { once: true });
    try {
      map = new maplibregl.Map({
        container: vlak,
        style: stijl,
        ...(geldig(kader) ? { bounds: kaderNaarBounds(kader), fitBoundsOptions: { padding: 16, ...(maxZoom ? { maxZoom: maxZoom - ZOOM_VERSCHIL } : {}) } } : { center: [4.41, 51.215], zoom: 12 }),
        maxZoom: MAX_ZOOM,
        scrollZoom: false,
        dragRotate: false,
        touchPitch: false,
        pitchWithRotate: false,
        attributionControl: { compact: true },
        locale: NL,
      });
    } catch (fout) {
      faal(fout); // geen WebGL
      return;
    }
    map.touchZoomRotate?.disableRotation?.();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    // Alleen fouten van de tegels tellen, en alleen vóór de eerste tegel: daarna blijft de kaart staan.
    map.on("error", (e) => { if (!eersteTegel && isTegelFout(e)) faal(e.error || new Error("de vectortegels laden niet")); });
    map.on("sourcedata", (e) => { if (e.sourceId === TEGELBRON && e.tile) eersteTegel = true; });
    map.on("idle", () => {
      if (klaar || !eersteTegel) return;
      klaar = true;
      signal?.removeEventListener?.("abort", afbreken);
      resolve(adapter);
    });

    // ---- eigen bronnen en lagen, bovenop de stijl ----
    let kleuren = {}, entryVan = new Map(), today = "", items = leeg(), markers = [], popup = null;
    map.once("load", () => {
      const wijkFc = { type: "FeatureCollection", features: wijken.map((f) => ({ type: "Feature", geometry: f.geometry, properties: { code: f.properties.code, naam: f.properties.naam } })) };
      const aan = wijkStijl("a", "a"), uit = wijkStijl("a", "");
      map.addSource("pa-wijken", { type: "geojson", data: wijkFc });
      map.addSource("pa-straat", { type: "geojson", data: leeg() });
      map.addSource("pa-items", { type: "geojson", data: leeg() });
      map.addLayer({ id: "pa-wijken-vlak", type: "fill", source: "pa-wijken", paint: { "fill-color": aan.fillColor || "gray", "fill-opacity": 0.02 } });
      map.addLayer({ id: "pa-wijken", type: "line", source: "pa-wijken", paint: { "line-color": uit.color || "gray", "line-width": 1, "line-opacity": 0.8, "line-dasharray": [3, 4] } });
      map.addLayer({ id: "pa-wijk-actief", type: "line", source: "pa-wijken", filter: ["==", ["get", "code"], ""], paint: { "line-color": aan.color || "gray", "line-width": 3 } });
      map.addLayer({ id: "pa-straat", type: "line", source: "pa-straat", layout: { "line-cap": "round" }, paint: { "line-color": "gray", "line-width": 6, "line-opacity": 0.75 } });
      map.addLayer({ id: "pa-vlak", type: "fill", source: "pa-items", filter: VLAK, paint: { "fill-color": "gray", "fill-opacity": 0.16, "fill-outline-color": "gray" } });
      map.addLayer({ id: "pa-lijn-rand", type: "line", source: "pa-items", filter: LIJN, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "white", "line-width": ["case", ["==", ["get", "parcours"], true], 9, 8], "line-opacity": 0.9 } });
      map.addLayer({ id: "pa-lijn", type: "line", source: "pa-items", filter: ["all", LIJN, ["!=", ["get", "soort"], "verkeer"]], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "gray", "line-width": ["case", ["==", ["get", "parcours"], true], 5, 4] } });
      map.addLayer({ id: "pa-lijn-verkeer", type: "line", source: "pa-items", filter: ["all", LIJN, ["==", ["get", "soort"], "verkeer"]], paint: { "line-color": "gray", "line-width": 4, "line-dasharray": [2, 1.5] } });
      map.addLayer({ id: "pa-ongeveer", type: "circle", source: "pa-items", filter: ["all", PUNT, ["==", ["get", "ongeveer"], true]], paint: { "circle-radius": ringStraal(ONGEVEER_STRAAL), "circle-color": "gray", "circle-opacity": 0.14, "circle-stroke-color": "gray", "circle-stroke-width": 2.5 } });
      map.addLayer({ id: "pa-punt", type: "circle", source: "pa-items", filter: ["all", PUNT, ["!=", ["get", "ongeveer"], true]], paint: { "circle-radius": 7, "circle-color": "gray", "circle-stroke-color": "white", "circle-stroke-width": 2 } });
      map.addLayer({ id: "pa-markering", type: "line", source: "pa-items", filter: ["==", ["get", "uid"], ""], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "gray", "line-width": 8, "line-opacity": 0.9 } });
      map.addLayer({ id: "pa-markering-punt", type: "circle", source: "pa-items", filter: ["all", PUNT, ["==", ["get", "uid"], ""]], paint: { "circle-radius": 11, "circle-opacity": 0, "circle-stroke-color": "gray", "circle-stroke-width": 4 } });
      // Tikken: een object opent zijn popup; anders kiest een tik de wijk.
      map.on("click", (e) => {
        const raak = map.queryRenderedFeatures(e.point, { layers: ITEM_LAGEN });
        if (raak.length) {
          const uids = [...new Set(raak.map((f) => f.properties.uid))];
          toonPopup(e.lngLat, uids.map((u) => entryVan.get(u)).filter(Boolean));
          return;
        }
        const wijk = map.queryRenderedFeatures(e.point, { layers: ["pa-wijken-vlak"] })[0];
        if (wijk) onWijk(wijk.properties.code);
      });
      for (const laag of ITEM_LAGEN) {
        map.on("mouseenter", laag, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", laag, () => { map.getCanvas().style.cursor = ""; });
      }
    });

    function toonPopup(lngLat, entries) {
      popup?.remove();
      if (!entries.length) return;
      popup = new maplibregl.Popup({ maxWidth: "280px", offset: 14 }).setLngLat(lngLat).setHTML(popupHtml(entries, today)).addTo(map);
    }
    const kleur = (naam) => kleuren[naam] || "gray";
    const adapter = {
      soort: "vector",
      wijken(actief = "") {
        if (!map.getLayer("pa-wijk-actief")) return;
        map.setFilter("pa-wijk-actief", ["==", ["get", "code"], actief || ""]);
        map.setPaintProperty("pa-wijken", "line-opacity", actief ? 0.35 : 0.8);
      },
      straat(segmenten = [], kleurStraat = "gray") {
        map.getSource("pa-straat")?.setData({ type: "FeatureCollection", features: segmenten.map((s) => ({ type: "Feature", geometry: { type: "LineString", coordinates: [s.a, s.b] }, properties: {} })) });
        if (map.getLayer("pa-straat")) map.setPaintProperty("pa-straat", "line-color", kleurStraat);
      },
      items({ lagen, entryVan: entries = new Map(), kleuren: k = {}, today: dag = "" }) {
        kleuren = k; entryVan = entries; today = dag; items = lagen.fc;
        popup?.remove();
        map.getSource("pa-items")?.setData(items);
        const perSoort = kleurVan(kleuren);
        for (const [laag, eigenschap] of [["pa-vlak", "fill-color"], ["pa-vlak", "fill-outline-color"], ["pa-lijn", "line-color"], ["pa-lijn-verkeer", "line-color"], ["pa-ongeveer", "circle-color"], ["pa-ongeveer", "circle-stroke-color"], ["pa-punt", "circle-color"]]) {
          if (map.getLayer(laag)) map.setPaintProperty(laag, eigenschap, perSoort);
        }
        if (map.getLayer("pa-lijn-rand")) map.setPaintProperty("pa-lijn-rand", "line-color", kleur("rand"));
        if (map.getLayer("pa-punt")) map.setPaintProperty("pa-punt", "circle-stroke-color", kleur("rand"));
        if (map.getLayer("pa-markering")) map.setPaintProperty("pa-markering", "line-color", kleur("straat"));
        if (map.getLayer("pa-markering-punt")) map.setPaintProperty("pa-markering-punt", "circle-stroke-color", kleur("straat"));
        // Agendapunten: een knop per plek (Marker), met de categorie en het emoji, zoals op de Leaflet-kaart.
        for (const { marker } of markers) marker.remove();
        markers = lagen.pins.map((pin) => {
          const knop = document.createElement("button");
          knop.type = "button";
          knop.className = "buurt-pin-wrap buurt-pin-knop";
          knop.setAttribute("aria-label", pinNaam(pin.entries));
          knop.innerHTML = pinHtml(pin.entries);
          knop.addEventListener("click", (event) => {
            event.stopPropagation();
            toonPopup({ lng: pin.point[0], lat: pin.point[1] }, pin.entries);
          });
          const marker = new maplibregl.Marker({ element: knop, anchor: "bottom" }).setLngLat(pin.point).addTo(map);
          return { marker, knop, uids: new Set(pin.uids) };
        });
      },
      markeer(uid = "") {
        const filter = ["==", ["get", "uid"], uid || ""];
        if (map.getLayer("pa-markering")) map.setFilter("pa-markering", ["all", ["!", PUNT], filter]);
        if (map.getLayer("pa-markering-punt")) map.setFilter("pa-markering-punt", ["all", PUNT, filter]);
        let gevonden = Boolean(uid) && items.features.some((f) => f.properties.uid === uid);
        for (const { knop, uids } of markers) {
          const aan = Boolean(uid) && uids.has(uid);
          knop.classList.toggle("is-gemarkeerd", aan);
          if (aan) gevonden = true;
        }
        return gevonden;
      },
      kader(k, { animate = true, maxZoom: zoom } = {}) {
        if (!geldig(k)) return;
        map.fitBounds(kaderNaarBounds(k), { padding: 16, animate, ...(zoom ? { maxZoom: zoom - ZOOM_VERSCHIL } : {}) });
      },
      inBeeld(k) {
        if (!geldig(k)) return false;
        const b = map.getBounds();
        return k[0] <= b.getEast() && k[2] >= b.getWest() && k[1] <= b.getNorth() && k[3] >= b.getSouth();
      },
      verwijder() { popup?.remove(); opruimen(); },
    };
  });
}
