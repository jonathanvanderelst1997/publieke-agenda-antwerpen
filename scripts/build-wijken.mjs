// Haalt de officiële wijkindeling van stad Antwerpen op en schrijft een vereenvoudigde kopie naar
// site/geo/wijken.geo.json. Draait alleen met de hand (`node scripts/build-wijken.mjs`): wijkgrenzen
// veranderen zelden en `npm run check` mag geen netwerk gebruiken.
//
// Bron: stad Antwerpen, laag "wijken_omgevingsinformatie" (geodata.antwerpen.be, P_Portal/portal_publiek2,
// laag 97): 67 wijken, elk een verzameling statistische sectoren, zoveel mogelijk afgestemd op de wijken
// van het stedelijk wijkoverleg. Open data van stad Antwerpen (Vlaamse open data, gratis hergebruik met
// bronvermelding). Vereenvoudigd door de ArcGIS-server zelf (maxAllowableOffset 0,00005°, ±4 m) en
// afgerond op 5 decimalen: genoeg voor een buurtkaart, niet voor kadastrale grenzen.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const WIJKEN_URL = "https://geodata.antwerpen.be/arcgissql/rest/services/P_Portal/portal_publiek2/MapServer/97/query";
const DISTRICTS = { ANT: "Antwerpen", BER: "Berchem", BEZ: "Berendrecht-Zandvliet-Lillo", BOR: "Borgerhout", DEU: "Deurne", EKE: "Ekeren", HOB: "Hoboken", MER: "Merksem", WIL: "Wilrijk", SCH: "" };

export function normalizeWijk(feature) {
  const code = String(feature?.properties?.wijkcode || "").trim();
  const full = String(feature?.properties?.wijknaam || "").replace(/\s+/g, " ").trim();
  if (!/^[A-Z]{3}\d{2}$/.test(code) || !full) return null;
  const [prefix, ...rest] = full.split(" - ");
  const naam = rest.length ? rest.join(" - ") : full;
  // BOR04–BOR06 zijn Borsbeek (district sinds 2025), niet Borgerhout.
  const district = code.startsWith("BOR") && /^Borsbeek/i.test(prefix) ? "Borsbeek" : DISTRICTS[code.slice(0, 3)] ?? prefix;
  return { type: "Feature", properties: { code, naam: naam.charAt(0).toUpperCase() + naam.slice(1), district }, geometry: feature.geometry };
}

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const url = new URL(WIJKEN_URL);
  url.search = new URLSearchParams({ where: "1=1", outFields: "wijknaam,wijkcode", returnGeometry: "true", outSR: "4326", maxAllowableOffset: "0.00005", geometryPrecision: "5", f: "geojson" });
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`wijken HTTP ${response.status}`);
  const data = await response.json();
  const features = (data.features || []).map(normalizeWijk).filter(Boolean).sort((a, b) => a.properties.code.localeCompare(b.properties.code));
  if (features.length < 60) throw new Error(`onverwacht weinig wijken: ${features.length}`);
  const doc = {
    type: "FeatureCollection",
    metadata: {
      title: "Wijken van stad Antwerpen (vereenvoudigd)",
      source: "Stad Antwerpen, wijken_omgevingsinformatie (geodata.antwerpen.be)",
      sourceUrl: "https://geodata.antwerpen.be/arcgissql/rest/services/P_Portal/portal_publiek2/MapServer/97",
      license: "Open data stad Antwerpen, gratis hergebruik met bronvermelding (Vlaamse open data licentie)",
      retrievedOn: new Date().toISOString().slice(0, 10),
      simplification: "maxAllowableOffset 0.00005 graden, 5 decimalen",
    },
    features,
  };
  const file = path.join(rootDir, "site", "geo", "wijken.geo.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(doc)}\n`);
  console.log(`wijken: ${features.length} geschreven naar ${path.relative(rootDir, file)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
