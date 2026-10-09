import test from "node:test";
import assert from "node:assert/strict";
import {herkenAanvraag,beslissingsdatumTekst,duidelijkeKaart} from "../site/permit-clarity.js";
import {normalizePermit} from "../site/permits-live-core.js";
test("de aanvraaginhoud wordt alleen privacyveilig als vaste categorie getoond",()=>{
  const input={Dossiernummer:"20262560",DOSSIERTYPE:"OMV2019_AANVRAAG",AardAanvraag:"Stedenbouwkundige handelingen",Onderwerp:"Verbouwen door Jan Peeters, 0470 12 34 56, naam@example.be",MaatschappelijkeNaam:"Persoonsbedrijf"};
  const item=normalizePermit(input);
  assert.equal(item.purpose,"Verbouwing of uitbreiding");
  assert.equal(Object.hasOwn(item,"Onderwerp"),false);
  assert.equal(Object.hasOwn(item,"MaatschappelijkeNaam"),false);
  assert.doesNotMatch(JSON.stringify(item),/Peeters|0470|naam@|Persoonsbedrijf/);
  assert.equal(duidelijkeKaart({source:"permits",title:"OMV2019_AANVRAAG"},item).titel,"Verbouwing of uitbreiding");
});
test("vage codes leveren geen gegokt project op",()=>{
  assert.equal(herkenAanvraag("OMV2019_AANVRAAG",""),"");
  assert.equal(herkenAanvraag("","nieuwbouw van zes appartementen"),"Nieuwbouw");
  assert.equal(herkenAanvraag("","een functiewijziging van winkel naar kantoor"),"Functiewijziging");
  assert.equal(herkenAanvraag("","Alleen de naam van een inwoner"),"");
});
test("beslissingsdatum alleen als een geldige bronwaarde bestaat",()=>{
  assert.equal(beslissingsdatumTekst("2026-10-08"),"8 oktober 2026");
  assert.equal(beslissingsdatumTekst("08/10/2026"),"8 oktober 2026");
  assert.equal(beslissingsdatumTekst("20261008"),"8 oktober 2026");
  assert.equal(beslissingsdatumTekst("2026-02-30"),"");
  assert.equal(beslissingsdatumTekst(""),"");
});
// Een evenement op straat krijgt zijn titel en uitleg uit kaart-uitleg.js (evenementKaartje), dat ook
// zegt dat 115 straten geen bewijs van een gelijktijdige afsluiting zijn. De oude tak hier (kind "iod")
// werd nooit uitgevoerd, want het kaartje heeft kind "event"; die tak is weg, dus geen tweede titel.
test("een evenementkaart houdt de titel uit kaart-uitleg.js; geen tweede, verzonnen titel",()=>{
  const entry={source:"publicSpace",title:"Evenement met parcours door 115 straten, dinsdag 13 oktober",summary:"Evenement met toelating van de stad.",start:"2026-10-13",straten:Array.from({length:115},(_,i)=>"Straat "+i),uitleg:{ontbreekt:["naam van het evenement niet gepubliceerd door de stad"]}};
  for(const kind of ["event","iod"]){
    const view=duidelijkeKaart(entry,{kind});
    assert.equal(view.titel,entry.title);
    assert.equal(view.samenvatting,entry.summary);
    assert.doesNotMatch(JSON.stringify(view),/Naam evenement onbekend|straatparcours/);
  }
});
