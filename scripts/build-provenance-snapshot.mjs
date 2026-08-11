import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadExpandedAgendaItems, loadRefreshEngine } from "./agenda-source.mjs";
import { buildProvenanceSlaMatrix } from "./provenance-sla.mjs";
import { buildProvenanceSnapshot } from "./provenance-snapshot.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const items = loadExpandedAgendaItems(rootDir);
const engine = loadRefreshEngine(rootDir);
const matrix = buildProvenanceSlaMatrix(items, engine);
const { snapshot, diff } = buildProvenanceSnapshot(items, engine, matrix);
const auditDir = path.join(rootDir, "audit");
fs.mkdirSync(auditDir, { recursive: true });
fs.writeFileSync(path.join(auditDir, "provenance-source-snapshot-20260811.json"), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
fs.writeFileSync(path.join(auditDir, "provenance-source-diff-20260811.json"), `${JSON.stringify(diff, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  sourceItemCount: snapshot.sourceItemCount,
  sourceDigest: snapshot.sourceDigest,
  matrixDigest: diff.matrixDigest,
  counts: diff.counts,
}, null, 2));
