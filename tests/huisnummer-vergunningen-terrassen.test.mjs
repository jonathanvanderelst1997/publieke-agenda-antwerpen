// Regel van de eigenaar van 26 oktober 2026: een bouwaanvraag of vergunning staat er met haar huisnummer ("gewoon dat ze
// weten waar het is"), nooit met de naam van een aanvrager of eigenaar; een terras ook in de ochtendstand met zijn adres.
// Verzonnen straten (Proefstraat, Voorbeeldlaan); een echte straat alleen met huisnummer 999 (lib/echte-adressen.mjs).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { adressenVoorVergunningen, opPerceel, perceelGroepen, vergunningAdres } from "../site/permits-live-core.js";
import { duidelijkeKaart, waarTekst } from "../site/permit-clarity.js";
import { permitEntry, terrasEntries } from "../site/place-core.js";
import { lagenUitStand, metStratenVanDeOchtend } from "../site/straat-snapshot.js";
import { ADRES_LAGEN, STRAAT_MAP, straatAdres, straatBestandenProblemen } from "../lib/straat-bestanden.mjs";
import { itemVoorStraat, terrassenVoorStraat } from "../scripts/build-straat-snapshots.mjs";
import { KAM, bouw, maakWerkmap, schoneBronnen } from "./helpers/straat-fixture.mjs";

const isStraat = (naam) => ["Proefstraat", "Voorbeeldlaan", "Proef en Voorbeeldlei"].includes(naam);
// Een perceel: een vierkant van ongeveer 7 bij 11 m.
const perceel = (x, y) => ({ vlakken: [[[[x, y], [x + 0.0001, y], [x + 0.0001, y + 0.0001], [x, y + 0.0001], [x, y]]]], lijnen: [] });
const vergunning = (id, x, y, straten = ["Proefstraat"]) => ({ id: `permit:${id}`, dossier: String(id), vorm: perceel(x, y), streets: straten.map((name, i) => ({ id: String(i), name, postcode: "2000" })) });
// Een adrespositie van de stad (CRAB), zoals de laag ze geeft.
const crab = (x, y, straat, huisnr) => ({ attributes: { STRAATNAAM: straat, STRAATNM: `${straat}_AN`, HUISNR: huisnr }, geometry: { x, y } });

test("vergunningAdres: straat en huisnummer, de laagste en de hoogste, hoogstens twee straten; nooit een busnummer", () => {
  assert.equal(vergunningAdres([{ straat: "Proefstraat", huisnummer: "12" }]), "Proefstraat 12");
  assert.equal(vergunningAdres([{ straat: "Proefstraat", huisnummer: "44A" }]), "Proefstraat 44A");
  assert.equal(vergunningAdres([{ straat: "Proefstraat", huisnummer: "44" }, { straat: "Proefstraat", huisnummer: "44A" }]), "Proefstraat 44");
  assert.equal(vergunningAdres(["12", "16", "14", "14"].map((huisnummer) => ({ straat: "Proefstraat", huisnummer }))), "Proefstraat 12–16");
  // De straat met de meeste nummers eerst; bij evenveel de straat van het dossier die het dichtst ligt.
  assert.equal(vergunningAdres([{ straat: "Voorbeeldlaan", huisnummer: "3" }, { straat: "Proefstraat", huisnummer: "2" }, { straat: "Proefstraat", huisnummer: "4" }]), "Proefstraat 2–4 en Voorbeeldlaan 3");
  assert.equal(vergunningAdres([{ straat: "Voorbeeldlaan", huisnummer: "3" }, { straat: "Proefstraat", huisnummer: "2" }], ["Voorbeeldlaan", "Proefstraat"]), "Voorbeeldlaan 3 en Proefstraat 2");
  // Geen nummer 0, geen vrije tekst, geen derde straat.
  assert.equal(vergunningAdres([{ straat: "Proefstraat", huisnummer: "0" }, { straat: "Proefstraat", huisnummer: "12 bus 3" }]), "");
  assert.equal(vergunningAdres([{ straat: "Proefstraat", huisnummer: "1" }, { straat: "Voorbeeldlaan", huisnummer: "2" }, { straat: "Proeflei", huisnummer: "3" }]).split(" en ").length, 2);
});

test("opPerceel: binnen het perceel of hoogstens 1 m erbuiten; een gat en een buurperceel tellen niet", () => {
  const vorm = perceel(4.4, 51.2);
  assert.equal(opPerceel([4.40005, 51.20005], vorm), true);
  assert.equal(opPerceel([4.40011, 51.20005], vorm), true, "ongeveer 0,7 m buiten de rand");
  assert.equal(opPerceel([4.40015, 51.20005], vorm), false, "ongeveer 3,5 m buiten de rand: het buurhuis");
  const metGat = { vlakken: [[vorm.vlakken[0][0], [[4.40003, 51.20003], [4.40007, 51.20003], [4.40007, 51.20007], [4.40003, 51.20007], [4.40003, 51.20003]]]] };
  assert.equal(opPerceel([4.40005, 51.20005], metGat), false);
});

test("perceelGroepen: hoogstens `per` percelen, en nooit twee percelen die elkaar raken in hetzelfde groepje", () => {
  const items = [vergunning(1, 4.4, 51.2), vergunning(2, 4.40005, 51.2), vergunning(3, 4.41, 51.2), vergunning(4, 4.42, 51.2), { id: "permit:5" }];
  const groepen = perceelGroepen(items, 2);
  assert.deepEqual(groepen.map((g) => g.map((i) => i.id)), [["permit:1", "permit:3"], ["permit:2", "permit:4"]]);
});

test("adressenVoorVergunningen: één vraag per groepje; een geweigerde vorm splitst het groepje, en één perceel vraagt zijn kader", async () => {
  const items = [vergunning(1, 4.4, 51.2), vergunning(2, 4.41, 51.2, ["Voorbeeldlaan"]), vergunning(3, 4.42, 51.2), vergunning(4, 4.43, 51.2)];
  const punten = [crab(4.40005, 51.20005, "Proefstraat", "12"), crab(4.40006, 51.20006, "Proefstraat", "14"), crab(4.41005, 51.20005, "Voorbeeldlaan", "3"), crab(4.43005, 51.20005, "Proefstraat", "7")];
  const vragen = [];
  // Perceel 3 heeft een vorm die de stad weigert: het groepje van vier wordt twee keer twee, dan perceel 3 alleen, en dan zijn
  // kader (daar ligt geen adres).
  const nep = async (url, { body }) => {
    const p = new URLSearchParams(String(body));
    vragen.push(p.get("geometryType"));
    if (p.get("geometryType") === "esriGeometryPolygon" && p.get("geometry").includes("4.42")) return { ok: true, json: async () => ({ error: { code: 400 } }) };
    const kader = p.get("geometryType") === "esriGeometryEnvelope" ? p.get("geometry").split(",").map(Number) : null;
    const binnen = (x) => (kader ? x.geometry.x >= kader[0] && x.geometry.x <= kader[2] : true);
    return { ok: true, json: async () => ({ features: punten.filter(binnen) }) };
  };
  const uit = await adressenVoorVergunningen(items, { fetch: nep, per: 4, tegelijk: 1 });
  assert.deepEqual(uit.map((i) => i.address ?? ""), ["Proefstraat 12–14", "Voorbeeldlaan 3", "", "Proefstraat 7"]);
  assert.deepEqual(vragen, ["esriGeometryPolygon", "esriGeometryPolygon", "esriGeometryPolygon", "esriGeometryPolygon", "esriGeometryEnvelope", "esriGeometryPolygon"]);
  // Een vraag die faalt, gooit nooit een fout: de dossiers blijven zonder adres.
  const kapot = await adressenVoorVergunningen(items, { fetch: async () => { throw new Error("weg"); } });
  assert.ok(kapot.every((i) => !i.address));
  assert.deepEqual(kapot.map((i) => i.id), items.map((i) => i.id));
});

test("Waar bij een vergunning: het adres vooraan, de straten van dat adres niet nog eens bij 'ook dicht bij'", () => {
  assert.deepEqual(waarTekst(["Proefstraat", "Voorbeeldlaan", "Proeflei"], "", "Proefstraat 12–16"), { kort: "Proefstraat 12–16 · ook dicht bij Voorbeeldlaan en Proeflei", straten: ["Proefstraat 12–16", "Voorbeeldlaan", "Proeflei"], ingeklapt: true });
  assert.equal(waarTekst(["Proefstraat", "Voorbeeldlaan"], "", "Proefstraat 12 en Voorbeeldlaan 3").kort, "Proefstraat 12 en Voorbeeldlaan 3");
  assert.equal(waarTekst(["Proefstraat", "Voorbeeldlaan"]).kort, "Proefstraat · ook dicht bij Voorbeeldlaan", "zonder adres zoals vroeger");
  const item = { id: "permit:1", dossier: "1", streets: [{ name: "Proefstraat" }, { name: "Voorbeeldlaan" }], address: "Proefstraat 12", inhoud: { titel: "Dakterras" } };
  assert.equal(permitEntry(item).location, "Proefstraat 12 · ook dicht bij Voorbeeldlaan");
  assert.equal(duidelijkeKaart({ source: "permits" }, item).waar.kort, "Proefstraat 12 · ook dicht bij Voorbeeldlaan");
  // Nooit de naam van een aanvrager of eigenaar, ook niet als het item er een draagt.
  assert.doesNotMatch(JSON.stringify(permitEntry({ ...item, aanvrager: "Jan Voorbeeld" }).location), /Jan/);
});

test("de plekpagina: vond live geen adres, dan het adres van de ochtend", () => {
  const live = [{ id: "permit:1", streets: [{ id: "1", name: "Proefstraat", postcode: "2000" }] }, { id: "permit:2", address: "Proefstraat 9", streets: [] }];
  const ochtend = [{ id: "permit:1", address: "Proefstraat 12", streets: [] }, { id: "permit:2", address: "Proefstraat 8", streets: [] }];
  assert.deepEqual(metStratenVanDeOchtend(live, ochtend).map((i) => i.address), ["Proefstraat 12", "Proefstraat 9"]);
});

test("straatAdres: alleen een officiële straat met haar huisnummer, nooit een naam, een busnummer of een toevoeging", () => {
  assert.deepEqual(ADRES_LAGEN, ["terrassen", "vergunningen"]);
  for (const [tekst, verwacht] of [
    ["Proefstraat 12", "Proefstraat 12"],
    ["Proefstraat 1-3", "Proefstraat 1-3"],
    ["Proefstraat 1 (zijde Voorbeeldlaan)", "Proefstraat 1"],
    ["Proefstraat43", "Proefstraat 43"],
    ["Proefstraat 12–16 en Voorbeeldlaan 3", "Proefstraat 12–16 en Voorbeeldlaan 3"],
    ["Proef en Voorbeeldlei 11", "Proef en Voorbeeldlei 11"],
    ["Café Jan, Proefstraat 12", ""],
    ["Jan Voorbeeld Proefstraat 12", ""],
    ["Proefstraat 12 bus 3", ""],
    ["Proefstraat", ""],
    ["Proefstraat 0", ""],
    ["Onbekendestraat 12", ""],
  ]) assert.equal(straatAdres(tekst, { isStraat }), verwacht, tekst);
  // Standaard de stratenlijst van het district.
  assert.equal(straatAdres(`${KAM.name} 999`), `${KAM.name} 999`);
  assert.equal(straatAdres("Proefstraat 12"), "", "een verzonnen straat staat niet in de stratenlijst");
});

test("ochtendstand: een terras en een vergunning met hun adres; een ander item, of een adres met een naam, zonder", () => {
  const terras = { id: "terrace:PROEF-T1", recordId: "PROEF-T1", terraceType: "Terraszone", status: "actief", address: `${KAM.name} 999`, postcode: "2000", streets: [KAM] };
  assert.equal(itemVoorStraat(terras, { laag: "terrassen" }).address, `${KAM.name} 999`);
  assert.equal(itemVoorStraat({ ...terras, address: `Jan Voorbeeld, ${KAM.name} 999` }, { laag: "terrassen" }).address, "");
  const permit = { id: "permit:20990001", dossier: "20990001", address: `${KAM.name} 999`, streets: [KAM], aanvrager: "Jan Voorbeeld", onderwerp: "Jan Voorbeeld bouwt" };
  const p = itemVoorStraat(permit, { laag: "vergunningen" });
  assert.equal(p.address, `${KAM.name} 999`);
  assert.equal("aanvrager" in p || "onderwerp" in p, false);
  assert.equal("address" in itemVoorStraat({ id: "x", title: "Werk", address: `${KAM.name} 999` }, { laag: "werken" }), false);
  // Twee zones op hetzelfde adres: één terras op de plekpagina, met het adres.
  const zones = terrassenVoorStraat([terras, { ...terras, id: "terrace:PROEF-T2", recordId: "PROEF-T2" }]);
  assert.deepEqual(zones.map((z) => [z.address, z.adresGroep]), [[`${KAM.name} 999`, "g1"], [`${KAM.name} 999`, "g1"]]);
  const [entry] = terrasEntries(zones);
  assert.equal(entry.location, `${KAM.name} 999`);
});

test("validate-data: een geldig adres van een terras of vergunning in een straatbestand mag; een adres met een naam of elders niet", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "huisnummer-straat-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  maakWerkmap(root);
  const b = await schoneBronnen();
  const adres = `${KAM.name} 999`;
  b.lagen.terrassen.items = b.lagen.terrassen.items.map((item) => ({ ...item, address: adres }));
  b.lagen.vergunningen.items = b.lagen.vergunningen.items.map((item) => ({ ...item, address: adres }));
  await bouw(root, { bronnenDoc: b });
  const bestand = path.join(root, STRAAT_MAP, `${KAM.id}.json`);
  const doc = JSON.parse(fs.readFileSync(bestand, "utf8"));
  assert.ok(doc.terrassen.length && doc.terrassen.every((i) => i.address === adres));
  assert.equal(doc.vergunningen[0].address, adres);
  assert.deepEqual(straatBestandenProblemen(root), []);
  // De browser leest het adres terug.
  const lagen = lagenUitStand({ doc });
  assert.equal(lagen.permits[0].address, adres);
  assert.equal(permitEntry(lagen.permits[0]).location.startsWith(adres), true);
  // Een adres met een naam ervoor, of een adres bij een parkeerverbod: een fout, met alleen het pad.
  const fout = { ...doc, terrassen: doc.terrassen.map((i, n) => (n ? i : { ...i, address: `Jan Voorbeeld ${adres}` })), publiekeRuimte: doc.publiekeRuimte.map((i, n) => (n ? i : { ...i, address: adres })) };
  fs.writeFileSync(bestand, JSON.stringify(fout));
  const problemen = straatBestandenProblemen(root);
  assert.ok(problemen.includes(`${STRAAT_MAP}/${KAM.id}.json: adres op $.terrassen[0]`), problemen.join("\n"));
  assert.ok(problemen.includes(`${STRAAT_MAP}/${KAM.id}.json: adres op $.publiekeRuimte[0]`), problemen.join("\n"));
  assert.ok(problemen.every((p) => !p.includes("999") && !p.includes("Jan")), "de melding toont de waarde niet");
});
