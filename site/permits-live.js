import {collectPermits,haalVergunningenInKader} from "./permits-live-core.js";
import {duidelijkeKaart} from "./permit-clarity.js";
import {bezoekersHint,bezoekersLinks} from "./bezoekers-bronnen.js";
import {brusselsVandaag,metInzage} from "./inzage-status.js";
import {loadStreetIndex} from "./street-source.js";
import {laadAlsInBeeld} from "./live-lagen.js";
const root=document.getElementById("permits-live");
if(root){
  const count=root.querySelector("[data-permits-count]"),note=root.querySelector("[data-permits-note]"),list=root.querySelector("[data-permits-list]"),search=root.querySelector("[data-permits-search]"),more=root.querySelector("[data-permits-more]");
  const state={items:[],shown:30};
  const esc=(value="")=>String(value).replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]));
  async function get(url){const r=await fetch(url,{headers:{Accept:"application/json"}});if(!r.ok)throw Error(`HTTP ${r.status}`);const j=await r.json();if(j?.error)throw Error(j.error.message||"bronfout");return j}
  async function district(){const u=new URL("https://geodata.antwerpen.be/arcgissql/rest/services/P_Portal/portal_publiek2/MapServer/109/query");u.search=new URLSearchParams({where:"districtnaam='ANTWERPEN'",outFields:"districtcode,districtnaam,afkorting",outSR:"4326",f:"geojson"});const d=await get(u);if(!Array.isArray(d.features)||d.features.length!==1)throw Error("districtsgrens ongeldig");return d.features[0].geometry}
  // Alle dossiers in het kader van het district (site/permits-live-core.js; de plekpagina vraagt voor één
  // straat alleen haar kader).
  const permits=()=>haalVergunningenInKader();
  const visible=()=>{const q=String(search?.value||"").trim().toLowerCase();return state.items.filter(item=>!window.PUBLIC_AGENDA_VIEW||window.PUBLIC_AGENDA_VIEW.matches(item,"permits")).filter(item=>!q||[item.dossier,item.project,item.dossierType,item.purpose,...(item.inhoud?.labels||[]),item.decision,item.authority,item.decisionAuthority,...(item.streets||[]).map(s=>s.name)].join(" ").toLowerCase().includes(q))};
  // Inzageloket: een rechtstreekse link alleen voor een nagekeken dossier, anders een eerlijke zin
  // (site/bezoekers-bronnen.js, site/inzage-status.js). Nooit de startpagina van het loket.
  const inzageTemplate=item=>{const links=bezoekersLinks({source:"permits",item}).map(l=>`<a href="${esc(l.url)}" target="_blank" rel="noreferrer">${esc(l.label)}</a>`),hint=bezoekersHint({source:"permits",item});return `${links.length?`<p class="permit-links">${links.join(" ")}</p>`:""}${hint?`<p>${esc(hint)}</p>`:""}`};
  // Dezelfde titel, statusregel en "Waar" als op de kaart per plek (site/permit-clarity.js).
  // Een kaart die een bewoner openklapte, blijft open als de lijst opnieuw tekent (bijvoorbeeld zodra de wijk of
  // een andere laag klaar is met laden). Zonder dat klapte ze vanzelf weer dicht.
  const card=(item,open=false)=>{const d=duidelijkeKaart({source:"permits"},item);const waar=d.waar;return `<details class="permit-card" data-permit="${esc(item.id||"")}"${open?" open":""}><summary><span><strong>${esc(d.titel)}</strong>${waar.kort?` · ${esc(waar.kort)}`:""}${d.melding?`<br><strong class="permit-alert">${esc(d.melding)}</strong>`:""}</span><span>${esc(item.dossier||item.project)}</span></summary><p>${esc(d.samenvatting)}</p><dl>${d.regels.map(([dt,dd])=>`<div><dt>${esc(dt)}</dt><dd>${esc(dd)}</dd></div>`).join("")}${waar.ingeklapt?`<div><dt>Waar</dt><dd>${esc(waar.straten.join(", "))}</dd></div>`:""}</dl>${inzageTemplate(item)}<details><summary>Technische stadsbron (ArcGIS)</summary><a href="${esc(item.sourceUrl)}" target="_blank" rel="noreferrer">Ruwe brongegevens van dit dossier</a></details></details>`};
  function render(){const items=visible().sort((a,b)=>(b.inzage?1:0)-(a.inzage?1:0)),shown=items.slice(0,state.shown);count.textContent=`${items.length} omgevingsdossiers (aanvragen en beslissingen)`;const open=new Set([...list.querySelectorAll("details.permit-card[open]")].map(el=>el.dataset.permit).filter(Boolean));list.innerHTML=shown.map(item=>card(item,Boolean(item.id)&&open.has(item.id))).join("");more.hidden=shown.length>=items.length;more.textContent=`Toon meer dossiers (${Math.max(0,items.length-shown.length)})`}
  // Pas laden als het nodig is (vroeger bij elk bezoek, ook op de voorpagina waar de vergunningen uit staan):
  // een gekozen wijk of postcode met vergunningen aan, een klik op de soorten, of de lijst komt in beeld.
  // Bij één straat (view.straatSnel) vraagt de plekpagina zelf alleen het kader van die straat.
  let geladen=false;
  const laad=()=>{if(geladen)return;geladen=true;start()};
  window.addEventListener("public-agenda:view-change",()=>{state.shown=30;const v=window.PUBLIC_AGENDA_VIEW;if(v?.enabled("permits")&&(v.hasPlace||v.wantsLiveLayers)&&!v.straatSnel)laad();if(state.ready)render()});
  search?.addEventListener("input",()=>{state.shown=30;render()});more?.addEventListener("click",()=>{state.shown+=30;render()});
  // Nagekeken stand in het Inzageloket (site/sources/inzage-status.json). Ontbreekt dat bestand, dan zegt de
  // kaart gewoon niets over een openbaar onderzoek.
  const inzageStatus=()=>fetch("/sources/inzage-status.json",{headers:{Accept:"application/json"}}).then(r=>r.ok?r.json():null).catch(()=>null);
  const start=()=>Promise.all([permits(),district(),loadStreetIndex(),inzageStatus()]).then(([features,districtGeometry,streetIndex,inzage])=>{state.items=metInzage(collectPermits({features,districtGeometry,streetIndex}),inzage,brusselsVandaag());state.ready=true;window.PUBLIC_AGENDA_LIVE_STREETS=window.PUBLIC_AGENDA_LIVE_STREETS||{};window.PUBLIC_AGENDA_LIVE_STREETS.permits=state.items;window.PUBLIC_AGENDA_LIVE_STREETS.heelDistrict={...(window.PUBLIC_AGENDA_LIVE_STREETS.heelDistrict||{}),permits:true};window.dispatchEvent(new CustomEvent("public-agenda:street-layer",{detail:{name:"permits",items:state.items}}));note.textContent="De openbare bron levert aard en onderwerp van een aanvraag. De agenda toont uitsluitend vaste, privacyveilige categorieën, zonder vrije tekst of namen. Aanvraag is niet hetzelfde als verleende vergunning.";render()}).catch(error=>{note.textContent=`Omgevingsdossiers tijdelijk niet geladen: ${error?.message||"bronfout"}`;count.textContent="Bron tijdelijk niet beschikbaar"});
  laadAlsInBeeld(root,laad,{marge:"600px"});
}
