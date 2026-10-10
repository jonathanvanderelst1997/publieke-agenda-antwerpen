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

## Snelheid: straatbestanden en radar (P5, oktober 2026)

De browser vraagt `live-layers.json` (8 tot 12 MB) niet meer op. Op het einde van `npm run refresh` schrijft `scripts/build-straat-snapshots.mjs`:

- `site/history/radar.json` (enkele tientallen kB): per straat en per verversing van de laatste 7 dagen het aantal nieuwe, gewijzigde en afgelopen items, voor de district-radar op de voorpagina (`site/street-overview.js`);
- `site/straat/<id>.json`: per officiële straat (id uit `site/geo/straten.json`) de werken, A-Sign-items (parkeerverboden, innames, werfzones, evenementen op straat, terrassen), vergunningen en agendapunten zoals de browser ze live maakt, plus het tijdstip van de verversing. Alleen straten met minstens één item; een bestand wordt alleen herschreven als de inhoud verandert;
- `site/straat-index.json`: welke straten een bestand hebben, met een hash per straat, en de stand per laag.

De plekpagina toont een straat meteen uit haar bestand en vraagt daarna live alleen het kader van die straat na (`site/straat-snapshot.js`, `site/place-view.js`), met een zin zoals "Live nagekeken: 1 nieuw sinds 05:22". Lukt live nakijken niet, dan blijft de stand van de ochtend staan, met een eerlijke zin. Zonder straatbestanden werkt alles zoals vroeger.

Privacy: dezelfde opkuis als de historiek (geen huisnummers, ook niet in titels; geen naam na een dossiercode), en daarbovenop geen vrije beschrijving van een inname, geen aanvrager of onderwerp van een vergunning, geen adres van een terras, geen punt of vorm, en nooit `creator`, `assignee` of `lockOwner`. `validate:data` kijkt elk bestand na (grootte onder 100 kB, de radar onder 50 kB, de index klopt, privacyscan). De datalaan laat `site/history/radar.json`, `site/straat-index.json` en `site/straat/<id>.json` toe; verwijderen mag onder `site/straat/` (een straat zonder items).

Een laag die bij de verversing niet laadt of verdacht krimpt (meer dan de helft minder bij minstens 20 items), houdt per straat haar vorige stand, met status `stale` in de index.
