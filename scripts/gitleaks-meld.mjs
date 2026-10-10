// gitleaks in meldstand: de standaardregels plus de eigen privacyregels uit .gitleaks.toml.
// Toont ALLEEN aantallen per regel en bestandsnamen, nooit de gevonden waarde, de tekstregel
// of de commitauteur: deze repo is publiek, en het CI-logboek ook. Het rapport van gitleaks
// blijft in een tijdelijke map en wordt meteen gewist; het wordt nergens opgeladen.
//
// Gebruik (vanuit eender welke map):
//   node scripts/gitleaks-meld.mjs boom            wat nu in de werkboom staat
//   node scripts/gitleaks-meld.mjs commits A..B    wat de commits A..B toevoegen
//
// gitleaks zelf: GITLEAKS_BIN, anders "gitleaks" op het PATH. Ontbreekt het, dan zegt het
// script hoe je het krijgt en stopt het met code 0 (meldstand: niets houdt je tegen).
// Exitcode 0, ook bij vondsten. 1 als gitleaks zelf faalt (bv. een fout in .gitleaks.toml),
// 2 bij verkeerd gebruik.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isMainModule } from "../lib/fetch-util.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_BESTANDEN = 200;

// Een revisiebereik voor git log, en niets dat git als optie kan lezen.
const BEREIK = /^[0-9A-Za-z][0-9A-Za-z._/^~-]*\.\.\.?[0-9A-Za-z][0-9A-Za-z._/^~-]*$/;

// Een bestandsnaam komt uit de repo (of uit een PR van een fork). Geen stuurtekens, zodat een
// naam nooit een eigen regel in het logboek begint (en dus geen ::opdracht:: kan zijn).
const veilig = (tekst) => String(tekst ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, "?");

/** Telt een gitleaks-rapport: per regel en per bestand. Leest alleen RuleID en File. */
export function telVondsten(rapport) {
  const perRegel = new Map();
  const perBestand = new Map();
  for (const vondst of Array.isArray(rapport) ? rapport : []) {
    const regel = veilig(vondst?.RuleID || "onbekend");
    const bestand = veilig(vondst?.File || "(stdin)");
    perRegel.set(regel, (perRegel.get(regel) ?? 0) + 1);
    const regels = perBestand.get(bestand) ?? new Map();
    regels.set(regel, (regels.get(regel) ?? 0) + 1);
    perBestand.set(bestand, regels);
  }
  const totaal = [...perRegel.values()].reduce((som, n) => som + n, 0);
  const regels = [...perRegel.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const bestanden = [...perBestand.entries()]
    .map(([bestand, telling]) => ({ bestand, totaal: [...telling.values()].reduce((s, n) => s + n, 0), regels: [...telling.entries()].sort((a, b) => a[0].localeCompare(b[0])) }))
    .sort((a, b) => b.totaal - a.totaal || a.bestand.localeCompare(b.bestand));
  return { totaal, regels, bestanden };
}

/** De tekst voor het logboek: elke regel begint met een spatie of een vaste kop. */
export function meldTekst({ totaal, regels, bestanden }, kop) {
  const uit = [`${kop}: ${totaal} vondst(en).`];
  if (totaal === 0) return uit.join("\n");
  uit.push("Per regel:");
  for (const [regel, n] of regels) uit.push(`  ${regel}: ${n}`);
  uit.push("Per bestand (aantal per regel, geen inhoud):");
  for (const { bestand, regels: telling } of bestanden.slice(0, MAX_BESTANDEN)) {
    uit.push(`  ${bestand}  ${telling.map(([regel, n]) => `${regel} ${n}`).join(", ")}`);
  }
  if (bestanden.length > MAX_BESTANDEN) uit.push(`  ... en nog ${bestanden.length - MAX_BESTANDEN} bestand(en).`);
  return uit.join("\n");
}

function samenvattingMarkdown({ totaal, regels, bestanden }, kop) {
  const cel = (tekst) => veilig(tekst).replace(/[|`<>]/g, "_");
  const uit = [`### ${kop}`, "", `${totaal} vondst(en). Meldstand: dit houdt niets tegen. Alleen aantallen en bestandsnamen, nooit de inhoud.`, ""];
  if (totaal === 0) return uit.join("\n") + "\n";
  uit.push("| Regel | Aantal |", "| --- | ---: |");
  for (const [regel, n] of regels) uit.push(`| ${cel(regel)} | ${n} |`);
  uit.push("", "| Bestand | Vondsten |", "| --- | --- |");
  for (const { bestand, regels: telling } of bestanden.slice(0, MAX_BESTANDEN)) {
    uit.push(`| ${cel(bestand)} | ${telling.map(([regel, n]) => `${cel(regel)} ${n}`).join(", ")} |`);
  }
  if (bestanden.length > MAX_BESTANDEN) uit.push(`| ... | nog ${bestanden.length - MAX_BESTANDEN} bestand(en) |`);
  return uit.join("\n") + "\n";
}

const HULP = [
  "gitleaks ontbreekt. Gratis (MIT), werkt offline:",
  "  https://github.com/gitleaks/gitleaks/releases (linux_x64, darwin_arm64, ...)",
  "  of: brew install gitleaks",
  "Zet het op het PATH of wijs het aan met GITLEAKS_BIN=/pad/naar/gitleaks.",
].join("\n");

export function main(argv = process.argv.slice(2), env = process.env) {
  const [modus, bereik] = argv;
  if (!(modus === "boom" && argv.length === 1) && !(modus === "commits" && argv.length === 2 && BEREIK.test(bereik ?? ""))) {
    console.error("Gebruik: node scripts/gitleaks-meld.mjs boom | commits <basis>..<kop>");
    return 2;
  }
  const bin = env.GITLEAKS_BIN || "gitleaks";
  const versie = spawnSync(bin, ["version"], { encoding: "utf8" });
  if (versie.error || versie.status !== 0) {
    console.log(HULP);
    return 0;
  }
  const map = fs.mkdtempSync(path.join(os.tmpdir(), "gitleaks-meld-"));
  const rapportPad = path.join(map, "rapport.json");
  try {
    const gemeen = ["--config", path.join(rootDir, ".gitleaks.toml"), "--no-banner", "--redact", "--exit-code", "0", "--log-level", "error", "--report-format", "json", "--report-path", rapportPad];
    const args = modus === "boom" ? ["dir", ".", ...gemeen] : ["git", ".", "--log-opts", bereik, ...gemeen];
    // Vanuit de wortel van de repo: dan zijn de bestandsnamen relatief (site/..., tests/...) en
    // werken de paden in de allowlists.
    const scan = spawnSync(bin, args, { cwd: rootDir, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    if (scan.error || scan.status !== 0) {
      // Alleen de foutmelding van gitleaks zelf; met --redact staat daar geen gevonden waarde in.
      console.log(`gitleaks faalde (code ${scan.status ?? "?"}):`);
      const fout = String(scan.stderr || scan.error?.message || "").split(/\r?\n/).filter((regel) => regel.trim());
      for (const regel of fout.slice(0, 20)) console.log(`  ${veilig(regel)}`);
      if (env.GITHUB_ACTIONS === "true") console.log("::warning title=gitleaks (meldt)::gitleaks zelf faalde; zie het logboek van deze stap.");
      return 1;
    }
    const rapport = JSON.parse(fs.readFileSync(rapportPad, "utf8"));
    const telling = telVondsten(rapport);
    const kop = `gitleaks ${veilig(versie.stdout.trim())}, ${modus === "boom" ? "werkboom" : `commits ${bereik}`}`;
    console.log(meldTekst(telling, kop));
    if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, samenvattingMarkdown(telling, kop));
    if (env.GITHUB_ACTIONS === "true" && telling.totaal > 0) {
      const kort = telling.regels.map(([regel, n]) => `${regel} ${n}`).join(", ");
      console.log(`::warning title=gitleaks (meldt)::${modus === "boom" ? "Werkboom" : "Nieuwe commits"}: ${telling.totaal} vondst(en): ${kort}. Zie de samenvatting; geen inhoud in het logboek.`);
    }
    return 0;
  } finally {
    fs.rmSync(map, { recursive: true, force: true });
  }
}

if (isMainModule(import.meta.url)) process.exitCode = main();
