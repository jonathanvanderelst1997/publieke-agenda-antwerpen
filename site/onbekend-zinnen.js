// Eén vaste lijst van de zinnen die zeggen wat een bron níet publiceert ("onbekend"-zinnen), voor de site, de
// verversing en de build (vaagheidsplan van 12 oktober 2026, stap 6). Een zin die zegt dat iets ontbreekt, staat
// alleen hier: tests/onbekend-zinnen.test.mjs weigert zo'n zin in een ander bestand met tekst voor bewoners. Zo is
// er één plek om ze na te kijken, en zegt elke zin hetzelfde op elke kaart.
//
// Per zin:
// - `zin`: de tekst, met {naam} voor een stuk dat de code invult (onbekendZin);
// - `meter` en `kern`: het patroon in de vaagheidsmeter (lib/vaagheid.mjs) en of het een kernveld is (wat, wanneer,
//   waar). Een kaart die de zin niet zelf toont (de zin staat één keer per sectie of in een bundel), draagt het id
//   in `onbekend` (onbekendVeld), zodat de meter ze toch telt;
// - `waar`: waar de zin staat (kaart, sectie, bundel, detail, agenda), ter info.
// Geen netwerk, geen DOM: draait in de browser, in de verversing en in de toetsen.

export const ONBEKEND_ZINNEN = Object.freeze({
  // ---- terrassen ----
  "terras-periode": { zin: "Een periode publiceert de stad niet.", meter: "periode-onbekend", kern: true, waar: "bundel" },

  // ---- werfzones en parkeerverboden ----
  "werfzone-waarvoor": { zin: "De stad publiceert niet waarvoor deze {wat} dient.", meter: "wat-zegt-stad-niet", kern: true, waar: "kaart" },
  "werfzones-waarvoor": { zin: "Waarvoor deze werfzones en omleidingen dienen, staat niet in A-Sign, en GIPOD noemt geen werk met hetzelfde dossiernummer of alleen genummerde fasen.", meter: "wat-zegt-stad-niet", kern: true, waar: "bundel" },
  "werf-zonder-doel": { zin: "Waarvoor de werf dient, staat niet in A-Sign en niet in de fasen van GIPOD.", meter: "werf-zonder-doel", kern: true, waar: "kaart" },
  "parkeerverbod-waarvoor": { zin: "De stad publiceert niet waarvoor.", meter: "wat-zegt-stad-niet", kern: true, waar: "kaart" },

  // ---- evenementendossiers en innames (A-Sign) ----
  "inname-wat": { zin: "Wat er gebeurt of wat er staat, zegt het dossier niet.", meter: "wat-zegt-dossier-niet", kern: true, waar: "kaart" },
  "inname-wat-kort": { zin: "Wat er gebeurt, zegt de stad niet.", meter: "wat-zegt-stad-niet", kern: true, waar: "kaart" },
  "innames-wat": { zin: "Bij deze toelatingen staat in het dossier geen omschrijving: wat er gebeurt of wat er staat, zegt de stad niet.", meter: "wat-zegt-dossier-niet", kern: true, waar: "bundel" },
  "evenement-uren": { zin: "de uren zijn niet gepubliceerd", meter: "uur-onbekend", kern: true, waar: "kaart" },
  "evenementen-uren": { zin: "Evenementendossiers van de stad (A-Sign) hebben geen uren: staat er bij een kaart geen uur, dan publiceert de stad het niet.", meter: "uur-onbekend", kern: true, waar: "sectie" },
  "elke-dag": { zin: "Dit is de periode waarin de stad de plek in gebruik geeft; of er elke dag iets gebeurt, zegt de stad niet.", meter: "elke-dag-onbekend", kern: false, waar: "kaart" },
  "naam-stad": { zin: "de naam maakt de stad niet bekend", meter: "naam-stad-niet", kern: false, waar: "kaart" },
  "naam-stad-zin": { zin: "De stad maakt de naam niet bekend.", meter: "naam-stad-niet", kern: false, waar: "kaart" },
  "naam-stad-vermoeden": { zin: "de stad noemt geen naam", meter: "naam-stad-niet", kern: false, waar: "kaart" },
  "studenten-naam": { zin: "Naam, uur en organisator van een studentenactiviteit publiceert de stad niet.", meter: "naam-stad-niet", kern: false, waar: "bundel" },
  "parcours-straten": { zin: "Straten op het parcours kunnen tijdelijk dicht zijn; welke en hoe laat, maakt de stad niet bekend.", meter: "straten-niet-bekend", kern: false, waar: "kaart" },
  "parkeerverbod-uren": { zin: "De uren van het parkeerverbod staan niet in het dossier.", meter: "uren-parkeerverbod-onbekend", kern: false, waar: "kaart" },
  "datum": { zin: "datum niet gepubliceerd", meter: "datum-niet-gepubliceerd", kern: true, waar: "kaart" },
  "plek": { zin: "Niet gepubliceerd.", meter: "plek-niet-gepubliceerd", kern: true, waar: "kaart" },
  "evenement-naam-ontbreekt": { zin: "naam van het evenement niet gepubliceerd door de stad", meter: "naam-stad-niet", kern: false, waar: "detail" },
  "evenement-wat-ontbreekt": { zin: "wat er gebeurt en de naam niet gepubliceerd door de stad", meter: "wat-zegt-stad-niet", kern: true, waar: "detail" },
  "uren-ontbreekt": { zin: "uren niet gepubliceerd", meter: "uren-niet-gepubliceerd", kern: false, waar: "detail" },
  "organisator-ontbreekt": { zin: "organisator niet gepubliceerd", meter: "organisator-niet-gepubliceerd", kern: false, waar: "detail" },
  "voetnoot-soort": { zin: "maar zegt niet wie het organiseert of op welke uren", meter: "organisator-niet-gepubliceerd", kern: false, waar: "detail" },
  "voetnoot-leeg": { zin: "maar zegt niet wat het is, wie het organiseert of op welke uren", meter: "wat-zegt-stad-niet", kern: false, waar: "detail" },
  // Een kaart die alleen uit een evenementendossier van A-Sign komt: één regel die zegt welke bron wat niet geeft
  // (nakijkronde 13 oktober 2026: "precies welke bron wat niet zegt", in plaats van drie zinnen die hetzelfde zeggen).
  "niet-in-dossier-kop": { zin: "Niet in het evenementendossier {dossier} (A-Sign)", meter: "niet-in-de-bron", kern: false, waar: "detail" },
  "dossier-wat-ontbreekt": { zin: "wat er gebeurt en de naam (geen omschrijving die dat zegt)", meter: "wat-zegt-stad-niet", kern: true, waar: "detail" },
  "dossier-naam-ontbreekt": { zin: "de naam", meter: "naam-stad-niet", kern: false, waar: "detail" },
  "dossier-uren-ontbreekt": { zin: "uren (A-Sign geeft alleen {dagen})", meter: "uren-niet-gepubliceerd", kern: false, waar: "detail" },
  "dossier-organisator-ontbreekt": { zin: "organisator", meter: "organisator-niet-gepubliceerd", kern: false, waar: "detail" },
  // De agendapunten uit de evenementendossiers (lib/asign-evenementen-agenda.mjs).
  "naam-dossier": { zin: "De stad publiceert bij dit dossier geen naam.", meter: "naam-stad-niet", kern: false, waar: "agenda" },
  "naam-onbekend": { zin: "Naam onbekend.", meter: "naam-stad-niet", kern: false, waar: "agenda" },
  // Eén zin die zegt wat ontbreekt (niet "Naam onbekend: ... noemt geen naam": dat telde de meter twee keer).
  "naam-onbekend-lang": { zin: "Het dossier noemt geen naam, en geen besluit, kalender, nieuwsbericht of organisatoragenda die we nakijken, zegt met zekerheid welk evenement er die dag op die plek is.", meter: "naam-stad-niet", kern: false, waar: "agenda" },
  "naam-dossier-route": { zin: "De stad noemt geen naam bij dit dossier.", meter: "naam-stad-niet", kern: false, waar: "kaart" },
  // De korte noot op een gesloten kaart (site/kaart-bronnoot.js): wat er van een inname of evenement ontbreekt.
  "bronnoot-activiteit": { zin: "Welke activiteit hier plaatsvindt is niet gepubliceerd", meter: "wat-zegt-stad-niet", kern: true, waar: "kaart" },
  "bronnoot-naam": { zin: "Naam van het evenement niet gepubliceerd", meter: "naam-stad-niet", kern: false, waar: "kaart" },
  "bronnoot-uur": { zin: "Uur niet gepubliceerd", meter: "uren-niet-gepubliceerd", kern: false, waar: "kaart" },

  // ---- omgevingsaanvragen ----
  "aanvraag-omschrijving": { zin: "De stadsbron geeft geen omschrijving. Wat er gebeurt, staat alleen in het dossier zelf.", meter: "doel-onbekend", kern: true, waar: "kaart" },
  "aanvragen-omschrijving": { zin: "De stadsbron geeft bij deze aanvragen geen omschrijving; wat er gebeurt, staat alleen in het dossier zelf (Omgevingsloket).", meter: "doel-onbekend", kern: true, waar: "bundel" },
  "aanvragen-oud": { zin: "Een aanvraag van twee jaar of ouder zonder beslissing in de bron: of ze nog loopt, zegt de stadsbron niet.", meter: "aanvraag-oud", kern: false, waar: "bundel" },
  "aanvraag-ontvankelijk": { zin: "De stadsbron zegt niet of de aanvraag volledig en ontvankelijk is.", meter: "stand-onduidelijk", kern: false, waar: "kaart" },
  "aanvragen-ontvankelijk": { zin: "Bij een ingediende aanvraag zegt de stadsbron niet of ze volledig en ontvankelijk is.", meter: "stand-onduidelijk", kern: false, waar: "sectie" },
  "aanvragen-start": { zin: "Bij een omgevingsaanvraag publiceert de stad geen startdatum van de werken.", meter: "start-werken-onbekend", kern: false, waar: "sectie" },

  // ---- werken (GIPOD) ----
  "werk-omschrijving": { zin: "omschrijving niet gepubliceerd door de beheerder", meter: "werk-zonder-wat", kern: true, waar: "kaart" },
  "werk-omschrijving-zin": { zin: "Omschrijving niet gepubliceerd door de beheerder.", meter: "werk-zonder-wat", kern: true, waar: "kaart" },
  "werk-huisnummers": { zin: "huisnummers niet gepubliceerd", meter: "huisnummers-niet-gepubliceerd", kern: false, waar: "detail" },
  "werk-gevolgen": { zin: "gevolgen voor het verkeer niet gepubliceerd", meter: "gevolgen-niet-gepubliceerd", kern: false, waar: "detail" },
  "werk-einde": { zin: "einddatum niet gepubliceerd", meter: "datum-niet-gepubliceerd", kern: false, waar: "detail" },
  "werk-wat": { zin: "Niet bekend: omschrijving niet gepubliceerd door de beheerder.", meter: "werk-zonder-wat", kern: true, waar: "detail" },
  "werk-alleen-adres": { zin: "Niet bekend: de beheerder gaf alleen een adres op.", meter: "werk-zonder-wat", kern: true, waar: "detail" },
  "niet-gepubliceerd": { zin: "niet gepubliceerd", meter: "niet-in-de-bron", kern: false, waar: "detail" },
  "beheerder-geen-omschrijving": { zin: "De beheerder publiceerde zelf geen omschrijving.", meter: "beheerder-geen-omschrijving", kern: false, waar: "detail" },
  // De districtslijst van de werken (works-live.js): hinder uit GIPOD, of dat ze er niet is. Laadde de hinderbron
  // niet, dan zegt de lijst dat niet (besluit van 18-10-2026): dan valt de regel weg.
  "hinder-onbekend": { zin: "Onbekend in open data", meter: "gevolgen-niet-gepubliceerd", kern: false, waar: "lijst" },
  "hinder-koppeling": { zin: "Gevalideerde GIPOD-hinder is gekoppeld; ontbrekende koppeling wordt bewust als onbekend getoond.", meter: "gevolgen-niet-gepubliceerd", kern: false, waar: "lijst" },
  "losse-hinder": { zin: "GIPOD publiceert deze gevalideerde hinder, maar het werk zelf staat niet bij de getoonde werken. Daarom staat ze los van de werken hierboven.", meter: "werk-niet-getoond", kern: false, waar: "sectie" },
  "uur-label": { zin: "Uur onbekend", meter: "uur-onbekend", kern: true, waar: "kaart" },
  // De kop van de regel die zegt wat een kaart niet heeft ("Niet in de bron: ...").
  "niet-in-de-bron-kop": { zin: "Niet in de bron", meter: "niet-in-de-bron", kern: false, waar: "detail" },
  // De districtslijst van de parkeerverboden (public-space-live.js) zonder reden.
  "reden-niet-gepubliceerd": { zin: "Niet gepubliceerd", meter: "parkeerverbod-welk", kern: true, waar: "lijst" },

  // ---- agenda (bronnen van de stad en het district) ----
  "koopzondag-uren": { zin: "De stad noemt geen uren; zie de officiële pagina.", meter: "uur-onbekend", kern: false, waar: "agenda" },
  // Een eventpagina (scripts/build-agenda.mjs) zonder uur of plaats in de bron: dat zeggen, geen belofte dat de
  // officiële bron het wel heeft (bij de evenementendossiers van A-Sign staat er nooit een uur).
  "eventpagina-uur": { zin: "Geen uur in de bron.", meter: "uur-niet-in-bron", kern: true, waar: "agenda" },
  "eventpagina-plaats": { zin: "Geen plaats in de bron.", meter: "plek-niet-in-bron", kern: true, waar: "agenda" },
  // Bij een bericht, een kalender of een besluit vond onze lezer geen uur of plaats; of de officiële pagina er een
  // noemt, is niet nagekeken. Dan alleen wat vaststaat, en waar het staat (eventpaginaZin).
  "eventpagina-uur-gezocht": { zin: "Geen uur gevonden; zie de officiële bron.", meter: "uur-niet-in-bron", kern: true, waar: "agenda" },
  "eventpagina-plaats-gezocht": { zin: "Geen plaats gevonden; zie de officiële bron.", meter: "plek-niet-in-bron", kern: true, waar: "agenda" },
  // Het districtsnieuws van een ander district (site/stad-zoeken.js): een bericht zonder plaats of uur zegt dat (nakijkronde
  // 13 oktober 2026: "Ontdek de pracht van Muisbroek tijdens de EkeRun!" stond er zonder plaats, uur of zin).
  "nieuws-plaats-uur": { zin: "Plaats en uur staan niet in het bericht.", meter: "plek-niet-in-bron", kern: true, waar: "lijst" },
  "nieuws-plaats": { zin: "De plaats staat niet in het bericht.", meter: "plek-niet-in-bron", kern: true, waar: "lijst" },
  "nieuws-uur": { zin: "Het uur staat niet in het bericht.", meter: "uur-niet-in-bron", kern: true, waar: "lijst" },
  "bijwerkmoment": { zin: "Bijwerkmoment onbekend", meter: "bijwerkmoment-onbekend", kern: false, waar: "agenda" },
  "bijwerkmoment-kort": { zin: "op een onbekend moment", meter: "bijwerkmoment-onbekend", kern: false, waar: "agenda" },
});

// De zin met een id, met {naam} ingevuld. Een onbekend id is een fout in de code: dan gooit de functie, zodat een
// toets het meteen ziet (en de site nooit een lege of verzonnen zin toont).
// Bronnen die nooit een uur of een plaats geven (het veld bestaat er niet): de evenementendossiers van A-Sign (alleen
// dagen) en de lijst van de koopzondagen. Alleen daar zegt een eventpagina "Geen uur in de bron."; bij elke andere bron
// (een bericht, een kalender, een besluit) is het alleen zeker dat onze lezer er geen vond (laatste nakijkronde van 13
// oktober 2026: "Geen uur in de bron." stond ook bij artikels waarvan niemand de officiële pagina had nagekeken).
export const BRONNEN_ZONDER_UUR = Object.freeze(["district-asign-evenementen", "stad-koopzondagen"]);
// De zin voor een eventpagina zonder uur (`soort` "uur") of plaats ("plaats"), voor een item van bron `bronId`.
export function eventpaginaZin(soort, bronId = "") {
  const vast = BRONNEN_ZONDER_UUR.includes(String(bronId || ""));
  return onbekendZin(`eventpagina-${soort === "plaats" ? "plaats" : "uur"}${vast ? "" : "-gezocht"}`);
}
export function onbekendZin(id, vars = {}) {
  const z = ONBEKEND_ZINNEN[id];
  if (!z) throw new Error(`onbekende onbekend-zin: ${id}`);
  return z.zin.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}
// Het veld voor de meter op een kaart die de zin niet zelf toont: { meter, kern, id }.
export function onbekendVeld(id) {
  const z = ONBEKEND_ZINNEN[id];
  if (!z) throw new Error(`onbekende onbekend-zin: ${id}`);
  return { id, meter: z.meter, kern: z.kern };
}
