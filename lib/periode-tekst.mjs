// Leest een periode zoals de stad ze schrijft: "21 november - 13 december", "4 december – 3 januari",
// "12 – 21 juli", "26-sep", "9 maart - juli 2026", "augustus 2026 - begin 2027",
// "midden mei tot midden augustus 2026", "18 mei t/m 9 juni 2026", "22.10.2025 - 5.11.2025".
// Puur: geen klok, geen netwerk. Elke twijfel geeft null (niet publiceren).
//
// Een grens zonder jaar erft het jaar van de andere grens; heeft geen van beide een jaar, dan geldt
// refYear (alleen als de aanroeper dat meegeeft, zoals bij de foorlijst). Ligt het einde vóór het begin,
// dan loopt de periode over de jaargrens: "4 december – 3 januari" eindigt in het volgende jaar.
//
// Vage grenzen ("juli 2026", "begin 2027", "voorjaar 2027") worden de ruimste dag van die periode:
// als begin de eerste dag, als einde de laatste. exact zegt of beide grenzen een echte dag waren.

const MONTHS = Object.freeze({
  jan: 1, januari: 1, feb: 2, febr: 2, februari: 2, mrt: 3, maart: 3, apr: 4, april: 4, mei: 5,
  jun: 6, juni: 6, jul: 7, juli: 7, aug: 8, augustus: 8, sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10, nov: 11, november: 11, dec: 12, december: 12,
});
const MONTH = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
const WEEKDAY = "(?:maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|ma|di|wo|woe|do|vr|za|zo)\\.?";
// Seizoenen: [beginmaand, begindag, eindmaand, einddag]. "winter" valt bewust weg (twee jaren).
const SEASONS = Object.freeze({ voorjaar: [3, 21, 6, 20], lente: [3, 21, 6, 20], zomer: [6, 21, 9, 22], najaar: [9, 23, 12, 20], herfst: [9, 23, 12, 20] });

const pad = (value) => String(value).padStart(2, "0");
const lastDay = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

function iso(year, month, day) {
  if (!year || !month || !day || day > lastDay(year, month)) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

// Eén grens. Geeft { day, month, year, fuzzy } of null. day/month mogen ontbreken (geërfd of vaag).
// fuzzy: null voor een echte dag, anders { start: [maand, dag], end: [maand, dag] } of het soort.
function parseBound(raw) {
  const text = raw
    .replace(new RegExp(`^${WEEKDAY}\\s+`, "i"), "")
    .replace(/^(?:in\s+)?(?:het\s+)?/i, "")
    .replace(/\s+van\s+(20\d{2})$/i, " $1")
    .trim();
  let match = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(text);
  if (match) return { day: Number(match[3]), month: Number(match[2]), year: Number(match[1]), fuzzy: null };
  match = new RegExp(`^(\\d{1,2})(?:\\s+(${MONTH})\\.?)?(?:\\s+(20\\d{2}))?$`, "i").exec(text);
  if (match) return { day: Number(match[1]), month: match[2] ? MONTHS[match[2].toLowerCase()] : null, year: match[3] ? Number(match[3]) : null, fuzzy: null };
  match = new RegExp(`^(?:(begin|eind|einde|midden|half|medio)\\s+)?(${MONTH})\\.?(?:\\s+(20\\d{2}))?$`, "i").exec(text);
  if (match) return { day: null, month: MONTHS[match[2].toLowerCase()], year: match[3] ? Number(match[3]) : null, fuzzy: (match[1] || "maand").toLowerCase() };
  match = /^(begin|eind|einde|midden|medio)\s+(20\d{2})$/i.exec(text);
  if (match) return { day: null, month: null, year: Number(match[2]), fuzzy: `jaar-${match[1].toLowerCase()}` };
  match = /^(voorjaar|lente|zomer|najaar|herfst)\s+(20\d{2})$/i.exec(text);
  if (match) return { day: null, month: null, year: Number(match[2]), fuzzy: `seizoen-${match[1].toLowerCase()}` };
  return null;
}

// Vaste dag voor een grens: role "start" geeft de vroegste dag, "end" de laatste.
function resolve(bound, year, role) {
  const start = role === "start";
  if (!bound.fuzzy) return iso(year, bound.month, bound.day);
  if (bound.fuzzy.startsWith("seizoen-")) {
    const [m1, d1, m2, d2] = SEASONS[bound.fuzzy.slice(8)];
    return start ? iso(year, m1, d1) : iso(year, m2, d2);
  }
  if (bound.fuzzy.startsWith("jaar-")) {
    const kind = bound.fuzzy.slice(5);
    if (kind === "begin") return start ? iso(year, 1, 1) : iso(year, 3, 31);
    if (kind === "midden" || kind === "medio") return start ? iso(year, 5, 1) : iso(year, 8, 31);
    return start ? iso(year, 10, 1) : iso(year, 12, 31);
  }
  const month = bound.month;
  if (bound.fuzzy === "begin") return start ? iso(year, month, 1) : iso(year, month, 10);
  if (["midden", "half", "medio"].includes(bound.fuzzy)) return start ? iso(year, month, 10) : iso(year, month, 20);
  if (bound.fuzzy === "eind" || bound.fuzzy === "einde") return start ? iso(year, month, 20) : iso(year, month, lastDay(year, month));
  return start ? iso(year, month, 1) : iso(year, month, lastDay(year, month));
}

// Volgorde binnen een jaar, om de jaargrens te herkennen (een seizoen of jaarvaagte telt als zijn begin).
function orderKey(bound) {
  if (bound.month) return bound.month * 100 + (bound.day ?? 1);
  if (bound.fuzzy?.startsWith("seizoen-")) return SEASONS[bound.fuzzy.slice(8)][0] * 100;
  return 0;
}

export function normalizePeriodText(value) {
  return String(value ?? "")
    .replace(/&nbsp;|[  ]/g, " ")
    .replace(/[–—‒]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[.;,\s]+$/, "")
    .trim();
}

// Geeft { start, end, exact } of null. Een "+" (twee losse perioden) leest de aanroeper zelf.
export function parsePeriodText(value, { refYear = null } = {}) {
  let text = normalizePeriodText(value).toLowerCase();
  if (!text || text.includes("+")) return null;
  // Cijferdata "22.10.2025" of "19.11-2025" (tikfout in de bron) worden eerst "2025/10/22", zonder
  // streepje, zodat het streepje daarna alleen nog de twee grenzen scheidt.
  text = text.replace(/\b(\d{1,2})[./](\d{1,2})[./-](20\d{2})\b/g, (whole, d, m, y) => iso(Number(y), Number(m), Number(d))?.replaceAll("-", "/") ?? whole);
  // Foorlijst: "26-sep", "14-jun".
  text = text.replace(new RegExp(`\\b(\\d{1,2})-(${MONTH})\\b`, "gi"), "$1 $2");
  const bounds = text.split(/\s+(?:tot\s+en\s+met|t\/m|t\.e\.m\.?|tot)\s+|\s*-\s*/i).map((part) => part.trim());
  if (bounds.length < 1 || bounds.length > 2 || bounds.some((part) => !part)) return null;
  const first = parseBound(bounds[0]);
  const second = bounds.length === 2 ? parseBound(bounds[1]) : first;
  if (!first || !second) return null;
  // Een dag zonder maand ("12 – 21 juli") erft de maand van rechts.
  if (first.day && !first.month && !first.fuzzy) first.month = second.month;
  if (!first.month && !first.fuzzy) return null;
  if (second.day && !second.month) return null;
  let startYear = first.year ?? null;
  let endYear = second.year ?? null;
  if (startYear === null && endYear === null) {
    if (!Number.isInteger(refYear)) return null;
    startYear = refYear;
  }
  if (startYear === null) startYear = orderKey(first) > orderKey(second) ? endYear - 1 : endYear;
  if (endYear === null) endYear = orderKey(second) < orderKey(first) ? startYear + 1 : startYear;
  const start = resolve(first, startYear, "start");
  const end = resolve(second, endYear, "end");
  if (!start || !end || end < start) return null;
  return { start, end, exact: !first.fuzzy && !second.fuzzy };
}

// Eén datum ("28 augustus 2026", "6.5.2024"), vaag of niet, als begin of als einde.
export function parseDateBound(value, role = "start", { refYear = null } = {}) {
  const period = parsePeriodText(value, { refYear });
  if (!period) return null;
  return { date: role === "end" ? period.end : period.start, exact: period.exact };
}
