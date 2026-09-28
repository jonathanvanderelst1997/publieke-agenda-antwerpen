# Publieke ruimte — broncontract parkeerverbod, IOD en SGW

Stand: 28 september 2026.

Parkeerverboden: laag 20 is canoniek voor dossierinformatie; laag 21 is een geometrievariant en wordt niet opgeteld. Deduplicatie: Dossiernummer + Locatienummer. Publiek bevestigd: Goedgekeurd en In effect. Voorbereidende, afgekeurde of lege statussen zijn geen bevestigde publieke impact. Geen aanvrager-/contactmetadata of adminlinks publiceren.

IOD: polygonen en lijnen zijn onderdelen/geometrievarianten. Deduplicatie: dossierNummer + faseId + innameId. Publiek bevestigd: aanvraag_goedgekeurd, toelating_gegenereerd, toelating_geverifieerd.

SGW: meerdere geometrieën kunnen dezelfde fase voorstellen. Deduplicatie: reference_id + phase_id. Alleen vergund geldt als publiek bevestigd.

Voor IOD/SGW blijft filtering tegen de officiële districtsgrens verplicht; bbox-aantallen zijn alleen broncontrole.
