// Zonder imports: ook lib/live-history.mjs (de verversing) gebruikt dit.
// Een parkeerverbod is vaak een verhuis of een container voor één woning: het huisnummer is dan
// een privéadres. We houden de straat en de postcode, nooit het huisnummer. A-Sign schrijft
// "Stijfselrui 26-26 2000 Antwerpen", "Berkenlaan (2610) 34-hoek 2610 Antwerpen" of
// "Handelstraat hoek-64 2060 Antwerpen".
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
export function adresZonderHuisnummer(adres,straatnamen=null){
  const tekst=String(adres??"").replace(/\s+/g," ").trim().slice(0,220);if(!tekst)return"";
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
