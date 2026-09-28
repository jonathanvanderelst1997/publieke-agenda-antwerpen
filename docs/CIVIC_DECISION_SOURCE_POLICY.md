# eBesluit civic discovery

Stand: 28 september 2026.

Bron: eBesluit Antwerpen, publieke zoek- en agendapuntpagina's met Referer-header.

De discovery doorloopt zoekresultaten gepagineerd (maximaal 20 pagina's per zoekterm) en rapporteert expliciet of de zoekdekking compleet was. Alleen gepubliceerde agendapunten worden gelezen.

De classifier onderscheidt concrete goedgekeurde speelstraatperioden, weigeringen, reglementswijzigingen, kermis/foorbesluiten en marktafwijkingen.

Voor besluiten van districtscollege Antwerpen kan de parser concrete foor-/kermisplaatsen en -perioden uit artikel 1 halen. Bij feestdagmarkten worden markten die doorgaan en markten die niet doorgaan afzonderlijk opgeslagen; een geannuleerde markt wordt niet als gewoon agenda-evenement behandeld.

Speelstraatbesluiten keuren doorgaans een lijst in PDF-bijlage goed. De discovery bewaart daarom alleen de publieke PDF-link en markeert dat de bijlage nog geparsed moet worden. Zij verzint geen straatnamen of data uit de besluittekst. Pas na privacyveilige parsing van de publieke bijlage mogen concrete speelstraatitems naar de agenda.

Ruwe besluittekst, aanwezigheidslijsten en persoonsgegevens worden niet in output of repository opgeslagen. Alleen besluitcode, classificatie, publieke bronlink, veilige bijlagemetadata en geparseerde kalendergegevens worden behouden.
