# Dekkingsmatrix publieke agenda

Stand: 29 september 2026.

Deze matrix is de canonieke lijst van wat de publieke agenda wil dekken. Een onderdeel is pas **opgelost** wanneer de bron automatisch gekoppeld is, district-correct wordt gefilterd waar dat nodig is, actuele status/timing en bronvermelding heeft, privacyveilig is, bronuitval zichtbaar blijft en de werking ook werkelijk getest is. Alleen geparste code, lokaal onderzoek of een niet-geteste livebron telt dus niet als opgelost.

| # | Domein | Stand | Bron / bewijs | Nog open |
|---|---|---|---|---|
| 1 | Activiteiten en sport | Gekoppeld / breed | Districtskalender, districtsnieuws, nieuws van 9 andere districten, gratis koopzondagen, bronmerge en expliciete activiteittypes. Buurt- en straatfeesten worden beschermd als `Buurt & straat`. | UiT blijft alleen optioneel met sleutel; geen betaalde bron nodig voor de bestaande dekking. |
| 2 | Grote/langlopende werken uit mails | Gekoppeld als dubbelcheck | Werkenlaag bestaat; mailsignalen zijn privacyveilig en de dataverversing heeft `mail-district` en `mail-stad` opnieuw met status `ok` geconsumeerd. | Een lege/stale mailronde levert terecht 0 publieke items; GIPOD blijft de primaire werkenbron. |
| 3 | GIPOD-werken | Gekoppeld | Live `INNAME_PUNT`, Werk/Grondwerk, status In uitvoering/Concreet gepland, officiële districtsgrens + exact snapshot. | Eerste history-baseline nog afwachten; Render-liveversie afzonderlijk bewijzen. |
| 4 | Beheerders/operatoren | Gekoppeld / deels | GIPOD Owner wordt als opdrachtgever/beheerder gegroepeerd. | De Vlaamse Waterweg alleen automatisch toevoegen als een machineleesbare, geografisch filterbare werfbron bewezen is. |
| 5 | GIPOD-hinder | Gekoppeld | Gevalideerde `HINDER_PUNT` via `HindranceConsequenceOf`. | Ontbrekende match blijft bewust onbekend. |
| 6 | A-Sign/SGW-verrijking | Gekoppeld | A-Sign publieke-ruimtelagen + Werfsignalisatie-supplement op exact GIPOD-id. | Laag 19 blijft sparse/legacy en is nooit volledige aannemerdekking. |
| 7 | Parkeerverboden | Gekoppeld | A-Sign goedgekeurd/in effect, District ANTWERPEN. | History-baseline afwachten. |
| 8 | Innames openbaar domein | Gekoppeld | IOD polygon/lijn, publieke statussen, exacte districtsgeometrie; veilige fasecontext. | History-baseline afwachten. |
| 9 | Afsluitingen, omleidingen en werfzones | Gekoppeld | SGW lagen 47/48, status vergund, exacte districtsgeometrie. | History-baseline afwachten. |
| 10 | Speelstraten | Gekoppeld / operationeel, juridisch deels | eBesluit-classificatie en 2026-goedkeuringen zijn bewezen; daarnaast accepteert de GIPOD-evenementenbron alleen expliciete `Speelstraat`-records met concrete districtsstraat, exacte puntfilter en maximaal 14 dagen. | Eerstvolgende refresh moet bewijzen welke Antwerpse GIPOD-speelstraten actueel binnenkomen. De volledige juridische goedkeuringslijst uit eBesluit blijft fail-closed zolang de PDF-bijlagen niet uitleesbaar zijn. |
| 11 | Evenementen / straatinname | Gekoppeld / conservatief | Activiteitenfeeds + IOD/SGW én `district-gipod-evenementen`: alleen GIPOD `Type=Evenement`, actuele/geplande status, expliciete evenementkenmerken en exact punt binnen District Antwerpen. Buurtfeest, wijkfeest, straatfeest, pleinfeest en burenfeest zijn expliciet als publieke evenementtermen beschermd. | De GIPOD-selectie is bewust geen volledige evenementeninventaris: commerciële/markt/terrasachtige innames vallen weg en alleen 30 dagen vooruit wordt gelezen. |
| 12 | Markten en foren | Gekoppeld | Vaste markten via GIPOD; eBesluit positieve foren/feestdagmarkten; bronbewuste annuleringen onderdrukken alleen `stad-markten`. | Volgende refresh bewijst actuele brondata. |
| 13 | Aannemer / project / fase | Deels | IOD faseNaam/type_dossier/innameHinder; A-Sign Bedrijf/werf/fase als supplement via exact GIPOD-id. | `Bedrijf volgens A-Sign` is geen gegarandeerde juridische aannemer; geen volledige aannemerbron gevonden. |
| 14 | Snapshots / wijzigingshistoriek | Operationeel, eerste bewijsrun faalde gesloten | De datalaan heeft `site/history/live-layers.json` automatisch aangemaakt. De eerste run registreerde `street_axis_invalid` zonder valse data; de straatas-paginering is daarna op main gerepareerd. 90 dagen added/changed/removed blijven fail-closed. | Volgende 05:17-refresh moet de eerste gezonde works/publicSpace-baseline bewijzen. |
| 15 | Alles per straat | Gekoppeld + District-radar | Officiële Antwerpse straatas; werken via punt, parkeren via adres, IOD/SGW via geometrie; straatfiche bundelt live lagen + betrouwbare agenda-items. De District-radar toont feitelijke overlap, ernstige hinder en wijzigingsstatus. | Render-liveverificatie en een gezonde history-baseline blijven apart te bewijzen. |\n| 16 | Buurt- en straatfeesten | Gekoppeld | Districtsfeeds + GIPOD-evenementen herkennen expliciet buurtfeest, wijkfeest, straatfeest, pleinfeest en burenfeest; tests beschermen deze termen. | GIPOD blijft conservatief en is geen volledige evenementenvergunningsinventaris. |\n| 17 | Openbare districtsraad en raadscommissies | Gekoppeld | `district-vergaderingen` leest de officiële jaartabel van district Antwerpen en valideert kalenderdatum + weekdag fail-closed. | Alleen openbare, officieel gepubliceerde zittingen worden opgenomen. |\n| 18 | Koopzondagen | Gekoppeld | Gratis officiële antwerpen.be-bron; zes toekomstige koopzondagen zijn al als brondata aanwezig. Een body-read-herkansing is op main toegevoegd. | Volgende refresh moet de herstelde fetchstatus bevestigen. |

## Brongrenzen

### De Vlaamse Waterweg

De officiële wervenkaart is relevant en publiceert projectstatus/hinder. Individuele Antwerpse projectpagina's kunnen zeer bruikbare informatie bevatten, zoals Rijnkaai met fasering, hinder en uitvoerder. De huidige bron is echter nog niet als machineleesbare geodatafeed bewezen. De algemene categorie “Antwerpen” mag niet als districtsfilter worden gebruikt, omdat ze ook locaties buiten District Antwerpen kan bevatten. Tot er een betrouwbare geografische bron of kaartfeed is gevonden, blijft De Vlaamse Waterweg een aanvullende gecontroleerde bron en geen automatische districtsfeed.

### Speelstraten

Voor 2026 zijn de officiële eBesluit-goedkeuringen en bijlagenamen bewezen, maar de bijlagebytes/document-id zijn via de huidige publieke routes niet bereikbaar. De juridische volledige lijst blijft daarom fail-closed. Operationele speelstraten kunnen wel uit GIPOD komen, maar uitsluitend wanneer het record expliciet `Speelstraat` is, een concrete districtsstraat bevat, exact binnen de districtsgrens valt en maximaal 14 dagen duurt. GIPOD vervangt de eBesluit-bijlage dus niet; het levert een afzonderlijke actuele uitvoeringslaag.

### Mailsignalen

De lokale mailronde produceert alleen privacyveilige publieke signalen. De companion-upload had een identity-mismatch maar is na de #928-fix opnieuw succesvol: `mail_signalen_uploaded` is runtime gemeten. De eerstvolgende publieke-agenda-refresh moet nog bewijzen dat `mail-district` en `mail-stad` opnieuw door de datalaan worden geconsumeerd.

## Eerstvolgende controles

1. Na de 05:17-refresh: gezonde history-baseline, koopzondagenbron, GIPOD-evenementenbron, eBesluit en datatak controleren. Mailsignalen zijn al opnieuw door de datalaan geconsumeerd.
2. Render-liveverificatie van de straatfiche en de live bronlagen.
3. Speelstraatbijlage alleen vervolgen zodra een echte publieke PDF/document-id gevonden is.
4. De Vlaamse Waterweg alleen automatiseren na bewezen geografische feed.
5. Politieke-toolbridge pas openen nadat de politieke-tool-CI veilig als managed workflow is gebonden; geen tweede externe fetcher bouwen.
6. Gateway PR #930 pas mergen nadat de generieke npm-auditblokker (`ip-address`) via de aparte securityroute is opgelost.
