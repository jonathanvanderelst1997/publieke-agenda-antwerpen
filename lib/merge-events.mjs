// Voegt items uit meerdere officiële bronnen samen en ontdubbelt ze. Puur en deterministisch.
//
// Sleutel: genormaliseerde titel + datum + (timeSlot als het HH:MM is, anders "unknown").
// Tweede, smallere sleutel: dezelfde datum en hetzelfde uur én dezelfde detailpagina op
// www.antwerpen.be (laatste padsegment), zodat "Halloween" uit de kalender en
// "Griezelfeest bij CO Nova op Halloween" uit het nieuws één punt worden.
// Derde sleutel: zelfde datum en hetzelfde concrete uur, en de ene titel (minstens 8 tekens) staat
// volledig in de andere ("Verlangen naar verbinding" in "Voorstelling verlangen naar verbinding op
// 10 november").
// Vierde sleutel: een item dat zelf zegt over welk agendapunt van een andere bron het gaat (`sameAs`, een
// lijst ids). Zo wordt een evenementendossier van de stad (district-asign-evenementen, berekend met de
// echte vorm van het dossier: zelfde dag en zelfde straat of hoogstens 250 m) één item met het punt uit de
// districtskalender of het districtsnieuws, met beide bronnen.
// Twee items met verschillende, niet-lege postcodelijsten worden nooit samengevoegd (sameAs uitgezonderd:
// dat is een uitdrukkelijke koppeling). Zegt het primaire item zelf dat het over een ander punt gaat, dan
// beslaat het samengevoegde item de ruimste periode van die twee (een dossier van één dag bij een festival
// van drie dagen uit een besluit verliest zo geen dagen).
import { normalized } from "./event-contract.mjs";
import { DISTRICT_CALENDAR_URL } from "./district-parser.mjs";

export const SOURCE_PRECEDENCE = Object.freeze([
  "district-kalender",
  "district-nieuws",
  "district-vergaderingen",
  "district-gipod-evenementen",
  "stad-districten",
  "stad-markten",
  "stad-koopzondagen",
  "district-ebesluit",
  // Evenementen op straat (A-Sign) na de kalender en het nieuws (die hebben een uur en een concrete
  // plek), maar vóór de besluiten van eBesluit: het dossier draagt de naam uit de handfiche eerst.
  "district-asign-evenementen",
  "district-ebesluit-evenementen",
  "stad-uit",
  "mail-district",
  "mail-stad",
]);

const GENERIC_SLUGS = new Set([new URL(DISTRICT_CALENDAR_URL).pathname.split("/").filter(Boolean).pop()]);

export function timeKey(item) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(item?.timeSlot ?? "")) ? item.timeSlot : "unknown";
}

export function mergeKey(item) {
  return `${normalized(item.title)}|${item.date}|${timeKey(item)}`;
}

function pageSlugs(item) {
  const slugs = new Set();
  for (const value of [item.infoUrl, item.sourceUrl]) {
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.hostname !== "www.antwerpen.be") continue;
      const slug = url.pathname.split("/").filter(Boolean).pop() ?? "";
      if (slug.length >= 12 && !GENERIC_SLUGS.has(slug)) slugs.add(slug);
    } catch {
      // ongeldige URL: geen detailpagina
    }
  }
  return slugs;
}

function postcodeConflict(a, b) {
  const left = [...new Set(a.postcodes ?? [])].sort();
  const right = [...new Set(b.postcodes ?? [])].sort();
  if (!left.length || !right.length) return false;
  return left.join(",") !== right.join(",");
}

function samePage(a, b) {
  if (a.date !== b.date || timeKey(a) !== timeKey(b)) return false;
  const left = pageSlugs(a);
  for (const slug of pageSlugs(b)) if (left.has(slug)) return true;
  return false;
}

function titleContained(a, b) {
  if (a.date !== b.date || timeKey(a) === "unknown" || timeKey(a) !== timeKey(b)) return false;
  const left = normalized(a.title);
  const right = normalized(b.title);
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  return shorter.length >= 8 && shorter !== longer && new RegExp(`(?:^|[^a-z0-9])${shorter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`).test(longer);
}

// Zegt een van beide items uitdrukkelijk dat het over het andere gaat?
function sameAsGroup(group, item) {
  const ids = new Set(Array.isArray(item.sameAs) ? item.sameAs : []);
  return group.contributors.some((entry) => ids.has(entry.item.id) || (Array.isArray(entry.item.sameAs) && entry.item.sameAs.includes(item.id)));
}

// Velden die alleen een evenement op straat heeft: het samengevoegde item neemt ze over als de primaire
// bron ze niet heeft (de kalender kent het uur, het dossier de fasen en de straten).
const STREET_EVENT_FIELDS = ["fasen", "straten"];

function compareItems(a, b) {
  return a.date.localeCompare(b.date) || String(a.timeSlot).localeCompare(String(b.timeSlot)) || a.id.localeCompare(b.id);
}

function sourceOrder(sourceIds) {
  const known = SOURCE_PRECEDENCE.filter((sourceId) => sourceIds.includes(sourceId));
  const unknown = sourceIds.filter((sourceId) => !SOURCE_PRECEDENCE.includes(sourceId)).sort();
  return [...known, ...unknown];
}

function entriesOf(value) {
  if (Array.isArray(value)) return { scope: null, items: value };
  return { scope: value?.scope ?? null, items: Array.isArray(value?.items) ? value.items : [] };
}

function marketLocation(value = "") { return normalized(value).replace(/\b\d{4}\b/g, " ").replace(/\b(?:antwerpen|district|linkeroever)\b/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim(); }
function sameMarketLocation(a,b){a=marketLocation(a);b=marketLocation(b);return Boolean(a&&b&&(a===b||(Math.min(a.length,b.length)>=6&&(a.includes(b)||b.includes(a)))));}
function sameMarketDecision(group, contributor){if(contributor.sourceId!=="district-ebesluit"||!/^openbare markt\b/i.test(contributor.item.title||""))return false;const market=group.contributors.find(entry=>entry.sourceId==="stad-markten");return Boolean(market&&market.item.date===contributor.item.date&&sameMarketLocation(market.item.location,contributor.item.location));}
function suppressionForGroup(group,suppressions){const market=group.contributors.find(entry=>entry.sourceId==="stad-markten");return market?suppressions.find(entry=>entry?.targetSourceId==="stad-markten"&&entry.date===market.item.date&&sameMarketLocation(entry.location,market.item.location))||null:null;}

// itemsBySource: { [sourceId]: { scope, items } } of { [sourceId]: items[] }.
// handItems: de (uitgevouwen) handmatige items uit site/agenda.js.
// Resultaat: { items, supersedes } met supersedes = gesorteerde lijst hand-id's die een feed-item vervangt.
export function mergeEvents(itemsBySource = {}, handItems = [], suppressions = []) {
  const groups = [];
  const byKey = new Map();
  for (const sourceId of sourceOrder(Object.keys(itemsBySource))) {
    const { scope, items } = entriesOf(itemsBySource[sourceId]);
    for (const item of [...items].sort(compareItems)) {
      const contributor = { sourceId, scope: scope ?? item.scope ?? null, item };
      // Een uitdrukkelijke koppeling (sameAs) gaat voor, ook bij een andere postcodelijst.
      const linked = groups.find((group) => !group.contributors.some((entry) => entry.sourceId === sourceId) && sameAsGroup(group, item));
      if (linked) {
        linked.contributors.push(contributor);
        continue;
      }
      const candidates = [
        ...(byKey.get(mergeKey(item)) ?? []),
        // Dezelfde detailpagina voegt alleen items van verschillende bronnen samen: binnen één bron zijn
        // twee items met een eigen id echt verschillend (twee fasen van één projectpagina die op dezelfde
        // dag beginnen, twee rijen uit één activiteitentabel).
        ...groups.filter((group) => !group.contributors.some((entry) => entry.sourceId === sourceId) && samePage(group.primary.item, item)),
        ...groups.filter((group) => titleContained(group.primary.item, item)),
        ...groups.filter((group) => sameMarketDecision(group, contributor)),
      ];
      const group = candidates.find((candidate) => !postcodeConflict(candidate.primary.item, item));
      if (group) {
        group.contributors.push(contributor);
        continue;
      }
      const created = { primary: contributor, contributors: [contributor] };
      groups.push(created);
      const key = mergeKey(item);
      byKey.set(key, [...(byKey.get(key) ?? []), created]);
    }
  }

  const suppressed = [], activeGroups = []; for (const group of groups) { const suppression = suppressionForGroup(group, suppressions); if (suppression) suppressed.push({ id: group.primary.item.id, date: group.primary.item.date, location: group.primary.item.location, decisionCode: suppression.decisionCode, sourceUrl: suppression.sourceUrl }); else activeGroups.push(group); } const activeByKey = new Map(); for (const group of activeGroups) { const key = mergeKey(group.primary.item); activeByKey.set(key, [...(activeByKey.get(key) ?? []), group]); }

  const supersedes = new Set();
  for (const hand of handItems) {
    if (!hand?.id || !hand.title || !hand.date) continue;
    const match = (activeByKey.get(mergeKey(hand)) ?? []).find((group) => !postcodeConflict(group.primary.item, hand));
    if (match) supersedes.add(hand.id);
  }

  const items = activeGroups.map(({ primary, contributors }) => {
    const seen = new Set();
    const sources = [];
    for (const contributor of contributors) {
      const url = contributor.item.sourceUrl;
      const key = `${contributor.sourceId}|${url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push({ sourceId: contributor.sourceId, url, retrievedAt: contributor.item.retrievedAt ?? null, scope: contributor.scope });
    }
    const scope = contributors.some((contributor) => contributor.scope === "district") ? "district" : primary.scope ?? "stad";
    const inDistrict = scope === "district" ? true : contributors.some((contributor) => contributor.item.inDistrict === true) ? true : primary.item.inDistrict ?? null;
    const { reviewRequired, sameAs, ...fields } = primary.item;
    // Alleen wat het primaire item zelf koppelt, rekt de periode op: een bijdrager die naar het primaire item
    // wijst (één dag uit een dossier van weken) maakt van een opening in de kalender geen evenement van weken.
    const eigen = new Set(Array.isArray(sameAs) ? sameAs : []);
    const periode = contributors.filter((contributor) => contributor === primary || eigen.has(contributor.item.id));
    if (periode.length > 1) {
      const begin = periode.map((contributor) => contributor.item.date).sort()[0];
      const eind = periode.map((contributor) => contributor.item.endDate || contributor.item.date).sort().at(-1);
      fields.date = begin;
      fields.endDate = eind > begin ? eind : null;
    }
    for (const key of STREET_EVENT_FIELDS) {
      if (Array.isArray(fields[key]) && fields[key].length) continue;
      const donor = contributors.find((contributor) => Array.isArray(contributor.item[key]) && contributor.item[key].length);
      if (donor) fields[key] = donor.item[key];
    }
    return {
      ...fields,
      sourceId: primary.sourceId,
      scope,
      inDistrict,
      link: primary.item.sourceUrl,
      sources,
    };
  });

  return { items: items.sort(compareItems), supersedes: [...supersedes].sort(), suppressed: suppressed.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id)) };
}
