// Zonder imports: ook lib/live-history.mjs (de verversing) gebruikt dit.
// Een parkeerverbod is vaak een verhuis of een container voor één woning: het huisnummer is dan
// een privéadres. We houden de straat en de postcode, nooit het huisnummer. A-Sign schrijft
// "Stijfselrui 26-26 2000 Antwerpen", "Berkenlaan (2610) 34-hoek 2610 Antwerpen" of
// "Handelstraat hoek-64 2060 Antwerpen".
const HUISNUMMER=/^(?:\d+\s*[a-z]{0,3}|hoek|onbekend|hnr nvt|nvt)(?:\s*bus\s*\w+)?$/i;
export function adresZonderHuisnummer(adres){
  const tekst=String(adres??"").replace(/\s+/g," ").trim().slice(0,220);if(!tekst)return"";
  const m=tekst.match(/^(?:(.*?)[\s,]+)?(\d{4})\s+([^\d]+)$/);
  let straat=m?m[1]||"":tekst;
  straat=straat.replace(/\s*\(\d{4}\)/g,"");
  // Het langste slot "van-tot" (of één nummer) weg waarvan elk deel op een huisnummer lijkt.
  const nummer=(stuk)=>stuk.split(/\s*-\s*/).every((d)=>HUISNUMMER.test(d.trim()));
  for(let i=1;i<straat.length;i++){if(straat[i]===" "&&nummer(straat.slice(i+1))){straat=straat.slice(0,i);break}}
  // Wat er dan nog aan cijfers overblijft, is geen straatnaam: weg vanaf het eerste cijfer.
  straat=straat.replace(/\s+\S*\d.*$/,"").trim();
  if(nummer(straat)||/^\d/.test(straat))straat="";
  if(straat)straat=straat[0].toUpperCase()+straat.slice(1);
  if(!m)return straat;
  return straat?`${straat}, ${m[2]} ${m[3].trim()}`:`${m[2]} ${m[3].trim()}`;
}
