// Besluit van de eigenaar (18 oktober 2026): een parkeerverbod zegt DAT er een parkeerverbod is, WAAR exact en WANNEER,
// en NOOIT waarom (verhuis, container, lift, ceremoniewagen, filmopname, evenement, werf ...). Niet in de titel, niet in
// een zin, niet in de technische details, de districtslijst, de kaartjes, de historiek, de straatbestanden, de feed of de
// eventpagina's. Intern mag de reden nog meetellen (een parkeerverbod bij zijn werfzone of evenement hangen), zolang ze
// nergens publiek terechtkomt (site/adres-privacy.js). Streng: elke uitvoer, met verzonnen redenen en verzonnen straten.
// Faalt zodra de reden ergens terugkomt (mutatieproef: de reden terug in de titel van publicSpaceEntry).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { PARKEERVERBOD_TITEL, isVerhuisReden, parkeerverbodZonderReden } from "../site/adres-privacy.js";
import { collectPublicSpace } from "../site/public-space-live-core.js";
import { agendaEntry, publicSpaceEntries, publicSpaceEntry, samenWerven, verrijkMetContext, werkEntries } from "../site/place-core.js";
import { duidelijkeKaart } from "../site/permit-clarity.js";
import { kaartBronNoot } from "../site/kaart-bronnoot.js";
import { bezoekersHint, bezoekersLinks } from "../site/bezoekers-bronnen.js";
import { popupHtml } from "../site/kaart-lagen.js";
import { compactPublicSpaceItem, updateLiveHistory } from "../lib/live-history.mjs";
import { parkeerItemVoorHistoriek, parkeerWijzigingenVoorHistoriek } from "../lib/parkeer-historiek.mjs";
import { archiefDagVoorPubliek, historiekPrivacyBevindingen, historiekVoorPubliek, itemVoorHistoriek } from "../lib/historiek-privacy.mjs";
import { bundelAanvulling, bundelRijen, itemVoorStraat, schrijfStraatSnapshots } from "../scripts/build-straat-snapshots.mjs";
import { STRAAT_INDEX, straatBestandenProblemen } from "../lib/straat-bestanden.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VANDAAG = "2099-03-01";
const DAG = Date.UTC(2099, 2, 12);
const uur = (h, m = 0) => Date.UTC(1899, 11, 30, h, m); // A-Sign bewaart een uur als een tijdstip op 30 december 1899
const straat = (name, postcode = "2000") => ({ id: name, name, postcode });
const PROEF = straat("Proefstraat");

// Verzonnen redenen, zoals A-Sign ze in het veld Reden zet, en per reden de woorden die haar zouden verraden.
const REDENEN = [
  ["Verhuis", /verhuis/i],
  ["Container", /container/i],
  ["Aanvraag tot een verhuis met of zonder ladderlift, verhuiswagen", /verhuis|ladderlift/i],
  ["Aanvraag tot het plaatsen van een container", /container/i],
  ["Aanvraag tot het plaatsen van een beweegbaar toestel (voorbeeld: ladderlift, schaarlift, hoogtewerker)", /toestel|lift|hoogtewerker/i],
  ["Aanvraag tot het inrichten van een laad-en loszone", /laad|loszone/i],
  ["Ceremoniewagen", /ceremonie/i],
  ["Filmopname", /film/i],
  ["Jaarvergunning", /jaarvergunning/i],
  ["Scholen, jeugdverenigingen en socioculturele verenigingen", /school|vereniging/i],
  ["Melding ikv werfsignalisaties", /werfsignal|\bikv\b|in het kader van|voor een werf/i],
  ["Aanvraag voor evenementen gesteund door de stad", /gesteund door de stad|voor een evenement|vermoedelijk voor/i],
  ["Verhuis fam. Proefnaam, info proef@voorbeeld.test", /verhuis|proefnaam|proef@|voorbeeld\.test/i],
];
// Wat nergens bij een parkeerverbod mag staan, welke reden ook (ook niet "de stad publiceert niet waarvoor").
const NOOIT = /\breden\b|waarvoor|Tijdelijk parkeerverbod|Parkeerverbod (?:voor|met)\b|Parkeerverbod,/i;

const feature = (reden, extra = {}) => ({ attributes: {
  Dossiernummer: "2099-000001", Locatienummer: "L1", Status: "Goedgekeurd", Adres: "Proefstraat 12-14 2000 Antwerpen", Postcode: "2000",
  Reden: reden, Startdatum: DAG, Einddatum: DAG, Starttijd: uur(7), Eindtijd: uur(17), EnkelWeekdagen: "0", GipodID: null, District: "ANTWERPEN", ...extra,
} });
// `alleenLive`: zoals de browser (met het huisnummer of bereik van publiekParkeerAdres); zonder: zoals de verversing.
const liveItem = (reden, extra = {}, { alleenLive = true } = {}) => collectPublicSpace({ parkingFeatures: [feature(reden, extra)], alleenLive })[0];
// Alles wat een bewoner van een kaart ziet: de kop, het detail, de regels, de links en het kaartje op de buurtkaart. De ruwe
// rijen (`item`, `rijen`, `werfParkeer`) zijn intern en worden nooit getoond.
function zichtbaar(e, { straatNaam = PROEF.name } = {}) {
  const d = duidelijkeKaart(e, e.item || {}, { straat: straatNaam, vandaag: VANDAAG });
  return JSON.stringify([e.title, e.summary, e.info, e.location, e.time, e.timeText, e.status, e.reference, e.straten, e.regels, e.uitleg, e.onbekend,
    d, kaartBronNoot(e, { zichtbaar: [d.melding, d.samenvatting] }), bezoekersLinks(e), bezoekersHint(e), popupHtml([e], VANDAAG)]);
}
const zonderReden = (tekst, reden, verraad) => {
  assert.equal(tekst.toLowerCase().includes(reden.toLowerCase()), false, `de reden "${reden}" staat erin: ${tekst}`);
  assert.doesNotMatch(tekst, verraad, `de reden "${reden}" is te lezen`);
};

test("de regel zelf: titel 'Parkeerverbod' en nooit een veld reason, ook voor de velden van een wijziging", () => {
  assert.equal(PARKEERVERBOD_TITEL, "Parkeerverbod");
  assert.deepEqual(parkeerverbodZonderReden({ id: "parking:1", title: "Verhuis", reason: "Verhuis", start: "x" }), { id: "parking:1", title: "Parkeerverbod", start: "x" });
  assert.deepEqual(parkeerverbodZonderReden({ end: "y" }), { end: "y" }, "een wijziging zonder titel krijgt er geen");
  const schoon = { id: "parking:1", title: "Parkeerverbod" };
  assert.equal(parkeerverbodZonderReden(schoon), schoon, "een schoon item blijft hetzelfde object");
});

// Regel van de eigenaar (26 oktober 2026): het huisnummer staat er altijd, behalve bij een verhuizing. Bij een verhuizing is
// de kaart letter voor letter die zonder huisnummer (zoals de verversing ze bewaart), bij elke andere reden die met.
test("live laag en kaart: welke reden ook, de kaart van een parkeerverbod is letter voor letter dezelfde (titel 'Parkeerverbod'); bij een verhuizing zonder huisnummer", () => {
  const basis = zichtbaar(publicSpaceEntries([liveItem("")], { vandaag: VANDAAG, straat: PROEF.name })[0]);
  const zonderNummer = zichtbaar(publicSpaceEntries([liveItem("", {}, { alleenLive: false })], { vandaag: VANDAAG, straat: PROEF.name })[0]);
  assert.notEqual(zonderNummer, basis);
  assert.doesNotMatch(zonderNummer, /Proefstraat 1[24]/);
  assert.match(zonderNummer, /Proefstraat, 2000 Antwerpen/);
  assert.match(basis, /"Parkeerverbod"/);
  assert.match(basis, /Niet parkeren van 7\.00 tot 17\.00 uur\./, "wanneer: de uren");
  // Waar exact: het bereik zoals publiekParkeerAdres het schrijft (alleen live).
  assert.match(basis, /Proefstraat 12–14, 2000 Antwerpen/);
  assert.doesNotMatch(basis, NOOIT);
  for (const [reden, verraad] of REDENEN) {
    const item = liveItem(reden);
    assert.equal(item.title, "Parkeerverbod", reden);
    assert.equal(item.reason, reden.replace(/\s+/g, " ").trim(), "intern blijft de reden (voor de werfzone en het evenement)");
    const losse = publicSpaceEntry(item);
    const gebundeld = publicSpaceEntries([item, { ...item, id: "parking:2099-000001|L2" }], { vandaag: VANDAAG, straat: PROEF.name });
    for (const e of [losse, ...gebundeld]) {
      assert.equal(e.title, "Parkeerverbod");
      assert.equal(e.info, "");
      const tekst = zichtbaar(e);
      zonderReden(tekst, reden, verraad);
      assert.doesNotMatch(tekst, NOOIT, reden);
    }
    assert.equal(zichtbaar(gebundeld[0]), isVerhuisReden(reden) ? zonderNummer : basis, `de reden "${reden}" verandert wat de kaart toont`);
  }
});

test("bij een werfzone: de werfkaart en de kaart van een latere fase noemen de reden nooit (titel 'Parkeerverbod')", () => {
  const fase = (nr, van, tot) => ({ id: `sgw:GW2099-000901|${nr}`, kind: "sgw", kindLabel: "Werfzone", title: "Werfzone", location: "", reference: "GW2099-000901", detail: `Fase ${nr}`, status: "vergund", start: van, end: tot, streets: [PROEF], werfzoneStreets: [PROEF], omleidingStreets: [] });
  const verbod = (ref, van, tot, reden) => ({ id: `parking:${ref}|1`, kind: "parking", kindLabel: "Parkeerverbod", title: reden, reason: reden, location: "Proefstraat, 2000 Antwerpen", start: van, end: tot, status: "Goedgekeurd", reference: ref, detail: "", startTime: "07:00", endTime: "17:00", weekdaysOnly: false, streets: [PROEF] });
  const rows = [
    fase(1, "2099-02-20T06:00:00Z", "2099-03-20T16:00:00Z"), fase(2, "2099-03-21T06:00:00Z", "2099-05-30T16:00:00Z"),
    verbod("2099-000901", "2099-02-20T00:00:00.000Z", "2099-03-20T00:00:00.000Z", "Melding ikv werfsignalisaties"),
    verbod("2099-000902", "2099-03-21T00:00:00.000Z", "2099-05-30T00:00:00.000Z", "Melding ikv werfsignalisaties"),
  ];
  const kaarten = samenWerven([...werkEntries([], { vandaag: VANDAAG }), ...publicSpaceEntries(rows, { vandaag: VANDAAG, alle: rows, straat: PROEF.name })], { straat: PROEF.name, vandaag: VANDAAG, alle: rows });
  const werf = kaarten.find((e) => e.uid === "publicSpace:sgw:GW2099-000901|1");
  const later = kaarten.find((e) => e.uid === "publicSpace:parking:2099-000902|1");
  assert.ok(werf && later, "de werfkaart en de kaart van de tweede fase");
  assert.deepEqual(werf.werf.parkeerverboden, ["2099-000901", "2099-000902"], "intern hangt de reden het parkeerverbod nog aan zijn werfzone");
  assert.equal(later.title, "Parkeerverbod");
  for (const e of [werf, later]) {
    const tekst = zichtbaar(e);
    zonderReden(tekst, "Melding ikv werfsignalisaties", /werfsignal|\bikv\b|in het kader van|Reden volgens de stad|Parkeerverbod voor/i);
  }
});

test("bij een evenement: de titel blijft 'Parkeerverbod'; zonder één kandidaat verandert er niets, ook geen context", () => {
  const reden = "Aanvraag voor evenementen gesteund door de stad";
  const p = publicSpaceEntry({ ...liveItem(reden), streets: [straat("Proefplein")], location: "Proefplein, 2000 Antwerpen" });
  const loop = { id: "asign-ev-et2099000981-2099-03-12", externalId: "ET2099000981", sourceId: "district-asign-evenementen", title: "Proefloop", date: "2099-03-12", location: "Proefplein", straten: ["Proefplein"], stratenVolledig: true, info: "Naam met de hand nagekeken bij een publieke bron. Evenementendossier ET2099000981 van de stad (A-Sign).", category: "sport" };
  const [een] = verrijkMetContext([p], { straat: "Proefplein", vandaag: VANDAAG, agendaItems: [loop] });
  assert.equal(een.title, "Parkeerverbod");
  zonderReden(zichtbaar(een, { straatNaam: "Proefplein" }), reden, /gesteund door de stad|voor een evenement|vermoedelijk voor|Parkeerverbod,/i);
  // Twee kandidaten: het parkeerverbod blijft precies zoals het was (geen "ook gepland hier", die zou de reden verraden).
  const markt = { id: "markt-proef-2099-03-12", sourceId: "stad-markten", title: "Gemengde markt Proefplein", date: "2099-03-12", timeSlot: "08:00", location: "Proefplein, 2000 Antwerpen", category: "markets" };
  const [twee] = verrijkMetContext([p, agendaEntry(loop, "sport"), agendaEntry(markt, "markets")], { straat: "Proefplein", vandaag: VANDAAG, agendaItems: [loop, markt] });
  assert.deepEqual(twee, p);
  // Een parkeerverbod met een andere reden krijgt nooit een evenement of context: zelfde kaart als zonder reden.
  const verhuis = publicSpaceEntry({ ...liveItem("Verhuis"), streets: [straat("Proefplein")], location: "Proefplein, 2000 Antwerpen" });
  assert.deepEqual(verrijkMetContext([verhuis, agendaEntry(loop, "sport")], { straat: "Proefplein", vandaag: VANDAAG, agendaItems: [loop] })[0], verhuis);
});

test("de districtslijst (public-space-live.js) en de code: geen reden als titel, regel of zin", () => {
  const lijst = fs.readFileSync(path.join(root, "site", "public-space-live.js"), "utf8");
  assert.match(lijst, /const titel=i=>i\.kind==="parking"\?PARKEERVERBOD_TITEL:/);
  assert.match(lijst, /const details=i=>i\.kind==="parking"\?\[\["Uren",/);
  assert.doesNotMatch(lijst, /i\.reason|Reden volgens de stad|reden-niet-gepubliceerd/);
  // Geen tekst die een reden aan een parkeerverbod plakt, in de code die de site, de verversing of de build maakt.
  const treffers = [];
  for (const map of ["site", "lib", "scripts"]) {
    for (const naam of fs.readdirSync(path.join(root, map)).filter((n) => /\.(?:m?js)$/.test(n) && n !== "agenda-feed.js")) {
      const tekst = fs.readFileSync(path.join(root, map, naam), "utf8");
      if (/["'`]Parkeerverbod (?:voor|met)\b|Parkeerverbod, vermoedelijk voor \$\{|Reden volgens de stad|parkeerTitel\(|PARKEER_REDENEN/.test(tekst)) treffers.push(`${map}/${naam}`);
    }
  }
  assert.deepEqual(treffers, []);
});

test("historiek: nieuwe items, de vorige stand en oude wijzigingen zonder reden; een andere reden is geen wijziging", () => {
  const T1 = "2099-03-10T03:00:00.000Z", T2 = "2099-03-11T03:00:00.000Z";
  // Zoals de verversing ze ophaalt (scripts/refresh-live-history.mjs vraagt de reden niet eens op; hier wel, als proef).
  const items = (reden) => REDENEN.map(([r], i) => ({ ...liveItem(reden ?? r, { Locatienummer: `L${i}` }, { alleenLive: false }), streets: [PROEF] }));
  for (const item of items()) {
    const kort = compactPublicSpaceItem(item);
    assert.equal(kort.title, "Parkeerverbod");
    assert.equal("reason" in kort, false);
  }
  const eerst = updateLiveHistory(null, { observedAt: T1, worksResult: { ok: true, items: [] }, publicSpaceResult: { ok: true, items: items() } });
  // Zelfde parkeerverboden, andere reden: geen enkele wijziging.
  const daarna = updateLiveHistory(eerst, { observedAt: T2, worksResult: { ok: true, items: [] }, publicSpaceResult: { ok: true, items: items("Container") } });
  assert.deepEqual(daarna.changes, []);
  const tekst = JSON.stringify(daarna);
  for (const [reden, verraad] of REDENEN) zonderReden(tekst, reden, verraad);
  assert.deepEqual(historiekPrivacyBevindingen(daarna), []);

  // Een historiek van vóór 18 oktober 2026: de reden als titel, ook in de wijzigingen.
  const oud = (id, titel) => ({ id: `parking:${id}`, kind: "parking", kindLabel: "Parkeerverbod", title: titel, location: "Proefstraat, 2000 Antwerpen", start: "2099-03-12T00:00:00.000Z", end: "2099-03-13T00:00:00.000Z", status: "Goedgekeurd", reference: id, detail: "", streets: [PROEF] });
  const doc = {
    schemaVersion: 1, observedAt: T2, retentionDays: 90, baselineInitializedAt: T1,
    layers: { works: { status: "ok", lastAttemptAt: T2, lastSuccessAt: T2, errorCode: null, count: 0, digest: null, items: [] },
      publicSpace: { status: "ok", lastAttemptAt: T2, lastSuccessAt: T2, errorCode: null, count: 1, digest: null, items: [oud("P1", "Verhuis")] } },
    changes: [
      { observedAt: T2, layer: "publicSpace", id: "parking:P1", type: "changed", fields: ["title"], before: { title: "Verhuis" }, after: { title: "Container" } },
      { observedAt: T2, layer: "publicSpace", id: "parking:P2", type: "changed", fields: ["end", "title"], before: { end: "2099-03-13T00:00:00.000Z", title: "Ceremoniewagen" }, after: { end: "2099-03-14T00:00:00.000Z", title: "Filmopname" } },
      { observedAt: T2, layer: "publicSpace", id: "parking:P3", type: "removed", fields: [], before: oud("P3", "Aanvraag tot een verhuis met of zonder ladderlift, verhuiswagen"), after: null },
    ],
  };
  assert.deepEqual([...new Set(historiekPrivacyBevindingen(doc).map((v) => v.code))], ["reden"], "de scan vindt de reden");
  const publiek = historiekVoorPubliek(doc);
  assert.deepEqual(historiekPrivacyBevindingen(publiek), []);
  assert.deepEqual(publiek.changes.map((c) => [c.id, c.fields]), [["parking:P2", ["end"]], ["parking:P3", []]], "een wijziging van alleen de reden valt weg");
  assert.equal(publiek.changes[1].before.title, "Parkeerverbod");
  const dag = archiefDagVoorPubliek({ schemaVersion: 1, date: "2099-03-11", events: doc.changes });
  assert.deepEqual(historiekPrivacyBevindingen(dag), []);
  // De opkuis van lib/parkeer-historiek.mjs (voor de vorige stand in updateLiveHistory) doet hetzelfde.
  assert.equal(parkeerItemVoorHistoriek(oud("P1", "Verhuis")).title, "Parkeerverbod");
  assert.deepEqual(parkeerWijzigingenVoorHistoriek(doc.changes).map((c) => c.id), ["parking:P2", "parking:P3"]);
  assert.equal(itemVoorHistoriek({ title: "Container", end: "x" }, { parkeer: true }).title, "Parkeerverbod");
  for (const [reden, verraad] of REDENEN) { zonderReden(JSON.stringify(publiek), reden, verraad); zonderReden(JSON.stringify(dag), reden, verraad); }
});

test("straatbestanden: nieuwe items, bundelrijen en een vorige stand zonder reden; de scan houdt een bestand met reden tegen", (t) => {
  for (const [reden, verraad] of REDENEN) {
    const schoon = itemVoorStraat({ ...liveItem(reden, {}, { alleenLive: false }), streets: [PROEF] }, { laag: "publiekeRuimte" });
    assert.ok(schoon, reden);
    assert.equal(schoon.title, "Parkeerverbod");
    assert.equal("reason" in schoon, false);
    zonderReden(JSON.stringify(schoon), reden, verraad);
  }
  // De andere plaatsen van hetzelfde parkeerverbod (een bundelrij in elk straatbestand): zonder reden.
  const twee = [{ ...liveItem("Verhuis", {}, { alleenLive: false }), streets: [PROEF] }, { ...liveItem("Verhuis", { Locatienummer: "L2" }, { alleenLive: false }), streets: [straat("Tweedestraat")] }];
  const rijen = bundelAanvulling([twee[0]], bundelRijen(twee));
  assert.equal(rijen.length, 1);
  assert.equal(rijen[0].title, "Parkeerverbod");
  assert.equal("reason" in rijen[0], false);

  // Een straatbestand van vóór 18 oktober 2026 (de reden als titel en als veld): de scan houdt het tegen, en opnieuw
  // schrijven met de regels van nu (herschrijf, zonder iets op te halen) haalt de reden weg.
  const map = fs.mkdtempSync(path.join(os.tmpdir(), "parkeerverbod-zonder-reden-"));
  t.after(() => fs.rmSync(map, { recursive: true, force: true }));
  fs.mkdirSync(path.join(map, "site", "geo"), { recursive: true });
  fs.mkdirSync(path.join(map, "site", "straat"), { recursive: true });
  fs.copyFileSync(path.join(root, "site", "geo", "straten.json"), path.join(map, "site", "geo", "straten.json"));
  const [id, naam, postcode] = JSON.parse(fs.readFileSync(path.join(root, "site", "geo", "straten.json"), "utf8")).streets[0];
  const ref = 0;
  const oudItem = (n, reden, extra = {}) => ({ id: `parking:2099-00000${n}|L${n}`, kind: "parking", kindLabel: "Parkeerverbod", title: reden, location: `${naam}, ${postcode} Antwerpen`, start: "2099-03-12T00:00:00.000Z", end: "2099-03-12T00:00:00.000Z", status: "Goedgekeurd", reference: `2099-00000${n}`, detail: "", reason: reden, postcode: String(postcode), startTime: "07:00", endTime: "17:00", weekdaysOnly: false, streets: [ref], ...extra });
  const inhoud = { straat: { id: String(id), namen: [{ name: naam, postcode: String(postcode) }] }, straten: [[String(id), naam, String(postcode)]], werken: [], publiekeRuimte: [oudItem(1, "Verhuis"), oudItem(2, "Ceremoniewagen"), oudItem(3, "Container", { id: "parking:2099-000003|L3|bundel", bundel: true })], vergunningen: [], terrassen: [], evenementen: [] };
  const doc = { schemaVersion: 1, ververst: "2099-03-10T04:22:00.000Z", inhoud: "abc123abc123", ...inhoud };
  fs.writeFileSync(path.join(map, "site", "straat", `${id}.json`), JSON.stringify(doc));
  fs.writeFileSync(path.join(map, STRAAT_INDEX), JSON.stringify({ schemaVersion: 1, ververst: doc.ververst, lagen: {}, straten: { [id]: doc.inhoud } }));
  const voor = straatBestandenProblemen(map);
  assert.ok(voor.some((p) => /privacy reden op \$\.publiekeRuimte\[0\]/.test(p)), voor.join("\n"));
  assert.ok(voor.some((p) => /veld reason op \$\.publiekeRuimte\[0\]/.test(p)), voor.join("\n"));
  assert.ok(voor.every((p) => !/Verhuis|Ceremoniewagen|Container/.test(p)), "de melding noemt nooit de reden zelf");
  schrijfStraatSnapshots({ rootDir: map, herschrijf: true, agendaItems: [], history: null, clock: () => new Date("2099-03-10T09:00:00.000Z") });
  const na = JSON.parse(fs.readFileSync(path.join(map, "site", "straat", `${id}.json`), "utf8"));
  assert.deepEqual(na.publiekeRuimte.map((i) => [i.title, "reason" in i]), [["Parkeerverbod", false], ["Parkeerverbod", false], ["Parkeerverbod", false]]);
  assert.deepEqual(straatBestandenProblemen(map), []);
  for (const [reden, verraad] of REDENEN.slice(0, 2)) zonderReden(fs.readFileSync(path.join(map, "site", "straat", `${id}.json`), "utf8"), reden, verraad);
});

test("de gegenereerde bestanden in de repo: elk parkeerverbod heet 'Parkeerverbod', zonder reason; feed en eventpagina's zonder reden", () => {
  const fouten = [];
  const kijk = (waarde, waar, parkeer = false) => {
    if (Array.isArray(waarde)) { waarde.forEach((w, i) => kijk(w, `${waar}[${i}]`, parkeer)); return; }
    if (!waarde || typeof waarde !== "object") return;
    const isParkeer = parkeer || waarde.kind === "parking" || String(waarde.id || "").startsWith("parking:");
    if (isParkeer && ("reason" in waarde || ("title" in waarde && waarde.title !== "Parkeerverbod"))) fouten.push(waar);
    for (const [k, v] of Object.entries(waarde)) kijk(v, `${waar}.${k}`, isParkeer);
  };
  const json = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
  const straatMap = path.join(root, "site", "straat");
  for (const naam of fs.existsSync(straatMap) ? fs.readdirSync(straatMap).filter((n) => n.endsWith(".json")) : []) kijk(json(`site/straat/${naam}`), `site/straat/${naam}`);
  const historiek = path.join(root, "site", "history");
  for (const rel of fs.existsSync(historiek) ? fs.readdirSync(historiek, { recursive: true }).map(String).filter((n) => n.endsWith(".json")) : []) kijk(json(`site/history/${rel}`), `site/history/${rel}`);
  assert.deepEqual(fouten.slice(0, 20), [], `${fouten.length} parkeerverboden met een reden (draai node scripts/opkuis-historiek-privacy.mjs --write en herschrijf de straatbestanden)`);
  const teksten = [["site/agenda-feed.js", fs.readFileSync(path.join(root, "site", "agenda-feed.js"), "utf8")]];
  const eventMap = path.join(root, "site", "event");
  for (const naam of fs.existsSync(eventMap) ? fs.readdirSync(eventMap) : []) {
    const f = path.join(eventMap, naam, "index.html");
    if (fs.existsSync(f)) teksten.push([`site/event/${naam}`, fs.readFileSync(f, "utf8")]);
  }
  const verraad = /Parkeerverbod (?:voor|met) |Parkeerverbod, vermoedelijk|Reden volgens de stad|Tijdelijk parkeerverbod/;
  assert.deepEqual(teksten.filter(([, tekst]) => verraad.test(tekst)).map(([rel]) => rel), []);
});
