export const INZAGE = "https://omgevingsloketinzage.omgeving.vlaanderen.be/";
export const INZAGE_UITLEG = "https://www.vlaanderen.be/omgevingsvergunning/inzageloket";
export const GEOPUNT = "https://www.geopunt.be/?app=hinder-in-kaart";
export const safeHttps = value => {
  try { const u=new URL(String(value||""));return u.protocol==="https:"&&!u.username&&!u.password?u.href:""; }
  catch { return ""; }
};
export const rawData = x => /^https:\/\/(?:geo(?:data)?\.(?:antwerpen\.be|api\.vlaanderen\.be)|gipod\.api\.vlaanderen\.be)\//i.test(safeHttps(x));
export const distinctPage = x => {const s=safeHttps(x);return !!s&&new URL(s).pathname!=="/"&&!rawData(s);};
export function hinderkaart(gipodId) {
  const id=String(gipodId??"");
  return /^[1-9]\d{0,12}$/.test(id)?GEOPUNT+"&gipodid="+id:GEOPUNT;
}
export function bezoekersLinks(e={}) {
  const item=e.item||{}, out=[], add=(url,label,type="main")=>{
    const href=safeHttps(url);
    if(href&&!out.some(x=>x.url===href))out.push({url:href,label,type});
  };
  if(e.source==="permits"){
    add(INZAGE,"Zoek aanvraag en plannen in het Inzageloket");
    add(INZAGE_UITLEG,"Uitleg: zoeken op projectnummer of adres","help");
  }else if(e.source==="works"){
    add(hinderkaart(item.gipodId),"Bekijk werken en hinder op de officiële kaart");
  }else if(e.source==="publicSpace"&&item.gipodId){
    add(hinderkaart(item.gipodId),"Bekijk de hinder op de officiële kaart");
  }else if(e.source==="agenda"){
    if(item.sourceId==="stad-markten")add("https://www.antwerpen.be/info/5c065842a67793326b260661/markten-in-district-antwerpen","Marktdag, uren en locatie op Antwerpen.be");
    if(item.registrationVerified===true&&distinctPage(item.registrationUrl))
      add(item.registrationUrl,"Inschrijven via bevestigde aanmeldpagina");
    if(e.url&&!rawData(e.url))add(e.url,distinctPage(e.url)?
      "Officiële evenementinfo en eventuele inschrijving":"Website van de organisator (algemene pagina)");
  }
  if(e.sourceUrl&&!out.some(x=>x.url===safeHttps(e.sourceUrl)))
    add(e.sourceUrl,rawData(e.sourceUrl)?"Technische databron (geen infopagina)":"Officiële bronpagina","source");
  return out;
}
export function bezoekersHint(e={}) {
  const item=e.item||{};
  if(e.source==="permits"){
    const project=String(item.project||"").trim();
    return /^OMV[_-]?\d{8,}$/i.test(project)
      ?"Zoek op projectnummer "+project+". Plannen zijn alleen tijdens de publieke procedure zichtbaar."
      :"Zoek op OMV-projectnummer of adres. Niet iedere aanvraag is op dit moment openbaar.";
  }
  if(e.source==="works")return /^\d+$/.test(String(item.gipodId||""))?
    "De kaart opent bij GIPOD "+item.gipodId+"; controleer periode, ligging en hinder.":"Zoek op straatnaam in Hinder in Kaart.";
  if(e.source==="publicSpace"&&!item.gipodId)return "A-Sign publiceert hier een stedelijk dossier. Een afzonderlijke publieke evenementenpagina is niet bevestigd.";
  return "";
}
export function leesbaarUur(entry={}, {multi=false,running=false}={}) {
  if(entry.time)return String(entry.time).replace(":",".");
  if(multi)return running?"Loopt":"Start";
  const slot=String(entry.item?.timeSlot||"");
  const text=String(entry.timeText||entry.item?.timeText||"");
  if(/^(hele dag|heel de dag|all day)$/i.test(slot.trim())||/^(hele dag|heel de dag)\b/i.test(text.trim()))return "Hele dag";
  return entry.start?"Uur onbekend":"";
}
