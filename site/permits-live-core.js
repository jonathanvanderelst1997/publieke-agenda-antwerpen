import {geometryIntersectsDistrict} from "./public-space-live-core.js";
import {resolveGeometryStreets} from "./street-core.js";
import {aanvraagInhoud,beslissingsdatumTekst} from "./permit-clarity.js";
import {parcoursGeometrie} from "./parcours-straten.js";

const LAAG="https://geodata.antwerpen.be/arcgissql/rest/services/P_PiP/pip2_vergunningen/MapServer/5";
// Technische link naar alleen dit dossier, zonder het vrije onderwerp en de naam van de aanvrager.
export function vergunningBronUrl(dossier="",project=""){
  const veld=/^[A-Za-z0-9_-]{4,40}$/.test(dossier)?["Dossiernummer",dossier]:/^[A-Za-z0-9_-]{4,40}$/.test(project)?["ProjectnummerOmgevingsloket",project]:null;
  if(!veld)return LAAG;
  const q=new URLSearchParams({where:`${veld[0]}='${veld[1]}'`,outFields:"Dossiernummer,DOSSIERTYPE,AardAanvraag,Beslissing,DatumBeslissing,Volledig,Ontvankelijk,ProjectnummerOmgevingsloket,behandelendeOverheid,beslissingsoverheid",returnGeometry:"false",f:"html"});
  return `${LAAG}/query?${q}`;
}

const clean=(value,max=160)=>String(value??"").replace(/\s+/g," ").trim().slice(0,max);
const yes=value=>["1","true","ja","yes","y"].includes(clean(value,20).toLowerCase());
const geom=feature=>feature?.geometry||null;
const attrs=feature=>feature?.properties||feature?.attributes||feature||{};
// Soms staat de intrekking alleen in het onderwerp ("INGETROKKEN dd 13/10/2017") en is het veld leeg.
// Alleen een duidelijke stempel telt: in hoofdletters, tussen haakjes of met een datum. "na de eerder
// ingetrokken aanvraag" verbergt niets.
export function ingetrokkenVolgensOnderwerp(onderwerp=""){
  const s=String(onderwerp??"");
  const niet=String.raw`(?<!\b(?:eerder|reeds|vorige|de|het|een|na) )`;
  if(s!==s.toUpperCase()&&new RegExp(niet+String.raw`\b(?:INGETROKKEN|STOPGEZET)\b`).test(s))return true;
  return new RegExp(String.raw`\((?:ingetrokken|stopgezet)\)|${niet}\b(?:ingetrokken|stopgezet) *(?:op|dd|d\.d\.|per)? *\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b`,"i").test(s);
}

export function normalizePermit(row={}){
  const dossier=clean(row.Dossiernummer,40);
  const project=clean(row.ProjectnummerOmgevingsloket,40);
  const type=clean(row.DOSSIERTYPE,80);
  if(!dossier&&!project)return null;
  if(yes(row.Ingetrokken)||yes(row.Stopgezet)||ingetrokkenVolgensOnderwerp(row.Onderwerp))return null;
  // Vrije onderwerptekst en namen worden nooit uitgegeven; alleen vaste labels en aantallen.
  const inhoud=aanvraagInhoud(row.AardAanvraag,row.Onderwerp,row.behandelendeOverheid);
  return{
    id:`permit:${dossier||project}`,
    dossier,
    project,
    dossierType:type,
    purpose:inhoud.groep,
    inhoud,
    decisionDateLabel:beslissingsdatumTekst(row.DatumBeslissing),
    decision:clean(row.Beslissing,80),
    decisionDate:clean(row.DatumBeslissing,20),
    complete:clean(row.Volledig,20),
    admissible:clean(row.Ontvankelijk,20),
    authority:clean(row.behandelendeOverheid,120),
    decisionAuthority:clean(row.beslissingsoverheid,120),
  };
}

// De straten van een vergunning staan op afstand: de dichtste straat eerst (dat is meestal de straat
// waaraan het perceel ligt), de andere daarna. place-core.js toont ze als "ook dicht bij".
const opAfstand=afstanden=>[...afstanden.values()].sort((a,b)=>a.distanceMeters-b.distanceMeters||a.ref.name.localeCompare(b.ref.name,"nl")).map(x=>x.ref);
const sleutel=s=>[s.id,s.name,s.postcode].join("|");
export function collectPermits({features=[],districtGeometry=null,streetIndex=null}={}){
  const byId=new Map(),afstanden=new Map(),vormen=new Map();
  for(const feature of features){
    if(districtGeometry&&!geometryIntersectsDistrict(geom(feature),districtGeometry))continue;
    const normalized=normalizePermit(attrs(feature));
    if(!normalized)continue;
    const street=streetIndex?resolveGeometryStreets(geom(feature),streetIndex,{maxDistanceMeters:24}):{streets:[],confidence:"unresolved",distanceMeters:null};
    const item={...normalized,streets:street.streets,streetResolution:street.confidence,streetDistanceMeters:street.distanceMeters,sourceLabel:"Stad Antwerpen · omgevingsvergunningen in behandeling",sourceUrl:vergunningBronUrl(normalized.dossier,normalized.project)};
    const per=afstanden.get(item.id)||new Map();afstanden.set(item.id,per);
    for(const x of street.metAfstand||street.streets.map(ref=>({ref,distanceMeters:Infinity}))){const k=sleutel(x.ref),cur=per.get(k);if(!cur||x.distanceMeters<cur.distanceMeters)per.set(k,x)}
    // Het perceel zelf, voor de straal rond een straat (site/neighborhood-core.js vormBinnenStraal).
    if(geom(feature)){const l=vormen.get(item.id);if(l)l.push(feature);else vormen.set(item.id,[feature])}
    const current=byId.get(item.id);
    if(!current){byId.set(item.id,item);item.streets=opAfstand(per);continue}
    current.streets=opAfstand(per);
  }
  for(const[id,item]of byId){const v=vormen.has(id)?parcoursGeometrie(vormen.get(id)):null;if(v&&(v.vlakken.length||v.lijnen.length))item.vorm=v}
  return[...byId.values()].sort((a,b)=>a.dossierType.localeCompare(b.dossierType,"nl")||a.dossier.localeCompare(b.dossier,"nl"));
}
