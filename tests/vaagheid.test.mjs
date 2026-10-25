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

import { VAAGHEID_FILE, VERBODEN_ZINNEN, ontbreektZinnen, ratelFouten, vaagheidVanAgendapunt, vaagheidVanKaart, validateVaagheid, vatSamen, verbodenIn, vergelijk } from "../lib/vaagheid.mjs";
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
  const k = vaagheidVanKaart({ titel: "Rioleringswerken in de Proefstraat", uur: "7.00", regels: ["Wat: rioleringswerken."], detail: ["Niet in de bron: huisnummers niet gepubliceerd · gevolgen niet gepubliceerd in GIPOD."] });
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
  assert.equal(vaagheidVanKaart({ titel: "Parkeerverbod", uur: "7.00", regels: ["Niet parkeren 7 tot 17 uur."] }).kern, false);
});

test("nieuwe patronen: terras zonder periode, werk zonder wat; een parkeerverbod is niet vaag; en wat als veld ontbreekt", () => {
  assert.ok(vaagheidVanKaart({ titel: "Terras met vergunning", regels: ["Een terras op het openbaar domein, met een vergunning van de stad. Een periode publiceert de stad niet."] }).patronen.includes("periode-onbekend"));
  assert.ok(vaagheidVanKaart({ titel: "Werken van Stad Antwerpen in de Proefstraat tot 31 december" }).kern);
  assert.ok(vaagheidVanKaart({ titel: "Werken in de Proefstraat vanaf 3 november" }).patronen.includes("werk-zonder-wat"));
  // Een soort met "Werken aan ..." is wel een wat.
  assert.ok(!vaagheidVanKaart({ titel: "Werken aan het elektriciteitsnet in de Proefstraat op 26 oktober" }).kern);
  // "Parkeerverbod" is de hele titel: waarvoor staat er nooit bij (besluit van 18 oktober 2026), en dat is geen vaagheid.
  assert.deepEqual(vaagheidVanKaart({ titel: "Parkeerverbod" }).patronen, []);
  assert.ok(!vaagheidVanKaart({ titel: "Parkeerverbod" }).kern);
  // Een veld dat zegt wat ontbreekt (de zin staat één keer per sectie): telt als patroon, en als vaag als het een kern is.
  const k = vaagheidVanKaart({ titel: "Studentenactiviteit op het Proefplein", uur: "", onbekend: [{ meter: "uur-onbekend", kern: true }, "naam-stad-niet"] });
  assert.deepEqual(k.patronen, ["naam-stad-niet", "uur-onbekend"]);
  assert.equal(k.kern, true);
  assert.equal(vaagheidVanKaart({ titel: "Proefloop", onbekend: [{ meter: "naam-stad-niet", kern: false }] }).kern, false);
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

test("vergelijk: meer losse vage kaarten faalt, ook als het aandeel gelijk blijft; het bestand weigert het zonder aanvaard", () => {
  // Bundelen uit: dezelfde kaarten, dus hetzelfde aandeel, maar veel meer losse vage kaarten (nakijkronde 12 oktober 2026).
  const meting = (losseVaag, sgw) => ({ items: 10, vaag: 6, aandeel: 60, perPatroon: {}, perGroep: { "publicSpace:sgw": { items: 4, vaag: 4, patronen: {}, losse: sgw, losseVaag: sgw } }, losse: { kaarten: 6, vaag: losseVaag } });
  const v = vergelijk(meting(5, 4), meting(2, 1), { marge: 0, patroonMarge: 0 });
  assert.equal(v.ok, false);
  assert.deepEqual(v.gestegen, [{ id: "losse-vaag", van: 2, naar: 5 }, { id: "losse-vaag:publicSpace:sgw", van: 1, naar: 4 }]);
  assert.equal(vergelijk(meting(2, 1), meting(5, 4), { marge: 0, patroonMarge: 0 }).ok, true, "minder losse vage kaarten mag");
  // Een oudere meting zonder losse kaarten: niet vergelijken.
  assert.equal(vergelijk(meting(5, 4), { ...meting(2, 1), losse: undefined }, { marge: 0, patroonMarge: 0 }).ok, true);
  // In site/sources/vaagheid.json: een stijging op dezelfde invoer is ongeldig, tenzij ze met een reden aanvaard is.
  const leeg = { items: 1, vaag: 0, perPatroon: {} };
  const doc = { schema: "vaagheid/1", vandaag: "2099-03-01", invoer: "0123456789abcdef", agenda: leeg, eventpaginas: leeg, straten: meting(5, 4),
    vergelijking: { vorige: { invoer: "0123456789abcdef", code: null }, straten: v } };
  assert.deepEqual(validateVaagheid(doc), [
    "straten: losse-vaag 2->5 gestegen op dezelfde data (de code maakte het vager); los het op of aanvaard het met een reden (npm run meet:vaagheid -- --aanvaard \"<reden>\")",
    "straten: losse-vaag:publicSpace:sgw 1->4 gestegen op dezelfde data (de code maakte het vager); los het op of aanvaard het met een reden (npm run meet:vaagheid -- --aanvaard \"<reden>\")",
  ]);
  const reden = "Proef: bewust meer losse kaarten om een reden die lang genoeg is.";
  assert.deepEqual(validateVaagheid({ ...doc, aanvaard: [{ waar: "straten", id: "losse-vaag", van: 2, naar: 5, reden }, { waar: "straten", id: "losse-vaag:publicSpace:sgw", van: 1, naar: 4, reden }] }), []);
});

test("vaagheid tegen de basis: ook de losse vage kaarten (scripts/vaagheid-tegen-basis.mjs)", async () => {
  const { stijgingenTegenBasis } = await import("../scripts/vaagheid-tegen-basis.mjs");
  const plek = (losseVaag) => ({ items: 10, vaag: 6, aandeel: 60, perPatroon: {}, perGroep: {}, losse: { kaarten: 6, vaag: losseVaag } });
  const leeg = { items: 1, vaag: 0, aandeel: 0, perPatroon: {} };
  const s = stijgingenTegenBasis({ agenda: leeg, eventpaginas: leeg, straten: plek(9) }, { agenda: leeg, eventpaginas: leeg, straten: plek(3) });
  assert.deepEqual(s, [{ waar: "straten", id: "losse-vaag", van: 3, naar: 9, aanvaard: false }]);
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
  // Elke meting in het bestand, ook "buiten" (ratelFouten in lib/vaagheid.mjs): vager faalt, minder vaag ook (dan het
  // bestand bijwerken met npm run meet:vaagheid, zodat de ratel meezakt), ook voor de losse vage kaarten.
  assert.deepEqual(ratelFouten(nu, opgeslagen), []);
});

test("ratel: ook de uitleg buiten district Antwerpen telt, en een meting die wegvalt faalt", () => {
  const meting = (vaag, perPatroon = {}) => ({ items: 70, vaag, aandeel: Math.round((1000 * vaag) / 70) / 10, perPatroon, perGroep: {}, detail: { metOntbreekt: 0, meerDanEen: 0, zinnen: 0, perPatroon: {} }, verboden: {} });
  const leeg = meting(0);
  const opgeslagen = { agenda: leeg, eventpaginas: leeg, straten: leeg, buiten: meting(0) };
  assert.deepEqual(ratelFouten({ agenda: leeg, eventpaginas: leeg, straten: leeg, buiten: meting(0) }, opgeslagen), []);
  // Nakijkronde 13 oktober 2026: "locatie via de officiële bron" als plaats maakte 30 van de 70 vaag, en de ratel bleef groen.
  const fouten = ratelFouten({ agenda: leeg, eventpaginas: leeg, straten: leeg, buiten: meting(30, { "plek-via-bron": 30 }) }, opgeslagen);
  assert.equal(fouten.length, 1);
  assert.match(fouten[0], /^buiten: vager dan de meting/);
  assert.match(ratelFouten({ agenda: leeg, eventpaginas: leeg, straten: leeg }, opgeslagen)[0], /^buiten: staat in site\/sources\/vaagheid\.json, maar/);
  // Een bestand zonder "buiten" (van voor die meting): niets te vergelijken.
  assert.deepEqual(ratelFouten({ agenda: leeg, eventpaginas: leeg, straten: leeg, buiten: meting(30) }, { agenda: leeg, eventpaginas: leeg, straten: leeg }), []);
});

// Vierde nakijkronde van 18 oktober 2026: de reden van losse-vaag:publicSpace:sgw sprak van "vijf werfzones" die hun
// parkeerverbod terugkrijgen; het zijn er vier, de vijfde staat los omdat haar bundel van twee uiteenvalt. Elke kaart die
// erbij komt, staat nu met haar dossier in de reden: precies zoveel dossiers als de stijging (naar - van), en de reden
// noemt niet meer werfzones met een parkeerverbod dan er zijn.
test("aanvaard: de reden van de werfkaarten noemt elke kaart die erbij komt, met haar dossier", () => {
  const doc = JSON.parse(fs.readFileSync(path.join(root, "site", "sources", VAAGHEID_FILE), "utf8"));
  const a = (doc.aanvaard || []).find((x) => x.waar === "straten" && x.id === "losse-vaag:publicSpace:sgw");
  if (!a) return;
  const dossiers = new Set(a.reden.match(/\bGW\d{4}-\d{6}\b/g) || []);
  assert.equal(dossiers.size, a.naar - a.van, `${a.naar - a.van} kaarten erbij, ${dossiers.size} dossiers in de reden`);
  assert.doesNotMatch(a.reden, /\b(?:Vijf|vijf) werfzones\b[^.]*parkeerverbod terug/);
  // Hoeveel werfzones hun parkeerverbod terugkrijgen, hangt af van de data (23 oktober: vier; na de verversing van
  // 25 oktober: drie). Het telwoord in die zin moet kloppen met de dossiers die ze noemt.
  const telwoord = { een: 1, twee: 2, drie: 3, vier: 4, zes: 6, zeven: 7, acht: 8 };
  const zin = a.reden.match(/\b(Een|Twee|Drie|Vier|Zes|Zeven|Acht) werfzones?\b([^.]*)parkeerverbod terug/);
  assert.ok(zin, "de reden zegt hoeveel werfzones hun parkeerverbod terugkrijgen");
  const genoemd = new Set(zin[2].match(/\bGW\d{4}-\d{6}\b/g) || []);
  assert.equal(genoemd.size, telwoord[zin[1].toLowerCase()], `${zin[1]} werfzones, ${genoemd.size} dossiers in die zin`);
});
