// "Uitgaan & evenementen": welke soorten standaard zichtbaar zijn, hoe de wekelijkse markten
// gebundeld worden, welke items bovenaan uitgelicht worden en hoe vers de data is.
// Alleen presentatie: bronnen, verificatie en publicatieregels blijven in agenda-refresh.js.
(function (root) {
  const clean = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const HOUR_MS = 60 * 60 * 1000;

  // Volgorde = volgorde van de knoppen. "on" = standaard zichtbaar in "Uitgaan & evenementen".
  const CATEGORIES = Object.freeze([
    { key: "festival", label: "Feest & festival", emoji: "🎉", on: true, weight: 6 },
    { key: "neighborhood", label: "Buurt & straat", emoji: "🏘️", on: true, weight: 6 },
    { key: "culture", label: "Cultuur", emoji: "🎭", on: true, weight: 5 },
    { key: "family", label: "Familie & kinderen", emoji: "🧸", on: true, weight: 5 },
    { key: "parade", label: "Stoet & processie", emoji: "🥁", on: true, weight: 5 },
    { key: "sport", label: "Sport", emoji: "🏃", on: true, weight: 4 },
    { key: "flea", label: "Rommelmarkt & braderie", emoji: "🛍️", on: true, weight: 4 },
    { key: "shopping", label: "Koopzondag", emoji: "🛒", on: true, weight: 2 },
    { key: "meetings", label: "Raad & commissies", emoji: "🏛️", on: false, weight: 0 },
    { key: "info", label: "Infomomenten & vorming", emoji: "💬", on: false, weight: 1 },
    // "Inspraak": bevragingen, enquêtes, inspraakperiodes en meldingen zonder vast moment (zoals een
    // bevraging over een schoolstraat). Standaard uit, met één klik aan.
    { key: "admin", label: "Inspraak & bevraging", emoji: "🗳️", on: false, weight: 0 },
    { key: "calls", label: "Oproepen & deadlines", emoji: "📣", on: false, weight: 0 },
    { key: "works", label: "Werken & hinder", emoji: "🚧", on: false, weight: 0 },
    { key: "markets", label: "Wekelijkse markten", emoji: "🧺", on: false, weight: 0 },
    { key: "other", label: "Overig", emoji: "✨", on: false, weight: 1 },
  ].map(Object.freeze));
  const BY_KEY = Object.freeze(Object.fromEntries(CATEGORIES.map((c) => [c.key, c])));
  const DEFAULT_ON = Object.freeze(CATEGORIES.filter((c) => c.on).map((c) => c.key));

  const FESTIVAL = /\b([a-z0-9-]*festival|[a-z0-9-]*feesten?|kermis|foor|jaarmarkt|kerstmarkt|wintermarkt|fuif|dansnamiddag|openluchtfuif)\b/;
  const ADMIN = /\b(bevraging|bevragingen|enquete|enquetes|vragenlijst|online inspraak|inspraakperiode|openbaar onderzoek|meldpunt|melding|meldingen|geef je mening|digitale inspraak)\b/;

  function eventTypeOf(item) {
    if (item?.eventType) return item.eventType;
    return root.PublicAgendaEventTypes?.classifyEventType?.(item) || "other";
  }

  // Een gewone weekmarkt (GIPOD-marktdagen van de stad) is geen uitgaansmoment op zich:
  // die worden gebundeld getoond, niet als honderden losse items.
  function isWeeklyMarket(item) {
    if (item?.sourceId === "stad-markten") return true;
    if (eventTypeOf(item) !== "market_fair") return false;
    return !FESTIVAL.test(clean(`${item?.title || ""} ${item?.info || ""}`));
  }

  function hasConcreteMoment(item) {
    const slot = String(item?.timeSlot || "");
    const place = clean(item?.location);
    return /^\d{2}:\d{2}$/.test(slot) && Boolean(place) && !place.includes("locatie via de officiele bron");
  }

  function categoryOf(item = {}) {
    const text = clean([item.title, item.info, item.location].filter(Boolean).join(" · "));
    if (item.theme === "Werken") return "works";
    if (item.theme === "Oproep/deadline") return ADMIN.test(text) ? "admin" : "calls";
    const type = eventTypeOf(item);
    switch (type) {
      case "public_meeting": return "meetings";
      case "administrative": return "admin";
      // Inspraak zonder concreet moment en plaats is een administratieve oproep, geen evenement.
      case "participation": return hasConcreteMoment(item) ? "info" : "admin";
      case "learning": return "info";
      case "neighborhood": case "playstreet": case "social": case "green_action": return "neighborhood";
      case "family": return "family";
      case "sport": return "sport";
      case "flea_braderie": return "flea";
      case "parade": return "parade";
      case "shopping": return "shopping";
      case "market_fair": return isWeeklyMarket(item) ? "markets" : "festival";
      case "culture": case "commemoration": return FESTIVAL.test(text) ? "festival" : "culture";
      case "demonstration": return "other";
      default: return FESTIVAL.test(text) ? "festival" : "other";
    }
  }

  const categoryFor = (key) => BY_KEY[key] || BY_KEY.other;

  // ---- datums (ISO-dagen, zonder tijdzonegokwerk: rekenen op 12 u UTC) ----
  const isoDay = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "");
  function addDays(iso, days) {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  const weekday = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay(); // 0 = zondag

  // Dit weekend = vrijdag t/m zondag van deze week; op zaterdag of zondag vanaf vandaag.
  function weekendRange(today) {
    const day = weekday(today);
    if (day === 0) return { from: today, to: today };
    if (day === 6) return { from: today, to: addDays(today, 1) };
    if (day === 5) return { from: today, to: addDays(today, 2) };
    const friday = addDays(today, 5 - day);
    return { from: friday, to: addDays(friday, 2) };
  }

  function rangesFor(today) {
    return {
      today: { from: today, to: today },
      weekend: weekendRange(today),
      week: { from: today, to: addDays(today, 6) },
      next: { from: addDays(today, 7), to: addDays(today, 13) },
    };
  }

  function overlaps(item, range) {
    const start = isoDay(item?.date);
    if (!start) return false;
    const end = isoDay(item?.endDate) && item.endDate > start ? item.endDate : start;
    return start <= range.to && end >= range.from;
  }

  // Hoe "mooi" een item is voor de bovenrij: leuke soort, in het district, concreet uur en plaats.
  function highlightScore(item) {
    const category = categoryFor(item?.category || categoryOf(item));
    let score = category.weight * 10;
    if (item?.scope !== "stad" || item?.inDistrict === true) score += 30;
    if (hasConcreteMoment(item)) score += 8;
    if (isoDay(item?.endDate) && item.endDate > item.date) score -= 6; // langlopende expo's minder bovenaan
    if (item?.graceStale) score -= 2;
    return score;
  }

  // De mooiste items in een periode: eerst op score kiezen, dan chronologisch tonen.
  function pickHighlights(items, range, limit = 6) {
    const chosen = (items || [])
      // Alleen evenementen: raad, oproepen, werken en weekmarkten (gewicht 0) nooit in de bovenrij.
      .filter((item) => overlaps(item, range) && categoryFor(item.category || categoryOf(item)).weight > 0)
      .map((item) => ({ item, score: highlightScore(item) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || String(a.item.date).localeCompare(String(b.item.date)) || String(a.item.title).localeCompare(String(b.item.title), "nl"))
      .slice(0, limit)
      .map(({ item }) => item);
    return chosen.sort((a, b) => {
      const da = a.date < range.from ? range.from : a.date;
      const db = b.date < range.from ? range.from : b.date;
      return da.localeCompare(db) || String(a.timeSlot || "").localeCompare(String(b.timeSlot || "")) || String(a.title).localeCompare(String(b.title), "nl");
    });
  }

  // ---- wekelijkse markten bundelen ----
  const WEEKDAYS = ["zo", "ma", "di", "wo", "do", "vr", "za"];
  const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
  function bundleWeeklyMarkets(items, today) {
    const groups = new Map();
    for (const item of items || []) {
      if (!isWeeklyMarket(item) || !isoDay(item.date)) continue;
      const key = `${clean(item.title)}|${clean(item.location)}`;
      const group = groups.get(key) || { title: String(item.title || "Markt"), location: String(item.location || ""), days: new Set(), times: new Set(), dates: [], inDistrict: item.inDistrict, link: item.link || "" };
      group.days.add(weekday(item.date));
      if (item.timeText) group.times.add(String(item.timeText));
      group.dates.push(item.date);
      groups.set(key, group);
    }
    return [...groups.values()]
      .map((group) => {
        const upcoming = group.dates.filter((d) => !today || d >= today).sort();
        return {
          title: group.title,
          location: group.location,
          weekdays: WEEKDAY_ORDER.filter((d) => group.days.has(d)).map((d) => WEEKDAYS[d]),
          timeText: [...group.times].slice(0, 2).join(" / "),
          nextDate: upcoming[0] || "",
          count: group.dates.length,
          inDistrict: group.inDistrict,
          link: group.link,
        };
      })
      .sort((a, b) => Number(b.inDistrict === true) - Number(a.inDistrict === true) || a.title.localeCompare(b.title, "nl"));
  }

  // ---- versheid ----
  // stale = de laatste geslaagde verversing is ouder dan limitHours (standaard 48 uur).
  function freshness(generatedAt, nowMs, limitHours = 48) {
    const t = Date.parse(String(generatedAt || ""));
    if (!Number.isFinite(t) || !Number.isFinite(nowMs)) return { known: false, stale: true, ageHours: null, generatedAt: null };
    const ageHours = Math.max(0, (nowMs - t) / HOUR_MS);
    return { known: true, stale: ageHours > limitHours, ageHours, ageDays: Math.floor(ageHours / 24), generatedAt: new Date(t).toISOString() };
  }

  // Alleen bij een achterstand (de laatste verversing is ouder dan 48 uur, `backlog`): een
  // BRONITEM (uit de automatische feed) dat alleen verborgen werd omdat zijn bron niet tijdig
  // opnieuw opgehaald werd, mag binnen graceDays na de laatste bevestiging zichtbaar blijven,
  // gemarkeerd met "Laatst bevestigd". Handmatige items vallen hier nooit onder: die blijven
  // zichtbaar tot en met hun laatste dag. Een verlopen datum, bronconflict of onbevestigde bron
  // blijft verborgen.
  function inStaleGrace(item, nowMs, graceDays = 14, { backlog = true } = {}) {
    if (!backlog || item?.feed !== true) return false;
    if (item?.reviewReason !== "stale_source" || item?.verificationState !== "verified") return false;
    const confirmed = Date.parse(String(item.sourceRetrievedAt || ""));
    return Number.isFinite(confirmed) && Number.isFinite(nowMs) && nowMs - confirmed <= graceDays * DAY_MS;
  }

  root.PublicAgendaUitgaan = Object.freeze({
    categories: CATEGORIES,
    defaultOn: DEFAULT_ON,
    categoryOf,
    categoryFor,
    isWeeklyMarket,
    hasConcreteMoment,
    rangesFor,
    weekendRange,
    overlaps,
    highlightScore,
    pickHighlights,
    bundleWeeklyMarkets,
    freshness,
    inStaleGrace,
    addDays,
  });
})(typeof window !== "undefined" ? window : globalThis);
