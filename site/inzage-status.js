// Inzageloket van Vlaanderen: een rechtstreekse link en de termijn van een openbaar onderzoek, maar
// alleen wat iemand zelf in het loket nakeek (site/sources/inzage-status.json). Nooit gissen.
//
// Waarom met de hand: de verversing (scripts/refresh-live-history.mjs) mag het Inzageloket niet bevragen.
// robots.txt van omgevingsloketinzage.omgeving.vlaanderen.be verbiedt elke bot ("User-agent: *",
// "Disallow: /"), en een Anubis-botcontrole staat voor elke pagina én voor de API achter het loket
// (/proxy-omv-up/rs/v1/inzage/...). De open data van het Departement Omgeving (Mercator, laag
// lu_omv_gd_v2) en de vergunningenlaag van de stad kennen geen openbaar onderzoek. Daarom: geen knop
// naar de startpagina (die vindt het dossier meestal niet), maar een eerlijke zin, en een link plus
// termijn alleen voor een dossier dat iemand opende, zolang dat openbaar onderzoek loopt.
// Zag iemand het dossier in openbaar onderzoek (letter O in het loket) zonder de datums af te lezen, dan
// alleen de link en de datum waarop het liep, nooit een einddatum.
export const INZAGE_LOKET="https://omgevingsloketinzage.omgeving.vlaanderen.be/";
export const INZAGE_STATUS_FILE="inzage-status.json";
export const INZAGE_STATUS_SCHEMA="inzage-status/1";
// Zonder nagekeken stand weet de site niet of er een openbaar onderzoek loopt; dat zegt ze ook zo. De tweede
// zin volgt vlaanderen.be/omgevingsvergunning/inzageloket ("in openbaar onderzoek ... of waarvoor de
// beroepstermijn loopt").
export const GEEN_INZAGE_ZIN="Deze site kon niet nagaan of er nu een openbaar onderzoek loopt. Het Inzageloket toont een aanvraag alleen tijdens het openbaar onderzoek en tijdens de beroepstermijn na de beslissing.";
// Wat iemand in het loket zag. Alleen "openbaar onderzoek": daarvoor weet de site wat ze moet zeggen.
export const INZAGE_TOESTANDEN=["openbaar onderzoek"];
// Een openbaar onderzoek voor een omgevingsvergunning duurt 30 dagen. Een regel zonder datums geldt daarom
// hoogstens tot 29 dagen na het nakijken: later kan dat onderzoek niet meer lopen.
export const ZONDER_TERMIJN_DAGEN=30;

const MAANDEN=["januari","februari","maart","april","mei","juni","juli","augustus","september","oktober","november","december"];
const isoDag=v=>{
  const s=String(v??"");const m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return "";
  const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));
  return d.getUTCFullYear()===+m[1]&&d.getUTCMonth()===+m[2]-1&&d.getUTCDate()===+m[3]?s:"";
};
// "20 oktober", met het jaartal erbij als dat niet het jaar van vandaag is.
export function dagTekst(iso,vandaag=""){
  const s=isoDag(iso);if(!s)return "";
  const [y,m,d]=s.split("-").map(Number);
  return `${d} ${MAANDEN[m-1]}${String(vandaag).slice(0,4)===String(y)?"":` ${y}`}`;
}
const plusDagen=(iso,n)=>{const [y,m,d]=iso.split("-").map(Number);return new Date(Date.UTC(y,m-1,d+n)).toISOString().slice(0,10)};
export function brusselsVandaag(now=new Date()){
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Brussels",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
}

// "OMV_2026062371" -> "2026062371". Alles wat er niet precies zo uitziet, krijgt geen link.
export function inzageNummer(project){
  const m=String(project??"").trim().match(/^OMV_(\d{10})$/i);
  return m?m[1]:"";
}
export function inzageLink(project){
  const n=inzageNummer(project);
  return n?INZAGE_LOKET+n:"";
}

const DOC_SLEUTELS=["schema","uitleg","dossiers"];
const DOSSIER_SLEUTELS=["project","gevonden","toestand","openbaarOnderzoek","nagekeken","bron"];
const BRONNEN=["handmatig"];
// Vorm van site/sources/inzage-status.json. Alleen vaste velden: geen namen, geen adressen, geen vrije tekst
// per dossier. Een fout maakt het hele bestand ongeldig (de site toont dan niets uit dit bestand).
// openbaarOnderzoek ({van, totEnMet}) mag ontbreken: dan las niemand de datums af (gevonden, zonder termijn).
export function valideerInzageStatus(doc){
  const fouten=[];
  if(!doc||typeof doc!=="object"||Array.isArray(doc))return ["geen object"];
  for(const k of Object.keys(doc))if(!DOC_SLEUTELS.includes(k))fouten.push(`onbekend veld ${k}`);
  if(doc.schema!==INZAGE_STATUS_SCHEMA)fouten.push("schema ontbreekt of klopt niet");
  if(typeof doc.uitleg!=="string"||!doc.uitleg.trim())fouten.push("uitleg ontbreekt");
  if(!Array.isArray(doc.dossiers))return [...fouten,"dossiers ontbreekt"];
  const gezien=new Set();
  doc.dossiers.forEach((d,i)=>{
    const at=`dossiers[${i}]`;
    if(!d||typeof d!=="object"||Array.isArray(d)){fouten.push(`${at}: geen object`);return}
    for(const k of Object.keys(d))if(!DOSSIER_SLEUTELS.includes(k))fouten.push(`${at}: onbekend veld ${k}`);
    if(!inzageNummer(d.project))fouten.push(`${at}: project is geen OMV_ gevolgd door 10 cijfers`);
    else if(gezien.has(d.project.toUpperCase()))fouten.push(`${at}: project staat er twee keer in`);
    else gezien.add(d.project.toUpperCase());
    if(d.gevonden!==true)fouten.push(`${at}: gevonden moet true zijn (alleen dossiers die in het loket openden)`);
    if(!INZAGE_TOESTANDEN.includes(d.toestand))fouten.push(`${at}: toestand moet een van ${INZAGE_TOESTANDEN.join(", ")} zijn`);
    if(!BRONNEN.includes(d.bron))fouten.push(`${at}: bron moet een van ${BRONNEN.join(", ")} zijn`);
    if(!isoDag(d.nagekeken))fouten.push(`${at}: nagekeken is geen datum (JJJJ-MM-DD)`);
    if(!("openbaarOnderzoek" in d))return;
    const oo=d.openbaarOnderzoek;
    if(!oo||typeof oo!=="object"||Array.isArray(oo)){fouten.push(`${at}: openbaarOnderzoek is geen object met van en totEnMet`);return}
    for(const k of Object.keys(oo))if(!["van","totEnMet"].includes(k))fouten.push(`${at}.openbaarOnderzoek: onbekend veld ${k}`);
    if(!isoDag(oo.van)||!isoDag(oo.totEnMet))fouten.push(`${at}.openbaarOnderzoek: van en totEnMet moeten datums zijn`);
    else if(oo.van>oo.totEnMet)fouten.push(`${at}.openbaarOnderzoek: van ligt na totEnMet`);
    else if(isoDag(d.nagekeken)&&(d.nagekeken<oo.van||d.nagekeken>oo.totEnMet))fouten.push(`${at}: nagekeken moet binnen het openbaar onderzoek liggen`);
  });
  return fouten;
}

// Wat de site over één dossier mag zeggen. null = niets nagekeken, of het openbaar onderzoek is voorbij
// (daarna kan het dossier uit het loket verdwijnen tot de beslissing: dan ook geen link meer).
// loopt is alleen true als de termijn bekend is en vandaag erbinnen valt. Zonder termijn: onderzoek null.
export function inzageVoor(doc,project,vandaag){
  const dag=isoDag(vandaag);const nummer=inzageNummer(project);
  if(!dag||!nummer||valideerInzageStatus(doc).length)return null;
  const d=doc.dossiers.find(x=>inzageNummer(x.project)===nummer);
  if(!d)return null;
  const basis={link:inzageLink(project),toestand:d.toestand,nagekeken:d.nagekeken};
  if(!d.openbaarOnderzoek){
    if(dag>plusDagen(d.nagekeken,ZONDER_TERMIJN_DAGEN-1))return null;
    return {...basis,onderzoek:null,loopt:false};
  }
  const {van,totEnMet}=d.openbaarOnderzoek;
  if(dag>totEnMet)return null;
  return {...basis,onderzoek:{van,totEnMet},loopt:dag>=van};
}
// Voegt de nagekeken stand toe aan elke aanvraag (item.inzage); de rest blijft zoals het was.
export function metInzage(items,doc,vandaag){
  return (Array.isArray(items)?items:[]).map(item=>{
    const inzage=inzageVoor(doc,item?.project,vandaag);
    return inzage?{...item,inzage}:item;
  });
}

// De zin bovenaan de kaart. Een termijn alleen met beide datums uit het loket. Zonder termijn: alleen de dag
// waarop het loket het openbaar onderzoek toonde, en waar de einddatum staat.
export function onderzoekZin(inzage,vandaag){
  if(inzage?.toestand!=="openbaar onderzoek")return "";
  const oo=inzage.onderzoek;
  if(!oo){
    const op=dagTekst(inzage.nagekeken,vandaag);
    return op?`Op ${op} liep er een openbaar onderzoek, volgens het Inzageloket. Tot wanneer je bezwaar kunt indienen, staat in het loket bij "Toestand".`:"";
  }
  const tot=dagTekst(oo.totEnMet,vandaag),van=dagTekst(oo.van,vandaag);
  if(!tot||!van)return "";
  return inzage.loopt
    ?`Openbaar onderzoek loopt tot en met ${tot}. Bezwaar indienen kan tot dan.`
    :`Openbaar onderzoek van ${van} tot en met ${tot}. Bezwaar indienen kan in die periode.`;
}
// De regel in het opengeklapte detail: de hele periode en wanneer het loket werd nagekeken.
export function onderzoekRegel(inzage,vandaag){
  if(inzage?.toestand!=="openbaar onderzoek")return "";
  const oo=inzage.onderzoek;
  if(!oo){const op=dagTekst(inzage.nagekeken,vandaag);return op?`Liep op ${op} (nagekeken in het Inzageloket). De einddatum kent deze site niet.`:""}
  return `Van ${dagTekst(oo.van,vandaag)} tot en met ${dagTekst(oo.totEnMet,vandaag)} (nagekeken in het Inzageloket op ${dagTekst(inzage.nagekeken,vandaag)})`;
}
