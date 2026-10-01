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
  updateHistoryArchiveBaseline,
  updateHistoryArchiveDay,
  updateHistoryArchiveIndex,
  validateHistoryArchiveBaseline,
  validateHistoryArchiveDay,
  validateHistoryArchiveIndex,
} from "../lib/live-history-archive.mjs";
import { applyPublicSpaceStreetResolution, applyWorkStreetResolution, buildStreetIndex } from "../lib/street-resolver.mjs";
import { fetchStreetFeatures } from "../site/street-source.js";
import { collectPublicSpace } from "../site/public-space-live-core.js";
import { worksExactSnapshot } from "../site/works-snapshot.js";
import { attachHindrance } from "../site/works-hindrance.js";
import { collectWorks } from "../site/works-core.js";

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

async function asignLayer(layer, { where, outFields, geometry = false, spatial = false }, fetchImpl) {
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
  for (let offset = 0; offset < ids.length; offset += 500) {
    const url = new URL(`${ASIGN_BASE}/${layer}/query`);
    url.search = new URLSearchParams({
      f: "json",
      objectIds: ids.slice(offset, offset + 500).join(","),
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
        outFields: "Dossiernummer,Locatienummer,Status,Adres,Reden,Startdatum,Einddatum,EnkelWeekdagen,GipodID,District",
      }, fetchImpl),
      asignLayer(22, {
        where: `faseEindDatum >= ${dateSql} AND dossierStatus IN ('aanvraag_goedgekeurd','toelating_gegenereerd','toelating_geverifieerd')`,
        outFields: "dossierNummer,faseId,innameId,dossierStatus,faseNaam,innameTypeNaam,faseStartDatum,faseEindDatum",
        geometry: true,
        spatial: true,
      }, fetchImpl),
      asignLayer(23, {
        where: `faseEindDatum >= ${dateSql} AND dossierStatus IN ('aanvraag_goedgekeurd','toelating_gegenereerd','toelating_geverifieerd')`,
        outFields: "dossierNummer,faseId,innameId,dossierStatus,faseNaam,innameTypeNaam,faseStartDatum,faseEindDatum",
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
    });
    return { ok: true, items: applyPublicSpaceStreetResolution(items, streets) };
  } catch (error) {
    return { ok: false, items: [], errorCode: errorCode(error, "public_space_fetch_failed") };
  }
}

export async function refreshLiveHistory({
  fetch: fetchImpl = globalThis.fetch,
  clock = () => new Date(),
  rootDir,
  log = console.log,
} = {}) {
  const observedAt = clock().toISOString();
  const file = path.join(rootDir, "site", "history", "live-layers.json");
  let previous = null;
  if (fs.existsSync(file)) {
    previous = JSON.parse(fs.readFileSync(file, "utf8"));
    const previousErrors = validateLiveHistory(previous);
    if (previousErrors.length) throw new Error(`bestaande live historiek ongeldig: ${previousErrors[0]}`);
  }
  let streets; let streetErrorCode=null; try{streets=await streetIndex(fetchImpl)}catch(error){streetErrorCode=errorCode(error,"street_axis_fetch_failed")} const [worksResult,publicSpaceResult]=streetErrorCode?[{ok:false,items:[],errorCode:streetErrorCode},{ok:false,items:[],errorCode:streetErrorCode}]:await Promise.all([fetchWorksHistory({fetch:fetchImpl,streets}),fetchPublicSpaceHistory({fetch:fetchImpl,clock,streets})]);
  const history = updateLiveHistory(previous, { observedAt, worksResult, publicSpaceResult });
  const errors = validateLiveHistory(history);
  if (errors.length) throw new Error(`live historiek ongeldig: ${errors[0]}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(history, null, 2)}\n`, "utf8");

  const archiveBaselineFile = path.join(rootDir, LIVE_HISTORY_ARCHIVE_BASELINE_FILE);
  const archiveIndexFile = path.join(rootDir, LIVE_HISTORY_ARCHIVE_INDEX_FILE);
  const archiveDayPath = historyArchiveDayFile(historyArchiveDay(observedAt));
  const archiveDayFile = path.join(rootDir, archiveDayPath);
  const readJsonIfPresent = (target) => fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, "utf8")) : null;

  const previousBaseline = readJsonIfPresent(archiveBaselineFile);
  const previousIndex = readJsonIfPresent(archiveIndexFile);
  const previousDay = readJsonIfPresent(archiveDayFile);
  const baseline = updateHistoryArchiveBaseline(previousBaseline, history);
  const dayDocument = updateHistoryArchiveDay(
    previousDay,
    observedAt,
    historyArchiveEventsForRun(history, baseline)
  );
  const archiveIndex = updateHistoryArchiveIndex(previousIndex, { observedAt, baseline, dayDocument });
  const archiveErrors = [
    ...validateHistoryArchiveBaseline(baseline),
    ...validateHistoryArchiveDay(dayDocument),
    ...validateHistoryArchiveIndex(archiveIndex),
  ];
  if (archiveErrors.length) throw new Error(`live historiekarchief ongeldig: ${archiveErrors[0]}`);

  fs.mkdirSync(path.dirname(archiveBaselineFile), { recursive: true });
  fs.writeFileSync(archiveBaselineFile, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  fs.writeFileSync(archiveIndexFile, `${JSON.stringify(archiveIndex, null, 2)}\n`, "utf8");
  if (dayDocument.events.length > 0 || previousDay) {
    fs.writeFileSync(archiveDayFile, `${JSON.stringify(dayDocument, null, 2)}\n`, "utf8");
  }

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
