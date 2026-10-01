# Live snapshots en wijzigingshistoriek

Stand: 28 september 2026.

De publieke agenda heeft live browserlagen voor GIPOD-werken + gevalideerde hinder en voor bevestigde A-Sign-maatregelen (parkeerverboden, IOD, SGW). Alleen live tonen is onvoldoende om veranderingen te kunnen volgen. Daarom schrijft de dagelijkse dataverversing één compacte, privacyveilige historiek:

- `site/history/live-layers.json` voor de actuele compacte snapshot en maximaal 90 dagen snelle wijzigingsevents;
- `site/history/archive/baseline.json` met de eerste succesvolle snapshot per laag;
- `site/history/archive/YYYY-MM-DD.json` met blijvende operationele wijzigingsevents per Brusselse kalenderdag;
- `site/history/archive/index.json` met aantallen en SHA-256-digests van alle aanwezige dagshards;
- de eerste succesvolle run per laag is baseline en wordt niet nog eens als duizenden `added`-events gearchiveerd.

De 90-dagengrens is dus alleen nog een snelle live-weergavelaag. Het archief zelf heeft geen tijdsretentie: eenmaal opgenomen dagshards worden door een gewone refresh niet verwijderd. Geschiedenis van vóór de eerste aantoonbaar succesvolle baseline wordt niet gereconstrueerd of verzonnen; latere backfill mag alleen uit controleerbare historische brondata komen.

## Fail-closed

Een laag wordt alleen vervangen wanneer alle bronnen die voor die laag nodig zijn succesvol zijn gelezen.

- werken: GIPOD INNAME_PUNT + officiële districtsgrens + gevalideerde HINDER_PUNT;
- publieke ruimte: parkeerverboden + IOD polygon/lijn + SGW omleiding/werfzone + officiële districtsgrens.

Bij een fout blijft de vorige succesvolle snapshot staan met status `stale` en een korte foutcode. Er worden dan geen `removed`-events afgeleid.

## Privacy

De historiek bevat alleen velden die al publiek in de live kaarten mogen staan. Geen aanvrager, contactorganisatie, adminlink, ruwe geometrie of andere bronpayload wordt opgeslagen. De bestaande privacy-scan controleert zowel `live-layers.json` als baseline en alle dagshards in `validate:data`; de index bevat alleen datum, pad, aantal en digest.

## Datalaan

De data-lane laat uitsluitend `site/history/live-layers.json`, `site/history/archive/baseline.json`, `site/history/archive/index.json` en strikt benoemde `site/history/archive/YYYY-MM-DD.json`-shards toe. Historybestanden zijn niet verwijderbaar via `deletableUnder`: een gewone refresh kan nieuwe geschiedenis toevoegen of de actuele dag aanvullen, maar geen oude dagshard wissen.

## Canonieke straatkoppeling

De dagelijkse refresh gebruikt de officiële Antwerpse wegenregisterlaag `wegenregister_straatas_postzone` (laag 905). GIPOD-werkpunten worden alleen aan de dichtstbijzijnde straatas gekoppeld als de match voldoende nabij en niet ambigu is. Parkeerverboden worden via hun officiële adres aan dezelfde canonieke straatnamen/postcodes gekoppeld. Ambigue of te verre matches blijven onopgelost. IOD/SGW volgen later via een geometrische join. Straatmetadata veroorzaakt op zichzelf geen operationeel `changed`-event. Bij uitval van de straatbron blijft de history fail-closed.
