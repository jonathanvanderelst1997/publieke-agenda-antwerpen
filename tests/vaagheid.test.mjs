// Vaagheidsmeter: (1) de patronen zelf, met verzonnen items; (2) de verboden zinnen ("naam volgt", "volgt
// zodra", "naam onbekend" in een titel): de code maakt ze nooit; (3) een ratel op vaste data: dezelfde data
// (site/, met de vingerafdruk uit site/sources/vaagheid.json), de code van deze tak, een vaste set straten
// (STRATEN_TOETS in scripts/meet-vaagheid.mjs). De verversing schrijft vaagheid.json met de code van main op
// dezelfde data; stijgt de vaagheid hier, dan maakte deze codewijziging teksten vager. Daalt ze, dan moet het
// bestand mee (npm run meet:vaagheid), zodat de ratel niet terugzakt. Geen netwerk, geen klok.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { VAAGHEID_FILE, VERBODEN_ZINNEN, ontbreektZinnen, vaagheidVanAgendapunt, vaagheidVanKaart, validateVaagheid, vatSamen, verbodenIn, vergelijk } from "../lib/vaagheid.mjs";
import { titelVan } from "../lib/asign-evenementen-agenda.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const punt = (extra = {}) => ({ id: "proef-1", sourceId: "district-kalender", scope: "district", title: "Proefconcert", date: "2099-03-14", endDate: null, timeSlot: "20:00", timeText: "20 uur", location: "Proefplein", info: "Organisatie: Proefkoor vzw.", kind: "activity", ...extra });

test("een volledig agendapunt is niet vaag", () => {
  const r = vaagheidVanAgendapunt(punt());
  assert.deepEqual({ id: r.id, sourceId: r.sourceId, patronen: r.patronen, kern: r.kern, verboden: r.verboden, ontbreekt: r.detail.ontbreekt }, { id: "proef-1", sourceId: "district-kalender", patronen: [], kern: false, verboden: [], ontbreekt: 0 });
});

test("uur, plaats, wie en naam: elk een eigen patroon", () => {
  assert.ok(vaagheidVanAgendapunt(punt({ timeSlot: "Info", timeText: "" })).patronen.includes("uur-onbekend"));
  // Een uur in de tekst telt wel ("kratstapelen van 12 tot 17 uur").
  assert.ok(!vaagheidVanAgendapunt(punt({ timeSlot: "Info", timeText: "van 12 tot 17 uur" })).patronen.includes("uur-onbekend"));
  assert.ok(vaagheidVanAgendapunt(punt({ location: "District Proef, locatie via de officiële bron" })).patronen.includes("plek-via-bron"));
  assert.ok(vaagheidVanAgendapunt(punt({ location: "2000, 2020 en 2050 Antwerpen" })).patronen.includes("plek-alleen-postcode"));
  assert.ok(vaagheidVanAgendapunt(punt({ info: "Kom langs." })).patronen.includes("wie-onbekend"));
  // Bij een vergadering of een markt volgt "wie" uit de bron.
  assert.ok(!vaagheidVanAgendapunt(punt({ sourceId: "district-vergaderingen", info: "" })).patronen.includes("wie-onbekend"));
  const r = vaagheidVanAgendapunt(punt({ title: "Evenement in de Proefstraat: lus van 3 km, naam onbekend", timeSlot: "Info", timeText: "" }));
  assert.ok(r.kern && r.patronen.includes("naam-onbekend") && r.patronen.includes("generieke-titel"));
  assert.deepEqual(r.verboden, ["naam-onbekend-in-titel"]);
});

test("detail: de zinnen die zeggen wat ontbreekt, en de vaste detailzinnen, worden geteld", () => {
  // Een agendapunt: de info is het detail.
  const a = vaagheidVanAgendapunt(punt({ info: "Naam onbekend: het dossier noemt geen naam. De uren zijn niet gepubliceerd." }));
  assert.equal(a.detail.ontbreekt, 3);
  assert.deepEqual(a.detail.patronen, ["uren-niet-gepubliceerd"]);
  // Een kaart: kop en detail samen. Eén regel "Niet in de bron" telt als één zin.
  const k = vaagheidVanKaart({ titel: "Werken in de Proefstraat", uur: "7.00", regels: ["Wat: rioleringswerken."], detail: ["Niet in de bron: huisnummers niet gepubliceerd · gevolgen niet gepubliceerd in GIPOD."] });
  assert.ok(k.detail.patronen.includes("niet-in-de-bron") && k.detail.patronen.includes("huisnummers-niet-gepubliceerd"));
  assert.equal(k.kern, false, "het detail maakt een kaart niet vaag; dat zegt de kop");
  assert.equal(ontbreektZinnen(["Wat er gebeurt, zegt de stad niet.", "Organisator: niet openbaar.", "Rioleringswerken."]), 2);
  // Samenvatting: kaarten met meer dan één ontbreekt-zin.
  const sam = vatSamen([{ soort: "x", kern: false, patronen: [], detail: { ontbreekt: 3, patronen: ["niet-in-de-bron"] }, verboden: [] }, { soort: "x", kern: false, patronen: [], detail: { ontbreekt: 1, patronen: [] }, verboden: ["naam-volgt"] }], (r) => r.soort);
  assert.deepEqual(sam.detail, { metOntbreekt: 2, meerDanEen: 1, zinnen: 4, perPatroon: { "niet-in-de-bron": 1 } });
  assert.deepEqual(sam.verboden, { "naam-volgt": 1 });
});

test("verboden zinnen: een belofte die niemand waarmaakt, of 'naam onbekend' in een titel", () => {
  assert.deepEqual(verbodenIn({ titel: "Evenement in de Proefstraat — naam volgt" }), ["naam-volgt"]);
  assert.deepEqual(verbodenIn({ titel: "Proefloop", teksten: ["De naam volgt zodra een besluit hem noemt."] }), ["naam-volgt", "volgt-zodra"]);
  // "Naam onbekend" mag in de uitleg (een eerlijke zin), niet in de titel.
  assert.deepEqual(verbodenIn({ titel: "Evenement op het Proefplein", teksten: ["Naam onbekend: het dossier noemt geen naam."] }), []);
  assert.deepEqual(verbodenIn({ titel: "Evenement op het Proefplein, naam onbekend" }), ["naam-onbekend-in-titel"]);
});

test("verboden zinnen: de code maakt ze nooit (titel zonder naam, en geen belofte in de bron)", () => {
  // Een dossier zonder naam, soort of besluit: de titel zegt wat en waar, niet wat ontbreekt.
  const f = { dossier: "ET2099000011", beginStraat: "Proefplein", kernStraten: ["Proefplein"], zone: ["Proefplein", "Tweedestraat"], langs: [], dagen: ["2099-03-14"] };
  const t = titelVan(f, {});
  assert.equal(t.titel, "Evenement op het Proefplein: verkeersvrije zone in 2 straten");
  assert.deepEqual(verbodenIn({ titel: t.titel }), []);
  // Geen bestand met code mag de zinnen zelf bevatten (alleen de meter en de toetsen noemen ze).
  const treffers = [];
  const kijk = (map, filter) => {
    for (const naam of fs.readdirSync(path.join(root, map))) {
      if (!filter.test(naam) || ["agenda-feed.js", "vaagheid.mjs", "meet-vaagheid.mjs"].includes(naam)) continue;
      const tekst = fs.readFileSync(path.join(root, map, naam), "utf8");
      for (const v of VERBODEN_ZINNEN.filter((x) => !x.alleenTitel)) if (v.re.test(tekst)) treffers.push(`${map}/${naam}: ${v.id}`);
    }
  };
  kijk("lib", /\.(?:mjs|json)$/);
  kijk("scripts", /\.mjs$/);
  kijk("site", /\.js$/);
  assert.deepEqual(treffers, []);
});

test("kaarten op de plekpagina: de eerlijk-onbekend-zinnen worden geteld", () => {
  const k = vaagheidVanKaart({ titel: "Innames op 26 plekken verspreid over de stad", uur: "Uur onbekend", regels: ["Wat: De stad gaf toelating voor een inname van de openbare ruimte. Wat er gebeurt of wat er staat, zegt het dossier niet."] });
  for (const id of ["generieke-titel", "plek-verspreid", "uur-onbekend", "wat-zegt-dossier-niet"]) assert.ok(k.patronen.includes(id), id);
  assert.equal(k.kern, true);
  assert.equal(vaagheidVanKaart({ titel: "Parkeerverbod voor een verhuis", uur: "7.00", regels: ["Niet parkeren 7 tot 17 uur."] }).kern, false);
});

test("vergelijk: een stijging boven de marge faalt, een daling niet; een verboden zin stijgt nooit", () => {
  const oud = vatSamen([{ sourceId: "a", kern: true, patronen: ["uur-onbekend"] }, { sourceId: "a", kern: false, patronen: [] }]);
  const nu = vatSamen([{ sourceId: "a", kern: true, patronen: ["uur-onbekend"] }, { sourceId: "a", kern: true, patronen: ["plek-via-bron"] }]);
  assert.equal(vergelijk(nu, oud).ok, false);
  assert.equal(vergelijk(oud, nu).ok, true);
  // Eén verboden zin erbij faalt, ook met een ruime marge.
  const metVerboden = vatSamen([{ sourceId: "a", kern: true, patronen: ["uur-onbekend"], verboden: ["naam-volgt"] }, { sourceId: "a", kern: false, patronen: [] }]);
  const v = vergelijk(metVerboden, oud, { marge: 50, patroonMarge: 50 });
  assert.equal(v.ok, false);
  assert.deepEqual(v.gestegen, [{ id: "verboden:naam-volgt", van: 0, naar: 1 }]);
});

// ---- ratel op de echte data ----
const bestand = path.join(root, "site", "sources", VAAGHEID_FILE);
const heeftData = fs.existsSync(bestand) && fs.existsSync(path.join(root, "site", "agenda-feed.js")) && fs.existsSync(path.join(root, "site", "straat-index.json"));

test("ratel: deze code maakt de agenda op dezelfde data niet vager (vaste straten)", { skip: heeftData ? false : "geen vaagheid.json of geen straatbestanden" }, async (t) => {
  const opgeslagen = JSON.parse(fs.readFileSync(bestand, "utf8"));
  assert.deepEqual(validateVaagheid(opgeslagen), []);
  const { meetAlles, opslagVorm, invoerVingerafdruk } = await import("../scripts/meet-vaagheid.mjs");
  // Vaste data: alleen vergelijken als de meting op deze data gemaakt is. Een verversing schrijft data en
  // meting samen; een andere vingerafdruk betekent dat de data veranderde zonder nieuwe meting (de meter liep
  // niet, of een tak wijzigde ook data): dan zegt een verschil niets over de code.
  const invoer = invoerVingerafdruk();
  if (opgeslagen.invoer !== invoer) {
    t.skip(`vaagheid.json is gemeten op andere data (${opgeslagen.invoer || "zonder vingerafdruk"}, nu ${invoer}): draai npm run meet:vaagheid`);
    return;
  }
  const nu = opslagVorm(await meetAlles({ vandaag: opgeslagen.vandaag }));
  for (const k of ["agenda", "eventpaginas", "straten"]) {
    const v = vergelijk(nu[k], opgeslagen[k], { marge: 0, patroonMarge: 0 });
    assert.ok(v.ok, `${k}: vager dan de meting in site/sources/${VAAGHEID_FILE}: ${JSON.stringify(v)}`);
    // Minder vaag? Dan het bestand bijwerken (npm run meet:vaagheid), zodat de ratel meezakt.
    assert.ok(nu[k].vaag >= opgeslagen[k].vaag, `${k}: minder vaag (${opgeslagen[k].vaag} -> ${nu[k].vaag}); werk site/sources/${VAAGHEID_FILE} bij met npm run meet:vaagheid`);
  }
});
