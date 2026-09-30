import { isValidIsoDate } from "./html-text.mjs";
import { pointInDistrict } from "./postcodes.mjs";

export const GIPOD_EVENT_ITEMS_URL="https://geo.api.vlaanderen.be/GIPOD/ogc/features/v1/collections/INNAME_PUNT/items";
export const DISTRICT_BBOX=Object.freeze([4.300791,51.175458,4.444331,51.313629]);
export const WINDOW_DAYS=365;
export const MAX_PLAYSTREET_DAYS=14;
export const GIPOD_EVENT_FILTER="Type='Evenement' AND Status IN ('Concreet gepland','Lopende')";

const FEATURE_ID=/^INNAME_PUNT\.\d{1,12}-\d{1,12}$/;
export const NEIGHBORHOOD_EVENT_WORD=/(buurtfeest|wijkfeest|straatfeest|pleinfeest|burenfeest)/i;
const EVENT_WORD=/(carnaval|stoet|festival|feest|kermis|circus|concert|optocht|parade|criterium|wedstrijd|stratenloop|loopwedstrijd|bingo|herdenking|sinterklaas|braderie|rommelmarkt|processie|viering|halloween|kerstmarkt|openluchtfeest)/i;
const EXCLUDED_TYPE=/^(?:Markt|Ambulante handel|Uitstalling|Reclame|Terras(?:\s|$)|Parkeer)/i;
const DISTRICT_POSTCODE=/\b(?:2000|2018|2020|2030|2050|2060)\b/;
const BRUSSELS="Europe/Brussels";
const clockFormat=new Intl.DateTimeFormat("en-GB",{timeZone:BRUSSELS,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
const clean=(value,max=300)=>String(value??"").replace(/\s+/g," ").trim().slice(0,max);
const types=value=>String(value??"").split(";").map(v=>v.trim()).filter(Boolean);
const isoSeconds=date=>date.toISOString().replace(/\.\d{3}Z$/,"Z");
const spoken=time=>{const[h,m]=time.split(":");return m==="00"?String(Number(h)):`${Number(h)}.${m}`};
function brussels(instant){const p=Object.fromEntries(clockFormat.formatToParts(instant).map(x=>[x.type,x.value]));return{date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`}}

export function gipodEventQueryUrl(now,{days=WINDOW_DAYS}={}){
  const until=new Date(now.getTime()+days*86_400_000);
  const params=new URLSearchParams({f:"json",limit:"1000",bbox:DISTRICT_BBOX.join(","),"filter-lang":"cql2-text",filter:GIPOD_EVENT_FILTER,datetime:`${isoSeconds(now)}/${isoSeconds(until)}`});
  return`${GIPOD_EVENT_ITEMS_URL}?${params}`;
}

export function eventLabels(description,reference){
  const value=clean(description),fallback=clean(reference,200);
  if(!value)return{title:fallback&&!/^\d+$/.test(fallback)?fallback:"",location:"District Antwerpen · exacte ligging volgens GIPOD"};
  const parts=value.split(":").map(part=>clean(part)).filter(Boolean);
  let title=parts.length>1?parts.at(-1):value;
  title=title.replace(/^evenement\s*[-–:]\s*/i,"").trim().slice(0,200);
  const prefix=parts.length>1?parts.slice(0,-1).join(": ").trim():"";
  const location=DISTRICT_POSTCODE.test(prefix)?prefix.slice(0,300):"District Antwerpen · exacte ligging volgens GIPOD";
  return{title,location};
}

export function classifyGipodEvent(feature,now){
  const p=feature?.properties??{},occupancies=types(p.PublicDomainOccupancyTypes),status=clean(p.Status,80),description=clean(p.Description,500);
  if(p.Type!=="Evenement")return{ok:false,reason:"not_event"};
  if(!["Concreet gepland","Lopende"].includes(status))return{ok:false,reason:"status"};
  if(!FEATURE_ID.test(String(feature?.id??"")))return{ok:false,reason:"invalid_id"};
  if(occupancies.some(type=>EXCLUDED_TYPE.test(type)))return{ok:false,reason:"commercial_or_market"};
  const playStreet=occupancies.includes("Speelstraat");
  if(!playStreet&&!occupancies.includes("Feest/kermis")&&!(occupancies.includes("Andere")&&(NEIGHBORHOOD_EVENT_WORD.test(description)||EVENT_WORD.test(description))))return{ok:false,reason:"not_explicit_event"};
  const startMs=Date.parse(p.Start??""),endMs=Date.parse(p.End??"");
  if(!Number.isFinite(startMs)||!Number.isFinite(endMs)||endMs<=startMs||endMs<now.getTime())return{ok:false,reason:"invalid_time"};
  if(playStreet&&endMs-startMs>MAX_PLAYSTREET_DAYS*86_400_000)return{ok:false,reason:"playstreet_duration"};
  const point=feature?.geometry?.type==="Point"?feature.geometry.coordinates:null;
  if(!Array.isArray(point)||point.length<2||!point.slice(0,2).every(Number.isFinite))return{ok:false,reason:"invalid_geometry"};
  if(!pointInDistrict(point))return{ok:false,reason:"outside_district"};
  const labels=eventLabels(description,p.Reference);
  if(!labels.title)return{ok:false,reason:"missing_title"};
  if(playStreet){
    const match=labels.location.match(/^\s*(?:2000|2018|2020|2030|2050|2060)\s+Antwerpen\s*,\s*(.+?)\s*$/i);
    if(!match||!clean(match[1],160))return{ok:false,reason:"playstreet_missing_location"};
    labels.title=`Speelstraat · ${clean(match[1],160)}`;
  }
  return{ok:true,occupancies,status,start:new Date(startMs),end:new Date(endMs),labels,playStreet};
}

export function eventsFromGipod(geojson,{now}){
  const counts={rows:0,events:0,playStreets:0,rejected:{}},items=[],seen=new Set();
  for(const feature of Array.isArray(geojson?.features)?geojson.features:[]){
    counts.rows++;
    const parsed=classifyGipodEvent(feature,now);
    if(!parsed.ok){counts.rejected[parsed.reason]=(counts.rejected[parsed.reason]??0)+1;continue}
    const p=feature.properties,gipodId=String(p.GipodId??"").trim(),start=brussels(parsed.start),end=brussels(parsed.end);
    if(!/^\d{1,12}$/.test(gipodId)||!isValidIsoDate(start.date))continue;
    const id=`gipod-event-${gipodId}-${start.date}`;
    if(seen.has(id))continue;
    seen.add(id);
    items.push({
      id,externalId:gipodId,title:parsed.labels.title,theme:"Activiteit",className:"activity",
      date:start.date,endDate:end.date>start.date?end.date:null,timeSlot:start.time,timeText:`${spoken(start.time)} tot ${spoken(end.time)} uur`,
      location:parsed.labels.location,postcodes:[],info:parsed.playStreet?"Publieke speelstraat volgens GIPOD · type: Speelstraat":`Publieke inname voor evenement volgens GIPOD · type: ${parsed.occupancies.join(" · ")}`,
      kind:"activity",sourceUrl:`${GIPOD_EVENT_ITEMS_URL}/${feature.id}`,retrievedAt:null,reviewRequired:false,inDistrict:true,
    });
    if(parsed.playStreet)counts.playStreets++;
  }
  items.sort((a,b)=>a.date.localeCompare(b.date)||a.timeSlot.localeCompare(b.timeSlot)||a.id.localeCompare(b.id));
  counts.events=items.length;
  return{items,counts};
}
