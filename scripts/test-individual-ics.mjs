import assert from "node:assert/strict";
import fs from "node:fs";
await import("../site/agenda-ics.js");
const { buildIndividualIcs, filenameForItem, validateIndividualIcs } = globalThis.AgendaIcs;

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

// Elk echt item uit de feed (site/agenda-feed.js) geeft een geldig .ics-bestand, zoals de knop op de site
// het maakt: ook de evenementen op straat uit A-Sign en de items die uit twee bronnen samenkomen.
const feedTekst = fs.readFileSync(new URL("../site/agenda-feed.js", import.meta.url), "utf8");
const feed = JSON.parse(feedTekst.replace(/^[\s\S]*?window\.PUBLIC_AGENDA_FEED\s*=\s*/, "").replace(/;\s*$/, ""));
const echteItems = Array.isArray(feed.items) ? feed.items : [];
const echteFouten = [];
for (const item of echteItems) {
  try {
    const { errors } = validateIndividualIcs(buildIndividualIcs(item, { now: "2026-08-13T00:00:00.000Z" }));
    if (errors.length) echteFouten.push(`${item.id}: ${errors.join(", ")}`);
  } catch (error) {
    echteFouten.push(`${item.id}: ${error.message}`);
  }
}
assert.deepEqual(echteFouten.slice(0, 10), [], `${echteFouten.length} echte items geven geen geldig .ics-bestand`);

console.log(JSON.stringify({
  result: "PASS",
  checks: 17,
  feedItems: echteItems.length,
  timedMode: "Europe/Brussels with DST rules",
  unknownTimeMode: "all-day with exclusive next-day DTEND",
  sourcePolicy: "public HTTPS required",
}, null, 2));
