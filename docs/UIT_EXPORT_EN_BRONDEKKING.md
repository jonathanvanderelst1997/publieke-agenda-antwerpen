# Bronkwaliteit en vooruitblik — interne controle

Stand: 11 november 2026. Dit document beschrijft alleen de kwaliteitscontrole. Het kent geen nieuw publicatierecht toe en activeert geen bron.

## Maandelijkse vooruitblik

De bestaande dagelijkse inhoudsaudit (`npm run audit:events`; onderdeel van `npm run check`) toont nu per maand een venster van twaalf maanden vanaf de classificatiedag. De cijfers zijn: aantal agendaregels, aantal zonder wekelijkse markten, district, stad en aantal verschillende bronnen. Meerdaagse evenementen tellen in elke maand waarin zij lopen. Het overzicht staat in de GitHub Actions-log en in de job summary; bezoekers zien geen nieuwe meldingen.

**Een lege of dun bezette maand bewijst niet dat er geen activiteiten zijn.** Vergelijk met de brongezondheid (`npm run sources:health`), de laatste goede bronlezing en officiële geplande activiteiten. De code vult nooit zelf een evenement, datum, naam of locatie in.

## UiTdatabank: handmatige controle versus live-import

- De officiële beheeromgeving kan zoekresultaten exporteren naar Office Open XML (Excel) en JSON. Zie: https://helpdesk.publiq.be/hc/nl/articles/360008632520 en https://helpdesk.publiq.be/hc/nl/articles/360008632420.
- Gebruik de export voorlopig uitsluitend voor interne controles op aantallen, dubbele vermeldingen en ontbrekende bron-ID's, niet als automatisch publicatiebestand en niet als vervangende livefeed.
- Voor de live Search API of widgets is een eigen toegestane integratie nodig. Het Basic-abonnement is op het moment van onderzoek €125 per jaar per website; UiTnetwerkleden kunnen mogelijk gratis integreren. **Voor deze zelfstandige website is geen gratis productiegebruik aangetoond.** Actuele voorwaarden: https://www.publiq.be/nl/projecten/publiq-platform/prijzen en https://www.publiq.be/nl/projecten/publiq-platform/gebruiksvoorwaarden.
- Geen sleutel of exportbestand in Git opnemen. Niets omzeilen bij een robotsblokkade; geen gegevens of screenshots overnemen uit privé-mails.

## Prioriteit voor verdere bronkoppelingen

1. Controleer dat de dataverversing en de liveversie werkelijk dezelfde momentopname gebruiken. Onderzoek daarna de bronuitval sinds 23 oktober 2026, zonder blokkades te omzeilen.
2. Zoek officiële, herbruikbare databronnen voor stads- en districtsactiviteiten die niet binnenkomen. De bestaande eBesluit-, GIPOD-, A-Sign- en andere koppelingen blijven leidend.
3. Onderzoek schriftelijk of een zelfstandige publieke agenda kan aansluiten bij het UiTnetwerk of een geautoriseerde partnerintegratie. Niet betalen of aanvragen namens een partner zonder toestemming.
4. Gebruik nieuwsbrieven alleen als aanvullend signaal, met publieke bronherbevestiging en automatische ontdubbeling; voeg geen privé-uitnodigingen toe.
5. Vergelijk de maandelijkse vooruitblik tot minstens het begin van 2027 met de huidige bronkwaliteit. Publiceer uitsluitend officieel gedateerde gegevens. Leg afwijkingen in een intern dossier vast, niet in publiek bereikbare brondata.
