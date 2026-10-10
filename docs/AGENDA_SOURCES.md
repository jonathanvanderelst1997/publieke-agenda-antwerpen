# Automatische bronnen van de publieke agenda

De agenda vult zich uit officiële, publieke bronnen. District en stad zijn twee aparte groepen,
in de data én op de site. Handmatige items in `site/agenda.js` blijven bestaan, maar een item uit een
automatische bron gaat voor.

## Bronnen

| sourceId | Groep | Wat | Hoe |
|---|---|---|---|
| `district-kalender` | district | "Wat beleef je in district Antwerpen?" | publieke portaal-API van antwerpen.be (`page-content-by-uuid/5efb0477b118f7b19c627b69`), hoogstens 2 verzoeken per ronde |
| `district-nieuws` | district | nieuwsartikels van district Antwerpen | publiek nieuwskanaal; alleen een tabel (datum/uur/locatie) of een regel "Wanneer:", "Datum:" of een blok "Praktisch" telt, en alleen tussen de artikeldatum en `publishUntil` |
| `district-gipod-evenementen` | district | publieke evenementen en operationele speelstraten op openbaar domein; **levert in de praktijk niets** | GIPOD `INNAME_PUNT`, standaard 365 dagen vooruit; alleen actuele/geplande `Evenement`-records met exact punt in District Antwerpen. Gewone evenementen blijven conservatief; `Speelstraat` telt alleen met concrete districtsstraat en een periode van maximaal 14 dagen. Stad Antwerpen zet in GIPOD alleen markten en ambulante handel; echte evenementen (feest/kermis, sport) staan er alleen van buurgemeenten, buiten het district (meting 10-10-2026: 9.083 rijen in het kader, 0 evenementen in het district). De bron gooit alles buiten het district weg (`outside_district` in `lib/gipod-events.mjs`) en toont dus nooit een evenement van een buurgemeente. Daarom het label "GIPOD-evenementen in het district (stad Antwerpen meldt hier geen evenementen; GIPOD bevat vooral buurgemeenten)"; de bron blijft staan voor als de stad ze toch in GIPOD zet. |
| `district-foren` | district | foren en kermissen, één punt per periode | A-Sign `MapServer/0` (foor) van geodata.antwerpen.be, één verzoek per ronde; geen sleutel (zie onder) |
| `district-schoolstraten` | district | de schoolstraten met venstertijden, en de start van een proef | `P_Portal/portal_publiek10/MapServer/986` van geodata.antwerpen.be, één verzoek per ronde; geen sleutel (zie onder) |
| `district-projecten` | district | inspraak- en infomomenten, bevragingen en fasen van projecten in de publieke ruimte | de projectpagina's van district Antwerpen via de publieke portaal-API (`contentType=9`), hoogstens 6 verzoeken met 1 s ertussen (zie onder) |
| `stad-districten` | stad | nieuwsartikels van de 9 andere districten | de publieke nieuwskanalen (`lib/district-channels.mjs`), één verzoek per kanaal met 3 s ertussen; dezelfde regels als `district-nieuws`, plus een activiteitentabel en één blok "Titel + datum" (zie onder) |
| `stad-markten` | stad | de openbare markten van de stad, eerstvolgende marktdag per markt | GIPOD (Digitaal Vlaanderen, OGC API Features, `INNAME_PUNT`), verrijkt met de marktlijst van geodata.antwerpen.be; geen sleutel |
| `stad-koopzondagen` | stad | de komende koopzondagen van de stad | de publieke infopagina https://www.antwerpen.be/info/koopzondagen (HTML, lijst "Koopzondagen in <jaar>"), één verzoek per ronde; geen sleutel |
| `stad-uit` | stad | activiteiten in de 15 postcodes van de stad | UiTdatabank Search API v3 (betalend); **uit zolang er geen sleutel is** |
| `mail-district`, `mail-stad` | district / stad | publieke activiteiten uit nieuwsbrieven | mail-signalen van de Brain Gateway; titel en datum worden op de officiële pagina gecontroleerd, uur en plaats alleen overgenomen als ze daar ook staan (zie onder) |

De vaste eigenschappen van elke bron (groep, uitgever, attributie, toegelaten hosts) staan in
`lib/source-feed.mjs`, niet in de data. Een data-refresh kan dus geen nieuwe host of andere groep toevoegen.

## Vooruitkijkhorizon

Er is geen algemene limiet van 7 dagen. Elke gratis bron wordt zo ver vooruit gelezen als zij betrouwbaar en begrensd toelaat:

- GIPOD-evenementen: 365 dagen.
- GIPOD-markten: 365 dagen queryhorizon; per markt alleen de eerstvolgende nog geldige marktdag.
- Districtskalender en districtsnieuws: alle concreet gedateerde toekomstige items binnen hun geldige publicatieperiode.
- eBesluit en openbare vergaderingen: officiële zoek- en kalenderperiodes, zonder 7-dagenafkap.
- Koopzondagen: alle nog komende data die in de officiële jaarlijsten staan.
- UiT blijft optioneel en heeft, indien ooit geactiveerd, een afzonderlijke volumelimiet en coverage-indicatie.

De site en straat-tijdlijn mogen dus alles tonen wat deze bronnen betrouwbaar kennen; niet bekende toekomstige data worden nooit afgeleid of gegokt.

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

- Elke fetcher (`district-kalender`, `district-nieuws`, `stad-markten`, `stad-koopzondagen`, `stad-uit`) vergelijkt het aantal **komende**
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
- `stad-districten` heeft bewust geen krimpgrens op het aantal items (`shrinkGuard: false` in
  `lib/source-feed.mjs`; ook `sources:health` vergelijkt haar niet met HEAD): nul komende activiteiten is
  daar normaal. Gezond is: **elk kanaal antwoordde met minstens één artikel**. Faalt één kanaal (fout,
  time-out, 0 artikels), dan blijven alleen de vorige items van dat kanaal staan en krijgt de bron
  `fetchStatus: "error"` met `errorCode: "channel_<code>"` (bijvoorbeeld `channel_http_503`); de andere
  kanalen worden gewoon ververst. Falen alle kanalen, dan blijft alles staan.
- `mail-district` en `mail-stad` hebben bewust geen krimpgrens: haalt de Gateway een item terug (bijvoorbeeld
  omdat het toch privé bleek), dan moet het meteen van de site verdwijnen.

## Tijdelijk onbereikbaar: "stale", geen fout

Antwoordt een bron tijdelijk niet, dan blijven haar vorige items en `retrievedAt` staan, net als bij
elke fout (`fetchStatus: "error"` met de `errorCode`). Tijdelijk betekent: `http_5xx`, `http_429`,
`timeout`, `network_error`, `source_timeout`, `refresh_budget_exhausted` of `body_read_failed`, ook
als `channel_<code>`. Een voorbeeld is de 503 van de districtsraad (`district-vergaderingen`) vanaf
de GitHub-runners in oktober 2026. `sourceHealthOf` in `lib/fetch-util.mjs` noemt zo'n bron:

- **`stale`** zolang de vorige data binnen `maxAgeHours` (48 uur) valt. Dat is een waarschuwing:
  `npm run sources:health` en de job `source-health` blijven groen, de andere bronnen worden gewoon
  ververst, en de site toont "(bron tijdelijk onbereikbaar; vorige gegevens blijven staan)";
- **`error`** als de vorige data ouder is dan 48 uur (haar items zijn dan ook van de site), of bij een
  blijvende fout (`suspicious_drop`, `no_list`, `invalid_json` …). Dat blijft rood.

De eBesluit-kalender (terugval van `district-vergaderingen`, 13 maandpagina's) pauzeert 250 ms tussen
de pagina's en probeert een maand bij 5xx, 429, time-out of netwerkfout nog twee keer opnieuw (na 2
en 5 seconden).

## Tijdsbudget: een trage bron houdt de verversing niet tegen

De job `refresh` stopt hard na 20 minuten; dan gaat er niets door, ook niet de gezonde bronnen.
Daarom draait `scripts/refresh-fetch.mjs` elke fetcher binnen een tijdsbudget:

- standaard 3 minuten per fetcher (`SOURCE_BUDGET_MS`), `district-ebesluit` 6 minuten (`budgetMs` in
  `lib/source-registry.mjs`), alle fetchers samen hoogstens 12 minuten (`REFRESH_BUDGET_MS`), de live
  historiek daarna hoogstens 3 minuten (`LIVE_HISTORY_BUDGET_MS`);
- na het budget faalt elk verzoek van die fetcher meteen (`FetchError("source_timeout")`); hij eindigt
  via zijn gewone foutpad. De bron krijgt `fetchStatus: "error"` met `errorCode: "source_timeout"` en
  haar vorige items en `retrievedAt` blijven staan. Een fetcher die niet meer aan de beurt komt omdat
  het totaalbudget op is, krijgt `errorCode: "refresh_budget_exhausted"`, ook met zijn vorige data;
- er verandert niets aan de versheids- en validatieregels: `validate:data --max-age-hours 26` en
  `sources:health` beoordelen zo'n bron zoals elke andere bron in `error`.

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
- Voorrang: `district-kalender` > `district-nieuws` > `stad-districten` > `stad-markten` > `stad-koopzondagen` >
  `stad-uit` > `mail-district` > `mail-stad` > handmatig.
- Het samengevoegde item houdt de velden van de bron met voorrang en toont **alle** bronlinks.
- Vervangt een feed-item een handmatig item, dan staat de hand-id in `supersedes`: de site verbergt het en
  de build verwijdert de eventpagina.

## Versheid

- Elke automatische bron is 48 uur geldig (`maxAgeHours`). Daarna verdwijnen haar items (reden
  `stale_source`) en toont de site in het rood "verouderd sinds …".
- Handmatige items op datum blijven zichtbaar tot en met hun laatste dag (`endDate`, anders `date`, in
  `Europe/Brussels`) en verdwijnen de dag erna, zonder herbevestiging. Alleen een handmatig item met een
  vaste classificatie uit een regel (een lopende werf zonder harde einddatum) volgt nog de provenance-SLA van
  2 dagen.
- "Laatst bevestigd" (14 dagen) geldt alleen voor bronitems, en alleen als de laatste verversing ouder is dan
  48 uur.
- Per bron toont de site "ververst op …", in het oranje "leeg sinds …", in het rood "verouderd sinds …" of
  "nog niet actief".

## Leeg: antwoordt wel, levert niets

Een bron die 3 kalenderdagen op rij 0 items levert, of alleen items die voorbij zijn, krijgt
`contentStatus: "leeg"` in `site/sources/refresh-status.json` (`scripts/stale-policy.mjs`). Dat is een
waarschuwing (oranje), geen fout: de verversing blijft groen. De teller telt kalenderdagen vanaf de
eerste verversing zonder komend item, geen verversingen: valt een ochtend uit, dan is een bron al na 2
echte verversingen "leeg".

- `scripts/refresh-fetch.mjs` schrijft per actieve bron `upcomingCount` (wat vandaag nog loopt of komt),
  `emptySince` (de eerste dag van de huidige reeks dagen zonder komend item, overgenomen van de vorige
  status) en `contentStatus` ("ok" of "leeg"). Komt er weer iets, dan valt `emptySince` weg.
- `npm run sources:health` toont zo'n bron als `leeg` met `emptySince=…`, met exitcode 0; op een
  GitHub-runner komt er een `::warning` "Bron leeg" bij.
- De site toont bij de bron "leeg sinds …: geen komende items" in plaats van "ververst op …".
- Een status van vóór deze velden blijft geldig; de teller begint bij de eerste verversing met deze code.

## Datum in de titel (`district-nieuws`)

Buurtacties zoals Herfstklaar staan als nieuwsartikel in het kanaal van district Antwerpen, zonder tabel
of "Wanneer:"-regel. De datum staat alleen in de titel: "Maak je straat Herfstklaar op 23, 24 of 25
oktober". Daarom leest `district-nieuws` (optie `titleDates`) als **laatste redmiddel** een expliciete dag
of lijst dagen met maand na "op" in de titel. Dat gebeurt alleen als tabel, tekstregel en blok niets
geven.

- Opeenvolgende dagen worden één periode (23 t/m 25 oktober). "of" en "en" tellen allebei.
- Nooit voor inschrijvingen, aanvragen, deadlines, bevragingen ("tot", "voor <datum>", "uiterlijk",
  "inschrijven", "aanvraag", "bevraging") of werken (`WORKS_TITLE`).
- Altijd alleen datums tussen de artikeldatum en `publishUntil`.
- Plaats: "district Antwerpen, locatie via de officiële bron"; uur: "Info".
- Gemeten op 5-10-2026: van 113 artikels leverde dit precies één nieuw item op (Herfstklaar). Herfstklaar,
  Lenteklaar en dergelijke vallen onder "Buurt & straat".

Zo komen Herfstklaar en dergelijke vanzelf binnen; een handmatig item is dan niet nodig.

## Handmatige items: automatische controle van hun bron

Zie de README ("Handmatige items: zichtbaar tot en met de einddatum"). `scripts/check-manual-sources.mjs`
draait in `npm run refresh`, na `build:sources`. Het kijkt de bron-URL na van elk zichtbaar handmatig item:
hoogstens 3 doorverwijzingen (alleen https), 1 seconde tussen de pagina's, zonder cookies. De
controlewoorden zijn de begindatum van elk item, plus `check.mustContain` van de bron in
`site/agenda-refresh.js`. `check: false` betekent: niet woordelijk te bevestigen. Het script laat de
verversing nooit vallen; lukt het niet, dan blijft het vorige `manual-check.json` staan.

## De andere districten (`stad-districten`)

- Kanalen: Berchem, Berendrecht-Zandvliet-Lillo, Borgerhout, Borsbeek (district sinds 2025), Deurne,
  Ekeren, Hoboken, Merksem en Wilrijk. Kanaal-id, slug, postcode en URL staan vast in
  `lib/district-channels.mjs`. Geen van die districten heeft een eigen "Wat beleef je"-pagina; hun
  agendapagina's tonen alleen een UiT-widget.
- `GET https://www.antwerpen.be/api/portaal/channel/<id>?contentType=10&start=0&limit=25`, één per kanaal,
  3 seconden ertussen, 20 seconden time-out per verzoek.
- Gelezen wordt alleen: id, slug, titel, publicatiedatum, `publishUntil` en de tekst- en tabelblokken.
  Personeelsvelden (`creator`, `assignee`, `lockOwner`) worden meteen weggegooid, afbeeldingen nooit
  overgenomen (foto's, video en grafisch werk vragen schriftelijke toestemming van de stad).
- Bovenop de regels van `district-nieuws` (tabel met datum/uur/locatie, "Wanneer:", "Datum:", "Praktisch"):
  - **Activiteitentabel**: een tabel met een datumkolom ("Datum…", "Wanneer") én een kolom "Activiteit…"
    of "Wat": elke rij is een eigen activiteit. De titel komt uit die cel (bij een link: de linktekst).
    Een rij zonder leesbare datum ("Tot oktober") valt weg; een link wordt alleen `infoUrl` als hij op
    www.antwerpen.be staat zonder querystring.
  - **Eén blok**: als niets anders een datum geeft, precies één blok `<p><strong>Titel</strong><br>datum …`
    (meestal "Meer info" onderaan), gelezen met `readBlock`/`parseBlock` van de districtskalender. Twee
    blokken met een datum is dubbelzinnig; een blok met als titel "Praktische info", "Info" of "Meer info"
    wordt geweigerd.
  - Artikels over werken, omleidingen, heraanleg of proefopstellingen worden overgeslagen.
- Altijd: alleen datums tussen de artikeldatum en `publishUntil`; wat al voorbij is, blijft niet staan.
- Noemt het artikel zelf geen plaats, dan wordt de plaats "District X, locatie via de officiële bron" met de
  postcode van dat district. Een artikel dat in meer dan één kanaal staat, gaat over de hele stad: dan
  "Stad Antwerpen, locatie via de officiële bron" zonder postcode.
- `inDistrict` is `true` alleen als de postcodes van het item bij district Antwerpen horen.
- Gemeten op 28-09-2026: 152 artikels, 25 komende activiteiten in de 9 kanalen samen.

## Markten (`stad-markten`)

- Eén verzoek naar GIPOD:
  `https://geo.api.vlaanderen.be/GIPOD/ogc/features/v1/collections/INNAME_PUNT/items` met
  `filter=Type='Evenement' AND PublicDomainOccupancyTypes LIKE 'Markt%' AND Owner LIKE 'Stad Antwerpen%'`
  (`filter-lang=cql-text`), het venster nu tot 365 dagen later en de bbox van de stad.
- Optioneel een tweede verzoek, 2 seconden later: de marktlijst van de stad
  (`geodata.antwerpen.be/arcgissql/rest/services/P_Portal/portal_publiek3/MapServer/202`). Haar `id` is
  de GIPOD-`Reference` (MA1, MA5 …) en geeft district en postcode. Faalt ze, dan gaan de markten zonder
  postcode door.
- Weg: parkeerrijen (`*_P`, "Parkeervoorziening …"), elke rij met "Ambulante handel", geannuleerde rijen,
  een eigenaar die niet "Stad Antwerpen" is, en een markt waarvan marktlijst en coördinaten elkaar
  tegenspreken over district Antwerpen.
- Titel zoals "Gemengde markt Kioskplaats"; `Start`/`End` staan in UTC en worden Brusselse tijd;
  `inDistrict` komt uit de coördinaten en de officiële districtsgrens (`pointInDistrict`).
- Per markt alleen de **eerstvolgende** marktdag die nog niet voorbij is, zodat de markten de stadsgroep
  niet overspoelen. Gemeten op 28-09-2026: 23 markten, waarvan 8 in district Antwerpen.
- De bronlink van een markt is haar GIPOD-rij (`…/items/INNAME_PUNT.<id>`).
- Licentie: Modellicentie Gratis Hergebruik v1.0, met bronvermelding.

## Koopzondagen (`stad-koopzondagen`)

- Eén `GET https://www.antwerpen.be/info/koopzondagen` per ronde (`accept: text/html`, geen redirects,
  20 seconden time-out, hoogstens 2 MB), zonder herhaling: de lijst verandert een paar keer per jaar.
- Waarom HTML en niet de portaal-API (`page-content-by-uuid`) zoals de districtskalender: dit is een
  infopagina van de nieuwe generatie zonder portaal-id van 24 hextekens; een API-adres raden levert niets
  zekers op. De gerenderde HTML is wat de stad publiceert.
- Gelezen wordt alleen de `<ul>` direct na de kop "Koopzondagen in <jaar>" (er mogen er meer zijn, zoals
  rond de jaarwissel). Scripts worden eerst weggeknipt (de Next.js-payload herhaalt de lijst ge-escapet);
  het contactblok onderaan de pagina wordt nooit gelezen. De ruwe HTML wordt nergens bewaard.
- Een regel telt alleen als hij volledig "<dag> <maand> <jaar>" is, optioneel met ": <korte context>"
  (Pasen, zomersolden, Allerheiligen …). Het jaar moet dat van de kop zijn en de dag een zondag. Een uur,
  een ander jaar, een andere weekdag of een dubbele datum: niet publiceren.
- Titel "Koopzondag", met de context tussen haakjes ("Koopzondag (Allerheiligen)"); uur "Info"; plaats
  "Toeristisch centrum Antwerpen", zoals de pagina het gebied noemt. Die zone ligt volledig in district
  Antwerpen, over de postcodes 2000 (kaaien, centrum, Eilandje) en 2018 (Pelikaanstraat, Quellinstraat,
  Britselei): daarom `postcodes: ["2000", "2018"]` en `inDistrict: true`. Groep `stad`. Zonder postcodes
  zou de samenvoeging een "Koopzondag" van een ander district (bijvoorbeeld Deurne, 2100) of een UiT-item
  in Wilrijk met deze koopzondag samenvoegen, en er als hoofditem zelfs `inDistrict: true` van maken; een
  UiT-item met alleen 2000 blijft nu een apart item (dubbel is beter dan een verkeerd district).
- Infotekst, voor elke datum dezelfde en neutraal: "Koopzondag in het toeristische stadscentrum volgens
  de lijst van stad Antwerpen. Openingsuren verschillen per winkel." Geen juridische uitleg over wie
  wanneer open mag: die staat op de officiële pagina (die nieuwe regelgeving aankondigt).
- Alleen komende koopzondagen (datum ≥ vandaag, Brusselse tijd). Na de laatste koopzondag van het jaar is
  0 items gezond: voorbije data tellen nooit als krimp.
- De kop verdraagt een harde spatie (letterlijk of als `&nbsp;`) en een dubbelpunt voor of na `</strong>`.
- Fouten: geen 200 of geen HTML → `error` met de HTTP-code of `not_html`; een body die halverwege wegvalt
  → `body_read_failed`; meer dan 2 MB (geteld in tekens, na het lezen) → `too_large`; geen lijst meer op
  de pagina (andere opmaak) → `error` met `no_list`. In al die gevallen blijven de vorige items staan.
  Een lijst die ineens (bijna) niets meer oplevert, valt onder de gewone krimpgrens (`suspicious_drop`).
- Gemeten op 28-09-2026: 15 koopzondagen in 2026, waarvan 6 komende (4 oktober t/m 27 december).
- Licentie: open data van stad Antwerpen (Vlaamse gratis open data licentie), met bronvermelding.

## Foren, schoolstraten en projecten van het district

Drie gratis bronnen zonder sleutel, elk met een eigen fetcher in `npm run refresh`. Faalt er één (geen
antwoord, geen 200, geen JSON, een lege of afgekapte laag), dan blijven haar vorige items staan en meldt
`refresh-status.json` de foutcode; een grote daling valt onder de gewone krimpgrens. Een bron die nog
nooit opgehaald is, meldt `npm run sources:health` als "nog niet opgehaald".

- **Foren** (`district-foren`, `lib/asign-foren.mjs`): de rijen van district Antwerpen uit A-Sign laag 0.
  Eén punt per periode (`periode1`–`periode3`), niet per dag. De periodetekst gaat voor op `begindatum` en
  `einddatum`: in oktober 2026 stond de einddatum van de Winterkermis op 2026-01-03 voor "4 december – 3
  januari". Het jaar komt van `begindatum` en rolt door over de jaargrens (`lib/periode-tekst.mjs`).
  Alleen de velden id, niveau, locatie, district, periode1-3, naam, begindatum en einddatum worden
  opgevraagd. Plaats en postcode komen uit de straatas (`site/geo/straten.json`).
- **Schoolstraten** (`district-schoolstraten`, `lib/schoolstraten.mjs`): per schoolstraat in het district
  één punt "Schoolstraat <straat>" over het lopende schooljaar (1 september tot 30 juni; in juli en
  augustus het volgende), met de venstertijden per weekdag. Thema "Werken", zodat de straatfiche het bij
  "Werken & verkeer" toont. Een proefopstelling krijgt een agendapunt op haar startdag, en een schoolstraat
  die definitief wordt een agendapunt op die dag. De foren vragen vlak ervoor aan dezelfde host
  (geodata.antwerpen.be), dus de fetcher wacht eerst 1 s: hoogstens 1 verzoek per seconde per host.
  Een datumveld dat geen geldige dag is (bv. een epoch buiten het bereik van `Date`), telt bij foren en
  schoolstraten als leeg; de verversing crasht er niet op.
- **Projecten** (`district-projecten`, `lib/district-projecten.mjs`): projectpagina's (heraanleg,
  vergroening, schoolstraten, speelterreinen …) uit het kanaal van district Antwerpen. Een blok
  "Inspraakmoment" of "Infomoment" met een regel `datum:` (plus `tijdstip:` en `locatie:`) wordt een
  agendapunt; een blok "Bevraging" met "tot (en met) <dag>" een deadline; een tabel met een fase- of
  zonekolom en een periodekolom (of start en einde) geeft één werkenpunt per fase. Vage periodes ("augustus
  2026 - begin 2027") worden de ruimste dagen en krijgen "(data bij benadering)"; "Start: 3 augustus 2026"
  in het blok "Fase 2" maakt de start exact. Deze bron vervangt de handmatige heraanleg-items die in
  `site/agenda.js` stonden.
  - Privacy: de kanaalrespons bevat personeelsvelden (`creator`, `assignee`, `lockOwner`) en namen en
    nummers van aannemers. `projectPage()` houdt alleen titel, tags, `publishUntil` en de tekst van tekst-
    en tabelblokken over; blokken "Meer info", "Contact" en "Samenstelling" worden overgeslagen, en de
    pagina's over de districtsraad, subsidies en reglementen zijn geen projecten. Plaatsen verliezen hun
    huisnummers, telefoonnummers en e-mailadressen (`zonderHuisnummers`): ook "Meir 24 2000 Antwerpen"
    (een nummer vlak voor een postcode), reeksen ("135-137"), busnummers ("34 bus 2") en straten op -baan,
    -dorp, -aan, -gang, -steeg, -poort … Er komt geen vrije tekst van de pagina in een item, buiten datum,
    uur, plaats, fase en zone.

## Speelstraten via GIPOD

De operationele agenda gebruikt GIPOD als tweede officiële bron naast eBesluit. Een GIPOD-record telt alleen als speelstraat wanneer:

- `Type = Evenement`;
- `PublicDomainOccupancyTypes` expliciet `Speelstraat` bevat;
- status `Concreet gepland` of `Lopende` is;
- het GIPOD-punt exact binnen District Antwerpen valt;
- de beschrijving een concrete locatie bevat met postcode 2000, 2018, 2020, 2030, 2050 of 2060 en een straatnaam;
- de totale periode maximaal 14 dagen duurt.

Contactorganisaties, aanvragers en andere bronvelden worden niet overgenomen. Een langer of niet concreet record wordt niet gepubliceerd. Deze GIPOD-laag geeft operationele straat + periode; eBesluit blijft de juridische bron voor de volledige goedkeuringslijst en eventuele weigeringen.

## Buurtkaart: wijken en coördinaten (geen agendabron)

- `site/geo/wijken.geo.json`: de 67 wijken van stad Antwerpen uit de laag `wijken_omgevingsinformatie`
  (geodata.antwerpen.be, `P_Portal/portal_publiek2/MapServer/97`), door de server vereenvoudigd
  (`maxAllowableOffset` 0,00005°) en afgerond op 5 decimalen (±88 KB). De site gebruikt de 24 wijken van
  district Antwerpen (`ANT01`–`ANT25`). Open data van stad Antwerpen, gratis hergebruik met bronvermelding.
  Handmatig te vernieuwen met `npm run geo:wijken`; niet in de dagelijkse ronde.
- `site/geo/locaties.json`: punt per locatietekst van een komend agendapunt, gemaakt door
  `npm run geo:refresh` (onderdeel van `npm run refresh`, na `build:sources`). Bron: Geolocation-API van
  Digitaal Vlaanderen (Basisregisters Vlaanderen, Modellicentie Gratis Hergebruik v1.0).
  - Alleen de publieke locatietekst gaat naar de API, hoogstens 150 verzoeken en 2 minuten per ronde.
  - Aanvaard wordt alleen een adres of straat in een postcode van de stad, waarvan de straatnaam en het
    huisnummer letterlijk in de locatietekst staan. Zonder postcodecontrole (straat over twee postcodes)
    alleen als de straatnaam in het antwoord onder één postcode voorkomt.
  - Niet gevonden: in `misses`, na 14 dagen opnieuw geprobeerd. Locaties van voorbije items vallen weg.
  - Faalt de API, dan blijft het vorige bestand staan en faalt de ronde niet.
  - `npm run validate:data` controleert vorm, punten binnen de stad en de privacyscan; het pad staat in
    `lib/data-lane-paths.json`.
- In de browser wordt nooit gegeocodeerd. Werken gebruiken hun eigen GIPOD-punt; items zonder punt maar met een
  officiële straat (parkeren, vergunningen) vallen in een wijk via de straatas.

## Attributie

- District: "Bron: district Antwerpen – bron stad Antwerpen (Vlaamse gratis open data licentie)".
- Andere districten: "Bron: districten van stad Antwerpen – bron stad Antwerpen (Vlaamse gratis open data
  licentie)".
- Koopzondagen: "Bron: stad Antwerpen, koopzondagen (Vlaamse gratis open data licentie)", met een link
  naar https://www.antwerpen.be/info/koopzondagen.
- Markten: "Bron: GIPOD, Digitaal Vlaanderen, en marktlijst stad Antwerpen (Modellicentie Gratis
  Hergebruik v1.0)", met een link naar de OGC API van GIPOD.
- Op de site staat bij elke gratis stadsbron haar eigen bronvermelding; op een eventpagina die van de bron
  met voorrang.
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
