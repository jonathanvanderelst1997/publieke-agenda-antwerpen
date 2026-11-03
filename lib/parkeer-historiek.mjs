// Geen historiek van parkeerverboden. Besluit van de eigenaar van 3 november 2026: "er moet geen historie zijn van
// parkeerverboden".
//
// Een tijdelijk parkeerverbod staat op de site zolang het loopt of nog moet komen: live uit A-Sign in de browser, en in de
// stand van de ochtend (de straatbestanden onder site/straat/ en site/sources/kaart-uitleg.json), met de regels van
// site/adres-privacy.js (nooit de reden, altijd het exacte huisnummer, nooit een naam). Is het voorbij, dan bewaart de site
// er niets meer van:
// - de historiek (site/history/live-layers.json): geen parkeerverbod in de laag publicSpace en geen wijziging van een
//   parkeerverbod (updateLiveHistory in lib/live-history.mjs, historiekVoorPubliek in lib/historiek-privacy.mjs);
// - het archief (site/history/archive/): niet in baseline.json en geen event in een dagshard
//   (lib/live-history-archive.mjs, archiefBaselineVoorPubliek en archiefDagVoorPubliek);
// - de radar (site/history/radar.json): telt geen wijziging van een parkeerverbod (bouwRadar in
//   scripts/build-straat-snapshots.mjs);
// - geen backfill van de parkeerhistoriek uit A-Sign: de materializer is weg, en lib/history-backfill.mjs weigert elke
//   bron en elk record van een parkeerverbod.
// De innames (IOD), werfzones en omleidingen (SGW) en de werken houden hun historiek zoals voorheen.
//
// Dit bestand zegt wat een parkeerverbod is en haalt het eruit. scripts/opkuis-historiek-privacy.mjs kuist zo ook de
// bestaande bestanden op, en scripts/validate-data.mjs meldt elk parkeerverbod dat toch onder site/history staat
// (parkeerverbodenInHistoriek).

const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);

// Een parkeerverbod van A-Sign: id "parking:<dossier>|<locatie>" (site/public-space-live-core.js) of soort "parking".
export const isParkeerId = (id) => String(id ?? "").startsWith("parking:");
export const isParkeerItem = (item) => isObject(item) && (item.kind === "parking" || isParkeerId(item.id));
// Een wijziging (live-layers.json `changes`, een event van een dagshard) van een parkeerverbod: op id, of op wat ervoor of
// erna stond.
export const isParkeerWijziging = (entry) => isObject(entry) && (isParkeerId(entry.id) || isParkeerItem(entry.before) || isParkeerItem(entry.after));

export const zonderParkeerItems = (items) => (Array.isArray(items) ? items.filter((item) => !isParkeerItem(item)) : items);
export const zonderParkeerWijzigingen = (entries) => (Array.isArray(entries) ? entries.filter((entry) => !isParkeerWijziging(entry)) : entries);

// Elk parkeerverbod in een bestand van site/history (live-layers.json, baseline.json, een dagshard, een backfillbestand):
// { code: "parkeerverbod", path }. Nooit de waarde zelf (de logs zijn publiek).
export function parkeerverbodenInHistoriek(value, path = "$") {
  const findings = [];
  const visit = (node, at) => {
    if (Array.isArray(node)) {
      node.forEach((child, index) => visit(child, `${at}[${index}]`));
      return;
    }
    if (!isObject(node)) return;
    if (isParkeerItem(node) || isParkeerWijziging(node)) {
      findings.push({ code: "parkeerverbod", path: at });
      return;
    }
    for (const [key, child] of Object.entries(node)) visit(child, `${at}.${key}`);
  };
  visit(value, path);
  return findings;
}
