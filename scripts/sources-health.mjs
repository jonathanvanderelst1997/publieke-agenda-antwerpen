// Eén regel per bron uit site/sources/refresh-status.json. Exitcode 1 als een bron op "error" staat
// met een blijvende fout (ook errorCode suspicious_drop), verouderd is (ophaalmoment + maxAgeHours ligt
// vóór het moment van controle), of als een bronbestand veel minder komende items heeft dan de
// vastgelegde versie. Een TIJDELIJKE fout (5xx, 429, time-out) met vorige data binnen maxAgeHours is
// "stale": een waarschuwing, geen fout (sourceHealthOf in lib/fetch-util.mjs).
// Een bron die antwoordt maar al 3 kalenderdagen op rij niets komends levert (0 items of alleen voorbije), is
// "leeg": ook een waarschuwing (oranje), geen fout (contentStatusOf in scripts/stale-policy.mjs). Op een
// GitHub-runner komt er per lege bron een ::warning bij.
//
// Het controlemoment is nu; met --at <ISO> kan een ander moment gekozen worden.
// De krimpcontrole vergelijkt met `git show <ref>:site/sources/<bron>.json`, standaard HEAD
// (--baseline <ref> kiest een andere, --no-baseline slaat ze over). Dat is een tweede slot naast de
// grendel in de fetchers: ook een fetcher die zich vergist, kan zo geen lege agenda live zetten.
// Een bewuste daling laat de eigenaar toe met AGENDA_ALLOW_DROP=<sourceId>[,<sourceId>…].
// Een bron met shrinkGuard: false in lib/source-feed.mjs (stad-districten) wordt niet vergeleken.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { dropAllowed, isMainModule, sourceHealthOf, suspiciousDrop } from "../lib/fetch-util.mjs";
import { brusselsDate } from "../lib/html-text.mjs";
import { SOURCE_IDS, shrinkGuardFor, sourceFileName, validateRefreshStatus } from "../lib/source-feed.mjs";
import { contentStatusOf } from "./stale-policy.mjs";

export function gitBaseline(rootDir, ref) {
  return (sourceId) => {
    try {
      const text = execFileSync("git", ["show", `${ref}:site/${sourceFileName(sourceId)}`], { cwd: rootDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      return JSON.parse(text);
    } catch {
      return null;
    }
  };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// Geeft { lines, warnings, unhealthy, exitCode } terug; schrijft niets.
export function checkHealth({ rootDir, at = Date.now(), env = process.env, baseline = null, baselineLabel = "HEAD" }) {
  const lines = [];
  const file = path.join(rootDir, "site", "sources", "refresh-status.json");
  if (!fs.existsSync(file)) return { lines: ["refresh-status\tontbreekt"], unhealthy: 1, exitCode: 1 };
  const status = readJson(file);
  const errors = status ? validateRefreshStatus(status) : ["geen geldige JSON"];
  if (errors.length) return { lines: errors.map((error) => `refresh-status\tongeldig\t${error}`), unhealthy: 1, exitCode: 1 };
  if (!Number.isFinite(at)) return { lines: ["sources-health\tongeldig --at"], unhealthy: 1, exitCode: 2 };

  let unhealthy = 0;
  const warnings = [];
  const asOfDay = brusselsDate(new Date(at));
  for (const entry of status.sources) {
    const fetched = sourceHealthOf(entry, at);
    const health = fetched === "ok" && contentStatusOf({ emptySince: entry.emptySince, today: asOfDay }) === "leeg" ? "leeg" : fetched;
    if (health === "error" || health === "expired") unhealthy += 1;
    if (health === "leeg") {
      const what = entry.itemCount ? `${entry.itemCount} items, allemaal voorbij` : "0 items";
      warnings.push(`${entry.sourceId}: sinds ${entry.emptySince} niets komends (${what})`);
    }
    const coverage = entry.capped ? `capped=t/m ${entry.coverageUntil ?? "-"}` : "";
    const content = Number.isInteger(entry.upcomingCount) ? [`upcoming=${entry.upcomingCount}`, entry.emptySince ? `emptySince=${entry.emptySince}` : ""] : [];
    lines.push([entry.sourceId, health, entry.fetchStatus, `items=${entry.itemCount}`, ...content, `retrievedAt=${entry.retrievedAt ?? "-"}`, entry.errorCode ? `errorCode=${entry.errorCode}` : "", coverage].filter(Boolean).join("\t"));
  }

  if (baseline) {
    const today = brusselsDate(new Date(at));
    let compared = 0;
    for (const sourceId of SOURCE_IDS) {
      // stad-districten: gezond is "elk kanaal antwoordde", niet het aantal items.
      if (!shrinkGuardFor(sourceId)) continue;
      const before = baseline(sourceId);
      const now = readJson(path.join(rootDir, "site", sourceFileName(sourceId)));
      if (!before || !now) continue;
      compared += 1;
      const drop = suspiciousDrop(before.items, now.items, today);
      if (!drop) continue;
      if (dropAllowed(env, sourceId)) {
        lines.push(`${sourceId}\tdrop-allowed\tkomend ${drop.before} -> ${drop.after} t.o.v. ${baselineLabel}`);
        continue;
      }
      unhealthy += 1;
      lines.push(`${sourceId}\tdrop\tkomend ${drop.before} -> ${drop.after} t.o.v. ${baselineLabel} (errorCode=suspicious_drop)`);
    }
    if (!compared) lines.push(`krimpcontrole\tniet beschikbaar\tgeen vastgelegde versie op ${baselineLabel}`);
  }
  return { lines, warnings, unhealthy, exitCode: unhealthy ? 1 : 0 };
}

if (isMainModule(import.meta.url)) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const args = process.argv.slice(2);
  const atFlag = args.indexOf("--at");
  const at = atFlag >= 0 ? Date.parse(args[atFlag + 1]) : Date.now();
  const baselineFlag = args.indexOf("--baseline");
  const ref = baselineFlag >= 0 ? args[baselineFlag + 1] : "HEAD";
  const baseline = args.includes("--no-baseline") ? null : gitBaseline(rootDir, ref);
  const result = checkHealth({ rootDir, at, baseline, baselineLabel: ref });
  for (const line of result.lines) console.log(line);
  // Oranje in de run van GitHub: een lege bron is een melding, geen fout.
  if (process.env.GITHUB_ACTIONS === "true") for (const warning of result.warnings ?? []) console.log(`::warning title=Bron leeg::${warning}`);
  process.exitCode = result.exitCode;
}
