# Mijn publieke agenda voor District Antwerpen

Standalone publieke agenda-site voor Render. Render publiceert alleen de map `site/`.

Deze repo bevat alleen publieke agenda-informatie:

- `site/index.html`
- `site/styles.css`
- `site/agenda.js`
- `render.yaml`

Niet opnemen: politieke tool, mails, OAuth-tokens, lokale syncbestanden of private dossiers.

## Agenda verversen

De kandidaat-refresh in `site/agenda-refresh.js` koppelt actuele items uitsluitend aan officiële publieke bronnen. Hij bewaart het bronmoment, de classificatiegrens en de rollbackbasis. Bronconflicten worden als `review_required` uitgesloten van de actuele weergave, niet stil overschreven.

Controleer lokaal met:

```bash
npm run check
```

Zie [REFRESH_PROCESS.md](REFRESH_PROCESS.md) voor de classificaties en rollbackprocedure. Een lokale commit publiceert of deployt niets.

## Automatische bronnen

De agenda vult zich uit de districtskalender, het districtsnieuws, het nieuws van de andere districten, de
markten uit GIPOD, de koopzondagen van de stad, UiTdatabank (alleen met een sleutel) en herverifieerde
nieuwsbriefsignalen. District en stad zijn twee aparte groepen. Zie
[docs/AGENDA_SOURCES.md](docs/AGENDA_SOURCES.md).

```bash
npm run refresh        # bronnen ophalen en alles opnieuw bouwen
npm run validate:data  # schema's, hosts en privacyscan
npm run sources:health # versheid per bron
```

## Lokaal datacontract

`npm run check` valideert unieke stabiele ID's, datum, begin/einde, de vaste tijdzone `Europe/Brussels`, locatie, toegankelijke titel en semantische dubbels. Onbevestigde uren worden afzonderlijk als waarschuwing gerapporteerd in `EVENT_CONTRACT_REPORT.json`.

## Weergave: uitgaan & evenementen

De site opent op "Uitgaan & evenementen" (`site/agenda-uitgaan.js`, `site/agenda-uitgaan.css`):

- Standaard aan: feest & festival, buurt & straat (met buurtfeesten en speelstraten), cultuur, familie & kinderen,
  stoet & processie, sport, rommelmarkt & braderie en koopzondag.
- Standaard uit, met één klik aan: raad & commissies, info/vorming/inspraak, administratief & bevraging
  (bevragingen, enquêtes, meldingen, inspraak zonder concreet moment), oproepen & deadlines, werken & hinder,
  wekelijkse markten, overig, parkeren & verkeer en vergunningen & terrassen.
- De gewone weekmarkten staan als één gebundelde kaart (markt, dagen, uren), niet als losse marktdagen.
- Bovenaan: de straatfilter, dan een bovenrij "Vandaag / Dit weekend / Deze week / Volgende week" met de mooiste
  items. Wie een straat kiest zonder zelf soorten te kiezen, ziet alles in die straat (ook werken en hinder).
- Versheid: de kop toont "bijgewerkt op …". Is de laatste verversing ouder dan 48 uur, dan verschijnt een
  vriendelijke banner en blijven items die alleen door de ouderdom van de bron vielen nog 14 dagen zichtbaar met
  "Laatst bevestigd …". Verlopen datums en bronconflicten blijven verborgen. Het manifest en de eventpagina's
  veranderen hierdoor niet.
- Donker en licht volgen het toestel; de knop in de kop onthoudt een eigen keuze in deze browser.

## Latere uitbreiding: UiTdatabank

De ophaler voor UiTdatabank (`scripts/fetch-sources-uit.mjs`) staat klaar maar is bewust niet ingeschakeld:
een sleutel van publiq kost geld. Zonder sleutel doet hij niets (`skipped_no_key`). Wordt het later toch
gewenst, dan volstaat het de Actions-variabele `UITDATABANK_CLIENT_ID` te zetten; de UiT-items verschijnen
dan alleen op de canonieke site.
