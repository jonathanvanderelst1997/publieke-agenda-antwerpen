// "Nieuwe werven deze week": het overzicht van site/sources/werven-nieuw.json (lib/werven-nieuw.mjs), elke dag ververst.
//
// Gevraagd in de raadscommissie van 17 november 2026: elke week een overzicht van alle nieuwe werven, zodat werven
// zichtbaar zijn. Twee lijsten: wat deze zeven dagen voor het eerst in GIPOD stond, en wat deze week begint en al eerder
// aangekondigd was. Per werf de titel, de straat met het huisnummer, de periode en de status. Geen opdrachtgever, geen
// contactgegevens en geen link naar een ruw GIPOD-record (site/gipod-bron.js): één bronvermelding met de datasetfiche.
import {GIPOD_BRON,GIPOD_METADATA_URL} from "./gipod-bron.js";

export const WERVEN_NIEUW_BESTAND="/sources/werven-nieuw.json";
export const WERVEN_EERST=12;

const esc=(v)=>String(v??"").replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const datum=new Intl.DateTimeFormat("nl-BE",{timeZone:"Europe/Brussels",weekday:"short",day:"numeric",month:"short"});
const datumJaar=new Intl.DateTimeFormat("nl-BE",{timeZone:"Europe/Brussels",day:"numeric",month:"short",year:"numeric"});
export function dagTekst(iso,{jaar=false}={}){const t=new Date(iso);return Number.isNaN(t.getTime())?"":(jaar?datumJaar:datum).format(t)}
// "van ma 16 nov tot 31 jan 2027": het einde met het jaar als het in een ander jaar valt dan het begin.
export function periodeTekst(begin,einde){
  const b=dagTekst(begin),e=new Date(einde),anderJaar=!Number.isNaN(e.getTime())&&new Date(begin).getUTCFullYear()!==e.getUTCFullYear();
  const t=dagTekst(einde,{jaar:anderJaar});
  if(b&&t)return`van ${b} tot ${t}`;
  if(b)return`vanaf ${b}`;
  return t?`tot ${t}`:"periode niet gepubliceerd";
}
const dagLabel=(dag)=>dagTekst(`${dag}T12:00:00Z`);

export function werfHtml(w){
  const straat=(w.straten||[]).join(" · ")||"straat niet gekend";
  return`<li class="werven-nieuw-werf"><strong>${esc(straat)}</strong><span>${esc(w.titel)}</span><small>${esc(periodeTekst(w.begin,w.einde))}${w.status?` · ${esc(w.status)}`:""}</small></li>`;
}

function lijstHtml(kop,uitleg,werven,aantal,soort){
  if(!aantal)return`<div class="werven-nieuw-lijst"><h3>${esc(kop)}</h3><p class="werven-nieuw-leeg">Geen.</p></div>`;
  const eerst=werven.slice(0,WERVEN_EERST).map(werfHtml).join(""),rest=werven.slice(WERVEN_EERST).map(werfHtml).join("");
  const meer=rest?`<details class="werven-nieuw-meer"><summary>Toon de andere ${werven.length-WERVEN_EERST}</summary><ul>${rest}</ul></details>`:"";
  const afgekapt=aantal>werven.length?`<p class="werven-nieuw-leeg">En nog ${aantal-werven.length} andere: zoek ze in de werken hieronder.</p>`:"";
  return`<div class="werven-nieuw-lijst" data-werven-${soort}><h3>${esc(kop)} <span class="werven-nieuw-aantal">${aantal}</span></h3><p>${esc(uitleg)}</p><ul>${eerst}</ul>${meer}${afgekapt}</div>`;
}

// Het hele blok, zuiver: geen netwerk, geen DOM.
export function wervenNieuwHtml(doc){
  if(!doc||!Array.isArray(doc.nieuw)||!Array.isArray(doc.begint))return"";
  const nieuw=Number.isInteger(doc.aantalNieuw)?doc.aantalNieuw:doc.nieuw.length,begint=Number.isInteger(doc.aantalBegint)?doc.aantalBegint:doc.begint.length;
  return`<div class="works-live-header"><div><span class="works-live-kicker">Werven</span><h2 id="werven-nieuw-titel">Nieuwe werven deze week</h2><p>Van ${esc(dagLabel(doc.van))} tot ${esc(dagLabel(doc.tot))} in district Antwerpen, uit GIPOD. Elke dag ververst.</p></div></div>`
    +`<div class="werven-nieuw-lijsten">`
    +lijstHtml("Nieuw aangekondigd","Voor het eerst in GIPOD deze week.",doc.nieuw,nieuw,"nieuw")
    +lijstHtml("Begint deze week","Al eerder aangekondigd, en deze week van start.",doc.begint,begint,"begint")
    +`</div><p class="works-live-bron">${esc(GIPOD_BRON)}: <a href="${esc(GIPOD_METADATA_URL)}" rel="noopener">datasetfiche</a>. Een werk dat even uit GIPOD verdwijnt en terugkomt, telt niet als nieuw.</p>`;
}

async function toon(){
  const sectie=document.getElementById("werven-nieuw");
  if(!sectie)return;
  try{
    const r=await fetch(WERVEN_NIEUW_BESTAND,{headers:{Accept:"application/json"}});
    if(!r.ok)return;
    const html=wervenNieuwHtml(await r.json());
    if(!html)return;
    sectie.innerHTML=html;
    sectie.hidden=false;
  }catch{/* zonder bestand blijft het blok verborgen; de werken hieronder staan er altijd */}
}
if(typeof document!=="undefined")toon();
