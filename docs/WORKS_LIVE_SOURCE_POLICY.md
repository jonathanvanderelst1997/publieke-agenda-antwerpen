# Live werkenlaag — bronbeleid

Stand: 28 september 2026; AWV-werfdata, hinder zonder gepubliceerd werk, de GIPOD-horizon, De Vlaamse Waterweg en de regel "geen links naar ruwe GIPOD-records" bijgewerkt op 17 oktober 2026.

De publieke agenda leest live GIPOD `INNAME_PUNT` voor `Werk` en `Grondwerk` met status `In uitvoering` of `Concreet gepland`.

Een werk wordt getoond als het GIPOD-id in de laatste exact polygon-gevalideerde districtsnapshot zit, of als het een nieuw id is waarvan het actuele GIPOD-punt binnen de officiële districtsgrens ligt. Nieuwe puntgebaseerde records worden apart gemarkeerd.

GIPOD `Owner` betekent opdrachtgever/beheerder, niet automatisch aannemer. A-Sign laag 19 `Werfsignalisatie` mag uitsluitend als aanvullend signaal worden gebruikt wanneer een goedgekeurd, nog actueel record via exact hetzelfde `GipodID` aan een reeds aanvaard districtswerk koppelt. `Bedrijf` wordt gelabeld als “Bedrijf volgens A-Sign”, niet automatisch als juridische aannemer. Veilige supplementvelden zijn Bedrijf, DossierType, WERF_TYPE, FASEID, Fasestatus, VerkeersImpact en DossierHinder. `DetailLigging` en `Link` worden niet opgehaald of gepubliceerd. Omdat laag 19 legacy/sparse is, betekent een ontbrekend supplement niets over het ontbreken van een aannemer. Gevalideerde `HINDER_PUNT`-records worden via `HindranceConsequenceOf` gekoppeld aan het veroorzakende werk. Publiek worden alleen gevolgen, ernst en periode gebruikt, met GIPOD als bron; contactorganisaties worden niet overgenomen, en er komt geen link naar het ruwe hinderrecord (dat bevat ze wel). Ontbrekende hinder blijft `onbekend` en betekent niet automatisch geen hinder. Parkeerverboden, IOD, SGW, speelstraten, markten en evenementen blijven afzonderlijke bronlagen.

Bij uitval van de officiële grens valt de pagina terug op alleen de exact gevalideerde snapshot. Bij uitval van GIPOD blijft de bestaande agenda bruikbaar.

GIPOD publiceert maar zes maanden vooruit (dataset 2b4b3bb7: "vandaag en in de komende zes maanden"; gemeten op 17 oktober 2026: de laatste start in het district is 18 april 2027). De werkenlaag toont dus nooit verder dan zes maanden, en de 365 dagen in de vragen voor evenementen en markten zijn in de praktijk ook zes maanden. Uitgever van de dataset is Athumi (Vlaams Datanutsbedrijf); de diensten draaien op geo.api.vlaanderen.be. De oude GIPOD-API is uitgezet en de nieuwe vraagt een login: die gebruiken we niet.

## AWV-werfdata (aanvulling)

Het Agentschap Wegen en Verkeer publiceert zijn werven als open data (WFS "Werf – Innames" en "Werf – Lokale omleidingen" op opendata.apps.mow.vlaanderen.be, Modellicentie gratis hergebruik v1.0, "Bron: AWV"). Op 17 oktober 2026 hadden 118 bevestigde AWV-innames in het district een GIPOD-id, en die 118 stonden allemaal al in de werkenlaag. AWV is daarom geen eigen bron van werken maar een aanvulling, net als A-Sign laag 19:

- De dagelijkse verversing (`scripts/fetch-sources-awv-werf.mjs`, eigen budget van 60 s) schrijft `site/sources/awv-werf-supplement.json`. Ze vraagt alleen vaste velden: werf, GIPOD-id, afdeling, soort werk, status, fase, van- en totdatum, innametypes, maatregelen, route voor uitzonderlijk vervoer, laatste wijziging en de lijn; van een lokale omleiding alleen voor wie ze geldt. Nooit `Omschrijving`, `URL` of `Buffer_publicatie`.
- Alleen bevestigde innames (`InUitvoering`, `ConcreetGepland`, `ConcreetVoorUitvoering`) met een GIPOD-id, die vandaag nog lopen of komen en waarvan de lijn de exacte districtsgrens raakt. Werven "in opmaak" of "niet concreet gepland" komen nooit binnen. Een inname zonder einddatum valt weg.
- Tekst gaat door een woordenlijst: rijstroken en delen van de weg, doorgang, snelheidsbeperking, doorsteek, tijdelijke bypass en voor wie een omleiding geldt. De soort werk (`Type`) alleen uit een vaste lijst van 23 AWV-categorieën, zoals "(Her)aanleg", "Rijbaan incl. riolering", "VRI" en "Mobiel" (gemeten op 17 oktober 2026 in alle 11.954 innames en 2.841 werven in het kader van het district). Wat niet past, valt weg en wordt nergens getoond. De fase alleen als ze eruitziet als "Fase 2" of een maandnaam, nooit een code of initialen.
- De site hangt de aanvulling alleen aan een werk dat al getoond wordt, op exact hetzelfde GIPOD-id. De zin staat alleen op de werkkaart in de lijst van het district; de plekpagina (het kader van één straat) toont hem nog niet. Dat volgt na de merge van `claude/vaag-c-werf-en-bundels`. De status blijft die van GIPOD (AWV geeft de status per werf, GIPOD per record). Op de werkkaart staat "Volgens AWV-werfdata: …" met de bronvermelding "Bron: Agentschap Wegen en Verkeer (AWV), open data Werf, bijgewerkt op …" en een link naar de metadatafiche. De tekst laat geen goedkeuring door AWV vermoeden.
- Faalt een vraag, is een antwoord afgekapt of ongeldig, of komen er 0 innames terwijl de vorige ronde er meer dan 20 had, dan blijft het vorige bestand staan en staat de fout in `refresh-status.json`. Een bestand ouder dan 3 dagen toont de site niet meer. Een ontbrekende aanvulling betekent niets: AWV is ook voor zijn eigen werken niet volledig (7 AWV-werken in GIPOD staan niet in Werf).

## Hinder zonder gepubliceerd werk

GIPOD publiceert soms gevalideerde hinder waarvan het werk zelf niet in de open laag `INNAME_PUNT` staat. Meting 17 oktober 2026: 64 zulke hinderberichten in het district (zonder evenementen), met 43 oorzaken die nergens in de open laag staan. Die hinder hing aan geen enkel getoond werk.

Ze staat nu in een apart, duidelijk benoemd blok "Hinder zonder gepubliceerd werk (GIPOD)" onder de werkenlijst (`losseHinder` in `site/works-hindrance.js`), met de zin "GIPOD publiceert deze gevalideerde hinder, maar het werk zelf staat niet bij de getoonde werken." Meer weet het blok niet zeker: het toetst de oorzaak alleen tegen de getoonde werken en het gefilterde antwoord van `INNAME_PUNT`. Een werk met een andere status, of in de strook tussen het kader van de werken en het ruimere kader van de hinder, kan wel in de open laag staan. Er komt geen nieuwe vraag bij: het blok gebruikt de `HINDER_PUNT`-features die de werkenlaag al ophaalt. Regels:

- alleen `Gevalideerd`, met een zonepunt binnen de officiële districtsgrens, en nog niet voorbij;
- elke oorzaak is een werk of grondwerk (geen evenement of markt), en geen enkele oorzaak wordt al getoond of staat in het antwoord van `INNAME_PUNT`;
- één item per hinder (de zones samen): de gevolgen samen, ernstig als één zone ernstig is, de vroegste start en het laatste einde;
- weg: zonder gevolgen en niet ernstig, een einde meer dan 2 jaar ver, of al lopend en meer dan een jaar niet gewijzigd;
- de plaats is alleen een straatnaam uit de straatas, nooit een huisnummer; de omschrijving, de beheerder en de contactorganisaties worden niet getoond;
- geen bronlink per hinder: een vraag naar `HINDER_PUNT`, ook gefilterd op `HindranceGipodId`, toont het ruwe record met `HindranceContactOrganisations` (contactnaam, e-mail, telefoon). Onder het blok staat één bronvermelding "Bron: GIPOD (Digitaal Vlaanderen)" met een link naar de officiële datasetfiche op metadata.vlaanderen.be (2b4b3bb7);
- zonder districtsgrens of hinderbron verschijnt het blok niet, en de notitie zegt dat.

Proef op de gemeten data van 17 oktober 2026 (1.214 getoonde werken): 52 items in het blok, waarvan 23 ernstig.

Op 49 van de 64 plekken toont de agenda al een A-Sign-werfzone of -omleiding in dezelfde periode, maar zonder de gevolgen of de ernst; 14 staan nergens. Het beleid houdt SGW en GIPOD als aparte bronlagen, dus dit is geen dubbel.

Vervallen: het plan om op een werkkaart een link naar de hinder te zetten. `HindranceURI` (gipod.api.vlaanderen.be) vraagt een login (HTTP 401), en een filterlink op `HINDER_PUNT` toont het ruwe record met de contactorganisaties; de werkkaart toont de gevolgen en de ernst van de gekoppelde hinder, met GIPOD als bron. Nog open: de exacte grens-snapshot van 27 september mist 2 nieuwe werken die de grens raken; die snapshot hoort in de verversing ververst te worden (aparte PR).

## Geen links naar ruwe GIPOD-records

Een ruw GIPOD-record (een werk, grondwerk, inname, markt of hinder) draagt een veld `ContactOrganisations` of `HindranceContactOrganisations`: een lijst met `ContactRole`, `OrganisationName`, `OrganisationId`, `ContactName`, `Email`, `Telephone` en `Url`. De site linkt daarom nergens nog naar zo'n record. Meting van 17 oktober 2026 (OGC API, alle pagina's in het kader van het district, gefilterd op de officiële grens; alleen aantallen):

- werken en grondwerken (`INNAME_PUNT`): bij 10 van de 1.193 GIPOD-id's is het contactveld gevuld (11 contactobjecten), bij 7 met een persoon (naam en eigen mailadres), bij 1 ook met een gsm-nummer. `INNAME` (vlakken) geeft dezelfde 10 id's;
- gevalideerde hinder (`HINDER_PUNT`): 1 van de 587 id's, met 1 persoon;
- markten: 0 van de 26 marktrijen in de hele stad; GIPOD-evenementen in het district: 40 van de 114 id's, telkens een functionele mailbox van de dossierbeheerder, 0 namen van personen;
- in de andere tekstvelden (omschrijving en zo meer): 0 mailadressen en 0 telefoonnummers.

Wat de links met één klik gaven: de filterlink van de plekpagina (`…/collections/INNAME_PUNT/items?f=html&filter=GipodId=…`, "Technische databron") toonde bij 4 van de 4 geteste werken met een persoon diens naam en mailadres. De `Uri` op gipod.api.vlaanderen.be ("Technische GIPOD-bron" op de werkkaart, "bron" in het overzicht per straat en in de vooruitblik) gaf 4 van de 4 keer HTTP 401: geen gegevens, wel een dode link. De `INNAME_PUNT`-rij van een markt (eventpagina, feed, .ics) gaf HTML met een leeg contactveld; dat hangt af van wat de beheerder morgen invult.

De regel (`site/gipod-bron.js`, `ruwGipodRecord`):

- per werk alleen Hinder in Kaart (de officiële viewer, met het GIPOD-nummer); het GIPOD-nummer blijft als tekst staan;
- waar de site een GIPOD-bron toonde, staat één bronvermelding "Bron: GIPOD (Digitaal Vlaanderen)" met een link naar de officiële datasetfiche (metadata.vlaanderen.be, 2b4b3bb7): onder de werkenlijst, onder het blok losse hinder, op de plekpagina bij een werk, en als bronlink van een markt of GIPOD-evenement (feed, eventpagina, agenda; in de .ics gaat de marktpagina van de stad voor);
- geen link per item naar `gipod.api.vlaanderen.be` of naar de items van een GIPOD-collectie op `geo.api.vlaanderen.be` (een id, een `GipodId`-filter of een kader), ook niet in de gegenereerde bestanden: de straatbestanden (`site/straat/*.json`) houden geen GIPOD-URL meer, de bronnen `stad-markten` en `district-gipod-evenementen` laten `geo.api.vlaanderen.be` niet meer toe, en een automatische fiche noemt de datasetfiche als bron;
- ophalen blijft via de OGC API: dat zijn vragen van de code, geen links voor bezoekers.

`tests/gipod-geen-ruwe-links.test.mjs` toetst de code en de uitvoer van de build (feed, eventpagina's); `scripts/validate-data.mjs` maakt van een ruwe link in de feed of een eventpagina een fout. De bronbestanden, de straatbestanden en de automatische herkenning schrijft alleen de dagelijkse verversing: tot de eerste verversing na deze wijziging staan daar nog oude URL's in, en dat is een signaal (geen fout). Build:sources en de fetchers lezen een bronbestand van vóór 17 oktober 2026 in de nieuwe vorm (`zonderRuweGipodBron` in `lib/source-feed.mjs`).

## De Vlaamse Waterweg

Nagekeken op 17 oktober 2026. De wervenkaart van De Vlaamse Waterweg (https://www.vlaamsewaterweg.be/nl/werven) heeft geen open data-ingang. De punten op de kaart zitten alleen in de webpagina zelf: 212 punten van 166 werven, met titel, status en een punt, maar zonder datums. Er is geen API, geen GeoJSON- of WFS-dienst en geen dataset op metadata.vlaanderen.be. De disclaimer van de site verbiedt bovendien kopiëren en opnieuw publiceren zonder schriftelijke toestemming. Binnen de districtsgrens liggen 6 werven: Scheldekaaien, kaaimuur Rijnkaai, ponton Steenplein, Sint-Annastrand, Sigmaplanwerken Blue Gate en de geplande fiets- en voetgangersbrug. De categorie "Antwerpen" op de site telt er 7. Daarvan liggen er 2 buiten het district (Fort Lillo en Metropoolstraat), en de fietsbrug ontbreekt. In GIPOD staan in heel Vlaanderen maar 8 werken met beheerder De Vlaamse Waterweg, en geen enkel daarvan ligt in het district.

De Vlaamse Waterweg blijft daarom een link en geen automatische bron. Dat verandert pas als De Vlaamse Waterweg een open, machineleesbare werfbron met een punt per werf publiceert, of schriftelijk toestemming geeft. Automatische publicatie vraagt dan nog altijd een punt of geometrie per werf en dezelfde districtstoets als de andere ruimtelijke bronnen.
