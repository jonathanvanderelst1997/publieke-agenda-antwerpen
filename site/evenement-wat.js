// Wat een evenementendossier van de stad (A-Sign) is, en wanneer het echt op straat staat, in gewone
// taal. Gedeeld door de kaart (site/kaart-uitleg.js, site/place-core.js) en de herkenner
// (lib/parcours-herkenning.mjs), zodat de lijst, de kaart en de fiche hetzelfde zeggen.
//
// Puur: geen klok (vandaag komt van buiten), geen netwerk. Vrije tekst uit het dossier verlaat deze
// module nooit: een soort of een voorwerp komt alleen uit de vaste woorden hieronder.

const clean = (v, max = 300) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const isDag = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const t = (d) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
const tussen = (a, b) => Math.round((t(b) - t(a)) / 86_400_000);
const plus = (d, n) => new Date(t(d) + n * 86_400_000).toISOString().slice(0, 10);
const MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const WEEKDAGEN = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
const weekdag = (d) => new Date(t(d)).getUTCDay();
const joinNl = (list) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} en ${list.at(-1)}` : list[0] || "");
// "12 oktober", met jaartal als de dag niet in het jaar van vandaag valt (of zonder vandaag).
const datum = (d, vandaag = "") => `${Number(d.slice(8, 10))} ${MAANDEN[Number(d.slice(5, 7)) - 1]}${!vandaag || d.slice(0, 4) !== String(vandaag).slice(0, 4) ? ` ${d.slice(0, 4)}` : ""}`;
const dagMetNaam = (d, vandaag = "") => `${WEEKDAGEN[weekdag(d)]} ${datum(d, vandaag)}`;

// ---------- hoe lang ----------

// Vanaf zoveel dagen is een dossier "doorlopend": geen badge "Vandaag", geen "Dag 11 van 29" en een eigen
// plek in de lijst, onder wat vandaag echt gebeurt. Een toelating van weken of een jaar is geen evenement
// dat vandaag plaatsvindt (klacht van 10 oktober 2026: een maand, twee maanden, een jaar met "Vandaag").
export const LANG_DAGEN = 14;
// Tot zoveel dagen is het een kort evenement (een koers, een stoet, een weekend).
export const KORT_DAGEN = 3;
export function duurDagen(start, eind) {
  if (!isDag(start)) return 0;
  return isDag(eind) && eind > start ? tussen(start, eind) + 1 : 1;
}
// "kort" (1 tot 3 dagen), "meerdaags" (4 tot 13) of "lang" (14 of meer).
export function duurKlasse(start, eind) {
  const n = duurDagen(start, eind);
  if (!n) return "";
  return n <= KORT_DAGEN ? "kort" : n < LANG_DAGEN ? "meerdaags" : "lang";
}

// ---------- welke dagen echt ----------

// De dagen waarop er echt iets op straat staat: de dagen van de innames in de fase Evenement (zonder die
// fase: alle innames). Een dossier met losse dagen (een maandag per maand, vier woensdagen) is zo geen
// periode van maanden. rows: [{ phase|fase, start, end|eind }]. Hoogstens `max` dagen.
export function echteDagen(rows = [], { max = 400 } = {}) {
  const dag = (v) => { const s = clean(v, 40).slice(0, 10); return isDag(s) ? s : ""; };
  const fase = (r) => clean(r?.phase ?? r?.fase, 40).replace(/^Fase\s+/i, "");
  const metFase = rows.filter((r) => fase(r) === "Evenement");
  const uit = new Set();
  for (const r of metFase.length ? metFase : rows) {
    const s = dag(r?.start), e = dag(r?.end ?? r?.eind) || s;
    if (!s) continue;
    for (let d = s; d <= e && uit.size < max; d = plus(d, 1)) uit.add(d);
  }
  return [...uit].sort();
}
// Het ritme van die dagen. { aantal, eerste, laatste, aaneen, losse, ritme ("" | "wekelijks" |
// "maandelijks"), weekdag (0-6 of -1), volgende (de eerste dag vanaf vandaag, of "") }.
export function dagPatroon(dagen = [], vandaag = "") {
  const ds = [...new Set(dagen.filter(isDag))].sort();
  if (!ds.length) return null;
  const eerste = ds[0], laatste = ds.at(-1);
  const aaneen = tussen(eerste, laatste) + 1 === ds.length;
  const wd = ds.every((d) => weekdag(d) === weekdag(eerste)) ? weekdag(eerste) : -1;
  const gaten = ds.slice(1).map((d, i) => tussen(ds[i], d));
  let ritme = "";
  if (!aaneen && ds.length >= 3 && wd >= 0) {
    if (gaten.every((g) => g === 7)) ritme = "wekelijks";
    else if (new Set(ds.map((d) => d.slice(0, 7))).size === ds.length && gaten.every((g) => g >= 21 && g <= 63)) ritme = "maandelijks";
  }
  return {
    aantal: ds.length, eerste, laatste, aaneen, losse: !aaneen, ritme, weekdag: wd,
    volgende: isDag(vandaag) ? ds.find((d) => d >= vandaag) || "" : "",
    vandaag: isDag(vandaag) && ds.includes(vandaag),
  };
}
// In gewone taal, zonder hoofdletter: "zaterdag 10 oktober", "van 1 tot 29 oktober", "elke woensdag van
// 7 tot 28 oktober", "één maandag per maand, van november 2026 tot juni 2027", "op 4 losse dagen tussen
// 14 oktober en 23 december". Met `volgende`: "; de volgende is maandag 9 november".
export function patroonTekst(p, vandaag = "") {
  if (!p) return "";
  const v = vandaag || p.eerste;
  if (p.aantal === 1) return dagMetNaam(p.eerste, v);
  const bereik = (a, b) => {
    const zelfdeMaand = a.slice(0, 7) === b.slice(0, 7);
    const ja = datum(a, v), jb = datum(b, v);
    return zelfdeMaand && !/\d{4}$/.test(ja) ? `${Number(a.slice(8, 10))} tot ${jb}` : `${ja} tot ${jb}`;
  };
  if (p.aaneen) {
    if (p.aantal === 2) return `${dagMetNaam(p.eerste, v).replace(/ \S+( \d{4})?$/, p.eerste.slice(5, 7) === p.laatste.slice(5, 7) ? "" : "$&")} en ${dagMetNaam(p.laatste, v)}`;
    if (p.eerste.slice(5) === "01-01" && p.laatste.slice(5) === "12-31" && p.eerste.slice(0, 4) === p.laatste.slice(0, 4)) return `heel ${p.eerste.slice(0, 4)}`;
    if (p.eerste.slice(8) === "01" && p.eerste.slice(0, 7) === p.laatste.slice(0, 7) && Number(p.laatste.slice(8)) >= 28) return `de hele maand ${MAANDEN[Number(p.eerste.slice(5, 7)) - 1]} (${bereik(p.eerste, p.laatste)})`;
    return `van ${bereik(p.eerste, p.laatste)}`;
  }
  const volgende = p.volgende && p.volgende !== p.eerste && !p.vandaag ? `; de volgende is ${dagMetNaam(p.volgende, v)}` : "";
  if (p.ritme === "wekelijks") return `elke ${WEEKDAGEN[p.weekdag]} van ${bereik(p.eerste, p.laatste)}${volgende}`;
  if (p.ritme === "maandelijks") {
    const maand = (d) => `${MAANDEN[Number(d.slice(5, 7)) - 1]}${d.slice(0, 4) !== String(v).slice(0, 4) || p.eerste.slice(0, 4) !== p.laatste.slice(0, 4) ? ` ${d.slice(0, 4)}` : ""}`;
    return `één ${WEEKDAGEN[p.weekdag]} per maand, van ${maand(p.eerste)} tot ${maand(p.laatste)}${volgende}`;
  }
  if (p.aantal <= 3) return `op ${joinNl([...new Set([p.eerste, ...(p.alle || []), p.laatste])].map((d) => dagMetNaam(d, v)))}`;
  return `op ${p.aantal} losse dagen tussen ${datum(p.eerste, v)} en ${datum(p.laatste, v)}${volgende}`;
}
// Patroon met de dagen erbij (voor patroonTekst bij twee of drie losse dagen).
export function patroonVan(dagen = [], vandaag = "") {
  const p = dagPatroon(dagen, vandaag);
  return p ? { ...p, alle: [...new Set(dagen.filter(isDag))].sort() } : null;
}

// ---------- wat het dossier zelf noemt ----------

// Dingen die het dossier zelf noemt en die meteen zeggen wat er staat. Elk woord komt uit deze lijst,
// nooit uit de vrije tekst. `evenement: false`: het is geen evenement met publiek (een verzamelplek voor
// herfstbladeren, stickers, een bord). `zeker`: het woord noemt het ding zelf; dan zegt de kaart het zonder
// "vermoedelijk" (een doopfeest met een scheepsnaam blijft een vermoeden: er staat geen schip).
// De volgorde telt: de doop van een schip vóór de studentendoop (lib/parcours-herkenning.mjs, SOORTEN).
export const DINGEN = Object.freeze([
  { key: "schip", re: /\bdoop\w*\b[^|]*\b(?:m\.? ?t\.? ?s|schip|schepen|boot|vaartuig|tanker|binnenschip)\b|\b(?:mts|schip|boot|vaartuig)\b[^|]*\bdoop/i, zonder: "doop van een schip", met: "de doop van een schip", evenement: true, zeker: false },
  { key: "kermis", re: /\bkermis(?!koers)\w*|\bfoor\b|\bfoorkra\w*|\bfoorterrein\w*|lunapark/i, zonder: "kermis", met: "een kermis", evenement: true, zeker: true },
  { key: "reuzenrad", re: /reuzenrad/i, zonder: "reuzenrad", met: "een reuzenrad", evenement: true, zeker: true },
  { key: "versiering", re: /\bvlag(?:gen)?(?:lijn\w*|mast\w*)?\b|reuzenboek\w*|straatversiering|feestverlichting|kerstverlichting/i, zonder: "straatversiering", met: "straatversiering", evenement: false, zeker: true },
  { key: "sticker", re: /sticker/i, zonder: "stickers op straat", met: "stickers op straat", evenement: false, zeker: true },
  { key: "bladslag", re: /bladslag|bladhub|bladkorf/i, zonder: "verzamelplek voor herfstbladeren (bladslag)", met: "een verzamelplek voor herfstbladeren (bladslag)", evenement: false, zeker: true },
  { key: "mammobiel", re: /mammobiel/i, zonder: "mammobiel (borstkankeronderzoek)", met: "de mammobiel (borstkankeronderzoek)", evenement: false, zeker: true },
  { key: "bord", re: /breugelbak|aankondigingsbord|informatiebord/i, zonder: "aankondigingsbord", met: "een aankondigingsbord", evenement: false, zeker: false },
  { key: "oldtimer", re: /oldtimer/i, zonder: "plek voor oldtimers", met: "een plek voor oldtimers", evenement: true, zeker: true },
]);
const DING = Object.fromEntries(DINGEN.map((d) => [d.key, d]));
export const dingVan = (key) => DING[key] || null;
// Welke dingen staan in deze teksten (de omschrijvingen van één dossier)?
export function dingenIn(teksten = []) {
  const tekst = teksten.map((x) => clean(x, 400)).filter(Boolean).join(" | ");
  return tekst ? DINGEN.filter((d) => d.re.test(tekst)).map((d) => d.key) : [];
}
// Straatversiering in detail: "straatversiering: vlaggen boven de straat en reuzenboeken".
export function versieringTekst(teksten = []) {
  const tekst = teksten.map((x) => clean(x, 400)).join(" | ");
  const delen = [
    /\bvlag/i.test(tekst) ? "vlaggen boven de straat" : "",
    /reuzenboek/i.test(tekst) ? "reuzenboeken" : "",
    /feestverlichting|kerstverlichting/i.test(tekst) ? "feestverlichting" : "",
  ].filter(Boolean);
  return delen.length ? `straatversiering: ${joinNl(delen)}` : "straatversiering";
}

// Voorwerpen die een dossier noemt, als feit bij een dossier zonder soort ("met een tent en een wand").
const VOORWERPEN = Object.freeze([
  [/\b(?:a-? ?)?(?:party)?tent(?:je|en)?\b|\bpagode/i, "een tent"],
  [/podium/i, "een podium"],
  [/\bkra(?:am|men)\b|marktkra/i, "kramen"],
  [/steunmuur|\bwand\b/i, "een wand"],
  [/generator/i, "een generator"],
  [/foodtruck|food truck/i, "een foodtruck"],
  [/toilet/i, "toiletten"],
  [/container/i, "een container"],
]);
export function voorwerpenIn(teksten = []) {
  const tekst = teksten.map((x) => clean(x, 400)).join(" | ");
  return VOORWERPEN.filter(([re]) => re.test(tekst)).map(([, naam]) => naam);
}

// ---------- hoe groot ----------

// "ongeveer 80 m²", "ongeveer 1.300 m²", "ongeveer 10 ha".
export function oppervlakteTekst(m2) {
  const n = Number(m2);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 10_000) return `ongeveer ${(Math.round(n / 1000) / 10).toLocaleString("nl-BE")} ha`;
  if (n < 10) return "een paar m²";
  const r = n < 100 ? Math.round(n / 5) * 5 : n < 1000 ? Math.round(n / 10) * 10 : Math.round(n / 100) * 100;
  return `ongeveer ${r.toLocaleString("nl-BE")} m²`;
}
// Een kleine inname: hoogstens zoveel m² (een kraam, een tent, een stukje stoep).
export const KLEIN_M2 = 150;
// Een groot terrein: een hele parking of een park. Daar zegt een plek uit het studentencharter niets.
export const GROOT_TERREIN_M2 = 80_000;

// ---------- waar ----------

// Wijken van district Antwerpen met hun lidwoord: "de Universiteitsbuurt", "het Eilandje", "Zurenborg".
const WIJK_LIDWOORD = new Map([
  ["Eilandje", "het Eilandje"], ["Kiel", "het Kiel"], ["Zuid", "het Zuid"], ["Historisch centrum", "het Historisch centrum"],
  ["Stadspark", "de buurt van het Stadspark"], ["Centraal station", "de buurt van het Centraal Station"], ["Universiteitsbuurt", "de Universiteitsbuurt"],
  ["Tentoonstellingswijk", "de Tentoonstellingswijk"], ["Theaterbuurt & Meir", "de Theaterbuurt en de Meir"], ["Haven", "de haven"],
  ["Luchtbal", "de Luchtbal"], ["Dam", "de Dam"], ["Nieuw-zuid", "Nieuw Zuid"], ["Petroleum-zuid", "Petroleum Zuid"], ["Amandus & Atheneum", "Amandus-Atheneum"],
]);
// Wie zegt men "op": op het Eilandje, op het Kiel, op Linkeroever.
const WIJK_OP = new Set(["Eilandje", "Kiel", "Zuid", "Linkeroever", "Luchtbal", "Dam", "Nieuw-zuid", "Petroleum-zuid"]);
export const wijkMetLidwoord = (naam) => WIJK_LIDWOORD.get(clean(naam, 80)) || clean(naam, 80);
export function inWijk(naam) {
  const n = clean(naam, 80);
  return n ? `${WIJK_OP.has(n) ? "op" : "in"} ${wijkMetLidwoord(n)}` : "";
}
// "in de Universiteitsbuurt en het Historisch centrum" (hoogstens twee, dan "en omgeving").
export function inWijken(namen = []) {
  const lijst = [...new Set(namen.map((n) => clean(n, 80)).filter(Boolean))];
  if (lijst.length <= 1) return inWijk(lijst[0] || "");
  return `in ${joinNl(lijst.slice(0, 2).map(wijkMetLidwoord))}${lijst.length > 2 ? " en omgeving" : ""}`;
}
