// Zoeken in heel de stad (bouwplan stap 3): pure functies, zonder netwerk en zonder DOM (ook in de Node-toetsen).
// De straatnamen van de 9 andere districten (site/geo/straten-stad.json, scripts/build-straten-stad.mjs) komen naast
// de plekken van district Antwerpen (site/geo/straten.json). Een straat buiten district Antwerpen opent geen
// plekoverzicht: de pagina zegt in welk district ze ligt, dat deze agenda district Antwerpen volgt, en wat de site
// daar wel kent (de markten van de stad en het districtsnieuws, uit de agenda zelf, met hun bron).
// Deze module en de lijst laden pas als iemand begint te typen (site/place-view.js): de eerste weergave wacht er niet op.
import { editDistance, foldText, parseQuery, searchPlaces } from "./place-core.js";
import { onbekendZin } from "./onbekend-zinnen.js";

const compactOf = (value) => foldText(value).replace(/ /g, "");

// Delen van een districtsnaam die ook alleen getypt worden ("Zandvliet" is district Berendrecht-Zandvliet-Lillo).
const deelnamen = (label) => (label.includes("-") ? label.split("-") : []);

// De plekken buiten district Antwerpen: één per straatnaam, district en postcode ("buiten"), en één per district.
export function stadPlaces(doc) {
  const districten = (Array.isArray(doc?.districten) ? doc.districten : []).filter((d) => d && d.key && d.label);
  const uitRegister = new Set(Array.isArray(doc?.metadata?.uitRegister) ? doc.metadata.uitRegister : []);
  const places = [];
  const nameCount = new Map();
  const rijen = (Array.isArray(doc?.straten) ? doc.straten : []).filter((r) => Array.isArray(r) && r[0] && districten[r[1]]);
  for (const [naam] of rijen) nameCount.set(naam, (nameCount.get(naam) || 0) + 1);
  for (const [naam, i, postcode] of rijen) {
    const district = districten[i];
    places.push({
      type: "buiten",
      key: `buiten:${naam}|${postcode}`,
      name: naam,
      postcode: String(postcode || ""),
      district,
      label: naam,
      sub: `${postcode} · district ${district.label}`,
      ambiguous: nameCount.get(naam) > 1,
      bron: uitRegister.has(naam) ? "register" : "as",
      compact: compactOf(naam),
      words: foldText(naam).split(" "),
    });
  }
  for (const district of districten) {
    places.push({
      type: "district",
      key: `district:${district.key}`,
      name: district.label,
      district,
      label: `District ${district.label}`,
      sub: "ander district · markten en districtsnieuws",
      compact: compactOf(district.label),
      words: foldText(district.label).split(" "),
      aliases: deelnamen(district.label).map(compactOf),
    });
  }
  return places;
}

// Eén zoekindex voor de zoekbalk: eerst de plekken van district Antwerpen (buildPlaceIndex), dan de rest van de stad.
export function zoekIndex(districtIndex, doc) {
  const places = [...(districtIndex?.places || []), ...stadPlaces(doc)];
  return { places, byKey: new Map(places.map((p) => [p.key, p])), districten: Array.isArray(doc?.districten) ? doc.districten : [] };
}

// Een districtsnaam vooraan of achteraan ("Statiestraat Berchem", "Wilrijk Bist"): alleen in dat district zoeken.
function districtInVraag(index, query) {
  const woorden = foldText(query).split(" ").filter(Boolean);
  for (const district of index?.districten || []) {
    for (const naam of [district.label, ...deelnamen(district.label)]) {
      const d = foldText(naam).split(" ");
      const n = d.length;
      if (woorden.length <= n) continue;
      if (woorden.slice(-n).join(" ") === d.join(" ")) return { district, rest: woorden.slice(0, -n).join(" ") };
      if (woorden.slice(0, n).join(" ") === d.join(" ")) return { district, rest: woorden.slice(n).join(" ") };
    }
  }
  return null;
}

// Suggesties in heel de stad. Zoals searchPlaces (exact, begint met, woord, bevat, tikfout), met daarbij:
// - een postcode van een ander district ("2600") geeft dat district;
// - een districtsnaam bij de straat ("Statiestraat Berchem") zoekt alleen daar (en anders gewoon overal).
export function zoekOveral(index, query, { limit = 8 } = {}) {
  const q = parseQuery(query);
  if (!q.compact && q.postcode) {
    const eigen = searchPlaces(index, query, { limit });
    if (eigen.length) return eigen;
    const d = (index?.places || []).find((p) => p.type === "district" && p.district.postcodes.includes(q.postcode));
    return d ? [{ place: d, score: 100, match: "exact" }] : [];
  }
  const metDistrict = districtInVraag(index, query);
  if (metDistrict) {
    const binnen = searchPlaces({ places: (index?.places || []).filter((p) => p.type === "buiten" && p.district.key === metDistrict.district.key) }, `${metDistrict.rest}${q.postcode ? ` ${q.postcode}` : ""}`, { limit });
    if (binnen.length) return binnen;
  }
  return searchPlaces(index, query, { limit });
}

// ---- plek in de URL ----
// ?plek=Statiestraat 2600 (altijd met de postcode: de naam alleen kan ook een straat in district Antwerpen zijn) en
// ?plek=district:Berchem.
export function buitenParam(place) {
  if (place?.type === "buiten") return `${place.name} ${place.postcode}`;
  if (place?.type === "district") return `district:${place.name}`;
  return "";
}

// Welke plek buiten district Antwerpen bedoelt een link? Alleen één exacte: bij meer naamgenoten (?plek=Bist) null,
// en dan kiest de bewoner zelf in de suggesties.
export function resolveBuiten(index, value) {
  const raw = String(value ?? "").trim();
  if (!raw || !index) return null;
  const typed = /^district:(.*)$/i.exec(raw);
  if (typed) return (index.places || []).find((p) => p.type === "district" && compactOf(p.name) === compactOf(typed[1])) || null;
  if (index.byKey?.has(raw)) return index.byKey.get(raw);
  const q = parseQuery(raw);
  // Eerst de naam zoals in de link, met haar cijfers: buitenParam schrijft "Fort 7-straat 2610" en "Pad nr. 25 2150",
  // en parseQuery zou de 7 en de 25 als huisnummer weglaten. Dan de ontlede vraag (straat zonder huisnummer).
  for (const vorm of [q.ruw, q.compact]) {
    if (!vorm) continue;
    const exact = (index.places || []).filter((p) => p.type === "buiten" && p.compact === vorm && (!q.postcode || p.postcode === q.postcode));
    if (exact.length) return exact.length === 1 ? exact[0] : null;
  }
  return null;
}

// Dezelfde naam elders: de straten van district Antwerpen (die openen het plekoverzicht) en de andere districten.
export function naamgenoten(index, place) {
  if (place?.type !== "buiten") return { district: [], buiten: [] };
  const zelfde = (index?.places || []).filter((p) => p !== place && p.compact === place.compact);
  return { district: zelfde.filter((p) => p.type === "straat"), buiten: zelfde.filter((p) => p.type === "buiten") };
}

// ---- wat de site wel kent in een ander district ----
// Alleen wat al in de agenda staat (window.PUBLIC_AGENDA_PUBLIC_ITEMS): de markten van de stad (stad-markten, uit
// GIPOD) en het nieuws van het district (stad-districten, van antwerpen.be). Niets erbij verzonnen: titel, dag, uur
// en plaats zoals de bron ze geeft, met de link naar de bron.
const veiligeLink = (url) => (/^https:\/\//i.test(String(url || "")) ? String(url) : "");
const isoDag = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v || "")) ? String(v).slice(0, 10) : "");
const uurVan = (item) => {
  const tekst = String(item?.timeText || "").trim();
  if (tekst) return tekst;
  const m = /^(\d{2}):(\d{2})$/.exec(String(item?.timeSlot || ""));
  return m ? `${Number(m[1])}.${m[2]} uur` : "";
};
// "Kioskplaats, 2660 Hoboken" → straat "Kioskplaats", postcode "2660"; "Laar (Borgerhout), 2140 Borgerhout" → "Laar".
function marktPlaats(location) {
  const [straat = "", rest = ""] = String(location || "").split(/,(.*)/s);
  return { straat: straat.replace(/\s*\([^)]*\)\s*$/, "").trim(), postcode: /\b(\d{4})\b/.exec(rest)?.[1] || "" };
}

// Het district van een markt: de postcode uit de bron; zonder postcode de straatnaam, als die maar in één
// district van de stad bestaat (zo staat de Michel Willemsplein-markt van GIPOD zonder postcode bij Wilrijk).
export function districtVanMarkt(item, index) {
  const districten = index?.districten || [];
  const pcs = [...(Array.isArray(item?.postcodes) ? item.postcodes : []), marktPlaats(item?.location).postcode].map(String).filter(Boolean);
  for (const pc of pcs) { const d = districten.find((x) => x.postcodes.includes(pc)); if (d) return d; }
  if (pcs.length) return null;
  const naam = compactOf(marktPlaats(item?.location).straat);
  const keys = new Set((index?.places || []).filter((p) => (p.type === "buiten" || p.type === "straat") && p.compact === naam).map((p) => (p.type === "buiten" ? p.district.key : "antwerpen")));
  return keys.size === 1 ? districten.find((d) => keys.has(d.key)) || null : null;
}

// Dezelfde straat, ook met één letter verschil: GIPOD schrijft de markt als "Ten Eeckhovelei", de straatas als
// "Ten Eekhovelei" (nakijkbevinding). Alleen binnen hetzelfde district (watDeSiteKent kijkt dat eerst na) en voor
// namen vanaf 6 letters, zodat twee korte namen niet samenvallen.
function zelfdeStraat(a, b) {
  if (!a || !b) return false;
  return a === b || (Math.min(a.length, b.length) >= 6 && editDistance(a, b, 1) <= 1);
}
export function watDeSiteKent(district, items = [], today = "", { index = null, straat = "" } = {}) {
  if (!district) return { markten: [], nieuws: [] };
  const komend = (item) => (isoDag(item?.endDate) || isoDag(item?.date)) >= today;
  const straatCompact = compactOf(straat);
  const groepen = new Map();
  for (const item of items) {
    if (item?.sourceId !== "stad-markten" || !isoDag(item.date) || !komend(item)) continue;
    if (districtVanMarkt(item, index)?.key !== district.key) continue;
    const sleutel = `${item.title}|${item.location}`;
    const g = groepen.get(sleutel) || { title: String(item.title || ""), location: String(item.location || ""), dagen: [], inStraat: zelfdeStraat(compactOf(marktPlaats(item.location).straat), straatCompact) };
    // De bron is die van de eerstvolgende marktdag (elke marktdag heeft in GIPOD een eigen record).
    g.dagen.push({ date: isoDag(item.date), uur: uurVan(item), bron: veiligeLink(item.link || item.sourceUrl) });
    groepen.set(sleutel, g);
  }
  const markten = [...groepen.values()].map((g) => {
    g.dagen.sort((a, b) => a.date.localeCompare(b.date));
    return { ...g, bron: g.dagen.find((d) => d.bron)?.bron || "" };
  }).sort((a, b) => Number(b.inStraat) - Number(a.inStraat) || a.dagen[0].date.localeCompare(b.dagen[0].date) || a.title.localeCompare(b.title, "nl"));
  const gezien = new Set();
  const nieuws = items
    .filter((item) => item?.sourceId === "stad-districten" && String(item.id || "").startsWith(`stad-news-${district.key}-`) && isoDag(item.date) && komend(item))
    .filter((item) => !gezien.has(item.id) && gezien.add(item.id))
    .sort((a, b) => isoDag(a.date).localeCompare(isoDag(b.date)) || String(a.title).localeCompare(String(b.title), "nl"))
    .map((item) => {
      const volzet = /^\s*volzet\s*[-–:]\s*/i.test(String(item.title || ""));
      const ruw = String(item.location || "");
      // De vaste zin "District X, locatie via de officiële bron" zegt niets: dan geen plaats.
      const location = /locatie via de officiële bron/i.test(ruw) ? "" : ruw;
      const uur = uurVan(item);
      // Zonder plaats of uur zegt het bericht dat (onbekend-zinnen.js), niet niets.
      const ontbreekt = !location && !uur ? onbekendZin("nieuws-plaats-uur") : !location ? onbekendZin("nieuws-plaats") : !uur ? onbekendZin("nieuws-uur") : "";
      return {
        title: String(item.title || "").replace(/^\s*volzet\s*[-–:]\s*/i, ""),
        volzet,
        date: isoDag(item.date),
        endDate: isoDag(item.endDate),
        uur,
        location,
        ...(ontbreekt ? { ontbreekt } : {}),
        bron: veiligeLink(item.link || item.sourceUrl),
      };
    });
  return { markten, nieuws };
}
