import {brusselsVandaag,onderzoekRegel,onderzoekZin} from "./inzage-status.js";

// Alleen vaste categorieën uit openbare bronvelden; nooit vrije onderwerptekst of namen.
// Wat een kaart over een aanvraag zegt, komt uit de vaste teksten in dit bestand, plus aantallen
// (een getal met een vaste eenheid, zoals "6 woningen"). Het onderwerp zelf wordt nooit getoond.
// vouw houdt de hoofdletters (voor eigennamen), fold maakt alles klein; allebei op dezelfde plaatsen.
const vouw=x=>String(x??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[‘’`´]/g,"'").replace(/\s+/g," ").slice(0,1200);
const fold=x=>vouw(x).toLowerCase();

// ---- aantallen ----
const GETALLEN={twee:2,drie:3,vier:4,vijf:5,zes:6,zeven:7,acht:8,negen:9,tien:10,elf:11,twaalf:12};
const N=String.raw`(\d{1,3}|twee|drie|vier|vijf|zes|zeven|acht|negen|tien|elf|twaalf)`;
const getal=s=>/^\d+$/.test(s)?Number(s):GETALLEN[s]||0;
// Een getal telt alleen als er geen ander getal vlak voor staat (telefoonnummers, huisnummers,
// "2 en 3 wooneenheden"). Ook niet na "bus" of "nr" of na een straatnaam ("Teststraat 12 appartement 3"):
// dat is een adres. Tussen getal en eenheid mogen hoogstens twee bijvoeglijke naamwoorden staan.
const ADRES=String.raw`(?<!\b(?:bus|nrs?|nummer|huisnummer)\.? ?)(?<![a-z](?:straat|laan|lei|plein|steenweg|baan|dreef|kaai|vest|markt|plaats|weg|singel|dijk|hof|rui) )`;
const AANTAL=new RegExp(String.raw`(?<!\d[\s./-]?)(?<!\d (?:en|of|tot) )${ADRES}\b${N} (?:(?:[a-z]+e|extra|in totaal) ){0,2}([a-z][a-z'-]*)`,"g");
const EENHEDEN=[
  [/^(?:woonentiteit|wooneenhe|woongelegenhe|woning|woonunit|unit)/,"woning","woningen","woon"],
  [/^appartement/,"appartement","appartementen","woon"],
  [/^studio/,"studio","studio's","woon"],
  [/^studentenkamer/,"studentenkamer","studentenkamers","woon"],
  [/^kamerwoning/,"kamerwoning","kamerwoningen","woon"],
  [/^kamers?$/,"kamer","kamers","woon"],
  [/^meergezinswoning/,"meergezinswoning","meergezinswoningen","gebouw"],
  [/^eengezinswoning/,"eengezinswoning","eengezinswoningen","gebouw"],
  [/^rijwoning/,"rijwoning","rijwoningen","gebouw"],
  [/^(?:pand|panden)$/,"pand","panden","gebouw"],
  [/^gebouw(?:en)?$/,"gebouw","gebouwen","gebouw"],
  [/^(?:winkel|winkelruimte|handelsruimte)/,"winkel","winkels","winkel"],
  [/^(?:bomen|boom|populier|eik|plata|linde|esdoorn|wilg)/,"boom","bomen","boom"],
];
function aantallen(t){
  const out=[];
  for(const m of t.matchAll(AANTAL)){
    const n=getal(m[1]);
    const e=EENHEDEN.find(([re])=>re.test(m[2]));
    if(!n||n>999||!e)continue;
    out.push({n,soort:e[3],tekst:`${n} ${n===1?e[1]:e[2]}`,pos:m.index});
  }
  return out;
}
const enLijst=a=>a.length<2?a.join(""):`${a.slice(0,-1).join(", ")} en ${a.at(-1)}`;

// ---- vaste labels ----
// Elk label heeft een vaste tekst (LABELTEKSTEN), een groep (de oude ruwe categorie) en een test op
// het genormaliseerde onderwerp, met woordgrenzen: "verbouwen" is geen "bouwen".
const VERANDERWERK=/\b(?:functie\w*|wij[a-z]{0,2}g\w*|omvorm\w*|herbestemm\w*|verbouw\w*|opsplits\w*|opdel\w*|herinricht\w*|veranderen|transformatie)\b/;
const DOELFUNCTIES=[
  ["horeca",/\b(?:ho|da)?reca(?:-?(?:functie|zaak|unit))?\b|\brecafunctie\b|\brestaurant\b|\bcafe\b|\bdancing\b/],
  ["winkel",/\bdetailhandel\w*|\bkleinhandel\w*|\bwinkel\w*|\bhandel\b|\bhandels(?:functie|zaak|pand\w*|ruimte\w*|woning\w*)\b|\bkunstgalerij\b/],
  ["kantoor",/\bkantoor\w*|\bkantoren\b|\bdienstverlening\b|\bvrije beroepen\b|\bdiensten\b/],
  ["wonen",/\bwonen\b|\bwoonfunctie\b|\bwoning\w*|\b(?:een|meer)gezinswoning\w*|\bhandelswoning\w*|\bwoonproject\w*|\bappartement\w*|\bwoongelegenhe\w*|\bwoonentiteit\w*|\bwooneenhe\w*|\bunits\b/],
  ["kamers",/\bco-?living\w*|\bkamerwoning\w*|\bstudentenkamers?\b|\bstudentenhuisvesting\b/],
  ["sport",/\bfitness\b|\bdagrecreatie\b|\bsportzaal\b/],
  ["logies",/\bverblijfsrecreatie\b|\btoeristische logies\b|\bhotel\b|\bgastenkamers?\b/],
  ["gemeenschap",/\bgemeenschapsvoorziening\w*|\bgemeenschapsdienst\w*|\bgebedsruimte\b|\bbrandweerkazerne\b|\bdaklozenopvang\b|\bschool\b/],
  ["bedrijf",/\bindustrie\b|\bbedrijvigheid\b|\blogistiek centrum\b/],
];
const FUNCTIE_TEKST={horeca:"Functie wordt horeca",winkel:"Functie wordt winkel",kantoor:"Functie wordt kantoor of dienstverlening",wonen:"Functie wordt wonen",kamers:"Functie wordt kamers of co-living",sport:"Functie wordt sport of recreatie",logies:"Functie wordt toeristisch logies",gemeenschap:"Functie wordt gemeenschapsvoorziening",bedrijf:"Functie wordt bedrijf of werkplaats"};
const doelen=s=>new Set(DOELFUNCTIES.filter(([,re])=>re.test(s)).map(([k])=>k));
// "van handel naar reca": wat na "naar"/"tot" staat en er nog niet voor stond, is de nieuwe functie.
function nieuweFuncties(t){
  const out=new Map();let zelfde=false;
  for(const m of t.matchAll(/\b(?:naar|tot)\b/g)){
    const voor=t.slice(Math.max(0,m.index-160),m.index);
    if(new RegExp(String.raw`\bvan ${N} $`).test(voor))continue;
    const zin=voor.slice(voor.lastIndexOf(";")+1), stuk=voor.slice(Math.max(...[";",",",":"].map(c=>voor.lastIndexOf(c)))+1);
    if(!VERANDERWERK.test(zin))continue;
    const na=t.slice(m.index+m[0].length).split(/[;,.:]/)[0].slice(0,90);
    const oud=doelen(stuk),nu=doelen(na);
    for(const k of nu)if(!oud.has(k)&&!out.has(k))out.set(k,m.index-stuk.length);
    if(nu.size&&[...nu].every(k=>oud.has(k)))zelfde=true;
  }
  // "toevoegen van een handelsfunctie", "inrichten van een recafunctie".
  for(const m of t.matchAll(/\b(?:toevoeg|inricht)\w* van (?:een |de )?(?:autonome |gelijkvloerse |nieuwe )?(?:functie )?'?([a-z-]+(?: en [a-z]+)?)/g)){
    const w=m[1].replace(/functie$/,"");
    for(const k of doelen(w.replace(/^handels$/,"handelsfunctie").replace(/^(?:ho|da)?reca$/,"reca")))if(!out.has(k))out.set(k,m.index);
  }
  return {functies:[...out].map(([k,pos])=>({k,pos})),zelfde};
}
// "van 2 naar 3" bij woningen of kamers.
function vanNaar(t){
  const m=t.match(new RegExp(String.raw`\bvan ${N} naar ${N}\b(?: ([a-z']+))?`));
  if(!m)return null;
  const voor=t.slice(Math.max(0,m.index-70),m.index);
  const eenheid=m[3]?EENHEDEN.find(([re,,,soort])=>soort==="woon"&&re.test(m[3])):null;
  if(!eenheid&&!/\b(?:aantal|woon\w*|appartement\w*|studentenkamer\w*|kamers?)\b/.test(voor))return null;
  const a=getal(m[1]),b=getal(m[2]);
  const kamers=eenheid?/kamer/.test(eenheid[2])&&!/woning/.test(eenheid[2]):/kamer/.test(voor.slice(-30));
  return a&&b&&a!==b?{pos:m.index,meer:b>a,tekst:`van ${a} naar ${b}${kamers&&eenheid?" "+eenheid[2]:""}`,kamers}:null;
}
// Woorden die bij de sloop of de nieuwbouw horen maar een eigen, beter label hebben. Alleen als het
// kleine bouwwerk meteen volgt (hoogstens een aantal en één bijvoeglijk naamwoord): "bouwen van een
// eengezinswoning met bijgebouw en zwembad" is nieuwbouw, "bouwen van een zwembad" niet.
const KLEIN_BOUWWERK=new RegExp(String.raw`^(?:${N} )?(?:([a-z-]+) )?(?:antenne\w*|luifel\w*|(?:open )?overkapping\w*|veranda\w*|poolhouse\w*|zwembad\w*|\w*cabine\b|tijdelijke? (?:constructie|tent)\w*)`);
const GEBOUWWOORD=/^(?:\w*woning\w*|\w*gebouw\w*|appartement\w*|\w*hal|\w*hallen|loods\w*|magazijn\w*|school\w*|kantoor\w*|kantoren|pand\w*)$/;
const kleinBouwwerk=na=>{const m=na.match(KLEIN_BOUWWERK);return !!m&&!(m[2]&&GEBOUWWOORD.test(m[2]))};
// "café De Bouw", "Dhr. Bouw", "Bouw NV": een "Bouw" met een hoofdletter vlak na een voorvoegsel van een
// naam of een aanspreking, of vlak voor een vennootschapsvorm, is een naam. "Kavel 2 - Bouw van een
// woning" en "Bouw van ammoniaktanks" blijven nieuwbouw.
function eigenNaam(hoofd,pos,lengte){
  const w=hoofd.slice(pos,pos+lengte);
  if(!hoofd||w===w.toLowerCase()||hoofd===hoofd.toUpperCase())return false;
  return /(?:\b(?:de|den|der|van|ver|ter|ten|le|la)|\b(?:dhr|mevr|mr|mw|fa)\.) $/i.test(hoofd.slice(Math.max(0,pos-8),pos))
    ||/^ (?:nv|bv|bvba|vzw|cv|commv)\b/i.test(hoofd.slice(pos+lengte,pos+lengte+8));
}
function heeftNieuwbouw(t,hoofd=""){
  for(const m of t.matchAll(/(?<!(?:aan|bij) de )\bnieuwbouw\w*|(?<!voor de )\b(?:bouwen|bouw|oprichten|oprichting|herbouwen)\b|\brealiseren van (?:een |het )?(?:nieuw\w* |gemengd\w* )?(?:gebouw|nieuwbouw\w*|woning\w*|meergezinswoning\w*|appartement\w*)/g)){
    if(m[0]==="bouw"&&eigenNaam(hoofd,m.index,4))continue;
    const na=t.slice(m.index+m[0].length).replace(/^ (?:van|en de exploitatie van) (?:een |het |de )?/," ").trimStart();
    if(!kleinBouwwerk(na))return m.index;
  }
  return -1;
}
// Bomen planten. Geeft de plaats terug en waar het aantal mag staan (van, tot):
// "de aanplant van 201 nieuwe bomen" (aantal erna), "6 bomen heraanplanten" (aantal ervoor),
// "vellen van een boom met heraanplant" (geen eigen aantal).
const BOOMWOORD=String.raw`\b(?:bomen|boom|hoogstam\w*|laagstam\w*|populier\w*|eiken|linde\w*|platanen|esdoorn\w*)\b`;
function heeftAanplant(t){
  for(const m of t.matchAll(/\b(?:her)?aanplant\w*|\b(?:her)?planten\b/g)){
    const zin=t.slice(m.index,m.index+60).split(/[.;,]/)[0];
    if((/^(?:her)?aanplant/.test(m[0])||/^\w+ van\b/.test(zin))&&new RegExp(BOOMWOORD).test(zin))return {pos:m.index,van:m.index,tot:m.index+60};
    const voor=t.slice(Math.max(0,m.index-40),m.index);
    if(new RegExp(BOOMWOORD+" $").test(voor))return {pos:m.index,van:m.index-20,tot:m.index};
    if(/^(?:her)?aanplant/.test(m[0])&&new RegExp(BOOMWOORD+String.raw` (?:met|en) (?:de |een )?$`).test(voor))return {pos:m.index,van:m.index,tot:m.index};
  }
  return null;
}
function heeftSloop(t){
  for(const m of t.matchAll(/\b(?:slopen|sloop|sloopwerken|afbreken|afbraak|gesloopt|afgebroken)\b/g)){
    if(/^ van (?:de |het )?(?:volledige |bestaande )?gevel/.test(t.slice(m.index+m[0].length)))continue;
    return m.index;
  }
  return -1;
}
// Geeft de plaats van de eerste verbouwing terug, en of die alleen uit "uitbreiden" komt.
function heeftVerbouwing(t){
  const m=t.match(/\bverbouw\w*|\brenov(?:eren|atie\w*)\b|\baanbouw\w*|\bbijbouw\w*|\bachterbouw\w*|\bveranda\w*|\boptop\w*|\bextra (?:bouw)?la(?:ag|gen)\b|\bextra verdieping|\bbijkomende daklaag|\bbouwvolume\w*|\bvolume-?uitbreiding|\bintern\w* (?:constructieve )?(?:werken|wijzigingen|verbouwingen|indeling|aanpassingen)\b|\bconstructiev\w* (?:werken|wijzigingen|ingreep)\b|\bherinricht\w*|\bwijzigingen aan (?:een |de |het )?(?:achterbouw|gebouw|pand|woning|meergezinswoning|studentenhuisvesting)\b/);
  if(m)return {pos:m.index,uitbreiding:false};
  // Uitbreiden van een gebouw wel, van een tankterminal, opslag of vergunning niet: daar is een eigen label voor.
  for(const u of t.matchAll(/\buitbrei\w*/g)){
    const na=t.slice(u.index,u.index+80);
    if(!/tank|terminal|opslag|bemaling|bedrijf|inrichting|installatie|productie|stalplaats|capaciteit|vergunning|overslag|logistiek/.test(na))return {pos:u.index,uitbreiding:true};
  }
  return null;
}
function heeftGevel(t){
  let aangepast=-1,isolatie=-1;
  for(const m of t.matchAll(/\b(?:voor|zij|achter)?gevel\w*|\bvliesgevel\b/g)){
    if(/reclame/.test(m[0]))continue;
    const voor=t.slice(Math.max(0,m.index-70),m.index);
    if(/(?:haaks|vlak) op (?:de )?$|behoud van (?:de )?(?:[a-z]+ )?$|achter de bestaande $|zijde $/.test(voor))continue;
    if(/\b(?:zonnepane\w*|publiciteit\w*|steigerdoek\w*)\b[^,;]*aan (?:de )?$/.test(voor))continue;
    if(/isoler|isolatie|bepleister|crepi/.test(voor+m[0])&&!/wij[a-z]{0,2}g|vervang|vernieuw|aanpass/.test(voor.slice(-40))){if(isolatie<0)isolatie=m.index}
    else if(aangepast<0)aangepast=m.index;
  }
  return aangepast>=0?{pos:aangepast,tekst:"Gevel aanpassen"}:isolatie>=0?{pos:isolatie,tekst:"Gevel isoleren of bepleisteren"}:null;
}

const L=(id,tekst,groep)=>({id,tekst,groep});
// Wat weggaat: "supprimeren van inpandige terrassen", "verwijderen van de bestaande dakterrassen".
const WEG=/\b(?:supprim\w*|verwijder\w*|wegnem\w*) (?:van )?(?:de |het |een |\d+ )?(?:[a-z-]+ )?$/;
// Eén woning in enkelvoud. Er staat altijd een woordgrens of spatie voor: een handelswoning telt niet.
const WOONEENHEID=String.raw`(?:woning|appartement|woongelegenheid|wooneenheid|woonentiteit|duplex|studio)\b`;
// Opsplitsen geeft alleen meer woningen als er daarna meer dan één woning is: "in 3 appartementen",
// "in een duplex en een studio". "Een handelswoning opsplitsen in een woning en een winkel" niet.
const MEER_WONINGEN=new RegExp(String.raw`\b(?:vermeerder\w*|verhog\w*)\b[^.;]{0,60}\b(?:woon\w*|appartement\w*|studio\w*|kamers?)\b|\btoevoeg\w* van (?:een |de )?(?:\w+ )?(?:woonentiteit|appartement|woning|woongelegenheid|wooneenheid)\w*|\bextra (?:woon\w*|appartement\w*)|\b(?:opsplits\w*|opdel\w*)\b[^.;]{0,60}(?:\b(?:woningen|appartementen|woongelegenheden|wooneenheden|woonentiteiten|woonunits|studio'?s|duplexen)\b|\b${WOONEENHEID} en (?:een |1 )?(?:\w+ )?${WOONEENHEID})|\beengezinswoning[^.;]{0,60}\b(?:naar|tot) (?:een )?meergezinswoning`);

// Grote publieke projecten: alleen herkend als de Vlaamse Regering of de Deputatie de aanvraag behandelt.
// Bij een andere overheid kan dezelfde naam in het onderwerp iets heel anders betekenen. Een straatnaam of
// een bedrijfsnaam alleen is geen project: bij de Turnhoutsebaan moet het om de heraanleg gaan, bij
// Oosterweel om de verbinding, een knoop of de werken zelf.
const PROJECTEN=[
  [/\boosterweel(?:verbinding|knoop|werken|werf|tunnel|project|trace)\w*|\b(?:werken|werf|project|basisvergunning) oosterweel\b/,"Oosterweelverbinding"],
  [/\broyerssluis\b/,"Royerssluis",{verbouwing:"Renovatie van de sluis"}],
  [/^(?=.*\b(?:turnhoutsebaan|n12)\b)(?=.*\b(?:heraanle\w*|transformatie\w*|herinricht\w*))/,"Heraanleg Turnhoutsebaan (N12)"],
  [/\bblokkersdijk\b/,"Blokkersdijk"],
  [/\bvleeshuis\b/,"Museum Vleeshuis"],
  [/\bmayer van den bergh\b/,"Museum Mayer van den Bergh"],
  [/\bgroenenborger\b/,"Campus Groenenborger (Universiteit Antwerpen)"],
  [/\bstadscampus\b/,"Stadscampus (Universiteit Antwerpen)"],
];
// Alle labels die een kaart kan tonen; niets anders (plus projectnamen en aantallen).
export const LABELTEKSTEN=Object.freeze([
  "Sloop en nieuwbouw","Nieuwbouw","Sloopwerken",...Object.values(FUNCTIE_TEKST),"Functie van het gebouw verandert","Horeca verdwijnt",
  "Meer woningen","Minder woningen","Meer kamers","Minder kamers","Aantal woningen verandert","Ruimtes samenvoegen of opsplitsen",
  "Verbouwing of uitbreiding","Restauratie","Gevel aanpassen","Gevel isoleren of bepleisteren","Luifel en publiciteit","Luifel of zonnetent",
  "Publiciteit of reclame","Terrasoverkapping","Overkapping","Horecaterras","Dakterras","Terras of balkon","Dakwerken","Ramen en deuren","Boom vellen","Bomen vellen","Boom planten","Bomen planten",
  "Antenne of zendmast","Zonnepanelen","Muurschildering","Steigerdoek","Tijdelijke constructie of werfzone","Weg, parking of verharding",
  "Kabels, leidingen of riolering","Elektriciteitscabine","Grondwater oppompen (bemaling)","Dijk","Warmtepomp, airco of verwarming",
  "Milieuvergunning (exploitatie)","Afvalwater lozen","Bouwaanvraag",
  "Wijziging van een eerdere vergunning","Regularisatie (achteraf vergunnen)","Vergunning vernieuwen",
  ...PROJECTEN.map(([,,eigen])=>eigen?.verbouwing).filter(Boolean),
]);
const PUBLIEKE_OVERHEID=/^(?:de )?(?:vlaamse regering|deputatie)\b/;
const LEEG=/dossier aangemaakt via het digitaal loket|gelieve een onderwerp in te vullen/;
// Korte uitleg bij labels die zonder uitleg jargon zijn.
const UITLEG={
  "Regularisatie (achteraf vergunnen)":"Bij een regularisatie vraagt de aanvrager achteraf een vergunning voor iets dat al gebouwd of veranderd is.",
  "Wijziging van een eerdere vergunning":"Er bestaat al een vergunning; deze aanvraag wil ze aanpassen.",
  "Vergunning vernieuwen":"De aanvraag vraagt een bestaande vergunning te vernieuwen of bij te werken.",
  "Milieuvergunning (exploitatie)":"Voor sommige installaties en activiteiten, zoals opslag, verwarming, koeling of machines, is een milieuvergunning nodig om ze te mogen uitbaten.",
};
export const ONBEKEND_TITEL="Omgevingsaanvraag (soort werk niet herkend)";
export const LEEG_TITEL="Omgevingsaanvraag zonder omschrijving";
const ONBEKEND_WAT="De omschrijving van de aanvrager tonen we niet (privacy), en we herkennen er geen vaste soort werk in.";
// Het veld bevat alleen de vaste tekst van het loket. Of de aanvrager het project elders beschreef, weten we niet.
const LEEG_WAT="De stadsbron geeft geen omschrijving. Wat er gebeurt, staat alleen in het dossier zelf.";

// Alle vaste labels van één aanvraag, met aantallen uit de bron. Geeft nooit tekst uit het onderwerp terug.
// Elk label krijgt een plaats in het onderwerp en een rang: eerst wat er wezenlijk verandert (nieuwbouw,
// functie, aantal woningen), dan de bouwdelen, dan de technische onderdelen. Bij gelijke rang wint
// wat eerst in het onderwerp staat, zoals de aanvrager het opsomde.
export function aanvraagInhoud(aard,onderwerp,overheid=""){
  const ruw=fold(onderwerp);
  if(LEEG.test(ruw)||!ruw.trim()){
    if(/stedenbouwkundige handelingen/.test(fold(aard)))return maak([{...L("bouw","Bouwaanvraag","Stedenbouwkundige aanvraag"),pos:0,rang:1}],[],"");
    return {titel:LEEG_TITEL,labels:[],wat:LEEG_WAT,herkend:false,leeg:true,groep:"",project:""};
  }
  // "zonder functiewijziging": wat er niet gebeurt, telt niet mee. Even lang vervangen, zodat de plaatsen
  // gelijk blijven met de tekst mét hoofdletters.
  const t=ruw.replace(/\bzonder (?:\w+ ){0,2}?(?:verbouw\w*|functiewijziging\w*|wijziging van de functie)\b/g,m=>" ".repeat(m.length));
  const metHoofdletters=vouw(onderwerp);
  const hoofd=metHoofdletters.length===ruw.length?metHoofdletters:"";
  const inhoud=[],proc=[];
  const project=PUBLIEKE_OVERHEID.test(fold(overheid))?PROJECTEN.find(([re])=>re.test(t)):null;
  const tellen=aantallen(t);
  const plek=re=>{const m=t.match(re);return m?m.index:-1};
  // De eerste plaats waar re past en niet vlak na `niet` staat.
  const plekNiet=(re,niet)=>{for(const m of t.matchAll(new RegExp(re.source,"g")))if(!niet.test(t.slice(Math.max(0,m.index-60),m.index)))return m.index;return -1};
  const voeg=(pos,rang,id,tekst,groep,extra={})=>{if(pos>=0)inhoud.push({...L(id,tekst,groep),pos,rang,...extra})};

  // Sloop en nieuwbouw, met wat er komt.
  const nieuw=heeftNieuwbouw(t,hoofd),sloop=heeftSloop(t);
  if(nieuw>=0){
    const na=tellen.filter(x=>x.pos>nieuw);
    const woon=na.filter(x=>x.soort==="woon");
    const uniek=a=>a.filter((x,i)=>a.findIndex(y=>y.n===x.n)===i);
    const delen=uniek(woon.length?woon:na.filter(x=>x.soort==="gebouw")).slice(0,2).map(x=>x.tekst);
    const rest=t.slice(nieuw);
    if(!delen.length&&/\bappartement\w*|\bmeergezinswoning\w*|\bwoning\w*|\bwoongelegenhe\w*|\bwooneenhe\w*|\bwoonentiteit\w*/.test(rest))delen.push("woningen");
    const winkels=na.find(x=>x.soort==="winkel");
    if(winkels)delen.push(winkels.tekst);
    else if(/\b(?:detailhandel|winkel\w*|handelsruimte\w*|handelsgelijkvloers|commercieel gelijkvloers|kleinhandel\w*)\b/.test(rest))delen.push("een winkel");
    if(/\bkantoor\w*|\bkantoren\b/.test(rest))delen.push("kantoren");
    if(/\b(?:ho|da)?reca\w*|\brestaurant\b|\bcafe\b/.test(rest))delen.push("horeca");
    if(sloop>=0)voeg(Math.min(sloop,nieuw),0,"nieuw","Sloop en nieuwbouw","Sloopwerken",{detail:enLijst(delen)});
    else voeg(nieuw,0,"nieuw","Nieuwbouw","Nieuwbouw",{detail:enLijst(delen)});
  }else if(sloop>=0){
    const wat=tellen.find(x=>x.pos>sloop&&x.pos<sloop+60&&(x.soort==="gebouw"||x.soort==="woon"));
    voeg(sloop,1,"sloop","Sloopwerken","Sloopwerken",{titel:wat?`Sloop van ${wat.tekst}`:""});
  }
  // Functies.
  const {functies,zelfde}=nieuweFuncties(t);
  for(const {k,pos} of functies){
    const woon=k==="wonen"?tellen.filter(x=>x.soort==="woon").slice(0,1).map(x=>x.tekst):[];
    voeg(pos,0,"functie-"+k,FUNCTIE_TEKST[k],"Functiewijziging",{detail:woon.join("")});
  }
  if(!functies.length&&!zelfde)voeg(plek(/\bfunctiewijzig\w*|\bbestemmingswijzig\w*|\bherbestemm\w*|\b(?:wij[a-z]{0,2}g\w*|verander\w*) van (?:de |het )?(?:\w+ )?(?:hoofd)?functies?\b|\bwijzig\w* van functie\b/),0,"functie","Functie van het gebouw verandert","Functiewijziging");
  voeg(plek(/\bsupprim\w* van (?:de |het |een )?(?:ho|da)?reca/),0,"horeca-weg","Horeca verdwijnt","Functiewijziging");
  // Aantal woningen.
  const vn=vanNaar(t);
  const meer=plek(MEER_WONINGEN);
  const minder=plek(/\b(?:verminder\w*|samenvoeg\w*)\b[^.;]{0,60}\b(?:woon\w*|appartement\w*|studio\w*|kamers?|duplex)\b|\bsupprim\w* van (?:de )?woonfunctie|\bmeergezinswoning[^.;]{0,60}\b(?:naar|tot) (?:een )?eengezinswoning/);
  if(vn)voeg(vn.pos,0,vn.meer?"meer":"minder",vn.kamers?(vn.meer?"Meer kamers":"Minder kamers"):(vn.meer?"Meer woningen":"Minder woningen"),"Functiewijziging",{detail:vn.tekst});
  else if(meer>=0&&minder<0)voeg(meer,0,"meer","Meer woningen","Functiewijziging",{detail:tellen.filter(x=>x.soort==="woon"&&x.pos>meer).slice(0,1).map(x=>"wordt "+x.tekst).join("")});
  else if(minder>=0&&meer<0)voeg(minder,0,"minder","Minder woningen","Functiewijziging");
  else voeg(Math.max(meer,plek(/\bwij[a-z]{0,2}g\w* (?:van )?het aantal (?:woon\w*|appartement\w*)/)),0,"aantal","Aantal woningen verandert","Functiewijziging");
  if(!vn&&meer<0&&minder<0)voeg(plek(/\bsamenvoeg\w*|\bopsplits\w*|\bopdel\w*/),1,"ruimtes","Ruimtes samenvoegen of opsplitsen","Verbouwing of uitbreiding");
  // Bouwdelen.
  const verbouwing=heeftVerbouwing(t);
  if(verbouwing)voeg(verbouwing.pos,1,"verbouwing",project?.[2]?.verbouwing||"Verbouwing of uitbreiding","Verbouwing of uitbreiding");
  voeg(plek(/\brestaur(?:eren|atie\w*)\b/),1,"restauratie","Restauratie","Verbouwing of uitbreiding");
  const gevel=heeftGevel(t);
  if(gevel)voeg(gevel.pos,1,"gevel",gevel.tekst,"Gevelwerken");
  const luifel=plek(/\b(?:zonne)?luifel\w*|\bzonnetent\w*|\bmarkies\w*/);
  const pub=plek(/\bpubliciteit\w*|\breclame\w*|\bgevelreclame\w*|\buithangbord\w*|\blichtreclame\w*|\bpubliciteitsbord\w*/);
  if(luifel>=0||pub>=0)voeg(luifel>=0&&pub>=0?Math.min(luifel,pub):Math.max(luifel,pub),1,"luifel",luifel>=0&&pub>=0?"Luifel en publiciteit":luifel>=0?"Luifel of zonnetent":"Publiciteit of reclame","Reclame of uithangbord");
  else voeg(plek(/\bsteigerdoek\w*/),1,"steigerdoek","Steigerdoek","Reclame of uithangbord");
  const terras=plek(/\bterrasoverkapping\w*|\bterrasconstructie\w*|\boverdekt\w* terras\w*/);
  if(terras>=0)voeg(terras,1,"terrasoverkapping","Terrasoverkapping","Terrasaanvraag");
  else voeg(plek(/\boverkap\w*/),1,"overkapping","Overkapping","Nieuwbouw");
  voeg(plek(/\b(?:ho|da)?reca[ -]?terras\w*|\bterrasaanvraag\b|\bhorecaterras\w*/),1,"horecaterras","Horecaterras","Terrasaanvraag");
  // Een dakterras ligt op het dak; een terrasuitbouw op de eerste verdieping of een inpandig terras niet.
  // Wat weggaat ("supprimeren van inpandige terrassen") krijgt geen label alsof het erbij komt.
  voeg(plekNiet(/\bdakterras\w*|\bdaktuin\w*/,WEG),1,"dakterras","Dakterras","Verbouwing of uitbreiding");
  voeg(plekNiet(/\bterrasuitbouw\w*|\binpandig\w* terras\w*|\bbalkon\w*|\bloggia\w*/,WEG),1,"terras","Terras of balkon","Verbouwing of uitbreiding");
  voeg(plek(/\bdakwerk\w*|\bdakrenovatie\b|\bdakkapel\w*|\bdakisolatie\b|\b(?:verbouwen|wijzigen|vernieuwen|isoleren) van het dak\b|\bbovendakse\b/),1,"dak","Dakwerken","Dakwerken");
  voeg(plek(/\b(?:buiten)?schrijnwerk\w*|\bramen\b|\braamopening\w*|\bdeuropening\w*|\berker\b|\bwinkelpui\b/),1,"ramen","Ramen en deuren","Gevelwerken");
  // Bomen: "vellen van één boom", "vellen van 4 populieren", "ontbossing"; en wat er bijkomt: "de aanplant
  // van 201 nieuwe bomen", "vellen van een boom met heraanplant". Elk telt zijn eigen aantal.
  const boom=plek(/\b(?:vellen|kappen|rooien)\b[^.;]{0,50}\b(?:bomen|boom|populier\w*|hoogstammig\w*|laagstammig\w*|eiken|platanen)\b|\b(?:bomen|boom) (?:vellen|kappen)\b|\bontbossing\b/);
  const plant=heeftAanplant(t);
  if(boom>=0){
    const b=tellen.find(x=>x.soort==="boom"&&x.pos>=boom-12&&(!plant||plant.van<boom||x.pos<plant.van));
    const een=!b&&/\b(?:vellen|kappen|rooien) van (?:een|1) (?:\w+ )?boom\b/.test(t);
    voeg(boom,1,"bomen",een||b?.n===1?"Boom vellen":"Bomen vellen","Bomen vellen",{titel:b&&b.n>1?`${b.n} bomen vellen`:""});
  }
  if(plant){
    const b=tellen.find(x=>x.soort==="boom"&&x.pos>=plant.van&&x.pos<plant.tot&&(boom<plant.van||x.pos<boom));
    voeg(plant.pos,1,"planten",b?.n===1?"Boom planten":"Bomen planten","Terreinaanleg of verharding",{titel:b&&b.n>1?`${b.n} bomen planten`:""});
  }
  voeg(plek(/\bantenne\w*|\bzendmast\w*|\bgsm-?mast\w*/),1,"antenne","Antenne of zendmast","Nieuwbouw");
  voeg(plek(/\bzonnepane\w*/),1,"zon","Zonnepanelen","Dakwerken");
  voeg(plek(/\bmuurschildering\w*/),1,"muur","Muurschildering","Gevelwerken");
  voeg(plek(/\btijdelijke? (?:container\w*|constructie\w*|tent\w*|werfzone\w*|ijspiste\w*|uitwijkhaven\w*|warmtecentrale\w*)|\bcontainerklas\w*|\bwerfterrein\w*|\bwerfzone\w*|\bwerffase\w*|\bbouwplaats\w*|\btentconstructie\w*|\bijspiste\w*|\bpop-?up\b/),1,"tijdelijk","Tijdelijke constructie of werfzone","Terreinaanleg of verharding");
  // Technische onderdelen.
  voeg(plek(/\bverharding\w*|\bparking\b|\bbusparking\w*|\bautoparking\w*|\bparkeerplaats\w*|\bparkeerzone\w*|\brijbaan\w*|\btrambaan\w*|\bfietspad\w*|\bvoetpad\w*|\bfietsverbinding\w*|\bfietsontsluiting\w*|\bbrandweg\w*|\boprit\w*|\bterreinaanleg\w*|\bheraanleg\w*|\bstalplaats\w*|\bstallen van voertuigen\b/),2,"weg","Weg, parking of verharding","Terreinaanleg of verharding");
  // "geloosd via de openbare riolering" is geen werk aan de riolering.
  voeg(plek(/\bkabel\w*|\bleiding\w*|(?<!(?:loz|geloosd)[^.;]{0,40})\briolering\w*|\bwarmtenet\w*|\bbufferbekken\w*|\btramkeerlus\w*/),2,"leiding","Kabels, leidingen of riolering","Terreinaanleg of verharding");
  voeg(plek(/\b(?:hoog|midden)?spanningscabine\w*|\belektriciteitscabine\w*/),2,"cabine","Elektriciteitscabine","Exploitatie of milieuactiviteit");
  voeg(plek(/\bbemaling\w*|\bbronbemaling\w*|\bsleufbemaling\w*|\bgrondwaterverlaging\w*|\bopgepompt\b/),2,"bemaling","Grondwater oppompen (bemaling)","Exploitatie of milieuactiviteit");
  voeg(plek(/\b\w*dijk(?:en|werken)?\b/),2,"dijk","Dijk","Terreinaanleg of verharding");
  // Ook samengestelde woorden: "lucht-waterwarmtepompen", "bodemwarmtepomp".
  voeg(plek(/\b\w*warmtepomp\w*|\bairco\w*|\bkoelgroep\w*|\bbuitenunit\w*|\bwarmtecentrale\w*|\bwarmtewisselaar\w*/),2,"warmte","Warmtepomp, airco of verwarming","Exploitatie of milieuactiviteit");
  // Een milieuvergunning alleen voor een warmtepomp, airco, bemaling of cabine is geen apart bedrijf.
  const zonderWarmte=t.replace(/\b(?:exploit\w*|plaatsen en exploiteren)\b[^.;]{0,50}?\b(?:\w*warmtepomp\w*|airco\w*|bemaling\w*|bronbemaling\w*|grondwaterverlaging\w*|\w*cabine)(?: en (?:een |\d+ )?(?:airco|\w*warmtepomp)\w*)?(?: \(iioa\))?/g,m=>" ".repeat(m.length));
  const milieu=zonderWarmte.search(/\bexploit\w*|\biioa\b|\bingedeelde inrichting\w*|\bmilieuvergunning\w*|\bopslag\b|\bafvalstoffen\b|\bopslagterminal\w*|\btankterminal\w*|\btankenpark\w*|\btankstation\w*|\bdoorvoeropslag\w*|\bop- en overslag\w*|\boverslagbedrijf\w*|\bbetoncentrale\w*|\bbreker\b|\bcarwash\b|\bhandcarwash\b|\bprocesinstallatie\w*|\bammoniak\w*|\bnh3\b|\baniline\b|\btrommelcapaciteit\b|\binrichting voor\b/);
  // Neutraal: ook een school, een gebedshuis of een tandartsenpraktijk heeft soms een milieuvergunning nodig.
  voeg(milieu,2,"milieu","Milieuvergunning (exploitatie)","Exploitatie of milieuactiviteit");
  voeg(plek(/\bloz(?:en|ing)\w*|\bafvalwater\b|\bbedrijfsafvalwater\b/),2,"lozing","Afvalwater lozen","Exploitatie of milieuactiviteit");
  // "Uitbreiding" van een bedrijf is geen verbouwing van een gebouw.
  if(verbouwing?.uitbreiding&&milieu>=0)inhoud.splice(inhoud.findIndex(l=>l.id==="verbouwing"),1);
  // De procedure: wat voor soort aanvraag het is.
  if(/\bregulari\w*|\bzonder vergunning\b/.test(t))proc.push("Regularisatie (achteraf vergunnen)");
  if(/\bbasisvergunning\b|\b(?:ten opzichte van|tov|t\.o\.v\.) (?:de |het )?(?:vergunde toestand|(?:omgevings|bouw)?vergunning|omv)|\b(?:wijzigingen?|aanpassingen?|wijzigen) (?:op|aan|van) (?:de |het )?(?:reeds )?(?:verkregen |vergunde |bestaande )?(?:(?:omgevings)?vergunning\b|omv(?:[ _]?\d|\b))|\breeds vergunde\b|\bbijstelling\w*|\buitbreiding van (?:de |een )?bestaande vergunning\b/.test(t))proc.push("Wijziging van een eerdere vergunning");
  if(/\bhernieuw\w*|\bactualis\w*|\bverder exploit\w*|\bverdere exploitatie\w*/.test(t))proc.push("Vergunning vernieuwen");
  if(!inhoud.length&&!proc.length&&/stedenbouwkundige handelingen/.test(fold(aard)))voeg(0,1,"bouw","Bouwaanvraag","Stedenbouwkundige aanvraag");
  inhoud.sort((a,b)=>a.rang-b.rang||a.pos-b.pos);
  return maak(inhoud,proc,project?project[1]:"");
}
const klein=s=>/^[A-Z][a-z]/.test(s)?s[0].toLowerCase()+s.slice(1):s;
const metDetail=l=>l.titel||(l.detail?`${l.tekst} (${l.detail})`:l.tekst);
function maak(inhoud,proc,project){
  if(!inhoud.length&&!proc.length&&!project)return {titel:ONBEKEND_TITEL,labels:[],wat:ONBEKEND_WAT,herkend:false,leeg:false,groep:"",project:""};
  const delen=inhoud.map(metDetail);
  // De titel: een project of procedure als kop, dan hoogstens 2 tot 3 soorten werk.
  let titel,getoond;
  if(project){getoond=[...proc,...delen].slice(0,2);titel=getoond.length?`${project}: ${getoond.map(klein).join(" · ")}`:project}
  else if(proc.length&&delen.length){getoond=[proc[0],...delen.slice(0,2)];titel=`${proc[0]}: ${delen.slice(0,2).map(klein).join(" · ")}`}
  else{getoond=[...proc,...delen].slice(0,3);titel=getoond.map((d,i)=>i?klein(d):d).join(" · ")}
  const alles=[...proc,...delen];
  // "Wat" herhaalt de titel niet: alleen wat er niet meer in past, plus uitleg bij jargon.
  const extra=alles.filter(d=>!getoond.includes(d));
  const uitleg=[...proc,...inhoud.map(l=>l.tekst)].filter(l=>UITLEG[l]).map(l=>UITLEG[l]);
  const wat=[...(extra.length?[`Ook in deze aanvraag: ${extra.map(klein).join(" · ")}.`]:[]),...uitleg].join(" ");
  return {titel,labels:[...proc,...inhoud.map(l=>l.tekst)],wat,herkend:true,leeg:false,groep:inhoud[0]?.groep||"",project:project||""};
}
// Eén ruwe categorie (de eerste vaste soort), voor wie alleen een korte soort nodig heeft.
export function herkenAanvraag(aard,onderwerp){
  return aanvraagInhoud(aard,onderwerp).groep;
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
// Eén statusregel: de beslissing als die er is, anders hoe ver de aanvraag staat (Volledig, Ontvankelijk).
// Een leeg veld betekent "de bron zegt het niet", niet "nog niet".
const jaNee=v=>{const s=fold(v).trim();return /^(?:ja|j|yes|true|1)$/.test(s)?"ja":/^(?:nee|n|no|false|0)$/.test(s)?"nee":""};
// Het jaar uit het projectnummer van het Omgevingsloket (OMV_2019...): zo zie je een oud dossier.
const dossierJaar=project=>{const m=String(project??"").trim().match(/^OMV_(20\d\d)\d{6}$/);return m?m[1]:""};
export function aanvraagStand(item={}){
  const stage=omgevingsStatus(item);
  if(stage.type!=="aanvraag")return stage.label;
  const v=jaNee(item.complete),o=jaNee(item.admissible);
  if(v==="nee"||o==="nee")return "Ingediend, maar volgens de stadsbron niet volledig of niet ontvankelijk. Nog geen beslissing gepubliceerd.";
  if(v==="ja"&&o==="ja")return "In behandeling: volledig en ontvankelijk verklaard. Nog geen beslissing gepubliceerd.";
  if(v==="ja")return "In behandeling: volledig verklaard. Nog geen beslissing gepubliceerd.";
  if(o==="ja")return "In behandeling: ontvankelijk verklaard. Nog geen beslissing gepubliceerd.";
  const jaar=dossierJaar(item.project);
  return `Ingediend${jaar?` (dossier uit ${jaar})`:""}. De stadsbron zegt niet of de aanvraag volledig en ontvankelijk is. Nog geen beslissing gepubliceerd.`;
}
// Waar: de gekozen straat eerst; vanaf 3 straten een korte regel en de volledige lijst ingeklapt.
export function waarTekst(namen=[],voorkeur=""){
  const lijst=[...new Set(namen.map(n=>String(n||"").trim()).filter(Boolean))];
  const i=voorkeur?lijst.indexOf(voorkeur):-1;
  if(i>0)lijst.unshift(...lijst.splice(i,1));
  const kort=lijst.length>=3?`${lijst[0]} en ${lijst.length-1} andere straten`:lijst.join(" en ");
  return {kort,straten:lijst,ingeklapt:lijst.length>=3};
}
// Titel van een aanvraag, ook voor oudere items die alleen een ruwe categorie hebben.
export const aanvraagTitel=(item={})=>item.inhoud?.titel||item.purpose||ONBEKEND_TITEL;
export function duidelijkeKaart(entry={},item={},{straat="",vandaag=brusselsVandaag()}={}){
  if(entry.source==="permits"){
    const stage=omgevingsStatus(item);
    // Een openbaar onderzoek dat iemand in het Inzageloket nakeek (site/inzage-status.js): bovenaan de
    // kaart, ook als die dicht is. Zonder die stand zegt de kaart er niets over.
    const melding=onderzoekZin(item.inzage,vandaag);
    const periode=melding?onderzoekRegel(item.inzage,vandaag):"";
    const wat=item.inhoud?.wat||(!item.inhoud&&!item.purpose?ONBEKEND_WAT:"");
    const wie=String(item.decisionAuthority||item.authority||"").trim();
    const nummer=[item.dossier,item.project?`Omgevingsloket ${item.project}`:""].filter(Boolean).join(" · ");
    return {
      titel:aanvraagTitel(item),
      samenvatting:aanvraagStand(item),
      tijd:stage.type==="vergund"?"Vergund":stage.type==="geweigerd"?"Geweigerd":"Aanvraag",
      toelichting:"",
      melding,
      badge:melding?"Openbaar onderzoek":"",
      regels:[...(periode?[["Openbaar onderzoek",periode]]:[]),
        ...(wat?[["Wat",wat]]:[]),
        ...(wie?[[stage.type==="aanvraag"?"Wie beslist":"Beslist door",wie]]:[]),
        ...(item.decisionDateLabel?[["Beslissingsdatum",item.decisionDateLabel]]:[]),
        ["Start van de werken","Niet gepubliceerd"],
        ...(nummer?[["Dossiernummer",nummer]]:[])],
      waar:waarTekst((item.streets||[]).map(s=>s?.name),straat),
      eigenDetail:true,inzageloket:true,
    };
  }
  // Andere kaarten (werken, evenementen op straat) maken hun titel en uitleg zelf (kaart-uitleg.js).
  return {titel:entry.title,samenvatting:entry.summary,tijd:"",toelichting:"",regels:[],inzageloket:false};
}
