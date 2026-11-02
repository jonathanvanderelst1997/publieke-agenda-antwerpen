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
- Bovenaan: de zoekbalk op plek (zie hieronder). Zonder plek toont het overzicht uitgaan & evenementen; wie een
  straat, wijk of postcode kiest zonder zelf soorten te kiezen, ziet alles op die plek (ook werken en hinder).
- Versheid: de kop toont "Bijgewerkt …" met het tijdstip van de momentopname. Is de laatste verversing ouder dan
  48 uur (een achterstand), dan blijven **bronitems** (uit de automatische bronnen) die alleen door de ouderdom van
  hun bron vielen nog 14 dagen zichtbaar, zoals de andere items. Een bezoeker ziet daar niets van: geen melding,
  geen oranje pil, geen "Laatst bevestigd" (besluit van de eigenaar van 18-10-2026, "niemand moet weten als er iets
  faalt, de momentopname blijft wel goed"; vroeger een banner "De agenda wordt even niet ververst"). De eigenaar
  krijgt dan een alarm-issue (de job `freshness` in `.github/workflows/refresh.yml`). Zonder achterstand is er
  geen gratie, en handmatige items krijgen die nooit (zie hieronder). Verlopen datums en bronconflicten blijven
  verborgen. Het manifest en de eventpagina's veranderen hierdoor niet.

## Handmatige items: zichtbaar tot en met de einddatum

Een handmatig item (`site/agenda.js`, met een geverifieerde bron in `site/agenda-refresh.js`) blijft zichtbaar
tot en met zijn laatste dag (`endDate`, anders `date`) en verdwijnt de dag erna. "Vandaag" is de kalenderdag in
`Europe/Brussels`, ook in de browser. Er is geen herbevestiging om de paar dagen meer: als het evenement bezig is,
staat het erop; de dag erna is het gedaan.

- Een handmatig item heet in de audit `visibleThrough` (= `recheckDueOn`) met die laatste dag.
- Uitzondering: een item waarvan een regel de classificatie vastzet (een lopende werf met fasen zonder harde
  einddatum, `classification: "current"`) volgt nog de provenance-SLA van 2 dagen, omdat daar geen einddatum is
  om op te vertrouwen.
- Handmatige items zijn alleen een **overbrugging** tot een automatische bron het punt oppikt. Elk zichtbaar
  handmatig item heeft een officiële bron-URL. Die wordt **bij elke verversing automatisch nagekeken**
  (`npm run refresh:manual`, `scripts/check-manual-sources.mjs`, uitkomst in `site/sources/manual-check.json`):
  - is de pagina nog bereikbaar, en staan de datum ("10 oktober") en de kernwoorden van de bron er nog op?
  - `gewijzigd` of `weg` (404/410): het item gaat van de site en wordt gemeld, rood in de job `source-health`
    en in `brain_status` van de Gateway;
  - `onbereikbaar` (5xx, time-out): het item blijft en er komt een waarschuwing;
  - `niet_controleerbaar`: de bron-URL noemt het item niet woordelijk; dat wordt gemeld tot er een betere
    officiële pagina is.

  Niemand hoeft een handmatig item met de hand te herbevestigen.
- Donker en licht volgen het toestel; de knop in de kop onthoudt een eigen keuze in deze browser.

## Weergave: zoek op plek (straat, wijk of postcode)

Eén zoekbalk bovenaan (`site/place-view.js`, `site/place-core.js`, `site/place-view.css`):

- Suggesties terwijl je typt uit de officiële straatnamen van district Antwerpen (`site/geo/straten.json`: id,
  naam, postcode, wijk en kader per straat, uit de straatas van stad Antwerpen; opnieuw ophalen met
  `npm run geo:straten`), de 24 wijken en de zes postcodes. Hoofdletters, accenten, huisnummers, "str." en
  "st." maken niet uit; bij een tikfout volgt "Bedoelde je …?", bij een ander district (Berchem, Deurne …) een
  uitleg. De suggesties staan in de pagina zelf (geen pop-up) en werken met pijltjes en Enter.
- Zoeken in heel de stad (bouwplan stap 3, `site/stad-zoeken.js`): ook de straatnamen van de 9 andere districten
  (`site/geo/straten-stad.json`: alleen naam, district en postcode; opnieuw ophalen met `npm run geo:straten-stad`).
  Bron: de straatas per postzone van stad Antwerpen (wegenregister, laag 905 op geodata.antwerpen.be), onder de
  [Gratis Open Data Licentie](https://www.antwerpen.be/info/gratis-open-data-licentie) van stad Antwerpen ("bron stad
  Antwerpen"); een straatnaam zonder stuk straat in die laag (het Arenaplein) komt uit het Gebouwen- en
  adressenregister van Basisregisters Vlaanderen (straatnaam en de postcode van haar adressen), onder de
  [Modellicentie voor gratis hergebruik v1.0](https://data.vlaanderen.be/id/licentie/modellicentie-gratis-hergebruik/v1.0).
  Elke naamgenoot staat erin (dezelfde naam in een andere postcode of een ander district). Een straat buiten district
  Antwerpen zegt "ligt in district X, deze agenda volgt district Antwerpen" en toont wat de site daar wel kent: de
  markten van de stad (GIPOD) en het districtsnieuws (antwerpen.be), met hun bron, plus een straat met dezelfde naam
  in district Antwerpen. De lijst en de module laden pas bij de eerste letter in het zoekveld (of bij een link als
  `?plek=Bist 2610` of `?plek=district:Berchem`): de eerste weergave wacht er niet op.
- Enter opent nooit een gok: alleen de suggestie die je met de pijltjes koos, of de enige plek die precies zo heet.
  Heten meer plekken zo (de Statiestraat in 2018, Berchem en Ekeren), of past er alleen iets met een tikfout of
  midden in een naam ("Stenplein" zit in het Kunstenplein van Berchem, maar je bedoelde het Steenplein), dan zegt de
  lijst dat en kies je zelf (`enterKeuze` in `site/place-core.js`). Bij zo'n gok staan de plekken van district
  Antwerpen vooraan. Een straatnaam met een cijfer ("Fort 7-straat", "De 7 schakenpad") en haar deellink werken ook;
  een straat heet overal zoals de bewoner ze kent, zonder de homoniemtoevoeging van de straatas ("Proefstraat_AN"
  wordt "Proefstraat"; die gaat weg bij het inlezen, zie `docs/PUBLIC_SPACE_SOURCE_POLICY.md`), en een oude link met
  de toevoeging werkt nog.
- Een plek kiezen toont één overzicht van alles daar: komende evenementen, lopende en geplande werken (GIPOD),
  parkeerverboden en innames (A-Sign), inspraak en infomomenten, markten en vergunningen. Bovenaan staan de
  aantallen; bij een straat kies je ook de straal (alleen de straat, + 250 m, + 500 m, + 1 km).
- Lijst, 14 dagen (tijdlijn) of maand. De lijst toont "Nu bezig" en dan per dag binnen 7 dagen, 30 dagen, 3 maanden
  of alles. Staat er een werk bij dat GIPOD nog niet "in uitvoering" meldt ("Periode loopt"), dan heet die kop
  "Loopt nu". In de maandkalender lopen meerdaagse werken als balk over hun periode. Details openen inline.
- Een plek toont standaard alles wat de site erover heeft (wens van 12 oktober 2026): periode "Alles" (zonder einde),
  alle soorten aan en geen grens per sectie. Alleen een heel lange lijst (meer dan 150 kaartjes, zoals een postcode)
  tekent per 150 en laadt de volgende vanzelf bij het naar beneden scrollen (elke stap voegt alleen de nieuwe kaartjes
  toe; staat de knop boven of bovenaan het beeld, zoals na "Toon op de kaart" op een gsm, dan is het een gewone knop);
  een straat staat er altijd meteen volledig (de drukste straat had er 69 op 12 oktober 2026). De knoppen beperken nog
  altijd; het getal boven de lijst blijft dan alles en zegt erbij wat de lijst toont, ook in de tijdlijn en de maand
  (die tonen geen vergunningen en terrassen). Zonder plek (het hele district) blijft het de komende 30 dagen en de
  evenementen. De kaart tekent met een plek ook alles; alleen zonder plek houdt ze 600 per soort.
- Eén rij soortchips (evenementen, werken & verkeer, inspraak & info, markten, raad, vergunningen) vervangt de
  losse keuzelijsten. De volledige lijsten per laag, district/stad en de bronstatus staan ingeklapt onderaan.
- Deelbaar: `?plek=Kammenstraat`, `?plek=Zurenborg`, `?plek=2060` (met `&straal=500`, `&soort=…`,
  `&periode=…`, `&weergave=maand`). Alleen wat afwijkt van de vertrekstand staat in de link: met een plek dus geen
  `periode` voor "Alles", wel `&periode=maand` voor 30 dagen. Oude links met `straat=`, `wijk=` en `&periode=maand`
  werken nog.
- "Mijn buurt" vraagt de locatie van het toestel en zoekt er de straat of wijk bij; die locatie verlaat de
  browser niet.
- Toetsen: `npm test` (zoeken, normaliseren, plekfilter, kalenderbalken) en `npm run test:e2e` (Playwright met
  Chromium tegen de lokale site, met vaste antwoorden voor de live bronnen; zonder browser wordt hij overgeslagen).

## Weergave: in jouw buurt (kaart en wijken)

Naast (of op gsm boven) het plekoverzicht staat de kaart (`site/neighborhood-map.js`, `site/neighborhood-core.js`):

- De 24 officiële wijken van district Antwerpen (`site/geo/wijken.geo.json`, vereenvoudigde kopie van de
  wijkindeling van stad Antwerpen, met bron en licentie in het bestand; opnieuw ophalen met
  `npm run geo:wijken`). Op een wijk tikken kiest die wijk als plek; de kaart zoomt in op de gekozen plek.
- De kaart: MapLibre + OpenFreeMap als het kan, anders Leaflet + OSM; de legenda filtert de kaart. In detail
  (P9, `site/kaart-lagen.js`, `site/kaart-vector.js`): de kaart tekent wat de lijst toont, elk object in de kleur
  van zijn rij en met een eigen vorm (evenement en parcours een lijn, werken een stip, omleiding en werfzone een
  streeplijn of een vlak met een streeprand, vergunningen een ring). Als het kan is het een vectorkaart (MapLibre
  5.24.0 van cdnjs met SRI, tegels van OpenFreeMap, geen sleutel); zonder WebGL, met databesparing, op een trage
  verbinding (de browser schat ze lager dan 4g), met `?kaart=leaflet` of als de stijl of de eerste tegel niet op
  tijd komt (8 s per stap, zolang de stijl en MapLibre binnenkomen hoogstens 16 s), Leaflet 1.9.4 (cdnjs, SRI) met
  OpenStreetMap-tegels. Beide laden pas als de kaart in beeld komt en de browser even niets te doen heeft. De
  legenda (vijf soorten, met het aantal op deze plek, zoals het getal boven de lijst) toont of verbergt een soort
  alleen op de kaart; de lijst blijft volledig. "X in de lijst" zegt alleen de zin onder de kaart: wat de lijst in
  de gekozen periode, weergave of dag echt toont; wat er zonder vaste plek is, telt "hier". Parkeerverboden,
  losse innames (ook die van een evenement: opbouw, afbraak en de parkeerverboden erbij) en vergunningen staan er
  als één punt bij benadering (afgerond op 0,001°), nooit exact; van een evenement staan het parcours, de
  omleidingen en de verkeersvrije zones exact.
  Zo'n plek tekent de kaart als een vorm van 60 m met een eigen vorm per soort (een vergunning een gestippelde
  ring, verkeer een gestreept vierkant, de innames van een evenement een ruit); een tik op een vorm noemt alle
  kaartjes op dat punt. De gekozen straat en de markering staan in de inkt van de onderkaart (de tegels van
  OpenStreetMap blijven licht, ook in donkere modus). "Toon op de kaart" in een open kaartje (de focus gaat mee
  naar de kaart; zonder plek zegt een balk vlak boven de kaart dat, nooit over de kaart) en "Toon in de lijst" in
  een popup wijzen kaart en lijst naar elkaar.
- Coördinaten van agendapunten komen uit `site/geo/locaties.json`, bij het verversen gemaakt door
  `npm run geo:refresh` (Geolocation-API van Digitaal Vlaanderen). Een punt telt alleen als de straatnaam
  (en het huisnummer) letterlijk in de locatietekst staat. Plaatsen zonder straat ("Bib Permeke",
  "Toeristisch centrum") krijgen geen gegokte marker: ze staan in de lijst "Zonder vaste plek" onder de kaart
  en vallen bij een wijkfilter weg.
- In de URL: zie `?plek=` hierboven.

## Latere uitbreiding: UiTdatabank

De ophaler voor UiTdatabank (`scripts/fetch-sources-uit.mjs`) staat klaar maar is bewust niet ingeschakeld:
een sleutel van publiq kost geld. Zonder sleutel doet hij niets (`skipped_no_key`). Wordt het later toch
gewenst, dan volstaat het de Actions-variabele `UITDATABANK_CLIENT_ID` te zetten; de UiT-items verschijnen
dan alleen op de canonieke site.
