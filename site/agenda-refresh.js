(() => {
  const retrievedAt = "2026-08-10T09:08:00Z";

  const sources = {
    "city-district-calendar": {
      publisher: "District Antwerpen",
      url: "https://www.antwerpen.be/info/5efb0477b118f7b19c627b69/wat-beleef-je-in-district-antwerpen",
      retrievedAt,
      state: "verified",
      scope: "Actuele publieke districtskalender met data, uren en locaties.",
      officialPublic: true,
    },
    "antwerpen-danst": {
      publisher: "Antwerpen Danst / District Antwerpen",
      url: "https://antwerpendanst.life/",
      retrievedAt,
      state: "verified",
      scope: "Officiële organisatorpagina voor de reeks van 30 juni tot en met 27 augustus 2026.",
      officialPublic: true,
    },
    "city-yogalates": {
      publisher: "Stad Antwerpen",
      url: "https://www.antwerpen.be/info/68416577eb023525675d4482/gratis-lessen-yoga-tai-chi-en-pilates-in-openlucht",
      retrievedAt,
      state: "verified",
      scope: "Actuele pagina voor wekelijkse Yogalates op de Boeienweide in juli en augustus.",
      officialPublic: true,
    },
    "scratch-freedom-friday": {
      publisher: "SCRATCH",
      url: "https://www.scratch-antwerp.be/freedom-friday/",
      retrievedAt,
      state: "verified",
      scope: "Officiële organisatorpagina: elke vrijdag van 19 tot 22 uur.",
      officialPublic: true,
    },
    "district-summer-roundup": {
      publisher: "District Antwerpen",
      url: "https://nieuwsbrief.antwerpen.be/t/j-e-ydkthktd-hhtjvijdl-r/",
      retrievedAt,
      state: "verified",
      scope: "Officiële publieke nieuwsbrief die Eilandje in beweging en Red Star Run dateert.",
      officialPublic: true,
    },
    "city-zomerfeest": {
      publisher: "District Antwerpen",
      url: "https://www.antwerpen.be/info/6475b557e7cec95b032c253c/zomerfeest-in-het-albertpark",
      retrievedAt,
      state: "verified",
      scope: "Actuele detailpagina voor Zomerfeest Albertpark.",
      officialPublic: true,
    },
    "city-bal-bevrijding": {
      publisher: "District Antwerpen",
      url: "https://www.antwerpen.be/info/664e0139bc28fd07a114a7e6/swingen-en-dansen-op-het-bal-van-de-bevrijding",
      retrievedAt,
      state: "verified",
      scope: "Actuele detailpagina voor het Bal van de Bevrijding.",
      officialPublic: true,
    },
    "antwerpen-redt": {
      publisher: "Antwerpen Redt",
      url: "https://antwerpenredt.be/",
      retrievedAt,
      state: "verified",
      scope: "Officiële organisatoragenda met Antwerpse reanimatielessen van september tot december 2026.",
      officialPublic: true,
    },
    "citaat-op-straat": {
      publisher: "Citaat op Straat",
      url: "https://www.citaatopstraat.be/",
      retrievedAt,
      state: "verified",
      scope: "Officiële organisatoragenda voor de wandelingen van 19 september en 10 oktober.",
      officialPublic: true,
    },
    "city-beweegdag": {
      publisher: "District Antwerpen",
      url: "https://www.antwerpen.be/info/6a422229d82fbac5fe0a2613/beweegdag-55-in-het-zuiderpershuis",
      retrievedAt,
      state: "verified",
      scope: "Actuele detailpagina voor Beweegdag 55+ in Zuiderpershuis en Zuidpark.",
      officialPublic: true,
    },
    "city-works-permit": {
      publisher: "Stad Antwerpen",
      url: "https://www.antwerpen.be/nl/info/545104d9cea8a77f338b465a/aanvraag-minderhindervergunning",
      retrievedAt,
      state: "verified",
      scope: "Actuele officiële fasering voor Balansstraat/Lange Elzenstraat en Halenstraat/Schijnpoortweg.",
      officialPublic: true,
    },
    "city-gaston-works": {
      publisher: "District Antwerpen",
      url: "https://www.antwerpen.be/info/6149b6f0305f459e313c07cc/heraanleg-gaston-burssenslaan-en-hanegraefstraat-start-op-12-november",
      retrievedAt,
      state: "review_required",
      scope: "De pagina noemt een verwachte afronding tegen het bouwverlof, maar bevestigt geen feitelijke oplevering.",
      officialPublic: true,
    },
    "slim-kammenstraat": {
      publisher: "Slim naar Antwerpen",
      url: "https://www.slimnaarantwerpen.be/en/works-events/kammenstraat-car-free-at-the-start-of-the-sales-period",
      retrievedAt,
      state: "verified",
      scope: "Officiële bereikbaarheidspagina: maatregel eindigde op 13 juli 2026.",
      officialPublic: true,
    },
    "city-old-sport-newsletter": {
      publisher: "District Antwerpen",
      url: "https://nieuwsbrief.antwerpen.be/t/j-e-ydhyiln-hhtjvijdl-r/",
      retrievedAt,
      state: "review_required",
      scope: "De actuele bestemming bevestigt de ingevoerde Jespo-herhalingen niet en vermeldt Red Star Run alleen op datum.",
      officialPublic: true,
    },
    "city-withdrawn-3x3-detail": {
      publisher: "District Antwerpen",
      url: "https://www.antwerpen.be/nl/overzicht/district-antwerpen-1/sport/ontdek-de-3x3-basketbalinitiaties-in-district-antwerpen",
      retrievedAt,
      state: "review_required",
      scope: "De oude detailroute levert geen eenduidige actuele uren en locaties; recente officiële informatie wijkt af.",
      officialPublic: true,
    },
    "archery-organizer-social": {
      publisher: "Koninklijke Wipmaatschappij La Renaissance",
      url: "https://www.facebook.com/Koninklijke.Wipmaatschappij.La.Renaissance",
      retrievedAt,
      state: "review_required",
      scope: "De publieke organisatorpagina gaf in deze audit geen controleerbare reeksdata terug.",
      officialPublic: true,
    },
  };

  const rules = [
    {
      match: { title: "Fasewissel heraanleg Balansstraat en Lange Elzenstraat", theme: "Werken" },
      sourceId: "city-works-permit",
      classification: "current",
      changes: {
        dateLabel: "Fase 5 tot 15 augustus 2026; volgende fasen lopen door tot 31 december 2027",
        location: "Balansstraat, Kielsevest, Desguinlei en Lange Elzenstraat",
      },
    },
    {
      match: { title: "Kammenstraat autovrij tijdens soldenperiode", theme: "Werken" },
      sourceId: "slim-kammenstraat",
      classification: "expired",
      changes: { dateLabel: "26 juni tot en met 13 juli 2026" },
    },
    {
      match: { title: "Nieuwe fase heraanleg Gaston Burssenslaan en Hanegraefstraat", theme: "Werken" },
      sourceId: "city-gaston-works",
      classification: "review_required",
    },
    {
      match: { title: "Werken Halenstraat en Schijnpoortweg", theme: "Werken" },
      sourceId: "city-works-permit",
      classification: "current",
      changes: { dateLabel: "Fase 1 tot 30 september 2026; volgende fasen lopen tot 30 april 2027" },
    },
    {
      match: { title: "Sportinitiaties met Jespo", dateFrom: "2026-08-10" },
      sourceId: "city-old-sport-newsletter",
      classification: "review_required",
    },
    {
      match: { title: "3x3 basket", dateFrom: "2026-08-10" },
      sourceId: "city-withdrawn-3x3-detail",
      classification: "review_required",
    },
    {
      match: { title: "Gratis initiaties boogschieten", dateFrom: "2026-08-10" },
      sourceId: "archery-organizer-social",
      classification: "review_required",
    },
    {
      match: { title: "Antwerpen Danst", dateFrom: "2026-08-10", dateTo: "2026-08-27" },
      sourceId: "antwerpen-danst",
    },
    {
      match: { title: "Yogalates op Boeienweide", dateFrom: "2026-08-10", dateTo: "2026-08-31" },
      sourceId: "city-yogalates",
      changes: { location: "Boeienweide aan zaal Thonetje; bij regen Sporthal IGLO" },
    },
    {
      match: { title: "Freedom Friday in Scratch", dateFrom: "2026-08-10", dateTo: "2026-08-31" },
      sourceId: "scratch-freedom-friday",
      changes: { location: "SCRATCH, Sint-Bernardsesteenweg 113" },
    },
    {
      match: { title: "Strip- en boekenplein", dates: ["2026-08-16"] },
      sourceId: "city-district-calendar",
    },
    {
      match: { title: "Zomer Mee Park Spoor Noord", dates: ["2026-08-26"] },
      sourceId: "city-district-calendar",
      changes: { link: "https://www.antwerpen.be/info/68107cf3eb02357caa7042e2/zomer-mee-in-park-spoor-noord" },
    },
    {
      match: { title: "Tabletcafé", dates: ["2026-08-28"] },
      sourceId: "city-district-calendar",
    },
    {
      match: { title: "Antwerp Sup Festival", dates: ["2026-08-29", "2026-08-30"] },
      sourceId: "city-district-calendar",
    },
    {
      match: { title: "Lambermontmartre", dates: ["2026-08-30", "2026-09-27"] },
      sourceId: "city-district-calendar",
    },
    {
      match: { title: "Inschrijven Herfstklaar", dates: ["2026-09-04"] },
      sourceId: "city-district-calendar",
    },
    {
      match: { title: "Eilandje in beweging", dates: ["2026-08-29", "2026-08-30"] },
      sourceId: "district-summer-roundup",
      changes: { timeText: "programma via de officiële bron", timeSlot: "Info" },
    },
    {
      match: { title: "Red Star Run", dates: ["2026-08-30"] },
      sourceId: "district-summer-roundup",
      changes: { timeText: "datum bevestigd; uur via de officiële bron", timeSlot: "Info" },
    },
    {
      match: { title: "Zomerfeest Albertpark", dates: ["2026-08-30"] },
      sourceId: "city-zomerfeest",
      changes: { location: "Albertpark, 2018 Antwerpen" },
    },
    {
      match: { title: "Bal van de Bevrijding", dates: ["2026-09-04"] },
      sourceId: "city-bal-bevrijding",
      changes: { timeText: "18 tot 23.30 uur", location: "Groenplaats" },
    },
    {
      match: { title: "Reanimatielessen", dates: ["2026-09-10"] },
      sourceId: "antwerpen-redt",
      changes: {
        dateLabel: "Meerdere officiële lesmomenten van 10 september tot 10 december 2026",
        timeText: "uren en locaties per les via de officiële kalender",
        timeSlot: "Info",
      },
    },
    {
      match: { title: "Poëtische Rimpelingen", dates: ["2026-09-19"] },
      sourceId: "citaat-op-straat",
      changes: {
        timeText: "14 tot 16.30 uur",
        timeSlot: "14:00",
        location: "Gloriantlaan 53 ter hoogte van Brabo II, Linkeroever",
      },
    },
    {
      match: { title: "Poëtische Rimpelingen", dates: ["2026-10-10"] },
      sourceId: "citaat-op-straat",
      changes: {
        timeText: "14 tot 16.30 uur; exacte vertrekplaats volgt bij de organisator",
        timeSlot: "14:00",
        location: "Regattawijk, Linkeroever",
      },
    },
    {
      match: { title: "Beweegdag 55+", dates: ["2026-09-19"] },
      sourceId: "city-beweegdag",
      changes: {
        timeText: "deuren vanaf 9 uur; programma tot 17.15 uur",
        timeSlot: "09:00",
        location: "Zuiderpershuis en Zuidpark, ingang Waalsekaai 14",
        info: "Sport- en beweegdag voor 55-plussers in het Zuiderpershuis en Zuidpark; programma en inschrijving via de officiële pagina.",
      },
    },
  ];

  const config = {
    schemaVersion: 1,
    classificationAsOf: "2026-08-10",
    retrievedAt,
    rollback: {
      baseCommit: "f9ce9badc00b2300d083996b9e93b5d5cb7c15f3",
      strategy: "Restore the candidate tree to the recorded base commit; no deployment or external state is part of this patch.",
    },
    sources,
    rules,
  };

  function matches(item, match) {
    if (match.title && item.title !== match.title) return false;
    if (match.theme && item.theme !== match.theme) return false;
    if (match.dates && !match.dates.includes(item.date)) return false;
    if (match.dateFrom && item.date < match.dateFrom) return false;
    if (match.dateTo && item.date > match.dateTo) return false;
    return true;
  }

  function classifyAgendaItem(item, asOf = config.classificationAsOf) {
    const rule = config.rules.find((candidate) => matches(item, candidate.match));
    const source = rule?.sourceId ? config.sources[rule.sourceId] : null;
    const reconciled = {
      ...item,
      ...(rule?.changes || {}),
    };

    let classification = rule?.classification;
    if (!classification) {
      if (reconciled.theme === "Werken") classification = "review_required";
      else if (reconciled.date < asOf) classification = "expired";
      else if (reconciled.date === asOf) classification = "current";
      else classification = "future";
    }

    if (["current", "future"].includes(classification) && source?.state !== "verified") {
      classification = "review_required";
    }

    const sourceUrl = reconciled.link || source?.url || "";
    const canonicalSourceUrl = source?.state === "verified" ? source.url : sourceUrl;

    return {
      ...reconciled,
      link: rule?.changes?.link || canonicalSourceUrl,
      classification,
      classificationAsOf: asOf,
      sourceId: rule?.sourceId || "historical-stored-source",
      sourcePublisher: source?.publisher || "Historische bronverwijzing",
      sourceRetrievedAt: source?.retrievedAt || config.retrievedAt,
      verificationState: source?.state || (classification === "expired" ? "date_elapsed_only" : "review_required"),
    };
  }

  function reconcileAgendaItems(items, asOf = config.classificationAsOf) {
    const auditItems = items.map((item) => classifyAgendaItem(item, asOf));
    const publicItems = auditItems.filter(
      (item) => ["current", "future"].includes(item.classification) && item.verificationState === "verified"
    );
    const counts = auditItems.reduce(
      (result, item) => {
        result[item.classification] += 1;
        return result;
      },
      { expired: 0, current: 0, future: 0, review_required: 0 }
    );

    return { auditItems, publicItems, counts };
  }

  window.PUBLIC_AGENDA_REFRESH_ENGINE = Object.freeze({
    config,
    classifyAgendaItem,
    reconcileAgendaItems,
  });
})();
