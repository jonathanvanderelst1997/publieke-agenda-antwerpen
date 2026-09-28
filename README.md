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

De agenda vult zich uit de districtskalender, het districtsnieuws, UiTdatabank (alleen met een sleutel) en
herverifieerde nieuwsbriefsignalen. District en stad zijn twee aparte groepen. Zie
[docs/AGENDA_SOURCES.md](docs/AGENDA_SOURCES.md).

```bash
npm run refresh        # bronnen ophalen en alles opnieuw bouwen
npm run validate:data  # schema's, hosts en privacyscan
npm run sources:health # versheid per bron
```

## Lokaal datacontract

`npm run check` valideert unieke stabiele ID's, datum, begin/einde, de vaste tijdzone `Europe/Brussels`, locatie, toegankelijke titel en semantische dubbels. Onbevestigde uren worden afzonderlijk als waarschuwing gerapporteerd in `EVENT_CONTRACT_REPORT.json`.
