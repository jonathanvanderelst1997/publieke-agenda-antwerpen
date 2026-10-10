// Snelheid (P5): de plekpagina toont een straat meteen uit het bestand van de ochtendverversing
// (site/straat/<id>.json, gemaakt door scripts/build-straat-snapshots.mjs) en vraagt daarna live alleen het
// kader van die straat na. Dit bestand: de vorm van die bestanden lezen, het kader van een straat en de
// zin over wat er live bij kwam ("1 nieuw sinds 05:22"). Zonder DOM, ook voor de toetsen en de bouwer.
import { vergunningBronUrl } from "./permits-live-core.js";

// De lagen in een straatbestand en hun naam als live laag (window.PUBLIC_AGENDA_LIVE_STREETS).
export const STRAAT_LAGEN = Object.freeze([
  ["werken", "works"],
  ["publiekeRuimte", "publicSpace"],
  ["vergunningen", "permits"],
  ["terrassen", "terraces"],
]);
export const STRAATVELDEN = Object.freeze(["streets", "werfzoneStreets", "omleidingStreets"]);

const ASIGN = "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer";
// Velden die voor elk item van een soort gelijk zijn (of uit het item volgen): de bouwer laat ze weg en
// vulAan() zet ze terug, zodat een item er hetzelfde uitziet als wanneer de browser het live maakt.
const VAST = Object.freeze({
  parking: { sourceLabel: "A-Sign parkeerverboden", sourceUrl: `${ASIGN}/20` },
  iod: { sourceLabel: "A-Sign IOD", sourceUrl: `${ASIGN}/22` },
  sgw: { sourceLabel: "A-Sign SGW", sourceUrl: `${ASIGN}/48` },
});
export const WEGGELATEN = Object.freeze({
  werken: Object.freeze([]),
  publiekeRuimte: Object.freeze(["sourceLabel", "sourceUrl", "streetResolution", "streetDistanceMeters"]),
  vergunningen: Object.freeze(["sourceLabel", "sourceUrl", "streetResolution", "streetDistanceMeters"]),
  terrassen: Object.freeze(["sourceUrl", "streetResolution", "streetDistanceMeters"]),
});
export function vulAan(item, laag) {
  if (laag === "publiekeRuimte") return { ...item, ...(VAST[item.kind] || {}) };
  if (laag === "vergunningen") return { ...item, sourceLabel: "Stad Antwerpen · omgevingsvergunningen in behandeling", sourceUrl: vergunningBronUrl(item.dossier, item.project) };
  if (laag === "terrassen") return { ...item, sourceUrl: `${ASIGN}/49` };
  return item;
}

// Een straatbestand terug naar items zoals de live lagen ze maken: streets als { id, name, postcode }
// (in het bestand een plaats in de lijst "straten") en de weggelaten vaste velden terug.
export function straatItems(doc, laag) {
  const tabel = Array.isArray(doc?.straten) ? doc.straten : [];
  const ref = (i) => (Array.isArray(tabel[i]) ? { id: String(tabel[i][0]), name: String(tabel[i][1]), postcode: String(tabel[i][2]) } : null);
  return (Array.isArray(doc?.[laag]) ? doc[laag] : []).map((item) => {
    const uit = vulAan({ ...item }, laag);
    for (const veld of STRAATVELDEN) if (Array.isArray(uit[veld])) uit[veld] = uit[veld].map(ref).filter(Boolean);
    if (laag === "terrassen" && !("address" in uit)) uit.address = "";
    return uit;
  });
}

// ---------- laden ----------

let indexBelofte = null;
// site/straat-index.json: elke keer nagevraagd (cache "no-cache": een 304 als het niet veranderde).
export function laadStraatIndex({ fetch: fetchImpl = (...a) => globalThis.fetch(...a) } = {}) {
  if (!indexBelofte) {
    indexBelofte = fetchImpl("/straat-index.json", { cache: "no-cache", headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((doc) => (doc && doc.schemaVersion === 1 && doc.straten && typeof doc.straten === "object" ? doc : null))
      .catch(() => null);
    // Ook "geen index" blijft onthouden tot de volgende keer dat de pagina laadt: geen tweede vraag.
  }
  return indexBelofte;
}

// De stand van één straat bij de ochtendverversing. `{ index, doc }`, met doc null als de straat toen
// niets had; null als er geen stand is (geen index, of de straat staat bij "alleenLive").
export async function laadStraat(id, { fetch: fetchImpl = (...a) => globalThis.fetch(...a) } = {}) {
  const index = await laadStraatIndex({ fetch: fetchImpl });
  if (!index || !/^\d+$/.test(String(id || ""))) return null;
  if (Array.isArray(index.alleenLive) && index.alleenLive.includes(String(id))) return null;
  const hash = index.straten[String(id)];
  if (!hash) return { index, doc: null };
  // De hash in de URL: verandert de inhoud, dan is het een nieuwe URL; anders mag de browser het bewaren.
  const response = await fetchImpl(`/straat/${id}.json?v=${encodeURIComponent(hash)}`, { headers: { Accept: "application/json" } });
  if (!response.ok) return null;
  const doc = await response.json();
  return doc?.schemaVersion === 1 ? { index, doc } : null;
}

// De items per live laag uit een geladen stand (een straat zonder bestand: overal een lege lijst).
export function lagenUitStand(stand) {
  return Object.fromEntries(STRAAT_LAGEN.map(([laag, live]) => [live, stand?.doc ? straatItems(stand.doc, laag) : []]));
}

// ---------- het kader van een straat ----------

// [minX, minY, maxX, maxY] (lengte, breedte) rond het kader van de straat, met `meter` extra aan elke
// kant: de straal die de bewoner koos plus een marge (een inname of parkeerverbod hangt aan een straat
// tot 18 m van de as, een vergunning tot 24 m).
export function kaderRond(box, meter = 0) {
  if (!Array.isArray(box) || box.length < 4 || !box.slice(0, 4).every(Number.isFinite)) return null;
  const [x1, y1, x2, y2] = box;
  const breedte = (Math.min(y1, y2) + Math.max(y1, y2)) / 2;
  const dy = meter / 110540;
  const dx = meter / (111320 * Math.cos((breedte * Math.PI) / 180));
  const r = (v) => Math.round(v * 1e6) / 1e6;
  return [r(Math.min(x1, x2) - dx), r(Math.min(y1, y2) - dy), r(Math.max(x1, x2) + dx), r(Math.max(y1, y2) + dy)];
}

// ---------- wat er live bij kwam ----------

// Hoeveel items live nieuw zijn en hoeveel uit de stand van de ochtend verdwenen. `sleutel`: wat als
// hetzelfde telt (standaard de id; place-view.js telt één kaart per evenementendossier en werfzone).
export function verschil(stand = [], live = [], sleutel = itemId) {
  const voor = new Set(stand.map((item) => sleutel(item)).filter(Boolean));
  const na = new Set(live.map((item) => sleutel(item)).filter(Boolean));
  let nieuw = 0, weg = 0;
  for (const id of na) if (!voor.has(id)) nieuw += 1;
  for (const id of voor) if (!na.has(id)) weg += 1;
  return { nieuw, weg };
}
const itemId = (item) => String(item?.id || (item?.gipodId != null ? `work:${item.gipodId}` : ""));

const UUR = typeof Intl !== "undefined" ? new Intl.DateTimeFormat("nl-BE", { timeZone: "Europe/Brussels", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : null;
const DAG = typeof Intl !== "undefined" ? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" }) : null;
const MAANDEN = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
// "05:22", of "9 okt 05:22" als de verversing niet van vandaag is.
export function tijdstipTekst(iso, nu = new Date()) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t) || !UUR || !DAG) return "";
  const uur = UUR.format(new Date(t)).replace(".", ":");
  const dag = DAG.format(new Date(t));
  if (dag === DAG.format(nu)) return uur;
  return `${Number(dag.slice(8, 10))} ${MAANDEN[Number(dag.slice(5, 7)) - 1]} ${uur}`;
}

// De zin onder de plek. `stand`: het tijdstip van de ochtendverversing; `nieuw`/`weg`: wat de live
// controle anders vond; `mislukt`: de live controle lukte niet (dan blijft de stand van de ochtend staan).
export function standZin({ ververst = "", nieuw = 0, weg = 0, bezig = false, mislukt = false, nu = new Date() } = {}) {
  const om = tijdstipTekst(ververst, nu);
  const sinds = om ? ` sinds ${om}` : "";
  if (bezig) return om ? `Stand van de verversing van ${om}. Live nakijken…` : "Live nakijken…";
  if (mislukt) return om ? `Live nakijken lukte nu niet. Je ziet de stand van de verversing van ${om}.` : "Live nakijken lukte nu niet.";
  const delen = [];
  if (nieuw) delen.push(`${nieuw} nieuw`);
  if (weg) delen.push(`${weg} niet meer in de bron`);
  if (!delen.length) return `Live nagekeken: niets nieuw${sinds}.`;
  return `Live nagekeken: ${delen.join(", ")}${sinds}.`;
}
