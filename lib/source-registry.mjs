// Vaste volgorde van de fetchers die `npm run refresh:fetch` draait. Een latere fetcher
// (bijvoorbeeld voor besluiten uit eBesluit) wordt hier toegevoegd, met zijn eigen sourceIds.
// Elke fetcher exporteert run({ fetch, clock, rootDir, env, log }) en geeft statusregels terug.
// budgetMs (optioneel) vervangt het standaard tijdsbudget per bron uit scripts/refresh-fetch.mjs.
export const FETCHERS = Object.freeze([
  Object.freeze({ name: "district-kalender", sourceIds: Object.freeze(["district-kalender"]), load: () => import("../scripts/fetch-sources-district.mjs") }),
  Object.freeze({ name: "district-nieuws", sourceIds: Object.freeze(["district-nieuws"]), load: () => import("../scripts/fetch-sources-district-news.mjs") }),
  Object.freeze({ name: "district-vergaderingen", sourceIds: Object.freeze(["district-vergaderingen"]), load: () => import("../scripts/fetch-sources-district-meetings.mjs") }),
  Object.freeze({ name: "district-gipod-evenementen", sourceIds: Object.freeze(["district-gipod-evenementen"]), load: () => import("../scripts/fetch-sources-gipod-events.mjs") }),
  // eBesluit: honderd verzoeken tegen een trage server met 503-herkansingen (gemeten ~65 s, oktober 2026).
  Object.freeze({ name: "district-ebesluit", sourceIds: Object.freeze(["district-ebesluit"]), budgetMs: 6 * 60_000, load: () => import("../scripts/fetch-sources-ebesluit.mjs") }),
  // Foren (A-Sign), schoolstraten en projectpagina's van het district: gewone code, geen sleutel.
  Object.freeze({ name: "district-foren", sourceIds: Object.freeze(["district-foren"]), load: () => import("../scripts/fetch-sources-foren.mjs") }),
  Object.freeze({ name: "district-schoolstraten", sourceIds: Object.freeze(["district-schoolstraten"]), load: () => import("../scripts/fetch-sources-schoolstraten.mjs") }),
  Object.freeze({ name: "district-projecten", sourceIds: Object.freeze(["district-projecten"]), load: () => import("../scripts/fetch-sources-projecten.mjs") }),
  Object.freeze({ name: "stad-districten", sourceIds: Object.freeze(["stad-districten"]), load: () => import("../scripts/fetch-sources-stad-districten.mjs") }),
  Object.freeze({ name: "stad-markten", sourceIds: Object.freeze(["stad-markten"]), load: () => import("../scripts/fetch-sources-markten.mjs") }),
  Object.freeze({ name: "stad-koopzondagen", sourceIds: Object.freeze(["stad-koopzondagen"]), load: () => import("../scripts/fetch-sources-koopzondagen.mjs") }),
  Object.freeze({ name: "stad-uit", sourceIds: Object.freeze(["stad-uit"]), load: () => import("../scripts/fetch-sources-uit.mjs") }),
  Object.freeze({ name: "mail", sourceIds: Object.freeze(["mail-district", "mail-stad"]), load: () => import("../scripts/fetch-sources-mail.mjs") }),
  // Evenementen uit eBesluit: als laatste, zodat ze nooit tijd van de andere bronnen opeet. Zes
  // zoektermen en hoogstens 100 nieuwe detailpagina's, 1 per seconde; de rest volgt de volgende ochtend.
  Object.freeze({ name: "district-ebesluit-evenementen", sourceIds: Object.freeze(["district-ebesluit-evenementen"]), budgetMs: 4 * 60_000, load: () => import("../scripts/fetch-sources-ebesluit-evenementen.mjs") }),
]);

// Afgeleide bronnen: geen fetcher, want ze ontstaan uit wat de verversing al ophaalde, in een latere stap
// van `npm run refresh` (`na`). Ze staan daarom niet in refresh-status.json (dat schrijft alleen
// scripts/refresh-fetch.mjs); scripts/sources-health.mjs leest hun bestand zelf.
//   - district-asign-evenementen: de evenementendossiers van de stad (A-Sign) als agendapunten, in de stap
//     refresh:herkenning, met de dossiers die de parcoursherkenning ophaalt (lib/asign-evenementen-agenda.mjs).
export const AFGELEIDE_BRONNEN = Object.freeze([
  Object.freeze({ name: "district-asign-evenementen", sourceIds: Object.freeze(["district-asign-evenementen"]), na: "refresh:herkenning", module: "lib/asign-evenementen-agenda.mjs" }),
]);
export const AFGELEIDE_BRON_IDS = Object.freeze(AFGELEIDE_BRONNEN.flatMap((bron) => bron.sourceIds));
