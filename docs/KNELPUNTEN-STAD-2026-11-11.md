# Knelpunten met de stad: wat de publieke agenda tegenhoudt

Stand van 11-11-2026. Een lijst voor een gesprek met stad Antwerpen: welke bron geblokkeerd is, sinds wanneer, wat het
kost, wat er nu in de plaats komt, en wat de stad zou kunnen doen. Alles hieronder is nagekeken met de gewone
User-Agent van de agenda (`publieke-agenda-antwerpen/1.0`), eerst `robots.txt`, daarna alleen lezen. Er wordt nergens
omheen gewerkt: geen andere User-Agent, geen omweg, geen herhaling.

De technische uitleg per bron staat in `docs/AGENDA_SOURCES.md`; de vragen over evenementen- en werfdossiers zonder
naam staan in `docs/VRAGEN_AAN_DE_STAD.md`.

## In het kort

- Sinds de nacht van 22 op 23-10-2026 weigert www.antwerpen.be elke automatische lezer (403 "Access Denied" van de
  rand, ook voor `robots.txt`). Vijf bronnen vielen daardoor stil: de districtskalender, het districtsnieuws, de
  projecten van het district, het nieuws van de negen andere districten en de koopzondagen.
- In de 24 dagen ervoor (28-09 tot 22-10) kende de agenda uit die vijf bronnen samen 94 verschillende activiteiten;
  25 kwamen er in die periode nieuw bij, vooral uit de andere districten. Sinds 23-10 komt er niets nieuws meer bij.
- De site toont de laatst gekende stand tot elke activiteit voorbij is. Op 10-11 waren nog 41 van de 61 laatst
  gekende activiteiten komend; dat aantal zakt elke week.
- Het eenvoudigste wat de stad kan doen: de agenda toelaten op www.antwerpen.be (één verzoek per bron per dag), of
  dezelfde kalenders als open data publiceren, zoals de stad al doet voor markten, foren en schoolstraten.

## Per weggevallen bron

| Bron | Wat ze gaf | Geblokkeerd sinds | Wat het kost | Wat er nu in de plaats komt | Wat de stad kan doen |
|---|---|---|---|---|---|
| Districtskalender ("Wat beleef je in district Antwerpen?") | activiteiten van en in het district, met datum, uur en plaats | 23-10-2026 (laatste goede lezing 22-10) | 17 activiteiten gekend op 28-09; op 10-11 nog 4 van de laatste 8 komend. De activiteiten voor december en januari ontbreken. | Deels: eBesluit (activiteiten met een besluit, het Districtsfonds) en A-Sign (evenementen op straat). Activiteiten in een gebouw zonder besluit (bibliotheek, senioren, cultuur) ontbreken. | De agenda toelaten, of de kalender als open data (JSON of iCal) publiceren, of in UiT zetten en toegang geven (zie "UiT" onder). |
| Districtsnieuws | aangekondigde activiteiten uit nieuwsartikels | 23-10-2026 | 5 gedateerde activiteiten in 24 dagen; op 10-11 nog 1 komend. | Niets automatisch. De nieuwsbrief per mail linkt via nieuwsbrief.antwerpen.be (`robots.txt`: `Disallow: /`) naar www.antwerpen.be: niet na te kijken, dus niet gepubliceerd. | Een RSS-feed van het nieuwskanaal, of de agenda toelaten. |
| Projecten van het district | inspraak- en infomomenten, bevragingen, fasen van heraanleg | 23-10-2026 | 18 punten op de laatste lezing, 15 nog komend (vooral werffasen). Nieuwe inspraak- en infomomenten sinds 23-10 ontbreken. | Werken: GIPOD, A-Sign en AWV (wel data van werken, geen inspraak). eBesluit noemt projectbesluiten, maar zonder datum van een infomoment. | Een open lijst van inspraak- en infomomenten (project, datum, uur, plaats, link), bijvoorbeeld als laag op het open-dataportaal naast de schoolstraten. |
| Nieuws van de negen andere districten | activiteiten in Berchem, Borgerhout, Deurne, Merksem, Ekeren, Wilrijk, Hoboken, Borsbeek en Berendrecht-Zandvliet-Lillo | 23-10-2026 | 20 nieuwe activiteiten in 24 dagen (ongeveer 6 per week); op 10-11 nog 17 van 26 komend. | Nieuw sinds 11-11: collegebesluiten over evenementen in die districten (eBesluit). Op 11-11: 1 komende activiteit. | Zoals bij de districtskalender: toelaten of open data, per district. |
| Koopzondagen | de koopzondagen van het jaar | 23-10-2026 | 4 koopzondagen van december staan er nog uit de laatste lezing. | Niets. De wet van 20-07-2026 schafte de verplichte wekelijkse rustdag af; volgens het college vervallen de afwijkingen van 2026 (besluit 2026_CBS_07405). Er komt dus wellicht geen lijst voor 2027. | Bevestigen of de lijst blijft bestaan; zo ja, als open data. |

## Andere drempels

| Wat | Stand op 11-11-2026 | Wat de stad kan doen |
|---|---|---|
| UiTdatabank (publiq), de echte tweede bron voor activiteiten in stad en district | De Search API antwoordt zonder sleutel 401. Productie kost 125 euro per jaar (excl. btw, Basic plan) of een gratis integratie voor leden van het UiTnetwerk. De ophaler staat klaar en is uit. | De stad is partner van UiT: de agenda een client-id geven binnen de afspraken van de stad, of de eigen UiT-activiteiten van stad en districten als open data publiceren. |
| Agenda van de bibliotheken (antwerpen.bibliotheek.be) | Technisch leesbaar (`robots.txt` laat het toe, elke activiteit heeft een schema.org Event met datum en adres), maar de gebruiksvoorwaarden verbieden hergebruik van de gegevens zonder schriftelijke toestemming van Cultuurconnect of de bibliotheek. Niet gebruikt. | Schriftelijke toestemming geven voor de activiteiten van de stadsbibliotheken, met bronvermelding. |
| Webversie van de nieuwsbrieven (nieuwsbrief.antwerpen.be) | `robots.txt`: `Disallow: /`. | Een openbaar archief of RSS van de nieuwsbrieven van stad en districten. |
| Andere sites van de stad | visit.antwerpen.be en www.antwerpenmorgen.be: dezelfde 403. www.districtantwerpen.be stuurt door naar www.antwerpen.be. | Dezelfde toelating. |
| De regels van de site zelf | Ook `robots.txt` van www.antwerpen.be geeft 403: de regels voor automatische lezers zijn niet te lezen. | `robots.txt` bereikbaar maken, zodat een lezer weet wat mag. |
| eBesluit | Werkt, maar alleen met de verwijzer van de site zelf (`Referer`): zonder die kop een lege 403. Sinds 13-10-2026 gaf de zoekfunctie 's nachts vaak HTTP 500; de agenda valt dan terug op de maandkalender. | De besluiten ook als gelinkte open data publiceren. In de centrale vindplaats van Lokaal Beslist (LBLOD) vonden we op 11-11 geen zittingen van stad Antwerpen. |
| Open-dataportaal van de stad | Markten, foren en schoolstraten (die leest de agenda al). Geen activiteitenkalender, koopzondagen of inspraakmomenten (gezocht op evenement, activiteit, agenda, koopzondag, inspraak). | De vijf weggevallen kalenders hier publiceren. |
| Evenementen in GIPOD | Stad Antwerpen zet in GIPOD alleen markten en ambulante handel; evenementen staan alleen in A-Sign, vaak zonder naam. | Evenementen met naam en organisator in GIPOD of A-Sign (zie `docs/VRAGEN_AAN_DE_STAD.md`). |

## Buiten de stad

| Wat | Stand op 11-11-2026 |
|---|---|
| Kalender van de provincie (www.provincieantwerpen.be) | `robots.txt`: `Disallow: /nl/kalender`. Niet gebruikt; een open feed van de provincie zou provinciale activiteiten in Antwerpen mogelijk maken. |
| De Grote Verbinding (Lantis) | Een JSON-lijst van komende "doe mee"-momenten (7 op 11-11, vooral jobevents en doorlopend aanbod), zonder gedocumenteerde API. Niet ingebouwd; een gedocumenteerde feed van infomomenten zou helpen. |
| Burgerbegroting (burgerbegroting.be) | Bereikbaar, maar alleen de jaarfasen, geen agenda. |
| UiTinVlaanderen | `robots.txt` laat de activiteitenpagina's toe, maar de gegevens zijn van publiq (betalende Search API). Niet gebruikt. |

## Wat efficiënter kan

- Vóór 5-11-2026 kreeg www.antwerpen.be elke ochtend een dozijn geweigerde verzoeken van de agenda; nu één proef per
  dag. Eén open feed per kalender vervangt al die verzoeken en het lezen van webpagina's.
- Een vaste vorm (open data met datum, uur, plaats met huisnummer en link) maakt de controles van de agenda overbodig
  die nu nodig zijn om datums en adressen uit vrije tekst te halen.
- Eén toelating volstaat voor alle vijf bronnen: ze lezen dezelfde publieke portaal-API van www.antwerpen.be.
