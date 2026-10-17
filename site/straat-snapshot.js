// Snelheid (P5): de plekpagina toont een straat meteen uit het bestand van de ochtendverversing
// (site/straat/<id>.json, gemaakt door scripts/build-straat-snapshots.mjs) en vraagt daarna live alleen het
// kader van die straat na. Dit bestand: de vorm van die bestanden lezen, het kader van een straat en de
// zin over wat er live bij kwam ("1 nieuw sinds 05:22"). Zonder DOM, ook voor de toetsen en de bouwer.
import { metInzage } from "./inzage-status.js";
import { vergunningBronUrl } from "./permits-live-core.js";
import { maatregelSleutel } from "./place-core.js";
import { veiligeFase } from "./witte-lijst.js";

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
// Een samenvatting van de fasen van een evenement (scripts/build-straat-snapshots.mjs) staat kort in het
// bestand: zonder straat, titel of detail.
const samenvatting = (item) => ({ kindLabel: "Inname openbaar domein", title: "", location: "", detail: item.phase ? `Fase ${item.phase}` : "", status: "", streets: [], ...item });
// Vangnet: de naam van de fase van een inname (faseNaam, vrij in te vullen) uit een bewaard bestand opnieuw door de filter
// (veiligeFase in site/witte-lijst.js), ook in `detail` ("Fase Opbouw · Dossiertype ETL"). De bouwer filtert al bij de
// ingang (normalizeIod) en bij het schrijven (itemVoorStraat in scripts/build-straat-snapshots.mjs); een ouder of fout
// bestand toont zo toch geen vrije tekst. Een straatnaam blijft alleen als het een straat van de inname zelf is (de straatas
// zelf is hier niet geladen).
export function veiligeInname(item) {
  if (item?.kind !== "iod" || typeof item.phase !== "string" || !item.phase) return item;
  const fase = veiligeFase(item.phase, { straten: Array.isArray(item.streets) ? item.streets : [] });
  if (fase === item.phase) return item;
  const delen = String(item.detail || "").split(" · ");
  const detail = (delen[0] === `Fase ${item.phase}` ? [fase ? `Fase ${fase}` : "", ...delen.slice(1)] : delen.filter((d) => !/^Fase /.test(d))).filter(Boolean).join(" · ");
  return { ...item, phase: fase, ...("detail" in item ? { detail } : {}) };
}
export function vulAan(item, laag) {
  if (laag === "publiekeRuimte") return { ...(item.faseSamenvatting ? samenvatting(item) : item), ...(VAST[item.kind] || {}) };
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
    return laag === "publiekeRuimte" ? veiligeInname(uit) : uit;
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
//
// De hash in de URL: verandert de inhoud, dan is het een nieuwe URL, en de browser en de CDN mogen elk
// bestand een jaar bewaren (render.yaml). Met een index van een paar minuten oud kan de browser toch de
// oude hash vragen en de nieuwe inhoud krijgen (of index.html, als het bestand intussen weg is), en die
// dan een jaar onder de oude URL bewaren. Daarom kijken we de hash na: klopt ze niet, dan nog één keer
// vers (een extra parameter voorbij de cache van de CDN, en "reload" voorbij die van de browser). Klopt het dan nog niet, dan
// alleen een stand die niet ouder is dan de index; anders geen stand (dan alles live, zoals vroeger).
const leesDoc = async (response) => {
  if (!response?.ok) return null;
  try { const doc = await response.json(); return doc?.schemaVersion === 1 ? doc : null; } catch { return null; }
};
export async function laadStraat(id, { fetch: fetchImpl = (...a) => globalThis.fetch(...a), nu = () => Date.now() } = {}) {
  const index = await laadStraatIndex({ fetch: fetchImpl });
  if (!index || !/^\d+$/.test(String(id || ""))) return null;
  if (Array.isArray(index.alleenLive) && index.alleenLive.includes(String(id))) return null;
  const hash = index.straten[String(id)];
  if (!hash) return { index, doc: null };
  const url = `/straat/${id}.json?v=${encodeURIComponent(hash)}`;
  const doc = await leesDoc(await fetchImpl(url, { headers: { Accept: "application/json" } }));
  if (doc?.inhoud === hash) return { index, doc };
  const vers = await leesDoc(await fetchImpl(`${url}&vers=${nu()}`, { cache: "reload", headers: { Accept: "application/json" } }).catch(() => null));
  if (vers?.inhoud === hash) return { index, doc: vers };
  const nieuwer = [vers, doc].find((d) => d && Date.parse(d.ververst || "") >= Date.parse(index.ververst || ""));
  return nieuwer ? { index, doc: nieuwer } : null;
}

// De items per live laag uit een geladen stand (een straat zonder bestand: overal een lege lijst). Met de
// nagekeken stand van het Inzageloket (site/sources/inzage-status.json) krijgen de vergunningen hun
// openbaar onderzoek erbij, net als in permits-live.js: anders verdwijnt "bezwaar indienen kan nu".
export function lagenUitStand(stand, { inzage = null, vandaag = "" } = {}) {
  const lagen = Object.fromEntries(STRAAT_LAGEN.map(([laag, live]) => [live, stand?.doc ? straatItems(stand.doc, laag) : []]));
  lagen.permits = metInzage(lagen.permits, inzage, vandaag);
  return lagen;
}

// Als de rijen van de dossiers in het kader live niet geladen konden worden (publiekeRuimteInKader in
// site/public-space-live.js): de live items van het kader, aangevuld met wat buiten dat kader ligt maar wel
// op de kaart van de straat hoort (scripts/build-straat-snapshots.mjs):
// - de samenvatting van de fasen van een evenementendossier (`faseSamenvatting`): opbouw en afbraak liggen
//   vaak elders, en zonder die rijen verdwijnt "opbouw vanaf … en afbraak tot …";
// - de andere rijen van een werfzone of parkeerverbod (`bundel`): de andere fasen en straten;
// - een werfzone of omleiding die het kader maar half raakt: live dan alleen "Omleiding", terwijl het een
//   werfzone met omleiding is. Dan de soorten, straten en periode van de ochtend erbij.
// Alleen voor een dossier dat live nog in het kader staat; een dossier dat live wegviel, blijft weg. Een
// bundelrij alleen als live nog een rij dezelfde maatregel is (zelfde dossier, dag, uren en reden): een
// parkeerverbod dat live naar een andere dag schoof, houdt anders de oude dag van de ochtend.
const refSleutel = (ref) => [ref?.id || "", ref?.name || "", ref?.postcode || ""].join("|");
const samenRefs = (a = [], b = []) => [...new Map([...a, ...b].filter((ref) => ref?.name).map((ref) => [refSleutel(ref), ref])).values()];
const vroegste = (a, b) => (!b || (a && Date.parse(a) <= Date.parse(b)) ? a : b);
const laatste = (a, b) => (!b || (a && Date.parse(a) >= Date.parse(b)) ? a : b);
function werfzoneSamen(live, ochtend) {
  const soorten = [...new Set([live.kindLabel, ochtend.kindLabel].flatMap((label) => String(label || "").split(/\s*\+\s*/)).filter(Boolean))].sort().join(" + ");
  return {
    ...live, kindLabel: soorten, title: soorten, start: vroegste(live.start, ochtend.start), end: laatste(live.end, ochtend.end),
    streets: samenRefs(live.streets, ochtend.streets), werfzoneStreets: samenRefs(live.werfzoneStreets, ochtend.werfzoneStreets), omleidingStreets: samenRefs(live.omleidingStreets, ochtend.omleidingStreets),
  };
}
// Een vergunning die ver buiten het kader van de straat reikt (een leidingwerf, de Oosterweelverbinding):
// live gebruikt de straatassen van het hele district (vergunningenInKader); laden die niet, dan kent live
// de straatas maar in het kader plus 320 m en noemt "Waar" minder straten. Dezelfde aanvraag (zelfde id)
// krijgt daarom de straten van de ochtend erbij. De ochtend eerst: die kende alle straatassen, en
// "Waar" noemt de eerste straat als de plek van de aanvraag (waarTekst in site/permit-clarity.js). Live
// eerst noemde de Oosterweelverbinding vanuit de Noordersingel "Noordersingel" in plaats van
// "Amerikadok-Zuidkaai". Een straat die alleen live bestaat, komt achteraan.
export function metStratenVanDeOchtend(live = [], ochtend = []) {
  const perId = new Map((ochtend || []).map((item) => [item?.id, item]));
  return live.map((item) => (perId.has(item?.id) ? { ...item, streets: samenRefs(perId.get(item.id).streets, item.streets) } : item));
}
export function aanvullenMetOchtend(live = [], ochtend = []) {
  const dossiers = new Set(live.map((item) => item?.reference).filter(Boolean));
  const ids = new Set(live.map((item) => item?.id));
  const perId = new Map((ochtend || []).map((item) => [item?.id, item]));
  const aangevuld = live.map((item) => (item?.kind === "sgw" && perId.get(item.id)?.kind === "sgw" ? werfzoneSamen(item, perId.get(item.id)) : item));
  const maatregelen = new Set(live.filter((item) => item?.kind === "parking" || item?.kind === "sgw").map(maatregelSleutel));
  const hoort = (item) => (item?.faseSamenvatting && dossiers.has(item.reference)) || (item?.bundel && maatregelen.has(maatregelSleutel(item)));
  return [...aangevuld, ...(ochtend || []).filter((item) => hoort(item) && !ids.has(item.id))];
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
// controle anders vond; `mislukt`: de live controle lukte niet (dan blijft de stand van de ochtend staan);
// `mislukteDelen`: de lagen die live niet lukten (de rest wel).
// Met een straal (`straal` > 0) toont de stand van de ochtend alleen de straat zelf: alleen live komt er
// bij wat rond de straat ligt. `straalStand`: "klaar", "laadt" (de straatassen voor de straal komen nog)
// of "mislukt" (de straatassen laadden niet: dan blijft het bij de straat zelf).
export function standZin({ ververst = "", nieuw = 0, weg = 0, bezig = false, mislukt = false, mislukteDelen = [], straal = 0, straalStand = "klaar", nu = new Date() } = {}) {
  const om = tijdstipTekst(ververst, nu);
  const sinds = om ? ` sinds ${om}` : "";
  const vanDeVerversing = om ? ` van de verversing van ${om}` : " van de verversing";
  if (bezig) return om ? `Stand van de verversing van ${om}. Live nakijken…` : "Live nakijken…";
  if (mislukt && straal > 0) return `Rond de straat kon nu niet live geladen worden. Je ziet alleen de straat zelf, met de stand${vanDeVerversing}.`;
  if (mislukt) return om ? `Live nakijken lukte nu niet. Je ziet de stand van de verversing van ${om}.` : "Live nakijken lukte nu niet.";
  const delen = [];
  if (nieuw) delen.push(`${nieuw} nieuw`);
  if (weg) delen.push(`${weg} niet meer in de bron`);
  const zinnen = [delen.length ? `Live nagekeken: ${delen.join(", ")}${sinds}.` : `Live nagekeken: niets nieuw${sinds}.`];
  if (mislukteDelen.length) zinnen.push(`Live nakijken lukte nu niet voor ${mislukteDelen.join(", ")}: daarvan zie je ${straal > 0 ? "alleen de straat zelf, met " : ""}de stand${vanDeVerversing}.`);
  if (straal > 0 && straalStand === "laadt") zinnen.push("De straal rond de straat laadt nog…");
  if (straal > 0 && straalStand === "mislukt") zinnen.push("De straal rond de straat kon nu niet geladen worden: je ziet alleen de straat zelf.");
  return zinnen.join(" ");
}
