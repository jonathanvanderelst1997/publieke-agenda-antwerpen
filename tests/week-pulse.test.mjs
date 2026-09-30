import test from "node:test";
import assert from "node:assert/strict";
await import("../site/event-types.js");
const {buildWeekPulse,knownHorizon}=await import("../site/week-pulse.js");
test("7-daagse puls telt buurtfeest en openbare vergadering",()=>{const result=buildWeekPulse({fromDay:"2026-09-30",toDay:"2026-10-06",agendaItems:[{id:"a",title:"Buurtfeest Teststraat",date:"2026-10-03",location:"Teststraat"},{id:"b",title:"Districtsraad",date:"2026-10-05",sourceId:"district-vergaderingen"},{id:"c",title:"Buiten periode",date:"2026-10-08"}],works:[{gipodId:1,title:"Werk",start:"2026-10-01T08:00:00Z",end:"2026-10-10T08:00:00Z",hindrance:{severe:true}}],publicSpace:[{id:"p",kind:"parking",title:"Parkeerverbod",start:"2026-10-02T08:00:00Z"}]});assert.equal(result.agendaCount,2);assert.equal(result.neighborhoodCount,1);assert.equal(result.publicMeetingCount,1);assert.equal(result.workStarts,1);assert.equal(result.measureStarts,1);assert.equal(result.severeHindranceWorks,1)});
test("lopende meerdaagse activiteit telt als ze de week overlapt",()=>{const result=buildWeekPulse({fromDay:"2026-09-30",toDay:"2026-10-06",agendaItems:[{id:"x",title:"Expo",date:"2026-09-20",endDate:"2026-10-02"}]});assert.equal(result.agendaCount,1)});


test("vooruitblik loopt tot de laatst bekende datum over alle domeinen",()=>{const h=knownHorizon({fromDay:"2026-09-30",agendaItems:[{date:"2026-12-27"}],works:[{start:"2026-10-01T08:00:00Z",end:"2027-02-15T18:00:00Z"}],publicSpace:[{start:"2026-11-01T08:00:00Z",end:"2026-11-10T18:00:00Z"}]});assert.deepEqual(h,{from:"2026-09-30",to:"2027-02-15",agendaUntil:"2026-12-27",worksUntil:"2027-02-15",measuresUntil:"2026-11-10"})});
test("vooruitblik valt zonder toekomstige data terug op vandaag",()=>assert.equal(knownHorizon({fromDay:"2026-09-30"}).to,"2026-09-30"));
