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
- Standaard uit, met één klik aan: raad & commissies, infomomenten & vorming, inspraak & bevraging
  (bevragingen, enquêtes, meldingen, inspraak zonder concreet moment, zoals de bevraging over een schoolstraat),
  oproepen & deadlines, werken & hinder, wekelijkse markten, overig, parkeren & verkeer en vergunningen & terrassen.
- De gewone weekmarkten staan als één gebundelde kaart (markt, dagen, uren), niet als losse marktdagen.
- Bovenaan: de straatfilter, dan een bovenrij "Vandaag / Dit weekend / Deze week / Volgende week" met de mooiste
  items. Wie een straat kiest zonder zelf soorten te kiezen, ziet alles in die straat (ook werken en hinder).
- Versheid: de kop toont "bijgewerkt op …". Is de laatste verversing ouder dan 48 uur (een achterstand), dan
  verschijnt een vriendelijke banner en blijven **bronitems** (uit de automatische bronnen) die alleen door de
  ouderdom van hun bron vielen nog 14 dagen zichtbaar met "Laatst bevestigd …". Zonder achterstand is er geen
  "Laatst bevestigd", en handmatige items krijgen die gratie nooit (zie hieronder). Verlopen datums en
  bronconflicten blijven verborgen. Het manifest en de eventpagina's veranderen hierdoor niet.

## Handmatige items: zichtbaar tot en met de einddatum

Een handmatig item (`site/agenda.js`, met een geverifieerde bron in `site/agenda-refresh.js`) blijft zichtbaar
tot en met zijn laatste dag (`endDate`, anders `date`) en verdwijnt de dag erna. "Vandaag" is de kalenderdag in
`Europe/Brussels`, ook in de browser. Er is geen herbevestiging om de paar dagen meer: als het evenement bezig is,
staat het erop; de dag erna is het gedaan.

- Een handmatig item heet in de audit `visibleThrough` (= `recheckDueOn`) met die laatste dag.
- Uitzondering: een item waarvan een regel de classificatie vastzet (een lopende werf met fasen zonder harde
  einddatum, `classification: "current"`) volgt nog de provenance-SLA van 2 dagen, omdat daar geen einddatum is
  om op te vertrouwen.
- Wie een handmatig item vroeger wil weghalen (afgelast, verplaatst), past de regel of het item aan; de
  bronstatus `review_required` haalt het meteen van de site.
- Donker en licht volgen het toestel; de knop in de kop onthoudt een eigen keuze in deze browser.

## Weergave: in jouw buurt (kaart en wijken)

Onder de bovenrij staat "In jouw buurt" (`site/neighborhood-map.js`, `site/neighborhood-core.js`):

- Een keuzelijst met de 24 officiële wijken van district Antwerpen (`site/geo/wijken.geo.json`, vereenvoudigde
  kopie van de wijkindeling van stad Antwerpen, met bron en licentie in het bestand; opnieuw ophalen met
  `npm run geo:wijken`). Een wijk kiezen of erop tikken filtert de hele pagina: agenda, werken en hinder,
  parkeren en vergunningen. Zonder eigen soortkeuze staat dan alles van die buurt aan, net als bij een straat.
- Met een gekozen straat verschijnt een straal: alleen deze straat, + 250 m, + 500 m of + 1 km.
- De kaart (Leaflet via cdnjs, met SRI, en OpenStreetMap-tegels) laadt pas als ze in beeld komt. Markers hebben de
  kleur en het emoji van hun soort; werken staan er als stippen bij als "Werken & hinder" aanstaat.
- Coördinaten van agendapunten komen uit `site/geo/locaties.json`, bij het verversen gemaakt door
  `npm run geo:refresh` (Geolocation-API van Digitaal Vlaanderen). Een punt telt alleen als de straatnaam
  (en het huisnummer) letterlijk in de locatietekst staat. Plaatsen zonder straat ("Bib Permeke",
  "Toeristisch centrum") krijgen geen gegokte marker: ze staan in de lijst "Zonder vaste plek" onder de kaart
  en vallen bij een wijkfilter weg.
- In de URL: `?wijk=ANT09` en `&straal=500` (samen met `straat=`), zodat een buurtlink te delen is.

## Latere uitbreiding: UiTdatabank

De ophaler voor UiTdatabank (`scripts/fetch-sources-uit.mjs`) staat klaar maar is bewust niet ingeschakeld:
een sleutel van publiq kost geld. Zonder sleutel doet hij niets (`skipped_no_key`). Wordt het later toch
gewenst, dan volstaat het de Actions-variabele `UITDATABANK_CLIENT_ID` te zetten; de UiT-items verschijnen
dan alleen op de canonieke site.
