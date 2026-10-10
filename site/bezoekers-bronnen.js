import {GEEN_INZAGE_ZIN,INZAGE_LOKET} from "./inzage-status.js";

export const INZAGE = INZAGE_LOKET;
export const INZAGE_UITLEG = "https://www.vlaanderen.be/omgevingsvergunning/inzageloket";
export const GEOPUNT = "https://www.geopunt.be/?app=hinder-in-kaart";

// Alleen activiteiten waarvoor een officiële projectpagina, officiële ticketshop
// of uitdrukkelijke inschrijfinstructie met identieke titel én datum bewezen is.
const BEVESTIGDE_ACTIES = Object.freeze({
  "2026-10-23|Vrijdagen van de Poëzie": Object.freeze({
    info:"https://www.antwerpen.be/info/69bcf7a1ff0ca8917752fe74/vrijdagen-van-de-poezie-in-districtshuis-harmonie",
    actie:"https://cid.recreatex.be/Tickets/Detail.aspx?code=CID-STA-20261023&language=NL&smallmenu=1",
    actieLabel:"Tickets voor 23 oktober — officiële ticketshop",
    hint:"23 oktober, 15–16 uur, districtshuis Harmonie. Tickets €5 of €0 met VT-statuut.",
  }),
  "2026-11-20|Vrijdagen van de Poëzie": Object.freeze({
    info:"https://www.antwerpen.be/info/69bcf7a1ff0ca8917752fe74/vrijdagen-van-de-poezie-in-districtshuis-harmonie",
    actie:"https://cid.recreatex.be/Tickets/Detail.aspx?code=CID-STA-20261120&language=NL&smallmenu=1",
    actieLabel:"Tickets voor 20 november — officiële ticketshop",
    hint:"20 november, 15–16 uur, districtshuis Harmonie. Tickets €5 of €0 met VT-statuut.",
  }),
  "2026-11-10|Verlangen naar verbinding": Object.freeze({
    info:"https://www.antwerpen.be/info/68e7c5577c39f40ba84cf2b2/voorstelling-verlangen-naar-verbinding-op-10-november",
    actie:"mailto:district.antwerpen@antwerpen.be?subject=Inschrijving%20Verlangen%20naar%20verbinding%2010%20november%202026",
    actieLabel:"Inschrijven per e-mail bij district Antwerpen",
    hint:"10 november, 14–15 uur, Het Oude Badhuis. Gratis, vooraf inschrijven per e-mail bij het district.",
  }),
  "2026-10-31|Halloween": Object.freeze({
    info:"https://www.antwerpen.be/nl/overzicht/district-antwerpen-1/jeugd/griezelfeest-bij-co-nova-op-halloween",
    hint:"CO Nova, 14–20 uur. Gratis tickets voor de voorstellingen zijn aan de infostand ter plaatse verkrijgbaar.",
  }),
  "2026-11-04|FURIE!": Object.freeze({
    info:"https://pers.districtantwerpen.be/furie-maakt-van-450-jaar-spaanse-furie-een-uniek-totaalspektakel",
    hint:"4 november, 19–20.30 uur op de Grote Markt: gratis stadspektakel, geen ticket nodig.",
  }),
});
const specialeActie = item => item?.sourceId === "district-kalender"
  ? BEVESTIGDE_ACTIES[`${item.date||""}|${item.title||""}`]||null : null;

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
    // Nooit de startpagina van het Inzageloket: daar vindt een bewoner het dossier meestal niet. Alleen een
    // rechtstreekse link naar een dossier dat in het loket opende (site/inzage-status.js).
    // Bij een openbaar onderzoek zegt de uitleglink waarvoor ze dient: die pagina legt uit hoe je bezwaar indient.
    if(item.inzage?.link){
      add(item.inzage.link,"Bekijk dit dossier en de plannen in het Inzageloket");
      add(INZAGE_UITLEG,item.inzage.toestand==="openbaar onderzoek"?"Zo dien je een bezwaar in (uitleg van Vlaanderen)":"Uitleg van Vlaanderen over het Inzageloket","help");
    }
  }else if(e.source==="works"){
    add(hinderkaart(item.gipodId),"Bekijk werken en hinder op de officiële kaart");
  }else if(e.source==="publicSpace"&&item.gipodId){
    add(hinderkaart(item.gipodId),"Bekijk de hinder op de officiële kaart");
  }else if(e.source==="agenda"){
    if(item.sourceId==="stad-markten")add("https://www.antwerpen.be/info/5c065842a67793326b260661/markten-in-district-antwerpen","Marktdag, uren en locatie op Antwerpen.be");
    const autoChecked=item.actionChecked===true;
    if(autoChecked&&item.actionKind==="ticket"&&item.actionCode==="CID-STA-"+String(item.date||"").replaceAll("-",""))
      add("https://cid.recreatex.be/Tickets/Detail.aspx?code="+item.actionCode+"&language=NL&smallmenu=1","Tickets bestellen op officieel bevestigde pagina");
    if(autoChecked&&item.actionKind==="email_district")
      out.push({url:"mailto:district.antwerpen@antwerpen.be?subject="+encodeURIComponent("Inschrijving "+String(item.title||"evenement")+" "+String(item.date||"")),label:"Inschrijven per e-mail bij district Antwerpen",type:"main"});
    const speciaal=autoChecked||item.actionAttempted===true?null:specialeActie(item);
    if(speciaal?.actie?.startsWith("mailto:district.antwerpen@antwerpen.be?subject="))
      out.push({url:speciaal.actie,label:speciaal.actieLabel,type:"main"});
    else if(speciaal?.actie)add(speciaal.actie,speciaal.actieLabel);
    if(item.registrationVerified===true&&distinctPage(item.registrationUrl))
      add(item.registrationUrl,"Inschrijven via bevestigde aanmeldpagina");
    if(speciaal?.info)add(speciaal.info,"Concrete informatie over dit evenement");
    if(e.url&&!rawData(e.url)){
      const label = item.sourceId==="district-kalender"
        ? /wat-beleef-je-in-district-antwerpen/i.test(String(e.url)) ? "Districtskalender met meerdere activiteiten" : "Officiële informatie over dit evenement"
        : item.sourceId==="district-vergaderingen"
          ? "Vergaderagenda en stukken op eBesluit"
          : item.sourceId==="stad-koopzondagen"
            ? "Officieel overzicht van koopzondagen"
            : distinctPage(e.url) ? "Lees de officiële informatie" : "Algemene website van de organisator";
      add(e.url,label,"source");
    }
  }
  if(e.sourceUrl&&!out.some(x=>x.url===safeHttps(e.sourceUrl)))
    add(e.sourceUrl,rawData(e.sourceUrl)?"Technische databron (geen infopagina)":"Officiële bronpagina","source");
  return out;
}
export function bezoekersHint(e={}) {
  const item=e.item||{};
  if(e.source==="permits")return item.inzage?.link?"":GEEN_INZAGE_ZIN;
  if(e.source==="works")return /^\d+$/.test(String(item.gipodId||""))?
    "De kaart opent bij GIPOD "+item.gipodId+"; controleer periode, ligging en hinder.":"Zoek op straatnaam in Hinder in Kaart.";
  if(e.source==="publicSpace"&&!item.gipodId)return "A-Sign publiceert hier een stedelijk dossier. Een afzonderlijke publieke evenementenpagina is niet bevestigd.";
  if(e.source==="agenda"){
    if(item.actionChecked===true){
      if(item.actionKind==="ticket")return "Tickets voor deze datum officieel bevestigd.";
      if(item.actionKind==="email_district")return "Inschrijving via het district officieel bevestigd.";
      if(item.actionKind==="onsite")return "Tickets ter plaatse aan de infostand. Geen online inschrijving bevestigd.";
      if(item.actionKind==="no_ticket")return "Geen ticket nodig volgens de organisator.";
      return "Officiële evenementpagina nagekeken; geen specifieke online inschrijving bevestigd.";
    }
    return item.actionAttempted===true ? "De actuele inschrijfwijze is niet bevestigd. Kijk bij de officiële evenementinformatie." : specialeActie(item)?.hint||"";
  }
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
