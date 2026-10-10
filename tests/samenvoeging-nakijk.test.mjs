// Nakijken van de samenvoeging (claude/agenda-integratie): bevindingen die niet bij één restpunt horen.
// Verzonnen gegevens; de scan over de echte bronbestanden toont alleen bestand en regel, nooit de tekst.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// ---------- commentaar zonder echt adres ----------
// De repo is publiek. Een voorbeeld in commentaar met een echte straat en één huisnummer kan een woning
// zijn ("Xstraat 26-26 2000 Antwerpen" is de vorm, niet het adres): verzonnen straten, zoals in de toetsen.
// Een reeks ("18 - 24"), een jaartal of een datum ("1 april") is geen woning.
const MAANDEN = "januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december";
function echteAdressenInCommentaar(root) {
  const straten = JSON.parse(fs.readFileSync(path.join(root, "site", "geo", "straten.json"), "utf8")).streets
    .map((rij) => String(rij?.[1] || "").trim()).filter((naam) => naam.length > 3 && !/\d/.test(naam));
  const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const adres = new RegExp(`(?<!\\p{L})(?:${[...new Set(straten)].map(esc).join("|")})(?:\\s*\\|\\s*|\\s+\\(\\d{4}\\)\\s+|\\s+hoek-|\\s+)\\d{1,3}(?![\\d.,:])(?!\\s*(?:-|–|tem|t\\/m|tot)\\s*\\d)(?!\\s+(?:${MAANDEN}))`, "iu");
  const gevonden = [];
  for (const map of ["site", "lib", "scripts"]) {
    for (const naam of fs.readdirSync(path.join(root, map)).filter((n) => /\.m?js$/.test(n)).sort()) {
      fs.readFileSync(path.join(root, map, naam), "utf8").split("\n").forEach((regel, i) => {
        const begin = regel.search(/(?:^|\s)\/\/\s/);
        if (begin >= 0 && adres.test(regel.slice(begin))) gevonden.push(`${map}/${naam}:${i + 1}`);
      });
    }
  }
  return gevonden;
}

test("commentaar in site/, lib/ en scripts/ noemt geen echte straat met één huisnummer", () => {
  assert.deepEqual(echteAdressenInCommentaar(repoRoot), []);
});

// ---------- lint: node --check op elk site/*.js (plan P1) ----------
// #140 en #141 gingen zonder conflict samen, maar gaven twee keer `const joinNl` in site/kaart-uitleg.js:
// een SyntaxError die de hele plekpagina brak. De lint keek alleen een vaste lijst na.
test("de lint controleert elk site/*.js met node --check en vindt een dubbele const", async (t) => {
  const { jsFouten, teControlerenJs } = await import("../scripts/js-controle.mjs");
  const lijst = teControlerenJs(repoRoot, ["scripts/lint.mjs"]);
  const site = fs.readdirSync(path.join(repoRoot, "site")).filter((n) => n.endsWith(".js")).map((n) => `site/${n}`);
  for (const file of [...site, "site/kaart-uitleg.js", "site/place-view.js", "site/place-core.js", "scripts/lint.mjs"]) assert.ok(lijst.includes(file), file);
  assert.equal(new Set(lijst).size, lijst.length, "geen dubbels");
  assert.match(fs.readFileSync(path.join(repoRoot, "scripts", "lint.mjs"), "utf8"), /jsFouten\(rootDir, teControlerenJs\(rootDir, javascriptFiles\)\)/);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "js-controle-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "site"));
  fs.writeFileSync(path.join(root, "site", "goed.js"), "export const joinNl = (lijst) => lijst.join(\", \");\n");
  fs.writeFileSync(path.join(root, "site", "samen.js"), "const joinNl = (a) => a;\nconst joinNl = (b) => b;\n");
  fs.writeFileSync(path.join(root, "site", "notities.txt"), "geen JavaScript");
  assert.deepEqual(teControlerenJs(root), ["site/goed.js", "site/samen.js"]);
  const fouten = jsFouten(root, teControlerenJs(root));
  assert.deepEqual(fouten.map((f) => f.file), ["site/samen.js"]);
  assert.match(fouten[0].fout, /joinNl/);
});
