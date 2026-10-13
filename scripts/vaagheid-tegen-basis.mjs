// Vaagheidsratel met twee metingen op dezelfde data (CI, .github/workflows/ci.yml): de code van de basis (de
// branch waarop een PR landt) en de code van deze tak, allebei op de data van deze tak. Dan komt elk verschil van
// de code, ook als de tak zelf data wijzigt (dan slaat de ratel in tests/vaagheid.test.mjs over, want de
// opgeslagen meting hoort bij andere data). Een stijging faalt, tenzij ze in site/sources/vaagheid.json onder
// `aanvaard` staat met een reden (lib/vaagheid.mjs, isAanvaard).
//
// Werkwijze: de code van de basis (git archive van --basis) in een tijdelijke map; daarin de data van deze tak
// (site/sources, site/geo, site/straat, site/straat-index.json) en de meter van deze tak (scripts/meet-vaagheid.mjs,
// lib/vaagheid.mjs), zodat beide metingen dezelfde patronen tellen. Dan bouwt de basis de feed en de eventpagina's
// met haar eigen code en meet. Kan de basis deze data niet bouwen (een nieuw veld dat ze niet kent), dan zegt het
// script dat en slaagt het: de vergelijking is dan niet te maken, en de ratel op het bestand blijft de controle.
// Geen netwerk (behalve git, dat de basis al heeft), geen klok.
//
//   node scripts/vaagheid-tegen-basis.mjs --basis origin/main [--uit verslag.json]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { METINGEN, VAAGHEID_FILE, isAanvaard, vergelijk } from "../lib/vaagheid.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = ["site/sources", "site/geo", "site/straat", "site/straat-index.json"];
const METER = ["scripts/meet-vaagheid.mjs", "lib/vaagheid.mjs"];

// De vergelijking zelf: per plek (agenda, eventpaginas, straten) zonder marge; elke stijging die niet aanvaard is.
export function stijgingenTegenBasis(tak, basis, aanvaard = []) {
  const uit = [];
  // "buiten" alleen als de basis die uitleg ook kent (anders is er niets om mee te vergelijken).
  for (const k of METINGEN.filter((x) => tak[x] && basis[x])) {
    const v = vergelijk(tak[k], basis[k], { marge: 0, patroonMarge: 0 });
    const gestegen = v.gestegen.length ? v.gestegen : v.ok ? [] : [{ id: "aandeel", van: basis[k]?.aandeel ?? null, naar: v.stijging }];
    for (const g of gestegen) uit.push({ waar: k, ...g, aanvaard: isAanvaard(aanvaard, k, g) });
  }
  return uit;
}

function kopieer(van, naar) {
  if (!fs.existsSync(van)) return;
  fs.rmSync(naar, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(naar), { recursive: true });
  fs.cpSync(van, naar, { recursive: true });
}
const node = (args, cwd) => execFileSync(process.execPath, args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

export function meetBasis(basisRef, { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaagheid-basis-")) } = {}) {
  try {
    const tar = execFileSync("git", ["archive", basisRef, "lib", "scripts", "site", "package.json"], { cwd: root, maxBuffer: 512 * 1024 * 1024 });
    execFileSync("tar", ["-x", "-C", tmp], { input: tar });
    for (const rel of [...DATA, ...METER]) kopieer(path.join(root, rel), path.join(tmp, rel));
    // De meting zelf is geen bron: een basis zonder meter zou ze als onbekende bron weigeren.
    fs.rmSync(path.join(tmp, "site", "sources", VAAGHEID_FILE), { force: true });
    if (fs.existsSync(path.join(root, "node_modules")) && !fs.existsSync(path.join(tmp, "node_modules"))) fs.symlinkSync(path.join(root, "node_modules"), path.join(tmp, "node_modules"), "dir");
    try {
      node(["scripts/build-sources.mjs"], tmp);
      node(["scripts/build-agenda.mjs"], tmp);
    } catch (error) {
      const regels = String(error.stderr || error.message).split("\n").map((x) => x.trim()).filter(Boolean);
      const k = regels.findIndex((x) => /^\w*Error\b/.test(x));
      return { overgeslagen: `de basis bouwt deze data niet (${(k >= 0 ? regels.slice(k, k + 2) : regels.slice(-1)).join(" ").slice(0, 240)})` };
    }
    const uitBestand = path.join(tmp, "basis-meting.json");
    try {
      // --streng: een fout in de meting zelf wordt een exitcode (anders meldt de meter alleen).
      node(["scripts/meet-vaagheid.mjs", "--uit", uitBestand, "--streng"], tmp);
    } catch (error) {
      return { overgeslagen: `de meter liep niet op de code van de basis (${String(error.stderr || error.message).trim().split("\n").at(-1).slice(0, 240)})` };
    }
    return { meting: JSON.parse(fs.readFileSync(uitBestand, "utf8")) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (naam) => { const i = process.argv.indexOf(naam); return i > 0 ? process.argv[i + 1] : null; };
  const basisRef = arg("--basis") || "origin/main";
  const basis = meetBasis(basisRef);
  if (basis.overgeslagen) {
    console.log(`vaagheid tegen ${basisRef}: overgeslagen, ${basis.overgeslagen}`);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Vaagheid tegen ${basisRef}\n\nOvergeslagen: ${basis.overgeslagen}\n`);
  } else {
    const takBestand = path.join(os.tmpdir(), `vaagheid-tak-${process.pid}.json`);
    node(["scripts/meet-vaagheid.mjs", "--uit", takBestand], root);
    const tak = JSON.parse(fs.readFileSync(takBestand, "utf8"));
    fs.rmSync(takBestand, { force: true });
    if (tak.invoer !== basis.meting.invoer) throw new Error(`niet dezelfde data gemeten (${tak.invoer} en ${basis.meting.invoer})`);
    let aanvaard = [];
    try { aanvaard = JSON.parse(fs.readFileSync(path.join(root, "site", "sources", VAAGHEID_FILE), "utf8")).aanvaard || []; } catch { /* zonder */ }
    const stijgingen = stijgingenTegenBasis(tak, basis.meting, aanvaard);
    const regels = stijgingen.map((g) => `${g.waar}: ${g.id} ${g.van ?? ""}->${g.naar}${g.aanvaard ? " (aanvaard)" : ""}`);
    console.log(`vaagheid tegen ${basisRef} (zelfde data ${tak.invoer}): ${regels.length ? regels.join("; ") : "geen stijging"}`);
    for (const k of METINGEN.filter((x) => tak[x] && basis.meting[x])) console.log(`  ${k}: basis ${basis.meting[k].vaag}/${basis.meting[k].items}, tak ${tak[k].vaag}/${tak[k].items}, detail meer dan één ${basis.meting[k].detail.meerDanEen} -> ${tak[k].detail.meerDanEen}`);
    if (arg("--uit")) fs.writeFileSync(arg("--uit"), `${JSON.stringify({ basis: basisRef, invoer: tak.invoer, stijgingen }, null, 1)}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Vaagheid tegen ${basisRef}\n\n${regels.length ? regels.map((r) => `- ${r}`).join("\n") : "Geen stijging."}\n`);
    const fout = stijgingen.filter((g) => !g.aanvaard);
    if (fout.length) {
      console.error(`::error title=Vaagheid gestegen tegen ${basisRef}::${fout.map((g) => `${g.waar}: ${g.id} ${g.van ?? ""}->${g.naar}`).join(", ")}. Los het op, of zet de stijging met een reden in site/sources/${VAAGHEID_FILE} (aanvaard).`);
      process.exitCode = 1;
    }
  }
}
