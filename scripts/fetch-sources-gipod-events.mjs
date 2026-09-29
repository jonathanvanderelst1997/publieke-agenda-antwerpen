import path from "node:path";
import { fileURLToPath } from "node:url";
import { eventsFromGipod,gipodEventQueryUrl } from "../lib/gipod-events.mjs";
import { FetchError,USER_AGENT,errorCodeOf,fetchWithTimeout,isMainModule,keepPreviousOnError,readSourceDocument,screenItems,statusEntry,writeSourceDocument } from "../lib/fetch-util.mjs";
import { brusselsDate } from "../lib/html-text.mjs";
import { sourceDocument } from "../lib/source-feed.mjs";
export const SOURCE_ID="district-gipod-evenementen";
async function getPage(fetchImpl,url){
  const response=await fetchWithTimeout(fetchImpl,url,{headers:{"user-agent":USER_AGENT,accept:"application/geo+json, application/json"},redirect:"error"});
  if(!response.ok)throw new FetchError(`http_${response.status}`);
  let json;try{json=await response.json()}catch{throw new FetchError("invalid_json")}
  if(json?.type!=="FeatureCollection"||!Array.isArray(json.features))throw new FetchError("invalid_payload");
  return json;
}
async function getJson(fetchImpl,initialUrl){
  const start=new URL(initialUrl),features=[],seen=new Set();
  let url=start.href;
  for(let page=0;page<20&&url;page+=1){
    const current=new URL(url);
    if(current.origin!==start.origin||current.pathname!==start.pathname||seen.has(url))throw new FetchError("unexpected_pagination");
    seen.add(url);
    const json=await getPage(fetchImpl,url);
    features.push(...json.features);
    const next=(json.links||[]).filter(link=>link?.rel==="next"&&link?.href);
    if(next.length>1)throw new FetchError("duplicate_next");
    url=next[0]?.href||"";
  }
  if(url)throw new FetchError("pagination_limit");
  return{type:"FeatureCollection",features,links:[]};
}
export async function run({fetch:fetchImpl=globalThis.fetch,clock=()=>new Date(),rootDir,dryRun=false,log=console.log}={}){
  const previous=readSourceDocument(rootDir,SOURCE_ID),now=clock(),retrievedAt=now.toISOString(),today=brusselsDate(now);
  let geojson;
  try{geojson=await getJson(fetchImpl,gipodEventQueryUrl(now))}
  catch(error){const code=errorCodeOf(error);log(JSON.stringify({source:SOURCE_ID,fetchStatus:"error",errorCode:code}));return[keepPreviousOnError(rootDir,SOURCE_ID,previous,code,{dryRun})]}
  const parsed=eventsFromGipod(geojson,{now});geojson=null;
  const screened=screenItems(parsed.items.map(item=>({...item,retrievedAt})));
  const counts={source:SOURCE_ID,rows:parsed.counts.rows,events:parsed.counts.events,rejected:parsed.counts.rejected,items:screened.items.length,screenedOut:screened.rejected.privacy+screened.rejected.contract+screened.rejected.duplicate};
  if(dryRun){log(JSON.stringify({dryRun:true,...counts}));return[statusEntry(SOURCE_ID,{fetchStatus:"ok",retrievedAt,itemCount:screened.items.length})]}
  const document=writeSourceDocument(rootDir,SOURCE_ID,sourceDocument(SOURCE_ID,{retrievedAt,fetchStatus:"ok",contentVersion:`gipod-events-v1|${today}`,items:screened.items}));
  log(JSON.stringify({...counts,written:document.items.length}));
  return[statusEntry(SOURCE_ID,{fetchStatus:"ok",retrievedAt,itemCount:document.items.length})];
}
if(isMainModule(import.meta.url)){const rootDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");run({rootDir,dryRun:process.argv.includes("--dry-run")}).catch(error=>{console.error(JSON.stringify({source:SOURCE_ID,fatal:errorCodeOf(error)}));process.exitCode=1})}
