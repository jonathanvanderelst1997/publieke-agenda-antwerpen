import {worksExactSnapshot} from "./works-snapshot.js";
import {collectWorks,worksStats} from "./works-core.js";
import {attachHindrance} from "./works-hindrance.js";
import {attachAsSignWorkSupplement} from "./works-asign-supplement.js";
import {applyWorkStreetResolution} from "./street-core.js";
import {loadStreetIndex} from "./street-source.js";
import {hinderkaart} from "./bezoekers-bronnen.js";
import {asignLayer} from "./asign-query.js";
import {laadAlsInBeeld,meldLiveLaag} from "./live-lagen.js";
import {kaderRond} from "./straat-snapshot.js";

// GIPOD per pagina, alleen op dezelfde collectie (gedeeld door het hele district en het kader van één straat).
const GIPOD_COLLECTIES="https://geo.api.vlaanderen.be/GIPOD/ogc/features/v1/collections";
const WERK_FILTER="Type IN ('Grondwerk','Werk') AND Status IN ('In uitvoering','Concreet gepland')";
const HINDER_FILTER="HindranceStatus = 'Gevalideerd'";
async function haalJson(url){const r=await fetch(url,{headers:{Accept:"application/json"}});if(!r.ok)throw Error(`bron antwoordde met HTTP ${r.status}`);return r.json()}
async function gipodLaag(collectie,{bbox,filter}){
  const pad=`/GIPOD/ogc/features/v1/collections/${collectie}/items`,first=new URL(`${GIPOD_COLLECTIES}/${collectie}/items`);
  first.search=new URLSearchParams({limit:"500",bbox,f:"json","filter-lang":"cql2-text",filter});
  const fs=[],seen=new Set();let url=first.href;
  for(let page=0;page<20&&url;page++){
    const u=new URL(url);
    if(u.origin!=="https://geo.api.vlaanderen.be"||u.pathname!==pad||seen.has(url))throw Error(`onverwachte GIPOD-paginering (${collectie})`);
    seen.add(url);
    const d=await haalJson(url);
    if(d.type!=="FeatureCollection"||!Array.isArray(d.features))throw Error(`ongeldige GIPOD-respons (${collectie})`);
    fs.push(...d.features);
    const next=(d.links||[]).filter(l=>l.rel==="next");
    if(next.length>1)throw Error(`dubbele GIPOD-next-link (${collectie})`);
    url=next[0]?.href||"";
  }
  if(url)throw Error(`GIPOD-paginering bereikte veiligheidslimiet (${collectie})`);
  return fs;
}
const brusselsDag=()=>{const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Brussels",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const o=Object.fromEntries(p.map(x=>[x.type,x.value]));return`${o.year}-${o.month}-${o.day}`};
const supplementVraag=(day,extra={})=>({where:`EINDDATUM >= DATE '${day}' AND STATUS='GoedGekeurd'`,outFields:"GipodID,Bedrijf,DossierNummer,DossierType,WERF_TYPE,FASEID,Fasestatus,VerkeersImpact,DossierHinder,BEGINDATUM,EINDDATUM,STATUS",spatial:true,maxIds:5000,...extra});

// Snelheid (P5): alleen de werken in het kader van één straat, voor de plekpagina (site/place-view.js). Een
// paar kleine verzoeken in plaats van 7 pagina's werken, 7 pagina's hinder en de A-Sign-blokken van het
// hele district. Zelfde regels als de lijst hieronder: districtsgrens (of de exacte snapshot), gevalideerde
// hinder en het A-Sign-supplement op hetzelfde GIPOD-id. De hinder: een iets ruimer kader (een hinderpunt
// ligt niet altijd bij het werk). Geeft { items, hinderOk }; faalt GIPOD zelf, dan faalt de belofte.
export async function werkenInKader(kader,{district=null,streetIndex=null}={}){
  const bbox=kader.join(","),ruimer=(kaderRond([kader[0],kader[1],kader[2],kader[3]],300)||kader).join(",");
  const[features,hinder,supplement]=await Promise.all([
    gipodLaag("INNAME_PUNT",{bbox,filter:WERK_FILTER}),
    gipodLaag("HINDER_PUNT",{bbox:ruimer,filter:HINDER_FILTER}).then(features=>({ok:true,features})).catch(()=>({ok:false,features:[]})),
    asignLayer(19,supplementVraag(brusselsDag(),{kader})).then(rows=>({ok:true,rows})).catch(()=>({ok:false,rows:[]})),
  ]);
  let items=attachAsSignWorkSupplement(attachHindrance(collectWorks(features,new Set(worksExactSnapshot.exactGipodIds),district),hinder.features,hinder.ok),supplement.rows,supplement.ok);
  if(streetIndex)items=applyWorkStreetResolution(items,streetIndex);
  return{items,hinderOk:hinder.ok};
}

const root=typeof document!=="undefined"?document.getElementById("works-live"):null;
if(root){
  const exactIds=new Set(worksExactSnapshot.exactGipodIds),state={items:[],shown:60,loaded:false},el=s=>root.querySelector(s);
  const count=el("[data-works-count]"),meta=el("[data-works-meta]"),note=el("[data-works-note]"),search=el("[data-works-search]"),owner=el("[data-works-owner]"),status=el("[data-works-status]"),list=el("[data-works-list]"),more=el("[data-works-more]");
  const esc=(v="")=>String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  const date=v=>v&&Number.isFinite(Date.parse(v))?new Intl.DateTimeFormat("nl-BE",{day:"numeric",month:"short",year:"numeric"}).format(new Date(v)):"";
  const range=i=>i.start&&i.end?`${date(i.start)} – ${date(i.end)}`:i.start?`vanaf ${date(i.start)}`:i.end?`tot ${date(i.end)}`:"timing niet ingevuld";
  const hinderLabel=i=>!i.hindranceSourceLoaded?"Hinderbron tijdelijk niet geladen":i.hindrance?`${i.hindrance.severe?"Ernstige hinder · ":""}${i.hindrance.consequences.join(" · ")||"Gekoppelde gevalideerde hinder"}`:"Onbekend in open data";
  const aSignText=i=>{const s=i.aSignSupplement;if(!s)return"";const parts=[];if(s.companies.length)parts.push(`Bedrijf volgens A-Sign: ${s.companies.join(" · ")}`);if(s.workTypes.length)parts.push(`Werftype: ${s.workTypes.join(" · ")}`);if(s.phaseStatuses.length)parts.push(`Fasestatus: ${s.phaseStatuses.join(" · ")}`);if(s.trafficImpacts.length)parts.push(`Verkeersimpact: ${s.trafficImpacts.join(" · ")}`);if(s.dossierHindrances.length)parts.push(`Dossierhinder: ${s.dossierHindrances.join(" · ")}`);return parts.join(" · ")};
  function filtered(){const q=String(search?.value||"").trim().toLowerCase(),o=owner?.value||"",st=status?.value||"";return state.items.filter(i=>!window.PUBLIC_AGENDA_VIEW||window.PUBLIC_AGENDA_VIEW.matches(i,"works")).filter(i=>{const c=[i.gipodId,i.title,i.owner,i.ownerGroup,i.status,...(i.workTypes||[]),...(i.occupancyTypes||[]),...(i.hindrance?.consequences||[]),...(i.streets||[]).map(s=>s.name),aSignText(i)].join(" ").toLowerCase();return(!q||c.includes(q))&&(!o||i.ownerGroup===o)&&(!st||i.status===st)})}
  function card(i){const src=i.sourceUrls?.[0]||"",confidence=i.boundaryConfidence==="exact_snapshot"?"Exact tegen districtsgrens bevestigd in laatste snapshot":"Nieuw sinds laatste exacte snapshot; GIPOD-punt ligt binnen officiële districtsgrens";return`<article class="works-live-card"><header><div><span class="works-live-status ${i.status==="In uitvoering"?"running":"planned"}">${esc(i.status)}</span><h3>${esc(i.title)}</h3></div><span class="works-live-owner">${esc(i.ownerGroup)}</span></header><p class="works-live-timing">${esc(range(i))}</p><dl><div><dt>Beheerder/opdrachtgever</dt><dd>${esc(i.owner||"Niet ingevuld")}</dd></div><div><dt>Type</dt><dd>${esc([...(i.occupancyTypes||[]),...(i.workTypes||[])].filter(Boolean).join(" · ")||"Niet ingevuld")}</dd></div><div><dt>Hinder</dt><dd>${esc(hinderLabel(i))}</dd></div><div><dt>GIPOD</dt><dd>${esc(i.gipodId)}</dd></div><div><dt>Afbakening</dt><dd>${esc(confidence)}</dd></div>${i.streets?.length?`<div><dt>Straat</dt><dd>${esc(i.streets.map(s=>s.name).join(" · "))}</dd></div>`:""}${i.aSignSupplement?`<div><dt>A-Sign supplement</dt><dd>${esc(aSignText(i))}</dd></div>`:""}</dl><footer><span>${i.recordCount>1?`${i.recordCount} GIPOD-deelrecords`:"1 GIPOD-record"}</span><a href="${esc(hinderkaart(i.gipodId))}" target="_blank" rel="noreferrer">Bekijk werk op Hinder in Kaart</a>${src?`<a href="${esc(src)}" target="_blank" rel="noreferrer">Technische GIPOD-bron</a>`:""}</footer></article>`}
  function render(){const items=filtered(),shown=items.slice(0,state.shown);list.innerHTML=shown.map(card).join("");count.textContent=`${items.length} werken`;more.hidden=shown.length>=items.length;more.textContent=`Toon meer (${items.length-shown.length} resterend)`}
  async function district(){const u=new URL("https://geodata.antwerpen.be/arcgissql/rest/services/P_Portal/portal_publiek2/MapServer/109/query");u.search=new URLSearchParams({where:"districtnaam='ANTWERPEN'",outFields:"districtcode,districtnaam,afkorting",outSR:"4326",f:"geojson"});const d=await haalJson(u),fs=Array.isArray(d.features)?d.features:[];if(fs.length!==1)throw Error("officiële districtsgrens niet uniek gevonden");return fs[0].geometry}
  // Het hele district: alle pagina's werken (bbox van het district) en hinder (iets ruimer).
  const gipod=()=>gipodLaag("INNAME_PUNT",{bbox:"4.300791,51.175458,4.444331,51.313629",filter:WERK_FILTER});
  // Laag 19 via de gedeelde A-Sign-ophaler (korte blokken, hoogstens 4 verzoeken tegelijk).
  const asignSupplement=()=>asignLayer(19,supplementVraag(brusselsDag()));
  const hindrance=()=>gipodLaag("HINDER_PUNT",{bbox:"4.29,51.17,4.47,51.32",filter:HINDER_FILTER});
  async function load(){if(state.loaded)return;state.loaded=true;root.classList.add("loading");note.textContent="Actuele GIPOD-werken worden opgehaald…";try{const[features,geom,hinderResult,aSignResult,streetResult]=await Promise.all([gipod(),district().catch(()=>null),hindrance().then(features=>({ok:true,features})).catch(()=>({ok:false,features:[]})),asignSupplement().then(rows=>({ok:true,rows})).catch(()=>({ok:false,rows:[]})),loadStreetIndex().then(index=>({ok:true,index})).catch(()=>({ok:false,index:null}))]);state.items=attachAsSignWorkSupplement(attachHindrance(collectWorks(features,exactIds,geom),hinderResult.features,hinderResult.ok),aSignResult.rows,aSignResult.ok);if(streetResult.ok)state.items=applyWorkStreetResolution(state.items,streetResult.index);state.ready=true;meldLiveLaag("works",state.items,[]);const s=worksStats(state.items),withHindrance=state.items.filter(i=>i.hindrance).length,withASign=state.items.filter(i=>i.aSignSupplement).length,owners=Object.keys(s.owners).sort((a,b)=>a.localeCompare(b,"nl"));owner.innerHTML='<option value="">Alle beheerders</option>'+owners.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join("");meta.textContent=`${s.running} in uitvoering · ${s.planned} gepland · ${withHindrance} met gekoppelde hinder · ${withASign} met A-Sign supplement · ${s.exactSnapshot} exact grensbevestigd`+(s.newPointInside?` · ${s.newPointInside} nieuw sinds snapshot`:"");note.textContent=(geom?`Live GIPOD, gecontroleerd tegen de officiële districtsgrens. Exacte polygonsnapshot: ${date(worksExactSnapshot.observedAt)}. Nieuwe punten binnen de grens worden apart gemarkeerd.`:`Live GIPOD. De officiële grens kon nu niet worden geladen; alleen de exact gevalideerde snapshot van ${date(worksExactSnapshot.observedAt)} wordt getoond.`)+(hinderResult.ok?" Gevalideerde GIPOD-hinder is gekoppeld; ontbrekende koppeling wordt bewust als onbekend getoond.":" De GIPOD-hinderbron kon nu niet worden geladen; hinder blijft daarom onbekend.")+(aSignResult.ok?" A-Sign werfsignalisatie wordt alleen als aanvullend bedrijf/fasesignaal gekoppeld via hetzelfde GIPOD-id.":" Het aanvullende A-Sign-werfsignalisatiesignaal kon nu niet worden geladen.");render()}catch(e){state.items=[];count.textContent="Werken tijdelijk niet geladen";meta.textContent="";note.textContent=`De agenda blijft beschikbaar. De live werkenbron kon niet worden gelezen: ${e?.message||"onbekende fout"}.`;list.innerHTML="";meldLiveLaag("works",null,["werken"])}finally{root.classList.remove("loading")}}
  // Bij één straat (view.straatSnel) haalt de plekpagina zelf alleen het kader van die straat op
  // (werkenInKader); de lijst van het hele district laadt dan pas als ze in beeld komt.
  window.addEventListener("public-agenda:view-change",()=>{state.shown=60;const v=window.PUBLIC_AGENDA_VIEW;if(v?.enabled("works")&&(v.hasPlace||v.wantsLiveLayers)&&!v.straatSnel)load();if(state.ready)render()});
  [search,owner,status].forEach(c=>c?.addEventListener("input",()=>{state.shown=60;render()}));more?.addEventListener("click",()=>{state.shown+=60;render()});
  laadAlsInBeeld(root,load,{marge:"500px"})
}
