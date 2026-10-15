# Publieke agenda Antwerpen — straat- en brondekking, 15 oktober 2026

Bronstand: GitHub-main 8a950dcc9d35fee82ca040e428f56170fc9aaad8, exact live bevestigd op de drie bestaande Render-sites. Steekproef van gegevens en broncode, GEEN volledige interactieve browser/iPhone-test.

## Straten en vindbaarheid
- Officiële straatas stad Antwerpen (site/geo/straten.json): 1.616 naam/postcode-rijen, 1.591 unieke straat-ID’s over 2000, 2018, 2020, 2030, 2050 en 2060; geregistreerde bron opgehaald op 6 oktober.
- Straatindex: 1.335 niet-lege snapshots; een officiële straat zonder snapshot kan nog via live opzoeken worden gevonden.
- 35 gekozen straatbestanden uit zes postcodes gelezen, onder andere Cockerillkaai, Meir, Nationalestraat, Dublinstraat, Turnersstraat, Schijfstraat, Blancefloerlaan, Falconplein, Rijnkaai, Vorstermanstraat, Sint-Jansplein. Geen dubbele ID binnen een laag of ongeldige numerieke verwijzingen naar lokale straatindex in deze steekproef.
- Officiële spelling: Vorstermanstraat, niet Vostermanstraat als een tweede straat. Fuzzy zoekfunctie bestaat reeds.
- Privéhuisnummers worden niet in statische snapshots of historie opgeslagen. Live A-Sign mag uitsluitend verifieerbare openbare parkeerlocaties met nummer tonen.

## Postcodeonduidelijkheden
- Blancefloerlaan 2050: zes terrasrijen vermelden bronpostcode 2000. Dublinstraat 2030: één vermelding 2000. Bredastraat 2060: één vermelding 2020. Sint-Jansplein 2060: één vermelding 2018. Londenstraat 2000: één terras met postcode 0.
- Verschil tussen A-Sign-veld en officieel gekoppelde straatas is geen bewijs dat de geometrie of feitelijke locatie fout is. Daarom waarschuwing en behoud van de oorspronkelijke broninformatie: geen stilzwijgende automatische herlocatie.
- Number("")=0 mag niet tot een fictieve postcode 0 leiden; een ontbrekende of ongeldige postcode blijft onbekend.

## Bronnen en integratie
- Refreshstatus 15 oktober 2026 03:23 UTC: 16 bronnen, 13 ok, 2 http_500 (district-ebesluit, district-ebesluit-evenementen, sinds 12 oktober niet succesvol opgehaald), stad-uit skipped_no_key.
- Agenda Data Refresh run 38675871654: refresh/publish-branch/freshness success, source-health FAILURE, alarm SKIPPED; data-PR #189 gepubliceerd. Brain datalaan.alarm=false bewijst niet dat alle officiële bronnen gezond zijn. Issue #190 volgt betrouwbare alarmering van beschermde workflow.
- Tabletcafé WZC Hollebeek Turnersstraat 38 op 23 oktober, Halloween CO Nova Schijfstraat 105, Vrijdagen van de Poëzie zijn met officiële bezoekerslinks in de bronbestanddata aanwezig.
- Open dekkingsgrenzen: mail-district en mail-stad zijn leeg, geen bewijs van complete publieke evenementen; GIPOD-evenementen 0 binnen district maar A-Sign heeft aparte evenementdossiers; UiTdatabank zonder sleutel uit; volledige speelstraatlijst met juridische bijlagen en machineleesbare Waterweg-geodata niet bewezen.
- docs/COVERAGE_MATRIX.md bevat oude zinnen als “nog niet gemerged” voor inmiddels gepubliceerde functies; update documentatie tegen exacte live brondata, niet op gevoel.

## Volgende stappen
- Bevestig bij een volgende iPhone/browser-smoketest zowel zoekhits als echte kaartweergave en bruikbare bezoekerslinks. Controleer echte A-Sign-terrasconflicten met postcode en geometrie, zonder onzekere adressen te publiceren.
- Geen wijzigingen aan de permanente historiek of snapshots; hou veilige privacygrenzen, officiële links en bronuitval zichtbaar.
