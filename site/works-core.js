import {adresDeel} from "./huisnummers.js";
import {zonderToevoegingInTekst} from "./witte-lijst.js";

export function normalizeText(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
// Een tekst van GIPOD (de omschrijving van een werk, een evenement of een markt; de omschrijving van een hinder), zoals hij
// binnenkomt: zonder de homoniemtoevoeging van de straatas ("2018 ANTWERPEN, PROEFSTRAAT_AN 12" wordt "2018 ANTWERPEN,
// PROEFSTRAAT 12"; site/witte-lijst.js). Dit is de ingang voor GIPOD: titels, de historiek en de huisnummerregel krijgen zo de
// gewone straatnaam.
export const gipodTekst=(value="")=>zonderToevoegingInTekst(normalizeText(value));

// ---------- de plaats exact, nooit "verhuis" ----------
// Besluit van de eigenaar (18 oktober 2026) voor de werken van GIPOD: de PLAATS mag exact (de straat met het huisnummer
// of het bereik, zoals de bron ze geeft, ook als het nummer aan een code plakt: "PROEFSTRAAT 1DN02"), maar niets dat over
// een persoon of zijn huishouden vertelt. Een verhuis is privé: het woord ("verhuis", "verhuislift", "verhuizing" ...)
// komt bij een werk nergens publiek. Namen (naamNaCodeWeg in site/kaart-uitleg.js) en contactgegevens (CONTACT) blijven
// weg zoals voorheen. Dit is de ingang voor GIPOD (collectWorks, de hinderfasen in site/works-hindrance.js): de site, de
// historiek, de straatbestanden en kaart-uitleg.json krijgen een werk zo binnen. werkZonderVerhuis past dezelfde regel
// toe op wat al bewaard was (lib/historiek-privacy.mjs, feitenZonderVerhuis in site/kaart-uitleg.js).
// Zo'n tekst laat geen eigen spoor na (nakijkronde van head 1ed84e65: een vaste vervangtekst stond alleen waar het woord
// had gestaan, en wie deze code leest, kon dat terugrekenen):
// - een omschrijving van een werk met "verhuis" houdt alleen haar adres, zoals de beheerder het schreef (adresDeel in
//   site/huisnummers.js: de stukken die alleen een postcode, de gemeente, een straat of een huisnummer zijn): "2060 Antwerpen,
//   Proefstraat 12 - verhuislift" wordt "2060 Antwerpen, Proefstraat 12", precies de titel van een werk waarvoor GIPOD alleen
//   het adres geeft (dat komt vaak voor). Zonder adres erin is het de titel van een werk zonder omschrijving (GEEN_OMSCHRIJVING,
//   zoals GIPOD een werk zonder Description geeft). Een naam of een reden die erbij stond, valt zo mee weg; het adres niet
//   (nakijkronde van head c4bb2927: "het exacte adres tonen, ook bij één huis");
// - een hinderfase met "verhuis" is er niet, zoals een hinderfase zonder omschrijving;
// - de vaste soort inname van GIPOD voor een lift of levering ("(Verhuis)lift/levering") heet "Lift/levering", en een werk
//   met die soort INNAME_LIFT, zoals elk werk met die soort inname;
// - een opdrachtgever met "verhuis" in zijn naam valt weg (zijn groep wordt "Andere").
// Het woord telt ook met een verborgen teken of een accent erin: de vergelijking gebeurt op de NFKD-vorm zonder opmaaktekens
// (\p{Cf}: een zachte afbreking U+00AD, een zero-width teken U+200B of U+2060 ...) en zonder combinerende accenten (\p{M}),
// zodat "Ver\u00ADhuis", "Ver\u200Bhuislift", "Verhúis" en "ｖｅｒｈｕｉｓ" niet langs de regel glippen (nakijkronde van head
// 1ed84e65). Dezelfde vergelijking staat in VERHUIS_IN_WERK (lib/kaart-uitleg-validatie.mjs, zonder imports uit site/).
export const verhuisVorm=(value="")=>String(value??"").normalize("NFKD").replace(/[\p{Cf}\p{M}]/gu,"");
const VERHUIS_WOORD=/verhui[sz]/i;
export const VERHUIS=Object.freeze({test:(value)=>VERHUIS_WOORD.test(verhuisVorm(value))});
export const GEEN_OMSCHRIJVING="Werk in openbaar domein";
export const INNAME_LIFT="Inname voor een lift of levering";
export const zonderVerhuis=(value="")=>(VERHUIS.test(String(value??""))?"":value);
// Een omschrijving van een werk: met "verhuis" alleen haar adres (zonder de woorden met dat woord), of "".
export const adresZonderVerhuis=(value="")=>(VERHUIS.test(String(value??""))?adresDeel(value,{weg:(woord)=>VERHUIS.test(woord)}):value);
// "(Verhuis)lift/levering" wordt "Lift/levering", ook in een lijst ("Container;(Verhuis)lift/levering"). Een andere soort
// met "verhuis" wordt "Andere" (zoals GIPOD een soort zonder naam noemt).
export const innameZonderVerhuis=(value="")=>String(value??"").split(";").map(t=>{
  if(!VERHUIS.test(t))return t;
  const zonder=verhuisVorm(t).replace(/\(\s*verhui[sz]\p{L}*\s*\)\s*/giu,"").trim();
  return !zonder||VERHUIS.test(zonder)?"Andere":zonder.charAt(0).toUpperCase()+zonder.slice(1);
}).join(";");
// Een soort (kaart-uitleg.json, een oudere verversing): "Verhuislift of levering" (de vaste soort inname) is INNAME_LIFT;
// een andere soort met dat woord is er niet (geen soort, zoals bij een werk waarvan de tekst niets zegt).
export const soortZonderVerhuis=(value="")=>(VERHUIS.test(String(value??""))?(/lift|levering/i.test(value)?INNAME_LIFT:""):value);
const INNAME_VELDEN=new Set(["occupancyTypes","workTypes"]);
const SOORT_VELDEN=new Set(["soort","innameSoort"]);
// Een lijst van fasen: de hinderfasen van een werk ("phases", met hun omschrijving) en de fasen in kaart-uitleg.json
// ("fasen", met hun naam). Een fase met dat woord valt weg, zoals collectHindrance een fase zonder omschrijving weglaat.
const FASE_TEKST=Object.freeze({phases:"description",fasen:"naam"});
// Een werk (diep: de hinder en haar fasen, een wijziging in de historiek, de feiten in kaart-uitleg.json) zonder
// "verhuis", per veld zoals hierboven. "inname" is de leesbare lijst van kaart-uitleg.json ("lift of levering").
export function werkZonderVerhuis(waarde,sleutel=""){
  if(typeof waarde==="string"){
    if(!VERHUIS.test(waarde))return waarde;
    if(INNAME_VELDEN.has(sleutel))return innameZonderVerhuis(waarde);
    if(SOORT_VELDEN.has(sleutel))return soortZonderVerhuis(waarde);
    if(sleutel==="inname")return /lift|levering/i.test(waarde)?"lift of levering":"";
    if(sleutel==="ownerGroup")return "Andere";
    if(sleutel==="title")return adresZonderVerhuis(waarde)||GEEN_OMSCHRIJVING;
    if(sleutel==="omschrijving")return adresZonderVerhuis(waarde);
    return "";
  }
  if(Array.isArray(waarde)){
    const veld=FASE_TEKST[sleutel];
    const lijst=veld?waarde.filter(v=>!(v&&typeof v==="object"&&VERHUIS.test(String(v[veld]??"")))):waarde;
    const uit=lijst.map(v=>werkZonderVerhuis(v,sleutel));
    return sleutel==="inname"?uit.filter(Boolean):uit;
  }
  if(waarde&&typeof waarde==="object"){
    const uit=Object.fromEntries(Object.entries(waarde).map(([k,v])=>[k,werkZonderVerhuis(v,k)]));
    // Een soort die zo wegvalt, neemt haar bron mee; een soort inname zonder naam staat er niet.
    if(typeof waarde.soort==="string"&&waarde.soort&&!uit.soort&&"soortBron" in uit)uit.soortBron="";
    if("innameSoort" in uit&&!uit.innameSoort&&waarde.innameSoort)delete uit.innameSoort;
    return uit;
  }
  return waarde;
}
function pointOnSegment(point,a,b,e=1e-10){const[px,py]=point,[ax,ay]=a,[bx,by]=b;const c=(bx-ax)*(py-ay)-(by-ay)*(px-ax);if(Math.abs(c)>e)return false;return px>=Math.min(ax,bx)-e&&px<=Math.max(ax,bx)+e&&py>=Math.min(ay,by)-e&&py<=Math.max(ay,by)+e}
function pointInRing(point,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[j],b=ring[i];if(pointOnSegment(point,a,b))return true;if((a[1]>point[1])!==(b[1]>point[1])){const x=((b[0]-a[0])*(point[1]-a[1]))/(b[1]-a[1])+a[0];if(point[0]<x)inside=!inside}}return inside}
function pointInPolygon(point,rings=[]){if(!rings.length||!pointInRing(point,rings[0]))return false;return !rings.slice(1).some(h=>pointInRing(point,h))}
export function pointInGeometry(point,geometry){if(!Array.isArray(point)||point.length<2)return false;if(geometry?.type==="Polygon")return pointInPolygon(point,geometry.coordinates);if(geometry?.type==="MultiPolygon")return geometry.coordinates.some(p=>pointInPolygon(point,p));return false}
export function ownerGroup(owner=""){const t=normalizeText(owner).toLowerCase();if(t.includes("fluvius"))return"Fluvius";if(t.includes("proximus"))return"Proximus";if(t.includes("water-link")||t.includes("water link"))return"water-link";if(t.includes("aquafin")||t.includes("riolink"))return"Aquafin / Rio-link";if(t.includes("de lijn")||t.includes("vervoermaatschappij"))return"De Lijn";if(t.includes("wegen en verkeer")||t.includes("awv")||t.includes("lantis"))return"AWV / Lantis";if(t.includes("stad antwerpen")||t.includes("vespa"))return"Stad Antwerpen";if(t.includes("wyre")||t.includes("telenet")||t.includes("eurofiber"))return"Telecom / kabel";if(t.includes("haven"))return"Haven";return owner?"Andere":"Onbekend"}
const earlier=(a,b)=>!a?(b||""):!b?a:(String(a).localeCompare(String(b))<=0?a:b);
const later=(a,b)=>!a?(b||""):!b?a:(String(a).localeCompare(String(b))>=0?a:b);
// Het dossiernummer van een werfzone in A-Sign (signalisatievergunning), zoals GIPOD het in Reference zet: "GW2026-001601".
// Alleen dat patroon: Reference is elders vrije tekst van een aannemer (soms met een naam of een adres), die gaat nooit mee.
export const WERF_DOSSIER=/^GW\d{4}-\d{6}$/;
export const werfDossier=(value)=>{const t=normalizeText(value);return WERF_DOSSIER.test(t)?t:""};
// De werken in het district, per GIPOD-id. Nooit de Uri of een andere link naar het ruwe INNAME_PUNT-record
// (site/gipod-bron.js): dat record draagt ContactOrganisations. De site linkt naar de algemene kaart van Hinder in
// Kaart, nooit met gipodid (site/bezoekers-bronnen.js).
export function collectWorks(features=[],exactIds=new Set(),districtGeometry=null){
  const grouped=new Map();
  for(const feature of features){
    const point=feature?.geometry?.coordinates;if(feature?.geometry?.type!=="Point"||!Array.isArray(point)||!point.slice(0,2).every(Number.isFinite))continue;
    const p=feature.properties||{},gipodId=Number(p.GipodId);if(!Number.isFinite(gipodId))continue;
    const exact=exactIds.has(gipodId),inside=districtGeometry?pointInGeometry(point,districtGeometry):false;if(!exact&&!inside)continue;
    const cur=grouped.get(gipodId)||{gipodId,dossier:"",title:adresZonderVerhuis(gipodTekst(p.Description))||GEEN_OMSCHRIJVING,owner:werkZonderVerhuis(normalizeText(p.Owner),"owner"),ownerGroup:ownerGroup(p.Owner),status:normalizeText(p.Status)||"Onbekend",start:p.Start||"",end:p.End||"",workTypes:new Set(),occupancyTypes:new Set(),lastModified:p.LastModifiedOn||"",point:point.slice(0,2),recordCount:0,boundaryConfidence:exact?"exact_snapshot":"point_inside_new"};
    cur.recordCount+=1;if(!cur.dossier)cur.dossier=werfDossier(p.Reference);cur.start=earlier(cur.start,p.Start||"");cur.end=later(cur.end,p.End||"");cur.lastModified=later(cur.lastModified,p.LastModifiedOn||"");if(p.Status==="In uitvoering")cur.status="In uitvoering";if(p.PublicDomainOccupancyTypes)cur.occupancyTypes.add(innameZonderVerhuis(normalizeText(p.PublicDomainOccupancyTypes)));if(p.GroundworkSpecification)cur.workTypes.add(innameZonderVerhuis(normalizeText(p.GroundworkSpecification)));if(exact)cur.boundaryConfidence="exact_snapshot";grouped.set(gipodId,cur);
  }
  return [...grouped.values()].map(({dossier,...i})=>({...i,...(dossier?{dossier}:{}),workTypes:[...i.workTypes],occupancyTypes:[...i.occupancyTypes]})).sort((a,b)=>(a.status==="In uitvoering"?0:1)-(b.status==="In uitvoering"?0:1)||String(a.start||"9999").localeCompare(String(b.start||"9999"))||a.title.localeCompare(b.title,"nl"));
}
export function worksStats(items=[]){const s={total:items.length,running:0,planned:0,exactSnapshot:0,newPointInside:0,owners:{}};for(const i of items){if(i.status==="In uitvoering")s.running++;if(i.status==="Concreet gepland")s.planned++;if(i.boundaryConfidence==="exact_snapshot")s.exactSnapshot++;if(i.boundaryConfidence==="point_inside_new")s.newPointInside++;s.owners[i.ownerGroup]=(s.owners[i.ownerGroup]||0)+1}return s}
