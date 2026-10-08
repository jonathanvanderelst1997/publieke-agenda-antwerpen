// GIPOD-inname begint soms vroeger dan de markt opengaat.
// Verifieer normale bezoekersuren tegen de stadsmarktengids; de brondata verandert niet.
export const MARKTENGIDS="https://www.antwerpen.be/info/5c065842a67793326b260661/markten-in-district-antwerpen";
const weekday=d=>new Date(d+"T12:00:00Z").getUTCDay();
const lastSunday=(year,month)=>{
  const d=new Date(Date.UTC(year,month,0));
  return d.getUTCDate()-d.getUTCDay();
};
const isZomer=d=>{
 const y=Number(d.slice(0,4));
 const begin=String(y)+"-03-"+String(lastSunday(y,3)).padStart(2,"0");
 const eind=String(y)+"-10-"+String(lastSunday(y,10)).padStart(2,"0");
 return d>=begin&&d<eind;
};
export function publiekeMarktUur(item={}) {
  if(item.sourceId!=="stad-markten"||item.inDistrict!==true)return null;
  const day=String(item.date||"");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day+"T12:00:00Z")))return null;
  const wd=weekday(day),name=String(item.location||item.title||"").toLowerCase();
  let start="",end="";
  if(name.includes("falconplein")&&wd===0){start="09:00";end="16:00"}
  else if(name.includes("sint-jansvliet")&&wd===0){start="09:00";end="17:00"}
  else if(name.includes("oudevaartplaats")&&wd===6){start="08:00";end="16:00"}
  else if(name.includes("oudevaartplaats")&&wd===0){start="08:00";end=isZomer(day)?"14:00":"13:00"}
  else if(name.includes("desguinlei")&&wd===5){start="11:30";end="16:30"}
  else if(name.includes("sint-jansplein")&&(wd===3||wd===5)){start="08:00";end="13:00"}
  else if(name.includes("dageraadplaats")&&wd===4){start="08:00";end="13:00"}
  else if(name.includes("frederik van eedenplein")&&wd===4){start="08:00";end="13:00"}
  if(!start)return null;
  return Object.freeze({
    start,end,
    tekst:start.replace(":",".")+"–"+end.replace(":",".")+" uur",
    bron:MARKTENGIDS,
    status:"Normale bezoekersuren volgens stad Antwerpen; afwijkingen op feestdagen mogelijk."
  });
}
