// Eén gedeelde A-Sign-ophaler voor de browser (parkeerverboden, innames, omleidingen, werfzones,
// terrassen en werfsignalisatie). De stadsserver weigert lange URL's: boven ongeveer 2.000 tekens
// antwoordt hij met een 404 zonder CORS-kop, en de browser ziet dan alleen een mislukt verzoek.
// Daarom: blokken van hoogstens 100 ids, elke URL korter dan 1.800 tekens (een te lang blok wordt
// verder gesplitst), en hoogstens 4 verzoeken tegelijk naar A-Sign, voor alle lagen samen.
export const ASIGN_BASE = "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer";
export const ASIGN_BBOX = "4.300791,51.175458,4.444331,51.313629";
export const ASIGN_BLOK = 100;
export const ASIGN_MAX_URL = 1800;
export const ASIGN_GELIJKTIJDIG = 4;
export const ASIGN_MAX_IDS = 15000;

const queryUrl = (layer) => new URL(`${ASIGN_BASE}/${layer}/query`);

export function asignIdsUrl(layer, { where = "1=1", spatial = false } = {}) {
  const url = queryUrl(layer);
  const params = { where, f: "json" };
  if (spatial) Object.assign(params, { geometry: ASIGN_BBOX, geometryType: "esriGeometryEnvelope", inSR: "4326", spatialRel: "esriSpatialRelIntersects" });
  url.search = new URLSearchParams({ ...params, returnIdsOnly: "true" });
  return url.href;
}

// De detail-URL's voor een lijst ids: blokken van hoogstens `blok` ids, en elk blok dat toch een te
// lange URL geeft, wordt in tweeën gedeeld tot het past.
export function asignDetailUrls(layer, ids = [], { outFields = "*", geometry = false, blok = ASIGN_BLOK, maxUrl = ASIGN_MAX_URL } = {}) {
  const urls = [];
  const maak = (deel) => {
    const url = queryUrl(layer);
    url.search = new URLSearchParams({ f: "json", objectIds: deel.join(","), outFields, returnGeometry: String(geometry), outSR: "4326" });
    return url.href;
  };
  const voegToe = (deel) => {
    const href = maak(deel);
    if (href.length < maxUrl) { urls.push(href); return; }
    if (deel.length <= 1) throw new Error(`laag ${layer}: de vraag blijft te lang voor de stadsserver`);
    const helft = Math.ceil(deel.length / 2);
    voegToe(deel.slice(0, helft));
    voegToe(deel.slice(helft));
  };
  for (let i = 0; i < ids.length; i += blok) voegToe(ids.slice(i, i + blok));
  return urls;
}

// Een wachtrij die hoogstens `max` taken tegelijk laat lopen, in volgorde van aanmelden.
export function maakBegrenzer(max = ASIGN_GELIJKTIJDIG) {
  let bezig = 0;
  const wacht = [];
  const volgende = () => {
    while (bezig < max && wacht.length) {
      const { taak, ok, fout } = wacht.shift();
      bezig += 1;
      Promise.resolve().then(taak).then(ok, fout).finally(() => { bezig -= 1; volgende(); });
    }
  };
  return (taak) => new Promise((ok, fout) => { wacht.push({ taak, ok, fout }); volgende(); });
}
// Gedeeld door alle modules op de pagina: een ES-module bestaat maar één keer per pagina.
export const asignBegrenzer = maakBegrenzer(ASIGN_GELIJKTIJDIG);

const standaardFetch = (...args) => globalThis.fetch(...args);
async function haalEenKeer(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`bron antwoordde met HTTP ${response.status}`);
  const json = await response.json();
  if (json?.error) throw new Error(json.error.message || "ArcGIS-bronfout");
  return json;
}
// Eén tijdelijke hapering (netwerk, een 5xx) mag geen hele laag doen vallen: elk verzoek krijgt
// één nieuwe poging. Faalt ook die, dan faalt de laag en meldt de pagina dat eerlijk.
export const ASIGN_POGINGEN = 2;
async function haal(url, fetchImpl) {
  let fout = null;
  for (let poging = 0; poging < ASIGN_POGINGEN; poging += 1) {
    try { return await haalEenKeer(url, fetchImpl); } catch (error) { fout = error; }
  }
  throw fout;
}

// Alle records van één laag: eerst de ids, dan de details in korte blokken. Faalt één blok, dan
// faalt de laag (een halve laag zou stil items verbergen) en worden de wachtende blokken overgeslagen.
export async function asignLayer(layer, { where = "1=1", outFields = "*", geometry = false, spatial = false, maxIds = ASIGN_MAX_IDS } = {}, { fetch: fetchImpl = standaardFetch, begrenzer = asignBegrenzer } = {}) {
  const idData = await begrenzer(() => haal(asignIdsUrl(layer, { where, spatial }), fetchImpl));
  const ids = Array.isArray(idData.objectIds) ? idData.objectIds : [];
  if (ids.length > maxIds) throw new Error(`laag ${layer} overschrijdt de veiligheidslimiet`);
  let mislukt = null;
  const blokken = asignDetailUrls(layer, ids, { outFields, geometry }).map((url) => begrenzer(async () => {
    if (mislukt) throw mislukt;
    try {
      const data = await haal(url, fetchImpl);
      if (!Array.isArray(data.features)) throw new Error(`laag ${layer} gaf geen features terug`);
      return data.features;
    } catch (error) {
      mislukt = mislukt || error;
      throw error;
    }
  }));
  return (await Promise.all(blokken)).flat();
}
