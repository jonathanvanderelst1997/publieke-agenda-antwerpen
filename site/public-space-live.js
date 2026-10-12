import {collectPublicSpaceInStappen,publicSpaceStats} from "./public-space-live-core.js";
import {DISTRICT_POSTCODES,parkeerverbodWhere} from "./public-space-core.js";
import {parkeerTitel,parkeerUren,statusNl} from "./place-core.js";
import {onbekendZin} from "./onbekend-zinnen.js";
import {loadStreetIndex} from "./street-source.js";
import {settleSources} from "./agenda-view.js";
import {ASIGN_MAX_URL,asignIdsUrl,asignLayer} from "./asign-query.js";
import {isEvenementDossier} from "./kaart-uitleg.js";
import {laadAlsInBeeld,meldLiveLaag,mislukteOnderdelenPublicSpace,onvolledigMelding} from "./live-lagen.js";

// De A-Sign-lagen van de publieke ruimte, voor het hele district of (met `kader`) rond één straat.
// Alleen de postcodes van het district: "District='ANTWERPEN'" alleen is de hele stad (5.781 in plaats
// van 2.875 parkeerverboden), en dat legde een gsm tot een halve minuut stil. Met de lijn van elk
// parkeerverbod (op 10 cm), voor de knoppen +250 m tot +1 km rond een straat.
// Per laag: de naam, het laagnummer, het veld met het dossiernummer en de vraag.
const layer=(nr,opties)=>asignLayer(nr,opties);
function asignVragen(dateSql){
  const iod=`faseEindDatum >= ${dateSql} AND dossierStatus IN ('aanvraag_goedgekeurd','toelating_gegenereerd','toelating_geverifieerd')`,iodVelden="dossierNummer,faseId,innameId,dossierStatus,faseNaam,type_dossier,innameTypeNaam,innameBeschrijving,innameHinder,faseStartDatum,faseEindDatum";
  const sgw=`EndDate >= ${dateSql} AND status='vergund'`,sgwVelden="reference_id,phase_id,status,StartDate,EndDate";
  return[
    ["parking",20,"Dossiernummer",{where:parkeerverbodWhere(dateSql),outFields:"Dossiernummer,Locatienummer,Status,Adres,Postcode,Reden,Startdatum,Einddatum,Starttijd,Eindtijd,EnkelWeekdagen,GipodID,District",geometry:true,precisie:6}],
    ["iod22",22,"dossierNummer",{where:iod,outFields:iodVelden,geometry:true,spatial:true}],
    ["iod23",23,"dossierNummer",{where:iod,outFields:iodVelden,geometry:true,spatial:true}],
    ["sgw47",47,"reference_id",{where:sgw,outFields:sgwVelden,geometry:true,spatial:true}],
    ["sgw48",48,"reference_id",{where:sgw,outFields:sgwVelden,geometry:true,spatial:true}],
  ];
}
// `oid`: ook OBJECTID, om het kader en de dossiers samen te voegen in de volgorde van de bron (de lijst van
// het hele district komt in die volgorde).
const metOid=(vraag,oid)=>oid?{...vraag,outFields:`${vraag.outFields},OBJECTID`}:vraag;
function asignJobs(dateSql,extra={},{oid=false}={}){return asignVragen(dateSql).map(([naam,nr,,vraag])=>[naam,layer(nr,{...metOid(vraag,oid),...extra})])}
const brusselsDag=()=>{const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Brussels",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const o=Object.fromEntries(p.map(x=>[x.type,x.value]));return`${o.year}-${o.month}-${o.day}`};

// ---- snelheid (P5): het kader van één straat, en de dossiers die erin liggen ----
// Welke dossiers samen één kaart worden (site/place-core.js): een parkeerverbod op meer plaatsen
// ("Ankerrui + 10 andere straten"), een werfzone met haar fasen en omleiding, een evenement met opbouw,
// parcours en afbraak. Hun andere rijen liggen vaak buiten het kader van de straat (of de straal).
const DOSSIER_GROEP={parking:"parking",iod22:"iod",iod23:"iod",sgw47:"sgw",sgw48:"sgw"};
// Alleen een gewoon dossiernummer ("2026-051185", "ET2026001217", "GW2026-000123") gaat in de vraag.
const VEILIG_DOSSIER=/^[A-Za-z0-9][A-Za-z0-9._/-]{0,59}$/;
export const MAX_DOSSIERS=300;
export function dossiersVan(items=[]){
  const uit={parking:new Set(),iod:new Set(),sgw:new Set()};
  for(const i of items){
    const ref=String(i?.reference||"");
    if(!VEILIG_DOSSIER.test(ref))continue;
    if(i.kind==="parking")uit.parking.add(ref);
    else if(i.kind==="sgw")uit.sgw.add(ref);
    else if(i.kind==="iod"&&isEvenementDossier(i))uit.iod.add(ref);
  }
  return Object.fromEntries(Object.entries(uit).map(([k,v])=>[k,[...v].sort()]));
}
export const dossierWhere=(basis,veld,refs)=>`${basis} AND ${veld} IN (${refs.map(r=>`'${r}'`).join(",")})`;
// De dossiers van één laag in stukken, zodat elke vraag naar de ids korter blijft dan de grens van de
// stadsserver (site/asign-query.js: boven ongeveer 2.000 tekens antwoordt hij niet meer).
export function dossierStukken(nr,vraag,veld,refs=[],{maxUrl=ASIGN_MAX_URL}={}){
  const stukken=[];let stuk=[];
  for(const ref of refs){
    const proef=[...stuk,ref];
    if(stuk.length&&asignIdsUrl(nr,{where:dossierWhere(vraag.where,veld,proef),spatial:vraag.spatial}).length>=maxUrl){stukken.push(stuk);stuk=[ref]}
    else stuk=proef;
  }
  if(stuk.length)stukken.push(stuk);
  return stukken;
}
// Twee lijsten features van dezelfde laag samen, elke feature één keer, in de volgorde van OBJECTID.
const oidVan=f=>{const n=Number(f?.attributes?.OBJECTID??f?.properties?.OBJECTID);return Number.isFinite(n)?n:null};
export function samenOpOid(a=[],b=[]){
  const gezien=new Map();
  for(const f of[...a,...b]){const oid=oidVan(f);const k=oid==null?`#${JSON.stringify(f?.attributes||f?.properties||{})}|${JSON.stringify(f?.geometry||null)}`:oid;if(!gezien.has(k))gezien.set(k,f)}
  const volgorde=f=>oidVan(f)??Infinity;
  return[...gezien.values()].sort((x,y)=>volgorde(x)===volgorde(y)?0:volgorde(x)<volgorde(y)?-1:1);
}
// Alle rijen van die dossiers, op dossiernummer en zonder kader, met dezelfde voorwaarden als de lijst van
// het hele district. Faalt één vraag, dan faalt alles (een half dossier zou "+ 4 andere straten" tonen).
async function dossierFeatures(dateSql,refs){
  const lagen=await Promise.all(asignVragen(dateSql).map(([naam,nr,veld,vraag])=>Promise.all(dossierStukken(nr,vraag,veld,refs[DOSSIER_GROEP[naam]]||[]).map(stuk=>layer(nr,{...metOid(vraag,true),where:dossierWhere(vraag.where,veld,stuk)}))).then(delen=>[naam,delen.flat()])));
  return Object.fromEntries(lagen);
}
const verzamel=(f,{district,streetIndex})=>collectPublicSpaceInStappen({parkingFeatures:f.parking,iodFeatures:[...f.iod22,...f.iod23],sgwFeatures:[...f.sgw47.map(feature=>({feature,kind:"Omleiding"})),...f.sgw48.map(feature=>({feature,kind:"Werfzone"}))],districtGeometry:district,streetIndex,postcodes:DISTRICT_POSTCODES});

// Alleen het kader van één straat, voor de plekpagina (site/place-view.js): elke laag in één of twee kleine
// verzoeken in plaats van ongeveer 130 blokken voor het hele district. Zelfde verwerking als de lijst
// hieronder. Daarna, met `dossierIndex` (een functie die de straatassen van het hele district geeft), de
// andere rijen van de dossiers in het kader (dossierFeatures): dan zijn die dossiers precies zoals in de
// lijst van het hele district, ook in een buurstraat binnen de straal. Geeft { items, mislukt, dossiers }:
// `mislukt` de onderdelen van het kader die niet laadden (site/live-lagen.js); `dossiers` "ok" (alle rijen
// van de dossiers erbij), "geen" (geen dossier in het kader), "mislukt" of "te veel" (dan alleen het kader,
// en vult de plekpagina aan met de stand van de ochtend), of "niet" (niet gevraagd).
export async function publiekeRuimteInKader(kader,{district=null,streetIndex=null,dossierIndex=null}={}){
  const dateSql=`DATE '${brusselsDag()}'`;
  const settled=await settleSources(asignJobs(dateSql,{spatial:true,kader},{oid:true}));
  const v=Object.fromEntries(settled),fail=settled.filter(([,x])=>x instanceof Error).map(([n])=>n);
  if(!district)fail.push("district");
  const kaderFeatures=Object.fromEntries(Object.keys(DOSSIER_GROEP).map(n=>[n,v[n] instanceof Error||!Array.isArray(v[n])?[]:v[n]]));
  const items=await verzamel(kaderFeatures,{district,streetIndex});
  const mislukt=mislukteOnderdelenPublicSpace(fail);
  if(mislukt.length||typeof dossierIndex!=="function")return{items,mislukt,dossiers:"niet"};
  const refs=dossiersVan(items),aantal=refs.parking.length+refs.iod.length+refs.sgw.length;
  if(!aantal)return{items,mislukt,dossiers:"geen"};
  if(aantal>MAX_DOSSIERS)return{items,mislukt,dossiers:"te veel"};
  try{
    const[index,extra]=await Promise.all([dossierIndex(),dossierFeatures(dateSql,refs)]);
    if(!index)throw Error("geen straatassen");
    const samen=Object.fromEntries(Object.keys(DOSSIER_GROEP).map(n=>[n,samenOpOid(kaderFeatures[n],extra[n])]));
    return{items:await verzamel(samen,{district,streetIndex:index}),mislukt,dossiers:"ok"};
  }catch{
    return{items,mislukt,dossiers:"mislukt"};
  }
}

const root=typeof document!=="undefined"?document.getElementById("public-space-live"):null;
if(root){
  const state={items:[],shown:60,loaded:false},el=s=>root.querySelector(s);
  const count=el("[data-space-count]"),meta=el("[data-space-meta]"),note=el("[data-space-note]"),search=el("[data-space-search]"),kind=el("[data-space-kind]"),list=el("[data-space-list]"),more=el("[data-space-more]");
  const esc=(v="")=>String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  const fmt=new Intl.DateTimeFormat("nl-BE",{day:"numeric",month:"short",year:"numeric"});
  const date=v=>v&&Number.isFinite(Date.parse(v))?fmt.format(new Date(v)):"";
  const range=i=>i.start&&i.end?`${date(i.start)} – ${date(i.end)}`:i.start?`vanaf ${date(i.start)}`:i.end?`tot ${date(i.end)}`:"timing niet ingevuld";
  async function get(url){const r=await fetch(url,{headers:{Accept:"application/json"}});if(!r.ok)throw Error(`bron antwoordde met HTTP ${r.status}`);const j=await r.json();if(j?.error)throw Error(j.error.message||"ArcGIS-bronfout");return j}
  // A-Sign via de gedeelde ophaler: korte blokken, hoogstens 4 verzoeken tegelijk voor alle lagen (asignJobs).
  async function district(){const u=new URL("https://geodata.antwerpen.be/arcgissql/rest/services/P_Portal/portal_publiek2/MapServer/109/query");u.search=new URLSearchParams({where:"districtnaam='ANTWERPEN'",outFields:"districtcode,districtnaam,afkorting",outSR:"4326",f:"geojson"});const d=await get(u),fs=Array.isArray(d.features)?d.features:[];if(fs.length!==1)throw Error("officiële districtsgrens niet uniek gevonden");return fs[0].geometry}
  function filtered(){const q=String(search?.value||"").trim().toLowerCase(),k=kind?.value||"";return state.items.filter(i=>!window.PUBLIC_AGENDA_VIEW||window.PUBLIC_AGENDA_VIEW.matches(i,"publicSpace")).filter(i=>{const c=[i.kindLabel,i.title,i.location,i.status,i.reference,i.detail,...(i.streets||[]).map(s=>s.name)].join(" ").toLowerCase();return(!q||c.includes(q))&&(!k||i.kind===k)})}
  // Dezelfde woorden als in het plekoverzicht: een titel in gewone taal, geen interne fasenummers.
  const titel=i=>i.kind==="parking"?parkeerTitel(i.reason??i.title):i.kind==="sgw"?(/Werfzone/.test(i.kindLabel)&&/Omleiding/.test(i.kindLabel)?"Werfzone met omleiding":/Omleiding/.test(i.kindLabel)?"Omleiding":"Werfzone"):i.title;
  const details=i=>i.kind==="parking"?[["Reden volgens de stad",i.reason||onbekendZin("reden-niet-gepubliceerd")],["Uren",[parkeerUren(i),i.weekdaysOnly?"alleen op weekdagen":""].filter(Boolean).join(", ")]]:i.kind==="sgw"?[]:[["Detail",i.detail]];
  function card(i){return`<article class="public-space-card"><header><div><span class="public-space-kind ${esc(i.kind)}">${esc(i.kindLabel)}</span><h3>${esc(titel(i))}</h3></div><span class="public-space-status">${esc(statusNl(i.status))}</span></header><p class="public-space-timing">${esc(range(i))}</p><dl>${i.location?`<div><dt>Locatie</dt><dd>${esc(i.location)}</dd></div>`:""}${i.streets?.length?`<div><dt>Straat</dt><dd>${esc(i.streets.map(s=>s.name).join(" · "))}</dd></div>`:""}${details(i).filter(([,v])=>v).map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}<div><dt>Referentie</dt><dd>${esc(i.reference||"Niet ingevuld")}</dd></div><div><dt>Bron</dt><dd>${esc(i.sourceLabel)}</dd></div></dl><footer><span>Alleen publiek bevestigde status</span><a href="${esc(i.sourceUrl)}" target="_blank" rel="noreferrer">Technische stadsbron (A-Sign)</a></footer></article>`}
  function render(){const items=filtered(),shown=items.slice(0,state.shown);list.innerHTML=shown.map(card).join("");count.textContent=`${items.length} maatregelen`;more.hidden=shown.length>=items.length;more.textContent=`Toon meer (${items.length-shown.length} resterend)`}
  async function load(){
    if(state.loaded)return;state.loaded=true;root.classList.add("loading");note.textContent="Bevestigde parkeerverboden, innames en verkeersmaatregelen worden opgehaald…";
    const dateSql=`DATE '${brusselsDag()}'`;
    const jobs=[...asignJobs(dateSql),["district",district()],["streets",loadStreetIndex()]];
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
  // Bij één straat (view.straatSnel) haalt de plekpagina zelf alleen het kader op (publiekeRuimteInKader).
  window.addEventListener("public-agenda:view-change",()=>{state.shown=60;const v=window.PUBLIC_AGENDA_VIEW;if((v?.enabled("publicSpace")||v?.wantsStreetEvents)&&(v.hasPlace||v.wantsLiveLayers)&&!v.straatSnel)load();if(state.ready)render()});
  [search,kind].forEach(c=>c?.addEventListener("input",()=>{state.shown=60;render()}));more?.addEventListener("click",()=>{state.shown+=60;render()});
  laadAlsInBeeld(root,load,{marge:"600px"})
}
