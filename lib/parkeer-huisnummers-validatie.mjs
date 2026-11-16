// site/sources/parkeer-huisnummers.json: waarom een parkeerverbod zonder huisnummer staat, in aantallen. De vorm van het
// bestand, de codes en de regel voor de eigenaar. De telling zelf maakt de verversing (lib/parkeer-huisnummers.mjs, daar
// staat ook de uitleg en de meting van 13 november 2026). Dit bestand heeft geen imports: scripts/validate-data.mjs,
// scripts/build-sources.mjs en scripts/sources-health.mjs lezen het zonder de modules van de site.
//
// De codes (één per parkeerverbod zonder nummer):
// - bron_zonder_nummer: de stad geeft geen huisnummer ("0-0", "Onbekend-Onbekend", "hoek-hoek", niets);
// - vorm_niet_herkend: de stad geeft een nummer, maar in een vorm die publiekParkeerAdres niet kent;
// - straat_niet_officieel: de stad geeft een nummer in een bekende vorm, maar de straat is geen officiële straatnaam
//   (dan kan het een naam of vrije tekst zijn, en komt er nooit een nummer bij);
// - verboden_woord: de stad geeft een nummer, maar in het adres staat een woord dat nooit bij een parkeerverbod komt
//   (noemtVerhuis in site/adres-privacy.js);
// - niet_bewaard: de regel maakt van het adres een plaats met het nummer, maar zo staat ze niet in wat bewaard wordt (het
//   nummer viel later weg, zoals in de opslag van vóór 26 oktober 2026);
// - bron_onbekend: het adres van de bron is niet te lezen (geen postcode met gemeente) of de rij ontbreekt.
// De vier middelste zijn eigen verlies: de bron had een nummer en de agenda bewaart het niet. Dat hoort nul te zijn;
// scripts/sources-health.mjs waarschuwt als het dat niet is.
export const PARKEER_HUISNUMMERS_FILE = "parkeer-huisnummers.json";
export const PARKEER_HUISNUMMERS_SCHEMA = 1;
export const REDENEN = Object.freeze(["bron_zonder_nummer", "vorm_niet_herkend", "straat_niet_officieel", "verboden_woord", "niet_bewaard", "bron_onbekend"]);
// De bron had een nummer en de agenda bewaart het niet.
export const EIGEN_VERLIES = Object.freeze(["vorm_niet_herkend", "straat_niet_officieel", "verboden_woord", "niet_bewaard"]);

const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
// Een tijdstip zoals de verversing het schrijft (toISOString).
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const MAX_TELLING = 100_000;
const isTelling = (value) => Number.isInteger(value) && value >= 0 && value <= MAX_TELLING;

// Hoeveel parkeerverboden hadden in de bron een nummer dat de agenda niet bewaart?
export const eigenVerlies = (document) => EIGEN_VERLIES.reduce((som, reden) => som + (isTelling(document?.redenen?.[reden]) ? document.redenen[reden] : 0), 0);

// Het bestand houdt alleen vaste sleutels, gehele aantallen en één tijdstip in: zo kan er nooit een straat, een nummer,
// een reden of een naam in staan. De foutzinnen noemen nooit een waarde uit het bestand.
export function validateParkeerHuisnummers(document) {
  if (!isObject(document)) return ["geen object"];
  const fouten = [];
  const sleutels = ["schemaVersion", "observedAt", "totaal", "metNummer", "zonderNummer", "redenen"];
  if (Object.keys(document).some((sleutel) => !sleutels.includes(sleutel))) fouten.push("onbekende sleutel");
  if (document.schemaVersion !== PARKEER_HUISNUMMERS_SCHEMA) fouten.push("schemaVersion ongeldig");
  if (typeof document.observedAt !== "string" || !ISO.test(document.observedAt) || !Number.isFinite(Date.parse(document.observedAt))) fouten.push("observedAt ongeldig");
  for (const sleutel of ["totaal", "metNummer", "zonderNummer"]) if (!isTelling(document[sleutel])) fouten.push(`${sleutel} ongeldig`);
  if (!isObject(document.redenen)) return [...fouten, "redenen ontbreekt"];
  if (Object.keys(document.redenen).some((reden) => !REDENEN.includes(reden))) fouten.push("onbekende reden");
  for (const reden of REDENEN) if (!isTelling(document.redenen[reden])) fouten.push(`redenen.${reden} ongeldig`);
  if (fouten.length) return fouten;
  if (document.metNummer + document.zonderNummer !== document.totaal) fouten.push("metNummer en zonderNummer tellen niet op tot totaal");
  if (REDENEN.reduce((som, reden) => som + document.redenen[reden], 0) !== document.zonderNummer) fouten.push("de redenen tellen niet op tot zonderNummer");
  return fouten;
}

// Voor de eigenaar (scripts/sources-health.mjs): één regel met de aantallen, en een waarschuwing in gewone woorden als
// de agenda een nummer van de bron niet bewaart. Geen waarschuwing als alleen de stad er geen geeft: daar valt aan
// onze kant niets te doen.
export function parkeerHuisnummerStand(document) {
  if (validateParkeerHuisnummers(document).length) return { regel: "parkeer-huisnummers\tongeldig", waarschuwing: null };
  const verlies = eigenVerlies(document);
  const regel = ["parkeer-huisnummers", verlies ? "verlies" : "ok", `totaal=${document.totaal}`, `met=${document.metNummer}`, `zonder=${document.zonderNummer}`,
    `bron_zonder_nummer=${document.redenen.bron_zonder_nummer}`, `eigen_verlies=${verlies}`, `bron_onbekend=${document.redenen.bron_onbekend}`, `observedAt=${document.observedAt}`].join("\t");
  if (!verlies) return { regel, waarschuwing: null };
  const delen = [["vorm_niet_herkend", "vorm van het nummer niet herkend"], ["straat_niet_officieel", "straat geen officiële straatnaam"], ["verboden_woord", "een woord in het adres dat nooit bij een parkeerverbod komt"], ["niet_bewaard", "nummer herkend maar niet bewaard"]]
    .filter(([reden]) => document.redenen[reden] > 0).map(([reden, zin]) => `${zin}: ${document.redenen[reden]}`).join("; ");
  return { regel, waarschuwing: `${verlies} van ${document.totaal} parkeerverboden hebben bij de stad een huisnummer dat de agenda niet bewaart (${delen}). De regel is: altijd het exacte huisnummer. Kijk in lib/parkeer-huisnummers.mjs en site/adres-privacy.js.` };
}
