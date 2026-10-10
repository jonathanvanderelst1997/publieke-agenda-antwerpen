// Opmaak op een gsm en toegankelijkheid van de plekweergave (herstelplan O8 en O9).
// Deze toetsen lezen de stijl en de sjablonen; tests/e2e/gsm-opmaak.e2e.mjs meet hetzelfde in Chromium.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../site/place-view.css", import.meta.url), "utf8");
const js = await readFile(new URL("../site/place-view.js", import.meta.url), "utf8");
const index = await readFile(new URL("../site/index.html", import.meta.url), "utf8");

// De regels binnen één @media-blok (zonder geneste blokken).
function mediaBlok(query) {
  const start = css.indexOf(`@media (${query}) {`);
  assert.ok(start >= 0, `@media (${query}) ontbreekt`);
  let diepte = 0;
  for (let i = css.indexOf("{", start); i < css.length; i += 1) {
    if (css[i] === "{") diepte += 1;
    if (css[i] === "}" && --diepte === 0) return css.slice(start, i + 1);
  }
  return "";
}
const regel = (bron, selector) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...bron.matchAll(new RegExp(`(?:^|[}\\n])\\s*${esc}\\s*\\{([^}]*)\\}`, "g"))].map((m) => m[1]).join(";");
};

test("op een gsm staan de labels boven de waarden: geen waardekolom van 110 px", () => {
  const smal = mediaBlok("max-width: 520px");
  assert.match(regel(smal, ".pv-detail dl"), /display:\s*block/);
  assert.match(regel(smal, ".pv-detail dl div"), /display:\s*block/);
});

test("geen woordbreuk midden in een woord: nergens overflow-wrap: anywhere", () => {
  assert.doesNotMatch(css, /overflow-wrap:\s*anywhere/);
  for (const selector of [".pv-place-name", ".pv-row-title", ".pv-row-summary", ".pv-detail dd"]) {
    assert.match(regel(css, selector), /overflow-wrap:\s*break-word/, selector);
  }
});

test("de straatnaam krijgt op een gsm de volle breedte; de knoppen staan eronder", () => {
  const gsm = mediaBlok("max-width: 640px");
  assert.match(regel(gsm, ".pv-place-top"), /flex-direction:\s*column/);
  assert.doesNotMatch(regel(gsm, ".pv-place-top"), /nowrap/);
});

test("de tijdkolom is minstens 5em breed, ook op een gsm, en de weekkop volgt", () => {
  const breedtes = [...css.matchAll(/\.(pv-row-btn|pv-week-head)\s*\{[^}]*grid-template-columns:\s*([\d.]+)em/g)].map((m) => [m[1], Number(m[2])]);
  assert.ok(breedtes.length >= 4, JSON.stringify(breedtes));
  for (const [selector, em] of breedtes) assert.ok(em >= 5, `${selector}: ${em}em`);
});

test("op een gsm komt de lijst vóór de kaart", () => {
  assert.doesNotMatch(css, /\.pv-aside\s*\{[^}]*order:\s*-/);
});

test("de focusrand van een kaartknop valt binnen de kaart (die knipt af met overflow: hidden)", () => {
  assert.match(regel(css, ".pv-row"), /overflow:\s*hidden/);
  assert.match(regel(css, ".plek-ui .pv-row-btn:focus-visible"), /outline-offset:\s*-\d/);
});

test("de focusrand rond de kop raakt de regel eronder niet, en is rustig na een muisklik", () => {
  const kop = regel(css, ".pv-head h2:focus");
  const breedte = Number(/outline:\s*(\d+)px/.exec(kop)?.[1]);
  const afstand = Number(/outline-offset:\s*(\d+)px/.exec(kop)?.[1]);
  const marge = Number(/margin:\s*(\d+)px/.exec(regel(css, ".pv-sub"))?.[1]);
  assert.ok(breedte + afstand < marge, `rand ${breedte}px + afstand ${afstand}px tegen marge ${marge}px`);
  assert.match(regel(css, ".pv-head h2:focus:not(:focus-visible)"), /outline-width:\s*[12]px/);
});

test("het zoekveld heeft één label en geen aria-label, met een korte voorbeeldtekst", () => {
  assert.doesNotMatch(index, /id="agenda-street-jump"[^>]*aria-label=/);
  assert.match(js, /search\.removeAttribute\("aria-label"\)/);
  // Het oude veld met het label "Straat" gaat niet mee naar "Alle lijsten".
  assert.match(js, /label\[for="agenda-street-jump"\]/);
  const placeholder = /placeholder: "([^"]+)"/.exec(js)?.[1] || "";
  assert.ok(placeholder && placeholder.length <= 20, `voorbeeldtekst "${placeholder}"`);
});

test("de knop Alle onderwerpen is een actie zonder aria-pressed", () => {
  const knop = js.split("\n").find((r) => r.includes("pv-chip-all"));
  assert.ok(knop, "de knop staat in place-view.js");
  assert.doesNotMatch(knop, /aria-pressed/);
  assert.doesNotMatch(css, /\.pv-chip-all\[aria-pressed/);
});

test("de kaart naast de lijst is een regio, geen aside binnen een section", () => {
  assert.doesNotMatch(js, /<aside\b/);
  assert.match(js, /class="pv-aside" role="region" aria-label="Kaart"/);
});

test("een open kaart klapt de regels over de bron in onder Bron en dossier", () => {
  const bron = /const BRONREGELS = new Set\((\[[^\]]*\])\)/.exec(js)?.[1] || "[]";
  for (const label of ["Waarom in deze agenda?", "In het dossier"]) assert.ok(JSON.parse(bron).includes(label), label);
  assert.match(js, /<details class="pv-bron-dossier"><summary>Bron en dossier<\/summary>/);
  assert.match(regel(css, ".pv-bron-dossier > summary"), /min-height:\s*44px/);
});
