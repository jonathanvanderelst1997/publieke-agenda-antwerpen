import {GEEN_INZAGE_ZIN,INZAGE_LOKET} from "./inzage-status.js";
import {GIPOD_BRON,GIPOD_METADATA_URL,gipodLink} from "./gipod-bron.js";

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
// Hinder in Kaart, altijd de algemene kaart: nooit met gipodid. Met die parameter haalt de viewer het ruwe
// GIPOD-record op en opent meteen het detailpaneel, met de contactgegevens (ContactName, Email, Telephone) uit
// ContactOrganisations of HindranceContactOrganisations (site/gipod-bron.js). Het GIPOD-nummer staat als tekst
// bij het werk; een bezoeker zoekt op straatnaam.
export const hinderkaart = () => GEOPUNT;
// Een GIPOD-link (een ruw record of de datasetfiche) wordt altijd één bronvermelding "Bron: GIPOD (Digitaal
// Vlaanderen)" met de datasetfiche: nooit een link naar het ruwe record, dat contactgegevens draagt
// (site/gipod-bron.js). Ook niet uit oudere data (een straatbestand of feed van vóór die regel).
export function bezoekersLinks(e={}) {
  const item=e.item||{}, out=[], add=(url,label,type="main")=>{
    const gipod=gipodLink(url);
    const href=gipod?GIPOD_METADATA_URL:safeHttps(url);
    if(href&&!out.some(x=>x.url===href))out.push({url:href,label:gipod?GIPOD_BRON:label,type:gipod?"source":type});
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
    add(hinderkaart(),"Bekijk werken en hinder op de officiële kaart");
    add(GIPOD_METADATA_URL,GIPOD_BRON,"source");
  }else if(e.source==="publicSpace"&&item.kind==="event"){
    // Evenementkaart: de nagekeken officiële pagina of het gekoppelde agendapunt (site/kaart-uitleg.js).
    for(const l of e.evenementLinks||[]){
      const intern=/^\/event\/[a-z0-9][a-z0-9-]{2,200}\/$/.test(String(l?.url||""));
      const href=intern?l.url:safeHttps(l?.url);
      if(href&&!rawData(href)&&!gipodLink(href)&&!out.some(x=>x.url===href))out.push({url:href,label:String(l.label||"Officiële info over dit evenement"),type:"main",uitleg:String(l.uitleg||"")});
    }
    if(e.sourceUrl)add(e.sourceUrl,"Technische gegevens van de stad (geen infopagina)","source");
  }else if(e.source==="publicSpace"&&item.gipodId){
    add(hinderkaart(),"Bekijk de hinder op de officiële kaart");
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
    if(e.url&&!rawData(e.url)&&!gipodLink(e.url)){
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
  // Een agendapunt zonder eigen bronlink, maar met een GIPOD-link als infopagina: dan toch de bronvermelding.
  if(e.url&&gipodLink(e.url))add(e.url,GIPOD_BRON,"source");
  return out;
}
// Een ruwe databron (ArcGIS, GIPOD-API) is geen pagina voor bewoners: die gaat in een ingeklapt blok
// "Technische details", de rest blijft gewoon zichtbaar.
export function splitsLinks(links=[]) {
  const technisch=links.filter(l=>l?.type==="source"&&rawData(l.url));
  return {gewoon:links.filter(l=>!technisch.includes(l)),technisch};
}
export function bezoekersHint(e={}) {
  const item=e.item||{};
  if(e.source==="permits")return item.inzage?.link?"":GEEN_INZAGE_ZIN;
  // Hinder in Kaart opent nooit op het werk zelf (zie hinderkaart): zoeken op straatnaam.
  if(e.source==="works")return "Zoek op straatnaam in Hinder in Kaart.";
  // Een evenementkaart zegt zelf onderaan waar de gegevens vandaan komen.
  if(e.source==="publicSpace"&&item.kind==="event")return "";
  // Per soort de juiste zin: "evenementenpagina" past alleen bij een evenement op straat.
  if(e.source==="publicSpace"&&!item.gipodId){
    if(item.kind==="parking")return "Uit A-Sign, de databank van de stad voor signalisatie. De borden ter plaatse gelden.";
    if(item.kind==="sgw")return "Uit A-Sign, de databank van de stad voor signalisatie. Een publieke infopagina per werfzone is niet bevestigd.";
    if(item.kind==="iod")return "A-Sign publiceert hier een stedelijk dossier voor een inname van de straat. Een publieke infopagina per dossier is niet bevestigd.";
    return "A-Sign publiceert hier een stedelijk dossier. Een afzonderlijke publieke evenementenpagina is niet bevestigd.";
  }
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
// Het eerste uur in een tekst ("9 tot 12 uur" → "09.00", "van 14 tot 17 uur" → "14.00", "om 20u30" → "20.30"), zoals
// UUR_IN_TEKST in lib/vaagheid.mjs een uur herkent; "" zonder uur. Eerst het begin van een reeks ("12 tot 17 uur": 12,
// niet 17), dan een los uur. Twee cijfers, zoals een uur uit de bron ("07.00").
// `vooraan`: alleen als vóór het uur niets anders staat dan woorden die zeggen wanneer ("van", "vanaf", "om", "op
// schooldagen: ma, di"). Staat er een activiteit of een plaats voor ("kratstapelen op de Groenplaats van 12 tot 17 uur",
// "optocht van 15 tot 15.30 uur"), dan hoort het uur bij dat deel, niet bij het hele item (nakijkronde 13 oktober 2026:
// "AAAntwerp: shoppingdag" kreeg op 34 straten "12.00" in de kop, het uur van het kratstapelen op de Groenplaats).
const UUR_REEKS=/\b(\d{1,2})(?:[.:u](\d{2}))?\s*(?:uur|u)?\s*(?:tot|-|–)\s*\d{1,2}(?:[.:u]\d{2})?\s*(?:uur|u)\b/i;
const UUR_LOS=/\b(\d{1,2})(?:[.:u](\d{2}))?\s*(?:uur|u)\b|\b(\d{1,2})[.:u](\d{2})\b/i;
const WANNEER_WOORD=/^(?:van|vanaf|om|tussen|telkens|steeds|doorlopend|dagelijks|elke|iedere|dag|op|schooldagen|weekdagen|werkdagen|en|ma|di|wo|do|vr|za|zo|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|\d{1,2}|(?:jan|feb|maa|mrt|apr|mei|jun|jul|aug|sep|okt|nov|dec)\p{L}*\.?)$/iu;
export function eersteUurInTekst(tekst="", {vooraan=false}={}){
  const t=String(tekst||"");
  const m=UUR_REEKS.exec(t)||UUR_LOS.exec(t);
  if(!m)return "";
  if(vooraan&&!t.slice(0,m.index).split(/[\s,;:]+/).filter(Boolean).every((w)=>WANNEER_WOORD.test(w)))return "";
  const uur=Number(m[1]??m[3]),min=m[2]??m[4]??"00";
  return Number.isInteger(uur)&&uur<=24&&Number(min)<60?`${String(uur).padStart(2,"0")}.${min}`:"";
}
export function leesbaarUur(entry={}, {multi=false,running=false}={}) {
  if(entry.time)return String(entry.time).replace(":",".");
  if(multi)return running?"Loopt":"Start";
  const slot=String(entry.item?.timeSlot||"");
  const text=String(entry.timeText||entry.item?.timeText||"");
  if(/^(hele dag|heel de dag|all day)$/i.test(slot.trim())||/^(hele dag|heel de dag)\b/i.test(text.trim()))return "Hele dag";
  // Nooit "Uur onbekend" als de tekst een uur geeft (nakijkronde 13 oktober 2026: AAAntwerp zei "Uur onbekend" naast
  // "kratstapelen op de Groenplaats van 12 tot 17 uur"). Een uur vooraan is het beginuur; een uur van een deel elders
  // ("kratstapelen op de Groenplaats van 12 tot 17 uur") niet: dan "Zie uren", de hele tekst staat bij "Wanneer".
  const uit=eersteUurInTekst(text,{vooraan:true});
  if(uit)return uit;
  if(eersteUurInTekst(text))return "Zie uren";
  return entry.start?"Uur onbekend":"";
}
