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
test("115 straten is geen bewijs van gelijktijdige afsluiting of een bekende evenementnaam",()=>{
  const entry={source:"publicSpace",start:"2026-10-13",straten:Array.from({length:115},(_,i)=>"Straat "+i),uitleg:{ontbreekt:["naam van het evenement niet gepubliceerd door de stad"]}};
  const view=duidelijkeKaart(entry,{kind:"iod"});
  assert.match(view.titel,/Naam evenement onbekend/);
  assert.match(view.titel,/115 straten/);
  assert.match(view.toelichting,/niet dat alle straten tegelijk afgesloten zijn/);
});
