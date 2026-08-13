# Official source release recrawl — 13 August 2026

Scope: read-only live release check of every configured source in `site/agenda-refresh.js`, completed at `2026-08-13T13:24:19Z`. Retrieval dates were updated per source, never as a blanket operation. A reachable page without usable event evidence was not treated as fresh verification.

## Per-source result

| Source ID | Live result | Release decision |
|---|---|---|
| `city-district-calendar` | District calendar confirms Herfstklaar (4 Sep), Antwerpen Danst (through 27 Aug), Strip- en boekenplein (16 Aug), Zomer Mee (26 Aug), Tabletcafé (28 Aug), SUP (29–30 Aug), Lambermontmartre (30 Aug and 27 Sep), Zomerfeest (30 Aug) and Bal van de Bevrijding (4 Sep). | Fresh `verified`. |
| `antwerpen-danst` | Organizer and City pages confirm 30 Jun–27 Aug, with Tuesday and Thursday sessions at Waagnatie. | Fresh `verified`. |
| `city-yogalates` | City page confirms Wednesdays 10:00–11:00 at Boeienweide throughout July and August. | Fresh `verified`. |
| `scratch-freedom-friday` | Live organizer body confirms every Friday 19:00–22:00 and Sint-Bernardsesteenweg 113. | Fresh `verified`. |
| `district-summer-roundup` | Live official newsletter confirms Eilandje in beweging on 29–30 Aug and Red Star Run on 30 Aug, but no exact hours. | Fresh `verified`; hours remain explicitly unknown. |
| `city-zomerfeest` | City page confirms 30 Aug, 14:00–18:30, Albertpark. | Fresh `verified`. |
| `city-bal-bevrijding` | City page confirms 4 Sep, 18:00–23:30, Groenplaats. | Fresh `verified`. |
| `antwerpen-redt` | Live organizer calendar lists eight Antwerp sessions from 10 Sep through 10 Dec with an exact time and location per session. | Fresh `verified`; public series item links to the exact calendar. |
| `citaat-op-straat` | Live organizer body confirms 19 Sep and 10 Oct, both 14:00–16:30, with the published locations. | Fresh `verified`. |
| `city-beweegdag` | City page confirms 19 Sep, doors at 09:00, programme through 17:15, Zuiderpershuis/Zuidpark, Waalsekaai 14. | Fresh `verified`. |
| `city-works-permit` | City table confirms Balansstraat phases through 2027 and Halenstraat/Schijnpoortweg phases through Apr 2027. | Fresh `verified`. |
| `city-gaston-works` | City page gives an expected completion in early Sep 2026, not an actual completion. | Freshly checked, remains `review_required`. |
| `slim-kammenstraat` | Official route returned HTTP 200, but no current body evidence was extracted in this run. Its only mapped item ended 13 Jul and is forced `expired`. | Previous retrieval date retained; no public effect. |
| `city-old-sport-newsletter` | Live newsletter confirms Red Star Run only by date and describes 3x3 as Apr–Jun; it does not corroborate stored Jespo repeats. | Freshly checked, remains `review_required`. |
| `city-withdrawn-3x3-detail` | Current official result describes Apr–Jun dates, not the stored Aug repeats; the old detail route has no usable current detail payload. | Freshly checked, remains `review_required`. |
| `archery-organizer-social` | Public organizer profile identity is reachable, but it exposes no verifiable 2026 series dates. | Freshly checked, remains `review_required`. |

## Publication boundary

- Classification is fixed at 13 August 2026 for deterministic release evidence.
- From 132 stored records: 84 are `expired`, 3 `current`, 26 `future`, and 19 `review_required`.
- Exactly 29 current/future records pass the official-source and freshness gates.
- All 19 `review_required` records remain excluded. Missing hours are left visible as unknown; no time or location was inferred.
- No mailbox, political dossier, account data, Spain material or other private source is included.

## Official URLs

- https://www.antwerpen.be/info/5efb0477b118f7b19c627b69/wat-beleef-je-in-district-antwerpen
- https://www.antwerpen.be/info/5e79cfa3c148cd67e816433b/antwerpen-danst-de-hele-zomer-lang
- https://antwerpendanst.life/
- https://www.antwerpen.be/info/68416577eb023525675d4482/gratis-lessen-yoga-tai-chi-en-pilates-in-openlucht
- https://www.scratch-antwerp.be/freedom-friday/
- https://nieuwsbrief.antwerpen.be/t/j-e-ydkthktd-hhtjvijdl-r/
- https://www.antwerpen.be/info/6475b557e7cec95b032c253c/zomerfeest-in-het-albertpark
- https://www.antwerpen.be/info/664e0139bc28fd07a114a7e6/swingen-en-dansen-op-het-bal-van-de-bevrijding
- https://antwerpenredt.be/
- https://www.citaatopstraat.be/
- https://www.antwerpen.be/info/6a422229d82fbac5fe0a2613/beweegdag-55-in-het-zuiderpershuis
- https://www.antwerpen.be/nl/info/545104d9cea8a77f338b465a/aanvraag-minderhindervergunning
- https://www.antwerpen.be/info/6149b6f0305f459e313c07cc/heraanleg-gaston-burssenslaan-en-hanegraefstraat-start-op-12-november
- https://www.slimnaarantwerpen.be/en/works-events/kammenstraat-car-free-at-the-start-of-the-sales-period
- https://nieuwsbrief.antwerpen.be/t/j-e-ydhyiln-hhtjvijdl-r/
- https://www.antwerpen.be/nl/overzicht/district-antwerpen-1/sport/ontdek-de-3x3-basketbalinitiaties-in-district-antwerpen
- https://www.facebook.com/Koninklijke.Wipmaatschappij.La.Renaissance

Result: **PASS for release with fail-closed exclusions**.
