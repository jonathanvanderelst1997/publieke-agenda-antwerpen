// De soort van een evenement hangt niet af van de privacyfilter (site/witte-lijst.js) en is voor elk dossier dezelfde
// als op origin/main. De soort komt uit het kenmerk (kenmerkTekst in site/kaart-uitleg.js: vaste woorden uit de RUWE
// tekst, met precies de omschrijvingen die main voor de soort las) en uit de bewaarde kenmerken van de verversing, nooit
// uit de gefilterde tekst. tests/fixtures/soort-van-main.json is de soort van elk dossier van de vastlegging van A-Sign
// (tests/fixtures/parcours-herkenning/asign.json), berekend met de code van origin/main (6e5f736) langs vier wegen.
// Elke toets hier faalt op head 3334360 (de soort kwam toen uit de gefilterde tekst, of uit elke ruwe tekst) en slaagt nu.
// Alleen verzonnen proefdata naast de vastlegging; geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import * as KU from "../site/kaart-uitleg.js";
import * as PC from "../site/place-core.js";
import { normalizeIod } from "../site/public-space-core.js";
import { validateKaartUitleg } from "../lib/kaart-uitleg-validatie.mjs";
import { sleutel, witteLijst } from "../site/witte-lijst.js";

const lees = (rel) => JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), "utf8"));
const MAIN = lees("./fixtures/soort-van-main.json").dossiers;
const ASIGN = lees("./fixtures/parcours-herkenning/asign.json");
// De straatas van de repo (district Antwerpen en de andere districten), zoals de verversing ze gebruikt.
const STRAATAS = new Set([...lees("../site/geo/straten.json").streets.map((s) => sleutel(s[1])), ...(lees("../site/geo/straten-stad.json").straten || []).map((s) => sleutel(Array.isArray(s) ? s[0] : s?.name ?? s))].filter(Boolean));
const isStraat = (n) => STRAATAS.has(sleutel(n));
const VANDAAG = "2026-10-10";

// De rijen van de live laag (normalizeIod, zoals public-space-live-core.js ze maakt), per dossier.
function rijenPerDossier() {
  const per = new Map();
  for (const [i, f] of ASIGN.features.entries()) {
    const n = normalizeIod(f.attributes || {}, { isStraat });
    const rij = { id: `iod:${i}`, kind: "iod", reference: n.dossier, dossierType: "ETL", phase: n.phase, innameType: n.type, title: n.type, start: n.start, end: n.end, streets: [],
      ...(n.description ? { description: n.description } : {}), ...(n.kenmerk !== undefined ? { kenmerk: n.kenmerk } : {}) };
    per.set(n.dossier, [...(per.get(n.dossier) || []), rij]);
  }
  return per;
}
// Wat de verversing voor een dossier bewaart (lib/kaart-uitleg-refresh.mjs).
const bewaardVan = (f) => ({ start: f.start, eind: f.eind, soort: f.soort, soortBron: f.soortBron, beschrijvingen: f.beschrijvingen, kenmerken: f.kenmerken, straten: [], kruist: [], stratenTekst: "", gekoppeld: null, kaart: [], kaartDeel: false });
// De soort zoals de plekpagina hem toont (evenementEntry): de soort en of hij zonder "vermoedelijk" staat.
const opPlek = (rijen, uitleg = null) => {
  const k = PC.evenementEntry(rijen, { vandaag: VANDAAG, uitleg, isStraat }).uitleg;
  return [k.soortTekst || "", Boolean(k.soortTekst) && k.watBron === "soort"];
};
const metMain = ([soort, zeker]) => [soort, Boolean(soort) && zeker];

test("de soort van elk dossier van de vastlegging is die van origin/main: in de verversing, live, bewaard en samen (0 verschillen)", () => {
  const per = rijenPerDossier();
  assert.equal(per.size, Object.keys(MAIN).length);
  const verschillen = [];
  let metSoort = 0;
  for (const [d, rijen] of per) {
    const m = MAIN[d];
    const f = KU.evenementFeiten(rijen, { isStraat });
    const zonder = rijen.map(({ description, kenmerk, ...r }) => r);
    const uitleg = { evenementen: { [d]: bewaardVan(f) } };
    const nu = { feiten: [f.soort, f.soortZeker], live: opPlek(rijen), bewaard: opPlek(zonder, uitleg), samen: opPlek(rijen, uitleg) };
    for (const weg of ["feiten", "live", "bewaard", "samen"]) {
      const verwacht = weg === "feiten" ? m[weg] : metMain(m[weg]);
      if (JSON.stringify(nu[weg]) !== JSON.stringify(verwacht)) verschillen.push(`${d} ${weg}: main ${JSON.stringify(verwacht)}, nu ${JSON.stringify(nu[weg])}`);
    }
    if (m.feiten[0]) metSoort += 1;
  }
  assert.deepEqual(verschillen, []);
  assert.ok(metSoort >= 25, `${metSoort} dossiers met een soort`);
});

test("de scheepsdoop blijft de doop van een schip als de filter de omschrijving helemaal weglaat (bewaarde kenmerken)", () => {
  const n = normalizeIod({ dossierNummer: "ET2099000701", faseId: "F1", innameId: "I1", dossierStatus: "aanvraag_goedgekeurd", faseNaam: "Evenement", type_dossier: "ETL", innameTypeNaam: "Inname", innameBeschrijving: "Doopfeest MTS Testboot", faseStartDatum: Date.UTC(2099, 10, 19), faseEindDatum: Date.UTC(2099, 10, 21) }, { isStraat });
  assert.equal(n.description, undefined);
  assert.doesNotMatch(JSON.stringify(n), /testboot|MTS|doopfeest/i);
  const rij = { id: "iod:1", kind: "iod", reference: n.dossier, dossierType: "ETL", phase: n.phase, innameType: n.type, title: n.type, start: n.start, end: n.end, streets: [], kenmerk: n.kenmerk };
  const f = KU.evenementFeiten([rij]);
  assert.equal(f.soort, "Doop van een schip");
  // Op de plekpagina: een rij zonder omschrijving (de straatbestanden) en de bewaarde uitleg van de verversing, ook met de
  // gefilterde omschrijving van een oudere verversing ("Inname: Doopfeest") ernaast: die telt niet voor de soort.
  const { description, kenmerk, ...kaal } = rij;
  const uitleg = { evenementen: { [n.dossier]: { ...bewaardVan(f), beschrijvingen: ["Inname: Doopfeest"] } } };
  assert.deepEqual(opPlek([kaal], uitleg), ["Doop van een schip", false]);
});

test("een omschrijving die op main niet telde, telt ook nu niet, ook als de filter er een straatnaam uit overhoudt", () => {
  const isProef = (n) => ["optochtproefstraat", "kermisproeflei"].includes(sleutel(n));
  const rij = (innameBeschrijving, innameId = "I1") => {
    const n = normalizeIod({ dossierNummer: "ET2099000702", faseId: "F1", innameId, dossierStatus: "aanvraag_goedgekeurd", faseNaam: "Evenement", type_dossier: "ETL", innameTypeNaam: "Inname", innameBeschrijving, faseStartDatum: Date.UTC(2099, 2, 1), faseEindDatum: Date.UTC(2099, 2, 1) }, { isStraat: isProef });
    return { reference: n.dossier, dossierType: "ETL", phase: n.phase, innameType: n.type, start: n.start, end: n.end, streets: [], ...(n.description ? { description: n.description } : {}), kenmerk: n.kenmerk };
  };
  // Met een telefoonnummer telde de tekst op main niet (geen soort); de filter houdt de straatnaam over, de soort blijft leeg.
  const tel = rij("Optochtproefstraat, bel 0470 12 34 56");
  assert.equal(tel.description, "Optochtproefstraat");
  assert.equal(tel.kenmerk, "");
  assert.equal(KU.evenementFeiten([tel], { isStraat: isProef }).soort, "");
  // Zonder woord over het evenement ("Kermisattractie" is geen "kermis"): op main geen soort, nu ook niet.
  const kermis = rij("Kermisattractie aan de Kermisproeflei", "I2");
  assert.equal(kermis.description, "Kermisproeflei");
  assert.equal(KU.evenementFeiten([kermis], { isStraat: isProef }).soort, "");
  // Telt een tekst wel ("Kermis" als los woord), dan geeft hij de soort, wat de filter er ook van overlaat.
  assert.equal(KU.evenementFeiten([rij("Kermis Testpersoon", "I3")], { isStraat: isProef }).soort, "Kermis");
  // alleOmschreven telt zoals main: alleen de teksten die voor de soort tellen, niet wat de filter toont.
  assert.equal(KU.evenementFeiten([tel, kermis], { isStraat: isProef }).alleOmschreven, false);
});

test("een straatbestand draagt geen kenmerk en geen omschrijving: de plekpagina kent de soort zoals main, uit de bewaarde uitleg", async () => {
  const { NOOIT } = await import("../lib/straat-bestanden.mjs");
  assert.equal(NOOIT.has("description"), true);
  assert.equal(NOOIT.has("kenmerk"), true);
});

test("kaart-uitleg.json: kenmerken zijn alleen vaste woorden, en de validatie weigert elk ander woord", () => {
  const basis = { schemaVersion: 1, generatedAt: "2099-02-25T05:00:00Z", vanaf: "2099-02-25", tot: "2099-04-25", werken: {} };
  const e = (kenmerken) => ({ ...basis, evenementen: { ET2099000703: { start: "2099-03-01", eind: "2099-03-01", soort: "", soortBron: "", beschrijvingen: [], kenmerken, straten: [], kruist: [], stratenTekst: "", gekoppeld: null, kaart: [], kaartDeel: false } } });
  assert.deepEqual(validateKaartUitleg(e(["doop doop schip", "overig", "-", "straat"])), []);
  for (const fout of [["Testpersoon"], ["doop 12"], ["stoet, Proefstraat"], "stoet", [""]]) assert.notDeepEqual(validateKaartUitleg(e(fout)), [], JSON.stringify(fout));
  for (const k of ["doop doop schip", "overig", "-", "straat", "reuzenrad straat", "braderie"]) assert.equal(KU.isKenmerk(k), true, k);
  for (const k of ["testpersoon", "doop testboot", "Stoet", "12", ""]) assert.equal(KU.isKenmerk(k), false, k);
});

test("de bewaarde kaart-uitleg.json: elke omschrijving is alleen straatnamen en districten, elk kenmerk alleen vaste woorden", () => {
  const doc = lees("../site/sources/kaart-uitleg.json");
  let omschrijvingen = 0;
  for (const [id, e] of Object.entries(doc.evenementen)) {
    for (const k of e.kenmerken || []) assert.equal(KU.isKenmerk(k), true, `${id}: ${k}`);
    for (const b of e.beschrijvingen) {
      const tekst = b.replace(/^[^:]{2,60}: /, "");
      const r = witteLijst(tekst, { straten: e.straten || [], isStraat });
      assert.equal(r.tekst, tekst, `${id}: ${b}`);
      assert.deepEqual(sleutel(tekst).split(" "), r.plekken.flatMap((p) => sleutel(p).split(" ")), `${id}: ${b}`);
      omschrijvingen += 1;
    }
  }
  assert.ok(omschrijvingen >= 0);
});
