// Eén vaste lijst toegelaten "onbekend"-zinnen (site/onbekend-zinnen.js; vaagheidsplan van 12 oktober 2026, stap 6).
// Een zin voor bewoners die zegt dat iets ontbreekt ("zegt de stad niet", "niet gepubliceerd", "onbekend", "noemt geen
// ...", "niet in de bron") staat alleen in die lijst. Deze toets leest de stringliterals van elk bestand met tekst voor
// bewoners (ook die binnen ${...} van een template) en weigert elke zo'n zin die geen zin uit de lijst is. Daarna kijkt
// ze de gebouwde agenda na: de tekst die de code zelf schrijft (de evenementendossiers, de koopzondagen) heeft geen
// andere.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { ONBEKEND_ZINNEN, onbekendVeld, onbekendZin } from "../site/onbekend-zinnen.js";
import { DETAIL_PATRONEN, ONTBREEKT_ZIN, TEKST_PATRONEN } from "../lib/vaagheid.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Wat een "onbekend"-zin is: de ontbreekt-zinnen van de meter, en de beloftes die nergens mogen staan.
const PATROON = new RegExp(
  `${ONTBREEKT_ZIN.source}|\\bnaam volgt\\b|\\bvolgt zodra\\b|\\bgeen (?:uur|uren|plaats|naam)\\b[^.;]{0,40}\\bin de bron\\b|\\bstaa?n? niet in (?:het dossier|de bron)\\b`,
  "gi",
);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Een zin uit de lijst als patroon; {wat} mag alles zijn (ook een stuk ${...} van een template).
const ZINNEN = Object.values(ONBEKEND_ZINNEN).map((z) => new RegExp(esc(z.zin).replace(/\\\{\w+\\\}/g, "[^]{0,200}?"), "gi"));

// Bestanden met tekst voor bewoners: de site (behalve de lijst zelf en wat gebouwd of gedownload is), en de code die
// agendatekst schrijft.
const GEBOUWD = new Set(["agenda-feed.js", "onbekend-zinnen.js", "works-snapshot.js"]);
const BESTANDEN = [
  ...fs.readdirSync(path.join(root, "site")).filter((f) => f.endsWith(".js") && !GEBOUWD.has(f)).map((f) => `site/${f}`),
  "lib/asign-evenementen-agenda.mjs", "lib/parcours-herkenning.mjs", "lib/koopzondagen.mjs", "lib/ebesluit-evenementen.mjs",
  ...fs.readdirSync(path.join(root, "lib")).filter((f) => /^district-.*\.mjs$/.test(f)).map((f) => `lib/${f}`),
  "scripts/build-agenda.mjs",
];
// Technisch, nooit voor bewoners: een foutmelding over de vorm van een bronbestand.
const TECHNISCH = [/\bonbekend veld\b/];

// De stringliterals van een JS-bron ("…", '…' en `…`, met \u0000 voor elke ${...}), ook die binnen ${...};
// commentaar en regexliterals vallen weg. Een benadering die volstaat voor deze bestanden.
function stringLiterals(src) {
  const uit = [];
  let i = 0, regel = 1;
  const n = src.length;
  const vorige = (k) => { while (k >= 0 && /\s/.test(src[k])) k--; return k; };
  const woordVoor = (k) => { const e = vorige(k); let b = e; while (b >= 0 && /\w/.test(src[b])) b--; return src.slice(b + 1, e + 1); };
  function code(totAccolade) {
    let diepte = 0;
    while (i < n) {
      const c = src[i];
      if (c === "\n") { regel++; i++; continue; }
      if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
      if (c === "/" && src[i + 1] === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] === "\n") regel++; i++; } i += 2; continue; }
      if (c === '"' || c === "'") {
        const start = regel; let s = ""; i++;
        while (i < n && src[i] !== c) { if (src[i] === "\\") { s += src[i + 1]; i += 2; continue; } if (src[i] === "\n") regel++; s += src[i++]; }
        i++; uit.push({ regel: start, s }); continue;
      }
      if (c === "`") { template(); continue; }
      if (c === "/") {
        const k = vorige(i - 1), p = k >= 0 ? src[k] : "";
        if (!p || "(,=:[!&|?{};+-*%<>~^".includes(p) || ["return", "typeof", "case", "in", "of"].includes(woordVoor(i - 1))) {
          let j = i + 1, klasse = false;
          while (j < n && src[j] !== "\n") { if (src[j] === "\\") { j += 2; continue; } if (src[j] === "[") klasse = true; else if (src[j] === "]") klasse = false; else if (src[j] === "/" && !klasse) break; j++; }
          i = j + 1; while (i < n && /[a-z]/i.test(src[i])) i++;
          continue;
        }
      }
      if (c === "{") diepte++;
      if (c === "}") { if (totAccolade && diepte === 0) { i++; return; } diepte--; }
      i++;
    }
  }
  function template() {
    const start = regel; let s = ""; i++;
    while (i < n && src[i] !== "`") {
      if (src[i] === "\\") { s += src[i + 1]; i += 2; continue; }
      if (src[i] === "$" && src[i + 1] === "{") { i += 2; s += "\u0000"; code(true); continue; }
      if (src[i] === "\n") regel++;
      s += src[i++];
    }
    i++; uit.push({ regel: start, s });
  }
  code(false);
  return uit;
}

// De "onbekend"-zinnen in een tekst die geen zin uit de lijst zijn. Een woord in een naam ("pv-sectie-onbekend",
// "uur-onbekend") of één los woord ("onbekend" als waarde van een veld) is geen zin.
function zinnenBuitenLijst(tekst) {
  const s = String(tekst ?? "");
  if (/^\s*onbekend\s*$/i.test(s) || /^[\w./:#-]*$/.test(s.trim()) || TECHNISCH.some((r) => r.test(s))) return [];
  // Een zin uit de lijst telt alleen als hele zin of hele zinsdeel: ervoor het begin, een stuk ${...} of een leesteken,
  // erna het einde, een spatie of een leesteken. Anders zou "niet gepubliceerd" uit de lijst ook "uur niet
  // gepubliceerd" toelaten.
  const gedekt = [];
  for (const r of ZINNEN) {
    r.lastIndex = 0; let m;
    while ((m = r.exec(s))) {
      const voor = s.slice(0, m.index).trimEnd(), na = s.slice(m.index + m[0].length);
      if ((!voor || /[\u0000.:;,(—–>"“]$/.test(voor)) && (!na || /^[\u0000\s.:;,)<"”·]/.test(na))) gedekt.push([m.index, m.index + m[0].length]);
      r.lastIndex = m.index + 1;
    }
  }
  const fout = [];
  PATROON.lastIndex = 0; let m;
  while ((m = PATROON.exec(s))) {
    const a = m.index, b = a + m[0].length;
    if (s[a - 1] === "-" || s[b] === "-" || s[b] === "_") continue;
    if (!gedekt.some(([x, y]) => x <= a && b <= y)) fout.push(s.slice(Math.max(0, a - 60), b + 40).replace(/\u0000/g, "${…}"));
  }
  return fout;
}

test("de lijst: elke zin heeft een tekst, een patroon in de meter en een plaats; een onbekend id is een fout", () => {
  // Patronen die de meter alleen als veld kent (entry.onbekend): de zin staat één keer per sectie, in een bundel of
  // op de agenda, niet op elke kaart.
  const alleenVeld = new Set(["werf-zonder-doel", "aanvraag-oud", "stand-onduidelijk", "bijwerkmoment-onbekend"]);
  const meter = new Set([...TEKST_PATRONEN, ...DETAIL_PATRONEN].map((p) => p.id));
  for (const [id, z] of Object.entries(ONBEKEND_ZINNEN)) {
    assert.match(id, /^[a-z-]+$/, id);
    assert.ok(z.zin && z.zin === z.zin.trim(), `${id}: zin`);
    assert.ok(meter.has(z.meter) || alleenVeld.has(z.meter), `${id}: ${z.meter} staat niet in de meter`);
    assert.equal(typeof z.kern, "boolean", id);
    assert.ok(["kaart", "sectie", "bundel", "detail", "agenda", "lijst"].includes(z.waar), `${id}: waar`);
    assert.deepEqual(onbekendVeld(id), { id, meter: z.meter, kern: z.kern });
    // Een zin uit de lijst is zelf geen zin buiten de lijst.
    assert.deepEqual(zinnenBuitenLijst(onbekendZin(id, { wat: "werfzone" })), [], id);
  }
  assert.equal(onbekendZin("werfzone-waarvoor", { wat: "omleiding" }), "De stad publiceert niet waarvoor deze omleiding dient.");
  assert.throws(() => onbekendZin("naam-volgt"), /onbekende onbekend-zin/);
  assert.throws(() => onbekendVeld("bestaat-niet"), /onbekende onbekend-zin/);
  // Geen belofte in de lijst.
  for (const z of Object.values(ONBEKEND_ZINNEN)) assert.doesNotMatch(z.zin, /naam volgt|volgt zodra|via de officiële bron/i);
});

test("de toets weigert een andere zin, ook in een template of een ternary, en laat de lijst, namen en commentaar door", () => {
  const bron = [
    "// commentaar: de stad zegt niet hoe laat",
    "const a = \"Hoe laat het begint, zegt de stad niet.\";",
    "const b = `Op ${dag}: ${x ? \"tijdstip niet gepubliceerd\" : onbekendZin(\"uren-ontbreekt\")}.`;",
    "const c = `${onbekendZin(\"datum\")}`, d = \"Uur onbekend\", e = \"uur-onbekend\", f = \"onbekend\";",
    "const g = /niet gepubliceerd/i, h = '<p class=\"pv-sectie-onbekend\">';",
    "const i = `Naam onbekend. ${reden}`, j = 'De naam volgt zodra de stad hem noemt.';",
  ].join("\n");
  const fout = stringLiterals(bron).flatMap((l) => zinnenBuitenLijst(l.s).map((z) => `${l.regel}: ${z}`));
  assert.deepEqual(fout.map((x) => x.split(":")[0]), ["2", "3", "6"]);
  assert.match(fout[1], /tijdstip niet gepubliceerd/);
  assert.match(fout[2], /naam volgt/);
});

test("geen bestand met tekst voor bewoners heeft een onbekend-zin buiten de lijst", () => {
  const fout = [];
  for (const f of BESTANDEN) {
    for (const l of stringLiterals(fs.readFileSync(path.join(root, f), "utf8"))) {
      for (const z of zinnenBuitenLijst(l.s)) fout.push(`${f}:${l.regel}: ${z}`);
    }
  }
  assert.deepEqual(fout, [], `Zet de zin in site/onbekend-zinnen.js en gebruik onbekendZin():\n${fout.join("\n")}`);
  assert.ok(BESTANDEN.length > 40, "de lijst bestanden is niet leeg");
});

test("de gebouwde agenda: de tekst die de code schrijft heeft geen andere onbekend-zin, en nergens 'naam volgt'", () => {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, "site", "agenda-feed.js"), "utf8"), ctx);
  const feed = Object.values(ctx.window).find((v) => Array.isArray(v?.items));
  assert.ok(feed?.items?.length, "feed");
  const eigen = new Set(["district-asign-evenementen", "stad-koopzondagen"]);
  const fout = [];
  let gezien = 0;
  for (const item of feed.items) {
    for (const veld of ["title", "info", "location", "timeText"]) {
      const tekst = String(item[veld] || "");
      assert.doesNotMatch(tekst, /\bnaam volgt\b|\bvolgt zodra\b/i, `${item.id} ${veld}`);
      if (!eigen.has(item.sourceId)) continue;
      gezien++;
      for (const z of zinnenBuitenLijst(tekst)) fout.push(`${item.id} ${veld}: ${z}`);
    }
  }
  assert.ok(gezien > 0, "er zijn agendapunten uit de evenementendossiers of de koopzondagen");
  assert.deepEqual(fout.slice(0, 10), [], `${fout.length} zinnen buiten de lijst`);
});
