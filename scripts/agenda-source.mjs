import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

// Classificatiedatum als er nog geen feed is (laatste handmatige broncontrole).
export const FALLBACK_CLASSIFICATION_AS_OF = "2026-09-16";

export const EMPTY_FEED = Object.freeze({
  schemaVersion: 1,
  generatedAt: null,
  classificationAsOf: null,
  sources: Object.freeze([]),
  items: Object.freeze([]),
  supersedes: Object.freeze([]),
});

// `npm run check` mag de klok niet lezen. Deze Date weigert new Date() en Date.now() zonder
// argument, zodat een klokafhankelijkheid in de site-code meteen als fout zichtbaar wordt.
export function noClockDate() {
  return class NoClockDate extends Date {
    constructor(...args) {
      if (!args.length) throw new Error("De klok mag niet gelezen worden tijdens npm run check.");
      super(...args);
    }

    static now() {
      throw new Error("De klok mag niet gelezen worden tijdens npm run check.");
    }
  };
}

export function loadAgendaFeed(rootDir) {
  const file = path.join(rootDir, "site", "agenda-feed.js");
  if (!fs.existsSync(file)) return structuredClone({ ...EMPTY_FEED });
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: "site/agenda-feed.js", timeout: 2_000 });
  return JSON.parse(JSON.stringify(context.window.PUBLIC_AGENDA_FEED ?? EMPTY_FEED));
}

function runAgendaScript(rootDir, feed, { hostname = "localhost" } = {}) {
  const fullSource = fs.readFileSync(path.join(rootDir, "site", "agenda.js"), "utf8");
  const renderBoundary = fullSource.lastIndexOf("\nrender();");
  if (renderBoundary < 0) throw new Error("Agenda render boundary ontbreekt.");
  const source = fullSource.slice(0, renderBoundary);
  const asOf = feed.classificationAsOf ?? FALLBACK_CLASSIFICATION_AS_OF;
  let expandedItems = [];
  const context = {
    Date: noClockDate(),
    Intl,
    URL,
    window: {
      location: { href: `http://${hostname}/`, hostname },
      history: { replaceState() {} },
      setTimeout() {},
      PUBLIC_AGENDA_FEED: feed,
      PUBLIC_AGENDA_CLOCK: () => new Date(`${asOf}T12:00:00Z`),
      PUBLIC_AGENDA_REFRESH_ENGINE: {
        reconcileAgendaItems(items) {
          expandedItems = structuredClone(items);
          return {
            auditItems: items,
            publicItems: items,
            counts: { expired: 0, current: 0, future: 0, review_required: 0 },
            sourceFreshness: [],
          };
        },
        config: { retrievedAt: "2026-08-13T13:24:19Z", classificationAsOf: asOf, sources: {} },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "site/agenda.js" });
  return { items: expandedItems, context };
}

// Handmatige items (uitgevouwen), zonder vervangen items, plus de items uit site/agenda-feed.js.
export function loadExpandedAgendaItems(rootDir) {
  return runAgendaScript(rootDir, loadAgendaFeed(rootDir)).items;
}

// Alleen de handmatige items uit site/agenda.js, uitgevouwen zoals de site dat doet.
export function loadHandAgendaItems(rootDir) {
  return runAgendaScript(rootDir, structuredClone({ ...EMPTY_FEED })).items;
}

// De functies van site/agenda.js (eventTemplate …) voor toetsen, zonder DOM.
export function loadAgendaRuntime(rootDir, { feed = structuredClone({ ...EMPTY_FEED }), hostname = "localhost" } = {}) {
  return runAgendaScript(rootDir, feed, { hostname }).context;
}

export function loadRefreshEngine(rootDir) {
  const source = fs.readFileSync(path.join(rootDir, "site", "agenda-refresh.js"), "utf8");
  const context = { Date: noClockDate(), URL, window: { PUBLIC_AGENDA_FEED: loadAgendaFeed(rootDir) } };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "site/agenda-refresh.js" });
  return context.window.PUBLIC_AGENDA_REFRESH_ENGINE;
}
