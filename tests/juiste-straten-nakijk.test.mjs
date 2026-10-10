// Nakijkronde van "Parcours, vergunningen en werken aan de juiste straten": elke bevinding een toets.
// Echte vormen (tests/fixtures/parcours-echte-vormen.json: open geodata van de stad, bijgesneden) en
// verzonnen straten; geen live datums.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { buildStreetIndex } from "../site/street-core.js";
import { parcoursGeometrie, stratenVanParcours } from "../site/parcours-straten.js";
import { createAgendaView } from "../site/agenda-view.js";
import { createAreaMatcher } from "../site/neighborhood-map.js";
import { collectPermits } from "../site/permits-live-core.js";
import { collectPublicSpace } from "../site/public-space-live-core.js";
import { evenementEntry, jouwStraatTekst, langsViaParcours, permitEntry, vergunningWaar } from "../site/place-core.js";

const ECHT = JSON.parse(fs.readFileSync(new URL("./fixtures/parcours-echte-vormen.json", import.meta.url), "utf8"));
const asFeature = (naam, coordinates, postcode = 2000, id = 1) => ({ type: "Feature", properties: { DISTRICT: "ANTWERPEN", LSTRNMID: id, LSTRNM: naam, RSTRNMID: id, RSTRNM: naam, postcode }, geometry: { type: "LineString", coordinates } });
// Meter rond een vaste oorsprong naar lengte- en breedtegraad (verzonnen straten).
const m = (x, y) => [4.4 + x / 69760, 51.2 + y / 110540];

// Bevinding 1 en 2: een parcours dat door de straat loopt, heette "kruist" (Arthur Goemaerelei, Singel,
// Ossenmarkt), en een hoek waar het parcours afslaat, heette "ligt in je straat" (Van Ertbornstraat).
test("echte vormen: loopt het parcours door de straat, of kruist het haar alleen?", () => {
  assert.ok(ECHT.gevallen.length >= 7);
  for (const g of ECHT.gevallen) {
    const index = buildStreetIndex(g.assen.map((p) => asFeature(g.straat, p, g.postcode)));
    const geometrie = parcoursGeometrie(g.vlakken.map((rings) => ({ geometry: { rings } })));
    // Zowel de verversing (alle straten) als de browser (alleen de gekozen straat): hetzelfde antwoord.
    for (const opties of [{}, { alleen: new Set([g.straat]) }]) {
      const p = stratenVanParcours(geometrie, index, opties);
      const ander = g.verwacht === "langs" ? "kruist" : "langs";
      assert.deepEqual(p[g.verwacht], [g.straat], `${g.straat} × ${g.dossier} hoort "${g.verwacht}": ${g.waarom}`);
      assert.deepEqual(p[ander], [], `${g.straat} × ${g.dossier}`);
    }
  }
});

test("een korte straat helemaal op het parcours loopt er langs; een tunnel eronder nooit", () => {
  // Een parcours van 20 m breed langs een lange weg; een steeg van 30 m ligt er helemaal in, een tunnel
  // loopt eronder over 300 m.
  const vlak = { rings: [[[-10, -10], [400, -10], [400, 10], [-10, 10], [-10, -10]].map(([x, y]) => m(x, y))] };
  const index = buildStreetIndex([
    asFeature("Lange Weg", [m(0, 0), m(390, 0)], 2000, 1),
    asFeature("Korte Steeg", [m(100, 2), m(130, 2)], 2000, 2),
    asFeature("Proeftunnel", [m(20, 1), m(330, 1)], 2000, 3),
  ]);
  const p = stratenVanParcours(parcoursGeometrie([{ geometry: vlak }]), index);
  assert.deepEqual(p.langs, ["Korte Steeg", "Lange Weg"]);
  assert.deepEqual(p.kruist, ["Proeftunnel"]);
});

// Bevinding 3: met +500 m rond de Peterseliestraat kwamen honderden items mee, en een deel lag verder
// dan de straal (een parkeerverbod op 922 m, evenementen op 504 tot 545 m). Een item telde mee zodra
// één van zijn straten binnen de straal kwam; een lange straat trok zo items van ver mee.
test("straal: de eigen vorm van het item telt, niet zijn straat; terrassen alleen in de straat zelf", () => {
  // Gekozen Straat (100 m, oost-west). Lange Straat begint 200 m noordelijker en loopt 2 km door.
  const index = buildStreetIndex([
    asFeature("Gekozen Straat", [m(0, 0), m(100, 0)], 2000, 1),
    asFeature("Lange Straat", [m(50, 200), m(50, 2200)], 2000, 2),
  ]);
  const view = createAgendaView();
  view.setAreaMatcher(createAreaMatcher({ wijken: [], geo: { entries: {} }, streetIndex: index }));
  view.setStreet("Gekozen Straat", { id: "1", name: "Gekozen Straat", postcode: "2000" });
  view.setArea({ radius: 500 });
  const lange = [{ id: "2", name: "Lange Straat", postcode: "2000" }];
  const vak = (x, y, b = 15) => ({ rings: [[[x, y], [x + b, y], [x + b, y + b], [x, y + b], [x, y]].map(([a, c]) => m(a, c))] });
  const vergunningVer = { id: "permit:ver", streets: lange, vorm: parcoursGeometrie([{ geometry: vak(55, 900) }]) };
  const vergunningDicht = { id: "permit:dicht", streets: lange, vorm: parcoursGeometrie([{ geometry: vak(55, 300) }]) };
  const parkeerVer = { id: "parking:ver", kind: "parking", streets: lange, vorm: parcoursGeometrie([{ geometry: { paths: [[m(52, 920), m(52, 970)]] } }]) };
  const parkeerDicht = { id: "parking:dicht", kind: "parking", streets: lange, vorm: parcoursGeometrie([{ geometry: { paths: [[m(52, 400), m(52, 450)]] } }]) };
  const evenementNet = { id: "iod:net", kind: "iod", streets: lange, vorm: parcoursGeometrie([{ geometry: vak(40, 504, 40) }]) };
  // Een werfzone ver weg met een omleiding die op 300 m voorbijkomt: de omleiding hoort bij de maatregel.
  const werfzone = { id: "sgw:1", kind: "sgw", streets: lange, vorm: parcoursGeometrie([{ geometry: vak(55, 1500) }, { geometry: { paths: [[m(-400, 300), m(400, 300)]] } }]) };
  const terras = { id: "terrace:1", streets: lange, terraceType: "Terraszone" }; // 250 m verder, zonder vorm
  assert.equal(view.matchesStreet(vergunningVer), false, "vergunning 900 m verder op een lange straat");
  assert.equal(view.matchesStreet(parkeerVer), false, "parkeerverbod 920 m verder");
  assert.equal(view.matchesStreet(evenementNet), false, "evenement op 504 m valt buiten 500 m");
  assert.equal(view.matchesStreet(terras), false, "terrassen tellen alleen in de straat zelf");
  assert.equal(view.matchesStreet(vergunningDicht), true);
  assert.equal(view.matchesStreet(parkeerDicht), true);
  assert.equal(view.matchesStreet(werfzone), true);
  view.setArea({ radius: 1000 });
  assert.equal(view.matchesStreet(vergunningVer), true, "met +1 km wel");
  assert.equal(view.matchesStreet(evenementNet), true);
});

test("live lagen geven elk item zijn eigen vorm mee (vergunning, parkeerverbod, inname, werfzone)", () => {
  const district = { type: "Polygon", coordinates: [[m(-1000, -1000), m(3000, -1000), m(3000, 3000), m(-1000, 3000), m(-1000, -1000)]] };
  const perceel = { rings: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]].map(([x, y]) => m(x, y))] };
  const [permit] = collectPermits({ features: [{ attributes: { Dossiernummer: "OMV_2099000002", DOSSIERTYPE: "Omgevingsvergunning" }, geometry: perceel }], districtGeometry: district });
  assert.equal(permit.vorm.vlakken.length, 1);
  const lijn = { paths: [[m(0, 0), m(30, 0)]] };
  const ms = (iso) => Date.parse(iso);
  const items = collectPublicSpace({
    parkingFeatures: [{ attributes: { Dossiernummer: "2099-000001", Locatienummer: "1", Status: "Goedgekeurd", Adres: "Proefstraat", Postcode: "2000", Reden: "Verhuis", Startdatum: ms("2026-10-20T00:00:00Z"), Einddatum: ms("2026-10-21T00:00:00Z") }, geometry: lijn }],
    iodFeatures: [{ attributes: { dossierNummer: "ET2099000003", faseId: "F1", innameId: "I1", dossierStatus: "aanvraag_goedgekeurd", faseNaam: "Evenement", type_dossier: "ETL", innameTypeNaam: "Zone", faseStartDatum: ms("2026-10-20T06:00:00Z"), faseEindDatum: ms("2026-10-20T16:00:00Z") }, geometry: perceel }],
    sgwFeatures: [{ kind: "Werfzone", feature: { attributes: { reference_id: "SGW-1", phase_id: "1", status: "vergund", StartDate: ms("2026-10-20T00:00:00Z"), EndDate: ms("2026-11-20T00:00:00Z") }, geometry: perceel } }],
    districtGeometry: district,
  });
  const per = Object.fromEntries(items.map((i) => [i.kind, i]));
  assert.equal(per.parking.vorm.lijnen.length, 1);
  assert.equal(per.iod.vorm.vlakken.length, 1);
  assert.equal(per.iod.parcours, undefined, "alleen een parcours krijgt ook `parcours`");
  assert.equal(per.sgw.vorm.vlakken.length, 1);
});

// Bevinding 5: "Dit evenement neemt een deel van je straat in" rustte bij een evenement zonder parcours
// alleen op de regel van 18 m rond een inname. Nu zegt de zin wat vaststaat: het parcours loopt door je
// straat, of een inname ligt in je straat of tot 18 m ervan.
test("jouw straat: de zin zegt waarom het evenement bij je straat staat", () => {
  const zone = { id: "iod:ET2099000004|F1|I1", kind: "iod", reference: "ET2099000004", dossierType: "ETL", innameType: "Zone", title: "Zone", phase: "Evenement", status: "aanvraag_goedgekeurd", start: "2026-10-20T06:00:00Z", end: "2026-10-20T16:00:00Z", streets: [{ id: "7", name: "Buurstraat", postcode: "2000" }] };
  const e = evenementEntry([zone], { vandaag: "2026-10-06", straat: "Buurstraat", wijkVan: () => "" });
  assert.equal(e.jouwStraat, "Een zone van dit evenement ligt in of naast je straat");
  assert.match(Object.fromEntries(e.uitleg.regels)["Jouw straat"], /tot 18 m van de straatas/);
  assert.doesNotMatch(JSON.stringify(e.uitleg.regels), /neemt een deel van je straat in/);
  assert.deepEqual(jouwStraatTekst("langs", { viaParcours: true }), { kort: "Het parcours loopt door je straat", lang: "Het parcours loopt door je straat." });
  // Een straat die alleen via een parkeerverbod van het dossier in de lijst staat, terwijl het parcours
  // haar niet volgt: de zin van de inname, niet "het parcours loopt door je straat".
  const vlak = { rings: [[[-10, -10], [400, -10], [400, 10], [-10, 10], [-10, -10]].map(([x, y]) => m(x, y))] };
  const index = buildStreetIndex([asFeature("Lange Weg", [m(0, 0), m(390, 0)], 2000, 1), asFeature("Zijweg", [m(200, 0), m(200, 200)], 2000, 2)]);
  const parcours = { ...zone, id: "iod:ET2099000004|F1|I2", innameType: "Parcours", title: "Parcours", streets: [{ id: "1", name: "Lange Weg", postcode: "2000" }, { id: "2", name: "Zijweg", postcode: "2000" }], parcours: parcoursGeometrie([{ geometry: vlak }]) };
  const parkeer = { ...zone, id: "iod:ET2099000004|F1|I3", innameType: "Parkeerverbod", title: "Parkeerverbod", streets: [{ id: "2", name: "Zijweg", postcode: "2000" }] };
  assert.equal(langsViaParcours("Zijweg", [parcours, parkeer], index, true), false);
  assert.equal(langsViaParcours("Lange Weg", [parcours, parkeer], index, true), true);
  assert.equal(evenementEntry([parcours, parkeer], { vandaag: "2026-10-06", straat: "Zijweg", index, wijkVan: () => "" }).jouwStraat, "Een zone van dit evenement ligt in of naast je straat");
  assert.equal(evenementEntry([parcours, parkeer], { vandaag: "2026-10-06", straat: "Lange Weg", index, wijkVan: () => "" }).jouwStraat, "Het parcours loopt door je straat");
});

// Bevinding 6: de regel "jouw straat" werd op een gsm na twee regels afgekapt (klasse .pv-row-where).
test("jouw straat: een eigen regel zonder afkapping", () => {
  const view = fs.readFileSync(new URL("../site/place-view.js", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../site/place-view.css", import.meta.url), "utf8");
  const span = view.match(/<span class="([^"]*)">\$\{esc\(entry\.jouwStraat\)\}/);
  assert.ok(span, "de regel staat in de rij");
  assert.ok(!span[1].split(/\s+/).includes("pv-row-where"), "niet de afgekapte klasse van de plek");
  const regel = css.match(/\.pv-row-jouw\s*\{([^}]*)\}/);
  assert.ok(regel && !/line-clamp|overflow:\s*hidden/.test(regel[1]));
  for (const tekst of ["Het parcours loopt door je straat", "Je straat kruist het parcours", "Niet in je straat, wel binnen 500 m"]) assert.ok(tekst.length <= 40, tekst);
});

// Bevinding 7: "grenst ook aan" noemde tunnels ("Waaslandtunnel · grenst ook aan Thonetlaan"), en is te
// stellig voor "tot 24 m van het perceel".
test("vergunning: geen tunnel bij 'Waar', en 'ook dicht bij' in plaats van 'grenst ook aan'", () => {
  assert.equal(vergunningWaar([{ name: "Waaslandtunnel" }, { name: "Thonetlaan" }]), "Thonetlaan");
  assert.equal(vergunningWaar([{ name: "Maria-Henriëttalei" }, { name: "Van Breestraat" }, { name: "Blauwtorentunnel" }]), "Maria-Henriëttalei · ook dicht bij Van Breestraat");
  assert.equal(vergunningWaar([{ name: "Kennedytunnel" }]), "Kennedytunnel", "alleen een tunnel: dan toch die naam");
  const e = permitEntry({ id: "permit:OMV_2099000005", dossierType: "Omgevingsvergunning", streets: ["Lei", "Tunnelstraat", "Craeybeckxtunnel", "Kaai", "Plein"].map((name) => ({ name })) });
  assert.deepEqual(e.straten, ["Lei", "Tunnelstraat", "Kaai", "Plein"]);
  assert.doesNotMatch(e.location, /grenst|tunnel\b/i);
});
