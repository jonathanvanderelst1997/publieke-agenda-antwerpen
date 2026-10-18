import {worksExactSnapshot} from "./works-snapshot.js";
import {collectWorks,worksStats} from "./works-core.js";
import {GIPOD_BRON,GIPOD_METADATA_URL,LOSSE_HINDER_TITEL,LOSSE_HINDER_ZIN,attachHindrance,losseHinder} from "./works-hindrance.js";
import {attachAsSignWorkSupplement} from "./works-asign-supplement.js";
import {applyWorkStreetResolution} from "./street-core.js";
import {onbekendZin} from "./onbekend-zinnen.js";
import {loadStreetIndex} from "./street-source.js";
import {hinderkaart} from "./bezoekers-bronnen.js";
import {asignLayer} from "./asign-query.js";
import {laadAlsInBeeld,meldLiveLaag} from "./live-lagen.js";
import {kaderRond} from "./straat-snapshot.js";
import {AWV_METADATA_URL,attachAwvWorkSupplement,awvBron,awvTekst,laadAwvSupplement} from "./works-awv-supplement.js";

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
// AWV-werfdata (site/sources/awv-werf-supplement.json, van de verversing): één keer per pagina geladen, voor de
// lijst van het district en voor het kader van één straat. Faalt nooit; ontbreekt of veroudert het bestand, dan
// komt er niets bij (site/works-awv-supplement.js). Alleen de werkkaart in de lijst toont de zin; in het kader
// van één straat hangt de aanvulling wel aan het werk, maar de plekpagina (site/place-core.js) toont ze nog niet.
let awvBelofte=null;
const awvSupplement=()=>(awvBelofte||=laadAwvSupplement());

// Snelheid (P5): alleen de werken in het kader van één straat, voor de plekpagina (site/place-view.js). Een
// paar kleine verzoeken in plaats van 7 pagina's werken, 7 pagina's hinder en de A-Sign-blokken van het
// hele district. Zelfde regels als de lijst hieronder: districtsgrens (of de exacte snapshot), gevalideerde
// hinder en het A-Sign-supplement op hetzelfde GIPOD-id. De hinder: een iets ruimer kader (een hinderpunt
// ligt niet altijd bij het werk). Geeft { items, hinderOk }; faalt GIPOD zelf, dan faalt de belofte.
export async function werkenInKader(kader,{district=null,streetIndex=null}={}){
  const bbox=kader.join(","),ruimer=(kaderRond([kader[0],kader[1],kader[2],kader[3]],300)||kader).join(",");
  const[features,hinder,supplement,awv]=await Promise.all([
    gipodLaag("INNAME_PUNT",{bbox,filter:WERK_FILTER}),
    gipodLaag("HINDER_PUNT",{bbox:ruimer,filter:HINDER_FILTER}).then(features=>({ok:true,features})).catch(()=>({ok:false,features:[]})),
    asignLayer(19,supplementVraag(brusselsDag(),{kader})).then(rows=>({ok:true,rows})).catch(()=>({ok:false,rows:[]})),
    awvSupplement(),
  ]);
  let items=attachAsSignWorkSupplement(attachHindrance(collectWorks(features,new Set(worksExactSnapshot.exactGipodIds),district),hinder.features,hinder.ok),supplement.rows,supplement.ok);
  items=attachAwvWorkSupplement(items,awv.items,awv.ok,{vandaag:brusselsDag()});
  if(streetIndex)items=applyWorkStreetResolution(items,streetIndex);
  return{items,hinderOk:hinder.ok};
}

const root=typeof document!=="undefined"?document.getElementById("works-live"):null;
if(root){
  const exactIds=new Set(worksExactSnapshot.exactGipodIds),state={items:[],shown:60,loaded:false,losse:null,awvBijgewerkt:""},el=s=>root.querySelector(s);
  const count=el("[data-works-count]"),meta=el("[data-works-meta]"),note=el("[data-works-note]"),search=el("[data-works-search]"),owner=el("[data-works-owner]"),status=el("[data-works-status]"),list=el("[data-works-list]"),more=el("[data-works-more]");
  const esc=(v="")=>String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  const date=v=>v&&Number.isFinite(Date.parse(v))?new Intl.DateTimeFormat("nl-BE",{day:"numeric",month:"short",year:"numeric"}).format(new Date(v)):"";
  const range=i=>i.start&&i.end?`${date(i.start)} – ${date(i.end)}`:i.start?`vanaf ${date(i.start)}`:i.end?`tot ${date(i.end)}`:"timing niet ingevuld";
  const hinderLabel=i=>!i.hindranceSourceLoaded?"Hinderbron tijdelijk niet geladen":i.hindrance?`${i.hindrance.severe?"Ernstige hinder · ":""}${i.hindrance.consequences.join(" · ")||"Gekoppelde gevalideerde hinder"}`:onbekendZin("hinder-onbekend");
  const aSignText=i=>{const s=i.aSignSupplement;if(!s)return"";const parts=[];if(s.companies.length)parts.push(`Bedrijf volgens A-Sign: ${s.companies.join(" · ")}`);if(s.workTypes.length)parts.push(`Werftype: ${s.workTypes.join(" · ")}`);if(s.phaseStatuses.length)parts.push(`Fasestatus: ${s.phaseStatuses.join(" · ")}`);if(s.trafficImpacts.length)parts.push(`Verkeersimpact: ${s.trafficImpacts.join(" · ")}`);if(s.dossierHindrances.length)parts.push(`Dossierhinder: ${s.dossierHindrances.join(" · ")}`);return parts.join(" · ")};
  function filtered(){const q=String(search?.value||"").trim().toLowerCase(),o=owner?.value||"",st=status?.value||"";return state.items.filter(i=>!window.PUBLIC_AGENDA_VIEW||window.PUBLIC_AGENDA_VIEW.matches(i,"works")).filter(i=>{const c=[i.gipodId,i.title,i.owner,i.ownerGroup,i.status,...(i.workTypes||[]),...(i.occupancyTypes||[]),...(i.hindrance?.consequences||[]),...(i.streets||[]).map(s=>s.name),aSignText(i)].join(" ").toLowerCase();return(!q||c.includes(q))&&(!o||i.ownerGroup===o)&&(!st||i.status===st)})}
  function card(i){const confidence=i.boundaryConfidence==="exact_snapshot"?"Exact tegen districtsgrens bevestigd in laatste snapshot":"Nieuw sinds laatste exacte snapshot; GIPOD-punt ligt binnen officiële districtsgrens";return`<article class="works-live-card"><header><div><span class="works-live-status ${i.status==="In uitvoering"?"running":"planned"}">${esc(i.status)}</span><h3>${esc(i.title)}</h3></div><span class="works-live-owner">${esc(i.ownerGroup)}</span></header><p class="works-live-timing">${esc(range(i))}</p><dl><div><dt>Beheerder/opdrachtgever</dt><dd>${esc(i.owner||"Niet ingevuld")}</dd></div><div><dt>Type</dt><dd>${esc([...(i.occupancyTypes||[]),...(i.workTypes||[])].filter(Boolean).join(" · ")||"Niet ingevuld")}</dd></div><div><dt>Hinder</dt><dd>${esc(hinderLabel(i))}</dd></div><div><dt>GIPOD</dt><dd>${esc(i.gipodId)}</dd></div><div><dt>Afbakening</dt><dd>${esc(confidence)}</dd></div>${i.streets?.length?`<div><dt>Straat</dt><dd>${esc(i.streets.map(s=>s.name).join(" · "))}</dd></div>`:""}${i.aSignSupplement?`<div><dt>A-Sign supplement</dt><dd>${esc(aSignText(i))}</dd></div>`:""}${i.awvSupplement?`<div class="works-live-awv"><dt>AWV-werfdata</dt><dd>${esc(awvTekst(i.awvSupplement))} <a href="${esc(AWV_METADATA_URL)}" target="_blank" rel="noreferrer">${esc(awvBron(state.awvBijgewerkt))}</a></dd></div>`:""}</dl><footer><span>${i.recordCount>1?`${i.recordCount} GIPOD-deelrecords`:"1 GIPOD-record"}</span></footer></article>`}
  // Geen link per werk: nooit naar het ruwe GIPOD-record (site/gipod-bron.js), want dat draagt contactgegevens
  // van personen, en ook niet naar Hinder in Kaart met gipodid, want die opent het detailpaneel van dat record.
  // Onder de lijst één keer de algemene kaart van Hinder in Kaart en één bronvermelding met de datasetfiche.
  const bronEl=el("[data-works-bron]");
  function renderBron(n){if(!bronEl)return;bronEl.hidden=!n;bronEl.innerHTML=n?`<a href="${esc(hinderkaart())}" target="_blank" rel="noreferrer">Officiële kaart: Hinder in Kaart</a> · <a href="${esc(GIPOD_METADATA_URL)}" target="_blank" rel="noreferrer">${esc(GIPOD_BRON)}</a>`:""}
  function render(){const items=filtered(),shown=items.slice(0,state.shown);list.innerHTML=shown.map(card).join("");count.textContent=`${items.length} werken`;more.hidden=shown.length>=items.length;more.textContent=`Toon meer (${items.length-shown.length} resterend)`;renderBron(shown.length);renderLosse()}
  async function district(){const u=new URL("https://geodata.antwerpen.be/arcgissql/rest/services/P_Portal/portal_publiek2/MapServer/109/query");u.search=new URLSearchParams({where:"districtnaam='ANTWERPEN'",outFields:"districtcode,districtnaam,afkorting",outSR:"4326",f:"geojson"});const d=await haalJson(u),fs=Array.isArray(d.features)?d.features:[];if(fs.length!==1)throw Error("officiële districtsgrens niet uniek gevonden");return fs[0].geometry}
  // Het hele district: alle pagina's werken (bbox van het district) en hinder (iets ruimer).
  const gipod=()=>gipodLaag("INNAME_PUNT",{bbox:"4.300791,51.175458,4.444331,51.313629",filter:WERK_FILTER});
  // Hinder zonder gepubliceerd werk (site/works-hindrance.js, losseHinder): gevalideerde GIPOD-hinder in het district
  // waarvan het werk niet bij de getoonde werken staat (en niet in het INNAME_PUNT-antwoord). Alleen de straatnaam,
  // nooit een huisnummer. Geen link per hinder (het ruwe HINDER_PUNT-record heeft contactgegevens): één
  // bronvermelding met de datasetfiche. Zonder grens of hinderbron (state.losse null) geen blok.
  const losseEl=el("[data-works-loose]");
  const waarLos=i=>i.streets?.length?i.streets.map(s=>s.name).join(" · "):i.streetNearby?.[0]?.name?`nabij ${i.streetNearby[0].name}`:"straat niet bepaald";
  function renderLosse(){
    if(!losseEl)return;
    const items=(state.losse||[]).filter(i=>!window.PUBLIC_AGENDA_VIEW||window.PUBLIC_AGENDA_VIEW.matches(i,"works"));
    losseEl.hidden=!items.length;
    if(!items.length){losseEl.innerHTML="";return}
    losseEl.innerHTML=`<h3>${esc(LOSSE_HINDER_TITEL)}</h3><p>${esc(LOSSE_HINDER_ZIN)}</p><ul>${items.map(i=>`<li><strong>${esc(waarLos(i))}</strong> · ${esc(range(i))}${i.severe?" · <em>Ernstige hinder</em>":""}${i.consequences.length?` · ${esc(i.consequences.join(" · "))}`:""} · oorzaak: ${esc(i.oorzaak)}</li>`).join("")}</ul><p class="works-live-loose-bron"><a href="${esc(GIPOD_METADATA_URL)}" target="_blank" rel="noreferrer">${esc(GIPOD_BRON)}</a></p>`;
  }
  // Laag 19 via de gedeelde A-Sign-ophaler (korte blokken, hoogstens 4 verzoeken tegelijk).
  const asignSupplement=()=>asignLayer(19,supplementVraag(brusselsDag()));
  const hindrance=()=>gipodLaag("HINDER_PUNT",{bbox:"4.29,51.17,4.47,51.32",filter:HINDER_FILTER});
  async function load(){if(state.loaded)return;state.loaded=true;root.classList.add("loading");note.textContent="Actuele GIPOD-werken worden opgehaald…";try{const[features,geom,hinderResult,aSignResult,streetResult,awvResult]=await Promise.all([gipod(),district().catch(()=>null),hindrance().then(features=>({ok:true,features})).catch(()=>({ok:false,features:[]})),asignSupplement().then(rows=>({ok:true,rows})).catch(()=>({ok:false,rows:[]})),loadStreetIndex().then(index=>({ok:true,index})).catch(()=>({ok:false,index:null})),awvSupplement()]);state.items=attachAwvWorkSupplement(attachAsSignWorkSupplement(attachHindrance(collectWorks(features,exactIds,geom),hinderResult.features,hinderResult.ok),aSignResult.rows,aSignResult.ok),awvResult.items,awvResult.ok,{vandaag:brusselsDag()});state.awvBijgewerkt=awvResult.bijgewerkt;if(streetResult.ok)state.items=applyWorkStreetResolution(state.items,streetResult.index);const losse=hinderResult.ok?losseHinder(hinderResult.features,{getoond:new Set(state.items.map(i=>Number(i.gipodId))),inRespons:new Set(features.map(f=>Number(f?.properties?.GipodId)).filter(Number.isFinite)),district:geom,nu:new Date()}):null;state.losse=losse&&streetResult.ok?applyWorkStreetResolution(losse,streetResult.index):losse;state.ready=true;meldLiveLaag("works",state.items,[]);meldLiveLaag("losseHinder",state.losse,[]);const s=worksStats(state.items),withHindrance=state.items.filter(i=>i.hindrance).length,withASign=state.items.filter(i=>i.aSignSupplement).length,withAwv=state.items.filter(i=>i.awvSupplement).length,owners=Object.keys(s.owners).sort((a,b)=>a.localeCompare(b,"nl"));owner.innerHTML='<option value="">Alle beheerders</option>'+owners.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join("");meta.textContent=`${s.running} in uitvoering · ${s.planned} gepland · ${withHindrance} met gekoppelde hinder · ${withASign} met A-Sign supplement · ${withAwv} met AWV-werfdata · ${s.exactSnapshot} exact grensbevestigd`+(s.newPointInside?` · ${s.newPointInside} nieuw sinds snapshot`:"")+(state.losse?.length?` · ${state.losse.length} hinder zonder gepubliceerd werk`:"");note.textContent=(geom?`Live GIPOD, gecontroleerd tegen de officiële districtsgrens. Exacte polygonsnapshot: ${date(worksExactSnapshot.observedAt)}. Nieuwe punten binnen de grens worden apart gemarkeerd.`:`Live GIPOD. De officiële grens kon nu niet worden geladen; alleen de exact gevalideerde snapshot van ${date(worksExactSnapshot.observedAt)} wordt getoond.`)+(` ${onbekendZin(hinderResult.ok?"hinder-koppeling":"hinder-niet-geladen")}`)+(aSignResult.ok?" A-Sign werfsignalisatie wordt alleen als aanvullend bedrijf/fasesignaal gekoppeld via hetzelfde GIPOD-id.":" Het aanvullende A-Sign-werfsignalisatiesignaal kon nu niet worden geladen.")+(awvResult.ok?" AWV-werfdata (open data van het Agentschap Wegen en Verkeer) vult een werk alleen aan op hetzelfde GIPOD-id; de status blijft die van GIPOD.":awvResult.reden==="verouderd"?" De AWV-werfdata is ouder dan 3 dagen en wordt daarom niet getoond.":" De AWV-werfdata kon nu niet geladen worden.")+(state.losse?"":" Hinder zonder gepubliceerd werk kon nu niet bepaald worden: de districtsgrens of de hinderbron ontbreekt.");render()}catch(e){state.items=[];count.textContent="Werken tijdelijk niet geladen";meta.textContent="";note.textContent=`De agenda blijft beschikbaar. De live werkenbron kon niet worden gelezen: ${e?.message||"onbekende fout"}.`;list.innerHTML="";meldLiveLaag("works",null,["werken"])}finally{root.classList.remove("loading")}}
  // Bij één straat (view.straatSnel) haalt de plekpagina zelf alleen het kader van die straat op
  // (werkenInKader); de lijst van het hele district laadt dan pas als ze in beeld komt.
  window.addEventListener("public-agenda:view-change",()=>{state.shown=60;const v=window.PUBLIC_AGENDA_VIEW;if(v?.enabled("works")&&(v.hasPlace||v.wantsLiveLayers)&&!v.straatSnel)load();if(state.ready)render()});
  [search,owner,status].forEach(c=>c?.addEventListener("input",()=>{state.shown=60;render()}));more?.addEventListener("click",()=>{state.shown+=60;render()});
  laadAlsInBeeld(root,load,{marge:"500px"})
}
