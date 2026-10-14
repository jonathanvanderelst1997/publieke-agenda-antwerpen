import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateEventContract } from "../lib/event-contract.mjs";
import { loadAgendaItemsFromSource } from "./load-agenda-source.mjs";
import { controleerAgendaInhoud, leesInhoudBronnen, logInhoudRapport } from "./audit-inhoud-kwaliteit.mjs";

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
// Eén gezamenlijke CI-controle en dagelijks rapport: ook wanneer de bron ontbreekt of onleesbaar is.
let contentOk = true;
try {
  const inhoud = controleerAgendaInhoud(leesInhoudBronnen(root));
  logInhoudRapport(inhoud);
  contentOk = inhoud.ok;
} catch (err) {
  console.error("::error title=Agenda-inhoud::Inhoudscontrole niet uitgevoerd:", err?.message || "onbekende fout");
  contentOk = false;
}
if (!report.ok || !contentOk) process.exitCode = 1;
