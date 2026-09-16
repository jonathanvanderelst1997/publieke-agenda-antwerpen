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

Alleen `current` en `future` met bronstatus `verified` verschijnen in de publieke agenda. Verlopen punten blijven als rollback- en audithistoriek in de bestaande bron staan. Items met een bronconflict worden niet stil verwijderd en niet als actueel getoond.

## Herhalen

```bash
npm run check
```

De build gebruikt geen netwerk. Een inhoudelijke refresh begint altijd met een nieuwe controle van de officiële publieke bron, gevolgd door een expliciete update van `retrievedAt`, bronstatus en eventuele correcties.

## Rollback

De vastgelegde rollbackbasis is commit `36ea97332e1742d0ed1650a1226c2276733a34f3`. Als live validatie faalt, wordt de release-merge op `main` teruggedraaid naar die broninhoud zodat Render de vorige website opnieuw uitrolt.
