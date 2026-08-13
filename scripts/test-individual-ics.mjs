import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildIndividualIcs, filenameForItem, validateIndividualIcs } = require("../site/agenda-ics.js");

const timed = {
  id: "poetische-rimpelingen-2026-10-10",
  title: "Poëtische Rimpelingen, slot",
  theme: "Activiteit",
  date: "2026-10-10",
  timeSlot: "14:00",
  timeText: "14 tot 16 uur",
  location: "Regatta; Linkeroever",
  info: "Publiek programma\nControleer de bron.",
  link: "https://www.antwerpen.be/agenda?id=42",
};
const timedIcs = buildIndividualIcs(timed, { now: "2026-08-13T00:00:00.000Z" });
assert.deepEqual(validateIndividualIcs(timedIcs).errors, []);
assert.match(timedIcs, /DTSTART;TZID=Europe\/Brussels:20261010T140000/);
assert.match(timedIcs, /BEGIN:VTIMEZONE/);
assert.match(timedIcs.replace(/\r\n /g, ""), /SUMMARY:Poëtische Rimpelingen\\, slot/);
assert.match(timedIcs.replace(/\r\n /g, ""), /LOCATION:Regatta\\; Linkeroever/);

const allDay = {
  ...timed,
  id: "werken-zonder-uur-2026-08-31",
  title: "Werken zonder bevestigd uur",
  date: "2026-08-31",
  timeSlot: "Uur volgt",
  timeText: "",
};
const allDayIcs = buildIndividualIcs(allDay, { now: "2026-08-13T00:00:00.000Z" });
assert.deepEqual(validateIndividualIcs(allDayIcs).errors, []);
assert.match(allDayIcs, /DTSTART;VALUE=DATE:20260831/);
assert.match(allDayIcs, /DTEND;VALUE=DATE:20260901/);
assert.doesNotMatch(allDayIcs, /BEGIN:VTIMEZONE/);

const longUnicode = buildIndividualIcs({
  ...timed,
  id: "lange-unicode-regel",
  title: "Één bijzonder lange titel met veel tekens voor veilige kalenderregelvouw en controle",
}, { now: "2026-08-13T00:00:00.000Z" });
assert.ok(longUnicode.split("\r\n").every((line) => new TextEncoder().encode(line).length <= 75));
assert.deepEqual(validateIndividualIcs(longUnicode).errors, []);

assert.throws(() => buildIndividualIcs({ ...timed, date: "2026-02-30" }), /onmogelijke/);
assert.throws(() => buildIndividualIcs({ ...timed, link: "http://example.test" }), /HTTPS/);
assert.equal(filenameForItem(timed), "2026-10-10-poetische-rimpelingen-slot.ics");

console.log(JSON.stringify({
  result: "PASS",
  checks: 16,
  timedMode: "Europe/Brussels with DST rules",
  unknownTimeMode: "all-day with exclusive next-day DTEND",
  sourcePolicy: "public HTTPS required",
}, null, 2));
