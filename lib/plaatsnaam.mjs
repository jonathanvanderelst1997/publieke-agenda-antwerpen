// Een omschrijving uit A-Sign (innameBeschrijving: vrije tekst van de aanvrager) als plaatsnaam. Zie
// docs/PUBLIC_SPACE_SOURCE_POLICY.md: de site toont die tekst alleen als plaatsnaam of als letterlijk trefwoord, en
// altijd pas na een privacyfilter. Die filter is een WITTE LIJST (site/witte-lijst.js, dezelfde als voor de kaart): uit
// de tekst blijft alleen over wat aantoonbaar een plek is. Hier in de stand "plaats":
//   - een volledige officiële straatnaam: de hele naam, exact, uit de straatas (`isStraat`) of uit de straten binnen
//     150 m van de plek (`rond`); nooit een stuk van een straatnaam ("Gummarus" bewijst niets meer);
//   - een soort plek uit de vaste lijst ("metrostation", "plein", "kerk");
//   - een district, wijk of bekende plek uit de vaste lijst ("Zurenborg", "Park Spoor Noord").
// Al de rest valt weg: elk ander woord, elk cijfer, elke naamvorm (nakijkronde van head ba03ff4: de zwarte lijst van
// naamvormen bleef lek). Een plaatsnaam moet minstens één echte plek noemen: alleen "Metrostation" is er geen.
// Puur: geen netwerk, geen klok.

import { sleutel, witteLijst } from "../site/witte-lijst.js";

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

// De plaatsnaam, of "" als de tekst geen plek noemt. `rond`: straatnamen binnen 150 m, of een functie die ze geeft
// (pas gevraagd als het nodig is). `isStraat(naam)`: staat die hele naam in de straatas?
export function plaatsnaamVan(tekst, { rond = [], isStraat = () => false } = {}) {
  const r = witteLijst(tekst, { rond, isStraat, modus: "plaats" });
  return r.plekken.length ? r.tekst : "";
}
