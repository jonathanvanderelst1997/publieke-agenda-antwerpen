// Restpunten uit de hertest van de samenvoeging (claude/agenda-integratie). Elke toets faalt op main
// en slaagt hier. Alle gegevens zijn verzonnen (Proefstraat, Voorbeeldlaan ...).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { KAART_SOORTEN, KIND_GROUPS } from "../site/place-core.js";

const css = (naam) => fs.readFileSync(new URL(`../site/${naam}`, import.meta.url), "utf8");

// ---------- 1. einddata van het openbaar onderzoek (Inzageloket) ----------
// De visuele hertest opende elk dossier één keer in een gewone browser (de verversing bevraagt het loket
// niet) en las de periode bij Toestand af. Wie een verlopen regel later opruimt, breekt deze toets niet.
test("1. de twee termijnen uit het Inzageloket staan erin, en de site zegt tot wanneer bezwaar kan", async () => {
  const { inzageVoor, onderzoekRegel, onderzoekZin, valideerInzageStatus } = await import("../site/inzage-status.js");
  const doc = JSON.parse(css("sources/inzage-status.json"));
  assert.deepEqual(valideerInzageStatus(doc), []);
  const termijnen = { OMV_2026065445: ["2026-09-18", "2026-10-17", /17 oktober/], OMV_2026061320: ["2026-10-07", "2026-11-05", /5 november/] };
  for (const [project, [van, totEnMet, einde]] of Object.entries(termijnen)) {
    if (!doc.dossiers.some((d) => d.project === project)) continue; // opgeruimd na de termijn
    const inzage = inzageVoor(doc, project, "2026-10-10");
    assert.deepEqual(inzage?.onderzoek, { van, totEnMet }, project);
    assert.equal(inzage.loopt, true, project);
    assert.match(onderzoekZin(inzage, "2026-10-10"), einde, project);
    assert.match(onderzoekZin(inzage, "2026-10-10"), /Bezwaar indienen kan tot dan/, project);
    assert.doesNotMatch(onderzoekRegel(inzage, "2026-10-10"), /kent deze site niet/, project);
  }
});

// ---------- 2. contrast van het getal op de onderwerpchips ----------
// Een kleine rekenaar voor de CSS-variabelen van agenda-uitgaan.css en de chipregels van place-view.css:
// var() met terugval, color-mix(in srgb, ...) en #hex met alfa (over de chipkleur gelegd).
const uitgaan = css("agenda-uitgaan.css"), plek = css("place-view.css");
const blok = (tekst, kop) => {
  const i = tekst.indexOf(kop);
  assert.ok(i >= 0, `regel ${kop} ontbreekt`);
  const s = tekst.indexOf("{", i);
  return tekst.slice(s + 1, tekst.indexOf("}", s));
};
const declaraties = (tekst) => Object.fromEntries([...tekst.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const regel = (sel) => {
  const m = plek.match(new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `regel ${sel} ontbreekt in place-view.css`);
  return declaraties(m[1]);
};
function kleur(waarde, vars) {
  const v = String(waarde).trim();
  const vm = v.match(/^var\((--[\w-]+)(?:,\s*(.+))?\)$/);
  if (vm) return vars[vm[1]] !== undefined ? kleur(vars[vm[1]], vars) : kleur(vm[2], vars);
  const mix = v.match(/^color-mix\(in srgb,\s*(.+?)\s+(\d+)%,\s*(.+)\)$/);
  if (mix) {
    const a = kleur(mix[1], vars), b = kleur(mix[3], vars), p = Number(mix[2]) / 100;
    return [0, 1, 2].map((i) => a[i] * p + b[i] * (1 - p)).concat(1);
  }
  const h = v.match(/^#([0-9a-f]{3,8})$/i)?.[1];
  assert.ok(h, `kleur niet te lezen: ${v}`);
  const lang = h.length <= 4 ? [...h].map((c) => c + c).join("") : h;
  const [r, g, b, a = 255] = lang.match(/../g).map((x) => parseInt(x, 16));
  return [r, g, b, a / 255];
}
const over = (voor, achter) => [0, 1, 2].map((i) => voor[i] * voor[3] + achter[i] * (1 - voor[3])).concat(1);
const lum = (c) => {
  const k = c.slice(0, 3).map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test("2. het getal op een onderwerpchip haalt minstens 4,5:1, voor elke soort, gekozen of niet, licht en donker", () => {
  const thema = {
    licht: declaraties(blok(uitgaan, ":root {")),
    donker: { ...declaraties(blok(uitgaan, ":root {")), ...declaraties(blok(uitgaan, ':root[data-theme="dark"] {')) },
  };
  const catDonker = declaraties(blok(uitgaan, ':root[data-theme="dark"] :is([class*="cat-"]) {'));
  const chip = regel(".pv-chip"), gekozen = regel('.pv-chip[aria-pressed="true"]'), nul = regel('.pv-chip-zero[aria-pressed="true"]');
  const getal = regel(".pv-chip-n"), getalNul = regel('.pv-chip-zero[aria-pressed="true"] .pv-chip-n'), getalUit = regel('.pv-chip[aria-pressed="false"] .pv-chip-n');
  const uitkomsten = [];
  for (const g of KIND_GROUPS) {
    for (const [naam, basis] of Object.entries(thema)) {
      const vars = { ...basis, ...declaraties(blok(uitgaan, `.cat-${g.cat} {`)), ...(naam === "donker" ? catDonker : {}) };
      const pagina = kleur(vars["--pa-bg"], vars);
      // De kleur van het getal hangt niet af van het aantal cijfers: ook "7" moet dit halen.
      const staten = {
        gekozen: [gekozen, getal], "gekozen, 0": [nul, getalNul], "niet gekozen": [chip, getalUit],
      };
      for (const [staat, [c, n]] of Object.entries(staten)) {
        const chipAchter = over(kleur(c.background, vars), pagina);
        const achter = over(kleur(n.background, vars), chipAchter);
        const voor = kleur(n.color || c.color, vars);
        const r = contrast(voor, achter);
        uitkomsten.push(`${g.key} ${naam} ${staat}: ${r.toFixed(2)}`);
        assert.ok(r >= 4.5, `${g.label}, ${naam}, ${staat}: ${r.toFixed(2)}:1 (minstens 4,5:1)`);
      }
    }
  }
  assert.equal(uitkomsten.length, KIND_GROUPS.length * 2 * 3);
});

// P9: de legenda van de buurtkaart gebruikt dezelfde chips (.pv-chip.buurt-leg.cat-<cat>), ook in de kleuren van
// verkeer (publicSpace) en agenda (other) die geen onderwerpchip hebben. Tekst en getal halen 4,5:1, aan en uit.
test("2b. de legendaknoppen van de kaart: tekst en getal halen minstens 4,5:1, voor elke soort, aan en uit, licht en donker", () => {
  const thema = {
    licht: declaraties(blok(uitgaan, ":root {")),
    donker: { ...declaraties(blok(uitgaan, ":root {")), ...declaraties(blok(uitgaan, ':root[data-theme="dark"] {')) },
  };
  const catDonker = declaraties(blok(uitgaan, ':root[data-theme="dark"] :is([class*="cat-"]) {'));
  const chip = regel(".pv-chip"), gekozen = regel('.pv-chip[aria-pressed="true"]');
  const getal = regel(".pv-chip-n"), getalUit = regel('.pv-chip[aria-pressed="false"] .pv-chip-n');
  let n = 0;
  for (const s of KAART_SOORTEN) {
    for (const [naam, basis] of Object.entries(thema)) {
      const vars = { ...basis, ...declaraties(blok(uitgaan, `.cat-${s.cat} {`)), ...(naam === "donker" ? catDonker : {}) };
      const pagina = kleur(vars["--pa-bg"], vars);
      for (const [staat, c, g] of [["aan", gekozen, getal], ["uit", chip, getalUit]]) {
        const chipAchter = over(kleur(c.background, vars), pagina);
        const tekst = contrast(kleur(c.color, vars), chipAchter);
        const cijfer = contrast(kleur(g.color || c.color, vars), over(kleur(g.background, vars), chipAchter));
        assert.ok(tekst >= 4.5, `${s.label}, ${naam}, ${staat}: tekst ${tekst.toFixed(2)}:1`);
        assert.ok(cijfer >= 4.5, `${s.label}, ${naam}, ${staat}: getal ${cijfer.toFixed(2)}:1`);
        n += 1;
      }
    }
  }
  assert.equal(n, KAART_SOORTEN.length * 2 * 2);
});

// ---------- 3. een reeks huisnummers is nooit één huisnummer ----------
// De hertest zag "Proefstraat nr. 13" op een kaart, terwijl de beheerder "13 tem 15" schreef. Regel: een reeks
// blijft als reeks, in elke schrijfwijze. Besluit van de eigenaar van 18 oktober 2026 (site/works-core.js): bij een
// werk mag de plaats exact zijn, dus ook één los huisnummer blijft staan, zoals de beheerder het schreef. De regel
// "Volgens de beheerder" toont geen adressen (die staan bij "Waar").
test("3. een reeks huisnummers in elke schrijfwijze wordt een reeks; één los nummer blijft (de plaats mag exact)", async () => {
  const ku = await import("../site/kaart-uitleg.js");
  const werk = (title) => ({
    gipodId: 90000901, title, status: "In uitvoering", start: "2026-05-02T05:00:00Z", end: "2026-11-02T16:00:00Z",
    owner: "Voorbeeldnet", ownerGroup: "Andere", workTypes: [], occupancyTypes: ["Telecom"],
    streets: [{ id: "1", name: "Proefstraat", postcode: "2018" }], hindrance: null,
  });
  const kaart = (title) => ku.werkKaartje(werk(title), { vandaag: "2026-10-10" });
  const waar = (k) => Object.fromEntries(k.regels).Waar;
  for (const reeks of ["13 tem 15", "13 t.e.m. 15", "13 tot en met 15", "13 t/m 15", "13 tot 15", "13-15", "13 – 15", "13 → 15", "13 en 15"]) {
    const k = kaart(`2018 Antwerpen - (Antwerpen) - Proefstraat ${reeks}. Voorbeeldplein 70 tem Voorbeeldstraat 2. Doorsteek Voorbeeldlaan. Voorbeeldstraat 48. - werken aan nutsleiding - 109m.`);
    assert.match(k.titel, /in de Proefstraat nr\. 13–15 tot 2 november/, reeks);
    assert.match(waar(k), /^Proefstraat, nr\. 13–15 \(omschrijving van de beheerder\)$/, reeks);
    assert.doesNotMatch([k.titel, k.samenvatting, waar(k)].join(" "), /nr\. 13(?!–)|Voorbeeldstraat \d|Voorbeeldplein \d/, reeks);
  }
  // Een opsomming wordt de hele reeks.
  assert.match(kaart("Proefstraat 13, 15 en 17 - werken aan nutsleiding").titel, /Proefstraat nr\. 13–17 /);
  // Eén los huisnummer: het staat in de titel en bij "Waar", zoals de beheerder het schreef.
  const los = kaart("2018 Antwerpen - Proefstraat 12 - werken aan nutsleiding");
  assert.match(los.titel, /in de Proefstraat nr\. 12 tot 2 november/);
  assert.match(waar(los), /^Proefstraat, nr\. 12 \(omschrijving van de beheerder\)$/);
  assert.doesNotMatch(waar(los), /weggelaten/);
  // Ook een los nummer uit het adressenregister wordt bewaard en getoond.
  assert.equal(ku.werkFeiten(werk("Werk in openbaar domein"), { huisnummers: "nr. 8", huisnummerBron: "register" }).huisnummers, "nr. 8");
  assert.equal(ku.werkFeiten(werk("Werk in openbaar domein"), { huisnummers: "nr. 8–14", huisnummerBron: "register" }).huisnummers, "nr. 8–14");
  // Een getal na een komma dat geen huisnummer is, maakt geen reeks; een postcode ook niet.
  assert.equal(ku.huisnummersUitTekst("Proefstraat 12, 3 dagen", "Proefstraat"), "nr. 12");
  assert.equal(ku.huisnummersUitTekst("Proefstraat 13, 2000 Antwerpen", "Proefstraat"), "nr. 13");
});

// Nakijken van de samenvoeging: de ingeklapte "Tekst van de beheerder in GIPOD" (bronTekst), de regel
// "Volgens de beheerder", de fasen en "Bus en tram" toonden een los huisnummer nog letterlijk, ook als
// "Waar" zei dat het weggelaten was ("thv 31", "ter hoogte van nr 31"). Sinds het besluit van 18 oktober 2026
// (de plaats mag exact) zeggen ze allemaal hetzelfde: het huisnummer zoals de beheerder het schreef. "Volgens de
// beheerder" laat een stuk dat alleen een adres is weg ("thv 31"): dat staat bij "Waar" en in zijn tekst.
test("3b. de tekst van de beheerder, de fasen en \"Bus en tram\" tonen het huisnummer zoals de beheerder het schreef", async () => {
  const ku = await import("../site/kaart-uitleg.js");
  const werk = (title, extra = {}) => ({
    gipodId: 90000902, title, status: "In uitvoering", start: "2026-05-02T05:00:00Z", end: "2026-11-02T16:00:00Z",
    owner: "Voorbeeldnet", ownerGroup: "Andere", workTypes: [], occupancyTypes: ["Telecom"],
    streets: [{ id: "1", name: "Proefstraat", postcode: "2018" }], hindrance: null, ...extra,
  });
  const kaart = (title, extra) => ku.werkKaartje(werk(title, extra), { vandaag: "2026-10-10" });
  const getoond = (k) => [k.titel, k.samenvatting, k.bronTekst, ...k.regels.map(([, v]) => v)].join(" ¶ ");
  // Eén los nummer op de straat van de kaart: "Waar" noemt het, niets is weggelaten. Bij een publiek project (hier telecom:
  // kabels in de straat) is dat het punt waar het werk loopt, geen huis: de tekst van de beheerder blijft (nakijkronde van
  // head c4bb2927, tests/werken-nakijk3.test.mjs 8). Bij een werk dat geen publiek project is (geen soort), is het wel een werk
  // voor één huis (tests/werken-een-huis.test.mjs): dan staat de vrije tekst van de beheerder er niet naast.
  const los = kaart("2018 Antwerpen - Proefstraat 12 - werken aan nutsleiding");
  assert.match(Object.fromEntries(los.regels).Waar, /^Proefstraat, nr\. 12 /);
  assert.match(los.bronTekst, /werken aan nutsleiding/);
  for (const [titel, nummer, wat] of [
    ["Proefstraat thv 31 - vervangen voetpadkast", /Proefstraat, nr\. 31/, /vervangen voetpadkast/],
    ["Proefstraat 12 A - herstelling", /Proefstraat, nr\. 12/, /herstelling/],
    ["Proefstraat 12, 2000 Antwerpen - kabel 30 m", /Proefstraat, nr\. 12/, /kabel 30 m/],
  ]) {
    const k = kaart(titel);
    assert.match(getoond(k), nummer, titel);
    assert.doesNotMatch(getoond(k), /weggelaten/, titel);
    assert.match(getoond(k), wat, `${titel}: een publiek project houdt zijn tekst`);
    const huis = kaart(titel, { occupancyTypes: ["Andere"] });
    assert.match(getoond(huis), nummer, titel);
    assert.doesNotMatch(getoond(huis), /weggelaten|voetpadkast|herstelling|kabel 30/, `${titel}: één huis`);
    assert.doesNotMatch(Object.fromEntries(huis.regels).Wat, /Volgens de beheerder|De beheerder schrijft/, titel);
  }
  // Een huisnummer op een andere straat dan die van de kaart: geen huis van dit werk, de tekst blijft met het nummer.
  for (const [titel, nummer] of [
    ["Vervangen voetpadkast ter hoogte van nr 31 Voorbeeldlaan", /ter hoogte van nr 31/],
    ["Voetpadkast thv 31 - Voorbeeldlaan", /thv 31/],
    ["Voorbeeldlaan nr. 7 bus 2 - herstelling", /nr\. 7 bus 2/],
    ["2020 ANTWERPEN, PROEFBROEK 4B_BIS - herstelling", /4B_BIS/],
  ]) {
    const k = kaart(titel);
    assert.match(getoond(k), nummer, titel);
    assert.doesNotMatch(getoond(k), /weggelaten/, titel);
    assert.match(Object.fromEntries(k.regels).Wat, /Volgens de beheerder|De beheerder schrijft/, `${titel}: de rest van de tekst blijft`);
  }
  // "Volgens de beheerder" zegt wat het werk is, niet waar: een stuk dat alleen een huisnummer is, staat er niet in.
  assert.doesNotMatch(Object.fromEntries(kaart("Proefstraat thv 31 - vervangen voetpadkast").regels).Wat, /thv|31/);
  // Een postcode, een maat, een reeks en een volgnummer blijven in de tekst van de beheerder, net als een los nummer.
  for (const tekst of ["Proefstraat 12, 2000 Antwerpen - kabel 30 m", "Fase 2: Voorbeeldlaan 4 en Proefstraat 6-8", ...["13 tem 15", "13-15", "13 t.e.m. 15", "13, 15 en 17", "thv 13-15"].map((reeks) => `Proefstraat ${reeks} - werken`)]) {
    assert.equal(ku.beheerderTekst(tekst, { straten: ["Proefstraat"] }), tekst, tekst);
  }
  assert.match(kaart("Proefstraat 13 tem 15 - vervangen voetpadkast").bronTekst, /Proefstraat 13 tem 15/);
  // De fasen: een los nummer en een reeks blijven.
  const fase = (description, dag) => ({ description, start: `2026-10-0${dag}T06:00:00Z`, end: `2026-10-0${dag}T16:00:00Z`, consequences: [] });
  const fasen = kaart("Herstelling voetpad Proefstraat 2-20", { hindrance: { start: "2026-10-01T06:00:00Z", end: "2026-10-09T16:00:00Z", consequences: [], phases: [fase("Fase 1 Proefstraat 8", 1), fase("Fase 2 Proefstraat 8-14", 6)] } });
  assert.match(Object.fromEntries(fasen.regels).Fasen, /^Fase 1 Proefstraat 8 \(.+\) · Fase 2 Proefstraat 8-14 \(/);
  // Bus en tram: de omschrijving zoals de beheerder ze schreef, ook met één huisnummer bij een publiek project (nakijkronde van
  // head c4bb2927: "Proefstraat 21 - herstelling tramspoor" verloor die regel); bij één huis niet (dan alleen de gevolgen).
  const tram = kaart("Proefstraat 21-25 - herstelling tramspoor");
  assert.equal(Object.fromEntries(tram.regels)["Bus en tram"], "Proefstraat 21-25 - herstelling tramspoor");
  assert.equal(Object.fromEntries(kaart("Proefstraat 21 - herstelling tramspoor").regels)["Bus en tram"], "Proefstraat 21 - herstelling tramspoor");
  assert.equal(Object.fromEntries(kaart("Proefstraat 21 - herstelling tramspoor", { occupancyTypes: ["Container"] }).regels)["Bus en tram"], undefined);
});

// ---------- 4. een evenement van vandaag staat bovenaan "Loopt nu" ----------
test("4. in \"Loopt nu\" staan de evenementen van vandaag boven de lopende werven en werfzones", async () => {
  const { groupForList, periodRange } = await import("../site/place-core.js");
  const vandaag = "2026-10-10";
  const werf = { uid: "werf", group: "werken", title: "Werf Proefstraat", start: "2026-09-01", end: "2026-10-10" };
  const zone = { uid: "zone", group: "werken", title: "Werfzone Voorbeeldlaan", start: "2026-10-01", end: "2026-10-12" };
  const koers = { uid: "koers", group: "evenementen", title: "Proefkoers", start: "2026-10-09", end: "2026-10-11", innameStart: "2026-10-08", innameEind: "2026-10-11" };
  const foor = { uid: "foor", group: "evenementen", title: "Proeffoor", start: "2026-10-03", end: "2026-10-18" };
  const opbouw = { uid: "opbouw", group: "evenementen", title: "Opbouw van een later feest", start: "2026-10-13", end: "2026-10-13", innameStart: "2026-10-08", innameEind: "2026-10-14" };
  const { running, doorlopend } = groupForList([werf, zone, opbouw, foor, koers], { ...periodRange("alles", vandaag), today: vandaag });
  // Een foor van 16 dagen loopt twee weken of langer: die staat in een eigen groep "Doorlopend", niet
  // als evenement van vandaag bovenaan (klacht van de eigenaar op 10-10-2026: maand- en jaardossiers met
  // "Vandaag"). Wat vandaag echt gebeurt, de koers, blijft bovenaan "Loopt nu".
  assert.deepEqual(running.map((e) => e.uid), ["koers", "werf", "zone", "opbouw"]);
  assert.deepEqual(doorlopend.map((e) => e.uid), ["foor"]);
});

// De visuele hertest vond het geval dat toets 4 niet zag: een evenement van één dag (begin = einde =
// vandaag, zoals een koers of een stoet) stond in een aparte sectie "Vandaag" ná 15 lopende werven en
// werfzones, niet bovenaan "Loopt nu". Met opbouw en afbraak (A-Sign) en zonder (de kalender).
test("4b. ook een evenement van één dag vandaag staat bovenaan \"Loopt nu\", niet in een sectie eronder", async () => {
  const { groupForList, periodRange } = await import("../site/place-core.js");
  const vandaag = "2026-10-10";
  const werven = Array.from({ length: 15 }, (_, i) => ({ uid: `werf${i}`, group: "werken", title: `Werf ${i}`, start: "2026-09-01", end: `2026-10-${String(11 + i).padStart(2, "0")}` }));
  // Zoals evenementEntry een dossier van één dag geeft: start = de dag, geen einde, opbouw en afbraak errond.
  const koers = { uid: "koers", group: "evenementen", title: "Proefkoers", start: vandaag, end: "", innameStart: "2026-10-09", innameEind: "2026-10-11" };
  const stoet = { uid: "stoet", group: "evenementen", title: "Proefstoet", start: vandaag, end: "", innameStart: vandaag, innameEind: vandaag };
  const feest = { uid: "feest", group: "evenementen", title: "Buurtfeest Voorbeeldlaan", start: vandaag, end: "", time: "14:00" };
  const foor = { uid: "foor", group: "evenementen", title: "Proeffoor", start: "2026-10-03", end: "2026-10-18" };
  const morgen = { uid: "morgen", group: "evenementen", title: "Feest morgen", start: "2026-10-11", end: "" };
  const handmatig = { uid: "handmatig", group: "werken", title: "Heraanleg", start: "2026-08-03", openEnd: true };
  const { running, days, doorlopend } = groupForList([...werven, handmatig, morgen, foor, feest, stoet, koers], { ...periodRange("alles", vandaag), today: vandaag });
  assert.deepEqual(running.slice(0, 3).map((e) => e.uid), ["feest", "stoet", "koers"]);
  assert.equal(running.at(-1).uid, "handmatig", "iets zonder einde komt achteraan");
  assert.equal(running.length, 3 + 15 + 1);
  assert.deepEqual(doorlopend.map((e) => e.uid), ["foor"], "de foor van 16 dagen staat in de groep Doorlopend");
  assert.deepEqual(days.map(([d, l]) => [d, l.map((e) => e.uid)]), [["2026-10-11", ["morgen"]]], "geen aparte sectie voor vandaag");
});

// ---------- 5. de uren van de Sinterklaasstoet in Ekeren (ET2026004916) ----------
// Beide besluiten van het districtscollege van Ekeren (2024 en 2025) zeggen 14.00 tot 17.00 uur, niet
// 13.30 uur. Voor 2026 is er nog geen besluit: de uren staan als noot bij een vermoeden, niet als feit.
test("5. Ekeren: de noot noemt 14.00 tot 17.00 uur uit de besluiten, met de besluiten als bron", async () => {
  const { evenementKaartje, evenementFeiten } = await import("../site/kaart-uitleg.js");
  const doc = JSON.parse(fs.readFileSync(new URL("../site/sources/evenement-identiteit.json", import.meta.url), "utf8"));
  const id = doc.dossiers.ET2026004916;
  assert.ok(id, "de fiche ET2026004916 bestaat");
  assert.equal(id.zekerheid, "waarschijnlijk");
  assert.equal(id.uren, "", "voor 2026 is er nog geen besluit: geen uren als feit");
  assert.match(id.urenNoot, /14\.00 tot 17\.00 uur/);
  assert.doesNotMatch(JSON.stringify(id), /13\.30/);
  assert.ok(id.bron.filter((b) => b.startsWith("https://ebesluit.antwerpen.be/zittingen/")).length >= 2, "de twee besluiten staan bij de bronnen");
  const rij = { kind: "iod", reference: "ET2026004916", dossierType: "ETL", phase: "Evenement", innameType: "Parcours", start: "2026-11-28", end: "2026-11-28", streets: [{ name: "Proefstraat" }], status: "aanvraag_goedgekeurd" };
  const k = evenementKaartje(evenementFeiten([rij]), { vandaag: "2026-10-10", identiteit: id });
  const wanneer = Object.fromEntries(k.kern).Wanneer;
  assert.match(wanneer, /14\.00 tot 17\.00 uur/);
  assert.doesNotMatch(wanneer, /13\.30/);
});

// ---------- 6. kleine punten ----------
test("6a. de tegel \"vergunningen\" telt geen terrassen mee; terrassen staan er apart bij", async () => {
  const { permitEntry, terrasEntries, summarize } = await import("../site/place-core.js");
  const aanvragen = [1, 2, 3].map((i) => permitEntry({ id: `permit:${i}`, dossier: `OMV_20260000${i}0`, streets: [{ name: "Proefstraat" }] }));
  const terrassen = terrasEntries([1, 2].map((i) => ({ id: `terrace:${i}`, address: `Voorbeeldplein ${i}`, terraceType: "Terras", status: "vergund" })));
  const som = summarize([...aanvragen, ...terrassen], "2026-10-10");
  assert.equal(som.vergunningen, 3);
  assert.equal(som.terrassen, 2);
  const view = css("place-view.js");
  assert.match(view, /summary\.terrassen \? ` \(\+ \$\{summary\.terrassen\} \$\{summary\.terrassen === 1 \? "terras" : "terrassen"\}\)`/);
});

test("6b. na het kiezen van een plek krijgt de kop de focus zonder kader (e2e: gsm-opmaak)", () => {
  const view = css("place-view.js");
  assert.match(view, /titleEl\.classList\.add\("pv-stil"\);\s*titleEl\.focus\(/);
  assert.match(view, /addEventListener\("blur", \(\) => titleEl\.classList\.remove\("pv-stil"\)\)/);
  assert.match(regel(".pv-head h2.pv-stil:focus").outline, /^none$/);
  // De gewone focusrand van de kop (voor wie er anders komt) blijft.
  assert.match(regel(".pv-head h2:focus").outline, /3px solid/);
});
