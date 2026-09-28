# Live werkenlaag — bronbeleid

Stand: 28 september 2026.

De publieke agenda leest live GIPOD `INNAME_PUNT` voor `Werk` en `Grondwerk` met status `In uitvoering` of `Concreet gepland`.

Een werk wordt getoond als het GIPOD-id in de laatste exact polygon-gevalideerde districtsnapshot zit, of als het een nieuw id is waarvan het actuele GIPOD-punt binnen de officiële districtsgrens ligt. Nieuwe puntgebaseerde records worden apart gemarkeerd.

GIPOD `Owner` betekent opdrachtgever/beheerder, niet automatisch aannemer. A-Sign laag 19 `Werfsignalisatie` mag uitsluitend als aanvullend signaal worden gebruikt wanneer een goedgekeurd, nog actueel record via exact hetzelfde `GipodID` aan een reeds aanvaard districtswerk koppelt. `Bedrijf` wordt gelabeld als “Bedrijf volgens A-Sign”, niet automatisch als juridische aannemer. Veilige supplementvelden zijn Bedrijf, DossierType, WERF_TYPE, FASEID, Fasestatus, VerkeersImpact en DossierHinder. `DetailLigging` en `Link` worden niet opgehaald of gepubliceerd. Omdat laag 19 legacy/sparse is, betekent een ontbrekend supplement niets over het ontbreken van een aannemer. Gevalideerde `HINDER_PUNT`-records worden via `HindranceConsequenceOf` gekoppeld aan het veroorzakende werk. Publiek worden alleen gevolgen, ernst, periode en de officiële hinderbron gebruikt; contactorganisaties worden niet overgenomen. Ontbrekende hinder blijft `onbekend` en betekent niet automatisch geen hinder. Parkeerverboden, IOD, SGW, speelstraten, markten en evenementen blijven afzonderlijke bronlagen.

Bij uitval van de officiële grens valt de pagina terug op alleen de exact gevalideerde snapshot. Bij uitval van GIPOD blijft de bestaande agenda bruikbaar.

## De Vlaamse Waterweg

De officiële wervenkaart en projectpagina's van De Vlaamse Waterweg zijn een nuttige aanvullende bron. Individuele projectpagina's kunnen concrete timing, fasering, hinder en uitvoerder bevatten. Ze worden nog niet automatisch als districtslaag ingelezen omdat de huidige wervenkaart niet als machineleesbare, geografisch filterbare feed is bewezen. Een brede categorie “Antwerpen” is onvoldoende: die kan ook locaties buiten District Antwerpen bevatten. Automatische publicatie vereist eerst een betrouwbare locatie/geometrie per werf en dezelfde districtstoets als andere ruimtelijke bronnen.
