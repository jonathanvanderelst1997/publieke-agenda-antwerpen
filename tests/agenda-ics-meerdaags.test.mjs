import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../site/agenda-ics.js", import.meta.url), "utf8");
const sandbox = { URL, TextEncoder, Date, console };
vm.runInNewContext(source, sandbox);
const api = sandbox.AgendaIcs;
const now = "2026-10-14T12:00:00Z";
const item = (extra = {}) => ({
  id: "meerdaags-test", title: "Testactiviteit", date: "2026-10-31",
  timeSlot: "Info", location: "Voorbeeldplein", link: "https://www.antwerpen.be/",
  ...extra,
});
const make = (extra = {}, options = {}) => api.buildIndividualIcs(item(extra), { now, ...options });
const expectRange = (ics, first, exclusiveLast) => {
  assert.ok(ics.includes(`DTSTART;VALUE=DATE:${first}\r\n`));
  assert.ok(ics.includes(`DTEND;VALUE=DATE:${exclusiveLast}\r\n`));
  assert.equal(api.validateIndividualIcs(ics).valid, true);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
};

test("meerdaagse activiteit behoudt alle dagen en gebruikt een exclusieve einddag", () => {
  expectRange(make({ endDate: "2026-11-02" }), "20261031", "20261103");
});

test("een losse dag met ontbrekende, lege of gelijke einddatum blijft één dag", () => {
  for (const extra of [{}, { endDate: null }, { endDate: "" }, { endDate: "2026-10-31" }]) {
    expectRange(make(extra), "20261031", "20261101");
  }
});

test("jaarwisseling bewaart de volledige bronperiode", () => {
  expectRange(make({ date: "2026-12-30", endDate: "2027-01-02" }), "20261230", "20270103");
});

test("schrikkeldag blijft inbegrepen zonder lokale tijdzoneverschuiving", () => {
  expectRange(make({ date: "2028-02-28", endDate: "2028-02-29" }), "20280228", "20280301");
});

test("ongeldige of omgekeerde einddatum levert geen misleidend exportbestand", () => {
  for (const endDate of ["2026-10-30", "2026-02-30", "2026-11-31", "geen datum", "2026-11-02T12:00:00Z"]) {
    assert.throws(() => make({ endDate }), /datum/i, endDate);
  }
});

test("vaste starttijd behoudt bestaande standaardduur en expliciete duur", () => {
  const timed = make({ timeSlot: "14:30", endDate: "2026-11-02" });
  assert.ok(timed.includes("DTSTART;TZID=Europe/Brussels:20261031T143000\r\n"));
  assert.ok(timed.includes("DURATION:PT1H\r\n"));
  assert.ok(!timed.includes("DTEND;VALUE=DATE:"));
  assert.ok(make({ timeSlot: "14:30" }, { duration: "PT2H" }).includes("DURATION:PT2H\r\n"));
  assert.equal(api.validateIndividualIcs(timed).valid, true);
});

test("bronlink, identiteit en invoergegevens veranderen niet door de export", () => {
  const input = item({ endDate: "2026-11-02" });
  const original = JSON.stringify(input);
  const ics = api.buildIndividualIcs(input, { now });
  assert.ok(ics.includes("URL:https://www.antwerpen.be/\r\n"));
  assert.ok(ics.includes("UID:meerdaags-test@mijn-publieke-agenda-voor-district.local\r\n"));
  assert.equal(JSON.stringify(input), original);
});
