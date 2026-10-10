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
  Object.freeze({ name: "stad-districten", sourceIds: Object.freeze(["stad-districten"]), load: () => import("../scripts/fetch-sources-stad-districten.mjs") }),
  Object.freeze({ name: "stad-markten", sourceIds: Object.freeze(["stad-markten"]), load: () => import("../scripts/fetch-sources-markten.mjs") }),
  Object.freeze({ name: "stad-koopzondagen", sourceIds: Object.freeze(["stad-koopzondagen"]), load: () => import("../scripts/fetch-sources-koopzondagen.mjs") }),
  Object.freeze({ name: "stad-uit", sourceIds: Object.freeze(["stad-uit"]), load: () => import("../scripts/fetch-sources-uit.mjs") }),
  Object.freeze({ name: "mail", sourceIds: Object.freeze(["mail-district", "mail-stad"]), load: () => import("../scripts/fetch-sources-mail.mjs") }),
  // Evenementen uit eBesluit: als laatste, zodat ze nooit tijd van de andere bronnen opeet. Zes
  // zoektermen en hoogstens 100 nieuwe detailpagina's, 1 per seconde; de rest volgt de volgende ochtend.
  Object.freeze({ name: "district-ebesluit-evenementen", sourceIds: Object.freeze(["district-ebesluit-evenementen"]), budgetMs: 4 * 60_000, load: () => import("../scripts/fetch-sources-ebesluit-evenementen.mjs") }),
]);
