// Welke live lagen niet geladen konden worden, in woorden die een bewoner begrijpt.
// Elke live module zet per laag een lijst mislukte onderdelen in
// window.PUBLIC_AGENDA_LIVE_STREETS.failed (bv. failed.publicSpace = ["parkeerverboden"]); een lege
// lijst betekent: alles geladen. Het plekoverzicht maakt daar één zichtbare melding van.
export const ONDERDELEN = Object.freeze(["werken", "parkeerverboden", "innames en parcours", "omleidingen", "werfzones", "terrassen"]);

// De bronnen van de laag "publicSpace" en wat er wegvalt als één ervan niet laadt.
const PUBLIC_SPACE_BRONNEN = Object.freeze({
  parking: ["parkeerverboden"],
  iod22: ["innames en parcours"],
  iod23: ["innames en parcours"],
  sgw47: ["omleidingen"],
  sgw48: ["werfzones"],
  // Zonder districtsgrens worden innames, omleidingen en werfzones verborgen.
  district: ["innames en parcours", "omleidingen", "werfzones"],
  // Zonder stratenlijst hangt niets aan een straat.
  streets: ["parkeerverboden", "innames en parcours", "omleidingen", "werfzones"],
});
const orden = (lijst) => ONDERDELEN.filter((o) => lijst.includes(o));
export function mislukteOnderdelenPublicSpace(bronnen = []) {
  return orden(bronnen.flatMap((b) => PUBLIC_SPACE_BRONNEN[b] || []));
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

const lijstTekst = (delen) => (delen.length <= 1 ? delen.join("") : `${delen.slice(0, -1).join(", ")} en ${delen.at(-1)}`);
export function onvolledigMelding(onderdelen = []) {
  if (!onderdelen.length) return "";
  const tekst = lijstTekst(onderdelen);
  return `${tekst[0].toUpperCase()}${tekst.slice(1)} konden nu niet geladen worden. Dit overzicht is onvolledig.`;
}

// Een live laag melden aan de rest van de pagina: items (of null als de laag niet laadde) en de
// mislukte onderdelen. Zonder browser (toetsen) doet dit niets.
export function meldLiveLaag(naam, items, mislukt = []) {
  if (typeof window === "undefined") return;
  const live = (window.PUBLIC_AGENDA_LIVE_STREETS = window.PUBLIC_AGENDA_LIVE_STREETS || {});
  // De laag van het hele district: de plekpagina zet er dan geen stand van één straat meer over (place-view.js).
  if (Array.isArray(items)) { live[naam] = items; live.heelDistrict = { ...(live.heelDistrict || {}), [naam]: true }; }
  live.failed = { ...(live.failed || {}), [naam]: [...mislukt] };
  window.dispatchEvent(new CustomEvent("public-agenda:street-layer", { detail: { name: naam, items: Array.isArray(items) ? items : null, failed: [...mislukt] } }));
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
