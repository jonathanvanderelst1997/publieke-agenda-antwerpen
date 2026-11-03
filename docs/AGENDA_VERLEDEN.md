# Verleden van de agenda

Besluit van de eigenaar, 3 november 2026: "vanaf dat we begonnen zijn wel bijhouden in de geschiedenis: alles wat ooit
in agenda staat, publiek blijft staan, maar verdwijnt dan naar verleden."

## Wat het doet

- Elk agendapunt met een eigen pagina (`site/event/<id>/index.html`) dat de site ooit publiceerde, houdt die pagina op
  dezelfde URL. Een id gaat nooit naar een ander punt: de ids zijn per bron en per dag vast (`markt-ma7-2026-11-02`).
- Na zijn laatste dag staat het punt niet meer tussen het komende (dat deed de agenda al), maar op **/verleden/**
  (`site/verleden/index.html`, `site/agenda-verleden.js`): per dag, het nieuwste eerst, de markten van een dag samen
  op één regel, met een zoekveld en standaard alleen district Antwerpen (een vinkje toont ook de andere districten).
  De browser rekent "voorbij" met de dag van vandaag in Brussel: na middernacht schuift een punt vanzelf door.
- De agenda linkt bovenaan ("Verleden") en onderaan (sectie "Verleden") naar /verleden/.

## Hoe

`scripts/build-agenda.mjs` houdt per punt een record bij in `site/verleden/<JJJJ-MM>.json` (de maand van zijn laatste
dag; één record per regel) met een index `site/verleden/maanden.json` (aantal en digest per maand). De logica staat in
`lib/agenda-verleden.mjs`, de pagina in `lib/eventpagina.mjs`.

- Een publiek punt: het record toont wat de pagina nu toont; `sinds` is de eerste dag dat het in de agenda stond. De
  pagina van een komend punt is byte voor byte dezelfde als vroeger.
- Een punt dat niet meer publiek is, houdt zijn laatste record. Viel het weg vóór zijn laatste dag (de bron toont het
  niet meer, of de bron kon niet gelezen worden), dan krijgt het `weg` (de eerste dag zonder) en zegt de pagina "Staat
  sinds … niet meer in de agenda". Komt het terug, dan valt `weg` weer weg. Geen reden: die kennen we niet zeker, en
  een storing hoort een bezoeker niet te zien (besluit van 18-10-2026).
- Is de laatste dag voorbij, dan zegt de pagina "Voorbij" en gaat de knop naar /verleden/ in plaats van naar de agenda.
- Hetzelfde punt onder twee ids (een bron die haar rijen hernummert, of een samengevoegd punt dat een andere hoofdbron
  krijgt) staat één keer in het verleden: het oude record krijgt `opgegaanIn` en zijn pagina wijst naar het nieuwe.
  Twee evenementendossiers van de stad (A-Sign) zijn altijd twee punten.
- `build-agenda` wist geen enkele eventpagina meer, en de databaan mag het ook niet: `deletableUnder` in
  `lib/data-lane-paths.json` bevat alleen nog `site/straat/`; `site/verleden/(maanden|JJJJ-MM).json` staat in de lijst.
  Een maand die leeg raakt, blijft als bestand bestaan.
- Een punt zonder eigen pagina (UiT, `noEventPage`) komt niet in het verleden.

## Regels die blijven

- **Nooit een parkeerverbod** (besluit van 3 november 2026, `lib/parkeer-historiek.mjs`): een parkeerverbod is geen
  agendapunt, en een record dat er een is of op lijkt, wordt geweigerd. `validate:data`,
  `tests/geen-parkeerhistoriek.test.mjs` en `tests/agenda-verleden.test.mjs` houden dat vast.
- Privacy zoals de rest van de site: geen e-mail, telefoon, rekening, querystring of trackinglink (`privacyFindings`),
  nooit het woord verhuis (`noemtVerhuis`), geen link naar een ruw GIPOD-record. De plaats blijft zoals de agenda ze
  publiceerde, met het exacte huisnummer. Het verleden staat bewust niet onder `site/history/`: de historiek van de
  live lagen haalt huisnummers weg, een agendapunt houdt het zijne.

## Wat erin staat sinds de start

De eerste eventpagina's dateren van de release van 13 augustus 2026 (`VERLEDEN_SINDS`). `node scripts/herstel-verleden.mjs`
haalde op 3 november 2026 eenmalig elke pagina terug die de build sindsdien gewist had (314), uit de laatste versie
die de site publiceerde in de git-geschiedenis: geen reconstructie, alleen wat publiek stond. Soort, bron en district
komen uit de feed van diezelfde commit. Een bronlink die de regels van vandaag niet haalt (3 trackinglinks uit een
nieuwsbrief), viel weg; het punt bleef. Wat vóór 13 augustus 2026 voorbij was, had nooit een pagina en staat er niet in.

`validate:data` kijkt na: elk record geldig en privacyveilig, geen parkeerverbod, de index klopt met de maanden, elk
record heeft zijn pagina en elke pagina een record. `scripts/test-deep-links.mjs` telt de pagina's
(`eventPageCount` + `archivedEventPageCount` in het manifest) en de sitemap (met /verleden/).

## Grootte

Een record weegt ongeveer 0,9 kB, een pagina 3 à 4 kB. Met de markten (ongeveer 100 marktdagen per maand) groeit het
verleden met zo'n 1 MB data en 5 MB pagina's per jaar. De browser laadt alleen de index en de maanden die hij toont.
