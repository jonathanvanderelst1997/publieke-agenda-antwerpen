import test from "node:test";
import assert from "node:assert/strict";
import {bezoekersLinks,bezoekersHint} from "../site/bezoekers-bronnen.js";
const district="https://www.antwerpen.be/info/5efb0477b118f7b19c627b69/wat-beleef-je-in-district-antwerpen";
const one=(title,date)=>({source:"agenda",item:{sourceId:"district-kalender",title,date},url:district});

test("ticketlinks en evenementpagina zijn verschillend per gedateerde Poëziedag",()=>{
  const jan=one("Vrijdagen van de Poëzie","2026-10-23");
  const nov=one("Vrijdagen van de Poëzie","2026-11-20");
  const a=bezoekersLinks(jan),b=bezoekersLinks(nov);
  assert.match(a[0].url,/CID-STA-20261023/);
  assert.match(b[0].url,/CID-STA-20261120/);
  assert.match(a[0].label,/Tickets/);
  assert.equal(a[1].url,b[1].url);
  assert.match(bezoekersHint(jan),/VT-statuut/);
  assert.equal(bezoekersLinks(one("Vrijdagen van de Poëzie","2026-12-18"))
    .some(x=>/Tickets/.test(x.label)),false);
});

test("inschrijven per e-mail alleen voor de exact bevestigde voorstelling",()=>{
  const e=one("Verlangen naar verbinding","2026-11-10");
  const links=bezoekersLinks(e);
  assert.match(links[0].url,/^mailto:district\.antwerpen@antwerpen\.be\?subject=/);
  assert.match(links[0].label,/Inschrijven per e-mail/);
  assert.match(bezoekersHint(e),/vooraf inschrijven/);
  assert.equal(bezoekersLinks(one("Andere voorstelling","2026-11-10"))
    .some(x=>x.url.startsWith("mailto:")),false);
});

test("geen valse online inschrijving voor Halloween, FURIE of generieke agenda",()=>{
  const h=one("Halloween","2026-10-31");
  const f=one("FURIE!","2026-11-04");
  assert.match(bezoekersLinks(h)[0].url,/griezelfeest-bij-co-nova/);
  assert.match(bezoekersHint(h),/aan de infostand/);
  assert.match(bezoekersLinks(f)[0].url,/pers\.districtantwerpen\.be/);
  assert.match(bezoekersHint(f),/geen ticket nodig/);
  for(const e of [h,f,one("Familiedag in Permeke","2026-10-18")]){
    assert.equal(bezoekersLinks(e).some(x=>/Inschrijven|Tickets/.test(x.label)),false);
    assert.match(bezoekersLinks(e).at(-1).label,/Districtskalender/);
  }
});
test("raadscommissie krijgt vergaderlink zonder valse inschrijving",()=>{
 const e={source:"agenda",item:{sourceId:"district-vergaderingen"},url:"https://ebesluit.antwerpen.be/zittingen/25.0722.0536.7110"};
 const links=bezoekersLinks(e);
 assert.match(links[0].label,/Vergaderagenda en stukken/);
 assert.equal(links.some(x=>/Tickets|Inschrijven/.test(x.label)),false);
});
