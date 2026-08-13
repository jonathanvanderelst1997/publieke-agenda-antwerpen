import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadExpandedAgendaItems, loadRefreshEngine } from "./agenda-source.mjs";
import { buildProvenanceSlaMatrix } from "./provenance-sla.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const matrix = buildProvenanceSlaMatrix(loadExpandedAgendaItems(rootDir), loadRefreshEngine(rootDir));
const auditDir = path.join(rootDir, "audit");
fs.mkdirSync(auditDir, { recursive: true });
fs.writeFileSync(path.join(auditDir, "provenance-expiry-sla.json"), `${JSON.stringify(matrix, null, 2)}\n`, "utf8");

const rows = matrix.items.map((item, index) =>
  `| ${index + 1} | ${item.id.replaceAll("|", "\\|")} | ${item.eventDate} | ${item.classification} | ${item.sourceId} | ${item.verificationState} | ${item.maxAgeDays ?? "-"} | ${item.recheckDueOn ?? "-"} | ${item.slaStatus} | ${item.publishEligible ? "ja" : "nee"} |`,
);
const markdown = `# Bronprovenance- en verval-SLA-matrix\n\n` +
  `Status: lokale audit, niet gepubliceerd. Classificatie op ${matrix.classificationAsOf}; geverifieerde bronsnapshot ${matrix.verifiedSourceSnapshotAt}.\n\n` +
  `- Bronitems: ${matrix.sourceItemCount}\n` +
  `- Fail-closed lokale kandidaat: ${matrix.localCandidateCount}\n` +
  `- Classificaties: ${Object.entries(matrix.classifications).map(([key, value]) => `${key}=${value}`).join(", ")}\n` +
  `- SLA-statussen: ${Object.entries(matrix.slaStatuses).map(([key, value]) => `${key}=${value}`).join(", ")}\n\n` +
  `Alleen een huidig/toekomstig item met een officiële geverifieerde bron binnen zijn hercontroletermijn is publiceerbaar in de lokale kandidaat. Verlopen, onzekere en stale items blijven fail-closed.\n\n` +
  `| # | Item-ID | Datum | Classificatie | Bron-ID | Verificatie | SLA dagen | Hercontrole uiterlijk | SLA-status | Kandidaat |\n` +
  `|---:|---|---|---|---|---|---:|---|---|---|\n${rows.join("\n")}\n`;
fs.writeFileSync(path.join(auditDir, "provenance-expiry-sla.md"), markdown, "utf8");

console.log(JSON.stringify({ sourceItemCount: matrix.sourceItemCount, localCandidateCount: matrix.localCandidateCount, classifications: matrix.classifications, slaStatuses: matrix.slaStatuses }, null, 2));
