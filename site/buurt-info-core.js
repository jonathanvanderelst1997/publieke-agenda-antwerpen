// De al bestaande radar registreert waarnemingen, nooit de echte start van een werk.
// Dit is een kleine, zuivere adapter voor één officiële straat.
const isDate = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const n = (value) => Number.isSafeInteger(value) && value >= 0 && value < 100000 ? value : 0;
export function radarVoorStraat(radar, straat, { nu = Date.now() } = {}) {
  if (!radar || typeof radar !== "object" || !radar.straten || !Array.isArray(radar.runs) ||
      !straat || !straat.id || !straat.name || !straat.postcode || !isDate(radar.ververst)) {
    return { status: "onbeschikbaar", nieuw: null, gewijzigd: null, afgelopen: null, ververst: "", periodenoot: "" };
  }
  const lagen = radar.lagen && typeof radar.lagen === "object" ? Object.values(radar.lagen) : [];
  const gezond = lagen.length >= 2 && lagen.every((laag) => laag?.status === "ok");
  const verlopen = nu - Date.parse(radar.ververst) > 26 * 3600 * 1000 || Date.parse(radar.ververst) - nu > 3600 * 1000;
  const status = !gezond ? "gedeeltelijk" : verlopen ? "verouderd" : "ok";
  const sleutel = [straat.id, straat.name, straat.postcode].join("|");
  let nieuw = 0, gewijzigd = 0, afgelopen = 0;
  for (const telling of Array.isArray(radar.straten[sleutel]) ? radar.straten[sleutel] : []) {
    if (!Array.isArray(telling) || !Number.isInteger(telling[0]) || !isDate(radar.runs[telling[0]])) continue;
    nieuw += n(telling[1]);
    gewijzigd += n(telling[2]);
    afgelopen += n(telling[3]);
  }
  const ingekort = radar.ingekort === true;
  let periodenoot = "Waargenomen wijzigingen in de laatste 7 dagen";
  if (ingekort) {
    const eerste = radar.runs.filter(isDate).sort()[0];
    periodenoot = eerste ? "Waargenomen wijzigingen vanaf " + eerste.slice(0, 10) + " (radar ingekort)" : "Alleen beschikbare waarnemingen (radar ingekort)";
  }
  return { status, nieuw, gewijzigd, afgelopen, ververst: radar.ververst, periodenoot };
}
// Wat de buurtinfo toont (besluit van de eigenaar van 18-10-2026: "niemand moet weten als er iets faalt, de
// momentopname blijft wel goed"). Is een laag niet actueel (`gedeeltelijk`) of de radar ouder dan 26 uur
// (`verouderd`), dan gewoon de laatste goede stand, met dezelfde zin en dezelfde getallen; de status blijft intern.
// Zonder bruikbare radar (`onbeschikbaar`): leeg, zonder zin en zonder getallen.
export function radarToestand(info) {
  if (!info || info.status === "onbeschikbaar") return { zin: "", cijfers: false };
  return {
    zin: info.nieuw + info.gewijzigd + info.afgelopen
      ? "Dit zijn waargenomen wijzigingen, niet de werkelijke start- of einddatum van de maatregelen."
      : "Geen wijzigingen geregistreerd in het beschikbare radarvenster; dat zegt niets over bestaande werken.",
    cijfers: true,
  };
}

// ---- in je buurt (wens van de eigenaar van 4-11-2026) ----
// Bij een gekozen straat: de evenementen en feesten van de publieke agenda tot ongeveer 500 m rond de straat, en het
// nieuws van het district (inspraak, infomomenten, projecten, districtsnieuws) dat de straat of de wijk noemt. Alleen
// wat al als publiek agendapunt op de site staat (officiële bronnen); een punt zonder gekende plek wordt nooit gegokt.
// De afstand is die tot het kader van de straat (straten.json): bij benadering, nooit te klein.
const EVENEMENT_CATEGORIEEN = new Set(["festival", "neighborhood", "culture", "family", "parade", "sport", "flea", "shopping", "other"]);
// Bronnen met nieuws van het district: projecten (inspraak, infomomenten, fasen) en het districtsnieuws.
export const NIEUWS_BRONNEN = Object.freeze(["district-nieuws", "district-projecten"]);
const plat = (value) => String(value ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const laatsteDag = (item) => String(item?.endDate || item?.date || "");
const plusDagen = (dag, n) => new Date(Date.parse(`${dag}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function afstandMeter(a, b) {
  const lat = ((a[1] + b[1]) / 2) * Math.PI / 180;
  const dx = (b[0] - a[0]) * 111_320 * Math.cos(lat), dy = (b[1] - a[1]) * 110_540;
  return Math.hypot(dx, dy);
}
// Afstand van een punt [lon, lat] tot een kader [minLon, minLat, maxLon, maxLat]; 0 als het punt erin ligt.
export function afstandTotKader(punt, kader) {
  if (!Array.isArray(punt) || !Array.isArray(kader) || kader.length < 4) return Infinity;
  const lon = Math.min(Math.max(punt[0], kader[0]), kader[2]), lat = Math.min(Math.max(punt[1], kader[1]), kader[3]);
  return afstandMeter(punt, [lon, lat]);
}
// Noemt de tekst deze naam als geheel (woordgrens, zonder hoofdletters of accenten)?
export function noemtPlek(tekst, naam) {
  const n = plat(naam);
  return n.length >= 3 && ` ${plat(tekst)} `.includes(` ${n} `);
}
const inDeStraat = (item, straat) => (Array.isArray(item?.straten) && item.straten.some((s) => plat(s) === plat(straat.name)))
  || noemtPlek(item?.location, straat.name);

// { evenementen, nieuws }: elk een lijst { id, title, date, location, link, afstand? }, gesorteerd op datum.
// `punt(item)`: [lon, lat] of null (site/geo/locaties.json via itemPoint). `wijk`: de naam van de wijk van de straat.
export function inJeBuurt({ items = [], straat = null, wijk = "", punt = () => null, vandaag = "", straal = 500, dagen = 60, max = 8 } = {}) {
  if (!straat?.name || !/^\d{4}-\d{2}-\d{2}$/.test(vandaag)) return { evenementen: [], nieuws: [] };
  const tot = plusDagen(vandaag, dagen);
  const komend = items.filter((item) => item?.id && item?.title && laatsteDag(item) >= vandaag && String(item.date || "") <= tot);
  const kaart = (item, extra = {}) => ({
    id: item.id, title: String(item.title), date: String(item.date), endDate: item.endDate || null, location: String(item.location || ""),
    link: item.noEventPage ? String(item.link || item.infoUrl || "") : `/event/${encodeURIComponent(item.id)}/`, ...extra,
  });
  const gezien = new Set();
  const evenementen = [];
  for (const item of komend) {
    if (!EVENEMENT_CATEGORIEEN.has(item.category) || gezien.has(item.id) || inDeStraat(item, straat)) continue;
    const p = punt(item);
    if (!p) continue;
    const afstand = afstandTotKader(p, straat.box);
    if (!(afstand <= straal)) continue;
    gezien.add(item.id);
    evenementen.push(kaart(item, { afstand: Math.max(50, Math.round(afstand / 50) * 50) }));
  }
  const nieuws = [];
  for (const item of komend) {
    if (!NIEUWS_BRONNEN.includes(item.sourceId) || gezien.has(item.id)) continue;
    const tekst = [item.title, item.location, item.info].join(" ");
    if (!noemtPlek(tekst, straat.name) && !(wijk && noemtPlek(tekst, wijk))) continue;
    gezien.add(item.id);
    nieuws.push(kaart(item));
  }
  const opDatum = (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, "nl");
  return { evenementen: evenementen.sort(opDatum).slice(0, max), nieuws: nieuws.sort(opDatum).slice(0, max) };
}
