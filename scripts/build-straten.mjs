// Haalt de officiële straatnamen van district Antwerpen op (wegenregister/straatas van stad Antwerpen)
// en schrijft een compacte lijst naar site/geo/straten.json: per straat het officiële id, de naam, de
// postcode, de wijk(en) waar ze doorloopt en een omhullend kader voor de kaart. De zoekbalk gebruikt
// die lijst voor suggesties zonder eerst 6.000 straatsegmenten live te moeten laden.
//
// Draait alleen met de hand (`npm run geo:straten`): straatnamen veranderen zelden en `npm run check`
// mag geen netwerk gebruiken. Geen persoonsgegevens: alleen straatnamen, postcodes en coördinaten.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fetchStreetFeatures } from "../site/street-source.js";
import { buildStreetIndex } from "../site/street-core.js";
import { wijkFeatures, wijkOf } from "../site/neighborhood-core.js";

const round = (value) => Math.round(value * 100000) / 100000;

// Pure omzetting, ook gebruikt in de toetsen: straatas-index + wijken → compacte straatlijst.
export function buildStreetList(index, wijken) {
  const byKey = new Map();
  for (const segment of index?.segments || []) {
    const mid = [(segment.a[0] + segment.b[0]) / 2, (segment.a[1] + segment.b[1]) / 2];
    const wijk = wijkOf(mid, wijken);
    for (const ref of segment.refs || []) {
      if (!ref?.name) continue;
      const key = `${ref.id}|${ref.name}|${ref.postcode}`;
      const row = byKey.get(key) || { id: String(ref.id || ""), name: ref.name, postcode: String(ref.postcode || ""), wijken: new Map(), box: null };
      if (wijk) row.wijken.set(wijk, (row.wijken.get(wijk) || 0) + 1);
      for (const [x, y] of [segment.a, segment.b]) {
        row.box = row.box ? [Math.min(row.box[0], x), Math.min(row.box[1], y), Math.max(row.box[2], x), Math.max(row.box[3], y)] : [x, y, x, y];
      }
      byKey.set(key, row);
    }
  }
  return [...byKey.values()]
    .filter((row) => row.box)
    .map((row) => [
      row.id,
      row.name,
      row.postcode,
      // Meest doorlopen wijk eerst: die tonen we als "wijk" bij de straat.
      [...row.wijken.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([code]) => code),
      row.box.map(round),
    ])
    .sort((a, b) => a[1].localeCompare(b[1], "nl") || a[2].localeCompare(b[2]) || a[0].localeCompare(b[0]));
}

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const wijkDoc = JSON.parse(fs.readFileSync(path.join(rootDir, "site", "geo", "wijken.geo.json"), "utf8"));
  const wijken = wijkFeatures(wijkDoc).filter((f) => f.properties.code.startsWith("ANT"));
  const index = buildStreetIndex(await fetchStreetFeatures());
  const streets = buildStreetList(index, wijken);
  if (streets.length < 800) throw new Error(`onverwacht weinig straten: ${streets.length}`);
  const doc = {
    schemaVersion: 1,
    metadata: {
      title: "Straatnamen van district Antwerpen",
      source: "Stad Antwerpen, straatas (wegenregister), geodata.antwerpen.be",
      sourceUrl: "https://geodata.antwerpen.be/arcgissql/rest/services/P_Portal/portal_publiek9/MapServer/905",
      license: "Open data stad Antwerpen, gratis hergebruik met bronvermelding (Vlaamse open data licentie)",
      retrievedOn: new Date().toISOString().slice(0, 10),
      fields: ["id", "naam", "postcode", "wijken", "kader [minLon, minLat, maxLon, maxLat]"],
    },
    streets,
  };
  const file = path.join(rootDir, "site", "geo", "straten.json");
  fs.writeFileSync(file, `${JSON.stringify(doc)}\n`);
  console.log(`straten: ${streets.length} geschreven naar ${path.relative(rootDir, file)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
