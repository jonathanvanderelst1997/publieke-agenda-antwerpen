// Alleen de pure regel van de straatnaam als import (site/witte-lijst.js, zelf zonder imports): ook lib/live-history.mjs
// (de verversing) gebruikt dit.
import{zonderToevoegingInTekst}from"./witte-lijst.js";
// Een parkeerverbod (A-Sign laag 20/21), besluit van de eigenaar van 18 oktober 2026: de site zegt DAT er een
// parkeerverbod is, WAAR exact en WANNEER (data en uren), en NOOIT waarom. Of iemand verhuist, een container of een
// lift zet, trouwt, filmt, een evenement of een werf heeft: dat staat nergens, niet in de titel, niet in een zin, niet
// in de technische details, de historiek, de straatbestanden, de feed, de eventpagina's of een .ics.
// - De plaats exact, overal (regel van de eigenaar van 26 oktober 2026, "al vijf keer gezegd"): de straat met het
//   huisnummer of het bereik zoals publiekParkeerAdres hieronder het schrijft ("Xstraat 12–14, 2000 Antwerpen"), live,
//   in de ochtendstand, de historiek en de straatbestanden (de publieke git-geschiedenis is uitdrukkelijk aanvaard). Ook
//   bij een verhuis: dat is gewoon een "Parkeerverbod" met zijn huisnummer, zonder het woord verhuis. Zonder nummer in
//   de bron de straat met de postcode (adresZonderHuisnummer). Op meer plaatsen elke plaats zo (parkeerWaar in
//   site/place-core.js). Wat bewaard wordt, houdt alleen een plaats in die vorm (parkeerAdresVoorOpslag): de straat met
//   een nummer van A-Sign, nooit een naam of vrije tekst.
// - De reden nooit: de titel is altijd PARKEERVERBOD_TITEL, en een bewaard of getoond parkeerverbod draagt geen veld
//   `reason` (parkeerverbodZonderReden). De reden van A-Sign mag intern nog meetellen voor de logica (een parkeerverbod
//   bij zijn werfzone of evenement hangen, site/place-core.js), zolang ze nergens getoond of bewaard wordt: de verversing
//   bewaart alleen het verband (werfzoneDossier, evenementSleutel hieronder).
// A-Sign schrijft "Xstraat 26-26 2000 Antwerpen", "Xlaan (2610) 34-hoek 2610 Antwerpen" of
// "Ystraat hoek-64 2060 Antwerpen" (verzonnen straten).
export const PARKEERVERBOD_TITEL="Parkeerverbod";
// Het woord dat een verhuis verraadt (verhuis, verhuizing, verhuislift, meubellift, inhuizing, uithuizing), ook met
// opmaaktekens, accenten, spaties of leestekens ertussen ("Ver-huis", "VERHUÍZING"). Een parkeerverbod voor een verhuis is
// gewoon een "Parkeerverbod" met zijn huisnummer (regel van de eigenaar van 26 oktober 2026): dit woord komt nergens bij
// een parkeerverbod, ook niet in wat bewaard wordt (historiekPrivacyBevindingen in lib/historiek-privacy.mjs, code `reden`).
export const noemtVerhuis=(tekst)=>/verhui[sz]|meubellift|(?:in|uit)huiz/i.test(String(tekst??"").normalize("NFKD").replace(/[\p{Cf}\p{M}]/gu,"").replace(/[\s._·'’/-]/gu,""));
// Bij welk evenement een parkeerverbod hoort (dat mag, besluit van 18 oktober 2026), zoals een straatbestand het bewaart
// (`evenementSleutel`, parkeerverbodenAanEvenement in site/place-core.js): een evenementendossier ("ET2099000001") of een
// agendapunt ("agenda:<id>"). Nooit vrije tekst, en dus nooit een reden. Het agendapunt alleen in de vorm van een echte
// agenda-id: kleine letters en cijfers met enkele streepjes, hoogstens 120 tekens (zoals lib/source-feed.mjs de id van een
// item in de feed eist), en op het einde de dag van dat punt, eventueel met een tweede dag en een korte hash of een uur:
// "asign-ev-et2026001217-2026-10-18", "district-kal-6a746a7ff4182b8edf63a779-2026-10-18", "markt-ma24-2026-10-18",
// "lambermontmartre-2026-06-28", "sportinitiaties-met-jespo-2026-07-01-2026-07-01-54018f" (site/agenda.js). Een slug
// zonder dag ("agenda:verhuis-proefstraat"), met hoofdletters, spaties, punten of liggende streepjes valt weg; een
// vergadering of een schoolstraat (geen dag in de id) is nooit het evenement van een parkeerverbod. Zonder /i: "ET"
// in hoofdletters, zoals A-Sign en kaart-uitleg.json het dossier schrijven (nakijkronde van 18 oktober 2026: na
// "agenda:" mocht elke slug, ook een met de reden).
const AGENDA_DAG="\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])";
export const EVENEMENT_SLEUTEL=new RegExp(`^(?:ET\\d{10}|agenda:(?=[a-z0-9-]{1,120}$)[a-z0-9]+(?:-[a-z0-9]+)*?-${AGENDA_DAG}(?:-${AGENDA_DAG})?(?:-[0-9a-f]{1,8})?)$`);
// Een parkeerverbod (een item, of de velden van een wijziging) zoals het getoond of bewaard mag worden: de titel
// "Parkeerverbod" (als er een titel is) en geen `reason`. De rest blijft zoals het was; geen kopie als er niets wijzigt.
export function parkeerverbodZonderReden(waarde){
  if(!waarde||typeof waarde!=="object"||Array.isArray(waarde))return waarde;
  const metTitel="title"in waarde&&waarde.title!==PARKEERVERBOD_TITEL;
  if(!metTitel&&!("reason"in waarde))return waarde;
  const{reason,...rest}=waarde;
  return metTitel?{...rest,title:PARKEERVERBOD_TITEL}:rest;
}
const HUISNUMMER=/^(?:\d+\s*[a-z]{0,3}|hoek|onbekend|hnr nvt|nvt)(?:\s*bus\s*\w+)?$/i;
const vouw=(t)=>String(t??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ").trim().toLowerCase();
// Officiële straatnamen met een cijfer ("4 septemberpad", "De 7 schakenpad", "Kanaaldok B1-Oostkaai"):
// die mag de cijferregel hieronder niet verminken. Eén keer voorbereid per lijst.
const voorbereid=new WeakMap();
function cijferStraten(straatnamen){
  if(!straatnamen||typeof straatnamen!=="object")return[];
  if(voorbereid.has(straatnamen))return voorbereid.get(straatnamen);
  const lijst=[...new Map([...straatnamen].map(String).filter((n)=>/\d/.test(n)).map((n)=>[vouw(n),n.trim()])).entries()]
    .sort((a,b)=>b[0].length-a[0].length);
  voorbereid.set(straatnamen,lijst);
  return lijst;
}
// Een nummerslot: één nummer, of nummers met een streepje, een schuine streep of "en" ertussen. Ook zoals
// publiekParkeerAdres het schrijft ("12–14", "12 en 14", "hoek–64"): zo houdt elke opslag ook een live plaats op de straat.
const nummer=(stuk)=>stuk.split(/\s*(?:[-–/]|\ben\b)\s*/i).every((d)=>HUISNUMMER.test(d.trim()));
// Het langste slot "van-tot" (of één nummer) op het einde weg waarvan elk deel op een huisnummer lijkt.
function zonderNummerslot(straat){
  for(let i=1;i<straat.length;i++){if(straat[i]===" "&&nummer(straat.slice(i+1)))return straat.slice(0,i)}
  return straat;
}
// Een laatste woord dat alleen een nummer is ("12/14", "12b", "3.5"), ook als het niet als huisnummer
// herkend werd. Een straatnaam met een cijfer ("De 7 schakenpad", "Kanaaldok B1") eindigt nooit zo.
const NUMMERWOORD=/\s+\d[\d/.,–-]*[a-z]{0,2}$/i;
function zonderNummerwoord(straat){
  let uit=straat.trim();
  while(NUMMERWOORD.test(uit))uit=uit.replace(NUMMERWOORD,"").trim();
  return uit;
}
// `straatnamen`: optioneel, de officiële straatnamen (bv. uit de stratenlijst van het district).
// Een publiek goedgekeurd parkeerverbod: waar exact, met het huisnummer of het bereik van de bron, live en in wat de
// verversing bewaart (regel van 26 oktober 2026; adresZonderHuisnummer maakt van elke vorm hieronder weer de straat).
// Geen naam, bus of onzekere bron erbij verzinnen.
// Vierde nakijkronde van 18 oktober 2026: alleen "Xstraat 12-14" (oplopend, hoogstens 300 uit elkaar) gaf een plaats; bij
// elke andere vorm viel het nummer van de bron weg. Nu zo exact als A-Sign het geeft (verzonnen straten):
//   "Xstraat 12" en "Xstraat 12-12"  -> "Xstraat 12, 2000 Antwerpen"
//   "Xstraat 12-14" en "Xstraat 14-12" -> "Xstraat 12–14, 2000 Antwerpen" (oplopend)
//   "Xstraat 12/14"                -> "Xstraat 12 en 14, 2000 Antwerpen" (elk nummer; drie: "12, 14 en 16")
//   "Xstraat hoek-64", "34-hoek"   -> "Xstraat hoek–64", "Xstraat 34–hoek" (de hoek met het nummer)
//   "Xstraat 12 bus 3"             -> "Xstraat 12" (nooit een bus: die is een woning, geen plaats op straat)
//   "Xstraat 1-400"                -> "Xstraat 1–400": een bereik over (bijna) de hele straat is wat de bron zegt.
//   "Xstraat 12-0"                 -> "Xstraat 12" (een 0 is geen nummer; "Xstraat 0-0" en "0-4" blijven zonder nummer)
// Geen nummer ("Onbekend-Onbekend", "nvt-nvt", "hoek-hoek") of iets anders dan nummers: "" (de kaart toont de straat).
const NR=/^([1-9]\d{0,3})([a-z]{0,2})$/i;
const nrVolgorde=(a,b)=>Number(NR.exec(a)[1])-Number(NR.exec(b)[1])||NR.exec(a)[2].toLowerCase().localeCompare(NR.exec(b)[2].toLowerCase());
function nummerVanBron(deel){
  const t=deel.replace(/\s*\(\d{4}\)\s*/g," ").replace(/\s+bus\s*[\w-]+$/i,"").replace(/\s+/g," ").trim();
  if(!t)return"";
  if(t.includes("/")){
    const lijst=[...new Map(t.split(/\s*\/\s*/).map((n)=>[n.toLowerCase(),n])).values()];
    if(!lijst.every((n)=>NR.test(n)))return"";
    lijst.sort(nrVolgorde);
    return lijst.length===1?lijst[0]:`${lijst.slice(0,-1).join(", ")} en ${lijst.at(-1)}`;
  }
  const d=t.split(/\s*[-–]\s*/);
  if(d.length===1)return NR.test(d[0])?d[0]:"";
  if(d.length!==2)return"";
  const[a,b]=d,hoekA=/^hoek$/i.test(a),hoekB=/^hoek$/i.test(b);
  // "12-0": A-Sign vult een ontbrekend tweede nummer met 0; het eerste is de plaats. "0-0" en "0-4" blijven zonder nummer
  // (een 0 vooraan is geen plaats).
  if(/^0+$/.test(b)&&NR.test(a))return a;
  if(hoekA&&NR.test(b))return`hoek–${b}`;
  if(hoekB&&NR.test(a))return`${a}–hoek`;
  if(!NR.test(a)||!NR.test(b))return"";
  if(a.toLowerCase()===b.toLowerCase())return a;
  const[van,tot]=[a,b].sort(nrVolgorde);
  return`${van}–${tot}`;
}
export function publiekParkeerAdres(bronAdres, geschoondAdres, straatnamen = null) {
  const raw = zonderToevoegingInTekst(String(bronAdres ?? "").replace(/\s+/g, " ").trim().slice(0, 220));
  const m = /^(.*?)\s+(\d{4})\s+Antwerpen$/i.exec(raw);
  if (!m || !geschoondAdres || adresZonderHuisnummer(raw, straatnamen) !== geschoondAdres) return "";
  // De straat zoals de geschoonde vorm ze schrijft; wat in de bron tussen de straat en de postcode staat, is het nummer.
  const g = /^(.+), (\d{4}) Antwerpen$/.exec(geschoondAdres);
  if (!g || g[2] !== m[2] || !m[1].toLowerCase().startsWith(g[1].toLowerCase())) return "";
  const rest = m[1].slice(g[1].length);
  if (!/^[\s(]/.test(rest)) return "";
  const nr = nummerVanBron(rest);
  return nr ? `${g[1]} ${nr}, ${m[2]} Antwerpen` : "";
}
// Het nummer zoals publiekParkeerAdres het schrijft, en niets anders: "12", "12b", "12–14", "hoek–64", "34–hoek",
// "12 en 14", "12, 14 en 16".
const NR_UIT = "[1-9]\\d{0,3}[a-z]{0,2}";
const PARKEER_NUMMER = new RegExp(`^(?:${NR_UIT}(?:–(?:${NR_UIT}|hoek))?|hoek–${NR_UIT}|${NR_UIT}(?:, ${NR_UIT})* en ${NR_UIT})$`, "i");
// Is dit een plaats zoals publiekParkeerAdres ze schrijft ("Xstraat 12–14, 2000 Antwerpen")? De straat is die van
// adresZonderHuisnummer (dezelfde regel als de opkuis), en wat tussen de straat en de postcode staat, is alleen een nummer
// in die vorm: nooit een naam, een bus, een reden of andere vrije tekst. Zo'n plaats mag bewaard worden (historiek,
// straatbestanden; regel van de eigenaar van 26 oktober 2026); elke andere vorm wordt de straat met de postcode.
export function isPubliekParkeerAdres(adres, straatnamen = null) {
  const tekst = String(adres ?? "");
  if (tekst.length > 220 || /\s{2}|^\s|\s$/.test(tekst)) return false;
  const m = /^(.+), (\d{4}) Antwerpen$/.exec(tekst);
  const s = m && /^(.+), (\d{4}) Antwerpen$/.exec(adresZonderHuisnummer(tekst, straatnamen));
  if (!s || s[2] !== m[2] || !m[1].startsWith(`${s[1]} `) || noemtVerhuis(tekst)) return false;
  return PARKEER_NUMMER.test(m[1].slice(s[1].length + 1));
}
// De plaats van een parkeerverbod zoals ze bewaard wordt (lib/parkeer-historiek.mjs, lib/historiek-privacy.mjs, de
// straatbestanden): exact als ze de vorm van publiekParkeerAdres heeft, anders de straat met de postcode.
export function parkeerAdresVoorOpslag(adres, straatnamen = null) {
  const tekst = String(adres ?? "").replace(/\s+/g, " ").trim();
  return isPubliekParkeerAdres(tekst, straatnamen) ? tekst : adresZonderHuisnummer(tekst, straatnamen);
}

// Dit is de ingang van het adres van A-Sign: ook de homoniemtoevoeging van de straatas gaat hier weg ("Proefstraat_AN 12
// 2018 Antwerpen" wordt "Proefstraat, 2018 Antwerpen"; site/witte-lijst.js).
export function adresZonderHuisnummer(adres,straatnamen=null){
  const tekst=zonderToevoegingInTekst(String(adres??"").replace(/\s+/g," ").trim().slice(0,220));if(!tekst)return"";
  const bekendeStraat=(straat)=>{const v=vouw(straat);return cijferStraten(straatnamen).find(([sleutel])=>v===sleutel||v.startsWith(`${sleutel} `))?.[1]||""};
  // Al eerder opgekuist ("Straat, 2000 Antwerpen"; A-Sign zelf schrijft nooit een komma): alleen nog
  // een huisnummer op het einde weg, zodat "De 7 schakenpad, 2000 Antwerpen" blijft staan.
  const al=tekst.match(/^([^,]+), (\d{4}) ([^\d,]+)$/);
  if(al){const straat=bekendeStraat(al[1])||zonderNummerwoord(zonderNummerslot(al[1]));if(straat&&!nummer(straat)&&!/^\d+$/.test(straat))return`${straat}, ${al[2]} ${al[3].trim()}`}
  const m=tekst.match(/^(?:(.*?)[\s,]+)?(\d{4})\s+([^\d]+)$/);
  let straat=m?m[1]||"":tekst;
  straat=straat.replace(/\s*\(\d{4}\)/g,"");
  const bekend=bekendeStraat(straat);
  if(bekend)straat=bekend;
  else{
    straat=zonderNummerslot(straat);
    // Wat er dan nog aan cijfers overblijft, is geen straatnaam: weg vanaf het eerste cijfer.
    straat=straat.replace(/\s+\S*\d.*$/,"").trim();
    if(nummer(straat)||/^\d/.test(straat))straat="";
  }
  if(straat)straat=straat[0].toUpperCase()+straat.slice(1);
  if(!m)return straat;
  return straat?`${straat}, ${m[2]} ${m[3].trim()}`:`${m[2]} ${m[3].trim()}`;
}
