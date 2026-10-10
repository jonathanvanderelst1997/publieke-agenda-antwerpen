import {dedupeByKey,normalizeIod,normalizeParking,normalizeSgw,publicOnly} from "./public-space-core.js";
import {combineStreetResolutions,resolveAddressStreet,resolveGeometryStreets} from "./street-core.js";
import {pointInGeometry} from "./works-core.js";
import {voerUit,voerUitInStappen} from "./in-stappen.js";
import {parcoursGeometrie} from "./parcours-straten.js";

const attrs=f=>f?.properties||f?.attributes||f||{};
const geom=f=>f?.geometry||null;
const earlier=(a,b)=>!a?(b||""):!b?a:(String(a).localeCompare(String(b))<=0?a:b);
const later=(a,b)=>!a?(b||""):!b?a:(String(a).localeCompare(String(b))>=0?a:b);

function linesOf(g){
  if(!g)return[];
  if(Array.isArray(g.paths))return g.paths;
  if(Array.isArray(g.rings))return g.rings;
  if(g.type==="LineString")return[g.coordinates||[]];
  if(g.type==="MultiLineString"||g.type==="Polygon")return g.coordinates||[];
  if(g.type==="MultiPolygon")return(g.coordinates||[]).flat();
  return[];
}
function pointsOf(g){
  if(!g)return[];
  if(Number.isFinite(g.x)&&Number.isFinite(g.y))return[[g.x,g.y]];
  if(g.type==="Point"&&Array.isArray(g.coordinates))return[g.coordinates];
  return linesOf(g).flat();
}
function bboxOf(g){
  const ps=pointsOf(g).filter(p=>Array.isArray(p)&&Number.isFinite(p[0])&&Number.isFinite(p[1]));
  if(!ps.length)return null;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const[x,y]of ps){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y)}
  return[minX,minY,maxX,maxY];
}
function boxesTouch(a,b){return!!a&&!!b&&a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1]}
function orientation(a,b,c){const v=(b[1]-a[1])*(c[0]-b[0])-(b[0]-a[0])*(c[1]-b[1]);return Math.abs(v)<1e-10?0:v>0?1:2}
function onSegment(a,b,c){return b[0]<=Math.max(a[0],c[0])+1e-10&&b[0]>=Math.min(a[0],c[0])-1e-10&&b[1]<=Math.max(a[1],c[1])+1e-10&&b[1]>=Math.min(a[1],c[1])-1e-10}
function segmentsIntersect(a,b,c,d){const o1=orientation(a,b,c),o2=orientation(a,b,d),o3=orientation(c,d,a),o4=orientation(c,d,b);if(o1!==o2&&o3!==o4)return true;if(o1===0&&onSegment(a,c,b))return true;if(o2===0&&onSegment(a,d,b))return true;if(o3===0&&onSegment(c,a,d))return true;return o4===0&&onSegment(c,b,d)}
function segmentsOf(g){
  const out=[];
  for(const line of linesOf(g)){for(let i=1;i<line.length;i++)out.push([line[i-1],line[i]])}
  return out;
}
function ringContains(point,ring=[]){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[j],b=ring[i];if((a[1]>point[1])!==(b[1]>point[1])){const x=((b[0]-a[0])*(point[1]-a[1]))/(b[1]-a[1])+a[0];if(point[0]<x)inside=!inside}}return inside}
function arcgisPolygonContains(g,point){if(!Array.isArray(g?.rings))return false;let inside=false;for(const ring of g.rings)if(ringContains(point,ring))inside=!inside;return inside}

// De districtsgrens (1.100 punten) één keer voorbereiden: haar kader en haar segmenten met elk hun
// kader. Vroeger gebeurde dat opnieuw voor elk van de duizenden features van een laag.
const GRENS=new WeakMap();
const KADER_MARGE=1e-9; // ruimer dan de marge van segmentsIntersect (1e-10): overslaan blijft exact
const segBox=([a,b])=>[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])];
const apart=(a,b)=>a[0]>b[2]+KADER_MARGE||a[2]<b[0]-KADER_MARGE||a[1]>b[3]+KADER_MARGE||a[3]<b[1]-KADER_MARGE;
function grensVan(district){
  let grens=GRENS.get(district);
  if(!grens){grens={box:bboxOf(district),segmenten:segmentsOf(district).map(s=>({s,box:segBox(s)})),punt:pointsOf(district)[0]||null};GRENS.set(district,grens)}
  return grens;
}
export function geometryIntersectsDistrict(g,district){
  if(!g||!district||typeof district!=="object")return false;
  const grens=grensVan(district),box=bboxOf(g);
  if(!boxesTouch(box,grens.box))return false;
  const sourcePoints=pointsOf(g);
  if(sourcePoints.some(p=>pointInGeometry(p,district)))return true;
  // Alleen grenssegmenten bij het kader van de geometrie kunnen haar snijden.
  const b=grens.segmenten.filter(x=>!apart(x.box,box));
  if(b.length)for(const s1 of segmentsOf(g)){const k=segBox(s1);for(const s2 of b)if(!apart(k,s2.box)&&segmentsIntersect(s1[0],s1[1],s2.s[0],s2.s[1]))return true}
  const districtPoint=grens.punt;
  if(!districtPoint)return false;
  if(Array.isArray(g.rings)&&arcgisPolygonContains(g,districtPoint))return true;
  if((g.type==="Polygon"||g.type==="MultiPolygon")&&pointInGeometry(districtPoint,g))return true;
  return false;
}

// De officiële straatnamen uit een straatindex (voor straatnamen met een cijfer, zie adres-privacy.js).
const namenUit=index=>index?.byName instanceof Map?[...index.byName.values()].flat().map(r=>r?.name).filter(Boolean):null;
// `postcodes`: alleen parkeerverboden met zo'n postcode (de browser geeft die van het district mee;
// A-Sign "District='ANTWERPEN'" is de hele stad). Zonder postcodes: alles, zoals de historiek.
// De onderdelen hieronder zijn generators: na elke feature een `yield`, zodat de browser het werk in
// stappen kan doen (site/in-stappen.js). Het resultaat is hetzelfde als in één keer.
function* parkingItems(features,streetIndex,{postcodes=null,straatnamen=namenUit(streetIndex)}={}){
  const binnen=postcodes?new Set(postcodes):null;
  // Zonder huisnummer delen veel parkeerverboden hetzelfde adres: één opzoeking per adres.
  const perAdres=new Map();
  const straatVan=adres=>{if(!streetIndex)return{streets:[],confidence:"unresolved",distanceMeters:null};if(!perAdres.has(adres))perAdres.set(adres,resolveAddressStreet(adres,streetIndex));return perAdres.get(adres)};
  const out=[];
  for(const n of publicOnly(dedupeByKey(features.map(attrs),r=>normalizeParking(r,{straatnamen})))){
    if(binnen&&n.postcode&&!binnen.has(n.postcode))continue;
    const r=straatVan(n.address);
    out.push({
      id:`parking:${n.key}`,kind:"parking",kindLabel:"Parkeerverbod",title:n.reason||"Tijdelijk parkeerverbod",
      location:n.address,start:n.start,end:n.end,status:n.status,reference:n.dossier,
      detail:n.weekdaysOnly?"Alleen op weekdagen":"",sourceLabel:"A-Sign parkeerverboden",
      // Voor de kaart in gewone taal (place-core.js): de reden zoals de stad ze schrijft, de uren en een
      // GIPOD-id als de stad er een geeft. De historiek (lib/live-history.mjs) bewaart deze velden niet.
      reason:n.reason,postcode:n.postcode,startTime:n.startTime,endTime:n.endTime,weekdaysOnly:n.weekdaysOnly,...(n.gipodId?{gipodId:n.gipodId}:{}),
      sourceUrl:"https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/20",streets:[...r.streets],streetResolution:r.confidence,streetDistanceMeters:r.distanceMeters
    });
    yield;
  }
  return out;
}
function* iodItems(features,district,streetIndex){
  const exact=[],byKey=new Map(),vormen=new Map();
  for(const f of features){if(geometryIntersectsDistrict(geom(f),district))exact.push(f);yield}
  if(streetIndex)for(const f of exact){const n=normalizeIod(attrs(f));if(n.key){const a=byKey.get(n.key)||[];a.push(resolveGeometryStreets(geom(f),streetIndex));byKey.set(n.key,a)}yield}
  // De vorm van elk parcours (vlak uit laag 22, lijn uit laag 23) gaat mee, zodat de browser zelf kan
  // zien welke straten het parcours volgt en welke het alleen kruist (site/parcours-straten.js) als
  // de verversing het dossier nog niet kent. De historiek bewaart dit veld niet.
  for(const f of exact){const n=normalizeIod(attrs(f));if(n.key&&n.type==="Parcours"&&geom(f))vormen.set(n.key,[...(vormen.get(n.key)||[]),f])}
  return publicOnly(dedupeByKey(exact.map(attrs),normalizeIod)).map(n=>({
    id:`iod:${n.key}`,kind:"iod",kindLabel:"Inname openbaar domein",title:n.type||"Inname openbaar domein",
    location:"",start:n.start,end:n.end,status:n.status,reference:n.dossier,
    detail:[n.phase?`Fase ${n.phase}`:"",n.dossierType?`Dossiertype ${n.dossierType}`:"",n.hindrance?`Hinder volgens IOD: ${n.hindrance}`:""].filter(Boolean).join(" · "),
    phase:n.phase,dossierType:n.dossierType,innameType:n.type,hindrance:n.hindrance,description:n.description,
    sourceLabel:"A-Sign IOD",sourceUrl:"https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/22",...(()=>{const r=combineStreetResolutions(byKey.get(n.key)||[]);return{streets:r.streets,streetResolution:r.confidence,streetDistanceMeters:r.distanceMeters}})(),
    ...(vormen.has(n.key)?{parcours:parcoursGeometrie(vormen.get(n.key))}:{})
  }));
}
function* sgwItems(features,district,streetIndex){
  const m=new Map();
  for(const row of features){
    yield;
    const f=row?.feature||row;if(!geometryIntersectsDistrict(geom(f),district))continue;
    const n=normalizeSgw(attrs(f));if(!n.key||!n.publicConfirmed)continue;
    const cur=m.get(n.key)||{...n,kinds:new Set(),streetResolutions:[],perSoort:{}};
    const soort=row?.kind||"Maatregel";
    cur.kinds.add(soort);if(streetIndex){const r=resolveGeometryStreets(geom(f),streetIndex);cur.streetResolutions.push(r);(cur.perSoort[soort]=cur.perSoort[soort]||[]).push(r)}cur.start=earlier(cur.start,n.start);cur.end=later(cur.end,n.end);m.set(n.key,cur);
  }
  return[...m.values()].map(n=>({
    id:`sgw:${n.key}`,kind:"sgw",kindLabel:[...n.kinds].sort().join(" + "),title:[...n.kinds].sort().join(" + "),
    location:"",start:n.start,end:n.end,status:n.status,reference:n.reference,detail:n.phase?"Fase "+n.phase:"",
    sourceLabel:"A-Sign SGW",sourceUrl:"https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/48",...(()=>{const r=combineStreetResolutions(n.streetResolutions||[]);return{streets:r.streets,streetResolution:r.confidence,streetDistanceMeters:r.distanceMeters}})(),
    // Apart: de straten van de werfzone zelf en die van de omleiding. Een straat op de omleiding is
    // geen straat met een werfzone (place-core.js zegt dat aan de bewoner).
    werfzoneStreets:combineStreetResolutions(n.perSoort.Werfzone||[]).streets,omleidingStreets:combineStreetResolutions(n.perSoort.Omleiding||[]).streets
  }));
}
const stamp=v=>{const t=Date.parse(v||"");return Number.isFinite(t)?t:Infinity};
function* verzamel({parkingFeatures=[],iodFeatures=[],sgwFeatures=[],districtGeometry=null,streetIndex=null,postcodes=null,straatnamen=undefined}={}){
  const items=[...(yield* parkingItems(parkingFeatures,streetIndex,{postcodes,...(straatnamen===undefined?{}:{straatnamen})}))];
  if(districtGeometry){items.push(...(yield* iodItems(iodFeatures,districtGeometry,streetIndex)),...(yield* sgwItems(sgwFeatures,districtGeometry,streetIndex)))}
  return items.sort((a,b)=>stamp(a.start)-stamp(b.start)||a.kindLabel.localeCompare(b.kindLabel,"nl")||a.title.localeCompare(b.title,"nl"));
}
export function collectPublicSpace(opties={}){return voerUit(verzamel(opties))}
// In de browser: hetzelfde resultaat, maar in stappen van ongeveer 40 ms (geen lange blokkade op een gsm).
export function collectPublicSpaceInStappen(opties={},stappen={}){return voerUitInStappen(verzamel(opties),stappen)}
export function publicSpaceStats(items=[]){
  const s={total:items.length,parking:0,iod:0,sgw:0};
  for(const i of items)if(Object.hasOwn(s,i.kind))s[i.kind]++;
  return s;
}
