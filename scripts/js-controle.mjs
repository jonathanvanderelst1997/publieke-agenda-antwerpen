// node --check op JavaScript van de site (plan P1). Twee PR's die zonder conflict samengaan, kunnen
// samen toch geen geldige JavaScript meer zijn (bv. twee keer `const joinNl` in site/kaart-uitleg.js):
// dan breekt de hele plekpagina. Daarom controleert de lint elk bestand in site/*.js, niet alleen een
// vaste lijst. Gebruikt door scripts/lint.mjs.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

// De vaste lijst plus elk site/*.js, zonder dubbels, in een vaste volgorde.
export function teControlerenJs(rootDir, vast = []) {
  const siteDir = path.join(rootDir, "site");
  const site = fs.existsSync(siteDir)
    ? fs.readdirSync(siteDir, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".js")).map((entry) => `site/${entry.name}`).sort()
    : [];
  return [...new Set([...vast, ...site])];
}

// [{ file, fout }] voor elk bestand dat node --check afkeurt.
export function jsFouten(rootDir, files) {
  const fouten = [];
  for (const file of files) {
    const check = spawnSync(process.execPath, ["--check", path.join(rootDir, file)], { encoding: "utf8" });
    if (check.status !== 0) fouten.push({ file, fout: check.stderr || `${file} is geen geldige JavaScript.` });
  }
  return fouten;
}
