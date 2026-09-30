// One presentation filter; source records and their privacy rules remain unchanged.
export const VIEW_THEMES = Object.freeze([
  ["activities", "Activiteiten"], ["neighborhood", "Buurt & straat"],
  ["markets", "Markten & foren"], ["meetings", "Raad & commissies"],
  ["works", "Werken & hinder"], ["publicSpace", "Parkeren & verkeer"],
  ["permits", "Vergunningen & terrassen"]
]);
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
  if (item?.theme === "Werken") return "works";
  const type = item?.eventType || "";
  if (type === "neighborhood" || type === "playstreet") return "neighborhood";
  if (type === "market_fair" || type === "flea_braderie" || item?.sourceId === "stad-markten") return "markets";
  if (type === "public_meeting" || item?.sourceId === "district-vergaderingen") return "meetings";
  return "activities";
}
export function createAgendaView({ resolveAddress = () => [] } = {}) {
  let query = "", selected = null;
  let themes = new Set(VIEW_THEMES.map(([key]) => key));
  const allowed = new Set(themes);
  return {
    get query() { return query; },
    get selected() { return selected; },
    get themes() { return new Set(themes); },
    setStreet(text, street = null) { query = String(text || "").trim(); selected = query && street?.name ? { ...street } : null; },
    setThemes(values) { themes = new Set((values || []).filter(key => allowed.has(key))); },
    enabled(key) { return themes.has(key === "terraces" ? "permits" : key); },
    matchesStreet(item) {
      if (!query) return true;
      if (!selected) return false; // Partial names and unknown locations never become guessed matches.
      const refs = Array.isArray(item?.streets) && item.streets.length ? item.streets : resolveAddress(item?.location || item?.address || "");
      return Array.isArray(refs) && refs.some(ref => sameStreet(ref, selected));
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
  const view = createAgendaView({ resolveAddress: address => index && resolver ? resolver(address, index).streets : [] });
  window.PUBLIC_AGENDA_VIEW = view;
  const stylesheet = document.createElement("link"); stylesheet.rel = "stylesheet"; stylesheet.href = "/agenda-view.css"; document.head.append(stylesheet);
  document.body.classList.add("agenda-focused");
  const refs = new Map(), options = new Map();
  let pendingKey = "", pendingText = "";
  const url = new URL(window.location.href);
  pendingKey = url.searchParams.get("straat") || "";
  if (!pendingKey) pendingText = url.searchParams.get("straatzoek") || "";
  if (url.searchParams.has("themas")) view.setThemes(url.searchParams.get("themas").split(","));
  // An explicit event deep link wins over a carried-over filter.
  if (url.searchParams.has("event") || /^#event=/.test(url.hash) || /^\/event\//.test(url.pathname)) {
    pendingKey = ""; pendingText = ""; view.setThemes(VIEW_THEMES.map(([key]) => key));
  }
  const previousInput = document.getElementById("agenda-street-jump");
  if (previousInput) previousInput.closest(".agenda-controls-group")?.setAttribute("hidden", "");
  const old = [...controls.children];
  const panel = document.createElement("div");
  panel.className = "view-primary";
  panel.innerHTML = '<div class="view-search-row"><div class="view-search"><label for="agenda-street-jump">Wat gebeurt er in jouw straat?</label><div class="view-search-slot"></div><datalist id="agenda-street-options"></datalist></div><button class="view-reset" type="button">Filters wissen</button></div><p class="view-search-note" id="agenda-street-help" aria-live="polite"></p><div class="view-themes" role="group" aria-label="Thema’s tonen of verbergen"></div><div class="view-all"><button type="button" data-view-all>Alles tonen</button><button type="button" data-view-none>Alles verbergen</button></div>';
  controls.prepend(panel);
  const search = previousInput || document.createElement("input");
  search.id = "agenda-street-jump"; search.type = "search"; search.placeholder = "Alle straten · zoek een straat";
  search.setAttribute("list", "agenda-street-options"); search.setAttribute("autocomplete", "off");
  search.setAttribute("aria-describedby", "agenda-street-help");
  panel.querySelector(".view-search-slot").append(search);
  const datalist = panel.querySelector("datalist"), hint = panel.querySelector(".view-search-note");
  const secondary = document.createElement("details"); secondary.className = "view-secondary";
  const secondaryLabel = document.createElement("summary"); secondaryLabel.textContent = "Verfijn activiteiten en gebied";
  secondary.append(secondaryLabel, ...old); controls.append(secondary);
  const chips = new Map();
  for (const [key, label] of VIEW_THEMES) {
    const button = document.createElement("button"); button.type = "button";
    button.textContent = label; button.dataset.viewTheme = key;
    button.addEventListener("click", () => {
      const next = view.themes; next.has(key) ? next.delete(key) : next.add(key);
      view.setThemes([...next]); changed();
    });
    panel.querySelector(".view-themes").append(button); chips.set(key, button);
  }
  const results = document.createElement("div"); results.className = "view-results";
  const resultTitle = document.createElement("h2"), resultNote = document.createElement("p");
  resultTitle.textContent = "Agenda"; results.append(resultTitle, resultNote);
  controls.after(results);
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
  const refresh = document.getElementById("agenda-refresh-note"); if (refresh) controls.before(refresh);
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
    view.setStreet(text, selected);
    if (notify) changed();
  }
  function updateChrome() {
    for (const [key, button] of chips) button.setAttribute("aria-pressed", String(view.enabled(key)));
    for (const { drawer, theme } of drawers) drawer.hidden = theme ? !view.enabled(theme) : view.themes.size === 0;
    resultTitle.textContent = view.selected ? `Agenda · ${view.selected.name}` : "Agenda";
    hint.textContent = !view.query
      ? (sourceFailed ? "Straatbron tijdelijk niet beschikbaar. Je kunt wel op thema filteren; alleen reeds brongekoppelde straten zijn te kiezen." : "Kies een officiële straat of bekijk alle straten. De thema’s gelden ook voor de overzichten hieronder.")
      : view.selected ? `${labelOf(view.selected)} · alleen betrouwbaar gekoppelde locaties.`
      : refs.size ? "Kies een straat uit de suggesties. Onbekende of gedeeltelijke namen worden niet als straatmatch getoond."
      : sourceFailed ? "De straatbron is niet beschikbaar. Deze straatselectie kan nog niet worden gecontroleerd." : "De officiële straatnamen worden geladen…";
    search.setAttribute("aria-invalid", String(Boolean(view.query && !view.selected && refs.size)));
  }
  function changed() {
    updateChrome();
    const next = new URL(window.location.href);
    for (const key of ["straat", "straatzoek", "themas"]) next.searchParams.delete(key);
    if (view.selected) next.searchParams.set("straat", streetId(view.selected));
    else if (view.query) next.searchParams.set("straatzoek", search.value || view.query);
    if (view.themes.size !== VIEW_THEMES.length) next.searchParams.set("themas", [...view.themes].join(","));
    try { window.history.replaceState(null, "", next); } catch { /* Filtering also works when URL writes are disallowed. */ }
    window.dispatchEvent(new CustomEvent("public-agenda:view-change"));
  }
  search.addEventListener("input", () => { pendingKey = ""; resolveInput(); });
  search.addEventListener("change", () => { pendingKey = ""; resolveInput(); });
  panel.querySelector(".view-reset").addEventListener("click", () => {
    pendingKey = ""; search.value = ""; view.setStreet(""); view.setThemes(VIEW_THEMES.map(([key]) => key));
    for (const input of document.querySelectorAll("[data-street-search],[data-works-search],[data-works-owner],[data-works-status],[data-space-search],[data-space-kind],[data-permits-search],[data-terraces-search]")) { input.value = ""; input.dispatchEvent(new Event("input", { bubbles: true })); }
    window.dispatchEvent(new CustomEvent("public-agenda:reset-filters")); changed(); search.focus();
  });
  panel.querySelector("[data-view-all]").addEventListener("click", () => { view.setThemes(VIEW_THEMES.map(([key]) => key)); changed(); });
  panel.querySelector("[data-view-none]").addEventListener("click", () => { view.setThemes([]); changed(); });
  window.addEventListener("public-agenda:agenda-view", event => {
    const count = Number(event.detail?.count) || 0;
    resultNote.textContent = `${count} agenda-items binnen je filters. Werken, verkeer en vergunningen staan in de uitklapbare overzichten.`;
  });
  window.addEventListener("public-agenda:street-layer", event => {
    addRefs((event.detail?.items || []).flatMap(item => item.streets || [])); changed();
  });
  search.value = pendingText; if (pendingKey) view.setStreet(pendingKey); else view.setStreet(pendingText);
  updateChrome(); changed();
  try {
    const [{ loadStreetIndex }, { resolveAddressStreet }] = await Promise.all([import("./street-source.js"), import("./street-core.js")]);
    resolver = resolveAddressStreet; index = await loadStreetIndex();
    addRefs([...index.byName.values()].flat()); changed();
  } catch {
    sourceFailed = true;
    addRefs(Object.values(window.PUBLIC_AGENDA_LIVE_STREETS || {}).flatMap(items => Array.isArray(items) ? items.flatMap(item => item.streets || []) : []));
    changed();
  }
}
