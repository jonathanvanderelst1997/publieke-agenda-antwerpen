// Gegevenskwaliteit van elke automatische agendaverversing: alleen lezen, nooit een feit invullen.
// Serieuze integriteitsbreuken stoppen de datatak; bron-onvolledigheid blijft zichtbaar als waarschuwing.
import fs from "node:fs";
import path from "node:path";
const clean=x=>String(x??"").trim();
const valideDatum=d=>typeof d==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d+"T12:00:00Z"))&&new Date(d+"T12:00:00Z").toISOString().slice(0,10)===d;
export function technischeLink(link){
 try{const u=new URL(clean(link));return u.protocol==="https:"&&((u.hostname==="geodata.antwerpen.be"&&u.pathname.includes("/arcgissql/"))||(u.hostname==="geo.api.vlaanderen.be"&&u.pathname.startsWith("/GIPOD/ogc/")))}catch{return false}
}
export function controleerAgendaInhoud({feed={},werken={},status={}}={}){
 const fouten=[],signalen=[],items=Array.isArray(feed.items)?feed.items:[],bronnen=Array.isArray(status.sources)?status.sources:[],werklijst=Object.values(werken.werken||{});
 const metrieken={agendaItems:items.length,toekomstig:0,technischeLinkZonderBezoekerslink:0,onbekendeUren:0,onzekereTitels:0,algemeneLocatie:0,
   werkdossiers:werklijst.length,werkenZonderOmschrijving:0,werkenZonderSoort:0,indicatieveNummerbereiken:0,bronFouten:0,bronZonderSleutel:0};
 if(!items.length)fouten.push("agenda-feed bevat geen items");
 if(!valideDatum(feed.classificationAsOf))fouten.push("ongeldige datum van bronclassificatie");
 if(!bronnen.length)fouten.push("bronstatus ontbreekt");
 const ids=new Set(),combinaties=new Set();
 for(const item of items){
  if(!item||typeof item!=="object"){fouten.push("ongeldig item");continue}
  const id=clean(item.id);if(!id||ids.has(id))fouten.push("dubbele of lege agenda-ID");ids.add(id);
  if(!clean(item.title)||!clean(item.location)||!valideDatum(item.date))fouten.push("ontbrekende/ongeldige titel, locatie of datum");
  if(item.endDate!=null&&(!valideDatum(item.endDate)||item.endDate<item.date))fouten.push("ongeldige einddatum");
  if(!/^https:\/\//.test(clean(item.sourceUrl)))fouten.push("ontbrekende https-bronlink");
  const sleutel=[item.sourceId,item.date,item.title,item.location,item.timeSlot].map(clean).join("|").toLowerCase();
  if(combinaties.has(sleutel))fouten.push("exact dubbel agendapunt");combinaties.add(sleutel);
  if(valideDatum(item.date)&&(item.endDate||item.date)>=feed.classificationAsOf)metrieken.toekomstig++;
  if(technischeLink(item.link||item.sourceUrl)&&!/^https:\/\//.test(clean(item.infoUrl)))metrieken.technischeLinkZonderBezoekerslink++;
  if(item.sourceId==="district-asign-evenementen"&&!clean(item.timeText))metrieken.onbekendeUren++;
  if(/vermoedelijk|naam onbekend|evenement zonder naam/i.test(clean(item.title)))metrieken.onzekereTitels++;
  if(/locatie via de offici[eë]le bron|^verschillende locaties$|^(\d{4}\s*,\s*)+\d{4}\s+Antwerpen$/i.test(clean(item.location)))metrieken.algemeneLocatie++;
 }
 if(items.length&&!metrieken.toekomstig)fouten.push("geen toekomstige of lopende activiteiten");
 for(const w of werklijst){if(!clean(w?.omschrijving))metrieken.werkenZonderOmschrijving++;if(!clean(w?.soort))metrieken.werkenZonderSoort++;if(/afgeleid uit/i.test(clean(w?.huisnummerBron)))metrieken.indicatieveNummerbereiken++}
 for(const b of bronnen){if(b.fetchStatus==="error")metrieken.bronFouten++;if(b.fetchStatus==="skipped_no_key")metrieken.bronZonderSleutel++}
 const teksten={technischeLinkZonderBezoekerslink:"kaarten zonder bezoekerslink",onbekendeUren:"evenementen zonder bevestigd uur",onzekereTitels:"onzekere eventtitels",algemeneLocatie:"items met vage locatie",werkenZonderOmschrijving:"werken zonder omschrijving",werkenZonderSoort:"werken zonder soort",bronFouten:"bronnen met fout",bronZonderSleutel:"bronnen zonder configuratie"};
 for(const [key,titel]of Object.entries(teksten))if(metrieken[key])signalen.push(`${metrieken[key]} ${titel}`);
 return {ok:!fouten.length,fouten:[...new Set(fouten)],signalen,metrieken};
}
export function leesInhoudBronnen(root){
 const script=fs.readFileSync(path.join(root,"site/agenda-feed.js"),"utf8");
 const prefix="window.PUBLIC_AGENDA_FEED = ";if(!script.startsWith(prefix))throw new Error("onbekend formaat agenda-feed.js");
 const feed=JSON.parse(script.slice(prefix.length).trim().replace(/;\s*$/,""));
 const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),"utf8"));
 return {feed,werken:read("site/sources/kaart-uitleg.json"),status:read("site/sources/refresh-status.json")};
}
export function logInhoudRapport(report,{log=console.log,error=console.error,summary=process.env.GITHUB_STEP_SUMMARY}={}){
 log("Inhoudskwaliteit",JSON.stringify(report.metrieken));
 for(const s of report.signalen)log(`::warning title=Agenda-inhoud::${s}`);
 for(const s of report.fouten)error(`::error title=Agenda-inhoud::${s}`);
 if(summary)fs.appendFileSync(summary,["### Agenda-inhoud: dagelijkse automatische controle","","| Gegeven | Aantal |","|---|---:|",
   ...Object.entries(report.metrieken).map(([k,v])=>`| ${k} | ${v} |`),"",...report.signalen.map(s=>`- Aandachtspunt: ${s}`),
   ...report.fouten.map(s=>`- Fout: ${s}`),""].join("\n"));
}
