import {collectPublicSpaceInStappen,publicSpaceStats} from "./public-space-live-core.js";
import {DISTRICT_POSTCODES,parkeerverbodWhere} from "./public-space-core.js";
import {parkeerTitel,parkeerUren,statusNl} from "./place-core.js";
import {loadStreetIndex} from "./street-source.js";
import {settleSources} from "./agenda-view.js";
import {asignLayer} from "./asign-query.js";
import {meldLiveLaag,mislukteOnderdelenPublicSpace,onvolledigMelding} from "./live-lagen.js";

const root=document.getElementById("public-space-live");
if(root){
  const state={items:[],shown:60,loaded:false},el=s=>root.querySelector(s);
  const count=el("[data-space-count]"),meta=el("[data-space-meta]"),note=el("[data-space-note]"),search=el("[data-space-search]"),kind=el("[data-space-kind]"),list=el("[data-space-list]"),more=el("[data-space-more]");
  const esc=(v="")=>String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  const fmt=new Intl.DateTimeFormat("nl-BE",{day:"numeric",month:"short",year:"numeric"});
  const date=v=>v&&Number.isFinite(Date.parse(v))?fmt.format(new Date(v)):"";
  const range=i=>i.start&&i.end?`${date(i.start)} – ${date(i.end)}`:i.start?`vanaf ${date(i.start)}`:i.end?`tot ${date(i.end)}`:"timing niet ingevuld";
  const brusselsDate=()=>{const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Brussels",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const o=Object.fromEntries(p.map(x=>[x.type,x.value]));return`${o.year}-${o.month}-${o.day}`};
  async function get(url){const r=await fetch(url,{headers:{Accept:"application/json"}});if(!r.ok)throw Error(`bron antwoordde met HTTP ${r.status}`);const j=await r.json();if(j?.error)throw Error(j.error.message||"ArcGIS-bronfout");return j}
  // A-Sign via de gedeelde ophaler: korte blokken, hoogstens 4 verzoeken tegelijk voor alle lagen.
  const layer=(nr,opties)=>asignLayer(nr,opties);
  async function district(){const u=new URL("https://geodata.antwerpen.be/arcgissql/rest/services/P_Portal/portal_publiek2/MapServer/109/query");u.search=new URLSearchParams({where:"districtnaam='ANTWERPEN'",outFields:"districtcode,districtnaam,afkorting",outSR:"4326",f:"geojson"});const d=await get(u),fs=Array.isArray(d.features)?d.features:[];if(fs.length!==1)throw Error("officiële districtsgrens niet uniek gevonden");return fs[0].geometry}
  function filtered(){const q=String(search?.value||"").trim().toLowerCase(),k=kind?.value||"";return state.items.filter(i=>!window.PUBLIC_AGENDA_VIEW||window.PUBLIC_AGENDA_VIEW.matches(i,"publicSpace")).filter(i=>{const c=[i.kindLabel,i.title,i.location,i.status,i.reference,i.detail,...(i.streets||[]).map(s=>s.name)].join(" ").toLowerCase();return(!q||c.includes(q))&&(!k||i.kind===k)})}
  // Dezelfde woorden als in het plekoverzicht: een titel in gewone taal, geen interne fasenummers.
  const titel=i=>i.kind==="parking"?parkeerTitel(i.reason??i.title):i.kind==="sgw"?(/Werfzone/.test(i.kindLabel)&&/Omleiding/.test(i.kindLabel)?"Werfzone met omleiding":/Omleiding/.test(i.kindLabel)?"Omleiding":"Werfzone"):i.title;
  const details=i=>i.kind==="parking"?[["Reden volgens de stad",i.reason||"Niet gepubliceerd"],["Uren",[parkeerUren(i),i.weekdaysOnly?"alleen op weekdagen":""].filter(Boolean).join(", ")]]:i.kind==="sgw"?[]:[["Detail",i.detail]];
  function card(i){return`<article class="public-space-card"><header><div><span class="public-space-kind ${esc(i.kind)}">${esc(i.kindLabel)}</span><h3>${esc(titel(i))}</h3></div><span class="public-space-status">${esc(statusNl(i.status))}</span></header><p class="public-space-timing">${esc(range(i))}</p><dl>${i.location?`<div><dt>Locatie</dt><dd>${esc(i.location)}</dd></div>`:""}${i.streets?.length?`<div><dt>Straat</dt><dd>${esc(i.streets.map(s=>s.name).join(" · "))}</dd></div>`:""}${details(i).filter(([,v])=>v).map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}<div><dt>Referentie</dt><dd>${esc(i.reference||"Niet ingevuld")}</dd></div><div><dt>Bron</dt><dd>${esc(i.sourceLabel)}</dd></div></dl><footer><span>Alleen publiek bevestigde status</span><a href="${esc(i.sourceUrl)}" target="_blank" rel="noreferrer">Technische stadsbron (A-Sign)</a></footer></article>`}
  function render(){const items=filtered(),shown=items.slice(0,state.shown);list.innerHTML=shown.map(card).join("");count.textContent=`${items.length} maatregelen`;more.hidden=shown.length>=items.length;more.textContent=`Toon meer (${items.length-shown.length} resterend)`}
  async function load(){
    if(state.loaded)return;state.loaded=true;root.classList.add("loading");note.textContent="Bevestigde parkeerverboden, innames en verkeersmaatregelen worden opgehaald…";
    const day=brusselsDate(),dateSql=`DATE '${day}'`;
    const jobs=[
      // Alleen de postcodes van het district: "District='ANTWERPEN'" alleen is de hele stad (5.781 in
      // plaats van 2.875 parkeerverboden), en dat legde een gsm tot een halve minuut stil.
      // Met de lijn van elk parkeerverbod (op 10 cm), voor de knoppen +250 m tot +1 km rond een straat.
      ["parking",layer(20,{where:parkeerverbodWhere(dateSql),outFields:"Dossiernummer,Locatienummer,Status,Adres,Postcode,Reden,Startdatum,Einddatum,Starttijd,Eindtijd,EnkelWeekdagen,GipodID,District",geometry:true,precisie:6})],
      ["iod22",layer(22,{where:`faseEindDatum >= ${dateSql} AND dossierStatus IN ('aanvraag_goedgekeurd','toelating_gegenereerd','toelating_geverifieerd')`,outFields:"dossierNummer,faseId,innameId,dossierStatus,faseNaam,type_dossier,innameTypeNaam,innameBeschrijving,innameHinder,faseStartDatum,faseEindDatum",geometry:true,spatial:true})],
      ["iod23",layer(23,{where:`faseEindDatum >= ${dateSql} AND dossierStatus IN ('aanvraag_goedgekeurd','toelating_gegenereerd','toelating_geverifieerd')`,outFields:"dossierNummer,faseId,innameId,dossierStatus,faseNaam,type_dossier,innameTypeNaam,innameBeschrijving,innameHinder,faseStartDatum,faseEindDatum",geometry:true,spatial:true})],
      ["sgw47",layer(47,{where:`EndDate >= ${dateSql} AND status='vergund'`,outFields:"reference_id,phase_id,status,StartDate,EndDate",geometry:true,spatial:true})],
      ["sgw48",layer(48,{where:`EndDate >= ${dateSql} AND status='vergund'`,outFields:"reference_id,phase_id,status,StartDate,EndDate",geometry:true,spatial:true})],
      ["district",district()],
      ["streets",loadStreetIndex()]
    ];
    const settled=await settleSources(jobs);
    const v=Object.fromEntries(settled),fail=settled.filter(([,x])=>x instanceof Error).map(([n])=>n);
    // Per bron eerlijk melden wat ontbreekt; een halve laag mag niet als volledig doorgaan.
    let mislukt=mislukteOnderdelenPublicSpace(fail);
    const districtGeometry=v.district instanceof Error?null:v.district;
    const parking=v.parking instanceof Error?[]:v.parking,iod=[...(v.iod22 instanceof Error?[]:v.iod22),...(v.iod23 instanceof Error?[]:v.iod23)];
    const sgw=[...(v.sgw47 instanceof Error?[]:v.sgw47).map(feature=>({feature,kind:"Omleiding"})),...(v.sgw48 instanceof Error?[]:v.sgw48).map(feature=>({feature,kind:"Werfzone"}))];
    const streetIndex=v.streets instanceof Error?null:v.streets;
    // In stappen: duizenden features verwerken mag de pagina op een gsm niet stilleggen.
    try{state.items=await collectPublicSpaceInStappen({parkingFeatures:parking,iodFeatures:iod,sgwFeatures:sgw,districtGeometry,streetIndex,postcodes:DISTRICT_POSTCODES})}catch{state.items=[];mislukt=mislukteOnderdelenPublicSpace(["parking","streets"])}
    state.ready=true;meldLiveLaag("publicSpace",state.items,mislukt);
    const s=publicSpaceStats(state.items);meta.textContent=`${s.parking} parkeerverboden · ${s.iod} innames · ${s.sgw} werfzones/omleidingen`;
    note.textContent=`A-Sign, geladen ${new Intl.DateTimeFormat("nl-BE",{dateStyle:"medium",timeStyle:"short"}).format(new Date())}. Alleen goedgekeurde/bevestigde dossiers worden getoond.`+(districtGeometry?" IOD en SGW zijn exact tegen de officiële districtsgrens gecontroleerd.":" IOD en SGW zijn verborgen omdat de officiële districtsgrens niet kon worden geladen.")+(mislukt.length?` ${onvolledigMelding(mislukt)}`:"");
    render();root.classList.remove("loading");
  }
  // Ook laden als alleen "Evenementen" aan staat: A-Sign kent de evenementen op straat (place-view.js).
  window.addEventListener("public-agenda:view-change",()=>{state.shown=60;const v=window.PUBLIC_AGENDA_VIEW;if((v?.enabled("publicSpace")||v?.wantsStreetEvents)&&(v.hasPlace||v.wantsLiveLayers))load();if(state.ready)render()});
  [search,kind].forEach(c=>c?.addEventListener("input",()=>{state.shown=60;render()}));more?.addEventListener("click",()=>{state.shown+=60;render()});
  if("IntersectionObserver"in window){const o=new IntersectionObserver(es=>{if(es.some(e=>e.isIntersecting)){o.disconnect();load()}},{rootMargin:"600px"});o.observe(root)}else load()
}
