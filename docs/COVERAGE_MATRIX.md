# Dekkingsmatrix publieke agenda

Stand: 30 september 2026; rij 1, 10 en 11 en de brongrenzen voor speelstraten en mail nagekeken op 10 oktober 2026.

Deze matrix is de canonieke lijst van wat de publieke agenda wil dekken. Een onderdeel is pas **opgelost** wanneer de bron automatisch gekoppeld is, district-correct wordt gefilterd waar dat nodig is, actuele status/timing en bronvermelding heeft, privacyveilig is, bronuitval zichtbaar blijft en de werking ook werkelijk getest is. Alleen geparste code, lokaal onderzoek of een niet-geteste livebron telt dus niet als opgelost.

| # | Domein | Stand | Bron / bewijs | Nog open |
|---|---|---|---|---|
| 1 | Activiteiten en sport | Deels | Districtskalender, districtsnieuws, nieuws van 9 andere districten en de gratis koopzondagenbron. De GIPOD-evenementenbron levert in het district niets (zie rij 11) en de mailbronnen leveren 0 items sinds 29 september 2026. | Oorzaak van de lege mailbronnen in de Gateway (aparte PR); UiT alleen optioneel met sleutel. |
| 2 | Grote/langlopende werken uit mails | Deels | Werkenlaag bestaat; mailsignalen zijn privacyveilig en uploader werkt opnieuw. | Bewijzen dat de volgende agenda-refresh mailsignalen opnieuw als bron consumeert. |
| 3 | GIPOD-werken | Gekoppeld | Live `INNAME_PUNT`, Werk/Grondwerk, status In uitvoering/Concreet gepland, officiële districtsgrens + exact snapshot. | Eerste history-baseline nog afwachten; Render-liveversie afzonderlijk bewijzen. |
| 4 | Beheerders/operatoren | Gekoppeld / deels | GIPOD Owner wordt als opdrachtgever/beheerder gegroepeerd. | De Vlaamse Waterweg alleen automatisch toevoegen als een machineleesbare, geografisch filterbare werfbron bewezen is. |
| 5 | GIPOD-hinder | Gekoppeld | Gevalideerde `HINDER_PUNT` via `HindranceConsequenceOf`. | Ontbrekende match blijft bewust onbekend. |
| 6 | A-Sign/SGW-verrijking | Gekoppeld | A-Sign publieke-ruimtelagen + Werfsignalisatie-supplement op exact GIPOD-id. | Laag 19 blijft sparse/legacy en is nooit volledige aannemerdekking. |
| 7 | Parkeerverboden | Gekoppeld | A-Sign goedgekeurd/in effect, District ANTWERPEN. | History-baseline afwachten. |
| 8 | Innames openbaar domein | Gekoppeld | IOD polygon/lijn, publieke statussen, exacte districtsgeometrie; veilige fasecontext. | History-baseline afwachten. |
| 9 | Afsluitingen, omleidingen en werfzones | Gekoppeld | SGW lagen 47/48, status vergund, exacte districtsgeometrie. | History-baseline afwachten. |
| 10 | Speelstraten | Niet gekoppeld (0 items) | Er is geen publieke lijst. De GIPOD-evenementenbron zou expliciete `Speelstraat`-records nemen (concrete districtsstraat, exacte puntfilter, hoogstens 14 dagen), maar de stad zet geen speelstraten in GIPOD: elke verversing tot en met 10 oktober 2026 gaf 0. De eBesluit-goedkeuringen zijn bewezen, maar de bijlagen met de straten zijn niet uitleesbaar. | Herkennen in A-Sign (trefwoord "speelstraat", pakket P2) zodra de stad ze daar zet. In oktober zijn er geen. |
| 11 | Evenementen / straatinname | Deels: alleen op de kaart | De evenementendossiers van de stad (A-Sign, IOD/SGW) staan als laag op de kaart, meestal zonder naam, en niet als agendapunt in de lijst of de .ics. `district-gipod-evenementen` levert 0: in het district zet de stad in GIPOD alleen markten en ambulante handel; echte evenementen (feest/kermis, sport) staan er alleen van buurgemeenten, buiten het district (meting 10 oktober 2026: 9.083 rijen in het kader, 0 evenementen in het district). De bron gooit alles buiten het district weg en toont dus nooit een evenement van een buurgemeente. Ze heet daarom "GIPOD-evenementen in het district (stad Antwerpen meldt hier geen evenementen; GIPOD bevat vooral buurgemeenten)" en krijgt na 3 kalenderdagen zonder items de status "leeg". | Evenementdossiers als agendapunten met "naam volgt" (P2) en namen uit collegebesluiten (P3). |
| 12 | Markten en foren | Gekoppeld | Vaste markten via GIPOD met een standaard queryhorizon van 365 dagen; per markt wordt de eerstvolgende nog geldige marktdag gepubliceerd om de agenda niet te overspoelen. eBesluit vult foren en feestdagafwijkingen aan; annuleringen onderdrukken alleen `stad-markten`. | Volgende refresh bewijst actuele brondata. |
| 13 | Aannemer / project / fase | Deels | IOD faseNaam/type_dossier/innameHinder; A-Sign Bedrijf/werf/fase als supplement via exact GIPOD-id. | `Bedrijf volgens A-Sign` is geen gegarandeerde juridische aannemer; geen volledige aannemerbron gevonden. |
| 14 | Snapshots / wijzigingshistoriek | Gebouwd en gemergd | 90 dagen history, added/changed/removed, fail-closed, straatmetadata niet als operationele wijziging. | Eerste automatische baseline moet nog door de 05:17-refresh worden aangemaakt en gecontroleerd. |
| 15 | Alles per straat | Gekoppeld in code | Officiële Antwerpse straatas; werken via punt, parkeren via adres, IOD/SGW via geometrie; zichtbare straatfiche en volledige tijdlijn bundelen live lagen + betrouwbare agenda-items zonder vaste UI-horizon. | Render-liveverificatie en history-badges na eerste baseline. |
| 16 | Omgevingsdossiers / vergunningen | Gekoppeld | Privacyveilige laag `Omgevingsvergunningen_inbehandeling`, exacte districtsgeometrie en officiële straatkoppeling; vrije onderwerptekst en maatschappelijke naam worden niet gepubliceerd. | Eerstvolgende refresh en liveweergave blijven controleren. |
| 17 | Terrasvergunningen | Gekoppeld | A-Sign laag 49 als privacyveilige inventaris met structurele velden, exacte districtfilter en straatkoppeling; beschrijving en ondernemingsnummer worden niet opgevraagd. | Bronstatus bij refresh/live blijven bewaken. |
| 18 | Openbare vergaderingen | Gekoppeld | Districtsraad, raadscommissie en bijzondere raadscommissies via officiële districtbron met eBesluit-maandkalender als fail-closed fallback. | Volgende refresh bewijst de actuele komende vergaderingen. |
| 19 | Koopzondagen | Gekoppeld | Officiële pagina van stad Antwerpen; alle nog komende, volledig leesbare koopzondagen uit de gepubliceerde jaarlijsten. | Bronopmaak en jaarwissel blijven via refresh bewaakt. |

## Vooruitkijkhorizon

De agenda gebruikt geen algemene limiet van 7 dagen. Het principe is: **toon zo ver vooruit als de officiële bron betrouwbaar weet**, met per bron een begrensde en controleerbare query.

- GIPOD-evenementen en operationele buurt-/straatfeesten: standaard 365 dagen vooruit.
- GIPOD-markten: standaard 365 dagen bronhorizon; per markt wordt de eerstvolgende geldige marktdag gepubliceerd om duplicaten te beperken.
- Districts- en stadsactiviteiten uit officiële pagina's: alle concreet gedateerde toekomstige items die binnen de geldige publicatieperiode van de bron vallen.
- eBesluit: beslissingen, foren, marktafwijkingen en vergaderingen worden uit de officiële zoek-/kalenderperiodes gelezen; er wordt geen kunstmatige 7-dagenlimiet toegepast.
- Straatfiche en straat-tijdlijn: geen vaste UI-horizon; alles wat de gekoppelde bronnen betrouwbaar aanleveren blijft zichtbaar.
- UiT is optioneel en blijft, wanneer een sleutel ooit wordt gebruikt, bewust apart begrensd door volume/capping; zonder sleutel staat de bron uit.

## Brongrenzen

### De Vlaamse Waterweg

De officiële wervenkaart is relevant en publiceert projectstatus/hinder. Individuele Antwerpse projectpagina's kunnen zeer bruikbare informatie bevatten, zoals Rijnkaai met fasering, hinder en uitvoerder. De huidige bron is echter nog niet als machineleesbare geodatafeed bewezen. De algemene categorie “Antwerpen” mag niet als districtsfilter worden gebruikt, omdat ze ook locaties buiten District Antwerpen kan bevatten. Tot er een betrouwbare geografische bron of kaartfeed is gevonden, blijft De Vlaamse Waterweg een aanvullende gecontroleerde bron en geen automatische districtsfeed.

### Speelstraten

Voor 2026 zijn de officiële eBesluit-goedkeuringen en bijlagenamen bewezen, maar de bijlagebytes/document-id zijn via de huidige publieke routes niet bereikbaar. De juridische volledige lijst blijft daarom fail-closed. In principe kunnen operationele speelstraten uit GIPOD komen (alleen een expliciet `Speelstraat`-record met concrete districtsstraat, exact binnen de districtsgrens, hoogstens 14 dagen), maar de stad zet ze daar niet in: tot en met 10 oktober 2026 kwam er nooit één binnen. Speelstraten staan dus niet in de agenda.

### Mailsignalen

De lokale mailronde produceert alleen privacyveilige publieke signalen. `mail-district` en `mail-stad` leveren sinds 29 september 2026 echter 0 items, terwijl hun status "ok" bleef. De oorzaak ligt aan de kant van de Gateway en krijgt een aparte PR in die repo. Na 3 dagen zonder items tonen beide bronnen nu "leeg" in plaats van "ok".

## Eerstvolgende controles

1. Na de eerstvolgende geslaagde refresh: history-baseline, mailbronstatus, koopzondagenbron, GIPOD-evenementenbron, omgevingsdossiers, terraslaag en datatak controleren.
2. Render-liveverificatie van de straatfiche en de live bronlagen.
3. Speelstraatbijlage alleen vervolgen zodra een echte publieke PDF/document-id gevonden is.
4. De Vlaamse Waterweg alleen automatiseren na bewezen geografische feed.
5. Politieke-toolbridge pas openen nadat de politieke-tool-CI veilig als managed workflow is gebonden; geen tweede externe fetcher bouwen.
6. Gateway PR #930 pas mergen nadat de generieke npm-auditblokker (`ip-address`) via de aparte securityroute is opgelost.
