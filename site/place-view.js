// Zoek op plek: één zoekbalk voor straat, wijk of postcode, en daarna één overzicht van alles op die
// plek (evenementen, lopende en geplande werken, verkeersmaatregelen, inspraak, markten, vergunningen)
// als lijst, week of maand. De kaart zoomt mee. Alleen presentatie: de items, bronnen en
// publicatieregels komen ongewijzigd uit agenda.js en de live lagen; de filter is agenda-view.js.
import {
  KIND_GROUPS, DEFAULT_GROUPS, PERIODS, themesForGroups, groupsForThemes,
  buildPlaceIndex, searchPlaces, otherDistrictFor, placeParam, resolvePlaceParam, parseQuery,
  periodRange, monthWeeks, startOfWeek, startOfMonth, addDays, addMonths, daysBetween, weekdayMon0,
  layoutWeekBars, groupForList, overlaps, agendaEntry, workEntry, publicSpaceEntries, permitEntry, summarize,
} from "./place-core.js";
import { kaartSvg } from "./kaart-uitleg.js";
import { allesFilterActie } from "./filter-action-ux.js";
import { duidelijkeKaart } from "./permit-clarity.js";
import {bezoekersLinks,bezoekersHint,leesbaarUur} from "./bezoekers-bronnen.js";
import {publiekeMarktUur} from "./publieke-markturen.js";
import { locationKey, wijkFeatures, bboxOf, wijkOf } from "./neighborhood-core.js";
import { resolveAddressStreets, resolvePointStreet } from "./street-core.js";

const esc = (v = "") => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
const cssId = (v) => String(v).replace(/[^a-zA-Z0-9_-]/g, "_");
const MONTHS = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const MONTHS_SHORT = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const WEEKDAYS = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"];
const WEEKDAYS_SHORT = ["ma", "di", "wo", "do", "vr", "za", "zo"];
const QUICK_WIJKEN = ["ANT09", "ANT24", "ANT25", "ANT10", "ANT05", "ANT11", "ANT20"];
const MODES = [["lijst", "Lijst"], ["week", "Week"], ["maand", "Maand"]];
const SECTION_LIMIT = 12;

const dayNum = (iso) => Number(iso.slice(8, 10));
const monthOf = (iso) => Number(iso.slice(5, 7)) - 1;
const shortDate = (iso) => (iso ? `${dayNum(iso)} ${MONTHS_SHORT[monthOf(iso)]}` : "");
const longDate = (iso) => (iso ? `${WEEKDAYS[weekdayMon0(iso)]} ${dayNum(iso)} ${MONTHS[monthOf(iso)]}` : "");
const fullDate = (iso) => (iso ? `${dayNum(iso)} ${MONTHS[monthOf(iso)]} ${iso.slice(0, 4)}` : "");

function brusselsToday() {
  const now = typeof window.PUBLIC_AGENDA_CLOCK === "function" ? window.PUBLIC_AGENDA_CLOCK() : new Date();
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function kindInfo(entry) {
  if (entry.source === "works") return { label: "Werken", emoji: "🚧", cat: "works" };
  if (entry.source === "publicSpace" && entry.item?.kind === "event") return { label: "Evenement op straat", emoji: "🚦", cat: "publicSpace" };
  if (entry.source === "publicSpace") return { label: entry.item?.kind === "parking" ? "Parkeerverbod" : "Verkeer & inname", emoji: entry.item?.kind === "parking" ? "🅿️" : "🚦", cat: "publicSpace" };
  if (entry.source === "permits" || entry.source === "terraces") return { label: entry.source === "terraces" ? "Terras" : "Vergunning", emoji: "📄", cat: "permits" };
  const cat = window.PublicAgendaUitgaan?.categoryFor?.(entry.theme) || { key: "other", label: "Agenda", emoji: "📌" };
  return { label: cat.label, emoji: cat.emoji, cat: cat.key };
}

export async function mountPlaceView(view, { defaultThemes = [], allThemes = [] } = {}) {
  const page = document.querySelector(".agenda-page");
  const controls = document.querySelector(".agenda-controls");
  if (!page || !controls) return;
  document.body.classList.add("plek-ui");

  // ---- toestand ----
  const url = new URL(window.location.href);
  const state = {
    place: null,
    groups: new Set(DEFAULT_GROUPS),
    customized: false,
    period: PERIODS.some(([k]) => k === url.searchParams.get("periode")) ? url.searchParams.get("periode") : "maand",
    mode: MODES.some(([k]) => k === url.searchParams.get("weergave")) ? url.searchParams.get("weergave") : "lijst",
    cursor: "",
    selectedDay: "",
    open: new Set(),
    expanded: new Set(),
    radius: [0, 250, 500, 1000].includes(Number(url.searchParams.get("straal"))) ? Number(url.searchParams.get("straal")) : 0,
    counts: {},
    eventId: url.searchParams.get("event") || (/^#event=(.+)$/.exec(url.hash)?.[1] ?? "") || (/^\/event\/([^/]+)/.exec(url.pathname)?.[1] ?? ""),
  };
  if (url.searchParams.has("soort")) {
    state.groups = new Set(url.searchParams.get("soort").split(",").filter((k) => KIND_GROUPS.some((g) => g.key === k)));
    state.customized = true;
  } else if (url.searchParams.has("themas")) {
    state.groups = new Set(groupsForThemes(url.searchParams.get("themas").split(",")));
    state.customized = true;
  }
  if (state.eventId) { state.groups = new Set(KIND_GROUPS.map((g) => g.key)); state.customized = true; state.period = "alles"; state.open.add(`agenda:${decodeURIComponent(state.eventId)}`); }
  view.setThemes(themesForGroups([...state.groups]));

  // ---- opbouw van de pagina ----
  const search = document.getElementById("agenda-street-jump") || document.createElement("input");
  const oldGroups = [...controls.children];
  const hero = document.createElement("div");
  hero.className = "pv-hero";
  hero.innerHTML = `
    <div class="pv-search" role="search">
      <label class="pv-search-label" for="agenda-street-jump">Zoek je straat, wijk of postcode</label>
      <div class="pv-search-box">
        <span class="pv-search-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M16.5 16.5 21 21" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></span>
        <span class="pv-search-slot"></span>
        <button type="button" class="pv-search-clear" aria-label="Zoekveld en plek wissen" hidden>×</button>
      </div>
      <ul id="pv-suggestions" class="pv-suggestions" role="listbox" aria-label="Suggesties" hidden></ul>
      <p id="pv-search-help" class="pv-search-help" aria-live="polite"></p>
    </div>
    <div class="pv-quick" aria-label="Snel kiezen">
      <button type="button" class="pv-quick-locate"><span aria-hidden="true">◎</span> Mijn buurt</button>
      <span class="pv-quick-list"></span>
    </div>`;
  controls.replaceChildren(hero);
  controls.classList.add("pv-controls");
  controls.setAttribute("aria-label", "Zoek op plek");
  Object.assign(search, { id: "agenda-street-jump", type: "search", placeholder: "Bv. Kammenstraat, Zurenborg of 2060" });
  search.removeAttribute("list");
  for (const [k, v] of Object.entries({ role: "combobox", "aria-autocomplete": "list", "aria-expanded": "false", "aria-controls": "pv-suggestions", "aria-describedby": "pv-search-help", autocomplete: "off", autocapitalize: "words", spellcheck: "false", enterkeyhint: "search" })) search.setAttribute(k, v);
  search.className = "pv-search-input";
  hero.querySelector(".pv-search-slot").replaceWith(search);
  const $h = (s) => hero.querySelector(s);
  const listbox = $h("#pv-suggestions"), help = $h("#pv-search-help"), clearBtn = $h(".pv-search-clear"), quickList = $h(".pv-quick-list"), locateBtn = $h(".pv-quick-locate");

  const section = document.createElement("section");
  section.id = "plek";
  section.className = "pv";
  section.setAttribute("aria-labelledby", "pv-title");
  section.innerHTML = `
    <div class="pv-place" hidden></div>
    <div class="pv-layout">
      <div class="pv-main">
        <div class="pv-head">
          <div><h2 id="pv-title" tabindex="-1">Wat staat er op de agenda?</h2><p class="pv-sub" aria-live="polite" aria-atomic="true"></p></div>
        </div>
        <div class="pv-toolbar">
          <div class="pv-groups" role="group" aria-label="Soort tonen of verbergen"></div>
          <p class="pv-group-scroll-hint">Veeg horizontaal om meer onderwerpen te zien.</p>
          <div class="pv-toolbar-row">
            <div class="pv-seg pv-modes" role="group" aria-label="Weergave"></div>
            <div class="pv-seg pv-periods" role="group" aria-label="Periode"></div>
            <div class="pv-nav" hidden><button type="button" class="pv-nav-prev" aria-label="Vorige">‹</button><strong class="pv-nav-label" aria-live="polite"></strong><button type="button" class="pv-nav-next" aria-label="Volgende">›</button><button type="button" class="pv-nav-today">Vandaag</button></div>
          </div>
        </div>
        <div class="pv-loading" aria-live="polite"></div>
        <div class="pv-results"></div>
      </div>
      <aside class="pv-aside" aria-label="Kaart"></aside>
    </div>`;
  const $ = (s) => section.querySelector(s);
  const placeBox = $(".pv-place"), titleEl = $("#pv-title"), subEl = $(".pv-sub"), groupsEl = $(".pv-groups"), modesEl = $(".pv-modes"), periodsEl = $(".pv-periods"), navEl = $(".pv-nav"), results = $(".pv-results"), loadingEl = $(".pv-loading"), aside = $(".pv-aside");
  controls.after(section);

  // Uitgelicht blijft de opener zonder plek; met een plek is het overzicht zelf de hoofdzaak.
  const highlights = document.getElementById("agenda-highlights");
  if (highlights) section.after(highlights);

  // Alles wat er vroeger los onder stond (lijsten per laag, bronnen, gebied) in één inklapbaar blok.
  const more = document.createElement("details");
  more.className = "pv-more";
  more.innerHTML = `<summary><span>Alle lijsten, bronnen en instellingen</span><small>Volledige lijsten per laag met eigen zoekveld, district of hele stad, versheid per bron</small></summary><div class="pv-more-body"></div>`;
  const moreBody = more.querySelector(".pv-more-body");
  const scopeWrap = document.createElement("div");
  scopeWrap.className = "pv-more-scope";
  for (const group of oldGroups) if (!group.querySelector("#agenda-street-jump") && !group.contains(search)) scopeWrap.append(group);
  for (const group of scopeWrap.querySelectorAll("[hidden]")) if (group.classList.contains("agenda-controls-group")) group.remove();
  moreBody.append(scopeWrap);
  for (const id of ["street-overview", "works-live", "public-space-live", "permits-live", "terraces-live"]) {
    const node = document.getElementById(id);
    if (node) moreBody.append(node);
  }
  const technical = document.querySelector(".agenda-technical-details");
  if (technical) moreBody.append(technical);
  const refreshNote = document.getElementById("agenda-refresh-note");
  if (refreshNote && technical) technical.append(refreshNote);
  page.append(more);
  const oldList = document.getElementById("agenda-list");
  if (oldList) { oldList.hidden = true; oldList.classList.add("pv-legacy-list"); }
  const countLabel = document.querySelector(".agenda-count strong");
  if (countLabel) countLabel.textContent = "agenda-items";

  // ---- kaart ----
  import("./neighborhood-map.js")
    .then(({ mountNeighborhoodMap }) => {
      const pending = mountNeighborhoodMap(view);
      const map = document.getElementById("buurtkaart");
      if (map) aside.append(map);
      return pending;
    })
    .catch(() => { aside.hidden = true; });

  // ---- gegevens: straten, wijken, locaties ----
  let index = null, staticIndex = null, liveIndex = null, wijken = [], geo = { entries: {} }, refsByName = new Map();
  try {
    const [straten, wijkDoc, geoDoc] = await Promise.all([
      getJson("/geo/straten.json"),
      getJson("/geo/wijken.geo.json"),
      getJson("/geo/locaties.json").catch(() => ({ entries: {} })),
    ]);
    wijken = wijkFeatures(wijkDoc).filter((f) => f.properties.code.startsWith("ANT"));
    geo = geoDoc && typeof geoDoc.entries === "object" ? geoDoc : { entries: {} };
    const streets = Array.isArray(straten?.streets) ? straten.streets : [];
    index = buildPlaceIndex({ streets, wijken: wijken.map((f) => ({ code: f.properties.code, naam: f.properties.naam, box: bboxOf(f.geometry) })) });
    // Lichte straatindex (alleen namen) zodat agendalocaties meteen aan een straat hangen,
    // ook voor de live straatas binnen is.
    const byName = new Map();
    for (const [id, name, postcode] of streets) {
      const key = locationKey(name);
      const ref = { id: String(id), name, postcode: String(postcode || "") };
      byName.set(key, [...(byName.get(key) || []), ref]);
    }
    staticIndex = { byName };
    refsByName = byName;
  } catch {
    help.textContent = "De straatnamen konden nu niet geladen worden. De agenda hieronder werkt gewoon; probeer straks opnieuw te zoeken.";
  }
  view.setResolver((address, item) => {
    const idx = liveIndex || staticIndex;
    const found = idx ? resolveAddressStreets(address, idx).streets : [];
    if (found.length) return found;
    // Een geocodeerde locatie (site/geo/locaties.json) kent de officiële straat, ook bij een tikfout
    // in de brontekst ("Schrijfstraat 105" is de Schijfstraat).
    const entry = geo.entries?.[locationKey(address || item?.address || "")];
    if (entry?.street) return (refsByName.get(locationKey(entry.street)) || []).filter((ref) => !entry.postcode || ref.postcode === String(entry.postcode));
    return [];
  });
  import("./street-source.js")
    .then(({ loadStreetIndex }) => loadStreetIndex())
    .then((live) => { liveIndex = live; announce(); })
    .catch(() => { /* De statische straatlijst volstaat voor zoeken en koppelen. */ });
  // Uitleg uit de dataverversing (huisnummers, gekoppeld evenement, parcourslijn). Zonder dit
  // bestand maken de kaartjes hun uitleg uit de live lagen alleen.
  // Pas laden zodra een live laag er is: zonder werken of innames is het niet nodig.
  let kaartUitleg = null, kaartUitlegGevraagd = false;
  const vraagKaartUitleg = () => {
    if (kaartUitlegGevraagd) return;
    kaartUitlegGevraagd = true;
    getJson("/sources/kaart-uitleg.json").then((doc) => { kaartUitleg = doc; announce(); }).catch(() => {});
  };
  const wijkVan = (straat) => {
    const place = index?.places.find((p) => p.type === "straat" && p.name === straat);
    return (place?.wijken?.[0] && index.byKey.get(`wijk:${place.wijken[0]}`)?.label) || "";
  };

  // ---- plek kiezen ----
  function streetRef(place) { return { id: place.id, name: place.name, postcode: place.postcode }; }
  function applyPlace(place, { focusResults = false } = {}) {
    state.place = place || null;
    view.setPlace(place ? { key: place.key, type: place.type, label: place.label, box: place.box } : null);
    if (place?.type === "straat") { view.setStreet(place.name, streetRef(place)); view.setArea({ wijk: "", postcode: "", radius: state.radius }); }
    else if (place?.type === "wijk") { view.setStreet(""); view.setArea({ wijk: place.code, postcode: "", radius: 0 }); }
    else if (place?.type === "postcode") { view.setStreet(""); view.setArea({ wijk: "", postcode: place.code, radius: 0 }); }
    else { view.setStreet(""); view.setArea({ wijk: "", postcode: "", radius: 0 }); }
    if (!state.customized) state.groups = new Set(place ? KIND_GROUPS.map((g) => g.key) : DEFAULT_GROUPS);
    view.setThemes(themesForGroups([...state.groups]));
    state.expanded.clear();
    search.value = place ? (place.type === "straat" && place.ambiguous ? `${place.label} (${place.postcode})` : place.type === "postcode" ? `${place.code} · ${place.sub}` : place.label) : search.value;
    clearBtn.hidden = !search.value;
    closeSuggestions();
    document.body.classList.toggle("has-place", Boolean(place));
    help.textContent = place ? "" : help.textContent;
    announce();
    if (focusResults) {
      section.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      titleEl.focus({ preventScroll: true });
    }
  }
  function announce() {
    writeUrl();
    window.dispatchEvent(new CustomEvent("public-agenda:view-change"));
    cancelAnimationFrame(frame);
    render();
  }
  function writeUrl() {
    const next = new URL(window.location.href);
    for (const key of ["straat", "straatzoek", "themas", "wijk", "straal", "plek", "soort", "periode", "weergave"]) next.searchParams.delete(key);
    if (state.place && index) next.searchParams.set("plek", placeParam(state.place, index));
    if (state.place?.type === "straat" && state.radius) next.searchParams.set("straal", String(state.radius));
    const defaults = state.place ? KIND_GROUPS.map((g) => g.key) : DEFAULT_GROUPS;
    const current = KIND_GROUPS.map((g) => g.key).filter((k) => state.groups.has(k));
    if (state.customized && current.join(",") !== defaults.join(",")) next.searchParams.set("soort", current.join(","));
    if (state.period !== "maand") next.searchParams.set("periode", state.period);
    if (state.mode !== "lijst") next.searchParams.set("weergave", state.mode);
    try { window.history.replaceState(null, "", next); } catch { /* Filteren werkt ook zonder URL. */ }
  }

  // ---- zoeksuggesties (combobox) ----
  let suggestions = [], active = -1;
  function highlight(label, query) {
    const q = parseQuery(query).text;
    if (!q) return esc(label);
    const folded = label.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const at = folded.indexOf(q.split(" ")[0]);
    if (at < 0) return esc(label);
    const len = q.split(" ")[0].length;
    return `${esc(label.slice(0, at))}<mark>${esc(label.slice(at, at + len))}</mark>${esc(label.slice(at + len))}`;
  }
  function placeIcon(place) { return place.type === "wijk" ? "🏘️" : place.type === "postcode" ? "✉️" : "📍"; }
  function renderSuggestions() {
    const query = search.value;
    clearBtn.hidden = !query;
    if (!index || !query.trim()) { closeSuggestions(); help.textContent = index ? "" : help.textContent; return; }
    const other = otherDistrictFor(query);
    suggestions = searchPlaces(index, query, { limit: 8 });
    active = suggestions.length ? 0 : -1;
    const fuzzy = suggestions.length && suggestions.every((s) => s.match === "fuzzy");
    if (other) {
      listbox.innerHTML = `<li class="pv-sugg-note" role="presentation">${esc(other)} is een ander district. Deze agenda gaat over district Antwerpen (2000, 2018, 2020, 2030, 2050 en 2060).</li>`;
      listbox.hidden = false; search.setAttribute("aria-expanded", "false"); search.removeAttribute("aria-activedescendant");
      help.textContent = `${other} ligt buiten district Antwerpen.`;
      return;
    }
    if (!suggestions.length) {
      listbox.innerHTML = `<li class="pv-sugg-note" role="presentation">Geen straat, wijk of postcode gevonden voor “${esc(query.trim())}”. Probeer alleen de straatnaam (zonder nummer), of een wijk zoals <strong>Zuid</strong> of <strong>Kiel</strong>.</li>`;
      listbox.hidden = false; search.setAttribute("aria-expanded", "false"); search.removeAttribute("aria-activedescendant");
      help.textContent = "Geen suggesties.";
      return;
    }
    listbox.innerHTML = (fuzzy ? `<li class="pv-sugg-note" role="presentation">Bedoelde je…</li>` : "") + suggestions.map(({ place }, i) => `
      <li id="pv-opt-${i}" role="option" class="pv-sugg pv-sugg-${place.type}" aria-selected="${i === active}" data-index="${i}">
        <span class="pv-sugg-icon" aria-hidden="true">${placeIcon(place)}</span>
        <span class="pv-sugg-text"><strong>${highlight(place.label, query)}</strong><small>${esc(place.type === "straat" ? `straat · ${place.sub}` : place.sub)}</small></span>
      </li>`).join("");
    listbox.hidden = false;
    search.setAttribute("aria-expanded", "true");
    search.setAttribute("aria-activedescendant", "pv-opt-0");
    help.textContent = `${suggestions.length} suggestie${suggestions.length === 1 ? "" : "s"}. Pijltjes om te kiezen, Enter om te openen.`;
    help.classList.add("pv-sr");
  }
  function closeSuggestions() {
    help.classList.remove("pv-sr");
    listbox.hidden = true; listbox.innerHTML = ""; suggestions = []; active = -1;
    search.setAttribute("aria-expanded", "false"); search.removeAttribute("aria-activedescendant");
  }
  function moveActive(delta) {
    if (!suggestions.length) return;
    active = (active + delta + suggestions.length) % suggestions.length;
    for (const el of listbox.querySelectorAll("[role=option]")) el.setAttribute("aria-selected", String(Number(el.dataset.index) === active));
    search.setAttribute("aria-activedescendant", `pv-opt-${active}`);
    listbox.querySelector(`#pv-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }
  search.addEventListener("input", renderSuggestions);
  search.addEventListener("focus", () => { if (search.value && !state.place) renderSuggestions(); });
  search.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") { event.preventDefault(); if (listbox.hidden) renderSuggestions(); else moveActive(1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); moveActive(-1); }
    else if (event.key === "Enter") {
      event.preventDefault();
      if (!suggestions.length && search.value.trim()) renderSuggestions();
      if (suggestions[active]) applyPlace(suggestions[active].place, { focusResults: true });
    } else if (event.key === "Escape") {
      if (!listbox.hidden) closeSuggestions(); else if (search.value) clearBtn.click();
    }
  });
  listbox.addEventListener("mousedown", (event) => event.preventDefault()); // focus blijft in het zoekveld
  listbox.addEventListener("click", (event) => {
    const option = event.target.closest("[role=option]");
    if (option) applyPlace(suggestions[Number(option.dataset.index)]?.place, { focusResults: true });
  });
  search.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== search) closeSuggestions(); }, 150));
  clearBtn.addEventListener("click", () => {
    search.value = ""; clearBtn.hidden = true; help.textContent = "";
    if (!state.customized) state.groups = new Set(DEFAULT_GROUPS);
    applyPlace(null);
    window.dispatchEvent(new CustomEvent("public-agenda:reset-filters"));
    search.focus();
  });

  function renderQuick() {
    if (!index) return;
    quickList.innerHTML = QUICK_WIJKEN.map((code) => index.byKey.get(`wijk:${code}`)).filter(Boolean)
      .map((place) => `<button type="button" class="pv-quick-chip" data-key="${esc(place.key)}">${esc(place.label)}</button>`).join("");
  }
  quickList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-key]");
    if (button) applyPlace(index.byKey.get(button.dataset.key), { focusResults: true });
  });
  // Mijn buurt: de locatie blijft in de browser; we zoeken er alleen de wijk (en straat) bij.
  locateBtn.addEventListener("click", () => {
    if (!navigator.geolocation) { help.textContent = "Je toestel deelt geen locatie. Typ je straat of wijk."; return; }
    help.textContent = "Locatie opvragen…";
    navigator.geolocation.getCurrentPosition((pos) => {
      const point = [pos.coords.longitude, pos.coords.latitude];
      const street = liveIndex ? resolvePointStreet(point, liveIndex, { maxDistanceMeters: 60 }).streets[0] : null;
      const streetPlace = street && index.byKey.get(`straat:${street.id}|${street.name}|${street.postcode}`);
      const code = wijkOf(point, wijken);
      const place = streetPlace || (code && index.byKey.get(`wijk:${code}`));
      if (place) { help.textContent = ""; applyPlace(place, { focusResults: true }); }
      else help.textContent = "Je locatie ligt niet in district Antwerpen. Typ een straat of wijk.";
    }, () => { help.textContent = "Locatie niet beschikbaar. Typ je straat of wijk."; }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  });

  // ---- werkbalk ----
  function renderToolbar() {
    const today = brusselsToday();
    const chips = KIND_GROUPS.map((g) => {
      const on = state.groups.has(g.key), n = state.counts[g.key];
      return `<button type="button" class="pv-chip cat-${g.cat}${n === 0 ? " pv-chip-zero" : ""}" data-group="${g.key}" aria-pressed="${on}"><span aria-hidden="true">${g.emoji}</span> ${esc(g.label)}${Number.isFinite(n) ? ` <span class="pv-chip-n">${n}</span>` : ""}</button>`;
    });
    const allesActie = allesFilterActie(state.groups.size, KIND_GROUPS.length, Boolean(state.place));
    groupsEl.innerHTML = `<button type="button" class="pv-chip pv-chip-all" data-group="*" aria-label="${esc(allesActie)}" aria-pressed="${state.groups.size === KIND_GROUPS.length}">${esc(allesActie)}</button>${chips.join("")}`;
    modesEl.innerHTML = MODES.map(([k, label]) => `<button type="button" data-mode="${k}" aria-pressed="${state.mode === k}">${label}</button>`).join("");
    periodsEl.hidden = state.mode !== "lijst";
    periodsEl.innerHTML = PERIODS.map(([k, label]) => `<button type="button" data-period="${k}" aria-pressed="${state.period === k}">${label}</button>`).join("");
    navEl.hidden = state.mode === "lijst";
    if (state.mode === "maand") navEl.querySelector(".pv-nav-label").textContent = `${MONTHS[monthOf(state.cursor)]} ${state.cursor.slice(0, 4)}`;
    if (state.mode === "week") { const end = addDays(state.cursor, 6); navEl.querySelector(".pv-nav-label").textContent = `${shortDate(state.cursor)} – ${shortDate(end)}`; }
    navEl.querySelector(".pv-nav-today").disabled = state.mode === "maand" ? startOfMonth(today) === state.cursor : startOfWeek(today) === state.cursor;
  }
  groupsEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-group]");
    if (!button) return;
    const key = button.dataset.group;
    if (key === "*") state.groups = new Set(state.groups.size === KIND_GROUPS.length ? (state.place ? [] : DEFAULT_GROUPS) : KIND_GROUPS.map((g) => g.key));
    else if (state.groups.has(key)) state.groups.delete(key); else state.groups.add(key);
    state.customized = true;
    view.wantsLiveLayers = true;
    view.setThemes(themesForGroups([...state.groups]));
    announce();
  });
  modesEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mode]");
    if (!button) return;
    state.mode = button.dataset.mode;
    const today = brusselsToday();
    state.cursor = state.mode === "maand" ? startOfMonth(today) : startOfWeek(today);
    state.selectedDay = today;
    writeUrl(); render();
  });
  periodsEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-period]");
    if (!button) return;
    state.period = button.dataset.period; writeUrl(); render();
  });
  navEl.addEventListener("click", (event) => {
    const step = event.target.closest(".pv-nav-prev") ? -1 : event.target.closest(".pv-nav-next") ? 1 : 0;
    const today = brusselsToday();
    if (event.target.closest(".pv-nav-today")) state.cursor = state.mode === "maand" ? startOfMonth(today) : startOfWeek(today);
    else if (step) state.cursor = state.mode === "maand" ? addMonths(state.cursor, step) : addDays(state.cursor, 7 * step);
    else return;
    if (state.mode === "maand") state.selectedDay = state.cursor <= today && today < addMonths(state.cursor, 1) ? today : state.cursor;
    render();
  });

  // ---- de plekkop ----
  function renderPlace(summary, loading, failure = "") {
    const place = state.place;
    placeBox.hidden = !place;
    if (!place) return;
    const wijk = place.type === "straat" && place.wijken?.[0] ? index.byKey.get(`wijk:${place.wijken[0]}`) : null;
    const kind = place.type === "straat" ? "Straat" : place.type === "wijk" ? "Wijk" : "Postcode";
    const meta = place.type === "straat" ? `${place.postcode} Antwerpen${wijk ? ` · wijk <button type="button" class="pv-link" data-place="${esc(wijk.key)}">${esc(wijk.label)}</button>` : ""}` : esc(place.sub);
    const radius = place.type === "straat" ? `<div class="pv-seg pv-radius" role="group" aria-label="Hoe ver rond de straat">${[0, 250, 500, 1000].map((r) => `<button type="button" data-radius="${r}" aria-pressed="${state.radius === r}">${r ? `+${r >= 1000 ? "1 km" : `${r} m`}` : "Alleen de straat"}</button>`).join("")}</div>` : "";
    const tile = (n, label, cls, group) => !state.groups.has(group)
      ? `<li class="pv-stat pv-stat-off ${cls}"><button type="button" data-only="${group}" aria-label="${esc(label)} staan uit; tik om ze te tonen"><strong>–</strong><span>${esc(label)} (uit)</span></button></li>`
      : `<li class="pv-stat ${cls}"><button type="button" data-only="${group}" aria-label="Toon alleen ${esc(label)}"><strong>${group === "werken" && state.layersPending && !n ? "…" : n}</strong><span>${esc(label)}</span></button></li>`;
    placeBox.innerHTML = `
      <div class="pv-place-top">
        <div class="pv-place-id">
          <span class="pv-place-kind">${placeIcon(place)} ${kind}</span>
          <h2 class="pv-place-name">${esc(place.label)}</h2>
          <p class="pv-place-meta">${meta}</p>
        </div>
        <div class="pv-place-actions">
          <button type="button" class="pv-btn pv-share" aria-label="Deel de link naar deze plek"><span aria-hidden="true">🔗</span> Deel</button>
          <button type="button" class="pv-btn pv-btn-ghost pv-close">Andere plek</button>
        </div>
      </div>
      ${radius}
      <ul class="pv-stats" aria-label="Samenvatting">
        ${tile(summary.evenementen, summary.evenementen === 1 ? "evenement" : "evenementen", "cat-festival", "evenementen")}
        ${tile(summary.werkenBezig, "werken nu", "cat-works", "werken")}
        ${tile(summary.werkenGepland, "werken gepland", "cat-works pv-stat-planned", "werken")}
        ${tile(summary.inspraak, "inspraak & info", "cat-admin", "inspraak")}
      </ul>
      ${loading ? `<p class="pv-place-loading"><span class="pv-spinner" aria-hidden="true"></span> ${esc(loading)}</p>` : ""}
      ${failure ? `<p class="pv-place-loading pv-place-failed" role="status">${esc(failure)}</p>` : ""}`;
  }
  placeBox.addEventListener("click", (event) => {
    const r = event.target.closest("[data-radius]");
    if (r) { state.radius = Number(r.dataset.radius); view.setArea({ radius: state.radius }); announce(); return; }
    const p = event.target.closest("[data-place]");
    if (p) { applyPlace(index.byKey.get(p.dataset.place), { focusResults: true }); return; }
    const only = event.target.closest("[data-only]");
    if (only) { state.groups = state.groups.has(only.dataset.only) ? new Set([only.dataset.only]) : new Set([...state.groups, only.dataset.only]); view.wantsLiveLayers = true; state.customized = true; view.setThemes(themesForGroups([...state.groups])); announce(); return; }
    if (event.target.closest(".pv-close")) { search.value = ""; applyPlace(null); search.focus(); return; }
    const share = event.target.closest(".pv-share");
    if (share) {
      const link = window.location.href;
      const done = () => { share.innerHTML = `<span aria-hidden="true">✓</span> Link gekopieerd`; setTimeout(() => { share.innerHTML = `<span aria-hidden="true">🔗</span> Deel`; }, 2400); };
      if (navigator.share && matchMedia("(pointer: coarse)").matches) navigator.share({ title: `${state.place.label} · publieke agenda`, url: link }).catch(() => {});
      else navigator.clipboard?.writeText(link).then(done, () => window.prompt("Kopieer deze link", link));
    }
  });

  // ---- entries verzamelen ----
  function collect() {
    const live = window.PUBLIC_AGENDA_LIVE_STREETS || {};
    if (Array.isArray(live.works) || Array.isArray(live.publicSpace)) vraagKaartUitleg();
    const agenda = (Array.isArray(window.PUBLIC_AGENDA_VISIBLE_ITEMS) ? window.PUBLIC_AGENDA_VISIBLE_ITEMS : []).map((item) => agendaEntry(item, item.category || "other"));
    const pick = (rows, theme) => (view.enabled(theme) && Array.isArray(rows) ? rows.filter((row) => view.matches(row, theme)) : []);
    const entries = [
      ...agenda,
      ...pick(live.works, "works").map((work) => workEntry(work, { vandaag: brusselsToday(), uitleg: kaartUitleg })),
      ...publicSpaceEntries(pick(live.publicSpace, "publicSpace"), { vandaag: brusselsToday(), alle: live.publicSpace || [], uitleg: kaartUitleg, wijkVan }),
      ...pick(live.permits, "permits").map((row) => permitEntry(row)),
      ...pick(live.terraces, "terraces").map((row) => permitEntry(row, "terraces")),
    ];
    // Chips: tellen binnen de plek, ook voor soorten die uit staan.
    const cc = state.agendaCounts || {};
    const sumThemes = (themes) => themes.reduce((n, t) => n + (Number(cc[t]) || 0), 0);
    const inPlace = (rows) => (Array.isArray(rows) ? rows.filter((row) => view.matchesStreet(row)).length : 0);
    const loadedLayer = (rows) => Array.isArray(rows);
    state.counts = {};
    for (const g of KIND_GROUPS) {
      // agenda.js telt per soort binnen de plek (ook als die soort uit staat); de live lagen tellen we hier.
      let n = sumThemes(g.themes.filter((t) => t !== "publicSpace" && t !== "permits"));
      if (g.key === "werken") {
        if (!loadedLayer(live.works) && !loadedLayer(live.publicSpace)) { state.counts[g.key] = view.hasPlace || n ? n || undefined : undefined; continue; }
        n += inPlace(live.works) + inPlace(live.publicSpace);
      }
      if (g.key === "vergunningen") {
        if (!loadedLayer(live.permits) && !loadedLayer(live.terraces)) { state.counts[g.key] = undefined; continue; }
        n += inPlace(live.permits) + inPlace(live.terraces);
      }
      state.counts[g.key] = n;
    }
    // Live lagen: nog onderweg, of (eerlijk gemeld) niet bereikbaar.
    const loading = [], failed = [];
    const worksFailed = /niet geladen/i.test(document.querySelector("[data-works-count]")?.textContent || "");
    const spaceNote = document.querySelector("[data-space-note]")?.textContent || "";
    const wants = view.hasPlace || view.wantsLiveLayers;
    if (wants && view.enabled("works") && !loadedLayer(live.works)) (worksFailed ? failed : loading).push("werken");
    if (wants && view.enabled("publicSpace") && !loadedLayer(live.publicSpace)) (/niet gelezen|niet geladen/i.test(spaceNote) && !loadedLayer(live.publicSpace) ? failed : loading).push("verkeersmaatregelen");
    return { entries, loading, failed };
  }

  // ---- weergave ----
  function rowTemplate(entry, { today, context = "list", weekStart = "" } = {}) {
    const k = kindInfo(entry);
    const uid = cssId(entry.uid);
    const open = state.open.has(entry.uid);
    const multi = Boolean((entry.end && entry.end > entry.start) || entry.openEnd);
    const planned = entry.start && entry.start > today;
    const running = multi && entry.start && entry.start <= today;
    const marktUur = entry.theme === "markets" ? publiekeMarktUur(entry.item) : null;
    let when = marktUur ? marktUur.start.replace(":",".") : leesbaarUur(entry,{multi,running});
    if (context === "running") when = entry.end ? `t/m ${shortDate(entry.end)}` : "Loopt";
    const badge = entry.group === "werken" || entry.source !== "agenda"
      ? (entry.start && planned ? `<span class="pv-badge pv-badge-planned">Gepland</span>` : running ? `<span class="pv-badge pv-badge-now">Nu bezig</span>` : "")
      : "";
    const range = multi ? `${fullDate(entry.start)} – ${entry.end ? fullDate(entry.end) : "einde volgens de bron"}` : entry.start ? fullDate(entry.start) : "";
    let progress = "";
    if (multi && entry.end) {
      const total = Math.max(1, daysBetween(entry.start, entry.end) + 1);
      const done = Math.min(total, Math.max(0, daysBetween(entry.start, today) + 1));
      progress = `<div class="pv-progress" aria-hidden="true"><span style="width:${Math.round((done / total) * 100)}%"></span></div><p class="pv-progress-text">${planned ? `Start over ${daysBetween(today, entry.start)} dag${daysBetween(today, entry.start) === 1 ? "" : "en"} · ${total} dagen` : `Dag ${done} van ${total}`}</p>`;
    }
    let track = "";
    if (context === "week") {
      const end = entry.end || (entry.openEnd ? addDays(weekStart, 6) : entry.start);
      const s = entry.start < weekStart ? 0 : daysBetween(weekStart, entry.start);
      const e = Math.min(6, daysBetween(weekStart, end));
      track = `<span class="pv-track" aria-hidden="true">${Array.from({ length: 7 }, (_, i) => `<i class="${i >= s && i <= e ? "on" : ""}${addDays(weekStart, i) === today ? " today" : ""}"></i>`).join("")}</span>`;
    }
    const item = entry.item || {};
    const duidelijk = duidelijkeKaart(entry, item, { straat: state.place?.type === "straat" ? state.place.name : "" });
    const waarKort = duidelijk.waar ? duidelijk.waar.kort : entry.location;
    const links = bezoekersLinks(entry).map(l => `<a class="${l.type === "source" ? "pv-bron-technisch" : "pv-bron-bezoeker"}" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} <span aria-hidden="true">↗</span></a>`);
    const bronHint = bezoekersHint(entry);
    if (entry.source === "agenda" && !item.noEventPage && item.feed) links.push(`<a href="/event/${encodeURIComponent(entry.id)}">Deel dit agendapunt</a>`);
    if (entry.source === "agenda" && window.AgendaIcs?.downloadIndividualIcs) links.push(`<button type="button" class="pv-ics" data-ics="${esc(entry.id)}">Zet in je agenda (.ics)</button>`);
    return `
      <li class="pv-row cat-${esc(k.cat)}${open ? " open" : ""}" data-uid="${esc(entry.uid)}">
        <button type="button" class="pv-row-btn" aria-expanded="${open}" aria-controls="pv-d-${uid}">
          <span class="pv-row-when">${esc(duidelijk.tijd || when)}</span>
          <span class="pv-row-main">
            <span class="pv-row-kind"><span aria-hidden="true">${k.emoji}</span> ${esc(k.label)}${badge}</span>
            <strong class="pv-row-title">${esc(duidelijk.titel)}</strong>
            ${duidelijk.samenvatting ? `<span class="pv-row-summary">${esc(duidelijk.samenvatting)}</span>` : ""}
            ${waarKort && !entry.uitleg ? `<span class="pv-row-where">${esc(waarKort)}</span>` : ""}
            ${context !== "list" || multi ? `<span class="pv-row-range">${esc(multi ? `${shortDate(entry.start)} → ${entry.end ? shortDate(entry.end) : "…"}` : "")}</span>` : ""}
            ${track}
          </span>
          <span class="pv-row-chevron" aria-hidden="true"></span>
        </button>
        <div class="pv-detail" id="pv-d-${uid}" ${open ? "" : "hidden"}>
          ${progress}
          ${duidelijk.toelichting ? `<p class="pv-bronduidelijkheid">${esc(duidelijk.toelichting)}</p>` : ""}
          ${duidelijk.regels?.length ? `<dl class="pv-uitleg">${duidelijk.regels.map(([dt,dd]) => `<div><dt>${esc(dt)}</dt><dd>${esc(dd)}</dd></div>`).join("")}${waarTemplate(duidelijk.waar)}</dl>` : ""}
          ${entry.uitleg ? uitlegTemplate(entry) : duidelijk.eigenDetail ? "" : `${entry.info ? `<p>${esc(entry.info)}</p>` : ""}
          <dl>
            ${range ? `<div><dt>Wanneer</dt><dd>${esc(entry.source === "agenda" && entry.dateLabel ? entry.dateLabel : range)}${marktUur ? ` · ${esc(marktUur.tekst)} (normale bezoekersuren stad)` : entry.timeText ? ` · ${esc(entry.timeText)}` : ""}</dd></div>` : ""}
            ${entry.location ? `<div><dt>Waar</dt><dd>${esc(entry.location)}</dd></div>` : ""}
            ${entry.status ? `<div><dt>Status</dt><dd>${esc(entry.status)}</dd></div>` : ""}
            ${entry.reference ? `<div><dt>Referentie</dt><dd>${esc(entry.reference)}</dd></div>` : ""}
            ${item.sourcePublisher ? `<div><dt>Bron</dt><dd>${esc(item.sourcePublisher)}</dd></div>` : ""}
          </dl>`}
          ${bronHint ? `<p class="pv-bron-hint">${esc(bronHint)}</p>` : ""}
          ${marktUur ? `<p class="pv-bron-hint">${esc(marktUur.status)}</p>` : ""}
          ${links.length ? `<p class="pv-links">${links.join("")}</p>` : ""}
        </div>
      </li>`;
  }
  // "Waar" bij een aanvraag: vanaf 3 straten een korte regel en de volledige lijst ingeklapt.
  function waarTemplate(waar) {
    if (!waar?.straten?.length) return "";
    return `<div><dt>Waar</dt><dd>${esc(waar.kort)}${waar.ingeklapt ? `<details class="pv-streets"><summary>Toon alle ${waar.straten.length} straten</summary><p>${esc(waar.straten.join(", "))}</p></details>` : ""}</dd></div>`;
  }
  // Uitleg in gewone taal (site/kaart-uitleg.js): regels, de straten ingeklapt, een kaartschets als
  // de verversing de lijn van het parcours kent, wat de bron niet zegt, en de ruwe codes apart.
  function uitlegTemplate(entry) {
    const u = entry.uitleg;
    const straten = entry.straten || [];
    const lange = straten.length > 3;
    const kaart = entry.kaart?.length ? kaartSvg(entry.kaart, (liveIndex?.segments || []).map((s) => [s.a, s.b])) : "";
    return `
          <dl class="pv-uitleg">
            ${u.regels.map(([dt, dd]) => `<div><dt>${esc(dt)}</dt><dd>${esc(dd)}</dd></div>`).join("")}
            ${straten.length ? `<div><dt>Waar</dt><dd>${esc(u.plek || straten.join(", "))}${lange ? `<details class="pv-streets"><summary>Toon alle ${straten.length} straten</summary><p>${esc(straten.join(", "))}</p></details>` : ""}</dd></div>` : ""}
            ${entry.status ? `<div><dt>Status</dt><dd>${esc(entry.status)}</dd></div>` : ""}
            ${entry.reference ? `<div><dt>Referentie</dt><dd>${esc(entry.reference)}</dd></div>` : ""}
          </dl>
          ${kaart ? `<figure class="pv-kaart">${kaart}<figcaption>Schets van het parcours (rood) uit A-Sign, over de straatassen van de stad.</figcaption></figure>` : ""}
          ${u.ontbreekt.length ? `<p class="pv-ontbreekt"><strong>Niet in de bron:</strong> ${esc(u.ontbreekt.join(" · "))}. Kijk bij de officiële bron hieronder.</p>` : ""}
          ${u.technisch ? `<p class="pv-technisch">${esc(u.technisch)}</p>` : ""}`;
  }
  function sectionTemplate(key, title, entries, options, note = "") {
    if (!entries.length) return "";
    const all = state.expanded.has(key);
    const shown = all ? entries : entries.slice(0, SECTION_LIMIT);
    return `<section class="pv-day" aria-label="${esc(title)}"><h3 class="pv-day-title">${title}<span class="pv-day-n">${entries.length}</span></h3>${note}<ul class="pv-rows">${shown.map((e) => rowTemplate(e, options)).join("")}</ul>${entries.length > shown.length ? `<button type="button" class="pv-more-rows" data-expand="${esc(key)}">Toon alle ${entries.length}</button>` : ""}</section>`;
  }
  function dayTitle(day, today) {
    const rel = day === today ? "Vandaag" : day === addDays(today, 1) ? "Morgen" : "";
    return `${rel ? `<span class="pv-rel">${rel}</span> ` : ""}${esc(longDate(day))}${day.slice(0, 4) !== today.slice(0, 4) ? ` ${day.slice(0, 4)}` : ""}`;
  }
  function marketsTemplate(entries, today) {
    const items = entries.filter((e) => e.theme === "markets").map((e) => e.item);
    const bundles = window.PublicAgendaUitgaan?.bundleWeeklyMarkets?.(items, today) || [];
    const publiekeUren = m => publiekeMarktUur({sourceId:"stad-markten",inDistrict:m.inDistrict,location:m.location,title:m.title,date:m.nextDate});
    if (!bundles.length) return "";
    return `<section class="pv-day" aria-label="Wekelijkse markten"><h3 class="pv-day-title"><span aria-hidden="true">🧺</span> Wekelijkse markten<span class="pv-day-n">${bundles.length}</span></h3><ul class="pv-markets">${bundles.map((m) => `<li class="cat-markets"><strong>${esc(m.title)}</strong><span>${esc(m.weekdays.join(", "))}${publiekeUren(m) ? ` · ${esc(publiekeUren(m).tekst)} (normale bezoekersuren stad)` : m.timeText ? ` · ${esc(m.timeText)} (GIPOD-innameuren)` : ""}</span>${m.location ? `<small>${esc(m.location)}</small>` : ""}${m.nextDate ? `<small>Volgende: ${esc(longDate(m.nextDate))}</small>` : ""}<a href="https://www.antwerpen.be/info/5c065842a67793326b260661/markten-in-district-antwerpen" target="_blank" rel="noopener noreferrer">Stad Antwerpen: locatie en marktuur ↗</a></li>`).join("")}</ul></section>`;
  }
  function emptyTemplate(today) {
    const place = state.place;
    const where = place ? (place.type === "straat" ? `in de ${esc(place.label)}` : place.type === "wijk" ? `in de wijk ${esc(place.label)}` : `in postcode ${esc(place.code)}`) : "in district Antwerpen";
    const tips = [];
    if (place?.type === "straat") {
      if (state.radius < 500) tips.push(`<button type="button" class="pv-btn" data-radius-tip="500">Kijk ook 500 m rond de straat</button>`);
      const wijk = place.wijken?.[0] && index.byKey.get(`wijk:${place.wijken[0]}`);
      if (wijk) tips.push(`<button type="button" class="pv-btn pv-btn-ghost" data-place="${esc(wijk.key)}">Bekijk de wijk ${esc(wijk.label)}</button>`);
    }
    if (state.mode === "lijst" && state.period !== "alles") tips.push(`<button type="button" class="pv-btn pv-btn-ghost" data-period-tip="alles">Toon ook wat later komt</button>`);
    if (state.groups.size < KIND_GROUPS.length) tips.push(`<button type="button" class="pv-btn pv-btn-ghost" data-all-tip>Toon alle soorten</button>`);
    const period = state.mode === "lijst" ? (state.period === "alles" ? "" : ` in de komende ${PERIODS.find(([k]) => k === state.period)[1]}`) : "";
    return `<div class="pv-empty"><div class="pv-empty-art" aria-hidden="true">🗓️</div><h3>Niets gevonden ${where}${period}</h3><p>${state.groups.size ? "Binnen de gekozen soorten staat hier niets gepland." : "Je hebt alle soorten uitgezet."} ${place?.type === "straat" ? "Een straat is klein: in de buurt gebeurt vaak meer." : ""}</p><div class="pv-empty-tips">${tips.join("")}</div></div>`;
  }
  function renderList(entries, today) {
    const { from, to } = periodRange(state.period, today);
    const dated = entries.filter((e) => e.theme !== "markets" && e.group !== "vergunningen");
    const { running, days, later } = groupForList(dated, { from, to, today });
    const permits = entries.filter((e) => e.group === "vergunningen");
    const html = [];
    html.push(sectionTemplate("running", `<span aria-hidden="true">⏳</span> Nu bezig`, running, { today, context: "running" }, `<p class="pv-day-note">Werken, maatregelen en activiteiten die vandaag lopen.</p>`));
    for (const [day, list] of days) html.push(sectionTemplate(`d:${day}`, dayTitle(day, today), list, { today }));
    if (later.length) html.push(`<button type="button" class="pv-later" data-period-tip="alles"><strong>${later.length} item${later.length === 1 ? "" : "s"} later gepland</strong><span>vanaf ${esc(longDate(later[0].start))} · toon alles</span></button>`);
    html.push(marketsTemplate(entries, today));
    html.push(sectionTemplate("permits", `<span aria-hidden="true">📄</span> Omgevingsaanvragen en besluiten`, permits, { today, context: "permit" }));
    const body = html.filter(Boolean).join("");
    results.innerHTML = body || emptyTemplate(today);
  }
  function renderWeek(entries, today) {
    const weekStart = state.cursor, weekEnd = addDays(weekStart, 6);
    const inWeek = entries.filter((e) => e.start && e.group !== "vergunningen" && overlaps(e, weekStart, weekEnd))
      .sort((a, b) => a.start.localeCompare(b.start) || String(a.time || "99").localeCompare(String(b.time || "99")) || a.title.localeCompare(b.title, "nl"));
    const head = `<div class="pv-week-head" aria-hidden="true"><span></span><span class="pv-week-days">${Array.from({ length: 7 }, (_, i) => { const d = addDays(weekStart, i); return `<b class="${d === today ? "today" : ""}">${WEEKDAYS_SHORT[i]}<br>${dayNum(d)}</b>`; }).join("")}</span><span></span></div>`;
    if (!inWeek.length) { results.innerHTML = `${head}${emptyTemplate(today)}`; return; }
    results.innerHTML = `<div class="pv-week">${head}${sectionTemplate(`w:${weekStart}`, `Week van ${esc(shortDate(weekStart))}`, inWeek, { today, context: "week", weekStart })}</div>`;
  }
  function renderMonth(entries, today) {
    const month = state.cursor, weeks = monthWeeks(month), nextMonth = addMonths(month, 1);
    const dated = entries.filter((e) => e.start && e.group !== "vergunningen");
    const narrow = window.matchMedia("(max-width: 640px)").matches;
    const maxLanes = narrow ? 4 : 3;
    if (!state.selectedDay || state.selectedDay < month || state.selectedDay >= nextMonth) state.selectedDay = today >= month && today < nextMonth ? today : month;
    const rows = weeks.map((weekStart) => {
      const { bars, lanes, overflow } = layoutWeekBars(dated, weekStart, maxLanes);
      const days = Array.from({ length: 7 }, (_, i) => {
        const d = addDays(weekStart, i);
        const n = dated.filter((e) => overlaps(e, d, d)).length;
        const cls = [d < month || d >= nextMonth ? "out" : "", d === today ? "today" : "", d === state.selectedDay ? "sel" : "", d < today ? "past" : ""].filter(Boolean).join(" ");
        return `<button type="button" class="pv-cal-day ${cls}" data-day="${d}" style="grid-column:${i + 1}" aria-pressed="${d === state.selectedDay}" aria-label="${esc(longDate(d))}: ${n ? `${n} item${n === 1 ? "" : "s"}` : "niets gepland"}"><span>${dayNum(d)}</span></button>`;
      }).join("");
      const barHtml = bars.map((b) => {
        const k = kindInfo(b.entry);
        const multi = b.span > 1 || b.clippedStart || b.clippedEnd || (b.entry.end && b.entry.end > b.entry.start);
        return `<span class="pv-bar cat-${esc(k.cat)}${multi ? " multi" : " single"}${b.clippedStart ? " cs" : ""}${b.clippedEnd ? " ce" : ""}" style="grid-column:${b.col + 1} / span ${b.span};grid-row:${b.lane + 2}" title="${esc(`${b.entry.title} · ${shortDate(b.entry.start)}${b.entry.end && b.entry.end !== b.entry.start ? ` → ${shortDate(b.entry.end)}` : ""}`)}" aria-hidden="true">${esc(b.entry.time ? `${b.entry.time.replace(":", ".")} ${b.entry.title}` : b.entry.title)}</span>`;
      }).join("");
      const more = overflow.map((n, i) => (n ? `<span class="pv-cal-more" style="grid-column:${i + 1};grid-row:${maxLanes + 2}" aria-hidden="true">+${n}</span>` : "")).join("");
      return `<div class="pv-cal-week" style="--lanes:${Math.max(1, lanes) + (overflow.some(Boolean) ? 1 : 0)}">${days}${barHtml}${more}</div>`;
    }).join("");
    const day = state.selectedDay;
    const onDay = dated.filter((e) => overlaps(e, day, day)).sort((a, b) => (a.start === day ? 0 : 1) - (b.start === day ? 0 : 1) || String(a.time || "99").localeCompare(String(b.time || "99")) || a.title.localeCompare(b.title, "nl"));
    const legend = KIND_GROUPS.filter((g) => state.groups.has(g.key) && g.key !== "vergunningen").map((g) => `<span class="pv-legend-item cat-${g.cat}"><i aria-hidden="true"></i>${esc(g.label)}</span>`).join("");
    results.innerHTML = `
      <div class="pv-cal" aria-label="Maandkalender ${esc(MONTHS[monthOf(month)])}">
        <div class="pv-cal-head" aria-hidden="true">${WEEKDAYS_SHORT.map((d) => `<b>${d}</b>`).join("")}</div>
        ${rows}
      </div>
      <p class="pv-legend">${legend}<span class="pv-legend-hint">Balken = meerdaagse werken of activiteiten. Tik op een dag voor alles van die dag.</span></p>
      <div class="pv-cal-daypanel" aria-live="polite">${onDay.length ? sectionTemplate(`c:${day}`, dayTitle(day, today), onDay, { today, context: "day" }) : `<p class="pv-day-empty"><strong>${esc(longDate(day))}</strong>: niets gepland binnen je keuze.</p>`}</div>`;
  }

  results.addEventListener("click", (event) => {
    const row = event.target.closest(".pv-row-btn");
    if (row) {
      const li = row.closest(".pv-row"), uid = li.dataset.uid, detail = li.querySelector(".pv-detail");
      const open = !state.open.has(uid);
      if (open) state.open.add(uid); else state.open.delete(uid);
      li.classList.toggle("open", open); row.setAttribute("aria-expanded", String(open)); detail.hidden = !open;
      return;
    }
    const ics = event.target.closest("[data-ics]");
    if (ics) {
      const item = (window.PUBLIC_AGENDA_VISIBLE_ITEMS || []).find((i) => i.id === ics.dataset.ics);
      try { window.AgendaIcs.downloadIndividualIcs(item); ics.textContent = "Agendabestand klaar"; } catch { ics.textContent = "Export niet beschikbaar"; }
      return;
    }
    const day = event.target.closest("[data-day]");
    if (day) { state.selectedDay = day.dataset.day; render(); results.querySelector(".pv-cal-daypanel")?.scrollIntoView({ block: "nearest", behavior: "smooth" }); return; }
    const expand = event.target.closest("[data-expand]");
    if (expand) { state.expanded.add(expand.dataset.expand); render(); return; }
    if (event.target.closest("[data-period-tip]")) { state.period = "alles"; state.mode = "lijst"; writeUrl(); render(); return; }
    const radiusTip = event.target.closest("[data-radius-tip]");
    if (radiusTip) { state.radius = Number(radiusTip.dataset.radiusTip); view.setArea({ radius: state.radius }); announce(); return; }
    const p = event.target.closest("[data-place]");
    if (p) { applyPlace(index.byKey.get(p.dataset.place), { focusResults: true }); return; }
    if (event.target.closest("[data-all-tip]")) { state.groups = new Set(KIND_GROUPS.map((g) => g.key)); state.customized = true; view.wantsLiveLayers = true; view.setThemes(themesForGroups([...state.groups])); announce(); }
  });

  // Kaartmarker of deeplink: het item openklappen in het overzicht.
  window.PUBLIC_AGENDA_OPEN = (id) => {
    const uid = `agenda:${id}`;
    state.open.add(uid);
    if (state.mode !== "lijst") state.mode = "lijst";
    state.period = "alles";
    render();
    const li = results.querySelector(`[data-uid="${CSS.escape(uid)}"]`);
    if (li) { li.scrollIntoView({ block: "center" }); li.querySelector(".pv-row-btn")?.focus({ preventScroll: true }); }
  };

  function render() {
    const today = brusselsToday();
    if (!state.cursor) { state.cursor = state.mode === "maand" ? startOfMonth(today) : startOfWeek(today); }
    if (state.mode === "maand" && state.cursor !== startOfMonth(state.cursor)) state.cursor = startOfMonth(state.cursor);
    if (state.mode === "week" && weekdayMon0(state.cursor) !== 0) state.cursor = startOfWeek(state.cursor);
    const { entries, loading, failed } = collect();
    const summary = summarize(entries, today);
    state.layersPending = loading.includes("werken");
    renderPlace(summary, loading.length ? `${loading.join(" en ")} ${loading.length > 1 ? "worden" : "wordt"} live opgehaald…` : "", failed.length ? `De live bron voor ${failed.join(" en ")} is nu niet bereikbaar; die ontbreken hieronder. Probeer het straks opnieuw.` : "");
    renderToolbar();
    const place = state.place;
    titleEl.textContent = place ? "Alles op deze plek" : state.groups.size === 1 && state.groups.has("evenementen") ? "Uitgaan & evenementen in district Antwerpen" : "Alles in district Antwerpen";
    const n = new Set(entries.map((e) => (e.source === "agenda" ? `${e.title}|${e.location}` : e.uid))).size;
    subEl.textContent = place
      ? `${n} item${n === 1 ? "" : "s"} uit officiële bronnen${place.type === "straat" && state.radius ? `, ook ${state.radius >= 1000 ? "1 km" : `${state.radius} m`} rond de straat` : ""}.`
      : "Zoek hierboven je straat of wijk om ook werken, verkeer en inspraak in je buurt te zien.";
    loadingEl.innerHTML = place ? "" : [
      loading.length ? `<span class="pv-spinner" aria-hidden="true"></span> ${esc(loading.join(" en "))} laden…` : "",
      failed.length ? `De live bron voor ${esc(failed.join(" en "))} is nu niet bereikbaar.` : "",
    ].filter(Boolean).join(" ");
    if (state.mode === "maand") renderMonth(entries, today);
    else if (state.mode === "week") renderWeek(entries, today);
    else renderList(entries, today);
  }
  let frame = 0;
  function schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(render); }

  // ---- signalen van de rest van de pagina ----
  window.addEventListener("public-agenda:agenda-view", (event) => { if (event.detail?.categoryCounts) state.agendaCounts = { ...event.detail.categoryCounts }; schedule(); });
  window.addEventListener("public-agenda:street-layer", schedule);
  window.addEventListener("resize", () => { if (state.mode === "maand") schedule(); });
  // De kaart: tikken op een wijk kiest die wijk; de straalknoppen blijven werken.
  window.addEventListener("public-agenda:area-change", (event) => {
    const detail = event.detail || {};
    if ("wijk" in detail && index) { applyPlace(detail.wijk ? index.byKey.get(`wijk:${detail.wijk}`) : null); return; }
    if ("radius" in detail) { state.radius = Number(detail.radius) || 0; view.setArea({ radius: state.radius }); announce(); }
  });
  window.addEventListener("public-agenda:area-ready", () => { window.dispatchEvent(new CustomEvent("public-agenda:view-change")); schedule(); });

  // ---- startplek uit de URL ----
  renderQuick();
  let initial = null;
  if (index) {
    if (url.searchParams.get("plek")) initial = resolvePlaceParam(index, url.searchParams.get("plek"));
    else if (url.searchParams.get("straat")) initial = index.byKey.get(`straat:${url.searchParams.get("straat")}`) || resolvePlaceParam(index, url.searchParams.get("straat").split("|")[1] || "");
    else if (url.searchParams.get("wijk")) initial = index.byKey.get(`wijk:${url.searchParams.get("wijk")}`) || null;
    else if (url.searchParams.get("straatzoek")) { search.value = url.searchParams.get("straatzoek"); }
    if (!initial && url.searchParams.get("plek")) { search.value = url.searchParams.get("plek"); help.textContent = `“${url.searchParams.get("plek")}” is geen straat, wijk of postcode van district Antwerpen. Kies een suggestie.`; }
  }
  applyPlace(initial);
  if (state.eventId) setTimeout(() => window.PUBLIC_AGENDA_OPEN(decodeURIComponent(state.eventId)), 120);
}
