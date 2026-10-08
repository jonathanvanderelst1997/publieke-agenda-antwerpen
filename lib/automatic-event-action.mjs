// Officiële eventpagina's worden bij een nieuwe bronverversing opnieuw nagekeken.
// Alleen datum, actiecode en actietype; nooit HTML, ruwe e-mail of ticket-URL opslaan.
import {decodeEntities,stripTags} from "./html-text.mjs";
import {fetchWithTimeout} from "./fetch-util.mjs";
const hosts=new Set(["www.antwerpen.be","nova.antwerpen.be"]);
const months=["januari","februari","maart","april","mei","juni","juli","augustus","september","oktober","november","december"];
const norm=x=>String(x||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
const plain=s=>stripTags(String(s||"").replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi," "));
function cityUrl(s){try{const u=new URL(String(s||""));return u.protocol==="https:"&&hosts.has(u.hostname)&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname.split("/").filter(Boolean).length>=2?u.href:""}catch{return ""}}
export function eventAction(html,item){
 const s=plain(html);
 const title=norm(item.title),parts=/^(\d{4})-(\d{2})-(\d{2})$/.exec(item.date||"");
 if(!parts||title.length<8||!norm(s).includes(title))return {checked:false};
 const [ ,year,mon,day]=parts;
 const validDate=norm(s).includes(String(+day)+" "+months[+mon-1])||s.includes(item.date)
  ||new RegExp("(?:^|\\D)"+day+"[./-]"+mon+"[./-]"+year+"(?:\\D|$)").test(s);
 if(!validDate)return {checked:false};
 const code="CID-STA-"+year+mon+day;
 for(const a of String(html).matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)){
  let u;try{u=new URL(decodeEntities(a[2]),item.infoUrl)}catch{continue}
  if(u.hostname==="cid.recreatex.be"&&u.protocol==="https:"&&u.pathname.toLowerCase()==="/tickets/detail.aspx"
    &&norm(plain(a[3])).includes("ticket")&&u.searchParams.get("code")===code)
    return {checked:true,kind:"ticket",code};
 }
 if(/inschrijv|aanmeld/i.test(s)&&/district\.antwerpen@antwerpen\.be/i.test(s)
  &&/(?:via|per) (?:de )?(?:e-?mail|mail)|mail aan/i.test(s))return {checked:true,kind:"email_district"};
 if(/tickets?[^.!?]{0,150}(?:aan|bij) (?:de )?infostand/i.test(s))return {checked:true,kind:"onsite"};
 if(/\bgeen (?:online )?tickets? nodig\b/i.test(s))return {checked:true,kind:"no_ticket"};
 return {checked:true};
}
async function fetchOfficial(url,fetchImpl){
 let target=url;
 for(let n=0;n<3;n++){
  const r=await fetchWithTimeout(fetchImpl,target,{headers:{accept:"text/html"},redirect:"manual"},6500);
  if([301,302,303,307,308].includes(r.status)){
   const next=r.headers?.get?.("location");if(!next)return "";
   target=cityUrl(new URL(next,target).href);if(!target)return "";continue;
  }
  if(!r.ok||Number(r.headers?.get?.("content-length")||0)>1000000)return "";
  if(!/text\/html|text\/plain/.test(r.headers?.get?.("content-type")||"text/html"))return "";
  const html=await r.text();return html.length<=1000000?html:"";
 }
 return "";
}
export async function enrichActions(items=[],{fetchImpl=globalThis.fetch,limit=12,log=()=>{}}={}){
 const urls=new Map();
 for(const item of items){const u=cityUrl(item.infoUrl);if(u){if(!urls.has(u))urls.set(u,[]);urls.get(u).push(item)}}
 const selected=[...urls].sort((a,b)=>a[1][0].date.localeCompare(b[1][0].date)).slice(0,Math.max(0,Math.min(12,limit)));
 const attempted=new Set([...urls.values()].flatMap(events=>events.map(e=>e.id)));
 const checks=new Map(),summary={pages:selected.length,checked:0,ticket:0,email:0,onsite:0};
 for(const [url,group] of selected){
  let html="";try{html=await fetchOfficial(url,fetchImpl)}catch{continue}
  if(!html)continue;
  for(const item of group){const a=eventAction(html,item);if(a.checked){checks.set(item.id,a);summary.checked++;if(a.kind==="ticket")summary.ticket++;if(a.kind==="email_district")summary.email++;if(a.kind==="onsite")summary.onsite++}}
 }
 log(JSON.stringify({autoEventVerification:summary}));
 return items.map(item=>{const {actionAttempted,actionChecked,actionKind,actionCode,...original}=item,a=checks.get(item.id);
  const safe=attempted.has(item.id)?{...original,actionAttempted:true}:original;
  return a?{...safe,actionChecked:true,...(a.kind?{actionKind:a.kind}:{}),...(a.code?{actionCode:a.code}:{})}:safe});
}
