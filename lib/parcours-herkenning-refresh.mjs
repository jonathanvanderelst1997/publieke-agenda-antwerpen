// Dataverversing voor de automatische parcoursherkenner (lib/parcours-herkenning.mjs). Draait in
// `npm run refresh` na het ophalen van de bronnen en de geocodering (scripts/herken-parcours.mjs) en
// schrijft site/sources/evenement-identiteit-auto.json en site/sources/evenement-patronen.json.
//
// Alles is gratis en zonder sleutel: A-Sign en de straatas (geodata.antwerpen.be), GIPOD (Digitaal
// Vlaanderen), de agendabronnen die de verversing al ophaalde (site/sources) en de publieke agenda's
// uit lib/organisator-feeds.json. Elke bron heeft een time-out en eigen foutopvang: faalt er één, dan
// valt de herkenner terug op de andere stappen. Faalt A-Sign zelf, dan blijven de vorige bestanden
// staan. Deze stap gooit nooit een fout naar de verversing.
import fs from "node:fs";
import path from "node:path";

import { asignEvenementenNietBijgewerkt, schrijfAsignEvenementen, straatasFoutCode } from "./asign-evenementen-agenda.mjs";
import { USER_AGENT, fetchWithTimeout } from "./fetch-util.mjs";
import { brusselsDate } from "./html-text.mjs";
import { EVENEMENT_IDENTITEIT_FILE } from "./evenement-identiteit-validatie.mjs";
import { validateHerkenning, validatePatronen } from "./evenement-herkenning-validatie.mjs";
import { privacyFindings } from "./source-feed.mjs";
import { stratenLangsLijn, wijkVanUitGeo } from "./kaart-uitleg-refresh.mjs";
import { locationKey } from "../site/neighborhood-core.js";
import { buildStreetIndex, resolvePointStreet } from "../site/street-core.js";
import { fetchStreetFeatures } from "../site/street-source.js";
import {
  AFGEWEZEN, HERKENNING_FILE, METHODES, PATRONEN_FILE, alleenKaartzin, bibliotheekUit, bijwerkenPatronen, bouwHerkenning, dossiersUitAsign,
  kandidaatUitAgenda, meterTussen, vatHistoriekSamen, verrijk, vormVan,
} from "./parcours-herkenning.mjs";

export const HERKENNING_BUDGET_MS = 90_000; // de hele stap; daarna wint de volgende verversing
export const HISTORIEK_BUDGET_MS = 40_000; // oudere dossiers op dezelfde plek (alleen nieuwe of gewijzigde)
export const VOORUIT_DAGEN = 60;
const ASIGN = "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer";
const STRAATAS = "https://geodata.antwerpen.be/arcgissql/rest/services/P_Portal/portal_publiek9/MapServer/905/query";
const GIPOD_INNAME = "https://geo.api.vlaanderen.be/GIPOD/ogc/features/v1/collections/INNAME/items";
const STAD_BOX = [4.2, 51.1, 4.6, 51.42];
const GELIJKTIJDIG = 4;
export const MAX_FEED_BYTES = 5 * 1024 * 1024; // een agenda van een organisatie
export const MAX_JSON_BYTES = 25 * 1024 * 1024; // een pakket van A-Sign of een pagina van GIPOD
export const MAX_FOUTEN_OP_RIJ = 5; // daarna vraagt de verversing die bron niets meer (de server hapert)
// Een plotse krimp van A-Sign (een leeg antwoord, een storing) overschrijft de vorige fiches niet. Duurt
// de krimp langer dan dit, dan is ze echt en schrijft de verversing toch.
export const KRIMP_DAGEN = 3;

const clean = (v, max = 300) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const plusDagen = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dagenTussen = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
const inStad = (p) => Array.isArray(p) && p[0] >= STAD_BOX[0] && p[0] <= STAD_BOX[2] && p[1] >= STAD_BOX[1] && p[1] <= STAD_BOX[3];
const leesJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
const code = (error, fallback) => { const c = String(error?.code || "").toLowerCase(); return /^[a-z0-9_:-]{2,60}$/.test(c) ? c : fallback; };

// De body lezen met dezelfde time-out als het verzoek (fetchWithTimeout stopt de klok al na de headers)
// en een grens op de grootte, in de tekenset uit Content-Type (een agenda in Latin-1 blijft leesbaar).
export async function leesBody(response, { timeoutMs = 20_000, maxBytes = MAX_FEED_BYTES } = {}) {
  const fout = (code) => Object.assign(new Error(code), { code });
  let timer;
  const verlopen = new Promise((_, reject) => { timer = setTimeout(() => reject(fout("timeout")), timeoutMs); });
  verlopen.catch(() => {});
  try {
    const reader = typeof response?.body?.getReader === "function" ? response.body.getReader() : null;
    if (!reader) {
      // Een nagemaakt antwoord zonder stream: alleen text() of json().
      const tekst = typeof response.text === "function" ? String(await Promise.race([response.text(), verlopen])) : JSON.stringify(await Promise.race([response.json(), verlopen]));
      if (Buffer.byteLength(tekst) > maxBytes) throw fout("too_large");
      return tekst;
    }
    const delen = [];
    let n = 0;
    try {
      for (;;) {
        const { done, value } = await Promise.race([reader.read(), verlopen]);
        if (done) break;
        n += value.byteLength;
        if (n > maxBytes) throw fout("too_large");
        delen.push(value);
      }
    } catch (error) {
      reader.cancel().catch(() => {});
      throw error;
    }
    const tekenset = /charset=["']?([\w-]+)/i.exec(response.headers?.get?.("content-type") || "")?.[1] || "utf-8";
    let decoder;
    try { decoder = new TextDecoder(tekenset.toLowerCase()); } catch { decoder = new TextDecoder("utf-8"); }
    return decoder.decode(Buffer.concat(delen));
  } finally {
    clearTimeout(timer);
  }
}
async function getJson(fetchImpl, url, { timeoutMs = 20_000, init = {}, maxBytes = MAX_JSON_BYTES } = {}) {
  const response = await fetchWithTimeout(fetchImpl, url, { ...init, headers: { "user-agent": USER_AGENT, accept: "application/json", ...(init.headers || {}) } }, timeoutMs);
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { code: `http_${response.status}` });
  let data;
  try { data = JSON.parse(await leesBody(response, { timeoutMs, maxBytes })); } catch (error) {
    throw error?.code ? error : Object.assign(new Error("geen json"), { code: "invalid_json" });
  }
  if (data?.error) throw Object.assign(new Error("bronfout"), { code: "provider_error" });
  return data;
}

// ---------- A-Sign ----------

const VELDEN = "dossierNummer,dossierStatus,faseNaam,faseStartDatum,faseEindDatum,innameTypeNaam,innameBeschrijving,last_edited_date";
// Eén laag: eerst de id's, dan de features in pakketten (zoals scripts/refresh-live-history.mjs).
export async function asignVraag(fetchImpl, laag, { where, envelope = null, maxIds = 6000, outFields = VELDEN } = {}) {
  const basis = { where, f: "json" };
  if (envelope) Object.assign(basis, { geometry: envelope.join(","), geometryType: "esriGeometryEnvelope", inSR: "4326", spatialRel: "esriSpatialRelIntersects" });
  const idUrl = new URL(`${ASIGN}/${laag}/query`);
  idUrl.search = new URLSearchParams({ ...basis, returnIdsOnly: "true" });
  const ids = (await getJson(fetchImpl, idUrl)).objectIds || [];
  if (ids.length > maxIds) throw Object.assign(new Error("te veel"), { code: "record_limit" });
  const features = [];
  for (let i = 0; i < ids.length; i += 150) {
    const url = new URL(`${ASIGN}/${laag}/query`);
    url.search = new URLSearchParams({ f: "json", objectIds: ids.slice(i, i + 150).join(","), outFields, returnGeometry: "true", outSR: "4326", maxAllowableOffset: "0.00003", geometryPrecision: "6" });
    const data = await getJson(fetchImpl, url);
    if (!Array.isArray(data.features)) throw Object.assign(new Error("features ontbreken"), { code: "invalid_features" });
    features.push(...data.features);
  }
  return features;
}
const sqlDag = (d) => `DATE '${d}'`;
const NIET = AFGEWEZEN.map((s) => `'${s}'`).join(",");
// Alle evenementendossiers van vandaag tot VOORUIT_DAGEN, in elke status behalve geweigerd of
// afgelast: zo is de fiche klaar op de dag dat de stad goedkeurt.
export async function haalDossiers(fetchImpl, vandaag) {
  const where = `faseEindDatum >= ${sqlDag(vandaag)} AND faseStartDatum <= ${sqlDag(plusDagen(vandaag, VOORUIT_DAGEN))} AND dossierStatus NOT IN (${NIET})`;
  const [l22, l23] = await Promise.all([asignVraag(fetchImpl, 22, { where }), asignVraag(fetchImpl, 23, { where })]);
  return [...l22, ...l23];
}
// Oudere dossiers op dezelfde plek, rond dezelfde dag in de drie vorige jaren.
export async function haalHistoriek(fetchImpl, d) {
  const box = d.vorm.bbox;
  if (!box) return [];
  const pad = 0.0004;
  const envelope = [box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad];
  const vensters = [1, 2, 3].map((j) => {
    const dag = `${Number(d.dag.start.slice(0, 4)) - j}${d.dag.start.slice(4)}`;
    return `(faseStartDatum >= ${sqlDag(plusDagen(dag, -35))} AND faseStartDatum <= ${sqlDag(plusDagen(dag, 35))})`;
  });
  const where = `(${vensters.join(" OR ")})`;
  // Een groot parcours door het centrum raakt honderden oude innames: dan alleen de oude parcours.
  const vraag = async (laag) => {
    try { return await asignVraag(fetchImpl, laag, { where, envelope, maxIds: 600 }); } catch (error) {
      if (error?.code !== "record_limit") throw error;
      return asignVraag(fetchImpl, laag, { where: `${where} AND innameTypeNaam = 'Parcours'`, envelope, maxIds: 600 });
    }
  };
  // Na elkaar, niet tegelijk: met vier dossiers tegelijk blijven het zo vier verzoeken aan A-Sign.
  const l22 = await vraag(22);
  const l23 = await vraag(23);
  const ruw = [];
  for (const h of dossiersUitAsign([...l22, ...l23]).values()) ruw.push({ dossier: h.dossier, dag: h.dag.start, beschrijvingen: h.beschrijvingen, vorm: vormVan(h.innames) });
  return ruw;
}

// ---------- GIPOD: evenementen van buurgemeenten ----------

// De stad Antwerpen zet geen evenementen in GIPOD (alleen markten en ambulante handel); de
// buurgemeenten wel, met datum en vlak. Eén vraag voor het hele venster.
const GEEN_GIPOD = /^(?:Markt|Ambulante handel|Uitstalling|Reclame|Terras|Parkeer|Standplaats)/i;
// Geen privéfeesten (een verjaardag of pensioenfeest kan een naam dragen) en niets wat afgelast is.
// Voor GIPOD en voor de agenda's van organisaties. Niet "familie" of "jubileum" alleen: een familiedag
// of het jubileum van een harmonie is publiek.
export const PRIVE_OF_AFGELAST = /geannul+eerd|afgelast|verjaardag|babyborrel|babyshower|huwelijk|trouwfeest|\btrouw\b|communie|lentefeest|geboorte|priv[eé]|pensioen|afscheidsfeest|afscheidsreceptie|afscheidsdrink|familiefeest|familiereuni|familiebijeenkomst|gouden bruiloft|zilveren bruiloft|uitvaart|begrafenis|rouwdienst/i;
export function kandidatenUitGipod(geojson = {}) {
  const uit = [];
  for (const f of Array.isArray(geojson.features) ? geojson.features : []) {
    const p = f?.properties || {};
    if (p.Type !== "Evenement" || !["Concreet gepland", "Lopende"].includes(p.Status)) continue;
    if (/^stad antwerpen/i.test(clean(p.Owner)) || String(p.PublicDomainOccupancyTypes || "").split(";").some((t) => GEEN_GIPOD.test(t.trim()))) continue;
    const omschrijving = clean(p.Description, 400);
    // Geen geannuleerde en geen privéfeesten (een verjaardag of babyborrel kan een naam dragen).
    if (!omschrijving || PRIVE_OF_AFGELAST.test(omschrijving)) continue;
    // "2640 Mortsel, Deurnestraat 252 : Campustrail Multiversum": de titel staat na het adres. Een
    // vrije tekst zonder adres wordt hoogstens de eerste zin; een opsomming (instructies) telt niet.
    const delen = omschrijving.split(":").map((x) => clean(x)).filter(Boolean);
    const ruweTitel = (delen.length > 1 && /\b\d{4}\b/.test(delen[0]) ? delen.slice(1).join(": ") : omschrijving).replace(/^evenement\s*[-–:]\s*/i, "");
    if (/^[•\-*]/.test(ruweTitel)) continue;
    const titel = clean(ruweTitel.split(/(?<=[.!?])\s/)[0], 100);
    const dag = brusselsDate(new Date(p.Start)), eind = brusselsDate(new Date(p.End));
    if (!titel || !/^\d{4}-\d{2}-\d{2}$/.test(dag)) continue;
    const gemeente = clean(p.Owner, 80).replace(/^(?:Stad|Gemeente)\s+/i, "");
    uit.push({
      titel, dag, eind: eind >= dag ? eind : dag, tijd: "", locatie: gemeente, bron: "gipod",
      link: /^INNAME\.[0-9-]{1,40}$/.test(String(f.id || "")) ? `${GIPOD_INNAME}/${f.id}` : "",
      bronLabel: `GIPOD (gemeente ${gemeente})`, vlak: f.geometry || null, district: "", postcodes: [],
    });
  }
  return uit;
}
export async function haalGipodBuren(fetchImpl, vandaag) {
  const url = new URL(GIPOD_INNAME);
  url.search = new URLSearchParams({
    f: "json", limit: "1000", bbox: STAD_BOX.join(","), "filter-lang": "cql2-text",
    filter: "Type='Evenement' AND Owner NOT LIKE 'Stad Antwerpen%' AND Status IN ('Concreet gepland','Lopende')",
    datetime: `${vandaag}T00:00:00Z/${plusDagen(vandaag, VOORUIT_DAGEN)}T23:59:59Z`,
  });
  // Hoogstens drie pagina's van 1000 (vandaag ongeveer 400 evenementen voor twee maanden).
  const features = [];
  let volgende = url.href;
  for (let pagina = 0; pagina < 3 && volgende; pagina++) {
    const data = await getJson(fetchImpl, volgende, { timeoutMs: 30_000, init: { headers: { accept: "application/geo+json, application/json" } } });
    features.push(...(Array.isArray(data.features) ? data.features : []));
    const next = (data.links || []).find((l) => l.rel === "next")?.href || "";
    volgende = next.startsWith(`${GIPOD_INNAME}?`) ? next : "";
  }
  return kandidatenUitGipod({ features });
}

// ---------- organisatoren (lib/organisator-feeds.json) ----------

const ontsnap = (t) => String(t ?? "").replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1");
function icsTijd(waarde = "", params = "") {
  const m = String(waarde).match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  if (!m[4]) return { dag: `${m[1]}-${m[2]}-${m[3]}`, uur: "" };
  // UTC ("Z") omzetten naar Brussel; zonder Z (TZID of zwevend) is het al lokale tijd.
  if (m[7]) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
    const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
    return { dag: `${p.year}-${p.month}-${p.day}`, uur: `${p.hour}:${p.minute}` };
  }
  return { dag: `${m[1]}-${m[2]}-${m[3]}`, uur: `${m[4]}:${m[5]}`, params };
}
const uurTekst = (a, b) => {
  const s = (u) => (u ? `${Number(u.slice(0, 2))}${u.slice(3) === "00" ? "" : `.${u.slice(3)}`}` : "");
  return a && b ? `${s(a)} tot ${s(b)} uur` : a ? `om ${s(a)} uur` : "";
};
export function parseIcs(tekst = "") {
  const regels = String(tekst).replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const uit = [];
  let ev = null;
  for (const regel of regels) {
    if (regel === "BEGIN:VEVENT") { ev = {}; continue; }
    if (regel === "END:VEVENT") { if (ev) uit.push(ev); ev = null; continue; }
    if (!ev) continue;
    const i = regel.indexOf(":");
    if (i < 0) continue;
    const [naam, ...params] = regel.slice(0, i).split(";");
    ev[naam.toUpperCase()] = { waarde: regel.slice(i + 1), params: params.join(";") };
  }
  return uit.map((e) => {
    const start = icsTijd(e.DTSTART?.waarde, e.DTSTART?.params), einde = icsTijd(e.DTEND?.waarde, e.DTEND?.params);
    const geo = String(e.GEO?.waarde || "").split(";").map(Number);
    // DTEND is exclusief: een hele dag (VALUE=DATE, 13 tot 14 oktober) of middernacht telt die dag niet mee.
    const eind = !start?.dag || !einde?.dag || einde.dag < start.dag ? start?.dag || "" : einde.dag > start.dag && (!einde.uur || einde.uur === "00:00") ? plusDagen(einde.dag, -1) : einde.dag;
    return {
      titel: clean(ontsnap(e.SUMMARY?.waarde), 160), dag: start?.dag || "", eind,
      tijd: uurTekst(start?.uur, einde?.dag === start?.dag ? einde?.uur : ""), locatie: clean(ontsnap(e.LOCATION?.waarde), 200),
      punt: geo.length === 2 && geo.every(Number.isFinite) ? [geo[1], geo[0]] : null,
    };
  }).filter((e) => e.titel && e.dag);
}
export function parseSquarespace(json = {}) {
  const dag = (ms) => (Number.isFinite(Number(ms)) ? brusselsDate(new Date(Number(ms))) : "");
  const uur = (ms) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Brussels", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(Number(ms)));
  return (Array.isArray(json.upcoming) ? json.upcoming : []).map((e) => {
    const loc = e.location || {};
    const p = [Number(loc.markerLng), Number(loc.markerLat)];
    return {
      titel: clean(e.title, 160), dag: dag(e.startDate), eind: dag(e.endDate) || dag(e.startDate),
      tijd: Number.isFinite(Number(e.startDate)) ? uurTekst(uur(e.startDate), dag(e.endDate) === dag(e.startDate) ? uur(e.endDate) : "") : "",
      locatie: clean([loc.addressTitle, loc.addressLine1, loc.addressLine2].filter(Boolean).join(", "), 200),
      punt: p.every(Number.isFinite) ? p : null,
    };
  }).filter((e) => e.titel && e.dag);
}
export function parseJsonLd(html = "") {
  const uit = [];
  const bezoek = (node) => {
    if (Array.isArray(node)) return node.forEach(bezoek);
    if (!node || typeof node !== "object") return;
    if (node["@graph"]) bezoek(node["@graph"]);
    const types = [].concat(node["@type"] || []);
    if (!types.some((t) => /Event$/.test(String(t)))) return;
    const start = String(node.startDate || ""), einde = String(node.endDate || "");
    const loc = [].concat(node.location || [])[0] || {};
    const geo = loc.geo || {};
    const adres = typeof loc.address === "string" ? loc.address : [loc.address?.streetAddress, loc.address?.postalCode, loc.address?.addressLocality].filter(Boolean).join(" ");
    const p = [Number(geo.longitude), Number(geo.latitude)];
    const dag = start.slice(0, 10), eind = einde.slice(0, 10) || dag;
    uit.push({
      titel: clean(node.name, 160), dag, eind: eind >= dag ? eind : dag, tijd: uurTekst(start.slice(11, 16), eind === dag ? einde.slice(11, 16) : ""),
      locatie: clean([loc.name, adres].filter(Boolean).join(", "), 200), punt: p.every(Number.isFinite) ? p : null,
    });
  };
  for (const m of String(html).matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { bezoek(JSON.parse(m[1])); } catch { /* een kapot blok telt niet mee */ }
  }
  return uit.filter((e) => e.titel && /^\d{4}-\d{2}-\d{2}$/.test(e.dag));
}
// Een feed die niets oplevert, is een melding waard (een verhuisde agenda, een pagina zonder Event).
export function feedFout(feed, inhoud) {
  if (feed.soort === "ics") return !/BEGIN:VCALENDAR/.test(String(inhoud)) ? "geen_ical" : !/BEGIN:VEVENT/.test(String(inhoud)) ? "leeg" : "";
  if (feed.soort === "squarespace") return !Array.isArray(inhoud?.upcoming) ? "geen_agenda" : "";
  if (feed.soort === "jsonld") return parseJsonLd(inhoud).length ? "" : "leeg";
  return "";
}
export function kandidatenUitFeed(feed, inhoud, { vandaag, puntVan = () => null } = {}) {
  const ruw = feed.soort === "ics" ? parseIcs(inhoud) : feed.soort === "squarespace" ? parseSquarespace(inhoud) : feed.soort === "jsonld" ? parseJsonLd(inhoud) : [];
  const tot = plusDagen(vandaag, VOORUIT_DAGEN);
  return ruw.filter((e) => e.eind >= vandaag && e.dag <= tot && !PRIVE_OF_AFGELAST.test(e.titel)).map((e) => {
    const geo = !inStad(e.punt) ? puntVan(e.locatie) : null;
    return {
      titel: e.titel, dag: e.dag, eind: e.eind, tijd: e.tijd, locatie: e.locatie, link: clean(feed.pagina, 300), bron: "organisator",
      bronLabel: `agenda van ${feed.organisatie}`, organisator: clean(feed.organisatie, 120),
      punt: inStad(e.punt) ? e.punt : inStad(geo?.point) ? geo.point : null, puntPrecisie: inStad(e.punt) ? "adres" : geo?.precision || "",
      district: "", postcodes: [...e.locatie.matchAll(/\b(2\d{3})\b/g)].map((x) => x[1]),
    };
  });
}
export async function haalFeeds(fetchImpl, register = [], { timeoutMs = 12_000, ...opties } = {}) {
  const uit = [], fouten = [];
  await Promise.all(register.map(async (feed) => {
    try {
      const response = await fetchWithTimeout(fetchImpl, feed.url, { headers: { "user-agent": USER_AGENT }, redirect: "follow" }, timeoutMs);
      if (!response.ok) throw Object.assign(new Error("http"), { code: `http_${response.status}` });
      const tekst = await leesBody(response, { timeoutMs, maxBytes: MAX_FEED_BYTES });
      let inhoud = tekst;
      if (feed.soort === "squarespace") { try { inhoud = JSON.parse(tekst); } catch { throw Object.assign(new Error("json"), { code: "invalid_json" }); } }
      const leeg = feedFout(feed, inhoud);
      if (leeg) fouten.push(`feed ${feed.id}: ${leeg}`);
      uit.push(...kandidatenUitFeed(feed, inhoud, opties));
    } catch (error) {
      fouten.push(`feed ${feed.id}: ${code(error, "fout")}`);
    }
  }));
  return { kandidaten: uit, fouten };
}

// ---------- agendabronnen die de verversing al ophaalde ----------

const BRONLABEL = {
  "district-kalender": "districtskalender van district Antwerpen", "district-nieuws": "nieuws van district Antwerpen",
  "stad-districten": "nieuws van het district", "stad-uit": "UiTinVlaanderen", "district-gipod-evenementen": "GIPOD",
  "mail-district": "nieuwsbrief van het district", "mail-stad": "nieuwsbrief van de stad",
};
export function kandidatenUitBronnen(rootDir, { puntVan = () => null } = {}) {
  const dir = path.join(rootDir, "site", "sources");
  const uit = [];
  for (const [bron, bronLabel] of Object.entries(BRONLABEL)) {
    const doc = leesJson(path.join(dir, `${bron}.json`));
    for (const item of doc?.items || []) {
      const k = kandidaatUitAgenda(item, { bronLabel, puntVan });
      if (k) uit.push(k);
    }
  }
  return uit;
}
export function geocodeOpzoeker(rootDir) {
  const geo = leesJson(path.join(rootDir, "site", "geo", "locaties.json"));
  return (locatie) => geo?.entries?.[locationKey(locatie)] || null;
}

// ---------- straten bij een punt ----------

// In district Antwerpen: de straatas die de site ook gebruikt. Daarbuiten: één kleine vraag per punt
// aan dezelfde straatas, bewaard in de cache (een punt verandert niet van straat).
export async function straatBijPuntOnline(fetchImpl, p) {
  const url = new URL(STRAATAS);
  const pad = 0.0005;
  url.search = new URLSearchParams({
    where: "1=1", geometry: [p[0] - pad, p[1] - pad, p[0] + pad, p[1] + pad].join(","), geometryType: "esriGeometryEnvelope", inSR: "4326",
    spatialRel: "esriSpatialRelIntersects", outFields: "LSTRNM,RSTRNM", returnGeometry: "true", outSR: "4326", f: "geojson",
  });
  const data = await getJson(fetchImpl, url, { timeoutMs: 10_000 });
  let best = null;
  for (const f of data.features || []) {
    const naam = clean(f.properties?.LSTRNM || f.properties?.RSTRNM, 120);
    const lijnen = f.geometry?.type === "LineString" ? [f.geometry.coordinates] : f.geometry?.type === "MultiLineString" ? f.geometry.coordinates : [];
    for (const l of lijnen) for (const q of l) { const m = meterTussen(p, q); if (naam && (!best || m < best.m)) best = { naam, m }; }
  }
  return best && best.m <= 60 ? best.naam : "";
}
const puntSleutel = (p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;

// ---------- alles samen ----------

// tot: een pagina over één evenement heeft na die dag geen nut meer en wordt niet meer gevraagd.
function leesRegister(rootDir, vandaag = "") {
  const doc = leesJson(path.join(rootDir, "lib", "organisator-feeds.json"));
  return (doc?.feeds || []).filter((f) => f?.id && /^https:\/\//.test(f.url || "") && ["ics", "squarespace", "jsonld"].includes(f.soort) && !(f.tot && vandaag && f.tot < vandaag));
}
function leesWijken(rootDir) {
  const doc = leesJson(path.join(rootDir, "site", "geo", "wijken.geo.json"));
  return (doc?.features || []).map((f) => clean(f?.properties?.naam, 80)).filter(Boolean);
}
function leesDistricten(rootDir) {
  const doc = leesJson(path.join(rootDir, "lib", "districten-antwerpen.geojson"));
  return (doc?.features || []).map((f) => ({ naam: clean(f.properties?.naam, 60), geometry: f.geometry })).filter((d) => d.naam && d.geometry);
}
// Taken binnen een tijdsbudget, een paar tegelijk. Een haperende server krijgt rust: bij 429 of 503,
// of na MAX_FOUTEN_OP_RIJ fouten op rij, stopt de reeks (de rest volgt bij de volgende verversing).
async function metBudget(taken, werk, { budgetMs, now, gelijktijdig = GELIJKTIJDIG }) {
  const einde = now() + budgetMs;
  let i = 0, opRij = 0, gestopt = "";
  const klaar = new Set();
  await Promise.all(Array.from({ length: gelijktijdig }, async () => {
    while (i < taken.length && now() < einde && !gestopt) {
      const t = taken[i++];
      try { await werk(t); klaar.add(t); opRij = 0; } catch (error) {
        opRij += 1;
        const c = code(error, "fout");
        if (/^http_(?:429|503)$/.test(c)) gestopt = c;
        else if (opRij >= MAX_FOUTEN_OP_RIJ) gestopt = `${opRij}_fouten_op_rij`;
      }
    }
  }));
  return { klaar: klaar.size, overgeslagen: taken.length - klaar.size, gestopt };
}

export async function herkenParcours({
  rootDir, fetch: fetchImpl = globalThis.fetch, clock = () => new Date(), log = console.log, now = () => Date.now(),
  historiekBudgetMs = HISTORIEK_BUDGET_MS, streetFeatures = null,
} = {}) {
  const begin = now();
  const dir = path.join(rootDir, "site", "sources");
  const autoFile = path.join(dir, HERKENNING_FILE), patroonFile = path.join(dir, PATRONEN_FILE);
  try {
    const generated = clock();
    const vandaag = brusselsDate(generated);
    const hand = leesJson(path.join(dir, EVENEMENT_IDENTITEIT_FILE));
    const vorigePatronen = leesJson(patroonFile);
    const charter = leesJson(path.join(rootDir, "lib", "studentencharter.json"));
    const vorigeAuto = leesJson(autoFile);
    const districten = leesDistricten(rootDir);
    const districtGrens = leesJson(path.join(rootDir, "lib", "district-antwerpen-grens.geojson"))?.features?.[0]?.geometry || null;
    const fouten = [];

    // 0. Invoer: de dossiers zelf. Zonder A-Sign geen nieuwe fiches: de vorige blijven staan.
    const features = await haalDossiers(fetchImpl, vandaag);
    const ruw = dossiersUitAsign(features);
    // Een plotse krimp (een leeg antwoord van A-Sign) wist de vorige fiches en de cache niet. Blijft het
    // zo langer dan KRIMP_DAGEN, dan is het echt en gaat de verversing gewoon door.
    const vorigAantal = Number(vorigeAuto?.samenvatting?.dossiers) || 0;
    const vorigDag = /^\d{4}-\d{2}-\d{2}$/.test(vorigeAuto?.bijgewerkt || "") ? vorigeAuto.bijgewerkt : "";
    if (vorigAantal >= 20 && ruw.size < vorigAantal / 2 && vorigDag && dagenTussen(vorigDag, vandaag) <= KRIMP_DAGEN) {
      throw Object.assign(new Error(`A-Sign gaf ${ruw.size} dossiers, vorige keer ${vorigAantal}`), { code: "asign_krimp" });
    }

    // Straten: de straatas van district Antwerpen (zoals de kaartjes), daarbuiten de cache of een vraag.
    let index = null;
    let straatasFout = "";
    try {
      const metUa = (url, init = {}) => fetchImpl(url, { ...init, headers: { ...(init.headers || {}), "user-agent": USER_AGENT } });
      const sf = streetFeatures || await fetchStreetFeatures({ fetchImpl: metUa });
      index = buildStreetIndex(sf);
    } catch (error) { fouten.push(`straatas: ${code(error, "fout")}`); straatasFout = straatasFoutCode(error); }
    const oudeStraten = vorigePatronen?.cache?.straten || {};
    const straten = {};
    const nodig = [];
    const straatBij = (p) => {
      if (!Array.isArray(p)) return "";
      if (index) {
        // Eerst streng (binnen 40 m, niet op een kruispunt), dan de dichtste straat binnen 80 m.
        const r = resolvePointStreet(p, index, { maxDistanceMeters: 40, ambiguityMeters: 4 });
        if (r.streets[0]?.name) return r.streets[0].name;
        const ruim = resolvePointStreet(p, index, { maxDistanceMeters: 80, ambiguityMeters: 0 });
        if (ruim.streets[0]?.name) return ruim.streets[0].name;
      }
      const k = puntSleutel(p);
      if (k in oudeStraten) { straten[k] = oudeStraten[k]; return oudeStraten[k]; }
      nodig.push(p);
      return "";
    };
    const postcodeBij = (p) => (index && Array.isArray(p) ? resolvePointStreet(p, index, { maxDistanceMeters: 40, ambiguityMeters: 4 }).streets[0]?.postcode || "" : "");
    const stratenLangs = (lijnen) => (index ? stratenLangsLijn(lijnen, index) : []);
    const wijkVan = wijkVanUitGeo(rootDir);
    const opties = { straatBij, postcodeBij, stratenLangs, wijkVan, districten, districtGrens };
    let dossiers = [...ruw.values()].map((d) => verrijk(d, opties));
    // Straten buiten district Antwerpen die nog niet in de cache staan: kort opzoeken, dan opnieuw verrijken.
    const uniekeNodig = [...new Map(nodig.map((p) => [puntSleutel(p), p])).values()].slice(0, 80);
    if (uniekeNodig.length) {
      await metBudget(uniekeNodig, async (p) => { oudeStraten[puntSleutel(p)] = await straatBijPuntOnline(fetchImpl, p); }, { budgetMs: 15_000, now });
      dossiers = [...ruw.values()].map((d) => verrijk(d, opties));
    }

    // Kandidaten: agendabronnen (al opgehaald), GIPOD van buurgemeenten, organisatoren.
    const puntVan = geocodeOpzoeker(rootDir);
    const kandidaten = kandidatenUitBronnen(rootDir, { puntVan });
    try { kandidaten.push(...await haalGipodBuren(fetchImpl, vandaag)); } catch (error) { fouten.push(`gipod: ${code(error, "fout")}`); }
    const feeds = await haalFeeds(fetchImpl, leesRegister(rootDir, vandaag), { vandaag, puntVan });
    kandidaten.push(...feeds.kandidaten);
    fouten.push(...feeds.fouten);

    // Oudere dossiers op dezelfde plek: alleen voor nieuwe of gewijzigde dossiers zonder handfiche.
    const oudeHistoriek = vorigePatronen?.cache?.historiek || {};
    const historiekCache = {};
    const historiek = {};
    const handDossiers = hand?.dossiers || {};
    const sleutelVan = (d) => `${d.bijgewerkt}|${d.dag.start}|${d.vorm.lengte}|${(d.vorm.bbox || []).map((x) => x.toFixed(4)).join(",")}`;
    const taken = [];
    for (const d of dossiers) {
      if (handDossiers[d.dossier]) continue;
      const oud = oudeHistoriek[d.dossier];
      if (oud && Array.isArray(oud.items)) { historiek[d.dossier] = oud.items; historiekCache[d.dossier] = oud; }
      // Gewijzigd dossier: opnieuw vragen, maar tot dat lukt blijft het oude antwoord gelden (met de oude
      // sleutel, zodat het de volgende keer opnieuw gevraagd wordt). Zo flappert een fiche niet.
      if (!oud || oud.sleutel !== sleutelVan(d)) taken.push(d);
    }
    const resterend = Math.max(5_000, Math.min(historiekBudgetMs, HERKENNING_BUDGET_MS - 20_000 - (now() - begin)));
    const hist = await metBudget(taken, async (d) => {
      // Alleen oude dossiers met een trefwoord tellen voor de regels; de rest hoeft niet bewaard.
      const items = vatHistoriekSamen(d, await haalHistoriek(fetchImpl, d)).filter((h) => h.soorten.length);
      historiek[d.dossier] = items;
      historiekCache[d.dossier] = { sleutel: sleutelVan(d), items };
    }, { budgetMs: resterend, now });
    if (hist.overgeslagen) fouten.push(`historiek: ${hist.overgeslagen} dossiers volgende keer${hist.gestopt ? ` (gestopt: ${hist.gestopt})` : ""}`);

    const doc = bouwHerkenning({
      dossiers, hand, bibliotheek: bibliotheekUit(vorigePatronen), kandidaten, historiek, charter, vandaag,
      generatedAt: generated.toISOString(), bronFouten: fouten, gebiedNamen: leesWijken(rootDir),
    });
    // Eén fiche die niet door de validatie of de privacyscan raakt (een titel met een @ of een
    // telefoonnummer), wordt een fiche met alleen de kaartzin; de rest blijft.
    for (const [id, r] of Object.entries(doc.dossiers)) {
      const enkel = [...validateHerkenning({ ...doc, dossiers: { [id]: r } }), ...privacyFindings(r).map((f) => `privacy ${f.code}`)];
      if (!enkel.length) continue;
      const veilig = alleenKaartzin(r);
      if (privacyFindings(veilig).length) delete doc.dossiers[id];
      else doc.dossiers[id] = veilig;
      fouten.push(`fiche ${id}: ${enkel[0].slice(0, 80)}`);
    }
    const patronen = bijwerkenPatronen(vorigePatronen, { dossiers, hand, auto: doc, vandaag });
    for (const [k, v] of Object.entries(oudeStraten)) if (v && !(k in straten) && uniekeNodig.some((p) => puntSleutel(p) === k)) straten[k] = v;
    // Ook "geen straat" blijft bewaard, zodat hetzelfde punt niet elke verversing opnieuw gevraagd wordt.
    patronen.cache = { historiek: Object.fromEntries(Object.entries(historiekCache).sort((a, b) => a[0].localeCompare(b[0]))), straten: Object.fromEntries(Object.entries(straten).sort()) };
    // Eén slecht patroon of cache-item (ook een oud, uit het vorige bestand) valt weg; de rest blijft.
    fouten.push(...zonderSlechtePatronen(patronen));
    doc.samenvatting = herteld(doc, fouten);
    const fout = validateHerkenning(doc);
    if (fout.length) throw Object.assign(new Error(fout[0]), { code: "ongeldig" });
    const foutP = validatePatronen(patronen);
    if (foutP.length) throw Object.assign(new Error(foutP[0]), { code: "patronen_ongeldig" });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(autoFile, serialiseerRegels(doc, "dossiers"), "utf8");
    fs.writeFileSync(patroonFile, serialiseerRegels(patronen, "patronen"), "utf8");
    log(JSON.stringify({ parcoursHerkenning: doc.samenvatting, kandidaten: kandidaten.length, historiekOpgehaald: hist.klaar, seconden: Math.round((now() - begin) / 100) / 10 }));
    // Evenementdossiers als agendapunten (pakket P2, lib/asign-evenementen-agenda.mjs): dezelfde
    // dossiers, de handfiches en de fiches van deze ronde. Gooit nooit: zonder straatas, bij een fout of
    // bij een plotse krimp blijft het vorige bestand staan en staat de fout in refresh-status.json.
    schrijfAsignEvenementen({ rootDir, dossiers, index, straatasFout, grens: districtGrens, hand, auto: doc, vandaag, generatedAt: generated.toISOString(), puntVan, log });
    return doc;
  } catch (error) {
    // Zonder herkenning ook geen nieuwe agendapunten uit de dossiers: de bron houdt haar vorige stand en
    // meldt de fout in refresh-status.json (een 503 van A-Sign is tijdelijk, een krimp van A-Sign niet).
    const fout = code(error, "fout").replace(/[^a-z0-9_]/g, "_").slice(0, 60);
    asignEvenementenNietBijgewerkt({ rootDir, errorCode: /^[a-z0-9_]{1,60}$/.test(fout) ? fout : "unexpected_error", log });
    log(JSON.stringify({ parcoursHerkenning: "niet bijgewerkt", errorCode: code(error, "fout"), detail: clean(error?.message, 120) }));
    return null;
  }
}

export function zonderSlechtePatronen(patronen) {
  const weg = [];
  const leeg = { schemaVersion: patronen.schemaVersion, bijgewerkt: patronen.bijgewerkt, patronen: {} };
  for (const [id, p] of Object.entries(patronen.patronen || {})) {
    const fout = [...validatePatronen({ ...leeg, patronen: { [id]: p } }), ...privacyFindings(p).map((f) => `privacy ${f.code}`)];
    if (fout.length) { delete patronen.patronen[id]; weg.push(`patroon ${id}: ${fout[0].slice(0, 80)}`); }
  }
  for (const soort of ["historiek", "straten"]) {
    for (const [k, v] of Object.entries(patronen.cache?.[soort] || {})) {
      const fout = [...validatePatronen({ ...leeg, cache: { historiek: {}, straten: {}, [soort]: { [k]: v } } }), ...privacyFindings(v)];
      if (fout.length) { delete patronen.cache[soort][k]; weg.push(`cache ${soort} ${k.slice(0, 20)}: weg`); }
    }
  }
  return weg;
}

function herteld(doc, fouten) {
  const rows = Object.values(doc.dossiers);
  const tel = (z) => rows.filter((r) => r.zekerheid === z).length;
  return {
    ...doc.samenvatting, automatisch: rows.length, zeker: tel("zeker"), waarschijnlijk: tel("waarschijnlijk"), alleenKaartzin: tel("onbekend"),
    perMethode: Object.fromEntries(METHODES.map((m) => [m, rows.filter((r) => r.methode === m).length])),
    bronFouten: [...new Set(fouten)].slice(0, 20),
  };
}

// Eén regel per dossier of patroon: klein, en een diff per dossier. Elke fiche draagt wel de dag van de
// verversing (bijgewerkt en de stand in de kaartzin), dus elke regel verandert elke dag: bewust, want de
// kaart zegt op welke dag de stand in A-Sign nagekeken is.
export function serialiseerRegels(doc, sleutel) {
  const kop = Object.entries(doc).filter(([k]) => k !== sleutel && k !== "cache").map(([k, v]) => ` ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  const blok = (obj) => {
    const rows = Object.entries(obj || {}).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
    return rows.length ? `{\n${rows.join(",\n")}\n }` : "{}";
  };
  const delen = [...kop, ` ${JSON.stringify(sleutel)}: ${blok(doc[sleutel])}`];
  if (doc.cache) delen.push(` "cache": {\n  "historiek": ${blok(doc.cache.historiek).replace(/\n/g, "\n ")},\n  "straten": ${JSON.stringify(doc.cache.straten || {})}\n }`);
  return `{\n${delen.join(",\n")}\n}\n`;
}
