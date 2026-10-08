import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { allesFilterActie } from "../site/filter-action-ux.js";

test("de knop zegt vooraf wat hij zal doen, met en zonder gekozen straat", () => {
  assert.equal(allesFilterActie(2, 7, false), "Alle onderwerpen tonen");
  assert.equal(allesFilterActie(7, 7, false), "Terug naar uitgaan");
  assert.equal(allesFilterActie(7, 7, true), "Alle onderwerpen verbergen");
  assert.equal(allesFilterActie(0, 7, true), "Alle onderwerpen tonen");
});

test("mobiele filters geven een zichtbare scrolltip en grotere aanraakdoelen", async () => {
  const css = await readFile(new URL("../site/place-view.css", import.meta.url), "utf8");
  const js = await readFile(new URL("../site/place-view.js", import.meta.url), "utf8");
  assert.match(css, /\.pv-group-scroll-hint\s*\{[^}]*display:\s*none/);
  assert.match(css, /@media\s*\(max-width:\s*640px\)[\s\S]*\.pv-group-scroll-hint\s*\{[^}]*display:\s*block/);
  assert.match(css, /\.pv-chip\s*\{[^}]*min-height:\s*44px/);
  assert.match(css, /\.pv-nav button\s*\{[^}]*min-height:\s*44px/);
  assert.match(css, /\.pv-seg button\s*\{[^}]*min-height:\s*44px/);
  assert.match(js, /Veeg horizontaal om meer onderwerpen te zien/);
});

test("toetsenbord Escape gebruikt dezelfde herstelactie als de wissenknop en focus is zichtbaar", async () => {
  const js = await readFile(new URL("../site/place-view.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../site/place-view.css", import.meta.url), "utf8");
  assert.match(js, /else if \(search\.value\) clearBtn\.click\(\)/);
  assert.match(css, /\.pv-head h2:focus\s*\{[^}]*outline:\s*3px solid/);
  assert.match(js, /class="pv-sub" aria-live="polite"/);
});
