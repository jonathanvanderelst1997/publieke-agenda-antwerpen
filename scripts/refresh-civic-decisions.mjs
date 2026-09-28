import {classifyCivicDecisionTitle,normalizeDecisionTitle} from "../lib/civic-decision.mjs";
const BASE="https://ebesluit.antwerpen.be";
const UA="Mozilla/5.0";
const keywords=["speelstraat","kermis","foor","markt"];
const year=Number(process.argv[2]||new Date().getFullYear());
const start=`${year}-01-01`,end=`${year}-12-31`;

async function get(path){
  const response=await fetch(BASE+path,{redirect:"error",signal:AbortSignal.timeout(30000),headers:{"User-Agent":UA,Referer:BASE+"/",Accept:"text/html"}});
  if(!response.ok)throw new Error(`eBesluit HTTP ${response.status}`);
  return response.text();
}
function rowsFromSearch(html){
  return[...html.matchAll(/<a[^>]*class="[^"]*result-row[^"]*"[^>]*>/g)].map((m)=>{
    const attrs=Object.fromEntries([...m[0].matchAll(/data-([\w-]+)="([^"]*)"/g)].map((x)=>[x[1],x[2]]));
    return attrs.id&&attrs["meeting-id"]?{id:attrs.id,meetingId:attrs["meeting-id"],published:attrs["content-published"]==="true"}:null;
  }).filter(Boolean);
}
function textFromHtml(html){
  return html.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&#39;/g,"'").replace(/\s+/g," ").trim();
}
function decisionFromText(text){
  const match=text.match(/Besluit (20\d\d_[A-Z]{2,6}_\d+) - ([\s\S]*?) (?:college van burgemeester en schepenen|gemeenteraad|districtscollege|districtsraad)/i);
  if(!match)return null;
  const code=match[1],title=normalizeDecisionTitle(match[2]),classification=classifyCivicDecisionTitle(title);
  return{code,title,...classification};
}
const candidates=new Map();
for(const keyword of keywords){
  const query=new URLSearchParams({query:keyword,meetingDateStart:start,meetingDateEnd:end,page:"0",pageSize:"50"});
  const searchHtml=await get("/zoeken?"+query);
  for(const row of rowsFromSearch(searchHtml)){
    if(!row.published)continue;
    const path=`/zittingen/${row.meetingId}/agendapunten/${row.id}`;
    try{
      const detail=decisionFromText(textFromHtml(await get(path)));
      if(!detail)continue;
      candidates.set(detail.code,{...detail,url:BASE+path,meetingId:row.meetingId,agendaItemId:row.id});
    }catch(error){
      console.error(`skip ${path}: ${error.message}`);
    }
  }
}
const result=[...candidates.values()].sort((a,b)=>a.code.localeCompare(b.code));
process.stdout.write(JSON.stringify({schemaVersion:1,year,generatedAt:new Date().toISOString(),count:result.length,publishCandidates:result.filter((x)=>x.publishCandidate),allClassified:result},null,2));
