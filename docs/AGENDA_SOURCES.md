# Automatische bronnen van de publieke agenda

De agenda vult zich uit officiële, publieke bronnen. District en stad zijn twee aparte groepen,
in de data én op de site. Handmatige items in `site/agenda.js` blijven bestaan, maar een item uit een
automatische bron gaat voor.

## Bronnen

| sourceId | Groep | Wat | Hoe |
|---|---|---|---|
| `district-kalender` | district | "Wat beleef je in district Antwerpen?" | publieke portaal-API van antwerpen.be (`page-content-by-uuid/5efb0477b118f7b19c627b69`), hoogstens 2 verzoeken per ronde |
| `district-nieuws` | district | nieuwsartikels van district Antwerpen | publiek nieuwskanaal; alleen een tabel (datum/uur/locatie) of een regel "Wanneer:", "Datum:" of een blok "Praktisch" telt, en alleen tussen de artikeldatum en `publishUntil` |
| `stad-uit` | stad | activiteiten in de 15 postcodes van de stad | UiTdatabank Search API v3; **uit zolang er geen sleutel is** |
| `mail-district`, `mail-stad` | district / stad | publieke activiteiten uit nieuwsbrieven | mail-signalen van de Brain Gateway; titel en datum worden op de officiële pagina gecontroleerd, uur en plaats alleen overgenomen als ze daar ook staan (zie onder) |

De vaste eigenschappen van elke bron (groep, uitgever, attributie, toegelaten hosts) staan in
`lib/source-feed.mjs`, niet in de data. Een data-refresh kan dus geen nieuwe host of andere groep toevoegen.

## Stroom

```
npm run refresh:fetch   # fetchers in vaste volgorde (lib/source-registry.mjs) → site/sources/*.json
                        # en site/sources/refresh-status.json
npm run build:all       # build:sources → site/agenda-feed.js, daarna pagina's, manifest en audit
npm run check           # alles offline: geen klok, geen netwerk
npm run validate:data   # schema's, hosts, limieten en privacyscan over site/sources
npm run sources:health  # één regel per bron; exitcode 1 bij error, verouderd of krimp t.o.v. HEAD
```

`scripts/build-sources.mjs` leest `site/sources/*.json`, valideert elk bestand, voegt samen met
`lib/merge-events.mjs` en schrijft `site/agenda-feed.js`. Dat bestand en de rest van de data-uitvoer staan
in `lib/data-lane-paths.json`: een wijziging die alleen die paden raakt, is een data-wijziging
(`npm run -s check:data-lane`, invoer uit `git diff --name-status -M0`). Code blijft altijd een
eigenaarsbeslissing.

## Krimpgrens: een lege uitkomst wist nooit bestaande data

Een bron die wel antwoordt maar (bijna) niets meer oplevert, is eerder stuk (een andere datumopmaak,
een leeg kanaal) dan leeg. Daarom:

- Elke fetcher (`district-kalender`, `district-nieuws`, `stad-uit`) vergelijkt het aantal **komende**
  items (einddatum of datum ≥ vandaag) met de vorige versie. Verdacht is: 0 terwijl er vorige keer meer
  dan 0 waren, of meer dan de helft minder als er vorige keer minstens 4 waren. Dan wordt niets
  weggeschreven: de bron krijgt `fetchStatus: "error"` met `errorCode: "suspicious_drop"` en de vorige
  items blijven staan (`keepPreviousOnError`). Items die gewoon voorbij zijn, tellen nooit als krimp.
- Het nieuwskanaal met 0 artikels is altijd een fout (`no_articles`).
- `npm run sources:health` faalt (exit 1) op elke bron in `error`, en vergelijkt daarnaast zelf elk
  bronbestand met de vastgelegde versie (`git show HEAD:site/sources/<bron>.json`; `--baseline <ref>`
  kiest een andere, `--no-baseline` slaat het over). Zo houdt ook een fetcher die zich vergist geen
  lege agenda tegen de dagelijkse controle aan.
- Een bewuste, grote daling laat de eigenaar toe met `AGENDA_ALLOW_DROP=<sourceId>[,<sourceId>…]`,
  zowel bij het ophalen als bij `sources:health`. De automatische dagelijkse ronde zet dat nooit.
- `mail-district` en `mail-stad` hebben bewust geen krimpgrens: haalt de Gateway een item terug (bijvoorbeeld
  omdat het toch privé bleek), dan moet het meteen van de site verdwijnen.

## Groepen (scope)

- **District Antwerpen**: postcodes 2000, 2018, 2020, 2030, 2050 en 2060. Standaard aan.
- **Stad Antwerpen**: daarbovenop 2040, 2100, 2140, 2150, 2170, 2180, 2600, 2610 en 2660. Een aparte
  groep met een eigen keuze "in district Antwerpen" of "andere districten".
- Een UiT-item is altijd `stad`, met `inDistrict` volgens de postcode, bevestigd met de officiële
  districtsgrens (`lib/district-antwerpen-grens.geojson`) als er coördinaten zijn. Spreken postcode en
  coördinaten elkaar tegen, dan wordt het item niet weggeschreven.
- Een samengevoegd item is `district` zodra een districtsbron bijdraagt.
- Handmatige bronnen in `site/agenda-refresh.js` hebben elk een `scope`.

## Samenvoegen en ontdubbelen

- Sleutel: genormaliseerde titel + datum + uur (`HH:MM`, anders `unknown`).
- Ook samen: dezelfde datum en hetzelfde uur met dezelfde detailpagina op www.antwerpen.be, of een titel
  (minstens 8 tekens) die volledig in de andere staat.
- Nooit samen: twee items met verschillende, niet-lege postcodelijsten.
- Voorrang: `district-kalender` > `district-nieuws` > `stad-uit` > `mail-district` > `mail-stad` > handmatig.
- Het samengevoegde item houdt de velden van de bron met voorrang en toont **alle** bronlinks.
- Vervangt een feed-item een handmatig item, dan staat de hand-id in `supersedes`: de site verbergt het en
  de build verwijdert de eventpagina.

## Versheid

- Elke automatische bron is 48 uur geldig (`maxAgeHours`). Daarna verdwijnen haar items (reden
  `stale_source`) en toont de site in het rood "verouderd sinds …".
- Handmatige bronnen volgen dezelfde vensters als de provenance-SLA: lopend of werken 2 dagen,
  toekomstig binnen 14 dagen 3 dagen, verder weg 7 dagen.
- Per bron toont de site "ververst op …", "verouderd sinds …" of "nog niet actief".

## Attributie

- District: "Bron: district Antwerpen – bron stad Antwerpen (Vlaamse gratis open data licentie)".
- Stad: "Bron: UiTinVlaanderen.be" met een link naar https://www.uitinvlaanderen.be, en per UiT-item
  "Bron: uitinvlaanderen.be" met een link naar de eigen UiT-pagina.
- Eén UiT-sleutel geldt voor één website: UiT-items verschijnen alleen op
  https://mijn-publieke-agenda-voor-district.onrender.com. Op een andere host staat er een link naar die site.
  UiT-items krijgen geen eigen eventpagina en staan niet in de sitemap.

## UiT: uit zonder sleutel

- `UITDATABANK_CLIENT_ID` (header `x-client-id`) of, als terugval, `UITDATABANK_API_KEY` (header `x-api-key`).
- Zonder sleutel: "UiT uit: geen sleutel", `site/sources/stad-uit.json` blijft byte-identiek en
  `refresh-status.json` zegt `skipped_no_key`. Er wordt nooit een lege lijst over bestaande data geschreven.
- `UITDATABANK_SEARCH_BASE` met `search-test` erin: er wordt alleen geteld (`test_only`), niets naar `site/`.
- Venster: vandaag tot en met 30 dagen later, één item per subEvent. Geannuleerde, uitgestelde en
  onbeschikbare activiteiten vallen weg.
- Omvang (gemeten 28-09-2026 op uitinvlaanderen.be, Antwerpen + deelgemeenten): 825 activiteiten vandaag,
  1.508 in 14 dagen, 1.900 in 30 dagen. Een kleiner venster lost een limiet dus niet op.
- Limiet: hoogstens 1.500 items in `stad-uit.json` (de andere bronnen: 600). Past niet alles, dan wordt
  **alleen op een daggrens** afgekapt: alle items t/m de laatste dag die er volledig in past, nooit een
  halve dag. `coverage` in het bronbestand (`until`, `candidateCount`, `capped`) en `capped`/`coverageUntil`
  in `refresh-status.json` zeggen tot wanneer de stadsgroep volledig is. De site toont dan bij de bron
  "volledig t/m …: N van M activiteiten in 30 dagen; meer op UiTinVlaanderen" met een link naar
  https://www.uitinvlaanderen.be/agenda/alle/antwerpen.
- Paginagewicht, nagemeten met 1.900 synthetische events (3.799 kandidaten, 1.457 weggeschreven):
  `agenda-feed.js` 1,5 MB onverpakt; `npm run check` blijft groen.

## Nieuwsbrieven via de Gateway

- `GET https://project-brain-gateway.onrender.com/v1/publiek/publieke-agenda/mail-signalen.json`
  (overschrijfbaar met `MAIL_SIGNALEN_URL`). De Gateway levert alleen titel, datum, plaats, groep en de
  officiële URL; nooit mailinhoud, afzenders of adressen.
- De hele payload wordt geweigerd bij één fout: schema, https, hosts (www.antwerpen.be, burgerbegroting.be,
  www.burgerbegroting.be, www.uitinvlaanderen.be), geen query of fragment, geen `@`, geen trackinghosts,
  hoogstens 200 items en 64 KB.
- Vóór elk verzoek vallen weg: een titel die zichzelf privé noemt ("persoonlijke uitnodiging", "privé",
  "besloten", "vertrouwelijk", "genodigden", "niet doorsturen"; `private_marker`) en een te algemene titel
  (minder dan 12 tekens of minder dan 2 woorden, zoals "Opening" of "Receptie"; `title_too_generic`).
  Dat is een tweede slot naast de Gateway, die als eerste beslist of iets publiek is.
- Elk item wordt opnieuw opgehaald (hoogstens 3 redirects, alleen naar toegelaten hosts, HTTP 200) en
  alleen weggeschreven als de titel als geheel (woordgrens, niet midden in een langer woord) en de
  startdatum op de pagina zelf staan.
- Uur, einduur, einddatum en plaats komen **alleen** uit het signaal als ze ook op die officiële pagina
  staan (een plaats als geheel of elk deel tussen komma's). Anders wordt het uur "Info" en de plaats
  "locatie via de officiële bron", zonder postcodes. Een plaats of uur uit een privémail kan zo nooit op
  de site belanden, ook niet als de Gateway zich vergist.
- 404 (niet uitgerold) of 401/403 (nog niet publiek): `disabled`. 503 of een snapshot ouder dan 3 dagen:
  eerder aanvaarde items blijven tot hun datum voorbij is, zolang de pagina ze bevestigt
  (`upstream_stale`). Andere fouten: `error`, vorige items blijven. Andere bronnen worden nooit aangeraakt.

## Privacy

Deze repo is publiek. Wat nooit in `site/sources` of `site/agenda-feed.js` komt:

- mailinhoud, namen van privépersonen, e-mailadressen, telefoonnummers, rekeningnummers;
- CMS-personeelsvelden (`creator`, `assignee`, `lockOwner`) en afbeeldingen;
- van UiT: `creator`, `contributors`, `contactPoint`, `bookingInfo`, `organizer`, `image`, `mediaObject`
  (alleen een vaste whitelist wordt gelezen);
- een URL met querystring of fragment, of een getraceerde nieuwsbrieflink.

`npm run validate:data` weigert elke tekst met `@`, een telefoonnummer, een IBAN of een `?` in een URL,
en elke verboden sleutel. `npm run lint` weigert elk bestand onder `site/` met `nieuwsbrief.antwerpen.be/t/`,
`createsend`, `cmail` of `/t/j-`.
