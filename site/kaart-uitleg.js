// Kaartjes in gewone taal. Maakt van een werk (GIPOD) of een evenementendossier (A-Sign IOD)
// een duidelijke titel, een korte uitleg en een eerlijke lijst van wat de bron níet zegt.
// Gedeeld door de dataverversing (lib/kaart-uitleg-refresh.mjs schrijft de feiten naar
// site/sources/kaart-uitleg.json) en de site (place-view.js), zodat elk nieuw item dezelfde
// uitleg krijgt. Verzint niets: een soort werk of evenement komt alleen uit woorden die in de
// bron staan, en de bron van die afleiding gaat mee. Geen klok: "vandaag" komt altijd van buiten.

export const KAART_UITLEG_SCHEMA = 1;
export const NIET_GEPUBLICEERD = "omschrijving niet gepubliceerd door de beheerder";

const clean = (v, max = 300) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const uniek = (rows) => [...new Set(rows.map((v) => clean(v)).filter(Boolean))];
const MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const BRUSSEL = typeof Intl !== "undefined" ? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" }) : null;

// ---------- datums ----------

// Kalenderdag in Brussel (JJJJ-MM-DD) van een ISO-tijdstip of een dag.
export function dagVan(value) {
  const text = clean(value, 40);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) return "";
  return BRUSSEL ? BRUSSEL.format(new Date(ms)) : new Date(ms).toISOString().slice(0, 10);
}
export function dagenTussen(a, b) {
  const t = (d) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((t(b) - t(a)) / 86_400_000);
}
export function datumTekst(day, { jaar = false } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "")) return "";
  return `${Number(day.slice(8, 10))} ${MAANDEN[Number(day.slice(5, 7)) - 1]}${jaar ? ` ${day.slice(0, 4)}` : ""}`;
}
const meervoud = (n, een, veel) => `${n} ${n === 1 ? een : veel}`;

// Hoe lang nog: "nog 38 dagen", "start over 6 dagen", of eerlijk "einddatum niet gepubliceerd".
export function resterendeDuur({ start, eind, vandaag }) {
  const s = dagVan(start), e = dagVan(eind), v = dagVan(vandaag);
  if (!v) return { toestand: "onbekend", dagen: null, tekst: "" };
  if (s && s > v) {
    const n = dagenTussen(v, s);
    return { toestand: "gepland", dagen: n, tekst: n === 1 ? "start morgen" : `start over ${n} dagen` };
  }
  if (!e) return { toestand: "onbekend", dagen: null, tekst: "einddatum niet gepubliceerd" };
  if (e < v) return { toestand: "voorbij", dagen: 0, tekst: "afgelopen" };
  const n = dagenTussen(v, e);
  return { toestand: "bezig", dagen: n, tekst: n === 0 ? "laatste dag vandaag" : `nog ${meervoud(n, "dag", "dagen")}` };
}

// ---------- soort werk ----------

// Volgorde telt: het specifiekere woord eerst ("afbouw stelling" is een stelling, geen sloop).
const SOORTEN_WERK = [
  [/riolering|riool|afvoerleiding|rioolaansluiting/i, "Rioleringswerken"],
  [/bemaling/i, "Bemaling (grondwater wegpompen)"],
  [/gasleiding|\bgas\b|aardgas/i, "Werken aan de gasleiding"],
  [/drinkwater|waterleiding|water-link|\bwater\b/i, "Werken aan de waterleiding"],
  [/openbare verlichting|lichtmast|straatverlichting/i, "Werken aan de straatverlichting"],
  [/klantaansluiting|huisaansluiting/i, "Nieuwe aansluiting op het net"],
  [/elektriciteit|laagspanning|middenspanning|hoogspanning|distributienet/i, "Werken aan het elektriciteitsnet"],
  [/glasvezel|telecom|telecommunicatie|kabelnet/i, "Telecom- of glasvezelwerken"],
  [/nutsleiding|nutswerk|nutsvoorziening/i, "Werken aan nutsleidingen"],
  [/heraanleg|herinrichting|wegenis|asfalt|bestrating|fietspad|voetpad|rijweg|kasseien/i, "Wegenwerken"],
  [/tijdelijke halte|tramhalte|bushalte|tramsporen|tramlijn|\bde lijn\b/i, "Werken aan tram of bus"],
  [/stelling|steiger/i, "Stelling (steiger)"],
  [/gevel/i, "Gevelwerken"],
  [/dakwerk|\bdak\b/i, "Dakwerken"],
  [/torenkraan|snelmontagekraan|mobiele kraan|\bkraan\b/i, "Bouwkraan"],
  [/sloop|afbraak|afbreken/i, "Sloopwerken"],
  [/ruwbouw|nieuwbouw|appartement|verbouwing|renovatie|bouwwerf|bouwproject/i, "Bouwwerf"],
  [/verhuis|verhuislift/i, "Verhuis"],
  [/container/i, "Container"],
  [/sondering|boring|peilbuis|bodemonderzoek/i, "Bodemonderzoek"],
  [/snoei|boom|groenaanleg|beplanting/i, "Groenwerken"],
];
// GIPOD-types die zelf al een soort zijn (PublicDomainOccupancyTypes / GroundworkSpecification).
export function soortWerk(bronnen = []) {
  for (const { tekst, bron } of bronnen) {
    const t = clean(tekst, 500);
    if (!t) continue;
    for (const [re, soort] of SOORTEN_WERK) if (re.test(t)) return { soort, bron };
  }
  return { soort: "", bron: "" };
}

// ---------- gevolgen ----------

const GEVOLGEN = [
  [/^geen doorgang voor gemotoriseerd verkeer/i, "afgesloten voor auto's", 1],
  [/^geen doorgang voor voetgangers/i, "geen doorgang voor voetgangers", 2],
  [/^geen doorgang voor fietsers/i, "geen doorgang voor fietsers", 3],
  [/^afgesloten in 1 rijrichting/i, "afgesloten in één rijrichting", 4],
  [/^rijrichting omgekeerd/i, "rijrichting omgekeerd", 4],
  [/^beperkte doorgang voor voetgangers/i, "voetgangers beperkt", 5],
  [/^beperkte doorgang voor fietsers/i, "fietsers beperkt", 6],
  [/^wisselend verkeer/i, "om beurten rijden", 7],
  [/^versmalde rijstro/i, "versmalde rijstrook", 8],
  [/^vermindering van rijstro/i, "minder rijstroken", 8],
  [/^handelaars moeilijk bereikbaar/i, "handelaars moeilijk bereikbaar", 9],
  [/^snelheidsbeperking/i, "lagere snelheid", 9],
  [/^parkeerverbod/i, "parkeerverbod", 10],
];
export function gevolgKort(gevolg) {
  const g = clean(gevolg, 160);
  for (const [re, kort] of GEVOLGEN) if (re.test(g)) return kort;
  return g ? g.charAt(0).toLowerCase() + g.slice(1) : "";
}
function rang(gevolg) {
  const g = clean(gevolg, 160);
  for (const [re, , r] of GEVOLGEN) if (re.test(g)) return r;
  return 99;
}
export function hoofdgevolg(gevolgen = []) {
  const sorted = uniek(gevolgen).sort((a, b) => rang(a) - rang(b) || a.localeCompare(b, "nl"));
  return sorted.length ? gevolgKort(sorted[0]) : "";
}
// Bus en tram: alleen als de bron het zelf noemt. Anders zeggen we niets over openbaar vervoer.
const OV = /openbaar vervoer|de lijn|\btram|\bbus|halte/i;
export function openbaarVervoer(teksten = []) {
  return uniek(teksten).filter((t) => OV.test(t));
}

// ---------- huisnummers ----------

const nr = (v) => { const m = String(v).match(/^(\d+)([a-z]?)/i); return m ? [Number(m[1]), m[2].toLowerCase()] : [Infinity, ""]; };
// "47–60" of "nr. 12" uit een lijst huisnummers (uit het adressenregister of de bron).
export function huisnummerBereik(nummers = []) {
  const list = uniek(nummers).filter((v) => /^\d+[a-z]?$/i.test(v)).sort((a, b) => nr(a)[0] - nr(b)[0] || nr(a)[1].localeCompare(nr(b)[1]));
  if (!list.length) return "";
  const lo = nr(list[0])[0], hi = nr(list.at(-1))[0];
  return lo === hi ? `nr. ${list[0]}` : `nr. ${lo}–${hi}`;
}
// Huisnummers die de beheerder zelf in een tekst zette: "Kammenstraat 18 - 24", "Schilderstraat 1-25".
export function huisnummersUitTekst(tekst, straat) {
  const t = clean(tekst, 400), s = clean(straat, 120);
  if (!t || !s) return "";
  const esc = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = t.match(new RegExp(`${esc}\\s+(\\d+[a-z]?)(?:\\s*(?:-|–|tot|t\\/m)\\s*(\\d+[a-z]?))?`, "i"));
  if (!m) return "";
  return m[2] ? `nr. ${m[1]}–${m[2]}` : `nr. ${m[1]}`;
}

// Geen contactgegevens doorgeven, ook niet als een beheerder ze in een vrij tekstveld zette.
const CONTACT = /[@]|https?:|www\.|\b(?:tel|gsm|contact)\b|\d{4}\s?\d{2}\s?\d{2}/i;

// ---------- werken ----------

const FALLBACK_TITEL = /^werk in openbaar domein$/i;
// Een omschrijving die alleen een adres of een dossiercode is, zegt niets over wát er gebeurt.
function bruikbareOmschrijving(title) {
  const t = clean(title, 300);
  if (!t || FALLBACK_TITEL.test(t)) return "";
  return t;
}

// Feiten over één werk, zonder klok. De verversing bewaart ze; de site vult aan met vandaag.
export function werkFeiten(werk = {}, { huisnummers = "", huisnummerBron = "" } = {}) {
  const omschrijving = bruikbareOmschrijving(werk.title);
  const fasen = (werk.hindrance?.phases || [])
    .map((f) => ({ naam: clean(f.description, 160), start: dagVan(f.start), eind: dagVan(f.end) }))
    .filter((f) => f.naam && !CONTACT.test(f.naam))
    .sort((a, b) => a.start.localeCompare(b.start) || a.naam.localeCompare(b.naam, "nl"));
  const soort = soortWerk([
    { tekst: omschrijving, bron: "omschrijving van de beheerder" },
    ...fasen.map((f) => ({ tekst: f.naam, bron: "fasen van de hinder in GIPOD" })),
    ...(werk.workTypes || []).map((t) => ({ tekst: t, bron: "soort grondwerk in GIPOD" })),
    ...(werk.occupancyTypes || []).map((t) => ({ tekst: t, bron: "soort inname in GIPOD" })),
  ]);
  const straten = uniek((werk.streets || []).map((s) => s?.name));
  const eigenNummers = straten.length ? huisnummersUitTekst([omschrijving, ...fasen.map((f) => f.naam)].join(" · "), straten[0]) : "";
  return {
    gipodId: Number(werk.gipodId) || null,
    soort: soort.soort,
    soortBron: soort.bron,
    omschrijving,
    fasen: uniekeFasen(fasen),
    opdrachtgever: clean(werk.owner, 160),
    straten,
    huisnummers: eigenNummers || clean(huisnummers, 40),
    huisnummerBron: eigenNummers ? "omschrijving van de beheerder" : huisnummers ? clean(huisnummerBron, 120) : "",
    gevolgen: uniek(werk.hindrance?.consequences || []),
    ernstig: werk.hindrance?.severe === true,
    hinderStart: dagVan(werk.hindrance?.start),
    hinderEind: dagVan(werk.hindrance?.end),
    hinderBekend: werk.hindrance ? true : werk.hindranceSourceLoaded === false ? null : false,
  };
}
function uniekeFasen(fasen) {
  const seen = new Set();
  return fasen.filter((f) => { const k = `${f.naam}|${f.start}|${f.eind}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

const periode = (s, e) => (s && e ? (s === e ? datumTekst(s) : `${datumTekst(s)} – ${datumTekst(e)}`) : s ? `vanaf ${datumTekst(s)}` : e ? `tot ${datumTekst(e)}` : "");

// Titel, korte uitleg en details voor één werk.
export function werkKaartje(werk = {}, { vandaag, feiten = null } = {}) {
  const f = feiten || werkFeiten(werk);
  const start = dagVan(werk.start), eind = dagVan(werk.end);
  const straat = f.straten[0] || "";
  const plek = [straat, f.huisnummers].filter(Boolean).join(" ");
  const soort = f.soort || (werk.ownerGroup && !/^(Andere|Onbekend)$/.test(werk.ownerGroup) ? `Werken van ${werk.ownerGroup}` : "Werken");
  const gevolg = hoofdgevolg(f.gevolgen);
  // De hinder kan vroeger stoppen dan het werk; voor "tot wanneer" telt het werk zelf.
  const duur = resterendeDuur({ start, eind, vandaag });
  let wanneer = "";
  if (duur.toestand === "bezig") wanneer = ` tot ${datumTekst(eind)} (${duur.tekst})`;
  else if (duur.toestand === "gepland") wanneer = ` vanaf ${datumTekst(start)} (${duur.tekst})`;
  const titel = `${soort}${plek ? ` ${plek}` : ""}${gevolg ? `: ${gevolg}` : ""}${wanneer}`;

  const ontbreekt = [];
  if (!f.omschrijving) ontbreekt.push(NIET_GEPUBLICEERD);
  if (!f.huisnummers) ontbreekt.push("huisnummers niet gepubliceerd");
  if (f.hinderBekend === false) ontbreekt.push("gevolgen voor het verkeer niet gepubliceerd");
  if (f.hinderBekend === null) ontbreekt.push("gevolgen voor het verkeer nu niet opgehaald");
  if (!eind) ontbreekt.push("einddatum niet gepubliceerd");

  const regels = [];
  regels.push(["Wat", f.omschrijving
    ? `${f.omschrijving}${f.soort && f.soortBron !== "omschrijving van de beheerder" ? ` (${f.soort.toLowerCase()}, volgens de ${f.soortBron})` : ""}`
    : f.soort ? `${f.soort}, afgeleid uit de ${f.soortBron}. De beheerder publiceerde zelf geen omschrijving.` : `Niet bekend: ${NIET_GEPUBLICEERD}.`]);
  if (f.fasen.length) regels.push(["Fasen", f.fasen.map((x) => `${x.naam}${x.start || x.eind ? ` (${periode(x.start, x.eind)})` : ""}`).join(" · ")]);
  regels.push(["Opdrachtgever", f.opdrachtgever || "niet gepubliceerd"]);
  if (straat) regels.push(["Waar", f.huisnummers ? `${straat}, ${f.huisnummers}${f.huisnummerBron ? ` (${f.huisnummerBron})` : ""}` : `${f.straten.join(", ")} (huisnummers niet gepubliceerd)`]);
  const ov = openbaarVervoer([...f.gevolgen, ...f.fasen.map((x) => x.naam), f.omschrijving]);
  if (f.gevolgen.length) regels.push(["Gevolgen", `${uniek(f.gevolgen).join(" · ")}${f.hinderStart || f.hinderEind ? ` (${periode(f.hinderStart, f.hinderEind)})` : ""}${f.ernstig ? " · ernstige hinder volgens GIPOD" : ""}`]);
  else regels.push(["Gevolgen", f.hinderBekend === null ? "nu niet opgehaald" : "niet gepubliceerd in GIPOD"]);
  if (ov.length) regels.push(["Bus en tram", ov.join(" · ")]);
  regels.push(["Duur", `${periode(start, eind) || "niet gepubliceerd"}${duur.tekst ? ` · ${duur.tekst}` : ""}`]);

  const samenvatting = [
    f.omschrijving ? "" : f.soort ? `${f.soort} (afgeleid uit GIPOD).` : "Omschrijving niet gepubliceerd door de beheerder.",
    f.opdrachtgever ? `Opdrachtgever: ${f.opdrachtgever}.` : "",
    f.gevolgen.length ? `${capital(uniek(f.gevolgen).map(gevolgKort).join(", "))}.` : "",
  ].filter(Boolean).join(" ");
  return { titel, samenvatting, regels, ontbreekt, duur, plek: plek || f.straten.join(", ") };
}
const capital = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : "");

// ---------- evenementen (A-Sign IOD, evenementendossiers van de stad) ----------

// Vertaling van de codes die de bron meegeeft. Ze blijven in de details staan.
export const CODES = Object.freeze({
  ETL: "evenementendossier van de stad",
  IOD: "inname van het openbaar domein",
  Evenement: "dag van het evenement",
  Opbouw: "opbouw",
  Afbraak: "afbraak",
  aanvraag_goedgekeurd: "aanvraag goedgekeurd door de stad",
  toelating_gegenereerd: "toelating verleend door de stad",
  toelating_geverifieerd: "toelating verleend en nagekeken door de stad",
});
export const statusTekst = (status) => CODES[clean(status, 60)] || clean(status, 60).replace(/_/g, " ");
export function hinderTekst(value) {
  const v = clean(value, 20).toLowerCase();
  if (v === "true") return "met hinder voor het verkeer";
  if (v === "false") return "zonder hinder voor het verkeer";
  return "";
}
export function isEvenementDossier(row = {}) {
  return /^ET/i.test(clean(row.reference || row.dossier, 40)) || /^ETL$/i.test(clean(row.dossierType, 20));
}

// Vrije tekst uit het dossier tonen we alleen als ze over het evenement gaat: een richting, een
// halte, een afstand of een woord uit de lijst. Een losse naam ("maurits") kan een persoon zijn.
const EVENEMENT_WOORDEN = /\b(?:van|naar|stop|start|aankomst|finish|verzamel\w*|parcours|wandel\w*|loop|run|jogging|marathon|fiets\w*|wieler\w*|koers|stoet|optocht|parade|processie|markt|braderie|feest|kermis|podium|tent|nadars?|dranghekken|parkeer\w*|verkeersvrij\w*|omleiding|doop\w*|spel\w*|drill\w*|halte|jeugd|volwassenen|ronde|stand|bar|toog|reuzenrad|kraam|kramen|servicepunt|generator)\b|\d+\s?(?:k|km)\b/i;
export function bruikbareBeschrijving(tekst) {
  const t = clean(String(tekst ?? "").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&"), 140);
  if (!t || CONTACT.test(t)) return "";
  return EVENEMENT_WOORDEN.test(t) ? t : "";
}

// "Grote Markt" is een plein, geen markt: alleen het losse woord "markt" telt (zoals "verplaatsbare markt").
// "Doop" eerst: een doopstoet of doopwandeling is in de eerste plaats een studentendoop.
const SOORTEN_EVENEMENT = [
  [/doop/i, "Studentendoop"],
  [/\b\d+\s?(?:k|km)\b|loopwedstrijd|stratenloop|marathon|jogging|\brun\b|\bloop\b/i, "Loopwedstrijd"],
  [/wieler|koers|criterium|wielren/i, "Wielerwedstrijd"],
  [/fietstocht|fietstoer|fietsrit/i, "Fietstocht"],
  [/stoet|optocht|parade|processie|carnaval/i, "Stoet"],
  [/wandel/i, "Wandeling"],
  [/braderie|rommelmarkt|(?<!grote\s)\bmarkt\b/i, "Markt"],
  [/straatfeest|buurtfeest|wijkfeest/i, "Buurtfeest"],
  [/\bstop\b|\w+stop\b/i, "Tocht met haltes"],
];
export function soortEvenement(teksten = []) {
  for (const [re, soort] of SOORTEN_EVENEMENT) if (teksten.some((t) => re.test(clean(t, 200)))) return soort;
  return "";
}

// Alle innames van één dossier worden één kaartje.
export function bundelInnames(rows = []) {
  const groepen = new Map();
  for (const row of rows) {
    if (row?.kind !== "iod") continue;
    const key = clean(row.reference, 80) || clean(row.id, 200);
    const list = groepen.get(key) || [];
    list.push(row);
    groepen.set(key, list);
  }
  return groepen;
}

// Fasen in de volgorde waarin ze gebeuren: opbouw, de dag zelf, afbraak.
const FASE_VOLGORDE = Object.freeze({ Opbouw: 0, Evenement: 1, Afbraak: 2 });
const faseRang = (naam) => FASE_VOLGORDE[naam] ?? 3;
// Soort inname, voor "wat merk je" en "jouw straat".
export function innameSoort(type) {
  const t = clean(type, 80);
  if (/parcours/i.test(t)) return "parcours";
  if (/parkeerverbod/i.test(t)) return "parkeerverbod";
  if (/verkeersvrij/i.test(t)) return "verkeersvrij";
  if (/omleiding/i.test(t)) return "omleiding";
  return "inname";
}
// Een huisnummer na een straatnaam ("beatrijslaan 34") kan een woning zijn: dat tonen we niet.
export const zonderHuisnummer = (t) => clean(t, 200).replace(/(\p{L}*(?:straat|laan|lei|plein|baan|weg|kaai|vest|rui|markt|plaats|dreef|pad|hof|dijk|singel|brug))\s+\d+[a-z]?(?:\s*[-–]\s*\d+[a-z]?)?\b/giu, "$1");

// Feiten over één evenementendossier (alle innames samen), zonder klok.
export function evenementFeiten(rows = []) {
  const first = rows[0] || {};
  const onderdelen = [], fasen = new Map(), types = new Set();
  const perSoort = { parcours: new Set(), parkeerverbod: new Set(), verkeersvrij: new Set(), omleiding: new Set(), inname: new Set() };
  let hinder = "";
  for (const r of rows) {
    const type = clean(r.innameType || r.title, 80);
    if (type) types.add(type);
    const fase = clean(r.phase, 40);
    if (fase) {
      const s = dagVan(r.start), e = dagVan(r.end) || s, p = fasen.get(fase) || { naam: fase, start: "", eind: "" };
      if (s && (!p.start || s < p.start)) p.start = s;
      if (e && (!p.eind || e > p.eind)) p.eind = e;
      fasen.set(fase, p);
    }
    if (clean(r.hindrance, 10).toLowerCase() === "true") hinder = "True";
    else if (!hinder && r.hindrance) hinder = clean(r.hindrance, 10);
    for (const s of r.streets || []) if (s?.name) perSoort[innameSoort(type)].add(clean(s.name, 120));
    const b = bruikbareBeschrijving(r.description);
    if (b) onderdelen.push(`${type === "Parcours" ? "Parcours" : type || "Inname"}: ${zonderHuisnummer(b)}`);
  }
  const starts = rows.map((r) => dagVan(r.start)).filter(Boolean).sort();
  const ends = rows.map((r) => dagVan(r.end)).filter(Boolean).sort();
  const straten = uniek(rows.flatMap((r) => (r.streets || []).map((s) => s?.name))).sort((a, b) => a.localeCompare(b, "nl"));
  const beschrijvingen = uniek(onderdelen);
  const soort = soortEvenement([...beschrijvingen, ...rows.map((r) => r.description)].map((t) => bruikbareBeschrijving(t) || "").filter(Boolean)) || "";
  const fasePeriodes = [...fasen.values()].sort((a, b) => faseRang(a.naam) - faseRang(b.naam) || a.start.localeCompare(b.start) || a.naam.localeCompare(b.naam, "nl"));
  const dag = fasen.get("Evenement");
  return {
    dossier: clean(first.reference, 80),
    dossierType: clean(first.dossierType, 20) || (isEvenementDossier(first) ? "ETL" : ""),
    start: starts[0] || "",
    eind: ends.at(-1) || "",
    fasen: fasePeriodes.map((p) => p.naam),
    fasePeriodes,
    evenementDag: dag?.start ? { start: dag.start, eind: dag.eind || dag.start } : null,
    soorten: [...types].sort((a, b) => a.localeCompare(b, "nl")),
    perSoort: Object.fromEntries(Object.entries(perSoort).map(([k, v]) => [k, [...v].sort((a, b) => a.localeCompare(b, "nl"))])),
    parcours: rows.filter((r) => clean(r.innameType || r.title, 80) === "Parcours").length,
    beschrijvingen,
    soort,
    soortBron: soort ? "omschrijvingen in het dossier" : "",
    hinder,
    straten,
  };
}

// Een parcours koppelen aan een gewoon evenement uit de agenda: dezelfde dag als het evenement zelf
// (niet de opbouw) en een straat van het dossier in de locatie. Geen gok op alleen de datum, en geen
// koppeling voor een inname van weken (een werf of een markt die maanden staat).
const GEEN_EVENEMENT = /\b(?:markets|meetings|admin|works|info|calls)\b|markt|raad|commissie|zitdag/i;
export const MAX_KOPPEL_DAGEN = 3;
// Met { naam } (een nagekeken naam uit evenement-identiteit.json): alleen een agendapunt met die
// naam op dezelfde dag, zodat de kaart naar het juiste agendapunt linkt en niet naar een buurman.
const plat = (t) => clean(t, 200).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function koppelEvenement(feiten, agendaItems = [], { naam = "" } = {}) {
  const dag = feiten?.evenementDag?.start ? feiten.evenementDag : { start: feiten?.start, eind: feiten?.eind || feiten?.start };
  if (!dag.start || dagenTussen(dag.start, dag.eind || dag.start) >= MAX_KOPPEL_DAGEN) return null;
  const n = plat(naam);
  if (!n && !feiten.straten?.length) return null;
  // Waar het evenement zelf staat (start, tenten, parkeerverbod) weegt zwaarder dan een straat die
  // het parcours alleen passeert; zonder zulke innames telt elke straat van het dossier.
  const ps = feiten.perSoort || {};
  // Alleen bij een groot dossier: daar loopt een parcours ook langs pleinen waar iets anders gebeurt.
  const plek = uniek([...(ps.inname || []), ...(ps.parkeerverbod || []), ...(ps.verkeersvrij || [])]);
  const straten = (plek.length && (feiten.straten || []).length > 10 ? plek : feiten.straten || []).map((s) => s.toLowerCase()).filter((s) => s.length >= 5);
  let best = null;
  for (const item of agendaItems) {
    const d = dagVan(item?.date), e = dagVan(item?.endDate) || d;
    if (!d || d > (dag.eind || dag.start) || e < dag.start) continue;
    if (GEEN_EVENEMENT.test(`${item.category || ""} ${item.theme || ""} ${item.title || ""}`)) continue;
    const t = plat(item.title);
    if (n && !(t.length >= 6 && (t.includes(n) || n.includes(t)))) continue;
    const loc = ` ${clean(`${item.location || ""} ${item.title || ""}`, 400).toLowerCase()} `;
    const score = n ? 1 : straten.filter((s) => loc.includes(s)).length;
    if (score && (!best || score > best.score)) best = { score, item };
  }
  if (!best) return null;
  const it = best.item;
  const url = String(it.infoUrl || it.sourceUrl || it.link || "");
  return {
    titel: clean(it.title, 160),
    tijd: clean(it.timeText, 80),
    locatie: zonderHuisnummer(clean(it.location, 200)),
    bronUrl: /^https:\/\/[^?#\s]+$/.test(url) ? url : "",
    agendaId: /^[a-z0-9][a-z0-9-]{2,200}$/.test(String(it.id || "")) && it.noEventPage !== true ? String(it.id) : "",
  };
}

// "38 straten in Historisch Centrum en Seefhoek". wijkVan(straatnaam) geeft een wijknaam of "".
export function stratenSamenvatting(straten = [], wijkVan = () => "") {
  const list = uniek(straten);
  if (!list.length) return "";
  if (list.length <= 3) return list.join(", ");
  const tel = new Map();
  for (const s of list) { const w = clean(wijkVan(s), 80); if (w) tel.set(w, (tel.get(w) || 0) + 1); }
  const wijken = [...tel].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "nl")).slice(0, 2).map(([w]) => w);
  return `${list.length} straten${wijken.length ? ` in ${wijken.join(" en ")}${tel.size > 2 ? " en omgeving" : ""}` : ""}`;
}

// ---------- de evenementkaart ----------

const WEEKDAGEN = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
const weekdag = (day) => WEEKDAGEN[new Date(`${day}T12:00:00Z`).getUTCDay()];
// "zondag 18 oktober" (met jaartal als het niet dit jaar is).
export function dagTekst(day, vandaag = "") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "")) return "";
  return `${weekdag(day)} ${datumTekst(day, { jaar: Boolean(vandaag) && day.slice(0, 4) !== String(vandaag).slice(0, 4) })}`;
}
// "zondag 18 oktober", "woensdag 21 en donderdag 22 oktober" of "van maandag 12 tot dinsdag 20 oktober".
export function dagenTekst(start, eind, vandaag = "") {
  if (!start) return "";
  if (!eind || eind === start) return dagTekst(start, vandaag);
  if (dagenTussen(start, eind) === 1) return `${dagTekst(start, vandaag).replace(/ \S+( \d{4})?$/, start.slice(5, 7) === eind.slice(5, 7) ? "" : "$&")} en ${dagTekst(eind, vandaag)}`;
  return `van ${dagTekst(start, vandaag)} tot ${dagTekst(eind, vandaag)}`;
}
const joinNl = (list) => (list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} en ${list.at(-1)}`);
const zin = (t) => { const s = clean(t, 800); return s ? `${capital(s)}${/[.!?]$/.test(s) ? "" : "."}` : ""; };
const hostVan = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
const KALENDER = /wat-beleef-je-in-district-antwerpen/i;
export const ZEKERHEDEN = Object.freeze(["zeker", "waarschijnlijk", "onbekend"]);
const FASE_NAAM = Object.freeze({ Opbouw: "opbouw", Evenement: "dag van het evenement", Afbraak: "afbraak" });

// Wat jouw straat met dit evenement te maken heeft. f.langs: straten waar het parcours echt langs
// loopt (berekend in de verversing), of null als dat niet bekend is.
export function jouwStraat(f, straat) {
  const naam = clean(straat, 120).toLowerCase();
  if (!naam) return "";
  const heeft = (list) => (list || []).some((s) => clean(s, 120).toLowerCase() === naam);
  const ps = f.perSoort || {};
  const delen = [];
  if (heeft(ps.verkeersvrij)) delen.push("wordt verkeersvrij");
  if (heeft(ps.parkeerverbod)) delen.push("krijgt een parkeerverbod");
  if (Array.isArray(f.langs) && heeft(f.langs)) delen.push("ligt op het parcours");
  else if (Array.isArray(f.langs) && heeft(ps.parcours)) delen.push("kruist het parcours of ligt er vlak naast");
  else if (heeft(ps.parcours)) delen.push("ligt op of naast het parcours");
  if (heeft(ps.omleiding)) delen.push("ligt op de omleiding");
  if (!delen.length && heeft(ps.inname)) delen.push("heeft een inname voor dit evenement, zoals tenten, nadars of een stand");
  if (!delen.length && heeft(f.straten)) delen.push("staat in het dossier van dit evenement, bijvoorbeeld voor een omleiding of een parkeerverbod");
  return delen.length ? `Jouw straat ${joinNl(delen)}.` : "";
}

// Welke dagen tellen als "het evenement": de nagekeken dagen als ze binnen de inname vallen,
// anders de fase Evenement uit A-Sign, anders de hele periode van de inname.
export function evenementDagen(f, identiteit = null) {
  const dagen = (identiteit?.dagen || []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const binnen = dagen.length && (!f.start || dagen[0] >= f.start) && (!f.eind || dagen.at(-1) <= f.eind);
  if (binnen) return { start: dagen[0], eind: dagen.at(-1), bron: "identiteit" };
  if (f.evenementDag?.start) return { ...f.evenementDag, bron: "fase" };
  return { start: f.start, eind: f.eind || f.start, bron: "inname" };
}

// Het eerste uur uit een gepubliceerde urentekst: "11 tot 18.30 uur" → "11:00", "om 9.30 uur" → "09:30".
export function eersteUur(tekst) {
  const m = clean(tekst, 300).match(/\b(\d{1,2})(?:[.:](\d{2}))?(?=\s*(?:uur\b|u\b|tot\s+\d))/i);
  if (!m || Number(m[1]) > 23 || Number(m[2] || 0) > 59) return "";
  return `${m[1].padStart(2, "0")}:${m[2] || "00"}`;
}

// De kaart van één evenementendossier. Bovenaan in gewone taal: wat, wanneer, waar, jouw straat en
// wat je merkt; daaronder de details en één korte bronregel. identiteit komt uit
// site/sources/evenement-identiteit.json, gekoppeld uit de agenda (koppelEvenement).
export function evenementKaartje(feiten, { vandaag, gekoppeld = null, identiteit = null, straat = "", wijkVan } = {}) {
  const f = feiten;
  const id = identiteit && ZEKERHEDEN.includes(identiteit.zekerheid) ? identiteit : null;
  const bekend = id && id.zekerheid !== "onbekend" ? id : null;
  const koppeling = !bekend && gekoppeld?.titel ? gekoppeld : null;
  const dagen = evenementDagen(f, bekend);
  const datum = dagenTekst(dagen.start, dagen.eind, vandaag) || "datum niet gepubliceerd";
  const straten = stratenSamenvatting(f.straten, wijkVan);
  const duur = resterendeDuur({ start: dagen.start, eind: dagen.eind, vandaag });

  // WAT
  let titel, wat;
  if (bekend?.zekerheid === "zeker") {
    titel = clean(bekend.naam, 120);
    wat = [zin(bekend.soort), bekend.organisator ? `Organisator: ${clean(bekend.organisator, 200)}.` : ""].filter(Boolean).join(" ");
  } else if (bekend) {
    titel = `Vermoedelijk ${clean(bekend.soort, 200)}`;
    wat = [`${titel}.`, zin(bekend.reden)].filter(Boolean).join(" ");
  } else if (koppeling) {
    titel = koppeling.titel;
    wat = `${koppeling.titel}${koppeling.locatie ? ` (${koppeling.locatie})` : ""}. Gekoppeld aan agendapunt: dezelfde dag en dezelfde straat.`;
  } else if (f.soort) {
    titel = `Vermoedelijk een ${f.soort.toLowerCase()}`;
    wat = `${titel}: dat staat in de omschrijving van het dossier. De stad maakt de naam niet bekend.`;
  } else {
    titel = "Evenement met toelating van de stad";
    wat = "Evenement met toelating van de stad; de stad maakt niet bekend wat het is.";
  }

  // WANNEER: de dag(en) van het evenement, apart van opbouw en afbraak.
  const uren = clean(bekend?.uren || koppeling?.tijd || "", 300);
  const fasenBuiten = (f.fasePeriodes || []).filter((p) => p.naam !== "Evenement" && p.start);
  const opbouw = fasenBuiten.find((p) => p.naam === "Opbouw"), afbraak = fasenBuiten.find((p) => p.naam === "Afbraak");
  const rand = [opbouw && opbouw.start < dagen.start ? `opbouw vanaf ${dagTekst(opbouw.start, vandaag)}` : "", afbraak && afbraak.eind > dagen.eind ? `afbraak tot ${dagTekst(afbraak.eind, vandaag)}` : ""].filter(Boolean);
  const wanneer = [
    `${capital(datum)}${uren ? `, ${uren}` : "; de uren zijn niet gepubliceerd"}.`,
    zin(bekend?.urenNoot),
    rand.length ? zin(joinNl(rand)) : dagen.bron === "inname" && f.eind && f.eind !== f.start ? "Dit is de periode waarin de stad de straat in gebruik geeft." : "",
  ].filter(Boolean).join(" ");

  // WAAR en JOUW STRAAT
  const waar = clean(id?.waar, 400) || (f.parcours ? `Parcours door ${straten || "de straten op de kaart"} (berekend uit de kaart van de stad).` : straten ? `${straten} (berekend uit de kaart van de stad).` : "Niet gepubliceerd.");
  const jouw = jouwStraat(f, straat);

  // WAT MERK JE
  const ps = f.perSoort || {};
  const afgeleid = [
    ps.parkeerverbod?.length ? `parkeerverbod in ${stratenSamenvatting(ps.parkeerverbod, wijkVan)}` : "",
    ps.verkeersvrij?.length ? `verkeersvrij: ${stratenSamenvatting(ps.verkeersvrij, wijkVan)}` : "",
    ps.omleiding?.length ? `omleiding via ${stratenSamenvatting(ps.omleiding, wijkVan)}` : "",
  ].filter(Boolean);
  const merk = clean(id?.watMerkJe, 600) || (afgeleid.length
    ? `${zin(joinNl(afgeleid))}${f.hinder === "True" ? " De stad verwacht hinder voor het verkeer." : ""}`
    : f.parcours ? "Straten op het parcours kunnen tijdelijk dicht zijn; welke en hoe laat, maakt de stad niet bekend."
      : "Welke straten dicht gaan en wanneer, maakt de stad niet bekend.");

  const kern = [["Wat", wat], ["Wanneer", wanneer], ["Waar", waar]];
  if (jouw) kern.push(["Jouw straat", jouw]);
  kern.push(["Wat merk je", merk]);

  // Links naar een gewone pagina, nooit een databron.
  const links = [];
  const voegToe = (url, label, uitleg = "") => { if (url && !links.some((l) => l.url === url)) links.push({ url, label, uitleg }); };
  if (id?.link) voegToe(id.link, clean(id.linkLabel, 80) || "Officiële info over dit evenement", clean(id.linkUitleg, 160));
  for (const l of id?.extraLinks || []) voegToe(l.url, clean(l.label, 100));
  if (gekoppeld?.agendaId) voegToe(`/event/${gekoppeld.agendaId}/`, `Agendapunt: ${clean(gekoppeld.titel, 100)}`);
  if (koppeling?.bronUrl && !links.length) voegToe(koppeling.bronUrl, KALENDER.test(koppeling.bronUrl) ? "Districtskalender (meerdere activiteiten)" : "Officiële info over dit evenement");

  // Details onder de kern.
  const regels = [];
  if (fasenBuiten.length) regels.push(["Opbouw en afbraak", (f.fasePeriodes || []).map((p) => `${FASE_NAAM[p.naam] || p.naam.toLowerCase()}: ${periode(p.start, p.eind) || "datum niet gepubliceerd"}`).join(" · ")]);
  if (f.straten.length > 3) regels.push(["Straten", `${f.straten.length} straten ${f.parcours ? "langs het parcours" : "in het dossier"} (berekend uit de kaart van de stad; niet allemaal tegelijk dicht)`]);

  // Eén korte bronregel in gewone taal, zonder codes.
  const dossier = f.dossier ? ` (dossier ${f.dossier})` : "";
  const bronnen = uniek((id?.bron || []).map(hostVan).filter((h) => h && !/geodata\.antwerpen\.be/.test(h)));
  const voetnoot = bekend
    ? `De stad gaf toelating voor dit evenement${dossier}. Wat het is, hebben we nagekeken${bronnen.length ? ` op ${joinNl(bronnen)}` : ""}${id.bijgewerkt ? ` (${datumTekst(id.bijgewerkt, { jaar: true })})` : ""}.`
    : koppeling
      ? `De stad gaf toelating voor dit evenement${dossier}. De naam komt van het agendapunt op dezelfde dag in dezelfde straat.`
      : `De stad gaf toelating voor dit evenement${dossier}, maar zegt niet wie het organiseert of op welke uren.`;

  const ontbreekt = [];
  if (!bekend && !koppeling) ontbreekt.push("naam van het evenement niet gepubliceerd door de stad");
  if (!uren) ontbreekt.push("uren niet gepubliceerd");
  if (!bekend?.organisator) ontbreekt.push("organisator niet gepubliceerd");

  const samenvatting = [
    !bekend && !koppeling && !f.soort ? "De stad maakt niet bekend wat het is." : "",
    `${capital(datum)}${uren ? `, ${uren}` : ""}.`,
    jouw,
  ].filter(Boolean).join(" ");
  return {
    titel, samenvatting, kern, regels, links, voetnoot, ontbreekt, duur, plek: straten, technisch: "",
    beschrijvingen: f.beschrijvingen || [], tijd: eersteUur(uren),
    zekerheid: bekend?.zekerheid || (koppeling ? "gekoppeld" : "onbekend"), dagen: { start: dagen.start, eind: dagen.eind },
  };
}


// ---------- kaart ----------

// Lijnen inkorten voor een kleine kaartschets: hoogstens maxPunten per lijn, 5 decimalen.
export function vereenvoudigLijnen(lijnen = [], maxPunten = 40) {
  const out = [];
  for (const line of lijnen) {
    if (!Array.isArray(line) || line.length < 2) continue;
    const step = Math.max(1, Math.ceil(line.length / maxPunten));
    const kept = line.filter((_, i) => i % step === 0 || i === line.length - 1)
      .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
      .map((p) => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]);
    if (kept.length >= 2) out.push(kept);
  }
  return out;
}
const VERRUIM = 0.006; // ongeveer 400 tot 650 m rond het parcours
// Een eenvoudige SVG-schets: het parcours over de straatassen in de buurt, en de gekozen straat
// (segmenten [[x,y],[x,y]]) in een eigen kleur. Geen tegels, geen netwerk.
export function kaartSvg(lijnen = [], achtergrond = [], { breedte = 560, hoogte = 320, gekozen = [] } = {}) {
  const pts = lijnen.flat();
  if (!pts.length) return "";
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  // Jouw straat mee in beeld, als ze dicht bij het parcours ligt (een omleiding, een zijstraat).
  const dichtbij = gekozen.filter((seg) => seg.some(([x, y]) => x >= minX - VERRUIM && x <= maxX + VERRUIM && y >= minY - VERRUIM && y <= maxY + VERRUIM));
  for (const [x, y] of dichtbij.flat()) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const k = Math.cos(((minY + maxY) / 2) * Math.PI / 180);
  const padX = (maxX - minX) * 0.08 + 0.0008, padY = (maxY - minY) * 0.08 + 0.0005;
  minX -= padX; maxX += padX; minY -= padY; maxY += padY;
  const sx = (maxX - minX) * k, sy = maxY - minY, s = Math.min(breedte / sx, hoogte / sy);
  const w = Math.round(sx * s), h = Math.round(sy * s);
  const p = ([x, y]) => `${((x - minX) * k * s).toFixed(1)},${((maxY - y) * s).toFixed(1)}`;
  const binnen = (seg) => seg.some(([x, y]) => x >= minX && x <= maxX && y >= minY && y <= maxY);
  const bg = achtergrond.filter(binnen).slice(0, 4000).map((seg) => `<polyline points="${seg.map(p).join(" ")}"/>`).join("");
  const fg = lijnen.map((l) => `<polyline points="${l.map(p).join(" ")}"/>`).join("");
  const jouw = gekozen.filter(binnen).slice(0, 400).map((seg) => `<polyline points="${seg.map(p).join(" ")}"/>`).join("");
  const label = jouw ? "Schets van het parcours en jouw straat" : "Schets van het parcours";
  return `<svg class="ku-kaart" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${label}"><g class="ku-straten">${bg}</g><g class="ku-route">${fg}</g>${jouw ? `<g class="ku-jouw">${jouw}</g>` : ""}</svg>`;
}
