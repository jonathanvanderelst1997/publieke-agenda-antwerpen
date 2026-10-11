// Snelheid (P5): de straatbestanden (scripts/build-straat-snapshots.mjs), de radar en wat de browser ermee
// doet (site/straat-snapshot.js). Verzonnen items (tests/helpers/straat-fixture.mjs). Faalt op de basistak:
// daar bestaan de bouwer, site/straat-snapshot.js en radar.json niet, en vraagt de voorpagina live-layers.json.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  MAX_RADAR_BYTES, MAX_STRAAT_BYTES, RADAR_BESTAND, STRAAT_INDEX, bouwRadar, itemVoorStraat, radarBinnenBudget, straatBestandenProblemen, verzamelStraatBronnen,
} from "../scripts/build-straat-snapshots.mjs";
import { kaderRond, laadStraat, lagenUitStand, aanvullenMetOchtend, metStratenVanDeOchtend, standZin, straatItems, tijdstipTekst, verschil } from "../site/straat-snapshot.js";
import { buildStreetGroups, historiekUitRadar } from "../site/street-overview.js";
import { terrasEntries } from "../site/place-core.js";
import { vergunningBronUrl } from "../site/permits-live-core.js";
import { evenementFeiten, evenementKaartje } from "../site/kaart-uitleg.js";
import { splitsOpOnderzoek } from "../site/inzage-status.js";
import { createAreaMatcher } from "../site/neighborhood-map.js";
import { pandnummerStukken, straatIndexStand, straatItemPrivacy, zonderPandnummers } from "../lib/straat-bestanden.mjs";
import { checkHealth } from "../scripts/sources-health.mjs";
import { fetchPublicSpaceHistory } from "../scripts/refresh-live-history.mjs";
import { HUIK, KAM, NU, PET, VERVERST, WERK_TITEL, bouw, evenementFase, maakWerkmap, repoRoot, schoneBronnen, werk } from "./helpers/straat-fixture.mjs";

function werkmap(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "straat-snapshots-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  maakWerkmap(root);
  return root;
}
const lees = (root, rel) => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
const alleTekst = (root) => fs.readdirSync(path.join(root, "site", "straat")).map((naam) => fs.readFileSync(path.join(root, "site", "straat", naam), "utf8")).join("\n") + fs.readFileSync(path.join(root, STRAAT_INDEX), "utf8");

test("de bouwer schrijft per straat met items één klein bestand en een index met de hash", async (t) => {
  const root = werkmap(t);
  const uitslag = await bouw(root);
  const index = lees(root, STRAAT_INDEX);
  // Kammenstraat (alles), Peterseliestraat (het parcours) en Huikstraat (een straat van het parcours volgens kaart-uitleg).
  assert.deepEqual(Object.keys(index.straten).sort(), [HUIK.id, KAM.id, PET.id].sort());
  assert.deepEqual(fs.readdirSync(path.join(root, "site", "straat")).sort(), [`${HUIK.id}.json`, `${KAM.id}.json`, `${PET.id}.json`].sort());
  assert.equal(index.ververst, VERVERST);
  assert.equal(uitslag.straten, 3);
  for (const id of Object.keys(index.straten)) {
    const tekst = fs.readFileSync(path.join(root, "site", "straat", `${id}.json`), "utf8");
    assert.ok(Buffer.byteLength(tekst) < MAX_STRAAT_BYTES, `${id}: ${Buffer.byteLength(tekst)} bytes`);
    assert.equal(JSON.parse(tekst).inhoud, index.straten[id]);
    assert.equal(JSON.parse(tekst).ververst, VERVERST, "het tijdstip van de verversing staat in het bestand");
  }
  const kam = lees(root, `site/straat/${KAM.id}.json`);
  assert.deepEqual(kam.straat, { id: KAM.id, namen: [{ name: KAM.name, postcode: KAM.postcode }] });
  // Publieke ruimte: het parkeerverbod, de inname en de rij van het evenement (die al zijn hele fase geeft:
  // geen samenvatting nodig).
  assert.deepEqual([kam.werken.length, kam.publiekeRuimte.length, kam.vergunningen.length, kam.terrassen.length, kam.evenementen.length], [1, 3, 1, 3, 1]);
  // Het agendapunt dat al voorbij is, staat er niet in.
  assert.deepEqual(kam.evenementen.map((e) => e.id), ["proef-buurtfeest-2099-03-15"]);
  // Het kader: de straat en wat eraan hangt, afgerond op 0,001°.
  assert.deepEqual(kam.kader, [4.4, 51.215, 4.403, 51.219]);
  assert.deepEqual(straatBestandenProblemen(root), []);
});

test("privacy: geen huisnummer, geen naam, geen vrije beschrijving, geen adres of plek, geen e-mail", async (t) => {
  const root = werkmap(t);
  await bouw(root);
  const tekst = alleTekst(root);
  for (const verboden of ["Proefstraat 12", "12-14", "Proefstraat 5", "Proefstraat 9", "Jan Voorbeeld", "0470", "proef@", "Proef Persoon", "creator", "\"point\"", "\"vorm\"", "\"description\"", "\"aanvrager\"", "__kader", "__straten"]) {
    assert.equal(tekst.includes(verboden), false, `"${verboden}" staat in een straatbestand`);
  }
  // Dezelfde grep als de gitleaks-regel huisnummer-bij-straat.
  assert.doesNotMatch(tekst, /\p{Lu}[\p{L}'-]*(?:straat|laan|lei|plein|weg|kaai|vest|markt)[ \t]+[1-9][0-9]{0,3}/u);
  const kam = lees(root, `site/straat/${KAM.id}.json`);
  assert.equal(kam.werken[0].title, `2000 Antwerpen, Proefstraat - ${WERK_TITEL}`);
  assert.equal(kam.publiekeRuimte.find((i) => i.kind === "parking").location, "Proefstraat, 2000 Antwerpen");
  assert.equal(kam.publiekeRuimte.some((i) => /voorbeeld/i.test(JSON.stringify(i))), false, "het item met een e-mailadres valt weg");
  // Elk item afzonderlijk: een item met iets privé erin wordt null, niet half opgekuist.
  assert.equal(itemVoorStraat({ id: "x", title: "Bel 0470 12 34 56" }), null); // verzonnen nummer
  assert.deepEqual(Object.keys(itemVoorStraat({ id: "y", title: "Werk", creator: "a", assignee: "b", lockOwner: "c", dossierBeheerder: "d" })).sort(), ["id", "title"]);
});

test("de browser leest een straatbestand terug als dezelfde items als de live lagen", async (t) => {
  const root = werkmap(t);
  await bouw(root);
  const doc = lees(root, `site/straat/${KAM.id}.json`);
  const lagen = lagenUitStand({ doc });
  assert.deepEqual(Object.keys(lagen).sort(), ["permits", "publicSpace", "terraces", "works"]);
  const parkeer = lagen.publicSpace.find((i) => i.kind === "parking");
  assert.deepEqual(parkeer.streets, [KAM]);
  assert.equal(parkeer.sourceUrl, "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/20");
  assert.equal(parkeer.sourceLabel, "A-Sign parkeerverboden");
  assert.equal(parkeer.startTime, "07:00");
  assert.equal(lagen.works[0].id, "work:990001");
  assert.equal(lagen.works[0].streetResolution, "nearest_official_axis", "kaart-uitleg.js gebruikt dit veld voor werken");
  assert.equal(lagen.permits[0].sourceUrl, vergunningBronUrl("20990001", "OMV_2099000001"));
  // Twee terraszones op hetzelfde adres blijven één terras, zonder dat het adres in het bestand staat.
  assert.ok(lagen.terraces.every((i) => i.address === ""));
  assert.equal(terrasEntries(lagen.terraces).length, 2);
  // Een evenementendossier dat de verversing kent: in de Huikstraat één rij, voor één kaart.
  const huik = lagenUitStand({ doc: lees(root, `site/straat/${HUIK.id}.json`) });
  assert.deepEqual(huik.publicSpace.map((i) => i.reference), ["ET2099000001"]);
});

test("een laag die niet laadt of verdacht krimpt, houdt de vorige stand; ongewijzigd wordt niet herschreven", async (t) => {
  const root = werkmap(t);
  await bouw(root);
  const voor = fs.readFileSync(path.join(root, "site", "straat", `${KAM.id}.json`), "utf8");
  const tweede = await bouw(root, { nu: new Date("2099-03-10T10:00:00Z") });
  assert.equal(tweede.geschreven, 0);
  assert.equal(tweede.ongewijzigd, 3);
  // Werken laden niet: de vorige werken blijven, de index zegt "stale" met het tijdstip van toen.
  const zonderWerken = await schoneBronnen();
  zonderWerken.ververst = "2099-03-11T04:22:00.000Z";
  zonderWerken.lagen.werken = { ok: false, items: [], errorCode: "http_500" };
  await bouw(root, { bronnenDoc: zonderWerken, nu: new Date("2099-03-11T09:00:00Z") });
  let index = lees(root, STRAAT_INDEX);
  assert.equal(index.lagen.werken.status, "stale");
  assert.equal(index.lagen.werken.sinds, VERVERST);
  assert.equal(index.lagen.werken.errorCode, "http_500");
  assert.equal(fs.readFileSync(path.join(root, "site", "straat", `${KAM.id}.json`), "utf8"), voor, "de inhoud verandert niet");
  // Een krimp van 30 naar 1 werk: verdacht, de vorige stand blijft.
  const veel = await schoneBronnen({ werken: Array.from({ length: 30 }, (_, i) => werk(990100 + i)) });
  await bouw(root, { bronnenDoc: veel });
  const weinig = await schoneBronnen({ werken: [werk(990100)] });
  await bouw(root, { bronnenDoc: weinig });
  index = lees(root, STRAAT_INDEX);
  assert.equal(index.lagen.werken.errorCode, "suspicious_drop");
  assert.equal(lees(root, `site/straat/${KAM.id}.json`).werken.length, 30);
  // Zonder bronnen (de verversing van de live lagen faalde helemaal): alles blijft, niets herschreven.
  const zonder = await bouw(root, { bronnenDoc: null });
  assert.equal(zonder.geschreven, 0);
  assert.deepEqual(straatBestandenProblemen(root), []);
});

test("een straat zonder items verliest haar bestand; een verlopen item valt weg", async (t) => {
  const root = werkmap(t);
  await bouw(root);
  const leeg = await schoneBronnen({ werken: [] });
  for (const naam of ["publiekeRuimte", "vergunningen", "terrassen"]) leeg.lagen[naam].items = [];
  // Na het buurtfeest: geen agendapunt meer, dus de Kammenstraat is leeg.
  const uitslag = await bouw(root, { bronnenDoc: leeg, nu: new Date("2099-03-20T09:00:00Z") });
  assert.equal(uitslag.straten, 0);
  assert.equal(uitslag.weg, 3);
  assert.deepEqual(fs.readdirSync(path.join(root, "site", "straat")), []);
  assert.deepEqual(lees(root, STRAAT_INDEX).straten, {});
});

test("verzamelStraatBronnen: zonder eigen fetch geen vergunningen en terrassen, wel werken; nooit punt of vorm", async (t) => {
  const root = werkmap(t);
  const bronnen = await verzamelStraatBronnen({ rootDir: root, observedAt: VERVERST, worksResult: { ok: true, items: [werk()] }, publicSpaceResult: { ok: false, errorCode: "http_500" }, streetFeatures: [{ type: "Feature", properties: { LSTRNMID: 1416, LSTRNM: "Kammenstraat", RSTRNMID: 1416, RSTRNM: "Kammenstraat", postcode: 2000, DISTRICT: "Antwerpen" }, geometry: { type: "LineString", coordinates: [[4.40025, 51.21571], [4.40208, 51.21878]] } }] });
  assert.equal(bronnen.lagen.werken.ok, true);
  assert.equal(bronnen.lagen.werken.items.length, 1);
  assert.equal("point" in bronnen.lagen.werken.items[0], false);
  assert.ok(Array.isArray(bronnen.lagen.werken.items[0].__kader), "het kader van het werk, alleen voor het kader van de straat");
  assert.equal(bronnen.lagen.publiekeRuimte.errorCode, "http_500");
  assert.equal(bronnen.lagen.vergunningen.errorCode, "niet_opgehaald");
  assert.ok(fs.existsSync(path.join(root, ".cache", "straat-bronnen.json")));
  const gitignore = fs.readFileSync(path.join(repoRoot, ".gitignore"), "utf8");
  assert.match(gitignore, /^\.cache\/$/m, "het tussenbestand gaat nooit mee in een commit");
});

test("radar.json: dezelfde wijzigingen per straat als live-layers.json", async () => {
  const h = (straat, id, type, observedAt) => ({ observedAt, layer: "publicSpace", id, type, fields: [], before: null, after: { id, streets: [straat] } });
  const nu = Date.now(), dag = 86_400_000, iso = (t) => new Date(t).toISOString();
  const history = {
    observedAt: iso(nu - dag / 2),
    layers: { works: { status: "ok", items: [] }, publicSpace: { status: "ok", items: [{ id: "parking:a", kind: "parking", streets: [KAM] }] } },
    changes: [h(KAM, "parking:a", "added", iso(nu - 3 * dag)), h(KAM, "parking:b", "removed", iso(nu - dag / 2)), h(PET, "parking:c", "changed", iso(nu - dag / 2)), h(PET, "parking:d", "added", iso(nu - 9 * dag))],
  };
  const radar = bouwRadar(history);
  assert.deepEqual(Object.keys(radar.straten).sort(), [`${KAM.id}|${KAM.name}|${KAM.postcode}`, `${PET.id}|${PET.name}|${PET.postcode}`]);
  const publicSpace = [{ id: "parking:a", kind: "parking", title: "Verhuis", streets: [KAM] }, { id: "parking:x", kind: "parking", title: "Verhuis", streets: [PET] }];
  const tel = (hist) => buildStreetGroups({ publicSpace, history: hist }).map((g) => [g.street.name, g.changes.length, g.changes.filter((c) => c.observedAt === history.observedAt).map((c) => c.type).sort().join(",")]);
  assert.deepEqual(tel(historiekUitRadar(radar)), tel(history));
  assert.deepEqual(tel(historiekUitRadar(radar)), [["Kammenstraat", 2, "removed"], ["Peterseliestraat", 1, "changed"]]);
  // Geen toets op de grootte van de radar uit de echte historiek: die hangt af van de drukte van de week en
  // liep elke ochtend in `npm run check` (een drukke week maakte de verversing rood). Het budget toetsen de
  // twee toetsen hieronder, op het bestand dat de bouwer schrijft.
});

// Een verzonnen historiek: `straten` straten (Proef…straat, verzonnen), elk met één wijziging per verversing.
function drukkeHistoriek({ straten, runs }) {
  const letters = (i) => i.toString(26).split("").map((c) => String.fromCharCode(97 + parseInt(c, 26))).join("");
  const refs = Array.from({ length: straten }, (_, i) => ({ id: String(900000 + i), name: `Proef${letters(i)}straat`, postcode: "2000" }));
  const observedAt = runs.at(-1);
  const changes = runs.flatMap((run) => refs.map((ref, i) => ({ observedAt: run, layer: "publicSpace", id: `parking:proef-${i}-${run}`, type: "changed", fields: ["end"], before: null, after: { id: `parking:proef-${i}-${run}`, streets: [ref] } })));
  return { observedAt, layers: { works: { status: "ok", items: [] }, publicSpace: { status: "ok", items: [] } }, changes };
}

test("radar.json: een drukke week (twee verversingen per dag) past in het budget, de laatste verversing blijft heel", async (t) => {
  const root = werkmap(t);
  const nu = Date.parse("2099-03-10T04:22:00Z"), dag = 86_400_000;
  const runs = Array.from({ length: 14 }, (_, i) => new Date(nu - (13 - i) * dag / 2).toISOString());
  const history = drukkeHistoriek({ straten: 420, runs });
  assert.ok(Buffer.byteLength(JSON.stringify(bouwRadar(history))) > MAX_RADAR_BYTES, "zonder inkorten te groot");
  const uitslag = await bouw(root, { history });
  assert.ok(uitslag.radarBytes <= MAX_RADAR_BYTES, `${uitslag.radarBytes} bytes`);
  assert.equal(fs.statSync(path.join(root, RADAR_BESTAND)).size, uitslag.radarBytes);
  const radar = lees(root, RADAR_BESTAND);
  assert.equal(radar.ingekort, true);
  assert.equal(radar.runs.at(-1), runs.at(-1));
  assert.equal(Object.keys(radar.straten).length, 420, "elke straat met een wijziging blijft");
  assert.deepEqual(straatBestandenProblemen(root), []);
});

test("radar.json: ook een verversing die bijna elke straat raakt, past in het budget (validate-data blijft groen)", async (t) => {
  const root = werkmap(t);
  const runs = ["2099-03-09T16:22:00.000Z", "2099-03-10T04:22:00.000Z"];
  const history = drukkeHistoriek({ straten: 2500, runs });
  const uitslag = await bouw(root, { history });
  assert.ok(uitslag.radarBytes <= MAX_RADAR_BYTES, `${uitslag.radarBytes} bytes`);
  const radar = lees(root, RADAR_BESTAND);
  assert.equal(radar.ingekort, true);
  assert.deepEqual(radar.runs, [runs[1]], "alleen de laatste verversing");
  assert.ok(radar.weggelaten > 0 && Object.keys(radar.straten).length + radar.weggelaten === 2500);
  assert.deepEqual(straatBestandenProblemen(root), []);
  // Hetzelfde zonder bouwer.
  assert.ok(Buffer.byteLength(`${JSON.stringify(radarBinnenBudget(history))}\n`) <= MAX_RADAR_BYTES);
});

test("straatbestanden en radar in de repo (na een verversing): elk onder het budget en zonder privacyvondst", () => {
  assert.deepEqual(straatBestandenProblemen(repoRoot), []);
});

test("laadStraat vraagt de index en dan het bestand met de hash in de URL; zonder index: geen stand", async (t) => {
  const root = werkmap(t);
  await bouw(root);
  const gevraagd = [];
  const nep = async (url, opties = {}) => {
    gevraagd.push([String(url), opties.cache || ""]);
    const pad = new URL(String(url), "http://x").pathname;
    const bestand = path.join(root, "site", pad);
    return fs.existsSync(bestand) ? new Response(fs.readFileSync(bestand), { status: 200 }) : new Response("<!doctype html>", { status: 200 });
  };
  const stand = await laadStraat(KAM.id, { fetch: nep });
  const hash = lees(root, STRAAT_INDEX).straten[KAM.id];
  assert.deepEqual(gevraagd, [["/straat-index.json", "no-cache"], [`/straat/${KAM.id}.json?v=${hash}`, ""]]);
  assert.equal(stand.doc.inhoud, hash);
  // Een straat zonder bestand: een lege stand (niets bij de verversing), zonder tweede verzoek.
  const leeg = await laadStraat("123", { fetch: nep });
  assert.equal(leeg.doc, null);
  assert.equal(gevraagd.length, 2);
});

test("het kader rond een straat, het verschil en de zin onder de plek", () => {
  assert.deepEqual(kaderRond([4.4, 51.2, 4.41, 51.21], 0), [4.4, 51.2, 4.41, 51.21]);
  const k = kaderRond([4.4, 51.2, 4.41, 51.21], 100);
  assert.ok(k[0] < 4.4 && k[0] > 4.398 && k[3] > 51.21 && k[3] < 51.2111, JSON.stringify(k));
  assert.equal(kaderRond(null, 10), null);
  assert.deepEqual(verschil([{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "c" }]), { nieuw: 1, weg: 1 });
  assert.deepEqual(verschil([{ gipodId: 1 }], [{ id: "work:1" }]), { nieuw: 0, weg: 0 });
  assert.equal(tijdstipTekst(VERVERST, NU), "05:22");
  assert.equal(tijdstipTekst(VERVERST, new Date("2099-03-11T09:00:00Z")), "10 mrt 05:22");
  assert.equal(standZin({ ververst: VERVERST, nieuw: 1, nu: NU }), "Live nagekeken: 1 nieuw sinds 05:22.");
  assert.equal(standZin({ ververst: VERVERST, nu: NU }), "Live nagekeken: niets nieuw sinds 05:22.");
  assert.equal(standZin({ ververst: VERVERST, nieuw: 2, weg: 1, nu: NU }), "Live nagekeken: 2 nieuw, 1 niet meer in de bron sinds 05:22.");
  assert.equal(standZin({ ververst: VERVERST, mislukt: true, nu: NU }), "Live nakijken lukte nu niet. Je ziet de stand van de verversing van 05:22.");
  assert.equal(standZin({ ververst: VERVERST, bezig: true, nu: NU }), "Stand van de verversing van 05:22. Live nakijken…");
});

test("de voorpagina vraagt live-layers.json niet meer op, zonder no-store", () => {
  const bron = fs.readFileSync(path.join(repoRoot, "site", "street-overview.js"), "utf8");
  assert.doesNotMatch(bron, /live-layers\.json"/);
  assert.doesNotMatch(bron, /no-store/);
  assert.match(bron, /fetch\("\/history\/radar\.json"/);
  for (const naam of fs.readdirSync(path.join(repoRoot, "site")).filter((n) => n.endsWith(".js"))) {
    assert.doesNotMatch(fs.readFileSync(path.join(repoRoot, "site", naam), "utf8"), /cache:\s*"no-store"/, naam);
  }
});

test("bij één straat laden de lijsten van het hele district niet; de plekpagina vraagt alleen het kader", () => {
  const lees = (naam) => fs.readFileSync(path.join(repoRoot, "site", naam), "utf8");
  for (const naam of ["works-live.js", "public-space-live.js", "terraces-live.js", "permits-live.js"]) {
    assert.match(lees(naam), /&&!v\.straatSnel\)(?:load|laad)\(\)/, `${naam} laadt het hele district niet voor één straat`);
    assert.match(lees(naam), /laadAlsInBeeld\(root,/, `${naam} laadt pas als de lijst echt in beeld komt`);
  }
  // De vergunningen laadden vroeger bij elk bezoek, ook op de voorpagina.
  assert.doesNotMatch(lees("permits-live.js"), /\n {2}Promise\.all\(\[permits\(\),district\(\)/);
  const view = lees("place-view.js");
  for (const naam of ["werkenInKader", "publiekeRuimteInKader", "vergunningenInKader", "terrassenInKader", "laadStraat(place.id)", "kaderRond("]) assert.ok(view.includes(naam), naam);
});

test("render.yaml: lange cache voor de straatbestanden met hash, korte voor de data van elke ochtend, niets op de code", () => {
  const yaml = fs.readFileSync(path.join(repoRoot, "render.yaml"), "utf8");
  const regels = [...yaml.matchAll(/- path: (\S+)\n\s+name: Cache-Control\n\s+value: (.+)/g)].map(([, pad, waarde]) => [pad, waarde.trim()]);
  const per = Object.fromEntries(regels);
  assert.equal(per["/straat/*"], "public, max-age=31536000, immutable");
  for (const pad of ["/straat-index.json", "/history/*", "/sources/*", "/agenda-feed.js"]) assert.equal(per[pad], "public, max-age=300, must-revalidate", pad);
  // Geen cacheregel voor alles of voor de code: index.html en de modules hebben geen versie in hun naam.
  for (const [pad] of regels) assert.ok(pad !== "/*" && !pad.startsWith("/*.") && !/\.css$|index\.html$/.test(pad), pad);
  assert.equal(regels.length, new Set(regels.map(([pad]) => pad)).size, "geen pad twee keer");
  // De index staat niet onder /straat/ (die cache is een jaar).
  assert.equal(STRAAT_INDEX, "site/straat-index.json");
});

// ---------- nakijkronde: wat de snelle weg niet mag verliezen ----------

test("openbaar onderzoek: de vergunningen uit het straatbestand krijgen de nagekeken stand van het Inzageloket", async (t) => {
  const root = werkmap(t);
  await bouw(root);
  const doc = lees(root, `site/straat/${KAM.id}.json`);
  // Verzonnen dossier in openbaar onderzoek, van 1 tot 30 maart 2099 (de vergunning van de fixture).
  const inzage = { schema: "inzage-status/1", uitleg: "verzonnen", dossiers: [{ project: "OMV_2099000001", gevonden: true, toestand: "openbaar onderzoek", bron: "handmatig", nagekeken: "2099-03-05", openbaarOnderzoek: { van: "2099-03-01", totEnMet: "2099-03-30" } }] };
  const { permits } = lagenUitStand({ doc }, { inzage, vandaag: "2099-03-10" });
  assert.equal(permits[0].inzage?.loopt, true, "zonder inzage verdwijnt 'bezwaar indienen kan nu'");
  assert.equal(splitsOpOnderzoek([{ item: permits[0] }]).inspraak.length, 1);
  // Zonder nagekeken stand: zoals vroeger, geen inzage.
  assert.equal(lagenUitStand({ doc }).permits[0].inzage, undefined);
});

test("evenement: opbouw en afbraak elders in de stad staan als samenvatting in elk straatbestand van het dossier", async (t) => {
  const root = werkmap(t);
  // Opbouw en afbraak van het verzonnen evenement: elders, zonder straat (zoals de start- en aankomstzone).
  const b = await schoneBronnen({ extraRuimte: [evenementFase(2, "Opbouw", "2099-03-12", "2099-03-13"), evenementFase(3, "Afbraak", "2099-03-15", "2099-03-16")] });
  await bouw(root, { bronnenDoc: b });
  for (const straat of [KAM, PET, HUIK]) {
    const rijen = lagenUitStand({ doc: lees(root, `site/straat/${straat.id}.json`) }).publicSpace.filter((i) => i.reference === "ET2099000001");
    const feiten = evenementFeiten(rijen);
    assert.deepEqual(feiten.fasePeriodes.map((f) => [f.naam, f.start, f.eind]), [["Opbouw", "2099-03-12", "2099-03-13"], ["Evenement", "2099-03-14", "2099-03-14"], ["Afbraak", "2099-03-15", "2099-03-16"]], straat.name);
    assert.deepEqual([feiten.start, feiten.eind], ["2099-03-12", "2099-03-16"], `${straat.name}: de hele innameperiode`);
    const wanneer = evenementKaartje(feiten, { vandaag: "2099-03-10" }).kern.find(([dt]) => dt === "Wanneer")[1];
    assert.match(wanneer, /Opbouw vanaf .*12 maart en afbraak tot .*16 maart/, straat.name);
    // De samenvatting heeft geen straat, vorm of omschrijving; in het bestand staat ze kort.
    for (const rij of rijen.filter((i) => i.faseSamenvatting)) assert.deepEqual([rij.streets, "vorm" in rij, "description" in rij, rij.detail, rij.kindLabel], [[], false, false, `Fase ${rij.phase}`, "Inname openbaar domein"]);
    const inBestand = lees(root, `site/straat/${straat.id}.json`).publiekeRuimte.filter((i) => i.faseSamenvatting);
    assert.deepEqual(inBestand.map((i) => i.phase).sort(), ["Afbraak", "Opbouw"], `${straat.name}: alleen wat de straat zelf niet geeft`);
    for (const rij of inBestand) assert.deepEqual(["streets", "title", "detail", "kindLabel"].filter((veld) => veld in rij), []);
  }
  // Na het live nakijken van het kader (alleen de rij van de dag zelf): de samenvatting van de ochtend blijft.
  const ochtend = lagenUitStand({ doc: lees(root, `site/straat/${KAM.id}.json`) }).publicSpace;
  const live = ochtend.filter((i) => !i.faseSamenvatting && i.reference === "ET2099000001");
  const samen = aanvullenMetOchtend(live, ochtend);
  assert.deepEqual(evenementFeiten(samen.filter((i) => i.reference === "ET2099000001")).fasen, ["Opbouw", "Evenement", "Afbraak"]);
  // Een dossier dat live niet meer in het kader staat, komt niet terug via de samenvatting.
  assert.equal(aanvullenMetOchtend([], ochtend).length, 0);
});

test("privacy: een nummer na 'gevel', 'pand' of 'nummer' in vrije tekst (GIPOD-hinderfase) valt weg", async (t) => {
  // Verzonnen omschrijvingen van een hinderfase.
  const fasen = [
    { description: "Fase 2: stelling aan gevel nummer 12", start: "2099-03-19T06:00:00Z", end: "2099-03-20T16:00:00Z", consequences: ["Voetpad versmald"] },
    { description: "Herstel pand nr. 5 en 7", start: "2099-03-21T06:00:00Z", end: "2099-03-22T16:00:00Z", consequences: [] },
  ];
  const schoon = itemVoorStraat(werk(990001, { hindrance: { severe: false, consequences: ["Voetpad versmald"], phases: fasen } }), { laag: "werken" });
  assert.ok(schoon, "het werk blijft (opgekuist), het valt niet weg");
  assert.deepEqual(schoon.hindrance.phases.map((f) => f.description), ["Fase 2: stelling aan gevel", "Herstel pand"]);
  assert.equal(schoon.hindrance.phases[0].start, fasen[0].start, "datums blijven");
  // De scan ziet het ook (validate-data), maar niet in een officiële straatnaam met een cijfer.
  assert.deepEqual(straatItemPrivacy({ werken: [{ hindrance: { phases: [{ description: "stelling aan gevel nummer 12" }] } }] }).map((v) => v.code), ["huisnummer"]);
  assert.deepEqual(straatItemPrivacy({ straten: [["1", "Buurtweg nr 11", "2000"]], werken: [{ title: "Buurtweg nr 11: herstel" }] }), []);
  assert.equal(zonderPandnummers("huisnummer 12 en woning 7b afgesloten"), "en woning afgesloten");
  assert.deepEqual(pandnummerStukken("Fase 1: lijn 4 omgeleid"), []);
  // In het bestand dat de bouwer schrijft.
  const root = werkmap(t);
  await bouw(root, { bronnenDoc: await schoneBronnen({ werken: [werk(990001, { hindrance: { severe: false, consequences: [], phases: fasen } })] }) });
  const tekst = alleTekst(root);
  assert.doesNotMatch(tekst, /nummer 12|nr\. 5/);
  assert.deepEqual(straatBestandenProblemen(root), []);
});

test("laadStraat kijkt de hash na: een bestand met een andere inhoud wordt één keer vers gevraagd", async (t) => {
  const root = werkmap(t);
  await bouw(root);
  const hash = lees(root, STRAAT_INDEX).straten[KAM.id];
  const echt = fs.readFileSync(path.join(root, "site", "straat", `${KAM.id}.json`), "utf8");
  // Wat de browser of de CDN onder de URL met de hash bewaarde: een andere stand van dezelfde straat.
  const anders = JSON.stringify({ ...JSON.parse(echt), inhoud: "000000000000", ververst: "2099-03-01T04:22:00.000Z" });
  for (const [eerst, verwacht] of [[anders, hash], ["<!doctype html>", hash]]) {
    const gevraagd = [];
    const nep = async (url, opties = {}) => {
      gevraagd.push([String(url), opties.cache || ""]);
      const u = new URL(String(url), "http://x");
      if (u.pathname === "/straat-index.json") return new Response(fs.readFileSync(path.join(root, STRAAT_INDEX)));
      return new Response(u.searchParams.has("vers") ? echt : eerst);
    };
    const { laadStraat: laad } = await import(`../site/straat-snapshot.js?nakijk=${gevraagd.length}${Math.random()}`);
    const stand = await laad(KAM.id, { fetch: nep, nu: () => 42 });
    assert.equal(stand?.doc?.inhoud, verwacht);
    assert.deepEqual(gevraagd.slice(1), [[`/straat/${KAM.id}.json?v=${hash}`, ""], [`/straat/${KAM.id}.json?v=${hash}&vers=42`, "reload"]]);
  }
  // Klopt de hash meteen: geen tweede verzoek (zie de toets van laadStraat hierboven).
});

test("de zin onder de plek met een straal: eerlijk als live of de straatassen voor de straal niet laadden", () => {
  assert.equal(standZin({ ververst: VERVERST, mislukt: true, straal: 500, nu: NU }), "Rond de straat kon nu niet live geladen worden. Je ziet alleen de straat zelf, met de stand van de verversing van 05:22.");
  assert.equal(standZin({ ververst: VERVERST, straal: 500, straalStand: "laadt", nu: NU }), "Live nagekeken: niets nieuw sinds 05:22. De straal rond de straat laadt nog…");
  assert.equal(standZin({ ververst: VERVERST, nieuw: 1, straal: 250, straalStand: "mislukt", nu: NU }), "Live nagekeken: 1 nieuw sinds 05:22. De straal rond de straat kon nu niet geladen worden: je ziet alleen de straat zelf.");
  assert.equal(standZin({ ververst: VERVERST, mislukteDelen: ["vergunningen"], straal: 250, nu: NU }), "Live nagekeken: niets nieuw sinds 05:22. Live nakijken lukte nu niet voor vergunningen: daarvan zie je alleen de straat zelf, met de stand van de verversing van 05:22.");
  // Zonder straal: zoals voorheen.
  assert.equal(standZin({ ververst: VERVERST, straal: 0, straalStand: "laadt", nu: NU }), "Live nagekeken: niets nieuw sinds 05:22.");
  // De kaart zegt of de straatassen voor de straal er zijn.
  const wijken = [];
  assert.equal(createAreaMatcher({ wijken, geo: { entries: {} } }).straal, "laadt");
  assert.equal(createAreaMatcher({ wijken, geo: { entries: {} }, straatasMislukt: true }).straal, "mislukt");
  assert.equal(createAreaMatcher({ wijken, geo: { entries: {} }, streetIndex: { byName: new Map(), streets: [] } }).straal, "klaar");
});

test("de zin onder de tegels wordt voorgelezen (role=status)", () => {
  const view = fs.readFileSync(path.join(repoRoot, "site", "place-view.js"), "utf8");
  assert.match(view, /<p class="pv-place-loading pv-stand" role="status">/);
});

test("sources:health meldt de straatbestanden: een laag op stale of een bouw van meer dan een dag oud (alleen melden)", async (t) => {
  const root = werkmap(t);
  fs.copyFileSync(path.join(repoRoot, "site", "sources", "refresh-status.json"), path.join(root, "site", "sources", "refresh-status.json"));
  const at = Date.parse(VERVERST) + 3_600_000;
  const zonder = checkHealth({ rootDir: root, at, baseline: null });
  assert.ok(zonder.lines.some((l) => l.startsWith("straatbestanden\tnog niet gebouwd")), zonder.lines.join("\n"));
  await bouw(root);
  const goed = checkHealth({ rootDir: root, at, baseline: null });
  assert.ok(goed.lines.some((l) => /^straatbestanden\tok\tstraten=3\t/.test(l)), goed.lines.join("\n"));
  assert.deepEqual(goed.warnings.filter((w) => w.startsWith("straatbestanden")), []);
  // Werken laden niet: de straatbestanden houden de vorige stand, en dat staat in sources:health.
  const zonderWerken = await schoneBronnen();
  zonderWerken.lagen.werken = { ok: false, items: [], errorCode: "http_500" };
  await bouw(root, { bronnenDoc: zonderWerken });
  const stale = checkHealth({ rootDir: root, at, baseline: null });
  assert.ok(stale.warnings.some((w) => /laag werken op "stale".*http_500/.test(w)), stale.warnings.join("\n"));
  assert.equal(stale.exitCode, zonder.exitCode, "telt niet als fout");
  // Twee dagen later zonder nieuwe bouw: te oud.
  const oud = straatIndexStand(lees(root, STRAAT_INDEX), { at: at + 2 * 86_400_000 });
  assert.ok(oud.waarschuwingen.some((w) => /laatste bouw 4\d uur geleden/.test(w)), oud.waarschuwingen.join("\n"));
});

test("innames: dossiertype en hinder komen in de straatbestanden (zoals live), niet in de historiek of kaart-uitleg", async (t) => {
  // Een nagebootste A-Sign die alleen de gevraagde velden teruggeeft (outFields), met één verzonnen inname
  // van een evenement in de Kammenstraat.
  const [x1, y1, x2, y2] = [4.40025, 51.21571, 4.40208, 51.21878];
  const inname = { OBJECTID: 1, dossierNummer: "ET2099000088", faseId: "F1", innameId: "I1", dossierStatus: "toelating_gegenereerd", faseNaam: "Evenement", type_dossier: "ETL", innameTypeNaam: "Parcours", innameBeschrijving: "", innameHinder: "True", faseStartDatum: Date.parse("2099-03-14T00:00:00Z"), faseEindDatum: Date.parse("2099-03-14T00:00:00Z") };
  const district = { type: "Polygon", coordinates: [[[4.38, 51.2], [4.43, 51.2], [4.43, 51.24], [4.38, 51.24], [4.38, 51.2]]] };
  const nep = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/MapServer/109/")) return Response.json({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: district }] });
    const laag = url.pathname.match(/\/P_ASign\/ASign\/MapServer\/(\d+)\/query$/)?.[1];
    if (!laag) return new Response("", { status: 404 });
    const rijen = laag === "23" ? [inname] : [];
    if (url.searchParams.get("returnIdsOnly") === "true") return Response.json({ objectIds: rijen.map((r) => r.OBJECTID) });
    const velden = (url.searchParams.get("outFields") || "").split(",");
    return Response.json({ features: rijen.map((r) => ({ attributes: Object.fromEntries(velden.filter((v) => v in r).map((v) => [v, r[v]])), geometry: { paths: [[[x1, y1], [x2, y2]]] } })) });
  };
  const resultaat = await fetchPublicSpaceHistory({ fetch: nep, clock: () => NU, streets: null });
  assert.equal(resultaat.ok, true, JSON.stringify(resultaat));
  // De historiek (detail) en kaart-uitleg (iodFeatures) blijven zoals ze waren: geen eenmalige golf van wijzigingen.
  assert.equal(resultaat.items[0].detail, "Fase Evenement");
  assert.equal("innameHinder" in resultaat.iodFeatures[0].attributes, false);
  // De straatbestanden krijgen ze wel, net als de browser live.
  const root = werkmap(t);
  const straatAs = { type: "Feature", properties: { LSTRNMID: Number(KAM.id), LSTRNM: KAM.name, RSTRNMID: Number(KAM.id), RSTRNM: KAM.name, postcode: 2000, DISTRICT: "Antwerpen" }, geometry: { type: "LineString", coordinates: [[x1, y1], [x2, y2]] } };
  const bronnen = await verzamelStraatBronnen({ rootDir: root, observedAt: VERVERST, worksResult: { ok: true, items: [] }, publicSpaceResult: resultaat, streetFeatures: [straatAs] });
  const rij = bronnen.lagen.publiekeRuimte.items.find((i) => i.reference === "ET2099000088");
  assert.deepEqual([rij?.dossierType, rij?.hindrance], ["ETL", "True"]);
  assert.match(rij.detail, /Hinder volgens IOD: True/);
});

test("werfzones en parkeerverboden: de andere fasen en plaatsen van hetzelfde dossier staan kort in het straatbestand", async (t) => {
  const { publicSpaceEntries } = await import("../site/place-core.js");
  const sgw = (fase, start, end, kinds, streets, werfzoneStreets, omleidingStreets) => ({ id: `sgw:PROEF-GW|${fase}`, kind: "sgw", kindLabel: kinds, title: kinds, location: "", start, end, status: "vergund", reference: "PROEF-GW", detail: `Fase ${fase}`, sourceLabel: "A-Sign SGW", sourceUrl: "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/48", streets, werfzoneStreets, omleidingStreets, streetResolution: "geometry_official_axis", streetDistanceMeters: 1 });
  const verbod = (n, straat) => ({ id: `parking:PROEF-PV|L${n}`, kind: "parking", kindLabel: "Parkeerverbod", title: "Verhuis", reason: "Verhuis", location: `${straat.name}, 2000 Antwerpen`, start: "2099-03-12T00:00:00.000Z", end: "2099-03-12T00:00:00.000Z", status: "Goedgekeurd", reference: "PROEF-PV", detail: "", startTime: "07:00", endTime: "17:00", weekdaysOnly: false, postcode: "2000", streets: [straat], streetResolution: "official_address_match", streetDistanceMeters: 0 });
  const extra = [
    // Fase 1: de omleiding door de Kammenstraat, de werfzone in de Peterseliestraat; fase 2: alleen de werfzone.
    sgw("1", "2099-03-08T00:00:00.000Z", "2099-03-20T00:00:00.000Z", "Omleiding + Werfzone", [KAM, PET], [PET], [KAM]),
    sgw("2", "2099-04-01T00:00:00.000Z", "2099-04-10T00:00:00.000Z", "Werfzone", [PET], [PET], []),
    verbod(1, KAM), verbod(2, PET), verbod(3, HUIK),
  ];
  const root = werkmap(t);
  await bouw(root, { bronnenDoc: await schoneBronnen({ extraRuimte: extra }) });
  const kam = lagenUitStand({ doc: lees(root, `site/straat/${KAM.id}.json`) }).publicSpace;
  const bundel = kam.filter((i) => i.bundel);
  assert.deepEqual(bundel.map((i) => i.id).sort(), ["parking:PROEF-PV|L2|bundel", "sgw:PROEF-GW|2"]);
  assert.deepEqual(bundel.find((i) => i.kind === "parking").streets.map((s) => s.name).sort(), [HUIK.name, PET.name]);
  // Zoals de plekpagina ze toont: de werfzone met haar twee fasen, het parkeerverbod met de andere straten.
  const inStraat = kam.filter((i) => (i.streets || []).some((s) => s.id === KAM.id));
  const kaarten = publicSpaceEntries(inStraat, { vandaag: "2099-03-10", alle: kam, straat: KAM.name });
  const werfzone = kaarten.find((k) => k.item?.kind === "sgw");
  assert.equal(werfzone.title, "Werfzone met omleiding");
  assert.deepEqual(werfzone.regels.find(([dt]) => /fasen/.test(dt))?.[0], "2 fasen");
  assert.equal(werfzone.end, "2099-04-10");
  assert.match(kaarten.find((k) => k.item?.reference === "PROEF-PV").location, /^Kammenstraat \+ 2 andere straten/);
  // Live raakt het kader van de straat de werfzone van fase 1 niet: live alleen "Omleiding". De ochtend vult aan.
  const live = [{ ...kam.find((i) => i.id === "sgw:PROEF-GW|1"), kindLabel: "Omleiding", title: "Omleiding", streets: [KAM], werfzoneStreets: [] }];
  const samen = aanvullenMetOchtend(live, kam);
  const fase1 = samen.find((i) => i.id === "sgw:PROEF-GW|1");
  assert.equal(fase1.kindLabel, "Omleiding + Werfzone");
  assert.deepEqual(fase1.werfzoneStreets.map((s) => s.name), [PET.name]);
  assert.ok(samen.some((i) => i.id === "sgw:PROEF-GW|2"), "de andere fase blijft");
});

test("een vergunning die ver buiten het kader reikt, houdt na het live nakijken de straten van de ochtend", () => {
  const ochtend = [{ id: "permit:20990099", streets: [KAM, PET, HUIK] }];
  const live = [{ id: "permit:20990099", streets: [KAM] }, { id: "permit:20990100", streets: [KAM] }];
  const samen = metStratenVanDeOchtend(live, ochtend);
  assert.deepEqual(samen[0].streets.map((s) => s.name), [KAM.name, PET.name, HUIK.name]);
  assert.deepEqual(samen[1].streets, [KAM], "een nieuwe aanvraag blijft zoals live");
  // Op de plekpagina gebruikt.
  assert.match(fs.readFileSync(path.join(repoRoot, "site", "place-view.js"), "utf8"), /metStratenVanDeOchtend\(items, snel\.ochtend\.permits\)/);
});
