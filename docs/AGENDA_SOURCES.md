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
| `mail-district`, `mail-stad` | district / stad | publieke activiteiten uit nieuwsbrieven | mail-signalen van de Brain Gateway, **altijd opnieuw gecontroleerd** op de officiële pagina |

De vaste eigenschappen van elke bron (groep, uitgever, attributie, toegelaten hosts) staan in
`lib/source-feed.mjs`, niet in de data. Een data-refresh kan dus geen nieuwe host of andere groep toevoegen.

## Stroom

```
npm run refresh:fetch   # fetchers in vaste volgorde (lib/source-registry.mjs) → site/sources/*.json
                        # en site/sources/refresh-status.json
npm run build:all       # build:sources → site/agenda-feed.js, daarna pagina's, manifest en audit
npm run check           # alles offline: geen klok, geen netwerk
npm run validate:data   # schema's, hosts, limieten en privacyscan over site/sources
npm run sources:health  # één regel per bron; exitcode 1 bij error of verouderd
```

`scripts/build-sources.mjs` leest `site/sources/*.json`, valideert elk bestand, voegt samen met
`lib/merge-events.mjs` en schrijft `site/agenda-feed.js`. Dat bestand en de rest van de data-uitvoer staan
in `lib/data-lane-paths.json`: een wijziging die alleen die paden raakt, is een data-wijziging
(`npm run -s check:data-lane`, invoer uit `git diff --name-status -M0`). Code blijft altijd een
eigenaarsbeslissing.

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
- Venster: vandaag tot en met 30 dagen later, hoogstens 500 items, één item per subEvent. Geannuleerde,
  uitgestelde en onbeschikbare activiteiten vallen weg.

## Nieuwsbrieven via de Gateway

- `GET https://project-brain-gateway.onrender.com/v1/publiek/publieke-agenda/mail-signalen.json`
  (overschrijfbaar met `MAIL_SIGNALEN_URL`). De Gateway levert alleen titel, datum, plaats, groep en de
  officiële URL; nooit mailinhoud, afzenders of adressen.
- De hele payload wordt geweigerd bij één fout: schema, https, hosts (www.antwerpen.be, burgerbegroting.be,
  www.burgerbegroting.be, www.uitinvlaanderen.be), geen query of fragment, geen `@`, geen trackinghosts,
  hoogstens 200 items en 64 KB.
- Elk item wordt opnieuw opgehaald (hoogstens 3 redirects, alleen naar toegelaten hosts, HTTP 200) en
  alleen weggeschreven als de titel en de startdatum op de pagina zelf staan.
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
