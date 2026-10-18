// Zoeken in heel de stad (bouwplan stap 3): de straatnamen van de 9 andere districten van stad Antwerpen, met
// hun district en postcode, naar site/geo/straten-stad.json. Alleen namen, district en postcode: geen
// coördinaten, geen huisnummers, geen inhoud. De zoekbalk laadt dit bestand pas als iemand begint te typen
// (site/place-view.js), en zegt dan bij een straat buiten district Antwerpen waar ze ligt en wat de site daar
// wel kent (markten, districtsnieuws). Een straatnaam die in meer districten of postcodes bestaat (Statiestraat,
// Bist, Vosstraat), staat er één keer per district: de zoekbalk toont ze allemaal en kiest nooit zelf.
//
// Bronnen (open data, met licentie):
//  1. Stad Antwerpen, "wegenregister straatas postzone" (laag 905 op geodata.antwerpen.be; in het open-data-
//     portaal van de stad als dataset ad342897884349b4a986431bf6237488_905). Per stuk straat: de straatnaam
//     links en rechts, de postcode en het district. Licentie: Gratis Open Data Licentie van stad Antwerpen,
//     bronvermelding "bron stad Antwerpen". Dezelfde bron als site/geo/straten.json (scripts/build-straten.mjs).
//  2. Alleen voor een straatnaam die in gebruik is maar in (1) geen enkel stuk straat heeft (een plein zonder
//     wegsegment, zoals het Arenaplein): Basisregisters Vlaanderen (Digitaal Vlaanderen), het
//     Gebouwen- en adressenregister: de straatnaam en de postcode van haar adressen (alleen die postcode wordt
//     gelezen, nooit een huisnummer). Licentie: Modellicentie voor gratis hergebruik v1.0. Het district volgt
//     uit de postcode (in bron 1 hoort elke postcode buiten district Antwerpen bij precies één district).
//     Heeft zo'n naam geen adres, of ligt ze in district Antwerpen, dan staat ze niet in de lijst (en in de
//     metadata bij "overgeslagen", met de reden): niets gokken.
//
// Draait alleen met de hand (`npm run geo:straten-stad`): straatnamen veranderen zelden en `npm run check`
// mag geen netwerk gebruiken.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DISTRICT_CHANNELS } from "../lib/district-channels.mjs";
import { DISTRICT_POSTCODES } from "../lib/postcodes.mjs";
import { straatasNaam } from "../site/street-core.js";

export const STAD_STRATEN_FILE = path.join("site", "geo", "straten-stad.json");
const AS_URL = "https://geodata.antwerpen.be/arcgissql/rest/services/P_Portal/portal_publiek9/MapServer/905";
const REGISTER_URL = "https://api.basisregisters.vlaanderen.be/v2";

export const BRONNEN = Object.freeze([
  Object.freeze({
    sleutel: "as",
    naam: "Stad Antwerpen, wegenregister straatas postzone (laag 905)",
    url: AS_URL,
    dataset: "https://portaal-stadantwerpen.opendata.arcgis.com/datasets/ad342897884349b4a986431bf6237488_905",
    licentie: "Gratis Open Data Licentie (stad Antwerpen)",
    licentieUrl: "https://www.antwerpen.be/info/gratis-open-data-licentie",
    bronvermelding: "bron stad Antwerpen",
  }),
  Object.freeze({
    sleutel: "register",
    naam: "Basisregisters Vlaanderen, Gebouwen- en adressenregister (straatnamen en de postcode van hun adressen)",
    url: REGISTER_URL,
    dataset: "https://metadata.vlaanderen.be/srv/api/records/58e9b4c0-8510-4a31-a016-9e3b50626f1e",
    licentie: "Modellicentie voor gratis hergebruik v1.0",
    licentieUrl: "https://data.vlaanderen.be/id/licentie/modellicentie-gratis-hergebruik/v1.0",
    bronvermelding: "Basisregisters Vlaanderen, Digitaal Vlaanderen",
  }),
]);

const fold = (value) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// De straatas schrijft een naam die in meer deelgemeenten bestaat soms met de homoniemtoevoeging van het
// adressenregister erachter ("Turnhoutsebaan_DE", "Krijgsbaan_WI"). De straat heet "Turnhoutsebaan": de toevoeging
// valt weg, zoals bij elke straat uit de straatas (straatasNaam in site/street-core.js); het district staat al in de rij.
export const schoneNaam = straatasNaam;

// De districten zoals lib/district-channels.mjs ze kent (sleutel, naam, postcode, pagina op antwerpen.be).
export function districtenTabel(channels = DISTRICT_CHANNELS) {
  return channels.map((c) => ({ key: c.key, label: c.label, postcodes: [...c.postcodes], url: c.url }));
}

// Het district van een rij uit de straatas, ongevoelig voor hoofdletters ("WIlrijk" staat zo in de bron).
// null voor district Antwerpen; een onbekend district is een fout (dan is er een district bijgekomen).
export function districtVan(waarde, districten) {
  const f = fold(waarde);
  if (f === "antwerpen") return null;
  const d = districten.find((x) => fold(x.label) === f);
  if (!d) throw new Error(`onbekend district in de straatas: ${JSON.stringify(waarde)}`);
  return d;
}

// Pure omzetting, ook in de toetsen: rijen { naam, id, postcode, district } uit de straatas (beide kanten van de
// straat), plus de aanvulling uit het adressenregister, naar de compacte lijst [naam, districtIndex, postcode].
// Eén rij per naam, district en postcode; gesorteerd op naam (nl), dan district.
export function bouwStadStraten({ asRijen = [], aanvulling = [], districten = districtenTabel() } = {}) {
  const rijen = new Map();
  const bron = new Map();
  const voegToe = (naam, district, postcode, herkomst) => {
    const n = schoneNaam(naam);
    if (!n || !/[a-z]/i.test(n)) return;
    const pc = String(postcode ?? "").trim();
    if (!district.postcodes.includes(pc)) throw new Error(`postcode ${pc} hoort niet bij district ${district.label} (${n})`);
    const key = `${n}|${district.key}|${pc}`;
    if (!rijen.has(key)) rijen.set(key, [n, districten.indexOf(district), pc]);
    if (!bron.has(key)) bron.set(key, herkomst);
  };
  for (const rij of asRijen) {
    const district = districtVan(rij.district, districten);
    if (!district) continue;
    voegToe(rij.naam, district, rij.postcode, "as");
  }
  for (const rij of aanvulling) {
    const district = districten.find((d) => d.key === rij.district);
    if (district) voegToe(rij.naam, district, rij.postcode, "register");
  }
  const straten = [...rijen.values()].sort((a, b) => a[0].localeCompare(b[0], "nl") || a[1] - b[1] || a[2].localeCompare(b[2]));
  const uitRegister = [...bron.entries()].filter(([, h]) => h === "register").map(([k]) => k.split("|")[0]).sort((a, b) => a.localeCompare(b, "nl"));
  return { straten, uitRegister };
}

// Het district van een straatnaam uit het adressenregister, via de postcodes van haar adressen. Alleen als alle
// postcodes bij één ander district horen; anders een reden om ze over te slaan.
export function districtUitPostcodes(postcodes, districten = districtenTabel()) {
  const pcs = [...new Set(postcodes.map(String))];
  if (!pcs.length) return { reden: "geen adres in het adressenregister, dus geen postcode" };
  if (pcs.some((pc) => DISTRICT_POSTCODES.includes(pc))) return { reden: `ligt (ook) in district Antwerpen (${pcs.join(", ")})` };
  const ds = [...new Set(pcs.map((pc) => districten.find((d) => d.postcodes.includes(pc))?.key || "?"))];
  if (ds.length !== 1 || ds[0] === "?") return { reden: `postcodes ${pcs.join(", ")} horen niet bij één district` };
  return { district: ds[0], postcode: pcs[0] };
}

// De postcode uit een volledig adres van het register ("Arenaplein 1, 2100 Antwerpen"). Het huisnummer valt weg.
export const postcodeUitAdres = (tekst) => /,\s*(\d{4})\s/.exec(String(tekst ?? ""))?.[1] || "";

// ---- netwerk ----
async function haal(url, { accept = "application/json", pogingen = 3 } = {}) {
  let fout = null;
  for (let i = 0; i < pogingen; i += 1) {
    try {
      const r = await fetch(url, { headers: { Accept: accept, "User-Agent": "publieke-agenda-antwerpen (straatnamen, handmatig)" } });
      if (!r.ok) throw new Error(`HTTP ${r.status} voor ${url}`);
      const json = await r.json();
      if (json?.error) throw new Error(`bronfout: ${json.error.message || "onbekend"}`);
      return json;
    } catch (error) { fout = error; await new Promise((ok) => setTimeout(ok, 800 * (i + 1))); }
  }
  throw fout;
}

// Per district en per kant van de straat de unieke (id, naam, postcode, district): een statistiekvraag zonder
// geometrie, klein genoeg voor één antwoord (de grens is 2.000 rijen; het grootste district heeft er ~375).
async function asVoorDistrict(label) {
  const rijen = [];
  for (const kant of ["L", "R"]) {
    const url = new URL(`${AS_URL}/query`);
    url.search = new URLSearchParams({
      where: `UPPER(DISTRICT)='${label.toUpperCase().replace(/'/g, "''")}'`,
      outStatistics: JSON.stringify([{ statisticType: "count", onStatisticField: "OBJECTID", outStatisticFieldName: "n" }]),
      groupByFieldsForStatistics: `${kant}STRNMID,${kant}STRNM,postcode,DISTRICT`,
      f: "json",
    });
    const data = await haal(url);
    if (!Array.isArray(data.features)) throw new Error(`straatas: geen features voor ${label}`);
    if (data.exceededTransferLimit) throw new Error(`straatas: te veel rijen voor ${label} (${kant})`);
    for (const { attributes: a } of data.features) rijen.push({ id: Number(a[`${kant}STRNMID`]), naam: a[`${kant}STRNM`], postcode: String(a.postcode ?? ""), district: a.DISTRICT });
  }
  return rijen;
}

async function registerStraatnamen() {
  const uit = [];
  for (let offset = 0; offset < 20000; offset += 500) {
    const data = await haal(`${REGISTER_URL}/straatnamen?gemeentenaam=Antwerpen&offset=${offset}&limit=500`, { accept: "application/ld+json" });
    const lijst = Array.isArray(data.straatnamen) ? data.straatnamen : [];
    uit.push(...lijst);
    if (lijst.length < 500 || !data.volgende) return uit;
  }
  throw new Error("adressenregister: paginering overschrijdt de veiligheidslimiet");
}

async function registerPostcodes(straatnaamId) {
  const pcs = new Set();
  for (let offset = 0; offset < 5000; offset += 500) {
    const data = await haal(`${REGISTER_URL}/adressen?straatnaamObjectId=${straatnaamId}&status=inGebruik&offset=${offset}&limit=500`, { accept: "application/ld+json" });
    const lijst = Array.isArray(data.adressen) ? data.adressen : [];
    for (const adres of lijst) { const pc = postcodeUitAdres(adres?.volledigAdres?.geografischeNaam?.spelling); if (pc) pcs.add(pc); }
    if (lijst.length < 500 || !data.volgende) break;
  }
  return [...pcs];
}

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const districten = districtenTabel();
  const asRijen = [];
  for (const d of districten) {
    const rijen = await asVoorDistrict(d.label);
    if (rijen.length < 50) throw new Error(`onverwacht weinig straatnamen in ${d.label}: ${rijen.length}`);
    asRijen.push(...rijen);
  }
  // Welke straatnamen kent de straatas al (de andere districten, plus district Antwerpen uit straten.json)?
  const districtDoc = JSON.parse(fs.readFileSync(path.join(rootDir, "site", "geo", "straten.json"), "utf8"));
  const bekend = new Set([...asRijen.map((r) => r.id), ...districtDoc.streets.map((r) => Number(r[0]))].filter((id) => Number.isFinite(id) && id > 0));
  const register = await registerStraatnamen();
  const aanvulling = [], overgeslagen = [];
  for (const s of register) {
    if (s?.straatnaamStatus !== "inGebruik") continue;
    const id = Number(s.identificator?.objectId);
    const naam = schoneNaam(s.straatnaam?.geografischeNaam?.spelling);
    if (!naam || bekend.has(id)) continue;
    const uit = districtUitPostcodes(await registerPostcodes(id), districten);
    if (uit.district) aanvulling.push({ naam, district: uit.district, postcode: uit.postcode });
    else overgeslagen.push({ naam, reden: uit.reden });
  }
  const { straten, uitRegister } = bouwStadStraten({ asRijen, aanvulling, districten });
  if (straten.length < 1500) throw new Error(`onverwacht weinig straatnamen: ${straten.length}`);
  const doc = {
    schemaVersion: 1,
    metadata: {
      title: "Straatnamen van de andere districten van stad Antwerpen",
      uitleg: "Alleen straatnaam, district en postcode, om in de zoekbalk te zeggen in welk district een straat ligt. De straten van district Antwerpen staan in straten.json.",
      bronnen: BRONNEN,
      retrievedOn: new Date().toISOString().slice(0, 10),
      fields: ["naam", "district (index in districten)", "postcode"],
      uitRegister,
      overgeslagen: overgeslagen.sort((a, b) => a.naam.localeCompare(b.naam, "nl")),
    },
    districten,
    straten,
  };
  const file = path.join(rootDir, STAD_STRATEN_FILE);
  fs.writeFileSync(file, `${JSON.stringify(doc)}\n`);
  const per = districten.map((d, i) => `${d.label} ${straten.filter((r) => r[1] === i).length}`).join(", ");
  console.log(`straten-stad: ${straten.length} geschreven naar ${path.relative(rootDir, file)} (${per}); uit het adressenregister: ${uitRegister.join(", ") || "geen"}; overgeslagen: ${overgeslagen.length}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
