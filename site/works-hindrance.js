import {pointInGeometry} from "./works-core.js";
const clean=value=>String(value??"").replace(/\s+/g," ").trim();
const earlier=(a,b)=>!a?(b||""):!b?a:(String(a).localeCompare(String(b))<=0?a:b);
const later=(a,b)=>!a?(b||""):!b?a:(String(a).localeCompare(String(b))>=0?a:b);
export function causingGipodIds(value=""){
  const ids=new Set();
  for(const part of String(value||"").split(";")){
    const match=part.trim().match(/\/(?:works|groundworks|events|public-domain-occupancies)\/(\d+)(?:[/?#]|$)/i);
    if(match)ids.add(Number(match[1]));
  }
  return[...ids].filter(Number.isFinite);
}
export function collectHindrance(features=[]){
  const byWork=new Map();
  for(const feature of features){
    const p=feature?.properties||{};
    if(clean(p.HindranceStatus)!=="Gevalideerd")continue;
    const ids=causingGipodIds(p.HindranceConsequenceOf);
    if(!ids.length)continue;
    const consequences=String(p.Consequences||"").split(";").map(clean).filter(Boolean);
    for(const gipodId of ids){
      const current=byWork.get(gipodId)||{gipodId,severe:false,consequences:new Set(),start:"",end:"",hindranceIds:new Set(),sourceUrls:new Set(),phases:new Map()};
      current.severe=current.severe||p.SevereHindrance===true;
      for(const consequence of consequences)current.consequences.add(consequence);
      current.start=earlier(current.start,p.HindranceStart||"");
      current.end=later(current.end,p.HindranceEnd||"");
      const hindranceId=Number(p.HindranceGipodId);
      if(Number.isFinite(hindranceId))current.hindranceIds.add(hindranceId);
      if(typeof p.HindranceURI==="string"&&/^https:\/\/gipod\.api\.vlaanderen\.be\//i.test(p.HindranceURI))current.sourceUrls.add(p.HindranceURI);
      // De omschrijving van een hinderfase ("Fase 2: instandhouding stelling") zegt vaak wát er gebeurt.
      const description=clean(p.HindranceDescription).slice(0,160);
      if(description){const key=`${description}|${p.HindranceStart||""}|${p.HindranceEnd||""}`;const phase=current.phases.get(key)||{description,start:p.HindranceStart||"",end:p.HindranceEnd||"",consequences:new Set()};for(const consequence of consequences)phase.consequences.add(consequence);current.phases.set(key,phase)}
      byWork.set(gipodId,current);
    }
  }
  return new Map([...byWork].map(([id,item])=>[id,{...item,consequences:[...item.consequences].sort((a,b)=>a.localeCompare(b,"nl")),hindranceIds:[...item.hindranceIds],sourceUrls:[...item.sourceUrls],phases:[...item.phases.values()].map(phase=>({...phase,consequences:[...phase.consequences].sort((a,b)=>a.localeCompare(b,"nl"))})).sort((a,b)=>String(a.start).localeCompare(String(b.start))||a.description.localeCompare(b.description,"nl"))}]));
}
export function attachHindrance(items=[],features=[],sourceLoaded=true){
  const byWork=collectHindrance(features);
  return items.map(item=>({...item,hindrance:byWork.get(Number(item.gipodId))||null,hindranceSourceLoaded:sourceLoaded}));
}

// ---------- losse hinder: gevalideerde hinder zonder gepubliceerd werk ----------
// GIPOD publiceert soms gevalideerde hinder waarvan het werk zelf niet in de open laag INNAME_PUNT staat
// (meting 17 oktober 2026: 64 hinderberichten in het district, 43 oorzaken die nergens in de open laag staan).
// Die hinder hangt dan aan geen enkel getoond werk. losseHinder maakt er een apart, duidelijk benoemd blok van,
// alleen uit de HINDER_PUNT-features die de werkenlaag al ophaalt: geen nieuwe vraag.

// De oorzaken van een hinder met hun soort: [{ soort: "works" | "groundworks" | "events" | …, id }].
export function oorzakenVan(value=""){
  const uit=[];
  for(const part of String(value||"").split(";")){
    const match=part.trim().match(/\/([a-z-]+)\/(\d+)(?:[/?#]|$)/i);
    if(match)uit.push({soort:match[1].toLowerCase(),id:Number(match[2])});
  }
  return uit.filter(o=>Number.isSafeInteger(o.id)&&o.id>0);
}
// Een vaste bronlink per hinder: de features hebben een id met een tijdstempel, dus filteren op HindranceGipodId.
export const hinderBronUrl=id=>`https://geo.api.vlaanderen.be/GIPOD/ogc/features/v1/collections/HINDER_PUNT/items?f=json&filter-lang=cql2-text&filter=HindranceGipodId%3D${Number(id)}`;
const WERK_OORZAAK=Object.freeze({works:"werk",groundworks:"grondwerk"});
const DAG_MS=86400000;
// Rotte records: een einde meer dan 2 jaar na vandaag, of een hinder die al loopt en meer dan 12 maanden niet meer gewijzigd is.
export const MAX_VOORUIT_DAGEN=730,MAX_STIL_DAGEN=365;

// features: HINDER_PUNT (gevalideerd). getoond: GIPOD-id's van de getoonde werken. inRespons: alle GipodId's in
// het INNAME_PUNT-antwoord (ook wat niet getoond wordt, bijvoorbeeld buiten de grens). district: de officiële
// grens; zonder grens null (faalt gesloten: dan geen blok). Eén item per HindranceGipodId (de zones samen):
// de gevolgen samen, ernstig als één zone ernstig is, de vroegste start en het laatste einde, en het eerste
// zonepunt binnen de grens. Weg: buiten de grens, voorbij, een oorzaak die geen werk of grondwerk is
// (evenement, markt), een oorzaak die al getoond wordt of in de open laag staat, zonder gevolgen en niet
// ernstig, en rotte records. Nooit HindranceDescription, HindranceOwner, contactorganisaties of HindranceURI.
export function losseHinder(features=[],{getoond=new Set(),inRespons=new Set(),district=null,nu=new Date()}={}){
  if(!district)return null;
  const nuMs=nu instanceof Date?nu.getTime():Date.parse(nu);
  if(!Number.isFinite(nuMs))return null;
  const perHinder=new Map();
  for(const feature of Array.isArray(features)?features:[]){
    const p=feature?.properties||{};
    if(clean(p.HindranceStatus)!=="Gevalideerd")continue;
    const id=Number(p.HindranceGipodId);
    if(!Number.isSafeInteger(id)||id<=0)continue;
    const cur=perHinder.get(id)||{hindranceGipodId:id,severe:false,consequences:new Set(),start:"",end:"",zoneTypes:new Set(),oorzaken:new Map(),point:null,lastModified:""};
    cur.severe=cur.severe||p.SevereHindrance===true;
    for(const c of String(p.Consequences||"").split(";").map(clean).filter(Boolean))cur.consequences.add(c);
    cur.start=earlier(cur.start,p.HindranceStart||"");
    cur.end=later(cur.end,p.HindranceEnd||"");
    if(clean(p.ZoneType))cur.zoneTypes.add(clean(p.ZoneType).slice(0,40));
    for(const o of oorzakenVan(p.HindranceConsequenceOf))cur.oorzaken.set(o.id,o.soort);
    cur.lastModified=later(cur.lastModified,p.HindranceLastModifiedOn||"");
    const punt=feature?.geometry?.type==="Point"&&Array.isArray(feature.geometry.coordinates)?feature.geometry.coordinates.slice(0,2):null;
    if(!cur.point&&punt&&punt.every(Number.isFinite)&&pointInGeometry(punt,district))cur.point=punt;
    perHinder.set(id,cur);
  }
  const uit=[];
  for(const h of perHinder.values()){
    const start=Date.parse(h.start),end=Date.parse(h.end),gewijzigd=Date.parse(h.lastModified);
    if(!h.point||!Number.isFinite(end)||end<nuMs)continue;
    const oorzaken=[...h.oorzaken];
    if(!oorzaken.length||oorzaken.some(([,soort])=>!WERK_OORZAAK[soort]))continue;
    if(oorzaken.some(([oid])=>getoond.has(oid)||inRespons.has(oid)))continue;
    if(!h.consequences.size&&!h.severe)continue;
    if(end>nuMs+MAX_VOORUIT_DAGEN*DAG_MS)continue;
    if(Number.isFinite(start)&&start<=nuMs&&Number.isFinite(gewijzigd)&&gewijzigd<nuMs-MAX_STIL_DAGEN*DAG_MS)continue;
    uit.push({
      hindranceGipodId:h.hindranceGipodId,
      severe:h.severe,
      consequences:[...h.consequences].sort((a,b)=>a.localeCompare(b,"nl")),
      start:h.start,
      end:h.end,
      zoneTypes:[...h.zoneTypes].sort(),
      oorzaak:[...new Set(oorzaken.map(([,soort])=>WERK_OORZAAK[soort]))].sort().join(" en "),
      point:h.point,
      bronUrl:hinderBronUrl(h.hindranceGipodId),
    });
  }
  return uit.sort((a,b)=>String(a.start).localeCompare(String(b.start))||a.hindranceGipodId-b.hindranceGipodId);
}
