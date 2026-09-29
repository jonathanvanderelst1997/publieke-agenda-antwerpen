import {buildStreetIndex} from "./street-core.js";

const SOURCE="https://geodata.antwerpen.be/arcgissql/rest/services/P_Portal/portal_publiek9/MapServer/905/query";
const DEFAULT_PAGE_SIZE=2000;
let promise=null;

function sourceError(code,message){
  const error=new Error(message);
  error.code=code;
  return error;
}

async function get(url,fetchImpl){
  const response=await fetchImpl(url,{headers:{Accept:"application/json"}});
  if(!response.ok)throw sourceError(`street_axis_http_${response.status}`,`straatas HTTP ${response.status}`);
  const json=await response.json();
  if(json?.error)throw sourceError("street_axis_provider_error",json.error.message||"straatas bronfout");
  return json;
}

export async function fetchStreetFeatures({
  fetchImpl=globalThis.fetch,
  source=SOURCE,
  pageSize=DEFAULT_PAGE_SIZE,
  maxPages=25,
}={}){
  if(typeof fetchImpl!=="function")throw sourceError("street_axis_fetch_unavailable","fetch ontbreekt");
  if(!Number.isInteger(pageSize)||pageSize<1||pageSize>2000)throw sourceError("street_axis_invalid","ongeldige pageSize");
  if(!Number.isInteger(maxPages)||maxPages<1||maxPages>100)throw sourceError("street_axis_invalid","ongeldige maxPages");

  const features=[];
  for(let page=0;page<maxPages;page+=1){
    const url=new URL(source);
    url.search=new URLSearchParams({
      where:"DISTRICT='ANTWERPEN'",
      outFields:"LSTRNMID,LSTRNM,RSTRNMID,RSTRNM,postcode,DISTRICT",
      returnGeometry:"true",
      outSR:"4326",
      orderByFields:"OBJECTID ASC",
      resultOffset:String(page*pageSize),
      resultRecordCount:String(pageSize),
      f:"geojson",
    });
    const data=await get(url,fetchImpl);
    if(!Array.isArray(data.features))throw sourceError("street_axis_invalid","straatas features ontbreken");
    features.push(...data.features);
    if(data.features.length<pageSize)return features;
  }
  throw sourceError("street_axis_pagination_limit","straatas paginering overschrijdt veiligheidslimiet");
}

export async function fetchStreetIndex(options={}){
  const features=await fetchStreetFeatures(options);
  const index=buildStreetIndex(features);
  if(!index.segments.length)throw sourceError("street_axis_empty","straatas leeg");
  return index;
}

export function loadStreetIndex(){
  if(promise)return promise;
  promise=fetchStreetIndex().catch(error=>{promise=null;throw error});
  return promise;
}
