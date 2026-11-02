// Welke live lagen niet geladen konden worden, per onderdeel dat een bewoner kent.
// Per laag staat in window.PUBLIC_AGENDA_LIVE_STREETS.failed een lijst mislukte onderdelen (bv. failed.publicSpace =
// ["parkeerverboden"]) van wat de pagina toont (kiesLaag hieronder); een lege lijst betekent: alles geladen. Dat blijft
// intern: het plekoverzicht zegt daarmee nooit "rustig" of een valse 0, maar toont geen melding dat iets faalt
// (besluit van de eigenaar van 18-10-2026: "niemand moet weten als er iets faalt, de momentopname blijft wel goed").
export const ONDERDELEN = Object.freeze(["werken", "parkeerverboden", "innames en parcours", "omleidingen", "werfzones", "terrassen", "vergunningen"]);

// Per live laag: haar bronnen en wat er wegvalt als één ervan niet laadt. Elke lijst van het district en elk kader van
// een straat vraagt hier wat ze mist (mislukteOnderdelen), in plaats van zelf "alles geladen" te beslissen: een laag
// die maar deels laadde, gaat zo nooit door als volledig, en vervangt de momentopname van een straat niet (kiesLaag).
const LAAG_BRONNEN = Object.freeze({
  publicSpace: Object.freeze({
    parking: ["parkeerverboden"],
    iod22: ["innames en parcours"],
    iod23: ["innames en parcours"],
    sgw47: ["omleidingen"],
    sgw48: ["werfzones"],
    // Zonder districtsgrens worden innames, omleidingen en werfzones verborgen.
    district: ["innames en parcours", "omleidingen", "werfzones"],
    // Zonder stratenlijst hangt niets aan een straat.
    streets: ["parkeerverboden", "innames en parcours", "omleidingen", "werfzones"],
  }),
  // De werken (GIPOD, site/works-live.js). Zonder districtsgrens blijven alleen de werken van de exacte snapshot over,
  // zonder straatassen hangt geen werk aan een straat, zonder de gevalideerde hinder ontbreekt de (ernstige) hinder.
  works: Object.freeze({ inname: ["werken"], hinder: ["werken"], district: ["werken"], streets: ["werken"] }),
});
// In de volgorde van ONDERDELEN; een onderdeel dat daar niet in staat, valt nooit weg (het komt achteraan): een
// mislukking met een andere naam mag een laag niet volledig laten lijken (nooit een valse "rustig").
const orden = (lijst) => [...ONDERDELEN.filter((o) => lijst.includes(o)), ...new Set(lijst.filter((o) => !ONDERDELEN.includes(o)))];
// De onderdelen van `laag` ("works" of "publicSpace") die wegvallen als deze `bronnen` niet laadden. Een bron die de laag
// niet kent, telt als alles van die laag (dicht falen).
export function mislukteOnderdelen(laag, bronnen = []) {
  const perBron = LAAG_BRONNEN[laag];
  if (!perBron) throw new Error(`onbekende live laag: ${laag}`);
  const alles = [...new Set(Object.values(perBron).flat())];
  return orden(bronnen.flatMap((b) => perBron[b] || alles));
}
export function mislukteOnderdelenPublicSpace(bronnen = []) {
  return mislukteOnderdelen("publicSpace", bronnen);
}
// Alle onderdelen van een laag van de plekpagina: wat er ontbreekt als de laag niet, of maar voor een kleiner gebied,
// nagekeken is. Werken en publieke ruimte volgen hun bronnen (LAAG_BRONNEN); vergunningen en terrassen zijn elk één
// onderdeel. Een onbekende laag heet zoals ze heet (en valt dus nooit weg).
const EEN_ONDERDEEL = Object.freeze({ permits: "vergunningen", terraces: "terrassen" });
export function alleOnderdelen(laag) {
  if (LAAG_BRONNEN[laag]) return orden(Object.values(LAAG_BRONNEN[laag]).flat());
  return [EEN_ONDERDEEL[laag] || String(laag)];
}

// Het gebied dat een laag dekt (`dekking`) en het gebied dat de bezoeker koos (`gebied`, live.gebied), elk als
// { plek, straal }: de sleutel van de plek (place.key in site/place-view.js) en het aantal meter rond een straat. Een
// lijst van het hele district heeft geen dekking: die dekt elk gebied. Een laag van de plekpagina (de momentopname van
// een straat, wijk of postcode, of het live kader van een straat met een straal) dekt alleen haar eigen plek, met
// hoogstens haar straal; zonder gekozen gebied (de voorpagina) dekt ze niets.
// Nakijkronde 5 (18-10-2026): of een laag volledig is, hing alleen af van wat er mislukte, niet van het gebied. De
// momentopname van één straat gold zo als volledig voor "in en rond jouw straat" ("Rustig", tegels op 0), zoals in
// nakijkronde 4 de laag van een vorige straat voor een nieuwe plek.
export function dektGebied(dekking, gebied) {
  if (!dekking) return true;
  if (!gebied) return false;
  return String(dekking.plek) === String(gebied.plek) && (Number(dekking.straal) || 0) >= (Number(gebied.straal) || 0);
}

// Welke onderdelen ontbreken voor de soorten die aanstaan. `enabled(laag)` zoals PUBLIC_AGENDA_VIEW.
export function ontbrekendeOnderdelen(failed = {}, enabled = () => true) {
  const uit = [];
  for (const [laag, onderdelen] of Object.entries(failed || {})) {
    if (!Array.isArray(onderdelen) || !onderdelen.length || !enabled(laag)) continue;
    uit.push(...onderdelen);
  }
  return orden(uit);
}

// Wat een live laag meldde (het detail van "public-agenda:street-layer", of { items, failed } uit
// window.PUBLIC_AGENDA_LIVE_STREETS): "mislukt" als een onderdeel niet laadde (ook als een deel wel laadde: de publieke
// ruimte meldt dan haar items en de mislukte onderdelen), "ok" met alleen items, "" als ze nog niet binnen is.
export const laagStand = (detail) => (detail?.failed?.length ? "mislukt" : Array.isArray(detail?.items) ? "ok" : "");

// Twee bronnen per laag (live.bronnen): "district", de lijst van het hele district (works-live.js, public-space-live.js,
// permits-live.js, terraces-live.js), en "straat", de momentopname van één straat (site/straat/<id>.json) of het gelukte
// live kader van die straat (place-view.js). Wat de pagina toont (live[naam] en live.failed[naam]), kiest kiesLaag:
// 1. een gelukte lijst van het hele district (niets mislukt): die is vollediger dan één straat (live.heelDistrict);
// 2. anders de straatlaag met items: een live laag die (deels) faalt, vervangt of leegt de momentopname nooit (besluit
//    van de eigenaar van 18-10-2026: "de momentopname blijft wel goed"; nakijkronde 3: klapte de bezoeker "Alle
//    lijsten" open terwijl A-Sign of GIPOD niet antwoordde, dan verdwenen de parkeerverboden en de werken van de straat);
// 3. anders wat er wel is: de lijst van het district (deels, of null met de mislukte onderdelen), of een straat zonder
//    momentopname waarvan het live kader faalde (null met de mislukte onderdelen).
// Dekt de straatlaag het gekozen `gebied` niet (dektGebied: een straal rond de straat, een andere plek), dan houdt ze
// haar items maar mist ze alle onderdelen van de laag `naam`: nooit "rustig", nooit een valse 0 (`gedekt: false`).
// Geeft { items, mislukt, heelDistrict, gedekt }, of null als geen bron de laag meldde.
export function kiesLaag({ district = null, straat = null, gebied = null, naam = "" } = {}) {
  const uit = (b, { heelDistrict = false, gedekt = true } = {}) => ({
    items: Array.isArray(b.items) ? b.items : null,
    mislukt: gedekt ? [...(b.mislukt || [])] : orden([...(b.mislukt || []), ...alleOnderdelen(naam)]),
    heelDistrict, gedekt,
  });
  if (district && Array.isArray(district.items) && !district.mislukt?.length) return uit(district, { heelDistrict: true });
  const gedekt = !straat || dektGebied(straat.dekking, gebied);
  if (straat && Array.isArray(straat.items)) return uit(straat, { gedekt });
  if (district) return uit(district);
  return straat ? uit(straat, { gedekt }) : null;
}

// Opnieuw kiezen wat de pagina van laag `naam` toont (kiesLaag), met het gekozen gebied (live.gebied). Ook
// live.ongedekt: de lagen waarvan de gekozen bron dat gebied niet dekt (place-view.js: die laden nog zolang de plekpagina
// het kader of de momentopname van het gebied ophaalt). Geeft het detail van "public-agenda:street-layer".
function kiesOpnieuw(live, naam) {
  const bronnen = live.bronnen || {};
  const keuze = kiesLaag({ district: bronnen.district?.[naam], straat: bronnen.straat?.[naam], gebied: live.gebied || null, naam });
  const items = keuze ? keuze.items : null;
  if (items) live[naam] = items; else delete live[naam];
  live.failed = { ...(live.failed || {}), [naam]: keuze ? keuze.mislukt : [] };
  const heel = { ...(live.heelDistrict || {}) };
  if (keuze?.heelDistrict) heel[naam] = true; else delete heel[naam];
  live.heelDistrict = heel;
  const ongedekt = { ...(live.ongedekt || {}) };
  if (keuze && !keuze.gedekt) ongedekt[naam] = true; else delete ongedekt[naam];
  live.ongedekt = ongedekt;
  return { name: naam, items, failed: [...live.failed[naam]] };
}
// Eén bron van een laag zetten ({ items, mislukt, dekking }) of weghalen (null) in `live` (window.PUBLIC_AGENDA_LIVE_STREETS),
// en opnieuw kiezen wat de pagina toont (kiesLaag). Geeft het detail van "public-agenda:street-layer".
export function zetLaagBron(live, naam, bron, waarde) {
  const bronnen = (live.bronnen = { ...(live.bronnen || {}) });
  const perLaag = (bronnen[bron] = { ...(bronnen[bron] || {}) });
  if (waarde) {
    perLaag[naam] = { items: Array.isArray(waarde.items) ? waarde.items : null, mislukt: [...(waarde.mislukt || [])] };
    if (waarde.dekking) perLaag[naam].dekking = { plek: String(waarde.dekking.plek ?? ""), straal: Number(waarde.dekking.straal) || 0 };
  } else delete perLaag[naam];
  return kiesOpnieuw(live, naam);
}
// Het gebied dat de bezoeker koos ({ plek, straal }, of null zonder plek) zetten, en elke laag opnieuw kiezen. Geeft
// het detail van "public-agenda:street-layer" per laag.
export function zetGebied(live, gebied) {
  live.gebied = gebied ? { plek: String(gebied.plek ?? ""), straal: Number(gebied.straal) || 0 } : null;
  const namen = new Set(Object.values(live.bronnen || {}).flatMap((perLaag) => Object.keys(perLaag || {})));
  return [...namen].map((naam) => kiesOpnieuw(live, naam));
}

const meld = (naam, bron, waarde) => {
  if (typeof window === "undefined") return;
  const live = (window.PUBLIC_AGENDA_LIVE_STREETS = window.PUBLIC_AGENDA_LIVE_STREETS || {});
  window.dispatchEvent(new CustomEvent("public-agenda:street-layer", { detail: { ...zetLaagBron(live, naam, bron, waarde), bron } }));
};
// Een live laag melden aan de rest van de pagina: items (of null als de laag niet laadde) en de mislukte onderdelen.
// `bron`: "district" (de lijsten van het hele district) of "straat" (place-view.js); `dekking`: het gebied dat een laag van
// de plekpagina nakeek (dektGebied). Zonder browser (toetsen) doet dit niets.
export function meldLiveLaag(naam, items, mislukt = [], { bron = "district", dekking = null } = {}) {
  meld(naam, bron, { items, mislukt, dekking });
}
// Het gebied dat de bezoeker koos melden (place-view.js, bij elke andere plek of straal): elke laag kiest opnieuw, en de
// rest van de pagina hoort het als die laag. Hetzelfde gebied nog eens: niets.
export function meldGebied(gebied) {
  if (typeof window === "undefined") return;
  const live = (window.PUBLIC_AGENDA_LIVE_STREETS = window.PUBLIC_AGENDA_LIVE_STREETS || {});
  const vorig = live.gebied || null;
  if ("gebied" in live && (vorig?.plek ?? null) === (gebied ? String(gebied.plek ?? "") : null) && (Number(vorig?.straal) || 0) === (Number(gebied?.straal) || 0)) return;
  for (const detail of zetGebied(live, gebied)) window.dispatchEvent(new CustomEvent("public-agenda:street-layer", { detail: { ...detail, bron: "gebied" } }));
}
// De laag van één bron weghalen (de bezoeker verlaat de straat): dan telt weer wat de andere bron meldde.
export function wisLiveLaag(naam, bron = "straat") {
  meld(naam, bron, null);
}

// Een volledige lijst (werken, publieke ruimte, vergunningen, terrassen van het hele district) laadt pas als
// ze echt in beeld komt. De plekpagina zet de lijsten in een dichte <details> ("Alle lijsten"); vóór ze
// dat doet, staan ze nog los op de pagina en zag de observer ze soms al "in beeld" (op een groot scherm
// laadde de voorpagina zo alle GIPOD-pagina's voor niets). Daarom: kijken vanaf de eerste
// view-change van de plekpagina (of na 2,5 s als die niet komt), en nooit in een dichte <details>.
export function laadAlsInBeeld(root, laad, { marge = "600px", wacht = 2500 } = {}) {
  if (typeof window === "undefined" || !root) return;
  if (!("IntersectionObserver" in window)) { laad(); return; }
  let gestart = false;
  const start = () => {
    if (gestart) return;
    gestart = true;
    window.removeEventListener("public-agenda:view-change", start);
    const o = new IntersectionObserver((es) => {
      if (!es.some((e) => e.isIntersecting) || root.closest("details:not([open])")) return;
      o.disconnect();
      laad();
    }, { rootMargin: marge });
    o.observe(root);
  };
  window.addEventListener("public-agenda:view-change", start);
  setTimeout(start, wacht);
}
