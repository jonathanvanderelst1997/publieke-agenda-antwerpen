// Tweede nakijkronde van 18 oktober 2026 op "parkeerverbod zonder reden". Besluit van de eigenaar: een parkeerverbod
// zegt DAT er een is, WAAR exact (de straat met het huisnummer of het bereik zoals publiekParkeerAdres het schrijft) en
// WANNEER (dagen en uren), nooit waarom. Bundelen bij een werfzone en zeggen bij welk dossier het hoort, mag.
// 1. Een parkeerverbod op meer plaatsen (één A-Sign-nummer, dezelfde dagen en uren) werd "Proefstraat" of "Proefstraat +
//    2 andere straten": de plaats viel weg, ook als de eigen rij exact bekend was (dicht, Waar, werfkaart, vervolgkaart,
//    buurtkaart). Oorzaak in het ontwerp: de plaats van een gebundeld parkeerverbod kwam uit de straatnamen (waarKort),
//    zoals bij een werfzone. Nu zijn het de plaatsen van zijn rijen (`plaatsen`), exact.
// 2. De ochtendstand (de straatbestanden) noemt de straat en de postcode, nooit het huisnummer (dat bewaart de repo
//    niet: site/adres-privacy.js). De kaart zei niet dat het huisnummer alleen live komt; nu wel, ook in de werfkaart.
// 3. De popup van de buurtkaart zei bij een parkeerverbod alleen het beginuur ("08.00"), en bij meer dagen geen uren.
// 4. De ochtendstand hing een parkeerverbod niet meer aan zijn evenement (de reden staat niet in een straatbestand). Nu
//    legt de verversing het verband zelf en bewaart ze alleen de sleutel van dat evenement (`evenementSleutel`), zoals
//    `werfzoneDossier` bij een werfzone; de browser hangt het er alleen aan als zijn eigen beslissing dezelfde is.
// 6. Derde nakijkronde: de zin dat het huisnummer alleen live in A-Sign staat, stond niet in de vaste lijst van zinnen die
//    zeggen wat ontbreekt (site/onbekend-zinnen.js), en de vaagheidsmeter telde ze niet: het parkeerverbod ging zo van 8
//    naar 0 van de 29 vage kaarten, terwijl elke kaart uit de ochtendstand zegt dat de plaats niet exact is.
// 5. Derde nakijkronde: het lijstje "Alles wat er in een straat speelt" op de startpagina toonde een parkeerverbod zonder
//    uren, en bij "alleen op weekdagen" ook zonder plaats (het detail was `detail || location`). Oorzaak in het ontwerp:
//    elke lijst buiten de plekpagina schreef zelf uit de ruwe velden wat ze over een parkeerverbod zegt (zo ook de
//    vooruitblik, zonder uren). Nu zegt elke lijst het met parkeerverbodInLijst (site/place-core.js), zoals de kaart.
// Verzonnen straten, nummers, dossiers en redenen; echte straat-id's alleen uit site/geo/straten.json (Kammenstraat). Een
// echte straat krijgt alleen huisnummer 999 ("Kammenstraat 999-999", zoals A-Sign één nummer schrijft), dat daar niet
// bestaat: de repo is publiek, en een bestaand adres naast een verhuis hoort nergens (tests/historiek-privacy.test.mjs).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { collectPublicSpace } from "../site/public-space-live-core.js";
import * as PC from "../site/place-core.js";
import { duidelijkeKaart } from "../site/permit-clarity.js";
import { popupHtml } from "../site/kaart-lagen.js";
import { buildWeekPulse } from "../site/week-pulse.js";
import { buildStreetGroups } from "../site/street-overview.js";
import { lagenUitStand, straatItems } from "../site/straat-snapshot.js";
import { itemVoorStraat, schrijfStraatSnapshots, verzamelStraatBronnen } from "../scripts/build-straat-snapshots.mjs";
import { fetchPublicSpaceHistory } from "../scripts/refresh-live-history.mjs";
import { straatBestandenProblemen } from "../lib/straat-bestanden.mjs";
import { HUIK, KAM, PET, maakWerkmap } from "./helpers/straat-fixture.mjs";
import { ONBEKEND_ZINNEN } from "../site/onbekend-zinnen.js";
import { vaagheidVanKaart } from "../lib/vaagheid.mjs";
import { adresZonderHuisnummer, publiekParkeerAdres } from "../site/adres-privacy.js";
import { adresAlleenStraat } from "../lib/historiek-privacy.mjs";

const { publicSpaceEntries, publicSpaceEntry, samenWerven, verrijkMetContext, werkEntries } = PC;
// De plaatsen voor "Toon alle N plaatsen" (site/place-view.js); null als de code die lijst niet kent.
const allePlaatsenVan = (e) => (typeof PC.allePlaatsenVan === "function" ? PC.allePlaatsenVan(e) : null);

const VANDAAG = "2099-03-01";
const P = { id: "Proefstraat", name: "Proefstraat", postcode: "2000" };
const T = { id: "Tweedestraat", name: "Tweedestraat", postcode: "2000" };
const D = { id: "Derdestraat", name: "Derdestraat", postcode: "2000" };
const WERF = "Melding ikv werfsignalisaties";
const EVENEMENT = "Aanvraag voor evenementen gesteund door de stad";
const VERRAAD = /werfsignal|\bikv\b|in het kader van|verhuis|evenementen gesteund|[Rr]eden|Parkeerverbod (?:voor|met)\b/;
const ms = (iso) => Date.parse(`${iso}T00:00:00Z`);
const uur = (h) => Date.UTC(1899, 11, 30, h); // A-Sign bewaart een uur als een tijdstip op 30 december 1899
const ZIN_LIVE = "Het huisnummer staat alleen in de live gegevens van A-Sign; die zijn (nog) niet geladen.";
const feat = (nr, adres, extra = {}) => ({ attributes: { Dossiernummer: "2099-000777", Locatienummer: String(nr), Status: "Goedgekeurd", Adres: adres, Postcode: "2000", Reden: "Aanvraag tot het plaatsen van een container", Startdatum: ms("2099-03-12"), Einddatum: ms("2099-03-13"), Starttijd: uur(8), Eindtijd: uur(18), EnkelWeekdagen: "0", GipodID: null, District: "ANTWERPEN", ...extra } });
// Zoals de browser het live maakt (alleenLive: het huisnummer of bereik van publiekParkeerAdres), met de straat van elke rij.
const live = (feats, straten) => collectPublicSpace({ parkingFeatures: feats, alleenLive: true }).map((r, i) => ({ ...r, streets: [straten[i]] }));
// Alles wat een bewoner van de kaart kan zien (ook ingeklapt), zonder het interne item.
const zichtbaar = (e, straat = P.name) => JSON.stringify([e.title, e.summary, e.info, e.location, e.plaatsen, e.regels, e.uitleg, duidelijkeKaart(e, e.item || {}, { straat, vandaag: VANDAAG })]);
const tekst = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const regel = (e, naam) => [...(e.regels || []), ...(e.uitleg?.regels || [])].find(([k]) => k === naam)?.[1] || "";

// ---------- 1. waar exact bij meer plaatsen ----------

test("één parkeerverbod op twee plaatsen in dezelfde straat: de kaart noemt beide plaatsen exact, nooit alleen de straat", () => {
  const rows = live([feat(1, "Proefstraat 12-14 2000 Antwerpen"), feat(2, "Proefstraat 30-32 2000 Antwerpen")], [P, P]);
  assert.deepEqual(rows.map((r) => r.location), ["Proefstraat 12–14, 2000 Antwerpen", "Proefstraat 30–32, 2000 Antwerpen"]);
  const [e] = publicSpaceEntries(rows, { vandaag: VANDAAG, alle: rows, straat: P.name });
  assert.equal(e.location, "Proefstraat 12–14, 2000 Antwerpen en Proefstraat 30–32, 2000 Antwerpen");
  assert.deepEqual(e.plaatsen, ["Proefstraat 12–14, 2000 Antwerpen", "Proefstraat 30–32, 2000 Antwerpen"]);
  // Alles staat al in "Waar": geen ingeklapte lijst nodig.
  assert.deepEqual(allePlaatsenVan(e), []);
  // De popup van de buurtkaart noemt dezelfde plaatsen.
  assert.ok(tekst(popupHtml([e], VANDAAG)).includes("Proefstraat 12–14, 2000 Antwerpen en Proefstraat 30–32, 2000 Antwerpen"), tekst(popupHtml([e], VANDAAG)));
  assert.doesNotMatch(zichtbaar(e), VERRAAD);
});

test("één parkeerverbod in drie straten, op de plekpagina van één ervan: de eigen plaats exact, de andere exact in 'Toon alle'", () => {
  const alle = live([feat(1, "Proefstraat 12-14 2000 Antwerpen"), feat(2, "Tweedestraat 3-5 2000 Antwerpen"), feat(3, "Derdestraat 7-9 2000 Antwerpen")], [P, T, D]);
  const [e] = publicSpaceEntries([alle[0]], { vandaag: VANDAAG, alle, straat: P.name });
  assert.equal(e.location, "Proefstraat 12–14, 2000 Antwerpen + 2 andere plaatsen");
  assert.deepEqual(e.plaatsen, ["Proefstraat 12–14, 2000 Antwerpen", "Derdestraat 7–9, 2000 Antwerpen", "Tweedestraat 3–5, 2000 Antwerpen"]);
  assert.deepEqual(allePlaatsenVan(e), e.plaatsen, "\"Toon alle 3 plaatsen\": elke plaats exact, niet alleen de straatnamen");
  assert.deepEqual(e.straten, ["Derdestraat", "Proefstraat", "Tweedestraat"], "de straten blijven voor de logica (evenement, werfzone)");
  assert.ok(tekst(popupHtml([e], VANDAAG)).includes("Proefstraat 12–14, 2000 Antwerpen + 2 andere plaatsen"));
  // Zonder gekozen straat (een wijk): de eerste plaats, de rest in de lijst.
  const [w] = publicSpaceEntries(alle, { vandaag: VANDAAG, alle });
  assert.equal(w.location, "Derdestraat 7–9, 2000 Antwerpen; Proefstraat 12–14, 2000 Antwerpen en Tweedestraat 3–5, 2000 Antwerpen");
  // Vier plaatsen in dezelfde straat: de eerste drie dicht, alle vier in de lijst.
  const vier = live([10, 20, 30, 40].map((n, i) => feat(i + 1, `Proefstraat ${n}-${n + 2} 2000 Antwerpen`)), [P, P, P, P]);
  const [v] = publicSpaceEntries(vier, { vandaag: VANDAAG, alle: vier, straat: P.name });
  assert.equal(v.location, "Proefstraat 10–12, 2000 Antwerpen; Proefstraat 20–22, 2000 Antwerpen en Proefstraat 30–32, 2000 Antwerpen + 1 andere plaats");
  assert.equal(allePlaatsenVan(v).length, 4);
  for (const k of [e, w, v]) assert.doesNotMatch(zichtbaar(k), VERRAAD);
});

test("werfkaart en vervolgkaart: een parkeerverbod op meer plaatsen staat er met elke plaats exact", () => {
  const fase = (nr, van, tot) => ({ id: `sgw:GW2099-000777|${nr}`, kind: "sgw", kindLabel: "Werfzone", title: "Werfzone", location: "", reference: "GW2099-000777", detail: `Fase ${nr}`, status: "vergund", start: van, end: tot, streets: [P], werfzoneStreets: [P], omleidingStreets: [] });
  const zone1 = fase(1, "2099-03-12T06:00:00Z", "2099-03-13T16:00:00Z");
  const verboden = live([feat(1, "Proefstraat 12-14 2000 Antwerpen", { Reden: WERF }), feat(2, "Proefstraat 30-32 2000 Antwerpen", { Reden: WERF })], [P, P]);
  const rows = [zone1, ...verboden];
  const [werfzone] = samenWerven(publicSpaceEntries(rows, { vandaag: VANDAAG, alle: rows, straat: P.name }), { straat: P.name, vandaag: VANDAAG, alle: rows });
  assert.deepEqual(werfzone.werf?.parkeerverboden, ["2099-000777"]);
  assert.match(regel(werfzone, "Parkeerverbod"), /^Proefstraat 12–14, 2000 Antwerpen en Proefstraat 30–32, 2000 Antwerpen: 12–13 mrt, van 8\.00 tot 18\.00 uur \(2099-000777, /);
  assert.doesNotMatch(zichtbaar(werfzone), VERRAAD);
  // Een parkeerverbod dat later begint dan de werfkaart (een tweede fase): de vervolgkaart, met dezelfde plaatsen.
  const zone2 = fase(2, "2099-03-20T06:00:00Z", "2099-03-21T16:00:00Z");
  const later = live([feat(3, "Proefstraat 12-14 2000 Antwerpen", { Reden: WERF, Dossiernummer: "2099-000778", Startdatum: ms("2099-03-20"), Einddatum: ms("2099-03-21") }), feat(4, "Proefstraat 30-32 2000 Antwerpen", { Reden: WERF, Dossiernummer: "2099-000778", Startdatum: ms("2099-03-20"), Einddatum: ms("2099-03-21") })], [P, P]);
  const rijen = [zone1, zone2, ...verboden, ...later];
  const kaarten = samenWerven(publicSpaceEntries(rijen, { vandaag: VANDAAG, alle: rijen, straat: P.name }), { straat: P.name, vandaag: VANDAAG, alle: rijen });
  const vervolg = kaarten.find((k) => k.bijWerf);
  assert.ok(vervolg, JSON.stringify(kaarten.map((k) => k.uid)));
  assert.equal(vervolg.location, "Proefstraat 12–14, 2000 Antwerpen en Proefstraat 30–32, 2000 Antwerpen");
  assert.doesNotMatch(zichtbaar(vervolg), VERRAAD);
});

test("de vooruitblik op de startpagina: een parkeerverbod met zijn plaats exact, niet alleen de straatnaam", () => {
  const [rij] = live([feat(1, "Proefstraat 12-14 2000 Antwerpen")], [P]);
  const puls = buildWeekPulse({ fromDay: "2099-03-10", toDay: "2099-03-16", publicSpace: [rij] });
  assert.deepEqual(puls.upcoming.map((i) => [i.title, i.location]), [["Parkeerverbod", "Proefstraat 12–14, 2000 Antwerpen"]]);
  // Een werfzone houdt haar straten.
  const zone = { id: "sgw:GW2099-000777|1", kind: "sgw", kindLabel: "Werfzone", title: "Werfzone", location: "", start: "2099-03-12T06:00:00Z", end: "2099-03-13T16:00:00Z", streets: [P, T] };
  assert.equal(buildWeekPulse({ fromDay: "2099-03-10", toDay: "2099-03-16", publicSpace: [zone] }).upcoming[0].location, "Proefstraat · Tweedestraat");
});

// ---------- 2. de ochtendstand zegt dat het huisnummer alleen live komt ----------

const ochtendDoc = (items, extra = {}) => ({
  schemaVersion: 1, ververst: "2099-03-10T04:22:00.000Z", inhoud: "abc123abc123",
  straat: { id: KAM.id, namen: [{ name: KAM.name, postcode: KAM.postcode }] }, kader: [4.4, 51.215, 4.403, 51.219],
  straten: [[KAM.id, KAM.name, KAM.postcode], [PET.id, PET.name, PET.postcode]],
  werken: [], vergunningen: [], terrassen: [], evenementen: [], publiekeRuimte: items, ...extra,
});
const ochtendVerbod = (ref, extra = {}) => ({ id: `parking:${ref}|1`, kind: "parking", kindLabel: "Parkeerverbod", title: "Parkeerverbod", location: "Kammenstraat, 2000 Antwerpen", start: "2099-03-12T00:00:00.000Z", end: "2099-03-12T00:00:00.000Z", status: "Goedgekeurd", reference: ref, detail: "", postcode: "2000", startTime: "07:00", endTime: "17:00", weekdaysOnly: false, streets: [0], ...extra });

test("ochtendstand: een parkeerverbod zonder huisnummer zegt dat het huisnummer alleen live in A-Sign staat; live niet", () => {
  const [rij] = lagenUitStand({ doc: ochtendDoc([ochtendVerbod("2099-000901")]) }, { vandaag: VANDAAG }).publicSpace;
  assert.equal(rij.location, "Kammenstraat, 2000 Antwerpen");
  const [ochtend] = publicSpaceEntries([rij], { vandaag: VANDAAG, alle: [rij], straat: KAM.name });
  assert.equal(ochtend.summary, `Niet parkeren van 7.00 tot 17.00 uur. ${ZIN_LIVE}`);
  // Live, met het bereik: geen zin over de ochtend.
  const [nu] = publicSpaceEntries(live([feat(1, "Proefstraat 12-14 2000 Antwerpen")], [P]), { vandaag: VANDAAG, straat: P.name });
  assert.equal(nu.summary, "Niet parkeren van 8.00 tot 18.00 uur.");
  // Live met een hoek (vierde nakijkronde van 18 oktober 2026: dat werd de straat met de postcode, zonder het nummer dat
  // A-Sign wel geeft): de hoek met het nummer, zoals de bron het schrijft, en geen zin over de ochtend.
  const [hoek] = publicSpaceEntries(live([feat(1, "Proefstraat hoek-64 2000 Antwerpen")], [P]), { vandaag: VANDAAG, straat: P.name });
  assert.equal(hoek.location, "Proefstraat hoek–64, 2000 Antwerpen");
  assert.equal(hoek.summary, "Niet parkeren van 8.00 tot 18.00 uur.");
  // Live zonder huisnummer in A-Sign ("Onbekend-Onbekend"): de straat en de postcode, zoals de bron, zonder belofte.
  const [zonder] = publicSpaceEntries(live([feat(1, "Proefstraat Onbekend-Onbekend 2000 Antwerpen")], [P]), { vandaag: VANDAAG, straat: P.name });
  assert.equal(zonder.location, "Proefstraat, 2000 Antwerpen");
  assert.equal(zonder.summary, "Niet parkeren van 8.00 tot 18.00 uur.");
  // Live met een bundelrij van de ochtend (de andere straat; aanvullenMetOchtend): die plaats heeft geen huisnummer.
  const [eigen] = live([feat(1, "Proefstraat 12-14 2000 Antwerpen", { Dossiernummer: "2099-000901", Startdatum: ms("2099-03-12"), Einddatum: ms("2099-03-12"), Starttijd: uur(7), Eindtijd: uur(17) })], [P]);
  const bundel = { ...straatItems(ochtendDoc([{ id: "parking:2099-000901|2|bundel", kind: "parking", reference: "2099-000901", start: "2099-03-12T00:00:00.000Z", end: "2099-03-12T00:00:00.000Z", startTime: "07:00", endTime: "17:00", weekdaysOnly: false, title: "Parkeerverbod", streets: [1], bundel: true }]), "publiekeRuimte")[0] };
  const [samen] = publicSpaceEntries([eigen], { vandaag: VANDAAG, alle: [eigen, bundel], straat: P.name });
  assert.deepEqual(samen.plaatsen, ["Proefstraat 12–14, 2000 Antwerpen", "Peterseliestraat, 2000 Antwerpen"]);
  assert.equal(samen.summary, `Niet parkeren van 7.00 tot 17.00 uur. ${ZIN_LIVE}`);
});

// Vierde nakijkronde van 18 oktober 2026: publiekParkeerAdres kende alleen "Xstraat 12-14" (twee nummers met een streepje,
// oplopend, hoogstens 300 uit elkaar). Bij één nummer zonder streepje, een omgekeerd bereik, "12/14", een hoek of een bus
// gaf het niets, en de kaart toonde dan alleen de straat met de postcode, zonder zin: het nummer van de bron viel weg. Nu
// de plaats zo exact als A-Sign ze geeft. Een bereik over (bijna) de hele straat ("1-400") blijft dat bereik: dat zegt de
// bron, en het is geen valse precisie (wie op nummer 402 woont, ziet dat het niet bij hem is). Een bus nooit: het
// huisnummer is de plaats op straat, de bus is een woning. Verzonnen straten.
test("publiekParkeerAdres: elke vorm van A-Sign zo exact als de bron, en de opslag houdt alleen de straat", () => {
  const vormen = [
    ["Proefstraat 12-14 2000 Antwerpen", "Proefstraat 12–14, 2000 Antwerpen"],
    ["Proefstraat 12-12 2000 Antwerpen", "Proefstraat 12, 2000 Antwerpen"],
    // Eén nummer zonder streepje.
    ["Proefstraat 12 2000 Antwerpen", "Proefstraat 12, 2000 Antwerpen"],
    ["Proefstraat 12A 2000 Antwerpen", "Proefstraat 12A, 2000 Antwerpen"],
    // Een omgekeerd bereik: oplopend.
    ["Proefstraat 14-12 2000 Antwerpen", "Proefstraat 12–14, 2000 Antwerpen"],
    ["Proefstraat 14b-12 2000 Antwerpen", "Proefstraat 12–14b, 2000 Antwerpen"],
    ["Proefstraat 12a-12A 2000 Antwerpen", "Proefstraat 12a, 2000 Antwerpen"],
    // Nummers met een schuine streep: elk nummer, oplopend.
    ["Proefstraat 12/14 2000 Antwerpen", "Proefstraat 12 en 14, 2000 Antwerpen"],
    ["Proefstraat 16/12 2000 Antwerpen", "Proefstraat 12 en 16, 2000 Antwerpen"],
    ["Proefstraat 12/14/16 2000 Antwerpen", "Proefstraat 12, 14 en 16, 2000 Antwerpen"],
    // Een hoek met het nummer, zoals de bron het schrijft.
    ["Proefstraat hoek-64 2060 Antwerpen", "Proefstraat hoek–64, 2060 Antwerpen"],
    ["Proefstraat 34-hoek 2060 Antwerpen", "Proefstraat 34–hoek, 2060 Antwerpen"],
    ["Proeflaan (2610) 34-hoek 2610 Antwerpen", "Proeflaan 34–hoek, 2610 Antwerpen"],
    // Een bus nooit.
    ["Proefstraat 12 bus 3 2000 Antwerpen", "Proefstraat 12, 2000 Antwerpen"],
    ["Proefstraat 12-12 bus 3 2000 Antwerpen", "Proefstraat 12, 2000 Antwerpen"],
    // Een bereik over (bijna) de hele straat: het bereik van de bron.
    ["Proefstraat 1-400 2000 Antwerpen", "Proefstraat 1–400, 2000 Antwerpen"],
  ];
  for (const [bron, plaats] of vormen) {
    const straat = adresZonderHuisnummer(bron);
    assert.equal(publiekParkeerAdres(bron, straat), plaats, bron);
    // Wat ooit bewaard wordt (historiek, straatbestanden, archief), houdt alleen de straat en de postcode.
    assert.equal(adresZonderHuisnummer(plaats), straat, `${plaats}: adresZonderHuisnummer`);
    assert.equal(adresAlleenStraat(plaats), straat, `${plaats}: adresAlleenStraat`);
  }
  // Geen huisnummer in de bron, of een adres dat niet klopt met de straat: niets (de kaart toont dan de straat).
  for (const bron of ["Proefstraat nvt-nvt 2000 Antwerpen", "Proefstraat Onbekend-Onbekend 2000 Antwerpen", "Proefstraat hoek-hoek 2000 Antwerpen",
    "Proefstraat 2000 Antwerpen", "Proefstraat 12-12 2000 Antwerpen Jan Voorbeeld", "Proefstraat 12-x 2000 Antwerpen", "Proefstraat 0-4 2000 Antwerpen"]) {
    assert.equal(publiekParkeerAdres(bron, adresZonderHuisnummer(bron)), "", bron);
  }
  assert.equal(publiekParkeerAdres("Anderestraat 12-12 2000 Antwerpen", "Proefstraat, 2000 Antwerpen"), "", "een andere straat dan de geschoonde");
  // Live, zoals de browser het maakt: dezelfde plaats op de kaart.
  const rijen = live(vormen.map(([bron], i) => feat(i + 1, bron, { Locatienummer: String(i + 1), Dossiernummer: `2099-0009${String(i).padStart(2, "0")}` })), vormen.map(() => P));
  assert.deepEqual(rijen.map((r) => r.location).sort(), vormen.map(([, plaats]) => plaats).sort());
});

test("vaagheid: de zin over het huisnummer van de ochtend staat in de vaste lijst, en de meter telt ze als vage plaats", () => {
  // Uit de vaste lijst (onbekendZin), zoals elke zin die zegt dat iets ontbreekt.
  assert.ok(Object.values(ONBEKEND_ZINNEN).some((z) => z.zin === ZIN_LIVE && z.kern === true), "de zin staat in site/onbekend-zinnen.js, als kernveld (waar)");
  const [rij] = lagenUitStand({ doc: ochtendDoc([ochtendVerbod("2099-000901")]) }, { vandaag: VANDAAG }).publicSpace;
  const [ochtend] = publicSpaceEntries([rij], { vandaag: VANDAAG, alle: [rij], straat: KAM.name });
  // Zoals scripts/meet-vaagheid.mjs een kaart meet: de samenvatting van de kaart (duidelijkeKaart) en die van het item. Bij
  // een parkeerverbod is dat dezelfde zin, die de kaart één keer toont: één ontbreekt-zin, niet twee.
  const meet = (e) => vaagheidVanKaart({ titel: e.title, regels: [duidelijkeKaart(e, e.item || {}, { straat: KAM.name, vandaag: VANDAAG }).samenvatting, e.summary] });
  const v = meet(ochtend);
  assert.deepEqual([v.patronen, v.kern, v.detail.ontbreekt], [["huisnummer-alleen-live"], true, 1]);
  // Live, met het huisnummer of bereik: niet vaag, en geen zin die iets mist.
  const [nu] = publicSpaceEntries(live([feat(1, "Proefstraat 12-14 2000 Antwerpen")], [P]), { vandaag: VANDAAG, straat: P.name });
  const l = meet(nu);
  assert.deepEqual([l.patronen, l.kern, l.detail.ontbreekt], [[], false, 0]);
});

test("ochtendstand in de werfkaart: de plaats zonder huisnummer, met de zin dat het huisnummer alleen live komt", () => {
  const doc = ochtendDoc([
    { id: "sgw:GW2099-000901|P1", kind: "sgw", kindLabel: "Werfzone", title: "Werfzone", location: "", start: "2099-03-12T06:00:00.000Z", end: "2099-03-12T16:00:00.000Z", status: "vergund", reference: "GW2099-000901", detail: "Fase P1", streets: [0], werfzoneStreets: [0], omleidingStreets: [] },
    ochtendVerbod("2099-000901", { werfzoneDossier: "GW2099-000901" }),
  ]);
  const rijen = lagenUitStand({ doc }, { vandaag: VANDAAG }).publicSpace;
  const [werfzone] = samenWerven(publicSpaceEntries(rijen, { vandaag: VANDAAG, alle: rijen, straat: KAM.name }), { straat: KAM.name, vandaag: VANDAAG, alle: rijen });
  assert.deepEqual(werfzone.werf?.parkeerverboden, ["2099-000901"]);
  assert.match(regel(werfzone, "Parkeerverbod"), new RegExp(`^Kammenstraat, 2000 Antwerpen: 12 mrt, van 7\\.00 tot 17\\.00 uur \\(2099-000901, [^)]+\\)\\. ${ZIN_LIVE.replace(/[.()]/g, "\\$&")} Zelfde straat`));
});

test("de markering van de ochtendstand komt nooit in een straatbestand (herschrijven uit de vorige stand)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "parkeerverbod-waar-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  maakWerkmap(root, { uitleg: { schemaVersion: 1, werken: {}, evenementen: {} } });
  fs.mkdirSync(path.join(root, "site", "straat"), { recursive: true });
  const doc = ochtendDoc([ochtendVerbod("2099-000901", { start: "2099-03-12T00:00:00.000Z", end: "2099-03-12T00:00:00.000Z" })]);
  fs.writeFileSync(path.join(root, "site", "straat", `${KAM.id}.json`), JSON.stringify(doc));
  fs.writeFileSync(path.join(root, "site", "straat-index.json"), JSON.stringify({ schemaVersion: 1, ververst: doc.ververst, lagen: {}, straten: { [KAM.id]: doc.inhoud } }));
  schrijfStraatSnapshots({ rootDir: root, herschrijf: true, agendaItems: [], siteAgenda: [], history: null, clock: () => new Date("2099-03-10T09:00:00.000Z") });
  const nieuw = fs.readFileSync(path.join(root, "site", "straat", `${KAM.id}.json`), "utf8");
  assert.doesNotMatch(nieuw, /plaatsVanDeOchtend/);
  assert.equal(JSON.parse(nieuw).publiekeRuimte.length, 1);
});

// ---------- 3. de popup van de buurtkaart: wanneer volledig ----------

test("popup van de buurtkaart: de dagen met de uren van het parkeerverbod, en 'alleen op weekdagen'", () => {
  const kaart = (extra) => publicSpaceEntry(live([feat(1, "Proefstraat 12-14 2000 Antwerpen", extra)], [P])[0]);
  const twee = tekst(popupHtml([kaart()], VANDAAG));
  assert.match(twee, /12 mrt → 13 mrt · van 8\.00 tot 18\.00 uur · Proefstraat 12–14, 2000 Antwerpen/, twee);
  const een = tekst(popupHtml([kaart({ Einddatum: ms("2099-03-12") })], VANDAAG));
  assert.match(een, /12 mrt · van 8\.00 tot 18\.00 uur · Proefstraat 12–14, 2000 Antwerpen/, een);
  assert.doesNotMatch(een, /08\.00/, "niet alleen het beginuur in een andere vorm");
  const weekdagen = tekst(popupHtml([kaart({ EnkelWeekdagen: "1", Einddatum: ms("2099-03-20") })], VANDAAG));
  assert.match(weekdagen, /12 mrt → 20 mrt · van 8\.00 tot 18\.00 uur, alleen op weekdagen · /, weekdagen);
  const heleDag = tekst(popupHtml([kaart({ Starttijd: uur(0), Eindtijd: Date.UTC(1899, 11, 30, 23, 59) })], VANDAAG));
  assert.match(heleDag, /12 mrt → 13 mrt · hele dag · /, heleDag);
  for (const t of [twee, een, weekdagen, heleDag]) assert.doesNotMatch(t, VERRAAD);
});

// ---------- 4. de ochtendstand hangt een parkeerverbod aan zijn evenement ----------

// Een agendapunt uit de evenementendossiers zoals de site het aan de plekpagina geeft (met de categorie).
const dossierPunt = (dossier, dag, title, straten) => ({
  id: `asign-ev-${dossier.toLowerCase()}-${dag}`, externalId: dossier, sourceId: "district-asign-evenementen", title, date: dag, endDate: null, location: straten.join(", "),
  straten, stratenVolledig: true, info: `Naam met de hand nagekeken bij een publieke bron. Evenementendossier ${dossier} van de stad (A-Sign).`, category: "sport",
});
const PROEFLOOP = [dossierPunt("ET2099000041", "2099-03-14", "Proefloop", [KAM.name])];
function nepAsign({ verboden }) {
  const district = { type: "Polygon", coordinates: [[[4.38, 51.2], [4.43, 51.2], [4.43, 51.24], [4.38, 51.24], [4.38, 51.2]]] };
  return async (input) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/MapServer/109/")) return Response.json({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: district }] });
    const laag = url.pathname.match(/\/P_ASign\/ASign\/MapServer\/(\d+)\/query$/)?.[1];
    if (!laag) return new Response("", { status: 404 });
    const rijen = laag === "20" ? verboden : [];
    if (url.searchParams.get("returnIdsOnly") === "true") return Response.json({ objectIds: rijen.map((r) => r.attributes.OBJECTID) });
    const velden = (url.searchParams.get("outFields") || "").split(",");
    return Response.json({ features: rijen.map((r) => ({ attributes: Object.fromEntries(velden.filter((v) => v in r.attributes).map((v) => [v, r.attributes[v]])), geometry: r.geometry })) });
  };
}
const werkmap = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "parkeerverbod-evenement-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  maakWerkmap(root, { uitleg: { schemaVersion: 1, werken: {}, evenementen: {} } });
  return root;
};
// De plekpagina van de Kammenstraat uit alleen het straatbestand, verrijkt zoals collect() (verrijkMetContext).
function ochtendKaarten(root, vandaag, agendaItems = PROEFLOOP) {
  const doc = JSON.parse(fs.readFileSync(path.join(root, "site", "straat", `${KAM.id}.json`), "utf8"));
  const rijen = lagenUitStand({ doc }, { vandaag }).publicSpace;
  const hier = rijen.filter((r) => (r.streets || []).some((s) => s.id === KAM.id));
  const kaarten = samenWerven([...werkEntries([], { vandaag }), ...publicSpaceEntries(hier, { vandaag, alle: rijen, straat: KAM.name, agendaItems })], { straat: KAM.name, vandaag, alle: rijen });
  return { doc, kaarten: verrijkMetContext(kaarten, { straat: KAM.name, vandaag, agendaItems }) };
}
const EVENEMENT_REGEL = /^Proefloop \(A-Sign, dossier ET2099000041\): het enige evenement in deze straat op die dag\. A-Sign zet bij een parkeerverbod geen dossiernummer\.$/;

test("ochtendstand na een verversing: het parkeerverbod voor een evenement hangt aan dat evenement, zonder reden in het bestand", async (t) => {
  const [x1, y1, x2, y2] = [4.40025, 51.21571, 4.40208, 51.21878]; // langs de Kammenstraat
  const verbod = (oid, dossier, reden) => ({ attributes: { ...feat(1, "Kammenstraat 999-999 2000 Antwerpen", { Dossiernummer: dossier, Reden: reden, Startdatum: ms("2099-03-14"), Einddatum: ms("2099-03-14") }).attributes, OBJECTID: oid }, geometry: { paths: [[[x1, y1], [x2, y2]]] } });
  const nep = nepAsign({ verboden: [verbod(1, "2099-000941", EVENEMENT), verbod(2, "2099-000942", "Aanvraag tot een verhuis met of zonder ladderlift, verhuiswagen")] });
  const resultaat = await fetchPublicSpaceHistory({ fetch: nep, clock: () => new Date("2099-03-10T04:00:00Z"), streets: null });
  assert.equal(resultaat.ok, true, JSON.stringify(resultaat));
  const root = werkmap(t);
  const straatAs = { type: "Feature", properties: { LSTRNMID: Number(KAM.id), LSTRNM: KAM.name, RSTRNMID: Number(KAM.id), RSTRNM: KAM.name, postcode: 2000, DISTRICT: "Antwerpen" }, geometry: { type: "LineString", coordinates: [[x1, y1], [x2, y2]] } };
  const bronnen = await verzamelStraatBronnen({ rootDir: root, observedAt: "2099-03-10T04:22:00.000Z", worksResult: { ok: true, items: [] }, publicSpaceResult: resultaat, streetFeatures: [straatAs], siteAgenda: PROEFLOOP });
  assert.doesNotMatch(fs.readFileSync(path.join(root, ".cache", "straat-bronnen.json"), "utf8"), /"reason"|evenementen gesteund|verhuis/i);
  schrijfStraatSnapshots({ rootDir: root, bronnen, agendaItems: [], siteAgenda: PROEFLOOP, history: null, clock: () => new Date("2099-03-10T09:00:00.000Z") });
  const { doc, kaarten } = ochtendKaarten(root, "2099-03-10");
  assert.doesNotMatch(JSON.stringify(doc), /"reason"|evenementen gesteund|verhuis/i, "de reden staat nergens in het straatbestand");
  assert.deepEqual(doc.publiekeRuimte.filter((i) => i.kind === "parking").map((i) => [i.reference, i.title, i.evenementSleutel ?? null]).sort(),
    [["2099-000941", "Parkeerverbod", "ET2099000041"], ["2099-000942", "Parkeerverbod", null]]);
  assert.deepEqual(straatBestandenProblemen(root), []);
  // De plekpagina uit het straatbestand: het parkeerverbod voor het evenement zegt welk; dat voor de verhuis niet.
  const metEvenement = kaarten.find((e) => e.item?.reference === "2099-000941");
  const zonder = kaarten.find((e) => e.item?.reference === "2099-000942");
  assert.match(regel(metEvenement, "Evenement"), EVENEMENT_REGEL);
  assert.equal(metEvenement.evenementSleutel, "ET2099000041");
  assert.equal(regel(zonder, "Evenement"), "");
  for (const e of [metEvenement, zonder]) {
    assert.equal(e.title, "Parkeerverbod");
    assert.doesNotMatch(zichtbaar(e, KAM.name), VERRAAD);
  }
});

test("ochtendstand: zonder bewaarde sleutel nooit een evenement, en een sleutel telt alleen als de browser hetzelfde beslist", () => {
  const kaart = (extra) => {
    const rijen = lagenUitStand({ doc: ochtendDoc([ochtendVerbod("2099-000941", { start: "2099-03-14T00:00:00.000Z", end: "2099-03-14T00:00:00.000Z", ...extra })]) }, { vandaag: "2099-03-10" }).publicSpace;
    return verrijkMetContext(publicSpaceEntries(rijen, { vandaag: "2099-03-10", alle: rijen, straat: KAM.name }), { straat: KAM.name, vandaag: "2099-03-10", agendaItems: PROEFLOOP })[0];
  };
  assert.match(regel(kaart({ evenementSleutel: "ET2099000041" }), "Evenement"), EVENEMENT_REGEL);
  // Zonder sleutel (een parkeerverbod voor iets anders): ook op de dag van het enige evenement in de straat niet.
  assert.equal(regel(kaart({}), "Evenement"), "");
  // Een sleutel van een ander evenement dan dat van de beslissing: niet raden.
  assert.equal(regel(kaart({ evenementSleutel: "ET2099000099" }), "Evenement"), "");
  // Een tweede evenement die dag: geen beslissing, ook niet met de sleutel van de verversing.
  const twee = [...PROEFLOOP, dossierPunt("ET2099000042", "2099-03-14", "Tweede proef", [KAM.name])];
  const rijen = lagenUitStand({ doc: ochtendDoc([ochtendVerbod("2099-000941", { start: "2099-03-14T00:00:00.000Z", end: "2099-03-14T00:00:00.000Z", evenementSleutel: "ET2099000041" })]) }, { vandaag: "2099-03-10" }).publicSpace;
  const [p] = verrijkMetContext(publicSpaceEntries(rijen, { vandaag: "2099-03-10", alle: rijen, straat: KAM.name }), { straat: KAM.name, vandaag: "2099-03-10", agendaItems: twee });
  assert.equal(regel(p, "Evenement"), "");
});

test("ochtendstand uit een straatbestand van vóór 18 oktober (de reden als titel): herschreven zonder reden, met het evenement", (t) => {
  const root = werkmap(t);
  fs.mkdirSync(path.join(root, "site", "straat"), { recursive: true });
  const dag = { start: "2099-03-14T00:00:00.000Z", end: "2099-03-14T00:00:00.000Z" };
  const oud = ochtendDoc([
    ochtendVerbod("2099-000941", { title: EVENEMENT, reason: EVENEMENT, ...dag }),
    // De andere plaats van hetzelfde parkeerverbod (een bundelrij), toen nog met de reden.
    { id: "parking:2099-000941|2|bundel", kind: "parking", reference: "2099-000941", ...dag, startTime: "07:00", endTime: "17:00", weekdaysOnly: false, reason: EVENEMENT, title: EVENEMENT, streets: [1], bundel: true },
    ochtendVerbod("2099-000942", { title: "Verhuis", reason: "Verhuis", ...dag }),
  ]);
  fs.writeFileSync(path.join(root, "site", "straat", `${KAM.id}.json`), JSON.stringify(oud));
  fs.writeFileSync(path.join(root, "site", "straat-index.json"), JSON.stringify({ schemaVersion: 1, ververst: oud.ververst, lagen: {}, straten: { [KAM.id]: oud.inhoud } }));
  const agenda = [dossierPunt("ET2099000041", "2099-03-14", "Proefloop", [KAM.name, PET.name])];
  schrijfStraatSnapshots({ rootDir: root, herschrijf: true, agendaItems: [], siteAgenda: agenda, history: null, clock: () => new Date("2099-03-10T09:00:00.000Z") });
  const { doc, kaarten } = ochtendKaarten(root, "2099-03-10", agenda);
  assert.doesNotMatch(JSON.stringify(doc), /"reason"|evenementen gesteund|verhuis/i);
  assert.deepEqual(doc.publiekeRuimte.filter((i) => i.kind === "parking").map((i) => [i.id, i.title, i.evenementSleutel ?? null]),
    [["parking:2099-000941|1", "Parkeerverbod", "ET2099000041"], ["parking:2099-000941|2|bundel", "Parkeerverbod", "ET2099000041"], ["parking:2099-000942|1", "Parkeerverbod", null]]);
  assert.deepEqual(straatBestandenProblemen(root), []);
  const p = kaarten.find((e) => e.item?.reference === "2099-000941");
  assert.match(regel(p, "Evenement"), /^Proefloop \(A-Sign, dossier ET2099000041\): het enige evenement in deze straten op die dag\./);
  assert.equal(regel(kaarten.find((e) => e.item?.reference === "2099-000942"), "Evenement"), "");
  // Nog eens herschrijven verandert niets meer.
  const tekst1 = fs.readFileSync(path.join(root, "site", "straat", `${KAM.id}.json`), "utf8");
  schrijfStraatSnapshots({ rootDir: root, herschrijf: true, agendaItems: [], siteAgenda: agenda, history: null, clock: () => new Date("2099-03-10T09:00:00.000Z") });
  assert.equal(fs.readFileSync(path.join(root, "site", "straat", `${KAM.id}.json`), "utf8"), tekst1);
});

test("evenementSleutel: alleen een dossier of agendapunt, alleen bij een parkeerverbod; nooit vrije tekst in een straatbestand", (t) => {
  const item = itemVoorStraat({ ...ochtendVerbod("2099-000941"), streets: [{ id: KAM.id, name: KAM.name, postcode: KAM.postcode }] });
  assert.ok(item);
  // De vorm van een echte agenda-id, per bron zoals de bouwer ze maakt (verzonnen nummers en hashes): de dag van het punt
  // op het einde, eventueel een tweede dag en een korte hash of een uur.
  const ECHTE_VORMEN = [
    "agenda:asign-ev-et2099000041-2099-03-14", "agenda:district-kal-0a1b2c3d4e5f60718293a4b5-2099-03-14",
    "agenda:district-kal-0a1b2c3d4e5f60718293a4b5-b1-2099-03-14", "agenda:district-news-0a1b2c3d4e5f60718293a4b5-2099-03-14",
    "agenda:stad-news-merksem-0a1b2c3d4e5f60718293a4b5-t1r0-2099-03-14", "agenda:ebesluit-ev-2099-dcan-00041-2099-03-14",
    "agenda:ebesluit-2099-dcan-00002-2099-03-14-0a1b2c3d", "agenda:markt-ma24-2099-03-14", "agenda:koopzondag-2099-03-14",
    "agenda:foor-proeffoor-2099-03-14", "agenda:gipod-event-990001-2099-03-14", "agenda:mail-0a1b2c3d4e5f6071-2099-03-14",
    "agenda:uit-0a1b2c3d-1111-2222-3333-444455556666-2099-03-14-1930", "agenda:project-0a1b2c3d4e5f60718293a4b5-fase-4b-2099-03-14",
    // site/agenda.js: de titel en de dag, soms een tweede dag en een korte hash.
    "agenda:proefloop-2099-03-14", "agenda:proefloop-2099-03-14-2099-03-15-1a2b3c4d", "agenda:district-kalender-proefloop-2099-03-14",
  ];
  for (const goed of ["ET2099000041", ...ECHTE_VORMEN]) {
    assert.equal(itemVoorStraat({ ...item, evenementSleutel: goed })?.evenementSleutel, goed, goed);
  }
  // Nakijkronde van 18 oktober 2026: na "agenda:" mocht elke slug, ook een met de reden. Nu alleen de vorm van een echte
  // agenda-id: zonder dag op het einde, met hoofdletters, een spatie, een punt, een liggend streepje of twee streepjes na
  // elkaar, langer dan 120 tekens, of met iets na de dag (geen hash) valt de sleutel weg.
  const VALSE_AGENDA = [
    "agenda:verhuis-fam-proefmans-0470998877", "agenda:verhuisxyz-container", "agenda:proefloop-2099-03-14-verhuis",
    "agenda:Proefloop-2099-03-14", "agenda:proef_loop-2099-03-14", "agenda:proef.loop-2099-03-14", "agenda:proef--loop-2099-03-14",
    "agenda:proefloop 2099-03-14", "agenda:proefloop-2099-13-14", "agenda:2099-03-14", "agenda:-proefloop-2099-03-14",
    `agenda:${"proef-".repeat(19)}2099-03-14`, "AGENDA:proefloop-2099-03-14", "et2099000041", "ET20990000411",
    // Een vergadering of een schoolstraat heeft geen dag in de id: nooit het evenement van een parkeerverbod.
    "agenda:district-vergadering-ebesluit-99-0001-0002-0003", "agenda:schoolstraat-schoolstr001-2099",
  ];
  for (const fout of ["Proefloop", "evenement", "ET123", "agenda:Proefloop voor de verhuis van Jan", "", ...VALSE_AGENDA]) {
    const schoon = itemVoorStraat({ ...item, evenementSleutel: fout });
    assert.ok(schoon, fout);
    assert.equal("evenementSleutel" in schoon, false, fout);
  }
  assert.equal("evenementSleutel" in (itemVoorStraat({ id: "sgw:GW2099-000901|1", kind: "sgw", title: "Werfzone", reference: "GW2099-000901", start: "2099-03-08T06:00:00.000Z", end: "2099-03-20T16:00:00.000Z", streets: [], evenementSleutel: "ET2099000041" }) || {}), false);
  const root = werkmap(t);
  fs.mkdirSync(path.join(root, "site", "straat"), { recursive: true });
  const doc = ochtendDoc([
    ochtendVerbod("2099-000941", { evenementSleutel: "ET2099000041" }),
    ochtendVerbod("2099-000942", { evenementSleutel: "Feest bij de buren" }),
    // validate-data (de laatste poort) meldt ook een slug die niet de vorm van een agenda-id heeft, zonder de waarde.
    ochtendVerbod("2099-000943", { evenementSleutel: "agenda:verhuisxyz-container" }),
    ochtendVerbod("2099-000944", { evenementSleutel: "agenda:verhuis-fam-proefmans-0470998877" }),
    ochtendVerbod("2099-000945", { evenementSleutel: "agenda:proefloop-2099-03-14" }),
  ]);
  fs.writeFileSync(path.join(root, "site", "straat", `${KAM.id}.json`), JSON.stringify(doc));
  fs.writeFileSync(path.join(root, "site", "straat-index.json"), JSON.stringify({ schemaVersion: 1, ververst: doc.ververst, lagen: {}, straten: { [KAM.id]: doc.inhoud } }));
  const problemen = straatBestandenProblemen(root).filter((p) => /evenementSleutel/.test(p));
  assert.deepEqual(problemen, [1, 2, 3].map((i) => `site/straat/${KAM.id}.json: evenementSleutel geen sleutel van een evenement bij een parkeerverbod op $.publiekeRuimte[${i}]`));
  assert.ok(problemen.every((p) => !/buren|verhuis|proefmans|0470/i.test(p)), "de melding noemt nooit de waarde");
});

// ---------- 5. de lijsten op de startpagina: waar exact en wanneer, zoals de kaart ----------

const groepVan = (groepen, naam) => groepen.find((g) => g.street.name === naam);

test("Alles per straat op de startpagina: elk parkeerverbod met zijn plaats exact en zijn uren, ook alleen op weekdagen", () => {
  // Twee parkeerverboden op dezelfde plaats en uren; één alleen op weekdagen (A-Sign EnkelWeekdagen).
  const rijen = live([feat(1, "Proefstraat 12-14 2000 Antwerpen", { Dossiernummer: "2099-000901", EnkelWeekdagen: "1" }), feat(1, "Proefstraat 12-14 2000 Antwerpen", { Dossiernummer: "2099-000902" })], [P, P]);
  const groepen = buildStreetGroups({ publicSpace: rijen });
  assert.deepEqual(groepVan(groepen, P.name).parking.map((i) => [i.title, i.detail]), [
    ["Parkeerverbod", "Proefstraat 12–14, 2000 Antwerpen · Niet parkeren van 8.00 tot 18.00 uur, alleen op weekdagen."],
    ["Parkeerverbod", "Proefstraat 12–14, 2000 Antwerpen · Niet parkeren van 8.00 tot 18.00 uur."],
  ]);
  // De hele dag, en zonder uren in A-Sign: dat zegt de regel ook.
  const heleDag = live([feat(1, "Proefstraat 30-32 2000 Antwerpen", { Starttijd: uur(0), Eindtijd: Date.UTC(1899, 11, 30, 23, 59) })], [P]);
  assert.equal(buildStreetGroups({ publicSpace: heleDag })[0].parking[0].detail, "Proefstraat 30–32, 2000 Antwerpen · Niet parkeren, de hele dag.");
  assert.doesNotMatch(JSON.stringify(groepen), VERRAAD);
});

test("Alles per straat uit de ochtendstand: elke straat met haar plaats, en dat het huisnummer alleen live komt", () => {
  // Het straatbestand van de Kammenstraat: de eigen rij, en een bundelrij met de andere straten van hetzelfde parkeerverbod.
  const doc = ochtendDoc([
    ochtendVerbod("2099-000901", { detail: "Alleen op weekdagen", weekdaysOnly: true }),
    { id: "parking:2099-000901|2|bundel", kind: "parking", reference: "2099-000901", start: "2099-03-12T00:00:00.000Z", end: "2099-03-12T00:00:00.000Z", startTime: "07:00", endTime: "17:00", weekdaysOnly: true, title: "Parkeerverbod", streets: [1, 2], bundel: true },
  ], { straten: [[KAM.id, KAM.name, KAM.postcode], [PET.id, PET.name, PET.postcode], [HUIK.id, HUIK.name, HUIK.postcode]] });
  const rijen = lagenUitStand({ doc }, { vandaag: VANDAAG }).publicSpace;
  const groepen = buildStreetGroups({ publicSpace: rijen });
  const zin = `Niet parkeren van 7.00 tot 17.00 uur, alleen op weekdagen. ${ZIN_LIVE}`;
  assert.deepEqual(groepVan(groepen, KAM.name).parking.map((i) => i.detail), [`Kammenstraat, 2000 Antwerpen · ${zin}`]);
  assert.deepEqual(groepVan(groepen, PET.name).parking.map((i) => i.detail), [`Peterseliestraat, 2000 Antwerpen · ${zin}`]);
  assert.deepEqual(groepVan(groepen, HUIK.name).parking.map((i) => i.detail), [`Huikstraat, 2000 Antwerpen · ${zin}`]);
  assert.doesNotMatch(JSON.stringify(groepen), VERRAAD);
});

test("de vooruitblik op de startpagina: een parkeerverbod met zijn dagen en uren, niet alleen de begindag", () => {
  const [rij] = live([feat(1, "Proefstraat 12-14 2000 Antwerpen", { EnkelWeekdagen: "1" })], [P]);
  const [item] = buildWeekPulse({ fromDay: "2099-03-10", toDay: "2099-03-16", publicSpace: [rij] }).upcoming;
  assert.deepEqual([item.title, item.location, item.wanneer], ["Parkeerverbod", "Proefstraat 12–14, 2000 Antwerpen", "12–13 mrt · Niet parkeren van 8.00 tot 18.00 uur, alleen op weekdagen."]);
  // Uit de ochtendstand: ook dat het huisnummer alleen live komt.
  const [ochtend] = lagenUitStand({ doc: ochtendDoc([ochtendVerbod("2099-000901")]) }, { vandaag: VANDAAG }).publicSpace;
  const [o] = buildWeekPulse({ fromDay: "2099-03-10", toDay: "2099-03-16", publicSpace: [ochtend] }).upcoming;
  assert.deepEqual([o.location, o.wanneer], ["Kammenstraat, 2000 Antwerpen", `12 mrt · Niet parkeren van 7.00 tot 17.00 uur. ${ZIN_LIVE}`]);
  assert.doesNotMatch(JSON.stringify([item, o]), VERRAAD);
});
