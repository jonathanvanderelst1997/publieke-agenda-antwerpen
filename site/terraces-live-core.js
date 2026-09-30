import {geometryIntersectsDistrict} from "./public-space-live-core.js";
import {resolveAddressStreet,resolveGeometryStreets,combineStreetResolutions} from "./street-core.js";
const clean=(value,max=256)=>String(value??"").replace(/\s+/g," ").trim().slice(0,max);
const attrs=feature=>feature?.properties||feature?.attributes||feature||{};
const geom=feature=>feature?.geometry||null;
export function normalizeTerrace(row={}){
  const id=clean(row.ROLnet_ID||row.OBJECTID,120); if(!id)return null;
  return{ id:`terrace:${id}`,recordId:id,terraceType:clean(row.TypeTerrasZone,120)||"Terraszone",status:clean(row.Status,120)||"Status niet ingevuld",address:clean(row.adres,180),postcode:Number.isFinite(Number(row.postcode))?String(Number(row.postcode)):"",sourceUrl:"https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/49"};
}
export function collectTerraces(features=[],districtGeometry=null,streetIndex=null){
  if(!districtGeometry)return[];
  const out=[];
  for(const feature of features){
    if(!geometryIntersectsDistrict(geom(feature),districtGeometry))continue;
    const normalized=normalizeTerrace(attrs(feature)); if(!normalized)continue;
    const resolutions=[];
    if(streetIndex){if(normalized.address)resolutions.push(resolveAddressStreet(normalized.address,streetIndex));resolutions.push(resolveGeometryStreets(geom(feature),streetIndex))}
    const street=combineStreetResolutions(resolutions);
    out.push({...normalized,streets:street.streets,streetResolution:street.confidence,streetDistanceMeters:street.distanceMeters});
  }
  return[...new Map(out.map(item=>[item.id,item])).values()].sort((a,b)=>a.address.localeCompare(b.address,"nl")||a.terraceType.localeCompare(b.terraceType,"nl"));
}
