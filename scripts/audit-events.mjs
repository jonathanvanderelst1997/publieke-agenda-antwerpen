import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateEventContract } from "../lib/event-contract.mjs";
import { loadAgendaItemsFromSource } from "./load-agenda-source.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const events = await loadAgendaItemsFromSource(path.join(root, "site", "agenda.js"));
const report = validateEventContract(events);
const safeReport = {
  schema: "public-agenda-event-contract-report/v1",
  counts: {
    events: report.events.length,
    errors: report.errors.length,
    warnings: report.warnings.length,
    unconfirmedStart: report.warnings.filter((item) => item.code === "unconfirmed_start").length,
  },
  errors: report.errors,
  warnings: report.warnings,
};
await writeFile(path.join(root, "EVENT_CONTRACT_REPORT.json"), `${JSON.stringify(safeReport, null, 2)}\n`, "utf8");
console.log(JSON.stringify(safeReport.counts));
if (!report.ok) process.exitCode = 1;
