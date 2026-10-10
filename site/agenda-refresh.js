(() => {
  const previousRetrievedAt = "2026-08-10T09:08:00Z";
  const releaseRetrievedAt = "2026-08-13T13:24:19Z";
  const currentRetrievedAt = "2026-09-16T12:46:42Z";

  const sources = {
    "city-district-calendar": {
      publisher: "District Antwerpen",
      url: "https://www.antwerpen.be/info/5efb0477b118f7b19c627b69/wat-beleef-je-in-district-antwerpen",
      retrievedAt: currentRetrievedAt,
      state: "verified",
      note: "Actuele publieke districtskalender met data, uren en locaties.",
      officialPublic: true,
      scope: "district",
    },
    "antwerpen-danst": {
      publisher: "Antwerpen Danst / District Antwerpen",
      url: "https://antwerpendanst.life/",
      retrievedAt: releaseRetrievedAt,
      state: "verified",
      note: "Officiële organisatorpagina voor de reeks van 30 juni tot en met 27 augustus 2026.",
      officialPublic: true,
      scope: "district",
    },
    "city-yogalates": {
      publisher: "Stad Antwerpen",
      url: "https://www.antwerpen.be/info/68416577eb023525675d4482/gratis-lessen-yoga-tai-chi-en-pilates-in-openlucht",
      retrievedAt: releaseRetrievedAt,
      state: "verified",
      note: "Actuele pagina voor wekelijkse Yogalates op de Boeienweide in juli en augustus.",
      officialPublic: true,
      scope: "stad",
      inDistrict: true,
    },
    "scratch-freedom-friday": {
      publisher: "SCRATCH",
      url: "https://www.scratch-antwerp.be/freedom-friday/",
      retrievedAt: releaseRetrievedAt,
      state: "verified",
      note: "Officiële organisatorpagina: elke vrijdag van 19 tot 22 uur.",
      officialPublic: true,
      scope: "district",
    },
    "district-summer-roundup": {
      publisher: "District Antwerpen",
      url: "https://www.antwerpen.be/info/5efb0477b118f7b19c627b69/wat-beleef-je-in-district-antwerpen",
      retrievedAt: releaseRetrievedAt,
      state: "verified",
      note: "Oorspronkelijk gedateerd in de publieke districtsnieuwsbrief; de getraceerde nieuwsbrieflink is vervangen door de officiële districtskalender.",
      officialPublic: true,
      scope: "district",
    },
    "city-zomerfeest": {
      publisher: "District Antwerpen",
      url: "https://www.antwerpen.be/info/6475b557e7cec95b032c253c/zomerfeest-in-het-albertpark",
      retrievedAt: releaseRetrievedAt,
      state: "verified",
      note: "Actuele detailpagina voor Zomerfeest Albertpark.",
      officialPublic: true,
      scope: "district",
    },
    "city-bal-bevrijding": {
      publisher: "District Antwerpen",
      url: "https://www.antwerpen.be/info/664e0139bc28fd07a114a7e6/swingen-en-dansen-op-het-bal-van-de-bevrijding",
      retrievedAt: releaseRetrievedAt,
      state: "verified",
      note: "Actuele detailpagina voor het Bal van de Bevrijding.",
      officialPublic: true,
      scope: "district",
    },
    "antwerpen-redt": {
      publisher: "Antwerpen Redt",
      url: "https://antwerpenredt.be/",
      retrievedAt: currentRetrievedAt,
      state: "verified",
      note: "Officiële organisatoragenda met Antwerpse reanimatielessen van september tot december 2026.",
      officialPublic: true,
      scope: "district",
    },
    "citaat-op-straat": {
      publisher: "Citaat op Straat",
      url: "https://www.citaatopstraat.be/",
      retrievedAt: currentRetrievedAt,
      state: "verified",
      note: "Organisatorbron voor de wandeling van 19 september.",
      officialPublic: true,
      scope: "district",
    },
    "poetische-rimpelingen-regatta": {
      publisher: "Maand van de Voetganger / Voetgangersbeweging vzw",
      url: "https://maandvandevoetganger.be/actie/wandelen-met-woorden-poetische-rimpelingen/",
      // Deze fiche is pas op 08-10-2026 gecontroleerd, niet bij de ronde van 16-09.
      retrievedAt: "2026-10-08T19:23:00Z",
      state: "verified",
      note: "Publieke activiteitenfiche: Regattawandeling zaterdag 10 oktober 2026 om 14 uur; samen met 2050 Literair, Citaat op Straat en district Antwerpen.",
      officialPublic: true,
      scope: "district",
      check: { mustContain: ["Poëtische Rimpelingen", "10 oktober"] },
    },
    "city-beweegdag": {
      publisher: "District Antwerpen",
      url: "https://www.antwerpen.be/info/6a422229d82fbac5fe0a2613/beweegdag-55-in-het-zuiderpershuis",
      retrievedAt: currentRetrievedAt,
      state: "verified",
      note: "Actuele detailpagina voor Beweegdag 55+ in Zuiderpershuis en Zuidpark.",
      officialPublic: true,
      scope: "district",
    },
    "city-works-permit": {
      publisher: "Stad Antwerpen",
      url: "https://www.antwerpen.be/nl/info/545104d9cea8a77f338b465a/aanvraag-minderhindervergunning",
      retrievedAt: currentRetrievedAt,
      state: "verified",
      note: "Actuele officiële fasering voor Balansstraat/Lange Elzenstraat en Halenstraat/Schijnpoortweg.",
      officialPublic: true,
      scope: "stad",
      inDistrict: true,
    },
    "city-herfstklaar": {
      publisher: "District Antwerpen",
      url: "https://www.antwerpen.be/nl/overzicht/district-antwerpen-1/beleef-je-buurt/maak-je-straat-herfstklaar-op-23-24-of-25-oktober",
      retrievedAt: currentRetrievedAt,
      state: "verified",
      note: "Actuele oproep: zonder materiaal of straatafsluiting kan een aanvraag nog tot 25 september 2026.",
      officialPublic: true,
      scope: "district",
    },
    "city-osystraat-works": {
      publisher: "District Antwerpen",
      url: "https://www.antwerpen.be/info/608fe3749dc6b9660910da8b/heraanleg-osystraat-van-de-wervestraat-van-maerlantstraat-violierstraat-en-vondelstraat",
      retrievedAt: currentRetrievedAt,
      state: "verified",
      note: "Actuele officiële fasering voor Van Maerlantstraat en Vondelstraat: fase 2 loopt sinds 3 augustus 2026 tot voorjaar 2027.",
      officialPublic: true,
      scope: "district",
    },
    "city-gaston-buurtfeest": {
      publisher: "District Antwerpen",
      url: "https://www.antwerpen.be/info/6149b6f0305f459e313c07cc/voorontwerp-heraanleg-gaston-burssenslaan",
      retrievedAt: "2026-10-06T07:00:00Z",
      state: "verified",
      note: "Officiële projectpagina: inhuldiging en gratis buurtfeest op 10 oktober 2026, 14 tot 17 uur.",
      officialPublic: true,
      scope: "district",
      check: { mustContain: ["buurtfeest", "inhuldiging"] },
    },
    "publiekeruimte-schoolstraat-vanhoenacker": {
      publisher: "District Antwerpen, team Publieke Ruimte",
      url: "https://www.antwerpen.be/publiekeruimte",
      retrievedAt: "2026-10-05T12:00:00Z",
      state: "verified",
      note: "Publieke aankondiging van team Publieke Ruimte district Antwerpen (5 oktober 2026): bevraging over de proefperiode van de schoolstraat aan basisschool K'do, Jan Vanhoenackerstraat; enquête open tot en met 1 november 2026. Verdere info op de officiële pagina publieke ruimte van district Antwerpen.",
      officialPublic: true,
      scope: "district",
      // De bron-URL stuurt door naar het algemene overzicht "openbare werken" en noemt de bevraging
      // niet: automatisch niet te bevestigen. Wordt als "niet_controleerbaar" gemeld tot er een
      // officiële pagina is die de bevraging zelf noemt.
      check: false,
    },
    "city-gaston-works": {
      publisher: "District Antwerpen",
      url: "https://www.antwerpen.be/info/6149b6f0305f459e313c07cc/heraanleg-gaston-burssenslaan-en-hanegraefstraat-start-op-12-november",
      retrievedAt: releaseRetrievedAt,
      state: "review_required",
      note: "De pagina noemt een verwachte afronding begin september 2026, maar bevestigt geen feitelijke oplevering.",
      officialPublic: true,
      scope: "district",
    },
    "slim-kammenstraat": {
      publisher: "Slim naar Antwerpen",
      url: "https://www.slimnaarantwerpen.be/en/works-events/kammenstraat-car-free-at-the-start-of-the-sales-period",
      retrievedAt: previousRetrievedAt,
      state: "verified",
      note: "Officiële bereikbaarheidspagina: maatregel eindigde op 13 juli 2026.",
      officialPublic: true,
      scope: "district",
    },
    "city-old-sport-newsletter": {
      publisher: "District Antwerpen",
      url: "https://www.antwerpen.be/info/5efb0477b118f7b19c627b69/wat-beleef-je-in-district-antwerpen",
      retrievedAt: releaseRetrievedAt,
      state: "review_required",
      note: "De sportnieuwsbrief bevestigt de ingevoerde Jespo-herhalingen niet en vermeldt Red Star Run alleen op datum; de getraceerde nieuwsbrieflink is vervangen door de officiële districtskalender.",
      officialPublic: true,
      scope: "district",
    },
    "city-withdrawn-3x3-detail": {
      publisher: "District Antwerpen",
      url: "https://www.antwerpen.be/nl/overzicht/district-antwerpen-1/sport/ontdek-de-3x3-basketbalinitiaties-in-district-antwerpen",
      retrievedAt: releaseRetrievedAt,
      state: "review_required",
      note: "De oude detailroute levert geen eenduidige actuele uren en locaties; recente officiële informatie wijkt af.",
      officialPublic: true,
      scope: "district",
    },
    "city-3x3-summer-2026": {
      publisher: "Sporting A / Stad Antwerpen",
      url: "https://www.antwerpen.be/info/6a183dbaae0fb6a5f52d9820/beleef-een-hele-zomer-lang-3x3-op-de-pleintjes-in-t-stad",
      retrievedAt: "2026-08-13T15:34:15Z",
      state: "verified",
      note: "Actuele officiële pagina: Kielpark is een vast plein van 20 mei tot 9 september; sessies zijn elke woensdag van 15 tot 18 uur.",
      officialPublic: true,
      scope: "stad",
      inDistrict: true,
    },
    "archery-organizer-social": {
      publisher: "Koninklijke Wipmaatschappij La Renaissance",
      url: "https://www.facebook.com/Koninklijke.Wipmaatschappij.La.Renaissance",
      retrievedAt: releaseRetrievedAt,
      state: "review_required",
      note: "De publieke organisatorpagina gaf in deze audit geen controleerbare reeksdata terug.",
      officialPublic: true,
      scope: "stad",
    },
  };

  const rules = [
    {
      match: { title: "Kammenstraat autovrij tijdens soldenperiode", theme: "Werken" },
      sourceId: "slim-kammenstraat",
      classification: "expired",
      changes: { dateLabel: "26 juni tot en met 13 juli 2026" },
    },
    {
      match: { title: "Buurtfeest Gaston Burssenslaan en Hanegraefstraat", dates: ["2026-10-10"] },
      sourceId: "city-gaston-buurtfeest",
    },
    {
      match: { title: "Bevraging proefperiode schoolstraat Jan Vanhoenackerstraat", dates: ["2026-10-05"] },
      sourceId: "publiekeruimte-schoolstraat-vanhoenacker",
    },
    {
      match: { title: "Sportinitiaties met Jespo", dateFrom: "2026-08-10" },
      sourceId: "city-old-sport-newsletter",
      classification: "review_required",
    },
    {
      match: { title: "3x3 basket", dateFrom: "2026-08-10" },
      sourceId: "city-3x3-summer-2026",
      changes: {
        timeText: "15 tot 18 uur",
        timeSlot: "15:00",
        location: "Kielpark, 2020 Antwerpen",
        info: "Gratis 3x3-basketmomenten voor jongeren van 12 tot 18 jaar in het Kielpark, elke woensdag van 15 tot 18 uur.",
      },
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
      match: { title: "Inschrijven Herfstklaar", dates: ["2026-09-25"] },
      sourceId: "city-herfstklaar",
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
      sourceId: "poetische-rimpelingen-regatta",
      changes: {
        timeText: "start om 14 uur; exacte vertrekplaats volgt bij de organisator",
        timeSlot: "14:00",
        location: "Regattawijk, Linkeroever",
        info: "Regattawandeling met poëzie op zaterdag 10 oktober 2026 om 14 uur. Publieke kalender van Maand van de Voetganger, in samenwerking met 2050 Literair, Citaat op Straat en district Antwerpen. Deelname 5 euro; exacte vertrekplaats via de organisator.",
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

  // Automatische bronnen uit site/agenda-feed.js (gebouwd door scripts/build-sources.mjs).
  const feed = (typeof window !== "undefined" && window.PUBLIC_AGENDA_FEED) || null;
  for (const feedSource of Array.isArray(feed?.sources) ? feed.sources : []) {
    sources[feedSource.sourceId] = {
      publisher: feedSource.publisher,
      label: feedSource.label || feedSource.publisher,
      url: feedSource.url,
      retrievedAt: feedSource.retrievedAt,
      state: feedSource.officialPublic === true ? "verified" : "review_required",
      note: feedSource.method,
      officialPublic: feedSource.officialPublic === true,
      scope: feedSource.scope,
      allowedHosts: Array.isArray(feedSource.allowedHosts) ? [...feedSource.allowedHosts] : [],
      maxAgeHours: Number.isFinite(feedSource.maxAgeHours) ? feedSource.maxAgeHours : 48,
      fetchStatus: feedSource.fetchStatus,
      errorCode: feedSource.errorCode ?? null,
      attribution: feedSource.attribution,
      itemCount: feedSource.itemCount ?? 0,
      coverage: feedSource.coverage ?? null,
      feed: true,
    };
  }

  // Uitkomst van de automatische controle van handmatige bronnen, per sourceId (zie lib/manual-check.mjs).
  const manualChecks = feed?.manualCheck?.sources && typeof feed.manualCheck.sources === "object" ? feed.manualCheck.sources : {};

  const config = {
    schemaVersion: 1,
    classificationAsOf: window.PUBLIC_AGENDA_FEED?.classificationAsOf ?? "2026-09-16",
    retrievedAt: feed?.generatedAt ?? currentRetrievedAt,
    generatedAt: feed?.generatedAt ?? null,
    rollback: {
      baseCommit: "36ea97332e1742d0ed1650a1226c2276733a34f3",
      strategy: "If live validation fails, revert the release merge on main to the recorded base content and let Render redeploy that rollback.",
    },
    sources,
    rules,
    manualCheck: feed?.manualCheck ?? null,
  };

  const DAY_MS = 24 * 60 * 60 * 1000;
  const HOUR_MS = 60 * 60 * 1000;
  const brusselsDateFormat = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  function brusselsDateOf(instantMs) {
    if (!Number.isFinite(instantMs)) return null;
    const parts = Object.fromEntries(brusselsDateFormat.formatToParts(new Date(instantMs)).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function addDays(isoDateOrInstant, days) {
    const date = new Date(`${String(isoDateOrInstant).slice(0, 10)}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function dayDelta(from, to) {
    return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
  }

  // Dezelfde vensters als scripts/provenance-sla.mjs: huidig of werken 2 dagen, toekomstig binnen
  // 14 dagen 3 dagen, verder weg 7 dagen.
  function maxAgeDaysFor(classification, theme, date, asOf) {
    if (classification === "expired") return null;
    if (classification === "review_required") return 0;
    if (classification === "current" || theme === "Werken") return 2;
    return dayDelta(asOf, date) <= 14 ? 3 : 7;
  }

  function lastDayOf(item) {
    return item.endDate && item.endDate > item.date ? item.endDate : item.date;
  }

  function dateClassification(date, endDate, asOf) {
    const last = endDate && endDate > date ? endDate : date;
    if (last < asOf) return "expired";
    if (date <= asOf) return "current";
    return "future";
  }

  function isAllowedHttps(url, allowedHosts) {
    try {
      const parsed = new URL(String(url || ""));
      return parsed.protocol === "https:" && !parsed.search && !parsed.hash && allowedHosts.includes(parsed.hostname);
    } catch {
      return false;
    }
  }

  function defaultNow(asOf) {
    if (asOf === config.classificationAsOf && config.generatedAt) return config.generatedAt;
    return `${asOf}T12:00:00Z`;
  }

  function matches(item, match) {
    if (match.title && item.title !== match.title) return false;
    if (match.theme && item.theme !== match.theme) return false;
    if (match.dates && !match.dates.includes(item.date)) return false;
    if (match.dateFrom && item.date < match.dateFrom) return false;
    if (match.dateTo && item.date > match.dateTo) return false;
    return true;
  }

  function classifyAgendaItem(item, asOf = config.classificationAsOf, options = {}) {
    const now = options.now || defaultNow(asOf);
    const isFeed = item.feed === true;
    const rule = isFeed ? null : config.rules.find((candidate) => matches(item, candidate.match));
    const source = isFeed ? config.sources[item.sourceId] || null : rule?.sourceId ? config.sources[rule.sourceId] : null;
    const reconciled = {
      ...item,
      ...(rule?.changes || {}),
    };

    let classification = rule?.classification;
    const classificationBasis = classification ? "rule" : "date";
    let reviewReason = classification === "review_required" ? "rule" : null;
    if (!classification) {
      if (reconciled.theme === "Werken" && !isFeed) {
        classification = "review_required";
        reviewReason = "works_without_rule";
      } else {
        classification = dateClassification(reconciled.date, reconciled.endDate, asOf);
      }
    }

    const verified = isFeed
      ? Boolean(source?.feed) && source.officialPublic === true && source.state === "verified" && isAllowedHttps(item.sourceUrl, source.allowedHosts)
      : source?.state === "verified";
    if (["current", "future"].includes(classification) && !verified) {
      classification = "review_required";
      reviewReason = isFeed ? "unverified_feed_item" : "unverified_source";
    }
    // De automatische controle van de bron van een handmatig item (scripts/check-manual-sources.mjs):
    // is de pagina weg of staan datum of kernwoorden er niet meer op, dan gaat het item van de site.
    const manualCheck = !isFeed && rule?.sourceId ? manualChecks[rule.sourceId] ?? null : null;
    if (
      !options.ignoreManualCheck
      && ["current", "future"].includes(classification)
      && manualCheck
      && ["gewijzigd", "weg"].includes(manualCheck.status)
    ) {
      classification = "review_required";
      reviewReason = manualCheck.status === "weg" ? "manual_source_gone" : "manual_source_changed";
    }

    const sourceRetrievedAt = item.retrievedAt ?? source?.retrievedAt ?? previousRetrievedAt;

    // Versheid: een feed-bron veroudert na maxAgeHours. Een handmatig item dat op zijn datum
    // geclassificeerd is, blijft zichtbaar tot en met zijn laatste dag (endDate, anders date) en
    // verdwijnt de dag erna (besluit eigenaar, 5-10-2026: "als het evenement bezig is, de dag erna
    // is het gedaan"); geen herbevestiging om de paar dagen. Alleen een handmatig item met een vaste
    // classificatie uit een regel (een lopende werf zonder harde einddatum) volgt nog de provenance-SLA.
    let slaMaxAgeDays = null;
    let slaMaxAgeHours = null;
    let recheckDueOn = null;
    let visibleThrough = null;
    if (["current", "future"].includes(classification)) {
      let stale;
      if (isFeed) {
        slaMaxAgeHours = source.maxAgeHours;
        const dueAt = Date.parse(sourceRetrievedAt) + slaMaxAgeHours * HOUR_MS;
        recheckDueOn = brusselsDateOf(dueAt);
        stale = !Number.isFinite(dueAt) || Date.parse(now) > dueAt;
      } else if (classificationBasis === "date") {
        visibleThrough = lastDayOf(reconciled);
        recheckDueOn = visibleThrough;
        stale = false;
      } else {
        slaMaxAgeDays = maxAgeDaysFor(classification, reconciled.theme, reconciled.date, asOf);
        recheckDueOn = addDays(sourceRetrievedAt, slaMaxAgeDays);
        stale = asOf > recheckDueOn;
      }
      if (stale) {
        classification = "review_required";
        reviewReason = "stale_source";
      }
    }

    const sourceUrl = reconciled.link || source?.url || "";
    const canonicalSourceUrl = source?.state === "verified" ? source.url : sourceUrl;
    const scope = isFeed ? item.scope || source?.scope || "district" : source?.scope || "district";
    const inDistrict = isFeed ? item.inDistrict ?? (scope === "district" ? true : null) : source?.inDistrict ?? (scope === "district" ? true : null);

    return {
      ...reconciled,
      link: isFeed ? item.link || item.sourceUrl : rule?.changes?.link || canonicalSourceUrl,
      classification,
      classificationAsOf: asOf,
      classificationBasis,
      reviewReason,
      sourceId: isFeed ? item.sourceId : rule?.sourceId || "historical-stored-source",
      sourcePublisher: source?.publisher || "Historische bronverwijzing",
      sourceRetrievedAt,
      verificationState: isFeed ? (verified ? "verified" : "review_required") : source?.state || (classification === "expired" ? "date_elapsed_only" : "review_required"),
      scope,
      inDistrict,
      slaMaxAgeDays,
      slaMaxAgeHours,
      recheckDueOn,
      visibleThrough,
      manualCheckStatus: manualCheck?.status ?? null,
    };
  }

  function sourceFreshnessAt(nowMs) {
    return Object.entries(config.sources)
      .filter(([, source]) => source.feed)
      .map(([sourceId, source]) => {
        const retrievedMs = Date.parse(source.retrievedAt || "");
        const dueMs = retrievedMs + source.maxAgeHours * HOUR_MS;
        const inactive = ["skipped_no_key", "disabled", "test_only"].includes(source.fetchStatus);
        let state = "fresh";
        if (inactive && !(source.itemCount > 0)) state = "inactive";
        else if (!Number.isFinite(retrievedMs) || nowMs > dueMs) state = "stale";
        return {
          sourceId,
          label: source.label,
          scope: source.scope,
          publisher: source.publisher,
          fetchStatus: source.fetchStatus,
          errorCode: source.errorCode,
          retrievedAt: source.retrievedAt || null,
          maxAgeHours: source.maxAgeHours,
          itemCount: source.itemCount,
          coverage: source.coverage ?? null,
          state,
          staleSince: state === "stale" && Number.isFinite(dueMs) ? new Date(dueMs).toISOString() : null,
        };
      })
      .sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  }

  function reconcileAgendaItems(items, asOf = config.classificationAsOf, options = {}) {
    const now = options.now || defaultNow(asOf);
    const auditItems = items.map((item) => classifyAgendaItem(item, asOf, { now, ignoreManualCheck: options.ignoreManualCheck === true }));
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

    return { auditItems, publicItems, counts, sourceFreshness: sourceFreshnessAt(Date.parse(now)) };
  }

  window.PUBLIC_AGENDA_REFRESH_ENGINE = Object.freeze({
    config,
    classifyAgendaItem,
    reconcileAgendaItems,
  });
})();
