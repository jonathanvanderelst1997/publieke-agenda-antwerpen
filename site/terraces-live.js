import {collectTerracesInStappen} from "./terraces-live-core.js";
import {terrasTitel} from "./place-core.js";
import {loadStreetIndex} from "./street-source.js";
import {asignLayer} from "./asign-query.js";
import {laadAlsInBeeld,meldLiveLaag,onvolledigMelding} from "./live-lagen.js";
// Laag 49 via de gedeelde A-Sign-ophaler (korte blokken, hoogstens 4 verzoeken tegelijk); met `kader` alleen
// rond één straat.
const terrasVraag=(extra={})=>({where:"1=1",outFields:"OBJECTID,ROLnet_ID,TypeTerrasZone,Status,adres,postcode",geometry:true,spatial:true,maxIds:10000,...extra});
// Snelheid (P5): de terrassen in het kader van één straat, voor de plekpagina (site/place-view.js).
export async function terrassenInKader(kader,{district=null,streetIndex=null}={}){
  if(!district)throw Error("officiële districtsgrens ontbreekt");
  const features=await asignLayer(49,terrasVraag({kader}));
  return collectTerracesInStappen(features,district,streetIndex);
}
const root=typeof document!=="undefined"?document.getElementById("terraces-live"):null;
if(root){
  const state={items:[],shown:60,loaded:false},el=s=>root.querySelector(s),count=el("[data-terraces-count]"),note=el("[data-terraces-note]"),search=el("[data-terraces-search]"),list=el("[data-terraces-list]"),more=el("[data-terraces-more]");
  const esc=(v="")=>String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  async function get(url){const r=await fetch(url,{headers:{Accept:"application/json"}});if(!r.ok)throw Error(`bron antwoordde met HTTP ${r.status}`);const j=await r.json();if(j?.error)throw Error(j.error.message||"ArcGIS-bronfout");return j}
  // Laag 49 via de gedeelde A-Sign-ophaler (korte blokken, hoogstens 4 verzoeken tegelijk).
  const terraces=()=>asignLayer(49,terrasVraag());
  async function district(){const u=new URL("https://geodata.antwerpen.be/arcgissql/rest/services/P_Portal/portal_publiek2/MapServer/109/query");u.search=new URLSearchParams({where:"districtnaam='ANTWERPEN'",outFields:"districtcode,districtnaam,afkorting",outSR:"4326",f:"geojson"});const d=await get(u),fs=Array.isArray(d.features)?d.features:[];if(fs.length!==1)throw Error("officiële districtsgrens niet uniek gevonden");return fs[0].geometry}
  function filtered(){const q=String(search?.value||"").trim().toLowerCase();return state.items.filter(item=>!window.PUBLIC_AGENDA_VIEW||window.PUBLIC_AGENDA_VIEW.matches(item,"terraces")).filter(item=>!q||[item.terraceType,item.status,item.address,item.postcode,...(item.streets||[]).map(s=>s.name)].join(" ").toLowerCase().includes(q))}
  function card(item){return`<article class="terrace-card"><header><div><span class="terrace-kind">Terras</span><h3>${esc(terrasTitel(item.terraceType))}</h3></div><span class="terrace-status">${esc(item.status)}</span></header><dl><div><dt>Soort zone volgens de stad</dt><dd>${esc(item.terraceType)}</dd></div>${item.address?`<div><dt>Adres</dt><dd>${esc(item.address)}</dd></div>`:""}${item.streets?.length?`<div><dt>Straat</dt><dd>${esc(item.streets.map(s=>s.name).join(" · "))}</dd></div>`:""}${item.postcode?`<div><dt>Postcode</dt><dd>${esc(item.postcode)}</dd></div>`:""}<div><dt>Bron-ID</dt><dd>${esc(item.recordId)}</dd></div></dl><footer><span>Status letterlijk uit de bron; geen eigen interpretatie.</span><a href="${esc(item.sourceUrl)}" target="_blank" rel="noreferrer">Officiële bronlaag</a></footer></article>`}
  function render(){const items=filtered(),shown=items.slice(0,state.shown);count.textContent=`${items.length} terrasrecords`;list.innerHTML=shown.map(card).join("");more.hidden=shown.length>=items.length;more.textContent=`Toon meer (${Math.max(0,items.length-shown.length)} resterend)`}
  async function load(){if(state.loaded)return;state.loaded=true;root.classList.add("loading");note.textContent="Terrasvergunningen worden privacyveilig uit A-Sign opgehaald…";try{const[features,districtGeometry,streetIndex]=await Promise.all([terraces(),district(),loadStreetIndex()]);state.items=await collectTerracesInStappen(features,districtGeometry,streetIndex);state.ready=true;meldLiveLaag("terraces",state.items,[]);note.textContent="A-Sign terrasvergunningen. Alleen structurele velden worden gelezen; beschrijving en ondernemingsnummer worden niet opgevraagd.";render()}catch(error){count.textContent="Terrassen niet geladen";note.textContent=`${onvolledigMelding(["terrassen"])} (${error?.message||"bronfout"})`;meldLiveLaag("terraces",null,["terrassen"])}finally{root.classList.remove("loading")}}
  // Bij één straat (view.straatSnel) vraagt de plekpagina zelf alleen het kader (terrassenInKader).
  window.addEventListener("public-agenda:view-change",()=>{state.shown=60;const v=window.PUBLIC_AGENDA_VIEW;if(v?.enabled("terraces")&&(v.hasPlace||v.wantsLiveLayers)&&!v.straatSnel)load();if(state.ready)render()});
  search?.addEventListener("input",()=>{state.shown=60;render()});more?.addEventListener("click",()=>{state.shown+=60;render()});laadAlsInBeeld(root,load,{marge:"700px"});
}
