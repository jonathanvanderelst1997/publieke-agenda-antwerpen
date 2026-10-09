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
// Een datum met jaartal als ze niet in het jaar van vandaag valt: "6 juli 2027", maar "30 november".
// Zonder vandaag altijd met jaartal: dan weten we niet welk jaar de lezer vanzelf invult.
export function datumBijVandaag(day, vandaag) {
  const d = dagVan(day), v = dagVan(vandaag);
  return datumTekst(d, { jaar: !v || d.slice(0, 4) !== v.slice(0, 4) });
}
// Een periode krijgt op beide data een jaartal als één datum niet in dit jaar valt of als ze langer
// dan 300 dagen duurt: "8 december 2025 – 1 januari 2034", niet "8 december – 1 januari".
export function periodeTekst(start, eind, vandaag) {
  const s = dagVan(start), e = dagVan(eind), v = dagVan(vandaag);
  const jaar = [s, e].filter(Boolean).some((d) => !v || d.slice(0, 4) !== v.slice(0, 4)) || (s && e && dagenTussen(s, e) > 300);
  const d = (x) => datumTekst(x, { jaar: Boolean(jaar) });
  return s && e ? (s === e ? d(s) : `${d(s)} – ${d(e)}`) : s ? `vanaf ${d(s)}` : e ? `tot ${d(e)}` : "";
}
const meervoud = (n, een, veel) => `${n} ${n === 1 ? een : veel}`;
// Lange termijnen in jaren: "nog 2641 dagen" zegt een bewoner niets.
const termijn = (n) => (n >= 730 ? `ruim ${Math.floor(n / 365)} jaar` : n >= 365 ? "ruim een jaar" : meervoud(n, "dag", "dagen"));

// Hoe lang nog: "nog 38 dagen", "start over 6 dagen", of eerlijk "einddatum niet gepubliceerd".
export function resterendeDuur({ start, eind, vandaag }) {
  const s = dagVan(start), e = dagVan(eind), v = dagVan(vandaag);
  if (!v) return { toestand: "onbekend", dagen: null, tekst: "" };
  if (s && s > v) {
    const n = dagenTussen(v, s);
    return { toestand: "gepland", dagen: n, tekst: n === 1 ? "start morgen" : `start over ${termijn(n)}` };
  }
  if (!e) return { toestand: "onbekend", dagen: null, tekst: "einddatum niet gepubliceerd" };
  if (e < v) return { toestand: "voorbij", dagen: 0, tekst: "afgelopen" };
  const n = dagenTussen(v, e);
  return { toestand: "bezig", dagen: n, tekst: n === 0 ? "laatste dag vandaag" : `nog ${termijn(n)}` };
}

// ---------- soort werk ----------

// Volgorde telt: het specifiekere woord eerst ("afbouw stelling" is een stelling, geen sloop).
// Korte woorden staan tussen woordgrenzen, zodat een straatnaam niet meetelt: "Boomgaardstraat" is
// geen groenwerk. "distributienet" zegt niet welk net (elektriciteit, gas, water of warmte), dus
// dat woord alleen maakt nooit een elektriciteitswerk.
const AANSLUITING = "Nieuwe aansluiting op het net";
const NUTSWERK = "Werken aan nutsleidingen";
const SOORTEN_WERK = [
  [/riolering|\briool|afvoerleiding/i, "Rioleringswerken"],
  [/bemaling/i, "Bemaling (grondwater wegpompen)"],
  [/warmtenet|warmteleiding|stadsverwarming/i, "Werken aan het warmtenet"],
  [/gasleiding|\bgas\b|aardgas/i, "Werken aan de gasleiding"],
  [/drinkwater|waterleiding|\bwater\b/i, "Werken aan de waterleiding"],
  [/openbare verlichting|lichtmast|straatverlichting/i, "Werken aan de straatverlichting"],
  [/verkeerslicht/i, "Werken aan de verkeerslichten"],
  [/klantaansluiting|huisaansluiting/i, AANSLUITING],
  [/elektriciteit|laagspanning|middenspanning|hoogspanning|\b\d+\s?kv\b/i, "Werken aan het elektriciteitsnet"],
  [/glasvezel|telecom|kabelnet/i, "Telecomwerken (kabels of glasvezel)"],
  [/nutsleiding|nutswerk|nutsvoorziening/i, NUTSWERK],
  [/sondering|peilbui[sz]|bodemonderzoek|grondonderzoek|infiltratieproef/i, "Bodemonderzoek"],
  [/\bboringen?\b/i, "Boringen in de grond"],
  [/heraanleg|herinrichting|wegenis|asfalt|bestrating|fietspad|voetpad|rijweg|kasseien/i, "Wegenwerken"],
  [/tijdelijke halte|tramhalte|bushalte|tramsporen|tramlijn|\bde lijn\b/i, "Werken aan tram of bus"],
  [/hoogtewerker/i, "Werk met een hoogtewerker"],
  [/\bstelling|steiger/i, "Stelling (steiger)"],
  [/\bgevel/i, "Gevelwerken"],
  [/dakwerk|\bdak\b|\bdaken\b/i, "Dakwerken"],
  [/torenkraan|snelmontagekraan|mobiele kraan|\bkraan\b/i, "Bouwkraan"],
  [/\bsloop|afbraak|afbreken/i, "Sloopwerken"],
  [/ruwbouw|nieuwbouw|appartement|verbouwing|renovatie|bouwwerf|bouwproject/i, "Bouwwerf"],
  [/\bverhuis/i, "Verhuis"],
  [/\bcontainers?\b/i, "Container"],
  [/\bsnoei|\bboom\b|\bbomen\b|groenaanleg|beplanting/i, "Groenwerken"],
];
// Eén soort uit vrije tekst: de eerste bron met een herkend woord wint.
export function soortWerk(bronnen = []) {
  for (const { tekst, bron } of bronnen) {
    const t = clean(tekst, 500);
    if (!t) continue;
    for (const [re, soort] of SOORTEN_WERK) if (re.test(t)) return { soort, bron };
  }
  return { soort: "", bron: "" };
}

// De soort inname van GIPOD (PublicDomainOccupancyTypes) is een vaste lijst. Een net heeft een korte
// naam (voor "Werken aan elektriciteit en gas"), een eigen soort en een naam voor een aansluiting.
const NETTEN = Object.freeze({
  warmte: { kort: "warmtenet", soort: "Werken aan het warmtenet", aansluiting: "het warmtenet" },
  gas: { kort: "gas", soort: "Werken aan de gasleiding", aansluiting: "het gasnet" },
  leiding: { kort: "leidingen voor gas, olie of chemicaliën", soort: "Werken aan een leiding voor gas, olie of chemicaliën", aansluiting: "een leiding voor gas, olie of chemicaliën" },
  elektriciteit: { kort: "elektriciteit", soort: "Werken aan het elektriciteitsnet", aansluiting: "het elektriciteitsnet" },
  telecom: { kort: "telecom", soort: "Telecomwerken (kabels of glasvezel)", aansluiting: "het telecomnet" },
  water: { kort: "water", soort: "Werken aan de waterleiding", aansluiting: "de waterleiding" },
  riolering: { kort: "riolering", soort: "Rioleringswerken", aansluiting: "de riolering" },
  verlichting: { kort: "straatverlichting", soort: "Werken aan de straatverlichting", aansluiting: "de straatverlichting" },
});
const INNAME_NET = Object.freeze({
  thermisch: "warmte", "olie, gas, chemicaliën": "gas", elektriciteit: "elektriciteit", telecom: "telecom",
  water: "water", riolering: "riolering", "openbare verlichting": "verlichting",
});
// Andere soorten inname, het specifiekste eerst.
const INNAME_SOORT = [
  ["hoogtewerker", "Werk met een hoogtewerker"],
  ["stelling", "Stelling (steiger)"],
  ["(werf)kraan", "Bouwkraan"],
  ["(verhuis)lift/levering", "Verhuislift of levering"],
  ["container", "Container"],
  ["werfkeet", "Werfkeet"],
  ["spoorwerken", "Spoorwerken"],
  ["kunstwerk", "Werken aan een brug, tunnel of viaduct"],
  ["wegeniswerken", "Wegenwerken"],
  ["nutswerken", NUTSWERK],
];
// Woorden voor een net in vrije tekst ("Klantaansluiting elektriciteit"), als GIPOD geen soort inname geeft.
const NET_WOORDEN = [
  ["warmte", /warmtenet|warmteleiding/i],
  ["gas", /\bgas\b|aardgas/i],
  ["elektriciteit", /elektriciteit|laagspanning|middenspanning|hoogspanning/i],
  ["telecom", /glasvezel|telecom/i],
  ["water", /drinkwater|waterleiding/i],
  ["verlichting", /openbare verlichting|straatverlichting/i],
];
const NET_VOLGORDE = Object.keys(NETTEN);
const splitsTypes = (lijst = []) => uniek(lijst.flatMap((t) => String(t ?? "").split(";"))).map((t) => t.toLowerCase());
const joinNl = (list) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} en ${list.at(-1)}` : list[0] || "");
// Leesbare namen van de soort inname, zoals GIPOD ze noemt (zonder "Andere").
const INNAME_LEESBAAR = Object.freeze({
  thermisch: "warmtenet", "olie, gas, chemicaliën": "gas, olie of chemicaliën", "openbare verlichting": "straatverlichting",
  wegeniswerken: "wegenwerken", kunstwerk: "brug, tunnel of viaduct", nutswerken: "nutsleidingen", "(werf)kraan": "werfkraan",
  "(verhuis)lift/levering": "verhuislift of levering",
});
export function innameLeesbaar(occupancyTypes = []) {
  return splitsTypes(occupancyTypes).filter((t) => t !== "andere").map((t) => INNAME_LEESBAAR[t] || t);
}
// Welke netten de soort inname noemt. Een leiding voor "olie, gas, chemicaliën" van Fluvius is de
// gasleiding; bij een andere beheerder zeggen we niet meer dan GIPOD zelf.
function nettenUitInname(occupancyTypes, eigenaar) {
  const keys = new Set();
  for (const t of splitsTypes(occupancyTypes)) {
    const k = INNAME_NET[t];
    if (k) keys.add(k === "gas" && !/fluvius/i.test(eigenaar) ? "leiding" : k);
  }
  return NET_VOLGORDE.filter((k) => keys.has(k));
}
function nettenUitTekst(teksten) {
  const t = teksten.map((x) => clean(x, 500)).join(" · ");
  return NET_WOORDEN.filter(([, re]) => re.test(t)).map(([k]) => k);
}
const netSoort = (netten) => (netten.length === 1 ? NETTEN[netten[0]].soort : `Werken aan ${joinNl(netten.map((k) => NETTEN[k].kort))}`);
const aansluitingSoort = (netten) => `Nieuwe aansluiting op ${joinNl(netten.map((k) => NETTEN[k].aansluiting))}`;

// De soort van één werk, met de bron erbij. Eerst wat de beheerder schreef (omschrijving, fasen),
// dan de vaste soort inname van GIPOD, en pas als laatste de soort grondwerk ("distributienet",
// "klantaansluiting"): die zegt hoe er gegraven wordt, niet aan welk net.
export function soortVanWerk({ omschrijving = "", fasen = [], occupancyTypes = [], workTypes = [], eigenaar = "" } = {}) {
  const tekst = soortWerk([
    { tekst: omschrijving, bron: "omschrijving van de beheerder" },
    ...fasen.map((naam) => ({ tekst: naam, bron: "fasen van de hinder in GIPOD" })),
  ]);
  const inname = nettenUitInname(occupancyTypes, eigenaar);
  const netten = inname.length ? inname : nettenUitTekst([omschrijving, ...fasen]);
  const metInname = (bron) => (inname.length ? `${bron} en de soort inname in GIPOD` : bron);
  if (tekst.soort === AANSLUITING && netten.length) return { soort: aansluitingSoort(netten), bron: metInname(tekst.bron) };
  if (tekst.soort === NUTSWERK && inname.length) return { soort: netSoort(inname), bron: metInname(tekst.bron) };
  if (tekst.soort) return tekst;
  const types = splitsTypes(occupancyTypes);
  const grondwerk = splitsTypes(workTypes);
  if (inname.length) {
    if (grondwerk.includes("klantaansluiting") && !grondwerk.some((t) => /distributienet|transportnet/.test(t))) return { soort: aansluitingSoort(inname), bron: "soort inname en soort grondwerk in GIPOD" };
    // Wegen of een kunstwerk samen met leidingen: een grote werf, geen gewoon nutswerk.
    if (types.some((t) => t === "wegeniswerken" || t === "kunstwerk")) return { soort: "Wegen- en nutswerken", bron: "soort inname in GIPOD" };
    return { soort: netSoort(inname), bron: "soort inname in GIPOD" };
  }
  for (const [type, soort] of INNAME_SOORT) if (types.includes(type)) return { soort, bron: "soort inname in GIPOD" };
  if (grondwerk.includes("klantaansluiting") && netten.length) return { soort: aansluitingSoort(netten), bron: "soort grondwerk in GIPOD" };
  return soortWerk(grondwerk.map((t) => ({ tekst: t, bron: "soort grondwerk in GIPOD" })));
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
// Het zwaarste gevolg zoals GIPOD het schrijft ("Geen doorgang voor gemotoriseerd verkeer").
function hoofdgevolgBron(gevolgen = []) {
  return uniek(gevolgen).sort((a, b) => rang(a) - rang(b) || a.localeCompare(b, "nl"))[0] || "";
}
export function hoofdgevolg(gevolgen = []) {
  return gevolgKort(hoofdgevolgBron(gevolgen));
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
// Een huisnummer bestaat niet als het 0 is, en "2001" na een straatnaam is een postcode of een
// dossiercode, geen huisnummer: zulke nummers tonen we nooit (ook niet uit een oudere verversing).
const echtNummer = (v) => { const n = Number(String(v).match(/^\d+/)?.[0]); return Number.isInteger(n) && n > 0 && n < 1000; };
export function geldigeHuisnummers(tekst) {
  const t = clean(tekst, 40);
  const m = t.match(/^nr\. (\d+[a-z]?)(?:–(\d+[a-z]?))?$/i);
  if (!m || !echtNummer(m[1]) || (m[2] && (!echtNummer(m[2]) || nr(m[2])[0] < nr(m[1])[0]))) return "";
  return t;
}
// Huisnummers die de beheerder zelf in een tekst zette: "Kammenstraat 18 - 24", "Schilderstraat 1-25".
export function huisnummersUitTekst(tekst, straat) {
  const t = clean(tekst, 400), s = clean(straat, 120);
  if (!t || !s) return "";
  const esc = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = t.match(new RegExp(`${esc}\\s+(\\d+[a-z]?)(?:\\s*(?:-|–|tot|t\\/m)\\s*(\\d+[a-z]?))?(?![\\d])`, "i"));
  if (!m) return "";
  return geldigeHuisnummers(m[2] ? `nr. ${m[1]}–${m[2]}` : `nr. ${m[1]}`);
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

// "in de Bermstraat", "in het Rozemiekepad", "op het Sint-Jansplein", "op de Vrijdagmarkt". Een naam
// zonder herkenbaar einde krijgt geen lidwoord ("in Kipdorp"): liever kaal dan een fout lidwoord.
const HET_NAAM = /(?:plein|pad|park|hof|eiland|dok|veld|erf|bos|kwartier|strand)$/i;
const DE_NAAM = /(?:straat|laan|lei|weg|dreef|baan|kaai|vest|singel|gang|poort|boulevard|dijk|plaats|markt|brug|rui|vliet|berg|ring|tunnel)$/i;
const OP_NAAM = /(?:plein|plaats|markt|brug|kaai|dijk)$/i;
const VASTE_NAAM = new Map([["meir", "op de"]]);
export function opStraat(naam) {
  const n = clean(naam, 120);
  if (!n) return "";
  const vast = VASTE_NAAM.get(n.toLowerCase());
  if (vast) return `${vast} ${n}`;
  const lidwoord = HET_NAAM.test(n) ? "het" : DE_NAAM.test(n) ? "de" : "";
  return lidwoord ? `${OP_NAAM.test(n) ? "op" : "in"} ${lidwoord} ${n}` : `in ${n}`;
}

// Een aansluiting, een verhuis of een container hoort bij één adres, meestal van een privépersoon:
// dan tonen we de straat, maar nooit het huisnummer.
const EEN_ADRES = /^(?:Nieuwe aansluiting|Verhuis|Container)/;
const STRAATWOORD = "\\p{L}[\\p{L}'.-]*(?:straat|laan|lei|plein|baan|weg|kaai|vest|rui|markt|plaats|dreef|pad|hof|dijk|singel|brug)";
// De tekst van de beheerder zoals GIPOD hem geeft, voor wie hem wil nalezen. Zonder huisnummers als
// het om één adres gaat; leeg als er niets meer staat dan een adres of als er contactgegevens in staan.
export function beheerderTekst(tekst, { zonderNummers = false, straten = [] } = {}) {
  let t = clean(tekst, 300);
  if (!t || CONTACT.test(t)) return "";
  if (zonderNummers) t = t.replace(new RegExp(`(${STRAATWOORD})(?:\\s*[|,:-]?\\s*)\\d+\\s?[a-z]?\\b(?:\\s*(?:-|–|tem|t\\/m|tot)\\s*\\d+[a-z]?\\b)?`, "giu"), "$1").replace(/\s+/g, " ").trim();
  let rest = ` ${t.toLowerCase()} `;
  for (const s of straten) rest = rest.split(clean(s, 120).toLowerCase()).join(" ");
  rest = rest.replace(/\b\d{4}\b/g, " ").replace(/\b(?:antwerpen|anterwerpen|antwerp)\b/g, " ").replace(new RegExp(STRAATWOORD, "gu"), " ").replace(/\d+[a-z]?/g, " ");
  return rest.split(/[^\p{L}]+/u).some((w) => w.length > 2) ? t : "";
}

// Feiten over één werk, zonder klok. De verversing bewaart ze; de site vult aan met vandaag.
export function werkFeiten(werk = {}, { huisnummers = "", huisnummerBron = "" } = {}) {
  const omschrijving = bruikbareOmschrijving(werk.title);
  const fasen = (werk.hindrance?.phases || [])
    .map((f) => ({ naam: clean(f.description, 160), start: dagVan(f.start), eind: dagVan(f.end), gevolgen: uniek((f.consequences || []).map(gevolgKort)) }))
    .filter((f) => f.naam && !CONTACT.test(f.naam))
    .sort((a, b) => a.start.localeCompare(b.start) || a.naam.localeCompare(b.naam, "nl"));
  const soort = soortVanWerk({
    omschrijving, fasen: fasen.map((f) => f.naam),
    occupancyTypes: werk.occupancyTypes || [], workTypes: werk.workTypes || [], eigenaar: clean(werk.owner || werk.ownerGroup, 160),
  });
  const straten = uniek((werk.streets || []).map((s) => s?.name));
  const eigenNummers = straten.length ? huisnummersUitTekst([omschrijving, ...fasen.map((f) => f.naam)].join(" · "), straten[0]) : "";
  const gevolgen = uniek(werk.hindrance?.consequences || []);
  // De periode van het zwaarste gevolg: de fasen die het noemen, anders de hele hinder.
  const hoofd = hoofdgevolgBron(gevolgen);
  const metHoofd = (werk.hindrance?.phases || []).filter((p) => (p.consequences || []).some((c) => clean(c, 160) === hoofd));
  const gevolgStart = metHoofd.map((p) => dagVan(p.start)).filter(Boolean).sort()[0] || dagVan(werk.hindrance?.start);
  const gevolgEind = metHoofd.map((p) => dagVan(p.end)).filter(Boolean).sort().at(-1) || dagVan(werk.hindrance?.end);
  // Geen straat op minder dan 35 m: de dichtste straatassen (site/street-core.js), als die er zijn.
  const buren = (werk.streetNearby || []).map((s) => ({ naam: clean(s?.name, 120), afstand: Math.round(Number(s?.distanceMeters)) })).filter((s) => s.naam && Number.isFinite(s.afstand));
  const nabij = straten.length || !buren.length ? null
    : werk.streetResolution === "ambiguous" && buren.length >= 2 ? { kruispunt: true, straten: buren.slice(0, 2).map((s) => s.naam) }
    : { kruispunt: false, straten: [buren[0].naam], afstand: buren[0].afstand };
  return {
    gipodId: Number(werk.gipodId) || null,
    soort: soort.soort,
    soortBron: soort.bron,
    omschrijving,
    fasen: uniekeFasen(fasen),
    // Alleen bewaren wat iets zegt: het bestand van de verversing laadt in elke browser.
    ...(innameLeesbaar(werk.occupancyTypes || []).length > 1 ? { inname: innameLeesbaar(werk.occupancyTypes) } : {}),
    opdrachtgever: clean(werk.owner, 160),
    straten,
    ...(nabij ? { nabij } : {}),
    huisnummers: eigenNummers || geldigeHuisnummers(huisnummers),
    huisnummerBron: eigenNummers ? "omschrijving van de beheerder" : geldigeHuisnummers(huisnummers) ? clean(huisnummerBron, 120) : "",
    gevolgen,
    // Alleen als het zwaarste gevolg een kortere periode heeft dan de hele hinder.
    ...(gevolgStart !== dagVan(werk.hindrance?.start) || gevolgEind !== dagVan(werk.hindrance?.end) ? { gevolgStart, gevolgEind } : {}),
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

// Het zwaarste gevolg in de titel, met zijn eigen periode als die niet samenvalt met het werk:
// "afgesloten voor auto's tot 30 november" bij een werk tot 6 juli 2027. Een gevolg dat al voorbij
// is, staat niet meer in de titel. Geeft { tekst, eigen } terug; eigen = met een eigen periode.
function gevolgInTitel(gevolg, { gs, ge, start, eind, vandaag, gepland }) {
  if (!gevolg || !vandaag) return { tekst: gevolg, eigen: false };
  const dt = (d) => datumBijVandaag(d, vandaag);
  const korter = Boolean(ge && eind && ge < eind);
  if (ge && ge < vandaag) return { tekst: "", eigen: false };
  if (gs && gs > vandaag && !(gepland && gs <= start)) return { tekst: `${gevolg} ${korter ? periodeTekst(gs, ge, vandaag) : `vanaf ${dt(gs)}`}`, eigen: true };
  if (korter) return { tekst: `${gevolg} tot ${dt(ge)}`, eigen: true };
  return { tekst: gevolg, eigen: false };
}

// Titel, korte uitleg en details voor één werk.
export function werkKaartje(werk = {}, { vandaag, feiten = null } = {}) {
  const f = feiten || werkFeiten(werk);
  const start = dagVan(werk.start), eind = dagVan(werk.end), v = dagVan(vandaag);
  const dt = (d) => datumBijVandaag(d, v);
  const straat = f.straten[0] || "";
  const eenAdres = EEN_ADRES.test(f.soort || "");
  const nummers = eenAdres ? "" : geldigeHuisnummers(f.huisnummers);
  const nabij = !straat && f.nabij?.straten?.length ? f.nabij : null;
  const soort = f.soort || (werk.ownerGroup && !/^(Andere|Onbekend)$/.test(werk.ownerGroup) ? `Werken van ${werk.ownerGroup}` : "Werken");
  // Waar, altijd met een voorzetsel: "in de Bermstraat nr. 2–10", of zonder straat het kruispunt of
  // de dichtste straat. Zonder enige straat in de buurt blijft de titel zonder plek.
  const waar = straat ? [opStraat(straat), nummers].filter(Boolean).join(" ")
    : nabij?.kruispunt ? `bij het kruispunt van ${joinNl(nabij.straten)}`
    : nabij ? `nabij ${opStraat(nabij.straten[0]).replace(/^(?:in|op) /, "")}` : "";
  const plek = straat ? [straat, nummers].filter(Boolean).join(" ") : nabij ? joinNl(nabij.straten) : "";
  // De hinder kan vroeger stoppen dan het werk; voor "tot wanneer" telt het werk zelf.
  const duur = resterendeDuur({ start, eind, vandaag });
  let wanneer = "";
  if (duur.toestand === "bezig") wanneer = `tot ${dt(eind)} (${duur.tekst})`;
  else if (duur.toestand === "gepland") wanneer = `vanaf ${dt(start)} (${duur.tekst})`;
  const gevolg = gevolgInTitel(hoofdgevolg(f.gevolgen), {
    gs: f.gevolgStart || f.hinderStart || "", ge: f.gevolgEind || f.hinderEind || "", start, eind, vandaag: v, gepland: duur.toestand === "gepland",
  });
  const kop = [soort, waar].filter(Boolean).join(" ");
  const titel = !gevolg.tekst ? [kop, wanneer].filter(Boolean).join(" ")
    : gevolg.eigen ? `${kop}: ${gevolg.tekst}${wanneer ? `; werken ${wanneer}` : ""}`
    : `${kop}: ${gevolg.tekst}${wanneer ? ` ${wanneer}` : ""}`;

  const ontbreekt = [];
  if (!f.omschrijving) ontbreekt.push(NIET_GEPUBLICEERD);
  if (!nummers && !eenAdres) ontbreekt.push("huisnummers niet gepubliceerd");
  if (f.hinderBekend === false) ontbreekt.push("gevolgen voor het verkeer niet gepubliceerd");
  if (f.hinderBekend === null) ontbreekt.push("gevolgen voor het verkeer nu niet opgehaald");
  if (!eind) ontbreekt.push("einddatum niet gepubliceerd");

  // Eerst één zin in gewone taal; de tekst van de beheerder staat apart (bronTekst, ingeklapt).
  const bronTekst = beheerderTekst(f.omschrijving, { zonderNummers: eenAdres, straten: f.straten });
  const inname = (f.inname || []).length > 1 ? ` Volgens GIPOD: ${f.inname.join(" · ")}.` : "";
  const regels = [];
  regels.push(["Wat", f.soort
    ? `${f.soort}, afgeleid uit de ${f.soortBron}.${inname}${f.omschrijving ? "" : " De beheerder publiceerde zelf geen omschrijving."}`
    : bronTekst ? `De beheerder schrijft: “${bronTekst}”`
    : f.omschrijving ? "Niet bekend: de beheerder gaf alleen een adres op." : `Niet bekend: ${NIET_GEPUBLICEERD}.`]);
  if (f.fasen.length) regels.push(["Fasen", f.fasen.map((x) => `${x.naam}${x.start || x.eind ? ` (${periodeTekst(x.start, x.eind, v)})` : ""}${x.gevolgen?.length ? `: ${x.gevolgen.join(", ")}` : ""}`).join(" · ")]);
  regels.push(["Opdrachtgever", f.opdrachtgever || "niet gepubliceerd"]);
  regels.push(["Waar", straat
    ? nummers ? `${straat}, ${nummers}${f.huisnummerBron ? ` (${f.huisnummerBron})` : ""}` : `${f.straten.join(", ")} (${eenAdres ? "huisnummer weggelaten: het gaat om één adres" : "huisnummers niet gepubliceerd"})`
    : nabij?.kruispunt ? `Bij het kruispunt van ${joinNl(nabij.straten)} (berekend uit het punt in GIPOD)`
    : nabij ? `Niet langs een straat; de dichtste straat is ${nabij.straten[0]} (ongeveer ${nabij.afstand} m)`
    : "Alleen als punt op de kaart van GIPOD; geen straat in de buurt gevonden"]);
  const ov = openbaarVervoer([...f.gevolgen, ...f.fasen.map((x) => x.naam), f.omschrijving]);
  if (f.gevolgen.length) regels.push(["Gevolgen", `${uniek(f.gevolgen).join(" · ")}${f.hinderStart || f.hinderEind ? ` (${periodeTekst(f.hinderStart, f.hinderEind, v)})` : ""}${f.ernstig ? " · ernstige hinder volgens GIPOD" : ""}`]);
  else regels.push(["Gevolgen", f.hinderBekend === null ? "nu niet opgehaald" : "niet gepubliceerd in GIPOD"]);
  if (ov.length) regels.push(["Bus en tram", ov.join(" · ")]);
  regels.push(["Duur", `${periodeTekst(start, eind, v) || "niet gepubliceerd"}${duur.tekst ? ` · ${duur.tekst}` : ""}`]);
  // De datums zeggen "bezig", GIPOD zegt nog "concreet gepland": zeg allebei, niet alleen "nu bezig".
  const status = clean(werk.status, 60);
  if (duur.toestand === "bezig" && status && !/^in uitvoering$/i.test(status)) {
    regels.push(["Stand", `De geplande periode loopt${start ? ` sinds ${dt(start)}` : ""}, maar GIPOD meldt het werk nog als “${status.toLowerCase()}”, niet als “in uitvoering”.`]);
  }

  const samenvatting = [
    f.omschrijving ? "" : f.soort ? `${f.soort} (afgeleid uit GIPOD).` : "Omschrijving niet gepubliceerd door de beheerder.",
    f.opdrachtgever ? `Opdrachtgever: ${f.opdrachtgever}.` : "",
    f.gevolgen.length ? `${capital(uniek(f.gevolgen).map(gevolgKort).join(", "))}.` : "",
  ].filter(Boolean).join(" ");
  return { titel, samenvatting, regels, ontbreekt, duur, plek, bronTekst: f.soort ? bronTekst : "" };
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
