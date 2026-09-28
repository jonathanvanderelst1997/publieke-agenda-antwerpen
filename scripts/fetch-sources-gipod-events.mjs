import path from "node:path";
import { fileURLToPath } from "node:url";
import { eventsFromGipod,gipodEventQueryUrl } from "../lib/gipod-events.mjs";
import { FetchError,USER_AGENT,errorCodeOf,fetchWithTimeout,isMainModule,keepPreviousOnError,readSourceDocument,screenItems,statusEntry,writeSourceDocument } from "../lib/fetch-util.mjs";
import { brusselsDate } from "../lib/html-text.mjs";
import { sourceDocument } from "../lib/source-feed.mjs";
export const SOURCE_ID="district-gipod-evenementen";
async function getJson(fetchImpl,url){
  const response=await fetchWithTimeout(fetchImpl,url,{headers:{"user-agent":USER_AGENT,accept:"application/geo+json, application/json"},redirect:"error"});
  if(!response.ok)throw new FetchError(`http_${response.status}`);
  let json;try{json=await response.json()}catch{throw new FetchError("invalid_json")}
  if((json.links||[]).some(link=>link.rel==="next"))throw new FetchError("pagination_required");
  return json;
}
export async function run({fetch:fetchImpl=globalThis.fetch,clock=()=>new Date(),rootDir,dryRun=false,log=console.log}={}){
  const previous=readSourceDocument(rootDir,SOURCE_ID),now=clock(),retrievedAt=now.toISOString(),today=brusselsDate(now);
  let geojson;
  try{geojson=await getJson(fetchImpl,gipodEventQueryUrl(now));if(!Array.isArray(geojson?.features))throw new FetchError("invalid_payload")}
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
