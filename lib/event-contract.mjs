import { createHash } from "node:crypto";

export const EVENT_TIME_ZONE = "Europe/Brussels";
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{4,199}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function clean(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export function normalized(value) {
  return clean(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function validDate(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function parseEventTimes(timeSlot, timeText = "") {
  const slot = clean(timeSlot);
  const text = clean(timeText).replaceAll(".", ":");
  const startTime = TIME_PATTERN.test(slot) ? slot : null;
  if (!startTime) return { startTime: null, endTime: null, status: "unconfirmed" };
  const ranges = [...text.matchAll(/\b(2[0-3]|[01]?\d)(?::([0-5]\d))?\s*(?:uur)?\s*(?:tot|[-–])\s*(2[0-3]|[01]?\d)(?::([0-5]\d))?\b/gi)];
  if (!ranges.length) return { startTime, endTime: null, status: "start_confirmed" };
  const match = ranges[0];
  const detectedStart = `${String(Number(match[1])).padStart(2, "0")}:${match[2] || "00"}`;
  const endTime = `${String(Number(match[3])).padStart(2, "0")}:${match[4] || "00"}`;
  return { startTime: detectedStart || startTime, endTime, status: "range_confirmed" };
}

// De fasen van een item ({ naam, start, eind }), of null als er één ongeldig is.
export function phasesOf(value) {
  if (!Array.isArray(value)) return null;
  const fasen = value.map((fase) => ({ naam: clean(fase?.naam), start: clean(fase?.start), eind: clean(fase?.eind) }));
  return fasen.every((fase) => fase.naam && validDate(fase.start) && validDate(fase.eind) && fase.start <= fase.eind) ? fasen : null;
}

export function deriveStableEventId(event) {
  const signature = [event.title, event.date, parseEventTimes(event.timeSlot, event.timeText).startTime || "unknown", event.location]
    .map(normalized).join("|");
  const slug = normalized(event.title).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "event";
  return `${slug}-${event.date}-${createHash("sha256").update(signature).digest("hex").slice(0, 10)}`;
}

export function toAccessibleEventTitle(event, times = parseEventTimes(event.timeSlot, event.timeText)) {
  const when = clean(event.dateLabel) || event.date;
  const time = clean(event.timeText) || times.startTime || "tijdstip nog te bevestigen";
  return [clean(event.title), when, time, clean(event.location)].filter(Boolean).join(", ");
}

export function validateEventContract(events, { timeZone = EVENT_TIME_ZONE } = {}) {
  const errors = [];
  const warnings = [];
  if (timeZone !== EVENT_TIME_ZONE) errors.push({ code: "invalid_timezone", index: null });
  if (!Array.isArray(events)) return { ok: false, errors: [{ code: "events_not_array", index: null }], warnings, events: [] };
  const idIndexes = new Map();
  const signatureIndexes = new Map();
  const normalizedEvents = events.map((event, index) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      errors.push({ code: "invalid_event", index });
      return null;
    }
    const id = clean(event.id);
    const title = clean(event.title);
    const location = clean(event.location);
    const date = clean(event.date);
    const times = parseEventTimes(event.timeSlot, event.timeText);
    if (!ID_PATTERN.test(id)) errors.push({ code: "invalid_stable_id", index, id });
    if (!title) errors.push({ code: "missing_title", index, id });
    if (!location) errors.push({ code: "missing_location", index, id });
    if (!validDate(date)) errors.push({ code: "invalid_date", index, id });
    if (times.startTime && times.endTime && times.endTime <= times.startTime) errors.push({ code: "end_not_after_start", index, id });
    if (!times.startTime) warnings.push({ code: "unconfirmed_start", index, id });
    // Een evenement op straat (district-asign-evenementen) draagt de fasen van zijn dossier: opbouw,
    // evenement, afbraak. Elke fase heeft een naam en een geldige periode; de dag van het item hoort
    // er normaal binnen te liggen (een handfiche kan een andere dag noemen: dan een waarschuwing).
    if ("fasen" in event) {
      const fasen = phasesOf(event.fasen);
      if (!fasen) errors.push({ code: "invalid_phases", index, id });
      else if (fasen.length && validDate(date) && !fasen.some((fase) => fase.start <= date && date <= fase.eind)) warnings.push({ code: "date_outside_phases", index, id });
    }
    if ("straten" in event && (!Array.isArray(event.straten) || !event.straten.every((straat) => clean(straat) && clean(straat).length <= 120))) errors.push({ code: "invalid_streets", index, id });
    if (idIndexes.has(id)) errors.push({ code: "duplicate_id", index, id, firstIndex: idIndexes.get(id) });
    else idIndexes.set(id, index);
    const signature = [normalized(title), date, times.startTime || "unknown", normalized(location)].join("|");
    if (signatureIndexes.has(signature)) errors.push({ code: "duplicate_event", index, id, firstIndex: signatureIndexes.get(signature) });
    else signatureIndexes.set(signature, index);
    return {
      ...event,
      id,
      title,
      date,
      location,
      startTime: times.startTime,
      endTime: times.endTime,
      timeStatus: times.status,
      timeZone,
      accessibleTitle: toAccessibleEventTitle(event, times),
    };
  }).filter(Boolean);
  return { ok: errors.length === 0, errors, warnings, events: normalizedEvents };
}
