# eBesluit civic discovery

Stand: 28 september 2026.

Bron: eBesluit Antwerpen, publieke zoek- en agendapuntpagina's met Referer-header.

De discovery doorloopt zoekresultaten gepagineerd (maximaal 20 pagina's per zoekterm) en rapporteert expliciet of de zoekdekking compleet was. Alleen gepubliceerde agendapunten worden gelezen.

De classifier onderscheidt concrete goedgekeurde speelstraatperioden, weigeringen, reglementswijzigingen, kermis/foorbesluiten en marktafwijkingen.

Voor besluiten van districtscollege Antwerpen kan de parser concrete foor-/kermisplaatsen en -perioden uit artikel 1 halen. Bij feestdagmarkten worden markten die doorgaan en markten die niet doorgaan afzonderlijk opgeslagen; een geannuleerde markt wordt niet als gewoon agenda-evenement behandeld.

Speelstraatbesluiten keuren doorgaans een lijst in PDF-bijlage goed. De discovery bewaart daarom alleen de publieke PDF-link en markeert dat de bijlage nog geparsed moet worden. Zij verzint geen straatnamen of data uit de besluittekst. Pas na privacyveilige parsing van de publieke bijlage mogen concrete speelstraatitems naar de agenda.

Ruwe besluittekst, aanwezigheidslijsten en persoonsgegevens worden niet in output of repository opgeslagen. Alleen besluitcode, classificatie, publieke bronlink, veilige bijlagemetadata en geparseerde kalendergegevens worden behouden.

## Speelstraten 2026 — fail-closed grens

Voor 2026 zijn onder meer de CBS-goedkeuringen voor krokus- en paasvakantie en hun PDF-bestandsnamen publiek bevestigd. De concrete speelstraten staan volgens de besluiten in die bijlagen. De huidige publieke web-/Gatewayroutes leveren de bijlagebytes of het eBesluit-document-id niet betrouwbaar op. Een principebeslissing van districtscollege Antwerpen over de stratenlijst 2026 is eveneens vindbaar, maar de concrete lijst is niet geïndexeerd.

Daarom blijft de bron fail-closed: geen straatnaam of periode wordt uit zoekresultaten, titels of historische formaten afgeleid. Alleen de echte publieke bijlage mag een concreet speelstraatitem produceren.
