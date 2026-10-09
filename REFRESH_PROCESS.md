# Transparante agenda-refresh

Deze gepubliceerde release scheidt drie zaken:

1. de bestaande bronitems in `site/agenda.js`;
2. de actuele broncontrole, correcties en reviewgrenzen in `site/agenda-refresh.js`;
3. het deterministisch gebouwde overzicht in `site/public-agenda-manifest.json`.

## Classificaties

- `expired`: de opgeslagen datum of officiële einddatum ligt vóór de auditdatum;
- `current`: een officiële bron bevestigt dat het punt op de auditdatum loopt;
- `future`: een officiële bron bevestigt een latere datum;
- `review_required`: bron, uur, locatie of actuele afronding is niet eenduidig bevestigd.

Alleen `current` en `future` met bronstatus `verified` verschijnen in de publieke agenda. Een handmatig item op datum is `current` of `future` tot en met zijn laatste dag (`endDate`, anders `date`, Europe/Brussels) en `expired` vanaf de dag erna; het hoeft niet om de paar dagen herbevestigd te worden. Verlopen punten blijven als rollback- en audithistoriek in de bestaande bron staan. Items met een bronconflict worden niet stil verwijderd en niet als actueel getoond.

## Herhalen

```bash
npm run check
```

De build gebruikt geen netwerk. Een inhoudelijke refresh begint altijd met een nieuwe controle van de officiële publieke bron, gevolgd door een expliciete update van `retrievedAt`, bronstatus en eventuele correcties.

## Identiteit van evenementendossiers

De stad (A-Sign) publiceert per evenement op straat alleen een dossiernummer, data, innames en een parcours, zonder naam, organisator of uren. `site/sources/evenement-identiteit.json` zegt per dossiernummer wat het is. De evenementkaart toont dat bovenaan: wat, wanneer, waar, jouw straat, wat je merkt en de knop "Officiële info over dit evenement".

Het bestand wordt met de hand bijgewerkt, niet door de automatische verversing:

1. Neem de nieuwe dossiers uit `site/sources/kaart-uitleg.json` (sleutel `evenementen`) die nog niet in het bestand staan.
2. Zoek per dossier op datum en plek een publieke bron: de districtskalender, het nieuws van de districten op antwerpen.be, Slim naar Antwerpen, de site van de organisator. Lees de pagina zelf.
3. Vul per dossiernummer in:
   - `zekerheid`: `zeker` (een bron noemt dit evenement op deze dag en plek), `waarschijnlijk` (sterke aanwijzing, geen bevestiging) of `onbekend`;
   - `naam` alleen bij `zeker`; `soort` zonder lidwoord bij `zeker` ("loopwedstrijd: …"), met lidwoord bij `waarschijnlijk` ("een studentendoop …"), want de kaart toont "Vermoedelijk " + soort;
   - `reden`: waarom `waarschijnlijk` of `onbekend`, in één of twee zinnen;
   - `organisator`: alleen een organisatie, nooit een persoon; leeg als de bron er geen noemt;
   - `dagen` (de dag of dagen van het evenement zelf, niet de opbouw), `uren` en eventueel `urenNoot`;
   - `waar`, `watMerkJe`: kort, in gewone taal, zonder huisnummers, in de woorden van de bron. Bij `onbekend` alleen wat in het dossier staat ("Afsluitingen of parkeerverboden staan niet in het dossier."), geen "mogelijk" of "waarschijnlijk";
   - nooit de status van de aanvraag ("nog niet toegestaan", "wordt geweigerd"): die komt live uit A-Sign, en de site toont alleen goedgekeurde dossiers;
   - `link`: een gewone https-pagina over dit evenement (geen query, geen databron); `linkLabel` als de pagina niet over dit ene evenement gaat (bv. de regels voor studentendopen); `linkUitleg` als de pagina meerdere activiteiten toont;
   - `bron`: de publieke pagina's waarop de identificatie steunt; `bijgewerkt`: de dag van de controle.
4. Zet `bijgewerkt` bovenaan op de dag van de controle en draai `node scripts/validate-data.mjs` en `node --test tests/evenementkaart.test.mjs`. De validatie weigert links met een query, huisnummers na een straatnaam, `zeker` zonder naam, de status van de aanvraag en een gissing bij `onbekend`; de privacyscan weigert @, telefoonnummers en IBAN.

Staat een dossier niet in het bestand, dan zoekt de site zelf een gewoon agendapunt op dezelfde dag als het evenement (niet de opbouw) met een straat van het dossier in de locatie, en toont het als "Vermoedelijk: <naam van het agendapunt>" (gekoppeld aan agendapunt), met de officiële pagina van het agendapunt en een link naar het agendapunt. Markten, vergaderingen en innames van meer dan drie dagen worden nooit gekoppeld. Zonder koppeling zegt de kaart: "Evenement met toelating van de stad; de stad maakt niet bekend wat het is."

De verversing (`lib/kaart-uitleg-refresh.mjs`) bewaart per dossier ook `langs`: de straten waar het parcours echt langs loopt (ook een korte straat die het parcours grotendeels bedekt). Daarmee zegt de kaart "jouw straat ligt op het parcours" of "kruist het parcours". Zonder straatas laat de verversing `langs` weg, en zegt de kaart "op of naast het parcours". De schets (`kaart`) is het hele parcours, vereenvoudigd; `kaartDeel` zegt of er toch lijnen wegvielen.

Een evenementkaart staat in de lijst op de dag van het evenement. Tijdens opbouw en afbraak van de innames op de gekozen plek (bijvoorbeeld een parkeerverbod in jouw straat) staat ze bij "Nu bezig", met "Opbouw bezig" of "Afbraak bezig".

## Rollback

De vastgelegde rollbackbasis is commit `36ea97332e1742d0ed1650a1226c2276733a34f3`. Als live validatie faalt, wordt de release-merge op `main` teruggedraaid naar die broninhoud zodat Render de vorige website opnieuw uitrolt.
