// Vaagheidsmeter. Eén lijst van patronen die zeggen dat een item vaag is, per veld (wat, wanneer, waar,
// wie, info), en pure functies die een agendapunt of een kaart op de plekpagina daartegen houden. Geen
// netwerk, geen klok (vandaag komt van buiten).
//
// Drie soorten metingen:
//  - op het veld (agendapunt uit site/agenda-feed.js): timeSlot "Info" zonder uur in timeText, een plaats
//    "locatie via de officiële bron", geen organisatie in een bron waar die er hoort te zijn ...;
//  - op de kop zoals de bewoner hem leest zonder iets open te klappen (titel, uur, eerste regel, de kern
//    van een kaart): de vaste "eerlijk onbekend"-zinnen ("Wat er gebeurt, zegt de stad niet", "Uur onbekend").
//    Alleen de kop bepaalt of een item "vaag" is;
//  - op het detail (wat een opengeklapte kaart, de info van een agendapunt of een eventpagina erbij zegt):
//    hoeveel zinnen zeggen wat er ontbreekt (ONTBREEKT_ZIN, het doel is hoogstens één per kaart), en welke
//    vaste detailzinnen er staan ("huisnummers niet gepubliceerd", "Gevolgen: niet gepubliceerd in GIPOD").
// Daarnaast een lijst verboden zinnen (VERBODEN_ZINNEN): een belofte die niemand waarmaakt ("naam volgt",
// "volgt zodra") of een titel die alleen zegt wat er níet is ("naam onbekend"). Die mogen nergens staan.

export const VELDEN = Object.freeze(["wat", "wanneer", "waar", "wie", "info"]);

// Patronen op de getoonde tekst. `kern: true` telt mee voor "vaag" (wat, wanneer of waar onduidelijk).
export const TEKST_PATRONEN = Object.freeze([
  { id: "naam-onbekend", veld: "wat", kern: true, re: /naam onbekend/i },
  { id: "vermoedelijk", veld: "wat", kern: false, re: /\bvermoedelijk\b/i },
  { id: "wat-zegt-dossier-niet", veld: "wat", kern: true, re: /zegt het dossier niet/i },
  { id: "wat-zegt-stad-niet", veld: "wat", kern: true, re: /(?:waarvoor(?: precies)?|wat er gebeurt), zegt de stad niet|maakt de stad niet bekend wat|de stad maakt niet bekend wat|de stad publiceert niet waarvoor/i },
  { id: "naam-stad-niet", veld: "wat", kern: false, re: /de (?:stad noemt geen naam|naam maakt de stad niet bekend)|De stad maakt de naam niet bekend/i },
  { id: "doel-onbekend", veld: "wat", kern: true, re: /doel niet bevestigd|geeft geen omschrijving/i },
  { id: "generieke-titel", veld: "wat", kern: true, re: /^(?:Evenement|Inname|Innames|Parcours|Verkeersvrije zone|Tijdelijk parkeerverbod|Maatregel|Agendapunt|Werk in openbaar domein)(?:$|\s(?:op|in|aan|door|bij)\s)/ , alleenTitel: true },
  { id: "uur-onbekend", veld: "wanneer", kern: true, re: /^Uur onbekend$|uren zijn niet gepubliceerd/i },
  { id: "uren-parkeerverbod-onbekend", veld: "wanneer", kern: false, re: /uren van het parkeerverbod staan niet in het dossier/i },
  { id: "elke-dag-onbekend", veld: "wanneer", kern: false, re: /of er elke dag iets gebeurt, zegt de stad niet/i },
  { id: "datum-bij-benadering", veld: "wanneer", kern: false, re: /bij benadering/i },
  { id: "datum-niet-gepubliceerd", veld: "wanneer", kern: true, re: /datum niet gepubliceerd/i },
  { id: "hele-jaar-als-evenement", veld: "wanneer", kern: true, re: /\bheel \d{4}\b/i, alleenTitel: true },
  { id: "plek-via-bron", veld: "waar", kern: true, re: /locatie via de officiële bron/i },
  // Een belofte die de bron niet waarmaakt: A-Sign en de meeste bronnen publiceren geen uur.
  { id: "uur-via-bron", veld: "wanneer", kern: true, re: /uur via de officiële bron/i },
  // "op 26 plekken: Teniersplaats, De Coninckplein ..." noemt de plekken wél (plaatsnamen uit het dossier).
  { id: "plek-verspreid", veld: "waar", kern: true, re: /\bop \d+ (?:kleine )?plekken\b(?!:)|plekken verspreid over de stad/i, alleenTitel: true },
  { id: "plek-niet-gepubliceerd", veld: "waar", kern: true, re: /^Niet gepubliceerd\.$/ },
  { id: "straten-niet-bekend", veld: "waar", kern: false, re: /welke en hoe laat, maakt de stad niet bekend/i },
]);

// Vaste zinnen in het detail (opengeklapt). Ze maken een kaart niet "vaag" (dat zegt de kop), maar ze tellen:
// zo ziet de meter ook wat elke kaart opnieuw zegt ("huisnummers niet gepubliceerd" op 50 van de 61 werken).
export const DETAIL_PATRONEN = Object.freeze([
  { id: "huisnummers-niet-gepubliceerd", re: /huisnummers?[^.;]{0,40}niet gepubliceerd|geen huisnummers? gepubliceerd/i },
  { id: "gevolgen-niet-gepubliceerd", re: /gevolgen:? niet gepubliceerd/i },
  { id: "beheerder-geen-omschrijving", re: /publiceerde zelf geen omschrijving/i },
  { id: "start-werken-onbekend", re: /start van de werken:? niet gepubliceerd/i },
  { id: "organisator-niet-gepubliceerd", re: /organisator[^.;]{0,20}niet (?:gepubliceerd|openbaar)/i },
  { id: "uren-niet-gepubliceerd", re: /uren (?:zijn )?niet gepubliceerd|de uren zijn niet gepubliceerd/i },
  { id: "niet-in-de-bron", re: /\bniet in de bron\b/i },
]);

// Een zin die zegt wat er ontbreekt. Per kaart geteld over kop en detail samen: het doel (plan van 12 oktober
// 2026) is hoogstens één zo'n zin per kaart, de regel "Niet in de bron: ...".
export const ONTBREEKT_ZIN = /\bzegt (?:het dossier|de stad|de bron|niemand)\b[^.;]*?\bniet\b|\bniet (?:gepubliceerd|bekend|openbaar)\b|\bpubliceer(?:t|de)\b[^.;]*?\b(?:niet|geen)\b|\bonbekend\b|\bmaakt de stad niet bekend\b|\bnoemt geen\b|\bniet in de bron\b/gi;
export function ontbreektZinnen(teksten = []) {
  let n = 0;
  for (const t of teksten) n += (clean(t, 4000).match(ONTBREEKT_ZIN) || []).length;
  return n;
}

// Verboden zinnen. `alleenTitel`: alleen in een titel verboden ("naam onbekend" mag in de uitleg staan, als
// eerlijke zin, maar een titel zegt wat er wél is). Geeft de ids van wat er staat.
export const VERBODEN_ZINNEN = Object.freeze([
  { id: "naam-volgt", re: /\bnaam volgt\b/i },
  { id: "volgt-zodra", re: /\bvolgt zodra\b/i },
  { id: "naam-onbekend-in-titel", re: /\bnaam onbekend\b/i, alleenTitel: true },
]);
export function verbodenIn({ titel = "", teksten = [] } = {}) {
  const t = clean(titel, 400);
  const alle = [t, ...teksten.map((x) => clean(x, 4000))];
  return VERBODEN_ZINNEN.filter((v) => (v.alleenTitel ? [t] : alle).some((x) => v.re.test(x))).map((v) => v.id);
}

const clean = (v, max = 2000) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const UUR_IN_TEKST = /\b\d{1,2}(?:[.:u]\d{2})?\s*(?:uur|u)\b|\b\d{1,2}[.:]\d{2}\b/i;
const ALLEEN_POSTCODES = /^(?:\d{4}(?:\s*(?:,|en)\s*\d{4})*\s+Antwerpen|district Antwerpen|Antwerpen)$/i;

// Bronnen waar "wie" uit de bron zelf volgt (de stad, het district, de school): daar is een ontbrekende
// organisatie niet vaag. Elders (kalender, nieuws, besluiten, evenementendossiers) wel.
export const WIE_UIT_BRON = Object.freeze({
  "district-vergaderingen": "district Antwerpen",
  "stad-markten": "stad Antwerpen",
  "stad-koopzondagen": "stad Antwerpen",
  "district-schoolstraten": "stad Antwerpen en de school",
  "district-projecten": "district of stad Antwerpen",
  "district-foren": "stad Antwerpen",
  "district-ebesluit": "district Antwerpen",
});
// Bronnen waar de uren inherent "doorlopend" of "per winkel" zijn: een periode zonder uur is daar niet vaag.
const UREN_NIET_VAN_TOEPASSING = new Set(["district-projecten", "district-schoolstraten", "stad-koopzondagen", "district-foren"]);

// Het detail van een item: welke vaste detailzinnen er staan en hoeveel zinnen zeggen wat er ontbreekt (kop
// en detail samen: een kaart die het in de kop al zegt en in het detail nog eens, telt twee keer).
function detailVan(kop = [], detail = []) {
  const d = detail.map((x) => clean(x, 4000)).filter(Boolean);
  const patronen = DETAIL_PATRONEN.filter((p) => d.some((x) => p.re.test(x))).map((p) => p.id).sort();
  return { patronen, ontbreekt: ontbreektZinnen([...kop, ...d]) };
}

// Eén agendapunt (feed-item) op zijn velden. Geeft { id, sourceId, patronen: [ids], kern: bool, detail,
// verboden }. Het detail is de info (wat de lijst toont na openklappen).
export function vaagheidVanAgendapunt(item = {}) {
  const ids = new Set();
  const titel = clean(item.title, 300);
  const sourceId = clean(item.sourceId, 80);
  const meerdaags = Boolean(item.endDate && item.endDate > item.date);
  const kop = [titel, clean(item.location, 300), clean(item.timeText, 300)];
  for (const p of TEKST_PATRONEN) {
    const teksten = p.alleenTitel ? [titel] : kop;
    if (teksten.some((t) => p.re.test(t))) ids.add(p.id);
  }
  // Wanneer: één dag, geen uur (timeSlot "Info") en ook geen uur in de tekst.
  if (item.timeSlot === "Info" && !UREN_NIET_VAN_TOEPASSING.has(sourceId)) {
    const tekst = clean(item.timeText, 300);
    if (!UUR_IN_TEKST.test(tekst) && !/hele dag|doorlopend|openingsuren/i.test(tekst)) ids.add(meerdaags ? "uren-periode-onbekend" : "uur-onbekend");
  }
  // Waar: alleen postcodes of het district.
  if (ALLEEN_POSTCODES.test(clean(item.location, 300))) ids.add("plek-alleen-postcode");
  // Wie: alleen waar de bron het niet zelf zegt.
  if (!WIE_UIT_BRON[sourceId] && item.kind !== "deadline" && !/\b(?:Organisatie|Organisator|georganiseerd door)\b/i.test(clean(item.info, 600))) ids.add("wie-onbekend");
  // Info: niets meer dan de titel.
  if (!clean(item.info, 600)) ids.add("info-leeg");
  const kernIds = new Set(["uur-onbekend", "plek-alleen-postcode", ...TEKST_PATRONEN.filter((p) => p.kern).map((p) => p.id)]);
  return {
    id: item.id, sourceId, patronen: [...ids].sort(), kern: [...ids].some((x) => kernIds.has(x)),
    detail: detailVan(kop, [clean(item.info, 4000)]), verboden: verbodenIn({ titel, teksten: [...kop.slice(1), clean(item.info, 4000)] }),
  };
}

// Eén kaart op de plekpagina (entry uit site/place-core.js), op de tekst zoals de bewoner hem ziet:
// titel, uurlabel (leesbaarUur), samenvatting en de kern (Wat, Wanneer, Waar, Jouw straat, Wat merk je).
// `detail`: wat de opengeklapte kaart er nog bij zegt (regels, dossier, bronregel, "Niet in de bron").
export function vaagheidVanKaart({ titel = "", uur = "", regels = [], detail = [] } = {}) {
  const ids = new Set();
  const t = clean(titel, 300);
  const alle = [t, clean(uur, 60), ...regels.map((r) => clean(r, 1200))];
  for (const p of TEKST_PATRONEN) {
    const teksten = p.alleenTitel ? [t] : alle;
    if (teksten.some((x) => p.re.test(x))) ids.add(p.id);
  }
  const kernIds = new Set(TEKST_PATRONEN.filter((p) => p.kern).map((p) => p.id));
  return {
    patronen: [...ids].sort(), kern: [...ids].some((x) => kernIds.has(x)),
    detail: detailVan(alle, detail), verboden: verbodenIn({ titel: t, teksten: [...alle.slice(1), ...detail] }),
  };
}

// Telling: per patroon, per bron (of soort kaart), en het aandeel items met een vaag kernveld. Met het
// detail: hoeveel items een ontbreekt-zin hebben, hoeveel meer dan één (het doel: 0), en de vaste
// detailzinnen. `verboden`: per verboden zin het aantal items (het doel: 0).
export function vatSamen(resultaten = [], groepVan = (r) => r.sourceId || r.soort || "?") {
  const perPatroon = {}, perGroep = {}, detailPatronen = {}, verboden = {};
  let vaag = 0, metOntbreekt = 0, meerDanEen = 0, zinnen = 0;
  for (const r of resultaten) {
    const g = groepVan(r);
    const groep = (perGroep[g] ||= { items: 0, vaag: 0, patronen: {} });
    groep.items += 1;
    if (r.kern) { vaag += 1; groep.vaag += 1; }
    for (const id of r.patronen) {
      perPatroon[id] = (perPatroon[id] || 0) + 1;
      groep.patronen[id] = (groep.patronen[id] || 0) + 1;
    }
    const n = r.detail?.ontbreekt || 0;
    zinnen += n;
    if (n >= 1) metOntbreekt += 1;
    if (n > 1) { meerDanEen += 1; groep.meerDanEen = (groep.meerDanEen || 0) + 1; }
    for (const id of r.detail?.patronen || []) detailPatronen[id] = (detailPatronen[id] || 0) + 1;
    for (const id of r.verboden || []) verboden[id] = (verboden[id] || 0) + 1;
  }
  const sorteer = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  for (const g of Object.values(perGroep)) g.patronen = sorteer(g.patronen);
  return {
    items: resultaten.length, vaag, aandeel: resultaten.length ? Math.round((1000 * vaag) / resultaten.length) / 10 : 0, perPatroon: sorteer(perPatroon), perGroep,
    detail: { metOntbreekt, meerDanEen, zinnen, perPatroon: sorteer(detailPatronen) },
    verboden: sorteer(verboden),
  };
}

// Vergelijk met een vorige meting: gestegen patronen en kernaandeel. Faalt (ok: false) als het aandeel
// vage items meer dan `marge` procentpunt stijgt, of een patroon meer dan `patroonMarge` items erbij krijgt.
// Ook het detail: meer kaarten met meer dan één ontbreekt-zin, of een vaste detailzin die er meer bij krijgt.
// Een verboden zin mag nooit stijgen, ook niet binnen de marge.
export function vergelijk(nu, vorige, { marge = 2, patroonMarge = 3 } = {}) {
  if (!vorige) return { ok: true, gestegen: [], reden: "geen vorige meting" };
  const gestegen = [];
  for (const [id, n] of Object.entries(nu.perPatroon || {})) {
    const oud = vorige.perPatroon?.[id] || 0;
    if (n - oud > patroonMarge) gestegen.push({ id, van: oud, naar: n });
  }
  if (vorige.detail) {
    for (const [id, n] of Object.entries(nu.detail?.perPatroon || {})) {
      const oud = vorige.detail.perPatroon?.[id] || 0;
      if (n - oud > patroonMarge) gestegen.push({ id: `detail:${id}`, van: oud, naar: n });
    }
    const oud = vorige.detail.meerDanEen || 0, n = nu.detail?.meerDanEen || 0;
    if (n - oud > patroonMarge) gestegen.push({ id: "detail:meer-dan-een-ontbreekt", van: oud, naar: n });
  }
  for (const [id, n] of Object.entries(nu.verboden || {})) {
    const oud = vorige.verboden?.[id] || 0;
    if (n > oud) gestegen.push({ id: `verboden:${id}`, van: oud, naar: n });
  }
  const stijging = (nu.aandeel || 0) - (vorige.aandeel || 0);
  return { ok: stijging <= marge && !gestegen.length, stijging: Math.round(stijging * 10) / 10, gestegen };
}

// site/sources/vaagheid.json: de meting van de laatste verversing (scripts/meet-vaagheid.mjs --schrijf).
// Alleen tellingen: geen voorbeeldtitels, geen plaatsen buiten de vaste straatnamen van de toets. `invoer`:
// de vingerafdruk van de data waarop gemeten is (vaste data: de ratel vergelijkt alleen op dezelfde invoer).
export const VAAGHEID_FILE = "vaagheid.json";
export function validateVaagheid(doc) {
  const fouten = [];
  if (!doc || typeof doc !== "object" || doc.schema !== "vaagheid/1") return ["schema moet vaagheid/1 zijn"];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(doc.vandaag || ""))) fouten.push("vandaag ongeldig");
  for (const k of ["agenda", "eventpaginas", "straten"]) {
    const m = doc[k];
    if (!m || !Number.isInteger(m.items) || !Number.isInteger(m.vaag) || m.vaag > m.items) { fouten.push(`${k}: tellingen ongeldig`); continue; }
    if ("voorbeelden" in m) fouten.push(`${k}: voorbeelden horen niet in het bestand`);
    for (const [id, n] of Object.entries(m.perPatroon || {})) if (!/^[a-z-]{3,40}$/.test(id) || !Number.isInteger(n)) fouten.push(`${k}: patroon ${id} ongeldig`);
    for (const [id, n] of Object.entries(m.detail?.perPatroon || {})) if (!/^[a-z-]{3,40}$/.test(id) || !Number.isInteger(n)) fouten.push(`${k}: detailpatroon ${id} ongeldig`);
    for (const [id, n] of Object.entries(m.verboden || {})) if (!VERBODEN_ZINNEN.some((v) => v.id === id) || !Number.isInteger(n)) fouten.push(`${k}: verboden zin ${id} ongeldig`);
  }
  // De vingerafdruk van de invoer (scripts/meet-vaagheid.mjs, invoerVingerafdruk): 16 hexadecimale tekens.
  if ("invoer" in doc && !/^[0-9a-f]{16}$/.test(String(doc.invoer))) fouten.push("invoer ongeldig");
  if ("code" in doc && !/^[0-9a-f]{16}$/.test(String(doc.code))) fouten.push("code ongeldig");
  fouten.push(...nietAanvaardeStijgingen(doc));
  return fouten;
}

// Een stijging is bewust aanvaard als ze in `aanvaard` staat: { waar, id, van, naar, reden }, met een reden van
// minstens 15 tekens. `naar` is het hoogste aanvaarde aantal (een kleinere stijging valt eronder).
const AANVAARD_REDEN_MIN = 15;
export function isAanvaard(aanvaard, waar, g) {
  return (Array.isArray(aanvaard) ? aanvaard : []).some((a) => a && a.waar === waar && a.id === g.id && typeof a.reden === "string" && a.reden.trim().length >= AANVAARD_REDEN_MIN
    && (g.naar == null || (Number.isFinite(a.naar) && g.naar <= a.naar)));
}
// De vergelijking in het bestand (vergelijking.vorige: invoer en code van de vorige meting). Een stijging (ok:
// false) op dezelfde invoer komt van de code: die moet aanvaard zijn, anders is het bestand ongeldig. Zo wordt een
// terugval nooit stil de nieuwe basislijn door npm run meet:vaagheid te draaien. Op andere data (een verversing
// met dezelfde code) is een stijging een melding, geen fout: de data werd vager, niet de code. Een tak die code én
// data wijzigt, vergelijkt CI met de code van de basis op dezelfde data (scripts/vaagheid-tegen-basis.mjs).
export function nietAanvaardeStijgingen(doc) {
  const fouten = [];
  const v = doc?.vergelijking;
  if ("aanvaard" in (doc || {})) {
    if (!Array.isArray(doc.aanvaard)) fouten.push("aanvaard moet een lijst zijn");
    else for (const a of doc.aanvaard) if (!a || !["agenda", "eventpaginas", "straten"].includes(a.waar) || !/^[a-z:-]{3,60}$/.test(String(a.id)) || typeof a.reden !== "string" || a.reden.trim().length < AANVAARD_REDEN_MIN) fouten.push(`aanvaard: ongeldige regel ${JSON.stringify(a).slice(0, 80)}`);
  }
  if (!v || typeof v !== "object") return fouten;
  const zelfdeInvoer = Boolean(doc.invoer) && v.vorige?.invoer === doc.invoer;
  if (!zelfdeInvoer) return fouten;
  for (const k of ["agenda", "eventpaginas", "straten"]) {
    const c = v[k];
    if (!c || c.ok !== false) continue;
    const gestegen = c.gestegen?.length ? c.gestegen : [{ id: "aandeel", van: null, naar: c.stijging }];
    for (const g of gestegen) if (!isAanvaard(doc.aanvaard, k, g)) fouten.push(`${k}: ${g.id} ${g.van ?? ""}->${g.naar} gestegen op dezelfde data (de code maakte het vager); los het op of aanvaard het met een reden (npm run meet:vaagheid -- --aanvaard "<reden>")`);
  }
  return fouten;
}
