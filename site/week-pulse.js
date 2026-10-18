import {hinderkaart} from "./bezoekers-bronnen.js";
import {zonderRuwGipodRecord} from "./gipod-bron.js";
import {laagStand} from "./live-lagen.js";

const clean=value=>String(value??"").replace(/\s+/g," ").trim();
// Nooit een link naar een ruw GIPOD-record (site/gipod-bron.js): per werk de algemene kaart van Hinder in Kaart
// (zonder gipodid, dat opent het record met de contactgegevens), en een GIPOD-link van een agendapunt (een
// markt) wordt de datasetfiche.
const bron=value=>zonderRuwGipodRecord(String(value||""));
const isoDay=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||""))?String(value):"";
const addDays=(day,count)=>{const d=new Date(day+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+count);return d.toISOString().slice(0,10)};
const overlaps=(start,end,from,to)=>Boolean(start&&start<=to&&(end||start)>=from);
const maxDay=values=>values.filter(Boolean).sort().at(-1)||"";
export function knownHorizon({agendaItems=[],works=[],publicSpace=[],fromDay}={}){
  const from=isoDay(fromDay);if(!from)throw new Error("ongeldige startdatum");
  const agendaUntil=maxDay(agendaItems.map(item=>isoDay(item.endDate)||isoDay(item.date)).filter(day=>day>=from));
  const worksUntil=maxDay(works.map(item=>String(item.end||item.start||"").slice(0,10)).filter(day=>isoDay(day)&&day>=from));
  const measuresUntil=maxDay(publicSpace.map(item=>String(item.end||item.start||"").slice(0,10)).filter(day=>isoDay(day)&&day>=from));
  return{from,to:maxDay([from,agendaUntil,worksUntil,measuresUntil]),agendaUntil,worksUntil,measuresUntil};
}
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
    ...agenda.map(item=>({kind:"agenda",id:item.id,title:clean(item.title),date:isoDay(item.date),type:typeOf(item),location:clean(item.location),url:bron(item.sourceUrl||item.link)})),
    ...workStarts.map(item=>({kind:"work",id:`work:${item.gipodId}`,title:clean(item.title)||"Werk start",date:String(item.start||"").slice(0,10),type:"work",location:(item.streets||[]).map(s=>s.name).join(" · "),url:hinderkaart(),urlLabel:"Hinder in Kaart"})),
    ...measureStarts.map(item=>({kind:"measure",id:item.id,title:clean(item.title||item.kindLabel)||"Maatregel start",date:String(item.start||"").slice(0,10),type:item.kind||"measure",location:(item.streets||[]).map(s=>s.name).join(" · ")||clean(item.location),url:bron(item.sourceUrl)})),
  ].filter(item=>item.date).sort((a,b)=>a.date.localeCompare(b.date)||a.title.localeCompare(b.title,"nl")).slice(0,14);
  return{from,to,agendaCount:agenda.length,agendaByType,neighborhoodCount:agendaByType.neighborhood||0,playStreetCount:agendaByType.playstreet||0,publicMeetingCount:agendaByType.public_meeting||0,marketFairCount:agendaByType.market_fair||0,workStarts:workStarts.length,workEnds:workEnds.length,measureStarts:measureStarts.length,severeHindranceWorks:severe.length,upcoming};
}

// Wat de vooruitblik per teller toont. `lagen`: per live laag (works, publicSpace) "ok", "mislukt" of "" (nog niet
// binnen), zoals "Alles per straat" (laagStand in site/live-lagen.js). Laadde de laag niet (of maar deels) en telt ze
// niets, dan geen verzonnen 0 maar een streepje, zonder melding dat iets faalt (besluit van 18-10-2026); wat wel
// geteld is, blijft staan, een echte 0 ook.
export function vooruitblikTellers(pulse,lagen={}){
  const tel=(laag,n)=>lagen[laag]==="mislukt"&&!n?"–":String(n);
  return{agenda:String(pulse.agendaCount),werkenStarten:tel("works",pulse.workStarts),werkenEindigen:tel("works",pulse.workEnds),maatregelen:tel("publicSpace",pulse.measureStarts),ernstig:tel("works",pulse.severeHindranceWorks)};
}

if(typeof window!=="undefined"&&typeof document!=="undefined"){
  const root=document.getElementById("week-pulse");
  if(root){
    const live=window.PUBLIC_AGENDA_LIVE_STREETS||{};
    const state={works:live.works||[],publicSpace:live.publicSpace||[],lagen:{works:laagStand({items:live.works,failed:live.failed?.works}),publicSpace:laagStand({items:live.publicSpace,failed:live.failed?.publicSpace})}};
    const esc=(value="")=>String(value).replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]));
    const brusselsToday=()=>{const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Brussels",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const v=Object.fromEntries(parts.map(p=>[p.type,p.value]));return`${v.year}-${v.month}-${v.day}`};
    const dateFmt=new Intl.DateTimeFormat("nl-BE",{weekday:"short",day:"numeric",month:"short"});
    const fmt=day=>dateFmt.format(new Date(day+"T12:00:00Z"));
    function render(){
      const from=brusselsToday(),agendaItems=Array.isArray(window.PUBLIC_AGENDA_FEED?.items)?window.PUBLIC_AGENDA_FEED.items:[],horizon=knownHorizon({agendaItems,works:state.works,publicSpace:state.publicSpace,fromDay:from}),to=horizon.to;
      const pulse=buildWeekPulse({agendaItems,works:state.works,publicSpace:state.publicSpace,fromDay:from,toDay:to});
      const tel=vooruitblikTellers(pulse,state.lagen);
      const types=Object.entries(pulse.agendaByType).filter(([,count])=>count>0).sort((a,b)=>b[1]-a[1]||labelFor(a[0]).localeCompare(labelFor(b[0]),"nl")).slice(0,8);
      const horizonBits=[horizon.agendaUntil&&`agenda t/m ${fmt(horizon.agendaUntil)}`,horizon.worksUntil&&`werken t/m ${fmt(horizon.worksUntil)}`,horizon.measuresUntil&&`maatregelen t/m ${fmt(horizon.measuresUntil)}`].filter(Boolean).join(" · ");
      root.innerHTML=`<div class="week-pulse-head"><div><span>Volledige vooruitblik</span><h2>${esc(fmt(from))} – ${esc(fmt(to))}</h2><p>Alles wat de gekoppelde officiële bronnen nu al als lopend of toekomstig kennen.</p></div><small>Geen vaste 7-dagenlimiet. ${esc(horizonBits||"Nog geen toekomstige brondata.")}</small></div>
      <div class="week-pulse-stats">
        <a href="#agenda-list"><strong>${tel.agenda}</strong><span>activiteiten / publieke momenten</span></a>
        <a href="#works-live"><strong>${tel.werkenStarten}</strong><span>werken starten</span><small>${tel.werkenEindigen} eindigen</small></a>
        <a href="#public-space-live"><strong>${tel.maatregelen}</strong><span>maatregelen starten</span></a>
        <a href="#works-live"><strong>${tel.ernstig}</strong><span>werken met ernstige hinder</span></a>
      </div>
      <div class="week-pulse-types">${types.map(([type,count])=>`<span><strong>${count}</strong> ${esc(labelFor(type))}</span>`).join("")}</div>
      ${pulse.upcoming.length?`<div class="week-pulse-list"><strong>Eerstvolgende 14 items</strong><ol>${pulse.upcoming.map(item=>`<li><time>${esc(fmt(item.date))}</time><span><b>${esc(item.title)}</b>${item.location?`<small>${esc(item.location)}</small>`:""}</span>${item.url?`<a href="${esc(item.url)}" target="_blank" rel="noreferrer">${esc(item.urlLabel||"bron")}</a>`:""}</li>`).join("")}</ol></div>`:""}`;
    }
    window.addEventListener("public-agenda:street-layer",event=>{if(event.detail?.name==="works")state.works=event.detail.items||[];if(event.detail?.name==="publicSpace")state.publicSpace=event.detail.items||[];if(Object.hasOwn(state.lagen,event.detail?.name))state.lagen[event.detail.name]=laagStand(event.detail);render()});
    render();
  }
}
