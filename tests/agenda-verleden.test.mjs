// Het verleden van de agenda (besluit van de eigenaar van 3 november 2026: "alles wat ooit in agenda staat, publiek blijft
// staan, maar verdwijnt dan naar verleden"). lib/agenda-verleden.mjs houdt per agendapunt met een eigen pagina een record
// bij, scripts/build-agenda.mjs wist geen eventpagina meer, en /verleden/ (site/agenda-verleden.js) toont wat voorbij is,
// het nieuwste eerst. De parkeerverboden die de site zag, staan er ook (site/verleden/parkeerverboden/): als
// "Parkeerverbod" met de plaats en het huisnummer, nooit de reden. Alleen verzonnen punten en straten; geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  PARKEER_VERLEDEN_DIR,
  isParkeerMaandBestand,
  parkeerBestanden,
  parkeerRecordProblemen,
  parkeerRecordVanItem,
  validateParkeerMaand,
  werkParkeerverledenBij,
  VERLEDEN_DIR,
  VERLEDEN_INDEX_FILE,
  isVerledenMaandBestand,
  paginaStand,
  validateVerledenIndex,
  validateVerledenMaand,
  verledenBestanden,
  verledenDigest,
  verledenMaandTekst,
  verledenRecordProblemen,
  werkVerledenBij,
} from "../lib/agenda-verleden.mjs";
import { bouwEventpagina, leesEventpagina } from "../lib/eventpagina.mjs";
import { officieleStraatnamen } from "../lib/parkeer-historiek.mjs";
import { filterParkeer, filterVerleden, inVerleden, maandenTotNu, parkeerInVerleden, perDag, verledenHtml } from "../site/agenda-verleden.js";
import { checkDataLane } from "../lib/data-lane.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const punt = (id, extra = {}) => ({
  id,
  title: "Buurtfeest Proefplein",
  info: "Gratis buurtfeest met muziek.",
  date: "2099-05-02",
  endDate: null,
  dateLabel: "2 mei 2099",
  timeText: "14 tot 18 uur",
  timeSlot: "14:00",
  location: "Proefplein 12, 2000 Antwerpen",
  theme: "Activiteit",
  scope: "district",
  sourceId: "district-kalender",
  sourcePublisher: "District Antwerpen",
  bronnen: [{ url: `https://www.antwerpen.be/info/${id}/buurtfeest`, label: "Districtskalender" }],
  attributie: "Bron: district Antwerpen – bron stad Antwerpen (Vlaamse gratis open data licentie)",
  ...extra,
});
const perId = (records) => new Map(records.map((record) => [record.id, record]));

test("een publiek punt krijgt een record; sinds blijft de eerste dag; het huisnummer blijft zoals gepubliceerd", () => {
  const eerste = werkVerledenBij([], [punt("kal-a-2099-05-02")], "2099-04-01");
  assert.equal(eerste.records.length, 1);
  assert.equal(eerste.records[0].sinds, "2099-04-01");
  assert.equal(eerste.records[0].location, "Proefplein 12, 2000 Antwerpen");
  assert.ok(eerste.actueleIds.has("kal-a-2099-05-02"));
  const tweede = werkVerledenBij(eerste.records, [punt("kal-a-2099-05-02", { title: "Buurtfeest Proefplein (verplaatst)" })], "2099-04-10");
  assert.equal(tweede.records[0].sinds, "2099-04-01");
  assert.equal(tweede.records[0].title, "Buurtfeest Proefplein (verplaatst)", "een actueel punt toont wat de pagina nu toont");
});

test("voorbij of weggevallen: het record blijft; weg alleen als het vóór de laatste dag uit de agenda viel, en weer weg als het terugkomt", () => {
  const start = werkVerledenBij([], [punt("kal-a-2099-05-02"), punt("kal-b-2099-05-20", { title: "Rommelmarkt", date: "2099-05-20", dateLabel: "20 mei 2099" })], "2099-05-01").records;
  // 3 mei: a is voorbij (normaal afgelopen), b is er niet meer (nog niet voorbij).
  const mei3 = werkVerledenBij(start, [], "2099-05-03");
  assert.equal(mei3.records.length, 2);
  assert.equal(perId(mei3.records).get("kal-a-2099-05-02").weg, undefined);
  assert.equal(perId(mei3.records).get("kal-b-2099-05-20").weg, "2099-05-03");
  assert.equal(paginaStand(perId(mei3.records).get("kal-a-2099-05-02"), { actueel: false, asOf: "2099-05-03" }), "voorbij");
  assert.equal(paginaStand(perId(mei3.records).get("kal-b-2099-05-20"), { actueel: false, asOf: "2099-05-03" }), "weg");
  // Idempotent: dezelfde dag nog eens geeft hetzelfde.
  assert.deepEqual(werkVerledenBij(mei3.records, [], "2099-05-03").records, mei3.records);
  // b komt terug: geen weg meer.
  const mei4 = werkVerledenBij(mei3.records, [punt("kal-b-2099-05-20", { title: "Rommelmarkt", date: "2099-05-20", dateLabel: "20 mei 2099" })], "2099-05-04");
  assert.equal(perId(mei4.records).get("kal-b-2099-05-20").weg, undefined);
  assert.equal(perId(mei4.records).get("kal-b-2099-05-20").sinds, "2099-05-01");
  // Na de laatste dag van b: voorbij, zonder weg (het stond er tot het einde).
  const juni = werkVerledenBij(mei4.records, [], "2099-06-01");
  assert.equal(perId(juni.records).get("kal-b-2099-05-20").weg, undefined);
  assert.equal(paginaStand(perId(juni.records).get("kal-b-2099-05-20"), { actueel: false, asOf: "2099-06-01" }), "voorbij");
});

test("agendapunten: dezelfde privacyregels als de rest van de site; een parkeerverbod hoort in zijn eigen lijst", () => {
  const { records, geweigerd } = werkVerledenBij([], [
    punt("kal-p-2099-05-02", { kind: "parking" }),
    punt("kal-d-2099-05-02", { info: "Info via proef@voorbeeld.be" }),
    punt("kal-e-2099-05-02", { info: "Bel 03 123 45 67" }),
    punt("kal-f-2099-05-02", { title: "Verhuislift Proefstraat" }),
    punt("kal-g-2099-05-02", { bronnen: [{ url: "https://geo.api.vlaanderen.be/GIPOD/ogc/features/collections/x/items/1", label: "GIPOD" }] }),
    punt("kal-h-2099-05-02", { bronnen: [{ url: "https://www.antwerpen.be/info/x?utm=1", label: "Bron" }] }),
    punt("kal-ok-2099-05-02"),
  ], "2099-04-01");
  assert.deepEqual(records.map((record) => record.id), ["kal-ok-2099-05-02"]);
  assert.equal(geweigerd.length, 6);
});

// Verzonnen straten: Proefstraat en Testlei, in een eigen lijst officiële straatnamen.
const STRATEN = ["Proefstraat", "Testlei"];
const verbod = (n, extra = {}) => ({
  id: `parking:2099-00${n}|${n}`, kind: "parking", kindLabel: "Parkeerverbod", title: "Parkeerverbod", location: `Proefstraat ${n}, 2000 Antwerpen`,
  start: "2099-05-01T00:00:00.000Z", end: "2099-05-03T00:00:00.000Z", status: "In effect", reference: `2099-00${n}`, detail: "",
  streets: [{ id: "1", name: "Proefstraat", postcode: "2000" }], ...extra,
});

test("parkeerverboden: Parkeerverbod met straat en exact huisnummer, nooit een reden, een naam of het woord verhuis", () => {
  assert.deepEqual(parkeerRecordVanItem(verbod(12), STRATEN), { id: "parking:2099-0012|12", location: "Proefstraat 12, 2000 Antwerpen", start: "2099-05-01", end: "2099-05-03" });
  // Een reden of een naam in het adres valt weg: dan blijft de straat met de postcode.
  assert.equal(parkeerRecordVanItem(verbod(13, { location: "Proefstraat 13 verhuis Jansens 2000 Antwerpen" }), STRATEN).location, "Proefstraat, 2000 Antwerpen");
  // Een reden in het record zelf, of een andere sleutel, wordt geweigerd.
  const goed = parkeerRecordVanItem(verbod(12), STRATEN);
  assert.deepEqual(parkeerRecordProblemen(goed, STRATEN), []);
  assert.ok(parkeerRecordProblemen({ ...goed, reason: "Verhuis" }, STRATEN).some((p) => /onbekende sleutel reason/.test(p)));
  assert.ok(parkeerRecordProblemen({ ...goed, title: "Verhuislift" }, STRATEN).some((p) => /onbekende sleutel title/.test(p)));
  assert.ok(parkeerRecordProblemen({ ...goed, location: "Proefstraat 12 bij Jansens, 2000 Antwerpen" }, STRATEN).some((p) => /publieke vorm/.test(p)));
  assert.ok(parkeerRecordProblemen({ ...goed, location: "Verhuisstraat 3, 2000 Antwerpen" }, ["Verhuisstraat"]).length > 0);
  // Geen parkeerverbod: geen record.
  assert.equal(parkeerRecordVanItem({ id: "iod:ET1|F1|I1", kind: "iod", location: "Proefstraat, 2000 Antwerpen" }, STRATEN), null);
});

test("parkeerverboden: bijhouden per verversing, voorbij of weggevallen, per maand van de laatste dag", () => {
  const a = parkeerRecordVanItem(verbod(12), STRATEN);
  const b = parkeerRecordVanItem(verbod(14, { end: "2099-06-02T00:00:00.000Z" }), STRATEN);
  const eerste = werkParkeerverledenBij([], [a, b], "2099-05-01", { straatnamen: STRATEN });
  assert.equal(eerste.records.length, 2);
  // 4 mei: a is afgelopen (geen weg), b is uit A-Sign verdwenen vóór zijn einde (weg).
  const later = werkParkeerverledenBij(eerste.records, [], "2099-05-04", { straatnamen: STRATEN });
  assert.equal(later.records.find((r) => r.id === a.id).weg, undefined);
  assert.equal(later.records.find((r) => r.id === b.id).weg, "2099-05-04");
  // Laadde de laag niet, dan geen weg.
  assert.equal(werkParkeerverledenBij(eerste.records, [], "2099-05-04", { volledig: false, straatnamen: STRATEN }).records.find((r) => r.id === b.id).weg, undefined);
  assert.deepEqual(werkParkeerverledenBij(later.records, [], "2099-05-04", { straatnamen: STRATEN }).records, later.records, "idempotent");
  const { bestanden, lijst } = parkeerBestanden(later.records, ["2099-04"]);
  assert.deepEqual([...bestanden.keys()], ["2099-04.json", "2099-05.json", "2099-06.json"]);
  assert.deepEqual(lijst.map((e) => [e.maand, e.aantal]), [["2099-04", 0], ["2099-05", 1], ["2099-06", 1]]);
  for (const [name, document] of bestanden) assert.deepEqual(validateParkeerMaand(document, name.slice(0, 7), STRATEN), [], name);
  // Op /verleden/: na de laatste dag, per dag samen, met plaats en periode, zonder reden.
  assert.equal(parkeerInVerleden(a, "2099-05-03"), false);
  assert.equal(parkeerInVerleden(a, "2099-05-04"), true);
  const groepen = perDag([], filterParkeer(later.records, { vandaag: "2099-07-01" }));
  assert.deepEqual(groepen.map((g) => [g.dag, g.parkeerverboden.length]), [["2099-06-02", 1], ["2099-05-03", 1]]);
  const html = verledenHtml(groepen);
  assert.match(html, /Parkeerverbod · Proefstraat 12, 2000 Antwerpen · 1 mei 2099 tot 3 mei 2099/);
  assert.doesNotMatch(html, /verhuis/i);
  assert.deepEqual(filterParkeer(later.records, { vandaag: "2099-07-01", zoek: "proefstraat 14" }).map((r) => r.id), [b.id]);
});

test("ontdubbelen: een hernummerd punt gaat op in het nieuwe; twee evenementendossiers niet; over bronnen heen alleen met een specifieke link", () => {
  const oud = werkVerledenBij([], [
    punt("stad-news-x-t0r12-2099-05-02", { sourceId: "stad-districten" }),
    punt("asign-ev-et2099000001-2099-05-02", { sourceId: "district-asign-evenementen", title: "Vermoedelijk een buurtfeest in de Proefstraat", bronnen: [{ url: "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/22", label: "A-Sign" }] }),
    punt("kal-z-2099-05-02", { title: "Zomerbal", bronnen: [{ url: "https://www.antwerpen.be/info/zomerbal-2099", label: "Kalender" }] }),
  ], "2099-04-01").records;
  const nu = werkVerledenBij(oud, [
    punt("stad-news-x-t0r11-2099-05-02", { sourceId: "stad-districten" }),
    punt("asign-ev-et2099000002-2099-05-02", { sourceId: "district-asign-evenementen", title: "Vermoedelijk een buurtfeest in de Proefstraat", bronnen: [{ url: "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/22", label: "A-Sign" }] }),
    // Het zomerbal staat nu onder een dossier van de stad, met de kalenderpagina als tweede bron.
    punt("asign-ev-et2099000003-2099-05-02", { sourceId: "district-asign-evenementen", title: "Zomerbal op het Proefplein", bronnen: [{ url: "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/22", label: "A-Sign" }, { url: "https://www.antwerpen.be/info/zomerbal-2099", label: "Kalender" }] }),
  ], "2099-04-05");
  const r = perId(nu.records);
  assert.equal(r.get("stad-news-x-t0r12-2099-05-02").opgegaanIn, "stad-news-x-t0r11-2099-05-02");
  assert.equal(r.get("asign-ev-et2099000001-2099-05-02").opgegaanIn, undefined, "een ander dossier is een ander punt");
  assert.equal(r.get("kal-z-2099-05-02").opgegaanIn, "asign-ev-et2099000003-2099-05-02");
  assert.equal(paginaStand(r.get("kal-z-2099-05-02"), { actueel: false, asOf: "2099-04-05" }), "opgegaan");
  // In het verleden staat een opgegaan punt niet dubbel.
  const vandaag = "2099-05-03";
  const zichtbaar = filterVerleden(nu.records, { vandaag, alleenDistrict: false }).map((record) => record.id).sort();
  assert.deepEqual(zichtbaar, ["asign-ev-et2099000001-2099-05-02", "asign-ev-et2099000002-2099-05-02", "asign-ev-et2099000003-2099-05-02", "stad-news-x-t0r11-2099-05-02"]);
  // Een algemene link (dezelfde hoofdlink bij verschillende punten) koppelt niets.
  const algemeen = "https://www.antwerpen.be/info/kalender";
  const a = werkVerledenBij([], [punt("kal-p-2099-05-02", { title: "Lezing", bronnen: [{ url: algemeen, label: "Kalender" }] }), punt("kal-q-2099-05-09", { title: "Concert", date: "2099-05-09", bronnen: [{ url: algemeen, label: "Kalender" }] })], "2099-04-01").records;
  const b = werkVerledenBij(a, [punt("asign-ev-et2099000009-2099-05-02", { sourceId: "district-asign-evenementen", title: "Vermoedelijk een lezing", bronnen: [{ url: "https://geodata.antwerpen.be/x", label: "A-Sign" }, { url: algemeen, label: "Kalender" }] })], "2099-04-02");
  assert.equal(perId(b.records).get("kal-p-2099-05-02").opgegaanIn, undefined);
});

test("bestanden: één per maand van de laatste dag, een index met aantal en digest; een lege maand blijft bestaan", () => {
  const { records } = werkVerledenBij([], [
    punt("kal-a-2099-05-02"),
    punt("kal-b-2099-05-30", { date: "2099-05-30", endDate: "2099-06-02", dateLabel: "30 mei tot 2 juni 2099" }),
  ], "2099-04-01");
  const { index, bestanden } = verledenBestanden(records, "2099-04-01", ["2099-03"]);
  assert.deepEqual([...bestanden.keys()], ["2099-03.json", "2099-05.json", "2099-06.json"]);
  assert.deepEqual(bestanden.get("2099-03.json").items, []);
  assert.deepEqual(validateVerledenIndex(index), []);
  for (const [name, document] of bestanden) {
    assert.deepEqual(validateVerledenMaand(document, name.slice(0, 7)), []);
    assert.deepEqual(JSON.parse(verledenMaandTekst(document)), document);
  }
  assert.equal(index.aantal, 2);
  assert.equal(index.maanden.find((m) => m.maand === "2099-06").digest, verledenDigest(bestanden.get("2099-06.json").items));
  assert.deepEqual(validateVerledenMaand({ ...bestanden.get("2099-06.json"), maand: "2099-05" }, "2099-05").filter((f) => /maand/.test(f)).length > 0, true);
});

test("eventpagina: actueel naar de agenda, voorbij naar het verleden, weg met de datum, opgegaan naar het nieuwe punt; terug te lezen", () => {
  const record = { ...punt("kal-a-2099-05-02"), sinds: "2099-04-01" };
  const actueel = bouwEventpagina(record, { stand: "actueel", maand: "2099-05" });
  assert.match(actueel, /href="\/\?event=kal-a-2099-05-02">Bekijk in de volledige agenda/);
  assert.doesNotMatch(actueel, /event-verleden/);
  const voorbij = bouwEventpagina(record, { stand: "voorbij", maand: "2099-05" });
  assert.match(voorbij, /href="\/verleden\/\?maand=2099-05#kal-a-2099-05-02">Bekijk in het verleden/);
  assert.match(voorbij, /class="event-verleden">Voorbij\./);
  assert.doesNotMatch(voorbij, /\?event=/);
  const weg = bouwEventpagina({ ...record, weg: "2099-04-20" }, { stand: "weg", maand: "2099-05" });
  assert.match(weg, /Staat sinds 20 april 2099 niet meer in de agenda/);
  const opgegaan = bouwEventpagina({ ...record, opgegaanIn: "kal-b-2099-05-02" }, { stand: "opgegaan", opgegaanInTitel: "Ander feest" });
  assert.match(opgegaan, /href="\/event\/kal-b-2099-05-02\/"/);
  // Terug lezen geeft wat de pagina toonde.
  const terug = leesEventpagina(actueel);
  for (const veld of ["title", "info", "date", "endDate", "dateLabel", "timeText", "location", "sourcePublisher", "attributie"]) assert.equal(terug[veld], record[veld], veld);
  assert.deepEqual(terug.bronnen, record.bronnen);
  // Een titel met tekens die ontsnapt moeten worden.
  const lastig = { ...record, title: `Feest "<b>" & 'co'` };
  assert.equal(leesEventpagina(bouwEventpagina(lastig)).title, lastig.title);
});

test("/verleden/: alleen wat voorbij is (na middernacht in Brussel), het nieuwste eerst, markten samen, filter op district en zoekterm", () => {
  const records = [
    { ...punt("kal-a-2099-05-02"), sinds: "2099-04-01" },
    { ...punt("kal-b-2099-05-03", { date: "2099-05-03", title: "Concert", dateLabel: "3 mei 2099" }), sinds: "2099-04-01" },
    { ...punt("markt-ma1-2099-05-02", { sourceId: "stad-markten", scope: "stad", inDistrict: true, title: "Markt Proefplein" }), sinds: "2099-04-01" },
    { ...punt("markt-ma2-2099-05-02", { sourceId: "stad-markten", scope: "stad", inDistrict: false, title: "Markt Testlei" }), sinds: "2099-04-01" },
    { ...punt("kal-d-2099-05-02", { opgegaanIn: "kal-a-2099-05-02" }), sinds: "2099-04-01" },
  ];
  assert.equal(inVerleden(records[1], "2099-05-03"), false, "de laatste dag zelf staat nog in de agenda");
  assert.equal(inVerleden(records[1], "2099-05-04"), true);
  const district = filterVerleden(records, { vandaag: "2099-05-04" });
  assert.deepEqual(district.map((r) => r.id).sort(), ["kal-a-2099-05-02", "kal-b-2099-05-03", "markt-ma1-2099-05-02"]);
  const alles = filterVerleden(records, { vandaag: "2099-05-04", alleenDistrict: false });
  assert.equal(alles.length, 4);
  const groepen = perDag(alles);
  assert.deepEqual(groepen.map((g) => g.dag), ["2099-05-03", "2099-05-02"]);
  assert.deepEqual(groepen[1].markten.map((m) => m.id), ["markt-ma1-2099-05-02", "markt-ma2-2099-05-02"]);
  assert.deepEqual(filterVerleden(records, { vandaag: "2099-05-04", zoek: "concert" }).map((r) => r.id), ["kal-b-2099-05-03"]);
  const html = verledenHtml(groepen);
  assert.match(html, /href="\/event\/kal-b-2099-05-03\/"/);
  assert.match(html, /2 markten/);
  assert.deepEqual(maandenTotNu({ maanden: [{ maand: "2099-04", aantal: 2 }, { maand: "2099-05", aantal: 3 }, { maand: "2099-06", aantal: 1 }, { maand: "2099-03", aantal: 0 }] }, "2099-05-04"), ["2099-05", "2099-04"]);
  // Een maand met alleen parkeerverboden telt ook.
  assert.deepEqual(maandenTotNu({ maanden: [{ maand: "2099-05", aantal: 3 }], parkeerverboden: [{ maand: "2099-03", aantal: 9 }] }, "2099-05-04"), ["2099-05", "2099-03"]);
});

test("databaan: geen eventpagina en geen maand van het verleden wissen", () => {
  const spec = JSON.parse(fs.readFileSync(path.join(root, "lib", "data-lane-paths.json"), "utf8"));
  assert.ok(!spec.deletableUnder.some((prefix) => "site/event/x/index.html".startsWith(prefix)));
  assert.ok(!spec.deletableUnder.some((prefix) => "site/verleden/2099-05.json".startsWith(prefix)));
  assert.deepEqual(checkDataLane(["M\tsite/verleden/maanden.json", "A\tsite/verleden/2099-05.json", "A\tsite/event/kal-a-2099-05-02/index.html"], spec), []);
  assert.equal(checkDataLane(["D\tsite/event/kal-a-2099-05-02/index.html"], spec)[0].code, "delete_not_allowed");
  // De build zelf wist niets meer onder site/event.
  const build = fs.readFileSync(path.join(root, "scripts", "build-agenda.mjs"), "utf8");
  assert.doesNotMatch(build, /rmSync|unlinkSync|rmdirSync/);
});

test("repo: het verleden is geldig, elke eventpagina heeft een record (en omgekeerd), en de parkeerverboden staan erin zonder reden", () => {
  const dir = path.join(root, VERLEDEN_DIR);
  const index = JSON.parse(fs.readFileSync(path.join(root, VERLEDEN_INDEX_FILE), "utf8"));
  assert.deepEqual(validateVerledenIndex(index), []);
  const ids = new Set();
  for (const name of fs.readdirSync(dir).filter(isVerledenMaandBestand)) {
    const document = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    assert.deepEqual(validateVerledenMaand(document, name.slice(0, 7)), [], name);
    for (const record of document.items) ids.add(record.id);
  }
  assert.equal(ids.size, index.aantal);
  const paginas = fs.readdirSync(path.join(root, "site", "event"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  assert.deepEqual(paginas.filter((id) => !ids.has(id)), [], "eventpagina zonder record");
  assert.deepEqual([...ids].filter((id) => !paginas.includes(id)), [], "record zonder eventpagina");
  // De parkeerverboden: er zijn er, elk in de publieke vorm, zonder reden of titel, en de index klopt.
  const straatnamen = officieleStraatnamen();
  const parkeerDir = path.join(root, PARKEER_VERLEDEN_DIR);
  let aantal = 0;
  for (const name of fs.readdirSync(parkeerDir).filter(isParkeerMaandBestand)) {
    const document = JSON.parse(fs.readFileSync(path.join(parkeerDir, name), "utf8"));
    assert.deepEqual(validateParkeerMaand(document, name.slice(0, 7), straatnamen), [], name);
    assert.ok(document.items.every((record) => !("reason" in record) && !("title" in record)), name);
    aantal += document.items.length;
  }
  assert.ok(aantal > 0, "parkeerverboden in het verleden");
  assert.equal(aantal, index.parkeerAantal);
});

const ondiep = spawnSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: root, encoding: "utf8" });
test("repo: elke eventpagina die de site ooit publiceerde, bestaat nog op dezelfde URL", { skip: ondiep.status !== 0 || ondiep.stdout.trim() === "true" ? "geen volledige git-geschiedenis" : false }, () => {
  const log = spawnSync("git", ["log", "--format=", "--name-only", "--diff-filter=A", "HEAD", "--", "site/event"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert.equal(log.status, 0);
  const ooit = new Set(log.stdout.split("\n").filter((regel) => /^site\/event\/[a-z0-9-]+\/index\.html$/.test(regel)));
  const weg = [...ooit].filter((pad) => !fs.existsSync(path.join(root, pad)));
  assert.deepEqual(weg, []);
});
