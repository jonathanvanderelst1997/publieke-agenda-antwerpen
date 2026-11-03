# Historische backfill — broncontract

Stand: 1 oktober 2026; een backfill van parkeerverboden uitgesloten op 3 november 2026.

De permanente history onder `site/history/archive/` bewaart wat de agenda vanaf haar bewezen baseline **zelf observeert**. Backfill van oudere brondata is iets anders: een bron kan zeggen dat een maatregel in 2020 geldig was, maar wij mogen daaruit niet verzinnen dat Project Brain die maatregel in 2020 zelf zag.

Daarom blijven twee tijdslijnen gescheiden:

1. **observatiehistoriek** — baseline + operationele added/removed/changed-events die Project Brain werkelijk na de baseline zag;
2. **bronhistoriek** — historische geldigheidsrecords die een officiële bron vandaag aantoonbaar teruglevert.

## Geen backfill van parkeerverboden

Besluit van de eigenaar van 3 november 2026: geen import van parkeerverboden van vóór de start (#222, dicht). De parkeerverboden die de site zelf zag, staan wel in de historiek en in het verleden van de agenda (`docs/LIVE_HISTORY.md`, "Parkeerverboden (3 november 2026)"). Er komt dus geen backfill van de A-Sign-parkeerverboden (laag 20 en 21), welke dekking die bron ook bewijst:

- de materializer `scripts/backfill-asign-parking-history.mjs` (alleen een dry-run, nooit gedraaid in de dagelijkse refresh) is weg, met zijn toets;
- de databaan (`lib/data-lane-paths.json`) laat `site/history/backfill/asign-parking/` niet meer toe;
- `lib/history-backfill.mjs` weigert elke parkeerbron (een bron-id met "park" of "parkeer", of laag 20 of 21 van A-Sign als bron) en elk record waarvan de inhoud een parkeerverbod is: een manifest, index of shard met zo'n bron of record is ongeldig, en `sourceHistoryRecord` en `historyBackfillShardFile` gooien een fout;
- `tests/parkeerhistoriek.test.mjs` houdt dit vast.

## Contract per bron

Elke backfillbron krijgt `sourceId`, `completeness` (`full`, `partial` of `unknown`), bewezen dekking waar die bestaat, een officiële HTTPS-bron, bewijsnotitie, stabiele deduplicatiesleutel en na materialisatie een digest.

`unknown` mag geen historische periode claimen en mag niet worden geïmporteerd. `partial` betekent dat alleen de expliciet bewezen records/periode worden opgenomen; ontbreken bewijst niets over de rest van het verleden.

| Bron | Contract | Bewezen dekking | Sleutel | Opmerking |
|---|---|---|---|---|
| A-Sign laag 20 `parkeerverbod_lijn` | **uitgesloten** | n.v.t. | n.v.t. | geen import van vóór de start (besluit van 3 november 2026, #222); de laag zelf noemt wel een volledige historiek vanaf 2019-09-16 |
| A-Sign laag 21 | **uitgesloten** | n.v.t. | n.v.t. | idem |
| A-Sign IOD 22/23 | unknown | niet bewezen | `dossierNummer|faseId|innameId` | metadata-time-extent is N/A of niet betrouwbaar als actuele retentiegrens |
| A-Sign SGW 47/48 | unknown | niet bewezen | `reference_id|phase_id` | datumvelden bestaan, volledige retentie niet bewezen |
| GIPOD werken/hinder | partial/onderzoek | geen complete periode geclaimd | bron-feature-id | de publieke OGC-feed levert aantoonbaar ook oude records met status `Afgelopen`; dat bewijst individuele historische records, niet de volledigheid van een periode |
| eBesluit / districtszittingen | partial/onderzoek | openbaar materiaal minstens vanaf 2019 | officiële zitting/agendapunt-id | exacte vroegste complete periode nog vast te stellen |
| overige agenda-/mailbronnen | unknown | niet bewezen | bronafhankelijk | geen historische volledigheidsclaim in huidige integratie |

## Materializer

Er is geen materializer. De enige die er was, voor A-Sign laag 20 (`scripts/backfill-asign-parking-history.mjs`), is op 3 november 2026 weggehaald (zie hierboven). Een nieuwe materializer voor een andere bron volgt het contract hierboven en de regels hieronder.

## Fail-closed

- Geen `unknown`-bron wordt als backfill gepubliceerd.
- Geen backfill van parkeerverboden, uit geen enkele bron (de historiek houdt bij wat de site zelf ziet).
- Geen historische bronrecord wordt omgezet naar een verzonnen `added`/`removed`-observatie.
- Alleen dezelfde publieke velden als live mogen worden opgeslagen; privacyregels blijven gelden.
- Bestaande historische shards worden niet stil overschreven.
- “Volledige history” betekent volledige **bewezen** bronhistoriek waar de bron dat ondersteunt, plus de volledige eigen observatiehistoriek vanaf de baseline; niet-bewijsbare gaten blijven zichtbaar.
