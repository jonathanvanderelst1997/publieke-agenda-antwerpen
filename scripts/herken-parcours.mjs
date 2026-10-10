// Automatische parcoursherkenning bij elke verversing (`npm run refresh:herkenning`, onderdeel van
// `npm run refresh`, na het ophalen van de bronnen en de geocodering). Schrijft
// site/sources/evenement-identiteit-auto.json en site/sources/evenement-patronen.json; zie
// lib/parcours-herkenning.mjs. Elk verzoek valt onder één tijdsbudget (deadlineFetch): daarna faalt
// het meteen en valt de herkenner terug op wat hij al heeft. Eindigt altijd met exitcode 0: een
// haperende bron of een fout hier laat de vorige bestanden staan en breekt de verversing nooit.
import path from "node:path";
import { fileURLToPath } from "node:url";

import { deadlineFetch, isMainModule } from "../lib/fetch-util.mjs";
import { HERKENNING_BUDGET_MS, herkenParcours } from "../lib/parcours-herkenning-refresh.mjs";

export async function main({ rootDir, fetch: fetchImpl = globalThis.fetch, budgetMs = HERKENNING_BUDGET_MS, log = console.log } = {}) {
  try {
    return await herkenParcours({ rootDir, fetch: deadlineFetch(fetchImpl, AbortSignal.timeout(budgetMs)), log });
  } catch (error) {
    log(JSON.stringify({ parcoursHerkenning: "niet bijgewerkt", errorCode: "onverwacht", detail: String(error?.message || error).slice(0, 120) }));
    return null;
  }
}

if (isMainModule(import.meta.url)) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  main({ rootDir }).finally(() => { process.exitCode = 0; });
}
