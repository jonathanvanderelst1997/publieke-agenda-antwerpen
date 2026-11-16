// Een ontbrekend huisnummer vanzelf aanvullen uit de open data van de stad (wens van de eigenaar, bouwrij rij 46,
// 16-11-2026: "ontbrekende huisnummers vanzelf aanvullen uit officiële bronnen"; issue #262).
//
// Wat het doet, bij elke verversing (scripts/vul-huisnummers.mjs, `npm run refresh:huisnummers`):
// 1. Het neemt de komende activiteiten die in een gebouw zonder huisnummer staan, ook na de vaste lijst
//    (site/sources/vaste-adressen.json, lib/vaste-adressen.mjs), en de naam van die plek ("Sporthal Proef" uit
//    "Sporthal Proef, District Merksem (plaats volgens het bericht)").
// 2. Het zoekt die naam letterlijk (hoofdletters en accenten maken niet uit) in de lagen van de open data van stad
//    Antwerpen op geodata.antwerpen.be (sporthallen, cultuur-, erfgoed- en jeugdlocaties, concertzalen, bibliotheken en
//    de zaalzoeker; Gratis Open Data Licentie van stad Antwerpen). Geeft de bron voor die naam precies één adres, met een
//    officiële straat (site/geo/straten-stad.json), een huisnummer en een postcode van de stad, en spreekt dat de
//    postcode of het district van de activiteit niet tegen, dan komt het adres in site/sources/huisnummers-auto.json.
//    build:sources zet het daarna achter de plek, zoals een adres uit de vaste lijst.
// 3. Bij twijfel niets: twee adressen voor dezelfde naam, geen huisnummer in de bron, een straat die de stad niet kent,
//    een andere postcode dan de activiteit, of een laag die niet volledig gelezen werd. Dan blijft de melding staan, met
//    wat er ontbreekt (`nagekeken`, scripts/sources-health.mjs).
//
// Lezen: alleen van geodata.antwerpen.be, met de gewone naam van de agenda (USER_AGENT), één verzoek per laag met een
// pauze ertussen, en pas nadat robots.txt van die site het toelaat. Sites die automatisch lezen weigeren (sinds 23-10-2026
// www.antwerpen.be; api.basisregisters.vlaanderen.be) worden nooit gevraagd: magLezen zegt nee vóór er een verzoek
// vertrekt. Een weigering (403 "Access Denied") stopt het lezen meteen; er wordt niets omzeild.
import { CITY_POSTCODES, DISTRICT_POSTCODES, postcodesInText } from "./postcodes.mjs";
import { FetchError, USER_AGENT, fetchWithTimeout } from "./fetch-util.mjs";
import { heeftHuisnummer, ontbrekendeHuisnummers, plat, validateVasteAdressen } from "./vaste-adressen.mjs";

export const HUISNUMMERS_AUTO_FILE = "huisnummers-auto.json";
export const OPEN_DATA_HOST = "geodata.antwerpen.be";
const DIENSTEN = `https://${OPEN_DATA_HOST}/arcgissql/rest/services`;
// Sites die automatisch lezen weigeren of verbieden. Ook als een laag ooit naar zo'n site zou wijzen, vertrekt er geen
// verzoek (magLezen).
export const GEWEIGERDE_HOSTS = Object.freeze(["www.antwerpen.be", "api.basisregisters.vlaanderen.be", "visit.antwerpen.be", "www.districtantwerpen.be"]);

// De lagen met een naam en een adres. `namen`: de velden met de naam van de plek; `straat`, `nummer`, `postcode`: het adres.
export const ADRES_LAGEN = Object.freeze([
  { id: "sporthal", url: `${DIENSTEN}/P_Portal/portal_publiek6/MapServer/643`, namen: ["naam"], straat: "straat", nummer: "huisnummer", postcode: "postcode" },
  { id: "cultuurlocaties", url: `${DIENSTEN}/P_Portal/portal_publiek4/MapServer/292`, namen: ["naam"], straat: "straat", nummer: "huisnr", postcode: "postcode" },
  { id: "erfgoedlocaties", url: `${DIENSTEN}/P_Portal/portal_publiek4/MapServer/293`, namen: ["naam"], straat: "straat", nummer: "huisnr", postcode: "postcode" },
  { id: "jeugdlocaties", url: `${DIENSTEN}/P_Portal/portal_publiek4/MapServer/294`, namen: ["Naam", "Roepnaam"], straat: "Straat", nummer: "Huisnr", postcode: "Postcode" },
  { id: "concertzalen", url: `${DIENSTEN}/P_Portal/portal_publiek13/MapServer/3`, namen: ["naam"], straat: "straat", nummer: "huisnummer", postcode: "postcode" },
  { id: "bibliotheek", url: `${DIENSTEN}/P_Atlas/Atlas/MapServer/14`, namen: ["naam"], straat: "straat", nummer: "huisnr", postcode: "postcode" },
  { id: "zaalzoeker", url: `${DIENSTEN}/P_Portal/portal_publiek10/MapServer/933`, namen: ["pandnaam"], straat: "straat", nummer: "huisnr", postcode: "postcode" },
].map(Object.freeze));

// Wat er ontbreekt als er niets ingevuld werd, in gewone woorden (de melding "Huisnummer ontbreekt").
export const UITKOMSTEN = Object.freeze({
  niet_gevonden: "niet in de open data van de stad",
  dubbelzinnig: "de open data van de stad geeft meer dan één adres",
  zonder_huisnummer: "de open data van de stad geeft geen huisnummer",
  adres_onvolledig: "de open data van de stad geeft geen volledig adres in de stad",
  andere_postcode: "de open data van de stad geeft een adres in een andere postcode",
});

const SCHEMA_VERSION = 1;
const PAGINA = 1000;
const MAX_PAGINAS = 10;
const NUMMER = /^[1-9]\d{0,2}[a-z]?$/i;
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

// ---------- mag deze url gelezen worden? ----------
export function magLezen(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "https:" || GEWEIGERDE_HOSTS.includes(host)) return false;
  return host === OPEN_DATA_HOST;
}

// ---------- robots.txt ----------
// De Disallow-regels van de groep voor onze naam, anders van "*". Leeg: alles mag.
export function robotsVerbodenPaden(tekst, agent = "publieke-agenda-antwerpen") {
  const groepen = [];
  let huidig = null;
  for (const lijn of String(tekst ?? "").split(/\r?\n/)) {
    const regel = lijn.replace(/#.*$/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(regel);
    if (!m) continue;
    const [veld, waarde] = [m[1].toLowerCase(), m[2].trim()];
    if (veld === "user-agent") {
      if (!huidig || huidig.regels.length) {
        huidig = { agents: [], regels: [] };
        groepen.push(huidig);
      }
      huidig.agents.push(waarde.toLowerCase());
    } else if (huidig && (veld === "disallow" || veld === "allow")) {
      huidig.regels.push({ veld, pad: waarde });
    }
  }
  const eigen = groepen.find((g) => g.agents.some((a) => a !== "*" && agent.toLowerCase().startsWith(a)));
  const groep = eigen ?? groepen.find((g) => g.agents.includes("*"));
  return (groep?.regels ?? []).filter((r) => r.veld === "disallow" && r.pad).map((r) => r.pad);
}

export function robotsLaatToe(verboden, url) {
  const pad = new URL(url).pathname;
  return !verboden.some((prefix) => pad.startsWith(prefix.replace(/\*.*$/, "")));
}

// ---------- lezen ----------
const wacht = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function haal(fetchImpl, url) {
  if (!magLezen(url)) throw new FetchError("host_niet_toegelaten");
  const response = await fetchWithTimeout(fetchImpl, url, { headers: { "user-agent": USER_AGENT, accept: "application/json" }, redirect: "error" });
  return response;
}

// Leest robots.txt van de open data één keer: 404/410 (geen robots.txt) is toegelaten; een andere fout of een weigering
// is "nee" (fail closed).
export async function leesRobots(fetchImpl) {
  const url = `https://${OPEN_DATA_HOST}/robots.txt`;
  const response = await haal(fetchImpl, url);
  if (response.status === 404 || response.status === 410) return [];
  if (!response.ok) throw new FetchError(`robots_http_${response.status}`);
  return robotsVerbodenPaden(await response.text());
}

// Alle rijen van één laag (alleen de gevraagde velden, zonder geometrie, unieke rijen), per pagina. Een laag die na
// MAX_PAGINAS nog meer rijen heeft, of een antwoord met een fout, is een fout: dan is niet zeker dat een naam maar één
// adres heeft.
export async function leesLaag(fetchImpl, laag, velden, { verboden = [], sleep = wacht, pauzeMs = 1000 } = {}) {
  const basis = `${laag.url}/query`;
  if (!magLezen(basis)) throw new FetchError("host_niet_toegelaten");
  if (!robotsLaatToe(verboden, basis)) throw new FetchError("robots_verbiedt");
  const rijen = [];
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina += 1) {
    const url = new URL(basis);
    url.search = new URLSearchParams({
      where: "1=1",
      outFields: velden.join(","),
      returnDistinctValues: "true",
      returnGeometry: "false",
      orderByFields: velden.join(","),
      resultOffset: String(pagina * PAGINA),
      resultRecordCount: String(PAGINA),
      f: "json",
    }).toString();
    if (pagina > 0 || rijen.length) await sleep(pauzeMs);
    const response = await haal(fetchImpl, url.href);
    if (!response.ok) throw new FetchError(`http_${response.status}`);
    let json;
    try {
      json = await response.json();
    } catch {
      throw new FetchError("geen_json");
    }
    if (!json || json.error || !Array.isArray(json.features)) throw new FetchError("laag_fout");
    for (const feature of json.features) if (feature?.attributes && typeof feature.attributes === "object") rijen.push(feature.attributes);
    if (!json.exceededTransferLimit) return rijen;
  }
  throw new FetchError("laag_te_groot");
}

// Leest alle lagen. Faalt één laag, dan faalt alles (een onvolledige lezing kan een tweede adres missen).
export async function leesOpenData({ fetch: fetchImpl = globalThis.fetch, adresLagen = ADRES_LAGEN, sleep = wacht, pauzeMs = 1000 } = {}) {
  for (const laag of adresLagen) if (!magLezen(laag.url)) throw new FetchError("host_niet_toegelaten");
  const verboden = await leesRobots(fetchImpl);
  const adressen = [];
  for (const laag of adresLagen) {
    await sleep(pauzeMs);
    const velden = [...laag.namen, laag.straat, laag.nummer, laag.postcode];
    adressen.push({ laag, rijen: await leesLaag(fetchImpl, laag, velden, { verboden, sleep, pauzeMs }) });
  }
  return { adressen };
}

// ---------- adressen opbouwen (puur) ----------
// De officiële straatnaam met die postcode (site/geo/straten-stad.json: [naam, aantal, postcode]); anders null.
function officieleStraat(straat, postcode, stratenStad) {
  const sleutel = plat(straat);
  if (!sleutel) return null;
  const namen = new Set();
  for (const rij of stratenStad?.straten ?? []) if (Array.isArray(rij) && plat(rij[0]) === sleutel && String(rij[2]) === postcode) namen.add(String(rij[0]));
  return namen.size === 1 ? [...namen][0] : null;
}

// De gemeente bij een postcode: "Antwerpen" in district Antwerpen, anders het district met die postcode.
function gemeenteVan(postcode, stratenStad) {
  if (DISTRICT_POSTCODES.includes(postcode)) return "Antwerpen";
  const labels = (stratenStad?.districten ?? []).filter((d) => Array.isArray(d?.postcodes) && d.postcodes.includes(postcode)).map((d) => String(d.label ?? ""));
  return labels.length === 1 && labels[0] ? labels[0] : null;
}

// Eén rij als adres: { sleutel, adres } of { sleutel, fout } ("zonder_huisnummer", "adres_onvolledig").
function adresVanRij(rij, laag, stratenStad) {
  const straat = clean(rij[laag.straat]);
  const nummer = clean(rij[laag.nummer]);
  const postcode = clean(rij[laag.postcode]);
  const sleutel = `${plat(straat)}|${nummer.toLowerCase()}|${postcode}`;
  if (!NUMMER.test(nummer)) return { sleutel, postcode, fout: "zonder_huisnummer" };
  if (!CITY_POSTCODES.includes(postcode)) return { sleutel, postcode, fout: "adres_onvolledig" };
  const officieel = officieleStraat(straat, postcode, stratenStad);
  const gemeente = gemeenteVan(postcode, stratenStad);
  if (!officieel || !gemeente) return { sleutel, postcode, fout: "adres_onvolledig" };
  return { sleutel, postcode, adres: `${officieel} ${nummer}, ${postcode} ${gemeente}` };
}

// plat(naam) → [{ naam, sleutel, postcode, adres?, fout?, bron }], over alle adreslagen.
export function adresIndex(adressen, { stratenStad = null } = {}) {
  const index = new Map();
  for (const { laag, rijen } of adressen) {
    for (const rij of rijen) {
      const adres = adresVanRij(rij, laag, stratenStad);
      for (const veld of laag.namen) {
        const naam = clean(rij[veld]);
        const sleutel = plat(naam);
        if (!sleutel) continue;
        if (!index.has(sleutel)) index.set(sleutel, []);
        index.get(sleutel).push({ naam, ...adres, bron: laag.url });
      }
    }
  }
  return index;
}

// Zoekt één naam. { uitkomst: "gevonden", naam, adres, bron } of { uitkomst: <code uit UITKOMSTEN> }.
// `postcodes`: per activiteit met die naam de postcodes die ze zelf noemt (leeg: geen); het adres moet in elk ervan passen.
export function zoekAdres(naam, index, { postcodes = [] } = {}) {
  const treffers = index.get(plat(naam)) ?? [];
  if (!treffers.length) return { uitkomst: "niet_gevonden" };
  const sleutels = new Set(treffers.map((t) => t.sleutel));
  if (sleutels.size > 1) return { uitkomst: "dubbelzinnig" };
  const treffer = treffers.find((t) => t.adres) ?? treffers[0];
  if (!treffer.adres) return { uitkomst: treffer.fout ?? "adres_onvolledig" };
  if (postcodes.some((lijst) => lijst.length && !lijst.includes(treffer.postcode))) return { uitkomst: "andere_postcode" };
  return { uitkomst: "gevonden", naam: treffer.naam, adres: treffer.adres, bron: treffer.bron };
}

// ---------- welke plekken zoeken ----------
// De naam van de plek in een locatietekst: het eerste deel voor de komma, zonder opmerking tussen haakjes; daarna ook
// zonder "in <district of wijk>" erachter ("Rivierenhof in Deurne"). Nooit een stuk van een naam ("Zaal Plantin" uit
// "Zaal Plantin en Moretus"): alleen de hele naam telt. Geeft de namen om te proberen, de langste eerst.
export function plekNamen(location, { gebieden = new Set() } = {}) {
  const eerste = clean(String(location ?? "").split(",")[0].replace(/\([^)]*\)/g, " ")).replace(/[\s.;:]+$/, "");
  if (!eerste) return [];
  const metIn = /^(.*\S)\s+in\s+(\S.*)$/i.exec(eerste);
  return [...new Set([eerste, metIn && gebieden.has(plat(metIn[2])) ? metIn[1] : null].map(clean).filter(Boolean))];
}

// De postcodes die een activiteit zelf noemt: haar veld postcodes, een postcode in de tekst, of "District X".
function postcodesVan(item, stratenStad) {
  const uit = new Set([...(Array.isArray(item?.postcodes) ? item.postcodes : []), ...postcodesInText(item?.location ?? "")].map(String));
  for (const deel of String(item?.location ?? "").split(",")) {
    const m = /^\s*district\s+(.+?)\s*(?:\(.*)?$/i.exec(deel);
    if (!m) continue;
    for (const d of stratenStad?.districten ?? []) if (plat(d?.label) === plat(m[1])) for (const p of d.postcodes ?? []) uit.add(String(p));
  }
  return [...uit].filter((p) => CITY_POSTCODES.includes(p));
}

// De plekken om te zoeken: plat(eerste naam) → { namen, postcodes: [[...], ...] }, uit de komende activiteiten die na de
// vaste lijst nog een gebouw zonder huisnummer zijn. `vasteAdressen` zonder de automatische adressen: zo blijft een
// gevonden plek in het bestand zolang de activiteit komt.
export function teZoekenPlekken(items, today, { vasteAdressen = null, kennis = {}, stratenStad = null } = {}) {
  const perId = new Map((Array.isArray(items) ? items : []).map((item) => [item?.id, item]));
  const plekken = new Map();
  for (const ontbrekend of ontbrekendeHuisnummers(items, today, { vasteAdressen, kennis })) {
    const namen = plekNamen(ontbrekend.location, kennis);
    if (!namen.length) continue;
    const sleutel = plat(namen[0]);
    if (!plekken.has(sleutel)) plekken.set(sleutel, { namen, postcodes: [] });
    plekken.get(sleutel).postcodes.push(postcodesVan(perId.get(ontbrekend.id) ?? ontbrekend, stratenStad));
  }
  return plekken;
}

// ---------- het bestand (puur) ----------
// Bouwt site/sources/huisnummers-auto.json uit de te zoeken plekken en de gelezen lagen.
export function maakAutoDocument({ plekken, adressen = [], vandaag, stratenStad = null }) {
  const index = adresIndex(adressen, { stratenStad });
  const uit = { schemaVersion: SCHEMA_VERSION, uitleg: UITLEG, bijgewerkt: vandaag, plekken: [], nagekeken: [] };
  const herkend = new Set();
  for (const [, { namen, postcodes }] of [...plekken].sort(([a], [b]) => a.localeCompare(b))) {
    let beste = null;
    for (const naam of namen) {
      const gevonden = zoekAdres(naam, index, { postcodes });
      if (gevonden.uitkomst === "gevonden") { beste = { ...gevonden, herken: naam }; break; }
      if (!beste || beste.uitkomst === "niet_gevonden") beste = gevonden;
    }
    const herken = beste?.herken;
    if (beste?.uitkomst === "gevonden" && plat(herken).length >= 6 && !heeftHuisnummer(herken) && !herkend.has(plat(herken))) {
      herkend.add(plat(herken));
      uit.plekken.push({ naam: beste.naam, herken: [herken], adres: beste.adres, bron: beste.bron });
    } else {
      uit.nagekeken.push({ herken: namen[0], uitkomst: beste?.uitkomst === "gevonden" ? "dubbelzinnig" : beste?.uitkomst ?? "niet_gevonden" });
    }
  }
  return uit;
}

const UITLEG = "Automatisch aangevuld bij de verversing (scripts/vul-huisnummers.mjs, lib/huisnummer-uit-bron.mjs): het adres van een plek die een activiteit zonder huisnummer noemt, uit de open data van stad Antwerpen op geodata.antwerpen.be (Gratis Open Data Licentie, bron stad Antwerpen), alleen als de bron precies één adres geeft. nagekeken: plekken waarvoor de bron geen eenduidig adres gaf. Niet met de hand aanpassen; een vast adres hoort in vaste-adressen.json.";

export function validateHuisnummersAuto(document) {
  const errors = [];
  if (!document || typeof document !== "object" || Array.isArray(document)) return ["document is geen object"];
  for (const key of Object.keys(document)) if (!["schemaVersion", "uitleg", "bijgewerkt", "plekken", "nagekeken"].includes(key)) errors.push(`onbekende sleutel ${key}`);
  if (document.schemaVersion !== SCHEMA_VERSION) errors.push("schemaVersion moet 1 zijn");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(document.bijgewerkt ?? ""))) errors.push("ongeldige bijgewerkt");
  for (const veld of ["plekken", "nagekeken"]) if (!Array.isArray(document[veld])) errors.push(`${veld} moet een lijst zijn`);
  if (errors.length) return errors;
  if (document.plekken.length) {
    for (const error of validateVasteAdressen({ schemaVersion: 1, bijgewerkt: document.bijgewerkt, plekken: document.plekken })) errors.push(error);
  }
  document.plekken.forEach((plek, i) => { if (!magLezen(plek?.bron)) errors.push(`plekken[${i}]: bron moet op ${OPEN_DATA_HOST} staan`); });
  document.nagekeken.forEach((rij, i) => {
    const keys = rij && typeof rij === "object" ? Object.keys(rij) : [];
    for (const key of keys) if (!["herken", "uitkomst"].includes(key)) errors.push(`nagekeken[${i}]: onbekende sleutel ${key}`);
    if (typeof rij?.herken !== "string" || !plat(rij.herken)) errors.push(`nagekeken[${i}]: herken ontbreekt`);
    if (!Object.hasOwn(UITKOMSTEN, rij?.uitkomst)) errors.push(`nagekeken[${i}]: onbekende uitkomst`);
  });
  return errors;
}

// ---------- gebruiken ----------
// De vaste lijst en de automatische adressen samen, in de vorm die metVastAdres leest. De vaste lijst gaat voor: een
// automatische plek met een naam die de vaste lijst al herkent, valt weg.
export function samenAdressen(vast, auto) {
  const vastePlekken = Array.isArray(vast?.plekken) ? vast.plekken : [];
  const autoPlekken = Array.isArray(auto?.plekken) ? auto.plekken : [];
  if (!autoPlekken.length) return vast ?? null;
  const gezien = new Set(vastePlekken.flatMap((p) => (Array.isArray(p?.herken) ? p.herken : []).map(plat)));
  const erbij = autoPlekken.filter((p) => Array.isArray(p?.herken) && p.herken.every((h) => !gezien.has(plat(h))));
  return { ...(vast ?? { schemaVersion: 1 }), plekken: [...vastePlekken, ...erbij] };
}

// Wat er ontbreekt voor een locatie, als de verversing ernaar zocht: een zin uit UITKOMSTEN, of null.
export function watOntbreekt(location, auto, kennis = {}) {
  const namen = plekNamen(location, kennis).map(plat);
  const rij = (Array.isArray(auto?.nagekeken) ? auto.nagekeken : []).find((r) => namen.includes(plat(r?.herken)));
  return rij ? UITKOMSTEN[rij.uitkomst] ?? null : null;
}
