// Vult ontbrekende huisnummers aan uit de open data van de stad: `npm run refresh:huisnummers` (onderdeel van
// `npm run refresh`, na het ophalen van de bronnen en vóór build:sources). Zie lib/huisnummer-uit-bron.mjs.
//
// Leest de bronbestanden (site/sources) zoals build:sources ze leest, vóór het adres van een vaste plek, en zoekt voor
// elke komende activiteit in een gebouw zonder huisnummer de naam van de plek op in de open data van stad Antwerpen
// (geodata.antwerpen.be). Schrijft site/sources/huisnummers-auto.json; build:sources zet de adressen daarna achter de
// plek. Zonder zo'n activiteit: geen enkel verzoek. Faalt het lezen (een laag, robots.txt, een weigering), dan blijft
// het vorige bestand staan en eindigt het script toch met 0: een huisnummer is nooit een reden om de verversing te laten
// falen. `npm run check` gebruikt geen netwerk en leest alleen het bestand.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { errorCodeOf, isMainModule, serialize } from "../lib/fetch-util.mjs";
import { brusselsDate } from "../lib/html-text.mjs";
import { HUISNUMMERS_AUTO_FILE, leesOpenData, maakAutoDocument, teZoekenPlekken, validateHuisnummersAuto } from "../lib/huisnummer-uit-bron.mjs";
import { plaatsKennis } from "../lib/vaste-adressen.mjs";
import { bronDocumentenVoorAdres, laadTekstBronnen, readSources } from "./build-sources.mjs";

const leesJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

// De bronitems (met hun sourceId) zoals de feed ze leest, vóór het adres van een vaste plek. Handmatige items niet:
// build:sources zet een adres alleen bij bronitems.
export function bronItems(rootDir) {
  const sources = readSources(rootDir);
  const documenten = bronDocumentenVoorAdres(sources.documents, laadTekstBronnen(rootDir));
  return { items: documenten.flatMap((d) => d.items.map((item) => ({ ...item, sourceId: item.sourceId ?? d.sourceId }))), vasteAdressen: sources.vasteAdressen };
}

const zonderDatum = (doc) => JSON.stringify({ ...doc, bijgewerkt: null });

export async function vulHuisnummers({ rootDir, fetch: fetchImpl = globalThis.fetch, clock = () => new Date(), log = console.log, sleep, pauzeMs, adresLagen } = {}) {
  const vandaag = brusselsDate(clock());
  const file = path.join(rootDir, "site", "sources", HUISNUMMERS_AUTO_FILE);
  const vorige = leesJson(file);
  const geo = (naam) => leesJson(path.join(rootDir, "site", "geo", naam));
  const stratenStad = geo("straten-stad.json");
  const kennis = plaatsKennis({ straten: geo("straten.json"), stratenStad, wijken: geo("wijken.geo.json") });
  const { items, vasteAdressen } = bronItems(rootDir);
  const plekken = teZoekenPlekken(items, vandaag, { vasteAdressen, kennis, stratenStad });
  let gelezen = { adressen: [] };
  if (plekken.size) {
    try {
      gelezen = await leesOpenData({
        fetch: fetchImpl,
        ...(sleep ? { sleep } : {}),
        ...(Number.isFinite(pauzeMs) ? { pauzeMs } : {}),
        ...(adresLagen ? { adresLagen } : {}),
      });
    } catch (error) {
      log(JSON.stringify({ huisnummers: "error", errorCode: errorCodeOf(error), plekken: plekken.size }));
      return { written: false, errorCode: errorCodeOf(error), document: vorige };
    }
  }
  const document = maakAutoDocument({ plekken, ...gelezen, vandaag, stratenStad });
  // Dezelfde uitkomst als de vorige keer: de datum blijft, zodat het bestand niet elke dag verandert.
  if (vorige && zonderDatum(vorige) === zonderDatum(document)) document.bijgewerkt = vorige.bijgewerkt;
  const fouten = validateHuisnummersAuto(document);
  if (fouten.length) {
    log(JSON.stringify({ huisnummers: "rejected", fouten: fouten.slice(0, 5) }));
    return { written: false, errorCode: "invalid_output", document: vorige };
  }
  const tekst = serialize(document);
  const changed = !fs.existsSync(file) || fs.readFileSync(file, "utf8") !== tekst;
  if (changed) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, tekst, "utf8");
  }
  log(JSON.stringify({ huisnummers: changed ? "written" : "unchanged", plekken: plekken.size, gevonden: document.plekken.length, nagekeken: document.nagekeken.length }));
  return { written: changed, errorCode: null, document };
}

if (isMainModule(import.meta.url)) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  vulHuisnummers({ rootDir }).catch((error) => {
    // Nooit de verversing breken: het vorige bestand blijft staan.
    console.error(JSON.stringify({ huisnummers: "error", message: String(error?.message || error).slice(0, 200) }));
  });
}
