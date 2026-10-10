// Leave-one-out op de 38 met de hand nagekeken evenementendossiers (tests/fixtures/parcours-herkenning):
// verberg telkens de handfiche van één dossier en laat de herkenner het doen met de andere 37 (als
// patroonbibliotheek) en de vastgelegde kalender-, GIPOD- en feeddata. Geen netwerk.
import fs from "node:fs";
import path from "node:path";

import { bijwerkenPatronen, bibliotheekUit, bouwHerkenning, dossiersUitAsign, gewoonWoord, plat, soortenIn, verrijk } from "../../lib/parcours-herkenning.mjs";

export const VANDAAG = "2026-10-10";
// Een huisnummer na een straatnaam (zelfde regel als lib/evenement-identiteit-validatie.mjs).
export const HUISNUMMERS_TEST = /(?:straat|laan|lei|plein|baan|weg|kaai|vest|rui|markt|plaats|dreef|steenweg)\s+\d+[a-z]?\b/i;
const lees = (root, ...p) => JSON.parse(fs.readFileSync(path.join(root, ...p), "utf8"));

export function laadFixtures(root) {
  const dir = ["tests", "fixtures", "parcours-herkenning"];
  const asign = lees(root, ...dir, "asign.json");
  const straten = lees(root, ...dir, "straten.json");
  const districten = lees(root, "lib", "districten-antwerpen.geojson").features.map((f) => ({ naam: f.properties.naam, geometry: f.geometry }));
  const districtGrens = lees(root, "lib", "district-antwerpen-grens.geojson").features[0].geometry;
  const dossiers = [...dossiersUitAsign(asign.features).values()].map((d) => {
    const v = verrijk(d, { districten, districtGrens });
    return { ...v, ...(straten[d.dossier] || {}), soort: v.soort };
  });
  return {
    asign, districten, dossiers,
    hand: lees(root, ...dir, "hand.json"),
    historiek: lees(root, ...dir, "historiek.json"),
    kandidaten: lees(root, ...dir, "kandidaten.json").kandidaten,
    charter: lees(root, "lib", "studentencharter.json"),
  };
}

// Woorden die alleen een soort noemen: een gedeeld "cantus" of "halloween" zegt niet dat het hetzelfde
// evenement is. Ook samenstellingen ervan ("halloweentocht", "trailrun").
const GENERIEK = new Set(("doop dopen dril cantus schachten kroegentocht halloween griezel griezeltocht criterium koers wielerkoers " +
  "wielerwedstrijd marathon jogging loop lopen run trail kids parkloop stratenloop sponsorloop wandeling wandel wandeltocht tocht fietstocht " +
  "stoet optocht parade processie carnaval markt kerstmarkt rommelmarkt braderie herdenking sinterklaas sint feest buurtfeest straatfeest " +
  "fuif party concert festival quiz avond dag nacht").split(" "));
function generiek(w) {
  if (!w) return true;
  if (GENERIEK.has(w)) return true;
  for (let i = 3; i < w.length - 2; i++) if (GENERIEK.has(w.slice(0, i)) && generiek(w.slice(i))) return true;
  return false;
}
// Twee opeenvolgende woorden gemeen, samen minstens 10 letters, niet allebei gewoon ("Nationale Sluitingsprijs").
function gedeeldPaar(a, b) {
  const paren = (t) => { const w = t.split(" "); return w.slice(1).map((y, i) => [w[i], y]); };
  const pb = new Set(paren(b).map((p) => p.join(" ")));
  return paren(a).some(([x, y]) => pb.has(`${x} ${y}`) && x.length + y.length >= 10 && !(gewoonWoord(x) && gewoonWoord(y)));
}
// Valt de automatische naam samen met de handfiche? Streng: de ene naam bevat de andere (niet als dat
// alleen een soortwoord is), twee opeenvolgende woorden gemeen, een stuk van 8 letters dat niet in een
// soortwoord valt ("Campustrail" en "Campus Trailrun"), of een eigen woord gemeen met de naam of de
// soort van de handfiche ("Fabiant"). Eén gedeeld soortwoord ("Cantus", "Halloween") telt niet.
export function zelfdeNaam(auto, hand) {
  const a = plat(auto), n = plat(hand.naam), s = plat(hand.soort);
  if (!a) return false;
  if (n) {
    const [kort, lang] = a.length <= n.length ? [a, n] : [n, a];
    if (kort.length >= 5 && lang.includes(kort) && !(kort.split(" ").length === 1 && generiek(kort))) return true;
    if (gedeeldPaar(a, n)) return true;
    // Per letter: hoort ze bij een betekenisvol woord (geen gewoon woord, plaatsnaam of soortwoord)?
    const woordenA = a.split(" ");
    const p = woordenA.join(""), q = n.replace(/ /g, "");
    const telt = woordenA.flatMap((w) => [...w].map(() => !gewoonWoord(w) && !generiek(w) && w.length > 2));
    const woordenN = n.split(" ").filter((w) => w.length >= 8 && generiek(w));
    for (let i = 0; i + 8 <= p.length; i++) {
      const stuk = p.slice(i, i + 8);
      if (q.includes(stuk) && telt.slice(i, i + 8).filter(Boolean).length >= 5 && !woordenN.some((w) => w.includes(stuk))) return true;
    }
  }
  const eigen = (t) => t.split(" ").filter((w) => w.length >= 5 && !/\d/.test(w) && !gewoonWoord(w) && !generiek(w));
  const hier = new Set([...eigen(n), ...eigen(s)]);
  return eigen(a).some((w) => hier.has(w));
}
// Past de soort bij de handfiche? Zelfde soortgroep uit SOORTEN, of de handfiche noemt het woord.
const GROEP = { student: ["student", "haltes"], haltes: ["student", "haltes", "wandel", "tocht"], loop: ["loop", "wandel"], wandel: ["wandel", "loop", "tocht", "halloween"], tocht: ["tocht", "wandel", "loop"], halloween: ["halloween", "wandel"], sint: ["sint", "stoet"], stoet: ["stoet", "sint", "herdenking", "student"] };
export function zelfdeSoort(auto, hand) {
  const a = soortenIn([auto]), h = soortenIn([hand.soort, hand.naam]);
  if (!a.length || !h.length) return false;
  return a.some((k) => (GROEP[k] || [k]).some((g) => h.includes(g)));
}

export function evalueer(root, { ids = null } = {}) {
  const f = laadFixtures(root);
  const alle = Object.keys(f.hand.dossiers).sort().filter((id) => !ids || ids.includes(id));
  const rijen = [];
  // Alle 38 als patroonbibliotheek (zoals evenement-patronen.json na een verversing); per ronde valt
  // het verborgen dossier eruit.
  const volledig = bibliotheekUit(bijwerkenPatronen(null, { dossiers: f.dossiers, hand: f.hand, vandaag: VANDAAG }));
  for (const id of alle) {
    const handZonder = { ...f.hand, dossiers: Object.fromEntries(Object.entries(f.hand.dossiers).filter(([k]) => k !== id)) };
    const bibliotheek = volledig.filter((e) => e.dossier !== id);
    const doc = bouwHerkenning({ dossiers: f.dossiers.map((d) => ({ ...d })), hand: handZonder, bibliotheek, kandidaten: f.kandidaten, historiek: f.historiek, charter: f.charter, vandaag: VANDAAG, generatedAt: `${VANDAAG}T08:00:00.000Z` });
    const auto = doc.dossiers[id];
    const h = f.hand.dossiers[id];
    let oordeel;
    if (!auto) oordeel = "ontbreekt";
    else if (auto.zekerheid === "zeker") oordeel = h.zekerheid === "zeker" && zelfdeNaam(auto.naam, h) ? "zeker-juist" : "zeker-FOUT";
    else if (auto.zekerheid === "waarschijnlijk") {
      if (auto.naam && !(h.naam && zelfdeNaam(auto.naam, h)) && !zelfdeNaam(auto.naam, h)) oordeel = "waarsch-naam-fout";
      else if (h.zekerheid === "onbekend") oordeel = "waarsch-te-stellig";
      else oordeel = zelfdeSoort(auto.soort, h) || (auto.naam && zelfdeNaam(auto.naam, h)) ? "waarsch-juist" : "waarsch-soort-anders";
    } else oordeel = h.zekerheid === "onbekend" ? "onbekend-juist" : "alleen-kaartzin";
    rijen.push({ dossier: id, hand: h.zekerheid, handNaam: h.naam, handSoort: h.soort, auto: auto || {}, oordeel, kaartzin: Boolean(auto?.kaartzin) });
  }
  const telling = {};
  for (const r of rijen) telling[r.oordeel] = (telling[r.oordeel] || 0) + 1;
  telling.kaartzin = rijen.filter((r) => r.kaartzin).length;
  telling.totaal = rijen.length;
  return { rijen, telling };
}
