import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../site/bron-waarschuwing.js", import.meta.url), "utf8");
const context = { window: {} };
vm.runInNewContext(src, context);
const summarize = context.window.PUBLIC_AGENDA_SOURCE_WARNING.samenvatting;
const entry = (id, status, state) => ({ sourceId: id, fetchStatus: status, state });

test("verse bronnen tonen geen bronalarm, ook zonder extra dataverwerking", () => {
  const x = summarize([entry("district-kalender", "ok", "fresh"), entry("district-nieuws", "ok", "empty")]);
  assert.equal(x.kind, "ok");
  assert.equal(x.total, 0);
});
test("tijdelijk onbereikbare bron met geldige cache krijgt tijdelijke waarschuwing", () => {
  const x = summarize([entry("district-ebesluit", "error", "fresh")]);
  assert.equal(x.kind, "temporary");
  assert.equal(x.expired, 0);
  assert.equal(x.temporary, 1);
});
test("beide eBesluit-bronnen voorbij 48 uur worden niet als groen beschouwd", () => {
  const x = summarize([entry("district-ebesluit", "error", "stale"), entry("district-ebesluit-evenementen", "error", "stale")]);
  assert.equal(x.kind, "expired");
  assert.equal(x.expired, 2);
  assert.equal(x.total, 2);
});
test("oude bron zonder expliciete HTTP-fout blijft zichtbaar als verouderd", () => {
  assert.equal(summarize([entry("district-kalender", "ok", "stale")]).kind, "expired");
});
test("ontbrekende UiT-sleutel is apart inactief, geen HTTP-fout", () => {
  assert.equal(summarize([entry("stad-uit", "skipped_no_key", "inactive")]).kind, "ok");
});
test("gemengde gezonde, inactieve en falende bron telt zonder dubbeling", () => {
  const x = summarize([entry("a", "error", "stale"), entry("b", "error", "fresh"), entry("c", "ok", "fresh"), entry("d", "skipped_no_key", "inactive")]);
  assert.equal(x.total, 2); assert.equal(x.expired, 1); assert.equal(x.temporary, 1);
});
test("onbekende bronstatus wordt niet als bewezen gezond voorgesteld", () => {
  assert.equal(summarize([]).kind, "unknown");
  assert.equal(summarize(null).kind, "unknown");
  assert.equal(summarize([entry("district-ebesluit", "error", undefined)]).kind, "expired");
});
test("browser laadt waarschuwing voor agenda en toont bronmelding buiten ingeklapte details", () => {
  const html = fs.readFileSync(new URL("../site/index.html", import.meta.url), "utf8");
  const script = fs.readFileSync(new URL("../site/agenda.js", import.meta.url), "utf8");
  assert.ok(html.indexOf('src="/bron-waarschuwing.js"') < html.indexOf('src="/agenda.js"'));
  assert.match(html, /id="agenda-source-warning"[^>]*role="status"/);
  assert.match(script, /function renderBronWaarschuwing\(/);
  assert.match(script, /renderBronWaarschuwing\(\);\s*if \(!banner\)/);
  assert.match(script, /details\.open = true/);
});
