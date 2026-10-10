// Opmaak op een gsm en toegankelijkheid van de plekweergave (herstelplan O8 en O9).
// Deze toetsen lezen de stijl en de sjablonen; tests/e2e/gsm-opmaak.e2e.mjs meet hetzelfde in Chromium.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { evenementFeiten, evenementKaartje } from "../site/kaart-uitleg.js";
// Als namespace: bestaat kaartIndeling (nog) niet, dan falen alleen de toetsen die ze gebruiken.
import * as plekView from "../site/place-view.js";

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

test("geen woordbreuk midden in een woord: break-word in plaats van anywhere", () => {
  for (const selector of [".pv-place-name", ".pv-row-title", ".pv-detail dd", ".pv-row-when"]) {
    assert.match(regel(css, selector), /overflow-wrap:\s*break-word/, selector);
    assert.doesNotMatch(regel(css, selector), /anywhere/, selector);
  }
  assert.doesNotMatch(regel(css, ".pv-row-where, .pv-row-range"), /anywhere/);
  // De samenvatting: een sterkere regel (.pv-row .pv-row-summary) wint van de oude.
  assert.match(regel(css, ".pv-row .pv-row-summary"), /overflow-wrap:\s*break-word/);
});

test("de straatnaam krijgt op een gsm de volle breedte; de knoppen staan eronder", () => {
  const gsm = mediaBlok("max-width: 640px");
  assert.match(regel(gsm, ".pv-place-top"), /flex-direction:\s*column/);
  assert.doesNotMatch(regel(gsm, ".pv-place-top"), /nowrap/);
});

test("de tijdkolom is minstens 5em breed, ook op een gsm, en de weekkop staat er precies boven", () => {
  const kolom = (selector) => [...css.matchAll(new RegExp(`\\.${selector}\\s*\\{[^}]*grid-template-columns:\\s*([\\d.]+)(r?em)\\s`, "g"))].map((m) => [Number(m[1]), m[2]]);
  const knop = kolom("pv-row-btn"), kop = kolom("pv-week-head");
  assert.ok(knop.length >= 2 && kop.length >= 2, JSON.stringify({ knop, kop }));
  for (const [n, eenheid] of knop) assert.ok(n >= 5 && eenheid === "em", `kaartknop: ${n}${eenheid}`);
  // De weekkop staat in kleinere letters (.72rem): in em zou zijn tijdkolom smaller zijn dan die van
  // de kaartknop (1rem), en de dagen stonden niet boven de balkjes. Dus in rem, met hetzelfde getal.
  assert.match(regel(css, ".pv-row-btn"), /font:\s*inherit/);
  assert.deepEqual(kop, knop.map(([n]) => [n, "rem"]));
});

test("op een smalle gsm staat de tijd op een eigen regel boven de soort; de titel krijgt de volle breedte", () => {
  const smal = mediaBlok("max-width: 27.5em");
  assert.match(regel(smal, ".pv-row-btn"), /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+16px/);
  assert.match(regel(smal, ".pv-row-when"), /grid-row:\s*1\b/);
  // De titel loopt ook onder het pijltje door (dat staat alleen naast de tijd).
  assert.match(regel(smal, ".pv-row-main"), /grid-column:\s*1\s*\/\s*-1\s*;\s*grid-row:\s*2\b/);
  // De weekkop volgt: zonder lege kolommen staan de dagen boven de balkjes.
  assert.match(regel(smal, ".pv-week-head"), /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/);
  assert.match(regel(smal, ".pv-week-head > span:not(.pv-week-days)"), /display:\s*none/);
});

test("op een gsm schuift de pagina niet opzij: werkbalk, weeknavigatie, straalknoppen en sectiekoppen", () => {
  const gsm = mediaBlok("max-width: 640px");
  // De werkbalk is één kolom die niet breder wordt dan de lijst (de weeknavigatie duwde ze 13 px te breed).
  assert.match(regel(css, ".pv-toolbar"), /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(regel(gsm, ".pv-nav"), /flex-wrap:\s*wrap/);
  assert.match(regel(gsm, ".pv-nav-label"), /min-width:\s*0/);
  // De afstanden houden hun eigen breedte; alleen "Alleen de straat" mag over twee regels.
  assert.match(regel(gsm, ".pv-radius"), /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+repeat\(3,\s*auto\)/);
  assert.match(regel(gsm, ".pv-seg.pv-radius button:first-child"), /white-space:\s*normal/);
  assert.doesNotMatch(gsm, /\.pv-radius\s*\{[^}]*auto 1fr 1fr 1fr/);
  // Een sectiekop mag smaller worden dan haar langste woord (tekst 200 %); het aantal blijft ernaast.
  assert.doesNotMatch(regel(css, ".pv-day-title"), /flex-wrap:\s*wrap/);
  assert.match(regel(css, ".pv-day-label"), /min-width:\s*0[^}]*overflow-wrap:\s*break-word/);
  assert.match(js, /<h3 class="pv-day-title"><span class="pv-day-label">\$\{title\}<\/span>/);
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

test("een sectie heeft een naam zonder HTML-code of verborgen pictogram", () => {
  assert.equal(typeof plekView.kopTekst, "function", "place-view.js deelt kopTekst");
  assert.equal(plekView.kopTekst('<span aria-hidden="true">⏳</span> Nu bezig'), "Nu bezig");
  assert.equal(plekView.kopTekst('<span class="pv-rel">Vandaag</span> zaterdag 10 oktober'), "Vandaag zaterdag 10 oktober");
  assert.equal(plekView.kopTekst("Week van 5 okt &amp; later"), "Week van 5 okt & later");
  assert.match(js, /aria-label="\$\{esc\(kopTekst\(title\)\)\}"/);
});

// Een uitleg zoals kaart-uitleg.js die geeft, met verzonnen tekst. De toetsen hieronder hangen niet aan
// de woorden of de labels van de uitleg (die herschrijft #140), wel aan wat er zichtbaar blijft.
const uitlegMet = (regels, beschrijvingen = []) => ({ regels, beschrijvingen, technisch: "dossier X · ETL = evenement", ontbreekt: ["organisator niet gepubliceerd"] });

test("een open kaart klapt alleen de organisator, het nummer en de codes in; elke andere regel blijft zichtbaar", () => {
  assert.equal(typeof plekView.kaartIndeling, "function", "place-view.js deelt de indeling van een open kaart");
  const regels = [["Soort", "a"], ["Organisator", "niet openbaar"], ["Waarom in deze agenda?", "b"], ["Wat", "c"], ["Een nieuw label", "d"], ["Wanneer", "e"]];
  const k = plekView.kaartIndeling(uitlegMet(regels), { reference: "Dossier X" });
  assert.deepEqual(k.regels.map(([dt]) => dt), ["Soort", "Waarom in deze agenda?", "Wat", "Een nieuw label", "Wanneer"]);
  assert.deepEqual(k.bron, [["Organisator", "niet openbaar"], ["Referentie", "Dossier X"]]);
  assert.equal(k.technisch, "dossier X · ETL = evenement");
  // Zonder organisator en nummer staat er niets dicht behalve de codes.
  assert.deepEqual(plekView.kaartIndeling(uitlegMet([["Wat", "c"]])).bron, []);
  // De uitleg bij een lange stratenlijst staat bij die lijst; bij drie straten of minder blijft ze een regel.
  const parcours = [["Wat", "c"], ["Parcours", "40 betrokken straten volgens het dossier"]];
  assert.deepEqual(plekView.kaartIndeling(uitlegMet(parcours), { straten: 40 }).regels.map(([dt]) => dt), ["Wat"]);
  assert.equal(plekView.kaartIndeling(uitlegMet(parcours), { straten: 40 }).stratenNoot, "40 betrokken straten volgens het dossier");
  assert.deepEqual(plekView.kaartIndeling(uitlegMet(parcours), { straten: 2 }).regels.map(([dt]) => dt), ["Wat", "Parcours"]);
  // In de kaart: het nummer en de codes staan onder "Bron en dossier".
  assert.match(js, /<details class="pv-bron-dossier"><summary>Bron en dossier<\/summary>/);
  // De periode onder de titel staat in een open kaart al bij "Wanneer": niet herhalen.
  assert.match(css, /\.pv-row\.open:has\(\.pv-uitleg-kaart\) :is\(\.pv-row-summary, \.pv-row-range\) \{ display: none; \}/);
  assert.match(regel(css, ".pv-bron-dossier > summary"), /min-height:\s*44px/);
});

test("een open evenementkaart toont welk parcours het is en wat er nog gebeurt; alleen de parkeerverboden staan ingeklapt", () => {
  const lijst = ["Parkeerverbod in Straat: kant even", "Omleiding: servicepunt voor fietsen", "Parcours: 10 km", "Parkeerverbod in Straat: kant oneven",
    "Parcours: jeugd 5 km", "Parcours: halve ronde", "Parkeerverbod in Straat: plein"];
  const { dossier } = plekView.kaartIndeling(uitlegMet([["In het dossier", lijst.join(" · ")]], lijst));
  assert.deepEqual(dossier.zichtbaar, ["Parcours: 10 km", "Parcours: jeugd 5 km", "Parcours: halve ronde", "Omleiding: servicepunt voor fietsen"]);
  assert.deepEqual(dossier.dicht, ["Parkeerverbod in Straat: kant even", "Parkeerverbod in Straat: kant oneven", "Parkeerverbod in Straat: plein"]);
  assert.equal(dossier.knop, "Toon de 3 parkeerverboden uit het dossier");
  // Veel parcoursdelen: allemaal zichtbaar. Weinig omschrijvingen: niets ingeklapt (geen knop voor één regel).
  const veel = Array.from({ length: 6 }, (_, i) => `Parcours: ronde ${i + 1}`);
  assert.equal(plekView.kaartIndeling(uitlegMet([], [...veel, "Parkeerverbod: a", "Parkeerverbod: b"])).dossier.zichtbaar.length, 6);
  const weinig = plekView.kaartIndeling(uitlegMet([], ["Parkeerverbod: a", "Parkeerverbod: b", "Omleiding: c", "Parkeerverbod: d"])).dossier;
  assert.deepEqual([weinig.zichtbaar.length, weinig.dicht.length], [4, 0]);
  // Ook andere omschrijvingen dan parkeerverboden in de rest: dan zegt de knop "omschrijvingen".
  const gemengd = plekView.kaartIndeling(uitlegMet([], ["Inname: a", "Inname: b", "Inname: c", "Inname: d", "Parkeerverbod: e"])).dossier;
  assert.equal(gemengd.knop, "Toon nog 2 omschrijvingen uit het dossier");
  // In de kaart staat de lijst bij de gewone regels, niet onder "Bron en dossier".
  assert.match(js, /\$\{lijst\(dossier\.zichtbaar\)\}/);
});

// Samen met kaart-uitleg.js: een verzonnen evenementendossier zoals de live A-Sign-laag het geeft.
const DOSSIER = "ET2099000003";
const inname = (i, type, beschrijving) => ({
  id: `iod:${DOSSIER}|${i}|${i}`, kind: "iod", title: type, innameType: type, reference: DOSSIER, dossierType: "ETL",
  phase: "Evenement", hindrance: "True", description: beschrijving, start: "2026-10-18T05:00:00.000Z", end: "2026-10-18T17:00:00.000Z",
  status: "toelating_gegenereerd", streets: [{ id: `${i}`, name: `Proefstraat ${i}`, postcode: "2000" }],
});

test("samen met kaart-uitleg.js: elk parcours uit het dossier staat zichtbaar, het nummer en de codes niet", () => {
  const onderdelen = [["Parkeerverbod", "Parkeerverbod langs het parcours"], ["Parcours", "Parcours volwassenen 10 km"], ["Parcours", "Parcours jeugd 5 km"]];
  const uitleg = evenementKaartje(evenementFeiten(onderdelen.map(([type, tekst], i) => inname(i + 1, type, tekst))), { vandaag: "2026-10-10" });
  assert.ok(Array.isArray(uitleg.beschrijvingen), "kaart-uitleg.js geeft de omschrijvingen ook als lijst");
  const k = plekView.kaartIndeling(uitleg, { reference: `Dossier ${DOSSIER}`, straten: 3 });
  for (const deel of ["Parcours volwassenen 10 km", "Parcours jeugd 5 km"]) assert.ok(k.dossier.zichtbaar.some((b) => b.includes(deel)), deel);
  const zichtbaar = JSON.stringify(k.regels);
  assert.doesNotMatch(zichtbaar, new RegExp(`${DOSSIER}|IOD = |ETL = `));
  assert.ok(k.bron.some(([, dd]) => dd === `Dossier ${DOSSIER}`));
});
