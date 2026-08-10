import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

export function loadExpandedAgendaItems(rootDir) {
  const source = fs.readFileSync(path.join(rootDir, "site", "agenda.js"), "utf8").replace(/\nrender\(\);\s*$/, "");
  let expandedItems = [];
  const context = {
    Date,
    Intl,
    window: {
      PUBLIC_AGENDA_REFRESH_ENGINE: {
        reconcileAgendaItems(items) {
          expandedItems = structuredClone(items);
          return {
            publicItems: items,
            counts: { expired: 0, current: 0, future: 0, review_required: 0 },
          };
        },
        config: { retrievedAt: "2026-08-10T09:08:00Z" },
      },
      setTimeout() {},
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
