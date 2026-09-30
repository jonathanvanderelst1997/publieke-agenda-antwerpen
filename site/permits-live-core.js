import {geometryIntersectsDistrict} from "./public-space-live-core.js";
import {resolveGeometryStreets} from "./street-core.js";

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
    decision:clean(row.Beslissing,80),
    decisionDate:clean(row.DatumBeslissing,20),
    complete:clean(row.Volledig,20),
    admissible:clean(row.Ontvankelijk,20),
    authority:clean(row.behandelendeOverheid,120),
    decisionAuthority:clean(row.beslissingsoverheid,120),
  };
}

export function collectPermits({features=[],districtGeometry=null,streetIndex=null}={}){
  const byId=new Map();
  for(const feature of features){
    if(districtGeometry&&!geometryIntersectsDistrict(geom(feature),districtGeometry))continue;
    const normalized=normalizePermit(attrs(feature));
    if(!normalized)continue;
    const street=streetIndex?resolveGeometryStreets(geom(feature),streetIndex,{maxDistanceMeters:24}):{streets:[],confidence:"unresolved",distanceMeters:null};
    const item={...normalized,streets:street.streets,streetResolution:street.confidence,streetDistanceMeters:street.distanceMeters,sourceLabel:"Stad Antwerpen · omgevingsvergunningen in behandeling",sourceUrl:"https://geodata.antwerpen.be/arcgissql/rest/services/P_PiP/pip2_vergunningen/MapServer/5"};
    const current=byId.get(item.id);
    if(!current){byId.set(item.id,item);continue}
    const streets=[...(current.streets||[]),...(item.streets||[])];
    current.streets=[...new Map(streets.map(s=>[[s.id,s.name,s.postcode].join("|"),s])).values()];
  }
  return[...byId.values()].sort((a,b)=>a.dossierType.localeCompare(b.dossierType,"nl")||a.dossier.localeCompare(b.dossier,"nl"));
}
