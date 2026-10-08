import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {bezoekersLinks} from "../site/bezoekers-bronnen.js";
const CITY="https://www.antwerpen.be/info/5c065842a67793326b260661/markten-in-district-antwerpen";
test("een weekmarkt krijgt de officiële leesbare stadspagina, niet eerst een JSON-bron",()=>{
 const event={source:"agenda",item:{sourceId:"stad-markten"},url:"https://geo.api.vlaanderen.be/GIPOD/ogc/features/v1/collections/INNAME_PUNT/items/1143473"};
 const urls=bezoekersLinks(event);
 assert.equal(urls[0].url,CITY);
 assert.match(urls[0].label,/Marktdag, uren en locatie/);
 assert.equal(urls.some(x=>x.label.startsWith("Inschrijven")),false);
});
test("een andere activiteit mag geen algemene marktlink krijgen",()=>{
 const event={source:"agenda",item:{sourceId:"district-evenementen"},url:"https://www.antwerpen.be/info/activiteit"};
 const urls=bezoekersLinks(event);
 assert.equal(urls.some(x=>x.url===CITY),false);
});
test("de gebundelde marktkaart toont een publiekslink",async()=>{
 const ui=await readFile(new URL("../site/place-view.js",import.meta.url),"utf8");
 assert.match(ui,/Stad Antwerpen: locatie en marktuur/);
 assert.match(ui,/markten-in-district-antwerpen/);
});
