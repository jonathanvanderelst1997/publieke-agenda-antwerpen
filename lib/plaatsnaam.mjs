// Een omschrijving uit A-Sign (innameBeschrijving: vrije tekst van de aanvrager) als plaatsnaam. Zie
// docs/PUBLIC_SPACE_SOURCE_POLICY.md: de site toont die tekst alleen na de privacyfilter (site/witte-lijst.js, dezelfde
// als voor de kaart). GRONDREGEL: uit de tekst blijft alleen over
//   - een volledige officiële straatnaam uit de straatas, exact op de genormaliseerde vorm: de hele naam, nooit een stuk
//     ervan en nooit één los woord van een straatnaam ("Gummarus" bewijst niets);
//   - een naam uit de vaste lijst van de 9 districten van Antwerpen.
// Niets anders: geen woordenlijst ("metrostation", "kerk", "plein"), geen naam, geen cijfer. Een plaatsnaam is dus een
// straatnaam of een district, of "" als de tekst er geen noemt.
// Puur: geen netwerk, geen klok.

import { sleutel, witteTekst } from "../site/witte-lijst.js";

// Zoals de sleutel van de straatas (nameKey in site/street-core.js): zonder accenten en hoofdletters, alles wat
// geen letter of cijfer is wordt één spatie. Voor `isStraat` in de verversing (index.byName).
export const straatSleutel = (v) => sleutel(v);

// Staat deze hele naam in de straatas? De straatas van district Antwerpen (`index.byName`, met de geometrie) en de
// officiële straatnamen van de andere districten (site/geo/straten-stad.json: [naam, district, postcode]), zodat een
// dossier in Berchem of Ekeren zijn straten ook als plaatsnaam houdt. Alleen een hele naam telt.
export function straatasPredicaat({ index = null, stadStraten = [] } = {}) {
  const stad = new Set((Array.isArray(stadStraten) ? stadStraten : []).map((s) => sleutel(Array.isArray(s) ? s[0] : s?.name ?? s)).filter(Boolean));
  return (naam) => {
    const k = sleutel(naam);
    return Boolean(k) && (Boolean(index?.byName?.has?.(k)) || stad.has(k));
  };
}

// De plaatsnaam, of "" als de tekst geen volledige straatnaam en geen district noemt. `rond`: straatnamen van de straatas
// binnen 150 m, of een functie die ze geeft (pas gevraagd als het nodig is). `isStraat(naam)`: staat die hele naam in de
// straatas?
export function plaatsnaamVan(tekst, { rond = [], isStraat = () => false } = {}) {
  return witteTekst(tekst, { rond, isStraat });
}
