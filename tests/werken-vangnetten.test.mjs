// Toetsen die bijten op regels zonder eigen toets (nakijkronde van head 1ed84e65: de review haalde elke regel weg en geen
// toets faalde). Per regel staat erbij welke wijziging de toets vangt. Alle straten, nummers, namen en codes zijn verzonnen;
// geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";
import * as KU from "../site/kaart-uitleg.js";
import { updateLiveHistory } from "../lib/live-history.mjs";
import { resultaatVoorHistoriek, tekstZonderHuisnummers } from "../lib/historiek-privacy.mjs";
import { schoonWerk } from "../lib/kaart-uitleg-refresh.mjs";

const VANDAAG = "2099-03-10";
const werk = (extra = {}) => ({ gipodId: 990970, title: "Werk in openbaar domein", status: "In uitvoering", start: "2099-03-01T06:00:00Z", end: "2099-03-30T16:00:00Z", owner: "Stad Antwerpen - Proefdienst", ownerGroup: "Stad Antwerpen", streets: [{ name: "Proefstraat" }], occupancyTypes: ["Andere"], workTypes: [], hindrance: null, ...extra });
const getoond = (k) => [k.titel, k.samenvatting, k.plek, k.bronTekst, ...k.regels.flat(), ...k.ontbreekt].join(" ¶ ");
const plat = (t) => String(t).normalize("NFKD").replace(/[\p{Cf}\p{M}]/gu, "");

// Vangt: de regel [/\bcontainers?\b/i, "Container"] in SOORTEN_WERK (site/kaart-uitleg.js) weg.
test("Container houdt zijn soort uit de tekst van de beheerder, ook zonder soort inname", () => {
  assert.deepEqual(KU.soortVanWerk({ omschrijving: "Container Proefstraat 12" }), { soort: "Container", bron: "omschrijving van de beheerder" }); // verzonnen
  assert.deepEqual(KU.soortVanWerk({ fasen: ["Plaatsen containers"] }), { soort: "Container", bron: "fasen van de hinder in GIPOD" });
  assert.match(KU.werkKaartje(werk({ title: "Container Proefstraat 12" }), { vandaag: VANDAAG }).titel, /^Container in de Proefstraat nr\. 12\b/); // verzonnen
});

// Vangt: "owner" weg uit de velden van werkenVoorVergelijking (lib/historiek-privacy.mjs).
test("de historiek: een opdrachtgever die alleen zijn huisnummer terugkrijgt, is geen wijziging; een andere wel", () => {
  const T1 = "2099-03-09T03:00:00.000Z", T2 = "2099-03-10T03:00:00.000Z";
  const leeg = { ok: true, items: [] };
  const items = [werk({ owner: "Proefbouw - Proefstraat 12" })]; // verzonnen
  const eerst = updateLiveHistory(null, { observedAt: T1, worksResult: resultaatVoorHistoriek({ ok: true, items }), publicSpaceResult: leeg });
  // De historiek van vóór het besluit van 18 oktober 2026: zonder huisnummers, ook in de opdrachtgever.
  const oud = { ...eerst, layers: { ...eerst.layers, works: { ...eerst.layers.works, items: eerst.layers.works.items.map((w) => ({ ...w, owner: tekstZonderHuisnummers(w.owner) })) } } };
  assert.equal(oud.layers.works.items[0].owner, "Proefbouw - Proefstraat");
  const daarna = updateLiveHistory(oud, { observedAt: T2, worksResult: resultaatVoorHistoriek({ ok: true, items }), publicSpaceResult: leeg });
  assert.deepEqual(daarna.changes.filter((c) => c.layer === "works"), []);
  assert.equal(daarna.layers.works.items[0].owner, "Proefbouw - Proefstraat 12");
  const ander = updateLiveHistory(oud, { observedAt: T2, worksResult: resultaatVoorHistoriek({ ok: true, items: [werk({ owner: "Proefbouw - Testlaan 3" })] }), publicSpaceResult: leeg }); // verzonnen
  assert.deepEqual(ander.changes.filter((c) => c.layer === "works").map((c) => c.fields), [["owner"]]);
});

// Vangt: de terugval op het adressenregister (`register`) in schoonWerk (lib/kaart-uitleg-refresh.mjs) weg.
test("schoonWerk: zonder nummer in de tekst en zonder bewaard nummer, het nummer van het adressenregister", () => {
  const w = { soort: "Nieuwe aansluiting op het gasnet", soortBron: "soort inname in GIPOD", omschrijving: "", straten: ["Proefstraat"], huisnummers: "", huisnummerBron: "", adres: "nr. 12", fasen: [], gevolgen: [] };
  const uit = schoonWerk(w);
  assert.equal(uit.huisnummers, "nr. 12");
  assert.equal(uit.huisnummerBron, "afgeleid uit de werfzone en het adressenregister");
  assert.equal(schoonWerk({ ...w, adres: "nr. 0" }).huisnummers, "", "geen ongeldig nummer");
  assert.equal(schoonWerk({ ...w, huisnummers: "nr. 14", huisnummerBron: "omschrijving van de beheerder" }).huisnummers, "nr. 14", "een bewaard nummer gaat voor");
});

// Vangt: feitenZonderVerhuis weg in werkKaartje (site/kaart-uitleg.js), voor feiten die zo binnenkomen (`feiten`).
test("vangnet: werkKaartje laat 'verhuis' nooit door, ook niet uit feiten die het rechtstreeks krijgt", () => {
  const oud = { soort: "Verhuis", soortBron: "fasen van de hinder in GIPOD", omschrijving: "Verhuis fam. Proefmans, Proefstraat 12", opdrachtgever: "Verhuizingen Proef", straten: ["Proefstraat"], huisnummers: "nr. 12–14", huisnummerBron: "afgeleid", gevolgen: [], fasen: [{ naam: "Verhuislift", start: "2099-03-12", eind: "2099-03-12", gevolgen: [] }] }; // verzonnen
  const k = KU.werkKaartje(werk(), { vandaag: VANDAAG, feiten: oud });
  assert.doesNotMatch(plat(getoond(k)), /verhui[sz]|Proefmans/i);
  assert.match(k.titel, /in de Proefstraat nr\. 12–14\b/, "het adres blijft");
});

// Vangt: zonderVerhuis weg in beheerderTekst (site/kaart-uitleg.js).
test("vangnet: beheerderTekst geeft niets voor een tekst met 'verhuis', en laat een andere tekst staan", () => {
  assert.equal(KU.beheerderTekst("Verhuis fam. Proefmans naar de Proefstraat 12", { straten: ["Testlaan"] }), ""); // verzonnen
  assert.equal(KU.beheerderTekst("Ver\u00ADhuis Proefstraat 12", { straten: ["Testlaan"] }), ""); // verzonnen
  assert.equal(KU.beheerderTekst("Herstel voetpad aan de Proefstraat 12", { straten: ["Testlaan"] }), "Herstel voetpad aan de Proefstraat 12"); // verzonnen
});
