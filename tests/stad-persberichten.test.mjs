// De persberichten van de stad (pers.antwerpen.be) als bron `stad-persberichten`. Alles tegen nagebootste antwoorden:
// geen enkel verzoek gaat het net op. De persberichten volgen de opbouw van de echte persruimte (Prezly: JSON-LD
// `NewsArticle` met een auteur, een kop per district, een opsomming "Praktisch", en onder elk stuk een perscontact en
// een verantwoordelijke), met verzonnen namen, nummers en straten.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { teZoekenPlekken } from "../lib/huisnummer-uit-bron.mjs";
import { SOURCE_PRECEDENCE, mergeEvents } from "../lib/merge-events.mjs";
import { privacyFindings, sourceDocument, validateSourceDocument } from "../lib/source-feed.mjs";
import { FETCHERS } from "../lib/source-registry.mjs";
import {
  LEZER_UA, PAUZE_MS, PERS_FEED, PERS_HOST, PERS_ROBOTS, SOURCE_ID, adresIn, blokkenUit, crawlDelayMs, districtVan, dubbelsZoeken, isPersoonlijk,
  leesDatumregel, leesFeed, persberichtLezen, tijdUit,
} from "../lib/stad-persberichten.mjs";
import { metVastAdres } from "../lib/vaste-adressen.mjs";
import { run } from "../scripts/fetch-sources-stad-persberichten.mjs";

const NOW = new Date("2026-11-16T20:00:00.000Z");
const TODAY = "2026-11-16";
const GEPUBLICEERD = "2026-11-16T11:04:00.000Z";
const quiet = () => {};

// ---------- nagebootste persruimte ----------

const ROBOTS = "User-agent: *\nDisallow: /subscribe/*\nDisallow: /unsubscribe\nSitemap: https://pers.antwerpen.be/sitemap.xml";

const feedItem = (slug, titel, datum) => `
    <item>
      <title><![CDATA[${titel}]]></title>
      <link>https://pers.antwerpen.be/${slug}</link>
      <guid isPermaLink="false">${slug}</guid>
      <pubDate>${new Date(datum).toUTCString()}</pubDate>
      <category><![CDATA[Cultuur & Vrije Tijd]]></category>
    </item>`;
const feed = (items) => `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0"><channel><title><![CDATA[Stad Antwerpen's pressreleases]]></title><link>https://pers.antwerpen.be/</link>${items.join("")}</channel></rss>`;

// Een perscontact en een verantwoordelijke zoals de persruimte ze onder elk stuk zet: nooit te lezen of te bewaren.
const CONTACT = `<p><u>Perscontact: Jan Peeters, tel. 0499 12 34 56, </u><a href="mailto:jan.peeters@example.invalid"><u>jan.peeters@example.invalid</u></a><u><br/>&#8203;<!-- -->Verantwoordelijke: Piet Voorbeeld, districtsschepen voor feestelijkheden </u></p>`;

const persbericht = (titel, lijf, datum = GEPUBLICEERD) => `<!DOCTYPE html><html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Stad Antwerpen"}</script>
<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "NewsArticle", headline: titel, description: "Binnenkort doet de Sint de districten aan.", datePublished: datum.replace(".000Z", "+00:00"), author: { "@type": "Person", name: "Nadia Voorbeeld" } })}</script>
</head><body><div><article>
<div><section class="prezly-slate-document" data-version="0.50"><h1 class="prezly-slate-heading">${titel}</h1></section></div>
<div><section class="prezly-slate-document" data-version="0.50">${lijf}</section></div>
</article></div></body></html>`;
const praktisch = (...regels) => `<p><strong>Praktisch</strong></p><div><ul>${regels.map((r) => `<li>${r}</li>`).join("")}</ul></div>`;

const SINT_TITEL = "Hij komt, hij komt in de Antwerpse districten";
const SINT_SLUG = "hij-komt-hij-komt-in-de-antwerpse-districten-lk9vfr";
// Zes districten met elk een dag, een uur en een adres met huisnummer; daarna drie stukken die bij twijfel niets geven.
const SINT = persbericht(SINT_TITEL, `
<p><strong>Afgelopen zaterdag 14 november is Sinterklaas weer hartelijk verwelkomd in Antwerpen. Ook in heel wat Antwerpse districten doet hij binnenkort zijn ronde.</strong></p>
<h4 id="header-berchem">Berchem</h4>
<p>Sinterklaas en zijn Pieten zakken op woensdagnamiddag 2 december af naar Berchem. Om 15 uur worden ze verwacht op het plein. Kinderen en hun familie kunnen hen daar feestelijk verwelkomen en daarna nog lang blijven.</p>
${praktisch("Woensdag 2 december", "Winterbar Proef, Proefplein 6, Berchem", "Aankomst en ontmoeting met de Sint: van 15 tot 16.30 uur")}
${CONTACT}
<h4 id="header-bzl">Berendrecht-Zandvliet-Lillo </h4>
<p>De Sint en zijn Pieten komen op zondag 6 december naar het vrijetijdscentrum voor een voorstelling over de Pietenfabriek.</p>
<div><ul><li>Zondag 6 december om 10.30 uur en 14 uur</li><li>Vrijetijdscentrum Proef, Voorbeeldhoeve 66, Zandvliet</li><li>6 euro (vvk) / 8 euro (kassa) (beide voorstellingen zijn uitverkocht – enkel wachtlijst mogelijk)</li><li><a href="https://vrijetijdscentrum.example.org/pietenfabriek?utm=x"><strong>https://vrijetijdscentrum.example.org/pietenfabriek</strong></a></li></ul></div>
${CONTACT}
<h4 id="header-ekeren">Ekeren </h4>
<p>De Sint begroet alle Ekerse kinderen op het plein. Nadien volgen ze hem naar het kasteel, waar ze hun kleurplaat kunnen afgeven.</p>
<div><ul><li>Zaterdag 28 november om 13.30 uur</li><li>Stoet naar Kasteel Proef (Verzonnenlaan 27)</li><li>Meer info: <a href="https://www.antwerpen.be/nl/overzicht/district-ekeren-1/nieuws/welkom-sinterklaas">www.antwerpen.be</a></li></ul></div>
${CONTACT}
<h4 id="header-hoboken">Hoboken </h4>
<p>Op zaterdag 28 november kan heel het gezin de Sint en zijn Pieten verwelkomen aan de veerpont. Daarna vertrekt een vrolijke stoet naar het park.</p>
<div><ul><li>Zaterdag 28 november van 14 tot 16.30 uur</li><li>Veerpont en Kasteel Bedacht (Testlei 7)</li><li>Gratis, meer info op <a href="https://kasteel.example.org/aankomst-sinterklaas">https://kasteel.example.org/aankomst-sinterklaas</a></li></ul></div>
${CONTACT}
<h4 id="header-merksem">Merksem </h4>
<p>In Merksem verwelkomt de Sint de kinderen in de feestzaal van het district.</p>
<div><ul><li>Zaterdag 5 en zondag 6 december</li><li>Feestzaal Proef, Bedachtstraat 12, Merksem</li><li>Van 10 tot 12 uur</li><li>Inschrijven via de website van het district</li></ul></div>
${CONTACT}
<h4 id="header-wilrijk">Wilrijk </h4>
<p>Sinterklaas komt langs in het centrum van Wilrijk op zaterdag 28 november. Het district zorgt tussen 14 en 17 uur voor een groot Sintfeest op het plein en in het gemeenschapscentrum.</p>
<div><ul><li>Zaterdag 28 november van 14 tot 17 uur</li><li>Plein en gemeenschapscentrum (Fictiefplein 1)</li><li>Gratis</li></ul></div>
${CONTACT}
<h4 id="header-deurne">Deurne </h4>
<p>De Sint trekt twee dagen door de straten voor een stoepbezoek. Ouders schrijven hun kinderen vooraf in.</p>
<div><ul><li>Zaterdag 12 december</li><li>Inschrijven via sint@example.invalid of 0479 26 49 02</li><li>€12 per kind</li></ul></div>
${CONTACT}
<h4 id="header-borgerhout">Borgerhout </h4>
<p>De werken aan het plein lopen in fasen.</p>
<div><ul><li>Maandag 7 december</li><li>Maandag 14 december</li><li>Kioskplein 12, Borgerhout</li></ul></div>
<h4 id="header-borsbeek">Borsbeek </h4>
<div><ul><li>Zaterdag 7 november om 14 uur</li><li>Gemeenteplein 2, Borsbeek</li></ul></div>
`);

const BELEID = persbericht("Stad investeert 10 miljoen euro in nieuwe sporthal", `
<p>De stad bouwde een nieuwe sporthal. De opening is voor het publiek.</p>
${praktisch("Zaterdag 5 december om 10 uur", "Sporthal Proef, Proefstraat 3, Deurne")}
${CONTACT}`);
const COLLEGE = persbericht("Dagorde college van vrijdag 13 november 2026", `<p>De dagorde van het college.</p>${praktisch("Vrijdag 20 november om 9 uur", "Stadhuis Proef, Proefmarkt 1, 2000 Antwerpen")}`);
const PARTIJ = persbericht("Buurtfeest in het park", `<p>Een feest met de afdeling van N-VA.</p>${praktisch("Zaterdag 5 december om 14 uur", "Parkzaal Proef, Proefdreef 4, 2060 Antwerpen")}`);

function makeRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stad-persberichten-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "site", "sources"), { recursive: true });
  return root;
}
const read = (root, sourceId = SOURCE_ID) => JSON.parse(fs.readFileSync(path.join(root, "site", "sources", `${sourceId}.json`), "utf8"));
const write = (root, document) => fs.writeFileSync(path.join(root, "site", "sources", `${document.sourceId}.json`), `${JSON.stringify(document, null, 2)}\n`);

// Een nagebootste persruimte die elk verzoek opschrijft (url, naam, moment), met een klok die alleen vooruit gaat als er
// gewacht wordt.
function persruimte(antwoorden) {
  let t = 0;
  const gevraagd = [];
  const fetch = async (url, init = {}) => {
    gevraagd.push({ url: String(url), ua: new Headers(init.headers).get("user-agent"), op: t, redirect: init.redirect });
    const maak = antwoorden[String(url)];
    return maak ? maak() : new Response("niet gevonden", { status: 404 });
  };
  return { fetch, gevraagd, sleep: async (ms) => { t += ms; } };
}
const SINT_URL = `https://${PERS_HOST}/${SINT_SLUG}`;
const standaard = (extra = {}) => ({
  [PERS_ROBOTS]: () => new Response(ROBOTS, { status: 200 }),
  [PERS_FEED]: () => new Response(feed([
    feedItem(SINT_SLUG, SINT_TITEL, GEPUBLICEERD),
    feedItem("stad-investeert-in-nieuwe-sporthal", "Stad investeert 10 miljoen euro in nieuwe sporthal", "2026-11-12T11:10:00.000Z"),
    feedItem("dagorde-college-van-vrijdag-13-november-2026", "Dagorde college van vrijdag 13 november 2026", "2026-11-12T14:40:00.000Z"),
  ]), { status: 200 }),
  [SINT_URL]: () => new Response(SINT, { status: 200 }),
  [`https://${PERS_HOST}/stad-investeert-in-nieuwe-sporthal`]: () => new Response(BELEID, { status: 200 }),
  [`https://${PERS_HOST}/dagorde-college-van-vrijdag-13-november-2026`]: () => new Response(COLLEGE, { status: 200 }),
  ...extra,
});
const bericht = (titel = SINT_TITEL, slug = SINT_SLUG, gepubliceerd = GEPUBLICEERD) => ({ slug, url: `https://${PERS_HOST}/${slug}`, titel, gepubliceerd });

// ---------- de feed en een persbericht ----------

test("de feed: alleen persberichten op de persruimte zelf, elk één keer, hoogstens tien", () => {
  const xml = feed([
    feedItem(SINT_SLUG, SINT_TITEL, GEPUBLICEERD),
    feedItem(SINT_SLUG, "dubbel", GEPUBLICEERD),
    `<item><title>Elders</title><link>https://www.antwerpen.be/nieuws</link><pubDate>${new Date(GEPUBLICEERD).toUTCString()}</pubDate></item>`,
    `<item><title>Zonder datum</title><link>https://pers.antwerpen.be/zonder-datum</link></item>`,
    ...Array.from({ length: 12 }, (_, i) => feedItem(`bericht-${i}`, `Bericht ${i}`, GEPUBLICEERD)),
  ]);
  const items = leesFeed(xml);
  assert.equal(items.length, 10);
  assert.deepEqual(items[0], { slug: SINT_SLUG, url: SINT_URL, titel: SINT_TITEL, gepubliceerd: GEPUBLICEERD });
  assert.ok(items.every((item) => new URL(item.url).hostname === PERS_HOST));
});

test("het Sinterklaas-voorbeeld: zes activiteiten in zes districten, met dag, uur en adres met huisnummer", () => {
  const { kandidaten, redenen } = persberichtLezen(SINT, bericht(), { retrievedAt: NOW.toISOString() });
  const items = kandidaten.map((k) => k.item);
  assert.equal(items.length, 6);
  assert.deepEqual(
    items.map((i) => [i.title, i.date, i.endDate, i.timeSlot, i.location, i.postcodes, i.inDistrict]),
    [
      [`${SINT_TITEL} (Berchem)`, "2026-12-02", null, "15:00", "Winterbar Proef, Proefplein 6, Berchem", ["2600"], false],
      [`${SINT_TITEL} (Berendrecht-Zandvliet-Lillo)`, "2026-12-06", null, "10:30", "Vrijetijdscentrum Proef, Voorbeeldhoeve 66, Zandvliet", ["2040"], false],
      [`${SINT_TITEL} (Ekeren)`, "2026-11-28", null, "13:30", "Stoet naar Kasteel Proef (Verzonnenlaan 27), Ekeren", ["2180"], false],
      [`${SINT_TITEL} (Hoboken)`, "2026-11-28", null, "14:00", "Veerpont en Kasteel Bedacht (Testlei 7), Hoboken", ["2660"], false],
      [`${SINT_TITEL} (Merksem)`, "2026-12-05", "2026-12-06", "10:00", "Feestzaal Proef, Bedachtstraat 12, Merksem", ["2170"], false],
      [`${SINT_TITEL} (Wilrijk)`, "2026-11-28", null, "14:00", "Plein en gemeenschapscentrum (Fictiefplein 1), Wilrijk", ["2610"], false],
    ]
  );
  // Bij twijfel niets: Deurne heeft geen plaats, Borgerhout twee datumregels, Borsbeek een datum vóór het persbericht.
  assert.deepEqual(redenen, { geen_plaats: 1, meer_dan_een_datum: 1, datum_voorbij: 1 });
  const [berchem, bzl, ekeren, hoboken, merksem] = items;
  assert.equal(berchem.timeText, "van 15 tot 16.30 uur", "het uur van de enige korte regel met een uur");
  assert.equal(bzl.timeText, "om 10.30 uur en 14 uur");
  assert.match(bzl.info, /Inschrijven nodig\. Volzet volgens het persbericht\./, "uitverkocht: volzet, en tickets: inschrijven");
  assert.equal(bzl.infoUrl, "https://vrijetijdscentrum.example.org/pietenfabriek", "de link zonder vraag of anker");
  assert.equal(ekeren.infoUrl, "https://www.antwerpen.be/nl/overzicht/district-ekeren-1/nieuws/welkom-sinterklaas", "een link mag, gevolgd wordt hij nooit");
  assert.equal(hoboken.infoUrl, "https://kasteel.example.org/aankomst-sinterklaas");
  assert.match(merksem.info, /Inschrijven nodig\./);
  assert.ok(!/Volzet/.test(berchem.info));
  for (const item of items) {
    assert.equal(item.sourceUrl, SINT_URL);
    assert.equal(item.kind, "activity");
    assert.match(item.id, /^stad-pers-[a-f0-9]{10}-[a-z0-9-]+-\d{4}-\d{2}-\d{2}$/);
    assert.match(item.info, /^Aangekondigd in een persbericht van stad Antwerpen van 16-11-2026\./);
  }
  const document = sourceDocument(SOURCE_ID, { retrievedAt: NOW.toISOString(), fetchStatus: "ok", items });
  assert.deepEqual(validateSourceDocument(document, { expectedSourceId: SOURCE_ID }), []);
});

test("nooit een persoonsgegeven: geen perscontact, verantwoordelijke, mailadres, telefoon of auteur", () => {
  const blokken = blokkenUit(SINT);
  assert.ok(blokken.length > 10);
  const { kandidaten } = persberichtLezen(SINT, bericht(), { retrievedAt: NOW.toISOString() });
  const tekst = JSON.stringify({ blokken, items: kandidaten.map((k) => k.item) });
  for (const verboden of ["@", "0499", "0479", "Peeters", "Piet Voorbeeld", "Verantwoordelijke", "Perscontact", "Nadia", "mailto", "districtsschepen"]) {
    assert.ok(!tekst.includes(verboden), `${verboden} staat erin`);
  }
  assert.deepEqual(privacyFindings(kandidaten.map((k) => k.item)), []);
  assert.equal(isPersoonlijk("Perscontact: Griet Voorbeeld, 498 22 98 94"), true);
  assert.equal(isPersoonlijk("Kelly Voorbeeld, tel. 03 338 29 07"), true);
  assert.equal(isPersoonlijk("Zaterdag 28 november van 14 tot 16.30 uur"), false);
  // Een titel of plaats met een mandaat geeft geen activiteit (er staat meestal een naam bij).
  const schepen = persbericht("Schepen opent nieuwe speeltuin", praktisch("Zaterdag 5 december om 14 uur", "Speeltuin Proef, Proefdreef 4, 2060 Antwerpen"));
  assert.deepEqual(persberichtLezen(schepen, bericht("Schepen opent nieuwe speeltuin", "schepen-opent")), { kandidaten: [], redenen: { persoonsgegeven: 1 } });
  // Een naam die het persbericht zelf als verantwoordelijke of perscontact noemt, komt er nooit in.
  const naam = persbericht("Piet Voorbeeld opent de kerstmarkt", `<p>De kerstmarkt opent.</p>${praktisch("Zaterdag 5 december om 14 uur", "Markthal Proef, Proefdreef 4, 2060 Antwerpen")}${CONTACT}`);
  assert.deepEqual(persberichtLezen(naam, bericht("Piet Voorbeeld opent de kerstmarkt", "kerstmarkt")), { kandidaten: [], redenen: { persoonsgegeven: 1 } });
  const verhuis = persbericht("Bibliotheek verhuist: afscheidsfeest", praktisch("Zaterdag 5 december om 14 uur", "Bibliotheek Proef, Proefdreef 4, 2060 Antwerpen"));
  assert.deepEqual(persberichtLezen(verhuis, bericht("Bibliotheek verhuist: afscheidsfeest", "bib-verhuist")).kandidaten, []);
});

test("een beleidspersbericht, een zitting of politiek geeft geen activiteit", () => {
  assert.deepEqual(persberichtLezen(BELEID, bericht("Stad investeert 10 miljoen euro in nieuwe sporthal", "stad-investeert")), { kandidaten: [], redenen: { beleid: 1 } });
  assert.deepEqual(persberichtLezen(COLLEGE, bericht("Dagorde college van vrijdag 13 november 2026", "dagorde")), { kandidaten: [], redenen: { bestuur: 1 } });
  assert.deepEqual(persberichtLezen(PARTIJ, bericht("Buurtfeest in het park", "buurtfeest")), { kandidaten: [], redenen: { politiek: 1 } });
  // Dezelfde activiteit zonder politiek komt er wel op.
  const zonder = persbericht("Buurtfeest in het park", `<p>Een feest voor de hele buurt.</p>${praktisch("Zaterdag 5 december om 14 uur", "Parkzaal Proef, Proefdreef 4, 2060 Antwerpen")}`);
  const { kandidaten } = persberichtLezen(zonder, bericht("Buurtfeest in het park", "buurtfeest"));
  assert.deepEqual(kandidaten.map((k) => [k.item.title, k.item.location, k.item.postcodes, k.item.inDistrict]), [["Buurtfeest in het park", "Parkzaal Proef, Proefdreef 4, 2060 Antwerpen", ["2060"], true]]);
});

test("de provincie: alleen met link en inschrijving; volzet komt er niet op", () => {
  const prov = (lijf) => persberichtLezen(persbericht("Winterwandeling in het provinciaal domein", lijf), bericht("Winterwandeling in het provinciaal domein", "winterwandeling"));
  const link = `<li><a href="https://www.provincieantwerpen.be/winterwandeling">meer info</a></li>`;
  const goed = prov(`<p>De provincie organiseert een wandeling.</p><div><ul><li>Zondag 13 december om 10 uur</li><li>Domein Proef, Proefdreef 4, Deurne</li><li>Inschrijven verplicht</li>${link}</ul></div>`);
  assert.equal(goed.kandidaten.length, 1);
  assert.match(goed.kandidaten[0].item.info, /Een activiteit van de provincie Antwerpen\. Inschrijven nodig\./);
  assert.equal(goed.kandidaten[0].item.infoUrl, "https://www.provincieantwerpen.be/winterwandeling");
  const vrij = prov(`<p>De provincie organiseert een wandeling.</p><div><ul><li>Zondag 13 december om 10 uur</li><li>Domein Proef, Proefdreef 4, Deurne</li><li>Vrije toegang</li>${link}</ul></div>`);
  assert.match(vrij.kandidaten[0].item.info, /Inschrijven is niet nodig\./);
  const volzet = prov(`<p>De provincie organiseert een wandeling. Ze is volzet.</p><div><ul><li>Zondag 13 december om 10 uur</li><li>Domein Proef, Proefdreef 4, Deurne</li><li>Inschrijven verplicht</li>${link}</ul></div>`);
  assert.deepEqual(volzet, { kandidaten: [], redenen: { provincie_volzet: 1 } });
  const zonderLink = prov(`<p>De provincie organiseert een wandeling.</p><div><ul><li>Zondag 13 december om 10 uur</li><li>Domein Proef, Proefdreef 4, Deurne</li><li>Inschrijven verplicht</li></ul></div>`);
  assert.deepEqual(zonderLink.redenen, { provincie_zonder_link: 1 });
  const zonderInschrijving = prov(`<p>De provincie organiseert een wandeling.</p><div><ul><li>Zondag 13 december om 10 uur</li><li>Domein Proef, Proefdreef 4, Deurne</li>${link}</ul></div>`);
  assert.deepEqual(zonderInschrijving.redenen, { provincie_zonder_inschrijving: 1 });
});

test("datum, uur, adres en district: wat het persbericht schrijft, zonder gissen", () => {
  assert.deepEqual(leesDatumregel("Zaterdag 5 en zondag 6 december", TODAY), { date: "2026-12-05", endDate: "2026-12-06", tijd: null });
  assert.equal(leesDatumregel("Zaterdag 5 en zaterdag 12 december", TODAY).reden, "meer_dan_een_datum");
  assert.deepEqual(leesDatumregel("Van vrijdag 20 tot en met zondag 22 november", TODAY), { date: "2026-11-20", endDate: "2026-11-22", tijd: null });
  assert.equal(leesDatumregel("Zaterdag 7 november", TODAY).reden, "datum_voorbij");
  assert.equal(leesDatumregel("Vrijdag 2 december", TODAY).reden, "datum_onleesbaar", "2 december 2026 is een woensdag");
  assert.equal(leesDatumregel("Vanaf 1 december", TODAY).reden, "datum_onleesbaar", "geen einde: twijfel");
  assert.equal(leesDatumregel("Inschrijven tot 1 december", TODAY).reden, "datum_onleesbaar");
  assert.deepEqual(leesDatumregel("Zaterdag 9 januari om 14 uur", TODAY), { date: "2027-01-09", endDate: null, tijd: { timeSlot: "14:00", timeText: "om 14 uur" } });
  assert.deepEqual(tijdUit("Het district zorgt tussen 14 en 17 uur voor een feest"), { timeSlot: "14:00", timeText: "van 14 tot 17 uur" });
  assert.equal(tijdUit("Kinderen van 6 tot 12 jaar"), null);
  assert.equal(adresIn("Kinderen van 6 tot 12 jaar"), null);
  assert.deepEqual(adresIn("Winterbar Proef, Proefplein 6, Berchem"), { straat: "Proefplein", nummer: "6", postcodes: [] });
  // Met de straatas van de site: de straat zegt in welk district het adres ligt.
  const straten = new Map([["voorbeeldweide", new Set(["2180", "2610"])], ["proefgaarde", new Set(["2018"])]]);
  const adres = adresIn("Gemeenschapscentrum (Voorbeeldweide 1)", { straten });
  assert.deepEqual(adres, { straat: "Voorbeeldweide", nummer: "1", postcodes: ["2180", "2610"] });
  assert.equal(districtVan("Wilrijk", "Gemeenschapscentrum (Voorbeeldweide 1)", adres), "Wilrijk");
  assert.equal(districtVan(null, "Gemeenschapscentrum (Voorbeeldweide 1)", adres), null, "twee districten kennen die straat");
  assert.equal(districtVan(null, "Zaal Proef, Proefgaarde 3", adresIn("Zaal Proef, Proefgaarde 3", { straten })), "Antwerpen");
  assert.equal(districtVan("Berchem", "Zaal Proef, Proefstraat 3, Deurne", null), null, "kop en plaats spreken elkaar tegen");
  assert.equal(crawlDelayMs("User-agent: *\nCrawl-delay: 10\nDisallow: /x"), 10_000);
  assert.equal(crawlDelayMs("User-agent: *\nDisallow: /x"), 0);
});

test("een plaats zonder huisnummer: de opzoeking in de open data (#264) vult het aan", () => {
  const html = persbericht("Kerstconcert in Merksem", `<p>Een kerstconcert voor iedereen.</p>${praktisch("Zondag 20 december om 15 uur", "Waar: Sporthal Proef", "Gratis")}`);
  const { kandidaten } = persberichtLezen(html, bericht("Kerstconcert in Merksem", "kerstconcert"));
  // Geen district in de plaats en geen kop: twijfel.
  assert.deepEqual(kandidaten, []);
  const metDistrict = persbericht("Kerstconcert", `<h4>Merksem</h4><p>Een kerstconcert voor iedereen.</p>${praktisch("Zondag 20 december om 15 uur", "Waar: Sporthal Proef", "Gratis")}`);
  const [item] = persberichtLezen(metDistrict, bericht("Kerstconcert", "kerstconcert")).kandidaten.map((k) => k.item);
  assert.equal(item.location, "Sporthal Proef, Merksem");
  // De verversing zoekt de plek op (scripts/vul-huisnummers.mjs) ...
  const plekken = teZoekenPlekken([{ ...item, sourceId: SOURCE_ID }], TODAY);
  assert.deepEqual([...plekken.keys()], ["sporthal proef"]);
  // ... en build:sources zet het gevonden adres erachter.
  const auto = { schemaVersion: 1, bijgewerkt: TODAY, plekken: [{ naam: "Sporthal Proef", herken: ["Sporthal Proef"], adres: "Verzonnenstraat 12, 2170 Merksem", bron: "https://geodata.antwerpen.be/arcgissql/rest/services/P_Portal/portal_publiek6/MapServer/643" }] };
  assert.equal(metVastAdres(item.location, auto), "Sporthal Proef, Verzonnenstraat 12, 2170 Merksem");
});

// ---------- dubbels ----------

const NIEUWS_HOBOKEN = {
  id: "stad-news-hoboken-0123456789abcdef01234567-2026-11-28",
  externalId: "0123456789abcdef01234567",
  title: "Feest voor de Sint",
  theme: "Activiteit",
  className: "activity",
  date: "2026-11-28",
  endDate: null,
  timeSlot: "14:00",
  timeText: "14 uur",
  location: "District Hoboken, locatie via de officiële bron",
  postcodes: ["2660"],
  info: "",
  kind: "activity",
  sourceUrl: "https://www.antwerpen.be/info/0123456789abcdef01234567/feest-voor-de-sint",
  retrievedAt: "2026-11-10T06:00:00.000Z",
  reviewRequired: false,
  inDistrict: false,
};

test("een dubbel wordt weggelaten: dezelfde activiteit uit een andere bron wordt één punt, een handmatig item gaat voor", () => {
  const { kandidaten } = persberichtLezen(SINT, bericht(), { retrievedAt: NOW.toISOString() });
  const hand = { id: "hand-sint-berchem", title: "Sinterklaas in Berchem", date: "2026-12-02", timeSlot: "15:00", location: "Winterbar Proef, Proefplein 6, 2600 Berchem" };
  const uit = dubbelsZoeken(kandidaten, [{ sourceId: "stad-districten", scope: "stad", item: NIEUWS_HOBOKEN }], { hand: [hand] });
  assert.deepEqual(uit.tel, { dubbel: 1, dubbelHand: 1, dubbelIntern: 0 });
  assert.equal(uit.kandidaten.length, 5, "Berchem staat al als handmatig item op de site");
  const hoboken = uit.kandidaten.find((k) => k.item.postcodes.includes("2660")).item;
  assert.deepEqual(hoboken.sameAs, [NIEUWS_HOBOKEN.id]);
  // Op de site: één punt, met de plaats en het huisnummer uit het persbericht en beide bronnen.
  const { items } = mergeEvents({
    [SOURCE_ID]: { scope: "stad", items: uit.kandidaten.map((k) => k.item) },
    "stad-districten": { scope: "stad", items: [NIEUWS_HOBOKEN] },
  });
  const opDieDag = items.filter((i) => i.date === "2026-11-28" && i.postcodes.includes("2660"));
  assert.equal(opDieDag.length, 1);
  assert.equal(opDieDag[0].location, "Veerpont en Kasteel Bedacht (Testlei 7), Hoboken");
  assert.deepEqual(opDieDag[0].sources.map((s) => s.sourceId), [SOURCE_ID, "stad-districten"]);
  // Een ander uur, of een ander district: geen dubbel.
  const anders = dubbelsZoeken(kandidaten, [{ sourceId: "stad-districten", scope: "stad", item: { ...NIEUWS_HOBOKEN, timeSlot: "10:00" } }, { sourceId: "stad-districten", scope: "stad", item: { ...NIEUWS_HOBOKEN, id: "stad-news-x-1", postcodes: ["2100"] } }]);
  assert.equal(anders.tel.dubbel, 0);
  // Twee persberichten over dezelfde activiteit: de nieuwste blijft.
  const tweemaal = dubbelsZoeken([...kandidaten, ...kandidaten.map((k) => ({ item: { ...k.item, id: `${k.item.id}-oud` }, tekst: k.tekst }))]);
  assert.deepEqual([tweemaal.kandidaten.length, tweemaal.tel.dubbelIntern], [6, 6]);
});

// ---------- de ronde ----------

test("de ronde: robots.txt eerst, dan de feed, dan elk persbericht; één naam, minstens 5 s ertussen, alleen de persruimte", async (t) => {
  const root = makeRoot(t);
  write(root, sourceDocument("stad-districten", { retrievedAt: "2026-11-10T06:00:00.000Z", fetchStatus: "ok", items: [NIEUWS_HOBOKEN] }));
  const net = persruimte(standaard());
  const logs = [];
  const status = await run({ rootDir: root, clock: () => NOW, fetch: net.fetch, sleep: net.sleep, log: (regel) => logs.push(JSON.parse(regel)) });
  assert.deepEqual(net.gevraagd.map((g) => g.url), [
    PERS_ROBOTS, PERS_FEED, SINT_URL, `https://${PERS_HOST}/stad-investeert-in-nieuwe-sporthal`, `https://${PERS_HOST}/dagorde-college-van-vrijdag-13-november-2026`,
  ], "de link naar www.antwerpen.be in een persbericht wordt nooit gevolgd");
  assert.ok(net.gevraagd.every((g) => g.ua === LEZER_UA), "altijd de ene eerlijke naam");
  assert.ok(net.gevraagd.every((g) => g.redirect === "manual"), "een omleiding volgt de lezer zelf, alleen binnen de persruimte");
  for (let i = 1; i < net.gevraagd.length; i += 1) assert.ok(net.gevraagd[i].op - net.gevraagd[i - 1].op >= PAUZE_MS, `minstens ${PAUZE_MS} ms voor verzoek ${i}`);
  assert.deepEqual([status[0].fetchStatus, status[0].errorCode, status[0].itemCount], ["ok", null, 6]);
  const document = read(root);
  assert.deepEqual(validateSourceDocument(document, { expectedSourceId: SOURCE_ID }), []);
  assert.equal(document.items.filter((i) => i.sameAs?.includes(NIEUWS_HOBOKEN.id)).length, 1);
  assert.ok(!/@|0499|Peeters|Verantwoordelijke|Nadia/.test(fs.readFileSync(path.join(root, "site", "sources", `${SOURCE_ID}.json`), "utf8")));
  const verslag = logs.find((l) => l.source === SOURCE_ID);
  assert.deepEqual([verslag.verzoeken, verslag.gelezen, verslag.dubbel, verslag.redenen.beleid, verslag.redenen.bestuur], [5, 3, 1, 1, 1]);

  // Een week later: het persbericht staat niet meer in de feed. Zijn activiteiten blijven tot hun dag voorbij is.
  const later = persruimte(standaard({ [PERS_FEED]: () => new Response(feed([feedItem("ander-bericht", "Ander bericht", "2026-11-25T09:00:00.000Z")]), { status: 200 }), [`https://${PERS_HOST}/ander-bericht`]: () => new Response(persbericht("Ander bericht", "<p>Niets te zien.</p>", "2026-11-25T09:00:00.000Z"), { status: 200 }) }));
  await run({ rootDir: root, clock: () => new Date("2026-11-30T06:00:00.000Z"), fetch: later.fetch, sleep: later.sleep, log: quiet });
  assert.deepEqual(read(root).items.map((i) => i.date), ["2026-12-02", "2026-12-05", "2026-12-06"], "28 november is voorbij");
});

test("als robots.txt nee zegt, wordt er niets gelezen en blijft de vorige stand", async (t) => {
  const root = makeRoot(t);
  const eerste = persruimte(standaard());
  await run({ rootDir: root, clock: () => NOW, fetch: eerste.fetch, sleep: eerste.sleep, log: quiet });
  const vorige = read(root).items;
  assert.equal(vorige.length, 6);
  for (const robots of ["User-agent: *\nDisallow: /", "User-agent: ProjectBrain-bronnenlezer\nDisallow: /feed\n\nUser-agent: *\nDisallow: /subscribe/*"]) {
    const net = persruimte(standaard({ [PERS_ROBOTS]: () => new Response(robots, { status: 200 }) }));
    const status = await run({ rootDir: root, clock: () => NOW, fetch: net.fetch, sleep: net.sleep, log: quiet });
    assert.deepEqual(net.gevraagd.map((g) => g.url), [PERS_ROBOTS], robots);
    assert.deepEqual([status[0].fetchStatus, status[0].errorCode, status[0].itemCount], ["error", "robots_verbiedt", 6]);
    assert.deepEqual(read(root).items, vorige);
  }
  // Een robots.txt die niet te lezen is (een serverfout), telt ook als nee.
  const kapot = persruimte(standaard({ [PERS_ROBOTS]: () => new Response("fout", { status: 503 }) }));
  const status = await run({ rootDir: root, clock: () => NOW, fetch: kapot.fetch, sleep: kapot.sleep, log: quiet });
  assert.deepEqual([kapot.gevraagd.length, status[0].errorCode], [1, "robots_http_503"]);
  // Verbiedt robots.txt één persbericht, dan wordt alleen dat niet gevraagd; een grotere Crawl-delay gaat voor.
  const deels = persruimte(standaard({ [PERS_ROBOTS]: () => new Response("User-agent: *\nCrawl-delay: 8\nDisallow: /dagorde-", { status: 200 }) }));
  await run({ rootDir: root, clock: () => NOW, fetch: deels.fetch, sleep: deels.sleep, log: quiet });
  assert.ok(!deels.gevraagd.some((g) => g.url.includes("/dagorde-")));
  for (let i = 1; i < deels.gevraagd.length; i += 1) assert.ok(deels.gevraagd[i].op - deels.gevraagd[i - 1].op >= 8_000);
});

test("een omleiding naar www.antwerpen.be wordt nooit gevolgd; een weigering stopt het lezen", async (t) => {
  const root = makeRoot(t);
  const net = persruimte(standaard({ [SINT_URL]: () => new Response(null, { status: 301, headers: { location: "https://www.antwerpen.be/nl/nieuws/sint" } }) }));
  const status = await run({ rootDir: root, clock: () => NOW, fetch: net.fetch, sleep: net.sleep, log: quiet });
  assert.ok(net.gevraagd.every((g) => new URL(g.url).hostname === PERS_HOST));
  assert.deepEqual([status[0].fetchStatus, status[0].errorCode], ["error", "bericht_omleiding"]);
  const geweigerd = persruimte(standaard({ [SINT_URL]: () => new Response("<html><head><title>Access Denied</title></head><body>Reference #18.1</body></html>", { status: 403 }) }));
  const uit = await run({ rootDir: root, clock: () => NOW, fetch: geweigerd.fetch, sleep: geweigerd.sleep, log: quiet });
  assert.deepEqual(geweigerd.gevraagd.map((g) => g.url), [PERS_ROBOTS, PERS_FEED, SINT_URL], "na een weigering geen verzoek meer");
  assert.deepEqual([uit[0].fetchStatus, uit[0].errorCode], ["error", "bron_weigert_automatisch"]);
});

// ---------- register, contract en voorrang ----------

test("register en contract: eigen fetcher, groep stad, alleen pers.antwerpen.be, vóór het nieuws van de districten", () => {
  const fetcher = FETCHERS.find((entry) => entry.name === SOURCE_ID);
  assert.deepEqual(fetcher?.sourceIds, [SOURCE_ID]);
  assert.ok(FETCHERS.indexOf(fetcher) > FETCHERS.findIndex((f) => f.name === "stad-districten"));
  const document = sourceDocument(SOURCE_ID, { fetchStatus: "ok" });
  assert.deepEqual([document.scope, document.url, document.allowedHosts], ["stad", "https://pers.antwerpen.be/", ["pers.antwerpen.be"]]);
  const { kandidaten } = persberichtLezen(SINT, bericht(), { retrievedAt: NOW.toISOString() });
  const item = kandidaten[0].item;
  const elders = sourceDocument(SOURCE_ID, { retrievedAt: NOW.toISOString(), fetchStatus: "ok", items: [{ ...item, sourceUrl: "https://www.antwerpen.be/nl/nieuws/sint" }] });
  assert.ok(validateSourceDocument(elders).some((error) => /sourceUrl/.test(error)));
  const order = SOURCE_PRECEDENCE;
  assert.ok(order.indexOf("district-nieuws") < order.indexOf(SOURCE_ID) && order.indexOf(SOURCE_ID) < order.indexOf("stad-districten"));
});
