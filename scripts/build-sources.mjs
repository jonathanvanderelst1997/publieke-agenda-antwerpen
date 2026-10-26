// Bouwt site/agenda-feed.js uit site/sources/*.json. Deterministisch en offline: geen klok, geen netwerk.
// Valideert elk bronbestand (schema, https, toegelaten hosts, retrievedAt, privacy), voegt samen en
// ontdubbelt met de handmatige items, en schrijft het resultaat als window.PUBLIC_AGENDA_FEED.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalized, parseEventTimes } from "../lib/event-contract.mjs";
import { dutchDateLabel } from "../lib/html-text.mjs";
import { EVENEMENT_BESLUITEN_FILE } from "../lib/ebesluit-evenementen.mjs";
import { mergeEvents } from "../lib/merge-events.mjs";
import { MANUAL_CHECK_FILE, manualCheckForFeed, validateManualCheck } from "../lib/manual-check.mjs";
import { SOURCE_DEFINITIONS, validateRefreshStatus, validateSourceDocument, zonderRuweGipodBron } from "../lib/source-feed.mjs";
import { KAART_UITLEG_FILE } from "../lib/kaart-uitleg-validatie.mjs";
import { EVENEMENT_IDENTITEIT_FILE } from "../lib/evenement-identiteit-validatie.mjs";
import { INZAGE_STATUS_FILE } from "../site/inzage-status.js";
import { VAAGHEID_FILE } from "../lib/vaagheid.mjs";
import { HERKENNING_FILE, PATRONEN_FILE } from "../lib/evenement-herkenning-validatie.mjs";
import { loadHandAgendaItems } from "./agenda-source.mjs";
import { ASIGN_EVENEMENTEN_SOURCE_ID, oudeTekstBijwerken, tekstUitFeiten } from "../lib/asign-evenementen-agenda.mjs";
import { plekEnUurUitTekst } from "../lib/plek-uit-tekst.mjs";

export const FEED_HEADER = "// Gegenereerd door scripts/build-sources.mjs; niet met de hand wijzigen.";

export function readSources(rootDir) {
  const sourcesDir = path.join(rootDir, "site", "sources");
  if (!fs.existsSync(sourcesDir)) return { status: null, documents: [], manualCheck: null };
  // kaart-uitleg.json, evenement-identiteit.json en de automatische herkenning (evenement-identiteit-auto.json,
  // evenement-patronen.json) zijn geen agendabronnen maar uitleg bij de live lagen (lib/kaart-uitleg-refresh.mjs,
  // de met de hand nagekeken identiteit van evenementendossiers en lib/parcours-herkenning-refresh.mjs);
  // inzage-status.json is de nagekeken stand in het Inzageloket (site/inzage-status.js).
  // vaagheid.json is de vaagheidsmeting van de verversing (scripts/meet-vaagheid.mjs), geen bron.
  const geenBron = [KAART_UITLEG_FILE, EVENEMENT_IDENTITEIT_FILE, INZAGE_STATUS_FILE, HERKENNING_FILE, PATRONEN_FILE, VAAGHEID_FILE];
  const names = fs.readdirSync(sourcesDir).filter((name) => name.endsWith(".json") && !geenBron.includes(name)).sort();
  let status = null;
  let manualCheck = null;
  const documents = [];
  const problems = [];
  for (const name of names) {
    // De gelezen eBesluit-besluiten zijn geen agendabron; hun agendapunten staan in
    // district-ebesluit-evenementen.json (scripts/validate-data.mjs controleert het bestand).
    if (name === EVENEMENT_BESLUITEN_FILE) continue;
    // Een aanvulling (AWV-werfdata, lib/awv-werf.mjs) maakt geen agendapunten; de werkenlaag in de browser
    // leest het bestand zelf. scripts/validate-data.mjs controleert het.
    if (SOURCE_DEFINITIONS[name.replace(/\.json$/, "")]?.aanvulling) continue;
    const file = path.join(sourcesDir, name);
    let json;
    try {
      json = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      problems.push(`${name}: geen geldige JSON`);
      continue;
    }
    if (name === "refresh-status.json") {
      for (const error of validateRefreshStatus(json)) problems.push(`${name}: ${error}`);
      status = json;
      continue;
    }
    if (name === MANUAL_CHECK_FILE) {
      for (const error of validateManualCheck(json)) problems.push(`${name}: ${error}`);
      manualCheck = json;
      continue;
    }
    const expectedSourceId = name.replace(/\.json$/, "");
    // Een GIPOD-bron van vóór 17 oktober 2026 linkte per item naar de ruwe rij: in de feed komt de datasetfiche
    // (lib/source-feed.mjs, zonderRuweGipodBron). De verversing schrijft het bronbestand zelf opnieuw.
    const { document } = zonderRuweGipodBron(json);
    for (const error of validateSourceDocument(document, { expectedSourceId })) problems.push(`${name}: ${error}`);
    documents.push(document);
  }
  if (problems.length) throw new Error(`Ongeldige brondata:\n${problems.slice(0, 20).join("\n")}`);
  return { status, documents, manualCheck };
}

function contractSignature(item) {
  return [normalized(item.title), item.date, parseEventTimes(item.timeSlot, item.timeText).startTime || "unknown", normalized(item.location)].join("|");
}

// Een agendapunt dat alleen uit de evenementendossiers van de stad komt en waarvan de aanvraag nog niet
// goedgekeurd is. Uit het veld nietGoedgekeurd (lib/asign-evenementen-agenda.mjs), of bij een bronbestand van
// vóór dat veld uit de vaste slotzin van de info ("...: aanvraag nog niet goedgekeurd."). Samengevoegd met een
// andere bron (een kalender, een besluit) is het een aangekondigd evenement: dan geen label.
const NIET_GOEDGEKEURD_ZIN = /\(A-Sign\)(?:, laatst gewijzigd op [^:]+)?: aanvraag nog niet goedgekeurd\.(?: Ook dossier ET\d{10}\.)*$/;
const alleenDossiers = (item = {}) => (Array.isArray(item.sources) && item.sources.length ? item.sources.map((s) => s?.sourceId) : [item.sourceId]).every((id) => id === "district-asign-evenementen");
// Een evenement dat een publieke bron aankondigt (de handfiche zegt "zeker", met een publieke link: AAAntwerp, de
// Papegay, Winter in Antwerpen) is ook een aangekondigd evenement, zoals bij een kalender of een besluit: geen label,
// wel een .ics en "Dit weekend". Alleen de inname op straat wacht in A-Sign; dat zegt de info (nakijkbevinding).
const aangekondigdInFiche = (item = {}, hand = null) => {
  const h = hand?.dossiers?.[String(item?.externalId || "").trim()];
  return h?.zekerheid === "zeker" && /^https:\/\//.test(String(h.link || "").trim());
};
export function nietGoedgekeurd(item = {}, hand = null) {
  if (!alleenDossiers(item) || aangekondigdInFiche(item, hand)) return false;
  // De slotzin van de info alleen bij een bronbestand van vóór het veld (zonder bewaarde feiten): een nieuwer bestand
  // zegt het met het veld, en samenVoegen haalt het weg als een dossier van de groep goedgekeurd is (nakijkbevinding:
  // de slotzin van het hoofddossier zette het label anders toch).
  return item.nietGoedgekeurd === true || (!item.feiten && NIET_GOEDGEKEURD_ZIN.test(String(item.info || "")));
}
// De straten van een goedgekeurd agendapunt die alleen een dossier raakt dat nog niet goedgekeurd is
// (lib/asign-evenementen-agenda.mjs, samenVoegen): de straatpagina toont daar het label. Niet bij een
// aangekondigd evenement (samengevoegd met een andere bron) en niet als het hele punt al het label heeft.
export function nietGoedgekeurdStraten(item = {}, hand = null) {
  if (!alleenDossiers(item) || aangekondigdInFiche(item, hand) || nietGoedgekeurd(item, hand) || !Array.isArray(item.nietGoedgekeurdStraten)) return [];
  const straten = new Set(Array.isArray(item.straten) ? item.straten : []);
  return item.nietGoedgekeurdStraten.filter((s) => straten.has(s));
}

// De straten van een agendapunt uit de evenementendossiers die een publieke bron zelf noemt: de handfiche van dat
// dossier (met de hand nagekeken: waar, uren en soort; niet "wat merk je", dat ook vergelijkt met elders) of het uur van het punt ("kratstapelen op de
// Groenplaats van 12 tot 17 uur"). Alleen voor een bronbestand van vóór `stratenVolledig` (dan hangt het punt anders
// alleen aan de straten uit zijn locatie): zo staat Winter in Antwerpen al op de Groenplaats, waar de fiche de
// kerstmarkt noemt, zonder de straten van een ouder bestand blind te vertrouwen (nakijkronde 13 oktober 2026).
export function stratenUitFiche(item = {}, hand = null) {
  if (item?.stratenVolledig === true || !Array.isArray(item?.straten) || !item.straten.length) return [];
  const h = hand?.dossiers?.[String(item?.externalId || "").trim()];
  const tekst = [h && h.zekerheid !== "onbekend" ? [h.waar, h.uren, h.soort].join(" ") : "", item.timeText].join(" ");
  const plat = (t) => ` ${String(t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  const bron = plat(tekst);
  if (!bron.trim()) return [];
  return [...new Set(item.straten.filter((n) => plat(n).trim() && bron.includes(plat(n))))];
}

// Tekst bij de build (vaagheidsplan van 12 oktober 2026, stap 6): titel en info van een agendapunt uit de
// evenementendossiers komen opnieuw uit zijn bewaarde feiten, met de code van nu (tekstUitFeiten); een bronbestand van
// vóór die feiten krijgt alleen de zinnen van nu in plaats van die van oudere code (oudeTekstBijwerken). `tekst`: de
// fiches en besluiten uit site/sources (laadTekstBronnen).
export function tekstBijDeBuild(item, tekst = null) {
  const nieuw = tekstUitFeiten(item, tekst || {});
  return nieuw ? { ...item, ...nieuw } : oudeTekstBijwerken(item, { hand: tekst?.hand || null });
}
export function laadTekstBronnen(rootDir) {
  const lees = (naam) => { try { return JSON.parse(fs.readFileSync(path.join(rootDir, "site", "sources", naam), "utf8")); } catch { return null; } };
  const besluiten = lees(EVENEMENT_BESLUITEN_FILE);
  return { hand: lees(EVENEMENT_IDENTITEIT_FILE), auto: lees(HERKENNING_FILE), besluiten: Array.isArray(besluiten?.besluiten) ? besluiten.besluiten : [] };
}

export function buildFeed({ status, documents: bronnen, manualCheck = null, tekst = null }, handItems) {
  // Plek en uur uit de tekst van een artikel zonder vaste plek (stap 7, lib/plek-uit-tekst.mjs).
  const documents = bronnen.map((document) => ({
    ...document,
    items: document.items.map((item) => (document.sourceId === ASIGN_EVENEMENTEN_SOURCE_ID ? tekstBijDeBuild(item, tekst) : plekEnUurUitTekst(item, document.sourceId))),
  }));
  const itemsBySource = Object.fromEntries(documents.map((document) => [document.sourceId, { scope: document.scope, items: document.items }]));
  const suppressions = documents.flatMap((document) => Array.isArray(document.suppressions) ? document.suppressions : []);
  const merged = mergeEvents(itemsBySource, handItems, suppressions);
  // Vangnet: twee feed-items die voor het eventcontract hetzelfde punt zijn, worden er één
  // (de bron met voorrang wint). Zo kan een dagelijkse refresh de build niet breken.
  const signatures = new Set();
  const items = [];
  let droppedDuplicates = 0;
  for (const item of merged.items) {
    const signature = contractSignature(item);
    if (signatures.has(signature)) {
      droppedDuplicates += 1;
      continue;
    }
    signatures.add(signature);
    // De fasen van een evenement op straat (district-asign-evenementen) blijven in het bronbestand. De
    // straten gaan mee: de plekpagina koppelt een agendapunt aan al zijn straten, niet alleen aan de drie
    // in de locatietekst ("X, Y, Z en 8 andere straten"; place-view.js, setStreetLists).
    const { fasen: _fasen, feiten: _feiten, nietGoedgekeurd: _status, nietGoedgekeurdStraten: _aanvraagStraten, ...feedItem } = item;
    const aanvraagStraten = nietGoedgekeurdStraten(item, tekst?.hand || null);
    const bevestigd = stratenUitFiche(item, tekst?.hand || null);
    items.push({ ...feedItem, ...(nietGoedgekeurd(item, tekst?.hand || null) ? { nietGoedgekeurd: true } : {}), ...(aanvraagStraten.length ? { nietGoedgekeurdStraten: aanvraagStraten } : {}), ...(bevestigd.length ? { stratenBevestigd: bevestigd } : {}), dateLabel: dutchDateLabel(item.date, item.endDate), feed: true });
  }
  const statusBySource = new Map((status?.sources ?? []).map((entry) => [entry.sourceId, entry]));
  const sources = documents
    .map((document) => {
      const entry = statusBySource.get(document.sourceId);
      const { items: sourceItems, ...meta } = document;
      delete meta.suppressions;
      // De reden van een fout (lastError, lastSuccessAt; lib/fetch-util.mjs) blijft in het bronbestand: intern, de
      // site toont nergens dat een bron faalt (besluit van 18-10-2026). De feed draagt fetchStatus en errorCode.
      delete meta.lastError;
      delete meta.lastSuccessAt;
      return {
        ...meta,
        label: SOURCE_DEFINITIONS[document.sourceId].label,
        fetchStatus: entry?.fetchStatus ?? document.fetchStatus,
        errorCode: entry?.errorCode ?? null,
        itemCount: sourceItems.length,
        // Eerlijke bronstatus (scripts/stale-policy.mjs): "leeg" en sinds wanneer, als de status ze kent.
        ...(entry && "contentStatus" in entry
          ? { upcomingCount: entry.upcomingCount ?? null, emptySince: entry.emptySince ?? null, contentStatus: entry.contentStatus }
          : {}),
      };
    })
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  return {
    feed: {
      schemaVersion: 1,
      generatedAt: status?.generatedAt ?? null,
      classificationAsOf: status?.classificationAsOf ?? null,
      sources,
      items,
      supersedes: merged.supersedes,
      ...(manualCheck ? { manualCheck: manualCheckForFeed(manualCheck) } : {}),
    },
    droppedDuplicates,
    suppressed: merged.suppressed,
  };
}

export function renderFeedScript(feed) {
  return `${FEED_HEADER}\nwindow.PUBLIC_AGENDA_FEED = ${JSON.stringify(feed)};\n`;
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const sources = readSources(rootDir);
  const { feed, droppedDuplicates, suppressed } = buildFeed({ ...sources, tekst: laadTekstBronnen(rootDir) }, loadHandAgendaItems(rootDir));
  const file = path.join(rootDir, "site", "agenda-feed.js");
  const text = renderFeedScript(feed);
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text) fs.writeFileSync(file, text, "utf8");
  console.log(
    JSON.stringify({
      sources: feed.sources.length,
      items: feed.items.length,
      supersedes: feed.supersedes.length,
      droppedDuplicates,
      suppressed: suppressed.length,
      classificationAsOf: feed.classificationAsOf,
    })
  );
}
