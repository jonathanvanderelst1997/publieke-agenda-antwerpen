// De homoniemtoevoeging van de straatas ("Proefstraat_AN": een straatnaam die ook in een ander district bestaat) is geen
// deel van de naam. De privacyfilter (site/witte-lijst.js) laat de twee letters nooit door (het kunnen initialen zijn, als
// "Proefstraat AN" in een omschrijving) en herkent de straat onder haar naam ("Proefstraat"), ook als de straatas haar
// alleen met toevoeging kent. Wat de bewoner leest (de kruist-regel, de live kaartjes) is zonder toevoeging; de sleutels
// en de koppeling houden haar. De toetsen falen op head fe8eb62 (de filter liet "Proefstraat AN" door en vond "Proefstraat"
// niet, de kruist-regel toonde "_AN") en slagen nu. Alleen verzonnen straten en namen; geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import * as W from "../site/witte-lijst.js";
import * as KU from "../site/kaart-uitleg.js";
import { zonderHomoniem } from "../site/place-core.js";
import { schoneNaam } from "../scripts/build-straten-stad.mjs";
import { plaatsnaamVan, straatasPredicaat } from "../lib/plaatsnaam.mjs";

const lees = (rel) => JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), "utf8"));
const bron = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");
const CODES = ["AN", "BE", "BO", "DE", "EK", "HO", "WI"];
// Zoals index.byName van de straatas: de sleutel van de naam met toevoeging ("proefstraat an").
const metToevoeging = new Set(["Proefstraat_AN", "Lange Testlei_DE"].map(W.sleutel));
const isStraat = (n) => metToevoeging.has(W.sleutel(n));
const vormen = (s, c) => [`${s} ${c}`, `${s}-${c}`, `${s}_${c}`, `${s}'${c}`, `${s.toUpperCase()} ${c}`];

test("homoniem: de toevoeging komt nooit door de filter, de straat blijft onder haar naam", () => {
  assert.deepEqual([...(W.HOMONIEM_CODES || [])], CODES);
  for (const t of vormen("Proefstraat", "AN")) {
    for (const opties of [{ straten: [{ name: "Proefstraat_AN" }] }, { rond: ["Proefstraat_AN"] }, { rond: () => ["Proefstraat_AN"] }, { isStraat }]) {
      const r = W.witteLijst(t, opties);
      assert.equal(W.sleutel(r.tekst), "proefstraat", `${t} ${JSON.stringify(opties.straten || opties.rond || "isStraat")} → ${r.tekst}`);
      assert.deepEqual(r.plekken.map(W.sleutel), ["proefstraat"]);
    }
  }
  // De gewone naam, ook als de straatas alleen de naam met toevoeging kent.
  assert.equal(W.witteTekst("Proefstraat", { rond: ["Proefstraat_AN"] }), "Proefstraat");
  assert.equal(W.witteTekst("Proefstraat", { straten: [{ name: "Proefstraat_AN" }] }), "Proefstraat");
  assert.equal(W.witteTekst("Proefstraat", { isStraat }), "Proefstraat");
  assert.equal(W.witteTekst("Opbouw in de Lange Testlei DE bij Testpersoon", { isStraat }), "Lange Testlei");
  assert.equal(plaatsnaamVan("Proefstraat AN", { isStraat }), "Proefstraat");
  // Zoals de verversing de straatas meegeeft (index.byName met de sleutel van de naam met toevoeging).
  const verversing = straatasPredicaat({ index: { byName: new Map([["proefstraat an", []]]) } });
  assert.equal(W.witteTekst("Inname Proefstraat AN 12", { isStraat: verversing }), "Proefstraat");
  assert.equal(W.witteTekst("Inname Proefstraat", { isStraat: verversing }), "Proefstraat");
  // Een naam vast aan een straat blijft één woord, en dat is geen straat.
  assert.equal(W.witteTekst("Proefstraat_Testpersoon", { isStraat }), "");
});

test("homoniem: eigenschap: met elke code, scheiding en naam ernaast blijft geen toevoeging of losse code in de uitvoer", () => {
  let zaad = 20261017;
  const r = () => { zaad = (zaad * 1103515245 + 12345) % 2147483648; return zaad / 2147483648; };
  const kies = (lijst) => lijst[Math.floor(r() * lijst.length)];
  const NAMEN = ["Testpersoon", "Van Proefmans", "T. Voorbeeld", "fam. Testers", "Zorvex Quilxan"];
  let metPlek = 0;
  for (let i = 0; i < 3000; i += 1) {
    const code = kies(CODES), straat = kies(["Proefstraat", "Lange Testlei"]);
    const t = kies([
      () => `${kies(vormen(straat, code))}`, () => `${kies(NAMEN)} ${kies(vormen(straat, code))} ${1 + Math.floor(r() * 99)}`,
      () => `${kies(vormen(straat, code))} ${kies(NAMEN)}`, () => `${straat} ${code} ${kies(NAMEN)}`, () => `Opbouw ${straat}_${code}, ${kies(NAMEN)}`,
    ])();
    const straten = [{ name: `${straat}_${code}` }];
    const isStraatHier = (n) => W.sleutel(n) === W.sleutel(`${straat}_${code}`);
    for (const opties of [{ straten }, { rond: straten.map((s) => s.name) }, { isStraat: isStraatHier }, { isStraat }]) {
      const uit = W.witteLijst(t, opties);
      assert.doesNotMatch(uit.tekst, /_|\d/, `${t} → ${uit.tekst}`);
      for (const p of uit.plekken) {
        const woorden = W.sleutel(p).split(" ");
        assert.ok(!(woorden.length > 1 && CODES.includes(woorden.at(-1).toUpperCase())), `${t} → plek ${p} eindigt op een code`);
        assert.ok(["proefstraat", "lange testlei"].includes(W.sleutel(p)), `${t} → ${p}`);
      }
      if (uit.plekken.length) metPlek += 1;
    }
  }
  assert.ok(metPlek > 5000, `${metPlek} uitkomsten met een plek`);
});

test("homoniem: één definitie; de straatas van de repo heeft alleen de gemeten codes en geen naam die op een code eindigt", () => {
  for (const f of [W.zonderToevoeging, zonderHomoniem, schoneNaam]) assert.equal(f("Proefstraat_AN"), "Proefstraat");
  assert.equal(zonderHomoniem, W.zonderToevoeging);
  assert.equal(KU.zonderStraatasToevoeging("Kruist Proefstraat_AN en Lange Testlei_DE"), "Kruist Proefstraat en Lange Testlei");
  const namen = [...lees("../site/geo/straten.json").streets.map((s) => s[1]), ...(lees("../site/geo/straten-stad.json").straten || []).map((s) => (Array.isArray(s) ? s[0] : s?.name ?? s))];
  assert.ok(namen.length > 3000, `${namen.length} namen`);
  const codes = new Set(namen.map((n) => /_([A-Z]{2})$/.exec(String(n))?.[1]).filter(Boolean));
  for (const c of codes) assert.ok(CODES.includes(c), `onbekende code ${c}`);
  const eindigtOpCode = namen.filter((n) => { const w = W.sleutel(W.zonderToevoeging(n)).split(" "); return w.length > 1 && CODES.includes(w.at(-1).toUpperCase()); });
  assert.deepEqual(eindigtOpCode, [], "een straatnaam die op een losse code eindigt, zou wegvallen");
});

test("homoniem: wat de bewoner leest, is zonder toevoeging (kruist-regel, live kaartjes)", () => {
  // De kruist-regel van de plekpagina, zoals place-view.js haar maakt.
  const view = bron("../site/place-view.js");
  const regel = view.split("\n").find((r) => r.includes("const kruistRij ="));
  assert.ok(regel, "de kruist-regel staat in site/place-view.js");
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const maak = new Function("kruist", "esc", "zonderHomoniem", `${regel}\nreturn kruistRij;`);
  for (const kruist of [["Proefstraat_AN"], ["Proefstraat_AN", "Lange Testlei_DE", "Testkaai", "Testvest"]]) {
    const html = maak(kruist, esc, zonderHomoniem);
    assert.match(html, /Proefstraat/);
    assert.doesNotMatch(html, /_[A-Z]{2}\b/, html);
  }
  // De live kaartjes: de straat zonder toevoeging.
  assert.match(bron("../site/public-space-live.js"), /<dt>Straat<\/dt><dd>\$\{esc\(i\.streets\.map\(s=>zonderHomoniem\(s\.name\)\)/);
  const works = bron("../site/works-live.js");
  assert.match(works, /<dt>Straat<\/dt><dd>\$\{esc\(i\.streets\.map\(s=>zonderToevoeging\(s\.name\)\)/);
  assert.match(works, /const waarLos=i=>i\.streets\?\.length\?i\.streets\.map\(s=>zonderToevoeging\(s\.name\)\)/);
});
