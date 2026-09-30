# Dekkingsmatrix publieke agenda

Stand: 30 september 2026.

Deze matrix is de canonieke lijst van wat de publieke agenda wil dekken. Een onderdeel is pas **opgelost** wanneer de bron automatisch gekoppeld is, district-correct wordt gefilterd waar dat nodig is, actuele status/timing en bronvermelding heeft, privacyveilig is, bronuitval zichtbaar blijft en de werking werkelijk getest is. Een gebouwde parser of een oude data-snapshot telt dus niet als actuele brongezondheid.

| # | Domein | Stand | Wat nu werkelijk gekoppeld is | Nog open |
|---|---|---|---|---|
| 1 | Activiteiten en sport | Gekoppeld / breed | Districtskalender, volledig gepagineerd districtsnieuws, nieuws van 9 andere districten, koopzondagen, GIPOD-evenementen, expliciete activiteittypes en bronmerge. Buurt-, wijk-, straat-, plein- en burenfeesten zijn beschermd als `Buurt & straat`. | UiT blijft optioneel zonder sleutel. Eerstvolgende data-refresh moet de actuele brongezondheid opnieuw bewijzen. |
| 2 | Grote/langlopende werken uit mails | Deels | GIPOD-werkenlaag is canoniek; privacyveilige mailsignalen zijn een aanvullende dubbelcheck. | Mailbron moet na een nieuwe refresh opnieuw als vers worden gemeten; mail is nooit de primaire werfbron. |
| 3 | GIPOD-werken | Gekoppeld | Live Werk/Grondwerk, statussen In uitvoering/Concreet gepland, officiële districtsgrens, straatkoppeling en A-Sign-supplement. | Actuele history-snapshot na de straatasfix opnieuw laten verversen. |
| 4 | Beheerders/operatoren | Gekoppeld | GIPOD `Owner` als opdrachtgever/beheerder, met groepen voor Stad, Fluvius, Proximus, Water-link, Aquafin/RioLink, De Lijn, AWV/Lantis en andere eigenaars. De Vlaamse Waterweg wordt automatisch meegenomen wanneer zij eigenaar is van een GIPOD-werk. | Geen aparte onnauwkeurige Waterweg-“Antwerpen”-scraper bouwen. |
| 5 | GIPOD-hinder | Gekoppeld | Alleen gevalideerde `HINDER_PUNT`, gekoppeld via `HindranceConsequenceOf`; ernstige hinder zichtbaar. | Ontbrekende koppeling blijft bewust “onbekend”. |
| 6 | A-Sign/SGW-verrijking | Gekoppeld | Parkeerverboden, IOD, SGW plus sparse Werfsignalisatie-laag 19 als supplement op exact GIPOD-id. | Laag 19 is geen volledige aannemerdatabank. |
| 7 | Parkeerverboden | Gekoppeld | Alleen goedgekeurd/in effect, exact District Antwerpen, officiële straatkoppeling. | Nieuwe history-snapshot nodig voor actuele delta’s. |
| 8 | Innames openbaar domein | Gekoppeld | IOD polygon/lijn, publieke statussen, exacte districtsgeometrie, veilige faseNaam/type_dossier/innameHinder en straatkoppeling. | Nieuwe history-snapshot nodig voor actuele delta’s. |
| 9 | Afsluitingen, omleidingen en werfzones | Gekoppeld | SGW lagen 47/48, vergund, exacte districtsgeometrie en geometrische straatkoppeling. | Nieuwe history-snapshot nodig voor actuele delta’s. |
| 10 | Speelstraten | Gekoppeld operationeel / juridisch deels | GIPOD accepteert alleen expliciete speelstraatrecords met concrete districtsstraat, exacte puntfilter en beperkte duur; eBesluit-goedkeuringen worden geclassificeerd. | Volledige juridische straatlijst uit eBesluit-PDF blijft fail-closed zolang de bijlagebytes/document-id niet betrouwbaar beschikbaar zijn. |
| 11 | Evenementen / straatinname | Gekoppeld / conservatief | Activiteitenfeeds, GIPOD-evenementen, IOD/SGW en expliciete activiteittypes. GIPOD-paginering is ondersteund. | Bewust geen volledige inventaris van elk commercieel/privaat evenement. |
| 12 | Markten en foren | Gekoppeld | Vaste markten via GIPOD, eBesluit-foren/feestdagregelingen, bronbewuste annuleringen en vooruitblik tot een jaar waar de bron dat betrouwbaar toelaat. | Actuele data-refresh opnieuw meten. |
| 13 | Aannemer / project / fase | Deels | IOD-fasecontext en A-Sign `Bedrijf`, werftype en fasestatus als supplement op exact GIPOD-id. | `Bedrijf volgens A-Sign` is geen gegarandeerde juridische aannemer; geen volledige publieke aannemerbron bewezen. |
| 14 | Snapshots / wijzigingshistoriek | Gekoppeld in code | 90 dagen history, added/changed/removed, fail-closed en delta “Sinds vorige verversing”. Straatmetadata veroorzaakt geen operationele nepwijziging. | Opgeslagen baseline op main is nog van vóór straatasfix #37 en moet door een nieuwe refresh gezond worden. |
| 15 | Alles per straat | Gekoppeld | Officiële Antwerpse straatas; werken via punt, parkeren via adres, IOD/SGW via geometrie; straatfiche, District-radar en feitelijke overlap/delta. | Nieuwe history-snapshot voor actuele wijzigingsbadges. |
| 16 | Openbare politieke vergaderingen | Gekoppeld | Districtsraad en openbare raadscommissies, over meerdere jaren waar officieel gepubliceerd. | Alleen publiek gepubliceerde planning tonen; geen interne vergaderingen. |
| 17 | Buurt- en straatleven | Gekoppeld | Buurtfeest, wijkfeest, straatfeest, pleinfeest, burenfeest, buurtbarbecue en straatbarbecue zijn expliciet beschermd en filterbaar. | Alleen tonen met betrouwbare publieke datum/locatie. |
| 18 | Koopzondagen | Gekoppeld | Officiële antwerpen.be-bron, inclusief één herkansing bij afgebroken body. | Actuele data-refresh opnieuw meten. |
| 19 | Volledige vooruitblik | Gekoppeld | District-puls gebruikt geen vaste 7-dagenlimiet maar het verste betrouwbare eindpunt van agenda, werken en maatregelen. GIPOD/eBesluit, vergaderingen, nieuws en markten kijken verder vooruit waar de bron dat toelaat. | Bronhorizon blijft per bron verschillen en wordt zichtbaar vermeld. |
| 20 | Delta / wat veranderde | Gekoppeld | District-radar toont nieuwe, gewijzigde en afgelopen operationele signalen sinds de vorige verversing en betrokken straten. | Vereist een gezonde opeenvolgende history-refresh. |
| 21 | Omgevingsdossiers in behandeling | Gekoppeld | PR #80 is gemergd. De officiële Antwerpse polygonlaag gebruikt alleen structurele velden, exacte districtfilter en straatkoppeling; vrije `Onderwerp`-tekst en `MaatschappelijkeNaam` worden nooit gepubliceerd. | Eerstvolgende live/data-refresh gebruiken om actuele brongezondheid en straatkoppeling te meten. |
| 22 | Terrasvergunningen | Bron bewezen, nog niet gebouwd | Officiële A-Sign-laag 49 bevat polygon, terrastype, status, adres en postcode. | Alleen veilige structurele velden gebruiken; `Beschrijving` en `Ondernemingsnr` niet publiceren. Bouwen na #80 om straatficheconflict te vermijden. |

## Brongrenzen en beslissingen

### De Vlaamse Waterweg

Geen aparte categorie-“Antwerpen”-scraper gebruiken. GIPOD kan De Vlaamse Waterweg rechtstreeks als eigenaar van een werk bevatten en blijft de canonieke districtsgefilterde werkenbron. Een aanvullende Waterwegbron is alleen zinvol als later een machineleesbare geografische feed met aantoonbaar betere project/fase-informatie wordt bewezen.

### De Lijn

De Lijn heeft officiële open-datawebservices voor haltes, routes, storingen en realtime informatie, maar de webservices vereisen een API-key/subscription. Zonder zo'n sleutel wordt geen fragiele HTML-scraper toegevoegd. De bestaande GIPOD-/SGW-lagen blijven de bron voor ruimtelijke hinder die daar officieel geregistreerd is.

### Speelstraten

Operationele speelstraten komen conservatief uit GIPOD. eBesluit blijft de juridische bron, maar de volledige PDF-bijlagenlijst wordt niet gegokt zolang de bytes/document-id niet betrouwbaar publiek bereikbaar zijn.

### Mailsignalen

De Gatewayroute en privacyfiltering zijn gebouwd. De opgeslagen publieke-agendadata op main is nog van een oudere refresh en meldt `upstream_stale`. Een nieuwe dataverversing moet bewijzen dat de actuele companion-upload en consumptie weer end-to-end gezond zijn.

### Omgevingsdossiers

De officiële laag “Omgevingsvergunningen_inbehandeling” wordt als actuele inventaris behandeld, niet als agenda-event: er wordt geen startdatum verzonnen. Vrije tekst en namen worden niet opgevraagd. Na merge van PR #80 worden dossiers via hun polygon aan de officiële districtsgrens en straatas gekoppeld.

### Terrasvergunningen

A-Sign laag 49 is een aparte publieke vergunningeninventaris. Alleen de eerder bewezen structurele kandidaatvelden (`TypeTerrasZone`, `Status`, `adres`, `postcode`, technische record-id en geometrie) mogen worden gebruikt nadat het live schema opnieuw rechtstreeks is bevestigd. `Beschrijving`, `Ondernemingsnr` en andere vrije/identificerende velden blijven buiten de publieke site. Zolang de bronmetadata tijdelijk onbereikbaar is, wordt niets gegokt.

## Eerstvolgende uitvoering

1. De geplande 05:17-data-refresh van 30 september controleren op gezonde works/publicSpace-history en actuele status van eBesluit, GIPOD-evenementen, koopzondagen en mailsignalen. De opgeslagen snapshot op main is nog van vóór de latere fixes en is dus geen actuele gezondheidsmeting.
2. Terrasvergunningen als aparte privacyveilige inventarislaag aan dezelfde straatfiche koppelen zodra laag 49 opnieuw rechtstreeks leesbaar is; veldnamen/statussen worden niet gegokt.
3. Politieke-toolbridge verder uitvoeren zodra de politieke-tool-CI/runner veilig als managed workflow beschikbaar is; geen tweede GIPOD/A-Sign-fetcher bouwen.
4. eBesluit-PDF’s voor de volledige speelstratenlijst alleen hervatten zodra een echte publieke documentroute bewezen is.
5. Nieuwe “wow”-laag: per straat niet alleen inventaris tonen, maar overlap, start/eindmomenten, delta sinds vorige refresh en een prioriteitssignaal wanneer meerdere maatregelen/activiteiten tegelijk samenvallen.
