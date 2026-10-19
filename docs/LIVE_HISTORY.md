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

De historiek bevat alleen velden die al publiek in de live kaarten mogen staan. Geen aanvrager, contactorganisatie, adminlink, ruwe geometrie of andere bronpayload wordt opgeslagen. Een werk staat erin in zijn vaste vorm (`site/werk-vorm.js`, `site/sources/werk-vorm.json`, docs/PUBLIC_SPACE_SOURCE_POLICY.md "Werken: adreskaart of gewone kaart"): een adreskaart als "<soort> – <straat>", zonder huisnummer en zonder vrije tekst; de verversing schrijft de vaste vorm vóór de historiek. De bestaande privacy-scan controleert zowel `live-layers.json` als baseline en alle dagshards in `validate:data`; de index bevat alleen datum, pad, aantal en digest.

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

Na de nakijkronde:

- **Openbaar onderzoek:** de plekpagina zet de nagekeken stand van het Inzageloket (`site/sources/inzage-status.json`) ook op de vergunningen uit het straatbestand en op de live vergunningen van het kader.
- **Opbouw en afbraak:** per evenementendossier staat in elk straatbestand van dat dossier een samenvatting per fase en soort inname (vroegste begin, laatste einde, zonder vorm, `faseSamenvatting`), behalve wat de rijen van de straat zelf al geven. Zo toont de kaart "opbouw vanaf … en afbraak tot …" ook als de opbouw elders ligt. Straten staan er alleen bij een parkeerverbod, een verkeersvrije zone of een omleiding (zie hieronder); die van een parcours staan in `kaart-uitleg.json`.
- **Werfzones en parkeerverboden:** de andere fasen van een werfzone en de andere plaatsen van een parkeerverbod (zelfde dag en uren) staan kort in het straatbestand (`bundel`). Na het live nakijken vult de plekpagina een werfzone die het kader maar half raakt aan met wat de ochtend wist ("Werfzone met omleiding", niet alleen "Omleiding").
- **Dossiertype en hinder van een inname:** de verversing vraagt `type_dossier` en `innameHinder` op, maar alleen voor de straatbestanden; de historiek en `kaart-uitleg.json` blijven zoals ze waren.
- **Radar binnen budget:** past de radar niet in 50 kB, dan vallen eerst de oudste dagen weg, dan alles behalve de laatste verversing, en dan de straten met de minste wijzigingen (`ingekort`, `weggelaten`). Zo maakt een drukke week de verversing nooit rood. `node scripts/build-straat-snapshots.mjs --alleen-radar` maakt alleen `radar.json` opnieuw (bv. na een merge met een nieuwere historiek).
- **Privacy:** ook een nummer na "gevel", "pand", "woning", "huis" of "nummer" in vrije tekst (de omschrijving van een GIPOD-hinderfase) valt weg, en de scan van `validate:data` ziet het.
- **Zichtbaar:** `npm run sources:health` toont een regel `straatbestanden` en meldt (zonder rood) een laag op `stale` of `error` of een bouw van meer dan 26 uur oud.

Na de tweede nakijkronde:

- **Dossiers live op dossiernummer:** na het kader van de straat vraagt de plekpagina de andere rijen op van de dossiers die live in het kader liggen (een parkeerverbod op meer plaatsen, een werfzone met haar fasen en omleiding, een evenement met opbouw, parcours en afbraak), op dossiernummer: A-Sign 20 `Dossiernummer IN (…)`, 22/23 `dossierNummer IN (…)`, 47/48 `reference_id IN (…)`, met dezelfde voorwaarden als de lijst van het hele district en de straatassen van het hele district (`publiekeRuimteInKader` in `site/public-space-live.js`). Kader en dossiers worden samengevoegd in de volgorde van de bron (OBJECTID). Zo zijn die kaartjes gelijk aan vroeger, ook met een straal ("Ankerrui + 10 andere straten", "opbouw vanaf … en afbraak tot …" in een buurstraat). Lukt dat niet, of liggen er meer dan 300 dossiers in het kader, dan vult de stand van de ochtend aan zoals hierboven (`aanvullenMetOchtend`); een bundelrij van een parkeerverbod dan alleen als live nog een rij dezelfde maatregel is (zelfde dag, uren en reden).
- **"Wat merk je" bij een evenement:** de samenvatting van een parkeerverbod, een verkeersvrije zone of een omleiding houdt haar straten (zonder de straat van het bestand zelf). De kaart zei anders ten onrechte "Welke straten dicht gaan en wanneer, maakt de stad niet bekend." Op de data van 11 oktober 2026 kost dat 0,03 MB over alle straatbestanden.
- **Vergunningen:** na het live nakijken staan de straten van de ochtend eerst (die kende alle straatassen); "Waar" noemt de eerste straat als de plek van de aanvraag.
- **Privacy:** de opkuis kent ook "thv", "ter hoogte van", "tegenover", "naast", "voor de deur van", "appartement", "nr°" en "12 bus 3"; een postcode na een komma ("nr. 12, 2000 Antwerpen") blijft staan, net als een buslijn of tramlijn zonder huisnummer ervoor ("bus 30", "lijn 4").
- **Radar:** een ingekorte radar zegt op de voorpagina hoeveel dagen er nog in staan ("laatste 3 dagen (ingekort)") in plaats van "laatste 7 dagen".
- **Grens van de snelle weg:** wat na de ochtendverversing nieuw is en buiten het kader van de straat ligt (meer dan 40 m, of de gekozen straal), ziet de plekpagina pas na de volgende verversing. Vroeger, met alle lagen van het district, zag ze dat meteen. Het gaat om een werk dat via een genoemde straat tot 300 m ver aan de straat hangt (`site/street-core.js`) of een terras met een verkeerd punt. Een straat zonder straatbestand vraagt live het kader van de straat plus 40 m.
- **Nog niet:** het live kader van enkele straten is groot (de Noorderlaan beslaat bijna de helft van het district, door items die via een adres of een genoemde straat aan de straat hangen). De tegels staan er meteen; het live nakijken duurt daar even lang als vroeger.
