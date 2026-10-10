# Ubuntu 26.04: de proefjob en wat te doen als ze faalt

GitHub verhuist `ubuntu-latest` van Ubuntu 24.04 naar 26.04, geleidelijk tussen
**19 oktober en 19 november 2026**. Op 26.04 zijn drie hulpmiddelen waar
`refresh.yml` op leunt een andere versie:

| Hulpmiddel | 24.04 | 26.04 | Waar in refresh.yml |
| --- | --- | --- | --- |
| `date` | GNU coreutils | Rust-coreutils (uutils); GNU blijft als `gnudate` | `date -u -d "$generated" +%s`, `TZ=Europe/Brussels date` |
| `jq` | 1.7.1 | 1.8.1 | datalijst, binding, bronstatus (`@tsv`) |
| `bash` | 5.2 | 5.3 | de databaantoets (`[[ =~ ]]`, `read`, `BASH_REMATCH`) |

## De proefjob

De job `ubuntu-26.04-proef` in `.github/workflows/ci.yml` draait op
`runs-on: ubuntu-26.04` met `continue-on-error: true`. Rood daar maakt de run
niet rood, en de Gateway kijkt alleen naar `check` en `data-only`.

Ze doet drie dingen (`scripts/refresh-droog.mjs`):

1. **Gereedschap en vaste uitkomsten** (offline). Versies van de image en
   vaste antwoorden: `date -u -d` op de vormen die de bronnen schrijven
   (`2026-10-10T03:22:17.338Z`, zonder milliseconden, met `+02:00`), een fout
   op geen datum, `TZ=Europe/Brussels` rond middernacht in zomer- en wintertijd,
   de jq-programma's, `sort -k1,1nr -k2,2nr | tail -n +6` van de opruimstap,
   `base64 -w0`, `sha256sum -c -` (zo haalt de job `gitleaks` gitleaks op), en
   de databaantoets letterlijk uit `refresh.yml` op goede en foute wijzigingen.
2. **`npm run check`** en de controle dat de build niets wijzigt.
3. **Een droge verversing.** De run-stappen van `refresh.yml` zelf, in dezelfde
   volgorde. Lezen van het netwerk mag (de bronnen, de live agenda). Schrijven
   niet: een stub vangt `git push`, `git ls-remote` en `gh` op (ook na `-C`,
   `-c` of `--git-dir`), een push die er toch langs gaat wijst naar een schema
   dat niet bestaat, het token is nep, de job heeft alleen leesrechten, en de
   job `alarm` van `refresh.yml` draait nooit. Bij een PR haalt ze de bronnen
   niet opnieuw op en verzet ze alleen `generatedAt`; na een merge op main
   haalt ze wel alles op.

Een regel met `BREUK` in het logboek wijst naar het verschil. Een stap die faalt
door de toestand van een bron of de live site (bronstatus, versheid) is geen
breuk.

### Controle, oordeel en alarm

- **`ubuntu-24.04-controle`** draait dezelfde stappen op 24.04, maar alleen als
  de proef een breuk vond. Faalt iets op beide, dan ligt het aan de live data
  of de code, niet aan 26.04.
- **`ubuntu-26.04-oordeel`** vergelijkt beide en is rood als iets alleen op
  26.04 breekt (of als de proef geen uitkomst gaf). Dat is het teken om
  hieronder verder te lezen; de proefjob zelf kan rood zijn door iets dat ook
  op 24.04 faalt.
- **`ubuntu-26.04-alarm`** opent na een push naar main één issue "Ubuntu 26.04:
  de proef breekt" (of reageert op het open issue), net als de job `alarm` in
  `refresh.yml`. Niet bij een PR. Sluiten doe je zelf.

## Faalt het oordeel

1. **Meteen, als voorzorg:** zet `ubuntu-24.04` vast in plaats van
   `ubuntu-latest`, in `.github/workflows/refresh.yml` (alle jobs) en in
   `.github/workflows/ci.yml` (alle jobs behalve `ubuntu-26.04-proef` en
   `ubuntu-24.04-controle`). Dan verandert er niets aan de dagelijkse
   verversing terwijl je herstelt. De toetsen in `check` aanvaarden dat: elk
   GitHub-gehost label mag (`ubuntu-*`, `macos-*`, `windows-*`), alleen
   self-hosted, een eigen label of een runnergroep niet. Laat de proefjob op
   `ubuntu-26.04` staan: die toont wanneer het weer klopt.
2. **Herstel** de stap die breekt. Voor `date`: `gnudate` bestaat alleen op 26.04,
   dus bv. `d=$(command -v gnudate || command -v date)` en dan `"$d" -u -d ...`.
3. **Haal het vastzetten weer weg** zodra het oordeel groen is. Een vast label
   stelt het probleem alleen uit.

Gebruik nooit een self-hosted runner voor deze repo: ze is publiek, en elke fork
kan een PR openen.

## Lokaal

```sh
node scripts/refresh-droog.mjs gereedschap      # offline, enkele seconden
DROOG_ZONDER_OPHALEN=1 node scripts/refresh-droog.mjs verversing
```

- `verversing` wijzigt de werkboom (zoals een echte verversing); draai ze in een
  aparte worktree.
- `verversing` draait ook de stap `npm run check` van `refresh.yml`, en dus de
  hele suite. Reken op enkele minuten.
- Op macOS geeft `gereedschap` BREUK: `date`, `sort` en `base64` zijn daar
  BSD-versies en `sha256sum` ontbreekt. Dat zegt niets over Ubuntu. Draai het op
  Linux, bv. in een Ubuntu-container met `jq` en Node; het script waarschuwt
  zelf als het niet op Linux draait.
