import {geometryIntersectsDistrict} from "./public-space-live-core.js";
import {resolveGeometryStreets} from "./street-core.js";
import {aanvraagInhoud,beslissingsdatumTekst} from "./permit-clarity.js";
import {parcoursGeometrie} from "./parcours-straten.js";
import {straatasNaam} from "./street-core.js";

const LAAG="https://geodata.antwerpen.be/arcgissql/rest/services/P_PiP/pip2_vergunningen/MapServer/5";
// Technische link naar alleen dit dossier, zonder het vrije onderwerp en de naam van de aanvrager.
export function vergunningBronUrl(dossier="",project=""){
  const veld=/^[A-Za-z0-9_-]{4,40}$/.test(dossier)?["Dossiernummer",dossier]:/^[A-Za-z0-9_-]{4,40}$/.test(project)?["ProjectnummerOmgevingsloket",project]:null;
  if(!veld)return LAAG;
  const q=new URLSearchParams({where:`${veld[0]}='${veld[1]}'`,outFields:"Dossiernummer,DOSSIERTYPE,AardAanvraag,Beslissing,DatumBeslissing,Volledig,Ontvankelijk,ProjectnummerOmgevingsloket,behandelendeOverheid,beslissingsoverheid",returnGeometry:"false",f:"html"});
  return `${LAAG}/query?${q}`;
}

const clean=(value,max=160)=>String(value??"").replace(/\s+/g," ").trim().slice(0,max);
const yes=value=>["1","true","ja","yes","y"].includes(clean(value,20).toLowerCase());
const geom=feature=>feature?.geometry||null;
const attrs=feature=>feature?.properties||feature?.attributes||feature||{};
// Soms staat de intrekking alleen in het onderwerp ("INGETROKKEN dd 13/10/2017") en is het veld leeg.
// Alleen een duidelijke stempel telt: in hoofdletters, tussen haakjes of met een datum. "na de eerder
// ingetrokken aanvraag" verbergt niets.
export function ingetrokkenVolgensOnderwerp(onderwerp=""){
  const s=String(onderwerp??"");
  const niet=String.raw`(?<!\b(?:eerder|reeds|vorige|de|het|een|na) )`;
  if(s!==s.toUpperCase()&&new RegExp(niet+String.raw`\b(?:INGETROKKEN|STOPGEZET)\b`).test(s))return true;
  return new RegExp(String.raw`\((?:ingetrokken|stopgezet)\)|${niet}\b(?:ingetrokken|stopgezet) *(?:op|dd|d\.d\.|per)? *\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b`,"i").test(s);
}

export function normalizePermit(row={}){
  const dossier=clean(row.Dossiernummer,40);
  const project=clean(row.ProjectnummerOmgevingsloket,40);
  const type=clean(row.DOSSIERTYPE,80);
  if(!dossier&&!project)return null;
  if(yes(row.Ingetrokken)||yes(row.Stopgezet)||ingetrokkenVolgensOnderwerp(row.Onderwerp))return null;
  // Vrije onderwerptekst en namen worden nooit uitgegeven; alleen vaste labels en aantallen.
  const inhoud=aanvraagInhoud(row.AardAanvraag,row.Onderwerp,row.behandelendeOverheid);
  return{
    id:`permit:${dossier||project}`,
    dossier,
    project,
    dossierType:type,
    purpose:inhoud.groep,
    inhoud,
    decisionDateLabel:beslissingsdatumTekst(row.DatumBeslissing),
    decision:clean(row.Beslissing,80),
    decisionDate:clean(row.DatumBeslissing,20),
    complete:clean(row.Volledig,20),
    admissible:clean(row.Ontvankelijk,20),
    authority:clean(row.behandelendeOverheid,120),
    decisionAuthority:clean(row.beslissingsoverheid,120),
  };
}

// De straten van een vergunning staan op afstand: de dichtste straat eerst (dat is meestal de straat
// waaraan het perceel ligt), de andere daarna. place-core.js toont ze als "ook dicht bij".
const opAfstand=afstanden=>[...afstanden.values()].sort((a,b)=>a.distanceMeters-b.distanceMeters||a.ref.name.localeCompare(b.ref.name,"nl")).map(x=>x.ref);
const sleutel=s=>[s.id,s.name,s.postcode].join("|");
export function collectPermits({features=[],districtGeometry=null,streetIndex=null}={}){
  const byId=new Map(),afstanden=new Map(),vormen=new Map();
  for(const feature of features){
    if(districtGeometry&&!geometryIntersectsDistrict(geom(feature),districtGeometry))continue;
    const normalized=normalizePermit(attrs(feature));
    if(!normalized)continue;
    const street=streetIndex?resolveGeometryStreets(geom(feature),streetIndex,{maxDistanceMeters:24}):{streets:[],confidence:"unresolved",distanceMeters:null};
    const item={...normalized,streets:street.streets,streetResolution:street.confidence,streetDistanceMeters:street.distanceMeters,sourceLabel:"Stad Antwerpen · omgevingsvergunningen in behandeling",sourceUrl:vergunningBronUrl(normalized.dossier,normalized.project)};
    const per=afstanden.get(item.id)||new Map();afstanden.set(item.id,per);
    for(const x of street.metAfstand||street.streets.map(ref=>({ref,distanceMeters:Infinity}))){const k=sleutel(x.ref),cur=per.get(k);if(!cur||x.distanceMeters<cur.distanceMeters)per.set(k,x)}
    // Het perceel zelf, voor de straal rond een straat (site/neighborhood-core.js vormBinnenStraal).
    if(geom(feature)){const l=vormen.get(item.id);if(l)l.push(feature);else vormen.set(item.id,[feature])}
    const current=byId.get(item.id);
    if(!current){byId.set(item.id,item);item.streets=opAfstand(per);continue}
    current.streets=opAfstand(per);
  }
  for(const[id,item]of byId){const v=vormen.has(id)?parcoursGeometrie(vormen.get(id)):null;if(v&&(v.vlakken.length||v.lijnen.length))item.vorm=v}
  return[...byId.values()].sort((a,b)=>a.dossierType.localeCompare(b.dossierType,"nl")||a.dossier.localeCompare(b.dossier,"nl"));
}

// ---------- adres ----------
// Regel van de eigenaar van 26 oktober 2026: een bouwaanvraag of vergunning staat er met haar huisnummer ("gewoon dat ze
// weten waar het is"), nooit met de naam van een aanvrager of eigenaar. De laag van de vergunningen heeft geen adres, wel het
// perceel: het adres zijn de adresposities van de stad (CRAB, zoals bij de werken in lib/kaart-uitleg-refresh.mjs) die op dat
// perceel liggen. Alleen straat en huisnummer: geen busnummer (één appartement), geen naam.
export const CRAB_ADRESSEN="https://geodata.antwerpen.be/arcgissql/rest/services/P_Publiek/CRAB_Adresposities_wgs84/MapServer/0/query";
// Zoveel percelen per vraag (één veelhoek met hun ringen), en zoveel vragen tegelijk.
export const PERCELEN_PER_VRAAG=40;
export const VRAGEN_TEGELIJK=3;
// Een adrespositie op de rand van het perceel telt mee (hoogstens zoveel meter erbuiten).
const RAND_METER=1;
const MAX_PAGINAS=10;
// Een huisnummer: cijfers met hoogstens twee letters ("12", "44A", "3bis" niet). Nooit 0.
const HUISNR=/^([1-9]\d{0,3})([A-Za-z]{0,2})$/;
const nrVan=value=>{const m=String(value??"").trim().match(HUISNR);return m?{n:Number(m[1]),tekst:`${m[1]}${m[2].toUpperCase()}`}:null};
// "Proefstraat 12", "Proefstraat 12–16" (de laagste en de hoogste), of twee straten: "Proefstraat 12–16 en Voorbeeldlaan 3".
// `voorkeur`: de straten van het dossier (de dichtste eerst); bij evenveel nummers gaat die volgorde voor.
export function vergunningAdres(adressen=[],voorkeur=[]){
  const per=new Map();
  for(const a of adressen){const straat=clean(a?.straat,120),nr=nrVan(a?.huisnummer);if(!straat||!nr)continue;const l=per.get(straat)||new Map();l.set(nr.tekst,nr);per.set(straat,l)}
  const rang=naam=>{const i=voorkeur.indexOf(naam);return i<0?Infinity:i};
  const straten=[...per].sort((a,b)=>b[1].size-a[1].size||rang(a[0])-rang(b[0])||a[0].localeCompare(b[0],"nl"));
  const deel=([straat,nummers])=>{const lijst=[...nummers.values()].sort((a,b)=>a.n-b.n||a.tekst.localeCompare(b.tekst));const lo=lijst[0],hi=lijst.at(-1);return lo.n===hi.n?`${straat} ${lijst.length===1?lo.tekst:String(lo.n)}`:`${straat} ${lo.n}–${hi.n}`};
  return straten.slice(0,2).map(deel).join(" en ");
}
// Ligt een punt in een vlak (de buitenste ring, niet in een gat), of hoogstens RAND_METER erbuiten?
const K=Math.cos(51.2*Math.PI/180),MX=111320*K,MY=110540;
function afstandTotRand(p,ring){let best=Infinity;for(let i=1;i<ring.length;i++){const a=ring[i-1],b=ring[i];const ax=(b[0]-a[0])*MX,ay=(b[1]-a[1])*MY,px=(p[0]-a[0])*MX,py=(p[1]-a[1])*MY;const l=ax*ax+ay*ay,t=l?Math.max(0,Math.min(1,(px*ax+py*ay)/l)):0;best=Math.min(best,Math.hypot(px-t*ax,py-t*ay))}return best}
function inRing(p,ring){let binnen=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[j],b=ring[i];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<((b[0]-a[0])*(p[1]-a[1]))/(b[1]-a[1])+a[0])binnen=!binnen}return binnen}
export function opPerceel(p,vorm){
  for(const vlak of vorm?.vlakken||[]){
    let binnen=false;for(const ring of vlak)if(inRing(p,ring))binnen=!binnen;
    if(binnen||vlak.some(ring=>afstandTotRand(p,ring)<=RAND_METER))return true;
  }
  return false;
}
const kaderVan=vorm=>{let k=null;for(const vlak of vorm?.vlakken||[])for(const ring of vlak)for(const p of ring)k=k?[Math.min(k[0],p[0]),Math.min(k[1],p[1]),Math.max(k[2],p[0]),Math.max(k[3],p[1])]:[p[0],p[1],p[0],p[1]];return k};
const raakt=(a,b)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
// Percelen in groepjes van hoogstens `per`, zonder twee percelen die elkaar raken in hetzelfde groepje: één veelhoek met
// overlappende ringen zou de overlap als gat lezen. Een perceel dat bij een ander dossier al gevraagd is, één keer.
export function perceelGroepen(items=[],per=PERCELEN_PER_VRAAG){
  const groepen=[];
  for(const item of items){
    const kader=kaderVan(item?.vorm);if(!kader)continue;
    const groep=groepen.find(g=>g.items.length<per&&!g.kaders.some(k=>raakt(k,kader)));
    if(groep){groep.items.push(item);groep.kaders.push(kader)}else groepen.push({items:[item],kaders:[kader]});
  }
  return groepen.map(g=>g.items);
}
// De adresposities op de percelen van een groepje (één veelhoek met al hun ringen), of in het kader van één perceel
// (`kader`: voor een perceel waarvan de stad de vorm weigert; opPerceel kiest daarna de adressen op het perceel zelf).
async function adresPosities(items,fetchImpl,{kader=null}={}){
  const rings=items.flatMap(item=>(item.vorm?.vlakken||[]).flat());
  const geometrie=kader?{geometry:kader.join(","),geometryType:"esriGeometryEnvelope"}:{geometry:JSON.stringify({rings,spatialReference:{wkid:4326}}),geometryType:"esriGeometryPolygon",distance:String(RAND_METER),units:"esriSRUnit_Meter"};
  const punten=[];
  for(let pagina=0;pagina<MAX_PAGINAS;pagina++){
    const body=new URLSearchParams({...geometrie,inSR:"4326",spatialRel:"esriSpatialRelIntersects",outFields:"STRAATNAAM,STRAATNM,HUISNR",returnGeometry:"true",outSR:"4326",orderByFields:"OBJECTID ASC",resultOffset:String(pagina*1000),resultRecordCount:"1000",f:"json"});
    const r=await fetchImpl(CRAB_ADRESSEN,{method:"POST",body,headers:{Accept:"application/json","Content-Type":"application/x-www-form-urlencoded"}});
    if(!r.ok)throw Error(`HTTP ${r.status}`);
    const j=await r.json();
    if(j?.error||!Array.isArray(j?.features))throw Error("adresposities ontbreken");
    for(const f of j.features){const a=f?.attributes||{},g=f?.geometry;if(Number.isFinite(g?.x)&&Number.isFinite(g?.y))punten.push({p:[g.x,g.y],straat:straatasNaam(a.STRAATNAAM||a.STRAATNM),huisnummer:a.HUISNR})}
    if(!j.exceededTransferLimit&&j.features.length<1000)return punten;
  }
  return punten;
}
// Zet `address` op elk dossier met een perceel waarop de stad een adres kent. Een vraag die faalt, laat die dossiers zonder
// adres (de kaart toont dan de straten, zoals vroeger); dit gooit nooit een fout. Geeft een nieuwe lijst.
export async function adressenVoorVergunningen(items=[],{fetch:fetchImpl=(...a)=>globalThis.fetch(...a),per=PERCELEN_PER_VRAAG,tegelijk=VRAGEN_TEGELIJK}={}){
  const adres=new Map();
  const groepen=perceelGroepen(items.filter(item=>item?.vorm?.vlakken?.length),per);
  // Eén perceel met een vorm die de stad niet aanvaardt (de vraag geeft dan een fout voor het hele groepje), houdt de rest
  // niet tegen: het groepje wordt in tweeën gevraagd, tot dat ene perceel overblijft (dat blijft zonder adres).
  // Lukt ook dat niet, dan het kader van dat perceel (een rechthoek aanvaardt de stad altijd).
  const neem=(groep,punten)=>{for(const item of groep){const tekst=vergunningAdres(punten.filter(x=>opPerceel(x.p,item.vorm)),(item.streets||[]).map(s=>s?.name));if(tekst)adres.set(item.id,tekst)}};
  async function zoek(groep){
    try{neem(groep,await adresPosities(groep,fetchImpl))}
    catch{
      if(groep.length>=2){const helft=Math.ceil(groep.length/2);await zoek(groep.slice(0,helft));await zoek(groep.slice(helft));return}
      const kader=kaderVan(groep[0].vorm),m=RAND_METER/70000;
      try{neem(groep,await adresPosities(groep,fetchImpl,{kader:[kader[0]-m,kader[1]-m,kader[2]+m,kader[3]+m]}))}catch{/* dit dossier blijft zonder adres */}
    }
  }
  let i=0;
  async function werker(){while(i<groepen.length)await zoek(groepen[i++])}
  await Promise.all(Array.from({length:Math.max(1,tegelijk)},werker));
  return items.map(item=>adres.has(item?.id)?{...item,address:adres.get(item.id)}:item);
}

// ---------- ophalen ----------
// Het kader van het district (zoals de andere live lagen), of een kleiner kader rond één straat.
export const DISTRICT_KADER = Object.freeze([4.300791, 51.175458, 4.444331, 51.313629]);
const VELDEN = "DOSSIERTYPE,Dossiernummer,AardAanvraag,Onderwerp,Beslissing,DatumBeslissing,Volledig,Ontvankelijk,Ingetrokken,Stopgezet,ProjectnummerOmgevingsloket,behandelendeOverheid,beslissingsoverheid";
async function haalJson(url, fetchImpl) {
  const r = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (j?.error) throw Error(j.error.message || "bronfout");
  return j;
}
// De ruwe dossiers in een kader: eerst de ids, dan de details in blokken van 500. Het onderwerp (vrije
// tekst, soms met een naam) komt alleen binnen om een intrekking te herkennen; normalizePermit geeft het nooit uit.
export async function haalVergunningenInKader(kader = DISTRICT_KADER, { fetch: fetchImpl = (...a) => globalThis.fetch(...a) } = {}) {
  const base = `${LAAG}/query`, idsUrl = new URL(base);
  idsUrl.search = new URLSearchParams({ where: "1=1", geometry: kader.join(","), geometryType: "esriGeometryEnvelope", inSR: "4326", spatialRel: "esriSpatialRelIntersects", returnIdsOnly: "true", f: "json" });
  const idData = await haalJson(idsUrl, fetchImpl), ids = Array.isArray(idData.objectIds) ? idData.objectIds : [];
  if (ids.length > 10000) throw Error("te veel omgevingsdossiers");
  const features = [];
  for (let i = 0; i < ids.length; i += 500) {
    const u = new URL(base);
    u.search = new URLSearchParams({ objectIds: ids.slice(i, i + 500).join(","), outFields: VELDEN, returnGeometry: "true", outSR: "4326", f: "json" });
    const d = await haalJson(u, fetchImpl);
    if (!Array.isArray(d.features)) throw Error("omgevingsdossiers ontbreken");
    features.push(...d.features);
  }
  return features;
}
// Snelheid (P5): de vergunningen in het kader van één straat, voor de plekpagina (site/place-view.js).
// `volledigeIndex`: een functie die de straatassen van het hele district geeft (die laden op de plekpagina
// al). Een aanvraag die ver buiten het kader reikt (een leidingwerf, de Oosterweelverbinding) kent dan al
// haar straten, in dezelfde volgorde als vroeger ("Amerikadok-Zuidkaai · ook dicht bij … en 39 andere
// straten"). Lukt dat niet, dan de straatassen van het kader (`streetIndex`).
// Met het adres van elk dossier (adressenVoorVergunningen; lukt dat niet, dan zonder adres).
export async function vergunningenInKader(kader, { district = null, streetIndex = null, volledigeIndex = null, fetch: fetchImpl } = {}) {
  const [features, heel] = await Promise.all([
    haalVergunningenInKader(kader, fetchImpl ? { fetch: fetchImpl } : {}),
    typeof volledigeIndex === "function" ? Promise.resolve().then(volledigeIndex).catch(() => null) : null,
  ]);
  const items = collectPermits({ features, districtGeometry: district, streetIndex: heel || streetIndex });
  return adressenVoorVergunningen(items, fetchImpl ? { fetch: fetchImpl } : {});
}
