import test from "node:test";
import assert from "node:assert/strict";
import {attachAsSignWorkSupplement,collectAsSignWorkSupplement,normalizeAsSignWork} from "../site/works-asign-supplement.js";

const approved={
  GipodID:"123",
  STATUS:"GoedGekeurd",
  Bedrijf:"Aannemingsbedrijf NV",
  DossierNummer:"D-1",
  DossierType:"WERF",
  WERF_TYPE:"Nutswerk",
  FASEID:"F-1",
  Fasestatus:"Actief",
  VerkeersImpact:"Fietsers omgeleid",
  DossierHinder:"ja",
  BEGINDATUM:Date.UTC(2026,8,28),
  EINDDATUM:Date.UTC(2026,9,5),
  DetailLigging:"vrije tekst die niet publiek hoort",
  Link:"https://admin.invalid/dossier/1"
};

test("normaliseert alleen goedgekeurde records en neemt geen vrije tekst/adminlink over",()=>{
  const n=normalizeAsSignWork(approved);
  assert.equal(n.gipodId,123);
  assert.equal(n.company,"Aannemingsbedrijf NV");
  assert.equal(n.phaseStatus,"Actief");
  assert.equal("DetailLigging" in n,false);
  assert.equal("Link" in n,false);
  assert.equal(normalizeAsSignWork({...approved,STATUS:"In Aanvraag"}),null);
});

test("groepeert meerdere fasen per GIPOD-id",()=>{
  const m=collectAsSignWorkSupplement([
    approved,
    {...approved,FASEID:"F-2",Bedrijf:"Tweede bedrijf",Fasestatus:"Gepland",BEGINDATUM:Date.UTC(2026,9,6)}
  ]);
  const s=m.get(123);
  assert.equal(s.phases.length,2);
  assert.deepEqual(s.companies,["Aannemingsbedrijf NV","Tweede bedrijf"]);
  assert.deepEqual(s.phaseStatuses,["Actief","Gepland"]);
});

test("supplement verrijkt alleen een al bestaand GIPOD-werk",()=>{
  const [item]=attachAsSignWorkSupplement([{gipodId:123,title:"Werk"}],[approved],true);
  assert.equal(item.aSignSupplement.companies[0],"Aannemingsbedrijf NV");
  assert.equal(item.aSignSupplementSourceLoaded,true);
  const [unmatched]=attachAsSignWorkSupplement([{gipodId:999,title:"Ander"}],[approved],true);
  assert.equal(unmatched.aSignSupplement,null);
});

test("bronuitval blijft onderscheidbaar van geen match",()=>{
  const [item]=attachAsSignWorkSupplement([{gipodId:123}],[],false);
  assert.equal(item.aSignSupplement,null);
  assert.equal(item.aSignSupplementSourceLoaded,false);
});
