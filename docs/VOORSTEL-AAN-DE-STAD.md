# Voorstel aan de stad: één open bron voor wat er in het district gebeurt

Stand van 24 november 2026. Een voorstel om samen te bekijken, geen eis. De details en voorbeelden staan in
[KNELPUNTEN-STAD-EVENEMENTEN.md](KNELPUNTEN-STAD-EVENEMENTEN.md).

## Het doel

Eén open, gecentraliseerde bron voor wat er in district Antwerpen gebeurt: activiteiten, inspraak, werken en
evenementen op straat. Zodat een bewoner op één plek ziet wat er in zijn straat gebeurt, en wie de gegevens wil
hergebruiken (een buurtsite, een app, een journalist) niet tien bronnen moet combineren.

## Waar het nu wringt

- **Evenementen zonder naam.** De open kaartlagen (A-Sign) en GIPOD geven bij een evenement de dagen, de straten en de
  vorm van het parcours, maar geen naam, geen organisator en geen uur. Een bewoner ziet "een lus van 7,9 km vanaf de
  Belgiëlei op 10 december" en weet niet wat het is. Van de 22 evenementen in de agenda op 24 november konden we er
  met de hand 7 benoemen, via zeven verschillende soorten bronnen; 13 blijven onbekend. Buurgemeenten zetten naam en
  uur wel in GIPOD.
- **De districtskalender heeft geen feed.** De kalender en het nieuws van het district staan alleen als webpagina op
  www.antwerpen.be.
- **Geen automatische lezer mag nog binnen.** Sinds 22–23 oktober 2026 geeft de beveiliging van www.antwerpen.be
  (Akamai) elke lezer die geen browser is een 403 "Access Denied", zelfs voor robots.txt. Daardoor staan de
  districtskalender, het districtsnieuws, de projecten, het nieuws van de andere districten en de koopzondagen stil.
- **De nieuwsbrief is geen oplossing.** Hij komt per mail, is niet machineleesbaar, en linkt naar pagina's die we niet
  kunnen nakijken. Daar kunnen fouten op mislopen, en niemand kan erop verder bouwen.
- **Activiteiten zitten in de UiTdatabank**, maar die is alleen met een betalende sleutel te lezen, en niet vrij te
  hergebruiken.

## Voorstellen, van makkelijk naar groter

| | Voorstel | Wat het de stad kost | Kans op ja |
|---|---|---|---|
| a | **Een feed van de districtskalender en het districtsnieuws** (iCal, RSS of JSON). Het CMS van antwerpen.be heeft al een publieke inhoud-API, dus een feed is vermoedelijk een instelling of een kleine uitbreiding. | Weinig: eenmalig wat werk van de webploeg. | **Redelijk tot goed.** Past in het open-databeleid en helpt elke hergebruiker. Wat we niet weten: of het CMS dit al kan, en of het district dit zelf mag vragen. |
| b | **Een open kopie op het open-dataportaal** (portaal-stadantwerpen.opendata.arcgis.com), elke dag bijgewerkt, met de activiteiten en het nieuws van het district. Zoals de open kopie van het Belgisch Staatsblad bij OpenJustice: de bron blijft beschermd, de gegevens zijn toch open. | Middel: een dagelijkse export en een eigenaar voor de dataset. | **Middel.** Het portaal bestaat al (markten, foren, schoolstraten). Het hangt af van wie de dataset beheert. |
| b' | **Of een uitzondering bij Akamai voor één eerlijke, benoemde lezer** (`publieke-agenda-antwerpen/1.0`), hoogstens één verzoek per pagina per dag. | Technisch klein: één regel in de beveiliging. | **Eerder klein.** Beveiligingsploegen maken zelden uitzonderingen voor één lezer; de open kopie (b) is waarschijnlijk makkelijker te verdedigen. |
| c | **Naam, organisator en uur bij evenementen in de open lagen van A-Sign en GIPOD.** Voor een aanvraag van een privépersoon (een buurtfeest) volstaat de naam van het evenement, zonder organisator. | Middel: de gegevens zitten vermoedelijk al in de aanvraag bij het evenementenloket; ze moeten mee naar de open laag. Wel een privacyafweging. | **Middel.** Andere gemeenten doen het al in GIPOD. Tegen: het hangt af van wat de aanvrager invult, en de stad zal privépersonen willen beschermen. Een verwijzing van dossier naar besluit (het dossiernummer in het besluit) is een kleinere eerste stap. |
| d | **De activiteiten van stad en district uit de UiTdatabank open aanbieden**, of een sleutel voor niet-commercieel publiek gebruik. | Klein tot middel; de gegevens zijn van publiq, dus dit vraagt overleg. | **Klein tot middel.** De stad beslist niet alleen over de UiTdatabank. Een sleutel kost anders 125 euro per jaar. |
| e | **Als achtervang:** de formele aanvraag tot hergebruik (art. II.63 Bestuursdecreet), die al klaarligt. | Een beslissing binnen de wettelijke termijn. | **Zeker een antwoord**, maar hergebruik gaat over bestaande documenten; de stad moet er geen feed voor maken. Liever niet nodig. |

## Wat wij aanbieden

- Bronvermelding bij elk item, zoals de open-datalicentie vraagt.
- Hoogstens één verzoek per bron per dag, onder een eigen, eerlijke naam, en altijd volgens robots.txt. Niets omzeilen.
- Foutmeldingen terug naar de stad: dossiers zonder naam, tegenstrijdige data, evenementen die nog als "niet
  goedgekeurd" staan terwijl ze aangekondigd zijn. De lijst staat al klaar in
  [VRAGEN_AAN_DE_STAD.md](VRAGEN_AAN_DE_STAD.md).
- De code is open: iedereen kan nakijken wat de agenda leest en hoe.

## Eerlijk over de onzekerheid

We weten niet wie bij de stad over elk van deze punten beslist (de webploeg, de beveiliging, het evenementenloket,
het district), en ook niet of er al plannen zijn. De kansen hierboven zijn een inschatting, geen kennis van binnenuit.
De kleinste stap met het meeste effect is waarschijnlijk (a) of (b): één open kalender van het district.
