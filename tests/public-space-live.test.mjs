import test from "node:test";
import assert from "node:assert/strict";
import {collectPublicSpace,geometryIntersectsDistrict,publicSpaceStats} from "../site/public-space-live-core.js";

const district={type:"Polygon",coordinates:[[[4,51],[5,51],[5,52],[4,52],[4,51]]]};
const day=Date.UTC(2026,8,28),end=Date.UTC(2026,9,5);
test("exact geometry includes crossing line without inside vertex",()=>{assert.equal(geometryIntersectsDistrict({paths:[[[3,51.5],[6,51.5]]]},district),true)});
test("exact geometry excludes bbox-near line outside district",()=>{assert.equal(geometryIntersectsDistrict({paths:[[[4.1,52.2],[4.9,52.2]]]},district),false)});
test("exact geometry includes polygon inside district",()=>{assert.equal(geometryIntersectsDistrict({rings:[[[4.2,51.2],[4.4,51.2],[4.4,51.4],[4.2,51.4],[4.2,51.2]]]},district),true)});
test("collect filters private states and dedupes IOD geometry variants",()=>{
  const parking=[
    {attributes:{Dossiernummer:"P1",Locatienummer:"L1",Status:"Goedgekeurd",Adres:"Teststraat 1",Reden:"Werfsignalisatie",Startdatum:day,Einddatum:end}},
    {attributes:{Dossiernummer:"P2",Locatienummer:"L2",Status:"In behandeling",Adres:"Privé 2",Reden:"Verhuis",Startdatum:day,Einddatum:end}}
  ];
  const iodAttrs={dossierNummer:"D1",faseId:"F1",innameId:"I1",dossierStatus:"aanvraag_goedgekeurd",faseNaam:"Fase 1",innameTypeNaam:"Inname",faseStartDatum:day,faseEindDatum:end};
  const iod=[{attributes:iodAttrs,geometry:{rings:[[[4.2,51.2],[4.3,51.2],[4.3,51.3],[4.2,51.3],[4.2,51.2]]]}},{attributes:iodAttrs,geometry:{paths:[[[4.2,51.2],[4.3,51.3]]]}}];
  const items=collectPublicSpace({parkingFeatures:parking,iodFeatures:iod,districtGeometry:district});
  assert.equal(items.filter(i=>i.kind==="parking").length,1);assert.equal(items.filter(i=>i.kind==="iod").length,1);assert.equal(items.some(i=>i.location==="Privé 2"),false)
});
test("SGW combines confirmed detour and workzone for one phase",()=>{
  const attributes={reference_id:"R1",phase_id:"PH1",status:"vergund",StartDate:day,EndDate:end};
  const geometry={paths:[[[4.1,51.1],[4.8,51.8]]]};
  const items=collectPublicSpace({sgwFeatures:[{feature:{attributes,geometry},kind:"Omleiding"},{feature:{attributes,geometry},kind:"Werfzone"}],districtGeometry:district});
  assert.equal(items.length,1);assert.equal(items[0].kindLabel,"Omleiding + Werfzone")
});
test("stats",()=>{const items=collectPublicSpace({parkingFeatures:[{attributes:{Dossiernummer:"P",Locatienummer:"L",Status:"In effect",Startdatum:day,Einddatum:end}}]});assert.deepEqual(publicSpaceStats(items),{total:1,parking:1,iod:0,sgw:0})});

test("IOD kaart toont alleen veilige structurele fasecontext",()=>{const attrs={dossierNummer:"D2",faseId:"F2",innameId:"I2",dossierStatus:"aanvraag_goedgekeurd",faseNaam:"Uitvoering",type_dossier:"WERF",innameTypeNaam:"Inname",innameHinder:"ja",innameBeschrijving:"vrije tekst",dossierBeheerder:"persoon",faseStartDatum:day,faseEindDatum:end};const geometry={rings:[[[4.2,51.2],[4.3,51.2],[4.3,51.3],[4.2,51.3],[4.2,51.2]]]};const [item]=collectPublicSpace({iodFeatures:[{attributes:attrs,geometry}],districtGeometry:district});assert.match(item.detail,/Fase Uitvoering/);assert.match(item.detail,/Dossiertype WERF/);assert.match(item.detail,/Hinder volgens IOD: ja/);assert.equal(item.detail.includes("vrije tekst"),false);assert.equal(item.detail.includes("persoon"),false)});
