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
