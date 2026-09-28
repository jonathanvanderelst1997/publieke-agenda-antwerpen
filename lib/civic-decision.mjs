export function normalizeDecisionTitle(value=""){return String(value??"").replace(/\s+/g," ").trim()}
export function classifyCivicDecisionTitle(value=""){
  const title=normalizeDecisionTitle(value),t=title.toLowerCase();
  if(!title)return{category:"other",publishCandidate:false};
  if(t.includes("speelstraat")||t.includes("speelstraten")){
    if(t.includes("weigering"))return{category:"play_street_refusal",publishCandidate:false};
    if(t.includes("wijziging aanvullend verkeersreglement")||(t.includes("reglement")&&t.includes("wijzig")))return{category:"play_street_rule",publishCandidate:false};
    if((t.includes("aanvraag speelstraten")||t.includes("aanvragen speelstraten")||t.includes("speelstraten"))&&t.includes("goedkeuring"))return{category:"play_street_approval",publishCandidate:true};
    return{category:"play_street_other",publishCandidate:false};
  }
  if((t.includes("kermis")||t.includes("foor"))&&t.includes("goedkeuring"))return{category:"fair_calendar_candidate",publishCandidate:true};
  if(t.includes("markt")&&(t.includes("feestdag")||t.includes("afwijk")||t.includes("regeling"))&&t.includes("goedkeuring"))return{category:"market_exception_candidate",publishCandidate:true};
  return{category:"other",publishCandidate:false};
}
const months={januari:1,februari:2,maart:3,april:4,mei:5,juni:6,juli:7,augustus:8,september:9,oktober:10,november:11,december:12};
export function parseDutchDate(value=""){
  const m=String(value).toLowerCase().match(/(\d{1,2})\s+(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\s+(20\d{2})/);
  if(!m)return null;
  const day=Number(m[1]),month=months[m[2]],year=Number(m[3]);
  const d=new Date(Date.UTC(year,month-1,day));
  if(d.getUTCFullYear()!==year||d.getUTCMonth()!==month-1||d.getUTCDate()!==day)return null;
  return d.toISOString().slice(0,10);
}
function article(text,n,next=n+1){
  const source=String(text||"");
  const start=source.search(new RegExp("\\bArtikel\\s+"+n+"\\b","i"));
  if(start<0)return"";
  const rest=source.slice(start);
  const end=rest.search(new RegExp("\\bArtikel\\s+"+next+"\\b","i"));
  return normalizeDecisionTitle(end>0?rest.slice(0,end):rest);
}
const uniqueBy=(rows,key)=>[...new Map(rows.map(r=>[key(r),r])).values()];
export function isDistrictAntwerpenDecision(text="",title=""){
  const t=normalizeDecisionTitle(text).toLowerCase(),h=normalizeDecisionTitle(title).toLowerCase();
  return /districtscollege\s+antwerpen\s+(beslist|keurt)/i.test(t)||h.includes("district antwerpen");
}
export function parseFairCalendar(text=""){
  const a=article(text,1,2),out=[];
  const re=/([^:;]{2,100}?)\s+-\s+([^:;]{2,80})\s*:\s*(\d{1,2}\s+[a-zà-ÿ]+\s+20\d{2})(?:\s+tot en met\s+(\d{1,2}\s+[a-zà-ÿ]+\s+20\d{2}))?/gi;
  for(const m of a.matchAll(re)){
    const location=normalizeDecisionTitle(m[1]).replace(/^.*?goed:\s*/i,"").trim();
    const name=normalizeDecisionTitle(m[2]),start=parseDutchDate(m[3]),end=parseDutchDate(m[4]||m[3]);
    if(location&&name&&start&&end)out.push({location,name,start,end});
  }
  return uniqueBy(out,x=>[x.location,x.name,x.start,x.end].join("|"));
}
function splitLocations(value=""){
  return normalizeDecisionTitle(value).replace(/[.;]+$/,"").split(/\s+en\s+|\s*,\s*/i).map(x=>normalizeDecisionTitle(x)).filter(Boolean);
}
function marketRows(section,occurs){
  const out=[];
  const re=/(?:maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)?\s*(\d{1,2}\s+[a-zà-ÿ]+\s+20\d{2})(?:,\s*[^:;]+)?\s*:\s*([^;]+)(?:;|$)/gi;
  for(const m of section.matchAll(re)){
    const date=parseDutchDate(m[1]);if(!date)continue;
    for(const location of splitLocations(m[2]))out.push({location,date,occurs});
  }
  return out;
}
export function parseMarketExceptionCalendar(text=""){
  return{
    running:uniqueBy(marketRows(article(text,1,2),true),x=>x.date+"|"+x.location),
    cancelled:uniqueBy(marketRows(article(text,2,3),false),x=>x.date+"|"+x.location)
  };
}
function decodeHtml(value=""){return String(value).replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim()}
export function extractPdfAttachments(html="",base="https://ebesluit.antwerpen.be"){
  const out=[];
  for(const m of String(html).matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)){
    const label=decodeHtml(m[2]),href=decodeHtml(m[1]);
    if(!/\.pdf(?:\?|$)/i.test(href)&&!/\.pdf$/i.test(label))continue;
    try{const u=new URL(href,base);if(u.origin!==new URL(base).origin)continue;out.push({name:label||u.pathname.split("/").pop(),url:u.href})}catch{}
  }
  return uniqueBy(out,x=>x.url);
}
export function civicCalendarFromDecision({code="",title="",category="",text="",url=""}={}){
  if(!isDistrictAntwerpenDecision(text,title))return{calendarItems:[],exceptions:[]};
  if(category==="fair_calendar_candidate"){
    return{calendarItems:parseFairCalendar(text).map(x=>({decisionCode:code,category:"fair",title:x.name,location:x.location,start:x.start,end:x.end,sourceUrl:url})),exceptions:[]};
  }
  if(category==="market_exception_candidate"){
    const m=parseMarketExceptionCalendar(text);
    return{
      calendarItems:m.running.map(x=>({decisionCode:code,category:"market",title:"Openbare markt",location:x.location,start:x.date,end:x.date,sourceUrl:url})),
      exceptions:m.cancelled.map(x=>({decisionCode:code,category:"market_cancelled",title:"Openbare markt gaat niet door",location:x.location,date:x.date,sourceUrl:url}))
    };
  }
  return{calendarItems:[],exceptions:[]};
}
