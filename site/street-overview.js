import {resolveAddressStreet} from "./street-core.js";
import {loadStreetIndex} from "./street-source.js";

const clean=value=>String(value??"").replace(/\s+/g," ").trim();
const streetKey=street=>[street?.id||"",street?.name||"",street?.postcode||""].join("|");
const isMarket=item=>item?.sourceId==="stad-markten"||(item?.sources||[]).some(source=>source?.sourceId==="stad-markten")||/\bmarkt\b/i.test(item?.title||"");

export function buildStreetGroups({works=[],publicSpace=[],agendaItems=[],streetIndex=null,history=null,asOf="9999-12-31"}={}){
  const groups=new Map();
  const ensure=street=>{
    const key=streetKey(street);
    if(!key||!street?.name)return null;
    if(!groups.has(key))groups.set(key,{street,works:[],parking:[],iod:[],sgw:[],markets:[],agenda:[],changes:[]});
    return groups.get(key);
  };
  const add=(street,bucket,item)=>{
    const group=ensure(street);
    if(group&&!group[bucket].some(existing=>existing.id===item.id))group[bucket].push(item);
  };
  for(const item of works){
    const normalized={id:`work:${item.gipodId}`,title:clean(item.title)||"Werk",status:clean(item.status),start:item.start||"",end:item.end||"",detail:clean(item.ownerGroup||item.owner),sourceUrl:item.sourceUrls?.[0]||"",severeHindrance:item.hindrance?.severe===true};
    for(const street of item.streets||[])add(street,"works",normalized);
  }
  for(const item of publicSpace){
    const bucket=item.kind==="parking"?"parking":item.kind==="iod"?"iod":"sgw";
    const normalized={id:item.id,title:clean(item.title||item.kindLabel)||"Maatregel",status:clean(item.status),start:item.start||"",end:item.end||"",detail:clean(item.detail||item.location),sourceUrl:item.sourceUrl||""};
    for(const street of item.streets||[])add(street,bucket,normalized);
  }
  if(streetIndex){
    for(const item of agendaItems){
      const end=item.endDate||item.date||"";
      if(end&&end<asOf)continue;
      const resolution=resolveAddressStreet(item.location||"",streetIndex);
      if(!resolution.streets.length)continue;
      const bucket=isMarket(item)?"markets":"agenda";
      const normalized={id:item.id,title:clean(item.title)||"Agenda-item",status:"",start:item.date||"",end:item.endDate||"",detail:clean(item.timeText||item.info),sourceUrl:item.sourceUrl||item.link||""};
      for(const street of resolution.streets)add(street,bucket,normalized);
    }
  }
  if(history?.changes&&history?.layers){
    const current=new Map();
    for(const layer of Object.values(history.layers))for(const item of layer?.items||[])current.set(item.id,item);
    const cutoff=Date.now()-7*86400000;
    for(const change of history.changes){
      const when=Date.parse(change.observedAt||"");
      if(!Number.isFinite(when)||when<cutoff)continue;
      const item=current.get(change.id)||change.after||change.before;
      for(const street of item?.streets||[]){
        const group=ensure(street);
        if(group)group.changes.push({id:`${change.observedAt}|${change.layer}|${change.id}`,type:change.type,observedAt:change.observedAt,fields:Array.isArray(change.fields)?change.fields:[]});
      }
    }
  }
  return [...groups.values()].map(group=>({...group,total:group.works.length+group.parking.length+group.iod.length+group.sgw.length+group.markets.length+group.agenda.length})).filter(group=>group.total>0).sort((a,b)=>b.total-a.total||a.street.name.localeCompare(b.street.name,"nl"));
}

export function buildDistrictRadar(groups=[],history=null){
  const domains=group=>[group.works.length?"works":"",group.parking.length?"parking":"",group.iod.length?"iod":"",group.sgw.length?"sgw":"",group.markets.length?"markets":"",group.agenda.length?"agenda":""].filter(Boolean);
  const overlap=groups.filter(group=>domains(group).length>=2);
  const workAndTraffic=groups.filter(group=>group.works.length&&(group.parking.length||group.iod.length||group.sgw.length));
  const severe=groups.filter(group=>group.works.some(item=>item.severeHindrance));
  const layerStates=Object.values(history?.layers||{}).map(layer=>layer?.status).filter(Boolean);
  const historyState=!layerStates.length?"unavailable":layerStates.every(state=>state==="ok")?"ok":layerStates.some(state=>state==="error")?"unavailable":"stale";
  const changed=historyState==="unavailable"?null:groups.filter(group=>group.changes.length>0).length;
  const topOverlap=[...overlap].sort((a,b)=>domains(b).length-domains(a).length||b.total-a.total||a.street.name.localeCompare(b.street.name,"nl")).slice(0,5).map(group=>({street:group.street,domains:domains(group),total:group.total}));
  return{totalStreets:groups.length,multiDomainStreets:overlap.length,workAndTrafficStreets:workAndTraffic.length,severeHindranceStreets:severe.length,recentlyChangedStreets:changed,historyState,topOverlap};
}

if(typeof window!=="undefined"&&typeof document!=="undefined"){
  const root=document.getElementById("street-overview");
  if(root){
    const search=root.querySelector("[data-street-search]"),summary=root.querySelector("[data-street-summary]"),note=root.querySelector("[data-street-note]"),list=root.querySelector("[data-street-list]"),more=root.querySelector("[data-street-more]");
    const radar=document.createElement("section");radar.className="district-radar";radar.setAttribute("aria-label","District-radar");root.querySelector(".street-overview-header")?.after(radar);
    const state={streetIndex:null,history:null,works:window.PUBLIC_AGENDA_LIVE_STREETS?.works||[],publicSpace:window.PUBLIC_AGENDA_LIVE_STREETS?.publicSpace||[],shown:30};
    const esc=(value="")=>String(value).replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]));
    const fmt=new Intl.DateTimeFormat("nl-BE",{day:"numeric",month:"short",year:"numeric"});
    const date=value=>value&&Number.isFinite(Date.parse(value))?fmt.format(new Date(value)):"";
    const brusselsToday=()=>{const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Brussels",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));return`${values.year}-${values.month}-${values.day}`};
    const range=item=>item.start&&item.end&&item.start!==item.end?`${date(item.start)} – ${date(item.end)}`:item.start?date(item.start):"";
    function allGroups(){if(!state.streetIndex)return[];return buildStreetGroups({works:state.works,publicSpace:state.publicSpace,agendaItems:Array.isArray(window.PUBLIC_AGENDA_FEED?.items)?window.PUBLIC_AGENDA_FEED.items:[],streetIndex:state.streetIndex,history:state.history,asOf:brusselsToday()})}
    function filtered(){const query=clean(search?.value).toLowerCase(),groups=allGroups();if(!query)return groups;return groups.filter(group=>[group.street.name,group.street.postcode,...group.works.map(item=>item.title),...group.parking.map(item=>item.title),...group.iod.map(item=>item.title),...group.sgw.map(item=>item.title),...group.markets.map(item=>item.title),...group.agenda.map(item=>item.title)].join(" ").toLowerCase().includes(query))}
    function line(kind,item){const timing=range(item);return`<li><span class="street-item-kind">${esc(kind)}</span><span><strong>${esc(item.title)}</strong>${item.status?` · ${esc(item.status)}`:""}${timing?` · ${esc(timing)}`:""}${item.detail?`<small>${esc(item.detail)}</small>`:""}</span>${item.sourceUrl?`<a href="${esc(item.sourceUrl)}" target="_blank" rel="noreferrer">bron</a>`:""}</li>`}
    function card(group){const badges=[group.works.length&&`${group.works.length} werken`,group.parking.length&&`${group.parking.length} parkeerverboden`,group.iod.length&&`${group.iod.length} innames`,group.sgw.length&&`${group.sgw.length} verkeer`,group.markets.length&&`${group.markets.length} markten`,group.agenda.length&&`${group.agenda.length} activiteiten`,group.works.some(item=>item.severeHindrance)&&"ernstige hinder",group.changes.length&&`${group.changes.length} wijzigingen (7d)`].filter(Boolean);const items=[...group.works.map(item=>line("Werk",item)),...group.parking.map(item=>line("Parkeren",item)),...group.iod.map(item=>line("Inname",item)),...group.sgw.map(item=>line("Verkeer",item)),...group.markets.map(item=>line("Markt",item)),...group.agenda.map(item=>line("Agenda",item))].join("");return`<details class="street-card"><summary><span><strong>${esc(group.street.name)}</strong>${group.street.postcode?` <small>${esc(group.street.postcode)}</small>`:""}</span><span class="street-badges">${badges.map(badge=>`<em>${esc(badge)}</em>`).join("")}</span></summary><ul>${items}</ul></details>`}
    function render(){
      const all=allGroups(),groups=filtered(),shown=groups.slice(0,state.shown),r=buildDistrictRadar(all,state.history);
      summary.textContent=`${groups.length} straten met actuele of geplande informatie`;
      const changeValue=r.recentlyChangedStreets===null?"—":String(r.recentlyChangedStreets);
      const changeNote=r.historyState==="ok"?"laatste 7 dagen":r.historyState==="stale"?"history verouderd":"na gezonde history-refresh";
      radar.innerHTML=`<div class="district-radar-title"><div><span>District-radar</span><strong>Waar meerdere signalen samenkomen</strong></div><small>Feitelijke overlap, geen beoordelingsscore.</small></div><div class="district-radar-stats"><div><strong>${r.multiDomainStreets}</strong><span>straten met 2+ domeinen</span></div><div><strong>${r.workAndTrafficStreets}</strong><span>werk + verkeersmaatregel</span></div><div><strong>${r.severeHindranceStreets}</strong><span>straten met ernstige hinder</span></div><div><strong>${changeValue}</strong><span>gewijzigde straten · ${esc(changeNote)}</span></div></div>${r.topOverlap.length?`<div class="district-radar-overlap"><span>Meeste soorten signalen</span>${r.topOverlap.map(entry=>`<button type="button" data-radar-street="${esc(entry.street.name)}">${esc(entry.street.name)}${entry.street.postcode?` · ${esc(entry.street.postcode)}`:""} <small>${entry.domains.length} domeinen · ${entry.total} items</small></button>`).join("")}</div>`:""}`;
      radar.querySelectorAll("[data-radar-street]").forEach(button=>button.addEventListener("click",()=>{search.value=button.dataset.radarStreet||"";state.shown=30;render();root.scrollIntoView({block:"start"});}));
      list.innerHTML=shown.map(card).join("");more.hidden=shown.length>=groups.length;more.textContent=`Toon meer straten (${Math.max(0,groups.length-shown.length)})`;
      if(!state.streetIndex)note.textContent="Officiële straatas wordt geladen…";else if(!state.works.length&&!state.publicSpace.length)note.textContent="Straatas geladen. Live werken en maatregelen worden nog opgehaald.";else note.textContent="Gebundeld op officiële Antwerpse straatnamen. Alleen betrouwbare straatmatches worden opgenomen.";
    }
    window.addEventListener("public-agenda:street-layer",event=>{if(event.detail?.name==="works")state.works=event.detail.items||[];if(event.detail?.name==="publicSpace")state.publicSpace=event.detail.items||[];render()});
    search?.addEventListener("input",()=>{state.shown=30;render()});more?.addEventListener("click",()=>{state.shown+=30;render()});
    Promise.all([loadStreetIndex(),fetch("/history/live-layers.json",{cache:"no-store"}).then(response=>response.ok?response.json():null).catch(()=>null)]).then(([streetIndex,history])=>{state.streetIndex=streetIndex;state.history=history;render()}).catch(error=>{note.textContent=`Straatfiche tijdelijk niet beschikbaar: ${error?.message||"bronfout"}`});
    render();
  }
}
