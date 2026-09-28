// Draait elke fetcher in vaste volgorde (lib/source-registry.mjs) en schrijft daarna
// site/sources/refresh-status.json (contract C3). Alleen dit script schrijft dat bestand.
// Een fetcher die crasht, krijgt fetchStatus "error"; zijn vorige data blijft staan.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { errorCodeOf, isMainModule, readSourceDocument, serialize, statusEntry } from "../lib/fetch-util.mjs";
import { brusselsDate } from "../lib/html-text.mjs";
import { FETCHERS } from "../lib/source-registry.mjs";
import { validateRefreshStatus } from "../lib/source-feed.mjs";

// `sleep` (optioneel) gaat naar fetchers die pauzeren tussen verzoeken; toetsen geven een lege pauze mee.
export async function refreshAll({ fetch: fetchImpl = globalThis.fetch, clock = () => new Date(), rootDir, env = process.env, log = console.log, fetchers = FETCHERS, sleep } = {}) {
  const statuses = [];
  for (const fetcher of fetchers) {
    try {
      const module = await fetcher.load();
      const result = await module.run({ fetch: fetchImpl, clock, rootDir, env, log, ...(sleep ? { sleep } : {}) });
      statuses.push(...result);
    } catch (error) {
      const code = errorCodeOf(error) === "unexpected_error" ? "fetcher_crashed" : errorCodeOf(error);
      log(JSON.stringify({ fetcher: fetcher.name, fetchStatus: "error", errorCode: code }));
      for (const sourceId of fetcher.sourceIds) {
        const previous = readSourceDocument(rootDir, sourceId);
        statuses.push(statusEntry(sourceId, { fetchStatus: "error", retrievedAt: previous?.retrievedAt ?? null, itemCount: previous?.items?.length ?? 0, errorCode: code }));
      }
    }
  }
  const generated = clock();
  const status = {
    schemaVersion: 1,
    generatedAt: generated.toISOString(),
    classificationAsOf: brusselsDate(generated),
    sources: statuses.sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
  };
  const errors = validateRefreshStatus(status);
  if (errors.length) throw new Error(`refresh-status is ongeldig: ${errors.slice(0, 3).join("; ")}`);
  const file = path.join(rootDir, "site", "sources", "refresh-status.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, serialize(status), "utf8");
  return status;
}

if (isMainModule(import.meta.url)) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  refreshAll({ rootDir })
    .then((status) => {
      for (const entry of status.sources) {
        console.log(JSON.stringify({ sourceId: entry.sourceId, fetchStatus: entry.fetchStatus, itemCount: entry.itemCount, errorCode: entry.errorCode }));
      }
    })
    .catch((error) => {
      console.error(error?.message ?? String(error));
      process.exitCode = 1;
    });
}
