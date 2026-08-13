import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

export function loadExpandedAgendaItems(rootDir) {
  const fullSource = fs.readFileSync(path.join(rootDir, "site", "agenda.js"), "utf8");
  const renderBoundary = fullSource.lastIndexOf("\nrender();");
  if (renderBoundary < 0) throw new Error("Agenda render boundary ontbreekt.");
  const source = fullSource.slice(0, renderBoundary);
  let expandedItems = [];
  const context = {
    Date,
    Intl,
    URL,
    window: {
      location: { href: "http://localhost/" },
      history: { replaceState() {} },
      setTimeout() {},
      PUBLIC_AGENDA_REFRESH_ENGINE: {
        reconcileAgendaItems(items) {
          expandedItems = structuredClone(items);
          return {
            publicItems: items,
            counts: { expired: 0, current: 0, future: 0, review_required: 0 },
          };
        },
        config: { retrievedAt: "2026-08-13T13:24:19Z" },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "site/agenda.js" });
  return expandedItems;
}

export function loadRefreshEngine(rootDir) {
  const source = fs.readFileSync(path.join(rootDir, "site", "agenda-refresh.js"), "utf8");
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "site/agenda-refresh.js" });
  return context.window.PUBLIC_AGENDA_REFRESH_ENGINE;
}
