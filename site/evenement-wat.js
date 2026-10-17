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
  // Over de jaarwissel krijgen beide dagen hun jaar: "van 17 april 2026 tot 30 april 2027", niet "van
  // 17 april tot 30 april 2027" (dat leest als twee weken in 2027).
  const anderJaar = p.eerste.slice(0, 4) !== p.laatste.slice(0, 4);
  const dt = (d) => datum(d, anderJaar ? "" : v);
  const bereik = (a, b) => {
    const zelfdeMaand = a.slice(0, 7) === b.slice(0, 7);
    const ja = dt(a), jb = dt(b);
    return zelfdeMaand && !/\d{4}$/.test(ja) ? `${Number(a.slice(8, 10))} tot ${jb}` : `${ja} tot ${jb}`;
  };
  if (p.aaneen) {
    if (p.aantal === 2) return `${dagMetNaam(p.eerste, anderJaar ? "" : v).replace(/ \S+( \d{4})?$/, p.eerste.slice(5, 7) === p.laatste.slice(5, 7) ? "" : "$&")} en ${dagMetNaam(p.laatste, anderJaar ? "" : v)}`;
    if (p.eerste.slice(5) === "01-01" && p.laatste.slice(5) === "12-31" && p.eerste.slice(0, 4) === p.laatste.slice(0, 4)) return `heel ${p.eerste.slice(0, 4)}`;
    // "De hele maand" alleen tot de echte laatste dag van die maand (1 tot 29 oktober is niet heel oktober).
    if (p.eerste.slice(8) === "01" && p.eerste.slice(0, 7) === p.laatste.slice(0, 7) && p.laatste === laatsteVanMaand(p.eerste)) return `de hele maand ${MAANDEN[Number(p.eerste.slice(5, 7)) - 1]} (${bereik(p.eerste, p.laatste)})`;
    return `van ${bereik(p.eerste, p.laatste)}`;
  }
  const volgende = p.volgende && p.volgende !== p.eerste && !p.vandaag ? `; de volgende is ${dagMetNaam(p.volgende, v)}` : "";
  if (p.ritme === "wekelijks") return `elke ${WEEKDAGEN[p.weekdag]} van ${bereik(p.eerste, p.laatste)}${volgende}`;
  if (p.ritme === "maandelijks") {
    const maand = (d) => `${MAANDEN[Number(d.slice(5, 7)) - 1]}${d.slice(0, 4) !== String(v).slice(0, 4) || anderJaar ? ` ${d.slice(0, 4)}` : ""}`;
    return `één ${WEEKDAGEN[p.weekdag]} per maand, van ${maand(p.eerste)} tot ${maand(p.laatste)}${volgende}`;
  }
  if (p.aantal <= 3) return `op ${joinNl([...new Set([p.eerste, ...(p.alle || []), p.laatste])].map((d) => dagMetNaam(d, anderJaar ? "" : v)))}`;
  return `op ${p.aantal} losse dagen tussen ${dt(p.eerste)} en ${dt(p.laatste)}${volgende}`;
}
// De laatste dag van de maand van d ("2026-10-31", "2028-02-29").
function laatsteVanMaand(d) {
  const j = Number(d.slice(0, 4)), m = Number(d.slice(5, 7));
  return new Date(Date.UTC(j, m, 0)).toISOString().slice(0, 10);
}
// Elke dag met deze weekdag (0-6) van a tot en met b (hoogstens 120): de marktdagen van een markt.
export function weekdagenTussen(a, b, wd) {
  if (!isDag(a) || !isDag(b) || !(wd >= 0 && wd <= 6)) return [];
  const uit = [];
  for (let d = plus(a, (wd - weekdag(a) + 7) % 7); d <= b && uit.length < 120; d = plus(d, 7)) uit.push(d);
  return uit;
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
// Een schip alleen met een woord dat een schip noemt (MTS, schip, vaartuig, tanker): "met de boot naar de
// overkant" na een studentendoop is geen scheepsdoop. Een boot telt alleen buiten de doopperiode (de
// herkenner kent die periode, zie stapRegels). Een foor ook als laatste deel van een woord ("najaarsfoor").
// Een vlaggenmast is geen vlag boven de straat (nagekeken op 11 oktober 2026: kerstbomen bij een vlaggenmast).
export const DINGEN = Object.freeze([
  { key: "schip", re: /\bdoop\w*\b[^|]*\b(?:m\.? ?t\.? ?s|\w*schip|schepen|vaartuig|tanker)\b|\b(?:m\.? ?t\.? ?s|\w*schip|vaartuig)\b[^|]*\bdoop/i, zonder: "doop van een schip", met: "de doop van een schip", evenement: true, zeker: false },
  { key: "kermis", re: /\bkermis(?!koers)\w*|\b(?!(?:sema|meta)foor\b)\w*foor(?:en)?\b|\bfoorkra\w*|\bfoorterrein\w*|lunapark/i, zonder: "kermis", met: "een kermis", evenement: true, zeker: true },
  { key: "reuzenrad", re: /reuzenrad/i, zonder: "reuzenrad", met: "een reuzenrad", evenement: true, zeker: true },
  { key: "versiering", re: /\bvlag(?:gen)?(?:lijn(?:en)?)?\b|reuzenboek\w*|straatversiering|feestverlichting|kerstverlichting|\bkerstbo(?:om|men)\b/i, zonder: "straatversiering", met: "straatversiering", evenement: false, zeker: true },
  { key: "sticker", re: /sticker/i, zonder: "stickers op straat", met: "stickers op straat", evenement: false, zeker: true },
  { key: "bladslag", re: /bladslag|bladhub|bladkorf/i, zonder: "verzamelplek voor herfstbladeren (bladslag)", met: "een verzamelplek voor herfstbladeren (bladslag)", evenement: false, zeker: true },
  { key: "mammobiel", re: /mammobiel/i, zonder: "mammobiel (borstkankeronderzoek)", met: "de mammobiel (borstkankeronderzoek)", evenement: false, zeker: true },
  { key: "bord", re: /breugelbak|aankondigingsbord|informatiebord|sandwichbord/i, zonder: "aankondigingsbord", met: "een aankondigingsbord", evenement: false, zeker: false },
  { key: "oldtimer", re: /oldtimer/i, zonder: "plek voor oldtimers", met: "een plek voor oldtimers", evenement: true, zeker: true },
]);
const DING = Object.fromEntries(DINGEN.map((d) => [d.key, d]));
export const dingVan = (key) => DING[key] || null;

// Een dossier waarvan een fase "Opname" heet (A-Sign: "Opname periode 1", "Opname periode 2" ...) is een
// opname voor een film, een serie of foto's: een vaste fasenaam, geen vrije tekst. Geen evenement met
// publiek, en een woord in de omschrijving ("Wandelroute") zegt dan niet wat het is.
export const OPNAME = Object.freeze({ key: "opname", zonder: "film- of foto-opname", met: "een film- of foto-opname", evenement: false, zeker: true });
export const isOpnameFase = (naam) => /^opname\b/i.test(clean(naam, 60).replace(/^Fase\s+/i, ""));

// "geen kermis", "zonder stickers": een ontkenning noemt het ding niet. Het ontkende woord valt weg.
export const zonderOntkenning = (t) => String(t ?? "").replace(/(^|[^\p{L}\d])(?:geen|zonder)\s+[\p{L}\d-]+/giu, "$1 ");
// Een omschrijving die alleen een plek noemt ("Lange Winkelstraat", "Ossenmarkt tem nr 12"): die zegt niet
// wat er gebeurt, en spreekt dus ook niet tegen wat een andere inname van hetzelfde dossier noemt.
const ALLEEN_STRAAT = /^[\p{L}' .-]*(?:straat|laan|lei|plein|plaats|weg|vest|dreef|kaai|hof|steeg|rui|markt|pad|park|berg|dijk|singel|brug|baan|velodroom)$/iu;
export const alleenStraat = (t) => ALLEEN_STRAAT.test(clean(String(t).replace(/[_\d,/]+|\b(?:tot|tem|t\.?e\.?m\.?|nr|en)\b/gi, " "), 200).replace(/[\s.-]+$/, ""));
// Een voorwerp van een evenement met publiek: een tent, een podium, een DJ, toiletten, een inschrijving.
// Staat dat in het dossier, dan is een bord of een vlag erbij niet "wat het is".
export const EVENEMENT_VOORWERP = /\b(?:\w*tent(?:je|jes|en)?|pagode\w*|podium\w*|dj|toilet\w*|inschrijv\w*|kra(?:am|men)|marktkra\w*|foodtruck\w*|springkasteel\w*|geluidsinstallatie\w*)\b/i;
// Gaat het hele dossier over dit ding? Elke omschrijving met inhoud noemt het (een ontkenning telt niet),
// of noemt alleen een plek. Eén inname met een bord tussen tenten en een DJ: nee.
export function gaatOver(key, teksten = []) {
  const d = DING[key];
  const lijst = teksten.map((x) => clean(zonderOntkenning(x), 400)).filter((x) => x && /[\p{L}]/u.test(x));
  return Boolean(d && lijst.length && lijst.some((x) => d.re.test(x)) && lijst.every((x) => d.re.test(x) || alleenStraat(x)));
}
// Opslag of materiaal ("opslag reuzenrad"): het ding staat er niet zelf, dus nooit zonder "vermoedelijk".
const OPSLAG = /\b(?:opslag\w*|stockage|stapel\w*|materiaal\w*|onderdel\w*|werfkeet|bouwkeet)\b/i;
// Welk ding is dit dossier, en mag de kaart het zonder "vermoedelijk" zeggen? Eén regel voor de kaart
// (site/kaart-uitleg.js) en de herkenner (lib/parcours-herkenning.mjs), zodat ze hetzelfde zeggen.
// - Het ding geldt als er geen andere soort in staat (`andereSoort`: een markt, een loop ...) en, bij iets dat
//   geen evenement is (een bord, een vlag), ook geen tent, podium of DJ.
// - Zonder "vermoedelijk" alleen als het hele dossier erover gaat, het woord het ding zelf noemt (zeker in
//   DINGEN) en er geen opslag of materiaal staat.
// `uitgesloten`: dingen die de herkenner al afwees (een schip in de doopperiode zonder scheepswoord).
export function dingKeuze(teksten = [], { andereSoort = false, uitgesloten = [] } = {}) {
  const tekst = teksten.map((x) => clean(zonderOntkenning(x), 400)).filter(Boolean).join(" | ");
  if (!tekst) return null;
  for (const d of DINGEN) {
    if (uitgesloten.includes(d.key) || !d.re.test(tekst)) continue;
    // Iets dat geen evenement is (een bord, vlaggen) naast een tent, een podium of een DJ: niet "wat het is".
    if (!d.evenement && EVENEMENT_VOORWERP.test(tekst)) continue;
    // Met een andere soort erbij ("kerstmarkt" en "kerstverlichting") gaat het dossier niet alleen over het ding.
    const over = !andereSoort && gaatOver(d.key, teksten);
    if (!over && andereSoort) continue;
    return { key: d.key, over, zeker: Boolean(d.zeker && over && !OPSLAG.test(tekst)) };
  }
  return null;
}
// Welke dingen staan in deze teksten (de omschrijvingen van één dossier)?
export function dingenIn(teksten = []) {
  const tekst = teksten.map((x) => clean(zonderOntkenning(x), 400)).filter(Boolean).join(" | ");
  return tekst ? DINGEN.filter((d) => d.re.test(tekst)).map((d) => d.key) : [];
}
// Straatversiering in detail: "straatversiering: vlaggen boven de straat en reuzenboeken".
export function versieringTekst(teksten = []) {
  const tekst = teksten.map((x) => clean(zonderOntkenning(x), 400)).join(" | ");
  const delen = [
    /\bvlag(?:gen)?(?:lijn(?:en)?)?\b/i.test(tekst) ? "vlaggen boven de straat" : "",
    /reuzenboek/i.test(tekst) ? "reuzenboeken" : "",
    /feestverlichting|kerstverlichting/i.test(tekst) ? "feestverlichting" : "",
    /\bkerstbo(?:om|men)\b/i.test(tekst) ? "kerstbomen" : "",
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
  // Een bord bij een evenement met tenten en een DJ is niet wat het dossier is (dingKeuze), wel iets dat er staat.
  [/breugelbak|aankondigingsbord|informatiebord|sandwichbord/i, "een aankondigingsbord"],
]);
export function voorwerpenIn(teksten = []) {
  const tekst = teksten.map((x) => clean(zonderOntkenning(x), 400)).join(" | ");
  return VOORWERPEN.filter(([re]) => re.test(tekst)).map(([, naam]) => naam);
}

// De vaste woorden die de soort, de dingen en de voorwerpen van een omschrijving bepalen, zonder de tekst zelf
// (site/kaart-uitleg.js, kenmerkTekst): voor elk patroon hierboven dat in de tekst staat één vast woord dat datzelfde
// patroon (en geen ander) raakt. Zo blijft de soort van een evenement bestaan, ook als de privacyfilter de omschrijving
// zelf weglaat (nakijkronde van head ba03ff4: "Doopfeest MTS ..." verloor de doop van een schip).
const DING_KENMERK = Object.freeze({
  schip: "doop schip", kermis: "kermis", reuzenrad: "reuzenrad", versiering: "straatversiering", sticker: "sticker", bladslag: "bladslag",
  mammobiel: "mammobiel", bord: "aankondigingsbord", oldtimer: "oldtimer",
});
const VERSIERING_KENMERK = Object.freeze([
  [/\bvlag(?:gen)?(?:lijn(?:en)?)?\b/i, "vlaggen"], [/reuzenboek/i, "reuzenboek"], [/feestverlichting|kerstverlichting/i, "feestverlichting"],
  [/\bkerstbo(?:om|men)\b/i, "kerstboom"],
]);
// Een voorwerp met een woord dat EVENEMENT_VOORWERP niet raakt (dat krijgt een eigen teken: "dj"), behalve waar dat niet
// kan (tent, pagode, kramen: elk woord voor VOORWERPEN raakt dan ook EVENEMENT_VOORWERP).
const VOORWERP_KENMERK = Object.freeze({
  "een tent": "tent", "een podium": "buitenpodium", kramen: "kramen", "een wand": "wand", "een generator": "generator",
  "een foodtruck": "food truck", toiletten: "dixitoilet", "een container": "container", "een aankondigingsbord": "aankondigingsbord",
});
export function kenmerkWoorden(tekst) {
  const t = clean(zonderOntkenning(tekst), 400);
  if (!t) return [];
  return [
    ...DINGEN.filter((d) => d.re.test(t)).map((d) => DING_KENMERK[d.key]),
    ...VERSIERING_KENMERK.filter(([re]) => re.test(t)).map(([, w]) => w),
    ...VOORWERPEN.filter(([re]) => re.test(t)).map(([, naam]) => VOORWERP_KENMERK[naam]),
    ...(EVENEMENT_VOORWERP.test(t) ? ["dj"] : []),
    ...(OPSLAG.test(t) ? ["opslag"] : []),
  ].filter(Boolean);
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
// De naam van een wijk zonder lidwoord, zoals op de kaart: "Nieuw Zuid", "Theaterbuurt en Meir".
const WIJK_NAAM = new Map([["Nieuw-zuid", "Nieuw Zuid"], ["Petroleum-zuid", "Petroleum Zuid"], ["Amandus & Atheneum", "Amandus-Atheneum"], ["Theaterbuurt & Meir", "Theaterbuurt en Meir"], ["Centraal station", "Centraal Station"]]);
export const wijkNaam = (naam) => WIJK_NAAM.get(clean(naam, 80)) || clean(naam, 80).replace(/ & /g, " en ");
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
