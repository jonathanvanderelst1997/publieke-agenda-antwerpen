# Individuele ICS-export - lokale QA 2026-08-13

## Resultaat

Elk uitgeklapt agenda-item heeft nu een knop **Voeg toe aan agenda (.ics)**. De export bevat exact één `VEVENT`, een stabiele UID, de publieke HTTPS-bron en een gevalideerde datum. Een gekend uur gebruikt `Europe/Brussels` met zomer- en wintertijdregels; `Uur volgt` wordt bewust een dagitem zodat geen verzonnen startuur in iemands agenda belandt.

De generator:

- escapt regeleindes, komma's, puntkomma's en backslashes tegen veldinjectie;
- vouwt elke fysieke regel op maximaal 75 UTF-8-octetten;
- weigert onmogelijke datums en niet-HTTPS-bronnen;
- levert een deterministische, leesbare bestandsnaam; en
- valideert het bestand lokaal voordat de browserdownload start.

## Controle

- `node scripts/test-individual-ics.mjs`: **16 checks PASS** voor getimed, dagitem, DST-configuratie, Unicode-regelvouw, escaping, onmogelijke datum, HTTPS-bron en bestandsnaam.
- `node scripts/test-deep-links.mjs`: **PASS**, 132 unieke bron-ID's en alle drie bestaande deeplinkvormen behouden.
- Dit is alleen een lokale browserdownload. Er is niets gepubliceerd en geen externe agenda of account gewijzigd.

## Waarde (0-5)

- Financieel effect: **1/5** - geen directe omzetfunctie.
- Risicoreductie: **3/5** - voorkomt verzonnen uren, bronloze exports en kalenderinjectie.
- Directe bruikbaarheid: **5/5** - een individueel publiek punt kan meteen in Apple, Outlook of Google Calendar worden geïmporteerd.
