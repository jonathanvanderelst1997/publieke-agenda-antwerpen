const clean=value=>String(value??"").replace(/\s+/g," ").trim();
const isoDay=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||""))?String(value):"";
const addDays=(day,count)=>{const d=new Date(day+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+count);return d.toISOString().slice(0,10)};
const overlaps=(start,end,from,to)=>Boolean(start&&start<=to&&(end||start)>=from);
const typeOf=item=>globalThis.PublicAgendaEventTypes?.classifyEventType?.(item)||"other";
const labelFor=key=>globalThis.PublicAgendaEventTypes?.labelFor?.(key)||key;

export function buildWeekPulse({agendaItems=[],works=[],publicSpace=[],fromDay,toDay}={}){
  const from=isoDay(fromDay),to=isoDay(toDay);
  if(!from||!to||to<from)throw new Error("ongeldige weekperiode");
  const agenda=agendaItems.filter(item=>overlaps(isoDay(item.date),isoDay(item.endDate)||isoDay(item.date),from,to));
  const agendaByType={};
  for(const item of agenda){const type=typeOf(item);agendaByType[type]=(agendaByType[type]||0)+1}
  const workStarts=works.filter(item=>{const start=String(item.start||"").slice(0,10);return start>=from&&start<=to});
  const workEnds=works.filter(item=>{const end=String(item.end||"").slice(0,10);return end>=from&&end<=to});
  const measureStarts=publicSpace.filter(item=>{const start=String(item.start||"").slice(0,10);return start>=from&&start<=to});
  const severe=works.filter(item=>item.hindrance?.severe===true&&overlaps(String(item.start||"").slice(0,10),String(item.end||"").slice(0,10),from,to));
  const upcoming=[
    ...agenda.map(item=>({kind:"agenda",id:item.id,title:clean(item.title),date:isoDay(item.date),type:typeOf(item),location:clean(item.location),url:item.sourceUrl||item.link||""})),
    ...workStarts.map(item=>({kind:"work",id:`work:${item.gipodId}`,title:clean(item.title)||"Werk start",date:String(item.start||"").slice(0,10),type:"work",location:(item.streets||[]).map(s=>s.name).join(" · "),url:item.sourceUrls?.[0]||""})),
    ...measureStarts.map(item=>({kind:"measure",id:item.id,title:clean(item.title||item.kindLabel)||"Maatregel start",date:String(item.start||"").slice(0,10),type:item.kind||"measure",location:(item.streets||[]).map(s=>s.name).join(" · ")||clean(item.location),url:item.sourceUrl||""})),
  ].filter(item=>item.date).sort((a,b)=>a.date.localeCompare(b.date)||a.title.localeCompare(b.title,"nl")).slice(0,14);
  return{from,to,agendaCount:agenda.length,agendaByType,neighborhoodCount:agendaByType.neighborhood||0,playStreetCount:agendaByType.playstreet||0,publicMeetingCount:agendaByType.public_meeting||0,marketFairCount:agendaByType.market_fair||0,workStarts:workStarts.length,workEnds:workEnds.length,measureStarts:measureStarts.length,severeHindranceWorks:severe.length,upcoming};
}

if(typeof window!=="undefined"&&typeof document!=="undefined"){
  const root=document.getElementById("week-pulse");
  if(root){
    const state={works:window.PUBLIC_AGENDA_LIVE_STREETS?.works||[],publicSpace:window.PUBLIC_AGENDA_LIVE_STREETS?.publicSpace||[]};
    const esc=(value="")=>String(value).replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]));
    const brusselsToday=()=>{const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Brussels",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const v=Object.fromEntries(parts.map(p=>[p.type,p.value]));return`${v.year}-${v.month}-${v.day}`};
    const dateFmt=new Intl.DateTimeFormat("nl-BE",{weekday:"short",day:"numeric",month:"short"});
    const fmt=day=>dateFmt.format(new Date(day+"T12:00:00Z"));
    function render(){
      const from=brusselsToday(),to=addDays(from,6);
      const pulse=buildWeekPulse({agendaItems:Array.isArray(window.PUBLIC_AGENDA_FEED?.items)?window.PUBLIC_AGENDA_FEED.items:[],works:state.works,publicSpace:state.publicSpace,fromDay:from,toDay:to});
      const types=Object.entries(pulse.agendaByType).filter(([,count])=>count>0).sort((a,b)=>b[1]-a[1]||labelFor(a[0]).localeCompare(labelFor(b[0]),"nl")).slice(0,8);
      root.innerHTML=`<div class="week-pulse-head"><div><span>Komende 7 dagen</span><h2>${esc(fmt(from))} – ${esc(fmt(to))}</h2><p>Wat er gepland staat of start, rechtstreeks uit de gekoppelde bronnen.</p></div><small>Feitelijke tellingen; geen prioriteitsscore.</small></div>
      <div class="week-pulse-stats">
        <a href="#agenda-list"><strong>${pulse.agendaCount}</strong><span>activiteiten / publieke momenten</span></a>
        <a href="#works-live"><strong>${pulse.workStarts}</strong><span>werken starten</span><small>${pulse.workEnds} eindigen</small></a>
        <a href="#public-space-live"><strong>${pulse.measureStarts}</strong><span>maatregelen starten</span></a>
        <a href="#works-live"><strong>${pulse.severeHindranceWorks}</strong><span>werken met ernstige hinder</span></a>
      </div>
      <div class="week-pulse-types">${types.map(([type,count])=>`<span><strong>${count}</strong> ${esc(labelFor(type))}</span>`).join("")}</div>
      ${pulse.upcoming.length?`<div class="week-pulse-list"><strong>Eerstvolgende</strong><ol>${pulse.upcoming.map(item=>`<li><time>${esc(fmt(item.date))}</time><span><b>${esc(item.title)}</b>${item.location?`<small>${esc(item.location)}</small>`:""}</span>${item.url?`<a href="${esc(item.url)}" target="_blank" rel="noreferrer">bron</a>`:""}</li>`).join("")}</ol></div>`:""}`;
    }
    window.addEventListener("public-agenda:street-layer",event=>{if(event.detail?.name==="works")state.works=event.detail.items||[];if(event.detail?.name==="publicSpace")state.publicSpace=event.detail.items||[];render()});
    render();
  }
}
