# Official source release recrawl — 16 September 2026

Scope: live source check for the District Antwerpen items that remain current or actionable after the mailbox review. Classification is fixed at `2026-09-16`; private mailbox content is not copied into this repository.

| Source ID | Live result | Release decision |
|---|---|---|
| `city-district-calendar` | The official district overview still lists public district activities, including Lambermontmartre. | Retrieval refreshed; only dated current or future items remain public. |
| `antwerpen-redt` | The organizer calendar still exposes future Antwerp sessions. | Retrieval refreshed; verified future sessions remain public. |
| `citaat-op-straat` | The organizer page confirms the walks on 19 September and 10 October, both from 14:00 to 16:30. | Retrieval refreshed; verified dates remain public. |
| `city-beweegdag` | The City page confirms 19 September, doors at 09:00, programme through 17:15, at Zuiderpershuis and Zuidpark. | Corrected time and location remain public. |
| `city-herfstklaar` | The City page confirms 23–25 October and the extended 25 September application deadline only when no material or street closure is needed. | Replaces the expired generic 4 September item with the exact conditional deadline. |
| `city-works-permit` | The official works table still supports the long-running Balansstraat and Halenstraat/Schijnpoortweg phases. | Retrieval refreshed; current phases remain public. |
| `city-osystraat-works` | The City page says phase 2 for Van Maerlantstraat/Vondelstraat started on 3 August 2026 and is expected to run through spring 2027. | Added as a current public information item. |

## Publication boundary

- 133 stored source records were reconciled.
- 109 are expired, 3 current, 5 future and 16 require review.
- 8 verified current or future records pass the fail-closed publication gate.
- Internal district information, mailbox-only material and items without a public activity or public deadline stay out of the public agenda.
- The agenda code does not read Outlook folders and does not automatically publish a Facebook post. Those remain separate, explicit actions.

Result: **PASS when the generated tests and provenance checks are green**.
