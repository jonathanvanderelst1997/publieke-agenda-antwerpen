// De publieke agenda om te volgen (bouwrij lijst 23, punt 10): lib/kalenderfeed.mjs maakt per soort een .ics die een
// agenda volgt (site/kalender/<slug>.ics), met vaste UID's zodat een wijziging in de agenda van bewoners meekomt, en de
// vaste regels van de publieke agenda: het exacte huisnummer, nooit een reden, het woord verhuis of een naam, niets van
// N-VA of andere politiek, en een activiteit van de provincie alleen met de link, met wat er over inschrijven gezegd is
// en nooit als ze volzet is. Alleen verzonnen punten en straten; geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  KALENDER_DIR,
  KALENDER_FEEDS,
  SOORT_SLUGS,
  bouwKalenderfeeds,
  eindeVan,
  feedUrl,
  validateKalenderfeed,
  webcalUrl,
} from "../lib/kalenderfeed.mjs";
import { loadExpandedAgendaItems, loadRefreshEngine } from "../scripts/agenda-source.mjs";
import { ruweGipodLinksIn } from "../site/gipod-bron.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { buildIndividualIcs, escapeText } = globalThis.AgendaIcs;
const uitgaan = globalThis.PublicAgendaUitgaan;

const ASOF = "2099-05-01";
const GENERATED_AT = "2099-05-01T04:00:00.000Z";

const record = (extra = {}) => ({
  id: "kal-buurtfeest-2099-05-02",
  title: "Buurtfeest op het Voorbeeldplein",
  info: "Muziek, eten en spelletjes.",
  date: "2099-05-02",
  endDate: null,
  dateLabel: "2 mei 2099",
  timeText: "14 tot 18 uur",
  timeSlot: "14:00",
  location: "Voorbeeldplein 12, 2000 Antwerpen",
  theme: "Activiteit",
  scope: "district",
  inDistrict: true,
  sourceId: "district-kalender",
  sourcePublisher: "District Antwerpen",
  bronnen: [{ url: "https://www.antwerpen.be/info/voorbeeld/buurtfeest", label: "Districtskalender" }],
  attributie: "Bron: district Antwerpen",
  ...extra,
});
const actueel = (extra = {}, itemExtra = {}) => {
  const r = record(extra);
  return { item: { ...r, link: r.bronnen[0]?.url ?? "", ...itemExtra }, record: r, pagina: true };
};
const bouw = (lijst, verleden = []) => bouwKalenderfeeds({ actueel: lijst, verleden, asOf: ASOF, generatedAt: GENERATED_AT });
const feed = (resultaat, slug) => resultaat.feeds.find((f) => f.slug === slug);
const ontvouwen = (tekst) => tekst.replace(/\r\n[ \t]/g, "");
const events = (tekst) => ontvouwen(tekst).split("BEGIN:VEVENT").slice(1).map((blok) => blok.split("END:VEVENT")[0]);
const uids = (tekst) => events(tekst).map((e) => /\r\nUID:([^\r\n]+)/.exec(e)?.[1]);
const veld = (event, naam) => new RegExp(`\\r\\n${naam}(?:;[^:\\r\\n]*)?:([^\\r\\n]*)`).exec(event)?.[1];
const ALLE_SLUGS = ["agenda", "uitgaan", ...Object.values(SOORT_SLUGS), "stad"];

test("één feed per soort, met vaste adressen", () => {
  assert.deepEqual(KALENDER_FEEDS.map((f) => f.slug).sort(), [...ALLE_SLUGS].sort());
  // Elke soortknop van de site heeft een feed, en geen adres verandert als een knop een andere naam krijgt.
  assert.deepEqual(Object.keys(SOORT_SLUGS).sort(), uitgaan.categories.map((c) => c.key).sort());
  for (const slug of ALLE_SLUGS) assert.match(slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.equal(feedUrl("agenda"), "https://mijn-publieke-agenda-voor-district.onrender.com/kalender/agenda.ics");
  assert.equal(webcalUrl("agenda"), "webcal://mijn-publieke-agenda-voor-district.onrender.com/kalender/agenda.ics");
});

test("elke feed is een geldige kalender, en dezelfde invoer geeft dezelfde feeds", () => {
  const lijst = [actueel(), actueel({ id: "kal-lezing-2099-05-03", title: "Lezing in de bib", date: "2099-05-03", dateLabel: "3 mei 2099", timeSlot: "Info", timeText: "" })];
  const a = bouw(lijst);
  const b = bouw(structuredClone(lijst));
  assert.deepEqual(a.feeds.map((f) => f.tekst), b.feeds.map((f) => f.tekst));
  for (const f of a.feeds) {
    const controle = validateKalenderfeed(f.tekst);
    assert.deepEqual(controle.fouten, [], f.slug);
    assert.equal(controle.aantal, f.aantal, f.slug);
    assert.match(f.tekst, /^BEGIN:VCALENDAR\r\n/);
    assert.match(ontvouwen(f.tekst), new RegExp(`\\r\\nSOURCE;VALUE=URI:${feedUrl(f.slug).replace(/[.]/g, "\\.")}\\r\\n`));
    assert.match(f.tekst, /\r\nREFRESH-INTERVAL;VALUE=DURATION:PT6H\r\n/);
    assert.match(f.tekst, /\r\nX-WR-TIMEZONE:Europe\/Brussels\r\n/);
  }
  assert.equal(feed(a, "agenda").aantal, 2);
  assert.match(feed(a, "agenda").tekst, /\r\nDTSTAMP:20990501T040000Z\r\n/);
  // Een lege feed blijft een geldige kalender om te volgen.
  const leeg = feed(a, "wekelijkse-markten");
  assert.equal(leeg.aantal, 0);
  assert.equal(validateKalenderfeed(leeg.tekst).valid, true);
  assert.doesNotMatch(leeg.tekst, /BEGIN:VTIMEZONE/);
});

test("een punt heeft in de feed dezelfde vaste UID als in zijn losse .ics", () => {
  const punt = actueel();
  const uid = uids(feed(bouw([punt]), "agenda").tekst)[0];
  assert.equal(uid, "kal-buurtfeest-2099-05-02@mijn-publieke-agenda-voor-district.local");
  const los = buildIndividualIcs(punt.item, { now: GENERATED_AT });
  assert.ok(ontvouwen(los).includes(`\r\nUID:${uid}\r\n`));
  // Een ander uur of een andere plaats verandert de UID niet: de agenda van de bewoner werkt het punt bij.
  const gewijzigd = actueel({ timeSlot: "15:00", timeText: "15 tot 19 uur", location: "Voorbeeldplein 14, 2000 Antwerpen" });
  assert.equal(uids(feed(bouw([gewijzigd]), "agenda").tekst)[0], uid);
});

test("uren: het einde uit de tijdtekst, anders één uur; meerdaags of zonder uur de hele dag", () => {
  assert.equal(eindeVan("14:00", "14 tot 18 uur", "2099-05-02"), "20990502T180000");
  assert.equal(eindeVan("11:30", "11.30 tot 16.30 uur", "2099-05-02"), "20990502T163000");
  assert.equal(eindeVan("19:00", "van 19 tot 2 uur", "2099-05-02"), "20990503T020000");
  assert.equal(eindeVan("20:00", "20 tot 24 uur", "2099-12-31"), "21000101T000000");
  // Een uur van een ander deel ("kratstapelen van 12 tot 17 uur" bij een start om 10 uur) is niet het einde.
  assert.equal(eindeVan("10:00", "12 tot 17 uur", "2099-05-02"), "");
  assert.equal(eindeVan("14:00", "14 en 16 uur", "2099-05-02"), "");
  assert.equal(eindeVan("Info", "14 tot 18 uur", "2099-05-02"), "");

  const resultaat = bouw([
    actueel(),
    actueel({ id: "kal-concert-2099-05-04", title: "Concert", date: "2099-05-04", timeSlot: "20:00", timeText: "om 20 uur" }),
    actueel({ id: "kal-expo-2099-05-05", title: "Expo", date: "2099-05-05", endDate: "2099-05-09", timeSlot: "10:00", timeText: "10 tot 17 uur" }),
    actueel({ id: "kal-oproep-2099-05-06", title: "Oproep", date: "2099-05-06", timeSlot: "Info", timeText: "" }),
  ]);
  const perId = new Map(events(feed(resultaat, "agenda").tekst).map((e) => [veld(e, "UID").split("@")[0], e]));
  const buurtfeest = perId.get("kal-buurtfeest-2099-05-02");
  assert.match(buurtfeest, /\r\nDTSTART;TZID=Europe\/Brussels:20990502T140000\r\n/);
  assert.match(buurtfeest, /\r\nDTEND;TZID=Europe\/Brussels:20990502T180000\r\n/);
  assert.match(perId.get("kal-concert-2099-05-04"), /\r\nDURATION:PT1H\r\n/);
  // Meerdaags: de hele periode, de laatste dag inbegrepen (DTEND is exclusief), het uur in de beschrijving.
  const expo = perId.get("kal-expo-2099-05-05");
  assert.match(expo, /\r\nDTSTART;VALUE=DATE:20990505\r\n/);
  assert.match(expo, /\r\nDTEND;VALUE=DATE:20990510\r\n/);
  assert.match(veld(expo, "DESCRIPTION"), /Wanneer: 10 tot 17 uur/);
  assert.match(perId.get("kal-oproep-2099-05-06"), /\r\nDTSTART;VALUE=DATE:20990506\r\nDTEND;VALUE=DATE:20990507\r\n/);
  assert.match(feed(resultaat, "agenda").tekst, /BEGIN:VTIMEZONE/);
});

test("het exacte huisnummer blijft staan, een naam na een dossiercode niet", () => {
  const punt = actueel({ info: "Opbouw volgens dossier DNW12345678_Jan Peeters LS_kabel, Voorbeeldplein 12-14." });
  const resultaat = bouw([punt]);
  assert.deepEqual(resultaat.geweigerd, []);
  const event = events(feed(resultaat, "agenda").tekst)[0];
  assert.equal(veld(event, "LOCATION"), escapeText("Voorbeeldplein 12, 2000 Antwerpen"));
  const beschrijving = veld(event, "DESCRIPTION");
  assert.match(beschrijving, /Voorbeeldplein 12-14/);
  assert.match(beschrijving, /DNW12345678_ LS_kabel/);
  assert.doesNotMatch(beschrijving, /Peeters/);
  // De bron, de pagina op de site en de naamsvermelding staan erbij.
  assert.match(beschrijving, /Districtskalender: https:\/\/www\.antwerpen\.be\/info\/voorbeeld\/buurtfeest/);
  assert.match(beschrijving, /Op de publieke agenda: https:\/\/mijn-publieke-agenda-voor-district\.onrender\.com\/event\/kal-buurtfeest-2099-05-02\//);
  assert.equal(veld(event, "URL"), "https://mijn-publieke-agenda-voor-district.onrender.com/event/kal-buurtfeest-2099-05-02/");
  assert.equal(veld(event, "TRANSP"), "TRANSPARENT");
});

test("de poort: nooit verhuis, contactgegevens, politiek of UiTdatabank in een feed", () => {
  const geweigerd = {
    "kal-verhuis-2099-05-02": actueel({ id: "kal-verhuis-2099-05-02", title: "Verhuis in de Proefstraat" }),
    "kal-mail-2099-05-02": actueel({ id: "kal-mail-2099-05-02", info: "Inschrijven via info@voorbeeld.test." }),
    "kal-telefoon-2099-05-02": actueel({ id: "kal-telefoon-2099-05-02", info: "Bel 03 123 45 67." }),
    "kal-nva-2099-05-02": actueel({ id: "kal-nva-2099-05-02", title: "Nieuwjaarsreceptie N-VA district Antwerpen" }),
    "kal-belang-2099-05-02": actueel({ id: "kal-belang-2099-05-02", info: "Een avond van Vlaams Belang." }),
    "kal-vld-2099-05-02": actueel({ id: "kal-vld-2099-05-02", title: "Open Vld praat met de buurt" }),
    "kal-cdenv-2099-05-02": actueel({ id: "kal-cdenv-2099-05-02", title: "Wijkbabbel met CD&V" }),
    "kal-debat-2099-05-02": actueel({ id: "kal-debat-2099-05-02", title: "Verkiezingsdebat in de bib" }),
    "kal-partijsite-2099-05-02": actueel({ id: "kal-partijsite-2099-05-02", title: "Buurtwandeling", bronnen: [{ url: "https://antwerpen.n-va.be/agenda/wandeling", label: "Officiële bron" }] }),
    "kal-groensite-2099-05-02": actueel({ id: "kal-groensite-2099-05-02", title: "Fietstocht", bronnen: [{ url: "https://www.groen.be/fietstocht", label: "Officiële bron" }] }),
    "kal-uit-2099-05-02": actueel({ id: "kal-uit-2099-05-02", sourceId: "stad-uit", scope: "stad", inDistrict: true }),
  };
  // "groen" en "vooruit" zijn gewone woorden (zoals in de Gateway): die houden een punt niet tegen.
  const blijft = [
    actueel({ id: "kal-groen-2099-05-02", title: "Groen in de buurt: plantactie" }),
    actueel({ id: "kal-vooruit-2099-05-02", title: "Vooruit met de fiets: fietsherstel" }),
    actueel({ id: "kal-zitting-2099-05-02", title: "Districtsraad", sourceId: "district-vergaderingen" }),
  ];
  const resultaat = bouw([...Object.values(geweigerd), ...blijft]);
  assert.deepEqual(resultaat.geweigerd.map((g) => g.id).sort(), Object.keys(geweigerd).sort());
  const codes = new Map(resultaat.geweigerd.map((g) => [g.id, g.problemen.join("; ")]));
  assert.match(codes.get("kal-verhuis-2099-05-02"), /privacy verhuis/);
  assert.match(codes.get("kal-mail-2099-05-02"), /privacy at_sign/);
  assert.match(codes.get("kal-telefoon-2099-05-02"), /privacy phone_number/);
  for (const id of ["kal-nva-2099-05-02", "kal-belang-2099-05-02", "kal-vld-2099-05-02", "kal-cdenv-2099-05-02", "kal-debat-2099-05-02", "kal-partijsite-2099-05-02", "kal-groensite-2099-05-02"]) {
    assert.match(codes.get(id), /politiek/, id);
  }
  assert.match(codes.get("kal-uit-2099-05-02"), /UiTdatabank/);
  // De codes zeggen nooit wat er stond (de logs van de build zijn publiek).
  for (const g of resultaat.geweigerd) assert.doesNotMatch(g.problemen.join(" "), /Peeters|N-VA|Vlaams Belang|voorbeeld\.test|123 45 67/);
  const alles = resultaat.feeds.map((f) => f.tekst).join("\n");
  for (const id of Object.keys(geweigerd)) assert.ok(!alles.includes(id), id);
  assert.deepEqual(uids(feed(resultaat, "agenda").tekst).map((uid) => uid.split("@")[0]).sort(), blijft.map((p) => p.record.id).sort());
});

test("provincie: alleen met de link en met wat er over inschrijven gezegd is, nooit volzet", () => {
  const provincie = (id, extra = {}) => actueel({
    id,
    title: "Wandeling in het provinciedomein",
    sourceId: "provincie-antwerpen",
    sourcePublisher: "Provincie Antwerpen",
    bronnen: [{ url: "https://www.provincieantwerpen.be/activiteiten/wandeling", label: "Provincie Antwerpen" }],
    ...extra,
  });
  const resultaat = bouw([
    provincie("prov-ok-2099-05-02", { info: "Gratis, vooraf inschrijven via de provincie." }),
    provincie("prov-volzet-2099-05-02", { info: "Inschrijven via de provincie. Volzet." }),
    provincie("prov-zwijgt-2099-05-02", { info: "Een wandeling met gids." }),
    provincie("prov-zonderlink-2099-05-02", { info: "Vrije toegang.", bronnen: [] }),
    // Ook een punt van een andere bron dat naar de provincie linkt, is een activiteit van de provincie.
    actueel({ id: "prov-link-2099-05-02", info: "Een wandeling met gids.", bronnen: [{ url: "https://www.provincieantwerpen.be/x", label: "Officiële bron" }] }),
  ]);
  const codes = new Map(resultaat.geweigerd.map((g) => [g.id, g.problemen.join("; ")]));
  assert.deepEqual([...codes.keys()].sort(), ["prov-link-2099-05-02", "prov-volzet-2099-05-02", "prov-zonderlink-2099-05-02", "prov-zwijgt-2099-05-02"]);
  assert.match(codes.get("prov-volzet-2099-05-02"), /provincie volzet/);
  assert.match(codes.get("prov-zwijgt-2099-05-02"), /inschrijven/);
  assert.match(codes.get("prov-zonderlink-2099-05-02"), /provincie zonder link/);
  const event = events(feed(resultaat, "agenda").tekst)[0];
  assert.equal(veld(event, "UID"), "prov-ok-2099-05-02@mijn-publieke-agenda-voor-district.local");
  const beschrijving = veld(event, "DESCRIPTION");
  assert.match(beschrijving, /inschrijven via de provincie/);
  assert.match(beschrijving, /Provincie Antwerpen: https:\/\/www\.provincieantwerpen\.be\/activiteiten\/wandeling/);
  assert.match(beschrijving, /of je moet inschrijven en of er nog plaats is/);
});

test("een aanvraag die de stad nog niet goedkeurde, staat erin als voorlopig", () => {
  const resultaat = bouw([actueel({}, { nietGoedgekeurd: true })]);
  const event = events(feed(resultaat, "agenda").tekst)[0];
  assert.equal(veld(event, "STATUS"), "TENTATIVE");
  assert.equal(veld(event, "SUMMARY"), "Buurtfeest op het Voorbeeldplein (aanvraag\\, nog niet goedgekeurd)");
  assert.match(veld(event, "DESCRIPTION"), /nog niet goedkeurde/);
  assert.equal(veld(events(feed(bouw([actueel()]), "agenda").tekst)[0], "STATUS"), "CONFIRMED");
});

test("district, soorten en stad zoals de knoppen van de site", () => {
  const markt = actueel({ id: "markt-voorbeeldplein-2099-05-03", title: "Gemengde markt Voorbeeldplein", info: "Openbare markt van de stad.", date: "2099-05-03", timeSlot: "08:00", timeText: "8 tot 13 uur", theme: "Activiteit", scope: "stad", inDistrict: true, sourceId: "stad-markten", sourcePublisher: "Stad Antwerpen" });
  const marktElders = actueel({ id: "markt-elders-2099-05-03", title: "Markt elders", info: "Openbare markt van de stad.", scope: "stad", inDistrict: false, sourceId: "stad-markten", sourcePublisher: "Stad Antwerpen" });
  const koopzondag = actueel({ id: "koopzondag-2099-05-04", title: "Koopzondag", date: "2099-05-04", timeSlot: "Info", timeText: "", scope: "stad", inDistrict: true, sourceId: "stad-koopzondagen", sourcePublisher: "Stad Antwerpen" });
  const zitting = actueel({ id: "zitting-2099-05-05", title: "Districtsraad", date: "2099-05-05", timeSlot: "19:00", timeText: "19 uur", sourceId: "district-vergaderingen" });
  const elders = actueel({ id: "theater-elders-2099-05-06", title: "Theatervoorstelling", date: "2099-05-06", scope: "stad", inDistrict: false, sourceId: "stad-districten", sourcePublisher: "Stad Antwerpen" });
  const buurtfeest = actueel();
  const resultaat = bouw([markt, marktElders, koopzondag, zitting, elders, buurtfeest]);
  assert.deepEqual(resultaat.geweigerd, []);
  const ids = (slug) => uids(feed(resultaat, slug).tekst).map((uid) => uid.split("@")[0]).sort();
  // Alles in het district, behalve de weekmarkten; de koopzondag van de stad in het district hoort erbij.
  assert.deepEqual(ids("agenda"), ["kal-buurtfeest-2099-05-02", "koopzondag-2099-05-04", "zitting-2099-05-05"]);
  assert.deepEqual(ids("wekelijkse-markten"), ["markt-voorbeeldplein-2099-05-03"]);
  assert.deepEqual(ids("uitgaan"), ["kal-buurtfeest-2099-05-02", "koopzondag-2099-05-04"]);
  assert.deepEqual(ids("raad-en-commissies"), ["zitting-2099-05-05"]);
  assert.deepEqual(ids("koopzondag"), ["koopzondag-2099-05-04"]);
  assert.deepEqual(ids("buurt-en-straat"), ["kal-buurtfeest-2099-05-02"]);
  assert.deepEqual(ids("stad"), ["theater-elders-2099-05-06"]);
  // Een weekmarkt buiten het district staat in geen enkele feed.
  assert.ok(!resultaat.feeds.some((f) => f.tekst.includes("markt-elders-2099-05-03")));
  const marktEvent = events(feed(resultaat, "wekelijkse-markten").tekst)[0];
  assert.equal(veld(marktEvent, "CATEGORIES"), "Wekelijkse markten");
  assert.match(marktEvent, /\r\nDTEND;TZID=Europe\/Brussels:20990503T130000\r\n/);
});

test("verleden: de laatste maand blijft in de feed, wat wegviel of opging niet", () => {
  const verleden = [
    { ...record({ id: "kal-vorige-week-2099-04-24", date: "2099-04-24", dateLabel: "24 april 2099" }), sinds: "2099-04-01" },
    { ...record({ id: "kal-lang-geleden-2099-03-01", date: "2099-03-01", dateLabel: "1 maart 2099" }), sinds: "2099-02-01" },
    { ...record({ id: "kal-weg-2099-04-25", date: "2099-04-25", dateLabel: "25 april 2099" }), sinds: "2099-04-01", weg: "2099-04-20" },
    { ...record({ id: "kal-opgegaan-2099-04-26", date: "2099-04-26", dateLabel: "26 april 2099" }), sinds: "2099-04-01", opgegaanIn: "kal-buurtfeest-2099-05-02" },
    // Een punt dat nog actueel is, staat er één keer (als actueel punt).
    { ...record(), sinds: "2099-04-01" },
  ];
  const resultaat = bouw([actueel()], verleden);
  assert.deepEqual(resultaat.geweigerd, []);
  const ids = uids(feed(resultaat, "agenda").tekst).map((uid) => uid.split("@")[0]);
  assert.deepEqual(ids, ["kal-vorige-week-2099-04-24", "kal-buurtfeest-2099-05-02"]);
});

test("de echte feeds in site/kalender: geldig, privacyveilig en met de plaats van de site", () => {
  for (const { slug } of KALENDER_FEEDS) {
    const bestand = path.join(root, KALENDER_DIR, `${slug}.ics`);
    assert.ok(fs.existsSync(bestand), `${slug}.ics ontbreekt: draai npm run build`);
    const tekst = fs.readFileSync(bestand, "utf8");
    const controle = validateKalenderfeed(tekst);
    assert.deepEqual(controle.fouten, [], slug);
    const plat = ontvouwen(tekst);
    assert.deepEqual(ruweGipodLinksIn(plat), [], slug);
    assert.doesNotMatch(plat, /verhui[sz]/i, slug);
    assert.doesNotMatch(plat, /\b(n-?va|vlaams belang|cd&v|open ?vld|pvda)\b/i, slug);
    // Geen e-mailadres: de enige @ is die van de UID.
    assert.doesNotMatch(plat, /mailto:|@(?!mijn-publieke-agenda-voor-district\.local\r\n)/i, slug);
  }
  // Elk punt in de hoofdfeed staat er met de plaats zoals de site ze toont: het huisnummer blijft.
  const engine = loadRefreshEngine(root);
  const publiek = engine.reconcileAgendaItems(loadExpandedAgendaItems(root), engine.config.classificationAsOf).publicItems;
  const perUid = new Map(publiek.map((item) => [`${item.id}@mijn-publieke-agenda-voor-district.local`, item]));
  const hoofd = events(fs.readFileSync(path.join(root, KALENDER_DIR, "agenda.ics"), "utf8"));
  let vergeleken = 0;
  for (const event of hoofd) {
    const item = perUid.get(veld(event, "UID"));
    if (!item?.location || /\b[A-Z]{2,6}\d{4,}_/.test(item.location)) continue;
    assert.equal(veld(event, "LOCATION"), escapeText(item.location), item.id);
    vergeleken += 1;
  }
  assert.ok(vergeleken > 0, "geen enkel actueel punt in de hoofdfeed");
});

test("de knop op de site en de uitleg op /kalender/ wijzen naar de feeds die de build maakt", () => {
  const index = fs.readFileSync(path.join(root, "site", "index.html"), "utf8");
  assert.match(index, /<a class="hero-kalender" href="\/kalender\/">[^<]*<span aria-hidden="true">📅<\/span> Volg in je agenda<\/a>/);
  const pagina = fs.readFileSync(path.join(root, "site", "kalender", "index.html"), "utf8");
  const getoond = [...pagina.matchAll(/data-kalender-feed="([a-z0-9-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(getoond, KALENDER_FEEDS.map((f) => f.slug));
  for (const { slug } of KALENDER_FEEDS) {
    assert.ok(pagina.includes(`href="${webcalUrl(slug)}"`), `webcal ${slug}`);
    assert.ok(pagina.includes(`data-kalender-kopieer="${feedUrl(slug)}"`), `kopieer ${slug}`);
    assert.ok(pagina.includes(`href="https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcalUrl(slug))}"`), `google ${slug}`);
  }
  const naam = encodeURIComponent(KALENDER_FEEDS[0].naam);
  for (const host of ["outlook.live.com", "outlook.office.com"]) {
    assert.ok(pagina.includes(`href="https://${host}/calendar/0/addfromweb?url=${encodeURIComponent(feedUrl("agenda"))}&amp;name=${naam}"`), host);
  }
  assert.ok(pagina.includes(`value="${feedUrl("agenda")}"`));
  for (const platform of ["iPhone", "Google Agenda", "Outlook"]) assert.match(pagina, new RegExp(`<summary>[^<]*${platform}`));
  assert.match(pagina, /src="\/agenda-kalender\.js"/);
  assert.ok(fs.existsSync(path.join(root, "site", "agenda-kalender.css")));
});
