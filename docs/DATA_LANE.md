# Databaan: dagelijkse dataverversing

De publieke agenda ververst elke ochtend alleen zijn **data**. Een verversing
die niets anders raakt dan data mag vanzelf live, zodra elke controle groen
is. Een **codewijziging** gaat nooit via deze baan: die vraagt altijd de
toegangscode van de eigenaar.

Dit document beschrijft de stroom, waarom GitHub Actions zelf niets opent of
merget, en welke stappen de eigenaar zet, in welke volgorde.

## De stroom

```
refresh.yml (05:17 Brussel)
  job refresh          leesrechten; draait de code van main:
                       npm run refresh, npm run check,
                       npm run validate:data -- --max-age-hours 26,
                       npm run -s check:data-lane < changes.txt
                       -> artefact data-patch (data.patch, changes.txt, refresh-status.json)
  job publish-branch   enige job met schrijfrechten; draait GEEN repocode:
                       patch toepassen, datalijst opnieuw toetsen in bash,
                       één commit van github-actions[bot],
                       duwen naar data/refresh-<JJJJMMDD>-<run_id>
                       -> artefact data-lane-binding
  job source-health    rood als een bron faalde; houdt publish-branch niet tegen
  job freshness        rood als de LIVE agenda ouder is dan 48 uur
        |
        v
Gateway-databaan (komt in een latere Gateway-PR)
  opent de PR met het token van de eigenaar
  -> 'Public Agenda Validate' draait op pull_request (check + data-only)
  toetst de binding en de workflowruns, merget pas daarna (squash)
        |
        v
Render rolt main uit
```

1. **refresh.yml** (`Agenda Data Refresh`) draait om 05:17 Brusselse tijd
   (verversen en versheid) en om 13:17 (alleen versheid). Met de hand kan het
   ook, zie verder.
2. De job **refresh** haalt de bronnen op en bouwt alles opnieuw, met alleen
   leesrechten en zonder bewaarde inloggegevens. Hij schrijft niets naar de
   repo. Hij levert een patch af.
3. De job **publish-branch** is het enige deel met schrijfrechten. Hij voert
   geen code uit de repo uit (geen npm, geen node). Hij leest de padlijst uit
   de basiscommit *voor* hij de patch toepast, toetst elk pad, en zet precies
   één commit op een nieuwe tak `data/refresh-<JJJJMMDD>-<run_id>`. De vijf
   nieuwste datatakken blijven staan; oudere worden verwijderd. Een verwijderde
   tak sluit zijn open PR; dat is de bedoeling, want een nieuwere run vervangt
   hem.
4. Het artefact **data-lane-binding** zegt welke run welke commit met welke
   bestanden maakte:
   `{repository, run_id, run_attempt, base_sha, head_sha, branch, files: [{path, status}], generated_at}`.
   `base_sha` is de commit van main waarop de run draaide, `generated_at` de
   `generatedAt` uit `site/sources/refresh-status.json`. Een hernoeming staat
   in `files` als `D` van het oude en `A` van het nieuwe pad.
5. De **Gateway-databaan** (latere Gateway-PR) opent de PR met het token van de
   eigenaar. Dan draait `Public Agenda Validate` gewoon op `pull_request`. De
   Gateway toetst de binding (run van `refresh.yml` op main, `head_sha` gelijk
   aan de kop van de PR, dezelfde bestanden, elk pad in de padlijst) en de
   groene runs, en merget pas daarna.
6. **Render** rolt main uit, zoals bij elke merge.

De job **data-only** in `ci.yml` is een spiegel voor de mergeknop van GitHub,
geen bewijs: een commit-e-mailadres kan iedereen met schrijfrechten zelf
zetten. Het bewijs is de binding, die de Gateway toetst.

## Waarom het GITHUB_TOKEN niet zelf opent, controleert of merget

- **Een PR openen** vraagt de repo-instelling "Allow GitHub Actions to create
  and approve pull requests" (`can_approve_pull_request_reviews`). Die blijft
  uit: anders kan een workflow zijn eigen wijziging voorstellen en goedkeuren.
- **CI laten draaien**: wat met het GITHUB_TOKEN gebeurt (een push, een PR),
  start zelf geen nieuwe workflowrun, behalve `workflow_dispatch` en
  `repository_dispatch`. Een PR die de bot zelf opent, krijgt dus nooit de
  `pull_request`-run met `check` en `data-only`. `ci.yml` krijgt bewust geen
  `workflow_dispatch`: de controles moeten uit de `pull_request`-run komen die
  de PR van de eigenaar start, en `data-only` leest daarvoor de PR-gegevens
  uit precies die gebeurtenis.
- **Mergen**: ruleset 2 laat main alleen bijwerken door de beheerdersrol, en
  dan alleen via een PR. `github-actions[bot]` heeft die rol niet. Ruleset 1
  heeft geen enkele uitzondering. Zo blijft main alleen veranderen langs de
  Gateway, en blijft elke commit op main voor de Gateway na te gaan.

## De padlijst is de enige bron

`lib/data-lane-paths.json` (komt uit de bronnen-PR `claude/agenda-bronnen`):

```json
{"schemaVersion": 1, "allowed": ["<POSIX-ERE>", "..."], "deletableUnder": ["site/event/"]}
```

Deze lijst wordt gelezen door:

- `npm run -s check:data-lane` in de job refresh;
- de bash-toets in de job publish-branch, uit de basiscommit, gelezen vóór de
  patch;
- de job `data-only` in `ci.yml`, met `git show <basis>:lib/data-lane-paths.json`,
  zodat een PR zijn eigen lijst nooit kan verruimen;
- de Gateway.

Regels van de bash-toets (dezelfde tekst staat in `refresh.yml` en `ci.yml`,
tussen `>>> databaantoets` en `<<< databaantoets`):

- elk pad moet volledig op een patroon passen; de toets zet er zelf `^(` en
  `)$` omheen;
- elk patroon moet geldig zijn, anders faalt de toets;
- `D` alleen onder een map uit `deletableUnder`;
- `git diff -M0` toont een exacte hernoeming nog steeds als `R100`: het oude
  pad telt als verwijderd en moet dus onder `deletableUnder` liggen, het
  nieuwe pad moet in de lijst staan;
- andere statussen (`T`, `C`, ...) en andere bestandsmodi dan een gewoon
  bestand (`100644`) worden geweigerd;
- een lege wijzigingslijst faalt.

De lijst veranderen is een codewijziging: dat gaat via een gewone PR en de
toegangscode van de eigenaar.

## Met de hand starten

```bash
gh workflow run refresh.yml -R jonathanvanderelst1997/publieke-agenda-antwerpen --ref main -f reason=handmatig
```

`reason` is een keuzelijst: `handmatig`, `brain` of `test`. Het is alleen een
label en verandert niets aan wat de run doet. Er is geen vrij tekstveld, want
alles in een run is publiek. Een run vanaf een andere tak dan main faalt.

## Een datatak wordt nooit bijgewerkt

Staat main verder dan de basis van een datatak, dan vraagt ruleset 1 (strikt)
dat de PR bijgewerkt wordt. Doe dat **niet** met "Update branch": die
merge-commit is niet van `github-actions[bot]`, en `data-only` wordt rood.
Start in plaats daarvan een nieuwe run van `refresh.yml`; die maakt een verse
tak op de nieuwe main, en de oude tak valt na vijf nieuwere runs vanzelf weg.

## Stappen voor de eigenaar, in volgorde

1. **Merge eerst de bronnen-PR** (`claude/agenda-bronnen`), **daarna deze PR**.
   Zonder de bronnen-PR op main faalt `refresh.yml` meteen met de melding dat
   `lib/data-lane-paths.json` of een npm-script ontbreekt.
2. **Zet de rulesets.** Eerst ruleset 2, dan ruleset 1 met voorlopig alleen
   `check` als verplichte controle:

   ```bash
   gh api -X POST repos/jonathanvanderelst1997/publieke-agenda-antwerpen/rulesets \
     --input docs/rulesets/2-main-update-owner-via-pr.json

   jq '(.name = "main: PR, squash, CI check (geen bypass)")
       | (.rules[] | select(.type == "required_status_checks") | .parameters.required_status_checks)
         |= map(select(.context == "check"))' docs/rulesets/1-main-pr-squash-ci.json \
     | gh api -X POST repos/jonathanvanderelst1997/publieke-agenda-antwerpen/rulesets --input -
   ```

3. **Voeg `data-only` toe** zodra `data-only` één keer groen gedraaid heeft op
   main en op een PR:

   ```bash
   id=$(gh api repos/jonathanvanderelst1997/publieke-agenda-antwerpen/rulesets \
     --jq '.[] | select(.name | startswith("main: PR")) | .id')
   gh api -X PUT "repos/jonathanvanderelst1997/publieke-agenda-antwerpen/rulesets/${id}" \
     --input docs/rulesets/1-main-pr-squash-ci.json
   ```

4. **Takken na een merge weghalen:**

   ```bash
   gh api -X PATCH repos/jonathanvanderelst1997/publieke-agenda-antwerpen -F delete_branch_on_merge=true
   ```

5. **UiTdatabank aanzetten** zodra publiq de client-id levert. Als
   Actions-variabele, niet als geheim: publiq noemt de client-id zelf niet
   geheim, en een repo-geheim laat de Gateway main als niet geverifieerd
   melden.

   ```bash
   gh variable set UITDATABANK_CLIENT_ID -R jonathanvanderelst1997/publieke-agenda-antwerpen --body '<client-id>'
   ```

   Zolang die waarde ontbreekt, is ze leeg en doet de fetcher niets (status
   `skipped_no_key`). `UITDATABANK_SEARCH_BASE` is optioneel, ook een
   variabele. `refresh.yml` noemt het geheim `UITDATABANK_API_KEY` alleen bij
   naam, voor het geval publiq toch een sleutel levert.
6. **Laten zoals het is:** automatisch mergen uit (`allow_auto_merge=false`),
   standaardrechten van workflows op lezen, en
   `can_approve_pull_request_reviews=false`. Nakijken:

   ```bash
   gh api repos/jonathanvanderelst1997/publieke-agenda-antwerpen --jq '{allow_auto_merge, delete_branch_on_merge}'
   gh api repos/jonathanvanderelst1997/publieke-agenda-antwerpen/actions/permissions/workflow
   ```

## Na de rulesets: PR #10 en #11

De open PR's #10 (parkeerverbod/IOD/SGW) en #11 (eBesluit speelstraten/foren)
staan dan achter op main. Ruleset 1 is strikt, dus elk van beide moet eerst
bijgewerkt worden en daarna opnieuw groene CI halen:

```bash
gh pr update-branch 10 -R jonathanvanderelst1997/publieke-agenda-antwerpen
gh pr update-branch 11 -R jonathanvanderelst1997/publieke-agenda-antwerpen
```

Het zijn codewijzigingen: mergen vraagt de toegangscode van de eigenaar.

## Stilval na 60 dagen

In een publieke repo zet GitHub geplande workflows uit na 60 dagen zonder
activiteit in de repo. Elke gemergde data-PR telt als activiteit, dus zolang
de databaan werkt, gebeurt dat niet. Valt de baan stil, dan valt ook de job
`freshness` stil, want die is zelf gepland. Daarom kijkt ook de bronwacht van
Brain naar
`https://mijn-publieke-agenda-voor-district.onrender.com/sources/refresh-status.json`
en meldt hij een live agenda die ouder is dan 48 uur. Weer aanzetten:

```bash
gh workflow enable refresh.yml -R jonathanvanderelst1997/publieke-agenda-antwerpen
```

## Wat deze workflow nooit doet

- een PR openen;
- CI starten (`workflow_dispatch` of een ander dispatch-verzoek);
- mergen, of automatisch mergen aanzetten;
- geheimen, variabelen of repo-instellingen aanmaken of wijzigen;
- op een self-hosted runner draaien: alles draait op `ubuntu-latest`.
