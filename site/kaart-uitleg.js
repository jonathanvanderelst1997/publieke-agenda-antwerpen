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
// Volle kalendermaanden van dag a tot dag b (JJJJ-MM-DD).
function maandenTussen(a, b) {
  const m = (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
  return Number(b.slice(8, 10)) < Number(a.slice(8, 10)) ? m - 1 : m;
}
// Lange termijnen in maanden of jaren: "nog 2641 dagen" zegt een bewoner niets, en "ruim een jaar" voor
// 21 maanden is te weinig. Van 1 tot 2 jaar in maanden ("ruim 20 maanden"), daarna in jaren.
const termijn = (n, van, tot) => {
  if (n >= 730) return `ruim ${Math.floor(n / 365)} jaar`;
  if (n >= 365) { const m = maandenTussen(van, tot); return `${van.slice(8) === tot.slice(8) ? "" : "ruim "}${m} maanden`; }
  return meervoud(n, "dag", "dagen");
};

// Hoe lang nog: "nog 38 dagen", "start over 6 dagen", of eerlijk "einddatum niet gepubliceerd".
export function resterendeDuur({ start, eind, vandaag }) {
  const s = dagVan(start), e = dagVan(eind), v = dagVan(vandaag);
  if (!v) return { toestand: "onbekend", dagen: null, tekst: "" };
  if (s && s > v) {
    const n = dagenTussen(v, s);
    return { toestand: "gepland", dagen: n, tekst: n === 1 ? "start morgen" : `start over ${termijn(n, v, s)}` };
  }
  if (!e) return { toestand: "onbekend", dagen: null, tekst: "einddatum niet gepubliceerd" };
  if (e < v) return { toestand: "voorbij", dagen: 0, tekst: "afgelopen" };
  const n = dagenTussen(v, e);
  return { toestand: "bezig", dagen: n, tekst: n === 0 ? "laatste dag vandaag" : `nog ${termijn(n, v, e)}` };
}

// ---------- soort werk ----------

// Volgorde telt: het specifiekere woord eerst ("afbouw stelling" is een stelling, geen sloop).
// Korte woorden staan tussen woordgrenzen, zodat een straatnaam niet meetelt: "Boomgaardstraat" is
// geen groenwerk. "distributienet" zegt niet welk net (elektriciteit, gas, water of warmte), dus
// dat woord alleen maakt nooit een elektriciteitswerk.
const AANSLUITING = "Nieuwe aansluiting op het net";
const NUTSWERK = "Werken aan nutsleidingen";
const HOOGTEWERKER = "Werk met een hoogtewerker";
const WEGENWERKEN = "Wegenwerken";
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
  // "voetpadkast" is een kast op het voetpad, geen wegenwerk: de paden tussen woordgrenzen.
  [/heraanleg|herinrichting|wegenis|asfalt|bestrating|\b(?:fiets|voet)pad(?:en)?\b|\brijweg(?:en)?\b|kasseien/i, WEGENWERKEN],
  [/tijdelijke halte|tramhalte|bushalte|tramsporen|tramlijn|\bde lijn\b/i, "Werken aan tram of bus"],
  [/hoogtewerker/i, HOOGTEWERKER],
  // "doorloopstelling", "gevelstelling" en "torenstelling" zijn een stelling; een "herstelling" niet.
  [/(?:\b|door|loop|gevel|toren)stelling|steiger/i, "Stelling (steiger)"],
  [/\bgevel/i, "Gevelwerken"],
  [/dakwerk|\bdak\b|\bdaken\b/i, "Dakwerken"],
  [/torenkraan|snelmontagekraan|mobiele kraan|\bkraan\b/i, "Bouwkraan"],
  [/\bsloop|afbraak|afbreken/i, "Sloopwerken"],
  // "Renovatie" alleen bij een gebouw: "Renovatie Havenwegen" is een weg, geen bouwwerf.
  [/ruwbouw|nieuwbouw|appartement|verbouwing|(?:gevel|dak|woning|gebouw)renovatie|renovatie (?:van )?(?:de |het |een )?(?:woning|gebouw|pand|huis|school|kerk|gevel)|bouwwerf|bouwproject/i, "Bouwwerf"],
  [/\bverhuis/i, "Verhuis"],
  [/\bcontainers?\b/i, "Container"],
  [/\bsnoei|\bboom\b|\bbomen\b|groenaanleg|beplanting/i, "Groenwerken"],
];
// Eén soort uit vrije tekst: de eerste bron met een herkend woord wint. `zonder`: soorten die niet tellen.
export function soortWerk(bronnen = [], { zonder = [] } = {}) {
  for (const { tekst, bron } of bronnen) {
    const t = clean(tekst, 500);
    if (!t) continue;
    for (const [re, soort] of SOORTEN_WERK) if (!zonder.includes(soort) && re.test(t)) return { soort, bron };
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
  ["hoogtewerker", HOOGTEWERKER],
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
// Beheerders van een net (elektriciteit, gas, warmte, water, riolering, telecom).
const NETBEHEERDER = /fluvius|proximus|water-?link|\bwyre\b|aquafin|\belia\b|eurofiber|telenet|pidpa|farys|watergroep|fiberklaar|unifiber/i;
// Een wegenwerk als deel van het project ("E, G, OV, Wegeniswerken"), niet alleen de bovenlaag van een werkput.
const WEGEN_PROJECT = /wegeniswerk|heraanleg|herinrichting/i;

// De soort van één werk, met de bron erbij. Eerst wat de beheerder schreef (omschrijving, fasen),
// dan de vaste soort inname van GIPOD, en pas als laatste de soort grondwerk ("distributienet",
// "klantaansluiting"): die zegt hoe er gegraven wordt, niet aan welk net.
export function soortVanWerk({ omschrijving = "", fasen = [], occupancyTypes = [], workTypes = [], eigenaar = "" } = {}) {
  const bronnen = [
    { tekst: omschrijving, bron: "omschrijving van de beheerder" },
    ...fasen.map((naam) => ({ tekst: naam, bron: "fasen van de hinder in GIPOD" })),
  ];
  let tekst = soortWerk(bronnen);
  // Een hoogtewerker is een middel, geen soort werk ("Lossen hoogtewerkers" bij een tunnelsluiting): een
  // ander woord in de tekst of de soort inname gaat voor. Pas als er niets anders is, blijft hij staan.
  let hoogtewerker = null;
  if (tekst.soort === HOOGTEWERKER) {
    const ander = soortWerk(bronnen, { zonder: [HOOGTEWERKER] });
    if (ander.soort) tekst = ander; else { hoogtewerker = tekst; tekst = { soort: "", bron: "" }; }
  }
  const inname = nettenUitInname(occupancyTypes, eigenaar);
  const netten = inname.length ? inname : nettenUitTekst([omschrijving, ...fasen]);
  const metInname = (bron) => (inname.length ? `${bron} en de soort inname in GIPOD` : bron);
  // Een netbeheerder met een net in de soort inname: dat net is het werk. Een wegwoord in de tekst is
  // dan de bovenlaag van een werkput ("Werkput (openb): Bestrating") of een deel van het project
  // ("E, G, OV, Wegeniswerken"); dat laatste zeggen we erbij.
  if (tekst.soort === WEGENWERKEN && inname.length && NETBEHEERDER.test(eigenaar)) {
    if (WEGEN_PROJECT.test([omschrijving, ...fasen].join(" · "))) return { soort: `${netSoort(inname)}, samen met wegenwerken`, bron: metInname(tekst.bron) };
    tekst = { soort: "", bron: "" };
  }
  const types = splitsTypes(occupancyTypes);
  const grondwerk = splitsTypes(workTypes);
  // "distributienet", "transportnet" of "verkaveling" als soort grondwerk: werk aan het net zelf (vaak
  // honderden meters), ook als de beheerder er "klantaansluiting" bij schrijft. Dus geen aansluiting van één adres.
  const netwerk = grondwerk.some((t) => /distributienet|transportnet|verkaveling/.test(t));
  if (tekst.soort === AANSLUITING && netwerk) {
    if (!inname.length) return netten.length ? { soort: netSoort(netten), bron: `${tekst.bron} en de soort grondwerk in GIPOD` } : { soort: NUTSWERK, bron: "soort grondwerk in GIPOD" };
    tekst = { soort: "", bron: "" };
  }
  if (tekst.soort === AANSLUITING && netten.length) return { soort: aansluitingSoort(netten), bron: metInname(tekst.bron) };
  if (tekst.soort === NUTSWERK && inname.length) return { soort: netSoort(inname), bron: metInname(tekst.bron) };
  if (tekst.soort) return tekst;
  if (inname.length) {
    if (grondwerk.includes("klantaansluiting") && !netwerk) return { soort: aansluitingSoort(inname), bron: "soort inname en soort grondwerk in GIPOD" };
    // Wegen of een kunstwerk samen met leidingen: een grote werf, geen gewoon nutswerk.
    if (types.some((t) => t === "wegeniswerken" || t === "kunstwerk")) return { soort: "Wegen- en nutswerken", bron: "soort inname in GIPOD" };
    return { soort: netSoort(inname), bron: `soort inname${netwerk ? " en soort grondwerk" : ""} in GIPOD` };
  }
  // GIPOD zegt "Hoogtewerker;Nutswerken": allebei woorden uit de vaste lijst, dus "Nutswerken met een hoogtewerker".
  if (types.includes("hoogtewerker") && types.includes("nutswerken")) return { soort: "Nutswerken met een hoogtewerker", bron: "soort inname in GIPOD" };
  for (const [type, soort] of INNAME_SOORT) if (types.includes(type)) return { soort, bron: "soort inname in GIPOD" };
  if (grondwerk.includes("klantaansluiting") && !netwerk && netten.length) return { soort: aansluitingSoort(netten), bron: "soort grondwerk in GIPOD" };
  if (hoogtewerker) return hoogtewerker;
  return soortWerk(grondwerk.map((t) => ({ tekst: t, bron: "soort grondwerk in GIPOD" })), { zonder: netwerk ? [AANSLUITING] : [] });
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
// Een reeks in elke schrijfwijze telt als reeks: "13 tem 15", "13 t.e.m. 15", "13 tot en met 15", "13 t/m 15",
// "13 tot 15", "13 → 15", "13 en 15" en "13, 15 en 17" geven allemaal "nr. 13–15" (of 13–17), nooit "nr. 13".
// Hoogstens drie cijfers: "Proefstraat 13, 2000 Antwerpen" is geen reeks tot 2000. Na een komma of "en"
// telt een getal alleen als er geen woord op volgt ("Proefstraat 12, 3 dagen" is geen reeks).
const NUMMER = String.raw`\d{1,3}[a-z]?(?![\d\p{L}])`;
const REEKS = String.raw`\s*(?:-|–|—|→|tot en met|t\.\s?e\.\s?m\.?|tem|t\/m|tot)\s*`;
const OPSOMMING = String.raw`\s*(?:,|en)\s*`;
const NA_OPSOMMING = String.raw`(?=\s*(?:$|[.;:,)/|]|[-–→]|(?:en|tem|tot|t\/m)(?!\p{L})))`;
export function huisnummersUitTekst(tekst, straat) {
  const t = clean(tekst, 400), s = clean(straat, 120);
  if (!t || !s) return "";
  const esc = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = t.match(new RegExp(`${esc}\\s+(${NUMMER}(?:${REEKS}${NUMMER}|${OPSOMMING}${NUMMER}${NA_OPSOMMING})*)`, "iu"));
  if (!m) return "";
  return geldigeHuisnummers(huisnummerBereik(m[1].match(/\d{1,3}[a-z]?/gi)));
}
// Eén los huisnummer kan een woning zijn: dat tonen en bewaren we niet, net zoals bij een parkeerverbod
// of een aansluiting (dan alleen de straat). Een reeks ("nr. 13–15", "nr. 2–34") zegt over welk stuk
// straat een werk loopt en blijft staan.
export function huisnummerReeks(tekst) {
  const t = geldigeHuisnummers(tekst);
  return /–/.test(t) ? t : "";
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
const DE_NAAM = /(?:straat|laan|lei|weg|dreef|baan|kaai|vest|singel|gang|steeg|poort|boulevard|dijk|plaats|markt|brug|rui|vliet|waag|berg|ring|tunnel)$/i;
// Een "vliet" (Sint-Jansvliet), een "waag" (Oude Waag) en de Singel zijn een plein of een ring: "op de".
const OP_NAAM = /(?:plein|plaats|markt|brug|kaai|dijk|vliet|waag|singel)$/i;
// Namen zonder herkenbaar einde die iedereen in Antwerpen met een lidwoord zegt.
const VASTE_NAAM = new Map([["meir", "op de"], ["wapper", "op de"], ["oudaan", "op de"]]);
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
export const isEenAdres = (soort) => EEN_ADRES.test(clean(soort, 120));
// Elk huisnummer, ook met een aanhangsel of na een streep: "79WERF", "6werf", "4B_BIS", "65RP", "| 13",
// "nr. 12", "18-24". Niet: een postcode (vier cijfers), een maat ("25m", "10kV") of "DN300".
const HUISNUMMER = /(^|[^\p{L}\d])(?:nrs?\.?\s*)?\d{1,3}(?!\d|\s?(?:m|km|cm|mm|kv)\b)[\p{L}_]*(?:\s*(?:-|–|tem|t\/m|tot)\s*\d{1,3}(?!\d)[\p{L}_]*)?(?=$|[^\p{L}\d])/giu;
// "Fase 1", "deel 2", "zone 3" of "nacht 1" is een volgnummer, geen huisnummer.
const VOLGNUMMER_ERVOOR = /(?:^|[^\p{L}])(?:fase|deel|zone|werfzone|nacht|week|stap|put)\s*$/iu;
// Een tekst zonder huisnummers (voor één adres: de tekst van de beheerder, de namen van de fasen).
export function zonderHuisnummers(tekst, max = 300) {
  return clean(tekst, max)
    .replace(HUISNUMMER, (m, voor, offset, hele) => (VOLGNUMMER_ERVOOR.test(hele.slice(0, offset + voor.length)) ? m : voor))
    .replace(/\s+/g, " ").replace(/(?:\s*[|,:;–-])+\s*$/u, "").replace(/\s*([|,])(?:\s*[|,])+/g, " $1").trim();
}
// Een naam na een dossiercode ("DNW12345678_Voornaam Achternaam LS_…") is een persoon, bv. een
// werkleider: die bewaren en tonen we niet. Een code met cijfers erna ("PG0971_N1_…") blijft.
// Een achternaam met een hoofdletter of in hoofdletters (minstens drie: "LS" is laagspanning).
const NAAM_NA_CODE = /(\b[A-Z]{2,6}\d{4,}_)\p{Lu}\p{Ll}+(?:[ -](?:(?:van|de|der|den|du|le|la|el|ten|ter)\s)*\p{Lu}(?:\p{Ll}[\p{L}'’]*|\p{Lu}{2,}[\p{Lu}'’]*)){1,3}/gu;
export function zonderNamen(tekst, max = 300) {
  return clean(tekst, max).replace(NAAM_NA_CODE, "$1");
}
// Een los dossiernummer van zeven cijfers of meer ("Beatrijslaan - 20330374 - Koppelput") zegt een
// bewoner niets en lijkt voor de filter op contactgegevens een telefoonnummer: weg ermee, de fase blijft.
const zonderDossiernummers = (t) => t.replace(/(?<![\p{L}\d])\d{7,}(?![\p{L}\d])/gu, " ").replace(/(?:\s*[-–|]\s*){2,}/g, " - ").replace(/\s+/g, " ").trim();
const sleutel = (v) => clean(v, 300).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
// De tekst van de beheerder zoals GIPOD hem geeft, voor wie hem wil nalezen. Zonder huisnummers als
// het om één adres gaat; leeg als er niets meer staat dan het adres op de kaart of als er contactgegevens
// in staan. Noemt de beheerder een andere straat dan de kaart, dan blijft de tekst staan.
export function beheerderTekst(tekst, { zonderNummers = false, straten = [] } = {}) {
  let t = zonderNamen(tekst);
  if (!t || CONTACT.test(t)) return "";
  if (zonderNummers) t = zonderHuisnummers(t);
  return heeftInhoud(t, straten) ? t : "";
}
// Staat er meer dan het adres (postcode, gemeente, de straten van de kaart, nummers)?
function heeftInhoud(t, straten = []) {
  let rest = ` ${sleutel(t)} `;
  for (const s of straten) if (sleutel(s)) rest = rest.split(sleutel(s)).join(" ");
  rest = rest.replace(/\b\d{4}\b/g, " ").replace(/\b(?:antwerpen|anterwerpen|antwerp|andere)\b/g, " ").replace(/\d+[\p{L}_]*/gu, " ");
  return rest.split(/[^\p{L}]+/u).some((w) => w.length > 2);
}

// Wat de beheerder over het werk of het project zegt: "R1 - Ringpark Zuid", "Verkaveling",
// "Regio – Energietransitie". Per stuk tekst (tussen " - ", "|", "," …) valt weg wat alleen een adres,
// een gemeente, een nummer, een maat, een netcode (E, G, OV) of een soortwoord is; lopende zinnen
// blijven heel. Leeg als er niets anders overblijft.
const NET_CODES = /(?<![\p{L}\d])(?:E|G|OV|W|T|LS|MS|HS)(?![\p{L}\d])/gu;
const SOORT_WOORDEN = /(?<!\p{L})(?:klantaansluiting(?:en)?|wegeniswerk(?:en)?|nutswerk(?:en)?|grondwerk(?:en)?)(?!\p{L})/giu;
const STRAAT_EINDE = "(?:steenweg|straat|laan|lei|weg|dreef|baan|kaai|vest|singel|gang|poort|boulevard|dijk|plaats|markt|brug|rui|vliet|berg|ring|tunnel|plein|pad|park|hof|eiland|dok|veld|erf|bos|kwartier|strand)";
// Een reeks in elke schrijfwijze, zoals in huisnummersUitTekst: "12-14", "12 tem 14", "12 t.e.m. 14", "12 tot en met 14".
const HUISNR = "(?:[Nn][Rr]\\.?\\s*)?\\d{1,4}(?:\\s?[a-zA-Z](?!\\p{L}|\\.\\p{L}))?(?:\\s*(?:-|–|/|→|en|tot en met|t\\.\\s?e\\.\\s?m\\.?|tem|t\\/m|tot)\\s*\\d{1,4}[a-zA-Z]?)?";
// Alleen een straatnaam (woorden met een hoofdletter, "van", "de" …) met eventueel een huisnummer:
// "Brederodestraat | 39", "LONDENSTRAAT", "Pieter van Hobokenstraat 6". Niet "Betonherstel op trambaan".
const STRAAT_WOORD = "(?:\\p{Lu}[\\p{L}'.-]*|van|de|der|den|het|ten|ter|la|le|du|des)";
const ALLEEN_ADRES = new RegExp(`^(?:\\d{4}\\s+)?(?:${STRAAT_WOORD}[\\s-]+){0,4}\\p{Lu}[\\p{L}'.-]*(?:${STRAAT_EINDE}|${STRAAT_EINDE.toUpperCase()})(?:\\s*\\[[^\\]]*\\])?(?:\\s+${HUISNR})?\\.?$`, "u");
const LEEG_STUK = [
  /^(?:nr\.?\s*)?\d{1,4}(?:\s?[a-z])?\.?$/i, // een nummer of een postcode
  /^(?:\d{4}\s+)?\(?(?:antwerpen|antwerp|anterwerpen)\)?$/i, // de gemeente
  /^\([\p{L}\s-]+\)$/u, // een gemeente tussen haakjes: "(Hoboken)"
  /^\d{4}\s+[\p{L}-]+$/u, // postcode en gemeente: "2610 WILRIJK"
  /^\p{Lu}[\p{Lu}'.-]+(?:\s+\p{Lu}[\p{Lu}'.-]+){0,3}\s+\d{1,4}[a-zA-Z]?$/u, // een straat in hoofdletters met nummer: "KIELSBROEK 5"
  /^\(?\s*(?:lengte:?\s*)?\d+(?:[.,]\d+)?\s?(?:m|km|m²|m2)\.?\s*\)?$/i, // een maat
  /^(?:andere|werk in openbaar domein|rioleringswerk(?:en)?)$/i,
];
// "werken distributieleiding)" en "werken aan nutsleiding" herhalen alleen de soort; wat er dan nog van
// één woord overblijft ("tussen", een afgekapte straatnaam), is geen uitleg.
const LEIDING_ZIN = /(?<!\p{L})werken (?:aan )?(?:de )?(?:distributie|nuts|drinkwater|water)leiding(?:en)?\)?/giu;
// zonderAccenten: zoals plat() bij koppelEvenement, maar met hoofdletters en leestekens.
const zonderAccenten = (v) => v.normalize("NFD").replace(/[̀-ͯ]/g, "");
const escRe = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function projectTekst(tekst, { straten = [], max = 140 } = {}) {
  let t = clean(tekst, 300);
  // De Lijn: "Locatie: … Aard van de werken: …".
  const aard = t.match(/aard van de werken:\s*(.+)$/i);
  if (aard) t = aard[1];
  const kaartStraat = straten.map((s) => clean(s, 120)).filter(Boolean)
    .map((s) => new RegExp(`^${escRe(zonderAccenten(s))}(?:\\s*\\[[^\\]]*\\])?(?:\\s+${HUISNR}(?![\\p{L}\\d]))?\\.?\\s*`, "iu"));
  // Ook per zin ("Xstraat 13 tem 15. Ystraat 2."), en tussen twee adressen die een reeks vormen
  // ("Xplein 70 tem Ystraat 2"): elk stuk dat alleen een adres is, valt dan weg.
  const delen = t.split(/(\s+[-–|:]\s+|\s*[|;]\s*|,\s*|_|\.\s+(?=\p{Lu})|\s+(?:tem|t\.\s?e\.\s?m\.?|tot en met|t\/m)\s+(?=\p{Lu}))/u);
  const blijft = [];
  for (let i = 0; i < delen.length; i += 2) {
    // Vooraan: "2018 Antwerpen" of een volgnummer van de beheerder ("5204: Voorbeeldstraat 2A").
    let stuk = delen[i].replace(/^(?:\d{4}\s+)?\(?(?:antwerpen|antwerp)\)?(?!\p{L})\s*:?\s*(?=\S)/iu, (m) => (/^\d|:/.test(m) ? "" : m)).replace(/^\d{3,5}\s*:\s*/, "").trim();
    const voorLeiding = stuk;
    stuk = stuk.replace(LEIDING_ZIN, " ");
    const leiding = stuk !== voorLeiding;
    for (const re of kaartStraat) if (re.test(zonderAccenten(stuk))) stuk = zonderAccenten(stuk).replace(re, "");
    stuk = stuk.replace(/\(\s*lengte:?\s*\d+\s?m\s*\)/gi, " ").replace(NET_CODES, " ").replace(SOORT_WOORDEN, " ").replace(/\s+/g, " ").replace(/^[\s,;:.-]+|[\s,;:-]+$/g, "").replace(/^(?:en|of|tem|t\/m|tot(?: en met)?|t\.\s?e\.\s?m\.?)\s+/i, "").trim();
    if (!stuk || (leiding && !/\s/.test(stuk)) || ALLEEN_ADRES.test(stuk) || LEEG_STUK.some((re) => re.test(stuk))) continue;
    blijft.push(`${blijft.length ? delen[i - 1] : ""}${stuk}`);
  }
  const uit = blijft.join("").trim();
  if (!uit || !heeftInhoud(uit, straten)) return "";
  return uit.length > max ? `${uit.slice(0, max).replace(/\s+\S*$/, "")} …` : uit;
}

// De postcodes van district Antwerpen. Een fase die met een andere postcode begint ("2070 Beveren-…"),
// ligt buiten het district: haar gevolgen horen niet in de titel.
const DISTRICT_POSTCODES = new Set(["2000", "2018", "2020", "2030", "2050", "2060"]);
export function faseBuitenDistrict(naam) {
  const m = clean(naam, 160).match(/^(\d{4})\s+\p{L}/u);
  return Boolean(m && !DISTRICT_POSTCODES.has(m[1]));
}

// Feiten over één werk, zonder klok. De verversing bewaart ze; de site vult aan met vandaag.
// Bij één adres (een aansluiting, een verhuis, een container) bewaren we geen huisnummer: niet als
// veld, niet in de omschrijving en niet in de namen van de fasen. Een naam na een dossiercode ook niet.
export function werkFeiten(werk = {}, { huisnummers = "", huisnummerBron = "" } = {}) {
  const ruweOmschrijving = zonderNamen(bruikbareOmschrijving(werk.title));
  const ruweFasen = (werk.hindrance?.phases || [])
    .map((f) => ({ naam: zonderDossiernummers(zonderNamen(f.description, 160)), start: dagVan(f.start), eind: dagVan(f.end), gevolgen: uniek((f.consequences || []).map(gevolgKort)), ...(faseBuitenDistrict(f.description) ? { buiten: true } : {}) }))
    .filter((f) => f.naam && !CONTACT.test(f.naam))
    .sort((a, b) => a.start.localeCompare(b.start) || a.naam.localeCompare(b.naam, "nl"));
  const soort = soortVanWerk({
    omschrijving: ruweOmschrijving, fasen: ruweFasen.map((f) => f.naam),
    occupancyTypes: werk.occupancyTypes || [], workTypes: werk.workTypes || [], eigenaar: clean(werk.owner || werk.ownerGroup, 160),
  });
  const eenAdres = isEenAdres(soort.soort);
  const omschrijving = eenAdres ? zonderHuisnummers(ruweOmschrijving) : ruweOmschrijving;
  const fasen = eenAdres ? ruweFasen.map((f) => ({ ...f, naam: zonderHuisnummers(f.naam, 160) })).filter((f) => f.naam) : ruweFasen;
  const straten = uniek((werk.streets || []).map((s) => s?.name));
  // Alleen een reeks blijft (huisnummerReeks): één los huisnummer kan een woning zijn, ook bij een werk.
  const eigenNummers = straten.length && !eenAdres ? huisnummerReeks(huisnummersUitTekst([omschrijving, ...fasen.map((f) => f.naam)].join(" · "), straten[0])) : "";
  const registerNummers = huisnummerReeks(huisnummers);
  const gevolgen = uniek(werk.hindrance?.consequences || []);
  // Fasen buiten het district tellen niet voor de titel: dan alleen de gevolgen van de fasen erbinnen.
  const alleFasen = werk.hindrance?.phases || [];
  const binnen = alleFasen.filter((p) => !faseBuitenDistrict(p.description));
  const titelGevolgen = binnen.length === alleFasen.length ? gevolgen : uniek(binnen.flatMap((p) => p.consequences || []));
  // De periode van het zwaarste gevolg: de fasen die het noemen, anders de hele hinder.
  const hoofd = hoofdgevolgBron(titelGevolgen);
  const metHoofd = binnen.filter((p) => (p.consequences || []).some((c) => clean(c, 160) === hoofd));
  const gevolgStart = metHoofd.map((p) => dagVan(p.start)).filter(Boolean).sort()[0] || dagVan(werk.hindrance?.start);
  const gevolgEind = metHoofd.map((p) => dagVan(p.end)).filter(Boolean).sort().at(-1) || dagVan(werk.hindrance?.end);
  // Geen straat op minder dan 35 m: de dichtste straatassen (site/street-core.js), als die er zijn. Twijfel
  // tussen twee straten is alleen een kruispunt als hun assen elkaar raken; anders ligt het werk ertussen.
  const buren = (werk.streetNearby || []).map((s) => ({ naam: clean(s?.name, 120), afstand: Math.round(Number(s?.distanceMeters)) })).filter((s) => s.naam && Number.isFinite(s.afstand));
  const nabij = straten.length || !buren.length ? null
    : werk.streetResolution === "ambiguous" && buren.length >= 2
      ? { kruispunt: werk.streetsMeet === true, tussen: werk.streetsMeet !== true, straten: buren.slice(0, 2).map((s) => s.naam), afstanden: buren.slice(0, 2).map((s) => s.afstand) }
    : { kruispunt: false, straten: [buren[0].naam], afstand: buren[0].afstand };
  // De straat komt uit de omschrijving van de beheerder (het punt lag niet eenduidig langs een straat).
  const straatUitTekst = straten.length && werk.streetResolution === "official_address_match";
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
    ...(straatUitTekst ? { straatBron: "omschrijving van de beheerder", straatAfstand: Math.round(Number(werk.streetDistanceMeters)) || 0 } : {}),
    // Gezocht en geen straat met naam binnen 150 m, of niet kunnen zoeken (geen straatassen geladen).
    ...(!straten.length && !nabij ? { straatGezocht: Array.isArray(werk.streetNearby) } : {}),
    huisnummers: eenAdres ? "" : eigenNummers || registerNummers,
    huisnummerBron: eenAdres ? "" : eigenNummers ? "omschrijving van de beheerder" : registerNummers ? clean(huisnummerBron, 120) : "",
    gevolgen,
    ...(titelGevolgen !== gevolgen ? { titelGevolgen } : {}),
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

// Een eigen periode in gewone taal: "op 12 oktober", "van 2 tot 6 november", "van 30 november 2026 tot
// 2 oktober 2027". Jaartallen zoals periodeTekst.
export function vanTot(start, eind, vandaag) {
  const s = dagVan(start), e = dagVan(eind), v = dagVan(vandaag);
  if (!s || !e) return s ? `vanaf ${datumBijVandaag(s, v)}` : e ? `tot ${datumBijVandaag(e, v)}` : "";
  if (s === e) return `op ${datumBijVandaag(s, v)}`;
  const jaar = [s, e].some((d) => !v || d.slice(0, 4) !== v.slice(0, 4)) || dagenTussen(s, e) > 300;
  return `van ${s.slice(0, 7) === e.slice(0, 7) ? Number(s.slice(8, 10)) : datumTekst(s, { jaar })} tot ${datumTekst(e, { jaar })}`;
}
// Een eigen periode staat pas apart in de titel als ze minstens een week korter is dan het werk.
const WEEK = 7;
// Het zwaarste gevolg in de titel, met zijn eigen periode als die niet samenvalt met het werk:
// "afgesloten voor auto's tot 30 november" bij een werk tot 6 juli 2027. Een gevolg dat al voorbij
// is, staat niet meer in de titel. Geeft { tekst, vorm } terug:
// - "samen": het gevolg loopt zo lang als het werk ("afgesloten voor auto's tot 20 november (nog 42 dagen)");
// - "eigen": met een eigen periode, daarna "; werken tot …";
// - "kort": stopt minder dan een week voor het werk; de titel noemt alleen de einddatum van het gevolg;
// - "laatste": alleen op de laatste dag van het werk ("op 4 januari 2027, de laatste dag van de werken");
// - "na": GIPOD meldt het gevolg pas na het einde van het werk (of vanaf de laatste dag tot erna); dan
//   geen "werken tot" (wel "werken vanaf" als het werk nog moet beginnen).
function gevolgInTitel(gevolg, { gs, ge, start, eind, vandaag, gepland }) {
  if (!gevolg || !vandaag) return { tekst: gevolg, vorm: "samen" };
  const dt = (d) => datumBijVandaag(d, vandaag);
  if (ge && ge < vandaag) return { tekst: "", vorm: "samen" };
  if (gs && eind && (gs > eind || (gs === eind && ge > eind))) return { tekst: `${gevolg} ${vanTot(gs, ge, vandaag)}`, vorm: "na" };
  const korter = Boolean(ge && eind && ge < eind);
  const veelKorter = korter && dagenTussen(ge, eind) >= WEEK;
  // Een gevolg dat nog moet beginnen, krijgt altijd zijn begindatum: anders lijkt het nu al te gelden.
  if (gs && gs > vandaag) {
    // Begint samen met een gepland werk en loopt (bijna) even lang: "… vanaf 9 november (start over 30 dagen)".
    if (gepland && gs === start && !veelKorter) return { tekst: gevolg, vorm: "samen" };
    if (gs === eind && (!ge || ge === eind) && !(gepland && gs <= start)) return { tekst: `${gevolg} op ${dt(gs)}, de laatste dag van de werken`, vorm: "laatste" };
    // Hinder vóór een gepland werk ("op 30 oktober; werken vanaf 9 november") of die vóór het einde van
    // het werk stopt ("van 15 tot 16 oktober; werken vanaf 14 oktober"): met haar einddatum.
    const eigenEinde = korter || (gepland && gs < start);
    return { tekst: `${gevolg} ${eigenEinde ? vanTot(gs, ge, vandaag) : `vanaf ${dt(gs)}`}`, vorm: "eigen" };
  }
  if (veelKorter) return { tekst: `${gevolg} tot ${dt(ge)}`, vorm: "eigen" };
  if (korter && !gepland) return { tekst: `${gevolg} tot ${dt(ge)}`, vorm: "kort" };
  return { tekst: gevolg, vorm: "samen" };
}

// Titel, korte uitleg en details voor één werk.
export function werkKaartje(werk = {}, { vandaag, feiten = null } = {}) {
  const f = feiten || werkFeiten(werk);
  const start = dagVan(werk.start), eind = dagVan(werk.end), v = dagVan(vandaag);
  const dt = (d) => datumBijVandaag(d, v);
  const straat = f.straten[0] || "";
  const eenAdres = EEN_ADRES.test(f.soort || "");
  // Alleen een reeks huisnummers; één los nummer (uit de tekst van de beheerder, het adressenregister of
  // een oudere verversing) laten we weg, en dat zeggen we bij "Waar".
  const nummers = eenAdres ? "" : huisnummerReeks(f.huisnummers);
  const losNummerWeg = !eenAdres && !nummers && Boolean(geldigeHuisnummers(f.huisnummers) || (f.straten[0] && huisnummersUitTekst(f.omschrijving, f.straten[0])));
  const nabij = !straat && f.nabij?.straten?.length ? f.nabij : null;
  const soort = f.soort || (werk.ownerGroup && !/^(Andere|Onbekend)$/.test(werk.ownerGroup) ? `Werken van ${werk.ownerGroup}` : "Werken");
  // Waar, altijd met een voorzetsel: "in de Bermstraat nr. 2–10", of zonder straat het kruispunt of
  // de dichtste straat. Zonder enige straat in de buurt blijft de titel zonder plek.
  const waar = straat ? [opStraat(straat), nummers].filter(Boolean).join(" ")
    : nabij?.kruispunt ? `bij het kruispunt van ${joinNl(nabij.straten)}`
    : nabij?.tussen ? `tussen ${joinNl(nabij.straten)}`
    : nabij ? `nabij ${opStraat(nabij.straten[0]).replace(/^(?:in|op) /, "")}` : "";
  const plek = straat ? [straat, nummers].filter(Boolean).join(" ") : nabij ? joinNl(nabij.straten) : "";
  // De hinder kan vroeger stoppen dan het werk; voor "tot wanneer" telt het werk zelf.
  const duur = resterendeDuur({ start, eind, vandaag });
  let wanneer = "";
  if (duur.toestand === "bezig") wanneer = `tot ${dt(eind)} (${duur.tekst})`;
  else if (duur.toestand === "gepland") wanneer = `vanaf ${dt(start)} (${duur.tekst})`;
  // Gevolgen in een fase buiten het district (bv. postcode 2070) horen niet in de titel of de samenvatting.
  const titelGevolgen = f.titelGevolgen || f.gevolgen;
  const gevolg = gevolgInTitel(hoofdgevolg(titelGevolgen), {
    gs: f.gevolgStart || f.hinderStart || "", ge: f.gevolgEind || f.hinderEind || "", start, eind, vandaag: v, gepland: duur.toestand === "gepland",
  });
  const kop = [soort, waar].filter(Boolean).join(" ");
  const tussenHaakjes = (t) => (t ? ` (${t})` : "");
  const titel = !gevolg.tekst ? [kop, wanneer].filter(Boolean).join(" ")
    : gevolg.vorm === "na" ? `${kop}: ${gevolg.tekst}${duur.toestand === "gepland" ? `; werken ${wanneer}` : ""}`
    : gevolg.vorm === "kort" ? `${kop}: ${gevolg.tekst}${tussenHaakjes(resterendeDuur({ start, eind: f.gevolgEind || f.hinderEind, vandaag }).tekst)}`
    : gevolg.vorm === "laatste" ? `${kop}: ${gevolg.tekst}${duur.toestand === "gepland" ? `; werken ${wanneer}` : tussenHaakjes(duur.tekst)}`
    : gevolg.vorm === "eigen" ? `${kop}: ${gevolg.tekst}${wanneer ? `; werken ${wanneer}` : ""}`
    : `${kop}: ${gevolg.tekst}${wanneer ? ` ${wanneer}` : ""}`;

  const ontbreekt = [];
  if (!f.omschrijving) ontbreekt.push(NIET_GEPUBLICEERD);
  if (!nummers && !eenAdres && !losNummerWeg) ontbreekt.push("huisnummers niet gepubliceerd");
  if (f.hinderBekend === false) ontbreekt.push("gevolgen voor het verkeer niet gepubliceerd");
  if (f.hinderBekend === null) ontbreekt.push("gevolgen voor het verkeer nu niet opgehaald");
  if (!eind) ontbreekt.push("einddatum niet gepubliceerd");

  // Eerst één zin in gewone taal; de tekst van de beheerder staat apart (bronTekst, ingeklapt).
  const bronTekst = beheerderTekst(f.omschrijving, { zonderNummers: eenAdres, straten: f.straten });
  // Het werk of project in de woorden van de beheerder ("R1 - Ringpark Zuid") staat zichtbaar bij "Wat",
  // tenzij het alleen de soort herhaalt ("Riolering" bij "Rioleringswerken").
  const projectRuw = f.soort && bronTekst ? projectTekst(bronTekst, { straten: f.straten }) : "";
  const project = projectRuw && !sleutel(f.soort).includes(sleutel(projectRuw)) ? projectRuw : "";
  const inname = (f.inname || []).length > 1 ? ` Volgens GIPOD: ${f.inname.join(" · ")}.` : "";
  const regels = [];
  regels.push(["Wat", f.soort
    ? `${f.soort}, afgeleid uit de ${f.soortBron}.${project ? ` Volgens de beheerder: “${project}”.` : ""}${inname}${f.omschrijving ? "" : " De beheerder publiceerde zelf geen omschrijving."}`
    : bronTekst ? `De beheerder schrijft: “${bronTekst}”`
    : f.omschrijving ? "Niet bekend: de beheerder gaf alleen een adres op." : `Niet bekend: ${NIET_GEPUBLICEERD}.`]);
  // Bij één adres ook geen huisnummer in de naam van een fase (ook niet uit een oudere verversing).
  const fasen = f.fasen.map((x) => ({ ...x, naam: eenAdres ? zonderHuisnummers(x.naam, 160) : x.naam })).filter((x) => x.naam);
  if (fasen.length) regels.push(["Fasen", fasen.map((x) => `${x.naam}${x.buiten || faseBuitenDistrict(x.naam) ? " (buiten district Antwerpen)" : ""}${x.start || x.eind ? ` (${periodeTekst(x.start, x.eind, v)})` : ""}${x.gevolgen?.length ? `: ${x.gevolgen.join(", ")}` : ""}`).join(" · ")]);
  regels.push(["Opdrachtgever", f.opdrachtgever || "niet gepubliceerd"]);
  // Een straat uit de omschrijving van de beheerder: zeg dat, en hoe ver het punt in GIPOD ervan ligt.
  const uitTekst = straat && f.straatBron ? [
    nummers && f.huisnummerBron === f.straatBron ? `straat en ${/–/.test(nummers) ? "huisnummers" : "huisnummer"} uit de ${f.straatBron}` : `straat uit de ${f.straatBron}`,
    (f.straatAfstand || 0) <= 10 ? "het punt in GIPOD ligt er vlakbij" : `het punt in GIPOD ligt er ongeveer ${f.straatAfstand} m van`,
  ] : [];
  const nummerBron = nummers && f.huisnummerBron && !(f.straatBron && f.huisnummerBron === f.straatBron) ? [f.huisnummerBron] : [];
  const haakjes = (lijst) => (lijst.length ? ` (${lijst.join("; ")})` : "");
  regels.push(["Waar", straat
    ? nummers ? `${straat}, ${nummers}${haakjes([...nummerBron, ...uitTekst])}`
      : `${f.straten.join(", ")}${haakjes([eenAdres ? "huisnummer weggelaten: het gaat om één adres" : losNummerWeg ? "huisnummer weggelaten: één adres kan een woning zijn" : "huisnummers niet gepubliceerd", ...uitTekst])}`
    : nabij?.kruispunt ? `Bij het kruispunt van ${joinNl(nabij.straten)} (berekend uit het punt in GIPOD)`
    : nabij?.tussen ? `Tussen ${nabij.straten.map((n, i) => `${n} (ongeveer ${nabij.afstanden?.[i] ?? "?"} m)`).join(" en ")}; berekend uit het punt in GIPOD, de twee straten raken elkaar daar niet`
    : nabij ? nabij.afstand <= 35 ? `Nabij ${nabij.straten[0]} (ongeveer ${nabij.afstand} m; berekend uit het punt in GIPOD)` : `Niet langs een straat met naam; de dichtste straat is ${nabij.straten[0]} (ongeveer ${nabij.afstand} m)`
    : f.straatGezocht ? "Alleen als punt op de kaart van GIPOD; geen straat met naam binnen 150 m van dat punt"
    : "Alleen als punt op de kaart van GIPOD; de straat kon nu niet bepaald worden"]);
  const ov = openbaarVervoer([...f.gevolgen, ...fasen.map((x) => x.naam), f.omschrijving]);
  const deelsBuiten = f.titelGevolgen ? " · deels in een fase buiten district Antwerpen (zie Fasen)" : "";
  if (f.gevolgen.length) regels.push(["Gevolgen", `${uniek(f.gevolgen).join(" · ")}${f.hinderStart || f.hinderEind ? ` (${periodeTekst(f.hinderStart, f.hinderEind, v)})` : ""}${f.ernstig ? " · ernstige hinder volgens GIPOD" : ""}${deelsBuiten}`]);
  else regels.push(["Gevolgen", f.hinderBekend === null ? "nu niet opgehaald" : "niet gepubliceerd in GIPOD"]);
  if (ov.length) regels.push(["Bus en tram", ov.join(" · ")]);
  // GIPOD meldt hinder na de einddatum van het werk: zeg het, want de titel noemt dan geen "werken tot".
  const hinderNa = eind && f.hinderEind && f.hinderEind > eind ? ` · GIPOD meldt nog hinder tot ${dt(f.hinderEind)}` : "";
  // En hinder vóór de start van het werk (die nog niet voorbij is): de titel zet dan "werken vanaf" erachter.
  const hinderVoor = start && f.hinderStart && f.hinderStart < start && (!f.hinderEind || f.hinderEind >= v)
    ? f.hinderEind && f.hinderEind < start ? ` · GIPOD meldt de hinder vóór de werkperiode (${vanTot(f.hinderStart, f.hinderEind, v)})` : ` · GIPOD meldt al hinder vanaf ${dt(f.hinderStart)}, vóór de start van het werk`
    : "";
  regels.push(["Duur", `${periodeTekst(start, eind, v) || "niet gepubliceerd"}${duur.tekst ? ` · ${duur.tekst}` : ""}${hinderVoor}${hinderNa}`]);
  // De datums zeggen "bezig", GIPOD zegt nog "concreet gepland": zeg allebei, niet alleen "nu bezig".
  const status = clean(werk.status, 60);
  if (duur.toestand === "bezig" && status && !/^in uitvoering$/i.test(status)) {
    regels.push(["Stand", `De geplande periode loopt${start ? ` sinds ${dt(start)}` : ""}, maar GIPOD meldt het werk nog als “${status.toLowerCase()}”, niet als “in uitvoering”.`]);
  }

  const samenvatting = [
    f.omschrijving ? "" : f.soort ? `${f.soort} (afgeleid uit GIPOD).` : "Omschrijving niet gepubliceerd door de beheerder.",
    project && project.length <= 80 ? `Volgens de beheerder: ${project}.` : "",
    f.opdrachtgever ? `Opdrachtgever: ${f.opdrachtgever}.` : "",
    titelGevolgen.length ? `${capital(uniek(titelGevolgen).map(gevolgKort).join(", "))}.` : "",
  ].filter(Boolean).join(" ");
  // De volledige tekst van de beheerder blijft ingeklapt na te lezen, tenzij "Wat" hem al helemaal toont.
  return { titel, samenvatting, regels, ontbreekt, duur, plek, bronTekst: f.soort && bronTekst !== project ? bronTekst : "" };
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

// "Grote Markt" is een plein, geen markt: alleen woorden die echt een markt noemen tellen.
// "Doop" eerst: een doopstoet of doopwandeling is in de eerste plaats een studentendoop.
const SOORTEN_EVENEMENT = [
  [/doop/i, "Studentendoop"],
  [/\b\d+\s?(?:k|km)\b|loopwedstrijd|stratenloop|marathon|jogging|\brun\b|\bloop\b/i, "Loopwedstrijd"],
  [/wieler|koers|criterium|wielren/i, "Wielerwedstrijd"],
  [/fietstocht|fietstoer|fietsrit/i, "Fietstocht"],
  [/stoet|optocht|parade|processie|carnaval/i, "Stoet"],
  [/wandel/i, "Wandeling"],
  // Niet het losse woord "markt": dat is ook een plein (Grote Markt, Veemarkt, Vrijdagmarkt).
  [/braderie|rommelmarkt|vlooienmarkt|kerstmarkt|jaarmarkt|boekenmarkt|ambachtenmarkt|boerenmarkt|verplaatsbare markt|wekelijkse markt|marktkra(?:am|men)/i, "Markt"],
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
  // Per soort en per straat de dagen (alle fasen samen): "jouw straat krijgt een parkeerverbod van
  // vrijdag 9 tot zondag 11 oktober". A-Sign publiceert alleen dagen, geen uren.
  const perSoortDagen = { parcours: {}, parkeerverbod: {}, verkeersvrij: {}, omleiding: {}, inname: {} };
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
    const soortInname = innameSoort(type), rs = dagVan(r.start), re = dagVan(r.end) || rs;
    for (const s of r.streets || []) {
      if (!s?.name) continue;
      const naam = clean(s.name, 120);
      perSoort[soortInname].add(naam);
      if (!rs) continue;
      const p = perSoortDagen[soortInname][naam] || { start: rs, eind: re };
      if (rs < p.start) p.start = rs;
      if (re > p.eind) p.eind = re;
      perSoortDagen[soortInname][naam] = p;
    }
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
    perSoortDagen,
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
// joinNl staat bovenaan (ook voor de werken).
const zin = (t) => { const s = clean(t, 800); return s ? `${capital(s)}${/[.!?]$/.test(s) ? "" : "."}` : ""; };
const hostVan = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
const KALENDER = /wat-beleef-je-in-district-antwerpen/i;
export const ZEKERHEDEN = Object.freeze(["zeker", "waarschijnlijk", "onbekend"]);
// Waarop een automatische fiche steunt (lib/parcours-herkenning.mjs, veld `methode`).
export const AUTO_HERKOMST = Object.freeze({
  kalender: "een agenda met dezelfde dag en plek",
  gipod: "GIPOD (zelfde dag, het evenementvlak overlapt het parcours)",
  organisator: "de agenda van de organisator (zelfde dag en plek)",
  patroon: "dezelfde route als een vorige keer",
  regels: "de omschrijving in het dossier, wat vroeger op dezelfde plek gebeurde en het studentencharter",
});

// Wat jouw straat met dit evenement te maken heeft, met de dagen van een parkeerverbod of een
// verkeersvrije zone in jouw straat (ook tijdens opbouw en afbraak). f.parcoursRelatie: "op",
// "kruist", "naast", "kruist-of-naast" of null (zie parcoursRelatieVoorStraat in place-core.js).
// f.langs: straten waar het parcours echt langs loopt (berekend in de verversing), of null als dat
// niet bekend is. Waarvoor een gewone inname dient, zegt de stad niet: dan zeggen we dat ook, zonder
// te gokken.
export function jouwStraat(f, straat, vandaag = "") {
  const naam = clean(straat, 120).toLowerCase();
  if (!naam) return "";
  const heeft = (list) => (list || []).some((s) => clean(s, 120).toLowerCase() === naam);
  const wanneer = (soort) => {
    const d = Object.entries(f.perSoortDagen?.[soort] || {}).find(([s]) => clean(s, 120).toLowerCase() === naam)?.[1];
    const t = d?.start ? dagenTekst(d.start, d.eind, vandaag) : "";
    return !t ? "" : t.startsWith("van ") ? ` ${t}` : ` op ${t}`;
  };
  const ps = f.perSoort || {};
  const delen = [];
  if (heeft(ps.verkeersvrij)) delen.push(`wordt verkeersvrij${wanneer("verkeersvrij")}`);
  if (heeft(ps.parkeerverbod)) delen.push(`krijgt een parkeerverbod${wanneer("parkeerverbod")}`);
  // f.parcoursRelatie (place-core.js, uit site/parcours-straten.js) zegt het precies voor de gekozen
  // straat; zonder die waarde beslist f.langs.
  const rel = f.parcoursRelatie ?? (Array.isArray(f.langs) ? (heeft(f.langs) ? "op" : "kruist-of-naast") : null);
  if (rel === "op") delen.push("ligt op het parcours");
  else if (rel === "kruist") delen.push("kruist het parcours of komt erop uit");
  else if (heeft(ps.parcours)) delen.push(rel === "naast" ? "ligt vlak naast het parcours" : rel === "kruist-of-naast" ? "kruist het parcours of ligt er vlak naast" : "ligt op of naast het parcours");
  if (heeft(ps.omleiding)) delen.push("ligt op de omleiding");
  if (!delen.length && heeft(ps.inname)) delen.push(`wordt gebruikt voor dit evenement${wanneer("inname")}; waarvoor precies, zegt de stad niet`);
  if (!delen.length && heeft(f.straten)) delen.push("staat in het dossier van dit evenement; waarvoor, zegt de stad niet");
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
    // Een koppeling op dag en straat blijft een vermoeden: zo staat het ook in de titel.
    titel = `Vermoedelijk: ${koppeling.titel}`;
    wat = `${titel}${koppeling.locatie ? ` (${koppeling.locatie})` : ""}. Gekoppeld aan agendapunt: dezelfde dag en dezelfde straat.`;
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
  const jouw = jouwStraat(f, straat, vandaag);

  // WAT MERK JE
  const ps = f.perSoort || {};
  const afgeleid = [
    ps.parkeerverbod?.length ? `parkeerverbod in ${stratenSamenvatting(ps.parkeerverbod, wijkVan)}` : "",
    ps.verkeersvrij?.length ? `verkeersvrij: ${stratenSamenvatting(ps.verkeersvrij, wijkVan)}` : "",
    ps.omleiding?.length ? `omleiding via ${stratenSamenvatting(ps.omleiding, wijkVan)}` : "",
  ].filter(Boolean);
  // A-Sign geeft voor een parkeerverbod alleen dagen: de uren van het evenement gelden er niet voor.
  const merk = clean(id?.watMerkJe, 600) || (afgeleid.length
    ? `${zin(joinNl(afgeleid))}${ps.parkeerverbod?.length ? " De uren van het parkeerverbod staan niet in het dossier." : ""}${f.hinder === "True" ? " De stad verwacht hinder voor het verkeer." : ""}`
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
  // Bij een koppeling: de officiële pagina van het agendapunt én het agendapunt zelf.
  if (koppeling?.bronUrl) voegToe(koppeling.bronUrl, KALENDER.test(koppeling.bronUrl) ? "Districtskalender (meerdere activiteiten)" : "Officiële info over dit evenement");
  if (gekoppeld?.agendaId) voegToe(`/event/${gekoppeld.agendaId}/`, `Agendapunt: ${clean(gekoppeld.titel, 100)}`);

  // Details onder de kern. Opbouw en afbraak staan al bij "Wanneer", het aantal straten bij "Waar"
  // (de knop "Toon alle N straten"): niet nog eens herhalen. De uitleg bij die stratenlijst:
  const regels = [];
  const stratenNoot = f.straten.length > 3 ? `${f.parcours ? "Straten langs het parcours" : "Straten in het dossier"}, berekend uit de kaart van de stad. Ze zijn niet allemaal tegelijk dicht.` : "";

  // Eén korte bronregel in gewone taal, zonder codes.
  const dossier = f.dossier ? ` (dossier ${f.dossier})` : "";
  const bronnen = uniek((id?.bron || []).map(hostVan).filter((h) => h && !/geodata\.antwerpen\.be/.test(h)));
  const nagekeken = `${bronnen.length ? ` op ${joinNl(bronnen)}` : ""}${id?.bijgewerkt ? ` (${datumTekst(id.bijgewerkt, { jaar: true })})` : ""}`;
  // Een automatische fiche (site/sources/evenement-identiteit-auto.json, met `methode`) zegt eerlijk
  // dat niemand ze met de hand nakeek, en waarop ze steunt.
  const herkomst = AUTO_HERKOMST[clean(id?.methode, 20)] || "";
  const voetnoot = bekend?.zekerheid === "zeker" && herkomst
    ? `De stad gaf toelating voor dit evenement${dossier}. De naam is automatisch gevonden in ${herkomst}${bronnen.length ? ` (${joinNl(bronnen)})` : ""}; niet met de hand nagekeken.`
    : bekend && herkomst
      ? `De stad gaf toelating voor dit evenement${dossier}, zonder naam. Het vermoeden is automatisch afgeleid uit ${herkomst}; niet met de hand nagekeken.`
    : bekend?.zekerheid === "zeker"
    ? `De stad gaf toelating voor dit evenement${dossier}. Wat het is, hebben we nagekeken${nagekeken}.`
    : bekend
      ? `De stad gaf toelating voor dit evenement${dossier}, zonder naam. Het vermoeden steunt op het dossier en op wat we nagekeken hebben${nagekeken}.`
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
    titel, samenvatting, kern, regels, links, voetnoot, ontbreekt, duur, plek: straten, technisch: "", stratenNoot,
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
// De schets van een heel parcours: alle lijnen, sterker vereenvoudigd in plaats van afgekapt, zodat
// "jouw straat ligt op het parcours" en de schets elkaar niet tegenspreken. Elke lijn krijgt punten
// naar haar lengte, binnen maxPunten samen. Alleen als er meer lijnen zijn dan het budget toelaat,
// vallen de kortste weg en zegt `deel` dat de schets maar een deel toont.
export const SCHETS_MAX_PUNTEN = 300;
const lijnLengte = (l) => l.reduce((m, p, i) => (i ? m + Math.hypot(p[0] - l[i - 1][0], p[1] - l[i - 1][1]) : 0), 0);
export function routeSchets(lijnen = [], { maxPunten = SCHETS_MAX_PUNTEN } = {}) {
  const gezien = new Set(), alle = [];
  for (const l of lijnen) {
    if (!Array.isArray(l) || l.length < 2 || !l.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))) continue;
    const k = JSON.stringify(l);
    if (!gezien.has(k)) { gezien.add(k); alle.push(l); }
  }
  const maxLijnen = Math.max(1, Math.floor(maxPunten / 2));
  const houd = alle.length > maxLijnen ? new Set([...alle].sort((a, b) => lijnLengte(b) - lijnLengte(a)).slice(0, maxLijnen)) : new Set(alle);
  const gekozen = alle.filter((l) => houd.has(l));
  const totaal = gekozen.reduce((n, l) => n + l.length, 0) || 1;
  const uit = gekozen.flatMap((l) => vereenvoudigLijnen([l], Math.max(2, Math.floor((l.length / totaal) * maxPunten))));
  return { lijnen: uit, deel: gekozen.length < alle.length };
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
