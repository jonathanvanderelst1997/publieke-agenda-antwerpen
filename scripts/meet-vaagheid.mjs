// Vaagheidsmeter: telt hoeveel items vaag zijn, per patroon en per bron, op drie plekken:
//  1. de agendalijst: elk komend item uit site/agenda-feed.js (de velden, en de info als detail);
//  2. de eventpagina's (site/event/<id>/index.html): de zichtbare tekst;
//  3. de plekpagina: een vaste set straten (STRATEN_TOETS), met dezelfde bouwfuncties als de browser
//     (site/place-core.js, site/kaart-uitleg.js, site/permit-clarity.js, site/bezoekers-bronnen.js) op het
//     straatbestand van de ochtend (site/straat/<id>.json): de kop van elke kaart én haar detail.
// Altijd op vaste data: geen netwerk, geen browser, geen live nakijken en geen klok ("vandaag" is de
// classificatiedag van de feed). De meting noemt de vingerafdruk van haar invoer (`invoer`), zodat de ratel
// (tests/vaagheid.test.mjs) alleen metingen op dezelfde data vergelijkt: dan komt een verschil van de code.
// Uitvoer: JSON op stdout (of --uit <pad>). Met --vorige <pad> ook de vergelijking (exitcode 1 bij stijging).
// De meting noemt ook de vingerafdruk van de code (`code`), en de vergelijking die van de vorige meting
// (`vergelijking.vorige`: invoer en code). Zo ziet validateVaagheid (lib/vaagheid.mjs) of een stijging op dezelfde
// data van de code komt: dan moet ze uitdrukkelijk aanvaard zijn (`aanvaard`, met een reden; --aanvaard "<reden>").
// Een tak die ook data wijzigt, meet CI daarnaast met de code van de basis op dezelfde data
// (scripts/vaagheid-tegen-basis.mjs).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { VAAGHEID_FILE, nietAanvaardeStijgingen, vaagheidVanAgendapunt, vaagheidVanKaart, vatSamen, vergelijk } from "../lib/vaagheid.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lees = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));

// Vaste set straten: de 18 van de stratentoets van 9 oktober (6 postcodes) plus drukke pleinen en
// straten met evenementen, markten en werven. Alleen straatnamen (geen huisnummers).
export const STRATEN_TOETS = Object.freeze([
  ["Peterseliestraat", "2000"], ["Riemstraat", "2000"], ["Vrijdagmarkt", "2000"], ["Meir", "2000"], ["Groenplaats", "2000"],
  ["Grote Markt", "2000"], ["Kloosterstraat", "2000"], ["Paardenmarkt", "2000"], ["Sint-Jansvliet", "2000"], ["Kammenstraat", "2000"],
  ["Isabella Brantstraat", "2018"], ["Maria-Henriëttalei", "2018"], ["Van Ertbornstraat", "2018"], ["Theaterplein", "2000"],
  ["Frans Hensstraat", "2020"], ["Lodewijk De Raetstraat", "2020"], ["Pieter Coeckelaan", "2020"],
  ["Bermstraat", "2030"], ["Doctor Decrolystraat", "2030"], ["Letlandstraat", "2030"], ["Bonapartedok", "2000"],
  ["Emile Dancolaan", "2050"], ["Roemer Visscherstraat", "2050"], ["Thonetlaan", "2050"],
  ["Van Kerckhovenstraat", "2060"], ["Merksemsestraat", "2060"], ["Dageraadplaats", "2060"], ["De Coninckplein", "2060"],
]);

// De vingerafdruk van alles waarop de meting steunt en wat de verversing schrijft: de bronbestanden
// (site/sources, zonder deze meting zelf), de straatbestanden van de vaste straten en de straatlijsten. De
// gebouwde bestanden (site/agenda-feed.js, site/event/) horen er niet bij: die maakt de code van deze tak.
// De vingerafdruk van de code die de meting maakt: lib/, scripts/ en de modules van site/ (zonder de gebouwde
// site/agenda-feed.js). Verandert ze tussen twee metingen op dezelfde invoer, dan komt een verschil van de code.
export function codeVingerafdruk() {
  const hash = crypto.createHash("sha256");
  const lijst = (dir, re) => (fs.existsSync(path.join(root, dir)) ? fs.readdirSync(path.join(root, dir), { recursive: true }).map(String).filter((n) => re.test(n)).map((n) => `${dir}/${n.split(path.sep).join("/")}`) : []);
  const bestanden = [...lijst("lib", /\.(?:mjs|js|json|geojson)$/), ...lijst("scripts", /\.mjs$/), ...fs.readdirSync(path.join(root, "site")).filter((n) => /\.js$/.test(n) && n !== "agenda-feed.js").map((n) => `site/${n}`)].sort();
  for (const rel of bestanden) { hash.update(`${rel}\n`); hash.update(fs.readFileSync(path.join(root, rel))); }
  return hash.digest("hex").slice(0, 16);
}

export function invoerVingerafdruk({ straten = STRATEN_TOETS } = {}) {
  const hash = crypto.createHash("sha256");
  const voeg = (rel) => {
    const f = path.join(root, rel);
    if (!fs.existsSync(f)) return;
    hash.update(`${rel}\n`);
    hash.update(fs.readFileSync(f));
  };
  const bronnen = fs.readdirSync(path.join(root, "site", "sources")).filter((n) => n.endsWith(".json") && n !== VAAGHEID_FILE).sort();
  for (const n of bronnen) voeg(`site/sources/${n}`);
  for (const rel of ["site/geo/straten.json", "site/geo/wijken.geo.json", "site/geo/locaties.json", "site/straat-index.json"]) voeg(rel);
  const stratenDoc = JSON.parse(fs.readFileSync(path.join(root, "site", "geo", "straten.json"), "utf8"));
  for (const [naam, postcode] of straten) {
    const ref = stratenDoc.streets.find(([, n, p]) => n === naam && String(p) === postcode) || stratenDoc.streets.find(([, n]) => n === naam);
    if (ref) voeg(`site/straat/${ref[0]}.json`);
  }
  return hash.digest("hex").slice(0, 16);
}

function feedItems() {
  const tekst = fs.readFileSync(path.join(root, "site", "agenda-feed.js"), "utf8");
  return JSON.parse(tekst.slice(tekst.indexOf("{"), tekst.lastIndexOf("}") + 1));
}

export function meetAgenda(feed, vandaag) {
  const komend = (feed.items || []).filter((i) => (i.endDate || i.date) >= vandaag);
  const res = komend.map(vaagheidVanAgendapunt);
  // De wekelijkse markten (stad-markten, honderden identieke marktdagen) verdunnen het aandeel: ook zonder.
  const zonderMarkten = res.filter((r) => r.sourceId !== "stad-markten");
  const district = res.filter((r, k) => komend[k].scope === "district");
  return { ...vatSamen(res), zonderMarkten: { items: zonderMarkten.length, vaag: zonderMarkten.filter((r) => r.kern).length }, district: { items: district.length, vaag: district.filter((r) => r.kern).length }, voorbeelden: voorbeelden(komend, res) };
}
function voorbeelden(items, res) {
  const uit = {};
  res.forEach((r, k) => { for (const id of r.patronen) if ((uit[id] ||= []).length < 3) uit[id].push(`${items[k].date} | ${items[k].title} | ${items[k].location}`.slice(0, 160)); });
  return uit;
}

// De eventpagina's (site/event/<id>/index.html, scripts/build-agenda.mjs): de tekst zoals een gedeelde
// link hem toont. Alleen de zichtbare tekst, zonder de JSON-LD.
export function meetEventpaginas(feed, vandaag) {
  const komend = new Map((feed.items || []).filter((i) => (i.endDate || i.date) >= vandaag).map((i) => [i.id, i]));
  const res = [];
  for (const id of komend.keys()) {
    const f = path.join(root, "site", "event", id, "index.html");
    if (!fs.existsSync(f)) continue;
    const html = fs.readFileSync(f, "utf8").replace(/<script[\s\S]*?<\/script>/g, " ");
    const tekst = html.replace(/<[^>]+>/g, "\n").split("\n").map((x) => x.trim()).filter(Boolean);
    const titel = tekst.find((x) => x === komend.get(id).title) || komend.get(id).title;
    res.push({ ...vaagheidVanKaart({ titel, regels: tekst }), sourceId: komend.get(id).sourceId });
  }
  return vatSamen(res);
}

// Wat een opengeklapte kaart er nog bij zegt, zoals rowTemplate en uitlegTemplate in site/place-view.js het
// tekenen: de toelichting, de regels en het dossier van de uitleg, de bronregel, "Niet in de bron", de
// voetnoot, en bij een kaart zonder uitleg de info, het uur, de status en de bronhint.
export function detailVanKaart(e, d = {}, { kaartIndeling, bezoekersHint }) {
  const u = e.uitleg;
  const uit = [d.toelichting];
  if (u) {
    const { regels, dossier, bron, technisch } = kaartIndeling(u, { reference: e.reference, straten: (e.straten || []).length });
    uit.push(...regels.map(([k, v]) => `${k}: ${v}`), ...dossier.zichtbaar, ...dossier.dicht, ...bron.map(([k, v]) => `${k}: ${v}`), technisch, u.stratenNoot, u.voetnoot, u.bronTekst);
    if (u.ontbreekt?.length) uit.push(`Niet in de bron: ${u.ontbreekt.join(" · ")}.`);
  } else if (!d.eigenDetail) {
    uit.push(e.info, e.timeText, e.status ? `Status: ${e.status}` : "");
  }
  uit.push(bezoekersHint(e));
  return uit.map((x) => String(x ?? "").trim()).filter(Boolean);
}

// De soort van een kaart voor de telling: de laag, en bij de publieke ruimte de soort rij; een werfkaart (een werk met
// zijn werfzone, place-core.js samenWerven) is een werk.
const soortVan = (e) => (e.source === "publicSpace" ? `publicSpace:${e.item?.kind || "?"}` : e.source === "agenda" ? `agenda:${e.item?.sourceId || "hand"}` : e.source);

export async function meetStraten(vandaag, { straten = STRATEN_TOETS } = {}) {
  const PC = await import("../site/place-core.js");
  const { lagenUitStand } = await import("../site/straat-snapshot.js");
  const { duidelijkeKaart } = await import("../site/permit-clarity.js");
  const { leesbaarUur, bezoekersHint } = await import("../site/bezoekers-bronnen.js");
  const { kaartIndeling } = await import("../site/place-view.js");
  const { createAgendaView, agendaTheme } = await import("../site/agenda-view.js");
  const { resolveAddressStreets } = await import("../site/street-core.js");
  const { locationKey } = await import("../site/neighborhood-core.js");
  const { wijkFeatures, bboxOf } = await import("../site/neighborhood-core.js");

  const stratenDoc = lees("site/geo/straten.json");
  const wijken = wijkFeatures(lees("site/geo/wijken.geo.json")).filter((f) => f.properties.code.startsWith("ANT"));
  const index = PC.buildPlaceIndex({ streets: stratenDoc.streets, wijken: wijken.map((f) => ({ code: f.properties.code, naam: f.properties.naam, box: bboxOf(f.geometry) })) });
  const byName = new Map();
  for (const [id, name, postcode] of stratenDoc.streets) byName.set(locationKey(name), [...(byName.get(locationKey(name)) || []), { id: String(id), name, postcode: String(postcode || "") }]);
  const geo = (() => { try { return lees("site/geo/locaties.json"); } catch { return { entries: {} }; } })();
  const wijkVan = (straat) => { const p = index.places.find((x) => x.type === "straat" && x.name === straat); return (p?.wijken?.[0] && index.byKey.get(`wijk:${p.wijken[0]}`)?.label) || ""; };
  const uitleg = lees("site/sources/kaart-uitleg.json");
  const identiteit = PC.identiteitSamen(lees("site/sources/evenement-identiteit.json"), lees("site/sources/evenement-identiteit-auto.json"));
  let inzage = null; try { inzage = lees("site/sources/inzage-status.json"); } catch { /* zonder */ }
  const feed = feedItems();
  // Zoals site/agenda.js: eerst de soort, dan de wekelijkse reeksen, dan de categorie (agendaTheme leest die).
  await import("../site/event-types.js");
  await import("../site/agenda-uitgaan.js");
  const U = globalThis.PublicAgendaUitgaan, E = globalThis.PublicAgendaEventTypes;
  const metSoort = (feed.items || []).filter((i) => (i.endDate || i.date) >= vandaag).map((i) => ({ ...i, feed: true, eventType: E.classifyEventType(i) }));
  const agendaItems = (typeof U.markeerWekelijkseReeksen === "function" ? U.markeerWekelijkseReeksen(metSoort) : metSoort).map((i) => ({ ...i, category: U.categoryOf(i) }));
  const straatIndex = lees("site/straat-index.json");

  const perStraat = {}, alle = [], regelsIngeklapt = [];
  for (const [naam, postcode] of straten) {
    const ref = (byName.get(locationKey(naam)) || []).find((r) => r.postcode === postcode) || (byName.get(locationKey(naam)) || [])[0];
    if (!ref) { perStraat[naam] = { fout: "straat niet in de straatas" }; continue; }
    const view = createAgendaView();
    view.setResolver((address, item) => {
      const found = resolveAddressStreets(address, { byName }).streets;
      if (found.length) return found;
      const e = geo.entries?.[locationKey(address || item?.address || "")];
      return e?.street ? (byName.get(locationKey(e.street)) || []).filter((r) => !e.postcode || r.postcode === String(e.postcode)) : [];
    });
    // Zoals place-view.js (setStreetLists): een agendapunt uit de evenementendossiers hangt aan al zijn straten.
    // Een oudere code (de basis in scripts/vaagheid-tegen-basis.mjs) kent die functie misschien niet: dan niet.
    if (typeof PC.stratenVanAgendapunt === "function") view.setStreetLists((item) => {
      const namen = PC.stratenVanAgendapunt(item);
      return namen.length ? namen.flatMap((n) => byName.get(locationKey(n)) || []) : null;
    });
    view.setStreet(naam, ref);
    const bestand = path.join(root, "site", "straat", `${ref.id}.json`);
    const doc = straatIndex.straten?.[ref.id] && fs.existsSync(bestand) ? JSON.parse(fs.readFileSync(bestand, "utf8")) : null;
    const live = lagenUitStand(doc ? { doc } : null, { inzage, vandaag });
    const inPlace = (rows) => rows.filter((row) => view.matchesStreet(row));
    const agendaHier = agendaItems.filter((i) => view.matchesStreet(i)).map((i) => PC.agendaEntry(i, agendaTheme(i)));
    const liveRuw = [
      ...PC.werkEntries(inPlace(live.works), { vandaag, uitleg }),
      ...PC.publicSpaceEntries(inPlace(live.publicSpace), { vandaag, alle: live.publicSpace, uitleg, wijkVan, identiteit, agendaItems, straat: naam, straal: 0, index: null, lijstVan: null }),
      ...inPlace(live.permits).map((row) => PC.permitEntry(row)),
      ...PC.terrasEntries(inPlace(live.terraces)),
    ];
    // Eén werfkaart per dossiernummer (werfzone, GIPOD-werk en parkeerverboden met dezelfde fasen), zoals collect()
    // in site/place-view.js. Een oudere code (de basis in scripts/vaagheid-tegen-basis.mjs) kent die stap niet.
    const liveHier = typeof PC.samenWerven === "function" ? PC.samenWerven(liveRuw, { uitleg, straat: naam, vandaag, alle: live.publicSpace }) : liveRuw;
    // Eén kaart per dossiernummer, zoals collect() in site/place-view.js.
    const een = typeof PC.eenKaartPerDossier === "function" ? PC.eenKaartPerDossier(agendaHier, liveHier) : { agenda: agendaHier, live: liveHier };
    // Verrijken met wat al binnen is (parkeerverbod bij zijn evenement, ook gepland hier), zoals collect().
    const entries = typeof PC.verrijkMetContext === "function" ? PC.verrijkMetContext([...een.agenda, ...een.live], { straat: naam, vandaag, agendaItems, uitleg }) : [...een.agenda, ...een.live];
    // Wat de lijst ingeklapt bundelt (terrassen per straat, innames en aanvragen zonder omschrijving, vermoedelijke
    // studentenactiviteiten per dag: bundelLijst in site/place-core.js). Een kaart in een bundel telt mee in `items`
    // en `vaag` (wat er op de plek staat), niet in `losse` (wat de bewoner als losse kaart ziet).
    const lijst = typeof PC.bundelLijst === "function" ? PC.bundelLijst(entries, { straat: naam, vandaag }) : { losse: entries, bundels: [] };
    const res = [];
    const meet = (e, bundel = "") => {
      const multi = Boolean((e.end && e.end > e.start) || e.openEnd);
      const d = duidelijkeKaart(e, e.item || {}, { straat: naam, vandaag });
      const titel = d.titel || e.title;
      const uur = d.tijd || leesbaarUur(e, { multi, running: multi && e.start <= vandaag });
      const regels = [d.samenvatting, e.summary, ...(e.uitleg?.kern || []).map(([k, v]) => `${k}: ${v}`), ...(d.regels || []).map(([k, v]) => `${k}: ${v}`), e.source === "agenda" ? e.location : ""].filter(Boolean);
      const detail = detailVanKaart(e, d, { kaartIndeling, bezoekersHint });
      const r = { ...vaagheidVanKaart({ titel, uur, regels, detail, onbekend: e.onbekend }), soort: soortVan(e), straat: naam, titel, uid: e.uid, ...(bundel ? { bundel } : {}) };
      // Een omgevingsaanvraag zegt altijd "Start van de werken: Niet gepubliceerd".
      if (regels.some((x) => /^Start van de werken: Niet gepubliceerd/.test(x))) r.patronen = [...r.patronen, "start-werken-onbekend"].sort();
      return r;
    };
    for (const e of lijst.losse) res.push(meet(e));
    const ledenVan = (b) => b.bundel?.leden || b.leden || [];
    for (const b of lijst.bundels) for (const lid of ledenVan(b)) res.push(meet(lid, b.uid));
    const losse = res.filter((r) => !r.bundel);
    perStraat[naam] = { kaarten: res.length, vaag: res.filter((r) => r.kern).length, losseKaarten: losse.length, losseVaag: losse.filter((r) => r.kern).length, ingeklapt: lijst.bundels.length };
    regelsIngeklapt.push(...lijst.bundels.map((b) => ({ straat: naam, uid: b.uid, soort: b.bundel?.soort || "?", titel: b.title, leden: ledenVan(b).length })));
    alle.push(...res);
  }
  const sam = vatSamen(alle, (r) => r.soort);
  // Dezelfde kaart staat vaak in meer straten: ook uniek geteld.
  const uniek = new Map(alle.map((r) => [r.uid, r]));
  sam.uniek = { kaarten: uniek.size, vaag: [...uniek.values()].filter((r) => r.kern).length };
  // Wat de bewoner als losse kaart ziet (niet in een ingeklapte bundel), per soort; en de ingeklapte regels.
  const losse = alle.filter((r) => !r.bundel);
  sam.losse = { kaarten: losse.length, vaag: losse.filter((r) => r.kern).length };
  for (const [soort, groep] of Object.entries(sam.perGroep)) {
    const eigen = losse.filter((r) => r.soort === soort);
    groep.losse = eigen.length;
    groep.losseVaag = eigen.filter((r) => r.kern).length;
  }
  const perBundel = {};
  for (const b of regelsIngeklapt) { const g = (perBundel[b.soort] ||= { regels: 0, kaarten: 0 }); g.regels += 1; g.kaarten += b.leden; }
  sam.ingeklapt = { regels: regelsIngeklapt.length, kaarten: regelsIngeklapt.reduce((n, b) => n + b.leden, 0), perSoort: Object.fromEntries(Object.entries(perBundel).sort(([a], [b]) => a.localeCompare(b))) };
  const vb = {};
  for (const r of alle) for (const id of r.patronen) if ((vb[id] ||= []).length < 3 && !vb[id].some((x) => x.startsWith(r.titel.slice(0, 40)))) vb[id].push(`${r.titel.slice(0, 110)} (${r.straat})`);
  return { ...sam, perStraat, voorbeelden: vb, kaarten: alle.map((r) => ({ straat: r.straat, uid: r.uid, titel: r.titel, soort: r.soort, patronen: r.patronen, kern: r.kern, ontbreekt: r.detail?.ontbreekt || 0, ...(r.bundel ? { bundel: r.bundel } : {}) })), regels: regelsIngeklapt };
}

// De hele meting, deterministisch: "vandaag" is de classificatiedag van de feed (geen klok).
export async function meetAlles({ vandaag = null } = {}) {
  const feed = feedItems();
  const dag = vandaag || String(feed.classificationAsOf || feed.generatedAt || "").slice(0, 10);
  const t0 = performance.now();
  const agenda = meetAgenda(feed, dag);
  const t1 = performance.now();
  const straten = await meetStraten(dag);
  const t2 = performance.now();
  const eventpaginas = meetEventpaginas(feed, dag);
  const t3 = performance.now();
  return { schema: "vaagheid/1", vandaag: dag, invoer: invoerVingerafdruk(), code: codeVingerafdruk(), agenda, eventpaginas, straten, duur: { agendaMs: Math.round(t1 - t0), stratenMs: Math.round(t2 - t1), eventpaginasMs: Math.round(t3 - t2) } };
}

// De vergelijking met een vorige meting, met de vingerafdrukken van die meting (vorige.invoer en vorige.code).
export function vergelijkMet(uit, vorige) {
  if (!vorige) return null;
  return { vorige: { invoer: vorige.invoer || null, code: vorige.code || null }, ...Object.fromEntries(["agenda", "eventpaginas", "straten"].map((k) => [k, vergelijk(uit[k], vorige[k])])) };
}
// Elke stijging uit een vergelijking als aanvaarde stijging met dezelfde reden (--aanvaard "<reden>").
export function aanvaardAlles(vergelijking, reden) {
  const uit = [];
  for (const k of ["agenda", "eventpaginas", "straten"]) {
    const v = vergelijking?.[k];
    if (!v || v.ok) continue;
    for (const g of v.gestegen || []) uit.push({ waar: k, id: g.id, van: g.van, naar: g.naar, reden });
    if (!v.gestegen?.length) uit.push({ waar: k, id: "aandeel", van: null, naar: v.stijging, reden });
  }
  return uit;
}
// Wat in de repo komt (site/sources/vaagheid.json): alleen tellingen, geen voorbeeldtitels of plaatsen, en
// geen duur (die verschilt per machine). Zo blijft het bestand klein en zonder vrije brontekst.
export function opslagVorm(meting) {
  const kort = ({ voorbeelden, kaarten, regels, ...rest }) => rest;
  return { schema: meting.schema, vandaag: meting.vandaag, invoer: meting.invoer, ...(meting.code ? { code: meting.code } : {}), agenda: kort(meting.agenda), eventpaginas: kort(meting.eventpaginas), straten: kort(meting.straten) };
}

// Eén markdowntabel voor de PR-tekst en de samenvatting van de run (en voor brain_status via de Gateway).
export function meldingTabel(doc) {
  const rij = (k, naam) => {
    const m = doc[k], v = doc.vergelijking?.[k];
    const top = Object.entries(m.perPatroon || {}).slice(0, 4).map(([id, n]) => `${id} ${n}`).join(", ");
    const detail = m.detail ? `${m.detail.meerDanEen} met meer dan één ontbreekt-zin` : "";
    const verboden = Object.entries(m.verboden || {}).map(([id, n]) => `${id} ${n}`).join(", ") || "geen";
    return `| ${naam} | ${m.vaag}/${m.items} (${m.aandeel}%) | ${v?.stijging == null ? "eerste meting" : `${v.stijging >= 0 ? "+" : ""}${v.stijging} pp${v.gestegen?.length ? `; ${v.gestegen.map((g) => `${g.id} ${g.van}->${g.naar}`).join(", ")}` : ""}`} | ${top} | ${detail} | ${verboden} |`;
  };
  return ["| Waar | Vaag | T.o.v. vorige verversing | Grootste patronen | Detail | Verboden zinnen |", "|---|---|---|---|---|---|",
    rij("agenda", "Agendalijst"), rij("eventpaginas", "Eventpagina's"), rij("straten", `Plekpagina (${Object.keys(doc.straten.perStraat || {}).length} vaste straten)`)].join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes("--melding")) {
  // Alleen lezen (refresh.yml): de meting van deze verversing melden; een stijging wordt een waarschuwing.
  const doc = JSON.parse(fs.readFileSync(path.join(root, "site", "sources", VAAGHEID_FILE), "utf8"));
  const tabel = meldingTabel(doc);
  console.log(tabel);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Vaagheid\n\n${tabel}\n`);
  for (const k of ["agenda", "eventpaginas", "straten"]) { const v = doc.vergelijking?.[k]; if (v && v.ok === false) console.log(`::warning title=Vaagheid gestegen (${k})::+${v.stijging} pp; ${(v.gestegen || []).map((g) => `${g.id} ${g.van}->${g.naar}`).join(", ")}`); }
  // Een verboden zin ("naam volgt", "volgt zodra", "naam onbekend" in een titel) hoort nergens te staan.
  for (const k of ["agenda", "eventpaginas", "straten"]) {
    const v = Object.entries(doc[k]?.verboden || {});
    if (v.length) console.log(`::warning title=Verboden zinnen (${k})::${v.map(([id, n]) => `${id} ${n}`).join(", ")}`);
  }
} else if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (naam) => { const i = process.argv.indexOf(naam); return i > 0 ? process.argv[i + 1] : null; };
  try {
    const uit = await meetAlles({ vandaag: arg("--vandaag") });
    const bestand = path.join(root, "site", "sources", VAAGHEID_FILE);
    const vorige = fs.existsSync(arg("--vorige") || bestand) ? JSON.parse(fs.readFileSync(arg("--vorige") || bestand, "utf8")) : null;
    if (vorige) uit.vergelijking = vergelijkMet(uit, vorige);
    // --aanvaard "<reden>": de stijgingen van deze vergelijking zijn bewust (een eerlijkere tekst die meer zegt wat
    // ontbreekt, een nieuwe soort kaart). Ze komen met de reden in het bestand; zonder reden faalt validateVaagheid
    // bij een stijging die van de code komt.
    const reden = arg("--aanvaard");
    const aanvaard = reden ? aanvaardAlles(uit.vergelijking, reden) : [];
    const nieuw = { ...opslagVorm(uit), vergelijking: uit.vergelijking || null, ...(aanvaard.length ? { aanvaard } : {}) };
    // Een stijging op dezelfde data (dus van de code) wordt nooit stil de nieuwe basislijn: dan blijft het bestand
    // staan, tot de terugval opgelost is of met een reden aanvaard (--aanvaard).
    const geweigerd = nietAanvaardeStijgingen(nieuw);
    if (process.argv.includes("--schrijf") && geweigerd.length) console.error(`vaagheid: niet geschreven. ${geweigerd.join(" | ")}`);
    else if (process.argv.includes("--schrijf")) fs.writeFileSync(bestand, `${JSON.stringify(nieuw, null, 1)}\n`);
    // --kaarten <pad>: elke kaart van de plekpagina met haar patronen (om een stijging te verklaren); nooit in de repo.
    if (arg("--kaarten")) fs.writeFileSync(arg("--kaarten"), `${JSON.stringify(uit.straten.kaarten, null, 0)}\n`);
    delete uit.straten.kaarten;
    delete uit.straten.regels;
    const tekst = JSON.stringify(uit, null, 1);
    if (arg("--uit")) fs.writeFileSync(arg("--uit"), `${tekst}\n`); else if (!process.argv.includes("--schrijf")) console.log(tekst);
    // Eén regel per meting, voor de log van de verversing en de PR-tekst.
    for (const k of ["agenda", "eventpaginas", "straten"]) {
      const v = uit.vergelijking?.[k];
      const verboden = Object.entries(uit[k].verboden || {}).map(([id, n]) => `${id} ${n}`).join(", ");
      console.error(`vaagheid ${k}: ${uit[k].vaag}/${uit[k].items} vaag (${uit[k].aandeel}%), detail: ${uit[k].detail.meerDanEen} met meer dan één ontbreekt-zin${verboden ? `, verboden: ${verboden}` : ""}${v?.stijging != null ? `, ${v.stijging >= 0 ? "+" : ""}${v.stijging} pp` : ""}${v?.gestegen?.length ? `; gestegen: ${v.gestegen.map((g) => `${g.id} ${g.van}->${g.naar}`).join(", ")}` : ""}`);
    }
    // --streng (CI): exitcode 1 bij een stijging. Zonder: alleen melden (de verversing gaat altijd door).
    if (process.argv.includes("--streng") && uit.vergelijking && ["agenda", "eventpaginas", "straten"].some((k) => uit.vergelijking[k] && !uit.vergelijking[k].ok)) process.exitCode = 1;
  } catch (error) {
    // Een fout in de meter breekt de verversing niet: de vorige meting blijft staan (de ratel ziet dan aan de
    // vingerafdruk dat ze niet bij deze data hoort).
    console.error(`vaagheid: niet gemeten (${String(error?.message || error).slice(0, 160)})`);
    if (process.argv.includes("--streng")) process.exitCode = 1;
  }
}
