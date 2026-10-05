import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createAgendaView, sameStreet, streetId, agendaTheme, VIEW_THEMES, DEFAULT_THEMES, settleSources } from "../site/agenda-view.js";
const a = { id:"1", name:"Nationalestraat", postcode:"2000" };
const b = { id:"2", name:"Lange Nationalestraat", postcode:"2000" };
const item = { streets:[a], title:"Werk" };
test("official id and postcode discriminate similar streets", () => {
  assert.equal(sameStreet(a, b), false);
  assert.equal(sameStreet(a, { ...a, postcode:"2018" }), false);
  assert.equal(sameStreet(a, { ...a }), true);
  assert.equal(sameStreet({}, {}), false);
});
test("accent-normalized exact names only when ids are absent", () => {
  assert.equal(sameStreet({ name:"Caféstraat" }, { name:"cafestraat" }), true);
  assert.equal(sameStreet({ name:"Meir" }, { name:"Meirbrug" }), false);
});
test("no street selection keeps records with unresolved locations", () => {
  const view = createAgendaView();
  assert.equal(view.matches({}, "works"), true);
});
test("partial and unknown street queries fail closed", () => {
  const view = createAgendaView(); view.setStreet("Nationale");
  assert.equal(view.matches(item, "works"), false);
  view.setStreet("Nationalestraat", a);
  assert.equal(view.matches(item, "works"), true);
  assert.equal(view.matches({ streets:[b] }, "works"), false);
  assert.equal(view.matches({ title:"Nationalestraat" }, "works"), false);
});
test("only the address resolver connects unstructured agenda locations", () => {
  const view = createAgendaView({ resolveAddress: value => value === "Nationalestraat 10, 2000 Antwerpen" ? [a] : [] });
  view.setStreet("Nationalestraat", a);
  assert.equal(view.matchesAgenda({ location:"Nationalestraat 10, 2000 Antwerpen" }), true);
  assert.equal(view.matchesAgenda({ title:"Nationalestraat", location:"onbekend" }), false);
});
test("theme and street filters intersect for all live layers", () => {
  const view = createAgendaView(); view.setStreet("Nationalestraat", a); view.setThemes(["works"]);
  assert.equal(view.matches(item, "works"), true);
  for (const theme of ["publicSpace", "permits", "terraces"]) assert.equal(view.matches(item, theme), false);
  view.setThemes(["permits"]);
  assert.equal(view.matches(item, "terraces"), true);
  assert.equal(view.matches(item, "permits"), true);
});
test("empty theme selection remains empty; unknown parameters cannot enable data", () => {
  const view = createAgendaView(); view.setThemes(["garbage"]);
  assert.equal(view.matches(item, "works"), false);
  assert.equal(view.matchesAgenda({}), false);
  assert.equal(view.themes.size, 0);
});
test("neighborhood and playstreet events retain explicit toggles", () => {
  assert.equal(agendaTheme({ eventType:"neighborhood" }), "neighborhood");
  assert.equal(agendaTheme({ eventType:"playstreet" }), "neighborhood");
  const view = createAgendaView(); view.setThemes(["neighborhood"]);
  assert.equal(view.matchesAgenda({ eventType:"neighborhood" }), true);
  assert.equal(view.matchesAgenda({ eventType:"culture" }), false);
});
test("markets, meetings and works are not hidden inside general activities", () => {
  assert.equal(agendaTheme({ sourceId:"stad-markten" }), "markets");
  // Rommelmarkten zijn uitgaan (standaard aan); alleen de gewone weekmarkten zitten onder "markets".
  assert.equal(agendaTheme({ eventType:"flea_braderie" }), "flea");
  assert.equal(agendaTheme({ sourceId:"district-vergaderingen" }), "meetings");
  assert.equal(agendaTheme({ theme:"Werken" }), "works");
  assert.equal(agendaTheme({ theme:"Sport" }), "sport");
});
test("reset can restore all themes without mutating input records", () => {
  const copy = JSON.stringify(item); const view = createAgendaView();
  view.setStreet("x"); view.setThemes([]); view.setStreet(""); view.setThemes(VIEW_THEMES.map(([key]) => key));
  assert.equal(view.matches(item,"works"),true); assert.equal(JSON.stringify(item),copy);
  const themes = view.themes; themes.clear(); assert.equal(view.enabled("works"),true);
  assert.equal(streetId(a), "1|Nationalestraat|2000");
});
const root = new URL("../site/", import.meta.url);
for (const [file, method] of [["agenda.js","matchesAgenda"],["works-live.js","matches"],["public-space-live.js","matches"],["permits-live.js","matches"],["terraces-live.js","matches"],["street-overview.js","matches"]]) {
  test(`${file} observes the common filter without changing source requests`, () => {
    const code = fs.readFileSync(new URL(file,root),"utf8");
    assert.ok(code.includes("PUBLIC_AGENDA_VIEW")); assert.ok(code.includes(method));
    assert.ok(code.includes("public-agenda:view-change") || code.includes("public-agenda:agenda-view"));
  });
}
test("public-space Promise failures are settled per source, never array.catch", async () => {
  const code = fs.readFileSync(new URL("public-space-live.js",root),"utf8");
  assert.ok(!code.includes("[name,await p].catch"));
  assert.ok(code.includes("const settled=await settleSources(jobs);"));
  const rows = await settleSources([["good",Promise.resolve([1])],["bad",Promise.reject(new Error("offline"))]]);
  assert.deepEqual(rows[0],["good",[1]]); assert.equal(rows[1][1].message,"offline");
});
test("standaard uitgaan & evenementen; raad, werken, weekmarkten en lagen met één klik", () => {
  const view = createAgendaView({ defaultThemes: DEFAULT_THEMES });
  assert.equal(view.matchesAgenda({ title:"Buurtfeest", eventType:"neighborhood" }), true);
  assert.equal(view.matchesAgenda({ title:"Districtsraad", sourceId:"district-vergaderingen" }), false);
  assert.equal(view.matchesAgenda({ title:"Gemengde markt", sourceId:"stad-markten" }), false);
  assert.equal(view.matchesAgenda({ title:"Werk", theme:"Werken" }), false);
  assert.equal(view.matchesAgenda({ title:"Bevraging schoolstraat" }), false);
  for (const layer of ["works", "publicSpace", "permits", "terraces"]) assert.equal(view.enabled(layer), false);
  view.setThemes([...DEFAULT_THEMES, "meetings"]);
  assert.equal(view.matchesAgenda({ title:"Districtsraad", sourceId:"district-vergaderingen" }), true);
  assert.ok(VIEW_THEMES.length > DEFAULT_THEMES.length);
});
