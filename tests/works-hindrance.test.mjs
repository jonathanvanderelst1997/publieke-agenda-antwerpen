import test from "node:test";
import assert from "node:assert/strict";
import {attachHindrance,causingGipodIds,collectHindrance} from "../site/works-hindrance.js";
test("causing ids",()=>assert.deepEqual(causingGipodIds("https://gipod.api.vlaanderen.be/api/v1/works/123; https://gipod.api.vlaanderen.be/api/v1/groundworks/456;"),[123,456]));
test("validated aggregation excludes contacts",()=>{
  const features=[
    {properties:{HindranceStatus:"Gevalideerd",HindranceConsequenceOf:"https://gipod.api.vlaanderen.be/api/v1/works/123; ",Consequences:"Geen doorgang voor voetgangers;Parkeerverbod",SevereHindrance:true,HindranceGipodId:900,HindranceStart:"2026-10-01T06:00:00Z",HindranceEnd:"2026-10-02T18:00:00Z",HindranceURI:"https://gipod.api.vlaanderen.be/api/v1/mobility-hindrances/900",HindranceContactOrganisations:"niet gebruiken"}},
    {properties:{HindranceStatus:"Gevalideerd",HindranceConsequenceOf:"https://gipod.api.vlaanderen.be/api/v1/works/123; ",Consequences:"Beperkte doorgang voor fietsers",HindranceGipodId:901,HindranceStart:"2026-09-30T06:00:00Z",HindranceEnd:"2026-10-03T18:00:00Z"}},
    {properties:{HindranceStatus:"In opmaak",HindranceConsequenceOf:"https://gipod.api.vlaanderen.be/api/v1/works/123; ",Consequences:"Niet publiceren"}}
  ];
  const h=collectHindrance(features).get(123);
  assert.equal(h.severe,true);
  assert.deepEqual(h.hindranceIds,[900,901]);
  assert.equal(h.start,"2026-09-30T06:00:00Z");
  assert.equal(h.end,"2026-10-03T18:00:00Z");
  assert.deepEqual(h.consequences,["Beperkte doorgang voor fietsers","Geen doorgang voor voetgangers","Parkeerverbod"]);
  assert.equal("HindranceContactOrganisations" in h,false);
});
test("missing match stays unknown",()=>{const[i]=attachHindrance([{gipodId:123}],[],true);assert.equal(i.hindrance,null);assert.equal(i.hindranceSourceLoaded,true)});
test("source failure distinct",()=>{const[i]=attachHindrance([{gipodId:123}],[],false);assert.equal(i.hindrance,null);assert.equal(i.hindranceSourceLoaded,false)});
