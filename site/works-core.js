export function normalizeText(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
function pointOnSegment(point,a,b,e=1e-10){const[px,py]=point,[ax,ay]=a,[bx,by]=b;const c=(bx-ax)*(py-ay)-(by-ay)*(px-ax);if(Math.abs(c)>e)return false;return px>=Math.min(ax,bx)-e&&px<=Math.max(ax,bx)+e&&py>=Math.min(ay,by)-e&&py<=Math.max(ay,by)+e}
function pointInRing(point,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[j],b=ring[i];if(pointOnSegment(point,a,b))return true;if((a[1]>point[1])!==(b[1]>point[1])){const x=((b[0]-a[0])*(point[1]-a[1]))/(b[1]-a[1])+a[0];if(point[0]<x)inside=!inside}}return inside}
function pointInPolygon(point,rings=[]){if(!rings.length||!pointInRing(point,rings[0]))return false;return !rings.slice(1).some(h=>pointInRing(point,h))}
export function pointInGeometry(point,geometry){if(!Array.isArray(point)||point.length<2)return false;if(geometry?.type==="Polygon")return pointInPolygon(point,geometry.coordinates);if(geometry?.type==="MultiPolygon")return geometry.coordinates.some(p=>pointInPolygon(point,p));return false}
export function ownerGroup(owner=""){const t=normalizeText(owner).toLowerCase();if(t.includes("fluvius"))return"Fluvius";if(t.includes("proximus"))return"Proximus";if(t.includes("water-link")||t.includes("water link"))return"water-link";if(t.includes("aquafin")||t.includes("riolink"))return"Aquafin / Rio-link";if(t.includes("de lijn")||t.includes("vervoermaatschappij"))return"De Lijn";if(t.includes("wegen en verkeer")||t.includes("awv")||t.includes("lantis"))return"AWV / Lantis";if(t.includes("stad antwerpen")||t.includes("vespa"))return"Stad Antwerpen";if(t.includes("wyre")||t.includes("telenet")||t.includes("eurofiber"))return"Telecom / kabel";if(t.includes("haven"))return"Haven";return owner?"Andere":"Onbekend"}
const earlier=(a,b)=>!a?(b||""):!b?a:(String(a).localeCompare(String(b))<=0?a:b);
const later=(a,b)=>!a?(b||""):!b?a:(String(a).localeCompare(String(b))>=0?a:b);
export function collectWorks(features=[],exactIds=new Set(),districtGeometry=null){
  const grouped=new Map();
  for(const feature of features){
    const point=feature?.geometry?.coordinates;if(feature?.geometry?.type!=="Point"||!Array.isArray(point)||!point.slice(0,2).every(Number.isFinite))continue;
    const p=feature.properties||{},gipodId=Number(p.GipodId);if(!Number.isFinite(gipodId))continue;
    const exact=exactIds.has(gipodId),inside=districtGeometry?pointInGeometry(point,districtGeometry):false;if(!exact&&!inside)continue;
    const cur=grouped.get(gipodId)||{gipodId,title:normalizeText(p.Description)||"Werk in openbaar domein",owner:normalizeText(p.Owner),ownerGroup:ownerGroup(p.Owner),status:normalizeText(p.Status)||"Onbekend",start:p.Start||"",end:p.End||"",workTypes:new Set(),occupancyTypes:new Set(),sourceUrls:new Set(),lastModified:p.LastModifiedOn||"",point:point.slice(0,2),recordCount:0,boundaryConfidence:exact?"exact_snapshot":"point_inside_new"};
    cur.recordCount+=1;cur.start=earlier(cur.start,p.Start||"");cur.end=later(cur.end,p.End||"");cur.lastModified=later(cur.lastModified,p.LastModifiedOn||"");if(p.Status==="In uitvoering")cur.status="In uitvoering";if(p.PublicDomainOccupancyTypes)cur.occupancyTypes.add(normalizeText(p.PublicDomainOccupancyTypes));if(p.GroundworkSpecification)cur.workTypes.add(normalizeText(p.GroundworkSpecification));if(typeof p.Uri==="string"&&/^https:\/\/gipod\.api\.vlaanderen\.be\//i.test(p.Uri))cur.sourceUrls.add(p.Uri);if(exact)cur.boundaryConfidence="exact_snapshot";grouped.set(gipodId,cur);
  }
  return [...grouped.values()].map(i=>({...i,workTypes:[...i.workTypes],occupancyTypes:[...i.occupancyTypes],sourceUrls:[...i.sourceUrls]})).sort((a,b)=>(a.status==="In uitvoering"?0:1)-(b.status==="In uitvoering"?0:1)||String(a.start||"9999").localeCompare(String(b.start||"9999"))||a.title.localeCompare(b.title,"nl"));
}
export function worksStats(items=[]){const s={total:items.length,running:0,planned:0,exactSnapshot:0,newPointInside:0,owners:{}};for(const i of items){if(i.status==="In uitvoering")s.running++;if(i.status==="Concreet gepland")s.planned++;if(i.boundaryConfidence==="exact_snapshot")s.exactSnapshot++;if(i.boundaryConfidence==="point_inside_new")s.newPointInside++;s.owners[i.ownerGroup]=(s.owners[i.ownerGroup]||0)+1}return s}
