# Praktijkcase: een publieke agenda scherper, deelbaarder en controleerbaar maken

Status: **klantgerichte praktijkcase op basis van een begrensde scan van een
eigen publieke site**. Dit is geen WCAG-, EAA-, beveiligings- of
conformiteitscertificaat.

## De vraag

De publieke agenda voor District Antwerpen werkte en toonde brongeverifieerde
activiteiten. De controle moest daarom niet bewijzen dat de site “slecht” was,
maar uitzoeken waar een kleine technische verbetering echte gebruikswaarde kon
toevoegen.

## Begrensde aanpak

Op 13 augustus 2026 is de publieke homepage met AccessGuard gecontroleerd,
aangevuld met een handmatige bron- en headercontrole van één publiek
agendapunt. De audit bleef passief en rate-limited: alleen openbare pagina's en
bestanden, geen login, geen accountdata en geen indringende securitytest. Het
ruwe scanrapport en tijdelijke technische output blijven privé en staan niet in
deze repository.

De automatische scan gaf een indicatieve totaalscore van **95/100**. Een enkele
Lighthouse-labrun mat performance 100, accessibility 94, SEO 100 en best
practices 100. Dat zijn momentopnamen en geen bewijs van conformiteit. De
ingebouwde axe-run voltooide niet door een fout in de auditinstrumentatie; er
wordt daarom geen volledige geautomatiseerde toegankelijkheidsclaim gemaakt.

## Wat goed zat

- de homepage antwoordde via HTTPS met HTTP 200;
- één duidelijke H1, `lang="nl-BE"`, een gelabelde hoofdstructuur en zichtbare
  focusstijlen waren aanwezig;
- de pagina had een bruikbare titel, beschrijving en self-canonical;
- een geldige eventroute antwoordde met HTTP 200;
- de mobiele labcontrole zag geen horizontale overflow of te kleine tapdoelen;
- de site toont alleen actuele, publiek brongeverifieerde items.

## Wat de scan zichtbaar maakte

1. **Deeplinks waren deelbaar, maar inhoudelijk dun voor zoekmachines en
   previewbots.** Een eventpagina stuurde bezoekers meteen door naar de algemene
   app en bevatte nauwelijks zelfstandige eventinformatie.
2. **Sociale metadata ontbrak.** Berichtenplatformen kregen daardoor geen
   gecontroleerde titel en omschrijving.
3. **Filterstatus was vooral visueel.** De actieve themaknoppen hadden geen
   `aria-pressed`; pijltjes konden onnodig in de toegankelijke naam belanden.
4. **Kleine labels en secundaire tekst hadden te weinig contrast.** Wit op
   `#b7791f` leverde ongeveer 3,64:1; de vervangkleur `#8b5a11` levert ongeveer
   5,89:1. De secundaire tekstkleur ging van ongeveer 4,28:1 naar 4,74:1 op de
   lichtgrijze pagina-achtergrond.
5. **Crawldiscovery kon beter.** `robots.txt` en `sitemap.xml` ontbraken.
6. **Live headers weken af van de bronconfiguratie.** De live canonical stuurde
   geen `X-Frame-Options` en geen `Referrer-Policy`, terwijl `render.yaml` beide
   al declareerde. Dat is configuratiedrift, geen reden om te doen alsof een
   dubbele coderegel het live probleem oplost.

## Voorbereide verbetering

- zelfstandige eventpagina's met datum, uur, locatie, bron en een duidelijke
  route naar de volledige agenda;
- een self-canonical, event-specifieke Open Graph-/Twitter-metadata en eerlijke
  `Event`-structured data per deeplink;
- homepage-metadata en `WebSite`-structured data;
- `robots.txt` en een tijdens de build gegenereerde sitemap;
- toetsenbord-skiplink, `aria-pressed`, `aria-controls` en decoratieve iconen die
  voor schermlezers worden verborgen;
- donkerdere oproep- en secundaire tekstkleuren met voldoende contrast;
- een HTML-referrerpolicy als robuuste bronfallback.

De headerdrift zelf vereist na merge een aparte deploymentcontrole: bevestigen
dat de canonical Render-service de gedeclareerde headerregels echt toepast. Tot
die live hercontrole mag niet worden beweerd dat framing is geblokkeerd of dat
de HTTP-referrerpolicy actief is.

## Praktische waarde

Deze case laat zien waar een kleine audit nuttig is: niet door een certificaat
te suggereren, maar door een werkende site te vertalen naar een korte backlog
met bewijs, bronfixes, deploymentgates en hercontrolecriteria. De verbeteringen
maken individuele agendapunten duidelijker deelbaar, filters beter
interpreteerbaar en configuratiedrift zichtbaar voordat er een te sterke claim
wordt gepubliceerd.

## Acceptatie na eventuele merge en deploy

- homepage, `robots.txt`, `sitemap.xml` en een eventdeeplink antwoorden met 200;
- een eventdeeplink bevat zelfstandig titel, datum, locatie en bron;
- desktop en mobiel hebben geen clipping, overlay of horizontale overflow;
- filters melden hun status programmatisch en openen een gekoppeld detailvlak;
- live responses tonen `X-Frame-Options: DENY` en
  `Referrer-Policy: strict-origin-when-cross-origin`;
- daarna opnieuw scannen; geen score of conformiteitsclaim vooruitlopen.
