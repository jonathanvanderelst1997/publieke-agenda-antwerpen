import vm from "node:vm";
import path from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { normalized, parseEventTimes } from "../lib/event-contract.mjs";

async function loadFeed(file) {
  if (!existsSync(file)) return { items: [], supersedes: [] };
  const context = { window: {} };
  vm.runInNewContext(await readFile(file, "utf8"), context, { timeout: 1_000 });
  const feed = context.window.PUBLIC_AGENDA_FEED ?? {};
  return {
    items: Array.isArray(feed.items) ? JSON.parse(JSON.stringify(feed.items)) : [],
    supersedes: Array.isArray(feed.supersedes) ? [...feed.supersedes] : [],
  };
}

function contractSignature(item) {
  return [normalized(item.title), item.date, parseEventTimes(item.timeSlot, item.timeText).startTime || "unknown", normalized(item.location)].join("|");
}

// Handmatige items uit site/agenda.js, min de items die een feed-item vervangt, plus de feed-items
// uit site/agenda-feed.js (naast het bronbestand). Een handmatig item dat exact hetzelfde punt is als
// een feed-item (zelfde titel, datum, begin en locatie) laat het feed-item voorgaan.
export async function loadAgendaItemsFromSource(file, { feedFile = path.join(path.dirname(file), "agenda-feed.js") } = {}) {
  const source = await readFile(file, "utf8");
  const marker = "const agendaItems =";
  const start = source.indexOf(marker);
  if (start < 0) throw new Error("agendaItems ontbreekt.");
  const arrayStart = source.indexOf("[", start + marker.length);
  const arrayEnd = source.indexOf("\n];", arrayStart);
  if (arrayStart < 0 || arrayEnd < 0) throw new Error("agendaItems kon niet veilig worden afgebakend.");
  const expression = source.slice(arrayStart, arrayEnd + 2);
  const items = vm.runInNewContext(`(${expression})`, Object.create(null), { timeout: 1_000 });
  if (!Array.isArray(items)) throw new Error("agendaItems is geen array.");
  const feed = await loadFeed(feedFile);
  const superseded = new Set(feed.supersedes);
  const feedSignatures = new Set(feed.items.map(contractSignature));
  const handItems = structuredClone(items).filter((item) => !superseded.has(item.id) && !feedSignatures.has(contractSignature(item)));
  return [...handItems, ...feed.items];
}
