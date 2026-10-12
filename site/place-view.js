// Zoek op plek: één zoekbalk voor straat, wijk of postcode, en daarna één overzicht van alles op die
// plek (evenementen, lopende en geplande werken, verkeersmaatregelen, inspraak, markten, vergunningen)
// als lijst, week of maand. De kaart zoomt mee. Alleen presentatie: de items, bronnen en
// publicatieregels komen ongewijzigd uit agenda.js en de live lagen; de filter is agenda-view.js.
import {
  KIND_GROUPS, DEFAULT_GROUPS, PERIODS, themesForGroups, groupsForThemes,
  buildPlaceIndex, searchPlaces, otherDistrictFor, placeParam, resolvePlaceParam, parseQuery,
  periodRange, monthWeeks, startOfMonth, addDays, addMonths, daysBetween, weekdayMon0,
  layoutWeekBars, groupForList, overlaps, agendaEntry, werkEntries, publicSpaceEntries, permitEntry, terrasEntries, summarize, dezeWeek, WEEK_LICHT,
  plekWaar, legeStaatTekst, voortgangTekst, maakStratenFilter, periodeVan, evenementFase, evenementBadge, losseDagenTekst,
  opDag, langEvenement, legeDagLabel, legeTijdlijnTekst, dagInhoud, doorlopendTekst, doorlopendNoot,
  periodeBadge, kortDatum, kortBereik, lopendKop, identiteitSamen, werfPerStuk,
  kaartSoort, lijstSleutel, lijstUniversum, marktBundelEntry, telPerSoort,
} from "./place-core.js";
import { isEvenementDossier } from "./kaart-uitleg.js";
import { ontbrekendeOnderdelen, onvolledigMelding } from "./live-lagen.js";
import { kaartSvg } from "./kaart-uitleg.js";
import { allesFilterActie } from "./filter-action-ux.js";
import { duidelijkeKaart } from "./permit-clarity.js";
import { brusselsVandaag, metInzage, splitsOpOnderzoek } from "./inzage-status.js";
import {bezoekersLinks,bezoekersHint,leesbaarUur,splitsLinks} from "./bezoekers-bronnen.js";
import {publiekeMarktUur} from "./publieke-markturen.js";
import { locationKey, wijkFeatures, bboxOf, wijkOf } from "./neighborhood-core.js";
import { resolveAddressStreets, resolvePointStreet } from "./street-core.js";
import { sameStreet } from "./agenda-view.js";
import { laadStraat, laadStraatIndex, lagenUitStand, kaderRond, aanvullenMetOchtend, metStratenVanDeOchtend, verschil, standZin } from "./straat-snapshot.js";

const esc = (v = "") => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
const cssId = (v) => String(v).replace(/[^a-zA-Z0-9_-]/g, "_");
const MONTHS = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const MONTHS_SHORT = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const WEEKDAYS = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"];
const WEEKDAYS_SHORT = ["ma", "di", "wo", "do", "vr", "za", "zo"];
const QUICK_WIJKEN = ["ANT09", "ANT24", "ANT25", "ANT10", "ANT05", "ANT11", "ANT20"];
// "14 dagen" (tijdlijn) vervangt de weekweergave; een oude link met weergave=week opent de tijdlijn.
const MODES = [["lijst", "Lijst"], ["tijdlijn", "14 dagen"], ["maand", "Maand"]];
const SECTION_LIMIT = 12;
// Een open kaart toont wat er gebeurt, waarom het in de agenda staat en wat er in het dossier staat.
// Alleen wat over de bron zelf gaat, staat ingeklapt onder "Bron en dossier": "Organisator" (bij een
// evenement op straat altijd "niet openbaar"; dat zegt de zin "Niet in de bron" al), het nummer en de codes.
const BRONREGELS = new Set(["Organisator"]);
// De regel die zegt wat de stratenlijst is ("N betrokken straten volgens het dossier; ..."). Bij een
// lange lijst staat ze bij die lijst, in "Toon alle N straten": het aantal staat al bij "Waar".
const STRATENREGEL = "Parcours";
// Zoveel omschrijvingen uit het dossier staan minstens zichtbaar; elk parcours altijd.
const DOSSIER_ZICHTBAAR = 3;
const isParcours = (tekst) => /^Parcours:/i.test(String(tekst));
const isParkeerverbod = (tekst) => /^Parkeerverbod/i.test(String(tekst));

// Welke regels van de uitleg zichtbaar staan en wat ingeklapt staat. De omschrijvingen uit het dossier:
// eerst het parcours (welk parcours, welke ronde), dan wat er nog gebeurt (een omleiding, een
// servicepunt), en als laatste de parkeerverboden: die zijn talrijk, per straat, en staan ingeklapt.
export function kaartIndeling(uitleg = {}, { reference = "", straten = 0 } = {}) {
  const alle = uitleg.regels || [];
  const bron = alle.filter(([dt]) => BRONREGELS.has(dt));
  if (reference) bron.push(["Referentie", reference]);
  const stratenNoot = straten > 3 ? alle.find(([dt]) => dt === STRATENREGEL)?.[1] || "" : "";
  const lijst = uitleg.beschrijvingen || [];
  const parcours = lijst.filter(isParcours);
  const overige = lijst.filter((b) => !isParcours(b) && !isParkeerverbod(b));
  const volgorde = [...parcours, ...overige, ...lijst.filter((b) => !isParcours(b) && isParkeerverbod(b))];
  let n = Math.max(DOSSIER_ZICHTBAAR, parcours.length + Math.min(overige.length, 2));
  // Geen knop "Toon nog 1": dan staat die ene ook gewoon zichtbaar.
  if (volgorde.length <= n + 1) n = volgorde.length;
  const dicht = volgorde.slice(n);
  return {
    regels: alle.filter(([dt]) => !BRONREGELS.has(dt) && !(stratenNoot && dt === STRATENREGEL)),
    dossier: {
      zichtbaar: volgorde.slice(0, n),
      dicht,
      knop: dicht.length && dicht.every(isParkeerverbod) ? `Toon de ${dicht.length} parkeerverboden uit het dossier` : `Toon nog ${dicht.length} omschrijvingen uit het dossier`,
    },
    stratenNoot,
    bron,
    technisch: uitleg.technisch || "",
  };
}

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
  // Een inname die geen evenement met publiek is (stickers, een bord, de bladslag), zegt dat ook.
  if (entry.source === "publicSpace" && entry.item?.kind === "event") return { label: entry.uitleg?.geenEvenement ? "Inname op straat" : "Evenement op straat", emoji: "🎉", cat: "festival" };
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
    mode: url.searchParams.get("weergave") === "week" ? "tijdlijn" : MODES.some(([k]) => k === url.searchParams.get("weergave")) ? url.searchParams.get("weergave") : "lijst",
    dagFilter: "",
    cursor: "",
    selectedDay: "",
    open: new Set(),
    expanded: new Set(),
    radius: [0, 250, 500, 1000].includes(Number(url.searchParams.get("straal"))) ? Number(url.searchParams.get("straal")) : 0,
    counts: {},
    // Snelheid (P5): de stand van de ochtend voor de gekozen straat en wat het live nakijken vond.
    snel: null,
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
  // Een gedeelde link naar een plek: de index van de straatbestanden al opvragen terwijl de stratenlijst
  // laadt (één wachtbeurt minder voor de tegels). Zonder plek pas als er een straat gekozen wordt.
  if (url.searchParams.get("plek") || url.searchParams.get("straat")) laadStraatIndex().catch(() => {});
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
  // Kort genoeg voor een gsm; het zichtbare label hierboven is de enige naam van het veld (geen aria-label).
  Object.assign(search, { id: "agenda-street-jump", type: "search", placeholder: "Bv. Kammenstraat" });
  search.removeAttribute("list");
  search.removeAttribute("aria-label");
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
      <div class="pv-aside" role="region" aria-label="Kaart"></div>
    </div>`;
  const $ = (s) => section.querySelector(s);
  const placeBox = $(".pv-place"), titleEl = $("#pv-title"), subEl = $(".pv-sub"), groupsEl = $(".pv-groups"), modesEl = $(".pv-modes"), periodsEl = $(".pv-periods"), navEl = $(".pv-nav"), results = $(".pv-results"), loadingEl = $(".pv-loading"), aside = $(".pv-aside");
  // Een stille focus (zonder kader) geldt alleen voor de sprong na het kiezen van een plek (applyPlace).
  titleEl?.addEventListener("blur", () => titleEl.classList.remove("pv-stil"));
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
  // Het oude straatveld en zijn label "Straat" verdwijnen: anders heeft het zoekveld twee labels.
  for (const group of oldGroups) if (!group.querySelector('#agenda-street-jump, label[for="agenda-street-jump"]') && !group.contains(search)) scopeWrap.append(group);
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
    .catch(() => { aside.hidden = true; view.straalNietBeschikbaar?.(); window.dispatchEvent(new CustomEvent("public-agenda:area-ready")); });

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
    .then((live) => { liveIndex = live; view.resetRefs?.(); announce(); })
    .catch(() => { /* De statische straatlijst volstaat voor zoeken en koppelen. */ });
  // Uitleg uit de dataverversing (huisnummers, gekoppeld evenement, parcourslijn). Zonder dit
  // bestand maken de kaartjes hun uitleg uit de live lagen alleen.
  // Pas laden zodra een live laag er is: zonder werken of innames is het niet nodig.
  // Daarbij de met de hand nagekeken identiteit van evenementendossiers (naam, uren, officiële link).
  // Daarnaast de automatische herkenning bij elke verversing; een handfiche wint altijd (identiteitSamen).
  let kaartUitleg = null, kaartUitlegGevraagd = false, kaartUitlegKlaar = false, evenementIdentiteit = null, evenementAuto = null;
  const vraagKaartUitleg = () => {
    if (kaartUitlegGevraagd) return;
    kaartUitlegGevraagd = true;
    getJson("/sources/kaart-uitleg.json").then((doc) => { kaartUitleg = doc; }).catch(() => {})
      .finally(() => { kaartUitlegKlaar = true; view.resetRefs?.(); announce(); });
    getJson("/sources/evenement-identiteit.json").then((doc) => { evenementIdentiteit = doc; announce(); }).catch(() => {});
    getJson("/sources/evenement-identiteit-auto.json").then((doc) => { evenementAuto = doc; announce(); }).catch(() => {});
  };
  // ---- één stratenlijst voor tonen én filteren ----
  // Een evenementendossier: de straten van evenementStraten() (place-core.js), zowel die waar het
  // parcours door loopt als die het alleen kruist. Een werk: de straat van zijn punt plus die van de
  // werfzone. De filter (agenda-view.js), de kaart en het kaartje gebruiken zo dezelfde lijst.
  // Eén lijst per dossier, met geheugen (maakStratenFilter in place-core.js).
  const stratenFilter = maakStratenFilter({
    bron: () => ({ rijen: (window.PUBLIC_AGENDA_LIVE_STREETS || {}).publicSpace, uitleg: kaartUitleg, index: liveIndex, klaar: kaartUitlegKlaar }),
    refsVoorNaam: (sleutel) => refsByName.get(sleutel),
  });
  const lijstVan = (dossier) => stratenFilter.lijstVan(dossier);
  view.setStreetLists?.((item) => {
    if (item?.kind === "iod" && isEvenementDossier(item) && item.reference) return stratenFilter.refsVan(item.reference, state.place?.type === "straat" ? state.place.name : "");
    const vlak = !item?.kind && item?.gipodId != null ? kaartUitleg?.werken?.[item.gipodId]?.vlakStraten : null;
    if (Array.isArray(vlak) && vlak.length) {
      const eigen = Array.isArray(item.streets) ? item.streets : [];
      const al = new Set(eigen.map((r) => locationKey(r?.name)));
      return [...eigen, ...stratenFilter.naarRefs(vlak.filter((n) => !al.has(locationKey(n))))];
    }
    return null;
  });
  const wijkVan = (straat) => {
    const place = index?.places.find((p) => p.type === "straat" && p.name === straat);
    return (place?.wijken?.[0] && index.byKey.get(`wijk:${place.wijken[0]}`)?.label) || "";
  };

  // ---- snel: eerst de stand van de ochtend, dan live alleen het kader van de straat (P5) ----
  // site/straat/<id>.json (scripts/build-straat-snapshots.mjs) geeft de werken, A-Sign-items, vergunningen
  // en terrassen van de straat meteen: de tegels en de lijst staan er zonder te wachten op de live bronnen.
  // Daarna vragen we live alleen het kader van de straat na (plus de gekozen straal) in plaats van alle
  // werken, hinder en A-Sign-blokken van het hele district (7 + 7 pagina's GIPOD en zo'n 130 A-Sign-
  // verzoeken), en zeggen we wat er sinds de verversing bij kwam. Lukt dat niet, dan blijft de stand van
  // de ochtend staan, met een eerlijke zin. Zonder stand (nog geen straatbestanden) werkt alles zoals vroeger.
  const SNEL_LAGEN = [["works", "werken"], ["publicSpace", "publiekeRuimte"], ["permits", "vergunningen"], ["terraces", "terrassen"]];
  const SNEL_ONDERDEEL = { works: "werken", publicSpace: "parkeerverboden en innames", permits: "vergunningen", terraces: "terrassen" };
  let snelMogelijk = true, snelBeurt = 0, districtBelofte = null, inzageBelofte = null;
  // De nagekeken stand van het Inzageloket (zoals permits-live.js): zonder die stand geen "bezwaar
  // indienen kan nu" bovenaan. Ontbreekt het bestand, dan zegt de kaart niets over een openbaar onderzoek.
  const inzageStatus = () => (inzageBelofte ||= fetch("/sources/inzage-status.json", { headers: { Accept: "application/json" } }).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  const districtsgrens = () => {
    const u = new URL("https://geodata.antwerpen.be/arcgissql/rest/services/P_Portal/portal_publiek2/MapServer/109/query");
    u.search = new URLSearchParams({ where: "districtnaam='ANTWERPEN'", outFields: "districtcode,districtnaam,afkorting", outSR: "4326", f: "geojson" });
    districtBelofte ||= getJson(u).then((d) => { const fs = Array.isArray(d?.features) ? d.features : []; if (fs.length !== 1) throw new Error("districtsgrens niet uniek"); return fs[0].geometry; });
    return districtBelofte.catch((error) => { districtBelofte = null; throw error; });
  };
  // De straatassen van het hele district (dezelfde belofte als hierboven bij het laden van de pagina): voor
  // de rijen van een dossier buiten het kader (publiekeRuimteInKader).
  const volledigeStraatIndex = () => import("./street-source.js").then(({ loadStreetIndex }) => loadStreetIndex());
  const levend = () => (window.PUBLIC_AGENDA_LIVE_STREETS = window.PUBLIC_AGENDA_LIVE_STREETS || {});
  function zetSnelLaag(naam, items, mislukt = []) {
    const live = levend();
    if (live.heelDistrict?.[naam]) return; // de lijst van het hele district is er al: die is vollediger
    if (Array.isArray(items)) live[naam] = items; else delete live[naam];
    live.failed = { ...(live.failed || {}), [naam]: [...mislukt] };
    window.dispatchEvent(new CustomEvent("public-agenda:street-layer", { detail: { name: naam, items: Array.isArray(items) ? items : null, failed: [...mislukt], bron: "straat" } }));
  }
  // Wat telt als "hetzelfde" bij het vergelijken: één kaart per evenementendossier en per werfzone,
  // één per parkeerverbod (dossier, periode en uren), anders het item zelf.
  const snelSleutel = (item) => item?.kind === "iod" && isEvenementDossier(item) ? `ev:${item.reference}`
    : item?.kind === "sgw" && item.reference ? `sgw:${item.reference}`
      : item?.kind === "parking" && item.reference ? `parking:${item.reference}|${item.start}|${item.end}|${item.startTime || ""}|${item.endTime || ""}`
        : String(item?.id || (item?.gipodId != null ? `work:${item.gipodId}` : ""));
  async function snelVoorStraat(place, { alleenLive = false } = {}) {
    const beurt = ++snelBeurt;
    if (place?.type !== "straat" || !snelMogelijk) {
      // Weg van de straat: haar stand mag geen deel van een wijk of het district lijken.
      if (state.snel) { for (const [naam] of SNEL_LAGEN) zetSnelLaag(naam, null); state.snel = null; }
      return;
    }
    let snel = state.snel?.straat === place.key ? state.snel : null;
    if (!alleenLive || !snel) {
      const [stand, inzage] = await Promise.all([laadStraat(place.id).catch(() => null), inzageStatus()]);
      if (beurt !== snelBeurt) return;
      if (!stand) {
        // Geen stand van de ochtend: zoals vroeger, alles live voor het hele district.
        snelMogelijk = false;
        view.straatSnel = false;
        state.snel = null;
        window.dispatchEvent(new CustomEvent("public-agenda:view-change"));
        return;
      }
      const lagen = lagenUitStand(stand, { inzage, vandaag: brusselsVandaag() });
      const bruikbaar = (laag) => ["ok", "stale"].includes(stand.index.lagen?.[laag]?.status);
      const tijden = SNEL_LAGEN.filter(([, laag]) => bruikbaar(laag)).map(([, laag]) => stand.index.lagen[laag].sinds).filter(Boolean).sort();
      // Het kader van de straat en van alles wat de verversing eraan hing (een terras met een adres in de
      // straat kan 150 m verder liggen); zonder bestand alleen dat van de straat.
      const k = Array.isArray(stand.doc?.kader) && stand.doc.kader.length === 4 ? stand.doc.kader : null, b = place.box;
      const kader = k && Array.isArray(b) ? [Math.min(k[0], b[0], b[2]), Math.min(k[1], b[1], b[3]), Math.max(k[2], b[0], b[2]), Math.max(k[3], b[1], b[3])] : k || b;
      snel = { straat: place.key, kader, ochtend: {}, ververst: tijden[0] || stand.index.ververst || "", inzage, bezig: true, nieuw: 0, weg: 0, mislukt: false, mislukteDelen: [] };
      for (const [naam, laag] of SNEL_LAGEN) if (bruikbaar(laag)) { snel.ochtend[naam] = lagen[naam]; zetSnelLaag(naam, lagen[naam]); }
      state.snel = snel;
    }
    snel.bezig = true;
    schedule();
    // Live: dat kader met de straal en 40 m marge; de straatassen nog 320 m ruimer (een werk hangt aan een
    // genoemde straat tot 300 m ver, site/street-core.js).
    const kader = kaderRond(snel.kader || place.box, (state.radius || 0) + 40);
    const uitslagen = !kader ? [] : await (async () => {
      const [district, streetIndex, modules] = await Promise.all([
        districtsgrens().catch(() => null),
        import("./street-source.js").then(({ fetchStreetIndex }) => fetchStreetIndex({ kader: kaderRond(kader, 320) })).catch(() => null),
        Promise.all([import("./works-live.js"), import("./public-space-live.js"), import("./permits-live-core.js"), import("./terraces-live.js")]).catch(() => null),
      ]);
      // Zonder straatassen hangt niets aan een straat, zonder grens vallen innames weg: dan niet vergelijken.
      if (!streetIndex || !district || !modules) return SNEL_LAGEN.map(([naam]) => ({ naam, ok: false }));
      const [{ werkenInKader }, { publiekeRuimteInKader }, { vergunningenInKader }, { terrassenInKader }] = modules;
      const vraag = { district, streetIndex };
      return Promise.all([
        werkenInKader(kader, vraag).then((r) => ({ naam: "works", ok: true, items: r.items }), () => ({ naam: "works", ok: false })),
        // Opbouw en afbraak van een evenement, de andere fasen van een werfzone, de andere plaatsen van een
        // parkeerverbod: vaak buiten het kader. Live op dossiernummer, met de straatassen van het hele district
        // (die laden hierboven al); lukt dat niet, dan vult de stand van de ochtend aan.
        publiekeRuimteInKader(kader, { ...vraag, dossierIndex: volledigeStraatIndex }).then((r) => ({ naam: "publicSpace", ok: !r.mislukt.length, items: r.dossiers === "ok" ? r.items : aanvullenMetOchtend(r.items, snel.ochtend.publicSpace) }), () => ({ naam: "publicSpace", ok: false })),
        vergunningenInKader(kader, { ...vraag, volledigeIndex: volledigeStraatIndex }).then((items) => ({ naam: "permits", ok: true, items: metInzage(metStratenVanDeOchtend(items, snel.ochtend.permits), snel.inzage, brusselsVandaag()) }), () => ({ naam: "permits", ok: false })),
        terrassenInKader(kader, vraag).then((items) => ({ naam: "terraces", ok: true, items }), () => ({ naam: "terraces", ok: false })),
      ]);
    })();
    if (beurt !== snelBeurt) return;
    const gekozen = { id: place.id, name: place.name, postcode: place.postcode };
    const inStraat = (item) => (view.refsOf(item) || []).some((ref) => sameStreet(ref, gekozen));
    let nieuw = 0, weg = 0;
    const mislukt = [];
    for (const { naam, ok, items } of uitslagen) {
      if (!ok) {
        mislukt.push(SNEL_ONDERDEEL[naam]);
        // Geen stand van de ochtend én geen live laag: eerlijk melden dat ze ontbreekt.
        if (!snel.ochtend[naam]) zetSnelLaag(naam, null, [SNEL_ONDERDEEL[naam]]);
        continue;
      }
      if (snel.ochtend[naam]) {
        const v = verschil(snel.ochtend[naam].filter(inStraat), items.filter(inStraat), snelSleutel);
        nieuw += v.nieuw; weg += v.weg;
      }
      zetSnelLaag(naam, items);
    }
    Object.assign(snel, { bezig: false, nieuw, weg, mislukt: mislukt.length === SNEL_LAGEN.length || !kader, mislukteDelen: mislukt });
    schedule();
  }
  // De zin onder de tegels, bij elke tekenbeurt opnieuw: met een straal hangt ze ook af van de straatassen
  // voor die straal (view.straalStand), die vaak na het live nakijken binnenkomen.
  function snelZin() {
    const snel = state.snel;
    if (!snel) return { zin: "", bezig: false };
    const straal = state.radius || 0, straalStand = view.straalStand || "klaar";
    const zin = standZin({ ververst: snel.ververst, bezig: snel.bezig, nieuw: snel.nieuw, weg: snel.weg, mislukt: snel.mislukt, mislukteDelen: snel.mislukteDelen, straal, straalStand });
    return { zin, bezig: snel.bezig || (!snel.mislukt && straal > 0 && straalStand === "laadt") };
  }

  // ---- plek kiezen ----
  function streetRef(place) { return { id: place.id, name: place.name, postcode: place.postcode }; }
  function applyPlace(place, { focusResults = false } = {}) {
    // Rekent de browser een stratenlijst zelf, dan hangt die af van de gekozen straat (filterRefsVan).
    if ((state.place?.key || "") !== (place?.key || "")) view.resetRefs?.();
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
    // Eén straat: de volledige lijsten van het district laden niet (works-live.js en co. kijken naar
    // view.straatSnel); de stand van de ochtend en het kader van de straat komen uit snelVoorStraat().
    view.straatSnel = place?.type === "straat" && snelMogelijk;
    announce();
    snelVoorStraat(place);
    if (focusResults) {
      section.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      // De focus springt naar de kop (schermlezers lezen dan de nieuwe plek voor), zonder kader rond
      // "Alles op deze plek": dat zag eruit als een fout. Wie verder tabt, ziet de focus gewoon.
      titleEl.classList.add("pv-stil");
      titleEl.focus({ preventScroll: true });
    }
  }
  function announce() {
    // A-Sign levert ook evenementen op straat: laden als "Evenementen" of "Werken & verkeer" aan staat.
    view.wantsStreetEvents = state.groups.has("evenementen");
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
    // Een actieknop: de tekst zegt wat hij doet, dus geen aria-pressed (dat zou "ingedrukt" voorlezen).
    groupsEl.innerHTML = `<button type="button" class="pv-chip pv-chip-all" data-group="*">${esc(allesActie)}</button>${chips.join("")}`;
    modesEl.innerHTML = MODES.map(([k, label]) => `<button type="button" data-mode="${k}" aria-pressed="${state.mode === k}">${label}</button>`).join("");
    periodsEl.hidden = state.mode !== "lijst";
    periodsEl.innerHTML = PERIODS.map(([k, label]) => `<button type="button" data-period="${k}" aria-pressed="${state.period === k}">${label}</button>`).join("");
    navEl.hidden = state.mode !== "maand";
    if (state.mode === "maand") navEl.querySelector(".pv-nav-label").textContent = `${MONTHS[monthOf(state.cursor)]} ${state.cursor.slice(0, 4)}`;
    navEl.querySelector(".pv-nav-today").disabled = startOfMonth(today) === state.cursor;
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
    state.cursor = startOfMonth(today);
    state.selectedDay = today;
    state.dagFilter = "";
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
    if (event.target.closest(".pv-nav-today")) state.cursor = startOfMonth(today);
    else if (step) state.cursor = addMonths(state.cursor, step);
    else return;
    if (state.mode === "maand") state.selectedDay = state.cursor <= today && today < addMonths(state.cursor, 1) ? today : state.cursor;
    render();
  });

  // ---- de plekkop ----
  function renderPlace(summary, loading, failure = "", week = null) {
    const place = state.place;
    placeBox.hidden = !place;
    if (!place) return;
    const wijk = place.type === "straat" && place.wijken?.[0] ? index.byKey.get(`wijk:${place.wijken[0]}`) : null;
    const kind = place.type === "straat" ? "Straat" : place.type === "wijk" ? "Wijk" : "Postcode";
    const meta = place.type === "straat" ? `${place.postcode} Antwerpen${wijk ? ` · wijk <button type="button" class="pv-link" data-place="${esc(wijk.key)}">${esc(wijk.label)}</button>` : ""}` : esc(place.sub);
    const radius = place.type === "straat" ? `<div class="pv-seg pv-radius" role="group" aria-label="Hoe ver rond de straat">${[0, 250, 500, 1000].map((r) => `<button type="button" data-radius="${r}" aria-pressed="${state.radius === r}">${r ? `+${r >= 1000 ? "1 km" : `${r} m`}` : "Alleen de straat"}</button>`).join("")}</div>` : "";
    const tile = (n, label, cls, group) => !state.groups.has(group)
      ? `<li class="pv-stat pv-stat-off ${cls}"><button type="button" data-only="${group}" aria-label="${esc(label)} staan uit; tik om ze te tonen"><strong>–</strong><span>${esc(label)} (uit)</span></button></li>`
      : `<li class="pv-stat ${cls}"><button type="button" data-only="${group}" aria-label="Toon alleen ${esc(label)}${group === "werken" && !n && state.werkenOnvolledig ? " (onbekend: niet alles laadde)" : ""}"><strong>${group === "werken" && !n && state.layersPending ? "…" : group === "werken" && !n && state.werkenOnvolledig ? "?" : n}</strong><span>${esc(label)}</span></button></li>`;
    // In de DOM: label, naam (de kop), knoppen, meta. Wie met een schermlezer naar de kop springt en verder
    // leest, hoort de knoppen nog. Op het scherm staan de knoppen op de rij van het label (of eronder als ze er
    // niet naast passen) en de naam daaronder (CSS order). De kop krijgt geen focus: Tab gaat Deel, Andere
    // plek, dan de wijk, in de volgorde die je ziet.
    placeBox.innerHTML = `
      <div class="pv-place-top">
        <span class="pv-place-kind">${placeIcon(place)} ${kind}</span>
        <h2 class="pv-place-name">${esc(place.label)}</h2>
        <div class="pv-place-actions">
          <button type="button" class="pv-btn pv-share" aria-label="Deel de link naar deze plek"><span aria-hidden="true">🔗</span> Deel</button>
          <button type="button" class="pv-btn pv-btn-ghost pv-close">Andere plek</button>
        </div>
        <p class="pv-place-meta">${meta}</p>
      </div>
      ${week?.zin ? `<p class="pv-dezeweek pv-dezeweek-${week.licht}"><span class="pv-licht" aria-hidden="true"></span><strong class="pv-licht-label">${esc(WEEK_LICHT[week.licht] || "")}</strong> <span class="pv-dezeweek-zin">${esc(week.zin)}</span></p>` : ""}
      ${failure ? `<p class="pv-place-loading pv-place-failed" role="status">${esc(failure)}</p>` : ""}
      <ul class="pv-stats" aria-label="Samenvatting">
        ${tile(summary.evenementen, `${summary.evenementen === 1 ? "evenement" : "evenementen"}${summary.innamesOpStraat ? ` (+ ${summary.innamesOpStraat} ${summary.innamesOpStraat === 1 ? "inname" : "innames"})` : ""}`, "cat-festival", "evenementen")}
        ${tile(summary.werkenBezig, "werken nu", "cat-works", "werken")}
        ${tile(summary.werkenGepland, "werken gepland", "cat-works pv-stat-planned", "werken")}
        ${tile(summary.inspraak, "inspraak & info", "cat-admin", "inspraak")}
        ${tile(summary.vergunningen, `${summary.vergunningen === 1 ? "vergunning" : "vergunningen"}${summary.terrassen ? ` (+ ${summary.terrassen} ${summary.terrassen === 1 ? "terras" : "terrassen"})` : ""}`, "cat-permits", "vergunningen")}
      </ul>
      ${radius /* onder de tegels: op een gsm staan straat, weekzin en tellers zo zonder scrollen in beeld */}
      ${loading ? `<p class="pv-place-loading"><span class="pv-spinner" aria-hidden="true"></span> ${esc(loading)}</p>` : ""}
      ${(() => { const s = place.type === "straat" ? snelZin() : null; return s?.zin ? `<p class="pv-place-loading pv-stand" role="status">${s.bezig ? `<span class="pv-spinner" aria-hidden="true"></span> ` : ""}${esc(s.zin)}</p>` : ""; })()}`;
  }
  placeBox.addEventListener("click", (event) => {
    const r = event.target.closest("[data-radius]");
    if (r) { state.radius = Number(r.dataset.radius); view.setArea({ radius: state.radius }); announce(); snelVoorStraat(state.place, { alleenLive: true }); return; }
    const p = event.target.closest("[data-place]");
    if (p) { applyPlace(index.byKey.get(p.dataset.place), { focusResults: true }); return; }
    const only = event.target.closest("[data-only]");
    if (only) { state.groups = state.groups.has(only.dataset.only) ? new Set([only.dataset.only]) : new Set([...state.groups, only.dataset.only]); view.wantsLiveLayers = true; state.customized = true; view.setThemes(themesForGroups([...state.groups])); announce(); return; }
    if (event.target.closest(".pv-close")) { search.value = ""; applyPlace(null); search.focus(); return; }
    const share = event.target.closest(".pv-share");
    if (share) {
      const link = window.location.href;
      const done = () => { share.innerHTML = `<span aria-hidden="true">✓</span> Link gekopieerd`; setTimeout(() => { share.innerHTML = `<span aria-hidden="true">🔗</span> Deel`; }, 2400); };
      const tekst = state.week?.zin && !state.layersPending ? state.week.zin : undefined;
      if (navigator.share && matchMedia("(pointer: coarse)").matches) navigator.share({ title: `${state.place.label} · publieke agenda`, ...(tekst ? { text: tekst } : {}), url: link }).catch(() => {});
      else navigator.clipboard?.writeText(link).then(done, () => window.prompt("Kopieer deze link", link));
    }
  });

  // ---- entries verzamelen ----
  // Eerst alle kaarten op de plek (ook van soorten die uit staan), zodat de chips kaarten tellen en
  // geen ruwe records; daarna alleen de gekozen soorten tonen. Een evenementendossier is een evenement.
  function collect() {
    const live = window.PUBLIC_AGENDA_LIVE_STREETS || {};
    if (Array.isArray(live.works) || Array.isArray(live.publicSpace)) vraagKaartUitleg();
    const vandaag = brusselsToday();
    const agenda = (Array.isArray(window.PUBLIC_AGENDA_VISIBLE_ITEMS) ? window.PUBLIC_AGENDA_VISIBLE_ITEMS : []).map((item) => agendaEntry(item, item.category || "other"));
    const inPlace = (rows) => (Array.isArray(rows) ? rows.filter((row) => view.matchesStreet(row)) : []);
    const liveEntries = [
      ...werkEntries(inPlace(live.works), { vandaag, uitleg: kaartUitleg }),
      ...publicSpaceEntries(inPlace(live.publicSpace), { vandaag, alle: live.publicSpace || [], uitleg: kaartUitleg, wijkVan, identiteit: identiteitSamen(evenementIdentiteit, evenementAuto), agendaItems: window.PUBLIC_AGENDA_PUBLIC_ITEMS || [], straat: state.place?.type === "straat" ? state.place.name : "", straal: state.place?.type === "straat" ? state.radius : 0, index: liveIndex, lijstVan }),
      ...inPlace(live.permits).map((row) => permitEntry(row)),
      ...terrasEntries(inPlace(live.terraces)),
    ];
    const entries = [...agenda, ...liveEntries.filter((entry) => state.groups.has(entry.group))];
    // Chips: tellen binnen de plek, ook voor soorten die uit staan. agenda.js telt de agendapunten per
    // soort; de live lagen tellen we hier per kaart (een dossier met 5 innames is 1 kaart).
    const cc = state.agendaCounts || {};
    const sumThemes = (themes) => themes.reduce((n, t) => n + (Number(cc[t]) || 0), 0);
    const kaarten = (group) => new Set(liveEntries.filter((e) => e.group === group).map((e) => e.uid)).size;
    const loadedLayer = (rows) => Array.isArray(rows);
    state.counts = {};
    for (const g of KIND_GROUPS) {
      let n = sumThemes(g.themes.filter((t) => t !== "publicSpace" && t !== "permits"));
      if (g.key === "werken" && !loadedLayer(live.works) && !loadedLayer(live.publicSpace)) { state.counts[g.key] = view.hasPlace || n ? n || undefined : undefined; continue; }
      if (g.key === "vergunningen" && !loadedLayer(live.permits) && !loadedLayer(live.terraces)) { state.counts[g.key] = undefined; continue; }
      n += kaarten(g.key);
      state.counts[g.key] = n;
    }
    // Live lagen: nog onderweg, of (eerlijk gemeld) niet of maar half geladen. Elke live module zet
    // per laag een mislukt-vlag in live.failed; ook een laag die deels laadde, telt als onvolledig.
    const loading = [];
    const mislukt = live.failed || {};
    const wants = view.hasPlace || view.wantsLiveLayers;
    // Een evenement op straat hoort bij de groep "evenementen", ook als de verkeersmaatregelen uit staan.
    const evenementenOpStraat = state.groups.has("evenementen");
    if (wants && view.enabled("works") && !loadedLayer(live.works) && !mislukt.works?.length) loading.push("werken");
    if (wants && (view.enabled("publicSpace") || evenementenOpStraat) && !loadedLayer(live.publicSpace) && !mislukt.publicSpace?.length) loading.push(view.enabled("publicSpace") ? "verkeersmaatregelen" : "evenementen op straat");
    if (wants && view.enabled("terraces") && !loadedLayer(live.terraces) && !mislukt.terraces?.length) loading.push("terrassen");
    const failed = ontbrekendeOnderdelen(mislukt, (laag) => view.enabled(laag) || (laag === "publicSpace" && evenementenOpStraat));
    // De weekzin hangt niet af van de gekozen soorten: alle agendapunten op de plek (niet VISIBLE_ITEMS,
    // die volgen de soortkeuze), plus alle kaarten van de live lagen die geladen zijn. Alleen evenementen
    // en werken in de komende 7 dagen; eerst op datum, zodat de plekfilter niet elk punt moet nakijken.
    const weekEinde = addDays(vandaag, 6);
    const agendaWeek = !state.place ? [] : (Array.isArray(window.PUBLIC_AGENDA_PUBLIC_ITEMS) ? window.PUBLIC_AGENDA_PUBLIC_ITEMS : [])
      .filter((item) => String(item?.date || "").slice(0, 10) <= weekEinde)
      .map((item) => agendaEntry(item, item.category || "other"))
      .filter((e) => (e.group === "evenementen" || e.group === "werken") && overlaps(e, vandaag, weekEinde) && view.matchesStreet(e.item));
    // Een laag die de weekzin nodig heeft en die uit staat of er niet is: dan nooit "rustig". Nog onderweg
    // (loading) of mislukt (failed) zegt de zin elders; een geladen laag telt mee, ook als ze uit staat. Een
    // laag die uit staat en (deels) mislukte, staat niet in `failed` (dat volgt de soortkeuze): die zeggen we
    // hier, los van de keuze. Geladen is ze dan alleen als niets ervan mislukte.
    const psAan = view.enabled("publicSpace") || evenementenOpStraat;
    const weekLaag = (rows, fout, uit) => ({ uit, geladen: loadedLayer(rows) && !fout?.length, deels: loadedLayer(rows) && Boolean(fout?.length) });
    const weekOnbekend = [
      ...(!view.enabled("works") || (!loadedLayer(live.works) && !mislukt.works?.length) ? [{ wat: "werken", ...weekLaag(live.works, mislukt.works, !view.enabled("works")) }] : []),
      ...(!psAan || (!loadedLayer(live.publicSpace) && !mislukt.publicSpace?.length) ? ["parkeerverboden", "evenementen op straat"].map((wat) => ({ wat, ...weekLaag(live.publicSpace, mislukt.publicSpace, !psAan) })) : []),
    ];
    return { entries, loading, failed, opPlek: [...agendaWeek, ...liveEntries], weekOnbekend };
  }

  // ---- weergave ----
  function rowTemplate(entry, { today, context = "list" } = {}) {
    const k = kindInfo(entry);
    const uid = cssId(entry.uid);
    const open = state.open.has(entry.uid);
    const multi = Boolean((entry.end && entry.end > entry.start) || entry.openEnd);
    const planned = entry.start && entry.start > today;
    const running = multi && entry.start && entry.start <= today;
    const marktUur = entry.theme === "markets" ? publiekeMarktUur(entry.item) : null;
    let when = marktUur ? marktUur.start.replace(":",".") : leesbaarUur(entry,{multi,running});
    // Een evenement op straat: opbouw, de dag zelf of afbraak (periodeVan/evenementFase in place-core.js).
    const periode = periodeVan(entry), fase = evenementFase(entry, today);
    if (context === "running") when = (fase ? periode.end : entry.end) ? `t/m ${kortDatum(fase ? periode.end : entry.end, today)}` : "Loopt";
    const FASE_BADGE = { opbouw: ["Opbouw bezig", "now"], afbraak: ["Afbraak bezig", "now"], evenement: ["Vandaag", "now"], gepland: ["Gepland", "planned"] };
    // Anders "Periode loopt" voor een werk dat GIPOD nog niet "in uitvoering" noemt (place-core.js).
    const b = fase ? null : periodeBadge(entry, today);
    // Een periode van twee weken of langer ("Loopt tot 29 okt") en losse dagen ("Volgende: 9 nov") krijgen
    // geen "Vandaag" als er vandaag niets is (evenementBadge in place-core.js).
    const eigenBadge = fase ? evenementBadge(entry, today) : null;
    const badge = eigenBadge ? `<span class="pv-badge pv-badge-${eigenBadge.soort}">${esc(eigenBadge.label)}</span>`
      : fase
      ? (FASE_BADGE[fase] ? `<span class="pv-badge pv-badge-${FASE_BADGE[fase][1]}">${FASE_BADGE[fase][0]}</span>` : "")
      : b ? `<span class="pv-badge pv-badge-${b.soort}">${esc(b.label)}</span>` : "";
    const range = multi ? `${fullDate(entry.start)} – ${entry.end ? fullDate(entry.end) : "einde volgens de bron"}` : entry.start ? fullDate(entry.start) : "";
    let progress = "";
    if (entry.losseDagen?.length) progress = `<p class="pv-progress-text">${esc(losseDagenTekst(entry, today))}</p>`;
    else if (multi && entry.end) {
      const total = Math.max(1, daysBetween(entry.start, entry.end) + 1);
      const done = Math.min(total, Math.max(0, daysBetween(entry.start, today) + 1));
      progress = `<div class="pv-progress" aria-hidden="true"><span style="width:${Math.round((done / total) * 100)}%"></span></div><p class="pv-progress-text">${esc(voortgangTekst(entry.start, entry.end, today))}</p>`;
    }
    const item = entry.item || {};
    const duidelijk = duidelijkeKaart(entry, item, { straat: state.place?.type === "straat" ? state.place.name : "", vandaag: today });
    const waarKort = duidelijk.waar ? duidelijk.waar.kort : entry.location;
    // Bij een evenementkaart staan de gewone links bovenaan (uitlegTemplate), de andere onderaan. Een
    // technisch ArcGIS-blad is geen infopagina: ingeklapt, met een zin die zegt wat het is.
    const kern = Boolean(entry.uitleg?.kern);
    const { gewoon, technisch } = splitsLinks(bezoekersLinks(entry));
    const bovenaan = kern ? gewoon.filter((l) => l.type !== "source") : [];
    const links = gewoon.filter((l) => !bovenaan.includes(l)).map(linkHtml);
    const technischBlok = technisch.length ? `<details class="pv-tech"><summary>Technische details</summary><p>Ruwe gegevens van de stad, zonder uitleg voor bewoners.</p><p class="pv-links">${technisch.map(linkHtml).join("")}</p></details>` : "";
    const bronHint = bezoekersHint(entry);
    if (entry.source === "agenda" && !item.noEventPage && item.feed) links.push(`<a href="/event/${encodeURIComponent(entry.id)}">Deel dit agendapunt</a>`);
    if (entry.source === "agenda" && window.AgendaIcs?.downloadIndividualIcs) links.push(`<button type="button" class="pv-ics" data-ics="${esc(entry.id)}">Zet in je agenda (.ics)</button>`);
    // Van de lijst naar de kaart (neighborhood-map.js, public-agenda:kaart-toon). Niet bij een terras of een markt.
    // Of de kaart er een plek voor heeft, zegt de kaart zelf: de knop hangt niet af van de geometrie, zodat het
    // kaartje uit de stand van de ochtend en het live nagekeken kaartje er hetzelfde uitzien.
    const opKaart = entry.source !== "terraces" && entry.theme !== "markets" ? `<p class="pv-op-kaart-rij"><button type="button" class="pv-btn pv-btn-ghost pv-op-kaart" data-op-kaart="${esc(entry.uid)}">Toon op de kaart</button></p>` : "";
    return `
      <li class="pv-row cat-${esc(k.cat)}${open ? " open" : ""}${entry.uitleg?.kern ? " pv-row-kern" : ""}" data-uid="${esc(entry.uid)}" data-soort="${kaartSoort(entry)}" data-tel="${esc(lijstSleutel(entry))}">
        <button type="button" class="pv-row-btn" aria-expanded="${open}" aria-controls="pv-d-${uid}">
          <span class="pv-row-when">${esc(duidelijk.tijd || when)}</span>
          <span class="pv-row-main">
            <span class="pv-row-kind"><span aria-hidden="true">${k.emoji}</span> ${esc(k.label)}${badge}${duidelijk.badge ? `<span class="pv-badge pv-badge-now">${esc(duidelijk.badge)}</span>` : ""}</span>
            <strong class="pv-row-title">${esc(duidelijk.titel)}</strong>
            ${duidelijk.melding ? `<span class="pv-row-alert">${esc(duidelijk.melding)}</span>` : ""}
            ${duidelijk.samenvatting ? `<span class="pv-row-summary">${esc(duidelijk.samenvatting)}</span>` : ""}
            ${waarKort && !entry.uitleg ? `<span class="pv-row-where">${esc(waarKort)}</span>` : ""}
            ${entry.jouwStraat ? `<span class="pv-row-jouw">${esc(entry.jouwStraat)}</span>` : ""}
            ${context !== "list" || multi ? `<span class="pv-row-range">${esc(multi ? kortBereik(entry.start, entry.end, today) : "")}</span>` : ""}
          </span>
          <span class="pv-row-chevron" aria-hidden="true"></span>
        </button>
        <div class="pv-detail" id="pv-d-${uid}" ${open ? "" : "hidden"}>
          ${progress}
          ${duidelijk.toelichting ? `<p class="pv-bronduidelijkheid">${esc(duidelijk.toelichting)}</p>` : ""}
          ${duidelijk.regels?.length ? `<dl class="pv-uitleg">${duidelijk.regels.map(([dt,dd]) => `<div><dt>${esc(dt)}</dt><dd>${esc(dd)}</dd></div>`).join("")}${waarTemplate(duidelijk.waar)}</dl>` : ""}
          ${entry.uitleg ? uitlegTemplate(entry, bovenaan) : duidelijk.eigenDetail ? "" : `${entry.info ? `<p>${esc(entry.info)}</p>` : ""}
          <dl>
            ${range ? `<div><dt>Wanneer</dt><dd>${esc(entry.source === "agenda" && entry.dateLabel ? entry.dateLabel : range)}${marktUur ? ` · ${esc(marktUur.tekst)} (normale bezoekersuren stad)` : entry.timeText ? ` · ${esc(entry.timeText)}` : ""}</dd></div>` : ""}
            ${entry.location ? `<div><dt>Waar</dt><dd>${esc(entry.location)}${(entry.straten || []).length > 2 ? `<details class="pv-streets"><summary>Toon alle ${entry.straten.length} straten</summary><p>${esc(entry.straten.join(", "))}</p></details>` : ""}</dd></div>` : ""}
            ${entry.status ? `<div><dt>Status</dt><dd>${esc(entry.status)}</dd></div>` : ""}
            ${entry.reference ? `<div><dt>Referentie</dt><dd>${esc(entry.reference)}</dd></div>` : ""}
            ${item.sourcePublisher ? `<div><dt>Bron</dt><dd>${esc(item.sourcePublisher)}</dd></div>` : ""}
          </dl>`}
          ${bronHint ? `<p class="pv-bron-hint">${esc(bronHint)}</p>` : ""}
          ${marktUur ? `<p class="pv-bron-hint">${esc(marktUur.status)}</p>` : ""}
          ${links.length ? `<p class="pv-links">${links.join("")}</p>` : ""}
          ${opKaart}
          ${technischBlok}
        </div>
      </li>`;
  }
  // "Waar" bij een aanvraag vanaf 3 straten: alleen de volledige lijst, ingeklapt. De korte regel
  // ("Letlandstraat · ook dicht bij Bstraat, Cstraat en 9 andere straten") staat al in de kop; tot 2
  // straten staat daar alles.
  function waarTemplate(waar) {
    if (!waar?.ingeklapt) return "";
    return `<div><dt>Waar</dt><dd><details class="pv-streets"><summary>Toon alle ${waar.straten.length} straten</summary><p>${esc(waar.straten.join(", "))}</p></details></dd></div>`;
  }
  // Titel van een balk in de maand: bij een evenement op straat de dag zelf en de innameperiode.
  function balkTitel(entry) {
    const p = periodeVan(entry);
    const eigen = `${entry.title} · ${shortDate(entry.start)}${entry.end && entry.end !== entry.start ? ` → ${shortDate(entry.end)}` : ""}`;
    return entry.innameStart && p.end ? `${eigen} (opbouw tot afbraak: ${shortDate(p.start)} → ${shortDate(p.end)})` : eigen;
  }
  // Een link naar een pagina van deze site (/event/…) opent in hetzelfde tabblad.
  function linkHtml(l) {
    const extern = !/^\//.test(l.url);
    return `<a class="${l.type === "source" ? "pv-bron-technisch" : "pv-bron-bezoeker"}" href="${esc(l.url)}"${extern ? ` target="_blank" rel="noopener noreferrer"` : ""}>${esc(l.label)}${extern ? ` <span aria-hidden="true">↗</span>` : ""}</a>`;
  }
  // Segmenten van de gekozen straat, voor de schets ("jouw straat" in een eigen kleur).
  function gekozenSegmenten() {
    const place = state.place;
    if (place?.type !== "straat" || !liveIndex?.segments) return [];
    return liveIndex.segments.filter((seg) => (seg.refs || []).some((r) => r.name === place.name && (!r.postcode || !place.postcode || r.postcode === place.postcode))).map((seg) => [seg.a, seg.b]);
  }
  // De schets van een parcours, één keer per lijn, straatas en gekozen straat: elke tekenbeurt bouwt
  // alle kaartjes opnieuw (ook ingeklapt), en een schets legt duizenden straatstukken onder het parcours.
  let schetsIndex = null, schetsStraat = "", schetsAchtergrond = [], schetsGekozen = [], schetsen = new WeakMap();
  function schetsVan(kaart) {
    const straat = state.place?.type === "straat" ? `${state.place.name}|${state.place.postcode || ""}` : "";
    if (schetsIndex !== liveIndex || schetsStraat !== straat) {
      schetsIndex = liveIndex; schetsStraat = straat; schetsen = new WeakMap();
      schetsAchtergrond = (liveIndex?.segments || []).map((s) => [s.a, s.b]);
      schetsGekozen = gekozenSegmenten();
    }
    if (!schetsen.has(kaart)) schetsen.set(kaart, kaartSvg(kaart, schetsAchtergrond, { gekozen: schetsGekozen }));
    return schetsen.get(kaart);
  }
  const kaartPerUid = new Map();
  const schetsFiguur = (entry) => {
    const kaart = schetsVan(entry.kaart);
    return kaart ? `<figure class="pv-kaart">${kaart}<figcaption>Schets van ${entry.kaartDeel ? "een deel van het parcours" : "het parcours"} (rood)${kaart.includes('class="ku-jouw"') ? " en jouw straat (blauw)" : ""}, over de straatassen van de stad.</figcaption></figure>` : "";
  };
  // Uitleg in gewone taal (site/kaart-uitleg.js). Een evenementkaart begint met wat, wanneer, waar,
  // jouw straat en wat je merkt, met de officiële link meteen daaronder; dan de details: wat er in het
  // dossier staat (het parcours vooraan, de parkeerverboden ingeklapt), de straten die het parcours
  // alleen kruist, de schets en één korte bronregel. Een werk houdt zijn regels en de straten ingeklapt;
  // alleen de organisator (niet openbaar), het nummer en de codes staan ingeklapt onder "Bron en dossier".
  function uitlegTemplate(entry, bezoekerLinks = []) {
    const u = entry.uitleg;
    const straten = entry.straten || [];
    const kruist = entry.kruist || [];
    const lange = straten.length > 3;
    // De schets pas tekenen als het kaartje open is: dichte kaartjes met duizenden straatstukken
    // maakten de lijst op een gsm seconden traag (zie het klikken op een rij hieronder).
    if (entry.kaart?.length) kaartPerUid.set(entry.uid, entry);
    const kaart = !entry.kaart?.length ? "" : state.open.has(entry.uid) ? schetsFiguur(entry) : `<figure class="pv-kaart" data-schets hidden></figure>`;
    const { regels, dossier, stratenNoot, bron, technisch } = kaartIndeling(u, { reference: entry.reference, straten: straten.length });
    const noot = u.stratenNoot || stratenNoot;
    const alleStraten = lange ? `<details class="pv-streets"><summary>Toon alle ${straten.length} straten</summary>${noot ? `<p class="pv-straten-noot">${esc(noot)}</p>` : ""}<p>${esc(straten.join(", "))}</p></details>` : "";
    const kruistRij = kruist.length ? `<div><dt>Kruist</dt><dd>${kruist.length <= 3 ? esc(kruist.join(", ")) : `${kruist.length} straten kruisen het parcours of komen erop uit<details class="pv-streets"><summary>Toon de ${kruist.length} straten</summary><p>${esc(kruist.join(", "))}</p></details>`}</dd></div>` : "";
    // Eén omschrijving als gewone tekst; meer als lijst, met de rest ingeklapt (de rest telt er altijd 2 of meer).
    const lijst = (items) => `<ul class="pv-dossier">${items.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`;
    const dossierHtml = () => (dossier.zichtbaar.length === 1 && !dossier.dicht.length ? esc(dossier.zichtbaar[0])
      : `${lijst(dossier.zichtbaar)}${dossier.dicht.length ? `<details class="pv-streets"><summary>${esc(dossier.knop)}</summary>${lijst(dossier.dicht)}</details>` : ""}`);
    const regel = ([dt, dd]) => `<div><dt>${esc(dt)}</dt><dd>${dt === "In het dossier" && dossier.zichtbaar.length ? dossierHtml() : esc(dd)}</dd></div>`;
    if (u.kern) {
      // Welk parcours het is en wat er nog gebeurt, staat zichtbaar (kaartIndeling); de kern zegt al wat,
      // wanneer en waar.
      const dossierRij = dossier.zichtbaar.length ? regel(["In het dossier", ""]) : "";
      return `
          <dl class="pv-kern">${u.kern.map(([dt, dd]) => `<div><dt>${esc(dt)}</dt><dd>${esc(dd)}${dt === "Waar" ? alleStraten : ""}</dd></div>`).join("")}</dl>
          ${bezoekerLinks.length ? `<div class="pv-links pv-links-top">${bezoekerLinks.map((l) => `${linkHtml(l)}${l.uitleg ? `<small class="pv-link-uitleg">${esc(l.uitleg)}</small>` : ""}`).join("")}</div>` : ""}
          ${regels.length || dossierRij || kruistRij || entry.status ? `<dl class="pv-uitleg">
            ${regels.map(regel).join("")}
            ${dossierRij}
            ${kruistRij}
            ${entry.status ? `<div><dt>Status</dt><dd>${esc(entry.status)}</dd></div>` : ""}
          </dl>` : ""}
          ${kaart}
          ${u.voetnoot ? `<p class="pv-voetnoot">${esc(u.voetnoot)}</p>` : ""}`;
    }
    return `
          <dl class="pv-uitleg pv-uitleg-kaart">
            ${regels.map(regel).join("")}
            ${straten.length ? `<div><dt>Waar</dt><dd>${esc(u.plek || straten.join(", "))}${alleStraten}</dd></div>` : ""}
            ${kruistRij}
            ${entry.status ? `<div><dt>Status</dt><dd>${esc(entry.status)}</dd></div>` : ""}
          </dl>
          ${u.bronTekst ? `<details class="pv-streets pv-bron-tekst"><summary>Tekst van de beheerder in GIPOD</summary><p>${esc(u.bronTekst)}</p></details>` : ""}
          ${kaart}
          ${u.ontbreekt.length ? `<p class="pv-ontbreekt"><strong>Niet in de bron:</strong> ${esc(u.ontbreekt.join(" · "))}. Kijk bij de officiële bron hieronder.</p>` : ""}
          ${bron.length || technisch ? `<details class="pv-bron-dossier"><summary>Bron en dossier</summary>${bron.length ? `<dl class="pv-uitleg">${bron.map(regel).join("")}</dl>` : ""}${technisch ? `<p class="pv-technisch">${esc(technisch)}</p>` : ""}</details>` : ""}`;
  }
  function sectionTemplate(key, title, entries, options, note = "") {
    if (!entries.length) return "";
    // Een open kaartje (van de kaart of een link geopend) zit nooit verborgen achter "Toon alle N".
    const all = state.expanded.has(key) || entries.slice(SECTION_LIMIT).some((e) => state.open.has(e.uid));
    const shown = all ? entries : entries.slice(0, SECTION_LIMIT);
    // De titel kan een verborgen pictogram in HTML bevatten; de toegankelijke naam is alleen de tekst.
    const naam = String(title).replace(/<span aria-hidden="true">[^<]*<\/span>/g, "").replace(/<[^>]*>/g, "").trim();
    return `<section class="pv-day" aria-label="${esc(naam)}"><h3 class="pv-day-title">${title}<span class="pv-day-n">${entries.length}</span></h3>${note}<ul class="pv-rows">${shown.map((e) => rowTemplate(e, options)).join("")}</ul>${entries.length > shown.length ? `<button type="button" class="pv-more-rows" data-expand="${esc(key)}">Toon alle ${entries.length}</button>` : ""}</section>`;
  }
  function dayTitle(day, today) {
    const rel = day === today ? "Vandaag" : day === addDays(today, 1) ? "Morgen" : "";
    return `${rel ? `<span class="pv-rel">${rel}</span> ` : ""}${esc(longDate(day))}${day.slice(0, 4) !== today.slice(0, 4) ? ` ${day.slice(0, 4)}` : ""}`;
  }
  function marktBundels(entries, today) {
    const items = entries.filter((e) => e.theme === "markets").map((e) => e.item);
    return window.PublicAgendaUitgaan?.bundleWeeklyMarkets?.(items, today) || [];
  }
  function marketsTemplate(bundles) {
    const publiekeUren = m => publiekeMarktUur({sourceId:"stad-markten",inDistrict:m.inDistrict,location:m.location,title:m.title,date:m.nextDate});
    if (!bundles.length) return "";
    return `<section class="pv-day" aria-label="Wekelijkse markten"><h3 class="pv-day-title"><span aria-hidden="true">🧺</span> Wekelijkse markten<span class="pv-day-n">${bundles.length}</span></h3><ul class="pv-markets">${bundles.map((m) => `<li class="cat-markets" data-soort="agenda" data-tel="${esc(lijstSleutel(marktBundelEntry(m)))}"><strong>${esc(m.title)}</strong><span>${esc(m.weekdays.join(", "))}${publiekeUren(m) ? ` · ${esc(publiekeUren(m).tekst)} (normale bezoekersuren stad)` : m.timeText ? ` · ${esc(m.timeText)} (GIPOD-innameuren)` : ""}</span>${m.location ? `<small>${esc(m.location)}</small>` : ""}${m.nextDate ? `<small>Volgende: ${esc(longDate(m.nextDate))}</small>` : ""}<a href="https://www.antwerpen.be/info/5c065842a67793326b260661/markten-in-district-antwerpen" target="_blank" rel="noopener noreferrer">Stad Antwerpen: locatie en marktuur ↗</a></li>`).join("")}</ul></section>`;
  }
  // De tijdlijn geeft een eigen periode (`wanneer`: "op dinsdag 20 oktober", "in de komende 14 dagen") en
  // uitleg mee: een lege dag zegt niets over de hele plek. `later`: de tip "Toon ook wat later komt".
  function emptyTemplate(today, { wanneer = "", uitleg: eigenUitleg = "", later = false } = {}) {
    const place = state.place;
    const where = esc(plekWaar(place));
    const tips = [];
    if (place?.type === "straat") {
      if (state.radius < 500) tips.push(`<button type="button" class="pv-btn" data-radius-tip="500">Kijk ook 500 m rond de straat</button>`);
      const wijk = place.wijken?.[0] && index.byKey.get(`wijk:${place.wijken[0]}`);
      if (wijk) tips.push(`<button type="button" class="pv-btn pv-btn-ghost" data-place="${esc(wijk.key)}">Bekijk de wijk ${esc(wijk.label)}</button>`);
    }
    if ((state.mode === "lijst" && state.period !== "alles") || later) tips.push(`<button type="button" class="pv-btn pv-btn-ghost" data-period-tip="alles">Toon ook wat later komt</button>`);
    if (state.groups.size < KIND_GROUPS.length) tips.push(`<button type="button" class="pv-btn pv-btn-ghost" data-all-tip>Toon alle soorten</button>`);
    const period = wanneer ? ` ${esc(wanneer)}` : state.mode === "lijst" ? (state.period === "alles" ? "" : ` in de komende ${PERIODS.find(([k]) => k === state.period)[1]}`) : "";
    const uitleg = eigenUitleg || legeStaatTekst({ place, gekozen: state.customized, aantalSoorten: state.groups.size, onvolledig: Boolean(state.onvolledig) });
    // Lege staat met een laag die niet laadde: eerst zeggen dat het overzicht onvolledig is.
    const onvolledig = state.onvolledig ? `<p class="pv-empty-warn"><span aria-hidden="true">⚠️</span> ${esc(state.onvolledig)}</p>` : "";
    return `<div class="pv-empty"><div class="pv-empty-art" aria-hidden="true">🗓️</div><h3>Niets gevonden ${where}${period}</h3>${onvolledig}<p>${esc(uitleg)} ${place?.type === "straat" ? "Een straat is klein: in de buurt gebeurt vaak meer." : ""}</p><div class="pv-empty-tips">${tips.join("")}</div></div>`;
  }
  function renderList(entries, today, bundels = []) {
    const { from, to } = periodRange(state.period, today);
    const dated = entries.filter((e) => e.theme !== "markets" && e.group !== "vergunningen");
    const { running, days, later, doorlopend } = groupForList(dated, { from, to, today });
    // Een aanvraag waarvan het openbaar onderzoek vandaag loopt (termijn nagekeken in het Inzageloket) staat
    // bovenaan: bewoners kunnen nu nog reageren. Een termijn die nog moet beginnen, of een openbaar onderzoek
    // zonder afgelezen einddatum, staat eerst bij de andere aanvragen, met de melding in de dichte kaart.
    const { inspraak, overige: permits } = splitsOpOnderzoek(entries.filter((e) => e.group === "vergunningen"));
    const html = [];
    html.push(sectionTemplate("openbaar-onderzoek", `<span aria-hidden="true">📢</span> Openbaar onderzoek: bezwaar indienen kan nu`, inspraak, { today, context: "permit" }));
    const kop = lopendKop(running, today);
    html.push(sectionTemplate("running", `<span aria-hidden="true">⏳</span> ${esc(kop.titel)}`, running, { today, context: "running" }, `<p class="pv-day-note">${esc(kop.noot)}</p>`));
    for (const [day, list] of days) html.push(sectionTemplate(`d:${day}`, dayTitle(day, today), list, { today }));
    // Toelatingen en evenementen van twee weken of langer: een eigen groep, onder wat vandaag en de komende
    // dagen echt gebeurt (groupForList in place-core.js).
    html.push(sectionTemplate("doorlopend", `<span aria-hidden="true">📆</span> Doorlopend: twee weken of langer`, doorlopend, { today, context: "running" }, `<p class="pv-day-note">${esc(doorlopendNoot(doorlopend))}</p>`));
    if (later.length) html.push(`<button type="button" class="pv-later" data-period-tip="alles"><strong>${later.length} item${later.length === 1 ? "" : "s"} later gepland</strong><span>vanaf ${esc(longDate(later[0].start))} · toon alles</span></button>`);
    html.push(marketsTemplate(bundels));
    html.push(sectionTemplate("permits", `<span aria-hidden="true">📄</span> Omgevingsaanvragen en besluiten`, permits, { today, context: "permit" }));
    const body = html.filter(Boolean).join("");
    results.innerHTML = body || emptyTemplate(today);
    // Wat de lijst toont, in dezelfde eenheid als de aantallen naast de koppen: een kaart per kaart (een
    // activiteit op twee dagen is twee kaarten), ook wat achter "Toon alle N" zit, en een kaart per markt;
    // niet wat "later gepland" is.
    return [inspraak, running, ...days.map(([, list]) => list), doorlopend, permits].reduce((n, lijst) => n + lijst.length, 0) + bundels.length;
  }
  // Tijdlijn over 14 dagen (vandaag inbegrepen): per dag een teken per soort, alleen op de dagen waarop er
  // echt iets gebeurt (opDag in place-core.js: losse dagen alleen op die dagen, een werfzone alleen in haar
  // fasen; een toelating van twee weken of langer alleen op haar eerste dag, verder bij "Doorlopend", zoals in
  // de lijst). Elke soort heeft een eigen vorm: de kleur is niet de enige drager. Tik op een dag en de lijst
  // eronder toont alleen die dag; nog eens tikken (of "Toon alle 14 dagen") toont alles weer.
  function renderTijdlijn(entries, today) {
    const einde = addDays(today, 13);
    const dagen = Array.from({ length: 14 }, (_, i) => addDays(today, i));
    if (state.dagFilter && !dagen.includes(state.dagFilter)) state.dagFilter = "";
    const dag = state.dagFilter;
    const binnen = entries.filter((e) => e.start && e.group !== "vergunningen" && overlaps(e, today, einde));
    // Per kaart de dagen van de 14 waarop er echt iets gebeurt; zonder zo'n dag staat ze niet in de strook.
    const echt = new Map(binnen.map((e) => [e, dagen.filter((d) => opDag(e, d))]));
    const dated = binnen.filter((e) => echt.get(e).length);
    const groepen = KIND_GROUPS.filter((g) => g.key !== "vergunningen");
    const perDag = new Map(dagen.map((d) => [d, groepen.map((g) => [g, dated.filter((e) => e.group === g.key && opDag(e, d))]).filter(([, lijst]) => lijst.length)]));
    // Wat die dag doorloopt zonder eigen teken (een toelating van twee weken of langer): dat zegt de naam erbij.
    const lang = binnen.filter((e) => langEvenement(e));
    const doorDag = (d) => lang.filter((e) => overlaps(e, d, d) && !opDag(e, d)).length;
    // Een dag zonder iets: nooit "niets gepland" zolang een laag laadt, als ze niet laadde of als er iets
    // doorloopt (legeDagLabel).
    const bezig = state.weekBezig || [];
    const onvolledig = Boolean(state.werkenOnvolledig);
    const vorm = (g) => `<i class="cat-${g.cat} vorm-${g.key}" aria-hidden="true"></i>`;
    const strip = dagen.map((d) => {
      const perGroep = perDag.get(d), door = doorDag(d);
      const tekst = perGroep.length ? `${dagInhoud(perGroep, d)}${door ? `; ${doorlopendTekst(door)}` : ""}` : legeDagLabel({ bezig, onvolledig, doorlopend: door });
      const cls = [d === today ? "today" : "", d === dag ? "sel" : "", weekdayMon0(d) >= 5 ? "weekend" : ""].filter(Boolean).join(" ");
      // "vand." op de knop staat ook in de naam ("Vandaag, zondag 11 oktober: ..."), voor schermlezers en spraakbesturing.
      return `<button type="button" class="pv-tl-dag ${cls}" data-tl-dag="${d}" aria-pressed="${d === dag}" aria-label="${d === today ? "Vandaag, " : ""}${esc(longDate(d))}: ${esc(tekst)}"><span class="pv-tl-wd">${d === today ? "vand." : WEEKDAYS_SHORT[weekdayMon0(d)]}</span><span class="pv-tl-n">${dayNum(d)}</span><span class="pv-tl-stippen" aria-hidden="true">${perGroep.map(([g]) => vorm(g)).join("")}</span></button>`;
    }).join("");
    const legend = groepen.filter((g) => state.groups.has(g.key)).map((g) => `<span class="pv-legend-item cat-${g.cat}">${vorm(g)}${esc(g.label)}</span>`).join("");
    const begin = (e) => echt.get(e)?.[0] || today;
    const sorteer = (a, b) => begin(a).localeCompare(begin(b)) || String(a.time || "99").localeCompare(String(b.time || "99")) || a.title.localeCompare(b.title, "nl");
    const lijst = (dag ? dated.filter((e) => opDag(e, dag)) : dated).sort(sorteer);
    // Twee weken of langer, zonder echte dag in de strook (of op de gekozen dag): bij "Doorlopend".
    const doorlopend = binnen.filter((e) => langEvenement(e) && (dag ? overlaps(e, dag, dag) && !opDag(e, dag) : !echt.get(e).length)).sort(sorteer);
    const titel = dag ? dayTitle(dag, today) : `<span aria-hidden="true">🗓️</span> Komende 14 dagen`;
    const doorlopendHtml = sectionTemplate(`tl-doorlopend:${dag || "alle"}`, `<span aria-hidden="true">📆</span> Doorlopend: twee weken of langer`, doorlopend, { today, context: "running" }, `<p class="pv-day-note">${esc(doorlopendNoot(doorlopend, { tijdlijn: true }))}</p>`);
    // Leeg: eerlijk over die dag of de 14 dagen, niet "niets voor deze straat" (legeTijdlijnTekst).
    let uitleg = legeTijdlijnTekst({ dag: Boolean(dag), bezig, onvolledig, aantalSoorten: state.groups.size, andereDagen: dagen.filter((d) => d !== dag && perDag.get(d).length).length, doorlopend: doorlopend.length });
    if (!dag && state.groups.has("vergunningen") && entries.some((e) => e.group === "vergunningen")) uitleg += " Vergunningen staan niet in de tijdlijn, wel in de lijst.";
    const inhoud = lijst.length ? `${sectionTemplate(`tl:${dag || "alle"}`, titel, lijst, { today, context: "tijdlijn" })}${doorlopendHtml}`
      : doorlopend.length ? `<p class="pv-day-empty">${dag ? `<strong>${esc(longDate(dag))}</strong>: ` : ""}${esc(uitleg)}</p>${doorlopendHtml}`
      : emptyTemplate(today, { wanneer: dag ? `op ${longDate(dag)}` : "in de komende 14 dagen", uitleg, later: !dated.length });
    results.innerHTML = `
      <div class="pv-tl">
        <div class="pv-tl-strip" role="group" aria-label="Tijdlijn: kies een dag">${strip}</div>
        <p class="pv-legend">${legend}<span class="pv-legend-hint">Elke soort heeft een eigen vorm. Tik op een dag om alleen die dag te zien.</span></p>
      </div>
      ${inhoud}
      ${dag ? `<button type="button" class="pv-btn pv-btn-ghost pv-tl-alle" data-tl-dag="">Toon alle 14 dagen</button>` : ""}`;
    // Zoals de aantallen naast de koppen: een kaart per kaart (een weekmarkt op twee dagen is twee kaarten).
    return lijst.length + doorlopend.length;
  }
  function renderMonth(entries, today) {
    const month = state.cursor, weeks = monthWeeks(month), nextMonth = addMonths(month, 1);
    const dated = entries.filter((e) => e.start && e.group !== "vergunningen");
    const narrow = window.matchMedia("(max-width: 640px)").matches;
    const maxLanes = narrow ? 4 : 3;
    // Dezelfde regels als de tijdlijn (opDag): losse dagen alleen op die dagen, een werfzone alleen in haar
    // fasen. Wat twee weken of langer loopt, staat in de maand als balk en telt dus elke dag mee.
    const opMaandDag = (e, d) => opDag(e, d) || (langEvenement(e) && overlaps(e, d, d));
    // Een lege dag: nooit "niets gepland" zolang een laag laadt of als ze niet laadde (legeDagLabel).
    const bezig = state.weekBezig || [], onvolledig = Boolean(state.werkenOnvolledig);
    if (!state.selectedDay || state.selectedDay < month || state.selectedDay >= nextMonth) state.selectedDay = today >= month && today < nextMonth ? today : month;
    const rows = weeks.map((weekStart) => {
      const { bars, lanes, overflow } = layoutWeekBars(dated, weekStart, maxLanes);
      const days = Array.from({ length: 7 }, (_, i) => {
        const d = addDays(weekStart, i);
        const n = dated.filter((e) => opMaandDag(e, d)).length;
        const cls = [d < month || d >= nextMonth ? "out" : "", d === today ? "today" : "", d === state.selectedDay ? "sel" : "", d < today ? "past" : ""].filter(Boolean).join(" ");
        return `<button type="button" class="pv-cal-day ${cls}" data-day="${d}" style="grid-column:${i + 1}" aria-pressed="${d === state.selectedDay}" aria-label="${esc(longDate(d))}: ${n ? `${n} item${n === 1 ? "" : "s"}` : esc(legeDagLabel({ bezig, onvolledig }))}"><span>${dayNum(d)}</span></button>`;
      }).join("");
      const barHtml = bars.map((b) => {
        const k = kindInfo(b.entry);
        const multi = b.span > 1 || b.clippedStart || b.clippedEnd || (b.entry.end && b.entry.end > b.entry.start);
        return `<span class="pv-bar cat-${esc(k.cat)}${multi ? " multi" : " single"}${b.clippedStart ? " cs" : ""}${b.clippedEnd ? " ce" : ""}" style="grid-column:${b.col + 1} / span ${b.span};grid-row:${b.lane + 2}" title="${esc(balkTitel(b.entry))}" aria-hidden="true">${esc(b.entry.time ? `${b.entry.time.replace(":", ".")} ${b.entry.title}` : b.entry.title)}</span>`;
      }).join("");
      const more = overflow.map((n, i) => (n ? `<span class="pv-cal-more" style="grid-column:${i + 1};grid-row:${maxLanes + 2}" aria-hidden="true">+${n}</span>` : "")).join("");
      return `<div class="pv-cal-week" style="--lanes:${Math.max(1, lanes) + (overflow.some(Boolean) ? 1 : 0)}">${days}${barHtml}${more}</div>`;
    }).join("");
    const day = state.selectedDay;
    const onDay = dated.filter((e) => opMaandDag(e, day)).sort((a, b) => (a.start === day ? 0 : 1) - (b.start === day ? 0 : 1) || String(a.time || "99").localeCompare(String(b.time || "99")) || a.title.localeCompare(b.title, "nl"));
    const legend = KIND_GROUPS.filter((g) => state.groups.has(g.key) && g.key !== "vergunningen").map((g) => `<span class="pv-legend-item cat-${g.cat}"><i aria-hidden="true"></i>${esc(g.label)}</span>`).join("");
    results.innerHTML = `
      <div class="pv-cal" aria-label="Maandkalender ${esc(MONTHS[monthOf(month)])}">
        <div class="pv-cal-head" aria-hidden="true">${WEEKDAYS_SHORT.map((d) => `<b>${d}</b>`).join("")}</div>
        ${rows}
      </div>
      <p class="pv-legend">${legend}<span class="pv-legend-hint">Balken = meerdaagse werken of activiteiten. Tik op een dag voor alles van die dag.</span></p>
      <div class="pv-cal-daypanel" aria-live="polite">${onDay.length ? sectionTemplate(`c:${day}`, dayTitle(day, today), onDay, { today, context: "day" }) : `<p class="pv-day-empty"><strong>${esc(longDate(day))}</strong>: ${esc(legeTijdlijnTekst({ dag: true, bezig, onvolledig, aantalSoorten: state.groups.size }))}</p>`}</div>`;
  }

  results.addEventListener("click", (event) => {
    const dag = event.target.closest("[data-tl-dag]");
    if (dag) {
      const d = dag.dataset.tlDag, vorige = state.dagFilter;
      state.dagFilter = d && d !== state.dagFilter ? d : "";
      render();
      // De focus blijft op de dag die je net aan- of uitzette (een schermlezer hoort "niet ingedrukt"). Na
      // "Toon alle 14 dagen" (onder de lijst) gaat ze naar de dag die gekozen was, en komt die in beeld.
      const doel = results.querySelector(`.pv-tl-dag[data-tl-dag="${d || vorige}"]`) || results.querySelector(".pv-tl-dag");
      if (d) doel?.focus({ preventScroll: true });
      else doel?.focus();
      return;
    }
    const opKaart = event.target.closest("[data-op-kaart]");
    if (opKaart) { window.dispatchEvent(new CustomEvent("public-agenda:kaart-toon", { detail: { uid: opKaart.dataset.opKaart } })); return; }
    const row = event.target.closest(".pv-row-btn");
    if (row) {
      const li = row.closest(".pv-row"), uid = li.dataset.uid, detail = li.querySelector(".pv-detail");
      const open = !state.open.has(uid);
      if (open) state.open.add(uid); else state.open.delete(uid);
      li.classList.toggle("open", open); row.setAttribute("aria-expanded", String(open)); detail.hidden = !open;
      const leeg = open ? detail.querySelector("figure[data-schets]") : null;
      if (leeg && kaartPerUid.has(uid)) leeg.outerHTML = schetsFiguur(kaartPerUid.get(uid));
      // De kaart markeert wat open staat (neighborhood-map.js).
      window.dispatchEvent(new CustomEvent("public-agenda:rij-open", { detail: { uid, open } }));
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
    if (radiusTip) { state.radius = Number(radiusTip.dataset.radiusTip); view.setArea({ radius: state.radius }); announce(); snelVoorStraat(state.place, { alleenLive: true }); return; }
    const p = event.target.closest("[data-place]");
    if (p) { applyPlace(index.byKey.get(p.dataset.place), { focusResults: true }); return; }
    if (event.target.closest("[data-all-tip]")) { state.groups = new Set(KIND_GROUPS.map((g) => g.key)); state.customized = true; view.wantsLiveLayers = true; view.setThemes(themesForGroups([...state.groups])); announce(); }
  });

  // Kaart of deeplink: een kaartje openklappen in de lijst, met periode "alles", in het midden van het scherm en
  // met de focus op de knop van de rij. Elke soort (agenda, werken, publieke ruimte, vergunningen): op uid.
  function openUid(uid) {
    if (!uid) return;
    state.open.add(uid);
    if (state.mode !== "lijst") state.mode = "lijst";
    state.period = "alles";
    render();
    const li = results.querySelector(`.pv-row[data-uid="${CSS.escape(uid)}"]`);
    if (li) { li.scrollIntoView({ block: "center" }); li.querySelector(".pv-row-btn")?.focus({ preventScroll: true }); }
  }
  window.PUBLIC_AGENDA_OPEN = (id) => openUid(`agenda:${id}`);
  window.addEventListener("public-agenda:open", (event) => openUid(event.detail?.uid));

  // "De komende 7 dagen in jouw straat": zolang werken, verkeersmaatregelen of evenementen op straat nog
  // laden, zeggen we dat eerlijk.
  const WEEK_LAGEN = ["werken", "verkeersmaatregelen", "evenementen op straat"];
  function weekVoorPlek(entries, today, { bezig = [], onbekend = [] } = {}) {
    const place = state.place;
    const waar = place.type === "straat" ? (state.radius ? "in en rond jouw straat" : "in jouw straat") : plekWaar(place);
    if (bezig.length) return { licht: "onbekend", zin: `De komende 7 dagen ${waar}: ${bezig.length > 1 ? `${bezig.slice(0, -1).join(", ")} en ${bezig.at(-1)}` : bezig[0]} worden nog geladen…` };
    return dezeWeek(entries, today, { waar, onvolledig: Boolean(state.werkenOnvolledig), onbekend });
  }

  function render() {
    const today = brusselsToday();
    if (!state.cursor || state.cursor !== startOfMonth(state.cursor)) state.cursor = startOfMonth(state.cursor || today);
    const { entries, loading, failed, opPlek, weekOnbekend } = collect();
    const summary = summarize(entries, today);
    const weekBezig = loading.filter((laag) => WEEK_LAGEN.includes(laag));
    state.layersPending = weekBezig.length > 0;
    state.weekBezig = weekBezig;
    state.werkenOnvolledig = failed.some((o) => o !== "terrassen");
    state.onvolledig = onvolledigMelding(failed);
    const opsomming = loading.length > 1 ? `${loading.slice(0, -1).join(", ")} en ${loading.at(-1)}` : loading.join("");
    state.week = state.place ? weekVoorPlek(opPlek, today, { bezig: weekBezig, onbekend: weekOnbekend }) : null;
    // De lagen heten allemaal in het meervoud ("werken", "terrassen"): altijd "worden".
    renderPlace(summary, loading.length ? `${opsomming} worden live opgehaald…` : "", state.onvolledig, state.week);
    renderToolbar();
    const place = state.place;
    titleEl.textContent = place ? "Alles op deze plek" : state.groups.size === 1 && state.groups.has("evenementen") ? "Uitgaan & evenementen in district Antwerpen" : "Alles in district Antwerpen";
    // Hoeveel items: wat de lijst bij periode "alles" toont (lijstUniversum), per soort van de kaart geteld
    // (telPerSoort). De legenda van de kaart telt hetzelfde, dus de som van de legenda is dit getal.
    const markten = marktBundels(entries, today);
    const lijst = lijstUniversum(entries, today, { markten });
    const tel = telPerSoort(lijst);
    meldKaartItems(lijst, entries, tel);
    const n = tel.totaal;
    subEl.textContent = place
      ? `${n} item${n === 1 ? "" : "s"} uit officiële bronnen${place.type === "straat" && state.radius ? `, ook ${state.radius >= 1000 ? "1 km" : `${state.radius} m`} rond de straat (terrassen alleen in de straat zelf)` : ""}.`
      : "Zoek hierboven je straat of wijk om ook werken, verkeer en inspraak in je buurt te zien.";
    loadingEl.innerHTML = place ? "" : [
      loading.length ? `<span class="pv-spinner" aria-hidden="true"></span> ${esc(opsomming)} laden…` : "",
      state.onvolledig ? `<span class="pv-place-failed">${esc(state.onvolledig)}</span>` : "",
    ].filter(Boolean).join(" ");
    let getoond = null;
    if (state.mode === "maand") renderMonth(entries, today);
    else getoond = state.mode === "tijdlijn" ? renderTijdlijn(entries, today) : renderList(entries, today, markten);
    meldKaart(place ? getoond : null, entries);
  }
  // De buurtkaart zegt "X in de lijst, Y op de kaart" (neighborhood-map.js). X is wat de lijst hierboven
  // echt toont: met de periode, of de 14 dagen en de gekozen dag van de tijdlijn. De maand heeft geen lijst
  // en geeft geen aantal. Daarbij welke GIPOD-stukken samen één werf zijn, zodat de kaart haar punten per
  // kaart van de lijst telt. De laatste stand staat ook op window: een kaart die later laadt, leest ze daar.
  function meldKaart(aantal, entries) {
    const stand = { aantal, werfPerStuk: werfPerStuk(entries) };
    const sleutel = JSON.stringify(stand);
    if (sleutel === state.kaartMelding) return;
    state.kaartMelding = sleutel;
    window.PUBLIC_AGENDA_PLACE_LIST = stand;
    window.dispatchEvent(new CustomEvent("public-agenda:place-list", { detail: stand }));
  }
  // Wat de kaart tekent (neighborhood-map.js): het universum van de lijst, zonder de kaartjes van de wekelijkse
  // markten maar met hun marktdagen (die hebben een plek, en zo blijven de marktpins), en de telling per soort
  // voor de legenda. Ook op window: de kaart mount later en mist anders de eerste tekenbeurt.
  function meldKaartItems(lijst, entries, tel) {
    const weekmarkt = window.PublicAgendaUitgaan?.isWeeklyMarket;
    const teken = [...lijst.filter((e) => e.source !== "markt"), ...entries.filter((e) => e.theme === "markets" && e.start && weekmarkt?.(e.item))];
    window.PUBLIC_AGENDA_KAART = { teken, tel };
    window.dispatchEvent(new CustomEvent("public-agenda:kaart-items", { detail: window.PUBLIC_AGENDA_KAART }));
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
    if ("radius" in detail) { state.radius = Number(detail.radius) || 0; view.setArea({ radius: state.radius }); announce(); snelVoorStraat(state.place, { alleenLive: true }); }
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
