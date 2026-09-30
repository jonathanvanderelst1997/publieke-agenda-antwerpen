import crypto from "node:crypto";
import path from "node:path";
import {fileURLToPath} from "node:url";

import {discoverCivicDecisions} from "../lib/ebesluit-discovery.mjs";
import {FetchError,errorCodeOf,isMainModule,keepPreviousOnError,readSourceDocument,screenItems,statusEntry,writeSourceDocument} from "../lib/fetch-util.mjs";
import {brusselsDate} from "../lib/html-text.mjs";
import {sourceDocument} from "../lib/source-feed.mjs";

export const SOURCE_ID="district-ebesluit";
const slug=value=>String(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,50)||"item";
const itemId=row=>`ebesluit-${slug(row.decisionCode)}-${row.start}-${crypto.createHash("sha256").update([row.decisionCode,row.category,row.location,row.start,row.end].join("|")).digest("hex").slice(0,8)}`;
const item=(row,retrievedAt)=>({id:itemId(row),externalId:row.decisionCode,title:row.category==="fair"?row.title:`Openbare markt ${row.location}`,theme:"Activiteit",className:"activity",date:row.start,endDate:row.end&&row.end!==row.start?row.end:null,timeSlot:"Info",timeText:"",location:row.location,postcodes:[],info:row.category==="fair"?"Goedgekeurde foorperiode volgens eBesluit.":"Goedgekeurde feestdagregeling voor deze openbare markt.",kind:"activity",sourceUrl:row.sourceUrl,retrievedAt,reviewRequired:false,inDistrict:true});
const dedupe=(rows,key)=>[...new Map(rows.map(row=>[key(row),row])).values()];

async function discoverKnownYears(fetchImpl,years){
  const results=[];
  for(const year of years)results.push(await discoverCivicDecisions({fetch:fetchImpl,year}));
  return{
    years,
    complete:results.every(result=>result.complete),
    decisions:dedupe(results.flatMap(result=>result.decisions),row=>row.code),
    calendarItems:dedupe(results.flatMap(result=>result.calendarItems),row=>[row.category,row.location,row.start,row.end,row.decisionCode].join("|")),
    exceptions:dedupe(results.flatMap(result=>result.exceptions),row=>[row.category,row.location,row.date,row.decisionCode].join("|")),
    playStreetAttachments:dedupe(results.flatMap(result=>result.playStreetAttachments),row=>row.decisionCode),
  };
}

export async function run({fetch:fetchImpl=globalThis.fetch,clock=()=>new Date(),rootDir,dryRun=false,log=console.log}={}){
  const previous=readSourceDocument(rootDir,SOURCE_ID);
  const now=clock(),retrievedAt=now.toISOString(),year=Number(brusselsDate(now).slice(0,4)),years=[year,year+1];
  let discovery;
  try{
    discovery=await discoverKnownYears(fetchImpl,years);
    if(!discovery.complete)throw new FetchError("search_incomplete");
    if(!discovery.decisions.length)throw new FetchError("no_decisions");
  }catch(error){
    const code=errorCodeOf(error);
    log(JSON.stringify({source:SOURCE_ID,fetchStatus:"error",errorCode:code,years}));
    return[keepPreviousOnError(rootDir,SOURCE_ID,previous,code,{dryRun})];
  }
  const screened=screenItems(discovery.calendarItems.filter(row=>row.category==="fair"||row.category==="market").map(row=>item(row,retrievedAt)));
  const suppressions=discovery.exceptions.filter(row=>row.category==="market_cancelled").map(row=>({targetSourceId:"stad-markten",date:row.date,location:row.location,sourceUrl:row.sourceUrl,decisionCode:row.decisionCode}));
  if(dryRun)return[statusEntry(SOURCE_ID,{fetchStatus:"ok",retrievedAt,itemCount:screened.items.length})];
  const document=writeSourceDocument(rootDir,SOURCE_ID,sourceDocument(SOURCE_ID,{retrievedAt,fetchStatus:"ok",contentVersion:`ebesluit-v2|${years.join("-")}|${discovery.decisions.length}|${suppressions.length}`,items:screened.items,suppressions}));
  log(JSON.stringify({source:SOURCE_ID,years,items:document.items.length,suppressions:document.suppressions.length,playStreetAttachments:discovery.playStreetAttachments.length}));
  return[statusEntry(SOURCE_ID,{fetchStatus:"ok",retrievedAt,itemCount:document.items.length})];
}

if(isMainModule(import.meta.url)){
  const rootDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
  run({rootDir,dryRun:process.argv.includes("--dry-run")}).catch(error=>{console.error(JSON.stringify({source:SOURCE_ID,fatal:errorCodeOf(error)}));process.exitCode=1});
}
