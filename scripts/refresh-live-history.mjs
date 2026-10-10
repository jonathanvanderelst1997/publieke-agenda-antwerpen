import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { brusselsDate } from "../lib/html-text.mjs";
import { updateLiveHistory, validateLiveHistory } from "../lib/live-history.mjs";
import {
  LIVE_HISTORY_ARCHIVE_BASELINE_FILE,
  LIVE_HISTORY_ARCHIVE_INDEX_FILE,
  historyArchiveDay,
  historyArchiveDayFile,
  historyArchiveEventsForRun,
  isHistoryArchiveDayFileName,
  scrubHistoryArchiveDay,
  updateHistoryArchiveBaseline,
  updateHistoryArchiveDay,
  updateHistoryArchiveIndex,
  updateHistoryArchiveIndexDay,
  validateHistoryArchiveBaseline,
  validateHistoryArchiveDay,
  validateHistoryArchiveIndex,
} from "../lib/live-history-archive.mjs";
import { applyPublicSpaceStreetResolution, applyWorkStreetResolution, buildStreetIndex } from "../lib/street-resolver.mjs";
import { fetchStreetFeatures } from "../site/street-source.js";
import { collectPublicSpace } from "../site/public-space-live-core.js";
import { worksExactSnapshot } from "../site/works-snapshot.js";
import { schrijfKaartUitleg } from "../lib/kaart-uitleg-refresh.mjs";
import { attachHindrance } from "../site/works-hindrance.js";
import { collectWorks } from "../site/works-core.js";
import { archiefBaselineVoorPubliek, archiefDagVoorPubliek, historiekVoorPubliek, resultaatVoorHistoriek } from "../lib/historiek-privacy.mjs";
import { opkuisHistoriekPrivacy } from "./opkuis-historiek-privacy.mjs";
import { verzamelStraatBronnen } from "./build-straat-snapshots.mjs";

const GIPOD_ORIGIN = "https://geo.api.vlaanderen.be";
const GIPOD_BBOX = "4.300791,51.175458,4.444331,51.313629";
const HINDRANCE_BBOX = "4.29,51.17,4.47,51.32";
const ASIGN_BASE = "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer";
const DISTRICT_URL = "https://geodata.antwerpen.be/arcgissql/rest/services/P_Portal/portal_publiek2/MapServer/109/query";

function errorCode(error, fallback) {
  const code = String(error?.code || "").toLowerCase();
  return /^[a-z0-9_:-]{2,80}$/.test(code) ? code : fallback;
}

async function getJson(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.code = `http_${response.status}`;
    throw error;
  }
  const json = await response.json();
  if (json?.error) {
    const error = new Error("provider error");
    error.code = "provider_error";
    throw error;
  }
  return json;
}

async function gipodCollection(collection, params, fetchImpl) {
  const first = new URL(`${GIPOD_ORIGIN}/GIPOD/ogc/features/v1/collections/${collection}/items`);
  first.search = new URLSearchParams(params);
  const features = [];
  const seen = new Set();
  let url = first.href;
  for (let page = 0; page < 20 && url; page += 1) {
    const parsed = new URL(url);
    if (
      parsed.origin !== GIPOD_ORIGIN ||
      parsed.pathname !== `/GIPOD/ogc/features/v1/collections/${collection}/items` ||
      seen.has(url)
    ) {
      const error = new Error("onverwachte paginering");
      error.code = "unexpected_pagination";
      throw error;
    }
    seen.add(url);
    const data = await getJson(url, fetchImpl);
    if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
      const error = new Error("ongeldige FeatureCollection");
      error.code = "invalid_feature_collection";
      throw error;
    }
    features.push(...data.features);
    const next = (data.links || []).filter((link) => link.rel === "next");
    if (next.length > 1) {
      const error = new Error("dubbele next");
      error.code = "duplicate_next";
      throw error;
    }
    url = next[0]?.href || "";
  }
  if (url) {
    const error = new Error("paginering veiligheidslimiet");
    error.code = "pagination_limit";
    throw error;
  }
  return features;
}

async function streetIndex(fetchImpl) {
  const features = await fetchStreetFeatures({ fetchImpl });
  const index = buildStreetIndex(features);
  index.features = features; // ook nodig voor de kaartjes (lib/kaart-uitleg-refresh.mjs)
  if (!index.segments.length) {
    const error = new Error("straatas leeg");
    error.code = "street_axis_empty";
    throw error;
  }
  return index;
}

async function districtGeometry(fetchImpl) {
  const url = new URL(DISTRICT_URL);
  url.search = new URLSearchParams({
    where: "districtnaam='ANTWERPEN'",
    outFields: "districtcode,districtnaam,afkorting",
    outSR: "4326",
    f: "geojson",
  });
  const data = await getJson(url, fetchImpl);
  const features = Array.isArray(data.features) ? data.features : [];
  if (features.length !== 1 || !features[0]?.geometry) {
    const error = new Error("districtsgrens niet uniek");
    error.code = "district_boundary_invalid";
    throw error;
  }
  return features[0].geometry;
}

export const ASIGN_DETAIL_BATCH_SIZE = 100;

export async function asignLayer(layer, { where, outFields, geometry = false, spatial = false }, fetchImpl) {
  const query = new URL(`${ASIGN_BASE}/${layer}/query`);
  const base = { where, f: "json" };
  if (spatial) {
    Object.assign(base, {
      geometry: GIPOD_BBOX,
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
    });
  }
  query.search = new URLSearchParams({ ...base, returnIdsOnly: "true" });
  const idData = await getJson(query, fetchImpl);
  const ids = Array.isArray(idData.objectIds) ? idData.objectIds : [];
  if (ids.length > 15_000) {
    const error = new Error("veiligheidslimiet");
    error.code = "record_limit";
    throw error;
  }
  const features = [];
  for (let offset = 0; offset < ids.length; offset += ASIGN_DETAIL_BATCH_SIZE) {
    const url = new URL(`${ASIGN_BASE}/${layer}/query`);
    url.search = new URLSearchParams({
      f: "json",
      objectIds: ids.slice(offset, offset + ASIGN_DETAIL_BATCH_SIZE).join(","),
      outFields,
      returnGeometry: String(geometry),
      outSR: "4326",
    });
    const data = await getJson(url, fetchImpl);
    if (!Array.isArray(data.features)) {
      const error = new Error("features ontbreken");
      error.code = "invalid_features";
      throw error;
    }
    features.push(...data.features);
  }
  return features;
}

export async function fetchWorksHistory({ fetch: fetchImpl = globalThis.fetch, streets } = {}) {
  try {
    const [features, district, hindrance] = await Promise.all([
      gipodCollection(
        "INNAME_PUNT",
        {
          limit: "500",
          bbox: GIPOD_BBOX,
          f: "json",
          "filter-lang": "cql2-text",
          filter: "Type IN ('Grondwerk','Werk') AND Status IN ('In uitvoering','Concreet gepland')",
        },
        fetchImpl
      ),
      districtGeometry(fetchImpl),
      gipodCollection(
        "HINDER_PUNT",
        {
          limit: "500",
          bbox: HINDRANCE_BBOX,
          f: "json",
          "filter-lang": "cql2-text",
          filter: "HindranceStatus = 'Gevalideerd'",
        },
        fetchImpl
      ),
    ]);
    const exactIds = new Set(worksExactSnapshot.exactGipodIds);
    const items = applyWorkStreetResolution(attachHindrance(collectWorks(features, exactIds, district), hindrance, true), streets);
    return { ok: true, items };
  } catch (error) {
    return { ok: false, items: [], errorCode: errorCode(error, "works_fetch_failed") };
  }
}

export async function fetchPublicSpaceHistory({ fetch: fetchImpl = globalThis.fetch, clock = () => new Date(), streets } = {}) {
  const dateSql = `DATE '${brusselsDate(clock())}'`;
  try {
    const [parking, iod22, iod23, sgw47, sgw48, district] = await Promise.all([
      asignLayer(20, {
        where: `District='ANTWERPEN' AND Einddatum >= ${dateSql} AND Status IN ('Goedgekeurd','In effect')`,
        // Postcode en uren: niet voor de historiek (lib/live-history.mjs bewaart ze niet), wel voor de
        // straatbestanden (scripts/build-straat-snapshots.mjs), zoals de browser ze ophaalt.
        outFields: "Dossiernummer,Locatienummer,Status,Adres,Postcode,Reden,Startdatum,Einddatum,Starttijd,Eindtijd,EnkelWeekdagen,GipodID,District",
        // De lijn van elk parkeerverbod: alleen voor het kader van een straatbestand (waar haar items liggen).
        geometry: true,
      }, fetchImpl),
      asignLayer(22, {
        where: `faseEindDatum >= ${dateSql} AND dossierStatus IN ('aanvraag_goedgekeurd','toelating_gegenereerd','toelating_geverifieerd')`,
        outFields: "dossierNummer,faseId,innameId,dossierStatus,faseNaam,innameTypeNaam,innameBeschrijving,faseStartDatum,faseEindDatum",
        geometry: true,
        spatial: true,
      }, fetchImpl),
      asignLayer(23, {
        where: `faseEindDatum >= ${dateSql} AND dossierStatus IN ('aanvraag_goedgekeurd','toelating_gegenereerd','toelating_geverifieerd')`,
        outFields: "dossierNummer,faseId,innameId,dossierStatus,faseNaam,innameTypeNaam,innameBeschrijving,faseStartDatum,faseEindDatum",
        geometry: true,
        spatial: true,
      }, fetchImpl),
      asignLayer(47, {
        where: `EndDate >= ${dateSql} AND status='vergund'`,
        outFields: "reference_id,phase_id,status,StartDate,EndDate",
        geometry: true,
        spatial: true,
      }, fetchImpl),
      asignLayer(48, {
        where: `EndDate >= ${dateSql} AND status='vergund'`,
        outFields: "reference_id,phase_id,status,StartDate,EndDate",
        geometry: true,
        spatial: true,
      }, fetchImpl),
      districtGeometry(fetchImpl),
    ]);
    const sgw = [
      ...sgw47.map((feature) => ({ feature, kind: "Omleiding" })),
      ...sgw48.map((feature) => ({ feature, kind: "Werfzone" })),
    ];
    const items = collectPublicSpace({
      parkingFeatures: parking,
      iodFeatures: [...iod22, ...iod23],
      sgwFeatures: sgw,
      districtGeometry: district,
      // Officiële straatnamen, zodat "De 7 schakenpad" niet als huisnummer wegvalt (site/adres-privacy.js).
      straatnamen: streets?.byName instanceof Map ? [...streets.byName.values()].flat().map((ref) => ref?.name).filter(Boolean) : null,
    });
    // De ruwe features gaan mee voor de straatbestanden (verzamelStraatBronnen); ze komen nooit in de historiek.
    return { ok: true, items: applyPublicSpaceStreetResolution(items, streets), iodFeatures: [...iod22, ...iod23], district, features: { parking, iod: [...iod22, ...iod23], sgw } };
  } catch (error) {
    return { ok: false, items: [], errorCode: errorCode(error, "public_space_fetch_failed") };
  }
}

export async function refreshLiveHistory({
  fetch: fetchImpl = globalThis.fetch,
  // Voor de vergunningen en terrassen van de straatbestanden: een eigen tijdsgrens (refresh-fetch.mjs).
  // Zonder (zoals in de toetsen) worden ze niet opgehaald en houden de straatbestanden hun vorige stand.
  straatFetch = null,
  clock = () => new Date(),
  rootDir,
  log = console.log,
} = {}) {
  const observedAt = clock().toISOString();
  const file = path.join(rootDir, "site", "history", "live-layers.json");
  // Eerst de bestaande historiek opkuisen (geen huisnummers, alleen het district), ook oudere dagen
  // van het archief. Een schone historiek blijft ongemoeid; wat niet lukt, houdt de andere bestanden
  // niet tegen. Lukt het helemaal niet, dan gaat de verversing gewoon door; validate-data meldt dan
  // wat er nog opgekuist moet worden. De log toont alleen aantallen en het soort fout, nooit een stuk
  // van een bestand (de logs zijn publiek).
  try {
    const opkuis = opkuisHistoriekPrivacy({ rootDir, write: true, verwijderLeeg: false });
    const nietGeschreven = Object.keys(opkuis.nietGeschreven).length;
    const nogBevindingen = Object.values(opkuis.nogBevindingen).reduce((sum, aantal) => sum + aantal, 0);
    if (opkuis.gewijzigd.length || nietGeschreven || nogBevindingen) {
      log(JSON.stringify({ historiekOpkuis: { bestanden: opkuis.gewijzigd.length, nietGeschreven, nogBevindingen } }));
    }
  } catch (error) {
    log(JSON.stringify({ historiekOpkuis: "niet gelukt", soort: error?.name || "Error" }));
  }
  let previous = null;
  if (fs.existsSync(file)) {
    previous = JSON.parse(fs.readFileSync(file, "utf8"));
    const previousErrors = validateLiveHistory(previous);
    if (previousErrors.length) throw new Error(`bestaande live historiek ongeldig: ${previousErrors[0]}`);
  }
  let streets; let streetErrorCode=null; try{streets=await streetIndex(fetchImpl)}catch(error){streetErrorCode=errorCode(error,"street_axis_fetch_failed")} const [worksResult,publicSpaceResult]=streetErrorCode?[{ok:false,items:[],errorCode:streetErrorCode},{ok:false,items:[],errorCode:streetErrorCode}]:await Promise.all([fetchWorksHistory({fetch:fetchImpl,streets}),fetchPublicSpaceHistory({fetch:fetchImpl,clock,streets})]);
  // Privacy (lib/historiek-privacy.mjs): alleen district Antwerpen en geen huisnummers, vóór het
  // vergelijken en het schrijven. Ook de vorige stand, zodat er geen massa wijzigingen ontstaat.
  const worksVoorHistoriek = resultaatVoorHistoriek(worksResult);
  const publicSpaceVoorHistoriek = resultaatVoorHistoriek(publicSpaceResult);
  log(JSON.stringify({ historiekPrivacy: { parkeerverbodenBuitenDistrict: publicSpaceVoorHistoriek?.buitenDistrict ?? 0 } }));
  const history = updateLiveHistory(historiekVoorPubliek(previous), { observedAt, worksResult: worksVoorHistoriek, publicSpaceResult: publicSpaceVoorHistoriek });
  const errors = validateLiveHistory(history);
  if (errors.length) throw new Error(`live historiek ongeldig: ${errors[0]}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(history, null, 2)}\n`, "utf8");

  const archiveBaselineFile = path.join(rootDir, LIVE_HISTORY_ARCHIVE_BASELINE_FILE);
  const archiveIndexFile = path.join(rootDir, LIVE_HISTORY_ARCHIVE_INDEX_FILE);
  const archiveDayPath = historyArchiveDayFile(historyArchiveDay(observedAt));
  const archiveDayFile = path.join(rootDir, archiveDayPath);
  const readJsonIfPresent = (target) => fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, "utf8")) : null;

  const previousBaseline = archiefBaselineVoorPubliek(readJsonIfPresent(archiveBaselineFile));
  const previousIndex = readJsonIfPresent(archiveIndexFile);
  const previousDay = archiefDagVoorPubliek(readJsonIfPresent(archiveDayFile));
  const baseline = updateHistoryArchiveBaseline(previousBaseline, history);
  const dayDocument = updateHistoryArchiveDay(
    previousDay,
    observedAt,
    historyArchiveEventsForRun(history, baseline)
  );
  let archiveIndex = updateHistoryArchiveIndex(previousIndex, { observedAt, baseline, dayDocument });
  // Oudere dagen: parkeerverboden opkuisen (geen huisnummers, geen foute weekdagregel). Alleen een
  // dag die echt verandert, wordt herschreven; daarna is dit bij elke verversing een no-op.
  const archiveDir = path.dirname(archiveBaselineFile);
  const olderDays = [];
  for (const name of fs.existsSync(archiveDir) ? fs.readdirSync(archiveDir).sort() : []) {
    const target = path.join(archiveDir, name);
    if (!isHistoryArchiveDayFileName(name) || target === archiveDayFile) continue;
    // Een kapotte oudere dag houdt de verversing niet tegen: de opkuis hierboven meldt hem al als
    // aantal (nietGeschreven). De fout zelf komt nooit in de log: JSON.parse zet er een stuk van de
    // inhoud in, en de logs zijn publiek.
    let before;
    try { before = readJsonIfPresent(target); } catch { continue; }
    const after = scrubHistoryArchiveDay(before);
    if (after === before) continue;
    olderDays.push([target, after]);
    archiveIndex = updateHistoryArchiveIndexDay(archiveIndex, after);
  }
  const archiveErrors = [
    ...validateHistoryArchiveBaseline(baseline),
    ...validateHistoryArchiveDay(dayDocument),
    ...olderDays.flatMap(([, document]) => validateHistoryArchiveDay(document)),
    ...validateHistoryArchiveIndex(archiveIndex),
  ];
  if (archiveErrors.length) throw new Error(`live historiekarchief ongeldig: ${archiveErrors[0]}`);

  fs.mkdirSync(path.dirname(archiveBaselineFile), { recursive: true });
  fs.writeFileSync(archiveBaselineFile, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  fs.writeFileSync(archiveIndexFile, `${JSON.stringify(archiveIndex, null, 2)}\n`, "utf8");
  if (dayDocument.events.length > 0 || previousDay) {
    fs.writeFileSync(archiveDayFile, `${JSON.stringify(dayDocument, null, 2)}\n`, "utf8");
  }
  for (const [target, document] of olderDays) fs.writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, "utf8");

  await schrijfKaartUitleg({ rootDir, works: worksResult, publicSpace: publicSpaceResult, streetFeatures: streets?.features, fetch: fetchImpl, clock, log });

  // De items per straat zoals de browser ze maakt, plus vergunningen en terrassen, voor de straatbestanden
  // (scripts/build-straat-snapshots.mjs verdeelt ze op het einde van npm run refresh). Faalt dit, dan
  // houden de straatbestanden hun vorige stand.
  await verzamelStraatBronnen({ rootDir, observedAt, worksResult, publicSpaceResult, streetFeatures: streets?.features, fetch: straatFetch, log });

  // Bewust geen stap voor het Inzageloket (omgevingsloketinzage.omgeving.vlaanderen.be): robots.txt verbiedt
  // elke bot ("Disallow: /") en een Anubis-botcontrole staat voor elke pagina en voor de API. Die controle
  // omzeilen doen we niet. site/sources/inzage-status.json wordt met de hand bijgehouden (site/inzage-status.js).

  log(JSON.stringify({
    observedAt,
    worksStatus: history.layers.works.status,
    worksCount: history.layers.works.count,
    publicSpaceStatus: history.layers.publicSpace.status,
    publicSpaceCount: history.layers.publicSpace.count,
    changes: history.changes.filter((entry) => entry.observedAt === observedAt).length,
    archivedChanges: dayDocument.events.length,
  }));
  return history;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  refreshLiveHistory({ rootDir }).catch((error) => {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  });
}
