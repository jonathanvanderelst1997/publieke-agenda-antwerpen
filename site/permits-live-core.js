import {geometryIntersectsDistrict} from "./public-space-live-core.js";
import {resolveGeometryStreets} from "./street-core.js";
import {herkenAanvraag,beslissingsdatumTekst} from "./permit-clarity.js";
import {parcoursGeometrie} from "./parcours-straten.js";

const clean=(value,max=160)=>String(value??"").replace(/\s+/g," ").trim().slice(0,max);
const yes=value=>["1","true","ja","yes","y"].includes(clean(value,20).toLowerCase());
const geom=feature=>feature?.geometry||null;
const attrs=feature=>feature?.properties||feature?.attributes||feature||{};

export function normalizePermit(row={}){
  const dossier=clean(row.Dossiernummer,40);
  const project=clean(row.ProjectnummerOmgevingsloket,40);
  const type=clean(row.DOSSIERTYPE,80);
  if(!dossier&&!project)return null;
  if(yes(row.Ingetrokken)||yes(row.Stopgezet))return null;
  return{
    id:`permit:${dossier||project}`,
    dossier,
    project,
    dossierType:type,
    // Vrije onderwerptekst en namen worden nooit uitgegeven; alleen een vaste categorie.
    purpose:herkenAanvraag(row.AardAanvraag,row.Onderwerp),
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
// waaraan het perceel ligt), de andere daarna. place-core.js toont ze als "grenst ook aan".
const opAfstand=afstanden=>[...afstanden.values()].sort((a,b)=>a.distanceMeters-b.distanceMeters||a.ref.name.localeCompare(b.ref.name,"nl")).map(x=>x.ref);
const sleutel=s=>[s.id,s.name,s.postcode].join("|");
export function collectPermits({features=[],districtGeometry=null,streetIndex=null}={}){
  const byId=new Map(),afstanden=new Map(),vormen=new Map();
  for(const feature of features){
    if(districtGeometry&&!geometryIntersectsDistrict(geom(feature),districtGeometry))continue;
    const normalized=normalizePermit(attrs(feature));
    if(!normalized)continue;
    const street=streetIndex?resolveGeometryStreets(geom(feature),streetIndex,{maxDistanceMeters:24}):{streets:[],confidence:"unresolved",distanceMeters:null};
    const item={...normalized,streets:street.streets,streetResolution:street.confidence,streetDistanceMeters:street.distanceMeters,sourceLabel:"Stad Antwerpen · omgevingsvergunningen in behandeling",sourceUrl:"https://geodata.antwerpen.be/arcgissql/rest/services/P_PiP/pip2_vergunningen/MapServer/5"};
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
