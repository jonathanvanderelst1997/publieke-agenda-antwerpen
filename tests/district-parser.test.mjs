import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { articleFromHtml, parseDistrictNewsArticle } from "../lib/district-news-parser.mjs";
import { DISTRICT_CALENDAR_URL, parseDatePart, parseDistrictHtml, parseDistrictPage, parseTimePart } from "../lib/district-parser.mjs";
import { CITY_POSTCODES, DISTRICT_POSTCODES, pointInDistrict, scopeForPostcode } from "../lib/postcodes.mjs";

const fixture = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const page = JSON.parse(fixture("district-page-content-by-uuid-5efb0477.json"));
const live = parseDistrictPage(page);
const byTitle = (title) => live.items.filter((item) => item.title === title);

// Een synthetisch pagina-object met één wysiwyg-snippet.
function syntheticPage(text, { date = "2026-09-21T12:30:00+00:00", publishUntil = "2026-12-01T22:00:00+00:00", id = "aaaaaaaaaaaaaaaaaaaaaaaa" } = {}) {
  return { date, publishUntil, snippets: [{ id, type: "wysiwyg", body: { text } }] };
}

test("live fixture: 14 blokken, 0 problemen, 17 items", () => {
  assert.equal(live.blocks, 14);
  assert.deepEqual(live.issues, []);
  assert.equal(live.reviewItems.length, 0);
  assert.equal(live.items.length, 17);
  assert.equal(live.refDate, "2026-09-21");
  assert.equal(live.publishUntil, "2026-12-01");
  for (const item of live.items) {
    assert.match(item.id, /^district-kal-[a-f0-9]{24}-\d{4}-\d{2}-\d{2}$/);
    assert.equal(item.sourceUrl, DISTRICT_CALENDAR_URL);
    assert.notEqual(item.theme, "Werken");
    assert.equal(item.reviewRequired, false);
  }
});

test("drie gekozen items: exacte titel, datum, uur en locatie", () => {
  const [lambermontmartre] = byTitle("Lambermontmartre");
  assert.equal(lambermontmartre.id, "district-kal-6a04d45c9fb3aa7ae4213cab-2026-09-27");
  assert.equal(lambermontmartre.date, "2026-09-27");
  assert.equal(lambermontmartre.endDate, null);
  assert.equal(lambermontmartre.timeSlot, "12:00");
  assert.equal(lambermontmartre.timeText, "12 uur");
  assert.equal(lambermontmartre.location, "Leopold de Waelplaats");
  assert.deepEqual(lambermontmartre.postcodes, ["2000"]);

  const [kielLoopt] = byTitle("‘t Kiel Loopt");
  assert.equal(kielLoopt.date, "2026-10-04");
  assert.equal(kielLoopt.timeSlot, "13:00");
  assert.equal(kielLoopt.timeText, "13 tot 16.30 uur");
  assert.equal(kielLoopt.location, "Paarse Vlam, Kiel park");
  assert.equal(kielLoopt.theme, "Sport");
  assert.equal(kielLoopt.infoUrl, "https://www.beerschot-atletiek.be/t-kiel-loopt/");
  assert.match(kielLoopt.info, /Prijs: €6\/10$/);

  const [furie] = byTitle("FURIE!");
  assert.equal(furie.date, "2026-11-04");
  assert.equal(furie.timeSlot, "19:00");
  assert.equal(furie.timeText, "om 19 uur");
  assert.equal(furie.location, "Grote Markt");
  assert.equal(furie.theme, "Activiteit");
});

test("een bereik wordt één item met endDate, een lijst wordt meerdere items", () => {
  const [humans] = byTitle("Humans of Antwerp");
  assert.equal(humans.date, "2026-09-09");
  assert.equal(humans.endDate, "2026-10-22");
  assert.equal(humans.timeSlot, "Info");

  const [budget] = byTitle("Burgerbegroting: stem online en tijdens de finale");
  assert.equal(budget.date, "2026-09-03");
  assert.equal(budget.endDate, "2026-09-25");
  assert.equal(budget.timeText, "online stemmen");

  const tablet = byTitle("Tabletcafé");
  assert.deepEqual(tablet.map((item) => item.date), ["2026-09-25", "2026-10-23", "2026-11-27"]);
  assert.ok(tablet.every((item) => item.endDate === null && item.timeSlot === "10:00"));
  assert.equal(new Set(tablet.map((item) => item.id)).size, 3);
  assert.equal(tablet[0].location, "2000, 2020, 2050 Antwerpen");
});

test("een weekdag die niet klopt maakt het blok reviewRequired en niet publiceerbaar", () => {
  const result = parseDistrictPage(syntheticPage("<p><strong>Proef<br />Ma 27/9 | 12 uur</strong><br /><br />Tekst.<br /><br /><em>2000 Antwerpen &bull; Groenplaats</em></p>"));
  assert.equal(result.items.length, 0);
  assert.equal(result.reviewItems.length, 1);
  assert.equal(result.reviewItems[0].reviewRequired, true);
  assert.ok(result.issues.some((issue) => issue.code === "weekday_mismatch"));
});

test("inschrijven tot … wordt een deadline met thema Oproep/deadline", () => {
  const result = parseDistrictPage(
    syntheticPage("<p><strong>Lenteklaar<br>Inschrijven kan tot vr 6/2</strong><br><br>Dien je aanvraag in.<br><br><em>2000, 2018 Antwerpen | GRATIS</em></p>", {
      date: "2026-01-10T09:00:00+00:00",
      publishUntil: "2026-02-07T22:00:00+00:00",
    })
  );
  assert.deepEqual(result.issues, []);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].kind, "deadline");
  assert.equal(result.items[0].theme, "Oproep/deadline");
  assert.equal(result.items[0].className, "call");
  assert.equal(result.items[0].date, "2026-02-06");
});

test("een foute link (http of de live fout 'http://(G)ouder worden') valt weg, net als mailto", () => {
  const [connection] = byTitle("Verlangen naar verbinding");
  assert.equal(connection.infoUrl, undefined);
  const [market] = byTitle("Lambermontmartre");
  assert.equal(market.infoUrl, undefined, "http-link naar de organisator valt weg");
  assert.equal(live.droppedLinks, 3);

  const result = parseDistrictPage(
    syntheticPage(
      '<p><strong>Proef<br>Za 3/10 | 14 uur</strong><br><br>Schrijf in via <a href="mailto:iemand' +
        '@example.invalid">iemand' +
        '@example.invalid</a> of bij info' +
        '@example.invalid.<br><br><em>2060 Antwerpen &bull; Bib Permeke &bull; <a href="mailto:x' +
        '@example.invalid">mail ons</a></em></p>'
    )
  );
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].infoUrl, undefined);
  assert.equal(result.droppedLinks, 1);
  assert.doesNotMatch(JSON.stringify(result.items), /@|mailto/);
});

test("e-mailadressen verdwijnen uit alle tekst", () => {
  const result = parseDistrictPage(
    syntheticPage("<p><strong>Titel met adres info" + "@example.invalid<br>Za 3/10 | 14 uur</strong><br><br>Mail naar vragen" + "@example.invalid voor info.<br><br><em>2000 Antwerpen &bull; Zaal, contact" + "@example.invalid</em></p>")
  );
  assert.equal(result.items.length, 1);
  assert.doesNotMatch(JSON.stringify(result.items[0]), /@/);
  assert.equal(result.items[0].location, "Zaal");
});

test("jaarwissel: een januaridatum in een decemberartikel valt in het volgende jaar", () => {
  const result = parseDistrictPage(
    syntheticPage("<p><strong>Nieuwjaarsloop<br>Zo 3/1 | 14 uur</strong><br><br>Loop mee.<br><br><em>2050 Antwerpen &bull; Linkeroever</em></p>", {
      date: "2026-12-10T09:00:00+00:00",
      publishUntil: "2027-01-05T22:00:00+00:00",
    })
  );
  assert.deepEqual(result.issues, []);
  assert.equal(result.items[0].date, "2027-01-03");
  assert.equal(result.items[0].theme, "Sport");
});

test("variant: plaatsregel in een eigen <p> met | als scheidingsteken en <br> zonder slash", () => {
  const result = parseDistrictPage(
    syntheticPage(
      "<p><strong>Vliegend college<br>Do 5/3 | 20 tot 22 uur</strong></p><p>Het districtscollege gaat met je in gesprek.</p><p>Nog een alinea.</p>" +
        '<p>Wijken Stuivenberg en Dam | Oude Badhuis, Stuivenbergplein 38, 2060 Antwerpen | gratis | <a href="https://www.antwerpen.be/nl/overzicht/district-antwerpen-1/nieuws/vliegend-college">Vliegend college</a></p>',
      { date: "2026-01-23T09:00:00+00:00", publishUntil: "2026-03-06T22:00:00+00:00" }
    )
  );
  assert.deepEqual(result.issues, []);
  const [item] = result.items;
  assert.equal(item.date, "2026-03-05");
  assert.equal(item.timeSlot, "20:00");
  assert.equal(item.location, "Wijken Stuivenberg en Dam, Oude Badhuis, Stuivenbergplein 38, 2060 Antwerpen");
  assert.deepEqual(item.postcodes, ["2060"]);
  assert.equal(item.info, "Het districtscollege gaat met je in gesprek. Nog een alinea. Prijs: gratis");
  assert.equal(item.infoUrl, "https://www.antwerpen.be/nl/overzicht/district-antwerpen-1/nieuws/vliegend-college");
});

test("variant: class 'rich-text o-article' in HTML en een vanaf-datum tot publishUntil", () => {
  const html =
    '<div class="rich-text o-article"><p><strong>Schrijf ze vrij<br>vanaf maandag 2 december</strong></p><p>Kom langs.</p><p><em>2018 Antwerpen | Harmoniepark 1 | GRATIS</em></p></div>' +
    '<div class="rich-text o-article"><p><strong>Wintermagie</strong><br><strong>vrijdag 13 december van 9 tot 21 uur</strong><br><br>Toverachtig bos.<br><br><em>2030 Antwerpen | GRATIS | Agorapark</em></p></div>';
  const result = parseDistrictHtml(html, { refDate: "2024-11-28", publishUntil: "2024-12-31" });
  assert.deepEqual(result.issues, []);
  assert.equal(result.blocks, 2);
  assert.deepEqual(
    result.items.map((item) => [item.title, item.date, item.endDate, item.timeSlot]),
    [
      ["Schrijf ze vrij", "2024-12-02", "2024-12-31", "Info"],
      ["Wintermagie", "2024-12-13", null, "09:00"],
    ]
  );
});

test("het vastgelegde HTML-artikel geeft dezelfde titels en data als de JSON", () => {
  const html = parseDistrictHtml(fixture("district-wat-beleef-je-2026-09-28.article.html"), { refDate: "2026-09-21", publishUntil: "2026-12-01" });
  assert.equal(html.blocks, 14);
  assert.deepEqual(html.issues, []);
  const signature = (items) => items.map((item) => `${item.title}|${item.date}|${item.endDate}|${item.timeSlot}|${item.location}`).sort();
  assert.deepEqual(signature(html.items), signature(live.items));
});

test("tijdgrammatica", () => {
  assert.deepEqual(parseTimePart("13.30 tot 16 uur"), { timeSlot: "13:30", timeText: "13.30 tot 16 uur", starts: ["13:30"], endTime: "16:00" });
  assert.equal(parseTimePart("om 19 uur").timeSlot, "19:00");
  assert.equal(parseTimePart("vanaf 13 uur").timeSlot, "13:00");
  assert.equal(parseTimePart("van 10 tot 12 uur").timeSlot, "10:00");
  assert.equal(parseTimePart("20 - 22 uur").endTime, "22:00");
  const several = parseTimePart("om 11 en 14 uur");
  assert.deepEqual([several.timeSlot, several.starts], ["11:00", ["11:00", "14:00"]]);
  assert.deepEqual(parseTimePart("online stemmen"), { timeSlot: "Info", timeText: "online stemmen", starts: [], endTime: null });
});

test("datumgrammatica: maandnamen, bereiken, lijsten en maand van rechts", () => {
  assert.deepEqual(parseDatePart("Do 3 t.e.m. vr 25/9", "2026-09-21").ranges, [{ date: "2026-09-03", endDate: "2026-09-25" }]);
  assert.deepEqual(parseDatePart("Di 1 t.e.m 30 april", "2026-03-20").ranges, [{ date: "2026-04-01", endDate: "2026-04-30" }]);
  assert.deepEqual(parseDatePart("zaterdag 17 okt", "2026-09-21").ranges, [{ date: "2026-10-17", endDate: null }]);
  assert.deepEqual(parseDatePart("2 sept", "2026-08-01").ranges, [{ date: "2026-09-02", endDate: null }]);
  assert.deepEqual(
    parseDatePart("Di 17 en vr 20/2", "2026-01-23").ranges.map((range) => range.date),
    ["2026-02-17", "2026-02-20"]
  );
});

test("postcodes en de officiële districtsgrens", () => {
  const reference = JSON.parse(fixture("antwerpen-postcodes-districten-uitregions.json"));
  assert.deepEqual([...DISTRICT_POSTCODES], reference.district_antwerpen);
  assert.deepEqual([...CITY_POSTCODES].sort(), [...reference.district_antwerpen, ...Object.keys(reference.rest_van_de_stad)].sort());
  assert.equal(CITY_POSTCODES.length, 15);
  assert.equal(scopeForPostcode("2060"), "district");
  assert.equal(scopeForPostcode("2100"), "stad");
  assert.equal(scopeForPostcode("9000"), null);
  assert.equal(pointInDistrict([4.4011, 51.2192]), true, "Groenplaats ligt in district Antwerpen");
  assert.equal(pointInDistrict([4.464, 51.2166]), false, "Deurne ligt buiten district Antwerpen");
});

test("districtsnieuws: alleen de tabelrij binnen de publicatieperiode telt (Vliegend College)", () => {
  const article = articleFromHtml(fixture("district-vliegend-college-2026-09-28.article.html"), {
    id: "547d6be7cca8a798038b457f",
    slug: "vliegend-college-komt-naar-de-wijken",
    publishUntil: "2026-10-08T21:55:00+00:00",
  });
  const result = parseDistrictNewsArticle(article, { today: "2026-09-28" });
  assert.equal(result.reason, null);
  assert.equal(result.dropped, 1, "2 december ligt na publishUntil");
  assert.equal(result.items.length, 1);
  const [item] = result.items;
  assert.equal(item.id, "district-news-547d6be7cca8a798038b457f-2026-10-07");
  assert.equal(item.date, "2026-10-07");
  assert.equal(item.timeSlot, "20:00");
  assert.equal(item.location, "Letterenhuis, Minderbroedersstraat 22");
  assert.equal(item.sourceUrl, "https://www.antwerpen.be/info/547d6be7cca8a798038b457f/vliegend-college-komt-naar-de-wijken");
  assert.doesNotMatch(JSON.stringify(result), /@/);

  const expired = parseDistrictNewsArticle({ ...article, publishUntil: "2026-09-01T00:00:00+00:00" }, { today: "2026-09-28" });
  assert.equal(expired.items.length, 0);
});

test("districtsnieuws: twee Praktisch-blokken op dezelfde dag met een ander uur zijn dubbelzinnig", () => {
  const article = {
    id: "6aaba39ca7e511835a377464",
    slug: "dag-van-de-trage-wegen",
    title: "Dag van de Trage Wegen",
    publishedAt: "2026-09-16T22:00:00+00:00",
    publishUntil: "2026-10-17T22:00:00+00:00",
    snippets: [
      { type: "wysiwyg", body: { text: "<p>Wandel of fiets mee.</p>" } },
      {
        type: "wysiwyg",
        body: {
          text:
            "<h3>Fietstocht</h3><p><strong>Praktisch:</strong></p><ul><li>zaterdag 17 oktober</li><li>10 uur</li><li>Start aan P&amp;R Linkeroever</li></ul>" +
            "<h3>Wandeling</h3><p><strong>Praktisch</strong></p><ul><li>zaterdag 17 oktober</li><li>14 uur</li><li>Start aan Blokkersdijk</li></ul>",
        },
      },
    ],
  };
  const result = parseDistrictNewsArticle(article, { today: "2026-09-28" });
  assert.equal(result.reason, "ambiguous");
  assert.equal(result.items.length, 0);
});

// ---------- datum in de titel: de structurele bron voor Herfstklaar en buurtfeesten ----------

const herfstklaarArticle = {
  id: "0123456789abcdef0123abcd",
  slug: "maak-je-straat-herfstklaar-op-23-24-of-25-oktober",
  title: "Maak je straat Herfstklaar op 23, 24 of 25 oktober",
  publishedAt: "2026-08-25T12:00:00+00:00",
  publishUntil: "2026-10-25T12:00:00+00:00",
  snippets: [{ type: "wysiwyg", body: { text: "<p>Plantjes zetten, snoeien of een regenton in je straat? Afsluiten doe je samen met een heerlijke soep van het district.</p><p>Inschrijven kon tot 4 september.</p>" } }],
};

test("district-nieuws: een expliciete dag in de titel geeft een periode, alleen met titleDates", () => {
  const without = parseDistrictNewsArticle(herfstklaarArticle, { today: "2026-10-05" });
  assert.equal(without.items.length, 0, "zonder titleDates blijft het oude gedrag");
  const result = parseDistrictNewsArticle(herfstklaarArticle, { today: "2026-10-05", titleDates: true });
  assert.equal(result.items.length, 1, JSON.stringify(result));
  const [item] = result.items;
  assert.deepEqual([item.date, item.endDate, item.timeSlot], ["2026-10-23", "2026-10-25", "Info"]);
  assert.equal(item.location, "district Antwerpen, locatie via de officiële bron");
  assert.equal(item.title, "Maak je straat Herfstklaar op 23, 24 of 25 oktober");
  assert.match(item.sourceUrl, /^https:\/\/www\.antwerpen\.be\//);
});

test("district-nieuws: geen titeldatum voor deadlines, werken of buiten het publicatievenster", () => {
  const parse = (title, extra = {}) => parseDistrictNewsArticle({ ...herfstklaarArticle, title, snippets: [], ...extra }, { today: "2026-10-05", titleDates: true }).items.length;
  assert.equal(parse("Buurtfeest en inhuldiging op 10 oktober"), 1);
  assert.equal(parse("Inschrijven voor Herfstklaar kan tot op 25 september"), 0);
  assert.equal(parse("Dien je aanvraag in voor 4 november"), 0);
  assert.equal(parse("Heraanleg Fictiefstraat start op 12 oktober"), 0);
  assert.equal(parse("Bevraging schoolstraat op 20 oktober"), 0);
  assert.equal(parse("Kerstmarkt op 20 december"), 0, "na publishUntil (25 oktober)");
  // Een gewone "Wanneer:"-regel gaat altijd voor op de titel.
  const withLine = parseDistrictNewsArticle({ ...herfstklaarArticle, title: "Feest op 10 oktober", snippets: [{ type: "wysiwyg", body: { text: "<p>Wanneer: zondag 11 oktober 2026</p><p>Waar: Plein 1, 2000 Antwerpen</p>" } }] }, { today: "2026-10-05", titleDates: true });
  assert.deepEqual(withLine.items.map((x) => x.date), ["2026-10-11"]);
});
