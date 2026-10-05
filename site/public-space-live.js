import {collectPublicSpace,publicSpaceStats} from "./public-space-live-core.js";
import {loadStreetIndex} from "./street-source.js";
import {settleSources} from "./agenda-view.js";

const root=document.getElementById("public-space-live");
if(root){
  const state={items:[],shown:60,loaded:false},el=s=>root.querySelector(s);
  const count=el("[data-space-count]"),meta=el("[data-space-meta]"),note=el("[data-space-note]"),search=el("[data-space-search]"),kind=el("[data-space-kind]"),list=el("[data-space-list]"),more=el("[data-space-more]");
  const esc=(v="")=>String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  const fmt=new Intl.DateTimeFormat("nl-BE",{day:"numeric",month:"short",year:"numeric"});
  const date=v=>v&&Number.isFinite(Date.parse(v))?fmt.format(new Date(v)):"";
  const range=i=>i.start&&i.end?`${date(i.start)} – ${date(i.end)}`:i.start?`vanaf ${date(i.start)}`:i.end?`tot ${date(i.end)}`:"timing niet ingevuld";
  const brusselsDate=()=>{const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Brussels",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const o=Object.fromEntries(p.map(x=>[x.type,x.value]));return`${o.year}-${o.month}-${o.day}`};
  const BASE="https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer";
  const BBOX="4.300791,51.175458,4.444331,51.313629";
  async function get(url){const r=await fetch(url,{headers:{Accept:"application/json"}});if(!r.ok)throw Error(`bron antwoordde met HTTP ${r.status}`);const j=await r.json();if(j?.error)throw Error(j.error.message||"ArcGIS-bronfout");return j}
  function paramsFor(where,spatial=false){const p={where,f:"json"};if(spatial)Object.assign(p,{geometry:BBOX,geometryType:"esriGeometryEnvelope",inSR:"4326",spatialRel:"esriSpatialRelIntersects"});return p}
  async function layer(layer,{where,outFields,geometry=false,spatial=false}){
    const idsUrl=new URL(`${BASE}/${layer}/query`);idsUrl.search=new URLSearchParams({...paramsFor(where,spatial),returnIdsOnly:"true"});
    const idsData=await get(idsUrl),ids=Array.isArray(idsData.objectIds)?idsData.objectIds:[];
    if(ids.length>15000)throw Error(`laag ${layer} overschrijdt veiligheidslimiet`);
    const all=[];for(let i=0;i<ids.length;i+=500){const u=new URL(`${BASE}/${layer}/query`);u.search=new URLSearchParams({f:"json",objectIds:ids.slice(i,i+500).join(","),outFields,returnGeometry:String(geometry),outSR:"4326"});const d=await get(u);if(!Array.isArray(d.features))throw Error(`laag ${layer} gaf geen features terug`);all.push(...d.features)}return all
  }
  async function district(){const u=new URL("https://geodata.antwerpen.be/arcgissql/rest/services/P_Portal/portal_publiek2/MapServer/109/query");u.search=new URLSearchParams({where:"districtnaam='ANTWERPEN'",outFields:"districtcode,districtnaam,afkorting",outSR:"4326",f:"geojson"});const d=await get(u),fs=Array.isArray(d.features)?d.features:[];if(fs.length!==1)throw Error("officiële districtsgrens niet uniek gevonden");return fs[0].geometry}
  function filtered(){const q=String(search?.value||"").trim().toLowerCase(),k=kind?.value||"";return state.items.filter(i=>!window.PUBLIC_AGENDA_VIEW||window.PUBLIC_AGENDA_VIEW.matches(i,"publicSpace")).filter(i=>{const c=[i.kindLabel,i.title,i.location,i.status,i.reference,i.detail,...(i.streets||[]).map(s=>s.name)].join(" ").toLowerCase();return(!q||c.includes(q))&&(!k||i.kind===k)})}
  function card(i){return`<article class="public-space-card"><header><div><span class="public-space-kind ${esc(i.kind)}">${esc(i.kindLabel)}</span><h3>${esc(i.title)}</h3></div><span class="public-space-status">${esc(i.status)}</span></header><p class="public-space-timing">${esc(range(i))}</p><dl>${i.location?`<div><dt>Locatie</dt><dd>${esc(i.location)}</dd></div>`:""}${i.streets?.length?`<div><dt>Straat</dt><dd>${esc(i.streets.map(s=>s.name).join(" · "))}</dd></div>`:""}${i.detail?`<div><dt>Detail</dt><dd>${esc(i.detail)}</dd></div>`:""}<div><dt>Referentie</dt><dd>${esc(i.reference||"Niet ingevuld")}</dd></div><div><dt>Bron</dt><dd>${esc(i.sourceLabel)}</dd></div></dl><footer><span>Alleen publiek bevestigde status</span><a href="${esc(i.sourceUrl)}" target="_blank" rel="noreferrer">Officiële bronlaag</a></footer></article>`}
  function render(){const items=filtered(),shown=items.slice(0,state.shown);list.innerHTML=shown.map(card).join("");count.textContent=`${items.length} maatregelen`;more.hidden=shown.length>=items.length;more.textContent=`Toon meer (${items.length-shown.length} resterend)`}
  async function load(){
    if(state.loaded)return;state.loaded=true;root.classList.add("loading");note.textContent="Bevestigde parkeerverboden, innames en verkeersmaatregelen worden opgehaald…";
    const day=brusselsDate(),dateSql=`DATE '${day}'`;
    const jobs=[
      ["parking",layer(20,{where:`District='ANTWERPEN' AND Einddatum >= ${dateSql} AND Status IN ('Goedgekeurd','In effect')`,outFields:"Dossiernummer,Locatienummer,Status,Adres,Reden,Startdatum,Einddatum,EnkelWeekdagen,GipodID,District"})],
      ["iod22",layer(22,{where:`faseEindDatum >= ${dateSql} AND dossierStatus IN ('aanvraag_goedgekeurd','toelating_gegenereerd','toelating_geverifieerd')`,outFields:"dossierNummer,faseId,innameId,dossierStatus,faseNaam,type_dossier,innameTypeNaam,innameHinder,faseStartDatum,faseEindDatum",geometry:true,spatial:true})],
      ["iod23",layer(23,{where:`faseEindDatum >= ${dateSql} AND dossierStatus IN ('aanvraag_goedgekeurd','toelating_gegenereerd','toelating_geverifieerd')`,outFields:"dossierNummer,faseId,innameId,dossierStatus,faseNaam,type_dossier,innameTypeNaam,innameHinder,faseStartDatum,faseEindDatum",geometry:true,spatial:true})],
      ["sgw47",layer(47,{where:`EndDate >= ${dateSql} AND status='vergund'`,outFields:"reference_id,phase_id,status,StartDate,EndDate",geometry:true,spatial:true})],
      ["sgw48",layer(48,{where:`EndDate >= ${dateSql} AND status='vergund'`,outFields:"reference_id,phase_id,status,StartDate,EndDate",geometry:true,spatial:true})],
      ["district",district()],
      ["streets",loadStreetIndex()]
    ];
    const settled=await settleSources(jobs);
    const v=Object.fromEntries(settled),fail=settled.filter(([,x])=>x instanceof Error).map(([n])=>n);
    const districtGeometry=v.district instanceof Error?null:v.district;
    const parking=v.parking instanceof Error?[]:v.parking,iod=[...(v.iod22 instanceof Error?[]:v.iod22),...(v.iod23 instanceof Error?[]:v.iod23)];
    const sgw=[...(v.sgw47 instanceof Error?[]:v.sgw47).map(feature=>({feature,kind:"Omleiding"})),...(v.sgw48 instanceof Error?[]:v.sgw48).map(feature=>({feature,kind:"Werfzone"}))];
    const streetIndex=v.streets instanceof Error?null:v.streets;state.items=collectPublicSpace({parkingFeatures:parking,iodFeatures:iod,sgwFeatures:sgw,districtGeometry,streetIndex});state.ready=true;window.PUBLIC_AGENDA_LIVE_STREETS=window.PUBLIC_AGENDA_LIVE_STREETS||{};window.PUBLIC_AGENDA_LIVE_STREETS.publicSpace=state.items;window.dispatchEvent(new CustomEvent("public-agenda:street-layer",{detail:{name:"publicSpace",items:state.items}}));
    const s=publicSpaceStats(state.items);meta.textContent=`${s.parking} parkeerverboden · ${s.iod} innames · ${s.sgw} werfzones/omleidingen`;
    note.textContent=`A-Sign, geladen ${new Intl.DateTimeFormat("nl-BE",{dateStyle:"medium",timeStyle:"short"}).format(new Date())}. Alleen goedgekeurde/bevestigde dossiers worden getoond.`+(districtGeometry?" IOD en SGW zijn exact tegen de officiële districtsgrens gecontroleerd.":" IOD en SGW zijn verborgen omdat de officiële districtsgrens niet kon worden geladen.")+(fail.length?` Tijdelijk niet gelezen: ${fail.join(", ")}.`:"");
    render();root.classList.remove("loading");
  }
  window.addEventListener("public-agenda:view-change",()=>{state.shown=60;if((window.PUBLIC_AGENDA_VIEW?.selected||window.PUBLIC_AGENDA_VIEW?.area?.wijk)&&window.PUBLIC_AGENDA_VIEW.enabled("publicSpace"))load();if(state.ready)render()});
  [search,kind].forEach(c=>c?.addEventListener("input",()=>{state.shown=60;render()}));more?.addEventListener("click",()=>{state.shown+=60;render()});
  if("IntersectionObserver"in window){const o=new IntersectionObserver(es=>{if(es.some(e=>e.isIntersecting)){o.disconnect();load()}},{rootMargin:"600px"});o.observe(root)}else load()
}
