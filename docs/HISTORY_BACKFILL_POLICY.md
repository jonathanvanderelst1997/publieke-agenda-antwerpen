# Historische backfill — broncontract

Stand: 1 oktober 2026.

De permanente history onder `site/history/archive/` bewaart wat de agenda vanaf haar bewezen baseline **zelf observeert**. Backfill van oudere brondata is iets anders: een bron kan zeggen dat een maatregel in 2020 geldig was, maar wij mogen daaruit niet verzinnen dat Project Brain die maatregel in 2020 zelf zag.

Daarom blijven twee tijdslijnen gescheiden:

1. **observatiehistoriek** — baseline + operationele added/removed/changed-events die Project Brain werkelijk na de baseline zag;
2. **bronhistoriek** — historische geldigheidsrecords die een officiële bron vandaag aantoonbaar teruglevert.

## Contract per bron

Elke backfillbron krijgt `sourceId`, `completeness` (`full`, `partial` of `unknown`), bewezen dekking waar die bestaat, een officiële HTTPS-bron, bewijsnotitie, stabiele deduplicatiesleutel en na materialisatie een digest.

`unknown` mag geen historische periode claimen en mag niet worden geïmporteerd. `partial` betekent dat alleen de expliciet bewezen records/periode worden opgenomen; ontbreken bewijst niets over de rest van het verleden.

| Bron | Contract | Bewezen dekking | Sleutel | Opmerking |
|---|---|---|---|---|
| A-Sign laag 20 `parkeerverbod_lijn` | **full** | vanaf 2019-09-16 | `Dossiernummer|Locatienummer` | officiële laagbeschrijving noemt expliciet de volledige historiek |
| A-Sign laag 21 | partial/onderzoek | metadata toont 2015-2019 | zelfde sleutel | geen expliciete volledigheidsclaim |
| A-Sign IOD 22/23 | unknown | niet bewezen | `dossierNummer|faseId|innameId` | metadata-time-extent is N/A of niet betrouwbaar als actuele retentiegrens |
| A-Sign SGW 47/48 | unknown | niet bewezen | `reference_id|phase_id` | datumvelden bestaan, volledige retentie niet bewezen |
| GIPOD werken/hinder | unknown | niet bewezen | bron-feature-id | datumvelden bestaan; volledige retentie van beëindigde records niet bewezen |
| eBesluit / districtszittingen | partial/onderzoek | openbaar materiaal minstens vanaf 2019 | officiële zitting/agendapunt-id | exacte vroegste complete periode nog vast te stellen |
| overige agenda-/mailbronnen | unknown | niet bewezen | bronafhankelijk | geen historische volledigheidsclaim in huidige integratie |

## Fail-closed

- Geen `unknown`-bron wordt als backfill gepubliceerd.
- Geen historische bronrecord wordt omgezet naar een verzonnen `added`/`removed`-observatie.
- Alleen dezelfde publieke velden als live mogen worden opgeslagen; privacyregels blijven gelden.
- Bestaande historische shards worden niet stil overschreven.
- “Volledige history” betekent volledige **bewezen** bronhistoriek waar de bron dat ondersteunt, plus de volledige eigen observatiehistoriek vanaf de baseline; niet-bewijsbare gaten blijven zichtbaar.
