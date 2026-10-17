// AWV-werfdata als aanvulling op een GIPOD-werk dat al in de lijst staat (docs/WORKS_LIVE_SOURCE_POLICY.md).
// De verversing schrijft site/sources/awv-werf-supplement.json (lib/awv-werf.mjs); hier wordt het alleen op
// exact hetzelfde GIPOD-id aan een getoond werk gehangen. Nooit een eigen werk, nooit een andere status: de
// status blijft die van GIPOD (AWV geeft de status per werf, GIPOD per record). Een ontbrekend, ongeldig of
// verouderd bestand toont niets, en een ontbrekende aanvulling betekent niets.
export const AWV_SUPPLEMENT_URL="/sources/awv-werf-supplement.json";
export const AWV_METADATA_URL="https://metadata.vlaanderen.be/srv/api/records/cb01ab0d-c288-441f-8b38-ed3b49af5b03";
// Na 3 dagen zonder geldige verversing is het bestand verouderd: dan tonen we het niet meer.
export const AWV_VEROUDERD_NA_UUR=72;
const AFDELING=Object.freeze({Antwerpen:"AWV, afdeling Antwerpen",Lantis:"Lantis (voor AWV)",TO:"Tunnelorganisatie (AWV)",AWV:"AWV"});
// De gekende categorieën van het AWV-veld Type (soort werk). AWV zet een soort samen als
// "[activiteit - ]onderdeel, onderdeel[ - Mobiel]", bijvoorbeeld "(Her)aanleg - Rijbaan incl. riolering, VRI - Mobiel".
// Gemeten op 17 oktober 2026 in alle 11.954 innames en 2.841 werven in het kader van het district (ook oude):
// precies deze 23 categorieën. lib/awv-werf.mjs houdt alleen deze over (de rest valt weg) en de site toont ook
// alleen deze: een onbekende waarde of vrije tekst verschijnt nergens.
export const AWV_SOORT_ACTIVITEITEN=Object.freeze(["(Her)aanleg","Herstelling","Structureel onderhoud","Opmetingen en inspecties","Reiniging"]);
export const AWV_SOORT_ONDERDELEN=Object.freeze(["Rijbaan incl. riolering","Rijbaan excl. riolering","Fietspaden","Parking","Bermen","Bomen","Langsgrachten","Straatkolken","Afschermende constructies","Geluidswerende constructies","Kunstwerken","Seinbruggen","Signalisatie","VRI","Lussen en vergelijkbaar in de rijbaan","Wegverlichting","Andere"]);
export const AWV_SOORTEN=Object.freeze([...AWV_SOORT_ACTIVITEITEN,...AWV_SOORT_ONDERDELEN,"Mobiel"]);
const geldigeDag=v=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v);
const lijst=v=>Array.isArray(v)?v.filter(x=>typeof x==="string"&&x.trim()):[];
const joinNl=a=>a.length<=1?a.join(""):`${a.slice(0,-1).join(", ")} en ${a.at(-1)}`;

// Het bestand lezen: { ok, reden, items, bijgewerkt }. ok=false bij een ander bestand, een bestand zonder
// ophaalmoment of een bestand ouder dan AWV_VEROUDERD_NA_UUR (reden "verouderd").
export function leesAwvSupplement(doc,nu=Date.now()){
  const leeg=reden=>({ok:false,reden,items:[],bijgewerkt:""});
  if(!doc||typeof doc!=="object"||doc.sourceId!=="awv-werf-supplement"||!Array.isArray(doc.items))return leeg("ongeldig");
  const opgehaald=Date.parse(doc.retrievedAt||"");
  if(!Number.isFinite(opgehaald))return leeg("nooit_opgehaald");
  if(nu-opgehaald>AWV_VEROUDERD_NA_UUR*3600000)return leeg("verouderd");
  // "Bijgewerkt op": de jongste wijziging in de data (contentVersion), anders de dag van het ophalen.
  return{ok:true,reden:"",items:doc.items,bijgewerkt:geldigeDag(doc.contentVersion)?doc.contentVersion:String(doc.retrievedAt).slice(0,10)};
}

// Hangt de aanvulling aan elk werk met hetzelfde GIPOD-id. Een aanvulling die vandaag al voorbij is, telt niet.
// werfRecords: hoeveel GIPOD-records van het district bij dezelfde AWV-werf horen ("Ringpark Zuid" bundelt er 40).
export function attachAwvWorkSupplement(items=[],supplement=[],ok=true,{vandaag=""}={}){
  const perGipod=new Map(),perWerf=new Map();
  for(const s of ok&&Array.isArray(supplement)?supplement:[]){
    const id=Number(s?.gipodId);
    if(!Number.isSafeInteger(id)||id<=0)continue;
    if(geldigeDag(vandaag)&&!(String(s.endDate||"")>=vandaag))continue;
    perGipod.set(id,s);
    if(Number(s.werfId)>0)perWerf.set(s.werfId,(perWerf.get(s.werfId)||0)+1);
  }
  return items.map(item=>{const s=perGipod.get(Number(item.gipodId));return{...item,awvSupplement:s?{...s,werfRecords:perWerf.get(s.werfId)||1}:null,awvSupplementSourceLoaded:ok}});
}

// Eén zin in gewone woorden: "Volgens AWV-werfdata: ingenomen: Rijstrook 1 en Middenberm; doorgang: 1 rijstrook,
// versmald; snelheidsbeperking; omleiding voor fietsers (1 lokale omleiding); fase: Fase 2; deel van AWV-werf
// nr. 33882 (40 GIPOD-records), AWV, afdeling Antwerpen." Geen goedkeuring door AWV: alleen wat de data zegt.
export function awvTekst(s){
  if(!s)return"";
  const delen=[],innametypes=lijst(s.innametypes),doorgang=lijst(s.doorgang),bypass=lijst(s.bypass),voor=lijst(s.omleidingVoor),fasen=lijst(s.fasen),soort=lijst(s.soort).filter(v=>AWV_SOORTEN.includes(v));
  if(innametypes.length)delen.push(`ingenomen: ${joinNl(innametypes)}`);
  if(doorgang.length)delen.push(`doorgang: ${doorgang.join(" of ")}`);
  if(s.snelheidsbeperking===true)delen.push("snelheidsbeperking");
  if(s.doorsteek===true)delen.push("doorsteek");
  if(bypass.length)delen.push(`tijdelijke bypass: ${bypass.join(" of ")}`);
  const n=Number(s.lokaleOmleidingen)||0,lokaal=n?` (${n} lokale omleiding${n>1?"en":""})`:"";
  if(voor.length)delen.push(`omleiding voor ${joinNl(voor)}${lokaal}`);
  else if(n)delen.push(`${n} lokale omleiding${n>1?"en":""}`);
  if(fasen.length)delen.push(`fase: ${fasen.join(", ")}`);
  if(s.opUvRoute===true)delen.push("op een route voor uitzonderlijk vervoer");
  if(soort.length)delen.push(`soort werk: ${soort.slice(0,4).join(", ")}${soort.length>4?" …":""}`);
  const werf=Number(s.werfId)>0?(Number(s.werfRecords)>1?`deel van AWV-werf nr. ${s.werfId} (${s.werfRecords} GIPOD-records)`:`AWV-werf nr. ${s.werfId}`):"";
  delen.push([werf,AFDELING[s.afdeling]||AFDELING.AWV].filter(Boolean).join(", "));
  return`Volgens AWV-werfdata: ${delen.join("; ")}.`;
}

// De bronvermelding die het gebruiksrecht van AWV vraagt: de naam en de datum van de laatste bijwerking.
export function awvBron(bijgewerkt=""){
  const d=geldigeDag(bijgewerkt)?new Intl.DateTimeFormat("nl-BE",{day:"numeric",month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(`${bijgewerkt}T12:00:00Z`)):"";
  return`Bron: Agentschap Wegen en Verkeer (AWV), open data Werf${d?`, bijgewerkt op ${d}`:""}`;
}

// Het bestand ophalen. Faalt nooit: bij elke fout { ok: false }.
export function laadAwvSupplement({fetchImpl=(...a)=>fetch(...a),nu=Date.now()}={}){
  return Promise.resolve().then(()=>fetchImpl(AWV_SUPPLEMENT_URL,{headers:{Accept:"application/json"}})).then(r=>r.ok?r.json():null).then(doc=>leesAwvSupplement(doc,nu)).catch(()=>({ok:false,reden:"niet_geladen",items:[],bijgewerkt:""}));
}
