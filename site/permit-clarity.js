// Alleen vaste categorieën uit openbare bronvelden; nooit vrije onderwerptekst of namen.
const fold=x=>String(x??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().slice(0,1200);
const SOORTEN=[
  [/sloop|slopen|afbraak|afbreken/i,"Sloopwerken"],
  [/nieuwbouw|nieuwe (?:woning|appartement|gebouw)|bouwen van (?:een|het)/i,"Nieuwbouw"],
  [/verkavel|verdeling in percelen/i,"Verkaveling"],
  [/functiewijzig|bestemmingswijzig|herbestemming/i,"Functiewijziging"],
  [/verbouw|renov|uitbreid|aanbouw|bijbouw/i,"Verbouwing of uitbreiding"],
  [/gevelrenovatie|gevelwerken|gevelisolatie/i,"Gevelwerken"],
  [/dakwerken|dakrenovatie|dakkapel|dakisolatie/i,"Dakwerken"],
  [/bomen vellen|boom vellen|ontbossing/i,"Bomen vellen"],
  [/exploitat|ingedeelde inrichting|milieuhandeling/i,"Exploitatie of milieuactiviteit"],
  [/reclamepaneel|lichtreclame|uithangbord/i,"Reclame of uithangbord"],
  [/terrasaanvraag|horecaterras/i,"Terrasaanvraag"],
  [/verharding|terreinaanleg/i,"Terreinaanleg of verharding"],
  [/stedenbouwkundige handelingen/i,"Stedenbouwkundige aanvraag"],
];
export function herkenAanvraag(aard,onderwerp){
  const woorden=fold(onderwerp)+" "+fold(aard);
  for(const [re,naam] of SOORTEN)if(re.test(woorden))return naam;
  return "";
}
const maanden=["januari","februari","maart","april","mei","juni","juli","augustus","september","oktober","november","december"];
export function beslissingsdatumTekst(value){
  const s=String(value??"").trim();let y,m,d,z;
  if((z=s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/))){y=+z[1];m=+z[2];d=+z[3]}
  else if((z=s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/))){d=+z[1];m=+z[2];y=+z[3]}
  else if((z=s.match(/^(\d{4})(\d{2})(\d{2})$/))){y=+z[1];m=+z[2];d=+z[3]}
  else return "";
  const check=new Date(Date.UTC(y,m-1,d));
  return y>=1900&&y<=2200&&check.getUTCFullYear()===y&&check.getUTCMonth()===m-1&&check.getUTCDate()===d?String(d)+" "+maanden[m-1]+" "+y:"";
}
const dutchDay=iso=>{
  const x=String(iso||"").slice(0,10),z=x.match(/^\d{4}-(\d{2})-(\d{2})$/);
  return z&&+z[1]>=1&&+z[1]<=12?String(+z[2])+" "+maanden[+z[1]-1]:x;
};
// Beslissingsstatus alleen wanneer de officiële tekst dat ondubbelzinnig zegt.
// 'Gunstig advies' alleen is NOOIT bewijs van een verleende vergunning.
export function omgevingsStatus(item={}) {
  const raw=fold(item.decision);
  if(/\b(geweigerd|weigering|niet vergund|vergunning geweigerd)\b/.test(raw))
    return {type:"geweigerd",label:"Aanvraag geweigerd volgens de gepubliceerde beslissing; werken niet toegestaan op basis van deze aanvraag."};
  if(/\b(voorwaardelijk vergund|vergunning verleend|vergund|verleende vergunning)\b/.test(raw))
    return {type:"vergund",label:"Vergunning verleend volgens de stadsbron; startdatum van de werken niet bevestigd."};
  if(raw)return {type:"onduidelijk",label:"Een beslissing is vermeld, maar haar betekenis is niet eenduidig. Raadpleeg het Inzageloket."};
  return {type:"aanvraag",label:"Omgevingsaanvraag in behandeling; geen verleende vergunning bevestigd."};
}
export function duidelijkeKaart(entry={},item={}){
  if(entry.source==="permits"){
    const stage=omgevingsStatus(item);
    return {
      titel:item.purpose||"Omgevingsaanvraag — doel niet bevestigd",
      samenvatting:stage.label,
      tijd:stage.type==="vergund"?"Vergund":stage.type==="geweigerd"?"Geweigerd":"Aanvraag",
      toelichting:"Deze stadslaag gaat over aanvragen en besluiten, niet over feitelijk begonnen werken. De aanvraagdatum en de startdatum van de uitvoering zijn niet gepubliceerd. Kijk in het Inzageloket voor plannen en officiële termijnen.",
      regels:[["Waarvoor?",item.purpose||"Niet betrouwbaar te bepalen uit de beschikbare openbare gegevens"],
        ["Procedurestatus",stage.label],
        ...(item.decisionDateLabel?[["Beslissingsdatum",item.decisionDateLabel]]:[]),
        ["Start van de werken","Niet gepubliceerd"]],inzageloket:true,
    };
  }
  const onbekend=entry.source==="publicSpace"&&item.kind==="iod"&&(entry.uitleg?.ontbreekt||[]).some(v=>String(v).includes("naam van het evenement niet gepubliceerd"));
  if(onbekend){
    const n=Array.isArray(entry.straten)?entry.straten.length:0;
    return {
      titel:"Naam evenement onbekend — straatparcours"+(n?" langs "+n+" straten":"")+" op "+dutchDay(entry.start),
      samenvatting:"De stad vermeldt een goedgekeurde aanvraag voor tijdelijk gebruik van het openbaar domein; de naam en uren ontbreken.",
      tijd:entry.time?"":"Uren onbekend",
      toelichting:"Dit is een toelatingsdossier, geen volledige evenementenkalender. De kaart toont de betrokken straten van het parcours, maar bevestigt niet dat alle straten tegelijk afgesloten zijn of op welke uren dat gebeurt.",
      regels:[],inzageloket:false,
    };
  }
  return {titel:entry.title,samenvatting:entry.summary,tijd:"",toelichting:"",regels:Array.isArray(entry.regels)?entry.regels:[],inzageloket:false};
}
