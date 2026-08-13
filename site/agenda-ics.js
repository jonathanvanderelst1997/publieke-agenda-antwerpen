(function exposeAgendaIcs(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AgendaIcs = api;
})(typeof globalThis === "object" ? globalThis : this, function createAgendaIcsApi() {
  const encoder = new TextEncoder();
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

  function assertCalendarDate(value) {
    if (!datePattern.test(String(value || ""))) throw new Error("Agenda-item mist een geldige ISO-datum.");
    const [year, month, day] = value.split("-").map(Number);
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (
      probe.getUTCFullYear() !== year
      || probe.getUTCMonth() + 1 !== month
      || probe.getUTCDate() !== day
    ) throw new Error("Agenda-item bevat een onmogelijke kalenderdatum.");
    return value;
  }

  function addOneDay(value) {
    const [year, month, day] = assertCalendarDate(value).split("-").map(Number);
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  }

  function escapeText(value) {
    return String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/\r\n|\r|\n/g, "\\n")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,");
  }

  function foldLine(line) {
    const physicalLines = [];
    let current = "";
    let capacity = 75;
    for (const character of line) {
      const next = `${current}${character}`;
      if (encoder.encode(next).length > capacity && current) {
        physicalLines.push(current);
        current = character;
        capacity = 74;
      } else {
        current = next;
      }
    }
    physicalLines.push(current);
    return physicalLines.map((value, index) => `${index ? " " : ""}${value}`).join("\r\n");
  }

  function compactDate(value) {
    return value.replace(/-/g, "");
  }

  function stamp(value) {
    const date = value instanceof Date ? value : new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) throw new Error("Ongeldig exporttijdstip.");
    return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  }

  function sourceUrl(item) {
    const source = new URL(String(item.link || ""));
    if (source.protocol !== "https:") throw new Error("Agenda-export vereist een publieke HTTPS-bron.");
    return source;
  }

  function isTimed(item) {
    return timePattern.test(String(item.timeSlot || ""));
  }

  function uidForItem(item) {
    const safeId = String(item.id || "").trim().replace(/[^a-zA-Z0-9._-]/g, "-");
    if (!safeId) throw new Error("Agenda-item mist een stabiele ID.");
    return `${safeId}@mijn-publieke-agenda-voor-district.local`;
  }

  function filenameForItem(item) {
    const safeTitle = String(item.title || "agenda-item")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 56);
    return `${item.date}-${safeTitle || "agenda-item"}.ics`;
  }

  function buildIndividualIcs(item, options = {}) {
    if (!item || typeof item !== "object") throw new Error("Agenda-item ontbreekt.");
    if (!String(item.title || "").trim()) throw new Error("Agenda-item mist een titel.");
    const date = assertCalendarDate(item.date);
    const source = sourceUrl(item);
    const timed = isTimed(item);
    const lines = [
      "BEGIN:VCALENDAR",
      "PRODID:-//Mijn Publieke Agenda District Antwerpen//NL",
      "VERSION:2.0",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:Mijn publieke agenda District Antwerpen",
      "X-WR-TIMEZONE:Europe/Brussels",
    ];

    if (timed) {
      lines.push(
        "BEGIN:VTIMEZONE",
        "TZID:Europe/Brussels",
        "X-LIC-LOCATION:Europe/Brussels",
        "BEGIN:DAYLIGHT",
        "TZOFFSETFROM:+0100",
        "TZOFFSETTO:+0200",
        "TZNAME:CEST",
        "DTSTART:19700329T020000",
        "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
        "END:DAYLIGHT",
        "BEGIN:STANDARD",
        "TZOFFSETFROM:+0200",
        "TZOFFSETTO:+0100",
        "TZNAME:CET",
        "DTSTART:19701025T030000",
        "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
        "END:STANDARD",
        "END:VTIMEZONE",
      );
    }

    const description = [item.info, item.timeText, `Bron: ${source.href}`].filter(Boolean).join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uidForItem(item)}`,
      `DTSTAMP:${stamp(options.now)}`,
      `SUMMARY:${escapeText(item.title)}`,
      `DESCRIPTION:${escapeText(description)}`,
      `LOCATION:${escapeText(item.location)}`,
      `URL:${source.href}`,
      `CATEGORIES:${escapeText(item.theme || "Publieke agenda")}`,
      "STATUS:CONFIRMED",
      "TRANSP:OPAQUE",
      `X-AGENDA-SOURCE-DOMAIN:${source.hostname}`,
    );

    if (timed) {
      const compactTime = item.timeSlot.replace(":", "");
      lines.push(
        `DTSTART;TZID=Europe/Brussels:${compactDate(date)}T${compactTime}00`,
        `DURATION:${options.duration || "PT1H"}`,
      );
    } else {
      lines.push(
        `DTSTART;VALUE=DATE:${compactDate(date)}`,
        `DTEND;VALUE=DATE:${compactDate(addOneDay(date))}`,
      );
    }
    lines.push("END:VEVENT", "END:VCALENDAR");
    return `${lines.map(foldLine).join("\r\n")}\r\n`;
  }

  function validateIndividualIcs(contents) {
    const physicalLines = String(contents || "").split("\r\n");
    const unfolded = contents.replace(/\r\n[ \t]/g, "");
    const errors = [];
    if (!contents.endsWith("\r\n")) errors.push("missing-final-crlf");
    if (/(^|[^\r])\n/.test(contents)) errors.push("non-crlf-line-ending");
    if (physicalLines.some((line) => encoder.encode(line).length > 75)) errors.push("line-over-75-octets");
    if (!unfolded.startsWith("BEGIN:VCALENDAR\r\n")) errors.push("missing-calendar-start");
    if (!unfolded.endsWith("END:VCALENDAR\r\n")) errors.push("missing-calendar-end");
    if ((unfolded.match(/BEGIN:VEVENT/g) || []).length !== 1) errors.push("not-exactly-one-event");
    if (!/\r\nUID:[^\r\n]+\r\n/.test(unfolded)) errors.push("missing-uid");
    if (!/\r\nDTSTAMP:\d{8}T\d{6}Z\r\n/.test(unfolded)) errors.push("missing-dtstamp");
    if (!/\r\nDTSTART(?:;[^:]*)?:\d{8}(?:T\d{6})?\r\n/.test(unfolded)) errors.push("missing-dtstart");
    if (!/\r\nURL:https:\/\/[^\r\n]+\r\n/.test(unfolded)) errors.push("missing-https-source");
    return { valid: errors.length === 0, errors, physicalLineCount: physicalLines.length - 1 };
  }

  function downloadIndividualIcs(item) {
    const contents = buildIndividualIcs(item);
    const validation = validateIndividualIcs(contents);
    if (!validation.valid) throw new Error(`Agenda-export faalde validatie: ${validation.errors.join(", ")}`);
    const blob = new Blob([contents], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filenameForItem(item);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    return validation;
  }

  return {
    buildIndividualIcs,
    downloadIndividualIcs,
    filenameForItem,
    validateIndividualIcs,
  };
});
