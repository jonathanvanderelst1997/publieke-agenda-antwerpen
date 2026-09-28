// Eén regel per bron uit site/sources/refresh-status.json. Exitcode 1 als een bron op "error" staat
// of verouderd is (ophaalmoment + maxAgeHours ligt vóór het moment van controle).
// Het controlemoment is nu; met --at <ISO> kan een ander moment gekozen worden.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateRefreshStatus } from "../lib/source-feed.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(rootDir, "site", "sources", "refresh-status.json");
if (!fs.existsSync(file)) {
  console.log("refresh-status\tontbreekt");
  process.exit(1);
}
const status = JSON.parse(fs.readFileSync(file, "utf8"));
const errors = validateRefreshStatus(status);
if (errors.length) {
  for (const error of errors) console.log(`refresh-status\tongeldig\t${error}`);
  process.exit(1);
}
const atFlag = process.argv.indexOf("--at");
const at = atFlag >= 0 ? Date.parse(process.argv[atFlag + 1]) : Date.now();
if (!Number.isFinite(at)) {
  console.log("sources-health\tongeldig --at");
  process.exit(2);
}
let unhealthy = 0;
for (const entry of status.sources) {
  const inactive = ["skipped_no_key", "disabled", "test_only"].includes(entry.fetchStatus);
  const retrievedMs = Date.parse(entry.retrievedAt ?? "");
  const stale = !inactive && (!Number.isFinite(retrievedMs) || at > retrievedMs + entry.maxAgeHours * 3_600_000);
  let health = "ok";
  if (entry.fetchStatus === "error") health = "error";
  else if (stale) health = "stale";
  else if (inactive) health = "inactive";
  if (health === "error" || health === "stale") unhealthy += 1;
  console.log([entry.sourceId, health, entry.fetchStatus, `items=${entry.itemCount}`, `retrievedAt=${entry.retrievedAt ?? "-"}`, entry.errorCode ? `errorCode=${entry.errorCode}` : ""].filter(Boolean).join("\t"));
}
if (unhealthy) process.exitCode = 1;
