import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
await import("../site/agenda-uitgaan.js");
const U = globalThis.PublicAgendaUitgaan;
const district = "https://www.antwerpen.be/info/5c065842a67793326b260661/markten-in-district-antwerpen";
const city = "https://www.antwerpen.be/shoppen-en-markten";
const source = "https://geo.api.vlaanderen.be/GIPOD/ogc/features/v1/collections/INNAME_PUNT/items/INNAME_PUNT.123";
const market = (extra = {}) => ({title:"Testmarkt",sourceId:"stad-markten",date:"2026-10-15",location:"Testplein",timeText:"8 tot 13 uur",inDistrict:true,link:source,...extra});
test("gebundelde marktdagen houden bezoekerslink en oorspronkelijke bron afzonderlijk", () => {
  const url = "https://www.antwerpen.be/info/markt-op-testplein";
  const rows = [market({infoUrl:url}), market({date:"2026-10-22",infoUrl:url})];
  const [bundle] = U.bundleWeeklyMarkets(rows,"2026-10-14");
  assert.equal(bundle.infoUrl,url);
  assert.equal(bundle.link,source);
  assert.equal(bundle.count,2);
  assert.equal(bundle.nextDate,"2026-10-15");
  assert.equal(bundle.timeText,"8 tot 13 uur");
  assert.equal(rows[0].link,source);
});
test("een latere bronrij kan de ontbrekende bezoekerslink aanvullen", () => {
  const url = "https://www.antwerpen.be/info/markt-op-testplein";
  const [bundle] = U.bundleWeeklyMarkets([market(),market({date:"2026-10-22",infoUrl:url})],"2026-10-14");
  assert.equal(bundle.infoUrl,url);
  assert.equal(bundle.link,source);
});
test("fallback wijst alleen bij bevestigde districtsmarkt naar district Antwerpen", () => {
  assert.equal(U.bundleWeeklyMarkets([market()],"2026-10-14")[0].infoUrl,district);
  assert.equal(U.bundleWeeklyMarkets([market({inDistrict:false})],"2026-10-14")[0].infoUrl,city);
  assert.equal(U.bundleWeeklyMarkets([market({inDistrict:undefined})],"2026-10-14")[0].infoUrl,city);
});
test("onveilige of niet-officiële bezoekerslinks worden niet doorgegeven", () => {
  for (const infoUrl of ["javascript:alert(1)","http://www.antwerpen.be/info/markt","https://www.antwerpen.be.evil.example/info/markt","https://www.antwerpen.be/info/markt?track=1","https://www.antwerpen.be/info/markt#tracking","https://www.antwerpen.be:8443/info/markt"]) {
    const [bundle] = U.bundleWeeklyMarkets([market({infoUrl})],"2026-10-14");
    assert.equal(bundle.infoUrl,district,infoUrl);
    assert.equal(bundle.link,source);
  }
});
test("de marktweergave gebruikt de geëscape bezoekerslink van de bundel", () => {
  const code = fs.readFileSync(new URL("../site/place-view.js",import.meta.url),"utf8");
  assert.ok(code.includes('esc(m.infoUrl || (m.inDistrict === true ?'));
  assert.ok(code.includes('"' + district + '" : "' + city + '"'));
});
