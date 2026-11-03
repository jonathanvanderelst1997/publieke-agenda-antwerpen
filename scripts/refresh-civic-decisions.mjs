import {civicCalendarFromDecision,classifyCivicDecisionTitle,extractPdfAttachments,normalizeDecisionTitle} from "../lib/civic-decision.mjs";
import {EBESLUIT_PAGE_SIZE,ebesluitZoekUrl,resultCountFromSearch} from "../lib/ebesluit-discovery.mjs";
const BASE="https://ebesluit.antwerpen.be";
const UA="Mozilla/5.0";
const keywords=["speelstraat","kermis","foor","markt"];
const year=Number(process.argv[2]||new Date().getFullYear());
// Pagina's van 500 (zoals lib/ebesluit-discovery.mjs) en altijd sections=OTHER (ebesluitZoekUrl): zonder die
// parameter negeert eBesluit sinds 26-10-2026 het venster op zittingsdatum.
const start=`${year}-01-01`,end=`${year}-12-31`,PAGE_SIZE=EBESLUIT_PAGE_SIZE,MAX_PAGES=20;

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
async function searchRows(keyword){
  const all=new Map();let complete=false,pages=0,total0=null;
  for(let page=0;page<MAX_PAGES;page++){
    const zoek=new URL(ebesluitZoekUrl({query:keyword,start,end,page,pageSize:PAGE_SIZE}));
    const html=await get(zoek.pathname+zoek.search);pages++;
    const total=page===0?resultCountFromSearch(html):total0;if(page===0)total0=total;
    const rows=rowsFromSearch(html);
    if(!rows.length){complete=total===null||all.size===total;break}
    const before=all.size;
    for(const row of rows)all.set(row.meetingId+"|"+row.id,row);
    // De volgorde kan per vraag verschillen: volledig alleen als het aantal unieke rijen het gemelde aantal haalt.
    if(total!==null&&all.size>=total){complete=all.size===total;break}
    if(total===null&&rows.length<PAGE_SIZE){complete=true;break}
    if(all.size===before)break;
  }
  return{rows:[...all.values()],coverage:{keyword,pages,resultCount:all.size,complete}};
}
const candidates=new Map(),coverage=[],calendarItems=[],exceptions=[];
for(const keyword of keywords){
  const searched=await searchRows(keyword);coverage.push(searched.coverage);
  for(const row of searched.rows){
    if(!row.published)continue;
    const path=`/zittingen/${row.meetingId}/agendapunten/${row.id}`;
    try{
      const html=await get(path),text=textFromHtml(html),detail=decisionFromText(text);
      if(!detail)continue;
      const attachments=extractPdfAttachments(html,BASE);
      const sourceUrl=BASE+path;
      const calendar=civicCalendarFromDecision({...detail,text,url:sourceUrl});
      calendarItems.push(...calendar.calendarItems);exceptions.push(...calendar.exceptions);
      candidates.set(detail.code,{
        ...detail,
        url:sourceUrl,
        meetingId:row.meetingId,
        agendaItemId:row.id,
        attachments,
        districtAntwerpen:calendar.calendarItems.length>0||calendar.exceptions.length>0,
        attachmentNeeded:detail.category==="play_street_approval"&&attachments.length>0
      });
    }catch(error){console.error(`skip ${path}: ${error.message}`)}
  }
}
const result=[...candidates.values()].sort((a,b)=>a.code.localeCompare(b.code));
const dedupe=(rows,key)=>[...new Map(rows.map(x=>[key(x),x])).values()];
const publicCalendar=dedupe(calendarItems,x=>[x.category,x.location,x.start,x.end,x.decisionCode].join("|")).sort((a,b)=>a.start.localeCompare(b.start)||a.location.localeCompare(b.location,"nl"));
const publicExceptions=dedupe(exceptions,x=>[x.category,x.location,x.date,x.decisionCode].join("|")).sort((a,b)=>a.date.localeCompare(b.date)||a.location.localeCompare(b.location,"nl"));
process.stdout.write(JSON.stringify({schemaVersion:2,year,generatedAt:new Date().toISOString(),coverage,count:result.length,publishCandidates:result.filter(x=>x.publishCandidate),calendarItems:publicCalendar,exceptions:publicExceptions,allClassified:result},null,2));
