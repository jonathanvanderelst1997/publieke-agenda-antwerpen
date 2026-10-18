// De naam van een fase (faseNaam, A-Sign laag 22 en 23) is een vrij in te vullen veld. Op de site komt alleen een vaste
// vorm ("Evenement", "Opbouw", "Afbraak", "Opname periode 3", "Opname periode 1-2", "Opname periode 1----2"), het vaste
// woord "Opname", of na de grondregel (site/witte-lijst.js) een volledige straatnaam of district; anders "". Dat geldt
// bij de ingang (normalizeIod in site/public-space-core.js, dossiersUitAsign in lib/parcours-herkenning.mjs), bij het
// lezen van een bewaard bestand (dossierFeiten en feitenUitItem in lib/asign-evenementen-agenda.mjs, straatItems in
// site/straat-snapshot.js) en in de controle van het bronbestand (lib/source-feed.mjs). Elke toets hier faalt op head
// fe8eb62 (faseNaam ging daar ongefilterd door) en slaagt nu. Alleen verzonnen gegevens; geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import * as W from "../site/witte-lijst.js";
import { normalizeIod } from "../site/public-space-core.js";
import { collectPublicSpace } from "../site/public-space-live-core.js";
import { isOpnameFase } from "../site/evenement-wat.js";
import { straatItems } from "../site/straat-snapshot.js";
import { dossiersUitAsign } from "../lib/parcours-herkenning.mjs";
import { dossierFeiten, feitenUitItem } from "../lib/asign-evenementen-agenda.mjs";
import { sourceDocument, validateSourceDocument } from "../lib/source-feed.mjs";
import { faseSamenvattingen } from "../scripts/build-straat-snapshots.mjs";

const lees = (rel) => JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), "utf8"));
const STRATEN = ["Proefstraat", "Lange Proefstraat", "Van Testlei", "Sint-Proefplein", "Testkaai"];
const STRAATAS = new Set(STRATEN.map(W.sleutel));
const isStraat = (n) => STRAATAS.has(W.sleutel(n));
const NEGEN = W.DISTRICTEN;
const TOEGESTAAN = new Set([...STRAATAS, ...NEGEN.map(W.sleutel)]);
// De vaste vormen zoals ze in A-Sign staan (gemeten 17 oktober 2026: 17 waarden in deze 6 vormen).
const ECHT = ["Evenement", "Opbouw", "Afbraak", "Opname periode 3", "Opname periode 0", "Opname periode 11", "Opname periode 1-2", "Opname periode 1----2"];
const VAST = /^(?:Fase \d{1,2}|(?:Fase )?(?:Evenement|Opbouw|Afbraak|Opname|opname periode \d{1,2}(?: ?-{1,4} ?\d{1,2})?))$/i;

// Wat de site van een naam mag tonen: "", een vaste vorm, of alleen hele straatnamen en districten (geen cijfer, geen @).
function alleenVastOfPlek(invoer, uit) {
  if (!uit) return;
  if (VAST.test(uit)) return;
  assert.doesNotMatch(uit, /[\p{N}@＠]/u, `${JSON.stringify(invoer)} → ${JSON.stringify(uit)}`);
  const w = W.sleutel(uit).split(" ").filter(Boolean);
  const kan = new Array(w.length + 1).fill(false);
  kan[0] = true;
  for (let i = 0; i < w.length; i += 1) if (kan[i]) for (let n = 1; n <= 8 && i + n <= w.length; n += 1) if (TOEGESTAAN.has(w.slice(i, i + n).join(" "))) kan[i + n] = true;
  assert.ok(kan[w.length], `${JSON.stringify(invoer)} → ${JSON.stringify(uit)}: geen vaste fase, straat of district`);
  assert.ok(uit.length <= W.FASE_MAX, `${JSON.stringify(uit)} is langer dan ${W.FASE_MAX}`);
}

test("faseNaam: de echte vormen blijven onveranderd, ook in de vastlegging van A-Sign; het vaste woord krijgt zijn hoofdletter", () => {
  for (const v of ECHT) assert.equal(W.veiligeFase(v), v, v);
  for (const v of ECHT) assert.equal(W.veiligeFase(v, { isStraat }), v, v);
  const vastlegging = lees("./fixtures/parcours-herkenning/asign.json").features.map((f) => f.attributes.faseNaam);
  assert.ok(vastlegging.length > 1000);
  for (const v of new Set(vastlegging)) assert.equal(W.veiligeFase(v), v, "geen enkele echte waarde verandert");
  assert.equal(W.veiligeFase("  opbouw "), "Opbouw");
  assert.equal(W.veiligeFase("EVENEMENT"), "Evenement");
  assert.equal(W.veiligeFase("Opname  periode 2"), "Opname periode 2", "alleen de witruimte samengevoegd");
  assert.equal(W.veiligeFase("Fase Evenement"), "Fase Evenement");
  assert.equal(W.veiligeFase("fase 2"), "Fase 2");
  assert.equal(W.veiligeFase("Fase 2099"), "");
  assert.equal(W.veiligeFase(""), "");
  assert.equal(W.veiligeFase(null), "");
});

test("faseNaam: een naam, telefoonnummer, mailadres of huisnummer valt weg; een straat of district blijft alleen als hele naam", () => {
  assert.equal(W.veiligeFase("Opbouw Proefstraat 12 bij Testpersoon"), "");
  assert.equal(W.veiligeFase("Opbouw Proefstraat 12 bij Testpersoon", { isStraat }), "Proefstraat");
  assert.equal(W.veiligeFase("0470 00 00 00"), "");
  assert.equal(W.veiligeFase("x@voorbeeld.test"), "");
  assert.equal(W.veiligeFase("Afbraak door Testpersoon Voorbeeld", { isStraat }), "");
  assert.equal(W.veiligeFase("Evenement in Berchem"), "Berchem");
  assert.equal(W.veiligeFase("Opbouw Testpersoon"), "");
  // Een opname blijft een opname (de soort film- of foto-opname, zoals op main), zonder de rest van de tekst.
  for (const v of ["Opname Testpersoon 0470 00 00 00", "Opname bij x@voorbeeld.test", "opname periode 123 Proefstraat 5", "Opname-dag Testpersoon"]) {
    assert.equal(W.veiligeFase(v, { isStraat }), "Opname", v);
    assert.equal(isOpnameFase(W.veiligeFase(v)), isOpnameFase(v), v);
  }
});

// ======== eigenschap: duizenden verzonnen vormen in faseNaam ========

const toeval = (zaad) => () => { zaad |= 0; zaad = (zaad + 0x6D2B79F5) | 0; let t = Math.imul(zaad ^ (zaad >>> 15), 1 | zaad); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const LETTERGREPEN = ["zor", "vex", "quil", "xan", "dux", "kyl", "wix", "jor", "nix", "plo", "gav", "yur", "tev", "hox"];
function vorm(r) {
  const kies = (lijst) => lijst[Math.floor(r() * lijst.length)];
  const deel = () => { let w = ""; for (let i = 0, n = 2 + Math.floor(r() * 2); i < n; i += 1) w += kies(LETTERGREPEN); return w; };
  const groot = (w) => w[0].toUpperCase() + w.slice(1);
  const n = () => 1 + Math.floor(r() * 150);
  const naam = kies([() => `${groot(deel())} ${groot(deel())}`, () => groot(deel()), () => `Van ${groot(deel())}`, () => `D'${groot(deel())}`, () => `fam. ${deel()}`, () => deel().toUpperCase()])();
  const nummer = kies([() => `${n()}`, () => `nr ${n()}`, () => `${n()}-${n()}`, () => `${n()}a`, () => `0470 ${n()} 00 00`, () => `+32 3 ${n()} 45 67`, () => `0471/${n()}.34.56`, () => `IBAN BE68 5390 0754 ${n()}`])();
  const mail = kies([() => `${W.sleutel(naam).replace(/ /g, ".") || "x"}@voorbeeld.test`, () => `info@${deel()}.test`, () => `www.${deel()}.test`])();
  const straat = kies([...STRATEN, ...NEGEN]);
  const woord = kies(["Evenement", "Opbouw", "Afbraak", "Opname", "Opname periode 2", "Fase", "Inname", "Feest"]);
  return kies([
    () => `${woord} ${naam}`, () => `${naam} ${woord}`, () => `${woord} ${straat} ${nummer}`, () => `${woord} ${nummer}`, () => `${woord} ${mail}`, () => nummer, () => mail, () => naam,
    () => `${woord} bij ${naam} (${nummer})`, () => `${straat} ${nummer} ${naam}`, () => `${woord}: ${straat}`, () => `${woord} ${straat}-${naam}`, () => `${naam}, ${mail}, ${nummer}`,
    () => `${woord} ${straat}`, () => straat, () => `${woord} ${straat}${nummer}`,
  ])();
}

test("eigenschap: voor duizenden verzonnen naam-, telefoon-, mail- en huisnummervormen in faseNaam blijft alleen een vaste fase, straat of district over", () => {
  const r = toeval(20261017);
  let vormen = 0, metPlek = 0, metVast = 0;
  for (let i = 0; i < 4000; i += 1) {
    const v = vorm(r);
    const uitkomsten = [W.veiligeFase(v), W.veiligeFase(v, { isStraat }), W.veiligeFase(v, { straten: STRATEN.map((name) => ({ name })) }), W.veiligeFase(v, { rond: () => STRATEN }),
      normalizeIod({ faseNaam: v, dossierNummer: "ET2099000001", faseId: "1", innameId: "1" }, { isStraat }).phase];
    for (const uit of uitkomsten) alleenVastOfPlek(v, uit);
    // Een opname blijft een opname (de soort), wat er ook achter staat.
    assert.equal(isOpnameFase(uitkomsten[1]), isOpnameFase(v), v);
    vormen += 1;
    if (uitkomsten[1] && !VAST.test(uitkomsten[1])) metPlek += 1;
    if (VAST.test(uitkomsten[1])) metVast += 1;
  }
  assert.ok(vormen >= 4000);
  // De toets zegt alleen iets als er ook plekken en vaste vormen blijven.
  assert.ok(metPlek > 300, `${metPlek} met een plek`);
  assert.ok(metVast > 300, `${metVast} met een vaste vorm`);
});

// ======== waar faseNaam binnenkomt en bewaard wordt ========

const rij = (faseNaam, i = 1) => ({
  attributes: { dossierNummer: "ET2099000001", dossierStatus: "aanvraag_goedgekeurd", faseNaam, faseId: String(i), innameId: String(i), innameTypeNaam: "Parcours",
    innameBeschrijving: "", faseStartDatum: Date.parse("2099-03-01T08:00:00Z"), faseEindDatum: Date.parse("2099-03-02T08:00:00Z") },
  geometry: { paths: [[[4.40, 51.21], [4.41, 51.21]]] },
});
const VALS = ["Opbouw Proefstraat 12 bij Testpersoon", "0470 00 00 00", "x@voorbeeld.test", "Afbraak Testpersoon Voorbeeld"];

test("ingang: normalizeIod en de live laag geven geen vrije tekst in phase of detail", () => {
  for (const v of VALS) {
    const n = normalizeIod(rij(v).attributes, { isStraat });
    assert.ok(n.phase === "" || n.phase === "Proefstraat", `${v} → ${n.phase}`);
  }
  const district = { type: "Polygon", coordinates: [[[4.3, 51.1], [4.5, 51.1], [4.5, 51.3], [4.3, 51.3], [4.3, 51.1]]] };
  const rijen = collectPublicSpace({ iodFeatures: VALS.map((v, i) => rij(v, i + 1)), districtGeometry: district });
  assert.equal(rijen.length, VALS.length);
  for (const x of rijen) {
    assert.doesNotMatch(`${x.phase} ${x.detail}`, /Testpersoon|\d{3}|@|Voorbeeld/, JSON.stringify([x.phase, x.detail]));
  }
});

test("ingang: dossiersUitAsign bewaart alleen veilige fasen; de evenementdag en de opname blijven", () => {
  const d = dossiersUitAsign([rij("Evenement", 1), rij("Opbouw Testpersoon 0470 00 00 00", 2), rij("x@voorbeeld.test", 3), rij("Opname periode 2", 4)]).get("ET2099000001");
  assert.deepEqual(d.fasen.map((f) => f.naam).sort(), ["Evenement", "Opname periode 2"]);
  assert.ok(d.innames.every((i) => ["Evenement", "Opname periode 2", ""].includes(i.fase)), JSON.stringify(d.innames.map((i) => i.fase)));
  assert.equal(d.dag.start, "2099-03-01");
});

test("bewaard: dossierFeiten en feitenUitItem halen een bewaarde naam opnieuw door de filter", () => {
  const fasen = [{ naam: "Opbouw", start: "2099-03-01", eind: "2099-03-01" }, { naam: "Opbouw Testpersoon", start: "2099-03-01", eind: "2099-03-02" }, { naam: "Evenement", start: "2099-03-02", eind: "2099-03-02" }];
  assert.deepEqual(dossierFeiten({ dossier: "ET2099000001", fasen }).fasen.map((f) => f.naam), ["Opbouw", "Evenement"]);
  assert.deepEqual(feitenUitItem({ feiten: { dossier: "ET2099000001" }, fasen }).fasen.map((f) => f.naam), ["Opbouw", "Evenement"]);
});

test("bronbestand: een fase met een naam die geen vaste fase, straat of district is, wordt geweigerd", () => {
  const item = (fasen) => ({
    id: "asign-ev-et2099000001-2099-03-02", externalId: "ET2099000001", title: "Evenement in de Proefstraat", theme: "Activiteit", className: "activity",
    date: "2099-03-02", endDate: null, timeSlot: "Info", timeText: "", location: "Proefstraat", postcodes: ["2000"], info: "", kind: "activity",
    sourceUrl: "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/22", retrievedAt: "2099-03-01T05:00:00.000Z", reviewRequired: false, inDistrict: true,
    fasen, straten: ["Proefstraat"],
  });
  const fouten = (fasen) => validateSourceDocument(sourceDocument("district-asign-evenementen", { retrievedAt: "2099-03-01T05:00:00.000Z", fetchStatus: "ok", items: [item(fasen)] }), { expectedSourceId: "district-asign-evenementen" }).join(" ");
  const f = (naam) => [{ naam, start: "2099-03-02", eind: "2099-03-02" }];
  for (const naam of ["Evenement", "Opbouw", "Opname periode 1-2", "Berchem", "Proefstraat"]) assert.equal(fouten(f(naam)), "", naam);
  for (const naam of VALS) assert.match(fouten(f(naam)), /geen vaste fase, straat of district/, naam);
});

test("straatbestand: een bewaarde phase en detail gaan opnieuw door de filter; de ids van de samenvattingen blijven gelijk", () => {
  const doc = {
    straten: [["s1", "Proefstraat", "2000"]],
    publiekeRuimte: [
      { id: "iod:ET2099000001|1|1", kind: "iod", phase: "Opbouw Testpersoon 0470 00 00 00", detail: "Fase Opbouw Testpersoon 0470 00 00 00 · Dossiertype ETL", streets: [0] },
      { id: "iod:ET2099000001|2|2", kind: "iod", phase: "Proefstraat", detail: "Fase Proefstraat", streets: [0] },
      { id: "iod:ET2099000001|fase|x@voorbeeld.test|parcours", kind: "iod", phase: "x@voorbeeld.test", faseSamenvatting: true, streets: [] },
      { id: "iod:ET2099000001|3|3", kind: "iod", phase: "Opname periode 2", detail: "Fase Opname periode 2 · Hinder volgens IOD: True", streets: [0] },
    ],
  };
  const [a, b, c, d] = straatItems(doc, "publiekeRuimte");
  assert.deepEqual([a.phase, a.detail], ["", "Dossiertype ETL"]);
  assert.deepEqual([b.phase, b.detail], ["Proefstraat", "Fase Proefstraat"], "een straat van de inname zelf blijft");
  assert.deepEqual([c.phase, c.detail], ["", ""]);
  assert.deepEqual([d.phase, d.detail], ["Opname periode 2", "Fase Opname periode 2 · Hinder volgens IOD: True"]);
  // De ids van de samenvattingen per fase (iod:REF|fase|X|soort) blijven voor de echte vormen dezelfde.
  const rijen = ["Evenement", "Opbouw", "Opname periode 1----2"].map((phase, i) => ({ id: `iod:ET2099000001|${i}|${i}`, kind: "iod", reference: "ET2099000001", dossierType: "ETL", phase: normalizeIod({ faseNaam: phase }).phase, innameType: "Parcours", start: "2099-03-01", end: "2099-03-02", streets: [] }));
  const ids = faseSamenvattingen(rijen).get("ET2099000001").map((x) => x.id).sort();
  assert.deepEqual(ids, ["iod:ET2099000001|fase|Evenement|parcours", "iod:ET2099000001|fase|Opbouw|parcours", "iod:ET2099000001|fase|Opname periode 1----2|parcours"]);
});
