# Transparante agenda-refresh

Deze lokale kandidaat scheidt drie zaken:

1. de bestaande bronitems in `site/agenda.js`;
2. de actuele broncontrole, correcties en reviewgrenzen in `site/agenda-refresh.js`;
3. het deterministisch gebouwde overzicht in `site/public-agenda-manifest.json`.

## Classificaties

- `expired`: de opgeslagen datum of officiële einddatum ligt vóór de auditdatum;
- `current`: een officiële bron bevestigt dat het punt op de auditdatum loopt;
- `future`: een officiële bron bevestigt een latere datum;
- `review_required`: bron, uur, locatie of actuele afronding is niet eenduidig bevestigd.

Alleen `current` en `future` met bronstatus `verified` verschijnen in de publieke kandidaat. Verlopen punten blijven als rollback- en audithistoriek in de bestaande bron staan. Items met een bronconflict worden niet stil verwijderd en niet als actueel getoond.

## Herhalen

```bash
npm run check
```

De build gebruikt geen netwerk. Een inhoudelijke refresh begint altijd met een nieuwe controle van de officiële publieke bron, gevolgd door een expliciete update van `retrievedAt`, bronstatus en eventuele correcties.

## Rollback

De vastgelegde bronbasis is commit `f9ce9badc00b2300d083996b9e93b5d5cb7c15f3`. Deze kandidaat verandert geen deployment of account; lokaal terugkeren naar die boom herstelt daarom de vorige websitebron volledig.
