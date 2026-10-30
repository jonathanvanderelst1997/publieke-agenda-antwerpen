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
| GIPOD werken/hinder | partial/onderzoek | geen complete periode geclaimd | bron-feature-id | de publieke OGC-feed levert aantoonbaar ook oude records met status `Afgelopen`; dat bewijst individuele historische records, niet de volledigheid van een periode |
| eBesluit / districtszittingen | partial/onderzoek | openbaar materiaal minstens vanaf 2019 | officiële zitting/agendapunt-id | exacte vroegste complete periode nog vast te stellen |
| overige agenda-/mailbronnen | unknown | niet bewezen | bronafhankelijk | geen historische volledigheidsclaim in huidige integratie |

## Eerste materializer

De CLI vereist een expliciete scope. `node scripts/backfill-asign-parking-history.mjs --month=2020-05` controleert uitsluitend de gekozen maand, schrijft niets en rapporteert `partial`. `--all` vraagt een volledige dry-run; alleen `--all --write` kan de volledige jaarscherven en index schrijven. Oudere bronrecords worden alleen geteld. Hun aanwezigheid blokkeert de gekozen periode niet. Iedere geïmporteerde record moet binnen haar aangevraagde maandvenster en de vastgelegde dekking vallen.

De generator:
- leest de eigen bewezen baseline uit `site/history/archive/index.json` en neemt alleen parkeerverboden op die vóór die baseline eindigden;
- shardt op startjaar onder `site/history/backfill/asign-parking/YYYY.json`;
- bewaart alleen dezelfde publieke velden als de live parkeerverboden en gebruikt dezelfde officiële straatas voor straatresolutie;
- weigert records vóór 2019-09-16, onbekende historische statuswaarden, conflicterende duplicaten en wijzigingen aan een reeds geschreven shard;
- draait bewust nog niet in de dagelijkse refresh: eerst moet een dry-run aantonen dat alle historische statuswaarden correct geclassificeerd zijn.

## Fail-closed

- Geen `unknown`-bron wordt als backfill gepubliceerd.
- Geen historische bronrecord wordt omgezet naar een verzonnen `added`/`removed`-observatie.
- Alleen dezelfde publieke velden als live mogen worden opgeslagen; privacyregels blijven gelden.
- Bestaande historische shards worden niet stil overschreven.
- “Volledige history” betekent volledige **bewezen** bronhistoriek waar de bron dat ondersteunt, plus de volledige eigen observatiehistoriek vanaf de baseline; niet-bewijsbare gaten blijven zichtbaar.

### Integriteitscontrole van de bronbatches

De historische generator gebruikt `lib/asign-history-fetch.mjs`.
Hij leest maximaal 100 objecten per detailbatch en weigert een ontbrekende
ID-lijst, dubbele of ongeldige IDs, transferlimieten en ontbrekende of onverwachte
detailobjecten. De bronfilter blijft op de detailquery staan. Elke response is
begrensd in tijd en omvang.

De generator controleert het district opnieuw en gebruikt de bestaande publieke
adresprojectie, met een geverifieerd huisnummer waar die projectie het ondersteunt.
Een onopgeloste locatie of conflicterende bronidentiteit stopt de import.

Geslaagde fixturetoetsen bewijzen geen uitgevoerde gegevensronde. Historische
statuswaarden en daadwerkelijke brondekking worden gecontroleerd in de dry-run.
Er wordt geen dekking voor andere bronnen toegevoegd.

De bronproef van 28 oktober 2026 telde 199.697 oudere startdatums en meer dan 15.000 bronrecords in elk jaarvenster. De importer gebruikt daarom opeenvolgende maandvensters en vereist voor een volledige CLI-ronde expliciet `--all`. Een maandproef publiceert geen jaarschijf, index of volledige dekkingsclaim. De bestaande grenzen per aanvraag en per jaarschijf blijven gelden.
