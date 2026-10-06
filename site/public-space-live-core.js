import {dedupeByKey,normalizeIod,normalizeParking,normalizeSgw,publicOnly} from "./public-space-core.js";
import {combineStreetResolutions,resolveAddressStreet,resolveGeometryStreets} from "./street-core.js";
import {pointInGeometry} from "./works-core.js";

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

export function geometryIntersectsDistrict(g,district){
  if(!g||!district||!boxesTouch(bboxOf(g),bboxOf(district)))return false;
  const sourcePoints=pointsOf(g);
  if(sourcePoints.some(p=>pointInGeometry(p,district)))return true;
  const a=segmentsOf(g),b=segmentsOf(district);
  for(const s1 of a)for(const s2 of b)if(segmentsIntersect(s1[0],s1[1],s2[0],s2[1]))return true;
  const districtPoint=pointsOf(district)[0];
  if(!districtPoint)return false;
  if(Array.isArray(g.rings)&&arcgisPolygonContains(g,districtPoint))return true;
  if((g.type==="Polygon"||g.type==="MultiPolygon")&&pointInGeometry(districtPoint,g))return true;
  return false;
}

function parkingItems(features,streetIndex){
  return publicOnly(dedupeByKey(features.map(attrs),normalizeParking)).map(n=>({
    id:`parking:${n.key}`,kind:"parking",kindLabel:"Parkeerverbod",title:n.reason||"Tijdelijk parkeerverbod",
    location:n.address,start:n.start,end:n.end,status:n.status,reference:n.dossier,
    detail:n.weekdaysOnly?"Alleen op weekdagen":"",sourceLabel:"A-Sign parkeerverboden",
    sourceUrl:"https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/20",...(()=>{const r=streetIndex?resolveAddressStreet(n.address,streetIndex):{streets:[],confidence:"unresolved",distanceMeters:null};return{streets:r.streets,streetResolution:r.confidence,streetDistanceMeters:r.distanceMeters}})()
  }));
}
function iodItems(features,district,streetIndex){
  const exact=features.filter(f=>geometryIntersectsDistrict(geom(f),district)),byKey=new Map();if(streetIndex)for(const f of exact){const n=normalizeIod(attrs(f));if(n.key){const a=byKey.get(n.key)||[];a.push(resolveGeometryStreets(geom(f),streetIndex));byKey.set(n.key,a)}}
  return publicOnly(dedupeByKey(exact.map(attrs),normalizeIod)).map(n=>({
    id:`iod:${n.key}`,kind:"iod",kindLabel:"Inname openbaar domein",title:n.type||"Inname openbaar domein",
    location:"",start:n.start,end:n.end,status:n.status,reference:n.dossier,
    detail:[n.phase?`Fase ${n.phase}`:"",n.dossierType?`Dossiertype ${n.dossierType}`:"",n.hindrance?`Hinder volgens IOD: ${n.hindrance}`:""].filter(Boolean).join(" · "),
    phase:n.phase,dossierType:n.dossierType,innameType:n.type,hindrance:n.hindrance,description:n.description,
    sourceLabel:"A-Sign IOD",sourceUrl:"https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/22",...(()=>{const r=combineStreetResolutions(byKey.get(n.key)||[]);return{streets:r.streets,streetResolution:r.confidence,streetDistanceMeters:r.distanceMeters}})()
  }));
}
function sgwItems(features,district,streetIndex){
  const m=new Map();
  for(const row of features){
    const f=row?.feature||row;if(!geometryIntersectsDistrict(geom(f),district))continue;
    const n=normalizeSgw(attrs(f));if(!n.key||!n.publicConfirmed)continue;
    const cur=m.get(n.key)||{...n,kinds:new Set(),streetResolutions:[]};
    cur.kinds.add(row?.kind||"Maatregel");if(streetIndex)cur.streetResolutions.push(resolveGeometryStreets(geom(f),streetIndex));cur.start=earlier(cur.start,n.start);cur.end=later(cur.end,n.end);m.set(n.key,cur);
  }
  return[...m.values()].map(n=>({
    id:`sgw:${n.key}`,kind:"sgw",kindLabel:[...n.kinds].sort().join(" + "),title:[...n.kinds].sort().join(" + "),
    location:"",start:n.start,end:n.end,status:n.status,reference:n.reference,detail:n.phase?"Fase "+n.phase:"",
    sourceLabel:"A-Sign SGW",sourceUrl:"https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/48",...(()=>{const r=combineStreetResolutions(n.streetResolutions||[]);return{streets:r.streets,streetResolution:r.confidence,streetDistanceMeters:r.distanceMeters}})()
  }));
}
const stamp=v=>{const t=Date.parse(v||"");return Number.isFinite(t)?t:Infinity};
export function collectPublicSpace({parkingFeatures=[],iodFeatures=[],sgwFeatures=[],districtGeometry=null,streetIndex=null}={}){
  const items=[...parkingItems(parkingFeatures,streetIndex)];
  if(districtGeometry){items.push(...iodItems(iodFeatures,districtGeometry,streetIndex),...sgwItems(sgwFeatures,districtGeometry,streetIndex))}
  return items.sort((a,b)=>stamp(a.start)-stamp(b.start)||a.kindLabel.localeCompare(b.kindLabel,"nl")||a.title.localeCompare(b.title,"nl"));
}
export function publicSpaceStats(items=[]){
  const s={total:items.length,parking:0,iod:0,sgw:0};
  for(const i of items)if(Object.hasOwn(s,i.kind))s[i.kind]++;
  return s;
}
