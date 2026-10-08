// Vaste bron-/zoekproeven, geen browser of externe bronnen. Eén representatieve
// straat per postcode plus grensgevallen. Dit is geen live-e2e-test.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { buildPlaceIndex, searchPlaces, otherDistrictFor } from "../site/place-core.js";
import { createAgendaView, DEFAULT_THEMES, VIEW_THEMES } from "../site/agenda-view.js";
import { wijkFeatures, bboxOf } from "../site/neighborhood-core.js";
import "../site/event-types.js";
import "../site/agenda-uitgaan.js";

const streets = JSON.parse(readFileSync(new URL("../site/geo/straten.json", import.meta.url), "utf8")).streets;
const wijken = wijkFeatures(JSON.parse(readFileSync(new URL("../site/geo/wijken.geo.json", import.meta.url), "utf8")))
  .filter(f => f.properties.code.startsWith("ANT"))
  .map(f => ({ code: f.properties.code, naam: f.properties.naam, box: bboxOf(f.geometry) }));
const index = buildPlaceIndex({ streets, wijken });

const examples = [
  ["Kammenstraat", "2000"], ["Nationalestraat", "2000"], ["Meir", "2000"],
  ["Jan Vanhoenackerstraat", "2000"], ["Rijnkaai", "2000"],
  ["De Keyserlei", "2018"], ["Brederodestraat", "2018"],
  ["Boomsesteenweg", "2020"],
  ["Columbiastraat", "2030"], ["Dublinstraat", "2030"],
  ["Gaston Burssenslaan", "2050"],
  ["Sint-Jansplein", "2060"], ["Vondelstraat", "2060"], ["Van Maerlantstraat", "2060"],
];
test("plaatszoeken: straten uit elk van de zes postcodes met een officiële exact-match", () => {
  assert.deepEqual([...new Set(examples.map(([, code]) => code))].sort(),
    ["2000", "2018", "2020", "2030", "2050", "2060"]);
  for (const [name, postcode] of examples) {
    const real = streets.find(s => s[1] === name && s[2] === postcode);
    assert.ok(real, name + " " + postcode + " ontbreekt in officieel straatbestand");
    const results = searchPlaces(index, name + " " + postcode, { limit: 20 });
    assert.ok(results.some(hit => hit.place.name === name && String(hit.place.postcode) === postcode),
      name + " " + postcode + " is niet te vinden in de suggesties");
  }
});
test("de Keyserlei heeft twee zones; filters mogen niet stil overlopen", () => {
  const lijst = streets.filter(s => s[1] === "De Keyserlei");
  assert.deepEqual([...new Set(lijst.map(s => s[2]))].sort(), ["2000", "2018"]);
  const gekozen = searchPlaces(index, "De Keyserlei 2018", { limit: 10 }).find(hit =>
    hit.place.name === "De Keyserlei" && String(hit.place.postcode) === "2018").place;
  const view = createAgendaView();
  view.setStreet(gekozen.name, { id: gekozen.id, name: gekozen.name, postcode: gekozen.postcode });
  assert.equal(view.matchesStreet({ streets: [{ id: gekozen.id, name: gekozen.name, postcode: "2018" }] }), true);
  assert.equal(view.matchesStreet({ streets: [{ id: gekozen.id, name: gekozen.name, postcode: "2000" }] }), false);
});
test("buiten district en onzinzoekterm worden geen verzonnen exacte straat", () => {
  assert.equal(streets.some(s => s[1] === "Turnhoutsebaan"), false);
  assert.equal(otherDistrictFor("berchem"), "Berchem");
  assert.equal(searchPlaces(index, "qzzzzqzzz", { limit: 8 }).length, 0);
});
test("categorieën volgen juiste standaardkeuze en zijn afzonderlijk aan/uit zetbaar", () => {
  const all = VIEW_THEMES.map(([key]) => key);
  const view = createAgendaView({ defaultThemes: DEFAULT_THEMES });
  assert.equal(all.length, new Set(all).size);
  for (const c of ["festival", "neighborhood", "culture", "family", "parade", "sport", "flea", "shopping"])
    assert.equal(view.enabled(c), true, c + " moet in uitgaansstand zichtbaar zijn");
  for (const c of ["meetings", "info", "admin", "calls", "works", "markets", "other", "publicSpace", "permits"])
    assert.equal(view.enabled(c), false, c + " blijft in uitgaansstand optioneel");
  view.setThemes(all);
  assert.ok(all.every(key => view.enabled(key)), "na Alles moet elk onderwerp actief zijn");
  view.setThemes(["works", "publicSpace"]);
  assert.ok(view.enabled("works") && view.enabled("publicSpace"));
  assert.equal(view.enabled("festival"), false);
});
test("categorieën worden begrijpelijk onderscheiden, ook de beleidsmatige verborgen soorten", () => {
  const categoriseer = globalThis.PublicAgendaUitgaan.categoryOf;
  const voorbeelden = [
    ["Buurtfeest Gaston Burssenslaan", "neighborhood"],
    ["Districtsraad Antwerpen", "meetings"],
    ["Rommelmarkt op het plein", "flea"],
    ["Koopzondag stad Antwerpen", "shopping"],
    ["Loopwedstrijd door Antwerpen", "sport"],
    ["Concert op het plein", "culture"],
    ["Bevraging proefperiode schoolstraat", "admin"],
  ];
  for (const [title, expected] of voorbeelden) {
    const category = categoriseer({ title, location: "Antwerpen", timeSlot: "14:00" });
    assert.equal(category, expected, title);
  }
});


const EXTRA_25 = Object.freeze([
  ["Falconplein","2000"],["Cadixstraat","2000"],["Frankrijklei","2000"],
  ["Amsterdamstraat","2000"],["Ernest Van Dijckkaai","2000"],
  ["Belgiëlei","2018"],["Anselmostraat","2018"],["Draakstraat","2018"],["Desguinlei","2018"],
  ["Abdijstraat","2020"],["Jan De Voslei","2020"],["Camille Huysmanslaan","2020"],["Beukenlaan","2020"],
  ["Groenendaallaan","2030"],["Havanastraat","2030"],["Bostonstraat","2030"],["Ekersesteenweg","2030"],
  ["Blancefloerlaan","2050"],["Gloriantlaan","2050"],["Halewijnlaan","2050"],["Hanegraefstraat","2050"],
  ["De Coninckplein","2060"],["Carnotstraat","2060"],["Dambruggestraat","2060"],["Handelstraat","2060"],
]);

test("25 NIEUWE straten: officiële naam, postcode, zoekresultaat en strikt straatfilter", () => {
  assert.equal(EXTRA_25.length, 25);
  assert.equal(new Set(EXTRA_25.map(([naam]) => naam)).size, 25);
  const postcodeCount = {};
  for (const [name, postcode] of EXTRA_25) {
    postcodeCount[postcode] = (postcodeCount[postcode] || 0) + 1;
    const direct = streets.filter(s => s[1] === name && s[2] === postcode);
    assert.equal(direct.length, 1, name + " " + postcode + " officiële registratie");
    const matches = searchPlaces(index, name + " " + postcode, { limit: 20 });
    const found = matches.find(r => r.place.name === name && String(r.place.postcode) === postcode);
    assert.ok(found, name + " " + postcode + " niet vindbaar in suggesties");
    const view = createAgendaView();
    view.setStreet(name, { id: String(direct[0][0]), name, postcode });
    assert.ok(view.matchesStreet({ streets: [{ id: String(direct[0][0]), name, postcode }] }),
      name + " geselecteerde straat sluit zichzelf uit");
    assert.equal(view.matchesStreet({ streets: [{ id: "niet-dezelfde", name: "Andere straat", postcode }] }), false);
  }
  assert.deepEqual(Object.keys(postcodeCount).sort(), ["2000","2018","2020","2030","2050","2060"]);
  console.log("QA25_VERIFIED=" + JSON.stringify({ total:25, postcodes:postcodeCount }));
});

test("25 straten: verslag van publieke evenementendata, domeinen en ontbrekende publiekslinks", () => {
  const text = readFileSync(new URL("../site/agenda-feed.js", import.meta.url), "utf8");
  const ctx = { window: {} };
  // De publieke feed bevat geen code van externe websites; vm draait uitsluitend het gegenereerde projectbestand.
  vm.runInNewContext(text, ctx, { timeout: 4000 });
  const feed = ctx.window.PUBLIC_AGENDA_FEED;
  assert.ok(feed && Array.isArray(feed.items), "gebouwde agenda-feed bestaat");
  const audit = [];
  for (const [name, postcode] of EXTRA_25) {
    const matched = feed.items.filter(item => String(item.location || "").toLocaleLowerCase("nl-BE")
      .includes(name.toLocaleLowerCase("nl-BE")));
    const categories = [...new Set(matched.map(item => item.category || globalThis.PublicAgendaUitgaan.categoryOf(item)))].sort();
    const links = matched.map(item => String(item.link || item.sourceUrl || "").trim());
    const withHttps = links.filter(link => /^https:\/\/[^/ ]+/.test(link)).length;
    const generic = links.filter(link => /^https:\/\/[^/ ]+\/?(?:\?.*)?$/.test(link)).length;
    audit.push({ name, postcode, events:matched.length, categories, httpsLinks:withHttps,
      withoutDirectPage:links.length - withHttps, genericHomepages:generic });
  }
  console.log("QA25_AGENDA_LINK_AUDIT=" + JSON.stringify({ generatedAt:feed.generatedAt,
    totalEventsInFeed:feed.items.length, streets:audit }));
  assert.equal(audit.length, 25);
});


test("alle feeditems: rapporteer echte bestemmingen, homepagefouten en datumzekerheid", () => {
  const txt=readFileSync(new URL("../site/agenda-feed.js",import.meta.url),"utf8");
  const box={window:{}}; vm.runInNewContext(txt,box,{timeout:4000});
  const items=box.window.PUBLIC_AGENDA_FEED?.items||[];
  const stat={total:items.length,withHttps:0,noLink:0,technicalLinks:0,homepageLinks:0,verifiedRegistrationUrls:0,unverifiedRegistrationUrls:0,unknownHours:0,byCategory:{},topDomains:{}};
  for(const item of items){
    const theme=item.category||globalThis.PublicAgendaUitgaan.categoryOf(item);
    stat.byCategory[theme]=(stat.byCategory[theme]||0)+1;
    const target=String(item.link||item.sourceUrl||"").trim();
    let u;try{u=new URL(target)}catch{}
    if(!u||u.protocol!=="https:")stat.noLink++;
    else{
      stat.withHttps++;
      stat.topDomains[u.hostname]=(stat.topDomains[u.hostname]||0)+1;
      if(u.pathname==="/"&&!u.search)stat.homepageLinks++;
      if(/^(?:geo\.api\.vlaanderen\.be|geodata\.antwerpen\.be|gipod\.api\.vlaanderen\.be)$/.test(u.hostname))stat.technicalLinks++;
    }
    if(item.registrationUrl) {
      if(item.registrationVerified===true)stat.verifiedRegistrationUrls++;
      else stat.unverifiedRegistrationUrls++;
    }
    if(!/^\d{2}:\d{2}$/.test(String(item.timeSlot||""))
       && !/^(hele dag|all day)$/i.test(String(item.timeSlot||"")))stat.unknownHours++;
  }
  stat.topDomains=Object.fromEntries(Object.entries(stat.topDomains).sort((a,b)=>b[1]-a[1]).slice(0,15));
  console.log("QA_717_LINKS="+JSON.stringify(stat));
  assert.equal(stat.total,items.length);
  assert.equal(stat.total,stat.withHttps+stat.noLink);
});
