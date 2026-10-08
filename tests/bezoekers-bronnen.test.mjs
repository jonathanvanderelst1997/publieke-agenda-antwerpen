import test from "node:test";
import assert from "node:assert/strict";
import {bezoekersLinks,bezoekersHint,hinderkaart,leesbaarUur,safeHttps,INZAGE} from "../site/bezoekers-bronnen.js";
import {readFile} from "node:fs/promises";
test("vergunningen: publieksinzage boven ruwe kaart-API en helder zoeken",()=>{
 const e={source:"permits",item:{project:"OMV_2026080750"},sourceUrl:"https://geodata.antwerpen.be/arcgissql/rest/services/P_PiP/pip2_vergunningen/MapServer/5"};
 const links=bezoekersLinks(e);
 assert.equal(links[0].url,INZAGE);
 assert.match(bezoekersHint(e),/OMV_2026080750/);
 assert.match(links.at(-1).label,/Technische/);
});
test("werken: officieel GIPOD-ID opent de publiekskaart",()=>{
 assert.equal(hinderkaart(1143473),"https://www.geopunt.be/?app=hinder-in-kaart&gipodid=1143473");
 assert.equal(hinderkaart("onbekend"),"https://www.geopunt.be/?app=hinder-in-kaart");
});
test("inschrijven: alleen expliciet bevestigde HTTPS-aanmeldpagina",()=>{
 const e={source:"agenda",url:"https://www.antwerpen.be/",item:{registrationUrl:"https://voorbeeld.be/inschrijven"}};
 assert.equal(bezoekersLinks(e).some(x=>x.label.startsWith("Inschrijven")),false);
 e.item.registrationVerified=true;
 assert.equal(bezoekersLinks(e)[0].label,"Inschrijven via bevestigde aanmeldpagina");
 e.item.registrationUrl="javascript:alert(1)";
 assert.equal(bezoekersLinks(e).some(x=>x.label.startsWith("Inschrijven")),false);
 assert.equal(safeHttps("http://onveilig.example"),"");
});
test("zonder gepubliceerde tijd nooit automatisch de hele dag",()=>{
 assert.equal(leesbaarUur({source:"agenda",start:"2026-10-13",item:{}}),"Uur onbekend");
 assert.equal(leesbaarUur({source:"agenda",start:"2026-10-13",item:{timeSlot:"Info"}}),"Uur onbekend");
 assert.equal(leesbaarUur({source:"agenda",start:"2026-10-13",item:{timeSlot:"Hele dag"}}),"Hele dag");
 assert.equal(leesbaarUur({source:"agenda",start:"2026-10-13",time:"14:00"}),"14.00");
});
test("centrale kaart onderscheidt bezoekerslinks van API links",async()=>{
 const view=await readFile(new URL("../site/place-view.js",import.meta.url),"utf8");
 assert.match(view,/bezoekersLinks\(entry\)/);
 assert.match(view,/bezoekersHint\(entry\)/);
 assert.match(view,/leesbaarUur\(entry/);
});
