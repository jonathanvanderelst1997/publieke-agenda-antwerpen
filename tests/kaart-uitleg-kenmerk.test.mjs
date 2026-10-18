// Een lang kenmerk (de vaste woorden van een omschrijving, kenmerkTekst in site/kaart-uitleg.js) mag kaart-uitleg.json niet
// tegenhouden: de vaste woorden zijn langer dan de trefwoorden, dus een omschrijving van 140 tekens kan een kenmerk van meer
// dan 160 tekens geven. Het kenmerk wordt nooit ingekort (dan kon een woord van de soort wegvallen): de grens
// (KENMERK_MAX in lib/kaart-uitleg-validatie.mjs) ligt boven het langste kenmerk dat de code kan maken. En één ongeldig
// werk of evenement houdt het bestand niet meer tegen (schrijfKaartUitleg in lib/kaart-uitleg-refresh.mjs): het krijgt zijn
// vorige geldige versie of valt weg, de rest wordt geschreven. Elke toets faalt op head fe8eb62 (daar bleef het hele
// bestand van de vorige dag staan) en slaagt nu. Alleen verzonnen proefdata; geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as KU from "../site/kaart-uitleg.js";
import * as V from "../lib/kaart-uitleg-validatie.mjs";
import * as R from "../lib/kaart-uitleg-refresh.mjs";

// Verzonnen: alleen trefwoorden, geen naam, geen nummer (136 tekens).
const LANG = "Doop studenten stoet kermis reuzenrad kramen tent podium wand generator foodtruck toiletten container vlaggen kerstboom oldtimer sticker";
const evenement = (velden = {}) => ({ start: "2099-03-01", eind: "2099-03-01", soort: "", soortBron: "", beschrijvingen: ["Parcours: Proefstraat"], straten: ["Proefstraat"], kruist: [], stratenTekst: "", gekoppeld: null, kaart: [], kaartDeel: false, ...velden });
const document = (velden = {}) => ({ schemaVersion: 1, generatedAt: "2099-02-25T05:00:00.000Z", vanaf: "2099-02-25", tot: "2099-04-26", werken: {}, evenementen: {}, ...velden });

test("kenmerk: een omschrijving van 136 tekens met veel trefwoorden geeft een geldig document, en het kenmerk blijft heel", () => {
  assert.ok(LANG.length <= 140);
  const k = KU.kenmerkenTekst(LANG);
  assert.ok(k.bewaard.length > 160, `${k.bewaard.length} tekens`);
  const f = KU.evenementFeiten([{ kind: "iod", reference: "ET2099000001", dossierType: "ETL", phase: "Evenement", innameType: "Parcours", description: LANG, start: "2099-03-01T00:00:00.000Z", end: "2099-03-01T00:00:00.000Z", streets: [] }]);
  assert.deepEqual(f.kenmerken, [k.bewaard], "niet ingekort");
  assert.ok(KU.isKenmerk(f.kenmerken[0]));
  assert.deepEqual(V.validateKaartUitleg(document({ evenementen: { ET2099000001: evenement({ kenmerken: f.kenmerken, soort: f.soort }) } })), []);
});

test("kenmerk: de grens ligt boven het langste kenmerk dat de code kan maken (alle vaste woorden samen)", () => {
  assert.ok(Number.isInteger(V.KENMERK_MAX));
  assert.ok(Array.isArray(KU.KENMERK_DELEN) && KU.KENMERK_DELEN.length > 20);
  const alles = KU.KENMERK_DELEN.join(" ");
  assert.equal(KU.KENMERK_LANGST, alles.length);
  assert.ok(KU.KENMERK_LANGST <= V.KENMERK_MAX, `${KU.KENMERK_LANGST} > ${V.KENMERK_MAX}`);
  assert.ok(KU.isKenmerk(alles));
  assert.deepEqual(V.validateKaartUitleg(document({ evenementen: { ET2099000001: evenement({ kenmerken: [alles] }) } })), []);
  // Nog altijd alleen vaste woorden in kleine letters: geen tekst, geen cijfer, geen hoofdletter.
  for (const fout of ["Testpersoon", "stoet 12", "stoet, kermis", `${alles} ${"x".repeat(V.KENMERK_MAX)}`]) {
    assert.match(V.validateKaartUitleg(document({ evenementen: { ET2099000001: evenement({ kenmerken: [fout] }) } })).join(" "), /kenmerken ongeldig/, fout);
  }
});

const werk = (velden = {}) => ({ soort: "Stelling (steiger)", soortBron: "soort inname", omschrijving: "", opdrachtgever: "", huisnummers: "", huisnummerBron: "", bijgewerkt: "2099-02-20", straten: ["Proefstraat"], gevolgen: [], fasen: [], ...velden });

test("één ongeldig item: het krijgt zijn vorige geldige versie of valt weg, de rest blijft", () => {
  const doc = document({
    werken: { 90000001: werk(), 90000002: werk({ fasen: [{ naam: "x".repeat(200), start: "2099-03-01", eind: "2099-03-02" }] }) },
    evenementen: { ET2099000001: evenement({ kenmerken: ["Testpersoon 12"] }), ET2099000002: evenement({ kenmerken: ["Testpersoon"] }), ET2099000003: evenement({ kenmerken: ["stoet"] }) },
  });
  const vorige = document({ werken: {}, evenementen: { ET2099000001: evenement({ kenmerken: ["stoet"], beschrijvingen: ["Parcours: Proefstraat 12 bij Testpersoon"] }) } });
  const fouten = V.kaartUitlegFouten(doc);
  assert.deepEqual(fouten.document, []);
  assert.deepEqual(Object.keys(fouten.werken), ["90000002"]);
  assert.deepEqual(Object.keys(fouten.evenementen).sort(), ["ET2099000001", "ET2099000002"]);
  const tel = R.vervangOngeldig(doc, fouten, { vorige, isStraat: (n) => /^proefstraat$/i.test(String(n).trim()) });
  assert.deepEqual(tel, { werken: 1, evenementen: 2, vorigeVersie: 1, weggelaten: 2 });
  assert.deepEqual(Object.keys(doc.werken), ["90000001"]);
  assert.deepEqual(Object.keys(doc.evenementen).sort(), ["ET2099000001", "ET2099000003"]);
  // De vorige versie, opnieuw door de filter van nu (geen huisnummer of naam in een omschrijving).
  assert.deepEqual(doc.evenementen.ET2099000001.kenmerken, ["stoet"]);
  assert.deepEqual(doc.evenementen.ET2099000001.beschrijvingen, ["Parcours: Proefstraat"]);
  assert.deepEqual(V.validateKaartUitleg(doc), []);
});

test("schrijfKaartUitleg: een document met één ongeldig item wordt toch geschreven, met een nieuwe generatedAt", async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "kaart-uitleg-kenmerk-"));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(rootDir, "site", "sources"), { recursive: true });
  const bestand = path.join(rootDir, "site", "sources", V.KAART_UITLEG_FILE);
  // Een bestand van gisteren met een werk dat vandaag ongeldig is (een te lange fasenaam) naast een geldig werk.
  fs.writeFileSync(bestand, JSON.stringify(document({ generatedAt: "2099-02-24T05:00:00.000Z", werken: { 90000001: werk(), 90000002: werk({ fasen: [{ naam: "x".repeat(200), start: "2099-03-01", eind: "2099-03-02" }] }) } })));
  const logs = [];
  const uit = await R.schrijfKaartUitleg({ rootDir, works: { ok: false, items: [] }, publicSpace: { ok: false }, fetch: null, clock: () => new Date("2099-02-25T05:00:00Z"), log: (r) => logs.push(r) });
  assert.ok(uit, `niet bijgewerkt: ${logs.join(" ")}`);
  const geschreven = JSON.parse(fs.readFileSync(bestand, "utf8"));
  assert.equal(geschreven.generatedAt, "2099-02-25T05:00:00.000Z");
  assert.deepEqual(Object.keys(geschreven.werken), ["90000001"]);
  assert.deepEqual(V.validateKaartUitleg(geschreven), []);
  assert.ok(logs.some((r) => /items overgeslagen/.test(r) && /"weggelaten":1/.test(r)), logs.join(" "));
  // Een fout van het document zelf houdt het bestand nog altijd tegen.
  assert.deepEqual(V.kaartUitlegFouten({ ...geschreven, schemaVersion: 2 }).document, ["schemaVersion ongeldig"]);
});
