// Werklijst "vragen aan de stad" (vaagheidsplan van 12 oktober 2026, stap 7). Wat na het koppelen nog steeds geen
// naam of geen doel heeft, komt op één lijst: de evenementendossiers van A-Sign zonder naam (met wat er verder
// ontbreekt) en de werfzones zonder doel (geen werk in GIPOD met hetzelfde dossiernummer, of alleen genummerde fasen).
// Gesorteerd op hoeveel straten een dossier raakt: daar zijn de meeste bewoners mee geholpen. Een antwoord met een
// publieke bron gaat in een handfiche (site/sources/evenement-identiteit.json); de volgende build zet het op de
// kaart (tekst bij de build, stap 6).
//
// Alleen dossiernummers, straatnamen en dagen: geen namen van personen, geen huisnummers, geen beheerder en geen
// vrije tekst uit A-Sign of GIPOD. Puur: geen netwerk, geen klok (vandaag komt van buiten).
import { kortePeriode, werfDoel } from "../site/place-core.js";
import { werfDossier } from "../site/works-core.js";

const isDag = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));
const uniekeNamen = (lijst) => [...new Set((lijst || []).map((s) => String(s || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "nl"));
const ET = /^ET\d{10}$/;

// Wat een fiche (hand of automatisch) zeker weet.
function bekend(hand, auto) {
  const zeker = (f) => (f?.zekerheid === "zeker" ? f : null);
  const h = zeker(hand), a = zeker(auto);
  return {
    naam: String(h?.naam || a?.naam || "").trim(),
    soort: String(hand?.soort || (a?.soort) || "").trim(),
    uren: String(h?.uren || a?.uren || "").trim(),
    organisator: String(h?.organisator || a?.organisator || "").trim(),
  };
}

// De evenementendossiers zonder naam. evenementen: kaart-uitleg.json (`evenementen`, per dossier de straten, de
// soort uit het dossier en een koppeling met de agenda); hand en auto: de fiches.
export function evenementVragen({ evenementen = {}, hand = null, auto = null, vandaag = "" } = {}) {
  const uit = [];
  for (const [dossier, ev] of Object.entries(evenementen || {})) {
    if (!ET.test(dossier) || !ev) continue;
    const eind = isDag(ev.eind) ? ev.eind : ev.start;
    if (vandaag && isDag(eind) && eind < vandaag) continue;
    const b = bekend(hand?.dossiers?.[dossier], auto?.dossiers?.[dossier]);
    const gekoppeld = String(ev.gekoppeld?.titel || "").trim();
    if (b.naam || gekoppeld) continue;
    const wat = b.soort || String(ev.soort || "").trim();
    const ontbreekt = ["naam", wat ? "" : "wat er gebeurt", b.uren ? "" : "uren", b.organisator ? "" : "organisator"].filter(Boolean);
    const straten = uniekeNamen(ev.straten);
    uit.push({ soort: "evenement", dossier, straten, van: isDag(ev.start) ? ev.start : "", tot: isDag(eind) ? eind : "", wat, ontbreekt });
  }
  return uit;
}

// De werfzones zonder doel. rijen: de werfzonerijen (kind "sgw") met hun straten als namen; werken: kaart-uitleg.json
// (`werken`, met het dossiernummer van de werfzone als GIPOD het noemt).
export function werfzoneVragen({ rijen = [], werken = {}, vandaag = "" } = {}) {
  const doel = new Map();
  for (const w of Object.values(werken || {})) {
    const d = werfDossier(w?.dossier);
    if (d && !doel.get(d)) doel.set(d, Boolean(werfDoel(w)));
  }
  const perDossier = new Map();
  for (const r of rijen) {
    const d = werfDossier(r?.reference);
    if (!d) continue;
    const g = perDossier.get(d) || { straten: new Set(), van: "", tot: "" };
    for (const s of [...(r.werfzoneStreets || []), ...(r.omleidingStreets || [])]) if (s?.name) g.straten.add(String(s.name));
    const van = String(r.start || "").slice(0, 10), tot = String(r.end || "").slice(0, 10);
    if (isDag(van) && (!g.van || van < g.van)) g.van = van;
    if (isDag(tot) && (!g.tot || tot > g.tot)) g.tot = tot;
    perDossier.set(d, g);
  }
  const uit = [];
  for (const [dossier, g] of perDossier) {
    if (vandaag && g.tot && g.tot < vandaag) continue;
    if (doel.get(dossier)) continue;
    uit.push({ soort: "werfzone", dossier, straten: uniekeNamen([...g.straten]), van: g.van, tot: g.tot, wat: "", ontbreekt: [doel.has(dossier) ? "doel (GIPOD heeft alleen genummerde fasen)" : "doel (geen werk in GIPOD met dit dossiernummer)"] });
  }
  return uit;
}

// Eén lijst, de dossiers die de meeste straten raken eerst; dan op datum en dossiernummer.
export function vragenAanDeStad({ evenementen = {}, hand = null, auto = null, rijen = [], werken = {}, vandaag = "" } = {}) {
  return [...evenementVragen({ evenementen, hand, auto, vandaag }), ...werfzoneVragen({ rijen, werken, vandaag })]
    .sort((a, b) => b.straten.length - a.straten.length || String(a.van).localeCompare(String(b.van)) || a.dossier.localeCompare(b.dossier));
}

const MAX_STRATEN = 4;
const stratenTekst = (s) => (s.length <= MAX_STRATEN ? s.join(", ") : `${s.slice(0, MAX_STRATEN).join(", ")} en ${s.length - MAX_STRATEN} andere`);
const vraagVan = (v) => (v.soort === "werfzone"
  ? `Waarvoor dient werfzone ${v.dossier}? Welk werk, en wie voert het uit?`
  : `Wat is evenementendossier ${v.dossier}${v.wat ? ` (${v.wat.toLowerCase()})` : ""}? ${v.ontbreekt.filter((x) => x !== "naam").length ? `Naam, ${v.ontbreekt.filter((x) => x !== "naam").join(", ")}?` : "Welke naam?"}`);

// De lijst als Markdown (docs/VRAGEN_AAN_DE_STAD.md).
export function vragenMarkdown(vragen = [], { vandaag = "" } = {}) {
  const ev = vragen.filter((v) => v.soort === "evenement").length, wz = vragen.length - ev;
  const regels = vragen.map((v, i) => `| ${i + 1} | ${v.soort} | ${v.dossier} | ${v.straten.length} | ${stratenTekst(v.straten).replace(/\|/g, "/")} | ${kortePeriode(v.van, v.tot, vandaag)} | ${v.ontbreekt.join(", ")} | ${vraagVan(v)} |`);
  return [
    "# Vragen aan de stad",
    "",
    "<!-- Gegenereerd door scripts/vragen-aan-de-stad.mjs; niet met de hand wijzigen. -->",
    "",
    `Stand van ${vandaag || "onbekende datum"}: ${ev} evenementendossiers zonder naam en ${wz} werfzones zonder doel, de dossiers die de meeste straten raken eerst.`,
    "Wat hier ontbreekt, publiceert de stad niet in A-Sign of GIPOD. Een antwoord met een publieke bron komt in een handfiche",
    "(site/sources/evenement-identiteit.json); de volgende build zet het op de kaart. Geen namen van personen, geen huisnummers.",
    "",
    "| # | Soort | Dossier | Straten | Waar | Wanneer | Ontbreekt | Vraag |",
    "|---|---|---|---|---|---|---|---|",
    ...regels,
    "",
  ].join("\n");
}
