// Vaste volgorde van de fetchers die `npm run refresh:fetch` draait. Een latere fetcher
// (bijvoorbeeld voor besluiten uit eBesluit) wordt hier toegevoegd, met zijn eigen sourceIds.
// Elke fetcher exporteert run({ fetch, clock, rootDir, env, log }) en geeft statusregels terug.
export const FETCHERS = Object.freeze([
  Object.freeze({ name: "district-kalender", sourceIds: Object.freeze(["district-kalender"]), load: () => import("../scripts/fetch-sources-district.mjs") }),
  Object.freeze({ name: "district-nieuws", sourceIds: Object.freeze(["district-nieuws"]), load: () => import("../scripts/fetch-sources-district-news.mjs") }),
  Object.freeze({ name: "district-ebesluit", sourceIds: Object.freeze(["district-ebesluit"]), load: () => import("../scripts/fetch-sources-ebesluit.mjs") }),
  Object.freeze({ name: "stad-districten", sourceIds: Object.freeze(["stad-districten"]), load: () => import("../scripts/fetch-sources-stad-districten.mjs") }),
  Object.freeze({ name: "stad-markten", sourceIds: Object.freeze(["stad-markten"]), load: () => import("../scripts/fetch-sources-markten.mjs") }),
  Object.freeze({ name: "stad-koopzondagen", sourceIds: Object.freeze(["stad-koopzondagen"]), load: () => import("../scripts/fetch-sources-koopzondagen.mjs") }),
  Object.freeze({ name: "stad-uit", sourceIds: Object.freeze(["stad-uit"]), load: () => import("../scripts/fetch-sources-uit.mjs") }),
  Object.freeze({ name: "mail", sourceIds: Object.freeze(["mail-district", "mail-stad"]), load: () => import("../scripts/fetch-sources-mail.mjs") }),
]);
