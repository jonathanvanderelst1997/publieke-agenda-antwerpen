# Live werkenlaag — bronbeleid

Stand: 28 september 2026; AWV-werfdata, hinder zonder gepubliceerd werk, de GIPOD-horizon en De Vlaamse Waterweg bijgewerkt op 17 oktober 2026.

De publieke agenda leest live GIPOD `INNAME_PUNT` voor `Werk` en `Grondwerk` met status `In uitvoering` of `Concreet gepland`.

Een werk wordt getoond als het GIPOD-id in de laatste exact polygon-gevalideerde districtsnapshot zit, of als het een nieuw id is waarvan het actuele GIPOD-punt binnen de officiële districtsgrens ligt. Nieuwe puntgebaseerde records worden apart gemarkeerd.

GIPOD `Owner` betekent opdrachtgever/beheerder, niet automatisch aannemer. A-Sign laag 19 `Werfsignalisatie` mag uitsluitend als aanvullend signaal worden gebruikt wanneer een goedgekeurd, nog actueel record via exact hetzelfde `GipodID` aan een reeds aanvaard districtswerk koppelt. `Bedrijf` wordt gelabeld als “Bedrijf volgens A-Sign”, niet automatisch als juridische aannemer. Veilige supplementvelden zijn Bedrijf, DossierType, WERF_TYPE, FASEID, Fasestatus, VerkeersImpact en DossierHinder. `DetailLigging` en `Link` worden niet opgehaald of gepubliceerd. Omdat laag 19 legacy/sparse is, betekent een ontbrekend supplement niets over het ontbreken van een aannemer. Gevalideerde `HINDER_PUNT`-records worden via `HindranceConsequenceOf` gekoppeld aan het veroorzakende werk. Publiek worden alleen gevolgen, ernst, periode en de officiële hinderbron gebruikt; contactorganisaties worden niet overgenomen. Ontbrekende hinder blijft `onbekend` en betekent niet automatisch geen hinder. Parkeerverboden, IOD, SGW, speelstraten, markten en evenementen blijven afzonderlijke bronlagen.

Bij uitval van de officiële grens valt de pagina terug op alleen de exact gevalideerde snapshot. Bij uitval van GIPOD blijft de bestaande agenda bruikbaar.

GIPOD publiceert maar zes maanden vooruit (dataset 2b4b3bb7: "vandaag en in de komende zes maanden"; gemeten op 17 oktober 2026: de laatste start in het district is 18 april 2027). De werkenlaag toont dus nooit verder dan zes maanden, en de 365 dagen in de vragen voor evenementen en markten zijn in de praktijk ook zes maanden. Uitgever van de dataset is Athumi (Vlaams Datanutsbedrijf); de diensten draaien op geo.api.vlaanderen.be. De oude GIPOD-API is uitgezet en de nieuwe vraagt een login: die gebruiken we niet.

## AWV-werfdata (aanvulling)

Het Agentschap Wegen en Verkeer publiceert zijn werven als open data (WFS "Werf – Innames" en "Werf – Lokale omleidingen" op opendata.apps.mow.vlaanderen.be, Modellicentie gratis hergebruik v1.0, "Bron: AWV"). Op 17 oktober 2026 hadden 118 bevestigde AWV-innames in het district een GIPOD-id, en die 118 stonden allemaal al in de werkenlaag. AWV is daarom geen eigen bron van werken maar een aanvulling, net als A-Sign laag 19:

- De dagelijkse verversing (`scripts/fetch-sources-awv-werf.mjs`, eigen budget van 60 s) schrijft `site/sources/awv-werf-supplement.json`. Ze vraagt alleen vaste velden: werf, GIPOD-id, afdeling, soort werk, status, fase, van- en totdatum, innametypes, maatregelen, route voor uitzonderlijk vervoer, laatste wijziging en de lijn; van een lokale omleiding alleen voor wie ze geldt. Nooit `Omschrijving`, `URL` of `Buffer_publicatie`.
- Alleen bevestigde innames (`InUitvoering`, `ConcreetGepland`, `ConcreetVoorUitvoering`) met een GIPOD-id, die vandaag nog lopen of komen en waarvan de lijn de exacte districtsgrens raakt. Werven "in opmaak" of "niet concreet gepland" komen nooit binnen. Een inname zonder einddatum valt weg.
- Tekst gaat door een woordenlijst: rijstroken en delen van de weg, doorgang, snelheidsbeperking, doorsteek, tijdelijke bypass en voor wie een omleiding geldt. Wat niet past, valt weg. De fase alleen als ze eruitziet als "Fase 2" of een maandnaam, nooit een code of initialen.
- De site hangt de aanvulling alleen aan een werk dat al getoond wordt, op exact hetzelfde GIPOD-id, in de lijst van het district en in het kader van één straat. De status blijft die van GIPOD (AWV geeft de status per werf, GIPOD per record). Op de werkkaart staat "Volgens AWV-werfdata: …" met de bronvermelding "Bron: Agentschap Wegen en Verkeer (AWV), open data Werf, bijgewerkt op …" en een link naar de metadatafiche. De tekst laat geen goedkeuring door AWV vermoeden.
- Faalt een vraag, is een antwoord afgekapt of ongeldig, of komen er 0 innames terwijl de vorige ronde er meer dan 20 had, dan blijft het vorige bestand staan en staat de fout in `refresh-status.json`. Een bestand ouder dan 3 dagen toont de site niet meer. Een ontbrekende aanvulling betekent niets: AWV is ook voor zijn eigen werken niet volledig (7 AWV-werken in GIPOD staan niet in Werf).

## Hinder zonder gepubliceerd werk

GIPOD publiceert soms gevalideerde hinder waarvan het werk zelf niet in de open laag `INNAME_PUNT` staat. Meting 17 oktober 2026: 64 zulke hinderberichten in het district (zonder evenementen), met 43 oorzaken die nergens in de open laag staan. Die hinder hing aan geen enkel getoond werk.

Ze staat nu in een apart, duidelijk benoemd blok "Hinder zonder gepubliceerd werk (GIPOD)" onder de werkenlijst (`losseHinder` in `site/works-hindrance.js`), met de zin "GIPOD publiceert deze gevalideerde hinder, maar het werk zelf staat niet in de open GIPOD-laag." Er komt geen nieuwe vraag bij: het blok gebruikt de `HINDER_PUNT`-features die de werkenlaag al ophaalt. Regels:

- alleen `Gevalideerd`, met een zonepunt binnen de officiële districtsgrens, en nog niet voorbij;
- elke oorzaak is een werk of grondwerk (geen evenement of markt), en geen enkele oorzaak wordt al getoond of staat in het antwoord van `INNAME_PUNT`;
- één item per hinder (de zones samen): de gevolgen samen, ernstig als één zone ernstig is, de vroegste start en het laatste einde;
- weg: zonder gevolgen en niet ernstig, een einde meer dan 2 jaar ver, of al lopend en meer dan een jaar niet gewijzigd;
- de plaats is alleen een straatnaam uit de straatas, nooit een huisnummer; de omschrijving, de beheerder en de contactorganisaties worden niet getoond;
- de bronlink filtert op `HindranceGipodId` (het feature-id draagt een tijdstempel);
- zonder districtsgrens of hinderbron verschijnt het blok niet, en de notitie zegt dat.

Proef op de gemeten data van 17 oktober 2026 (1.214 getoonde werken): 52 items in het blok, waarvan 23 ernstig.

Op 49 van de 64 plekken toont de agenda al een A-Sign-werfzone of -omleiding in dezelfde periode, maar zonder de gevolgen of de ernst; 14 staan nergens. Het beleid houdt SGW en GIPOD als aparte bronlagen, dus dit is geen dubbel.

Nog open: de link "officiële hinderbron" op een werkkaart (`HindranceURI` op gipod.api.vlaanderen.be) geeft HTTP 401; later vervangen door dezelfde filterlink op `HINDER_PUNT`. En de exacte grens-snapshot van 27 september mist 2 nieuwe werken die de grens raken; die snapshot hoort in de verversing ververst te worden (aparte PR).

## De Vlaamse Waterweg

Nagekeken op 17 oktober 2026. De wervenkaart van De Vlaamse Waterweg (https://www.vlaamsewaterweg.be/nl/werven) heeft geen open data-ingang. De punten op de kaart zitten alleen in de webpagina zelf: 212 punten van 166 werven, met titel, status en een punt, maar zonder datums. Er is geen API, geen GeoJSON- of WFS-dienst en geen dataset op metadata.vlaanderen.be. De disclaimer van de site verbiedt bovendien kopiëren en opnieuw publiceren zonder schriftelijke toestemming. Binnen de districtsgrens liggen 6 werven: Scheldekaaien, kaaimuur Rijnkaai, ponton Steenplein, Sint-Annastrand, Sigmaplanwerken Blue Gate en de geplande fiets- en voetgangersbrug. De categorie "Antwerpen" op de site telt er 7. Daarvan liggen er 2 buiten het district (Fort Lillo en Metropoolstraat), en de fietsbrug ontbreekt. In GIPOD staan in heel Vlaanderen maar 8 werken met beheerder De Vlaamse Waterweg, en geen enkel daarvan ligt in het district.

De Vlaamse Waterweg blijft daarom een link en geen automatische bron. Dat verandert pas als De Vlaamse Waterweg een open, machineleesbare werfbron met een punt per werf publiceert, of schriftelijk toestemming geeft. Automatische publicatie vraagt dan nog altijd een punt of geometrie per werf en dezelfde districtstoets als de andere ruimtelijke bronnen.
