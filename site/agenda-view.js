// One presentation filter; source records and their privacy rules remain unchanged.
// De soorten komen uit agenda-uitgaan.js; werken, parkeren en vergunningen zijn extra lagen.
import "./event-types.js";
import "./agenda-uitgaan.js";
const UITGAAN = globalThis.PublicAgendaUitgaan;
const LAYERS = [["publicSpace", "Parkeren & verkeer", "🅿️", false], ["permits", "Vergunningen & terrassen", "📄", false]];
export const VIEW_CATEGORIES = Object.freeze([
  ...UITGAAN.categories.map((c) => Object.freeze([c.key, c.label, c.emoji, c.on])),
  ...LAYERS.map((layer) => Object.freeze(layer))
]);
export const VIEW_THEMES = Object.freeze(VIEW_CATEGORIES.map(([key, label]) => Object.freeze([key, label])));
// "Uitgaan & evenementen": de leuke, publieke soorten staan aan; de rest met één klik.
export const DEFAULT_THEMES = Object.freeze(VIEW_CATEGORIES.filter(([, , , on]) => on).map(([key]) => key));
export const cleanName = value => String(value ?? "").normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
export const streetId = street => [street?.id || "", street?.name || "", street?.postcode || ""].join("|");
export function sameStreet(a, b) {
  if (!a?.name || !b?.name) return false;
  if (a.postcode && b.postcode && String(a.postcode) !== String(b.postcode)) return false;
  if (a.id && b.id) return String(a.id) === String(b.id);
  return cleanName(a.name) === cleanName(b.name);
}
export function agendaTheme(item) {
  return item?.category || UITGAAN.categoryOf(item || {});
}
export const RADII = Object.freeze([0, 250, 500, 1000]);
export function createAgendaView({ resolveAddress = () => [], defaultThemes = VIEW_THEMES.map(([key]) => key) } = {}) {
  let query = "", selected = null, resolver = resolveAddress, place = null;
  // Buurt: een wijk (code uit site/geo/wijken.geojson), een postcode en/of een straal rond de gekozen straat.
  // De kaart (neighborhood-map.js) levert de matcher; zolang die er niet is, filtert de wijk nog niet.
  let area = { wijk: "", radius: 0, postcode: "" }, areaMatcher = null;
  const allowed = new Set(VIEW_THEMES.map(([key]) => key));
  let themes = new Set(defaultThemes.filter(key => allowed.has(key)));
  // Straten van een item zonder eigen straten: één keer per item opzoeken en onthouden. Elke filter-
  // of tekenbeurt vraagt dit voor elk item; opnieuw zoeken over 1.600 straatnamen legde een gsm stil.
  // Een nieuwe resolver of een nieuwe straatindex (resetRefs) wist het geheugen.
  let refsMemo = new WeakMap();
  // Eén stratenlijst voor tonen én filteren: place-view.js geeft voor een evenementendossier de
  // straten van het parcours (ook die het alleen kruist) en voor een werk ook die van de werfzone.
  // Geeft die functie niets terug, dan gelden de eigen straten van het item.
  let streetLists = null;
  const refsOf = item => {
    const key = item && typeof item === "object" ? item : null;
    if (key && refsMemo.has(key)) return refsMemo.get(key);
    const lijst = streetLists ? streetLists(item) : null;
    const refs = Array.isArray(lijst) ? lijst
      : Array.isArray(item?.streets) && item.streets.length ? item.streets
        : resolver(item?.location || item?.address || "", item) || [];
    if (key) refsMemo.set(key, refs);
    return refs;
  };
  return {
    get query() { return query; },
    get selected() { return selected; },
    get themes() { return new Set(themes); },
    get area() { return { ...area }; },
    get areaReady() { return Boolean(areaMatcher); },
    get areaLabel() { return area.wijk ? (areaMatcher?.labelFor?.(area.wijk) || area.wijk) : ""; },
    // De gekozen plek uit de zoekbalk (straat, wijk of postcode), met haar kader voor de kaart.
    get place() { return place; },
    get hasPlace() { return Boolean(selected || area.wijk || area.postcode); },
    setPlace(value) { place = value && typeof value === "object" ? { ...value } : null; },
    setResolver(fn) { if (typeof fn === "function") { resolver = fn; refsMemo = new WeakMap(); } },
    resetRefs() { refsMemo = new WeakMap(); },
    setStreetLists(fn) { streetLists = typeof fn === "function" ? fn : null; refsMemo = new WeakMap(); },
    refsOf,
    setStreet(text, street = null) { query = String(text || "").trim(); selected = query && street?.name ? { ...street } : null; },
    setThemes(values) { themes = new Set((values || []).filter(key => allowed.has(key))); },
    setArea({ wijk = area.wijk, radius = area.radius, postcode = area.postcode } = {}) {
      area = {
        wijk: /^[A-Z]{3}\d{2}$/.test(String(wijk || "")) ? String(wijk) : "",
        radius: RADII.includes(Number(radius)) ? Number(radius) : 0,
        postcode: /^2\d{3}$/.test(String(postcode || "")) ? String(postcode) : ""
      };
    },
    setAreaMatcher(matcher) { areaMatcher = matcher && typeof matcher.inWijk === "function" ? matcher : null; },
    enabled(key) { return themes.has(key === "terraces" ? "permits" : key); },
    matchesStreet(item) {
      if (area.wijk && areaMatcher && !areaMatcher.inWijk(item, area.wijk, refsOf(item))) return false;
      if (area.postcode) {
        // Postcode: een officiële straat met die postcode, of een bron die de postcode zelf meegeeft.
        const codes = new Set([...(refsOf(item) || []).map(ref => String(ref?.postcode || "")), ...(Array.isArray(item?.postcodes) ? item.postcodes.map(String) : []), String(item?.postcode || "")]);
        if (!codes.has(area.postcode)) return false;
      }
      if (!query) return true;
      if (!selected) return false; // Partial names and unknown locations never become guessed matches.
      const refs = refsOf(item);
      if (Array.isArray(refs) && refs.some(ref => sameStreet(ref, selected))) return true;
      // Straat + straal: ook wat binnen de straal van die straat ligt: met een punt (GIPOD, geocodering)
      // telt het punt, zonder punt (parcours, vergunning, parkeerverbod) telt één van zijn straten.
      return Boolean(area.radius > 0 && areaMatcher?.nearStreet?.(item, selected, area.radius, refs));
    },
    matches(item, theme) { return this.enabled(theme) && this.matchesStreet(item); },
    matchesAgenda(item) { return this.matches(item, agendaTheme(item)); }
  };
}

export async function settleSources(jobs) {
  return Promise.all(jobs.map(async ([name, promise]) => {
    try { return [name, await promise]; }
    catch (error) { return [name, error instanceof Error ? error : new Error(String(error))]; }
  }));
}

// De pagina zelf: één zoekbalk (straat, wijk of postcode), een plekoverzicht met lijst en kalender,
// en de kaart. De UI staat in place-view.js; deze filter blijft de enige waarheid voor alle lagen.
export async function mountAgendaView() {
  if (typeof window === "undefined" || typeof document === "undefined" || window.PUBLIC_AGENDA_VIEW) return;
  const controls = document.querySelector(".agenda-controls"), page = document.querySelector(".agenda-page");
  if (!controls || !page) return;
  const view = createAgendaView({ defaultThemes: DEFAULT_THEMES });
  window.PUBLIC_AGENDA_VIEW = view;
  const stylesheet = document.createElement("link"); stylesheet.rel = "stylesheet"; stylesheet.href = "/agenda-view.css";
  // Vóór agenda-uitgaan.css, zodat de kleuren en het donkere thema daarvan het laatste woord hebben.
  const uitgaanStyles = document.querySelector('link[href="/agenda-uitgaan.css"]');
  if (uitgaanStyles) uitgaanStyles.before(stylesheet); else document.head.append(stylesheet);
  document.body.classList.add("agenda-focused");
  const { mountPlaceView } = await import("./place-view.js");
  await mountPlaceView(view, { defaultThemes: DEFAULT_THEMES, allThemes: VIEW_THEMES.map(([key]) => key) });
}
