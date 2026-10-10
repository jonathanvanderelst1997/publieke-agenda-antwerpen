import {geometryIntersectsDistrict} from "./public-space-live-core.js";
import {resolveAddressStreet,resolveGeometryStreets,combineStreetResolutions} from "./street-core.js";
import {voerUit,voerUitInStappen} from "./in-stappen.js";
const clean=(value,max=256)=>String(value??"").replace(/\s+/g," ").trim().slice(0,max);
const attrs=feature=>feature?.properties||feature?.attributes||feature||{};
const geom=feature=>feature?.geometry||null;
export function normalizeTerrace(row={}){
  const id=clean(row.ROLnet_ID||row.OBJECTID,120); if(!id)return null;
  return{ id:`terrace:${id}`,recordId:id,terraceType:clean(row.TypeTerrasZone,120)||"Terraszone",status:clean(row.Status,120)||"Status niet ingevuld",address:clean(row.adres,180),postcode:Number.isFinite(Number(row.postcode))?String(Number(row.postcode)):"",sourceUrl:"https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/49"};
}
// Een generator: na elke feature een `yield`, zodat de browser in stappen kan werken (site/in-stappen.js).
function* verzamel(features=[],districtGeometry=null,streetIndex=null){
  if(!districtGeometry)return[];
  const out=[];
  for(const feature of features){
    yield;
    if(!geometryIntersectsDistrict(geom(feature),districtGeometry))continue;
    const normalized=normalizeTerrace(attrs(feature)); if(!normalized)continue;
    // Een terras dat de stad "niet actief" noemt, staat er nu niet: niet tonen.
    if(/^niet actief$/i.test(normalized.status))continue;
    // De straat van het adres telt. Alleen zonder bruikbaar adres: de straten binnen 18 m van de zone
    // (anders hangt een hoekterras ook aan de buurstraat).
    let street={streets:[],confidence:"unresolved",distanceMeters:null};
    if(streetIndex){
      const opAdres=normalized.address?resolveAddressStreet(normalized.address,streetIndex):null;
      street=opAdres?.streets?.length?opAdres:combineStreetResolutions([resolveGeometryStreets(geom(feature),streetIndex)]);
    }
    out.push({...normalized,streets:street.streets,streetResolution:street.confidence,streetDistanceMeters:street.distanceMeters});
  }
  return[...new Map(out.map(item=>[item.id,item])).values()].sort((a,b)=>a.address.localeCompare(b.address,"nl")||a.terraceType.localeCompare(b.terraceType,"nl"));
}
export function collectTerraces(features=[],districtGeometry=null,streetIndex=null){return voerUit(verzamel(features,districtGeometry,streetIndex))}
// In de browser: hetzelfde resultaat, in stappen van ongeveer 40 ms.
export function collectTerracesInStappen(features=[],districtGeometry=null,streetIndex=null,stappen={}){return voerUitInStappen(verzamel(features,districtGeometry,streetIndex),stappen)}
