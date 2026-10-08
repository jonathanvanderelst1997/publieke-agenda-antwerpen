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

const SOORTEN_EVENEMENT = [
  [/\b\d+\s?(?:k|km)\b|loopwedstrijd|stratenloop|marathon|jogging|\brun\b|\bloop\b/i, "Loopwedstrijd"],
  [/wieler|koers|criterium|wielren/i, "Wielerwedstrijd"],
  [/fietstocht|fietstoer|fietsrit/i, "Fietstocht"],
  [/stoet|optocht|parade|processie|carnaval/i, "Stoet"],
  [/wandel/i, "Wandeling"],
  [/braderie|rommelmarkt|markt/i, "Markt"],
  [/doop/i, "Studentendoop"],
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

// Feiten over één evenementendossier (alle innames samen), zonder klok.
export function evenementFeiten(rows = []) {
  const first = rows[0] || {};
  const onderdelen = [], fasen = new Set(), types = new Set();
  let hinder = "";
  for (const r of rows) {
    const type = clean(r.innameType || r.title, 80);
    if (type) types.add(type);
    if (r.phase) fasen.add(clean(r.phase, 40));
    if (clean(r.hindrance, 10).toLowerCase() === "true") hinder = "True";
    else if (!hinder && r.hindrance) hinder = clean(r.hindrance, 10);
    const b = bruikbareBeschrijving(r.description);
    if (b) onderdelen.push(`${type === "Parcours" ? "Parcours" : type || "Inname"}: ${b}`);
  }
  const starts = rows.map((r) => dagVan(r.start)).filter(Boolean).sort();
  const ends = rows.map((r) => dagVan(r.end)).filter(Boolean).sort();
  const straten = uniek(rows.flatMap((r) => (r.streets || []).map((s) => s?.name))).sort((a, b) => a.localeCompare(b, "nl"));
  const beschrijvingen = uniek(onderdelen);
  const soort = soortEvenement([...beschrijvingen, ...rows.map((r) => r.description)].map((t) => bruikbareBeschrijving(t) || "").filter(Boolean)) || "";
  return {
    dossier: clean(first.reference, 80),
    dossierType: clean(first.dossierType, 20) || (isEvenementDossier(first) ? "ETL" : ""),
    start: starts[0] || "",
    eind: ends.at(-1) || "",
    fasen: [...fasen].sort(),
    soorten: [...types].sort((a, b) => a.localeCompare(b, "nl")),
    parcours: rows.filter((r) => clean(r.innameType || r.title, 80) === "Parcours").length,
    beschrijvingen,
    soort,
    soortBron: soort ? "omschrijvingen in het dossier" : "",
    hinder,
    straten,
  };
}

// Een parcours koppelen aan een bekend evenement uit de andere bronnen: zelfde dag en een straat
// van het parcours in de locatie. Geen gok op basis van alleen de datum.
export function koppelEvenement(feiten, agendaItems = []) {
  if (!feiten?.start || !feiten.straten?.length) return null;
  const straten = feiten.straten.map((s) => s.toLowerCase()).filter((s) => s.length >= 5);
  let best = null;
  for (const item of agendaItems) {
    const d = dagVan(item?.date), e = dagVan(item?.endDate) || d;
    if (!d || d > feiten.eind || e < feiten.start) continue;
    if (/markt|raad|commissie|zitdag/i.test(`${item.theme || ""} ${item.title || ""}`)) continue;
    const loc = ` ${clean(`${item.location || ""} ${item.title || ""}`, 400).toLowerCase()} `;
    const score = straten.filter((s) => loc.includes(s)).length;
    if (score && (!best || score > best.score)) best = { score, item };
  }
  if (!best) return null;
  const it = best.item;
  return {
    titel: clean(it.title, 160),
    tijd: clean(it.timeText, 80),
    locatie: clean(it.location, 200),
    bronUrl: /^https:\/\/[^?#\s]+$/.test(String(it.sourceUrl || it.link || "")) ? String(it.sourceUrl || it.link) : "",
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

// Titel, korte uitleg en details voor één evenementendossier.
export function evenementKaartje(feiten, { vandaag, gekoppeld = null, wijkVan } = {}) {
  const f = feiten;
  const datum = f.start === f.eind || !f.eind ? datumTekst(f.start) : `${datumTekst(f.start)} – ${datumTekst(f.eind)}`;
  const straten = stratenSamenvatting(f.straten, wijkVan);
  const soort = f.soort || "Evenement";
  const wat = f.parcours ? `parcours door ${straten || "de straten op de kaart"}`
    : f.soorten.some((s) => /parkeerverbod/i.test(s)) ? `parkeerverbod${straten ? ` in ${straten}` : ""}`
    : f.soorten.some((s) => /verkeersvrij/i.test(s)) ? `verkeersvrije zone${straten ? ` in ${straten}` : ""}`
    : `inname van de straat${straten ? ` in ${straten}` : ""}`;
  const tijd = gekoppeld?.tijd ? ` ${gekoppeld.tijd}` : "";
  const titel = gekoppeld ? `${gekoppeld.titel}: ${wat}, ${datum}${tijd}` : `${soort} met ${wat}, ${datum}`;
  const duur = resterendeDuur({ start: f.start, eind: f.eind, vandaag });

  const ontbreekt = [];
  if (!gekoppeld) ontbreekt.push("naam van het evenement niet gepubliceerd door de stad");
  if (!gekoppeld?.tijd) ontbreekt.push("uren niet gepubliceerd");
  ontbreekt.push("organisator niet gepubliceerd");
  if (!f.beschrijvingen.length) ontbreekt.push(NIET_GEPUBLICEERD);

  const gevolgen = [];
  if (f.hinder === "True") gevolgen.push("de stad verwacht hinder voor het verkeer");
  if (f.soorten.some((s) => /parkeerverbod/i.test(s))) gevolgen.push("tijdelijk parkeerverbod");
  if (f.soorten.some((s) => /verkeersvrij/i.test(s))) gevolgen.push("verkeersvrije zone");
  if (f.soorten.some((s) => /omleiding/i.test(s))) gevolgen.push("omleiding");
  if (f.parcours) gevolgen.push("straten op het parcours kunnen tijdelijk dicht zijn");

  const regels = [];
  regels.push(["Thema / soort",f.soort ? `${f.soort} (afgeleid uit de beschrijving van het dossier)` : "Niet openbaar gemaakt; uit een parcours alleen volgt niet of dit een loopwedstrijd, wielerwedstrijd of ander evenement is."]);
  regels.push(["Organisator","Niet openbaar gemaakt in A-Sign."]);
  regels.push(["Waarom in deze agenda?",f.parcours ? "Stad Antwerpen registreert een toegelaten inname met parcours in het openbaar domein; dit is geen volledig evenementenprogramma." : "Stad Antwerpen registreert een toegelaten inname van openbaar domein."]);
  regels.push(["Wat", gekoppeld
    ? `${gekoppeld.titel}${gekoppeld.locatie ? ` (${gekoppeld.locatie})` : ""}. Gekoppeld via datum en straten aan de agenda.`
    : `${f.soort ? `${f.soort}, afgeleid uit de ${f.soortBron}. ` : ""}De stad gaf toelating voor een evenement op straat; naam en organisator staan niet in de publieke bron.`]);
  if (f.beschrijvingen.length) regels.push(["In het dossier", f.beschrijvingen.join(" · ")]);
  regels.push(["Wanneer", `${datum} (periode van de inname volgens A-Sign; niet noodzakelijk de evenementuren)${gekoppeld?.tijd ? ` · gekoppelde activiteit: ${gekoppeld.tijd}` : " · uren niet gepubliceerd"}${duur.tekst && duur.toestand !== "onbekend" ? ` · ${duur.tekst}` : ""}`]);
  if (f.fasen.some((x) => x !== "Evenement")) regels.push(["Opbouw en afbraak", f.fasen.map((x) => CODES[x] || x).join(", ")]);
  if (f.parcours) regels.push(["Parcours", `${f.straten.length} betrokken straten volgens het dossier; dit bewijst niet dat ze allemaal tegelijkertijd afgesloten zijn.`]);
  if (gevolgen.length) regels.push(["Gevolgen", capital(gevolgen.join(" · "))]);
  const samenvatting = [
    gekoppeld ? `${gekoppeld.titel}.` : `${soort} met toelating van de stad${f.soort ? "" : "; het soort evenement staat niet in de bron"}.`,
    gevolgen.length ? `${capital(gevolgen[0])}.` : "",
  ].filter(Boolean).join(" ");
  const technisch = [f.dossier ? `dossier ${f.dossier}` : "", f.dossierType ? `${f.dossierType} = ${CODES[f.dossierType] || f.dossierType}` : "", `IOD = ${CODES.IOD}`, hinderTekst(f.hinder)].filter(Boolean).join(" · ");
  return { titel, samenvatting, regels, ontbreekt, duur, plek: straten, technisch };
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
// Een eenvoudige SVG-schets: het parcours over de straatassen in de buurt. Geen tegels, geen netwerk.
export function kaartSvg(lijnen = [], achtergrond = [], { breedte = 320, hoogte = 200 } = {}) {
  const pts = lijnen.flat();
  if (!pts.length) return "";
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const k = Math.cos(((minY + maxY) / 2) * Math.PI / 180);
  const padX = (maxX - minX) * 0.08 + 0.0008, padY = (maxY - minY) * 0.08 + 0.0005;
  minX -= padX; maxX += padX; minY -= padY; maxY += padY;
  const sx = (maxX - minX) * k, sy = maxY - minY, s = Math.min(breedte / sx, hoogte / sy);
  const w = Math.round(sx * s), h = Math.round(sy * s);
  const p = ([x, y]) => `${((x - minX) * k * s).toFixed(1)},${((maxY - y) * s).toFixed(1)}`;
  const binnen = (seg) => seg.some(([x, y]) => x >= minX && x <= maxX && y >= minY && y <= maxY);
  const bg = achtergrond.filter(binnen).slice(0, 4000).map((seg) => `<polyline points="${seg.map(p).join(" ")}"/>`).join("");
  const fg = lijnen.map((l) => `<polyline points="${l.map(p).join(" ")}"/>`).join("");
  return `<svg class="ku-kaart" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Schets van het parcours"><g class="ku-straten">${bg}</g><g class="ku-route">${fg}</g></svg>`;
}
