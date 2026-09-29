import { cleanText, stripTags } from "./html-text.mjs";

export const DISTRICT_MEETINGS_PAGE_UUID = "5c487af01ee32dff476bc9f3";
export const DISTRICT_MEETINGS_URL =
  "https://www.antwerpen.be/info/5c487af01ee32dff476bc9f3/districtsraad-antwerpen-zittingen-verslagen-en-besluiten";

const MONTHS = Object.freeze({
  januari: 1, februari: 2, maart: 3, april: 4, mei: 5, juni: 6,
  juli: 7, augustus: 8, september: 9, oktober: 10, november: 11, december: 12,
});
const WEEKDAYS = Object.freeze(["zondag","maandag","dinsdag","woensdag","donderdag","vrijdag","zaterdag"]);
const TYPES = Object.freeze([
  Object.freeze({ key:"algemene-commissie", header:"algemene raadscommissie", title:"Algemene raadscommissie Antwerpen" }),
  Object.freeze({ key:"districtsraad", header:"districtsraad", title:"Districtsraad Antwerpen" }),
  Object.freeze({ key:"bijzondere-commissie", header:"bijzondere raadscommissies", title:"Bijzondere raadscommissie Antwerpen" }),
]);
const text = (html="") => cleanText(stripTags(String(html)));
const normalized = (value="") => text(value).toLowerCase().replace(/\s+/g," ").trim();
function rowsFromTable(html=""){return [...String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row=>[...row[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map(cell=>text(cell[1]))).filter(cells=>cells.length)}
function isoDate(year,month,day){const d=new Date(Date.UTC(year,month-1,day));if(d.getUTCFullYear()!==year||d.getUTCMonth()!==month-1||d.getUTCDate()!==day)return null;return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`}
export function parseMeetingDates(value,year){const dates=[],issues=[];const re=/(?:(zondag|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag)\s+)?(\d{1,2})\s+(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)/gi;for(const match of String(value??"").matchAll(re)){const weekday=(match[1]||"").toLowerCase(),day=Number(match[2]),month=MONTHS[match[3].toLowerCase()];const iso=isoDate(year,month,day);if(!iso){issues.push({code:"invalid_date",value:text(match[0])});continue}if(weekday&&WEEKDAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()]!==weekday){issues.push({code:"weekday_mismatch",value:text(match[0])});continue}dates.push(iso)}return{dates:[...new Set(dates)].sort(),issues}}
export function parseDistrictMeetingPage(page){
  const snippets=Array.isArray(page?.snippets)?page.snippets:[];
  const html=snippets.filter(s=>s?.type==="wysiwyg").map(s=>String(s?.body?.text??"")).join("\n");
  const yearMatch=text(html).match(/Data\s+districtsraden\s+en\s+raadscommissies\s+(20\d{2})/i);
  if(!yearMatch)return{year:null,rows:0,items:[],issues:[{code:"missing_schedule_year"}]};
  const year=Number(yearMatch[1]),issues=[],items=[];let matchedTable=false,rows=0;
  for(const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)){
    const parsedRows=rowsFromTable(table[0]);if(parsedRows.length<2)continue;
    const headers=parsedRows[0].map(normalized);
    const columns=TYPES.map(type=>({type,index:headers.findIndex(header=>header.includes(type.header))})).filter(x=>x.index>=0);
    if(columns.length<2)continue;matchedTable=true;
    for(const row of parsedRows.slice(1)){rows++;for(const {type,index} of columns){const parsed=parseMeetingDates(row[index]??"",year);issues.push(...parsed.issues.map(issue=>({...issue,type:type.key,row:rows})));for(const date of parsed.dates){items.push({id:`district-vergadering-${type.key}-${date}`,externalId:`${type.key}-${date}`,title:type.title,theme:"Activiteit",className:"activity",date,endDate:null,timeSlot:"Info",timeText:"",location:"District Antwerpen · locatie en uur via officiële bron",postcodes:[],info:"Openbare districtsvergadering. Bekijk uur, locatie en agenda op de officiële bron.",kind:"activity",sourceUrl:DISTRICT_MEETINGS_URL,retrievedAt:null,reviewRequired:false,inDistrict:true})}}}
  }
  if(!matchedTable)issues.push({code:"missing_schedule_table"});
  return{year,rows,items:[...new Map(items.map(item=>[item.id,item])).values()].sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id)),issues};
}
