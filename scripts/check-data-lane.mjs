// Gebruik: git diff --name-status -M0 <basis> | node scripts/check-data-lane.mjs
//      of: node scripts/check-data-lane.mjs --file <pad>
// Eén regel per schending en verder niets; exitcode 1 bij minstens één schending (ook bij een lege wijziging).
import fs from "node:fs";

import { checkDataLane, formatViolation } from "../lib/data-lane.mjs";

const spec = JSON.parse(fs.readFileSync(new URL("../lib/data-lane-paths.json", import.meta.url), "utf8"));
const fileFlag = process.argv.indexOf("--file");
let input = "";
if (fileFlag >= 0) {
  const file = process.argv[fileFlag + 1];
  if (!file) {
    console.error("usage_error\t\t--file vraagt een pad");
    process.exit(2);
  }
  input = fs.readFileSync(file, "utf8");
} else if (!process.stdin.isTTY) {
  input = fs.readFileSync(0, "utf8");
}

const violations = checkDataLane(input.split(/\r?\n/), spec);
for (const violation of violations) console.log(formatViolation(violation));
if (violations.length) process.exitCode = 1;
