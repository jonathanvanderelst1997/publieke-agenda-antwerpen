import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadAgendaRuntime } from "../scripts/agenda-source.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtime = loadAgendaRuntime(rootDir);

const hostile = {
  id: "district-kal-aaaaaa-2026-10-10",
  title: "<img src=x onerror=alert(1)>",
  theme: "Activiteit",
  className: "activity",
  date: "2026-10-10",
  dateLabel: "10 oktober 2026",
  timeSlot: "14:00",
  timeText: "<b>14 uur</b>",
  location: "<script>alert(2)</script>",
  info: '"><svg onload=alert(3)>',
  link: "javascript:alert(4)",
  infoUrl: "javascript:alert(5)",
  sources: [{ sourceId: "district-kalender", url: "javascript:alert(6)", retrievedAt: "2026-09-28T05:00:00.000Z", scope: "district" }],
  classification: "future",
  sourcePublisher: "District <i>Antwerpen</i>",
  sourceRetrievedAt: "2026-09-28T05:00:00.000Z",
  scope: "district",
};

test("eventTemplate escapet titel, info, locatie, uur en bron; javascript:-links vallen weg", () => {
  const html = runtime.eventTemplate(hostile);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img|<script|<svg|<b>|<i>/);
  assert.doesNotMatch(html, /javascript:/i);
  assert.match(html, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
  assert.match(html, /&quot;&gt;&lt;svg onload=alert\(3\)&gt;/);
});

test("worksOverviewTemplate escapet ook en laat alleen https-links door", () => {
  const html = runtime.worksOverviewTemplate([{ ...hostile, theme: "Werken" }]);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img|<script|<svg/);
  assert.doesNotMatch(html, /javascript:/i);
  const safe = runtime.worksOverviewTemplate([{ ...hostile, theme: "Werken", link: "https://www.antwerpen.be/info/x" }]);
  assert.match(safe, /href="https:\/\/www\.antwerpen\.be\/info\/x"/);
});

test("safeHref aanvaardt alleen https", () => {
  assert.equal(runtime.safeHref("https://www.antwerpen.be/x"), "https://www.antwerpen.be/x");
  for (const value of ["javascript:alert(1)", "http://www.antwerpen.be/x", "data:text/html,x", " https://a b", "//evil.example/x"]) {
    assert.equal(runtime.safeHref(value), "", value);
  }
});
