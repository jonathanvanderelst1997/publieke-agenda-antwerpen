import vm from "node:vm";
import { readFile } from "node:fs/promises";

export async function loadAgendaItemsFromSource(file) {
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
  return structuredClone(items);
}
