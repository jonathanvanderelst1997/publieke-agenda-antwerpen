// Alleen de pure regel van de straatnaam als import (site/witte-lijst.js, zelf zonder imports): ook lib/live-history.mjs
// (de verversing) gebruikt dit.
import{zonderToevoegingInTekst}from"./witte-lijst.js";
// Een parkeerverbod (A-Sign laag 20/21), besluit van de eigenaar van 18 oktober 2026: de site zegt DAT er een
// parkeerverbod is, WAAR exact en WANNEER (data en uren), en NOOIT waarom. Of iemand verhuist, een container of een
// lift zet, trouwt, filmt, een evenement of een werf heeft: dat staat nergens, niet in de titel, niet in een zin, niet
// in de technische details, de historiek, de straatbestanden, de feed, de eventpagina's of een .ics.
// - De plaats exact: live (de browser vraagt A-Sign zelf) de straat met het huisnummer of het bereik zoals
//   publiekParkeerAdres hieronder het schrijft ("Xstraat 12–14, 2000 Antwerpen"), anders de straat met de postcode
//   (adresZonderHuisnummer). Wat de verversing bewaart (historiek, straatbestanden), houdt de straat en de postcode.
// - De reden nooit: de titel is altijd PARKEERVERBOD_TITEL, en een bewaard of getoond parkeerverbod draagt geen veld
//   `reason` (parkeerverbodZonderReden). In de browser mag de reden van A-Sign intern nog meetellen voor de logica
//   (een parkeerverbod bij zijn werfzone of evenement hangen, site/place-core.js), zolang ze nergens getoond wordt.
// A-Sign schrijft "Xstraat 26-26 2000 Antwerpen", "Xlaan (2610) 34-hoek 2610 Antwerpen" of
// "Ystraat hoek-64 2060 Antwerpen" (verzonnen straten).
export const PARKEERVERBOD_TITEL="Parkeerverbod";
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
const nummer=(stuk)=>stuk.split(/\s*-\s*/).every((d)=>HUISNUMMER.test(d.trim()));
// Het langste slot "van-tot" (of één nummer) op het einde weg waarvan elk deel op een huisnummer lijkt.
function zonderNummerslot(straat){
  for(let i=1;i<straat.length;i++){if(straat[i]===" "&&nummer(straat.slice(i+1)))return straat.slice(0,i)}
  return straat;
}
// Een laatste woord dat alleen een nummer is ("12/14", "12b", "3.5"), ook als het niet als huisnummer
// herkend werd. Een straatnaam met een cijfer ("De 7 schakenpad", "Kanaaldok B1") eindigt nooit zo.
const NUMMERWOORD=/\s+\d[\d/.,-]*[a-z]{0,2}$/i;
function zonderNummerwoord(straat){
  let uit=straat.trim();
  while(NUMMERWOORD.test(uit))uit=uit.replace(NUMMERWOORD,"").trim();
  return uit;
}
// `straatnamen`: optioneel, de officiële straatnamen (bv. uit de stratenlijst van het district).
// Een rechtstreeks opgevraagd, publiek goedgekeurd parkeerverbod: waar exact, met het huisnummer of het
// bereik van de bron. Dit adres wordt alleen live getoond; de historiek en de straatbestanden houden de
// straat en de postcode. Geen naam, bus, hoekwaarde of onzekere bron erbij verzinnen.
export function publiekParkeerAdres(bronAdres, geschoondAdres, straatnamen = null) {
  const raw = zonderToevoegingInTekst(String(bronAdres ?? "").replace(/\s+/g, " ").trim().slice(0, 220));
  const m = /^(.*?)\s+([1-9]\d{0,3}[a-z]{0,2})\s*[-–]\s*([1-9]\d{0,3}[a-z]{0,2})\s+(\d{4})\s+Antwerpen$/i.exec(raw);
  if (!m || adresZonderHuisnummer(raw, straatnamen) !== geschoondAdres) return "";
  const begin = Number(m[2].match(/^\d+/)[0]), eind = Number(m[3].match(/^\d+/)[0]);
  if (eind < begin || eind - begin > 300) return "";
  const bereik = m[2].toLowerCase() === m[3].toLowerCase() ? m[2] : `${m[2]}–${m[3]}`;
  const leesbaar = `${m[1]} ${bereik}, ${m[4]} Antwerpen`;
  // Het bronadres is hierboven al exact geschoond en geverifieerd. Een leesbare en-dash
  // (11–13) hoeft niet opnieuw door de ASCII-bronparser te gaan.
  return leesbaar;
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
