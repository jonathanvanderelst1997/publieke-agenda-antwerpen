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
  let query = "", selected = null;
  // Buurt: een wijk (code uit site/geo/wijken.geojson) en/of een straal rond de gekozen straat.
  // De kaart (neighborhood-map.js) levert de matcher; zolang die er niet is, filtert de wijk nog niet.
  let area = { wijk: "", radius: 0 }, areaMatcher = null;
  const allowed = new Set(VIEW_THEMES.map(([key]) => key));
  let themes = new Set(defaultThemes.filter(key => allowed.has(key)));
  const refsOf = item => Array.isArray(item?.streets) && item.streets.length ? item.streets : resolveAddress(item?.location || item?.address || "");
  return {
    get query() { return query; },
    get selected() { return selected; },
    get themes() { return new Set(themes); },
    get area() { return { ...area }; },
    get areaReady() { return Boolean(areaMatcher); },
    get areaLabel() { return area.wijk ? (areaMatcher?.labelFor?.(area.wijk) || area.wijk) : ""; },
    setStreet(text, street = null) { query = String(text || "").trim(); selected = query && street?.name ? { ...street } : null; },
    setThemes(values) { themes = new Set((values || []).filter(key => allowed.has(key))); },
    setArea({ wijk = area.wijk, radius = area.radius } = {}) {
      area = { wijk: /^[A-Z]{3}\d{2}$/.test(String(wijk || "")) ? String(wijk) : "", radius: RADII.includes(Number(radius)) ? Number(radius) : 0 };
    },
    setAreaMatcher(matcher) { areaMatcher = matcher && typeof matcher.inWijk === "function" ? matcher : null; },
    enabled(key) { return themes.has(key === "terraces" ? "permits" : key); },
    matchesStreet(item) {
      if (area.wijk && areaMatcher && !areaMatcher.inWijk(item, area.wijk, refsOf(item))) return false;
      if (!query) return true;
      if (!selected) return false; // Partial names and unknown locations never become guessed matches.
      const refs = refsOf(item);
      if (Array.isArray(refs) && refs.some(ref => sameStreet(ref, selected))) return true;
      // Straat + straal: ook wat binnen de straal van die straat ligt (alleen items met een echt punt).
      return Boolean(area.radius > 0 && areaMatcher?.nearStreet?.(item, selected, area.radius));
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

export async function mountAgendaView() {
  if (typeof window === "undefined" || typeof document === "undefined" || window.PUBLIC_AGENDA_VIEW) return;
  const controls = document.querySelector(".agenda-controls"), page = document.querySelector(".agenda-page");
  if (!controls || !page) return;
  let index = null, resolver = null, sourceFailed = false;
  const view = createAgendaView({ defaultThemes: DEFAULT_THEMES, resolveAddress: address => index && resolver ? resolver(address, index).streets : [] });
  window.PUBLIC_AGENDA_VIEW = view;
  const stylesheet = document.createElement("link"); stylesheet.rel = "stylesheet"; stylesheet.href = "/agenda-view.css";
  // Vóór agenda-uitgaan.css, zodat de kleuren en het donkere thema daarvan het laatste woord hebben.
  const uitgaanStyles = document.querySelector('link[href="/agenda-uitgaan.css"]');
  if (uitgaanStyles) uitgaanStyles.before(stylesheet); else document.head.append(stylesheet);
  document.body.classList.add("agenda-focused");
  const refs = new Map(), options = new Map();
  let pendingKey = "", pendingText = "";
  const url = new URL(window.location.href);
  pendingKey = url.searchParams.get("straat") || "";
  if (!pendingKey) pendingText = url.searchParams.get("straatzoek") || "";
  // customized: de bezoeker koos zelf soorten (of de link deed dat); dan raakt een straatkeuze ze niet aan.
  view.setArea({ wijk: url.searchParams.get("wijk") || "", radius: Number(url.searchParams.get("straal")) || 0 });
  let customized = url.searchParams.has("themas");
  if (customized) view.setThemes(url.searchParams.get("themas").split(","));
  // An explicit event deep link wins over a carried-over filter.
  if (url.searchParams.has("event") || /^#event=/.test(url.hash) || /^\/event\//.test(url.pathname)) {
    pendingKey = ""; pendingText = ""; view.setThemes(VIEW_THEMES.map(([key]) => key)); customized = true;
  }
  const previousInput = document.getElementById("agenda-street-jump");
  if (previousInput) previousInput.closest(".agenda-controls-group")?.setAttribute("hidden", "");
  const old = [...controls.children];
  const panel = document.createElement("div");
  panel.className = "view-primary";
  panel.innerHTML = '<div class="view-search-row"><div class="view-search"><label for="agenda-street-jump">Wat gebeurt er in jouw straat?</label><div class="view-search-slot"></div><datalist id="agenda-street-options"></datalist></div><button class="view-reset" type="button">Filters wissen</button></div><p class="view-search-note" id="agenda-street-help" aria-live="polite"></p><div class="view-themes-head"><strong>Uitgaan &amp; evenementen</strong><span>Standaard aan · tik om te verbergen</span></div><div class="view-themes" data-view-row="on" role="group" aria-label="Uitgaan en evenementen tonen of verbergen"></div><div class="view-themes-head view-themes-head-more"><strong>Meer tonen</strong><span>Standaard uit · één klik om toe te voegen</span></div><div class="view-themes view-themes-more" data-view-row="more" role="group" aria-label="Extra soorten tonen of verbergen"></div><div class="view-all"><button type="button" data-view-default>Terug naar uitgaan &amp; evenementen</button><button type="button" data-view-all>Alles tonen</button><button type="button" data-view-none>Alles verbergen</button></div>';
  controls.prepend(panel);
  const search = previousInput || document.createElement("input");
  search.id = "agenda-street-jump"; search.type = "search"; search.placeholder = "Alle straten · zoek een straat";
  search.setAttribute("list", "agenda-street-options"); search.setAttribute("autocomplete", "off");
  search.setAttribute("aria-describedby", "agenda-street-help");
  panel.querySelector(".view-search-slot").append(search);
  const datalist = panel.querySelector("datalist"), hint = panel.querySelector(".view-search-note");
  const secondary = document.createElement("details"); secondary.className = "view-secondary";
  const secondaryLabel = document.createElement("summary"); secondaryLabel.textContent = "Gebied: district of hele stad";
  secondary.append(secondaryLabel, ...old); controls.append(secondary);
  const chips = new Map();
  let counts = {};
  for (const [key, label, emoji, on] of VIEW_CATEGORIES) {
    const button = document.createElement("button"); button.type = "button";
    button.dataset.viewTheme = key; button.className = `view-chip cat-${key}`;
    button.innerHTML = `<span class="view-chip-emoji" aria-hidden="true">${emoji}</span><span class="view-chip-label"></span><span class="view-chip-count"></span>`;
    button.querySelector(".view-chip-label").textContent = label;
    button.addEventListener("click", () => {
      const next = view.themes; next.has(key) ? next.delete(key) : next.add(key);
      customized = true; view.setThemes([...next]); changed();
    });
    panel.querySelector(`[data-view-row="${on ? "on" : "more"}"]`).append(button); chips.set(key, button);
  }
  const results = document.createElement("div"); results.className = "view-results";
  const resultTitle = document.createElement("h2"), resultNote = document.createElement("p");
  resultTitle.textContent = "Agenda"; results.append(resultTitle, resultNote);
  // Volgorde: straat en soorten, dan de uitgelichte bovenrij, dan de volledige agenda.
  const highlights = document.getElementById("agenda-highlights");
  if (highlights) { controls.after(highlights); highlights.after(results); } else controls.after(results);
  const calendar = document.getElementById("agenda-list");
  if (calendar) results.after(calendar);
  // Keep the actual source nodes and handlers; only change their presentation order.
  const panels = [
    ["street-overview", "Alles per straat", null], ["works-live", "Werken en hinder", "works"],
    ["public-space-live", "Parkeerverboden en verkeer", "publicSpace"],
    ["permits-live", "Omgevingsdossiers", "permits"], ["terraces-live", "Terrasvergunningen", "permits"]
  ];
  const drawers = [];
  for (const [id, label, theme] of panels) {
    const node = document.getElementById(id); if (!node) continue;
    const drawer = document.createElement("details"); drawer.className = "view-drawer";
    drawer.dataset.viewLayer = id;
    const title = document.createElement("summary"); title.textContent = label;
    node.before(drawer); drawer.append(title, node); drawers.push({ drawer, theme });
  }
  let technical = document.querySelector(".agenda-technical-details");
  if (!technical) {
    technical = document.createElement("details"); technical.className = "agenda-technical-details";
    const title = document.createElement("summary"); title.textContent = "Bronnen en volledige vooruitblik"; technical.append(title);
  }
  for (const id of ["agenda-source-status", "week-pulse"]) {
    const node = document.getElementById(id); if (node) technical.append(node);
  }
  page.append(technical);
  // De technische broncontrole hoort bij de bronnen; bovenaan staat de vriendelijke versheidsmelding.
  const refresh = document.getElementById("agenda-refresh-note"); if (refresh) technical.append(refresh);
  const countLabel = document.querySelector(".agenda-count strong"); if (countLabel) countLabel.textContent = "agenda-items";

  const labelOf = street => `${street.name}${street.postcode ? ` · ${street.postcode}` : ""}`;
  function addRefs(values) {
    for (const ref of values || []) if (ref?.name) refs.set(streetId(ref), { id: String(ref.id || ""), name: String(ref.name), postcode: String(ref.postcode || "") });
    options.clear();
    for (const ref of [...refs.values()].sort((a, b) => a.name.localeCompare(b.name, "nl") || a.postcode.localeCompare(b.postcode))) {
      let label = labelOf(ref);
      if (options.has(label) && !sameStreet(options.get(label), ref)) label += ` · ${ref.id}`;
      options.set(label, ref);
    }
    datalist.replaceChildren();
    for (const label of options.keys()) { const option = document.createElement("option"); option.value = label; datalist.append(option); }
    resolveInput(false);
  }
  function resolveInput(notify = true) {
    let text = search.value.trim(), selected = options.get(text) || null;
    if (pendingKey) {
      selected = refs.get(pendingKey) || null;
      if (selected) { text = labelOf(selected); search.value = text; pendingKey = ""; }
      else text = pendingKey;
    }
    if (!selected && text) {
      const matches = [...refs.values()].filter(ref => cleanName(ref.name) === cleanName(text));
      if (matches.length === 1) selected = matches[0];
    }
    view.setStreet(text, selected); followStreet();
    if (notify) changed();
  }
  function updateChrome() {
    for (const [key, button] of chips) {
      button.setAttribute("aria-pressed", String(view.enabled(key)));
      const count = counts[key];
      button.querySelector(".view-chip-count").textContent = Number.isFinite(count) ? String(count) : "";
      button.classList.toggle("view-chip-empty", count === 0);
    }
    for (const { drawer, theme } of drawers) drawer.hidden = theme ? !view.enabled(theme) : view.themes.size === 0;
    const radius = view.area.radius, radiusText = radius >= 1000 ? `${radius / 1000} km` : `${radius} m`;
    resultTitle.textContent = view.selected
      ? `Alles in ${view.selected.name}${radius ? ` en ${radiusText} rond` : ""}${view.area.wijk ? ` · wijk ${view.areaLabel}` : ""}`
      : view.area.wijk ? `Alles in de wijk ${view.areaLabel}` : "Volledige agenda";
    hint.textContent = !view.query
      ? (sourceFailed ? "Straatbron tijdelijk niet beschikbaar. Je kunt wel op thema filteren; alleen reeds brongekoppelde straten zijn te kiezen." : "Kies een officiële straat of bekijk alle straten. De thema’s gelden ook voor de overzichten hieronder.")
      : view.selected ? `${labelOf(view.selected)} · alleen betrouwbaar gekoppelde locaties.${customized ? "" : " Werken, verkeer en vergunningen in deze straat staan nu ook aan."}`
      : refs.size ? "Kies een straat uit de suggesties. Onbekende of gedeeltelijke namen worden niet als straatmatch getoond."
      : sourceFailed ? "De straatbron is niet beschikbaar. Deze straatselectie kan nog niet worden gecontroleerd." : "De officiële straatnamen worden geladen…";
    search.setAttribute("aria-invalid", String(Boolean(view.query && !view.selected && refs.size)));
  }
  function changed() {
    updateChrome();
    const next = new URL(window.location.href);
    for (const key of ["straat", "straatzoek", "themas", "wijk", "straal"]) next.searchParams.delete(key);
    if (view.area.wijk) next.searchParams.set("wijk", view.area.wijk);
    if (view.area.radius && view.selected) next.searchParams.set("straal", String(view.area.radius));
    if (view.selected) next.searchParams.set("straat", streetId(view.selected));
    else if (view.query) next.searchParams.set("straatzoek", search.value || view.query);
    const defaults = new Set(DEFAULT_THEMES), current = view.themes;
    if (customized && (current.size !== defaults.size || [...current].some(key => !defaults.has(key)))) next.searchParams.set("themas", [...current].join(","));
    try { window.history.replaceState(null, "", next); } catch { /* Filtering also works when URL writes are disallowed. */ }
    window.dispatchEvent(new CustomEvent("public-agenda:view-change"));
  }
  search.addEventListener("input", () => { pendingKey = ""; resolveInput(); });
  search.addEventListener("change", () => { pendingKey = ""; resolveInput(); });
  panel.querySelector(".view-reset").addEventListener("click", () => {
    pendingKey = ""; search.value = ""; view.setStreet(""); view.setArea({ wijk: "", radius: 0 }); customized = false; view.setThemes(DEFAULT_THEMES);
    for (const input of document.querySelectorAll("[data-street-search],[data-works-search],[data-works-owner],[data-works-status],[data-space-search],[data-space-kind],[data-permits-search],[data-terraces-search]")) { input.value = ""; input.dispatchEvent(new Event("input", { bubbles: true })); }
    window.dispatchEvent(new CustomEvent("public-agenda:reset-filters")); changed(); search.focus();
  });
  panel.querySelector("[data-view-default]").addEventListener("click", () => { customized = false; view.setThemes(view.selected || view.area.wijk ? VIEW_THEMES.map(([key]) => key) : DEFAULT_THEMES); changed(); });
  panel.querySelector("[data-view-all]").addEventListener("click", () => { customized = true; view.setThemes(VIEW_THEMES.map(([key]) => key)); changed(); });
  panel.querySelector("[data-view-none]").addEventListener("click", () => { customized = true; view.setThemes([]); changed(); });
  // Een straat kiezen zonder eigen soortkeuze toont alles in die straat (ook werken en hinder);
  // de straat wissen keert terug naar uitgaan & evenementen.
  let hadStreet = false;
  function followStreet() {
    // Een straat of een wijk kiezen zonder eigen soortkeuze toont alles in die buurt.
    const hasStreet = Boolean(view.selected || view.area.wijk);
    if (!customized && hasStreet !== hadStreet) view.setThemes(hasStreet ? VIEW_THEMES.map(([key]) => key) : DEFAULT_THEMES);
    hadStreet = hasStreet;
  }
  window.addEventListener("public-agenda:agenda-view", event => {
    const count = Number(event.detail?.count) || 0;
    if (event.detail?.categoryCounts) { counts = { ...event.detail.categoryCounts }; updateChrome(); }
    resultNote.textContent = `${count} agenda-items binnen je keuze, per dag gerangschikt.`;
  });
  // De buurtkaart kiest een wijk of straal; de URL en alle lijsten volgen via changed().
  window.addEventListener("public-agenda:area-change", event => {
    view.setArea(event.detail || {}); followStreet(); changed();
  });
  window.addEventListener("public-agenda:area-ready", () => changed());
  window.addEventListener("public-agenda:street-layer", event => {
    addRefs((event.detail?.items || []).flatMap(item => item.streets || [])); changed();
  });
  search.value = pendingText; if (pendingKey) view.setStreet(pendingKey); else view.setStreet(pendingText);
  followStreet(); updateChrome(); changed();
  // De buurtkaart (wijken, kaart, straal) komt na de soorten en de bovenrij; faalt ze, dan blijft de rest werken.
  import("./neighborhood-map.js").then(({ mountNeighborhoodMap }) => mountNeighborhoodMap(view)).catch(() => {});
  try {
    const [{ loadStreetIndex }, { resolveAddressStreets }] = await Promise.all([import("./street-source.js"), import("./street-core.js")]);
    resolver = resolveAddressStreets; index = await loadStreetIndex();
    addRefs([...index.byName.values()].flat()); changed();
  } catch {
    sourceFailed = true;
    addRefs(Object.values(window.PUBLIC_AGENDA_LIVE_STREETS || {}).flatMap(items => Array.isArray(items) ? items.flatMap(item => item.streets || []) : []));
    changed();
  }
}
