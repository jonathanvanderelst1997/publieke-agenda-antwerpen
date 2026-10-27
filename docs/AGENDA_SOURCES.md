# Automatische bronnen van de publieke agenda

De agenda vult zich uit officiële, publieke bronnen. District en stad zijn twee aparte groepen,
in de data én op de site. Handmatige items in `site/agenda.js` blijven bestaan, maar een item uit een
automatische bron gaat voor.

## Bronnen

| sourceId | Groep | Wat | Hoe |
|---|---|---|---|
| `district-kalender` | district | "Wat beleef je in district Antwerpen?" | publieke portaal-API van antwerpen.be (`page-content-by-uuid/5efb0477b118f7b19c627b69`), hoogstens 2 verzoeken per ronde |
| `district-nieuws` | district | nieuwsartikels van district Antwerpen | publiek nieuwskanaal; alleen een tabel (datum/uur/locatie) of een regel "Wanneer:", "Datum:" of een blok "Praktisch" telt, en alleen tussen de artikeldatum en `publishUntil` |
| `district-gipod-evenementen` | district | publieke evenementen en operationele speelstraten op openbaar domein; **levert in de praktijk niets** | GIPOD `INNAME_PUNT`, standaard 365 dagen vooruit; alleen actuele/geplande `Evenement`-records met exact punt in District Antwerpen. Gewone evenementen blijven conservatief; `Speelstraat` telt alleen met concrete districtsstraat en een periode van maximaal 14 dagen. Stad Antwerpen zet in GIPOD alleen markten en ambulante handel; echte evenementen (feest/kermis, sport) staan er alleen van buurgemeenten, buiten het district (meting 10-10-2026: 9.083 rijen in het kader, 0 evenementen in het district). De bron gooit alles buiten het district weg (`outside_district` in `lib/gipod-events.mjs`) en toont dus nooit een evenement van een buurgemeente. Daarom het label "GIPOD-evenementen in het district (stad Antwerpen meldt hier geen evenementen; GIPOD bevat vooral buurgemeenten)"; de bron blijft staan voor als de stad ze toch in GIPOD zet. De bronlink van een item en van de bron is de GIPOD-datasetfiche, nooit de `INNAME_PUNT`-rij (zie "Geen links naar ruwe GIPOD-records" in `docs/WORKS_LIVE_SOURCE_POLICY.md`). |
| `district-asign-evenementen` | district | de evenementendossiers van de stad op straat (parcours, verkeersvrije zones, innames): één punt per evenementdag, met naam, soort, of wat en waar met "naam onbekend" | **afgeleid**, geen eigen verzoeken: de dossiers die de parcoursherkenning al uit A-Sign (laag 22 en 23) haalt, in de stap `refresh:herkenning` (zie onder) |
| `district-foren` | district | foren en kermissen, één punt per periode | A-Sign `MapServer/0` (foor) van geodata.antwerpen.be, één verzoek per ronde; geen sleutel (zie onder) |
| `district-schoolstraten` | district | de schoolstraten met venstertijden, en de start van een proef | `P_Portal/portal_publiek10/MapServer/986` van geodata.antwerpen.be, één verzoek per ronde; geen sleutel (zie onder) |
| `district-projecten` | district | inspraak- en infomomenten, bevragingen en fasen van projecten in de publieke ruimte | de projectpagina's van district Antwerpen via de publieke portaal-API (`contentType=9`), hoogstens 6 verzoeken met 1 s ertussen (zie onder) |
| `stad-districten` | stad | nieuwsartikels van de 9 andere districten | de publieke nieuwskanalen (`lib/district-channels.mjs`), één verzoek per kanaal met 3 s ertussen; dezelfde regels als `district-nieuws`, plus een activiteitentabel en één blok "Titel + datum" (zie onder) |
| `stad-markten` | stad | de openbare markten van de stad, eerstvolgende marktdag per markt | GIPOD (Digitaal Vlaanderen, OGC API Features, `INNAME_PUNT`), verrijkt met de marktlijst van geodata.antwerpen.be; geen sleutel. De bronlink is de GIPOD-datasetfiche, geen link per rij |
| `stad-koopzondagen` | stad | de komende koopzondagen van de stad | de publieke infopagina https://www.antwerpen.be/info/koopzondagen (HTML, lijst "Koopzondagen in <jaar>"), één verzoek per ronde; geen sleutel |
| `stad-uit` | stad | activiteiten in de 15 postcodes van de stad | UiTdatabank Search API v3 (betalend); **uit zolang er geen sleutel is**: wacht op de beslissing van de eigenaar (sleutel kost geld; zie onder) |
| `mail-district`, `mail-stad` | district / stad | publieke activiteiten uit nieuwsbrieven | mail-signalen van de Brain Gateway; titel en datum worden op de officiële pagina gecontroleerd, uur en plaats alleen overgenomen als ze daar ook staan (zie onder) |
| `awv-werf-supplement` | district | **geen agendapunten**: een aanvulling op de GIPOD-werken (rijstroken, doorgang, snelheidsbeperking, omleidingen, fase en werf van AWV), alleen op exact hetzelfde GIPOD-id | WFS "Werf – Innames" en "Werf – Lokale omleidingen" van het Agentschap Wegen en Verkeer (open data, geen sleutel), één vraag plus de omleidingen in blokken van 100 (zie onder) |

De vaste eigenschappen van elke bron (groep, uitgever, attributie, toegelaten hosts) staan in
`lib/source-feed.mjs`, niet in de data. Een data-refresh kan dus geen nieuwe host of andere groep toevoegen.

## Vooruitkijkhorizon

Er is geen algemene limiet van 7 dagen. Elke gratis bron wordt zo ver vooruit gelezen als zij betrouwbaar en begrensd toelaat:

- GIPOD-evenementen: 365 dagen in de vraag, maar GIPOD publiceert maar zes maanden vooruit (dataset 2b4b3bb7; gemeten op 17-10-2026: de laatste start in het district is 18-04-2027). In de praktijk dus zes maanden.
- GIPOD-markten: 365 dagen queryhorizon, in de praktijk ook zes maanden; per markt alleen de eerstvolgende nog geldige marktdag.
- Districtskalender en districtsnieuws: alle concreet gedateerde toekomstige items binnen hun geldige publicatieperiode.
- eBesluit en openbare vergaderingen: officiële zoek- en kalenderperiodes, zonder 7-dagenafkap.
- Koopzondagen: alle nog komende data die in de officiële jaarlijsten staan.
- UiT blijft optioneel en heeft, indien ooit geactiveerd, een afzonderlijke volumelimiet en coverage-indicatie.

De site en straat-tijdlijn mogen dus alles tonen wat deze bronnen betrouwbaar kennen; niet bekende toekomstige data worden nooit afgeleid of gegokt.

## Stroom

```
npm run refresh:fetch   # fetchers in vaste volgorde (lib/source-registry.mjs) → site/sources/*.json
                        # en site/sources/refresh-status.json
npm run refresh:herkenning  # parcoursherkenning, daarna de afgeleide bron district-asign-evenementen
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
  ververst;
- **`error`** als de vorige data ouder is dan 48 uur (haar items zijn dan ook van de site), of bij een
  blijvende fout (`suspicious_drop`, `no_list`, `invalid_json` …). Dat blijft rood.

## Een falende bron: intern wel, voor bezoekers niet

Besluit van de eigenaar (18-10-2026): "niemand moet weten als er iets faalt, de momentopname blijft wel
goed". De site toont daarom nergens dat een bron, een laag of een live aanvraag faalt of oud is: ze toont gewoon
de laatste goede stand. Een echte lege toestand blijft leeg (geen verzonnen 0, geen "rustig", geen "niets
gepland"), zonder uitleg waarom. `tests/bron-waarschuwing.test.mjs` houdt de zinnen van vroeger buiten
`site/`.

Op de agenda:

- geen bronwaarschuwing bovenaan (de melding `#agenda-source-warning` van #191 en `site/bron-waarschuwing.js`
  zijn weg, op de voorpagina en op de plekpagina);
- de bronnenlijst ("Bronnen en volledige vooruitblik") zegt bij zo'n bron gewoon "ververst op …" met het moment
  van haar laatste goede stand, zonder "mislukt", "onbereikbaar" of "verouderd";
- de zin "Officiële broncontrole …" in datzelfde blok (`#agenda-refresh-note`, `refreshNoteText` in
  `site/agenda.js`) telt de punten van zo'n bron niet: ze noemt alleen verlopen punten en echte bronconflicten, en
  is dezelfde of een bron nu faalt of niet (vroeger stond er "punten met bronconflict of verouderde bron", en met
  eBesluit falend waren dat precies de punten van eBesluit);
- laadt de gezamenlijke straatfilter (`site/agenda-view.js`) niet, dan blijft de gewone agenda, zonder zin
  erover.

Buiten de agendabronnen (live lagen, radar, historiek, kaart):

- de zin onder een straat (`standZin` in `site/straat-snapshot.js`): lukt live nakijken niet, dan "Stand van de
  verversing van 05:22."; lukt het deels, of laden de straatassen voor de straal niet, dan "Live nagekeken: …" met
  wat wel lukte. Vroeger: "Live nakijken lukte nu niet …", "Rond de straat kon nu niet live geladen worden …",
  "De straal rond de straat kon nu niet geladen worden …";
- de momentopname van een straat (`site/straat/<id>.json`) blijft staan als een live laag faalt, ook als de bezoeker
  "Alle lijsten, bronnen en instellingen" openklapt en de lijsten van het hele district dan laden en falen (nakijkronde
  3 van 18-10-2026: de parkeerverboden, werfzones en evenementen van de straat vielen toen stil weg uit de weekzin,
  de tegels en de lijst). Per laag zijn er twee bronnen, de straat en het district; `kiesLaag` in `site/live-lagen.js`
  kiest: een gelukte lijst van het hele district, anders de laag van de straat (de momentopname of het gelukte live
  kader), anders wat er wel is. Alleen een gelukte live laag vervangt de momentopname; een die (deels) faalt, vervangt of
  leegt ze nooit, en de zin eronder blijft "Stand van de verversing van …" (`tests/momentopname-live-laag.test.mjs`,
  `tests/e2e/snelheid.e2e.mjs`). Wat een laag mist, vraagt elke lijst van het district en elk kader van een straat aan
  `mislukteOnderdelen` in `site/live-lagen.js` (per laag haar bronnen); nakijkronde 4 van 18-10-2026: de werkenlijst
  van het district ging door als volledig zonder districtsgrens of straatassen (een werk viel dan weg uit de straat), en
  het kader van een straat zonder GIPOD-hinder ook (de ernstige hinder verdween). Nu zijn beide deels geladen
  (`werkenMislukt` in `site/works-live.js`: zonder grens, straatassen of hinder). Een mislukt onderdeel dat niet in
  `ONDERDELEN` staat, of een bron die de laag niet kent, valt nooit weg (vroeger maakte "parkeerverboden en innames"
  een week zonder nagekeken publieke ruimte "Rustig"). Kiest de bezoeker een andere plek, dan haalt de plekpagina de
  lagen van de vorige straat in één keer weg (`zetStraatStand` in `site/place-view.js`): weg van de straat, zonder
  stand, of een laag zonder bruikbare stand;
- een plek groter dan één straat (nakijkronde 5 van 18-10-2026). Een laag van de plekpagina draagt haar dekking: het
  gebied dat ze nakeek (`dektGebied` in `site/live-lagen.js`), en `live.gebied` is het gebied dat de bezoeker koos (de
  plek, met de straal rond een straat). Een lijst van het hele district dekt elk gebied; de momentopname van een
  straat alleen die straat; het live kader van een straat de straal waarmee het gevraagd is. Een laag die het gebied
  niet dekt, houdt haar items maar is deels geladen (alle onderdelen in `live.failed`, `kiesLaag`): met een straal en
  een live kader dat faalt (A-Sign, GIPOD, de districtsgrens of de straatassen) staat er dus nooit "Rustig" en geen 0
  voor "in en rond jouw straat" (vroeger zei de momentopname van de straat alleen dat voor het hele gebied, met tegels
  op 0), en zolang het kader nog onderweg is, zegt de weekzin dat er nog geladen wordt (vroeger al "Rustig", met een
  spinner). Laden de straatassen voor de straal niet (`view.straalStand`), dan ligt niets rond de straat vast: dan
  ook geen 0 bij evenementen en inspraak. Een wijk of postcode laadt de lijsten van het district live; faalt er één
  (helemaal of deels), dan krijgt ze de momentopname van al haar straten (`laadGebied` en `lagenUitGebied` in
  `site/straat-snapshot.js`, elk item één keer), zoals een straat de hare (vroeger verdwenen dan alle werken,
  parkeerverboden en vergunningen van een wijk, met "–" naast echte getallen). Een straat zonder stand in dat gebied
  (`alleenLive`, of een bestand dat niet laadt) maakt die momentopname deels geladen. Een item zonder eigen punt hangt
  aan een wijk via zijn straten; zonder straatassen via de wijken per straat in `site/geo/straten.json` (dezelfde regel
  als `streetWijkMap`). De momentopname van de straten binnen een straal toont de plekpagina niet: een straatbestand
  heeft geen punt of vorm (privacy), dus de straal is er niet op toe te passen
  (`tests/gebied-momentopname.test.mjs`, `tests/e2e/snelheid.e2e.mjs`);
- de plekpagina: geen melding "… konden nu niet geladen worden. Dit overzicht is onvolledig." boven de tegels of
  in de lege staat (`onvolledigMelding` in `site/live-lagen.js` is weg). Intern blijft `live.failed`: een laag
  die niet laadde, maakt de weekzin nooit "rustig" en een tegel nooit een valse 0 (een streepje). De lege staat
  zegt dan "niets gevonden" (`legeStaatTekst`, `legeDagLabel`, `legeTijdlijnTekst` in `site/place-core.js`), niet
  "Niet alles laadde", "zijn niet (volledig) geladen" of "In wat wel geladen is". De weekzin (`dezeWeek`) noemt wat
  gevonden is; is er niets gevonden en geen betrouwbare stand (live noch in de momentopname), dan valt ze weg
  (nakijkronde 3: het grijze label "Onbekend" met "niets gevonden." verraadde dat een laag faalde; bij gezonde
  bronnen staat er "Rustig" of "Let op"). Alleen wat de bezoeker zelf koos (een soort die uit staat en daarom niet
  geladen is), zegt de zin erbij, en zolang een laag nog onderweg is, zegt de zin dat ze nog geladen wordt.
  Nakijkronde 3 (18-10-2026): ook de chips en de tegel "vergunningen". Laadde een laag van "Werken & verkeer"
  (GIPOD, of een deel van A-Sign: dan meldt de publieke ruimte `[]` met mislukte onderdelen) of van "Vergunningen"
  (omgevingsdossiers, terrassen) niet, dan staat er op de chip geen getal in plaats van 0 (`chipGetal` in
  `site/place-core.js`); laadden de omgevingsdossiers niet, dan toont de tegel "vergunningen" een streepje.
  `site/permits-live.js` meldt daarvoor een mislukking in `live.failed` (`meldLiveLaag`, onderdeel "vergunningen"),
  zoals de andere live lagen. Wat wel geteld is, blijft staan, een echte 0 ook;
- de "Volledige vooruitblik" (in het ingeklapte blok "Bronnen en volledige vooruitblik", op de voorpagina en de
  plekpagina, `vooruitblikTellers` in `site/week-pulse.js`): laadden de werken of de publieke ruimte niet, dan staat er
  een streepje in plaats van "0 werken starten", "0 eindigen", "0 maatregelen starten" of "0 werken met ernstige
  hinder" (de stand per laag volgt `laagStand` in `site/live-lagen.js`, zoals "Alles per straat");
- de buurtinfo (`site/buurt-info.js`, `radarToestand` in `site/buurt-info-core.js`): is een bronlaag niet actueel
  of de radar ouder dan 26 uur, dan dezelfde zin en dezelfde getallen als anders; zonder radar is het blok leeg.
  Vroeger: "Niet alle bronlagen zijn actueel. Getallen worden niet als volledig voorgesteld.", "De radar is ouder
  dan 26 uur …", "Het wijzigingsoverzicht kon niet worden geladen …";
- de district-radar en de straatfiches op de voorpagina (`radarRegels` in `site/street-overview.js`): een laag
  die niet ververst raakte, toont de laatste goede stand; zonder bruikbare historiek staat er "—" zonder uitleg, en
  "Geen operationele wijzigingen" staat er alleen als alle lagen nagekeken zijn. Laadt de straatas niet, dan is
  dit deel leeg. Vroeger: "history verouderd", "na gezonde history-refresh", "Straatfiche tijdelijk niet
  beschikbaar";
- de lijsten van het district (werken, innames, vergunningen, terrassen): laadt een lijst niet, dan is ze leeg,
  zonder "0" en zonder notitie; laadt een aanvulling niet (de districtsgrens, de GIPOD-hinder, A-Sign, de
  AWV-werfdata, of die is ouder dan 3 dagen), dan valt haar zin weg en blijft de rest. Vroeger o.a. "De AWV-werfdata
  is ouder dan 3 dagen …", "… kon nu niet geladen worden", "Hinderbron tijdelijk niet geladen", "Werken tijdelijk
  niet geladen", "Terrassen niet geladen", "Omgevingsdossiers tijdelijk niet geladen". Ook de regel met de
  aantallen telt alleen wat laadde (`publiekeRuimteKop` in `site/public-space-live.js`, `werkenMeta` in
  `site/works-live.js`): geen "0 parkeerverboden · 0 innames" voor een A-Sign-laag die niet laadde, geen "0 met
  gekoppelde hinder", "0 met A-Sign supplement" of "0 met AWV-werfdata" voor een aanvulling die niet laadde, en
  zonder enige A-Sign-laag geen "0 maatregelen" en geen "A-Sign, geladen …";
- een laag die niet laadde, "laadt" niet eeuwig: onder de buurtkaart staat dan geen "werken en hinder worden
  geladen…" (`kaartStatusZin` in `site/neighborhood-map.js` kijkt ook naar `live.failed`), en bij "Alles per
  straat" op de voorpagina geen "Live werken en maatregelen worden nog opgehaald." en geen "0 straten met actuele
  of geplande informatie" (`overzichtTekst` in `site/street-overview.js`); de district-radar toont dan "—" in
  plaats van "0 straten met ernstige hinder";
- een werkkaart (`site/kaart-uitleg.js`) zegt niet meer "gevolgen voor het verkeer nu niet opgehaald" of "de
  straat kon nu niet bepaald worden"; de historiek van een werk (`site/werk-historiek.js`) toont niets als het
  archief niet laadt of onbruikbaar is;
- de buurtkaart: laden de wijkgrenzen niet, dan geen zin erover; laadt de kaart niet, dan blijft de knop "Toon de
  kaart" (vroeger "Kaart niet beschikbaar · opnieuw proberen").

Intern blijft alles:

- de bronstatus in het bronbestand, in `site/sources/refresh-status.json` en in de feed (`fetchStatus`,
  `errorCode`, `retrievedAt`), en `sourceFreshness` in de browser (`site/agenda-refresh.js`);
- de status van de live lagen in de historiek en de radar (`status` per laag), en `live.failed` in de browser;
- `npm run sources:health`, de job `source-health` en de alarmen naar de eigenaar: faalt `source-health`, dan vult
  de job `alarm` in `.github/workflows/refresh.yml` het open alarm-issue "Alarm: agendaverversing of live versheid
  faalt" aan (of opent het, als er geen open is), net als bij een falende verversing, datatak of live versheid. Dat
  gebeurt bij een geplande run én bij een dispatch (behalve een proefrun met aanleiding "test"): de echte
  ochtendverversing start de Gateway met `workflow_dispatch`, en de late cron slaat dan refresh en `source-health`
  over (`al-vers`). Alleen bij de cron kwam er bij een rode bronstatus dus nooit een issue (15 tot 18 oktober 2026,
  eBesluit rood). Het alarm loopt alleen vanaf de standaardtak (`github.ref == 'refs/heads/main'`): een handmatige
  run vanaf een andere tak faalt bewust (stap "Alleen vanaf main") en opent of vult geen alarm-issue. Zonder melding
  op de site is dat het signaal voor de eigenaar. De reactie noemt welke bron of laag faalt, met haar foutcode
  (nakijkronde 5 van 18-10-2026: elke rode bronstatus gaf dezelfde reactie, en een nieuwe falende bron viel niet op
  naast de eBesluit-fout die elke ochtend rood stond): de stap "Elke bron gezond" geeft haar regels die met `BRON`
  beginnen door als job-output `bron` (en zet ze in de samenvatting van de run), en de job `alarm` zet ze via `env`
  in een codeblok in de reactie. Alleen vaste codes, bron-ID's en tijdstippen, tot veilige tekens beperkt (geen
  `@`, backtick, haken of `<` `>`) en hoogstens 30 regels (`tests/refresh-workflow.test.mjs`);
- ook voor de live lagen (nakijkronde 3 van 18-10-2026; vroeger was de zin op de site daar het enige signaal): de
  historiek (`site/history/live-layers.json`: `works`, de GIPOD-werken, en `publicSpace`, de publieke ruimte; ook de
  bron van de radar) en de straatbestanden (`site/straat-index.json`: werken, publiekeRuimte, vergunningen, terrassen,
  evenementen). Dezelfde
  regel als bij een agendabron (`liveLaagGezondheid` in `lib/live-history.mjs`): een laag die niet ververst raakte,
  houdt haar vorige goede stand, en zolang die niet ouder is dan 48 uur is dat een waarschuwing (`::warning title=Live
  laag stale` in de job `source-health`, "Live laag stale" of "Straatbestanden" in `npm run sources:health`). Geen
  goede stand (`error` zonder `sinds` of `lastSuccessAt`), een goede stand van meer dan 48 uur of een onbekende status
  is rood: de job `source-health` faalt (regel `BRON live-historiek …` of `BRON straatbestanden …`) en de job `alarm`
  vult het alarm-issue aan. De job `refresh` geeft daarvoor de status per laag, zonder items, mee in het artefact
  (`live-lagen.json`, stap "Stand van de live lagen"); ontbreekt dat bestand, dan faalt `source-health` dicht. Elke
  laag hierboven moet erin staan: ontbrak de historiek of `site/straat-index.json` in de verversing, of staat een laag
  er niet in, dan is `source-health` ook rood (regel `BRON … ontbreekt in de stand van de live lagen`, nakijkronde 3
  van 18-10-2026: vroeger bleef ze dan groen) en vult de job `alarm` het alarm-issue aan;
- de versheidsregel hieronder: na 48 uur verdwijnen de items van een bron die niet ververst raakt.

Ook als de hele agenda meer dan 48 uur niet ververst is, zegt de site dat niet meer (nakijkronde 2 van
18-10-2026): geen melding "De agenda wordt even niet ververst … We werken eraan.", geen oranje pil "Laatst
bijgewerkt", geen badge "Laatst bevestigd …" en geen "… omdat de verversing achterloopt" in de zin over de
broncontrole. De kop toont "Bijgewerkt …" met het tijdstip van de momentopname, en de bronitems blijven 14 dagen
zichtbaar (`graceStale`, intern). Zo eindigen ook dan op een gsm de plek en "Dit weekend" boven 600 px (P6, P8;
met de melding waren dat 573/691/845 px en 791 px). De eigenaar krijgt het signaal via de job `freshness` en het
alarm-issue. Wat niets met een bron te maken heeft, blijft: "Export niet beschikbaar" (het agendabestand maken in
de browser), "Opslaan lukte niet" (een straat bewaren in de browser) en "Locatie niet beschikbaar" (de locatie van
het toestel).

De eBesluit-kalender (terugval van `district-vergaderingen`, 13 maandpagina's) pauzeert 250 ms tussen
de pagina's en probeert een maand bij 5xx, 429, time-out of netwerkfout nog twee keer opnieuw (na 2
en 5 seconden).

## De reden van een fout in het bronbestand (`lastError`)

Bij elke fout bewaart een fetcher de vorige, geverifieerde items (`keepPreviousOnError` in
`lib/fetch-util.mjs`). Het bronbestand zegt sindsdien ook waarom en sinds wanneer:

```json
"fetchStatus": "error",
"lastSuccessAt": "2026-10-12T03:21:58.546Z",
"lastError": { "code": "search_http_500", "at": "2026-10-19T03:21:00.000Z" }
```

- `lastError.code` is de vaste foutcode van de laatste poging (`http_500`, `search_incomplete`,
  `no_decisions`, `timeout`, `source_timeout`, `suspicious_drop` …), `lastError.at` het moment van die poging;
  dezelfde code staat als `errorCode` in `refresh-status.json`;
- bij eBesluit (`district-ebesluit`, `district-ebesluit-evenementen`) draagt de code een vaste fase
  (`metFase` in `lib/ebesluit-discovery.mjs`): `search_<code>` als een zoekpagina faalde, `detail_<code>` als
  de detailpagina van een agendapunt faalde, bv. `search_http_500` of `detail_http_500` (vroeger zei `http_500`
  bij `district-ebesluit` niet welk van de twee). Een code die al een fase heeft (`search_incomplete`) of die
  van het tijdsbudget is (`source_timeout`, `refresh_budget_exhausted`), blijft zoals ze is.
  `isTransientErrorCode` (`lib/fetch-util.mjs`) en de job `source-health` kijken door de fase heen:
  `search_http_500` is tijdelijk zoals `http_500`, `detail_http_404` blijvend; de melding toont de hele code;
  `lastSuccessAt` is de laatste geslaagde verversing (gelijk aan de bewaarde `retrievedAt`). Zo staat in de
  repo welke fout er is en sinds wanneer, ook als de logs van de verversing niet te lezen zijn.
- Alleen een foutcode (`[a-z0-9_]`, hoogstens 60 tekens) en twee tijdstippen: nooit een URL, een zoekterm of
  andere vrije tekst. `validateSourceDocument` (`lib/source-feed.mjs`, ook `npm run validate:data`) aanvaardt
  de twee velden alleen samen en alleen bij `fetchStatus: "error"`; een bestand zonder blijft geldig.
- Een geslaagde verversing schrijft het bestand opnieuw zonder deze velden.
- Intern: de feed (`scripts/build-sources.mjs`) neemt ze niet over en de site toont ze nergens (besluit van
  18-10-2026, zie hierboven). `refresh-status.json` houdt zoals voorheen `errorCode` per bron.

## eBesluit: kleinere zoekpagina's bij een serverfout

eBesluit levert tot 500 rijen per zoekpagina (`EBESLUIT_PAGE_SIZE`). Sinds 12/13 oktober 2026 faalden
`district-ebesluit` en `district-ebesluit-evenementen` elke nacht met HTTP 500 (#180, #186); bij de
evenementenbron kan dat alleen het zoeken zijn, want haar detailronde vangt haar eigen fouten op. Daarom
(`lib/ebesluit-discovery.mjs`):

- geeft een zoekpagina na de bestaande herkansing (`getHtml`, één keer na 1,5 s) nog een 5xx, dan wordt
  **hetzelfde venster** opnieuw doorzocht met pagina's van 100 en daarna 50 rijen
  (`EBESLUIT_FALLBACK_PAGE_SIZES`). De rijen van een mislukte poging tellen niet;
- elke poging blijft binnen 20 pagina's (`EBESLUIT_MAX_PAGES`, dus 2.000 rijen bij 100 en 1.000 bij 50): meer
  treffers maken het venster onvolledig, en dan splitst het bestaande kwartaal-/maandpad zoals voorheen.
  Het tijdsbudget van de bron (6 en 4 minuten) blijft gelden;
- weigert eBesluit een grootte, dan begint elk volgend venster van **dezelfde run van die bron** meteen bij de
  kleinere: over alle zoektermen en, bij `district-ebesluit`, over beide jaren (`pageSizeChoice`). De geweigerde
  pagina van 500 wordt zo per run maar één keer gevraagd (met de herkansing: 2 verzoeken), niet per zoekterm en
  jaar (vroeger 8 keer bij `district-ebesluit` en 6 keer bij de evenementen, en zo ging het tijdsbudget op). De
  keuze gaat alleen naar kleinere pagina's en leeft alleen in die run: geen bestand, de volgende run begint weer
  bij 500;
- pas als ook pagina's van 50 falen, is het venster onvolledig, met de foutcode erbij. Faalt zo ook een
  kalendermaand (het kleinste venster), dan stopt de zoekronde meteen met die code (bv. `search_http_500`): ze kan
  niet meer volledig worden, en verder vragen belast een server in storing. Bij een aanhoudende 500 zijn dat
  10 verzoeken voor `district-ebesluit` en 8 voor `district-ebesluit-evenementen`;
- fail-closed blijft: een onvolledige zoekronde wordt nooit als volledig aanvaard (#186); de bron krijgt
  `fetchStatus: "error"` met de vorige items en `lastError`.

## Tijdsbudget: een trage bron houdt de verversing niet tegen

De job `refresh` stopt hard na 20 minuten; dan gaat er niets door, ook niet de gezonde bronnen.
Daarom draait `scripts/refresh-fetch.mjs` elke fetcher binnen een tijdsbudget:

- standaard 3 minuten per fetcher (`SOURCE_BUDGET_MS`), `district-ebesluit` 6 minuten en `awv-werf-supplement`
  60 seconden (`budgetMs` in `lib/source-registry.mjs`), alle fetchers samen hoogstens 12 minuten (`REFRESH_BUDGET_MS`), de live
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
- Ook samen: een item dat zelf zegt over welk item van een andere bron het gaat (`sameAs`, een lijst ids).
  Alleen `district-asign-evenementen` zet dat veld, berekend met de echte vorm van het dossier (zie onder);
  het geldt ook bij een andere postcodelijst en gaat niet mee naar de site.
- Nooit samen (buiten `sameAs`): twee items met verschillende, niet-lege postcodelijsten.
- Voorrang: `district-kalender` > `district-nieuws` > `district-vergaderingen` > `district-gipod-evenementen` >
  `stad-districten` > `stad-markten` > `stad-koopzondagen` > `district-ebesluit` > `district-asign-evenementen` >
  `district-ebesluit-evenementen` > `stad-uit` > `mail-district` > `mail-stad` > de rest (alfabetisch) > handmatig.
- Een samengevoegd item neemt `fasen` en `straten` over van een bron die ze heeft (de kalender kent het uur,
  het dossier de fasen en de straten). De feed (`site/agenda-feed.js`) draagt die twee velden niet: de site
  leest ze niet, en de voorpagina laadt de feed bij elk bezoek. Ze blijven in het bronbestand.
- Zegt het primaire item zelf (`sameAs`) dat het over een ander punt gaat, dan beslaat het samengevoegde
  item de ruimste periode van die twee: een dossier van één dag bij een festival van drie dagen uit een
  besluit verliest zo geen dagen. Een bijdrager die naar het primaire item wijst, rekt het niet op (één dag
  uit een dossier van weken maakt van een opening in de kalender geen evenement van weken).
- Het samengevoegde item houdt de velden van de bron met voorrang en toont **alle** bronlinks.
- Vervangt een feed-item een handmatig item, dan staat de hand-id in `supersedes`: de site verbergt het en
  de build verwijdert de eventpagina.

## Versheid

- Elke automatische bron is 48 uur geldig (`maxAgeHours`). Daarna verdwijnen haar items (reden
  `stale_source`). De site zegt dat niet aan bezoekers (besluit van 18-10-2026, zie "Een falende bron"
  hierboven); `sources:health` meldt het wel.
- Handmatige items op datum blijven zichtbaar tot en met hun laatste dag (`endDate`, anders `date`, in
  `Europe/Brussels`) en verdwijnen de dag erna, zonder herbevestiging. Alleen een handmatig item met een
  vaste classificatie uit een regel (een lopende werf zonder harde einddatum) volgt nog de provenance-SLA van
  2 dagen.
- De gratie van 14 dagen (`graceStale`) geldt alleen voor bronitems, en alleen als de laatste verversing ouder is
  dan 48 uur. Een bezoeker ziet ze als gewone items, zonder "Laatst bevestigd" (besluit van 18-10-2026).
- Per bron toont de site "ververst op …" (het moment van de laatste goede stand, ook als de laatste
  ophaalpoging faalde), in het oranje "leeg sinds …" of "nog niet actief".

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
- De bronvermelding van een markt is de GIPOD-datasetfiche, geen link per rij: "Bron: GIPOD (Digitaal
  Vlaanderen)" met https://metadata.vlaanderen.be/srv/api/records/2b4b3bb7-cadc-41a0-b5ae-796a84a20b52. Een
  `INNAME_PUNT`-rij toont `ContactOrganisations` (naam, e-mail, telefoon van een contactpersoon) met één
  klik; op 17-10-2026 was dat veld bij 0 van de 26 marktrijen gevuld, maar dat hangt af van wat de beheerder
  invult. De rij-id blijft alleen in de code (de controle op `feature.id`); het GIPOD-id staat in
  `externalId`. Voor bezoekers linkt een markt naar de marktpagina van de stad (`infoUrl`), ook in de .ics.
  `allowedHosts` van de bron is `www.antwerpen.be` en `metadata.vlaanderen.be`: een ruwe rij komt niet meer
  door de validatie. Een bronbestand van vóór deze regel zet `build:sources` om (`zonderRuweGipodBron` in
  `lib/source-feed.mjs`); de verversing schrijft het opnieuw.
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
    pagina's over de districtsraad, subsidies en reglementen zijn geen projecten. Plaatsen en zones houden
    hun huisnummer (regel van de eigenaar van 26 oktober 2026: altijd het exacte adres, ook "Proefmeir 24 2000
    Antwerpen" en reeksen als "135-137"), maar verliezen telefoonnummers, e-mailadressen, een zin om te bellen of
    te mailen en een busnummer ("34 bus 2": één appartement) (`zonderContact`). De id van een fase komt nog uit de
    zone zonder huisnummer (`zonderHuisnummers`), zodat de historiek geen nieuwe fase ziet. Er komt geen vrije
    tekst van de pagina in een item, buiten datum, uur, plaats, fase en zone.

## Speelstraten via GIPOD

De operationele agenda gebruikt GIPOD als tweede officiële bron naast eBesluit. Een GIPOD-record telt alleen als speelstraat wanneer:

- `Type = Evenement`;
- `PublicDomainOccupancyTypes` expliciet `Speelstraat` bevat;
- status `Concreet gepland` of `Lopende` is;
- het GIPOD-punt exact binnen District Antwerpen valt;
- de beschrijving een concrete locatie bevat met postcode 2000, 2018, 2020, 2030, 2050 of 2060 en een straatnaam;
- de totale periode maximaal 14 dagen duurt.

Contactorganisaties, aanvragers en andere bronvelden worden niet overgenomen. Een langer of niet concreet record wordt niet gepubliceerd. Deze GIPOD-laag geeft operationele straat + periode; eBesluit blijft de juridische bron voor de volledige goedkeuringslijst en eventuele weigeringen.

Stand 17 oktober 2026: GIPOD heeft 44 speelstraten in Vlaanderen, maar geen enkele van stad Antwerpen of in het district; deze regel levert dus niets. De stad zet haar speelstraten wel in een publieke kaartlaag `Feniks_speelstraat` (ArcGIS Online van Stad Antwerpen: per speelstraat een dossiernummer, begin- en einddatum, status en het vlak, geen namen; 8 speelstraten van 31 oktober 2026 tot 1 januari 2027, waarvan 2 in het district). Die laag staat niet op het open-dataportaal en vermeldt geen licentie: ze wordt pas ingelezen als de eigenaar dat beslist (zie de brongrens Speelstraten in `docs/COVERAGE_MATRIX.md`, met het bouwplan). Een evenementendossier in A-Sign met het woord "speelstraat" wordt al een agendapunt via `district-asign-evenementen`.

## AWV-werfdata (`awv-werf-supplement`, geen agendabron)

Een aanvulling op de GIPOD-werkenlaag, geen bron van agendapunten (`lib/awv-werf.mjs`,
`scripts/fetch-sources-awv-werf.mjs`, `site/works-awv-supplement.js`). De bron staat in `lib/source-feed.mjs`
met `aanvulling: true`: ze heeft haar eigen itemvorm, `build:sources` slaat het bestand over (het komt nooit in
`agenda-feed.js`) en ze krijgt wel haar eigen regel in `refresh-status.json`, met de gewone telling "leeg".

- Vraag: `awv:Werf_Innames` op https://opendata.apps.mow.vlaanderen.be/opendata-geoserver/awv/wfs, in het kader
  van het district (Lambert 72), totdatum vanaf vandaag, status `InUitvoering`, `ConcreetGepland` of
  `ConcreetVoorUitvoering`, met een vaste lijst velden (nooit `Omschrijving`, `URL` of `Buffer_publicatie`).
  De server rekent terug in EPSG:3857 (in WGS84 rondt hij af op 3 decimalen); de fetcher zet om met de exacte
  formule (minder dan 1 cm verschil met pyproj).
- Daarna `awv:Werf_Lokale_omleidingen` op `Inname_ID`, in blokken van hoogstens 100 (200 gaf HTTP 414), met
  hoogstens 2 vragen tegelijk; alleen voor wie een omleiding geldt, niet de lijn.
- Alleen innames met een GIPOD-id waarvan de lijn de exacte districtsgrens raakt. Een inname zonder einddatum
  valt weg. Eén item per GIPOD-id, met `date` (vroegste van) en `endDate` (laatste tot).
- Tekst alleen via een woordenlijst; de fase alleen als "Fase 2" of een maandnaam; de soort werk alleen uit de
  vaste lijst van 23 AWV-categorieën (`AWV_SOORTEN`). De afdeling is Antwerpen, Lantis, TO (tunnelorganisatie) of
  anders "AWV".
- Faalt gesloten: een fout, een afgekapt antwoord (`numberMatched` groter dan wat er kwam, of 2.000 innames),
  ongeldige JSON of een ongeldig bestand, en 0 innames terwijl de vorige ronde er meer dan 20 had
  (`suspicious_drop`; `AGENDA_ALLOW_DROP=awv-werf-supplement` laat een bewuste daling toe). Het vorige bestand
  blijft dan staan. De site toont een bestand ouder dan 3 dagen niet meer.
- Proefverversing van 17 oktober 2026: 174 innames in het kader, 118 bewaard, 118 aanvullingen van 19 werven,
  28 lokale omleidingen, 89 KB, 19 seconden.

## Evenementen uit eBesluit (`district-ebesluit-evenementen`)

Collegebesluiten noemen een evenement bij naam, met dag, uren, plaats, opbouw en afbouw. De fetcher
`scripts/fetch-sources-ebesluit-evenementen.mjs` (code in `lib/ebesluit-evenementen.mjs`) draait als
laatste in `npm run refresh:fetch`, gratis en zonder AI:

- **Zoeken:** eigen zoektermen "Evenementen", "muziekactiviteit", "Districtsfonds", "Intrede", "Halloween"
  en "feestelijkheden" (de raadskalender van `district-ebesluit` verandert niet), op zittingsdatum van 60
  dagen terug tot 120 dagen vooruit, met `searchKeyword()` uit `lib/ebesluit-discovery.mjs`. Hoogstens
  1 verzoek per seconde, met de User-Agent van `lib/fetch-util.mjs` en een `Referer`.
- **Welke besluiten:** "Evenementen - <naam>. Organisatie - Goedkeuring" (college of districtscollege),
  "Toelating muziekactiviteit - <organisator>, voor <evenement>, <adres>" en "Districtsfonds: beleef je
  buurt!" van district Antwerpen, ook als "Bekrachtiging". De rest valt weg op de titel.
- **Aanpassingen en intrekkingen:** een "Aanpassing data", rechtzetting of intrekking noemt het oudere
  besluit (`vervangt`: "met kenmerk <code>" of "het besluit van <dag> (jaarnummer N)" in Artikel 1). Een
  intrekking of een nieuwe datum maakt het oude geen agendapunt meer, ook als de nieuwe dagen niet te lezen
  zijn (`wijziging: "data"`). Een rechtzetting van iets anders (bv. het geluidsniveau) laat de oude dagen
  staan. Dezelfde regel geldt voor een jonger besluit van dezelfde soort met dezelfde naam en plaats.
- **Lezen:** alleen nieuwe ids (hoogstens 100 per verversing en 150 s; de rest volgt de volgende ochtend),
  met vaste zinpatronen: Artikel 1 ("keurt de organisatie door … van het evenement … op … in … goed"),
  "vindt plaats op …", "zal doorgaan van … tot en met …", "van … uur tot … uur", "De opbouw start op … en
  de afbouw eindigt op …" en de vaste tabel van het Districtsfonds. Niet gepubliceerd: alleen naam en
  zittingsdatum uit de titel.
- **Uitvoer:** `site/sources/evenement-besluiten.json` met alle gelezen besluiten (ook buiten het
  district): de cache per id en de invoer voor de koppelstap "besluit" in de parcoursherkenning. En
  `site/sources/district-ebesluit-evenementen.json` met agendapunten voor goedgekeurde besluiten met een
  plaats in het district (postcode 2000, 2018, 2020, 2030, 2050 of 2060, een straat van het district of
  een gebied zoals Linkeroever). Een muziekactiviteit alleen met een organisator met rechtsvorm of een
  publieke instelling (stad, district, provincie, autonoom gemeentebedrijf, FOMU): een feest van een
  privépersoon hoort niet in de agenda.
- **Privacy:** het blok "Samenstelling" wordt weggeknipt vóór er iets gelezen wordt; een organisator of
  aanvrager alleen met rechtsvorm (vzw, bv, nv, …) of als publieke instelling; nooit een
  ondernemingsnummer, IBAN of het adres van de aanvrager (zijn zetel, zijn woonplaats in de betaaltabel).
  De plaats van het evenement staat er met haar huisnummer (regel van de eigenaar van 26 oktober 2026, leesversie
  3), nooit met een busnummer; de naam nooit met een adres: een muziektitel zonder postcode ("Feest, Proefstraat
  12. District Antwerpen") geeft naam "Feest" en plaats "Proefstraat 12, District Antwerpen". Uit de tabel van
  het Districtsfonds komen alleen straten met het huisnummer erachter, postcodes en gebieden, nooit een ander
  woord (die cel noemt soms ontwerpers of bewoners bij naam), in de volgorde van de cel (de hoofdplaatsen eerst).
  Een besluit dat met leesversie 2 gelezen was (de plaats zonder nummer), wordt opnieuw gelezen; tot dat lukt,
  blijft het oude besluit met zijn agendapunt staan, en het bestand houdt leesversie 2 tot alles opnieuw gelezen
  is. Elk gelezen besluit draagt zijn eigen `leesversie`: een besluit dat al opnieuw gelezen is, wordt niet nog
  eens gelezen, ook als één pagina blijvend faalt (dan alleen die ene). `validate:data` controleert het bestand.
- **Eén ongeldig besluit legt de bron niet stil:** een besluit dat de vorm- of privacycontrole niet haalt,
  wordt opgekuist (zonder naam, organisator en plaats blijft het in de cache, maar wordt het geen
  agendapunt) of valt weg; de rest wordt gewoon geschreven. Een "@" in een naam wordt "at".
- **Fout bij het zoeken:** beide bestanden blijven zoals ze waren, `fetchStatus: "error"`. Een kapotte
  detailpagina houdt de rest niet tegen en komt de volgende keer opnieuw aan de beurt.
- Gemeten op 10-10-2026: 60 besluiten, 36 gelezen in 42 tot 45 s, 8 komende agendapunten (onder meer de
  Antwerp Marathon op 18 oktober, met opbouw vanaf 12 en afbouw tot 21 oktober).
- **Eigen fetcher:** deze bron heeft een eigen script en een eigen budget (4 min), in plaats van
  `scripts/fetch-sources-ebesluit.mjs` uit te breiden. Zo blijven de raadskalender (`district-ebesluit`) en
  haar zoektermen ongewijzigd, en houdt een fout of traagheid hier de raadskalender niet tegen.
- **Ontdubbelen met A-Sign:** een besluit dat `district-asign-evenementen` aan een dossier koppelt (zie
  "Koppelen met een besluit" onder), wordt één agendapunt met beide bronnen (`sameAs`), over de ruimste
  periode van de twee. Een besluit zonder overeenkomend dossier blijft een eigen agendapunt. De koppelstap
  "besluit" in de parcoursherkenning zelf (P3b) is er nog niet.

## Evenementen op straat uit A-Sign (`district-asign-evenementen`)

Op straat lopen veel meer evenementen dan er in de kalenders staan: de evenementendossiers van de stad
(A-Sign, laag 22 en 23). Deze bron maakt er agendapunten van, gratis en zonder AI
(`lib/asign-evenementen-agenda.mjs`):

- **Afgeleid, geen eigen verzoeken:** de bron draait in `npm run refresh:herkenning`, na de
  parcoursherkenning (`lib/parcours-herkenning-refresh.mjs`), met de dossiers die die stap al ophaalt en
  verrijkt (vorm, straten, gebied). Ze staat in `AFGELEIDE_BRONNEN` in `lib/source-registry.mjs`, niet bij
  de fetchers.
- **Bronstatus:** die stap zet de regel van de bron in `refresh-status.json` (`lib/afgeleide-bronstatus.mjs`),
  en `scripts/refresh-fetch.mjs` neemt die regel 's anderendaags over tot de stap ze bijwerkt. Zo zien
  `sources:health`, de job source-health en de site de bron zoals elke andere: een tijdelijke fout (een 503
  van A-Sign of de straatas) is "stale", een waarschuwing; een blijvende fout of een krimp is een fout, met
  de errorCode erbij. Zonder regel (vóór de eerste ronde met deze stap) leest `sources:health` het bestand
  zelf ("nog niet afgeleid", "verouderd" na 48 uur: een melding).
- **Het vorige bestand blijft byte voor byte staan** (en de regel zegt "error") als de straatas niet
  antwoordt (zonder straten zouden de titels "in district Antwerpen" zeggen en zouden dossiers ten onrechte
  samenvallen), als de herkenning faalt (A-Sign plat of gekrompen), bij elke andere fout, en bij een
  plotse krimp (`suspiciousDrop`: meer dan de helft minder komende agendapunten, of nul). Een krimp gaat
  wel door als het vorige bestand al meer dan 3 dagen oud is (dan is ze echt) of met `AGENDA_ALLOW_DROP`.
  `sources:health` vergelijkt deze bron daarom niet nog eens met HEAD (`shrinkGuard: false`).
- **Welke dossiers:** binnen de districtsgrens (`lib/district-antwerpen-grens.geojson`), niet geweigerd of
  afgelast, met een evenementdag van vandaag tot en met 60 dagen vooruit. Een dossier dat het district
  alleen aan de rand raakt (minder dan 20 % van de route binnen de grens, zoals een loop in Ekeren die even
  over de grens gaat), hoort bij een ander district en staat niet in de districtslijst; een handfiche
  beslist zelf (`binnenDistrict`, met de hand nagekeken). Een aanvraag die nog niet goedgekeurd is, telt
  mee; de tekst zegt dat dan, met de dag van de laatste wijziging in A-Sign ("laatst gewijzigd op …:
  aanvraag nog niet goedgekeurd"). Niet de dag van de verversing: dan zou elk item elke ochtend veranderen.
- **Eén agendapunt per evenementdag.** Opbouw en afbraak zijn geen eigen agendapunten: ze staan in het
  veld `fasen` en in één zin ("Opbouw vanaf …, afbraak tot …"). De naam van een fase komt uit faseNaam
  van A-Sign, een vrij in te vullen veld: alleen een vaste vorm ("Evenement", "Opbouw", "Afbraak",
  "Opname periode 2"), "Opname", een district of een straat van het item (`veiligeFase` in
  `site/witte-lijst.js`; de controle van het bronbestand weigert elke andere naam). Een dossier met meer dan 7 evenementdagen
  (een installatie van weken) krijgt één agendapunt per doorlopende reeks. De dagen van een handfiche gaan
  voor op die uit A-Sign. Een dossier zonder fase "Evenement" (alleen opbouw, of filmopnames met
  "Opname periode …") of met een evenementfase van meer dan 62 dagen (een constructie of plaatshouder
  van een jaar) is geen evenement en krijgt geen agendapunt.
- **Titel**, in deze volgorde: de naam uit de handfiche; de automatische naam (bij "zeker" de naam, bij
  "waarschijnlijk" "Vermoedelijk <naam>"); de naam uit een gekoppeld besluit van eBesluit (zie hierboven);
  de soort ("Studentenactiviteit in de Kerkstraat"); anders wat en waar, zonder belofte: "Evenement in de
  Kerkstraat: lus van 3,3 km, naam onbekend" (de vorm uit A-Sign: een lus of route met haar getekende
  lengte als het dossier één lijn heeft of lijnen die een keten vormen zonder dat een ervan zelf een lus
  is, anders een parcours door N straten, of een verkeersvrije zone). Losse lijnen, of lussen vanaf één
  punt (twee afstanden van een loop), zijn geen route van hun som; ook de kaart zegt dan "N
  parcourslijnen, samen ongeveer X km" (`eenRoute` in `lib/parcours-herkenning.mjs`). De tekst zegt
  waarom er geen naam is (bij een handfiche wat er nagekeken is) en dat een besluit meestal 2 tot 6 weken
  vooraf komt; een naam wordt nooit verzonnen of op een gok gekoppeld. Tot 12 oktober 2026 heette dat "—
  naam volgt": 12 van de 68 punten, waarvan er 3 wel een bron hadden (een besluit dat na de
  ochtendverversing verscheen, "Praalwagens" in de innamebeschrijving, en een naam die alleen in besluiten
  over een bestek en standplaatsen staat; die laatste kreeg een handfiche).
  Een soort die de herkenning alleen vermoedt (uit de plek, de periode en vroegere dossiers) staat er als
  "Vermoedelijk een studentenactiviteit in de Kerkstraat", met de zin "Soort vermoed via …; niet
  bevestigd." Alleen het trefwoord in het dossier zelf (speelstraat) heet "De soort staat in het dossier".
  Een tunnel is nooit "de straat" van een evenement, en de straat in de titel ligt op de route (begint een
  parcours aan een kruispunt, dan niet de dwarsstraat). Uren in dezelfde volgorde: de handfiche, dan het
  besluit (alleen op zijn dagen), dan de automatische fiche; een beginuur alleen bij een eenduidige reeks.
  Geeft de handfiche geen reeks, dan het beginuur uit het besluit als de fiche dat uur zelf noemt (de
  Marathon: "start om 9 uur" en 9 uur in het besluit).
- **Koppelen met een besluit** (eBesluit, P3a): een gemeenschappelijke evenementdag en de straat van het
  besluit. Een besluit over één vaste plek (Districtsfonds, muziekactiviteit) hoort bij hoogstens één
  dossier, en alleen als die straat de eigen plek van het dossier is (het begin, het einde of een inname):
  een stoet die de straat van een buurtfeest kruist, krijgt die naam niet. Een evenementbesluit (College)
  hoort bij de dossiers met hun eigen plek in die straat (startzone en parcours worden één agendapunt),
  anders bij het enige dossier waarvan de route erdoor loopt. Zijn er meer kandidaten, dan alleen het ene
  dossier dat zelf al een naam draagt die op die van het besluit lijkt (de Marathon: het parcours met de
  handfiche "TREK Antwerp Marathon", niet de zone in het Eilandje die ook langs de Rijnkaai loopt); anders
  geen naam. Zonder plaats: dezelfde opbouw- en afbouwdag bij precies één dossier. De plaats uit het besluit
  komt vooraan in de plaats van het agendapunt.
- **Twee dossiers, één evenement:** dossiers op dezelfde dag met dezelfde titel (alleen als die een eigen
  naam of een straat noemt), hetzelfde besluit of hetzelfde punt uit de kalender worden één agendapunt; de
  beste titel wint (hand, zeker, besluit, vermoeden, soort, vermoede soort, zonder naam) en de tekst noemt
  het andere dossier. Komen zo dagen samen (de dagen van een festival uit een besluit), dan beslaat het
  agendapunt de ruimste periode.
- **Straten:** `stratenVanParcours()` uit `site/parcours-straten.js` op de parcoursvormen en apart op de
  verkeersvrije zones, plus de straat waar het begint. Ze staan in het veld `straten` (hoogstens 60) en
  kort in de plaats ("Meir, Groenplaats, Schoenmarkt en 35 andere straten").
- **In de districtslijst** alleen een dossier met een naam, met een soort én een straat (of een wijk), of
  met een parcours of een verkeersvrije zone over minstens 2 straten. Een soort zonder plek
  ("Studentenactiviteit in district Antwerpen") zegt niets over een straat. De plekpagina blijft alle
  dossiers tonen (live uit A-Sign).
  Op de site valt een dossier zonder herkenbare soort onder "Buurt & straat" (`site/event-types.js`).
- **Speelstraten:** het trefwoord "speelstraat" in het dossier zelf geeft "Speelstraat in de …". Tot en met
  10 oktober 2026 staat er geen enkele speelstraat in A-Sign.
- **Ontdubbelen** met de districtskalender en het districtsnieuws: zelfde dag, en een straat van het
  dossier in de plaats of de titel van dat agendapunt, of een punt (uit `site/geo/locaties.json`) hoogstens
  250 m van de route of een inname, of dezelfde eigen naam. Het agendapunt krijgt dan `sameAs`, en
  `lib/merge-events.mjs` maakt er één item met twee bronnen van (bv. het Linkeroever Criterium). Twee eigen
  namen die niet op elkaar lijken, of twee soorten die botsen (een studentenactiviteit naast een
  wielerwedstrijd), worden nooit samengevoegd. Twee dossiers met dezelfde titel op dezelfde dag (een
  parcours en een zone van hetzelfde evenement) worden één agendapunt.
- **Geen koppeling met zichzelf:** de kaartjes op de kaart koppelen nooit aan een agendapunt dat alleen uit
  deze bron komt (`GEEN_KOPPELBRON` in `lib/kaart-uitleg-refresh.mjs`, `alleenUitDossiers()` in
  `site/place-core.js`): dat is geen tweede bron, en het kan van een buurdossier zijn.
- Na de nakijkronde gemeten op 11 oktober 2026 (Brussel), met dezelfde opgenomen brondata voor de vorige
  en de nieuwe code: 315 dossiers in het district, 2 aan de rand (de EkeRun en een dossier in Borgerhout),
  64 in de lijst (6 met naam, 46 met soort, 12 "naam volgt"), 66 agendapunten; de lijst gaat van 754 naar
  815 items (+61, was +66). Weg: 7 agendapunten "Studentenactiviteit in district Antwerpen" en de EkeRun als
  districtsitem. De Marathon is één item (A-Sign en eBesluit) om 9 uur, met de Rijnkaai vooraan. Valt de
  straatas uit (503), dan blijft het bestand byte voor byte staan en zegt de regel "stale" (de vorige code
  schreef 36 in plaats van 72 agendapunten, met "ok"). De feed groeit met 8,1 kB gzip in plaats van 13,7 kB.
- Gemeten op 10 oktober 2026 (proefverversing in een wegwerpkopie, vóór de nakijkronde): 323 dossiers in het district, 38
  zonder echte evenementfase, 212 niet in de lijst (klein en zonder naam of soort), 73 in de lijst (9 met
  naam, 52 met soort, 12 "naam volgt", 33 nog niet goedgekeurd), 74 agendapunten. 7 ervan worden één item
  met een punt uit een andere bron: de districtskalender of het districtsnieuws (het Linkeroever
  Criterium, Halloween bij CO Nova, FURIE!, Noorderlicht), eBesluit (de Heropening Anselmostraat en de
  Marathon) of, via dezelfde pagina, het nieuws van een ander district (de EkeRun). De lijst gaat van 755 naar 822
  items. De stap duurt een paar seconden bovenop de herkenning.
- **Privacy:** de omschrijving van een inname gaat nooit letterlijk mee (alleen het trefwoord
  "speelstraat"); de beheerder en de aanvrager worden niet eens opgehaald; de plaats zijn straatnamen van de
  straatas (A-Sign geeft een evenementendossier geen adres; `validate:data` weigert een nummer in die straten). Een
  huisnummer in de naam, de soort, de uren of de reden van een fiche blijft staan (regel van de eigenaar van 26
  oktober 2026: bij een evenement altijd het exacte adres); een organisator alleen met een rechtsvorm of als
  publieke instelling, en nooit met een adres; alleen postcodes van het district.

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
  Hergebruik v1.0)", met een link naar de officiële datasetfiche van GIPOD op metadata.vlaanderen.be (niet
  meer naar de OGC API). De bronlink van een marktdag op de eventpagina en in de agenda is dezelfde fiche,
  met de tekst "Bron: GIPOD (Digitaal Vlaanderen)".
- Op de site staat bij elke gratis stadsbron haar eigen bronvermelding; op een eventpagina die van de bron
  met voorrang.
- AWV-werfdata (aanvulling op een werk): "Bron: Agentschap Wegen en Verkeer (AWV), open data Werf, bijgewerkt op …"
  met de datum van de jongste wijziging in de data en een link naar de metadatafiche, zoals het gebruiksrecht van
  AWV vraagt; de tekst "Volgens AWV-werfdata" laat geen goedkeuring door AWV vermoeden.
- Stad: "Bron: UiTinVlaanderen.be" met een link naar https://www.uitinvlaanderen.be, en per UiT-item
  "Bron: uitinvlaanderen.be" met een link naar de eigen UiT-pagina.
- Eén UiT-sleutel geldt voor één website: UiT-items verschijnen alleen op
  https://mijn-publieke-agenda-voor-district.onrender.com. Op een andere host staat er een link naar die site.
  UiT-items krijgen geen eigen eventpagina en staan niet in de sitemap.

## UiT: uit zonder sleutel

Stand 17 oktober 2026: wacht op de beslissing van de eigenaar (sleutel kost geld). De Search API antwoordt
zonder sleutel 401, ook op de testomgeving. Testsleutels zijn gratis maar werken alleen op de testomgeving.
Voor de echte gegevens rekent publiq 125 euro per jaar (Basic plan, één website) of een prijs op maat; leden
van het UiTnetwerk krijgen misschien een gratis integratie. Er verandert niets in de code: de eigenaar zet
`UITDATABANK_CLIENT_ID` als hij beslist.

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
  startdatum op de pagina zelf staan. De startdatum telt in dezelfde vormen als in de paginapoort van de
  Mac (`src/publieke-agenda/datums.ts` in de Gateway): "17 oktober", "17 okt.", "17/10", "2026-10-17",
  "17.10.2026", en als begin van een reeks "3 tot 25 oktober" of "3 t.e.m. vr 25/10". Tot 12 oktober 2026
  las deze kant de afgekorte maand, de datum met punten en het begin van een reeks niet, en viel een signaal
  dat de Mac terecht doorliet hier alsnog weg (`date_not_on_page`).
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
