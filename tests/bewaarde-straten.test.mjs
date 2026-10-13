import test from "node:test";
import assert from "node:assert/strict";
import { OPSLAG_SLEUTEL, MAX_BEWAARDE_STRATEN, leesBewaardeStraten, bewaardeStraten, isBewaardeStraat, wisselBewaardeStraat } from "../site/bewaarde-straten.js";
const opslag = () => { const data = new Map(); return { data, getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v) }; };
const straat = (id, name="Bredastraat") => ({ type:"straat", key:"straat:" + id + "|" + name + "|2000", name, label:name, id:String(id), postcode:"2000" });
const index = (...plekken) => ({byKey:new Map(plekken.map(p=>[p.key,p]))});
test("straat bewaren en verwijderen zonder huisnummer, account of server", () => {
  const store=opslag(), plek=straat(1), ix=index(plek);
  assert.equal(wisselBewaardeStraat(ix,store,plek).bewaard,true);
  assert.equal(isBewaardeStraat(store,plek),true);
  assert.deepEqual(bewaardeStraten(ix,store),[plek]);
  assert.equal(store.data.get(OPSLAG_SLEUTEL),JSON.stringify([plek.key]));
  assert.equal(wisselBewaardeStraat(ix,store,plek).bewaard,false);
  assert.deepEqual(leesBewaardeStraten(store),[]);
});
test("geen vrije huisadressen of niet-officiële straat", () => {
  const store=opslag(), plek=straat(2), ix=index(plek);
  assert.equal(wisselBewaardeStraat(ix,store,{...plek,key:"Bredastraat 14"}).ok,false);
  assert.equal(wisselBewaardeStraat(ix,store,{...plek,key:"straat:3|Verzonnenstraat|2000"}).ok,false);
  assert.equal(store.data.size,0);
});
test("historisch opgeslagen straten worden opnieuw gecontroleerd tegen officiële lijst", () => {
  const store=opslag(), plek=straat(2);
  store.setItem(OPSLAG_SLEUTEL,JSON.stringify([plek.key,plek.key,"straat:9|Verdwenenstraat|2000","Straat 2",null,{}]));
  assert.deepEqual(bewaardeStraten(index(plek),store),[plek]);
  assert.deepEqual(leesBewaardeStraten(store),[plek.key,"straat:9|Verdwenenstraat|2000"]);
});
test("limiet twaalf en browseropslag die niet werkt", () => {
  const store=opslag(), plekken=Array.from({length:MAX_BEWAARDE_STRATEN+1},(_,i)=>straat(i+1,"Voorbeeldstraat"+i)), ix=index(...plekken);
  plekken.slice(0,MAX_BEWAARDE_STRATEN).forEach(p=>assert.equal(wisselBewaardeStraat(ix,store,p).ok,true));
  assert.equal(wisselBewaardeStraat(ix,store,plekken.at(-1)).ok,false);
  assert.equal(leesBewaardeStraten(store).length,12);
  assert.equal(wisselBewaardeStraat(ix,store,plekken[0]).bewaard,false);
  assert.equal(wisselBewaardeStraat(ix,store,plekken.at(-1)).ok,true);
  assert.equal(wisselBewaardeStraat(ix,{getItem:()=>null,setItem:()=>{throw Error("uit")}},plekken[0]).ok,false);
  assert.deepEqual(leesBewaardeStraten({getItem:()=>"{BROKEN"}),[]);
});
